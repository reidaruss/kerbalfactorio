// WHAT THE WALKER WEIGHS, as a port.
//
// THIS IS NOT A SECOND GRAVITY. `PlanetBody.gravityAccel` remains the one
// authority for what gravity IS at a radius (standing rule 1, and the reason
// that rule exists is a transcribed copy that let the walker fall at 0.587
// m/s^2 while the propagator used 9.81). What this port answers is a different
// question: what a body at that point WEIGHS, which is not the same number the
// moment the thing it is standing on is itself falling.
//
// THE CORRECTION THIS EXISTS TO MAKE (PH-98). `SpaceStation.ts` said a
// nadir-pointing deck "buys real artificial gravity for free at the local
// inverse-square value". That is true of the FIELD STRENGTH and false of what
// an occupant feels, and the difference is the whole of orbital flight. A
// station at 400 km is in FREEFALL: it accelerates toward the planet at exactly
// the local g, and so does everything inside it, so nothing inside has any
// weight at all. The frozen-in-the-body-frame station of PH-94 is dynamically a
// tower on a 400 km pillar, and a tower is the one thing an orbit is not.
//
// SO THE MODEL IS ONE SUBTRACTION, and it is the physics rather than a fudge:
//
//     apparent g  =  g(where I am)  -  a(the frame I am riding in)
//
// On the terrain the frame is the (non-rotating, PH-87) planet surface, whose
// acceleration is zero, so apparent g is g and every existing number is
// bit-identical. Inside a freefalling carrier the two terms very nearly cancel
// and what is LEFT OVER is the tidal difference across the volume, which is a
// real quantity and not a rounding error: it is why "microgravity" is the word
// and "zero gravity" is not.
//
// A GENERATOR IS DEFINED AS CANCELLING THE CANCELLATION, and that is deliberate
// (PH-100). It does not publish a magnitude of its own. If it did, this file
// would be holding a second opinion about how hard the planet pulls, and the
// day somebody tuned it the deck would stop agreeing with the tower PH-90
// measured. Powered, the apparent g inside a volume is EXACTLY the true local
// gravity, so every figure derived under PH-90 to PH-97 carries over unchanged
// and none of them has to be re-taken.

import type { Vec3d } from '../world/PlanetBody.js';

/**
 * A set of regions that change what a body weighs inside them.
 *
 * An interface here rather than an import for the same reason `SolidBodies` is
 * one: a gravity volume is NOT a solid and must never become a second
 * definition of one. **The floor and the weight are separate questions** and
 * the walker composes two answers instead of merging them, because a deck with
 * no gravity is a handhold you drift past and a gravity volume with no deck is
 * a place you fall through. Both are things this game needs to be able to
 * describe.
 */
export interface GravityField {
  readonly count: number;
  /** Volume tests made since the last reset, charged to the tick budget. */
  tests: number;
  resetTests(): void;
  /**
   * Apparent radially-inward acceleration at a body-frame point, m/s^2.
   *
   * `trueG` is the caller's own answer from `PlanetBody.gravityAccel`, passed
   * IN rather than looked up here, so this port can never disagree with the
   * gravity authority about the term it is modifying. With no volume in range
   * the contract is to return `trueG` unchanged, bit for bit.
   */
  apparentAt(x: number, y: number, z: number, trueG: number): number;
}

/**
 * The whole-world uniform field, which exists to be an INSTRUMENT.
 *
 * Zeroing gravity everywhere is not a state the game can reach, and that is
 * exactly why the measurement needs it: the question "does the walker degrade
 * to a floating body when gravity goes away" has to be asked of the walker
 * ALONE, with no station, no volume geometry and no fringe in the answer. Any
 * defect it finds is then unambiguously the walker's.
 *
 * It is on the same port as the real thing rather than beside it, so the
 * measurement drives the code path the feature ships on. A separate debug hook
 * that multiplied gravity somewhere else would be measuring a fourth thing.
 */
export class UniformGravity implements GravityField {
  /** Multiplies the true local gravity. 1 is the untouched world; 0 is freefall
   *  everywhere. Deliberately not clamped: negative is a legal experiment. */
  scale = 1;
  readonly count = 1;
  tests = 0;
  resetTests(): void { this.tests = 0; }
  apparentAt(_x: number, _y: number, _z: number, trueG: number): number {
    this.tests++;
    return trueG * this.scale;
  }
}

/**
 * Two fields as one, `over` winning wherever it has anything to say.
 *
 * Needed because the instrument above and the station's volumes are both live
 * in a driven probe: a run that zeroes gravity globally and then asks what a
 * powered deck does is asking a composition question, and composing at the
 * call site would have put the ordering in `KinematicBody.step` where nobody
 * would find it again.
 */
export class StackedGravity implements GravityField {
  constructor(private readonly base: GravityField,
              private readonly over: GravityField) {}

  get count(): number { return this.base.count + this.over.count; }
  get tests(): number { return this.base.tests + this.over.tests; }
  set tests(_v: number) { /* the parts own their counts */ }
  resetTests(): void { this.base.resetTests(); this.over.resetTests(); }

  apparentAt(x: number, y: number, z: number, trueG: number): number {
    return this.over.apparentAt(x, y, z, this.base.apparentAt(x, y, z, trueG));
  }
}

/** Convenience for the radial magnitude at a body-frame point. */
export function radiusOf(p: Vec3d): number {
  return Math.hypot(p.x, p.y, p.z);
}
