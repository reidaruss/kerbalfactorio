// phrcskeys.js: PH-301. THE SIX TRANSLATION KEYS, PRESSED FOR REAL.
//
//   node tools/smoke/run.mjs --url=http://127.0.0.1:5207/ --sandbox=1 \
//        --settle=6 --evalfile=tools/smoke/probes/phrcskeys.js
//
// `web/wasm/test/dockrcs.mjs` already proves `of_fl_rcs_translate` moves a
// vehicle. It proves nothing at all about whether a PLAYER can reach it, which
// is the only claim that matters here: R15's reachability rule exists because
// this project has shipped four capabilities that worked and had no caller, and
// `rcsThrustN` itself sat on the RCS block doing half its job for months.
//
// SO EVERY PRESS IS A REAL DOM KEYBOARD EVENT ON THE BOUND CODE, through the
// binding table rather than a literal, and every one is checked against the
// PRESS COUNTER before its effect is believed. A probe that silently stopped
// pressing anything would otherwise report a beautifully stationary rocket.
//
// THE FIXTURE IS THE HARD PART AND IT IS ASSERTED FIRST. A craft with no RCS
// block has `availableN === 0` and every key below does nothing, correctly, and
// the whole file would go green having measured a rocket that was never going
// to move (GP-142). So the build is checked for a block and for monopropellant
// before a single key is pressed.
(async () => {
  const of = window.__of;
  if (!of) return { valid: false, why: 'no __of' };
  for (const k of ['flight', 'vab', 'pause', 'run', 'build']) {
    if (typeof of[k] !== 'function') return { valid: false, why: `no __of.${k}` };
  }
  if (typeof of.input?.act !== 'function') return { valid: false, why: 'no input' };

  const sleep = (n) => of.run(n);
  const fails = [];
  const rows = [];
  const check = (name, ok, detail) => {
    if (ok !== true) fails.push(detail === undefined ? name : `${name}: ${detail}`);
    return ok === true;
  };
  const rec = (name, value, note) => { rows.push({ name, value, note: note ?? '' }); return value; };

  const FM = () => of.flight('report');
  const F = () => of.flight('report').flight;
  const RC = () => of.flight('report').flight.rcs;
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2],
                           a[0] * b[1] - a[1] * b[0]];
  const len = (a) => Math.hypot(a[0], a[1], a[2]);
  const norm = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

  // -------------------------------------------------------------------------
  // THE INSTRUMENT, AND ITS FIRST VERSION WAS WRONG IN TWO WAYS THAT ARE WORTH
  // WRITING DOWN, because both read as enormous confident numbers.
  //
  // (1) A finite difference of POSITION is a VELOCITY, not a delta-v. The first
  //     run reported "2244.87 m/s along the nose" from one second of RCS. That
  //     is the vehicle's orbital speed, and 2244 m/s is not an implausible
  //     magnitude for anything on this screen, which is why it needed the SHAPE
  //     test rather than the size test (PH-158): a thruster producing a third
  //     of a Kerbin orbit per second is not a small error, it is the wrong
  //     quantity.
  //
  // (2) EVEN THE RIGHT QUANTITY IS SWAMPED. The velocity of a 100 km circular
  //     orbit ROTATES at v^2/r, which is 8.65 m/s per second, measured below as
  //     a control. The thruster is worth 0.21 m/s per second. So a delta-v
  //     measured against zero is reading the orbit with the thruster as noise.
  //
  // So the measurement is A/B: the same interval flown TWICE, once coasting and
  // once with the key down, and the difference of the two deltas. Adjacent
  // intervals rotate by very nearly the same amount, so what survives the
  // subtraction is the thruster. The residual is second order and is itself
  // measured, by differencing two coasting intervals.
  //
  // THE VELOCITY IS /core's OWN, NOT A DIFFERENCE. `of.flight('sync')` refits
  // the promoted record's conic from the live state and `railsAt` evaluates it
  // at the same clock, a round trip `orbital::park`/`resume` guarantees is
  // exact. Differencing positions instead would have to divide by `timeS`,
  // which is published rounded to a millisecond: over a 0.2 s window that is a
  // 0.5% error on 2246 m/s, i.e. 11 m/s of instrument noise on a 0.21 m/s
  // effect.
  const meState = () => {
    of.flight('sync');
    const v = of.flight('vessels');
    const me = v.list.find((x) => x.promoted);
    if (me === undefined) return null;
    const r = of.flight('railsAt', { id: me.id, tick: v.tick });
    return { vel: r.vel, pos: r.pos, fwd: norm(me.pose.fwd), rgt: norm(me.pose.right) };
  };
  const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

  /** Fly `sec` seconds with `action` held (or nothing), and return the change
   *  in /core's own velocity over exactly that stretch. */
  // THE HOLD IS COUNTED IN FIXED TICKS, NOT RENDER FRAMES, and that one line is
  // worth the paragraph. `of.run(sec)` renders sec*144.3 frames and advances the
  // sim by sec seconds; `of.input.act(names, n)` holds for n TICKS at 60 Hz. The
  // first version passed sec*144.3 and therefore held every key for 2.4x its own
  // leg, so each key was still firing through the NEXT case's baseline leg. The
  // signature was perfect and unmistakable once the monopropellant was read:
  // every case burned exactly 0.4249 kg (one second, not half), and the six
  // readings alternated 0.107, 0.214, 0.107, 0.214 whatever the axis, which is
  // (fired - contaminated baseline) = 2x the true effect on every second case.
  const leg = async (action, sec) => {
    const a = meState();
    if (action !== null) of.input.act([action], Math.round(sec * 60));
    await sleep(sec);
    const b = meState();
    if (a === null || b === null) return null;
    return { dv: sub3(b.vel, a.vel), basis: a, mono: RC().monopropKg };
  };

  // --- FIXTURE: a rocket WITH an RCS block and a monoprop tank, in orbit -----
  await sleep(0.8);
  of.build(0);
  of.vab('enter');
  await sleep(0.4);
  const cat = of.vab('catalogue');
  rec('catalogue size', cat.length);
  of.vab('press', 'clear');
  await sleep(0.15);

  // Pod, tank, engine on the stack; then the monoprop tank and the RCS block.
  // The block is RADIAL, so it goes onto the pod's side rather than a node.
  const idx = (id) => cat.find((c) => c.id === id)?.index ?? -1;
  const stack = [0x0100, 0x0101, 0x0111, 0x0103];   // pod, tank, monoprop, engine
  for (const pid of stack) {
    const i = idx(pid);
    if (i < 0) { rec(`catalogue is missing part ${pid.toString(16)}`, true); continue; }
    of.vab('frame');
    of.vab('take', i);
    await sleep(0.12);
    const parts = of.vab('report').parts;
    if (parts.length === 0) { of.vab('place'); await sleep(0.15); continue; }
    let low = parts[0];
    for (const p of parts) if (p.origin[1] < low.origin[1]) low = p;
    const nodes = of.vab('nodes').filter((n) => n.parent === low.handle
      && n.onScreen && (n.kind === 'bottom' || n.kind === 'interstage'));
    if (nodes.length === 0) { rec(`no free bottom node under part ${pid.toString(16)}`, true); continue; }
    of.vab('hover', nodes[0].ndc[0], nodes[0].ndc[1]);
    of.vab('place');
    await sleep(0.15);
  }
  // The RCS block, radially, onto whatever surface node is offered.
  {
    const i = idx(0x0110);
    of.vab('frame');
    of.vab('take', i);
    await sleep(0.15);
    const radial = of.vab('nodes').filter((n) => n.onScreen && n.kind === 'radial');
    rec('radial nodes offered for the RCS block', radial.length);
    if (radial.length > 0) {
      of.vab('hover', radial[0].ndc[0], radial[0].ndc[1]);
      of.vab('place');
      await sleep(0.2);
    }
  }
  const built = of.vab('report').parts.map((p) => p.partId ?? p.def);
  rec('built part ids', built);
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
  document.querySelector('#of-pause button[data-cheat="fuel"]')?.click();
  await sleep(0.5);
  of.pause(false);
  await sleep(1.2);

  check('fixture: aboard and in orbit', F().status === 'ORBIT' && FM().aboard,
        `status ${F().status} aboard ${FM().aboard}`);
  if (F().status !== 'ORBIT') return { valid: false, why: 'no orbit', fails, rows };

  const r0 = RC();
  rec('rcs row on the flight report', r0);
  check('fixture: the report publishes an RCS row at all', r0 !== undefined
        && r0 !== null, JSON.stringify(r0));
  if (r0 === undefined || r0 === null) return { valid: false, why: 'no rcs row', fails, rows };
  check('fixture: THE CRAFT HAS RCS THRUST. Without this every key below does '
        + 'nothing, correctly, and this file would pass having measured a '
        + 'rocket that was never going to move',
        r0.availableN > 0, `availableN ${r0.availableN}`);
  check('fixture: and monopropellant to spend', r0.monopropKg > 0,
        `${r0.monopropKg} kg`);
  if (!(r0.availableN > 0)) return { valid: false, why: 'no rcs hardware', fails, rows };

  // --- THE KEYS ARE BOUND AND THE BINDINGS ARE WHAT THE SCREEN SAYS ---------
  const bind = of.input.bindings();
  const names = ['rcsFore', 'rcsAft', 'rcsLeft', 'rcsRight', 'rcsUp', 'rcsDown'];
  const codes = {};
  for (const n of names) codes[n] = (bind[n] ?? [])[0] ?? null;
  rec('bound codes', codes);
  check('all six RCS actions are bound to a real code',
        names.every((n) => typeof codes[n] === 'string'), JSON.stringify(codes));

  // --- THE NAVBALL DRAWS THE RCS, so a player can see the tank ---------------
  const navRcs = of.flight('navball');
  const domLeft = document.querySelector('#of-navball .of-nread.left');
  const domText = domLeft === null ? '' : (domLeft.textContent ?? '');
  rec('navball left column text', domText.replace(/\s+/g, ' ').trim());
  check('the navball DRAWS an RCS row, so the monopropellant is visible',
        /RCS/.test(domText), domText.slice(0, 200));

  // --- ONE AXIS AT A TIME, A/B AGAINST A COASTING LEG -----------------------
  //
  // The claim is not "it moved": a rocket in orbit is always moving, and its
  // velocity vector rotates 8.65 m/s every second while doing so. The claim is
  // that the velocity gained a component along the axis the KEY names, in the
  // VESSEL frame, over and above what the same stretch of coasting produced.
  // THE LEG IS SHORT ON PURPOSE, AND THE ARITHMETIC SAYS WHY. Over a leg of T
  // seconds the coasting velocity turns by about v*w*T (28.8 m/s at T = 4) and
  // two ADJACENT legs differ by about v*w^2*T^2, which is the floor of the A/B
  // subtraction. The thruster is worth (T/m)*T. So the signal-to-floor ratio is
  // (T/m) / (v*w^2*T), i.e. it gets WORSE the longer the leg: 2.3 at T = 4 and
  // 9 at T = 1. The first version of this section used 4 s and could not
  // separate a push from the orbit; it is 1 s because the algebra says so.
  // 0.5 s, not 1 s and not 4: the ratio is 9.2/T, so halving the leg halves the
  // signal and QUARTERS the floor. Measured: floor 0.060 m/s at T = 1 against a
  // 0.107 m/s effect, which is a 1.8x margin and not evidence of anything.
  const LEG_S = 0.5;

  // THE COAST BASELINE, MEASURED TWICE, so the residual of the subtraction is a
  // number in this report and not an assumption. Two adjacent coasting legs
  // differ only by the second-order change in the rotation rate.
  // The floor, measured the SAME WAY the effect is: one coasting leg against
  // the coasting leg before it. A floor computed differently from the signal is
  // not a floor, it is a second experiment.
  const coastA = await leg(null, LEG_S);
  const coastB = await leg(null, LEG_S);
  const residual = coastA === null || coastB === null ? null
    : len(sub3(coastB.dv, coastA.dv));
  rec('a coasting leg changes the velocity by (m/s)',
      coastA === null ? null : len(coastA.dv),
      'this is the orbit turning, and it is 40x the thruster');
  rec('CONTROL: two coasting legs differ by (m/s)', residual,
      'the floor of the A/B instrument; every reading below must beat it');
  check('CONTROL: the A/B subtraction has a floor well under the effect',
        residual !== null && residual < 0.03, `${residual} m/s`);

  const CASES = [
    ['rcsRight', 'rgt', 1], ['rcsLeft', 'rgt', -1],
    ['rcsUp', 'up', 1], ['rcsDown', 'up', -1],
    ['rcsFore', 'fwd', 1], ['rcsAft', 'fwd', -1],
  ];
  const results = [];
  for (const [action, axisName, sign] of CASES) {
    // THE BASELINE IS THE LEG IMMEDIATELY BEFORE, AND ONLY THAT ONE.
    //
    // A coast-fire-coast mean was tried and is WORSE, which is worth recording
    // because it looks better: the trailing leg is flown on the orbit the burn
    // just changed, so averaging it in subtracts part of the effect. It showed
    // as a perfect alternation, every first-of-pair reading 0.107 and every
    // second 0.150 whatever the axis, which is the signature of a bias in the
    // baseline rather than anything about the thrusters.
    const pre = await leg(null, LEG_S);
    const fired = await leg(action, LEG_S);
    if (pre === null || fired === null) { rec(`${action}: no state`, null); continue; }
    const effect = sub3(fired.dv, pre.dv);
    const b = fired.basis;
    const axis = axisName === 'fwd' ? b.fwd
      : axisName === 'rgt' ? b.rgt : cross(b.fwd, b.rgt);
    const along = dot(effect, axis) * sign;
    const off = Math.sqrt(Math.max(0, len(effect) ** 2 - dot(effect, axis) ** 2));
    const rcsNow = RC();
    results.push({ action, along, offAxis: off, effectMag: len(effect),
                   burnedKg: Math.round((pre.mono - fired.mono) * 1e6) / 1e6,
                   deliveredN: rcsNow.deliveredN, monopropKg: rcsNow.monopropKg });
    rec(`${action}: dv along ${axisName} (m/s)`, along);
    // 1000 N on this vehicle for half a second is about 0.106 m/s. Half of that
    // still clears the floor several times over and still fails a dead key.
    check(`${action} pushes the vehicle the way it says`,
          Number.isFinite(along) && along > 0.05,
          `${along} m/s along ${axisName} (sign ${sign}), off-axis ${off}`);
    check(`${action} pushes ALONG that axis and not across it`,
          Number.isFinite(off) && off < 0.5 * Math.abs(along),
          `along ${along} off-axis ${off}`);
  }
  rec('per-axis results', results);
  // EVERY CASE MUST HAVE FIRED FOR THE SAME LENGTH OF TIME, or the six numbers
  // are not comparable and the pairwise assertion below means nothing. The
  // currency is monopropellant, which is what the thruster actually spends.
  const burns = results.map((r) => r.burnedKg);
  const spread = Math.max(...burns) - Math.min(...burns);
  rec('monopropellant spent per case (kg)', burns);
  check('every case fired for the same length of time', spread < 0.02,
        `spread ${spread} over ${JSON.stringify(burns)}`);
  // T/(Isp g0) * LEG_S = 1000 / (240 * 9.80665) * 0.5 = 0.21244 kg.
  check('and that length is the leg, priced at T/(Isp g0)',
        Math.abs(burns[0] - 0.21244) < 0.02, `${burns[0]} kg`);

  const byName = Object.fromEntries(results.map((r) => [r.action, r.along]));
  // TWO-SIDED, and it is the assertion a sign error in the basis cannot pass:
  // the magnitudes must agree while the raw projections point opposite ways.
  for (const [a, b] of [['rcsRight', 'rcsLeft'], ['rcsUp', 'rcsDown'],
                        ['rcsFore', 'rcsAft']]) {
    const m = Math.abs(byName[a] - byName[b]);
    rec(`${a} and ${b} agree in magnitude to (m/s)`, m);
    check(`${a} and ${b} are the same push in opposite directions`,
          Number.isFinite(m) && m < 0.04, `${byName[a]} vs ${byName[b]}`);
  }

  // --- THE REFUSAL: a dry tank stops the keys and says why ------------------
  //
  // Provoked by SPENDING the monopropellant rather than by writing a zero, so
  // the state under test is one the game itself produces. 240 kg at
  // T/(Isp g0) = 0.4249 kg/s is 565 seconds of firing, so it is done UNDER
  // WARP: the thrusters bill per TICK and warp is more ticks per frame, which
  // is the same property that makes the capture test have to live in the step.
  // THE WARP PRESSES NEED A GAP BETWEEN THEM. `warpUp` is EDGE detected, so six
  // presses inside one another's hold window are one press: the first run of
  // this section asked for six steps and got warp 2.
  for (let i = 0; i < 5; ++i) { of.input.act(['warpUp'], 3); await sleep(0.35); }
  rec('warp used to drain the tank', F().warp);
  check('the warp ladder actually stepped up', F().warp >= 200, `warp ${F().warp}`);
  let guard = 0;
  while (RC().monopropKg > 0 && guard < 30) {
    of.input.act(['rcsFore'], 200);
    await sleep(1.2);
    guard += 1;
  }
  for (let i = 0; i < 8; ++i) { of.input.act(['warpDown'], 3); await sleep(0.3); }
  const dry = RC();
  rec('after spending the tank', dry);
  rec('hold cycles to empty the tank', guard);
  check('the tank can actually be emptied by flying', dry.monopropKg === 0,
        `${dry.monopropKg} kg after ${guard} cycles`);
  if (dry.monopropKg === 0) {
    const base = await leg(null, LEG_S);
    const fired = await leg('rcsFore', LEG_S);
    const effect = base === null || fired === null ? null
      : sub3(fired.dv, base.dv);
    const along = effect === null ? NaN : dot(effect, fired.basis.fwd);
    rec('dv along the nose with an empty tank (m/s)', along);
    check('REFUSAL: an empty tank pushes nothing',
          Number.isFinite(along) && Math.abs(along) < 0.05, `${along} m/s`);
    check('and the delivered thrust is zero while the command is not',
          RC().deliveredN === 0, `delivered ${RC().deliveredN}`);
    const dom = document.querySelector('#of-navball .of-nread.left');
    rec('navball RCS cell with a dry tank',
        (dom?.textContent ?? '').replace(/s+/g, ' ').trim());
    check('and the navball says DRY rather than drawing a zero',
          /DRY/.test(dom?.textContent ?? ''), (dom?.textContent ?? '').slice(0, 200));
  }

  check('POSITIVE CONTROL: the run reached the end of the file', true);
  return { valid: true, reachedEnd: true, fails, failCount: fails.length, rows,
           summary: { byName, dry, residual } };
})()
