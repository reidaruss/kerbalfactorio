// map3d.js: THE 3D MAP (GP-211): the globe draws, a rails vessel's orbit
// draws, selection works, and TAKE CONTROL seats the player through the
// published handoff door from a distance no boarding walk could produce.
//
//   node tools/smoke/run.mjs --url=http://127.0.0.1:PORT/ --sandbox=1 \
//     --evalfile=tools/smoke/probes/map3d.js [--out=docs/screenshots/GP211.png]
//
// OF_ARGS.stage:
//   'shot'  - fixture + map open + zoomed to the whole planet, then stop, for
//             screenshot runs (pair it with --t to move the sun and diff the
//             terminator between two runs).
//   default - the full loop including the closed-state cost invariant and the
//             control handoff.
//
// Every press is followed by its receipt (GP-155: a press helper must verify
// the press LANDED), and the fixture is asserted before the behaviour
// (INSTRUMENTS.md: a fixture whose value is the identity of the operation
// proves nothing). The seat-move assertion is the 418 km-class one: BOARD
// range is 18 m, so an altitude above 60 km after the press is a state no
// boarding walk could have produced.
(async () => {
  const of = window.__of;
  if (!of) return { valid: false, why: 'no __of' };
  if (typeof of.flight !== 'function') return { valid: false, why: 'no flight' };
  const sleep = (n) => of.run(n);
  const fails = [];
  const log = [];
  const check = (name, ok, detail) => {
    if (!ok) fails.push(detail === undefined ? name : `${name}: ${detail}`);
    return ok;
  };
  const FM = () => of.flight('report');
  const F = () => of.flight('report').flight;
  const stage = (OF_ARGS && OF_ARGS.stage) || 'full';

  await sleep(1.2);

  // --- 0. THE CLOSED-STATE INVARIANT, measured on the walking scene the page
  // booted into, BEFORE any vessel exists: draw calls with the map never
  // opened, after an open/close cycle, must match. Settled reads, because
  // streaming converges at spawn and a mid-stream read is a different scene.
  const callsVirgin = of.stats().draw.calls;
  const trisVirgin = of.stats().draw.triangles;
  const mapCode = (of.input.bindings().map || [])[0];
  if (!mapCode) return { valid: false, why: 'no map binding' };
  const pressM = () => window.dispatchEvent(
    new KeyboardEvent('keydown', { code: mapCode, bubbles: true }));
  pressM();
  await sleep(0.5);
  check('M opened the map (the press landed)', of.map().open === true);
  const openStats0 = {
    calls: of.stats().draw.calls, triangles: of.stats().draw.triangles,
  };
  pressM();
  await sleep(1.0);
  check('M closed the map again', of.map().open === false);
  const callsAfterCycle = of.stats().draw.calls;
  check('CLOSED COST IS ZERO: draw calls identical before vs after the cycle',
    callsAfterCycle === callsVirgin, `${callsVirgin} -> ${callsAfterCycle}`);
  log.push(`closed calls ${callsVirgin} -> ${callsAfterCycle}; `
    + `open(no vessel) calls ${openStats0.calls} tris ${openStats0.triangles}`);

  if (stage === 'tint') {
    // SURVIVAL RUN (no --sandbox): the globe may not reveal ground the player
    // has never seen (DW-36), so until per-region reveal exists its tint is
    // NEUTRAL; the biome tint is sandbox's.
    pressM();
    await sleep(0.5);
    check('M opened the map for the tint read', of.map().open === true);
    const tintRep = of.map('three').three;
    check('survival globe is NEUTRAL, not biome-tinted (DW-36)',
      tintRep !== null && tintRep.globeTint === 'neutral',
      JSON.stringify(tintRep === null ? null : tintRep.globeTint));
    return { valid: fails.length === 0, fails, log,
      tint: tintRep === null ? null : tintRep.globeTint };
  }

  // --- 1. FIXTURE: a vessel in a REAL orbit, left on rails, player walking.
  // The launchguide.js recipe: build three parts, roll out, walk, board,
  // teleport to a 100 km orbit through the pause-menu cheat.
  const PID = [0x0100, 0x0101, 0x0103];
  of.vab('enter');
  await sleep(0.4);
  const cat = of.vab('catalogue');
  of.vab('press', 'clear');
  await sleep(0.15);
  for (const pid of PID) {
    const i = cat.find((c) => c.id === pid)?.index ?? -1;
    if (i < 0) continue;
    of.vab('frame');
    of.vab('take', i);
    await sleep(0.12);
    const parts = of.vab('report').parts;
    if (parts.length === 0) { of.vab('place'); await sleep(0.12); continue; }
    let low = parts[0];
    for (const p of parts) if (p.origin[1] < low.origin[1]) low = p;
    const nodes = of.vab('nodes').filter((n) => n.parent === low.handle
      && n.onScreen && (n.kind === 'bottom' || n.kind === 'interstage'));
    if (nodes.length === 0) continue;
    of.vab('hover', nodes[0].ndc[0], nodes[0].ndc[1]);
    of.vab('place');
    await sleep(0.12);
  }
  of.vab('leave');
  await sleep(0.4);
  of.flight('rollout');
  await sleep(0.8);
  for (let i = 0; i < 16 && FM().distanceToVesselM > 10; ++i) {
    of.input.act(['forward'], 30);
    await sleep(0.6);
  }
  of.flight('board');
  await sleep(0.6);
  check('fixture: built, rolled out and boarded',
    F().live === true && FM().aboard === true, JSON.stringify(FM().message));
  if (F().live !== true) return { valid: false, why: 'no vessel', fails, log };
  of.pause(true);
  await sleep(0.35);
  const btn = document.querySelector('#of-pause button[data-cheat="orbit"]');
  btn?.click();
  await sleep(1.5);
  of.pause(false);
  await sleep(1.2);
  check('fixture: the teleport actually put the craft in orbit',
    F().status === 'ORBIT', `status ${F().status}`);
  of.flight('leave');
  await sleep(1.0);
  const rows = of.flight('vessels').list;
  const rails = rows.find((v) => v.mode === 'rails');
  check('fixture: leaving produced a RAILS record with a real conic',
    rails !== undefined && rails.conic !== null && rails.conic.a > 600000,
    JSON.stringify(rows.map((v) => [v.id, v.mode, v.conic?.a])));
  check('fixture: the player is back on the ground, not aboard',
    FM().aboard === false && of.world().observer.altM < 1000,
    `aboard=${FM().aboard} altM=${of.world().observer.altM}`);
  if (rails === undefined) return { valid: false, why: 'no rails vessel', fails, log };

  // --- 2. THE MAP DRAWS THE ORBIT. Open, zoom out to the whole planet, read
  // the scene's OWN counts (taken inside Map3D, not re-derived).
  pressM();
  await sleep(0.5);
  check('M opened the map over the fixture', of.map().open === true);
  for (let i = 0; i < 40; ++i) of.map('zoom', { mult: 1.25 });
  await sleep(0.8);
  const rep = of.map('three');
  check('the picture is the 3D scene, not the flat canvas',
    rep.flat === false && rep.three !== null);
  const t3 = rep.three;
  check('the globe is drawn and biome-tinted (sandbox reveals all)',
    t3.globeTint === 'biome', t3.globeTint);
  check('the rails orbit is drawn as a line', t3.lines.railsLines >= 1,
    JSON.stringify(t3.lines));
  // The census, EXACT against published state: one player (walking), one
  // vessel marker per registry row, zero flying. Pads are whatever the world
  // holds (this fixture's rollout is the pad STAND-IN, so usually zero) and
  // are logged rather than guessed.
  const k = t3.markerKinds;
  check('the marker census matches the world: 1 player, 1 vessel, 0 flying',
    k.player === 1 && k.vessel === rows.length && k.flying === 0,
    JSON.stringify(k));
  log.push(`markers ${JSON.stringify(k)}`);
  const openStats = {
    calls: of.stats().draw.calls, triangles: of.stats().draw.triangles,
  };
  log.push(`open(fixture) calls ${openStats.calls} tris ${openStats.triangles}`);
  check('while open the world passes are replaced: triangles are the map\'s, '
    + 'not the world\'s', openStats.triangles < trisVirgin / 4,
    `open ${openStats.triangles} vs world ${trisVirgin}`);
  // The camera answers the drag hook (the binding-free pointer path).
  const yaw0 = t3.camera.yawRad;
  of.map('look', { dx: 120, dy: 0 });
  await sleep(0.3);
  const yaw1 = of.map('three').three.camera.yawRad;
  check('dragging orbits the camera', Math.abs(yaw1 - yaw0) > 0.3,
    `${yaw0} -> ${yaw1}`);

  if (stage === 'shot') {
    return { valid: fails.length === 0, fails, log, three: t3, openStats };
  }

  // --- 3. SELECTION through the panel's own row, receipt asserted.
  const selRow = document.querySelector(`#of-map [data-sel="${rails.id}"]`);
  check('the vessel has a row in the panel', selRow !== null);
  selRow?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await sleep(0.3);
  check('clicking the row selected it (the press landed)',
    of.map('three').selectedId === rails.id,
    `selectedId=${of.map('three').selectedId}`);

  // --- 4. TAKE CONTROL through the row's button. The receipt is the seat.
  const altBefore = of.world().observer.altM;
  const ctlBtn = document.querySelector(`#of-map button[data-ctl="${rails.id}"]`);
  check('the take-control button is there', ctlBtn !== null);
  ctlBtn?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await sleep(1.2);
  const after = FM();
  check('THE SEAT MOVED: aboard the rails vessel after the press',
    after.aboard === true, JSON.stringify(after.message));
  const rowsAfter = of.flight('vessels').list;
  const target = rowsAfter.find((v) => v.id === rails.id);
  check('the target vessel is the promoted one',
    target !== undefined && target.promoted === true,
    JSON.stringify(rowsAfter.map((v) => [v.id, v.promoted])));
  const altAfter = of.world().observer.altM;
  check('418 km-class: the observer is at ORBITAL altitude, which an 18 m '
    + 'boarding walk cannot produce', altAfter > 60000,
    `altM ${altBefore} -> ${altAfter}`);
  check('the map closed on success: the point of a seat is to see out of it',
    of.map().open === false);
  check('the flight is live in ORBIT', F().status === 'ORBIT', F().status);

  return {
    valid: fails.length === 0, fails, log,
    invariant: { callsVirgin, callsAfterCycle, openStats0, openStats },
    seat: { altBefore, altAfter },
    three: of.map('three').three,
  };
})()
