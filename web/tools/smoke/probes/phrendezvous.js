// phrendezvous.js: PH-300. FLY THE STORYLINE'S FIRST ORBITAL MISSION BY HAND
// AND WRITE DOWN EVERY PLACE A PLAYER CANNOT TELL WHAT TO DO NEXT.
//
//   node tools/smoke/run.mjs --url=http://127.0.0.1:5207/ --sandbox=1 \
//        --settle=6 --evalfile=tools/smoke/probes/phrendezvous.js
//
// THIS IS A DIAGNOSTIC, NOT AN ACCEPTANCE. It uses ONLY what a player has today
// (the pause-menu cheats, the map panel's real buttons, the bound keys) and
// records what the client tells them at each step.
//
// The distinction the file turns on: a value the client COMPUTES every frame
// and never DRAWS is not available to a player. So every information check is
// two-sided: `has` (in of.map('report')) and `drawn` (in the DOM).
(async () => {
  const of = window.__of;
  if (!of) return { valid: false, why: 'no __of' };
  for (const k of ['flight', 'vab', 'map', 'pause', 'run', 'build']) {
    if (typeof of[k] !== 'function') return { valid: false, why: `no __of.${k}` };
  }
  if (typeof of.input?.act !== 'function') return { valid: false, why: 'no __of.input.act' };

  const sleep = (n) => of.run(n);
  const fails = [];
  const rows = [];
  const check = (name, ok, detail) => {
    if (ok !== true) fails.push(detail === undefined ? name : `${name}: ${detail}`);
    return ok === true;
  };
  const rec = (name, value, note) => {
    rows.push({ name, value, note: note ?? '' });
    return value;
  };

  const FM = () => of.flight('report');
  const F = () => of.flight('report').flight;
  const RD = () => of.flight('readout');
  const M = () => of.map('report');
  const P = () => of.map('report').planner;

  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1],
                           a[2] * b[0] - a[0] * b[2],
                           a[0] * b[1] - a[1] * b[0]];
  const len = (a) => Math.hypot(a[0], a[1], a[2]);
  const norm = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
  const angDeg = (a, b) => {
    let c = dot(norm(a), norm(b));
    c = c > 1 ? 1 : c < -1 ? -1 : c;
    return Math.acos(c) * 180 / Math.PI;
  };
  /** Angle between two (heading, pitch) navball markers, in degrees. */
  const markAng = (a, b) => {
    if (a === null || b === null) return NaN;
    const d = (x) => x * Math.PI / 180;
    const u = (m) => [Math.cos(d(m.pitchDeg)) * Math.sin(d(m.headingDeg)),
                      Math.cos(d(m.pitchDeg)) * Math.cos(d(m.headingDeg)),
                      Math.sin(d(m.pitchDeg))];
    return angDeg(u(a), u(b));
  };
  const nose = () => { const r = RD(); return { headingDeg: r.headingDeg, pitchDeg: r.pitchDeg }; };

  const readoutRow = (label) => {
    const el = document.querySelector('#of-map');
    if (el === null) return null;
    for (const r of el.querySelectorAll('.row')) {
      const k = r.querySelector('em, span');
      if (k !== null && (k.textContent ?? '').trim() === label) {
        return ((r.querySelector('b') ?? {}).textContent ?? '').trim();
      }
    }
    return null;
  };
  const clickSel = async (sel, settle = 0.4) => {
    const b = document.querySelector(sel);
    if (b === null) return false;
    b.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await sleep(settle);
    return true;
  };
  /** Drive the warp ladder to a FACTOR, through the bound keys only. */
  const setWarp = async (factor) => {
    for (let i = 0; i < 12 && F().warp > factor; ++i) {
      of.input.act(['warpDown'], 3); await sleep(0.05);
    }
    for (let i = 0; i < 12 && F().warp < factor; ++i) {
      of.input.act(['warpUp'], 3); await sleep(0.05);
    }
    return F().warp;
  };
  /** Velocity by finite difference of the published unrounded position. */
  const velEst = async () => {
    const a = F(); const p0 = a.pos; const t0 = a.timeS;
    await sleep(0.25);
    const b = F(); const p1 = b.pos; const t1 = b.timeS;
    const dt = t1 - t0;
    if (!(dt > 0)) return null;
    return [(p1[0] - p0[0]) / dt, (p1[1] - p0[1]) / dt, (p1[2] - p0[2]) / dt];
  };

  // =========================================================================
  // SECTION 0. THE FIXTURE.
  // =========================================================================
  await sleep(0.8);
  of.build(0);
  of.vab('enter');
  await sleep(0.4);
  const cat = of.vab('catalogue');
  rec('catalogue.parts', cat.length);
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
  document.querySelector('#of-pause button[data-cheat="fuel"]')?.click();
  await sleep(0.5);
  of.pause(false);
  await sleep(1.2);

  check('fixture: aboard and in orbit', F().status === 'ORBIT' && FM().aboard,
        `status ${F().status} aboard ${FM().aboard}`);
  if (F().status !== 'ORBIT') return { valid: false, why: 'no orbit', fails, rows };

  // POSITIVE CONTROL FOR THE ANGLE ARITHMETIC, taken before anything is flown.
  // `warpToOrbit` sets the nose EXACTLY prograde, so if markAng is sound this
  // reads ~0 and the R89 section's numbers mean what they say. Without it a
  // wrong frame conversion and a vehicle pointing the wrong way are the same
  // reading.
  const proCtl = markAng(nose(), RD().prograde);
  const retroCtl = markAng(nose(), RD().retrograde);
  rec('CONTROL: nose vs prograde straight after teleport (deg)', proCtl);
  rec('CONTROL: nose vs retrograde straight after teleport (deg)', retroCtl);
  check('CONTROL: the marker arithmetic reads 0 where the nose is known '
        + 'to be prograde', proCtl < 2 && retroCtl > 178,
        `pro ${proCtl} retro ${retroCtl}`);

  const vessels = () => of.flight('vessels').list;
  const st0 = vessels().find((v) => v.status === 'station:anchorage')
    ?? vessels().find((v) => v.name === 'Anchorage') ?? null;
  check('fixture: Anchorage is a registry record', st0 !== null,
        JSON.stringify(vessels().map((v) => [v.id, v.name, v.status])));
  if (st0 === null) return { valid: false, why: 'no station', fails, rows };
  rec('station.id/parts/mode', [st0.id, st0.parts, st0.mode]);

  const tick0 = of.flight('vessels').tick;
  const s0 = of.flight('railsAt', { id: st0.id, tick: tick0 });
  rec('station.pos', s0.pos);
  rec('station.vel', s0.vel);
  const stR = len(s0.pos);
  rec('station |r| (m)', stR);
  rec('station |v| (m/s)', len(s0.vel));

  const myAp0 = F().apoapsisM, myPe0 = F().periapsisM;
  rec('craft AP/PE (m)', [myAp0, myPe0]);
  const bodyR = stR - 400000;
  rec('body radius implied by a 400 km station (m)', bodyR);
  const stationAlt = stR - bodyR;

  check('fixture: the target orbit is NOT the one we are on '
        + '(the identity element of a rendezvous)',
        Math.abs(stationAlt - myAp0) > 100000,
        `station ${stationAlt.toFixed(0)} vs craft AP ${myAp0.toFixed(0)}`);

  // Does the station MOVE? D-014 says an orbiting thing orbits.
  const sA = of.flight('railsAt', { id: st0.id, tick: of.flight('vessels').tick });
  await sleep(2.0);
  const sB = of.flight('railsAt', { id: st0.id, tick: of.flight('vessels').tick });
  const stationMovedM = Math.hypot(sB.pos[0] - sA.pos[0], sB.pos[1] - sA.pos[1],
                                   sB.pos[2] - sA.pos[2]);
  rec('station movement over 2 s of wall clock (m)', stationMovedM,
      'D-014 rules an orbiting thing genuinely orbits; a frozen record does not');

  // =========================================================================
  // SECTION 1. GEOMETRY, measured here so the rest is about whether the game
  // tells the player any of it.
  // =========================================================================
  of.input.act(['map'], 4);
  await sleep(0.8);
  check('the map opened on M', M().open === true, `open ${M().open}`);

  const myPos = F().pos;
  const myVel = await velEst();
  rec('craft pos', myPos);
  rec('craft vel (finite difference)', myVel);
  check('the finite-difference velocity has orbital magnitude',
        myVel !== null && len(myVel) > 1000 && len(myVel) < 20000,
        myVel === null ? 'null' : `${len(myVel).toFixed(1)} m/s`);

  const hMe = myVel === null ? null : cross(myPos, myVel);
  const hSt = cross(s0.pos, s0.vel);
  const relIncDeg = hMe === null ? NaN : angDeg(hMe, hSt);
  rec('relative inclination (deg)', relIncDeg,
      'nothing in the client publishes this; a plane change costs 2v sin(i/2)');
  const phaseDeg = angDeg(myPos, s0.pos);
  rec('phase angle craft to station (deg)', phaseDeg,
      'a Hohmann only arrives if this is right at ignition');
  const rangeTruth = Math.hypot(s0.pos[0] - myPos[0], s0.pos[1] - myPos[1],
                                s0.pos[2] - myPos[2]);
  rec('true range to Anchorage (m)', rangeTruth);

  // =========================================================================
  // SECTION 2. CAN THE PLAYER SEE THE TARGET AT ALL?
  // =========================================================================
  const rowIds = P().rowIds;
  rec('planner rowIds', rowIds);
  const stationRowId = rowIds.find((id) => id === `v:${st0.id}`) ?? null;
  check('Anchorage appears in the planner target list', stationRowId !== null,
        JSON.stringify(rowIds));

  if (stationRowId !== null) {
    const clicked = await clickSel(`#of-map [data-plan="${stationRowId}"]`, 0.7);
    if (!clicked) { of.map('select', { id: stationRowId }); await sleep(0.7); }
    rec('planner.selectedId after selecting Anchorage', P().selectedId);
    rec('planner.targetName', P().targetName);
    check('Anchorage is the selected target', P().selectedId === stationRowId,
          `${P().selectedId}`);
  }

  const drawnRange = readoutRow('range');
  const drawnClosing = readoutRow('closing at') ?? readoutRow('OPENING at');
  rec('DOM row "range"', drawnRange);
  rec('DOM row "closing at"', drawnClosing);
  rec('planner run.armed', P().run.armed);
  rec('report has runRangeM?', Object.keys(P()).includes('runRangeM'));

  check('FINDING 1: with Anchorage selected the panel draws NO range and NO '
        + 'closing rate, and the debug report carries neither',
        drawnRange === null && drawnClosing === null
        && !Object.keys(P()).includes('runRangeM'),
        `drawn ${JSON.stringify(drawnRange)}/${JSON.stringify(drawnClosing)}`);

  // The departure chart is the one thing that DOES answer for a vessel target.
  rec('planner samples/solved/unsolved',
      [P().samples, P().solved, P().unsolved]);
  rec('planner chosenDvMS / chosenTS / verdict',
      [P().chosenDvMS, P().chosenTS, P().verdict]);
  rec('planner spreadMS', P().spreadMS);

  const nbJson = JSON.stringify(RD());
  rec('readout keys', Object.keys(RD()).join(','));
  check('FINDING 2: the navball readout has no target-relative field',
        !/target/i.test(nbJson), 'the readout mentions "target"');

  // =========================================================================
  // SECTION 3. THE NODE: what can a player express, at what granularity?
  // =========================================================================
  const placed = await clickSel('#of-map [data-act="place"]', 0.8);
  check('the place-node button exists and was pressed', placed === true);
  check('a node exists after the press', M().node !== null,
        JSON.stringify(M().node));
  if (M().node === null) return { valid: false, why: 'no node', fails, rows };
  rec('node.atS', M().node.atS);
  rec('plan AP before any handle (m)', M().plan.apoapsisAltM);

  const apBefore = M().plan.apoapsisAltM;
  await clickSel('#of-map [data-axis="prograde"][data-delta="10"]', 0.35);
  const apAfter = M().plan.apoapsisAltM;
  const dApPer10 = apAfter - apBefore;
  rec('result AP change per 10 m/s prograde (m)', dApPer10,
      'the SMALLEST orbit change the node UI can express');
  check('the prograde button moved the plan', Math.abs(dApPer10) > 1,
        `${apBefore} -> ${apAfter}`);

  let presses = 1;
  for (let i = 0; i < 400; ++i) {
    if (M().plan.apoapsisAltM >= stationAlt) break;
    await clickSel('#of-map [data-axis="prograde"][data-delta="10"]', 0.02);
    presses += 1;
  }
  const planT = M().plan;
  rec('button presses to raise AP to the station altitude', presses);
  rec('resulting AP (m)', planT.apoapsisAltM);
  rec('AP overshoot past the station (m)', planT.apoapsisAltM - stationAlt,
      'the residual the 10 m/s quantum leaves');
  rec('node dV (m/s)', planT.deltaVMS);
  rec('node burn (s)', planT.burnDurationS);
  rec('node timeToNodeS', planT.timeToNodeS);
  rec('DOM "result AP"', readoutRow('result AP'));
  rec('DOM "dV"', readoutRow('dV'));
  rec('DOM "light it in"', readoutRow('light it in'));

  const panelText = (document.querySelector('#of-map') ?? {}).textContent ?? '';
  check('FINDING 3: nothing in the map panel mentions closest approach, '
        + 'intercept or encounter',
        !/closest|intercept|encounter/i.test(panelText),
        'the panel does mention it after all');

  const beforeTime = { t: M().node.atS, ap: M().plan.apoapsisAltM };
  for (let i = 0; i < 5; ++i) {
    await clickSel('#of-map [data-axis="time"][data-delta="60"]', 0.04);
  }
  const afterTime = { t: M().node.atS, ap: M().plan.apoapsisAltM };
  rec('node time +5 presses (300 s)', { before: beforeTime, after: afterTime });
  check('the node time handle moved the node', afterTime.t > beforeTime.t,
        `${beforeTime.t} -> ${afterTime.t}`);

  // =========================================================================
  // SECTION 4. FLY THE BURN BY HAND, as the panel instructs.
  // =========================================================================
  await clickSel('#of-map [data-act="clear"]', 0.4);
  await clickSel('#of-map [data-act="place"]', 0.6);
  let np = 0;
  for (let i = 0; i < 400; ++i) {
    if (M().plan.apoapsisAltM >= stationAlt) break;
    await clickSel('#of-map [data-axis="prograde"][data-delta="10"]', 0.02);
    np += 1;
  }
  rec('flight node presses / dV / light-in',
      [np, M().plan.deltaVMS, M().plan.timeToBurnStartS]);

  of.input.act(['sasNode'], 4);
  await sleep(0.6);
  rec('holding after the 8 key', M().holding);
  check('the hold-node key latched', M().holding === true, `${M().holding}`);

  // TELEPORT TO ORBIT does not stage, so nothing is lit yet.
  of.input.act(['stage'], 4);
  await sleep(0.5);
  rec('nextStage after staging', F().nextStage);

  let waited = 0;
  for (let i = 0; i < 400; ++i) {
    const t = M().plan.timeToBurnStartS;
    if (!Number.isFinite(t) || t < 3) break;
    await setWarp(t > 400 ? 50 : t > 120 ? 10 : t > 30 ? 4 : 1);
    await sleep(t > 400 ? 0.6 : t > 120 ? 0.4 : t > 30 ? 0.3 : 0.15);
    waited += 1;
  }
  await setWarp(1);
  // A BURN FLOWN 200 s EARLY IS THE PILOT'S DEFECT, NOT THE GAME'S. The first
  // run of this probe ran out of coast polls and lit the engine with 196 s
  // still on the clock, and the miss distance it then reported would have been
  // mine. Assert the fixture before believing anything downstream of it.
  check('fixture: the engine is lit AT the node, not early',
        Math.abs(M().plan.timeToBurnStartS) < 8,
        `light it in ${M().plan.timeToBurnStartS}`);
  rec('coast polls to reach the burn', waited);
  rec('light it in at ignition (s)', M().plan.timeToBurnStartS);
  rec('pointing error at ignition (deg)', F().sasErrDeg);
  rec('nose vs node marker at ignition (deg)', markAng(nose(), RD().node));

  const dvAtIgnition = M().plan.deltaVMS;
  const burnSamples = [];
  of.input.act(['throttleFull'], 4);
  await sleep(0.15);
  for (let i = 0; i < 200; ++i) {
    const pl = M().plan;
    burnSamples.push([Number(pl.deltaVMS.toFixed(2)), Number(F().apoapsisM.toFixed(0)),
                      F().throttle]);
    if (!Number.isFinite(pl.deltaVMS) || pl.deltaVMS <= 1.0) break;
    if (F().apoapsisM >= stationAlt) break;
    await sleep(0.10);
  }
  of.input.act(['throttleCut'], 4);
  await sleep(0.4);
  rec('burn samples', burnSamples.length);
  rec('burn first/last sample', [burnSamples[0] ?? null,
                                 burnSamples[burnSamples.length - 1] ?? null]);
  rec('node dV at ignition', dvAtIgnition);
  const dvFell = burnSamples.length > 2
    && burnSamples[burnSamples.length - 1][0] < burnSamples[0][0] - 1;
  rec('did the node dV count down during the burn?', dvFell,
      'if not, a hand-flying player has no cut-off cue');

  const apAfterBurn = F().apoapsisM, peAfterBurn = F().periapsisM;
  rec('orbit after the transfer burn (AP/PE)', [apAfterBurn, peAfterBurn]);
  check('the burn actually moved the apoapsis', apAfterBurn > myAp0 + 10000,
        `${myAp0.toFixed(0)} -> ${apAfterBurn.toFixed(0)}`);

  // =========================================================================
  // SECTION 5. COAST TO APOAPSIS AND MEASURE THE MISS.
  // =========================================================================
  // The range a player CANNOT see, computed here by subtraction of two states
  // /core itself produced, exactly as MapPlanner.closing() does it.
  const rangeNow = () => {
    const t = of.flight('vessels').tick;
    const s = of.flight('railsAt', { id: st0.id, tick: t });
    const p = F().pos;
    return Math.hypot(s.pos[0] - p[0], s.pos[1] - p[1], s.pos[2] - p[2]);
  };
  let best = Infinity, bestAlt = 0;
  const track = [];
  for (let i = 0; i < 200; ++i) {
    const r = rangeNow();
    const alt = F().altitudeDatumM;
    if (Number.isFinite(r) && r < best) { best = r; bestAlt = alt; }
    if (i % 10 === 0) track.push([Number(alt.toFixed(0)), Number(r.toFixed(0))]);
    if (alt > stationAlt * 0.985) break;
    await setWarp(alt > stationAlt * 0.9 ? 4 : 50);
    await sleep(0.3);
  }
  await setWarp(1);
  rec('coast track [alt, range]', track);
  rec('closest range seen on the coast (m)', best);
  rec('altitude at closest (m)', bestAlt);
  rec('range at arrival (m)', rangeNow());
  rec('altitude at arrival (m)', F().altitudeDatumM);
  rec('FINDING 5: the miss distance against a 0.60 m capture radius', best);

  // =========================================================================
  // SECTION 6. FINE MOVEMENT.
  // =========================================================================
  const bind = of.input.bindings();
  const actionNames = Object.keys(bind);
  const rcsActions = actionNames.filter((a) => /rcs|translat|dock/i.test(a));
  rec('bound actions matching rcs/translate/dock', rcsActions);
  rec('total bound actions', actionNames.length);
  check('FINDING 6: there is no bound key for translational RCS',
        rcsActions.length === 0, JSON.stringify(rcsActions));

  // =========================================================================
  // SECTION 6b. WHAT THE PANEL WOULD SAY ABOUT THE APPROACH IF IT DREW IT.
  //
  // The range and closing rate exist behind the autopilot's arm gate. Arm it,
  // read the PIXELS, and compare the drawn closing rate against the truth for
  // a target whose POSITION never advances. `stateOf` publishes the station's
  // conic VELOCITY (1879 m/s) while `clockAt` freezes its POSITION, so the two
  // halves of the same record disagree, and the closing rate is the subtraction
  // that puts them side by side.
  // =========================================================================
  const armed = await clickSel('#of-map [data-plan-act="arm"]', 1.2);
  rec('arm button present', armed);
  const armedNow = P().run.armed;
  rec('planner run.armed after the press', armedNow);
  const drawnRange2 = readoutRow('range');
  const drawnClosing2 = readoutRow('closing at') ?? readoutRow('OPENING at');
  rec('DOM "range" once armed', drawnRange2);
  rec('DOM "closing at" once armed', drawnClosing2);

  // The truth, from two positions of the frozen record one interval apart.
  const tA = of.flight('vessels').tick;
  const pA = of.flight('railsAt', { id: st0.id, tick: tA }).pos;
  await sleep(1.0);
  const tB = of.flight('vessels').tick;
  const pB = of.flight('railsAt', { id: st0.id, tick: tB }).pos;
  const stationSpeedTruth = Math.hypot(pB[0] - pA[0], pB[1] - pA[1], pB[2] - pA[2])
    / Math.max(1e-9, (tB - tA) / 60);
  rec('station speed by finite difference of its own position (m/s)',
      stationSpeedTruth);
  rec('station speed published by stateOf (m/s)', len(s0.vel));
  check('FINDING 8: the station record publishes an orbital VELOCITY it does '
        + 'not have, because its POSITION never advances',
        stationSpeedTruth < 1 && len(s0.vel) > 1000,
        `finite-diff ${stationSpeedTruth} vs published ${len(s0.vel)}`);

  // Put it back before the attitude section.
  await clickSel('#of-map [data-plan-act="cancel"]', 0.8);
  rec('planner run.armed after cancel', P().run.armed);

  // =========================================================================
  // SECTION 7. R89, on the navball's own markers.
  //
  // THE NODE MUST GO FIRST. The first run of this probe measured 84 degrees of
  // pointing error from a SAS RETRO press and the cause was this file: the
  // maneuver node was still held, and MapNode re-aims the command every frame,
  // so the vehicle was obeying a node while the probe believed it was obeying
  // a key. A fixture that cannot perform the action cannot exhibit a defect
  // in it.
  // =========================================================================
  if (M().holding === true) { of.input.act(['sasNode'], 4); await sleep(0.4); }
  await clickSel('#of-map [data-act="clear"]', 0.5);
  rec('node cleared before the attitude test', M().node);
  rec('holding cleared before the attitude test', M().holding);
  check('fixture: no node is held during the attitude test',
        M().node === null && M().holding === false,
        `node ${JSON.stringify(M().node)} holding ${M().holding}`);
  of.input.act(['map'], 4);
  await sleep(0.5);

  of.input.act(['sasRetrograde'], 4);
  await sleep(4.0);
  for (let i = 0; i < 12 && markAng(nose(), RD().retrograde) > 2; ++i) {
    await sleep(2.0);
  }
  rec('SAS mode while pointing retrograde', F().sas);
  check('fixture: the RETRO key actually took', F().sas === 'RET', F().sas);
  const retroErr = markAng(nose(), RD().retrograde);
  rec('nose vs retrograde marker after RETRO (deg)', retroErr);
  rec('SAS after RETRO', F().sas);

  of.input.act(['sasToggle'], 4);   // -> OFF
  await sleep(0.4);
  const sasMid = F().sas;
  of.input.act(['sasToggle'], 4);   // -> CMD
  await sleep(2.0);
  const sasAfter = F().sas;
  const cmdVsRetro = markAng(nose(), RD().retrograde);
  const cmdVsPro = markAng(nose(), RD().prograde);
  rec('SAS chain RETRO -> toggle -> toggle', [F().sas, sasMid, sasAfter]);
  rec('R89: nose vs retrograde in CMD (deg)', cmdVsRetro);
  rec('R89: nose vs prograde in CMD (deg)', cmdVsPro);
  check('FINDING 7 (R89): returning to CMD leaves the nose retrograde',
        Number.isFinite(cmdVsRetro) && cmdVsRetro < 20,
        `retro ${cmdVsRetro} pro ${cmdVsPro} sas ${sasAfter}`);

  // POSITIVE CONTROL.
  check('POSITIVE CONTROL: the run reached the end of the file', true);

  return {
    valid: true, reachedEnd: true, fails, failCount: fails.length, rows,
    summary: {
      craftAp: myAp0, craftPe: myPe0, stationAltM: stationAlt,
      stationMovedM, relIncDeg, phaseDeg, rangeTruth,
      dApPer10, presses,
      apAfterBurn, peAfterBurn, closestRangeM: best,
      rcsActions: rcsActions.length,
      r89RetroDeg: cmdVsRetro,
    },
  };
})()
