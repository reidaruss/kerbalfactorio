// WG-186 to WG-189: HOW BIG IS THE POLYGON STEP THE PLAYER IS STANDING ON?
//
//   node tools/smoke/run.mjs --url=http://127.0.0.1:4425/ --scenario=walk \
//     --maxdepth=14 --evalfile=tools/smoke/probes/lodstep.js \
//     --evalargs='{"sites":[{"name":"forest","lat":-19.85,"lon":-72.7853}]}'
//
// WHY THIS EXISTS, AND WHY IT IS NOT `lodfeet`. `lodfeet` answers "what cell
// size arrived" and "what did it cost". Neither is the artifact. A cell size is
// not visible; a CREASE is. The terrain material carries smooth per-vertex
// normals (no `flatShading` anywhere in TerrainMaterial), so a coarse mesh does
// not read as flat facets under a lamp: it reads as a silhouette that STEPS and
// as shading that slides against geometry it does not match. The quantity the
// eye is complaining about is therefore the ANGLE BETWEEN ADJACENT FACETS, in
// degrees, on the ground within a few paces of the feet.
//
// THE ONE PREDICTION THIS PROBE EXISTS TO FALSIFY. The comfortable assumption
// is "halve the cell, halve the crease". That is true only for a field that is
// SMOOTH at the cell scale, where the second difference goes as curvature times
// cell squared and the crease angle therefore goes as cell. If the height field
// still has noise octaves below a metre, the second difference stops shrinking,
// the crease angle goes as 1/cell, and finer tessellation makes the ground
// WORSE while every cost number gets worse too. Which of the two this terrain
// does is a measurement, not an opinion, and it decides whether a deeper LOD is
// worth shipping at all.
//
// METHOD. `of.meshVerts` returns the vertices the GPU is drawing this frame, as
// body-frame offsets from a centre with their relief height. There is no
// connectivity in that list, so the lattice is rebuilt: a tangent basis at the
// feet, each vertex snapped to (round(u/cell), round(v/cell)), and the MAXIMUM
// height kept per lattice cell, which is what drops the skirt vertices (they
// share a direction with their edge twin and hang below it). Second differences
// are then taken along u and along v over triples of adjacent occupied cells.
//
// The crease at a vertex is the honest angle between the two facets that meet
// there, `atan(dh_next/cell) - atan(dh_prev/cell)`, NOT the small-angle
// shortcut: on a 30 degree hillside the shortcut is wrong by a third and this
// probe is pointed at hillsides.
//
// ===========================================================================
// TWO INSTRUMENT TRAPS, BOTH HIT ON THE FIRST RUN OF THIS FILE AND BOTH FIXED
// HERE RATHER THAN NOTED. NUMBERS.md's ratio earning itself again.
// ===========================================================================
//
// 1. THE SAMPLE LIST IS CAPPED AND THE CAP IS SILENT. `meshVertsNear` stops at
//    `limit` (6,000) and returns whatever the view iteration reached first, so
//    at a FIXED physical radius the fine depths come back as a partial, biased
//    disc: the first draft read `occupancy` 1.004 at depth 13 and 0.516 at
//    depth 16, i.e. half the disc missing, and every percentile at the fine end
//    was computed over whichever chunks happened to be iterated first. The
//    radius is therefore derived FROM THE CELL (`cellsRadius` cells out, so the
//    same COUNT of lattice cells at every depth, which is also what makes the
//    depths like-for-like), and a run that still reaches the cap REFUSES.
//
// 2. A CREASE MEASURED ON FLAT GROUND IS A ZERO THAT MEANS NOTHING. The first
//    run was taken at the `forestfloor` art pose, which has 0.38 m of relief
//    across a 24 m disc and a median slope of 0.3 degrees: a table. Every
//    depth read under a degree because there was no shape to resolve, not
//    because the LOD was fine enough. `reliefSpreadM` and `slopeDeg` are
//    published beside every crease number so that reading cannot be repeated,
//    and `sites` takes a list so one page load can visit a plain AND a slope.
//
// DW-20: the run must have DRIVEN something. `valid` gates per site on ticks
// advanced, on a converged chunk set, on the sample list NOT being truncated,
// and on having found enough triples to be a distribution rather than an
// anecdote.
(async () => {
  const of = window.__of;
  const A = OF_ARGS ?? {};
  const cellsRadius = A.cellsRadius ?? 14;
  const minTriples = A.minTriples ?? 150;
  // Must match `meshVertsNear`'s own default `limit`. Hitting it is the trap
  // above; the probe refuses rather than reporting a partial disc.
  const VERT_CAP = A.vertCap ?? 6000;
  const sites = A.sites ?? [{ name: 'forestfloor', lat: -19.85, lon: -72.7853 }];

  const deg = 180 / Math.PI;
  const cr = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const nz = (v) => { const L = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / L, v[1] / L, v[2] / L]; };
  const q = (arr, p) => (arr.length === 0 ? null : +arr[Math.min(arr.length - 1, Math.floor(p * arr.length))].toFixed(4));

  const t0 = of.world();
  const out = [];

  for (const site of sites) {
    of.teleport(site.lat, site.lon, site.altM ?? 2);
    await of.settle(A.settle ?? 6);
    let spin = 0;
    while (!of.world().chunks.converged && spin++ < 120) await of.run(0.5);
    await of.run(0.5);

    const w = of.world();
    const feet = w.player ? w.player.feet : null;
    if (feet === null) { out.push({ name: site.name, valid: false, why: 'no player body (needs --scenario=walk)' }); continue; }

    // The cell actually delivered under the CAMERA, measured off the packed
    // buffer by `dumpChunks`, never derived from the depth. Ranking is on
    // `eyeRel` and not on |meshPos|: the latter measures distance from the
    // floating ORIGIN, which is lodfeet.js's own recorded mis-selection.
    const eye = w.eyeRel;
    const d2 = (c) => (c.meshPos[0] - eye[0]) ** 2 + (c.meshPos[1] - eye[1]) ** 2 + (c.meshPos[2] - eye[2]) ** 2;
    const near = of.chunks(4096, false).filter((c) => c.near && c.visible).sort((a, b) => d2(a) - d2(b));
    const feetChunk = near[0] ?? null;
    if (feetChunk === null) { out.push({ name: site.name, valid: false, why: 'no near chunk under the camera' }); continue; }
    const cell = feetChunk.cellM;
    const radiusM = cellsRadius * cell;

    const raw = of.meshVerts(feet[0], feet[1], feet[2], radiusM);
    const truncated = raw.length >= VERT_CAP;

    const fr = Math.hypot(feet[0], feet[1], feet[2]) || 1;
    const up = [feet[0] / fr, feet[1] / fr, feet[2] / fr];
    const e1 = nz(cr(up, Math.abs(up[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]));
    const e2 = cr(up, e1);

    const grid = new Map();
    for (const v of raw) {
      const i = Math.round((v.dx * e1[0] + v.dy * e1[1] + v.dz * e1[2]) / cell);
      const j = Math.round((v.dx * e2[0] + v.dy * e2[1] + v.dz * e2[2]) / cell);
      const k = `${i},${j}`;
      const cur = grid.get(k);
      if (cur === undefined || v.hM > cur.hM) grid.set(k, { i, j, hM: v.hM, depth: v.depth });
    }

    const creases = [];
    const slopes = [];
    for (const [, c] of grid) {
      for (const [di, dj] of [[1, 0], [0, 1]]) {
        const prev = grid.get(`${c.i - di},${c.j - dj}`);
        const next = grid.get(`${c.i + di},${c.j + dj}`);
        if (prev === undefined || next === undefined) continue;
        // Same LOD level only. A triple straddling a chunk boundary between two
        // depths measures the LOD SEAM, a different artifact with a different
        // fix (EdgeStitch), and folding it in would make the near-field number
        // depend on where the seam happened to fall.
        if (prev.depth !== c.depth || next.depth !== c.depth) continue;
        creases.push(Math.abs(Math.atan2(next.hM - c.hM, cell) - Math.atan2(c.hM - prev.hM, cell)) * deg);
        slopes.push(Math.abs(Math.atan2(next.hM - c.hM, cell)) * deg);
      }
    }
    creases.sort((x, y) => x - y);
    slopes.sort((x, y) => x - y);
    const hs = [...grid.values()].map((c) => c.hM);

    out.push({
      name: site.name,
      valid: !truncated && w.chunks.converged && creases.length >= minTriples,
      truncated,
      drove: { converged: w.chunks.converged, rawVerts: raw.length },
      site: {
        latDeg: +w.observer.latDeg.toFixed(4), lonDeg: +w.observer.lonDeg.toFixed(4),
        biome: w.biome, surfaceHeightM: Math.round(w.surfaceHeightM),
        // A crease number is unreadable without these two. Flat ground gives a
        // zero that says nothing about the LOD.
        reliefSpreadM: hs.length ? +(Math.max(...hs) - Math.min(...hs)).toFixed(3) : 0,
      },
      lattice: {
        cellM: +cell.toFixed(3), feetDepth: feetChunk.depth, radiusM: +radiusM.toFixed(2),
        cells: grid.size, triples: creases.length,
        occupancy: +(grid.size / Math.max(1, Math.PI * cellsRadius ** 2)).toFixed(3),
      },
      // THE ARTIFACT, in degrees. This is the number the lane moves.
      creaseDeg: {
        p50: q(creases, 0.50), p90: q(creases, 0.90), p95: q(creases, 0.95),
        p99: q(creases, 0.99), max: creases.length ? +creases[creases.length - 1].toFixed(4) : null,
        mean: creases.length ? +(creases.reduce((s, x) => s + x, 0) / creases.length).toFixed(4) : null,
      },
      // The ground's own steepness, for scale. A 6 degree crease on 40 degree
      // ground and a 6 degree crease on a plain are not the same complaint.
      slopeDeg: { p50: q(slopes, 0.50), p95: q(slopes, 0.95), max: slopes.length ? +slopes[slopes.length - 1].toFixed(3) : null },
    });
  }

  return {
    valid: out.length > 0 && out.every((s) => s.valid),
    ticksAdvanced: of.world().tick - t0.tick,
    framesRendered: of.world().frames - t0.frames,
    sites: out,
  };
})()
