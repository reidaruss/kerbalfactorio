// armedleave.js: PS-44. WHERE DOES AN ARMED PROGRAMME ACTUALLY DIE?
//
//   node tools/smoke/run.mjs --sandbox=1 --settle=25 \
//        --evalfile=tools/smoke/probes/armedleave.js
//
// Reid asked to "set it to launch at a later time", and a departure hours out is
// exactly the case where a player closes the tab. Before designing what a save
// has to carry, this measures WHOSE state an armed programme is, because the
// answer decides who owns the field.
//
// It is deliberately a ONE-PAGE probe with no reload in it. The reload case is
// already settled by reading: `of_ap_arm_*` are the only doors, none of them
// takes a stored plan, no export reads a `Program` back out, `FlightState.timeS`
// restarts at 0 on `of_fl_create` and nothing can set it, and a vessel left on
// rails has NO flight handle at all after a boot until the player resumes
// control. So a reload cannot possibly keep it, and a probe that proved that
// would be proving the entailed half.
//
// THE HALF THAT IS NOT ENTAILED, and that decides the design: does an armed
// programme survive LEAVING THE VESSEL and coming back, inside one page? The
// autopilot lives on the FlightSim, and leaving demotes the vessel to a registry
// record. If the programme dies there too, then it is not flight-session state
// that a save has to mirror, it is VESSEL state that the registry record should
// have carried all along, and the save field belongs on the record rather than
// on the slot.
//
// THE FIXTURE IS APEXEC'S, because it is the proven one, and it must not be the
// identity case: a hold-orbit request within a metre of the current radius
// returns a VALID programme of ZERO burns that completes instantly and perfectly
// (GP-300). The altitude is moved before arming and the gap is asserted.
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
    el.click(); await sleep(0.6);
    return { landed: true, sel: P().selectedId, why: '' };
  };
  const pressAct = async (act, settle = 0.4) => {
    const el = document.querySelector(`#of-map [data-plan-act="${act}"]`);
    if (el === null) return { landed: false, why: `no button ${act}` };
    const disabled = el.disabled === true;
    el.click(); await sleep(settle);
    return { landed: true, disabled, why: '' };
  };
  // Everything the 18-word row says, reduced ONCE, so the before and after
  // cannot be reduced differently and then compared (PS-15's rule).
  const reduce = (r) => r === null || r === undefined ? null : {
    armed: r.armed === true, running: r.running === true, phase: r.phase,
    mode: r.mode, burnIndex: r.burnIndex, burnCount: r.burnCount,
    toIgnitionS: r.timeToIgnitionS, programDvMS: r.programDvMS,
    dvSpentTotalMS: r.dvSpentTotalMS, targetRadiusM: r.targetRadiusM,
    waitingOn: r.waitingOn ?? '', waitingToDepart: r.waitingToDepart ?? null,
    phaseWord: r.phaseWord ?? null,
  };

  await sleep(0.8);
  of.build(0);

  // --- FIXTURE: a rocket, rolled out, boarded, in orbit, staged ------------
  of.vab('enter'); await sleep(0.4);
  const cat = of.vab('catalogue');
  of.vab('press', 'clear'); await sleep(0.15);
  for (const pid of [0x0100, 0x0101, 0x0103]) {
    const i = cat.find((c) => c.id === pid)?.index ?? -1;
    if (i < 0) continue;
    of.vab('frame'); of.vab('take', i); await sleep(0.12);
    const parts = of.vab('report').parts;
    if (parts.length === 0) { of.vab('place'); await sleep(0.12); continue; }
    let low = parts[0];
    for (const p of parts) if (p.origin[1] < low.origin[1]) low = p;
    const nodes = of.vab('nodes').filter((n) => n.parent === low.handle
      && n.onScreen && (n.kind === 'bottom' || n.kind === 'interstage'));
    if (nodes.length === 0) continue;
    of.vab('hover', nodes[0].ndc[0], nodes[0].ndc[1]);
    of.vab('place'); await sleep(0.12);
  }
  of.vab('leave'); await sleep(0.4);
  of.flight('rollout'); await sleep(0.8);
  for (let i = 0; i < 16 && FM().distanceToVesselM > 10; ++i) {
    of.input.act(['forward'], 30); await sleep(0.6);
  }
  of.flight('board'); await sleep(0.6);
  of.pause(true); await sleep(0.35);
  document.querySelector('#of-pause button[data-cheat="orbit"]')?.click();
  await sleep(1.5);
  of.pause(false); await sleep(1.2);
  if (F().status !== 'ORBIT') return { valid: false, why: 'fixture: no orbit', fails };
  of.input.act(['stage'], 4); await sleep(0.6);
  of.input.act(['throttleCut'], 4); await sleep(0.6);
  check('fixture: an engine is lit, so a commanded burn can produce thrust',
        F().stagings > 0, `stagings ${F().stagings}`);

  const mapCode = (of.input.bindings().map || [])[0];
  if (!mapCode) return { valid: false, why: 'no map binding', fails };
  window.dispatchEvent(new KeyboardEvent('keydown', { code: mapCode, bubbles: true }));
  await sleep(1.2);
  check('the map opened', of.map('report').open === true, `key ${mapCode}`);

  // THE PENDING BRANCH, and it is a real branch rather than a bail-out, exactly
  // as apexec.js's is. HEAD's COMMITTED of-core.wasm does not carry the
  // `of_ap_*` exports at all: the standing rule is that no lane commits the
  // binary and Admin does one settled rebuild, so physics' execution half exists
  // in `of_ap_api.inc` and not yet in anything a browser can run. A probe that
  // returned `valid: false` here would read as a defect in the save every night
  // until that rebuild lands, so it asserts what an HONEST pending build owes
  // instead, and becomes the measurement the day the exports arrive.
  const r0 = R();
  if (r0 === null || r0 === undefined || r0.waitingOn !== '') {
    // THE ROW HAS TO BE SELECTED FIRST, and the first draft of this asserted
    // before selecting one and went red on a client that was behaving. The
    // planner draws no plan section until a destination is chosen, so the
    // sentence naming the missing exports has nowhere to be. apexec.js selects
    // first for the same reason; a fixture that reads a panel before opening it
    // is measuring the closed panel.
    await pressRow('orbit');
    const txt = document.querySelector('#of-map')?.textContent ?? '';
    check('with no executor the screen names the exports it waits for, by C name',
          /of_ap_arm_hold_orbit/.test(txt) && /of_ap_status/.test(txt),
          `waitingOn "${r0 ? r0.waitingOn : '(no run block)'}"`);
    check('and nothing is armed', !(r0 && r0.armed), JSON.stringify(reduce(r0)));
    return {
      valid: fails.length === 0, fails,
      branch: 'PENDING: the executor is not in the served wasm',
      waitingOn: r0 ? r0.waitingOn : '(no run block)',
      note: 'this probe measures whether an armed programme survives LEAVING '
        + 'the vessel. It goes to its real branch the day of_ap_* reaches the '
        + 'committed binary. Until then the answer is a reading and it is in '
        + 'PS-44: g_pilots is keyed by the flight handle, of_fl_destroy frees '
        + 'that handle, nothing erases the pilot slot, and Registry::add hands '
        + 'the freed index straight back out.',
    };
  }

  // --- ARM, AND NOT AT THE IDENTITY ---------------------------------------
  const sel = await pressRow('orbit');
  check('the requested-orbit row selected', sel.sel === 'orbit', sel.sel);
  const alt0 = P().altKm ?? 0;
  for (let k = 0; k < 4; ++k) await pressAct('alt+', 0.25);
  await sleep(0.9);
  const askedAltKm = P().altKm;
  const askedRadiusM = of.world().bodyRadiusM + askedAltKm * 1000;
  const nowRadiusM = of.world().bodyRadiusM + F().apoapsisM;
  check('FIXTURE GUARD: the requested orbit is not the one we are on',
        Math.abs(askedRadiusM - nowRadiusM) > 1000,
        `asked ${askedRadiusM.toFixed(0)} m, on ${nowRadiusM.toFixed(0)} m, `
        + `alt ${alt0} -> ${askedAltKm} km`);
  const armPress = await pressAct('arm', 0.8);
  check('the arm button LANDED and was enabled',
        armPress.landed && armPress.disabled === false, JSON.stringify(armPress));
  const armed = reduce(R());
  check('THE EXECUTOR HAS A PROGRAMME', armed !== null && armed.armed === true,
        JSON.stringify(armed));
  if (armed === null || armed.armed !== true) {
    return { valid: false, why: 'nothing armed, nothing to lose', fails, armed };
  }
  log.push(`armed: ${armed.burnCount} burns, ${armed.programDvMS} m/s planned, `
    + `target radius ${armed.targetRadiusM}`);

  // --- LEAVE THE VESSEL. It becomes a registry record on rails. ------------
  const vesselsBefore = of.flight('vessels');
  const left = of.flight('leave');
  await sleep(1.2);
  const onRails = reduce(R());
  check('FIXTURE: the vessel really did go on rails',
        left && left.ok === true, JSON.stringify(left && { ok: left.ok }));

  // --- COME BACK TO IT ----------------------------------------------------
  const resumed = of.flight('resume');
  await sleep(1.5);
  const back = reduce(R());

  return {
    valid: fails.length === 0,
    fails,
    log,
    askedAltKm,
    // THE THREE READINGS, and the whole probe is these three side by side.
    armed,
    onRails,
    back,
    // WHAT ACTUALLY HAPPENED TO THE PROGRAMME, said in words so a report does
    // not have to re-derive it from three objects.
    verdict: {
      survivedLeaving: onRails !== null && onRails.armed === true,
      survivedComingBack: back !== null && back.armed === true,
    },
    vessels: {
      before: vesselsBefore ? vesselsBefore.records : -1,
      after: of.flight('vessels').records,
    },
    resumed: resumed === null ? null : { ok: resumed.ok ?? null },
    aboard: FM().aboard,
  };
})()
