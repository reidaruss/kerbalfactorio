// flightabuse.js: DO THE WRONG THINGS (lane G, W11).
//
// `probes/ascent.js` proves the happy path exists. This one proves the demo
// survives a person who has never seen it. Every entry below is something Reid
// can plausibly do in the first two minutes, and the bar is not "it works", it
// is: NOTHING CRASHES, NOTHING HANGS, AND THE PLAYER CAN ALWAYS GET OUT.
//
//   node tools/smoke/run.mjs --url=http://127.0.0.1:5211/ --sandbox=1 --settle=6 \
//        --evalfile=tools/smoke/probes/flightabuse.js
//
// NOTE THE FLAG POSITION: --sandbox=1 is a RUNNER flag; a query string written
// into --url is discarded by run.mjs without a word.
//
// SHAPE. Every abuse records a ROW rather than throwing, so one run reports the
// whole table instead of stopping at the first defect. `recover` is the column
// that matters: after each abuse the probe asks the game to do something normal
// and records whether it still can. A row that breaks nothing but leaves the
// player stuck is still a failed row.
//
// DW-20: section 0 proves the setup and section 1 proves the fixture assembled
// with /core's own delta-v before a single abusive key is pressed.
(async () => {
  const of = window.__of;
  if (!of) return { valid: false, why: 'no __of' };
  if (typeof of.flight !== 'function') return { valid: false, why: 'no __of.flight' };
  if (typeof of.vab !== 'function') return { valid: false, why: 'no __of.vab' };
  const sleep = (n) => of.run(n);
  const F = () => of.flight('report');
  const FL = () => F().flight;
  const fails = [];
  const rows = [];
  const log = [];
  const check = (name, ok, detail) => {
    if (!ok) fails.push(detail === undefined ? name : `${name}: ${detail}`);
    return ok;
  };
  // Every abuse runs inside this. A THROWN error is itself a finding, not a
  // reason to abandon the run, so it is caught and recorded as `threw`.
  const abuse = async (name, fn) => {
    const before = { aboard: F().aboard, parts: FL().parts, live: FL().live };
    let threw = null;
    try { await fn(); } catch (e) { threw = String(e && e.message ? e.message : e); }
    const s = FL();
    const r = F();
    const bad = [];
    if (threw !== null) bad.push(`THREW ${threw}`);
    // The apses are only NUMBERS on a closed conic. An unbound trajectory has
    // an apoapsis of Infinity by definition and that is the correct answer, not
    // a defect, so the finiteness check is gated on `bound` rather than run
    // unconditionally: asserting it everywhere reported nine false positives on
    // a perfectly healthy powered ascent.
    const keys = s.bound ? ['apoapsisM', 'periapsisM', 'altitudeAglM', 'speedMS', 'massKg']
      : ['altitudeAglM', 'speedMS', 'massKg'];
    for (const k of keys) {
      if (typeof s[k] === 'number' && !Number.isFinite(s[k])) bad.push(`${k} is ${s[k]}`);
    }
    const row = {
      name, threw, ok: bad.length === 0, bad,
      before, after: { aboard: r.aboard, parts: s.parts, live: s.live, status: s.status },
      msg: r.message,
    };
    rows.push(row);
    check(`ABUSE ${name}`, bad.length === 0, bad.join('; '));
    return row;
  };

  const PID = {
    CommandPod: 0x0100, TankLiquidSmall: 0x0101, TankLiquidSmallLong: 0x0102,
    EngineLiquidSmall: 0x0103, EngineVacuumSmall: 0x0104,
    DecouplerStackSmall: 0x0106, Parachute: 0x010a, Fin: 0x010b,
  };
  const CORE_DV = 4922.91;

  // ==========================================================================
  // 0. SETUP PROOF.
  // ==========================================================================
  const gm = of.game().mode;
  check('sandbox', (typeof gm === 'string' ? gm : gm && gm.mode) === 'sandbox',
        JSON.stringify(gm));
  check('the loop is ticking', of.world().tick > 0);
  check('the flight lane loaded', F().loaded === true);
  check('the catalogue crossed the bridge', F().catalogue === 24, `${F().catalogue}`);
  if (fails.length > 0) return { valid: false, why: 'setup', fails };

  // ==========================================================================
  // 1. BUILD THE FIXTURE. Same stack ascent.js flies, so the numbers below are
  //    comparable with it and with /core.
  // ==========================================================================
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
  const symBtn = document.querySelector('[data-vab="sym"][data-n="4"]');
  if (symBtn) symBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
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
  check('the fixture assembled with /core\'s delta-v', vr.stats !== undefined
        && Math.abs(vr.stats.totalDeltaV - CORE_DV) <= 0.01,
        `${vr.parts.length} parts, dv ${vr.stats && vr.stats.totalDeltaV}`);
  of.vab('leave');
  await sleep(0.3);
  if (fails.length > 0) return { valid: false, why: 'fixture', fails, rows };

  // ==========================================================================
  // 2. ON THE PAD. The abuses a player commits in the first thirty seconds.
  // ==========================================================================
  of.input.act(['board'], 4);            // roll out
  await sleep(0.6);
  // PH-31. BEFORE anybody boards, the rocket has to BE somewhere on screen.
  // Nothing steps the chase observer until a player is in the seat, so the
  // render position stayed at its constructed zero and the meshes were drawn at
  // the BODY CENTRE, 600 km under the pad, for the whole walk over to them. The
  // rocket appeared out of nowhere at the moment of boarding. Every other
  // reading was correct throughout, because `distanceToVessel` reads the sim.
  const drawn = F().view.drawnEngineM;
  const drawnR = Math.hypot(drawn[0], drawn[1], drawn[2]);
  check('THE ROLLED-OUT ROCKET IS DRAWN WHERE THE PLAYER IS, not at the body '
        + 'centre', drawnR < 2000, `${Math.round(drawnR)} m from the engine origin`);
  check('and the roll-out says it is a stand-in for the launch pad',
        /stand-in/i.test(F().message), F().message);
  for (let i = 0; i < 14 && F().distanceToVesselM > 10; ++i) {
    of.input.act(['forward'], 30); await sleep(0.6);
  }
  of.input.act(['board'], 4);            // climb in
  await sleep(0.35);
  check('aboard for the pad abuses', F().aboard === true, JSON.stringify(F().message));
  const padParts = FL().parts;
  check('the whole vehicle is on the pad', padParts === 11, `${padParts}`);
  // PH-28. A rocket standing on the ground is at zero AGL. It read 19.20 m,
  // exactly twice its own base offset, on every flight this project has flown.
  check('ALT AGL IS ZERO ON THE PAD', Math.abs(FL().altitudeAglM) < 0.5,
        `${FL().altitudeAglM} m`);

  // 2a. THE ONE A PLAYER ACTUALLY DOES: press the stage key on the pad, before
  // touching the throttle, and then keep pressing it. In KSP the first press
  // lights the engine; the ones after it must not throw the rocket away while
  // it is still bolted down, because the vehicle that is left cannot lift and
  // there is no way back to a whole one from inside the cockpit.
  await abuse('stage x4 on the pad with the throttle shut', async () => {
    for (let i = 0; i < 4; ++i) { of.input.act(['stage'], 6); await sleep(0.3); }
  });
  const afterMash = FL();
  check('MASHING STAGE ON THE PAD DID NOT DISMANTLE THE ROCKET',
        afterMash.parts === padParts,
        `${padParts} -> ${afterMash.parts} parts, status ${afterMash.status}`);
  check('and it is still held by the clamp', afterMash.status === 'CLAMPED',
        afterMash.status);
  // AND THE PLAYER WAS TOLD WHY. Every message the session raised used to be
  // cleared in the same frame it was raised (a MET deadline against the loop
  // clock), so the refusal above would have been a silent no-op: the one thing
  // that turns "the game ignored me" into "I have to throttle up first".
  check('and the refusal is ON SCREEN, not just in a counter',
        /clamp/i.test(of.flight('readout').message),
        JSON.stringify(of.flight('readout').message));
  // PH-30 / R11. Aboard means the world save cannot describe the player, so it
  // is refused, counted, and said on the navball. 25 sim seconds is longer than
  // the 20 second autosave cadence, so at least one refusal is not a race.
  await sleep(25);
  const pst = of.game().persist;
  check('THE AUTOSAVE IS REFUSED WHILE STRAPPED IN, and counted',
        pst.saveInhibit !== undefined && pst.saveInhibit.refused > 0,
        JSON.stringify(pst.saveInhibit));
  check('and the navball SAYS SO, read back off the DOM',
        /not saved/i.test(of.flight('navball').warning ?? ''),
        JSON.stringify(of.flight('navball').warning));

  // 2b. Throttle up. With the engine already lit by 2a's first press this is
  // what releases the clamp, so it doubles as the RECOVERY test for 2a: a
  // rocket that cannot leave the pad after the mash is a dead demo.
  await abuse('throttle up after the mash', async () => {
    of.input.act(['throttleFull'], 4); await sleep(1.2);
  });
  const rel = FL();
  check('RECOVERY: the rocket can still leave the pad after the mash',
        rel.status !== 'CLAMPED' && rel.twr > 1,
        `status ${rel.status}, twr ${rel.twr}`);
  log.push(`pad: parts ${padParts} -> ${afterMash.parts}, released at twr ${rel.twr.toFixed(2)}`);

  // ==========================================================================
  // 3. IN THE AIR. Everything below happens while the vehicle is climbing, so
  //    a hang or a freeze shows up as a vehicle that stops moving.
  // ==========================================================================
  await sleep(3);
  const climb0 = FL().altitudeDatumM;

  // 3a. THE MENU KEYS. Escape, the pack, the goals panel and the view toggle,
  // all pressed while strapped in. None of them means anything in a rocket and
  // all of them are one finger away from the keys that do.
  await abuse('Escape while flying', async () => {
    of.input.act(['cancel'], 4); await sleep(0.4);
    of.input.act(['cancel'], 4); await sleep(0.4);
  });
  await abuse('Tab (the pack) while flying', async () => {
    of.input.act(['pack'], 4); await sleep(0.4);
    of.input.act(['pack'], 4); await sleep(0.4);
  });
  await abuse('V (third person) while flying', async () => {
    of.input.act(['view'], 4); await sleep(0.4);
    of.input.act(['view'], 4); await sleep(0.4);
  });
  await abuse('left click (dig) while flying', async () => {
    of.input.act(['use'], 20); await sleep(0.5);
  });

  // 3b. THE ASSEMBLY BAY, MID-FLIGHT. C is the bay key and it is not gated on
  // being on the ground. The bay REPLACES the four render passes, so this is the
  // most violent thing a single key press can do while a rocket is climbing.
  const bayRow = await abuse('open the assembly bay mid-flight (C)', async () => {
    of.input.act(['assembly'], 4); await sleep(0.8);
  });
  bayRow.vabOpen = of.vab('report').open;
  const boardWhileBay = F().boardings;
  await abuse('press G while the bay is open in flight', async () => {
    of.input.act(['board'], 4); await sleep(0.4);
  });
  const bayEscape = await abuse('close the bay again (C) and keep flying', async () => {
    of.input.act(['assembly'], 4); await sleep(0.8);
  });
  bayEscape.vabOpen = of.vab('report').open;
  check('RECOVERY: the bay closes again and the flight is still live',
        of.vab('report').open === false && FL().live === true,
        `vabOpen ${of.vab('report').open}, live ${FL().live}`);
  check('and pressing G in the bay did not eject the pilot',
        F().aboard === true && F().boardings === boardWhileBay,
        `aboard ${F().aboard}`);

  // 3c. GET OUT AT 5 km. The one refusal that has to hold, because a walker
  // dropped at altitude has no parachute and no ground under it.
  const outBefore = F().refusals;
  await abuse('climb out in flight', async () => {
    of.input.act(['board'], 4); await sleep(0.4);
  });
  check('you cannot climb out in flight', F().aboard === true
        && F().refusals > outBefore, `aboard ${F().aboard}`);

  // 3d. FLY IT BACKWARDS. Retrograde during a powered ascent is the fastest way
  // to a tumble, and PH-12/PH-13 say the airframe should survive it.
  await abuse('point RETROGRADE under power during the ascent', async () => {
    of.input.act(['sasMode'], 4); await sleep(0.5);   // CMD -> PRO
    of.input.act(['sasMode'], 4); await sleep(0.5);   // PRO -> RET
    await sleep(4);
  });
  const retro = FL();
  check('retrograde under power did not produce a NaN state',
        Number.isFinite(retro.speedMS) && Number.isFinite(retro.altitudeDatumM),
        `speed ${retro.speedMS}, alt ${retro.altitudeDatumM}`);
  of.input.act(['sasMode'], 4); await sleep(0.4);     // RET -> CMD

  // 3e. WARP THROUGH ITS WHOLE RANGE, up and back down, in the air. The in-air
  // cap is 10x (PH-26) and the point is that a player leaning on the key does
  // not skip the vehicle through the atmosphere.
  await abuse('mash warp up through the whole range in the air', async () => {
    for (let i = 0; i < 8; ++i) { of.input.act(['warpUp'], 4); await sleep(0.2); }
    await sleep(2);
    for (let i = 0; i < 8; ++i) { of.input.act(['warpDown'], 4); await sleep(0.2); }
  });
  const climb1 = FL().altitudeDatumM;
  check('IT IS STILL CLIMBING after every menu key, the bay and the warp mash',
        climb1 > climb0 + 100, `${Math.round(climb0)} -> ${Math.round(climb1)} m`);
  log.push(`in air: alt ${Math.round(climb0)} -> ${Math.round(climb1)} m through ` +
           `${rows.length} abuses`);

  // ==========================================================================
  // 4. RUN IT DRY, ON PURPOSE, POINTING THE WRONG WAY. Retrograde and full
  //    throttle until both stages are empty: it burns the tanks out AND takes
  //    the energy back out of the trajectory, so the vehicle comes down inside
  //    a probe budget instead of coasting to 34,000 km, which is what the first
  //    version of this section actually did and then failed itself for it.
  //    A player WILL run out of fuel, and the honest outcome is a vehicle that
  //    comes down and a pilot who can get out.
  // ==========================================================================
  // ABORT: cut the engine mid-ascent and let it fall back. This is what a
  // player does when the ascent stops making sense, and it is the version of
  // "ran out of fuel" that is actually reachable in a probe budget. Burning the
  // tanks dry pointing retrograde was tried first and is instructive rather
  // than useful: retrograde FLIPS the moment the climb is killed, so SAS then
  // points the nose up and the engine flies the vehicle back out again. It
  // reached 621,978 km. Nothing was broken; the test was.
  of.input.act(['throttleCut'], 4);
  await sleep(0.5);
  const abort = FL();
  log.push(`abort at ${Math.round(abort.altitudeDatumM)} m, ` +
           `apo ${Math.round(abort.apoapsisM)} m, ${Math.round(abort.remainingDvMS)} m/s left`);

  // Try to stage a vehicle mid-coast, then throttle it with nothing selected.
  await abuse('stage repeatedly while coasting', async () => {
    of.input.act(['stage'], 6); await sleep(0.3);
    of.input.act(['stage'], 6); await sleep(0.3);
  });
  await abuse('slam the throttle open and shut while coasting', async () => {
    of.input.act(['throttleFull'], 4); await sleep(0.4);
    of.input.act(['throttleCut'], 4); await sleep(0.4);
  });

  // RIDE IT DOWN AT MAXIMUM WARP AND NEVER TOUCH THE KEY AGAIN. Adversarial on
  // purpose: PH-34 is exactly the bug where the block that crosses the
  // atmosphere ceiling runs at up to 1000x on LAST tick's `inSpace` and takes
  // 33 km of re-entry blind. A player leaning on P and walking away must not be
  // able to skip the vehicle through the atmosphere or through the ground.
  //
  // The assertion is therefore not "it landed" but "it was SEEN in the air on
  // the way down": a skipped re-entry produces a vehicle on the ground with a
  // dynamic pressure history that never happened.
  for (let i = 0; i < 10; ++i) { of.input.act(['warpUp'], 4); await sleep(0.15); }
  const peakWarp = FL().warp;
  let sank = 0, inAirSamples = 0, qSamples = 0, maxQSeen = 0;
  for (let i = 0; i < 900 && FL().status !== 'DOWN'; ++i) {
    const s = FL();
    if (s.altitudeAglM < sank) sank = s.altitudeAglM;
    if (s.altitudeAglM < 60000 && s.altitudeAglM > 0) inAirSamples += 1;
    if (s.qPa > 1000) qSamples += 1;
    if (s.qPa > maxQSeen) maxQSeen = s.qPa;
    await sleep(0.4);
  }
  check('WARP DID NOT DRIVE THE VEHICLE THROUGH THE GROUND', sank > -50,
        `deepest AGL sample ${sank.toFixed(1)} m at warp up to ${peakWarp}x`);
  check('AND THE ATMOSPHERE WAS NOT SKIPPED: the descent was observed inside it',
        inAirSamples >= 5 && qSamples >= 2,
        `${inAirSamples} samples below 60 km, ${qSamples} above 1 kPa, ` +
        `peak ${(maxQSeen / 1000).toFixed(1)} kPa`);
  log.push(`descent at warp ${peakWarp}x: deepest AGL ${sank.toFixed(1)} m, ` +
           `${inAirSamples} samples in air, ${qSamples} above 1 kPa, ` +
           `re-entry q peak ${(maxQSeen / 1000).toFixed(1)} kPa`);
  const down = FL();
  const cameDown = down.status === 'DOWN';
  check('THE ABORTED VEHICLE CAME BACK DOWN inside the probe budget', cameDown,
        `status ${down.status}, alt ${Math.round(down.altitudeDatumM)} m`);
  log.push(`descent: status ${down.status}, agl ${down.altitudeAglM.toFixed(1)} m, ` +
           `peak ${(down.peakAltM / 1000).toFixed(1)} km, ` +
           `speed at rest ${down.speedMS}`);

  // ==========================================================================
  // 5. CAN THE PLAYER ALWAYS GET OUT? The whole point of the file.
  // ==========================================================================
  let gotOut = false;
  if (cameDown) {
    of.input.act(['board'], 4);
    await sleep(0.6);
    gotOut = F().aboard === false;
    check('THE PLAYER GOT OUT after an unpowered arrival', gotOut,
          `aboard ${F().aboard}, msg ${F().message}`);
    check('and the eye came back to the walker',
          of.world().observer.mode !== 'FLIGHT', of.world().observer.mode);
    // And the world is still a world: walk, look, and dig again.
    const p0 = of.world().observer;
    of.input.act(['forward'], 40);
    await sleep(0.8);
    const p1 = of.world().observer;
    const moved = Math.abs(p1.latDeg - p0.latDeg) + Math.abs(p1.lonDeg - p0.lonDeg);
    check('RECOVERY: the walker walks again after a flight', moved > 1e-6,
          `moved ${moved}`);
    // AIM AT THE GROUND FIRST. The disembark leaves the walker looking wherever
    // the flight left him, which was straight up, and a dig ray into the sky
    // correctly hits nothing. Asserting on the tool without aiming it was this
    // file's own bug and it read as a broken dig.
    of.look(of.world().observer.yawDeg, -70);
    await sleep(0.2);
    of.input.act(['use'], 20);
    await sleep(0.6);
    const d = of.dig();
    check('RECOVERY: the left button digs the ground again after a flight',
          d.hit !== null && d.distM > 0, JSON.stringify({ hit: d.hit, dist: d.distM }));
  }

  const st = of.stats();
  return {
    valid: true,
    pass: fails.length === 0,
    fails,
    rows,
    log,
    finalFlight: F(),
    gotOut,
    render: { calls: st.draw.calls, p50: st.frameMs.p50, p95: st.frameMs.p95 },
  };
})()
