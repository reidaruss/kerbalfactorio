// WG-190: DID THE GROUND MOVE? The bit-stability gate for a tessellation change.
//
//   node tools/smoke/run.mjs --url=http://127.0.0.1:4425/ --scenario=walk \
//     --maxdepth=14 --evalfile=tools/smoke/probes/lodheights.js
//
// A near-LOD change is only allowed to move TRIANGLES. If it moves a HEIGHT it
// has moved the world: every save is seed-plus-diff, so a height that depends on
// a video setting would make a save load differently on a different machine, and
// the walker would stand somewhere else.
//
// TWO SURFACES ARE SAMPLED BECAUSE THERE ARE TWO, AND ONLY ONE OF THEM IS THE
// AUTHORITY.
//
//   1. THE ORACLE (`world().surfaceHeightM`). This is `SurfaceOracle.surfaceHeight`,
//      the analytic field. ARCHITECTURE.md 5.3: there is NO mesh collision at
//      all, the capsule tests this function directly, so this is the ground the
//      player stands on, the aim ray hits and the build system snaps to. If this
//      is bit-identical across maxDepth then physics, collision and gameplay
//      cannot have moved, whatever the renderer did.
//
//   2. THE DRAWN MESH (`meshVerts`), reported as the height of the vertex
//      NEAREST each probe point. The quadtree refines by two, so every vertex of
//      a depth-d chunk is also a vertex of the depth-(d+1) chunks under it: the
//      finer mesh ADDS samples between the old ones and must not MOVE them. The
//      nearest-vertex height is therefore expected to agree to float32 whenever
//      the nearest vertex is the same one, and the reported `nearestM` says
//      whether it was.
//
// Full precision on purpose. A rounded height cannot prove bit-stability, and
// "close enough" is exactly the tolerance that hides a real move.
(async () => {
  const of = window.__of;
  const A = OF_ARGS ?? {};
  // Spread deliberately across biomes and relief: a plain, the levelled spawn
  // pad, a mountain flank, the ruin walk, and two arbitrary far sites. A gate
  // that only samples flat ground proves nothing about a mountain.
  const sites = A.sites ?? [
    { name: 'forestfloor', lat: -19.85, lon: -72.7853 },
    { name: 'spawnhills', lat: -3.41413, lon: 150.27984 },
    { name: 'mountain', lat: 2.0, lon: 144.0 },
    { name: 'ruinwalk', lat: -3.40, lon: 150.29 },
    { name: 'far_a', lat: 41.2, lon: 17.6 },
    { name: 'far_b', lat: -63.75, lon: -128.4 },
  ];

  const out = [];
  for (const s of sites) {
    of.teleport(s.lat, s.lon, s.altM ?? 2);
    await of.settle(A.settle ?? 5);
    let spin = 0;
    while (!of.world().chunks.converged && spin++ < 90) await of.run(0.5);
    const w = of.world();
    const feet = w.player ? w.player.feet : null;

    // Nearest DRAWN vertex to the feet, and its height.
    let nearestM = null;
    let meshHM = null;
    if (feet !== null) {
      const raw = of.meshVerts(feet[0], feet[1], feet[2], 6);
      let best = Infinity;
      for (const v of raw) {
        // Skirt vertices hang below their edge twin at nearly the same dM, so
        // the TOP sample at a tie is the surface. Rank on tangential distance
        // and break ties upward.
        if (v.dM < best - 1e-9 || (Math.abs(v.dM - best) <= 1e-9 && (meshHM === null || v.hM > meshHM))) {
          best = Math.min(best, v.dM); meshHM = v.hM;
        }
      }
      nearestM = Number.isFinite(best) ? best : null;
    }

    out.push({
      name: s.name,
      biome: w.biome,
      // The authority. Full precision, no toFixed.
      oracleHeightM: w.surfaceHeightM,
      bodyRadiusM: w.bodyRadiusM,
      feetRadiusM: feet === null ? null : Math.hypot(feet[0], feet[1], feet[2]),
      meshNearestM: nearestM,
      meshHeightM: meshHM,
      converged: w.chunks.converged,
      feetDepth: (of.chunks(4096, true)[0] ?? {}).depth ?? null,
    });
  }
  return { valid: out.every((r) => r.converged && Number.isFinite(r.oracleHeightM)), sites: out };
})()
