// A kinematic capsule resolved against the /core surface oracle. NO physics
// engine (DW-12 / WR-7): the ground IS surfaceRadius and the walls ARE
// solidCell, so the walker, the collider and the drawn mesh are one function and
// cannot disagree. That is the entire D-011 payoff.
//
// Everything here is f64 body-frame metres. The oracle calls are synchronous and
// measured at 1.9 to 3.2 us, which is exactly what makes an in-frame character
// step affordable (ARCHITECTURE.md section 2.3).

import type { SurfaceOracle } from '../world/SurfaceOracle.js';
import type { Vec3d } from '../world/PlanetBody.js';

export interface MoveIntent {
  /** Desired tangent direction, body frame, unit or zero. */
  wx: number; wy: number; wz: number;
  /** Target ground speed in m/s for that direction. */
  speed: number;
  jump: boolean;
}

/** Human-scale capsule. Heights are metres from the feet. */
export const CAPSULE = {
  radiusM: 0.4,
  heightM: 1.8,
  eyeHeightM: 1.62,
  /** Below this gap the feet re-attach to the ground instead of free-falling. */
  groundSnapM: 0.35,
  /** cos(50 deg): steeper than this is a slide, not a walk (section 8.1). */
  slopeLimitCos: 0.6428,
  /**
   * Sized for FEEL, now that DW-18 has given Forge 9.81 m/s^2. 4.0 m/s gives a
   * 0.82 m apex and 0.82 s of airtime: a jump that clears a knee-high ledge and
   * lands, instead of the 4.8 second float the 0.587 m/s^2 density model
   * produced. Apex = v^2/2g, airtime = 2v/g; both are read back by the jump
   * probe rather than asserted here.
   */
  jumpSpeedMps: 4.0,
  groundAccel: 34.0,
  airAccel: 6.0,
  groundDrag: 11.0,
};

const EPS_SLOPE_M = 1.5;

export class KinematicBody {
  /** Feet, on the surface. Body-frame f64 metres. */
  readonly feet: Vec3d = { x: 0, y: 0, z: 0 };
  readonly vel: Vec3d = { x: 0, y: 0, z: 0 };
  grounded = false;
  /** dot(surfaceNormal, up) under the feet. 1 is flat. */
  slopeCos = 1;
  /** Metres the feet were pushed out of solid voxels on the last step. */
  voxelPushM = 0;
  speedMps = 0;
  oracleCalls = 0;

  constructor(private readonly oracle: SurfaceOracle) {}

  /** Drop the capsule onto the surface at a geodetic coordinate. */
  spawn(latRad: number, lonRad: number): void {
    const d = { x: 0, y: 0, z: 0 };
    this.oracle.dirFromLatLon(latRad, lonRad, d);
    const r = this.oracle.surfaceRadius(d.x, d.y, d.z);
    this.feet.x = d.x * r; this.feet.y = d.y * r; this.feet.z = d.z * r;
    this.vel.x = 0; this.vel.y = 0; this.vel.z = 0;
    this.grounded = true;
    this.speedMps = 0;
  }

  /**
   * Gravity from /core through the bridge (`of_gravity_accel`), never derived
   * here. This USED to transcribe /core's uniform-density model constant for
   * constant, which read as harmless duplication right up until DW-18 moved
   * /core to mu: the copy would have kept the browser at 0.587 m/s^2 while the
   * orbit propagator ran at 9.81 on the same planet. Standing rule 1 covers
   * gravity too.
   */
  gravityAccel(rM: number): number {
    return this.oracle.body.gravityAccel(rM);
  }

  step(dt: number, intent: MoveIntent): void {
    const p = this.feet;
    let r = Math.hypot(p.x, p.y, p.z);
    if (r < 1e-6) return;
    let ux = p.x / r, uy = p.y / r, uz = p.z / r;
    this.oracleCalls = 0;

    // Split velocity into radial and tangential once; everything below works on
    // the two halves and they are recombined at the end.
    const v = this.vel;
    let vUp = v.x * ux + v.y * uy + v.z * uz;
    let tx = v.x - ux * vUp, ty = v.y - uy * vUp, tz = v.z - uz * vUp;

    // Steer the tangential velocity toward the intent, then apply drag.
    const accel = this.grounded ? CAPSULE.groundAccel : CAPSULE.airAccel;
    const gx = intent.wx * intent.speed, gy = intent.wy * intent.speed, gz = intent.wz * intent.speed;
    let dx = gx - tx, dy = gy - ty, dz = gz - tz;
    const dLen = Math.hypot(dx, dy, dz);
    const dMax = accel * dt;
    if (dLen > dMax && dLen > 1e-9) { const s = dMax / dLen; dx *= s; dy *= s; dz *= s; }
    tx += dx; ty += dy; tz += dz;
    if (this.grounded && intent.speed === 0) {
      const k = Math.max(0, 1 - CAPSULE.groundDrag * dt);
      tx *= k; ty *= k; tz *= k;
    }

    vUp -= this.gravityAccel(r) * dt;
    if (intent.jump && this.grounded && this.slopeCos >= CAPSULE.slopeLimitCos) {
      vUp = CAPSULE.jumpSpeedMps;
      this.grounded = false;
    }

    // Integrate in the body frame. The tangential part is a chord, not an arc;
    // over one 16.7 ms tick at 12 m/s that is 0.2 mm of sagitta on a 600 km
    // sphere, and the ground snap below re-projects it onto the surface anyway.
    let qx = p.x + (tx + ux * vUp) * dt;
    let qy = p.y + (ty + uy * vUp) * dt;
    let qz = p.z + (tz + uz * vUp) * dt;

    // 1. The oracle IS the ground.
    let qr = Math.hypot(qx, qy, qz);
    let dxn = qx / qr, dyn = qy / qr, dzn = qz / qr;
    const groundR = this.oracle.surfaceRadius(dxn, dyn, dzn);
    this.oracleCalls++;
    const gap = qr - groundR;
    const landing = gap <= 0 || (this.grounded && gap <= CAPSULE.groundSnapM && vUp <= 0);
    if (landing) {
      qx = dxn * groundR; qy = dyn * groundR; qz = dzn * groundR;
      qr = groundR;
      vUp = 0;
      this.grounded = true;
    } else {
      this.grounded = false;
    }

    // 2. Near-field voxel walls. On a pristine world solidCell is simply "below
    //    the heightfield", so step 1 has already resolved it and the sweep would
    //    only fight itself at the boundary; it is armed the moment an edit set
    //    exists, which is where tunnels and ceilings live (W5).
    this.voxelPushM = 0;
    if (this.oracle.editsHandle !== 0) {
      const push = this.resolveVoxels(qx, qy, qz, dxn, dyn, dzn);
      if (push > 0) {
        this.voxelPushM = push;
        qx = dxn * (qr + push); qy = dyn * (qr + push); qz = dzn * (qr + push);
        qr += push;
        if (vUp < 0) vUp = 0;
        this.grounded = true;
      }
    }

    // 3. Slope. Sampling the gradient costs two oracle calls and is what stops
    //    the capsule walking up a cliff face like a ladder.
    ux = qx / qr; uy = qy / qr; uz = qz / qr;
    this.slopeCos = this.grounded ? this.sampleSlopeCos(ux, uy, uz, groundR, qr) : 1;
    if (this.grounded && this.slopeCos < CAPSULE.slopeLimitCos) {
      // Too steep to stand: keep the downhill component, drop the uphill one.
      const climb = tx * ux + ty * uy + tz * uz;
      if (climb > 0) { tx -= ux * climb; ty -= uy * climb; tz -= uz * climb; }
    }

    p.x = qx; p.y = qy; p.z = qz;
    // Re-project the tangential velocity onto the NEW tangent plane, or walking
    // round a 600 km sphere slowly accumulates a radial component.
    const tDotU = tx * ux + ty * uy + tz * uz;
    tx -= ux * tDotU; ty -= uy * tDotU; tz -= uz * tDotU;
    v.x = tx + ux * vUp; v.y = ty + uy * vUp; v.z = tz + uz * vUp;
    this.speedMps = Math.hypot(tx, ty, tz);
  }

  /** Eye position for a given feet position. */
  eye(out: Vec3d): Vec3d {
    const p = this.feet;
    const r = Math.hypot(p.x, p.y, p.z) || 1;
    const k = (r + CAPSULE.eyeHeightM) / r;
    out.x = p.x * k; out.y = p.y * k; out.z = p.z * k;
    return out;
  }

  /**
   * Six capsule sample points (feet / mid / head, each front and back along the
   * radial axis is meaningless, so they are spread over the capsule's height).
   * Returns how far the capsule must move OUT along the radial to clear solid.
   */
  private resolveVoxels(x: number, y: number, z: number, ux: number, uy: number, uz: number): number {
    let push = 0;
    for (let i = 0; i < 6; ++i) {
      const h = (i / 5) * CAPSULE.heightM;
      const px = x + ux * h, py = y + uy * h, pz = z + uz * h;
      if (!this.oracle.solidAt(px, py, pz)) continue;
      // 1 m cells, so one cell of clearance always resolves a single face.
      const need = CAPSULE.heightM - h + 1.0;
      if (need > push) push = need;
    }
    return push;
  }

  /**
   * dot(surfaceNormal, up) from a two-tap forward difference of surfaceRadius in
   * the local tangent frame. `r0` is the radius already sampled at (ux,uy,uz).
   */
  private sampleSlopeCos(ux: number, uy: number, uz: number, r0: number, rNow: number): number {
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
      this.oracleCalls++;
      return this.oracle.surfaceRadius(sx, sy, sz);
    };
    const ge = (sample(ex, ey, ez) - r0) / EPS_SLOPE_M;
    const gn = (sample(nx, ny, nz) - r0) / EPS_SLOPE_M;
    return 1 / Math.sqrt(1 + ge * ge + gn * gn);
  }
}
