// Boarding the walker onto the station's frame, at rest in it. Split out of
// StationMount.ts (line-cap batch 2, BT-285): reaches into StationArrival.ts
// for the scan and the live pose, and into world/CarrierGeometry.js for the
// mount, and nothing here is reached from either of those groups.

import { apply, applyInv, newPose, type V3 } from '../world/FramePose.js';
import { lastStationSolid } from '../game/SpaceStation.js';
import type { CarrierMounts } from '../world/CarrierGeometry.js';
import type { CarrierFrame } from '../world/CarrierFrame.js';
import {
  capsuleClearAt, stationSolidPose, stationArrivalBody, type SolidQuery,
} from './StationArrival.js';

// ===========================================================================
// CE-41. ARRIVING ON A MOVING DECK.
// ===========================================================================
//
// `Controller.standAt` puts the feet at a body-frame point and ZEROES THE
// VELOCITY, which on a moving carrier is not "at rest on the station", it is
// "at rest in the body frame", i.e. a player left behind at the station's full
// 1879.26 m/s. That is the defect, stated by `CarrierRide.restAt` in its own
// words, and the two readings differ ONLY in this velocity.
//
// The fix is the sequence `__of.carrier('standLocal')` has been measuring since
// CE-37, promoted out of the debug surface into the shipped press. It is
// promoted rather than copied: a second spelling of it would be the two-
// authority shape this project keeps paying for, and the debug op now shares
// this function.
//
// NOTHING BELOW TOUCHES `Controller` OR `KinematicBody`. CE-33's boundary is
// that `step()` never learns frames exist, and it still does not: `standAt` is
// called exactly as it always was, and the velocity it zeroed is overwritten
// afterwards through the body's own published field.
//
// DEFERRED, NAMED HERE BECAUSE THIS IS THE SEAM THEY LAND ON:
//   R98  save/load while aboard. `VesselSave` drops `stampedTick` by design and
//        `stashVessels` restores it as -1, so a save taken aboard a moving
//        station reloads onto a frozen one and the rider is silently seated on
//        a carrier that no longer moves. Persistence's choke point, not this
//        file's, and not fixed here.
//   R93  dock-then-EVA. There is no `of_dk_*` symbol in the wasm at all, so
//        there is no path by which a vessel arrives at Anchorage and its
//        occupant steps out onto this deck. Physics owns it.
//   R97  time warp while riding. Verified unreachable in this build rather than
//        guarded: warp lives on `FlightControls` -> `FlightSession.setWarp`,
//        which only exists while the active view source is a `VesselObserver`,
//        and `DayCycle` states the rule ("warp is flight-local by design"). A
//        boarded rider is a walker and has no warp key and no warp cheat. The
//        day R93 opens the door, the refusal belongs here.
//   R17  `mountStation` is called OUTSIDE `buildBodyScope` (Boot.ts), so
//        `__of.reboot()` runs `mounts.clear()` and nothing re-mounts: after a
//        reboot the station has no frame, `decideAt` finds nothing to board and
//        a player standing in the hub is silently never carried again. Named in
//        `probes/stationboard.js` too. It is a Boot ordering fix and Boot is not
//        this lane's file.


/** The rider's seat, structurally: the two `CarrierRide` verbs this needs. */
export interface DeckSeat {
  readonly carrier: CarrierFrame | null;
  board(f: CarrierFrame): void;
  restAt(tick: number, dt: number, x: number, y: number, z: number,
         outPos: V3, outVel: V3): boolean;
}

/** The walker, structurally: PH-90's door plus the body-frame velocity field. */
export interface DeckWalker {
  standAt(x: number, y: number, z: number): void;
  readonly body: { readonly vel: V3 };
}

export interface StationSeat {
  /** CE-49. Metres the arrival scan had to walk along the deck. 0 is the
   *  shipping case (the socket was clear); null when no query was supplied. */
  scannedM: number | null;
  /** CE-49. Whether the capsule is clear at the seat point. Null with no query;
   *  FALSE is the loud reading a re-authored asset produces. */
  clear: boolean | null;
  carrier: string;
  /** CE-54. The point in the STATION'S OWN authored local frame, when the
   *  caller named one; null for the shipped arrival, which names a socket
   *  rather than a coordinate. Published because a caller that asked in local
   *  metres has to be able to check it got them. */
  local: [number, number, number] | null;
  /** Body-frame feet the player was actually put at. */
  feet: [number, number, number];
  /** The station's own velocity at that point, m/s, body frame. */
  vel: [number, number, number];
  speedMS: number;
  tick: number;
}

/**
 * Put the walker on the station's deck AND ON ITS FRAME, at rest in it.
 *
 * Returns null when there is nothing to board (no solid, no mount, no walker, no
 * ride), and the CALLER then falls back to the plain `standAt` that shipped
 * before this existed. A refusal here must never be a crash in a menu press.
 *
 * THE DESTINATION IS THE LIVE DECK AND NOT THE INSTALL RECORD. GP-234 argues
 * that the hub centre is `lastStationInstall().pos` and never a re-derivation,
 * and that is still the authority: the solid's own `pos` IS that authored point
 * carried by the frame, written by the mount every tick, and it is the object
 * `StructureBodies` queries. Reading the tick-0 value instead would put the
 * player where the station was at boot, which on a moving frame is the arrival
 * version of the defect this whole file fixes. On the station as it ships
 * (frozen conic) the two are bitwise identical, and `probes/stationboard.js`
 * asserts exactly that as its positive control.
 *
 * ONE `applyInv`, ONE `poseAt`. The destination is converted parent -> local
 * once and handed to `restAt`, which is the same interval the ride's own tick
 * uses, so seating and then ticking produces zero local drift by construction.
 */
export function seatOnStationDeck(
  mounts: CarrierMounts, seat: DeckSeat | null, walker: DeckWalker | null,
  tick: number, dt: number,
  /** CE-49. The walker's own collision query, so the destination can be checked
   *  before the feet are put there. Optional so a caller with no structure
   *  registry keeps the behaviour that shipped, and null-safe rather than
   *  refusing: a menu press that silently does nothing is worse than one that
   *  lands on the socket unverified. */
  solids: SolidQuery | null = null,
  /**
   * CE-54. A point in the STATION'S OWN authored local frame to seat at, or
   * null for the shipped arrival socket.
   *
   * IT EXISTS SO THAT A CALLER NAMING A SPOT ON THE DECK NEVER HAS TO NAME IT
   * IN THE BODY FRAME. `StationReport.standPos` and `install.pos` are both
   * computed at install and the station has travelled kilometres by the time
   * anything reads them (RN-1412: `stationdraw.js` aimed at `install.standPos`
   * and arrived 5,352 m off the live deck, outside the 28.64 m bound, so no
   * membership rule could catch it). A LOCAL point cannot go stale, because it
   * is resolved against the live pose here, at the tick it is used.
   *
   * THE CE-49 SCAN IS DELIBERATELY NOT RUN for this branch: the caller named an
   * exact coordinate, and walking them somewhere else would be the silent
   * relocation the scan's own comment refuses for the socket case. Clearance is
   * still MEASURED and reported, so a probe can assert it.
   */
  localAt: readonly [number, number, number] | null = null,
): StationSeat | null {
  if (seat === null || walker === null) return null;
  const solid = lastStationSolid();
  const mount = mounts.mountCarrying(solid);
  if (solid === null || mount === null) return null;

  const frame = mount.frame;
  // CE-49. THE ARRIVAL POINT, WHICH IS NOT THE HUB CENTRE. It used to be
  // `solid.pos`, the station's local origin, and `col_HallCore` is a solid
  // column through it: measured, `solidBuild` reads TRUE at the feet and at all
  // three walker sample heights there. `stationArrivalBody` is the asset's own
  // spawn socket on the LIVE pose, verified against the walker's own predicate.
  const arrival = localAt !== null || solids === null
    ? null : stationArrivalBody(solids);
  // CE-54. The named local point on the LIVE pose, by the same one transform
  // the socket takes.
  let named: [number, number, number] | null = null;
  let namedClear: boolean | null = null;
  if (localAt !== null) {
    const pose = stationSolidPose(newPose());
    if (pose === null) return null;
    const at: V3 = { x: 0, y: 0, z: 0 };
    apply(pose, localAt[0], localAt[1], localAt[2], at);
    named = [at.x, at.y, at.z];
    namedClear = solids === null
      ? null : capsuleClearAt(solids, pose, localAt[0], localAt[1], localAt[2]);
  }
  const target = named ?? arrival?.pos
    ?? [solid.pos.x, solid.pos.y, solid.pos.z] as [number, number, number];
  const dest: V3 = { x: 0, y: 0, z: 0 };
  applyInv(frame.poseAt(tick, newPose()), target[0], target[1], target[2], dest);

  seat.board(frame);
  const pos: V3 = { x: 0, y: 0, z: 0 };
  const vel: V3 = { x: 0, y: 0, z: 0 };
  if (!seat.restAt(tick, dt, dest.x, dest.y, dest.z, pos, vel)) return null;
  // `standAt` FIRST: it re-seats the render interpolation's `prevFeet`, which is
  // the one correct way in (PH-31 cost a whole pass on a 400 km streak). Then
  // the velocity it zeroed is put back. Writing `feet` here instead would skip
  // that re-seat, and writing the velocity first would have it zeroed again.
  walker.standAt(pos.x, pos.y, pos.z);
  walker.body.vel.x = vel.x;
  walker.body.vel.y = vel.y;
  walker.body.vel.z = vel.z;
  return {
    scannedM: arrival?.scannedM ?? null,
    clear: arrival?.clear ?? namedClear,
    carrier: frame.id,
    local: localAt === null ? null : [localAt[0], localAt[1], localAt[2]],
    feet: [pos.x, pos.y, pos.z],
    vel: [vel.x, vel.y, vel.z],
    speedMS: Math.hypot(vel.x, vel.y, vel.z),
    tick,
  };
}
