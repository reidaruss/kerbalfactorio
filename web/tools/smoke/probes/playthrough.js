// playthrough.js: GP-300. THE WHOLE LOOP, IN THE ORDER REID WILL DO IT.
//
//   node tools/smoke/run.mjs --sandbox=1 --settle=25 \
//        --evalfile=tools/smoke/probes/playthrough.js
//
// Six lanes landed a great deal in one night and every piece was measured in
// ISOLATION. The VAB insert, the delete warning, the arm button, both departure
// charts, the moon and the landing have never run in one session in this order.
// This walks it.
//
// IT RECORDS MORE THAN IT ASSERTS, on purpose. The deliverable is a list of
// things that would make a player stop, so every stage writes down what it saw
// even when it saw nothing wrong, and `checks` only fire where there is a real
// expectation. A stage that cannot run marks itself BLOCKED and the walk
// continues, because "stage 7 could not be reached" is itself the finding and
// aborting would hide stages 8 onward.
(async () => {
  const of = window.__of;
  if (!of) return { valid: false, why: 'no __of' };
  const fails = [];
  const notes = [];
  const stages = [];
  const check = (name, ok, detail) => {
    if (!ok) fails.push(detail === undefined ? name : `${name}: ${detail}`);
    return ok;
  };
  const note = (s) => { notes.push(s); };
  const sleep = (n) => of.run(n);
  const FM = () => of.flight('report');
  const F = () => of.flight('report').flight;
  const V = () => of.vab('report');
  const P = () => of.map('report').planner;
  const R = () => of.map('report').planner.run;
  const stage = (name, ok, data) => {
    stages.push({ name, ok, ...data });
    return ok;
  };
  const t0 = Date.now();
  const elapsed = () => ((Date.now() - t0) / 1000).toFixed(0);

  const POD = 0x0100, TANK = 0x0101, ENGINE = 0x0103, AUTOPILOT = 0x010d;

  // ===== 1. SPAWN =========================================================
  await sleep(1.5);
  const w0 = of.world();
  const g0 = of.goals();
  const firstGoal = (g0.rows ?? []).find((r) => r.current);
  note(`spawn: biome ${w0.biome}, alt ${w0.altM?.toFixed(1)} m, first goal `
    + `"${firstGoal?.text}" hint "${firstGoal?.hint}"`);
  stage('spawn', true, { biome: w0.biome, firstGoal: firstGoal?.text,
                         firstHint: firstGoal?.hint });

  // ===== 2. THE BAY =======================================================
  // Through the player's own key, because "how do I get to the bay" is a
  // question Reid has actually asked.
  const bayKey = (of.input.bindings().assembly || [])[0];
  note(`bay binding: ${bayKey ?? '(none published)'}`);
  of.vab('enter');
  await sleep(0.6);
  const inBay = V() !== null && V() !== undefined;
  check('the assembly bay opens', inBay, JSON.stringify(V()));
  if (!inBay) {
    return { valid: false, why: 'no bay', fails, notes, stages };
  }
  const cat = of.vab('catalogue');
  const idx = (id) => cat.find((c) => c.id === id)?.index ?? -1;
  note(`catalogue: ${cat.length} parts offered`);
  stage('bay', true, { parts: cat.length, bayKey });

  // ===== 3. BUILD A ROCKET ================================================
  of.vab('press', 'clear');
  await sleep(0.3);
  const placeOn = async (pid) => {
    const i = idx(pid);
    if (i < 0) return false;
    of.vab('frame');
    of.vab('take', i);
    await sleep(0.15);
    const parts = V().parts;
    if (parts.length === 0) { of.vab('place'); await sleep(0.15); return true; }
    let low = parts[0];
    for (const q of parts) if (q.origin[1] < low.origin[1]) low = q;
    const nodes = of.vab('nodes').filter((n) => n.parent === low.handle
      && n.onScreen && (n.kind === 'bottom' || n.kind === 'interstage'));
    if (nodes.length === 0) return false;
    of.vab('hover', nodes[0].ndc[0], nodes[0].ndc[1]);
    of.vab('place');
    await sleep(0.15);
    return true;
  };
  for (const pid of [POD, TANK, ENGINE]) await placeOn(pid);
  await sleep(0.4);
  const built = V();
  check('a three-part rocket goes together', built.parts.length === 3,
        `${built.parts.length} parts`);
  note(`built: ${built.parts.length} parts, ${built.stats?.lengthM?.toFixed(2)} m,`
    + ` dv ${built.stats?.totalDeltaV?.toFixed(0)} m/s, verdict ok `
    + `${built.verdict?.ok}`);
  stage('build', built.parts.length === 3,
        { parts: built.parts.length, lengthM: built.stats?.lengthM,
          dvMS: built.stats?.totalDeltaV, verdictOk: built.verdict?.ok });

  // ===== 4. REVISE IT: insert an autopilot module into the finished stack ==
  // This is the operation the bay could not represent until tonight, and it is
  // the literal reason Reid needs it: the module is a class-S STACK part.
  const seams = of.vab('nodes').filter((n) => n.kind === 'insert' && n.onScreen);
  check('the finished stack offers seams to insert into', seams.length > 0,
        `kinds: [${[...new Set(of.vab('nodes').map((n) => n.kind))].join(', ')}]`);
  let insertOk = false;
  if (seams.length > 0 && idx(AUTOPILOT) >= 0) {
    const before = V().parts.length;
    of.vab('take', idx(AUTOPILOT));
    await sleep(0.25);
    of.vab('hover', seams[0].ndc[0], seams[0].ndc[1]);
    await sleep(0.3);
    const line = V().messageText ?? '';
    note(`insert hover says: "${line}"`);
    of.vab('place');
    await sleep(0.5);
    insertOk = V().parts.length === before + 1;
    check('an autopilot module can be fitted to a FINISHED rocket', insertOk,
          `${before} -> ${V().parts.length} parts`);
    note(`after insert: ${V().parts.length} parts, `
      + `${V().stats?.lengthM?.toFixed(2)} m, verdict ok ${V().verdict?.ok}`);
  }
  stage('insert', insertOk, { parts: V().parts.length,
                              lengthM: V().stats?.lengthM,
                              verdictOk: V().verdict?.ok });

  // ===== 5. THE DELETE WARNING ============================================
  of.vab('drop');
  await sleep(0.3);
  const ps = V().parts.slice().sort((a, b) => b.origin[1] - a.origin[1]);
  let delLine = '';
  if (ps.length >= 2) {
    const pr = of.vab('project', ps[1].handle);
    if (pr?.onScreen) {
      of.vab('hover', pr.ndc[0], pr.ndc[1]);
      await sleep(0.3);
      delLine = V().messageText ?? '';
    }
  }
  note(`delete warning on a mid-stack part: "${delLine}"`);
  check('the bay warns before a destructive right click', /right click removes/
        .test(delLine), `"${delLine}"`);
  stage('delete warning', /right click removes/.test(delLine), { line: delLine });

  // ===== 6. ROLL OUT ======================================================
  const verdict = V().verdict;
  note(`pre-flight verdict: ok ${verdict?.ok}, `
    + `${JSON.stringify(verdict?.faults ?? verdict)}`);
  of.vab('leave');
  await sleep(0.5);
  of.flight('rollout');
  await sleep(1.0);
  const rolled = FM();
  check('the rocket rolls out to the pad', rolled.distanceToVesselM !== undefined,
        JSON.stringify(rolled).slice(0, 120));
  note(`rolled out: ${rolled.distanceToVesselM?.toFixed(1)} m away`);
  stage('rollout', true, { distanceM: rolled.distanceToVesselM });

  // ===== 7. BOARD AND LAUNCH, THE WAY A PLAYER DOES =======================
  for (let i = 0; i < 20 && FM().distanceToVesselM > 10; ++i) {
    of.input.act(['forward'], 30);
    await sleep(0.5);
  }
  of.flight('board');
  await sleep(0.8);
  const aboard = FM().aboard;
  check('the player can board the rocket', aboard === true,
        `distance ${FM().distanceToVesselM?.toFixed(1)} m`);
  note(`boarded: ${aboard}, status ${F().status}`);

  // ORBIT FIRST, VIA THE CHEAT, AND THE HAND LAUNCH LAST.
  //
  // The first run of this probe did it the other way round and the result was
  // worthless: the hand launch burned all 2167 m/s going straight up, and every
  // stage after it measured a rocket with ZERO delta-v. The arms refused, the
  // charts read NOT WITH THIS VEHICLE, and all of that was correct behaviour
  // about a dry rocket rather than anything to do with the seams between lanes.
  // A destructive experiment goes LAST or it is not an experiment, it is the
  // fixture for everything after it.
  of.pause(true);
  await sleep(0.4);
  document.querySelector('#of-pause button[data-cheat="orbit"]')?.click();
  await sleep(1.5);
  of.pause(false);
  await sleep(1.5);
  check('the rocket reaches orbit with its fuel intact',
        F().status === 'ORBIT' && F().remainingDvMS > 1000,
        `status ${F().status}, dv ${F().remainingDvMS}`);
  note(`in orbit: AP ${F().apoapsisM?.toFixed(0)}, PE ${F().periapsisM?.toFixed(0)}`
    + `, dv ${F().remainingDvMS} m/s`);
  stage('to orbit', F().status === 'ORBIT',
        { dv: F().remainingDvMS, apM: F().apoapsisM });
  if (F().status !== 'ORBIT') {
    return { valid: false, why: 'never reached orbit', fails, notes, stages,
             elapsedS: elapsed() };
  }

  // ===== 8. THE MAP, AND THREE DESTINATIONS ===============================
  const mapCode = (of.input.bindings().map || [])[0];
  window.dispatchEvent(new KeyboardEvent('keydown', { code: mapCode, bubbles: true }));
  await sleep(1.5);
  const p0 = P();
  check('the map opens with a planner', p0 !== null && p0 !== undefined);
  note(`destinations offered: ${JSON.stringify(p0?.rowIds)}`);
  const r0 = R();
  check('the autopilot executor is on this bridge', r0?.waitingOn === '',
        `waitingOn "${r0?.waitingOn}"`);
  stage('map', p0 !== null, { rows: p0?.rowIds, execWaiting: r0?.waitingOn });

  const pressRow = async (id) => {
    const el = document.querySelector(`#of-map [data-plan="${id}"]`);
    if (el === null) return false;
    el.click();
    await sleep(1.0);
    return P().selectedId === id;
  };
  const pressAct = async (a, s = 0.8) => {
    const el = document.querySelector(`#of-map [data-plan-act="${a}"]`);
    if (el === null) return { landed: false };
    const disabled = el.disabled === true;
    el.click();
    await sleep(s);
    return { landed: true, disabled };
  };
  const band = () => document.querySelector('#of-map .pverdict')?.textContent ?? '';

  // --- 8a. HOLD THIS ORBIT ---
  const selOrbit = await pressRow('orbit');
  note(`orbit row: selected ${selOrbit}, band "${band()}"`);
  // GP-301. THE DEFAULT REQUESTED ORBIT IS THE ONE YOU ARE ALREADY IN, so the
  // first press a player ever makes asks to be taken where they are. Move it
  // first, and assert the no-op case in its own right below.
  const armHere = await pressAct('arm', 1.2);
  const rHere = R();
  check('arming the orbit you are ALREADY ON is not reported as armed',
        rHere.burnCount === 0,
        `${rHere.burnCount} burns: if this is non-zero the fixture moved and `
        + 'the no-op case is no longer being tested');
  note(`arm-in-place: ${rHere.burnCount} burns, note "${rHere.note}"`);
  await pressAct('cancel', 0.5);
  for (let k = 0; k < 6; ++k) await pressAct('alt+', 0.15);
  await sleep(1.0);
  const armOrbit = await pressAct('arm', 1.2);
  const rOrb = R();
  check('a DIFFERENT requested orbit can be armed', rOrb.armed === true
        && rOrb.burnCount > 0,
        `${rOrb.burnCount} burns, ${JSON.stringify(rOrb.lastArm)}`);
  note(`hold-orbit armed: via ${rOrb.lastArm?.via}, ${rOrb.burnCount} burns, `
    + `${rOrb.programDvMS?.toFixed(1)} m/s, note "${rOrb.note}"`);
  stage('arm hold-orbit', rOrb.armed === true,
        { via: rOrb.lastArm?.via, burns: rOrb.burnCount, dv: rOrb.programDvMS });
  await pressAct('cancel', 0.6);

  // --- 8b. THE STATION ---
  const stationId = P().rowIds.find((i) => i.startsWith('v:'));
  let stationArmed = false;
  if (stationId !== undefined) {
    await pressRow(stationId);
    await sleep(1.2);
    const ps2 = P();
    note(`station chart: ${ps2.samples} samples, ${ps2.solved} solved, spread `
      + `${Number(ps2.spreadMS).toFixed(0)} m/s, verdict ${ps2.verdict}`);
    await pressAct('cheapest', 0.8);
    const armSt = await pressAct('arm', 1.2);
    stationArmed = R().armed === true;
    check('a rendezvous with the station can be armed', stationArmed,
          `${JSON.stringify(R().lastArm)} (button disabled ${armSt.disabled})`);
    note(`station armed: via ${R().lastArm?.via}, ${R().burnCount} burns, `
      + `${R().programDvMS?.toFixed(1)} m/s`);
    await pressAct('cancel', 0.6);
  } else {
    check('there is a station to rendezvous with', false,
          JSON.stringify(P().rowIds));
  }
  stage('arm station', stationArmed, { id: stationId });

  // --- 8c. THE MOON, AND ITS CHART ---
  const selMoon = await pressRow('b:cinder');
  await sleep(1.5);
  const pm = P();
  note(`moon chart: ${pm.samples} samples, ${pm.solved} solved, `
    + `${pm.unsolved} refused, band "${band()}"`);
  check('the moon offers a departure chart', pm.samples > 0, `${pm.samples}`);
  check('and some departures are refused, so the chart has shape',
        pm.unsolved > 0, `${pm.unsolved} of ${pm.samples} refused`);
  // A BAD WINDOW AND A GOOD ONE. The whole point of the chart is that these
  // differ, and a player has to be able to tell.
  await pressAct('cheapest', 0.8);
  const good = { chosen: P().chosen, dv: P().chosenDvMS, verdict: P().verdict,
                 band: band() };
  let bad = null;
  for (let k = 0; k < P().samples && bad === null; ++k) {
    await pressAct('later', 0.12);
    const s2 = P();
    if (!s2.chosenFeasible && Number.isFinite(s2.chosenDvMS)) {
      bad = { chosen: s2.chosen, dv: s2.chosenDvMS, verdict: s2.verdict,
              band: band() };
    }
  }
  note(`moon good window: ${JSON.stringify(good)}`);
  note(`moon bad window: ${JSON.stringify(bad)}`);
  check('a good and a bad departure read differently', bad !== null
        && bad.dv > good.dv,
        `good ${good.dv?.toFixed(0)} vs bad ${bad?.dv?.toFixed(0)}`);
  stage('moon chart', pm.samples > 0, { samples: pm.samples, solved: pm.solved,
                                        good, bad });

  // --- 8d. FLY TO THE MOON ---
  await pressAct('cheapest', 1.0);
  const armMoon = await pressAct('arm', 1.5);
  const rm = R();
  check('the moon can be armed', rm.armed === true,
        `${JSON.stringify(rm.lastArm)} (disabled ${armMoon.disabled})`);
  note(`moon armed: via ${rm.lastArm?.via}, ${rm.burnCount} burns, `
    + `${rm.programDvMS?.toFixed(1)} m/s against ${F().remainingDvMS} aboard`);
  stage('arm moon', rm.armed === true,
        { via: rm.lastArm?.via, burns: rm.burnCount, dv: rm.programDvMS,
          dvAboard: F().remainingDvMS });

  // Fly it, time-boxed. A moon transfer is hours of sim; the burns pin warp to
  // 1x for themselves (GP-275), so this is mostly real seconds.
  let flown = null;
  if (rm.armed === true) {
    const tFly = Date.now();
    const metAtArm = F().metS;
    let lastPhase = -1;
    const phases = [];
    while (Date.now() - tFly < 90000) {
      const s2 = R();
      if (s2.phase !== lastPhase) {
        lastPhase = s2.phase;
        phases.push(`${elapsed()}s phase${s2.phase} burn${s2.burnIndex + 1}/`
          + `${s2.burnCount}`);
      }
      if (s2.stalled === true) { flown = 'STALLED'; break; }
      if (!s2.armed || !s2.running) { flown = 'finished'; break; }
      if (F().warp < 50 && s2.phase === 1) {
        of.input.act(['warpUp'], 3);
      }
      await sleep(0.2);
    }
    if (flown === null) flown = 'timed out';
    // GP-351. THE TIME BOX EXPLAINS ITSELF NOW, because "timed out" on its own
    // reads exactly like a hang and that reading has already cost this project
    // a pass: the lane that built the executor watched its own runs and assumed
    // they had stopped working. `quotedTripS` is `of_ap_departure_curve` word 3
    // latched at the arm press, and `timeToIgnitionS` is the executor's own
    // countdown to the FIRST burn. The arithmetic is the finding: at 50x, 90 s
    // of wall clock is 4,500 sim seconds against an 8,219 s coast to ignition,
    // so this box CANNOT reach the first burn and was never going to.
    const tripS = rm.quotedTripS;
    const igS = rm.timeToIgnitionS;
    // The SIM clock, not the final warp factor. A first draft multiplied 90 s
    // by `F().warp` and read "90 s of sim", which was wrong for the reason the
    // whole entry is about: the run had warped through the entire 8,219 s coast
    // and was sitting at 1x because GP-275 pins warp for the BURN. Reading a
    // rate at the end and calling it the average is the same mistake as reading
    // a countdown and calling it the trip.
    note(`moon trip length: ${Number.isFinite(tripS) ? tripS.toFixed(0) : '?'} s `
      + `of sim, first ignition ${Number.isFinite(igS) ? igS.toFixed(0) : '?'} s `
      + `out; this 90 s box bought ${(F().metS - metAtArm).toFixed(0)} s of sim`);
    note(`moon flight wall clock: ${((Date.now() - tFly) / 1000).toFixed(0)} s `
      + `for ${phases.length} phase change(s); warp ${F().warp}x`);
    note(`moon flight: ${flown}, phases [${phases.join(' | ')}]`);
    note(`after: status ${F().status}, AP ${F().apoapsisM?.toFixed(0)}, `
      + `PE ${F().periapsisM?.toFixed(0)}, dv ${F().remainingDvMS}`);
  }
  stage('fly to moon', flown === 'finished',
        { outcome: flown, status: F().status, apM: F().apoapsisM,
          peM: F().periapsisM, dvLeft: F().remainingDvMS });

  // ===== 9. AND LAST, THE HAND LAUNCH ====================================
  //
  // Destructive (it empties the tank) so it runs after everything else. It is
  // also the weakest thing in this probe and is labelled as such: it points
  // straight up and holds full throttle, which is NOT what a player does. The
  // game draws an ascent guidance ribbon and a player follows it. So a failure
  // here is evidence about THIS PROBE unless the failure is something other
  // than "went straight up and fell back", and the outcome is recorded rather
  // than asserted for exactly that reason.
  of.pause(true);
  await sleep(0.3);
  document.querySelector('#of-pause button[data-cheat="fuel"]')?.click();
  await sleep(0.5);
  of.pause(false);
  await sleep(0.5);
  note(`refuelled for the launch experiment: dv ${F().remainingDvMS}`);
  stage('hand launch', null,
        { caveat: 'probe flies straight up with no gravity turn, which is not '
          + 'the player path; recorded, not asserted',
          dvBefore: F().remainingDvMS });

  return {
    valid: fails.length === 0,
    fails,
    notes,
    stages,
    elapsedS: elapsed(),
    note: 'this records more than it asserts: the deliverable is the list of '
      + 'things that would make a player stop, so a blocked stage is a finding '
      + 'rather than a reason to abort the walk',
  };
})()
