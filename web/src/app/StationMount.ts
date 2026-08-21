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
// RN-2471. `OrbitCarrier.poseAt` publishes an LVLH basis derived from the
// record's own `r x v`. `stationSolid` was BUILT with `stationQuat`, which is
// nadir-pointing from +Y. CE-30 called these two conventions with neither
// wrong, each free to answer a different question ("a consumer that wants
// the station's authored attitude composes its own constant offset rather
// than this file guessing").
// CE-115 (below) and CE-116 (further down, in `mountStationOn`) have since
// settled that only the carrier's convention is LIVE: `stationAxes` no longer
// reconstructs `stationQuat`, and the drawn hull no longer gets a second write
// from it either. `stationQuat` now runs exactly once per boot, to build the
// AUTHORED pose the offset below is measured against, and nowhere else.
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
// CE-115 SETTLED WHICH OF THE TWO IS THE ANSWER, and it is this one. The
// measured offset above makes the ASSEMBLY self-consistent; what it could not
// do is stop `stationQuat` being asked directly, and `SpaceStation.stationAxes`
// was doing exactly that -- publishing a live attitude nothing was drawn with,
// 0.230 degrees out at tick 121 and 1.373 degrees out at tick 721 and growing
// linearly (`probes/stationpose.js`). `stationAxes` reads the mounted solid
// now. `stationQuat` CONSTRUCTS the authored frame at install and is the
// fallback before one exists; it is no longer a live answer to which way the
// station faces. The carrier's LVLH basis won because everything that rides the
// station -- the collider, both gravity volumes, the rider's transport, the
// docking port and the boarding test -- was already using it, and the only
// holdout was the description handed to callers.
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
//
// Split (line-cap batch 2, BT-285) into StationInstall.ts (installing at a
// tick), StationArrival.ts (the deck-plane clearance scan) and StationSeat.ts
// (boarding the walker); this file stays the barrel, holding the mount
// itself (`mountStation`/`mountStationOn`), and re-exports every symbol a
// consumer imported from here before the split.

import type { CarrierMounts, CarrierMount } from '../world/CarrierGeometry.js';
import { OrbitCarrier } from '../world/CarrierSources.js';
import {
  composePose, invertPose, newPose,
} from '../world/FramePose.js';
import * as THREE from 'three';
import { findStation, lastStationSolid } from '../game/SpaceStation.js';
import { lastStationVolumes } from '../game/StationGravity.js';
import type { CarrierFrame, CarrierRegistry } from '../world/CarrierFrame.js';
import type { OfCoreModule } from '../sim/wasm/heap.js';
import type { StationView } from '../render/StationView.js';

export { installAndMountStation, type StationInstallDeps }
  from './StationInstall.js';
export {
  stationSolidPose, stationArrivalBody, type SolidQuery, type StationArrival,
} from './StationArrival.js';
export {
  seatOnStationDeck, type DeckSeat, type DeckWalker, type StationSeat,
} from './StationSeat.js';

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
                             view: StationView | null,
                             /** CE-47. The tick `installStation` posed the solid
                              *  at. Boot passes 0; a rebuild passes the live
                              *  tick, because the conic has run since. Defaulted
                              *  so no existing caller changed. */
                             at = 0): CarrierMount | null {
  const rec = findStation();
  const solid = lastStationSolid();
  if (rec === null || solid === null) return null;

  const frame = new OrbitCarrier(STATION_CARRIER_ID, M, rec);
  carriers.add(frame);
  return mountStationOn(mounts, frame, view, at);
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
    // CE-116. AND POSED HERE, ONCE, RATHER THAN BY THE CALLER.
    //
    // `installAndMountStation` used to call `view.place(st.pos,
    // stationQuat(st.pos))` on the line before this function, which made the
    // drawn hull the ONE thing in the assembly with two writers. The two agreed
    // bitwise at the install tick (the solid is built with the same
    // `stationQuat` of the same `pos`, so `local` absorbed exactly nothing) and
    // that is precisely why it survived: a redundant writer that is correct on
    // the day it is written is the shape PH-357 and CE-115 have now both paid
    // for. Removed there, replaced by this, so `CarrierMount` is the only thing
    // in the program that decides where the hull is.
    //
    // `syncWatchersAt` and not `syncAt`: the collision half is already exactly
    // where `installStation` put it and re-posing it here would be a second
    // write of the pose the offset was just measured against. The `drawn`
    // counter genuinely advances, because the hull genuinely was posed.
    m.syncWatchersAt(at);
  }
  return m;
}
