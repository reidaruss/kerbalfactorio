// MOVING WITH NO WEIGHT (PH-99).
//
// Deliberately the same SHAPE as Swim.ts, because it is the same kind of
// statement: a medium changes how the capsule moves, the change is a function
// of one measured scalar, and the walker keeps its one collision path. Swim.ts
// turns `submersionM` into buoyancy and drag; this turns `apparentG` into
// whether you have traction at all. A reader who has understood one has
// understood the other, and that was worth more than a few lines saved.
//
// THE ONE PLACE THEY DIFFER, AND IT IS THE INTERESTING ONE. Water is a servo:
// let go and the drag stops you, which is what water does. Vacuum is not.
// **The walker's tangential control has ALWAYS been a velocity servo** -- read
// `KinematicBody.step`, the move term is `d = wantVelocity - haveVelocity`
// clamped to `accel * dt`, so releasing the key drives the velocity to zero at
// 6 m/s^2 whether or not anything is touching you. On the ground that is
// correct and invisible: it is friction, and friction is real. In freefall it
// is a lie with no mechanism, and it is the single biggest reason the existing
// walker does not degrade into a floating body when gravity is removed. It does
// not float. It hovers on an invisible shell and stops dead when you let go.
//
// SO IN FREEFALL THE COMMAND IS A THRUST, NOT A TARGET SPEED:
//
//     v += dir * thrustAccel * dt          (and NOTHING removes it)
//
// with a GOVERNOR rather than a cap -- the suit declines to push you past
// `maxSpeedMps`, but it never slows you down, so momentum you arrive with is
// momentum you keep. That distinction is the whole feel. A cap implemented as
// `speed = min(speed, max)` would silently be a servo again, and it would be
// invisible in every screenshot.
//
// WHAT THE PLAYER DOES ABOUT IT, which is the design question Admin asked to be
// answered rather than deferred (PH-101):
//
//   * THRUST. WASD in the horizon plane, jump/sprint on the radial. Always
//     available, no propellant meter. See PH-101 for why the meter is deferred
//     rather than forgotten.
//   * STOP BY HITTING SOMETHING. Contact with structure is INELASTIC: the
//     capsule keeps no speed at all through a blocked step, radial included.
//     This is not a simplification, it is what a suited human does with their
//     arms, and it needs no authored handrail, no grab key and no new UI --
//     `StructureBodies.resolveStep` already reports `blocked` and the walker
//     already zeroes tangential velocity on it. The one thing that had to be
//     added is that in freefall it must zero the RADIAL half too, because
//     gravity is no longer there to own that axis.
//
// Handrails are therefore an ART affordance telling you where stopping is easy,
// not a system. That is the honest version of "hand over hand": you can catch
// any surface, and a rail is where a surface is put within reach on purpose.

import type { GravityField } from './GravityPort.js';

export const ZEROG = {
  /**
   * Apparent |g| at or below which the walker has no traction and floats.
   *
   * 0.15 m/s^2 is 1.5% of Forge's surface gravity. The reference points that
   * set it: the Moon is 1.62 and people walked there, Ceres is 0.27 and a
   * person there cannot get purchase at all. Anything a player can meaningfully
   * stand on is orders of magnitude above this, and the number that actually
   * has to clear it is the station's, which is measured rather than assumed --
   * see `probes/zerog.js`, where an unpowered volume reads ~1e-4.
   */
  floatG: 0.15,
  /**
   * Apparent |g| at or above which traction comes back. STRICTLY GREATER than
   * `floatG`, and the gap is the whole point.
   *
   * R36 is the lesson being applied without being made to happen again: the
   * deep/shallow gate chattered 8 times in 152 ticks on a steep face and put
   * the walker ballistic on 19 of them, because a threshold was evaluated on a
   * quantity that jitters either side of it. A gravity volume has an EDGE, a
   * player stands in doorways, and a bare threshold there is the same defect
   * waiting with a different name. `deepGate` answered it with hysteresis and
   * so does this.
   */
  standG: 0.30,
  /**
   * Suit translation authority, m/s^2, on every axis.
   *
   * NASA's SAFER is about 0.3 m/s^2, which from rest is 13 seconds to cross a
   * hub room. That is accurate and unplayable. 1.5 reaches the governor in
   * 2.7 s, which is long enough that a push is a COMMITMENT -- you decide, you
   * wait, and you have to start arresting before you want to stop -- and short
   * enough that crossing the station is not an errand.
   */
  thrustAccel: 1.5,
  /**
   * Speed the suit declines to push PAST. Not a speed limit: see the header.
   *
   * 4.0 m/s sits deliberately just under the 4.6 m/s walk, so a powered deck
   * is genuinely the faster way to travel and gravity reads as an upgrade
   * rather than as a tax. Arresting from 4.0 takes 2.7 s and 5.4 m, which in a
   * 2.5 m corridor means you will hit things. Hitting things is free.
   */
  maxSpeedMps: 4.0,
};

/**
 * What the capsule weighs this tick, and the one place that is decided.
 *
 * `trueG` is kept alongside `apparentG` rather than discarded because the
 * DIFFERENCE is the physically meaningful quantity (it is the carrier's
 * freefall) and because a report that showed only the apparent value could not
 * distinguish "I am in orbit" from "gravity is switched off", which are the two
 * things this lane most needs to tell apart.
 */
export interface WeightState {
  /** True local gravity from `PlanetBody.gravityAccel`, m/s^2. */
  trueG: number;
  /** What a body here actually weighs, m/s^2 radially inward. */
  apparentG: number;
  /** No traction: the thrust model owns the tick. Hysteretic, see `weightGate`. */
  weightless: boolean;
}

export function newWeightState(): WeightState {
  return { trueG: 0, apparentG: 0, weightless: false };
}

/**
 * The hysteretic float gate. `was` is the LAST tick's answer, which is half of
 * this tick's, exactly as in `deepGate`.
 */
export function weightGate(apparentG: number, was: boolean): boolean {
  const g = Math.abs(apparentG);
  if (was) return g < ZEROG.standG;
  return g <= ZEROG.floatG;
}

/**
 * Read the field at the feet and update `st` in place.
 *
 * With no field installed this returns `trueG` untouched and `weightless`
 * false, so every gravity-bound path in the walker is bit-identical to what it
 * was before this file existed. That is asserted rather than asserted-by-eye:
 * `probes/zerog.js` Z0 drives the ordinary ground walk with the field absent
 * and with a field that is uniformly 1.0, and requires the feet to agree to
 * 0.000000 m.
 */
export function readWeight(st: WeightState, field: GravityField | null,
                           x: number, y: number, z: number,
                           trueG: number): WeightState {
  st.trueG = trueG;
  st.apparentG = field === null ? trueG : field.apparentAt(x, y, z, trueG);
  st.weightless = weightGate(st.apparentG, st.weightless);
  return st;
}

/**
 * The thrust the suit adds along one axis this tick, m/s.
 *
 * `cmd` is -1..1, `have` is the current speed component and `speed` the current
 * TOTAL speed. The governor is checked against the total rather than per-axis,
 * or a player holding two axes would reach 5.66 m/s on the diagonal, which is
 * the oldest bug in movement code.
 *
 * It refuses to add only when it would push the TOTAL past the governor AND the
 * push is outward-going. A component that reduces the total is always allowed,
 * which is what makes braking work at any speed and is the reason this is not
 * a clamp.
 */
export function thrustStep(cmd: number, have: number, speed: number,
                           dt: number): number {
  if (cmd === 0) return 0;
  const dv = cmd * ZEROG.thrustAccel * dt;
  // Braking, or still under the governor: always allowed.
  if (speed <= ZEROG.maxSpeedMps) return dv;
  return (have > 0 && dv < 0) || (have < 0 && dv > 0) ? dv : 0;
}
