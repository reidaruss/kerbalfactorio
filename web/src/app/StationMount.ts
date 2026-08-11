// CE-83 / CE-84. WIRING ANCHORAGE'S GEOMETRY TO ANCHORAGE'S CONIC.
//
// The composition-root half of `world/CarrierGeometry.ts`, in its own file
// because `Boot.ts` is over its line cap and because this is one idea: three
// objects that were posed once at tick 0 now follow one frame.
//
// It is a core-engine file (`app/` is this seat's, section 7b item 4) and it
// reaches into `game/` for exactly two published getters, `lastStationSolid`
// and `lastStationVolumes`, both added for this and both returning the object
// the registries already hold rather than a copy.
//
// ===========================================================================
// THE ATTITUDE IS A MEASURED CONSTANT, NOT AN ASSUMPTION THAT THE TWO AGREE.
// ===========================================================================
//
// `OrbitCarrier.poseAt` publishes an LVLH basis derived from the record's own
// `r x v`. `stationSolid` poses the interior with `stationQuat`, which is
// nadir-pointing from +Y. These are two conventions and NEITHER IS WRONG; CE-30
// says so in as many words ("a consumer that wants the station's authored
// attitude composes its own constant offset rather than this file guessing").
//
// Writing the carrier's own quaternion straight onto the solid would have
// rotated the shipped interior at boot, on a station a player has walked around
// inside, and every assertion in the client would still have passed because the
// hull, the collider and the gravity boxes would all have rotated together. That
// is `orbitdeck.js`'s upside-down corridor exactly: one wrong shared pose is
// self-consistent.
//
// So the offset is MEASURED once, at the install tick, from the pose
// `installStation` actually wrote: `local = poseAt(0)^-1 . authored`. Then
// `syncAt(0)` reproduces the install pose BITWISE, which the probe asserts as a
// positive control, and every later tick turns the whole assembly with the
// conic. The day physics stamps the record, this file does not change.
//
// ===========================================================================
// AND IT DOES NOTHING TODAY, WHICH IS SAID HERE SO NOBODY READS IT AS THE
// FEATURE.
// ===========================================================================
//
// `mintStation` ships Anchorage with `stampedTick = -1`, so `clockAt` returns
// the same clock for every tick and this mount writes identical numbers 60
// times a second. The station does not move because its conic is frozen, and
// unfreezing it is physics' half of D-014. What this file buys is that when
// that happens, THE INTERIOR DOES NOT BREAK: the deck, its freefall region, its
// deck generators and its drawn hull all follow the same `poseAt` the rider
// does, so the person standing on it and the thing they are standing on are one
// concept with two consumers.
import type { CarrierMounts, CarrierMount } from '../world/CarrierGeometry.js';
import { OrbitCarrier } from '../world/CarrierSources.js';
import {
  applyInv, composePose, invertPose, newPose, type V3,
} from '../world/FramePose.js';
import * as THREE from 'three';
import { findStation, lastStationSolid } from '../game/SpaceStation.js';
import { lastStationVolumes } from '../game/StationGravity.js';
import type { CarrierFrame, CarrierRegistry } from '../world/CarrierFrame.js';
import type { OfCoreModule } from '../sim/wasm/heap.js';
import type { StationView } from '../render/StationView.js';

/** The carrier id Anchorage's frame is registered under. Published because
 *  `Services.carriers.get(id).poseAt(tick, out)` is the one authority any other
 *  domain binds to (core-engine section 7 R13), and a literal in two files is
 *  two ids. */
export const STATION_CARRIER_ID = 'station:anchorage';

/**
 * Give the station's collision solid, gravity volumes and drawn hull one moving
 * frame. Returns the mount, or null if there is no station to mount.
 *
 * REFUSES QUIETLY AND COMPLETELY. A boot with no station asset has no record,
 * no solid and no volumes, and this must then register NOTHING: a carrier in
 * the registry with no geometry on it would appear in every census as a frame
 * that exists, and `of.carrier('board')` would offer a ride on a station that
 * is not there.
 */
export function mountStation(M: OfCoreModule, carriers: CarrierRegistry,
                             mounts: CarrierMounts,
                             view: StationView | null): CarrierMount | null {
  const rec = findStation();
  const solid = lastStationSolid();
  if (rec === null || solid === null) return null;

  const frame = new OrbitCarrier(STATION_CARRIER_ID, M, rec);
  carriers.add(frame);
  // Tick 0, the SAME tick `installStation` posed the solid at.
  return mountStationOn(mounts, frame, view, 0);
}

/**
 * Attach the station's three consumers to `frame`, holding it EXACTLY WHERE IT
 * IS RIGHT NOW.
 *
 * Split out of `mountStation` because the debug surface needs the identical
 * derivation against an instrument frame: Anchorage's conic is frozen, so the
 * shipping mount is the identity element of its own operation and a probe that
 * only drove it would prove nothing (GP-142). One function, so the thing a
 * probe measures is the thing that ships, rather than a second path kept in
 * agreement with it.
 *
 * `at` is the tick whose frame pose the current geometry is taken to be
 * coincident with. Boot passes 0; a re-mount passes the live tick, which is
 * what makes a swap continuous rather than a teleport.
 */
export function mountStationOn(mounts: CarrierMounts, frame: CarrierFrame,
                               view: StationView | null,
                               at: number): CarrierMount | null {
  const solid = lastStationSolid();
  if (solid === null) return null;

  // THE AUTHORED POSE, READ BACK OFF THE OBJECT ITSELF, not re-derived from the
  // record. Re-deriving it would be a second computation of the same pose, and
  // the two would agree right up until one of them was edited.
  const authored = newPose();
  authored.px = solid.pos.x; authored.py = solid.pos.y; authored.pz = solid.pos.z;
  authored.qx = solid.quat.x; authored.qy = solid.quat.y;
  authored.qz = solid.quat.z; authored.qw = solid.quat.w;

  // local = poseAt(at)^-1 . authored.
  const local = newPose();
  composePose(invertPose(frame.poseAt(at, newPose()), newPose()), authored, local);

  const m = mounts.mount(frame);
  m.attach(solid, 'station:solid', local);
  for (const v of lastStationVolumes()) {
    // CE-39. POSED BY THE FRAME, BUT NOT PART OF WHERE THE STATION IS.
    // `bounds: false` keeps these two out of `containsPoint`. The freefall
    // volume's radius is 207.85 m against the interior's 28.64 m, so including
    // it would board a player 179 m outside anything they could stand on, and it
    // would do so by reading the GRAVITY MODEL: resize the volume for a gravity
    // reason and who is riding the station changes with it. Admin ruled against
    // that coupling and this is where the ruling lives.
    m.attach(v, `station:gravity:${v.mode}`, local, { bounds: false });
  }
  if (view !== null) {
    // The drawn hull, through its OWN published setter. `StationView.place`
    // already exists and already takes the f64 body-frame pose; calling it per
    // tick instead of once at boot is the whole of the render change, and
    // `render/` is not touched.
    const q = new THREE.Quaternion();
    m.watch((p) => {
      q.set(p.qx, p.qy, p.qz, p.qw);
      view.place([p.px, p.py, p.pz], q);
    }, 'station:view', local);
  }
  return m;
}

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
  carrier: string;
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
): StationSeat | null {
  if (seat === null || walker === null) return null;
  const solid = lastStationSolid();
  const mount = mounts.mountCarrying(solid);
  if (solid === null || mount === null) return null;

  const frame = mount.frame;
  const dest: V3 = { x: 0, y: 0, z: 0 };
  applyInv(frame.poseAt(tick, newPose()),
    solid.pos.x, solid.pos.y, solid.pos.z, dest);

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
    carrier: frame.id,
    feet: [pos.x, pos.y, pos.z],
    vel: [vel.x, vel.y, vel.z],
    speedMS: Math.hypot(vel.x, vel.y, vel.z),
    tick,
  };
}
