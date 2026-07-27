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
/**
 * Ledge heights a blocked step retries at, metres. A voxel is 1 m.
 *
 * Exported since WG-31 because `floorBelow`'s rise allowance is read from the
 * FIRST rung of this ladder, exactly as the structural port reads its own
 * (GP-53), and because a probe asserting "no lift exceeds a step" has to be
 * able to ask the walker what a step is rather than reciting 0.55 back at it.
 */
export const VOXEL_STEP_UP_M: readonly number[] = [0.55, 1.1];
const STEP_UP_M = VOXEL_STEP_UP_M;
/**
 * The radial grid the floor march samples on, metres, and the number of
 * bisection halvings that follow it.
 *
 * 0.25 m is a quarter of a cell, so no rock slab a dig can leave is stepped
 * over, and it is a MARCH resolution rather than an ANSWER resolution: the
 * bisection below turns whichever bracket it lands in into the crossing itself,
 * so this number does not appear in the result.
 *
 * 30 halvings take a 0.25 m bracket to 2.3e-10 m, which is BELOW the f64
 * spacing at Forge's 604 km standing radius (1.2e-10 m). That is deliberate and
 * it is not precision for its own sake: it makes the answer independent of the
 * bracket the march happened to land in, so a querier who has moved a
 * millimetre gets the identical bits rather than an answer that follows them by
 * 1e-7 m. The whole claim of this function is that the floor does not move when
 * the player does, and "does not move" should mean it.
 */
const FLOOR_MARCH_M = 0.25;
const FLOOR_BISECT_ITERS = 30;

export interface StepResult { x: number; y: number; z: number; blocked: boolean }

/**
 * A set of PLACED SOLIDS the walker also has to respect: today the base
 * building parts, implemented by `game/StructureBody.ts`.
 *
 * It is an interface here rather than an import because a structure is not
 * terrain and must not become a second definition of it. Rock stays the
 * oracle's answer and nothing on this port touches it (standing rule 1); these
 * are boxes RESTING on the ground, which is exactly DW-24's model, and the
 * walker composes the two answers instead of merging them.
 */
export interface SolidBodies {
  readonly count: number;
  tests: number;
  resetTests(): void;
  blocks(x: number, y: number, z: number): boolean;
  /** The highest structural TOP FACE along a radial: `searchM` below the feet,
   *  or up to `riseM` above them. See `StructureBodies.deckUnder`. */
  deckUnder(dx: number, dy: number, dz: number, rFrom: number,
            searchM: number, riseM: number): number | null;
  resolveStep(p: Vec3d, qx: number, qy: number, qz: number,
              ux: number, uy: number, uz: number,
              samplesM: readonly number[],
              stepUpM: readonly number[]): StepResult;
}

/**
 * The ledge heights a blocked STRUCTURAL step retries at.
 *
 * Its own array rather than an alias of `STEP_UP_M`, which it used to be, so
 * that the two are not silently coupled: the voxel ladder is a statement about
 * a 1 m lattice cell and this one is a statement about the shipped module, and
 * DW-32's move from a 1 m module to a 4 m one is the third scale assumption in
 * two days to have been found hiding inside a constant that predated it. The
 * VALUES are deliberately unchanged.
 *
 * The first rung is what a player climbs to get onto their own foundation, so
 * it must clear a deck: 0.55 m against the module's own `deckH` of 0.50 m.
 * That relation is asserted rather than assumed, in `probes/decksink.js`, which
 * reads `deckH` off the shipped asset and fails if it ever grows past the rung.
 * The second rung is one storey of nothing in particular; a storey is 4.00 m,
 * so no step ever puts a player on top of a wall.
 */
export const STRUCTURE_STEP_UP_M: readonly number[] = [0.55, 1.1];
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
   * THE VOXEL FLOOR (WG-31). The radius of the highest air-to-rock crossing of
   * the signed field along this radial within `[r - searchM, r + riseM]`, or
   * null when the column has none.
   *
   * IT IS A PROPERTY OF THE FIELD AND NOT OF `r`. That sentence is the fix.
   * This function used to end `return Math.min(r, rr + 0.1)`, which is GP-53's
   * defect in a second code path: with the first solid sample within one march
   * step of the feet, or with the feet inside rock at all, the clamp handed back
   * `r` itself. Measured, player stationary and grounded on a tunnel floor at
   * 0.00 m/s: the query returned the querier's own pre-snap radius on 330 of 330
   * ticks, so the ground snap ratified each tick of gravity instead of
   * correcting it, the feet drifted 0.032557 m in five and a half seconds and
   * sat 0.150167 to 0.182724 m BELOW the world's own floor with nothing ever
   * putting them back. The only authority that ever did put them back was
   * `resolveEmbedded`, which cannot fire until the sink has buried the capsule's
   * lowest sample 0.15 m up, and that delay is the period of the sawtooth the
   * player sees as snapping up every few seconds.
   *
   * The general form, from GP-53 and now twice: a floor query that clamps its
   * answer to the querier's position ratifies the querier's error, and gravity
   * supplies a fresh error every tick.
   *
   * THREE STEPS, NO CLAMP.
   *  1. Find the highest AIR at or above the feet within `riseM`. A floor needs
   *     air over it, so this is what stops a low ceiling being read as one, and
   *     it is what makes the answer able to sit ABOVE the feet: a floor you have
   *     sunk into is still the floor, and seating on it is a correction rather
   *     than a lift. `riseM` is the caller's own first step rung, so a lift here
   *     can never exceed a step the walker would have taken anyway.
   *  2. March DOWN from that air on an absolute radial grid for the first rock.
   *  3. Bisect that one bracket. `solidAt` is the sign of the trilinear density
   *     (WG-24), so this converges on the same iso-surface surface nets meshed;
   *     the old march assumed cell-quantised geometry and could only ever land
   *     on a multiple of its own step.
   *
   * NULL WHEN THE FEET ARE BURIED past `riseM` with rock all the way up. That
   * is not a floor question, it is an embedded capsule, and `resolveEmbedded`
   * owns it: answering anything at all here is exactly what ratified the sink.
   * Null is also the open shaft, where the caller falls, which is the property
   * that keeps the correction honest in the other direction.
   *
   * The grid is ABSOLUTE (`floor(rr / FLOOR_MARCH_M)`) rather than an offset
   * from the feet so that a stationary querier lands in the identical bracket
   * every tick and the bisection returns bit-identical numbers. A grid relative
   * to `r` would leave the floor following the feet by 1e-8 m instead of by
   * 0.18 m, and "nothing" is the answer this is supposed to give.
   */
  floorBelow(r: number, ux: number, uy: number, uz: number,
    searchM: number, riseM: number): number | null {
    // THE OLD ANSWER, KEPT SO THE ASSERTION CAN BE SEEN TO FAIL. Standing rule
    // 11: an assertion that has never failed is not yet an assertion, and the
    // only way to demonstrate that `probes/tunnelsink.js` catches this class is
    // to run the identical probe against the query that had it. Off unless a
    // probe sets the global, tested once per TICK rather than per sample, and
    // deliberately the whole old body rather than a tuning knob: a switch that
    // selects between two behaviours is a second definition, and this one is
    // allowed to exist only because it is the discarded one.
    if ((globalThis as unknown as { __ofOldFloor?: boolean }).__ofOldFloor === true) {
      for (let d = 0; d <= searchM; d += 0.1) {
        const rr = r - d;
        this.calls++;
        if (this.oracle.solidAt(ux * rr, uy * rr, uz * rr)) return Math.min(r, rr + 0.1);
      }
      return null;
    }
    const at = (rr: number): boolean => {
      this.calls++;
      return this.oracle.solidAt(ux * rr, uy * rr, uz * rr);
    };
    const h = FLOOR_MARCH_M;
    // `lo` ends the search inside rock and `hi` in air, always in that order,
    // and the bisection between them is the crossing.
    let lo = Number.NaN, hi = Number.NaN;

    if (at(r)) {
      // THE FEET ARE INSIDE ROCK. Look UP for the top of the slab they are in,
      // and only as far as one step. This is the ONLY case that may answer
      // above the feet, and that restriction is the whole of it: a first draft
      // looked up unconditionally, found rock ABOVE feet that were standing in
      // air, and read a ceiling fragment as a floor. Driven, it walked the
      // player 8 m up and out of their own bore over 14 strikes, which is the
      // 0.1 m ratchet this function's history already contains, rebuilt.
      lo = r;
      for (let rr = Math.ceil(r / h) * h; rr <= r + riseM + 1e-12; rr += h) {
        if (!at(rr)) { hi = rr; break; }
        lo = rr;
      }
      // Buried deeper than a step with rock all the way up. Not a floor
      // question: an embedded capsule, which `resolveEmbedded` owns. Answering
      // ANYTHING here is what ratified the sink.
      if (!Number.isFinite(hi)) return null;
    } else {
      // THE FEET ARE IN AIR. The floor is strictly below them, full stop.
      hi = r;
      for (let rr = Math.floor(r / h) * h; rr >= r - searchM; rr -= h) {
        if (at(rr)) { lo = rr; break; }
        hi = rr;
      }
      if (!Number.isFinite(lo)) return null;  // an open shaft, so fall
    }

    // The crossing itself. `hi` is returned because the feet stand on the air
    // side of the boundary. Enough halvings to take a 0.25 m bracket below the
    // f64 spacing at a 600 km radius (1.2e-10 m), so the answer is the same
    // bits from any starting bracket that contains it: the floor a stationary
    // player stands on is then not merely stable, it is one number.
    for (let i = 0; i < FLOOR_BISECT_ITERS; ++i) {
      const m = (lo + hi) * 0.5;
      if (at(m)) lo = m; else hi = m;
    }
    return hi;
  }
}
