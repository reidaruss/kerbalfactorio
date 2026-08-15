// qolflight2.js: QOL SURVEY part 2. LAUNCH, THE NAVBALL, TIME WARP, R89.
//
//   node tools/smoke/run.mjs --scenario=walk --sandbox=1 \
//        --evalfile=tools/smoke/probes/qolflight2.js
//
//   --evalargs='{"stop":"ignite"|"ascent"|"coast"|"warp"|"r89"}' aims the
//   stop point; default (no evalargs) runs the full survey through R89.
//
// Records DRAWN text, never model state alone. The stop point exists so the
// runner's single --out screenshot can be aimed at a chosen moment.
(async () => {
  const of = window.__of;
  if (!of) return { valid: false, why: 'no __of' };
  const A = (globalThis.OF_ARGS ?? {});
  const STOP = A.stop ?? 'r89';
  const sleep = (n) => of.run(n);
  const log = [];
  const shot = {};

  const T = (sel) => {
    const el = document.querySelector(sel);
    if (el === null) return null;
    const r = el.getBoundingClientRect();
    return { vis: r.width > 0 && r.height > 0,
             text: (el.innerText ?? el.textContent ?? '').trim() };
  };
  // The navball's chip row alone, which is where the instruction lives.
  const CHIPS = () => {
    const out = [];
    for (const c of document.querySelectorAll('#of-navball .chip')) {
      out.push(c.className + ' :: ' + c.textContent.trim());
    }
    return out;
  };
  const NB = () => T('#of-navball')?.text ?? '(no navball)';
  const F = () => of.flight('report').flight;
  const snap = (label) => {
    const f = F();
    const o = { label, chips: CHIPS(), navball: NB(),
                status: f.status, warpLadder: f.warp, sas: f.sas,
                altAglM: Math.round(f.altitudeAglM ?? -1),
                apM: f.apoapsisM, peM: f.periapsisM };
    shot[label] = o;
    return o;
  };

  await sleep(1.0);
  of.build(0);

  // --- FIXTURE: build, roll out, board -------------------------------------
  of.vab('enter');
  await sleep(0.5);
  const cat = of.vab('catalogue');
  of.vab('press', 'clear');
  await sleep(0.2);
  for (const pid of [0x0100, 0x0101, 0x0103]) {
    const i = cat.find((c) => c.id === pid)?.index ?? -1;
    if (i < 0) continue;
    of.vab('frame');
    of.vab('take', i);
    await sleep(0.15);
    const parts = of.vab('report').parts;
    if (parts.length === 0) { of.vab('place'); await sleep(0.15); continue; }
    let low = parts[0];
    for (const p of parts) if (p.origin[1] < low.origin[1]) low = p;
    const nodes = of.vab('nodes').filter((n) => n.parent === low.handle
      && n.onScreen && (n.kind === 'bottom' || n.kind === 'interstage'));
    if (nodes.length === 0) continue;
    of.vab('hover', nodes[0].ndc[0], nodes[0].ndc[1]);
    of.vab('place');
    await sleep(0.15);
  }
  of.vab('leave');
  await sleep(0.5);
  of.flight('rollout');
  await sleep(1.0);
  for (let i = 0; i < 20 && of.flight('report').distanceToVesselM > 10; ++i) {
    of.input.act(['forward'], 30);
    await sleep(0.5);
  }
  of.flight('board');
  await sleep(1.0);
  snap('10-clamped-default');
  log.push('DEFAULT THROTTLE aboard, untouched: navball THR reads '
    + (NB().match(/THR\s*\n?(\d+)%/) || ['', '?'])[1] + '%, '
    + 'model throttle ' + of.flight('navball').throttle);

  // --- WARP ON THE PAD, before anything else. What does it say? ------------
  const padWarpBefore = F().warp;
  of.input.act(['warpUp'], 4);
  await sleep(0.4);
  snap('11-warp-pressed-on-pad');
  log.push('warpUp on the CLAMPED pad: ladder ' + padWarpBefore + ' -> '
    + F().warp);
  of.input.act(['warpDown'], 4);
  await sleep(6.0);   // past the 5 s flash
  snap('12-warp-flash-expired-on-pad');

  // --- IGNITION. The default: press stage with the throttle where it is. ---
  of.input.act(['stage'], 4);
  await sleep(1.5);
  snap('20-after-stage-default-throttle');
  log.push('after Space at the DEFAULT throttle: status ' + F().status
    + ', altAgl ' + F().altitudeAglM);
  if (STOP === 'ignite') return { valid: true, log, shot, stopped: STOP };

  // Throttle up as the chip tells you to.
  of.input.act(['throttleFull'], 6);
  await sleep(2.0);
  snap('21-throttle-full');

  // --- ASCENT. Sample the drawn text as the vehicle climbs. ----------------
  //
  // NOTHING IS STEERED. This is a first-time player who read the chip, pressed
  // Space, held Shift and is now watching, which is exactly the case where a
  // missing "turn now" is felt.
  const timeline = [];
  let lastKey = '';
  const t0 = Date.now();
  let apoSeen = false, apoAtAltM = -1;
  while (Date.now() - t0 < 150000) {
    const f = F();
    const ch = CHIPS().join(' | ');
    const key = f.status + '||' + ch;
    if (key !== lastKey) {
      lastKey = key;
      timeline.push({ tS: Math.round((Date.now() - t0) / 100) / 10,
                      altAglM: Math.round(f.altitudeAglM),
                      status: f.status, chips: ch,
                      ap: f.apoapsisM, pe: f.periapsisM });
    }
    if (!apoSeen && Number.isFinite(f.apoapsisM) && f.apoapsisM > 1000) {
      apoSeen = true; apoAtAltM = Math.round(f.altitudeAglM);
    }
    if (f.status === 'COAST' || f.status === 'ORBIT' || f.status === 'DOWN') break;
    if (f.remainingDvMS <= 1 && f.altitudeAglM > 1000) break;
    await sleep(0.5);
  }
  log.push('ascent unsteered ended at status ' + F().status + ', alt '
    + Math.round(F().altitudeAglM) + ' m, after '
    + ((Date.now() - t0) / 1000).toFixed(0) + ' s wall');
  log.push('AP first became a finite number above 1 km at alt ' + apoAtAltM + ' m');
  shot.ascentTimeline = timeline;
  snap('30-end-of-powered-ascent');
  if (STOP === 'ascent') return { valid: true, log, shot, stopped: STOP };

  // --- WHAT THE COAST SAYS -------------------------------------------------
  of.input.act(['throttleCut'], 4);
  await sleep(1.5);
  snap('40-coast');
  const rd = of.flight('readout');
  log.push('coast readout keys: ' + Object.keys(rd || {}).join(','));
  log.push('coast: is there a time-to-apoapsis anywhere in the drawn navball? '
    + /T\s*-?\s*APO|TIME TO|ETA|t\+?apo/i.test(NB()));
  if (STOP === 'coast') return { valid: true, log, shot, stopped: STOP };

  // --- TIME WARP, FOR REAL, AND WHAT IT SAYS -------------------------------
  //
  // The ladder is [1,2,4,10,50,200,1000] but `warpSteps` caps it at 10 INSIDE
  // the atmosphere. Measured here as MET advanced per second of `of.run`, so
  // the claim is about the sim rate and not about the label.
  const warpRows = [];
  for (let k = 0; k < 6; ++k) {
    of.input.act(['warpUp'], 3);
    await sleep(0.3);
    const label = F().warp;
    const drawn = CHIPS().join(' | ');
    const met0 = of.flight('navball');
    const m0 = F().metS ?? 0;
    await sleep(2.0);
    const m1 = F().metS ?? 0;
    warpRows.push({ press: k + 1, ladderSays: label,
                    chipSays: drawn,
                    metPerRunSecond: Math.round(((m1 - m0) / 2.0) * 100) / 100,
                    inSpace: F().inSpace ?? null,
                    altAglM: Math.round(F().altitudeAglM) });
    void met0;
  }
  shot.warpRows = warpRows;
  // Six seconds later the transient flash is gone. What is left on screen?
  await sleep(6.0);
  snap('50-warp-high-flash-expired');
  log.push('WARP INDICATOR AFTER THE FLASH EXPIRES: chips = '
    + JSON.stringify(CHIPS()));
  if (STOP === 'warp') return { valid: true, log, shot, stopped: STOP };

  // --- R89: RETROGRADE, THEN BACK TO CMD -----------------------------------
  //
  // Physics owns the fix. The question here is only whether a PLAYER COULD
  // TELL, so everything below is the drawn chip row and the drawn heading.
  for (let k = 0; k < 6; ++k) { of.input.act(['warpDown'], 3); await sleep(0.2); }
  await sleep(1.0);
  snap('60-before-retro');
  const att0 = document.querySelector('#of-navball .att')?.textContent
    ?? (NB().match(/HDG[^\n]*/) || [''])[0];
  of.input.act(['sasRetrograde'], 4);
  await sleep(8.0);
  snap('61-sas-retrograde');
  const attRetro = (NB().match(/HDG[^\n]*/) || [''])[0];
  const poseRetro = of.flight('vessels').list.find((v) => v.promoted)?.pose ?? null;
  log.push('SAS retrograde: chips ' + JSON.stringify(CHIPS())
    + ' attitude "' + attRetro + '"');

  of.input.act(['sasStability'], 4);
  await sleep(1.0);
  snap('62-back-to-stability-t1');
  const attStab1 = (NB().match(/HDG[^\n]*/) || [''])[0];
  await sleep(10.0);
  snap('63-back-to-stability-t11');
  const attStab2 = (NB().match(/HDG[^\n]*/) || [''])[0];
  const poseStab = of.flight('vessels').list.find((v) => v.promoted)?.pose ?? null;
  log.push('back to CMD: chips ' + JSON.stringify(CHIPS())
    + ' attitude after 1 s "' + attStab1 + '" after 11 s "' + attStab2 + '"');

  // Now warp with the nose wherever it ended up, which is R89's teeth.
  const altBefore = F().altitudeAglM;
  const vsBefore = F().verticalSpeedMS ?? null;
  for (let k = 0; k < 4; ++k) { of.input.act(['warpUp'], 3); await sleep(0.25); }
  await sleep(0.4);
  snap('70-warping-after-retro-latch');
  await sleep(12.0);
  snap('71-warped-12s');
  const altAfter = F().altitudeAglM;
  log.push('R89 warp window: alt ' + Math.round(altBefore) + ' -> '
    + Math.round(altAfter) + ' m, ladder ' + F().warp
    + ', chips now ' + JSON.stringify(CHIPS()));

  return { valid: true, log, shot, stopped: STOP,
           attitudes: { att0, attRetro, attStab1, attStab2 },
           poseRetro, poseStab,
           finalFlight: F(),
           note: 'survey; every claim is the DRAWN chip row or the drawn '
             + 'navball text' };
})()
