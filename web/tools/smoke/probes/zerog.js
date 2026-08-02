// APPARENT ZERO G: THE MEASUREMENT, THEN THE MODEL (PH-98 to PH-102).
//
// Reid: "if I did an EVA outside of my rocket you should float around like you
// would in real life. Apparent 0 g in orbit."
//
// He is right, and the record was wrong. `SpaceStation.ts` said a nadir-pointing
// deck "buys real artificial gravity for free at the local inverse-square
// value". True of the FIELD STRENGTH, false of what an occupant feels: a
// station at 400 km is in FREEFALL and nothing inside it has any weight. The
// frozen station of PH-94 is dynamically a tower on a 400 km pillar.
//
// Z1 IS THE MEASUREMENT AND IT COMES FIRST, before anything new is exercised,
// because the question Admin asked -- does the existing walker degrade
// gracefully into a floating body, or does it need a separate controller --
// decides how large this piece is. Z1a and Z1b both run the walker's ORIGINAL
// gravity path, untouched: Z1a at full gravity in mid-air, Z1b at 3.1% gravity,
// which is deliberately just ABOVE `ZEROG.standG` so the float gate never fires
// and the old model is what answers.
(async () => {
  const of = window.__of;
  const log = [];
  const r6 = (x) => (Number.isFinite(x) ? Number(x.toFixed(6)) : null);
  const yield0 = () => new Promise((r) => { setTimeout(r, 0); });
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  const len = (p) => Math.hypot(p[0], p[1], p[2]);

  await of.run(0.8, 60);
  for (const k of ['weight', 'gravityScale', 'stationGravity', 'standAt', 'station']) {
    if (typeof of[k] !== 'function') return { fail: `no __of.${k}: rebuild` };
  }
  const home0 = of.world().player.feet.slice();
  const feet = () => of.world().player.feet.slice();

  // Every leg restores the world it borrowed: gravity back to 1, the station's
  // generator back on, the player back on the ground. run.mjs settles on
  // terrain convergence and a walker parked 400 km up never lets it exit
  // (PH-89), and a probe that leaves gravity at zero poisons the next one.
  const back = async () => {
    of.input.tape([{ hold: 60, keys: [] }]);
    of.gravityScale(1);
    of.stationGravity(true);
    of.standAt(home0[0], home0[1], home0[2]);
    await of.run(0.5, 60);
    await yield0();
  };
  const fail = async (why, extra) => { await back(); return { fail: why, ...extra, log }; };

  /**
   * Run with NOTHING HELD. Every `of.run` outside `sample` goes through this.
   *
   * `sample` arms a tape with `ceil(secs*60) + 180` ticks of hold so it cannot
   * run out mid-leg, which means it always leaves up to three seconds of the
   * previous leg's keys queued. The first run of this probe measured a 4.461111
   * m difference between two walks that were meant to be identical, and the
   * whole of it was a settle that was still holding KeyW. Under gravity that is
   * a walk; in freefall it is thrust, and it would have bled into every leg
   * after Z1b silently and in the flattering direction.
   */
  const settle = async (secs) => {
    of.input.tape([{ hold: Math.ceil(secs * 60) + 120, keys: [] }]);
    await of.run(secs, 60);
    await yield0();
  };

  /**
   * Drive `keys` for `secs`, sampling the FEET every `chunk` seconds.
   *
   * TWO INSTRUMENT RULES, BOTH LEARNED THE HARD WAY IN THIS FILE.
   *
   * (1) Velocity is a finite difference of POSITION and never the walker's own
   *     `speedMps`. An instrument that asks the subject how fast it is going
   *     cannot catch the subject being wrong about it.
   *
   * (2) It is divided by the ELAPSED FIXED TICKS, not by the wall-clock seconds
   *     asked for. `of.run(secs, hz)` drives RENDER frames and the fixed-tick
   *     accumulator carries across calls, so a "2.0 second" leg delivered 112
   *     ticks and not 120 -- and dividing by 2.0 read a correct 1.5 m/s^2
   *     thrust as 1.402 and failed it. Every speed below is therefore a real
   *     physical speed with none of the harness's accounting left in it, which
   *     is what lets the assertions be exact instead of tolerant.
   */
  const sample = async (secs, keys, chunk = 0.25) => {
    const out = [];
    const n = Math.max(1, Math.round(secs / chunk));
    of.input.tape([{ hold: Math.ceil(secs * 60) + 180, keys }]);
    let prev = feet();
    let prevTick = of.world().tick;
    let ticks = 0;
    for (let i = 0; i < n; ++i) {
      await of.run(chunk, 60);
      await yield0();
      const f = feet();
      const w = of.weight();
      const tk = of.world().tick;
      const dTicks = tk - prevTick;
      ticks += dTicks;
      out.push({
        t: r6((i + 1) * chunk), ticks: dTicks, secs: r6(dTicks / 60),
        speed: dTicks === 0 ? 0 : dist(f, prev) / (dTicks / 60),
        r: len(f), feet: f,
        floating: w.floating, grounded: w.grounded, onDeck: w.onDeck,
        apparentG: w.apparentG,
      });
      prev = f; prevTick = tk;
    }
    out.ticks = ticks;
    out.secs = ticks / 60;
    return out;
  };

  // =====================================================================
  // Z0. CONTROL: THE GROUND IS UNTOUCHED.
  //
  //     THE TRANSPARENCY CLAIM IS THE `===` ON GRAVITY, NOT THE WALK. With no
  //     volume within reach the port must hand back the caller's own number
  //     bit for bit, and that is asserted with `===` on the raw f64.
  //
  //     THE REPEATED WALK IS A DETERMINISM CHECK AND ITS RESIDUE IS PREDICTED
  //     RATHER THAN TOLERATED. The first version required two identical walks
  //     to land on identical bits and got 0.076667 m, which is not a physics
  //     difference: it is EXACTLY `walkMps / 60`, one fixed tick of travel at
  //     top speed. `of.run(secs, hz)` drives RENDER frames and the fixed-tick
  //     accumulator carries across legs, so two legs of the same wall-clock
  //     length can differ by one tick. That is the harness's quantum, it is a
  //     property of the instrument and not of the walker, and asserting a bare
  //     epsilon against it would have called correct code a defect -- the same
  //     lesson `stationwalk.js` P4 learned about d^2/2R, now three times in
  //     two days and the first time on the CLOCK rather than the geometry.
  // =====================================================================
  of.gravityScale(1);
  of.standAt(home0[0], home0[1], home0[2]);
  await settle(1.0);
  const a0 = feet();
  const wA = await sample(3.0, ['KeyW'], 1.0);
  const endA = feet();
  of.standAt(a0[0], a0[1], a0[2]);
  await settle(1.0);
  of.gravityScale(1);
  const wB = await sample(3.0, ['KeyW'], 1.0);
  const endB = feet();
  const w0 = of.weight();
  const tickQuantumM = 4.6 / 60;
  // The two legs are the same COMMAND for the same wall-clock time, and they
  // are not the same number of fixed TICKS: the accumulator carries across
  // `of.run` calls, so the difference is a small integer that varies run to
  // run (1 was seen, then 2). It is therefore predicted from the measured tick
  // counts rather than bounded by a guess -- `sample` now reports them, so the
  // expected separation is exactly the surplus ticks travelled at walk speed.
  const dTicks = Math.abs(wA.ticks - wB.ticks);
  const predictedSepM = dTicks * tickQuantumM;
  const Z0 = {
    walkedM: r6(dist(endA, a0)),
    repeatDeltaM: r6(dist(endA, endB)),
    ticksA: wA.ticks, ticksB: wB.ticks, tickDelta: dTicks,
    predictedTickQuantumM: r6(tickQuantumM),
    predictedSepM: r6(predictedSepM),
    quantumErrM: r6(dist(endA, endB) - predictedSepM),
    floatingTicks: wA.filter((q) => q.floating).length + wB.filter((q) => q.floating).length,
    trueG: w0.trueG, apparentG: w0.apparentG,
    transparent: w0.apparentG === w0.trueG,
    inVolumes: w0.inVolumes.length,
  };
  log.push({ Z0 });
  if (!Z0.transparent) {
    return fail('Z0: the port changed gravity on the ground, where no volume is '
      + 'in reach', Z0);
  }
  if (Z0.inVolumes !== 0) return fail('Z0: a gravity volume reaches the ground site', Z0);
  if (Z0.floatingTicks !== 0) return fail('Z0: the walker floated on the ground', Z0);
  if (!(Z0.walkedM > 5)) return fail('Z0: the control walk did not happen', Z0);
  if (Math.abs(Z0.quantumErrM) > 1e-4) {
    return fail('Z0: the separation between two identical walks is not the '
      + 'surplus fixed ticks travelled at walk speed, so something other than '
      + 'the harness clock moved the walker', Z0);
  }

  // =====================================================================
  // Z1a. THE SERVO, AT FULL GRAVITY, IN SHIPPED CODE. Jump, hold W to build
  //      up speed, then RELEASE while still airborne. If horizontal velocity
  //      is momentum it is unchanged; if it is a velocity servo it decays at
  //      CAPSULE.airAccel with nothing touching the player. This is the whole
  //      answer to "does the walker degrade into a floating body", asked
  //      without changing one line of the walker.
  // =====================================================================
  of.standAt(home0[0], home0[1], home0[2]);
  await settle(1.0);
  of.input.tape([{ hold: 90, keys: ['KeyW'] }]);
  await of.run(1.2, 60);
  await yield0();
  const runUp = feet();
  of.input.tape([{ hold: 8, keys: ['KeyW', 'Space'] },
    { hold: 240, keys: [] }]);
  await of.run(0.13, 60);
  await yield0();
  const airFrom = feet();
  await of.run(0.25, 60);
  await yield0();
  const airTo = feet();
  const Z1a = {
    speedBeforeReleaseMps: r6(dist(runUp, airFrom) / 0.13),
    speedAfterReleaseMps: r6(dist(airFrom, airTo) / 0.25),
    airborne: !of.weight().grounded,
  };
  Z1a.decayed = Z1a.speedAfterReleaseMps < Z1a.speedBeforeReleaseMps * 0.9;
  log.push({ Z1a });

  // =====================================================================
  // Z1b. THE OLD MODEL AT 3.1% GRAVITY. `standG` is 0.30 m/s^2 and Forge's
  //      surface is 9.81, so a scale of 0.0325 leaves apparent gravity at
  //      0.319: nearly weightless, and STRICTLY ABOVE the gate, so the
  //      original code path is the one that answers. Two questions:
  //      does releasing the key stop you, and is there ANY radial axis?
  // =====================================================================
  of.gravityScale(0.0325);
  of.standAt(home0[0], home0[1], home0[2]);
  await settle(1.5);
  const g1 = of.weight();
  if (g1.floating) {
    return fail('Z1b: 0.0325 scale was meant to stay ABOVE the float gate and '
      + 'did not, so this leg is not measuring the old model', { g1 });
  }
  const push = await sample(2.0, ['KeyW'], 0.5);
  const coast = await sample(3.0, [], 0.5);
  // THE RADIAL AXIS, ASKED THE ONLY WAY THAT IS DECISIVE. Holding Space in the
  // old model DOES move you radially, by 10.34 m in the first version of this
  // leg -- but that is a JUMP, a one-shot impulse gated on `grounded` that
  // re-fires each time you land, and reading it as a control axis would have
  // been the flattering answer. DESCENT is the question with no such confound:
  // there is no key for it at all, so the old model cannot command the radial
  // in the one direction gravity is not already supplying.
  const beforeUp = len(feet());
  const upTry = await sample(3.0, ['Space'], 0.5);
  const afterUp = len(feet());
  // BACK TO THE GROUND, AND `standAt` RATHER THAN A SETTLE. At 3% gravity the
  // Space jump above reaches tens of metres and takes far longer than a settle
  // to come down; the first version measured the descent leg while the player
  // was STILL RISING from it and read `shiftRadialM: +6.911838`, i.e. Shift
  // moving somebody upward. `standAt` zeroes the velocity, which is the only
  // thing that makes the next three seconds about Shift at all.
  of.standAt(home0[0], home0[1], home0[2]);
  await settle(1.5);
  const beforeDn = len(feet());
  const groundedBeforeDn = of.weight().grounded;
  const dnTry = await sample(3.0, ['ShiftLeft'], 0.5);
  const Z1b = {
    apparentG: r6(g1.apparentG), floating: g1.floating,
    speedUnderThrustMps: r6(push[push.length - 1].speed),
    speedAfter1sCoastMps: r6(coast[1].speed),
    speedAfter3sCoastMps: r6(coast[coast.length - 1].speed),
    // Space: a ballistic jump arc, not authority. Kept as evidence, not a claim.
    spaceRadialM: r6(afterUp - beforeUp),
    spaceSamples: upTry.map((q) => r6(q.r - beforeUp)),
    // Shift: the decisive one. No descent command exists.
    shiftRadialM: r6(len(feet()) - beforeDn),
    shiftSamples: dnTry.map((q) => r6(q.r - beforeDn)),
    groundedBeforeDn,
  };
  Z1b.stoppedDead = Z1b.speedAfter3sCoastMps < 0.05;
  Z1b.noDescentAxis = Math.abs(Z1b.shiftRadialM) < 0.05;
  log.push({ Z1b });
  if (!Z1b.stoppedDead) {
    return fail('Z1b: the OLD model kept its speed in near-vacuum, which would '
      + 'mean the servo diagnosis is wrong and this whole lane is mis-aimed', Z1b);
  }
  if (!Z1b.noDescentAxis) {
    return fail('Z1b: the old model moved the player DOWN on command, so it has '
      + 'a radial axis after all', Z1b);
  }

  // =====================================================================
  // Z2. THE NEW MODEL: MOMENTUM. Gravity to zero, thrust, then release and
  //     coast. The assertion is that speed is KEPT, which is what separates
  //     a thrust from a servo and is the single behavioural difference that
  //     makes freefall feel like freefall.
  // =====================================================================
  // IN FREE SPACE, 40 m UP, AND THAT IS NOT A CONVENIENCE. The first version of
  // this leg ran at ground level and measured 2.778 m/s after 2 s of a 1.5
  // m/s^2 thrust instead of 3.0, i.e. 0.148 s of thrust simply missing. The
  // cause was the player SCRAPING ALONG THE HILLSIDE: resting on terrain with
  // no weight, every tick still goes through the ground snap, `climbGate` and
  // `slopeGate`, and a horizontal push across real relief loses some of itself
  // to all three. That is correct behaviour for a body in contact with a slope
  // and it is not what "thrust in vacuum" means, so the measurement was in the
  // wrong place rather than the model being wrong.
  of.gravityScale(0);
  const rHome = len(home0);
  const upAt = (h) => [home0[0] / rHome * (rHome + h), home0[1] / rHome * (rHome + h),
    home0[2] / rHome * (rHome + h)];
  const free = upAt(40);
  of.standAt(free[0], free[1], free[2]);
  await settle(1.0);
  const g2 = of.weight();
  if (g2.grounded || g2.onDeck) {
    return fail('Z2: the free-space site is touching something', { g2 });
  }
  if (!g2.floating) return fail('Z2: gravity is zero and the walker is not floating', { g2 });
  const thrust = await sample(2.0, ['KeyW'], 0.5);
  const drift = await sample(4.0, [], 1.0);
  // EVERY SPEED HERE IS A CHUNK AVERAGE, WHICH IS NOT THE SPEED AT THE END OF
  // THE CHUNK, and the first version of this leg compared one to the other and
  // called a correct 1.5 m/s^2 a failure. Under constant acceleration the mean
  // over [t-c, t] is the instantaneous value at the MIDPOINT, so the last thrust
  // chunk must average `a * (secs - chunk/2)` and not `a * secs`.
  const a = of.weight().thrustAccel;
  const lastThrust = thrust[thrust.length - 1].speed;
  // The mean over the LAST chunk is the instantaneous value at its MIDPOINT,
  // and both the leg length and the chunk length are the measured tick counts.
  const lastChunkS = thrust[thrust.length - 1].secs;
  const predictedMeanMps = a * (thrust.secs - lastChunkS / 2);
  // The harness's own quantum again (Z0): one fixed tick more or fewer in a
  // chunk moves a mean speed by v/60, and the drift column oscillates by
  // exactly that. It is a bound, not a fudge, and it is derived not tuned.
  const quantum = (v) => v / 60 + 1e-9;
  const Z2 = {
    apparentG: r6(g2.apparentG),
    thrustSpeeds: thrust.map((q) => r6(q.speed)),
    driftSpeeds: drift.map((q) => r6(q.speed)),
    thrustAccel: a,
    thrustTicks: thrust.ticks, thrustSecs: r6(thrust.secs),
    predictedMeanMps: r6(predictedMeanMps),
    thrustErrMps: r6(lastThrust - predictedMeanMps),
    terminalMps: r6(a * thrust.secs),
    // THE MOMENTUM CLAIM: drift against drift. Comparing the coast to the last
    // THRUST chunk (as the first version did) reads 1.14 and looks like the
    // player speeding up, because a mean under acceleration lags the terminal
    // speed. Coast-to-coast has no such lag in it.
    // THE FIRST DRIFT CHUNK IS EXCLUDED AND SAID SO. It straddles the tape
    // switch, so it contains the tail of the thrust and is not a coast at all;
    // including it reads 0.047 m/s of "loss" that is entirely the changeover.
    // Chunks 2 onward are pure coast and are the claim.
    driftAllMps: drift.map((q) => r6(q.speed)),
    coastFirstMps: drift[1].speed,
    coastLastMps: drift[drift.length - 1].speed,
    driftLostMps: r6(drift[1].speed - drift[drift.length - 1].speed),
  };
  log.push({ Z2 });
  if (Math.abs(Z2.thrustErrMps) > quantum(lastThrust)) {
    return fail('Z2: held thrust did not accelerate at thrustAccel', Z2);
  }
  if (Math.abs(Z2.driftLostMps) > quantum(drift[1].speed)) {
    return fail('Z2: the walker lost speed while coasting in vacuum, so the '
      + 'command is still a servo', Z2);
  }

  // =====================================================================
  // Z3. THE RADIAL AXIS EXISTS NOW. Space is out, Shift is in. Z1b measured
  //     that the old model has NO such axis at all, which is the structural
  //     half of "it needs a separate controller".
  // =====================================================================
  //     THE DESCENT IS ASSERTED ON THE RADIAL RATE, NOT ON NET DISPLACEMENT.
  //     Shift is a thrust, so it must first cancel the 3 m/s the Space leg
  //     left before it can move anybody downward: over 4 s from +3 m/s at
  //     1.5 m/s^2 the net displacement is exactly ZERO and the velocity is
  //     -3 m/s. A net-displacement assertion would have called a perfectly
  //     working descent a failure, which is Z1b's confound wearing the other
  //     hat -- there the instrument mistook a jump for authority, here it
  //     would have mistaken authority for nothing.
  const rBase = len(feet());
  const upS = await sample(2.0, ['Space'], 0.5);
  const rUp = len(feet());
  const dnS = await sample(4.0, ['ShiftLeft'], 0.5);
  const rateOf = (ss, i) => (ss[i].r - ss[i - 1].r) / 0.5;
  const Z3 = {
    upGainedM: r6(rUp - rBase),
    upRateEndMps: r6(rateOf(upS, upS.length - 1)),
    downRateEndMps: r6(rateOf(dnS, dnS.length - 1)),
    netOverDownLegM: r6(len(feet()) - rUp),
    upSamples: upS.map((q) => r6(q.r - rBase)),
    downSamples: dnS.map((q) => r6(q.r - rUp)),
  };
  log.push({ Z3 });
  if (!(Z3.upGainedM > 1.0)) return fail('Z3: Space did not lift the floating player', Z3);
  if (!(Z3.upRateEndMps > 0.5)) return fail('Z3: Space produced no sustained rise', Z3);
  if (!(Z3.downRateEndMps < -0.5)) {
    return fail('Z3: Shift never reversed the radial velocity, so there is no '
      + 'descent authority', Z3);
  }

  // =====================================================================
  // Z4. THE STATION, POWERED: gravity is restored EXACTLY. Not "close to":
  //     the two full-weight deltas are -carrierG and +carrierG and cancel to
  //     exactly 0.0, so this is an `===` and it would catch anyone giving the
  //     generator a magnitude of its own.
  // =====================================================================
  of.gravityScale(1);
  of.stationGravity(true);
  const st = of.station();
  if (st === null) return fail('Z4: no station record (run without --station=0)');
  const P = st.pos, dR = st.deckR;
  const u = [P[0] / dR, P[1] / dR, P[2] / dR];
  const at = (h) => [u[0] * (dR + h), u[1] * (dR + h), u[2] * (dR + h)];
  const hub = at(0.5);
  of.standAt(hub[0], hub[1], hub[2]);
  await settle(2.5);
  const w4 = of.weight();
  const Z4 = {
    carrierG: r6(w4.station?.carrierG ?? NaN),
    trueG: w4.trueG, apparentG: w4.apparentG,
    restoredExactly: w4.restoredExactly,
    floating: w4.floating, grounded: w4.grounded, onDeck: w4.onDeck,
    volumes: w4.volumes, inVolumes: w4.inVolumes.map((v) => v.mode + (v.powered ? '' : ':off')),
    freefallHalfM: w4.station?.freefallHalfM ?? null,
  };
  log.push({ Z4 });
  if (!Z4.restoredExactly || Z4.apparentG !== Z4.trueG) {
    return fail('Z4: a powered generator did not restore gravity bit-exactly', Z4);
  }
  if (Z4.floating || !Z4.grounded || !Z4.onDeck) {
    return fail('Z4: the player is not standing on the powered deck', Z4);
  }
  if (Z4.inVolumes.length !== 2) return fail('Z4: expected both volumes at the hub', Z4);

  // =====================================================================
  // Z5. THE STATION, UNPOWERED: weightless, and the RESIDUAL IS THE TIDAL
  //     DIFFERENCE, predicted rather than tolerated. The feet stand 0.5 m
  //     above the station centre, so what is left after the cancellation is
  //     g(r_feet) - g(r_station), and asserting a bare epsilon here would
  //     call correct physics a defect -- which is exactly what `stationwalk`
  //     P4 learned about d^2/2R, three times now in two days.
  // =====================================================================
  of.stationGravity(false);
  await settle(1.5);
  const w5 = of.weight();
  const rFeet = w5.r;
  const predicted = of.gravity(rFeet) - of.gravity(dR);
  const Z5 = {
    apparentG: w5.apparentG, trueG: w5.trueG,
    predictedTidalG: predicted,
    tidalErr: r6(w5.apparentG - predicted),
    feetAboveCentreM: r6(rFeet - dR),
    floating: w5.floating, grounded: w5.grounded, onDeck: w5.onDeck,
    floatG: w5.floatG,
    inVolumes: w5.inVolumes.map((v) => v.mode + (v.powered ? '' : ':off')),
  };
  log.push({ Z5 });
  if (w5.apparentG !== predicted) {
    return fail('Z5: the unpowered residual is not exactly the tidal difference, '
      + 'so something other than the carrier term is moving gravity', Z5);
  }
  if (!Z5.floating) return fail('Z5: an unpowered station did not make the player float', Z5);
  if (Math.abs(Z5.apparentG) >= Z5.floatG) {
    return fail('Z5: the tidal residual is not comfortably inside the float gate', Z5);
  }
  if (Z5.grounded) return fail('Z5: a weightless player reported grounded', Z5);
  if (!Z5.onDeck) return fail('Z5: the deck stopped being reported under the feet', Z5);

  //     THE TIDAL TERM, SOMEWHERE IT IS NOT ZERO. On the deck the feet sit at
  //     exactly `deckR` (the station's local y = 0 IS its own centre radius),
  //     so `g(feet) - g(centre)` is identically 0 and the assertion above,
  //     while exact, exercises nothing. 100 m radially out -- still inside the
  //     freefall box -- it is a real number, and its SIGN is the interesting
  //     part: above the centre of a freefalling frame the residual points
  //     OUTWARD, which is why a loose object drifts away from a station rather
  //     than settling onto it. This is microgravity being modelled rather than
  //     rounded to zero.
  const hi = [u[0] * (dR + 100), u[1] * (dR + 100), u[2] * (dR + 100)];
  const wHi = of.weight(hi[0], hi[1], hi[2]);
  // PREDICTED AT THE RADIUS THE FIELD ACTUALLY SAW, `wHi.r`, and NOT at the
  // `dR + 100` this probe asked for. They differ in the last bit, because the
  // point was built by normalising `pos` and scaling back up, and `hypot` of
  // that round trip is not bit-identical to the number that went in. Predicting
  // from `dR + 100` reads an error of 8.88e-16 which belongs entirely to the
  // instrument re-deriving its own input. The rule generalises: ask the system
  // where it thinks it is before predicting what it should feel there.
  const tidalPredicted = of.gravity(wHi.r) - of.gravity(dR);
  const Z5b = {
    atM: 100,
    apparentG: wHi.apparentG,
    predictedTidalG: tidalPredicted,
    errG: wHi.apparentG - tidalPredicted,
    outward: wHi.apparentG < 0,
    stillInsideFreefall: wHi.inVolumes.some((v) => v.mode === 'freefall'),
    belowFloatGate: Math.abs(wHi.apparentG) < wHi.floatG,
  };
  log.push({ Z5b });
  if (Z5b.errG !== 0) {
    return fail('Z5b: the residual 100 m up is not exactly the tidal difference', Z5b);
  }
  if (!Z5b.outward || !Z5b.stillInsideFreefall || !Z5b.belowFloatGate) {
    return fail('Z5b: the tidal residual has the wrong sign, the wrong place or '
      + 'the wrong size', Z5b);
  }

  // =====================================================================
  // Z6. THE STICKY DECK. A player resting on a floor with no weight must be
  //     able to push off it. The floor snap zeroes vUp every tick and would
  //     have pinned them there for ever; this is the negative control for
  //     that, and it was found by reading rather than by playing.
  // =====================================================================
  const rRest = len(feet());
  const off = await sample(2.0, ['Space'], 0.5);
  const offS = off.map((q) => r6(q.r - rRest));
  const Z6 = {
    restR: r6(rRest), leftM: r6(len(feet()) - rRest),
    samples: offS,
    plateauM: r6(offS[offS.length - 1] - offS[offS.length - 2]),
    onDeckAtEnd: of.weight().onDeck,
    // 0.85 m is not a coincidence and it is not this probe's number: it is the
    // 2.5 m authored headroom less the capsule's 1.65 m top sample, which
    // SpaceStation.ts writes down in advance ("contact at feet 0.85 m, which is
    // 2.5 minus the 1.65 m top sample"). Reported rather than asserted, because
    // the Blender lane is changing that headroom to ~4.0 m and this figure must
    // be free to follow the asset. What IS asserted is asset-independent.
    authoredCeilingPredictionM: 0.85,
  };
  log.push({ Z6 });
  if (!(Z6.leftM > 0.5)) {
    return fail('Z6: a weightless player could not push off the deck they were '
      + 'resting on, so the floor is a magnet', Z6);
  }
  // THE CEILING HELD. Under weight a player meets a ceiling only at a jump
  // apex; in freefall they arrive at one under sustained thrust every time they
  // press Space, so R48's "no ceiling authority" stops being an edge case. If
  // the overhead proxy leaked, this rise would not plateau -- it would run on.
  if (!(Math.abs(Z6.plateauM) < 0.01)) {
    return fail('Z6: the rise never stopped, so nothing overhead held the '
      + 'player and the ceiling leaked (R48)', Z6);
  }

  // =====================================================================
  // Z7. CONTACT IS INELASTIC, WHICH IS THE WHOLE OF "HOW DO YOU STOP".
  //     Drift into the hub wall and require the speed to be taken, radial
  //     included. No grab key, no authored handrail.
  // =====================================================================
  of.standAt(hub[0], hub[1], hub[2]);
  await settle(1.0);
  const A = st.axes;
  const dotv = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const east = (() => {
    const e = [u[2], 0, -u[0]]; const l = len(e);
    return l < 1e-9 ? [1, 0, 0] : [e[0] / l, e[1] / l, e[2] / l];
  })();
  const north = [u[1] * east[2] - u[2] * east[1], u[2] * east[0] - u[0] * east[2],
    u[0] * east[1] - u[1] * east[0]];
  // Aim at the SOLID -Z hub wall, which is the one with no doorway in it.
  const backAxis = [-A.along[0], -A.along[1], -A.along[2]];
  of.look(Math.atan2(dotv(backAxis, east), dotv(backAxis, north)) * 180 / Math.PI, 0);
  const into = await sample(6.0, ['KeyW'], 0.5);
  const Z7 = {
    speeds: into.map((q) => r6(q.speed)),
    endSpeed: r6(into[into.length - 1].speed),
    peakSpeed: r6(Math.max(...into.map((q) => q.speed))),
    blocked: of.world().player.blockedByBuild,
    acrossM: r6(dotv([feet()[0] - P[0], feet()[1] - P[1], feet()[2] - P[2]], A.along)),
  };
  log.push({ Z7 });
  if (!(Z7.peakSpeed > 1.0)) return fail('Z7: the player never got moving', Z7);
  if (!(Z7.endSpeed < 0.05)) {
    return fail('Z7: hitting the wall did not stop the drifting player', Z7);
  }
  if (Z7.acrossM < -(6 + 0.31)) return fail('Z7: the player left through the hub wall', Z7);

  // =====================================================================
  // Z8. EVA, AND ITS NEGATIVE CONTROL. 30 m off the hull is inside the
  //     freefall region and must FLOAT; 200 m is outside it and must FALL.
  //     The second is `stationwalk.js` P3's site, so that control still
  //     holds and now proves two things: no deck AND no frame.
  // =====================================================================
  const sideAt = (m) => {
    const s3 = [P[0] + A.across[0] * m, P[1] + A.across[1] * m, P[2] + A.across[2] * m];
    const l = len(s3);
    return [s3[0] / l * dR, s3[1] / l * dR, s3[2] / l * dR];
  };
  const near = sideAt(30);
  of.standAt(near[0], near[1], near[2]);
  const evaNear = await sample(3.0, [], 1.0);
  const wNear = of.weight();
  const far = sideAt(200);
  of.standAt(far[0], far[1], far[2]);
  const evaFar = await sample(3.0, [], 1.0);
  const Z8 = {
    nearFloating: wNear.floating, nearApparentG: wNear.apparentG,
    nearDriftM: r6(Math.abs(evaNear[evaNear.length - 1].r - dR)),
    nearInVolumes: wNear.inVolumes.map((v) => v.mode),
    farFellM: r6(dR - evaFar[evaFar.length - 1].r),
    farFloating: of.weight().floating,
    predictedFarFallM: r6(0.5 * of.gravity(dR) * 9),
  };
  log.push({ Z8 });
  if (!Z8.nearFloating) {
    return fail('Z8: an EVA 30 m off the hull did not float, so leaving the '
      + 'station is still a fall', Z8);
  }
  if (!(Z8.nearDriftM < 0.01)) {
    return fail('Z8: a floating EVA with no input did not stay put', Z8);
  }
  if (Z8.farFloating) return fail('Z8: the 200 m control floated, so the freefall '
    + 'region is larger than stationwalk P3 assumes', Z8);
  if (!(Z8.farFellM > 5)) return fail('Z8: the 200 m control did not fall', Z8);

  await back();
  return {
    ok: true,
    Z0, Z1a, Z1b, Z2, Z3, Z4, Z5, Z5b, Z6, Z7, Z8,
    verdict: {
      oldModelStopsDead: Z1b.stoppedDead,
      oldModelHasNoDescentAxis: Z1b.noDescentAxis,
      newModelKeepsMomentum: Math.abs(Z2.driftLostMps) < 0.05,
      poweredIsBitExact: Z4.restoredExactly,
      unpoweredIsTidal: Z5.tidalErr === 0,
    },
    log,
  };
})()
