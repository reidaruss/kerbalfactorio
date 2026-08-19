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
//
// Split (line-cap batch 2, BT-285) into AutopilotBridge.ts (the of_ap_*
// detection and the Reach shape), AutopilotCurve.ts (the departure curve),
// AutopilotFit.ts (is a module fitted) and AutopilotPlan.ts (the plan and
// the scheduling rule); this file stays the barrel, holding the two display
// constants every screen shares, and re-exports every symbol a consumer
// imported from here before the split.

export {
  AUTOPILOT_PART_ID, AUTOPILOT_ITEM_ID, AP_REACH_WORDS, AP_CURVE_WORDS,
  AP_PLAN_WORDS, AP_EXPORTS, apMissing, designReach, flightReach,
  legSumErrorMS, type Reach,
} from './AutopilotBridge.js';
export {
  departureCurve, bodyDepartureCurve, bodyReach, bestIndex,
  firstFeasibleIndex, type CurveSample, type Curve,
} from './AutopilotCurve.js';
export {
  moduleFitted, waitingSentence, type ModuleFit, type DestinationView,
} from './AutopilotFit.js';
export {
  planTransfer, scheduleFor, type TransferPlan, type ScheduleVerdict,
  type Schedule,
} from './AutopilotPlan.js';

export const REACH_LEGS = ['ascent', 'plane match', 'transfer', 'arrival',
  'reserve'] as const;

/** The sentence a leg needs beside it, or '' for the ones that speak for
 *  themselves. Shown only when the leg is drawn, so an all-coplanar transfer
 *  never explains a line it did not print. */
export const LEG_NOTE: Record<string, string> = {
  'plane match': 'priced inside the departure burn, not a separate one: there '
    + 'is no cheaper route that skips it.',
  reserve: 'policy, 5%: a gate that says yes at zero margin says yes to a '
    + 'mission that fails.',
};
