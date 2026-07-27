// WG-24 BEFORE evidence: what do this planet's mountains look like TODAY.
//
//   node tools/smoke/run.mjs --url=http://127.0.0.1:5199/ --scenario=walk \
//        --evalfile=tools/smoke/probes/mountainlook.js \
//        --out=docs/screenshots/WG24_mountains_before.png
//
// The noise stack is being changed. There is no test that fails when mountains
// stop looking like mountains, so this probe is the record: it finds the most
// mountainous ground within 200 km of the default spawn BY SWEEPING THE ORACLE,
// pins a camera on it, and reports the relief and the slope the frame contains
// as numbers. Rerunning it after the change photographs the same body-frame
// place from the same camera, so the pair is a comparison and not two pictures.
//
// EVERY HEIGHT COMES FROM of.surface (surface_field.h). Standing rule 1 applies
// to the harness: a probe that re-derived terrain height would be a second
// surface, and the two would drift.
(async () => {
  const of = window.__of;
  const A = typeof OF_ARGS === 'undefined' ? {} : OF_ARGS;
  const log = [];
  const DEG = 180 / Math.PI;

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
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const add = (a, b, k) => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
  const pct = (s, q) => (s.length === 0 ? null
    : s[Math.min(s.length - 1, Math.floor(q * (s.length - 1)))]);
  // Direction -> the lat/lon of.teleport speaks. y is the pole: this is read off
  // the engine's own numbers (feet at lat 2 / lon 144 give asin(uy) = 2.0), not
  // assumed.
  const toLatLon = (u) => ({ latDeg: Math.asin(u[1]) * DEG, lonDeg: Math.atan2(u[2], u[0]) * DEG });
  const hAt = (u) => of.surface(u[0], u[1], u[2]).surfaceM;

  await settle(1.2);
  const w0 = of.world();
  if (w0.player === null) return { valid: false, why: 'no character' };
  const bodyR = w0.bodyRadiusM;
  const t0 = of.world();

  // Anchor on the DEFAULT spawn, not on wherever the player happens to be.
  const SPAWN = { latDeg: A.spawnLatDeg ?? 2.0, lonDeg: A.spawnLonDeg ?? 144.0 };
  const la = (SPAWN.latDeg * Math.PI) / 180, lo = (SPAWN.lonDeg * Math.PI) / 180;
  const u0 = [Math.cos(la) * Math.cos(lo), Math.sin(la), Math.cos(la) * Math.sin(lo)];
  // A tangent frame at the spawn. e1 points at the pole (local north), e2 east.
  let north = add([0, 1, 0], u0, -dot([0, 1, 0], u0));
  north = unit(north);
  const east = cross(north, u0);
  // A point `rM` metres of great circle from the spawn on bearing `thRad`.
  const at = (rM, thRad) => {
    const ang = rM / bodyR;
    const w = add(add([0, 0, 0], north, Math.cos(thRad)), east, Math.sin(thRad));
    return unit(add(add([0, 0, 0], u0, Math.cos(ang)), w, Math.sin(ang)));
  };
  // Great-circle metres between two directions.
  const arc = (a, b) => Math.acos(Math.min(1, Math.max(-1, dot(a, b)))) * bodyR;

  // === 1. WHAT "MOUNTAINOUS" MEANS HERE ====================================
  //
  // DEFINITION: local relief = (max - min) of the surface height over 9 samples,
  // the point itself plus a ring of 8 at NEIGHBOURHOOD_M. It is a relief and not
  // a height on purpose: the highest ground on a plateau is not a mountain, and
  // the noise change being recorded is about SHAPE. NEIGHBOURHOOD_M = 500 m puts
  // the measurement at the scale a standing player reads as a mountainside.
  const NEIGHBOURHOOD_M = A.neighbourhoodM ?? 500;
  const relief = (u) => {
    let n1 = add([0, 1, 0], u, -dot([0, 1, 0], u));
    n1 = unit(n1);
    const n2 = cross(n1, u);
    const ang = NEIGHBOURHOOD_M / bodyR;
    let lo2 = Infinity, hi = -Infinity;
    const h0 = hAt(u);
    lo2 = h0; hi = h0;
    for (let i = 0; i < 8; ++i) {
      const th = (Math.PI * i) / 4;
      const w = add(add([0, 0, 0], n1, Math.cos(th)), n2, Math.sin(th));
      const d = unit(add(add([0, 0, 0], u, Math.cos(ang)), w, Math.sin(ang)));
      const h = hAt(d);
      if (h < lo2) lo2 = h;
      if (h > hi) hi = h;
    }
    return { reliefM: hi - lo2, centreM: h0, maxM: hi, minM: lo2 };
  };

  const RANGE_M = A.rangeM ?? 200000;
  /** Datum metres the whole 500 m neighbourhood must clear to count as land. */
  const MIN_GROUND_M = A.minGroundM ?? 0;
  let bestRelief = null;
  let highest = null;
  let sampled = 0;
  const sweep = (centreU, spanM, stepM) => {
    // A square patch in the tangent plane about centreU, so refinement is a
    // simple zoom rather than a second coordinate system.
    let n1 = add([0, 1, 0], centreU, -dot([0, 1, 0], centreU));
    n1 = unit(n1);
    const n2 = cross(n1, centreU);
    for (let a = -spanM; a <= spanM; a += stepM) {
      for (let b = -spanM; b <= spanM; b += stepM) {
        const ang = Math.hypot(a, b) / bodyR;
        let d = centreU;
        if (ang > 0) {
          const w = unit(add(add([0, 0, 0], n1, a), n2, b));
          d = unit(add(add([0, 0, 0], centreU, Math.cos(ang)), w, Math.sin(ang)));
        }
        if (arc(u0, d) > RANGE_M) continue;
        sampled++;
        const r = relief(d);
        // LAND ONLY, and this constraint is the whole difference between a
        // mountain and a coastline. Unconstrained, the largest local relief on
        // this planet within 200 km is the continental shelf: 1554 m of it,
        // where the neighbourhood minimum is -1512 m and the "viewpoint" is the
        // abyssal floor looking up a wall at 89.6 degrees. That is a real
        // feature and a useless photograph. Requiring the whole neighbourhood
        // to be above datum makes the winner a mountain.
        if (r.minM >= MIN_GROUND_M
            && (bestRelief === null || r.reliefM > bestRelief.reliefM)) {
          bestRelief = { ...r, u: d };
        }
        if (highest === null || r.centreM > highest.centreM) highest = { ...r, u: d };
      }
    }
  };
  const tSweep = performance.now();
  sweep(u0, RANGE_M, A.coarseStepM ?? 4000);
  const coarse = { ...bestRelief };
  sweep(bestRelief.u, A.midSpanM ?? 6000, A.midStepM ?? 400);
  sweep(bestRelief.u, A.fineSpanM ?? 600, A.fineStepM ?? 40);
  const sweepMs = +(performance.now() - tSweep).toFixed(1);
  const summitU = bestRelief.u;
  const summitLL = toLatLon(summitU);
  log.push(`swept ${sampled} candidates (${sweepMs} ms) inside ${RANGE_M / 1000} km; `
    + `best local relief ${bestRelief.reliefM.toFixed(1)} m over ${NEIGHBOURHOOD_M} m `
    + `at lat ${summitLL.latDeg.toFixed(5)} lon ${summitLL.lonDeg.toFixed(5)}`);

  // === 2. THE VIEWPOINT ====================================================
  //
  // Stand where the mountain is BIGGEST: sweep azimuths and standoffs about the
  // chosen point and take the ground with the lowest surface height, because
  // apparent size is the height difference over the distance. No occlusion test
  // is done and none is claimed; what is reported is what the camera saw.
  let view = null;
  for (const dM of (A.standoffsM ?? [900, 1400, 2000, 2800])) {
    for (let i = 0; i < 36; ++i) {
      const th = (2 * Math.PI * i) / 36;
      let n1 = add([0, 1, 0], summitU, -dot([0, 1, 0], summitU));
      n1 = unit(n1);
      const n2 = cross(n1, summitU);
      const ang = dM / bodyR;
      const w = add(add([0, 0, 0], n1, Math.cos(th)), n2, Math.sin(th));
      const d = unit(add(add([0, 0, 0], summitU, Math.cos(ang)), w, Math.sin(ang)));
      const h = hAt(d);
      if (h < MIN_GROUND_M) continue;          // do not stand on the sea floor
      // Apparent rise in degrees from this stand point to the summit.
      const rise = (Math.atan2(bestRelief.maxM - h, dM) * DEG);
      if (view === null || rise > view.riseDeg) {
        view = { u: d, groundM: h, standoffM: dM, riseDeg: rise, azRad: th };
      }
    }
  }
  const viewLL = toLatLon(view.u);
  of.teleport(viewLL.latDeg, viewLL.lonDeg, 2.0);
  await settle(A.arriveSecs ?? 6.0);
  // WAIT FOR THE STREAM, do not assume it. This is a 200 km teleport: the near
  // chunk set has to be rebuilt from scratch, and the first version of this
  // probe measured a frame with NO resident near geometry and died on an empty
  // vertex list. A fixed settle is a guess; converged is the engine's own answer.
  let streamSecs = 0;
  for (let i = 0; i < 60; ++i) {
    if (of.world().chunks.converged
        && of.meshVerts(of.world().player.feet[0], of.world().player.feet[1],
          of.world().player.feet[2], A.spacingRadiusM ?? 30).length > 8) break;
    await settle(0.5);
    streamSecs += 0.5;
  }
  of.setTime(A.sunT ?? 0.32);
  await settle(0.5);

  // --- THE YAW, solved rather than swept. `look` speaks yaw degrees and the
  // mapping from that to a body-frame bearing is not published, so it is
  // MEASURED: read the aim direction at yaw 0 and at yaw 90, project both onto
  // the local tangent plane, and express the direction to the summit in that
  // pair. A sweep would work too and would cost a hundred marches.
  const eyeNow = () => of.world().player.aim.origin;
  const tangent = (v, up) => unit(add(v, up, -dot(v, up)));
  of.look(0, 0); await settle(0.15);
  const upHere = unit(eyeNow());
  const b0 = tangent(of.world().player.aim.dir, upHere);
  of.look(90, 0); await settle(0.15);
  const b90 = tangent(of.world().player.aim.dir, upHere);
  const eyeP = eyeNow();
  const summitP = [0, 1, 2].map((k) => summitU[k] * (bodyR + bestRelief.maxM));
  const toSummit = [0, 1, 2].map((k) => summitP[k] - eyeP[k]);
  const tHat = tangent(toSummit, upHere);
  const yawDeg = (Math.atan2(dot(tHat, b90), dot(tHat, b0)) * DEG + 360) % 360;
  // Elevation of the summit above the eye's horizon, then aim BELOW it by
  // A.dropDeg so the peak sits high in the frame and the flank fills it.
  const elevDeg = Math.asin(Math.min(1, Math.max(-1,
    dot(unit(toSummit), upHere)))) * DEG;
  const pitchDeg = +(elevDeg - (A.dropDeg ?? 8)).toFixed(2);
  of.look(+yawDeg.toFixed(2), pitchDeg);
  await settle(2.5);

  // === 3. WHAT THE FRAME CONTAINS, as numbers ==============================
  //
  // DEFINITION. A fan of ground samples inside the camera's HORIZONTAL field of
  // view (60 deg vertical at 16:9 => 91.49 deg horizontal, so +-45.75 deg about
  // the aim), swept in 3 deg steps, along each bearing from 20 m to FAR_M in
  // 10 m steps. Heights are of.surface. NO OCCLUSION TEST is done: this is the
  // relief of the ground the frustum covers, not of the pixels that survived
  // the depth buffer, and the difference matters if a ridge hides a valley.
  //
  //   framedReliefM = max - min over that set.
  //   worstSlopeDeg = the steepest atan(dh / 10 m) between CONSECUTIVE samples
  //                   along a bearing, which is a 10 m baseline gradient.
  const HALF_FOV_DEG = A.halfFovDeg ?? 45.75;
  const FAR_M = A.farM ?? 3000;
  const STEP_M = A.sampleStepM ?? 10;
  const eye2 = eyeNow();
  const up2 = unit(eye2);
  const aimT = tangent(of.world().player.aim.dir, up2);
  const side = cross(up2, aimT);
  const fan = [];
  let hi2 = -Infinity, lo3 = Infinity, worstSlope = 0, worstAt = null;
  let slopeSamples = 0;
  for (let a = -HALF_FOV_DEG; a <= HALF_FOV_DEG; a += 3) {
    const th = (a * Math.PI) / 180;
    const bear = unit(add(add([0, 0, 0], aimT, Math.cos(th)), side, Math.sin(th)));
    let prevH = null;
    let ridge = -Infinity, trough = Infinity;
    for (let m = 20; m <= FAR_M; m += STEP_M) {
      const ang = m / bodyR;
      const d = unit(add(add([0, 0, 0], up2, Math.cos(ang)), bear, Math.sin(ang)));
      const h = hAt(d);
      if (h > hi2) hi2 = h;
      if (h < lo3) lo3 = h;
      if (h > ridge) ridge = h;
      if (h < trough) trough = h;
      if (prevH !== null) {
        slopeSamples++;
        const s = Math.abs(h - prevH) / STEP_M;
        if (s > worstSlope) { worstSlope = s; worstAt = { bearingDeg: +a.toFixed(1), rangeM: m }; }
      }
      prevH = h;
    }
    fan.push({ bearingDeg: +a.toFixed(1), reliefM: +(ridge - trough).toFixed(1) });
  }

  // === 4. LOD VERTEX SPACING AT THE CAMERA ================================
  //
  // Measured off the DRAWN buffer, not derived from the depth: the nearest
  // neighbour distance among the terrain vertices the GPU has this frame,
  // within SPACING_R of the player's feet.
  const SPACING_R = A.spacingRadiusM ?? 30;
  const feet = of.world().player.feet;
  const mv = of.meshVerts(feet[0], feet[1], feet[2], SPACING_R);
  const nn = [];
  const byDepth = {};
  const cap = Math.min(mv.length, 500);
  for (const q of mv) byDepth[q.depth] = (byDepth[q.depth] ?? 0) + 1;
  for (let i = 0; i < cap; ++i) {
    let best = Infinity;
    for (let j = 0; j < mv.length; ++j) {
      if (i === j) continue;
      const dx = mv[i].dx - mv[j].dx, dy = mv[i].dy - mv[j].dy, dz = mv[i].dz - mv[j].dz;
      const d = Math.hypot(dx, dy, dz);
      if (d > 1e-4 && d < best) best = d;
    }
    if (best < Infinity) nn.push(best);
  }
  nn.sort((a, b) => a - b);
  const chunkRows = of.chunks(400, true)
    .map((c) => ({ depth: c.depth, cellM: c.cellM, distM: c.distFromCamOriginM }))
    .sort((a, b) => a.distM - b.distM).slice(0, 4);

  const wEnd = of.world();
  const st = of.stats();
  const camera = {
    replay: `of.teleport(${viewLL.latDeg.toFixed(6)}, ${viewLL.lonDeg.toFixed(6)}, 2.0); `
      + `await settle(6.0); of.setTime(${A.sunT ?? 0.32}); `
      + `of.look(${+yawDeg.toFixed(2)}, ${pitchDeg});`,
    teleport: { latDeg: +viewLL.latDeg.toFixed(6), lonDeg: +viewLL.lonDeg.toFixed(6), altM: 2.0 },
    observer: {
      latDeg: +wEnd.observer.latDeg.toFixed(6), lonDeg: +wEnd.observer.lonDeg.toFixed(6),
      altM: +wEnd.observer.altM.toFixed(3),
      yawDeg: +wEnd.observer.yawDeg.toFixed(3), pitchDeg: +wEnd.observer.pitchDeg.toFixed(3),
    },
    eyeBodyFrameM: eye2.map((q) => +q.toFixed(2)),
    aimDir: wEnd.player.aim.dir.map((q) => +q.toFixed(6)),
    fovDegVertical: 60,
    fovDegHorizontal: 91.49,
    viewportPx: [1600, 900],
    sunT: A.sunT ?? 0.32,
    summitElevationAboveEyeDeg: +elevDeg.toFixed(2),
    aimedBelowSummitDeg: A.dropDeg ?? 8,
  };
  log.push(`camera lat ${camera.teleport.latDeg} lon ${camera.teleport.lonDeg} `
    + `yaw ${camera.observer.yawDeg} pitch ${camera.observer.pitchDeg}`);
  const nnAt = (q) => (nn.length === 0 ? null : +pct(nn, q).toFixed(3));
  log.push(`framed relief ${(hi2 - lo3).toFixed(1)} m, worst 10 m slope `
    + `${(Math.atan(worstSlope) * DEG).toFixed(2)} deg, LOD spacing `
    + `${nnAt(0.5)} m over ${nn.length} drawn vertices`);

  return {
    valid: (wEnd.tick - t0.tick) > 300 && wEnd.chunks.converged && nn.length > 8,
    setup: {
      ticksAdvanced: wEnd.tick - t0.tick, framesRendered: wEnd.frames - t0.frames,
      chunksResident: wEnd.chunks.resident, converged: wEnd.chunks.converged,
      seed: wEnd.seed, scenario: wEnd.scenario, bodyRadiusM: bodyR,
    },
    search: {
      definition: `local relief = max-min of of.surface over the point plus a ring `
        + `of 8 at ${NEIGHBOURHOOD_M} m; searched within ${RANGE_M} m of the spawn `
        + `by great circle`,
      spawn: SPAWN,
      candidatesSampled: sampled, sweepMs,
      coarseBestReliefM: +coarse.reliefM.toFixed(1),
      winner: {
        latDeg: +summitLL.latDeg.toFixed(6), lonDeg: +summitLL.lonDeg.toFixed(6),
        localReliefM: +bestRelief.reliefM.toFixed(1),
        centreHeightM: +bestRelief.centreM.toFixed(1),
        neighbourhoodMaxM: +bestRelief.maxM.toFixed(1),
        neighbourhoodMinM: +bestRelief.minM.toFixed(1),
        distanceFromSpawnM: Math.round(arc(u0, summitU)),
      },
      highestPointInRange: {
        latDeg: +toLatLon(highest.u).latDeg.toFixed(6),
        lonDeg: +toLatLon(highest.u).lonDeg.toFixed(6),
        heightM: +highest.centreM.toFixed(1),
        distanceFromSpawnM: Math.round(arc(u0, highest.u)),
      },
      viewpoint: {
        latDeg: +viewLL.latDeg.toFixed(6), lonDeg: +viewLL.lonDeg.toFixed(6),
        groundHeightM: +view.groundM.toFixed(1),
        standoffFromSummitM: view.standoffM,
        apparentRiseDeg: +view.riseDeg.toFixed(2),
      },
    },
    framed: {
      definition: `ground samples inside the ${2 * HALF_FOV_DEG} deg horizontal FOV, `
        + `3 deg bearing steps, ${STEP_M} m range steps from 20 m to ${FAR_M} m, `
        + `heights from of.surface, NO occlusion test`,
      maxHeightM: +hi2.toFixed(1),
      minHeightM: +lo3.toFixed(1),
      reliefM: +(hi2 - lo3).toFixed(1),
      worstSlope: {
        definition: `steepest |dh| / ${STEP_M} m between consecutive samples along a bearing`,
        gradient: +worstSlope.toFixed(4),
        degrees: +(Math.atan(worstSlope) * DEG).toFixed(2),
        at: worstAt,
        samples: slopeSamples,
      },
      perBearingReliefM: fan,
    },
    lod: {
      definition: `nearest-neighbour distance among DRAWN terrain vertices within `
        + `${SPACING_R} m of the feet (__of.meshVerts)`,
      vertices: mv.length, measured: nn.length, streamWaitSecs: streamSecs,
      spacingM: {
        min: nnAt(0), p50: nnAt(0.5), p95: nnAt(0.95), max: nnAt(1),
      },
      byChunkDepth: byDepth,
      nearestChunks: chunkRows,
    },
    camera,
    cost: { frameMsP50: st.frameMs.p50, frameMsP99: st.frameMs.p99,
      drawCalls: st.draw.calls, triangles: st.draw.triangles },
    log,
  };
})()
