// The two questions the walker asks the heightfield besides "how high is it".
//
// Split out of KinematicBody, which owns gravity, the tick and the ground snap
// and had grown past its line cap when the structural port landed. Both of these
// are about the SHAPE of the terrain rather than about the body, and both cost
// oracle calls, so both report the calls they made rather than reaching back
// into the caller's counter.
//
// Standing rule 1: every height here comes from `surfaceRadius`. Nothing in this
// file decides what the ground is.

import { CAPSULE } from './KinematicBody.js';
import type { SurfaceOracle } from '../world/SurfaceOracle.js';
import type { Vec3d } from '../world/PlanetBody.js';

/** Metres of tangent offset the slope gradient is sampled over. */
const EPS_SLOPE_M = 1.5;

/**
 * Below this much heightfield the voxels take over completely. More than one
 * voxel (so a shallow dig still walks on the reconciled heightfield) and less
 * than a capsule (so a tunnel floor is never mistaken for the surface).
 */
export const DEEP_UNDERGROUND_M = 1.5;
/**
 * AND THIS MUCH TO COME BACK OUT AGAIN (R36). One threshold made the deep gate
 * chatter, and the reason is that the quantity it reads is evaluated at the STEP
 * TARGET while the tick ends somewhere else: at a bore mouth on a 45 degree face
 * the reconciled surface differs by metres between one column and the next, so
 * the walker straddling that boundary asked about a roofed column and finished
 * the tick under open sky. Measured over one 152 tick crossing: eight regime
 * changes, and on four of them the depth at the position the tick actually ended
 * at was 0.002 to 0.017 m, that is the walker standing on the open surface while
 * the voxel branch held it up.
 *
 * So leaving is a different question from entering, and the two numbers say so.
 * 0.25 m is not a tuning knob: it is the depth below which `deepgate.js` refuses
 * to call a column roofed at all, because on open ground the reconciled surface
 * and the field's own crossing differ by a few centimetres either way (measured
 * there: 32 columns between 0.050 and 0.056 m, every one under open sky). A
 * walker shallower than that is on the surface by the same measurement that
 * governs the probe, whatever the step target said.
 *
 * The band is deliberately NOT wide. Hysteresis cannot fix a discontinuity, and
 * this one is 8 m tall: the gate quantity jumps by that much between adjacent
 * taps at both bores. What the band removes is only the noise flip, where the
 * two ends of one tick disagree about which side of the line the walker is on.
 */
const DEEP_EXIT_M = 0.25;

/**
 * WHICH COLLISION REGIME THIS TICK IS IN, given how deep the feet are below the
 * reconciled heightfield and which regime the LAST tick was in.
 */
export function deepGate(depthM: number, wasDeep: boolean): boolean {
  return depthM > (wasDeep ? DEEP_EXIT_M : DEEP_UNDERGROUND_M);
}

export interface ClimbResult {
  x: number; y: number; z: number; surfaceR: number; moved: boolean;
  tx: number; ty: number; tz: number;
  /** Oracle calls made, so the caller keeps one budget and not two. */
  calls: number;
}

/**
 * Refuse a horizontal move onto ground more than `CAPSULE.stepUpM` above where
 * the feet started this tick. `r` is that starting radius and `surfaceR` is the
 * ground already sampled at the destination, so the common case (every ordinary
 * walking tick) costs nothing but the comparison.
 *
 * Only the TANGENTIAL half of the move is judged. The radial half is a jump or a
 * fall, and rising under your own power is exactly how you are meant to reach
 * ground that is more than a step up.
 */
export function climbGate(oracle: SurfaceOracle, p: Vec3d,
                          qx: number, qy: number, qz: number, r: number,
                          ux: number, uy: number, uz: number,
                          surfaceR: number): ClimbResult {
  let calls = 0;
  if (surfaceR - r <= CAPSULE.stepUpM) {
    return { x: qx, y: qy, z: qz, surfaceR, moved: false,
      tx: 0, ty: 0, tz: 0, calls };
  }
  const mx = qx - p.x, my = qy - p.y, mz = qz - p.z;
  const mr = mx * ux + my * uy + mz * uz;
  const sx0 = p.x + ux * mr, sy0 = p.y + uy * mr, sz0 = p.z + uz * mr;
  const dx = mx - ux * mr, dy = my - uy * mr, dz = mz - uz * mr;
  // Tangent basis, built exactly as sampleSlopeCos builds it: ONE basis.
  let ex = -uz, ey = 0, ez = ux;
  const el = Math.hypot(ex, ey, ez);
  if (el < 1e-9) { ex = 1; ey = 0; ez = 0; } else { ex /= el; ez /= el; }
  const nx = uy * ez - uz * ey, ny = uz * ex - ux * ez, nz = ux * ey - uy * ex;
  const a = dx * ex + dy * ey + dz * ez;
  const b = dx * nx + dy * ny + dz * nz;
  // Slide by keeping one tangent axis at a time, the larger first. A heightfield
  // wall has no axis to drop the way a voxel face does, so this is an
  // approximation, but it is the cheapest one that lets a player walk ALONG the
  // foot of a cliff instead of being pinned to it, and it costs an oracle call
  // only on a tick that actually hit a wall.
  const tries: [number, number][] = Math.abs(a) >= Math.abs(b)
    ? [[a, 0], [0, b]] : [[0, b], [a, 0]];
  for (const [ca, cb] of tries) {
    if (ca === 0 && cb === 0) continue;
    const tX = ex * ca + nx * cb, tY = ey * ca + ny * cb, tZ = ez * ca + nz * cb;
    const sx = sx0 + tX, sy = sy0 + tY, sz = sz0 + tZ;
    const sr = Math.hypot(sx, sy, sz) || 1;
    calls++;
    const g = oracle.surfaceRadius(sx / sr, sy / sr, sz / sr);
    if (g - r <= CAPSULE.stepUpM) {
      return { x: sx, y: sy, z: sz, surfaceR: g, moved: true,
        tx: tX, ty: tY, tz: tZ, calls };
    }
  }
  // Nothing horizontal survives. Keep the radial half: a player pressed into a
  // cliff still falls, still lands and can still jump onto it.
  const sr = Math.hypot(sx0, sy0, sz0) || 1;
  calls++;
  return {
    x: sx0, y: sy0, z: sz0,
    surfaceR: oracle.surfaceRadius(sx0 / sr, sy0 / sr, sz0 / sr),
    moved: true, tx: 0, ty: 0, tz: 0, calls,
  };
}

/**
 * Step-DOWN snap while standing on a DUG floor. A dug floor is a staircase of
 * whole cells, so the walking snap (0.35 m) leaves the player ballistic for a
 * tick at every step down one and the walk reads as a stutter. Just over a
 * cell, so it follows a dug floor and still falls down a shaft.
 */
export const DEEP_SNAP_M = 1.1;

/**
 * HOW FAR DOWN THE FEET MAY REACH FOR THE GROUND when the walking snap has
 * already failed. Two heights about one direction decide it: `baseHeight` is
 * the designed relief and `surfaceHeight` is the relief after the voxel
 * lowering, so a positive difference IS a dig and nothing else can produce one.
 * Standing rule 1 holds: both numbers come from `surface_field.h` and nothing
 * here invents a height.
 *
 * WHY THE WALKER WANTS IT (R36). `DEEP_SNAP_M` was gated on `underRock`, that
 * is on there being a ROOF, and the staircase it is sized for has nothing to do
 * with roofs: an open pit is cut by the same brush out of the same lattice.
 *
 * Measured on the 45 degree hill bore (deepgate.js at site `hill`): the
 * reconciled surface drops 0.727 m in ONE tick at the rim of the entry shaft.
 * The walking snap does not reach that, so the walker goes ballistic, and then
 * it STAYS ballistic, because `landing` needs `grounded` before it may use any
 * snap at all. One 0.727 m lip cost 31 airborne ticks and a 1.374 m fall, and
 * every part of that fall after the lip was a ramp descending 0.066 m per tick,
 * comfortably inside the walking snap the walker could no longer use.
 *
 * Pristine ground is bit-for-bit unchanged, because the lowering is exactly 0
 * there and the caller does not even ask: it asks only on a tick that has
 * already failed the walking snap, which is a ledge tick and not a walking one.
 *
 * OLD NOTE, KEPT BECAUSE IT WAS THE FIRST ANSWER AND IT WAS WRONG: the raw
 * voxel floor is NOT usable here. At the same rim it sits 0.244 m under the
 * feet, inside the walking snap, and it is 0.483 m ABOVE the reconciled surface
 * (measured), i.e. it is WG-31's phantom rock. Landing on it would stand the
 * player half a metre above the mesh they can see, which is the disagreement
 * D-011 exists to prevent. Widening the snap moves the walker onto the surface
 * that is actually drawn; consulting the lattice would not have.
 */
export function dugSnapM(oracle: SurfaceOracle, gapM: number,
                         dx: number, dy: number, dz: number):
{ snapM: number; calls: number } {
  // Past the wide snap it is a fall whatever cut it, and asking would be a
  // question with only one answer.
  if (gapM > DEEP_SNAP_M) return { snapM: CAPSULE.groundSnapM, calls: 0 };
  const lowered = oracle.baseHeight(dx, dy, dz) - oracle.surfaceHeight(dx, dy, dz);
  return { snapM: lowered > 0 ? DEEP_SNAP_M : CAPSULE.groundSnapM, calls: 2 };
}

/**
 * dot(surfaceNormal, up) from a two-tap forward difference of surfaceRadius in
 * the local tangent frame. `r0` is the radius already sampled at (ux,uy,uz).
 */
export function sampleSlopeCos(oracle: SurfaceOracle, ux: number, uy: number,
                               uz: number, r0: number, rNow: number):
{ cos: number; calls: number } {
  let calls = 0;
  // Tangent basis: POLAR x up, then up x east.
  let ex = -uz, ey = 0, ez = ux;
  const el = Math.hypot(ex, ey, ez);
  if (el < 1e-9) { ex = 1; ey = 0; ez = 0; } else { ex /= el; ez /= el; }
  const nx = uy * ez - uz * ey, ny = uz * ex - ux * ez, nz = ux * ey - uy * ex;
  const eps = EPS_SLOPE_M / Math.max(1, rNow);
  const sample = (ax: number, ay: number, az: number): number => {
    let sx = ux + ax * eps, sy = uy + ay * eps, sz = uz + az * eps;
    const l = Math.hypot(sx, sy, sz);
    sx /= l; sy /= l; sz /= l;
    calls++;
    return oracle.surfaceRadius(sx, sy, sz);
  };
  const ge = (sample(ex, ey, ez) - r0) / EPS_SLOPE_M;
  const gn = (sample(nx, ny, nz) - r0) / EPS_SLOPE_M;
  return { cos: 1 / Math.sqrt(1 + ge * ge + gn * gn), calls };
}

/**
 * MEASURE THE SLOPE UNDER THE FEET AND APPLY THE STAND-OR-SLIDE RULE (WG-41).
 *
 * Moved here from KinematicBody.step, which had the sampling delegated and the
 * decision inline, so this file owned half a rule. It owns both halves now.
 * Behaviour is unchanged and the tangent is edited in place through `t`.
 *
 * The three exemptions are load-bearing and each has a reason:
 *   * not airborne  - a slope you are not standing on cannot refuse you.
 *   * not underRock - underground the heightfield gradient describes the
 *     HILLSIDE OVERHEAD, not the tunnel floor being stood on.
 *   * not onDeck    - a deck is flat by construction, so the gradient under it
 *     describes the ground it stands on and must not gate walking on it.
 * Water is deliberately NOT an exemption: a swimmer is not grounded, so this
 * never runs on one, and a wader IS standing on the bed and should be refused
 * by a bank too steep to climb exactly as they would be on dry land.
 *
 * `cut` is the UPHILL component of the tangent the caller must remove, already
 * 0 when the slope is walkable. Returned as a scalar rather than applied to a
 * vector argument so this stays allocation free on the tick path.
 */
export function slopeGate(oracle: SurfaceOracle, tx: number, ty: number, tz: number,
                          ux: number, uy: number, uz: number,
                          surfaceR: number, qr: number, limitCos: number,
                          grounded: boolean, underRock: boolean, onDeck: boolean):
{ cos: number; calls: number; cut: number } {
  if (!grounded || underRock || onDeck) return { cos: 1, calls: 0, cut: 0 };
  const sl = sampleSlopeCos(oracle, ux, uy, uz, surfaceR, qr);
  // Too steep to stand: keep the downhill component, drop the uphill one.
  const climb = tx * ux + ty * uy + tz * uz;
  const cut = (sl.cos < limitCos && climb > 0) ? climb : 0;
  return { cos: sl.cos, calls: sl.calls, cut };
}
