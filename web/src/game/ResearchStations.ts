// D-019. THE RESEARCH STATION: the machine the research screen belongs to.
//
// Reid confirmed D-019 on 2026-08-11. Until tonight research was a free-floating
// J-key panel with no referent anywhere in the world: no entity, no item, no
// recipe, nothing to walk up to. `story_line_outline_v1.txt` puts BUILDING one
// after belts and smelting and before the scanning antenna, so this file is what
// a built one IS, and `ProgressUi` is what pressing J now asks about.
//
// WHY IT IS SHAPED LIKE `Machines` AND NOT LIKE `LaunchPad` OR `Structures`.
// There were three placeable families to copy and the closest one wins:
//
//   `Structures` is the 4 m TILING module. Every function in it (`isDeck`,
//   `addressAt`, `footprintOf`, `supported`) asks a question about a lattice of
//   decks and walls that a single free-standing bench does not answer.
//
//   `LaunchPad` is a 24 m monolith that must stand on a 6 x 6 block of prepared
//   decks, with a ghost, a placement resolver and a view of its own. That is
//   four files of platform rules for an object that needs none of them.
//
//   `Machines` is the hand furnace and the hand smelter: one object, snapped to
//   the site's own metric grid, placed on the ground ahead of the eye, facing
//   the player who put it there, picked by a ray against its own list. That is
//   exactly what a research station is, so it is exactly what this copies. The
//   ONE deliberate difference is where the money comes from, below.
//
// THE COST IS /core's STRUCTURE COST, NOT A PACK ITEM (§S.6). A hand furnace is
// a crafted item that is consumed at placement; a research station is a
// STRUCTURE, paid for at the moment it goes down through `of_gp_structure_pay`
// and never carried. That is the same rule a foundation and a launch pad already
// follow, it is why the def is looked up BY KIND rather than by index (GP-57's
// finding: indexing `structureDefs()` by the client's own enum is only right
// while the two enums agree member for member), and it means the price has one
// authority, which is `gameplay.h` §S.6.
//
// THE MESH IS A PLACEHOLDER AND THIS IS THE NOTICE. `assets/machines/assembler.glb`
// is borrowed because it is the machine in the shipped set that reads most like
// a workbench under instruments, and because borrowing one costs nothing while
// minting a TypeId with no art costs a silently invisible building. /core pins
// `types::ResearchStation = 0x45` and ASSET-SPECS §4 owes
// `structures/research_station.glb` against it. THE ART LANE OWES A REAL MESH;
// when it lands, the only edit here is the URL and the root name.

import * as THREE from 'three';
import { addressIn, anchorIn, siteAt, type SiteHost } from './MachinePlacement.js';
import { costText } from './CostText.js';
import { handSolid, learnProxies, tangentHalfExtentM } from './FactorySolids.js';
import { loadGlb, selectLod } from '../assets/Loaders.js';
import { SURVIVAL, type ModeRules } from './GameMode.js';
import type { GameCore, StructureDef } from './GameCore.js';
import type { OfCoreModule } from '../sim/wasm/heap.js';
import type { Solid } from './StructureBody.js';
import type { Vec3d } from '../world/PlanetBody.js';

/** PLACEHOLDER ART. See the header. */
const FILE = 'assets/machines/assembler.glb';

/** `survival::StructureKind::ResearchStation`. The def is found by THIS and
 *  never by array index, for the reason GP-57 gives in LaunchPad.ts. */
export const STATION_KIND = 5;

/** Metres ahead of the eye a placement lands, before the grid snap. Machines.ts's
 *  own number, because it is the same gesture and a second one would put a
 *  station and a furnace down at two different distances from one press. */
const PLACE_AHEAD_M = 2.2;
/** How far ABOVE the origin the interaction sphere sits, and its radius.
 *  `Machines.pick`'s argument applies verbatim: the origin is the cell centre on
 *  the ground and the eye is 1.6 m up, so a sphere centred on the pivot is
 *  missed by a level crosshair at any useful range. */
const STATION_RADIUS_M = 1.4;
const STATION_CENTRE_UP_M = 0.7;

export interface ResearchStation {
  id: number;
  pos: Vec3d;
  /** Ground normal at the stand point. */
  up: THREE.Vector3;
  /** The normal AND the yaw that turns the face towards whoever placed it. */
  quat: THREE.Quaternion;
  group: THREE.Group;
  /** True when the station stands on a base deck rather than on soil. Published
   *  for the same reason `Machine.onDeck` is: "it sits on the foundation" is a
   *  claim and a claim needs a number a probe can read back. */
  onDeck: boolean;
  /** This station in the walker's own solid set, or null when the asset ships no
   *  `col_*` proxy. Held so `remove` can take the exact object back out by
   *  identity rather than by an id several solids share. */
  solid: Solid | null;
}

export class ResearchStations {
  readonly group = new THREE.Group();
  readonly list: ResearchStation[] = [];
  placements = 0;
  refusals = 0;
  removals = 0;
  private template: THREE.Object3D | null = null;
  private def: StructureDef | null = null;
  private nextId = 1;
  private readonly p = new THREE.Vector3();
  private readonly yAxis = new THREE.Vector3(0, 1, 0);

  constructor(
    private readonly M: OfCoreModule,
    private readonly core: GameCore,
    private readonly origin: { toEngine: (p: Vec3d, out: THREE.Vector3) => void },
    private readonly bodyHandle: number,
    /** The LIVE voxel edit set, as a thunk, for `Machines`' own reason: a
     *  station put down in a pit belongs in the pit. */
    private readonly edits: () => number = () => 0,
    private readonly mode: ModeRules = SURVIVAL,
    /** The site registry, LAZILY: the base-building layer is built after this
     *  one and a station only asks at placement time. Null leaves the bare
     *  oracle snap in place, which is what a headless test of this class gets. */
    private readonly host: () => SiteHost | null = () => null,
  ) {
    this.group.name = 'research-stations';
  }

  async load(): Promise<void> {
    const g = await loadGlb(FILE);
    this.template = g.scene;
    // The collision proxy comes off the SAME parse the mesh does (R33).
    learnProxies(FILE, g.scene);
    this.def = this.core.structures().find((d) => d.kind === STATION_KIND) ?? null;
  }

  get ready(): boolean { return this.def !== null && this.template !== null; }
  get definition(): StructureDef | null { return this.def; }

  /**
   * THE QUESTION THE J KEY ASKS. Existence, not proximity: see `ProgressUi`.
   * Published as a named getter rather than left as `list.length > 0` at the
   * call site, because a second spelling of a gate is a second authority on it.
   */
  get built(): boolean { return this.list.length > 0; }

  /** GP-600: sandbox QUOTES the survival price and names who is paying it,
   *  rather than deleting the number Reid opened sandbox to read. */
  costText(): string {
    if (this.def === null) return '';
    return costText(this.def.cost.map((c) => (
      { count: c.count, name: this.core.itemName(c.item) })), this.mode.freeBuild);
  }

  canAfford(): boolean {
    return this.def !== null
      && (this.mode.freeBuild || this.core.structureAfford(this.def.index));
  }

  /** /core's own answer with the MODE taken back out, DW-31's in-page negative
   *  control: in sandbox a station goes down while this still reads false, which
   *  is what tells "the cost rule is alive and the mode lifted it" apart from
   *  "the cost check silently broke". */
  affordInCore(): boolean {
    return this.def !== null && this.core.structureAfford(this.def.index);
  }

  /** Spend the cost, all or nothing, and /core decides. DW-31: in sandbox
   *  nothing is spent AND the call is not made, which is the difference between
   *  a mode and a cheat. */
  pay(): boolean {
    if (this.def === null) return false;
    return this.mode.freeBuild || this.core.structurePay(this.def.index);
  }

  /**
   * Snap a body-frame point to the metric site grid, then onto whatever surface
   * that cell has: the deck top if one is built there, the live oracle surface
   * if not. `Machines.snap` verbatim, and deliberately so: a station and a
   * furnace standing side by side on one foundation must agree about where a
   * metre starts (GP-27 / GP-39).
   */
  snap(x: number, y: number, z: number):
  { x: number; y: number; z: number; onDeck: boolean } {
    const host = this.host();
    if (host !== null) {
      const p = { x, y, z };
      const s = siteAt(host, p);
      const a = anchorIn(host, addressIn(s.site, host.module, p, s.prospective));
      return { ...a.pos, onDeck: a.onDeck };
    }
    const r = Math.hypot(x, y, z) || 1;
    const dx = x / r, dy = y / r, dz = z / r;
    const g = this.M._of_surface_radius(this.bodyHandle, this.edits(), dx, dy, dz);
    return { x: dx * g, y: dy * g, z: dz * g, onDeck: false };
  }

  /**
   * Put a station on the ground ahead of the eye. Returns it, or null when the
   * cost could not be paid or the aim has no ground under it.
   *
   * THE COST IS SPENT LAST, after every reason to refuse has been checked, so a
   * failed placement can never eat 20 iron.
   */
  place(eye: Vec3d, aim: Vec3d): ResearchStation | null {
    if (this.template === null || this.def === null) { this.refusals++; return null; }
    if (!this.canAfford()) { this.refusals++; return null; }
    const up = new THREE.Vector3(eye.x, eye.y, eye.z).normalize();
    // Project the aim into the tangent plane: a building goes on the ground in
    // front of you, not wherever the crosshair happens to point at the sky.
    const flat = new THREE.Vector3(aim.x, aim.y, aim.z);
    flat.addScaledVector(up, -flat.dot(up));
    if (flat.lengthSq() < 1e-9) { this.refusals++; return null; }
    flat.normalize();
    const pos = this.snap(
      eye.x + flat.x * PLACE_AHEAD_M,
      eye.y + flat.y * PLACE_AHEAD_M,
      eye.z + flat.z * PLACE_AHEAD_M,
    );
    if (!this.pay()) { this.refusals++; return null; }
    const stand = new THREE.Vector3(pos.x, pos.y, pos.z).normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(this.yAxis, stand);
    const st = this.spawn(pos, stand, faceToward(q, stand, eye, pos), pos.onDeck);
    if (st !== null) this.placements++;
    return st;
  }

  /**
   * Put a station back exactly where a save says it was. No cost is spent and no
   * yaw is derived: which way it faces is player-authored state, not a function
   * of where the player happens to stand at load time.
   */
  restore(pos: Vec3d, quat: THREE.Quaternion): ResearchStation | null {
    const stand = new THREE.Vector3(pos.x, pos.y, pos.z).normalize();
    // The saved POSITION is authoritative and is never re-snapped; only `onDeck`
    // is re-asked, because it is a fact about the world AROUND the station
    // rather than about the station, and a deck demolished while the page was
    // shut would otherwise be remembered for ever.
    return this.spawn(pos, stand, quat, this.snap(pos.x, pos.y, pos.z).onDeck);
  }

  /** The half of a placement that is the same however it was asked for. */
  private spawn(pos: Vec3d, stand: THREE.Vector3, quat: THREE.Quaternion,
                onDeck: boolean): ResearchStation | null {
    if (this.template === null) return null;
    const g = new THREE.Group();
    const clone = this.template.clone(true);
    selectLod(clone, '_LOD0');
    clone.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh !== true) return;
      m.castShadow = true;
      m.receiveShadow = true;
    });
    g.add(clone);
    this.group.add(g);
    const st: ResearchStation = {
      id: this.nextId++, pos, onDeck, group: g, up: stand, quat,
      solid: handSolid(FILE, 'blocks', pos, quat),
    };
    // Into the walker's EXISTING solid set, never a second one (DW-26). A
    // placement and a restore both land here, so a loaded station and a built
    // one are solid by the same line of code.
    if (st.solid !== null) this.host()?.bodies?.add(st.solid);
    this.list.push(st);
    return st;
  }

  /**
   * Pull a station back up. The FULL cost comes back, exactly as a structural
   * part's does: a station holds nothing, has no pool and no belt, so there is
   * nothing that could be lost and anything less than a full refund would be a
   * tax on changing your mind about where the bench goes.
   */
  remove(st: ResearchStation): { refunded: { item: number; count: number }[] } | null {
    const at = this.list.indexOf(st);
    if (at < 0) return null;
    this.list.splice(at, 1);
    // clone(true) SHARES geometry and material with the template, so nothing
    // here may be disposed: doing so would blank every station placed after it.
    this.group.remove(st.group);
    // By IDENTITY, not by id: a hand solid carries a shared id deliberately
    // (FactorySolids.ts has the id-space argument).
    if (st.solid !== null) this.host()?.bodies?.remove((q) => q === st.solid);
    const back: { item: number; count: number }[] = [];
    for (const c of this.def?.cost ?? []) {
      const over = this.core.add(c.item, c.count);
      if (c.count - over > 0) back.push({ item: c.item, count: c.count - over });
    }
    this.removals++;
    return { refunded: back };
  }

  /** Throw them all away. The pack is NOT credited: a restore replaces a world
   *  rather than demolishing one, and refunding here would mint iron on load. */
  reset(): void {
    for (const st of this.list) {
      this.group.remove(st.group);
      if (st.solid !== null) this.host()?.bodies?.remove((q) => q === st.solid);
    }
    this.list.length = 0;
  }

  /** World-anchored re-place against the floating origin, exactly like a
   *  machine's. */
  update(): void {
    for (const st of this.list) {
      this.origin.toEngine(st.pos, this.p);
      st.group.position.copy(this.p);
      st.group.quaternion.copy(st.quat);
      st.group.updateMatrixWorld(true);
    }
  }

  /** Nearest station the aim ray enters, within `reachM` PAST THE SURFACE.
   *  `Machines.pick`'s test verbatim, including FS-93's half-extent correction:
   *  `reachM` is a reach to a SURFACE and `t` runs to a CENTRE, so the asset's
   *  own collision proxy puts the difference back on. */
  pick(eye: Vec3d, dir: Vec3d, reachM: number): ResearchStation | null {
    let best: ResearchStation | null = null;
    let bestT = Infinity;
    const reach = reachM + tangentHalfExtentM(FILE);
    for (const st of this.list) {
      const u = STATION_CENTRE_UP_M;
      const ox = st.pos.x + st.up.x * u - eye.x;
      const oy = st.pos.y + st.up.y * u - eye.y;
      const oz = st.pos.z + st.up.z * u - eye.z;
      const t = ox * dir.x + oy * dir.y + oz * dir.z;
      if (t < -STATION_RADIUS_M || t > reach || t >= bestT) continue;
      const cx = ox - dir.x * t, cy = oy - dir.y * t, cz = oz - dir.z * t;
      if (Math.hypot(cx, cy, cz) > STATION_RADIUS_M + 0.5) continue;
      best = st; bestT = Math.max(0, t);
    }
    return best;
  }

  report(): unknown {
    return {
      built: this.built,
      count: this.list.length,
      placements: this.placements, refusals: this.refusals, removals: this.removals,
      // DW-31's in-page negative control, published beside the moded answer so a
      // probe can tell a lifted gate from a broken one.
      canAfford: this.canAfford(), affordInCore: this.affordInCore(),
      cost: this.costText(),
      item: this.def?.item ?? 0, typeId: this.def?.typeId ?? 0,
      /** PLACEHOLDER ART, said in the report as well as in the header, so a
       *  screenshot review cannot mistake a borrowed mesh for the real one. */
      placeholderMesh: FILE,
      list: this.list.map((st) => ({
        id: st.id, pos: [st.pos.x, st.pos.y, st.pos.z], onDeck: st.onDeck,
        solid: st.solid !== null,
      })),
    };
  }
}

/** Yaw `stand` about the ground normal until local +Z points back at the eye.
 *  `Machines.faceMouth`, lifted as a free function because it is geometry and
 *  neither class owns it more than the other. */
function faceToward(stand: THREE.Quaternion, up: THREE.Vector3, eye: Vec3d,
                    pos: Vec3d): THREE.Quaternion {
  const want = new THREE.Vector3(eye.x - pos.x, eye.y - pos.y, eye.z - pos.z);
  want.addScaledVector(up, -want.dot(up));
  if (want.lengthSq() < 1e-9) return stand.clone();
  want.normalize();
  const face = new THREE.Vector3(0, 0, 1).applyQuaternion(stand);
  face.addScaledVector(up, -face.dot(up));
  if (face.lengthSq() < 1e-9) return stand.clone();
  face.normalize();
  const cross = new THREE.Vector3().crossVectors(face, want);
  const angle = Math.atan2(cross.dot(up), face.dot(want));
  return new THREE.Quaternion().setFromAxisAngle(up, angle).multiply(stand);
}
