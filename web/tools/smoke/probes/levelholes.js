// Does a levelled pad have HOLES in it, and if so why?
//
//   node tools/smoke/run.mjs --url=http://127.0.0.1:5199/ --scenario=walk \
//     --evalfile=tools/smoke/probes/levelholes.js --out=docs/screenshots/x.png
//
// The drawn profile of a pad has full-depth dips inside its own radius. Two
// candidate mechanisms, and they call for different fixes:
//
//   (a) the column really is empty. `levelArea` fills a cell when its CENTRE is
//       below the target, so a column whose base is less than one cell below
//       the target has exactly one candidate cell, and whether that cell's
//       centre clears the target is a coin flip. Lose it and the column gets
//       nothing at all.
//   (b) the column is solid but the heightfield refuses to see it, because
//       `derivedRaisingAt` counts a run anchored AT the base and one air cell
//       under a stack of placed ones stops it (the same rule that makes a
//       bridge raise nothing).
//
// So: sample the disc densely, find the columns whose surface did not move,
// and walk each one cell by cell through of.solidAt, which is the voxel shell
// itself. Occupancy tells the two apart.
(async () => {
  const of = window.__of;
  const A = typeof OF_ARGS === 'undefined' ? {} : OF_ARGS;
  const settle = async (secs) => {
    of.input.tape([{ hold: Math.ceil(60 * secs) + 30, keys: [] }]);
    await of.run(secs, 60);
  };

  await settle(1.0);
  if (of.world().player === null) return { valid: false, why: 'no character' };
  await of.wipe();
  of.forgetTunnels();
  const t0 = of.world().tick;

  const lat = A.latDeg ?? 1.79040;
  const lon = A.lonDeg ?? 144.20960;
  const bodyR = of.world().bodyRadiusM;
  of.teleport(lat, lon, 2.0);
  await settle(A.arriveSecs ?? 3.0);
  of.look(0, A.workPitchDeg ?? -72);
  await settle(0.4);

  const r0 = of.level();
  if (r0 === null) return { valid: false, why: 'no ground to level' };
  await settle(1.2);

  const c = [r0.centre.x, r0.centre.y, r0.centre.z];
  const cr = Math.hypot(c[0], c[1], c[2]);
  const up = [c[0] / cr, c[1] / cr, c[2] / cr];
  const seed = Math.abs(up[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0]];
  let e1 = cross(up, seed);
  const L = Math.hypot(...e1); e1 = e1.map((v) => v / L);
  const e2 = cross(up, e1);

  const target = r0.targetHeightM;
  const cols = [];
  const step = A.stepM ?? 0.5;
  const rmax = (A.sampleFrac ?? 0.75) * r0.radiusM;
  for (let a = -rmax; a <= rmax; a += step) {
    for (let b = -rmax; b <= rmax; b += step) {
      if (a * a + b * b > rmax * rmax) continue;
      const p = [0, 1, 2].map((k) => c[k] + e1[k] * a + e2[k] * b);
      const pl = Math.hypot(p[0], p[1], p[2]);
      const d = [p[0] / pl, p[1] / pl, p[2] / pl];
      const s = of.surface(d[0], d[1], d[2]);
      cols.push({ a: +a.toFixed(2), b: +b.toFixed(2), d,
        baseM: s.baseM, surfM: s.surfaceM,
        offsetM: +(s.surfaceM - s.baseM).toFixed(3),
        residualM: +(s.surfaceM - target).toFixed(3) });
    }
  }

  // A column that should have moved (its base is more than half a cell from the
  // target) but did not is the symptom. Walk its voxels: solid all the way from
  // the base up to the target says the heightfield is refusing to see placed
  // ground; air says the ground was never placed.
  const stuck = cols.filter((k) => Math.abs(k.offsetM) < 0.001
    && Math.abs(k.baseM - target) > 0.5);
  const walked = stuck.slice(0, A.walkN ?? 6).map((k) => {
    const occ = [];
    for (let h = -1.5; h <= Math.max(2.5, target - k.baseM + 1.5); h += 1.0) {
      const r = bodyR + k.baseM + h;
      occ.push(of.solidAt(k.d[0] * r, k.d[1] * r, k.d[2] * r) ? 1 : 0);
    }
    return { a: k.a, b: k.b, baseM: +k.baseM.toFixed(2),
      needM: +(target - k.baseM).toFixed(2),
      // Occupancy from 1.5 m below the base upward in 1 m steps.
      occupancy: occ.join('') };
  });

  const residuals = cols.map((k) => k.residualM).sort((x, y) => x - y);
  const q = (f) => residuals[Math.min(residuals.length - 1,
    Math.max(0, Math.round(f * (residuals.length - 1))))];

  return {
    valid: of.world().tick - t0 > 200 && cols.length > 100,
    disc: { targetHeightM: +target.toFixed(3), radiusM: r0.radiusM,
      dug: r0.dug, filled: r0.filled },
    columns: cols.length,
    stuckColumns: stuck.length,
    stuckFraction: +(stuck.length / cols.length).toFixed(3),
    residualM: { min: +residuals[0].toFixed(3), p05: +q(0.05).toFixed(3),
      p50: +q(0.5).toFixed(3), p95: +q(0.95).toFixed(3),
      max: +residuals[residuals.length - 1].toFixed(3),
      spread: +(residuals[residuals.length - 1] - residuals[0]).toFixed(3) },
    // How much of the pad a player would read as floor: within a shin of the
    // height they asked for.
    within025: +(cols.filter((k) => Math.abs(k.residualM) <= 0.25).length / cols.length).toFixed(3),
    within050: +(cols.filter((k) => Math.abs(k.residualM) <= 0.5).length / cols.length).toFixed(3),
    walked,
  };
})()
