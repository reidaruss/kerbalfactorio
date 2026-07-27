// ascent.js: THE FLIGHT ACCEPTANCE (W9, DW-29 / DW-30).
//
// Build a rocket, walk to it, get in, launch it, stage it, reach a stable orbit,
// and prove the factory was still producing on the ground the whole time.
//
// Run it from web/, against the probe server (5199, no hot reload, restart it
// after any src edit):
//
//   npx vite --config vite.probe.config.ts
//   node tools/smoke/run.mjs --url=http://127.0.0.1:5199/ --sandbox=1 --settle=6 \
//        --evalfile=tools/smoke/probes/ascent.js --out=docs/screenshots/W9-orbit.png
//
// NOTE THE FLAG POSITION. `--sandbox=1` is a RUNNER flag. A query string written
// into --url is DISCARDED by run.mjs without a word.
//
// WHY IT IS SHAPED THIS WAY.
//
// (1) DW-20, and the second half of it is not boilerplate here. An ascent probe
//     that never actually left the pad would report a beautiful flat trajectory:
//     zero speed, a perfectly circular "orbit" of radius zero, no max q and no
//     drag, and every number would look calm. So section 0 proves the setup and
//     section 5 proves LIFTOFF with a measured altitude change before any orbit
//     number is believed.
//
// (2) THE PILOT IS IN THIS FILE, and it flies with KEYS. DW-29 makes reaching
//     orbit a manual skill and autopilot a research unlock, so there is no
//     autopilot to call. Everything below goes through `__of.input.act(...)`,
//     which drives the same binding table a human's keyboard does. `__of.flight`
//     has no setter that could put a vessel in an orbit it did not fly to.
//
// (3) At least one input is asserted through a REAL DOM EVENT. Driving an input
//     ACTION never generates one, and that once hid a completely inert left
//     mouse button through twenty green probes (probes/realclick.js).
//
// (4) The orbit is checked against /core's OWN reference. core/tests/test_flight
//     .cpp flies the same vehicle from the pad to 86,852 x 75,511 m with 1200 m/s
//     left. A materially different orbit from the same vehicle means the CLIENT
//     is wrong, not the core. The pilot here is not that pilot, so the orbit is
//     asserted against the SHAPE of that result (both apses above the 60 km
//     atmosphere ceiling, delta-v left over) and the difference is REPORTED.
//
// `--evalargs='{"shot":1}'` stops the run IN ORBIT instead of deorbiting, so
// run.mjs's own end-of-run capture is the orbit view with the navball on it.
// The assertions up to that point are identical; only the round trip is skipped,
// and the return says so rather than reporting a pass it did not earn.
(async () => {
  const of = window.__of;
  const SHOT = typeof OF_ARGS === 'object' && OF_ARGS !== null && OF_ARGS.shot === 1;
  if (!of) return { valid: false, why: 'no __of' };
  if (typeof of.flight !== 'function') return { valid: false, why: 'no __of.flight' };
  if (typeof of.vab !== 'function') return { valid: false, why: 'no __of.vab' };

  const sleep = (n) => of.run(n);
  const fails = [];
  const log = [];
  const check = (name, ok, detail) => {
    if (!ok) fails.push(detail === undefined ? name : `${name}: ${detail}`);
    return ok;
  };

  const F = () => of.flight('report');
  const FL = () => F().flight;
  const CT = () => of.flight('counters');

  // The reference vehicle "Ascender I", by PartId, in the order test_vessel.cpp
  // builds it. /core pins 1857.79 + 3065.12 = 4922.91 m/s and 9845 kg.
  const PID = {
    CommandPod: 0x0100, TankLiquidSmall: 0x0101, TankLiquidSmallLong: 0x0102,
    EngineLiquidSmall: 0x0103, EngineVacuumSmall: 0x0104,
    DecouplerStackSmall: 0x0106, Parachute: 0x010a, Fin: 0x010b,
  };
  const CORE = {
    totalDV: 4922.91, massKg: 9845, padTwr: 1.6567,
    apoAltM: 86852, periAltM: 75511, maxQPa: 27300, dvLeftMS: 1200,
    atmosphereCeilingM: 60000,
  };

  // ==========================================================================
  // 0. SETUP PROOF. Nothing below is believed until this passes.
  // ==========================================================================
  const w0 = of.world();
  const gm = of.game().mode;
  const modeName = typeof gm === 'string' ? gm : (gm && gm.mode);
  check('running in sandbox (the full catalogue is needed to build the fixture)',
        modeName === 'sandbox', JSON.stringify(gm));
  check('the loop is ticking', w0.tick > 0, `tick ${w0.tick}`);
  const f0 = F();
  check('the flight lane loaded its meshes', f0.loaded === true);
  check('the part catalogue crossed the bridge', f0.catalogue === 24,
        `${f0.catalogue}`);
  check('no vessel exists yet', f0.flight.live === false);
  check('nobody is aboard yet', f0.aboard === false);
  const c0 = CT();
  check('the factory counters are readable', typeof c0.coreTicks === 'number',
        JSON.stringify(c0));
  if (fails.length > 0) return { valid: false, why: 'setup', fails };

  // ==========================================================================
  // 1. BUILD "Ascender I" IN THE BAY, through the panel, one part at a time.
  // ==========================================================================
  of.vab('enter');
  await sleep(0.3);
  const cat = of.vab('catalogue');
  const indexOfPart = (id) => {
    const row = cat.find((c) => c.id === id);
    return row === undefined ? -1 : row.index;
  };
  const stack = [
    PID.CommandPod, PID.Parachute, PID.TankLiquidSmall, PID.EngineVacuumSmall,
    PID.DecouplerStackSmall, PID.TankLiquidSmallLong, PID.EngineLiquidSmall,
  ];
  of.vab('press', 'clear');
  await sleep(0.15);
  for (const pid of stack) {
    const idx = indexOfPart(pid);
    if (idx < 0) { log.push(`part ${pid.toString(16)} not offered`); continue; }
    of.vab('frame');
    of.vab('take', idx);
    await sleep(0.1);
    const before = of.vab('report').parts.length;
    if (before === 0) { of.vab('place'); } else {
      const parts = of.vab('report').parts;
      let low = parts[0];
      for (const p of parts) if (p.origin[1] < low.origin[1]) low = p;
      const nodes = of.vab('nodes').filter((n) => n.parent === low.handle
        && n.onScreen && (n.kind === 'bottom' || n.kind === 'interstage'));
      if (nodes.length === 0) { log.push(`no node under ${low.handle}`); continue; }
      of.vab('hover', nodes[0].ndc[0], nodes[0].ndc[1]);
      of.vab('place');
    }
    await sleep(0.12);
  }
  // Four fins in one press. They are what make the airframe statically stable,
  // so this is not decoration: without them the static margin is +3.188 m.
  const symBtn = document.querySelector('[data-vab="sym"][data-n="4"]');
  if (symBtn) symBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await sleep(0.1);
  of.vab('frame');
  of.vab('take', indexOfPart(PID.Fin));
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
  const vr = of.vab('report');
  check('the reference vehicle assembled', vr.parts.length === 11,
        `${vr.parts.length} parts`);
  check('its delta-v is /core\'s own number', vr.stats !== undefined
        && Math.abs(vr.stats.totalDeltaV - CORE.totalDV) <= 0.01,
        `${vr.stats && vr.stats.totalDeltaV}`);
  check('and its pad mass is', vr.stats !== undefined
        && Math.abs(vr.stats.massKg - CORE.massKg) <= 0.5, `${vr.stats && vr.stats.massKg}`);
  check('and it is statically STABLE (the fins are doing work)',
        vr.stats !== undefined && vr.stats.stable === true,
        `margin ${vr.stats && vr.stats.staticMarginM}`);
  of.vab('leave');
  await sleep(0.3);

  // ==========================================================================
  // 1b. BUILD A FACTORY THAT ACTUALLY RUNS, before leaving the ground.
  //
  // Without this the production assertion in section 10 is unfalsifiable: an
  // empty world ticks its automation network happily and mines nothing, so
  // "production advanced" would be comparing 0 to 0 forever. DW-20's second
  // half is exactly this, and it is the reason a drill goes down here.
  //
  // A drill ALONE is not enough either. An unbelted drill fills a 50-unit output
  // buffer and stops (AutoLine.placeMinerForNode), which is about 17 seconds of
  // mining against a 600 second flight, so the counter would freeze before the
  // rocket cleared the atmosphere and the test would pass for the wrong reason.
  // A SMELTER within touching distance is wired to it automatically
  // (FactoryWiring.wire), drains the buffer and has no output cap of its own, so
  // the line runs for as long as the patch lasts.
  // ==========================================================================
  // Stand ON the richest patch first. The clearing scatters four of them 30 to
  // 60 m from the spawn and the build reach is 9 m, so a sweep from where the
  // player happens to wake up refuses on every sample and truthfully says "there
  // is no ore" thirty-two times. Same teleport probes/digore.js uses.
  const toLatLon = (q) => {
    const rr = Math.hypot(q[0], q[1], q[2]);
    return [(Math.asin(q[1] / rr) * 180) / Math.PI,
            (Math.atan2(q[2], q[0]) * 180) / Math.PI];
  };
  const patches = (of.game().ore && of.game().ore.list) || [];
  const richest = patches.reduce((a, b) => (a === null || b.grade > a.grade ? b : a), null);
  check('the world scattered ore patches to stand on', richest !== null,
        `${patches.length} patches`);
  if (richest !== null) {
    const [plat, plon] = toLatLon(richest.centre);
    of.teleport(plat, plon, 2);
    await sleep(0.8);
  }
  const ghostAt = async (y, p) => { of.look(y, p); await sleep(0.04); return of.build().ghost; };
  const baseYaw = of.world().observer.yawDeg;
  of.build(1);                                  // hotbar slot 3: the drill
  let drillPick = null;
  for (const turn of [0, 90, 180, 270]) {
    for (let pitch = -10; pitch >= -60; pitch -= 0.8) {
      const g = await ghostAt(baseYaw + turn, pitch);
      if (g === null || !g.ok || g.patch < 0) continue;
      if (drillPick === null || g.ratePerSec > drillPick.rate) {
        drillPick = { yaw: baseYaw + turn, pitch, rate: g.ratePerSec };
      }
    }
  }
  check('a drillable ore patch is in reach of the spawn', drillPick !== null,
        JSON.stringify(of.game().ore && of.game().ore.patches));
  let smelterDown = false;
  if (drillPick !== null) {
    await ghostAt(drillPick.yaw, drillPick.pitch);
    of.input.tape([{ hold: 1, actions: ['use'] }, { hold: 5, keys: [] }]);
    await sleep(0.3);
    // The smelter goes DOWN-SLOPE of the drill by a couple of degrees of aim,
    // which lands it inside `wire`'s touch radius so /core creates the inserter.
    of.build(3);                                // hotbar slot 5: the smelter
    // The placement is read back from the ABSOLUTE count after a longer settle,
    // not from a per-iteration delta after 0.3 s. The base-building lane's
    // commit path is not this lane's to reason about and it has moved twice
    // tonight; a probe that decides "the smelter did not go down" from a
    // three-tenths-of-a-second window is measuring the commit latency of
    // somebody else's file rather than the thing it came here to assert.
    const beforeSmelter = of.game().factory.buildings;
    for (let d = 1.6; d <= 6.4 && !smelterDown; d += 0.8) {
      const g = await ghostAt(drillPick.yaw, drillPick.pitch + d);
      if (g === null || !g.ok) continue;
      of.input.tape([{ hold: 1, actions: ['use'] }, { hold: 5, keys: [] }]);
      await sleep(0.6);
      smelterDown = of.game().factory.buildings > beforeSmelter;
    }
    of.build(0);                                 // bare hand again
  }
  const built = of.game().factory;
  check('the drill went down on the ore', built.buildings >= 1,
        `${built.buildings} buildings`);
  check('a second machine went down next to it', smelterDown === true,
        `smelter ${smelterDown}, ${built.buildings} buildings`);
  // The WIRE is reported separately from the PLACEMENT because they fail for
  // different reasons and in different lanes. Without a link the drill fills its
  // 50-unit output buffer in about 17 seconds and stops, so section 10's
  // production claim becomes "it mined for the first 3% of the flight", which is
  // true and is not the claim. Named rather than folded in, so a red line here
  // points at `FactoryWiring` and not at the rocket.
  check('and /core WIRED them, so the drill never saturates mid-flight',
        built.links.length > 0, `links ${built.links.length}`);
  // PROVE IT RUNS before trusting it later. 6 seconds of sim on the ground.
  const cPre = CT();
  await sleep(6);
  const cPost = CT();
  check('the line is producing on the ground before anybody leaves',
        cPost.minedFromNodes > cPre.minedFromNodes,
        `${cPre.minedFromNodes} -> ${cPost.minedFromNodes}`);
  log.push(`factory before flight: ${built.buildings} buildings, ${built.links.length} links, ` +
           `mined ${cPre.minedFromNodes.toFixed(2)} -> ${cPost.minedFromNodes.toFixed(2)} in 6 s`);

  // ==========================================================================
  // 2. ROLL OUT, then WALK to it. The vessel is planted beyond boarding range
  //    on purpose, so "walk to a vessel and take control" is measured and not
  //    assumed.
  // ==========================================================================
  of.input.act(['board'], 4);
  await sleep(0.35);
  let r = F();
  check('a vessel rolled out', r.rollouts === 1 && r.flight.live === true,
        JSON.stringify({ rollouts: r.rollouts, live: r.flight.live }));
  check('it is HELD BY THE CLAMP, not falling', r.flight.status === 'CLAMPED',
        r.flight.status);
  check('the whole vehicle came across', r.flight.parts === 11, `${r.flight.parts}`);
  const padDist = r.distanceToVesselM;
  check('and it was planted OUT of boarding range', padDist > r.boardRangeM,
        `${padDist} m vs range ${r.boardRangeM}`);

  // Boarding from here must REFUSE and say how far. The negative control that
  // proves the range gate is real rather than decorative.
  const refusalsBefore = F().refusals;
  of.input.act(['board'], 4);
  await sleep(0.2);
  r = F();
  check('boarding out of range refuses', r.refusals === refusalsBefore + 1
        && r.boardings === 0, `refusals ${r.refusals}, boardings ${r.boardings}`);
  check('and the refusal says how far', /\d+ m away/.test(r.message), r.message);
  check('and it did NOT quietly roll out a second rocket', r.rollouts === 1,
        `${r.rollouts}`);

  // Aim at the rocket and walk. The heading came from the player's own yaw when
  // the pad was placed, so straight ahead is right.
  for (let i = 0; i < 14 && F().distanceToVesselM > 10; ++i) {
    of.input.act(['forward'], 30);
    await sleep(0.6);
  }
  r = F();
  const walkedTo = r.distanceToVesselM;
  check('the player WALKED to the rocket', walkedTo < r.boardRangeM,
        `${walkedTo} m after walking from ${padDist} m`);
  log.push(`walk: ${padDist.toFixed(1)} m -> ${walkedTo.toFixed(1)} m`);

  // ==========================================================================
  // 3. BOARD. One input on this path goes through a REAL DOM KEYBOARD EVENT,
  //    because an action tape never generates one and an inert key would
  //    otherwise pass every check in this file.
  // ==========================================================================
  const codeFor = (action) => (of.input.bindings()[action] || [])[0];
  const realKey = (action, ms) => new Promise((res) => {
    const code = codeFor(action);
    window.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true }));
    setTimeout(() => {
      window.dispatchEvent(new KeyboardEvent('keyup', { code, bubbles: true }));
      res(code);
    }, ms);
  });
  const boardCode = await realKey('board', 60);
  await sleep(0.3);
  r = F();
  check('a REAL keyboard event boarded the vessel', r.aboard === true
        && r.boardings === 1, `code ${boardCode}, aboard ${r.aboard}`);
  check('the navball came up', r.navball.visible === true);
  check('the eye changed hands', of.world().observer.mode === 'FLIGHT',
        of.world().observer.mode);

  // ==========================================================================
  // 4. THE CLAMP IS REAL. Full throttle alone must NOT release it, because no
  //    engine is lit yet, and the readout must say so.
  // ==========================================================================
  of.input.act(['throttleFull'], 4);
  await sleep(0.4);
  r = F();
  check('throttle went to 100%', Math.abs(r.flight.throttle - 1) < 1e-6,
        `${r.flight.throttle}`);
  check('but the clamp still holds an unlit rocket',
        r.flight.status === 'CLAMPED' && r.flight.thrustN === 0,
        `${r.flight.status}, thrust ${r.flight.thrustN} N`);

  // ==========================================================================
  // 5. LAUNCH. Stage 0 lights the first engine, which releases the clamp.
  //    LIFTOFF IS MEASURED, not inferred.
  // ==========================================================================
  const aglOnPad = FL().altitudeAglM;
  const padAltDatumM = FL().altitudeDatumM;
  // PH-28. A rocket standing on the pad is at ZERO altitude above the ground.
  // It read 19.20 m for the whole of W9, exactly twice its own base offset,
  // and nothing here caught it because every altitude assertion in this file
  // is RELATIVE to `aglOnPad`. An absolute one costs a line.
  check('the rocket on the pad is at zero AGL', Math.abs(aglOnPad) < 0.5,
        `${aglOnPad} m`);
  const countersAtLaunch = CT();
  of.input.act(['stage'], 6);
  await sleep(0.6);
  r = F();
  check('the engine lit', r.flight.thrustN > 1e5, `${r.flight.thrustN} N`);
  // /core's fixture pins 1.6567 AT THE DATUM. The pad here is on real terrain
  // roughly 3 km up, where the thinner air already lapses the engine UP, so the
  // number must be a little higher and the check is a band, not an equality.
  // A pad TWR that matched 1.6567 exactly would mean the atmosphere was not
  // being consulted at all.
  check('pad TWR is the fixture value lapsed for the pad altitude',
        r.flight.twr > CORE.padTwr && r.flight.twr < CORE.padTwr + 0.35,
        `${r.flight.twr} against ${CORE.padTwr} at the datum`);
  check('the clamp released', r.flight.status !== 'CLAMPED', r.flight.status);
  await sleep(3);
  r = F();
  const aglAfter = FL().altitudeAglM;
  check('IT LEFT THE GROUND', r.flight.liftedOff === true
        && aglAfter > aglOnPad + 5,
        `agl ${aglOnPad.toFixed(2)} -> ${aglAfter.toFixed(2)} m`);
  check('and it is going up', r.flight.verticalMS > 1,
        `${r.flight.verticalMS} m/s`);
  log.push(`liftoff: agl ${aglOnPad.toFixed(2)} -> ${aglAfter.toFixed(2)} m, ` +
           `v ${r.flight.verticalMS.toFixed(1)} m/s`);

  // ==========================================================================
  // 6. THE ASCENT. A hand pilot flying the DW-30 item 6 guidance ribbon with
  //    the pitch keys, staging when the first stage runs dry, and cutting when
  //    the apoapsis reaches the target. Nothing here is an autopilot call.
  // ==========================================================================
  const TARGET_APO_M = 80000;
  const trace = [];
  let stagedAt = -1, cutoffAt = -1, cutoffSpeed = 0;
  let coasting = false;
  let warpSet = false;

  for (let i = 0; i < 900 && !coasting; ++i) {
    const s = FL();
    const rd = of.flight('readout');
    // Warp only once the air is thin enough that control latency is cheap.
    if (!warpSet && s.altitudeDatumM > 30000) { of.input.act(['warpUp'], 4); warpSet = true; }

    // STAGE when the burning stage is dry: thrust falls to zero with the
    // throttle still open. That is exactly the condition the /core acceptance
    // ascent stages on, expressed in what a pilot can actually see.
    if (s.thrustN <= 0 && s.throttle > 0.5 && stagedAt < 0 && s.nextStage >= 0
        && s.liftedOff === true && s.metS > 10) {
      of.input.act(['stage'], 6);
      await sleep(0.25);
      stagedAt = s.metS;
    }

    // CUT when the apoapsis has been raised to the target, then hold prograde.
    // The guard is ALTITUDE ABOVE THE PAD, not above the datum: the shipped
    // spawn is on terrain about 3 km up, so a datum guard is already satisfied
    // while the rocket is still bolted to the clamp.
    if (s.altitudeAglM > 2000 && s.bound && s.apoapsisM >= TARGET_APO_M) {
      of.input.act(['throttleCut'], 4);
      await sleep(0.2);
      of.input.act(['sasMode'], 4);   // CMD -> PRO, the mode a coast wants
      await sleep(0.2);
      cutoffAt = s.metS;
      cutoffSpeed = s.speedMS;
      coasting = true;
      break;
    }

    // FLY THE RIBBON: put the nose on the marker, which is two keys because the
    // controls move in the same horizon frame the ball draws in. The press is
    // PROPORTIONAL to the error, because a fixed-length press on a 20 deg/s slew
    // overshoots by more than the error it was correcting and the ascent hunts.
    const err = rd.guidance === null ? 0 : rd.guidance.pitchDeg - rd.pitchDeg;
    const frames = Math.max(1, Math.min(9, Math.round(Math.abs(err) * 3)));
    if (err < -0.7) of.input.act(['pitchDown'], frames);
    else if (err > 0.7) of.input.act(['pitchUp'], frames);
    await sleep(0.22);
    if ((i & 15) === 0) {
      trace.push({ t: Math.round(s.metS), alt: Math.round(s.altitudeDatumM),
                   v: Math.round(s.speedMS), q: Math.round(s.qPa),
                   apo: Math.round(s.apoapsisM), bound: s.bound,
                   pitch: Math.round(rd.pitchDeg), hdg: Math.round(rd.headingDeg) });
    }
    if (s.status === 'DOWN') break;
  }

  r = F();
  check('the first stage separated', r.flight.stagings >= 2 && stagedAt > 0,
        `stagings ${r.flight.stagings}, at ${stagedAt} s`);
  check('and the discarded stage is GONE from the vehicle', r.flight.parts < 11,
        `${r.flight.parts} parts left of 11`);
  check('the engine was cut at the target apoapsis', coasting === true
        && cutoffAt > 0, `cutoff ${cutoffAt} s`);
  // MAX Q IS ASSERTED AGAINST THE AIR THIS PAD IS ACTUALLY IN, not against a
  // fixed window. /core's fixture launches from the DATUM and peaks at 27.3
  // kPa; the shipped spawn is on real terrain several km up, and q scales with
  // the density the vehicle flies through, rho = rho0 * exp(-h/H) with
  // H = 5600 m (PH-10, D-006). The window this line used to be was sized to one
  // terrain build and the TERRAIN LANE then moved the ground under it: the pad
  // rose about 1.2 km, max q fell from 17.8 to 14.4 kPa, and a perfectly
  // healthy ascent went red. A ratio against the measured pad altitude still
  // catches the thing the check is FOR (drag that is not being computed, or an
  // atmosphere that is not being consulted) and does not care where the pad is.
  const qExpect = CORE.maxQPa * Math.exp(-padAltDatumM / 5600);
  check('max q is /core\'s 27.3 kPa lapsed for the pad altitude',
        r.flight.maxQPa > qExpect * 0.55 && r.flight.maxQPa < qExpect * 1.9,
        `${(r.flight.maxQPa / 1000).toFixed(1)} kPa against ${(qExpect / 1000).toFixed(1)} `
        + `expected from a pad ${Math.round(padAltDatumM)} m up`);
  log.push(`ascent: staged ${stagedAt.toFixed(1)} s, cutoff ${cutoffAt.toFixed(1)} s ` +
           `at ${cutoffSpeed.toFixed(0)} m/s, max q ${(r.flight.maxQPa / 1000).toFixed(1)} kPa`);

  // ==========================================================================
  // 7. CIRCULARISE. Coast to apoapsis and burn prograde, LEADING the apoapsis
  //    by half the burn, then cut at the minimum of eccentricity. Both of those
  //    are recorded defects of the first attempt in core/tests/test_flight.cpp
  //    (R6): burning AT apoapsis raises the far side, and waiting for periapsis
  //    to catch apoapsis is a test that can never fire.
  // ==========================================================================
  const MU = 3.5316e12;          // DW-18. Forge's one gravity authority.
  const R0 = 600000;
  of.input.act(['warpUp'], 4); await sleep(0.15);
  of.input.act(['warpUp'], 4); await sleep(0.15);
  let burning = false, eccMin = 1e9, circStart = -1, burnEstS = 0;
  for (let i = 0; i < 900; ++i) {
    const s0 = FL();
    if (!burning) {
      // TIME TO APOAPSIS from the vertical speed against the radial
      // acceleration, and BURN LENGTH from the rocket equation. Both are the
      // core acceptance test's own formulae and both are there because the
      // obvious version is wrong (physics.md R6): dv*m/F is 15% long on this
      // burn because it ignores the mass thrown away, and a long estimate
      // starts the burn early, which raises the apoapsis instead of the
      // periapsis.
      const rNow = R0 + s0.altitudeDatumM;
      const vr = s0.verticalMS;
      const vh = Math.sqrt(Math.max(0, s0.speedMS * s0.speedMS - vr * vr));
      const aRad = MU / (rNow * rNow) - (vh * vh) / rNow;
      const tToApo = vr > 0 && aRad > 0 ? vr / aRad : 1e9;
      const rApo = R0 + s0.apoapsisM;
      const rPeri = R0 + s0.periapsisM;
      const a = 0.5 * (rApo + rPeri);
      const vApo = Math.sqrt(Math.max(0, MU * (2 / rApo - 1 / a)));
      const dvNeed = Math.sqrt(MU / rApo) - vApo;
      // The upper stage's own authored figures: EngineVacuumSmall is 16.9953
      // kg/s at Isp_vac 360 s, so the exhaust velocity is 360 * 9.80665 m/s.
      // Both are vessel.h's (physics.md 5.1), not numbers invented here.
      const mdot = 16.9953;
      const ve = 360 * 9.80665;
      burnEstS = (s0.massKg / mdot) * (1 - Math.exp(-dvNeed / ve));
      if (!Number.isFinite(burnEstS) || burnEstS <= 0) burnEstS = 40;
      if (s0.inSpace && s0.bound && tToApo <= 0.5 * burnEstS) {
        of.input.act(['warpDown'], 4); await sleep(0.15);
        of.input.act(['warpDown'], 4); await sleep(0.15);
        of.input.act(['throttleFull'], 4);
        await sleep(0.25);
        burning = true;
        circStart = s0.metS;
      }
    } else {
      // CUT AT THE MINIMUM OF ECCENTRICITY, never when the periapsis catches the
      // apoapsis: the instant the orbit passes through circular the two labels
      // SWAP, so that test can never fire again and the vehicle burns its upper
      // stage dry onto a hyperbola. Also physics.md R6, found the hard way in
      // /core's own test.
      if (s0.eccentricity < eccMin) eccMin = s0.eccentricity;
      else if (s0.eccentricity > eccMin + 1e-6 && eccMin < 0.30) {
        of.input.act(['throttleCut'], 4);
        await sleep(0.25);
        break;
      }
      if (s0.remainingDvMS <= 1) break;
    }
    await sleep(0.25);
    if (FL().status === 'DOWN') break;
  }
  log.push(`circularise: started ${circStart.toFixed(0)} s, burn estimate ` +
           `${burnEstS.toFixed(1)} s, min e ${eccMin.toFixed(5)}`);

  // ==========================================================================
  // 8. THE ORBIT. Both apses above the 60 km atmosphere ceiling, so it is a
  //    STABLE orbit and not a decaying one.
  // ==========================================================================
  await sleep(1);
  r = F();
  const s = r.flight;
  check('the trajectory is a closed conic', s.bound === true);
  check('APOAPSIS is above the atmosphere', s.apoapsisM > CORE.atmosphereCeilingM,
        `${(s.apoapsisM / 1000).toFixed(1)} km`);
  check('PERIAPSIS is above the atmosphere, so the orbit does not decay',
        s.periapsisM > CORE.atmosphereCeilingM, `${(s.periapsisM / 1000).toFixed(1)} km`);
  check('there is delta-v LEFT (running dry strands you, DW-30)',
        s.remainingDvMS > 0, `${s.remainingDvMS} m/s`);
  check('and /core agrees nothing is acting on it any more (on rails)',
        s.onRails === true && s.inSpace === true,
        `onRails ${s.onRails}, inSpace ${s.inSpace}`);
  log.push(`orbit: ${(s.apoapsisM / 1000).toFixed(1)} x ${(s.periapsisM / 1000).toFixed(1)} km, ` +
           `e ${s.eccentricity}, period ${s.periodS} s, ${s.remainingDvMS} m/s left, ` +
           `${s.propellantKg} kg propellant`);
  log.push(`core reference: ${(CORE.apoAltM / 1000).toFixed(1)} x ` +
           `${(CORE.periAltM / 1000).toFixed(1)} km with ${CORE.dvLeftMS} m/s left`);

  // ==========================================================================
  // 9. THE NEAR-TO-FAR HANDOFF, and the planet drawn from orbit.
  // ==========================================================================
  const w = of.world();
  check('the eye really is up there', w.altM > 60000, `${Math.round(w.altM)} m`);
  // THE HANDOFF ITSELF, which is the thing that matters and is not the band
  // name. `Regime` calls anything under 100 km ASCENT, so an 80 km orbit is
  // legitimately not in the ORBIT band; what has to be true is that the 1:1
  // near scene has emptied and the planet is being drawn scaled. Asserting the
  // label instead of the effect would have made a working handoff read as a
  // failure, and a broken one at 120 km read as a pass.
  check('the regime left the surface band', w.regime !== 'SURFACE', w.regime);
  check('THE NEAR-TO-FAR HANDOFF: the 1:1 scene emptied', w.chunks.near === 0,
        `${w.chunks.near} near chunks`);
  check('and the planet is resident in the FAR scaled scene', w.chunks.far > 40,
        `${w.chunks.far} far chunks`);
  await of.settle(6);
  const hash = of.framehash();
  check('the planet is actually DRAWN from up here', hash.litPct > 8,
        `${hash.litPct}% of pixels lit`);
  const st = of.stats();
  log.push(`from orbit: ${st.draw.calls} draw calls, ${st.draw.triangles} tris, ` +
           `frame p50 ${st.frameMs.p50.toFixed(2)} ms / p95 ${st.frameMs.p95.toFixed(2)} ms, ` +
           `lit ${hash.litPct}%, near ${w.chunks.near} far ${w.chunks.far}`);

  // ==========================================================================
  // 10. THE FACTORY KEPT RUNNING. This is the moment the two halves of the game
  //     become one game, so it is measured rather than assumed.
  // ==========================================================================
  const c1 = CT();
  check('the automation network ticked while the player was in orbit',
        c1.coreTicks > countersAtLaunch.coreTicks,
        `${countersAtLaunch.coreTicks} -> ${c1.coreTicks}`);
  check('and PRODUCTION advanced: ore was drilled out of the ground below',
        c1.minedFromNodes > countersAtLaunch.minedFromNodes,
        `${countersAtLaunch.minedFromNodes} -> ${c1.minedFromNodes}`);
  log.push(`factory: coreTicks ${countersAtLaunch.coreTicks} -> ${c1.coreTicks}, ` +
           `mined ${countersAtLaunch.minedFromNodes} -> ${c1.minedFromNodes}, ` +
           `ingots ${countersAtLaunch.ingots} -> ${c1.ingots}`);

  if (SHOT) {
    // Frame the vessel against the limb and let the streamer settle, so the
    // capture is reproducible rather than caught mid-dissolve.
    // Looking slightly DOWN at the vessel puts the planet behind it instead of
    // black sky, which is the difference between a screenshot of a rocket and a
    // screenshot of a HUD.
    of.flight('camera', { yaw: 2.35, pitch: 0.30 });
    await of.settle(8);
    return {
      valid: true, pass: fails.length === 0, mode: 'shot', fails, log,
      vesselView: F().view, camera: of.flight('camera'),
      orbit: { apoapsisM: s.apoapsisM, periapsisM: s.periapsisM,
               eccentricity: s.eccentricity, periodS: s.periodS,
               remainingDvMS: s.remainingDvMS },
      navball: of.flight('navball'),
      render: { calls: st.draw.calls, triangles: st.draw.triangles,
                p50: st.frameMs.p50, p95: st.frameMs.p95, litPct: hash.litPct },
      factory: { atLaunch: countersAtLaunch, inOrbit: c1 },
      roundTrip: 'SKIPPED: --evalargs shot stops in orbit for the capture',
    };
  }

  // ==========================================================================
  // 11. THE ROUND TRIP. Getting out in orbit is refused; the world is still
  //     coherent; and handing the eye back to the walker works.
  // ==========================================================================
  const beforeOut = F().refusals;
  of.input.act(['board'], 4);
  await sleep(0.3);
  r = F();
  check('you cannot climb out in orbit', r.aboard === true
        && r.refusals === beforeOut + 1, `aboard ${r.aboard}, refusals ${r.refusals}`);

  // Deorbit: turn retrograde and burn the reserve away, then ride it down.
  of.input.act(['sasMode'], 4); await sleep(0.3);   // PRO -> RET
  const sasAfter = FL().sas;
  of.input.act(['throttleFull'], 4);
  await sleep(6);
  of.input.act(['throttleCut'], 4);
  await sleep(0.3);
  const afterDeorbit = FL();
  log.push(`deorbit burn: sas ${sasAfter}, peri ${(afterDeorbit.periapsisM / 1000).toFixed(1)} km`);

  of.input.act(['warpUp'], 4); await sleep(0.15);
  of.input.act(['warpUp'], 4); await sleep(0.15);
  for (let i = 0; i < 600 && FL().status !== 'DOWN'; ++i) {
    if (FL().altitudeDatumM < 55000 && FL().warp > 10) {
      of.input.act(['warpDown'], 4); await sleep(0.15);
      of.input.act(['warpDown'], 4); await sleep(0.15);
    }
    await sleep(0.4);
  }
  const down = FL();
  const cameDown = down.status === 'DOWN';
  log.push(`descent: status ${down.status}, agl ${down.altitudeAglM.toFixed(1)} m, ` +
           `peak was ${(down.peakAltM / 1000).toFixed(1)} km`);
  if (cameDown) {
    of.input.act(['board'], 4);
    await sleep(0.5);
    r = F();
    check('and the player got back OUT', r.aboard === false && r.disembarks === 1,
          `aboard ${r.aboard}, disembarks ${r.disembarks}`);
    check('the eye came back to the walker',
          of.world().observer.mode !== 'FLIGHT', of.world().observer.mode);
    check('the world is still coherent: the factory is still producing',
          CT().coreTicks > c1.coreTicks, `${c1.coreTicks} -> ${CT().coreTicks}`);
  } else {
    log.push('NOT ASSERTED: the vehicle did not reach the ground inside the ' +
             'probe budget, so the disembark half of the round trip is untested here');
  }

  const finalCounters = CT();
  return {
    valid: true,
    pass: fails.length === 0,
    fails,
    log,
    orbit: {
      apoapsisM: s.apoapsisM, periapsisM: s.periapsisM,
      eccentricity: s.eccentricity, periodS: s.periodS,
      remainingDvMS: s.remainingDvMS, propellantKg: s.propellantKg,
      maxQPa: s.maxQPa, peakAltM: s.peakAltM,
    },
    coreReference: CORE,
    factory: { atLaunch: countersAtLaunch, inOrbit: c1, atEnd: finalCounters },
    render: { calls: st.draw.calls, triangles: st.draw.triangles,
              p50: st.frameMs.p50, p95: st.frameMs.p95, litPct: hash.litPct,
              holePixels: hash.holePixels, band: w.regime,
              nearChunks: w.chunks.near, farChunks: w.chunks.far },
    flight: F(),
    trace,
  };
})()
