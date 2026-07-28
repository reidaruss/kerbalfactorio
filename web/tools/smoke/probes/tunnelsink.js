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
// ============ A FOURTH SITE: WHAT THE PLAYER BUILT IN THE BORE ============
//
// The three sites above drive the walker's TERRAIN authority and nothing else.
// Every run of them has `structures.count == 0`, so the whole structural block
// of `KinematicBody.step` (`solids.resolveStep` then `solids.deckUnder`, lines
// 281 to 304) never executes, and that block is the other half of what holds a
// player up. basesink.js drives it with a base on open ground and with a tunnel
// dug BESIDE the base; the one arrangement neither probe reaches is a base
// INSIDE the bore, under intact rock, which is where both authorities are live
// on the same tick and where Reid actually builds.
//
// It also matters that the two halves refuse differently. `escapeRock` is armed
// with `this.buried && !this.grounded`, so a structural floor found in the same
// tick DISARMS PH-60's eject on purpose: a deck built inside a hillside is a
// legal floor and the rescue must not undo the tick of a player standing on
// one. That is the correct rule and it is also the only way a buried player can
// legally stop being ejected, so it is worth a scene of its own.
//
// The site needs SANDBOX, for decksink.js's and basesink.js's reason (DW-31):
// this is about geometry, and forty stone per foundation would make it a
// harvesting probe. Without `--sandbox=1` it is NOT MEASURED and says so rather
// than reporting a green it did not earn:
//
//   node tools/smoke/run.mjs --scenario=walk --sandbox=1 \
//        --evalfile=tools/smoke/probes/tunnelsink.js \
//        --evalargs='{"sites":["built"]}'
//   node tools/smoke/run.mjs --scenario=walk --sandbox=1 \
//        --evalfile=tools/smoke/probes/tunnelsink.js \
//        --evalargs='{"sites":["built"],"builtDig":"deep"}'   # refuses, by name
//
// `sites` selects which of `spawn`, `mountain`, `deep`, `built` run, because
// four bores at four sites is four minutes and iterating on one of them should
// not pay for the other three. `builtDig` picks which bore the fourth site
// builds in.
//
// WHAT IT FOUND, so a reader does not have to run it to know: the walker does
// NOT sink. Four scenes, 600 ticks each, at both bores, under 14.5 to 18.1 m of
// rock at the spawn and 37.6 to 38.6 m at the deep site, with four foundations,
// a wall and a machine in the world, spread 0.000000 m and 600 of 600 ticks
// grounded in every one of them. What it found INSTEAD is that the scene it was
// written to measure is not reachable at all: a structural part pressed while
// standing in a bore lands OVERHEAD, at the heightfield surface, never in the
// bore, so the walker's structural port answers nothing for a player in a
// tunnel however much they build from inside it (`structureTests` 0 on every
// one of 2400 ticks). See the CHARACTERISATION checks at the end of the scene.
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

  // ---- SITE 4: A BORE WITH A BASE PRESSED INTO IT -------------------------
  //
  // Everything below drives the STRUCTURAL port, which the three sites above
  // never touch, and it is deliberately a separate scene rather than a stress
  // flag: the thing being varied is not how the player stands, it is what is
  // under them, and that changes which of the walker's two floor authorities
  // answers at all.
  //
  // IT RUNS ON THE SPAWN BORE BY DEFAULT AND THAT IS A MEASURED CHOICE, not a
  // convenience. `builtDig:"deep"` is the same scene under a mountain and it
  // sets up only sometimes: with a 60-strike bore, all 30 presses over 6 cells
  // were refused with `ground too uneven here, the ground stands 1.95 m into
  // it, level it with Q`, rising to 5.55 m further in, and cutting a 249-cell
  // room around the player first moved that number by 0.01 m. With a 68-strike
  // bore and a 260-cell room the same presses were ACCEPTED, at an unevenness
  // of 0.49 m against a 0.50 m bury tolerance, which is a coin landing on its
  // edge and not a difference in kind.
  //
  // BOTH OUTCOMES HAVE THE SAME CAUSE and it is what the CHARACTERISATION
  // checks at the bottom of this scene state: the placement grid is addressed
  // off `Structures.groundRadius`, which is the HEIGHTFIELD, and a bore does
  // not touch the heightfield. So the refusal is the mountainside's own slope
  // across a 4.00 m cell, the room barely moves it, and when a press IS
  // accepted the part appears at the surface far overhead rather than in the
  // bore. The spawn clearing is flat, so there the presses are accepted every
  // time, and where they are accepted TO is the thing worth measuring.
  const builtScene = async () => {
    const sb = of.sandbox();
    if (sb === null || sb.sandbox !== true) {
      return { site: 'built', valid: false, skipped: true, checks: [],
        fail: 'not measured: needs --sandbox=1, because a foundation costs '
          + 'stone and this is a geometry probe (DW-31)' };
    }
    if (typeof of.solidBuild !== 'function') {
      return { site: 'built', valid: false, checks: [],
        fail: 'no __of.solidBuild: rebuild' };
    }
    // WHICH BORE THE BASE GOES IN. See the paragraph above the scene.
    const digs = { spawn: spawnDig, mountain: mountainDig, deep: deepDig };
    const digName = A.builtDig ?? 'spawn';
    const drive = await (digs[digName] ?? deepDig)();
    await settle(2.5);

    // The same search the other three sites use, and for the same reason: the
    // drive's end state depends on the walker and the walker is under test.
    let reached = of.world().player.underRock ? 'drive' : null;
    for (const act of ['KeyS', 'KeyW']) {
      if (reached !== null) break;
      for (let i = 0; i < 14 && reached === null; ++i) {
        await hold(0.35, [act]);
        await of.run(0.15, 60);
        if (of.world().player.underRock) reached = act;
      }
      if (reached !== null) {
        for (let i = 0; i < 2; ++i) { await hold(0.35, [act]); await of.run(0.15, 60); }
      }
    }
    await settle(2.0);
    if (!of.world().player.underRock) {
      return { site: 'built', valid: false, checks: [], drive,
        fail: 'never got under rock; nothing here measures the pair of floors' };
    }

    const P = () => of.world().player;
    const parts = () => of.game().structures.parts;
    const bodyCount = () => of.structures()?.bodies?.count ?? -1;
    const ghost = () => of.build().structGhost;
    const M = of.game().structures.module;
    const boreYaw = of.world().observer.yawDeg;

    // WHICH HOTBAR SLOT IS WHICH PART, ASKED RATHER THAN RECITED. basesink.js's
    // argument: five lanes are live in the gameplay files this week and a
    // recited index is a number that can silently become the wrong item and
    // place nothing while the probe reports a clean zero.
    const slotOf = async (kind) => {
      for (let i = 1; i <= 8; ++i) {
        of.build(i);
        await of.run(0.08, 60);
        of.look(boreYaw, -70);
        await of.run(0.08, 60);
        const g = ghost();
        if (g !== null && g.kind === kind) return i;
      }
      return null;
    };
    const foundationSlot = await slotOf('foundation');
    const wallSlot = await slotOf('wall');
    of.build(0);
    if (foundationSlot === null) {
      return { site: 'built', valid: false, checks: [], drive,
        fail: 'no hotbar slot produces a foundation ghost' };
    }

    /**
     * THE STRUCTURAL SOLID COLUMN over the feet, as bands in metres relative to
     * them, read off `of.solidBuild` which IS `StructureBodies.blocks`, the
     * predicate the walker collides against. decksink.js's `profile`, and its
     * reason: a column recomputed from `module.deckH` would agree with itself
     * whatever the walker did.
     *
     * The sweep is the probe's OWN, not the walker's capsule sample list, which
     * is not published. That is the honest way round: a band that overlaps the
     * capsule is a fact about the geometry, and whether the walker samples that
     * exact height is the walker's business.
     */
    const buildBands = (p, loM = -1.5, hiM = 2.5, stepM = 0.05) => {
      const r = Math.hypot(p[0], p[1], p[2]);
      const u = [p[0] / r, p[1] / r, p[2] / r];
      const bands = [];
      let start = null;
      for (let d = loM; d <= hiM + 1e-9; d += stepM) {
        const hit = of.solidBuild(u[0] * (r + d), u[1] * (r + d), u[2] * (r + d));
        if (hit && start === null) start = d;
        if (!hit && start !== null) { bands.push([r6(start), r6(d - stepM)]); start = null; }
      }
      if (start !== null) bands.push([r6(start), r6(hiM)]);
      return bands;
    };

    /**
     * WHERE THE PART ACTUALLY WENT, over the whole column a bore can be under.
     * A press being ACCEPTED says nothing about where the part landed, and the
     * narrow window above is deliberately the capsule's own reach, so it
     * answers `[]` both for "nothing was built" and for "it was built forty
     * metres over your head". Those are different findings.
     */
    // The range is 60 m because the deep bore ends under 38 m of rock and a
    // sweep that stops at 40 clips the answer: the first cut ran to 40 and
    // reported a part at exactly 40.0 m, which is a sweep bound reported as a
    // measurement.
    const columnBands = (p) => buildBands(p, -3, 60, 0.1);

    /** The highest structural TOP FACE along the feet's radial, or null. */
    const topAlong = (p, windowM = 3.0) => {
      const r = Math.hypot(p[0], p[1], p[2]);
      const u = [p[0] / r, p[1] / r, p[2] / r];
      const at = (rr) => of.solidBuild(u[0] * rr, u[1] * rr, u[2] * rr);
      let hit = null;
      for (let d = -windowM; d <= windowM + 1e-9; d += 0.02) if (at(r + d)) hit = r + d;
      if (hit === null) return null;
      let a = hit, b = hit + 0.02;
      for (let i = 0; i < 48; ++i) { const m = (a + b) / 2; if (at(m)) a = m; else b = m; }
      return a;
    };

    const gTick = of.gravity(Math.hypot(...feet())) / 3600;

    /** Stand absolutely still and read the per-tick trace. basesink.js's rig. */
    const watch = async (name, secs) => {
      await settle(1.5);
      of.stand(true);
      await settle(secs);
      const d = of.stand();
      of.stand(false);
      const s = d.samples.filter((x) => Number.isFinite(x.feetR));
      if (s.length < 250) {
        return { name, valid: false, fail: 'trace too short', kept: s.length };
      }
      const p = P();
      const rs = s.map((x) => x.feetR);
      const ups = [];
      for (let i = 1; i < s.length; ++i) {
        const dd = s[i].feetR - s[i - 1].feetR;
        if (dd > gTick) ups.push({ t: s[i].tick, dM: dd, push: s[i].pushM });
      }
      const per = [];
      for (let i = 1; i < ups.length; ++i) per.push(ups[i].t - ups[i - 1].t);
      const answered = s.filter((x) => Number.isFinite(x.deckR));
      const top = topAlong(p.feet);
      const feetR = Math.hypot(...p.feet);
      return {
        name, valid: true, ticks: s.length,
        overheadRockM: r3(overheadNow()),
        feetR: r6(feetR),
        // Positive means the feet are BELOW the top face they are standing on.
        belowBuildTopM: top === null ? null : r6(top - feetR),
        buildBandsRelFeetM: buildBands(p.feet),
        spreadM: r6(Math.max(...rs) - Math.min(...rs)),
        oneTickOfGravityM: r6(gTick),
        snapUps: ups.length,
        biggestUpM: ups.length === 0 ? null : r6(Math.max(...ups.map((x) => x.dM))),
        meanPeriodTicks: per.length === 0 ? null
          : r6(per.reduce((a, b) => a + b, 0) / per.length),
        // WHICH AUTHORITY IS LIVE, counted rather than assumed. A run where the
        // structural port answered nothing is a run of the first three sites
        // with extra steps, and this is what says so.
        onDeckTicks: s.filter((x) => x.onDeck).length,
        deckAnsweredTicks: answered.length,
        underRockTicks: s.filter((x) => x.underRock).length,
        buriedTicks: s.filter((x) => x.buried).length,
        groundedTicks: s.filter((x) => x.grounded).length,
        blockedByBuildTicks: s.filter((x) => x.blockedByBuild).length,
        structureTests: p.structureTests,
        // BOTH ratification tests side by side: GP-53 was the deck half and
        // WG-31 the terrain half, and only both columns can name which one is
        // answering with the querier's own position this time.
        deckRatifyTicks: answered.filter((x) => Math.abs(x.deckR - x.preSnapR) < 1e-9).length,
        terrainRatifyTicks: s.filter((x) => x.underRock
          && Math.abs(x.terrainR - x.preSnapR) < 1e-9).length,
        pushTicks: s.filter((x) => x.pushM > 0).length,
        pushLiftTicks: s.filter((x) => x.pushUpM > 1e-9).length,
        // PH-60's eject, which a structural floor found on the same tick is
        // supposed to DISARM. Counted, because "the rescue stopped firing" and
        // "the rescue is fighting the deck every tick" look identical in the
        // spread alone.
        ejectTicks: s.filter((x) => x.ejectM > 1e-9).length,
        maxEjectM: r6(Math.max(...s.map((x) => x.ejectM))),
        head: s.slice(0, 8).map((x) => ({ t: x.tick, feet: r6(x.feetR),
          terrain: r6(x.terrainR), deck: Number.isFinite(x.deckR) ? r6(x.deckR) : null,
          ground: r6(x.groundR), preSnap: r6(x.preSnapR), onDeck: x.onDeck,
          underRock: x.underRock, grounded: x.grounded, push: r6(x.pushM),
          eject: r6(x.ejectM) })),
      };
    };

    // --- PHASE 1: LAY A FLOOR ALONG THE BORE --------------------------------
    // IN A TUNNEL THE CROSSHAIR CAN ONLY EVER ADDRESS THE CELL YOU ARE IN, and
    // that is a measured property of `StructurePlacement.aimPoint`, not an
    // assumption: its ground march accepts the first sample whose radius is at
    // or under `groundRadius`, and under a mountain EVERY point around the eye
    // is under the surface radius, so the march stops at its first step of
    // 0.6 m whatever the pitch or yaw. Recon measured 1 of 56 aim directions
    // accepted and the other 55 answering `already built here`. So the run of
    // floor is laid by WALKING, one cell at a time, and the step between
    // placements is driven until the ghost's own key changes rather than for a
    // guessed number of seconds.
    /**
     * HOLLOW OUT A ROOM AT THE CELL THE PLAYER IS STANDING IN.
     *
     * A BORE IS TOO NARROW TO BUILD IN AND THAT IS MEASURED, NOT ASSUMED. The
     * first cut of this phase tried to lay the floor straight into the bore and
     * was refused on all 30 aims with `ground too uneven here, the ground stands
     * 1.95 m into it, level it with Q`, rising to 5.55 m further in. The module
     * cell is 4.00 m, so a foundation's corners sit about 2 m out from the
     * player, and a bore driven by walking is barely wider than the walker: the
     * corners are in the tunnel WALL, buried by 2 to 5.5 m against a bury
     * tolerance of 0.50 m. Nothing about that is a floor-query defect and it is
     * not the placement rule misfiring either. It is the reason Reid's tunnels
     * have rooms cut into them, so the probe cuts one too.
     *
     * The pitch stops at +20 degrees: the ceiling is what the rock overhead IS,
     * and a scene that dug its own roof off would be measuring a hillside.
     */
    const chamber = async () => {
      let cells = 0;
      for (const dy of [0, 45, 90, 135, 180, 225, 270, 315]) {
        for (const pitch of [-45, -20, 0, 20]) {
          of.look((boreYaw + dy + 720) % 360, pitch);
          await of.run(0.05, 60);
          const d = of.dig();
          cells += d?.cells ?? 0;
        }
      }
      await settle(0.8);
      return cells;
    };

    const laid = [];
    // EVERY REFUSAL, WITH THE SENTENCE THE PLAYER WOULD HAVE SEEN. A phase that
    // cannot build has to say why in the report: "0 presses landed" is a number
    // that could mean the aim, the cost, the ground rule or a renamed hotbar
    // slot, and those are four different findings.
    const attempts = [];
    of.build(foundationSlot);
    await settle(0.3);
    const want = A.borePartsN ?? 8;
    for (let n = 0; n < want; ++n) {
      // STAND STILL FIRST, AND THIS IS NOT TIDINESS. `hold(secs, keys)` lays a
      // tape LONGER than the seconds it then runs (`60 * secs + 30` frames), so
      // the walk carries on into whatever the probe does next. The first cut of
      // this phase swept the ghost straight after a step and every reading in it
      // was taken from a moving player: `overheadM` changed between two pitches
      // of the same sweep, which is impossible for a stationary capsule, and the
      // `onDeck` recorded after each press was read three metres past the slab
      // that had just been laid. `settle` lays an EMPTY tape, which is what
      // actually stops the walk.
      await settle(0.4);
      const cut = await chamber();
      for (const pitch of [-88, -70, -50, -30, -10]) {
        of.look(boreYaw, pitch);
        await of.run(0.06, 60);
        const g = ghost();
        attempts.push({ n, pitch, chamberCells: cut, ok: g?.ok ?? null,
          reason: g?.reason ?? 'no ghost',
          unevennessM: g?.unevennessM ?? null, carryRun: g?.carryRun ?? null,
          overheadM: r3(overheadNow()), underRock: P().underRock });
        if (g === null || !g.ok) continue;
        const before = parts().length;
        of.input.tape([{ hold: 4, actions: ['use'] }, { hold: 8, keys: [] }]);
        await of.run(0.35, 60);
        if (parts().length > before) {
          await settle(0.5);
          // THE BANDS ARE THE PROOF THAT THE SLAB IS WHERE THE PLAYER IS. A
          // press that is accepted says nothing about where the part landed:
          // the grid's level-0 plane comes from `groundRadius`, which is the
          // heightfield, so a deck accepted while standing under a mountain
          // could perfectly well appear at the mountain TOP. A solid band
          // straddling the feet is the only thing that says otherwise.
          laid.push({ n, addr: g.addr, key: g.key, overheadM: r3(overheadNow()),
            onDeck: P().onDeck, underRock: P().underRock,
            bandsRelFeetM: buildBands(feet()),
            columnBandsRelFeetM: columnBands(feet()) });
          break;
        }
      }
      // Walk back down the bore toward the mouth until the addressed cell
      // changes. KeyS and not KeyW: the drive stops with the face of the bore
      // ahead, so forward is solid rock and the run of floor has to be laid
      // BEHIND the deepest point. The deepest slab is therefore the first one,
      // which is where phase 2 goes back to stand.
      const k0 = ghost()?.key ?? null;
      of.look(boreYaw, -70);
      for (let j = 0; j < 10; ++j) {
        await hold(0.25, ['KeyS']);
        await settle(0.15);
        if ((ghost()?.key ?? null) !== k0) break;
      }
    }
    of.build(0);
    await settle(1.0);
    const built = parts().length;
    log.push(`built site: laid ${built} structural parts along the bore `
      + `(${laid.length} presses landed), module cell ${M.cellM} m, deck `
      + `${M.deckH} m; solid set now ${bodyCount()}`);
    if (built < 2) {
      const why = {};
      for (const t of attempts) why[t.reason] = (why[t.reason] ?? 0) + 1;
      log.push(`built site: the floor would NOT go down, refusals `
        + `${JSON.stringify(why)}`);
      return { site: 'built', valid: false, checks: [], drive, laid, built,
        refusals: why, attempts: attempts.slice(0, 24),
        buryToleranceM: r6(of.structures()?.buryToleranceM ?? NaN),
        floatToleranceM: r6(of.structures()?.floatToleranceM ?? NaN),
        fail: 'the floor would not go down in the bore' };
    }

    // --- PHASE 2: GO TO THE DEEPEST POINT OF THE BORE AND STAND -------------
    //
    // WHICH KEY GOES DEEPER IS MEASURED, NOT ASSUMED, and the first cut of this
    // walk is why. It held KeyW on the argument that the bore was driven
    // forward, and it walked the player straight out of the mouth: scene A ran
    // on open hillside under 0 m of rock with 0 under-rock ticks in 600. The
    // spawn bore DESCENDS and the search that first found rock had already
    // walked backwards along it, so which key faces into the hill depends on
    // where that search stopped. One step and one reading settle it.
    of.look(boreYaw, -10);
    const o0 = overheadNow();
    await hold(0.3, ['KeyS']);
    await settle(0.2);
    const deeper = overheadNow() >= o0 ? 'KeyS' : 'KeyW';
    const backOut = deeper === 'KeyS' ? 'KeyW' : 'KeyS';
    let bestOver = overheadNow();
    for (let i = 0; i < 24; ++i) {
      await hold(0.3, [deeper]);
      await settle(0.2);
      const o = overheadNow();
      if (P().blockedByRock === true) break;            // the face of the bore
      if (o < bestOver - 0.5) {                         // over the crest, back up
        await hold(0.3, [backOut]);
        await settle(0.2);
        break;
      }
      if (o > bestOver) bestOver = o;
      if (!P().underRock && o < 0.25) break;            // out of the bore
    }
    await settle(1.0);
    const standBands = columnBands(feet());
    // The lowest structural band that starts ABOVE a step: if the deck is up
    // there rather than under the feet, this is how far up.
    const above = standBands.filter((b) => b[0] > 0.55);
    const deckAboveFeetM = above.length === 0 ? null : above[0][0];
    const onDeck = P().onDeck === true;
    log.push(`built site: standing under ${r3(overheadNow())} m of rock, onDeck `
      + `${onDeck}, structural bands over the feet ${JSON.stringify(standBands)}`
      + (deckAboveFeetM === null ? ', nothing structural in the column at all'
        : `, the nearest built thing is ${deckAboveFeetM} m OVERHEAD`));
    const scenes = [];
    scenes.push(await watch('A: at the deep end with what was pressed in the bore',
      A.builtStandSecs ?? 15));

    // --- PHASE 3: WALK THE BORE WITH THE FLOOR IN IT, THEN STAND ------------
    // The floor a dug tunnel has is a staircase of whole cells and a laid floor
    // is a second staircase over it, so traversing both is what re-seats the
    // walker on each of them. A defect that needs a particular cell to be the
    // one you stop on is reachable this way and is not reachable by standing
    // where the last press left you.
    for (let lap = 0; lap < (A.builtLaps ?? 3); ++lap) {
      for (const act of ['KeyS', 'KeyW']) {
        for (let i = 0; i < 8; ++i) { await hold(0.3, [act]); await of.run(0.1, 60); }
      }
    }
    await settle(2.0);
    scenes.push(await watch('B: after walking the bore end to end',
      A.builtStandSecs ?? 15));

    // --- PHASE 4: A WALL PUT INTO THE SPACE THE CAPSULE OCCUPIES ------------
    // The placement path consults the capsule on NONE of its refusal grounds,
    // so a player can legally seal a wall through themselves. That is the state
    // this phase reaches on purpose, and the band list says whether it got
    // there rather than the phase claiming it did.
    const walls = [];
    if (wallSlot !== null) {
      of.build(wallSlot);
      await settle(0.3);
      for (const dy of [0, 90, 180, 270]) {
        for (const pitch of [-40, -20, 0, 20]) {
          of.look((boreYaw + dy + 720) % 360, pitch);
          await of.run(0.06, 60);
          const g = ghost();
          if (g === null || !g.ok) continue;
          const before = parts().length;
          of.input.tape([{ hold: 4, actions: ['use'] }, { hold: 8, keys: [] }]);
          await of.run(0.35, 60);
          if (parts().length > before) walls.push({ dy, pitch, key: g.key });
        }
      }
      of.build(0);
    }
    await settle(1.0);
    const wallBands = buildBands(feet());
    // A band that straddles 0 is geometry standing where the feet are.
    const throughCapsule = wallBands.filter((b) => b[0] <= 0.9 && b[1] >= 0.9).length;
    log.push(`built site: ${walls.length} wall press(es) landed, solid set `
      + `${bodyCount()}, structural bands over the feet ${JSON.stringify(wallBands)}`);
    scenes.push(await watch('C: with structures placed into the capsule own space',
      A.builtStandSecs ?? 15));

    // --- PHASE 5: A MACHINE, WHICH IS A DIFFERENT REGISTRY ------------------
    // Worth one press and one number rather than a scene, because `Machines`
    // never calls `Structures.adopt` and so never reaches `bodies`: a smelter
    // is not a collider the walker can stand on or be stopped by at all. The
    // press is here so that claim is measured on this build instead of read off
    // the imports.
    const machineBefore = bodyCount();
    let machinesPlaced = 0;
    for (let i = 1; i <= 8 && machinesPlaced === 0; ++i) {
      of.build(i);
      await of.run(0.08, 60);
      for (const pitch of [-70, -50, -30]) {
        of.look(boreYaw, pitch);
        await of.run(0.06, 60);
        const b = of.build();
        if (b?.structGhost !== null && b?.structGhost !== undefined) break;
        if (b?.ghost === null || b?.ghost === undefined || !b.ghost.ok) continue;
        // `mustNum` rather than `?.buildings ?? -1`: a report key that has been
        // renamed reads `undefined` on both sides and `undefined > undefined`
        // is false forever, which is a press count that can only go down.
        const n0 = mustNum(of.game().factory, 'buildings', 'factory');
        of.input.tape([{ hold: 4, actions: ['use'] }, { hold: 8, keys: [] }]);
        await of.run(0.35, 60);
        if (mustNum(of.game().factory, 'buildings', 'factory') > n0) {
          machinesPlaced++;
          break;
        }
      }
    }
    of.build(0);
    await settle(1.0);
    const machineAfter = bodyCount();
    log.push(`built site: ${machinesPlaced} machine(s) placed in the bore, the `
      + `walker's solid set went ${machineBefore} -> ${machineAfter}`);

    // --- PHASE 6: SAVE, RELOAD, STAND ---------------------------------------
    // The rock, the base and the player all through one round trip. No
    // `forgetTunnels` here, for the reason the `reloadFirst` stress records: it
    // puts the rock back around a player standing in it and PH-60 correctly
    // ejects them, which measures the eject and not the reload.
    // The count is taken HERE and not reused from phase 1: the wall and the
    // machine went in after it, and comparing a reload against a stale total is
    // an assertion that fails for the one reason it is not about.
    const partsBeforeSave = parts().length;
    const written = await of.save();
    const ledger = await of.load();
    await settle(3.5);
    const afterLoad = {
      voxelBytes: written?.voxelBytes ?? null,
      restoredVoxels: ledger?.voxels ?? null,
      partsBeforeSave,
      parts: parts().length,
      solidSet: bodyCount(),
      underRock: P().underRock,
      onDeck: P().onDeck,
      overheadM: r3(overheadNow()),
    };
    log.push(`built site RELOAD: ${afterLoad.parts} parts and a solid set of `
      + `${afterLoad.solidSet} came back, roof ${afterLoad.overheadM} m, `
      + `underRock ${afterLoad.underRock}, onDeck ${afterLoad.onDeck}`);
    scenes.push(await watch('D: after a save and a reload', A.builtStandSecs ?? 15));

    // --- PHASE 7: THE TRADE THE REFUSAL IS ACTUALLY OFFERING ----------------
    // `ground too uneven here, ... level it with Q` is the sentence a player
    // gets when they try to build in a bore, so this phase takes the advice and
    // reports what it costs. `level` cuts the HEIGHTFIELD column, which is the
    // only thing `groundRadius` reads, so it is the only way to bring the
    // buildable plane down to a player standing under rock, and every metre it
    // brings the plane down is a metre of roof gone. The two numbers are
    // recorded side by side per press so the exchange rate is measured rather
    // than argued.
    //
    // LAST, and after every stand, because it destroys the bore it measures.
    const levelTrade = [];
    // Two steps onto a cell nothing has been built on, or every ghost below
    // answers `already built here` and the trade is measured against a refusal
    // that has nothing to do with the ground.
    for (let i = 0; i < 2; ++i) { await hold(0.3, [deeper]); await settle(0.2); }
    of.build(foundationSlot);
    await settle(0.4);
    for (let i = 0; i < (A.levelPresses ?? 6); ++i) {
      of.look(boreYaw, -70);
      await of.run(0.08, 60);
      const g = ghost();
      levelTrade.push({ press: i, overheadM: r3(overheadNow()),
        unevennessM: g?.unevennessM ?? null, ok: g?.ok ?? null,
        reason: g?.reason ?? 'no ghost', underRock: P().underRock });
      if (g !== null && g.ok) break;
      of.look(boreYaw, -85);
      await of.run(0.08, 60);
      // THE TARGET IS PASSED AND NOT LEFT TO DEFAULT. `of.level()` with no
      // argument levels to `surfaceHeight` under the feet, and under a mountain
      // that IS the mountain top, so the press asks for the height the column
      // already has and changes nothing: measured, six presses at the deep site
      // left the roof at 40.782 m to six decimal places. The tool's own rule is
      // "stand where you want the floor", and the feet's height is what that
      // sentence means.
      of.level(Math.hypot(...feet()) - bodyR);
      await settle(0.8);
    }
    of.build(0);
    await settle(0.5);
    log.push(`built site LEVEL TRADE: ${JSON.stringify(levelTrade)}`);

    // --- WHAT THE FOUR SCENES ARE JUDGED ON ---------------------------------
    const checks = [];
    const add = (name, cond, detail) => checks.push([name, cond, detail]);
    for (const sc of scenes) {
      if (!sc.valid) { add(`built ${sc.name}: the scene did not set up`, false, sc.fail); continue; }
      add(`built ${sc.name}: a stationary player stands at a CONSTANT radius`,
        sc.spreadM <= 1e-6, sc.spreadM);
      add(`built ${sc.name}: no snap-ups at all with the player standing still`,
        sc.snapUps === 0, `${sc.snapUps} (period ${sc.meanPeriodTicks})`);
      add(`built ${sc.name}: the DECK query never answers the querier own radius`,
        sc.deckRatifyTicks === 0, `${sc.deckRatifyTicks}/${sc.deckAnsweredTicks}`);
      add(`built ${sc.name}: nor does the TERRAIN query`,
        sc.terrainRatifyTicks === 0, `${sc.terrainRatifyTicks}/${sc.underRockTicks}`);
      add(`built ${sc.name}: resolveEmbedded never has to lift a stationary player`,
        sc.pushLiftTicks === 0, `${sc.pushLiftTicks} lifting pushes`);
      add(`built ${sc.name}: and PH-60 never has to eject one`,
        sc.ejectTicks === 0, `${sc.ejectTicks} ejects, worst ${sc.maxEjectM} m`);
    }
    const a = scenes[0];
    // THE CONTROLS THAT MAKE THE SITE MEAN ANYTHING. PH-45's runs were clean
    // because `solids.count` was zero and the structural block never ran at
    // all; these say the block ran and the player was under rock while it did.
    add('built NEGATIVE CONTROL: the walker really had a structural set to consult',
      built >= 2 && bodyCount() >= built,
      `${built} parts, solid set ${bodyCount()}`);
    add('built NEGATIVE CONTROL: and really was under rock the whole time',
      a.valid === true && a.underRockTicks === a.ticks && a.overheadRockM >= 5,
      a.valid ? `${a.underRockTicks}/${a.ticks} under ${a.overheadRockM} m of rock` : 'n/a');
    add('built: a machine in the bore adds NOTHING to the walker solid set',
      machinesPlaced > 0 && machineAfter === machineBefore,
      `${machinesPlaced} placed, ${machineBefore} -> ${machineAfter}`);
    add('built: the base and the bore both survive a save and a reload',
      afterLoad.parts === partsBeforeSave && afterLoad.solidSet === partsBeforeSave
        && afterLoad.underRock === true,
      `${afterLoad.parts}/${partsBeforeSave} parts, solid set `
      + `${afterLoad.solidSet}, underRock ${afterLoad.underRock}`);

    // ===================================================================
    // THE CHARACTERISATION, AND IT IS THE FINDING THIS SITE ACTUALLY MADE.
    //
    // A structural part pressed while standing in a bore IS ACCEPTED and does
    // NOT land in the bore. `StructurePlacement` addresses the grid off
    // `Structures.groundRadius`, which is `_of_surface_radius` over the
    // HEIGHTFIELD, and a dug bore leaves the heightfield alone: the column over
    // a tunnel whose roof is intact reads exactly as much rock as it did before
    // the first strike. So the level-0 plane of the site a player founds while
    // standing under a mountain is the MOUNTAINSIDE, and the foundation appears
    // up there. Measured: three presses accepted at the spawn bore, and a
    // solid-column sweep along the feet's own radial found the nearest built
    // thing 9 to 13 m OVERHEAD with nothing at all inside the capsule's reach.
    // At the deep site the same presses are refused outright, `ground too uneven
    // here, the ground stands 1.95 m into it` rising to 5.55 m further in,
    // which is the mountainside's own slope across a 4.00 m cell and not
    // anything about the tunnel.
    //
    // Two consequences, and the second is why this is stated as an assertion:
    //
    //   * The walker's structural port CANNOT be brought under a player
    //     standing in a tunnel by any amount of digging, so "structures in the
    //     tunnel" cannot be a source of the sinking. That closes the last
    //     uncovered path in the hunt rather than leaving it open.
    //   * The day the placement rule learns about bores, this check FAILS, and
    //     it is meant to: that is the day scenes A to D above stop measuring a
    //     port that answers nothing and start measuring one that holds the
    //     player up, and somebody has to be told to come back and tighten them.
    // ===================================================================
    //
    // MEASURED AT THE CELLS THE PRESSES HAPPENED ON, not where the player ended
    // up: the walk in phase 2 goes past them to the deepest point of the bore,
    // and a column sweep taken there finds nothing simply because there is
    // nothing built in THAT column. Each `laid` entry carries its own sweep.
    const landed = laid.map((L) => {
      const up = (L.columnBandsRelFeetM ?? []).filter((b) => b[0] > 0.55);
      const partAtM = up.length === 0 ? null : up[0][0];
      return { n: L.n, overheadM: L.overheadM, partAtM,
        // How close to the ROOF it landed. Reported and not asserted: a 4.00 m
        // deck is addressed at a cell whose centre is metres from the player,
        // and on a 42 degree face the heightfield over THAT column is metres
        // from the heightfield over this one. The number is tight where the
        // ground is flat (measured 0.04 m at the spawn bore over four presses)
        // and is a slope measurement anywhere else.
        roofMissM: partAtM === null ? null : r6(partAtM - L.overheadM),
        inCapsule: (L.bandsRelFeetM ?? []).length > 0 };
    });
    const seen = landed.filter((x) => x.partAtM !== null);
    add('built CHARACTERISATION: a part pressed in a bore lands OVERHEAD, and '
      + 'never inside the capsule that pressed it',
      landed.length >= 2 && landed.every((x) => !x.inCapsule)
        && seen.length >= 1 && seen.every((x) => x.partAtM > 0.55),
      JSON.stringify(landed));
    add('built CHARACTERISATION: so the structural port answers NOTHING for a '
      + 'player in a bore, however much is built from inside it',
      a.valid === true && a.onDeckTicks === 0 && a.deckAnsweredTicks === 0
        && a.structureTests === 0 && onDeck === false,
      a.valid ? `${a.onDeckTicks} onDeck, ${a.deckAnsweredTicks} deck answers, `
        + `${a.structureTests} point tests` : 'n/a');
    // THE LEVEL TRADE IS REPORTED AND NOT ASSERTED, deliberately.
    //
    // It measures the LEVELLING TOOL, and this probe's subject is the walker.
    // Both halves of what it found are somebody else's to judge: at the spawn
    // bore one press took the whole 14.175 m roof off in a single go, and at
    // the deep site six presses left the roof at 40.782 m to six decimal places
    // whether the target height was defaulted or passed explicitly, which is
    // `LevelAction` under a mountain and is world-gen's line, not this lane's.
    // Gating a sink probe on either would make it red for a reason that has
    // nothing to do with sinking.
    log.push(`built site LEVEL TRADE (reported, not asserted): roof `
      + `${levelTrade[0]?.overheadM} m -> `
      + `${levelTrade[levelTrade.length - 1]?.overheadM} m over `
      + `${levelTrade.length} press(es), ghost says "${levelTrade[0]?.reason}"`);

    for (const sc of scenes) {
      if (!sc.valid) { log.push(`built ${sc.name}: NOT MEASURED (${sc.fail})`); continue; }
      log.push(`built ${sc.name}: spread ${sc.spreadM} m over ${sc.ticks} ticks under `
        + `${sc.overheadRockM} m of rock, ${sc.snapUps} snap-ups, onDeck `
        + `${sc.onDeckTicks}, deck answered ${sc.deckAnsweredTicks}, underRock `
        + `${sc.underRockTicks}, buried ${sc.buriedTicks}, deck ratified `
        + `${sc.deckRatifyTicks}, terrain ratified ${sc.terrainRatifyTicks}, `
        + `pushes ${sc.pushTicks}, ejects ${sc.ejectTicks}, feet `
        + `${sc.belowBuildTopM} m below the build top`);
    }

    return {
      site: 'built', valid: checks.every((c) => c[1]), checks, digName,
      partsBuilt: built, laid, attempts: attempts.slice(0, 24), walls: walls.length,
      standBandsRelFeetM: standBands, deckAboveFeetM, onDeckAtStand: onDeck,
      landed, levelTrade,
      wallsThroughCapsule: throughCapsule, wallBandsRelFeetM: wallBands,
      foundationSlot, wallSlot, machinesPlaced,
      solidSet: { beforeMachine: machineBefore, afterMachine: machineAfter },
      afterLoad, reachedUnderRockBy: reached, scenes, drive,
    };
  };

  const wanted = A.sites ?? ['spawn', 'mountain', 'deep', 'built'];
  const sites = [];
  if (wanted.includes('spawn')) sites.push(await scene('spawn', spawnDig));
  if (wanted.includes('mountain')) sites.push(await scene('mountain', mountainDig));
  if (wanted.includes('deep')) sites.push(await scene('deep', deepDig));
  const builtSite = wanted.includes('built') ? await builtScene() : null;
  if (builtSite !== null && builtSite.skipped === true) log.push(`built site: ${builtSite.fail}`);

  const at = (n) => sites.find((x) => x.site === n) ?? null;
  const spawn = at('spawn'), mtn = at('mountain'), deep = at('deep');
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
  //
  // AND A THIRD TIME, the same argument does NOT hold across a selected run:
  // `sites` exists so one bore can be iterated on, and comparing a site with a
  // site that did not run is comparing it with nothing.
  const spawnOver = spawn !== null && spawn.valid ? spawn.still.overheadRockM : null;
  const mtnOver = mtn !== null && mtn.valid ? mtn.still.overheadRockM : null;
  const deepOver = deep !== null && deep.valid ? deep.still.overheadRockM : null;
  if (A.standOverheadM === undefined && spawn !== null && mtn !== null && deep !== null) {
    perSite.push(
      ['R8: the second site really is under a MOUNTAIN, not a second flat clearing',
        mtnOver !== null && spawnOver !== null && mtnOver >= spawnOver + 5,
        `mountain ${mtnOver} m of rock overhead vs spawn ${spawnOver} m`],
      ['R8: and the third site really is DEEPER than the mountainside, not merely longer',
        deepOver !== null && mtnOver !== null && deepOver >= mtnOver + 5,
        `deep ${deepOver} m of rock overhead vs mountain ${mtnOver} m`],
    );
  }

  // The fourth site's own checks, folded in. A SKIPPED site contributes none:
  // it did not run, so it has nothing to say, and a green stamped on a scene
  // that never happened is worth less than a report that says it did not.
  if (builtSite !== null && builtSite.skipped !== true) {
    if (Array.isArray(builtSite.checks) && builtSite.checks.length > 0) {
      perSite.push(...builtSite.checks);
    } else {
      perSite.push(['built: the scene did not set up', false, builtSite.fail]);
    }
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
      sites: wanted,
      builtStandSecs: A.builtStandSecs ?? 15, borePartsN: A.borePartsN ?? 8,
      builtLaps: A.builtLaps ?? 3,
    },
    failed,
    checked: perSite.length,
    overheadRockM: { spawn: spawnOver, mountain: mtnOver, deep: deepOver,
      built: builtSite?.scenes?.[0]?.overheadRockM ?? null },
    sites,
    builtSite,
    log,
  };
})()
