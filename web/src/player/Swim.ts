// BUOYANCY AND THE SWIM STATE (WG-40).
//
// A capsule in water is still the DW-12 capsule: no physics engine, no fluid
// solver, no volume integral. What changes is one number, the radial
// acceleration, and it changes CONTINUOUSLY with how much of the capsule is
// under the water surface. That continuity is the whole design, and it is why
// there is no `isSwimming` boolean threshold anywhere below.
//
// WHERE "AM I IN WATER" IS ANSWERED: `WaterOracle.submersionM(point)`, and
// nowhere else. This module takes that ONE number and turns it into motion. It
// never asks for a surface height, never compares against the ground, and never
// sees the SurfaceOracle. DW-26's rule, applied at the consumer: the client
// cannot accidentally read the water level as the ground, because the code that
// swims has no way to name the ground.
//
// THE EQUILIBRIUM IS PHYSICAL, NOT A CONSTANT. Net radial acceleration is
//   a = -g * (1 - buoyancy * frac),   frac = submerged fraction of the capsule
// so the float line is where `buoyancy * frac == 1`, i.e. frac = 1/buoyancy.
// At the shipped 1.35 that is 0.7407, which on a 1.80 m capsule puts the
// waterline 1.333 m above the feet and leaves the 1.62 m eye 0.287 m clear of
// the surface. A player who stops swimming BOBS UP TO THAT LINE and stays
// there, from above it or below it, because it is a stable fixed point of the
// acceleration and not a state anyone switched into. Nothing has to decide
// when swimming starts; there is no frame where the answer flickers.
//
// WADING IS THE SAME EQUATION. Below the float line the net acceleration is
// still downward, so the feet stay on the bed and the walker walks - just
// slower, because drag scales with the same `frac`. Wading, swimming and
// standing on the shore are one continuous function of depth, which is exactly
// what "wade in from the shore with the depth increasing" has to mean if it is
// going to feel like anything.
//
// DROWNING: NO. See DROWNING below - the decision, and the seam left for it.

import type { WaterOracle } from '../world/WaterOracle.js';
import type { Vec3d } from '../world/PlanetBody.js';

export const SWIM = {
  /**
   * Displaced weight over body weight at FULL submersion. Above 1.0 the
   * capsule floats. 1.35 is chosen for the eye line, not from a density table:
   * a real human is about 1.02, which floats with the mouth at the waterline
   * and would put this camera 1.3 cm above the water. The player has to be able
   * to SEE while swimming, so the character is buoyant like someone wearing a
   * pressure suit, which is what they are wearing.
   */
  buoyancy: 1.35,
  /** Radial damping in water, per second. Kills the bob in about a second. */
  dragUp: 3.2,
  /** Tangential damping in water, per second. */
  dragTangent: 2.2,
  /** Top swim speed, m/s. Slower than the walk on purpose: water is a cost. */
  swimSpeedMps: 2.2,
  /** Steering authority while swimming. Between ground (34) and air (6). */
  swimAccel: 9.0,
  /**
   * Upward acceleration while the jump action is HELD and the capsule is in
   * water. Held rather than impulsed, because the thing a player actually
   * needs this for is climbing out at the bank, which is a sustained push and
   * not a jump. It also serves as "surface faster" from a dive.
   */
  riseAccel: 12.0,
  /** Fraction of walk speed lost at full submersion while still on the bed. */
  wadeDrag: 0.55,
  /** Capsule fraction under water past which the feet stop holding the walker. */
  get floatFrac(): number { return 1 / SWIM.buoyancy; },
};

/**
 * DROWNING: DECIDED, AND THE ANSWER IS NO. (WG-40, and Reid did not say.)
 *
 * Three reasons, in order of weight.
 *
 * (1) The buoyancy above makes it nearly unreachable by accident. The capsule
 *     floats to a fixed point with the head out, from any depth, with no input.
 *     A drowning rule would therefore almost never fire on a player who fell
 *     in; it would fire on a player who deliberately held a dive, which means
 *     the mechanic is a punishment for experimenting with a feature that was
 *     just added, thirty-odd metres from the spawn point.
 *
 * (2) It is the wrong genre pressure. This game's hazards are meant to be about
 *     logistics and a hostile planet, not about a survival meter. Factorio has
 *     no swimming at all; KSP lets a kerbal sit in the sea indefinitely. The
 *     nearest comparable that DOES drown you, Satisfactory, drowns you in an
 *     ocean you cross, not in a pond you wade into.
 *
 * (3) There is nothing to trade against it yet. A drown timer is only
 *     interesting if there is a reason to go under and something to gain by
 *     staying: a diving suit, something on the bed worth having, a deep body of
 *     water that is a real obstacle. All three are absent, so the mechanic
 *     would be cost with no decision attached, which is the test DW-30 sets.
 *
 * THE SEAM IS LEFT IN, and deliberately measured rather than stubbed:
 * `headUnderM` and `breathSecs` below are computed and published every tick and
 * consumed by nobody. When there is a reason to drown, the quantity it needs
 * already exists, has been running in the build, and can be read by a probe
 * today. Reversing this decision is wiring a consumer to a number that is
 * already correct, not adding a system.
 */
export interface SwimState {
  /** Metres the FEET are below the water surface. Negative when clear of it. */
  feetUnderM: number;
  /** Fraction of the capsule under water, 0 to 1. THE quantity everything reads. */
  frac: number;
  /** True when buoyancy exceeds weight, i.e. frac is past the float line. */
  floating: boolean;
  /** True whenever any part of the capsule is wet. Wading counts. */
  inWater: boolean;
  /** Metres the EYE is below the water surface. Negative above it. What the
   *  camera needs, and the number an underwater view would key off. */
  headUnderM: number;
  /** Seconds the eye has been continuously under water. Consumed by NOBODY:
   *  see DROWNING above. Resets the moment the eye surfaces. */
  breathSecs: number;
}

export function newSwimState(): SwimState {
  return {
    feetUnderM: 0, frac: 0, floating: false, inWater: false,
    headUnderM: 0, breathSecs: 0,
  };
}

/**
 * Read the water at the capsule and update `st` in place.
 *
 * `feet` is the body-frame foot position at the START of the tick. One tick of
 * lag is 16.7 ms, which at the 2.2 m/s swim speed is 3.7 cm, and the alternative
 * is querying after the integrate and re-deciding the acceleration that
 * produced it.
 */
export function readWater(st: SwimState, water: WaterOracle | null,
                          feet: Vec3d, capsuleHeightM: number,
                          eyeHeightM: number, dt: number): SwimState {
  if (water === null || !water.hasWater) {
    st.feetUnderM = 0; st.frac = 0; st.floating = false; st.inWater = false;
    st.headUnderM = 0; st.breathSecs = 0;
    return st;
  }
  const under = water.submersionM(feet.x, feet.y, feet.z);
  // The oracle's dry answer is a large negative, so this arithmetic stays
  // finite and every comparison below reads "unreachably far above the water",
  // which is the correct sense. No sentinel test is needed and none is written,
  // because a sentinel test someone forgets is the failure the sentinel's sign
  // was chosen to make impossible.
  st.feetUnderM = under;
  const f = under / capsuleHeightM;
  st.frac = f <= 0 ? 0 : (f >= 1 ? 1 : f);
  st.inWater = under > 0;
  st.floating = st.frac > SWIM.floatFrac;
  st.headUnderM = under - eyeHeightM;
  st.breathSecs = st.headUnderM > 0 ? st.breathSecs + dt : 0;
  return st;
}

/** Radial acceleration in m/s^2, given gravity and the wetness. Negative down. */
export function radialAccel(st: SwimState, gravity: number): number {
  return -gravity * (1 - SWIM.buoyancy * st.frac);
}

/** Steering authority for the tangential move: ground, air, or water. */
export function moveAccel(st: SwimState, grounded: boolean,
                          groundAccel: number, airAccel: number): number {
  if (st.floating) return SWIM.swimAccel;
  return grounded ? groundAccel : airAccel;
}

/**
 * The speed cap the intent is allowed to ask for. Floating is a hard swap to
 * the swim speed; wading is a continuous tax on the walk speed, so the player
 * feels the water take hold before it takes over.
 */
export function moveSpeed(st: SwimState, wanted: number): number {
  if (st.floating) return Math.min(wanted, SWIM.swimSpeedMps);
  if (!st.inWater) return wanted;
  return wanted * (1 - SWIM.wadeDrag * st.frac);
}

/** Per-second damping factor for the radial velocity, applied over dt. */
export function dragUpFactor(st: SwimState, dt: number): number {
  if (!st.inWater) return 1;
  const k = 1 - SWIM.dragUp * st.frac * dt;
  return k < 0 ? 0 : k;
}

/** Per-second damping factor for the tangential velocity, applied over dt. */
export function dragTangentFactor(st: SwimState, dt: number): number {
  if (!st.inWater) return 1;
  const k = 1 - SWIM.dragTangent * st.frac * dt;
  return k < 0 ? 0 : k;
}
