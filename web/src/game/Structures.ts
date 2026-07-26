// BASE BUILDING: foundations, floors, walls and doors, placed on a metric site
// grid or freely, paid for out of the pack, and standing on the ground without
// ever touching it.
//
// DW-24 IS THE WHOLE SHAPE OF THIS SYSTEM. A structure RESTS on the terrain and
// never deforms it: placing a part writes nothing to the voxel layer. Ground too
// uneven under the footprint makes the ghost read INVALID, and the fix is for
// the player to level it with Q. That refusal is not a limitation to apologise
// for, it is the moment the terraforming tool is discovered, exactly as refusing
// a drill off an ore patch is what teaches a player what a deposit is (DW-25).
// So the reason string says the tool by name. The rules that enforce it live in
// StructurePlacement.ts; this file owns what EXISTS.
//
// THE COST IS /core's. `gameplay.h` §S.6 authors the four parts and their
// `CraftRecipe` costs as data and `HandCrafter::payInputs` spends them all or
// nothing. Nothing here decides what a wall is worth, so a rebalance is a header
// edit the headless suites already cover.
//
// WHAT A STRUCTURE IS NOT: it is not a `BuildKind`. A foundation never ticks,
// holds nothing, has no ports and draws no power, so it has no business in
// `automation.h`'s entity arrays. See gameplay.h §S.6 and GP-21.

import * as THREE from 'three';
import { orient } from './Grid.js';
import { STRUCTURE_KINDS, localOf, makeSite, measureModule,
  type Addr, type Site, type StructureKind, type StructureModule }
  from './StructureGrid.js';
import { StructureBodies, boundOf, leafProxy, proxiesOf,
  type LocalBox, type Solid } from './StructureBody.js';
import { loadGlb } from '../assets/Loaders.js';
import type { GameCore, StructureDef } from './GameCore.js';
import type { OfCoreModule } from '../sim/wasm/heap.js';
import type { Vec3d } from '../world/PlanetBody.js';

const FILES: Record<StructureKind, string> = {
  foundation: 'assets/structures/foundation.glb',
  floor: 'assets/structures/floor.glb',
  wall: 'assets/structures/wall.glb',
  door: 'assets/structures/door.glb',
};

/**
 * DW-24's numbers, and there are TWO of them because the two ways a part can sit
 * wrong on the ground are not the same failure.
 *
 * FLOAT is ground BELOW the part's base plane: a visible gap of daylight under a
 * hovering slab, which is the thing DW-24 is protecting against.
 *
 * The terrain is NOT what sets it. `probes/buildtol.js` samples 400 one-metre
 * footprints at four sites on the shipped world and the worst spread across a
 * deck's five footprint points is 0.0013 and 0.0069 m on two plains and 0.118
 * and 0.127 m on two slopes, so 0.13 m would carry every ordinary foundation.
 * What sets it is the coarsest thing that can MOVE the terrain. The levelling
 * tool edits whole 1 m voxel cells, so it has a dead band of half a cell inside
 * which it changes nothing at all: measured, one press of Q left 0 of 12 refused
 * cells buildable at a 0.22 m tolerance, and the residual over a levelled disc
 * is p05 -0.536 m, p50 +0.027 m, p95 +0.588 m. A tolerance tighter than that
 * dead band makes DW-24's own loop unclosable by construction, however good the
 * terrain is. 0.55 m is half a voxel plus a tenth, and it is a number about the
 * TOOL. It should come down the day the tool can fill less than a whole cell.
 *
 * BURY is ground ABOVE the base plane. It disappears INSIDE the slab and reads
 * as a pad set into the soil, which is what a foundation on real ground looks
 * like, so it costs nothing until the ground would break through the top face.
 * The bound is therefore the deck thickness itself, taken from the asset's own
 * `socket_top` rather than typed, and the constant here is only the fallback for
 * a module that failed to load.
 *
 * WHY ASYMMETRIC AND NOT ONE NUMBER. Measured (see the report): one press of Q
 * leaves the ground at the target plus or minus about half a metre, because the
 * terraforming tool moves whole 1 m voxel cells and cannot do better. A single
 * symmetric tolerance therefore has to be either tighter than the tool can hit,
 * which makes a levelled pad unbuildable, or looser than a slab is thick, which
 * makes a floating foundation legal. Splitting it takes the forgiving half of
 * the tool's residual for free and keeps the visible half tight.
 */
export const FLOAT_TOLERANCE_M = 0.55;

/** What a not-yet-placed free part is keyed by, until it has an id. */
export const FREE_KEY = 'free:0';
export const BURY_TOLERANCE_FALLBACK_M = 0.50;

export interface StructurePart {
  id: number;
  kind: StructureKind;
  def: StructureDef;
  siteId: number;
  addr: Addr | null;
  key: string;
  pos: Vec3d;
  up: THREE.Vector3;
  fwd: THREE.Vector3;
  quat: THREE.Quaternion;
  /** Doors: 0 shut, 1 fully swung. Everything else stays 0. */
  swing: number;
  wantOpen: boolean;
  solid: Solid;
}

export class Structures {
  readonly bodies = new StructureBodies();
  readonly parts: StructurePart[] = [];
  readonly sites: Site[] = [];
  /** Loaded roots, kept so the view and the module measurement share one parse. */
  readonly scenes = new Map<StructureKind, THREE.Object3D>();
  module: StructureModule = { cellM: 1, deckH: 0.5, wallH: 2.5, wallT: 0.25, storey: 3 };
  /** The authored swing, read off the shipped clip rather than retyped. */
  swingSecs = 0.4167;
  swingRad = -95 * Math.PI / 180;
  placements = 0;
  refusals = 0;
  removals = 0;
  /** Refusals attributable to DW-24, the number that says the loop works. */
  unevenRefusals = 0;
  private defs: StructureDef[] = [];
  private readonly boxes = new Map<StructureKind, LocalBox[]>();
  private readonly taken = new Map<string, StructurePart>();
  private nextId = 1;
  private nextSite = 1;

  constructor(private readonly M: OfCoreModule, private readonly core: GameCore,
              private readonly body: number,
              private readonly edits: () => number) {}

  async load(): Promise<void> {
    await Promise.all(STRUCTURE_KINDS.map(async (k) => {
      const g = await loadGlb(FILES[k]);
      this.scenes.set(k, g.scene);
      if (k === 'door') this.readSwing(g.animations);
    }));
    this.module = measureModule(this.scenes);
    for (const k of STRUCTURE_KINDS) {
      const root = this.scenes.get(k);
      if (root === undefined) continue;
      const list = proxiesOf(root);
      if (k === 'door') {
        const leaf = leafProxy(root);
        if (leaf !== null) list.push(leaf);
      }
      this.boxes.set(k, list);
    }
    this.defs = this.core.structures();
  }

  /**
   * The swing, taken from `Door_Swing` itself. The clip is never PLAYED (DW-8:
   * no AnimationMixer anywhere in this project), but its last keyframe and its
   * duration ARE the authored motion, and reading them means a change in Blender
   * moves the door in the browser with no code edit.
   */
  private readSwing(clips: readonly THREE.AnimationClip[]): void {
    const clip = clips.find((c) => c.name === 'Door_Swing');
    if (clip === undefined) return;
    this.swingSecs = clip.duration;
    const track = clip.tracks.find((t) => t.name.endsWith('.quaternion'));
    if (track === undefined || track.values.length < 4) return;
    const n = track.values.length;
    const q = new THREE.Quaternion(track.values[n - 4], track.values[n - 3],
      track.values[n - 2], track.values[n - 1]);
    this.swingRad = new THREE.Euler().setFromQuaternion(q, 'YXZ').y;
  }

  // --- what the placement rules ask of this file ----------------------------

  get ready(): boolean { return this.defs.length === STRUCTURE_KINDS.length; }
  /** How far a corner may HANG, and how far the ground may rise into the slab. */
  get floatToleranceM(): number { return FLOAT_TOLERANCE_M; }
  get buryToleranceM(): number {
    return this.module.deckH > 0 ? this.module.deckH : BURY_TOLERANCE_FALLBACK_M;
  }

  defFor(kind: StructureKind): StructureDef | null {
    return this.defs[STRUCTURE_KINDS.indexOf(kind)] ?? null;
  }

  /** The cost as a sentence, so a refusal can say exactly what is missing. */
  costText(kind: StructureKind): string {
    const d = this.defFor(kind);
    if (d === null) return '';
    return d.cost.map((c) => `${c.count} ${this.core.itemName(c.item)}`).join(' + ');
  }

  canAfford(kind: StructureKind): boolean {
    const d = this.defFor(kind);
    return d !== null && this.core.structureAfford(d.index);
  }

  has(key: string): boolean { return this.taken.has(key); }
  partAt(key: string): StructurePart | undefined { return this.taken.get(key); }

  /** THE surface, asked of the oracle with the LIVE edits handle, so a pad the
   *  player just flattened with Q reads as flat on the very next tick. */
  groundRadius(x: number, y: number, z: number): number {
    const r = Math.hypot(x, y, z) || 1;
    return this.M._of_surface_radius(this.body, this.edits(), x / r, y / r, z / r);
  }

  /** Site-local (east, north, up) metres of a body-frame point. The probe's
   *  eyes: "did the player get past the wall line" is a coordinate, not a vibe. */
  localIn(siteId: number, p: Vec3d): [number, number, number] | null {
    const s = this.sites.find((q) => q.id === siteId);
    if (s === undefined) return null;
    const l = localOf(s, p, new THREE.Vector3());
    return [l.x, l.y, l.z];
  }

  /** A site founded on the world lattice cell containing `p`, not yet adopted. */
  prospectiveSite(p: Vec3d): Site {
    return makeSite(this.M, this.body, this.nextSite, p, this.module,
      (x, y, z) => this.groundRadius(x, y, z));
  }

  // --- the world ------------------------------------------------------------

  /**
   * Bring a part into the world with its transform already decided. Both a
   * placement and a restore land here, so a loaded base and a built one are the
   * same objects and cannot diverge.
   */
  adopt(kind: StructureKind, def: StructureDef, siteId: number,
        addr: Addr | null, key: string, pos: Vec3d, up: THREE.Vector3,
        fwd: THREE.Vector3): StructurePart {
    const boxes = this.boxes.get(kind) ?? [];
    const id = this.nextId++;
    const quat = orient(up, fwd);
    const solid: Solid = {
      id, pos, quat, boxes, cx: pos.x, cy: pos.y, cz: pos.z,
      cr: boundOf(boxes), shut: true,
    };
    const p: StructurePart = {
      id, kind, def, siteId, addr,
      // A FREE part has no address to be keyed by, so it takes its own id. The
      // placeholder is re-keyed and an already-keyed one is not, or a restore
      // would rename every free part and a save would stop matching itself.
      key: key === FREE_KEY ? `free:${id}` : key,
      pos, up: up.clone(), fwd: fwd.clone(), quat, swing: 0, wantOpen: false, solid,
    };
    this.parts.push(p);
    this.taken.set(p.key, p);
    this.bodies.add(solid);
    return p;
  }

  /** Spend a part's cost. All or nothing, and /core decides. */
  pay(kind: StructureKind): boolean {
    const d = this.defFor(kind);
    return d !== null && this.core.structurePay(d.index);
  }

  /** Take a site as-is (a restore). A placement founds one through makeSite. */
  adoptSite(site: Site): void {
    if (this.sites.some((s) => s.id === site.id)) return;
    this.sites.push(site);
    this.nextSite = Math.max(this.nextSite, site.id + 1);
  }

  /** Throw the whole base away. The pack is NOT credited: a restore replaces a
   *  world rather than demolishing one, and refunding here would mint items. */
  reset(): void {
    this.parts.length = 0;
    this.sites.length = 0;
    this.taken.clear();
    this.bodies.clear();
  }

  /** Pull a part back up. The cost comes back, because the player paid it. */
  remove(p: StructurePart): { refunded: { item: number; count: number }[] } | null {
    const at = this.parts.indexOf(p);
    if (at < 0) return null;
    this.parts.splice(at, 1);
    this.taken.delete(p.key);
    this.bodies.remove((s) => s.id === p.id);
    const back: { item: number; count: number }[] = [];
    for (const c of p.def.cost) {
      const over = this.core.add(c.item, c.count);
      if (c.count - over > 0) back.push({ item: c.item, count: c.count - over });
    }
    this.removals++;
    return { refunded: back };
  }

  /** The part an aim ray enters, within reach. */
  pick(o: Vec3d, d: Vec3d, reachM: number): StructurePart | null {
    const hit = this.bodies.rayPick(o, d, reachM, 0.2);
    if (hit === null) return null;
    return this.parts.find((p) => p.id === hit.solid.id) ?? null;
  }

  /** Doors only. Returns the new intent, or null when it is not a door. */
  toggle(p: StructurePart): boolean | null {
    if (p.kind !== 'door') return null;
    p.wantOpen = !p.wantOpen;
    return p.wantOpen;
  }

  /**
   * Advance the door swings. A shut door blocks its own opening and an open one
   * does not, which is the only honest thing a kinematic walker can do with a
   * moving panel (DW-12: no physics engine, so no swinging collider). The
   * threshold is half the swing, so the doorway opens at the moment it visibly
   * reads as open.
   */
  step(dt: number): void {
    const rate = dt / Math.max(1e-3, this.swingSecs);
    for (const p of this.parts) {
      if (p.kind !== 'door') continue;
      const want = p.wantOpen ? 1 : 0;
      if (p.swing === want) continue;
      p.swing = want > p.swing ? Math.min(want, p.swing + rate)
        : Math.max(want, p.swing - rate);
      p.solid.shut = p.swing < 0.5;
    }
  }
}
