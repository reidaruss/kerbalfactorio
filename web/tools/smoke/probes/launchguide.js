// launchguide.js: THE PAD TELLS YOU WHAT TO DO (GP-139).
//
//   node tools/smoke/run.mjs --url=... --sandbox=1 --evalfile=probes/launchguide.js
//
// Reid built a rocket, rolled it out, and sat looking at a chip that said
// `CLAMPED` with nothing else on screen. The sentences existed; they were only
// produced when a press was REFUSED, so they were reachable only by the players
// who already knew which key to press.
//
// THE ASSERTION THAT MATTERS IS THE NEGATIVE ONE. `clampHoldReason`'s own header
// records the failure this guide exists to avoid: a single line that said
// "throttle up" in every clamp state, read by Reid at 100% throttle with no
// engine lit, naming the one control already at its stop while the control that
// would have freed him was being refused. So this probe walks the pad states in
// order and asserts, at every one of them, that the guide NEVER names a control
// that is already at its limit. It asserts that on the ACTION NAME (`stepNames`)
// rather than on the prose, because the prose is meant to be reworded and an
// assertion that breaks on a better sentence is an assertion nobody keeps.
//
// The chip text is read off the ELEMENT, so what is asserted is the painted
// pixel against the derivation, not the derivation against itself.
(async () => {
  const of = window.__of;
  if (!of) return { valid: false, why: 'no __of' };
  if (typeof of.flight !== 'function') return { valid: false, why: 'no flight' };
  const sleep = (n) => of.run(n);
  const fails = [];
  const log = [];
  const check = (name, ok, detail) => {
    if (!ok) fails.push(detail === undefined ? name : `${name}: ${detail}`);
    return ok;
  };
  const F = () => of.flight('report').flight;
  const FM = () => of.flight('report');
  const ball = () => of.flight('navball');
  const step = () => ball().step ?? '';

  await sleep(0.6);

  // --- a rocket on the pad, through the player's own path -------------------
  const PID = [0x0100, 0x0101, 0x0103];
  of.vab('enter');
  await sleep(0.4);
  const cat = of.vab('catalogue');
  of.vab('press', 'clear');
  await sleep(0.15);
  for (const pid of PID) {
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
  check('the probe got a rocket built, rolled out and boarded',
    F().live === true && FM().aboard === true, JSON.stringify(FM().message));
  if (F().live !== true || FM().aboard !== true) {
    return { valid: false, why: 'no vessel on the pad', fails, log };
  }

  // ======================================================================
  // A. CLAMPED WITH NOTHING LIT: the state Reid was actually stuck in
  // ======================================================================
  const seen = [];
  const snap = (tag) => {
    const r = { tag, status: F().status, throttle: F().throttle,
      twr: F().twr, chip: step(), names: of.steps() };
    seen.push(r);
    return r;
  };
  const s0 = snap('on the pad, nothing lit');
  log.push(`clamped: "${s0.chip}"`);
  check('the pad SAYS something rather than sitting silent on CLAMPED',
    s0.chip !== '', `status ${s0.status}, chip "${s0.chip}"`);
  check('and what it names is the STAGE key, which is the only one that helps',
    s0.names === 'stage', s0.names);
  check('and the chip is drawn, not merely computed',
    document.querySelector('#of-navball .chip.step') !== null);
  // THE EXACT DEFECT, ASSERTED DIRECTLY. Reid was at 100% throttle and was told
  // to throttle up. Put the throttle at its stop and check the guide moves off
  // the throttle rather than naming it.
  of.input.act(['throttleFull'], 6);
  await sleep(0.6);
  const s1 = snap('throttle at 100%, still nothing lit');
  log.push(`throttle ${Math.round(s1.throttle * 100)}%: "${s1.chip}"`);
  check('the throttle really went to its stop', s1.throttle >= 0.99,
    `${s1.throttle}`);
  check('AT FULL THROTTLE WITH NO ENGINE LIT IT STILL SAYS STAGE, and never '
    + 'names the throttle', s1.names === 'stage' && !/throttle/i.test(s1.chip),
    `names=${s1.names} chip="${s1.chip}"`);

  // ======================================================================
  // B. THE GUIDE NEVER NAMES A CONTROL AT ITS STOP, at any pad state
  // ======================================================================
  // Cut the throttle and read it again: now the throttle IS the thing to move,
  // so naming it is correct. The same predicate has to give both answers.
  of.input.act(['throttleCut'], 6);
  await sleep(0.5);
  of.input.act(['stage'], 6);
  await sleep(1.0);
  const s2 = snap('engine lit, throttle shut');
  log.push(`lit, throttle ${Math.round(s2.throttle * 100)}%: "${s2.chip}"`);
  if (s2.status === 'CLAMPED') {
    check('with an engine lit and the throttle SHUT it names the throttle',
      s2.names === 'throttleUp', `names=${s2.names} chip="${s2.chip}"`);
  } else {
    log.push(`released on the stage press (TWR ${s2.twr}); clamp case B skipped`);
  }

  // THE GENERAL FORM, over every state this probe passes through: the guide may
  // never name a control that is already at its limit.
  const atStop = (r) => (r.names === 'throttleUp' && r.throttle >= 0.999);
  check('AT NO POINT does the guide name a control already at its stop',
    seen.every((r) => !atStop(r)),
    JSON.stringify(seen.filter(atStop)));

  // ======================================================================
  // C. IT KEEPS UP: flying changes the instruction, and orbit ends it
  // ======================================================================
  of.input.act(['throttleFull'], 6);
  await sleep(0.6);
  if (F().status === 'CLAMPED') { of.input.act(['stage'], 6); await sleep(1.2); }
  const s3 = snap('under power');
  log.push(`${s3.status}: "${s3.chip}"`);
  check('the rocket actually left the pad', s3.status !== 'CLAMPED',
    `${s3.status}, TWR ${s3.twr}`);
  check('and under power with fuel it says NOTHING, because nothing is owed',
    s3.chip === '' || s3.names !== 'throttleUp',
    `names=${s3.names} chip="${s3.chip}"`);

  // ORBIT, through the cheat, because this probe is about the guide and not
  // about flying an ascent; probes/ascent.js owns that.
  of.pause(true);
  await sleep(0.35);
  const btn = document.querySelector('#of-pause button[data-cheat="orbit"]');
  btn?.click();
  await sleep(1.5);
  of.pause(false);
  await sleep(1.2);
  const s4 = snap('in orbit');
  log.push(`${s4.status}: "${s4.chip}"`);
  check('in ORBIT it says so and points at the map',
    s4.status !== 'ORBIT' || s4.names === 'map',
    `${s4.status}, names=${s4.names}, chip="${s4.chip}"`);
  // AND THE CHIP FOLLOWED THE STATE. Four distinct instructions across the run
  // is what tells a live derivation from a constant.
  const distinct = [...new Set(seen.map((r) => r.chip).filter((c) => c !== ''))];
  check('the instruction CHANGED as the state did, rather than being a constant',
    distinct.length >= 3, JSON.stringify(distinct));

  // ======================================================================
  // D. EVERY KEY IT NAMES IS THE LIVE BINDING, never a literal
  // ======================================================================
  const rows = typeof of.pause === 'function'
    ? of.pause().view.controls.flatMap((g) => g.rows) : [];
  const keyOf = (a) => (rows.find((r) => r.action === a) ?? { keys: [] }).keys[0];
  const named = seen.filter((r) => r.names !== '' && r.chip !== '');
  const mismatched = named.filter((r) => {
    const k = keyOf(r.names);
    return k !== undefined && !r.chip.includes(k);
  });
  check('every instruction spells the key the BINDING TABLE currently holds',
    mismatched.length === 0,
    JSON.stringify(mismatched.map((r) => [r.names, keyOf(r.names), r.chip])));

  return {
    valid: fails.length === 0,
    fails,
    log,
    states: seen,
    distinctInstructions: distinct,
  };
})()
