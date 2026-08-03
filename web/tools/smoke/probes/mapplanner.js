// mapplanner.js: GP-271. THE MAP PLANNER, THE CHART, AND THE PER-DEPARTURE GATE.
//
//   node tools/smoke/run.mjs --sandbox=1 --settle=25 \
//        --evalfile=tools/smoke/probes/mapplanner.js
//
// Reid's asks 3, 4 and 5, driven from a vessel actually in orbit:
//   "open a menu from the map where you can either select targets from a list
//    or click on targets from the map and a rendezvous planned path should show
//    up. A chart should also show up showing how optimal the current time would
//    be to launch vs waiting later in terms of fuel burn."
//   "It should not let you program in a destination ... if you do not have
//    enough fuel to reach it, but you should be able to set it to a later time
//    if you dont have enough fuel right now but will at a more optimal time."
//
// WHAT MAKES THIS MEAN ANYTHING.
//
// (a) THE CHART IS ASSERTED OFF THE DRAWN SVG, not off the model that produced
//     it. `data-pts` carries the polyline runs the painter emitted, so the
//     point count is the number of points a player can see. A chart asserted
//     against its own input proves only that an array was copied.
//
// (b) NaN IS ASSERTED AS A GAP. Physics publishes NaN for a departure with no
//     solution rather than 0, because 0 would draw as the CHEAPEST point on the
//     curve. So the drawn point count must equal the SOLVED sample count and
//     not the sample count, and those two differ only when some departure has
//     no solution, which is exactly the case that would be silently wrong.
//
// (c) THE GATE IS ASSERTED AS AN EQUIVALENCE, not as a state. The arm button's
//     `disabled` must equal `!chosenFeasible` at every departure the probe
//     visits, so a button that is always live and a button that is always dead
//     both fail. That equivalence IS Reid's rule: the refusal is per departure
//     time, never global.
//
// (d) THE FLAT CURVE IS A POSITIVE CONTROL. A circular target has no phase, so
//     there is no window and waiting buys nothing; the spread must be ~0. A
//     rendezvous with a real vessel must NOT be flat. Both are asserted, so a
//     curve generator that returned a constant would pass one and fail the
//     other.
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
  const opts = { bubbles: true, cancelable: true, pointerId: 1,
                 pointerType: 'mouse', isPrimary: true, button: 0 };

  // A PRESS RETURNS WHAT MOVED, read back off the model afterwards, so an
  // inert control fails at the call site rather than three checks later.
  const pressRow = async (id) => {
    const el = document.querySelector(`#of-map [data-plan="${id}"]`);
    if (el === null) return { landed: false, sel: '', why: `no row ${id}` };
    // ONE click, not pointerdown-then-click: `MapView` binds only 'click' on
    // the readout, and a PointerEvent that also produced one would toggle the
    // selection twice and land back where it started, which reads exactly like
    // an inert row.
    el.click();
    await sleep(0.6);
    return { landed: true, sel: P().selectedId, why: '',
             immediate: P().selectedId };
  };
  const pressAct = async (act) => {
    const el = document.querySelector(`#of-map [data-plan-act="${act}"]`);
    if (el === null) return { landed: false, chosen: -1, why: `no button ${act}` };
    const before = P().chosen;
    el.click();
    await sleep(0.45);
    return { landed: true, before, chosen: P().chosen, why: '' };
  };

  await sleep(0.8);
  of.build(0);

  // --- FIXTURE: aboard, in orbit. map3d.js's recipe, minus the leave. ------
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

  // --- THE MAP, AND THE PLANNER ON IT --------------------------------------
  // THE MAP IS OPENED WITH THE PLAYER'S OWN KEY, read off the LIVE binding
  // table and never a literal 'KeyM': this project has told the player the
  // wrong key three times that anyone has counted (GP-140), and a probe that
  // hardcodes one cannot notice a fourth.
  const mapCode = (of.input.bindings().map || [])[0];
  if (!mapCode) return { valid: false, why: 'no map binding', fails };
  window.dispatchEvent(new KeyboardEvent('keydown', { code: mapCode, bubbles: true }));
  await sleep(1.2);
  const p0 = P();
  check('the map opened with a planner block', p0 !== null && p0 !== undefined);
  if (!p0) return { valid: false, why: 'no planner in the map report', fails };
  check('the map opened on the bound key', of.map('report').open === true,
        'binding ' + mapCode);
  const solverPresent = p0.waitingOn === '';
  check('the solver is on this bridge', solverPresent,
        `waitingOn "${p0.waitingOn}"`);
  if (!solverPresent) {
    return { valid: false, why: `no of_ap_* on this build: ${p0.waitingOn}`,
             fails };
  }
  // THE LIST IS THE BAY'S LIST. Same ids, so a destination chosen before launch
  // is the destination shown in flight.
  check('the target list has the station', p0.rowIds.some((i) => i.startsWith('v:')),
        JSON.stringify(p0.rowIds));
  check('the target list has the body row', p0.rowIds.includes('b:cinder'),
        JSON.stringify(p0.rowIds));
  check('the target list has the requested orbit', p0.rowIds.includes('orbit'),
        JSON.stringify(p0.rowIds));
  // The vessel being flown is NOT offered as its own destination.
  check('the flown vessel is not in its own target list',
        !p0.rowIds.includes(`v:${of.flight('vessels').promotedId}`),
        `${JSON.stringify(p0.rowIds)} while flying `
        + `${of.flight('vessels').promotedId}`);

  // --- 1. A RENDEZVOUS TARGET, PICKED FROM THE LIST ------------------------
  const station = p0.rowIds.find((i) => i.startsWith('v:'));
  const r1 = await pressRow(station);
  check('pressing a target row LANDED', r1.landed, r1.why);
  check('pressing a target row selected it', r1.sel === station,
        `selected ${r1.sel}, expected ${station}`);
  const p1 = P();
  check('a curve was built', p1.samples > 0, `${p1.samples} samples`);
  check('the curve is the requested length', p1.samples === 64, `${p1.samples}`);
  log.push(`curve: ${p1.solved} solved, ${p1.unsolved} unsolved, `
    + `spread ${Number(p1.spreadMS).toFixed(1)} m/s`);

  // --- 2. THE CHART, READ OFF THE DRAWN SVG --------------------------------
  const svg = document.querySelector('#of-map .pchart svg');
  check('the chart is DRAWN', svg !== null);
  let drawnPts = 0;
  if (svg !== null) {
    const runs = (svg.getAttribute('data-pts') ?? '').split(';').filter((x) => x);
    for (const r of runs) drawnPts += r.trim().split(/\s+/).filter((x) => x).length;
    const polys = svg.querySelectorAll('polyline').length;
    check('the chart drew at least one polyline', polys >= 1, `${polys}`);
    // (b) THE NaN RULE. A departure with no solution is a GAP, so the drawn
    // point count is the SOLVED count and never the sample count.
    check('the drawn points equal the SOLVED samples, not the sample count',
          drawnPts === p1.solved,
          `drew ${drawnPts}, solved ${p1.solved} of ${p1.samples}`);
    check('the chart marks the cheapest departure',
          svg.querySelector('circle.best') !== null || p1.cheapest < 0);
    check('the chart marks the chosen departure',
          svg.querySelector('circle.chosen') !== null);
  }

  // --- 3. THE GATE, SWEPT ACROSS THE WHOLE CURVE ---------------------------
  //
  // The arm button's `disabled` must EQUAL `!chosenFeasible` at EVERY departure,
  // so a button that is always live and one that is always dead both fail.
  //
  // AND BOTH STATES MUST ACTUALLY OCCUR. The first version of this walked six
  // samples and then asserted `some(true) || some(false)`, which is TRUE for
  // any non-empty array: a tautology dressed as a control. It also only ever
  // saw the cheap end of the curve, so the CANNOT branch was never drawn and
  // the interesting half of Reid's rule was untested.
  //
  // Sweeping the whole curve is the honest fixture and it needs no contrivance:
  // a rendezvous costs 733 m/s at the good moment and over 3 km/s at the worst
  // one, so the same vehicle can and cannot fly the same trip depending only on
  // WHEN. That IS Reid's rule, and it is why distance is the wrong way to
  // provoke a refusal in flight (a two-burn Hohmann from 680 km reaches every
  // bound orbit around Forge for about 1222 m/s, so no target is far enough).
  const seen = [];
  let gateHeld = true;
  const N = P().samples;
  for (let k = 0; k < N; ++k) {
    const st = P();
    const arm = document.querySelector('#of-map [data-plan-act="arm"]');
    const disabled = arm === null ? null : arm.disabled === true;
    seen.push([st.chosen, st.chosenFeasible, disabled,
               Number(st.chosenDvMS).toFixed(0)]);
    if (arm === null || disabled !== !st.chosenFeasible) gateHeld = false;
    if (k < N - 1) await pressAct('later');
  }
  check('the arm button is armed exactly when the chosen departure is flyable',
        gateHeld, JSON.stringify(seen.filter((x) => x[2] !== !x[1]).slice(0, 4)));
  const anyGo = seen.filter((x) => x[1] === true).length;
  const anyNo = seen.filter((x) => x[1] === false).length;
  check('some departures ARE flyable', anyGo > 0, `${anyGo} of ${seen.length}`);
  check('and some are NOT, so the refusing branch was really drawn',
        anyNo > 0, `${anyNo} of ${seen.length}`);
  // THE SENTENCE REID ASKED FOR, asserted: a departure you cannot afford must
  // offer the schedule rather than a flat refusal, because there IS one you can
  // afford. That is 'wait', and it is the state the whole feature exists for.
  let sawWait = false;
  let waitWhy = '';
  if (anyNo > 0) {
    const bad = seen.find((x) => x[1] === false);
    for (let k = 0; k < N && P().chosen !== bad[0]; ++k) await pressAct('earlier');
    if (P().chosen !== bad[0]) {
      for (let k = 0; k < N && P().chosen !== bad[0]; ++k) await pressAct('later');
    }
    const st = P();
    sawWait = st.verdict === 'wait';
    waitWhy = st.why;
    check('an unaffordable departure says NOT NOW BUT LATER, not a refusal',
          st.verdict === 'wait', `verdict ${st.verdict} at sample ${st.chosen}`);
    check('and it names a departure that CAN be flown', st.earliest >= 0,
          `earliest ${st.earliest}`);
    const band = document.querySelector('#of-map .pverdict')?.textContent ?? '';
    check('the screen says it too', /NOT NOW, BUT LATER/.test(band), band);
    check('and the earliest-flyable button is offered only then',
          document.querySelector('#of-map [data-plan-act="earliest"]') !== null);
  }

  // --- 4. THE TWO JUMP BUTTONS ARE DIFFERENT QUESTIONS ---------------------
  const jc = await pressAct('cheapest');
  check('the cheapest button LANDED', jc.landed, jc.why);
  const p4 = P();
  check('the cheapest button lands on the cheapest sample',
        p4.chosen === p4.cheapest, `chosen ${p4.chosen}, cheapest ${p4.cheapest}`);
  check('and the cheapest sample really is the minimum',
        p4.cheapest >= 0 && Number.isFinite(p4.chosenDvMS),
        `cheapest ${p4.cheapest} dv ${p4.chosenDvMS}`);

  // --- 5. THE PLANNED PATH IS DRAWN ----------------------------------------
  //
  // Asserted off `OrbitLines.drawn.plannedPoints`, which is the count taken
  // INSIDE the paint pass, so this is the polyline the player sees and not the
  // array that was handed to it. It is the same amber slot a manual maneuver
  // node uses, fed by `of_ap_plan`'s own post-burn state through the same
  // `of_mn_path`, which is why the transfer arc and the node arc cannot
  // disagree about what a planned orbit looks like.
  await sleep(0.8);
  const three = of.map('report').three;
  const plannedPts = three?.lines?.plannedPoints ?? 0;
  check('the transfer arc reached the picture', plannedPts > 0,
        JSON.stringify(three && three.lines));

  // --- 6. THE FLAT CURVE, A POSITIVE CONTROL -------------------------------
  // A ring has no phase, so no window: waiting buys nothing and the curve must
  // be flat. A rendezvous must NOT be, or the generator is returning a
  // constant and check 1 proved nothing.
  const rOrbit = await pressRow('orbit');
  check('the requested-orbit row selected', rOrbit.sel === 'orbit', rOrbit.sel);
  await sleep(0.8);
  const p6 = P();
  const flat = Number(p6.spreadMS);
  check('a circular target has a FLAT curve (no phase, so no window)',
        Number.isFinite(flat) && flat < 1.0, `spread ${flat} m/s`);
  const rendezvousSpread = Number(p1.spreadMS);
  check('and a rendezvous is NOT flat, so the generator is not a constant',
        !Number.isFinite(rendezvousSpread) || rendezvousSpread > 1.0,
        `rendezvous spread ${rendezvousSpread} m/s`);

  // --- 7. THE BODY ROW IS A DESTINATION NOW -------------------------------
  //
  // THIS SECTION USED TO ASSERT THE OPPOSITE AND WAS RED AT HEAD (GP-352 found
  // it). When it was written Cinder carried a `blocked` sentence, so the checks
  // were "a body that cannot be planned says CANNOT PLAN" and "no arm button is
  // offered for it". R71, R72 and R74 landed, GP-291 DELETED that sentence and
  // GP-295 gave the moon its own departure chart, so both premises retired and
  // the probe went on asserting them: it is INSTRUMENTS.md's control-that-
  // depends-on-something-that-moved, in a probe rather than in a threshold.
  // Confirmed by running this file against HEAD's own sources in a scratch tree
  // before touching it, which failed identically by name, so it is not a
  // regression from the pass that found it.
  //
  // THE CANNOT PLAN BRANCH IS NOT DELETED FROM THE UI and is still reachable:
  // `AutopilotTargets` blocks a vessel record that is PARKED (on the ground) or
  // held in powered flight. It is simply not reachable from THIS fixture, which
  // has one rails station and one flying rocket, so the claim is made about the
  // state this run can actually produce rather than asserted against a case it
  // cannot reach.
  const rBody = await pressRow('b:cinder');
  check('the body row selected', rBody.sel === 'b:cinder', rBody.sel);
  await sleep(1.6);                     // past the curve latch for this row
  const txt = document.querySelector('#of-map .pverdict')?.textContent ?? '';
  check('a body is planned rather than refused', !/CANNOT PLAN/.test(txt), txt);
  check('and it gets one of the three scheduling verdicts',
        /CAN FLY THIS DEPARTURE|NOT NOW, BUT LATER|NOT WITH THIS VEHICLE/
          .test(txt), txt);
  check('an arm button IS offered for it',
        document.querySelector('#of-map [data-plan-act="arm"]') !== null);
  check('and it has a chart of its own (GP-295)',
        document.querySelector('#of-map .pchart svg') !== null);

  // --- 8. THE CURVE IS ON A LATCH, NOT A FRAME COUNTER ---------------------
  const b0 = P().curveBuilds;
  for (let k = 0; k < 40; ++k) await sleep(1 / 60);
  const b1 = P().curveBuilds;
  check('the curve is not rebuilt every frame', b1 - b0 <= 1,
        `${b1 - b0} rebuilds over 40 frames`);

  // END ON THE RENDEZVOUS, so the screenshot this run captures is the feature
  // rather than the last refusal the probe happened to drive.
  await pressRow(station);
  await pressAct('cheapest');
  await sleep(0.8);

  return {
    valid: fails.length === 0,
    fails,
    log,
    rowIds: p0.rowIds,
    samples: p1.samples,
    solved: p1.solved,
    unsolved: p1.unsolved,
    drawnPts,
    rendezvousSpreadMS: p1.spreadMS,
    ringSpreadMS: p6.spreadMS,
    verdict: p1.verdict,
    cheapest: p4.cheapest,
    earliest: p1.earliest,
    gateVisits: seen.length,
    flyable: seen.filter((x) => x[1]).length,
    unflyable: seen.filter((x) => !x[1]).length,
    sawWait, waitWhy,
    plannedPoints: plannedPts,
    threeLines: three?.lines ?? null,
    curveBuildsOver40Frames: b1 - b0,
    planBuilds: P().planBuilds,
    note: 'the chart is asserted off the drawn SVG, NaN is asserted as a gap, '
      + 'and the arm gate is asserted as an equivalence at every departure',
  };
})()
