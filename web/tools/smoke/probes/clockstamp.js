// clockstamp.js: CE-130. A LIVE FRAME CANNOT CARRY A NEGATIVE DELTA, AND THE
// GUARD THAT USED TO CATCH ONE IS NOW PROVABLY DEAD.
//
//   node tools/smoke/run.mjs --scenario=walk --sandbox=1 --settle=25 \
//        --width=160 --height=90 --atmos=0 --stars=0 --shadows=0 --props=0 \
//        --evalfile=tools/smoke/probes/clockstamp.js
//
// ===========================================================================
// WHAT IS BEING MEASURED, AND WHY IT NEEDED ITS OWN FILE
// ===========================================================================
//
// RN-2030 found live rAF frames carrying a NEGATIVE delta and shipped a floor
// (`Math.max(dtIn, 0)` in `Loop.step`). A floor is a guard, not a fix: the
// mixed clock that produced the negative number was still there, and the next
// consumer of `alpha` to forget to clamp would have rebuilt the same defect.
// CE-130 removed the mixed clock instead. `lastMs` is now stamped ONLY from an
// rAF timestamp, so `now - lastMs` is a difference of two members of one
// non-decreasing sequence and a negative delta is UNREPRESENTABLE rather than
// caught.
//
// "Unrepresentable" is a claim about arithmetic, and this file turns it into a
// reading. `Loop` counts every activation of both guards (`dtFloors` for the
// floor, `alphaClamps` for CE-131's `renderTick` clamp) and publishes them on
// `__of.clock()` and in `__of.world().clock`, so the count is available to
// every probe in the suite and not only to this one.
//
// ===========================================================================
// THE PATTERN THAT PRODUCES THE DEFECT, REPRODUCED ON PURPOSE
// ===========================================================================
//
// The negative delta is not a random event. It is the HANDOFF: `Loop.run`
// finishes a driven burst, stamps `lastMs` from `performance.now()` and calls
// `start()`, and the next rAF callback is handed the timestamp of a frame that
// had ALREADY BEGUN when that stamp was taken. So this probe alternates driven
// bursts with live frames, which is exactly what every capture probe in the
// suite does, and is why the station shot was the thing that exhibited it.
//
// `of.settle(n)` is how the live frames are waited for: after `of.run` returns,
// the loop is running again and the settle waiters are decremented by real rAF
// frames. The probe asserts that those frames actually happened rather than
// assuming it, by counting the frames the driven bursts can account for.
//
// ===========================================================================
// THE REFUSAL
// ===========================================================================
//
// A run in which no live frame happened would report zero activations for the
// same reason a switched-off instrument reports no fault, so the probe REFUSES
// rather than passing when the live-frame count is not clearly positive.
(async () => {
  const of = window.__of;
  if (!of) return { valid: false, why: 'no __of' };
  for (const k of ['clock', 'run', 'settle', 'world']) {
    if (typeof of[k] !== 'function') return { valid: false, why: `no __of.${k}` };
  }
  const fails = [];
  const notes = [];
  const check = (name, ok, detail) => {
    if (!ok) fails.push(detail === undefined ? name : `${name}: ${detail}`);
    return ok;
  };

  // --- 0. THE BASELINE, TAKEN BEFORE THIS PROBE DRIVES ANYTHING ------------
  // Boot itself runs live frames, so the counters may already be nonzero on a
  // build with the defect. Reporting the DELTA as well as the total keeps the
  // two arms comparable and stops boot noise being read as this probe's own.
  const c0 = of.clock();

  // --- 1. ALTERNATE DRIVEN BURSTS WITH LIVE FRAMES -------------------------
  const BURSTS = 12;
  const BURST_S = 0.2;
  const BURST_HZ = 60;
  const LIVE_PER_BURST = 3;
  const drivenFrames = BURSTS * Math.max(1, Math.round(BURST_S * BURST_HZ));
  for (let i = 0; i < BURSTS; ++i) {
    await of.run(BURST_S, BURST_HZ);
    await of.settle(LIVE_PER_BURST);
  }
  const c1 = of.clock();
  const liveFrames = (c1.frames - c0.frames) - drivenFrames;
  notes.push(`${BURSTS} handoffs out of of.run, ${liveFrames} live rAF frames `
    + `beyond the ${drivenFrames} driven ones`);

  if (!(liveFrames >= BURSTS)) {
    return { valid: false, fails,
      why: `REFUSAL: only ${liveFrames} live frames were rendered across `
        + `${BURSTS} handoffs. The guard counters only ever move on a live `
        + 'frame, so a zero reading here would be a switched-off instrument '
        + 'rather than a measurement.' };
  }

  // --- 2. THE HEADLINE -----------------------------------------------------
  check('CE-130: no live frame carried a negative delta',
    c1.dtFloors === 0,
    `${c1.dtFloors} floor activations (${c1.dtFloors - c0.dtFloors} in this `
    + `probe's own window), most negative dt ${c1.dtMinS} s`);
  check('CE-131: no frame produced an alpha outside [0, 1]',
    c1.alphaClamps === 0,
    `${c1.alphaClamps} clamp activations `
    + `(${c1.alphaClamps - c0.alphaClamps} in this probe's own window)`);

  // --- 3. THE CATCH-UP CEILING IS A DIFFERENT GUARD AND STAYS LIVE ---------
  // `dtCeils` is the stalled-tab cap. It is NOT expected to be zero on a busy
  // box and is reported rather than asserted, so a reader cannot mistake the
  // two guards for one. Asserting it would make this probe fail on load.
  notes.push(`catch-up ceiling activations: ${c1.dtCeils} (reported, not `
    + 'asserted: a stalled tab is a real thing and the top clamp is its guard)');

  // --- 4. THE DRIVEN PATH IS UNTOUCHED, IN THE SAME RUN --------------------
  // GP-1013's invariant. A driven burst's dt is `1 / renderHz` by construction,
  // so a driven run of N seconds at H Hz must deliver exactly round(N*H) frames
  // and a deterministic tick count. If the stamping change had leaked into the
  // driven path this is where it would show.
  const before = of.clock();
  await of.run(1.0, 60);
  const after = of.clock();
  check('the driven path still delivers exactly one frame per synthetic step',
    after.frames - before.frames === 60,
    `${after.frames - before.frames} frames for of.run(1.0, 60)`);
  check('and 60 fixed ticks with it, so no tick was lost or invented',
    after.tick - before.tick === 60,
    `${after.tick - before.tick} ticks for of.run(1.0, 60)`);
  check('and the driven path moved neither guard',
    after.dtFloors === before.dtFloors && after.alphaClamps === before.alphaClamps,
    `floors ${before.dtFloors}->${after.dtFloors}, `
    + `alphaClamps ${before.alphaClamps}->${after.alphaClamps}`);

  return {
    valid: true,
    fails,
    checks: 5,
    notes,
    live: { handoffs: BURSTS, drivenFrames, liveFrames },
    clock: { at0: c0, at1: c1, afterDriven: after },
    driven: { frames: after.frames - before.frames, ticks: after.tick - before.tick },
  };
})()
