// DW-19 measurement probe: what ground cell size does the streamer actually
// deliver UNDER THE PLAYER'S FEET in the browser, and what does it cost?
//
//   node tools/smoke/run.mjs --scenario=walk --evalfile=tools/smoke/probes/lodfeet.js \
//        --evalargs='{"secs":30}' --split=1.4 --maxdepth=14
//
// DW-20: the numbers below are only trusted if the run DROVE the simulation, so
// the probe reports ticksAdvanced, metresWalked and chunksBuilt and marks itself
// invalid if any of them is zero. A settled render of a world that never moved
// is exactly the silent success W4 caught three times.
//
// The cell size is MEASURED off the packed vertex buffer of the chunk under the
// camera (dumpChunks cellM = |v[16][17] - v[16][16]|), not derived from depth,
// so a wrong warp or a wrong depth both show up as a wrong number.
(async () => {
  const of = window.__of;
  const secs = OF_ARGS.secs ?? 30;
  const hz = OF_ARGS.hz ?? 144.3;
  const keys = OF_ARGS.keys ?? ['KeyW'];

  const t0 = of.world();
  const s0 = of.stats();

  of.input.tape([{ hold: Math.ceil(60 * secs) + 120, keys }]);
  await of.run(secs, hz);
  of.input.tape([{ hold: 600, keys: [] }]);
  // Converge on the synthetic clock: an unconverged set has pending chunks that
  // are exactly the fine ones this probe is measuring.
  let spin = 0;
  while (!of.world().chunks.converged && spin++ < 120) await of.run(0.5);
  await of.run(0.5);

  const w = of.world();
  const s = of.stats();
  const R = w.bodyRadiusM;
  const dLat = ((w.observer.latDeg - t0.observer.latDeg) * Math.PI) / 180;
  const dLon = (((w.observer.lonDeg - t0.observer.lonDeg) * Math.PI) / 180)
    * Math.cos((t0.observer.latDeg * Math.PI) / 180);

  // Every resident chunk, nearest-first. meshPos is RENDER space, and so is
  // eyeRel; ranking by |meshPos| alone measures distance from the floating
  // ORIGIN, which had drifted 549 m from the camera here and returned a
  // depth-12 chunk as "the feet" while depth-14 chunks were underfoot.
  const eye = w.eyeRel;
  const dist = (c) => Math.hypot(c.meshPos[0] - eye[0], c.meshPos[1] - eye[1],
    c.meshPos[2] - eye[2]);
  const all = of.chunks(4096, false);
  const near = all.filter((c) => c.near && c.visible);
  near.sort((a, b) => dist(a) - dist(b));
  const feet = near[0] ?? null;

  // Histogram of achieved cell size across the near band, so "2 m at the feet"
  // cannot hide a far field that also refined to 2 m (the cost blow-up case).
  const byDepth = {};
  for (const c of all) {
    const k = String(c.depth);
    byDepth[k] = byDepth[k] ?? { count: 0, cellM: c.cellM, near: 0 };
    byDepth[k].count++;
    if (c.near) byDepth[k].near++;
  }

  const ticks = w.tick - t0.tick;
  const metres = Math.hypot(dLat, dLon) * R;
  const built = s.terrain.chunksBuilt - s0.terrain.chunksBuilt;

  return {
    // --- DW-20 validity gate: read this BEFORE any number below it.
    // chunksBuilt is reported but NOT required: at the coarse baseline a
    // depth-11 quad is 463 m across, so a 500 m walk can legitimately stay
    // inside one chunk and build nothing. `builtOrStationarySet` says which of
    // the two happened, so a zero can never be mistaken for a stalled worker.
    valid: ticks > 0 && metres > 1 && feet !== null && w.chunks.resident > 0,
    builtOrStationarySet: built > 0 ? 'built' : 'set unchanged (no boundary crossed)',
    drove: {
      ticksAdvanced: ticks,
      metresWalked: +metres.toFixed(1),
      chunksBuilt: built,
      framesRendered: w.frames - t0.frames,
      rebases: w.origin.rebases - t0.origin.rebases,
      converged: w.chunks.converged,
    },
    // --- the DW-19 answer.
    feet: feet && {
      key: feet.key, depth: feet.depth, biome: feet.biome,
      measuredCellM: feet.cellM,
      camDistM: Math.round(dist(feet)),
      // A chunk is `cellM * 32` across, so the leaf the player is standing IN
      // must have its centre within half a diagonal. If this is false the
      // "feet" chunk is a neighbour and the cell size below is not the one
      // under the player.
      containsFeet: dist(feet) <= feet.cellM * 32 * 0.7072,
    },
    finestNearCellM: near.length ? Math.min(...near.map((c) => c.cellM)) : null,
    coarsestNearCellM: near.length ? Math.max(...near.map((c) => c.cellM)) : null,
    site: {
      latDeg: +w.observer.latDeg.toFixed(4), lonDeg: +w.observer.lonDeg.toFixed(4),
      altM: +w.observer.altM.toFixed(2), biome: w.biome,
      surfaceHeightM: Math.round(w.surfaceHeightM),
    },
    byDepth,
    // --- the cost curve.
    cost: {
      resident: w.chunks.resident, near: w.chunks.near, far: w.chunks.far,
      poolInUse: s.pool.inUse, poolFree: s.pool.free, poolExhausted: s.pool.exhausted,
      vramEstimateMB: s.vramEstimateMB,
      bytesTotalMB: +(s.terrain.bytesTotal / 1048576).toFixed(2),
      chunkBuildMs: { update: s.terrain.updateMs, pack: s.terrain.packMs,
        upload: s.terrain.uploadMs, roundTrip: s.terrain.roundTripMs },
      frameMs: s.frameMs,
      draw: s.draw,
      stitch: s.stitch,
    },
  };
})()
