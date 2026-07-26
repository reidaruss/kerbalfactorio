// A furnace that is doing work looks like it is doing work.
//
// The furnace was a menu: 180 ticks passed, a bar filled, and the machine on the
// ground never changed. Both halves of the fix were already IN THE ASSET and
// simply unused (ASSET-SPECS / build_primitive_furnace.py): an emissive fire
// card recessed in the mouth on its own material slot, and a `socket_smoke`
// empty at the top of the flue. This module drives them from the /core furnace
// state, so a lit furnace means "gameplay.h says it is smelting" and nothing
// else.
//
// THREE STATES, because "stalled for no fuel" is not the same as "idle", and the
// asset's own doc-comment says so: burning (bright, flickering, smoking), embers
// (fuel in the pool but nothing to smelt, dim, no smoke), cold (no fuel, fully
// dark). A cold furnace must look cold, otherwise the one signal that tells a
// player to go and chop more wood is missing.

import * as THREE from 'three';
import { findNode } from '../assets/Loaders.js';
import type { FloatingOrigin } from '../world/FloatingOrigin.js';

/** The fire colour the smelter's VisualState 1 is authored against. */
const FIRE = new THREE.Color(0xff7a1e);
const EMBER = new THREE.Color(0xd63c10);

export interface GlowState { burning: boolean; hasFuel: boolean }

/**
 * The emissive state surface of one placed machine.
 *
 * Materials are CLONED per machine. `Object3D.clone(true)` shares materials with
 * the template, so without this the first furnace to light up would light up
 * every furnace ever placed, including the ones with no fuel.
 */
export class MachineGlow {
  private readonly mats: THREE.MeshStandardMaterial[] = [];
  private readonly card: THREE.Object3D | null;
  /** Current emissive strength, eased towards the target. Fire does not snap on. */
  private level = 0;
  private t = 0;

  constructor(root: THREE.Object3D, cardName: string) {
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh !== true) return;
      const mat = m.material as THREE.Material;
      if (mat.name !== 'EmissiveState') return;
      const c = (mat as THREE.MeshStandardMaterial).clone();
      c.emissive = new THREE.Color(0, 0, 0);
      c.emissiveIntensity = 0;
      m.material = c;
      this.mats.push(c);
    });
    this.card = findNode(root, cardName);
    if (this.card !== null) this.card.scale.setScalar(0.001);
  }

  get lit(): number { return this.level; }

  update(dt: number, s: GlowState): void {
    this.t += dt;
    const target = s.burning ? 1 : (s.hasFuel ? 0.26 : 0);
    // Lighting takes about a third of a second, dying takes about a second: a
    // fire that goes out the instant the last ore is consumed reads as a switch.
    const rate = target > this.level ? 3.2 : 1.1;
    this.level += Math.max(-rate * dt, Math.min(rate * dt, target - this.level));
    // Two out-of-phase sines rather than one: a single sine reads as machinery
    // pulsing, which is exactly what a pre-industrial stone furnace must not do.
    const flicker = s.burning
      ? 0.86 + 0.10 * Math.sin(this.t * 11.3) + 0.06 * Math.sin(this.t * 26.7 + 1.7)
      : 1;
    const k = this.level * flicker;
    const c = s.burning ? FIRE : EMBER;
    for (const m of this.mats) {
      m.emissive.copy(c);
      m.emissiveIntensity = k * 2.6;
      m.color.copy(c).multiplyScalar(0.12 + 0.5 * k);
    }
    if (this.card !== null) this.card.scale.setScalar(Math.max(0.001, k * (1 + 0.09 * flicker)));
  }
}

const PUFFS = 72;

/**
 * One shared smoke column system for every placed machine: one BatchedMesh, one
 * draw call, no shader (DW-10). Puffs integrate in the BODY frame and re-derive
 * engine space per frame, for the same reason the debris does.
 */
export class Smoke {
  readonly mesh: THREE.BatchedMesh;
  private readonly px = new Float64Array(PUFFS);
  private readonly py = new Float64Array(PUFFS);
  private readonly pz = new Float64Array(PUFFS);
  private readonly ux = new Float32Array(PUFFS);
  private readonly uy = new Float32Array(PUFFS);
  private readonly uz = new Float32Array(PUFFS);
  private readonly life = new Float32Array(PUFFS);
  private readonly span = new Float32Array(PUFFS);
  private readonly seed = new Float32Array(PUFFS);
  private readonly slot: number[] = [];
  private next = 0;
  live = 0;
  emitted = 0;

  private readonly m = new THREE.Matrix4();
  private readonly p = new THREE.Vector3();
  private readonly q = new THREE.Quaternion();
  private readonly s = new THREE.Vector3();
  private readonly tint = new THREE.Color();

  constructor() {
    const material = new THREE.MeshStandardMaterial({
      color: 0x9aa0a6, roughness: 1, metalness: 0,
      transparent: true, opacity: 0.34, depthWrite: false,
    });
    const g = new THREE.IcosahedronGeometry(0.22, 0);
    const verts = PUFFS * (g.getAttribute('position').count + 2);
    this.mesh = new THREE.BatchedMesh(PUFFS, verts, verts * 3, material);
    this.mesh.name = 'machineSmoke';
    this.mesh.frustumCulled = false;
    this.mesh.sortObjects = false;
    this.mesh.perObjectFrustumCulled = false;
    this.mesh.renderOrder = 2;
    const id = this.mesh.addGeometry(g);
    for (let i = 0; i < PUFFS; ++i) {
      this.slot.push(this.mesh.addInstance(id));
      this.mesh.setVisibleAt(this.slot[i], false);
    }
  }

  /** Emit one puff from a body-frame point rising along `up`. */
  emit(pos: { x: number; y: number; z: number },
       up: { x: number; y: number; z: number }): void {
    const i = this.next;
    this.next = (this.next + 1) % PUFFS;
    if (this.life[i] <= 0) this.live++;
    this.px[i] = pos.x; this.py[i] = pos.y; this.pz[i] = pos.z;
    this.ux[i] = up.x; this.uy[i] = up.y; this.uz[i] = up.z;
    this.span[i] = 2.1;
    this.life[i] = this.span[i];
    this.seed[i] = (this.emitted++ % 16) * 0.61;
    this.mesh.setVisibleAt(this.slot[i], true);
  }

  update(dt: number, origin: FloatingOrigin): void {
    // Idle costs nothing: an all-hidden BatchedMesh still issues its draw.
    this.mesh.visible = this.live > 0;
    if (this.live === 0) return;
    let alive = 0;
    for (let i = 0; i < PUFFS; ++i) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      if (this.life[i] <= 0) { this.mesh.setVisibleAt(this.slot[i], false); continue; }
      alive++;
      const age = this.span[i] - this.life[i];
      // Rises and slows, and drifts on a fixed lateral wobble so a column reads
      // as smoke rather than as a string of beads going straight up.
      const rise = 0.62 * dt * (1 - age / (this.span[i] * 1.9));
      this.px[i] += this.ux[i] * rise;
      this.py[i] += this.uy[i] * rise;
      this.pz[i] += this.uz[i] * rise;
      origin.toEngine({ x: this.px[i], y: this.py[i], z: this.pz[i] }, this.p);
      const w = Math.sin(age * 1.9 + this.seed[i]) * 0.09 * age;
      this.p.x += w; this.p.z += Math.cos(age * 1.6 + this.seed[i]) * 0.09 * age;
      const k = age / this.span[i];
      // Grow and thin out. Opacity is per material, so the fade is the scale
      // collapsing at the end plus a tint towards the sky.
      this.s.setScalar(k < 0.82 ? 0.35 + k * 1.5 : (1 - k) * 9.2);
      this.tint.setRGB(0.6 + k * 0.3, 0.62 + k * 0.3, 0.65 + k * 0.3);
      this.mesh.setColorAt(this.slot[i], this.tint);
      this.m.compose(this.p, this.q, this.s);
      this.mesh.setMatrixAt(this.slot[i], this.m);
    }
    this.live = alive;
  }
}
