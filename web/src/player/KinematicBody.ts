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
import { VoxelCollider } from './VoxelCollision.js';

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
  /**
   * THE STEP UP, and therefore THE WALL. The tallest the ground may be above
   * where the feet started a tick and still be walked onto. A lip under this is
   * a step; anything over it is a cliff and the horizontal move into it is
   * refused (`climbGate`).
   *
   * Before this existed the heightfield had no walls at all: `gap <= 0` read
   * "below the ground, therefore landing", so ONE tick's 7.7 cm of travel into
   * the foot of a cliff snapped the capsule to the top of it. Measured: the
   * walker climbed 12 m straight up out of a 10.4 m shaft it had just dug,
   * with rock 1.75 m ahead at eye height (walkfeel.js negative control). The
   * slope limit below did not catch it and cannot: it is sampled AFTER the
   * snap, so it reads the flat ground at the top of the cliff.
   *
   * 0.6 m is knee height on a 1.8 m capsule. It is over an order of magnitude
   * more than the 3.4 cm of real relief a walk across this terrain presents in
   * one tick, so it never fires on ordinary ground, and it is well under the
   * 1 m quantum the derived lowering moves in, so a hole you dig still needs a
   * jump or a ramp to get out of.
   */
  stepUpM: 1.1,
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

  /** Everything that touches the voxel lattice. See VoxelCollision.ts. */
  private readonly col: VoxelCollider;

  constructor(private readonly oracle: SurfaceOracle) {
    this.col = new VoxelCollider(oracle);
  }

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
    this.col.resetCalls();

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
    let surfaceR = this.oracle.surfaceRadius(dxn, dyn, dzn);
    this.oracleCalls++;
    let groundR = surfaceR;
    this.underRock = false;
    this.blockedByRock = false;
    const deep = this.oracle.editsHandle !== 0 && qr < surfaceR - DEEP_UNDERGROUND_M;
    if (!deep) {
      // The heightfield's own wall. See CAPSULE.stepUpM.
      const gate = this.climbGate(p, qx, qy, qz, r, ux, uy, uz, surfaceR);
      if (gate.moved) {
        qx = gate.x; qy = gate.y; qz = gate.z;
        qr = Math.hypot(qx, qy, qz) || 1;
        dxn = qx / qr; dyn = qy / qr; dzn = qz / qr;
        surfaceR = gate.surfaceR;
        groundR = gate.surfaceR;
        // Velocity IS the accepted displacement over dt, so a capsule pressed
        // into a cliff does not keep a hidden into-the-wall speed that fires
        // it sideways the moment the wall runs out.
        tx = gate.tx / dt; ty = gate.ty / dt; tz = gate.tz / dt;
      }
    }
    if (deep) {
      // A refused step used to mean a refused TICK: the whole displacement was
      // undone and the tangential velocity zeroed, so brushing a tunnel wall at
      // any angle stopped the player dead and the tunnel ran on ahead of them
      // (STATUS.md, W5 remaining). Now the step is resolved: climb a ledge if
      // one is in the way, otherwise slide along the wall by dropping the
      // body-frame axis that is blocked. Voxel walls ARE axis aligned, so
      // dropping an axis is exactly sliding along the face.
      const s = this.col.resolveStep(p, qx, qy, qz, ux, uy, uz);
      qx = s.x; qy = s.y; qz = s.z;
      qr = Math.hypot(qx, qy, qz) || 1;
      dxn = qx / qr; dyn = qy / qr; dzn = qz / qr;
      if (s.blocked) { tx = 0; ty = 0; tz = 0; this.blockedByRock = true; }
      const floorR = this.col.floorBelow(qr, dxn, dyn, dzn, VOXEL_FLOOR_SEARCH_M);
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

    // 2. THE MOUTH (15.2 item 48, now closed). A dig that breaks the surface
    //    leaves a rim: the heightfield has reconciled down to the shaft floor
    //    while cells beside it are still solid, so the capsule can end a tick
    //    standing inside the wall of the opening.
    //
    //    This USED to be a radial push sized from the whole capsule, which
    //    resolved nothing geometrically: it lifted the player until the deepest
    //    sample happened to clear, up to 2.8 m, straight up. It had to be
    //    skipped underground to stop it levitating people through their own
    //    ceiling, so the mouth and the tunnel were two different resolvers with
    //    a 1.5 m seam between them. It is now the exact minimum translation out
    //    of the offending cell FACE (VoxelCollision.resolveEmbedded), which is
    //    correct rather than approximate because a voxel's contact normal is
    //    always a body-frame axis. It can never exceed one cell, so it needs no
    //    depth special case and runs in both regimes.
    this.voxelPushM = 0;
    if (this.oracle.editsHandle !== 0) {
      const push = this.col.resolveEmbedded(qx, qy, qz, dxn, dyn, dzn);
      if (push !== null) {
        this.voxelPushM = push.dist;
        qx += push.x; qy += push.y; qz += push.z;
        qr = Math.hypot(qx, qy, qz) || 1;
        dxn = qx / qr; dyn = qy / qr; dzn = qz / qr;
        // Only a push with an UPWARD component is a landing. A sideways nudge
        // out of a rim wall must not ground a falling player, or stepping off
        // the lip of a shaft would catch them on the way down.
        if (push.x * dxn + push.y * dyn + push.z * dzn > 0.05 * push.dist) {
          if (vUp < 0) vUp = 0;
          this.grounded = true;
        }
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
    // The collider does most of the oracle work now; fold it in or the tick
    // budget this reports is only the half of it that stayed here.
    this.oracleCalls += this.col.calls;
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
   * Refuse a horizontal move onto ground more than `CAPSULE.stepUpM` above where
   * the feet started this tick. `r` is that starting radius and `surfaceR` is
   * the ground already sampled at the destination, so the common case (every
   * ordinary walking tick) costs nothing but the comparison.
   *
   * Only the TANGENTIAL half of the move is judged. The radial half is a jump or
   * a fall, and rising 0.6 m under your own power is exactly how you are meant
   * to reach ground that is more than a step up.
   */
  private climbGate(
    p: Vec3d, qx: number, qy: number, qz: number, r: number,
    ux: number, uy: number, uz: number, surfaceR: number,
  ): { x: number; y: number; z: number; surfaceR: number; moved: boolean;
    tx: number; ty: number; tz: number } {
    const keep = { x: qx, y: qy, z: qz, surfaceR, moved: false, tx: 0, ty: 0, tz: 0 };
    if (surfaceR - r <= CAPSULE.stepUpM) return keep;
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
    // Slide by keeping one tangent axis at a time, the larger first. A
    // heightfield wall has no axis to drop the way a voxel face does, so this
    // is an approximation, but it is the cheapest one that lets a player walk
    // ALONG the foot of a cliff instead of being pinned to it, and it costs an
    // oracle call only on a tick that actually hit a wall.
    const tries: [number, number][] = Math.abs(a) >= Math.abs(b)
      ? [[a, 0], [0, b]] : [[0, b], [a, 0]];
    for (const [ca, cb] of tries) {
      if (ca === 0 && cb === 0) continue;
      const tX = ex * ca + nx * cb, tY = ey * ca + ny * cb, tZ = ez * ca + nz * cb;
      const sx = sx0 + tX, sy = sy0 + tY, sz = sz0 + tZ;
      const sr = Math.hypot(sx, sy, sz) || 1;
      this.oracleCalls++;
      const g = this.oracle.surfaceRadius(sx / sr, sy / sr, sz / sr);
      if (g - r <= CAPSULE.stepUpM) {
        return { x: sx, y: sy, z: sz, surfaceR: g, moved: true, tx: tX, ty: tY, tz: tZ };
      }
    }
    // Nothing horizontal survives. Keep the radial half: a player pressed into
    // a cliff still falls, still lands and can still jump onto it.
    const sr = Math.hypot(sx0, sy0, sz0) || 1;
    this.oracleCalls++;
    return {
      x: sx0, y: sy0, z: sz0,
      surfaceR: this.oracle.surfaceRadius(sx0 / sr, sy0 / sr, sz0 / sr),
      moved: true, tx: 0, ty: 0, tz: 0,
    };
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
