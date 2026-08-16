// qolbuild1.js: QOL SURVEY, stage 1. The build menu, the hotbar, and what a
// player can READ off the screen. Records DRAWN text, never model state alone.
// Stages via --evalargs={"stage":"..."}: menu | hotbar | pack
//
//   node tools/smoke/run.mjs --scenario=walk --sandbox=1 \
//        --evalfile=tools/smoke/probes/qolbuild1.js
//
// BT-190: this probe never carried a real invocation; `extractCmd()`'s old
// first-match rule took a prose line further down ("...run.mjs only fails a
// run on console errors and failed requests: thirteen green stages
// supported exactly zero statements...") as the command, which held zero
// real flags, so every prior sweep ran this at the runner's bare defaults.
// `--sandbox=1` per `qolflight1.js`'s own stated rationale for the same
// family ("the full part catalogue is needed"): every stage here reads the
// build menu and hotbar as shipped, not after any crafting, so a fresh
// survival pack would report an empty catalogue rather than the QOL
// question the survey exists to ask.
//
// GP-401. EVERY STAGE NOW ASSERTS, AND A FAILED ASSERTION THROWS. Before this
// pass the file returned a bag of readings and no claims at all, and the runner
// printed `smoke: PASS` for a probe that returned `fails: ['DELIBERATE
// FAILURE']` or `valid:false`: run.mjs only fails a run on console errors and
// failed requests, so thirteen green stages supported exactly zero statements
// about the game. A THROW is the one thing that does travel: it rejects
// page.evaluate, which the runner reports as a failure with exit 1. So `finish`
// throws, and nothing here is green unless every check held.
(async () => {
  const of = window.__of;
  // A THROW, not `return {valid:false}`: a returned flag exits 0 and prints PASS.
  if (!of) throw new Error('probe: window.__of is missing, the client did not boot');
  const sleep = (n) => of.run(n);
  const stage = (OF_ARGS && OF_ARGS.stage) || 'menu';

  // A DRAWN string, or null. `innerText` falls back to `textContent` on a
  // display:none element, so the old `txt()` reported hidden panels' stale
  // contents as though a player could read them. Measured: a game-hidden
  // #of-prompt returned a string naming the PREVIOUS item.
  // getClientRects() is the base test rather than offsetParent, because
  // offsetParent is null for position:fixed elements that ARE visible.
  const drawn = (el) => {
    if (el === null || el === undefined) return null;
    if (el.getClientRects().length === 0) return null;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || Number(cs.opacity) < 0.02) return null;
    const s = (el.textContent || '').replace(/\s+/g, ' ').trim();
    return s === '' ? null : s;
  };
  // The raw text REGARDLESS of visibility, for when a stage wants to prove a
  // panel holds the right content while deliberately hidden. Never use this to
  // claim a player read something.
  const raw = (el) => (el === null || el === undefined ? null
    : (el.textContent || '').replace(/\s+/g, ' ').trim());
  const fails = [];
  const log = [];
  const check = (name, ok, detail) => {
    log.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail === undefined ? '' : `  [${detail}]`}`);
    if (!ok) fails.push(`${name} :: ${detail}`);
  };
  const finish = (out) => {
    if (fails.length > 0) {
      // Each failure ALSO on its own console.error line. run.mjs dedups its
      // error list on the first 160 characters of a message, so a single long
      // throw arrives TRUNCATED and every failure after the first is
      // unreadable. One line each survives that, and a page console.error is
      // itself a failing run, so this cannot turn a red run green.
      for (const f of fails) console.error(`probe FAIL: ${f}`);
      throw new Error(`probe: ${fails.length} of ${log.length} checks failed:\n  `
        + fails.join('\n  '));
    }
    return { ...out, valid: true, log };
  };

  // Every HUD channel, read BOTH ways at the same instant. `drawn` is what a
  // player could have read; the `*RawOnly` twin appears only when the element
  // holds text that is NOT on screen, which is exactly the string the old
  // `txt()` would have reported as though it were. The pair is the evidence.
  const CHROME = { prompt: '#of-prompt', toast: '#of-toast', banner: '#of-banner',
    carry: '#of-carry', gain: '#of-gain', mode: '#of-mode' };
  const chrome = () => {
    const o = {};
    for (const k of Object.keys(CHROME)) {
      const el = document.querySelector(CHROME[k]);
      const d = drawn(el);
      const r = raw(el);
      o[k] = d;
      if (d === null && r !== null && r !== '') o[`${k}RawOnly`] = r;
    }
    return o;
  };

  const out = { probe: 'qolbuild1', stage, sandbox: of.sandbox().sandbox };
  const STAGES = ['menu', 'hotbar', 'pack'];
  check(`'${stage}' is a stage this probe implements`, STAGES.indexOf(stage) !== -1,
    `not one of ${STAGES.join(' | ')}`);

  await sleep(0.8);

  // ---- INSTRUMENT SELF-TEST, every run ------------------------------------
  // #of-panel (the Tab pack) is ALWAYS in the DOM and is `display:none` until
  // it gains `.open` (ui/styles/game.css). Shut, it must therefore satisfy BOTH
  // halves at once: raw() still hands back its hint sentences, and drawn()
  // hands back null. If that ever stops holding the instrument is broken and
  // every reading below is worthless, so it is a check and not a note.
  {
    const p = document.querySelector('#of-panel');
    out.instrument = {
      selector: '#of-panel',
      className: p === null ? null : p.className,
      display: p === null ? null : getComputedStyle(p).display,
      clientRects: p === null ? null : p.getClientRects().length,
      rawChars: raw(p) === null ? null : raw(p).length,
      rawHead: raw(p) === null ? null : raw(p).slice(0, 110),
      drawn: drawn(p),
    };
    check('instrument: #of-panel is in the DOM', p !== null, 'querySelector returned null');
    check('instrument: the SHUT pack computes to display:none',
      out.instrument.display === 'none', `display=${out.instrument.display}`);
    check('instrument: raw() STILL reports the shut pack’s text (the old txt() bug)',
      out.instrument.rawChars !== null && out.instrument.rawChars > 40,
      `rawChars=${out.instrument.rawChars}`);
    check('instrument: drawn() returns null for that same shut element',
      out.instrument.drawn === null, `drawn=${JSON.stringify(out.instrument.drawn)}`);
  }

  // What the keyboard actually does, as the game's own table says.
  out.bindings = of.input.bindings();
  out.bindingCount = out.bindings === null || typeof out.bindings !== 'object' ? 0
    : (Array.isArray(out.bindings) ? out.bindings.length : Object.keys(out.bindings).length);
  check('the client publishes a non-empty binding table', out.bindingCount > 0,
    `${out.bindingCount} bindings, typeof=${typeof out.bindings}, array=${Array.isArray(out.bindings)}`);

  if (stage === 'menu') {
    const shut = document.querySelector('#of-build');
    check('#of-build exists in the DOM before the key is pressed', shut !== null,
      'querySelector returned null');
    out.menuShut = { drawn: drawn(shut), rawChars: raw(shut) === null ? null : raw(shut).length };
    check('the build menu is NOT drawn before the build key',
      out.menuShut.drawn === null, `drawn=${JSON.stringify(out.menuShut.drawn)}`);

    of.input.act(['build'], 4);
    await sleep(0.6);
    const root = document.querySelector('#of-build');
    out.menuOpen = of.buildMenu().open;
    // FIXTURE FIRST: nothing below means anything unless the menu opened.
    check('the build key OPENED the menu (model)', out.menuOpen === true,
      `buildMenu().open=${JSON.stringify(out.menuOpen)}`);
    check('the open build menu is DRAWN', drawn(root) !== null,
      `drawn=null; display=${root === null ? 'no element'
        : getComputedStyle(root).display}; rects=${root === null ? '-' : root.getClientRects().length}`);

    out.menuHeading = drawn(root && root.querySelector('h3'));
    out.menuHint = drawn(root && root.querySelector('.hint'));
    check('the build menu draws a heading', out.menuHeading !== null,
      `h3 drawn=${JSON.stringify(out.menuHeading)}`);

    out.groups = [...(root ? root.querySelectorAll('.grp') : [])].map((g) => ({
      name: drawn(g.querySelector('h4')),
      tiles: [...g.querySelectorAll('.of-btile')].map((t) => ({
        id: t.getAttribute('data-build'),
        cls: t.className,
        name: drawn(t.querySelector('.nm')),
        cost: drawn(t.querySelector('.cost')),
        ing: drawn(t.querySelector('.ing')),
        lock: drawn(t.querySelector('.lock')),
        title: t.getAttribute('title'),
        drawnWhole: drawn(t),
        hasImg: t.querySelector('.art img') !== null,
        imgAlt: (t.querySelector('.art img') || {}).alt || null,
        imgSrcHead: ((t.querySelector('.art img') || {}).src || '').slice(0, 24) || null,
      })),
    }));
    out.tileCount = out.groups.reduce((a, g) => a + g.tiles.length, 0);
    out.groupCount = out.groups.length;
    check(`the build menu draws at least one tile`, out.tileCount > 0,
      `0 of ${out.tileCount} tiles`);
    out.groupsWithDrawnName = out.groups.filter((g) => g.name !== null).length;
    check(`every one of ${out.groupCount} groups draws a heading`,
      out.groupsWithDrawnName === out.groupCount,
      `${out.groupsWithDrawnName} of ${out.groupCount}`);

    const tiles = out.groups.reduce((a, g) => a.concat(g.tiles), []);
    out.tilesWithDrawnName = tiles.filter((t) => t.name !== null).length;
    check(`every one of ${out.tileCount} build tiles draws a NAME the player can read`,
      out.tilesWithDrawnName === out.tileCount,
      `${out.tilesWithDrawnName} of ${out.tileCount} drew a .nm`);
    out.tilesWithDrawnCost = tiles.filter((t) => t.cost !== null).length;
    check(`every one of ${out.tileCount} build tiles draws a COST line`,
      out.tilesWithDrawnCost === out.tileCount,
      `${out.tilesWithDrawnCost} of ${out.tileCount} drew a .cost`);
    out.tilesWithBuildId = tiles.filter((t) => t.id !== null && t.id !== '').length;
    check(`every one of ${out.tileCount} tiles carries a data-build id`,
      out.tilesWithBuildId === out.tileCount,
      `${out.tilesWithBuildId} of ${out.tileCount}`);

    // RECORDED, NOT ASSERTED: whether the menu says anywhere what a thing DOES.
    // This is the survey's actual question and the answer is a finding, so it
    // is a number in the report rather than a claim that would fail the run.
    out.tilesWithTitle = tiles.filter((t) => t.title !== null && t.title !== '').length;
    out.tilesWithArt = tiles.filter((t) => t.hasImg).length;
    out.tilesWithImgAlt = tiles.filter((t) => t.imgAlt !== null && t.imgAlt !== '').length;
    out.tileIdsWithNoTitle = tiles.filter((t) => t.title === null || t.title === '')
      .map((t) => t.id);
    out.menuFullTextDrawn = drawn(root);
    out.rowsModel = of.buildMenu().rows;

    of.input.act(['build'], 4);
    await sleep(0.5);
    out.menuAfterToggle = { open: of.buildMenu().open, drawn: drawn(root) };
    check('pressing the build key again SHUTS the menu (model)',
      out.menuAfterToggle.open === false, `open=${out.menuAfterToggle.open}`);
    check('the shut menu is no longer drawn', out.menuAfterToggle.drawn === null,
      `drawn=${JSON.stringify((out.menuAfterToggle.drawn || '').slice(0, 60))}`);
    out.ranStage = 'menu';
  }

  if (stage === 'hotbar') {
    out.chrome0 = chrome();
    const bar = document.querySelector('#of-hotbar');
    check('#of-hotbar exists in the DOM', bar !== null, 'querySelector returned null');
    out.barDrawn = drawn(bar);
    check('the hotbar is DRAWN during play', out.barDrawn !== null,
      `drawn=null; display=${bar === null ? 'no element' : getComputedStyle(bar).display}`);
    out.barLive = bar !== null && bar.classList.contains('live');
    out.slots = [...(bar ? bar.querySelectorAll('.of-hslot') : [])].map((s) => ({
      i: s.getAttribute('data-i'),
      cls: s.className,
      drawn: drawn(s),
      num: drawn(s.querySelector('.n')),
      label: drawn(s.querySelector('.tx')),
      title: s.getAttribute('title'),
      hasImg: s.querySelector('img') !== null,
      imgAlt: (s.querySelector('img') || {}).alt || null,
      imgTitle: (s.querySelector('img') || {}).title || null,
    }));
    out.model = of.hotbar();
    out.slotCount = out.slots.length;
    out.modelSlotCount = out.model.slots.length;
    check(`the bar DRAWS every one of the ${out.modelSlotCount} slots the model lists`,
      out.slotCount === out.modelSlotCount,
      `${out.slotCount} of ${out.modelSlotCount} drawn`);
    out.slotsDrawn = out.slots.filter((s) => s.drawn !== null).length;
    check(`every one of ${out.slotCount} drawn slots carries readable text`,
      out.slotsDrawn === out.slotCount, `${out.slotsDrawn} of ${out.slotCount}`);
    out.slotsWithNumber = out.slots.filter((s) => s.num !== null).length;
    check(`every one of ${out.slotCount} slots draws its NUMBER key`,
      out.slotsWithNumber === out.slotCount,
      `${out.slotsWithNumber} of ${out.slotCount}`);
    // RECORDED: a slot shows an icon OR a text label, never both, so how many
    // of them a player can name without hovering is the survey's question.
    out.slotsWithIcon = out.slots.filter((s) => s.hasImg).length;
    out.slotsWithTextLabel = out.slots.filter((s) => s.label !== null).length;
    out.slotsWithTitleAttr = out.slots.filter((s) => s.title !== null && s.title !== '').length;
    out.slotsNameable = out.slots.filter((s) => s.label !== null
      || (s.imgAlt !== null && s.imgAlt !== '')
      || (s.imgTitle !== null && s.imgTitle !== '')
      || (s.title !== null && s.title !== '')).length;

    // Does selecting a slot tell you what you picked up?
    of.hotbar(4);
    await sleep(0.3);
    out.afterSelect = { chrome: chrome(), selected: of.hotbar().selected,
      part: of.hotbar().part, label: of.hotbar().label, ghost: of.build() !== null };
    check('of.hotbar(4) selected slot 4 (fixture for everything below)',
      out.afterSelect.selected === 4, `selected=${out.afterSelect.selected}`);
    const on4 = bar === null ? null : bar.querySelector('.of-hslot.on');
    out.selectedTileDrawn = drawn(on4);
    out.selectedTileIndex = on4 === null ? null : on4.getAttribute('data-i');
    check('the bar marks exactly the selected slot with .on, and it is drawn',
      out.selectedTileDrawn !== null && out.selectedTileIndex === '3',
      `data-i=${JSON.stringify(out.selectedTileIndex)} (slot 4 is index 3), drawn=${JSON.stringify(out.selectedTileDrawn)}`);
    // RECORDED: nothing in the chrome names the thing you just took in hand.
    out.selectNamedOnScreen = out.afterSelect.chrome.toast !== null
      || out.afterSelect.chrome.banner !== null;

    // wheel: does the bar say what the new slot is?
    of.input.wheel(1);
    await sleep(0.3);
    out.afterWheel = { chrome: chrome(), sel: of.hotbar().selected,
      label: of.hotbar().label };
    check('the mouse wheel MOVED the selection off slot 4',
      out.afterWheel.sel !== 4 && typeof out.afterWheel.sel === 'number',
      `selected went 4 -> ${JSON.stringify(out.afterWheel.sel)}`);

    // an EMPTY-ish slot: what does slot 2 (the hand furnace) say?
    of.hotbar(2);
    await sleep(0.3);
    out.slot2 = { chrome: chrome(), label: of.hotbar().label,
      kind: of.hotbar().kind, selected: of.hotbar().selected };
    check('of.hotbar(2) selected slot 2', out.slot2.selected === 2,
      `selected=${out.slot2.selected}`);
    check('slot 2 names itself in the MODEL (the hand furnace)',
      typeof out.slot2.label === 'string' && out.slot2.label !== '',
      `label=${JSON.stringify(out.slot2.label)}, kind=${JSON.stringify(out.slot2.kind)}`);
    out.ranStage = 'hotbar';
  }

  if (stage === 'pack') {
    // THE OLD PROBE QUERIED #of-pack, WHICH HAS NEVER EXISTED. InventoryPanel.ts
    // gives the Tab panel the id `of-panel`; `#of-pack` matched nothing, txt()
    // turned that null into null, and the stage reported `packText: null` as
    // though it were a measurement of an empty panel. It measured a typo.
    out.deadSelectorOfPack = document.querySelector('#of-pack') !== null;
    check('#of-pack (the OLD probe’s selector) matches nothing in this client',
      out.deadSelectorOfPack === false,
      `#of-pack found=${out.deadSelectorOfPack}`);
    const panel = document.querySelector('#of-panel');
    check('#of-panel (the real Tab pack) exists in the DOM', panel !== null,
      'querySelector returned null');
    out.packShutDrawn = drawn(panel);
    check('the pack is NOT drawn before it is opened', out.packShutDrawn === null,
      `drawn=${JSON.stringify((out.packShutDrawn || '').slice(0, 60))}`);

    of.panel(true);
    await sleep(0.7);
    out.packOpen = of.game().panelOpen;
    // FIXTURE FIRST.
    check('of.panel(true) OPENED the pack (model)', out.packOpen === true,
      `game().panelOpen=${JSON.stringify(out.packOpen)}`);
    out.packTextDrawn = drawn(panel);
    check('the open pack is DRAWN', out.packTextDrawn !== null,
      `drawn=null; display=${panel === null ? 'no element' : getComputedStyle(panel).display}`);

    const slots = [...(panel ? panel.querySelectorAll('.of-slot') : [])];
    out.packSlotCount = slots.length;
    out.packSlotsDrawn = slots.filter((s) => drawn(s) !== null).length;
    check('the open pack draws at least one slot', out.packSlotCount > 0,
      `0 of ${out.packSlotCount} slots`);
    check(`every one of ${out.packSlotCount} pack slots is drawn`,
      out.packSlotsDrawn === out.packSlotCount,
      `${out.packSlotsDrawn} of ${out.packSlotCount}`);
    out.packFilled = slots.filter((s) => s.classList.contains('filled')).map((s) => ({
      name: drawn(s.querySelector('.nm')), count: drawn(s.querySelector('.ct')),
      item: s.getAttribute('data-item'), title: s.getAttribute('title'),
    }));
    out.packCountHeading = drawn(panel && panel.querySelector('.pack h3'));
    check('the pack column draws its used/total heading',
      out.packCountHeading !== null,
      `heading drawn=${JSON.stringify(out.packCountHeading)}`);

    const recipes = [...(panel ? panel.querySelectorAll('.of-recipe') : [])];
    out.recipeCount = recipes.length;
    out.recipes = recipes.slice(0, 40).map((r) => ({
      name: drawn(r.querySelector('.nm')),
      ing: drawn(r.querySelector('.ing')),
      lock: drawn(r.querySelector('.lock')),
      cls: r.className,
      button: drawn(r.querySelector('button')),
      disabled: (r.querySelector('button') || {}).disabled === true,
    }));
    check('the pack draws at least one hand-crafting recipe',
      out.recipeCount > 0, `0 of ${out.recipeCount} recipe rows`);
    out.recipesWithDrawnName = out.recipes.filter((r) => r.name !== null).length;
    check(`every one of ${out.recipes.length} drawn recipe rows names itself`,
      out.recipesWithDrawnName === out.recipes.length,
      `${out.recipesWithDrawnName} of ${out.recipes.length}`);
    out.recipesWithDrawnButton = out.recipes.filter((r) => r.button !== null).length;
    check(`every one of ${out.recipes.length} recipe rows draws its Craft button`,
      out.recipesWithDrawnButton === out.recipes.length,
      `${out.recipesWithDrawnButton} of ${out.recipes.length}`);

    out.modeRow = drawn(panel && panel.querySelector('.mode'));
    check('the pack draws the sandbox/survival mode row', out.modeRow !== null,
      `.mode drawn=${JSON.stringify(out.modeRow)}`);
    out.hints = [...(panel ? panel.querySelectorAll('.hint') : [])].map((h) => drawn(h));
    out.hintsDrawn = out.hints.filter((h) => h !== null).length;
    check(`every one of ${out.hints.length} pack hint blocks is drawn`,
      out.hintsDrawn === out.hints.length, `${out.hintsDrawn} of ${out.hints.length}`);

    out.barLiveWithPack = (document.querySelector('#of-hotbar')
      || { classList: { contains: () => null } }).classList.contains('live');
    check('the hotbar goes .live while the pack is open (the panel says it does)',
      out.barLiveWithPack === true, `#of-hotbar.live=${out.barLiveWithPack}`);

    of.panel(false);
    await sleep(0.4);
    out.packAfterClose = { open: of.game().panelOpen, drawn: drawn(panel),
      rawChars: raw(panel) === null ? null : raw(panel).length };
    check('the pack shuts again', out.packAfterClose.open === false,
      `panelOpen=${out.packAfterClose.open}`);
    check('the SHUT pack is not drawn, though raw() still holds its text',
      out.packAfterClose.drawn === null && out.packAfterClose.rawChars > 40,
      `drawn=${JSON.stringify((out.packAfterClose.drawn || '').slice(0, 40))}, rawChars=${out.packAfterClose.rawChars}`);
    out.ranStage = 'pack';
  }

  out.hudTextDrawn = drawn(document.querySelector('#of-hud'));
  out.goalPanelDrawn = drawn(document.querySelector('#of-goals'));
  out.goalPanelRawChars = raw(document.querySelector('#of-goals')) === null ? null
    : raw(document.querySelector('#of-goals')).length;
  out.allUiIds = [...document.querySelectorAll('.of-ui')].map((e) => e.id);
  out.drawnUiIds = [...document.querySelectorAll('.of-ui')]
    .filter((e) => drawn(e) !== null).map((e) => e.id);
  out.endChrome = chrome();
  out.endState = { build: of.buildMenu().open, pause: of.pause().open,
    modals: of.modals().modals.filter((m) => m.open).map((m) => m.name) };
  check('no modal is left open at the end of the stage',
    out.endState.modals.length === 0, `open modals: ${out.endState.modals.join(', ')}`);

  // A STAGE THAT REPORTS NOTHING MAY NOT HAVE RUN. `ranStage` is set by the
  // stage body's last line and nowhere else.
  check(`the '${stage}' stage body ran to its end`, out.ranStage === stage,
    `out.ranStage=${JSON.stringify(out.ranStage)}`);

  if (OF_ARGS && OF_ARGS.shot) {
    await of.settle(6);
    const blob = await of.screenshot();
    out.png = await new Promise((res) => {
      const r = new FileReader();
      r.onload = () => res(r.result);
      r.readAsDataURL(blob);
    });
  }
  return finish(out);
})()
