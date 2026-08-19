// THE STATION AS A VESSEL RECORD: where it flies, what marks a record as the
// station rather than a vehicle, how one is minted, and the attitude its
// position alone implies.
//
// Split out of SpaceStation.ts at the 400-line cap (2.2 rule 1). A pure move.
// SpaceStation.ts imports and RE-EXPORTS all of it.
//
// This group knows nothing about the interior solid, which is what lets it sit
// BELOW the install half in the dependency graph rather than beside it.

import * as THREE from 'three';
import type { OfCoreModule } from '../sim/wasm/heap.js';
import { fitConic, registry, type VesselRecord, type Vec3n }
  from '../sim/VesselRegistry.js';

/** Where it flies. 400 km circular, which is the altitude PH-90 measured at. */
export const STATION_ALT_M = 400_000;
export const STATION_NAME = 'Anchorage';
/** Marks the record as a place rather than a vehicle. See `isStation`. */
export const STATION_TAG = 'station:anchorage';

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
