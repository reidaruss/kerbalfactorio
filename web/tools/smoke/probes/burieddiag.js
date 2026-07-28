// DIAGNOSTIC (physics lane): WHY does nothing own a walker that is buried?
//
//   node tools/smoke/run.mjs --url=http://127.0.0.1:5457/ --scenario=walk \
//        --evalfile=tools/smoke/probes/burieddiag.js --evalargs='{"seed":991733}'
//
// `probes/mtnfall.js` measured the SYMPTOM on seed 991733: after one tick the
// walker is never grounded again, `resolveEmbedded` never pushes, and the feet
// radius falls 29 km. It named a mechanism in its comments but never measured
// one, and a named mechanism that was never measured is a guess.
//
// This probe measures it. It re-runs mtnfall's drive VERBATIM (same seed
// arithmetic, same order of rnd() calls, same frame counts), but drives the
// WALK phase in six-tick slices so it can catch the loss within a few ticks
// rather than reading the wreckage 4,600 ticks later. At the capture it
// replicates, in probe JS and from the live feet position, the exact predicates
// `player/VoxelCollision.ts` uses:
//
//   solidForWalker(p) = of.solidAt(p) && |p| <= bodyR + of.surface(p).surfaceM
//   free(p)           = no capsule sample at 0.15 / 0.9 / 1.65 m is solidForWalker
//   floorBelow(...)   = the three-step march, on the ABSOLUTE 0.25 m grid,
//                       against RAW of.solidAt (floorBelow does NOT use
//                       solidForWalker; that asymmetry is measured here)
//   resolveEmbedded() = per-axis exit distance to the face of each solid
//                       sample's own cell, max, plus 1e-3, accepted only if the
//                       WHOLE capsule is free after the push
//
// THE HYPOTHESIS UNDER TEST, stated as two independent halves:
//   (A) `floorBelow` returns null because rock extends more than riseM
//       (VOXEL_STEP_UP_M[0]) above the feet along the local radial with no air.
//   (B) `resolveEmbedded` returns null because no single-axis push of at most
//       one cell leaves all three capsule samples free.
// Either half can be refuted on its own, and the report says which held.
//
// The control march (nearest free capsule position along each axis, out to
// 40 m, in 0.25 m steps) is deliberately CELL-SIZE INDEPENDENT: it says how
// deep the burial actually is, so a reader can tell "one cell short of a fix"
// from "no bounded axis push could ever have worked".
//
// DW-20: every drive phase is bracketed by a tick read, and the probe refuses
// to report measurements at all if the simulation did not advance.
(async () => {
  const of = window.__of;
  const A = OF_ARGS ?? {};
  const log = [];
  const DEG = 180 / Math.PI;
  const r6 = (x) => (Number.isFinite(x) ? Number(x.toFixed(6)) : null);
  const r3 = (x) => (Number.isFinite(x) ? Number(x.toFixed(3)) : null);
  const fail = (why, extra) => ({ valid: false, fail: why, ...extra, log });

  // ---- the drive, byte for byte out of mtnfall.js -------------------------
  const settle = async (secs) => {
    of.input.tape([{ hold: Math.ceil(60 * secs) + 30, keys: [] }]);
    await of.run(secs, 60);
  };
  const hold = async (secs, keys) => {
    of.input.tape([{ hold: Math.ceil(60 * secs) + 30, keys }]);
    await of.run(secs, 60);
  };
  const P = () => of.world().player;
  const unit = (p) => { const r = Math.hypot(p[0], p[1], p[2]) || 1; return [p[0] / r, p[1] / r, p[2] / r]; };
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const add = (a, b, k) => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
  const hAt = (u) => of.surface(u[0], u[1], u[2]).surfaceM;
  let seed = A.seed ?? 991733;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };

  const tick = () => of.world().tick;
  const phases = [];
  const phase = async (name, fn) => {
    const t0 = tick();
    const r = await fn();
    const t1 = tick();
    phases.push({ name, tickFrom: t0, tickTo: t1, ticks: t1 - t0 });
    return r;
  };

  await phase('boot settle', () => settle(1.5));
  if (of.voxels() === null) return fail('no character, nothing can dig');
  const w0 = of.world();
  const bodyR = w0.bodyRadiusM;
  const uFeet = unit(w0.player.feet);
  const lat0 = A.latDeg ?? Math.asin(uFeet[1]) * DEG;
  const lon0 = A.lonDeg ?? Math.atan2(uFeet[2], uFeet[0]) * DEG;

  const INTO_M = A.intoM ?? 30;
  let site = null;
  const span = A.spanDeg ?? 0.30, step = A.stepDeg ?? 0.02;
  for (let a = -span; a <= span + 1e-9; a += step) {
    for (let b = -span; b <= span + 1e-9; b += step) {
      const la = ((lat0 + a) * Math.PI) / 180, lo = ((lon0 + b) * Math.PI) / 180;
      const u = [Math.cos(la) * Math.cos(lo), Math.sin(la), Math.cos(la) * Math.sin(lo)];
      const h0 = hAt(u);
      if (h0 < 0) continue;
      const north = unit(add([0, 1, 0], u, -dot([0, 1, 0], u)));
      const east = cross(north, u);
      const ang = INTO_M / bodyR;
      let bestRise = -Infinity;
      for (let i = 0; i < 8; ++i) {
        const th = (Math.PI * i) / 4;
        const w = add(add([0, 0, 0], north, Math.cos(th)), east, Math.sin(th));
        const d = unit(add(add([0, 0, 0], u, Math.cos(ang)), w, Math.sin(ang)));
        const rise = hAt(d) - h0;
        if (rise > bestRise) bestRise = rise;
      }
      if (site === null || bestRise > site.riseM) site = { lat: lat0 + a, lon: lon0 + b, riseM: bestRise };
    }
  }
  if (site === null) return fail('no land in the sweep');
  of.teleport(site.lat, site.lon, 0);
  await phase('teleport settle', () => settle(2.0));
  let yaw0 = null;
  await phase('aim sweep', async () => {
    for (let y = 0; y < 360; y += 15) {
      of.look(y, 0);
      await of.run(0.05, 60);
      const ray = of.aim();
      if (ray === null) continue;
      const u = unit(ray.origin);
      const f = unit(add(ray.dir, u, -dot(ray.dir, u)));
      const rise = hAt(unit(add(ray.origin, f, INTO_M))) - hAt(u);
      if (yaw0 === null || rise > yaw0.riseM) yaw0 = { yaw: y, riseM: rise };
    }
  });
  if (yaw0 === null) return fail('no aim ray');

  const strikes = A.strikes ?? 44;
  await phase('dig strikes', async () => {
    for (let i = 0; i < strikes; ++i) {
      const yj = (rnd() - 0.5) * (A.yawJitterDeg ?? 50);
      const pj = (rnd() - 0.5) * (A.pitchJitterDeg ?? 50);
      of.look((yaw0.yaw + yj + 720) % 360, pj);
      of.dig();
      await of.run(0.18, 60);
      const roll = rnd();
      const keys = roll < 0.55 ? ['KeyW'] : roll < 0.7 ? ['KeyA'] : roll < 0.85 ? ['KeyD'] : [];
      if (keys.length > 0) await hold(0.26, keys);
    }
  });
  await phase('post-dig settle', () => settle(2.5));

  // ---- THE PREDICATES, REPLICATED FROM player/VoxelCollision.ts -----------
  //
  // CAPSULE_SAMPLES_M is not published on window.__of, so it is recited here
  // and the recital is named. `voxelStepUpM` IS published, so riseM is read
  // from the walker rather than recited: retuning the rung retunes check (A).
  const SAMPLES_M = [0.15, 0.9, 1.65];          // CAPSULE_SAMPLES_M, recited
  const RISE_M = (of.voxelStepUpM ?? [0.55, 1.1])[0];   // VOXEL_STEP_UP_M[0], read
  const SEARCH_M = 6;                            // VOXEL_FLOOR_SEARCH_M, recited
  const FLOOR_MARCH_M = 0.25, FLOOR_BISECT_ITERS = 30;
  const DEEP_UNDERGROUND_M = 1.5;
  // kVoxelSizeM, core/include/of/voxel_terrain.h:99, exported as of_voxel_size()
  // but NOT surfaced on window.__of, so it is read from /core's source and the
  // read is declared. Every `need` below is asserted to lie in (0, cellM+2e-3];
  // a larger true cell would blow that bound and show up as a failed check. The
  // nearestFree control march below is cell-size independent on purpose.
  const CELL_M = A.cellM ?? 1.0;

  const surfRadius = (x, y, z) => bodyR + of.surface(x, y, z).surfaceM;
  const solidW = (x, y, z) => {
    if (!of.solidAt(x, y, z)) return false;
    const r = Math.hypot(x, y, z);
    if (r < 1e-6) return true;
    return r <= surfRadius(x / r, y / r, z / r);
  };
  const solidRaw = (x, y, z) => of.solidAt(x, y, z);
  const capsuleFree = (x, y, z, ux, uy, uz) => {
    for (const h of SAMPLES_M) if (solidW(x + ux * h, y + uy * h, z + uz * h)) return false;
    return true;
  };
  const capsuleSolidCount = (x, y, z, ux, uy, uz) => {
    let n = 0;
    for (const h of SAMPLES_M) if (solidW(x + ux * h, y + uy * h, z + uz * h)) ++n;
    return n;
  };

  // floorBelow, exactly: absolute 0.25 m grid, RAW solidAt, one bisected bracket.
  const floorBelowRep = (r, ux, uy, uz, searchM, riseM) => {
    const at = (rr) => of.solidAt(ux * rr, uy * rr, uz * rr);
    const h = FLOOR_MARCH_M;
    let lo = Number.NaN, hi = Number.NaN;
    const feetInRock = at(r);
    if (feetInRock) {
      lo = r;
      for (let rr = Math.ceil(r / h) * h; rr <= r + riseM + 1e-12; rr += h) {
        if (!at(rr)) { hi = rr; break; }
        lo = rr;
      }
      if (!Number.isFinite(hi)) return { r: null, branch: 'feet-in-rock', feetInRock };
    } else {
      hi = r;
      for (let rr = Math.floor(r / h) * h; rr >= r - searchM; rr -= h) {
        if (at(rr)) { lo = rr; break; }
        hi = rr;
      }
      if (!Number.isFinite(lo)) return { r: null, branch: 'feet-in-air', feetInRock };
    }
    for (let i = 0; i < FLOOR_BISECT_ITERS; ++i) {
      const m = (lo + hi) * 0.5;
      if (at(m)) lo = m; else hi = m;
    }
    return { r: hi, branch: feetInRock ? 'feet-in-rock' : 'feet-in-air', feetInRock };
  };

  const AXES = [
    ['+X', [1, 0, 0]], ['-X', [-1, 0, 0]], ['+Y', [0, 1, 0]],
    ['-Y', [0, -1, 0]], ['+Z', [0, 0, 1]], ['-Z', [0, 0, -1]],
  ];

  // resolveEmbedded, exactly, but WITHOUT the `need >= best.dist` short-circuit,
  // so every axis is reported rather than only the ones the real loop bothered
  // to test. The winner is the same winner.
  const resolveRep = (x, y, z, ux, uy, uz) => {
    const solid = [];
    for (const h of SAMPLES_M) {
      const px = x + ux * h, py = y + uy * h, pz = z + uz * h;
      if (solidW(px, py, pz)) solid.push([px, py, pz]);
    }
    const perAxis = [];
    let best = null;
    for (const [name, [ax, ay, az]] of AXES) {
      let need = 0;
      for (const [px, py, pz] of solid) {
        const q = ax !== 0 ? px : ay !== 0 ? py : pz;
        const sign = ax !== 0 ? ax : ay !== 0 ? ay : az;
        const cell = Math.floor(q / CELL_M);
        const exit = sign > 0 ? (cell + 1) * CELL_M - q : q - cell * CELL_M;
        if (exit > need) need = exit;
      }
      need += 1e-3;
      const sx = x + ax * need, sy = y + ay * need, sz = z + az * need;
      const frees = solid.length > 0 && capsuleFree(sx, sy, sz, ux, uy, uz);
      perAxis.push({
        axis: name, needM: r6(need), frees,
        samplesSolidAfterPush: solid.length === 0 ? 0 : capsuleSolidCount(sx, sy, sz, ux, uy, uz),
      });
      if (frees && (best === null || need < best.needM)) best = { axis: name, needM: need };
    }
    return { solidSamples: solid.length, perAxis, push: solid.length === 0 ? null : best };
  };

  // CELL-SIZE INDEPENDENT CONTROL: how far along this axis would you have to go
  // before the whole capsule is in air at all?
  const nearestFree = (x, y, z, ux, uy, uz, ax, ay, az, maxM, stepM) => {
    for (let k = stepM; k <= maxM + 1e-9; k += stepM) {
      if (capsuleFree(x + ax * k, y + ay * k, z + az * k, ux, uy, uz)) return k;
    }
    return null;
  };

  const marchToAir = (x, y, z, ux, uy, uz, sgn, maxM, stepM, pred) => {
    for (let d = 0; d <= maxM + 1e-9; d += stepM) {
      const px = x + ux * sgn * d, py = y + uy * sgn * d, pz = z + uz * sgn * d;
      if (!pred(px, py, pz)) return d;
    }
    return null;
  };

  const MARCH_MAX_M = A.marchMaxM ?? 40;
  const MARCH_STEP_M = A.marchStepM ?? 0.02;
  const CONTROL_STEP_M = 0.25;

  const measure = (tag, traceTick, lossTick) => {
    const w = of.world();
    const pl = w.player;
    const p = pl.feet;
    const [px, py, pz] = p;
    const feetR = Math.hypot(px, py, pz);
    const u = unit(p);
    const [ux, uy, uz] = u;
    const surfR = surfRadius(ux, uy, uz);

    const samples = SAMPLES_M.map((h) => {
      const sx = px + ux * h, sy = py + uy * h, sz = pz + uz * h;
      const r = Math.hypot(sx, sy, sz);
      return {
        hM: h, solidForWalker: solidW(sx, sy, sz), rawSolidAt: solidRaw(sx, sy, sz),
        radiusM: r6(r), surfaceRadiusM: r6(surfRadius(sx / r, sy / r, sz / r)),
        belowSurface: r <= surfRadius(sx / r, sy / r, sz / r),
      };
    });

    const upWalker = marchToAir(px, py, pz, ux, uy, uz, +1, MARCH_MAX_M, MARCH_STEP_M, solidW);
    const upRaw = marchToAir(px, py, pz, ux, uy, uz, +1, MARCH_MAX_M, MARCH_STEP_M, solidRaw);
    const dnWalker = marchToAir(px, py, pz, ux, uy, uz, -1, MARCH_MAX_M, MARCH_STEP_M, solidW);
    const dnRaw = marchToAir(px, py, pz, ux, uy, uz, -1, MARCH_MAX_M, MARCH_STEP_M, solidRaw);

    const floor = floorBelowRep(feetR, ux, uy, uz, SEARCH_M, RISE_M);
    const emb = resolveRep(px, py, pz, ux, uy, uz);
    const control = AXES.map(([name, [ax, ay, az]]) => ({
      axis: name,
      nearestFreeM: nearestFree(px, py, pz, ux, uy, uz, ax, ay, az, MARCH_MAX_M, CONTROL_STEP_M),
    }));

    const needsInBound = emb.perAxis.every((a) => a.needM > 0 && a.needM <= CELL_M + 2e-3);

    return {
      tag,
      traceTick, lossTick,
      staleTicks: lossTick === null ? null : traceTick - lossTick,
      feetR: r6(feetR),
      surfaceRadiusM: r6(surfR),
      depthBelowSurfaceM: r3(surfR - feetR),
      // The walker only consults floorBelow at all when this is true.
      deepEnoughForVoxelBranch: feetR < surfR - DEEP_UNDERGROUND_M,
      grounded: pl.grounded,
      underRock: pl.underRock,
      blockedByRock: pl.blockedByRock,
      voxelPushM: r6(pl.voxelPushM),
      feet: p.map(r6),
      feetSolidForWalker: solidW(px, py, pz),
      feetRawSolidAt: solidRaw(px, py, pz),
      capsuleSamples: samples,
      capsuleSamplesSolid: samples.filter((s) => s.solidForWalker).length,
      // (A): how far up the radial before there is AIR.
      upToAirWalkerM: upWalker === null ? null : r3(upWalker),
      upToAirRawM: upRaw === null ? null : r3(upRaw),
      // Is there air BELOW at all? Slab versus shaft.
      downToAirWalkerM: dnWalker === null ? null : r3(dnWalker),
      downToAirRawM: dnRaw === null ? null : r3(dnRaw),
      riseAllowanceM: RISE_M,
      floorBelowReplicated: floor.r === null ? null : r6(floor.r),
      floorBelowBranch: floor.branch,
      floorBelowFeetInRawRock: floor.feetInRock,
      // (B): the six candidate pushes, as resolveEmbedded computes them.
      embeddedSolidSamples: emb.solidSamples,
      embeddedPerAxis: emb.perAxis,
      embeddedPush: emb.push,
      embeddedNeedsWithinOneCell: needsInBound,
      // The control: how deep is the burial really?
      nearestFreeByAxis: control,
      anyAxisFreeWithin40M: control.some((c) => c.nearestFreeM !== null),
      // The two halves of the hypothesis, at this block.
      checkA_floorBelowNullByRockAbove:
        floor.r === null && floor.branch === 'feet-in-rock'
        && (upRaw === null || upRaw > RISE_M),
      checkB_resolveEmbeddedNull: emb.push === null && emb.solidSamples > 0,
    };
  };

  // ---- THE WALK, SLICED, WITH THE TRACE ARMED THROUGHOUT ------------------
  let s = [];
  let traceDropped = 0;
  const drain = () => {
    const d = of.stand();
    if (d === null || d.samples === undefined) return;
    if (d.total > d.samples.length) traceDropped += d.total - d.samples.length;
    for (const x of d.samples) s.push(x);
    of.stand(true);
  };

  let lastGroundedR = null;
  let prevFeetR = null;
  let lossStreak = 0;
  let block1 = null, block2 = null;
  let block1TraceTick = null;
  let polls = 0;

  // The tick the trace says the floor was lost: the last sample with
  // grounded===true. Read at capture time, so `staleTicks` is honest about how
  // far behind the poll was.
  const lastGroundedTraceTick = () => {
    for (let i = s.length - 1; i >= 0; --i) if (s[i].grounded) return i;
    return null;
  };

  const poll = () => {
    ++polls;
    drain();
    const pl = P();
    if (pl === null) return;
    const feetR = Math.hypot(pl.feet[0], pl.feet[1], pl.feet[2]);
    if (pl.grounded) { lastGroundedR = feetR; lossStreak = 0; prevFeetR = feetR; return; }
    const falling = prevFeetR === null || feetR < prevFeetR;
    const dropped = lastGroundedR !== null && feetR < lastGroundedR - 0.5;
    if (!pl.underRock && dropped && falling) ++lossStreak; else lossStreak = 0;
    prevFeetR = feetR;
    if (block1 === null && lossStreak >= 2) {
      block1TraceTick = s.length;
      block1 = measure('entry', s.length, lastGroundedTraceTick());
      log.push(`captured block 1 at trace tick ${s.length}, `
        + `${block1.staleTicks} ticks after the last grounded tick`);
      return;
    }
    if (block1 !== null && block2 === null
      && s.length >= block1TraceTick + (A.secondBlockTicks ?? 400)) {
      block2 = measure('deep', s.length, lastGroundedTraceTick());
      log.push(`captured block 2 at trace tick ${s.length}`);
    }
  };

  const SLICE_TICKS = A.sliceTicks ?? 6;
  // Same total frame count as `of.run(secs, 60)`: round(secs * 60) frames, run
  // in whole-tick slices. Only the yield placement differs, so the drive is the
  // same drive with a poll between slices.
  const runSliced = async (secs) => {
    const total = Math.max(1, Math.round(secs * 60));
    let done = 0;
    while (done < total) {
      const n = Math.min(SLICE_TICKS, total - done);
      await of.run(n / 60, 60);
      done += n;
      poll();
    }
  };
  const holdW = async (secs, keys) => {
    of.input.tape([{ hold: Math.ceil(60 * secs) + 30, keys }]);
    await runSliced(secs);
  };
  const settleW = async (secs) => {
    of.input.tape([{ hold: Math.ceil(60 * secs) + 30, keys: [] }]);
    await runSliced(secs);
  };

  of.stand(true);
  const marks = [];
  await phase('walk', async () => {
    for (let k = 0; k < (A.stops ?? 18); ++k) {
      const roll = rnd();
      const keys = roll < 0.4 ? ['KeyW'] : roll < 0.6 ? ['KeyS'] : roll < 0.8 ? ['KeyA'] : ['KeyD'];
      await holdW(0.3 + rnd() * 0.4, keys);
      await settleW(1.0);
      marks.push({ k, keys: keys.join(''), tick: s.length });
      await settleW(4);
    }
  });
  of.stand(false);

  const walkPhase = phases[phases.length - 1];
  if (walkPhase.ticks <= 0) {
    return fail('the walk phase advanced 0 ticks: nothing was measured', { phases, polls });
  }
  if (s.length === 0) {
    return fail('the stand trace recorded 0 ticks: nothing was measured', { phases, polls });
  }

  let t = 0;
  const sIdx = s.map((x) => ({ ...x, t: t++ }));
  let lastGrounded = -1;
  for (let i = 0; i < sIdx.length; ++i) if (sIdx[i].grounded) lastGrounded = i;
  const lostFloor = lastGrounded >= 0 && lastGrounded < sIdx.length - 60;

  const p = P();
  const uF = unit(p.feet);
  const sfF = of.surface(uF[0], uF[1], uF[2]);
  const feetRF = Math.hypot(...p.feet);
  log.push(`${s.length} traced ticks (${traceDropped} dropped by the ring), `
    + `${polls} polls; last grounded tick ${lastGrounded}; final feetR ${r6(feetRF)}, `
    + `${r3(bodyR + sfF.surfaceM - feetRF)} m under the surface`);
  log.push(`cell size ${CELL_M} m read from core/include/of/voxel_terrain.h `
    + `(kVoxelSizeM, exported as of_voxel_size but not on window.__of); `
    + `riseM ${RISE_M} read live from of.voxelStepUpM[0]`);

  if (block1 === null) {
    return fail('never caught the loss: the walker kept its floor, or the '
      + 'detector never armed', {
      phases, polls, tracedTicks: s.length, lastGroundedTick: lastGrounded,
      lostFloor,
      finalDepthBelowSurfaceM: r3(bodyR + sfF.surfaceM - feetRF),
      finalGrounded: p.grounded, finalUnderRock: p.underRock,
    });
  }

  const row = (x) => ({
    t: x.t, feetR: r6(x.feetR),
    terrainR: Number.isFinite(x.terrainR) ? r6(x.terrainR) : String(x.terrainR),
    groundR: Number.isFinite(x.groundR) ? r6(x.groundR) : String(x.groundR),
    preSnapR: r6(x.preSnapR), fallM: r6(x.fallM), underRock: x.underRock,
    grounded: x.grounded, pushM: r6(x.pushM), pushUpM: r6(x.pushUpM),
  });

  // `valid` is THE RUN WAS SET UP AND THE LOSS WAS CAUGHT. `pass` is THE
  // HYPOTHESIS WAS CONFIRMED, which is the opposite polarity to most probes on
  // purpose: this one is asking a question, not guarding a contract, and a
  // reader has to be able to see WHICH half held.
  const checks = [
    ['A/entry: floorBelow returns null because raw rock extends past riseM above the feet',
      block1.checkA_floorBelowNullByRockAbove,
      `floorBelow ${block1.floorBelowReplicated === null ? 'null' : block1.floorBelowReplicated}`
      + ` via ${block1.floorBelowBranch}; air up (raw) `
      + `${block1.upToAirRawM === null ? '>40' : block1.upToAirRawM} m vs riseM ${RISE_M}`],
    ['B/entry: resolveEmbedded returns null because no one-cell axis push frees the capsule',
      block1.checkB_resolveEmbeddedNull,
      `${block1.embeddedSolidSamples}/3 samples solid, push `
      + `${block1.embeddedPush === null ? 'null' : JSON.stringify(block1.embeddedPush)}`],
    ['A/deep: the same, several hundred ticks deeper',
      block2 !== null && block2.checkA_floorBelowNullByRockAbove,
      block2 === null ? 'block 2 never captured'
        : `air up (raw) ${block2.upToAirRawM === null ? '>40' : block2.upToAirRawM} m`],
    ['B/deep: the same, several hundred ticks deeper',
      block2 !== null && block2.checkB_resolveEmbeddedNull,
      block2 === null ? 'block 2 never captured'
        : `push ${block2.embeddedPush === null ? 'null' : JSON.stringify(block2.embeddedPush)}`],
    ['every axis `need` lies within one cell, so the recited cell size is consistent',
      block1.embeddedNeedsWithinOneCell && (block2 === null || block2.embeddedNeedsWithinOneCell),
      `cellM ${CELL_M}`],
  ];
  const failed = checks.filter((c) => !c[1]).map((c) => `${c[0]}  [${c[2]}]`);

  return {
    valid: true,
    pass: failed.length === 0,
    failed,
    checks: checks.map((c) => ({ name: c[0], held: c[1], measured: c[2] })),
    seed: A.seed ?? 991733,
    site: { lat: r6(site.lat), lon: r6(site.lon), yaw: yaw0.yaw },
    // DW-20: the simulation demonstrably advanced, per phase.
    phases,
    polls,
    tracedTicks: s.length,
    traceDropped,
    lastGroundedTick: lastGrounded,
    lostFloor,
    finalDepthBelowSurfaceM: r3(bodyR + sfF.surfaceM - feetRF),
    finalGrounded: p.grounded,
    finalUnderRock: p.underRock,
    constants: {
      capsuleSamplesM: SAMPLES_M, riseM: RISE_M, floorSearchM: SEARCH_M,
      cellM: CELL_M, deepUndergroundM: DEEP_UNDERGROUND_M,
      marchMaxM: MARCH_MAX_M, marchStepM: MARCH_STEP_M, controlStepM: CONTROL_STEP_M,
    },
    block1,
    block2,
    around: lastGrounded < 0 ? null
      : sIdx.slice(Math.max(0, lastGrounded - 6), lastGrounded + 10).map(row),
    marks,
    log,
  };
})()
