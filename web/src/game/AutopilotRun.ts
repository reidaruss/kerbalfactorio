// =============================================================================
// AutopilotRun.ts - THE EXECUTION HALF, BOUND. (GP-272.)
//
// `Autopilot.ts` is PLANNING: what will this trip cost, when should I leave,
// draw me the arc. This file is EXECUTION: fly it, stop flying it, and say what
// is happening while it flies. They are separate files because they are
// separate questions with separate failure modes, and because a screen that
// plans is useful with no executor at all (that is what shipped at GP-271).
//
// WHO PUBLISHED WHAT, AND WHY THAT MATTERS HERE.
//
// The planning contract was published by THIS lane first, in the header of
// `Autopilot.ts`, committed before the other side existed so it could be read
// in the repo rather than in a message. The physics lane then answered it
// exactly. EXECUTION WENT THE OTHER WAY: physics published first, in
// `web/wasm/of_ap_api.inc` section 21.5 at PH-156..PH-158, and that comment is
// the specification. This file BINDS it. It does not restate it, does not
// paraphrase it, and where this lane wanted something the row does not carry,
// that is written down at the bottom as a NAMED ASK rather than invented here.
//
// Deliberately identical in shape to `Autopilot.ts` so a reader of one can read
// the other: symbol-presence detection returning the MISSING C NAMES, one typed
// reader per export, and a PENDING state that prints what it is waiting for
// rather than being quietly absent (GP-62, GP-263).
//
// -----------------------------------------------------------------------------
// FIVE THINGS ABOUT THE SHIPPED CONTRACT THAT DECIDE HOW THIS CLIENT IS BUILT.
// All five are physics' design, restated here only because each one removed
// code this file would otherwise have had to contain.
//
//  1. THERE IS NO TICK CALL, AND THAT IS ON PURPOSE. The executor rides inside
//     `of_fl_step` and `of_fl_step_n`. `FlightSession.step` already calls those,
//     so arming a program is the whole integration and there is no per-frame
//     autopilot call for a future refactor to drop. A second hot-loop call that
//     must be made in the right order with the right dt in BOTH step exports is
//     a call that gets forgotten, and forgetting it under warp is silent: the
//     vehicle coasts straight through its own burn and arrives somewhere else.
//
//  2. IT SURVIVES WARP, WHICH IS WHAT MAKES REID'S SCHEDULED LAUNCH REAL. A
//     departure an hour out is only ever flown warped. Physics measured 200
//     ticks per `of_fl_step_n` call identical to single stepping (680 km to a
//     requested 800 km arriving at a = 799997.2, e = 0.000000, spending its
//     planned 177.5676 m/s). So this file does NOT cap or fight the warp
//     factor, and `FlightWarp` is untouched.
//
//  3. A SCHEDULED DEPARTURE NEEDS NO STATE HERE. A program armed now whose
//     first ignition is in the future simply coasts to it: the schedule is a
//     number in the plan, not a state in the executor. So NOT NOW, BUT LATER
//     arms through the same call as an immediate departure, and `waitingToDepart`
//     below is a DERIVED READING of the shipped row rather than a flag this
//     client keeps and could get out of step.
//
//  4. A REFUSAL NAMES ITSELF, AND THE WORDS ARE PHYSICS'. `arm` returns 0 and
//     `of_ap_note` says why in a sentence a screen prints VERBATIM. This file
//     never paraphrases it. GP-270 was the same failure one layer up (a refusal
//     word nothing read, so a declined question drew as a confident CANNOT), and
//     the cure there and here is that the refusal has to reach the screen in the
//     vocabulary the refuser used. Two vocabularies for one failure is how a
//     player is told two different things about one event.
//
//  5. STATUS WORD 0 IS `running`, NOT A CONSTANT 1. The WORD COUNT says whether
//     anything is armed; word 0 says whether it is still going. A refused arm
//     therefore still returns 18 words with `running` 0 and phase `Aborted`, so
//     the screen shows the refusal instead of forgetting the press happened.
//     Reading word 0 as "armed" would make every finished and every refused
//     program indistinguishable from never having pressed the button.
// =============================================================================
import type { AutopilotTarget } from './AutopilotTargets.js';
import type { OfCoreModule } from '../sim/wasm/heap.js';
import { AP_STATUS_WORDS } from '../sim/wasm/vesselabi.js';
import { scratchF64, scratchU8 } from '../sim/wasm/heap.js';

/** Every export this file needs, so ONE list drives both detection and the
 *  sentence on screen. Same discipline as `Autopilot.ts::AP_EXPORTS`. */
export const APX_EXPORTS = [
  '_of_ap_arm_hold_orbit', '_of_ap_arm_transfer', '_of_ap_arm_body_transfer',
  '_of_ap_cancel', '_of_ap_status', '_of_ap_note',
] as const;

interface ApxModule {
  _of_ap_arm_hold_orbit(f: number, targetRadiusM: number): number;
  _of_ap_arm_transfer(f: number, t: number, sma: number, ecc: number,
                      inc: number, lan: number, argp: number, ta: number,
                      epoch: number): number;
  _of_ap_arm_body_transfer(f: number, t: number, bodyId: number,
                           captureAltM: number): number;
  _of_ap_cancel(f: number): number;
  _of_ap_status(f: number): number;
  _of_ap_note(f: number): number;
}

/**
 * WHICH OF THE FIVE ARE ON THE BRIDGE, reported as the C names and never as a
 * bare boolean. Detected on the JS symbol (`_of_ap_status`), REPORTED as the C
 * name (`of_ap_status`), because the name on screen is the one somebody has to
 * grep for and an underscore nobody typed is a name nobody finds.
 *
 * This is what makes an old client honest rather than broken: ABI stays 22 and
 * these are additive, so a bundle built before they existed boots, plans, draws
 * the chart, and says on screen exactly which five names its arm button needs.
 */
export function apxMissing(M: OfCoreModule): string[] {
  const m = M as unknown as Record<string, unknown>;
  return APX_EXPORTS.filter((n) => typeof m[n] !== 'function')
    .map((n) => n.replace(/^_/, ''));
}

function apx(M: OfCoreModule): ApxModule | null {
  return apxMissing(M).length === 0 ? (M as unknown as ApxModule) : null;
}

/** of_ap_api.inc section 21.5, word 1. Numbers are `of::autopilot::Phase`
 *  verbatim, so nothing here is a translation table that could be wrong. */
export const enum Phase {
  Idle = 0, Coast = 1, Orient = 2, Burn = 3, Done = 4, Aborted = 5,
}
/** Word 2, `of::autopilot::Mode` verbatim. */
export const enum Mode { Off = 0, HoldOrbit = 1, Transfer = 2 }

/**
 * THE 18 WORDS, TYPED. Field names are the ones the bridge comment uses; the
 * order is the row's. Nothing is renamed on the way across, because a field
 * that is called one thing in the specification and another in the client is a
 * field two people will describe differently in the same bug report.
 */
export interface RunStatus {
  /** False when the export set is incomplete: `waitingOn` then names it. */
  answered: boolean;
  /** '' when this is a real answer, else the missing C names, printed
   *  verbatim. */
  waitingOn: string;
  /** THE COUNT SAID SOMETHING IS ARMED. See rule 5 in the header: this is the
   *  18-vs-0 distinction and is NOT word 0. */
  armed: boolean;
  /** Word 0. Still going: Coast, Orient or Burn. 0 once Done or Aborted. */
  running: boolean;
  phase: Phase;
  mode: Mode;
  burnIndex: number;
  burnCount: number;
  /** NEGATIVE means the burn is OVERDUE, which is what a vehicle still slewing
   *  onto its attitude looks like. Never clamp it: a burn that is late is a
   *  thing the player is entitled to see happening. */
  timeToIgnitionS: number;
  /** Integrated from thrust ACTUALLY DELIVERED, not from the plan. */
  dvSpentTotalMS: number;
  dvThisBurnMS: number;
  currentBurnDvMS: number;
  pointingErrorDeg: number;
  rateDegS: number;
  burningNow: boolean;
  /** What the executor last commanded. THE CLIENT'S OWN THROTTLE MIRROR IS NOT
   *  THIS. `FlightSession.throttle` is only written when the player moves it,
   *  so during an autopilot burn the HUD would read the player's last setting
   *  while the engine runs at something else. Draw this one. */
  throttleNow: number;
  programDvMS: number;
  /** HoldOrbit only, else 0. A RADIUS from the body centre, not an altitude. */
  targetRadiusM: number;
  /** The current burn's direction, unit, inertial: the SAME vector the executor
   *  is holding, so a navball marker and the ship cannot disagree. */
  dir: [number, number, number];
}

const NOTHING: RunStatus = {
  answered: true, waitingOn: '', armed: false, running: false,
  phase: Phase.Idle, mode: Mode.Off, burnIndex: 0, burnCount: 0,
  timeToIgnitionS: NaN, dvSpentTotalMS: 0, dvThisBurnMS: 0, currentBurnDvMS: 0,
  pointingErrorDeg: NaN, rateDegS: NaN, burningNow: false, throttleNow: 0,
  programDvMS: 0, targetRadiusM: 0, dir: [0, 1, 0],
};

/** "Nothing is armed", as a value. A field initialiser needs one before any
 *  module handle exists, and a caller that invented its own would be a second
 *  definition of the resting state. */
export function idleStatus(): RunStatus { return { ...NOTHING }; }

/** THE PER-FRAME READ. Cheap: one call, one scratch read, no allocation beyond
 *  the row. Safe to call every frame while the map is open. */
export function runStatus(M: OfCoreModule, flightHandle: number): RunStatus {
  const missing = apxMissing(M);
  if (missing.length > 0) {
    return { ...NOTHING, answered: false, waitingOn: missing.join(', ') };
  }
  if (flightHandle <= 0) return { ...NOTHING };
  const A = M as unknown as ApxModule;
  const got = A._of_ap_status(flightHandle);
  // 0 words is NOT an error and NOT a refusal: it is "nothing is armed for this
  // handle", which is the state every flight starts in.
  if (got === 0) return { ...NOTHING };
  if (got !== AP_STATUS_WORDS) {
    // A bridge you do not agree with is refused, never tolerated (GP-159's
    // stride rule). It reads as unanswered rather than throwing, because a
    // planner panel is not the boot path.
    return {
      ...NOTHING, answered: false,
      waitingOn: `of_ap_status: stride ${got}, expected ${AP_STATUS_WORDS}`,
    };
  }
  const f = scratchF64(M, AP_STATUS_WORDS);
  const at = (i: number): number => f[i] ?? 0;
  return {
    answered: true, waitingOn: '', armed: true,
    running: at(0) > 0.5,
    phase: at(1) as Phase, mode: at(2) as Mode,
    burnIndex: at(3), burnCount: at(4),
    timeToIgnitionS: at(5),
    dvSpentTotalMS: at(6), dvThisBurnMS: at(7), currentBurnDvMS: at(8),
    pointingErrorDeg: at(9), rateDegS: at(10),
    burningNow: at(11) > 0.5, throttleNow: at(12),
    programDvMS: at(13), targetRadiusM: at(14),
    dir: [at(15), at(16), at(17)],
  };
}

const decoder = new TextDecoder();

/**
 * WHY IT REFUSED, OR WHAT IT IS DOING, IN PHYSICS' OWN WORDS. Printed verbatim.
 *
 * This client deliberately holds NO table mapping these sentences to anything.
 * A screen that branched on the text would break the day physics improved a
 * sentence, which is GP-139's rule (assert the action, never the prose) applied
 * to a string crossing a bridge. Every branch this UI makes is on `phase` and
 * `running`, which are numbers; the sentence is only ever displayed.
 */
export function runNote(M: OfCoreModule, flightHandle: number): string {
  const A = apx(M);
  if (A === null || flightHandle <= 0) return '';
  const n = A._of_ap_note(flightHandle);
  return n > 0 ? decoder.decode(scratchU8(M, n).slice()) : '';
}

export interface ArmResult {
  armed: boolean;
  /** '' when the exports are present. Otherwise the C names still needed. */
  waitingOn: string;
  /** Physics' own sentence. Empty only when the solver is not on the bridge. */
  note: string;
  /** Which call was made, so a probe can assert that a phaseless target took
   *  the hold-orbit door, a phased one took the transfer door, and a world took
   *  the body door. */
  via: 'hold-orbit' | 'transfer' | 'body' | 'none';
}

/**
 * ARM, FOR ANY TARGET, THROUGH ONE FUNCTION.
 *
 * THE MODE IS DERIVED FROM THE TARGET AND IS NEVER A CHOICE THE PLAYER MAKES.
 * A target whose `trueAnomalyRad` is NaN has no phase: it is a RING, any point
 * on it will do, so there is no rendezvous to fly and the right program is
 * hold-this-orbit. A target with a finite true anomaly is an OBJECT and the
 * right program is a transfer. That is the same rule `of_ap_flight_reach` and
 * `of_ap_departure_curve` already use to decide whether to run Lambert, so the
 * thing that was PRICED is the thing that gets ARMED by construction rather
 * than by two switches that have to agree.
 *
 * It is also why Reid's fifth ask ("set an automatic take it to this orbit") is
 * not a second feature and not a second button: it is a row in the same list
 * whose true anomaly happens to be NaN.
 *
 * `tDepartFromNowS` is ignored by the hold-orbit door, and that is physics' own
 * shape rather than an omission here: hold-orbit's first burn is computed from
 * where the vehicle IS, so a scheduled one would have to be re-planned at the
 * departure, which is exactly the "re-derive it in flight" that autopilot.h
 * refuses to do. Scheduling therefore applies to transfers, which is where
 * Reid's departure chart lives anyway.
 */
export function armFor(M: OfCoreModule, flightHandle: number,
                       target: AutopilotTarget,
                       tDepartFromNowS: number): ArmResult {
  const missing = apxMissing(M);
  if (missing.length > 0) {
    return { armed: false, waitingOn: missing.join(', '), note: '', via: 'none' };
  }
  // GP-291. A WORLD TAKES ITS OWN DOOR, and it is checked FIRST because a body
  // has no orbit at all: falling through to the orbit branch is exactly the
  // mistake physics measured, a two-burn rendezvous with the moon's centre at
  // 1561.330 m/s against a thing that is 200 km of rock. The client cannot make
  // that mistake now, because `of_ap_arm_body_transfer` takes a body id and a
  // capture altitude and will not accept an ephemeris.
  const b = target.body;
  if (b !== null && flightHandle > 0) {
    const A2 = M as unknown as ApxModule;
    const ok2 = A2._of_ap_arm_body_transfer(flightHandle, tDepartFromNowS,
                                            b.bodyId, b.captureAltitudeM) === 1;
    return { armed: ok2, waitingOn: '', note: runNote(M, flightHandle),
             via: 'body' };
  }
  const o = target.orbit;
  if (flightHandle <= 0 || o === null) {
    return { armed: false, waitingOn: '', via: 'none',
             note: target.blocked !== '' ? target.blocked
               : 'there is no vehicle to fly.' };
  }
  const A = M as unknown as ApxModule;
  const phased = Number.isFinite(o.trueAnomalyRad);
  const ok = phased
    ? A._of_ap_arm_transfer(flightHandle, tDepartFromNowS, o.semiMajorAxisM,
        o.eccentricity, o.inclinationRad, o.lanRad, o.argpRad,
        o.trueAnomalyRad, o.epochS) === 1
    : A._of_ap_arm_hold_orbit(flightHandle, o.semiMajorAxisM) === 1;
  return { armed: ok, waitingOn: '', note: runNote(M, flightHandle),
           via: phased ? 'transfer' : 'hold-orbit' };
}

export interface CancelResult {
  /** True when something WAS armed and is now not. False means there was
   *  nothing to cancel, which is not a failure and must not read as one. */
  wasArmed: boolean;
  waitingOn: string;
  /** THE MID-BURN CASE, MEASURED RATHER THAN TRUSTED. Read from `of_ap_status`
   *  in the frame BEFORE the cancel, because afterwards there is no row to read
   *  it from: cancel erases the program, so `of_ap_status` returns 0 words and
   *  the whole event would be unreportable one frame later. */
  wasBurning: boolean;
  dvSpentMS: number;
  atBurnIndex: number;
  burnCount: number;
}

/**
 * CANCEL, INCLUDING MID-BURN, WHICH IS THE CASE THAT GETS GOT WRONG.
 *
 * Physics cuts the throttle inside `of_ap_cancel` and says so in as many words,
 * which is the half that would have been a runaway engine: `Autopilot::disarm`
 * on its own touches only the executor's state, so a caller that merely stopped
 * driving it would leave `sim.state.throttle` wherever the last applied Command
 * put it, for ever. That is closed on their side and this file does not
 * duplicate it.
 *
 * WHAT IS THIS LANE'S HALF, AND IT IS NOT THE THROTTLE.
 *
 *  (a) THE RESIDUAL. A cancel mid-burn leaves the vehicle in an orbit that is
 *      neither the one it had nor the one it was going to: the burn is part
 *      flown. One frame later `of_ap_status` returns 0 words and `of_ap_note`
 *      says "nothing armed", so "I stopped you 41 m/s into a 91 m/s burn" and
 *      "nothing ever happened here" are the SAME state. The last row is
 *      therefore SAMPLED BEFORE the call and returned, so the screen can say
 *      what it just did to the player's orbit.
 *
 *  (b) THE CLIENT'S OWN MIRRORS. `FlightSession` keeps `throttle` and `sasMode`
 *      as its own copies and only writes them to /core when the player moves
 *      them. After an autopilot burn the sim's throttle and SAS are the
 *      executor's and the mirrors are stale, so the HUD reads the player's last
 *      setting while the engine does something else. Re-asserting the player's
 *      own throttle is part of cancelling for the same reason cutting it is
 *      part of cancelling: the player is being handed back a vehicle, and it
 *      has to be a vehicle whose controls say what they do.
 */
export function cancelRun(M: OfCoreModule, flightHandle: number): CancelResult {
  const missing = apxMissing(M);
  if (missing.length > 0) {
    return { wasArmed: false, waitingOn: missing.join(', '), wasBurning: false,
             dvSpentMS: 0, atBurnIndex: 0, burnCount: 0 };
  }
  const before = runStatus(M, flightHandle);
  const A = M as unknown as ApxModule;
  const was = A._of_ap_cancel(flightHandle) === 1;
  return {
    wasArmed: was, waitingOn: '',
    wasBurning: before.burningNow, dvSpentMS: before.dvSpentTotalMS,
    atBurnIndex: before.burnIndex, burnCount: before.burnCount,
  };
}

// =============================================================================
// DERIVED READINGS. Every one of these is a function of the 18 words and of
// nothing else, and in particular NONE of them copies a physics constant.
//
// That restriction is the whole point and it is INSTRUMENTS.md's most expensive
// recurring lesson: a constant that is true of every case gets COPIED rather
// than derived, and the copies do not know about each other. `kPointingGateDeg`
// (2.0) and `kRateGateDegS` (0.5) are the two that a naive "is it pointed yet"
// readout would have copied, and they would then have been silently wrong the
// day physics retuned either one. Nothing below reads an angle against a
// threshold; the executor's own PHASE says what it is doing.
// =============================================================================

/**
 * REID'S SCHEDULED DEPARTURE, AS A READING RATHER THAN A FLAG.
 *
 * A program armed for a departure hours away is in Coast, on burn 0, having
 * spent nothing. This client keeps no `scheduled` boolean, because a flag and
 * the executor are two places one fact can be true and DW-26 says name which
 * place is true. The executor is.
 */
export function waitingToDepart(s: RunStatus): boolean {
  return s.armed && s.running && s.phase === Phase.Coast
    && s.burnIndex === 0 && s.dvSpentTotalMS === 0;
}

/**
 * THE BURN IS ABOUT TO HAPPEN OR IS HAPPENING, which is the one moment time
 * warp must not be running. (GP-275.)
 *
 * Physics guarantees the program flies IDENTICALLY under warp: the executor
 * runs inside every sub-step of `of_fl_step_n`, measured at 200 ticks a call
 * against single stepping. So this is not about correctness. It is about the
 * fact that at 1000x a five-second burn happens inside a fifth of ONE FRAME:
 * the player never sees the engine light, never sees the countdown, and cannot
 * cancel it, and then finds themselves in a different orbit with no event on
 * screen that produced it. A feature the player cannot watch is a feature they
 * will not believe.
 *
 * IT IS THE EXECUTOR'S PHASE AND NOT A TIME THRESHOLD. A "drop warp 60 seconds
 * out" rule would be `kOrientLeadS` copied into this client, which is exactly
 * the constant-copying INSTRUMENTS.md keeps catching. The executor enters
 * Orient when IT decides it needs to start turning, so asking which phase it is
 * in gets the same answer for free and stays right if physics retunes the lead.
 */
export function inPoweredPhase(s: RunStatus): boolean {
  return s.armed && s.running
    && (s.phase === Phase.Orient || s.phase === Phase.Burn);
}

/** 0..1 through the CURRENT burn, for a bar. NaN-safe: a program with no burn
 *  under way reads 0 rather than dividing by nothing. */
export function burnProgress01(s: RunStatus): number {
  if (!(s.currentBurnDvMS > 0)) return 0;
  const x = s.dvThisBurnMS / s.currentBurnDvMS;
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/** What the program has left to spend, which is NOT `programDvMS -
 *  dvSpentTotalMS` in general: a burn is cut on measured delta-v, so a burn
 *  that overshot by a tick makes the two differ. This is the honest one. */
export function dvLeftInProgramMS(s: RunStatus): number {
  const left = s.programDvMS - s.dvSpentTotalMS;
  return left > 0 ? left : 0;
}

/**
 * THE ONE LINE THE PLAYER READS, and the reason it is a function of `phase`
 * and never of the note: this is the STATE, in the client's vocabulary, and it
 * is drawn BESIDE physics' sentence rather than instead of it. A screen needs
 * both: a short stable word to structure the panel, and the refuser's own
 * words to explain a refusal.
 *
 * `Done` deliberately does not say "arrived". For a hold-orbit it means the
 * orbit is achieved and that IS arrival; for a transfer it means the burns are
 * flown and the vehicle is now coasting toward the target, which is a different
 * claim. See the named ask at the bottom of this file.
 */
export function phaseWord(s: RunStatus): string {
  if (!s.armed) return 'OFF';
  switch (s.phase) {
    case Phase.Coast: return waitingToDepart(s) ? 'WAITING TO DEPART' : 'COASTING';
    case Phase.Orient: return 'POINTING';
    case Phase.Burn: return 'BURNING';
    case Phase.Done: return s.mode === Mode.HoldOrbit ? 'ARRIVED' : 'BURNS FLOWN';
    case Phase.Aborted: return 'STOPPED';
    default: return 'IDLE';
  }
}

// =============================================================================
// NAMED ASK TO THE PHYSICS LANE (gameplay -> physics, GP-276). ONE ITEM.
//
// Kept to one because an ask is only worth making for something the screen
// cannot honestly draw without it, and three of the four things this lane
// wanted turned out to be already available:
//
//   * delta-v remaining IN THE TANKS is `of_fl_remaining_dv_vacuum(f)`, which
//     has shipped for months. Not asked for.
//   * when the trip ends is `of_ap_departure_curve`'s word 3 for the departure
//     the player armed, which this client already holds. Not asked for.
//   * a REASON CODE beside `of_ap_note` would let a screen branch on why it
//     refused. Nothing in this UI branches on it today; `phase` and `running`
//     carry every branch that exists. Not asked for until something needs it,
//     because a field nobody reads is the same shape as the `ok` word GP-270
//     found nobody reading.
//
// THE ONE THAT IS REAL: CLOSING GEOMETRY. `range to target` and `closing speed`
// are the two numbers that say whether a RENDEZVOUS worked, they are the two
// numbers PH-155 measured to prove it does (1306.61 m closing at 206.4555 m/s
// at the match burn; 108.87 m at 0.23133 m/s at the end), and neither is in the
// 18. Without them `phase == Done` is the strongest thing the screen can say,
// and for a transfer that means "the burns are flown", not "you are there".
//
// THIS FILE DOES NOT WAIT FOR IT. `MapPlanner` computes the range and the
// closing rate as a SUBTRACTION of two positions /core itself produced (the
// flight state from `of_fl_state`, the target from the registry's own
// `of_orb_resume` propagation), which is not the forbidden thing: DW-18 forbids
// a second GRAVITY and R43 forbids a second DELTA-V, and this is neither. It is
// flagged rather than left silent because the day a DOCKING terminal exists the
// executor needs the same two numbers INSIDE its own loop, and at that point
// the authority has to be physics' and the subtraction here has to go.
//
// SECOND, AND IT IS GP-278's DEFECT ONE FIELD OVER, FOUND WHILE FIXING IT.
// `of_ap_cancel` cuts the throttle and does NOT reset `sim.sas`, so after a
// cancel the vehicle goes on holding the burn attitude in `SasMode::Command`
// while the navball's SAS chip draws `FlightSession.sasMode`, the client's own
// copy, which still says whatever the player last chose. Holding the attitude
// is arguably the RIGHT behaviour (a vehicle that goes slack mid-burn is
// worse), so this is not a request to change it: it is that the client has no
// way to DRAW it, because nothing publishes /core's sas mode. `of_fl_state` is
// 17 words and an eighteenth appended at the end moves no existing index, which
// is exactly how `radialOffsetM` arrived at ABI 20.
//
// NOT FIXED HERE, deliberately. The client could re-assert its own mode after a
// cancel and make the two agree, but that is a change to what the vehicle does,
// made at the end of a long pass, to fix a display problem. Reported instead.
//
// THIRD, STRUCTURAL RATHER THAN A FIELD: `of_ap_arm_transfer` has
// no terminal argument. Admin has ruled that a docking port will be a real part
// instance in a design, so "rendezvous" and "dock" must be ONE flow with a
// different last phase and not two features. When that lands, the shape that
// keeps this client unchanged is a leading `terminal` argument on the same
// call (0 rendezvous, 1 dock) plus the same number in the status row, rather
// than an `of_ap_arm_dock`. Recorded now, while it is free, because the day it
// is a second export it is a branch in every screen that reads this file.
// =============================================================================
