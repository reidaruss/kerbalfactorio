// WG-24 BEFORE evidence: how rough is a dug crater, as a NUMBER, measured off
// the geometry the GPU is drawing.
//
//   node tools/smoke/run.mjs --url=http://127.0.0.1:5199/ --scenario=walk \
//        --evalfile=tools/smoke/probes/digquality.js \
//        --out=docs/screenshots/WG24_dig_before.png
//
// WHY IT EXISTS. The binary 1 m occupancy field and its greedy CUBE mesher are
// being replaced by a signed density field meshed with surface nets. "Cleaner"
// is an opinion until someone writes down what they measured, so this probe
// fixes the site, the camera and the metric, and reports numbers that the same
// probe can produce again afterwards. A pair of pictures is not evidence; a
// pair of pictures taken from ONE pinned camera with a metric attached is.
//
// WHAT IT MEASURES, and every definition is spelled out where it is computed:
//
//   1. SETUP FIRST (DW-20). Ticks advanced, cells removed, mouth reconciled.
//      A roughness number computed over a simulation that never ran is worse
//      than no number, because it looks like one.
//   2. NORMAL ROUGHNESS of the DRAWN terrain vertices inside the crater
//      (__of.meshVerts, i.e. the pooled vertex buffer being rendered this
//      frame). Definition at `roughness()`.
//   3. The same measurement on UNDUG ground 60 m away, as a control. Without it
//      a reader cannot tell crater roughness from terrain roughness.
//   4. The CUBE-FACE CENSUS, from /core's own occupancy through of.solidAt: the
//      exposed solid-to-air faces the greedy mesher turns into quads. This is
//      where "exactly 6 distinct normals" is checked, because a cube mesher's
//      face normals are the six lattice axes and nothing else.
//   5. The voxel skin mesh's own counters (faces / quads / triangles), which is
//      the drawn triangle count of the thing being replaced.
//   6. A PINNED camera, reported in full, so the after-shot is the same shot.
//
// THE GRID MATTERS. Near-terrain vertices here are 1.463 m apart, and a default
// dig crater is about 1.5 m across, so it falls clean between vertices and the
// drawn heightfield never moves. This probe therefore SCULPTS a wide crater on
// purpose: a metric that cannot see the feature it is about is not a metric.
(async () => {
  const of = window.__of;
  const A = typeof OF_ARGS === 'undefined' ? {} : OF_ARGS;
  const log = [];

  const settle = async (secs) => {
    of.input.tape([{ hold: Math.ceil(60 * secs) + 30, keys: [] }]);
    await of.run(secs, 60);
  };
  const unit = (p) => {
    const r = Math.hypot(p[0], p[1], p[2]) || 1;
    return [p[0] / r, p[1] / r, p[2] / r];
  };
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0]];
  const basis = (u) => {
    const s = Math.abs(u[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
    let e1 = cross(u, s);
    const L = Math.hypot(e1[0], e1[1], e1[2]);
    e1 = [e1[0] / L, e1[1] / L, e1[2] / L];
    return [e1, cross(u, e1)];
  };
  const pct = (sorted, q) => (sorted.length === 0 ? null
    : sorted[Math.min(sorted.length - 1, Math.floor(q * (sorted.length - 1)))]);
  const feetOf = () => of.world().player.feet;

  // === 0. SETUP, and prove it ==============================================
  await settle(1.2);
  const w0 = of.world();
  if (w0.player === null) return { valid: false, why: 'no character, nothing can dig' };
  if (of.voxels() === null) return { valid: false, why: 'no voxel layer' };
  await of.wipe();
  of.forgetTunnels();
  await settle(0.8);

  const bodyR = w0.bodyRadiusM;
  const t0 = of.world();

  // A FIXED site, reported. Nothing about this probe may depend on where the
  // last probe left the player.
  const SITE = { latDeg: A.latDeg ?? 2.0, lonDeg: A.lonDeg ?? 144.0, altM: 2.0 };
  of.teleport(SITE.latDeg, SITE.lonDeg, SITE.altM);
  await settle(A.arriveSecs ?? 3.0);
  const centre = feetOf();
  const uc = unit(centre);
  const [e1, e2] = basis(uc);
  const groundBeforeM = of.surface(uc[0], uc[1], uc[2]).surfaceM;

  // --- the CONTROL patch: undug ground, measured before anything is dug, at a
  // point 60 m away along the local east axis. Same metric, same code path.
  const CONTROL_OFFSET_M = A.controlOffsetM ?? 60;
  const controlCentre = [0, 1, 2].map((k) =>
    (uc[k] * (bodyR + groundBeforeM)) + e1[k] * CONTROL_OFFSET_M);

  // === 1. THE REAL KEY PATH, proved before it is relied on ==================
  //
  // Digging is the `use` action, which is BOUND TO Mouse0 (Bindings.ts), not to
  // a keyboard key, and it only digs when a digging tool is in hand. So the
  // honest thing is to TRY the action path first and say what happened, rather
  // than claim a path that may not have fired. `input.act` resolves through the
  // one binding table, so it survives a remap; it writes the held set directly
  // rather than dispatching a DOM mouse event, and that difference is reported.
  const beforeKeyCells = of.voxels().removedCells;
  of.look(A.yawDeg ?? 0, -80);
  await settle(0.3);
  of.input.act(['use'], 40);
  await of.run(1.2, 60);
  await settle(0.4);
  const afterKeyCells = of.voxels().removedCells;
  const keyPath = {
    action: 'use',
    codes: of.input.bindings().use,
    cellsBefore: beforeKeyCells,
    cellsAfter: afterKeyCells,
    removedByActionPath: afterKeyCells - beforeKeyCells,
    drovenByActionPath: afterKeyCells > beforeKeyCells,
    note: 'input.act() goes through the ACTION binding table but sets the held '
      + 'set directly; it is not a DOM mouse event.',
  };
  log.push(`action path 'use' (${keyPath.codes.join(',')}): removed `
    + `${keyPath.removedByActionPath} cells`);

  // === 2. SCULPT A CRATER WIDE ENOUGH TO BE DRAWN ===========================
  //
  // FROM MANY STATIONS, not from one. Digging from a single spot sinks the
  // player into the column they are opening, every later strike then lands on
  // the shaft wall, and the result is a 2 m wide 23 m deep well: measured, and
  // it is what the first version of this probe produced. Standing on a ring of
  // stations and striking from each keeps the player on the original surface
  // and spreads the removal over a disc, which is the shape a reader means by
  // "crater" and the only shape the 1.46 m vertex grid can resolve.
  //
  // Each strike is of.dig(), which is DebugTerraform -> the SAME digOnce the
  // tick path calls, only without the cooldown.
  const degPerM = 180 / (Math.PI * bodyR);
  const stationAt = (northM, eastM) => ({
    latDeg: SITE.latDeg + northM * degPerM,
    lonDeg: SITE.lonDeg + (eastM * degPerM) / Math.cos((SITE.latDeg * Math.PI) / 180),
  });
  const stations = [{ northM: 0, eastM: 0 }];
  for (const ringM of (A.stationRingsM ?? [2.5, 5.0])) {
    const n = ringM <= 3 ? 6 : 12;
    for (let i = 0; i < n; ++i) {
      const th = (2 * Math.PI * i) / n;
      stations.push({ northM: ringM * Math.cos(th), eastM: ringM * Math.sin(th) });
    }
  }
  const PITCHES = A.pitches ?? [-42, -60];
  const YAW_STEP = A.yawStepDeg ?? 90;
  const strikes = [];
  for (const st0 of stations) {
    const s = stationAt(st0.northM, st0.eastM);
    of.teleport(s.latDeg, s.lonDeg, 2.0);
    await settle(A.stationSettleSecs ?? 0.6);
    for (const p of PITCHES) {
      for (let y = 0; y < 360; y += YAW_STEP) {
        of.look(y, p);
        const r = of.dig();
        strikes.push(r === null
          ? { n: +st0.northM.toFixed(1), e: +st0.eastM.toFixed(1), yaw: y, pitch: p, cells: 0, distM: null }
          : { n: +st0.northM.toFixed(1), e: +st0.eastM.toFixed(1), yaw: y, pitch: p,
            cells: r.cells, distM: +r.distM.toFixed(2) });
        await of.run(0.05, 60);
      }
    }
  }
  of.teleport(SITE.latDeg, SITE.lonDeg, 2.0);
  await settle(2.0);

  // WAIT FOR THE MOUTH TO RECONCILE BEFORE MEASURING ANYTHING, and record how
  // long it took. This is not defensive padding: an earlier run of this probe
  // measured 116 edits sent and only 84 applied, and reported a crater
  // roughness of 34.5 degrees where the settled world reads 44.5. The number
  // was wrong in a way nothing in the picture would have shown, which is the
  // exact failure DW-20 is about. A fixed settle is a guess; this is a check.
  let reconcileSecs = 0;
  for (let i = 0; i < 60; ++i) {
    const m = of.voxels().mouth;
    if (m.sent === m.applied && of.world().chunks.converged) break;
    await settle(0.25);
    reconcileSecs += 0.25;
  }

  const v = of.voxels();
  const wDig = of.world();
  const hits = strikes.filter((s) => s.cells > 0).length;
  log.push(`sculpted: ${strikes.length} strikes, ${hits} hit, `
    + `${v.removedCells} cells removed, ${v.harvestedM3} m3`);

  // === 3. THE CRATER, through the one oracle ================================
  //
  // A radial profile of derivedLoweringAt about the site: how wide the hole is
  // and how deep. Reported so the roughness radius is not a guess.
  const azimuths = 12;
  const profile = [];
  let craterRadiusM = 0;
  let maxDepthM = 0;
  for (let a = 0; a < azimuths; ++a) {
    const th = (2 * Math.PI * a) / azimuths;
    const dirE = [0, 1, 2].map((k) => e1[k] * Math.cos(th) + e2[k] * Math.sin(th));
    let edge = 0;
    for (let m = 0; m <= 12; m += 0.25) {
      const d = unit([0, 1, 2].map((k) => uc[k] * bodyR + dirE[k] * m));
      const low = of.surface(d[0], d[1], d[2]).loweringM;
      if (low > 0.5) { edge = m; if (low > maxDepthM) maxDepthM = low; }
    }
    if (edge > craterRadiusM) craterRadiusM = edge;
    profile.push({ azDeg: Math.round((th * 180) / Math.PI), edgeM: +edge.toFixed(2) });
  }
  log.push(`crater: radius ${craterRadiusM.toFixed(2)} m, max lowering `
    + `${maxDepthM.toFixed(2)} m`);

  // === 4. ROUGHNESS OF THE DRAWN SURFACE ===================================
  //
  // THE DEFINITION, in full, because a number without one is not comparable:
  //
  //   * The sample set is __of.meshVerts(centre, R): every vertex of the DRAWN
  //     near terrain whose TANGENTIAL distance from `centre` is <= R. These are
  //     the floats in the pooled buffer the GPU renders this frame.
  //   * Skirt vertices share a direction with their edge twin and hang below
  //     it, so the set is deduplicated into 0.4 m buckets of TANGENTIAL
  //     position (u,v) and the HIGHEST vertex in each bucket is kept. Bucketing
  //     tangentially rather than on the raw 3-vector is deliberate: a skirt can
  //     hang metres below its twin and would survive a 3-vector bucket.
  //   * Each surviving vertex is expressed as (u, v, h) in a local tangent
  //     frame at `centre`: u along e1, v along e2, h = radius - bodyRadius.
  //   * ITS NORMAL is the normal of the least-squares plane h = a*u + b*v + c
  //     fitted to itself and every vertex within NEIGHBOUR_M of it in (u,v);
  //     n = normalize(-a, -b, 1). Fewer than 4 points in reach -> no normal.
  //     This is the central-difference normal a heightfield mesher computes, so
  //     it is the shading normal of the surface being looked at.
  //   * ROUGHNESS is the angle, in degrees, between the normals of every
  //     unordered PAIR of vertices within NEIGHBOUR_M of each other. Reported
  //     as mean, p95, max over that pair set, with the pair count.
  //   * DISTINCT NORMALS counts unique (nx,ny,nz) with each component rounded
  //     to 2 decimals, in the LOCAL tangent frame, so flat ground is (0,0,1).
  //     A mesher whose output is quantized produces a small integer here; a
  //     continuous surface produces a count near the vertex count.
  //
  // NEIGHBOUR_M is FIXED, not derived from the measured spacing, so the after
  // run computes the same function of the geometry even if the mesher changes
  // the vertex density. The measured spacing is reported alongside it.
  const NEIGHBOUR_M = A.neighbourM ?? 1.9;
  const BUCKET_M = 0.4;
  const STEP_SPAN_M = A.stepSpanM ?? 1.0;

  const roughness = (cx, cy, cz, radiusM) => {
    const c = [cx, cy, cz];
    const u0 = unit(c);
    const [f1, f2] = basis(u0);
    const raw = of.meshVerts(cx, cy, cz, radiusM);
    // dedupe by tangential bucket, keep the top of each
    const top = new Map();
    for (const q of raw) {
      const uu = q.dx * f1[0] + q.dy * f1[1] + q.dz * f1[2];
      const vv = q.dx * f2[0] + q.dy * f2[1] + q.dz * f2[2];
      const key = `${Math.round(uu / BUCKET_M)},${Math.round(vv / BUCKET_M)}`;
      const cur = top.get(key);
      if (cur === undefined || q.hM > cur.h) top.set(key, { u: uu, v: vv, h: q.hM, depth: q.depth });
    }
    const P = [...top.values()];
    const n = P.length;
    if (n < 8) {
      return { rawVerts: raw.length, verts: n, tooFew: true };
    }
    // neighbour lists in (u,v)
    const nb = [];
    for (let i = 0; i < n; ++i) nb.push([]);
    const RN2 = NEIGHBOUR_M * NEIGHBOUR_M;
    let nnSum = 0, nnCount = 0;
    const nnList = [];
    for (let i = 0; i < n; ++i) {
      let nearest = Infinity;
      for (let j = 0; j < n; ++j) {
        if (i === j) continue;
        const du = P[i].u - P[j].u, dv = P[i].v - P[j].v;
        const d2 = du * du + dv * dv;
        if (d2 <= RN2) nb[i].push(j);
        if (d2 > 1e-8 && d2 < nearest) nearest = d2;
      }
      if (nearest < Infinity) { nnList.push(Math.sqrt(nearest)); nnSum += Math.sqrt(nearest); nnCount++; }
    }
    nnList.sort((a, b) => a - b);
    // per-vertex least-squares plane normal
    const N = new Array(n).fill(null);
    for (let i = 0; i < n; ++i) {
      if (nb[i].length < 3) continue;                 // self + 3 = 4 points
      let Suu = 0, Suv = 0, Svv = 0, Suh = 0, Svh = 0;
      for (const j of nb[i]) {
        const du = P[j].u - P[i].u, dv = P[j].v - P[i].v, dh = P[j].h - P[i].h;
        Suu += du * du; Suv += du * dv; Svv += dv * dv;
        Suh += du * dh; Svh += dv * dh;
      }
      const det = Suu * Svv - Suv * Suv;
      if (Math.abs(det) < 1e-9) continue;
      const a = (Svv * Suh - Suv * Svh) / det;
      const b = (Suu * Svh - Suv * Suh) / det;
      const L = Math.hypot(a, b, 1);
      N[i] = [-a / L, -b / L, 1 / L];
    }
    const angles = [];
    for (let i = 0; i < n; ++i) {
      if (N[i] === null) continue;
      for (const j of nb[i]) {
        if (j <= i || N[j] === null) continue;
        const d = Math.min(1, Math.max(-1,
          N[i][0] * N[j][0] + N[i][1] * N[j][1] + N[i][2] * N[j][2]));
        angles.push((Math.acos(d) * 180) / Math.PI);
      }
    }
    angles.sort((a, b) => a - b);
    const mean = angles.length === 0 ? null
      : angles.reduce((s, x) => s + x, 0) / angles.length;
    const distinct = new Set();
    let withNormal = 0;
    for (const q of N) {
      if (q === null) continue;
      withNormal++;
      distinct.add(`${q[0].toFixed(2)},${q[1].toFixed(2)},${q[2].toFixed(2)}`);
    }
    // worst height step between two drawn vertices within STEP_SPAN_M, and the
    // same within NEIGHBOUR_M. The 1 m figure is reported WITH ITS PAIR COUNT
    // because on this 1.46 m grid no two vertices are within 1 m of each other
    // and a bare 0 would read as flatness rather than as an empty set.
    let step1 = 0, pairs1 = 0, stepN = 0, pairsN = 0;
    for (let i = 0; i < n; ++i) {
      for (let j = i + 1; j < n; ++j) {
        const du = P[i].u - P[j].u, dv = P[i].v - P[j].v;
        const d = Math.hypot(du, dv);
        const dh = Math.abs(P[i].h - P[j].h);
        if (d <= STEP_SPAN_M) { pairs1++; if (dh > step1) step1 = dh; }
        if (d <= NEIGHBOUR_M) { pairsN++; if (dh > stepN) stepN = dh; }
      }
    }
    const hs = P.map((q) => q.h);
    const depths = {};
    for (const q of P) depths[q.depth] = (depths[q.depth] ?? 0) + 1;
    // Drawn vertex heights bucketed to whole metres, relative to the highest.
    // A 1 m occupancy lattice can only lower a column by a whole number of
    // cells, so this histogram IS the terracing, counted rather than described.
    const hMax = Math.max(...hs);
    const hist = {};
    for (const q of hs) {
      const k = Math.round(q - hMax);
      hist[k] = (hist[k] ?? 0) + 1;
    }
    const offGrid = hs.filter((q) => Math.abs((q - hMax) - Math.round(q - hMax)) > 0.05).length;
    return {
      rawVerts: raw.length,
      verts: n,
      vertsWithNormal: withNormal,
      // The regular grid this mesher draws is 2 triangles per interior vertex.
      trianglesEstimate: 2 * n,
      lodSpacingM: {
        p50: +pct(nnList, 0.5).toFixed(3),
        min: +nnList[0].toFixed(3),
        max: +nnList[nnList.length - 1].toFixed(3),
        mean: +(nnSum / Math.max(1, nnCount)).toFixed(3),
      },
      normalAngleDeg: {
        pairs: angles.length,
        mean: mean === null ? null : +mean.toFixed(3),
        p50: angles.length ? +pct(angles, 0.5).toFixed(3) : null,
        p95: angles.length ? +pct(angles, 0.95).toFixed(3) : null,
        max: angles.length ? +angles[angles.length - 1].toFixed(3) : null,
        // the first 24 distinct values, so a quantized distribution is visible
        // as a short list rather than inferred from a mean.
        distinctValues: [...new Set(angles.map((x) => +x.toFixed(2)))].slice(0, 24),
      },
      distinctNormals2dp: distinct.size,
      worstStepM: {
        within1m: { spanM: STEP_SPAN_M, pairs: pairs1, worstM: +step1.toFixed(3) },
        withinNeighbour: { spanM: NEIGHBOUR_M, pairs: pairsN, worstM: +stepN.toFixed(3) },
      },
      reliefM: +(Math.max(...hs) - Math.min(...hs)).toFixed(3),
      // Counts of drawn vertices per whole metre below the highest one, and how
      // many sit OFF that whole-metre grid by more than 5 cm. On a 1 m lattice
      // offGrid is 0; a signed density field should put most vertices off it.
      heightHistogramM: hist,
      offWholeMetreGrid: offGrid,
      depths,
    };
  };

  const R_MEASURE = Math.max(A.measureRadiusM ?? 6.0, craterRadiusM + 1.0);
  const crater = roughness(centre[0], centre[1], centre[2], R_MEASURE);
  const control = roughness(controlCentre[0], controlCentre[1], controlCentre[2], R_MEASURE);
  log.push(`drawn crater: ${crater.verts} verts, normal angle mean `
    + `${crater.normalAngleDeg?.mean} deg p95 ${crater.normalAngleDeg?.p95} deg, `
    + `${crater.distinctNormals2dp} distinct normals`);
  log.push(`drawn control (undug, ${CONTROL_OFFSET_M} m away): ${control.verts} verts, `
    + `mean ${control.normalAngleDeg?.mean} deg p95 ${control.normalAngleDeg?.p95} deg, `
    + `${control.distinctNormals2dp} distinct normals`);

  // === 5. THE CUBE-FACE CENSUS =============================================
  //
  // The greedy mesher turns every solid-to-air face of the 1 m lattice into an
  // axis-aligned quad, so its face normals can only be the six lattice axes.
  // That claim is checked here against /core's OWN occupancy (of.solidAt, the
  // one oracle) rather than asserted: walk a cube of cell centres about the
  // crater, and for each solid cell count the neighbours that are air.
  //
  // This is the field being replaced. After surface nets the same census over
  // occupancy is meaningless, which is the point: the number to compare across
  // the change is the DRAWN one above, and this one records what "6" meant.
  const BOX = A.censusHalfM ?? 12;
  const faceDirs = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  const cell0 = centre.map((q) => Math.floor(q) + 0.5);
  const faceCount = new Map();
  let solidCells = 0, exposedFaces = 0, censusCells = 0;
  for (let ix = -BOX; ix <= BOX; ++ix) {
    for (let iy = -BOX; iy <= BOX; ++iy) {
      for (let iz = -BOX; iz <= BOX; ++iz) {
        const x = cell0[0] + ix, y = cell0[1] + iy, z = cell0[2] + iz;
        censusCells++;
        if (!of.solidAt(x, y, z)) continue;
        solidCells++;
        for (const d of faceDirs) {
          if (of.solidAt(x + d[0], y + d[1], z + d[2])) continue;
          exposedFaces++;
          const k = d.join(',');
          faceCount.set(k, (faceCount.get(k) ?? 0) + 1);
        }
      }
    }
  }
  const census = {
    definition: 'solid-to-air faces of the 1 m occupancy lattice in a '
      + `${2 * BOX + 1}^3 cell box about the crater, from of.solidAt (/core).`,
    boxCells: censusCells, solidCells, exposedFaces,
    distinctFaceNormals: faceCount.size,
    byNormal: Object.fromEntries(faceCount),
    // Every normal is a lattice axis, so the only angles between any two of them
    // are these. Computed, not asserted.
    distinctPairAnglesDeg: (() => {
      const ns = [...faceCount.keys()].map((k) => k.split(',').map(Number));
      const s = new Set();
      for (let i = 0; i < ns.length; ++i) {
        for (let j = i; j < ns.length; ++j) {
          const d = ns[i][0] * ns[j][0] + ns[i][1] * ns[j][1] + ns[i][2] * ns[j][2];
          s.add(+((Math.acos(Math.min(1, Math.max(-1, d))) * 180) / Math.PI).toFixed(2));
        }
      }
      return [...s].sort((a, b) => a - b);
    })(),
  };
  log.push(`cube census: ${census.exposedFaces} exposed faces over `
    + `${census.solidCells} solid cells, ${census.distinctFaceNormals} distinct normals`);

  // === 6. PIN THE CAMERA ====================================================
  //
  // Stand off from the crater and find the yaw that actually looks at it, by
  // marching the player's own aim ray to the ground and taking the yaw whose
  // ground point lands nearest the crater centre. The chosen numbers are
  // returned in full so the after-shot is set by hand to the same ones.
  // 13 m and a SHALLOW pitch, both measured rather than chosen. The plain here
  // is dead flat (the control patch reads 0 m of relief over 107 vertices), so
  // from a 1.62 m eye there is no angle that looks down INTO a distant hole:
  // a steep pitch hits the plain a few metres out and photographs grass. At 13 m
  // and -8 degrees the ray clears the rim and lands 2.3 m from the crater
  // centre, which is what puts the far wall across the middle of the frame.
  const STANDOFF_M = A.standoffM ?? 13.0;
  const shotSite = {
    latDeg: +(SITE.latDeg + STANDOFF_M * degPerM).toFixed(6),
    lonDeg: SITE.lonDeg,
    altM: 3.0,
  };
  of.teleport(shotSite.latDeg, shotSite.lonDeg, shotSite.altM);
  await settle(A.arriveSecs ?? 3.0);
  of.setTime(A.sunT ?? 0.3);

  const groundPoint = (yawDeg, pitchDeg) => {
    of.look(yawDeg, pitchDeg);
    const ray = of.world().player.aim;
    const o = ray.origin, d = ray.dir;
    for (let t = 0.2; t <= 60; t += 0.2) {
      const x = o[0] + d[0] * t, y = o[1] + d[1] * t, z = o[2] + d[2] * t;
      const r = Math.hypot(x, y, z);
      if (r <= bodyR + of.surface(x / r, y / r, z / r).surfaceM) {
        return { p: [x, y, z], distM: t };
      }
    }
    return null;
  };
  const angTo = (p) => {
    const up = unit(p);
    const d = Math.min(1, Math.max(-1, up[0] * uc[0] + up[1] * uc[1] + up[2] * uc[2]));
    return Math.acos(d) * bodyR;
  };
  let best = null;
  for (let y = 0; y < 360; y += 5) {
    for (const p of (A.shotPitches ?? [-8, -12, -16, -21])) {
      const g = groundPoint(y, p);
      if (g === null) continue;
      const off = angTo(g.p);
      if (best === null || off < best.offM) {
        best = { yawDeg: y, pitchDeg: p, offM: off, distM: g.distM };
      }
    }
  }
  const cam = best ?? { yawDeg: 180, pitchDeg: -30, offM: null, distM: null };
  of.look(cam.yawDeg, cam.pitchDeg);
  await settle(1.5);

  const wEnd = of.world();
  const eye = wEnd.player.aim.origin;
  const camera = {
    // Replay: of.teleport(lat, lon, alt); settle; of.setTime(sunT); of.look(yaw, pitch)
    replay: `of.teleport(${shotSite.latDeg}, ${shotSite.lonDeg}, ${shotSite.altM}); `
      + `await settle(3.0); of.setTime(${A.sunT ?? 0.3}); `
      + `of.look(${cam.yawDeg}, ${cam.pitchDeg});`,
    teleport: shotSite,
    observer: {
      latDeg: +wEnd.observer.latDeg.toFixed(6), lonDeg: +wEnd.observer.lonDeg.toFixed(6),
      altM: +wEnd.observer.altM.toFixed(3),
      yawDeg: +wEnd.observer.yawDeg.toFixed(3), pitchDeg: +wEnd.observer.pitchDeg.toFixed(3),
    },
    eyeBodyFrameM: eye.map((q) => +q.toFixed(3)),
    aimDir: wEnd.player.aim.dir.map((q) => +q.toFixed(6)),
    fovDegVertical: 60,
    fovDegHorizontal: +(2 * Math.atan(Math.tan((60 * Math.PI) / 360) * (16 / 9))
      * 180 / Math.PI).toFixed(2),
    viewportPx: [1600, 900],
    sunT: A.sunT ?? 0.3,
    groundHitDistM: cam.distM === null ? null : +cam.distM.toFixed(2),
    groundHitOffsetFromCraterCentreM: cam.offM === null ? null : +cam.offM.toFixed(2),
    standoffM: STANDOFF_M,
  };
  log.push(`camera pinned: lat ${shotSite.latDeg} lon ${shotSite.lonDeg} alt `
    + `${shotSite.altM}, yaw ${cam.yawDeg} pitch ${cam.pitchDeg}, fov 60 v / `
    + `${camera.fovDegHorizontal} h`);

  const st = of.stats();
  return {
    // --- DW-20 FIRST: did anything actually happen ------------------------
    valid: (wEnd.tick - t0.tick) > 400
      && v.removedCells > 0
      && v.mouth.sent === v.mouth.applied
      && crater.verts >= 8,
    setup: {
      ticksAdvanced: wEnd.tick - t0.tick,
      framesRendered: wEnd.frames - t0.frames,
      cellsRemoved: v.removedCells,
      harvestedM3: v.harvestedM3,
      mouth: v.mouth,
      chunksResident: wEnd.chunks.resident,
      converged: wEnd.chunks.converged,
      strikes: strikes.length, strikesThatHit: hits,
      // Seconds spent waiting for sent == applied and for the chunk set to
      // converge, before a single measurement was taken.
      reconcileSecs,
      mouthAtEnd: of.voxels().mouth,
      convergedAtEnd: wEnd.chunks.converged,
    },
    keyPath,

    site: {
      latDeg: SITE.latDeg, lonDeg: SITE.lonDeg,
      groundBeforeM: +groundBeforeM.toFixed(3),
      biome: t0.biome,
      centreBodyFrameM: centre.map((q) => +q.toFixed(2)),
      controlCentreBodyFrameM: controlCentre.map((q) => +q.toFixed(2)),
      controlOffsetM: CONTROL_OFFSET_M,
    },
    craterShape: {
      radiusM: +craterRadiusM.toFixed(2),
      maxLoweringM: +maxDepthM.toFixed(2),
      measureRadiusM: +R_MEASURE.toFixed(2),
      profile,
    },

    // --- THE ROUGHNESS. Definition is in the comment at roughness(). ------
    metricDefinition: {
      source: '__of.meshVerts: the pooled vertex buffer the GPU draws this frame',
      dedupe: `top vertex per ${BUCKET_M} m tangential bucket (drops skirts)`,
      normal: `least-squares plane over neighbours within ${NEIGHBOUR_M} m in the `
        + 'local tangent frame; n = normalize(-a,-b,1) for h = a*u+b*v+c',
      roughness: `angle in degrees between the normals of every unordered pair of `
        + `vertices within ${NEIGHBOUR_M} m of each other`,
      distinctNormals: 'unique (nx,ny,nz) rounded to 2 dp in the local tangent frame',
    },
    drawnCrater: crater,
    drawnControlUndug: control,

    // --- the cube mesher's own output -------------------------------------
    cubeMesh: {
      source: 'VoxelMesh.stats via __of.voxels().mesh: the greedy CUBE mesher',
      faces: v.mesh.faces, quads: v.mesh.quads, triangles: v.mesh.triangles,
      mergeRatio: v.mesh.mergeRatio, bricks: v.mesh.bricks,
      exposed: v.mesh.exposed, dropped: v.mesh.dropped,
      editFacesOnly: v.mesh.editFacesOnly, rebuilds: v.mesh.rebuilds,
      lastRemeshMs: v.mesh.lastMs, visible: v.meshVisible,
    },
    cubeFaceCensus: census,

    camera,
    cost: { frameMsP50: st.frameMs.p50, frameMsP99: st.frameMs.p99,
      drawCalls: st.draw.calls, triangles: st.draw.triangles },
    log,
  };
})()
