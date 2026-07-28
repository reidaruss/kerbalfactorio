// THE CAPSULE IS INSIDE ROCK. GET IT SOMEWHERE LEGAL, AT ANY DEPTH.
//
// Split out of KinematicBody, which owns gravity, the tick and the ground snap,
// because this is one question with one answer and it had no owner at all
// (R18/PH-60). The two functions that touch it are each correct on their own
// terms and neither of them owns the case:
//
//   * `VoxelCollider.floorBelow` returns `buried` when the feet are inside rock
//     past one step rung with rock all the way up. That is right: answering a
//     radius there ratifies the sink (WG-31), which is the defect this project
//     has now paid for three times.
//   * `VoxelCollider.resolveEmbedded` returns null when no single-axis push of
//     at most one cell leaves the whole capsule free. That is right too: its
//     answer IS the minimum translation vector for an axis-aligned lattice, and
//     the whole reason it replaced the old radial shove is that it can never
//     exceed one cell and therefore can never levitate anybody.
//
// TOGETHER THEY OWNED NOTHING, and the walker integrated gravity into bedrock
// for ever: measured on seed 991733, 4624 ticks with 0 grounded ticks, 0 floors
// and 0 pushes, ending 29,208 m below the surface at 12.83 m per tick and still
// accelerating. Driven measurement at the entry tick: all three capsule samples
// solid, all six one-cell exits under a metre and not one of them freeing the
// capsule, the nearest free position 3.5 m away along +Y, and 437 ticks later
// nothing free within 40 m in any direction. So this is not a bound that wants
// widening. It is a case that wants an owner.
//
// THE TWO RULES, AND THE SECOND ONE IS WHY THE FIRST ONE TERMINATES.
//
//  1. A CAPSULE MAY NOT BECOME BURIED. If a tick would end with the feet in
//     rock, no floor and no push out, the tick's motion is REFUSED and the
//     capsule keeps the position it started the tick at. By induction that
//     position is legal: the capsule starts on the surface, and every tick
//     after that either ends legal or ends where it started. The argument
//     mentions no rung, no cell size and no seed, so it holds at any burial
//     depth, and the walker can no longer manufacture a buried state for
//     itself.
//
//  2. A CAPSULE THAT IS ALREADY BURIED IS EJECTED UP THE LOCAL RADIAL. Rule 1
//     needs a legal position to fall back to, and the world can take one away:
//     the levelling tool raises terrain (`LevelAction.ts` says so out loud),
//     and a save written before this fix can hold a player 29 km down. THE
//     RADIAL IS THE ONLY DIRECTION WITH A TERMINATION PROOF: `solidForWalker`
//     is false for every point above its own column's `surfaceRadius` (PH-7),
//     so an upward escape is bounded by `surfaceRadius - r` from any depth,
//     while down and sideways are bounded by nothing at all. That asymmetry is
//     the whole reason `resolveEmbedded`'s six axes cannot own this and this
//     can.
//
// The eject stops at the first free radius within ONE CAPSULE PLUS ONE CELL,
// and otherwise goes straight to the column's own surface. That is not a tuned
// window, it is the distinction the answer turns on: rock thinner than the body
// that is standing in it is a FLOOR you are sunk into, and its top is where you
// belong; rock thicker than that is a MOUNTAIN you are inside, and the only
// place a mountain lets you stand is on it. Going straight there also keeps the
// cost of the deep case bounded at twelve grid steps rather than the 116,000 a
// 29 km legacy save would otherwise march.

import type { SurfaceOracle } from '../world/SurfaceOracle.js';
import type { Vec3d } from '../world/PlanetBody.js';
import { CAPSULE, VOXEL_FLOOR_SEARCH_M } from './KinematicBody.js';
import { VOXEL_STEP_UP_M, type VoxelCollider } from './VoxelCollision.js';

/** The absolute radial grid the eject steps on. `floorBelow`'s grid, so the
 *  two agree about where a crossing is instead of each having an opinion. */
const EJECT_MARCH_M = 0.25;

export interface RockEscapeResult {
  /** Feet position after the escape. */
  x: number; y: number; z: number;
  /** Metres `resolveEmbedded` pushed out of a cell face. 0 when it declined. */
  pushM: number;
  /** The RADIAL component of that push, signed. Positive is the lift. */
  pushUpM: number;
  /** Metres the last-resort radial eject lifted the capsule. 0 when it did not
   *  fire, which is every tick a walking player will ever have. */
  ejectM: number;
  /** True on a tick the floor query answered `buried`, whatever was done next. */
  buried: boolean;
  /** The escape put the capsule back on footing: ground it and stop the fall. */
  grounded: boolean;
  /** The tick was refused (rule 1). The capsule kept its old position and its
   *  velocity into the rock has to go with it, or it fires again next tick. */
  refused: boolean;
}

/**
 * The first radius at or above `r`, on this radial, where the capsule is
 * legally free. Never marches further than one capsule plus one cell; past
 * that the answer is the column's own surface, which is free by construction
 * because `solidForWalker` requires `r <= surfaceRadius`.
 */
function ejectRadius(col: VoxelCollider, oracle: SurfaceOracle, r: number,
  ux: number, uy: number, uz: number): number {
  const cap = r + CAPSULE.heightM + oracle.voxelSizeM();
  for (let rr = Math.ceil(r / EJECT_MARCH_M) * EJECT_MARCH_M; rr <= cap;
    rr += EJECT_MARCH_M) {
    if (col.solidForWalker(ux * rr, uy * rr, uz * rr)) continue;
    if (col.free(ux * rr, uy * rr, uz * rr, ux, uy, uz)) return rr;
  }
  // A hair PAST the surface, not on it: `solidForWalker` is `r <= surfaceRadius`
  // and at equality the cell may still read solid, so landing exactly on the
  // number would leave the capsule inside rock by the same predicate that sent
  // it here. The ground snap seats it properly on the next tick.
  return oracle.surfaceRadius(ux, uy, uz) + 1e-3;
}

/**
 * Resolve a capsule that has ended a tick inside rock: the minimum translation
 * first, the refusal second, the radial eject last. `p` and `r0` are where the
 * feet STARTED the tick, which is the position rule 1 falls back to.
 *
 * `buried` is `floorBelow`'s own answer for this tick, passed in rather than
 * re-derived, because two derivations of "am I in rock" is exactly the shape of
 * bug this file exists to close.
 */
export function escapeRock(col: VoxelCollider, oracle: SurfaceOracle,
  p: Vec3d, r0: number, qx: number, qy: number, qz: number,
  ux: number, uy: number, uz: number, buried: boolean): RockEscapeResult {
  const out: RockEscapeResult = {
    x: qx, y: qy, z: qz, pushM: 0, pushUpM: 0, ejectM: 0,
    buried, grounded: false, refused: false,
  };
  const push = col.resolveEmbedded(qx, qy, qz, ux, uy, uz);
  if (push !== null) {
    out.pushM = push.dist;
    out.x = qx + push.x; out.y = qy + push.y; out.z = qz + push.z;
    const nr = Math.hypot(out.x, out.y, out.z) || 1;
    out.pushUpM = (push.x * out.x + push.y * out.y + push.z * out.z) / nr;
    // Only a push with an UPWARD component is a landing. A sideways nudge out
    // of a rim wall must not ground a falling player, or stepping off the lip
    // of a shaft would catch them on the way down.
    out.grounded = out.pushUpM > 0.05 * push.dist;
    return out;
  }
  if (!buried) return out;

  // RULE 1. Refuse the tick and go back to where the feet started it.
  const b0 = 1 / (r0 || 1);
  const vx = p.x * b0, vy = p.y * b0, vz = p.z * b0;
  const back = col.floorBelow(r0, vx, vy, vz, VOXEL_FLOOR_SEARCH_M,
    VOXEL_STEP_UP_M[0]);
  if (back.kind === 'floor') {
    out.x = vx * back.r; out.y = vy * back.r; out.z = vz * back.r;
    out.grounded = true;
    out.refused = true;
    return out;
  }
  // RULE 2. There is nothing legal behind us, so there is nothing to refuse
  // back to. Up is the only bounded way out of rock.
  const er = ejectRadius(col, oracle, Math.hypot(qx, qy, qz) || 1, ux, uy, uz);
  out.ejectM = er - (Math.hypot(qx, qy, qz) || 1);
  out.x = ux * er; out.y = uy * er; out.z = uz * er;
  out.grounded = true;
  return out;
}
