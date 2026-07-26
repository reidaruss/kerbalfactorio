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
