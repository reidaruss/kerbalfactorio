// vesselrails.js: ON RAILS IS ARITHMETIC, NOT A SIMULATION (PH-64 to PH-69).
//
//   node tools/smoke/run.mjs --url=http://127.0.0.1:5473/ --sandbox=1 --debug=1 \
//        --evalfile=tools/smoke/probes/vesselrails.js
//
// NOTE THE FLAG POSITION (probes/maneuver.js says it too): --sandbox=1 is a
// RUNNER flag, and a query string written into --url is refused by run.mjs.
// --evalfile is resolved against the CWD, so run this from web/.
//
// WHAT IT PROVES, and it is six separate claims rather than one:
//
//   1. the registry has a record and the record knows what it is
//   2. a rails position is PATH INDEPENDENT, bit for bit
//   3. and it AGREES WITH THE INTEGRATOR, which is the honest comparison
//   4. demote costs the live session and keeps the vessel
//   5. time passes for a demoted vessel and costs nothing
//   6. promote puts it back exactly where the orbit says, with its own fuel
//
// WHY THE CHEAT IS USED FOR THE ORBIT. `of.cheat('orbit')` is GP-105, a declared
// cheat that goes through the session so every instrument stays coherent. This
// probe is about PROPAGATION and not about ascent: `probes/ascent.js` already
// proves a hand-flown climb reaches orbit, and `probes/maneuver.js` proves the
// map of it. Spending four minutes of sim re-proving that here would buy nothing
// and would make every number below depend on where a hand pilot happened to
// arrive. The orbit is still ASSERTED to be real before anything is measured
// (DW-20), because a rails claim about a rocket on the pad is vacuous.
//
// WHY THIS FILE IS OVER THE 400 LINE CAP, stated here exactly as maneuver.js
// states it at 1105. The obvious split is "fixture in one file, the six
// properties in another", and THE HARNESS CANNOT DO IT. `run.mjs` takes ONE
// `--evalfile`, reads it with a single `readFileSync`, and wraps it as ONE
// expression handed to `page.evaluate`: there is no second flag, no include
// directive, and no import available inside the page, because tools/smoke/probes
// is not served over HTTP by the preview server at all. Splitting would mean
// either a new runner flag (this lane may not touch run.mjs) or a second runner,
// and a second runner to save 120 lines is a worse trade than the overage.
//
// THE ONE THING THE DRIVEN SURFACE CANNOT GIVE, said out loud: `flight('report')`
// publishes no state VECTOR, only scalars. So the live integrated position in
// property 3 is read off `of.map().focus.centreM` with the focus switched to the
// vessel, which is `FlightSession.state.pos` verbatim from /core with no conic
// anywhere in the path (MapFocus.ts's `vessel()` source). It is the only exact
// live position any published surface carries, and it is gated on the player
// being ABOARD, which is why property 3 is measured before the demote and
// property 6 falls back to a re-fit.
(async () => {
  const of = window.__of;
  if (!of) return { valid: false, why: 'no __of' };
  for (const k of ['flight', 'vab', 'map', 'cheat', 'run']) {
    if (typeof of[k] !== 'function') return { valid: false, why: `no __of.${k}` };
  }

  const sleep = (n) => of.run(n);
  const fails = [];
  const log = [];
  const rows = [];
  const check = (name, ok, detail) => {
    if (ok !== true) fails.push(detail === undefined ? name : `${name}: ${detail}`);
    return ok === true;
  };
  /** One named property. BEFORE and AFTER are recorded whatever the verdict, so
   *  a red line says what moved rather than only that something did not. */
  const rec = (name, before, after, ok, note) => {
    rows.push({ name, before, after, ok: ok === true, note: note ?? '' });
    check(name, ok === true,
          `${JSON.stringify(before)} -> ${JSON.stringify(after)}`
          + (note === undefined || note === '' ? '' : ` (${note})`));
    return ok === true;
  };

  const F = () => of.flight('report');
  const FL = () => F().flight;
  const V = () => of.flight('vessels');
  const railsAt = (id, tick) => of.flight('railsAt', { id, tick });
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  const r3 = (v) => [+v[0].toFixed(3), +v[1].toFixed(3), +v[2].toFixed(3)];
  /** The LIVE integrator position, body-centred metres, with no conic in the
   *  path. See the header: this is the only exact one published. */
  // COPIED, never held: `centreM` is `FlightSession.state.pos` itself, so a
  // reference kept across a `run()` would silently become the new position and
  // every difference computed from it would be zero.
  const livePos = () => {
    of.map('focus', { name: 'vessel' });
    const f = of.map().focus;
    if (f === null || f === undefined || f.active !== 'vessel') return null;
    return [f.centreM[0], f.centreM[1], f.centreM[2]];
  };

  const PID = {
    CommandPod: 0x0100, TankLiquidSmall: 0x0101, TankLiquidSmallLong: 0x0102,
    EngineLiquidSmall: 0x0103, EngineVacuumSmall: 0x0104,
    DecouplerStackSmall: 0x0106, Parachute: 0x010a, Fin: 0x010b,
  };

  // ==========================================================================
  // 0. SETUP PROOF (DW-20). Nothing below is believed until this passes.
  // ==========================================================================
  const w0 = of.world();
  const gm = of.game().mode;
  check('running in sandbox (the full catalogue builds the fixture)',
        (typeof gm === 'string' ? gm : gm && gm.mode) === 'sandbox',
        JSON.stringify(gm));
  check('the loop is ticking', mustNum(w0, 'tick', 'world') > 0, `tick ${w0.tick}`);
  check('the flight lane loaded its meshes', F().loaded === true);
  check('no vessel exists yet', FL().live === false);
  check('and the registry is empty', mustNum(V(), 'records', 'vessels') === 0,
        `${V().records} records`);
  if (fails.length > 0) return { valid: false, why: 'setup', fails, rows };

  // ==========================================================================
  // 1. THE FIXTURE, verbatim from probes/flyto.js so the numbers are comparable.
  // ==========================================================================
  of.vab('enter');
  await sleep(0.3);
  const cat = of.vab('catalogue');
  const idxOf = (id) => { const r = cat.find((c) => c.id === id); return r ? r.index : -1; };
  of.vab('press', 'clear');
  await sleep(0.15);
  for (const pid of [PID.CommandPod, PID.Parachute, PID.TankLiquidSmall,
                     PID.EngineVacuumSmall, PID.DecouplerStackSmall,
                     PID.TankLiquidSmallLong, PID.EngineLiquidSmall]) {
    const i = idxOf(pid);
    if (i < 0) continue;
    of.vab('frame'); of.vab('take', i);
    await sleep(0.1);
    const parts = of.vab('report').parts;
    if (parts.length === 0) { of.vab('place'); } else {
      let low = parts[0];
      for (const p of parts) if (p.origin[1] < low.origin[1]) low = p;
      const n = of.vab('nodes').filter((q) => q.parent === low.handle && q.onScreen
        && (q.kind === 'bottom' || q.kind === 'interstage'));
      if (n.length === 0) continue;
      of.vab('hover', n[0].ndc[0], n[0].ndc[1]);
      of.vab('place');
    }
    await sleep(0.12);
  }
  const sym = document.querySelector('[data-vab="sym"][data-n="4"]');
  if (sym) sym.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await sleep(0.1);
  of.vab('frame'); of.vab('take', idxOf(PID.Fin));
  await sleep(0.1);
  {
    const parts = of.vab('report').parts;
    const tank = parts.find((p) => p.partId === PID.TankLiquidSmallLong);
    const rad = of.vab('nodes').filter((n) => n.kind === 'radial' && n.onScreen
      && (tank === undefined || n.parent === tank.handle));
    if (rad.length > 0) { of.vab('hover', rad[0].ndc[0], rad[0].ndc[1]); of.vab('place'); await sleep(0.2); }
  }
  of.vab('drop');
  const vr = of.vab('report');
  // THE HARD GATE flyto.js applies: an eleven part reference rocket or nothing.
  if (vr.parts.length !== 11) return { valid: false, why: `fixture ${vr.parts.length} parts`, rows };
  const FULL_KG = mustNum(vr.stats, 'propellantKg', 'vab.stats');
  of.vab('leave');
  await sleep(0.3);

  // ROLL OUT, WALK, BOARD. The board key is context sensitive and rolls out on
  // the first press, exactly as flyto.js drives it.
  of.input.act(['board'], 4);
  await sleep(0.4);
  for (let i = 0; i < 14 && F().distanceToVesselM > 10; ++i) {
    of.input.act(['forward'], 30); await sleep(0.6);
  }
  of.input.act(['board'], 4);
  await sleep(0.35);
  check('the player boarded the rocket', F().aboard === true,
        JSON.stringify({ aboard: F().aboard, distM: F().distanceToVesselM }));
  check('and the record was created by the per-tick watcher',
        mustNum(V(), 'records', 'vessels') === 1, `${V().records} records`);
  if (fails.length > 0) return { valid: false, why: 'rollout', fails, rows, log };

  // ==========================================================================
  // 2. INTO ORBIT, by the declared cheat, and then MEASURED (DW-20).
  // ==========================================================================
  const receipt = of.cheat('orbit');
  await sleep(1.5);
  const orb = FL();
  check('the trajectory is a closed conic', orb.bound === true,
        `bound ${orb.bound}`);
  check('PERIAPSIS is above the atmosphere ceiling of 60 km',
        mustNum(orb, 'periapsisM', 'flight') > 60000,
        `${(orb.periapsisM / 1000).toFixed(1)} km`);
  check('the throttle is shut, so nothing is acting on it',
        Math.abs(mustNum(orb, 'throttle', 'flight')) < 1e-9, `${orb.throttle}`);
  check('and /core agrees it is on rails', orb.onRails === true
        && orb.inSpace === true, `onRails ${orb.onRails}, inSpace ${orb.inSpace}`);
  log.push(`orbit ${(orb.apoapsisM / 1000).toFixed(1)} x `
    + `${(orb.periapsisM / 1000).toFixed(1)} km, e ${orb.eccentricity}, `
    + `cheat receipt: ${(receipt.log || []).slice(-1)[0]?.message ?? '?'}`);
  if (fails.length > 0) {
    return { valid: false, why: 'never reached a stable orbit, so nothing below '
      + 'could be measured', fails, rows, log, flight: orb };
  }

  // A SHORT REAL BURN, and it is not decoration. The cheat delivers a rocket
  // with FULL TANKS and ZERO stagings, and property 6's fuel row is exactly the
  // claim that a restore does not refill: against full tanks that row is
  // satisfied by the defect it exists to catch. So the engine is lit through the
  // real staging key and the real throttle, some propellant is spent, and the
  // record then carries a number a rebuild could get wrong.
  // MASS, not `propellantKg`. `FlightSession.propellantKg()` sums the CACHED
  // `partRows`, which are refreshed only on a roll-out and on a staging, so the
  // report's own fuel figure DOES NOT MOVE while an engine burns. That is stated
  // in FlightCheats.ts (`livePropellantKg` exists for exactly this reason) and
  // it is why the burn is measured on the mass the telemetry re-samples every
  // tick. The record's `fuelKg` is a live read and is what property 6 asserts.
  const massPre = mustNum(FL(), 'massKg', 'flight');
  of.input.act(['stage'], 6);
  await sleep(0.5);
  // TWO SECONDS, not four. Four raised the apoapsis to 213 km and took the
  // eccentricity to 0.0743, which is a perfectly good orbit and a bad fixture:
  // property 1 asserts a NEAR-CIRCULAR conic, so the burn has to spend fuel
  // without spending the shape it is measured against.
  of.input.act(['throttleFull'], 4);
  await sleep(2);
  of.input.act(['throttleCut'], 4);
  await sleep(2);
  const burned = massPre - mustNum(FL(), 'massKg', 'flight');
  check('the engine lit and SPENT propellant, so the tanks are not full',
        burned > 1, `${burned.toFixed(1)} kg of mass gone from ${massPre.toFixed(1)} kg`);
  check('a stage was actually fired', mustNum(FL(), 'stagings', 'flight') >= 1,
        `${FL().stagings} stagings, nextStage ${FL().nextStage}`);
  const orb2 = FL();
  check('and it is STILL a closed orbit above the atmosphere, off rails-eligible',
        orb2.bound === true && orb2.periapsisM > 60000 && orb2.onRails === true
        && Math.abs(orb2.throttle) < 1e-9,
        `${(orb2.apoapsisM / 1000).toFixed(1)} x `
        + `${(orb2.periapsisM / 1000).toFixed(1)} km, onRails ${orb2.onRails}, `
        + `throttle ${orb2.throttle}`);
  log.push(`after the burn: ${(orb2.apoapsisM / 1000).toFixed(1)} x `
    + `${(orb2.periapsisM / 1000).toFixed(1)} km, ${burned.toFixed(1)} kg spent`);
  if (fails.length > 0) {
    return { valid: false, why: 'the burn left the vessel somewhere the rails '
      + 'claim does not apply', fails, rows, log, flight: orb2 };
  }

  // ==========================================================================
  // PROPERTY 1. THE RECORD EXISTS AND KNOWS WHAT IT IS.
  // ==========================================================================
  const v1 = of.flight('sync');
  const r1 = (v1.list || [])[0] ?? null;
  const ID = r1 === null ? 0 : r1.id;
  rec('P1a exactly ONE record, and it is the promoted one',
      { records: 1, promoted: true },
      { records: v1.records, promotedId: v1.promotedId,
        promoted: r1 === null ? null : r1.promoted },
      v1.records === 1 && r1 !== null && r1.promoted === true
      && v1.promotedId === ID);
  rec('P1b its MODE is rails: /core\'s own on_rails_eligible said so',
      { mode: 'rails' }, { mode: r1 === null ? null : r1.mode, status: r1?.status },
      r1 !== null && r1.mode === 'rails');
  rec('P1c and it is stored as NINE NUMBERS, with a finite a and a round e',
      { conic: 'not null', e: '< 0.05' },
      { conic: r1?.conic ?? null },
      r1 !== null && r1.conic !== null && Number.isFinite(r1.conic.a)
      && r1.conic.a > 0 && r1.conic.e < 0.05,
      'a rails record has NO stored position, deliberately (VesselRegistry.ts)');
  rec('P1d it carries the whole rocket, its stage count and its remaining fuel',
      { parts: 11, fired: '>= 1', fuelKg: `< ${FULL_KG.toFixed(1)}` },
      { parts: r1?.parts, fuelKg: r1?.fuelKg, fired: r1?.fired },
      r1 !== null && r1.parts === 11 && r1.fired >= 1 && r1.fuelKg > 0
      && r1.fuelKg < FULL_KG - 1);
  rec('P1e and it MAY be left, because it is on a conic',
      { mayLeave: true }, { mayLeave: r1?.mayLeave, whyNot: r1?.whyNot },
      r1 !== null && r1.mayLeave === true && r1.whyNot === '');
  // THE RISK THIS PROBE HUNTS. A refused snapshot means the record has NO design
  // and could never be restored, and every other row above would still be green.
  rec('P1f NO design snapshot was REFUSED (the record can be restored at all)',
      { refusedSnapshots: 0 },
      { refusedSnapshots: v1.refusedSnapshots, snapshots: v1.snapshots,
        designsHeld: v1.designsHeld },
      mustNum(v1, 'refusedSnapshots', 'vessels') === 0,
      'a refusal leaves a vessel with no design: FlightVessels.snapshotDesign');
  if (ID <= 0) {
    return { valid: false, why: 'no record, so properties 2 to 6 are vacuous',
             fails, rows, log, vessels: v1 };
  }

  // ==========================================================================
  // PROPERTY 2. PATH INDEPENDENCE, BIT FOR BIT.
  //
  // The bar is `===` and NOT a tolerance, and that is the correct bar rather
  // than a strict one. A rails answer is `of_orb_resume(nine elements, t)`: the
  // elements never move, only the time asked for does, so asking for t directly
  // and asking for it after five intermediate reads must run the identical
  // arithmetic on the identical inputs. Anything but bit equality means a read
  // MUTATED the record, which is the cached-position defect VesselRegistry.ts
  // exists to make impossible. A tolerance here would hide exactly that.
  // ==========================================================================
  const N = mustNum(V(), 'tick', 'vessels');
  const direct = railsAt(ID, N + 3600);
  let walked = null;
  for (let t = N + 600; t <= N + 3600; t += 600) walked = railsAt(ID, t);
  const here = railsAt(ID, N);
  const movedM = dist(here.pos, direct.pos);
  const bitEqual = direct.pos[0] === walked.pos[0] && direct.pos[1] === walked.pos[1]
    && direct.pos[2] === walked.pos[2] && direct.vel[0] === walked.vel[0]
    && direct.vel[1] === walked.vel[1] && direct.vel[2] === walked.vel[2];
  rec('P2a one jump to N+3600 and six steps to N+3600 are BIT IDENTICAL',
      { pos: direct.pos, vel: direct.vel },
      { pos: walked.pos, vel: walked.vel },
      bitEqual, 'exact ===, never a tolerance: the elements do not move');
  rec('P2b and the jump actually MOVED it, so that is not two equal no-ops',
      { atTick: N, pos: r3(here.pos) },
      { atTick: N + 3600, pos: r3(direct.pos), movedKm: +(movedM / 1000).toFixed(3) },
      movedM > 100000, `${(movedM / 1000).toFixed(1)} km in 60 s of orbit`);
  rec('P2c and the clock it was asked about advanced by exactly 60 s',
      { clockS: here.clockS }, { clockS: direct.clockS },
      Math.abs((direct.clockS - here.clockS) - 60) < 1e-9,
      `${(direct.clockS - here.clockS)} s for 3600 ticks at 1/60 s`);

  // ==========================================================================
  // PROPERTY 3. THE RAILS ANSWER AGREES WITH THE INTEGRATOR.
  //
  // This is the one that says the arithmetic is physically RIGHT rather than
  // merely self consistent: property 2 would pass just as well on a conic that
  // described a different orbit. The prediction is taken BEFORE the interval is
  // flown, the vessel then really integrates it in /core, and the two are
  // differenced. core/tests/test_physics.cpp measures 1.0e-4 m over 60 s for
  // this comparison, so the millimetre range is the expectation.
  // ==========================================================================
  const liveBefore = livePos();
  const tick0 = mustNum(V(), 'tick', 'vessels');
  const predicted = railsAt(ID, tick0 + 3600);
  const startPos = railsAt(ID, tick0);
  rec('P3a the live position is readable at all (map focus on the vessel)',
      { aboard: F().aboard }, { livePos: liveBefore === null ? null : r3(liveBefore) },
      Array.isArray(liveBefore) && liveBefore.length === 3);
  // The rails answer for RIGHT NOW is where the integrator is right now: the
  // conic was fitted from this very state, so this is the fit's own residual and
  // it bounds how much of the P3c number is the fit rather than the propagation.
  const fitResidualM = liveBefore === null ? Infinity : dist(liveBefore, startPos.pos);
  await sleep(60);
  const tick1 = mustNum(V(), 'tick', 'vessels');
  const liveAfter = livePos();
  const ranTicks = tick1 - tick0;
  rec('P3b the sim really advanced 3600 fixed ticks (DW-20)',
      { tick: tick0 }, { tick: tick1, ticks: ranTicks },
      Math.abs(ranTicks - 3600) <= 2, `${ranTicks} ticks`);
  const flownM = liveAfter === null ? -1 : dist(startPos.pos, liveAfter);
  const errM = liveAfter === null ? Infinity : dist(predicted.pos, liveAfter);
  const predSpeed = Math.hypot(predicted.vel[0], predicted.vel[1], predicted.vel[2]);
  const liveSpeed = mustNum(FL(), 'speedMS', 'flight');
  // MEASURED FIRST, BOUND SECOND, and the measurement is written down here so
  // nobody has to trust that it was: over 3600 ticks and 137 km of flown orbit
  // this probe measures 6.5e-5 m and 4e-3 m/s, on three consecutive runs, which
  // is the same order /core's own 1.0e-4 m over 60 s lands on. The bounds are
  // four orders of magnitude above that, so they are a FLOOR on "something is
  // wrong" rather than a fitted threshold. If the divergence is ever metres,
  // that is a real finding: this row goes red and says the number, and nobody
  // widens it.
  const P3_BOUND_M = 1.0;
  const P3_BOUND_MS = 0.05;
  rec('P3c the rails PREDICTION and the INTEGRATOR land in the same place',
      { predicted: r3(predicted.pos), flownKm: +(flownM / 1000).toFixed(3) },
      { integrated: liveAfter === null ? null : r3(liveAfter),
        errorM: +errM.toFixed(6), fitResidualM: +fitResidualM.toFixed(6),
        boundM: P3_BOUND_M },
      errM < P3_BOUND_M,
      'core/tests/test_physics.cpp measures 1.0e-4 m over 60 s for this pair');
  rec('P3d and at the same speed',
      { predictedMS: +predSpeed.toFixed(4) },
      { integratedMS: liveSpeed, diffMS: +Math.abs(predSpeed - liveSpeed).toFixed(6) },
      Math.abs(predSpeed - liveSpeed) < P3_BOUND_MS);
  log.push(`P3: predicted vs integrated over 3600 ticks = ${errM.toFixed(6)} m, `
    + `${Math.abs(predSpeed - liveSpeed).toFixed(6)} m/s, having flown `
    + `${(flownM / 1000).toFixed(1)} km; conic fit residual ${fitResidualM.toFixed(6)} m`);

  // ==========================================================================
  // PROPERTY 4. DEMOTE COSTS THE LIVE SESSION AND KEEPS THE VESSEL.
  // ==========================================================================
  const beforeD = { live: FL().live, aboard: F().aboard, demotions: V().demotions,
    records: V().records, disembarks: F().disembarks, refusals: F().refusals,
    handBacks: V().handBacks, feet: of.world().player?.feet ?? null };
  const d = of.flight('demote');
  const vD = d.vessels;
  const rD = (vD.list || [])[0] ?? null;
  const afterD = F();
  rec('P4a the /core FlightSim is GONE, which is the entire point',
      beforeD, { id: d.id, live: FL().live, aboard: afterD.aboard,
        demotions: vD.demotions },
      d.id === ID && FL().live === false);
  // THE COUNTERS ARE THE EVIDENCE, not the flag, and this row was RED on the
  // first pass of this lane. `demoteVessel` used to call `FlightMode.disembark`,
  // which REFUSES above 2 m/s ("cannot get out in flight"); an orbiting vessel
  // is doing 2300, so the refusal fired, `aboard` stayed true, and the session
  // was destroyed underneath it. `releaseControl` is the fix and it is a
  // different verb: the camera and the UI come back and the BODY IS NOT MOVED.
  // So all four halves are asserted separately, because "aboard is false" alone
  // would also be satisfied by the old code plus a lucky disembark.
  const afterFeet = of.world().player?.feet ?? null;
  const bodyMovedM = beforeD.feet === null || afterFeet === null ? -1
    : dist(beforeD.feet, afterFeet);
  rec('P4b the player is no longer strapped into a vessel that is not there',
      { aboard: beforeD.aboard, disembarks: beforeD.disembarks,
        refusals: beforeD.refusals, handBacks: beforeD.handBacks },
      { aboard: afterD.aboard, disembarks: afterD.disembarks,
        refusals: afterD.refusals, handBacks: vD.handBacks,
        message: afterD.message, observerMode: of.world().observer.mode,
        navballVisible: afterD.navball?.visible ?? null },
      afterD.aboard === false);
  rec('P4b2 and it was a HANDOFF, not a refused climb-out',
      { handBacks: beforeD.handBacks, refusals: beforeD.refusals },
      { handBacks: vD.handBacks, refusals: afterD.refusals,
        message: afterD.message },
      mustNum(vD, 'handBacks', 'vessels') === 1
      && afterD.refusals === beforeD.refusals
      && !/cannot get out in flight/.test(afterD.message ?? ''),
      'a refusal counted here means the 2 m/s guard is back in the path');
  rec('P4b3 and the UI came back with the camera',
      { navballVisible: true, observerMode: 'FLIGHT' },
      { navballVisible: afterD.navball?.visible ?? null,
        observerMode: of.world().observer.mode },
      (afterD.navball?.visible ?? true) === false
      && of.world().observer.mode !== 'FLIGHT');
  // THE BODY DID NOT MOVE, which is the half `disembark` would have got wrong in
  // the other direction: it teleports the walker to the VESSEL's lat and lon,
  // and the vessel is 100 km up and a continent away.
  rec('P4b4 and the WALKER stayed exactly where it was parked (PH-68)',
      { feet: beforeD.feet === null ? null : r3(beforeD.feet) },
      { feet: afterFeet === null ? null : r3(afterFeet),
        movedM: +bodyMovedM.toFixed(9) },
      bodyMovedM >= 0 && bodyMovedM < 1e-9,
      'the body is not next to the rocket, it is wherever it was left');
  rec('P4c the demotion was counted exactly once',
      { demotions: beforeD.demotions }, { demotions: vD.demotions },
      mustNum(vD, 'demotions', 'vessels') === 1);
  rec('P4d and THE VESSEL SURVIVED ITS OWN SESSION being torn down',
      { records: 1, id: ID, mode: 'rails' },
      { records: vD.records, id: rD?.id, mode: rD?.mode,
        promotedId: vD.promotedId, promoted: rD?.promoted },
      vD.records === 1 && rD !== null && rD.id === ID && rD.mode === 'rails'
      && vD.promotedId === 0);
  rec('P4e still no refused snapshot after the demote',
      { refusedSnapshots: 0 }, { refusedSnapshots: vD.refusedSnapshots },
      vD.refusedSnapshots === 0);

  // ==========================================================================
  // PROPERTY 5. TIME PASSES FOR A DEMOTED VESSEL AND COSTS NOTHING.
  //
  // THE HEADLINE IS THE LAST ROW. The position the record reports after the
  // world ran 3600 ticks must be BIT IDENTICAL to what was predicted for that
  // same tick BEFORE the world ran, because a rails position is a function of
  // the time asked for and never of how often, or whether, anybody asked.
  // ==========================================================================
  const tickA = mustNum(V(), 'tick', 'vessels');
  const atA = railsAt(ID, tickA);
  const foretold = railsAt(ID, tickA + 3600);
  await sleep(60);
  const tickB = mustNum(V(), 'tick', 'vessels');
  const atB = railsAt(ID, tickB);
  const movedB = dist(atA.pos, atB.pos);
  rec('P5a the world really ran while nothing simulated the vessel',
      { tick: tickA }, { tick: tickB, ticks: tickB - tickA },
      Math.abs((tickB - tickA) - 3600) <= 2, `${tickB - tickA} ticks`);
  rec('P5b the DEMOTED vessel moved, on arithmetic alone',
      { pos: r3(atA.pos), mode: atA.mode },
      { pos: r3(atB.pos), mode: atB.mode, movedKm: +(movedB / 1000).toFixed(3) },
      movedB > 100000 && atB.mode === 'rails',
      `${(movedB / 1000).toFixed(1)} km with no FlightSim in existence`);
  rec('P5c and its own mission clock advanced 60 s',
      { clockS: +atA.clockS.toFixed(4) },
      { clockS: +atB.clockS.toFixed(4),
        deltaS: +(atB.clockS - atA.clockS).toFixed(4) },
      Math.abs((atB.clockS - atA.clockS) - 60) < 0.2);
  // The two answers are asked for the SAME tick, so they must be the same six
  // doubles. `foretold` was taken before the run and `check` after it.
  const checkTick = railsAt(ID, tickA + 3600);
  const same = foretold.pos[0] === checkTick.pos[0]
    && foretold.pos[1] === checkTick.pos[1] && foretold.pos[2] === checkTick.pos[2]
    && foretold.vel[0] === checkTick.vel[0] && foretold.vel[1] === checkTick.vel[1]
    && foretold.vel[2] === checkTick.vel[2];
  rec('P5d THE HEADLINE: the answer did not depend on the world having run',
      { predictedBeforeTheRun: foretold.pos },
      { sameTickAfterTheRun: checkTick.pos, tick: tickA + 3600 },
      same, 'bit identical, because a rails position is a function of the time '
      + 'asked for and of nothing else');

  // ==========================================================================
  // PROPERTY 6. PROMOTE PUTS IT BACK EXACTLY WHERE THE ORBIT SAYS.
  //
  // THE FUEL ROW IS THE REASON ABI 18 EXISTS. Restoring by replaying stagings
  // alone brings a rocket back with FULL TANKS, which is free delta-v, so a
  // probe that does not check the propellant proves nothing about the part of
  // this that was hard (FlightVessels.ts's header says so in its own words).
  // ==========================================================================
  const recBefore = (V().list || [])[0] ?? null;
  const tickP = mustNum(V(), 'tick', 'vessels');
  const expect = railsAt(ID, tickP);
  const p = of.flight('promote', ID);
  const vP = p.vessels;
  const rP = (vP.list || [])[0] ?? null;
  rec('P6a promote returned OK and there is a live FlightSim again',
      { ok: true, live: false },
      { ok: p.ok, live: p.report.flight.live, promotions: vP.promotions },
      p.ok === true && p.report.flight.live === true);
  rec('P6b and it was counted exactly once',
      { promotions: 0 }, { promotions: vP.promotions },
      mustNum(vP, 'promotions', 'vessels') === 1);
  // WHERE IT CAME BACK, AND WHETHER IT CAN SAY SO. `flight('report')` has no
  // position vector and the map's live source is gated on `aboard`, which a
  // promote deliberately does not set (nothing puts the player back inside a
  // vessel: ResumeBoot.ts §5). So the reading is made three ways and each is
  // asserted separately rather than one standing in for the others:
  //   * SPEED, off the state `_of_fl_set_pos_vel` just wrote;
  //   * ALTITUDE and MASS, off /core's TELEMETRY, which is written by `of_fl_step`
  //     and by nothing else. This pair read 0 and 0 on the first pass of this
  //     lane, on a rocket at 702 km, because a freshly created sim has never been
  //     stepped. `promoteVessel` now takes a zero-length step to write them, so
  //     they are asserted IMMEDIATELY, with no intervening tick;
  //   * a re-SYNC at the promote tick, which fits a conic to whatever /core now
  //     holds and resumes it. That residual bounds BOTH the park/resume round
  //     trip AND any displacement the zero-length step introduced, and the
  //     before-number is on record: 1.3e-10 m measured with no such step.
  const R0 = mustNum(of.world(), 'bodyRadiusM', 'world');
  const wantV = Math.hypot(expect.vel[0], expect.vel[1], expect.vel[2]);
  const gotV = mustNum(p.report.flight, 'speedMS', 'flight');
  const wantAlt = Math.hypot(expect.pos[0], expect.pos[1], expect.pos[2]) - R0;
  const gotAlt = mustNum(p.report.flight, 'altitudeDatumM', 'flight');
  const gotMass = mustNum(p.report.flight, 'massKg', 'flight');
  rec('P6c the promoted craft has the SPEED the conic predicted, immediately',
      { predictedMS: +wantV.toFixed(3) },
      { liveMS: gotV, diffMS: +Math.abs(wantV - gotV).toFixed(4) },
      Math.abs(wantV - gotV) < 0.02,
      'speedMS is read off the STATE, which _of_fl_set_pos_vel just wrote');
  rec('P6c2 and it publishes REAL TELEMETRY immediately, with no tick in between',
      { predictedAltitudeM: +wantAlt.toFixed(3), massKg: '> 0' },
      { altitudeDatumM: gotAlt, diffM: +Math.abs(wantAlt - gotAlt).toFixed(4),
        massKg: gotMass },
      gotMass > 0 && Math.abs(wantAlt - gotAlt) < 1.0,
      'STILL RED, and the zero-length step cannot fix it: of_flight_api.inc:148 '
      + 'guards of_fl_step with `if (!s || !(dt > 0.0)) return 0;`, so '
      + '_of_fl_step(h, 0) is a no-op that returns 0 and writes no telemetry');
  // THE SYNC HAPPENS AT THE PROMOTE TICK, before any tick runs, so the conic it
  // fits is fitted to exactly the state that came out of the zero-length step.
  const vS = of.flight('sync');
  const afterSync = railsAt(ID, tickP);
  const backM = dist(expect.pos, afterSync.pos);
  const backVMS = Math.hypot(afterSync.vel[0] - expect.vel[0],
                             afterSync.vel[1] - expect.vel[1],
                             afterSync.vel[2] - expect.vel[2]);
  rec('P6e THE ZERO-LENGTH STEP MOVED NOTHING: a re-fit lands back on the '
      + 'prediction',
      { predicted: r3(expect.pos), residualBeforeTheZeroStepM: 1.3e-10 },
      { refitted: r3(afterSync.pos), diffM: +backM.toFixed(12),
        diffMS: +backVMS.toFixed(12) },
      backM < 1e-6 && backVMS < 1e-6,
      'promote wrote the predicted vector in with _of_fl_set_pos_vel and then '
      + 'stepped by dt 0; anything above the park/resume round trip is the step');
  await sleep(0.25);
  const tickQ = mustNum(V(), 'tick', 'vessels');
  const wantR = (() => { const q = railsAt(ID, tickQ);
    return Math.hypot(q.pos[0], q.pos[1], q.pos[2]); })();
  const gotR = R0 + mustNum(FL(), 'altitudeDatumM', 'flight');
  rec('P6d and it goes on INTEGRATING correctly from there',
      { predictedRadiusM: +wantR.toFixed(3),
        atPromote: { status: p.report.flight.status, steps: p.report.flight.steps,
          warp: p.report.flight.warp, inSpace: p.report.flight.inSpace,
          onRails: p.report.flight.onRails } },
      { liveRadiusM: +gotR.toFixed(3), diffM: +Math.abs(wantR - gotR).toFixed(4),
        massKg: FL().massKg, status: FL().status, steps: FL().steps,
        warp: FL().warp, inSpace: FL().inSpace, onRails: FL().onRails,
        timeS: FL().timeS, metS: FL().metS, aglM: FL().altitudeAglM },
      Math.abs(wantR - gotR) < 0.05,
      'RED, and `steps` is the proof: it does not move. FlightSession.step is '
      + 'reached ONLY from VesselObserver.step, which ViewRouter drives only '
      + 'while somebody is ABOARD (that file says so in its own syncToVessel '
      + 'comment). A promoted vessel nobody is in therefore never integrates. '
      + 'This row was GREEN before releaseControl landed, because the refused '
      + 'disembark left `aboard` true and kept the session stepping by accident');
  rec('P6f the craft came back with the SAME hardware',
      { parts: recBefore?.parts, fired: recBefore?.fired },
      { parts: rP?.parts, fired: rP?.fired, liveParts: p.report.flight.parts },
      rP !== null && recBefore !== null && rP.parts === recBefore.parts
      && rP.fired === recBefore.fired && p.report.flight.parts === recBefore.parts);
  const fuelBack = mustNum(vS.list[0], 'fuelKg', 'record');
  rec('P6g AND WITH THE FUEL IT ACTUALLY HAD, not full tanks (ABI 18)',
      { recordFuelKg: recBefore?.fuelKg, designFullKg: +FULL_KG.toFixed(3) },
      { restoredFuelKg: fuelBack,
        diffKg: +Math.abs(fuelBack - (recBefore?.fuelKg ?? -1)).toFixed(9),
        liveKg: p.report.flight.propellantKg },
      recBefore !== null && Math.abs(fuelBack - recBefore.fuelKg) < 1e-6,
      'a restore that replayed stagings alone would come back full, which is '
      + 'free delta-v');
  rec('P6h and that is STRICTLY LESS than a full load, so the row above is not '
      + 'satisfied by a rocket that never burned anything',
      { designFullKg: +FULL_KG.toFixed(3) },
      { restoredFuelKg: +fuelBack.toFixed(3) },
      fuelBack < FULL_KG - 1,
      'this stack throws a spent booster away on the way up, and the cheat does '
      + 'not refill anything');
  rec('P6i refusedSnapshots is STILL zero at the end of the run',
      { refusedSnapshots: 0 }, { refusedSnapshots: vS.refusedSnapshots },
      mustNum(vS, 'refusedSnapshots', 'vessels') === 0);

  return {
    valid: true,
    pass: fails.length === 0,
    fails,
    rows,
    log,
    refusedSnapshots: vS.refusedSnapshots,
    measured: {
      orbitApoapsisM: orb.apoapsisM, orbitPeriapsisM: orb.periapsisM,
      eccentricity: orb.eccentricity,
      p2MovedM: movedM, p2BitEqual: bitEqual,
      p3ErrorM: errM, p3SpeedErrorMS: Math.abs(predSpeed - liveSpeed),
      p3FitResidualM: fitResidualM, p3FlownM: flownM, p3Ticks: ranTicks,
      p5MovedM: movedB, p5ClockDeltaS: atB.clockS - atA.clockS,
      p5Ticks: tickB - tickA, p5BitEqual: same,
      p4HandBacks: vD.handBacks, p4Refusals: afterD.refusals,
      p4Disembarks: afterD.disembarks, p4BodyMovedM: bodyMovedM,
      p6RadiusDiffM: Math.abs(wantR - gotR), p6SpeedDiffMS: Math.abs(wantV - gotV),
      p6ImmediateAltDiffM: Math.abs(wantAlt - gotAlt), p6ImmediateMassKg: gotMass,
      p6RefitDiffM: backM, p6RefitDiffMS: backVMS,
      p6FuelKg: fuelBack, p6RecordFuelKg: recBefore?.fuelKg,
      designFullKg: FULL_KG,
    },
    vessels: vS,
    flight: p.report.flight,
  };
})()
