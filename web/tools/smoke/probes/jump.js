// DW-18 gravity probe. Drives a real Space press through the same input queue a
// keyboard fills, samples the fixed tick, and reports the MEASURED airtime and
// apex plus the gravity the walker actually integrated.
//
//   node tools/smoke/run.mjs --scenario=walk --evalfile=tools/smoke/probes/jump.js
//
// DW-20: airtime is counted from the grounded flag transitions across ticks, so
// a jump that never left the ground reports 0 rather than a plausible number.
(async () => {
  const of = window.__of;
  const jumps = OF_ARGS.jumps ?? 3;

  // Settle on the ground first: a jump measured during the spawn drop is a fall.
  of.input.tape([{ hold: 120, keys: [] }]);
  await of.run(2, 60);

  const runs = [];
  for (let j = 0; j < jumps; ++j) {
    const base = of.world();
    if (!base.player.grounded) { await of.run(2, 60); }
    const alt0 = of.world().observer.altM;

    // One tick of Space, then release: holding it would re-trigger on landing.
    of.input.tape([{ hold: 2, keys: ['Space'] }, { hold: 300, keys: [] }]);

    let airTicks = 0, apex = alt0, leftGround = false, sampled = 0;
    // Sample at the fixed tick rate: 1/60 s of sim per step.
    for (let i = 0; i < 240; ++i) {
      await of.run(1 / 60, 60);
      sampled++;
      const w = of.world();
      apex = Math.max(apex, w.observer.altM);
      if (!w.player.grounded) { airTicks++; leftGround = true; }
      else if (leftGround && airTicks > 1) break;
    }
    runs.push({
      airtimeSecs: +(airTicks / 60).toFixed(3),
      apexM: +(apex - alt0).toFixed(3),
      ticksSampled: sampled,
      leftGround,
    });
    of.input.tape([{ hold: 60, keys: [] }]);
    await of.run(1, 60);
  }

  const w = of.world();
  const R = w.bodyRadiusM;
  const rSurface = R + w.surfaceHeightM;
  // The gravity the walker integrates, read back through the same bridge call
  // KinematicBody uses. If this is 0.587 the DW-18 change did not reach the
  // browser; if it is 9.81 it did.
  const g = of.gravity ? of.gravity(rSurface) : null;

  return {
    valid: runs.every((r) => r.leftGround && r.airtimeSecs > 0),
    bodyRadiusM: R,
    surfaceHeightM: Math.round(w.surfaceHeightM),
    gravityMps2: g === null ? null : +g.toFixed(4),
    // Circular orbital speed from the SAME mu (mu = g * rSurface^2), at 10 km
    // and at an 80 km parking orbit. The 80 km figure is the KSP-scale number
    // DW-18 is buying: about 2.3 km/s, well inside a playable delta-v budget.
    orbitVelKmS: g === null ? null : {
      at10km: +(Math.sqrt(g * rSurface * rSurface / (R + 1e4)) / 1000).toFixed(3),
      at80km: +(Math.sqrt(g * rSurface * rSurface / (R + 8e4)) / 1000).toFixed(3),
    },
    jumps: runs,
    medianAirtimeSecs: runs.map((r) => r.airtimeSecs).sort((a, b) => a - b)[runs.length >> 1],
    medianApexM: runs.map((r) => r.apexM).sort((a, b) => a - b)[runs.length >> 1],
  };
})()
