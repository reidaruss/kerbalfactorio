// CE-30 to CE-37: THE CARRIER FRAME. A rider on a moving frame stays put
// relative to that frame, and the number that says it does not is 9.04 m per
// tick.
//
//   node tools/smoke/run.mjs --scenario=walk --settle=25 \
//        --evalfile=tools/smoke/probes/carrier.js
//
// CE-86. THAT INVOCATION LINE IS LOAD-BEARING, AND THIS FILE SHIPPED WITHOUT
// ONE UNTIL 2026-08-14. `probeall.mjs` extracts the documented command out of
// this header (`extractCmd`, first `//` line matching `run.mjs`); a probe that
// documents none returns `null` and drops into the `--nodocs` bucket, which is
// off by default and, when it is on, runs at the RUNNER'S defaults -- no
// `--scenario=walk`, so the wrong world. So these 43 checks were never in the
// documented sweep that the RED list is built from. That is not a cosmetic
// gap: it is how a rotor red that had ALREADY BEEN FIXED at `a4f396d` stayed
// on Admin's backlog as a "NEW genuine red" (see CE-85 at the C1 rotor row).
//
// ---------------------------------------------------------------------------
// THE FIXTURE LESSON THIS PROBE WAS REWRITTEN AROUND, because it is the whole
// reason the first version read backwards.
//
// A FREELY FALLING FRAME IS NOT AN INERTIAL ONE. Cinder's frame accelerates
// toward Forge at the local g; a rider that is not also accelerating drifts in
// it by 1/2 g t^2 NO MATTER HOW EXACT THE TRANSPORT IS. So the first version,
// which zeroed gravity to "isolate the term", measured 1.2487 m of drift on a
// perfect transport and 0.0001 m on no transport at all, and both readings were
// correct physics. `apparent g = g(here) - a(the frame I ride in)` was already
// written down in GravityPort.ts; this probe is what makes it obvious that the
// POSITION half and the ACCELERATION half are two halves of ONE term and that
// neither is a test of the other.
//
// So the gates are split by what they can actually isolate:
//
//   C3  a LINEAR carrier, seeded from the moon's own speed and direction and
//       differing from it ONLY by not curving. No frame acceleration, so zero
//       gravity is legitimate and the transport is measured alone.
//   C5  the real orbiting frame with the ACCELERATION half right, which is
//       apparent gravity ~0 inside a freely falling carrier and is exactly what
//       `GravityVolumes` already installs around the station.
//   C5b the same frame with that half WRONG (full local gravity), whose drift
//       is PREDICTED as 1/2 g T^2 from the walker's own published number. This
//       is the finding, stated as a number rather than as a caveat.
//   C6  a ROTATING frame, the only gate that goes through the quaternion at
//       all. A translating carrier reports its turn as exactly 0, which is the
//       discriminator that says the rotation path ran.
//
// Every leg has a reachable refusing case in the same run, and the refusing
// case is not a break anybody made: it is what this client does today, which is
// a rider at rest in the BODY frame being left behind at the frame's own speed.
//
// EVERY CLAIM IS TICK-COUNTED, NOT SECOND-COUNTED. `of.run(secs, hz)` drives
// render frames and the fixed-tick accumulator carries across calls, so two
// legs of the same wall-clock length differ by a small integer number of ticks
// (zerog.js paid for that lesson twice). Every expected displacement below is
// `perTickM * measuredTicks`.
//
// OF_ARGS:
//   runTicks:  how long each measurement leg is, in ticks. Default 600 (10 s).
//   crossBody: run C7's Forge -> Cinder -> Forge round trip. Default true.
(async () => {
  const of = window.__of;
  const fails = [];
  const notes = {};
  let checks = 0;
  const check = (name, ok, detail) => {
    checks++;
    if (!ok) fails.push(detail === undefined ? name : `${name}: ${detail}`);
  };
  const args = (typeof OF_ARGS === 'object' && OF_ARGS !== null) ? OF_ARGS : {};
  const runTicks = typeof args.runTicks === 'number' ? args.runTicks : 600;
  const crossBody = args.crossBody !== false;
  const r6 = (x) => Math.round(x * 1e6) / 1e6;

  for (const k of ['carrier', 'gravityScale', 'standAt', 'run', 'world', 'life',
                   'reboot', 'meshVerts', 'teleport', 'stats', 'weight']) {
    if (typeof of[k] !== 'function') return { fail: `no __of.${k}: rebuild`, phase: 'C0' };
  }

  const tick = () => mustNum(of.world(), 'tick', 'world');
  const feet = () => mustHave(mustHave(of.world(), 'player', 'world'), 'feet', 'world.player');
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  const yield0 = () => new Promise((r) => setTimeout(r, 0));
  const idle = async (secs) => {
    of.input.tape([{ hold: Math.ceil(secs * 60) + 120, keys: [] }]);
    await of.run(secs, 60);
    await yield0();
  };
  const forTicks = async (n, keys) => {
    const t0 = tick();
    of.input.tape([{ hold: n + 180, keys: keys ?? [] }]);
    let spin = 0;
    while (tick() - t0 < n && spin++ < 60) {
      await of.run(Math.max(0.05, (n - (tick() - t0)) / 60), 60);
      await yield0();
    }
    return { t0, t1: tick(), ticks: tick() - t0 };
  };
  const err = (o, where) => {
    if (o !== null && typeof o === 'object' && typeof o.error === 'string') {
      fails.push(`${where}: ${o.error}`);
      return true;
    }
    return false;
  };
  /** local against a carrier, whether or not it is the one being ridden. */
  const localOf = (id) => {
    const l = of.carrier('local', { id });
    if (err(l, `local(${id})`)) return null;
    return mustHave(l, 'local', 'carrier local');
  };

  await idle(0.8);
  // HOME IS PINNED FIRST, before any `standAt` puts the walker 12,000 km away.
  // worldreboot.js learned this the same way: a reboot does not relocate the
  // player, so a ground hash taken at wherever a probe left them compares two
  // different patches and reports a world that changed.
  const home = (() => { const o = of.world().observer; return [o.latDeg, o.lonDeg, o.altM]; })();
  // THE GROUND SAMPLE IS TAKEN NOW, at boot, at home, converged, and NOT at C7
  // after the walker has been 12,000 km away. The first version took it after
  // the ride legs and read 355 vertices against a converged 1167, so it
  // compared an unfinished world with a finished one and called the difference
  // a defect. That is INSTRUMENTS.md's first entry in its purest form: the
  // baseline was a dependency and the world had moved under it.
  const settleWorld = async () => {
    let spin = 0; let last = -1; let stable = 0;
    while (spin++ < 400) {
      await of.run(0.25, 60);
      const p = mustNum(of.stats().props, 'propsPlaced', 'stats.props');
      stable = (p === last) ? stable + 1 : 0;
      last = p;
      if (mustHave(of.world(), 'chunks', 'world').converged && stable >= 2) return true;
    }
    notes.settleTimedOut = (notes.settleTimedOut ?? 0) + 1;
    return false;
  };
  const atHome = async () => { of.teleport(home[0], home[1], home[2]); return settleWorld(); };
  // The drawn ground, hashed. Same instrument as `probes/worldreboot.js`, at the
  // same 30 m radius and sorted for the same reason (`meshVertsNear` caps at
  // 6000 rows in chunk ARRIVAL order, so a wider sample compares two different
  // questions). `capped` is asserted as a fixture.
  const groundHash = () => {
    const f = feet();
    const rows = of.meshVerts(f[0], f[1], f[2], 30);
    const keys = rows.map((row) => `${Math.round(mustNum(row, 'hM', 'meshVert') * 1000)}:`
      + `${Math.round(mustNum(row, 'dM', 'meshVert') * 1000)}:${mustNum(row, 'depth', 'meshVert')}`);
    keys.sort();
    let h = 2166136261 >>> 0;
    for (const k of keys) {
      for (let i = 0; i < k.length; ++i) h = Math.imul(h ^ k.charCodeAt(i), 16777619) >>> 0;
    }
    return { hash: h >>> 0, verts: keys.length, capped: rows.length >= 6000 };
  };
  const settledBefore = await settleWorld();
  const before = groundHash();

  // ==================================================================== C1
  // THE FIXTURE. What each frame does on its own, before any rider exists.
  const cStation = of.carrier('register', { kind: 'station', id: 'station', ticks: runTicks });
  if (err(cStation, 'C1 register station')) return { fail: fails[0], phase: 'C1', fails };
  const cMoon = of.carrier('register', { kind: 'body', bodyId: 1, id: 'moon', ticks: runTicks });
  if (err(cMoon, 'C1 register moon')) return { fail: fails[0], phase: 'C1', fails };
  const cLine = of.carrier('register',
    { kind: 'linear', id: 'line', from: 'moon', ticks: runTicks });
  if (err(cLine, 'C1 register linear')) return { fail: fails[0], phase: 'C1', fails };
  const cRotor = of.carrier('register',
    { kind: 'rotor', id: 'rotor', from: 'station', ticks: runTicks });
  if (err(cRotor, 'C1 register rotor')) return { fail: fails[0], phase: 'C1', fails };
  const cFixed = of.carrier('register', { kind: 'fixed', id: 'still', ticks: runTicks });
  if (err(cFixed, 'C1 register fixed')) return { fail: fails[0], phase: 'C1', fails };

  const moonPerTick = mustNum(cMoon, 'perTickM', 'moon survey');
  const moonMS = mustNum(cMoon, 'perTickMS', 'moon survey');
  const moonR = Math.hypot(...mustHave(cMoon, 'originM', 'moon survey'));
  const linePerTick = mustNum(cLine, 'perTickM', 'line survey');
  const stationPerTick = mustNum(cStation, 'perTickM', 'station survey');
  const rotorPerTick = mustNum(cRotor, 'perTickM', 'rotor survey');
  const rotorMS = mustNum(cRotor, 'perTickMS', 'rotor survey');
  const rotorR = Math.hypot(...mustHave(cRotor, 'originM', 'rotor survey'));
  const rotorTurn = mustNum(cRotor, 'turnPerTickRad', 'rotor survey');
  notes.C1 = {
    moon: { perTickM: r6(moonPerTick), perTickMS: r6(moonMS), orbitRadiusM: r6(moonR),
            turnPerTickRad: cMoon.turnPerTickRad },
    line: { perTickM: r6(linePerTick), perTickMS: r6(cLine.perTickMS),
            turnPerTickRad: cLine.turnPerTickRad },
    station: { perTickM: stationPerTick, turnPerTickRad: cStation.turnPerTickRad,
               radiusM: r6(Math.hypot(...cStation.originM)) },
    rotor: { perTickM: r6(rotorPerTick), perTickMS: r6(rotorMS), radiusM: r6(rotorR),
             turnPerTickRad: rotorTurn, turnOverRunRad: r6(cRotor.turnRad) },
    still: { perTickM: cFixed.perTickM, turnPerTickRad: cFixed.turnPerTickRad },
    registry: cFixed.registry,
  };

  // Cinder's frame is the one physics measured independently: 542.5 m/s, i.e.
  // 9.04 m per 1/60 s tick (physics R79). Two domains arriving at the same
  // number through different code is worth more than either alone.
  check('C1 the moon frame moves at Cinder\'s own orbital speed',
    moonMS > 500 && moonMS < 600, `perTickMS ${r6(moonMS)}`);
  check('C1 and that is R79\'s 9.04 m per tick',
    moonPerTick > 8.9 && moonPerTick < 9.2, `perTickM ${r6(moonPerTick)}`);
  check('C1 the moon frame does not rotate', cMoon.turnPerTickRad === 0,
    `${cMoon.turnPerTickRad}`);
  // THE LINEAR INSTRUMENT IS THE SAME MOTION MINUS THE CURVATURE. If it were
  // not seeded from the moon it would be a made-up speed, and the comparison
  // between C3 and C5b would be between two different experiments.
  check('C1 the linear frame carries the moon\'s own speed',
    Math.abs(linePerTick - moonPerTick) < 1e-9, `${r6(linePerTick)} vs ${r6(moonPerTick)}`);
  check('C1 and it does not rotate either', cLine.turnPerTickRad === 0,
    `${cLine.turnPerTickRad}`);
  // THE STAMPED RECORD. This row used to assert the opposite: Anchorage
  // shipped frozen, its perTickM was exactly 0, and the comment said a stamped
  // record would be "good news and a different probe". ph357 stamped it, so
  // the row now asserts the motion itself, as the RELATION rather than a
  // pinned number: sqrt(mu/r) at the station's own registered radius, over 60
  // ticks per second, which at the 1e6 m orbit is 31.320919525430636 m per
  // tick. Asserting the relation is what survives somebody moving the orbit,
  // exactly as the rotor row below already does.
  const stationR = Math.hypot(...mustHave(cStation, 'originM', 'station survey'));
  const stationExpect = Math.sqrt(3.5316e12 / stationR) / 60;
  check('C1 Anchorage MOVES at its conic\'s own sqrt(mu/r) rate: the record is stamped',
    Math.abs(stationPerTick - stationExpect) < 1e-6 * stationExpect,
    `perTickM ${stationPerTick} vs sqrt(mu/r)/60 ${r6(stationExpect)} at r ${r6(stationR)}`);
  // sqrt(mu/r) on Forge at the 1e6 m orbit radius is 1879.2 m/s, i.e. 31.32 m
  // per tick. NOT the 7.5 km/s and 125 m per tick that R67 and SpaceStation.ts
  // both state: that is Earth's low orbit. The band is set from Forge's own mu.
  check('C1 the rotor carries the conic\'s real orbital rate',
    rotorMS > 1800 && rotorMS < 1960, `perTickMS ${r6(rotorMS)}`);
  // THE DISCRIMINATOR FOR THE QUATERNION PATH. Every translating carrier here
  // reports exactly 0; only a rotating one can report anything else, so this is
  // what says the rotation half of the algebra is exercised at all.
  check('C1 and the rotor really rotates, which nothing else here does',
    rotorTurn > 0 && cMoon.turnPerTickRad === 0 && cLine.turnPerTickRad === 0
    && cFixed.turnPerTickRad === 0,
    `rotor ${rotorTurn} moon ${cMoon.turnPerTickRad} line ${cLine.turnPerTickRad}`);
  // A rotating frame's turn rate and its travel are not independent: the origin
  // sweeps a fixed radius round a fixed axis. Asserting the RELATION rather
  // than either number is what survives somebody changing the orbit.
  //
  // CE-53. THE RELATION IS THE CHORD `2r sin(w/2)`, NOT THE ARC `r*w`, and the
  // difference is not pedantry: `poseAt` is sampled at INTEGER TICKS, so
  // `perTickM` is the straight-line distance between two points w apart on the
  // circle, which is the chord by definition. The arc overstates it by
  // `w^2/24` relative (expand 2 sin(w/2) = w - w^3/24 + ...), which at
  // Anchorage's w = 3.132092e-5 rad per tick is 4.0875e-11 -- four orders of
  // magnitude inside this gate, so the arc form is not what broke this row.
  // What broke it was the INSTRUMENT: `turnBetween` was `2*acos(|dot|)`, whose
  // conditioning multiplies a few-ulp dot error by 2/sin(w/2) = 1.2772e5 and
  // handed back a w that was 1.72e-6 light. Fixed in `app/DebugCarrier.ts`;
  // measured over 20,000 bases, the chord form against the stable angle is
  // exact to 1.44e-11 relative, so the gate is 1e-9 and it means something
  // again. It would have read 1.7240873e-6 against the old instrument.
  //
  // CE-85, 2026-08-14. THIS ROW WAS RE-OPENED AS A "NEW GENUINE RED" AND IT IS
  // NOT ONE. The report was `perTickM 31.32092 vs r*w 31.320866, relative
  // ~1.7e-6 against the 1e-6 tolerance`, blamed on the stamped station
  // perturbing the rotor's seed. Every one of those terms was decomposed on a
  // real D3D11 host (RTX 4060 Ti, ANGLE D3D11) and the arithmetic convicts the
  // OLD INSTRUMENT, not this build:
  //
  //   * `31.320866` is not producible by any code path here. It implies
  //     w = 3.1320866e-5, and the live atan2 instrument publishes
  //     w = 3.132091952687908e-5. The gap is 5.3527e-11 rad, 1.7090e-6
  //     relative: THE ENTIRE REPORTED ERROR IS THE ANGLE, and it is the
  //     acos cliff CE-53 already removed. Divide it by the conditioning
  //     2/sin(w/2) = 127,710 and it is 1.89 ulps of the quaternion dot
  //     product, i.e. the last two bits of a four-term sum.
  //   * the acos lattice steps 2.8357e-11 rad per ulp of that dot, which is
  //     9.05e-7 relative per rung. That quantisation, not stability, is why
  //     the old red "reproduced to 5 decimals" on two machines. 1.709e-6 is
  //     the 2-ulp rung (-1.8974e-6) minus a rounding of the reported digits.
  //   * the arc-vs-chord term, the only real one, is w^2/24 = 4.0875e-11
  //     relative (measured 4.0875e-11). It is 24x INSIDE this 1e-9 gate, so
  //     even the arc form would pass at 1e-6 today. The stamped station is
  //     exonerated: `r`, `w` and `perTickM` all come from ONE `survey()` call
  //     on the SAME pose pair, so there is no stale radius and no time skew.
  //   * live residual of the chord relation, two independent runs on this
  //     host: 1.97e-12 relative. Against the arc form it would be 3.89e-11.
  //
  // TWO RUNS, 43/43, `fails: []`. THE TOLERANCE WAS NOT WIDENED AND MUST NOT
  // BE: at 1e-9 this gate has 500x of headroom over the 1.97e-12 it actually
  // measures, and widening it to accommodate a number from a deleted
  // instrument would throw away the only thing that caught that instrument.
  const rotorChord = 2 * rotorR * Math.sin(rotorTurn / 2);
  check('C1 the rotor\'s turn and its travel agree through its own radius',
    Math.abs(rotorPerTick - rotorChord) < 1e-9 * rotorPerTick,
    `${rotorPerTick} vs 2r sin(w/2) ${rotorChord} `
    + `(rel ${(rotorPerTick - rotorChord) / rotorPerTick}, arc r*w `
    + `${rotorR * rotorTurn})`);
  check('C1 the fixed carrier is the no-motion control',
    cFixed.perTickM === 0 && cFixed.turnPerTickRad === 0, `${cFixed.perTickM}`);

  // ==================================================================== C2
  // THE RIDE IS INERT WITH NOTHING BOARDED. `applied` counts transports, so 0
  // after a boot and a run is the evidence that a world with no carrier in it
  // runs the instruction sequence it ran before this feature existed.
  const c2 = of.carrier();
  notes.C2 = { ride: mustHave(c2, 'ride', 'census'), tick: mustNum(c2, 'tick', 'census') };
  check('C2 nothing boarded, so no transport has ever been applied',
    mustNum(c2.ride, 'applied', 'ride') === 0 && c2.ride.carrier === null,
    JSON.stringify(c2.ride));

  // ==================================================================== C3
  // THE TRANSPORT, ISOLATED. A straight-line frame at the moon's own speed, no
  // gravity anywhere, so the only thing that can move the rider relative to the
  // frame is the term under test.
  of.gravityScale(0);
  await idle(0.3);
  // 1 km off the frame's origin, because the origin is the one place a rotation
  // cannot move anything and picking it would be GP-142 in this probe.
  const LOCAL = [1000, 0, 0];

  let b = of.carrier('board', { id: 'line' });
  if (err(b, 'C3 board')) return { fail: fails[0], phase: 'C3', fails };
  // BOARDING IS A CHANGE OF DESCRIPTION, NOT OF STATE. Bitwise, because "close
  // enough" is not what continuity means and a tolerance would hide a
  // snap-to-socket if anyone ever added one.
  check('C3 boarding moves nothing',
    b.before.feet.every((x, i) => x === b.after.feet[i])
    && b.before.vel.every((x, i) => x === b.after.vel[i]),
    JSON.stringify({ before: b.before, after: b.after }));

  const seat = of.carrier('standLocal', { x: LOCAL[0], y: LOCAL[1], z: LOCAL[2] });
  if (err(seat, 'C3 standLocal')) return { fail: fails[0], phase: 'C3', fails };
  // NO `await` BETWEEN THE SEAT AND THE LEG, and this is not tidiness.
  // `of.run` pauses the rAF loop and restarts it when it returns, so between
  // two `of.run` calls the loop IS ticking. An await here lets a VARIABLE
  // number of fixed ticks pass, and on an accelerating frame a seat velocity
  // that is k ticks stale is a relative velocity of k*a*dt. Measured: one run
  // read 0.25 m of C5 drift where two others read exactly 0, and the only
  // difference was how many frames the scheduler fitted into a setTimeout(0).
  const l0 = localOf('line');
  const f0 = feet();
  const legA = await forTicks(runTicks);
  const l1 = localOf('line');
  const f1 = feet();
  const w3 = of.weight();
  const driftRidden = dist(l1, l0);
  const movedRidden = dist(f1, f0);
  const expectedMove = linePerTick * legA.ticks;

  // ---- the refusing case, in the same loop, and it is not a break anybody
  //      made: a rider at rest in the BODY frame is what standing on the
  //      frozen station IS today.
  of.carrier('release');
  const fRest = feet();
  of.standAt(fRest[0], fRest[1], fRest[2]);
  await idle(0.2);
  const lc0 = localOf('line');
  const fc0 = feet();
  const legC = await forTicks(runTicks);
  const lc1 = localOf('line');
  const fc1 = feet();
  const driftLeft = dist(lc1, lc0);

  notes.C3 = {
    apparentG: mustNum(w3, 'apparentG', 'weight'), trueG: mustNum(w3, 'trueG', 'weight'),
    floating: w3.floating,
    ridden: { ticks: legA.ticks, localDriftM: r6(driftRidden), movedM: r6(movedRidden),
              expectedMoveM: r6(expectedMove), seatSpeedMS: r6(seat.speedMS) },
    leftBehind: { ticks: legC.ticks, localDriftM: r6(driftLeft),
                  perTickM: r6(driftLeft / Math.max(1, legC.ticks)),
                  absoluteMoveM: r6(dist(fc1, fc0)) },
  };
  // The fixture: gravity really is off, or C3 is measuring C5b.
  check('C3 the fixture: gravity is zeroed and the walker is in freefall',
    w3.apparentG === 0 && w3.floating === true && w3.trueG > 0,
    JSON.stringify({ apparentG: w3.apparentG, trueG: w3.trueG, floating: w3.floating }));
  check('C3 a rider at rest on a moving frame stays put IN THAT FRAME',
    driftRidden < 1e-6, `${r6(driftRidden)} m over ${legA.ticks} ticks`);
  // THE PROPERTY, not the magnitude: the rider went exactly as far as the frame.
  check('C3 and it went exactly as far as the frame went',
    Math.abs(movedRidden - expectedMove) < 1e-6 * expectedMove,
    `moved ${movedRidden} vs frame ${expectedMove}`);
  check('C3 the never-boarded rider is left behind at the frame\'s full speed',
    Math.abs(driftLeft - linePerTick * legC.ticks) < 1e-6 * driftLeft && driftLeft > 1000,
    `${r6(driftLeft)} m, ${r6(driftLeft / legC.ticks)} per tick`);
  check('C3 and it did not move in the body frame at all, which IS the defect',
    dist(fc1, fc0) < 1e-9, `${r6(dist(fc1, fc0))} m`);

  // ==================================================================== C4
  // THE CARRIER ADDS MOTION, IT DOES NOT CHANGE MOTION. The same thrust command
  // must produce the same speed relative to whatever frame the walker is in. In
  // freefall `Space` is radial thrust (PH-101), so this drives the walker's own
  // freefall branch INSIDE the carrier's frame rather than leaving it inert.
  const CHUNK = 120;
  const homeA = feet();
  of.standAt(homeA[0], homeA[1], homeA[2]);
  await idle(0.3);
  await forTicks(CHUNK * 2, ['Space']);
  const a0 = feet(); const at0 = tick();
  await forTicks(CHUNK, ['Space']);
  const a1 = feet(); const at1 = tick();
  const speedFree = dist(a1, a0) / ((at1 - at0) / 60);

  of.carrier('board', { id: 'line' });
  of.carrier('standLocal', { x: LOCAL[0], y: LOCAL[1], z: LOCAL[2] });
  await idle(0.3);
  await forTicks(CHUNK * 2, ['Space']);
  const rb0 = localOf('line'); const rt0 = tick(); const rf0 = feet();
  await forTicks(CHUNK, ['Space']);
  const rb1 = localOf('line'); const rt1 = tick(); const rf1 = feet();
  const speedRel = dist(rb1, rb0) / ((rt1 - rt0) / 60);
  const speedAbs = dist(rf1, rf0) / ((rt1 - rt0) / 60);
  const ownSpeed = mustNum(of.world().player, 'speedMps', 'world.player');

  notes.C4 = {
    unridden: { speedMS: r6(speedFree), ticks: at1 - at0 },
    ridden: { relativeMS: r6(speedRel), absoluteMS: r6(speedAbs), ticks: rt1 - rt0,
              walkerOwnSpeedMps: r6(ownSpeed) },
    carrierMS: r6(cLine.perTickMS),
  };
  check('C4 the thrust command actually produced motion, or nothing is tested',
    speedFree > 0.1, `${r6(speedFree)} m/s`);
  // THE RESIDUE IS PREDICTED, NOT TOLERATED. Both legs saturate at the same
  // governed speed, and the two windows are not the same number of fixed ticks
  // because `of.run`'s accumulator carries across calls (zerog.js, twice). One
  // tick of travel at the governed speed, spread over the window, is the whole
  // budget: `speed / ticks`. Measured 0.025 against a bound of 0.033.
  const tickQuantum = speedFree / Math.max(1, rt1 - rt0);
  check('C4 the same command gives the same speed RELATIVE to the frame',
    Math.abs(speedRel - speedFree) <= tickQuantum,
    `${r6(speedRel)} vs ${r6(speedFree)}, bound ${r6(tickQuantum)}`);
  // The discriminator: the same run's ABSOLUTE speed is the carrier's, two
  // orders of magnitude away. A probe that read only the absolute number would
  // see a walker doing 542 m/s and conclude the thrust model had broken.
  check('C4 while its ABSOLUTE speed is the carrier\'s, not the walker\'s',
    Math.abs(speedAbs - cLine.perTickMS) < 5, `${r6(speedAbs)} vs ${r6(cLine.perTickMS)}`);
  // AND THE WALKER'S OWN REPORT IS RELATIVE TOO. This is the consequence that
  // makes the term necessary rather than tidy: `KinematicBody` governs thrust
  // against its own speed, so a walker whose speed reads 542 m/s is a walker
  // whose controls have stopped working.
  check('C4 and the walker\'s OWN speedMps is the relative one',
    ownSpeed < 50, `${r6(ownSpeed)} m/s`);

  // ==================================================================== C5
  // THE REAL ORBITING FRAME, WITH BOTH HALVES PRESENT.
  //
  // A rider on a carrier is CARRIED, so what it feels is the APPARENT
  // acceleration, `g(here) - a(the frame I ride in)`, exactly as GravityPort.ts
  // says and exactly as `GravityVolumes` already implements for the station's
  // freefall region. On a freely falling frame that is ~0, which `gravityScale`
  // reproduces uniformly, and the rider then stays where it is put.
  of.carrier('release');
  of.gravityScale(0);
  of.carrier('board', { id: 'moon' });
  const seat5 = of.carrier('standLocal', { x: LOCAL[0], y: LOCAL[1], z: LOCAL[2] });
  if (err(seat5, 'C5 standLocal')) return { fail: fails[0], phase: 'C5', fails };
  const m0 = localOf('moon');
  const leg5 = await forTicks(runTicks);
  const m1 = localOf('moon');
  const w5 = of.weight();
  const driftOrbit = dist(m1, m0);
  const gAtMoonFree = mustNum(w5, 'trueG', 'weight');

  // ---- C5b: THE FINDING. The same frame with the acceleration half WRONG:
  //      full local gravity instead of apparent gravity, which is what a rider
  //      inside a falling carrier gets if nobody installs a freefall volume.
  //      It drifts by exactly the fall it is being told to do and the frame is
  //      not, PREDICTED from the walker's own published number rather than
  //      tolerated. This is what says the two halves are one term.
  of.gravityScale(1);
  of.carrier('standLocal', { x: LOCAL[0], y: LOCAL[1], z: LOCAL[2] });
  const n0 = localOf('moon');
  const leg5b = await forTicks(runTicks);
  const n1 = localOf('moon');
  const w5b = of.weight();
  const driftNoG = dist(n1, n0);
  const T = leg5b.ticks / 60;
  const gAtMoon = mustNum(w5b, 'apparentG', 'weight');
  const predictedFall = 0.5 * gAtMoon * T * T;

  notes.C5 = {
    apparentGZero: { ticks: leg5.ticks, localDriftM: r6(driftOrbit),
                     apparentG: w5.apparentG, trueG: r6(gAtMoonFree),
                     floating: w5.floating },
    apparentGWrong: { ticks: leg5b.ticks, localDriftM: r6(driftNoG),
                      apparentG: r6(gAtMoon),
                      predictedHalfGTsqM: r6(predictedFall), seconds: r6(T) },
    leftBehindM: r6(driftLeft),
  };
  // The two legs run at slightly different radii because the rider moved, so
  // the TRUE gravity differs in the ninth digit. What must be identical is
  // which half is switched off, and what must be zero is the first leg's
  // apparent gravity.
  check('C5 the fixture: the two legs differ ONLY in the apparent gravity',
    w5.apparentG === 0 && Math.abs(gAtMoon - gAtMoonFree) < 1e-6 * gAtMoonFree
    && gAtMoonFree > 0,
    JSON.stringify({ leg5: w5.apparentG, leg5b: gAtMoon, trueG: gAtMoonFree }));
  check('C5 a rider carried by a real orbiting frame stays where it is put',
    driftOrbit < 1e-3, `${r6(driftOrbit)} m over ${leg5.ticks} ticks`);
  // THE TWO-HALVES CLAIM, as a predicted number. The transport is byte-for-byte
  // identical in both legs; only the acceleration half changed.
  check('C5b and with the acceleration half wrong the SAME transport drifts by '
    + 'exactly the fall it is being told to do',
    Math.abs(driftNoG - predictedFall) < 0.1 * predictedFall,
    `${r6(driftNoG)} vs predicted 1/2 g T^2 = ${r6(predictedFall)}`);
  check('C5 both readings are far below being left behind',
    driftOrbit < driftLeft / 1000 && driftNoG < driftLeft / 100,
    `${r6(driftOrbit)} / ${r6(driftNoG)} / ${r6(driftLeft)}`);

  // ==================================================================== C6
  // ROTATION. The only gate that goes through the quaternion. Zero apparent
  // gravity and 500 m off the frame's centre, which is outside the station's
  // own 120 m freefall volume, so nothing but the frame is acting.
  //
  // A CARRIED rider stays put here too. What says the transport is doing
  // anything at all is the two sizes it is NOT: the frame's whole travel (not
  // carried) and the arc/chord departure (carried in position but not turned).
  of.carrier('release');
  of.gravityScale(0);
  of.carrier('board', { id: 'rotor' });
  const seatR = of.carrier('standLocal', { x: 500, y: 17, z: -33 });
  if (err(seatR, 'C6 standLocal')) return { fail: fails[0], phase: 'C6', fails };
  const r0 = localOf('rotor');
  const rfeet0 = feet();
  const legR = await forTicks(runTicks);
  const r1 = localOf('rotor');
  const rfeet1 = feet();
  const wR = of.weight();
  const driftRot = dist(r1, r0);
  const movedRot = dist(rfeet1, rfeet0);
  const seatSpeedR = mustNum(seatR, 'speedMS', 'standLocal');
  const riderR = Math.hypot(...mustHave(seatR, 'feet', 'standLocal'));
  const arcR = seatSpeedR * (legR.ticks / 60);
  const predictedDepart = (arcR * arcR) / (2 * riderR);
  notes.C6 = {
    ticks: legR.ticks, localDriftM: r6(driftRot), movedM: r6(movedRot),
    frameTravelM: r6(rotorPerTick * legR.ticks),
    seatSpeedMS: r6(seatSpeedR), riderRadiusM: r6(riderR),
    predictedDepartureM: r6(predictedDepart),
    apparentG: wR.apparentG, inVolumes: wR.inVolumes,
  };
  check('C6 the fixture: the rider is outside every gravity volume',
    wR.apparentG === 0 && Array.isArray(wR.inVolumes) && wR.inVolumes.length === 0,
    JSON.stringify({ apparentG: wR.apparentG, inVolumes: wR.inVolumes }));
  check('C6 a rider carried by a ROTATING frame stays put in it',
    driftRot < 1e-3, `${r6(driftRot)} m over ${legR.ticks} ticks`);
  // TWO SIZES IT IS NOT, so a transport that did nothing could not pass.
  check('C6 and it is neither of the two ways of being wrong',
    driftRot < 1e-3 * predictedDepart
    && driftRot < 1e-5 * rotorPerTick * legR.ticks,
    `${r6(driftRot)} against a ${r6(predictedDepart)} m no-turn and a `
    + `${r6(rotorPerTick * legR.ticks)} m no-carry`);
  check('C6 the rider travelled with the frame, not against it',
    Math.abs(movedRot - rotorPerTick * legR.ticks) < 0.02 * rotorPerTick * legR.ticks,
    `moved ${r6(movedRot)} vs frame ${r6(rotorPerTick * legR.ticks)}`);

  // ==================================================================== C7
  // TEARDOWN. The registry and the ride are emptied by the body scope's own
  // `Lifetime`, and the world comes back unchanged.
  of.gravityScale(1);
  of.carrier('release');
  of.carrier('board', { id: 'moon' });
  const settledMid = await atHome();
  const censusBefore = of.carrier();
  // `settledMid` is REPORTED and not asserted, deliberately. It is the walk
  // back from 12,000 km out, and it is the one settle in this probe that has
  // been seen to hit its poll cap; the ground sample it would have gated was
  // taken at boot instead, so nothing here depends on it. Asserting a terrain
  // convergence time inside a carrier probe would be a gate that rots for a
  // reason nobody in this lane can fix.
  check('C7 the fixture: the world converged, is not empty and is not truncated',
    settledBefore && before.verts > 100 && !before.capped
    && mustNum(of.stats().props, 'propsPlaced', 'stats.props') > 0,
    JSON.stringify({ settledBefore, settledMid, ...before }));
  // SIX, not five, since CE-80: `Boot` now registers `station:anchorage` for the
  // station's own geometry mount, so this probe's five instrument frames sit
  // beside one real one. The count is raised rather than loosened to `>= 5`,
  // because the number is the fixture and a range would stop noticing that a
  // seventh frame had appeared from somewhere. The id is asserted by name for
  // the same reason.
  check('C7 the fixture: six carriers are registered and one is being ridden',
    mustNum(censusBefore.registry, 'size', 'registry') === 6
    && censusBefore.registry.ids.includes('station:anchorage')
    && censusBefore.ride.carrier === 'moon'
    && mustNum(censusBefore.ride, 'applied', 'ride') > 0,
    JSON.stringify(censusBefore.registry) + ' ' + JSON.stringify(censusBefore.ride));

  const rb = await of.reboot();
  const settledAfter = await atHome();
  const after = groundHash();
  const censusAfter = of.carrier();
  const lifeAfter = of.life();
  const sameCounts = (x, y) => Object.keys(x).every((k) => x[k] === y[k])
    && Object.keys(y).every((k) => x[k] === y[k]);
  notes.C7 = {
    reboot: { epoch: rb.epoch, teardownMs: r6(rb.teardownMs), rebuildMs: r6(rb.rebuildMs),
              handleDelta: rb.handleDelta, teardownFailed: rb.teardown.failed },
    scope: lifeAfter.scope,
    registryBefore: censusBefore.registry, registryAfter: censusAfter.registry,
    rideAfter: censusAfter.ride,
    ground: { before, after, settledAfter, settledMid },
    subscribersBefore: rb.subscribersBefore, subscribersAfter: rb.subscribersAfter,
  };
  check('C7 the teardown ran clean', rb.teardown.failed.length === 0,
    JSON.stringify(rb.teardown.failed));
  // CE-80 added a THIRD step and it must come FIRST in the teardown list, which
  // is `Lifetime`'s reverse-of-registration order seen from the other end: the
  // mounts are registered last so they are dropped first, before the rider lets
  // go and before the frames are cleared. A mount holding a frame the registry
  // has already forgotten is the dead-handle state the contract's clause 4
  // exists to make impossible.
  // `of.life().scope` lists REGISTRATION order and the teardown is its reverse,
  // which the first version of this edit got backwards and the run said so.
  // CE-80's `mounts:clear` is therefore registered LAST and torn down FIRST:
  // the mounts drop before the rider lets go and before the frames are cleared,
  // so no mount ever holds a frame the registry has already forgotten, which is
  // the dead-handle state clause 4 of the teardown contract refuses.
  // PS-49 REPAIRED THIS CHECK AND DID NOT WEAKEN IT. It asserted the three at
  // absolute indices 0, 1 and 2, which was true while they were the first three
  // steps a scope registered and is a POSITION rather than the claim. The claim
  // is the RELATIVE order, and it is the relative order the reasoning above is
  // entirely about; a persistence step (`world.capture`) is now registered
  // ahead of them, so the absolute form went red for something that is not
  // about carriers at all. Consecutive-and-in-order still fails on any reorder
  // of the three, on a missing one, and on anything inserted BETWEEN them,
  // which is every way the property above can actually be broken.
  {
    const at = (s) => lifeAfter.scope.indexOf(s);
    const i = at('carriers:clear');
    check('C7 the scope registers all three carrier steps consecutively and in '
      + 'order, so teardown reverses them',
      i >= 0 && at('carrier:release') === i + 1 && at('mounts:clear') === i + 2,
      JSON.stringify(lifeAfter.scope));
  }
  // NOT zero since CE-80: `Boot` registers `station:anchorage` for the
  // station's own geometry mount, so the rebuilt world legitimately comes back
  // with ONE carrier in it. What the teardown must have emptied is everything
  // this probe registered, so the census is asserted exactly: size 1, and the
  // survivor is the station by name. A `<= 1` would stop noticing a probe
  // frame that leaked through the reboot.
  check('C7 every probe carrier is gone and only station:anchorage remains',
    mustNum(censusAfter.registry, 'size', 'registry') === 1
    && censusAfter.registry.ids.includes('station:anchorage'),
    JSON.stringify(censusAfter.registry));
  check('C7 and the rider let go', censusAfter.ride.carrier === null,
    `${censusAfter.ride.carrier}`);
  // THE SECOND INSTRUMENT, and it is the one a lying counter cannot satisfy:
  // `CarrierRegistry.add` THROWS on a duplicate id, so a successful
  // re-registration is proof the entry is absent rather than proof `size` says
  // so.
  const re = of.carrier('register', { kind: 'body', bodyId: 1, id: 'moon', ticks: 10 });
  check('C7 an id that was registered can be registered again, so it really went',
    typeof re.error !== 'string', `${re.error}`);
  const dup = of.carrier('register', { kind: 'body', bodyId: 1, id: 'moon', ticks: 10 });
  check('C7 and a genuine duplicate is still refused, so the check is not vacuous',
    typeof dup.error === 'string' && dup.error.includes('already registered'),
    JSON.stringify(dup));
  of.carrier('remove', { id: 'moon' });

  check('C7 no subscriber leaked', sameCounts(rb.subscribersBefore, rb.subscribersAfter),
    JSON.stringify({ b: rb.subscribersBefore, a: rb.subscribersAfter }));
  check('C7 no main-thread handle leaked', Object.keys(rb.handleDelta).length === 0,
    JSON.stringify(rb.handleDelta));
  check('C7 the same-body reboot drew the same ground',
    settledAfter && after.hash === before.hash && after.verts === before.verts && !after.capped,
    JSON.stringify({ before, after }));

  if (crossBody) {
    of.carrier('register', { kind: 'body', bodyId: 1, id: 'moon', ticks: 10 });
    of.carrier('board', { id: 'moon' });
    const toMoon = await of.reboot(1);
    const onMoon = of.carrier();
    const back = await of.reboot(0);
    const settledRound = await atHome();
    const round = groundHash();
    notes.C7round = {
      toMoon: { bodyId: toMoon.toBodyId, handleDelta: toMoon.handleDelta },
      onMoonRegistry: onMoon.registry, onMoonRide: onMoon.ride,
      back: { bodyId: back.toBodyId, handleDelta: back.handleDelta },
      ground: round, settledRound,
    };
    check('C7 a carrier does NOT survive a body switch',
      mustNum(onMoon.registry, 'size', 'registry') === 0 && onMoon.ride.carrier === null,
      JSON.stringify({ reg: onMoon.registry, ride: onMoon.ride }));
    check('C7 Forge is the same ground after a round trip out to Cinder',
      settledRound && round.hash === before.hash && round.verts === before.verts
      && !round.capped, JSON.stringify({ before, round }));
    check('C7 and nothing leaked on either leg',
      Object.keys(toMoon.handleDelta).length === 0
      && Object.keys(back.handleDelta).length === 0,
      JSON.stringify({ out: toMoon.handleDelta, back: back.handleDelta }));
  }

  // ==================================================================== C8
  // THE POSITIVE CONTROL ON THE RUN ITSELF. A green from a harness that never
  // reached its assertions is indistinguishable from one that ran them all, so
  // the count is asserted against a literal. Change a check, change this.
  const EXPECTED = crossBody ? 43 : 40;
  if (checks !== EXPECTED) {
    fails.push(`C8 ran ${checks} checks, expected ${EXPECTED}: the run did not `
      + 'reach every assertion, or a check was added without updating EXPECTED');
  }

  return {
    ok: fails.length === 0,
    fails, checks, expectedChecks: EXPECTED, reached: 'END',
    verdict: {
      leftBehindPerTickM: r6(driftLeft / Math.max(1, legC.ticks)),
      leftBehindM: r6(driftLeft),
      carriedDriftM: r6(driftRidden),
      ratio: driftRidden > 0 ? Math.round(driftLeft / driftRidden) : 'infinite',
      orbitingDriftM: r6(driftOrbit),
      rotatingDriftM: r6(driftRot),
      groundHash: before.hash,
    },
    ...notes,
  };
})()
