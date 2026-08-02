// REGIONS THAT CHANGE WHAT YOU WEIGH (PH-100).
//
// The implementation behind `player/GravityPort.ts`. Read that file first: it
// carries the argument, this one carries the geometry.
//
// A VOLUME IS NOT A SOLID AND THIS IS NOT `StructureBodies`, even though the
// box maths is nearly the same. They are kept apart on purpose, because the
// floor and the weight are genuinely separate questions and a system that
// merged them could not describe either of the two things this game needs:
//
//   a deck with no gravity      -- a handhold you drift past. Every surface in
//                                  an unpowered station is one of these.
//   gravity with no deck        -- the volume around a station, where you have
//                                  no weight and nothing to stand on. That is
//                                  what an EVA IS.
//
// `LocalBox` is imported from StructureBody.ts rather than redeclared, because
// the two really do want the same box, and a second box type would be the
// beginning of a second geometry.
//
// THE ARITHMETIC IS A SUM OF DELTAS ON THE CALLER'S OWN NUMBER, never a fresh
// gravity computed here, and that is what makes the round trip exact rather
// than approximate. Fully inside a freefall volume AND a powered generator
// volume the deltas are `-carrierG` and `+carrierG`, which sum to exactly 0.0
// in IEEE754, so `apparentAt` returns the caller's `trueG` BIT FOR BIT. A
// powered deck is therefore not "close to" the tower PH-90 measured, it is
// numerically indistinguishable from it, and `probes/zerog.js` Z4 asserts that
// with `===` rather than with a tolerance.

import * as THREE from 'three';
import type { Vec3d } from '../world/PlanetBody.js';
import type { LocalBox } from './StructureBody.js';
import type { GravityField } from '../player/GravityPort.js';

/**
 * FREEFALL cancels the carrier's own acceleration, which is what being in orbit
 * does to you. GENERATOR puts it back, and only while powered.
 *
 * The generator deliberately has no magnitude of its own: see GravityPort.ts.
 * One gravity authority, one number, no tuning knob that could drift away from
 * `PlanetBody.gravityAccel`.
 */
export type VolumeMode = 'freefall' | 'generator';

export interface GravityVolume {
  id: number;
  mode: VolumeMode;
  /** Body-frame origin of the volume's own frame. */
  pos: Vec3d;
  quat: THREE.Quaternion;
  boxes: readonly LocalBox[];
  /** Body-frame bound: centre plus radius, for the O(1) reject (R49's shape). */
  cx: number; cy: number; cz: number; cr: number;
  /**
   * The carrier's freefall acceleration at its own position, m/s^2 radially
   * inward. For a vessel on a conic this is `gravityAccel(|pos|)` and nothing
   * else: a body on a free trajectory accelerates at exactly the local g, which
   * is the entire reason its occupants have no weight.
   */
  carrierG: number;
  /**
   * Metres over which the effect fades to nothing outside the box set.
   *
   * Not a cosmetic softening. The float gate is hysteretic (`ZEROG.floatG` /
   * `standG`) and hysteresis only helps a quantity that MOVES through the band;
   * a hard geometric edge steps straight across it, so a player standing on a
   * boundary would flip modes on sub-millimetre jitter. That is R36 exactly,
   * which cost 8 mode flips in 152 ticks and 19 airborne ticks on a steep face.
   * The fringe is what makes the hysteresis able to do its job.
   */
  fringeM: number;
  /** A generator with no power does nothing. Freefall does not care and is
   *  never gated on this: an orbit cannot be switched off. */
  powered: boolean;
}

export class GravityVolumes implements GravityField {
  readonly list: GravityVolume[] = [];
  get count(): number { return this.list.length; }
  tests = 0;
  private readonly q = new THREE.Quaternion();
  private readonly v = new THREE.Vector3();

  resetTests(): void { this.tests = 0; }
  clear(): void { this.list.length = 0; }
  add(v: GravityVolume): void { this.list.push(v); }
  remove(pred: (v: GravityVolume) => boolean): void {
    for (let i = this.list.length - 1; i >= 0; --i) {
      if (pred(this.list[i])) this.list.splice(i, 1);
    }
  }

  /** Every volume whose bound contains the point, for reporting. */
  at(x: number, y: number, z: number): GravityVolume[] {
    return this.list.filter((v) => this.weightOf(v, x, y, z) > 0);
  }

  apparentAt(x: number, y: number, z: number, trueG: number): number {
    let delta = 0;
    for (const v of this.list) {
      const dx = x - v.cx, dy = y - v.cy, dz = z - v.cz;
      const reach = v.cr + v.fringeM;
      if (dx * dx + dy * dy + dz * dz > reach * reach) continue;
      this.tests++;
      if (v.mode === 'generator' && !v.powered) continue;
      const w = this.weightOf(v, x, y, z);
      if (w <= 0) continue;
      // `w` is EXACTLY 1 inside the box (see `weightOf`), so the two full-weight
      // terms are `-carrierG` and `+carrierG` and cancel to exactly 0.0.
      delta += (v.mode === 'freefall' ? -w : w) * v.carrierG;
    }
    return trueG + delta;
  }

  /**
   * How strongly a volume acts at a point: 1 inside, falling linearly to 0 at
   * `fringeM` outside, 0 beyond.
   *
   * Returns a HARD 1 rather than something near it whenever the point is inside
   * any box, because the exactness argument in the header depends on it. The
   * distance used is the standard box exterior distance (componentwise overshoot
   * then a norm), which is 0 everywhere inside and is why that falls out.
   */
  private weightOf(v: GravityVolume, x: number, y: number, z: number): number {
    const p = this.v.set(x - v.pos.x, y - v.pos.y, z - v.pos.z)
      .applyQuaternion(this.q.copy(v.quat).invert());
    let best = 0;
    for (const b of v.boxes) {
      const ox = Math.max(b.min[0] - p.x, 0, p.x - b.max[0]);
      const oy = Math.max(b.min[1] - p.y, 0, p.y - b.max[1]);
      const oz = Math.max(b.min[2] - p.z, 0, p.z - b.max[2]);
      if (ox === 0 && oy === 0 && oz === 0) return 1;
      if (v.fringeM <= 0) continue;
      const d = Math.hypot(ox, oy, oz);
      if (d >= v.fringeM) continue;
      const w = 1 - d / v.fringeM;
      if (w > best) best = w;
    }
    return best;
  }
}

/**
 * THE one volume set, module-level, exactly as `VesselRegistry.registry` is.
 *
 * A singleton rather than a field on `Gameplay` for two reasons. It follows the
 * pattern the vessel records already established, so there is one idiom for
 * "world-scoped set the walker reads"; and it keeps this work out of
 * `Gameplay.ts`, which another lane is live in. The walker reaches it through
 * the `GravityField` PORT and never imports this module, so the singleton is an
 * assembly convenience and not a back door into the player.
 */
export const volumes = new GravityVolumes();

/** Bounding sphere radius of a box set about its own frame origin. */
export function boundOfBoxes(boxes: readonly LocalBox[]): number {
  let r = 0;
  for (const b of boxes) {
    for (const [x, y, z] of [b.min, b.max]) r = Math.max(r, Math.hypot(x, y, z));
  }
  return r;
}

/** The axis-aligned bound of a box set, in its own frame. */
export function extentOfBoxes(boxes: readonly LocalBox[]):
{ min: [number, number, number]; max: [number, number, number] } | null {
  if (boxes.length === 0) return null;
  const lo: [number, number, number] = [Infinity, Infinity, Infinity];
  const hi: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const b of boxes) {
    for (let i = 0; i < 3; ++i) {
      if (b.min[i] < lo[i]) lo[i] = b.min[i];
      if (b.max[i] > hi[i]) hi[i] = b.max[i];
    }
  }
  return { min: lo, max: hi };
}
