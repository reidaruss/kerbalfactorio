// THE WORLD SHOWS THE RUIN (WG-166 to WG-171). Scanning spine L5.
//
// `story_line_outline_v1.txt` makes the ruin the hinge of the whole progression:
// research the antenna, build it, it reveals nearby ruins, investigating one
// unlocks electricity and everything orbital downstream of that. WG-151 landed
// the POI bridge and RN-1450 landed `ruin.glb`, and between them there was
// still nothing in the world: `Sites` had exactly one consumer, `DebugSites.ts`,
// and the site 753.8 m from spawn was a row in a table that drew nothing.
//
// THIS FILE IS THE ONE THING THAT TURNS A ROW INTO A PLACE. It draws the mesh,
// it puts the mesh's own collision boxes into the walker's EXISTING solid set,
// and it hands the site position to `Enemies.spawnGarrison`, which
// `EnemyGarrison.ts` named and built for exactly this caller.
//
// -------------------------------------------------------------------------
// WG-166. WHERE THE MESH GOES IS READ OUT OF THE MESH, NOT RESTATED HERE
// -------------------------------------------------------------------------
// `build_ruin.py` had to resolve a contradiction: a `ground` pivot puts the
// model's lowest vertex on y = 0, and poi.h's own arithmetic says the worst
// admissible ground drops 18*tan(4) = 1.26 m from centre to rim with up to
// 1.0 m of residual on top, so a ruin needs about 2.3 m of buried course below
// grade or it floats on its downhill side. The asset resolves it by publishing
// its own grade datum IN THE BYTES: `socket_grade`, whose local height is the
// plane that goes on `FSite.pos`. So this file reads that socket and never
// writes 2.30 anywhere. If the socket is ever moved the placement follows it,
// and if it is ever REMOVED this refuses to place and says so in the report,
// because a missing datum silently defaulting to 0 would sink the model 2.3 m
// into the ground and still look like a working feature from every angle.
//
// -------------------------------------------------------------------------
// WG-166. THE ORIENTATION IS THE SITE'S OWN, DERIVED FROM THE SITE ID
// -------------------------------------------------------------------------
// `poi.h` already derives `yawRad` from the site id and says why in its own
// comment ("Yaw from the ID, not from the index ... a site that moves keeps its
// orientation"). Hashing the id a SECOND time here would be a second authority
// on one fact, and the two would agree until one of them was tuned. There is no
// randomness at draw time: the pose is a pure function of (row, ground normal).
//
// -------------------------------------------------------------------------
// WG-168. THE COLLIDERS JOIN THE ONE SOLID SET, AND `Structures.reset()` IS
//         WHY `build` RUNS BEFORE `load` AND `reseat` RUNS AFTER IT
// -------------------------------------------------------------------------
// DW-26's rule is that there is exactly one answer to "what is holding the
// player up", so a ruin becomes a `Solid` out of its own `col_*` proxies and
// joins `Structures.bodies` exactly as a machine, a deck and a launch pad do.
// That set is SHARED, and `restoreStructures` calls `Structures.reset()`, which
// calls `bodies.clear()` and throws away every solid in the world including
// ones it has never heard of. So the order is deliberate and is exercised on
// EVERY boot rather than only on a rare second load: `Gameplay.create` places
// the ruin BEFORE `await g.load()`, the load wipes the set, and `Persist.apply`
// calls `reseat` immediately after `restoreStructures` to put it back. A path
// that only runs on the unusual case is a path that rots unnoticed.
//
// -------------------------------------------------------------------------
// WG-170. THE LOD LADDER IS DERIVED FROM THE ONE THIS PROJECT ALREADY MEASURED
// -------------------------------------------------------------------------
// `NodeBatch` switches an unscaled node to LOD1 at 55 m and LOD2 at 165 m, and
// world-gen.md section 6.5 says those two were measured rather than chosen. The
// asset that calibrated them is `tree_conifer`, whose `TreeConifer_Full_LOD0`
// measures 6.500 m tall and 2.62 m wide in the shipped bytes, i.e. a bounding
// radius of 3.741 m. That makes the shipped ladder 14.70 and 44.10 BOUNDING
// RADII, which is a screen-size law and transfers; 55 m and 165 m are metres
// for a six-metre tree and do not. The ruin's own bounding radius is measured
// off the loaded LOD0 geometry, never typed in. On the shipped ruin that lands
// at 375 m and 1,126 m: from spawn (753.8 m) it draws its 6,200-triangle LOD1
// rather than its 15,920-triangle LOD0, and walking in promotes it.
//
// -------------------------------------------------------------------------
// WHAT THIS FILE DELIBERATELY DOES NOT DO
// -------------------------------------------------------------------------
// No interact, no investigate, no reward, no reveal. World-gen's charter line
// ("the world says WHERE a site is and never what is inside one", Sites.ts)
// holds here unbroken: `socket_investigate` is published in the report for
// the lane that builds L7 and is not read for anything else. No cleared bit,
// no serialised creature: regeneration on approach is the accepted model.

import * as THREE from 'three';
import { NODE_LOD_HYST } from './NodeBatch.js';
import { SITE_KIND_RUIN, Sites, type SiteRow } from '../world/Sites.js';
import { boundsOf } from './StructureBody.js';
import { findNode, loadGlb, selectLod } from '../assets/Loaders.js';
import { handSolid, learnProxies } from './FactorySolids.js';
import { attachSurface, familyForMaterial } from '../render/instancing/Surfaces.js';
import type { Enemies, EnemyHost } from './Enemies.js';
import type { OfCoreModule } from '../sim/wasm/heap.js';
import type { Solid, StructureBodies } from './StructureBody.js';
import type { Vec3d } from '../world/PlanetBody.js';

export const RUIN_FILE = 'assets/structures/ruin.glb';
/** The one render stem. Its three rungs are `Ruin_LOD0/1/2`. */
const LOD_KEYS = ['_LOD0', '_LOD1', '_LOD2'] as const;
/** See the header, WG-170. Multiples of the asset's OWN bounding radius. */
export const RUIN_LOD1_RADII = 14.70;
export const RUIN_LOD2_RADII = 44.10;
/** The sockets and the one named collider the report publishes, so a probe can
 *  aim at the doorway and at a wall without re-deriving either from prose. */
const SOCKETS = ['socket_grade', 'socket_entry', 'socket_cella',
  'socket_investigate'] as const;
const WALL_NODE = 'col_CellaWallN';
const DECK_NODE = 'col_PlinthDeckA';

export interface PlacedRuin {
  /** The two halves `Sites.known`/`markVisited` take back. There is no
   *  reconstructed 64-bit id here for `poiabi.ts`'s own reason. */
  idLo: number;
  idHi: number;
  ordinal: number;
  /** `SiteRow.pos` VERBATIM: the body-frame surface point at the site centre. */
  sitePos: Vec3d;
  /** Where the model PIVOT goes: `sitePos` minus `up * gradeM`. */
  pos: Vec3d;
  up: THREE.Vector3;
  quat: THREE.Quaternion;
  yawRad: number;
  footprintM: number;
  group: THREE.Group;
  /** This ruin in the walker's solid set, or null when the asset ships no
   *  `col_*` proxy. Held by identity so `reseat` cannot double-add it. */
  solid: Solid | null;
  /** Creatures standing watch, and the seed that decided who they are. */
  garrison: number;
  garrisonSeed: number;
  /** 0, 1 or 2. Recomputed per frame from the feet, with hysteresis. */
  lod: number;
  distM: number;
}

export class RuinSites {
  readonly group = new THREE.Group();
  readonly list: PlacedRuin[] = [];
  /** Why nothing is drawn, when nothing is drawn. Beside the count and never
   *  instead of it, the same discipline `Enemies.disabledWhy` follows. */
  why = 'not built';
  rowsSeen = 0;
  rowsRuin = 0;
  refused = 0;
  /** Read out of `socket_grade`, or -1 when the asset does not publish it. */
  gradeM = -1;
  /** Measured off the loaded LOD0 geometry (WG-170), never typed in. */
  boundM = 0;
  private template: THREE.Object3D | null = null;
  private points = new Map<string, THREE.Vector3>();
  private readonly p = new THREE.Vector3();
  private readonly yAxis = new THREE.Vector3(0, 1, 0);
  /** Materials already registered with Surfaces, `PlayerRig.surfaced`'s own
   *  reason: the template is cloned per site, `clone(true)` SHARES the
   *  material rather than copying it (three's own contract), so a second
   *  ruin would otherwise register and bind the same material a second time. */
  private readonly surfaced = new Set<THREE.Material>();

  constructor(
    private readonly M: OfCoreModule,
    private readonly bodyHandle: number,
    private readonly origin: { toEngine: (p: Vec3d, out: THREE.Vector3) => void },
  ) {
    this.group.name = 'ruins';
  }

  /** Parse the asset once, and take the grade datum, the bound and the probe
   *  points off the SAME parse the colliders come from (R33). */
  async load(): Promise<void> {
    const g = await loadGlb(RUIN_FILE);
    this.template = g.scene;
    learnProxies(RUIN_FILE, g.scene);
    const inv = new THREE.Matrix4().copy(g.scene.matrixWorld).invert();
    for (const name of SOCKETS) {
      const n = findNode(g.scene, name);
      if (n === null) continue;
      n.updateWorldMatrix(true, false);
      this.points.set(name,
        new THREE.Vector3().setFromMatrixPosition(n.matrixWorld).applyMatrix4(inv));
    }
    for (const name of [WALL_NODE, DECK_NODE]) {
      const b = boundsOf(g.scene, name);
      if (b !== null) this.points.set(name, b.getCenter(new THREE.Vector3()));
    }
    const grade = this.points.get('socket_grade');
    this.gradeM = grade === undefined ? -1 : grade.y;
    const lod0 = boundsOf(g.scene, 'Ruin_LOD0');
    this.boundM = lod0 === null
      ? 0 : lod0.getBoundingSphere(new THREE.Sphere()).radius;
  }

  get ready(): boolean { return this.template !== null && this.gradeM >= 0; }
  get count(): number { return this.list.length; }
  get lod1M(): number { return this.boundM * RUIN_LOD1_RADII; }
  get lod2M(): number { return this.boundM * RUIN_LOD2_RADII; }
  investigateLocal(): THREE.Vector3 | null { return this.points.get('socket_investigate')?.clone() ?? null; }

  /**
   * Draw every ruin-kind site this body's `SiteCatalog` holds, and make each one
   * solid. Idempotent: a second call is a no-op rather than a second ruin.
   *
   * `sites` is constructed by the caller so this class holds no opinion about
   * the body handle beyond the one it was given, and so a test can hand it a
   * catalogue without a browser.
   */
  build(sites: Sites, bodies: StructureBodies | null): number {
    if (this.list.length > 0) return 0;
    if (this.template === null) { this.why = 'ruin.glb did not load'; return 0; }
    if (this.gradeM < 0) {
      this.why = `${RUIN_FILE} publishes no socket_grade: refusing to guess a `
        + 'grade datum, because guessing 0 would bury the model 2.3 m';
      return 0;
    }
    if (!sites.live) { this.why = 'no site catalogue for this body'; return 0; }
    this.rowsSeen = sites.count;
    let made = 0;
    for (const r of sites.rows()) {
      if (r.kind !== SITE_KIND_RUIN) continue;
      this.rowsRuin++;
      if (this.spawn(r, bodies) === null) this.refused++;
      else made++;
    }
    this.why = made > 0 ? ''
      : `this body's catalogue holds ${this.rowsSeen} site(s) and `
        + `${this.rowsRuin} of ruin kind`;
    return made;
  }

  /** One row, drawn and made solid. */
  private spawn(r: SiteRow, bodies: StructureBodies | null): PlacedRuin | null {
    if (this.template === null) return null;
    const up = new THREE.Vector3(r.pos.x, r.pos.y, r.pos.z).normalize();
    if (!Number.isFinite(up.x) || up.lengthSq() < 0.5) return null;
    // The MODEL PIVOT is the grade plane pushed back down the normal: the site
    // position IS the grade plane by the asset's own contract (WG-166).
    const pos: Vec3d = {
      x: r.pos.x - up.x * this.gradeM,
      y: r.pos.y - up.y * this.gradeM,
      z: r.pos.z - up.z * this.gradeM,
    };
    const quat = new THREE.Quaternion().setFromUnitVectors(this.yAxis, up);
    quat.premultiply(new THREE.Quaternion().setFromAxisAngle(up, r.yawRad));
    const group = new THREE.Group();
    const clone = this.template.clone(true);
    selectLod(clone, LOD_KEYS[0]);
    clone.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh !== true) return;
      m.castShadow = true;
      m.receiveShadow = true;
      // WG-166's asset ships its own authored material roles (`OF_Rock`,
      // `OF_Soil`, `OF_LeafDry`, ...) and, until this line, nothing ever asked
      // Surfaces for the family they belong to: the ruin drew with none of
      // the five shipped map slots wired, the one gap `PlayerRig.ts`'s own
      // header names as "every batched path and no per-object one" left
      // uncaught because this file is ALSO a per-object path. Same fix,
      // same shape: register each unique material once, by its own role.
      for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
        if (this.surfaced.has(mat)) continue;
        this.surfaced.add(mat);
        attachSurface(mat as THREE.MeshStandardMaterial,
          familyForMaterial(mat), `ruin:${mat.name}`);
      }
    });
    group.add(clone);
    this.group.add(group);
    const ruin: PlacedRuin = {
      idLo: r.idLo, idHi: r.idHi, ordinal: r.ordinal,
      sitePos: { x: r.pos.x, y: r.pos.y, z: r.pos.z },
      pos, up, quat, yawRad: r.yawRad, footprintM: r.footprintM, group,
      solid: handSolid(RUIN_FILE, 'blocks', pos, quat),
      garrison: 0, garrisonSeed: 0, lod: 0, distM: Infinity,
    };
    if (ruin.solid !== null) bodies?.add(ruin.solid);
    this.list.push(ruin);
    return ruin;
  }

  /**
   * Put every ruin's collider back into the solid set, once each.
   *
   * `restoreStructures` calls `Structures.reset()`, which calls
   * `bodies.clear()`; see WG-168 in the header for why that makes this a
   * REQUIRED step of the load path rather than a repair. Guarded by identity so
   * calling it on a set that already holds the solid cannot double it.
   */
  reseat(bodies: StructureBodies | null): number {
    if (bodies === null) return 0;
    let n = 0;
    for (const ruin of this.list) {
      const s = ruin.solid;
      if (s === null || bodies.list.includes(s)) continue;
      bodies.add(s);
      n++;
    }
    return n;
  }

  /**
   * Post a garrison at every ruin, through the seam `EnemyGarrison.ts` named
   * and built for this caller.
   *
   * THE SEED IS THE SITE ID'S LOW HALF, so who stands at a ruin is a property
   * of the SITE and reads the same on day one and day one hundred, which is the
   * composition rule that file argues for at length. There is no cleared bit
   * and no creature is serialised: a garrison is re-posted wherever this is
   * called, which is once per world build.
   *
   * Returns 0 in a safe world, and that is not a failure: `spawnGarrison` is
   * gated by `Enemies.enabled` so GP-93's "sandbox-safe means no nests AT ALL"
   * has no ruin-shaped hole in it.
   */
  garrison(enemies: Enemies, host: EnemyHost, seedOverride?: number): number {
    let made = 0;
    for (const ruin of this.list) {
      const seed = seedOverride ?? ruin.idLo;
      const n = enemies.spawnGarrison(host, ruin.sitePos, seed);
      ruin.garrisonSeed = seed;
      ruin.garrison = n;
      made += n;
    }
    return made;
  }

  /** Throw them all away: a teardown, not a demolition. */
  reset(bodies: StructureBodies | null): void {
    for (const ruin of this.list) {
      this.group.remove(ruin.group);
      if (ruin.solid !== null) bodies?.remove((q) => q === ruin.solid);
    }
    this.list.length = 0;
  }

  /**
   * World-anchored re-place against the floating origin, plus the LOD rung.
   *
   * `feet` rather than the camera: the ladder is about how big the ruin is on
   * screen and the eye is 1.6 m above the feet at 375 m, which is a difference
   * of one part in 55,000. Passing the feet is what every other world-anchored
   * streamer in this file's neighbourhood already gets.
   */
  update(feet: { x: number; y: number; z: number }): void {
    for (const ruin of this.list) {
      this.origin.toEngine(ruin.pos, this.p);
      ruin.group.position.copy(this.p);
      ruin.group.quaternion.copy(ruin.quat);
      ruin.group.updateMatrixWorld(true);
      const d = Math.hypot(ruin.pos.x - feet.x, ruin.pos.y - feet.y,
        ruin.pos.z - feet.z);
      ruin.distM = d;
      const want = this.rungFor(d, ruin.lod);
      if (want === ruin.lod) continue;
      ruin.lod = want;
      selectLod(ruin.group, LOD_KEYS[want]);
    }
  }

  /** The rung `d` asks for, with `NODE_LOD_HYST` applied against the rung the
   *  ruin is already on. Borrowed from `NodeBatch` rather than restated: a
   *  boundary a thing sits exactly on rewrites its geometry every frame. */
  private rungFor(d: number, have: number): number {
    const h = NODE_LOD_HYST;
    const up1 = this.lod1M * (1 + (have >= 1 ? h : 0));
    const up2 = this.lod2M * (1 + (have >= 2 ? h : 0));
    if (d >= up2) return 2;
    if (d >= up1) return 1;
    return 0;
  }

  /** A point on the model, in BODY-FRAME metres, or null. The report's
   *  `points` block, so a probe aims at the real doorway and the real wall. */
  private worldPoint(ruin: PlacedRuin, name: string): number[] | null {
    const local = this.points.get(name);
    if (local === undefined) return null;
    const v = local.clone().applyQuaternion(ruin.quat);
    return [ruin.pos.x + v.x, ruin.pos.y + v.y, ruin.pos.z + v.z];
  }

  report(): unknown {
    return {
      count: this.list.length,
      why: this.why,
      rowsSeen: this.rowsSeen, rowsRuin: this.rowsRuin, refused: this.refused,
      asset: RUIN_FILE,
      // Read out of the bytes, published so a probe asserts the datum rather
      // than the placement's arithmetic alone (WG-166).
      gradeM: this.gradeM,
      boundM: +this.boundM.toFixed(4),
      lod1M: +this.lod1M.toFixed(2), lod2M: +this.lod2M.toFixed(2),
      list: this.list.map((r) => {
        const sr = Math.hypot(r.sitePos.x, r.sitePos.y, r.sitePos.z);
        const d = Math.hypot(r.sitePos.x, r.sitePos.y, r.sitePos.z) || 1;
        // The LIVE surface under the site, asked of the same oracle every
        // structure asks. Published beside the site's own radius rather than
        // instead of it: the two agreeing is a claim, and a claim needs a
        // number a probe can read back.
        const live = this.M._of_surface_radius(this.bodyHandle, 0,
          r.sitePos.x / d, r.sitePos.y / d, r.sitePos.z / d);
        return {
          idLo: r.idLo, idHi: r.idHi, ordinal: r.ordinal,
          sitePos: [r.sitePos.x, r.sitePos.y, r.sitePos.z],
          pos: [r.pos.x, r.pos.y, r.pos.z],
          up: [r.up.x, r.up.y, r.up.z],
          quat: [r.quat.x, r.quat.y, r.quat.z, r.quat.w],
          yawRad: r.yawRad, footprintM: r.footprintM,
          siteRadiusM: sr, liveSurfaceRadiusM: live,
          standoffM: +(sr - live).toFixed(6),
          lod: r.lod, distM: +r.distM.toFixed(2),
          solid: r.solid !== null,
          solidBoxes: r.solid?.boxes.length ?? 0,
          solidBoundM: +(r.solid?.cr ?? 0).toFixed(3),
          garrison: r.garrison, garrisonSeed: r.garrisonSeed,
          points: {
            grade: this.worldPoint(r, 'socket_grade'),
            entry: this.worldPoint(r, 'socket_entry'),
            cella: this.worldPoint(r, 'socket_cella'),
            // L7's, published and not read here. See the header.
            investigate: this.worldPoint(r, 'socket_investigate'),
            wall: this.worldPoint(r, WALL_NODE),
            deck: this.worldPoint(r, DECK_NODE),
          },
        };
      }),
    };
  }
}
