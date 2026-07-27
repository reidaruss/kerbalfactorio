// WG-31. WHICH DRAWN LAYER SEALS A TUNNEL MOUTH SEEN FROM OUTSIDE.
//
//   node tools/smoke/run.mjs --url=http://127.0.0.1:5211/ --scenario=walk \
//        --evalfile=tools/smoke/probes/tunnelmouth.js \
//        --evalargs='{"shot":"outside"}' \
//        --out=docs/screenshots/WG31_mouth_outside_before.png
//
// THE BUG: "I dug a hole through this mountain, when out the other side looking
// back into the tunnel it looks like its filled in but when you actually go into
// it you can see that its a tunnel." The geometry EXISTS. Something DRAWN closes
// the opening when it is viewed from outside, and only from outside.
//
// Two surfaces go into the same scene and the same depth buffer:
//   A. the streamed heightfield CHUNK mesh (TerrainStream / ChunkGeometryPool),
//      back-face culled, which is why it cannot occlude from INSIDE the rock;
//   B. the near VOXEL surface-nets mesh (VoxelMesh, one THREE.Mesh 'voxelNear').
// This probe attributes the seal to one of them with four independent readings
// and one A/B, over a swept set of outside cameras that are all recorded exactly
// enough to replay:
//
//   1. THE FIELD. A radial march of __of.solidAt through the mouth direction.
//      This is what the ground IS, and it is the same predicate the walker and
//      the mesher read. If it says AIR where a surface is drawn, the surface is
//      being drawn through empty space.
//   2. THE DRAWN SHEET. __of.meshVerts out of the live pooled chunk buffer,
//      in RADII, against the field's own rock top, over a patch that straddles
//      dug and untouched ground so the untouched half is the control.
//   3. THE AIM RAY from each outside camera into the tunnel, plus the same
//      sight line marched against the interpolated chunk surface.
//   4. PIXELS. __of.framehash tiles, with the mouth's tile footprint DERIVED
//      from the measured void half width and the measured camera distance, and
//      compared against a ring of surrounding terrain tiles and against the
//      tunnel interior's own luminance measured from inside on the same run.
//
// Then the A/B that localises it: the same cameras, replayed with
// `--voxelnear=0` (the near voxel mesh is never added to the scene) and with
// `--voxelskin=0` (the whole isosurface instead of only edited cells). The
// per-tile luminance difference between those runs is the near mesh's entire
// visible contribution at the mouth. The drive is deterministic on a seed, so
// the mouth and the cameras repeat across the three runs; the report carries
// the mouth position and every camera's teleport and aim so that is checkable
// rather than assumed.
//
// WHY A SHAFT AND THEN A BORE SWUNG OFF THE FALL LINE, and not a bore straight
// into a hillside face: a sideways tunnel produces zero heightfield lowering by
// construction (voxel_field.h runIsAnchored), so from outside the walker has no
// way IN -- it climbs the unbroken heightfield instead of entering the hole. The
// drive therefore sinks a shaft, bores LEVEL at an angle to the fall line so the
// hillside falls away slowly enough to leave a real passage under intact rock,
// and daylights through the slope. The mouth that produces is geometrically the
// same object as Reid's: a bore axis crossing a sloped surface with the column
// over the passage behind it still closed. The probe MEASURES the crossing with
// solidAt rather than assuming it, and refuses to report if the roof never ran
// out or if no outside camera has a clear line into the passage.
//
// EVERY GEOMETRIC CONSTANT USED TO PLACE THE MEASUREMENT COMES FROM THE TOOL'S
// OWN REPORTED DIG CENTRES (`dig().hit`) or from a march of the field. Nothing
// here remembers a brush radius or a mouth position.
(async () => {
  const of = window.__of;
  const A = typeof OF_ARGS === 'undefined' ? {} : OF_ARGS;
  const DEG = 180 / Math.PI;
  const log = [];

  // --- vector helpers ------------------------------------------------------
  const unit = (p) => { const r = Math.hypot(p[0], p[1], p[2]) || 1; return [p[0] / r, p[1] / r, p[2] / r]; };
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0]];
  const add = (a, b, k) => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const scale = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
  const len = (a) => Math.hypot(a[0], a[1], a[2]);
  const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
  const r3 = (x) => Math.round(x * 1000) / 1000;
  const r2 = (x) => Math.round(x * 100) / 100;
  const toLatLon = (u) => ({ latDeg: Math.asin(clamp(u[1], -1, 1)) * DEG,
    lonDeg: Math.atan2(u[2], u[0]) * DEG });
  const tangentTo = (v, up) => unit(add(v, up, -dot(v, up)));
  /** A tangent frame at direction u: [north-ish, east-ish]. */
  const frameAt = (u) => {
    const n1 = unit(add([0, 1, 0], u, -dot([0, 1, 0], u)));
    return [n1, cross(n1, u)];
  };
  /** Walk `m` metres of great circle from direction u along unit tangent w. */
  const geo = (u, w, m, bodyR) => {
    const ang = m / bodyR;
    return unit(add(scale(u, Math.cos(ang)), w, Math.sin(ang)));
  };

  const settle = async (secs) => {
    of.input.tape([{ hold: Math.ceil(60 * secs) + 30, keys: [] }]);
    await of.run(secs, 60);
  };
  const hold = async (secs, keys) => {
    of.input.tape([{ hold: Math.ceil(60 * secs) + 30, keys }]);
    await of.run(secs, 60);
  };
  const eyeOf = () => of.world().player.aim.origin;
  const solid = (p) => of.solidAt(p[0], p[1], p[2]);
  const hAt = (u) => of.surface(u[0], u[1], u[2]).surfaceM;

  /** Run-length encode solidity along a segment. Air and rock, in order. */
  const runsAlong = (at, from, to, step) => {
    const runs = [];
    let cur = null;
    let firstSolid = null;
    for (let t = from; t <= to + 1e-9; t += step) {
      const s = solid(at(t));
      if (s && firstSolid === null) firstSolid = t;
      if (cur === null || cur.solid !== s) { cur = { solid: s, from: r2(t), to: r2(t) }; runs.push(cur); }
      else cur.to = r2(t);
    }
    return { firstSolid: firstSolid === null ? null : r2(firstSolid), runs };
  };

  await settle(1.5);
  const w0 = of.world();
  if (w0.player === null) return { valid: false, why: 'no character, nothing can dig' };
  if (of.voxels() === null) return { valid: false, why: 'no voxel layer' };
  const bodyR = w0.bodyRadiusM;
  const t0 = w0;

  // =========================================================================
  // 1. FIND A SLOPE TO BORE THROUGH
  //
  // DEFINITION. From a candidate stand point, along a bearing, the surface must
  // DESCEND monotonically (allowing `bumpM` of noise) for `runM` metres, with no
  // 5 m segment steeper than `maxGrade` (a cliff the walker would refuse) and
  // the whole run above `minGroundM` (land, not sea floor). The winner is the
  // largest total drop. A big drop over a walkable slope is exactly what a level
  // bore needs in order to break out of the hillside lower down.
  // =========================================================================
  //
  // THE GRADE BAND IS A BOUND, NOT A TUNING. Its two ends are read off the
  // walker and off the tool, not chosen to make a run pass:
  //   upper 0.55 (28.8 deg)  the shaft has to HOLD the player. A dig at -85 deg
  //     carves a 1.5 m sphere at the feet; on ground steeper than about 30 deg
  //     the downhill wall of that pit is thinner than the capsule and the walker
  //     simply steps out of it downhill, which is exactly what the first run of
  //     this probe recorded on a 0.79 grade (18 strikes, underRock false for
  //     every one, eye descending 1.1 m per step: a walk, not a bore).
  //   lower 0.28 (15.6 deg)  the bore has to BREAK OUT inside the strike budget.
  //     A shaft `shaftDepthM` deep breaks a level bore out after
  //     shaftDepthM / grade metres, and a strike advances about 1 m.
  const RUN_M = A.runM ?? 60;
  const SEG_M = A.segM ?? 5;
  const MAX_GRADE = A.maxGrade ?? 0.55;
  const MIN_GRADE = A.minGrade ?? 0.28;
  const MIN_GROUND_M = A.minGroundM ?? 5;
  const score = (u, w) => {
    let prev = hAt(u);
    const h0 = prev;
    if (h0 < MIN_GROUND_M) return null;
    for (let m = SEG_M; m <= RUN_M + 1e-9; m += SEG_M) {
      const h = hAt(geo(u, w, m, bodyR));
      if (h < MIN_GROUND_M) return null;
      const g = (prev - h) / SEG_M;
      if (g > MAX_GRADE || g < MIN_GRADE) return null;
      prev = h;
    }
    return h0 - prev;
  };
  const bearing = (u, i, n) => {
    const [e1, e2] = frameAt(u);
    const th = (2 * Math.PI * i) / n;
    return unit(add(scale(e1, Math.cos(th)), e2, Math.sin(th)));
  };
  let best = null;
  let sampled = 0;
  const sweep = (centreU, spanM, stepM, nBear) => {
    const [e1, e2] = frameAt(centreU);
    for (let a = -spanM; a <= spanM + 1e-9; a += stepM) {
      for (let b = -spanM; b <= spanM + 1e-9; b += stepM) {
        const m = Math.hypot(a, b);
        const d = m < 1e-6 ? centreU
          : geo(centreU, unit(add(scale(e1, a), e2, b)), m, bodyR);
        sampled++;
        for (let i = 0; i < nBear; ++i) {
          const w = bearing(d, i, nBear);
          const s = score(d, w);
          if (s !== null && (best === null || s > best.dropM)) best = { u: d, w, dropM: s };
        }
      }
    }
  };
  const tSweep = performance.now();
  sweep(unit(w0.player.feet), A.coarseSpanM ?? 2400, A.coarseStepM ?? 200, 8);
  if (best === null) return { valid: false, why: 'no walkable descending slope found near spawn' };
  sweep(best.u, A.fineSpanM ?? 200, A.fineStepM ?? 25, 24);
  const sweepMs = r2(performance.now() - tSweep);
  const startU = best.u;
  const startLL = toLatLon(startU);
  log.push(`slope search: ${sampled} points in ${sweepMs} ms, best drop `
    + `${r2(best.dropM)} m over ${RUN_M} m at lat ${r3(startLL.latDeg)} lon ${r3(startLL.lonDeg)}`);

  // =========================================================================
  // 2. STAND THERE, WAIT FOR THE STREAM, FACE DOWNHILL
  // =========================================================================
  of.teleport(startLL.latDeg, startLL.lonDeg, 2.0);
  await settle(A.arriveSecs ?? 5.0);
  let streamSecs = 0;
  for (let i = 0; i < 60; ++i) {
    const w = of.world();
    if (w.chunks.converged
      && of.meshVerts(w.player.feet[0], w.player.feet[1], w.player.feet[2], 30).length > 8) break;
    await settle(0.5);
    streamSecs += 0.5;
  }
  of.setTime(A.sunT ?? 0.32);
  await settle(0.5);

  // The mapping from `look` yaw degrees to a body-frame bearing is not
  // published, so it is MEASURED: read the aim at yaw 0 and yaw 90, project both
  // onto the local tangent plane, and express any target bearing in that pair.
  const solveYaw = async (targetTangent, up) => {
    of.look(0, 0); await settle(0.1);
    const b0 = tangentTo(of.world().player.aim.dir, up);
    of.look(90, 0); await settle(0.1);
    const b90 = tangentTo(of.world().player.aim.dir, up);
    return (Math.atan2(dot(targetTangent, b90), dot(targetTangent, b0)) * DEG + 360) % 360;
  };
  const upStart = unit(eyeOf());
  const downhill = tangentTo(best.w, upStart);
  // THE BORE DOES NOT RUN STRAIGHT DOWNHILL, and the first two runs are why.
  // Straight down the fall line the roof is gone after six metres: the bore
  // climbs about 0.12 m a strike (a level swing leaves its floor one dig radius
  // under the eye, and the walker steps up onto it) while the hillside falls
  // away underneath at the full grade, so a 9 m shaft is spent almost at once
  // and what you get is an alcove, not a tunnel. Swung `boreAzOffsetDeg` off the
  // fall line the bore only spends grade*cos(offset) per metre, so the same
  // shaft buys tens of metres of tunnel under intact rock and still breaks out
  // through the slope. That is the shape of Reid's bore: a long level passage
  // that daylights on a hillside.
  const offRad = ((A.boreAzOffsetDeg ?? 70) * Math.PI) / 180;
  const sideStart = unit(cross(upStart, downhill));
  const boreDir = unit(add(scale(downhill, Math.cos(offRad)), sideStart, Math.sin(offRad)));
  const yawDeg = r2(await solveYaw(boreDir, upStart));
  const yawDownhillDeg = r2(await solveYaw(downhill, upStart));
  log.push(`downhill yaw ${yawDownhillDeg} deg, bore yaw ${yawDeg} deg `
    + `(${A.boreAzOffsetDeg ?? 70} deg off the fall line)`);

  // =========================================================================
  // 3. DRIVE: shaft, then a level bore downhill until it breaks out
  // =========================================================================
  const startSurfaceM = hAt(startU);
  const shaft = A.shaftStrikes ?? 6;
  const strikes = A.strikes ?? 40;
  const borePitch = A.borePitchDeg ?? 0;
  const shaftLog = [];
  for (let i = 0; i < shaft; ++i) {
    of.look(yawDeg, -85);
    const s = of.dig();
    await settle(0.35);
    const w = of.world();
    shaftLog.push({ i, cells: s?.cells ?? 0,
      eyeReliefM: r2(len(eyeOf()) - bodyR),
      belowStartSurfaceM: r2(startSurfaceM + 1.62 - (len(eyeOf()) - bodyR)),
      underRock: w.player.underRock });
  }
  const shaftDepthM = r2(startSurfaceM + 1.62 - (len(eyeOf()) - bodyR));
  const bore = [];
  let misses = 0;
  let boreStruck = 0;
  for (let i = 0; i < strikes; ++i) {
    of.look(yawDeg, borePitch);
    const s = of.dig();
    const w = of.world();
    const rec = {
      i, cells: s?.cells ?? 0,
      hit: s?.hit === null || s?.hit === undefined ? null : [s.hit.x, s.hit.y, s.hit.z],
      underRock: w.player.underRock,
      eyeR: r2(len(eyeOf())) - bodyR,
    };
    bore.push(rec);
    boreStruck++;
    // STOP AT THE BREAKOUT. Left running, the walker leaves the mouth behind and
    // strolls down the hillside swinging at empty air, which is how the first
    // run ended 16 m past its own tunnel.
    if (rec.cells > 0) misses = 0; else misses++;
    if (misses >= (A.stopAfterMisses ?? 3) && bore.filter((b) => b.cells > 0).length >= 5) break;
    await of.run(0.2, 60);
    await hold(A.stepSecs ?? 0.22, ['KeyW']);
  }
  await settle(1.0);
  const vDrive = of.voxels();
  const boreHits = bore.filter((b) => b.hit !== null && b.cells > 0);
  if (boreHits.length < 3) {
    return { valid: false, why: 'the level bore removed nothing; no tunnel to look into',
      bore, shaft: shaftLog, shaftDepthM, startSurfaceM: r2(startSurfaceM),
      slopeDropM: r2(best.dropM), log };
  }

  // =========================================================================
  // 4. THE MOUTH, derived from the tool's own dig centres and from the FIELD
  //
  // The bore AXIS is first reported dig centre -> last reported dig centre. The
  // MOUTH is where the ROOF over that axis runs out, measured with `solidAt`
  // alone: at each metre along the axis, march radially outward and total the
  // solid metres between the axis and open sky. Inside the hill that total is
  // metres of rock; past the breakout it is zero.
  //
  // Defining the mouth off a HEIGHT would have been wrong here and the first run
  // proved it: the shaft and the near half of the bore reconcile the heightfield
  // DOWN, so `of.surface(...).surfaceM` along the axis is below the axis for
  // reasons that have nothing to do with a mouth. The field has no such
  // ambiguity, and it is the same predicate the collider reads.
  // =========================================================================
  const pFirst = boreHits[0].hit;
  const pLast = boreHits[boreHits.length - 1].hit;
  const axis = unit(sub(pLast, pFirst));
  const SKY_MARGIN_M = A.skyMarginM ?? 6;
  /** Metres of solid cell on the radial from P outward to the pristine sky. */
  const roofOver = (P) => {
    const u = unit(P);
    const topR = bodyR + of.surface(u[0], u[1], u[2]).baseM + SKY_MARGIN_M;
    let m = 0;
    for (let r = len(P) + 0.25; r <= topR; r += 0.25) if (solid(scale(u, r))) m += 0.25;
    return m;
  };
  const axisTrace = [];
  let mouthP = null;
  let prevT = null, prevRoof = null;
  const ROOF_GONE_M = A.roofGoneM ?? 0.25;
  for (let t = 0; t <= (A.mouthSearchM ?? 70); t += 0.25) {
    const P = add(pFirst, axis, t);
    const roof = roofOver(P);
    if (t % 1 < 0.25) axisTrace.push({ tM: r2(t), roofM: r2(roof), air: !solid(P) });
    if (prevRoof !== null && prevRoof > ROOF_GONE_M && roof <= ROOF_GONE_M) {
      const f = (prevRoof - ROOF_GONE_M) / (prevRoof - roof);
      mouthP = add(pFirst, axis, prevT + f * (t - prevT));
      break;
    }
    prevT = t; prevRoof = roof;
  }
  if (mouthP === null) {
    return { valid: false, why: 'the roof never ran out along the bore axis: no mouth',
      boreRoofTrace: axisTrace, bore, shaft: shaftLog, shaftDepthM,
      startSurfaceM: r2(startSurfaceM), slopeDropM: r2(best.dropM), log };
  }
  // THE POINT THE CAMERA IS ACTUALLY AIMED AT is not the doorway, it is the
  // outermost stretch of axis that is still ROOFED: real tunnel, a few metres
  // in, the band Reid says reads as filled in. The doorway itself is a fully
  // open notch whose column the heightfield HAS reconciled, so aiming there
  // would be measuring the one part of the hole the chunk mesh can express.
  const ROOF_DEEP_M = A.roofDeepM ?? 1.5;
  let interiorP = null;
  for (const row of axisTrace) {
    if (row.air && row.roofM >= ROOF_DEEP_M) interiorP = add(pFirst, axis, row.tM);
  }
  if (interiorP === null) {
    return { valid: false, why: `no axis point is both air and under ${ROOF_DEEP_M} m of roof`,
      boreRoofTrace: axisTrace, bore, shaft: shaftLog, log };
  }
  const mouthU = unit(mouthP);
  const mouthR = len(mouthP);
  const mouthLL = toLatLon(mouthU);
  const mouthSurf = of.surface(mouthU[0], mouthU[1], mouthU[2]);
  // The direction the tunnel points OUT of the hill, on the ground at the mouth.
  const outW = tangentTo(axis, mouthU);
  log.push(`mouth at lat ${r3(mouthLL.latDeg)} lon ${r3(mouthLL.lonDeg)}, `
    + `r-bodyR ${r2(mouthR - bodyR)} m, surface there ${r2(mouthSurf.surfaceM)} m, `
    + `lowering ${r3(mouthSurf.loweringM)} m`);

  // --- 4a. THE VOID, measured. Half widths across the axis at the mouth. -----
  const acrossA = unit(cross(axis, mouthU));
  const acrossB = unit(cross(axis, acrossA));
  const halfWidth = (dir) => {
    for (let t = 0.1; t <= 6; t += 0.1) if (solid(add(mouthP, dir, t))) return r2(t - 0.05);
    return null;
  };
  const void_ = {
    definition: 'first solid cell from the mouth centre along +-two axes normal to the bore',
    acrossPlusM: halfWidth(acrossA), acrossMinusM: halfWidth(scale(acrossA, -1)),
    upM: halfWidth(mouthU), downM: halfWidth(scale(mouthU, -1)),
    normalPlusM: halfWidth(acrossB), normalMinusM: halfWidth(scale(acrossB, -1)),
    mouthCentreIsAir: !solid(mouthP),
  };
  const halfWidthM = Math.max(0.5, ...[void_.acrossPlusM, void_.acrossMinusM,
    void_.upM, void_.downM].filter((x) => x !== null));

  // =========================================================================
  // 5. MEASUREMENT 1: THE FIELD ALONG THE MOUTH RADIAL
  //
  // Straight up and down through the mouth centre. `of.solidAt` is the same
  // predicate the collider and the surface-nets mesher read.
  // =========================================================================
  const surfR = bodyR + mouthSurf.surfaceM;
  const radial = runsAlong((r) => scale(mouthU, r), surfR - 14, surfR + 8, 0.25);
  // The OUTERMOST rock on that radial: the true top of the mountain over the
  // mouth, as the field sees it.
  let rockTopR = null;
  for (const run of radial.runs) if (run.solid) rockTopR = run.to;
  // The AIR BAND the tunnel occupies on that radial: the run containing the
  // mouth centre. Its top is the highest point of the void a viewer outside has
  // to be able to see past in order to see into the tunnel at all.
  let voidTopR = null, voidFloorR = null;
  for (const run of radial.runs) {
    if (!run.solid && mouthR >= run.from - 0.26 && mouthR <= run.to + 0.26) {
      voidTopR = run.to; voidFloorR = run.from;
    }
  }
  const fieldAtMouth = {
    definition: 'of.solidAt marched radially through the mouth centre, 0.25 m steps, '
      + 'radii expressed as metres of relief above the datum',
    surfaceM: r2(mouthSurf.surfaceM), baseM: r2(mouthSurf.baseM),
    loweringM: r3(mouthSurf.loweringM),
    mouthCentreM: r2(mouthR - bodyR),
    rockTopM: rockTopR === null ? null : r2(rockTopR - bodyR),
    voidTopM: voidTopR === null ? null : r2(voidTopR - bodyR),
    voidFloorM: voidFloorR === null ? null : r2(voidFloorR - bodyR),
    voidHeightM: voidTopR === null ? null : r2(voidTopR - voidFloorR),
    /** How far the DRAWN surface height sits above the last solid cell. */
    drawnSurfaceAboveRockTopM: rockTopR === null ? null : r2(surfR - rockTopR),
    /** And above the top of the hole. This is what a viewer has to see past. */
    drawnSurfaceAboveVoidTopM: voidTopR === null ? null : r2(surfR - voidTopR),
    runs: radial.runs.map((x) => ({ solid: x.solid, fromM: r2(x.from - bodyR), toM: r2(x.to - bodyR) })),
  };

  // 5a. THE SAME READING A FEW METRES INSIDE THE DOORWAY, which is the band of
  //     the picture Reid says is filled in: the last stretch of tunnel that is
  //     still under a roof but visible through the opening.
  const insideP = interiorP;
  const insideU = unit(insideP);
  const insideSurf = of.surface(insideU[0], insideU[1], insideU[2]);
  const insideSurfR = bodyR + insideSurf.surfaceM;
  const insideRadial = runsAlong((r) => scale(insideU, r), insideSurfR - 14, insideSurfR + 8, 0.25);
  let insideRockTopR = null;
  for (const run of insideRadial.runs) if (run.solid) insideRockTopR = run.to;
  const fieldInsideDoorway = {
    at: 'interiorP, the outermost roofed point on the bore axis',
    metresInsideMouth: r2(len(sub(mouthP, interiorP))),
    surfaceM: r2(insideSurf.surfaceM), baseM: r2(insideSurf.baseM),
    loweringM: r3(insideSurf.loweringM),
    axisReliefM: r2(len(insideP) - bodyR),
    axisIsAir: !solid(insideP),
    rockTopM: insideRockTopR === null ? null : r2(insideRockTopR - bodyR),
    drawnSurfaceAboveRockTopM: insideRockTopR === null ? null : r2(insideSurfR - insideRockTopR),
    runs: insideRadial.runs.map((x) => ({ solid: x.solid, fromM: r2(x.from - bodyR), toM: r2(x.to - bodyR) })),
  };

  // --- 5b. the heightfield's view of the mouth footprint, as a grid ---------
  const GRID_R = A.gridRadiusM ?? 6;
  const GRID_STEP = A.gridStepM ?? 1.5;
  const grid = [];
  let loweredCols = 0, totalCols = 0;
  for (let a = -GRID_R; a <= GRID_R + 1e-9; a += GRID_STEP) {
    const row = [];
    for (let b = -GRID_R; b <= GRID_R + 1e-9; b += GRID_STEP) {
      const m = Math.hypot(a, b);
      const d = m < 1e-6 ? mouthU
        : geo(mouthU, unit(add(scale(outW, a), acrossA, b)), m, bodyR);
      const s = of.surface(d[0], d[1], d[2]);
      row.push(r3(s.loweringM));
      totalCols++;
      if (s.loweringM > 0.001) loweredCols++;
    }
    grid.push(row);
  }

  // =========================================================================
  // 6. MEASUREMENT 2: THE DRAWN CHUNK SHEET AT THE MOUTH
  //
  // Straight out of the pooled vertex buffer the GPU is drawing this frame.
  // Radii, against the field's own rock top and against the void.
  // =========================================================================
  const MV_R = A.meshVertRadiusM ?? 10;
  const mvAll = of.meshVerts(mouthP[0], mouthP[1], mouthP[2], MV_R);
  // SKIRTS ARE NOT THE SHEET. A chunk hangs a skirt vertex below each edge
  // vertex, sharing its direction, and meshVertsNear deliberately returns both
  // (its own comment says so). Left in, the "lowest drawn vertex over the mouth"
  // was 10.8 m under the rock: a skirt, not a surface anybody can see. Bucketing
  // by TANGENTIAL position and keeping the highest radius per bucket keeps the
  // top sheet and drops the apron, without a height threshold.
  const [tA, tB] = frameAt(unit(mouthP));
  const buckets = new Map();
  for (const q of mvAll) {
    const d = [q.dx, q.dy, q.dz];
    const key = `${Math.round(dot(d, tA) * 4)},${Math.round(dot(d, tB) * 4)}`;
    const r = bodyR + q.hM;
    const prev = buckets.get(key);
    if (prev === undefined || r > prev.r) buckets.set(key, { r, q });
  }
  const mv = [...buckets.values()].map((b) => b.q);
  const skirtsDropped = mvAll.length - mv.length;
  const near = mv.filter((q) => q.dM <= Math.max(3, halfWidthM * 2));
  const radiiOf = (list) => list.map((q) => bodyR + q.hM).sort((a, b) => a - b);
  const rNear = radiiOf(near);
  const pctl = (s, q) => (s.length === 0 ? null : s[Math.min(s.length - 1, Math.floor(q * (s.length - 1)))]);
  const depthsSeen = {};
  for (const q of mv) depthsSeen[q.depth] = (depthsSeen[q.depth] ?? 0) + 1;
  // Residual of the DRAWN vertex against the oracle at the vertex's OWN
  // direction: this is what says whether the sheet is stale or merely coarse.
  let maxResid = 0, sumResid = 0;
  for (const q of near) {
    const P = [mouthP[0] + q.dx, mouthP[1] + q.dy, mouthP[2] + q.dz];
    const u = unit(P);
    const rr = Math.abs((bodyR + q.hM) - (bodyR + of.surface(u[0], u[1], u[2]).surfaceM));
    sumResid += rr;
    if (rr > maxResid) maxResid = rr;
  }
  const sheet = {
    definition: `__of.meshVerts within ${MV_R} m of the mouth centre, taken from the live `
      + `pooled chunk buffer; 'near' is within max(3, 2*voidHalfWidth) m of the axis`,
    vertices: mv.length, rawVertices: mvAll.length, skirtsDropped,
    nearVertices: near.length,
    byChunkDepth: depthsSeen,
    nearRadiusMinM: rNear.length === 0 ? null : r2(pctl(rNear, 0) - bodyR),
    nearRadiusMedianM: rNear.length === 0 ? null : r2(pctl(rNear, 0.5) - bodyR),
    nearRadiusMaxM: rNear.length === 0 ? null : r2(pctl(rNear, 1) - bodyR),
    mouthCentreM: r2(mouthR - bodyR),
    rockTopM: rockTopR === null ? null : r2(rockTopR - bodyR),
    /** THE NUMBER. Lowest drawn chunk vertex over the mouth minus the highest
     *  solid cell the field has there. Positive means the sheet is drawn ABOVE
     *  the rock, i.e. across open air. */
    lowestDrawnAboveRockTopM: (rNear.length === 0 || rockTopR === null) ? null
      : r2(pctl(rNear, 0) - rockTopR),
    /** And how far it is above the middle of the void the player walks in. */
    lowestDrawnAboveVoidCentreM: rNear.length === 0 ? null : r2(pctl(rNear, 0) - mouthR),
    /** THE OTHER NUMBER. Lowest drawn chunk vertex over the mouth minus the TOP
     *  of the hole. Positive means the sheet is drawn over the opening. */
    lowestDrawnAboveVoidTopM: (rNear.length === 0 || voidTopR === null) ? null
      : r2(pctl(rNear, 0) - voidTopR),
    residualVsOracle: { maxM: r3(maxResid), meanM: near.length === 0 ? null : r3(sumResid / near.length) },
  };

  // =========================================================================
  // 7. INSIDE: what the tunnel looks like from within, same run, same tunnel
  // =========================================================================
  const aimAt = async (P) => {
    const up = unit(eyeOf());
    const e = eyeOf();
    const to = sub(P, e);
    const yaw = await solveYaw(tangentTo(to, up), up);
    const pitch = Math.asin(clamp(dot(unit(to), up), -1, 1)) * DEG;
    of.look(r2(yaw), r2(pitch));
    await settle(0.4);
    const ray = of.aim();
    const errDeg = Math.acos(clamp(dot(unit(ray.dir), unit(sub(P, eyeOf()))), -1, 1)) * DEG;
    return { yawDeg: r2(yaw), pitchDeg: r2(pitch), aimErrDeg: r3(errDeg),
      eyeM: eyeOf().map(r2), distM: r2(len(sub(P, eyeOf()))) };
  };
  const TILES_X = A.tilesX ?? 64;
  const TILES_Y = A.tilesY ?? 36;
  /** Tile coordinates of a body-frame point in the CURRENT camera. */
  const project = (P) => {
    const e = eyeOf();
    const f = unit(of.world().player.aim.dir);
    const up = unit(e);
    const right = unit(cross(f, up));
    const camUp = cross(right, f);
    const to = sub(P, e);
    const z = dot(to, f);
    if (z <= 0) return null;
    const tanHalf = Math.tan((60 * Math.PI) / 360);
    const aspect = 1600 / 900;
    const ndcX = (dot(to, right) / z) / (tanHalf * aspect);
    const ndcY = (dot(to, camUp) / z) / tanHalf;
    return { tx: ((ndcX + 1) / 2) * TILES_X, ty: ((ndcY + 1) / 2) * TILES_Y,
      ndcX: r3(ndcX), ndcY: r3(ndcY), distM: r2(z),
      // Angular radius of a `halfWidthM` disc at this range, in TILES.
      radTilesY: (Math.atan(halfWidthM / z) / Math.atan(tanHalf)) * (TILES_Y / 2) };
  };
  /**
   * Mean tile luminance in three concentric regions about a projected point:
   * the CORE (the middle of the aperture, where a hole must be darkest), the
   * DISC (the whole projected void cross-section, which at an oblique angle
   * necessarily includes hillside and so dilutes), and the RING of hillside
   * outside it. Tiles are square in PIXELS, so the distance is measured in
   * pixels or an anisotropic grid would turn the disc into an ellipse.
   */
  const tileRings = (fh, c) => {
    const rIn = c.radTilesY;
    const pxPerTileX = 1600 / TILES_X, pxPerTileY = 900 / TILES_Y;
    const core = [], inn = [], ring = [];
    for (let ty = 0; ty < TILES_Y; ++ty) {
      for (let tx = 0; tx < TILES_X; ++tx) {
        const d = Math.hypot((tx + 0.5 - c.tx) * (pxPerTileX / pxPerTileY), ty + 0.5 - c.ty);
        const v = fh.tiles[ty * TILES_X + tx];
        if (d <= Math.max(1.5, rIn * 0.4)) core.push(v);
        if (d <= rIn) inn.push(v);
        else if (d >= rIn * 1.6 && d <= rIn * 2.8) ring.push(v);
      }
    }
    const mean = (a) => (a.length === 0 ? null : r2(a.reduce((x, y) => x + y, 0) / a.length));
    return { coreTiles: core.length, coreMean: mean(core),
      discTiles: inn.length, discMean: mean(inn),
      discMin: inn.length ? r2(Math.min(...inn)) : null,
      discMax: inn.length ? r2(Math.max(...inn)) : null,
      ringTiles: ring.length, ringMean: mean(ring),
      radiusTiles: r2(rIn) };
  };

  /**
   * The DRAWN chunk surface radius at a body-frame point, interpolated from the
   * three nearest pooled vertices by inverse square distance.
   *
   * The first version of this took the highest vertex within 1.5 m, and on a 0.4
   * grade that reads 0.6 m high before anything is wrong: it called the sight
   * line covered at a camera whose picture plainly showed the hole. Three
   * nearest with IDW lands on the interpolated triangle the GPU actually draws,
   * to within the residual meshVerts already reports. Skirts are dropped first,
   * by tangential bucket, for the reason stated at the sheet measurement.
   */
  const sheetHeightAt = (P) => {
    const vs = of.meshVerts(P[0], P[1], P[2], A.sheetProbeM ?? 3.0);
    if (vs.length === 0) return null;
    const u = unit(P);
    const [qa, qb] = frameAt(u);
    const keep = new Map();
    for (const q of vs) {
      const d = [q.dx, q.dy, q.dz];
      const key = `${Math.round(dot(d, qa) * 4)},${Math.round(dot(d, qb) * 4)}`;
      const prev = keep.get(key);
      if (prev === undefined || q.hM > prev.hM) keep.set(key, q);
    }
    const top = [...keep.values()].sort((x, y) => x.dM - y.dM).slice(0, 3);
    if (top.length === 0) return null;
    let wsum = 0, acc = 0;
    for (const q of top) {
      const wq = 1 / Math.max(1e-4, q.dM * q.dM);
      wsum += wq; acc += wq * (bodyR + q.hM);
    }
    return acc / wsum;
  };

  // 7a. deeper in, looking AWAY from the mouth: the tunnel interior's own
  //     luminance, which is the reference the outside frame is judged against.
  // RETREAT UNTIL THE WALKER ITSELF SAYS IT IS UNDER ROCK, then two slices more,
  // rather than a fixed number of slices: how far past the mouth the breakout
  // detector left the player is not knowable in advance, and a fixed retreat put
  // the "tunnel interior" reference sample out in daylight on the first run.
  let insideBack = 0;
  let buried = 0;
  for (let i = 0; i < (A.retreatMax ?? 16); ++i) {
    if (of.world().player.underRock) buried++;
    if (buried > (A.retreatExtra ?? 2)) break;
    await hold(A.sliceSecs ?? 0.4, ['KeyS']);
    insideBack++;
  }
  await settle(0.6);
  const wIn = of.world();
  const insideEye = eyeOf();
  const deepP = add(insideEye, scale(axis, -1), 8);
  const insideInAim = await aimAt(deepP);
  const fhInsideIn = of.framehash(TILES_X, TILES_Y);
  const cInsideIn = project(deepP);
  const insideInTiles = cInsideIn === null ? null : tileRings(fhInsideIn, cInsideIn);

  // 7b. from inside, looking AT the mouth. Daylight should come through it.
  const insideOutAim = await aimAt(mouthP);
  const fhInsideOut = of.framehash(TILES_X, TILES_Y);
  const cInsideOut = project(mouthP);
  const insideOutTiles = cInsideOut === null ? null : tileRings(fhInsideOut, cInsideOut);
  const insideRay = (() => {
    const ray = of.aim();
    const o = ray.origin, d = unit(ray.dir);
    return runsAlong((t) => add(o, d, t), 0.25, A.rayM ?? 60, 0.25);
  })();
  const inside = {
    retreatSlices: insideBack,
    underRock: wIn.player.underRock,
    lamp: of.stats().lamp,
    eyeM: insideEye.map(r2),
    lookingDeeper: { aim: insideInAim, tiles: insideInTiles, hash: fhInsideIn.hash,
      litPct: fhInsideIn.litPct },
    lookingAtMouth: { aim: insideOutAim, tiles: insideOutTiles, hash: fhInsideOut.hash,
      litPct: fhInsideOut.litPct },
    aimRayToMouth: insideRay,
  };
  log.push(`inside: underRock ${wIn.player.underRock}, tunnel interior tile mean `
    + `${insideInTiles === null ? 'n/a' : insideInTiles.discMean}, mouth-from-inside disc mean `
    + `${insideOutTiles === null ? 'n/a' : insideOutTiles.discMean}`);

  if (A.shot === 'inside') {
    await aimAt(deepP);
  } else if (A.shot === 'insideout') {
    await aimAt(mouthP);
  }

  // 7c. WALK OUT. Evidence the mouth is a real opening and not a measurement.
  const walkOut = [];
  if (A.shot !== 'inside' && A.shot !== 'insideout') {
    of.look(yawDeg, 0);
    for (let i = 0; i < (A.exitSlices ?? 12); ++i) {
      await hold(A.sliceSecs ?? 0.4, ['KeyW']);
      const w = of.world();
      walkOut.push({ underRock: w.player.underRock,
        skyVis: of.stats().lamp.skyVis,
        eyeM: r2(len(eyeOf()) - bodyR) });
    }
  }

  // =========================================================================
  // 8. OUTSIDE: the fixed camera, at several standoffs
  // =========================================================================
  // WHERE TO STAND IS SOLVED, NOT ASSUMED. The first camera this probe used was
  // simply the mouth direction pushed `D` metres along the bore axis, and at 14 m
  // the field itself put rock 6.75 m in front of the eye: the hillside bulges
  // across the sight line, so a picture of rock there is CORRECT and proves
  // nothing. A camera that cannot see the tunnel cannot accuse a layer of hiding
  // it. So candidates are swept over standoff and azimuth, `of.solidAt` is
  // marched from each candidate eye to `interiorP`, and only cameras with an
  // unobstructed line are kept. The eye of a candidate is computed from the
  // oracle (`surfaceM + 1.62`), which is exactly what `spawn` will produce, so
  // no teleport is spent on a camera that will be rejected.
  // WHAT THE CHUNK MESH DRAWS OVER THE MOUTH, WITHOUT NEEDING TO SEE IT.
  //
  // A line-of-sight test cannot answer the far-field question: past about nine
  // metres this hillside's own convexity blocks the sight line, so a picture of
  // rock there is honest and proves nothing either way. This does not care where
  // the camera is pointing. Over a grid of directions spanning the mouth it
  // compares, per column:
  //     drawn   the interpolated pooled-chunk surface radius (what the GPU has)
  //     field   the outermost solid cell on that radial (what the ground IS)
  // Over untouched ground the two agree to the LOD residual. A column where the
  // chunk mesh is drawn metres ABOVE the last solid cell is a column where the
  // terrain sheet has been laid across a hole. Run at several camera standoffs
  // it also catches the LOD hypothesis for free: `chunkDepth` and the residual
  // are reported together, so a notch that survives at depth 14 and is smoothed
  // away at depth 12 shows up as a number, not as an opinion.
  const PATCH_R = A.patchRadiusM ?? 6;
  const PATCH_STEP = A.patchStepM ?? 1;
  const patchScan = () => {
    const cols = [];
    let worst = null;
    let depths = {};
    for (let a = -PATCH_R; a <= PATCH_R + 1e-9; a += PATCH_STEP) {
      for (let b = -PATCH_R; b <= PATCH_R + 1e-9; b += PATCH_STEP) {
        const m = Math.hypot(a, b);
        const u = m < 1e-6 ? mouthU
          : geo(mouthU, unit(add(scale(outW, a), acrossA, b)), m, bodyR);
        const s = of.surface(u[0], u[1], u[2]);
        const drawn = sheetHeightAt(scale(u, bodyR + s.surfaceM));
        if (drawn === null) continue;
        let top = null;
        for (let r = bodyR + s.baseM + 4; r >= bodyR + s.baseM - 20; r -= 0.25) {
          if (solid(scale(u, r))) { top = r; break; }
        }
        if (top === null) continue;
        const row = { alongM: r2(a), acrossM: r2(b),
          drawnM: r2(drawn - bodyR), fieldTopM: r2(top - bodyR),
          drawnAboveFieldM: r2(drawn - top), loweringM: r3(s.loweringM),
          oracleSurfaceM: r2(s.surfaceM), oracleBaseM: r2(s.baseM) };
        cols.push(row);
        if (worst === null || row.drawnAboveFieldM > worst.drawnAboveFieldM) {
          // AUDIT TRAIL for the one number this whole probe turns on: the raw
          // pooled vertices the interpolation was built from, so a reader can
          // redo the arithmetic instead of trusting the weighting.
          worst = { ...row, contributingVertices: of.meshVerts(
            scale(u, bodyR + s.surfaceM)[0], scale(u, bodyR + s.surfaceM)[1],
            scale(u, bodyR + s.surfaceM)[2], A.sheetProbeM ?? 3.0)
            .sort((x, y) => x.dM - y.dM).slice(0, 8)
            .map((q) => ({ dM: r2(q.dM), reliefM: r2(q.hM), depth: q.depth })) };
        }
      }
    }
    for (const q of of.meshVerts(mouthP[0], mouthP[1], mouthP[2], 12)) {
      depths[q.depth] = (depths[q.depth] ?? 0) + 1;
    }
    const vals = cols.map((c) => c.drawnAboveFieldM).sort((x, y) => x - y);
    // THE NEGATIVE CONTROL IS INSIDE THE SAME MEASUREMENT. The patch straddles
    // ground the player has dug and ground nobody has touched; both are read the
    // same way, in the same frame, at the same LOD. Over untouched ground the
    // worst disagreement between the drawn sheet and the last solid cell is
    // whatever this chunk depth costs. Over dug ground it must be no worse, and
    // no threshold has to be invented to say so.
    const untouched = cols.filter((c) => c.loweringM <= 0.001).map((c) => c.drawnAboveFieldM);
    const dug = cols.filter((c) => c.loweringM > 0.001).map((c) => c.drawnAboveFieldM);
    const mx = (a) => (a.length === 0 ? null : r2(Math.max(...a)));
    return {
      columns: cols.length, chunkDepths: depths,
      worstColumn: worst,
      untouchedColumns: untouched.length, dugColumns: dug.length,
      maxOverUntouchedM: mx(untouched), maxOverDugM: mx(dug),
      sheetTracksFieldOverDugGround: untouched.length > 0 && dug.length > 0
        && Math.max(...dug) <= Math.max(...untouched),
      medianDrawnAboveFieldM: vals.length === 0 ? null : r2(vals[Math.floor(vals.length / 2)]),
      p95DrawnAboveFieldM: vals.length === 0 ? null : r2(vals[Math.floor(0.95 * (vals.length - 1))]),
      maxDrawnAboveFieldM: vals.length === 0 ? null : r2(vals[vals.length - 1]),
      loweredColumns: cols.filter((c) => c.loweringM > 0.001).length,
      grid: cols,
    };
  };

  const EYE_H = 1.62;
  const sightTo = (eye, target) => {
    const d = sub(target, eye);
    const L = len(d);
    const u = scale(d, 1 / L);
    for (let t = 0.25; t <= L - 0.25; t += 0.25) {
      if (solid(add(eye, u, t))) return { clear: false, blockedAtM: r2(t), rangeM: r2(L) };
    }
    return { clear: true, blockedAtM: null, rangeM: r2(L) };
  };
  const eyeAtDir = (u) => scale(u, bodyR + of.surface(u[0], u[1], u[2]).surfaceM + EYE_H);
  const sideOut = unit(cross(mouthU, outW));
  const candidates = [];
  for (const D of (A.standoffsM ?? [4, 6, 8, 10, 14, 20, 35, 60, 120, 260])) {
    let bestAz = null;
    for (const az of (A.azSweepDeg ?? [0, -8, 8, -16, 16, -24, 24, -32, 32, -40, 40])) {
      const th = (az * Math.PI) / 180;
      const w = unit(add(scale(outW, Math.cos(th)), sideOut, Math.sin(th)));
      const uc = geo(mouthU, w, D, bodyR);
      const s = sightTo(eyeAtDir(uc), interiorP);
      if (s.clear) { bestAz = { az, uc, sight: s }; break; }
    }
    candidates.push({ standoffM: D, clear: bestAz !== null,
      azDeg: bestAz === null ? null : bestAz.az,
      uc: bestAz === null ? null : bestAz.uc,
      sight: bestAz === null ? sightTo(eyeAtDir(geo(mouthU, outW, D, bodyR)), interiorP)
        : bestAz.sight });
  }
  // Every candidate is VISITED, clear or not: the patch scan above works without
  // a sight line, and the far cameras are the whole LOD question.
  for (const c of candidates) if (c.uc === undefined || c.uc === null) {
    c.uc = geo(mouthU, outW, c.standoffM, bodyR);
    c.azDeg = 0;
  }
  const clearCams = candidates.filter((c) => c.clear);
  if (clearCams.length === 0) {
    return { valid: false, why: 'no outside camera has a clear field line of sight into the tunnel',
      cameraCandidates: candidates.map((c) => ({ ...c, uc: undefined })), log };
  }
  const chosen = clearCams[clearCams.length - 1];
  const outside = [];
  const goTo = async (cand) => {
    const ll = toLatLon(cand.uc);
    of.teleport(ll.latDeg, ll.lonDeg, 2.0);
    await settle(A.outsideSettleSecs ?? 2.0);
    for (let i = 0; i < 20; ++i) { if (of.world().chunks.converged) break; await settle(0.5); }
    const aim = await aimAt(interiorP);
    return { standoffM: cand.standoffM, azDeg: cand.azDeg,
      teleport: { latDeg: r3(ll.latDeg), lonDeg: r3(ll.lonDeg), altM: 2.0 }, aim };
  };
  if (A.shot !== 'inside' && A.shot !== 'insideout') {
    for (const cand of candidates) {
      const cam = await goTo(cand);
      const patch = patchScan();
      const ray = of.aim();
      const o = ray.origin, d = unit(ray.dir);
      const march = runsAlong((t) => add(o, d, t), 0.25, A.rayM ?? 80, 0.25);
      const targetDistM = len(sub(interiorP, o));
      const mouthDistM = len(sub(mouthP, o));
      let deepestAirM = 0;
      for (let t = 0.25; t <= (A.rayM ?? 80); t += 0.25) {
        if (solid(add(o, d, t))) break;
        deepestAirM = t;
      }
      // THE DISCRIMINATOR. Walk the same sight line against the DRAWN CHUNK
      // SHEET rather than against the field: at each step take the highest
      // pooled chunk vertex within 1.5 m of the ray point and ask whether the
      // ray is under it. A step that is under the sheet AND in air is a step the
      // field says you can see through and the chunk mesh has covered. There is
      // no equivalent read for the voxel mesh (no debug hook exposes its
      // vertices), which is what the `--voxelnear=0` A/B is for.
      const sheetMarch = [];
      let crossing = null;
      let worstUnder = null;
      let prevRow = null;
      for (let t = 0.5; t <= targetDistM + 4; t += 0.25) {
        const P = add(o, d, t);
        const rP = len(P);
        const top = sheetHeightAt(P);
        if (top === null) continue;
        const under = top - rP;
        const air = !solid(P);
        const row = { tM: r2(t), rayM: r2(rP - bodyR), sheetM: r2(top - bodyR),
          underSheetM: r2(under), fieldAir: air };
        sheetMarch.push(row);
        // THE CROSSING is the event, not the sign. Beyond the tunnel entrance
        // the ray is legitimately under the mountain the sheet draws; what
        // matters is the FIRST step at which the ray passes from above the drawn
        // surface to below it, because everything past that point is hidden by
        // it. `fieldAir` at that step is the accusation: the field says there is
        // nothing there to hide behind.
        if (crossing === null && prevRow !== null && prevRow.underSheetM <= 0 && under > 0) {
          crossing = { ...row, fieldAirAtCrossing: air,
            beforeM: prevRow.tM, beforeUnderSheetM: prevRow.underSheetM };
        }
        if (crossing !== null && air && (worstUnder === null || under > worstUnder.underSheetM)) {
          worstUnder = row;
        }
        prevRow = row;
      }
      const fh = of.framehash(TILES_X, TILES_Y);
      const c = project(interiorP);
      const tiles = c === null ? null : tileRings(fh, c);
      outside.push({
        ...cam,
        sightClear: cand.clear,
        sightBlockedAtM: cand.sight.blockedAtM,
        mouthPatch: { ...patch, grid: undefined },
        chunkSheetOnTheSightLine: {
          definition: 'drawn chunk surface interpolated from the three nearest pooled '
            + 'vertices at each 0.25 m step of the aim ray; the crossing from above to '
            + 'below it is where the chunk mesh takes the pixel',
          crossing,
          crossingIsOverAir: crossing !== null && crossing.fieldAirAtCrossing,
          metresOfAirHiddenBehindIt: crossing === null ? null : r2(targetDistM - crossing.tM),
          worstCoveringStep: worstUnder,
          steps: sheetMarch,
        },
        mouthDistM: r2(mouthDistM), targetDistM: r2(targetDistM),
        aimRay: {
          definition: 'of.solidAt marched along of.aim() in 0.25 m steps from the eye',
          firstSolidM: march.firstSolid,
          continuousAirM: r2(deepestAirM),
          pastRoofedTargetM: r2(deepestAirM - targetDistM),
          reachesInterior: deepestAirM >= targetDistM,
          runs: march.runs.slice(0, 12),
        },
        pixels: { ...tiles, hash: fh.hash, litPct: fh.litPct, holePixels: fh.holePixels,
          screen: c === null ? null : { tx: r2(c.tx), ty: r2(c.ty), ndcX: c.ndcX, ndcY: c.ndcY,
            discRadiusTiles: r2(c.radTilesY) },
          // The RAW tile grid, for the cameras that can actually see the tunnel.
          // The `--voxelnear=0` A/B is a second browser run, so the per-tile
          // difference has to be taken across two reports, and that needs the
          // tiles themselves rather than a summary of them.
          tiles: cand.clear ? fh.tiles : undefined },
      });
      log.push(`outside @${cand.standoffM} m az ${cand.azDeg}: sight `
        + `${cand.clear ? 'clear' : 'blocked at ' + cand.sight.blockedAtM + ' m'}, ray air `
        + `${r2(deepestAirM)} m (roofed target at ${r2(targetDistM)} m), core `
        + `${tiles === null ? 'n/a' : tiles.coreMean} vs ring `
        + `${tiles === null ? 'n/a' : tiles.ringMean}, chunk depths `
        + `${JSON.stringify(patch.chunkDepths)}, sheet over field max `
        + `${patch.maxDrawnAboveFieldM} m`);
    }
    // Leave the camera on the furthest clear standoff so --out photographs it.
    await goTo(chosen);
    await settle(1.0);
  }

  // =========================================================================
  // 9. THE VERDICT, and it is threshold free
  //
  //  - rayReachesInterior: the FIELD says there is a hole to look through.
  //  - sheetSpansMouth: a DRAWN chunk vertex sits above the last solid cell.
  //  - pixelsShowHole: the mouth's own tiles read closer to the tunnel interior
  //    (measured from inside, this run, this tunnel) than to the hillside ring
  //    beside them. No tuned constant: the two references are both measured.
  // =========================================================================
  const clearRows = outside.filter((o) => o.sightClear);
  const capture = clearRows[clearRows.length - 1];
  const interiorRef = insideInTiles === null ? null : insideInTiles.coreMean;
  const readsAsHole = (row) => {
    if (row === undefined || row.pixels.coreMean === null || interiorRef === null) return null;
    const m = row.pixels.coreMean, ring = row.pixels.ringMean;
    return {
      standoffM: row.standoffM,
      mouthCoreMean: m, hillsideRingMean: ring, tunnelInteriorMean: interiorRef,
      distanceToInterior: r2(Math.abs(m - interiorRef)),
      distanceToHillside: r2(Math.abs(m - ring)),
      pixelsShowHole: Math.abs(m - interiorRef) < Math.abs(m - ring),
    };
  };
  const verdict = readsAsHole(capture);
  const byStandoff = clearRows.map(readsAsHole).filter((x) => x !== null);
  // Sheet-over-field at the mouth, versus how far away the camera is. This row
  // needs no sight line, so it runs to the far standoffs the sight test refuses.
  const sheetVsFieldByStandoff = outside.map((o) => ({
    standoffM: o.standoffM, chunkDepths: o.mouthPatch.chunkDepths,
    columns: o.mouthPatch.columns, loweredColumns: o.mouthPatch.loweredColumns,
    medianM: o.mouthPatch.medianDrawnAboveFieldM,
    p95M: o.mouthPatch.p95DrawnAboveFieldM,
    maxOverUntouchedM: o.mouthPatch.maxOverUntouchedM,
    maxOverDugM: o.mouthPatch.maxOverDugM,
    tracks: o.mouthPatch.sheetTracksFieldOverDugGround,
  }));
  const v = of.voxels();
  const wEnd = of.world();
  const st = of.stats();
  const rayOk = capture !== undefined && capture.aimRay.reachesInterior;
  const sheetSpans = sheet.lowestDrawnAboveRockTopM !== null && sheet.lowestDrawnAboveRockTopM > 0.5;

  // `valid` says THE RUN SET UP, and `pass` says THE ASSERTIONS HELD. They are
  // two different questions and they must not share a name: a probe whose
  // assertions are false while its top-level boolean is true is exactly how
  // tunnelwalk.js stayed quietly red for days, and this one is written to be
  // false until the mouth is fixed. Anything gating on a probe reads `pass`.
  const drove = vDrive.removedCells > 0 && vDrive.mouth.sent === vDrive.mouth.applied
    && (wEnd.tick - t0.tick) > 600 && boreHits.length >= 3 && mouthP !== null;
  const tracks = outside.length === 0 ? null
    : outside.every((o) => o.mouthPatch.sheetTracksFieldOverDugGround);

  return {
    valid: drove,
    pass: drove && verdict !== null && verdict.pixelsShowHole && tracks === true,

    // --- THE ASSERTION. It FAILS on the build this was written against. ------
    // A mouth the field says is open, with a chunk sheet drawn across it, whose
    // pixels read as hillside rather than as tunnel.
    mouthReadsAsOpenFromOutside: verdict !== null && verdict.pixelsShowHole,
    fieldSaysMouthIsOpen: rayOk,
    chunkSheetIsDrawnAcrossTheVoid: sheetSpans,
    // The one with a control in it, and the one worth shipping: over the SAME
    // patch, at the SAME LOD, the drawn chunk surface must not float further
    // above the last solid cell on dug ground than it does on untouched ground.
    sheetTracksFieldOverDugGround: tracks,
    verdict,

    // What the four readings add up to, in one place, with the numbers that
    // carry it. `nearVoxelMesh` cannot be settled inside one run: run the same
    // probe again with `--voxelnear=0` and difference `outside[i].pixels.tiles`.
    diagnosis: {
      chunkSheetAboveFieldOverDugGroundM: outside.length === 0 ? null
        : Math.max(...outside.map((o) => o.mouthPatch.maxOverDugM ?? 0)),
      chunkSheetAboveFieldOverUntouchedGroundM: outside.length === 0 ? null
        : Math.max(...outside.map((o) => o.mouthPatch.maxOverUntouchedM ?? 0)),
      chunkVertexResidualVsOracleM: sheet.residualVsOracle.maxM,
      voxelIsosurfaceIsBelowTheChunkSheetBy: 'the same number: the surface nets mesher '
        + 'extracts the zero level of the field solidAt reads, so the field top over a dug '
        + 'column IS the voxel surface there, and it sits that far radially inside the sheet',
      abInstructions: '--voxelnear=0 and --voxelskin=0, same seed and scenario; the drive is '
        + 'deterministic so the mouth and the camera repeat exactly. Difference '
        + 'outside[i].pixels.tiles per tile.',
    },

    // THE DISTANCE DEPENDENCE, which is the tell Reid reported. One row per
    // camera the field says can see into the tunnel.
    readsAsHoleByStandoff: byStandoff,
    sheetVsFieldByStandoff,

    config: { seed: wEnd.seed, scenario: wEnd.scenario, bodyRadiusM: bodyR,
      voxelNearInScene: of.scene().near, sceneNearChildren: of.scene().near,
      editFacesOnly: v.mesh.editFacesOnly, shot: A.shot ?? 'outside',
      captureStandoffM: capture === undefined ? null : capture.standoffM,
      tiles: [TILES_X, TILES_Y] },

    cameraSearch: {
      definition: 'candidate eye = oracle surface + 1.62 m at a standoff and azimuth about '
        + 'the mouth; kept only when of.solidAt finds no rock between it and interiorP',
      interiorTargetM: interiorP.map(r2),
      interiorTargetReliefM: r2(len(interiorP) - bodyR),
      candidates: candidates.map((c) => ({ standoffM: c.standoffM, clear: c.clear,
        azDeg: c.azDeg, blockedAtM: c.sight.blockedAtM, rangeM: c.sight.rangeM })),
    },

    slope: { sampled, sweepMs, dropM: r2(best.dropM), runM: RUN_M,
      start: { latDeg: r3(startLL.latDeg), lonDeg: r3(startLL.lonDeg),
        surfaceM: r2(hAt(startU)) }, streamWaitSecs: streamSecs, yawDeg },

    drive: { ticksAdvanced: wEnd.tick - t0.tick, framesRendered: wEnd.frames - t0.frames,
      shaftStrikes: shaft, boreStrikesBudget: strikes, boreStrikesFired: boreStruck,
      boreHits: boreHits.length,
      boreLengthM: r2(len(sub(pLast, pFirst))),
      startSurfaceM: r2(startSurfaceM), shaftDepthM, shaft: shaftLog,
      removedCells: vDrive.removedCells, mouthReconcile: vDrive.mouth,
      bore, boreAxisDepthTrace: axisTrace },

    mouth: { latDeg: r3(mouthLL.latDeg), lonDeg: r3(mouthLL.lonDeg),
      bodyFrameM: mouthP.map(r2), reliefM: r2(mouthR - bodyR),
      derivedFrom: 'the point on the first-hit-to-last-hit bore axis where the roof over '
        + 'the axis, totalled with of.solidAt, falls below ' + ROOF_GONE_M + ' m',
      firstHitM: pFirst.map(r2), lastHitM: pLast.map(r2),
      voidHalfWidthM: r2(halfWidthM), void: void_ },

    fieldAtMouth,
    fieldInsideDoorway,
    boreRoofTrace: axisTrace,
    heightfieldFootprint: { definition: `of.surface(...).loweringM on a ${GRID_STEP} m grid `
      + `+-${GRID_R} m about the mouth, rows along the bore axis`,
    loweredColumns: loweredCols, totalColumns: totalCols, grid },

    drawnChunkSheet: sheet,
    inside,
    walkOut,
    outside,

    // The near voxel mesh's own accounting. NOTE the field names: there is no
    // `faces` field, and three older probes read one and silently compare
    // undefined.
    voxelMesh: { vertices: v.mesh.vertices, triangles: v.mesh.triangles,
      exposed: v.mesh.exposed, dropped: v.mesh.dropped, bricks: v.mesh.bricks,
      remeshed: v.mesh.remeshed, rebuilds: v.mesh.rebuilds, lastMs: v.mesh.lastMs,
      editFacesOnly: v.mesh.editFacesOnly, biome: v.mesh.biome,
      visible: v.meshVisible },

    cost: { frameMsP50: st.frameMs.p50, drawCalls: st.draw.calls, triangles: st.draw.triangles },
    log,
  };
})()
