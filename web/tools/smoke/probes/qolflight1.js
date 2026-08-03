// qolflight1.js: QUALITY-OF-LIFE SURVEY, part 1. GETTING INTO A ROCKET.
//
// Not a pass/fail probe. It records WHAT THE SCREEN SAYS at each step of the
// walk -> bay -> build -> roll out -> board journey, so the friction can be
// read off drawn text rather than off model state.
(async () => {
  const of = window.__of;
  if (!of) return { valid: false, why: 'no __of' };
  const sleep = (n) => of.run(n);
  const log = [];
  const shot = {};

  // Every drawn string on screen, per panel, with the panel's presence.
  const T = (sel) => {
    const el = document.querySelector(sel);
    if (el === null) return null;
    const r = el.getBoundingClientRect();
    const vis = r.width > 0 && r.height > 0
      && getComputedStyle(el).display !== 'none'
      && getComputedStyle(el).visibility !== 'hidden';
    return { vis, w: Math.round(r.width), h: Math.round(r.height),
             text: (el.innerText ?? el.textContent ?? '').trim() };
  };
  const SCREEN = (label) => {
    const o = { label };
    for (const sel of ['#of-hud', '#of-navball', '#of-map', '#of-vab',
                       '#of-pause']) {
      o[sel] = T(sel);
    }
    // Anything else drawn at the top level that is not the canvas.
    const others = [];
    for (const el of document.body.children) {
      if (el.tagName === 'CANVAS' || el.tagName === 'SCRIPT') continue;
      if (['of-hud', 'of-navball', 'of-map', 'of-vab', 'of-pause'].includes(el.id)) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const t = (el.innerText ?? el.textContent ?? '').trim();
      if (t === '') continue;
      others.push({ tag: el.tagName, id: el.id, cls: el.className,
                    text: t.slice(0, 900) });
    }
    o.others = others;
    shot[label] = o;
    return o;
  };

  await sleep(1.0);
  of.build(0);

  // ===================== 0. SPAWN. WALKING. =============================
  SCREEN('00-spawn');
  log.push('bindings board=' + JSON.stringify(of.input.bindings().board)
    + ' map=' + JSON.stringify(of.input.bindings().map)
    + ' warpUp=' + JSON.stringify(of.input.bindings().warpUp)
    + ' warpDown=' + JSON.stringify(of.input.bindings().warpDown)
    + ' stage=' + JSON.stringify(of.input.bindings().stage)
    + ' recover=' + JSON.stringify(of.input.bindings().recover));
  const g0 = of.goals();
  log.push('goals at spawn: ' + JSON.stringify(g0).slice(0, 800));
  const fr0 = of.flight('report');
  log.push('flight report at spawn: ' + JSON.stringify(fr0).slice(0, 900));

  // Does pressing the BOARD key on foot with no rocket say anything?
  const before = T('#of-hud')?.text ?? '';
  of.input.act(['board'], 4);
  await sleep(0.6);
  const after = T('#of-hud')?.text ?? '';
  log.push('G on foot with no vessel: hud changed=' + (before !== after));
  SCREEN('01-after-G-on-foot');

  // ===================== 1. THE BAY =====================================
  of.vab('enter');
  await sleep(0.8);
  SCREEN('02-bay-empty');
  const cat = of.vab('catalogue');
  log.push('catalogue: ' + JSON.stringify(cat).slice(0, 1200));

  // Build the simplest rocket a first-time player would: pod, tank, engine.
  of.vab('press', 'clear');
  await sleep(0.2);
  for (const pid of [0x0100, 0x0101, 0x0103]) {
    const i = cat.find((c) => c.id === pid)?.index ?? -1;
    if (i < 0) { log.push('no catalogue entry for ' + pid.toString(16)); continue; }
    of.vab('frame');
    of.vab('take', i);
    await sleep(0.15);
    const parts = of.vab('report').parts;
    if (parts.length === 0) { of.vab('place'); await sleep(0.15); continue; }
    let low = parts[0];
    for (const p of parts) if (p.origin[1] < low.origin[1]) low = p;
    const nodes = of.vab('nodes').filter((n) => n.parent === low.handle
      && n.onScreen && (n.kind === 'bottom' || n.kind === 'interstage'));
    if (nodes.length === 0) { log.push('no node under part for ' + pid.toString(16)); continue; }
    of.vab('hover', nodes[0].ndc[0], nodes[0].ndc[1]);
    of.vab('place');
    await sleep(0.15);
  }
  await sleep(0.5);
  SCREEN('03-bay-built');
  const vr = of.vab('report');
  log.push('vab report after build: ' + JSON.stringify(vr).slice(0, 1500));

  if (typeof OF_ARGS !== 'undefined' && OF_ARGS && OF_ARGS.stop === 'bay') return { valid: true, log, shot, stopped: 'bay' };
  // ===================== 2. THE PAD, CLAMPED ============================
  of.vab('leave');
  await sleep(0.8);
  SCREEN('04-left-bay');
  const rr = of.flight('rollout');
  await sleep(1.2);
  SCREEN('05-rolled-out');
  log.push('rollout report: ' + JSON.stringify(rr).slice(0, 900));

  // Walk to it. Record what the screen says about how to board.
  let steps = 0;
  for (let i = 0; i < 20 && of.flight('report').distanceToVesselM > 10; ++i) {
    of.input.act(['forward'], 30);
    await sleep(0.5);
    steps += 1;
  }
  log.push('walked ' + steps + ' bursts to the pad, distance now '
    + of.flight('report').distanceToVesselM);
  SCREEN('06-beside-vessel');

  of.flight('board');
  await sleep(1.0);
  SCREEN('07-aboard-clamped');
  const fr = of.flight('report');
  log.push('flight report aboard/clamped: ' + JSON.stringify(fr).slice(0, 1800));
  log.push('readout aboard/clamped: '
    + JSON.stringify(of.flight('readout')).slice(0, 1200));
  const nb = of.flight('navball');
  log.push('navball report: ' + JSON.stringify(nb).slice(0, 1200));

  return { valid: true, log, shot,
           note: 'survey only; every field is a RECORD of drawn text' };
})()
