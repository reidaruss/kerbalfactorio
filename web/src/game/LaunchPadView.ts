// THE PAD, DRAWN, AND THE CLAMPS THAT MOVE ON IT.
//
// A pad is NINE instances of ONE batch: the body, four static clamp columns and
// four arms. That is deliberate and it took a reversal to get right. The first
// reading was that a pad could not be a `BatchedMesh` instance because the
// `Clamp_Release` clip moves `clamp_pivot` relative to the pad and an instance
// is one matrix. That is exactly backwards: an arm needs its OWN matrix, and a
// batched instance is precisely a matrix. So the arms are instances too, and the
// whole pad is one draw call plus its shadow cascades however many pads stand.
//
// It gets its own `MachineBatch` rather than joining the structural one, for the
// reason StructureView gives for not joining the factory's: a pool is sized at
// build time from the SUM of its templates, and the pad body is 2,564 triangles
// against a foundation's few hundred, so sharing would grow the structural
// vertex buffer in every world whether or not a pad is ever built.
//
// DW-8: THERE IS STILL NO `AnimationMixer`. The clip supplies the angle, the
// retraction and the duration (`measurePad` reads them off the shipped keys) and
// the motion is four matrix composes per releasing pad per frame. The same
// argument, and the same shape, as the door's swing.

import * as THREE from 'three';
import { MachineBatch } from './MachineBatch.js';
import { clampMatrix, type LaunchPads, type PadPart } from './LaunchPad.js';
import type { PadTarget } from './LaunchPadPlacement.js';
import type { FloatingOrigin } from '../world/FloatingOrigin.js';

/** Nine instances a pad, so this is seven pads before the pool doubles itself.
 *  `MachineBatch` grows and shouts when it cannot (FS-16), so the number is a
 *  starting size and not a ceiling. */
const CAPACITY = 64;

const BODY = 'pad_body';
const COLUMN = 'pad_clamp';
const ARM = 'pad_arm';

/** The pad carries no simulation state, so every instance gets a flat texel. */
const FLAT = { flow: 0, density: 0, state: 3, level: 0 };

/** The arm mesh has no `_LOD0` suffix (it is `LaunchClamp_Arm`, one level), so
 *  the batch's default LOD0 filter would take nothing. Named explicitly, which
 *  is what `MachineTemplate.nodeMatch` exists for. */
const ARM_MATCH = /^LaunchClamp_Arm(?:_\d+)?$/;

interface PadSlots { body: number; columns: number[]; arms: number[] }

export class LaunchPadView {
  readonly group = new THREE.Group();
  readonly batch = new MachineBatch(CAPACITY, 'launchpads');
  private ghost: THREE.Mesh | null = null;
  private readonly ghostMat: THREE.MeshBasicMaterial;
  private readonly slots = new Map<number, PadSlots>();
  private readonly p = new THREE.Vector3();
  private readonly pad = new THREE.Matrix4();
  private readonly local = new THREE.Matrix4();
  private readonly m = new THREE.Matrix4();
  private readonly one = new THREE.Vector3(1, 1, 1);

  constructor(private readonly origin: FloatingOrigin) {
    this.group.name = 'launchpads';
    this.group.add(this.batch.group);
    this.ghostMat = new THREE.MeshBasicMaterial({
      color: 0x63d0ff, transparent: true, opacity: 0.3, depthWrite: false,
      side: THREE.DoubleSide,
    });
  }

  /**
   * Build the three templates from the root `LaunchPads` already parsed.
   *
   * The body template deliberately takes the WHOLE scene's `_LOD0` meshes minus
   * the clamp's, because `LaunchClamp_LOD0` is the clamp column authored at the
   * file origin: leaving it in the body would draw a fifth clamp standing in the
   * middle of the launch mount, where the rocket goes.
   */
  build(pads: LaunchPads): void {
    const root = pads.scene;
    if (root === null) return;
    const clampCol = root.getObjectByName('LaunchClamp_LOD0');
    const arm = root.getObjectByName('LaunchClamp_Arm');
    const body = new THREE.Group();
    root.updateWorldMatrix(true, true);
    for (const c of [...root.children]) {
      if (c === clampCol || c.name === 'clamp_pivot') continue;
      body.add(c.clone(true));
    }
    const templates = new Map<string, { def: { url: string; root: string;
      nodeMatch?: RegExp }; scene: THREE.Object3D }>();
    templates.set(BODY, { def: { url: BODY, root: BODY }, scene: body });
    if (clampCol !== undefined) {
      templates.set(COLUMN, { def: { url: COLUMN, root: COLUMN },
        scene: wrap(clampCol) });
    }
    if (arm !== undefined) {
      // PIVOT-LOCAL, exactly as the door leaf is hinge-local: the arm is a child
      // of `clamp_pivot` at identity, so a clone at identity IS the geometry in
      // the pivot's frame, and the pivot's own offset then lives in the matrix
      // the animation drives rather than being baked into the vertices.
      const clone = arm.clone(true);
      clone.position.set(0, 0, 0);
      clone.quaternion.identity();
      templates.set(ARM, { def: { url: ARM, root: ARM, nodeMatch: ARM_MATCH },
        scene: wrap(clone) });
    }
    this.batch.build(templates);
    this.ghost = new THREE.Mesh(new THREE.BufferGeometry(), this.ghostMat);
    this.ghost.name = 'launchPadGhost';
    this.ghost.frustumCulled = false;
    this.ghost.visible = false;
    this.ghost.renderOrder = 3;
    this.group.add(this.ghost);
  }

  /** One pass: place every pad and swing every clamp. */
  sync(pads: LaunchPads): void {
    for (const part of pads.list) {
      let s = this.slots.get(part.id);
      if (s === undefined) {
        const got = this.acquire(pads);
        if (got === null) continue;
        s = got;
        this.slots.set(part.id, s);
      }
      this.origin.toEngine(part.pos, this.p);
      this.pad.compose(this.p, part.quat, this.one);
      if (s.body >= 0) {
        this.batch.place(s.body, this.pad);
        this.batch.setFx(s.body, FLAT);
      }
      this.placeClamps(pads, part, s);
    }
    this.batch.flush();
  }

  /**
   * The four columns stand still and the four arms swing.
   *
   * The column takes `t = 0` for ever, which is not a special case: it is the
   * SAME `clampMatrix` at the holding pose, so a column and its arm can never
   * disagree about where the clamp is, however the fan-out is re-authored.
   */
  private placeClamps(pads: LaunchPads, part: PadPart, s: PadSlots): void {
    const m = pads.module;
    for (let k = 0; k < s.columns.length; ++k) {
      clampMatrix(k, m, 0, this.local);
      this.m.multiplyMatrices(this.pad, this.local);
      this.batch.place(s.columns[k], this.m);
      this.batch.setFx(s.columns[k], FLAT);
    }
    for (let k = 0; k < s.arms.length; ++k) {
      clampMatrix(k, m, part.clampT, this.local);
      this.m.multiplyMatrices(this.pad, this.local);
      this.batch.place(s.arms[k], this.m);
      this.batch.setFx(s.arms[k], FLAT);
    }
  }

  private acquire(pads: LaunchPads): PadSlots | null {
    const body = this.batch.acquire(BODY);
    if (body < 0) return null;
    const columns: number[] = [];
    const arms: number[] = [];
    for (let k = 0; k < pads.module.clamps; ++k) {
      const c = this.batch.acquire(COLUMN);
      const a = this.batch.acquire(ARM);
      if (c >= 0) columns.push(c);
      if (a >= 0) arms.push(a);
    }
    return { body, columns, arms };
  }

  /** Drop a demolished pad's instances, or it keeps drawing where it stood. */
  release(id: number): void {
    const s = this.slots.get(id);
    if (s === undefined) return;
    if (s.body >= 0) this.batch.release(s.body);
    for (const n of s.columns) this.batch.release(n);
    for (const n of s.arms) this.batch.release(n);
    this.slots.delete(id);
  }

  showGhost(t: PadTarget): void {
    if (this.ghost === null) return;
    const g = this.batch.geometryFor(BODY);
    if (g === null) { this.ghost.visible = false; return; }
    this.ghost.geometry = g;
    this.origin.toEngine(t.pos, this.p);
    this.ghost.position.copy(this.p);
    this.ghost.quaternion.copy(t.quat);
    this.ghostMat.color.setHex(t.ok ? 0x63d0ff : 0xff5a44);
    this.ghost.visible = true;
    this.ghost.updateMatrixWorld(true);
  }

  hideGhost(): void { if (this.ghost !== null) this.ghost.visible = false; }
  get ghostVisible(): boolean { return this.ghost?.visible ?? false; }

  stats(): unknown {
    return { ...this.batch.stats(), ghost: this.ghostVisible,
      pads: this.slots.size, keys: [BODY, COLUMN, ARM] };
  }
}

/** A node in a holder at identity, which is the shape `MachineBatch.build`
 *  traverses. Cloned so the source scene, which is also the measurement's, is
 *  never re-parented out from under it. */
function wrap(node: THREE.Object3D): THREE.Object3D {
  const holder = new THREE.Group();
  const clone = node.clone(true);
  clone.position.set(0, 0, 0);
  clone.quaternion.identity();
  clone.scale.set(1, 1, 1);
  holder.add(clone);
  return holder;
}

/** Which pads a save has to draw again after a restore. */
export function redrawPads(view: LaunchPadView,
                           parts: readonly PadPart[]): number {
  for (const p of parts) view.release(p.id);
  return parts.length;
}
