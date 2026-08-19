// THE STATION'S PROXIES AND SOCKETS: what the shipped asset says its interior
// and its named points ARE, learned off the loaded glTF once and read back by
// everything else.
//
// Split out of SpaceStation.ts at the 400-line cap (2.2 rule 1). A pure move,
// and a cohesive one: this is the only group that owns `learned` and `spawns`,
// and all three of their writers (learnStationProxies, learnStationSockets,
// resetStationProxies) are here, which is what makes the move safe at all.
// SpaceStation.ts imports and RE-EXPORTS every public symbol, so no import
// site outside this directory changes.
//
// `learned` and `spawns` are exported where they used to be private, because
// `installStation` reads `learned.length` and `spawns.size` directly and
// swapping those for the accessors would be a code change rather than a move.
// An importer can read them and cannot reassign them, which is exactly the
// guarantee that made the move legal.

import * as THREE from 'three';
import type { LocalBox } from './StructureBody.js';

/** A proxy that still knows its own name. */
export interface NamedBox extends LocalBox { name: string }

/**
 * WHY THIS IS NOT `proxiesOf(root)`, which is the same traversal one field
 * narrower.
 *
 * `StructureBody.proxiesOf` drops the node name, because for a machine or a wall
 * the boxes are interchangeable and only their geometry matters. They are not
 * interchangeable here. `StationGravity.ts` derives the artificial-gravity
 * volume from the DECK proxies and stops it at the aft bulkhead jamb, so it has
 * to be able to tell `col_SpineAftFloor` from `col_SpineAftCeil` and to find
 * `col_JambAftFrameL` by name. Running `proxiesOf` for the collider and a second
 * traversal for the gravity would be two answers to "which boxes does this
 * asset have", which is the two-authority failure this project has paid for
 * repeatedly. One traversal, one list, and `stationSolid` drops the names it
 * does not need.
 */
export let learned: readonly NamedBox[] = [];

export function learnStationProxies(root: THREE.Object3D | null): number {
  if (root === null) { learned = []; return 0; }
  const out: NamedBox[] = [];
  root.updateWorldMatrix(true, true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const m = new THREE.Matrix4();
  const seen = new Set<string>();
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh !== true || !mesh.name.startsWith('col_')) return;
    // One proxy per NAMED node, exactly as `proxiesOf` does: GLTFLoader splits a
    // multi-material mesh into `Name_0`, `Name_1`, and the asset lane ships
    // `col_LaunchStep1` rather than `col_LaunchStep_1` because of this rule.
    const base = mesh.name.replace(/_\d+$/, '');
    if (seen.has(base)) return;
    seen.add(base);
    mesh.geometry.computeBoundingBox();
    const bb = mesh.geometry.boundingBox;
    if (bb === null) return;
    const b = bb.clone().applyMatrix4(m.multiplyMatrices(inv, mesh.matrixWorld));
    out.push({ name: base,
      min: [b.min.x, b.min.y, b.min.z],
      max: [b.max.x, b.max.y, b.max.z], leaf: false });
  });
  learned = out;
  return out.length;
}

/** The station's collision proxies, names kept. Empty until the glb is read. */
export function stationProxies(): readonly NamedBox[] { return learned; }

/**
 * WHERE A BODY CAN STAND, and the asset says so rather than this file guessing.
 *
 * THE STATION'S ORIGIN IS NO LONGER EMPTY, which is the single most
 * consequential difference between the placeholder and the shipped mesh and the
 * one that broke a green probe. The placeholder was a 12 x 12 m hub centred on
 * local (0, 0, 0) with nothing in the middle of it, so "the station's position"
 * and "somewhere you can be" were the same point, and everything that wanted to
 * put a player in the station used `stateOf`'s answer directly. The real hub has
 * a STRUCTURAL CORE up the middle of it: `col_HallCore` is a solid column from
 * y = 0.000 to 5.400 spanning +/- 1.548 m in both horizontal axes, and the
 * origin is inside it. `stationwalk.js` P2 went red with "the air above the deck
 * reads solid", which is exactly true and was the right complaint.
 *
 * So the spawn is read from the asset's own `socket_*` empties, which the
 * Blender lane already places and tags (`of_role: spawn`). `socket_hall` sits at
 * local (0, 0, 4.000), four metres out from the core and clear of it. Deriving
 * it means a hub that gets rearranged moves the spawn with it, and it means this
 * file never holds a second opinion about where the floor is.
 */
/**
 * GP-284. A SOCKET IS A FRAME, NOT A POINT.
 *
 * This map used to be `Map<string, [number, number, number]>` and
 * `learnStationSockets` did `setFromMatrixPosition`, so the ROTATION of every
 * socket empty was read out of the asset and thrown away on the floor. That was
 * harmless while the only consumer was `stationStandLocal`, which wants a place
 * to put a pair of feet and does not care which way anything points. It stopped
 * being harmless the moment docking became real: physics cannot aim a capture
 * at a point, because two hulls meeting nose to nose and two hulls meeting nose
 * to tail have identical socket POSITIONS.
 *
 * THE CONVENTION IS THE ASSET LANE'S AND IS NOT RESTATED HERE, IT IS READ FROM
 * THE SAME PLACE THEIR GATE READS IT. `validate_glb.py`'s `socket_frames` block
 * takes `roll` from matrix columns 0..2 and `face` from columns 8..10, which are
 * the empty's own local +X and +Z. So:
 *
 *   face = the socket's local +Z, expressed in STATION-LOCAL space
 *   roll = the socket's local +X, expressed in STATION-LOCAL space
 *
 * and both fall out of ONE matrix (`inv * o.matrixWorld`) rather than from three
 * separate extractions that could disagree about handedness. `contracts.json`
 * declares the station's dock as pos (30.40, 2.20, 0), face +X, roll +Y, and
 * `probes/stationdock.js` asserts the runtime answer against those numbers, so
 * the offline gate and the running client are checked against one contract
 * rather than against each other.
 *
 * WHY THIS WAS INVISIBLE FOR SO LONG, and it is worth writing down: RN-853 found
 * the station's dock socket authored 180 degrees out, facing back into its own
 * hull, which under the anti-parallel rule accepts a vessel arriving from INSIDE
 * the station. Nothing caught it because the asset gate compared positions and
 * had no opinion about axes, and nothing in the client could have caught it
 * either, because the client was discarding the axis before anything could look
 * at it. **Two independent checks both blind in the same way is not two
 * checks.**
 *
 * DIRECTIONS ARE NOT POSITIONS AND THE OLD CODE'S HABIT WOULD HAVE BEEN WRONG
 * FOR THEM. `applyMatrix4` on a `Vector3` is an affine transform and carries the
 * translation, which is correct for a point and silently wrong for an axis: a
 * unit vector run through it comes back offset by the station's own position and
 * then normalised, which is a plausible-looking direction that is not the one in
 * the asset. Composing the matrices first and reading the basis columns out of
 * the composite avoids the question entirely.
 */
export interface StationSocketFrame {
  /** Station-local metres. */
  readonly pos: readonly [number, number, number];
  /**
   * Unit, station-local. THE OUTWARD NORMAL OF THE MATING PLANE: the direction
   * a visiting vessel approaches FROM. Two ports mate when their faces are
   * ANTI-PARALLEL (ASSET-SPECS 4.23), which is the rule that makes a socket
   * pointing into its own hull a defect rather than a preference.
   */
  readonly face: readonly [number, number, number];
  /**
   * Unit, station-local, perpendicular to `face`. The bearing the two hulls
   * agree on. Without it a body of revolution mates at an arbitrary roll and
   * two docked modules are free to rotate against each other, which is the
   * quieter half of RN-853's defect and the half nobody would have reported.
   */
  readonly roll: readonly [number, number, number];
}

export let spawns = new Map<string, StationSocketFrame>();

function unit(x: number, y: number, z: number): [number, number, number] {
  const n = Math.hypot(x, y, z);
  // A degenerate basis column means a zero-scaled empty, which is an asset
  // defect rather than something to paper over: +Z is returned so the value is
  // finite and `probes/stationdock.js` fails on it loudly rather than on a NaN
  // three subsystems downstream.
  return n > 1e-9 ? [x / n, y / n, z / n] : [0, 0, 1];
}

export function learnStationSockets(root: THREE.Object3D | null): number {
  spawns = new Map();
  if (root === null) return 0;
  root.updateWorldMatrix(true, true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const rel = new THREE.Matrix4();
  root.traverse((o) => {
    if (!o.name.startsWith('socket_')) return;
    // ONE composite, then read the basis out of it. See the header: this is
    // what keeps a direction from being run through a translation.
    rel.multiplyMatrices(inv, o.matrixWorld);
    const e = rel.elements;
    spawns.set(o.name, {
      pos: [e[12] ?? 0, e[13] ?? 0, e[14] ?? 0],
      roll: unit(e[0] ?? 1, e[1] ?? 0, e[2] ?? 0),
      face: unit(e[8] ?? 0, e[9] ?? 0, e[10] ?? 1),
    });
  });
  return spawns.size;
}

/** A named socket's POSITION in station-local metres, or null. Unchanged in
 *  shape and in value, so every caller that only wants a place to stand is
 *  untouched by the frame arriving. */
export function stationSocket(name: string): [number, number, number] | null {
  const f = spawns.get(name);
  return f === undefined ? null : [f.pos[0], f.pos[1], f.pos[2]];
}

/** GP-284. The whole frame, which is what a docking capture needs. */
export function stationSocketFrame(name: string): StationSocketFrame | null {
  return spawns.get(name) ?? null;
}

/** Every socket the asset ships, for the debug surface and for probes. */
export function stationSockets(): ReadonlyMap<string, StationSocketFrame> {
  return spawns;
}

/**
 * The spot a player arriving at the station should be put, in station-local
 * metres, with the feet-clearance already added.
 *
 * Falls back to `socket_entry` (the docking vestibule) and then to a point 4 m
 * along +Z, which is the hall socket's own value: if the asset ever ships with
 * no sockets at all, standing 4 m off the core still beats standing inside it.
 */
export function stationStandLocal(): [number, number, number] {
  const s = stationSocket('socket_hall') ?? stationSocket('socket_entry');
  const p = s ?? [0, 0, 4];
  return [p[0], p[1] + 0.6, p[2]];
}

/** Forget the asset. For a teardown; a fresh boot re-learns it. */
export function resetStationProxies(): void { learned = []; spawns = new Map(); }
