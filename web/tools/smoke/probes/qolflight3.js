// qolflight3.js: QOL SURVEY part 3. IN ORBIT: R89, WARP, THE MAP, THE RETURN.
//
//   node tools/smoke/run.mjs --scenario=walk --sandbox=1 \
//        --evalfile=tools/smoke/probes/qolflight3.js
//
//   --evalargs='{"section":"r89"}' | '{"section":"map"}'
//
// BT-190: this probe never carried a real invocation; `extractCmd()`'s old
// first-match rule took a prose line further down ("OF_ARGS is the
// WRAPPER'S PARAMETER in run.mjs...") as the command, which held zero real
// flags, so every prior sweep ran this at the runner's bare defaults. The
// flags above match `qolflight1.js` and `qolflight2.js`, parts 1 and 2 of
// the same in-orbit survey, both of which document `--scenario=walk
// --sandbox=1` for the same reason: reaching orbit needs the full part
// catalogue this probe's own fixture builds on.
//
// OF_ARGS is the WRAPPER'S PARAMETER in run.mjs (`((OF_ARGS) => (...))(json)`),
// not a global, so it is read by bare name here. qolflight2.js read
// `globalThis.OF_ARGS` and silently got undefined: a harness defect of mine,
// recorded because the rule says to suspect the probe first.
(async () => {
  const of = window.__of;
  if (!of) return { valid: false, why: 'no __of' };
  const A = (typeof OF_ARGS !== 'undefined' && OF_ARGS) ? OF_ARGS : {};
  const SECTION = A.section ?? 'r89';
  const sleep = (n) => of.run(n);
  const log = [];
  const shot = {};

  const TXT = (sel) => {
    const el = document.querySelector(sel);
    if (el === null) return null;
    const r = el.getBoundingClientRect();
    return { vis: r.width > 0 && r.height > 0,
             text: (el.innerText ?? el.textContent ?? '').trim() };
  };
  const CHIPS = () => [...document.querySelectorAll('#of-navball .chip')]
    .map((c) => c.className + ' :: ' + c.textContent.trim());
  const NB = () => TXT('#of-navball')?.text ?? '(none)';
  const HDG = () => (NB().match(/HDG[^\n]*/) || [''])[0];
  const APPE = () => {
    const m = NB().match(/AP\n([^\n]*)\nPE\n([^\n]*)/);
    return m ? { ap: m[1], pe: m[2] } : { ap: '?', pe: '?' };
  };
  const F = () => of.flight('report').flight;
  const snap = (label) => {
    const f = F();
    shot[label] = { label, chips: CHIPS(), hdg: HDG(), drawnApPe: APPE(),
                    navball: NB(), status: f.status, sasDrawn: f.sas,
                    ladder: f.warp, apM: f.apoapsisM, peM: f.periapsisM,
                    altAglM: Math.round(f.altitudeAglM) };
    return shot[label];
  };

  // THE NAVIGATION GUARD. Pressing the map's arm button on a VESSEL row tore
  // the execution context down twice in a row ("navigation"), and the only
  // navigating code in this client is MenuBoot's `restart`/`goTo` port, which
  // `norestart` suppresses. Turning it on is therefore a MEASUREMENT: if the
  // reload stops, the arm press reached the restart port.
  const unloads = [];
  if (A.norestart === 1 && typeof of.cheat === 'function') {
    unloads.push('norestart: ' + JSON.stringify(of.cheat('norestart')));
  }
  window.addEventListener('beforeunload', () => { unloads.push('beforeunload'); });
  window.addEventListener('pagehide', () => { unloads.push('pagehide'); });

  await sleep(1.0);
  of.build(0);

  // --- FIXTURE: aboard and in orbit ----------------------------------------
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
  await sleep(0.8);

  // THE SANDBOX CHEAT, pressed through its own button on the pause menu, which
  // is how a sandbox player reaches it. Record what the pause menu SAYS about
  // these buttons on the way through.
  of.pause(true);
  await sleep(0.5);
  shot['00-pause-menu'] = { text: TXT('#of-pause')?.text ?? '(none)' };
  const cheatBtns = [...document.querySelectorAll('#of-pause button[data-cheat]')]
    .map((b) => b.getAttribute('data-cheat') + ' :: "' + b.textContent.trim()
      + '" title="' + (b.getAttribute('title') ?? '') + '"');
  shot['00-cheat-buttons'] = cheatBtns;
  document.querySelector('#of-pause button[data-cheat="orbit"]')?.click();
  await sleep(1.5);
  of.pause(false);
  await sleep(1.5);
  snap('01-in-orbit');
  if (F().status !== 'ORBIT') {
    return { valid: false, why: 'fixture failed to reach orbit: ' + F().status,
             log, shot };
  }
  of.input.act(['stage'], 4);      // light an engine, as a hand-flown craft has
  await sleep(0.6);
  of.input.act(['throttleCut'], 4);
  await sleep(0.8);
  snap('02-orbit-staged');

  if (SECTION === 'r89') {
    // ===================== R89: RETROGRADE, THEN BACK ======================
    //
    // Default first: what SAS mode is a freshly boarded vessel in, and what
    // does the screen call it?
    log.push('DEFAULT SAS on boarding, drawn: '
      + (CHIPS().find((c) => c.includes('sas')) ?? '(none)'));

    const h0 = HDG();
    of.input.act(['sasRetrograde'], 4);
    await sleep(1.0);
    snap('10-retro-pressed');
    await sleep(25.0);
    snap('11-retro-settled');
    const hRetro = HDG();
    log.push('SAS RET: ' + h0 + '  ->  ' + hRetro
      + '  sasErrDeg ' + F().sasErrDeg);

    // BACK TO STABILITY, which is Digit1 and is drawn as HOLD.
    of.input.act(['sasStability'], 4);
    await sleep(1.0);
    snap('20-stability-1s');
    const hS1 = HDG();
    const pe1 = F().periapsisM;
    await sleep(30.0);
    snap('21-stability-31s');
    const hS2 = HDG();
    const pe2 = F().periapsisM;
    log.push('after Digit1 (drawn "' + F().sas + '"): HDG 1 s "' + hS1
      + '" 31 s "' + hS2 + '", PE ' + Math.round(pe1) + ' -> '
      + Math.round(pe2) + ' m');
    log.push('does the nose keep tracking retrograde under HOLD? heading '
      + (hS1 === hS2 ? 'FROZEN' : 'STILL MOVING'));

    // NOW WARP, which is where R89 bites. Everything below is drawn text.
    const before = { ap: F().apoapsisM, pe: F().periapsisM, alt: F().altitudeAglM,
                     drawn: APPE(), chips: CHIPS() };
    for (let k = 0; k < 5; ++k) { of.input.act(['warpUp'], 3); await sleep(0.25); }
    await sleep(0.5);
    snap('30-warp-engaged');
    const warpRows = [];
    for (let k = 0; k < 8; ++k) {
      await sleep(4.0);
      const f = F();
      warpRows.push({ k, ladder: f.warp, status: f.status,
                      altAglM: Math.round(f.altitudeAglM),
                      apM: f.apoapsisM === null ? null : Math.round(f.apoapsisM),
                      peM: Math.round(f.periapsisM),
                      drawn: APPE(), hdg: HDG(),
                      chips: CHIPS().join(' | ') });
      if (f.status === 'DOWN') break;
    }
    shot.warpRows = warpRows;
    snap('31-after-warp');
    const after = { ap: F().apoapsisM, pe: F().periapsisM, alt: F().altitudeAglM,
                    drawn: APPE(), chips: CHIPS() };
    log.push('R89 warp window: PE ' + Math.round(before.pe) + ' -> '
      + Math.round(after.pe) + ' m; status ' + F().status
      + '; nothing on the chip row named warp: '
      + JSON.stringify(after.chips.filter((c) => /warp/i.test(c))));
    return { valid: true, section: SECTION, log, shot, before, after, unloads };
  }

  // ========================= THE MAP =====================================
  const mapCode = (of.input.bindings().map || [])[0];
  shot['40-before-map'] = { navball: NB() };
  window.dispatchEvent(new KeyboardEvent('keydown', { code: mapCode, bubbles: true }));
  await sleep(1.5);
  shot['41-map-open'] = { open: of.map('report').open,
                          text: TXT('#of-map')?.text ?? '(none)',
                          navballStillDrawn: TXT('#of-navball')?.vis,
                          hudStillDrawn: TXT('#of-hud')?.vis };
  if (A.upto === 'open') { if (A.pad) { await sleep(A.pad); shot['43-idled'] = { pad: A.pad, open: of.map('report').open, status: F().status }; } return { valid: true, section: SECTION, log, shot, unloads }; }
  const p0 = of.map('report').planner;
  log.push('planner rowIds: ' + JSON.stringify(p0 ? p0.rowIds : null));
  log.push('planner waitingOn: "' + (p0 ? p0.waitingOn : '?') + '"');
  shot['41-map-report'] = of.map('report');

  // Every clickable thing on the map, by its drawn label.
  shot['42-map-controls'] = [...document.querySelectorAll('#of-map [data-plan-act], #of-map [data-plan], #of-map button')]
    .map((b) => (b.getAttribute('data-plan-act') ?? b.getAttribute('data-plan') ?? b.tagName)
      + ' :: "' + b.textContent.trim().replace(/\s+/g, ' ').slice(0, 160) + '"'
      + (b.disabled ? ' [DISABLED]' : ''));

  // Pick the moon, which is the interesting trip, and read what it says.
  const press = async (sel) => {
    const el = document.querySelector(sel);
    if (el === null) return false;
    el.click();
    await sleep(0.8);
    return true;
  };
  if (A.upto === 'controls') return { valid: true, section: SECTION, log, shot, unloads };
  const gotBody = await press('#of-map [data-plan="b:cinder"]');
  await sleep(2.0);
  shot['50-cinder-selected'] = { gotBody, text: TXT('#of-map')?.text ?? '(none)',
    planner: of.map('report').planner };
  const chart = document.querySelector('#of-map .pchart');
  shot['51-chart'] = chart === null ? null : {
    text: chart.textContent.trim().replace(/\s+/g, ' ').slice(0, 600),
    svgLabels: [...chart.querySelectorAll('text')].map((t) => t.textContent),
    hasAxisLabels: chart.querySelectorAll('text').length,
  };

  if (A.upto === 'cinder') { if (A.pad) { await sleep(A.pad); shot['53-padded-cinder'] = { pad: A.pad, open: of.map('report').open, status: F().status }; } return { valid: true, section: SECTION, log, shot, unloads }; }
  const vRow = (of.map('report').planner.rowIds || []).find((i) => i.startsWith('v:'));
  if (vRow) {
    await press(`#of-map [data-plan="${vRow}"]`);
    await sleep(2.0);
    shot['52-vessel-selected'] = { text: TXT('#of-map')?.text ?? '(none)',
      planner: of.map('report').planner };
  }

  if (A.pad) { await sleep(A.pad); shot['53-padded'] = { after: A.pad, open: of.map('report').open, text: (TXT('#of-map')?.text ?? '').slice(0, 200) }; }
  if (A.upto === 'vessel') return { valid: true, section: SECTION, log, shot, unloads };
  // Arm it and see what the screen becomes.
  const armed = await press('#of-map [data-plan-act="arm"]');
  await sleep(1.2);
  shot['60-after-arm'] = { armed, text: TXT('#of-map')?.text ?? '(none)',
    run: of.map('report').planner.run };

  if (A.upto === 'arm') return { valid: true, section: SECTION, log, shot, unloads };
  // --- COMING BACK OUT ------------------------------------------------------
  window.dispatchEvent(new KeyboardEvent('keydown', { code: mapCode, bubbles: true }));
  await sleep(1.2);
  shot['70-map-closed'] = { open: of.map('report').open,
                            navball: NB(), navballVis: TXT('#of-navball')?.vis };

  if (SECTION === 'map') return { valid: true, section: SECTION, log, shot, unloads };

  // --- LEAVING THE VESSEL AND COMING BACK ----------------------------------
  // NOTE: one run of this section destroyed the execution context (the page
  // navigated), so it is behind its own flag and is not allowed to take the
  // map measurements down with it.
  const lv = of.flight('leave');
  await sleep(1.5);
  shot['80-after-leave'] = { ok: lv.ok, navballVis: TXT('#of-navball')?.vis,
    navball: NB(), hud: TXT('#of-hud')?.text?.split('\n').slice(-3).join(' | '),
    message: lv.report ? lv.report.message : '' };
  // What does M do now, on foot?
  window.dispatchEvent(new KeyboardEvent('keydown', { code: mapCode, bubbles: true }));
  await sleep(1.0);
  shot['81-M-on-foot'] = { open: of.map('report').open,
                           text: (TXT('#of-map')?.text ?? '(none)').slice(0, 400) };

  return { valid: true, section: SECTION, log, shot, unloads };
})()
