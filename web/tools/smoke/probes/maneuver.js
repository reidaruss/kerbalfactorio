// maneuver.js: THE MAP AND THE MANEUVER NODE (W12).
//
// Fly the reference rocket to orbit exactly as `probes/ascent.js` does, then
// open the map ON M, prove it is LIVE rather than merely present, plan a burn
// with it, and prove the node reaches the navball the pilot actually flies by.
//
// Run it from web/, against a server that will not hot-reload under it:
//
//   npx vite preview --outDir dist-ph --port 4183 --strictPort
//   node tools/smoke/run.mjs --url=http://localhost:4183/ --sandbox=1 \
//        --settle=6 --evalfile=tools/smoke/probes/maneuver.js
//
// NOTE THE FLAG POSITION. `--sandbox=1` is a RUNNER flag. A query string
// written into --url is DISCARDED by run.mjs without a word.
//
// WHY IT IS SHAPED THIS WAY.
//
// (1) DW-20, twice over. Sections 0 to 5 are ascent.js's own setup proof, and
//     they are not boilerplate: every assertion below section 6 is about a map
//     of an ORBIT, and a map drawn around a rocket that never left the pad
//     would report a beautifully consistent picture of nothing. Nothing about
//     the map is believed until the vehicle is measured into a closed orbit
//     with both apses above the atmosphere. The same rule applies inside each
//     section: a key press is only trusted once a PRESS COUNTER moved.
//
// (2) THE "PRESENT BUT NEVER FED" DISCRIMINATOR IS THE WHOLE POINT OF SECTION
//     6. `MapView.report().drawn` is taken INSIDE drawMap, so a panel that is
//     open and painting nothing is distinguishable from a live one. This lane
//     exists partly because a published, clamped, correct VesselObserver.look()
//     had no caller for a whole milestone, so "it is mounted" is not evidence.
//
// (3) EVERY INPUT IS DRIVEN. The map opens on the `map` ACTION, the node's
//     handles are nudged by clicking the REAL <button>, hold-node is the
//     `sasNode` key, and the camera is moved by a real DOM pointermove and a
//     real DOM wheel event. `__of.map(...)` is used only where an exact
//     numeric delta is needed that no button offers, and even then it goes
//     through the same `MapHooks` the buttons call.
//
// (4) ROW PER CASE (probes/flightabuse.js). Every case records BEFORE and
//     AFTER and the run reports the whole table, so one run says which of the
//     six sections is broken rather than stopping at the first red line.
//
// (5) Standing rule 11 everywhere: the PROPERTY, never a threshold tuned until
//     it passed. The feasibility case is the clearest example, and it is
//     deliberately tested one metre per second either side of the vehicle's
//     own remaining delta-v, because a node asked for a million metres per
//     second would be refused by a comparison that is broken in every
//     direction.
(async () => {
  const of = window.__of;
  if (!of) return { valid: false, why: 'no __of' };
  for (const k of ['flight', 'vab', 'map', 'modals']) {
    if (typeof of[k] !== 'function') return { valid: false, why: `no __of.${k}` };
  }

  const sleep = (n) => of.run(n);
  const fails = [];
  const log = [];
  const rows = [];
  const check = (name, ok, detail) => {
    if (ok !== true) fails.push(detail === undefined ? name : `${name}: ${detail}`);
    return ok === true;
  };
  /** One case. BEFORE and AFTER are recorded whatever the verdict, so a red
   *  line says what moved instead of only that something did not. */
  const rec = (name, before, after, ok, note) => {
    const row = { name, before, after, ok: ok === true, note: note ?? '' };
    rows.push(row);
    check(name, ok === true,
          `${JSON.stringify(before)} -> ${JSON.stringify(after)}`
          + (note === undefined || note === '' ? '' : ` (${note})`));
    return row.ok;
  };

  const F = () => of.flight('report');
  const FL = () => F().flight;
  const MAP = () => of.map();
  const CAM = () => of.flight('camera');
  const NB = () => of.flight('navball');
  const near = (a, b, eps) => Number.isFinite(a) && Number.isFinite(b)
    && Math.abs(a - b) <= eps;
  const unitLen = (v) => (Array.isArray(v) && v.length === 3
    ? Math.hypot(v[0], v[1], v[2]) : NaN);

  // --- the panel's own DOM, read rather than inferred -------------------------
  // "Is the player being told" is answered by the pixels, never by the
  // intention. It is also the only place `shortfallMS` and `timeToNodeS` are
  // published at all: MapMode.report()'s `plan` block carries neither.
  const readoutRow = (label) => {
    const el = document.querySelector('#of-map .readout');
    if (el === null) return null;
    for (const r of el.querySelectorAll('.row')) {
      // `em, span` because the label element is one or the other depending on
      // how recently MapView's markup was brought into line with map.css, and a
      // probe that reads the panel should not care which.
      const k = r.querySelector('em, span');
      if (k !== null && (k.textContent ?? '').trim() === label) {
        return ((r.querySelector('b') ?? {}).textContent ?? '').trim();
      }
    }
    return null;
  };
  const clickBtn = (sel) => {
    const b = document.querySelector(sel);
    if (b === null) return false;
    b.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    return true;
  };
  /** MapView.clock, copied so the DOM string can be checked against a number
   *  this file holds rather than against another string the panel produced. */
  const clock = (s) => {
    if (!Number.isFinite(s)) return '--:--';
    const negv = s < 0;
    const t = Math.floor(Math.abs(s));
    const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), sec = t % 60;
    const two = (n) => (n < 10 ? `0${n}` : `${n}`);
    const body = h > 0 ? `${h}:${two(m)}:${two(sec)}` : `${two(m)}:${two(sec)}`;
    return negv ? `-${body}` : body;
  };
  const toast = () => {
    const t = document.getElementById('of-toast');
    return t === null ? { text: null, shown: false }
      : { text: t.textContent, shown: t.classList.contains('show') };
  };

  // The reference vehicle "Ascender I", by PartId, in the order test_vessel.cpp
  // builds it. /core pins 1857.79 + 3065.12 = 4922.91 m/s and 9845 kg.
  const PID = {
    CommandPod: 0x0100, TankLiquidSmall: 0x0101, TankLiquidSmallLong: 0x0102,
    EngineLiquidSmall: 0x0103, EngineVacuumSmall: 0x0104,
    DecouplerStackSmall: 0x0106, Parachute: 0x010a, Fin: 0x010b,
  };
  const CORE = {
    totalDV: 4922.91, massKg: 9845, padTwr: 1.6567,
    apoAltM: 86852, periAltM: 75511, dvLeftMS: 1200,
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
  const m0 = MAP();
  check('the MAP EXISTS at all (a null map is not a closed map)',
        m0 !== null && typeof m0 === 'object' && m0.error === undefined,
        JSON.stringify(m0));
  check('and it starts closed', m0 !== null && m0.open === false,
        JSON.stringify(m0 && m0.open));
  check('the map registered itself as a MODAL, so Escape reaches it (GP-25)',
        (of.modals().modals ?? []).some((m) => m.name === 'map'),
        JSON.stringify(of.modals()));
  if (fails.length > 0) return { valid: false, why: 'setup', fails, rows };

  // ==========================================================================
  // 1. THE MAP OFF THE VESSEL OPENS, CENTRED ON THE PLAYER (section B).
  //
  // THIS SECTION USED TO ASSERT THE OPPOSITE and was right to, until DW-36.
  // B1/B2 read "the map key OFF THE VESSEL does not open the map" and "it SAYS
  // SO on the HUD", because the map shipped as the FLIGHT map. DW-36 reverses
  // that deliberately - "M opens it centred on the player" is the first thing
  // it asks for - so the old rows were testing a behaviour that was removed on
  // purpose. They are replaced rather than deleted, and by a STRONGER claim:
  // the same keystroke must now open the map AND the projection must prove it
  // is centred on the player rather than on the body.
  //
  // B3 IS R17'S OWN NEGATIVE CONTROL and is the reason this belongs in the
  // acceptance probe rather than only in probes/discovery.js. The centring bug
  // R17 named is invisible in every count: a body-centred projection and a
  // player-centred one draw the same conic, the same apsides and the same
  // scale bar, and differ ONLY in the origin. |centreM| separates them with no
  // ambiguity - it is ~0 for the body and one body radius for a player standing
  // on the ground - so it is the one number that can fail if the centring is
  // ever regressed back to the body.
  //
  // The refusal did NOT disappear, it MOVED, and B4 follows it: a node is a
  // burn and there is nothing to burn on foot, so `place` is where the honest
  // "board a vessel first" now lives. GP-54's lesson is unchanged - a control
  // that declines silently teaches the player the feature does not exist - it
  // simply applies to a different control now.
  // ==========================================================================
  const tB = toast();
  const beforeB = { open: MAP().open, opens: MAP().opens, toast: tB.text,
    aboard: F().aboard };
  of.input.act(['map'], 4);
  await sleep(0.25);
  const afterB = { open: MAP().open, opens: MAP().opens,
    focus: MAP().focus?.active, centreM: MAP().focus?.centreM };
  rec('B1 the map key OFF THE VESSEL now OPENS the map (DW-36)',
      beforeB, afterB,
      MAP().open === true && MAP().opens === beforeB.opens + 1);
  rec('B2 and it is centred on YOU, not on the body',
      { focus: null }, { focus: MAP().focus?.active },
      MAP().focus?.active === 'you',
      'focus switching and re-centring are one mechanism (R17)');
  const cM = MAP().focus?.centreM ?? [0, 0, 0];
  const cLen = Math.hypot(cM[0], cM[1], cM[2]);
  rec('B3 |centreM| is a BODY RADIUS, not zero: the projection origin moved',
      { bodyRadiusM: 600000, wouldBeZeroIfBodyCentred: 0 },
      { centreLenM: Math.round(cLen) },
      cLen > 500000 && cLen < 700000,
      'the one number that separates a player-centred projection from a '
      + 'body-centred one; every other instrument reads the same either way');
  // The refusal, at its new home.
  const tP = toast();
  of.map('place');
  await sleep(0.2);
  const tP2 = toast();
  rec('B4 a NODE still refuses on foot, out loud: the refusal moved, not gone',
      { toast: tP.text }, { toast: tP2.text, shown: tP2.shown },
      tP2.shown === true && /board|vessel/i.test(tP2.text ?? ''),
      'a node is a burn and there is nothing to burn on foot');
  // Leave the map shut again so section 2 starts where it always did.
  if (MAP().open === true) { of.input.act(['map'], 4); await sleep(0.2); }
  rec('B5 and M closes it again, so the mode is a toggle either way',
      { open: true }, { open: MAP().open }, MAP().open === false);

  // ==========================================================================
  // 2. BUILD "Ascender I" IN THE BAY, through the panel, one part at a time.
  //    Verbatim from probes/ascent.js, so the numbers below are comparable.
  // ==========================================================================
  of.vab('enter');
  await sleep(0.3);
  const cat = of.vab('catalogue');
  const indexOfPart = (id) => {
    const r = cat.find((c) => c.id === id);
    return r === undefined ? -1 : r.index;
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
        && Math.abs(vr.stats.massKg - CORE.massKg) <= 0.5,
        `${vr.stats && vr.stats.massKg}`);
  of.vab('leave');
  await sleep(0.3);
  if (fails.length > 0) return { valid: false, why: 'fixture', fails, rows, log };

  // ==========================================================================
  // 3. ROLL OUT, WALK, BOARD. One press goes through a REAL DOM KEYBOARD EVENT
  //    for the reason ascent.js states: an action tape never generates one, and
  //    an inert key would otherwise pass every check in this file.
  // ==========================================================================
  of.input.act(['board'], 4);
  await sleep(0.35);
  let r = F();
  check('a vessel rolled out', r.rollouts === 1 && r.flight.live === true,
        JSON.stringify({ rollouts: r.rollouts, live: r.flight.live }));
  check('it is HELD BY THE CLAMP, not falling', r.flight.status === 'CLAMPED',
        r.flight.status);
  const padDist = r.distanceToVesselM;
  for (let i = 0; i < 14 && F().distanceToVesselM > 10; ++i) {
    of.input.act(['forward'], 30);
    await sleep(0.6);
  }
  r = F();
  check('the player WALKED to the rocket', r.distanceToVesselM < r.boardRangeM,
        `${r.distanceToVesselM} m after walking from ${padDist} m`);

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

  // ==========================================================================
  // 4. LAUNCH AND ASCEND. The pilot is in this file and it flies with keys
  //    (DW-29: there is no autopilot to call).
  // ==========================================================================
  const aglOnPad = FL().altitudeAglM;
  check('the rocket on the pad is at zero AGL (PH-28)', Math.abs(aglOnPad) < 0.5,
        `${aglOnPad} m`);
  of.input.act(['throttleFull'], 4);
  await sleep(0.4);
  check('throttle went to 100%', Math.abs(FL().throttle - 1) < 1e-6,
        `${FL().throttle}`);
  check('but the clamp still holds an unlit rocket', FL().status === 'CLAMPED'
        && FL().thrustN === 0, `${FL().status}, thrust ${FL().thrustN} N`);
  of.input.act(['stage'], 6);
  await sleep(0.6);
  check('the engine lit', FL().thrustN > 1e5, `${FL().thrustN} N`);
  check('the clamp released', FL().status !== 'CLAMPED', FL().status);
  await sleep(3);
  const aglAfter = FL().altitudeAglM;
  check('IT LEFT THE GROUND', FL().liftedOff === true && aglAfter > aglOnPad + 5,
        `agl ${aglOnPad.toFixed(2)} -> ${aglAfter.toFixed(2)} m`);
  log.push(`liftoff: agl ${aglOnPad.toFixed(2)} -> ${aglAfter.toFixed(2)} m`);

  const TARGET_APO_M = 80000;
  let stagedAt = -1, cutoffAt = -1, coasting = false, warpSet = false;
  for (let i = 0; i < 900 && !coasting; ++i) {
    const s = FL();
    const rd = of.flight('readout');
    if (!warpSet && s.altitudeDatumM > 30000) { of.input.act(['warpUp'], 4); warpSet = true; }
    if (s.thrustN <= 0 && s.throttle > 0.5 && stagedAt < 0 && s.nextStage >= 0
        && s.liftedOff === true && s.metS > 10) {
      of.input.act(['stage'], 6);
      await sleep(0.25);
      stagedAt = s.metS;
    }
    if (s.altitudeAglM > 2000 && s.bound && s.apoapsisM >= TARGET_APO_M) {
      of.input.act(['throttleCut'], 4);
      await sleep(0.2);
      of.input.act(['sasMode'], 4);   // CMD -> PRO, the mode a coast wants
      await sleep(0.2);
      cutoffAt = s.metS;
      coasting = true;
      break;
    }
    const err = rd.guidance === null ? 0 : rd.guidance.pitchDeg - rd.pitchDeg;
    const frames = Math.max(1, Math.min(9, Math.round(Math.abs(err) * 3)));
    if (err < -0.7) of.input.act(['pitchDown'], frames);
    else if (err > 0.7) of.input.act(['pitchUp'], frames);
    await sleep(0.22);
    if (s.status === 'DOWN') break;
  }
  check('the first stage separated', FL().stagings >= 2 && stagedAt > 0,
        `stagings ${FL().stagings}, at ${stagedAt} s`);
  check('the engine was cut at the target apoapsis', coasting === true,
        `cutoff ${cutoffAt} s`);

  // ==========================================================================
  // 5. CIRCULARISE, and PROVE THE ORBIT. Everything from section 6 down is a
  //    claim about a map OF THIS ORBIT, so the orbit is measured first.
  // ==========================================================================
  const MU = 3.5316e12;          // DW-18. Forge's one gravity authority.
  const R0 = 600000;
  of.input.act(['warpUp'], 4); await sleep(0.15);
  of.input.act(['warpUp'], 4); await sleep(0.15);
  let burning = false, eccMin = 1e9;
  for (let i = 0; i < 900; ++i) {
    const s0 = FL();
    if (!burning) {
      const rNow = R0 + s0.altitudeDatumM;
      const vr2 = s0.verticalMS;
      const vh = Math.sqrt(Math.max(0, s0.speedMS * s0.speedMS - vr2 * vr2));
      const aRad = MU / (rNow * rNow) - (vh * vh) / rNow;
      const tToApo = vr2 > 0 && aRad > 0 ? vr2 / aRad : 1e9;
      const rApo = R0 + s0.apoapsisM;
      const rPeri = R0 + s0.periapsisM;
      const a = 0.5 * (rApo + rPeri);
      const vApo = Math.sqrt(Math.max(0, MU * (2 / rApo - 1 / a)));
      const dvNeed = Math.sqrt(MU / rApo) - vApo;
      let burnEstS = (s0.massKg / 16.9953) * (1 - Math.exp(-dvNeed / (360 * 9.80665)));
      if (!Number.isFinite(burnEstS) || burnEstS <= 0) burnEstS = 40;
      if (s0.inSpace && s0.bound && tToApo <= 0.5 * burnEstS) {
        of.input.act(['warpDown'], 4); await sleep(0.15);
        of.input.act(['warpDown'], 4); await sleep(0.15);
        of.input.act(['throttleFull'], 4);
        await sleep(0.25);
        burning = true;
      }
    } else {
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
  await sleep(1);
  const orb = FL();
  check('the trajectory is a closed conic', orb.bound === true);
  check('APOAPSIS is above the atmosphere', orb.apoapsisM > CORE.atmosphereCeilingM,
        `${(orb.apoapsisM / 1000).toFixed(1)} km`);
  check('PERIAPSIS is above the atmosphere, so the orbit does not decay',
        orb.periapsisM > CORE.atmosphereCeilingM,
        `${(orb.periapsisM / 1000).toFixed(1)} km`);
  check('there is delta-v LEFT to plan a burn with', orb.remainingDvMS > 50,
        `${orb.remainingDvMS} m/s`);
  check('and /core agrees nothing is acting on it any more (on rails)',
        orb.onRails === true && orb.inSpace === true,
        `onRails ${orb.onRails}, inSpace ${orb.inSpace}`);
  log.push(`orbit: ${(orb.apoapsisM / 1000).toFixed(1)} x `
    + `${(orb.periapsisM / 1000).toFixed(1)} km, e ${orb.eccentricity}, `
    + `${orb.remainingDvMS} m/s left (core reference `
    + `${(CORE.apoAltM / 1000).toFixed(1)} x ${(CORE.periAltM / 1000).toFixed(1)} km, `
    + `${CORE.dvLeftMS} m/s)`);
  if (fails.length > 0) {
    return { valid: false, why: 'never reached a stable orbit, so nothing the '
      + 'map says below could be checked', fails, rows, log, flight: FL() };
  }

  // ==========================================================================
  // 6. SECTION A: THE MAP IS REACHABLE AND LIVE.
  //
  // "Open" is the cheap half. The half that matters is `view.frames` and
  // `view.drawn`, both taken INSIDE the paint pass: a panel that is up and
  // never fed draws the same screenshot as a working one, and this project has
  // already shipped one fully built, fully unreachable feature.
  // ==========================================================================
  const a0 = MAP();
  of.input.act(['map'], 4);
  await sleep(0.4);
  const a1 = MAP();
  rec('A1 the map ACTION opens the map', { open: a0.open, opens: a0.opens },
      { open: a1.open, opens: a1.opens },
      a1.open === true && a1.opens === a0.opens + 1);
  if (a1.open !== true) {
    return { valid: false, why: 'the map never opened, so sections A to E have '
      + 'nothing to measure', fails, rows, log, map: a1 };
  }

  const framesA = a1.view.frames;
  await sleep(0.35);
  const a2 = MAP();
  rec('A2 IT IS PAINTING: the frame counter taken inside drawMap advances',
      { frames: framesA }, { frames: a2.view.frames },
      a2.view.frames > framesA,
      'a map that is open and never fed fails here and nowhere else');
  const drawn = a2.view.drawn;
  rec('A3 and the CURRENT conic is actually plotted',
      { currentPoints: a1.view.drawn.currentPoints },
      { currentPoints: drawn.currentPoints, pixelsPerMetre: drawn.pixelsPerMetre },
      drawn.currentPoints > 100 && drawn.pixelsPerMetre > 0);
  const marks = drawn.markers ?? [];
  rec('A4 the SHIP is on it', { markers: [] }, { markers: marks },
      marks.includes('ship'));
  rec('A5 and both APSIS markers of the live orbit are on it',
      { bound: orb.bound }, { markers: marks },
      marks.includes('ap') && marks.includes('pe'));
  rec('A6 and the projection refused NO points (MapDraw reports skipped:N)',
      { skipped: 0 }, { markers: marks },
      !marks.some((m) => String(m).startsWith('skipped:')));

  // THE CANVAS IS INSIDE THE PANEL, and this is a measurement rather than a
  // nicety. `map.css` insets the canvas with `position:absolute` into a
  // positioned `.view` box, so if the markup ever stops building that box the
  // canvas takes the whole viewport as its containing block and paints over the
  // readout it is meant to sit beside. Every other assertion in section A stays
  // green through that, because the painter is handed a size and paints
  // correctly at it: `currentPoints` and the markers are all still right. This
  // row is the only thing in the file that would notice, and it noticed once
  // already (the bundle this probe was written against was built four minutes
  // before MapView's markup was brought into line with the stylesheet).
  {
    const cv = document.querySelector('#of-map canvas.map-canvas');
    const fr = document.querySelector('#of-map .frame');
    const cr = cv === null ? null : cv.getBoundingClientRect();
    const pr = fr === null ? null : fr.getBoundingClientRect();
    const inside = cr !== null && pr !== null && cr.left >= pr.left - 1
      && cr.right <= pr.right + 1 && cr.top >= pr.top - 1
      && cr.bottom <= pr.bottom + 1;
    rec('A7 the map canvas is laid out INSIDE the map panel',
        pr === null ? null : { x: Math.round(pr.left), y: Math.round(pr.top),
          w: Math.round(pr.width), h: Math.round(pr.height) },
        cr === null ? null : { x: Math.round(cr.left), y: Math.round(cr.top),
          w: Math.round(cr.width), h: Math.round(cr.height) },
        inside, 'the canvas is position:absolute and needs a positioned .view '
        + 'box to be inset into');
  }

  // The map key is a TOGGLE, and Escape closes it through the derived modal
  // list rather than through a second handler (GP-25). Both are asserted,
  // because a panel with its own Escape handler works right up until somebody
  // adds a menu on top of it.
  const c0 = MAP();
  of.input.act(['map'], 4);
  await sleep(0.3);
  const c1 = MAP();
  rec('A8 the same key CLOSES it', { open: c0.open }, { open: c1.open },
      c1.open === false);
  const framesClosed = MAP().view.frames;
  await sleep(0.3);
  rec('A9 and a CLOSED map stops painting', { frames: framesClosed },
      { frames: MAP().view.frames }, MAP().view.frames === framesClosed);

  of.input.act(['map'], 4);
  await sleep(0.3);
  const e0 = { open: MAP().open, closedByEscape: of.modals().closedByEscape };
  of.input.act(['cancel'], 4);
  await sleep(0.3);
  const mo = of.modals();
  const e1 = { open: MAP().open, closedByEscape: mo.closedByEscape,
    lastEscape: (of.game().controls ?? {}).lastEscape };
  rec('A10 ESCAPE closes it too, through the ONE modal handler', e0, e1,
      e0.open === true && e1.open === false
      && e1.closedByEscape === e0.closedByEscape + 1);
  rec('A11 and the derived modal list NAMES it', { name: 'map' },
      { modals: (mo.modals ?? []).map((m) => m.name) },
      (mo.modals ?? []).some((m) => m.name === 'map'));

  // ==========================================================================
  // 7. SECTION C: FLIGHT CONTROLS SURVIVE INSIDE THE MAP, AND ON-FOOT VERBS
  //    DO NOT.
  //
  // MAP_ALLOWED is the whole claim: an inventory screen swallows the world, a
  // map over a live flight must not. The negative half is asserted in the same
  // breath, because "every key works" and "the right keys work" are different
  // statements and only the second one is the design.
  // ==========================================================================
  of.input.act(['map'], 4);
  await sleep(0.3);
  check('C0 the map is open for the control checks', MAP().open === true);

  const thr0 = { throttle: FL().throttle, cuts: CAM().presses.throttleCut ?? 0 };
  of.input.act(['throttleUp'], 24);
  await sleep(0.45);
  const thr1 = { throttle: FL().throttle, cuts: CAM().presses.throttleCut ?? 0 };
  rec('C1 THROTTLE still works from inside the map', thr0, thr1,
      thr1.throttle > thr0.throttle + 1e-6);
  of.input.act(['throttleCut'], 6);
  await sleep(0.4);
  const thr2 = { throttle: FL().throttle, cuts: CAM().presses.throttleCut ?? 0 };
  rec('C2 and so does the throttle CUT', thr1, thr2,
      Math.abs(thr2.throttle) < 1e-6 && thr2.cuts === thr1.cuts + 1,
      'FlightControls counts this one, so the press is proved to have ARRIVED '
      + 'and not merely to have coincided with a throttle that was already shut');

  const sas0 = { sas: FL().sas, presses: CAM().presses.sasRetrograde ?? 0 };
  of.input.act(['sasRetrograde'], 6);
  await sleep(0.4);
  const sas1 = { sas: FL().sas, presses: CAM().presses.sasRetrograde ?? 0 };
  rec('C3 a SAS MODE KEY (Digit3) still works from inside the map', sas0, sas1,
      sas1.sas === 'RET' && sas1.presses === sas0.presses + 1,
      'the press counter is the proof the key ARRIVED, not that the mode drifted');
  of.input.act(['sasPrograde'], 6);
  await sleep(0.4);
  rec('C4 and so does another one', sas1, { sas: FL().sas }, FL().sas === 'PRO');

  // THE NEGATIVE HALF, in two rows because the two verbs fail differently.
  //
  // `use` is Mouse0 and Mouse0 is nothing else, so it is dead twice over: muted
  // by the UI capture, and gated on `aboard` inside Systems. `level` is KeyQ,
  // which is ALSO `rollLeft`, and rollLeft is on MAP_ALLOWED. So the press does
  // arrive, and what has to be dead is the on-foot MEANING of it. Splitting
  // them is not pedantry: run together, "no counter moved" would be satisfied
  // just as well by a press that never happened at all, and the second row is
  // what rules that out.
  const foot = () => ({
    digs: of.voxels().action.digs, digMisses: of.voxels().action.misses,
    levels: of.terraform().action.levels, levelMisses: of.terraform().action.misses,
    latched: of.terraform().action.latched, placements: of.game().placements,
  });
  const dead0 = foot();
  of.input.act(['use'], 24);
  await sleep(0.5);
  const dead1 = foot();
  rec('C5 LEFT CLICK does not dig from inside the map', dead0, dead1,
      dead1.digs === dead0.digs && dead1.digMisses === dead0.digMisses
      && dead1.placements === dead0.placements,
      'a dig that MISSES still counts, so this counter would move on a press '
      + 'that arrived and hit nothing');
  // A CONTROL WINDOW FIRST: the same length of sim with no key held. Roll is
  // held by stability assist, so the bar the pressed window has to clear is the
  // MEASURED drift of a ship holding its attitude, not a number picked because
  // it made the row green. Standing rule 11 in its most literal form.
  const wrapDeg = (d) => ((((d + 180) % 360) + 360) % 360) - 180;
  const rollA = NB().rollDeg;
  await sleep(0.15);
  const rollB = NB().rollDeg;
  const drift = Math.abs(wrapDeg(rollB - rollA));
  const dead2 = foot();
  of.input.act(['level'], 60);
  await sleep(0.15);
  const roll1 = NB().rollDeg;
  const dead3 = foot();
  const rolled = Math.abs(wrapDeg(roll1 - rollB));
  rec('C6 the LEVEL key does not terraform from inside the map', dead2, dead3,
      dead3.levels === dead2.levels && dead3.levelMisses === dead2.levelMisses
      && dead3.latched === false);
  rec('C7 and the press DID arrive: in a rocket KeyQ is rollLeft, not the '
      + 'levelling tool',
      { rollDeg: rollB, driftWithNoKeyDeg: drift },
      { rollDeg: roll1, movedDeg: rolled },
      rolled > 20 * Math.max(drift, 0.01),
      'without this row C6 would be satisfied by a key press that never '
      + 'reached the client at all');
  rec('C8 and the map is still open after all of that', { open: true },
      { open: MAP().open, live: FL().live }, MAP().open === true && FL().live === true);

  // ==========================================================================
  // 8. SECTION D: THE NODE PUBLISHES WHAT IT MUST, AND AGREES WITH /core.
  // ==========================================================================
  const dvAvailable = FL().remainingDvMS;

  const n0 = MAP();
  const placedByButton = clickBtn('#of-map .readout button[data-act="place"]');
  await sleep(0.35);
  const n1 = MAP();
  rec('D1 the REAL "place node" button plants a node',
      { node: n0.node, buttonFound: placedByButton },
      { node: n1.node, plan: n1.plan },
      placedByButton === true && n1.node !== null && n1.plan !== null);
  if (n1.node === null || n1.plan === null) {
    return { valid: false, why: 'no node was planted, so section D and E have '
      + 'nothing to measure', fails, rows, log, map: n1 };
  }
  rec('D2 a fresh node costs NOTHING until a handle is moved',
      { deltaVMS: 0 },
      { deltaVMS: n1.plan.deltaVMS, pro: n1.node.pro, nrm: n1.node.nrm,
        rad: n1.node.rad },
      n1.plan.deltaVMS === 0 && n1.node.pro === 0 && n1.node.nrm === 0
      && n1.node.rad === 0);
  rec('D3 and it lands on the APOAPSIS, which is where a first burn belongs',
      { timeToApoapsisS: 'the live orbit\'s' },
      { tFromNowS: Math.round(n1.node.tFromNowS) },
      n1.node.tFromNowS > 0 && Number.isFinite(n1.node.tFromNowS));

  // ONE HANDLE, ONE REAL BUTTON. +10 m/s prograde is what the panel offers, so
  // it is what a player can actually ask for.
  const adjByButton = clickBtn('#of-map .readout button[data-axis="prograde"][data-delta="10"]');
  await sleep(0.35);
  const n2 = MAP();
  rec('D4 the REAL prograde "+" button buys exactly what it says',
      { deltaVMS: n1.plan.deltaVMS, buttonFound: adjByButton },
      { deltaVMS: n2.plan.deltaVMS, pro: n2.node.pro },
      adjByButton === true && near(n2.plan.deltaVMS, 10, 1e-9)
      && near(n2.node.pro, 10, 1e-9));
  rec('D5 a burn that costs delta-v takes TIME',
      { burnDurationS: n1.plan.burnDurationS },
      { burnDurationS: n2.plan.burnDurationS },
      n2.plan.burnDurationS > 0);

  // LIGHT IT EARLY: half the burn goes before the node. This is the one number
  // a player is most likely to miss and the one /core states as an identity
  // (maneuver.h: timeToBurnStartS = timeToNodeS - burn.leadS, leadS = half the
  // duration), so it is asserted as an identity and not as a range.
  //
  // `timeToNodeS` is NOT in MapMode.report()'s plan block, so the node's own
  // `tFromNowS` stands in for it, and the substitution is PROVED rather than
  // assumed: the panel prints clock(timeToNodeS) in its "node in" row, and
  // that string is checked against clock(tFromNowS) below.
  const tNode = n2.node.tFromNowS;
  const expectStart = tNode - n2.plan.burnDurationS / 2;
  rec('D6 "light it in" is the node time MINUS half the burn, exactly',
      { timeToNodeS: tNode, burnDurationS: n2.plan.burnDurationS,
        expected: expectStart },
      { timeToBurnStartS: n2.plan.timeToBurnStartS },
      near(n2.plan.timeToBurnStartS, expectStart, 1e-6));
  const nodeInRow = readoutRow('node in');
  rec('D7 and the PANEL prints that same node time, so tFromNowS is timeToNodeS',
      { expected: clock(tNode) }, { 'node in': nodeInRow },
      nodeInRow === clock(tNode));

  // WHAT A PROGRADE BURN DOES TO THE ORBIT, stated so that it is true whatever
  // orbit the hand-flown ascent happened to reach.
  //
  // The obvious wording, "the apoapsis goes up", is WRONG here and the first
  // draft of this file shipped it: `place()` puts the node ON the apoapsis, and
  // adding speed there raises the OPPOSITE side. The other obvious wording,
  // "the apoapsis is unchanged and the periapsis rises", is right only while
  // the burn stays under the circularisation deficit at that point, and it went
  // red on the second run of this probe because that run reached a rounder
  // orbit where 10 m/s carried past it and the two labels SWAPPED. That is
  // physics, not a defect, so the assertions below are the two things that hold
  // in both regimes and are exact in both:
  //
  //   the burn point keeps the radius it had, so it is still one of the two
  //   apsides; and the SUM of the apsides, which is 2a, goes up.
  //
  // Both are measured against the SAME plan one handle-click earlier rather
  // than against the live report, so the only difference between the numbers is
  // the burn, to within the fraction of a second the two reads are apart.
  const sumBefore = n1.plan.apoapsisAltM + n1.plan.periapsisAltM;
  const sumAfter = n2.plan.apoapsisAltM + n2.plan.periapsisAltM;
  const stayPut = Math.min(
    Math.abs(n2.plan.apoapsisAltM - n1.plan.apoapsisAltM),
    Math.abs(n2.plan.periapsisAltM - n1.plan.apoapsisAltM));
  rec('D8 the plan agrees with the live orbit before any handle is moved',
      { apoapsisM: FL().apoapsisM, periapsisM: FL().periapsisM },
      { apoapsisAltM: n1.plan.apoapsisAltM, periapsisAltM: n1.plan.periapsisAltM },
      near(n1.plan.apoapsisAltM, FL().apoapsisM, 5)
      && near(n1.plan.periapsisAltM, FL().periapsisM, 5));
  rec('D8b a 10 m/s PROGRADE burn RAISES THE ORBIT: 2a goes up by kilometres',
      { apsisSumM: Math.round(sumBefore) },
      { apsisSumM: Math.round(sumAfter), raisedM: Math.round(sumAfter - sumBefore) },
      sumAfter - sumBefore > 1000,
      'the rocket equation puts this at about 12 km for 10 m/s at this radius, '
      + 'so a kilometre is a floor and not a fitted threshold');
  rec('D8c and the BURN POINT keeps its radius, so it is still an apsis',
      { apoapsisAltM: Math.round(n1.plan.apoapsisAltM) },
      { apoapsisAltM: Math.round(n2.plan.apoapsisAltM),
        periapsisAltM: Math.round(n2.plan.periapsisAltM),
        nearestApsisMissM: stayPut },
      stayPut < 1,
      'whichever of the two it is now called, one of them is where the burn '
      + 'happened, to the metre');
  // And the case that unambiguously RAISES THE APOAPSIS: enough prograde to
  // carry the burn point well past circular speed, so the far side of the new
  // orbit is somewhere genuinely new whatever the starting eccentricity was.
  // The deficit to circular at this radius is about 20 m/s on the eccentricity
  // this ascent arrives with and less on a rounder one, so 100 m/s clears it
  // by five times over and the margin asserted is 10 km, not metres.
  const big = await (async () => {
    of.map('adjust', { axis: 'prograde', delta: 90 });
    await sleep(0.35);
    return MAP();
  })();
  rec('D8d a burn PAST circular speed there moves the apoapsis instead',
      { deltaVMS: n2.plan.deltaVMS,
        apoapsisAltM: Math.round(n2.plan.apoapsisAltM) },
      { deltaVMS: big.plan.deltaVMS,
        apoapsisAltM: Math.round(big.plan.apoapsisAltM) },
      near(big.plan.deltaVMS, 100, 1e-9)
      && big.plan.apoapsisAltM > n2.plan.apoapsisAltM + 10000);
  of.map('adjust', { axis: 'prograde', delta: -90 });
  await sleep(0.35);
  rec('D8e and taking it back off restores the 10 m/s plan',
      { deltaVMS: big.plan.deltaVMS },
      { deltaVMS: MAP().plan.deltaVMS,
        apoapsisAltM: Math.round(MAP().plan.apoapsisAltM) },
      near(MAP().plan.deltaVMS, 10, 1e-9),
      'ONLY the delta-v is compared across this gap. The node is anchored to a '
      + 'moving "now" (see D17), so the seconds between these two reads slide '
      + 'its POSITION along the orbit and take the apsides with it: an equality '
      + 'on those would be asserting the absence of a defect this file reports '
      + 'in its own row');

  rec('D9 the burn DIRECTION is a unit vector', { length: 1 },
      { burnDirection: n2.plan.burnDirection,
        length: unitLen(n2.plan.burnDirection) },
      near(unitLen(n2.plan.burnDirection), 1, 1e-9));
  rec('D10 and the PLANNED conic is drawn as well as the current one',
      { plannedPoints: a2.view.drawn.plannedPoints },
      { plannedPoints: n2.view.drawn.plannedPoints,
        currentPoints: n2.view.drawn.currentPoints },
      n2.view.drawn.plannedPoints > 100);
  rec('D11 and the node glyph is on the picture',
      { markers: marks }, { markers: n2.view.drawn.markers },
      (n2.view.drawn.markers ?? []).includes('node'));

  // FEASIBILITY, AT THE BOUNDARY. A node asking for a million metres per second
  // would be refused by a comparison that is broken in every direction, so the
  // pair below straddles the vehicle's own remaining delta-v by one metre per
  // second either side. `shortfallMS` and `deltaVAvailableMS` are not in
  // MapMode.report()'s plan block, so both are read off the panel's own rows.
  const setPro = async (target) => {
    of.map('adjust', { axis: 'prograde', delta: target - MAP().node.pro });
    await sleep(0.35);
    return MAP();
  };
  const over = await setPro(dvAvailable + 1);
  const overRow = { dV: readoutRow('dV'), have: readoutRow('have'),
    short: readoutRow('SHORT BY') };
  rec('D12 the panel agrees with the flight report about what is in the tanks',
      { remainingDvMS: dvAvailable }, { have: overRow.have },
      overRow.have !== null && near(parseFloat(overRow.have), dvAvailable, 1),
      'if these two disagree the feasibility answer is about a different vehicle');
  rec('D13 ONE metre per second MORE than the ship carries is INFEASIBLE',
      { deltaVMS: n2.plan.deltaVMS, feasible: n2.plan.feasible },
      { deltaVMS: over.plan.deltaVMS, feasible: over.plan.feasible,
        'SHORT BY': overRow.short },
      over.plan.feasible === false);
  rec('D14 and the SHORTFALL is the excess itself, not a flag',
      { excessMS: 1 }, { 'SHORT BY': overRow.short },
      overRow.short !== null && near(parseFloat(overRow.short), 1, 0.51),
      'read off the panel: MapMode.report() does not publish shortfallMS');
  const under = await setPro(dvAvailable - 1);
  const underRow = { short: readoutRow('SHORT BY'), dV: readoutRow('dV') };
  rec('D15 and ONE metre per second either side FLIPS it',
      { deltaVMS: over.plan.deltaVMS, feasible: over.plan.feasible },
      { deltaVMS: under.plan.deltaVMS, feasible: under.plan.feasible,
        'SHORT BY': underRow.short },
      under.plan.feasible === true && underRow.short === null,
      'a two metre per second window on a ' + Math.round(dvAvailable)
      + ' m/s threshold: a broken comparison cannot pass both halves');

  // Back to a burn the ship can actually fly, for the navball section.
  const flyable = await setPro(10);
  rec('D16 back to a flyable node', { deltaVMS: under.plan.deltaVMS },
      { deltaVMS: flyable.plan.deltaVMS, feasible: flyable.plan.feasible },
      near(flyable.plan.deltaVMS, 10, 1e-9) && flyable.plan.feasible === true);

  // THE NODE COMES CLOSER. A maneuver node is a point on the orbit, and the
  // vessel coasts toward it, so "light it in" has to run DOWN or the burn the
  // panel is describing can never be flown: the countdown is the only thing
  // telling the pilot when to open the throttle. Asserted against measured sim
  // time rather than against a guessed rate, and with a generous 25 per cent
  // band, because warp and the frame budget both move the clock.
  const t0 = { metS: FL().metS, tFromNowS: MAP().node.tFromNowS,
    timeToBurnStartS: MAP().plan.timeToBurnStartS,
    'light it in': readoutRow('light it in') };
  await sleep(20);
  const t1 = { metS: FL().metS, tFromNowS: MAP().node.tFromNowS,
    timeToBurnStartS: MAP().plan.timeToBurnStartS,
    'light it in': readoutRow('light it in') };
  const elapsed = t1.metS - t0.metS;
  rec('D17 THE NODE COUNTS DOWN as the vessel coasts toward it', t0, t1,
      elapsed > 1
      && near(t0.timeToBurnStartS - t1.timeToBurnStartS, elapsed, elapsed * 0.25),
      `${elapsed.toFixed(1)} s of MET passed and the countdown moved `
      + `${(t0.timeToBurnStartS - t1.timeToBurnStartS).toFixed(3)} s`);

  // ==========================================================================
  // 9. SECTION E: THE NODE IS ON THE NAVBALL. Reid asked for this by name.
  //
  // `frontMarks` filters to the NEAR hemisphere before drawing and publishes
  // the surviving list, so the marker only exists when the burn direction is
  // actually in front of the nose. Rather than hope it is, the ship is pointed
  // at it with hold-node, which is the eighth SAS key and is itself part of
  // the feature. The map is CLOSED for this, because a node you placed is
  // meant to stay on the ball you fly by.
  // ==========================================================================
  of.input.act(['map'], 4);
  await sleep(0.3);
  check('E0 the map is closed for the navball checks', MAP().open === false);

  const h0 = { holding: MAP().holding, sas: FL().sas,
    sasErrDeg: FL().sasErrDeg, marks: NB().markersDrawn };
  of.input.act(['sasNode'], 6);
  await sleep(0.3);
  const h1 = { holding: MAP().holding, sas: FL().sas, sasErrDeg: FL().sasErrDeg,
    marks: NB().markersDrawn };
  rec('E1 HOLD NODE (Digit8) points SAS at the node the map planned', h0, h1,
      h1.holding === true && h1.sas === 'CMD');
  // THE CMD MARKER IS A DIRECTION, NOT THE NOSE. `frontMarks` keeps only the
  // near hemisphere, so a command more than ninety degrees away from where the
  // ship is pointing MUST drop off the ball; one that never drops off is being
  // drawn at the nose, where it is pinned to the reticle and can tell the pilot
  // nothing. The instant after hold-node engages is the only moment the two are
  // reliably far apart, so the row says so when the geometry does not oblige
  // rather than quietly passing on a command that happened to be in front.
  const cmdBehind = h1.sasErrDeg > 100;
  rec('E1b the CMD marker leaves the ball when the command is BEHIND the nose',
      { sasErrDeg: h1.sasErrDeg, applicable: cmdBehind },
      { markersDrawn: h1.marks },
      !cmdBehind || !(h1.marks ?? []).includes('command'),
      cmdBehind ? 'the command is on the far hemisphere, so it must not be drawn'
        : 'NOT ASSERTED: the command was already in front of the nose');
  // Let the attitude actually get there. The marker is a fact about geometry,
  // so it is read once the nose is on it rather than while it is still slewing.
  // `sasErrDeg` IS the angle between the nose and the SAS command, and while
  // `holding` is true that command is the node's own burn direction, refreshed
  // every frame, so this is the alignment itself and not a proxy for it.
  for (let i = 0; i < 60 && FL().sasErrDeg > 2; ++i) await sleep(0.5);
  const settled = { sasErrDeg: FL().sasErrDeg, marks: NB().markersDrawn,
    holding: MAP().holding };
  rec('E2 and the ship SLEWED onto that direction',
      { sasErrDeg: h1.sasErrDeg }, settled,
      settled.holding === true && settled.sasErrDeg < 5);
  rec('E3 THE NODE IS DRAWN ON THE NAVBALL',
      { markersDrawn: h0.marks }, { markersDrawn: settled.marks },
      (settled.marks ?? []).includes('node'));

  const nbBefore = NB().markersDrawn;
  const nodeBefore = MAP().node;
  of.input.act(['map'], 4);
  await sleep(0.3);
  const clearedByButton = clickBtn('#of-map .readout button[data-act="clear"]');
  await sleep(0.4);
  const cleared = MAP();
  rec('E4 the REAL "clear" button removes the node',
      { node: nodeBefore, buttonFound: clearedByButton },
      { node: cleared.node, plan: cleared.plan },
      clearedByButton === true && cleared.node === null && cleared.plan === null);
  rec('E5 AND THE MARKER IS GONE FROM THE BALL',
      { markersDrawn: nbBefore }, { markersDrawn: NB().markersDrawn },
      !(NB().markersDrawn ?? []).includes('node'));
  rec('E6 and the planned conic stops being drawn',
      { plannedPoints: flyable.view.drawn.plannedPoints },
      { plannedPoints: cleared.view.drawn.plannedPoints,
        currentPoints: cleared.view.drawn.currentPoints },
      cleared.view.drawn.plannedPoints === 0
      && cleared.view.drawn.currentPoints > 100,
      'the CURRENT conic must survive the clear, or this is a blank map '
      + 'passing for a cleared node');
  rec('E7 and clearing the node released the hold',
      { holding: true }, { holding: cleared.holding }, cleared.holding === false);

  // ==========================================================================
  // 10. SECTION F: THE CAMERA. Real DOM input wherever the DOM can carry it.
  //
  // The map is shut first, because `setUiCapture` MUTES look, zoom and the
  // wheel while a panel owns the pointer, so measuring the camera with the map
  // up would measure the capture instead.
  // ==========================================================================
  of.input.act(['map'], 4);
  await sleep(0.3);
  check('F0 the map is closed for the camera checks', MAP().open === false);
  const canvas = document.getElementById('of-canvas');
  check('F0b the render canvas the Input is attached to is findable',
        canvas !== null);

  const l0 = CAM();
  of.input.tape([{ hold: 3, dYaw: 0.25, dPitch: 0.12 }, { hold: 2, keys: [] }]);
  await sleep(0.4);
  const l1 = CAM();
  rec('F1 a driven LOOK reaches the chase camera',
      { looks: l0.looks, yawDeg: l0.yawDeg, pitchDeg: l0.pitchDeg },
      { looks: l1.looks, yawDeg: l1.yawDeg, pitchDeg: l1.pitchDeg },
      l1.looks > l0.looks && l1.yawDeg !== l0.yawDeg
      && l1.pitchDeg !== l0.pitchDeg);

  // A REAL DOM POINTERMOVE. Driving an input ACTION never generates one, and
  // that once hid a completely inert left mouse button through twenty green
  // probes (probes/realclick.js). `pointerdown` is what puts Input into its
  // drag-look branch, which is the path that works without the pointer lock a
  // headless browser will not grant.
  let realLook = null;
  if (canvas !== null) {
    canvas.dispatchEvent(new PointerEvent('pointerdown',
      { bubbles: true, pointerId: 1, button: 0, isPrimary: true }));
    canvas.dispatchEvent(new PointerEvent('pointermove',
      { bubbles: true, pointerId: 1, movementX: 60, movementY: -30 }));
    await sleep(0.3);
    realLook = CAM();
    canvas.dispatchEvent(new PointerEvent('pointerup',
      { bubbles: true, pointerId: 1, button: 0, isPrimary: true }));
    await sleep(0.2);
  }
  rec('F2 and so does a REAL DOM pointermove',
      { looks: l1.looks, yawDeg: l1.yawDeg },
      realLook === null ? null : { looks: realLook.looks, yawDeg: realLook.yawDeg },
      realLook !== null && realLook.looks > l1.looks
      && realLook.yawDeg !== l1.yawDeg);

  // A REAL DOM WHEEL. deltaY > 0 is one notch out, which is ObserverCamera's
  // convention on foot as well, so the wheel means the same thing in both.
  const z0 = CAM();
  if (canvas !== null) {
    canvas.dispatchEvent(new WheelEvent('wheel',
      { bubbles: true, cancelable: true, deltaY: 120 }));
  }
  await sleep(0.3);
  const z1 = CAM();
  rec('F3 a REAL DOM wheel pulls the chase camera back',
      { zooms: z0.zooms, distanceM: z0.distanceM },
      { zooms: z1.zooms, distanceM: z1.distanceM },
      z1.zooms > z0.zooms && z1.distanceM > z0.distanceM);

  of.input.tape([{ hold: 40, zoom: 1 }, { hold: 2, keys: [] }]);
  await sleep(0.6);
  const far = CAM();
  const farHeld = far.zooms;
  of.input.tape([{ hold: 4, zoom: 1 }, { hold: 2, keys: [] }]);
  await sleep(0.3);
  const far2 = CAM();
  rec('F4 zooming out CLAMPS at zoomFarM',
      { distanceM: z1.distanceM, zoomFarM: z1.zoomFarM },
      { distanceM: far.distanceM, zoomFarM: far.zoomFarM },
      near(far.distanceM, far.zoomFarM, 1e-6));
  rec('F5 and a notch past the clamp counts NOTHING, so the stop is real',
      { zooms: farHeld, distanceM: far.distanceM },
      { zooms: far2.zooms, distanceM: far2.distanceM },
      far2.zooms === farHeld && near(far2.distanceM, far.distanceM, 1e-9));

  of.input.tape([{ hold: 60, zoom: -1 }, { hold: 2, keys: [] }]);
  await sleep(0.8);
  const nearCam = CAM();
  const nearHeld = nearCam.zooms;
  of.input.tape([{ hold: 4, zoom: -1 }, { hold: 2, keys: [] }]);
  await sleep(0.3);
  const near2 = CAM();
  rec('F6 zooming in CLAMPS at zoomNearM, which is what keeps the eye out of '
      + 'the hull', { distanceM: far2.distanceM, zoomNearM: far2.zoomNearM },
      { distanceM: nearCam.distanceM, zoomNearM: nearCam.zoomNearM },
      near(nearCam.distanceM, nearCam.zoomNearM, 1e-6));
  rec('F7 and a notch past THAT counts nothing either',
      { zooms: nearHeld }, { zooms: near2.zooms, distanceM: near2.distanceM },
      near2.zooms === nearHeld && near(near2.distanceM, nearCam.distanceM, 1e-9));

  // Back off to a normal chase distance before the view toggle. Sitting on the
  // near clamp is a legitimate place to be and a terrible place to measure
  // from: the chase eye there is only a few metres from a stack whose camera
  // aims at its MIDDLE, so "the eye is outside the hull" and "the eye is in the
  // pod" stop being separable, and the test would be measuring its own setup.
  of.input.tape([{ hold: 10, zoom: 1 }, { hold: 2, keys: [] }]);
  await sleep(0.4);

  // THE VIEW TOGGLE, measured as a DISTANCE and not as a boolean. The eye has
  // to actually move into the pod: `firstPerson` flipping while the camera
  // stayed 20 m behind the rocket is a state change nobody can see.
  const eyeToVessel = () => {
    const e = of.world().eyeRel;
    const v = F().view.drawnEngineM;
    return Math.round(Math.hypot(e[0] - v[0], e[1] - v[1], e[2] - v[2]) * 100) / 100;
  };
  const v0 = { firstPerson: CAM().firstPerson, viewToggles: CAM().viewToggles,
    eyeToVesselM: eyeToVessel() };
  of.input.act(['view'], 6);
  await sleep(0.5);
  const v1 = { firstPerson: CAM().firstPerson, viewToggles: CAM().viewToggles,
    eyeToVesselM: eyeToVessel() };
  rec('F8 the VIEW action puts the eye in the pod', v0, v1,
      v0.firstPerson === false && v1.firstPerson === true
      && v1.viewToggles === v0.viewToggles + 1
      && v0.eyeToVesselM > 10 && v1.eyeToVesselM < 3,
      'the eye has to MOVE, not just the flag');

  // The wheel in the cockpit is deliberately inert, and deliberately not
  // silent about it: `zoom` is still called and the clamp refuses it, so the
  // counter is what tells the two apart.
  const cz0 = CAM();
  if (canvas !== null) {
    canvas.dispatchEvent(new WheelEvent('wheel',
      { bubbles: true, cancelable: true, deltaY: 120 }));
  }
  await sleep(0.3);
  const cz1 = CAM();
  rec('F9 the wheel does nothing in the cockpit, and says so in the counter',
      { zooms: cz0.zooms, distanceM: cz0.distanceM },
      { zooms: cz1.zooms, distanceM: cz1.distanceM },
      cz1.zooms === cz0.zooms && near(cz1.distanceM, cz0.distanceM, 1e-9));

  of.input.act(['view'], 6);
  await sleep(0.5);
  const v2 = { firstPerson: CAM().firstPerson, viewToggles: CAM().viewToggles,
    eyeToVesselM: eyeToVessel() };
  rec('F10 and the view toggles back out to the chase camera', v1, v2,
      v2.firstPerson === false && v2.viewToggles === v1.viewToggles + 1
      && v2.eyeToVesselM > 10);

  // ==========================================================================
  // 11. THE WORLD IS STILL A WORLD after all of that.
  // ==========================================================================
  const endFlight = FL();
  rec('Z1 the flight survived the whole session', { live: true },
      { live: endFlight.live, status: endFlight.status,
        bound: endFlight.bound, aboard: F().aboard },
      endFlight.live === true && endFlight.bound === true
      && F().aboard === true);
  const st = of.stats();
  log.push(`render: ${st.draw.calls} draw calls, frame p50 `
    + `${st.frameMs.p50.toFixed(2)} ms / p95 ${st.frameMs.p95.toFixed(2)} ms`);

  return {
    valid: true,
    pass: fails.length === 0,
    fails,
    rows,
    log,
    orbit: {
      apoapsisM: orb.apoapsisM, periapsisM: orb.periapsisM,
      eccentricity: orb.eccentricity, periodS: orb.periodS,
      remainingDvMS: orb.remainingDvMS,
    },
    coreReference: CORE,
    map: MAP(),
    navball: NB(),
    camera: CAM(),
    flight: endFlight,
    render: { calls: st.draw.calls, p50: st.frameMs.p50, p95: st.frameMs.p95 },
  };
})()
