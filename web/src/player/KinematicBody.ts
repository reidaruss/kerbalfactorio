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
/** How far below the feet a voxel floor is looked for before the player falls. */
const VOXEL_FLOOR_SEARCH_M = 6;
/**
 * Below this much heightfield the voxels take over completely. More than one
 * voxel (so a shallow dig still walks on the reconciled heightfield) and less
 * than a capsule (so a tunnel floor is never mistaken for the surface).
 */
const DEEP_UNDERGROUND_M = 1.5;
/**
 * Capsule sample heights above the feet, in metres. Three points up the capsule,
 * because a single feet test lets the player walk their head through a ceiling,
 * and a full swept capsule is not affordable in-frame (DW-12: no physics engine).
 */
const CAPSULE_SAMPLES_M = [0.15, 0.9, 1.65];
/** Ledge heights a blocked step retries at, metres. A voxel is 1 m. */
const STEP_UP_M = [0.55, 1.1];
/**
 * Step-DOWN snap while standing on a voxel floor. A dug tunnel floor is a
 * staircase of whole cells, so the walking snap (0.35 m) leaves the player
 * ballistic for a tick at every step down and the walk reads as a stutter.
 * Just over a cell, so it follows a dug floor and still falls down a shaft.
 */
const DEEP_SNAP_M = 1.1;

export class KinematicBody {
  /** Feet, on the surface. Body-frame f64 metres. */
  readonly feet: Vec3d = { x: 0, y: 0, z: 0 };
  readonly vel: Vec3d = { x: 0, y: 0, z: 0 };
  grounded = false;
  /** dot(surfaceNormal, up) under the feet. 1 is flat. */
  slopeCos = 1;
  /** Metres the feet were pushed out of solid voxels on the last step. */
  voxelPushM = 0;
  /** True while the feet rest on a VOXEL floor below the heightfield surface. */
  underRock = false;
  /** True on a tick where a step into solid rock was refused. */
  blockedByRock = false;
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

    // 1. The oracle IS the ground -- but WHICH ground. Above the heightfield it
    //    is surfaceRadius. UNDER INTACT GROUND it cannot be: a sideways tunnel
    //    leaves the top of its column solid, so derivedLoweringAt correctly
    //    reports no lowering and surfaceRadius still names the hillside metres
    //    overhead. Measured: two strikes into a tunnel wall and the next step
    //    teleported the player out through their own ceiling, because
    //    `gap <= 0` read "below the ground, therefore landing".
    //
    //    So once the feet are DEEP below the heightfield the voxel world is the
    //    only authority: the floor is the first solid cell below (solidCell,
    //    DW-12, the same predicate the mesher drew), and walking into rock is
    //    REFUSED rather than resolved upward. Both branches read
    //    surface_field.h; neither invents a height.
    let qr = Math.hypot(qx, qy, qz);
    let dxn = qx / qr, dyn = qy / qr, dzn = qz / qr;
    const surfaceR = this.oracle.surfaceRadius(dxn, dyn, dzn);
    this.oracleCalls++;
    let groundR = surfaceR;
    this.underRock = false;
    this.blockedByRock = false;
    const deep = this.oracle.editsHandle !== 0 && qr < surfaceR - DEEP_UNDERGROUND_M;
    if (deep) {
      // A refused step used to mean a refused TICK: the whole displacement was
      // undone and the tangential velocity zeroed, so brushing a tunnel wall at
      // any angle stopped the player dead and the tunnel ran on ahead of them
      // (STATUS.md, W5 remaining). Now the step is resolved: climb a ledge if
      // one is in the way, otherwise slide along the wall by dropping the
      // body-frame axis that is blocked. Voxel walls ARE axis aligned, so
      // dropping an axis is exactly sliding along the face.
      const s = this.resolveDeepStep(p, qx, qy, qz, ux, uy, uz);
      qx = s.x; qy = s.y; qz = s.z;
      qr = Math.hypot(qx, qy, qz) || 1;
      dxn = qx / qr; dyn = qy / qr; dzn = qz / qr;
      if (s.blocked) { tx = 0; ty = 0; tz = 0; this.blockedByRock = true; }
      const floorR = this.voxelFloor(qr, dxn, dyn, dzn);
      // No floor within reach is an open shaft, so fall. Never snap to the roof.
      groundR = floorR === null ? -Infinity : floorR;
      this.underRock = floorR !== null;
    }
    const gap = qr - groundR;
    const snapM = this.underRock ? DEEP_SNAP_M : CAPSULE.groundSnapM;
    const landing = gap <= 0 || (this.grounded && gap <= snapM && vUp <= 0);
    if (landing && Number.isFinite(groundR)) {
      qx = dxn * groundR; qy = dyn * groundR; qz = dzn * groundR;
      qr = groundR;
      vUp = 0;
      this.grounded = true;
    } else {
      this.grounded = false;
    }

    // 2. Near-field voxel walls, for the SHALLOW case only: a dig mouth whose
    //    heightfield has reconciled but whose rim still has a solid cell in the
    //    capsule. On a pristine world solidCell is simply "below the
    //    heightfield", so step 1 has already resolved it.
    //
    //    It is skipped entirely when deep, and that is load-bearing. The push is
    //    RADIAL and sized from the whole capsule, so inside a tunnel the head
    //    sample sits under the ceiling, the push fires at 2.8 m, and the player
    //    is levitated up through their own roof one tick at a time. Measured:
    //    the drive phase ejected to open sky on the third strike, every time.
    //    Under rock the floor and the walls are already resolved above.
    this.voxelPushM = 0;
    if (this.oracle.editsHandle !== 0 && !deep) {
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
    // Underground the heightfield gradient describes the hillside overhead, not
    // the floor being stood on, so it must not gate walking inside a tunnel.
    this.slopeCos = this.grounded && !this.underRock
      ? this.sampleSlopeCos(ux, uy, uz, surfaceR, qr) : 1;
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
  /**
   * The radius of the first SOLID cell below `r` along the radial, or null if
   * there is none within the search depth (an open shaft, so the player falls).
   * Marched at 0.1 m, an order finer than the 1 m cell, so the landing radius is
   * accurate to a tenth of a voxel without a per-cell plane intersection.
   */
  /**
   * Is the whole capsule in air at this foot position? Three samples up the
   * radial. The feet-only test this replaces let the player walk their head
   * through a ceiling, which mattered the moment the bore got wide enough to
   * walk down at all.
   */
  private capsuleFree(x: number, y: number, z: number,
    ux: number, uy: number, uz: number): boolean {
    for (const h of CAPSULE_SAMPLES_M) {
      this.oracleCalls++;
      if (this.oracle.solidAt(x + ux * h, y + uy * h, z + uz * h)) return false;
    }
    return true;
  }

  /**
   * Resolve one underground step against solid voxels: take it, climb it, slide
   * it, or refuse it, in that order.
   *
   * Sliding drops ONE body-frame axis of the displacement at a time and keeps
   * the best survivor. That is correct rather than approximate here, because a
   * voxel face is always perpendicular to a body-frame axis, so the wall's
   * normal IS one of the three axes and "drop the blocked axis" is the exact
   * projection onto the wall plane. Ordered by how much displacement each
   * candidate keeps, so a glancing contact loses the least.
   */
  private resolveDeepStep(p: Vec3d, qx: number, qy: number, qz: number,
    ux: number, uy: number, uz: number):
    { x: number; y: number; z: number; blocked: boolean } {
    if (this.capsuleFree(qx, qy, qz, ux, uy, uz)) {
      return { x: qx, y: qy, z: qz, blocked: false };
    }
    // Already embedded (spawned into rock, or a dig closed around us): refusing
    // would be a permanent lock, and the destination cannot be worse than here.
    if (!this.capsuleFree(p.x, p.y, p.z, ux, uy, uz)) {
      return { x: qx, y: qy, z: qz, blocked: false };
    }
    // A ledge. Lifting the feet is enough: the floor march below re-seats them
    // on whatever they actually landed on, so this never levitates (15.2 #48).
    for (const h of STEP_UP_M) {
      const sx = qx + ux * h, sy = qy + uy * h, sz = qz + uz * h;
      if (this.capsuleFree(sx, sy, sz, ux, uy, uz)) {
        return { x: sx, y: sy, z: sz, blocked: false };
      }
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
      if (this.capsuleFree(sx, sy, sz, ux, uy, uz)) {
        return { x: sx, y: sy, z: sz, blocked: false };
      }
    }
    return { x: p.x, y: p.y, z: p.z, blocked: true };
  }

  private voxelFloor(r: number, ux: number, uy: number, uz: number): number | null {
    for (let d = 0; d <= VOXEL_FLOOR_SEARCH_M; d += 0.1) {
      const rr = r - d;
      this.oracleCalls++;
      if (this.oracle.solidAt(ux * rr, uy * rr, uz * rr)) return rr + 0.1;
    }
    return null;
  }

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
