// THE LAUNCH CLAMP'S TWO RULES, and both of them are about what the player is
// allowed to be told and allowed to do while the vehicle is still bolted down.
//
// It is its own file rather than three methods on `FlightSession` for the
// reason `FlightPad.ts` gives about itself: the session decides WHEN to step
// and with what inputs, and this decides something else entirely, whether a
// stage press on the pad is a mistake. Also, honestly, because the session is
// at the 400-line cap and a rule this contested needs its reasoning next to it.
//
// GP-73 corrects PH-29. PH-29's guard was `status === 'CLAMPED' && stagings > 0`
// and its reason was sound: the first press lights the engine, exactly as in
// KSP, and a second while the clamp still holds throws the booster away, after
// which what is left cannot reach TWR 1 and the clamp never releases. Measured
// then: four presses took the reference vehicle from 11 parts to 4 and bolted
// it to the ground.
//
// WHAT IT ASSUMED, AND WHAT MEASUREMENT SAID. It assumed the first stage always
// contains the engine. It need not, and the counter-example is a joint GP-32
// EXPLICITLY PERMITS: a stack decoupler hung under an engine bell. `of_vs_
// autostage` groups decouplers by tree depth and gives burn k the engines in
// the deepest remaining group's subtree, so a decoupler with nothing below it
// owns a burn 0 containing exactly itself. Driven in the shipped bay, sandbox,
// `handStaged: false`, so this is what autostage does and not what a stale
// table does:
//
//   pod / tank / engine / decoupler   ->  burn 0: 0 engines, 0 N, 0 m/s, 0 s
//                                         burn 1: 1 engine, 200000 N, TWR 3.70
//
// Against the reference vehicle (probes/ascent.js), whose burn 0 does hold the
// engine, so the two are genuinely different vehicles and not two readings of
// one. On the empty-burn vehicle the ONLY key that frees the rocket is the key
// PH-29 refused, and the message it refused with named the throttle, which
// Reid already had at 100%.
//
// THE RULE THAT REPLACES IT: refuse a second press only when there is something
// to LOSE, which on the pad means only when the burn that is already running
// actually makes thrust. A burn making no thrust has nothing aboard whose
// jettison could lower TWR (dropping mass with no thrust can only raise it), so
// discarding it costs the player nothing and is the one move forward.
import type { FlightSession } from './FlightSession.js';

/**
 * THE THRUST THE LIT BURN CAN MAKE, in newtons at full throttle. Zero before
 * the first stage press and zero whenever the burn that is running has no
 * engine in it.
 *
 * OFF THE AS-BUILT STAGE TABLE AND DELIBERATELY NOT OFF `telemetry.thrustN`.
 * Telemetry is scaled by the THROTTLE, and PH-29's measured case is four
 * presses with the throttle SHUT: a live-thrust test reads zero there, would
 * wave all four through and would re-break the exact case the guard exists for.
 * The two requirements pull opposite ways and this is the only reading that
 * satisfies both. Vacuum against sea level does not matter, because the only
 * question asked of the number is whether it is zero.
 *
 * `nextStageIndex` is /core's own counter and points at the burn that has NOT
 * fired, so the lit one is the one before it.
 */
export function litStageThrustN(s: FlightSession): number {
  const k = s.nextStageIndex() - 1;
  if (k < 0) return 0;
  return s.stageRows[k]?.thrustVacN ?? 0;
}

/** May a stage press go through while the clamp still holds? See the header. */
export function mayStageWhileClamped(s: FlightSession): boolean {
  return litStageThrustN(s) <= 0;
}

/** What the refusal says when it does refuse. Unchanged from PH-29, because in
 *  the case that still refuses it was always the right sentence. */
export const STAGE_REFUSAL =
  'clamp still holding: throttle up first, do not stage again';

/**
 * WHY THE CLAMP IS STILL HOLDING, as one of four sentences, because the four
 * states ask the player for four different things and one sentence can only be
 * right about one of them.
 *
 * The old line was `clamp holding: TWR 0.00, throttle up` in all four. Reid
 * read it at 100% throttle with no engine lit, which is the state it is most
 * wrong about: it names the one control already at its stop while the control
 * that would free the vehicle was being refused by the guard above.
 *
 * The fourth sentence names the recovery key, and that is deliberate rather
 * than helpful noise: a vehicle that genuinely cannot lift at full throttle is
 * the one state from which no flight input helps at all, so it is exactly where
 * the way out has to be said out loud (GP-56). The LABEL is handed in and never
 * written here, because Bindings.ts owns every key name in this client and a
 * second copy of one is a second copy that goes stale on the next remap (H-5).
 */
export function clampHoldReason(s: FlightSession, twr: number,
                                recoverKey: string): string {
  if (litStageThrustN(s) <= 0) {
    const next = s.nextStageIndex();
    return next <= 0
      ? 'clamp holding: no engine is lit yet, press stage to light one'
      : `clamp holding: stage ${next - 1} has no engine, stage again`;
  }
  const pct = Math.round(s.throttleValue * 100);
  if (pct <= 0) return `clamp holding: TWR ${twr.toFixed(2)}, throttle up`;
  return `clamp holding: TWR ${twr.toFixed(2)} at ${pct}% throttle, this stage `
    + `cannot lift. ${recoverKey} clears the pad and keeps the design`;
}
