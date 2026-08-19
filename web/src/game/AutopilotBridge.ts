// The autopilot ABI bridge: detecting which of_ap_* exports exist, and the
// Reach shape both designReach/flightReach and the curve functions return.
// Split out of Autopilot.ts (line-cap batch 2, BT-285): apModule/apMissing
// and the Reach reader are called from every other group in this file, so
// they are the one thing everything else here imports.

import type { OfCoreModule } from '../sim/wasm/heap.js';
import { scratchF64 } from '../sim/wasm/heap.js';
import type { TargetOrbit } from './AutopilotTargets.js';

/**
 * The autopilot part. `vessel.h`'s PartId space reserves 0x010D..0x010F as a
 * gap between Tier 1 and Tier 2 and `of_vessel_api.inc` says so in as many
 * words, so this is the allocated slot and not a guess. The catalogue row is
 * `/core`'s to author (physics own `vessel.h`); until it lands, `moduleFitted`
 * reports the absence BY NAME rather than silently unlocking the feature.
 */
export const AUTOPILOT_PART_ID = 0x010d;

/**
 * Its ITEM form, which is what `research.h` gates on. `of_vessel_api.inc` maps
 * `ItemId = 0x0050 + (PartId - 0x0100)`, so this is 0x005D. It is written out
 * rather than computed from `AUTOPILOT_PART_ID` deliberately: the mapping is
 * /core's and a client that re-derived it would be a second copy of a formula
 * that already has two (the bridge owns it, `research.h` carries a
 * `static_assert`-pinned copy). A wrong value here would gate the part on an
 * item nobody can ever hold, which reads on screen as "not researched" for
 * ever, so `probes/vabdest.js` asserts it against the catalogue's own row.
 */
export const AUTOPILOT_ITEM_ID = 0x005d;

export const AP_REACH_WORDS = 10;
export const AP_CURVE_WORDS = 4;
/** `of_mn_plan`'s 26, then post-burn [px,py,pz,vx,vy,vz]. */
export const AP_PLAN_WORDS = 32;

/** Every export this file needs, so one list drives detection and the message. */
export const AP_EXPORTS = [
  '_of_ap_design_reach', '_of_ap_flight_reach',
  '_of_ap_departure_curve', '_of_ap_plan',
  // GP-295, R74. The moon's own chart. Same shapes as the two above, so ONE
  // client reader serves the station and the world, which is the point of
  // physics having published them in `apPushReach`'s row exactly.
  '_of_ap_body_departure_curve', '_of_ap_body_reach',
] as const;

interface ApModule {
  _of_ap_design_reach(v: number, sma: number, ecc: number, inc: number,
                      lan: number): number;
  _of_ap_flight_reach(f: number, t: number, sma: number, ecc: number,
                      inc: number, lan: number, argp: number, ta: number,
                      epoch: number): number;
  _of_ap_departure_curve(f: number, t0: number, t1: number, n: number,
                         sma: number, ecc: number, inc: number, lan: number,
                         argp: number, ta: number, epoch: number): number;
  _of_ap_plan(f: number, t: number, sma: number, ecc: number, inc: number,
              lan: number, argp: number, ta: number, epoch: number): number;
  _of_ap_body_departure_curve(f: number, t0: number, t1: number, n: number,
                              bodyId: number, captureAltM: number): number;
  _of_ap_body_reach(f: number, t: number, bodyId: number,
                    captureAltM: number): number;
}

/**
 * WHICH OF THE FOUR ARE ON THE BRIDGE. Returns the missing names, never a bare
 * boolean: "the autopilot solver is not here" and "three of four are here and
 * the curve is not" are different states, and a screen that cannot tell them
 * apart is the class of defect GP-62 fixed by making an absent export a
 * PUBLISHED SEAM that names what it is waiting for.
 */
export function apMissing(M: OfCoreModule): string[] {
  const m = M as unknown as Record<string, unknown>;
  // Detected on the JS symbol (`_of_ap_plan`), REPORTED as the C name
  // (`of_ap_plan`), because the name on screen is the one the physics lane
  // has to write and an underscore nobody typed is a name nobody can grep.
  return AP_EXPORTS.filter((n) => typeof m[n] !== 'function')
    .map((n) => n.replace(/^_/, ''));
}

export function apModule(M: OfCoreModule): ApModule | null {
  return apMissing(M).length === 0 ? (M as unknown as ApModule) : null;
}

export interface Reach {
  /**
   * '' when this is a real answer. Otherwise the exact export name that has to
   * exist for it to become one. Printed on screen verbatim: a gate that is
   * quietly absent is indistinguishable from a gate that passed.
   */
  waitingOn: string;
  ok: boolean;
  dvRequiredMS: number;
  /** THE PHYSICS LANE'S NUMBER, off /core, never re-derived here. */
  dvAvailableMS: number;
  marginMS: number;
  feasible: boolean;
  /** REACH_LEGS order. Empty while `waitingOn` is set. */
  legsMS: number[];
}

const PENDING: Reach = {
  waitingOn: '', ok: false, dvRequiredMS: NaN, dvAvailableMS: NaN,
  marginMS: NaN, feasible: false, legsMS: [],
};

export function pending(missing: readonly string[]): Reach {
  return { ...PENDING, waitingOn: missing.join(', ') };
}

export function readReach(M: OfCoreModule, got: number): Reach {
  if (got !== AP_REACH_WORDS) {
    // Same rule as the catalogue stride (GP-159): a bridge you do not agree
    // with is refused, never tolerated. It reads as pending rather than as a
    // throw because a planner screen is not the boot path.
    return { ...PENDING, waitingOn: `of_ap_*: stride ${got}, expected ${AP_REACH_WORDS}` };
  }
  const f = scratchF64(M, AP_REACH_WORDS);
  return {
    waitingOn: '', ok: (f[0] ?? 0) > 0.5,
    dvRequiredMS: f[1] ?? NaN, dvAvailableMS: f[2] ?? NaN,
    marginMS: f[3] ?? NaN, feasible: (f[4] ?? 0) > 0.5,
    legsMS: [f[5] ?? 0, f[6] ?? 0, f[7] ?? 0, f[8] ?? 0, f[9] ?? 0],
  };
}

/** THE BAY'S QUESTION: can this design, on the pad, reach that orbit at all. */
export function designReach(M: OfCoreModule, designHandle: number,
                            o: TargetOrbit): Reach {
  const A = apModule(M);
  if (A === null) return pending(apMissing(M));
  return readReach(M, A._of_ap_design_reach(designHandle, o.semiMajorAxisM,
    o.eccentricity, o.inclinationRad, o.lanRad));
}

/** THE MAP'S QUESTION: can the vehicle I am flying reach it, leaving at t. */
export function flightReach(M: OfCoreModule, flightHandle: number,
                            tDepartS: number, o: TargetOrbit): Reach {
  const A = apModule(M);
  if (A === null) return pending(apMissing(M));
  return readReach(M, A._of_ap_flight_reach(flightHandle, tDepartS,
    o.semiMajorAxisM, o.eccentricity, o.inclinationRad, o.lanRad, o.argpRad,
    o.trueAnomalyRad, o.epochS));
}

/**
 * GP-295. DO THE FIVE LEGS ADD UP TO THE TOTAL. Returns the signed error.
 *
 * Physics added two exports in one commit that disagreed by 53.1 m/s about one
 * trip, because the reach row and the chart priced arrival differently, and
 * after the obvious half was substituted 6.5 m/s of the old capture was still
 * buried in the plane-change allocation. This sum is the check that found it,
 * and it costs one addition, so the client runs it too: a row where every
 * number arrives and one sits under the wrong heading is exactly what it
 * catches, and nothing else on the screen can.
 */
export function legSumErrorMS(r: Reach): number {
  if (r.legsMS.length === 0) return NaN;
  return r.legsMS.reduce((a, b) => a + b, 0) - r.dvRequiredMS;
}
