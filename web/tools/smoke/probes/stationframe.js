// stationframe.js: CE-51. THE DECK DOES NOT STUTTER UNDER A PLAYER STANDING
// STILL ON IT, MEASURED PER RENDERED FRAME.
//
//   node tools/smoke/run.mjs --scenario=walk --settle=25 \
//        --width=160 --height=90 --atmos=0 --stars=0 --shadows=0 --props=0 \
//        --evalfile=tools/smoke/probes/stationframe.js
//
// Reid, real GPU, build `cfeffad`, with video: standing on the station's deck
// stutters rapidly. ~300 fps, GROUNDED, 0.00 m/s, ORBIT, ~399 km, the rebase
// counter stepping 25 -> 26 across two seconds, one frame catching the station
// DOUBLE-IMAGED mid-snap.
//
// ===========================================================================
// WHY EVERY EXISTING PROBE WAS BLIND TO IT, WHICH IS THE POINT OF THIS FILE
// ===========================================================================
//
// `stationboard.js` 29/29, `stationreboot.js` 18/18, `stationride.js` 22/22,
// `stationvisit.js` green, and the rider drifts 1.9e-9 m across 601 ticks. All
// true, all measured PER FIXED TICK. The fixed tick is the exact instant at
// which the camera and the hull are corrected into agreement, so a per-tick
// instrument samples the one moment the defect is not there.
//
// **A measurement whose sample rate equals the rate the system is corrected at
// cannot see the error it is corrected from.** This file samples per RENDERED
// FRAME, which is where the player lives, and it drives the measurement window
// at `of.run`'s own 144.3 Hz default (CE-135: NOT an exact multiple of the 60 Hz
// tick, see the comment at the measurement site) so there are multiple frames
// per tick and alpha actually varies across the WHOLE [0, 1) range rather than
// two fixed points. At 15 Hz, which every other station probe uses to survive
// this VM, there is at most one frame per tick and this defect is INVISIBLE.
// That is stated so nobody "optimises" the rate here later.
//
// ===========================================================================
// THE THREE HYPOTHESES, AND WHICH ONE THE PRE-FIX RUN CONVICTED
// ===========================================================================
//
//   (a) TWO CLOCKS. Camera interpolated between ticks, hull posed at the last
//       INTEGER tick. Predicted: a sawtooth up to 31.32 m at 60 Hz, correlated
//       with alpha.  **MEASURED: 27.04 m peak to peak, 13.53 m within one tick,
//       corrAlpha 0.9999999860. CONVICTED.**
//   (b) f32 RENDER-SPACE WOBBLE. Predicted under a millimetre at the 4 km
//       threshold. Measured engine distance 2,537 m, so the f32 quantum is about
//       1.5e-4 m: FIVE ORDERS too small to be this. Not the cause.
//   (c) THE REBASE SNAP. Predicted one large sample every ~128 ticks.
//       **MEASURED: rebaseSteps 0 across the whole window, and the sawtooth was
//       on every frame anyway.** Not the cause. The counter Reid saw stepping is
//       real and is CE-43's known 2.13 s cadence; it is not the stutter.
//
// ===========================================================================
// THE CONTROL IS IN THE SAME RUN AND IT IS THE COLLIDER
// ===========================================================================
//
// The fix gives the DRAWN geometry the fractional render tick and leaves the
// COLLISION geometry on the integer tick, because that is what the walker's step
// was resolved against. So the collider channel MUST still show the full
// sawtooth afterwards. That makes it a perfect discriminating control: it is the
// pre-fix amplitude, still measurable, in the same run, from the same
// instrument. If it ever goes quiet the instrument has stopped working, and this
// probe says so instead of reporting a pass.
//
// It is also the assertion that the SIM PATH IS UNTOUCHED (CE-33): a collider
// that stopped stepping would mean the fix had reached into the walker.
(async () => {
  const of = window.__of;
  if (!of) return { valid: false, why: 'no __of' };
  for (const k of ['carrier', 'run', 'world', 'teleport', 'framehash']) {
    if (typeof of[k] !== 'function') return { valid: false, why: `no __of.${k}` };
  }
  const fails = [];
  const notes = [];
  const check = (name, ok, detail) => {
    if (!ok) fails.push(detail === undefined ? name : `${name}: ${detail}`);
    return ok;
  };
  const STATION = 'station:anchorage';
  const PER_TICK_M = 31.320919525472796;
  // THE BOUNDS, STATED FROM THE PRE-FIX MEASUREMENT AND NOT FROM TASTE.
  // Post-fix the drawn channel reads 2.43e-3 m peak to peak and 1.65e-4 m within
  // a tick; these are ~4x and ~6x that, so a real regression is caught long
  // before it is visible while ordinary numerical residue is not flagged.
  // The residue is the walker's own render lerp, which interpolates a CHORD
  // while the carrier pose follows the ARC: the sagitta over one tick at r =
  // 1.0e6 m is 1.2e-4 m, which is the number `withinTick` actually reads.
  const DRAWN_AMPLITUDE_BOUND_M = 0.01;
  const DRAWN_WITHIN_TICK_BOUND_M = 0.001;
  const C = () => of.carrier('census');

  await of.run(1.0, 15);
  if (of.carrier('mounts').solid === null) {
    return { valid: false, why: 'no station mounted (?station=0, or no asset)' };
  }
  if (C().feet === null) return { valid: false, why: 'no walker (?mode=walk)' };

  // --- 0. THE FIXTURE. A FROZEN STATION CANNOT STUTTER ---------------------
  // If the record is unstamped the hull and the camera agree trivially, both
  // channels read zero, and every bound below passes for the wrong reason.
  const surv = of.carrier('survey', { id: STATION, ticks: 600 });
  if (!(surv.perTickM > 1)) {
    return { valid: false, fails,
      why: `REFUSAL: the station does not move (perTickM ${surv.perTickM}). A `
        + 'frozen carrier cannot exhibit a two-clock disagreement, so every '
        + 'bound below would pass on a world that has the defect.' };
  }
  check('FIXTURE: the station travels at its own measured orbital rate',
    Math.abs(surv.perTickM - PER_TICK_M) < 1e-6,
    `${surv.perTickM} against ${PER_TICK_M}`);

  // --- 1. THE UNBOARDED CONTROL, ON THE GROUND, BEFORE ANYTHING BOARDS -----
  // `syncWatchersAt` runs every frame whether or not anybody is riding, so the
  // claim that the unboarded path is unchanged has to be measured rather than
  // asserted from the diff. Two renders of a still scene must hash identically,
  // and the ride must have applied no transport at all.
  const h1 = of.framehash(8, 8).hash;
  const h2 = of.framehash(8, 8).hash;
  const c0 = C();
  check('CONTROL: the unboarded ground scene renders identically twice',
    h1 === h2, `${h1} vs ${h2}`);
  check('CONTROL: and nothing is riding anything', c0.ride.applied === 0
    && c0.ride.boards === 0, JSON.stringify(c0.ride));

  // --- 2. BOARD THROUGH THE ROW A PLAYER PRESSES --------------------------
  of.pause(true);
  await of.run(0.35, 15);
  const row = document.querySelector('#of-pause button[data-cheat="visit:station"]');
  if (row === null) return { valid: false, why: 'no station row', fails };
  row.click();
  of.pause(false);
  await of.run(1.0, 15);
  const c1 = C();
  check('the press boarded the player', c1.ride.carrier === STATION,
    JSON.stringify(c1.ride));

  // --- 3. THE MEASUREMENT ------------------------------------------------
  // CE-135. THE WINDOW MUST NOT ALIAS AGAINST THE 60 Hz TICK IT IS MEASURING.
  // This used to drive `of.run(0.35, 120)`. 120 is an EXACT MULTIPLE of 60, so
  // the render accumulator advances by precisely half a tick every frame and
  // alpha can only ever land on {0, 0.5}: `alphaSpan` read exactly 0.5 on every
  // run, and the collider-vs-eye difference (which sweeps toward the full
  // per-tick travel as alpha sweeps toward 1) never got sampled past its
  // midpoint. A measurement window that is an exact multiple of the thing it
  // samples cannot see the whole waveform, no matter how long it runs; a longer
  // multiple window still only ever visits the same two phase points.
  //
  // The fix is `of.run`'s OWN DEFAULT, 144.3 Hz, which every other probe in
  // this suite already uses for exactly this reason (see e.g. `grass.js`,
  // `maps.js`, `stationboard.js`'s and `stationride.js`'s own comments on why
  // they deliberately do NOT use it). 144.3 / 60 = 2.405, so each frame the
  // accumulator advances by a NON-INTEGER, NON-HALF fraction of a tick
  // (~0.4158 tick); the sampled alpha is `(frame * 0.4158) mod 1`, which walks
  // densely through the whole [0, 1) interval rather than bouncing between two
  // fixed points, and still delivers more than two frames per tick (still load
  // bearing versus 15 Hz, where alpha is pinned near 1 and the defect this file
  // exists for cannot appear at all).
  of.carrier('frames', { arm: true, n: 400 });
  await of.run(0.35, 144.3);
  const v = of.carrier('frames').verdict;
  const rows = of.carrier('frames', { dump: true }).samples;
  notes.push(`${v.frames} frames over ${v.ticks} ticks `
    + `(${v.framesPerTick.toFixed(2)} per tick), alpha spanning ${v.alphaSpan}`);

  // CE-135 FOLLOW-UP. THIS BOUND IS WHAT ACTUALLY DEFEATS ALIASING, AND IT HAS
  // TO BE ON alphaSpan ITSELF, NOT ON A DERIVED QUANTITY. The collider check
  // below compares the measured amplitude against alphaSpan * PER_TICK_M *
  // (a projection factor measured from THIS SAME window), which makes it
  // internally consistent for ANY window, aliased or not: an aliased window
  // stuck at alphaSpan 0.5 predicts its own aliased amplitude and passes,
  // which is exactly what the first version of this follow-up did before a
  // negative control caught it (fails: [] on the sabotaged 120 Hz window,
  // because the check was comparing the window against itself). The only
  // thing that can catch aliasing is requiring the window to actually SPAN
  // close to the whole tick. 0.8 sits below this window's measured 0.9418
  // (deterministic, every run) with real margin and clear of the aliased
  // window's exact 0.5 by a wide gap, so it is neither tuned to one run nor
  // achievable by construction from an exact-multiple render rate.
  check('the window really spans nearly the WHOLE tick, not just some of it '
    + '(the bound that actually rules out aliasing; a window at an exact '
    + 'multiple of 60 Hz cannot clear this no matter how long it runs)',
    v.framesPerTick > 1.2 && v.alphaSpan > 0.8,
    `${v.framesPerTick} frames/tick, alpha span ${v.alphaSpan} against a `
    + 'floor of 0.8 (the old aliased window read exactly 0.5)');

  // THE HEADLINE.
  check('THE DRAWN DECK DOES NOT MOVE RELATIVE TO THE EYE, across frames',
    v.amplitudeM < DRAWN_AMPLITUDE_BOUND_M,
    `${v.amplitudeM} m peak to peak against a bound of `
    + `${DRAWN_AMPLITUDE_BOUND_M} m. Pre-fix this read 27.04 m`);
  check('...and not within a single tick either, which is where alpha varies',
    v.withinTickAmplitudeM < DRAWN_WITHIN_TICK_BOUND_M,
    `${v.withinTickAmplitudeM} m against ${DRAWN_WITHIN_TICK_BOUND_M} m. `
    + 'Pre-fix this read 13.53 m');

  // THE DISCRIMINATING CONTROL. The collider is still on the integer tick BY
  // DESIGN, so it still shows the full sawtooth. This is simultaneously the
  // proof that the instrument can still see the defect and the proof that the
  // sim path was not touched.
  check('CONTROL: the COLLIDER still steps per tick, so the instrument can '
    + 'still see the defect and the sim path is untouched',
    v.colliderWithinTickAmplitudeM > 1,
    `${v.colliderWithinTickAmplitudeM} m within a tick: if this is small the `
    + 'fix reached into the collision geometry, which is CE-33 broken');

  // CE-135 FOLLOW-UP. THE CHECK HAS A STRUCTURAL CEILING BELOW PER_TICK_M, AND
  // IT IS NOT JUST alphaSpan. `colliderAmplitudeM` is the LARGEST SINGLE-AXIS
  // peak-to-peak spread of `colRel` over the window (`FrameTrace.spread`), not
  // the vector displacement. Within one tick, `colRel(alpha) = (alpha - 1) *
  // delta`, where `delta` is that tick's step vector (magnitude ~PER_TICK_M,
  // direction `u = delta / |delta|`), so the largest single-axis range the
  // window can ever show is `alphaSpan * |delta| * max_i(|u_i|)`, and
  // `max_i(|u_i|)` is BELOW 1 for any orbit whose direction of travel is not
  // axis-aligned. So even a window with `alphaSpan === 1` (a full tick, the
  // best any window can do) caps below the true `PER_TICK_M`, here around
  // 27.1 m, never the full 31.32 m: the missing ~4 m is geometry, not
  // aliasing. Comparing straight against `PER_TICK_M` (as the first version of
  // this check did) left only a ~1.4% margin above its own 80% floor once the
  // window stopped aliasing, which is fragile rather than wrong.
  //
  // Hard-coding the projection factor would go stale the moment the fixture's
  // orbit changes, so it is measured HERE, from this SAME window's own raw
  // `colRel` vectors instead: `colRel` is LINEAR in alpha (a chord, not the
  // arc; CE-51's sagitta term is 1.2e-4 m, five orders below this amplitude),
  // so the vector between the window's lowest-alpha and highest-alpha sample
  // points in exactly `delta`'s direction, regardless of which ticks they
  // land in (every tick's `delta` is the same step to within that same
  // negligible curvature over a 0.35 s window).
  let lo = rows[0];
  let hi = rows[0];
  for (const r of rows) {
    if (r.alpha < lo.alpha) lo = r;
    if (r.alpha > hi.alpha) hi = r;
  }
  const dVec = [hi.colRel[0] - lo.colRel[0], hi.colRel[1] - lo.colRel[1],
    hi.colRel[2] - lo.colRel[2]];
  const dMag = Math.hypot(dVec[0], dVec[1], dVec[2]);
  const projFactor = dMag > 0
    ? Math.max(Math.abs(dVec[0]), Math.abs(dVec[1]), Math.abs(dVec[2])) / dMag
    : 1;
  const expectedColliderAmplitudeM = v.alphaSpan * PER_TICK_M * projFactor;
  notes.push(`axis-projection factor ${projFactor.toFixed(6)}, from the window's `
    + `own lowest/highest-alpha samples: caps the collider ceiling at `
    + `${(PER_TICK_M * projFactor).toFixed(3)} m even at alphaSpan 1.0, never `
    + `the full ${PER_TICK_M.toFixed(2)} m of true per-tick travel`);
  check('CONTROL: and the collider sawtooth matches alphaSpan times the '
    + "per-tick travel times the window's OWN measured axis-projection "
    + 'factor (never the full per-tick travel: the orbit is not axis-aligned, '
    + 'so even alphaSpan 1.0 caps below PER_TICK_M, and that ceiling is '
    + 'derived from this run rather than a constant that would go stale). '
    + 'TOLERANCE: 2% of PER_TICK_M (0.626 m); 5 measured runs agreed with the '
    + 'projection-derived expectation to within 0.53 mm every time, a >1000x '
    + 'margin, so 2% is headroom for run-to-run and cross-machine noise, not '
    + 'a bound tuned to the observed residue',
    Math.abs(v.colliderAmplitudeM - expectedColliderAmplitudeM) < PER_TICK_M * 0.02,
    `${v.colliderAmplitudeM} m against ${expectedColliderAmplitudeM.toFixed(6)} m `
    + `expected (alphaSpan ${v.alphaSpan} * ${PER_TICK_M} m * projection `
    + `${projFactor.toFixed(6)}), tolerance ${(PER_TICK_M * 0.02).toFixed(3)} m`);
  check('the drawn channel is orders of magnitude quieter than the collider',
    v.colliderAmplitudeM > v.amplitudeM * 1000,
    `drawn ${v.amplitudeM} m vs collider ${v.colliderAmplitudeM} m`);

  // HYPOTHESIS (c), MEASURED RATHER THAN ASSUMED. The rebase cadence is real
  // (CE-43: every ~128 ticks at 1879.26 m/s) and it is NOT the stutter: the
  // window carries the full sawtooth on the collider channel with zero rebases
  // in it.
  check('(c) is not the cause: the window contains no rebase at all',
    v.rebaseSteps === 0, `${v.rebaseSteps} rebases in ${v.ticks} ticks`);
  // HYPOTHESIS (b), same treatment. f32 precision at this engine distance is
  // about `engineMaxM * 6e-8`.
  const f32QuantumM = v.engineMaxM * 6e-8;
  notes.push(`(b) f32 quantum at ${Math.round(v.engineMaxM)} m from the origin `
    + `is about ${f32QuantumM.toExponential(2)} m, which is `
    + `${(27.04 / f32QuantumM).toExponential(1)}x too small to have been this`);

  // --- 4. AND THE SIM IS STILL GLUED -------------------------------------
  const localA = of.carrier('local').local.slice();
  await of.run(1.0, 15);
  const localB = of.carrier('local').local.slice();
  const drift = Math.hypot(localA[0] - localB[0], localA[1] - localB[1],
    localA[2] - localB[2]);
  check('the rider is still glued to the deck in the sim, to 1e-6 m',
    drift < 1e-6, `${drift} m of deck-relative drift over 60 ticks`);
  const mm = of.carrier('mounts').mounts.mounts[0];
  check('and the two clocks are both running: drawn per FRAME, applied per TICK',
    mm.drawn > mm.applied, `drawn ${mm.drawn}, applied ${mm.applied}`);

  // --- 4b. CE-131. WHAT THE DRAWN WORLD DOES WHEN THE ALPHA INVARIANT FAILS
  //
  // CE-130 makes an out-of-range alpha unreachable from the live loop, so this
  // section exists to pin the behaviour when one arrives ANYWAY (a stall
  // between the tick and the draw, or a future consumer writing the field).
  // `of.carrier('drawAt')` writes `loop.alpha`, reads `loop.renderTick` and
  // drives the SHIPPING `mounts.syncWatchersAt` with it, so this measures the
  // path rather than a transcription of it.
  //
  // THE DECIDED SEMANTICS: the drawn world is pinned to the NEAREST INTEGER
  // TICK, which is the last pose the sim actually produced, and never
  // extrapolates past it. That is what the eye already does, so the two cannot
  // disagree. `rawPos` in each reading is the same watcher path at the
  // UNCLAMPED instant, i.e. what the pre-CE-131 loop drew, and it is what makes
  // these checks non-vacuous: on a frozen station clamped and unclamped agree
  // and every equality below would pass on a broken build.
  const inRange = of.carrier('drawAt', { alpha: 0.5 });
  const under = of.carrier('drawAt', { alpha: -0.5 });
  const over = of.carrier('drawAt', { alpha: 1.5 });
  if (inRange.error || under.error || over.error) {
    return { valid: false, fails,
      why: `drawAt refused: ${inRange.error ?? under.error ?? over.error}` };
  }
  check('CONTROL: an in-range alpha is not clamped and draws where it always did',
    !inRange.clamped && inRange.gapM === 0,
    `clamped ${inRange.clamped}, gap ${inRange.gapM} m at alpha 0.5`);
  check('CE-131: a NEGATIVE alpha pins the drawn hull to the previous integer '
    + 'tick', under.clamped && under.drawnTick === under.tick - 1,
    `drawnTick ${under.drawnTick} against tick ${under.tick}, `
    + `raw ${under.rawTick}`);
  check('CE-131: an alpha ABOVE ONE pins it to the current integer tick',
    over.clamped && over.drawnTick === over.tick,
    `drawnTick ${over.drawnTick} against tick ${over.tick}, raw ${over.rawTick}`);
  // NON-VACUITY. Half a tick of overshoot is half a tick of travel, so the
  // clamp must have moved the drawn hull by about PER_TICK_M / 2. If this were
  // small the equalities above would be passing on a station that is not going
  // anywhere.
  const wantGapM = PER_TICK_M / 2;
  check('and the clamp actually moved the hull: half a tick of overshoot is '
    + 'half a tick of travel',
    Math.abs(under.gapM - wantGapM) < wantGapM * 0.05
    && Math.abs(over.gapM - wantGapM) < wantGapM * 0.05,
    `under ${under.gapM} m, over ${over.gapM} m, against ~${wantGapM} m`);
  check('CONTROL: the forced alphas were restored and left no residue in the '
    + 'live counter', of.world().clock.alphaClamps === 0,
    `${of.world().clock.alphaClamps} live alpha-clamp activations`);
  notes.push(`CE-131 pinning: alpha -0.5 held the hull ${under.gapM.toFixed(3)} m `
    + `short of the unclamped extrapolation, alpha 1.5 by ${over.gapM.toFixed(3)} m`);

  // --- 5. BACK TO THE GROUND BEFORE FINISHING ----------------------------
  // `run.mjs` settles on terrain convergence AFTER the eval resolves, and a
  // walker parked 400 km up with the streamer chasing him never converges:
  // `stationvisit.js` says so in its own header and ends on the ground for the
  // same reason. Four runs were lost to this before the line existed.
  of.carrier('frames', { arm: false });
  of.carrier('release');
  of.teleport(-3.41413, 150.27984, 2);
  await of.run(1.0, 15);

  return {
    valid: true,
    fails,
    checks: 17,
    notes,
    // CE-131. The three forced-alpha readings, kept in the output so the
    // decided failure semantics are readable without re-running the probe.
    forcedAlpha: { inRange, under, over, wantGapM: PER_TICK_M / 2 },
    fixture: { perTickM: surv.perTickM, wantedPerTickM: PER_TICK_M },
    window: { frames: v.frames, ticks: v.ticks, framesPerTick: v.framesPerTick,
              alphaSpan: v.alphaSpan, rebaseSteps: v.rebaseSteps,
              engineMaxM: v.engineMaxM },
    drawn: { amplitudeM: v.amplitudeM, withinTickAmplitudeM: v.withinTickAmplitudeM,
             boundM: DRAWN_AMPLITUDE_BOUND_M,
             withinTickBoundM: DRAWN_WITHIN_TICK_BOUND_M,
             preFixAmplitudeM: 27.04063896095613,
             preFixWithinTickAmplitudeM: 13.524666351033375 },
    collider: { amplitudeM: v.colliderAmplitudeM,
                withinTickAmplitudeM: v.colliderWithinTickAmplitudeM,
                // CE-135 follow-up: the axis-projection ceiling, derived from
                // this run's own window rather than a hard-coded constant.
                projFactor, expectedAmplitudeM: expectedColliderAmplitudeM },
    corrAlpha: v.corrAlpha,
    simDriftM: drift,
    clocks: { drawn: mm.drawn, applied: mm.applied },
    firstTick: rows.slice(0, 4).map((r) => ({ a: +r.alpha.toFixed(3),
      drawnM: +r.relM.toFixed(6), colliderM: +r.colRelM.toFixed(4) })),
  };
})()
