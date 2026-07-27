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
// function -- `VoxelCollision.floorBelow`, whose last line is
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
//   node tools/smoke/run.mjs --scenario=walk \
//        --evalfile=tools/smoke/probes/tunnelsink.js \
//        --evalargs='{"strikes":16}'
(async () => {
  const of = window.__of;
  const A = OF_ARGS ?? {};
  const strikes = A.strikes ?? 16;
  const ramp = A.rampStrikes ?? 6;
  const yaw = A.yawDeg ?? 0;
  const log = [];
  const r6 = (x) => (Number.isFinite(x) ? Number(x.toFixed(6)) : null);
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

  // Standing rule 11: an assertion that has never been seen to FAIL is not yet
  // an assertion, so this probe is required to run against the OLD floor query
  // and fail by name before its numbers on the new one mean anything.
  if (A.oldFloor) globalThis.__ofOldFloor = true;

  await settle(1.5);
  if (of.voxels() === null) return fail('no character, nothing can dig');
  if (typeof of.stand !== 'function') return fail('no __of.stand: rebuild');
  if (typeof of.solidAt !== 'function') return fail('no __of.solidAt: rebuild');

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

  // --- DRIVE: sink a shaft, then cut forward, stepping into the cut ---------
  // Identical to tunnelwalk.js's drive, so the tunnel this measures is the same
  // tunnel that probe walks, and the two results are about one piece of world.
  const drive = [];
  for (let i = 0; i < ramp; ++i) {
    of.look(yaw, -85);
    const d = of.dig();
    await settle(0.35);
    const p = of.world().player;
    drive.push({ phase: 'shaft', i, cells: d?.cells ?? d?.removed ?? null,
      alt: r6(of.altitude?.() ?? Number.NaN), underRock: p.underRock,
      grounded: p.grounded, feetR: r6(Math.hypot(...p.feet)) });
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
  // walking pattern this probe invented. A first cut used shorter legs, never
  // got the player back inside, and reported "never got under rock" for the
  // fixed build while the broken one measured cleanly, which would have read as
  // the fix breaking tunnels.
  // BOTH DIRECTIONS, and KeyS first. Which way the mouth lies from where the
  // drive stopped is not something this probe should have to know, and it
  // demonstrably differs between the two builds being compared: the broken one
  // ends inside, the fixed one climbs out of the far end. A search that only
  // walked forward reported "never got under rock" for the fixed build, which
  // reads exactly like the fix having broken tunnels and is not that at all.
  let reached = of.world().player.underRock ? 'drive' : null;
  for (const act of ['KeyS', 'KeyW']) {
    if (reached !== null) break;
    for (let i = 0; i < 14 && reached === null; ++i) {
      await hold(0.35, [act]);
      await of.run(0.15, 60);
      if (of.world().player.underRock) reached = act;
    }
    // Two more slices past the mouth, so the measurement is taken under intact
    // rock rather than in the doorway where the heightfield still has a say.
    if (reached !== null) {
      for (let i = 0; i < 2; ++i) { await hold(0.35, [act]); await of.run(0.15, 60); }
    }
  }
  await settle(2.5);
  const w0 = of.world().player;
  if (!w0.underRock) {
    // Not a pass-by-luck: if the feet are not on a VOXEL floor then nothing
    // below is about the code path this probe exists to measure, and saying so
    // is better than reporting clean numbers from the heightfield.
    return fail('never got under rock; nothing here measures floorBelow',
      { player: w0, feet: feet(), drive });
  }

  // --- P1/P2: STAND ABSOLUTELY STILL AND WATCH, PER TICK --------------------
  const standFeet = feet();
  const trueFloor = floorAlong(standFeet);
  if (trueFloor === null) return fail('no reference floor under the feet', { standFeet });
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
  if (s.length < 250) return fail('trace too short', { total: dump.total, kept: s.length });

  const feetRs = s.map((x) => x.feetR);
  const spreadM = Math.max(...feetRs) - Math.min(...feetRs);

  // A tick whose feet ROSE by more than a tick of free fall could ever raise
  // them is a SNAP, not a settle. Derived, not tuned.
  const gTick = of.world().player.gravityMps2 !== undefined
    ? of.world().player.gravityMps2 / 3600 : 9.81 / 3600;
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

  // --- WHICH SOURCE RATIFIES. The whole point of the probe. ----------------
  // `terrainR - preSnapR` is zero exactly when the terrain floor query has
  // handed back the radius the walker arrived at. No threshold: a floor that is
  // a property of the world cannot equal a moving querier tick after tick by
  // coincidence, so the COUNT of such ticks is the finding.
  const rock = s.filter((x) => x.underRock);
  const ratified = rock.filter((x) => Math.abs(x.terrainR - x.preSnapR) < 1e-9);
  const floorErr = rock.map((x) => Math.abs(x.terrainR - trueFloor));
  const pushed = s.filter((x) => x.pushM > 0);
  const liftedByPush = s.filter((x) => x.pushUpM > 1e-9);

  const still = {
    ticks: s.length,
    trueFloorR: r6(trueFloor),
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
  log.push(`STILL: spread ${still.standingSpreadM} m over ${s.length} ticks, `
    + `${snaps.length} snap-ups (period ${still.meanSnapPeriodTicks}), `
    + `sink/tick ${still.meanSinkPerTickM} vs one tick of gravity ${still.oneTickOfGravityM}`);
  log.push(`SOURCES: terrain floor ratified the feet on ${still.ratifyingTicks} of `
    + `${rock.length} under-rock ticks, worst floor error ${still.maxTerrainFloorErrorM} m; `
    + `resolveEmbedded pushed on ${still.pushTicks} ticks, lifting on ${still.pushLiftTicks}`);

  // --- NEGATIVE CONTROL 1: A LEGITIMATE STEP UP IS STILL TAKEN -------------
  // Without this, "the feet never rise" is satisfied by a walker that can no
  // longer climb anything, which would be a worse bug than the one being fixed.
  // A dug tunnel floor is a staircase of whole cells, so walking it IS the
  // control: the feet must rise by more than a tick of gravity at least once,
  // while grounded, with no dig in this phase at all.
  //
  // BOTH WAYS ALONG THE RAMP, and that is not belt and braces. The drive cuts a
  // DESCENDING ramp, so one direction is downhill and only the other presents a
  // rise at all. A first version of this control walked one way, measured zero
  // climbs, and the reason was that it had walked 5.24 m DOWN: a control that
  // can only be satisfied by luck about which key faces uphill is not a control.
  of.stand(true);
  for (let i = 0; i < 8; ++i) {
    await hold(0.30, ['KeyS']);
    await of.run(0.1, 60);
  }
  for (let i = 0; i < 8; ++i) {
    await hold(0.30, ['KeyW']);
    await of.run(0.1, 60);
  }
  const back = of.stand().samples.filter((x) => Number.isFinite(x.feetR));
  let climbs = 0, biggestClimb = 0;
  for (let i = 1; i < back.length; ++i) {
    const d = back[i].feetR - back[i - 1].feetR;
    // A rise the walker took while GROUNDED and with NO push is a step up: the
    // floor genuinely got higher and the snap followed it.
    if (d > gTick && back[i].grounded && back[i].pushM === 0) {
      climbs++;
      if (d > biggestClimb) biggestClimb = d;
    }
  }
  const rs = back.map((x) => x.feetR);
  // BOTH LADDERS, read off the walker rather than typed here. A tick may climb
  // a ledge (`resolveStep`, top rung) and then be seated on the floor it landed
  // on (`floorBelow`, first rung), so the largest legitimate single-tick rise is
  // their SUM. Reciting a number instead would agree with itself whatever the
  // walker did, which is standing rule 11's whole complaint.
  const ladder = of.voxelStepUpM ?? [0.55, 1.1];
  const riseBoundM = Math.max(...ladder) + ladder[0];
  const stepUp = {
    ticks: back.length,
    groundedTicks: back.filter((x) => x.grounded).length,
    underRockTicks: back.filter((x) => x.underRock).length,
    climbTicks: climbs,
    biggestClimbM: r6(biggestClimb),
    radialSpanM: r6(Math.max(...rs) - Math.min(...rs)),
    // The rise must stay inside the walker's published ladder: a floor query
    // allowed to answer arbitrarily far above the feet is a levitator, and that
    // is the failure mode the OLD code had in the other direction (a 0.1 m
    // ratchet, 6 m/s straight up a wall, recorded in floorBelow's own comment).
    voxelLadderM: ladder.map(r6),
    riseBoundM: r6(riseBoundM),
    withinLadder: biggestClimb <= riseBoundM + 1e-6,
  };
  of.stand(false);
  log.push(`STEP CONTROL: ${climbs} climb ticks, biggest ${stepUp.biggestClimbM} m, `
    + `rung ${stepUp.firstRungM} m`);

  // --- NEGATIVE CONTROL 2: NOTHING UNDERNEATH STILL MEANS FALLING ----------
  // The fix makes the floor a property of the field rather than of the feet.
  // The property that keeps that honest in the other direction is that when the
  // field has NO floor within reach the query answers nothing and the player
  // falls. Asked of the reference directly, high above the surface, because
  // driving a player off a ledge is a different probe's job.
  const p = feet();
  const rNow = Math.hypot(p[0], p[1], p[2]);
  const highUp = [p[0] / rNow * (rNow + 400), p[1] / rNow * (rNow + 400),
    p[2] / rNow * (rNow + 400)];
  const noFloor = floorAlong(highUp);

  const checks = [
    ['still: a stationary player on a static floor stands at a CONSTANT radius',
      spreadM <= 1e-6, still.standingSpreadM],
    ['still: no snap-ups at all with the player standing still',
      snaps.length === 0, snaps.length],
    ['still: the feet are never more than one tick of fall below the world floor',
      still.maxSinkBelowFloorM <= gTick, still.maxSinkBelowFloorM],
    ['still: the terrain floor query NEVER answers with the querier own radius',
      still.ratifyingTicks === 0, `${still.ratifyingTicks}/${rock.length}`],
    ['still: the terrain floor query answers the WORLD floor',
      still.maxTerrainFloorErrorM !== null && still.maxTerrainFloorErrorM <= 1e-3,
      still.maxTerrainFloorErrorM],
    ['still: resolveEmbedded never has to correct a stationary player',
      still.pushLiftTicks === 0, `${still.pushLiftTicks} lifting pushes`],
    ['NEGATIVE CONTROL: a legitimate step up is still taken',
      stepUp.climbTicks > 0, `${stepUp.climbTicks} climbs, biggest ${stepUp.biggestClimbM} m`],
    ['NEGATIVE CONTROL: and no step exceeds the walker own published ladder',
      stepUp.withinLadder, `${stepUp.biggestClimbM} <= ${stepUp.riseBoundM}`],
    ['NEGATIVE CONTROL: the walk stayed grounded on the voxel floor',
      stepUp.underRockTicks > 0 && stepUp.groundedTicks > stepUp.ticks * 0.8,
      `${stepUp.groundedTicks}/${stepUp.ticks} grounded, ${stepUp.underRockTicks} under rock`],
    ['NEGATIVE CONTROL: nothing underneath still answers NOTHING',
      noFloor === null, noFloor],
  ];
  const failed = checks.filter((c) => !c[1]).map((c) => `${c[0]}  [${c[2]}]`);

  return {
    valid: failed.length === 0,
    failed,
    checked: checks.length,
    // How the measuring spot was reached, and the whole drive, because the
    // TRAVERSE is a second thing this change can move and a probe that only
    // reports the standing numbers would not show it.
    reachedUnderRockBy: reached,
    driveNetRiseM: drive.length < 2 ? null
      : r6(drive[drive.length - 1].feetR - drive[0].feetR),
    driveBoreRiseM: (() => {
      const b = drive.filter((x) => x.phase === 'bore');
      return b.length < 2 ? null : r6(b[b.length - 1].feetR - b[0].feetR);
    })(),
    drive,
    still, stepUp,
    // The shape of the cycle, not only its summary. `terrain` beside `preSnap`
    // is the ratification, visible by eye in twenty rows.
    head: s.slice(0, 24).map((x) => ({
      t: x.tick, feet: r6(x.feetR), preSnap: r6(x.preSnapR), terrain: r6(x.terrainR),
      ground: r6(x.groundR), push: r6(x.pushM), up: r6(x.pushUpM),
      underRock: x.underRock, grounded: x.grounded,
    })),
    // ...and the ticks around the first snap, which is where the corrector acts.
    aroundFirstSnap: snaps.length === 0 ? null : (() => {
      const i = s.findIndex((x) => x.tick === snaps[0].at);
      return s.slice(Math.max(0, i - 3), i + 3).map((x) => ({
        t: x.tick, feet: r6(x.feetR), preSnap: r6(x.preSnapR), terrain: r6(x.terrainR),
        push: r6(x.pushM), up: r6(x.pushUpM),
      }));
    })(),
    log,
  };
})()
