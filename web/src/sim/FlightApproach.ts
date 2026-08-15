// =============================================================================
// FlightApproach.ts - R99's AUTO-APPROACH, DRIVEN. (PH-382 to PH-386.)
//
// D-015 splits Reid's "for destinations with a docking mechanism it should
// automatically dock" into two layers: CAPTURE, the mechanism, which landed at
// R93/PH-360 as the hand-flown DOCK key, and AUTO-APPROACH, the program that
// flies to it. This file is the client half of the second layer.
//
// -----------------------------------------------------------------------------
// WHAT THIS FILE IS NOT, WHICH IS THE FIRST THING TO SAY ABOUT IT.
//
// IT IS NOT A FLIGHT LAW. `core/include/of/approach.h` is, it has been since
// PH-174, and `core/tests/test_approach.cpp` has been pinning it for just as
// long. What R99 found is that NOTHING EVER CALLED IT: there was no
// `of_dk_approach` symbol in the wasm, so the client could not reach the law
// even to ask. That is R93's finding one layer up, word for word ("there is no
// `of_dk_*` symbol in the wasm at all, so the client cannot even ask").
//
// So the fix was one additive export and this driver, NOT a TypeScript
// transcription of the corridor. A transcription would have put two corridor
// laws in the repo -- one ctest-pinned and dead, one live and unpinned -- and
// the day they disagreed the tested one would still be green. Every number
// below that describes the approach comes out of `approach::guide`, and this
// file contains no threshold, no gain and no standoff distance of its own.
//
// -----------------------------------------------------------------------------
// WHERE THE TICK HAPPENS AND WHY IT IS EXACTLY THERE.
//
// `approachTick` is called from `FlightSession.step`, immediately after
// `guidanceTick`, and both of those facts are load-bearing:
//
//   * AFTER `FlightControls.step`, because that writes the translation command
//     EVERY TICK INCLUDING ZERO (FlightRcs.ts says why: `rcsTranslate` is state
//     on the far side, so a client that only wrote it while a key was held
//     would leave the thrusters on for ever). A program that pushed from a
//     render frame would have its command zeroed by the next fixed tick and
//     would read as an autopilot with no thrusters.
//   * BEFORE `of_fl_step`, because the whole point of aiming is to aim at THIS
//     tick's geometry. Same seam, same argument, as the ascent ribbon.
//
// -----------------------------------------------------------------------------
// IT RE-ARMS ITSELF, ON `followGuidance`'s OWN INTERLOCK.
//
// PH-44 is `FlightSas.ts`'s founding bug: a mode another entry point can
// silently undo. The cure there was to state the rule once -- "any aim cancels
// the follow" -- inside `commandDirection`, and let the follower re-arm itself
// on the next tick. `approachArmed` is cleared by that same line, so a player
// who presses a SAS key, follows the ribbon, or nudges the stick takes the
// vehicle back without any of those callers needing to know this file exists.
// The translation keys are the one input `commandDirection` cannot see, so
// `FlightControls` cancels on those explicitly and says so there.
//
// -----------------------------------------------------------------------------
// THE LATCH IS AUTOMATIC, AND THAT DECISION IS NOT THIS LANE'S TO MAKE.
//
// D-015's advisory-vs-auto distinction was settled at PH-361/PH-364 and written
// into the two places that implement it. `DockRig::latch` (of_flight_api.inc):
// "The auto-approach autopilot (D-015's second layer) flies the last metre and
// must latch the instant it touches: it has no hand to press anything."
// `FlightDock.armDock`: "The auto-approach autopilot, when it arrives, arms
// with 1 and needs nothing else." R99 follows that ruling rather than re-taking
// it, and the two are consistent for a reason worth stating: the manual rung
// exists so a player CAN press the button, and this program exists because
// there is nobody to press it. `FlightDock.ts` owns the latch-mode write, since
// it owns the rig; this file owns only whether the program is running.
// =============================================================================
import { approachGuidance, approachNote, LEG } from './FlightAbi.js';
import type { ApproachRow } from './FlightAbi.js';
import { commandDirection, releaseApproach } from './FlightSas.js';
import type { OfCoreModule } from './wasm/heap.js';
import type { FlightSession } from './FlightSession.js';

/** The two exports this file needs, so ONE list drives both detection and the
 *  sentence on screen. Same discipline as `AutopilotRun.APX_EXPORTS`. */
export const APPR_EXPORTS = ['_of_dk_approach', '_of_dk_approach_note'] as const;

/**
 * WHICH OF THE TWO ARE ON THE BRIDGE, reported as the C names and never as a
 * bare boolean. Detected on the JS symbol, REPORTED as the C name, because the
 * name on screen is the one somebody has to grep for.
 *
 * This is what makes a client running against an older wasm HONEST rather than
 * broken: ABI stays 26 and these are additive, so such a bundle boots, docks by
 * hand, and says exactly which name its auto-approach is waiting for.
 */
export function apprMissing(M: OfCoreModule): string[] {
  const m = M as unknown as Record<string, unknown>;
  return APPR_EXPORTS.filter((n) => typeof m[n] !== 'function')
    .map((n) => n.replace(/^_/, ''));
}

/** ONE TICK OF THE PROGRAM. A no-op unless it is armed, exactly like
 *  `guidanceTick`, so the ordinary flight pays one boolean for this file. */
export function approachTick(s: FlightSession): void {
  if (!s.approachArmed || s.handle <= 0) return;
  const g = approachGuidance(s.core, s.handle);
  // TWO STATES END THE PROGRAM AND THEY END IT DIFFERENTLY.
  //
  // `Aborted` is a refusal from the law itself (today: a port that is not on
  // the stack axis, which it will not aim approximately). `None` is the rig
  // having gone away underneath us -- a demote, a recover, a target lost. Both
  // must stop commanding, and neither may leave the thrusters lit: `flight.h`
  // holds `rcsTranslate` until it is written again, so a program that simply
  // stopped calling would be a program that pushes for ever.
  if (!g.answered || g.leg === LEG.None || g.leg === LEG.Aborted) {
    stopApproach(s, g.leg === LEG.Aborted
      ? approachNote(s.core, s.handle) : 'auto-approach: the target is gone');
    return;
  }
  // CONTACT IS THE LAW'S OWN HANDS-OFF STATE and it is honoured literally:
  // `approach.h` says "THE PROGRAM STOPS COMMANDING and lets the capture test
  // decide: continuing to push while latched is how a docking program tears
  // something off". `guide` returns a zero `rcsTranslate` there, so writing it
  // verbatim is already correct; the branch exists so the SAS command is not
  // re-aimed at a port the vessel is already sitting on.
  if (g.leg === LEG.Contact) {
    s.V._of_fl_rcs_translate(s.handle, 0, 0, 0);
    return;
  }
  const c = g.sasCommand;
  // `commandDirection` clears `approachArmed` (see the header) ...
  commandDirection(s, [c[0], c[1], c[2]]);
  // ... and the program is the one thing that re-arms itself.
  s.approachArmed = true;
  const t = g.rcsTranslate;
  s.V._of_fl_rcs_translate(s.handle, t[0], t[1], t[2]);
}

/**
 * ARM. Returns '' when it took, or the sentence for why it did not.
 *
 * IT REFUSES ON THE BRIDGE AND ON THE RIG AND ON NOTHING ELSE. Whether the
 * geometry is flyable is `approach::guide`'s judgement, not this file's, so a
 * hopeless arm is allowed to arm and then abort with the law's own words. The
 * alternative -- a second opinion here about which approaches are possible --
 * is the thing this whole file is written to avoid. The GATE (has the player
 * earned this yet) is gameplay's and lives in `FlightDock.approachPublication`.
 */
export function armApproach(s: FlightSession): string {
  if (s.handle <= 0) return 'not flying';
  const missing = apprMissing(s.core);
  if (missing.length > 0) {
    return `auto-approach needs a wasm rebuild: ${missing.join(', ')}`;
  }
  const g = approachGuidance(s.core, s.handle);
  if (g.leg === LEG.None) return 'no docking target';
  s.approachArmed = true;
  return '';
}

/** STOP AND SAY SO, and hand back a vehicle whose controls say what they do.
 *
 *  `releaseApproach` (FlightSas.ts, beside the other four transitions) is the
 *  mechanism, including the thruster zero that is the load-bearing half of it.
 *  This is that plus a sentence, and the split is the difference between the
 *  player taking control (silent, they know) and the program stopping on its
 *  own or being told no (spoken, they do not).
 *
 *  The ATTITUDE is deliberately left where it is: a vehicle that goes slack the
 *  moment you take over is worse, which is the same call GP-278 recorded for
 *  the autopilot's own cancel. */
export function stopApproach(s: FlightSession, why: string): boolean {
  if (!s.approachArmed) return false;
  releaseApproach(s);
  if (why !== '') s.flash(why);
  return true;
}

/** The word for a leg, for a chip. A function of the LEG NUMBER and never of
 *  the note, on `AutopilotRun.phaseWord`'s rule: a short stable word structures
 *  the panel and the law's own sentence explains it, drawn beside rather than
 *  instead. */
export function legWord(leg: number): string {
  switch (leg) {
    case LEG.Align: return 'ALIGNING';
    case LEG.Corridor: return 'CORRIDOR';
    case LEG.Final: return 'FINAL';
    case LEG.Contact: return 'CONTACT';
    case LEG.Aborted: return 'ABORTED';
    default: return 'OFF';
  }
}

/** PH-386. The probe surface: the row, the sentence and the flag, so a probe
 *  can prove the program is FLYING rather than infer it from a vessel moving. */
export function approachReport(s: FlightSession): Record<string, unknown> {
  const g: ApproachRow = s.handle > 0
    ? approachGuidance(s.core, s.handle)
    : { leg: LEG.None, answered: false, sasCommand: [0, 1, 0],
        rcsTranslate: [0, 0, 0], rangeM: 0, alongM: 0, lateralM: 0,
        closingMS: 0, aimErrorDeg: 180 };
  const missing = apprMissing(s.core);
  return {
    armed: s.approachArmed,
    waitingOn: missing.join(', '),
    leg: g.leg, legWord: legWord(g.leg), answered: g.answered,
    note: s.handle > 0 ? approachNote(s.core, s.handle) : '',
    rangeM: g.rangeM, alongM: g.alongM, lateralM: g.lateralM,
    closingMS: g.closingMS, aimErrorDeg: g.aimErrorDeg,
    /** The magnitude the law is asking of the thrusters, 0..1. A program that
     *  is armed and commanding nothing looks identical to one that is not armed
     *  unless this is published. */
    rcsCommand: Math.hypot(g.rcsTranslate[0], g.rcsTranslate[1],
                           g.rcsTranslate[2]),
  };
}
