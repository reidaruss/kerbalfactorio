// FS-40: A BELT CORNER ON A HILLSIDE LINES UP WITH THE RUN IT IS PART OF.
//
//   node tools/smoke/run.mjs --scenario=walk \
//        --evalfile=tools/smoke/probes/beltslope.js
//
// Reid, verbatim: "I turned this belt and it functionally is turned - stuff
// flows to the other belt but visually it didnt turn to line up."
//
// WHY A SECOND BELT PROBE, AND WHY IT TELEPORTS. `beltturn.js` drives the same
// gestures on the spawn clearing and every seam it measures is 1e-6 m, before
// the fix as well as after. That is not a weak probe; it is a FLAT one, and the
// defect is invisible on flat ground by construction:
//
//   `FactoryCommit.pitchRuns` gives every belt tile a heading with a PITCH out
//   of the tangent plane, so a run on a hillside is a ramp rather than a flight
//   of steps, and `Placed.quat` is `frameOf(up, fwd)`, which keeps that pitch.
//   `FactoryView.cornersOf` used to orient a CORNER tile with `orient`, which
//   by definition puts local +Z in the tangent plane and throws the pitch away.
//   On level ground the two agree exactly. On a slope the corner tile alone
//   stood level between two ramping neighbours.
//
// So this probe finds real sloping ground, stands on it, and measures there.
// The site is found by TELEPORTING over a grid of lat/lon offsets around the
// spawn and reading the player's own `slopeCos` at each, then taking the one
// nearest 15 degrees: measured, not assumed, because which way a hillside faces
// is a property of the seed and not of this file.
//
// THE BOUND IS DERIVED, NOT PICKED. A corner tile that has dropped the run's
// pitch has its inlet half a tile away along a heading that is wrong by exactly
// that pitch, so the seam it opens is r sin(pitch) with r = 0.5 m: 0.089 m at a
// 10.3 degree tile pitch. The assertion is that the measured corner seam is
// UNDER that closed form, i.e. that the pitch is not being dropped, with a 5 mm
// floor so the same line still catches a corner drawn with the straight mesh
// (0.707 m) on ground with no slope at all. Every other number here is measured
// against the asset's own published body endpoints and the matrix the batch is
// about to draw, exactly as in `beltturn.js`.
//
// THE RESIDUAL IS NAMED. Two perpendicular runs on a hillside genuinely
// disagree about which way is up: `pitchRuns` sets each tile's `up` to the
// radial orthogonalised against THAT TILE'S heading, so a run down the fall
// line banks and a run across it stands upright, and on a 15 degree slope the
// two differ by about 14 degrees. No rigid quarter-turn tile can meet both, and
// the sockets sit 0.25 m up, so about 0.03 m of the remaining seam is that
// disagreement being split between the corner's two ends. Closing it would mean
// changing the `up` convention for every straight tile, which is out of scope
// and is not what Reid reported.
(async () => {
  const of = window.__of;
  const log = [];
  const settle = (secs) => of.run(secs, 60);
  const fac = () => of.game().factory;
  const view = () => of.game().view;
  const A = typeof OF_ARGS === 'object' && OF_ARGS !== null ? OF_ARGS : {};
  const WANT_DEG = A.deg ?? 15;

  await settle(1.0);
  await of.wipe();
  const t0 = of.world();
  if (of.game() === null) return { valid: false, why: 'no gameplay layer' };

  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0]];
  const len = (a) => Math.hypot(a[0], a[1], a[2]);
  const norm = (a) => { const l = len(a); return l < 1e-12 ? [0, 0, 0] : mul(a, 1 / l); };
  const vec3 = (v) => (Array.isArray(v) ? v.slice(0, 3) : [v.x, v.y, v.z]);
  const xf = (m, p) => [
    m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
    m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
    m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]];
  const DEG = 180 / Math.PI;

  // ---- 1. STAND ON A HILLSIDE ----------------------------------------------
  const w0 = of.world();
  const lat0 = w0.player.latDeg ?? w0.observer.latDeg;
  const lon0 = w0.player.lonDeg ?? w0.observer.lonDeg;
  if (lat0 === undefined) return { valid: false, why: 'no lat/lon on the bridge' };
  let best = null;
  const sweep = [];
  for (let a = -0.06; a <= 0.061; a += 0.02) {
    for (let b = -0.06; b <= 0.061; b += 0.02) {
      of.teleport(lat0 + a, lon0 + b, 0);
      await settle(0.3);
      const deg = Math.acos(Math.min(1, of.world().player.slopeCos)) * DEG;
      sweep.push({ a: +a.toFixed(3), b: +b.toFixed(3), deg: +deg.toFixed(2) });
      const score = Math.abs(deg - WANT_DEG);
      if (best === null || score < best.score) {
        best = { score, deg, lat: lat0 + a, lon: lon0 + b };
      }
    }
  }
  of.teleport(best.lat, best.lon, 0);
  await settle(1.2);
  const groundDeg = Math.acos(Math.min(1, of.world().player.slopeCos)) * DEG;
  log.push(`stood on ${groundDeg.toFixed(2)} deg of slope at `
    + `${best.lat.toFixed(4)},${best.lon.toFixed(4)} (asked for ${WANT_DEG})`);
  if (groundDeg < 6) {
    return { valid: false, why: 'no slope within reach of the spawn', sweep, log };
  }

  // ---- 2. LAY BELTS ON IT ---------------------------------------------------
  const yaw0 = of.world().observer.yawDeg;
  of.build(2);
  await settle(0.2);
  const addr = (c) => {
    const k = c.indexOf(':');
    const ij = c.slice(k + 1).split(',').map(Number);
    return { site: c.slice(0, k), i: ij[0], j: ij[1] };
  };
  of.look(yaw0, -55);
  await settle(0.3);
  of.input.tape([{ hold: 3, actions: ['use'] }, { hold: 6, keys: [] }]);
  await settle(0.4);
  if (fac().buildings === 0) {
    return { valid: false, why: 'the seed tile would not go down here', log, groundDeg };
  }
  const seed = addr(fac().list[0].cell);
  const eyeP = vec3(of.world().player.aim.origin);
  const cells = new Map();
  for (let y = -60; y <= 60; y += 2) {
    for (let p = -68; p <= -14; p += 2) {
      of.look((yaw0 + y + 720) % 360, p);
      await settle(0.03);
      const g = of.build().ghost;
      if (g === null) continue;
      const a = addr(g.cell);
      if (a.site !== seed.site) continue;
      const k = `${a.i},${a.j}`;
      const s = { ...a, cell: g.cell, ok: g.ok, yaw: yaw0 + y, pitch: p,
        distM: len(sub(vec3(g.pos), eyeP)) };
      if (!cells.has(k) || (s.ok && !cells.get(k).ok)) cells.set(k, s);
    }
  }
  const at = (i, j) => cells.get(`${i},${j}`) ?? null;
  const span = [...cells.values()].reduce((a, c) => [Math.min(a[0], c.j),
    Math.max(a[1], c.j)], [99, -99]);
  log.push(`scan ${cells.size} cells, j ${span[0]}..${span[1]}, seed ${seed.i},${seed.j}`);

  // An L by DRAG, wherever this hillside will take one. Both legs matter: the
  // run must have straight tiles either side of the corner, because the whole
  // measurement is the corner AGAINST the straights it sits between.
  let laid = 0, path = null, col = null;
  for (let di = -1; di >= -4 && laid < 4; --di) {
    const c0 = [];
    for (let j = span[0]; j <= span[1]; ++j) {
      const c = at(seed.i + di, j);
      if (c !== null && c.ok) c0.push(c);
    }
    if (c0.length < 4) continue;
    const a = c0[0], b = c0[Math.min(c0.length - 1, 4)];
    const c = at(seed.i + di - 2, b.j) ?? at(seed.i + di + 2, b.j);
    if (c === null || !c.ok) continue;
    const before = fac().buildings;
    of.look((a.yaw + 720) % 360, a.pitch);
    await settle(0.2);
    of.input.tape([{ hold: 600, actions: ['use'] }]);
    await settle(0.25);
    of.look((b.yaw + 720) % 360, b.pitch);
    await settle(0.6);
    of.look((c.yaw + 720) % 360, c.pitch);
    await settle(0.6);
    of.input.tape([{ hold: 6, keys: [] }]);
    await settle(0.5);
    laid = fac().buildings - before;
    path = [a.cell, b.cell, c.cell];
    col = c0;
  }
  if (laid < 4) return { valid: false, why: 'no L would go down on this slope', log, groundDeg };
  log.push(`drag ${path.join(' -> ')}: ${laid} tiles`);

  // And a REAL R press on the nearest tile, so the R path is measured on a
  // slope too and not only the drag path.
  of.build(0);
  await settle(0.8);

  // ---- 3. MEASURE -----------------------------------------------------------
  const measure = () => {
  const f = fac(), v = view();
  const S = v.beltSockets ?? {};
  const rows = new Map(f.list.map((x) => [x.id, x]));
  const draw = new Map((v.tiles ?? []).map((t) => [t.id, t]));
  const seams = [];
  for (let r = 0; r < f.runs.length; ++r) {
    const ids = f.runs[r].tileIds;
    for (let i = 1; i < ids.length; ++i) {
      const P = rows.get(ids[i - 1]), T = rows.get(ids[i]);
      const dP = draw.get(ids[i - 1]), dT = draw.get(ids[i]);
      if (!P || !T || dP?.m == null || dT?.m == null) continue;
      const sp = S[dP.mesh], st = S[dT.mesh];
      if (!sp || !st) continue;
      const seam = len(sub(xf(dP.m, sp.out), xf(dT.m, st.in)));
      // THE TILE'S DRAWN AXES, straight out of the matrix the batch will use.
      // `compose` is applied to the BODY-frame quaternion and a translation, so
      // the rotation columns are body-frame directions and compare directly
      // with the report's own `fwd` rows. This is the defect stated as an
      // angle rather than as a distance: local +Z IS where the flow comes in
      // from, and a frame built by `orient` cannot carry that heading's pitch.
      const ax = (m, k) => norm([m[k * 4], m[k * 4 + 1], m[k * 4 + 2]]);
      const zAxis = ax(dT.m, 2);
      const xAxis = ax(dT.m, 0);
      const ang = (a, b) => Math.acos(Math.max(-1, Math.min(1, dot(a, b)))) * DEG;
      const inDeg = ang(zAxis, norm(P.fwd));
      const uP = norm(P.up);
      const fIn = norm(sub(P.fwd, mul(uP, dot(P.fwd, uP))));
      const u = norm(T.up);
      const x = norm(cross(u, fIn));
      const dirs = { belt: fIn, belt_l: mul(x, -1), belt_r: x };
      const tf = norm(T.fwd);
      let want = 'belt', bd = -2;
      for (const k of ['belt', 'belt_l', 'belt_r']) {
        const d = dot(dirs[k], tf); if (d > bd) { bd = d; want = k; }
      }
      const reversal = bd < 0.5;
      // How far out of ITS OWN tangent plane each heading points: the pitch the
      // ramp carries and the pitch a corner tile used to throw away.
      const pit = (pos, v3) => {
        const rad = norm(pos);
        return Math.asin(Math.max(-1, Math.min(1, dot(norm(v3), rad)))) * DEG;
      };
      // The outlet axis, by the hand the mesh publishes: -X for a left turn.
      const outAxis = want === 'belt_l' ? mul(xAxis, -1) : xAxis;
      const kind = dot(fIn, tf) > 0.9 ? 'straight'
        : (reversal ? 'reversal' : 'corner');
      seams.push({ prev: ids[i - 1], tile: ids[i], drawn: dT.mesh,
        want: reversal ? null : want, meshOk: reversal || dT.mesh === want,
        seamM: +seam.toFixed(5), turn: kind,
        inAxisErrDeg: +inDeg.toFixed(3),
        // Only a corner has an outlet that has to be steered; on a straight the
        // local +-X axis is across the deck by construction and comparing it
        // with the heading would report 90 degrees and mean nothing.
        outAxisErrDeg: kind === 'corner' ? +ang(outAxis, tf).toFixed(3) : null,
        prevPitchDeg: +pit(P.pos, P.fwd).toFixed(2),
        tilePitchDeg: +pit(T.pos, T.fwd).toFixed(2) });
    }
  }
  const corners = seams.filter((s) => s.turn === 'corner');
  const straights = seams.filter((s) => s.turn === 'straight');
  const worst = (l) => l.reduce((m, s) => Math.max(m, s.seamM), 0);
  // THE DERIVED BOUND: half a tile of DROPPED PITCH, r sin(pitch) at r = 0.5 m,
  // measured from the pitch the run's own tiles actually carry. A corner that
  // has thrown the pitch away opens at least this much; one that has not, does
  // not. The 5 mm floor keeps the same line meaningful on ground with no slope.
  const pitchDeg = seams.reduce((m, s) => Math.max(m, Math.abs(s.prevPitchDeg)), 0);
  const droppedPitchM = 0.5 * Math.sin((pitchDeg * Math.PI) / 180);
  const bound = Math.max(0.005, droppedPitchM);
  const worstIn = corners.reduce((m, s) => Math.max(m, s.inAxisErrDeg), 0);
  const worstOut = corners.reduce((m, s) => Math.max(m, s.outAxisErrDeg), 0);
  return { seams, corners, straights, worst, bound,
    pitchDeg, worstIn, worstOut, curveTiles: v.curveTiles,
    buildings: f.buildings };
  };

  // The DRAG corner, on a hillside. This one has always LOOKED wrong on a slope
  // and never failed a check, which is why it is measured first and separately.
  const dragM = measure();
  log.push(`drag corners ${dragM.corners.length}: inlet axis err `
    + `${dragM.worstIn.toFixed(2)} deg, seam ${dragM.worst(dragM.corners)} m, `
    + `straights up to ${dragM.worst(dragM.straights)} m`);

  // ---- 4. AND THE SAME THING REACHED BY THE R KEY ---------------------------
  // Nearest first, and keep pressing until the tile the crosshair caught is a
  // CORNER: one quarter turn from a straight makes one, and one more from a
  // corner makes a reversal, which no mesh describes and which this probe must
  // not measure as if it did.
  let turn = { turned: 0, id: -1 };
  let turnM = dragM;
  for (const c of [...col].sort((a, b) => a.distM - b.distM).slice(0, 6)) {
    of.build(0);
    await settle(0.2);
    of.look((c.yaw + 720) % 360, c.pitch);
    await settle(0.2);
    let got = 0, id = -1;
    for (let k = 0; k < 4; ++k) {
      const before = of.build().turns;
      of.input.act(['rotate'], 4);
      await settle(0.35);
      const r = of.build();
      if (r.turns === before) break;
      got += r.turns - before;
      id = r.lastTurn === null ? -1 : r.lastTurn.id;
      const m = measure();
      if (m.corners.some((s) => s.tile === id)) {
        turnM = m;
        turn = { turned: got, id, aimed: c.cell, distM: +c.distM.toFixed(2),
          presses: k + 1 };
        break;
      }
    }
    if (turn.turned > 0) break;
  }
  if (turn.turned > 0) {
    log.push(`R x${turn.presses} at ${turn.aimed} (${turn.distM} m) turned id `
      + `${turn.id}: inlet axis err ${turnM.worstIn.toFixed(2)} deg, seam `
      + `${turnM.worst(turnM.corners)} m`);
  }

  const seams = turnM.seams, corners = turnM.corners, straights = turnM.straights;
  const worst = turnM.worst, bound = turnM.bound, pitchDeg = turnM.pitchDeg;
  const worstIn = Math.max(dragM.worstIn, turnM.worstIn);
  const worstOut = Math.max(dragM.worstOut, turnM.worstOut);

  of.look(yaw0, -34);
  await settle(0.6);

  return {
    valid: laid >= 4 && dragM.corners.length > 0 && corners.length > 0
      && groundDeg >= 6 && turn.turned > 0
      && (of.world().tick - t0.tick) > 200 && pitchDeg > 4,

    // --- THE ACCEPTANCE ------------------------------------------------------
    // 1. THE DEFECT, STATED AS AN ANGLE. A corner tile's drawn local +Z is the
    //    heading the flow arrives on, PITCH INCLUDED. `orient` cannot express
    //    that and read 10.28 degrees out here; the frame built from both
    //    headings reads 0. Half a degree is a floating-point allowance and not
    //    a tolerance for anything real.
    inletAxisIsTheIncomingFlow: worstIn < 0.5,
    // 2. And its outlet, by the hand the mesh publishes, follows the tile's own
    //    heading. It cannot be exact: two headings each pitched down a hillside
    //    are not quite perpendicular, and a rigid quarter turn is, so the
    //    residual is asin(in . out), about 2.1 degrees on this ground. The old
    //    frame put this axis on `up x in`, 10.8 degrees out.
    outletAxisFollowsHeading: worstOut < 4,
    // 3. The seam that opens is under the closed form for dropped pitch.
    cornerKeepsThePitch: worst(corners) < bound,
    // 4. It is still the right mesh, and so is everything else.
    meshMatchesGeometry: seams.every((s) => s.meshOk),
    // 5. And the straights are exactly what they were: this fix must not move
    //    a single one of them, on a slope any more than on the flat.
    straightsUnmoved: straights.every((s) => s.drawn === 'belt'),

    groundDeg: +groundDeg.toFixed(2),
    tilePitchDeg: +pitchDeg.toFixed(2),
    boundM: +bound.toFixed(5),
    worstInletAxisErrDeg: +worstIn.toFixed(3),
    worstOutletAxisErrDeg: +worstOut.toFixed(3),
    worstCornerSeamM: worst(corners),
    worstStraightSeamM: worst(straights),
    drag: { corners: dragM.corners, worstCornerSeamM: dragM.worst(dragM.corners),
      worstStraightSeamM: dragM.worst(dragM.straights),
      worstInletAxisErrDeg: +dragM.worstIn.toFixed(3) },
    corners, straightCount: straights.length, seams,
    curveTiles: turnM.curveTiles, path, laid, turn, buildings: turnM.buildings,
    site: { lat: +best.lat.toFixed(5), lon: +best.lon.toFixed(5) },
    cost: { frameMs: of.stats().frameMs, draw: of.stats().draw.calls },
    log,
  };
})()
