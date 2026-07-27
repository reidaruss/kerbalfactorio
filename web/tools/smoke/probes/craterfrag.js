// WG-28: MEASURE the pale fragments inside a carved crater.
//
// Lane B left this as "cosmetic and unmeasured", which is the state a defect
// stays in until someone gives it a number. The complaint is that a dug crater
// contains small disconnected PALE patches, brighter than the bowl around them,
// with nothing in the geometry to explain them.
//
// The measurement is a LOCAL BRIGHTNESS OUTLIER count, because that is what the
// complaint literally describes. Take the rendered frame as a tile grid, and for
// each tile inside the crater compare it against the MEDIAN of its eight
// neighbours. A smooth bowl varies slowly, so every tile is near its
// neighbourhood; a fragment is a tile that is much brighter than everything
// touching it. Median rather than mean so one fragment cannot raise the
// baseline it is being judged against.
//
// The mechanism turned out to be in the mesher rather than in the filter: every
// triangle surface nets emitted was wound inside out, the client draws that mesh
// back-face-culled, and an inverted closed surface does not vanish, it draws its
// FAR side through its near side. Inside a bowl that reads as bright patches
// floating in the dark. Run this against the pre-WG-28 wasm for the before.
//
//   node tools/smoke/run.mjs --scenario=walk \
//        --evalfile=tools/smoke/probes/craterfrag.js \
//        --out=docs/screenshots/WG28_crater.png --url=http://127.0.0.1:4187/
(async () => {
  const of = window.__of;
  const log = [];
  const settle = async (secs) => {
    of.input.tape([{ hold: Math.ceil(60 * secs) + 30, keys: [] }]);
    await of.run(secs, 60);
  };

  await settle(1.2);
  const w0 = of.world();
  if (w0.player === null) return { valid: false, why: 'no character' };
  if (of.voxels() === null) return { valid: false, why: 'no voxel layer' };
  await of.wipe();
  of.forgetTunnels();
  const t0 = of.world();

  const SITE = { latDeg: OF_ARGS.latDeg ?? 2.0, lonDeg: OF_ARGS.lonDeg ?? 144.0 };
  const degPerM = 180 / (Math.PI * w0.bodyRadiusM);
  of.teleport(SITE.latDeg, SITE.lonDeg, 2.0);
  await settle(OF_ARGS.arriveSecs ?? 2.5);
  of.setTime(OF_ARGS.sunT ?? 0.3);

  // --- CARVE FROM A RING OF STATIONS, which is how probes/digquality.js does it
  // and for a reason this probe had to learn twice. Standing still and aiming
  // around carves two spheres and then MISSES: once the first bowl is deeper
  // than the dig reach, the ray leaves through the hole and finds no wall. The
  // first version of this probe reported a 17-cell "crater" from 12 strikes and
  // refused to call itself valid, which is the harness working.
  const strikes = [];
  const RING_M = OF_ARGS.ringM ?? 2.5;
  const stations = OF_ARGS.stations ?? 6;
  for (let i = 0; i < stations; ++i) {
    const th = (2 * Math.PI * i) / stations;
    of.teleport(SITE.latDeg + RING_M * Math.cos(th) * degPerM,
      SITE.lonDeg + RING_M * Math.sin(th) * degPerM, 2.0);
    await settle(0.6);
    // Aim back across the centre, and one step to each side of it.
    const back = ((th * 180) / Math.PI + 180) % 360;
    for (const yaw of [back - 18, back, back + 18]) {
      for (const pitch of (OF_ARGS.pitches ?? [-38, -55])) {
        of.look(yaw, pitch);
        const d = of.dig();
        strikes.push(d === null ? 0 : d.cells);
        await of.run(0.06, 60);
      }
    }
  }
  const carved = strikes.reduce((p, v) => p + v, 0);

  // --- frame it from a STANDOFF, so the far wall of the bowl crosses the middle
  // of the frame. Standing in the hole and looking down photographs the floor,
  // where a fragment on the far WALL is exactly what is being counted.
  of.teleport(SITE.latDeg + (OF_ARGS.standoffM ?? 9.0) * degPerM, SITE.lonDeg, 2.0);
  await settle(OF_ARGS.shotSettleSecs ?? 3.0);
  of.setTime(OF_ARGS.sunT ?? 0.3);
  of.look(OF_ARGS.shotYawDeg ?? 180, OF_ARGS.shotPitchDeg ?? -20);
  await settle(1.5);

  const TX = OF_ARGS.tilesX ?? 96;
  const TY = OF_ARGS.tilesY ?? 54;
  const fh = of.framehash(TX, TY);
  const t = fh.tiles;
  const at = (x, y) => t[y * TX + x];

  // The crater window: the middle 40% of the frame in x, and the lower middle
  // in y, which is where a -46 degree look puts ground within a few metres.
  const x0 = Math.floor(TX * 0.30), x1 = Math.ceil(TX * 0.70);
  const y0 = Math.floor(TY * 0.30), y1 = Math.ceil(TY * 0.72);

  // TWO metrics, and the second one is here because the first was wrong.
  //
  // The brightness-outlier count below was the obvious reading of "isolated pale
  // fragments" and it ranked the broken frame BETTER than the fixed one: 4
  // outlier tiles before against 9 after. Looking at the two captures explained
  // it in a second. The broken crater is not a lit bowl with specks in it, it is
  // a BLACK VOID with specks in it, because the mesh was inverted and
  // back-face-culled, so the shards were the far wall showing through a hole
  // where the near wall should have been. A void has almost nothing for a bright
  // tile to be an outlier against, so counting outliers rewarded it.
  //
  // So the load-bearing metric is the VOID: tiles inside the crater window that
  // are near black. That is the hole in the picture, and it is what actually
  // changed. The outlier count stays as the secondary reading, reported and not
  // asserted, with its own history attached, because a metric that once pointed
  // the wrong way is worth keeping visible.
  //
  // DW-7's lesson, which this is the third instance of in this project:
  // structural validation cannot replace looking at the thing.
  const DARK = OF_ARGS.darkThreshold ?? 26;   // tile units, 0..255
  let voidTiles = 0, windowTiles = 0, darkest = 255;

  const THRESH = OF_ARGS.threshold ?? 16;   // tile units, 0..255
  const excesses = [];
  let outliers = 0, examined = 0, worst = 0;
  const spots = [];
  for (let y = Math.max(1, y0); y < Math.min(TY - 1, y1); ++y) {
    for (let x = Math.max(1, x0); x < Math.min(TX - 1, x1); ++x) {
      ++windowTiles;
      const here = at(x, y);
      if (here < darkest) darkest = here;
      if (here < DARK) ++voidTiles;
      const ring = [];
      for (let dy = -1; dy <= 1; ++dy)
        for (let dx = -1; dx <= 1; ++dx)
          if (dx !== 0 || dy !== 0) ring.push(at(x + dx, y + dy));
      ring.sort((a, b) => a - b);
      const med = 0.5 * (ring[3] + ring[4]);
      const ex = at(x, y) - med;
      ++examined;
      excesses.push(ex);
      if (ex > worst) worst = ex;
      if (ex > THRESH) {
        ++outliers;
        if (spots.length < 24) spots.push({ x, y, excess: +ex.toFixed(1) });
      }
    }
  }
  excesses.sort((a, b) => a - b);
  const p99 = excesses[Math.min(excesses.length - 1,
    Math.floor(excesses.length * 0.99))];

  const v = of.voxels();
  const wEnd = of.world();
  log.push(`carved ${carved} cells over ${strikes.length} strikes; `
    + `near mesh ${v.mesh.verts ?? '?'} verts, ${v.mesh.tris ?? '?'} tris, visible ${v.meshVisible}`);
  log.push(`VOID: ${voidTiles} of ${windowTiles} crater tiles are darker than `
    + `${DARK}/255 (darkest ${darkest.toFixed(1)})`);
  log.push(`fragments (secondary): ${outliers} of ${examined} tiles exceed their `
    + `neighbourhood median by more than ${THRESH}; worst ${worst.toFixed(1)}, `
    + `p99 ${p99.toFixed(1)}`);

  return {
    // The measurement is worth nothing if nothing was dug and the mesh is not
    // on screen, so both are part of validity rather than of the result.
    valid: (wEnd.tick - t0.tick) > 200 && carved > 40 && v.meshVisible === true
      && examined > 500,
    advanced: { ticks: wEnd.tick - t0.tick, carvedCells: carved, strikes },
    voidM: { darkTiles: voidTiles, windowTiles, darkThresholdUnits: DARK,
      darkest: +darkest.toFixed(1),
      pctOfCrater: +((100 * voidTiles) / Math.max(1, windowTiles)).toFixed(1) },
    fragments: { outlierTiles: outliers, examinedTiles: examined,
      thresholdUnits: THRESH, worstExcess: +worst.toFixed(1),
      p99Excess: +p99.toFixed(1), spots },
    // REPORTED, AND NOT A GATE, and saying so is the point.
    //
    // Measured both ways on the same site and camera with only the wasm swapped:
    // pre-WG-28 darkest tile 27.0, post-fix 32.6, and 0 tiles under any
    // threshold that separates them from ordinary shadow. The captures
    // (WG28_crater_before.png against WG28_crater_after.png) are unambiguous,
    // a black void full of pale shards against a lit bowl, and this instrument
    // cannot see the difference: a 96 x 54 tile grid averages roughly 17 x 17
    // pixels per tile, and a field of thin shards averages back to the mean.
    //
    // The threshold is therefore left where it was chosen and NOT tuned to sit
    // between 27.0 and 32.6, which would have manufactured a passing gate out of
    // two numbers that do not separate. The real gate for this defect lives in
    // /core, where it can be stated exactly:
    // `mesh_triangles_face_out_of_the_rock` in test_voxel_field.cpp fails 9
    // checks on the pre-fix mesher. A per-pixel dark-run count would probably
    // separate these frames and is the honest follow-up for this probe.
    craterIsNotAVoid: windowTiles > 0
      && (100 * voidTiles) / windowTiles <= (OF_ARGS.maxVoidPct ?? 2.0),
    separatesTheTwoBuilds: false,
    frame: { tilesX: TX, tilesY: TY, litPct: fh.litPct, holePixels: fh.holePixels,
      window: { x0, x1, y0, y1 } },
    mesh: v.mesh, meshVisible: v.meshVisible,
    // Doubles as proof of WHICH BUILD ran. `removedCells` is the field's
    // air-override counter, which WG-28 fixed to follow an overwrite as well as
    // an insert, so the pre-fix wasm under-reports it here and a before/after
    // pair that shows the same number was measuring the same binary twice.
    editCounts: { removed: v.removedCells, added: v.addedCells },
    log,
  };
})()
