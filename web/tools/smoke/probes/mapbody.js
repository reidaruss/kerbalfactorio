// mapbody.js: GP-650 to GP-654. THE MAP IS OF THE BODY YOU ARE ON, AND EVERY
// ORBIT ON IT IS MEASURED AGAINST THE BODY IT ACTUALLY GOES ROUND.
//
//   node tools/smoke/run.mjs --url=http://127.0.0.1:PORT/ --sandbox=1 \
//     --width=320 --height=200 --evalfile=tools/smoke/probes/mapbody.js
//
// THE BUG REPORT THIS EXISTS FOR, Reid's words, on a real GPU: "teleport to the
// moon, open the map: it acts as if the space station is in orbit around the
// MOON and the planet is not visible", and the panel read AP / PE 800.0 / 800.0
// km there against 400.0 / 400.0 km at home. One conic, two answers, and the
// difference is exactly the difference between the two bodies' radii.
//
// THE ROUTE IS `of.reboot`, WHICH IS THE ONLY IN-PAGE BODY SWITCH THIS CLIENT
// HAS (CE-20). The cheat menu's door is a page reload (`VisitWorlds.ts` argues
// why, and `worldjump.mjs` drives it), so it destroys the context that would
// report on it; `of.reboot` swaps the body under a running client, which is the
// harsher case and the one a probe can watch. Both halves of Reid's report are
// reachable through it and both were measured on it before the fix:
// `globeRadiusUnits` 5.937 on Forge and 5.937 after `of.reboot(1)`, and
// `focus.options` still `["you","Forge"]` while standing on Cinder.
//
// EVERY EXPECTED NUMBER IS DERIVED FROM THE RECORD AND THE LIVE BODY, NEVER
// TYPED. `a`, `e` come off `of.flight('vessels')`, the radius off
// `of.world().bodyRadiusM` (Services' live body, which is what `of.life()`
// grades every stale holder against), and the altitude is computed here. A
// literal 400000 would pass just as happily against a client that had stopped
// reading the record at all.
//
// AND THE NEGATIVE CONTROL IS COMPUTED, NOT RESURRECTED. Phase 2 works out what
// the OLD arithmetic would have produced on Cinder -- `a(1+e)` minus CINDER's
// radius, i.e. the 800 km Reid photographed -- proves the two answers are
// hundreds of kilometres apart, and only then asserts the panel shows the right
// one. Without that step "the panel says 400 km" is compatible with a panel
// that says 400 km because it cannot count.
//
// THE POSITIVE HALF IS ASSERTED TOO, in phase 1 and again in phase 3: on the
// body it belongs to, Anchorage IS drawn, as a marker and as a closed rails
// line. A probe that only ever asserted absence would go green against a map
// that had stopped drawing anything at all.
(async () => {
  const of = window.__of;
  if (!of) return { valid: false, why: 'no __of' };
  for (const k of ['run', 'reboot', 'world', 'map', 'flight', 'input']) {
    if (typeof of[k] !== 'function' && typeof of[k] !== 'object') {
      return { valid: false, why: `no of.${k}` };
    }
  }
  const fails = [];
  const notes = {};
  const check = (name, ok, detail) => {
    if (!ok) fails.push(detail === undefined ? name : `${name}: ${detail}`);
    return ok;
  };
  // 15 Hz: this probe reads published state, never pixels, so the frames only
  // have to happen. Standing rule from the concurrency budget.
  const settle = (s) => of.run(s, 15);

  /** The station's record, straight from the registry (PH-64's one answer). */
  const stationRec = () => {
    const list = mustHave(of.flight('vessels'), 'list', 'flight(vessels)');
    return list.find((r) => r.status === 'station:anchorage')
      ?? list.find((r) => r.name === 'Anchorage') ?? null;
  };
  // THE PLAYER'S OWN KEY, read off the binding table and dispatched as a real
  // KeyboardEvent, exactly as `map3d.js` does it. `of.input.act('map')` is NOT
  // a door a player has and, measured, does not open the map at all: a first
  // draft of this probe used it and every 3D assertion below read a scene that
  // had never painted a frame. The `frames > 0` fixture is what caught it.
  const mapCode = (of.input.bindings().map || [])[0];
  if (!mapCode) return { valid: false, why: 'no map binding' };
  const pressM = () => window.dispatchEvent(
    new KeyboardEvent('keydown', { code: mapCode, bubbles: true }));

  /** Open the map and leave it open, with the picture PROVEN to have painted. */
  const openMap = async (phase) => {
    if (of.map('report').open !== true) pressM();
    await settle(0.6);
    const r = of.map('report');
    check(`${phase}: the map opened`, r.open === true, JSON.stringify(r.open));
    // A scene that never ran a frame publishes last frame's numbers, or zeros,
    // and every assertion below it would be about nothing (INSTRUMENTS.md).
    check(`${phase}: the 3D picture painted`,
      mustNum(mustHave(r, 'three', 'map report'), 'frames', 'three') > 0);
    return r;
  };
  const closeMap = async () => {
    if (of.map('report').open === true) pressM();
    await settle(0.4);
  };
  /** The row the PANEL is handed for the station, and the map's own body. */
  const panel = () => {
    const v = of.map('vessels');
    const rows = mustHave(v, 'vessels', 'map(vessels)');
    return { body: mustHave(v, 'body', 'map(vessels)'),
             row: rows.find((r) => r.name === 'Anchorage') ?? null };
  };

  // ==========================================================================
  // PHASE 0. THE FIXTURE, on Forge, before anything is switched.
  // ==========================================================================
  await settle(1.5);
  const R_FORGE = mustNum(of.world(), 'bodyRadiusM', 'world()');
  const rec = stationRec();
  if (rec === null) {
    return { valid: false, why: 'no station record: this probe needs Anchorage '
      + '(do not pass ?station=0)' };
  }
  const conic = mustHave(rec, 'conic', 'station record');
  const A = mustNum(conic, 'a', 'conic');
  const E = mustNum(conic, 'e', 'conic');
  check('FIXTURE: the station is on a real conic', A > R_FORGE,
    `a ${A} against R ${R_FORGE}`);
  // THE TRUTH, derived from the record's own elements and Forge's own radius.
  const AP_TRUE = A * (1 + E) - R_FORGE;
  const PE_TRUE = A * (1 - E) - R_FORGE;
  notes.forge = { radiusM: R_FORGE, a: A, e: E, apM: AP_TRUE, peM: PE_TRUE };

  const p0 = await openMap('phase 0');
  const g0 = mustNum(p0.three, 'globeRadiusUnits', 'three');
  check('phase 0: the map is of Forge', p0.three.globeBodyId === 0,
    `globeBodyId ${p0.three.globeBodyId}`);
  const b0 = panel();
  check('phase 0: the map body port is the live body',
    mustNum(b0.body, 'radiusM', 'map body') === R_FORGE,
    `${b0.body.radiusM} against ${R_FORGE}`);
  check('phase 0: there is a panel row for Anchorage', b0.row !== null);
  if (b0.row !== null) {
    check('phase 0: AP is the record against FORGE',
      Math.abs(mustNum(b0.row, 'apoapsisAltM', 'row') - AP_TRUE) < 1,
      `${b0.row.apoapsisAltM} against ${AP_TRUE}`);
    check('phase 0: PE is the record against FORGE',
      Math.abs(mustNum(b0.row, 'periapsisAltM', 'row') - PE_TRUE) < 1,
      `${b0.row.periapsisAltM} against ${PE_TRUE}`);
    check('phase 0: the row names Forge as its body', b0.row.bodyId === 0,
      `bodyId ${b0.row.bodyId}`);
    // '' is the deliberate reading: the body is the one being drawn, so the
    // panel prints nothing for it. See MapPanels' `orbits` line.
    check('phase 0: the row says nothing about a body it is already at',
      b0.row.bodyName === '', JSON.stringify(b0.row.bodyName));
  }
  // POSITIVE CONTROL: at its own body it IS drawn, both as a line and a marker.
  check('phase 0: the orbit line is drawn',
    mustNum(p0.three.lines, 'railsLines', 'lines') >= 1,
    JSON.stringify(p0.three.lines));
  check('phase 0: the vessel marker is drawn',
    mustNum(p0.three.markerKinds, 'vessel', 'markerKinds') >= 1);
  check('phase 0: nothing is being left out here',
    mustNum(p0.three, 'vesselsElsewhere', 'three') === 0);
  // THE SHIPPED PATH IS UNCHANGED: on the body it booted on, the map still
  // BORROWS the world's own planet geometry (GP-208's zero-VRAM globe) rather
  // than building a second sphere. If this ever reads 'own' on a fresh boot the
  // fix has quietly stopped sharing the proxy and started costing VRAM.
  check('phase 0: the globe is the world\'s own planet, borrowed',
    p0.three.globeSource === 'proxy', JSON.stringify(p0.three.globeSource));
  notes.globeSource = { forge: p0.three.globeSource };
  await closeMap();

  // ==========================================================================
  // PHASE 1. GO TO CINDER. The map must become a map of Cinder, and Anchorage
  // must stop being drawn as if it went round it.
  // ==========================================================================
  const r1 = await of.reboot(1);
  check('the reboot went to Cinder', r1.toBodyId === 1 && r1.fromBodyId === 0,
    `${r1.fromBodyId} -> ${r1.toBodyId}`);
  await settle(2.0);
  const R_CINDER = mustNum(of.world(), 'bodyRadiusM', 'world()');
  // FIXTURE: the world genuinely changed. Everything below compares two bodies,
  // so two equal radii would make every comparison vacuously true.
  check('FIXTURE: the live body really is a different size',
    R_CINDER > 0 && Math.abs(R_CINDER - R_FORGE) > 1000,
    `${R_CINDER} against ${R_FORGE}`);
  // THE NEGATIVE CONTROL, computed here and never run: what the pre-GP-650
  // arithmetic (`a(1 +/- e)` minus the OBSERVER's radius) would print now.
  const AP_WRONG = A * (1 + E) - R_CINDER;
  notes.cinder = { radiusM: R_CINDER, apWrongM: AP_WRONG, apTrueM: AP_TRUE };
  check('the control discriminates: the two answers are far apart',
    Math.abs(AP_WRONG - AP_TRUE) > 100000,
    `wrong ${AP_WRONG} against true ${AP_TRUE}`);

  const p1 = await openMap('phase 1');
  const g1 = mustNum(p1.three, 'globeRadiusUnits', 'three');
  notes.globe = { forgeUnits: g0, cinderUnits: g1 };
  // THE MAP'S BODY VISUAL FOLLOWED. Not merely "the number moved": the globe
  // has to have moved BY THE RIGHT AMOUNT, so a stale globe that happened to be
  // rebuilt at some other size cannot pass. The proxy formula subtracts a
  // relief margin from each radius, so the two ratios agree to a few percent
  // rather than exactly, and the defect being caught is a factor of three.
  check('phase 1: the map globe is Cinder-sized', g1 < g0,
    `${g1} against ${g0}`);
  check('phase 1: and it is the right size for Cinder',
    Math.abs((g1 / g0) - (R_CINDER / R_FORGE)) < 0.1 * (R_CINDER / R_FORGE),
    `globe ratio ${(g1 / g0).toFixed(4)} against body ratio `
    + `${(R_CINDER / R_FORGE).toFixed(4)}`);
  check('phase 1: the map says which body it is of', p1.three.globeBodyId === 1,
    `globeBodyId ${p1.three.globeBodyId}`);
  // The proxy is one of the holders `of.life()` already grades as surviving a
  // switch, so on Cinder there is no Cinder-sized planet to borrow and the map
  // builds its own. Asserted, because 'own' here and 'proxy' in phases 0 and 2
  // is what says the borrow is conditional rather than abandoned.
  check('phase 1: with no Cinder proxy to borrow, the map builds its own globe',
    p1.three.globeSource === 'own', JSON.stringify(p1.three.globeSource));
  notes.globeSource.cinder = p1.three.globeSource;
  check('phase 1: and names it', p1.three.globeBodyName === 'Cinder',
    JSON.stringify(p1.three.globeBodyName));
  // ANCHORAGE IS NOT DRAWN AS ORBITING CINDER. Three independent readings, so
  // one of them being wired wrong cannot make the picture look innocent.
  check('phase 1: no orbit line is drawn round Cinder',
    mustNum(p1.three.lines, 'railsLines', 'lines') === 0,
    JSON.stringify(p1.three.lines));
  check('phase 1: and the line was skipped BECAUSE it is elsewhere',
    mustNum(p1.three.lines, 'skippedElsewhere', 'lines') >= 1);
  check('phase 1: no vessel marker is placed in Cinder\'s frame',
    mustNum(p1.three.markerKinds, 'vessel', 'markerKinds') === 0);
  check('phase 1: and the scene says one record was left out',
    mustNum(p1.three, 'vesselsElsewhere', 'three') >= 1);
  // THE PANEL SAYS WHERE IT ACTUALLY IS.
  const b1 = panel();
  check('phase 1: the map body port followed to Cinder',
    b1.body.bodyId === 1 && mustNum(b1.body, 'radiusM', 'map body') === R_CINDER,
    JSON.stringify(b1.body));
  check('phase 1: Anchorage is still IN the list', b1.row !== null,
    '"my station is not in the list" is a bug report, so the row is kept');
  if (b1.row !== null) {
    check('phase 1: the row NAMES Forge', b1.row.bodyName === 'Forge',
      JSON.stringify(b1.row.bodyName));
    check('phase 1: and carries Forge\'s body id', b1.row.bodyId === 0,
      `bodyId ${b1.row.bodyId}`);
    const ap = mustNum(b1.row, 'apoapsisAltM', 'row');
    check('phase 1: AP is UNCHANGED by where the player is standing',
      Math.abs(ap - AP_TRUE) < 1, `${ap} against ${AP_TRUE}`);
    check('phase 1: and is NOT the old figure against Cinder',
      Math.abs(ap - AP_WRONG) > 1000, `${ap} against the wrong ${AP_WRONG}`);
    notes.panelOnCinder = { apM: ap, bodyName: b1.row.bodyName };
  }
  // The focus list is the other half of the `'Forge'` literal, and it is what a
  // player reads to know which world they are looking at.
  check('phase 1: the body focus option is named Cinder',
    Array.isArray(p1.focus?.options) && p1.focus.options.includes('Cinder'),
    JSON.stringify(p1.focus?.options));
  await closeMap();

  // ==========================================================================
  // PHASE 2. COME BACK. Reid's second symptom is the RETURN leg, so the revert
  // is asserted as its own claim rather than assumed from the outward one.
  // ==========================================================================
  const r2 = await of.reboot(0);
  check('the reboot came back to Forge', r2.toBodyId === 0 && r2.fromBodyId === 1,
    `${r2.fromBodyId} -> ${r2.toBodyId}`);
  await settle(2.0);
  check('phase 2: the live body is Forge again',
    mustNum(of.world(), 'bodyRadiusM', 'world()') === R_FORGE);
  const p2 = await openMap('phase 2');
  const g2 = mustNum(p2.three, 'globeRadiusUnits', 'three');
  notes.globeSource.backHome = p2.three.globeSource;
  check('phase 2: the map globe reverted to Forge exactly',
    Math.abs(g2 - g0) < 1e-9, `${g2} against ${g0}`);
  check('phase 2: and goes back to borrowing the world\'s planet',
    p2.three.globeSource === 'proxy', JSON.stringify(p2.three.globeSource));
  check('phase 2: and says so', p2.three.globeBodyId === 0
    && p2.three.globeBodyName === 'Forge', JSON.stringify(p2.three.globeBodyName));
  check('phase 2: the orbit line is drawn again',
    mustNum(p2.three.lines, 'railsLines', 'lines') >= 1,
    JSON.stringify(p2.three.lines));
  check('phase 2: and the marker with it',
    mustNum(p2.three.markerKinds, 'vessel', 'markerKinds') >= 1);
  check('phase 2: nothing is left out at home',
    mustNum(p2.three, 'vesselsElsewhere', 'three') === 0);
  const b2 = panel();
  check('phase 2: there is a row for Anchorage again', b2.row !== null);
  if (b2.row !== null) {
    check('phase 2: AP is the SAME number it was in phase 0',
      Math.abs(mustNum(b2.row, 'apoapsisAltM', 'row') - AP_TRUE) < 1,
      `${b2.row.apoapsisAltM} against ${AP_TRUE}`);
    check('phase 2: and the row is quiet about the body again',
      b2.row.bodyName === '', JSON.stringify(b2.row.bodyName));
  }
  check('phase 2: the body focus option is named Forge',
    Array.isArray(p2.focus?.options) && p2.focus.options.includes('Forge'),
    JSON.stringify(p2.focus?.options));
  await closeMap();

  return { valid: true, fails, notes };
})()
