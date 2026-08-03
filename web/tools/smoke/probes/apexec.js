// apexec.js: GP-272 to GP-278. THE AUTOPILOT BUTTON FLIES A ROCKET.
//
//   node tools/smoke/run.mjs --sandbox=1 --settle=25 \
//        --evalfile=tools/smoke/probes/apexec.js
//
// GP-271 shipped the planning half: a target list, a 64-sample departure chart
// and a per-departure gate. The arm button recorded the intent and SAID SO.
// This drives the other half, through the same button, from the map.
//
// THE FAILURE MODES, NAMED BEFORE MEASURING, because a check written after the
// screenshot is not falsifiable:
//
//  (1) THE BUTTON PRESSES AND NOTHING IS ARMED. This is the state that shipped
//      last night, so it is not hypothetical: `armed` was a boolean this client
//      kept about itself and no executor ever saw the press. Cured by asserting
//      the EXECUTOR's own row, never a client flag, and there is no longer a
//      client flag to assert.
//
//  (2) THE PROGRAM "COMPLETES" WITHOUT EVER BURNING. `phase` walks Coast to
//      Done with `dvSpentTotalMS` at 0 and the orbit unchanged, which reads
//      exactly like success on every summary field. Cured by requiring that the
//      Burn phase was SEEN, that the spend is non-zero, and that the ORBIT
//      MOVED to where it was asked to go.
//
//  (3) THE FIXTURE CANNOT EXHIBIT THE DEFECT. `holdOrbit` returns a VALID
//      program with ZERO burns and the note "already there" when the request is
//      within a metre of the current radius, and that program completes
//      instantly and perfectly. Asking for the orbit you are already on is the
//      identity element of this operation (GP-142's rule), so the requested
//      radius is asserted to differ from the current one BEFORE anything is
//      armed.
//
//  (4) CANCEL MID-BURN LEAVES THE ENGINE LIT. `Autopilot::disarm` on its own
//      touches only the executor, so a cancel that merely stopped driving it
//      would leave `sim.state.throttle` where the last Command put it, for
//      ever. Cured on the physics side; asserted here against /core's OWN
//      throttle and never against the client's mirror, because the mirror is
//      the thing that was wrong (see 6).
//
//  (5) A REFUSAL DRAWS AS A SUCCESS, or arrives with an empty sentence. This is
//      GP-270 one layer up. Provoked by SPENDING THE FUEL and re-asking for the
//      SAME orbit that was accepted minutes earlier, which is a two-sided claim
//      no threshold can imitate: the same request, the same target, accepted
//      and then refused, so the gate is proven to be about the vehicle.
//
//  (6) THE THROTTLE GAUGE READS THE PLAYER'S MIRROR. `FlightSession.throttle`
//      is written only when the player moves it, so during an autopilot burn
//      the navball read 0% with the engine at full. Asserted on the DRAWN
//      navball readout while the executor says it is burning.
//
// WHY A HOLD-ORBIT AND NOT A RENDEZVOUS FOR THE FLY-TO-COMPLETION CASE: it is
// the smallest closed loop that has an ANSWER TO CHECK. "Take it to this orbit"
// ends at a number /core independently publishes (`of_fl_orbit`), so arrival
// can be asserted against something that is not the autopilot's own opinion of
// itself. A rendezvous ends at a distance the 18 status words do not carry.
(async () => {
  const of = window.__of;
  if (!of) return { valid: false, why: 'no __of' };
  if (typeof of.map !== 'function') return { valid: false, why: 'no __of.map' };
  const fails = [];
  const log = [];
  const check = (name, ok, detail) => {
    if (!ok) fails.push(detail === undefined ? name : `${name}: ${detail}`);
    return ok;
  };
  const sleep = (n) => of.run(n);
  const FM = () => of.flight('report');
  const F = () => of.flight('report').flight;
  const P = () => of.map('report').planner;
  const R = () => of.map('report').planner.run;

  const pressRow = async (id) => {
    const el = document.querySelector(`#of-map [data-plan="${id}"]`);
    if (el === null) return { landed: false, why: `no row ${id}` };
    el.click();
    await sleep(0.6);
    return { landed: true, sel: P().selectedId, why: '' };
  };
  const pressAct = async (act, settle = 0.4) => {
    const el = document.querySelector(`#of-map [data-plan-act="${act}"]`);
    if (el === null) return { landed: false, why: `no button ${act}` };
    const disabled = el.disabled === true;
    el.click();
    await sleep(settle);
    return { landed: true, disabled, why: '' };
  };

  await sleep(0.8);
  of.build(0);

  // --- FIXTURE: a rocket, rolled out, boarded, in orbit --------------------
  of.vab('enter');
  await sleep(0.4);
  const cat = of.vab('catalogue');
  of.vab('press', 'clear');
  await sleep(0.15);
  for (const pid of [0x0100, 0x0101, 0x0103]) {
    const i = cat.find((c) => c.id === pid)?.index ?? -1;
    if (i < 0) continue;
    of.vab('frame');
    of.vab('take', i);
    await sleep(0.12);
    const parts = of.vab('report').parts;
    if (parts.length === 0) { of.vab('place'); await sleep(0.12); continue; }
    let low = parts[0];
    for (const p of parts) if (p.origin[1] < low.origin[1]) low = p;
    const nodes = of.vab('nodes').filter((n) => n.parent === low.handle
      && n.onScreen && (n.kind === 'bottom' || n.kind === 'interstage'));
    if (nodes.length === 0) continue;
    of.vab('hover', nodes[0].ndc[0], nodes[0].ndc[1]);
    of.vab('place');
    await sleep(0.12);
  }
  of.vab('leave');
  await sleep(0.4);
  of.flight('rollout');
  await sleep(0.8);
  for (let i = 0; i < 16 && FM().distanceToVesselM > 10; ++i) {
    of.input.act(['forward'], 30);
    await sleep(0.6);
  }
  of.flight('board');
  await sleep(0.6);
  of.pause(true);
  await sleep(0.35);
  document.querySelector('#of-pause button[data-cheat="orbit"]')?.click();
  await sleep(1.5);
  of.pause(false);
  await sleep(1.2);
  check('fixture: aboard and in orbit', F().status === 'ORBIT' && FM().aboard,
        `status ${F().status} aboard ${FM().aboard}`);
  if (F().status !== 'ORBIT') return { valid: false, why: 'no orbit', fails };

  // LIGHT AN ENGINE BEFORE ARMING, AND THIS LINE IS A FINDING RATHER THAN A
  // TIDY-UP. Without it the first run of this probe sat in `Phase::Burn` at
  // full throttle for 900 consecutive polls having spent 0.0000 of a planned
  // 144.9070 m/s with the orbit unmoved, because TELEPORT TO ORBIT does not
  // stage and the executor has no verb for staging. A burn is terminated on
  // MEASURED delta-v, so a burn with no thrust never terminates.
  //
  // The fixture stages because a player who flew up here by hand would have.
  // The defect it exposed is real either way and is reported upward; the
  // client's own answer to it is `runStalled`, asserted in section 2.
  of.input.act(['stage'], 4);
  await sleep(0.6);
  of.input.act(['throttleCut'], 4);
  await sleep(0.6);
  check('fixture: an engine is lit, so a commanded burn can produce thrust',
        F().stagings > 0, `stagings ${F().stagings}`);

  const mapCode = (of.input.bindings().map || [])[0];
  if (!mapCode) return { valid: false, why: 'no map binding', fails };
  window.dispatchEvent(new KeyboardEvent('keydown', { code: mapCode, bubbles: true }));
  await sleep(1.2);
  check('the map opened', of.map('report').open === true, `key ${mapCode}`);

  // --- THE SEAM. BOTH SIDES ARE ASSERTED (GP-269's rule) -------------------
  //
  // A build can price this trip perfectly and be unable to fly it; that is what
  // every build before tonight was. So the probe reads the executor's own
  // `waitingOn`, PUBLISHES it, and carries real assertions on each branch
  // rather than quietly taking the trivial one.
  const r0 = R();
  const execPresent = r0 !== null && r0 !== undefined && r0.waitingOn === '';
  log.push(`executor waitingOn: "${r0 ? r0.waitingOn : '(no run block)'}"`);
  if (!execPresent) {
    // THE PENDING BRANCH, AND IT IS A REAL BRANCH. The screen must name the
    // exports it needs and the arm button must be dead, not hopeful.
    const armEl = document.querySelector('#of-map [data-plan-act="arm"]');
    await pressRow('orbit');
    const armEl2 = document.querySelector('#of-map [data-plan-act="arm"]');
    const txt = document.querySelector('#of-map')?.textContent ?? '';
    // TWO PENDING SHAPES, and they are different builds. A build from HEAD's
    // committed binary carries NEITHER export set, so the planner's seam speaks
    // first (you cannot fly what you cannot price) and the executor's names ride
    // along behind it. A build with the planning half only shows the executor's
    // seam on its own. Both must name every export they need, by its C name.
    const plannerAlsoMissing = (P().waitingOn ?? '') !== '';
    check('with no executor the screen names the exports it waits for',
          /of_ap_arm_hold_orbit/.test(txt) && /of_ap_arm_transfer/.test(txt)
          && /of_ap_cancel/.test(txt) && /of_ap_status/.test(txt)
          && /of_ap_note/.test(txt),
          `plannerAlsoMissing ${plannerAlsoMissing}, executor waitingOn `
          + `"${(r0 && r0.waitingOn) || '(no run block at all)'}"`);
    if (plannerAlsoMissing) {
      check('and it names the PLANNING exports too, so one does not hide the '
            + 'other', /of_ap_departure_curve/.test(txt), P().waitingOn);
    }
    check('and the arm button is disabled rather than hopeful',
          armEl2 === null || armEl2.disabled === true,
          `arm disabled=${armEl2 && armEl2.disabled}`);
    check('and nothing is armed', !(r0 && r0.armed), JSON.stringify(r0));
    void armEl;
    return {
      valid: fails.length === 0, fails, log,
      branch: 'PENDING: the executor is not on this bridge',
      waitingOn: r0 ? r0.waitingOn : '(no run block)',
      note: 'the planning half is unaffected; this probe goes green the day '
        + 'of_ap_arm_* reaches the served wasm',
    };
  }

  // =========================================================================
  // 1. ARM A HOLD-ORBIT, WHICH IS REID'S FIFTH ASK.
  // =========================================================================
  const sel = await pressRow('orbit');
  check('the requested-orbit row selected', sel.sel === 'orbit', sel.sel);

  // THE FOUR ORBIT BUTTONS EXIST AT ALL (GP-277). Until tonight `altKm` was
  // 100 for ever and nothing on this screen could move it, so "set an automatic
  // take it to this orbit" offered exactly one orbit.
  const alt0 = P().altKm ?? 0;
  const bump = await pressAct('alt+');
  check('the altitude button LANDED', bump.landed, bump.why);
  const alt1 = P().altKm ?? 0;
  check('the altitude button MOVED the requested orbit', alt1 > alt0,
        `${alt0} -> ${alt1} km`);
  // Climb to a request that is a real distance from where we are, so the
  // program is not the identity (failure mode 3).
  for (let k = 0; k < 3; ++k) await pressAct('alt+', 0.25);
  await sleep(0.9);

  const before = F();
  const askedAltKm = P().altKm;
  const askedRadiusM = of.world().bodyRadiusM + askedAltKm * 1000;
  const nowRadiusM = of.world().bodyRadiusM + before.apoapsisM;
  check('FIXTURE GUARD: the requested orbit is not the one we are on',
        Math.abs(askedRadiusM - nowRadiusM) > 1000,
        `asked ${askedRadiusM.toFixed(0)} m, on ${nowRadiusM.toFixed(0)} m. `
        + 'A request inside a metre is "already there": a VALID program with '
        + 'ZERO burns that completes perfectly and proves nothing.');
  log.push(`asking for ${askedAltKm} km from AP ${before.apoapsisM.toFixed(0)} `
    + `/ PE ${before.periapsisM.toFixed(0)} m, dv aboard `
    + `${before.remainingDvMS} m/s`);

  const quotedDvMS = Number(P().chosenDvMS);
  const armPress = await pressAct('arm', 0.8);
  check('the arm button LANDED', armPress.landed, armPress.why);
  check('the arm button was ENABLED when pressed', armPress.disabled === false,
        `disabled=${armPress.disabled}`);
  const r1 = R();
  check('THE EXECUTOR HAS A PROGRAM', r1.armed === true, JSON.stringify(r1));
  check('and it is running', r1.running === true, `phase ${r1.phase}`);
  check('it took the HOLD-ORBIT door, not the transfer door',
        r1.lastArm !== null && r1.lastArm.via === 'hold-orbit',
        JSON.stringify(r1.lastArm));
  check('a hold-orbit is TWO burns (raise, then circularise)',
        r1.burnCount === 2, `${r1.burnCount}`);
  check('the executor answered with a sentence', (r1.note ?? '') !== '',
        `note "${r1.note}"`);
  check('the press reached the verb exactly once', r1.armPresses === 1,
        `${r1.armPresses}`);

  // THE THING THAT WAS QUOTED IS THE THING THAT WAS ARMED. The chart prices a
  // mission INCLUDING the 5% policy reserve; the program is the burns alone.
  // So the two must differ by exactly that reserve and by nothing else, which
  // catches an arm that re-solved at a different departure or through a
  // different builder. A tolerance, not an equality, because the plan is
  // propagated forward by the slew allowance before it is built.
  const impliedQuote = r1.programDvMS * 1.05;
  const quoteErr = Math.abs(impliedQuote - quotedDvMS) / Math.max(1, quotedDvMS);
  check('the armed programme is the one the chart quoted, to the reserve',
        quoteErr < 0.06,
        `chart ${quotedDvMS.toFixed(3)} m/s vs programme `
        + `${r1.programDvMS.toFixed(3)} x1.05 = ${impliedQuote.toFixed(3)} `
        + `(${(quoteErr * 100).toFixed(2)}% out)`);
  log.push(`armed: ${r1.burnCount} burns, ${r1.programDvMS.toFixed(4)} m/s, `
    + `note "${r1.note}"`);

  // THE PANEL SWAPS. A live programme owns the block, so the chart and the arm
  // button give way to the programme and a CANCEL.
  const band = document.querySelector('#of-map .pverdict')?.textContent ?? '';
  check('the panel now shows the PROGRAMME, not the chart',
        document.querySelector('#of-map [data-plan-act="cancel"]') !== null
        && document.querySelector('#of-map [data-plan-act="arm"]') === null,
        `band "${band}"`);

  // =========================================================================
  // 2. WATCH IT FLY.
  //
  // TIMED ON THE WALL CLOCK AND NOT ON A POLL COUNT, because the two are not
  // the same thing and the first version used the wrong one: `holdOrbit` puts
  // its first burn a full `kOrientLeadS` in the future so the vehicle has time
  // to turn, and GP-275 pins warp at 1x for exactly that phase, so a poll
  // budget that looked generous (900 polls) expired 30 seconds into a 60
  // second slew and reported "still running" about a programme that was fine.
  //
  // WARP IS PRESSED ONLY IN COAST. Pressing it while the executor is pointing
  // or burning is refused by design, and a probe that fights its own feature
  // measures the fight.
  // =========================================================================
  const seenPhase = new Set();
  let sawBurning = false;
  let sawWarpDrop = false;
  let sawWarpUp = false;
  let peakThrottle = 0;
  let drawnThrottleWhileBurning = -1;
  let barChecked = 0, barWorst = 0, barPeak = 0;
  let stalled = false;
  let polls = 0;
  const t0 = Date.now();
  while (Date.now() - t0 < 260000) {
    polls += 1;
    const s = R();
    seenPhase.add(s.phase);
    // COAST IS WHERE WARP BELONGS. A hold-orbit coasts half an orbit between
    // its two burns, which is the wait the whole warp ladder exists for.
    if (s.phase === 1 && F().warp < 50) {
      of.input.act(['warpUp'], 3);
      sawWarpUp = true;
    }
    if ((s.phase === 2 || s.phase === 3) && F().warp === 1 && sawWarpUp) {
      sawWarpDrop = true;
    }
    if (s.burningNow) {
      sawBurning = true;
      peakThrottle = Math.max(peakThrottle, s.throttleNow);
      const nb = of.flight('navball');
      if (nb && typeof nb.throttle === 'number') {
        drawnThrottleWhileBurning = Math.max(drawnThrottleWhileBurning,
                                             nb.throttle);
      }
      // THE BAR IS ASSERTED AT THE PIXEL (GP-64): its own width, read back off
      // the element, against the executor's spend. Not the model against a
      // second copy of its own arithmetic.
      const bar = document.querySelector('#of-map .pbar');
      const fill = bar && bar.querySelector('i');
      if (bar !== null && fill !== null) {
        const drawn = (fill.getBoundingClientRect().width
                       / Math.max(1, bar.getBoundingClientRect().width)) * 100;
        barWorst = Math.max(barWorst,
                            Math.abs(drawn - Number(s.burnProgress01) * 100));
        barPeak = Math.max(barPeak, drawn);
        barChecked += 1;
      }
    }
    if (s.stalled === true) { stalled = true; break; }
    if (!s.armed || !s.running) break;
    await sleep(1 / 60);
  }
  const elapsedS = (Date.now() - t0) / 1000;
  const after = F();
  const rEnd = R();
  log.push('phases seen: [' + [...seenPhase].sort().join(',') + '] over '
    + polls + ' polls / ' + elapsedS.toFixed(0) + ' s of wall clock');

  check('THE BURN PHASE WAS REACHED', seenPhase.has(3),
        `phases ${[...seenPhase].join(',')}`);
  check('and the executor said it was burning', sawBurning);
  check('the throttle it commanded was real', peakThrottle > 0.5,
        `peak ${peakThrottle}`);
  check('the DRAWN navball throttle moved while it burned',
        drawnThrottleWhileBurning > 0.5,
        `drawn ${drawnThrottleWhileBurning}: the gauge used to read the `
        + "client's own throttle mirror, which the player never touched");
  check('GP-275: the probe DID reach warp, so the drop is not vacuous',
        sawWarpUp, 'never left 1x, so there was nothing to drop');
  check('GP-275: time warp was back at 1x for the pointing and the burn',
        sawWarpDrop, `warp read ${F().warp}x while pointing or burning`);
  if (barChecked > 0) {
    check('the drawn burn bar matches the executor', barWorst < 2.0,
          `worst |drawn - sim| ${barWorst.toFixed(2)} points over `
          + `${barChecked} samples`);
    // AND IT MOVED. An earlier run agreed to 0.00 points over 900 samples with
    // a bar at 0% against a spend of 0.0000: two zeroes matching is the
    // identity element of the comparison, which is GP-142's trap and reads
    // exactly like a pass.
    check('and the bar was actually DRAWN somewhere other than empty',
          barPeak > 1.0, `peak drawn width ${barPeak.toFixed(2)}%`);
  } else {
    check('the burn bar was drawn at all', false, 'never sampled');
  }
  check('the programme finished rather than hanging',
        !stalled && !rEnd.running,
        stalled
          ? 'the burn STALLED: full throttle, zero spend. The vehicle has no '
            + 'lit engine and the executor has no verb for staging, so the '
            + 'programme would have hung for ever.'
          : `still running after ${elapsedS.toFixed(0)} s, phase ${rEnd.phase}`);
  if (stalled) {
    const t = document.querySelector('#of-map')?.textContent ?? '';
    check('and the screen says so rather than showing a healthy burn',
          /NOTHING IS HAPPENING/.test(t), t.slice(0, 200));
  }

  // FAILURE MODE 2: THE ORBIT ACTUALLY MOVED, against /core's own conic and
  // never against the autopilot's opinion of itself.
  const arrivedRadiusM = of.world().bodyRadiusM
    + (after.apoapsisM + after.periapsisM) / 2;
  const missM = arrivedRadiusM - askedRadiusM;
  check('IT WENT WHERE IT WAS ASKED TO GO', Math.abs(missM) < 5000,
        `asked r ${askedRadiusM.toFixed(1)} m, reached mean r `
        + `${arrivedRadiusM.toFixed(1)} m, out by ${missM.toFixed(1)} m`);
  check('and it left a CIRCULAR orbit behind', after.eccentricity < 0.02,
        `e ${after.eccentricity}`);
  check('it spent real delta-v', rEnd.dvSpentTotalMS > 0,
        `${rEnd.dvSpentTotalMS}`);
  const spendErr = Math.abs(rEnd.dvSpentTotalMS - rEnd.programDvMS);
  check('it spent what it planned to spend', spendErr < 2.0,
        `planned ${rEnd.programDvMS.toFixed(4)}, spent `
        + `${rEnd.dvSpentTotalMS.toFixed(4)}, out by ${spendErr.toFixed(4)} m/s`);
  const dvUsed = before.remainingDvMS - after.remainingDvMS;
  log.push('arrived: AP ' + after.apoapsisM.toFixed(1) + ' / PE '
    + after.periapsisM.toFixed(1) + ' m, e ' + after.eccentricity
    + ', spent ' + rEnd.dvSpentTotalMS.toFixed(4) + ' of a planned '
    + rEnd.programDvMS.toFixed(4) + ' m/s; tanks fell ' + dvUsed.toFixed(1)
    + ' m/s');
  const bandEnd = document.querySelector('#of-map .pverdict')?.textContent ?? '';
  check('the panel says it ARRIVED', /ARRIVED/.test(bandEnd), bandEnd);

  // Clear the finished programme through the same button a player has.
  await pressAct('cancel', 0.5);
  check('clearing a finished programme empties the executor', !R().armed,
        JSON.stringify(R()));

  // =========================================================================
  // 2b. A RENDEZVOUS ARMS THROUGH THE OTHER DOOR.
  // =========================================================================
  // `armFor` chooses hold-orbit or transfer off the TARGET'S OWN PHASE, and
  // section 1 only ever exercised the phaseless door. A branch with no proven
  // case is the thing INSTRUMENTS.md is about, so the transfer door is driven
  // here even though flying a rendezvous to completion is hours of sim: what
  // is being proved is that the right call was made with the right words and
  // that the executor took it.
  //
  // BEFORE THE DRAIN IN SECTION 4, deliberately. Afterwards the vehicle cannot
  // afford a rendezvous and this would be testing the gate instead of the door.
  const stationId = P().rowIds.find((i) => i.startsWith('v:'));
  let rvia = '';
  let rburns = 0;
  let rprog = 0;
  if (stationId !== undefined) {
    const rsel = await pressRow(stationId);
    check('a vessel row selected', rsel.sel === stationId, rsel.sel);
    await sleep(1.2);
    await pressAct('cheapest', 0.6);
    await sleep(0.8);
    const armR = await pressAct('arm', 1.0);
    check('the rendezvous arm button was offered and enabled',
          armR.landed && armR.disabled === false,
          `landed ${armR.landed} disabled ${armR.disabled}`);
    const rr = R();
    rvia = (rr.lastArm && rr.lastArm.via) || '';
    rburns = rr.burnCount;
    rprog = rr.programDvMS;
    check('IT TOOK THE TRANSFER DOOR, not the hold-orbit door',
          rvia === 'transfer', `via "${rvia}"`);
    check('and the executor armed a real programme', rr.armed && rr.running
          && rr.programDvMS > 0,
          JSON.stringify({ armed: rr.armed, running: rr.running,
                           dv: rr.programDvMS }));
    check('a rendezvous is one or two burns, and the panel does not assume',
          rr.burnCount >= 1 && rr.burnCount <= 4, `${rr.burnCount}`);
    check('the executor answered the rendezvous with a sentence',
          (rr.note ?? '') !== '', `note "${rr.note}"`);
    log.push('rendezvous with ' + stationId + ' armed via ' + rvia + ': '
      + rr.burnCount + ' burns, ' + Number(rr.programDvMS).toFixed(1) + ' m/s');
    await pressAct('cancel', 0.6);
    check('and it cancels cleanly before it has burned anything',
          !R().armed, JSON.stringify(R()));
  } else {
    check('there is a vessel to rendezvous with', false,
          JSON.stringify(P().rowIds));
  }
  // Back to the requested orbit for the sections that follow.
  if (P().selectedId !== 'orbit') await pressRow('orbit');

  // =========================================================================
  // 3. CANCEL MID-BURN, WHICH IS THE CASE THAT GETS GOT WRONG.
  // =========================================================================
  // A bigger raise, so the first burn lasts long enough for a player (and this
  // probe) to react to it. Distance cannot provoke a refusal in flight, but it
  // can certainly provoke a LONG BURN, which is what is wanted here.
  for (let k2 = 0; k2 < 60 && (P().altKm ?? 0) < 1200; ++k2) {
    await pressAct('alt+', 0.03);
  }
  await sleep(1.2);
  const bigAltKm = P().altKm;
  const preCancelDv = F().remainingDvMS;
  const arm2 = await pressAct('arm', 0.8);
  check('the second arm LANDED', arm2.landed, arm2.why);
  const r2 = R();
  check('a big raise ARMS, so the later refusal is about fuel and not distance',
        r2.armed && r2.running,
        `alt ${bigAltKm} km: ${JSON.stringify(r2.lastArm)}`);
  log.push('second programme: ' + bigAltKm + ' km, '
    + Number(r2.programDvMS).toFixed(1) + ' m/s planned, '
    + preCancelDv + ' m/s aboard');

  let cancelled = null;
  let spentAtCancel = 0;
  let throttleAtCancel = -1;
  const t1 = Date.now();
  while (Date.now() - t1 < 200000) {
    const s2 = R();
    if (!s2.armed) break;
    // MID-BURN means the first burn is genuinely under way: a third of the way
    // through it, so neither "just lit" nor "about to stop", both of which
    // could be passed by a cancel that only worked at an edge.
    if (s2.burningNow && Number(s2.burnProgress01) > 0.33) {
      spentAtCancel = s2.dvSpentTotalMS;
      throttleAtCancel = s2.throttleNow;
      const c = await pressAct('cancel', 0.6);
      check('the cancel button LANDED', c.landed, c.why);
      cancelled = P().run.lastCancel;
      break;
    }
    await sleep(1 / 60);
  }
  check('the probe caught it MID-BURN', cancelled !== null,
        'gave up after ' + ((Date.now() - t1) / 1000).toFixed(0) + ' s');
  let throttleAfterCancel = -1;
  if (cancelled !== null) {
    check('the throttle was really UP at the moment of the cancel',
          throttleAtCancel > 0.5, `throttle ${throttleAtCancel}`);
    check('cancel reports it was BURNING', cancelled.wasBurning === true,
          JSON.stringify(cancelled));
    check('cancel reports the residual, so the player can be told',
          cancelled.dvSpentMS > 0, `${cancelled.dvSpentMS}`);
    // FAILURE MODE 4. Read off the DRAWN navball, which now reads /core's own
    // throttle rather than the client's mirror (GP-278), so this is a
    // measurement of the engine and not of an intention.
    throttleAfterCancel = of.flight('navball').throttle;
    check('THE THROTTLE IS CUT', throttleAfterCancel === 0,
          `throttle ${throttleAfterCancel}`);
    check('and the executor is empty', !R().armed, JSON.stringify(R()));
    log.push('cancelled mid-burn at ' + spentAtCancel.toFixed(1)
      + ' m/s spent, burn ' + (cancelled.atBurnIndex + 1) + ' of '
      + cancelled.burnCount + ', throttle ' + throttleAtCancel + ' -> '
      + throttleAfterCancel);
  }

  // A CANCEL WITH NOTHING ARMED IS NOT A FAILURE and must not read as one.
  const again = await pressAct('cancel', 0.3);
  if (again.landed) {
    check('cancelling nothing reports "nothing was armed" rather than failing',
          P().run.lastCancel === null || P().run.lastCancel.wasArmed === false,
          JSON.stringify(P().run.lastCancel));
  } else {
    check('with nothing armed there is no cancel button either',
          !R().armed, JSON.stringify(R()));
  }

  // =========================================================================
  // 4. THE REFUSAL, IN PHYSICS' OWN WORDS. THE SAME REQUEST, TWICE.
  // =========================================================================
  // Two-sided, and no threshold anywhere: the identical orbit that armed a
  // minute ago must now be refused, because the vehicle spent the fuel. A gate
  // that always said yes and a gate that always said no both fail this.
  //
  // THE FUEL IS SPENT BY FLYING, not through a back door: a NORMAL burn, which
  // changes the plane and leaves the orbit's SIZE nearly alone, so the same
  // destination is still the same distance away and the only thing that has
  // changed is what is in the tank. Burning prograde would have moved the
  // target as well as the vehicle and proved nothing about either.
  const dvBeforeDrain = F().remainingDvMS;
  of.input.act(['sasNormal'], 4);
  await sleep(1.5);
  of.input.act(['throttleFull'], 4);
  const t2 = Date.now();
  while (Date.now() - t2 < 120000 && F().remainingDvMS > 700) {
    await sleep(0.25);
  }
  of.input.act(['throttleCut'], 4);
  await sleep(1.2);
  const dvNow = F().remainingDvMS;
  check('the drain burn actually spent fuel', dvNow < dvBeforeDrain - 100,
        `${dvBeforeDrain} -> ${dvNow} m/s`);
  log.push('drained by hand: ' + dvBeforeDrain + ' -> ' + dvNow + ' m/s aboard');

  // SELECTION IS A TOGGLE, so pressing an already-selected row DESELECTS it.
  // The first version pressed unconditionally and cleared the destination it
  // was about to arm, which then failed two checks about a screen that was
  // correctly showing "pick a destination". A probe that drives a control has
  // to know the control's own state machine.
  if (P().selectedId !== 'orbit') await pressRow('orbit');
  check('the orbit row is selected', P().selectedId === 'orbit',
        `selectedId "${P().selectedId}"`);
  for (let k3 = 0; k3 < 80 && (P().altKm ?? 0) < bigAltKm; ++k3) {
    await pressAct('alt+', 0.03);
  }
  await sleep(1.5);
  const sameAlt = P().altKm;
  check('and it is set to the SAME orbit that armed before',
        sameAlt === bigAltKm, `${sameAlt} vs ${bigAltKm} km`);
  const arm3 = await pressAct('arm', 0.8);
  let refusal = null;
  let refusedUpstream = false;
  if (arm3.landed && arm3.disabled === false) {
    refusal = P().run.lastArm;
    check('THE SAME REQUEST IS NOW REFUSED', refusal !== null
          && refusal.armed === false,
          'dv aboard ' + dvNow + ' m/s (was ' + preCancelDv + '), '
          + JSON.stringify(refusal));
    check("and the refusal carries PHYSICS' OWN SENTENCE, not ours",
          refusal !== null && (refusal.note ?? '').length > 0,
          `note "${refusal && refusal.note}"`);
    check('nothing is armed after a refusal', !R().armed, JSON.stringify(R()));
    log.push('refused at ' + dvNow + ' m/s aboard: "'
      + (refusal && refusal.note) + '"');
  } else {
    // THE OTHER CORRECT ANSWER, and it is not a weaker one: GP-271's
    // per-departure gate refused it upstream, so the button is disabled or
    // absent and the executor is never reached. Asserted rather than shrugged
    // at, so "the gate refused" and "the probe could not find a button" stay
    // different outcomes.
    refusedUpstream = true;
    check('the chart gate refused it, so the arm button is dead',
          arm3.landed === false || arm3.disabled === true,
          `landed ${arm3.landed} disabled ${arm3.disabled}`);
    check('and the screen says which of the three states it is in',
          /NOT WITH THIS VEHICLE|NOT NOW, BUT LATER/.test(
            document.querySelector('#of-map')?.textContent ?? ''),
          (document.querySelector('#of-map .pverdict')?.textContent ?? ''));
    check('nothing is armed', !R().armed, JSON.stringify(R()));
    log.push('refused UPSTREAM at ' + dvNow + ' m/s aboard: the per-departure '
      + 'gate disabled the button before the executor was asked');
  }

  return {
    valid: fails.length === 0,
    fails,
    log,
    branch: 'LIVE: the executor is on this bridge',
    askedAltKm, askedRadiusM,
    arrivedRadiusM, missM,
    eccentricity: after.eccentricity,
    plannedDvMS: rEnd.programDvMS,
    spentDvMS: rEnd.dvSpentTotalMS,
    quotedByChartMS: quotedDvMS,
    phasesSeen: [...seenPhase].sort(),
    peakThrottle,
    drawnThrottleWhileBurning,
    warpDroppedForBurn: sawWarpDrop,
    barSamples: barChecked,
    barPeakPct: barPeak,
    stalled,
    elapsedS,
    barWorstPoints: barWorst,
    cancel: cancelled,
    dvBeforeBigBurn: preCancelDv,
    dvAfterDrain: dvNow,
    refusal,
    refusedUpstream,
    throttleAfterCancel,
    rendezvousVia: rvia,
    rendezvousBurns: rburns,
    rendezvousDvMS: rprog,
    note: 'the executor row is the authority throughout; this client keeps no '
      + 'armed flag, and every arrival claim is checked against /core\'s own '
      + 'conic rather than the autopilot\'s opinion of itself',
  };
})()
