// The departure curve: sampling dv-required over a window of departure times,
// for the orbit chart and the moon chart alike. Split out of Autopilot.ts
// (line-cap batch 2, BT-285): reaches into AutopilotBridge.ts for apModule/
// apMissing/readReach, and calls into nothing else in this file.

import type { OfCoreModule } from '../sim/wasm/heap.js';
import { scratchF64 } from '../sim/wasm/heap.js';
import type { TargetOrbit } from './AutopilotTargets.js';
import { apMissing, apModule, pending, readReach, AP_CURVE_WORDS, type Reach }
  from './AutopilotBridge.js';

export interface CurveSample {
  /** Seconds from now. */
  tS: number;
  dvRequiredMS: number;
  feasible: boolean;
  arrivalFromNowS: number;
}

export interface Curve {
  waitingOn: string;
  samples: CurveSample[];
}

/**
 * THE DEPARTURE CURVE, and the reason Reid's rule needs it.
 *
 * His rule is per-departure-time and not global: refuse a destination you
 * cannot reach NOW, but ALLOW scheduling one you will be able to reach at a
 * better time. That is only a coherent rule if "can I reach it" is a function
 * of when you go, and this is that function sampled. `bestIndex` below is the
 * cheapest departure and `firstFeasibleIndex` is the earliest one you could
 * actually fly, and those are different questions.
 */
export function departureCurve(M: OfCoreModule, flightHandle: number,
                               tStartS: number, tEndS: number, samples: number,
                               o: TargetOrbit): Curve {
  const A = apModule(M);
  if (A === null) return { waitingOn: apMissing(M).join(', '), samples: [] };
  const n = A._of_ap_departure_curve(flightHandle, tStartS, tEndS, samples,
    o.semiMajorAxisM, o.eccentricity, o.inclinationRad, o.lanRad, o.argpRad,
    o.trueAnomalyRad, o.epochS);
  if (n <= 0) return { waitingOn: '', samples: [] };
  const f = scratchF64(M, n * AP_CURVE_WORDS).slice();
  const out: CurveSample[] = [];
  for (let k = 0; k < n; ++k) {
    const b = k * AP_CURVE_WORDS;
    out.push({
      tS: f[b] ?? 0, dvRequiredMS: f[b + 1] ?? NaN,
      feasible: (f[b + 2] ?? 0) > 0.5, arrivalFromNowS: f[b + 3] ?? 0,
    });
  }
  return { waitingOn: '', samples: out };
}

/**
 * GP-295. THE MOON'S CHART, and it reuses `readReach` and the curve loop above
 * because physics published the same two shapes on purpose.
 *
 * THREE THINGS ABOUT IT THAT ARE NOT TRUE OF THE ORBIT CHART, all of them
 * physics' own corrections and all of them things a client can get wrong:
 *
 *  1. **NaN MEANS THE ARM WILL REFUSE THIS DEPARTURE**, not "no data". Their
 *     first version priced the requested-orbit capture while the arm used the
 *     arrival hyperbola's own periapsis, and it quoted confident prices for 22
 *     of 121 departures the arm then refused, with its cheapest eleven samples
 *     away from the arm's. So a gap is drawn as a gap and NOTHING interpolates
 *     across it, which `MapPlannerPanel.chart` already does correctly because
 *     it emits one polyline per solved run.
 *  2. **ZERO SAMPLES IS A REFUSAL**, not an empty window. An unknown body
 *     returns 0 rather than a chart of NaNs, because those were
 *     indistinguishable from "this moon is unreachable for the next orbit".
 *  3. **WORDS 5 TO 9 SUM TO WORD 1**, and asserting it is what caught two
 *     exports in one commit disagreeing by 53.1 m/s about one trip, with 6.5
 *     of the old capture still buried inside the plane-change allocation after
 *     the obvious half was fixed.
 */
export function bodyDepartureCurve(M: OfCoreModule, flightHandle: number,
                                   tStartS: number, tEndS: number,
                                   samples: number, bodyId: number,
                                   captureAltM: number): Curve {
  const A = apModule(M);
  if (A === null) return { waitingOn: apMissing(M).join(', '), samples: [] };
  const n = A._of_ap_body_departure_curve(flightHandle, tStartS, tEndS, samples,
                                          bodyId, captureAltM);
  if (n <= 0) return { waitingOn: '', samples: [] };
  const f = scratchF64(M, n * AP_CURVE_WORDS).slice();
  const out: CurveSample[] = [];
  for (let k = 0; k < n; ++k) {
    const b = k * AP_CURVE_WORDS;
    out.push({
      tS: f[b] ?? 0, dvRequiredMS: f[b + 1] ?? NaN,
      feasible: (f[b + 2] ?? 0) > 0.5, arrivalFromNowS: f[b + 3] ?? 0,
    });
  }
  return { waitingOn: '', samples: out };
}

/** The moon's reach row, in `apPushReach`'s own ten words. */
export function bodyReach(M: OfCoreModule, flightHandle: number,
                          tDepartS: number, bodyId: number,
                          captureAltM: number): Reach {
  const A = apModule(M);
  if (A === null) return pending(apMissing(M));
  return readReach(M, A._of_ap_body_reach(flightHandle, tDepartS, bodyId,
                                          captureAltM));
}

/** The cheapest sample, or -1 on an empty curve. */
export function bestIndex(c: Curve): number {
  let best = -1;
  for (let k = 0; k < c.samples.length; ++k) {
    const s = c.samples[k];
    if (s === undefined || !Number.isFinite(s.dvRequiredMS)) continue;
    const b = c.samples[best];
    if (best < 0 || b === undefined || s.dvRequiredMS < b.dvRequiredMS) best = k;
  }
  return best;
}

/** The EARLIEST sample the vehicle could actually fly, or -1 if none can be.
 *  This is the one Reid's scheduling rule turns on, and it is deliberately not
 *  the same question as `bestIndex`: the cheapest window and the first flyable
 *  window are different, and a screen that conflated them would let a player
 *  schedule a departure they still cannot afford. */
export function firstFeasibleIndex(c: Curve): number {
  return c.samples.findIndex((s) => s.feasible);
}
