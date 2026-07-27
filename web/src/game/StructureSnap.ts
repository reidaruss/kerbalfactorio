// GP-37: A NEW PART PREFERS AN EXISTING PART'S SOCKET TO THE BARE GRID.
//
// The complaint this exists for, verbatim: "once one is placed, walls or other
// foundations dont snap to the one that was placed." The arithmetic was never
// wrong. A site is one metric tangent frame, so the second foundation already
// landed 1.2e-12 m from the first; what was missing is that the ghost took its
// address from wherever the aim ray happened to STOP, and an aim ray pointed at
// a placed foundation stops on that foundation's own top face. So the answer was
// "already built here" for the whole 4 x 4 m of the thing you were standing on,
// and a player reads that as "it did not snap".
//
// THE SOCKETS ARE READ OFF THE SHIPPED .glb FILES, once, at load. ASSET-SPECS
// 4.23 publishes `socket_edge_n/e/s/w` on a deck as "exactly where a wall's
// origin goes" and `socket_end_l/r` on a wall as its two ends. That is a
// contract the art lane wrote for precisely this and nothing had ever called it.
// Reading it rather than recomputing `cellM * 0.5` is what makes the snap
// MEASURABLE: `probes/snap.js` compares the placed part against the socket it
// caught, and the two are only equal if the client and the assets agree.
//
// NOTHING HERE MAPS A SOCKET BY ITS NAME. `socket_edge_e` is at local +X in the
// asset's own frame, and a deck standing on a site is yawed so that local +X is
// site WEST; a name-to-compass table would be right in Blender and wrong in the
// world. The direction comes from the socket's own local POSITION, rotated by
// the part's quaternion and resolved against the site's east and north, so this
// file is correct for any authored yaw and stays correct if the art lane renames
// anything.

import * as THREE from 'three';
import { isDeck, localOf, type Addr, type Site, type StructureKind }
  from './StructureGrid.js';
import type { StructurePart } from './Structures.js';
import type { Vec3d } from '../world/PlanetBody.js';

/** One authored socket, in its part's own local frame. */
export interface SocketDef { name: string; local: THREE.Vector3 }

/** A socket that an aim point landed near, in the world. */
export interface SocketHit {
  part: StructurePart;
  name: string;
  world: Vec3d;
  distM: number;
}

const EDGE = ['socket_edge_n', 'socket_edge_e', 'socket_edge_s', 'socket_edge_w'];
const END = ['socket_end_l', 'socket_end_r'];

/**
 * How near an aim point must come to a socket to catch it, as a fraction of the
 * module. 0.75 is 3.00 m at the 4 m cell: it covers the whole of a deck's top
 * face (a corner is 2.83 m from the nearest edge midpoint) and one metre of the
 * ground beyond the edge, and it stops short of the cell after next.
 */
export const SNAP_FRACTION = 0.75;

/** Read every socket this set publishes, once, at load. */
export function readSockets(scenes: ReadonlyMap<StructureKind, THREE.Object3D>):
Map<StructureKind, SocketDef[]> {
  const out = new Map<StructureKind, SocketDef[]>();
  for (const [kind, root] of scenes) {
    const want = isDeck(kind) ? EDGE : END;
    const list: SocketDef[] = [];
    for (const name of want) {
      const n = root.getObjectByName(name);
      if (n !== undefined) list.push({ name, local: n.position.clone() });
    }
    out.set(kind, list);
  }
  return out;
}

/** The nearest published socket to `p`, within `maxD` metres, or null. */
export function nearestSocket(parts: readonly StructurePart[],
                              sockets: ReadonlyMap<StructureKind, SocketDef[]>,
                              p: Vec3d, maxD: number): SocketHit | null {
  const v = new THREE.Vector3();
  let best: SocketHit | null = null;
  let bestD = maxD;
  for (const part of parts) {
    if (part.addr === null) continue;   // a freely placed part has no grid
    // Coarse reject first: every socket of a 4 m part is inside one module of
    // its origin, so a part further than maxD + cellM cannot own the answer.
    const dx = part.pos.x - p.x, dy = part.pos.y - p.y, dz = part.pos.z - p.z;
    if (Math.hypot(dx, dy, dz) > bestD + 8) continue;
    for (const s of sockets.get(part.kind) ?? []) {
      v.copy(s.local).applyQuaternion(part.quat);
      const wx = part.pos.x + v.x, wy = part.pos.y + v.y, wz = part.pos.z + v.z;
      const d = Math.hypot(wx - p.x, wy - p.y, wz - p.z);
      if (d >= bestD) continue;
      bestD = d;
      best = { part, name: s.name, world: { x: wx, y: wy, z: wz }, distM: d };
    }
  }
  return best;
}

/**
 * Which way a socket faces, as a step of one cell in the site's own grid.
 *
 * The socket's local offset is rotated into the world and resolved against the
 * site's tangent axes, then reduced to whichever of the four is dominant. See
 * the header: this is deliberately not a table keyed by the socket's name.
 */
function stepOf(site: Site, hit: SocketHit): [number, number] {
  const v = new THREE.Vector3(hit.world.x - hit.part.pos.x,
    hit.world.y - hit.part.pos.y, hit.world.z - hit.part.pos.z);
  const de = v.dot(site.east), dn = v.dot(site.north);
  if (Math.abs(de) >= Math.abs(dn)) return [de >= 0 ? 1 : -1, 0];
  return [0, dn >= 0 ? 1 : -1];
}

/**
 * The address a caught socket proposes for the part in hand, or null when it
 * proposes nothing sensible.
 *
 * A DECK'S EDGE offers two different things depending on what is in hand: to
 * another deck it offers the cell across that edge, which is the "foundations
 * snap to the one that was placed" half; to a wall or a door it offers the edge
 * itself, which is the published meaning of the socket and the "walls snap to
 * it" half. A WALL'S END offers the next wall along the same line, so a run is
 * laid by running the crosshair off the end of the last panel.
 *
 * The wall addressing here is `addressAt`'s, restated in cell terms: a wall on
 * axis 0 runs east along the north line `j`, so a cell's south edge is (i, j)
 * and its north edge is (i, j+1); a wall on axis 1 runs north along the east
 * line `i`, so a cell's west edge is (i, j) and its east edge is (i+1, j).
 */
export function addrFromSocket(site: Site, kind: StructureKind, hit: SocketHit,
                               flip: number): Addr | null {
  const a = hit.part.addr;
  if (a === null || hit.part.siteId !== site.id) return null;
  const [di, dj] = stepOf(site, hit);
  const f = (flip & 1) as 0 | 1;
  if (isDeck(hit.part.kind)) {
    if (!hit.name.startsWith('socket_edge')) return null;
    if (isDeck(kind)) {
      return { kind, i: a.i + di, j: a.j + dj, level: a.level, axis: 0, flip: 0 };
    }
    return di !== 0
      ? { kind, i: di > 0 ? a.i + 1 : a.i, j: a.j, level: a.level, axis: 1, flip: f }
      : { kind, i: a.i, j: dj > 0 ? a.j + 1 : a.j, level: a.level, axis: 0, flip: f };
  }
  // A wall's end only ever offers another wall. Handing a DECK the cell beyond
  // a wall would be inventing a rule the assets do not publish, and the deck
  // already has one that works: aim at the deck the wall is standing on.
  if (isDeck(kind) || !hit.name.startsWith('socket_end')) return null;
  const along: [number, number] = a.axis === 0 ? [di, 0] : [0, dj];
  if (along[0] === 0 && along[1] === 0) return null;
  // The flip is INHERITED, not taken from the rotate key: a run of walls laid
  // end to end should face the same way as the panel it continues, and a player
  // who wants the other face turns the run rather than every panel in it.
  return { kind, i: a.i + along[0], j: a.j + along[1], level: a.level,
    axis: a.axis, flip: a.flip };
}

/** How far a placed part ended up from the socket it caught. The number that
 *  says the snap is real; see `probes/snap.js`. */
export function socketGapM(hit: SocketHit, placed: Vec3d): number {
  return Math.hypot(placed.x - hit.world.x, placed.y - hit.world.y,
    placed.z - hit.world.z);
}

/** Site-local (east, north) of a point, for callers that only have the site. */
export function siteLocal(site: Site, p: Vec3d): [number, number, number] {
  const l = localOf(site, p, new THREE.Vector3());
  return [l.x, l.y, l.z];
}
