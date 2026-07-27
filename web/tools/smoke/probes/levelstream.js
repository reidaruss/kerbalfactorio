// WG-28: does the STREAMED terrain chunk follow a SUB-CELL levelling op?
//
// ABI 8 (WG-27) fixed the main thread: `of_level_area` returns CORNERS written
// rather than CELLS changed, because on a signed field shaving 30 cm off a slope
// moves the surface under the whole disc without carrying one cell CENTRE across
// the zero level, and gating the re-mesh on cells made a working tool draw
// nothing. The SAME early-out survived in `of_streamer_level`, which is the
// worker's path and the one that owns the geometry the player is looking at.
//
// So the two halves of the engine could disagree, and in the direction that
// hurts: the near voxel skin rebuilt from the client's own dirty box while the
// streamed chunk under the same pad kept the hill. That is DW-26's
// drawn-versus-collided gap arriving through the back door of an early-out, and
// it is not an edge case, because every application after the first on a held
// key is exactly this shape.
//
// This probe forces that shape deliberately: level once so a pad exists, then
// level AGAIN to a target a third of a cell lower, which is a real edit that
// moves no cell centre, and require the drawn chunk to follow the oracle.
//
//   node tools/smoke/run.mjs --scenario=walk \
//        --evalfile=tools/smoke/probes/levelstream.js \
//        --url=http://127.0.0.1:4187/
(async () => {
  const of = window.__of;
  const log = [];
  const settle = async (secs) => {
    of.input.tape([{ hold: Math.ceil(60 * secs) + 30, keys: [] }]);
    await of.run(secs, 60);
  };
  const unit = (p) => {
    const r = Math.hypot(p[0], p[1], p[2]) || 1;
    return [p[0] / r, p[1] / r, p[2] / r];
  };

  await settle(1.2);
  const w0 = of.world();
  if (w0.player === null) return { valid: false, why: 'no character' };
  if (of.terraform() === null) return { valid: false, why: 'no terraforming tool' };
  await of.wipe();
  of.forgetTunnels();
  const bodyR = w0.bodyRadiusM;
  const t0 = of.world();

  // The same slope site probes/level.js settles on, so the two probes are
  // talking about the same ground.
  of.teleport(OF_ARGS.latDeg ?? 1.8784, OF_ARGS.lonDeg ?? 143.8696, 2.0);
  await settle(OF_ARGS.arriveSecs ?? 3.0);
  of.look(OF_ARGS.yawDeg ?? 0, OF_ARGS.pitchDeg ?? -15);
  await settle(0.5);

  // The DRAWN height at a body-frame point: the median of the streamed chunk
  // vertices within `sampleR`, which at the shipped 1.8 m LOD is a handful.
  // Median rather than mean so one skirt vertex hanging below its edge twin
  // cannot drag the answer.
  const drawnAt = (c, sampleR) => {
    const vs = of.meshVerts(c[0], c[1], c[2], sampleR);
    if (vs.length === 0) return { hM: NaN, verts: 0 };
    const hs = vs.map((v) => v.hM).sort((a, b) => a - b);
    return { hM: hs[hs.length >> 1], verts: hs.length };
  };
  const oracleAt = (c) => {
    const u = unit(c);
    return of.surface(u[0], u[1], u[2]).surfaceM;
  };

  const SAMPLE_R = OF_ARGS.sampleRadiusM ?? 3.0;
  // The tolerance is about the INSTRUMENT, not the tool. The chunk samples the
  // field at the shipped 1.8 m LOD and the query disc is 3 m wide, so the median
  // vertex is not the centre vertex. What is being detected is a re-mesh that
  // never happened, which reads as the FULL drop, so the test is the ratio
  // between the drop and the follow error rather than an absolute.
  const TOL_FRAC = OF_ARGS.tolFrac ?? 0.25;

  // A SWEEP, because the first version of this probe asked for one drop size,
  // got told by its own setup check that 0.33 m still moves 224 cell centres,
  // and would otherwise have reported a pass on a case it never built. The
  // question the sweep answers is the one that decides how much the defect is
  // worth: how BIG can an edit be and still move no cell centre at all?
  const rows = [];
  for (const dropM of (OF_ARGS.drops ?? [0.5, 0.1, 0.02, 0.005, 0.001])) {
    await of.wipe();
    of.forgetTunnels();
    await settle(0.8);
    const first = of.level();
    if (first === null) { rows.push({ dropM, why: 'no ground in reach' }); continue; }
    const centre = [first.centre.x, first.centre.y, first.centre.z];
    await settle(1.2);
    const oracle1 = oracleAt(centre);
    const drawn1 = drawnAt(centre, SAMPLE_R);
    const second = of.level(first.targetHeightM - dropM);
    await settle(1.2);
    const oracle2 = oracleAt(centre);
    const drawn2 = drawnAt(centre, SAMPLE_R);
    const subCell = second !== null && second.cells === undefined
      ? false
      : second !== null && second.dug === 0 && second.filled === 0 && second.corners > 0;
    const oracleMoved = oracle1 - oracle2;
    const drawnMoved = drawn1.hM - drawn2.hM;
    rows.push({
      dropM,
      dug: second?.dug ?? null, filled: second?.filled ?? null,
      corners: second?.corners ?? null,
      subCellEdit: subCell,
      oracleMovedM: +oracleMoved.toFixed(4),
      drawnMovedM: +drawnMoved.toFixed(4),
      followErrorM: +Math.abs(drawnMoved - oracleMoved).toFixed(4),
      verts: drawn2.verts,
    });
    log.push(`drop ${dropM.toFixed(3)} m: cells ${second?.dug}+${second?.filled}, `
      + `corners ${second?.corners}, oracle moved ${oracleMoved.toFixed(4)}, `
      + `drawn moved ${drawnMoved.toFixed(4)}`);
  }

  const wEnd = of.world();
  const subCellRows = rows.filter((r) => r.subCellEdit);
  const biggestSubCellM = subCellRows.length
    ? Math.max(...subCellRows.map((r) => r.dropM)) : 0;
  // Only rows the sweep actually built the case for can carry the assertion.
  const followed = subCellRows.every((r) =>
    r.followErrorM <= Math.max(TOL_FRAC * r.dropM, 0.002));

  return {
    valid: (wEnd.tick - t0.tick) > 200 && rows.length > 0
      && rows.every((r) => r.corners !== null && r.corners > 0)
      && rows.every((r) => r.verts > 0),
    advanced: { ticks: wEnd.tick - t0.tick, sweeps: rows.length },
    // THE SETUP PROVES ITSELF (DW-20). If no row produced a cells-zero edit then
    // the sweep never built the case it is named for, and this probe says so
    // rather than reporting a pass on ground it did not test.
    sweepBuiltTheCase: subCellRows.length > 0,
    subCellRows: subCellRows.length,
    biggestSubCellEditM: biggestSubCellM,
    // THE ASSERTION. Against the pre-fix shim `of_streamer_level` returns 0 on
    // exactly these rows and the streamed chunk does not move, so the follow
    // error reads the full drop.
    drawnFollowsTheOracle: followed,
    rows,
    log,
  };
})()
