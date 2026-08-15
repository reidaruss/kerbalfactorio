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
// THE PARAGRAPH THAT USED TO BE HERE SAID THE RECORD IS NEVER STAMPED, AND
// ENDED "if a future lane wants the station to actually travel, the thing to
// change is this sentence, and the walker needs a carrier frame before that is
// possible." PH-357, 2026-08-03: the walker has a carrier frame now (CE-80 to
// CE-86 bound the collision solid, both gravity volumes and the drawn hull to
// one `poseAt`, with a rider drifting 1.7e-9 m over 600 ticks), so this is that
// sentence being changed. `installStation` stamps the record.
//
// WHAT THE FREEZE BOUGHT, so it is clear what was given up: an unstamped record
// never advances, so the interior's boot pose and `stateOf`'s derived position
// were THE SAME NUMBER BY CONSTRUCTION and could not drift apart. That is now
// held by construction of a different kind: both are derived from the ONE
// `poseAt` the rider uses, so they are still one concept with two consumers
// rather than two authorities (DW-26). What the freeze COST was the mission:
// matching a fixed point means killing all 1879.255 m/s of orbital velocity
// against a 2.0 m/s capture limit, which is impossible rather than hard.
//
// AND ONE THING IS STILL WRONG AND IS NAMED RATHER THAN HIDDEN (R97). The
// registry's clock is the LOOP's fixed tick and the flying vessel's is
// `of_fl_step_n`'s, so under time warp the vessel outruns the station: measured
// at ladder 1000x, 121,000 sub-steps against 120 loop ticks. A rendezvous flown
// at 1x is now possible; a rendezvous WARPED to is not, and the fix is a warp
// credit on the rails clock beside the one `dayWarpCredit` already applies to
// the sky.

import * as THREE from 'three';
import { boundOf, type LocalBox, type Solid, type StructureBodies }
  from './StructureBody.js';
import type { OfCoreModule } from '../sim/wasm/heap.js';
import {
  fitConic, registry, stateOf, type VesselRecord, type VesselRegistry, type Vec3n,
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

let spawns = new Map<string, StationSocketFrame>();

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

/**
 * PH-380. `vessel.h`'s `parts::DockingPort`, and it is a raw id for the same
 * reason `Autopilot.ts`'s `AUTOPILOT_PART_ID` is: it is a copy of a fact /core
 * owns, not a derivation, and `core/tests/test_docking.cpp`'s
 * `a_vessel_with_no_port_can_never_be_offered_a_dock` pins it as the ONLY part
 * in the whole catalogue carrying a non-zero `dockCaptureRadiusM`, so this
 * literal and D-015's "a vessel can dock if its design contains a port" are
 * checked against one fact rather than two.
 */
const DOCKING_PORT_PART_ID = 0x0115;

/**
 * D-015, PH-380. A DESIGN WITH ONE PART: A DOCKING PORT, ROOTED, so
 * "does this record's design contain a port" is true of Anchorage the same
 * way it is true of anything built in the bay, closing the half of PH-366
 * that was actually a defect.
 *
 * WHAT THIS DOES NOT CLAIM, said out loud because the other half of PH-366
 * is a decision and not a defect. This part's origin is (0,0,0) on the
 * design's own stack axis, and NOTHING reads it: `FlightDock.ts`'s
 * `stationPort` still derives the port's body-frame POSE from the shipped
 * asset's `socket_dock` empty, which is the physically true source (checked
 * against `contracts.json` by both `validate_glb` and `probes/stationdock.js`)
 * and has no natural correspondence to a rocket-stack's local frame. Making
 * this part's origin ALSO carry a claimed pose would be a second, competing
 * authority over one physical fact -- exactly the failure this project keeps
 * finding and fixing elsewhere -- so it is refused here too. The design exists
 * to make "has a port" decidable; the geometry still comes from the geometry.
 *
 * `adoptSaved` requires `design.parts` to be an array and nothing else, which
 * one part satisfies as well as zero did. What USED to sit here (`emptyDesign`)
 * also doubled, by accident, as the reason `promoteVessel` refused to fly the
 * station: `VesselDesign.fromJson([])` returns 0 and `promoteVessel` refused
 * anything `<= 0`. That accident is retired along with the empty array --
 * `promoteVessel` now refuses a station record BY NAME (`isStation`), so
 * "you walk into it, you do not fly it" is a stated rule again rather than a
 * side effect of what this function used to return.
 */
function stationDesign(): VesselRecord['design'] {
  return {
    v: 1, name: STATION_NAME,
    parts: [{ p: DOCKING_PORT_PART_ID, parent: -1, a: 0, ang: 0, off: 0, st: 0 }],
    stages: [],
  };
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
                            muM3S2: number, bodyId: number): VesselRecord | null {
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
    // GP-650. The body whose radius and mu the conic above was fitted with, and
    // therefore the body it orbits. Passed in rather than assumed 0: a station
    // minted on a boot into `?body=cinder` really is Cinder's.
    bodyId,
    mode: 'rails',
    design: stationDesign(),
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
 * PH-381, GP-866. THE ONE ANSWER TO "WHERE IS A DOCKED VESSEL", layered ON TOP
 * of `stateOf` rather than folded into it.
 *
 * `VesselRegistry.stateOf` stays exactly what its own header claims: the on-
 * rails/frozen/parked answer for ONE record, with no notion of "docked"
 * anywhere in it, because resolving a docked relation means asking what
 * ATTITUDE the host has, and for the only host that exists today that is a
 * GAME rule (`stationQuat`'s nadir-pointing convention, PH-91) rather than an
 * orbital-mechanics fact. `sim/VesselRegistry.ts`'s own header says it "keeps
 * its one dependency direction (it reads /core and nothing else)"; giving it
 * an import of this file for one rule that belongs here would be the same
 * shortcut GP-284's failure class keeps naming. So every reader of a
 * POSSIBLY-DOCKED record's live position takes one extra hop through this
 * function instead of calling `stateOf` directly.
 *
 * THE FORMULA IS THE INVERSE OF `FlightDock.ts`'s `latchFrom`, ON PURPOSE:
 * capture wrote `docked.localPos/localFwd/localRight` in the host's own frame
 * at the instant of the join (`guest_world = host_pos + hostQuat . local`);
 * this undoes exactly that, and nothing else.
 *
 * THE HOST POSE COMES OFF THE LIVE SOLID WHEN ONE IS MOUNTED, and this is a
 * correction of this function's own first draft, which read `stationQuat` of
 * a freshly-solved `stateOf(host)` instead and measured ~31 m of avoidable
 * error (`dockingreload.mjs`, `originToPortM` 30.98 against a <30 m bound).
 * TRACED, not guessed: Anchorage's record IS stamped once `installStation`
 * runs (this file's own header names the day that changed, PH-357), so its
 * conic is not frozen the way the mint-time comment still describes -- it
 * really orbits at ~1879 m/s. `Loop.fixedTick` reads every `onFixedStep`
 * callback (which is what sets `currentVesselTick()`) BEFORE incrementing
 * `tickIndex`, then calls `mounts.syncAt(tickIndex)` AFTER -- CE-85's own
 * comment states the reason ("the deck has to be at `poseAt(t)` when tick t
 * steps".) So the live solid is always posed ONE TICK ahead of
 * `currentVesselTick()`, which is 31.32 m at Anchorage's speed -- the exact
 * number measured. `FlightDock.ts`'s `stationPort()` (which computes
 * `dockTarget.posM`, what a probe's `originToPortM` is measured against) reads
 * the SOLID for exactly this reason, not `stateOf(host, tick)`; matching it
 * needs the same source, not a fresher one.
 *
 * `stationQuat(stateOf(host).pos)` REMAINS THE FALLBACK for the one case the
 * live solid cannot cover: `ResumeBoot.resumeWorld` promotes a parked vessel
 * before `Boot.ts` installs and mounts the station, so nothing has posed a
 * solid yet. A docked guest is never PARKED (it arrived by flying, so its own
 * `mode` is `rails`), so `promoteOnBoot`'s "promote at most the parked one"
 * never actually reaches this function before the station is mounted -- but
 * the fallback is kept rather than assumed unreachable, because a debug or
 * autopilot caller reaching `promoteVessel` some other way is exactly the
 * PH-380 lesson (un-flyability was an accident of one code path, not a rule
 * enforced at every door).
 *
 * RECURSES THROUGH `stateOf` FOR THE HOST'S VELOCITY (and, on the fallback
 * path, its position) rather than requiring the host to be resolved first.
 * That is `adoptSaved`'s "a guest can precede its host in slot order" problem
 * again, solved a different way: because this is asked ON DEMAND rather than
 * walked in one sequential pass, "resolve the host first" falls out of the
 * recursion for free and there is no order to get right.
 *
 * ONLY THE STATION IS A DOCKABLE HOST TODAY (`FlightDock.dockTargetOf`'s own
 * comment: "today that is the station and only the station"). A host that is
 * a flown vessel rather than the station has no attitude rule here yet and
 * falls back to the record's own `where`, honestly wrong in the same way
 * `stateOf` alone is -- but it is a case that cannot occur yet, so it is named
 * rather than guessed at, same as `FlightDock.ts`'s own `hostPort: ''` comment
 * names it.
 */
export function stateOfDocked(M: OfCoreModule, reg: VesselRegistry,
                              rec: VesselRecord, tick: number)
    : { pos: Vec3n; vel: Vec3n } {
  const dock = rec.docked;
  if (dock === undefined) return stateOf(M, reg, rec, tick);
  const host = reg.find(dock.hostId);
  // Orphan latch (should not happen: `adoptSaved`'s second pass drops these
  // and counts them) or a host that is not the station (cannot happen yet,
  // see header): fall back to the record's own answer rather than invent one.
  if (host === null || !isStation(host)) return stateOf(M, reg, rec, tick);
  const hostSt = stateOf(M, reg, host, tick);
  const solid = lastStationSolid();
  const pos: Vec3n = solid !== null
    ? [solid.pos.x, solid.pos.y, solid.pos.z] : hostSt.pos;
  const q = solid !== null ? solid.quat : stationQuat(hostSt.pos);
  const p = new THREE.Vector3(dock.localPos[0], dock.localPos[1], dock.localPos[2])
    .applyQuaternion(q);
  return {
    pos: [pos[0] + p.x, pos[1] + p.y, pos[2] + p.z],
    // WELDED: the guest's velocity IS the host's, off `stateOf` either way
    // (the solid publishes no velocity) -- the alternative (the guest's own
    // frozen-at-capture conic velocity) is exactly the two-conics-walking-
    // apart failure `VesselDock`'s own header describes.
    vel: hostSt.vel,
  };
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
 * CE-83. The registered collision solid itself, or null.
 *
 * Published so that core-engine's `CarrierMount` can re-pose the SAME object
 * `bodies` already holds, once per tick, from the station record's own carrier
 * frame (Admin ruling R13: carrier-local geometry). It is deliberately the
 * object and not a copy: `StructureBodies` queries read `pos`, `quat` and
 * `cx/cy/cz` off the stored solid on every call, so writing those five fields
 * is the entire binding, and handing out a copy would create the second
 * authority for where the station is that D-014 has just finished removing.
 *
 * NOTHING HERE DECIDES WHEN IT MOVES. This file still poses the solid once, at
 * install, from `stateOf`; if no mount is wired the station sits exactly where
 * it always has and every existing assertion about it is unchanged.
 */
export function lastStationSolid(): Solid | null { return installed; }

/**
 * PH-357. WHERE THE STATION IS RIGHT NOW, body-frame metres, or null.
 *
 * Read off the SOLID rather than re-solved from the record, and that is the
 * whole point of it: `CarrierMount.syncAt` writes that solid's `pos` every
 * fixed tick from the record's own `poseAt`, so this is not a second Kepler
 * solve and not a second opinion about where the station is. It is the position
 * of the object the player's feet are resolved against, which is exactly the
 * question every caller is really asking.
 *
 * IT EXISTS BECAUSE STAMPING THE RECORD BROKE A CALLER. `installStation`'s
 * report carries the position the solid was FIRST put at, which was a fact
 * about the station for as long as the station never moved. `VisitSites`
 * teleported the player to it, and one minute of world time after boot that is
 * 112 km from the deck: the player would arrive in empty space and fall 400 km,
 * with every assertion in the install report still perfectly true.
 */
export function stationBodyPosNow(): Vec3n | null {
  const s = installed;
  return s === null ? null : [s.pos.x, s.pos.y, s.pos.z];
}

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
                               tick: number, bodyId: number): StationReport | null {
  if (installed !== null) {
    bodies.remove((s) => s === installed);
    installed = null;
  }
  if (learned.length === 0) return null;
  const existing = findStation();
  const rec = existing ?? mintStation(M, up, bodyRadiusM, muM3S2, bodyId);
  if (rec === null) return null;
  // PH-357. THE STATION'S CLOCK STARTS HERE, and this one line is D-014's other
  // half: core-engine bound the collision solid, both gravity volumes and the
  // drawn hull to one `poseAt` (CE-80 to CE-86), and their handback names this
  // as the whole remaining change on the station's side.
  //
  // IT IS HERE AND NOT IN `mintStation` BECAUSE THERE ARE TWO PATHS. A restored
  // world adopts its saved record, and `stashVessels` drops `stampedTick` on
  // the way out (it is a reference into a loop clock that restarts at zero on
  // every page load), so a station stamped only at mint would freeze again on
  // the first reload and nothing would say so. This function is the one place
  // the station enters the world on both paths.
  //
  // THE TICK MATTERS AND IT IS THE SAME ONE `mountStation` COMPOSES AT.
  // `StationMount` measures the interior's fixed offset as
  // `poseAt(0)^-1 . authored` at the install tick, so stamping at any other
  // tick would rotate and translate the shipped interior by however far the
  // conic had run in between: the deck, the hull and the gravity boxes would
  // all move together and every assertion in the client would still pass.
  // Boot calls this with 0 and `mountStation` composes at 0.
  registry.stamp(rec, tick);
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
