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

//
// THE PILLAR IS DRAWN HERE AND PLACED NOWHERE. It is not a `StructureKind`, it
// has no cost and no save row; it is what a deck standing clear of the ground
// looks like. StructureGrid.ts holds the recipe and the argument. It shares this
// batch rather than taking a pool of its own, so it inherits FS-16's growth and
// the HUD's `POOL FULL: n NOT DRAWN` line for free (DW-28) instead of needing a
// second copy of both.

import * as THREE from 'three';
import { MachineBatch } from './MachineBatch.js';
import { PILLAR_PARTS, STRUCTURE_KINDS, isDeck, pillarPartsFor,
  type PillarPart, type StructureKind } from './StructureGrid.js';
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
/** A pillar piece's batch key. Namespaced, so it can never collide with a kind. */
const pillarKey = (p: PillarPart): string => `pillar:${p}`;
/** Past this a single pillar reads as a thin stick (build_pillar.py). It is a
 *  READABILITY limit and not a legality one, so it is counted, not enforced. */
const PILLAR_TALL_M = 10;
/** Structures carry no simulation state, so every instance gets a flat texel. */
const FLAT = { flow: 0, density: 0, state: 3, level: 0 };

/** One deck's solved pillar: the recipe, the slots it holds, and the gap it
 *  spans. Solved on demand and redrawn every frame, because a floating-origin
 *  rebase moves every matrix in the batch. */
interface PillarDraw {
  gap: number;
  items: { part: PillarPart; z: number; scaleY: number }[];
  slots: number[];
}

export class StructureView {
  readonly group = new THREE.Group();
  readonly batch = new MachineBatch(CAPACITY, 'structures');
  private ghost: THREE.Mesh | null = null;
  private readonly ghostMat: THREE.MeshBasicMaterial;
  private readonly slots = new Map<number, number>();
  private readonly leafSlots = new Map<number, number>();
  private readonly pillars = new Map<number, PillarDraw>();
  /** Set whenever the part set or the ground under it may have moved. */
  private pillarsDirty = true;
  private lastParts = -1;
  /** Pillars past the readability limit. Published rather than clamped. */
  private tallPillars = 0;
  private hinge = new THREE.Vector3();
  private readonly p = new THREE.Vector3();
  private readonly q = new THREE.Vector3();
  private readonly axis = new THREE.Vector3();
  private readonly scale = new THREE.Vector3();
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
    // The four pillar pieces, each its own template because each is placed and
    // scaled independently. They come out of the file's own part groups, which
    // all sit on the origin ground-pivoted, so the merged geometry needs no
    // offset and `scale.y` on the shaft is its length in metres.
    for (const name of PILLAR_PARTS) {
      const node = s.pillarScene?.getObjectByName(name);
      if (node === undefined || node === null) continue;
      templates.set(pillarKey(name),
        { def: { url: pillarKey(name), root: name }, scene: node });
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
      this.batch.setFx(slot, FLAT);
      if (part.kind === 'door') this.syncLeaf(part, s.swingRad);
    }
    this.syncPillars(s);
    this.batch.flush();
  }

  /**
   * Solve the pillars when the base changed, then redraw them every frame.
   *
   * Split that way because the two halves cost different things: solving one
   * asks the surface oracle and marches the solid set, redrawing one is four
   * matrix composes, and a floating-origin rebase invalidates the second
   * without touching the first.
   */
  private syncPillars(s: Structures): void {
    if (this.pillarsDirty || s.parts.length !== this.lastParts) {
      this.solvePillars(s);
      this.lastParts = s.parts.length;
      this.pillarsDirty = false;
    }
    for (const part of s.parts) {
      const d = this.pillars.get(part.id);
      if (d === undefined) continue;
      this.origin.toEngine(part.pos, this.p);
      this.axis.set(0, 1, 0).applyQuaternion(part.quat);
      for (let i = 0; i < d.items.length; ++i) {
        const it = d.items[i];
        // The pieces hang DOWN from the deck's own base plane along the deck's
        // own up axis, so the bracket meets the underside EXACTLY and whatever
        // is left between "radially down" and "along the site up" is spent at
        // the foot, where a splayed base plate on soil hides it.
        this.q.copy(this.p).addScaledVector(this.axis, it.z - d.gap);
        this.m.compose(this.q, part.quat, this.scale.set(1, it.scaleY, 1));
        this.batch.place(d.slots[i], this.m);
        this.batch.setFx(d.slots[i], FLAT);
      }
    }
  }

  /** Which decks need a pillar, and how tall. See StructureGrid for the rule. */
  private solvePillars(s: Structures): void {
    for (const d of this.pillars.values()) for (const slot of d.slots) this.batch.release(slot);
    this.pillars.clear();
    this.tallPillars = 0;
    for (const part of s.parts) {
      if (!isDeck(part.kind)) continue;
      const gap = this.gapUnder(s, part);
      const items = pillarPartsFor(gap, s.pillar);
      if (items.length === 0) continue;
      const slots = items.map((it) => this.batch.acquire(pillarKey(it.part)));
      // A refused slot is already counted and shouted by the pool itself, but a
      // HALF-drawn pillar is worse than none, so the whole assembly is dropped.
      if (slots.some((n) => n < 0)) {
        for (const n of slots) if (n >= 0) this.batch.release(n);
        continue;
      }
      if (gap > PILLAR_TALL_M) this.tallPillars++;
      this.pillars.set(part.id, { gap, items, slots });
    }
  }

  /**
   * The clear height under a deck's centre, or 0 when it needs no pillar.
   *
   * Zero in two cases, and the second is the one that matters: the deck is
   * close enough to the ground, OR something structural already carries it. A
   * pillar driven down through the storey below is worse than no pillar, and an
   * upper floor over a foundation is the normal case, not an edge one.
   */
  private gapUnder(s: Structures, part: StructurePart): number {
    const r = Math.hypot(part.pos.x, part.pos.y, part.pos.z) || 1;
    const gap = r - s.groundRadius(part.pos.x, part.pos.y, part.pos.z);
    if (gap < s.pillar.minH) return 0;
    // No rise allowance at all here, unlike the walker's call: this asks what is
    // UNDER a deck, and a lift of even a centimetre would let the part find its
    // own top face and report itself as its own support.
    const under = s.bodies.deckUnder(part.pos.x / r, part.pos.y / r,
      part.pos.z / r, r - 0.05, gap, 0);
    return under === null ? gap : 0;
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
    this.batch.setFx(slot, FLAT);
  }

  /** Drop a demolished part's instances, or it keeps drawing where it stood. */
  release(id: number): void {
    const slot = this.slots.get(id);
    if (slot !== undefined) { this.batch.release(slot); this.slots.delete(id); }
    const leaf = this.leafSlots.get(id);
    if (leaf !== undefined) { this.batch.release(leaf); this.leafSlots.delete(id); }
    // Pulling ONE deck up can change what carries its neighbours, so the whole
    // set is re-solved rather than this part's pillar simply dropped.
    this.pillarsDirty = true;
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

  /**
   * GP-288. The ghost's world size and its distance from the eye, measured off
   * the mesh the renderer is holding rather than off the target that was asked
   * for. Null when nothing is being previewed.
   *
   * Engine space IS the eye's neighbourhood under a floating origin, so
   * `|centre|` is the distance a player is standing from the preview, and a
   * 4 m foundation two metres away and a 4 m foundation sitting on the camera
   * differ in exactly that number.
   */
  ghostBox(): unknown {
    const o = this.ghost;
    if (o === null || !o.visible || o.geometry === null) return null;
    const g = o.geometry;
    if (g.getAttribute('position') === undefined) return null;
    g.computeBoundingBox();
    const bb = g.boundingBox;
    if (bb === null) return null;
    const box = bb.clone().applyMatrix4(o.matrixWorld);
    const size = new THREE.Vector3();
    const c = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(c);
    // NEAREST FACE, not just the centre, and whether the box CONTAINS the eye.
    // A building centred a few metres ahead can still have its near edge behind
    // the player if it is wide enough, and `DoubleSide` means the inside faces
    // then fill the viewport. Only these two numbers can say so.
    const near = Math.max(0, c.length() - 0.5 * size.length());
    return {
      sizeM: [+size.x.toFixed(3), +size.y.toFixed(3), +size.z.toFixed(3)],
      centreEngine: [+c.x.toFixed(3), +c.y.toFixed(3), +c.z.toFixed(3)],
      distM: +c.length().toFixed(3),
      nearestM: +near.toFixed(3),
      encloses: box.containsPoint(new THREE.Vector3(0, 0, 0)),
      scale: [o.scale.x, o.scale.y, o.scale.z],
    };
  }

  /** Geometry keys the batch knows, so a probe can assert the door split. */
  get keys(): string[] {
    return [...STRUCTURE_KINDS, LEAF, ...PILLAR_PARTS.map(pillarKey)];
  }

  stats(): unknown {
    let pieces = 0;
    let tallest = 0;
    for (const d of this.pillars.values()) {
      pieces += d.slots.length;
      tallest = Math.max(tallest, d.gap);
    }
    return { ...this.batch.stats(), ghost: this.ghostVisible,
      // GP-288. WHAT THE GHOST ACTUALLY IS, not just whether it is on. Reid
      // reported the placement preview filling the screen instead of sitting
      // on the ground, and `ghost: true` cannot tell an enormous mesh from one
      // sitting on top of the camera, which are different bugs with different
      // fixes. `sizeM` is the world-space bounding box of the geometry the
      // renderer is using and `distM` is how far its centre is from the eye in
      // engine space, which under a floating origin is the eye's own frame.
      ghostBox: this.ghostBox(),
      doors: this.leafSlots.size,
      // DW-32. `tall` is the count past the art lane's 10 m readability limit:
      // the pillar is still drawn, because a clamped one would float and a
      // missing one would leave the deck hanging, and both are the failure the
      // pillar exists to prevent. Counting it is how the limit stays honest.
      pillars: { decks: this.pillars.size, pieces, tall: this.tallPillars,
        tallestM: +tallest.toFixed(3), limitM: PILLAR_TALL_M },
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
