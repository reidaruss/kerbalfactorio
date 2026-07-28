// GP-139. WHAT TO DO NEXT, ON THE PAD AND AFTERWARDS.
//
// Reid built a rocket, rolled it out, sat looking at a chip that said `CLAMPED`
// and stopped. The game had a perfectly good sentence for every one of those
// states already, in `FlightClamp.clampHoldReason`, and he never saw one of
// them, because that sentence is only produced when a press is REFUSED. A
// player who does not know which key to press never presses one, so the
// explanation was reachable only by the players who did not need it.
//
// SO THE INSTRUCTION IS STANDING, not a reaction. It is derived from state every
// frame and drawn until it stops being true, which is the same shape
// `AudioSettings.silentBecause` has and for the same reason: a condition that
// only speaks when poked is a condition nobody hears.
//
// IT NAMES EXACTLY ONE THING, in the order the states actually gate. That
// ordering is the whole design and it is not cosmetic. `clampHoldReason`'s own
// header records what happens when the order is wrong: the old single line said
// "throttle up" in all four clamp states, and Reid read it at 100% throttle with
// no engine lit, which is the one state it is most wrong about. It named the
// control already at its stop while the control that would actually free the
// vehicle was being refused by a guard. A guide that can do that is worse than
// no guide, so the acceptance asserts the negative directly: it must never name
// a control that is already at its limit.
//
// EVERY KEY COMES FROM `labelOf`. Bindings.ts owns every key name in this client
// and a second copy is a copy that goes stale on the next remap, which this
// project has paid for three times (H-5, the mute hint, the map hint).

import { labelOf } from '../player/Bindings.js';
import { litStageThrustN } from './FlightClamp.js';
import type { FlightSession } from './FlightSession.js';

/** How close to empty a burn has to read before the guide says to stage. */
const DRY_MS = 1.0;

/**
 * The one thing to do next, or '' when the player is not owed an instruction.
 *
 * '' is a real answer and not a gap: a vehicle climbing under power with fuel in
 * the tank needs nothing said to it, and a line that always says something is a
 * line players stop reading.
 */
export function launchStep(s: FlightSession): string {
  if (!s.live) return '';
  const stage = labelOf('stage');

  // --- ON THE PAD, in the order the clamp actually gates ---------------------
  if (s.status === 'CLAMPED') {
    // 1. NOTHING IS LIT. The only key that helps is stage, whatever the
    //    throttle reads, which is exactly the case GP-73 found Reid stuck in.
    if (litStageThrustN(s) <= 0) {
      const next = s.nextStageIndex();
      return next <= 0
        ? `Press ${stage} to light the first stage`
        : `Stage ${next - 1} has no engine in it. Press ${stage} again`;
    }
    // 2. LIT BUT SHUT. The clamp lets go by itself the moment thrust beats
    //    weight, so the instruction is the throttle and never the stage key.
    const pct = Math.round(s.throttleValue * 100);
    if (pct <= 0) return `Engine lit. Hold ${labelOf('throttleUp')} to throttle up`;
    // 3. LIT, OPEN, AND STILL DOWN. No flight input helps, so the way out is
    //    the one thing said out loud (GP-56, and `clampHoldReason` agrees).
    return `TWR ${s.currentTwr().toFixed(2)} at ${pct}%: too heavy to lift. `
      + `${labelOf('recover')} clears the pad and keeps the design`;
  }

  // --- FLYING ----------------------------------------------------------------
  if (s.status === 'DOWN') {
    return `Down. ${labelOf('recover')} recovers the vessel and clears the pad`;
  }
  // A burn that has run dry is the one thing a climbing player must act on, and
  // it is asked of the LIVE remaining delta-v rather than of a timer.
  if (s.remainingDvMS() <= DRY_MS && s.nextStageIndex() >= 0) {
    return `Out of fuel in this stage. Press ${stage}`;
  }
  if (s.status === 'ASCENT') {
    return s.throttleValue <= 0
      ? `Hold ${labelOf('throttleUp')} to throttle up`
      : '';
  }
  if (s.status === 'COAST') {
    // Apoapsis is metres above the datum. Burning prograde AT it is the whole
    // of circularising, and it is the one instruction that turns a lob into an
    // orbit, which is the thing this game is about.
    const apo = s.orbit.apoapsisAltM;
    return Number.isFinite(apo) && apo > 0
      ? `Coasting to ${(apo / 1000).toFixed(0)} km. Burn prograde at apoapsis `
        + 'to circularise'
      : 'Coasting. Burn prograde at apoapsis to circularise';
  }
  if (s.status === 'ORBIT') return `In orbit. ${labelOf('map')} opens the map`;
  return '';
}

/**
 * Which control the instruction is currently naming, or ''.
 *
 * PUBLISHED SO THE ACCEPTANCE CAN ASSERT THE NEGATIVE rather than read the
 * sentence. The failure this guide exists to avoid is naming a control that is
 * already at its stop, and matching that on prose would be matching on wording
 * that is meant to change. An action name is a fact.
 */
export function stepNames(s: FlightSession): string {
  if (!s.live) return '';
  if (s.status === 'CLAMPED') {
    if (litStageThrustN(s) <= 0) return 'stage';
    return s.throttleValue <= 0 ? 'throttleUp' : 'recover';
  }
  if (s.status === 'DOWN') return 'recover';
  if (s.remainingDvMS() <= DRY_MS && s.nextStageIndex() >= 0) return 'stage';
  if (s.status === 'ASCENT') return s.throttleValue <= 0 ? 'throttleUp' : '';
  if (s.status === 'ORBIT') return 'map';
  return '';
}
