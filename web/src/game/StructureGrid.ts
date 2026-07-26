// THE STRUCTURAL BUILD GRID, and why it is NOT the 1 m voxel lattice.
//
// Machines snap to /core's `of_cell_for_pos` lattice, which is right for them:
// a machine is one object and a belt only has to find the cell ahead of it. It
// is WRONG for a tiling structural set, and the reason is measured rather than
// suspected. The lattice is a 1 m cube grid in the BODY frame, and the ground is
// a sphere cutting through it obliquely, so one unit step of a cell key is 0.59,
// 0.81 or 1.02 m of ground depending on which axis you step along. That already
// split one belt run into three (ARCHITECTURE 15.2 item 102). A foundation is a
// 1.00 m mesh: laid on cell centres it would leave a 0.41 m gap on one axis and
// overlap by 0.02 m on another, and a 20 x 20 m platform would be visibly torn.
//
// So a structure belongs to a SITE: a local metric frame, anchored to one world
// lattice cell (which is what "snap to the world grid" means here) and carrying
// two orthonormal tangent axes. Inside a site the spacing is EXACTLY the module,
// so adjacent parts meet at 0.000 m by construction rather than by luck.
//
// The curvature this ignores is a measured quantity, not an assumption: a
// tangent plane departs from a 600 km sphere by r^2/2R, which is 0.85 mm at 32 m
// from the origin and 0.08 mm at 10 m. A site is capped at SITE_REACH_M so the
// error can never leave that regime, and the probe reads it back.
//
// EVERY MODULE CONSTANT IS MEASURED OFF THE SHIPPED .glb FILES, from the sockets
// the art lane authored for exactly this purpose (ASSET-SPECS 4.23). Nothing
// here retypes 0.50 or 2.50 or 3.00: change the Blender module and this follows.

import * as THREE from 'three';
import { boundsOf } from './StructureBody.js';
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

/** How far from its origin a site may reach, metres. See the curvature note. */
export const SITE_REACH_M = 32;
/** Storeys a site may stack. Four is 12 m, which is a tower already. */
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

/** The occupancy key. A wall and a door share one, so an edge takes one part. */
export function addrKey(a: Addr): string {
  return isDeck(a.kind) ? `d:${a.i},${a.j},${a.level}`
    : `w${a.axis}:${a.i},${a.j},${a.level}`;
}

/**
 * Found a site on the world lattice cell containing a point.
 *
 * The tangent axes come from `snapToAxes` against the same basis the machine
 * grid uses, so a site's east is the direction a belt at that spot would run.
 * One tangent convention for the whole game, not two.
 */
export function makeSite(M: OfCoreModule, body: number, id: number,
                         p: Vec3d, m: StructureModule): Site {
  const s = snapToGround(M, body, p.x, p.y, p.z);
  const up = s.up.clone();
  const basis = new THREE.Vector3(-up.y, up.x, 0);
  if (basis.lengthSq() < 1e-9) basis.set(1, 0, 0);
  const east = snapToAxes(up, basis, basis);
  const north = new THREE.Vector3().crossVectors(up, east).normalize();
  const half = m.cellM * 0.5;
  return {
    id, up, east, north,
    baseR: Math.hypot(s.pos.x, s.pos.y, s.pos.z),
    o: {
      x: s.pos.x - east.x * half - north.x * half,
      y: s.pos.y - east.y * half - north.y * half,
      z: s.pos.z - east.z * half - north.z * half,
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
