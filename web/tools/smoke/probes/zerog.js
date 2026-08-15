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
  for (const k of ['weight', 'gravityScale', 'stationGravity', 'standAt', 'station',
    'standAboard', 'carrier', 'gravity', 'solidBuild']) {
    if (typeof of[k] !== 'function') return { fail: `no __of.${k}: rebuild` };
  }
  const home0 = of.world().player.feet.slice();
  const feet = () => of.world().player.feet.slice();

  // =======================================================================
  // CE-103. THE MEASUREMENT FRAME FOLLOWS THE RIDER, AND EVERYTHING FROM Z4
  //         ON IS TAKEN ABOARD.
  // =======================================================================
  //
  // Z0 TO Z3 ARE UNTOUCHED AND MUST STAY THAT WAY. They run on the ground and
  // in free space with nothing boarded, `ridingNow()` is null throughout, and
  // every number they report is the body-frame finite difference this file's
  // header describes. `mpos()` returns the feet in that case, so the
  // arithmetic below is the arithmetic that was already here.
  //
  // Z4 ONWARD IS THE STATION, AND ON THE STATION THE BODY FRAME IS THE WRONG
  // RULER. Anchorage travels at 1879.2552 m/s, so a rider correctly standing
  // still on its deck moves 31.32 m per tick in the body frame: measured in
  // this run, 1.0 s of standing still is 0.000000 m of local drift against
  // 1,879 m of body-frame drift. Reporting the second as a "speed" is what
  // CE-54 refused to let `standAt` decide silently, and the answer it named is
  // the one taken here: the probe SAYS which frame it is measuring in, and the
  // station legs say the carrier's.
  //
  // `of.carrier('local')` is the rider's position in the carrier frame, which
  // is a RIGID transform of the body frame, so a distance measured in it is a
  // real physical distance and not a rescaled one. Its +Y is the radial
  // (verified in this run: a 0.19375 m rise in local y arrived as a 0.193758 m
  // rise in |feet|), which is why Z3's and Z6's radial columns survive the
  // move unchanged.
  const ridingNow = () => {
    const m = of.carrier('mounts');
    return m !== null && m.rider !== null && m.rider !== undefined
      ? m.rider.carrier : null;
  };
  const localNow = () => {
    const c = of.carrier('local');
    return c !== null && Array.isArray(c.local) ? c.local.slice() : null;
  };
  /** The position this run's speeds are finite differences OF. */
  const mpos = () => localNow() ?? feet();

  /**
   * CE-103. THE LIVE STATION, FETCHED AND SPENT WITH NO `await` IN BETWEEN.
   *
   * CE-46's rule, and this file used to break it in the worst possible place:
   * `st` was read ONCE before Z4 and its `pos`/`axes`/`deckR` were then used to
   * build Z5b's sample point, Z7's aim and Z8's two EVA sites, tens of seconds
   * and hundreds of kilometres of orbit later. Every caller below refetches.
   */
  const stationNow = () => {
    const s = of.station();
    if (s === null) return null;
    const P = s.pos; const dR = s.deckR;
    return { s, P, dR, A: s.axes, el: s.el,
      u: [P[0] / dR, P[1] / dR, P[2] / dR] };
  };

  // Every leg restores the world it borrowed: gravity back to 1, the station's
  // generator back on, the player back on the ground. run.mjs settles on
  // terrain convergence and a walker parked 400 km up never lets it exit
  // (PH-89), and a probe that leaves gravity at zero poisons the next one.
  //
  // CE-103. AND IT LETS GO OF THE STATION FIRST. `standAt` does not release a
  // rider (it is a position verb, not a frame one), so returning to the ground
  // while still holding Anchorage's frame would run one more `CarrierRide.tick`
  // with the walker 400 km off the frame origin, which transports it by the
  // frame's full per-tick motion before the membership rule gets its say.
  const back = async () => {
    of.input.tape([{ hold: 60, keys: [] }]);
    of.gravityScale(1);
    of.stationGravity(true);
    of.carrier('release');
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
   * Drive `keys` for `secs`, sampling POSITION every `chunk` seconds.
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
   *
   * (3) CE-103. AND IT IS A DIFFERENCE OF `mpos()`, NOT OF `feet()`. Off a
   *     carrier those are the same array and nothing changes. Aboard one they
   *     differ by the carrier's whole orbital speed, and the body-frame
   *     reading is not a speed the player has: it is Anchorage's.
   */
  const sample = async (secs, keys, chunk = 0.25) => {
    const out = [];
    const n = Math.max(1, Math.round(secs / chunk));
    of.input.tape([{ hold: Math.ceil(secs * 60) + 180, keys }]);
    let prev = mpos();
    let prevBody = feet();
    let prevTick = of.world().tick;
    let ticks = 0;
    for (let i = 0; i < n; ++i) {
      await of.run(chunk, 60);
      await yield0();
      const f = feet();
      const m = mpos();
      const w = of.weight();
      const tk = of.world().tick;
      const dTicks = tk - prevTick;
      ticks += dTicks;
      out.push({
        t: r6((i + 1) * chunk), ticks: dTicks, secs: r6(dTicks / 60),
        speed: dTicks === 0 ? 0 : dist(m, prev) / (dTicks / 60),
        // The body-frame reading is kept BESIDE the frame-relative one rather
        // than dropped, because their ratio is the evidence that the frame
        // term is doing something: 0 against 1,879 m/s is a carried rider and
        // 1,879 against 1,879 is a probe measuring the orbit.
        bodySpeed: dTicks === 0 ? 0 : dist(f, prevBody) / (dTicks / 60),
        r: len(f), feet: f, local: localNow(),
        floating: w.floating, grounded: w.grounded, onDeck: w.onDeck,
        apparentG: w.apparentG,
      });
      prev = m; prevBody = f; prevTick = tk;
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
  //
  // CE-100. HOW THIS LEG GETS ONTO THE DECK, AND WHY IT USED TO GET NOWHERE.
  //
  // It used to say `of.standAt(hub, { frame: 'body' })`, and it was HONESTLY
  // RED for a year of lane-days because of it (GP-805 measured the mechanism:
  // `of.carrier('mounts').boarding` read `tested: 137, boarded: 0`, the walker
  // sat at a fixed absolute point, and over this leg's own 2.5 s settle
  // Anchorage took the deck and both gravity volumes 4,698 m away, leaving
  // `grounded: false, onDeck: false, inVolumes: []`).
  //
  // THE CONTRACT, DECIDED HERE AND WRITTEN UP IN core-engine.md 5m:
  //
  //   `standAt` NAMES A POINT IN THE BODY FRAME AND NEVER BOARDS, in either
  //   frame. Its argument is an absolute coordinate, which on a carrier is
  //   stale the instant it is computed; boarding is a velocity match against a
  //   LIVE pose, and this verb has no live pose. `{ frame: 'body' }` therefore
  //   keeps meaning exactly what its name says and is NOT extended into a
  //   second door onto the deck: it is the one honest way to ask for the
  //   defect, which is what a negative control is, and Z4neg below is that
  //   control.
  //
  //   `standAboard(lx, ly, lz)` IS THE WAY ABOARD, and it takes the STATION'S
  //   OWN AUTHORED LOCAL FRAME so the point cannot go stale. With no arguments
  //   it drives the shipped arrival (`seatOnStationDeck`, the same function the
  //   `visit:station` row presses, scanning the asset's `socket_hall` for
  //   clearance), which is what this leg now uses: the deck a player actually
  //   arrives on rather than a second spelling of it.
  //
  // AND `at(0.5)` WAS THE WRONG POINT EVEN WITH THE RIGHT VERB. GP-400
  // measured it: station-local (0, 0.5, 0) is INSIDE `col_HallCore`, a solid
  // column x and z in [-1.548, 1.548] and 5.4 m tall, and `resolveStep` lets a
  // body already inside a solid move freely, so Z6's push-off ran with no
  // collision at all. `socket_hall` is (0, 0, 4) in the same frame, clear of
  // the column by 2.45 m, and it is the asset's own answer to the question
  // rather than this probe's.
  of.gravityScale(1);
  of.stationGravity(true);
  const st0 = stationNow();
  if (st0 === null) return fail('Z4: no station record (run without --station=0)');

  // ---------------------------------------------------------------------
  // Z4neg. THE NEGATIVE CONTROL, AND IT IS THE DEFECT ITSELF, ON PURPOSE.
  //
  // GP-142's rule cuts both ways in this file: Z4's green must be unreachable
  // by accident, and the cheapest proof of that is to run the SAME leg the
  // wrong way first and watch it fail. `{ frame: 'body' }` is asked for by
  // name, at the same 0.5 m above the station's own centre this leg used to
  // aim at, and the reading it produces is the one CE-54 was written about.
  //
  // CE-101 is what makes it assertable rather than merely observable: the body
  // frame path now reports the carrier it landed inside and its depth, and
  // `boarded: false` says out loud that no `standAt` ever boards. Before that
  // this control could only have been a comment.
  const hubNeg = [st0.u[0] * (st0.dR + 0.5), st0.u[1] * (st0.dR + 0.5),
    st0.u[2] * (st0.dR + 0.5)];
  const negSeat = of.standAt(hubNeg[0], hubNeg[1], hubNeg[2], { frame: 'body' });
  const negTick0 = of.world().tick;
  await settle(2.5);
  const negTick1 = of.world().tick;
  const wNeg = of.weight();
  const stNeg = stationNow();
  const negFeet = feet();
  // PREDICTED, NOT TOLERATED. The station's own `speedMps` over the measured
  // tick count is an ARC; what `dist` measures is the CHORD it subtends about
  // the planet's centre, and at 4.7 km over a 1,000 km radius the two differ
  // by 4.3 mm, which is larger than the assertion would otherwise care about.
  // The walker also falls radially while it is left behind (ordinary gravity
  // on a body no volume reaches), so the two legs are combined as the right
  // triangle they are.
  const negArcM = stNeg.s.speedMps * ((negTick1 - negTick0) / 60);
  const negChordM = 2 * stNeg.dR * Math.sin(negArcM / (2 * stNeg.dR));
  const negFellM = (st0.dR + 0.5) - len(negFeet);
  const Z4neg = {
    askedFrame: 'body',
    carrier: negSeat.carrier,
    depthM: r6(negSeat.depthM),
    boarded: negSeat.boarded,
    riding: ridingNow(),
    grounded: wNeg.grounded, onDeck: wNeg.onDeck,
    inVolumes: wNeg.inVolumes.map((v) => v.mode),
    ticks: negTick1 - negTick0,
    leftBehindM: r6(dist(negFeet, stNeg.P)),
    predictedLeftBehindM: r6(Math.hypot(negChordM, negFellM)),
    fellM: r6(negFellM),
    boundM: r6(-negSeat.depthM),
  };
  Z4neg.leftBehindErrM = r6(Z4neg.leftBehindM - Z4neg.predictedLeftBehindM);
  log.push({ Z4neg });
  if (Z4neg.carrier === null || Z4neg.boarded !== false) {
    return fail('Z4neg: standAt did not report the carrier it seated inside, so '
      + 'the body-frame path is silent again and this control cannot be read '
      + '(CE-101)', Z4neg);
  }
  if (Z4neg.riding !== null) {
    return fail('Z4neg: standAt boarded the walker. It must never board in '
      + 'either frame; that is standAboard\'s job and the whole CE-100 '
      + 'contract', Z4neg);
  }
  if (Z4neg.onDeck || Z4neg.inVolumes.length !== 0) {
    return fail('Z4neg: the un-boarded control was still on the deck after the '
      + 'settle, so the station is not moving and every number below is being '
      + 'taken on a frozen fixture (GP-142)', Z4neg);
  }
  if (Math.abs(Z4neg.leftBehindErrM) > 1.0) {
    return fail('Z4neg: the distance the deck left the control behind is not '
      + 'the station\'s own speed times the elapsed ticks, so something other '
      + 'than the orbit moved one of them', Z4neg);
  }

  // ---------------------------------------------------------------------
  // Z4. AND NOW THE SAME LEG, ABOARD.
  const seat = of.standAboard();
  if (seat === null || seat.error !== undefined) {
    return fail('Z4: standAboard could not seat the walker', { seat });
  }
  await settle(2.5);
  const w4 = of.weight();
  // Fetched AFTER the settle, not reused from `st0` above: `deckR` is a live
  // Kepler solve and the point is to catch `installStationGravity` aiming at a
  // radius that has drifted from the one this tick's field was built with, not
  // to compare against a snapshot that is itself now stale.
  const stAtSample = stationNow();
  const predictedCarrierG = stAtSample === null ? NaN : of.gravity(stAtSample.dR);
  // ---------------------------------------------------------------------
  // CARRIED, MEASURED IN BOTH FRAMES OVER THE SAME SECOND.
  //
  // This is the assertion that says the rider is GENUINELY aboard rather than
  // merely standing somewhere that happens to read green this instant, and it
  // is a ratio so that neither half can be the identity element: local drift
  // must be ~0 AND body drift must be the station's whole orbital travel. A
  // frozen station would pass the first and fail the second; an un-boarded
  // walker fails the first.
  const carr0 = localNow();
  const body0 = feet();
  const cTick0 = of.world().tick;
  await settle(1.0);
  const carr1 = localNow();
  const body1 = feet();
  const cTick1 = of.world().tick;
  const cArcM = stAtSample.s.speedMps * ((cTick1 - cTick0) / 60);
  const Z4 = {
    seatScannedM: seat.scannedM, seatClear: seat.clear,
    seatDeckDepthM: r6(seat.deckDepthM),
    carrier: seat.carrier, riding: ridingNow(),
    carrierG: r6(w4.station?.carrierG ?? NaN),
    predictedCarrierG: r6(predictedCarrierG),
    trueG: w4.trueG, apparentG: w4.apparentG,
    restoredExactly: w4.restoredExactly,
    floating: w4.floating, grounded: w4.grounded, onDeck: w4.onDeck,
    volumes: w4.volumes, inVolumes: w4.inVolumes.map((v) => v.mode + (v.powered ? '' : ':off')),
    freefallHalfM: w4.station?.freefallHalfM ?? null,
    carriedTicks: cTick1 - cTick0,
    localDriftM: carr0 === null || carr1 === null ? null : dist(carr0, carr1),
    bodyDriftM: r6(dist(body0, body1)),
    predictedBodyDriftM: r6(2 * stAtSample.dR * Math.sin(cArcM / (2 * stAtSample.dR))),
    // CE-102. THE RULE'S COUNTERS, REPORTED AND DELIBERATELY NOT ASSERTED ON.
    // `boarded` stays 0 through a perfectly boarded run, because `standAboard`
    // seats through `CarrierRide.board` and the per-tick rule then finds a
    // rider that already holds a frame. `rider` is the number that answers
    // "is anyone aboard"; this pair is here so the next reader of GP-805's
    // `tested: 137, boarded: 0` sees the same shape in a HEALTHY world.
    ruleBoarding: of.carrier('mounts').mounts.boarding,
    rideReport: of.carrier('mounts').rider,
  };
  Z4.bodyDriftErrM = r6(Z4.bodyDriftM - Z4.predictedBodyDriftM);
  log.push({ Z4 });
  if (Z4.riding !== 'station:anchorage') {
    return fail('Z4: standAboard did not leave the walker riding the station\'s '
      + 'frame', Z4);
  }
  if (Z4.seatClear !== true) {
    return fail('Z4: the arrival socket is not clear of the station\'s own '
      + 'colliders, so this leg is measuring a walker inside a wall (CE-49)', Z4);
  }
  if (!Z4.restoredExactly || Z4.apparentG !== Z4.trueG) {
    return fail('Z4: a powered generator did not restore gravity bit-exactly', Z4);
  }
  if (Z4.floating || !Z4.grounded || !Z4.onDeck) {
    return fail('Z4: the player is not standing on the powered deck', Z4);
  }
  if (Z4.inVolumes.length !== 2) return fail('Z4: expected both volumes at the hub', Z4);
  // THE RIDE ITSELF. A rider at rest in the carrier's frame stays at rest in
  // it, in f64, at a radius of 1e6 m: `CarrierRide`'s own invariant, measured
  // at 1.6e-9 m over 600 ticks by `probes/stationride.js`. 1e-6 m over 60
  // ticks is that bound with three orders of headroom, and it is a derived
  // number rather than a tuned one: the transport is one quaternion round trip
  // per tick at 1e6 m, i.e. ~1e-9 m of representable resolution per tick.
  if (!(Z4.localDriftM < 1e-6)) {
    return fail('Z4: the rider drifted in the carrier\'s own frame while '
      + 'standing still, so it is not really being carried', Z4);
  }
  // ...AND THE FRAME IS REALLY MOVING WHILE IT DOES. Without this the line
  // above is satisfied by a frozen station, which is exactly the fixture every
  // one of these numbers was originally taken on (CE-45).
  if (!(Z4.bodyDriftM > 1000) || Math.abs(Z4.bodyDriftErrM) > 1.0) {
    return fail('Z4: standing still on the deck did not move the walker through '
      + 'the body frame by the station\'s own orbital travel, so the carrier '
      + 'is frozen and the local-drift assertion above is vacuous', Z4);
  }
  // THE DISCRIMINATING QUANTITY (GP-805). `restoredExactly` alone cannot tell
  // "the generator cancelled trueG" from "carrierG is 0 and neither term did
  // anything", because both leave delta at exactly 0.0. `carrierG` itself is
  // the one number that is different between those two worlds, so it is
  // compared against an independently fetched ground truth rather than merely
  // logged.
  if (!(w4.station?.carrierG > 0)) {
    return fail('Z4: carrierG is not a positive magnitude, so restoredExactly '
      + 'is true because nothing is being cancelled rather than because it '
      + 'cancelled', Z4);
  }
  // CE-104. AND THE COMPARISON IS A BAND THE ORBIT DERIVES, NOT AN `===`.
  //
  // GP-805 wrote this as `carrierG !== predictedCarrierG` and it was never
  // reached, because Z4 died four lines above it. Reached, it fails: measured
  // 3.5315999999999974 installed against 3.5315999999999983 fetched, 9e-16
  // apart. That is not a wiring defect, it is the design saying something:
  // `installAndMountStation` calls `installStationGravity(volumes, st.pos,
  // gravityAccel(st.deckR))` ONCE, so the generator's MAGNITUDE is frozen at
  // the install tick and only its POSE follows the frame. The live `deckR` a
  // probe fetches later is a different point on the conic.
  //
  // So the honest bound is the conic's own radius band times the field's own
  // gradient. Anchorage is authored circular and `e` is 5.27e-16, i.e. a band
  // `a*e` wide either side of `a`; `dg/dr` is `-2g/r`. Plus a few ulps of g
  // for the two `hypot`-and-divide round trips that produce each radius. The
  // check still catches everything GP-805 aimed it at -- a zero, a stale
  // kilometre, a hand-tuned magnitude -- by eleven orders of magnitude.
  const el4 = stAtSample.el;
  const bandM = el4 === null ? 0 : Math.abs(el4.a * el4.e);
  const carrierGBand = (2 * predictedCarrierG / stAtSample.dR) * bandM
    + 8 * Number.EPSILON * predictedCarrierG;
  Z4.carrierGErr = w4.station.carrierG - predictedCarrierG;
  Z4.carrierGBand = carrierGBand;
  Z4.orbitRadiusBandM = bandM;
  if (!(Math.abs(Z4.carrierGErr) <= carrierGBand)) {
    return fail('Z4: carrierG is further from of.gravity(deckR) than the '
      + 'conic\'s own radius band allows, so the generator is not cancelling '
      + 'the station\'s own freefall acceleration', Z4);
  }

  // =====================================================================
  // Z5. THE STATION, UNPOWERED: weightless, and the RESIDUAL IS THE TIDAL
  //     DIFFERENCE, predicted rather than tolerated. The feet stand a little
  //     off the station's own centre radius, so what is left after the
  //     cancellation is g(r_feet) - carrierG, and asserting a bare epsilon
  //     here would call correct physics a defect -- which is exactly what
  //     `stationwalk` P4 learned about d^2/2R, three times now in two days.
  // =====================================================================
  //
  // CE-104. PREDICTED FROM THE INSTALLED `carrierG`, NOT FROM `of.gravity
  // (deckR)`. The two differ by the band Z4 just measured, and this assertion
  // is an `===`: predicting from the fetched radius reads an error of
  // -1.8e-15, which belongs entirely to the instrument asking a different
  // question from the one the field answered. The field subtracted the number
  // it was installed with, so that is the number the prediction uses, and what
  // is left being tested -- the whole content of this row -- is that the
  // field's own true term is `PlanetBody.gravityAccel` at the radius it
  // reports. Z4 above is what pins `carrierG` itself to an outside authority,
  // so the pair together is strictly stronger than the single loose `===` was.
  of.stationGravity(false);
  await settle(1.5);
  const w5 = of.weight();
  const rFeet = w5.r;
  const carrierG5 = w5.station?.carrierG ?? NaN;
  const predicted = of.gravity(rFeet) - carrierG5;
  const st5 = stationNow();
  const Z5 = {
    apparentG: w5.apparentG, trueG: w5.trueG,
    carrierG: carrierG5,
    predictedTidalG: predicted,
    tidalErr: r6(w5.apparentG - predicted),
    feetAboveCentreM: r6(rFeet - st5.dR),
    floating: w5.floating, grounded: w5.grounded, onDeck: w5.onDeck,
    floatG: w5.floatG,
    riding: ridingNow(),
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
  if (Z5.riding !== 'station:anchorage') {
    return fail('Z5: cutting the generator threw the rider off the frame', Z5);
  }

  //     THE TIDAL TERM, SOMEWHERE IT IS NOT ZERO. On the deck the feet sit
  //     within 8e-06 m of `deckR` (the station's local y = 0 IS its own centre
  //     radius, and `socket_hall` is 4 m along the deck from the centre, which
  //     the sphere lifts by d^2/2R), so `g(feet) - carrierG` is 5.7e-11 and
  //     the assertion above, while exact, exercises almost nothing. 100 m
  //     radially out -- still inside the freefall box, whose half-height is
  //     120 m -- it is a real number, and its SIGN is the interesting part:
  //     above the centre of a freefalling frame the residual points OUTWARD,
  //     which is why a loose object drifts away from a station rather than
  //     settling onto it. This is microgravity being modelled rather than
  //     rounded to zero.
  //
  //     CE-103. AND THE POINT IS BUILT OFF THE WALKER'S OWN LIVE FEET. It used
  //     to be built off `u` and `dR`, both captured before Z4 ran; by the time
  //     this line was reached the station had travelled tens of kilometres and
  //     the sample point was in empty space, `inVolumes: []`, so this row
  //     would have gone red for a reason that had nothing to do with tides.
  const f5 = feet();
  const r5 = len(f5);
  const hi = [f5[0] / r5 * (r5 + 100), f5[1] / r5 * (r5 + 100), f5[2] / r5 * (r5 + 100)];
  const wHi = of.weight(hi[0], hi[1], hi[2]);
  // PREDICTED AT THE RADIUS THE FIELD ACTUALLY SAW, `wHi.r`, and NOT at the
  // `r5 + 100` this probe asked for. They differ in the last bit, because the
  // point was built by normalising `feet` and scaling back up, and `hypot` of
  // that round trip is not bit-identical to the number that went in. Predicting
  // from `r5 + 100` reads an error of 8.88e-16 which belongs entirely to the
  // instrument re-deriving its own input. The rule generalises: ask the system
  // where it thinks it is before predicting what it should feel there.
  const tidalPredicted = of.gravity(wHi.r) - (wHi.station?.carrierG ?? NaN);
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
  //
  // CE-103. THE RISE IS THE CARRIER FRAME'S OWN RADIAL COLUMN NOW, `local[1]`,
  // which is the same quantity `|feet|` used to carry and is immune to the
  // 1,879 m/s of tangential travel that would otherwise be in every difference
  // this leg takes. Both are reported; they agree to 6e-06 m.
  //
  // AND IT RUNS FOR 4 s AND NOT 2 s. At `socket_hall` there is real headroom
  // (measured: the rise stops at 2.65 m and holds there, bit-stably, for five
  // further seconds), where the OLD site inside `col_HallCore` had none and
  // the leg was reading a body moving freely through a solid. 2 s of a
  // governed 4.0 m/s thrust does not reach the ceiling, so the plateau this
  // row exists to detect would not have happened yet.
  const restLocal = localNow();
  const rRest = len(feet());
  const off = await sample(4.0, ['Space'], 0.5);
  const offS = off.map((q) => r6(q.local[1] - restLocal[1]));
  const Z6 = {
    restR: r6(rRest), restLocalY: r6(restLocal[1]),
    leftM: r6(localNow()[1] - restLocal[1]),
    leftRadialM: r6(len(feet()) - rRest),
    samples: offS,
    plateauM: r6(offS[offS.length - 1] - offS[offS.length - 2]),
    onDeckAtEnd: of.weight().onDeck,
    riding: ridingNow(),
    // 2.65 m is not this probe's number and it is not asserted: it is whatever
    // the shipped asset puts over `socket_hall`, and the Blender lane is free
    // to move it. The previous figure here was 0.85 m, which was the authored
    // headroom over a point INSIDE `col_HallCore` and was never a place a
    // player could stand (GP-400). What IS asserted is asset-independent.
    measuredCeilingM: r6(offS[offS.length - 1]),
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
  // AND THE RADIAL COLUMNS AGREE. The carrier frame's local +Y and the body
  // frame's radius are two independent derivations of "how far up"; they must
  // move together, or the frame's basis is not what this leg believes.
  if (Math.abs(Z6.leftM - Z6.leftRadialM) > 1e-3) {
    return fail('Z6: the carrier frame\'s local up and the body frame\'s radius '
      + 'disagree about how far the player rose, so the frame basis is not '
      + 'radial and every local reading in this file is mis-aimed', Z6);
  }

  // =====================================================================
  // Z7. CONTACT IS INELASTIC, WHICH IS THE WHOLE OF "HOW DO YOU STOP".
  //     Drift into the hub wall and require the speed to be taken, radial
  //     included. No grab key, no authored handrail.
  // =====================================================================
  // CE-100. Aboard, by the same verb as Z4, and the axes are refetched LIVE
  // for the aim: `st0.axes` is minutes old by now and the station's LVLH basis
  // has rotated with it.
  of.standAboard();
  await settle(1.0);
  const st7 = stationNow();
  const u7 = st7.u;
  const A = st7.A;
  const dotv = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const east = (() => {
    const e = [u7[2], 0, -u7[0]]; const l = len(e);
    return l < 1e-9 ? [1, 0, 0] : [e[0] / l, e[1] / l, e[2] / l];
  })();
  const north = [u7[1] * east[2] - u7[2] * east[1], u7[2] * east[0] - u7[0] * east[2],
    u7[0] * east[1] - u7[1] * east[0]];
  // Aim AFT along the spine, away from the dock end: the walk starts at
  // `socket_hall` and runs into the hall's own aft wall.
  const backAxis = [-A.along[0], -A.along[1], -A.along[2]];
  of.look(Math.atan2(dotv(backAxis, east), dotv(backAxis, north)) * 180 / Math.PI, 0);
  const from7 = localNow();
  const into = await sample(6.0, ['KeyW'], 0.5);
  const to7 = localNow();
  // CE-103. EVERYTHING GEOMETRIC ABOUT THE STOP IS TAKEN NOW, LIVE, WITH NO
  // `await` between the fetch and the last use of it.
  const st7b = stationNow();
  const fEnd = feet();
  const uEnd = [fEnd[0] / len(fEnd), fEnd[1] / len(fEnd), fEnd[2] / len(fEnd)];
  const aftEnd = [-st7b.A.along[0], -st7b.A.along[1], -st7b.A.along[2]];
  // WHAT STOPPED THE PLAYER, ASKED OF THE WALKER'S OWN PREDICATE.
  //
  // This row used to assert `acrossM >= -(6 + 0.31)`, a metre count calibrated
  // against a start point at the hub centre that GP-400 showed was inside a
  // pillar. Re-seated at `socket_hall` the same walk legitimately ends at
  // -6.6 to -6.9 m and the old constant fires on correct behaviour. So the
  // claim is made directly instead: there is a SOLID a short way ahead of
  // where the player stopped, and open space the same distance behind, both
  // read from `of.solidBuild`, which is the walker's own collision predicate
  // rather than a parallel test written in this probe. A player who left
  // through the wall has vacuum on both sides and fails the first half; a
  // player who never moved has the wall behind them too and fails the second.
  //
  // IT IS A SCAN AND NOT A SINGLE SAMPLE, AND THE FIRST DRAFT'S FAILURE IS THE
  // REASON. One probe at 0.6 m read FALSE against a wall that is really there:
  // `col_JambMouthAftR` is 0.30 m thick (x in [-7.3148, -7.0148]) and 0.6 m
  // ahead of the feet is already THROUGH it and out the other side. A
  // fixed-offset sample of a thin wall measures whether the offset happens to
  // land in it, which is not the question. The scan reports the distance at
  // which it first hits, so the number is measured rather than assumed.
  const at7 = (fwd, up) => [
    fEnd[0] + aftEnd[0] * fwd + uEnd[0] * up,
    fEnd[1] + aftEnd[1] * fwd + uEnd[1] * up,
    fEnd[2] + aftEnd[2] * fwd + uEnd[2] * up];
  const firstSolidM = (sign) => {
    for (let d = 0.05; d <= 1.2001; d += 0.05) {
      if (of.solidBuild(...at7(sign * d, 1.0))) return r6(d);
    }
    return null;
  };
  const wallAheadM = firstSolidM(1);
  const wallBehindM = firstSolidM(-1);
  const solidAhead = wallAheadM !== null;
  const clearBehind = wallBehindM === null;
  const mounts7 = of.carrier('mounts');
  const hullR = mounts7.solid === null ? null : mounts7.solid.cr;
  const Z7 = {
    speeds: into.map((q) => r6(q.speed)),
    bodySpeeds: into.map((q) => r6(q.bodySpeed)),
    endSpeed: r6(into[into.length - 1].speed),
    peakSpeed: r6(Math.max(...into.map((q) => q.speed))),
    blocked: of.world().player.blockedByBuild,
    travelledM: r6(dist(from7, to7)),
    acrossM: r6(dotv([fEnd[0] - st7b.P[0], fEnd[1] - st7b.P[1], fEnd[2] - st7b.P[2]],
      st7b.A.along)),
    // Distance from the station's own centre, in the deck plane. Asserted
    // against the hull's OWN bounding radius, read off the collision solid, so
    // "did not leave through the wall" is the asset's number and not a literal.
    offCentreM: r6(Math.hypot(to7[0], to7[2])),
    hullR: r6(hullR),
    solidAhead, clearBehind, wallAheadM, wallBehindM,
    riding: ridingNow(),
  };
  log.push({ Z7 });
  if (!(Z7.peakSpeed > 1.0)) return fail('Z7: the player never got moving', Z7);
  if (!(Z7.endSpeed < 0.05)) {
    return fail('Z7: hitting the wall did not stop the drifting player', Z7);
  }
  if (!(Z7.travelledM > 3)) {
    return fail('Z7: the player stopped before it had crossed any deck, so the '
      + 'stop is not a wall', Z7);
  }
  if (!Z7.solidAhead) {
    return fail('Z7: nothing solid is in front of where the player stopped, so '
      + 'the speed was taken by something other than the hull', Z7);
  }
  if (!Z7.clearBehind) {
    return fail('Z7: the walker is in a solid on BOTH sides, so this leg is '
      + 'measuring a body embedded in geometry rather than a body meeting it '
      + '(GP-400)', Z7);
  }
  if (!(Z7.offCentreM < hullR)) {
    return fail('Z7: the player left through the hub wall', Z7);
  }
  if (Z7.riding !== 'station:anchorage') {
    return fail('Z7: the collision threw the rider off the frame', Z7);
  }

  // =====================================================================
  // Z8. EVA, AND ITS NEGATIVE CONTROL. 30 m off the hull is inside the
  //     freefall region and must FLOAT; 200 m is outside it and must FALL.
  //     The second is `stationwalk.js` P3's site, so that control still
  //     holds and now proves two things: no deck AND no frame.
  // =====================================================================
  //
  // CE-100. THE TWO SITES ARE SEATED BY DIFFERENT VERBS AND THAT IS THE WHOLE
  // OF WHAT THIS ROW NOW SAYS.
  //
  //   near, 30 m: `standAboard(0, 0, 30)`, i.e. 30 m out along the asset's own
  //   +Z, ON the frame. That is what stepping off a hull IS: you leave with
  //   the station's velocity, and the freefall volume (207.85 m bound) is
  //   still around you. A body-frame seat here would simply be Z4neg again 30
  //   m to one side, and would tell us nothing about EVA.
  //
  //   far, 200 m: RELEASED first, then a plain `standAt`. Outside the bound
  //   `standAt` does not refuse and needs no frame argument, and the explicit
  //   release is what makes the fall a fall: a rider still holding the frame
  //   400 m off its origin gets one more transport tick before the membership
  //   rule lets go, which is 31 m of teleport in the middle of the measurement.
  const near = of.standAboard(0, 0, 30);
  const near0 = localNow();
  const evaNear = await sample(3.0, [], 1.0);
  const wNear = of.weight();
  const near1 = localNow();
  const relFar = of.carrier('release');
  const st8 = stationNow();
  const sideAt = (m) => {
    const s3 = [st8.P[0] + st8.A.across[0] * m, st8.P[1] + st8.A.across[1] * m,
      st8.P[2] + st8.A.across[2] * m];
    const l = len(s3);
    return [s3[0] / l * st8.dR, s3[1] / l * st8.dR, s3[2] / l * st8.dR];
  };
  const far = sideAt(200);
  const farSeat = of.standAt(far[0], far[1], far[2]);
  const rFar0 = len(feet());
  const evaFar = await sample(3.0, [], 1.0);
  const Z8 = {
    nearLocal: near0 === null ? null : near0.map(r6),
    nearOffCentreM: near0 === null ? null : r6(len(near0)),
    nearFloating: wNear.floating, nearApparentG: wNear.apparentG,
    nearDriftM: near0 === null || near1 === null ? null : r6(dist(near0, near1)),
    nearBodyDriftM: r6(dist(evaNear[0].feet, evaNear[evaNear.length - 1].feet)),
    nearRiding: near === null ? null : near.carrier,
    nearInVolumes: wNear.inVolumes.map((v) => v.mode),
    farReleased: relFar.was,
    farRefused: farSeat.refused,
    farCarrier: farSeat.carrier,
    farRiding: ridingNow(),
    farFellM: r6(rFar0 - evaFar[evaFar.length - 1].r),
    farFloating: of.weight().floating,
    predictedFarFallM: r6(0.5 * of.gravity(st8.dR) * 9),
  };
  log.push({ Z8 });
  if (!Z8.nearFloating) {
    return fail('Z8: an EVA 30 m off the hull did not float, so leaving the '
      + 'station is still a fall', Z8);
  }
  if (!(Z8.nearDriftM < 1e-6)) {
    return fail('Z8: a floating EVA with no input did not stay put', Z8);
  }
  if (!(Z8.nearBodyDriftM > 1000)) {
    return fail('Z8: the EVA did not travel with the station through the body '
      + 'frame, so it is not floating beside a moving hull, it is floating '
      + 'beside a frozen one', Z8);
  }
  if (Z8.farRefused !== false || Z8.farRiding !== null) {
    return fail('Z8: the 200 m control is still on the frame, so its fall is '
      + 'being measured against a body the station is carrying', Z8);
  }
  if (Z8.farFloating) return fail('Z8: the 200 m control floated, so the freefall '
    + 'region is larger than stationwalk P3 assumes', Z8);
  if (!(Z8.farFellM > 5)) return fail('Z8: the 200 m control did not fall', Z8);

  await back();
  return {
    ok: true,
    Z0, Z1a, Z1b, Z2, Z3, Z4neg, Z4, Z5, Z5b, Z6, Z7, Z8,
    verdict: {
      oldModelStopsDead: Z1b.stoppedDead,
      oldModelHasNoDescentAxis: Z1b.noDescentAxis,
      newModelKeepsMomentum: Math.abs(Z2.driftLostMps) < 0.05,
      poweredIsBitExact: Z4.restoredExactly,
      unpoweredIsTidal: Z5.tidalErr === 0,
      // CE-100. The pair that makes every station row above non-vacuous: the
      // un-boarded control is left behind by the deck, and the boarded rider
      // is not, over settles of the same length in the same run.
      bodyFrameSeatIsLeftBehind: Z4neg.leftBehindM > 1000 && Z4neg.riding === null,
      riderIsCarried: Z4.localDriftM < 1e-6 && Z4.bodyDriftM > 1000,
    },
    log,
  };
})()
