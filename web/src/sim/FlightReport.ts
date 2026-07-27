// The READ side of a flight: the per-stage table out of /core, and the numbers
// a probe asserts on. Split out of FlightSession only because that file is at
// the 400-line cap; nothing here decides anything.
import { scratchF64 } from './wasm/heap.js';
import type { OfCoreModule } from './wasm/heap.js';
import { STAGE_PERF_WORDS, vesselAbi } from './wasm/vesselabi.js';
import { dot, len } from './FlightAbi.js';
import type { FlightSession, FlightStageRow } from './FlightSession.js';

export function round(v: number, d: number): number {
  if (!Number.isFinite(v)) return v;
  const m = 10 ** d;
  return Math.round(v * m) / m;
}

/**
 * Per-stage delta-v straight out of `of_vs_stage_performance`. DW-30 item 4
 * makes this readout non-negotiable, so it is read on every structural change
 * and NEVER estimated here: if a number on the navball disagrees with
 * core/tests/test_vessel.cpp, the navball is wrong.
 *
 * It takes the DESIGN handle, not the flight handle, and that is not a
 * convenience. `of_vs_*` and `of_fl_*` are separate registries that both number
 * from 1, so passing a flight handle here silently answers about whatever
 * vessel happens to hold the same integer. The per-stage table is a property of
 * the vehicle AS BUILT and is what the assembly view shows; what the flown craft
 * has left is `of_fl_remaining_dv_vacuum`, which is a different question and a
 * different call.
 *
 * The stage TWR uses sea-level thrust against the stage's own start mass and
 * `of_gravity_accel` at the datum, which is the number a player judges a pad
 * departure by. mu/r^2 is the one gravity authority (DW-18); kG0 is a unit
 * conversion and takes no part in it (PH-18).
 */
export function readStagePerformance(
  M: OfCoreModule, designHandle: number, bodyHandle: number, bodyRadiusM: number,
): FlightStageRow[] {
  if (designHandle <= 0) return [];
  const n = vesselAbi(M)._of_vs_stage_performance(designHandle);
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
    verticalMS: round(dot(s.state.vel, s.up), 2),
    apoapsisM: round(o.apoapsisAltM, 1), periapsisM: round(o.periapsisAltM, 1),
    eccentricity: round(o.eccentricity, 5), periodS: round(o.periodS, 1),
    bound: o.bound,
    throttle: round(s.throttleValue, 3), sas: s.sasName, warp: s.warpFactor,
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
