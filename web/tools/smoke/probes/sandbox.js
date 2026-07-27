// THE SANDBOX ACCEPTANCE (DW-31). Run it TWICE, once per mode:
//
//   node tools/smoke/run.mjs --url=http://127.0.0.1:5199/ --scenario=walk \
//     --evalfile=web/tools/smoke/probes/sandbox.js
//   ... and again with --sandbox=1
//
// TWO RUNS AND NOT ONE, because a mode is decided at boot and a page is one
// world. Playwright launches a fresh profile per run, so IndexedDB and the pack
// both start empty, which is exactly the precondition this probe needs: "places
// with an EMPTY pack" is only a claim about the mode if the pack is provably
// empty, and that is asserted rather than assumed (DW-20).
//
// THE PROBE DOES NOT KNOW WHICH MODE IT IS IN. It reads the URL, reads what the
// GAME thinks, and FAILS if they disagree. That is the setup proof: a run where
// `?sandbox=1` never reached the app would otherwise quietly test survival twice
// and report green both times.
//
// THREE NEGATIVE CONTROLS, because "everything is free" is the single easiest
// claim in this project to pass by accident:
//
//   1. THE OTHER RUN. Without the flag the identical placement, on the identical
//      empty pack, at the identical cell, is REFUSED by name. This is the one
//      the brief asked for and it is the one that distinguishes "the mode is
//      doing the work" from "the cost check is broken".
//   2. IN THE SAME PAGE. `/core`'s own affordability answer is surfaced beside
//      the game's (`costs[].affordInCore`), and in sandbox a foundation goes
//      down while /core still says the pack cannot pay. The cost rule is alive;
//      the mode is what is lifting it.
//   3. THE SLOTS. A decoy survival save is written straight into IndexedDB under
//      the survival key, and after a full sandbox session it must come back
//      BYTE FOR BYTE. That is DW-31's "must not silently contaminate a normal
//      save" as a measurement rather than an assurance.
//
// AND ONE REAL EVENT. The Craft button is clicked with a genuine DOM click, not
// through `of.craft`, because probes/realclick.js is the standing reminder that
// an abstraction hid a completely inert left mouse button through twenty green
// probes.
(async () => {
  const of = window.__of;
  if (!of) return { valid: false, why: 'no __of' };
  const sleep = (n) => of.run(n);
  const act = async (names, frames = 6, secs = 0.35) => {
    of.input.act(names, frames);
    await sleep(secs);
  };
  const fails = [];
  const log = [];
  const check = (name, ok, detail) => {
    if (!ok) fails.push(detail === undefined ? name : `${name}: ${detail}`);
    return ok;
  };

  // --- raw slot access, for the contamination measurement -------------------
  // Reading and writing the STORE is not a rule bypass; it is looking at where
  // the save actually lands. Every game rule below still goes through a key.
  const store = (mode, fn) => new Promise((res) => {
    const req = indexedDB.open('orbital-foundry', 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('saves')) db.createObjectStore('saves');
    };
    req.onerror = () => res(null);
    req.onsuccess = () => {
      const db = req.result;
      const t = db.transaction('saves', mode);
      const r = fn(t.objectStore('saves'));
      r.onsuccess = () => { res(r.result ?? null); db.close(); };
      r.onerror = () => { res(null); db.close(); };
    };
  });
  const slotKeys = () => store('readonly', (s) => s.getAllKeys());
  const readKey = (k) => store('readonly', (s) => s.get(k));
  const writeKey = (k, v) => store('readwrite', (s) => s.put(v, k));

  await sleep(1.0);
  const t0 = of.world().tick;

  // ======================================================================
  // 0. SETUP PROOF: which mode is this, and is the pack really empty?
  // ======================================================================
  const urlSaysSandbox = new URLSearchParams(location.search).get('sandbox') === '1';
  const m = of.game().mode;
  const sandbox = m.sandbox;
  check('the URL flag reached the game', sandbox === urlSaysSandbox,
    `url ${urlSaysSandbox}, game ${m.mode}`);
  const pack0 = of.game().carried;
  check('the pack starts EMPTY', pack0.length === 0, JSON.stringify(pack0));
  const startKeys = await slotKeys();
  check('the save store starts empty', (startKeys ?? []).length === 0,
    JSON.stringify(startKeys));
  const sandboxApi = of.sandbox();
  check('the mode surface agrees', sandboxApi !== null
    && sandboxApi.mode === m.mode, JSON.stringify(sandboxApi));

  // ======================================================================
  // 1. THE BADGE. A player who forgets they are in sandbox costs a session.
  // ======================================================================
  const badgeEl = document.querySelector('#of-mode');
  const badgeShown = () => badgeEl !== null
    && getComputedStyle(badgeEl).display !== 'none' && badgeEl.textContent !== '';
  const badge = { text: badgeEl === null ? null : badgeEl.textContent,
    shownInPlay: badgeShown() };
  check('the badge matches the mode', badge.shownInPlay === sandbox,
    `${badge.text} shown=${badge.shownInPlay}`);

  // ======================================================================
  // 2. AN EMPTY PACK AND A FOUNDATION
  // ======================================================================
  // Foundation in hand, straight down under the feet, which is the flattest
  // ground the player is standing on and therefore the cell least likely to be
  // refused for DW-24 unevenness. The sweep SKIPS an uneven refusal so the
  // reason we end up reading is about COST and not about terrain: reading the
  // wrong refusal would make the survival half pass for the wrong reason.
  const yaw = of.world().observer.yawDeg;
  const ghost = () => of.build().structGhost;
  of.build(4);
  await sleep(0.2);
  let aimed = null;
  for (let p = -88; p <= -55 && aimed === null; p += 2) {
    of.look(yaw, p);
    await sleep(0.06);
    const g = ghost();
    if (g !== null && g.addr !== null && !g.reason.startsWith('ground too uneven')) {
      aimed = { g, pitch: p };
    }
  }
  check('found a cell whose refusal is about cost, not terrain', aimed !== null,
    JSON.stringify(ghost()));
  const partsBefore = of.game().structures.parts.length;
  of.input.tape([{ hold: 4, actions: ['use'] }, { hold: 8, keys: [] }]);
  await sleep(0.4);
  const foundation = {
    ghostOk: aimed === null ? null : aimed.g.ok,
    ghostReason: aimed === null ? null : aimed.g.reason,
    placed: of.game().structures.parts.length - partsBefore,
    packAfter: of.game().carried,
    // NEGATIVE CONTROL 2, in this very page: what /core says with the mode
    // taken out of the question.
    coreAffordFoundation: of.game().structures.costs
      .find((c) => c.kind === 'foundation')?.affordInCore ?? null,
    costText: of.game().structures.costs
      .find((c) => c.kind === 'foundation')?.cost ?? null,
  };
  check('/core still says an empty pack cannot pay',
    foundation.coreAffordFoundation === false,
    String(foundation.coreAffordFoundation));
  if (sandbox) {
    check('sandbox placed a foundation on an empty pack', foundation.placed === 1,
      `${foundation.placed}, ghost "${foundation.ghostReason}"`);
    check('and the pack is STILL empty', foundation.packAfter.length === 0,
      JSON.stringify(foundation.packAfter));
    check('the ghost says it is free', foundation.ghostOk === true
      && String(foundation.ghostReason).includes('free'), String(foundation.ghostReason));
  } else {
    check('survival REFUSED the same placement', foundation.placed === 0,
      `${foundation.placed} placed`);
    check('and said what was missing', foundation.ghostOk === false
      && String(foundation.ghostReason).startsWith('need '),
      String(foundation.ghostReason));
  }

  // ======================================================================
  // 3. A GATED ITEM. The hand furnace must be CRAFTED before it can be placed,
  //    which is the strongest progression gate this client actually has.
  // ======================================================================
  // NO RESEARCH GATE EXISTS IN THE WEB CLIENT YET. `research.h` is green
  // headless (GP-1, GP-2) and has never been wired into the browser, so there is
  // nothing here to bypass and the probe says so rather than pretending. The
  // gate it CAN test is the crafted-item one, and it lands on the same
  // `ModeRules.freeBuild` question research will ask when it arrives.
  of.hotbar(2);
  await sleep(0.2);
  of.look(yaw, -22);
  await sleep(0.2);
  const machinesBefore = of.game().machines.length;
  of.input.tape([{ hold: 4, actions: ['use'] }, { hold: 8, keys: [] }]);
  await sleep(0.5);
  const gated = {
    what: 'primitive furnace (requires the crafted item in the pack)',
    researchGatesInClient: 0,
    heldSlot: of.hotbar().kind,
    placed: of.game().machines.length - machinesBefore,
    packAfter: of.game().carried,
  };
  check('the furnace slot was in hand', gated.heldSlot === 'furnace', gated.heldSlot);
  if (sandbox) {
    check('sandbox placed the gated furnace with nothing in the pack',
      gated.placed === 1, `${gated.placed}`);
    check('and spent nothing for it', gated.packAfter.length === 0,
      JSON.stringify(gated.packAfter));
  } else {
    check('survival refused the uncrafted furnace', gated.placed === 0,
      `${gated.placed}`);
  }

  // ======================================================================
  // 4. THE FULL CATALOGUE, and a REAL click on a real button
  // ======================================================================
  // The bar first: every buildable part must be reachable from a slot. It is
  // authored as DATA (Hotbar.DEFAULT_BAR) so this holds in both modes, and it is
  // asserted anyway because "pick anything thats in the game" is the ask and a
  // bar that lost a part would fail it silently.
  const barParts = of.hotbar().slots.map((s) => s.part).filter((p) => p !== null);
  const wantParts = ['miner', 'belt', 'smelter', 'foundation', 'floor', 'wall', 'door'];
  const missing = wantParts.filter((p) => !barParts.includes(p));
  check('every buildable part is on the bar', missing.length === 0,
    JSON.stringify(missing));

  of.panel(true);
  await sleep(0.4);
  const rows = [...document.querySelectorAll('#of-panel .of-recipe')];
  const offered = rows.filter((r) => r.classList.contains('can')).length;
  // /core's UNMODIFIED verdict, straight off the report, which is the third
  // reading of the same negative control: with an empty pack nothing is really
  // craftable, in either mode.
  const coreCraftable = of.game().recipes.filter((r) => r.craftable).length;
  const button = document.querySelector('#of-panel .of-recipe button[data-i]');
  const buttonDisabled = button === null ? null : button.disabled;
  const beforeClick = of.game().carried.length;
  // THE REAL EVENT. Not of.craft(): probes/realclick.js is the whole reason.
  if (button !== null) button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await sleep(0.4);
  const catalogue = {
    recipeRows: rows.length,
    offeredInPanel: offered,
    craftableInCore: coreCraftable,
    firstButtonDisabled: buttonDisabled,
    packItemsBeforeClick: beforeClick,
    packItemsAfterClick: of.game().carried.length,
    packAfterClick: of.game().carried,
  };
  check('/core says nothing is craftable on an empty pack', coreCraftable === 0,
    `${coreCraftable}`);
  if (sandbox) {
    check('the panel offers the WHOLE catalogue', offered === rows.length && rows.length > 0,
      `${offered} of ${rows.length}`);
    check('a real click on a real button crafted something',
      catalogue.packItemsAfterClick > beforeClick,
      `${beforeClick} -> ${catalogue.packItemsAfterClick}`);
  } else {
    check('survival offers nothing on an empty pack', offered === 0, `${offered}`);
    check('the button is disabled and a real click does nothing',
      buttonDisabled === true && catalogue.packItemsAfterClick === beforeClick,
      `disabled ${buttonDisabled}, ${beforeClick} -> ${catalogue.packItemsAfterClick}`);
  }

  // THE MENU ENTRY. Asserted here, not clicked: the button NAVIGATES, which
  // would destroy this execution context and every measurement in it. What is
  // checked is that it exists, is enabled, names the other mode, and points at a
  // URL that actually carries the flag.
  //
  // The click itself WAS proven, out of band, with a real DOM event in a live
  // browser on 2026-07-26, both directions: survival -> `?sandbox=1` with the
  // badge appearing and `game().mode.mode === 'sandbox'` after the reload, then
  // sandbox -> the flag gone, badge `display: none`, mode survival. Recorded
  // here because a control this probe cannot press is a control somebody has to
  // press, and an unrecorded manual check is one nobody repeats.
  const menuBtn = document.querySelector('#of-panel .mode button');
  const menu = {
    present: menuBtn !== null,
    label: menuBtn === null ? null : menuBtn.textContent,
    enabled: menuBtn === null ? null : !menuBtn.disabled,
    switchUrl: of.sandbox()?.switchUrl ?? null,
  };
  check('the pack panel carries the mode switch', menu.present && menu.enabled,
    JSON.stringify(menu));
  check('the switch names the OTHER mode',
    String(menu.label) === (sandbox ? 'Leave sandbox' : 'Enter sandbox'),
    String(menu.label));
  check('the switch URL flips the flag',
    String(menu.switchUrl).includes('sandbox=1') !== sandbox, String(menu.switchUrl));
  // The badge must survive a panel being open: that is the exact moment a player
  // is looking at free recipes and wondering why.
  const badgeOverPanel = badgeShown();
  check('the badge is still up behind the panel', badgeOverPanel === sandbox,
    String(badgeOverPanel));
  of.panel(false);
  await sleep(0.3);

  // ======================================================================
  // 5. THE SAVE. Its own slot, its own label, and the other mode untouched.
  // ======================================================================
  // A DECOY survival world is planted under the survival key BEFORE anything is
  // saved. If a sandbox session can write over it, this is what catches it.
  const decoy = { version: -1, seed: of.config.seedLo, mode: 'survival',
    savedAt: 1234567890, pack: [], depletion: [], patches: [], buildings: [],
    machines: [], voxels: { cells: [], ops: [] }, decoy: true };
  await writeKey('auto', decoy);

  const written = await of.save();
  await sleep(0.3);
  const keysAfter = await slotKeys();
  const survivalRaw = await readKey('auto');
  const sandboxRaw = await readKey('auto-sandbox');
  const partsAtSave = of.game().structures.parts.length;

  // THE RELOAD, modelled the way every other persistence probe models it: throw
  // the world away and grow it back from the seed, then load. A save is a diff
  // over a freshly generated world, so restoring onto the live one would test a
  // state no real boot can be in.
  of.forgetTunnels();
  of.repopulate();
  await sleep(0.3);
  const ledger = await of.load();
  await sleep(0.4);

  const save = {
    wroteMode: written === null ? null : written.mode,
    keys: keysAfter,
    survivalSlotUntouched: survivalRaw !== null && survivalRaw.decoy === true
      && survivalRaw.savedAt === 1234567890,
    survivalSlotMode: survivalRaw === null ? null : survivalRaw.mode,
    sandboxSlotMode: sandboxRaw === null ? null : sandboxRaw.mode,
    ledgerMode: ledger === null ? null : ledger.mode,
    slotRefused: of.game().persist.slotRefused,
    partsAtSave,
    partsAfterLoad: of.game().structures.parts.length,
    modeAfterLoad: of.game().mode.mode,
    badgeAfterLoad: badgeShown(),
  };
  check('the save recorded the mode it was made in', save.wroteMode === m.mode,
    String(save.wroteMode));
  // THE CONTAMINATION ASSERTION. In sandbox the survival key must still hold the
  // decoy exactly; in survival the game's own save legitimately replaces it.
  if (sandbox) {
    check('a sandbox session did NOT touch the survival slot',
      save.survivalSlotUntouched, JSON.stringify(survivalRaw?.savedAt ?? null));
    check('the sandbox world went to the sandbox key',
      save.sandboxSlotMode === 'sandbox', String(save.sandboxSlotMode));
    check('the load brought back a slot still labelled sandbox',
      save.ledgerMode === 'sandbox', String(save.ledgerMode));
  } else {
    check('the survival world went to the survival key',
      save.survivalSlotMode === 'survival', String(save.survivalSlotMode));
    check('no sandbox slot was created', sandboxRaw === null,
      JSON.stringify(sandboxRaw === null ? null : sandboxRaw.mode));
    check('the load brought back a slot still labelled survival',
      save.ledgerMode === 'survival', String(save.ledgerMode));
  }
  check('the base came back across the reload',
    save.partsAfterLoad === save.partsAtSave,
    `${save.partsAtSave} -> ${save.partsAfterLoad}`);
  check('the mode is unchanged by a reload', save.modeAfterLoad === m.mode,
    save.modeAfterLoad);

  // ======================================================================
  // 6. THE BELT AND BRACES: a slot whose own record disagrees with its key.
  // ======================================================================
  // Only reachable by hand-editing the store or by a future migration bug, which
  // is precisely why it is tested: the KEY makes contamination impossible and
  // the FIELD is what catches a key that has gone wrong.
  const good = await readKey(sandbox ? 'auto-sandbox' : 'auto');
  const wrongLabel = { ...good, mode: sandbox ? 'survival' : 'sandbox' };
  await writeKey(sandbox ? 'auto-sandbox' : 'auto', wrongLabel);
  const partsBeforeBad = of.game().structures.parts.length;
  const badLedger = await of.load();
  await sleep(0.3);
  const mislabelled = {
    ledger: badLedger,
    refusal: of.game().persist.slotRefused,
    partsUnchanged: of.game().structures.parts.length === partsBeforeBad,
  };
  check('a mislabelled slot is REFUSED', badLedger === null, JSON.stringify(badLedger));
  check('and the refusal is reported rather than silent',
    mislabelled.refusal === 'mode', String(mislabelled.refusal));
  check('and the live world is left alone', mislabelled.partsUnchanged);

  // DW-20. The survival half short-circuits on every refusal and so runs the
  // shortest: measured at 238 ticks, four seconds of simulation, which is ample
  // proof it advanced. The gate sits under that rather than over it, because a
  // threshold a passing run cannot clear is a probe that tests its own patience.
  const ticks = of.world().tick - t0;
  check('the simulation advanced', ticks > 200, `${ticks} ticks`);

  return {
    valid: fails.length === 0,
    // FIRST, because every number below means the opposite thing in the other
    // mode and a reader who missed this line would draw the wrong conclusion.
    mode: m.mode,
    urlFlag: urlSaysSandbox,
    fails,
    log,
    advanced: { ticks, packAtStart: pack0 },
    badge,
    foundation,
    gated,
    catalogue,
    menu,
    save,
    mislabelled: { refusal: mislabelled.refusal,
      loaded: badLedger === null ? null : badLedger.mode,
      partsUnchanged: mislabelled.partsUnchanged },
    // The pairing is on the OPERATOR, and said here so it cannot be forgotten:
    // this file is half an acceptance until it has been run both ways.
    note: sandbox
      ? 'sandbox half. The negative control is this same file run WITHOUT --sandbox=1.'
      : 'survival half (the negative control). Now run it with --sandbox=1.',
  };
})()
