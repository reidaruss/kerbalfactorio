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
import { costText } from './CostText.js';
import { BURY_TOLERANCE_FALLBACK_M, CANTILEVER_STOREYS, FLOAT_TOLERANCE_M }
  from './StructureTolerance.js';
import { readSockets, type SocketDef } from './StructureSnap.js';
import { orient } from './Grid.js';
import { MAX_LEVEL, PILLAR_FALLBACK, SITE_REACH_M, STRUCTURE_KINDS, deckKey,
  localOf, makeSite, measureModule, measurePillar,
  type Addr, type PillarModule, type Site, type StructureKind,
  type StructureModule } from './StructureGrid.js';
import { StructureBodies, boundOf, leafProxy, proxiesOf,
  type LocalBox, type Solid } from './StructureBody.js';
import { loadGlb } from '../assets/Loaders.js';
import { SURVIVAL, type ModeRules } from './GameMode.js';
import type { GameCore, StructureDef } from './GameCore.js';
import type { OfCoreModule } from '../sim/wasm/heap.js';
import type { Vec3d } from '../world/PlanetBody.js';

const FILES: Record<StructureKind, string> = {
  foundation: 'assets/structures/foundation.glb',
  floor: 'assets/structures/floor.glb',
  wall: 'assets/structures/wall.glb',
  door: 'assets/structures/door.glb',
};
/** NOT in FILES, because a pillar is not a `StructureKind`: nobody places one.
 *  See `pillarPartsFor` in StructureGrid.ts for what it is instead. */
const PILLAR_FILE = 'assets/structures/pillar.glb';

/**
 * DW-24's two numbers, the plane fit that spends them (GP-36) and the cantilever
 * that relaxes one of them (GP-38) all live in StructureTolerance.ts, with the
 * measurements that set them. They are re-exported here because roughly a dozen
 * call sites and two probes already import them from this module, and moving a
 * published name to make room in a file is a worse trade than one line of
 * forwarding.
 */
export { FLOAT_TOLERANCE_M, BURY_TOLERANCE_FALLBACK_M } from './StructureTolerance.js';

/** What a not-yet-placed free part is keyed by, until it has an id. */
export const FREE_KEY = 'free:0';

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
  /** GP-37: the sockets the art lane publishes, read once off the .glb files.
   *  Empty until `load` runs, which is what makes the snap fail SOFT into the
   *  bare grid rather than throwing on a client whose assets did not arrive. */
  readonly sockets = new Map<StructureKind, SocketDef[]>();
  /** The pillar file's root, kept for the same one-parse reason `scenes` is. */
  pillarScene: THREE.Object3D | null = null;
  /** The DW-32 module. This literal is the ONE place a stale one can survive
   *  silently: everything else measures, this is what a failed load leaves. */
  module: StructureModule = { cellM: 4, deckH: 0.5, wallH: 3.5, wallT: 0.25, storey: 4 };
  pillar: PillarModule = PILLAR_FALLBACK;
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
              private readonly edits: () => number,
              /** DW-31. The ONE gate a structural part has is its cost, so this
               *  is where sandbox lands for the whole base-building system. */
              private readonly mode: ModeRules = SURVIVAL) {}

  async load(): Promise<void> {
    await Promise.all(STRUCTURE_KINDS.map(async (k) => {
      const g = await loadGlb(FILES[k]);
      this.scenes.set(k, g.scene);
      if (k === 'door') this.readSwing(g.animations);
    }));
    this.module = measureModule(this.scenes);
    for (const [k, v] of readSockets(this.scenes)) this.sockets.set(k, v);
    const p = await loadGlb(PILLAR_FILE);
    this.pillarScene = p.scene;
    this.pillar = measurePillar(p.scene);
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

  /** GP-38: how far a deck CARRIED by a neighbour may hang, in metres. Read off
   *  the module's storey rather than typed, so it follows the Blender set. */
  get cantileverFloatM(): number {
    return this.module.storey * CANTILEVER_STOREYS;
  }

  /**
   * GP-39: the top surface of a deck covering a site-local point, as metres of
   * site-local UP, or null when there is nothing built there.
   *
   * THIS IS WHAT MAKES A SMELTER SIT ON A FOUNDATION. A machine's tile is 1 m
   * and a structural cell is 4 m, and DW-32 made them deliberately different
   * constants sharing one site frame, so the two lattices are not re-unified
   * here: the machine's tangent coordinates are simply divided down into the
   * structural cell that contains them. The answer is `socket_top`'s own
   * height, which is `deckH` above the level's base plane.
   *
   * `nearU` is the aim's own height over the plane and picks the storey, so
   * aiming at the ground floor of a two-storey base puts the furnace on the
   * ground floor. Without it the highest deck wins, which is right for the one
   * case that has no aim to consult: a restore.
   */
  deckTopAt(site: Site, e: number, n: number, nearU?: number): number | null {
    const C = this.module.cellM;
    const i = Math.floor(e / C), j = Math.floor(n / C);
    const want = nearU === undefined ? Infinity : nearU + this.module.storey * 0.5;
    for (let level = MAX_LEVEL; level >= 0; --level) {
      const top = level * this.module.storey + this.module.deckH;
      if (top > want) continue;
      if (this.taken.has(deckKey(site.id, i, j, level))) return top;
    }
    return null;
  }

  defFor(kind: StructureKind): StructureDef | null {
    return this.defs[STRUCTURE_KINDS.indexOf(kind)] ?? null;
  }

  /** The cost as a sentence, so a refusal can say exactly what is missing.
   *  GP-600: in sandbox it still QUOTES THE PRICE and says who is paying it,
   *  rather than deleting the number. `CostText.costText` is the one authority
   *  for the wording and its header has the argument. */
  costText(kind: StructureKind): string {
    const d = this.defFor(kind);
    if (d === null) return '';
    return costText(d.cost.map((c) => (
      { count: c.count, name: this.core.itemName(c.item) })), this.mode.freeBuild);
  }

  canAfford(kind: StructureKind): boolean {
    const d = this.defFor(kind);
    if (d === null) return false;
    return this.mode.freeBuild || this.core.structureAfford(d.index);
  }

  /**
   * /core's OWN affordability answer, with the mode taken back out of it.
   *
   * DW-31's IN-PAGE negative control, and the reason it is worth a method: in
   * sandbox a foundation goes down while this still reads false, which proves
   * the cost rule is alive and that the MODE is what lifted it. Without it, a
   * sandbox run that placed everything would look identical to a build whose
   * affordability check had simply broken. Published rather than reconciled per
   * consumer, which is DW-26's rule about one authority answering in two shapes.
   */
  affordInCore(kind: StructureKind): boolean {
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
    return makeSite(this.M, this.body, this.edits(), this.nextSite, p, this.module,
      (x, y, z) => this.groundRadius(x, y, z),
      { floatM: FLOAT_TOLERANCE_M, buryM: this.buryToleranceM });
  }

  /**
   * The nearest site whose grid still reaches `p`, or null.
   *
   * MACHINES ASK THIS TOO, and that is the point of it living here rather than
   * inside the structural placement rules. A belt and a foundation snapping to
   * two different frames is exactly the class of defect that made belts fail to
   * line up in the first place (GP-27); one registry means a base and a factory
   * cannot disagree about where a metre starts.
   */
  nearestSite(p: Vec3d): Site | null {
    const v = new THREE.Vector3();
    let best: Site | null = null;
    let bestD = SITE_REACH_M;
    for (const site of this.sites) {
      const l = localOf(site, p, v);
      const d = Math.hypot(l.x, l.y);
      if (d < bestD) { bestD = d; best = site; }
    }
    return best;
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

  /**
   * Spend a part's cost. All or nothing, and /core decides.
   *
   * DW-31: in sandbox nothing is spent AND the /core call is not made, which is
   * the difference between a mode and a cheat. Calling `structurePay` and
   * ignoring a false return would let a part go down while the pack was
   * silently emptied of whatever it did happen to hold.
   */
  pay(kind: StructureKind): boolean {
    const d = this.defFor(kind);
    if (d === null) return false;
    return this.mode.freeBuild || this.core.structurePay(d.index);
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
