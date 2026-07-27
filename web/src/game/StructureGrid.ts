// THE STRUCTURAL BUILD GRID, and why it is NOT the 1 m voxel lattice.
//
// Machines snap to /core's `of_cell_for_pos` lattice, which is right for them:
// a machine is one object and a belt only has to find the cell ahead of it. It
// is WRONG for a tiling structural set, and the reason is measured rather than
// suspected. The lattice is a 1 m cube grid in the BODY frame, and the ground is
// a sphere cutting through it obliquely, so one unit step of a cell key is 0.59,
// 0.81 or 1.02 m of ground depending on which axis you step along (re-measured
// today by `probes/buildtol.js`: 0.590, 1.017, 0.811). That already split one
// belt run into three (ARCHITECTURE 15.2 item 102). DW-32 makes the argument
// STRONGER, not weaker: a foundation is now a 4.00 m mesh, so laying decks on
// lattice cell centres would leave a 3.41 m gap on the worst axis instead of a
// 0.41 m one, and a 20 x 20 m platform of 25 decks would be shredded.
//
// So a structure belongs to a SITE: a local metric frame, anchored to one world
// lattice cell (which is what "snap to the world grid" means here) and carrying
// two orthonormal tangent axes. Inside a site the spacing is EXACTLY the module,
// so adjacent parts meet at 0.000 m by construction rather than by luck.
//
// The curvature this ignores is a measured quantity, not an assumption: a
// tangent plane departs from a 600 km sphere by r^2/2R, which is 3.4 mm at 64 m
// from the origin, 0.85 mm at 32 m and 0.08 mm at 10 m. A site is capped at
// SITE_REACH_M so the error can never leave that regime, and the probe reads it
// back. 3.4 mm is three orders below the 0.90 m the placement rule tolerates.
//
// EVERY MODULE CONSTANT IS MEASURED OFF THE SHIPPED .glb FILES, from the sockets
// the art lane authored for exactly this purpose (ASSET-SPECS 4.23). Nothing
// here retypes 0.50 or 3.50 or 4.00: change the Blender module and this follows.
// That is what made the DW-32 rescale a four-constant client change instead of a
// re-derivation, and it is why the pillar recipe below is measured too.

import * as THREE from 'three';
import { boundsOf } from './StructureBody.js';
import { fitPlane } from './StructureTolerance.js';
import { snapToAxes, snapToGround } from './Grid.js';
import type { OfCoreModule } from '../sim/wasm/heap.js';
import type { Vec3d } from '../world/PlanetBody.js';

export type StructureKind = 'foundation' | 'floor' | 'wall' | 'door';
export const STRUCTURE_KINDS: readonly StructureKind[] =
  ['foundation', 'floor', 'wall', 'door'];

/** Decks are the two parts that take the cell-centre anchor. */
export function isDeck(k: StructureKind): boolean {
  return k === 'foundation' || k === 'floor';
}

/**
 * How far from its origin a site may reach, metres. See the curvature note.
 *
 * 32 was 32 cells across a site's radius at the 1 m module and is 8 at the 4 m
 * one, which is a single room, so DW-32 doubles it: 64 m is 16 cells, the same
 * order of building the number was chosen to allow, and the tangent-plane error
 * it admits is still 3.4 mm.
 *
 * SHARED WITH `MachinePlacement.withinSite`, deliberately, because a base and a
 * factory sharing one frame is the whole point of GP-27. Raising it HELPS the
 * factory rather than hurting it, so it is not split: BT-10 measured one adopted
 * site bounding a layout at 323 machines with a 1 m cell and a 32 m reach, and
 * the bound is `pi r^2 / cellM^2`, so 64 m restores about 804 cells per site
 * against the 201 that a 32 m reach would leave at the 4 m module. The thing
 * that actually moved the factory's bound is `module.cellM` itself, which is not
 * this file's to fix and is reported rather than patched.
 */
export const SITE_REACH_M = 64;
/** Storeys a site may stack. Four is 16 m at the DW-32 storey, a real tower. */
export const MAX_LEVEL = 3;

/** The tiling module, measured off the assets. */
export interface StructureModule {
  cellM: number;
  deckH: number;
  wallH: number;
  wallT: number;
  storey: number;
}

/**
 * Read the module out of the shipped files.
 *
 * `socket_edge_e` sits at half a cell along local +X, `socket_top` on a deck at
 * the deck thickness and `socket_top` on a wall at the wall height. The wall
 * thickness is the depth of its own collision box. That is every number in
 * ASSET-SPECS 4.23's table, taken from the geometry that ships.
 */
export function measureModule(
  scenes: ReadonlyMap<StructureKind, THREE.Object3D>,
): StructureModule {
  const foundation = scenes.get('foundation');
  const wall = scenes.get('wall');
  if (foundation === undefined || wall === undefined) {
    throw new Error('structures: foundation and wall must load before the module');
  }
  const edge = foundation.getObjectByName('socket_edge_e');
  const deckTop = foundation.getObjectByName('socket_top');
  const wallTop = wall.getObjectByName('socket_top');
  const bb = boundsOf(wall, 'col_Wall');
  if (edge === undefined || deckTop === undefined || wallTop === undefined
    || bb === null) {
    throw new Error('structures: a shipped socket is missing');
  }
  const cellM = Math.abs(edge.position.x) * 2;
  const deckH = deckTop.position.y;
  const wallH = wallTop.position.y;
  return {
    cellM, deckH, wallH,
    wallT: bb.max.z - bb.min.z,
    storey: deckH + wallH,
  };
}

/**
 * THE PILLAR, AND WHY IT IS NOT A `StructureKind`.
 *
 * DW-32 asks for "visible pillars where the gap to the ground is large". That is
 * a CONSEQUENCE of a placement, not a placement: the player put a deck out over
 * a drop and the drop is what needs answering. So a pillar has no ItemId, no
 * cost, no placement verb, no save row and no address; it is drawn under a deck
 * whose gap exceeds the asset's own minimum and it disappears when the deck
 * does. Three reasons, in the order they decided it:
 *
 *   1. Making it a kind would need a `/core` `StructureKind` entry plus an item
 *      and a `CraftRecipe`, because `gameplay.h` is the single cost authority
 *      (GP-21). This lane may not touch `/core` this pass, and a client-side
 *      cost would be a SECOND cost authority, which is the exact failure this
 *      project has already paid for more than once.
 *   2. Handing a player a piece they must place UNDER something they have
 *      already placed is worse than generating it. Satisfactory generates its
 *      supports for this reason and nobody misses placing them.
 *   3. It cannot be one mesh anyway (build_pillar.py): the gap is continuous, so
 *      the part is a recipe over four ground-pivoted pieces of which only the
 *      shaft is ever scaled, and a recipe is not a thing you put in a hotbar.
 *
 * THE NUMBERS ARE MEASURED, like every other module constant here. The foot and
 * head heights come from `socket_top` and `socket_deck`, the shaft length and
 * the collar height from their own bounds. Only the collar PITCH and the
 * end-clearance are typed, because they are rhythm rather than geometry and the
 * file publishes them nowhere; they are `structure_common.PILLAR_COLLAR_PITCH`
 * and `PILLAR_COLLAR_CLEAR` and nothing else in this client may retype them.
 */
export const PILLAR_PARTS = ['PillarFoot', 'PillarShaft', 'PillarCollar',
  'PillarHead'] as const;
export type PillarPart = typeof PILLAR_PARTS[number];

export interface PillarModule {
  footH: number;
  /** Authored shaft length. It is 1.00 m so that `scale.y` IS metres. */
  shaftLen: number;
  collarH: number;
  headH: number;
  /** Below this the deck is close enough to the ground and nothing is drawn. */
  minH: number;
}

/** Collar rhythm. See the header: not derivable from the shipped geometry. */
const COLLAR_PITCH_M = 2.00;
const COLLAR_CLEAR_M = 0.35;

/** What a failed pillar load leaves behind, from `structure_common.py`. */
export const PILLAR_FALLBACK: PillarModule =
  { footH: 0.40, shaftLen: 1.00, collarH: 0.24, headH: 0.30, minH: 0.70 };

export function measurePillar(root: THREE.Object3D): PillarModule {
  const top = root.getObjectByName('PillarFoot')?.getObjectByName('socket_top');
  const deck = root.getObjectByName('PillarHead')?.getObjectByName('socket_deck');
  const shaft = boundsOf(root, 'PillarShaft');
  const collar = boundsOf(root, 'PillarCollar');
  if (top === undefined || deck === undefined || shaft === null || collar === null) {
    return PILLAR_FALLBACK;
  }
  const footH = top.position.y, headH = deck.position.y;
  return { footH, headH, shaftLen: shaft.max.y - shaft.min.y,
    collarH: collar.max.y - collar.min.y, minH: footH + headH };
}

/**
 * The assembly for a gap of `gapM`, ground at z = 0. `structure_common
 * .pillar_parts` in TypeScript, deliberately arithmetic-for-arithmetic.
 *
 * A collar is dropped when it would land within the clearance of either end of
 * the shaft, because a band crowding the foot or the bracket reads as a mistake
 * rather than as rhythm; the clearance is measured against the collar's own
 * extent, which is why `collarH` appears in the upper bound.
 */
export function pillarPartsFor(gapM: number, p: PillarModule):
{ part: PillarPart; z: number; scaleY: number }[] {
  if (gapM < p.minH) return [];
  const out: { part: PillarPart; z: number; scaleY: number }[] = [
    { part: 'PillarFoot', z: 0, scaleY: 1 },
  ];
  // At exactly the minimum the foot meets the bracket and there is no shaft. A
  // zero-scale instance is a singular matrix rather than an invisible one, so it
  // is omitted instead of drawn flat.
  const len = gapM - p.minH;
  if (len > 1e-3) {
    out.push({ part: 'PillarShaft', z: p.footH, scaleY: len / p.shaftLen });
  }
  const lo = p.footH + COLLAR_CLEAR_M;
  const hi = gapM - p.headH - COLLAR_CLEAR_M - p.collarH;
  for (let k = 1; ; ++k) {
    const z = p.footH + COLLAR_PITCH_M * k;
    if (z > hi) break;
    if (z >= lo) out.push({ part: 'PillarCollar', z, scaleY: 1 });
  }
  out.push({ part: 'PillarHead', z: gapM - p.headH, scaleY: 1 });
  return out;
}

/**
 * A build site: one local metric frame with its origin on the world lattice.
 *
 * `o` is the CORNER of deck cell (0,0), not its centre, so that cell (0,0)'s
 * centre lands exactly on the world lattice cell centre a machine would snap to.
 * A base and a factory therefore share one origin even though they use different
 * grids downstream of it.
 */
export interface Site {
  id: number;
  o: Vec3d;
  up: THREE.Vector3;
  east: THREE.Vector3;
  north: THREE.Vector3;
  /** Distance from the planet centre to the site plane. */
  baseR: number;
  /**
   * The world lattice cell this site was founded on, `"cx,cy,cz"`.
   *
   * It is the site's only position-derived IDENTITY, and it exists for the
   * PROSPECTIVE case: until a site is adopted its `id` is whatever the registry
   * would hand out next, so every unadopted site in the world answers with the
   * same one and two aim points eight metres apart key identically. See
   * `MachinePlacement.machineCellKey`.
   */
  cell: string;
}

/** A structural cell address inside a site. */
export interface Addr {
  kind: StructureKind;
  i: number;
  j: number;
  level: number;
  /** Walls only. 0 spans east on a north line, 1 spans north on an east line. */
  axis: 0 | 1;
  /** Walls only: which way the outward face points. */
  flip: 0 | 1;
}

/**
 * The occupancy key. A wall and a door share one, so an edge takes one part.
 *
 * GP-60. THE SITE ID IS PART OF THE KEY AND USED NOT TO BE, AND THAT WAS A BUG.
 * Every site numbers its own cells from (0,0), so a base founded 100 m away had
 * a cell (0,0) too, and the occupancy map is ONE map: `s.has(key)` therefore
 * answered "already built here" for a cell in a site nothing had ever been built
 * in. The support checks were already site-aware (`hasDeck` compares `siteId`),
 * so this was the one question in the set asked in the wrong space, which is why
 * it survived: every positive test builds one base.
 *
 * Found by `probes/clickonce.js` teleporting 60 m between measured clicks to get
 * fresh ground, and being told the fresh ground was already built on.
 */
export function addrKey(siteId: number, a: Addr): string {
  return isDeck(a.kind) ? deckKey(siteId, a.i, a.j, a.level)
    : `w${a.axis}:${siteId}:${a.i},${a.j},${a.level}`;
}

/** The deck half of `addrKey`, for the several callers that ask about a cell
 *  they have coordinates for rather than an `Addr` they hold. */
export function deckKey(siteId: number, i: number, j: number,
                        level: number): string {
  return `d:${siteId}:${i},${j},${level}`;
}

/** The wall half, likewise. */
export function wallKey(siteId: number, axis: 0 | 1, i: number, j: number,
                        level: number): string {
  return `w${axis}:${siteId}:${i},${j},${level}`;
}

/**
 * Found a site on the world lattice cell containing a point.
 *
 * The tangent axes come from `snapToAxes` against the same basis the machine
 * grid uses, so a site's east is the direction a belt at that spot would run.
 * One tangent convention for the whole game, not two.
 */
export function makeSite(M: OfCoreModule, body: number, edits: number, id: number,
                         p: Vec3d, m: StructureModule,
                         ground: (x: number, y: number, z: number) => number,
                         /** GP-36. The two halves of the budget the plane is
                          *  fitted inside. See StructureTolerance.fitPlane. */
                         bounds: { floatM: number; buryM: number }): Site {
  const s = snapToGround(M, body, edits, p.x, p.y, p.z);
  const up = s.up.clone();
  const basis = new THREE.Vector3(-up.y, up.x, 0);
  if (basis.lengthSq() < 1e-9) basis.set(1, 0, 0);
  const east = snapToAxes(up, basis, basis);
  const north = new THREE.Vector3().crossVectors(up, east).normalize();
  const half = m.cellM * 0.5;
  // GP-36 (DW-33). THE PLANE IS CHOSEN TO FIT THE FOUNDING CELL'S FOOTPRINT, not
  // pinned to its low point. Pinning put the whole spread on the bury side, and
  // at the 4 m module the spread at the default spawn is 1.012 m against a
  // 0.50 m bound, so every cell was refused. `fitPlane` spends the bury budget
  // first and spills the rest into float; the arithmetic and the argument for
  // that direction live in StructureTolerance.ts and not here.
  const centreR = Math.hypot(s.pos.x, s.pos.y, s.pos.z) || 1;
  let lo = Infinity;
  let hi = -Infinity;
  for (const [de, dn] of [[0, 0], [-half, -half], [half, -half], [-half, half],
    [half, half]]) {
    const x = s.pos.x + east.x * de + north.x * dn;
    const y = s.pos.y + east.y * de + north.y * dn;
    const z = s.pos.z + east.z * de + north.z * dn;
    const dev = ground(x, y, z) - Math.hypot(x, y, z);
    lo = Math.min(lo, dev);
    hi = Math.max(hi, dev);
  }
  const baseR = centreR + fitPlane(lo, hi, bounds.floatM, bounds.buryM);
  const k = baseR / centreR;
  return {
    id, up, east, north, baseR, cell: s.cell,
    o: {
      x: s.pos.x * k - east.x * half - north.x * half,
      y: s.pos.y * k - east.y * half - north.y * half,
      z: s.pos.z * k - east.z * half - north.z * half,
    },
  };
}

/** Site-local coordinates of a body-frame point: east, north and up, metres. */
export function localOf(site: Site, p: { x: number; y: number; z: number },
                        out: THREE.Vector3): THREE.Vector3 {
  const dx = p.x - site.o.x, dy = p.y - site.o.y, dz = p.z - site.o.z;
  return out.set(
    dx * site.east.x + dy * site.east.y + dz * site.east.z,
    dx * site.north.x + dy * site.north.y + dz * site.north.z,
    dx * site.up.x + dy * site.up.y + dz * site.up.z,
  );
}

/** Body-frame point for site-local (east, north, up) metres. */
export function worldOf(site: Site, e: number, n: number, u: number,
                        out: Vec3d): Vec3d {
  out.x = site.o.x + site.east.x * e + site.north.x * n + site.up.x * u;
  out.y = site.o.y + site.east.y * e + site.north.y * n + site.up.y * u;
  out.z = site.o.z + site.east.z * e + site.north.z * n + site.up.z * u;
  return out;
}

/**
 * Which cell an aim point names, for a given part.
 *
 * A deck takes the cell it is inside. A wall takes the NEAREST cell edge, which
 * is what makes laying a run of walls a matter of running the crosshair along
 * the line rather than of choosing an axis from a menu. The level comes from the
 * aim point's own height over the site plane, so aiming at a deck top puts the
 * wall on that deck and aiming at a wall top puts the next floor over it.
 */
export function addressAt(site: Site, m: StructureModule, kind: StructureKind,
                          p: Vec3d, flip: number): Addr {
  const l = localOf(site, p, new THREE.Vector3());
  const a = l.x / m.cellM, b = l.y / m.cellM;
  const level = Math.max(0, Math.min(MAX_LEVEL, Math.round(l.z / m.storey)));
  if (isDeck(kind)) {
    return { kind, i: Math.floor(a), j: Math.floor(b), level, axis: 0, flip: 0 };
  }
  const ia = Math.round(a), jb = Math.round(b);
  const f = (flip & 1) as 0 | 1;
  if (Math.abs(a - ia) <= Math.abs(b - jb)) {
    return { kind, i: ia, j: Math.floor(b), level, axis: 1, flip: f };
  }
  return { kind, i: Math.floor(a), j: jb, level, axis: 0, flip: f };
}

/** Where a part with this address stands, and which way it faces. */
export function anchorOf(site: Site, m: StructureModule, a: Addr):
{ pos: Vec3d; fwd: THREE.Vector3 } {
  const C = m.cellM;
  let e: number, n: number, u: number;
  let fwd: THREE.Vector3;
  if (isDeck(a.kind)) {
    e = (a.i + 0.5) * C; n = (a.j + 0.5) * C; u = a.level * m.storey;
    fwd = site.north.clone();
  } else if (a.axis === 0) {
    e = (a.i + 0.5) * C; n = a.j * C; u = a.level * m.storey + m.deckH;
    fwd = site.north.clone().negate();
  } else {
    e = a.i * C; n = (a.j + 0.5) * C; u = a.level * m.storey + m.deckH;
    fwd = site.east.clone().negate();
  }
  if (a.flip === 1) fwd.negate();
  return { pos: worldOf(site, e, n, u, { x: 0, y: 0, z: 0 }), fwd };
}

/**
 * The footprint sample points of a part, in the PART's own local frame (x, z).
 *
 * Local rather than site-local so that a freely placed part, which belongs to no
 * site, is judged by exactly the same rule as a snapped one. A deck is sampled
 * at its four corners and its centre; a wall at its two ends and its centre,
 * because a wall is a line and its 0.25 m cross-axis extent is far below
 * anything the terrain can resolve.
 */
export function footprintOf(m: StructureModule, kind: StructureKind):
[number, number][] {
  const h = m.cellM * 0.5;
  if (isDeck(kind)) {
    return [[0, 0], [-h, -h], [h, -h], [-h, h], [h, h]];
  }
  return [[0, 0], [-h, 0], [h, 0]];
}
