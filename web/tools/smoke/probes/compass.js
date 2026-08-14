// compass.js (GP-700): THE ON-FOOT COMPASS. Reid's ruling, 2026-08-13 evening:
// "we need to add a compass, a hud showing marked locations while you are
// running around."
//
//   node tools/smoke/run.mjs --url=http://<lan>:PORT/ --sandbox=1 \
//     --evalfile=tools/smoke/probes/compass.js
//
// `--sandbox=1`: the mode gate (§4/§5 below) needs a vessel aboard, which
// costs a VAB build + rollout + board even in the cheapest form
// (`aptime.js`'s own pod+engine, no tank), and sandbox is where every other
// probe that boards a vessel for a cost reason and not a balance one pays
// that cost. The BEARING MATH (§1-§3) does not touch mode rules at all and
// would read identically in survival.
//
// THE CLAIM: game/Compass.ts computes a bearing to every KNOWN marker
// (MarkerRegistry, GP-520) and to the player's own pad off the player's own
// body-frame heading, using Controller.ts's own convention (0 = north, 90 =
// east, `forward = north*cos(yaw) + east*sin(yaw)`); ui/CompassHud.ts draws
// it as a strip and `__of.game().compass` publishes exactly what was drawn
// (GameplayReport.ts), the `progress`/`stationGate` precedent -- this probe
// reads that block, never pixels.
//
// FIVE THINGS, each asserted:
//   1. A marker placed due EAST of the player (a small rotation of the
//      player's own position toward an INDEPENDENTLY computed east tangent,
//      `markers.js`'s own `dirNear`/rotation technique) reports bearingDeg
//      close to 90; one placed due NORTH reports close to 0.
//   2. Rotating the player (a real `of.look`) leaves each marker's PUBLISHED
//      bearingDeg unchanged (it is a geometric fact, not a view fact) while
//      the RELATIVE bearing (published bearingDeg minus published
//      headingDeg -- what actually decides where the chip draws on the
//      strip) moves by the OPPOSITE of the yaw change.
//   3. NEGATIVE CONTROL: a marker added with `known: false` (the unscanned
//      case) produces no chip at all -- `known` is the only gate MapMarker
//      documents itself, honoured again in game/Compass.ts.
//   4. MODE GATE: opening the map (a real M press) makes the compass block
//      disappear (`null`, not an empty one), and closing it again brings the
//      SAME instance back rather than leaving it dead.
//   5. MODE GATE: boarding a vessel (a real VAB build, rollout and board,
//      `aptime.js`'s own minimal fixture) makes it disappear too, and
//      disembarking brings it back.
//
// WHAT IS NOT CHECKED HERE: distance labels (the feature deliberately has
// none -- see game/Compass.ts's own header) and the pad ("player's own
// base") chip, which needs a REAL LaunchPadPlacement build (StructurePlacement's
// own placement, not the VAB/rollout fixture §5 uses, which does not
// necessarily create a `LaunchPads` entry at all) and was judged not worth a
// second expensive fixture in this file; `game/Compass.ts`'s own code path
// for it is exercised at zero pads by every run below (no crash, no phantom
// chip), which is the cheap half of that claim.
(async () => {
  const of = window.__of;
  if (!of) return { valid: false, why: 'no __of' };
  if (typeof of.markers !== 'function') return { valid: false, why: 'no __of.markers' };
  if (typeof of.game !== 'function') return { valid: false, why: 'no __of.game' };
  if (typeof of.look !== 'function') return { valid: false, why: 'no __of.look' };
  const fails = [];
  const log = [];
  const check = (name, ok, detail) => {
    if (!ok) fails.push(detail === undefined ? name : `${name}: ${detail}`);
    return ok;
  };
  const step = (what) => console.log(`[probe] ${what}`);
  const sleep = (n) => of.run(n);

  const norm = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  // ViewSource.ts's own `tangentFrame`, reimplemented independently rather
  // than imported: `east = (0,1,0) x up` (or (1,0,0) at the degenerate pole),
  // `north = up x east`. Getting this wrong would make the probe agree with
  // the game by construction, which is the "second authority" GP-64 rule
  // this project's own probes are written against.
  const tangentFrame = (up) => {
    let east = cross([0, 1, 0], up);
    if (Math.hypot(east[0], east[1], east[2]) < 1e-6) east = [1, 0, 0];
    east = norm(east);
    const north = norm(cross(up, east));
    return { east, north };
  };
  // Signed degrees from `heading` to `target`, in (-180, 180], the SAME
  // definition ui/CompassHud.ts's `relBearing` uses for where a chip draws.
  const relBearing = (target, heading) => (((target - heading + 180) % 360) + 360) % 360 - 180;
  const angDiff = (a, b) => Math.abs(relBearing(a, b));

  await sleep(1.0);
  of.markers('clear');

  // ==========================================================================
  // 0. FIXTURE: the player's own position and tangent frame, computed here,
  //    independently of game/Compass.ts. `dirNear` stands in for the
  //    player's own `up` (both are `normalize(position)` on a sphere --
  //    ViewSource.ts's own interface comment calls `up` "Local up (radial) at
  //    the eye", not a terrain normal, so the two coincide exactly).
  // ==========================================================================
  const w0 = of.world();
  const feet = w0.player.feet;
  const bodyR = w0.bodyRadiusM;
  const dirNear = norm(feet);
  const { east, north } = tangentFrame(dirNear);
  // 3 km of arc: comfortably inside the compass's field of view maths (which
  // never looks at distance) and far enough from the player's own position
  // that a sign error in the rotation would be obviously wrong rather than
  // lost in float noise.
  const theta = 3000 / bodyR;
  const rotate = (tangent) => norm([
    dirNear[0] * Math.cos(theta) + tangent[0] * Math.sin(theta),
    dirNear[1] * Math.cos(theta) + tangent[1] * Math.sin(theta),
    dirNear[2] * Math.cos(theta) + tangent[2] * Math.sin(theta),
  ]);
  const dirEast = rotate(east);   // expected bearing ~90
  const dirNorth = rotate(north); // expected bearing ~0
  log.push(`bodyRadiusM=${bodyR} arcOffsetM=${Math.round(theta * bodyR)}`);

  const addE = of.markers('add', { key: 'probe-east', kind: 'ruin', dirBody: dirEast, label: 'Probe East', known: true });
  check('the east marker was added', addE?.added?.key === 'probe-east', JSON.stringify(addE));
  const addN = of.markers('add', { key: 'probe-north', kind: 'signal', dirBody: dirNorth, label: 'Probe North', known: true });
  check('the north marker was added', addN?.added?.key === 'probe-north', JSON.stringify(addN));
  const addH = of.markers('add', { key: 'probe-hidden', kind: 'deposit', dirBody: dirEast, label: 'Probe Hidden', known: false });
  check('the unknown marker was added', addH?.added?.known === false, JSON.stringify(addH));

  // ==========================================================================
  // 1-3. FACE NORTH (yaw 0). Read the compass block; check both real
  //    markers' bearings against the independently-computed expectation, and
  //    that the unknown one draws no chip at all.
  // ==========================================================================
  step('facing north, reading the compass block');
  of.look(0, -8);
  await sleep(0.3);
  const G1 = of.game();
  check('the compass block exists on foot', G1.compass !== null && G1.compass !== undefined, JSON.stringify(G1.compass));
  const c1 = G1.compass;
  check('heading reads ~0 (facing north)', c1 && Math.abs(relBearing(c1.headingDeg, 0)) < 1.0,
    JSON.stringify(c1 && c1.headingDeg));
  const chip = (c, key) => c?.chips?.find((x) => x.key === key);
  const eChip1 = chip(c1, 'probe-east');
  const nChip1 = chip(c1, 'probe-north');
  check('the east marker has a chip', eChip1 !== undefined, JSON.stringify(c1?.chips));
  check('and its bearing reads ~90 (east)', eChip1 !== undefined && angDiff(eChip1.bearingDeg, 90) < 1.5,
    JSON.stringify(eChip1));
  check('the north marker has a chip', nChip1 !== undefined, JSON.stringify(c1?.chips));
  check('and its bearing reads ~0 (north)', nChip1 !== undefined && angDiff(nChip1.bearingDeg, 0) < 1.5,
    JSON.stringify(nChip1));
  check('NEGATIVE CONTROL: the unknown site has no chip at all',
    chip(c1, 'probe-hidden') === undefined, JSON.stringify(c1?.chips));

  // ==========================================================================
  // 4. ROTATE. The published bearingDeg is geometry and must not move; the
  //    RELATIVE bearing (what puts the chip on the strip) must move by the
  //    OPPOSITE of the yaw change.
  // ==========================================================================
  step('turning 40 degrees clockwise (toward the east marker)');
  const YAW_DELTA = 40;
  of.look(YAW_DELTA, -8);
  await sleep(0.3);
  const G2 = of.game();
  const c2 = G2.compass;
  check('the compass block still exists', c2 !== null && c2 !== undefined, JSON.stringify(c2));
  check('heading reads ~40 now', c2 && Math.abs(relBearing(c2.headingDeg, YAW_DELTA)) < 1.0,
    JSON.stringify(c2 && c2.headingDeg));
  const eChip2 = chip(c2, 'probe-east');
  check('the east marker still has a chip after turning', eChip2 !== undefined, JSON.stringify(c2?.chips));
  check('its PUBLISHED bearing is UNCHANGED by the turn (geometry, not view)',
    eChip2 !== undefined && angDiff(eChip2.bearingDeg, eChip1.bearingDeg) < 0.5,
    `${eChip1 && eChip1.bearingDeg} -> ${eChip2 && eChip2.bearingDeg}`);
  const rel1 = eChip1 !== undefined ? relBearing(eChip1.bearingDeg, c1.headingDeg) : NaN;
  const rel2 = eChip2 !== undefined ? relBearing(eChip2.bearingDeg, c2.headingDeg) : NaN;
  log.push(`east marker relative bearing: ${rel1.toFixed(2)} -> ${rel2.toFixed(2)} (yaw +${YAW_DELTA})`);
  check('the RELATIVE bearing moved by the OPPOSITE of the yaw change (strip moved the other way)',
    Number.isFinite(rel1) && Number.isFinite(rel2) && Math.abs((rel1 - rel2) - YAW_DELTA) < 1.5,
    `expected shift ~${YAW_DELTA}, measured ${(rel1 - rel2).toFixed(2)}`);
  of.look(0, -8);
  await sleep(0.2);

  // ==========================================================================
  // 5. MODE GATE: THE MAP. A real M press; the compass must vanish while it
  //    is up and come back, unbroken, once it closes.
  // ==========================================================================
  step('mode gate: opening the map');
  const mapCode = (of.input.bindings().map || [])[0];
  check('there is a map binding to press', !!mapCode, JSON.stringify(of.input.bindings()));
  if (mapCode) {
    const pressM = () => window.dispatchEvent(new KeyboardEvent('keydown', { code: mapCode, bubbles: true }));
    pressM();
    await sleep(0.6);
    check('M opened the map', of.map().open === true);
    const G3 = of.game();
    check('NO COMPASS BLOCK WHILE THE MAP IS OPEN', G3.compass === null || G3.compass === undefined,
      JSON.stringify(G3.compass));
    pressM();
    await sleep(0.5);
    check('M closed the map again', of.map().open === false);
    of.look(0, -8);
    await sleep(0.3);
    const G4 = of.game();
    check('the compass block RETURNS once the map closes',
      G4.compass !== null && G4.compass !== undefined, JSON.stringify(G4.compass));
  }

  // ==========================================================================
  // 6. MODE GATE: FLIGHT. `aptime.js`'s own minimal fixture: a pod and an
  //    engine (no tank -- nothing here needs to fly anywhere), rolled out and
  //    boarded through the real VAB / flight API, never a synthetic
  //    `aboard=true`.
  // ==========================================================================
  step('mode gate: building the cheapest vehicle that can be boarded');
  of.build(0);
  of.vab('enter');
  await sleep(0.4);
  const cat = of.vab('catalogue');
  of.vab('press', 'clear');
  await sleep(0.15);
  for (const pid of [0x0100, 0x0103]) {
    const i = cat.find((c) => c.id === pid)?.index ?? -1;
    if (i < 0) continue;
    of.vab('frame');
    of.vab('take', i);
    await sleep(0.12);
    const parts = of.vab('report').parts;
    if (parts.length === 0) { of.vab('place'); await sleep(0.12); continue; }
    let low = parts[0];
    for (const q of parts) if (q.origin[1] < low.origin[1]) low = q;
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
  if (of.flight('report').rollouts === 0) { of.flight('rollout'); await sleep(0.8); }
  for (let i = 0; i < 16 && of.flight('report').distanceToVesselM > 10; ++i) {
    of.input.act(['forward'], 30);
    await sleep(0.6);
  }
  of.flight('board');
  await sleep(0.6);
  check('fixture: the player actually boarded', of.flight('report').aboard === true,
    JSON.stringify(of.flight('report')));
  const G5 = of.game();
  check('NO COMPASS BLOCK WHILE ABOARD', G5.compass === null || G5.compass === undefined,
    JSON.stringify(G5.compass));

  step('disembarking');
  of.flight('disembark');
  await sleep(0.6);
  check('fixture: the player is back on foot', of.flight('report').aboard === false,
    JSON.stringify(of.flight('report')));
  of.look(0, -8);
  await sleep(0.3);
  const G6 = of.game();
  check('the compass block RETURNS once back on foot',
    G6.compass !== null && G6.compass !== undefined, JSON.stringify(G6.compass));

  of.markers('clear');

  return {
    valid: true,
    pass: fails.length === 0,
    fails,
    log,
    compass: { facingNorth: c1, afterTurn: c2, whileMapped: null, whileAboard: null },
  };
})()
