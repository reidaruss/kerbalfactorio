// GP-118 / R10. THE PRE-FLIGHT VERDICT: is this design hopeless, and if so, in
// which named way?
//
// Reid has lost two build cycles to rockets that could not launch: one with an
// empty first stage, one at a stage-1 TWR of 0.98. Both facts were on screen in
// the bay before roll-out (per-stage TWR has been drawn since DW-30 item 4) and
// neither was FLAGGED, which is the difference between a readout and a warning.
// The pad lane made flight survivable; this file is where it gets prevented.
//
// THE BRIEF ASKED FOR TWO RULES AND BOTH ARE WRONG AS WRITTEN, and the thing
// that proved it is `probes/vabsnap.js` running its own negative control:
//
//   "any burn with zero engines that is not the last one, and any first burn
//    with TWR below 1.0"
//
// (1) A ZERO-ENGINE FIRST BURN IS THE NORMAL SHAPE OF A STAGED ROCKET HERE, not
//     a fault. vessel.h documents the KSP sequence it follows: pressing stage k
//     DROPS the spent hardware of burn k-1 and LIGHTS burn k, so `stages[0]`
//     decouples nothing by construction, and `of_vs_autostage` giving a leading
//     decoupler group its own burn produces a burn 0 with no engines on any
//     multi-stage design. GP-73 measured exactly that vehicle (pod / tank /
//     engine / decoupler, which GP-32 permits) reading burn 0 at 0 engines and
//     burn 1 at TWR 3.7026, AND LIFTING. Driven here it reads burn 0 at 0
//     engines, 0 decouplers, 6820 kg unchanged end to end, against burn 1 at 1
//     engine and TWR 2.4091. A check written to the brief would refuse it, and a
//     check that refuses a working rocket is a cage rather than a guard, which
//     is the exact failure GP-73 spent a session undoing.
//
// (2) "the first burn" is therefore the wrong burn to test. The physically
//     meaningful question is whether the first burn THAT HAS ENGINES can leave
//     the ground, so that is the one asked, and it is the number the panel now
//     labels `Lift TWR`. Reid's 0.98 is caught by it; GP-73's shape is not.
//
// WHAT IS ACTUALLY HOPELESS, then: no engine anywhere; the burn that must lift
// cannot; and the burn that must lift has thrust but nothing to burn, which is
// the most literal reading of "an empty first stage" and is a fault the brief
// did not name. A wasted press is a WARNING, because it costs a press and not a
// flight.
//
// Codes, never sentences, are what the caller branches on (the GP-44 rule): a
// probe asserting `dry-burn` turning into `twr-below-1` is a different
// assertion, while two prose strings are the same assertion twice.
import type { DesignStats, StageRow } from './VesselDesign.js';

export type FaultCode = 'empty' | 'no-engine' | 'twr-below-1' | 'dry-burn';
export type WarnCode = 'idle-stage' | 'coast-stage' | 'unstable' | 'no-crew';

/** `stage` is the stage the fault is ABOUT, or -1 for a whole-vehicle fault. It
 *  is carried as a number so a caller marks the right row without parsing the
 *  sentence, which would be the same assertion written twice in two shapes. */
export interface Fault { code: FaultCode; stage: number; text: string }
export interface Warn { code: WarnCode; stage: number; text: string }

export interface FlightVerdict {
  /** No fault. Warnings do not clear it and are not meant to. */
  ok: boolean;
  faults: Fault[];
  warnings: Warn[];
  /** The lowest-index stage that has an engine, or -1. The burn that lifts. */
  liftBurn: number;
  /** That burn's pad TWR, or 0 when there is no such burn. */
  liftTwr: number;
  /** One line for the panel band and for the roll-out refusal. */
  summary: string;
}

/** Below this a stage cannot raise the vehicle off the pad, by definition. */
const LIFT_TWR = 1.0;

export function flightCheck(stages: readonly StageRow[],
                            stats: DesignStats): FlightVerdict {
  const faults: Fault[] = [];
  const warnings: Warn[] = [];
  let liftBurn = -1;
  for (let k = 0; k < stages.length; ++k) {
    if ((stages[k]?.engines ?? 0) > 0) { liftBurn = k; break; }
  }
  const liftTwr = liftBurn >= 0 ? num(stages[liftBurn]?.twr) : 0;

  if (stats.parts <= 0 || stages.length === 0) {
    faults.push({ code: 'empty', stage: -1, text: 'there is no vehicle yet' });
  } else if (liftBurn < 0) {
    faults.push({
      code: 'no-engine', stage: -1,
      text: 'no stage has an engine, so nothing will ever burn',
    });
  } else if (liftTwr < LIFT_TWR) {
    faults.push({
      code: 'twr-below-1', stage: liftBurn,
      text: `stage ${liftBurn} lifts at TWR ${liftTwr.toFixed(2)}, and below `
        + '1.00 it cannot leave the pad: add thrust or take mass off',
    });
  }

  // THE BURN THAT LIFTS MUST HAVE SOMETHING TO BURN. An engine with no tank in
  // its own stage group has thrust, a TWR above 1 and a burn time of zero, which
  // is the most literal "empty first stage" there is and the one shape a TWR
  // check alone waves straight through.
  const lift = liftBurn >= 0 ? stages[liftBurn] : undefined;
  if (lift !== undefined && num(lift.propellantKg) <= 0 && num(lift.burnTimeS) <= 0) {
    faults.push({
      code: 'dry-burn', stage: liftBurn,
      text: `stage ${liftBurn} has an engine and nothing to burn, so it fires `
        + 'for 0.0 s: put a tank in that stage',
    });
  }

  // A press that lights nothing and drops nothing only advances the sequence.
  // It is a WARNING and not a fault: vessel.h's own stage order makes it the
  // normal shape of burn 0 on a staged rocket, and GP-73 measured that rocket
  // flying. Naming it is still worth doing, because a stage 0 reading 0 N is
  // what a player reads as a broken rocket.
  for (let k = 0; k < stages.length - 1; ++k) {
    const s = stages[k];
    if (s === undefined || s.engines > 0) continue;
    warnings.push(s.decouplers > 0
      ? { code: 'coast-stage', stage: k,
          text: `stage ${k} drops something and burns nothing` }
      : { code: 'idle-stage', stage: k,
          text: `stage ${k} lights nothing and drops nothing: that press only `
            + `advances the sequence, and stage ${liftBurn} is the one that burns` });
  }

  if (stats.parts > 0 && !stats.stable) {
    warnings.push({ code: 'unstable', stage: -1, text: 'the centre of pressure is ahead of the centre of mass: add fins' });
  }
  if (stats.parts > 0 && stats.crew <= 0) {
    warnings.push({ code: 'no-crew', stage: -1, text: 'no crew capacity: this is an unmanned probe' });
  }

  const ok = faults.length === 0;
  // The lift burn and its TWR are named in EVERY passing summary, because the
  // whole point of R10 is that the number stops being something you have to go
  // and look for.
  const summary = ok
    ? `stage ${liftBurn} lifts at TWR ${liftTwr.toFixed(2)}`
      + (warnings.length === 0 ? ''
        : `, with ${warnings.length} warning${warnings.length === 1 ? '' : 's'}`)
    : faults.map((f) => f.text).join('; ');
  return { ok, faults, warnings, liftBurn, liftTwr, summary };
}

function num(v: number | undefined): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}
