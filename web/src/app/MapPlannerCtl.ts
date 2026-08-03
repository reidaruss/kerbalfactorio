// =============================================================================
// MapPlannerCtl.ts - the map's autopilot controls: the button verbs, the frame
// readout, and the time-warp rule that keeps a burn watchable.
//
// LIFTED OUT OF MapMode.ts (GP-283), which is GP-206's move and the same
// argument: binding the executor took that file from 455 lines to 588 against a
// 400-line cap it was already over, and everything moved here is one concern.
// Nothing changed in the lift.
//
// Free functions and one three-field state record rather than a class, because
// there is exactly one piece of state involved (the warp the player had before
// the autopilot took the controls) and a class would imply more.
// =============================================================================
import { CURVE_WINDOW_S } from './MapPlanner.js';
import type { MapPlanner } from './MapPlanner.js';
import type { MapPlannerReadout } from '../ui/MapTypes.js';
import {
  burnProgress01, inPoweredPhase, phaseWord, waitingToDepart,
} from '../game/AutopilotRun.js';

/** Just enough of `FlightSession` for the warp rule, so this file does not
 *  import the session and cannot reach anything else on it. */
export interface WarpSession {
  warpIndex: number;
  setWarp(i: number): void;
}

/** GP-275's whole state: the ladder position to give back, and whether the
 *  player has already been told. */
export interface WarpHold {
  /** -1 when the autopilot has not taken the controls. */
  before: number;
  said: boolean;
}

export function newWarpHold(): WarpHold { return { before: -1, said: false }; }

/** GP-271. The planner's five buttons, in one place. */
export function planAct(pl: MapPlanner, say: (m: string) => void,
                        act: string): void {
  if (act === 'earlier') { pl.nudge(-1); return; }
  if (act === 'later') { pl.nudge(1); return; }
  if (act === 'cheapest') { pl.pickCheapest(); return; }
  if (act === 'earliest') { pl.pickEarliestFlyable(); return; }
  // GP-277. The requested orbit's own two numbers. Clamped, never wrapped:
  // an altitude of 0 is the ground and a negative inclination is the same
  // orbit as its positive twin flown the other way, which is a distinction
  // this screen does not offer and must not half-offer.
  if (act === 'alt+' || act === 'alt-') {
    const step = act === 'alt+' ? 25 : -25;
    pl.setOrbit(Math.max(25, Math.min(20000, pl.altKm + step)), pl.incDeg);
    return;
  }
  if (act === 'inc+' || act === 'inc-') {
    const step = act === 'inc+' ? 5 : -5;
    pl.setOrbit(pl.altKm, Math.max(0, Math.min(180, pl.incDeg + step)));
    return;
  }
  if (act === 'cancel') {
    // GP-274. CANCEL IS OFFERED WHENEVER A PROGRAM EXISTS, running or not,
    // because a program that ABORTED still owns the screen until somebody
    // dismisses it and the player needs a way to say "understood".
    const c = pl.cancel();
    if (!c.wasArmed) { say('nothing was armed.'); return; }
    // THE RESIDUAL, WHICH IS THE MID-BURN CASE. Physics cuts the throttle;
    // what the PLAYER needs is to be told what just happened to their orbit,
    // because a part-flown burn leaves a trajectory that is neither the old
    // one nor the planned one and nothing on screen would otherwise say so.
    say(c.wasBurning
      ? `autopilot stopped MID-BURN ${c.atBurnIndex + 1} of ${c.burnCount}, `
        + `throttle cut. It had spent ${c.dvSpentMS.toFixed(1)} m/s: your `
        + 'orbit is part way between the old one and the planned one.'
      : 'autopilot cancelled. Nothing was burning.');
    return;
  }
  if (act === 'arm') {
    // GP-291. A WORLD IS ARMED WITHOUT THE CHART'S PERMISSION, because the
    // chart has no opinion about it. `of_ap_departure_curve` takes nine orbit
    // words and a body cannot be described in them, so `chosenFeasible` is
    // false for a world for exactly the reason it is false for an empty curve.
    // Letting the gate below stand would refuse every moon mission with the
    // sentence "no departure in this window is affordable", which is a
    // confident answer to a question nobody asked. The EXECUTOR still refuses
    // on its own numbers and its sentence is what the player reads.
    const tb = pl.target();
    if (tb !== null && tb.body !== null) {
      const rb = pl.arm();
      if (rb.waitingOn !== '') {
        say('the autopilot executor is not on this bridge yet: waiting for '
          + `${rb.waitingOn}.`);
        return;
      }
      say(rb.armed ? `autopilot armed: ${rb.note}`
        : `autopilot refused: ${rb.note}`);
      return;
    }
    // THE GATE. Refused per DEPARTURE TIME and never globally, which is
    // Reid's rule: a destination you cannot reach now is not refused
    // outright, it is refused AT THIS DEPARTURE. The button is disabled
    // in that state AND the verb refuses, because a disabled button is a
    // hint and a refusal is a rule.
    const sch = pl.schedule();
    if (!sch.chosenFeasible) { say(sch.why); return; }
    // GP-273. AND NOW IT FLIES. `armFor` picks hold-orbit or transfer off
    // the target's own phase, which is the same rule the chart used to price
    // it, so the thing that was quoted is the thing that is armed.
    const r = pl.arm();
    if (r.waitingOn !== '') {
      say('the autopilot executor is not on this bridge yet: waiting '
        + `for ${r.waitingOn}. The plan above is real; nothing is flown.`);
      return;
    }
    // THE REFUSAL IS PHYSICS' OWN SENTENCE, PRINTED VERBATIM. Paraphrasing it
    // here would give one failure two vocabularies (GP-270's family), and the
    // executor is the authority on why it would not take the program.
    say(r.armed
      ? `autopilot armed: ${r.note}`
      : `autopilot refused: ${r.note}`);
  }
}

/**
 * DROP TIME WARP FOR THE BURN, AND GIVE IT BACK AFTERWARDS.
 *
 * See `inPoweredPhase` for why this is not a correctness fix: the burn is
 * flown identically at 1000x. It is that at 1000x it is flown inside a
 * fraction of one frame, so the player sees no engine, no countdown and no
 * chance to cancel, and a hold-orbit's two burns are half an orbit apart,
 * which is exactly the coast a player warps through.
 *
 * THE RESTORE IS GUARDED ON THE PLAYER NOT HAVING MOVED IT. Handing the warp
 * back is right, because the wait between two burns is real and was the
 * reason they warped in the first place; overriding a deliberate press
 * afterwards would not be.
 */
export function holdWarpForBurn(w: WarpHold, pl: MapPlanner,
                                s: WarpSession, flying: boolean,
                                say: (m: string) => void): void {
  if (!flying) { w.before = -1; return; }
  if (inPoweredPhase(pl.currentRun)) {
    // HELD AT 1x FOR THE WHOLE POWERED PHASE, NOT DROPPED ONCE.
    //
    // The first version did this once, guarded on `warpBeforeBurn < 0`, and
    // it was wrong in a way only driving it showed: warp is a LADDER the
    // player steps up, so a single drop is undone by the very next press and
    // the burn then ran at 200x anyway. Measured: six warp presses after
    // arming left the vehicle burning at 200x with the rule believing it had
    // already fired. A rule that must hold a condition has to be evaluated
    // while the condition holds, not at its edge.
    if (s.warpIndex > 0) {
      if (w.before < 0) w.before = s.warpIndex;
      s.setWarp(0);
      if (!w.said) {
        w.said = true;
        say('time warp held at 1x while the autopilot burns.');
      }
    }
    return;
  }
  w.said = false;
  if (w.before >= 0) {
    if (s.warpIndex === 0) s.setWarp(w.before);
    w.before = -1;
  }
}

/** GP-271, GP-273. One frame of the planner and of the programme in
 *  flight, as plain data (DW-2). */
export function plannerReadout(pl: MapPlanner, flying: boolean,
                             dvAvailableMS: number)
  : MapPlannerReadout {
  const t = pl.target();
  const sch = pl.schedule();
  const c = pl.currentCurve;
  const tp = pl.currentPlan;
  const s = c.samples[pl.chosen];
  const run = pl.currentRun;
  const close = pl.closing();
  return {
    waitingOn: c.waitingOn,
    // GP-273. The executor, as plain data (DW-2). `runWaitingOn` is a
    // SEPARATE seam from `waitingOn`: the planner and the executor are two
    // export sets and a build can have one and not the other, which is
    // exactly the state every build before tonight was in.
    runWaitingOn: run.waitingOn,
    runArmed: run.armed,
    runRunning: run.running,
    runPhase: run.phase,
    runPhaseWord: phaseWord(run),
    runBurnIndex: run.burnIndex,
    runBurnCount: run.burnCount,
    runTimeToIgnitionS: run.timeToIgnitionS,
    runDvSpentMS: run.dvSpentTotalMS,
runDvThisBurnMS: run.dvThisBurnMS,
    runProgramDvMS: run.programDvMS,
    runCurrentBurnDvMS: run.currentBurnDvMS,
    runBurnProgress01: burnProgress01(run),
    runPointingErrorDeg: run.pointingErrorDeg,
    runThrottle: run.throttleNow,
    runWaitingToDepart: waitingToDepart(run),
    runNote: pl.currentNote,
    runQuotedAtArmMS: pl.armedQuoteMS,
    runStalled: pl.burnStalled,
    runRangeM: close === null ? NaN : close.rangeM,
    runClosingMS: close === null ? NaN : close.closingMS,
    aboard: flying,
    rows: pl.rows().map((r) => ({ id: r.id, kind: r.kind, name: r.name,
                                  detail: r.detail, blocked: r.blocked })),
    selectedId: pl.selectedId,
    blockedWhy: t === null ? '' : t.blocked,
isBody: t !== null && t.body !== null,
bodyCaptureAltM: t === null || t.body === null ? NaN
  : t.body.captureAltitudeM,
    curve: c.samples.map((x) => ({ tS: x.tS, dvMS: x.dvRequiredMS,
                                   feasible: x.feasible })),
    windowS: CURVE_WINDOW_S,
    chosen: pl.chosen, cheapest: sch.cheapest, earliest: sch.earliest,
    chosenTS: s?.tS ?? NaN, chosenDvMS: s?.dvRequiredMS ?? NaN,
    chosenFeasible: sch.chosenFeasible,
    dvAvailableMS,
    verdict: sch.verdict, why: sch.why,
    orbitAltKm: pl.altKm, orbitIncDeg: pl.incDeg,
    planDeltaVMS: tp === null ? 0 : tp.deltaVMS,
    planBurnS: tp === null ? 0 : tp.burnDurationS,
    planApoapsisAltM: tp === null ? 0 : tp.apoapsisAltM,
    planPeriapsisAltM: tp === null ? 0 : tp.periapsisAltM,
  };
}

