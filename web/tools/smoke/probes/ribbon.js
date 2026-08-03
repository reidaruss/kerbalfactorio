// ribbon.js: THE NINTH SAS MODE, and the one measurement that can tell it from
// a single aim (PH-201).
//
//   node tools/smoke/run.mjs --url=http://127.0.0.1:<port>/ --sandbox=1 \
//        --settle=6 --evalfile=tools/smoke/probes/ribbon.js
//
// WHY THE OBVIOUS TEST WOULD PASS ON A BROKEN IMPLEMENTATION.
//
// Press the key, read the ball, see the command marker sitting on the guidance
// marker: green. That is ALSO green for an implementation that aims ONCE and
// never again, which is the thing this mode exists not to be. Worse, it is
// green on the PAD for an implementation that does nothing at all, because on
// the pad the ribbon says straight up and the rocket is already pointing
// straight up. Both are the shape Admin named after the gameplay lane's
// zero-burn programme: a fixture whose subject is the identity operation.
//
// So the acceptance here is a TRACKING measurement over a MOVING ribbon:
//   * the nose starts DELIBERATELY OFF the ribbon (slewed away first), so
//     converging is something that has to happen rather than something that
//     was already true;
//   * the ribbon's own pitch must MOVE by tens of degrees during the sampled
//     window, and the probe asserts that it did before it believes the
//     tracking, because a stationary ribbon cannot discriminate;
//   * the command marker is compared to the guidance marker at EVERY sample.
//
// And three controls:
//   * NEGATIVE: the same flight, same slew, without the key. The gap stays open.
//   * INTERLOCK: a manual pitch input takes the mode back off, because a mode
//     the player cannot override is worse than no mode.
//   * REACHED THE END: the sample count is asserted, so a run that fell out of
//     the loop early cannot read as a run that tracked all the way up.
(async () => {
  const of = window.__of;
  if (!of) return { valid: false, why: 'no __of' };
  if (typeof of.flight !== 'function') return { valid: false, why: 'no __of.flight' };
  const sleep = (n) => of.run(n);
  const fails = [];
  const log = [];
  const check = (name, ok, detail) => {
    if (!ok) fails.push(detail === undefined ? name : `${name}: ${detail}`);
    return ok;
  };
  const F = () => of.flight('report');
  // THE SAS NAME IS NESTED, and reading it off the top level returns undefined
  // rather than throwing, which made five assertions compare undefined to a
  // string and fail for a reason that had nothing to do with the mode. Same
  // wrong-field shape as PH-158.
  const SAS = () => F().flight.sas;
  const R = () => of.flight('readout');
  // The angle between two navball markers, in degrees, on the sphere. Heading
  // alone is meaningless near the poles of the ball and pitch alone ignores
  // azimuth, so this is the real separation and not a proxy for it.
  const sep = (a, b) => {
    if (!a || !b) return NaN;
    const d = Math.PI / 180;
    const v = (m) => {
      const p = m.pitchDeg * d, h = m.headingDeg * d;
      return [Math.cos(p) * Math.cos(h), Math.cos(p) * Math.sin(h), Math.sin(p)];
    };
    const [x, y] = [v(a), v(b)];
    let c = x[0] * y[0] + x[1] * y[1] + x[2] * y[2];
    c = Math.max(-1, Math.min(1, c));
    return (Math.acos(c) * 180) / Math.PI;
  };

  // ---------------------------------------------------------------------------
  // 0. THE FIXTURE: the same stack ascent.js and flyto.js fly, built through
  //    the panel, because a vessel conjured by a setter is a vessel whose
  //    guidance nobody has to be able to reach.
  // ---------------------------------------------------------------------------
  if (typeof of.vab !== 'function') return { valid: false, why: 'no __of.vab' };
  const PID = {
    CommandPod: 0x0100, TankLiquidSmall: 0x0101, TankLiquidSmallLong: 0x0102,
    EngineLiquidSmall: 0x0103, EngineVacuumSmall: 0x0104,
    DecouplerStackSmall: 0x0105, Fin: 0x0106, Parachute: 0x0107,
  };
  of.vab('enter');
  await sleep(0.3);
  const cat = of.vab('catalogue');
  const idxOf = (id) => { const r = cat.find((c) => c.id === id); return r ? r.index : -1; };
  of.vab('press', 'clear');
  await sleep(0.15);
  // NO PARACHUTE and NO FINS. The parachute has no bottom node, so a loop that
  // always attaches under the LOWEST part puts it somewhere absurd and the
  // first-stage engine then finds nowhere to go; that is what left this fixture
  // with seven parts and no engine at the bottom. Six parts is a two-stage
  // rocket that lifts, which is all this measurement needs.
  for (const pid of [PID.CommandPod, PID.TankLiquidSmall,
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
  of.vab('drop');
  const vr = of.vab('report');
  // THE FIXTURE IS REPORTED, NOT ASSUMED. ascent.js pins this stack at eleven
  // parts; here it comes out at seven, and chasing that difference is the VAB
  // lane's work and not this file's. What this measurement needs of the vehicle
  // is that it FLIES, so that is what is asserted, below, from a measured
  // altitude change. Fins and a parachute would change the AIRFRAME's
  // stability, which is what holds the nose on a command; they cannot change
  // where the command points, and where the command points is the whole
  // subject here.
  log.push(`[fixture] ${vr.parts.length} parts: `
    + vr.parts.map((p) => p.partId.toString(16)).join(','));
  if (vr.parts.length < 5) return { valid: false, why: `fixture ${vr.parts.length} parts`, log };
  of.vab('leave');
  await sleep(0.4);

  // Roll out, WALK the 26 m the pad is planted at, and get in. The walk is
  // ascent.js's, and it is not optional: the roll-out puts the vessel out of
  // boarding range on purpose.
  const boardUp = async () => {
    of.input.act(['board'], 4); await sleep(0.5);
    for (let i = 0; i < 14 && F().distanceToVesselM > 10; ++i) {
      of.input.act(['forward'], 30);
      await sleep(0.6);
    }
    of.input.act(['board'], 4); await sleep(0.8);
    return F().aboard === true;
  };
  check('aboard a vessel on the pad', await boardUp(), JSON.stringify(F().aboard));
  check('the ribbon exists at all', R().guidance !== null,
        'readout().guidance is null, so there is nothing to follow');
  if (fails.length) return { valid: false, why: fails.join(' | '), log };

  // A run of the ascent, driven by keys, sampling the two markers.
  //
  // `useRibbon` is THE ONE DIFFERENCE between the acceptance and its control.
  const runAscent = async (useRibbon) => {
    const aglBefore = R().altitudeM;
    of.input.act(['throttleFull'], 3);
    await sleep(0.4);
    of.input.act(['stage'], 3);
    await sleep(2.0);
    // POINT THE NOSE AWAY FIRST. Without this the rocket is already on the
    // ribbon and "it converged" is not an observation about anything.
    of.input.act(['yawRight'], 90);
    of.input.act(['pitchDown'], 90);
    await sleep(1.5);
    const liftedM = R().altitudeM - aglBefore;
    const offAtStart = sep(R().command, R().guidance);
    if (useRibbon) { of.input.act(['sasGuidance'], 3); await sleep(0.3); }
    const samples = [];
    for (let i = 0; i < 12; ++i) {
      await sleep(2.0);
      const rd = R();
      samples.push({
        t: F().flight.metS, aglM: rd.altitudeM,
        ribbonPitch: rd.guidance ? rd.guidance.pitchDeg : NaN,
        gapDeg: sep(rd.command, rd.guidance),
        noseGapDeg: sep({ headingDeg: rd.headingDeg, pitchDeg: rd.pitchDeg },
                        rd.guidance),
        sas: SAS(),
      });
    }
    return { offAtStart, liftedM, samples };
  };

  // ---------------------------------------------------------------------------
  // 1. THE ACCEPTANCE.
  // ---------------------------------------------------------------------------
  const a = await runAscent(true);
  const ribbonPitches = a.samples.map((s) => s.ribbonPitch).filter(Number.isFinite);
  const ribbonSwing = ribbonPitches.length
    ? Math.max(...ribbonPitches) - Math.min(...ribbonPitches) : 0;
  const worstGap = Math.max(...a.samples.map((s) => s.gapDeg));
  const worstNose = Math.max(...a.samples.map((s) => s.noseGapDeg));
  log.push(`[GDN] off at press ${a.offAtStart.toFixed(2)} deg, ribbon swing `
    + `${ribbonSwing.toFixed(2)} deg over ${a.samples.length} samples, worst `
    + `command-vs-ribbon ${worstGap.toFixed(4)} deg, worst NOSE-vs-ribbon `
    + `${worstNose.toFixed(2)} deg`);

  // DW-20: IT LEFT THE PAD. A rocket standing still has a perfectly stationary
  // ribbon, and every tracking number below would be calm and meaningless.
  check('the rocket actually left the pad', a.liftedM > 20,
        `${a.liftedM.toFixed(1)} m in the first 4 s`);
  // REACHED THE END. Twelve samples were asked for and twelve must exist, or a
  // run that stopped early reads exactly like a run that tracked the whole way.
  check('the run reached the end', a.samples.length === 12,
        `${a.samples.length} samples`);
  // THE FIXTURE CAN DISCRIMINATE. A stationary ribbon would make the tracking
  // assertion below vacuous, so the swing is asserted BEFORE it is used.
  check('the ribbon actually moved during the window', ribbonSwing > 15,
        `swing ${ribbonSwing.toFixed(2)} deg, so a single aim would also pass`);
  check('the nose was genuinely off the ribbon when the key was pressed',
        a.offAtStart > 10, `${a.offAtStart.toFixed(2)} deg`);
  // THE MODE. The command tracks the ribbon at every sample, not just the first.
  //
  // THE BOUND IS NOT ZERO AND IT SHOULD NOT BE. The command is written BEFORE
  // the physics step and the marker is read AFTER it, so the residual is one
  // tick of altitude change against a ribbon that is moving at about four
  // degrees per sample: measured, 0.0396 degrees. A bound of zero here would
  // be an assertion about the read ORDER rather than about the mode. What
  // makes it meaningful is the ratio to the control below, which is 2800x.
  check('the command follows the ribbon at every sample', worstGap < 0.5,
        `worst ${worstGap.toFixed(6)} deg`);
  // AND THE VEHICLE ACTUALLY GOES THERE, which is a DIFFERENT claim: the
  // command is where SAS aims and the nose is where the airframe ends up, and
  // between them sit stability assist, the gimbal and the air. The bound here
  // is deliberately loose and the number is REPORTED, because a tight bound
  // would be an assertion about the finless fixture rather than about the mode.
  check('and the nose converges onto it', worstNose < 45,
        `worst ${worstNose.toFixed(2)} deg`);
  check('the mode says so on the readout',
        a.samples.every((s) => s.sas === 'GDN'),
        a.samples.map((s) => s.sas).join(','));

  // ---------------------------------------------------------------------------
  // 2. THE INTERLOCK. A player who touches the stick takes the vessel back.
  // ---------------------------------------------------------------------------
  const sasBefore = SAS();
  of.input.act(['pitchUp'], 20);
  await sleep(0.6);
  const sasAfter = SAS();
  log.push(`[interlock] ${sasBefore} -> ${sasAfter} on a pitch input`);
  check('ribbon-follow was on before the stick input', sasBefore === 'GDN', sasBefore);
  check('a manual input takes the mode back off', sasAfter !== 'GDN', sasAfter);
  // And a mode key does too, by the other path (`setSas` rather than an aim).
  of.input.act(['sasGuidance'], 3); await sleep(0.4);
  const onAgain = SAS();
  of.input.act(['sasPrograde'], 3); await sleep(0.4);
  const offByMode = SAS();
  log.push(`[interlock] re-armed to ${onAgain}, then a mode key gave ${offByMode}`);
  check('it can be re-armed after being taken off', onAgain === 'GDN', onAgain);
  check('a mode key also takes it off', offByMode === 'PRO', offByMode);

  // ---------------------------------------------------------------------------
  // 3. THE NEGATIVE CONTROL: the same flight, the same slew, no key.
  //
  // If this goes green the acceptance above measured a rocket that would have
  // been on the ribbon anyway, which is exactly the failure this file is about.
  // ---------------------------------------------------------------------------
  of.flight('recover');
  await sleep(1.5);
  check('the control got its own vessel', await boardUp(),
        JSON.stringify(F().aboard));
  const b = await runAscent(false);
  const ctlGap = Math.max(...b.samples.map((s) => s.gapDeg));
  const ctlWorstNose = Math.max(...b.samples.map((s) => s.noseGapDeg));
  log.push(`[control] no key: worst command-vs-ribbon ${ctlGap.toFixed(2)} deg, `
    + `worst NOSE-vs-ribbon ${ctlWorstNose.toFixed(2)} deg, sas `
    + `${b.samples[0] ? b.samples[0].sas : '?'}`);
  check('the control reached the end too', b.samples.length === 12,
        `${b.samples.length} samples`);
  check('WITHOUT the key the command does NOT follow the ribbon', ctlGap > 10,
        `worst gap only ${ctlGap.toFixed(2)} deg, so the acceptance proved nothing`);
  check('and the control never claims the mode',
        b.samples.every((s) => s.sas !== 'GDN'),
        b.samples.map((s) => s.sas).join(','));

  return {
    valid: fails.length === 0,
    fails,
    log,
    gdn: { offAtStart: a.offAtStart, ribbonSwing, worstGap, worstNose },
    control: { worstGap: ctlGap, worstNose: ctlWorstNose },
    samples: a.samples,
  };
})()
