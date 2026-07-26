// FP / TP state, yaw and pitch authority, spring arm, aim preservation
// (ARCHITECTURE.md section 3.4).
//
// Yaw and pitch are the authority in BOTH modes and the aim ray is derived from
// them alone, so a toggle changes only where the camera SITS. Aim preservation
// is therefore structural: there is no fix-up step that could be forgotten, and
// __of.aim() returns the same ray on both sides of a toggle by construction.

import * as THREE from 'three';
import type { SurfaceOracle } from '../world/SurfaceOracle.js';
import type { Vec3d } from '../world/PlanetBody.js';
import { tangentFrame } from './ViewSource.js';

export type CameraMode = 'FP' | 'TP';

const ARM_MAX_M = 3.5;
const ARM_LIFT_M = 0.95;
const ARM_PROBE_STEP_M = 0.25;
const ARM_CLEARANCE_M = 0.3;
/** Critically damped extend; retraction is instant or the camera clips. */
const ARM_EXTEND_RATE = 8.0;
const PITCH_LIMIT = 1.5533;

export class ViewMode {
  mode: CameraMode = 'FP';
  yaw = 0;
  pitch = 0;
  armLength = 0;
  armTarget = 0;
  toggles = 0;

  readonly up = new THREE.Vector3(0, 1, 0);
  readonly east = new THREE.Vector3();
  readonly north = new THREE.Vector3();
  /** Unit aim direction, body frame. IDENTICAL in FP and TP. */
  readonly aim = new THREE.Vector3();
  readonly orientation = new THREE.Quaternion();
  /** Body-frame f64 eye. The aim ray's origin in both modes. */
  readonly eye: Vec3d = { x: 0, y: 0, z: 0 };
  /** Body-frame f64 camera position: eye in FP, pulled back in TP. */
  readonly camera: Vec3d = { x: 0, y: 0, z: 0 };

  private readonly tmpM = new THREE.Matrix4();
  private readonly zero = new THREE.Vector3();

  constructor(private readonly oracle: SurfaceOracle) {}

  look(dYaw: number, dPitch: number): void {
    this.yaw = (this.yaw + dYaw) % (Math.PI * 2);
    this.pitch = THREE.MathUtils.clamp(this.pitch + dPitch, -PITCH_LIMIT, PITCH_LIMIT);
  }

  /** Swaps the mode and NOTHING else. Yaw, pitch and the aim ray are untouched. */
  toggle(): void {
    this.mode = this.mode === 'FP' ? 'TP' : 'FP';
    if (this.mode === 'TP') this.armLength = 0;   // 150 ms ease reads as a pull-back
    this.toggles++;
  }

  /**
   * Rebuild the tangent frame and the aim ray at a feet position, then place the
   * camera. `dt` drives only the spring arm, which is deliberately smoothed at a
   * variable rate; the eye itself is never smoothed, because smoothing the eye
   * is indistinguishable from lag.
   */
  update(feet: Vec3d, eyeHeightM: number, dt: number): void {
    const r = Math.hypot(feet.x, feet.y, feet.z) || 1;
    this.up.set(feet.x / r, feet.y / r, feet.z / r);
    tangentFrame(this.up, this.east, this.north);

    const k = (r + eyeHeightM) / r;
    this.eye.x = feet.x * k; this.eye.y = feet.y * k; this.eye.z = feet.z * k;

    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    this.aim.set(0, 0, 0)
      .addScaledVector(this.east, Math.sin(this.yaw) * cp)
      .addScaledVector(this.north, Math.cos(this.yaw) * cp)
      .addScaledVector(this.up, sp)
      .normalize();

    if (this.mode === 'FP') {
      this.armLength = 0;
      this.armTarget = 0;
      this.camera.x = this.eye.x; this.camera.y = this.eye.y; this.camera.z = this.eye.z;
    } else {
      // dt === 0 is the per-RENDER-frame re-place from an interpolated position:
      // it re-derives the camera but must not re-probe or re-smooth the arm,
      // which would make the arm advance at frame rate instead of tick rate.
      if (dt > 0) {
        this.armTarget = this.springArm();
        // Extend with a critically damped spring, retract instantly (section 3.4).
        this.armLength = this.armTarget < this.armLength
          ? this.armTarget
          : this.armLength + (this.armTarget - this.armLength) * Math.min(1, ARM_EXTEND_RATE * dt);
      }
      const a = this.armLength;
      const lift = ARM_LIFT_M * (a / ARM_MAX_M);
      this.camera.x = this.eye.x - this.aim.x * a + this.up.x * lift;
      this.camera.y = this.eye.y - this.aim.y * a + this.up.y * lift;
      this.camera.z = this.eye.z - this.aim.z * a + this.up.z * lift;
    }

    this.tmpM.lookAt(this.zero, this.aim, this.up);
    this.orientation.setFromRotationMatrix(this.tmpM);
  }

  /**
   * March backward along -aim testing the surface oracle. There is no mesh to
   * sphere-cast against yet (that is three-mesh-bvh at W4), and the oracle is
   * the authority for the only occluder that exists at W2: the ground.
   */
  private springArm(): number {
    const e = this.eye;
    for (let t = ARM_PROBE_STEP_M; t <= ARM_MAX_M; t += ARM_PROBE_STEP_M) {
      const lift = ARM_LIFT_M * (t / ARM_MAX_M);
      const px = e.x - this.aim.x * t + this.up.x * lift;
      const py = e.y - this.aim.y * t + this.up.y * lift;
      const pz = e.z - this.aim.z * t + this.up.z * lift;
      const pr = Math.hypot(px, py, pz);
      const gr = this.oracle.surfaceRadius(px / pr, py / pr, pz / pr);
      if (pr - gr < ARM_CLEARANCE_M) return Math.max(0, t - ARM_PROBE_STEP_M);
    }
    return ARM_MAX_M;
  }
}
