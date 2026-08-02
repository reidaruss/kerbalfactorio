// PH-94 to PH-97. A PLACE IN ORBIT YOU CAN WALK AROUND INSIDE.
//
// TWO SYSTEMS COMPOSED, NOT ONE SYSTEM WIDENED, which is the disposal PH-90's
// measurement pass earned:
//
//   the station's ORBIT     is a `VesselRecord` on a conic (VesselRegistry.ts),
//                           which buys the map marker, the selectable orbit
//                           line, the panel row and the `writeSlot` save path
//                           for no new code at all.
//   the station's INTERIOR  is a set of `Solid`s in the same `StructureBodies`
//                           the base, the pads and the factory already share,
//                           because PH-90 measured that a `col_*` proxy holds
//                           the walker up 400 km above the terrain with a feet
//                           spread of exactly 0.000000 m.
//
// A vessel record cannot describe an interior (there is no asset field; a
// vessel's mesh is always derived per-part from the /core catalogue) and a
// solid set cannot describe an orbit. Neither was widened to pretend otherwise.
//
// WHY THE INTERIOR IS FROZEN IN THE BODY FRAME, and this is the load-bearing
// sentence: `KinematicBody.step` integrates an ABSOLUTE body-frame position and
// there is no carrier-frame term in the signature, nor anywhere to put one. A
// floor moving at orbital speed would therefore leave the player behind at
// 7500 m/s / 60 Hz = 125 m PER TICK. "The station is stationary in its own
// frame" is not a preference, it is the only arrangement in which the walker
// this project already has works at all.
//
// WHAT THAT GIVES UP, stated rather than hidden: the ground does not slide past
// underneath. A real 400 km orbit crosses a ground track at about 7.5 km/s and
// this one does not move at all. PH-87 already established that planet rotation
// is purely cosmetic here (`bodySpinRadS` is 0.0, /core has no sun and no
// ground-track coupling), so nothing dynamical couples to the omission; it is a
// missing view out of the window and not a missing physics.
//
// AND THE RECORD IS NEVER STAMPED, WHICH IS WHAT MAKES THE FREEZE HONEST rather
// than a second authority. `VesselRegistry.clockAt` returns `rec.clockS`
// unchanged while `stampedTick` is -1, so an unstamped record never advances
// along its conic: nothing asks, so it never moves (PH-65's rule taken to its
// limit). The interior's frozen pose and `stateOf`'s derived position are
// therefore THE SAME NUMBER BY CONSTRUCTION and cannot drift apart, which is
// exactly the two-authority trap DW-26 exists to refuse. If a future lane wants
// the station to actually travel, the thing to change is this sentence, and the
// walker needs a carrier frame before that is possible.

import * as THREE from 'three';
import { boundOf, type LocalBox, type Solid, type StructureBodies }
  from './StructureBody.js';
import type { OfCoreModule } from '../sim/wasm/heap.js';
import {
  fitConic, registry, stateOf, type VesselRecord, type Vec3n,
} from '../sim/VesselRegistry.js';

/** Where it flies. 400 km circular, which is the altitude PH-90 measured at. */
export const STATION_ALT_M = 400_000;
export const STATION_NAME = 'Anchorage';
/** Marks the record as a place rather than a vehicle. See `isStation`. */
export const STATION_TAG = 'station:anchorage';

/**
 * THE SOLID'S ID IS NaN, AND THAT IS A CLAIM ABOUT THE ID SPACE RATHER THAN
 * ABOUT ITS SIZE.
 *
 * `StructureBodies` is shared by four owners now and the other three resolve a
 * ray hit back to their own object by comparing ids, not by object identity:
 * `Structures.pick` (Structures.ts:365), `Structures.remove` (351),
 * `LaunchPad.pick` (LaunchPad.ts:225) and `LaunchPads.remove` (200, 214). A
 * station solid carrying any INTEGER could therefore be resolved to whichever
 * structural part or pad happened to share it, and the player would demolish a
 * wall by aiming at the station.
 *
 * The existing owners partition the space by sign (parts count up from 1, pads
 * count down from -1, the factory is always 0), and FactorySolids.ts is
 * explicit that an OFFSET would be "a bet on how many pads a world will ever
 * hold". There is no integer left that is safe against two unbounded counters.
 *
 * `NaN === NaN` is false, so a station solid is matched by NOBODY, by every one
 * of those four comparisons, forever, and by a fifth owner added later without
 * that owner having to know this file exists. Nothing does arithmetic on
 * `Solid.id` and nothing serialises it (the interior is DERIVED, never saved),
 * so the value has no other job to do. Removal here is by object identity.
 */
const STATION_SOLID_ID = Number.NaN;

/**
 * THE REAL INTERIOR, READ OFF THE SHIPPED ASSET (PH-105).
 *
 * The placeholder that used to be here is gone. It was twelve boxes authored in
 * code at 2.5 m headroom, and its comment argued that 4.0 m "would make the
 * corridor look like a lift shaft". THE ASSET LANE WENT TO 4.0 m AT 3.0 m WIDE
 * AND ITS SCALE RENDER DISPROVES THAT, so the argument goes with the boxes it
 * was defending. Nothing about it survives except the conventions it was cut to,
 * and the shipped mesh honours every one of them (measured off the glb, not
 * taken on trust):
 *
 *   deck top faces      y = 0.000 on all six deck runs, which is the datum the
 *                       frozen pose and `stateOf` already share.
 *   headroom            4.000 m (ceiling undersides at y = 4.000 against deck
 *                       tops at 0.000), against the placeholder's 2.5.
 *   corridor width      3.000 m clear (wall inner faces at z = +/- 1.500).
 *   overhead proxies    0.800 m thick, which is R48's floor exactly: above the
 *                       feet the walker has three point samples 0.75 m apart
 *                       and no capsule radius, so a thinner slab fits BETWEEN
 *                       two samples and is passed clean through.
 *   doorways            gaps between jamb pairs with a lintel over them, never
 *                       a hulled-shut wall.
 *
 * THERE IS NO FALLBACK SHAPE AND THAT IS DELIBERATE. A hand-authored stand-in
 * for a file that failed to load is a second authority about the station's
 * interior, and it would be silently wrong rather than loudly absent: the player
 * would walk around inside a twelve-box ghost of a fifty-seven-box station and
 * every instrument would agree with itself. If the glb does not arrive,
 * `installStation` returns null and says so.
 */
export const STATION_ASSET = 'assets/structures/space_station.glb';

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
let learned: readonly NamedBox[] = [];

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
let spawns = new Map<string, [number, number, number]>();

export function learnStationSockets(root: THREE.Object3D | null): number {
  spawns = new Map();
  if (root === null) return 0;
  root.updateWorldMatrix(true, true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const p = new THREE.Vector3();
  root.traverse((o) => {
    if (!o.name.startsWith('socket_')) return;
    p.setFromMatrixPosition(o.matrixWorld).applyMatrix4(inv);
    spawns.set(o.name, [p.x, p.y, p.z]);
  });
  return spawns.size;
}

/** A named socket in station-local metres, or null. */
export function stationSocket(name: string): [number, number, number] | null {
  return spawns.get(name) ?? null;
}

/** Every socket the asset ships, for the debug surface and for probes. */
export function stationSockets(): ReadonlyMap<string, [number, number, number]> {
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

/** A design with no parts. `adoptSaved` requires `design.parts` to be an array
 *  and nothing else, and a station has no parts because it is not built in the
 *  bay. `promoteVessel` refuses a record it cannot rebuild, which is the
 *  correct answer for a place: you walk into it, you do not fly it. */
function emptyDesign(): VesselRecord['design'] {
  return { v: 1, name: STATION_NAME, parts: [], stages: [] };
}

/** Is this record the station rather than a vehicle? */
export function isStation(rec: VesselRecord): boolean {
  return rec.status === STATION_TAG;
}

export function findStation(): VesselRecord | null {
  return registry.list().find(isStation) ?? null;
}

/**
 * Mint the station's record: a circular orbit at `STATION_ALT_M` passing
 * through the radial `up`, with the velocity along local east.
 *
 * The elements come from `/core`'s own `of_orb_park` through `fitConic` and are
 * NOT computed here. A circular orbit is the one case where writing the six
 * elements out by hand looks harmless, which is exactly why it is refused:
 * a second Kepler fit in TypeScript is a second physics, and the day the two
 * disagree the map draws one orbit and the propagator flies another.
 */
export function mintStation(M: OfCoreModule, up: Vec3n, bodyRadiusM: number,
                            muM3S2: number): VesselRecord | null {
  const r = bodyRadiusM + STATION_ALT_M;
  const u = new THREE.Vector3(up[0], up[1], up[2]).normalize();
  // The SAME east the walker uses (ViewSource.tangentFrame): Y x up. Sharing
  // the basis is what keeps the station's "along the corridor" and the
  // player's "north" from being two different tangent frames.
  const east = new THREE.Vector3(0, 1, 0).cross(u);
  if (east.lengthSq() < 1e-12) east.set(1, 0, 0);
  east.normalize();
  const speed = Math.sqrt(muM3S2 / r);
  const pos: Vec3n = [u.x * r, u.y * r, u.z * r];
  const vel: Vec3n = [east.x * speed, east.y * speed, east.z * speed];
  const el = fitConic(M, pos, vel, muM3S2, 0);
  if (el === null) return null;
  return registry.adopt({
    id: registry.allocateId(),
    name: STATION_NAME,
    mode: 'rails',
    design: emptyDesign(),
    fired: 0, fuel: [], handles: [],
    where: { kind: 'conic', el },
    pose: {
      fwd: [east.x, east.y, east.z], right: [u.x, u.y, u.z], angVel: [0, 0, 0],
      throttle: 0, sasMode: 0, command: [0, 0, 0],
    },
    clockS: 0,
    // NEVER STAMPED. See the header: this is what makes the frozen interior and
    // the derived conic position the same number rather than two of them.
    stampedTick: -1,
    status: STATION_TAG,
    metS: 0, liftedOff: false, releases: 0, stagings: 0, maxQPa: 0,
    onPad: false, padRadiusM: 0, padUp: [0, 1, 0],
  });
}

/**
 * The station's interior as ONE `Solid`, posed so its local +Y is the radial at
 * its own position: NADIR POINTING, which PH-91 established is the only
 * orientation that works. "Down" in this codebase is `p/|p|` derived per tick
 * from the feet, with no override anywhere, so a deck is a floor exactly to the
 * degree that its top face is perpendicular to the planet radial.
 *
 * WHAT USED TO BE THE NEXT SENTENCE IS RETRACTED (PH-98, and this is its
 * correction rather than its deletion). It said nadir pointing "buys real
 * artificial gravity for free at the local inverse-square value, 3.49886
 * m/s^2". That is true of the FIELD STRENGTH and false of what an occupant
 * feels, and the difference is the whole of orbital flight: a station at 400 km
 * is in FREEFALL, it accelerates toward the planet at exactly the local g, and
 * so does everything inside it, so nothing inside has any weight at all. The
 * frozen-in-the-body-frame station this file builds is dynamically A TOWER ON A
 * 400 KM PILLAR, and a tower is the one thing an orbit is not. Nadir pointing
 * buys the deck an ORIENTATION and nothing else. The gravity on it is
 * GENERATED, it is `StationGravity.ts`'s, and it can be switched off.
 *
 * `setFromUnitVectors` rather than a hand-rolled axis-angle: the first version
 * of `probes/orbitdeck.js` hand-rolled it, got the cross-product sign backwards
 * and turned the corridor UPSIDE DOWN, and every assertion still passed because
 * a slab upside down is still a floor.
 */
export function stationQuat(pos: Vec3n): THREE.Quaternion {
  const up = new THREE.Vector3(pos[0], pos[1], pos[2]).normalize();
  return new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), up);
}

/**
 * The station's own axes in the BODY frame, published so a probe can aim down
 * the corridor by reading the game's orientation rather than recomputing it.
 * Standing rule 11: a probe that rebuilt the quaternion would agree with itself
 * whatever the station did, and the first `orbitdeck.js` proved that is not
 * hypothetical (it rebuilt the rotation, got the sign wrong, and passed).
 */
export function stationAxes(pos: Vec3n): { up: Vec3n; along: Vec3n; across: Vec3n } {
  const q = stationQuat(pos);
  const v = (x: number, y: number, z: number): Vec3n => {
    const w = new THREE.Vector3(x, y, z).applyQuaternion(q);
    return [w.x, w.y, w.z];
  };
  // `along` IS THE SPINE, AND IT CHANGED AXIS WITH THE ASSET (PH-105).
  //
  // It used to be local +Z, because the placeholder's one corridor ran +Z out
  // of a hub. The shipped station's spine runs along local X -- 66 m of it, aft
  // at -X to the blown bulkhead and forward at +X to the docking collar -- and
  // the branches run along Z. A probe that kept walking +Z would have walked
  // into the side of the hall and reported a corridor that did not go anywhere,
  // which is a name lying rather than a number being wrong. `along` means along
  // the corridor; the corridor moved; the axis follows it.
  return { up: v(0, 1, 0), along: v(1, 0, 0), across: v(0, 0, 1) };
}

/**
 * `stationStandLocal()` in the BODY frame: the point to put a player at.
 *
 * The one place the local-to-body transform for the spawn is written, so a
 * caller never composes the quaternion themselves. `stationwalk.js` P4 already
 * pays for the general version of that lesson.
 */
export function stationStandBody(pos: Vec3n): Vec3n {
  const l = stationStandLocal();
  const v = new THREE.Vector3(l[0], l[1], l[2]).applyQuaternion(stationQuat(pos));
  return [pos[0] + v.x, pos[1] + v.y, pos[2] + v.z];
}

export function stationSolid(pos: Vec3n): Solid {
  const quat = stationQuat(pos);
  const boxes = learned.map((b) => ({ min: b.min, max: b.max, leaf: b.leaf }));
  return {
    id: STATION_SOLID_ID,
    pos: { x: pos[0], y: pos[1], z: pos[2] },
    quat,
    boxes,
    cx: pos[0], cy: pos[1], cz: pos[2],
    cr: boundOf(boxes),
    shut: true,
  };
}

export interface StationReport {
  /** Whether a record existed already (a restore) or was minted (a new world). */
  minted: boolean;
  id: number;
  /** Body-frame position the interior is frozen at, from `stateOf`. */
  pos: Vec3n;
  /** Radius of the deck the player stands on, which is `|pos|`. */
  deckR: number;
  altM: number;
  proxies: number;
  /** Sockets the asset ships. 0 means the spawn fell back (see `stationStandLocal`). */
  sockets: number;
  /** Body-frame point a player arriving at the station should be placed at. */
  standPos: Vec3n;
  solids: number;
}

let installed: Solid | null = null;
let lastReport: StationReport | null = null;

/** What the last `installStation` did. Held here rather than threaded back
 *  through `Boot`, which has no use for it: the only reader is the debug
 *  surface, and `minted` is the field the reload proof turns on (a restored
 *  world must ADOPT its saved station, never mint a second one). */
export function lastStationInstall(): StationReport | null { return lastReport; }

/**
 * Put the station in the world: ensure the record exists, derive the interior's
 * pose from it, and register the interior with the walker's solid set.
 *
 * Called AFTER `resumeWorld`, so a restored world adopts its saved record and
 * only a genuinely new world mints one. The interior is derived from the record
 * on EVERY boot and is never itself saved, which is the whole reason the reload
 * proof is about nine numbers and not about a box list.
 *
 * REFUSES WITH NO PROXIES LEARNED, and that refusal is the point of having no
 * fallback shape: a station whose asset did not arrive is a record with nothing
 * to stand on, and installing it would put a player in a place with an orbit, a
 * map marker and a panel row but no floor. Better absent than hollow.
 */
export function installStation(M: OfCoreModule, bodies: StructureBodies,
                               up: Vec3n, bodyRadiusM: number, muM3S2: number,
                               tick: number): StationReport | null {
  if (installed !== null) {
    bodies.remove((s) => s === installed);
    installed = null;
  }
  if (learned.length === 0) return null;
  const existing = findStation();
  const rec = existing ?? mintStation(M, up, bodyRadiusM, muM3S2);
  if (rec === null) return null;
  const { pos } = stateOf(M, registry, rec, tick);
  const solid = stationSolid(pos);
  bodies.add(solid);
  installed = solid;
  lastReport = {
    minted: existing === null,
    id: rec.id,
    pos,
    deckR: Math.hypot(pos[0], pos[1], pos[2]),
    altM: Math.hypot(pos[0], pos[1], pos[2]) - bodyRadiusM,
    proxies: learned.length,
    sockets: spawns.size,
    standPos: stationStandBody(pos),
    solids: bodies.count,
  };
  return lastReport;
}

/** Forget the installed solid without touching the registry. For a world
 *  teardown; the record is the registry's to clear. */
export function resetStationInstall(): void { installed = null; }
