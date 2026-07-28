// GP-73 / GP-74. THE STAGE KEY ON THE PAD, AND THE WAY OUT.
//
// ONE PROBE, TWO REQUIREMENTS THAT PULL IN OPPOSITE DIRECTIONS, which is the
// whole reason it is one file. PH-29 refuses a second stage press while the
// clamp holds, because the first press lights the engine and the second throws
// the booster away until nothing left can lift. Reid's playtest found the case
// that rule cannot survive: a rocket whose FIRST STAGE IS EMPTY, where the only
// key that frees the vehicle is the key PH-29 refuses. A fix that only proved
// the second would re-break the first, so both are asserted here, in one run,
// on two vehicles built by the same code.
//
//   A. PH-29'S OWN CASE, held. The 11-part reference vehicle, throttle SHUT,
//      FOUR stage presses. Parts must NOT fall (PH-29 measured 11 -> 4), and
//      the vehicle must still FLY afterwards, which is the stronger claim: a
//      part count that held would also hold on a build where staging had simply
//      been disabled, and "it released and left the ground" would not.
//   B. THE DEADLOCK, broken. Pod / tank / engine / DECOUPLER, a joint GP-32
//      explicitly permits, whose burn 0 autostage fills with the decoupler and
//      no engine at all. Throttle 100%, two presses, and it must release and
//      climb. The DIAGNOSIS is asserted too (burn 0: 0 engines, 0 N) so a
//      future change that stopped producing an empty burn would fail here
//      loudly rather than making the interesting half of this file vacuous.
//   C. THE RECOVERY (GP-74), with its refusals. Nothing to recover refuses;
//      recovering out of a MOVING vessel refuses; recovering off the pad works,
//      leaves the design in the bay, and credits NOTHING to the pack.
//
// MODE: SANDBOX, so the parts are free and the run is about the mechanism. The
// pack assertion in C is still not vacuous in sandbox and that is the point: a
// recovery that wrongly refunded would make the pack RISE, and sandbox charges
// nothing, so any rise at all is the bug.
(async () => {
  const of = window.__of;
  if (!of) return { valid: false, why: 'no __of' };
  if (typeof of.flight !== 'function' || typeof of.vab !== 'function') {
    return { valid: false, why: 'no flight or vab' };
  }
  const sleep = (n) => of.run(n);
  const fails = [];
  const log = [];
  const check = (name, ok, detail) => {
    if (!ok) fails.push(detail === undefined ? name : `${name}: ${detail}`);
    return ok;
  };
  const F = () => of.flight('report');
  const FL = () => F().flight;
  const r2 = (v) => +Number(v).toFixed(2);
  /** The pack as one comparable string, so a mint of any item shows up. */
  const pack = () => JSON.stringify((of.game().carried ?? [])
    .map((c) => [c.item, c.count]).sort((a, b) => a[0] - b[0]));

  await sleep(1.0);
  check('this run is SANDBOX', of.game().mode.sandbox === true,
    JSON.stringify(of.game().mode));

  const PID = {
    CommandPod: 0x0100, TankLiquidSmall: 0x0101, TankLiquidSmallLong: 0x0102,
    EngineLiquidSmall: 0x0103, EngineVacuumSmall: 0x0104,
    DecouplerStackSmall: 0x0106, Parachute: 0x010a, Fin: 0x010b,
  };
  const cat0 = () => of.vab('catalogue');

  /** Build a stack from the top down, each part on the LOWEST free bottom or
   *  interstage node. The same routine probes/ascent.js and probes/flyto.js
   *  use, so the fixture here IS their fixture and not one invented for this. */
  const stack = async (ids) => {
    of.vab('enter');
    await sleep(0.3);
    const cat = cat0();
    const idxOf = (id) => { const r = cat.find((c) => c.id === id); return r ? r.index : -1; };
    of.vab('press', 'clear');
    await sleep(0.2);
    for (const pid of ids) {
      const i = idxOf(pid);
      if (i < 0) { log.push(`part 0x${pid.toString(16)} not offered`); continue; }
      of.vab('frame'); of.vab('take', i);
      await sleep(0.1);
      const parts = of.vab('report').parts;
      if (parts.length === 0) { of.vab('place'); } else {
        let low = parts[0];
        for (const p of parts) if (p.origin[1] < low.origin[1]) low = p;
        const n = of.vab('nodes').filter((q) => q.parent === low.handle && q.onScreen
          && (q.kind === 'bottom' || q.kind === 'interstage'));
        if (n.length === 0) { log.push(`no node under 0x${pid.toString(16)}`); continue; }
        of.vab('hover', n[0].ndc[0], n[0].ndc[1]);
        of.vab('place');
      }
      await sleep(0.12);
    }
    return idxOf;
  };

  /** Roll out on the R12 stand-in ground, walk to it and climb in. No launch
   *  pad, deliberately: the clamp rule is a property of the SESSION and works
   *  the same on a pad, so building 36 foundations first would only make this
   *  file slower and give it a second thing to fail for. */
  const boardIt = async () => {
    of.input.act(['board'], 4);
    await sleep(0.5);
    for (let i = 0; i < 16 && F().distanceToVesselM > 10; ++i) {
      of.input.act(['forward'], 30);
      await sleep(0.6);
    }
    of.input.act(['board'], 4);
    await sleep(0.4);
    return F().aboard === true;
  };

  // ======================================================================
  // C0. NOTHING TO RECOVER, before anything exists. The refusal that proves
  //     the verb is not simply returning true.
  // ======================================================================
  const none = of.flight('recover');
  check('recovering nothing is REFUSED', none.ok === false, JSON.stringify(none.ok));
  check('and it says why', /nothing to recover/.test(none.report.message),
    none.report.message);

  // ======================================================================
  // A. PH-29'S CASE. The 11-part reference vehicle, throttle SHUT, four
  //    presses. This is the half the fix must not break.
  // ======================================================================
  const idxOf = await stack([PID.CommandPod, PID.Parachute, PID.TankLiquidSmall,
    PID.EngineVacuumSmall, PID.DecouplerStackSmall, PID.TankLiquidSmallLong,
    PID.EngineLiquidSmall]);
  {
    const sym = document.querySelector('[data-vab="sym"][data-n="4"]');
    if (sym) sym.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await sleep(0.1);
    of.vab('frame'); of.vab('take', idxOf(PID.Fin));
    await sleep(0.1);
    const parts = of.vab('report').parts;
    const tank = parts.find((p) => p.partId === PID.TankLiquidSmallLong);
    const rad = of.vab('nodes').filter((n) => n.kind === 'radial' && n.onScreen
      && (tank === undefined || n.parent === tank.handle));
    if (rad.length > 0) { of.vab('hover', rad[0].ndc[0], rad[0].ndc[1]); of.vab('place'); }
    await sleep(0.2);
  }
  of.vab('drop');
  const refDesign = of.vab('report');
  check('the reference vehicle is the 11-part fixture PH-29 measured',
    refDesign.parts.length === 11, refDesign.parts.length);
  const refStages = refDesign.stages.map((s) => ({
    i: s.index, engines: s.engines, thrustVacN: Math.round(s.thrustVacuumN),
    twr: +s.twr.toFixed(4),
  }));
  log.push(`reference stages: ${JSON.stringify(refStages)}`);
  check('its burn 0 DOES hold an engine, which is what makes it the control',
    (refDesign.stages[0]?.engines ?? 0) > 0
      && (refDesign.stages[0]?.thrustVacuumN ?? 0) > 0,
    JSON.stringify(refStages[0]));
  of.vab('leave');
  await sleep(0.3);

  const packBefore = pack();
  if (!(await boardIt())) return { valid: false, fails, log, why: 'never boarded (A)' };
  of.input.act(['throttleCut'], 4);
  await sleep(0.3);
  const a0 = FL();
  check('A: on the pad, clamped, throttle shut', a0.status === 'CLAMPED'
    && a0.throttle === 0, `${a0.status} thr ${a0.throttle}`);
  const partsA0 = a0.parts;
  check('A: 11 parts are aboard', partsA0 === 11, partsA0);

  const messages = [];
  for (let i = 0; i < 4; ++i) {
    of.input.act(['stage'], 6);
    await sleep(0.4);
    messages.push(FL().message);
  }
  const a1 = FL();
  log.push(`A: after 4 presses -> parts ${a1.parts}, stagings ${a1.stagings}, `
    + `status ${a1.status}`);
  log.push(`A: messages ${JSON.stringify(messages)}`);
  check('A: PH-29 HOLDS, the rocket was NOT stripped (it went 11 -> 4)',
    a1.parts === partsA0, `${partsA0} -> ${a1.parts}`);
  check('A: exactly ONE press got through', a1.stagings === 1, a1.stagings);
  check('A: the clamp is still holding', a1.status === 'CLAMPED', a1.status);
  check('A: presses 2 to 4 were refused BY NAME',
    /do not stage again/.test(messages[3] ?? ''), messages[3]);

  // THE STRONGER HALF: it still flies. A build that had simply disabled staging
  // would pass every assertion above and fail this one.
  of.input.act(['throttleFull'], 6);
  await sleep(1.6);
  const a2 = FL();
  log.push(`A: after full throttle -> ${a2.status}, releases ${F().clampReleases}, `
    + `twr ${r2(a2.twr)}`);
  check('A: and after four presses it STILL LIFTS', a2.status !== 'CLAMPED'
    && F().clampReleases === 1, `${a2.status} / ${F().clampReleases}`);
  check('A: because TWR crossed 1', a2.twr >= 1.0, a2.twr);

  // ======================================================================
  // C1. THE MOVING REFUSAL. Recovering out of a climbing rocket must not work,
  //     and it must not work for the SAME reason getting out does not: this
  //     verb goes through `disembark` rather than around it.
  // ======================================================================
  await sleep(2.0);
  const climb = FL();
  log.push(`C1: agl ${r2(climb.altitudeAglM)} m, speed ${r2(climb.speedMS)} m/s`);
  const moving = of.flight('recover');
  check('C1: recovering a MOVING vessel is refused', moving.ok === false
    && moving.report.flight.live === true, JSON.stringify(moving.ok));
  check('C1: and the refusal is the one that already existed',
    /cannot get out in flight/.test(moving.report.message), moving.report.message);
  check('C1: nothing was recovered', moving.report.recoveries === 0,
    moving.report.recoveries);

  // Cut and let it come back down, so the recovery can be asserted on a vessel
  // that is genuinely at rest rather than on one this probe teleported.
  of.input.act(['throttleCut'], 6);
  for (let i = 0; i < 40 && FL().status !== 'DOWN'; ++i) await sleep(1.0);
  const down = FL();
  log.push(`C2: ${down.status} at agl ${r2(down.altitudeAglM)}, `
    + `peak ${r2(down.peakAltM)} m`);
  check('C2: it flew and came back down', down.status === 'DOWN'
    && down.liftedOff === true, `${down.status} lifted ${down.liftedOff}`);

  // ======================================================================
  // C2. THE RECOVERY ITSELF.
  // ======================================================================
  const got = of.flight('recover');
  log.push(`C2: recover -> ${JSON.stringify({ ok: got.ok,
    msg: got.report.message, live: got.report.flight.live })}`);
  check('C2: the vessel was recovered', got.ok === true, JSON.stringify(got.ok));
  check('C2: nothing is in the world any more', got.report.flight.live === false
    && got.report.aboard === false,
    `live ${got.report.flight.live} aboard ${got.report.aboard}`);
  check('C2: it counted', got.report.recoveries === 1, got.report.recoveries);
  check('C2: THE PACK IS UNTOUCHED, no refund was minted',
    pack() === packBefore, `${packBefore} -> ${pack()}`);
  const kept = of.vab('report');
  check('C2: and the DESIGN survived, which is what makes it a revert',
    kept.parts.length === 11, kept.parts.length);
  check('C2: a second recover is refused', of.flight('recover').ok === false);

  // ======================================================================
  // B. THE DEADLOCK. A decoupler under the engine bell (GP-32), so autostage
  //    fills burn 0 with a decoupler and no engine.
  // ======================================================================
  await stack([PID.CommandPod, PID.TankLiquidSmall, PID.EngineLiquidSmall,
    PID.DecouplerStackSmall]);
  of.vab('drop');
  const bad = of.vab('report');
  const badStages = bad.stages.map((s) => ({
    i: s.index, engines: s.engines, parts: s.partCount,
    thrustVacN: Math.round(s.thrustVacuumN), dv: +s.deltaVVacuumMS.toFixed(2),
    twr: +s.twr.toFixed(4),
  }));
  log.push(`B: stages ${JSON.stringify(badStages)}, handStaged ${bad.handStaged}`);
  check('B: the design is the four-part stack', bad.parts.length === 4,
    bad.parts.length);
  // THE DIAGNOSIS, asserted. If this ever stops being true the deadlock has
  // been fixed somewhere else and the rest of section B proves nothing.
  check('B: autostage EMITS AN EMPTY BURN 0 from this legal joint',
    (bad.stages[0]?.engines ?? -1) === 0 && (bad.stages[0]?.thrustVacuumN ?? -1) === 0,
    JSON.stringify(badStages[0]));
  check('B: and it did so with NO hand staging, so this is autostage itself',
    bad.handStaged === false, bad.handStaged);
  check('B: burn 1 holds the engine and could lift on its own',
    (bad.stages[1]?.engines ?? 0) > 0 && (bad.stages[1]?.twr ?? 0) > 1,
    JSON.stringify(badStages[1]));
  of.vab('leave');
  await sleep(0.3);

  // `FlightSession.releases` is CUMULATIVE over the session and is deliberately
  // not reset by a roll-out, so B asserts the DELTA. Taken before boarding, not
  // after, so a release this probe did not ask for would still be caught.
  const relBeforeB = F().clampReleases;
  if (!(await boardIt())) return { valid: false, fails, log, why: 'never boarded (B)' };
  of.input.act(['throttleFull'], 6);
  await sleep(0.8);
  const b0 = FL();
  log.push(`B: throttle ${b0.throttle}, twr ${r2(b0.twr)}, "${b0.message}"`);
  check('B: THIS IS REID\'S STATE: full throttle, TWR 0, still clamped',
    b0.status === 'CLAMPED' && b0.throttle >= 0.99 && b0.twr === 0,
    `${b0.status} thr ${b0.throttle} twr ${b0.twr}`);
  check('B: and the hold message no longer says "throttle up" at 100% throttle',
    !/throttle up/.test(b0.message), b0.message);

  of.input.act(['stage'], 6);
  await sleep(0.6);
  const b1 = FL();
  log.push(`B: after press 1 -> ${b1.status}, stagings ${b1.stagings}, `
    + `"${b1.message}"`);
  check('B: press 1 fires the empty burn and the clamp still holds',
    b1.status === 'CLAMPED' && b1.stagings === 1,
    `${b1.status} / ${b1.stagings}`);
  check('B: and the message now SAYS the stage is empty and to stage again',
    /has no engine, stage again/.test(b1.message), b1.message);

  // THE FIX. Under PH-29 this press was refused and there was no way out.
  of.input.act(['stage'], 6);
  await sleep(1.2);
  const b2 = FL();
  log.push(`B: after press 2 -> ${b2.status}, stagings ${b2.stagings}, `
    + `releases ${F().clampReleases}, twr ${r2(b2.twr)}`);
  check('B: PRESS 2 GOES THROUGH', b2.stagings === 2, b2.stagings);
  check('B: THE CLAMP RELEASES', b2.status !== 'CLAMPED'
    && F().clampReleases === relBeforeB + 1,
    `${b2.status} / ${relBeforeB} -> ${F().clampReleases}`);
  await sleep(3.0);
  const b3 = FL();
  log.push(`B: climbing -> agl ${r2(b3.altitudeAglM)} m, met ${r2(b3.metS)} s`);
  check('B: AND IT LEAVES THE GROUND', b3.altitudeAglM > 5
    && b3.liftedOff === true, `${r2(b3.altitudeAglM)} m`);

  // ======================================================================
  // D. GP-75. THE HAND-STAGING LATCH TRAVELS WITH THE DESIGN.
  //
  //    This is the OTHER road to a stage table that no longer describes the
  //    rocket, and it is not the one Reid took (B proves autostage did it, with
  //    `handStaged: false`). `Vab.create` used to set the latch true on every
  //    boot that restored a work in progress, so after any reload autostage
  //    never ran again and a part placed afterwards kept whatever stage group
  //    the attach gave it. Asserted through save and load rather than through a
  //    page reload because it is the SAME `fromJson` plus `d.hs` line that the
  //    boot path takes, and a probe can drive it in one page.
  // ======================================================================
  of.vab('enter');
  await sleep(0.3);
  const d0 = of.vab('report');
  check('D: a freshly built design is NOT hand-staged', d0.handStaged === false,
    d0.handStaged);
  of.vab('save', 'gp67-derived');
  await sleep(0.15);
  of.vab('stageDown', 0);
  await sleep(0.15);
  const d1 = of.vab('report');
  check('D: pressing a stage arrow latches it, which is GP-33',
    d1.handStaged === true, d1.handStaged);
  of.vab('save', 'gp67-handed');
  await sleep(0.15);
  of.vab('load', 'gp67-derived');
  await sleep(0.2);
  const d2 = of.vab('report');
  check('D: loading the DERIVED design comes back NOT hand-staged',
    d2.handStaged === false, d2.handStaged);
  of.vab('load', 'gp67-handed');
  await sleep(0.2);
  const d3 = of.vab('report');
  check('D: loading the HAND-ORDERED design comes back hand-staged',
    d3.handStaged === true, d3.handStaged);
  log.push(`D: latch ${d0.handStaged} -> ${d1.handStaged} -> ${d2.handStaged} `
    + `-> ${d3.handStaged}`);
  of.vab('forget', 'gp67-derived');
  of.vab('forget', 'gp67-handed');
  of.vab('leave');
  await sleep(0.2);

  return {
    valid: fails.length === 0,
    fails,
    log,
    handStagedLatch: [d0.handStaged, d1.handStaged, d2.handStaged, d3.handStaged],
    referenceStages: refStages,
    emptyFirstStage: badStages,
    ph29: { partsBefore: partsA0, partsAfter: a1.parts, presses: 4,
      stagings: a1.stagings, refusal: messages[3], stillFlies: a2.status },
    deadlock: { throttle: b0.throttle, twrAtHold: b0.twr, hold: b0.message,
      afterPress1: b1.message, releasedAfterPresses: b2.stagings,
      aglM: r2(b3.altitudeAglM) },
    recover: { emptyRecoverOk: none.ok, movingRecoverOk: moving.ok,
      recoveries: got.report.recoveries, designKept: kept.parts.length,
      packUnchanged: pack() === packBefore },
  };
})()
