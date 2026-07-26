// Debris from a pick strike: one THREE.Points burst thrown out of the cut.
//
// One responsibility: the visible reaction to a dig landing. It does not decide
// what was hit (VoxelWorld), does not draw the rock (VoxelMesh) and does not
// grant anything (the gameplay layer). It is deliberately a stock PointsMaterial
// so it adds NO custom shader against the DW-10 cap of five, and one draw call
// that is skipped entirely while nothing is in the air.
//
// Standing rule 1 reaches even here: the debris falls at /core's gravity, read
// through the same accessor the walker uses, never at a constant typed in this
// file. Standing rule 6: positions are f32 offsets from a 64-bit body-frame
// anchor, re-placed every tick, so a floating-origin rebase cannot smear it.

import * as THREE from 'three';
import type { FloatingOrigin } from '../world/FloatingOrigin.js';
import type { Vec3d } from '../world/PlanetBody.js';

/** Particles in the pool. One burst can use all of them. */
const COUNT = 72;
/** Seconds a chip lives. Long enough to arc, short enough to never litter. */
const LIFE_S = 0.85;
/** Metres per second the chips leave the rock at. */
const SPEED_MIN = 1.6;
const SPEED_MAX = 5.5;

export interface DigFxStats {
  bursts: number;
  alive: number;
  /** Seconds since the last burst, so a probe can prove one just happened. */
  ageS: number;
}

export class DigFx {
  readonly points: THREE.Points;
  private readonly geo = new THREE.BufferGeometry();
  private readonly mat: THREE.PointsMaterial;
  private readonly anchor: Vec3d = { x: 0, y: 0, z: 0 };
  private readonly pos = new Float32Array(COUNT * 3);
  private readonly vel = new Float32Array(COUNT * 3);
  private readonly life = new Float32Array(COUNT);
  private alive = 0;
  private rng = 0x2f6e2b1;
  readonly stats: DigFxStats = { bursts: 0, alive: 0, ageS: 999 };

  constructor(
    private readonly origin: FloatingOrigin,
    /** /core's gravity at radius rM. The ONE authority (DW-18). */
    private readonly gravityAccel: (rM: number) => number,
  ) {
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.geo.setDrawRange(0, 0);
    this.geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 40);
    this.mat = new THREE.PointsMaterial({
      color: 0xb9a487, size: 0.13, sizeAttenuation: true,
      transparent: true, opacity: 1, depthWrite: false,
    });
    this.points = new THREE.Points(this.geo, this.mat);
    this.points.name = 'digDebris';
    this.points.frustumCulled = false;
    this.points.visible = false;
  }

  /** Deterministic uniform in [0,1). Same strike sequence, same debris. */
  private rand(): number {
    this.rng = (this.rng * 1664525 + 1013904223) >>> 0;
    return this.rng / 4294967296;
  }

  /**
   * Throw chips out of a strike. `at` is the hit in body-frame metres and `aim`
   * is the direction the tool was swung, so the spray comes BACK out of the cut
   * rather than continuing into it, which is the difference between debris and
   * a puff of nothing.
   */
  burst(at: Vec3d, aim: Vec3d): void {
    const r = Math.hypot(at.x, at.y, at.z) || 1;
    const ux = at.x / r, uy = at.y / r, uz = at.z / r;
    this.anchor.x = at.x; this.anchor.y = at.y; this.anchor.z = at.z;
    for (let i = 0; i < COUNT; ++i) {
      const o = i * 3;
      // Start scattered inside the brush, not all from one point.
      this.pos[o] = (this.rand() - 0.5) * 1.2;
      this.pos[o + 1] = (this.rand() - 0.5) * 1.2;
      this.pos[o + 2] = (this.rand() - 0.5) * 1.2;
      // Back along the swing, widened by a random cone and biased upward.
      const s = SPEED_MIN + this.rand() * (SPEED_MAX - SPEED_MIN);
      const jx = this.rand() - 0.5, jy = this.rand() - 0.5, jz = this.rand() - 0.5;
      const up = 0.35 + this.rand() * 0.9;
      this.vel[o] = (-aim.x * 0.8 + jx * 1.4 + ux * up) * s;
      this.vel[o + 1] = (-aim.y * 0.8 + jy * 1.4 + uy * up) * s;
      this.vel[o + 2] = (-aim.z * 0.8 + jz * 1.4 + uz * up) * s;
      this.life[i] = LIFE_S * (0.6 + this.rand() * 0.4);
    }
    this.alive = COUNT;
    this.stats.bursts++;
    this.stats.ageS = 0;
    this.points.visible = true;
    this.geo.setDrawRange(0, COUNT);
    this.mat.opacity = 1;
    (this.geo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    // Placed NOW, not on the next tick: the strike and its debris have to land
    // in the same frame or the first frame of every burst draws it at the last
    // strike's anchor, which reads as chips flying out of the wrong wall.
    this.place();
  }

  /** Fixed-tick integration. Cheap and skipped entirely when nothing is alive. */
  step(dt: number): void {
    this.stats.ageS += dt;
    if (this.alive === 0) { this.stats.alive = 0; return; }
    const a = this.anchor;
    const r = Math.hypot(a.x, a.y, a.z) || 1;
    const g = this.gravityAccel(r) * dt;
    const ux = a.x / r, uy = a.y / r, uz = a.z / r;
    let live = 0;
    let oldest = 0;
    for (let i = 0; i < COUNT; ++i) {
      if (this.life[i] <= 0) continue;
      const o = i * 3;
      this.vel[o] -= ux * g; this.vel[o + 1] -= uy * g; this.vel[o + 2] -= uz * g;
      this.pos[o] += this.vel[o] * dt;
      this.pos[o + 1] += this.vel[o + 1] * dt;
      this.pos[o + 2] += this.vel[o + 2] * dt;
      this.life[i] -= dt;
      if (this.life[i] > 0) { live++; if (this.life[i] > oldest) oldest = this.life[i]; }
      else { this.pos[o] = 0; this.pos[o + 1] = 1e6; this.pos[o + 2] = 0; }
    }
    this.alive = live;
    this.stats.alive = live;
    this.mat.opacity = Math.min(1, oldest / (LIFE_S * 0.5));
    (this.geo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    if (live === 0) { this.points.visible = false; this.geo.setDrawRange(0, 0); }
    this.place();
  }

  /** Re-derive the engine transform from the 64-bit anchor. Rebase safe. */
  place(): void {
    const p = new THREE.Vector3();
    this.origin.toEngine(this.anchor, p);
    this.points.position.copy(p);
    this.points.updateMatrix();
    this.points.updateMatrixWorld(true);
  }

  dispose(): void {
    this.geo.dispose();
    this.mat.dispose();
    this.points.removeFromParent();
  }
}
