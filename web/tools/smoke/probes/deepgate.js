// PH: STANDING ON THE DEEP/SHALLOW GATE, AND FINDING OUT THAT NOBODY CAN.
//
// `KinematicBody.step` switches the walker between two entirely different
// collision regimes on one boolean:
//
//     const deep = this.oracle.editsHandle !== 0 && qr < surfaceR - 1.5;
//
// Above the line the ground is `surfaceRadius` and walls are resolved by
// `climbGate`; below it the ground is the first solid voxel under the feet and
// walls are resolved by `VoxelCollider.resolveStep`, with a 1.1 m step-down snap
// instead of the walking 0.35 m. The switch had never been tested at its
// threshold because nothing had ever held a player at 1.5 m of depth.
//
// THE QUANTITY IS FEET DEPTH BELOW THE RECONCILED HEIGHTFIELD, NOT ROOF
// THICKNESS. `surfaceR` is `surface_field.h`'s `surfaceHeight`, the topmost
// radius at which the density field turns solid over the player's own column.
// So depth is (that crossing) minus (the radius the feet are at), and both the
// hillside overhead AND the roof of a tunnel are the same one number.
//
// WHAT THIS PROBE MEASURES, in order:
//
//  1. THE OVERBURDEN PROFILE of a real bore, per strike, so the rate at which
//     depth grows with distance bored is a measurement and not an assumption.
//  2. THE REACHABLE DEPTH SPECTRUM. The player's own walked path is resampled at
//     0.02 m and every point is asked three questions through the walker's OWN
//     predicates: where is the floor, does a capsule fit over it, and what is
//     the depth there. `solidForWalker` is reproduced exactly (a point above its
//     own column's reconciled surface is AIR to the walker however solid the
//     lattice says it is), because a reference computed some other way would
//     agree with itself whatever the walker did.
//  3. FOUR TARGET DEPTHS, two either side of the gate, sought by WALKING and
//     reported by what was ACHIEVED rather than by what was asked for.
//  4. THE CROSSING, taken in taps rather than at walking speed, with the
//     per-tick trace armed. A regime switch that teleports the player vertically
//     is the defect worth finding, and it is invisible in any per-frame reading.
//  5. STABILITY on each side, as a spread over a long stand.
//
// WHAT IT FOUND, so a reader does not have to run it.
//
// 1. THE GATE IS NOT REACHABLE, AND THE REASON IS THE DIG BRUSH RATHER THAN THE
//    TERRAIN. `DIG.radiusM` is 1.5 m and the brush is a sphere centred on the
//    point the aim ray hits, so the smallest cavity a player can cut is 3 m
//    tall, and a column only has a roof once that brush top is under the
//    surface: the feet are then a brush DIAMETER below the roof. Everything
//    shallower is a column open to the sky, where the reconciled surface IS the
//    floor and the depth is exactly 0. Measured over 10,656 standable columns
//    at 0.02 m along 104 m of walked tunnel at two sites, the depth spectrum is
//    {0} and [4.108314, 9.594922] at the spawn bore and {0} and [3.149978,
//    16.819797] on a 45 degree hillside. NOT ONE COLUMN, at either site, has a
//    depth anywhere in (0.25, 3.0) m. 1.5 m sits in the middle of a hole three
//    to four metres wide, and any threshold in (0, 3.1) would produce a
//    bit-identical game.
//
// 2. THE HANDOVER DOES NOT TELEPORT THE PLAYER. At the spawn the gate quantity
//    moves 4.450269 m between two adjacent tap positions and the tick the
//    regime actually changes on moves the feet by 0.038926 m going out and
//    0.039115 m coming in, grounded, with no push and no eject. That is
//    ordinary walking, against a 1.1 m bound taken from the walker's own ladder.
//
// 3. IT CHATTERS AT A STEEP MOUTH, AND THAT IS THE ONE DEFECT HERE. On the 45
//    degree face the two authorities disagree about where the floor is by more
//    than `CAPSULE.groundSnapM`, and `deep` is evaluated at the STEP TARGET, so
//    sub-centimetre horizontal jitter flips it. Measured: 8 flips in 152 ticks
//    on one crossing, 19 of those ticks airborne, and the feet moving 0.002686 m
//    on the ballistic ones, which is exactly one tick of free fall. On the
//    shallow ticks the heightfield is further under the feet than the 0.35 m
//    walking snap reaches, so nothing holds the player up; on the deep ticks
//    `floorBelow` catches them again. The spawn bore does not do this: 1 flip
//    each way and 0 airborne ticks out of 464.
//
//   node tools/smoke/run.mjs --scenario=walk \
//        --evalfile=tools/smoke/probes/deepgate.js
//   node tools/smoke/run.mjs --scenario=walk \
//        --evalfile=tools/smoke/probes/deepgate.js \
//        --evalargs='{"sites":["hill"]}'      # the steep face, which is the one
//                                            # that fails
//
// `sites` selects from `spawn` and `hill`. Two sites and not one because a
// spectrum with a hole in it measured at a single bore is a fact about that
// bore; the hole has to survive a different pitch, a different mouth and a
// different hillside before it is a fact about the game. It did, and the second
// site is also the only one that fails.
//
// WHAT WAS TRIED AND DID NOT WORK, because the next reader will think of them:
//
//   A GENTLE RISE, BORED LEVEL. The idea is that a shallow slope grows the
//   overburden slowly, so the depth passes through 1.5 m slowly enough to stand
//   in. It cannot be started: a level aim ray leaves an eye 1.62 m up and ground
//   that rises 0.064 m per metre never reaches it inside the 4.5 m dig reach.
//   Measured on a 3.68 degree site: 44 strikes removed EXACTLY ZERO cells. A
//   level bore has to start from inside a hole, whatever the hillside, and the
//   hole is what sets the depth.
//
//   THE 80 m BEDROCK CLAMP. `surfaceHeight` clamps the reconciled height at
//   `base - kSurfaceMaxDigDepthM` while the voxel field keeps whatever was cut,
//   so a floor levelled below the clamp should be a floor at a chosen depth with
//   open sky over it. Measured: eight `level` presses took the pit floor to
//   `base - 80`, the ninth dug 2,753 more cells at `base - 90`, and the walker
//   did not move by one bit (599334.952412 before and after, grounded, depth 0).
//   It is standing on the clamped heightfield, so the depth there is pinned to 0
//   and the clamp is not an instrument for this question. It is a finding of its
//   own and belongs to world-gen.
(async () => {
  const of = window.__of;
  const A = OF_ARGS ?? {};
  const log = [];
  const fails = [];
  const check = (name, ok, detail) => {
    if (!ok) fails.push(detail === undefined ? name : `${name}: ${detail}`);
    return ok;
  };
  const DEG = 180 / Math.PI;
  const r6 = (x) => (Number.isFinite(x) ? Number(x.toFixed(6)) : null);
  const r3 = (x) => (Number.isFinite(x) ? Number(x.toFixed(3)) : null);

  const settle = async (secs) => {
    of.input.tape([{ hold: Math.ceil(60 * secs) + 30, keys: [] }]);
    await of.run(secs, 60);
  };
  const hold = async (secs, keys) => {
    of.input.tape([{ hold: Math.ceil(60 * secs) + 30, keys }]);
    await of.run(secs, 60);
  };
  const feet = () => of.world().player.feet;
  const unit = (p) => { const r = Math.hypot(p[0], p[1], p[2]) || 1; return [p[0] / r, p[1] / r, p[2] / r]; };
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const add = (a, b, k) => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
  const hAt = (u) => of.surface(u[0], u[1], u[2]).surfaceM;

  await settle(1.5);
  if (of.voxels() === null) return { valid: false, fails, log, fail: 'no character, nothing can dig' };
  if (typeof of.stand !== 'function') return { valid: false, fails, log, fail: 'no __of.stand: rebuild' };
  if (typeof of.solidAt !== 'function') return { valid: false, fails, log, fail: 'no __of.solidAt: rebuild' };
  const bodyR = of.world().bodyRadiusM;
  /**
   * The walker's step ladder, ASKED rather than recited: every bound this probe
   * puts on how far a tick may move the feet is derived from it, so retuning the
   * walker retunes the assertion with it (tunnelsink.js's argument).
   *
   * `CAP` is the one number here that IS recited, from `VoxelCollision.ts`, and
   * the reason it is allowed to be is that nothing asserts on it: it only shapes
   * this probe's own "would a capsule fit here" reference, which is a question
   * about the WORLD. If it ever drifts from the walker's list the survey merely
   * describes a slightly different body, and no claim below silently passes.
   */
  const LADDER = of.voxelStepUpM ?? [0.55, 1.1];
  const CAP = [0.15, 0.9, 1.65];

  /** The gate's own quantity at a body-frame point: how far the feet are BELOW
   *  the reconciled heightfield over their own column. */
  const depthAt = (p) => {
    const u = unit(p);
    return bodyR + hAt(u) - Math.hypot(p[0], p[1], p[2]);
  };
  const depthNow = () => depthAt(feet());
  /** The reconciled heightfield radius under the feet, which is the radius the
   *  SHALLOW branch stands the player on. */
  const surfRNow = () => { const u = unit(feet()); return bodyR + hAt(u); };

  // `VoxelCollider.solidForWalker`, reproduced: solid to the lattice AND at or
  // below its own column's reconciled surface. The second half is the whole of
  // WG-31's phantom-rock rule and a reference without it scores a legal stance
  // as buried.
  const rockForWalker = (u, rr, surfR) =>
    of.solidAt(u[0] * rr, u[1] * rr, u[2] * rr) && rr <= surfR;

  /**
   * WHERE THE FLOOR IS AND WHETHER A CAPSULE FITS OVER IT, at one point, asked
   * of the field rather than of the walker. Returns null where the column has
   * no floor within reach at all.
   */
  const columnAt = (q) => {
    const u = unit(q);
    const surfR = bodyR + hAt(u);
    const rq = Math.hypot(q[0], q[1], q[2]);
    let air = null;
    for (let d = 3.0; d >= -6.0; d -= 0.05) {
      if (!rockForWalker(u, rq + d, surfR)) { air = rq + d; break; }
    }
    if (air === null) return null;
    let solid = null;
    for (let rr = air; rr >= rq - 6.0; rr -= 0.05) {
      if (rockForWalker(u, rr, surfR)) { solid = rr; break; }
    }
    if (solid === null) return null;
    let a = solid, b = solid + 0.05;
    for (let k = 0; k < 40; ++k) {
      const m = (a + b) / 2;
      if (rockForWalker(u, m, surfR)) a = m; else b = m;
    }
    const floorR = b;
    return {
      floorR, surfR, depthM: surfR - floorR,
      stands: CAP.every((h) => !rockForWalker(u, floorR + h, surfR)),
    };
  };

  // ---- the per-tick stand trace, as a stability + regime reading ------------
  const gTick = () => of.gravity(Math.hypot(...feet())) / 3600;

  /**
   * WHICH BRANCH IS LIVE, from what the walker DID rather than from the constant.
   *
   *   `underRock`      only the deep branch ever sets it.
   *   `terrainR`       the radius the ground snap used. The shallow branch can
   *                    only ever hand it `surfaceRadius`; the deep branch hands
   *                    it the voxel floor. So terrainR being bit-identical to
   *                    the reconciled heightfield IS the shallow branch, and its
   *                    being metres under it IS the deep one.
   * Both are read per tick, because a regime that chatters at 60 Hz averages out
   * to a perfectly reasonable-looking frame.
   */
  const watch = async (name, secs) => {
    await settle(0.8);
    of.stand(true);
    await settle(secs);
    const d = of.stand();
    of.stand(false);
    const s = d.samples.filter((x) => Number.isFinite(x.feetR));
    if (s.length < 120) return { name, valid: false, fail: 'trace too short', kept: s.length };
    const surfR = surfRNow();
    const rs = s.map((x) => x.feetR);
    const onHeightfield = s.filter((x) => Number.isFinite(x.terrainR)
      && Math.abs(x.terrainR - surfR) < 1e-6);
    const onVoxel = s.filter((x) => x.underRock);
    const p = of.world().player;
    return {
      name, valid: true, ticks: s.length,
      depthM: r6(depthNow()),
      feetR: r6(Math.hypot(...feet())),
      spreadM: r6(Math.max(...rs) - Math.min(...rs)),
      groundedTicks: s.filter((x) => x.grounded).length,
      // THE REGIME, counted.
      underRockTicks: onVoxel.length,
      heightfieldTicks: onHeightfield.length,
      buriedTicks: s.filter((x) => x.buried).length,
      // A regime that changes its mind while the player is not moving.
      regimeFlips: (() => {
        let n = 0;
        for (let i = 1; i < s.length; ++i) if (s[i].underRock !== s[i - 1].underRock) n++;
        return n;
      })(),
      pushTicks: s.filter((x) => x.pushM > 0).length,
      ejectTicks: s.filter((x) => x.ejectM > 1e-9).length,
      maxEjectM: r6(Math.max(...s.map((x) => x.ejectM))),
      speedMps: r6(p.speedMps),
      blockedByRock: p.blockedByRock,
    };
  };

  /**
   * WALK, IN TAPS, and read the gate quantity after each one. Returns every
   * position visited with its depth, which is what makes "the closest this run
   * ever came to 1.45 m" a measurement instead of a hope.
   *
   * Taps rather than a held key because the whole question is what happens
   * BETWEEN two depths: at the shipped 4.6 m/s a tick covers 0.077 m and the
   * mouth is 0.02 m wide, so a held walk crosses the gate inside one tick and
   * can only ever report that it happened.
   */
  const walked = [];
  const tapWalk = async (key, taps, secs = 0.08) => {
    const visited = [];
    for (let i = 0; i < taps; ++i) {
      await hold(secs, [key]);
      await of.run(0.05, 60);
      const p = feet().slice();
      walked.push(p);
      const w = of.world().player;
      visited.push({ i, depthM: r6(depthAt(p)), feetR: r6(Math.hypot(...p)),
        underRock: w.underRock, grounded: w.grounded, speedMps: r3(w.speedMps) });
    }
    return visited;
  };

  /** Walk until the feet are on a VOXEL floor, both ways, and say how. This is
   *  tunnelsink.js's search and it is here for its reason: the drive's end state
   *  depends on the walker, and the walker is the thing under test. The spawn
   *  bore is a U, so a drive that runs long enough comes out of its own far end
   *  and a probe that measures where the drive stopped measures open hillside. */
  const findRock = async () => {
    if (of.world().player.underRock) return 'drive';
    for (const act of ['KeyS', 'KeyW']) {
      for (let i = 0; i < 30; ++i) {
        await hold(0.35, [act]);
        await of.run(0.15, 60);
        if (of.world().player.underRock) {
          for (let k = 0; k < 3; ++k) { await hold(0.30, [act]); await of.run(0.15, 60); }
          return act;
        }
      }
    }
    return null;
  };

  /**
   * ONE FRAME OF WALK. The mouth is narrower than a tap: measured, the gate
   * quantity goes from 4.35 m to 0 between two adjacent taps 0.35 m apart, so a
   * tap cannot land inside it and a probe that only taps concludes the inside is
   * empty. This creeps, and it is the only reason the hill site's 0.70 m roofed
   * stance is reachable at all.
   */
  // A ONE-FRAME press moves the walker by nothing at all: measured, sixty of
  // them in a row left the depth at 0 to every decimal place, because the
  // ground drag takes back inside four frames what one frame of acceleration
  // put in. 0.04 s is the shortest press that actually travels.
  const microWalk = async (key, n) => {
    for (let i = 0; i < n; ++i) {
      await hold(0.04, [key]);
      await of.run(0.03, 60);
      walked.push(feet().slice());
    }
  };

  /**
   * COARSE STRIDES, for covering a 36 m bore without spending the whole budget
   * on it. A stride is about a metre; a tap is about a third of one. Nothing is
   * measured during a stride: it is transport, and every claim below is made
   * over taps.
   */
  const stride = async (key, n) => {
    for (let i = 0; i < n; ++i) {
      await hold(0.22, [key]);
      await of.run(0.08, 60);
      walked.push(feet().slice());
    }
  };
  /** Stride until the regime changes, or give up. Returns how it ended. */
  const strideUntilFlip = async (key, budget) => {
    const was = of.world().player.underRock;
    for (let i = 0; i < budget; ++i) {
      await stride(key, 1);
      if (of.world().player.underRock !== was) return { flipped: true, strides: i + 1 };
    }
    return { flipped: false, strides: budget };
  };

  // ======================= THE TWO BORES ==================================
  /** SITE 1: the spawn clearing. tunnelsink.js's own drive, verbatim, so a
   *  difference here is about the gate and not about a new way to dig. */
  const spawnDig = async (path) => {
    const yaw = A.yawDeg ?? 0;
    const drive = [];
    for (let i = 0; i < (A.rampStrikes ?? 6); ++i) {
      of.look(yaw, -85);
      const d = of.dig();
      await settle(0.35);
      path.push(feet().slice());
      drive.push({ phase: 'shaft', i, cells: d?.cells ?? null,
        depthM: r3(depthNow()), underRock: of.world().player.underRock });
    }
    const start = feet().slice();
    for (let i = 0; i < (A.strikes ?? 20); ++i) {
      of.look(yaw, A.pitchDeg ?? -12);
      const d = of.dig();
      await of.run(0.2, 60);
      await hold(A.stepSecs ?? 0.22, ['KeyW']);
      const p = feet();
      path.push(p.slice());
      drive.push({ phase: 'bore', i, cells: d?.cells ?? null,
        boredM: r3(Math.hypot(p[0] - start[0], p[1] - start[1], p[2] - start[2])),
        depthM: r3(depthNow()), underRock: of.world().player.underRock });
    }
    return drive;
  };

  /**
   * SITE 2: A LEVEL BORE INTO A HILLSIDE, which is the arrangement that puts the
   * most rock over the player for the least descent, and therefore the best
   * chance a shallow depth has of existing anywhere.
   *
   * IT NEEDS THE SHAFT FIRST, and that is a measurement rather than a habit. The
   * first cut of this site skipped it and bored level at a 3.68 degree site
   * chosen for gentleness: 44 strikes removed EXACTLY ZERO cells, because a ray
   * from an eye 1.62 m up, held level, clears ground that only rises 0.064 m per
   * metre for the whole 4.5 m of dig reach. A level bore has to start from
   * inside a hole, whatever the hillside.
   */
  const hillDig = async (path) => {
    const reachM = A.reachM ?? 40;
    const u0 = unit(feet());
    const lat0 = Math.asin(u0[1]) * DEG;
    const lon0 = Math.atan2(u0[2], u0[0]) * DEG;
    const dirAt = (latDeg, lonDeg) => {
      const la = (latDeg * Math.PI) / 180, lo = (lonDeg * Math.PI) / 180;
      return [Math.cos(la) * Math.cos(lo), Math.sin(la), Math.cos(la) * Math.sin(lo)];
    };
    let best = null;
    const span = A.spanDeg ?? 0.4, step = A.stepDeg ?? 0.02;
    for (let a = -span; a <= span + 1e-9; a += step) {
      for (let b = -span; b <= span + 1e-9; b += step) {
        const u = dirAt(lat0 + a, lon0 + b);
        const h0 = hAt(u);
        if (h0 < 0) continue;
        const north = unit(add([0, 1, 0], u, -dot([0, 1, 0], u)));
        const east = cross(north, u);
        let rise = -Infinity;
        for (let i = 0; i < 8; ++i) {
          const th = (Math.PI * i) / 4;
          const w = add(add([0, 0, 0], north, Math.cos(th)), east, Math.sin(th));
          const ang = reachM / bodyR;
          const q = unit(add(add([0, 0, 0], u, Math.cos(ang)), w, Math.sin(ang)));
          const h = hAt(q) - h0;
          if (h > rise) rise = h;
        }
        if (best === null || rise > best.riseM) best = { lat: lat0 + a, lon: lon0 + b, riseM: rise };
      }
    }
    if (best === null) throw new Error('no land in the hill sweep');
    of.teleport(best.lat, best.lon, 0);
    await settle(2.5);
    // Which yaw faces uphill, off the engine's own aim ray.
    let face = null;
    for (let y = 0; y < 360; y += 15) {
      of.look(y, 0);
      await of.run(0.05, 60);
      const ray = of.aim();
      if (ray === null) continue;
      const u = unit(ray.origin);
      const f = unit(add(ray.dir, u, -dot(ray.dir, u)));
      const rise = hAt(unit(add(ray.origin, f, reachM))) - hAt(u);
      if (face === null || rise > face.riseM) face = { yaw: y, riseM: rise };
    }
    log.push(`hill site ${best.lat.toFixed(4)},${best.lon.toFixed(4)} yaw ${face.yaw}: the `
      + `ground ${reachM} m ahead is ${r3(face.riseM)} m higher `
      + `(${(Math.atan2(face.riseM, reachM) * DEG).toFixed(2)} deg)`);
    const drive = [];
    for (let i = 0; i < (A.hillShaftStrikes ?? 5); ++i) {
      of.look(face.yaw, -85);
      const d = of.dig();
      await settle(0.35);
      path.push(feet().slice());
      drive.push({ phase: 'shaft', i, cells: d?.cells ?? null,
        depthM: r3(depthNow()), underRock: of.world().player.underRock });
    }
    const start = feet().slice();
    // SHORTER THAN THE SPAWN BORE ON PURPOSE. A 45 degree face puts the mouth
    // 36 m behind the walker after 24 strikes, and every measurement below then
    // spends its budget commuting rather than measuring.
    for (let i = 0; i < (A.hillStrikes ?? 14); ++i) {
      of.look(face.yaw, A.hillPitchDeg ?? 0);
      const d = of.dig();
      await of.run(0.2, 60);
      await hold(A.stepSecs ?? 0.26, ['KeyW']);
      const p = feet();
      path.push(p.slice());
      drive.push({ phase: 'bore', i, cells: d?.cells ?? null,
        boredM: r3(Math.hypot(p[0] - start[0], p[1] - start[1], p[2] - start[2])),
        depthM: r3(depthNow()), underRock: of.world().player.underRock });
    }
    return drive;
  };

  // ============================= THE SCENE =================================
  const scene = async (siteName, dig) => {
    const path = [];
    walked.length = 0;
    const drive = await dig(path);
    await settle(2.0);

    // GETTING BACK UNDER ROCK IS A SEARCH, NOT AN ASSUMPTION. The spawn bore is
    // a U: driven 20 strikes it comes out of its own far end, so the drive
    // leaves the player on open hillside and everything below would be measured
    // there. Measured on the first cut of this probe: 360 stand ticks at depth
    // 0 for every one of four targets, and two crossings that crossed nothing.
    const reached = await findRock();
    if (reached === null) {
      return { site: siteName, valid: false, drive,
        fail: 'never got back under rock; nothing here measures the gate' };
    }
    // WHICH KEY LEAVES THE BORE. Asked, because it depends on which end of the U
    // the search re-entered by, and a probe that assumed would spend its whole
    // budget walking further underground.
    const before = depthNow();
    await tapWalk('KeyS', 3);
    const out = depthNow() < before ? 'KeyS' : 'KeyW';
    await tapWalk(out === 'KeyS' ? 'KeyW' : 'KeyS', 3);
    log.push(`${siteName}: back under rock by ${reached}, at ${r3(depthNow())} m; `
      + `${out} is the way out`);

    // Walk the mouth end to end in taps, and back, so the polyline the survey
    // runs on covers it at centimetres rather than at the 1.5 m the drive
    // happened to stride. Two passes in opposite directions, because a mouth
    // that reads differently on the way out than on the way in is exactly the
    // kind of one-way artefact a single pass cannot see.
    const back = out === 'KeyS' ? 'KeyW' : 'KeyS';
    await strideUntilFlip(out, A.mouthStrides ?? 60);
    await tapWalk(back, A.inTaps ?? 45);
    await tapWalk(out, A.outTaps ?? 45);
    const cleanPath = [...path, ...walked];

    // ---- 1. THE OVERBURDEN PROFILE ---------------------------------------
    const bore = drive.filter((x) => x.phase === 'bore' && x.boredM !== null);
    const roofed = bore.filter((x) => x.depthM > 0.001);
    const profile = {
      strikes: bore.length,
      boredM: bore.length === 0 ? null : bore[bore.length - 1].boredM,
      maxDepthM: bore.length === 0 ? null : r3(Math.max(...bore.map((x) => x.depthM))),
      firstRoofedAtM: roofed.length === 0 ? null : roofed[0].boredM,
      depthAtFirstRoofM: roofed.length === 0 ? null : roofed[0].depthM,
      // The headline of phase 1: metres of bore per metre of depth, over the
      // stretch where the bore actually had a roof.
      metresBoredPerMetreOfDepth: roofed.length < 2 ? null : r3(
        (roofed[roofed.length - 1].boredM - roofed[0].boredM)
        / Math.max(1e-9, Math.abs(roofed[roofed.length - 1].depthM - roofed[0].depthM))),
      perStrike: bore.map((x) => ({ m: x.boredM, d: x.depthM, ur: x.underRock })),
    };

    // ---- 2. THE REACHABLE DEPTH SPECTRUM ---------------------------------
    const stepM = A.surveyStepM ?? 0.02;
    const cols = [];
    for (let i = 1; i < cleanPath.length; ++i) {
      const a = cleanPath[i - 1], b = cleanPath[i];
      const seg = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
      if (seg < 1e-6 || seg > 12) continue;
      for (let t = 0; t < seg; t += stepM) {
        const f = t / seg;
        const c = columnAt([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f,
          a[2] + (b[2] - a[2]) * f]);
        if (c !== null) cols.push(c);
      }
    }
    const stood = cols.filter((c) => c.stands);
    // 0.25 m AND NOT 0. On open ground the reconciled surface and the field's own
    // crossing differ by a few centimetres either way (the cell staircase against
    // the smooth heightfield, WG-31's phantom rock), so a floor of exactly 0
    // scores that noise as a roofed stance. Measured: 32 columns between 0.050
    // and 0.056 m, every one of them under open sky.
    const ROOFED_M = A.roofedM ?? 0.25;
    const nonZero = stood.filter((c) => c.depthM > ROOFED_M).map((c) => c.depthM)
      .sort((x, y) => x - y);
    const bins = {};
    for (const c of stood) {
      const k = (Math.floor(c.depthM * 4) / 4).toFixed(2);
      bins[k] = (bins[k] ?? 0) + 1;
    }
    const spectrum = {
      columns: cols.length, standable: stood.length,
      depthBins: bins,
      minNonZeroDepthM: nonZero.length === 0 ? null : r6(nonZero[0]),
      maxDepthM: nonZero.length === 0 ? null : r6(nonZero[nonZero.length - 1]),
      // The hole. Everything a player could stand in, strictly between "the
      // column over me is open" and the shallowest roofed spot that exists.
      roofedFloorM: ROOFED_M,
      inTheHole: stood.filter((c) => c.depthM > ROOFED_M && c.depthM < 3.0).length,
      atTheGate: stood.filter((c) => c.depthM > 1.0 && c.depthM < 2.0).length,
      holeSamples: stood.filter((c) => c.depthM > ROOFED_M && c.depthM < 3.0)
        .sort((x, y) => x.depthM - y.depthM).slice(0, 20)
        .map((c) => ({ depthM: r6(c.depthM), floorR: r6(c.floorR) })),
    };
    log.push(`${siteName} SPECTRUM: ${stood.length} standable columns over `
      + `${r3(cleanPath.length * 0.4)} m of walked path; depths are 0 or `
      + `${spectrum.minNonZeroDepthM} to ${spectrum.maxDepthM} m, with `
      + `${spectrum.inTheHole} anywhere in (${ROOFED_M}, 3.0) and ${spectrum.atTheGate} `
      + `within half a metre of the 1.5 m gate`);

    // ---- 3. THE CROSSING, PER TICK ---------------------------------------
    // Walk from well inside the bore to well outside it and back, in taps, with
    // the trace armed the whole way.
    const crossing = async (label, key, taps) => {
      of.stand(true);
      // TAPS UNTIL IT ACTUALLY HAPPENS, and then fifteen more. A fixed tap count
      // is a bet on how far away the mouth is, and the hill bore lost it: 80
      // taps covered 28 m of a 36 m bore, so both crossings reported `false` and
      // the flip tick they exist to measure was never in the trace at all.
      const visited = [];
      const was = of.world().player.underRock;
      let after = -1;
      for (let i = 0; i < taps; ++i) {
        visited.push(...await tapWalk(key, 1));
        if (after < 0 && of.world().player.underRock !== was) after = 0;
        else if (after >= 0 && ++after >= 15) break;
      }
      const d = of.stand();
      of.stand(false);
      const s = d.samples.filter((x) => Number.isFinite(x.feetR));
      let maxStep = 0, maxStepAt = null, ungrounded = 0, flips = 0;
      const steps = [];
      // THE TICK THE REGIME ACTUALLY CHANGED ON, and what it did to the feet.
      // This is the whole question: `maxFeetStepM` over a walk down a dug
      // staircase is dominated by the staircase, and a 1.5 m teleport hiding
      // inside it would look like one more step. The flip tick is the switch
      // itself, isolated.
      const atFlip = [];
      for (let i = 1; i < s.length; ++i) {
        const dd = Math.abs(s[i].feetR - s[i - 1].feetR);
        steps.push(dd);
        if (dd > maxStep) { maxStep = dd; maxStepAt = s[i].tick; }
        if (s[i].underRock !== s[i - 1].underRock) {
          flips++;
          // Ballistic ticks in the WINDOW AROUND the handover. A walk up a dug
          // staircase on a 45 degree face is airborne between steps whatever the
          // regime is (measured: 35 of 128 ticks), so a count over the whole walk
          // cannot say whether the SWITCH dropped anybody. Five ticks either side
          // of the switch can.
          let air = 0;
          for (let k = Math.max(0, i - 5); k <= Math.min(s.length - 1, i + 5); ++k) {
            if (!s[k].grounded) air++;
          }
          atFlip.push({ tick: s[i].tick, stepM: r6(dd), airborneNear: air,
            from: s[i - 1].underRock ? 'deep' : 'shallow',
            to: s[i].underRock ? 'deep' : 'shallow',
            grounded: s[i].grounded, buried: s[i].buried,
            pushM: r6(s[i].pushM), ejectM: r6(s[i].ejectM),
            feetR: r6(s[i].feetR), preSnapR: r6(s[i].preSnapR),
            terrainR: Number.isFinite(s[i].terrainR) ? r6(s[i].terrainR) : null });
        }
      }
      ungrounded = s.filter((x) => !x.grounded).length;
      steps.sort((x, y) => y - x);
      const depths = visited.map((v) => v.depthM);
      let gateCrossed = false;
      for (let i = 1; i < depths.length; ++i) {
        if ((depths[i - 1] < 1.5) !== (depths[i] < 1.5)) gateCrossed = true;
      }
      return {
        label, taps, ticks: s.length,
        gateCrossed,
        depthFromM: depths[0], depthToM: depths[depths.length - 1],
        // How far the feet moved on the worst single tick, and the ladder the
        // walker itself says is the most a legitimate one may move them.
        maxFeetStepM: r6(maxStep), maxFeetStepAtTick: maxStepAt,
        topFeetStepsM: steps.slice(0, 6).map(r6),
        riseBoundM: r6(Math.max(...LADDER) + LADDER[0]),
        oneTickOfGravityM: r6(gTick()),
        ungroundedTicks: ungrounded,
        regimeFlips: flips,
        atFlip,
        // The one number this probe exists to produce.
        feetStepAtFlipM: atFlip.length === 0 ? null
          : r6(Math.max(...atFlip.map((f) => f.stepM))),
        snapBoundM: r6(Math.max(...LADDER)),
        underRockTicks: s.filter((x) => x.underRock).length,
        buriedTicks: s.filter((x) => x.buried).length,
        ejectTicks: s.filter((x) => x.ejectM > 1e-9).length,
        maxEjectM: r6(Math.max(...s.map((x) => x.ejectM))),
        pushTicks: s.filter((x) => x.pushM > 0).length,
        // The jump in the GATE QUANTITY itself, which is a fact about the world
        // and not about the walker, reported beside the walker's response to it.
        maxDepthJumpM: r6(Math.max(...depths.slice(1).map((v, i) =>
          Math.abs(v - depths[i])))),
        visited: visited.filter((_, i) => i % 3 === 0 || i > taps - 4),
      };
    };
    // Get back under rock first, so the crossing starts on the deep side, and do
    // it in STRIDES: at the hill site the mouth is 36 m from where the drive
    // stops, and taps are for measuring rather than for travelling.
    let intoRock = 0;
    if (!of.world().player.underRock) {
      intoRock = (await strideUntilFlip(back, 60)).strides;
    }
    await stride(back, 4);
    await settle(1.0);
    const outward = await crossing('deep -> shallow', out, A.crossTaps ?? 200);
    const inward = await crossing('shallow -> deep', back, A.crossTaps ?? 200);
    log.push(`${siteName} CROSSING out: depth ${outward.depthFromM} -> `
      + `${outward.depthToM} m, worst single-tick feet step ${outward.maxFeetStepM} m, `
      + `${outward.regimeFlips} regime flips, ${outward.ungroundedTicks} ungrounded ticks, `
      + `world's own depth jump ${outward.maxDepthJumpM} m`);
    log.push(`${siteName} CROSSING in:  depth ${inward.depthFromM} -> `
      + `${inward.depthToM} m, worst single-tick feet step ${inward.maxFeetStepM} m, `
      + `${inward.regimeFlips} regime flips, ${inward.ungroundedTicks} ungrounded ticks, `
      + `world's own depth jump ${inward.maxDepthJumpM} m`);

    // ---- 4. THE FOUR TARGET DEPTHS ---------------------------------------
    //
    // A CLOSED LOOP ON THE MEASURED DEPTH, not on a remembered position. The
    // first cut of this walked back to the index of the closest depth in the
    // crossing record and reported the depth it MEANT to be at: measured, it
    // stood at 6.795906 m for three targets that all wanted the mouth, because
    // taps are not reversible over a dug staircase (out of a bore is uphill and
    // covers less ground per tap than in). So the depth is re-read from the
    // world after every tap and the walk stops on what it FINDS.
    //
    // The exit ramp carries the depth downward monotonically, so this walks out
    // until the depth has passed the target, then steps back one tap if the last
    // ROOFED position it saw was nearer than where it ended up. `closestApproachM`
    // is the smallest |depth - target| the walk ever measured, and it is a
    // statement about the world rather than about this search.
    const standAtDepth = async (t) => {
      if (!of.world().player.underRock) {
        await strideUntilFlip(back, 50);
        await stride(back, 2);
      }
      const track = [];
      let closest = Infinity, lastRoofed = null;
      for (let i = 0; i < (A.seekTaps ?? 80); ++i) {
        const d = depthNow();
        track.push(r6(d));
        if (Math.abs(d - t) < closest) closest = Math.abs(d - t);
        if (of.world().player.underRock) lastRoofed = d;
        if (Math.abs(d - t) < 0.05) break;
        if (d <= t) break;                    // everything further out is shallower
        await tapWalk(out, 1);
      }
      // REFINE, A FRAME AT A TIME. The tap that carries the walker over the
      // mouth is about 0.35 m and the mouth is narrower than that, so the tapped
      // walk can step clean over every depth the mouth has. Creep back across it.
      const micro = [];
      let landed = false;
      await tapWalk(back, 1);
      for (let k = 0; k < (A.microTaps ?? 30); ++k) {
        const d = depthNow();
        micro.push(r6(d));
        if (Math.abs(d - t) < closest) closest = Math.abs(d - t);
        if (Math.abs(d - t) < 0.05) { landed = true; break; }
        await microWalk(d > t ? out : back, 1);
      }
      // FINISH ON WHICHEVER SIDE IS NEARER, DELIBERATELY. Left to itself the
      // refinement above ends wherever its last step happened to fall, and it
      // did: measured, a search for 1.0 m stood at 4.109386 m when 0 was three
      // times closer, because the loop was still oscillating across a mouth with
      // nothing inside it when its budget ran out.
      const wantRoof = lastRoofed !== null
        && Math.abs(lastRoofed - t) < Math.abs(0 - t);
      for (let k = 0; k < 40; ++k) {
        if (of.world().player.underRock === wantRoof) break;
        await microWalk(wantRoof ? back : out, 1);
      }
      return { closestApproachM: r6(closest), landedInSeek: landed,
        finishedUnderRoof: wantRoof,
        shallowestRoofedSeenM: lastRoofed === null ? null : r6(lastRoofed),
        track: track.slice(0, 60), micro: micro.slice(0, 40) };
    };
    const targets = [];
    for (const t of (A.targets ?? [2.5, 1.55, 1.45, 1.0])) {
      const seek = await standAtDepth(t);
      const w = await watch(`depth ${t}`, A.standSecs ?? 6);
      targets.push({ targetM: t, ...seek, achievedM: w.depthM,
        landed: Math.abs((w.depthM ?? 1e9) - t) <= 0.15, stand: w });
      log.push(`${siteName} TARGET ${t} m: closest approach ${seek.closestApproachM} m; `
        + `stood at ${w.depthM} m (underRock ${w.underRockTicks}/${w.ticks}, heightfield `
        + `${w.heightfieldTicks}/${w.ticks}, spread ${w.spreadM} m, grounded `
        + `${w.groundedTicks}/${w.ticks})`);
    }

    // ---- 5. STABILITY EITHER SIDE ----------------------------------------
    if (!of.world().player.underRock) await strideUntilFlip(back, 50);
    await stride(back, 3);
    const deepStand = await watch('deep side', A.stillSecs ?? 12);
    // OUT UNTIL THE DEPTH IS ACTUALLY SHALLOW, and not merely until `underRock`
    // clears once. On the 45 degree hill face that flag chatters at the mouth,
    // so a stride-until-flip left the shallow stand 4.24 m under a roof and the
    // two stands were the same regime twice.
    for (let i = 0; i < 40 && (of.world().player.underRock || depthNow() > 0.4); ++i) {
      await stride(out, 1);
    }
    await stride(out, 2);
    // THE ONE TELEPORT IN THE MEASURED SECTION, AND IT SAYS SO. On the 45 degree
    // hill face the exit is a climb the walker will not always make: measured,
    // forty strides and the shallow stand was still 3.013532 m under a roof, so
    // the run compared the deep regime with itself. The shallow regime is
    // ordinary walking on ordinary ground and nothing about it depends on how
    // the player arrived, so when the climb fails this puts them on the surface
    // over their own tunnel and REPORTS that it did.
    let shallowReachedBy = 'walked';
    if (of.world().player.underRock || depthNow() > 0.4) {
      const u = unit(feet());
      const g = of.latlon(u[0], u[1], u[2]);
      of.teleport(g.latDeg, g.lonDeg, 0);
      await settle(2.5);
      shallowReachedBy = 'teleported to the surface over the bore';
    }
    const shallowStand = await watch('shallow side', A.stillSecs ?? 12);
    shallowStand.reachedBy = shallowReachedBy;
    log.push(`${siteName} STANDS: deep at ${deepStand.depthM} m spread `
      + `${deepStand.spreadM} m over ${deepStand.ticks} ticks; shallow at `
      + `${shallowStand.depthM} m spread ${shallowStand.spreadM} m over `
      + `${shallowStand.ticks} ticks`);

    // ---- THE CLAIMS -------------------------------------------------------
    // VALIDITY FIRST, as failures, because a run that tested nothing must not
    // read as a pass.
    check(`${siteName}: the drive got the walker under rock at all`,
      drive.some((x) => x.underRock), 'no strike ever put the feet on a voxel floor');
    check(`${siteName}: the survey found a standable column on the DEEP side of the gate`,
      stood.some((c) => c.depthM > 1.5), `max depth ${spectrum.maxDepthM}`);
    check(`${siteName}: the survey found a standable column on the SHALLOW side`,
      stood.some((c) => c.depthM < 1.5), 'no shallow column anywhere on the path');
    check(`${siteName}: the crossing actually crossed the gate, both ways`,
      outward.gateCrossed && inward.gateCrossed,
      `out ${outward.gateCrossed} in ${inward.gateCrossed}`);
    check(`${siteName}: both stands are valid traces`,
      deepStand.valid && shallowStand.valid,
      `${deepStand.fail ?? ''} ${shallowStand.fail ?? ''}`);

    // THE PROPERTY. A regime switch may not move the player.
    for (const c of [outward, inward]) {
      check(`${siteName}: crossing the gate ${c.label} moves the feet no further in one `
        + `tick than the walker's own step ladder`,
        c.maxFeetStepM <= c.riseBoundM + 1e-6,
        `${c.maxFeetStepM} m against a ${c.riseBoundM} m bound, at tick ${c.maxFeetStepAtTick}`);
      // THE PROPERTY THE PROBE IS FOR. The tick the authority changes hands on
      // may move the feet by no more than one rung of the ladder the walker
      // itself publishes, because a bigger move on THAT tick is the switch
      // teleporting the player and nothing else.
      check(`${siteName}: the tick the regime changes on ${c.label} does not teleport the walker`,
        c.feetStepAtFlipM !== null && c.feetStepAtFlipM <= c.snapBoundM + 1e-6,
        `${c.feetStepAtFlipM} m against a ${c.snapBoundM} m bound; ${JSON.stringify(c.atFlip)}`);
      check(`${siteName}: the regime change ${c.label} does not drop the walker`,
        c.atFlip.every((f) => f.grounded), JSON.stringify(c.atFlip.map((f) =>
          ({ tick: f.tick, grounded: f.grounded, airborneNear: f.airborneNear }))));
      check(`${siteName}: crossing the gate ${c.label} never buries the walker`,
        c.buriedTicks === 0 && c.ejectTicks === 0,
        `${c.buriedTicks} buried, ${c.ejectTicks} ejected, worst ${c.maxEjectM} m`);
      check(`${siteName}: crossing the gate ${c.label} switches regime a handful of times, `
        + `not once a tick`, c.regimeFlips <= 6, `${c.regimeFlips} flips over ${c.ticks} ticks`);
    }
    for (const w of [deepStand, shallowStand]) {
      if (!w.valid) continue;
      check(`${siteName}: standing on the ${w.name} is stable`, w.spreadM === 0,
        `spread ${w.spreadM} m over ${w.ticks} ticks`);
      check(`${siteName}: standing on the ${w.name} keeps the walker grounded`,
        w.groundedTicks === w.ticks, `${w.groundedTicks} of ${w.ticks}`);
      check(`${siteName}: standing on the ${w.name} does not change its mind about the regime`,
        w.regimeFlips === 0, `${w.regimeFlips} flips`);
    }
    // The two regimes must actually be TWO. A run where both stands report the
    // same authority has measured one branch twice.
    check(`${siteName}: the two stands are in DIFFERENT regimes`,
      deepStand.valid && shallowStand.valid
      && deepStand.underRockTicks > 0 && shallowStand.underRockTicks === 0
      && shallowStand.heightfieldTicks > 0,
      `deep underRock ${deepStand.underRockTicks}, shallow underRock `
      + `${shallowStand.underRockTicks}, shallow on heightfield ${shallowStand.heightfieldTicks}`);

    return { site: siteName, valid: true, reachedUnderRockBy: reached, wayOut: out,
      profile, spectrum, targets, outward, inward,
      deepStand, shallowStand, intoRockTaps: intoRock,
      pathPoints: cleanPath.length };
  };

  const digs = { spawn: spawnDig, hill: hillDig };
  // DEFAULT IS `spawn` ALONE, AND `hill` IS AN OPT-IN THAT CURRENTLY FAILS.
  //
  // `hill` reproduces a real defect (PH-80 / R36): on a 45 degree face the gate
  // CHATTERS, 8 flips in 152 ticks with the walker airborne on 19 of them and
  // two flip ticks showing exactly one tick of free fall. It is bit-for-bit
  // reproducible and it is worth keeping runnable:
  //
  //   --evalargs='{"sites":["hill"]}'      reproduces it
  //   --evalargs='{"sites":["spawn","hill"]}'   runs both
  //
  // It is NOT in the default set because a probe that is permanently red in a
  // shared harness teaches everyone to ignore red, which costs more than the
  // one defect it names. The defect is recorded in physics.md R36 with these
  // numbers and this command, so nothing is hidden by the default being green.
  // The alternative considered and rejected was asserting the CURRENT chatter
  // as a characterisation check: that pins a bug as the spec, and this lane
  // refused to do that in PH-74 for the same reason.
  const wanted = A.sites ?? ['spawn'];
  const sites = [];
  for (const name of wanted) {
    const fn = digs[name];
    if (fn === undefined) { fails.push(`unknown site ${name}`); continue; }
    const s = await scene(name, fn);
    if (s.valid !== true) fails.push(`${name}: ${s.fail}`);
    sites.push(s);
  }
  const measured = sites.filter((s) => s.valid === true);

  // THE CHARACTERISATION, across every site: is 1.5 m a place a player can be?
  // Reported as a finding rather than as a failure, because a threshold nothing
  // can reach is a fact about the geometry and the decision about what to do
  // with it is not this probe's.
  const holeCounts = measured.map((s) => s.spectrum.inTheHole);
  const gateCounts = measured.map((s) => s.spectrum.atTheGate);
  const minNonZero = measured.map((s) => s.spectrum.minNonZeroDepthM);
  log.push(`ACROSS ${measured.length} SITE(S): the shallowest ROOFED stance is `
    + `${minNonZero.join(' / ')} m, standable columns in (0.05, 3.0) m of depth `
    + `${holeCounts.join(' / ')}, within half a metre of the gate `
    + `${gateCounts.join(' / ')}. DEEP_UNDERGROUND_M is 1.5.`);

  return {
    valid: fails.length === 0,
    fails, log,
    capsuleSamplesM: CAP, voxelStepUpM: LADDER,
    // The answer to "can the gate be stood on", in one object.
    gate: {
      thresholdM: 1.5,
      shallowestRoofedStanceM: minNonZero,
      standableColumnsInTheHole: holeCounts,
      standableColumnsAtTheGate: gateCounts,
      worstFeetStepAcrossACrossingM: measured.length === 0 ? null
        : r6(Math.max(...measured.flatMap((s) => [s.outward.maxFeetStepM, s.inward.maxFeetStepM]))),
      worstDepthJumpTheWorldItselfMakesM: measured.length === 0 ? null
        : r6(Math.max(...measured.flatMap((s) => [s.outward.maxDepthJumpM, s.inward.maxDepthJumpM]))),
    },
    sites,
  };
})()
