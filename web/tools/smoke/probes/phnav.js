// phnav.js: PH-350. THE HAND PILOT'S BLOCK, MEASURED.
//
//   node tools/smoke/run.mjs --sandbox=1 --settle=25 \
//        --evalfile=tools/smoke/probes/phnav.js
//
// Reid's first station mission is hand flown on purpose, so every number a burn
// is judged by has to be on the instrument the burn is flown by. Seven things a
// hand pilot needs were missing or lying; this file measures all of them, and
// every case is written so that it CAN GO RED on the code that was there before
// the change, because a fixture that cannot exhibit the defect proves nothing.
//
// WHAT EACH CASE IS AND WHAT ITS CONTROL IS.
//
//   pad     The degenerate conic. A vehicle standing still has a perfectly well
//           defined orbit straight through the planet's centre, so `PE` read
//           -600.00 km and the guard against it was a list of STATUS WORDS
//           (CLAMPED, DOWN). A status word is the wrong instrument: it cannot
//           know about a vertical climb. Asserted on `periapsisRadiusM`, the
//           physical fact, which is millimetres on the pad.
//
//   ascent  The same defect with the vehicle FLYING, which is the state the
//           status-word guard could never reach. THE CONTROL IS THE SAME FLIGHT
//           LATER: the run must find a sample where the trajectory is
//           subsurface and one where it is not, or the flag is a constant.
//
//   warp    The label lied by up to 100x and was the only thing ever drawn
//           about warp. Asserted against the MEASURED sim advance per wall
//           second, not against either published number, so the assertion is
//           the clock against the claim. THE CONTROL IS LADDER 1x, where the
//           two published numbers must AGREE: a probe that only ever sees them
//           differ cannot tell a correct pair from a hard-coded one.
//
//   node    `dV` read 200.00 m/s at both ends of a burn that moved apoapsis by
//           294 km. The new field must COUNT DOWN while the old one must NOT:
//           both halves are asserted, because a countdown that merely differs
//           from the plan could be anything. THE CONTROL IS A RETROGRADE BURN
//           against the same node, where the remaining figure must go UP. That
//           is the two-sided claim a threshold cannot imitate, and it is the
//           only thing that proves the countdown is measuring the burn rather
//           than the clock.
//
//   target  Range and closing rate existed and were drawn ONLY inside the
//           autopilot's armed block, which the storyline gates behind the
//           mission that needs them. Asserted present on the navball readout
//           with the autopilot UNARMED, and `frozen` is printed rather than
//           asserted, because R92 is ruled: the station's record does not
//           advance and the honest thing is to say so, not to hide it.
(async () => {
  const of = window.__of;
  if (!of) return { valid: false, why: 'no __of' };
  const A = typeof OF_ARGS === 'object' && OF_ARGS !== null ? OF_ARGS : {};
  const fails = [];
  const log = {};
  const check = (name, ok, detail) => {
    if (!ok) fails.push(detail === undefined ? name : `${name}: ${detail}`);
    return ok;
  };
  const sleep = (n) => of.run(n);
  const RD = () => of.flight('readout');
  const FM = () => of.flight('report');
  const F = () => of.flight('report').flight;
  const MAP = () => of.map('report');

  /** Read a field or THROW, naming the keys the object actually has. A probe
   *  that reads a field the client stopped publishing gets undefined, and
   *  undefined === undefined is true: the assertion passes for ever while
   *  asserting nothing. This probe's own first draft read `of.flight('report')`
   *  one level too high and every warp number came back undefined. */
  const must = (o, k, where) => {
    if (o === null || o === undefined || !(k in o)) {
      throw new Error(`${where}: no field '${k}'. has: `
        + `${o === null || o === undefined ? '(nothing)' : Object.keys(o).join(',')}`);
    }
    return o[k];
  };
  const r3 = (v) => (Number.isFinite(v) ? Math.round(v * 1000) / 1000 : v);

  // --- FIXTURE: the reference stack, rolled out, boarded ---------------------
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
  await sleep(0.8);
  if (!FM().aboard) return { valid: false, why: 'never boarded', fails };

  // ============================================================ CASE: pad ===
  {
    const d = RD();
    log.pad = {
      status: d.status, bound: d.bound,
      periapsisM: r3(d.periapsisM), apoapsisM: d.apoapsisM,
      periapsisRadiusM: r3(must(d, 'periapsisRadiusM', 'readout')),
      periapsisMeaningful: must(d, 'periapsisMeaningful', 'readout'),
      timeToApoapsisS: r3(must(d, 'timeToApoapsisS', 'readout')),
      timeToPeriapsisS: r3(must(d, 'timeToPeriapsisS', 'readout')),
      periodS: r3(must(d, 'periodS', 'readout')),
      sasErrDeg: r3(must(d, 'sasErrDeg', 'readout')),
      warpFactor: must(d, 'warpFactor', 'readout'),
      warpEffectiveX: must(d, 'warpEffectiveX', 'readout'),
      warpLimitedBy: must(d, 'warpLimitedBy', 'readout'),
      burn: must(d, 'burn', 'readout'),
      target: must(d, 'target', 'readout'),
    };
    // THE DEFECT ITSELF, on the pad: PE is minus the whole datum radius and the
    // periapsis is millimetres from the body centre.
    check('pad: PE is the degenerate radial conic',
          d.periapsisM < -100000 && log.pad.periapsisRadiusM < 10,
          `PE ${log.pad.periapsisM} m, r_p ${log.pad.periapsisRadiusM} m`);
    check('pad: the new flag calls it what it is',
          log.pad.periapsisMeaningful === false, 'periapsisMeaningful true');
    check('pad: warp is not running', log.pad.warpEffectiveX === 1
          && log.pad.warpLimitedBy === '',
          `${log.pad.warpEffectiveX}x '${log.pad.warpLimitedBy}'`);
    check('pad: no node and no target yet',
          log.pad.burn === null && log.pad.target === null);
  }

  // ========================================================= CASE: ascent ===
  // Fly it for real. The status-word guard covers CLAMPED and DOWN and cannot
  // reach ASCENT, which is where a player spends the whole climb.
  const climb = [];
  {
    of.input.act(['throttleFull'], 2);
    await sleep(0.3);
    of.input.act(['stage'], 4);
    await sleep(0.4);
    // TWENTY SECONDS OF POWERED CLIMB AND NOT ONE MORE. The reference stack
    // carries 34.8 s of burn and the node cases below need two 200 m/s burns
    // out of what is left, so a probe that flew this to flameout would reach
    // its own later assertions on an empty vehicle and report them as failures
    // of the thing being measured.
    for (let i = 0; i < 20; ++i) {
      await sleep(1.0);
      const d = RD();
      climb.push({
        metS: r3(F().metS), status: d.status, bound: d.bound,
        altM: Math.round(d.altitudeDatumM),
        periapsisM: Math.round(d.periapsisM),
        periapsisRadiusM: Math.round(d.periapsisRadiusM),
        meaningful: d.periapsisMeaningful,
        apoapsisM: Math.round(d.apoapsisM),
        tApoS: r3(d.timeToApoapsisS),
        periodS: r3(d.periodS),
        sasErrDeg: r3(d.sasErrDeg),
      });
      if (d.status === 'DOWN') break;
    }
    of.input.act(['throttleCut'], 2);
    await sleep(0.4);
    const flying = climb.filter((c) => c.status !== 'CLAMPED' && c.status !== 'DOWN');
    const badPE = flying.filter((c) => c.bound && c.periapsisM < -100000);
    log.ascent = {
      samples: climb.length, flying: flying.length,
      // THE DEFECT: `bound` is true, the vehicle is flying, and PE draws as
      // hundreds of kilometres of negative altitude.
      subsurfaceWhileFlying: badPE.length,
      worstPE: badPE.length === 0 ? null
        : Math.min(...badPE.map((c) => c.periapsisM)),
      worstStatus: badPE.length === 0 ? '' : badPE[0].status,
      meaningfulFalseWhileFlying:
        flying.filter((c) => c.meaningful === false).length,
      apoapsisClockFinite: flying.filter((c) => Number.isFinite(c.tApoS)
        && c.tApoS > 0).length,
      peakAltM: Math.max(0, ...climb.map((c) => c.altM)),
      first: climb[0] ?? null, last: climb[climb.length - 1] ?? null,
    };
    check('ascent: the vehicle actually flew',
          log.ascent.peakAltM > 5000, `peak ${log.ascent.peakAltM} m`);
    // The defect must be REACHED, or nothing below is a fix.
    check('ascent: PE draws subsurface while flying and bound',
          log.ascent.subsurfaceWhileFlying > 0,
          'never reached the state the fix is about');
    check('ascent: the new flag is false for every one of those',
          log.ascent.meaningfulFalseWhileFlying >= log.ascent.subsurfaceWhileFlying,
          `${log.ascent.meaningfulFalseWhileFlying} vs `
          + `${log.ascent.subsurfaceWhileFlying}`);
    // -1 IS A REAL ANSWER AND NOT A MISSING ONE. A vertical powered climb is a
    // degenerate radial conic that /core reports as unbound (apoapsis 1e308),
    // and an unbound trajectory has no apoapsis to be a time to. The first
    // draft of this probe demanded a positive countdown here and went red on
    // twenty correct samples: the countdown belongs to the ORBIT case below,
    // where there is an apoapsis. What is asserted here is that the field is
    // DEFINED for every sample rather than undefined or NaN.
    check('ascent: the apoapsis clock is defined for every sample',
          climb.every((c) => c.tApoS === -1 || c.tApoS >= 0),
          JSON.stringify(climb.map((c) => c.tApoS).slice(0, 6)));
  }

  // =========================================================== CASE: warp ===
  // The chip said 1000x while the sim ran at 10x, and the chip was the only
  // thing ever drawn. Measured against the CLOCK, not against either claim.
  /**
   * SUB-STEPS PER FIXED TICK, which is what warp IS.
   *
   * THE FIRST DRAFT USED THE WALL CLOCK AND IT IS WORTH KEEPING THE REASON. It
   * measured MET-seconds per `performance.now()` second, and reported 1.635 at
   * ladder 1x and 1445.3 at 1000x: neither is the warp, both are the headless
   * loop's frame rate under two different loads, and their ratio was 884
   * against a true 1000. `of.run()` drives frames as fast as the machine will
   * go, so wall time is not a denominator that means anything here.
   *
   * `steps` is /core's own count of sub-steps taken, and `of.run(n)` advances a
   * FIXED number of ticks (PH-302 found the same thing about `input.act`), so
   * steps divided by ticks is the multiplier with no clock in it at all. The
   * 1x case below is the control that proves the denominator: if `of.run(n)`
   * ever stops meaning `n * TICK_HZ` ticks, that case goes red first.
   */
  const TICK_HZ = 60;
  const rateOf = async (seconds) => {
    const s0 = F().steps;
    const m0 = F().metS;
    await sleep(seconds);
    return { steps: F().steps - s0, metS: r3(F().metS - m0),
             perTick: r3((F().steps - s0) / (seconds * TICK_HZ)) };
  };
  {
    of.pause(true);
    await sleep(0.35);
    document.querySelector('#of-pause button[data-cheat="orbit"]')?.click();
    await sleep(1.5);
    of.pause(false);
    await sleep(1.2);
    log.warpOrbitStatus = F().status;
    // THE CONTROL FOR `periapsisMeaningful`, and it belongs here rather than in
    // the ascent case because a 20 s suborbital hop can never produce it. A
    // flag that is false for every sample this probe ever takes is a constant
    // with a comment, not a flag, so it has to be TRUE somewhere in the same
    // flight before its false readings above mean anything.
    {
      const d = RD();
      log.orbitPE = { status: d.status, bound: d.bound,
                      periapsisM: Math.round(d.periapsisM),
                      periapsisRadiusM: Math.round(d.periapsisRadiusM),
                      meaningful: d.periapsisMeaningful,
                      timeToApoapsisS: r3(d.timeToApoapsisS),
                      timeToPeriapsisS: r3(d.timeToPeriapsisS),
                      periodS: r3(d.periodS) };
      check('control: periapsisMeaningful is TRUE in orbit',
            d.periapsisMeaningful === true, JSON.stringify(log.orbitPE));
      check('control: the three clocks are real in orbit',
            d.periodS > 60 && d.timeToApoapsisS >= 0 && d.timeToPeriapsisS >= 0,
            JSON.stringify(log.orbitPE));
      // AND THEY ARE CLOCKS, which is a different claim from being numbers. A
      // constant would satisfy every assertion above it.
      const t0 = RD().timeToApoapsisS;
      const p0 = RD().periodS;
      await sleep(4.0);
      const t1 = RD().timeToApoapsisS;
      log.orbitClockRun = { tApo0: r3(t0), tApo1: r3(t1),
                            dropped: r3(t0 - t1), periodS: r3(p0) };
      check('control: time to apoapsis actually counts down',
            t1 < t0 - 1 || t1 > t0 + p0 / 2,
            JSON.stringify(log.orbitClockRun));
    }
    // THE CONTROL FIRST, at ladder 1x, where the request and the rate agree.
    // Without it a probe cannot tell a correct pair from a hard-coded one.
    const one = { factor: RD().warpFactor, eff: RD().warpEffectiveX,
                  ...(await rateOf(2.0)) };
    for (let i = 0; i < 6; ++i) { of.input.act(['warpUp'], 2); await sleep(0.25); }
    await sleep(1.0);
    const top = { factor: RD().warpFactor, eff: RD().warpEffectiveX,
                  limitedBy: RD().warpLimitedBy, ...(await rateOf(2.0)),
                  chip: document.querySelector('#of-navball .chip.msg')
                    ?.textContent ?? '' };
    log.warp = { ladder1: one, ladderTop: top };
    check('warp: the control at 1x has request, publication and rate agreeing',
          one.factor === 1 && one.eff === 1
          && Math.abs(one.perTick - 1) < 0.15, JSON.stringify(one));
    check('warp: the ladder actually moved', top.factor > 1,
          `factor ${top.factor}`);
    // The published EFFECTIVE warp must match the measured multiplier; the
    // published REQUEST need not, and when it does not `warpLimitedBy` says so.
    check('warp: the effective figure matches the measured multiplier',
          top.eff > 0 && Math.abs(top.perTick - top.eff) / top.eff < 0.15,
          `eff ${top.eff}x, measured ${top.perTick}x`);
    check('warp: a gap between request and rate is explained',
          top.eff === top.factor || top.limitedBy !== '',
          `${top.factor}x asked, ${top.eff}x running, limitedBy `
          + `'${top.limitedBy}'`);
    for (let i = 0; i < 6; ++i) { of.input.act(['warpDown'], 2); await sleep(0.2); }
    await sleep(0.6);
  }

  // =========================================================== CASE: node ===
  // The node's dV read 200.00 m/s at both ends of a 42-sample burn. The new
  // field must count DOWN while the old one must NOT, and a retrograde burn
  // against the same node must send it UP.
  const flyNode = async (retro) => {
    of.map('clear');
    await sleep(0.3);
    of.map('place');
    await sleep(0.3);
    // PULL THE NODE IN CLOSE, and this is a fixture correction rather than a
    // preference. `place()` puts the node at apoapsis, which on this orbit is
    // up to 16 minutes ahead, and prograde THERE is up to 90 degrees away from
    // prograde HERE. The retrograde control below then reached only 27 degrees
    // of pointing error and proved nothing. Forty seconds of a 1958 s period is
    // 7 degrees of arc, so "retrograde" really is about 180 degrees off.
    {
      const ahead = MAP().burn?.nodeS ?? 0;
      if (ahead > 60) {
        of.map('adjust', { axis: 'time', delta: -(ahead - 40) });
        await sleep(0.3);
      }
    }
    of.map('adjust', { axis: 'prograde', delta: 200 });
    await sleep(0.3);
    // AIM, THEN CONFIRM THE AIM, THEN BURN. Waiting a fixed number of seconds
    // for a 180 degree slew at 20 deg/s is how the first version of this
    // control ended up asserting on a nose that had not finished turning.
    //
    // THE CONTROL DOES NOT TOUCH HOLD-NODE AT ALL, and the first version did.
    // `of.map('hold')` TOGGLES, so pressing it in the control turned hold ON,
    // and `MapNode.frame` then re-wrote the SAS command to the node direction
    // every single frame: the retrograde key landed, the mode changed, and the
    // nose never moved. Measured pointing error 0.06 degrees on a fixture whose
    // entire purpose was to point 180 degrees away. A control whose arming step
    // silently fails is indistinguishable from a control that passed, which is
    // why the achieved angle is asserted below rather than assumed.
    const wantErr = retro ? 150 : 6;
    if (retro) of.input.act(['sasRetrograde'], 2);
    else of.map('hold');
    let aimed = NaN;
    for (let i = 0; i < 40; ++i) {
      await sleep(0.6);
      aimed = MAP().burn?.pointingErrorDeg ?? NaN;
      if (retro ? aimed > wantErr : aimed < wantErr) break;
    }
    const before = { burn: MAP().burn, apoapsisM: Math.round(F().apoapsisM),
                     remainingDvMS: r3(F().remainingDvMS) };
    of.input.act(['throttleFull'], 2);
    await sleep(0.2);
    const trace = [];
    const cap = retro ? 8 : 30;
    let low = 1e9;
    for (let i = 0; i < cap; ++i) {
      await sleep(0.25);
      const b = MAP().burn;
      const rem = b?.remainingDvMS ?? NaN;
      trace.push({ planned: r3(b?.plannedDvMS), remaining: r3(rem),
                   err: r3(b?.pointingErrorDeg),
                   apoapsisM: Math.round(F().apoapsisM) });
      // CUT WHEN THE COUNTDOWN TURNS AROUND, which is exactly what a player
      // does and is a better rule than a fixed threshold.
      //
      // THE THRESHOLD VERSION WAS WRONG AND THE REASON IS A REAL PROPERTY OF
      // THE QUANTITY. `remaining` is |planned - spent| between two vectors, and
      // the node's burn direction is prograde AT THE NODE, which moves while
      // the burn reshapes the orbit. The minimum of that difference is
      // 200*sin(theta) for a few degrees of drift, so it need never pass under
      // 20. A `< 20` cut therefore never fired, the probe burned 601 m/s
      // against a 200 m/s plan, and the trace ended HIGHER than it started
      // while the code under test was behaving perfectly.
      if (!retro && rem < low) low = rem;
      if (!retro && Number.isFinite(rem) && rem > low + 8) break;
    }
    of.input.act(['throttleCut'], 2);
    await sleep(0.4);
    const after = { burn: MAP().burn, apoapsisM: Math.round(F().apoapsisM),
                    remainingDvMS: r3(F().remainingDvMS) };
    const rems = trace.map((t) => t.remaining).filter(Number.isFinite);
    return { before, after, aimedErrDeg: r3(aimed), first: trace[0] ?? null,
             last: trace[trace.length - 1] ?? null, samples: trace.length,
             minRemaining: rems.length === 0 ? NaN : r3(Math.min(...rems)),
             minAt: rems.indexOf(Math.min(...rems)),
             spentMS: MAP().spentMS, wantedMS: MAP().wantedMS, trace };
  };
  {
    const run = await flyNode(false);
    log.node = run;
    const f = run.first, l = run.last;
    check('node: the burn was flown', f !== null && l !== null
          && Math.abs(l.apoapsisM - f.apoapsisM) > 1000,
          `apoapsis ${f?.apoapsisM} -> ${l?.apoapsisM}`);
    // THE OLD NUMBER, asserted to be UNCHANGED. This is what the panel drew.
    check('node: the PLANNED figure does not move (this is the defect)',
          f !== null && l !== null && Math.abs(l.planned - f.planned) < 0.5,
          `planned ${f?.planned} -> ${l?.planned}`);
    // THE NEW ONE, asserted to fall from the plan to something a player would
    // cut on. `minRemaining` and not `last`, because the last sample is one
    // step PAST the turn-around by construction.
    check('node: the REMAINING figure counts down from the plan',
          run.minRemaining < 40 && run.minAt > 0,
          `planned ${f?.planned}, min ${run.minRemaining} at sample `
          + `${run.minAt} of ${run.samples}`);
    check('node: pointing error is published beside it',
          f !== null && Number.isFinite(f.err), `err ${f?.err}`);
  }
  if (A.control !== 0) {
    // THE CONTROL. Same node, nose reversed: the remaining figure must RISE.
    const run = await flyNode(true);
    log.nodeControl = run;
    const f = run.first, l = run.last;
    check('node control: the nose really was pointed away',
          run.aimedErrDeg > 120,
          `pointing error settled at ${run.aimedErrDeg} deg`);
    check('node control: burning away from the node makes remaining RISE',
          f !== null && l !== null && l.remaining > f.remaining + 5,
          `remaining ${f?.remaining} -> ${l?.remaining}`);
  }

  // ========================================================= CASE: target ===
  // R90: range and closing rate with the autopilot NOT armed.
  {
    of.map('clear');
    await sleep(0.3);
    // The map is OPENED for this case only, and only so the DOM half of the
    // question can be asked. The range itself is written whether the map is up
    // or not, which is the point of it living on the ball.
    if (MAP().open !== true) { of.input.act(['map'], 4); await sleep(0.8); }
    const vessels = of.flight('vessels');
    const rows = must(vessels, 'list', "flight('vessels')");
    const me = MAP().planner?.selectedId ?? '';
    log.targetRows = rows.map((r) => ({ id: r.id, name: r.name,
                                        promoted: r.promoted,
                                        clockS: r3(r.clockS),
                                        conic: r.conic }));
    // Pick anything that is not the vessel being flown.
    let picked = null;
    for (const r of rows) {
      if (r.promoted) continue;
      of.map('select', { id: r.id });
      await sleep(0.6);
      if ((MAP().planner?.selectedId ?? '') === `v:${r.id}`) { picked = r; break; }
    }
    await sleep(0.8);
    const d = RD();
    log.target = {
      picked: picked === null ? null : { id: picked.id, name: picked.name },
      selectedId: MAP().planner?.selectedId ?? '',
      autopilotArmed: MAP().planner?.run?.armed ?? null,
      onReadout: d.target,
      // The map's own copy, for the "one computation, two instruments" claim.
      plannerClosing: MAP().planner?.run?.closing ?? null,
      // And the DOM: was anything drawn without the autopilot armed.
      drawnRows: [...document.querySelectorAll('#of-map .row em')]
        .map((e) => e.textContent.trim()),
      priorSelection: me,
    };
    if (log.target.selectedId !== '') {
      check('target: the range reaches the navball readout unarmed',
            d.target !== null && Number.isFinite(d.target.rangeM)
            && d.target.rangeM > 0,
            `target ${JSON.stringify(d.target)}`);
      check('target: the autopilot is NOT armed (that is the whole point)',
            log.target.autopilotArmed !== true,
            `armed ${log.target.autopilotArmed}`);
      check('target: the ball and the map read ONE computation',
            d.target !== null && log.target.plannerClosing !== null
            && Math.abs(d.target.rangeM - log.target.plannerClosing.rangeM) < 1,
            `${d.target?.rangeM} vs ${log.target.plannerClosing?.rangeM}`);
    } else {
      log.target.note = 'nothing selectable: the range case did not run';
    }
  }

  return { valid: true, fails, ok: fails.length === 0, log };
})()
