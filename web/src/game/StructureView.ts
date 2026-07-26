// The base, drawn. One BatchedMesh for every structural part in the world, and
// one ghost.
//
// DW-11: `BatchedMesh` is the default container, and a base is the case that
// makes it matter. A 10 x 10 platform with a perimeter is 140 parts; as
// individual meshes that is 140 draws plus 420 shadow-cascade draws, which would
// eat the whole 150 budget on its own. Here it is ONE draw plus its cascades,
// however big the base gets, because `MachineBatch` already solved exactly this
// problem for the factory and a second solution would be a second thing to keep
// correct. The only reason structures get their own batch instance rather than
// sharing the factory's is capacity: they are an order of magnitude more
// numerous, and one `BatchedMesh` sizes its vertex pool at construction.
//
// THE DOOR IS TWO INSTANCES, and this is the one place a structure needs a
// second one. The frame goes in as `Door_LOD0`; the LEAF goes in separately and
// its transform is the part's transform composed with the hinge offset and the
// swing angle. There is still no `AnimationMixer` anywhere (DW-8): the authored
// `Door_Swing` clip supplies the angle and the duration, and the motion is one
// matrix per open door per frame.

import * as THREE from 'three';
import { MachineBatch } from './MachineBatch.js';
import { STRUCTURE_KINDS, type StructureKind } from './StructureGrid.js';
import type { Structures, StructurePart } from './Structures.js';
import type { StructureTarget } from './StructurePlacement.js';
import type { FloatingOrigin } from '../world/FloatingOrigin.js';

/**
 * Instances to START with. A part is one, a door is two, so this covers about
 * 250 parts before the pool doubles itself.
 *
 * It used to be a hard cap with no growth path, exactly like the factory's 256,
 * and it had simply not been reached: the packaging spike drew 484 parts fine
 * and would have hit this at 512 with every budget indicator still green. Fixed
 * with the factory's rather than after it bit, because the failure mode is
 * invisible by construction (MachineBatch's header).
 */
const CAPACITY = 512;
/** The leaf's own batch key. It is not a placeable part, it is half of one. */
const LEAF = 'door_leaf';

export class StructureView {
  readonly group = new THREE.Group();
  readonly batch = new MachineBatch(CAPACITY, 'structures');
  private ghost: THREE.Mesh | null = null;
  private readonly ghostMat: THREE.MeshBasicMaterial;
  private readonly slots = new Map<number, number>();
  private readonly leafSlots = new Map<number, number>();
  private hinge = new THREE.Vector3();
  private readonly p = new THREE.Vector3();
  private readonly m = new THREE.Matrix4();
  private readonly swing = new THREE.Matrix4();
  private readonly one = new THREE.Vector3(1, 1, 1);

  constructor(private readonly origin: FloatingOrigin) {
    this.group.name = 'structures';
    this.group.add(this.batch.group);
    this.ghostMat = new THREE.MeshBasicMaterial({
      color: 0x63d0ff, transparent: true, opacity: 0.35, depthWrite: false,
      side: THREE.DoubleSide,
    });
  }

  /**
   * Build the batch from roots Structures has already parsed. The four files are
   * loaded once, by Structures, because the module constants are measured off
   * the same node hierarchy the geometry comes from and two parses could drift.
   */
  build(s: Structures): void {
    const templates = new Map<string, { def: { url: string; root: string };
      scene: THREE.Object3D }>();
    for (const k of STRUCTURE_KINDS) {
      const root = s.scenes.get(k);
      if (root === undefined) continue;
      templates.set(k, { def: { url: k, root: k }, scene: root });
      if (k !== 'door') continue;
      const leaf = root.getObjectByName('Door_Leaf');
      const h = root.getObjectByName('door_hinge');
      if (leaf === undefined || h === undefined) continue;
      this.hinge.copy(h.position);
      // The leaf is a CHILD of the hinge and identity within it, so a clone at
      // identity is already the geometry in hinge space. Its meshes are RENAMED
      // because MachineBatch takes only `*_LOD0` nodes, which is the convention
      // that keeps the LOD1 and LOD2 copies out of the batch, and because a
      // three-material mesh arrives as a Group of primitives.
      const clone = leaf.clone(true);
      clone.position.set(0, 0, 0);
      clone.quaternion.identity();
      let n = 0;
      clone.traverse((o) => {
        if ((o as THREE.Mesh).isMesh === true) o.name = `DoorLeaf_LOD0_${n++}`;
      });
      const holder = new THREE.Group();
      holder.add(clone);
      templates.set(LEAF, { def: { url: LEAF, root: LEAF }, scene: holder });
    }
    this.batch.build(templates);
    this.ghost = new THREE.Mesh(new THREE.BufferGeometry(), this.ghostMat);
    this.ghost.name = 'structureGhost';
    this.ghost.frustumCulled = false;
    this.ghost.visible = false;
    this.ghost.renderOrder = 3;
    this.group.add(this.ghost);
  }

  /** One pass over the parts: place every instance, swing every door. */
  sync(s: Structures): void {
    for (const part of s.parts) {
      let slot = this.slots.get(part.id);
      if (slot === undefined) {
        slot = this.batch.acquire(part.kind);
        if (slot < 0) continue;
        this.slots.set(part.id, slot);
      }
      this.origin.toEngine(part.pos, this.p);
      this.m.compose(this.p, part.quat, this.one);
      this.batch.place(slot, this.m);
      // Structures carry no simulation state, so the fx texel is a flat zero and
      // the batch draws them as plain lit geometry.
      this.batch.setFx(slot, { flow: 0, density: 0, state: 3, level: 0 });
      if (part.kind === 'door') this.syncLeaf(part, s.swingRad);
    }
    this.batch.flush();
  }

  private syncLeaf(part: StructurePart, swingRad: number): void {
    let slot = this.leafSlots.get(part.id);
    if (slot === undefined) {
      slot = this.batch.acquire(LEAF);
      if (slot < 0) return;
      this.leafSlots.set(part.id, slot);
    }
    this.origin.toEngine(part.pos, this.p);
    this.m.compose(this.p, part.quat, this.one);
    this.swing.makeRotationY(part.swing * swingRad);
    this.swing.setPosition(this.hinge.x, this.hinge.y, this.hinge.z);
    this.m.multiply(this.swing);
    this.batch.place(slot, this.m);
    this.batch.setFx(slot, { flow: 0, density: 0, state: 3, level: 0 });
  }

  /** Drop a demolished part's instances, or it keeps drawing where it stood. */
  release(id: number): void {
    const slot = this.slots.get(id);
    if (slot !== undefined) { this.batch.release(slot); this.slots.delete(id); }
    const leaf = this.leafSlots.get(id);
    if (leaf !== undefined) { this.batch.release(leaf); this.leafSlots.delete(id); }
  }

  /**
   * The placement preview. Red with a reason before the key is pressed, never an
   * error message after it: an invalid ghost is how DW-24's levelling loop is
   * discovered, so it has to be visible while the player is still aiming.
   */
  showGhost(t: StructureTarget): void {
    if (this.ghost === null) return;
    const g = this.batch.geometryFor(t.kind);
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

  /** Geometry keys the batch knows, so a probe can assert the door split. */
  get keys(): string[] { return [...STRUCTURE_KINDS, LEAF]; }

  stats(): unknown {
    return { ...this.batch.stats(), ghost: this.ghostVisible,
      doors: this.leafSlots.size,
      hinge: [this.hinge.x, this.hinge.y, this.hinge.z] };
  }
}

/** Which parts a save has to draw again after a restore. */
export function redraw(view: StructureView, parts: readonly StructurePart[]): number {
  for (const p of parts) view.release(p.id);
  return parts.length;
}

/** A kind's merged LOD0 geometry, for a probe to measure the module off. */
export function geometryBoundsOf(view: StructureView, kind: StructureKind):
[number, number, number] | null {
  const g = view.batch.geometryFor(kind);
  if (g === null) return null;
  g.computeBoundingBox();
  const b = g.boundingBox;
  return b === null ? null
    : [b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z];
}
