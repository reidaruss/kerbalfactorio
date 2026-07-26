// Capsule against the 1 m voxel lattice. Split out of KinematicBody because it
// is a different kind of question: KinematicBody owns gravity, ground, slope and
// the tick, and this owns the one geometric fact that a voxel face is always
// perpendicular to a body-frame axis.
//
// That fact is what makes every resolution here EXACT rather than approximate:
//
//   * `resolveStep` slides by dropping the blocked axis, which is the exact
//     projection onto the wall plane (15.2 item 57), and
//   * `resolveEmbedded` pushes out along the axis of minimum penetration, which
//     IS the minimum translation vector for an axis-aligned lattice.
//
// The second one replaces the shallow radial push that 15.2 item 48 is about.
// The old push was sized from the whole CAPSULE (`heightM - h + 1.0`, up to
// 2.8 m) and always pointed radially outward, so it did not resolve the
// geometry at all: it lifted the player until the deepest sample happened to
// clear. At a dig mouth that meant a player who brushed the rim was launched
// vertically instead of being nudged out of the wall, and it is why item 48 had
// to be skipped entirely underground to stop it levitating people through their
// own ceiling. The exit distance to a cell face never exceeds one cell, so the
// replacement cannot levitate anybody anywhere, and it needs no depth-based
// special case.
//
// Standing rule 1: every solidity answer comes from `surface_field.h` through
// the oracle. Nothing here decides what is rock.

import type { SurfaceOracle } from '../world/SurfaceOracle.js';
import type { Vec3d } from '../world/PlanetBody.js';

/**
 * Capsule sample heights above the feet, in metres. Three points up the capsule,
 * because a single feet test lets the player walk their head through a ceiling,
 * and a full swept capsule is not affordable in-frame (DW-12: no physics engine).
 */
export const CAPSULE_SAMPLES_M = [0.15, 0.9, 1.65];
/** Ledge heights a blocked step retries at, metres. A voxel is 1 m. */
const STEP_UP_M = [0.55, 1.1];

export interface StepResult { x: number; y: number; z: number; blocked: boolean }
/** A minimum translation out of solid. `dist` is its length in metres. */
export interface PushResult { x: number; y: number; z: number; dist: number }

/** The six axis directions a voxel face normal can be, body frame. */
const AXES: [number, number, number][] = [
  [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
];

export class VoxelCollider {
  /** Oracle calls made since the last `resetCalls`. Charged to the tick budget. */
  calls = 0;
  private readonly cellM: number;

  constructor(private readonly oracle: SurfaceOracle) {
    this.cellM = oracle.voxelSizeM();
  }

  resetCalls(): void { this.calls = 0; }

  /**
   * Is this point rock the WALKER has to resolve against? Both of the oracle's
   * answers, about the same point, and they are not the same answer.
   *
   * `solidAt` quantises to the 1 m cell and a cell is solid when its CENTRE is
   * at or below the designed surface (surface_field.h section 5). The walkable
   * ground is the smooth `surfaceRadius`. So the solid shell is a staircase
   * around the surface, and a cell whose centre is a few centimetres under the
   * ground is solid all the way up to its top face, which can stand most of a
   * metre PROUD of the ground the player is walking on. Measured on ordinary
   * terrain: the air 0.15 m above the walkable surface reads solid on 60.6% of
   * ticks (walkfeel.js).
   *
   * That phantom rock was the whole "you get stuck unless you jump" complaint.
   * The capsule's lowest sample is inside it on most ticks, `resolveEmbedded`
   * ejects along the minimum translation, and the minimum translation out of a
   * cell you have just barely entered is back through the face you entered by,
   * which is exactly the 7.7 cm you had just walked. Every tick. The walker
   * advanced and was pushed back to where it started, at full commanded speed,
   * grounded, with no flag raised anywhere.
   *
   * A point ABOVE its own column's walkable surface is therefore air, whatever
   * the cell quantisation says. This does not invent a second surface: it makes
   * the walker require BOTH of the oracle's answers to agree before it treats
   * something as rock, and above the ground it is the heightfield that is
   * authoritative (it is the thing the ground snap stands the player on).
   *
   * Below the surface nothing changes, so the dig mouth (15.2 item 48) and the
   * tunnel interior are untouched: a rim wall beside a shaft belongs to an
   * UNDUG column whose surface is metres higher, so a capsule embedded in it is
   * still solidly inside rock and still gets pushed out.
   */
  private solidForWalker(px: number, py: number, pz: number): boolean {
    this.calls++;
    if (!this.oracle.solidAt(px, py, pz)) return false;
    const r = Math.hypot(px, py, pz);
    if (r < 1e-6) return true;
    this.calls++;
    return r <= this.oracle.surfaceRadius(px / r, py / r, pz / r);
  }

  /**
   * Is the whole capsule in air at this foot position? The feet-only test this
   * replaces let the player walk their head through a ceiling, which mattered
   * the moment the bore got wide enough to walk down at all.
   */
  free(x: number, y: number, z: number, ux: number, uy: number, uz: number): boolean {
    for (const h of CAPSULE_SAMPLES_M) {
      if (this.solidForWalker(x + ux * h, y + uy * h, z + uz * h)) return false;
    }
    return true;
  }

  /**
   * Resolve one step against solid voxels: take it, climb it, slide it, or
   * refuse it, in that order. Sliding drops ONE body-frame axis of the
   * displacement at a time and keeps the best survivor, ordered by how much
   * displacement each candidate keeps, so a glancing contact loses the least.
   */
  resolveStep(p: Vec3d, qx: number, qy: number, qz: number,
    ux: number, uy: number, uz: number): StepResult {
    if (this.free(qx, qy, qz, ux, uy, uz)) return { x: qx, y: qy, z: qz, blocked: false };
    // Already embedded (spawned into rock, or a dig closed around us): refusing
    // would be a permanent lock, and the destination cannot be worse than here.
    if (!this.free(p.x, p.y, p.z, ux, uy, uz)) return { x: qx, y: qy, z: qz, blocked: false };
    // A ledge. Lifting the feet is enough: the caller's floor march re-seats
    // them on whatever they actually landed on, so this never levitates.
    for (const h of STEP_UP_M) {
      const sx = qx + ux * h, sy = qy + uy * h, sz = qz + uz * h;
      if (this.free(sx, sy, sz, ux, uy, uz)) return { x: sx, y: sy, z: sz, blocked: false };
    }
    const dx = qx - p.x, dy = qy - p.y, dz = qz - p.z;
    // Drop-one-axis first (keeps two), then single-axis (keeps one).
    const tries: [number, number, number][] = [
      [0, dy, dz], [dx, 0, dz], [dx, dy, 0], [dx, 0, 0], [0, dy, 0], [0, 0, dz],
    ];
    tries.sort((a, b) => (b[0] * b[0] + b[1] * b[1] + b[2] * b[2])
      - (a[0] * a[0] + a[1] * a[1] + a[2] * a[2]));
    for (const [ax, ay, az] of tries) {
      if (ax === dx && ay === dy && az === dz) continue;   // already refused
      if (ax === 0 && ay === 0 && az === 0) continue;
      const sx = p.x + ax, sy = p.y + ay, sz = p.z + az;
      if (this.free(sx, sy, sz, ux, uy, uz)) return { x: sx, y: sy, z: sz, blocked: false };
    }
    return { x: p.x, y: p.y, z: p.z, blocked: true };
  }

  /**
   * THE MOUTH FIX (15.2 item 48). Push a capsule that is already inside solid
   * rock out along the FACE it is inside, by exactly the distance that clears
   * that face, and no further.
   *
   * For each of the six axis directions, the translation needed is the largest
   * exit distance over the samples that are actually in rock: for a point at x
   * inside cell `cx = floor(x / cellM)`, leaving through the +X face costs
   * `(cx + 1) * cellM - x` and through the -X face costs `x - cx * cellM`. A
   * candidate is accepted only if the whole capsule is free after it, and the
   * cheapest accepted candidate wins. Because a voxel's contact normal is always
   * an axis, that IS the minimum translation vector; nothing is approximated and
   * nothing is sized from the capsule, so no push can exceed one cell per
   * sample. Returns null when the capsule is already clear, which is the case on
   * every tick that is not standing in a dig rim.
   */
  resolveEmbedded(x: number, y: number, z: number,
    ux: number, uy: number, uz: number): PushResult | null {
    const c = this.cellM;
    // Collect the solid samples once. Three oracle calls in the common case,
    // and the common case is "none of them are solid, return null".
    const solid: [number, number, number][] = [];
    for (const h of CAPSULE_SAMPLES_M) {
      const px = x + ux * h, py = y + uy * h, pz = z + uz * h;
      if (this.solidForWalker(px, py, pz)) solid.push([px, py, pz]);
    }
    if (solid.length === 0) return null;

    let best: PushResult | null = null;
    for (const [ax, ay, az] of AXES) {
      let need = 0;
      for (const [px, py, pz] of solid) {
        // Distance from this point to the face of ITS cell in direction (a).
        const q = ax !== 0 ? px : ay !== 0 ? py : pz;
        const sign = ax !== 0 ? ax : ay !== 0 ? ay : az;
        const cell = Math.floor(q / c);
        const exit = sign > 0 ? (cell + 1) * c - q : q - cell * c;
        if (exit > need) need = exit;
      }
      // A hair past the face: landing exactly ON a cell boundary re-quantizes to
      // the cell we are leaving, and the push would fire again next tick.
      need += 1e-3;
      if (best !== null && need >= best.dist) continue;
      const sx = x + ax * need, sy = y + ay * need, sz = z + az * need;
      if (!this.free(sx, sy, sz, ux, uy, uz)) continue;
      best = { x: ax * need, y: ay * need, z: az * need, dist: need };
    }
    return best;
  }

  /**
   * The radius of the first SOLID cell below `r` along the radial, or null if
   * there is none within `searchM` (an open shaft, so the player falls). Marched
   * at 0.1 m, an order finer than the 1 m cell, so the landing radius is
   * accurate to a tenth of a voxel without a per-cell plane intersection.
   */
  floorBelow(r: number, ux: number, uy: number, uz: number, searchM: number): number | null {
    for (let d = 0; d <= searchM; d += 0.1) {
      const rr = r - d;
      this.calls++;
      if (this.oracle.solidAt(ux * rr, uy * rr, uz * rr)) return rr + 0.1;
    }
    return null;
  }
}
