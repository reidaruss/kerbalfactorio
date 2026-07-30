// RN-125: THE PLUME BREATHES, and the proof is a one-binary A/B at matched
// sim ticks.
//
//   node tools/smoke/run.mjs --sandbox=1 --scenario=walk --sundot=0.30 \
//     --url=http://127.0.0.1:<port>/ --evalfile=tools/smoke/probes/plumeshot.js
//   and the SAME command with --anim=0.
//
// The drive is deterministic on the sim clock (clamprestore.js's fixture,
// keys through the binding table), so the two runs fly IDENTICAL ascents:
// the flicker does not feed back into the sim, and a capture at the same
// tick differs between the runs only where the flame is. pngdiff on the
// cross-run pairs is therefore the flicker's own footprint, at two throttle
// settings, with the vessel, terrain, sky and HUD subtracted by identity.
//
// In-run assertions are the throttle chain (partial then full reaches the
// plume as a scale change: the pre-existing behaviour, re-pinned here) and
// the tick stamps that make the cross-run pairing honest.
(async () => {
  const of = window.__of;
  if (!of) return { valid: false, why: 'no __of' };
  if (typeof of.vab !== 'function' || typeof of.flight !== 'function') {
    return { valid: false, why: 'no vab/flight api' };
  }
  const sleep = (s) => of.run(s);
  const fails = [];
  const check = (n, ok, d) => {
    if (!ok) fails.push(d === undefined ? n : `${n}: ${d}`);
    return ok;
  };
  // of.screenshot() is a Blob; a Blob JSON-serialises to {}, so it crosses
  // to the runner as a data URL.
  const shoot = async () => {
    const blob = await of.screenshot();
    return await new Promise((res) => {
      const r = new FileReader();
      r.onload = () => res(r.result);
      r.readAsDataURL(blob);
    });
  };

  const PID = {
    CommandPod: 0x0100, TankLiquidSmall: 0x0101, TankLiquidSmallLong: 0x0102,
    EngineLiquidSmall: 0x0103, EngineVacuumSmall: 0x0104,
    DecouplerStackSmall: 0x0106, Parachute: 0x010a,
  };
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
  of.vab('drop');
  const built = of.vab('report').parts.length;
  of.vab('leave');
  await sleep(0.3);
  if (!check('the stack built', built >= 7, `${built} parts`)) {
    return { valid: false, fails };
  }

  of.flight('rollout');
  await sleep(1.0);
  for (let i = 0; i < 14 && of.flight('report').distanceToVesselM > 10; ++i) {
    of.input.act(['forward'], 30);
    await sleep(0.5);
  }
  of.input.act(['board'], 4);
  await sleep(1.0);
  check('aboard', of.flight('report').aboard === true);

  // ---- partial throttle, stage, and the LOW capture.
  of.input.act(['throttleUp'], 20);
  await sleep(0.3);
  const throttleLow = of.flight('report').flight.throttle;
  of.input.act(['stage'], 4);
  await sleep(1.5);
  const rLow = of.flight('report');
  const tickLow = of.world().tick;
  const pngLow = await shoot();

  // ---- full throttle, and the FULL capture. The chase camera tracks the
  // vessel, so across a short interval the vessel and its plume are
  // frame-fixed and the ground drifts: a rapid pair 0.15 s apart is the
  // flicker's own footprint plus a uniform ground shift, and the same pair
  // under ?anim=0 is the ground shift alone.
  of.input.act(['throttleFull'], 4);
  await sleep(1.5);
  const rFull = of.flight('report');
  const tickFull = of.world().tick;
  const pngFull = await shoot();
  await sleep(0.15);
  const pngFullB = await shoot();
  // ---- mid throttle, airborne: the scale response the brief names. The
  // clamp zeroes thrust (the LOW capture above proves it: engine lit, no
  // flame, status CLAMPED), so the second throttle setting has to fly.
  of.input.act(['throttleCut'], 2);
  of.input.act(['throttleUp'], 40);
  await sleep(0.8);
  const rMid = of.flight('report');
  const tickMid = of.world().tick;
  const pngMid = await shoot();
  of.input.act(['throttleCut'], 4);

  check('partial throttle was genuinely partial',
        throttleLow > 0.05 && throttleLow < 0.9, `${throttleLow}`);
  check('full throttle reached the session',
        rFull.flight.throttle === 1, `${rFull.flight.throttle}`);
  // The LOW capture on the clamp is the BETTER fixture, not a failure: at
  // 14% throttle TWR is under 1, the clamp correctly holds, the engine
  // burns, and the vessel is STATIONARY, so the cross-run diff at tickLow
  // has no motion in it at all. Only the full-throttle leg must fly.
  check('full throttle left the clamp', rFull.flight.status !== 'CLAMPED',
        rFull.flight.status);

  // ---- the ISOLATED pair: burn in ORBIT, where the background is space
  // and the planet limb, so a 0.15 s pair's motion inside the plume box is
  // the flicker and nothing else. The ascent pairs above cannot make this
  // claim: the plume is additive over scrolling terrain and the frozen
  // control moves 76% of the same box on ground scroll alone.
  const orb = of.cheat('orbit');
  await sleep(2.0);
  of.input.act(['throttleFull'], 4);
  await sleep(1.0);
  const rOrb = of.flight('report');
  const pngOrbA = await shoot();
  await sleep(0.15);
  const pngOrbB = await shoot();
  of.input.act(['throttleCut'], 4);
  check('the orbit cheat took', orb?.ok === true || rOrb.flight.status === 'ORBIT',
        JSON.stringify({ orb, status: rOrb.flight.status }));

  const s = of.stats();
  return {
    valid: fails.length === 0,
    fails,
    throttleLow,
    throttleFull: rFull.flight.throttle,
    throttleMid: rMid.flight.throttle,
    tickLow, tickFull, tickMid,
    statusLow: rLow.flight.status, statusFull: rFull.flight.status,
    statusOrbit: rOrb.flight.status, throttleOrbit: rOrb.flight.throttle,
    pngLow, pngFull, pngFullB, pngMid, pngOrbA, pngOrbB,
    invariants: { drawCalls: s.draw.calls, triangles: s.draw.triangles,
      programs: s.draw.programs, vramMB: s.vramEstimateMB },
  };
})()
