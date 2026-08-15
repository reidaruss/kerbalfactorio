// autoapproach.js: PH-382 to PH-386. R99's AUTO-APPROACH, END TO END
// (D-015's SECOND layer, behind Reid's task-39 ruling).
//
//   node tools/smoke/run.mjs --sandbox=1 --settle=25 --wait=600000 \
//        --evalfile=tools/smoke/probes/autoapproach.js
//
// =============================================================================
// WHAT THIS IS FOR.
//
// `probes/docking.js` proves a player can HAND FLY a capture, which is D-015's
// first layer and is what Reid's task 39 says must come first ("the first
// station mission is hand flown and difficult on purpose"). This proves the
// second layer: the program that flies the last hundred metres for you, and
// that it is NOT AVAILABLE until the hand-flown mission has been done.
//
// The flight law is `of::approach::guide` in /core, ctest-pinned by
// `core/tests/test_approach.cpp` since PH-174 and, until R99, called by
// nothing. Nothing here re-derives it; every judgement below is read back off
// the bridge (`of_dk_approach`) or off `of/docking.h` (`of_dk_candidate`).
//
// =============================================================================
// THE FOUR WAYS THIS COULD GO GREEN HAVING MEASURED NOTHING, NAMED BEFORE
// MEASURING.
//
//  1. NO RCS. The program's whole output is a translation command; a craft with
//     no thrusters would sit still and every "it did not overspeed" check would
//     pass. Section 0 asserts `availableN > 0` and fails loudly.
//  2. NO PORT / NO STATION. Same shape as `docking.js`'s antecedents 1 and 2.
//  3. THE BRIDGE IS OLD. `of_dk_approach` is additive at ABI 26 and detected by
//     symbol presence, so a client running against a wasm built before it
//     REFUSES BY NAME rather than throwing -- which is correct behaviour and
//     would also make every check below pass for the wrong reason. Section 0
//     asserts `waitingOn` is empty and says which names are missing if not.
//  4. A GATE THAT IS ALWAYS OPEN. Section 1 is the negative control: before the
//     station milestone the verb must refuse, say why, and change nothing.
//
// =============================================================================
// WHY THE MILESTONE IS EARNED BY BOARDING AND NOT BY A SETTER.
//
// There is no debug granter for a milestone and this probe does not add one:
// `StationReveal.ts` grants `StationBoarded` on the rising edge of the walker
// standing on Anchorage's frame, and `of.carrier('seat')` is the SHIPPED
// arrival (`probes/stationreveal.js` section 4 drives the same call). So the
// unlock in this probe happens the way it happens in the game, which is the
// only version of a progression gate worth testing.
(async () => {
  const of = window.__of;
  if (!of) return { valid: false, why: 'no __of' };
  const fails = [];
  const rows = [];
  const check = (name, ok, detail) => {
    if (!ok) fails.push(detail === undefined ? name : `${name}: ${detail}`);
    return ok;
  };
  const rec = (k, v, note) => rows.push(note === undefined ? [k, v] : [k, v, note]);
  // 60 rendered frames per sim second rather than the 144 default. The FIXED
  // tick rate is untouched, so the program runs identically; this only stops
  // the probe spending two thirds of its wall clock rasterising frames nobody
  // looks at. The approach is minutes of sim time by design (`closeGainPerS`
  // 0.05 means the last 20 m alone is ln(20/0.6)/0.05 = 70 s) and that is the
  // law's, not this probe's, so the probe economises where it may.
  const sleep = (n) => of.run(n, 60);
  const F = () => of.flight('report');
  const D = () => of.flight('report').dock;
  const A = () => of.flight('report').dock.approach;
  const V = () => of.flight('vessels');
  const MILES = () => of.game()?.progress?.research?.milestones ?? [];
  const STATION_BOARDED = 0x0004;    // research.h milestones::StationBoarded
  const len3 = (a) => Math.hypot(a[0], a[1], a[2]);
  const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
  const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  const n3 = (a) => { const l = len3(a) || 1; return mul(a, 1 / l); };
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2],
                           a[0] * b[1] - a[1] * b[0]];

  // ==========================================================================
  // SECTION 0. THE FIXTURE: A ROCKET WITH A PORT ON THE NOSE **AND RCS**.
  //
  // `docking.js`'s fixture has no thrusters, because a hand dock in that probe
  // is a debug placement. This one has to actually fly, so the monoprop tank
  // and the RCS block are part of the antecedent and not an extra.
  // ==========================================================================
  await sleep(0.8);
  of.build(0);
  of.vab('enter');
  await sleep(0.4);
  const cat = of.vab('catalogue');
  of.vab('press', 'clear');
  await sleep(0.15);

  const takePlace = async (pid, wantKind) => {
    const i = cat.find((c) => c.id === pid)?.index ?? -1;
    if (i < 0) return false;
    of.vab('frame');
    of.vab('take', i);
    await sleep(0.15);
    const parts = of.vab('report').parts;
    if (parts.length === 0) { of.vab('place'); await sleep(0.15); return true; }
    let pick = parts[0];
    for (const p of parts) {
      if (wantKind === 'top' ? p.origin[1] > pick.origin[1]
                             : p.origin[1] < pick.origin[1]) pick = p;
    }
    const kinds = wantKind === 'top' ? ['top'] : ['bottom', 'interstage'];
    const nodes = of.vab('nodes').filter((n) => n.parent === pick.handle
      && n.onScreen && kinds.includes(n.kind));
    if (nodes.length === 0) return false;
    of.vab('hover', nodes[0].ndc[0], nodes[0].ndc[1]);
    of.vab('place');
    await sleep(0.15);
    return true;
  };
  await takePlace(0x0100, 'bottom');                    // Pod
  const portPlaced = await takePlace(0x0115, 'top');    // Docking Port, on top
  await takePlace(0x0101, 'bottom');                    // Tank
  await takePlace(0x0111, 'bottom');                    // Monopropellant tank
  await takePlace(0x0103, 'bottom');                    // Engine
  // The RCS block is RADIAL: it goes on a surface node, not a stack node.
  {
    const i = cat.find((c) => c.id === 0x0110)?.index ?? -1;
    if (i >= 0) {
      of.vab('frame');
      of.vab('take', i);
      await sleep(0.15);
      const radial = of.vab('nodes').filter((n) => n.onScreen && n.kind === 'radial');
      if (radial.length > 0) {
        of.vab('hover', radial[0].ndc[0], radial[0].ndc[1]);
        of.vab('place');
        await sleep(0.2);
      }
    }
  }
  rec('vab parts after build', of.vab('report').parts.map((p) => p.partId));
  of.vab('leave');
  await sleep(0.4);
  of.flight('rollout');
  await sleep(0.8);
  for (let i = 0; i < 16 && F().distanceToVesselM > 10; ++i) {
    of.input.act(['forward'], 30);
    await sleep(0.6);
  }
  of.flight('board');
  await sleep(0.6);
  of.pause(true);
  await sleep(0.35);
  document.querySelector('#of-pause button[data-cheat="orbit"]')?.click();
  await sleep(1.5);
  document.querySelector('#of-pause button[data-cheat="fuel"]')?.click();
  await sleep(0.5);
  of.pause(false);
  await sleep(1.2);

  check('fixture: aboard and in orbit',
        F().flight.status === 'ORBIT' && F().aboard === true,
        `status ${F().flight.status} aboard ${F().aboard}`);
  check('fixture: the rocket carries a docking port', D().hasPort === true,
        `hasPort ${D().hasPort} placed ${portPlaced}`);
  check('fixture: there is a station to dock with', D().hasTarget === true,
        `hasTarget ${D().hasTarget} target "${D().targetName}"`);
  // ANTECEDENT 1. Without thrusters the program has no output at all.
  const rcs0 = F().flight.rcs ?? null;
  rec('fixture: rcs row', rcs0);
  check('fixture: THE CRAFT HAS WORKING RCS, or the program has no hands',
        rcs0 !== null && rcs0.availableN > 0 && rcs0.monopropKg > 0,
        JSON.stringify(rcs0));
  // ANTECEDENT 3. An old wasm refuses BY NAME, which is correct and is also a
  // state in which every check below would pass having proved nothing.
  rec('fixture: approach exports waitingOn', A().raw.waitingOn);
  check('fixture: `of_dk_approach` is ON THE BRIDGE (rebuild the wasm if not)',
        A().raw.waitingOn === '',
        `waiting on ${A().raw.waitingOn} -- run web/wasm/build.ps1 -SkipNative`);
  if (D().hasTarget !== true || D().hasPort !== true
      || A().raw.waitingOn !== '' || !(rcs0?.availableN > 0)) {
    return { valid: false, why: 'fixture incomplete', fails, rows,
             dock: D(), rcs: rcs0 };
  }
  const station = V().list.find((v) => v.status === 'station:anchorage') ?? null;
  check('fixture: Anchorage is a registry record', station !== null);
  if (station === null) return { valid: false, why: 'no station', fails, rows };
  rec('/core limits [radius m, cone deg, max closing m/s]',
      [D().captureRadiusM, D().coneLimitDeg, D().maxClosingMS],
      'read off the PART through docking::Limits; nothing on this side types them');

  // ==========================================================================
  // SECTION 1. THE NEGATIVE CONTROL: LOCKED UNTIL THE STATION HAS BEEN VISITED.
  //
  // This is Reid's task-39 ordering, measured. The autopilot sits BEHIND the
  // hand-flown station mission, so in a fresh world the verb must refuse, must
  // say what would open it, and must leave the vehicle alone.
  // ==========================================================================
  check('SECTION 1 fixture: StationBoarded is NOT earned in a fresh world',
        MILES().filter((m) => m === STATION_BOARDED).length === 0,
        JSON.stringify(MILES()));
  const locked = A();
  rec('SECTION 1  [unlocked, available, why]',
      [locked.unlocked, locked.available, locked.why]);
  check('the control reports itself LOCKED', locked.unlocked === false,
        `unlocked ${locked.unlocked}`);
  check('and it is not offered', locked.available === false);
  check('and it names the PROGRESSION gate rather than going dark, which is '
        + 'the only way a player learns the feature is coming',
        /lock/i.test(locked.why) && /station/i.test(locked.why),
        `why "${locked.why}"`);

  const refusals0 = F().refusals;
  const pressLocked = of.flight('approach');
  rec('SECTION 1  press while locked -> ok', pressLocked.ok);
  check('PRESSING IT REFUSES', pressLocked.ok === false);
  check('and the refusal is COUNTED, so it is visible from outside',
        pressLocked.report.refusals === refusals0 + 1,
        `${refusals0} -> ${pressLocked.report.refusals}`);
  check('and the message says which gate is shut',
        /lock/i.test(String(pressLocked.report.message)),
        `"${pressLocked.report.message}"`);
  check('and NOTHING ARMED', pressLocked.report.dock.approach.running === false
        && pressLocked.report.dock.approach.approaches === 0,
        JSON.stringify(pressLocked.report.dock.approach.running));
  // THE CHIP. A locked control that is invisible is a feature nobody finds.
  const apprChip = () => {
    const el = document.querySelector('#of-navball .chip.appr');
    return el === null ? null : el.textContent.trim();
  };
  rec('SECTION 1  the DOM chip while locked', apprChip());
  check('THE LOCKED CONTROL IS ON THE SCREEN AND SAYS WHY',
        apprChip() !== null && /AUTO/.test(apprChip())
        && /lock/i.test(apprChip()),
        `chip ${JSON.stringify(apprChip())}`);

  // ==========================================================================
  // SECTION 2. EARN IT THE WAY THE GAME DOES: BOARD ANCHORAGE.
  //
  // Leave the vessel (it stays in the registry, on rails), take the shipped
  // station arrival, then resume control remotely. Three verbs that all ship;
  // no milestone is written by hand anywhere in this probe.
  // ==========================================================================
  const flownId = V().list.find((v) => v.promoted === true)?.id ?? 0;
  check('SECTION 2 fixture: the flown vessel has a registry id', flownId > 0);
  of.flight('leave');
  await sleep(0.6);
  const seat = of.carrier('seat');
  rec('SECTION 2  the shipped station arrival', seat?.carrier ?? seat?.error);
  await sleep(1.5);
  check('SECTION 2 THE MILESTONE IS EARNED, EXACTLY ONCE, BY BOARDING',
        MILES().filter((m) => m === STATION_BOARDED).length === 1,
        JSON.stringify(MILES()));
  const resumed = of.flight('resume', flownId);
  await sleep(1.0);
  check('SECTION 2 fixture: control of the vessel comes back',
        resumed.ok === true && F().aboard === true,
        `ok ${resumed.ok} aboard ${F().aboard}`);
  const unlockedPub = A();
  rec('SECTION 2  [unlocked, available, why]',
      [unlockedPub.unlocked, unlockedPub.available, unlockedPub.why]);
  check('THE SAME CONTROL IS NOW UNLOCKED, and nothing but the milestone '
        + 'changed', unlockedPub.unlocked === true,
        `unlocked ${unlockedPub.unlocked} why "${unlockedPub.why}"`);

  // ==========================================================================
  // SECTION 3. A NEAR-RENDEZVOUS FIXTURE, AND THE PROGRAM TAKES IT FROM THERE.
  //
  // The placement reads the game's own live port pose (`of.flight('dockTarget')`
  // is the object the capture test is armed with) and offsets along it, so this
  // probe holds no second opinion about where the port is -- `docking.js`'s own
  // argument for the same call.
  //
  // 45 m out along the port's face with 12 m of LATERAL error, which is
  // deliberately outside the corridor at that range so the ALIGN leg is
  // exercised and not skipped. The relative velocity is zero, which is where
  // `transfer.h`'s rendezvous puts a vehicle down (PH-154 measured 108.87 m at
  // 0.23133 m/s), so this is the state the program was written to pick up.
  // ==========================================================================
  const port = () => of.flight('dockTarget');
  const p0 = port();
  check('SECTION 3 fixture: a live port pose is published',
        Array.isArray(p0?.posM), JSON.stringify(p0));
  if (!Array.isArray(p0?.posM)) {
    return { valid: false, why: 'no dockTarget pose', fails, rows };
  }
  {
    const face = n3(p0.faceAxis);
    let side = cross(face, [0, 1, 0]);
    if (len3(side) < 1e-6) side = cross(face, [1, 0, 0]);
    side = n3(side);
    const pos = add(add(p0.posM, mul(face, 45)), mul(side, 12));
    // Nose pointing 40 degrees off the docking attitude, so the ALIGN leg has a
    // slew to do and `aimErrorDeg` starts as a real number rather than 0.
    const fwd = n3(add(mul(face, -Math.cos(0.7)), mul(side, Math.sin(0.7))));
    let right = cross(fwd, [0, 1, 0]);
    if (len3(right) < 1e-6) right = cross(fwd, [1, 0, 0]);
    of.flight('place', { pos, vel: p0.velMS, fwd, right: n3(right) });
  }
  await sleep(0.4);
  const start = A();
  rec('SECTION 3  start [range m, along m, lateral m, aim deg]',
      [+start.raw.rangeM.toFixed(2), +start.raw.alongM.toFixed(2),
       +start.raw.lateralM.toFixed(2), +start.raw.aimErrorDeg.toFixed(1)]);
  check('the fixture really is off the axis, or ALIGN is never exercised',
        start.raw.lateralM > 8, `lateral ${start.raw.lateralM} m`);
  check('and really is pointing the wrong way, or the aim gate is never tested',
        start.raw.aimErrorDeg > 20, `aim ${start.raw.aimErrorDeg} deg`);
  check('the manual DOCK is NOT available from here, which is what makes this '
        + 'an approach rather than a latch', D().available === false,
        `why "${D().why}"`);

  const press = of.flight('approach');
  await sleep(0.3);
  const armed = A();
  rec('SECTION 3  press -> ok', press.ok);
  rec('SECTION 3  after arming [running, leg, note]',
      [armed.running, armed.legWord, armed.why]);
  check('THE PRESS ARMS IT', press.ok === true,
        `message "${press.report.message}"`);
  check('and the counter moved, so the press is not a redraw',
        armed.approaches === 1, `approaches ${armed.approaches}`);
  check('and the program says it is running', armed.running === true);
  check('and it starts in ALIGN, because the fixture is off the axis: the leg '
        + 'is /core\'s decomposition and not this probe\'s arithmetic',
        armed.legWord === 'ALIGNING', `leg "${armed.legWord}"`);
  check('and the thrusters are actually being commanded',
        armed.raw.rcsCommand > 0, `rcsCommand ${armed.raw.rcsCommand}`);
  rec('SECTION 3  the DOM chip while running', apprChip());
  check('the chip says the ship is flying itself', apprChip() !== null
        && /AUTO/.test(apprChip()), `chip ${JSON.stringify(apprChip())}`);

  // ==========================================================================
  // SECTION 4. IT FLIES ITSELF INTO THE ENVELOPE, INSIDE A BOUNDED SIM TIME,
  // AND NEVER ARRIVES FASTER THAN THE MECHANISM WILL LATCH.
  //
  // THE BUDGET IS DERIVED, NOT GUESSED. `approach.h` closes at
  // `closeGainPerS * distance` with a floor, so the last 20 m alone is
  // ln(20 / captureRadius) / 0.05 seconds and the whole thing is a few minutes.
  // 420 s of sim is roughly double the analytic estimate, which is a bound on a
  // HANG rather than a performance assertion (INSTRUMENTS.md: a timing
  // threshold on a busy machine measures the machine).
  //
  // THE SPEED CHECK IS AGAINST /core's OWN `maxClosingMS` AND IT HAS AN
  // ANTECEDENT, which is the whole of what a first draft of this probe got
  // wrong. Sampling every 3 s, the run reported a peak-inside-the-envelope of
  // 0.000 m/s -- not because the approach was slow but because NO SAMPLE EVER
  // LANDED INSIDE a 0.60 m radius the vehicle crosses in under a second. The
  // check was green and had measured nothing, which is standing rule 11's
  // shape exactly. So the step SHORTENS as the range does, the number of
  // close-range samples is counted, and the count is asserted.
  // ==========================================================================
  const BUDGET_S = 420;
  /** Below this the sampler slows down. It is not a physics number: it is
   *  simply "close enough that a 3 s step would skip the whole endgame". */
  const NEAR_M = 8;
  let simS = 0;
  let peakClosingInside = 0;
  let insideSamples = 0;
  let peakClosingNear = 0;
  let nearSamples = 0;
  let peakClosingAnywhere = 0;
  let sawCorridor = false, sawFinal = false;
  const legTrace = [];
  while (simS < BUDGET_S && D().docked !== true) {
    const sep = D().separationM;
    const stepS = sep >= 0 && sep < NEAR_M ? 0.25 : 3;
    await sleep(stepS);
    simS += stepS;
    const d = D();
    const a = A();
    if (d.separationM >= 0 && d.separationM <= d.captureRadiusM) {
      peakClosingInside = Math.max(peakClosingInside, d.closingMS);
      insideSamples += 1;
    }
    if (d.separationM >= 0 && d.separationM < NEAR_M) {
      peakClosingNear = Math.max(peakClosingNear, d.closingMS);
      nearSamples += 1;
    }
    peakClosingAnywhere = Math.max(peakClosingAnywhere, d.closingMS);
    if (a.legWord === 'CORRIDOR') sawCorridor = true;
    if (a.legWord === 'FINAL') sawFinal = true;
    if (legTrace.length === 0
        || legTrace[legTrace.length - 1][1] !== a.legWord) {
      legTrace.push([+simS.toFixed(2), a.legWord,
                     +Number(d.separationM).toFixed(2),
                     +Number(d.closingMS).toFixed(3)]);
    }
    if (!a.running && d.docked !== true) break;   // it gave up: report it
  }
  const done = D();
  rec('SECTION 4  leg trace [sim s, leg, separation m, closing m/s]', legTrace);
  rec('SECTION 4  sim seconds to capture', +simS.toFixed(2));
  rec('SECTION 4  peak closing rate [inside 0.60 m, inside 8 m, anywhere] (m/s)',
      [+peakClosingInside.toFixed(3), +peakClosingNear.toFixed(3),
       +peakClosingAnywhere.toFixed(3)]);
  rec('SECTION 4  samples taken [inside 0.60 m, inside 8 m]',
      [insideSamples, nearSamples],
      'the antecedent for the speed check: a peak over zero samples is not a '
      + 'measurement, and the first draft of this probe reported exactly that');
  check('THE AUTOPILOT ALONE REACHED CAPTURE', done.docked === true,
        `docked ${done.docked} after ${simS} s, last leg "${A().legWord}", `
        + `note "${A().why}", separation ${done.separationM} m`);
  check('and it did it inside the budget, so this is an arrival and not a hang',
        simS < BUDGET_S, `${simS} s of ${BUDGET_S}`);
  check('IT WALKED THE LEGS RATHER THAN CUTTING THE CORNER: the corridor and '
        + 'the final approach both happened',
        sawCorridor && sawFinal,
        `corridor ${sawCorridor} final ${sawFinal} trace `
        + JSON.stringify(legTrace));
  check('ANTECEDENT for the speed check: the endgame was actually SAMPLED',
        nearSamples > 4,
        `${nearSamples} samples inside ${NEAR_M} m -- a peak over no samples is `
        + 'a green check that measured nothing');
  check('AND IT RESPECTED THE ENVELOPE: nothing at close range ever exceeded '
        + '/core\'s own dwell speed',
        peakClosingNear <= D().maxClosingMS + 1e-6,
        `${peakClosingNear} m/s against maxClosingMS ${D().maxClosingMS}`);
  check('nor inside the capture radius itself',
        peakClosingInside <= D().maxClosingMS + 1e-6,
        `${peakClosingInside} m/s over ${insideSamples} samples`);
  check('and it never charged the station at any range either',
        peakClosingAnywhere < 5, `${peakClosingAnywhere} m/s`);
  // THE STRONGEST FORM OF THE SAME CLAIM, and it is /core's rather than this
  // probe's sampling: `docking::sweptCapture` REFUSES with reason 3 above
  // `maxClosingMS`, every sub-step, so a capture that happened at all is proof
  // the arrival was inside the dwell speed at the instant it mattered. The
  // sampled peaks above are the corroboration; this is the authority.
  check('and /core\'s own swept test accepted the arrival, which it does not '
        + 'do above the dwell speed', done.docked === true);
  if (done.docked !== true) {
    return { valid: true, reachedEnd: false, fails, failCount: fails.length,
             rows, why: 'the approach did not capture; sections 5-6 skipped' };
  }

  // ==========================================================================
  // SECTION 5. THE AUTO DOOR PUTS THE VESSEL EXACTLY WHERE THE MANUAL ONE DOES.
  //
  // Every assertion here is one `probes/docking.js` section 4 already makes
  // about the hand-flown latch, repeated verbatim against the automatic one.
  // Two doors to one join, and `dkJoin` is the one place that answers where a
  // docked vessel ends up -- this is that claim, measured from the other side.
  // ==========================================================================
  const after = A();
  rec('SECTION 5  after capture [docked, hostId, hostPort, originToPort m]',
      [done.docked, done.hostId, done.hostPort, +done.originToPortM.toFixed(3)]);
  check('the client says it is docked', done.docked === true);
  check('and it counted a DOCK even though no key was pressed for it',
        done.docks === 1, `docks ${done.docks}`);
  check('and it is latched to ANCHORAGE by id', done.hostId === station.id,
        `hostId ${done.hostId} vs ${station.id}`);
  check('and it recorded WHICH port', done.hostPort === 'socket_dock',
        `"${done.hostPort}"`);
  check('and the hull sits ON the port rather than at the station centre',
        done.originToPortM > 0.2 && done.originToPortM < 30,
        `${done.originToPortM} m`);
  check('THE PROGRAM DISARMED ITSELF: a docked vessel is not still being flown',
        after.running === false, `running ${after.running}`);
  const censusRow = V().list.find((v) => v.promoted === true) ?? null;
  check('the CENSUS carries the latch too, so /core and the registry agree',
        censusRow !== null && censusRow.docked !== null
        && censusRow.docked.hostId === station.id,
        JSON.stringify(censusRow?.docked ?? null));
  check('and exactly ONE record is docked',
        V().list.filter((v) => v.docked !== null).length === 1,
        JSON.stringify(V().list.map((v) => [v.id, v.docked !== null])));

  // ==========================================================================
  // SECTION 6. THE PLAYER CAN ALWAYS TAKE IT BACK.
  //
  // The one thing a docking autopilot must never be is a program you cannot
  // interrupt. The six translation keys are the case that needs proving,
  // because they are the ONE input that does not go through
  // `commandDirection`'s interlock and they write the very axis the program
  // writes (FlightControls.ts says so beside the line).
  // ==========================================================================
  of.flight('dock');                 // undock: the toggle's second meaning
  await sleep(1.5);
  check('SECTION 6 fixture: it undocks', D().docked === false,
        `docked ${D().docked}`);
  const rearm = of.flight('approach');
  await sleep(0.3);
  check('SECTION 6 fixture: it re-arms after an undock', rearm.ok === true
        && A().running === true, `ok ${rearm.ok} running ${A().running}`);
  of.input.act(['rcsLeft'], 6);
  await sleep(0.4);
  const afterKey = A();
  rec('SECTION 6  after one translation key [running, message]',
      [afterKey.running, F().message]);
  check('A THRUSTER KEY TAKES THE VEHICLE BACK', afterKey.running === false,
        `running ${afterKey.running}`);
  check('and it SAYS SO rather than going quiet',
        /auto-approach/i.test(String(F().message)), `"${F().message}"`);
  // And a SAS key, which is the other half of the interlock and reaches it
  // through `commandDirection` instead.
  const rearm2 = of.flight('approach');
  await sleep(0.3);
  check('SECTION 6 fixture: it arms a third time', rearm2.ok === true);
  of.input.act(['sasPrograde'], 6);
  await sleep(0.4);
  check('AND A SAS KEY DOES TOO, through the same one interlock',
        A().running === false, `running ${A().running}`);

  check('POSITIVE CONTROL: the run reached the end of the file', true);

  return {
    valid: true, reachedEnd: true, fails, failCount: fails.length, rows,
    summary: {
      lockedWhy: locked.why,
      lockedPressRefused: pressLocked.ok === false,
      milestoneEarnedByBoarding:
        MILES().filter((m) => m === STATION_BOARDED).length,
      startRangeM: start.raw.rangeM,
      startLateralM: start.raw.lateralM,
      simSecondsToCapture: simS,
      peakClosingInsideEnvelopeMS: peakClosingInside,
      envelopeSamples: insideSamples,
      peakClosingNear8mMS: peakClosingNear,
      nearSamples,
      maxClosingLimitMS: D().maxClosingMS,
      legs: legTrace.map((r) => r[1]),
      docked: done.docked,
      hostId: done.hostId,
      originToPortM: done.originToPortM,
      handBackOnThrusterKey: afterKey.running === false,
    },
  };
})()
