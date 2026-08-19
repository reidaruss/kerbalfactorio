// qolbuild3.js: QOL SURVEY, stage 3. DEMOLITION, machine scale, and the VAB.
// --evalargs={"stage":"demolish"|"scale"|"vab"|"vabinsert"}
//
//   node tools/smoke/run.mjs --scenario=walk --sandbox=1 \
//        --evalfile=tools/smoke/probes/qolbuild3.js
//
// BT-190: this probe never carried a real invocation; `extractCmd()`'s old
// first-match rule took a prose line further down ("GP-401. EVERY STAGE
// ASSERTS AND A FAILED ASSERTION THROWS, because a returned `fails: [...]`
// or `valid:false` exits 0 and run.mjs prints `smoke: PASS`...") as the
// command, which held zero real flags, so every prior sweep ran this at the
// runner's bare defaults. `--sandbox=1` matches `qolbuild1.js`/
// `qolbuild2.js`, the rest of this same three-part survey, for the same
// reason: the `vab`/`vabinsert` stages build from the full part catalogue.
//
// GP-401. EVERY STAGE ASSERTS. A returned `fails: [...]` or `valid:false`
// exits 0 and run.mjs prints `smoke: PASS` for a standalone run: the runner
// only fails a run on console errors and failed requests.
//
// AMENDED BT-270 to BT-274: a failed assertion used to THROW, because a throw
// rejects page.evaluate, which is the one signal that reaches a standalone
// run's exit code. That never accounted for the SWEEP: `probeall.mjs`'s
// audit found `run.mjs`'s try/catch drops the ENTIRE report on a
// page.evaluate throw, not just the eval field, so a correctly-diagnosed RED
// here read as NO_OUTPUT, indistinguishable from a hard crash (qolbuild2.js's
// "press aimed at the SKY places nothing" finding, BT-260 to BT-264, was
// exactly this). `finish` now RETURNS `{ fails, valid: fails.length === 0,
// log }` instead; the standalone-run exit-code honesty is kept the same way
// qolbuild2.js keeps it, every failure also gets its own `console.error`
// line, which fails a standalone run's own exit code independent of the
// returned report.
//
// `scale` was DEAD before this pass. It read `of.game().factory.tileM` and
// swallowed the miss with `?? null`: the client has never published `tileM`, so
// the stage's headline number was `null` in every green run and nothing said
// so. The published machine size is `factory.footprint`, a per-kind tile count,
// and it is read here through `mustNum` (the runner's own prelude guard) so
// that if it is ever renamed the stage FAILS BY NAME instead of reporting null.
(async () => {
  const of = window.__of;
  // A THROW, not `return {valid:false}`: a returned flag exits 0 and prints PASS.
  if (!of) throw new Error('probe: window.__of is missing, the client did not boot');
  const sleep = (n) => of.run(n);
  const stage = (OF_ARGS && OF_ARGS.stage) || 'demolish';

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
    // Each failure ALSO on its own console.error line (kept from the old
    // throwing version, BT-270 to BT-274): run.mjs fails a standalone run's
    // own exit code on any page console.error, independent of what's in the
    // returned report, so `node run.mjs ... qolbuild3.js` by hand still
    // prints `smoke: FAILURES` and exits non-zero when a check fails.
    for (const f of fails) console.error(`probe FAIL: ${f}`);
    // RETURNED, NOT THROWN: a throw here drops the whole report before
    // run.mjs ever prints it, so the sweep read every real failure here as
    // indistinguishable from a crash. `fails: [...]` is verdictOf()'s
    // convention 1, so a non-empty array is read as a real RED verdict with
    // every failing check's name intact instead of NO_OUTPUT with none.
    return { ...out, valid: fails.length === 0, fails, log };
  };

  // Every HUD channel read BOTH ways at the same instant. A `*RawOnly` twin
  // appears only when the element holds text that is NOT on screen, i.e.
  // exactly the string the old `txt()` would have reported as though it were.
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

  const out = { probe: 'qolbuild3', stage, sandbox: of.sandbox().sandbox };
  const STAGES = ['demolish', 'scale', 'vab', 'vabinsert'];
  check(`'${stage}' is a stage this probe implements`, STAGES.indexOf(stage) !== -1,
    `not one of ${STAGES.join(' | ')}`);

  const press = async (f) => {
    of.input.tape([{ hold: f || 4, actions: ['use'] }, { hold: 8, keys: [] }]);
    await sleep(0.35);
  };
  const yaw0 = () => of.world().observer.yawDeg;
  const aimAt = async (want) => {
    for (let p = -75; p <= -5; p += 3) {
      of.look(yaw0(), p);
      await sleep(0.06);
      if (want()) return p;
    }
    return null;
  };
  /** Sweep yaw x pitch. Returns {yaw,pitch,tried}; yaw is null when nothing hit. */
  const sweepFor = async (want, yaws, pitches) => {
    const y0 = yaw0();
    let tried = 0;
    for (const dy of (yaws || [0, 40, 80, 120, 160, 200, 240, 280, 320])) {
      for (const p of (pitches || [-75, -65, -55, -50, -45, -40, -35, -30, -25, -20, -15])) {
        of.look((y0 + dy + 360) % 360, p);
        await sleep(0.05);
        tried += 1;
        if (want()) return { yaw: (y0 + dy + 360) % 360, pitch: p, tried };
      }
    }
    return { yaw: null, pitch: null, tried };
  };

  await sleep(0.9);

  // ---- INSTRUMENT SELF-TEST, every run ------------------------------------
  // #of-panel (the Tab pack) is always in the DOM and `display:none` until it
  // gains `.open` (styles/game.css), so shut it must satisfy both halves at
  // once: raw() still returns its hint sentences and drawn() returns null.
  {
    const p = document.querySelector('#of-panel');
    out.instrument = {
      selector: '#of-panel',
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

  if (stage === 'scale') {
    // How big is a machine next to the player, and does placing it put the
    // player INSIDE it?
    const feet = () => of.world().player.feet;
    const f0 = feet().slice();
    of.hotbar(5);
    await sleep(0.4);
    check('slot 5 puts a SMELTER in hand (fixture)', of.hotbar().part === 'smelter',
      `hotbar().part=${JSON.stringify(of.hotbar().part)}`);
    const site = await sweepFor(() => {
      const g = of.build().ghost;
      return g !== null && g.ok === true;
    });
    out.smelterSite = site;
    check('found an aim at which the smelter is PLACEABLE (fixture)',
      site.yaw !== null,
      `no ok=true ghost in ${site.tried} of ${site.tried} yaw x pitch samples`);
    const g = of.build().ghost;
    check('a ghost is published at the chosen aim (fixture)', g !== null,
      'of.build().ghost is null');
    out.ghostDistM = g === null ? null
      : Math.round(Math.hypot(g.pos[0] - f0[0], g.pos[1] - f0[1],
        g.pos[2] - f0[2]) * 100) / 100;
    out.ghostFootprint = g === null ? null : g.footprint;
    // THE DEAD READ, FIXED. `factory.tileM` has never existed; the old line
    // `of.game().factory.tileM ?? null` turned that into a null the report then
    // printed as a measurement. `factory.footprint` is the published per-kind
    // size, and `mustNum` makes a rename a NAMED THROW rather than a null.
    out.factoryKeys = Object.keys(of.game().factory);
    out.deadReadFactoryTileM = 'tileM' in of.game().factory;
    check('of.game().factory.tileM (the OLD probe’s read) is not a published key',
      out.deadReadFactoryTileM === false,
      `'tileM' in factory = ${out.deadReadFactoryTileM}`);
    const fp = mustHave(of.game().factory, 'footprint', 'of.game().factory');
    out.footprintTable = fp;
    out.smelterFootprintTiles = mustNum(fp, 'smelter', 'factory.footprint');
    out.assemblerFootprintTiles = mustNum(fp, 'assembler', 'factory.footprint');
    out.beltFootprintTiles = mustNum(fp, 'belt', 'factory.footprint');
    check('the smelter footprint the GHOST reports equals the one the factory publishes',
      out.ghostFootprint === out.smelterFootprintTiles,
      `ghost.footprint=${out.ghostFootprint} vs factory.footprint.smelter=${out.smelterFootprintTiles}`);
    check('an assembler is published as LARGER than a belt',
      out.assemblerFootprintTiles > out.beltFootprintTiles,
      `assembler=${out.assemblerFootprintTiles}, belt=${out.beltFootprintTiles}`);

    const b0 = of.game().factory.buildings;
    await press(4);
    // THE TOAST IS SAMPLED HERE, not after the settle below. GameHud.flash
    // gives a message 1.4 s and the first version of this stage read the HUD
    // after an extra 0.6 s of settling: the check failed with
    // `drawn=null; raw-only="placed smelter"`, which is the whole point of the
    // instrument. A message the probe has to hurry to catch is still a message
    // the player saw, so the reading moves rather than the claim.
    out.chromeAtPress = chrome();
    out.placementSaid = out.chromeAtPress.toast;
    check('placing a smelter is SAID OUT LOUD (drawn toast, sampled at the press)',
      out.placementSaid !== null,
      `#of-toast drawn=null; raw-only=${JSON.stringify(out.chromeAtPress.toastRawOnly)}`);
    await sleep(0.6);
    out.placedDelta = of.game().factory.buildings - b0;
    check('the smelter went down', out.placedDelta >= 1,
      `${out.placedDelta} buildings added`);
    const w = of.world().player;
    out.after = { blockedByBuild: w.blockedByBuild, onDeck: w.onDeck,
      structureTests: w.structureTests, chrome: chrome() };
    // RECORDED: the same toast a moment later. Its `toastRawOnly` twin is the
    // string the old txt() would have reported as drawn for the rest of the run.
    out.toastAfterSettle = out.after.chrome.toast;
    out.toastRawAfterSettle = out.after.chrome.toastRawOnly;
    // Walk forward into it and see whether anything says so
    of.input.tape([{ hold: 60, actions: ['forward'] }, { hold: 4, keys: [] }]);
    await sleep(1.6);
    const w2 = of.world().player;
    out.afterWalk = { blockedByBuild: w2.blockedByBuild,
      movedM: Math.round(Math.hypot(w2.feet[0] - f0[0], w2.feet[1] - f0[1],
        w2.feet[2] - f0[2]) * 100) / 100, chrome: chrome() };
    check('the player is not standing INSIDE the machine they just placed',
      out.afterWalk.blockedByBuild !== null && out.afterWalk.blockedByBuild !== undefined,
      `world().player.blockedByBuild=${JSON.stringify(out.afterWalk.blockedByBuild)}`);
    // RECORDED: whether walking into a machine says anything at all.
    out.walkIntoMachineSaid = out.afterWalk.chrome.toast;
    out.ranStage = 'scale';
  }

  if (stage === 'demolish') {
    // Build three things, then remove them three ways and record EVERY word.
    of.hotbar(4);
    await sleep(0.4);
    check('slot 4 puts a BELT in hand (fixture)', of.hotbar().part === 'belt',
      `hotbar().part=${JSON.stringify(of.hotbar().part)}`);
    of.look(yaw0(), -50);
    await sleep(0.3);
    // a run of belts, so there is plenty to remove
    of.input.tape([{ hold: 70, actions: ['use', 'forward'] }, { hold: 6, keys: [] }]);
    await sleep(2.0);
    out.builtFactory = of.game().factory.buildings;
    out.dem0 = of.game().demolition;
    check('the build phase left at least one factory building to remove (fixture)',
      out.builtFactory > 0, `${out.builtFactory} of ${out.builtFactory} buildings exist`);

    // 1. X with a PART in hand: does it demolish, or place?
    of.hotbar(4);
    await sleep(0.3);
    const b0 = of.game().factory.buildings;
    const aim1 = await sweepFor(() => of.game().aimed.build !== null,
      [0, 355, 5, 350, 10, 345, 15, 340, 20, 330, 30, 320, 40, 300, 60, 270, 90,
        180, 200, 160]);
    out.aimedForX = { aimed: of.game().aimed, tried: aim1.tried, yaw: aim1.yaw };
    check(`bare aim REACHED a placed building for the X test (fixture, ${aim1.tried} samples)`,
      aim1.yaw !== null,
      `no aim in ${aim1.tried} of ${aim1.tried} samples put game().aimed.build non-null`);
    of.input.act(['demolish'], 4);
    await sleep(0.6);
    out.xWithPartInHand = { buildings: of.game().factory.buildings,
      delta: of.game().factory.buildings - b0, chrome: chrome(),
      demolition: of.game().demolition };
    check('X with a part in hand does not silently BUILD something',
      out.xWithPartInHand.delta <= 0,
      `factory buildings went ${b0} -> ${out.xWithPartInHand.buildings}`);

    // 2. Mouse2 by REFLEX. Bound to `demolish`. Fire it as a real DOM event
    //    on the canvas, which is what a right-click actually is.
    // THE BIG canvas: the icon baker keeps small hidden ones and
    // querySelector('canvas') hands back whichever is first in the DOM.
    const cvs = [...document.querySelectorAll('canvas')];
    out.canvases = cvs.map((c) => `${c.width}x${c.height}`);
    let cv = null;
    for (const c of cvs) {
      if (cv === null || c.width * c.height > cv.width * cv.height) cv = c;
    }
    out.canvasPicked = cv === null ? null : `${cv.width}x${cv.height}`;
    check('the biggest canvas was found to dispatch a real right-click at (fixture)',
      cv !== null, `${cvs.length} of ${cvs.length} canvases, none pickable`);
    const b1 = of.game().factory.buildings;
    const aim2 = await sweepFor(() => of.game().aimed.build !== null,
      [0, 355, 5, 350, 10, 345, 15, 340, 20, 330, 30, 320, 40, 300, 60, 270, 90,
        180, 200, 160]);
    out.aimedForMouse2 = { aimed: of.game().aimed, tried: aim2.tried, yaw: aim2.yaw };
    if (cv !== null) {
      const o = { bubbles: true, pointerId: 1, pointerType: 'mouse' };
      cv.dispatchEvent(new PointerEvent('pointerdown',
        { ...o, button: 2, buttons: 2 }));
      await sleep(0.25);
      cv.dispatchEvent(new PointerEvent('pointerup',
        { ...o, button: 2, buttons: 0 }));
    }
    await sleep(0.5);
    out.mouse2dom = { buildings: of.game().factory.buildings,
      delta: of.game().factory.buildings - b1, chrome: chrome() };
    // AND the raw key code, which is what the binding table says Mouse2 is.
    const b1b = of.game().factory.buildings;
    const aim3 = await sweepFor(() => of.game().aimed.build !== null,
      [0, 355, 5, 350, 10, 345, 15, 340, 20, 330, 30, 320, 40, 300, 60, 270, 90,
        180, 200, 160]);
    out.aimedForMouse2Code = { tried: aim3.tried, yaw: aim3.yaw };
    of.input.tape([{ hold: 4, keys: ['Mouse2'] }, { hold: 8, keys: [] }]);
    await sleep(0.6);
    out.mouse2code = { buildings: of.game().factory.buildings,
      delta: of.game().factory.buildings - b1b, chrome: chrome() };
    out.mouse2 = { buildings: of.game().factory.buildings,
      delta: of.game().factory.buildings - b1, chrome: chrome(),
      demolition: of.game().demolition };
    // RECORDED, NOT ASSERTED: whether a right-click by reflex removes anything
    // is the survey's QUESTION, and the two routes are reported separately so
    // "the DOM event is inert but the key code works" stays visible.
    out.rightClickRemovedViaDom = out.mouse2dom.delta;
    out.rightClickRemovedViaKeyCode = out.mouse2code.delta;

    // 3. The X key on a STRUCTURE. Is there a confirm? A refund?
    of.hotbar(6);
    await sleep(0.4);
    check('slot 6 puts a FOUNDATION in hand (fixture)', of.hotbar().part === 'foundation',
      `hotbar().part=${JSON.stringify(of.hotbar().part)}`);
    const psite = await sweepFor(() => {
      const g = of.build().structGhost;
      return g !== null && g.ok === true;
    });
    out.structureSite = psite;
    check('found an aim at which a foundation is PLACEABLE (fixture)',
      psite.yaw !== null,
      `no ok=true structGhost in ${psite.tried} of ${psite.tried} samples`);
    const sp0 = of.game().structures.parts.length;
    await press(4);
    out.builtStructures = of.game().structures.parts.length;
    check('a foundation went down for the X-on-structure test (fixture)',
      out.builtStructures > sp0, `${out.builtStructures - sp0} parts placed`);
    of.hotbar(1);
    await sleep(0.3);
    const s0 = of.game().structures.parts.length;
    const carried0 = of.game().carried;
    // A FULL yaw x pitch sweep, not the pitch-only `aimAt`. The first version
    // used the pitch-only helper and FAILED: "no pitch in the -75..-5 sweep put
    // game().aimed.part non-null", because by this point the belt drag has
    // walked the player and the foundation is no longer straight ahead.
    const paim = await sweepFor(() => of.game().aimed.part !== null,
      [0, 355, 5, 350, 10, 345, 15, 340, 20, 330, 30, 320, 40, 300, 60, 270, 90,
        240, 120, 210, 150, 180]);
    out.aimedPart = { aimed: of.game().aimed, yaw: paim.yaw, pitch: paim.pitch,
      tried: paim.tried };
    check(`bare aim REACHED the placed structure part (fixture, ${paim.tried} samples)`,
      paim.yaw !== null,
      `no aim in ${paim.tried} of ${paim.tried} yaw x pitch samples put game().aimed.part non-null`);
    of.input.act(['demolish'], 4);
    await sleep(0.4);
    out.xOnStructure = { parts: of.game().structures.parts.length,
      delta: of.game().structures.parts.length - s0,
      carriedBefore: carried0, carriedAfter: of.game().carried,
      chrome: chrome(), demolition: of.game().demolition,
      modals: of.modals().modals.filter((m) => m.open).map((m) => m.name) };
    if (paim.yaw !== null) {
      check('X on an aimed structure part REMOVED it',
        out.xOnStructure.delta < 0,
        `parts went ${s0} -> ${out.xOnStructure.parts} (delta ${out.xOnStructure.delta})`);
      out.structureRemovalSaid = out.xOnStructure.chrome.toast;
      check('the removal is SAID OUT LOUD (drawn toast)',
        out.structureRemovalSaid !== null,
        `#of-toast drawn=null; raw-only=${JSON.stringify(out.xOnStructure.chrome.toastRawOnly)}`);
      // RECORDED: whether a removal asks first, and whether anything came back.
      out.removalAskedFirst = out.xOnStructure.modals.length > 0;
    }

    // 4. Held X: how many does one hold remove?
    const h0 = of.game().factory.buildings + of.game().structures.parts.length;
    of.input.tape([{ hold: 60, actions: ['demolish'] }, { hold: 4, keys: [] }]);
    await sleep(1.6);
    out.heldX = { buildings: of.game().factory.buildings,
      parts: of.game().structures.parts.length,
      removed: h0 - (of.game().factory.buildings + of.game().structures.parts.length),
      demolition: of.game().demolition, chrome: chrome() };
    out.refundTextDrawn = drawn(document.querySelector('#of-gain'));
    out.refundTextRaw = raw(document.querySelector('#of-gain'));
    out.ranStage = 'demolish';
  }

  if (stage === 'vab') {
    out.before = { modals: of.modals().modals.filter((m) => m.open)
      .map((m) => m.name), chrome: chrome() };
    const rootShut = document.querySelector('#of-vab');
    check('#of-vab exists in the DOM before the key is pressed', rootShut !== null,
      'querySelector returned null');
    out.vabShutDrawn = drawn(rootShut);
    check('the VAB is NOT drawn before the assembly key',
      out.vabShutDrawn === null,
      `drawn=${JSON.stringify((out.vabShutDrawn || '').slice(0, 60))}`);

    of.input.act(['assembly'], 4);
    await sleep(1.2);
    const r = of.vab();
    out.report = r;
    // FIXTURE FIRST: nothing below means anything unless the bay actually opened.
    check('of.vab() answers rather than erroring (fixture)',
      r !== null && r !== undefined && r.error === undefined,
      `vab()=${JSON.stringify(r && r.error ? r.error : typeof r)}`);
    const root = document.querySelector('#of-vab');
    out.vabDrawn = drawn(root);
    out.vabRawChars = raw(root) === null ? null : raw(root).length;
    check('THE VAB IS DRAWN after the assembly key',
      out.vabDrawn !== null,
      `#of-vab drawn=null; display=${root === null ? 'no element'
        : getComputedStyle(root).display}; rawChars=${out.vabRawChars}`);
    out.tabs = of.vab('tabs');
    out.catalogue = of.vab('catalogue');
    out.line = of.vab('line');
    out.verdictBand = of.vab('verdictBand');
    out.floor = of.vab('floor');
    out.cam = of.vab('orbit', 35, -20);
    out.vabNameDrawn = drawn(document.querySelector('#of-vab-name'));
    out.vabAltDrawn = drawn(document.querySelector('#of-vd-alt'));
    out.vabIncDrawn = drawn(document.querySelector('#of-vd-inc'));

    const controls = root === null ? []
      : [...root.querySelectorAll('button, [data-vab]')].slice(0, 80);
    out.controlCount = controls.length;
    out.buttons = controls.map((e) => ({ drawn: drawn(e), raw: raw(e),
      v: e.getAttribute('data-vab'), n: e.getAttribute('data-name'),
      title: e.getAttribute('title'), dis: e.disabled === true }));
    check('the VAB draws at least one control', out.controlCount > 0,
      `0 of ${out.controlCount} button/[data-vab] elements under #of-vab`);
    out.controlsDrawn = out.buttons.filter((b) => b.drawn !== null).length;
    out.controlsPresentButNotDrawn = out.buttons
      .filter((b) => b.drawn === null && b.raw !== null && b.raw !== '')
      .map((b) => ({ raw: b.raw, v: b.v, n: b.n }));
    out.controlsWithNoTextAtAll = out.buttons
      .filter((b) => (b.raw === null || b.raw === '')
        && (b.title === null || b.title === ''))
      .map((b) => ({ v: b.v, n: b.n }));
    // RECORDED: a control with no text and no title is a button a player cannot
    // name. The number is a finding, not a claim, so it is not asserted.
    out.namelessControlCount = out.controlsWithNoTextAtAll.length;
    // ASSERTED: the tabs that ARE drawn carry readable text.
    const tabEls = root === null ? [] : [...root.querySelectorAll('[data-vab="tab"]')];
    out.tabCount = tabEls.length;
    out.tabsDrawn = tabEls.filter((e) => drawn(e) !== null).length;
    if (out.tabCount > 0) {
      check(`every one of ${out.tabCount} VAB tabs is drawn and named`,
        out.tabsDrawn === out.tabCount, `${out.tabsDrawn} of ${out.tabCount}`);
    }
    out.ranStage = 'vab';
  }

  if (stage === 'vabinsert') {
    of.input.act(['assembly'], 4);
    await sleep(1.2);
    const root = document.querySelector('#of-vab');
    check('THE VAB IS DRAWN after the assembly key (fixture)', drawn(root) !== null,
      `#of-vab drawn=null; display=${root === null ? 'no element'
        : getComputedStyle(root).display}`);
    // Take the first catalogue part and place it, counting the gestures.
    //
    // BOTH SHAPES HERE ARE WHAT THE CLIENT ACTUALLY RETURNS, not what the old
    // probe guessed. `of.vab('catalogue')` returns an ARRAY of rows, and the
    // old `cat.parts || cat.rows || []` therefore evaluated to `[]` on a
    // catalogue with fifteen parts in it and the stage reported an empty one.
    // `of.vab().parts` is likewise an ARRAY of placed parts, not a count, so
    // the old `parts0 < parts1` compared two arrays with `<` (always false)
    // and, since the stage asserted nothing, said nothing about it.
    const cat = of.vab('catalogue');
    const catRows = Array.isArray(cat) ? cat : ((cat && (cat.parts || cat.rows)) || []);
    const partCount = () => {
      const p = (of.vab() || {}).parts;
      return Array.isArray(p) ? p.length : (typeof p === 'number' ? p : null);
    };
    out.catalogueRowCount = catRows.length;
    out.catalogueIds = catRows.slice(0, 20).map((r) => ({ index: r.index,
      id: r.id, name: r.name }));
    check('the VAB catalogue offers at least one part (fixture)',
      catRows.length > 0,
      `0 of ${catRows.length} catalogue entries; catalogue=${JSON.stringify(cat).slice(0, 200)}`);
    out.catalogueNamed = catRows.filter((r) => typeof r.name === 'string' && r.name !== '').length;
    check(`every one of ${catRows.length} catalogue rows carries a NAME`,
      out.catalogueNamed === catRows.length,
      `${out.catalogueNamed} of ${catRows.length} named`);
    const first = of.vab('take', 0);
    out.tookFirst = { holding: first && first.holding, error: first && first.error,
      line: of.vab('line') };
    check('taking catalogue part 0 did not error (fixture)',
      first !== null && first.error === undefined,
      `take(0) returned ${JSON.stringify(first && first.error)}`);
    out.nodes0 = Array.isArray(of.vab('nodes')) ? of.vab('nodes').length : null;
    const placed0 = partCount();
    out.placed0 = placed0;
    out.place0 = of.vab('place');
    out.afterFirst = { parts: partCount(), line: of.vab('line'),
      verdict: of.vab('verdictBand') };
    check('placing the first part increased the VAB part COUNT',
      out.afterFirst.parts !== null && placed0 !== null
        && out.afterFirst.parts > placed0,
      `parts ${JSON.stringify(placed0)} -> ${JSON.stringify(out.afterFirst.parts)}; `
      + `place() said ${JSON.stringify(out.place0 && out.place0.ok)}`);
    out.lineAfterFirstDrawn = drawn(root && root.querySelector('.msg'));
    // second part, snapped
    of.vab('take', 1);
    const ns = of.vab('nodes');
    out.nodeCount = Array.isArray(ns) ? ns.length : null;
    check('the bay offers at least one snap node for the second part',
      out.nodeCount !== null && out.nodeCount > 0,
      `nodes()=${Array.isArray(ns) ? `${ns.length} of ${ns.length}` : JSON.stringify(ns)}`);
    if (Array.isArray(ns) && ns.length > 0) {
      const n = ns[0];
      out.hover = of.vab('hover', n.ndcX ?? n.x ?? 0, n.ndcY ?? n.y ?? 0);
    }
    const before1 = partCount();
    out.place1 = of.vab('place');
    out.afterSecond = { parts: partCount(), line: of.vab('line'),
      verdict: of.vab('verdictBand') };
    check('placing the second part increased the VAB part COUNT again',
      out.afterSecond.parts !== null && out.afterSecond.parts > before1,
      `parts ${JSON.stringify(before1)} -> ${JSON.stringify(out.afterSecond.parts)}; `
      + `place() said ${JSON.stringify(out.place1 && out.place1.ok)}`);
    out.gaps = of.vab('gaps');

    // INSERT INTO A JOINT (GP-293). The old call was `of.vab('insert', 0, 1)`
    // and it was wrong TWICE: `0` is the top of the stack, which has no joint
    // under it ("that is the top of the stack, so nothing is between it and
    // anything"), and `1` is not a PartId at all (real ids start at 256). It
    // returned ok:false every run and the stage asserted nothing about it.
    // `a` is the index of the part SITTING ON the joint and `b` is the arriving
    // PartId, so both come from the live design and the live catalogue.
    const beforeInsert = partCount();
    const arriving = catRows[2] !== undefined ? catRows[2].id : catRows[0].id;
    out.insertArgs = { childIndex: 1, partId: arriving };
    out.insert = of.vab('insert', 1, arriving);
    out.afterInsert = { parts: partCount(), line: of.vab('line'),
      ok: out.insert && out.insert.ok, why: out.insert && out.insert.why };
    out.insertDelta = out.afterInsert.parts === null || beforeInsert === null ? null
      : out.afterInsert.parts - beforeInsert;
    check('inserting a real PartId at a real joint index ADDS a part to the stack',
      out.insert !== null && out.insert.ok === true && out.insertDelta === 1,
      `insert(1, ${arriving}) said ok=${JSON.stringify(out.insert && out.insert.ok)} `
      + `why=${JSON.stringify(out.insert && out.insert.why)}; parts `
      + `${JSON.stringify(beforeInsert)} -> ${JSON.stringify(out.afterInsert.parts)}`);

    // REMOVE. `removeAt` takes a HANDLE, not an array index (Vab.ts line 377).
    // The old `of.vab('remove', 1)` passed an index; the live handles here are
    // 3, 4, 5..., so it found nothing, returned false and removed nothing, and
    // the stage went green anyway.
    const live = ((of.vab() || {}).parts) || [];
    out.liveHandles = live.map((p) => ({ handle: p.handle, partId: p.partId,
      parent: p.parent }));
    const leaf = live[live.length - 1];
    check('the design publishes a part with a handle to remove (fixture)',
      leaf !== undefined && typeof leaf.handle === 'number',
      `${live.length} of ${live.length} parts, leaf=${JSON.stringify(leaf)}`);
    const beforeRemove = partCount();
    out.removeHandle = leaf === undefined ? null : leaf.handle;
    out.remove = leaf === undefined ? null : of.vab('remove', leaf.handle);
    out.afterRemove = { parts: partCount(), line: of.vab('line') };
    check(`remove(handle ${out.removeHandle}) took a part back off the stack`,
      out.afterRemove.parts !== null && out.afterRemove.parts < beforeRemove,
      `parts ${JSON.stringify(beforeRemove)} -> ${JSON.stringify(out.afterRemove.parts)}; `
      + `remove() said ${JSON.stringify(out.remove && out.remove.ok)}`);
    out.rollout = of.vab('rollout');
    out.verdict = of.vab('verdict');
    out.vabDrawn = drawn(root);
    out.vabLineDrawn = out.afterRemove.line;
    check('the VAB is STILL drawn at the end of the stage', out.vabDrawn !== null,
      '#of-vab drawn=null');
    out.ranStage = 'vabinsert';
  }

  out.endChrome = chrome();
  // A STAGE THAT REPORTS NOTHING MAY NOT HAVE RUN. `ranStage` is set by the
  // stage body's last line and nowhere else.
  check(`the '${stage}' stage body ran to its end`, out.ranStage === stage,
    `out.ranStage=${JSON.stringify(out.ranStage)}`);
  return finish(out);
})()
