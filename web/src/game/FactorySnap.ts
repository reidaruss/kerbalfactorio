// FS-26: A BELT PREFERS AN EXISTING BUILDING'S SOCKET TO THE BARE GRID.
//
// The complaint this exists for, verbatim: "after a belt is already placed, if i
// want to place another belt to extend it they dont snap together. Or if I
// already have a belt and want to attach a smelter at the end, it doesnt snap to
// it."
//
// The arithmetic was never wrong, and that is worth stating because it is the
// same shape as the base-building lane's finding (GP-37). Machines already live
// on one exact metric site grid (`MACHINE_TILE_M`, 1.000 m), so two tiles laid in
// adjacent cells are already 1.000 m apart to twelve decimal places. What was
// missing is that the ghost took its cell from wherever the aim ray happened to
// STOP, and an aim ray pointed at the end of a belt run stops on the ground
// BEYOND it, or on the run's own last tile, depending on the pitch of the look.
// Either way the answer was a cell chosen by a ray march rather than by the thing
// the player was obviously pointing at, and a player reads that as "it did not
// snap".
//
// THE SOCKETS ARE READ OFF THE SHIPPED .glb FILES, once, at load, exactly as
// `StructureSnap` does for decks and walls. ASSET-SPECS section 4.12 publishes
// `socket_belt_in` and `socket_belt_out` on every belt tile as the line's two
// endpoints, and section 4.15 publishes `socket_item_in` / `socket_item_out` on
// the machines. Those are contracts the art lane wrote for precisely this and
// nothing had ever called them.
//
// NOTHING HERE MAPS A SOCKET BY ITS NAME TO A COMPASS DIRECTION. `socket_belt_out`
// is at the tile's local +Z, and a tile standing on a site is yawed so that local
// +Z is whichever of the four site axes the run runs along; a name-to-axis table
// would be right in Blender and wrong in the world. The direction comes from the
// socket's own local POSITION, rotated by the building's quaternion and resolved
// against the site's east and north, so this file stays correct for any authored
// yaw and survives the art lane renaming anything.
//
// THE MEASUREMENT THAT MAKES IT REAL. Two chained belt tiles have coincident
// sockets by construction: a tile's `socket_belt_out` is at local +Z 0.5 m and the
// next tile's `socket_belt_in` is at local -Z 0.5 m, and the cells are 1.000 m
// apart, so the two world points are the SAME point. `probes/beltsnap.js` places
// the second tile through the snap and measures that gap; it is only small if the
// client and the assets agree, which is the whole reason to read the file rather
// than to hardcode 0.5.

import * as THREE from 'three';
import { FOOTPRINT, type BuildKind, type Placed } from './Factory.js';
import { socketReachM } from './FactoryKinds.js';
import type { MachineAddr } from './MachinePlacement.js';
import type { Site } from './StructureGrid.js';
import type { Vec3d } from '../world/PlanetBody.js';

/** One authored socket, in its building's own local frame. */
export interface SocketDef { name: string; local: THREE.Vector3 }

/** A socket an aim point landed near, resolved into the world. */
export interface SocketHit {
  build: Placed;
  name: string;
  world: Vec3d;
  distM: number;
  /** True when this socket is where items LEAVE the building. */
  outward: boolean;
}

/** What the ghost decided, so the HUD can name it and a probe can assert it. */
export interface SnapProposal {
  addr: MachineAddr;
  /** Site-tangent heading the snapped part should take. */
  fwd: THREE.Vector3;
  hit: SocketHit;
}

/**
 * Which sockets each kind publishes that MEAN something to a placement.
 *
 * `socket_status`, `socket_power_in`, `socket_smoke` and `socket_drill_tip` are
 * deliberately absent: they are render anchors, and offering to snap a belt to a
 * smelter's chimney is how a snap system stops being trusted.
 */
const WANT: Record<string, string[]> = {
  belt: ['socket_belt_in', 'socket_belt_out'],
  miner: ['socket_item_out'],
  smelter: ['socket_item_in', 'socket_item_out'],
  // FS-43: THE ELECTRIC SMELTER WAS MISSING FROM THIS TABLE, and until ports
  // became the connection rule the omission cost nothing visible: an esmelter
  // simply never caught a snap, which reads as a stiff crosshair rather than as
  // a defect. It is a separate `BuildKind` drawing the smelter's own asset
  // (FactoryKinds says why), so it publishes the same two item ports and has to
  // be asked for them under its own key, because `readMachineSockets` is keyed
  // by the TEMPLATE key and not by the file.
  esmelter: ['socket_item_in', 'socket_item_out'],
  // FS-56. THE ASSEMBLER IS THE FIRST BUILDING WITH TWO INLETS, and it names
  // them `_a` and `_b` rather than publishing `socket_item_in` twice, because a
  // glTF scene is looked up by name and a duplicate name is a node you cannot
  // address. Nothing downstream cares which suffix is which: `faceOf` derives
  // the housing face from the socket's own position, so an author who moves
  // input B from the right face to the left one needs no code change here or in
  // `FactoryPorts`. The two are on DIFFERENT faces on purpose, which is what
  // lets two belts arrive at one machine without crossing.
  assembler: ['socket_item_in_a', 'socket_item_in_b', 'socket_item_out'],
};

/** The sockets items LEAVE by. Everything else is an inlet. */
const OUTWARD = new Set(['socket_belt_out', 'socket_item_out']);

/**
 * How near an aim point must come to a socket to catch it, in metres.
 *
 * 0.90 is deliberately just under one MACHINE_TILE_M. It covers the whole of the
 * half-tile between a belt's centre and its endpoint plus most of the free cell
 * beyond, and it stops short of the cell AFTER that, so a player aiming two cells
 * past the head of a run gets the grid and not a surprise jump backwards. Larger
 * would be more forgiving and would also make the run's end reach into ground the
 * player is deliberately pointing at.
 */
export const SNAP_M = 0.90;

/** Read every socket the machine set publishes, once, at load. */
export function readMachineSockets(
  scenes: ReadonlyMap<string, { scene: THREE.Object3D }>,
): Map<string, SocketDef[]> {
  const out = new Map<string, SocketDef[]>();
  for (const [key, entry] of scenes) {
    const want = WANT[key];
    if (want === undefined) continue;
    const list: SocketDef[] = [];
    for (const name of want) {
      const n = entry.scene.getObjectByName(name);
      if (n !== undefined) list.push({ name, local: n.position.clone() });
    }
    if (list.length > 0) out.set(key, list);
  }
  return out;
}

/**
 * Where one socket of one placed building actually is, in body-frame metres.
 *
 * FS-43 widened the parameter from `Placed` to the two fields it actually
 * touches, so a build GHOST can be asked where its ports WOULD be without
 * inventing a fake plan record. `Placed` satisfies it structurally, so no
 * caller moved.
 */
export function socketWorld(b: { pos: Vec3d; quat: THREE.Quaternion },
                            s: SocketDef): Vec3d {
  const v = s.local.clone().applyQuaternion(b.quat);
  return { x: b.pos.x + v.x, y: b.pos.y + v.y, z: b.pos.z + v.z };
}

/**
 * The nearest published socket to `p`, within `maxD` metres, or null.
 *
 * `outwardOnly` IS WHAT KEEPS A SINK DOWNSTREAM. A belt tile publishes both an
 * inlet and an outlet half a metre either side of its centre, so which one an
 * aim catches is decided by 0.5 m of crosshair; that is fine for another BELT,
 * which can legitimately extend either end of a run, and wrong for a smelter,
 * which can only ever be fed. Measured (`probes/shortline.js`): with both
 * sockets offered, a smelter aimed at the middle of a two-tile run caught the
 * tile's INLET and was proposed the cell two steps UPSTREAM, which was the cell
 * the drill needed, and the probe failed at "the drill would not go down beyond
 * the tail" three cells away from the actual cause.
 */
export function nearestSocket(placed: readonly Placed[],
                              sockets: ReadonlyMap<string, SocketDef[]>,
                              p: Vec3d, maxD: number,
                              outwardOnly = false): SocketHit | null {
  let best: SocketHit | null = null;
  let bestD = maxD;
  for (const b of placed) {
    // Coarse reject first. This USED to read `bestD + 1.6`, on the stated
    // grounds that "every socket of these assets is inside 1.6 m of the
    // building's own origin". That was true of a 2 m smelter and a 3 m
    // assembler, and FS-57's 8 m assembler makes it false: its inlets sit
    // 4.000 m out, so a hard 1.6 would have rejected the very building the
    // player was aiming at, silently, as a crosshair that would not catch.
    // Derived now, through FS-59's ONE definition, which `FactoryWiring`'s pair
    // loop had a second hand-written copy of.
    const dx = b.pos.x - p.x, dy = b.pos.y - p.y, dz = b.pos.z - p.z;
    if (Math.hypot(dx, dy, dz) > bestD + socketReachM(b.kind)) continue;
    for (const s of sockets.get(b.kind) ?? []) {
      if (outwardOnly && !OUTWARD.has(s.name)) continue;
      const w = socketWorld(b, s);
      const d = Math.hypot(w.x - p.x, w.y - p.y, w.z - p.z);
      if (d >= bestD) continue;
      bestD = d;
      best = { build: b, name: s.name, world: w, distM: d,
        outward: OUTWARD.has(s.name) };
    }
  }
  return best;
}

/**
 * How many CELLS the new part steps away from the one that caught it.
 *
 * `MACHINE_TILE_M` is 1.000 m and a smelter is 2.000 m across (ASSET-SPECS
 * 4.15), so a 2 m machine placed ONE cell from a belt overlaps that belt's last
 * tile by 0.500 m and is drawn clipping through it. Two cells clears it. The
 * rule is the sum of the two half-extents rounded UP to whole cells: belt to
 * belt is 1.0 and so 1 cell, belt to smelter is 1.5 and so 2 cells.
 *
 * WHAT IT BUYS AND WHAT IT COSTS, both measured (`probes/beltsnap.js`). It buys
 * no clipping and a connection that still forms, because `FactoryWiring`'s
 * belt-to-smelter reach is 2.25 m against the 2.00 m this produces. It costs a
 * 0.500 m gap between the belt tile's leading edge and the smelter's trailing
 * edge, which is the honest residual of putting a 2 m machine on a 1 m grid and
 * is not something this file can fix: `MACHINE_TILE_M` is 1 m on purpose (making
 * it follow the 4 m structural cell laid belt tiles 4 m apart and split one run
 * into four). Closing it needs a half-cell rule for even-footprint machines,
 * which is a placement decision and not a snapping one.
 */
function stepsFor(from: BuildKind, to: BuildKind): number {
  return Math.max(1, Math.ceil((FOOTPRINT[from] + FOOTPRINT[to]) * 0.5));
}

/**
 * Which way a caught socket faces, as one step of the site's own grid.
 *
 * The socket's offset from its building's origin is resolved against the site's
 * tangent axes and reduced to whichever of the four is dominant. See the header:
 * this is deliberately not a table keyed by the socket's name.
 */
export function axisStepOf(site: Site, v: Vec3d): [number, number] {
  const de = v.x * site.east.x + v.y * site.east.y + v.z * site.east.z;
  const dn = v.x * site.north.x + v.y * site.north.y + v.z * site.north.z;
  if (Math.abs(de) >= Math.abs(dn)) return [de >= 0 ? 1 : -1, 0];
  return [0, dn >= 0 ? 1 : -1];
}

function stepOf(addr: MachineAddr, hit: SocketHit): [number, number] {
  return axisStepOf(addr.site, {
    x: hit.world.x - hit.build.pos.x,
    y: hit.world.y - hit.build.pos.y,
    z: hit.world.z - hit.build.pos.z,
  });
}

/**
 * The cell and the heading a caught socket proposes for the part in hand.
 *
 * ONE RULE, APPLIED TWICE. A socket has a side of the building it is on and a
 * direction the ITEMS go through it, and those two together fix both answers:
 * the new part goes in the cell the socket points AT, and it takes the heading
 * that keeps the flow running the same way. So extending a run off its head puts
 * the next tile ahead facing the same way (the run grows), aiming at a run's TAIL
 * socket puts the next tile behind it still facing forward (the run grows
 * backwards, which is how you walk a line back to a drill you forgot), and a
 * smelter caught on a run's head socket lands ahead of it facing along the flow,
 * which is the orientation that puts its own `socket_item_in` back at the belt.
 *
 * `resolve` turns a body-frame point into the address of the cell containing it;
 * it is `Factory.snap` in practice, passed in so this file never has to know the
 * site registry.
 */
export function proposeFromSocket(hit: SocketHit, kind: BuildKind,
                                  resolve: (p: Vec3d) => MachineAddr):
SnapProposal | null {
  const owner = resolve(hit.build.pos);
  const [di, dj] = stepOf(owner, hit);
  if (di === 0 && dj === 0) return null;
  const n = stepsFor(hit.build.kind, kind);
  const addr: MachineAddr = {
    site: owner.site, i: owner.i + di * n, j: owner.j + dj * n,
    prospective: owner.prospective, u: owner.u,
  };
  // The heading is the OWNER's, always: flow direction is a property of the run
  // being extended and not of which end of it the player happened to point at.
  // A tile snapped onto a tail therefore still faces forward, and chains into
  // the tile that caught it rather than away from it.
  const site = owner.site;
  const f = hit.build.fwd;
  const de = f.x * site.east.x + f.y * site.east.y + f.z * site.east.z;
  const dn = f.x * site.north.x + f.y * site.north.y + f.z * site.north.z;
  const fwd = Math.abs(de) >= Math.abs(dn)
    ? (de >= 0 ? site.east.clone() : site.east.clone().negate())
    : (dn >= 0 ? site.north.clone() : site.north.clone().negate());
  return { addr, fwd, hit };
}

/**
 * How far a placed part ended up from the socket that proposed it. The number
 * that says the snap is real; see `probes/beltsnap.js`.
 *
 * `mate` is the socket on the NEW part that should meet the caught one: a belt
 * extending a run's head presents its own `socket_belt_in`, and those two are
 * coincident by construction (0.5 m ahead of one centre is 0.5 m behind the next
 * one, and the cells are exactly 1.000 m apart). When the new part publishes no
 * mating socket the distance falls back to the caught socket against the placed
 * part's ORIGIN, which is the honest thing to report rather than a zero.
 */
export function snapGapM(hit: SocketHit, placed: Placed,
                         sockets: ReadonlyMap<string, SocketDef[]>,
                         mate: string): number {
  const s = (sockets.get(placed.kind) ?? []).find((d) => d.name === mate);
  const p = s === undefined ? placed.pos : socketWorld(placed, s);
  return Math.hypot(p.x - hit.world.x, p.y - hit.world.y, p.z - hit.world.z);
}

/** The socket a newly placed `kind` presents back to a caught socket. */
export function mateFor(kind: BuildKind, hit: SocketHit): string {
  if (kind === 'belt') return hit.outward ? 'socket_belt_in' : 'socket_belt_out';
  return hit.outward ? 'socket_item_in' : 'socket_item_out';
}
