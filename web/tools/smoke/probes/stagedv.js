// stagedv.js: DO THE FUEL AND DELTA-V INSTRUMENTS MOVE WHILE AN ENGINE BURNS?
// (R44)
//
// THE QUESTION, IN TWO HALVES, BECAUSE THEY HAVE DIFFERENT ANSWERS.
//
// (1) `of.flight('report').propellantKg` sums `FlightSession.partRows`, which
//     `refreshParts` rewrites on a roll-out and on a staging and at no other
//     time. So it reports the kilograms the craft held when it was last staged
//     and DOES NOT MOVE during a burn. It is a debug surface (no in-flight
//     instrument prints propellant), but it cost `probes/radialdrain.js` a whole
//     pass by making a correct crossfeed experiment report nothing, so it is a
//     defect whatever reads it. Fixing it is a one-line re-read of /core.
//
// (2) THE NAVBALL'S PER-STAGE TABLE (`ui/Navball.ts` `table()`, fed
//     `app/FlightReadout.ts` -> `FlightSession.stageRows`) prints dv, TWR and
//     burn seconds per stage and IS on screen for the whole flight. Its dv for
//     the stage that is burning never falls either.
//
//     BUT NOT FOR THE SAME REASON, AND THIS FILE'S JOB IS TO SHOW THAT.
//     `FlightReport.readStagePerformance` calls `_of_vs_stage_performance` with
//     the DESIGN handle, not the flight handle. The design is the blueprint the
//     rocket was copied out of (`_of_fl_create` COPIES), so it never burns a
//     gram and its table is a constant for the whole flight. Calling
//     `refreshParts` on every frame would produce bit-identical numbers. The
//     table is not STALE, it is reading the WRONG VESSEL, and /core exports no
//     way to read the right one: `stagePerformance` takes a `Vessel&` and
//     `FlightSim::craft` (the drained one) is not reachable through any
//     `of_fl_*` export. Section 6 MEASURES this rather than asserting the file
//     read: it stages for real, which is the one moment mid-flight that
//     `refreshParts` runs, and shows the jettisoned stage still reporting its
//     roll-out delta-v with its engine and tank physically gone.
//
// WHAT IS ALREADY LIVE AND CORRECT, asserted here as the positive control so a
// flat trace cannot be blamed on a rocket that never burned anything:
// `remainingDvMS` (`_of_fl_remaining_dv_vacuum`, a call on the FLIGHT handle),
// `massKg` (telemetry, written by `of_fl_step`) and `of.flight('tanks')`.
//
//   node tools/smoke/run.mjs --url=http://127.0.0.1:5517/ --sandbox=1 --settle=6 \
//     --evalfile=tools/smoke/probes/stagedv.js
//
// `--evalargs='{"liveStages":1}'` flips section 5 from asserting the CURRENT
// frozen behaviour to asserting the behaviour R44 wants. It is a flag rather
// than a plain assertion because the stage-table half cannot be fixed in the
// client: it needs a new `of_fl_stage_performance(f)` export and an ABI number.
// Leaving a permanently red line in the tree teaches the suite to be ignored;
// leaving a line that asserts the defect means the day somebody fixes it this
// file goes red and says exactly which flag to flip.
//
// It REFUSES without --sandbox=1: the reference vehicle needs the full
// catalogue, and measuring a different rocket from the one named is worse than
// a red line.
(async () => {
  const of = window.__of;
  if (!of) return { valid: false, why: 'no __of' };
  if (typeof of.flight !== 'function') return { valid: false, why: 'no __of.flight' };
  if (typeof of.vab !== 'function') return { valid: false, why: 'no __of.vab' };

  const A = (typeof OF_ARGS === 'object' && OF_ARGS !== null) ? OF_ARGS : {};
  // See the header. false asserts the defect, true asserts the fix.
  const EXPECT_LIVE_STAGES = A.liveStages === 1;
  const BURN_S = A.burnS || 45;
  const HZ = A.hz || 45;

  const sleep = (n) => of.run(n);
  const fails = [];
  const log = [];
  const check = (name, ok, detail) => {
    if (!ok) fails.push(detail === undefined ? name : `${name}: ${detail}`);
    return ok;
  };

  const F = () => of.flight('report');
  const FL = () => F().flight;
  const RD = () => of.flight('readout');
  const TANKS = () => of.flight('tanks');

  // "Ascender I", the vehicle core/tests/test_vessel.cpp pins. TWO STAGES, which
  // is the whole point: stage 0 is the one that burns first and the one whose
  // row a player watches, and stage 1 is what is left after the decoupler fires.
  const PID = {
    CommandPod: 0x0100, TankLiquidSmall: 0x0101, TankLiquidSmallLong: 0x0102,
    EngineLiquidSmall: 0x0103, EngineVacuumSmall: 0x0104,
    DecouplerStackSmall: 0x0106, Parachute: 0x010a, Fin: 0x010b,
  };
  const CORE = { totalDV: 4922.91, massKg: 9845 };

  // ==========================================================================
  // 0. SETUP PROOF. Nothing below is believed until this passes.
  // ==========================================================================
  const gm = of.game().mode;
  const modeName = typeof gm === 'string' ? gm : (gm && gm.mode);
  if (modeName !== 'sandbox') {
    return { valid: false, mode: modeName,
             why: 'this probe REFUSES without --sandbox=1: the reference '
               + 'vehicle needs the full part catalogue, and --sandbox is a '
               + 'RUNNER flag (a query string in --url is discarded)' };
  }
  check('the loop is ticking', of.world().tick > 0, `tick ${of.world().tick}`);
  const f0 = F();
  check('the flight lane loaded its meshes', f0.loaded === true);
  check('no vessel exists yet', f0.flight.live === false);
  if (fails.length > 0) return { valid: false, why: 'setup', fails };

  // ==========================================================================
  // 1. BUILD THE REFERENCE VEHICLE, through the panel, one part at a time.
  //    The fins are not decoration: without them the airframe is statically
  //    UNSTABLE (+3.188 m margin) and a tumbling rocket is a burn nobody can
  //    read a delta-v trace off.
  // ==========================================================================
  of.vab('enter');
  await sleep(0.3);
  const cat = of.vab('catalogue');
  const idxOf = (id) => { const r = cat.find((c) => c.id === id); return r ? r.index : -1; };
  of.vab('press', 'clear');
  await sleep(0.2);
  check('the bay started empty', of.vab('report').parts.length === 0,
        `${of.vab('report').parts.length} parts survived the clear`);

  const stack = [
    PID.CommandPod, PID.Parachute, PID.TankLiquidSmall, PID.EngineVacuumSmall,
    PID.DecouplerStackSmall, PID.TankLiquidSmallLong, PID.EngineLiquidSmall,
  ];
  for (const pid of stack) {
    const i = idxOf(pid);
    if (i < 0) { log.push(`part ${pid.toString(16)} not offered`); continue; }
    of.vab('frame');
    of.vab('take', i);
    await sleep(0.1);
    const parts = of.vab('report').parts;
    if (parts.length === 0) { of.vab('place'); } else {
      let low = parts[0];
      for (const p of parts) if (p.origin[1] < low.origin[1]) low = p;
      const n = of.vab('nodes').filter((q) => q.parent === low.handle && q.onScreen
        && (q.kind === 'bottom' || q.kind === 'interstage'));
      if (n.length === 0) { log.push(`no node under ${low.handle}`); continue; }
      of.vab('hover', n[0].ndc[0], n[0].ndc[1]);
      of.vab('place');
    }
    await sleep(0.12);
  }
  const sym4 = document.querySelector('[data-vab="sym"][data-n="4"]');
  if (sym4) sym4.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await sleep(0.1);
  of.vab('frame');
  of.vab('take', idxOf(PID.Fin));
  await sleep(0.1);
  {
    const parts = of.vab('report').parts;
    const tank = parts.find((p) => p.partId === PID.TankLiquidSmallLong);
    const radial = of.vab('nodes').filter((n) => n.kind === 'radial' && n.onScreen
      && (tank === undefined || n.parent === tank.handle));
    if (radial.length > 0) {
      of.vab('hover', radial[0].ndc[0], radial[0].ndc[1]);
      of.vab('place');
      await sleep(0.2);
    }
  }
  of.vab('drop');
  await sleep(0.15);
  const vr = of.vab('report');
  check('the reference vehicle assembled', vr.parts.length === 11,
        `${vr.parts.length} parts`);
  check('its delta-v is /core\'s own pinned number', vr.stats !== undefined
        && Math.abs(vr.stats.totalDeltaV - CORE.totalDV) <= 0.01,
        `${vr.stats && vr.stats.totalDeltaV} against ${CORE.totalDV}`);
  check('and its pad mass is', vr.stats !== undefined
        && Math.abs(vr.stats.massKg - CORE.massKg) <= 0.5,
        `${vr.stats && vr.stats.massKg}`);
  check('it has TWO stages, so there is a stage 0 to burn and a stage 1 to '
        + 'stage into', vr.stages !== undefined && vr.stages.length === 2,
        `${vr.stages && vr.stages.length} stages`);
  of.vab('leave');
  await sleep(0.3);
  if (fails.length > 0) {
    return { valid: false, why: 'the fixture did not assemble', fails, log, vab: vr };
  }

  // ==========================================================================
  // 2. ROLL OUT, WALK, BOARD. The same three presses ascent.js makes.
  // ==========================================================================
  of.input.act(['board'], 4);
  await sleep(0.4);
  let r = F();
  check('a vessel rolled out', r.rollouts === 1 && r.flight.live === true,
        JSON.stringify({ rollouts: r.rollouts, live: r.flight.live }));
  check('the whole vehicle came across the bridge', r.flight.parts === 11,
        `${r.flight.parts} of 11`);
  check('it is HELD BY THE CLAMP, not falling', r.flight.status === 'CLAMPED',
        r.flight.status);
  for (let i = 0; i < 14 && F().distanceToVesselM > 10; ++i) {
    of.input.act(['forward'], 30);
    await sleep(0.6);
  }
  of.input.act(['board'], 4);
  await sleep(0.4);
  r = F();
  check('the player boarded it', r.aboard === true && r.boardings === 1,
        `aboard ${r.aboard}, boardings ${r.boardings}`);
  check('the navball is on screen, so the stage table below is a thing a '
        + 'player is actually looking at', r.navball.visible === true);
  if (fails.length > 0) {
    return { valid: false, why: 'never got aboard', fails, log, flight: F() };
  }

  // ==========================================================================
  // 3. THE PAD BASELINE. Every later number is measured against these, and they
  //    are READ, never assumed from the catalogue.
  // ==========================================================================
  const padRd = RD();
  const padStages = padRd.stages.map((s) => ({ index: s.index, dv: s.dvVacMS,
                                               twr: s.twr, burnS: s.burnS,
                                               active: s.active }));
  const pad = {
    reportedPropellantKg: FL().propellantKg,
    livePropellantKg: TANKS().liveTotalKg,
    massKg: FL().massKg,
    remainingDvMS: FL().remainingDvMS,
    totalDvMS: FL().totalDvMS,
    stage0Dv: padRd.stages[0] ? padRd.stages[0].dvVacMS : -1,
  };
  check('the cached and live propellant totals AGREE on the pad, because '
        + 'refreshParts has just run (the disagreement is created by the burn, '
        + 'not by the roll-out)',
        Math.abs(pad.reportedPropellantKg - pad.livePropellantKg) < 1.5,
        `${pad.reportedPropellantKg} vs ${pad.livePropellantKg}`);
  check('the pad stage table has a row per stage', padStages.length === 2,
        JSON.stringify(padStages));
  log.push(`on the pad: ${JSON.stringify(pad)}`);
  log.push(`pad stage table: ${JSON.stringify(padStages)}`);

  // FRAME TIME BEFORE THE BURN. A frozen instrument and a stuttering one are
  // both defects, so any fix that makes these numbers move has to be judged
  // against what it costs to make them move.
  const statsBefore = (() => {
    const s = of.stats();
    return { p50: s.frameMs.p50, p95: s.frameMs.p95, p99: s.frameMs.p99,
             fps: s.fps, cpuMs: s.cpuMs, drawCalls: s.draw.calls };
  })();

  // ==========================================================================
  // 4. PROVE THE ENGINE IS LIT. THE GATE. A flat propellant trace behind an
  //    unlit engine is evidence of nothing, and that is exactly the null result
  //    the last pass at this question produced.
  // ==========================================================================
  const aglOnPad = FL().altitudeAglM;
  of.input.act(['throttleFull'], 4);
  await sleep(0.4);
  r = F();
  check('the throttle is wide open', Math.abs(r.flight.throttle - 1) < 1e-6,
        `${r.flight.throttle}`);
  check('and the clamp still holds an UNLIT rocket',
        r.flight.status === 'CLAMPED' && r.flight.thrustN === 0,
        `${r.flight.status}, thrust ${r.flight.thrustN} N`);
  const massBeforeIgnition = FL().massKg;

  of.input.act(['stage'], 6);
  await sleep(0.8);
  r = F();
  check('WITNESS 1: THE ENGINE IS LIT, in newtons off /core\'s telemetry',
        r.flight.thrustN > 1e5, `${r.flight.thrustN} N`);
  check('WITNESS 2: the clamp released', r.flight.status !== 'CLAMPED',
        r.flight.status);
  await sleep(4);
  r = F();
  check('WITNESS 3: MASS IS FALLING, which is propellant leaving under another '
        + 'name and is the one witness no readout can fake',
        FL().massKg < massBeforeIgnition - 100,
        `${massBeforeIgnition.toFixed(1)} -> ${FL().massKg.toFixed(1)} kg`);
  check('WITNESS 4: IT LEFT THE GROUND under power',
        r.flight.liftedOff === true && FL().altitudeAglM > aglOnPad + 5,
        `agl ${aglOnPad.toFixed(2)} -> ${FL().altitudeAglM.toFixed(2)} m`);
  if (fails.length > 0) {
    return { valid: false,
             why: 'THE ENGINE WAS NOT PROVEN LIT, so no instrument reading '
               + 'below would have been evidence of anything',
             fails, log, flight: FL() };
  }

  // ==========================================================================
  // 5. THE TRACE. Straight up, hands off, no staging and no warp: warp changes
  //    the step size and the quantities here are per-tick integrals. Every
  //    instrument that claims to describe fuel or delta-v is sampled together,
  //    so the ones that move and the ones that do not are one measurement.
  // ==========================================================================
  const trace = [];
  const sample = (tag) => {
    const s = FL();
    const rd = RD();
    const t = TANKS();
    const act = rd.stages.find((q) => q.active === true) || rd.stages[0] || null;
    const row = {
      tag, metS: +s.metS.toFixed(2),
      thrustN: Math.round(s.thrustN),
      // GROUND TRUTH and the positive controls. If these do not move, nothing
      // below means anything and the run is void, not red.
      liveTankKg: +t.liveTotalKg.toFixed(1),
      massKg: +s.massKg.toFixed(1),
      remainingDvMS: +s.remainingDvMS.toFixed(1),
      // THE TWO SUSPECTS.
      reportedPropellantKg: s.propellantKg,
      activeStageIndex: act === null ? -1 : act.index,
      activeStageDvMS: act === null ? -1 : +act.dvVacMS.toFixed(2),
      activeStageBurnS: act === null ? -1 : +act.burnS.toFixed(2),
      totalDvMS: +s.totalDvMS.toFixed(2),
    };
    trace.push(row);
    return row;
  };
  const first = sample('ignition+4s');

  const SLICE_S = 5;
  for (let i = 0; i < Math.ceil(BURN_S / SLICE_S); ++i) {
    await of.run(SLICE_S, HZ);
    sample(`t+${(i + 1) * SLICE_S}s`);
    if (FL().status === 'DOWN' || FL().thrustN <= 0) break;
  }
  const last = trace[trace.length - 1];

  const fell = (k, by) => (first[k] - last[k]) > by;
  const moved = (k, by) => Math.abs(first[k] - last[k]) > by;

  // --- the positive controls, first ------------------------------------------
  check('CONTROL: the live per-tank read FELL, so the tanks really did drain '
        + 'and any flat instrument below is the instrument\'s fault',
        fell('liveTankKg', 500),
        `${first.liveTankKg} -> ${last.liveTankKg} kg`);
  check('CONTROL: mass fell with it', fell('massKg', 500),
        `${first.massKg} -> ${last.massKg} kg`);
  check('CONTROL: the "dv left" footer FELL, which is the live '
        + '_of_fl_remaining_dv_vacuum call and proves a live per-flight '
        + 'delta-v read is both possible and already wired',
        fell('remainingDvMS', 100),
        `${first.remainingDvMS} -> ${last.remainingDvMS} m/s`);

  // --- R44 half one: the debug surface ---------------------------------------
  // A one-line fix, entirely in the client: sum the LIVE parts instead of the
  // cached rows. RED before it, GREEN after it.
  check('R44a: of.flight(\'report\').propellantKg FELL during the burn',
        fell('reportedPropellantKg', 500),
        `${first.reportedPropellantKg} -> ${last.reportedPropellantKg} kg while `
        + `the live read went ${first.liveTankKg} -> ${last.liveTankKg} kg`);
  check('R44a: and it AGREES with the live read, so it is the same number and '
        + 'not merely a number that also moves',
        Math.abs(last.reportedPropellantKg - last.liveTankKg) < 2,
        `${last.reportedPropellantKg} vs ${last.liveTankKg} kg`);

  // --- R44 half two: the navball's stage table -------------------------------
  // See the header. This one is NOT fixable in the client.
  const stageDvFell = fell('activeStageDvMS', 50);
  if (EXPECT_LIVE_STAGES) {
    check('R44b: the ACTIVE stage row\'s delta-v FELL as its own tank drained, '
          + 'which is what a player burning stage 0 is watching for',
          stageDvFell,
          `stage ${last.activeStageIndex}: ${first.activeStageDvMS} -> `
          + `${last.activeStageDvMS} m/s`);
  } else {
    check('R44b IS STILL OPEN: the active stage row\'s delta-v did NOT move a '
          + 'metre while the tank feeding it emptied. When somebody lands '
          + 'of_fl_stage_performance this line goes red; re-run with '
          + '--evalargs=\'{"liveStages":1}\' and delete this branch',
          !stageDvFell,
          `stage ${last.activeStageIndex}: ${first.activeStageDvMS} -> `
          + `${last.activeStageDvMS} m/s, which is a FALL and means R44b is fixed`);
  }
  log.push(`the burn: ${first.metS}s -> ${last.metS}s, live tank `
    + `${first.liveTankKg} -> ${last.liveTankKg} kg, reported propellant `
    + `${first.reportedPropellantKg} -> ${last.reportedPropellantKg} kg, `
    + `dv left ${first.remainingDvMS} -> ${last.remainingDvMS} m/s, active `
    + `stage ${last.activeStageIndex} dv ${first.activeStageDvMS} -> `
    + `${last.activeStageDvMS} m/s`);

  // ==========================================================================
  // 6. STALE, OR THE WRONG VESSEL? THE DECIDING MEASUREMENT.
  //
  // Firing a stage is the one moment mid-flight that `refreshParts` runs. So
  // immediately after a real staging the table is as fresh as this code path can
  // ever make it, AND the stage that just fired is physically gone: its engine,
  // its tank and its decoupler have left the vehicle.
  //
  //   a table read off the LIVE craft  -> the departed stage has no engine and
  //                                       no propellant, so its dv is ~0
  //   a table read off the DESIGN      -> the departed stage still reports the
  //                                       full delta-v it had on the pad
  //
  // Whichever of those two the numbers show is the answer, and it decides
  // whether R44b is a refresh-cadence problem (throttle it, split it, run it
  // every frame) or a wrong-source problem (no cadence can fix it).
  // ==========================================================================
  // Burn to dry, so the stage press is the one a pilot would make.
  for (let i = 0; i < 30 && FL().thrustN > 0 && FL().status !== 'DOWN'; ++i) {
    await of.run(SLICE_S, HZ);
  }
  const beforeStaging = {
    stagings: FL().stagings, parts: FL().parts, nextStage: FL().nextStage,
    stages: RD().stages.map((s) => ({ index: s.index, dv: +s.dvVacMS.toFixed(2),
                                      active: s.active })),
  };
  check('the first stage ran dry, so staging is the press a pilot would make '
        + 'here', FL().thrustN <= 0, `${FL().thrustN} N still`);
  of.input.act(['stage'], 6);
  await sleep(0.6);
  const afterStaging = {
    stagings: FL().stagings, parts: FL().parts, nextStage: FL().nextStage,
    stages: RD().stages.map((s) => ({ index: s.index, dv: +s.dvVacMS.toFixed(2),
                                      active: s.active })),
  };
  check('the staging actually fired and threw hardware away',
        afterStaging.stagings > beforeStaging.stagings
          && afterStaging.parts < beforeStaging.parts,
        JSON.stringify({ before: beforeStaging, after: afterStaging }));
  const gone = afterStaging.stages.find((s) => s.index === 0);
  const goneDv = gone === undefined ? -1 : gone.dv;
  const designSourced = Math.abs(goneDv - pad.stage0Dv) < 1;
  check('DIAGNOSIS: with refreshParts freshly run and stage 0 physically off '
        + 'the vehicle, its row still reports the delta-v it had ON THE PAD. '
        + 'The stage table is not STALE, it is reading the DESIGN '
        + '(_of_vs_stage_performance takes the design handle), so no refresh '
        + 'cadence can ever make it move',
        designSourced,
        `stage 0 reads ${goneDv} m/s, pad value ${pad.stage0Dv} m/s; if these `
        + `now DIFFER the table has become live and this diagnosis is stale`);

  // FRAME TIME AFTER. Same shape as the before sample, taken after the same
  // renderer has been running the whole flight.
  const statsAfter = (() => {
    const s = of.stats();
    return { p50: s.frameMs.p50, p95: s.frameMs.p95, p99: s.frameMs.p99,
             fps: s.fps, cpuMs: s.cpuMs, drawCalls: s.draw.calls,
             budget: s.budget };
  })();

  return {
    valid: true,
    pass: fails.length === 0,
    expectLiveStages: EXPECT_LIVE_STAGES,
    fails,
    log,
    pad,
    padStages,
    verdict: {
      // The three questions this file exists to answer, as booleans.
      livePropellantMoves: fell('liveTankKg', 500),
      reportedPropellantMoves: fell('reportedPropellantKg', 500),
      activeStageDvMoves: stageDvFell,
      remainingDvMoves: fell('remainingDvMS', 100),
      totalDvMoves: moved('totalDvMS', 1),
      stageTableIsDesignSourced: designSourced,
    },
    staging: { before: beforeStaging, after: afterStaging,
               jettisonedStage0DvMS: goneDv, padStage0DvMS: pad.stage0Dv },
    frame: { before: statsBefore, after: statsAfter },
    trace,
    flight: FL(),
  };
})()
