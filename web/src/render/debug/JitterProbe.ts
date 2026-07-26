// Measures the two things that make a walk look unstable, separately, because
// they have different causes and different fixes.
//
// 1. FLOAT32 QUANTIZATION. three computes modelViewMatrix in f64 on the CPU and
//    only downcasts the CAMERA-RELATIVE result on upload, so the error scales
//    with the camera-to-anchor distance, not with the planet radius. This probe
//    replays that exact pipeline (fround the 16 modelView elements, fround the
//    vertex, multiply in f32) against the f64 answer and reports the residual.
//    It is the number the W1 handoff asked for.
//
// 2. FIXED-TICK ALIASING. The capsule advances at 60 Hz; rendering samples it at
//    vsync. Without interpolation the eye's screen position is a staircase, and
//    the SECOND DIFFERENCE of a constant-velocity walk (which should be ~0)
//    exposes it directly. This is the far larger term, and the one the alpha
//    interpolation in Controller.interpolate fixes.
//
// Zero allocation per sample: everything below writes into preallocated rows.

import type * as THREE from 'three';

const MAX_STAKES = 16;
/** [ax, ay, az, lx, ly, lz] per stake: engine-space anchor + f32 local offset. */
export const STAKE_STRIDE = 6;

export interface JitterStats {
  samples: number;
  stakes: number;
  /** |f32 camera-space - f64 camera-space|, millimetres. */
  errMm: { max: number; mean: number };
  /** Frame-to-frame CHANGE in that error: the shimmer, not the offset. */
  stepMm: { max: number; mean: number };
  /** The same step projected to screen pixels. */
  stepPx: { max: number };
  /** Second difference of the eye position over rendered frames, millimetres. */
  eyeJerkMm: { max: number; mean: number };
  /** Largest camera-to-anchor distance sampled: what drives term 1. */
  worstAnchorDistM: number;
}

const f = Math.fround;

export class JitterProbe {
  enabled = false;
  private readonly prevErr = new Float64Array(MAX_STAKES * 3);
  private readonly mv = new Float64Array(16);
  private readonly eyeHist = new Float64Array(9);
  private eyeCount = 0;
  private samples = 0;
  private stakeCount = 0;
  private errMax = 0; private errSum = 0; private errN = 0;
  private stepMax = 0; private stepSum = 0; private stepN = 0;
  private stepPxMax = 0;
  private jerkMax = 0; private jerkSum = 0; private jerkN = 0;
  private anchorMax = 0;
  private primed = false;

  reset(): void {
    this.samples = 0;
    this.errMax = 0; this.errSum = 0; this.errN = 0;
    this.stepMax = 0; this.stepSum = 0; this.stepN = 0;
    this.stepPxMax = 0;
    this.jerkMax = 0; this.jerkSum = 0; this.jerkN = 0;
    this.anchorMax = 0;
    this.eyeCount = 0;
    this.primed = false;
  }

  /**
   * @param cam        the near camera, AFTER updateMatrixWorld
   * @param stakes     STAKE_STRIDE floats per stake (see above)
   * @param nStakes    how many of them are populated
   * @param viewportH  pixels of viewport height, for the screen-space figure
   */
  sample(cam: THREE.PerspectiveCamera, stakes: Float64Array, nStakes: number, viewportH: number): void {
    if (!this.enabled) return;
    this.samples++;
    this.sampleEye(cam);
    const n = Math.min(nStakes, MAX_STAKES);
    this.stakeCount = n;
    if (n === 0) return;
    const V = cam.matrixWorldInverse.elements;
    const focal = viewportH / (2 * Math.tan((cam.fov * Math.PI) / 360));
    const mv = this.mv;
    // The rotation block of modelView is the view rotation: a chunk mesh in the
    // near scene is a pure translation at unit scale.
    for (let i = 0; i < 12; ++i) mv[i] = V[i];

    for (let s = 0; s < n; ++s) {
      const o = s * STAKE_STRIDE;
      const ax = stakes[o], ay = stakes[o + 1], az = stakes[o + 2];
      const lx = stakes[o + 3], ly = stakes[o + 4], lz = stakes[o + 5];
      // modelView translation = view * anchor, in f64 exactly as three does it.
      mv[12] = V[0] * ax + V[4] * ay + V[8] * az + V[12];
      mv[13] = V[1] * ax + V[5] * ay + V[9] * az + V[13];
      mv[14] = V[2] * ax + V[6] * ay + V[10] * az + V[14];
      const d = Math.hypot(mv[12], mv[13], mv[14]);
      if (d > this.anchorMax) this.anchorMax = d;

      const wx = ax + lx, wy = ay + ly, wz = az + lz;
      const c64x = V[0] * wx + V[4] * wy + V[8] * wz + V[12];
      const c64y = V[1] * wx + V[5] * wy + V[9] * wz + V[13];
      const c64z = V[2] * wx + V[6] * wy + V[10] * wz + V[14];

      const qx = f(lx), qy = f(ly), qz = f(lz);
      const c32x = f(f(f(f(mv[0]) * qx) + f(f(mv[4]) * qy)) + f(f(f(mv[8]) * qz) + f(mv[12])));
      const c32y = f(f(f(f(mv[1]) * qx) + f(f(mv[5]) * qy)) + f(f(f(mv[9]) * qz) + f(mv[13])));
      const c32z = f(f(f(f(mv[2]) * qx) + f(f(mv[6]) * qy)) + f(f(f(mv[10]) * qz) + f(mv[14])));

      const ex = c32x - c64x, ey = c32y - c64y, ez = c32z - c64z;
      const err = Math.hypot(ex, ey, ez) * 1000;
      if (err > this.errMax) this.errMax = err;
      this.errSum += err; this.errN++;

      const p = s * 3;
      if (this.primed) {
        const sx = ex - this.prevErr[p], sy = ey - this.prevErr[p + 1], sz = ez - this.prevErr[p + 2];
        const step = Math.hypot(sx, sy, sz) * 1000;
        if (step > this.stepMax) this.stepMax = step;
        this.stepSum += step; this.stepN++;
        const px = (Math.hypot(sx, sy) / Math.max(0.05, Math.abs(c64z))) * focal;
        if (px > this.stepPxMax) this.stepPxMax = px;
      }
      this.prevErr[p] = ex; this.prevErr[p + 1] = ey; this.prevErr[p + 2] = ez;
    }
    this.primed = true;
  }

  /** Second difference of the rendered eye position: the fixed-tick staircase. */
  private sampleEye(cam: THREE.PerspectiveCamera): void {
    const h = this.eyeHist;
    h[6] = h[3]; h[7] = h[4]; h[8] = h[5];
    h[3] = h[0]; h[4] = h[1]; h[5] = h[2];
    h[0] = cam.position.x; h[1] = cam.position.y; h[2] = cam.position.z;
    if (this.eyeCount < 3) { this.eyeCount++; return; }
    const jx = h[0] - 2 * h[3] + h[6];
    const jy = h[1] - 2 * h[4] + h[7];
    const jz = h[2] - 2 * h[5] + h[8];
    const j = Math.hypot(jx, jy, jz) * 1000;
    if (j > this.jerkMax) this.jerkMax = j;
    this.jerkSum += j; this.jerkN++;
  }

  stats(): JitterStats {
    return {
      samples: this.samples,
      stakes: this.stakeCount,
      errMm: { max: this.errMax, mean: this.errN > 0 ? this.errSum / this.errN : 0 },
      stepMm: { max: this.stepMax, mean: this.stepN > 0 ? this.stepSum / this.stepN : 0 },
      stepPx: { max: this.stepPxMax },
      eyeJerkMm: { max: this.jerkMax, mean: this.jerkN > 0 ? this.jerkSum / this.jerkN : 0 },
      worstAnchorDistM: this.anchorMax,
    };
  }
}
