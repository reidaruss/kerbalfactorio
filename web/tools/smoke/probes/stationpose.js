// stationpose.js: CE-115 to CE-129. ONE POSE AUTHORITY FOR THE STATION.
//
//   node tools/smoke/run.mjs --scenario=walk --settle=25 \
//        --evalfile=tools/smoke/probes/stationpose.js
//
// ===========================================================================
// WHAT THIS MEASURES AND WHY IT HAD TO EXIST
// ===========================================================================
//
// The station's attitude had TWO derivations and only one of them moved.
//
//   A. `stationQuat(pos)` (SpaceStation.ts): a POSITION-ONLY nadir lock,
//      `setFromUnitVectors(+Y, pos/|pos|)`, whose roll is THREE's shortest-arc
//      convention and is therefore whatever falls out of the position. Read
//      fresh on every call, so it never lags -- and never agrees with anything
//      that was carried.
//   B. `CarrierMount.syncAt/syncWatchersAt`: `poseAt(t) . local`, where `local`
//      was MEASURED once at install as `poseAt(install)^-1 . authored`. Roll
//      here rides the LVLH basis, which is tied to prograde.
//
// A posed nothing that is drawn or collided with; B poses the collision solid,
// both gravity volumes and the drawn hull. But A is what `of.station().axes`
// published, and `artframe.js`'s station shot AIMS THE CAMERA with it while
// standing on geometry posed by B. Two conventions that agree at the install
// tick and walk apart from there: the same shape PH-357 already paid for once,
// where `orbitdeck.js` drew an upside-down corridor with every assertion green.
//
// So the number below is the ANGLE between A and B at the same instant, and
// how it moves with orbital phase. MEASURED, same build, same six samples:
//
//   before  0.230 deg at tick 121 -> 1.373 deg at tick 721, LINEAR in phase at
//           0.00190 deg/tick, with no bound on it over an orbit
//   after   0 to 2.7e-6 deg, FLAT, which is the `acos` rounding floor
//
// The positions agreed to 0 m exactly on both, so the whole of it was attitude.
// On the fixed build A is derived FROM B (`stationAxes` reads the mounted
// solid), so what is left is arithmetic and the gates are set against the
// instrument's own floor rather than against a hope.
//
// SECTION 2 IS THE DRIVEN-CLOCK QUESTION, asked because a re-pose that only
// fires under real rAF would explain a scripted capture catching the install
// pose. `Loop.run` calls `frame()` directly, so it does; this asserts it with
// the mount's own two counters (`applied`, the fixed-tick half; `drawn`, the
// rendered-frame half) rather than believing the call graph.
(async () => {
  const of = window.__of;
  if (of === undefined) return { valid: false, why: 'no __of' };
  const fails = [];
  let checks = 0;
  const check = (what, ok, got) => {
    checks++;
    if (!ok) fails.push(`${what} (got ${got})`);
  };
  const sleep = (s) => of.run(s, 30);

  if (typeof of.station !== 'function') return { valid: false, why: 'no of.station' };
  if (typeof of.carrier !== 'function') return { valid: false, why: 'no of.carrier' };
  const st0 = of.station();
  if (st0 === null) {
    return { valid: false, why: 'no installed station: drop ?station=0' };
  }

  // ---------------------------------------------------------------- helpers
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  /** Rotate a unit axis by a quaternion [x,y,z,w]. The one place this probe
   *  does quaternion arithmetic, and it is the standard sandwich rather than a
   *  re-derivation of anything the client owns. */
  const rot = (q, v) => {
    const [x, y, z, w] = q;
    const tx = 2 * (y * v[2] - z * v[1]);
    const ty = 2 * (z * v[0] - x * v[2]);
    const tz = 2 * (x * v[1] - y * v[0]);
    return [v[0] + w * tx + y * tz - z * ty,
            v[1] + w * ty + z * tx - x * tz,
            v[2] + w * tz + x * ty - y * tx];
  };
  /**
   * Degrees between two orientations, one given as the client's own published
   * axis triple and the other as a quaternion.
   *
   * NEITHER SIDE IS REBUILT HERE. `axes` is whatever `of.station().axes`
   * publishes and `quat` is whatever the mount wrote onto the solid; this only
   * compares them. A probe that recomputed `stationQuat` itself would agree
   * with its own copy whatever the client did, which is the exact mistake the
   * first `orbitdeck.js` made (standing rule 11).
   */
  const angleDeg = (axes, quat) => {
    const tr = dot(axes.along, rot(quat, [1, 0, 0]))
      + dot(axes.up, rot(quat, [0, 1, 0]))
      + dot(axes.across, rot(quat, [0, 0, 1]));
    const c = Math.min(1, Math.max(-1, (tr - 1) / 2));
    return (Math.acos(c) * 180) / Math.PI;
  };
  const sample = () => {
    const s = of.station();
    const m = of.carrier('mounts');
    if (m.solid === null) return null;
    return {
      tick: s.install === null ? null : m.tick,
      axes: s.axes, quat: m.solid.quat,
      angleDeg: angleDeg(s.axes, m.solid.quat),
      recPos: s.pos, solidPos: m.solid.pos,
      posGapM: Math.hypot(s.pos[0] - m.solid.pos[0], s.pos[1] - m.solid.pos[1],
                          s.pos[2] - m.solid.pos[2]),
    };
  };

  // ======================================================================
  // 1. THE DISAGREEMENT, SAMPLED ACROSS ORBITAL PHASE.
  // ======================================================================
  const raw = [];
  for (let i = 0; i < 6; i++) {
    const s = sample();
    if (s === null) return { valid: false, why: 'the station solid is on no mount' };
    raw.push(s);
    await sleep(2);
  }
  const series = raw.map((s) => ({ tick: s.tick, angleDeg: s.angleDeg,
                                   posGapM: s.posGapM }));
  const last = raw.length - 1;
  const worstAngle = Math.max(...series.map((s) => s.angleDeg));
  const spanTicks = series[last].tick - series[0].tick;
  const growthDeg = series[last].angleDeg - series[0].angleDeg;
  // ==========================================================================
  // THE BOUND IS AN `acos` BOUND, AND THAT IS WHY IT IS NOT 1e-15.
  // ==========================================================================
  //
  // With one authority `axes` is the solid's own quaternion turned into three
  // vectors, so the only error left is float64 rounding in the sandwich -- but
  // `acos` NEAR 1 AMPLIFIES IT BY ITS OWN SQUARE ROOT: a dot product 1e-16
  // short of unity comes out as sqrt(2e-16) = 1.4e-8 rad, which is 8e-7
  // degrees. That is the floor of this instrument and no fix can go under it.
  // Measured floor on the fixed build: 0 to 2.7e-6 degrees, FLAT across the
  // sample rather than trending.
  //
  // 1e-4 degrees is ~40x that floor and ~2,300x under the SMALLEST pre-fix
  // reading (0.230 deg at tick 121). It is not a tolerance anything can drift
  // into: the defect this replaces grew LINEARLY with orbital phase at 0.00190
  // deg/tick, so a second convention reintroduced anywhere crosses this bound
  // within a tenth of a second of sim.
  check('the drawn/collided pose and the published axes are ONE orientation',
        worstAngle < 1e-4, `worst ${worstAngle} deg over ${spanTicks} ticks`);
  // AND IT DOES NOT GROW, which is the actual signature. A constant offset
  // would be a wrong authored frame; a LINEAR one is two conventions walking
  // apart, and that is what this file was written for. Before: +1.14 deg over
  // these same 600 ticks. After: within the acos floor of zero.
  check('and the agreement does not decay with orbital phase',
        Math.abs(growthDeg) < 1e-4, `${growthDeg} deg over ${spanTicks} ticks`);
  check('and the sampling actually spanned orbital phase, so the check is not '
        + 'measuring a frozen station',
        spanTicks > 300, `${spanTicks} ticks`);
  // THE METRIC IS LIVE, PROVEN WITHOUT A FIXTURE. `angleDeg` returns 0 for two
  // identical inputs and "identical" is also what reading one source twice
  // gives, so a bound near zero is worthless until this line: the SAME
  // comparator, fed the first sample's axes and the last sample's quaternion,
  // must report the real turn the station performed in between. If it does not,
  // every zero above is a zero because nothing moved.
  const turnedOverSpanDeg = angleDeg(raw[0].axes, raw[last].quat);
  check('the comparator reports the station\'s own turn over the same span, so '
        + 'the agreement above is not two reads of one number',
        turnedOverSpanDeg > 0.5, `${turnedOverSpanDeg} deg`);

  // THE POSITION HALF OF THE SAME QUESTION. `of.station().pos` is `stateOf` at
  // the INTEGER tick and the solid is `poseAt(tick)` composed with `local`, and
  // CE-85 poses the geometry AFTER the increment on purpose, so a one-tick,
  // 31.32 m gap is CORRECT here and a larger one is not. Published rather than
  // gated tight, because the tick offset is a design and not an error.
  const posGap = Math.max(...series.map((s) => s.posGapM));
  check('the record position and the solid position differ by at most the one '
        + 'deliberate tick CE-85 offsets them by',
        posGap < 40, `${posGap} m`);

  // ======================================================================
  // 2. DOES THE RE-POSE FIRE UNDER THE DRIVEN CLOCK?
  // ======================================================================
  //
  // Two counters, because there are two halves and they are driven from two
  // different places: `applied`/`lastTick` from `Loop.fixedTick`, `drawn`/
  // `lastDrawnTick` from `Loop.frame`. A scripted `of.run` goes through
  // `Loop.frame` directly, so BOTH must move; if only `applied` moved, the
  // drawn hull would sit at whatever pose the last real rAF left it at, which
  // is the hypothesis this section exists to kill.
  const mOf = (c) => c.mounts.mounts.find((m) => m.id === 'station:anchorage');
  const c0 = mOf(of.carrier('mounts'));
  check('the station mount watches the drawn hull',
        c0 !== undefined && c0.watchers.includes('station:view'),
        c0 === undefined ? 'no station mount' : c0.watchers.join(','));
  await of.run(1.0, 30);
  const c1 = mOf(of.carrier('mounts'));
  const dApplied = c1.applied - c0.applied;
  const dDrawn = c1.drawn - c0.drawn;
  check('the fixed-tick half advances under of.run', dApplied >= 55, dApplied);
  check('AND SO DOES THE DRAWN HALF: the per-tick re-pose is not rAF-only',
        dDrawn >= 25, dDrawn);
  check('the drawn half is posed at a FRACTIONAL tick (CE-51), not the integer '
        + 'one the collider uses',
        c1.lastDrawnTick !== c1.lastTick,
        `${c1.lastDrawnTick} vs ${c1.lastTick}`);
  check('and it is within one tick of it, so the two clocks describe one instant',
        Math.abs(c1.lastDrawnTick - c1.lastTick) <= 1.0,
        `${c1.lastDrawnTick - c1.lastTick}`);

  // Paused, too. `artframe.js`'s station shot runs `of.pause(true)` before the
  // menu press, and a re-pose that stopped there would leave the hull behind
  // exactly where a capture looks at it.
  of.pause(true);
  const p0 = mOf(of.carrier('mounts'));
  await of.run(0.5, 30);
  const p1 = mOf(of.carrier('mounts'));
  of.pause(false);
  check('and the DRAWN half keeps being posed while the sim is paused',
        p1.drawn - p0.drawn >= 10, p1.drawn - p0.drawn);

  // ======================================================================
  // 3. THE NEGATIVE CONTROL: the angle is not trivially zero.
  // ======================================================================
  //
  // WITHOUT THIS THE WHOLE FILE IS UNFALSIFIABLE. `angleDeg` returns 0 for two
  // identical inputs, and "identical" is also what a probe reading one source
  // twice would get. Re-mounting the station onto the `rotor` instrument turns
  // it away from its own conic; `axes` must FOLLOW, because on the fixed build
  // it is derived from the solid, and the angle must stay at epsilon while the
  // orientation itself has visibly moved. A build where `axes` is
  // `stationQuat(pos)` again fails here first and hardest.
  const before = sample();
  const reg = of.carrier('register',
    { kind: 'rotor', id: 'posespin', from: 'station:anchorage' });
  check('the rotor instrument registers', reg.error === undefined, reg.error);
  const re = of.carrier('remount', { id: 'posespin' });
  check('the station re-mounts onto it', re.error === undefined, re.error);
  await sleep(4);
  const spun = sample();
  // The rotor is derived from the station's OWN conic (`RotorCarrier.fromOrbit`
  // refuses to take a made-up rate), so it turns at the orbit's own angular
  // rate and this reads a real but unspectacular number. That is the fixture
  // being honest, not the control being weak: what matters is that the
  // orientation moved measurably while the agreement below did not.
  const moved = angleDeg(before.axes, spun.quat);
  check('the re-mount genuinely turned the station', moved > 0.1, `${moved} deg`);
  check('and the published axes followed it onto the instrument frame, so they '
        + 'describe whatever frame the geometry is on rather than the conic',
        spun.angleDeg < 1e-4, `${spun.angleDeg} deg`);
  const back = of.carrier('remount', { id: 'station:anchorage' });
  check('and it re-mounts back onto its own conic',
        back.error === undefined, back.error);

  return {
    valid: true,
    fails,
    checks,
    ok: fails.length === 0,
    disagreementDeg: { worst: worstAngle, growth: growthDeg, spanTicks,
                       turnedOverSpan: turnedOverSpanDeg, series },
    posGapM: posGap,
    drivenClock: {
      appliedDelta: dApplied, drawnDelta: dDrawn,
      lastTick: c1.lastTick, lastDrawnTick: c1.lastDrawnTick,
      pausedDrawnDelta: p1.drawn - p0.drawn,
      watchers: c1.watchers,
    },
    control: { turnedDeg: moved, angleOnInstrumentDeg: spun.angleDeg },
  };
})()
