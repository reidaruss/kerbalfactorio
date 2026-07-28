// "STANDING STILL IN THE TUNNEL IM GETTING THE SAME SINKING THING WHERE IT
// SNAPS UP EVERY FEW SECONDS." -- Reid, verbatim, and "the same" is the word
// that matters: it is GP-53's symptom in a second code path.
//
// GP-53 was `StructureBodies.deckUnder`, a 0.05 m march down from the feet
// clamped with `Math.min(rFrom, r + 0.05)`, so with the feet inside the slab it
// returned THE FEET. The general form logged there is the thing to look for
// here: a floor query that clamps its answer to the querier's own position
// ratifies the querier's error instead of correcting it, and gravity supplies a
// fresh error every tick.
//
// The tunnel floor is voxel, not structural, so the suspect is a different
// function -- `VoxelCollision.floorBelow`, whose last line was
// `Math.min(r, rr + 0.1)`. The point of this probe is NOT to assume that. It is
// to measure the contributing sources SEPARATELY, per tick, and let the numbers
// name the ratifier and the corrector.
//
// WHY PER TICK AND WHY SEPARATELY. A per-FRAME average hides a 0.2 m sawtooth
// completely -- a frame carries one to three fixed ticks and `world().player`
// samples once per frame -- and that is how GP-53's twin survived the first
// time. And `groundR` alone cannot tell a ratified floor from a correct one,
// because both are "the ground the snap used". It takes `preSnapR` beside it:
//
//   terrainR - preSnapR ~ 0   =>  the floor IS the feet. Ratification.
//   pushM > 0 on the rise     =>  resolveEmbedded is what puts them back.
//
// THE REFERENCE FLOOR IS THE WALKER'S OWN PREDICATE, bisected on `of.solidAt`,
// which is the sign of the same signed field `floorBelow` marches (WG-24). A
// reference recomputed some other way would agree with itself whatever the
// walker did, which is standing rule 11's whole complaint (decksink.js has the
// same paragraph about `module.deckH`).
//
// =========================== THREE SITES (R8) ============================
//
// EVERY GEOMETRIC PROBE IN THIS REPO ONLY EVER RAN ON THE FLAT SPAWN CLEARING,
// AND THAT IS A CLASS OF BLIND SPOT, NOT AN ACCIDENT OF THIS FILE. The belt
// lane hit it independently on the same day: a 10.1 degree corner misalignment
// measured EXACTLY ZERO on flat ground across 39 driven keypresses and only
// appeared on a 14.82 degree hillside (`beltslope.js`).
//
// The first version of this probe dug its own shaft at the player's spawn: a
// vertical shaft (`of.look(yaw, -85)`) and then a horizontal bore (pitch -12).
// The spawn is a flat clearing, so the heightfield over that tunnel is a couple
// of metres up, which means the DEEP/shallow gate in `KinematicBody.step`
// (`qr < surfaceR - DEEP_UNDERGROUND_M`, 1.5 m) is satisfied by a hair. Reid
// dug through a MOUNTAIN, where it is satisfied by twenty metres. Those are not
// the same test of the same code even though they run the same lines.
//
// The second cut added a mountainside found by sweeping `of.surface` for the
// steepest ground within reach. It raised the overhead from 7.2 m to 14.7 m and
// then stopped there, and the reason it stopped is worth writing down because it
// is NOT the reason it looks like: the sweep only spanned 0.30 degrees, about
// +/- 3 km, so it was called narrow. Measured, widening it to +/- 5 degrees
// (550 km) buys almost nothing, because this terrain is fractal and the steepest
// 40 m slope inside 3 km is about as steep as the steepest inside 550 km
// (29.7 m of rise against 37.4 m). Two of the three surveyed coordinates in
// world-gen.md section 6.1 are worse than the spawn, at 0.66 m and 0.74 m of
// rise over 40 m: they are named Hills and they are hills.
//
// WHAT ACTUALLY PUTS ROCK OVER YOUR HEAD IS BORE LENGTH, not sweep radius. A
// level bore into a hillside is under exactly as much rock as the hill has
// climbed over the distance bored, so the site score here is the rise sustained
// over the WHOLE bore (its minimum at four points along the path, so a slope
// that flattens out loses to one that keeps climbing) and the bore is then
// driven until the overhead PEAKS and starts to fall, which is the walker
// arriving under the ridge line. Measured: 65 strikes, 102 m in, 33.1 m of rock.
//
// So the scene runs THREE times, and the site checks are assertions in their own
// right: each site must put strictly more rock over the player's head than the
// last, or the extra run is a duplicate that proves nothing and this probe says
// so instead of going green three times for the price of one.
//
//   node tools/smoke/run.mjs --scenario=walk \
//        --evalfile=tools/smoke/probes/tunnelsink.js
//   node tools/smoke/run.mjs --scenario=walk \
//        --evalfile=tools/smoke/probes/tunnelsink.js \
//        --evalargs='{"oldFloor":true}'      # the negative control, must FAIL
//
// THE STRESS ARGUMENTS are the axes the fixed scene holds still, and they exist
// because "it does not reproduce" is only worth anything once the thing that
// did not reproduce was driven hard. Each one applies to every site:
//
//   {"stillSecs":120}       stand still for two minutes instead of twenty
//   {"preWalkLaps":6}       walk the bore end to end six times, then stand
//   {"reloadFirst":true}    save, put the rock back, load, then stand
//   {"standOverheadM":2.0}  retreat until the roof is 2 m up and stand THERE,
//                           which is the DEEP/shallow gate at 1.5 m rather than
//                           the deep interior, and is the only place in a tunnel
//                           where the walker changes which authority holds it up
(async () => {
  const of = window.__of;
  const A = OF_ARGS ?? {};
  const log = [];
  const DEG = 180 / Math.PI;
  const r6 = (x) => (Number.isFinite(x) ? Number(x.toFixed(6)) : null);
  const r3 = (x) => (Number.isFinite(x) ? Number(x.toFixed(3)) : null);
  const fail = (why, extra) => ({ valid: false, fail: why, ...extra, log });

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

  // Standing rule 11: an assertion that has never been seen to FAIL is not yet
  // an assertion, so this probe is required to run against the OLD floor query
  // and fail by name before its numbers on the new one mean anything.
  if (A.oldFloor) globalThis.__ofOldFloor = true;

  await settle(1.5);
  if (of.voxels() === null) return fail('no character, nothing can dig');
  if (typeof of.stand !== 'function') return fail('no __of.stand: rebuild');
  if (typeof of.solidAt !== 'function') return fail('no __of.solidAt: rebuild');
  const bodyR = of.world().bodyRadiusM;

  /**
   * THE FLOOR THE WORLD ACTUALLY HAS along a point's radial: the highest
   * air-to-rock crossing at or below `riseM` over it, bisected to 1e-8 m on
   * `of.solidAt`.
   *
   * `riseM` looks upward on purpose. A floor a few centimetres ABOVE the feet
   * is still the floor those feet are standing on -- that is precisely the case
   * GP-53's second half was about -- and a downward-only reference would score
   * a buried player as correctly seated.
   *
   * Returns null when the radial finds no rock at all within `dropM`, which is
   * what an open shaft looks like and is the negative control below.
   */
  const floorAlong = (p, riseM = 0.55, dropM = 6.0) => {
    const r = Math.hypot(p[0], p[1], p[2]);
    const u = [p[0] / r, p[1] / r, p[2] / r];
    const at = (rr) => of.solidAt(u[0] * rr, u[1] * rr, u[2] * rr);
    let air = null;
    for (let d = riseM; d >= -1e-9; d -= 0.01) { if (!at(r + d)) { air = r + d; break; } }
    if (air === null) return null;                // buried deeper than a step
    let solid = null;
    for (let rr = air; rr >= r - dropM; rr -= 0.01) { if (at(rr)) { solid = rr; break; } }
    if (solid === null) return null;              // open shaft: nothing holds us
    let a = solid, b = solid + 0.01;              // a is rock, b is air
    for (let i = 0; i < 40; ++i) { const m = (a + b) / 2; if (at(m)) a = m; else b = m; }
    return b;
  };

  /**
   * THE MOUNTAINSIDE, MEASURED RATHER THAN NAMED. Which way a hillside faces is
   * a property of the seed, so the site is found by sweeping `of.surface` over
   * a grid of lat/lon offsets and scoring each by how much HIGHER the ground is
   * `intoM` metres away on its best of eight bearings. That score is exactly
   * the quantity the second site exists to raise: rock over the player's head
   * once the bore is in. `beltslope.js` finds its slope the same way and for
   * the same reason.
   */
  const findMountain = (intoM) => {
    const u0 = unit(feet());
    const lat0 = Math.asin(u0[1]) * DEG;
    const lon0 = Math.atan2(u0[2], u0[0]) * DEG;
    let best = null;
    const span = A.spanDeg ?? 0.30, step = A.stepDeg ?? 0.02;
    for (let a = -span; a <= span + 1e-9; a += step) {
      for (let b = -span; b <= span + 1e-9; b += step) {
        const la = ((lat0 + a) * Math.PI) / 180, lo = ((lon0 + b) * Math.PI) / 180;
        const u = [Math.cos(la) * Math.cos(lo), Math.sin(la), Math.cos(la) * Math.sin(lo)];
        const h0 = hAt(u);
        if (h0 < 0) continue;
        const north = unit(add([0, 1, 0], u, -dot([0, 1, 0], u)));
        const east = cross(north, u);
        const ang = intoM / bodyR;
        let rise = -Infinity;
        for (let i = 0; i < 8; ++i) {
          const th = (Math.PI * i) / 4;
          const w = add(add([0, 0, 0], north, Math.cos(th)), east, Math.sin(th));
          const d = unit(add(add([0, 0, 0], u, Math.cos(ang)), w, Math.sin(ang)));
          const h = hAt(d) - h0;
          if (h > rise) rise = h;
        }
        if (best === null || rise > best.riseM) best = { lat: lat0 + a, lon: lon0 + b, riseM: rise };
      }
    }
    return best;
  };

  const dirOf = (latDeg, lonDeg) => {
    const la = (latDeg * Math.PI) / 180, lo = (lonDeg * Math.PI) / 180;
    return [Math.cos(la) * Math.cos(lo), Math.sin(la), Math.cos(la) * Math.sin(lo)];
  };

  /**
   * THE DEEP SITE: a hillside whose climb is SUSTAINED over a long bore.
   *
   * `findMountain` scores the rise at ONE distance, which finds the steepest
   * ground and not the deepest. A 43 degree face that levels off after 20 m
   * beats a 30 degree face that keeps climbing for 100 m on that score and
   * loses badly on the only quantity that matters here, so this scores the
   * MINIMUM rise at four points along the bore path: a site that flattens out
   * is scored by the flat part.
   *
   * The sweep is wide (+/- 5 degrees, about 550 km) and then refined around its
   * best three, because a 0.25 degree coarse step is 2.7 km and steps clean over
   * every ridge in between. Both stages are cheap: 1681 coarse points and three
   * 31x31 refinements measured 500 ms total, against 20 s of standing still.
   */
  const findDeepSite = (reachM) => {
    const u0 = unit(feet());
    const lat0 = Math.asin(u0[1]) * DEG;
    const lon0 = Math.atan2(u0[2], u0[0]) * DEG;
    const score = (latDeg, lonDeg, bearings) => {
      const u = dirOf(latDeg, lonDeg);
      const h0 = hAt(u);
      if (h0 < 0) return null;                       // sea, nothing to bore into
      const north = unit(add([0, 1, 0], u, -dot([0, 1, 0], u)));
      const east = cross(north, u);
      let best = null;
      for (let i = 0; i < bearings; ++i) {
        const th = (2 * Math.PI * i) / bearings;
        const w = add(add([0, 0, 0], north, Math.cos(th)), east, Math.sin(th));
        let rise = Infinity;
        for (const d of [reachM * 0.25, reachM * 0.5, reachM * 0.75, reachM]) {
          const ang = d / bodyR;
          const q = unit(add(add([0, 0, 0], u, Math.cos(ang)), w, Math.sin(ang)));
          const h = hAt(q) - h0;
          if (h < rise) rise = h;
        }
        if (best === null || rise > best.riseM) best = { riseM: rise };
      }
      return { lat: latDeg, lon: lonDeg, riseM: best.riseM };
    };
    const coarse = [];
    const span = A.deepSpanDeg ?? 5, step = A.deepStepDeg ?? 0.25;
    for (let a = -span; a <= span + 1e-9; a += step) {
      for (let b = -span; b <= span + 1e-9; b += step) {
        const s = score(lat0 + a, lon0 + b, 8);
        if (s !== null) coarse.push(s);
      }
    }
    if (coarse.length === 0) return null;
    coarse.sort((x, y) => y.riseM - x.riseM);
    const fine = [];
    for (const c of coarse.slice(0, 3)) {
      for (let a = -0.30; a <= 0.30 + 1e-9; a += 0.02) {
        for (let b = -0.30; b <= 0.30 + 1e-9; b += 0.02) {
          const s = score(c.lat + a, c.lon + b, 16);
          if (s !== null) fine.push(s);
        }
      }
    }
    fine.sort((x, y) => y.riseM - x.riseM);
    return { ...fine[0], sweptPoints: coarse.length + fine.length,
      coarseBestM: r3(coarse[0].riseM) };
  };

  /** Which yaw points INTO the hill, read off the engine's own aim ray. */
  const faceUphill = async (intoM) => {
    let best = null;
    for (let y = 0; y < 360; y += 15) {
      of.look(y, 0);
      await of.run(0.05, 60);
      const ray = of.aim();
      if (ray === null) continue;
      const u = unit(ray.origin);
      const f = unit(add(ray.dir, u, -dot(ray.dir, u)));
      const rise = hAt(unit(add(ray.origin, f, intoM))) - hAt(u);
      if (best === null || rise > best.riseM) best = { yaw: y, riseM: rise };
    }
    return best;
  };

  /** Metres of heightfield standing over the feet. The whole point of site 2. */
  const overheadNow = () => {
    const p = feet();
    const u = unit(p);
    return bodyR + of.surface(u[0], u[1], u[2]).surfaceM - Math.hypot(...p);
  };

  // ======================= THE SCENE, RUN PER SITE ========================
  const scene = async (siteName, dig) => {
    const drive = await dig();
    await settle(2.5);

    // GETTING UNDER ROCK IS A SEARCH, NOT AN ASSUMPTION. The drive's end state
    // depends on the walker, and the walker is the thing under test, so a probe
    // that measures only where the drive happened to stop is measuring a moving
    // target: the first cut of this one reported "never got under rock" for the
    // fixed build and clean numbers for the broken one, purely because the two
    // traverse the bore differently. So walk the bore until the feet ARE on a
    // voxel floor, both ways, and say how it was reached.
    //
    // THE RETREAT AND RETURN IS tunnelwalk.js's, deliberately. That probe is the
    // standing guard for "a tunnel you can travel", it is green, and copying the
    // motion it uses means a failure here is about the FLOOR and not about a
    // walking pattern this probe invented.
    let reached = of.world().player.underRock ? 'drive' : null;
    for (const act of ['KeyS', 'KeyW']) {
      if (reached !== null) break;
      for (let i = 0; i < 14 && reached === null; ++i) {
        await hold(0.35, [act]);
        await of.run(0.15, 60);
        if (of.world().player.underRock) reached = act;
      }
      // Two more slices past the mouth, so the measurement is taken under
      // intact rock rather than in the doorway where the heightfield still has
      // a say.
      if (reached !== null) {
        for (let i = 0; i < 2; ++i) { await hold(0.35, [act]); await of.run(0.15, 60); }
      }
    }
    await settle(2.5);
    const w0 = of.world().player;
    if (!w0.underRock) {
      // Not a pass-by-luck: if the feet are not on a VOXEL floor then nothing
      // below is about the code path this probe exists to measure, and saying
      // so is better than reporting clean numbers from the heightfield.
      return { site: siteName, valid: false,
        fail: 'never got under rock; nothing here measures floorBelow',
        player: w0, feet: feet(), drive };
    }

    // --- THE STRESS AXES. Off by default; see the header. -------------------
    // Every one of these is a thing the fixed scene holds still, and holding a
    // thing still is a claim about it. They run BEFORE the trace so that what is
    // measured is a player standing on a floor that has been through them, not
    // the transient of the thing itself.
    const stress = { preWalkLaps: 0, reloaded: null, retreatedTo: null };
    if (A.preWalkLaps) {
      // Walk the bore end to end. The floor a dug tunnel has is a staircase of
      // whole cells and traversing it is what re-seats the walker on each of
      // them, so a defect that needs a particular cell to be the one you stop on
      // is reachable this way and is not reachable by standing where the drive
      // happened to stop.
      for (let lap = 0; lap < A.preWalkLaps; ++lap) {
        for (const act of ['KeyS', 'KeyW']) {
          for (let i = 0; i < 10; ++i) { await hold(0.35, [act]); await of.run(0.1, 60); }
        }
        stress.preWalkLaps++;
      }
      await settle(2.0);
    }
    if (A.reloadFirst) {
      // The tunnel through a save. `tunnelpersist.js` proves the ROCK survives;
      // this asks the different question of whether the FLOOR the walker gets
      // afterwards is the same floor, with the player standing on it throughout.
      //
      // THERE IS NO `forgetTunnels` HERE AND THAT IS THE WHOLE POINT. The first
      // cut of this hook did save -> forget -> load, copying `tunnelpersist.js`,
      // and it measured something else entirely: forgetting the tunnel puts the
      // rock back AROUND A PLAYER WHO IS STANDING IN IT, the walker correctly
      // reads that as buried, and PH-60 rule 2 ejects them up the radial to the
      // hillside. Measured at all three sites, `underRockAfter` false and the
      // roof 0 m. That is the eject working, not a reload, and a hook that
      // ejects the player before the measurement is measuring the eject.
      // `tunnelpersist.js` gets away with the forget because it asserts about
      // ROCK and never about the player, and its own header says a page that
      // reloaded is never in the intermediate state for a frame.
      const written = await of.save();
      const ledger = await of.load();
      await settle(3.0);
      stress.reloaded = { voxelBytes: written?.voxelBytes ?? null,
        restored: ledger?.voxels ?? null,
        underRockAfter: of.world().player.underRock,
        overheadAfterM: r3(overheadNow()) };
      log.push(`${siteName} RELOAD: saved ${stress.reloaded.voxelBytes} B, restored `
        + `${JSON.stringify(stress.reloaded.restored)}, roof now `
        + `${stress.reloaded.overheadAfterM} m and underRock `
        + `${stress.reloaded.underRockAfter}`);
    }
    if (A.standOverheadM !== undefined) {
      // BACK OFF TO A CHOSEN ROOF DEPTH. `KinematicBody.step` changes which
      // authority holds the player up at `DEEP_UNDERGROUND_M` (1.5 m of
      // heightfield overhead): above it the floor is `surfaceRadius`, below it
      // the floor is the voxel field, and a tunnel is the only place a player
      // can stand near that line for any length of time. Standing 30 m under a
      // ridge never runs the shallow branch at all.
      // WALKING BACKWARDS TO A ROOF DEPTH DOES NOT WORK, and the first cut of
      // this hook is kept in the comment because the number that exposed it is
      // the useful part. It held KeyS in 0.30 s steps and recorded the closest
      // it ever came to the asked-for depth. Measured, that closest approach was
      // EXACTLY the asked-for depth at the two shallow sites (2.000000 against a
      // 2 m target, 1.700000 against a 1.7 m target), which is the signature of
      // going from the full roof to zero in ONE step: their bores are about 12 m
      // long, so a single 1.4 m stride leaves by the mouth. At the deep site the
      // same 40 steps moved the roof by 0.4 m in total. So the hook landed at
      // either 0 m or 28.6 m and never once at the gate it exists to sit on.
      //
      // The bore is therefore stopped AT the depth instead, by `deepDig` below,
      // which is deterministic and needs no walking. This retreat now only
      // trims, in short steps, and it REPORTS the closest approach so a run that
      // failed to land says so instead of quietly measuring somewhere else.
      let bestGap = Math.abs(overheadNow() - A.standOverheadM);
      const track = [r3(overheadNow())];
      for (let i = 0; i < 60; ++i) {
        if (overheadNow() <= A.standOverheadM) break;
        await hold(0.10, ['KeyS']);
        await of.run(0.05, 60);
        const over = overheadNow();
        track.push(r3(over));
        const gap = Math.abs(over - A.standOverheadM);
        if (gap < bestGap) bestGap = gap;
      }
      await settle(2.0);
      stress.retreatedTo = { overheadM: r3(overheadNow()),
        underRock: of.world().player.underRock, closestApproachM: r6(bestGap),
        // A landing is only a landing if it got near what was asked for.
        landed: bestGap <= 0.75, track: track.slice(0, 40) };
      log.push(`${siteName} RETREAT: asked for a ${A.standOverheadM} m roof, `
        + `stood under ${stress.retreatedTo.overheadM} m (closest approach `
        + `${r3(bestGap)} m, landed ${stress.retreatedTo.landed}), underRock `
        + `${stress.retreatedTo.underRock}`);
    }

    // THE STRESS HAS TO LEAVE THE PLAYER SOMEWHERE THE MEASUREMENT MEANS
    // SOMETHING, and saying so is a separate check from doing it. Without this
    // the shallow sites report their failures against the FLOOR assertions:
    // measured, six laps of walking leave the spawn bore (16 strikes, about 12 m)
    // out of the far end, and the still phase then runs on open hillside and
    // fails `the terrain floor query answers the WORLD floor` with `[null]`,
    // because there were no under-rock ticks to take a floor error over. That
    // reads as a defect in the query and is nothing of the kind. Same shape as
    // the `never got under rock` guard above and for the same reason.
    // The bound is OPEN SKY rather than `underRock`, because `standOverheadM`
    // aims at the shallow branch on purpose and a player under a thin roof is a
    // legitimate thing to measure. A player under NO roof is not.
    if (!of.world().player.underRock && overheadNow() < 0.25) {
      return { site: siteName, valid: false,
        fail: 'the stress moved the player out from under rock; nothing here '
          + 'measures floorBelow',
        stress, player: of.world().player, overheadM: r3(overheadNow()), drive };
    }

    // --- P1/P2: STAND ABSOLUTELY STILL AND WATCH, PER TICK ------------------
    const standFeet = feet();
    const overheadRockM = overheadNow();
    const trueFloor = floorAlong(standFeet);
    if (trueFloor === null) {
      return { site: siteName, valid: false, fail: 'no reference floor under the feet',
        standFeet, overheadRockM: r3(overheadRockM) };
    }
    // LONG. The corrector's period is the thing being measured and it is not
    // known in advance: the sink has to bury the capsule's lowest sample, 0.15 m
    // above the feet, before `resolveEmbedded` has anything to push out of. A
    // five second window can therefore report zero snaps on a floor that is
    // sinking perfectly steadily, which is a true number and the wrong question.
    // The trace ring keeps the LAST 600 ticks, so a long hold reports the steady
    // state rather than the settle.
    of.stand(true);
    await settle(A.stillSecs ?? 20);
    const dump = of.stand();
    const s = dump.samples.filter((x) => Number.isFinite(x.feetR));
    if (s.length < 250) {
      return { site: siteName, valid: false, fail: 'trace too short',
        total: dump.total, kept: s.length };
    }

    const feetRs = s.map((x) => x.feetR);
    const spreadM = Math.max(...feetRs) - Math.min(...feetRs);

    // A tick whose feet ROSE by more than a tick of free fall could ever raise
    // them is a SNAP, not a settle. Derived, not tuned.
    const gTick = of.gravity(Math.hypot(...standFeet)) / 3600;
    const snaps = [];
    const sinks = [];
    for (let i = 1; i < s.length; ++i) {
      const d = s[i].feetR - s[i - 1].feetR;
      if (d > gTick) snaps.push({ at: s[i].tick, riseM: d, pushM: s[i].pushM });
      else if (d < 0) sinks.push(-d);
    }
    const periods = [];
    for (let i = 1; i < snaps.length; ++i) periods.push(snaps[i].at - snaps[i - 1].at);
    const meanPeriod = periods.length === 0 ? null
      : periods.reduce((a, b) => a + b, 0) / periods.length;
    const meanSink = sinks.length === 0 ? 0 : sinks.reduce((a, b) => a + b, 0) / sinks.length;

    // --- WHICH SOURCE RATIFIES. The whole point of the probe. --------------
    // `terrainR - preSnapR` is zero exactly when the terrain floor query has
    // handed back the radius the walker arrived at. No threshold: a floor that
    // is a property of the world cannot equal a moving querier tick after tick
    // by coincidence, so the COUNT of such ticks is the finding.
    const rock = s.filter((x) => x.underRock);
    const ratified = rock.filter((x) => Math.abs(x.terrainR - x.preSnapR) < 1e-9);
    const floorErr = rock.map((x) => Math.abs(x.terrainR - trueFloor));
    const pushed = s.filter((x) => x.pushM > 0);
    const liftedByPush = s.filter((x) => x.pushUpM > 1e-9);

    const still = {
      ticks: s.length,
      trueFloorR: r6(trueFloor),
      // THE NUMBER THAT MAKES THE SECOND SITE A SECOND SITE.
      overheadRockM: r3(overheadRockM),
      standingSpreadM: r6(spreadM),
      // How far under the world's own floor the feet were allowed to get.
      maxSinkBelowFloorM: r6(Math.max(...s.map((x) => trueFloor - x.feetR))),
      minSinkBelowFloorM: r6(Math.min(...s.map((x) => trueFloor - x.feetR))),
      meanSinkPerTickM: r6(meanSink),
      oneTickOfGravityM: r6(gTick),
      snapUps: snaps.length,
      meanSnapPeriodTicks: meanPeriod === null ? null : r6(meanPeriod),
      biggestSnapM: snaps.length === 0 ? null : r6(Math.max(...snaps.map((x) => x.riseM))),
      // THE TWO AUTHORITIES, counted rather than inferred.
      underRockTicks: rock.length,
      ratifyingTicks: ratified.length,
      maxTerrainFloorErrorM: floorErr.length === 0 ? null : r6(Math.max(...floorErr)),
      pushTicks: pushed.length,
      pushLiftTicks: liftedByPush.length,
      maxPushM: pushed.length === 0 ? 0 : r6(Math.max(...pushed.map((x) => x.pushM))),
      // Every snap that coincided with a push: if these are the same ticks then
      // resolveEmbedded IS the corrector and the sawtooth is its period.
      snapsWithPush: snaps.filter((x) => x.pushM > 0).length,
      groundedTicks: s.filter((x) => x.grounded).length,
      speedMps: r6(of.world().player.speedMps),
    };
    log.push(`${siteName} STILL: ${still.overheadRockM} m of rock overhead, `
      + `spread ${still.standingSpreadM} m over ${s.length} ticks, `
      + `${snaps.length} snap-ups (period ${still.meanSnapPeriodTicks}), `
      + `sink/tick ${still.meanSinkPerTickM} vs one tick of gravity ${still.oneTickOfGravityM}`);
    log.push(`${siteName} SOURCES: terrain floor ratified the feet on `
      + `${still.ratifyingTicks} of ${rock.length} under-rock ticks, worst floor error `
      + `${still.maxTerrainFloorErrorM} m; resolveEmbedded pushed on ${still.pushTicks} `
      + `ticks, lifting on ${still.pushLiftTicks}`);

    // --- NEGATIVE CONTROL 1: A LEGITIMATE STEP UP IS STILL TAKEN -----------
    // Without this, "the feet never rise" is satisfied by a walker that can no
    // longer climb anything, which would be a worse bug than the one being
    // fixed. A dug tunnel floor is a staircase of whole cells, so walking it IS
    // the control: the feet must rise by more than a tick of gravity at least
    // once, while grounded, with no dig in this phase at all.
    //
    // BOTH WAYS ALONG THE RAMP, and that is not belt and braces. The drive cuts
    // a DESCENDING ramp, so one direction is downhill and only the other
    // presents a rise at all. A first version of this control walked one way,
    // measured zero climbs, and the reason was that it had walked 5.24 m DOWN:
    // a control that can only be satisfied by luck about which key faces uphill
    // is not a control.
    of.stand(true);
    for (let i = 0; i < 8; ++i) { await hold(0.30, ['KeyS']); await of.run(0.1, 60); }
    for (let i = 0; i < 8; ++i) { await hold(0.30, ['KeyW']); await of.run(0.1, 60); }
    const back = of.stand().samples.filter((x) => Number.isFinite(x.feetR));
    let climbs = 0, biggestClimb = 0;
    for (let i = 1; i < back.length; ++i) {
      const d = back[i].feetR - back[i - 1].feetR;
      // A rise the walker took while GROUNDED and with NO push is a step up:
      // the floor genuinely got higher and the snap followed it.
      if (d > gTick && back[i].grounded && back[i].pushM === 0) {
        climbs++;
        if (d > biggestClimb) biggestClimb = d;
      }
    }
    const rs = back.map((x) => x.feetR);
    // BOTH LADDERS, read off the walker rather than typed here. A tick may climb
    // a ledge (`resolveStep`, top rung) and then be seated on the floor it
    // landed on (`floorBelow`, first rung), so the largest legitimate
    // single-tick rise is their SUM. Reciting a number instead would agree with
    // itself whatever the walker did, which is standing rule 11's complaint.
    const ladder = of.voxelStepUpM ?? [0.55, 1.1];
    const riseBoundM = Math.max(...ladder) + ladder[0];
    const stepUp = {
      ticks: back.length,
      groundedTicks: back.filter((x) => x.grounded).length,
      underRockTicks: back.filter((x) => x.underRock).length,
      climbTicks: climbs,
      biggestClimbM: r6(biggestClimb),
      radialSpanM: r6(Math.max(...rs) - Math.min(...rs)),
      voxelLadderM: ladder.map(r6),
      riseBoundM: r6(riseBoundM),
      withinLadder: biggestClimb <= riseBoundM + 1e-6,
    };
    of.stand(false);
    log.push(`${siteName} STEP CONTROL: ${climbs} climb ticks, biggest `
      + `${stepUp.biggestClimbM} m, ladder ${stepUp.voxelLadderM.join('/')} m`);

    // --- NEGATIVE CONTROL 2: NOTHING UNDERNEATH STILL MEANS FALLING --------
    // The fix makes the floor a property of the field rather than of the feet.
    // The property that keeps that honest in the other direction is that when
    // the field has NO floor within reach the query answers nothing and the
    // player falls. Asked of the reference directly, high above the surface,
    // because driving a player off a ledge is a different probe's job.
    const p = feet();
    const rNow = Math.hypot(p[0], p[1], p[2]);
    const highUp = [p[0] / rNow * (rNow + 400), p[1] / rNow * (rNow + 400),
      p[2] / rNow * (rNow + 400)];
    const noFloor = floorAlong(highUp);

    return { site: siteName, valid: true, still, stepUp, drive, stress,
      reachedUnderRockBy: reached, noFloor,
      driveNetRiseM: drive.length < 2 ? null
        : r6(drive[drive.length - 1].feetR - drive[0].feetR),
      head: s.slice(0, 12).map((x) => ({
        t: x.tick, feet: r6(x.feetR), preSnap: r6(x.preSnapR), terrain: r6(x.terrainR),
        ground: r6(x.groundR), push: r6(x.pushM), up: r6(x.pushUpM),
        underRock: x.underRock, grounded: x.grounded,
      })),
      aroundFirstSnap: snaps.length === 0 ? null : (() => {
        const i = s.findIndex((x) => x.tick === snaps[0].at);
        return s.slice(Math.max(0, i - 3), i + 3).map((x) => ({
          t: x.tick, feet: r6(x.feetR), preSnap: r6(x.preSnapR), terrain: r6(x.terrainR),
          push: r6(x.pushM), up: r6(x.pushUpM),
        }));
      })(),
    };
  };

  // ---- SITE 1: the spawn clearing. The drive is the original one, verbatim.
  const spawnDig = async () => {
    const strikes = A.strikes ?? 16;
    const ramp = A.rampStrikes ?? 6;
    const yaw = A.yawDeg ?? 0;
    const drive = [];
    for (let i = 0; i < ramp; ++i) {
      of.look(yaw, -85);
      const d = of.dig();
      await settle(0.35);
      const p = of.world().player;
      drive.push({ phase: 'shaft', i, cells: d?.cells ?? d?.removed ?? null,
        underRock: p.underRock, grounded: p.grounded,
        feetR: r6(Math.hypot(...p.feet)) });
    }
    for (let i = 0; i < strikes; ++i) {
      of.look(yaw, A.pitchDeg ?? -12);
      const d = of.dig();
      await of.run(0.2, 60);
      await hold(A.stepSecs ?? 0.22, ['KeyW']);
      const p = of.world().player;
      drive.push({ phase: 'bore', i, cells: d?.cells ?? d?.removed ?? null,
        underRock: p.underRock, grounded: p.grounded,
        feetR: r6(Math.hypot(...p.feet)) });
    }
    return drive;
  };

  // ---- SITE 2: a real mountainside, bored LEVEL so the hill closes over the
  //      player's head instead of the bore descending under a flat field.
  const mountainDig = async () => {
    const intoM = A.intoM ?? 30;
    const site = findMountain(intoM);
    if (site === null) throw new Error('no land in the mountain sweep');
    of.teleport(site.lat, site.lon, 0);
    await settle(2.0);
    const face = await faceUphill(intoM);
    if (face === null) throw new Error('no aim ray at the mountain site');
    log.push(`mountain site ${site.lat.toFixed(4)},${site.lon.toFixed(4)} yaw ${face.yaw}: `
      + `the ground ${intoM} m ahead is ${r3(face.riseM)} m higher `
      + `(${(Math.atan2(face.riseM, intoM) * DEG).toFixed(1)} deg)`);
    const drive = [];
    const strikes = A.mountainStrikes ?? 26;
    for (let i = 0; i < strikes; ++i) {
      of.look(face.yaw, A.mountainPitchDeg ?? 0);
      const d = of.dig();
      await of.run(0.2, 60);
      await hold(A.stepSecs ?? 0.30, ['KeyW']);
      const p = of.world().player;
      drive.push({ phase: 'bore', i, cells: d?.cells ?? d?.removed ?? null,
        underRock: p.underRock, grounded: p.grounded,
        feetR: r6(Math.hypot(...p.feet)), overheadM: r3(overheadNow()) });
    }
    return drive;
  };

  // ---- SITE 3: the DEEPEST bore this world affords. Same level bore as site 2,
  //      but at a site chosen for a climb that is SUSTAINED, and driven until the
  //      rock overhead stops growing rather than for a fixed number of strikes.
  const deepDig = async () => {
    const reachM = A.reachM ?? 90;
    const site = findDeepSite(reachM);
    if (site === null) throw new Error('no land in the deep sweep');
    of.teleport(site.lat, site.lon, 0);
    await settle(3.0);
    const face = await faceUphill(reachM);
    if (face === null) throw new Error('no aim ray at the deep site');
    log.push(`deep site ${site.lat.toFixed(4)},${site.lon.toFixed(4)} yaw ${face.yaw}: `
      + `swept ${site.sweptPoints} points, sustained rise ${r3(site.riseM)} m over `
      + `${reachM} m (best coarse ${site.coarseBestM} m); the ground ${reachM} m `
      + `ahead is ${r3(face.riseM)} m higher`);
    const drive = [];
    // STOP AT THE PEAK, and the peak is measured rather than counted to. A fixed
    // strike count either stops short of the ridge or bores out the far side of
    // it: driven 120 strikes on this world the overhead climbs to 33.1 m at 102 m
    // in and is back to zero by 180 m, so the deepest point of a bore is a thing
    // the drive has to WATCH FOR. `peakDropM` is how far past the crest it is
    // allowed to go before it accepts that the crest is behind it.
    const maxStrikes = A.deepStrikes ?? 140;
    const peakDropM = A.peakDropM ?? 2.5;
    let peak = 0;
    for (let i = 0; i < maxStrikes; ++i) {
      of.look(face.yaw, A.deepPitchDeg ?? 0);
      const d = of.dig();
      await of.run(0.15, 60);
      await hold(A.stepSecs ?? 0.30, ['KeyW']);
      const p = of.world().player;
      const over = overheadNow();
      if (over > peak) peak = over;
      drive.push({ phase: 'bore', i, cells: d?.cells ?? d?.removed ?? null,
        underRock: p.underRock, grounded: p.grounded,
        feetR: r6(Math.hypot(...p.feet)), overheadM: r3(over) });
      // STOPPING AT A CHOSEN ROOF DEPTH, which is how `standOverheadM` actually
      // reaches the DEEP/shallow gate. Boring in stops on the way UP the curve,
      // so the walker ends under intact rock at the asked-for depth with no
      // walking backwards involved and no dependence on how long the bore is.
      if (A.standOverheadM !== undefined && over >= A.standOverheadM) break;
      if (peak > 5 && over < peak - peakDropM) break;   // the crest is behind us
    }
    log.push(`deep bore: ${drive.length} strikes, overhead peaked at ${r3(peak)} m, `
      + `stopped at ${r3(overheadNow())} m`);
    return drive;
  };

  const sites = [];
  sites.push(await scene('spawn', spawnDig));
  sites.push(await scene('mountain', mountainDig));
  sites.push(await scene('deep', deepDig));

  const spawn = sites[0], mtn = sites[1], deep = sites[2];
  const perSite = [];
  for (const site of sites) {
    if (!site.valid) { perSite.push([`${site.site}: the scene did not set up`, false, site.fail]); continue; }
    const st = site.still, su = site.stepUp;
    perSite.push(
      [`${site.site}: a stationary player on a static floor stands at a CONSTANT radius`,
        st.standingSpreadM <= 1e-6, st.standingSpreadM],
      [`${site.site}: no snap-ups at all with the player standing still`,
        st.snapUps === 0, st.snapUps],
      [`${site.site}: the feet are never more than one tick of fall below the world floor`,
        st.maxSinkBelowFloorM <= st.oneTickOfGravityM, st.maxSinkBelowFloorM],
      [`${site.site}: the terrain floor query NEVER answers with the querier own radius`,
        st.ratifyingTicks === 0, `${st.ratifyingTicks}/${st.underRockTicks}`],
      [`${site.site}: the terrain floor query answers the WORLD floor`,
        st.maxTerrainFloorErrorM !== null && st.maxTerrainFloorErrorM <= 1e-3,
        st.maxTerrainFloorErrorM],
      [`${site.site}: resolveEmbedded never has to correct a stationary player`,
        st.pushLiftTicks === 0, `${st.pushLiftTicks} lifting pushes`],
      [`${site.site} NEGATIVE CONTROL: a legitimate step up is still taken`,
        su.climbTicks > 0, `${su.climbTicks} climbs, biggest ${su.biggestClimbM} m`],
      [`${site.site} NEGATIVE CONTROL: and no step exceeds the walker own published ladder`,
        su.withinLadder, `${su.biggestClimbM} <= ${su.riseBoundM}`],
      [`${site.site} NEGATIVE CONTROL: the walk stayed grounded on the voxel floor`,
        su.underRockTicks > 0 && su.groundedTicks > su.ticks * 0.8,
        `${su.groundedTicks}/${su.ticks} grounded, ${su.underRockTicks} under rock`],
      [`${site.site} NEGATIVE CONTROL: nothing underneath still answers NOTHING`,
        site.noFloor === null, site.noFloor],
    );
  }

  // THE SITE ASSERTION (R8). Without this the second run can silently be the
  // first run again -- a mountain sweep that found flat ground, a bore that
  // came out of the hillside -- and the probe would report two greens for one
  // measurement. The bound is the SPAWN's own overhead, not a number typed
  // here, so it stays true if the spawn clearing is ever re-terraformed.
  //
  // The same argument applies a second time to the DEEP site: a longer bore that
  // did not end up under more rock is a longer bore and nothing else.
  //
  // NEITHER BOUND HOLDS WHEN THE SCENE IS DELIBERATELY STOOD SOMEWHERE SHALLOW.
  // `standOverheadM` retreats to a chosen roof depth on purpose, so all three
  // sites then report that depth and comparing them is comparing the argument
  // with itself. Skipped rather than relaxed: a check that is true because it was
  // weakened is worth less than one that says it did not apply.
  const spawnOver = spawn.valid ? spawn.still.overheadRockM : null;
  const mtnOver = mtn.valid ? mtn.still.overheadRockM : null;
  const deepOver = deep.valid ? deep.still.overheadRockM : null;
  if (A.standOverheadM === undefined) {
    perSite.push(
      ['R8: the second site really is under a MOUNTAIN, not a second flat clearing',
        mtnOver !== null && spawnOver !== null && mtnOver >= spawnOver + 5,
        `mountain ${mtnOver} m of rock overhead vs spawn ${spawnOver} m`],
      ['R8: and the third site really is DEEPER than the mountainside, not merely longer',
        deepOver !== null && mtnOver !== null && deepOver >= mtnOver + 5,
        `deep ${deepOver} m of rock overhead vs mountain ${mtnOver} m`],
    );
  }

  const failed = perSite.filter((c) => !c[1]).map((c) => `${c[0]}  [${c[2]}]`);
  return {
    valid: failed.length === 0,
    oldFloor: A.oldFloor === true,
    // Echoed so a run's numbers carry the axes they were driven on. A report that
    // says "does not reproduce" is worth what the reader can tell about how hard
    // it was pushed, and that has to travel with the numbers.
    drivenWith: {
      stillSecs: A.stillSecs ?? 20, preWalkLaps: A.preWalkLaps ?? 0,
      reloadFirst: A.reloadFirst === true,
      standOverheadM: A.standOverheadM ?? null,
    },
    failed,
    checked: perSite.length,
    overheadRockM: { spawn: spawnOver, mountain: mtnOver, deep: deepOver },
    sites,
    log,
  };
})()
