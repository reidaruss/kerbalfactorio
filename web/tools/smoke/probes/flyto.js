// flyto.js: fly to a NAMED PHASE and stop there (lane G, W11).
//
// Driven by tools/smoke/reload.mjs, which reloads the browser at the cut and
// compares what comes back. Also useful on its own with run.mjs when a
// screenshot of one particular moment is wanted:
//
//   node tools/smoke/run.mjs --url=http://127.0.0.1:5211/ --sandbox=1 --settle=8 \
//     --evalfile=tools/smoke/probes/flyto.js --evalargs='{"phase":"staging"}' \
//     --out=docs/screenshots/W11-staging.png
//
// PHASES: pad (clamped, aboard) | ascent (~20 km under power) | staging (the
// instant after separation) | orbit (circularised) | ground (arrested again).
//
// DW-20: it returns `reached`, and `reached` is set from the MEASURED state at
// the cut, never from the fact that the loop finished. A run that fell short
// says so instead of reporting the phase it was asked for.
(async () => {
  const of = window.__of;
  if (!of) return { valid: false, why: 'no __of' };
  if (typeof of.flight !== 'function' || typeof of.vab !== 'function') {
    return { valid: false, why: 'no flight or vab' };
  }
  const WANT = (typeof OF_ARGS === 'object' && OF_ARGS && OF_ARGS.phase) || 'orbit';
  const ORDER = ['pad', 'ascent', 'staging', 'orbit', 'ground'];
  if (ORDER.indexOf(WANT) < 0) return { valid: false, why: `unknown phase ${WANT}` };
  const sleep = (n) => of.run(n);
  const F = () => of.flight('report');
  const FL = () => F().flight;
  const log = [];
  let reached = 'none';

  const PID = {
    CommandPod: 0x0100, TankLiquidSmall: 0x0101, TankLiquidSmallLong: 0x0102,
    EngineLiquidSmall: 0x0103, EngineVacuumSmall: 0x0104,
    DecouplerStackSmall: 0x0106, Parachute: 0x010a, Fin: 0x010b,
  };
  const state = () => {
    const r = F(); const s = r.flight; const w = of.world(); const g = of.game();
    return {
      reached, aboard: r.aboard, live: s.live, status: s.status,
      parts: s.parts, metS: s.metS,
      altAglM: s.altitudeAglM, altDatumM: s.altitudeDatumM,
      apoapsisM: s.apoapsisM, periapsisM: s.periapsisM, bound: s.bound,
      remainingDvMS: s.remainingDvMS, stagings: s.stagings,
      observerMode: w.observer.mode, regime: w.regime,
      lat: w.observer.latDeg, lon: w.observer.lonDeg, worldAltM: w.altM,
      buildings: g.factory ? g.factory.buildings : -1,
      saves: g.persist ? g.persist.saves : -1,
      saveInhibit: g.persist ? (g.persist.saveInhibit ?? null) : null,
      navballWarning: r.navball ? (r.navball.warning ?? null) : null,
      // The RENDER side of the phase, so "is the engine drawing a flame" is a
      // number in the same row as "is the engine burning". They are computed by
      // different files and this is the only place they meet.
      view: r.view, nextStage: s.nextStage, throttle: s.throttle,
      thrustN: s.thrustN,
      message: r.message, log,
    };
  };

  // --- the fixture, same stack ascent.js flies -------------------------------
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
  const sym = document.querySelector('[data-vab="sym"][data-n="4"]');
  if (sym) sym.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await sleep(0.1);
  of.vab('frame'); of.vab('take', idxOf(PID.Fin));
  await sleep(0.1);
  {
    const parts = of.vab('report').parts;
    const tank = parts.find((p) => p.partId === PID.TankLiquidSmallLong);
    const rad = of.vab('nodes').filter((n) => n.kind === 'radial' && n.onScreen
      && (tank === undefined || n.parent === tank.handle));
    if (rad.length > 0) { of.vab('hover', rad[0].ndc[0], rad[0].ndc[1]); of.vab('place'); await sleep(0.2); }
  }
  of.vab('drop');
  const vr = of.vab('report');
  if (vr.parts.length !== 11) return { valid: false, why: `fixture ${vr.parts.length} parts` };
  of.vab('leave');
  await sleep(0.3);

  // --- a factory on the ground, so a reload has something to restore ---------
  const toLatLon = (q) => {
    const rr = Math.hypot(q[0], q[1], q[2]);
    return [(Math.asin(q[1] / rr) * 180) / Math.PI,
            (Math.atan2(q[2], q[0]) * 180) / Math.PI];
  };
  const patches = (of.game().ore && of.game().ore.list) || [];
  const richest = patches.reduce((a, b) => (a === null || b.grade > a.grade ? b : a), null);
  if (richest !== null) {
    const [plat, plon] = toLatLon(richest.centre);
    of.teleport(plat, plon, 2);
    await sleep(0.8);
  }
  const ghostAt = async (y, p) => { of.look(y, p); await sleep(0.04); return of.build().ghost; };
  const baseYaw = of.world().observer.yawDeg;
  of.build(1);
  let pick = null;
  for (const turn of [0, 90, 180, 270]) {
    for (let pitch = -10; pitch >= -60; pitch -= 0.8) {
      const g = await ghostAt(baseYaw + turn, pitch);
      if (g === null || !g.ok || g.patch < 0) continue;
      if (pick === null || g.ratePerSec > pick.rate) pick = { yaw: baseYaw + turn, pitch, rate: g.ratePerSec };
    }
  }
  if (pick !== null) {
    await ghostAt(pick.yaw, pick.pitch);
    of.input.tape([{ hold: 1, actions: ['use'] }, { hold: 5, keys: [] }]);
    await sleep(0.3);
    of.build(3);
    for (let d = 1.6, done = false; d <= 6.4 && !done; d += 0.8) {
      const g = await ghostAt(pick.yaw, pick.pitch + d);
      if (g === null || !g.ok) continue;
      const b0 = of.game().factory.buildings;
      of.input.tape([{ hold: 1, actions: ['use'] }, { hold: 5, keys: [] }]);
      await sleep(0.3);
      done = of.game().factory.buildings > b0;
    }
    of.build(0);
  }
  log.push(`factory: ${of.game().factory.buildings} buildings`);

  // --- PAD ------------------------------------------------------------------
  of.input.act(['board'], 4);
  await sleep(0.4);
  for (let i = 0; i < 14 && F().distanceToVesselM > 10; ++i) {
    of.input.act(['forward'], 30); await sleep(0.6);
  }
  of.input.act(['board'], 4);
  await sleep(0.35);
  if (F().aboard !== true) return { valid: false, why: 'never boarded', s: state() };
  reached = 'pad';
  // 25 sim seconds on the pad: longer than the 20 second autosave cadence, so
  // whatever the save does about a rolled-out vessel has definitely happened
  // before the cut rather than being a race.
  await sleep(25);
  if (WANT === 'pad') return { valid: true, ...state() };

  // --- ASCENT ---------------------------------------------------------------
  of.input.act(['throttleFull'], 4);
  await sleep(0.4);
  of.input.act(['stage'], 6);
  await sleep(1.0);
  if (FL().status === 'CLAMPED') return { valid: false, why: 'clamp never released', s: state() };
  const TARGET_APO_M = 80000;
  let coasting = false;
  let stagedSeen = false;
  let warped = false;
  for (let i = 0; i < 900 && !coasting; ++i) {
    const s = FL();
    const rd = of.flight('readout');
    if (WANT === 'ascent' && s.altitudeDatumM > 20000) { reached = 'ascent'; break; }
    if (s.thrustN <= 0 && s.throttle > 0.5 && !stagedSeen && s.nextStage >= 0
        && s.liftedOff === true && s.metS > 10) {
      of.input.act(['stage'], 6);
      await sleep(0.25);
      stagedSeen = true;
      if (WANT === 'staging') { reached = 'staging'; break; }
    }
    // ONE notch, LATCHED. Pressing warpUp on every pass of this loop ratchets
    // the ladder to its top, and at 10x (the in-air cap) the stick is sampled
    // once per block, so this hand pilot stops being able to fly the ribbon: it
    // pitched over late, held a near-radial climb, and came down on e = 1 with
    // 2315 m/s still aboard. Nothing was broken except the pilot's sampling
    // rate, which is exactly what PH-26 says warp costs.
    if (!warped && s.altitudeDatumM > 30000) { of.input.act(['warpUp'], 4); warped = true; }
    if (s.altitudeAglM > 2000 && s.bound && s.apoapsisM >= TARGET_APO_M) {
      of.input.act(['throttleCut'], 4); await sleep(0.2);
      of.input.act(['sasMode'], 4); await sleep(0.2);
      coasting = true; break;
    }
    const err = rd.guidance === null ? 0 : rd.guidance.pitchDeg - rd.pitchDeg;
    const frames = Math.max(1, Math.min(9, Math.round(Math.abs(err) * 3)));
    if (err < -0.7) of.input.act(['pitchDown'], frames);
    else if (err > 0.7) of.input.act(['pitchUp'], frames);
    await sleep(0.22);
    if (s.status === 'DOWN') break;
  }
  if (WANT === 'ascent' || WANT === 'staging') {
    if (reached !== WANT) reached = FL().liftedOff ? 'ascent' : 'pad';
    return { valid: true, ...state() };
  }

  // --- ORBIT ----------------------------------------------------------------
  const MU = 3.5316e12, R0 = 600000;
  of.input.act(['warpUp'], 4); await sleep(0.15);
  of.input.act(['warpUp'], 4); await sleep(0.15);
  let burning = false, eccMin = 1e9;
  for (let i = 0; i < 900; ++i) {
    const s = FL();
    if (!burning) {
      const rNow = R0 + s.altitudeDatumM;
      const vr = s.verticalMS;
      const vh = Math.sqrt(Math.max(0, s.speedMS * s.speedMS - vr * vr));
      const aRad = MU / (rNow * rNow) - (vh * vh) / rNow;
      const tToApo = vr > 0 && aRad > 0 ? vr / aRad : 1e9;
      const rApo = R0 + s.apoapsisM, rPeri = R0 + s.periapsisM;
      const a = 0.5 * (rApo + rPeri);
      const vApo = Math.sqrt(Math.max(0, MU * (2 / rApo - 1 / a)));
      const dvNeed = Math.sqrt(MU / rApo) - vApo;
      let burnS = (s.massKg / 16.9953) * (1 - Math.exp(-dvNeed / (360 * 9.80665)));
      if (!Number.isFinite(burnS) || burnS <= 0) burnS = 40;
      if (s.inSpace && s.bound && tToApo <= 0.5 * burnS) {
        of.input.act(['warpDown'], 4); await sleep(0.15);
        of.input.act(['warpDown'], 4); await sleep(0.15);
        of.input.act(['throttleFull'], 4); await sleep(0.25);
        burning = true;
      }
    } else {
      if (s.eccentricity < eccMin) eccMin = s.eccentricity;
      else if (s.eccentricity > eccMin + 1e-6 && eccMin < 0.30) {
        of.input.act(['throttleCut'], 4); await sleep(0.25); break;
      }
      if (s.remainingDvMS <= 1) break;
    }
    await sleep(0.25);
    if (FL().status === 'DOWN') break;
  }
  await sleep(1);
  {
    const s = FL();
    if (s.bound && s.periapsisM > 60000) reached = 'orbit';
    log.push(`orbit ${(s.apoapsisM / 1000).toFixed(1)} x ${(s.periapsisM / 1000).toFixed(1)} km, e ${s.eccentricity}`);
  }
  // 25 more sim seconds so the autosave definitely fires WHILE in orbit.
  await sleep(25);
  if (WANT === 'orbit') return { valid: true, ...state() };

  // --- GROUND ---------------------------------------------------------------
  of.input.act(['sasMode'], 4); await sleep(0.3);
  of.input.act(['throttleFull'], 4); await sleep(6);
  of.input.act(['throttleCut'], 4); await sleep(0.3);
  of.input.act(['warpUp'], 4); await sleep(0.15);
  of.input.act(['warpUp'], 4); await sleep(0.15);
  for (let i = 0; i < 900 && FL().status !== 'DOWN'; ++i) {
    if (FL().altitudeDatumM < 70000 && FL().warp > 4) {
      of.input.act(['warpDown'], 4); await sleep(0.12);
    }
    await sleep(0.4);
  }
  if (FL().status === 'DOWN') {
    reached = 'ground';
    of.input.act(['board'], 4);
    await sleep(0.6);
  }
  await sleep(25);
  return { valid: true, ...state() };
})()
