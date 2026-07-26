// W5 acceptance, item 1: a tunnel you can WALK DOWN.
//
//   node tools/smoke/run.mjs --scenario=walk \
//        --evalfile=tools/smoke/probes/tunnelwalk.js \
//        --evalargs='{"strikes":16}' --out=docs/screenshots/W5_tunnel_walk.png
//
// dig.js already proved a player can STAND inside a tunnel. This proves they can
// TRAVEL along one, which is the thing that was broken: the bore was narrower
// than the capsule, so a refused step refused the whole tick and the passage ran
// on ahead of a player who could not follow it.
//
// The test is deliberately split in two. The DRIVE phase digs; the WALK phase
// does not dig at all, so every metre it reports is a metre of pre-existing
// tunnel the walker got itself down. Sampling is per slice: grounded, rock
// overhead, and derivedLoweringAt at the player's OWN column, because a trench
// would satisfy "underground with headroom" and look identical from inside.
(async () => {
  const of = window.__of;
  const strikes = OF_ARGS.strikes ?? 16;
  const ramp = OF_ARGS.rampStrikes ?? 6;
  const yaw = OF_ARGS.yawDeg ?? 0;

  const settle = async (secs) => {
    of.input.tape([{ hold: Math.ceil(60 * secs) + 30, keys: [] }]);
    await of.run(secs, 60);
  };
  const hold = async (secs, keys) => {
    of.input.tape([{ hold: Math.ceil(60 * secs) + 30, keys }]);
    await of.run(secs, 60);
  };
  const eye = () => {
    const w = of.world(); const e = w.eyeRel; const o = w.origin;
    return [e[0] + o.x, e[1] + o.y, e[2] + o.z];
  };

  await settle(1.5);
  const t0 = of.world();
  if (of.voxels() === null) return { valid: false, why: 'no character, nothing can dig' };

  // --- DRIVE: sink a shaft, then cut forward, stepping into the cut. ---------
  const shots = [];
  const remesh = [];
  for (let i = 0; i < ramp; ++i) {
    of.look(yaw, -85);
    shots.push(of.dig());
    remesh.push(of.voxels().mesh.lastMs);
    await settle(0.35);
  }
  for (let i = 0; i < strikes; ++i) {
    of.look(yaw, OF_ARGS.pitchDeg ?? -12);
    shots.push(of.dig());
    remesh.push(of.voxels().mesh.lastMs);
    await of.run(0.2, 60);
    await hold(OF_ARGS.stepSecs ?? 0.22, ['KeyW']);
  }
  await settle(1.0);

  // --- WALK: no digging from here. Back out, then walk in again. ------------
  const walk = [];
  let metres = 0;
  let prev = eye();
  let grounded = 0, underRock = 0, blocked = 0, ceilingSolid = 0, columnClosed = 0;
  const sample = () => {
    const w = of.world();
    const p = eye();
    const d = Math.hypot(p[0] - prev[0], p[1] - prev[1], p[2] - prev[2]);
    metres += d;
    prev = p;
    const r = Math.hypot(p[0], p[1], p[2]);
    const up = [p[0] / r, p[1] / r, p[2] / r];
    let ceilM = null;
    for (let h = 0.25; h <= 12; h += 0.25) {
      if (of.solidAt(p[0] + up[0] * h, p[1] + up[1] * h, p[2] + up[2] * h)) { ceilM = h; break; }
    }
    const col = of.surface(up[0], up[1], up[2]);
    const eyeBelowM = (w.bodyRadiusM + col.baseM) - r;
    if (w.player.grounded) grounded++;
    if (w.player.underRock) underRock++;
    if (w.player.blockedByRock) blocked++;
    if (ceilM !== null) ceilingSolid++;
    if (col.loweringM < 0.001) columnClosed++;
    walk.push({
      stepM: +d.toFixed(2),
      grounded: w.player.grounded,
      underRock: w.player.underRock,
      blocked: w.player.blockedByRock,
      speedMps: +w.player.speedMps.toFixed(2),
      ceilingM: ceilM,
      eyeBelowM: +eyeBelowM.toFixed(2),
      loweringM: +col.loweringM.toFixed(3),
    });
  };

  // Retreat along the tunnel, then walk back in. Both directions matter: out is
  // the direction nobody has ever driven, in is the one that was blocked. The
  // slice budget is deliberately short of the shaft, because climbing back out
  // into daylight would end the test with samples that are not in a tunnel at
  // all and would say nothing about walking down one.
  const slices = OF_ARGS.slices ?? 5;
  const sliceSecs = OF_ARGS.sliceSecs ?? 0.4;
  prev = eye();
  for (let i = 0; i < slices; ++i) { await hold(sliceSecs, ['KeyW']); sample(); }
  const outM = +metres.toFixed(2);
  for (let i = 0; i < slices; ++i) { await hold(sliceSecs, ['KeyS']); sample(); }
  await settle(0.6);
  // Frame the capture: third person, looking down the tunnel, so the shot shows
  // the player inside the passage rather than a wall filling the lens.
  if (OF_ARGS.shotView !== 'FP') of.setView('TP');
  of.look(yaw, 0);
  await settle(0.5);

  const w = of.world();
  const v = of.voxels();
  const hits = shots.filter((s) => s !== null && s.cells > 0);
  const n = walk.length;
  const p = eye();
  const r = Math.hypot(p[0], p[1], p[2]);
  const up = [p[0] / r, p[1] / r, p[2] / r];
  const col = of.surface(up[0], up[1], up[2]);

  return {
    // DW-20 first: if the simulation did not advance, nothing below counts.
    valid: hits.length > 0 && v.removedCells > 0 && v.mouth.sent === v.mouth.applied
      && (w.tick - t0.tick) > 600 && metres > 4,
    drove: {
      ticksAdvanced: w.tick - t0.tick,
      framesRendered: w.frames - t0.frames,
      chunksResident: w.chunks.resident,
      converged: w.chunks.converged,
      strikesLanded: hits.length,
      removedCells: v.removedCells,
    },
    // --- THE ACCEPTANCE TEST -------------------------------------------------
    // Walked several metres, on the ground, on a voxel floor, with rock
    // overhead and the heightfield above still closed, for every sample.
    walkableTunnel: metres >= 6 && grounded >= n - 1 && ceilingSolid === n
      && columnClosed === n && underRock >= n - 1,
    metresWalked: +metres.toFixed(2),
    metresIn: outM,
    metresBack: +(metres - outM).toFixed(2),
    samples: n,
    groundedSamples: grounded,
    underRockSamples: underRock,
    blockedSamples: blocked,
    ceilingSolidSamples: ceilingSolid,
    columnClosedSamples: columnClosed,
    walk,
    // --- the re-mesh cost, per strike ---------------------------------------
    remeshMs: {
      each: remesh,
      max: Math.max(...remesh),
      mean: +(remesh.reduce((a, b) => a + b, 0) / remesh.length).toFixed(2),
    },
    mesh: v.mesh,
    meshVisible: v.meshVisible,
    action: v.action,
    finalColumn: { baseM: +col.baseM.toFixed(2), loweringM: +col.loweringM.toFixed(3) },
    site: { lat: +w.observer.latDeg.toFixed(5), lon: +w.observer.lonDeg.toFixed(5),
      altM: +w.observer.altM.toFixed(2), biome: w.biome },
    cost: { frameMs: of.stats().frameMs, draw: of.stats().draw },
  };
})()
