// moonarm.js: GP-292. THE MOON IS A DESTINATION, AND THE SCREEN SAYS WHAT IT
// DOES NOT KNOW ABOUT IT.
//
//   node tools/smoke/run.mjs --sandbox=1 --settle=25 \
//        --evalfile=tools/smoke/probes/moonarm.js
//
// R71 and R72 closed and the moon flies from the client, so `AutopilotTargets`
// stopped refusing Cinder. Two things have to be true at once and they are easy
// to conflate, which is why both are asserted separately:
//
//   1. IT ARMS, through `of_ap_arm_body_transfer`, which takes a body id and a
//      capture altitude and will not accept an ephemeris. Physics measured what
//      happens when a body falls through to the ORBIT door: a two-burn
//      rendezvous with the moon centre at 1561.330 m/s against a thing that is
//      200 km of rock, everything running and the answer confidently wrong. So
//      `via` is asserted to be 'body' and not merely non-empty.
//
//   2. IT IS NOT PRICED AGAINST DEPARTURE TIME, AND THE SCREEN SAYS SO.
//      `of_ap_departure_curve` takes nine orbit words and a world cannot be
//      described in them. Leaving at a bad moment has been measured at
//      1720.5216 m/s against 1119.0795 for the same trip at a good one, and
//      BOTH arm and BOTH fly. A blank chart, or a flat one, would look like an
//      answer to the question nobody can answer yet.
//
// THE ANTECEDENT IS ASSERTED FIRST. If the Cinder row were still blocked, or
// the executor missing, every claim below would be about a screen that is not
// there, and the absence would read as a pass.
(async () => {
  const of = window.__of;
  if (!of) return { valid: false, why: 'no __of' };
  const fails = [];
  const log = [];
  const check = (name, ok, detail) => {
    if (!ok) fails.push(detail === undefined ? name : `${name}: ${detail}`);
    return ok;
  };
  const sleep = (n) => of.run(n);
  const FM = () => of.flight('report');
  const F = () => of.flight('report').flight;
  const P = () => of.map('report').planner;
  const R = () => of.map('report').planner.run;
  const pressRow = async (id) => {
    const el = document.querySelector(`#of-map [data-plan="${id}"]`);
    if (el === null) return { landed: false, why: `no row ${id}`, sel: '' };
    el.click();
    await sleep(0.8);
    return { landed: true, sel: P().selectedId, why: '' };
  };
  const pressAct = async (act, settle = 0.8) => {
    const el = document.querySelector(`#of-map [data-plan-act="${act}"]`);
    if (el === null) return { landed: false, why: `no button ${act}` };
    el.click();
    await sleep(settle);
    return { landed: true, disabled: el.disabled === true, why: '' };
  };

  await sleep(0.8);
  of.build(0);
  of.vab('enter');
  await sleep(0.4);
  const cat = of.vab('catalogue');
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
    for (const q of parts) if (q.origin[1] < low.origin[1]) low = q;
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
  of.pause(false);
  await sleep(1.2);
  of.input.act(['stage'], 4);
  await sleep(0.6);
  of.input.act(['throttleCut'], 4);
  await sleep(0.6);
  check('fixture: aboard and in orbit', F().status === 'ORBIT' && FM().aboard,
        `status ${F().status}`);
  if (F().status !== 'ORBIT') return { valid: false, why: 'no orbit', fails };

  const mapCode = (of.input.bindings().map || [])[0];
  window.dispatchEvent(new KeyboardEvent('keydown', { code: mapCode, bubbles: true }));
  await sleep(1.2);

  const r0 = R();
  check('the executor is on this bridge', r0.waitingOn === '', r0.waitingOn);
  if (r0.waitingOn !== '') {
    return { valid: false, why: `no executor: ${r0.waitingOn}`, fails };
  }
  const sel = await pressRow('b:cinder');
  check('the Cinder row selected', sel.sel === 'b:cinder',
        `${sel.sel} ${sel.why}`);

  // (2) FIRST, because this is the state a player reads while DECIDING.
  const band = document.querySelector('#of-map .pverdict')?.textContent ?? '';
  const text = document.querySelector('#of-map')?.textContent ?? '';
  check('Cinder is no longer refused', !/CANNOT PLAN/.test(band), band);
  check('the band says it is flyable but not yet timeable',
        /NOT YET TIMEABLE/.test(band), band);
  check('and the screen says the chart cannot price a world',
        /a world is not an orbit/i.test(text), text.slice(0, 240));
  // THE MEASURED COST OF THE GAP IS ON SCREEN. That is the difference between
  // a gap and a trap: both departures arm and both fly.
  check('and it names what leaving at a bad moment costs',
        /1721/.test(text) && /1119/.test(text),
        'the 600 m/s a player can lose with no signal is not on screen');
  check('no departure chart is drawn for a world',
        document.querySelector('#of-map .pchart') === null,
        'a chart IS drawn, and a flat or empty one looks like an answer');

  // (1) IT ARMS, THROUGH THE BODY DOOR.
  const arm = await pressAct('arm', 1.5);
  check('the arm button is offered for a world', arm.landed, arm.why);
  const r1 = R();
  const via = (r1.lastArm && r1.lastArm.via) || '';
  check('IT TOOK THE BODY DOOR, not the orbit door', via === 'body',
        `via "${via}". The orbit door plans a rendezvous with the moon centre: `
        + '1561.330 m/s against 200 km of rock, and it runs.');
  check('the executor armed a real programme',
        r1.armed === true && r1.programDvMS > 0,
        JSON.stringify({ armed: r1.armed, dv: r1.programDvMS,
                         burns: r1.burnCount }));
  // THREE BURNS: injection, a RESERVED correction the executor fills from the
  // state the injection really produced, and a capture in the moon own frame.
  check('a moon transfer is three burns, and nothing here assumes two',
        r1.burnCount === 3, `${r1.burnCount} burns`);
  check('the executor answered with a sentence', (r1.note ?? '') !== '',
        `note "${r1.note}"`);
  log.push(`armed via ${via}: ${r1.burnCount} burns, `
    + `${Number(r1.programDvMS).toFixed(2)} m/s, note "${r1.note}"`);

  await pressAct('cancel', 0.6);
  check('and it cancels cleanly', !R().armed, JSON.stringify(R()));

  return {
    valid: fails.length === 0,
    fails,
    log,
    via,
    burns: r1.burnCount,
    programDvMS: r1.programDvMS,
    executorNote: r1.note,
    band,
    note: 'arming and pricing are asserted separately because they are '
      + 'different facts: the moon flies end to end and the departure chart '
      + 'still cannot say when to leave',
  };
})()
