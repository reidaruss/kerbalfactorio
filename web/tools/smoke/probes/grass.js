// A-1 / DW-28: does the biome scatter actually PUT the props it was asked for
// on the ground, and does the pool draw all of them?
//
//   node tools/smoke/run.mjs --scenario=walk --url=http://127.0.0.1:4182/ \
//     --evalfile=tools/smoke/probes/grass.js --out=docs/screenshots/RN_grass_after.png
//   ... --scatterfair=0 --propgrow=0 --detail=0   (the shipped behaviour)
//
// TWO PROPERTIES, both asserted, neither a tuned threshold (standing rule 11).
//
// 1. DELIVERY. `Scatter` asks the registry for a density in props per square
//    metre and then quantises it per CELL. The property is that what lands on
//    the ground equals what was asked for, over the ground actually drawn on,
//    at whatever terrain LOD depth that ground arrived at. `deliveredFraction`
//    is placed/wanted and must be 1 within sampling noise. It is a RATIO, so a
//    terrain change cannot move it and a density change cannot satisfy it.
//    The shipped `Math.round(expected)` fails this at 0.0000, not at 0.9: at
//    the DW-19 cell size the expectation is 0.389 props per cell and rounding
//    it is exactly zero, forever, on every chunk near the player.
//
// 2. NOTHING IS DROPPED SILENTLY (DW-28). `props.refused` is instances that
//    were placed and are not on screen, and `cellsCapped` / `chunksCapped` are
//    the two places the sampler can truncate its own draw. All three must be 0.
//
// The two are independent on purpose: delivery can be perfect while the pool
// eats a quarter of it, which is exactly the state this probe was written for.
(async () => {
  const of = window.__of;
  const secs = OF_ARGS.secs ?? 12;

  const w0 = of.world();
  // Walk, so the measurement covers chunks that streamed in DURING the run and
  // not only the ones the boot happened to build. A stationary probe here would
  // have passed against the defect on any chunk that arrived at a coarse depth.
  of.input.tape([{ hold: Math.ceil(60 * secs) + 120, keys: ['KeyW'] }]);
  await of.run(secs, 144.3);
  of.input.tape([{ hold: 600, keys: [] }]);
  let spin = 0;
  while (!of.world().chunks.converged && spin++ < 120) await of.run(0.5);
  await of.run(0.5);

  const w = of.world();
  const s = of.stats();
  const p = s.props;
  const R = w.bodyRadiusM;
  const dLat = ((w.observer.latDeg - w0.observer.latDeg) * Math.PI) / 180;
  const dLon = (((w.observer.lonDeg - w0.observer.lonDeg) * Math.PI) / 180)
    * Math.cos((w0.observer.latDeg * Math.PI) / 180);
  const metres = Math.hypot(dLat, dLon) * R;

  // Cell size actually under the feet, so a delivery figure can never be read
  // without the number that broke it.
  const eye = w.eyeRel;
  const dist = (c) => Math.hypot(c.meshPos[0] - eye[0], c.meshPos[1] - eye[1],
    c.meshPos[2] - eye[2]);
  const near = of.chunks(4096, false).filter((c) => c.near && c.visible);
  near.sort((a, b) => dist(a) - dist(b));
  const feet = near[0] ?? null;

  // The claim is "the ground reads as bare", which is about SCREEN COVERAGE and
  // not about instance counts. Pin the camera (yaw 0, pitch -15) so the ground
  // 20 to 50 m ahead fills the box, then difference the frame with and without
  // the foliage layer. `bothBlack` guards the degenerate reading: a camera
  // pointed at the sky would honestly score 0 coverage, and so would a camera
  // pointed at nothing, and those are not the same answer.
  of.look(OF_ARGS.yawDeg ?? 0, OF_ARGS.pitchDeg ?? -15);
  await of.run(0.5);
  const cover = await of.groundCover(OF_ARGS.halfPx ?? 300, 6);

  const wanted = p.wantedPerM2;
  const placed = p.placedPerM2;
  const delivered = p.deliveredFraction;
  // Sampling noise only. Every cell contributes one Bernoulli draw for its
  // fractional part, so over the thousands of cells in the ring the relative
  // standard deviation is well under 1%; 5% is four times that and is a bound
  // on NOISE, not a tolerance on the answer. The failing case is 0.0000.
  const TOL = 0.05;

  return {
    valid: w.tick > w0.tick && metres > 1 && p.chunks > 0 && feet !== null,
    drove: {
      ticksAdvanced: w.tick - w0.tick,
      metresWalked: +metres.toFixed(1),
      chunksScattered: p.chunks,
      converged: w.chunks.converged,
      framesRendered: w.frames - w0.frames,
    },
    // Standing rule 7: the flags that reproduce the OLD behaviour in this same
    // binary, echoed back so a result can never be attributed to the wrong run.
    // `registeredProps` is 41 without the detail atlas and 45 with it.
    isolation: {
      fairQuantise: p.fairQuantise, poolGrows: p.growable,
      registeredProps: p.props, materialBatches: p.batches,
    },
    ground: {
      feetCellM: feet && +feet.cellM.toFixed(3),
      feetDepth: feet && feet.depth,
      biome: w.biome,
      cellsScattered: p.cellsScattered,
      groundM2: p.groundM2,
    },
    // --- PROPERTY 1: delivery.
    delivery: {
      wantedPerM2: wanted, placedPerM2: placed, deliveredFraction: delivered,
      propsPlaced: p.propsPlaced,
      ok: wanted > 0 && Math.abs(delivered - 1) <= TOL,
    },
    // --- what a player actually sees, from a pinned camera.
    screenCoverage: cover,
    // --- PROPERTY 2: nothing dropped silently.
    silentDrops: {
      poolRefused: p.refused, cellsCapped: p.cellsCapped,
      chunksCapped: p.chunksCapped, scatterBacklog: p.scatterBacklog,
      ok: p.refused === 0 && p.cellsCapped === 0 && p.chunksCapped === 0
        && p.scatterBacklog === 0,
    },
    pool: {
      batches: p.batches, instances: p.instances, capacity: p.capacity,
      ceiling: p.ceiling, grows: p.grows, perMaterial: p.perMaterial,
      // What the OLD fixed cap of 7,000 per material would have dropped, read
      // off the live high-water marks rather than argued.
      wouldDropAtFixed7000: p.perMaterial
        .reduce((a, m) => a + Math.max(0, m.live - 7000), 0),
    },
    cost: {
      drawCalls: s.draw.calls, triangles: s.draw.triangles,
      frameMs: s.frameMs, scatterBuildMs: p.buildMs,
      vramEstimateMB: s.vramEstimateMB,
    },
  };
})()
