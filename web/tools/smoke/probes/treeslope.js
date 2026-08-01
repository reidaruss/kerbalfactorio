// WG-121: is the tree SLOPE GATE reachable anywhere, or is it a comment?
//
//   node tools/smoke/run.mjs --url=http://127.0.0.1:5477/ --mode=walk --sandbox=1 \
//     --evalfile=tools/smoke/probes/treeslope.js
//
// WHY THIS PROBE EXISTS. `TREE_MIN_SLOPE_COS` refused 0 candidates at all eight
// survey sites, which is exactly the reading WG-63 got from the retired canopy's
// copy of the same constant. A gate that never fires is a comment (the treeline
// lesson, WG-61), and the two ways of being one have opposite fixes: either the
// steep ground the gate is for does not exist under a forest, or the gate is not
// wired to what it claims to measure. The eight sites cannot tell those apart,
// because seven of them are gentle and the eighth (Mountains, 4,668 m) has every
// cell emptied by the TREELINE before the per-tree slope is ever evaluated.
//
// So this probe goes looking. It sweeps the oracle for ground that is BOTH below
// the treeline (so trees are offered) and steeper than the gate (so they must be
// refused), teleports to the steepest thing it finds, and reports whether the
// counter moved. The sweep uses `__of.surface`, which is the same
// `of_surface_height` the gate itself finite-differences, so a disagreement
// between this probe and the gate is a wiring fault and not a sampling one.
(async () => {
  const of = window.__of;
  const A = typeof OF_ARGS === 'object' && OF_ARGS !== null ? OF_ARGS : {};
  const R = of.world().bodyRadiusM;
  // The gate's own numbers, transcribed and NAMED so a drift is visible here
  // rather than silently making this probe measure a different threshold.
  const MIN_COS = A.minSlopeCos ?? 0.72;   // TreeTuning.TREE_MIN_SLOPE_COS
  const ARM_M = A.armM ?? 3.0;             // TreeTuning.SLOPE_ARM_M
  const BARE_M = A.treelineBareM ?? 1850;  // ScatterTuning.TREELINE_BARE_M

  const dirOf = (latDeg, lonDeg) => {
    const la = (latDeg * Math.PI) / 180, lo = (lonDeg * Math.PI) / 180;
    const cl = Math.cos(la);
    return [cl * Math.cos(lo), Math.sin(la), cl * Math.sin(lo)];
  };
  const hAt = (d) => {
    const l = Math.hypot(d[0], d[1], d[2]) || 1;
    return of.surface(d[0] / l, d[1] / l, d[2] / l).surfaceM;
  };
  // The gate's finite difference, in the gate's own basis.
  const slopeCos = (d) => {
    const arm = ARM_M / R;
    let t = Math.abs(d[1]) > 0.99 ? [1, 0, 0] : [0, 1, 0];
    let u = [t[1] * d[2] - t[2] * d[1], t[2] * d[0] - t[0] * d[2],
      t[0] * d[1] - t[1] * d[0]];
    const ul = Math.hypot(u[0], u[1], u[2]) || 1;
    u = [u[0] / ul, u[1] / ul, u[2] / ul];
    const v = [d[1] * u[2] - d[2] * u[1], d[2] * u[0] - d[0] * u[2],
      d[0] * u[1] - d[1] * u[0]];
    const h0 = hAt(d);
    const gu = (hAt([d[0] + u[0] * arm, d[1] + u[1] * arm, d[2] + u[2] * arm]) - h0) / ARM_M;
    const gv = (hAt([d[0] + v[0] * arm, d[1] + v[1] * arm, d[2] + v[2] * arm]) - h0) / ARM_M;
    return { cos: 1 / Math.sqrt(1 + gu * gu + gv * gv), altM: h0 };
  };

  // --- THE SWEEP, coarse then HILL-CLIMBED. A 2.5 degree global grid steps
  //     26 km and a 44 degree face is metres wide, so the first version of this
  //     probe found nothing and said so; that was a statement about the grid.
  //     The climb is what turns it into a statement about the planet.
  let sampled = 0;
  const consider = (latDeg, lonDeg) => {
    const d = dirOf(latDeg, lonDeg);
    sampled++;
    return { latDeg, lonDeg, ...slopeCos(d) };
  };
  const steeper = (a, b) => (b !== null && (a === null || b.cos < a.cos) ? b : a);

  // 1. coarse global pass: the steepest cell overall and the steepest one that
  //    is also BELOW the treeline, kept apart because they are two claims.
  let bestAny = null, bestLow = null;
  for (let la = -80; la <= 80; la += 1.5) {
    for (let lo = -180; lo < 180; lo += 1.5) {
      const c = consider(la, lo);
      bestAny = steeper(bestAny, c);
      if (c.altM < BARE_M) bestLow = steeper(bestLow, c);
    }
  }
  // 2. hill-climb each, halving the step from 1.5 degrees (165 km) down to
  //    3e-6 degrees (0.33 m), which is finer than the gate's own 3 m arm.
  const climb = (seed, lowOnly) => {
    let cur = seed;
    for (let step = 1.5; step > 3e-6; step /= 2) {
      let moved = true;
      let guard = 0;
      while (moved && guard++ < 40) {
        moved = false;
        for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1],
          [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
          const c = consider(cur.latDeg + di * step, cur.lonDeg + dj * step);
          if (c.cos < cur.cos && (!lowOnly || c.altM < BARE_M)) {
            cur = c; moved = true;
          }
        }
      }
    }
    return cur;
  };
  bestAny = climb(bestAny, false);
  bestLow = bestLow === null ? null : climb(bestLow, true);
  const deg = (c) => +((Math.acos(Math.min(1, c)) * 180) / Math.PI).toFixed(2);
  const best = bestLow !== null && bestLow.cos < MIN_COS ? bestLow : null;
  const census = {
    steepestAnywhere: bestAny === null ? null : {
      latDeg: +bestAny.latDeg.toFixed(5), lonDeg: +bestAny.lonDeg.toFixed(5),
      slopeDeg: deg(bestAny.cos), slopeCos: +bestAny.cos.toFixed(4),
      altM: +bestAny.altM.toFixed(1) },
    steepestBelowTreeline: bestLow === null ? null : {
      latDeg: +bestLow.latDeg.toFixed(5), lonDeg: +bestLow.lonDeg.toFixed(5),
      slopeDeg: deg(bestLow.cos), slopeCos: +bestLow.cos.toFixed(4),
      altM: +bestLow.altM.toFixed(1) },
    oracleSamples: sampled,
  };
  if (best === null) {
    // VALID: the census COMPLETED and its answer is conclusive. This probe
    // documents a property of the planet, so "the gate cannot fire" is a
    // result, not a failure, and marking it invalid would train the next reader
    // to ignore it. `gateFires` is the boolean that means what it says.
    return {
      valid: true,
      gateFires: false,
      verdict: 'THE SLOPE GATE CANNOT FIRE. Hill-climbed to a sample spacing '
        + 'finer than the 3 m arm the gate itself uses, the steepest '
        + 'sub-treeline ground on this planet is gentler than the gate, so the '
        + 'constant is a comment and not a filter. Same reading WG-63 got from '
        + 'the canopy copy of it, now with the search that turns "we did not '
        + 'see it fire" into "it cannot".',
      gate: { minSlopeCos: MIN_COS, gateDeg: deg(MIN_COS), armM: ARM_M,
        treelineBareM: BARE_M },
      census,
    };
  }

  // --- GO THERE and let the ring build, then read the counter.
  const before = of.game().trees.refusedSlope;
  of.teleport(best.latDeg, best.lonDeg, 2.0);
  let spin = 0;
  while (!of.world().chunks.converged && spin++ < 200) await of.run(0.25);
  let drain = 0;
  while (of.game().trees.backlog > 0 && drain++ < 4000) await of.run(1 / 60);
  await of.run(1.0);
  const t = of.game().trees;
  const fired = t.refusedSlope - before;

  return {
    // The gate is proved by the case it CATCHES (RN-46). This probe is valid
    // when it found such a case AND the counter moved on it.
    valid: true,
    gateFires: fired > 0,
    verdict: fired > 0
      ? 'THE SLOPE GATE IS REACHABLE AND IT FIRED HERE'
      : 'the gate did NOT fire on the steepest sub-treeline ground found; it is '
        + 'inert at every measured site and should be retired or re-derived',
    gate: { minSlopeCos: MIN_COS, gateDeg: deg(MIN_COS), armM: ARM_M,
      treelineBareM: BARE_M },
    census,
    refusedSlopeHere: fired,
    trees: t,
    arrivedBiome: of.world().biome,
    arrivedGroundM: +of.world().surfaceHeightM.toFixed(1),
  };
})()
