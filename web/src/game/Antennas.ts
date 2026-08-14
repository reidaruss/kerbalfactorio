// GP-533. THE SCANNING ANTENNA: the structure `story_line_outline_v1.txt` puts
// right after the research station -- research it, build it, and the build
// REVEALS THE NEARBY RUINS.
//
// SHAPED LIKE `ResearchStations.ts`, VERBATIM, for the identical argument
// D-019 already made and recorded there: it is not the 4 m tiling module
// (`Structures`), it is not a 24 m monolith with its own platform rules
// (`LaunchPad`), it is one object snapped to the site's own metric grid,
// placed on the ground ahead of the eye, facing the player who put it there,
// picked by a ray against its own list -- exactly what `Machines` already is.
// gameplay.h's own §S.6 comment settles StructureKind membership by the same
// criterion the station used: does this thing tick, hold ports, draw power or
// carry an inventory? No. So it is the SEVENTH `survival::StructureKind`, with
// NO ABI CHANGE, exactly as the station was the sixth.
//
// THE ONE THING THIS CLASS DOES NOT DO: it never touches `Sites` or
// `MarkerRegistry`. Placement mechanics live here (WHERE and HOW, `/core`'s
// cost authority); the ONE-SHOT REVEAL that a successful placement triggers
// (`of_poi_near` + `of_poi_mark_known`, already-shipped ABI 24, WG-151) is
// orchestrated by `placeAntenna` in GameplayActions.ts, on the same split
// `ResearchStations.ts` keeps from `GameplayActions.placeStation`: this class
// answers "did a structure go down", the action function answers "what does
// that MEAN".
//
// THE MESH LANDED ON 2026-08-14 AND THE PLACEHOLDER IS GONE (RN-1530 to
// RN-1549). `assets/structures/scanning_antenna.glb` is the real asset against
// `types::ScanningAntenna = 0x46`: a 3.00 x 3.00 m footprint, 6.00 m to the
// top of a 2.10 m panelled dish on a guyed four-chord lattice tower, built by
// tools/blender/build_scanning_antenna.py and specced in ASSET-SPECS §4.27.
//
// GP-805. CLOSED: THE DISH WAS UNSELECTABLE, AND THE CAUSE WAS NEITHER A
// MISSING COLLIDER NOR A PICK MASK NOR A `col_` NAMING DEFECT. `col_Plinth`,
// `col_Mast`, `col_Cabinet` and `col_Anchor1..4` all ship and all read solid
// (ASSET-SPECS.md §4.27); the walker's own `solidBuild` predicate meets the
// mast exactly where it should. THE PICK NEVER CONSULTS COLLISION AT ALL --
// `pick` below is a hand-rolled sphere test against `ScanAntenna.pos`, copied
// verbatim from `ResearchStations.pick` (a 2.44 m bench) onto a 6.00 m mast
// without resizing. `ANTENNA_RADIUS_M + 0.5` = 1.90 m from a point
// `ANTENNA_CENTRE_UP_M` above the pivot reached only 57 per cent of the
// asset's vertices and stopped at z = 2.555 on the mast axis: the tower was
// selectable and the dish, at z 5.0 to 6.0, was 3.4+ m outside the sphere no
// matter the aim. In play this was invisible, because a level crosshair at
// eye height 1.60 m scored |1.60 - 0.70| = 0.90 m at any range and met the
// tower; it only bit if somebody aimed at the head. The borrowed
// `power_pole.glb` had the identical property at 4.0 m and nobody had
// measured it (ASSET-SPECS.md, RN-1530..1549).
//
// FIXED BY RECENTRING AND ENLARGING THE SAME SPHERE TEST, MEASURED AGAINST
// THE SHIPPED LOD0 MESH RATHER THAN GUESSED: a script walking every LOD0
// vertex of the real `scanning_antenna.glb` (5,672 verts, 8 meshes) found the
// enclosing-sphere optimum at `ANTENNA_CENTRE_UP_M = 2.7`, where the worst
// vertex sits 3.4337 m out -- so `ANTENNA_RADIUS_M = 3.0` (a 3.50 m budget
// with the same `+ 0.5` slack `ResearchStations.pick` uses) covers 100.00 per
// cent of the mesh with 0.066 m to spare, and a level crosshair at 1.60 m
// still scores only 1.10 m against that budget, so nothing that worked before
// stopped working. No socket or `col_*` byte moved; this is a client-side
// pick constant, not a published asset interface.
//
// ONE MEASURED SIDE EFFECT OF THE SAME NUMBER, STATED RATHER THAN HIDDEN.
// `pick`'s near clip is `t < -ANTENNA_RADIUS_M`, i.e. the sphere's own centre
// may sit up to `ANTENNA_RADIUS_M` BEHIND the ray origin and still count; this
// was 1.4 m before and is 3.0 m now. At the ~2.2 m the eye stands from a
// freshly placed antenna (`PLACE_AHEAD_M`), that is enough for the antenna to
// still resolve while looking 180 degrees away from it (`probes/
// antennapick.js` measured this directly and moved its own negative control
// to a genuine distance rather than a heading, once two heading-based drafts
// both still hit). Unlikely to be felt in play -- it needs standing almost on
// top of a just-placed antenna and looking away on purpose -- and not fixed
// here: the near clip and the lateral radius are the same constant on
// purpose, matching `ResearchStations.pick`'s own shape, and decoupling them
// is a second number this file does not currently need.

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

/** The real asset (RN-1530..1549). See the header on what `pick` can and
 *  cannot reach on a 6 m mast. */
const FILE = 'assets/structures/scanning_antenna.glb';

/** `survival::StructureKind::ScanningAntenna`. The def is found by THIS and
 *  never by array index, for the reason GP-57 gives in LaunchPad.ts and
 *  ResearchStations.ts repeats. */
export const ANTENNA_KIND = 6;

/** Machines.ts's own placement distance, copied verbatim so an antenna and a
 *  station placed side by side land the same distance from the eye
 *  (`ResearchStations` §header). */
const PLACE_AHEAD_M = 2.2;
/** GP-805. NOT `ResearchStations`' 1.4/0.7 -- those size a sphere for a 2.44 m
 *  bench and left the 6.00 m mast's dish 3.4+ m outside it (see the header).
 *  These are measured against the shipped LOD0 mesh: centred at 2.7 m up, the
 *  worst vertex is 3.4337 m out, so a 3.0 m radius (3.50 m with the same
 *  `+ 0.5` slack below) covers all of it with 0.066 m to spare. */
const ANTENNA_RADIUS_M = 3.0;
const ANTENNA_CENTRE_UP_M = 2.7;

export interface ScanAntenna {
  id: number;
  pos: Vec3d;
  up: THREE.Vector3;
  quat: THREE.Quaternion;
  group: THREE.Group;
  onDeck: boolean;
  solid: Solid | null;
}

export class Antennas {
  readonly group = new THREE.Group();
  readonly list: ScanAntenna[] = [];
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
    private readonly edits: () => number = () => 0,
    private readonly mode: ModeRules = SURVIVAL,
    private readonly host: () => SiteHost | null = () => null,
  ) {
    this.group.name = 'scan-antennas';
  }

  async load(): Promise<void> {
    const g = await loadGlb(FILE);
    this.template = g.scene;
    learnProxies(FILE, g.scene);
    this.def = this.core.structures().find((d) => d.kind === ANTENNA_KIND) ?? null;
  }

  get ready(): boolean { return this.def !== null && this.template !== null; }
  get definition(): StructureDef | null { return this.def; }

  costText(): string {
    if (this.def === null) return '';
    return costText(this.def.cost.map((c) => (
      { count: c.count, name: this.core.itemName(c.item) })), this.mode.freeBuild);
  }

  canAfford(): boolean {
    return this.def !== null
      && (this.mode.freeBuild || this.core.structureAfford(this.def.index));
  }

  affordInCore(): boolean {
    return this.def !== null && this.core.structureAfford(this.def.index);
  }

  pay(): boolean {
    if (this.def === null) return false;
    return this.mode.freeBuild || this.core.structurePay(this.def.index);
  }

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

  /** Put an antenna on the ground ahead of the eye. Returns it, or null when
   *  the cost could not be paid or the aim has no ground under it. THE COST IS
   *  SPENT LAST, so a failed placement can never eat the copper. */
  place(eye: Vec3d, aim: Vec3d): ScanAntenna | null {
    if (this.template === null || this.def === null) { this.refusals++; return null; }
    if (!this.canAfford()) { this.refusals++; return null; }
    const up = new THREE.Vector3(eye.x, eye.y, eye.z).normalize();
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
    const at = this.spawn(pos, stand, faceToward(q, stand, eye, pos), pos.onDeck);
    if (at !== null) this.placements++;
    return at;
  }

  restore(pos: Vec3d, quat: THREE.Quaternion): ScanAntenna | null {
    const stand = new THREE.Vector3(pos.x, pos.y, pos.z).normalize();
    return this.spawn(pos, stand, quat, this.snap(pos.x, pos.y, pos.z).onDeck);
  }

  private spawn(pos: Vec3d, stand: THREE.Vector3, quat: THREE.Quaternion,
                onDeck: boolean): ScanAntenna | null {
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
    const at: ScanAntenna = {
      id: this.nextId++, pos, onDeck, group: g, up: stand, quat,
      solid: handSolid(FILE, 'blocks', pos, quat),
    };
    if (at.solid !== null) this.host()?.bodies?.add(at.solid);
    this.list.push(at);
    return at;
  }

  /** Full refund: an antenna holds nothing, has no pool and no belt. */
  remove(at: ScanAntenna): { refunded: { item: number; count: number }[] } | null {
    const i = this.list.indexOf(at);
    if (i < 0) return null;
    this.list.splice(i, 1);
    this.group.remove(at.group);
    if (at.solid !== null) this.host()?.bodies?.remove((q) => q === at.solid);
    const back: { item: number; count: number }[] = [];
    for (const c of this.def?.cost ?? []) {
      const over = this.core.add(c.item, c.count);
      if (c.count - over > 0) back.push({ item: c.item, count: c.count - over });
    }
    this.removals++;
    return { refunded: back };
  }

  reset(): void {
    for (const at of this.list) {
      this.group.remove(at.group);
      if (at.solid !== null) this.host()?.bodies?.remove((q) => q === at.solid);
    }
    this.list.length = 0;
  }

  update(): void {
    for (const at of this.list) {
      this.origin.toEngine(at.pos, this.p);
      at.group.position.copy(this.p);
      at.group.quaternion.copy(at.quat);
      at.group.updateMatrixWorld(true);
    }
  }

  /** `ResearchStations.pick`'s SHAPE verbatim, including FS-93's half-extent
   *  correction; the SIZE is this file's own (GP-805, see `ANTENNA_RADIUS_M`
   *  and `ANTENNA_CENTRE_UP_M` above) rather than the station's. */
  pick(eye: Vec3d, dir: Vec3d, reachM: number): ScanAntenna | null {
    let best: ScanAntenna | null = null;
    let bestT = Infinity;
    const reach = reachM + tangentHalfExtentM(FILE);
    for (const at of this.list) {
      const u = ANTENNA_CENTRE_UP_M;
      const ox = at.pos.x + at.up.x * u - eye.x;
      const oy = at.pos.y + at.up.y * u - eye.y;
      const oz = at.pos.z + at.up.z * u - eye.z;
      const t = ox * dir.x + oy * dir.y + oz * dir.z;
      if (t < -ANTENNA_RADIUS_M || t > reach || t >= bestT) continue;
      const cx = ox - dir.x * t, cy = oy - dir.y * t, cz = oz - dir.z * t;
      if (Math.hypot(cx, cy, cz) > ANTENNA_RADIUS_M + 0.5) continue;
      best = at; bestT = Math.max(0, t);
    }
    return best;
  }

  report(): unknown {
    return {
      count: this.list.length,
      placements: this.placements, refusals: this.refusals, removals: this.removals,
      canAfford: this.canAfford(), affordInCore: this.affordInCore(),
      cost: this.costText(),
      item: this.def?.item ?? 0, typeId: this.def?.typeId ?? 0,
      /** Which mesh the world actually drew; `ResearchStations.report`'s own
       *  field, renamed off `placeholderMesh` in the same commit. */
      mesh: FILE,
      list: this.list.map((at) => ({
        id: at.id, pos: [at.pos.x, at.pos.y, at.pos.z], onDeck: at.onDeck,
        solid: at.solid !== null,
      })),
    };
  }
}

/** `ResearchStations.ts`'s free function, lifted verbatim (geometry, not
 *  state, so nothing here owns it more than the station's copy did). */
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
