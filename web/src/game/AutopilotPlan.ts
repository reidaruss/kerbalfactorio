// The transfer plan itself, and Reid's per-departure-time scheduling rule.
// Split out of Autopilot.ts (line-cap batch 2, BT-285): planTransfer reaches
// into AutopilotBridge.ts for apModule; scheduleFor reaches into
// AutopilotCurve.ts for bestIndex/firstFeasibleIndex.

import type { OfCoreModule } from '../sim/wasm/heap.js';
import { scratchF64 } from '../sim/wasm/heap.js';
import type { TargetOrbit } from './AutopilotTargets.js';
import { apModule, AP_PLAN_WORDS } from './AutopilotBridge.js';
import { bestIndex, firstFeasibleIndex, type Curve } from './AutopilotCurve.js';

// =============================================================================
// GP-271: THE PLAN, AND THE CONIC IT DRAWS.
//
// `of_ap_plan` returns `of_mn_plan`'s own 26 words IN THE SAME ORDER, then the
// post-burn position and velocity. That ordering is not a convenience: it means
// the map's transfer arc and the map's manual maneuver arc are drawn by ONE
// reader from ONE shape, so the two can never disagree about what a planned
// orbit looks like. Words 26 to 31 go straight into `of_mn_path`, which is the
// propagator the map already uses, so nothing here integrates anything.
// =============================================================================
export interface TransferPlan {
  valid: boolean;
  /** The burn, in the same words the manual node publishes. */
  deltaVMS: number;
  timeToNodeS: number;
  timeToBurnStartS: number;
  burnDurationS: number;
  deltaVAvailableMS: number;
  shortfallMS: number;
  feasible: boolean;
  stagesUsed: number;
  /** The orbit the burn produces. */
  apoapsisAltM: number;
  periapsisAltM: number;
  eccentricity: number;
  periodS: number;
  boundAfter: boolean;
  /** Where the burn happens, and the state AFTER it, for `of_mn_path`. */
  nodePosM: [number, number, number];
  postBurnPosM: [number, number, number];
  postBurnVelMS: [number, number, number];
}

export function planTransfer(M: OfCoreModule, flightHandle: number,
                             tDepartS: number, o: TargetOrbit): TransferPlan | null {
  const A = apModule(M);
  if (A === null) return null;
  const got = A._of_ap_plan(flightHandle, tDepartS, o.semiMajorAxisM,
    o.eccentricity, o.inclinationRad, o.lanRad, o.argpRad, o.trueAnomalyRad,
    o.epochS);
  if (got !== AP_PLAN_WORDS) return null;
  const f = scratchF64(M, AP_PLAN_WORDS).slice();
  const at = (i: number): number => f[i] ?? 0;
  return {
    valid: at(0) > 0.5,
    deltaVMS: at(10), timeToNodeS: at(11), timeToBurnStartS: at(12),
    burnDurationS: at(13), deltaVAvailableMS: at(15), shortfallMS: at(16),
    feasible: at(17) > 0.5, stagesUsed: at(18),
    apoapsisAltM: at(20), periapsisAltM: at(21), eccentricity: at(23),
    periodS: at(24), boundAfter: at(25) > 0.5,
    nodePosM: [at(1), at(2), at(3)],
    postBurnPosM: [at(26), at(27), at(28)],
    postBurnVelMS: [at(29), at(30), at(31)],
  };
}

/**
 * REID'S SCHEDULING RULE, AS ONE FUNCTION.
 *
 * Verbatim: "It should not let you program in a destination for autopilot if
 * you do not have enough fuel to reach it, but you should be able to set it to
 * a later time if you dont have enough fuel right now but will at a more
 * optimal time."
 *
 * So the gate is PER DEPARTURE TIME and never global, and that is the whole
 * design. Three states, not two:
 *
 *   'go'     you can fly it at the time currently chosen.
 *   'wait'   you cannot fly it now, but there IS a departure on this curve you
 *            could fly. That is a SCHEDULE, not a refusal, and the chart is
 *            what makes it legible: the player can see the dip they are
 *            waiting for.
 *   'never'  no sampled departure is affordable. This is the only refusal, and
 *            it is a refusal about the VEHICLE rather than about the clock.
 *
 * `firstFeasibleIndex` and `bestIndex` are deliberately separate: the earliest
 * flyable window and the cheapest one are different questions, and a screen
 * that conflated them would offer to schedule a departure the player still
 * cannot afford.
 */
export type ScheduleVerdict = 'go' | 'wait' | 'never';

export interface Schedule {
  verdict: ScheduleVerdict;
  /** Index into the curve of the earliest departure that can be flown, or -1. */
  earliest: number;
  /** Index of the cheapest departure, or -1. */
  cheapest: number;
  /** The sample the player currently has selected. */
  chosen: number;
  /** True when the CHOSEN departure is affordable. This, and not `verdict`, is
   *  what arms the button. */
  chosenFeasible: boolean;
  why: string;
}

export function scheduleFor(c: Curve, chosen: number): Schedule {
  const earliest = firstFeasibleIndex(c);
  const cheapest = bestIndex(c);
  const s = c.samples[chosen];
  const chosenFeasible = s !== undefined && s.feasible;
  if (chosenFeasible) {
    return { verdict: 'go', earliest, cheapest, chosen, chosenFeasible,
             why: 'this vehicle can fly this departure.' };
  }
  if (earliest >= 0) {
    const t = c.samples[earliest];
    return {
      verdict: 'wait', earliest, cheapest, chosen, chosenFeasible,
      why: 'not at this departure, but there is one you CAN fly: pick it and '
        + `set the autopilot to leave in ${Math.round((t?.tS ?? 0) / 60)} min.`,
    };
  }
  return {
    verdict: 'never', earliest, cheapest, chosen, chosenFeasible,
    why: 'no departure in this window is affordable. This is about the vehicle '
      + 'and not the clock: waiting will not fix it, more fuel will.',
  };
}
