// =============================================================================
// Autopilot.ts - THE SEAM BETWEEN REID'S AUTOPILOT SCREENS AND THE FLIGHT LANE.
//
// GP-262. This file is the CONTRACT, written down before the other side of it
// exists, and it is deliberately the only place in the client that knows the
// names `of_ap_*`. Two rules run the whole design and both are the expensive
// kind of lesson:
//
//  1. THIS CLIENT DOES NOT COMPUTE DELTA-V. Not the vehicle's, not the
//     mission's, not "just for the gate". `of_vs_total_dv_vacuum` is the
//     physics lane's number and R43 has just proved how badly a second opinion
//     can be wrong: a stage mixing a solid booster with a liquid engine
//     published 656.02 m/s for a stage that really carries 3890.36, because one
//     kind's propellant was divided by every engine's mass flow. A gate built
//     on the old figure would have refused rockets that fly. So the gate waits
//     for their number and says so.
//
//  2. A LIVE CRAFT AND A DESIGN ARE DIFFERENT SUBJECTS (R44b). `of_fl_create`
//     does `f->craft = *p`, so the blueprint never burns a gram: after staging
//     for real, the DESIGN handle still reports its pad figures. Anything on
//     screen that says "remaining" must come off the FLIGHT handle
//     (`of_fl_stage_performance`, ABI 22), and the two calls below are split on
//     exactly that line, `designReach` for the bay and `flightReach` for the
//     map. No refresh cadence can fix reading the wrong object, so the fix is
//     to have two named functions and never one.
//
// -----------------------------------------------------------------------------
// PUBLISHED ASK TO THE PHYSICS LANE (gameplay -> physics, GP-262).
//
// Four exports, none of which stores anything, all pure functions of a handle
// plus the target's own elements. The client supplies NO mu and NO body radius,
// for the reason `of_maneuver_api.inc` already states: they come off the
// handle's own FlightEnvironment, and a JS-supplied mu would be a second
// gravity (DW-18).
//
//  A. of_ap_design_reach(v, smaM, ecc, incRad, lanRad)
//     v is a VESSEL DESIGN handle (of_vs_*), assumed on the pad. Answers "can
//     this vehicle, as drawn, get to that orbit at all". -> AP_REACH_WORDS.
//
//  B. of_ap_flight_reach(f, tDepartFromNowS, smaM, ecc, incRad, lanRad,
//                        argpRad, taRad, epochS)
//     f is a LIVE FLIGHT handle. Same words, for a departure at one time.
//     `taRad` NaN means the target has no phase (a bare requested orbit), so
//     there is no phase angle and no window.
//
//  C. of_ap_departure_curve(f, tStartS, tEndS, samples, ...same target words)
//     THE CHART. Reid asked to see "how optimal the current time would be to
//     launch vs waiting later", which is a CURVE and not a number, and it is
//     also what makes his scheduling rule legible. -> the SAMPLE count; f64
//     scratch holds count * AP_CURVE_WORDS.
//
//  D. of_ap_plan(f, tDepartFromNowS, ...same target words)
//     The burn itself, in `of_mn_plan`'s own 26 words IN THE SAME ORDER so one
//     reader serves both, followed by the post-burn position and velocity so
//     `of_mn_path` can draw the planned conic with no second propagator.
//
// EXECUTION (arm / cancel / status) is deliberately NOT asked for here. It is
// the half that commands the vehicle and it belongs entirely to the flight
// lane's own state machine; this file will consume whatever shape they publish.
// Planning is the half the screens need and it is a pure function.
// -----------------------------------------------------------------------------
import type { OfCoreModule } from '../sim/wasm/heap.js';
import { scratchF64 } from '../sim/wasm/heap.js';
import type { AutopilotTarget, TargetOrbit } from './AutopilotTargets.js';
import type { DesignPart } from './VesselDesign.js';

/**
 * The autopilot part. `vessel.h`'s PartId space reserves 0x010D..0x010F as a
 * gap between Tier 1 and Tier 2 and `of_vessel_api.inc` says so in as many
 * words, so this is the allocated slot and not a guess. The catalogue row is
 * `/core`'s to author (physics own `vessel.h`); until it lands, `moduleFitted`
 * reports the absence BY NAME rather than silently unlocking the feature.
 */
export const AUTOPILOT_PART_ID = 0x010d;

export const AP_REACH_WORDS = 10;
export const AP_CURVE_WORDS = 4;
/** `of_mn_plan`'s 26, then post-burn [px,py,pz,vx,vy,vz]. */
export const AP_PLAN_WORDS = 32;

/** Every export this file needs, so one list drives detection and the message. */
export const AP_EXPORTS = [
  '_of_ap_design_reach', '_of_ap_flight_reach',
  '_of_ap_departure_curve', '_of_ap_plan',
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

function apModule(M: OfCoreModule): ApModule | null {
  return apMissing(M).length === 0 ? (M as unknown as ApModule) : null;
}

/** One leg of the budget, so the screen can show WHERE the fuel goes and not
 *  just a total. Labels are fixed here; the numbers are all physics'. */
export const REACH_LEGS = ['ascent', 'plane change', 'transfer', 'arrival',
  'reserve'] as const;

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

function pending(missing: readonly string[]): Reach {
  return { ...PENDING, waitingOn: missing.join(', ') };
}

function readReach(M: OfCoreModule, got: number): Reach {
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

/**
 * IS AN AUTOPILOT MODULE ON THIS VEHICLE. The brief's rule, verbatim: no
 * module, no planner.
 *
 * Returns a reason rather than a bare false, and the reason distinguishes the
 * two states that look identical from the player's chair: the part is not on
 * the rocket, or the part does not exist in this build's catalogue at all. The
 * second is a broken build and must never read as "you forgot to fit one".
 */
export interface ModuleFit {
  fitted: boolean;
  /** '' when fitted. */
  reason: string;
  /** True when /core publishes no such part, i.e. the catalogue row is not in
   *  yet. A DIFFERENT condition from "not fitted" and it says so. */
  partMissingFromCatalogue: boolean;
  count: number;
}

export function moduleFitted(parts: readonly DesignPart[],
                             catalogueIds: readonly number[]): ModuleFit {
  const known = catalogueIds.includes(AUTOPILOT_PART_ID);
  const count = parts.filter((p) => p.partId === AUTOPILOT_PART_ID).length;
  if (!known) {
    return {
      fitted: false, count: 0, partMissingFromCatalogue: true,
      reason: `this build has no part 0x${AUTOPILOT_PART_ID.toString(16)} in `
        + 'the catalogue, so no vehicle can carry an autopilot yet. The '
        + 'catalogue row belongs to /core (vessel.h) and is not in.',
    };
  }
  if (count === 0) {
    return {
      fitted: false, count: 0, partMissingFromCatalogue: false,
      reason: 'no Autopilot Module on this vehicle: fit one from the Ctrl tab '
        + 'and the destination planner turns on.',
    };
  }
  return { fitted: true, count, partMissingFromCatalogue: false, reason: '' };
}

/** The one sentence a screen prints when the solver is not on the bridge. It
 *  lives here so the bay and the map cannot word it differently. */
export function waitingSentence(waitingOn: string): string {
  return `the transfer solver is not on this bridge yet: waiting for `
    + `${waitingOn}. The vehicle figures beside this are /core's own and are `
    + `live; only the mission cost is missing.`;
}

/** Everything a screen needs about one destination, in one object, so the bay
 *  and the map ask the same question of the same shape. */
export interface DestinationView {
  target: AutopilotTarget | null;
  fit: ModuleFit;
  reach: Reach;
}
