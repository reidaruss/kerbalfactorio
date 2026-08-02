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
 * THE PLACEHOLDER INTERIOR, in the station's own frame, +Y up, floor top faces
 * at y = 0. THIS IS SCAFFOLDING AND IS MEANT TO BE DELETED: the Blender lane is
 * authoring the real mesh, and when it lands `proxiesOf(root)` returns exactly
 * this shape (one array of `col_*` boxes off one glb root) so the swap is a
 * one-line change in `stationSolid` and nothing else in this file moves.
 *
 * It is authored to the conventions PH-90 to PH-93 published, so the wiring is
 * proven against the same numbers the real asset is being cut to:
 *
 *   * 2.5 m clear corridor width, 2.5 m clear headroom.
 *   * floors, walls and ceilings as SEPARATE boxes. A single enclosing box
 *     cannot describe an interior, and `deckUnder`'s search window is what
 *     keeps a ceiling from being read as a floor.
 *   * EVERY OVERHEAD PROXY IS 0.8 m THICK (R48). Above the feet the walker has
 *     only three point samples 0.75 m apart and no capsule radius at all, so a
 *     horizontal proxy thinner than that gap fits BETWEEN two samples and is
 *     passed clean through: measured, a 0.3 m ceiling puts the player on the
 *     roof at local y 5.119928. 0.8 m is the first thickness that cannot.
 *   * the doorway is a GAP between two wall boxes, the same three-box trick
 *     `col_Door_Jamb*` uses, because hulling a wall shut is the one mistake
 *     that makes an interior unreachable and reads fine in a screenshot.
 *
 * A jumping player DOES meet the 2.5 m ceiling here (contact at feet 0.85 m,
 * which is 2.5 minus the 1.65 m top sample). That is a bonk, not a leak, and it
 * is the deliberate choice: raising the headroom to the ~4.0 m a free jump
 * needs in this gravity would make the corridor look like a lift shaft.
 */
const HALF_W = 1.25;           // 2.5 m clear corridor width
const HEAD = 2.5;              // 2.5 m clear headroom
const WALL_T = 0.3;
const DECK_T = 0.5;
const OVERHEAD_T = 0.8;        // R48: must exceed the 0.75 m sample gap
const HUB = 6;                 // half extent of the hub room
const CORR_END = 40;           // corridor runs from the hub face to here

function box(name: string, min: [number, number, number],
             max: [number, number, number]): LocalBox & { name: string } {
  return { name, min, max, leaf: false };
}

export const STATION_PROXIES: readonly (LocalBox & { name: string })[] = [
  // --- the hub, a 12 x 12 m room centred on the station origin --------------
  box('col_HubDeck', [-HUB, -DECK_T, -HUB], [HUB, 0, HUB]),
  box('col_HubWall_Xneg', [-HUB - WALL_T, 0, -HUB], [-HUB, HEAD, HUB]),
  box('col_HubWall_Xpos', [HUB, 0, -HUB], [HUB + WALL_T, HEAD, HUB]),
  box('col_HubWall_Zneg', [-HUB - WALL_T, 0, -HUB - WALL_T], [HUB + WALL_T, HEAD, -HUB]),
  // The +Z wall is TWO boxes with a 2.5 m gap between them: that gap is the
  // door into the corridor and it is why these are not one box.
  box('col_HubWall_ZposL', [-HUB - WALL_T, 0, HUB], [-HALF_W, HEAD, HUB + WALL_T]),
  box('col_HubWall_ZposR', [HALF_W, 0, HUB], [HUB + WALL_T, HEAD, HUB + WALL_T]),
  box('col_HubCeiling', [-HUB - WALL_T, HEAD, -HUB - WALL_T],
    [HUB + WALL_T, HEAD + OVERHEAD_T, HUB + WALL_T]),

  // --- the corridor, running +Z out of the hub ------------------------------
  box('col_CorrDeck', [-HALF_W, -DECK_T, HUB], [HALF_W, 0, CORR_END]),
  box('col_CorrWall_Xneg', [-HALF_W - WALL_T, 0, HUB], [-HALF_W, HEAD, CORR_END]),
  box('col_CorrWall_Xpos', [HALF_W, 0, HUB], [HALF_W + WALL_T, HEAD, CORR_END]),
  box('col_CorrCap', [-HALF_W - WALL_T, 0, CORR_END],
    [HALF_W + WALL_T, HEAD, CORR_END + WALL_T]),
  box('col_CorrCeiling', [-HALF_W - WALL_T, HEAD, HUB],
    [HALF_W + WALL_T, HEAD + OVERHEAD_T, CORR_END]),
];

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
 * degree that its top face is perpendicular to the planet radial. That also
 * buys real artificial gravity for free at the local inverse-square value.
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
  return { up: v(0, 1, 0), along: v(0, 0, 1), across: v(1, 0, 0) };
}

export function stationSolid(pos: Vec3n): Solid {
  const quat = stationQuat(pos);
  const boxes = STATION_PROXIES.map((b) => ({ min: b.min, max: b.max, leaf: b.leaf }));
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
 */
export function installStation(M: OfCoreModule, bodies: StructureBodies,
                               up: Vec3n, bodyRadiusM: number, muM3S2: number,
                               tick: number): StationReport | null {
  if (installed !== null) {
    bodies.remove((s) => s === installed);
    installed = null;
  }
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
    proxies: STATION_PROXIES.length,
    solids: bodies.count,
  };
  return lastReport;
}

/** Forget the installed solid without touching the registry. For a world
 *  teardown; the record is the registry's to clear. */
export function resetStationInstall(): void { installed = null; }
