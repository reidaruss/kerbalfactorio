// The READ side of a flight: the per-stage table out of /core, and the numbers
// a probe asserts on. Split out of FlightSession only because that file is at
// the 400-line cap; nothing here decides anything.
import { scratchF64 } from './wasm/heap.js';
import type { OfCoreModule } from './wasm/heap.js';
import { STAGE_PERF_WORDS, vesselAbi } from './wasm/vesselabi.js';
import { dot, flightParts, len } from './FlightAbi.js';
import type { FlightSession, FlightStageRow } from './FlightSession.js';

export function round(v: number, d: number): number {
  if (!Number.isFinite(v)) return v;
  const m = 10 ** d;
  return Math.round(v * m) / m;
}

/**
 * HOW MUCH PROPELLANT IS ABOARD RIGHT NOW, re-read from /core (R44).
 *
 * IT IS A RE-READ AND NOT A CACHE, and that is the whole point of the function.
 * `FlightSession.propellantKg` used to sum the session's cached `partRows`, and
 * those are rewritten only by `refreshParts`, which runs on a roll-out and on a
 * staging and at no other time. So the reported total was the amount aboard at
 * the last STAGING and did not move while an engine burned. `probes/stagedv.js`
 * measured it: 6490 kg reported for a whole ascent while the live per-tank read
 * went 6194.4 -> 3413.3 kg. `probes/radialdrain.js` lost an entire pass to it,
 * reading a flat trace off a burn that was draining correctly.
 *
 * IT IS DELIBERATELY NOT `refreshParts`. That call also bumps the session's
 * `partsRevision`, which is what `FlightMode` diffs to decide whether to REBUILD
 * every drawn mesh on the craft (`FlightMode.ts`, `drawnRevision`), so putting
 * it on a per-frame path would rebuild the vehicle's geometry every frame to
 * refresh a number. This is a pure read: one `_of_fl_parts` and one
 * `_of_fl_transforms`, MEASURED at 0.008 ms on the 11-part reference vehicle
 * against a 0.0095 ms `refreshParts` and a p50 frame of 3.2 ms.
 */
export function propellantAboardKg(M: OfCoreModule, handle: number): number {
  if (handle <= 0) return 0;
  let kg = 0;
  for (const q of flightParts(M, handle)) kg += q.propellantKg;
  return kg;
}

/**
 * Per-stage delta-v straight out of `of_fl_stage_performance`. DW-30 item 4
 * makes this readout non-negotiable, so it is read from /core and NEVER
 * estimated here: if a number on the navball disagrees with
 * core/tests/test_vessel.cpp, the navball is wrong.
 *
 * R44b, CLOSED at ABI 22, AND IT LIVED HERE. This used to take the DESIGN
 * handle and call `of_vs_stage_performance`. `of_fl_create` does `f->craft = *p`,
 * so the design is a blueprint the rocket was COPIED out of and it never burns
 * a gram: the table on the navball (`ui/Navball.ts` `table()`, via
 * `app/FlightReadout.ts`) was a CONSTANT for the whole flight and no refresh
 * cadence could fix it, because the object being read was the wrong object.
 * `probes/stagedv.js` measured it the deciding way, by staging for real and
 * finding the jettisoned stage 0 still reporting all 1857.79 m/s with its
 * engine and its tank physically off the vehicle. The fix was the new export,
 * because `vessel::stagePerformance` takes a `Vessel&` and `FlightSim::craft`
 * is the drained one that no `of_fl_*` export reached.
 *
 * IT TAKES THE FLIGHT HANDLE. `of_vs_*` and `of_fl_*` are separate registries
 * that both number from 1, so passing the wrong one here silently answers about
 * whatever vessel happens to hold the same integer. The assembly view keeps
 * `of_vs_stage_performance` on the design, which is the right subject there:
 * the vehicle AS BUILT is exactly what a player is editing.
 *
 * The stage TWR uses sea-level thrust against the stage's own start mass and
 * `of_gravity_accel` at the datum, which is the number a player judges a pad
 * departure by. mu/r^2 is the one gravity authority (DW-18); kG0 is a unit
 * conversion and takes no part in it (PH-18).
 *
 * `fullThrustS` (ABI 22, word 12) is carried alongside `burnS`. They differ only
 * on a stage lighting more than one propellant kind, where the stage holds its
 * ignition thrust to the first flameout and then runs on what is left to the
 * last (R43).
 */
export function readStagePerformance(
  M: OfCoreModule, flightHandle: number, bodyHandle: number, bodyRadiusM: number,
): FlightStageRow[] {
  if (flightHandle <= 0) return [];
  const n = vesselAbi(M)._of_fl_stage_performance(flightHandle);
  if (n <= 0) return [];
  // GRAVITY FIRST, THEN THE VIEW. `scratchF64` hands back a SUBARRAY of the
  // heap, not a copy, and the rule (`FlightAbi.ts`) is that nothing may call
  // into WASM between taking one and reading it: `ALLOW_MEMORY_GROWTH` detaches
  // every outstanding view, and then all twelve `?? 0` fallbacks below fire at
  // once and the whole per-stage delta-v table silently reads zero. It has been
  // safe only because `_of_gravity_accel` happens not to allocate today, which
  // is a property of a function this file does not own. Reordering is free.
  const g = M._of_gravity_accel(bodyHandle, bodyRadiusM);
  const a = scratchF64(M, n * STAGE_PERF_WORDS);
  const out: FlightStageRow[] = [];
  for (let i = 0; i < n; ++i) {
    const q = i * STAGE_PERF_WORDS;
    const m0 = a[q + 1] ?? 0;
    const thrustSl = a[q + 7] ?? 0;
    out.push({
      index: a[q] ?? i, dvVacMS: a[q + 9] ?? 0, burnS: a[q + 11] ?? 0,
      fullThrustS: a[q + 12] ?? 0,
      thrustVacN: a[q + 6] ?? 0, propellantKg: a[q + 3] ?? 0,
      twr: m0 > 0 && g > 0 ? thrustSl / (m0 * g) : 0,
    });
  }
  return out;
}

/** Everything `__of.flight('report')` returns. Reads only public state. */
export function flightReport(s: FlightSession): unknown {
  const tm = s.telemetry;
  const o = s.orbit;
  return {
    live: s.live, status: s.status, metS: round(s.metS, 2),
    clamped: s.clamped, liftedOff: s.liftedOff,
    altitudeAglM: round(s.altitudeAglM, 2),
    altitudeDatumM: round(tm.altitudeM, 2),
    peakAltM: round(s.peakAltM, 1),
    // THE STATE, NOT THE TELEMETRY. `FlightSession.step` says it out loud for
    // the arrest: telemetry is written by `of_fl_step` and by nothing else, so
    // after a landing it still holds the IMPACT speed forever. The navball
    // reads the state and this read the telemetry, so the same quantity had two
    // values that disagreed only in the one state nothing asserts on.
    speedMS: round(len(s.state.vel), 2),
    // PH-111. WHERE THE LIVE SIM SAYS IT IS, and it was not published before,
    // which is how two authorities for one rocket drifted 6829.55 m apart in
    // three seconds without any instrument being able to say so. `railsAt`
    // answers for the RECORD's conic; this answers for the `/core` FlightSim,
    // and an EVA is the first state in which those two can disagree.
    //
    // DELIBERATELY NOT ROUNDED, unlike every other figure on this report. The
    // assertion it exists for is "these two agree", and rounding to centimetres
    // would conceal a disagreement under a centimetre while appearing to prove
    // there was none.
    pos: [s.state.pos[0], s.state.pos[1], s.state.pos[2]],
    baseOffsetM: s.baseOffsetM,
    verticalMS: round(dot(s.state.vel, s.up), 2),
    apoapsisM: round(o.apoapsisAltM, 1), periapsisM: round(o.periapsisAltM, 1),
    eccentricity: round(o.eccentricity, 5), periodS: round(o.periodS, 1),
    bound: o.bound,
    throttle: round(s.throttleValue, 3), sas: s.sasName, warp: s.warpFactor,
    // R73. The roll BEFORE stability assist damps it, and how hard it is
    // damping. Published because the damper rewrites the very field the navball
    // draws, so without these two an instrument that is silently repairing its
    // own input reads identically to a vessel flying straight.
    rollBeforeHoldDeg: round(s.rollBeforeHoldDeg, 4),
    rollHeldDegS: round(s.rollHeldDegS, 4),
    massKg: round(tm.massKg, 1), thrustN: round(tm.thrustN, 0),
    twr: round(s.currentTwr(), 4),
    qPa: round(tm.qPa, 1), maxQPa: round(s.maxQPa, 1),
    aoaDeg: round((tm.aoaRad * 180) / Math.PI, 3),
    sasErrDeg: round((tm.sasErrorRad * 180) / Math.PI, 3),
    inSpace: tm.inSpace, onRails: s.onRails(),
    parts: s.partRows.length, stagings: s.stagings, steps: s.steps,
    nextStage: s.nextStageIndex(),
    propellantKg: round(s.propellantKg(), 1),
    remainingDvMS: round(s.remainingDvMS(), 1),
    totalDvMS: round(s.totalDvMS(), 2),
    stages: s.stageRows.map((q) => ({
      index: q.index, dv: round(q.dvVacMS, 2), twr: round(q.twr, 4),
      burnS: round(q.burnS, 2),
    })),
    message: s.message,
    clampTicks: s.clampTicks, clampStepOk: s.clampStepOk,
    timeS: round(s.state.timeS, 3),
  };
}
