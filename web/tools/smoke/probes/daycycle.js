// daycycle.js: THE SUN SWEEPS. One full day+night is 3600 s of world sim time,
// `of.setTime` still pins, and physics warp carries the sky with the vessel.
//
//   node tools/smoke/run.mjs --url=... --sandbox=1 --debug=1 \
//     --evalfile=tools/smoke/probes/daycycle.js
//
// WHY THIS PROBE EXISTS. Until PH-86 the sun did not move at all: `SkyPass.sunT`
// was written once at boot and again only by `of.setTime`, so every site sat at
// a permanent time of day fixed by its longitude (RN-67's "permanent 9 degree
// sun" said it out loud, and the baseline for this pass measured sunT
// bit-identical at 0.24861111111111112 across 46 s of wall clock). The claims
// here are two-sided where they can be:
//
//   1. THE RATE IS THE TICK COUNT, exactly: the phase moves by
//      ticks * (1/60) / 3600 turns, asserted against the day clock's own tick
//      counter rather than against wall time, which a loaded machine can stretch.
//   2. A PIN IS A PIN: `of.setTime(t)` puts the sun AT t (so every screenshot
//      probe stays deterministic), and the cycle then RUNS ON from t rather
//      than snapping back, which is the difference between pinning a phase and
//      freezing the feature.
//   3. NOON AND MIDNIGHT ARE BOTH REACHABLE, by geometry: half a turn from the
//      site's own solved noon the elevation is negative. Driving 1800 s of sim
//      to watch it happen would cost minutes of frames to prove arithmetic;
//      the RATE row already proves the clock covers that ground.
//   4. WARP CARRIES THE SKY: in orbit at high physics warp the day clock's
//      credited seconds and the base ticks together equal the vessel's own MET
//      advance, and the sun visibly sweeps.
(async () => {
  const of = window.__of;
  const sleep = (s) => of.run(s);
  const fails = [];
  const check = (n, ok, d) => { if (!ok) fails.push(d === undefined ? n : `${n}: ${d}`); };
  const log = [];
  const day = () => mustHave(of.stats().sky, 'day', 'sky');
  const sunT = () => mustNum(of.stats().sky, 'sunT', 'sky');

  console.log('[daycycle] section 0');
  // --- 0. the clock exists, says its cycle, and is already seeded ------------
  const d0 = day();
  check('the day clock is published and seeded', d0.seeded === true, JSON.stringify(d0));
  check('one full day+night is 3600 s of sim', d0.cycleS === 3600, `${d0.cycleS}`);

  console.log('[daycycle] section 1');
  // --- 1. THE RATE, asserted against the tick counter ------------------------
  const RATE_S = 10;
  const t0 = sunT();
  const ticks0 = mustNum(d0, 'advancedTicks', 'day');
  await sleep(RATE_S);
  const d1 = day();
  const t1 = sunT();
  const ticksMoved = mustNum(d1, 'advancedTicks', 'day') - ticks0;
  const dTurns = ((t1 - t0) % 1 + 1) % 1;
  const expected = (ticksMoved * (1 / 60)) / 3600;
  log.push(`rate: ${ticksMoved} ticks moved the sun ${dTurns.toExponential(6)} `
    + `turns (expected ${expected.toExponential(6)})`);
  check('the sun MOVED at all (the pre-PH-86 build fails here by definition)',
        dTurns > 0, `${dTurns}`);
  check('the run moved the sun by ticks/60/3600 turns exactly (1e-9 slack '
    + 'for the float sum)', Math.abs(dTurns - expected) < 1e-9,
        `moved ${dTurns}, expected ${expected}, ticks ${ticksMoved}`);
  check('and the rate is the 60-minute day Reid asked for, within 1%',
        Math.abs(dTurns * 3600 / RATE_S - 1) < 0.01,
        `${dTurns * 3600 / RATE_S}`);

  console.log('[daycycle] section 2');
  // --- 2. A PIN IS A PIN, and the cycle runs on from it ----------------------
  of.setTime(0.75);
  const p0 = sunT();
  check('setTime(0.75) puts the sun AT 0.75, immediately', Math.abs(p0 - 0.75) < 1e-12,
        `${p0}`);
  await sleep(2);
  const p1 = sunT();
  const pinDelta = p1 - 0.75;
  log.push(`pin: after 2 s the pinned sun moved ${pinDelta.toExponential(6)} turns`);
  check('the cycle RUNS ON from the pin rather than freezing there',
        pinDelta > 0, `${p1}`);
  check('and moved only the 2 s the run took, not back to the pre-pin phase',
        pinDelta < 5 / 3600, `${p1}`);

  console.log('[daycycle] section 3');
  // --- 3. NOON AND MIDNIGHT, by geometry -------------------------------------
  // Solve this site's own noon the way groundshot.js does, then step half a
  // turn: the elevation must change sign. This is the day/night claim made
  // without spending 1800 s of frames on arithmetic the rate row already pins.
  let bestT = 0; let bestE = -Infinity;
  for (let i = 0; i < 96; ++i) {
    of.setTime(i / 96);
    const e = of.stats().sky.elevationDot;
    if (e > bestE) { bestE = e; bestT = i / 96; }
  }
  of.setTime(bestT);
  const noonE = of.stats().sky.elevationDot;
  of.setTime(bestT + 0.5);
  const midnightE = of.stats().sky.elevationDot;
  log.push(`noon t=${bestT}: elevation ${noonE}; +half a turn: ${midnightE}`);
  check('at this site\'s own noon the sun is well up', noonE > 0.3, `${noonE}`);
  check('half a cycle later it is below the horizon: NIGHT EXISTS HERE',
        midnightE < -0.05, `${midnightE}`);

  console.log('[daycycle] section 4');
  // --- 4. WARP CARRIES THE SKY ------------------------------------------------
  // The reference stack, the same build recipe clamprestore.js uses; then orbit
  // through the sandbox cheat (this probe is about the clock, ascent.js owns
  // flying) and warp up. Only the engine stage matters here, so the stack is
  // the short two-part one: pod + tank + engine still releases and orbits.
  const PID = {
    CommandPod: 0x0100, TankLiquidSmall: 0x0101, TankLiquidSmallLong: 0x0102,
    EngineLiquidSmall: 0x0103, EngineVacuumSmall: 0x0104,
    DecouplerStackSmall: 0x0106, Parachute: 0x010a, Fin: 0x010b,
  };
  of.vab('enter'); await sleep(0.3);
  const cat = of.vab('catalogue');
  const idxOf = (id) => { const r = cat.find((c) => c.id === id); return r ? r.index : -1; };
  of.vab('press', 'clear'); await sleep(0.15);
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
  console.log('[daycycle] fixture built');
  of.vab('drop');
  const vr = of.vab('report');
  of.vab('leave'); await sleep(0.3);
  if (vr.parts.length < 3) {
    check('warp fixture: the bay produced a stack', false, `${vr.parts.length} parts`);
  } else {
    console.log('[daycycle] rollout');
    of.flight('rollout'); await sleep(0.8);
    for (let i = 0; i < 14 && of.flight('report').distanceToVesselM > 10; ++i) {
      of.input.act(['forward'], 30); await sleep(0.5);
    }
    of.input.act(['board'], 4); await sleep(0.8);
    const ab = of.flight('report');
    check('warp fixture: boarded', ab.aboard === true,
          `aboard ${ab.aboard}, dist ${ab.distanceToVesselM}`);
    console.log('[daycycle] boarding done, opening pause');
    of.pause(true); await sleep(0.35);
    const btn = document.querySelector('#of-pause button[data-cheat="orbit"]');
    check('the Teleport to orbit control is there', btn !== null && !btn.disabled,
          btn === null ? 'absent' : `disabled=${btn.disabled}`);
    btn?.click(); await sleep(1.0);
    of.pause(false); await sleep(0.8);
    const s0 = of.flight('report');
    check('the teleport actually put the craft in orbit (GP-156: antecedent '
      + 'asserted)', s0.flight.status === 'ORBIT', s0.flight.status);
    console.log('[daycycle] in orbit, warping');
    for (let i = 0; i < 6; ++i) { of.input.act(['warpUp'], 4); await sleep(0.12); }
    const w0 = of.flight('report');
    const met0 = w0.flight.metS;
    const dA = day();
    const ticksA = mustNum(dA, 'advancedTicks', 'day');
    const credA = mustNum(dA, 'warpCreditedS', 'day');
    const sun0 = sunT();
    await sleep(4);
    const w1 = of.flight('report');
    const metMoved = w1.flight.metS - met0;
    const dB = day();
    const baseS = (mustNum(dB, 'advancedTicks', 'day') - ticksA) / 60;
    const credit = mustNum(dB, 'warpCreditedS', 'day') - credA;
    const sunMoved = ((sunT() - sun0) % 1 + 1) % 1;
    log.push(`warp ${w1.flight.warp}x: met +${metMoved.toFixed(2)} s, base `
      + `${baseS.toFixed(2)} s + credit ${credit.toFixed(2)} s, sun swept `
      + `${(sunMoved * 360).toFixed(1)} deg`);
    check('the warp actually engaged well past 1x', w1.flight.warp >= 50,
          `${w1.flight.warp}`);
    check('MET = base ticks + warp credit, within two ticks: the sky\'s clock '
      + 'and the vessel\'s are the same clock under warp',
          Math.abs(baseS + credit - metMoved) < 2 / 60 + 1e-9,
          `base ${baseS} + credit ${credit} vs met ${metMoved}`);
    check('and the SKY visibly swept: more than 8 s of cycle in 4 s of run',
          sunMoved > 8 / 3600, `${sunMoved} turns`);
    // HAND CONTROL BACK TO THE PARKED WALKER before returning. Not tidiness:
    // the runner's post-eval settle waits for terrain convergence, and an
    // observer warping around the planet at orbital speed streams chunks for
    // ever, so a probe that returns while aboard-and-warping hangs the RUNNER
    // (measured: every heartbeat printed, then no exit for 7 minutes).
    for (let i = 0; i < 8; ++i) { of.input.act(['warpDown'], 4); await sleep(0.1); }
    of.flight('sync');
    const left = of.flight('leave');
    log.push(`left the vessel on rails: ok ${left.ok}`);
    await sleep(1.0);
  }

  console.log('[daycycle] done');
  return { valid: true, pass: fails.length === 0, fails, log, day: day() };
})()
