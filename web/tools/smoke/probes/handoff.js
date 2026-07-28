// handoff.js: FLY A ROCKET, LEAVE IT IN ORBIT, WALK AWAY, COME BACK TO IT (PH-76).
//
//   node tools/smoke/run.mjs --url=http://127.0.0.1:5495/ --sandbox=1 --debug=1 \
//        --evalfile=tools/smoke/probes/handoff.js
//
// NOTE THE FLAG POSITION (vesselrails.js and maneuver.js both say it): --sandbox=1
// is a RUNNER flag and a query string written into --url is refused by run.mjs.
// --evalfile is resolved against the CWD, so run this from web/.
//
// WHAT IT PROVES, in the order it proves it:
//
//   A. the setup is real: a vessel in a closed orbit above the atmosphere, with
//      fuel actually spent, and the player strapped into it
//   B. THE REFUSAL. With the engine lit the record is FROZEN, and `leaveVessel`
//      turns the handoff away with `whyNotLeave`'s own words and CHANGES NOTHING
//   C. the same call SUCCEEDS once the engine is cut and /core says on rails: the
//      player is no longer aboard, the live FlightSim is gone, and the record is
//      still in `registry.list()`
//   D. `resumeControl` puts the player back INTO IT, from 200 km away, with the
//      fuel it actually had, the orbit it actually had and the attitude it
//      actually had
//
// WHY B COMES BEFORE C AND NOT AFTER IT. The negative control needs a promoted
// vessel to refuse, and after C there is deliberately no live session at all.
// Running it first also makes C stronger rather than weaker: the same call, on
// the same vessel, seconds apart, answers differently because the STATE changed
// and not because the wiring did.
//
// WHY THE CHEAT IS USED FOR THE ORBIT, verbatim from vesselrails.js's reasoning:
// `of.cheat('orbit')` is GP-105, a declared cheat that goes through the session
// so every instrument stays coherent. This probe is about the HANDOFF and not
// about ascent; `probes/ascent.js` already proves a hand-flown climb reaches
// orbit, and `tools/smoke/vesselreload.mjs --phase=handoff` drives this same
// handoff after a REAL hand-flown flyto.js ascent and across a REAL page reload,
// which is where that half is proved. The orbit is still ASSERTED to be real
// before anything is measured (DW-20).
//
// THE FUEL BAR IS ZERO AND THAT IS DELIBERATE. `promoteVessel` writes the
// record's propellant back with ABI 18's setter and `syncPromoted` reads it
// straight back out of /core in the same synchronous turn, with no fixed tick in
// between, so anything but an exact match is a real defect and not a rounding
// budget. A tolerance here would hide the one failure this whole lane is about:
// a vessel that comes back with full tanks, which is free delta-v.
(async () => {
  const of = window.__of;
  if (!of) return { valid: false, why: 'no __of' };
  for (const k of ['flight', 'vab', 'cheat', 'run', 'world', 'game']) {
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
   *  a red line says what moved rather than only that something did. */
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
  const row0 = (v) => ((v ?? V()).list || [])[0] ?? null;
  const d3 = (a, b) => (Array.isArray(a) && Array.isArray(b)
    ? Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) : Infinity);
  const r6 = (v) => (Array.isArray(v)
    ? [+v[0].toFixed(6), +v[1].toFixed(6), +v[2].toFixed(6)] : null);

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
  check('the handoff ops EXIST on the driven surface', (() => {
    const r = of.flight('leave');
    return r !== null && typeof r === 'object' && r.error === undefined;
  })(), JSON.stringify(of.flight('leave')));
  check('and `leave` with no vessel at all is a refusal, not a throw',
        of.flight('leave').ok === false, JSON.stringify(of.flight('leave').ok));
  check('and `resume` on an id that does not exist is a refusal too',
        of.flight('resume', 9999).ok === false,
        JSON.stringify(of.flight('resume', 9999).ok));
  check('and the player was NOT seated by that failed resume', F().aboard === false,
        `aboard ${F().aboard}`);
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

  // ROLL OUT, WALK, BOARD, through the same context sensitive key a player uses.
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
  // WHERE THE BODY WAS PARKED. Every later row that says the walker did not move
  // is measured against this, and it is read from `world().player.feet`, never
  // from the observer: while strapped in, the observer IS the rocket.
  const feetAtPad = of.world().player?.feet ?? null;
  if (fails.length > 0) return { valid: false, why: 'rollout', fails, rows, log };

  // ==========================================================================
  // 2. INTO ORBIT, by the declared cheat, and then MEASURED (DW-20).
  // ==========================================================================
  of.cheat('orbit');
  await sleep(1.5);
  {
    const orb = FL();
    check('the trajectory is a closed conic', orb.bound === true, `bound ${orb.bound}`);
    check('PERIAPSIS is above the atmosphere ceiling of 60 km',
          mustNum(orb, 'periapsisM', 'flight') > 60000,
          `${(orb.periapsisM / 1000).toFixed(1)} km`);
    check('and /core agrees it is on rails', orb.onRails === true && orb.inSpace === true,
          `onRails ${orb.onRails}, inSpace ${orb.inSpace}`);
    log.push(`orbit ${(orb.apoapsisM / 1000).toFixed(1)} x `
      + `${(orb.periapsisM / 1000).toFixed(1)} km, e ${orb.eccentricity}`);
  }
  if (fails.length > 0) {
    return { valid: false, why: 'never reached a stable orbit, so nothing below '
      + 'could be measured', fails, rows, log, flight: FL() };
  }

  // A SHORT REAL BURN, and it is not decoration. The cheat delivers FULL TANKS
  // and ZERO stagings, and the fuel row in section 5 is exactly the claim that a
  // resume does not refill: against full tanks that row is satisfied by the very
  // defect it exists to catch. So the engine is lit through the real staging key
  // and the real throttle. MASS is the instrument, not `propellantKg`: the
  // report's fuel figure sums CACHED partRows and does not move while an engine
  // burns (FlightCheats.ts says so, `livePropellantKg` exists for it).
  const massPre = mustNum(FL(), 'massKg', 'flight');
  of.input.act(['stage'], 6);
  await sleep(0.5);
  of.input.act(['throttleFull'], 4);
  await sleep(2);
  of.input.act(['throttleCut'], 4);
  await sleep(2);
  const burnedKg = massPre - mustNum(FL(), 'massKg', 'flight');
  check('the engine lit and SPENT propellant, so the tanks are not full',
        burnedKg > 1, `${burnedKg.toFixed(1)} kg of mass gone`);
  check('a stage was actually fired', mustNum(FL(), 'stagings', 'flight') >= 1,
        `${FL().stagings} stagings`);
  check('and it is STILL a closed orbit above the atmosphere, off rails-eligible',
        FL().bound === true && FL().periapsisM > 60000 && FL().onRails === true,
        `${(FL().apoapsisM / 1000).toFixed(1)} x `
        + `${(FL().periapsisM / 1000).toFixed(1)} km, onRails ${FL().onRails}`);
  const ID = mustNum(row0(of.flight('sync')) ?? {}, 'id', 'record');
  if (fails.length > 0 || ID <= 0) {
    return { valid: false, why: 'the burn left the vessel somewhere the handoff '
      + 'claim does not apply', fails, rows, log, flight: FL() };
  }
  log.push(`after the burn: ${(FL().apoapsisM / 1000).toFixed(1)} x `
    + `${(FL().periapsisM / 1000).toFixed(1)} km, ${burnedKg.toFixed(1)} kg spent, `
    + `vessel id ${ID}`);

  // ==========================================================================
  // 3. THE NEGATIVE CONTROL. A GUARD NOBODY HAS SEEN REFUSE IS A GUARD NOBODY
  //    SHOULD TRUST.
  //
  // The engine is lit, which is one of the two things `on_rails_eligible` says
  // no arithmetic can advance (the other is air). `syncPromoted` therefore reads
  // the mode as FROZEN, `mayLeave` says no, and the handoff must turn away with
  // `whyNotLeave`'s own text and leave EVERY OTHER THING UNTOUCHED. All four of
  // those are separate rows, because "it returned false" alone would also be
  // satisfied by a call that refused and demoted anyway.
  // ==========================================================================
  of.input.act(['throttleFull'], 4);
  await sleep(1.2);
  const frozenBefore = {
    aboard: F().aboard, live: FL().live, records: V().records,
    promotedId: V().promotedId, demotions: V().demotions, handBacks: V().handBacks,
  };
  const vFrozen = of.flight('sync');
  const rFrozen = row0(vFrozen);
  rec('N1 with the ENGINE LIT the record is FROZEN, by /core\'s own predicate',
      { thrusting: true, mode: 'frozen', mayLeave: false },
      { mode: rFrozen?.mode, mayLeave: rFrozen?.mayLeave,
        throttle: FL().throttle, thrustN: FL().thrustN, onRails: FL().onRails },
      rFrozen !== null && rFrozen.mode === 'frozen' && rFrozen.mayLeave === false
      && FL().thrustN > 0,
      'FlightVessels.modeOf asks on_rails_eligible and never a local threshold');
  const refused = of.flight('leave');
  const afterN = refused.report;
  const vN = refused.vessels;
  rec('N2 THE HANDOFF IS REFUSED', { ok: false }, { ok: refused.ok }, refused.ok === false);
  rec('N3 and it said WHY, in whyNotLeave\'s published words',
      { message: rFrozen?.whyNot }, { message: afterN.message },
      typeof afterN.message === 'string' && afterN.message === rFrozen?.whyNot
      && /cannot leave a vessel under power/.test(afterN.message),
      'ResumeBoot.ts publishes the sentence; nothing here restates it');
  rec('N4 and NOTHING CHANGED: still aboard, still live, still promoted, and no '
      + 'demotion was counted',
      frozenBefore,
      { aboard: afterN.aboard, live: afterN.flight.live, records: vN.records,
        promotedId: vN.promotedId, demotions: vN.demotions,
        handBacks: vN.handBacks },
      afterN.aboard === true && afterN.flight.live === true
      && vN.records === frozenBefore.records
      && vN.promotedId === frozenBefore.promotedId
      && vN.demotions === frozenBefore.demotions
      && vN.handBacks === frozenBefore.handBacks,
      'a guard that half-applies is worse than no guard');
  log.push(`REFUSAL fired with: "${afterN.message}"`);

  // Cut the engine and let /core agree it is on rails again.
  of.input.act(['throttleCut'], 4);
  await sleep(2);
  const vThawed = of.flight('sync');
  const rThawed = row0(vThawed);
  rec('N5 and cutting the engine THAWS it, so the refusal was about the STATE '
      + 'and not about the wiring',
      { mode: 'frozen', mayLeave: false },
      { mode: rThawed?.mode, mayLeave: rThawed?.mayLeave,
        throttle: FL().throttle, onRails: FL().onRails },
      rThawed !== null && rThawed.mode === 'rails' && rThawed.mayLeave === true
      && rThawed.whyNot === '');
  if (rThawed === null || rThawed.mode !== 'rails') {
    return { valid: false, why: 'never got back on rails after the negative '
      + 'control, so the handoff itself could not be measured', fails, rows, log };
  }

  // ==========================================================================
  // 4. WHAT IS ON BOARD AT THE MOMENT OF LEAVING. Everything in section 5 is
  //    differenced against exactly these numbers.
  // ==========================================================================
  const BEFORE = {
    fuelKg: mustNum(rThawed, 'fuelKg', 'record'),
    a: mustNum(rThawed.conic ?? {}, 'a', 'record.conic'),
    e: mustNum(rThawed.conic ?? {}, 'e', 'record.conic'),
    fwd: rThawed.pose.fwd, right: rThawed.pose.right,
    fired: rThawed.fired, parts: rThawed.parts, clockS: rThawed.clockS,
  };
  check('the recorded fuel is STRICTLY LESS than a full load, so the fuel row '
        + 'below is not satisfied by a rocket that never burned anything',
        BEFORE.fuelKg > 0 && BEFORE.fuelKg < FULL_KG - 1,
        `${BEFORE.fuelKg.toFixed(3)} kg aboard, design holds ${FULL_KG.toFixed(3)} kg`);

  // ==========================================================================
  // 5. LEAVE IT IN ORBIT.
  // ==========================================================================
  const leftBefore = { aboard: F().aboard, live: FL().live, records: V().records,
                       demotions: V().demotions, handBacks: V().handBacks,
                       refusals: F().refusals, disembarks: F().disembarks };
  const left = of.flight('leave');
  const vL = left.vessels;
  const rL = (vL.list || []).find((r) => r.id === ID) ?? null;
  const afterL = left.report;
  rec('L1 IN ORBIT THE HANDOFF SUCCEEDS', { ok: true, live: true },
      { ok: left.ok, live: afterL.flight.live, demotions: vL.demotions },
      left.ok === true && afterL.flight.live === false);
  rec('L2 the player is NO LONGER ABOARD',
      { aboard: leftBefore.aboard },
      { aboard: afterL.aboard, observerMode: of.world().observer.mode,
        navballVisible: afterL.navball?.visible ?? null, message: afterL.message },
      afterL.aboard === false && (afterL.navball?.visible ?? true) === false
      && of.world().observer.mode !== 'FLIGHT');
  rec('L3 and it was a HANDOFF, not a refused climb-out',
      { handBacks: leftBefore.handBacks, refusals: leftBefore.refusals,
        disembarks: leftBefore.disembarks },
      { handBacks: vL.handBacks, refusals: afterL.refusals,
        disembarks: afterL.disembarks },
      vL.handBacks === leftBefore.handBacks + 1
      && afterL.refusals === leftBefore.refusals
      && afterL.disembarks === leftBefore.disembarks
      && !/cannot get out in flight/.test(afterL.message ?? ''),
      'a refusal counted here means disembark\'s 2 m/s guard is back in the path');
  rec('L4 THE VESSEL IS STILL IN registry.list()',
      { records: leftBefore.records, id: ID, mode: 'rails' },
      { records: vL.records, id: rL?.id, mode: rL?.mode,
        promotedId: vL.promotedId, fuelKg: rL?.fuelKg },
      vL.records === leftBefore.records && rL !== null && rL.id === ID
      && rL.mode === 'rails' && vL.promotedId === 0,
      'left in orbit is not the same as lost');
  const feetAfterLeave = of.world().player?.feet ?? null;
  rec('L5 and the WALKER stayed exactly where it was parked (PH-68)',
      { feet: feetAtPad === null ? null : feetAtPad.map((q) => +q.toFixed(3)) },
      { feet: feetAfterLeave === null ? null : feetAfterLeave.map((q) => +q.toFixed(3)),
        movedM: +d3(feetAtPad, feetAfterLeave).toFixed(9) },
      d3(feetAtPad, feetAfterLeave) < 1e-9,
      'the body is not next to the rocket, it is wherever it was left');
  if (left.ok !== true) {
    return { valid: false, why: 'the vessel could not be left at all', fails, rows,
             log, before: BEFORE };
  }

  // TIME PASSES WITH NOBODY IN IT. Not decoration: it is what "walk away" means,
  // and it makes the resume below a restore rather than a no-op two lines apart.
  const tickL = mustNum(V(), 'tick', 'vessels');
  await sleep(30);
  const tickR = mustNum(V(), 'tick', 'vessels');
  const railsL = of.flight('railsAt', { id: ID, tick: tickL });
  const railsR = of.flight('railsAt', { id: ID, tick: tickR });
  const coastedM = d3(railsL.pos, railsR.pos);
  rec('L6 the world ran 30 s with NO FlightSim in existence and the vessel moved '
      + 'on arithmetic alone',
      { tick: tickL, live: false },
      { tick: tickR, ticks: tickR - tickL, coastedKm: +(coastedM / 1000).toFixed(3),
        live: FL().live },
      tickR - tickL > 1700 && coastedM > 50000 && FL().live === false,
      `${(coastedM / 1000).toFixed(1)} km with nothing simulating it`);

  // ==========================================================================
  // 6. COME BACK TO IT. THIS IS THE VERB THE LANE EXISTS FOR.
  //
  // The vessel is now some hundreds of kilometres away, which is why this cannot
  // go through the board key: `board()` gates on BOARD_RANGE_M (18 m) and past
  // ABANDON_RANGE_M it rolls out a SECOND rocket. `distanceToVesselM` is recorded
  // below so that claim is a measurement and not an assertion.
  // ==========================================================================
  const resumed = of.flight('resume', ID);
  const afterR = resumed.report;
  // The SYNC is what makes the fuel row real: it re-reads the propellant out of
  // /core, so a resume that silently refilled the tanks shows up here. It is
  // taken in the SAME synchronous turn, so no fixed tick separates it from the
  // resume and the comparison is exact rather than approximately exact.
  const vR = of.flight('sync');
  const rR = (vR.list || []).find((r) => r.id === ID) ?? null;
  const distM = mustNum(afterR, 'distanceToVesselM', 'flight.report');
  rec('R1 RESUME PUT THE PLAYER BACK IN IT, from far outside boarding range',
      { ok: true, aboard: true, live: true, boardRangeM: afterR.boardRangeM },
      { ok: resumed.ok, aboard: afterR.aboard, live: afterR.flight.live,
        distanceToVesselKm: +(distM / 1000).toFixed(3),
        promotions: vR.promotions, promotedId: vR.promotedId },
      resumed.ok === true && afterR.aboard === true && afterR.flight.live === true
      && vR.promotedId === ID);
  rec('R1b and it really WAS out of reach, so the range gate could only ever '
      + 'have refused',
      { boardRangeM: afterR.boardRangeM },
      { distanceToVesselM: +distM.toFixed(1) },
      distM > 100000, `${(distM / 1000).toFixed(1)} km from the walker`);
  rec('R2 the craft came back with the SAME hardware',
      { parts: BEFORE.parts, fired: BEFORE.fired },
      { parts: rR?.parts, fired: rR?.fired, liveParts: afterR.flight.parts },
      rR !== null && rR.parts === BEFORE.parts && rR.fired === BEFORE.fired
      && afterR.flight.parts === BEFORE.parts);

  const dFuel = rR === null ? Infinity : Math.abs(rR.fuelKg - BEFORE.fuelKg);
  rec('R3 AND WITH THE FUEL IT ACTUALLY HAD, EXACTLY, not full tanks (ABI 18)',
      { fuelKg: BEFORE.fuelKg, designFullKg: +FULL_KG.toFixed(3) },
      { fuelKg: rR?.fuelKg, diffKg: dFuel, liveKg: afterR.flight.propellantKg },
      dFuel === 0,
      'exact ===, not a tolerance: no tick runs between the write and the read');
  rec('R3b and that is STILL strictly less than a full load',
      { designFullKg: +FULL_KG.toFixed(3) }, { fuelKg: rR?.fuelKg },
      rR !== null && rR.fuelKg < FULL_KG - 1);

  const dA = rR?.conic ? Math.abs(rR.conic.a - BEFORE.a) : Infinity;
  const dE = rR?.conic ? Math.abs(rR.conic.e - BEFORE.e) : Infinity;
  rec('R4 IT IS IN THE SAME ORBIT: the semi-major axis came back',
      { a: BEFORE.a }, { a: rR?.conic?.a, diffM: dA, relative: dA / Math.abs(BEFORE.a) },
      dA < 1.0, `${dA.toExponential(3)} m of ${(BEFORE.a / 1000).toFixed(1)} km`);
  rec('R4b and so did the eccentricity',
      { e: BEFORE.e }, { e: rR?.conic?.e, diff: dE },
      dE < 1e-6, `${dE.toExponential(3)}`);

  const dFwd = d3(rR?.pose?.fwd, BEFORE.fwd);
  const dRgt = d3(rR?.pose?.right, BEFORE.right);
  rec('R5 AND IT IS POINTING THE SAME WAY: the nose',
      { fwd: r6(BEFORE.fwd) }, { fwd: r6(rR?.pose?.fwd ?? null), diff: dFwd },
      dFwd < 1e-6, `${dFwd.toExponential(3)}`);
  rec('R5b and the roll',
      { right: r6(BEFORE.right) }, { right: r6(rR?.pose?.right ?? null), diff: dRgt },
      dRgt < 1e-6, `${dRgt.toExponential(3)}`);

  // IDEMPOTENCE. A second resume on a vessel already promoted AND already aboard
  // must be a no-op: `promoteVessel` returns early and `takeControlRemote`
  // returns early, so nothing is demoted, rebuilt or re-seated.
  const again = of.flight('resume', ID);
  rec('R6 a SECOND resume is a no-op, not a demote and a rebuild',
      { promotions: vR.promotions, demotions: vR.demotions, boardings: afterR.boardings },
      { ok: again.ok, promotions: again.vessels.promotions,
        demotions: again.vessels.demotions, boardings: again.report.boardings,
        aboard: again.report.aboard },
      again.ok === true && again.report.aboard === true
      && again.vessels.promotions === vR.promotions
      && again.vessels.demotions === vR.demotions
      && again.report.boardings === afterR.boardings);

  // AND IT FLIES AGAIN. A seat that does not integrate is a screenshot.
  const stepsBefore = mustNum(again.report.flight, 'steps', 'flight');
  await sleep(2);
  rec('R7 and the resumed vessel is being STEPPED again',
      { steps: stepsBefore },
      { steps: FL().steps, aboard: F().aboard, status: FL().status,
        massKg: FL().massKg },
      mustNum(FL(), 'steps', 'flight') > stepsBefore && FL().massKg > 0,
      'FlightSession.step is reached only through VesselObserver.step, which '
      + 'ViewRouter drives only while somebody is aboard');

  return {
    valid: true,
    pass: fails.length === 0,
    fails,
    rows,
    log,
    id: ID,
    measured: {
      designFullKg: FULL_KG, burnedKg,
      refusalMessage: afterN.message,
      refusalFired: refused.ok === false,
      leftInOrbit: left.ok === true,
      coastedM, coastedTicks: tickR - tickL,
      distanceAtResumeM: distM,
      fuelBeforeKg: BEFORE.fuelKg, fuelAfterKg: rR?.fuelKg ?? null, fuelDiffKg: dFuel,
      aBefore: BEFORE.a, aAfter: rR?.conic?.a ?? null, aDiffM: dA,
      eBefore: BEFORE.e, eAfter: rR?.conic?.e ?? null, eDiff: dE,
      fwdDiff: dFwd, rightDiff: dRgt,
    },
    vessels: vR,
    flight: afterR.flight,
  };
})()
