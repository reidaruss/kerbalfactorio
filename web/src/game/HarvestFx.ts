// What a landed swing looks like: a burst of debris in the resource's own
// colour, and a camera kick.
//
// The swing already grants on the authored impact frame (17 of 33), so this
// hangs off that same moment and nothing else. Before it, a harvest was a number
// changing in a corner of the screen; the tell that a game is a spreadsheet is
// that the world does not react to you.
//
// ONE BatchedMesh, three chip shapes, per-instance colour (DW-11). The whole
// effect is one draw call no matter how many bursts overlap, and no custom
// shader, so it costs nothing against the DW-10 cap of 5.
//
// DEBRIS LIVES IN THE BODY FRAME, like everything else that is not the camera.
// Integrating a particle in engine space means a floating-origin rebase teleports
// the burst sideways; integrating in body-frame doubles and converting to engine
// space per frame costs a subtract per particle and cannot break (ARCHITECTURE
// 3.6). Engine-space values stay small, so the float32 instance matrix is exact.

import * as THREE from 'three';
import type { FloatingOrigin } from '../world/FloatingOrigin.js';

const MAX = 168;
/** Forge's measured surface gravity (DW-18). Debris falls like everything else. */
const GRAVITY = 9.71;

export interface Burst {
  /** Body-frame impact point. */
  pos: { x: number; y: number; z: number };
  /** Local up at the impact (the node's surface normal). */
  up: { x: number; y: number; z: number };
  /** Roughly back towards the player, so chips fly at the camera, not away. */
  back: { x: number; y: number; z: number };
  colour: number;
  count: number;
}

/** Deterministic per-particle noise: a probe re-running a tape sees one world. */
function rnd(a: number, b: number): number {
  let h = (Math.imul(a + 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x165667b1, 0x27d4eb2f)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x2545f491) >>> 0;
  return ((h ^ (h >>> 13)) >>> 8) / 16777216;
}

function chip(size: number): THREE.BufferGeometry {
  const g = new THREE.TetrahedronGeometry(size, 0);
  g.computeVertexNormals();
  return g;
}

export class Debris {
  readonly mesh: THREE.BatchedMesh;
  private readonly px = new Float64Array(MAX);
  private readonly py = new Float64Array(MAX);
  private readonly pz = new Float64Array(MAX);
  private readonly vx = new Float32Array(MAX);
  private readonly vy = new Float32Array(MAX);
  private readonly vz = new Float32Array(MAX);
  private readonly ux = new Float32Array(MAX);
  private readonly uy = new Float32Array(MAX);
  private readonly uz = new Float32Array(MAX);
  private readonly life = new Float32Array(MAX);
  private readonly span = new Float32Array(MAX);
  private readonly slot: number[] = [];
  private readonly geom: number[] = [];
  private next = 0;
  private seq = 0;
  live = 0;
  spawned = 0;

  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly e = new THREE.Euler();
  private readonly p = new THREE.Vector3();
  private readonly s = new THREE.Vector3();
  private readonly c = new THREE.Color();

  constructor() {
    const material = new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0.0 });
    const verts = MAX * 8;
    this.mesh = new THREE.BatchedMesh(MAX, verts, verts * 3, material);
    this.mesh.name = 'harvestDebris';
    this.mesh.frustumCulled = false;
    this.mesh.sortObjects = false;
    this.mesh.perObjectFrustumCulled = false;
    // castShadow is deliberately OFF: a 4 cm chip contributes no readable shadow
    // and would put every burst through all three cascades for nothing.
    for (const size of [0.055, 0.075, 0.040]) this.geom.push(this.mesh.addGeometry(chip(size)));
    for (let i = 0; i < MAX; ++i) {
      this.slot.push(this.mesh.addInstance(this.geom[0]));
      this.mesh.setVisibleAt(this.slot[i], false);
      this.life[i] = 0;
    }
  }

  /** Fire a burst. Oldest particles are recycled, so a held key cannot starve it. */
  burst(b: Burst): void {
    this.c.setHex(b.colour);
    const n = Math.min(b.count, MAX);
    const seq = this.seq++;
    for (let k = 0; k < n; ++k) {
      const i = this.next;
      this.next = (this.next + 1) % MAX;
      if (this.life[i] <= 0) this.live++;
      this.px[i] = b.pos.x; this.py[i] = b.pos.y; this.pz[i] = b.pos.z;
      this.ux[i] = b.up.x; this.uy[i] = b.up.y; this.uz[i] = b.up.z;
      // A cone: mostly up and back towards the eye, widened by two hashed angles.
      const a = rnd(seq, k * 3 + 1) * Math.PI * 2;
      const spread = 0.35 + rnd(seq, k * 3 + 2) * 0.75;
      const speed = 2.4 + rnd(seq, k * 3 + 3) * 3.4;
      // An orthogonal pair around `up` gives the cone its sideways component.
      const t1x = b.up.y * b.back.z - b.up.z * b.back.y;
      const t1y = b.up.z * b.back.x - b.up.x * b.back.z;
      const t1z = b.up.x * b.back.y - b.up.y * b.back.x;
      const dx = b.up.x * 0.85 + b.back.x * spread + t1x * (spread * Math.cos(a));
      const dy = b.up.y * 0.85 + b.back.y * spread + t1y * (spread * Math.cos(a));
      const dz = b.up.z * 0.85 + b.back.z * spread + t1z * (spread * Math.cos(a));
      const inv = speed / (Math.hypot(dx, dy, dz) || 1);
      this.vx[i] = dx * inv; this.vy[i] = dy * inv; this.vz[i] = dz * inv;
      this.span[i] = 0.42 + rnd(seq, k * 3 + 4) * 0.38;
      this.life[i] = this.span[i];
      this.mesh.setGeometryIdAt(this.slot[i], this.geom[k % this.geom.length]);
      this.mesh.setColorAt(this.slot[i], this.c);
      this.mesh.setVisibleAt(this.slot[i], true);
      this.spawned++;
    }
  }

  /** Integrate in the body frame, then re-derive engine space. Every frame. */
  update(dt: number, origin: FloatingOrigin): void {
    // A BatchedMesh with every instance hidden is still a draw call, and this
    // one is idle almost all the time, so the whole object leaves the graph
    // between bursts. One boolean is worth a draw against a 150 budget.
    this.mesh.visible = this.live > 0;
    if (this.live === 0) return;
    let alive = 0;
    for (let i = 0; i < MAX; ++i) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      if (this.life[i] <= 0) { this.mesh.setVisibleAt(this.slot[i], false); continue; }
      alive++;
      const g = GRAVITY * dt;
      this.vx[i] -= this.ux[i] * g; this.vy[i] -= this.uy[i] * g; this.vz[i] -= this.uz[i] * g;
      const drag = 1 - Math.min(0.9, 1.6 * dt);
      this.vx[i] *= drag; this.vy[i] *= drag; this.vz[i] *= drag;
      this.px[i] += this.vx[i] * dt; this.py[i] += this.vy[i] * dt; this.pz[i] += this.vz[i] * dt;
      origin.toEngine({ x: this.px[i], y: this.py[i], z: this.pz[i] }, this.p);
      const k = this.life[i] / this.span[i];
      // Chips tumble, and shrink only in the last third so the burst reads as
      // debris settling rather than as something dissolving on contact.
      const t = (this.span[i] - this.life[i]) * 9 + i;
      this.e.set(t, t * 1.31, t * 0.77);
      this.q.setFromEuler(this.e);
      this.s.setScalar(k > 0.34 ? 1 : Math.max(0.05, k * 2.9));
      this.m.compose(this.p, this.q, this.s);
      this.mesh.setMatrixAt(this.slot[i], this.m);
    }
    this.live = alive;
  }
}

/**
 * A camera kick that cannot corrupt the aim.
 *
 * The kick is authored as a PITCH OFFSET CURVE and applied as its per-tick
 * difference through the same additive Controller.look the mouse uses, so the
 * offsets sum to exactly zero and the player's aim ends where it started. It is
 * skipped near the pitch limit, because a clamp there would eat part of the rise
 * and the return would then over-correct: a camera that slowly drifts upward
 * every time you chop a tree is worse than no kick at all.
 */
const CURVE = [0.0000, 0.0250, 0.0330, 0.0290, 0.0215, 0.0150, 0.0098,
  0.0058, 0.0030, 0.0013, 0.0004, 0.0000];
/** Radians. Well inside ViewMode's limit, so the whole curve always fits. */
const SAFE_PITCH = 1.25;

export class CameraKick {
  private t = -1;
  private sign = 1;
  applied = 0;

  /** Start a kick. `n` only varies the yaw flick, so swings do not feel identical. */
  fire(n: number): void { this.t = 0; this.sign = (n & 1) === 0 ? 1 : -1; }

  /** One fixed tick. Returns [dYaw, dPitch] to hand to Controller.look. */
  step(pitch: number): [number, number] {
    if (this.t < 0) return [0, 0];
    if (Math.abs(pitch) > SAFE_PITCH) { this.t = -1; return [0, 0]; }
    const i = this.t++;
    if (i + 1 >= CURVE.length) { this.t = -1; return [0, 0]; }
    const d = CURVE[i + 1] - CURVE[i];
    this.applied++;
    return [d * 0.28 * this.sign, d];
  }

  get active(): boolean { return this.t >= 0; }
}
