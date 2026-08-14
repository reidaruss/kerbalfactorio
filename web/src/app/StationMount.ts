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
  apply, applyInv, composePose, invertPose, newPose,
  type FramePose, type V3,
} from '../world/FramePose.js';
import * as THREE from 'three';
import {
  findStation, installStation, lastStationSolid, stationQuat,
  stationStandLocal, type StationReport,
} from '../game/SpaceStation.js';
// CE-49. THE WALKER'S OWN NUMBERS, imported rather than retyped. A helper that
// wrote its own 0.15 / 0.9 / 1.65 and its own 0.4 m radius would agree with
// itself and not with `KinematicBody`, which is the failure this whole file
// keeps arguing against.
import { CAPSULE_SAMPLES_M } from '../player/VoxelCollision.js';
import { CAPSULE } from '../player/Capsule.js';
import {
  installStationGravity, lastStationVolumes,
} from '../game/StationGravity.js';
import type { StructureBodies } from '../game/StructureBody.js';
import type { GravityVolumes } from '../game/GravityVolumes.js';
import type { Vec3n } from '../sim/VesselRegistry.js';
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
  }
  return m;
}

// ===========================================================================
// CE-47. R17: PUTTING THE STATION IN THE WORLD, ONCE, FOR BOTH CALLERS.
// ===========================================================================
//
// THE DEFECT. `Boot` installs the station and calls `mountStation` in a block
// OUTSIDE `buildBodyScope`, while `mounts.bindTo(lt)` and `carriers.bindTo(lt)`
// are registered INSIDE it. So `WorldSession.reboot` ends the scope, the mounts
// and the carrier registry empty, and NOTHING PUTS THEM BACK. The station's
// collision solid, its gravity volumes and its drawn hull survive (they live in
// game-scoped `StructureBodies`, `GravityVolumes` and the near scene), so the
// world still looks and feels right: there is a deck, it is solid, you can stand
// on it. It has simply stopped following its own conic, and CE-40's membership
// rule finds no mount and therefore declines for ever. A player standing in the
// hub of a station that IS travelling at 1879.26 m/s is silently left behind at
// 31.32 m per tick, with no error anywhere.
//
// WHICH SHAPE THIS IS, SAID OUT LOUD BECAUSE ADMIN OFFERED TWO. This is the
// REBUILD HOOK, not full body-scope participation, and the reason is ownership
// rather than effort. Making the station body-scoped means making its `Solid`
// body-scoped, and that `Solid` lives in `gameplay.structures.bodies`, which is
// process-scoped and is gameplay's file; the drawn hull is a `StationView` in
// rendering's near scene. Moving either into the body scope is a cross-domain
// change with rendering and gameplay in it. What IS core-engine's is that the
// frame and the mount are body-scoped and must come back with the scope, and
// that is what this does.
//
// AND THERE IS NO SECOND INSTALL PATH, WHICH IS THE PART THAT MATTERS. `Boot`
// used to hold ten lines of install-and-mount wiring inline; those lines are
// this function now, and `Boot` calls it once at boot and once per rebuild. A
// copy of them in a reboot handler would have been a second authority for where
// the station is, and the two would have agreed right up until one was edited.
//
// THE TICK IS THE WHOLE OF THE DIFFERENCE BETWEEN THE TWO CALLS. At boot it is
// 0. On a rebuild the conic has run, so it is the live tick, and both halves
// take the SAME one: `installStation(.., t)` derives the solid from
// `stateOf(rec, t)` and `mountStation(.., t)` measures `local = poseAt(t)^-1 .
// authored` against that freshly-installed pose. Self-consistent by
// construction, exactly as it is at boot, rather than by two things agreeing.
//
// WHAT IT DOES NOT DO, and this is deliberate rather than missed: it does not
// re-seat the rider. `ride.release()` runs in the same teardown, so a player who
// was aboard comes out of the rebuild un-boarded and KEEPING the station's
// absolute velocity (CE-33), which means they coast alongside it and fall behind
// only by the orbit's curvature, 1/2 a t^2 at Forge's 3.5316 m/s^2: about 7 m
// over a two-second rebuild, well inside the 33.64 m release radius, so CE-40's
// rule re-boards them on its own. A long rebuild puts them outside it and they
// walk back on or press the row again. Inventing a teleport-the-rider policy
// here would be a second answer to "where is the player" for the sake of a case
// the existing rule already handles, and `probes/stationboard.js` measures which
// of the two happened rather than assuming.

/** Everything putting the station in the world needs. Held as one shape so the
 *  boot call and the rebuild call cannot drift apart in their arguments. */
export interface StationInstallDeps {
  readonly core: OfCoreModule;
  readonly bodies: StructureBodies;
  readonly volumes: GravityVolumes;
  readonly carriers: CarrierRegistry;
  readonly mounts: CarrierMounts;
  readonly view: StationView | null;
  /** The radial the orbit is minted through. Only read on a mint. */
  readonly up: Vec3n;
  readonly bodyRadiusM: number;
  readonly muM3S2: number;
  /** GP-650. /core's own `BodyParams::bodyId` for the body above, stamped onto
   *  the record on a mint so the map can ask which body it orbits instead of
   *  assuming the observer's. Only read on a mint, like `up`. */
  readonly bodyId: number;
  /** The ONE gravity authority, at the station's own radius. */
  readonly gravityAccel: (rM: number) => number;
}

/**
 * Install the station's interior, its gravity, its hull and its frame, at
 * `tick`. Returns the install report, or null if there is no station to install.
 *
 * IDEMPOTENT ON BOTH HALVES, which is what makes the rebuild call safe.
 * `installStation` removes the previously installed solid before adding the new
 * one and `installStationGravity` does the same for its volumes, so this leaves
 * exactly one of each however many times it is called. The carrier registry does
 * NOT replace silently (it throws on a duplicate id), and it does not have to:
 * the rebuild runs after `carriers.clear()`, so the id is free.
 */
export function installAndMountStation(d: StationInstallDeps, tick: number)
    : StationReport | null {
  const st = installStation(d.core, d.bodies, d.up, d.bodyRadiusM, d.muM3S2,
                            tick, d.bodyId);
  if (st === null) return null;
  // PH-98. WHAT YOU WEIGH IN IT, which the record and the interior cannot say
  // between them. A station in orbit is in FREEFALL and its occupants have no
  // weight; the deck holding you up is a fact about the deck, not about gravity.
  installStationGravity(d.volumes, st.pos, d.gravityAccel(st.deckR));
  // RN-821. THE MESH, posed from the SAME `st.pos` the collision solid was built
  // from, with `stationQuat` read rather than rebuilt. The mount re-poses it
  // every tick after this; this call is what makes the frame it starts on right.
  d.view?.place(st.pos, stationQuat(st.pos));
  mountStation(d.core, d.carriers, d.mounts, d.view, tick);
  return st;
}

// ===========================================================================
// CE-49. WHERE THE FEET GO, AND WHY THE HUB CENTRE WAS NEVER IT.
// ===========================================================================
//
// REID'S BUG, ON A REAL GPU: the `visit:station` press seated him INSIDE A WALL.
// Grounded, 0.00 m/s, 398.11 km, carried correctly, and the left half of the
// frame solid black because the camera was inside interior geometry. Measured
// here at the seat point the press used: `solidBuild` reads TRUE at the feet AND
// at all three walker sample heights (0.15 / 0.9 / 1.65 m).
//
// THE CAUSE IS ONE WORD IN GP-234. It said "the station's local origin is both
// the hub centre and the deck's top face, so `pos` IS the spot to stand on".
// That was true of the PLACEHOLDER station, a 12 x 12 m hub with nothing in the
// middle. `SpaceStation.ts` says in as many words what the shipped asset did to
// it: "THE STATION'S ORIGIN IS NO LONGER EMPTY ... `col_HallCore` is a solid
// column from y = 0.000 to 5.400 spanning +/- 1.548 m in both horizontal axes,
// and the origin is inside it." The press kept aiming at the origin.
//
// AND THE RIGHT ANSWER WAS ALREADY PUBLISHED, TWICE, WHICH IS THE REAL LESSON.
// `stationStandLocal()` reads the asset's own `socket_hall` empty, 4 m off the
// core, and `StationReport.standPos` carries it in the body frame with the
// comment "Body-frame point a player arriving at the station should be placed
// at". The press had a correct point and a wrong point on the same object and
// took the wrong one. Nothing caught it because `probes/stationvisit.js`
// asserted `grounded`, `onDeck` and the distance from the hub CENTRE, and being
// inside the core satisfies all three: it is grounded, it is on the deck, and it
// is zero metres off centre. **A point can be exactly where you asked and still
// be inside a pillar.**
//
// SO THIS IS NOT A NEW AUTHORITY, IT IS THE EXISTING ONE MADE LIVE AND CHECKED.
// The socket is still the asset's; what this adds is that the offset is applied
// to the LIVE solid's pose rather than to the boot pose (PH-357's staleness, one
// layer up: `standPos` is computed at install and the station has moved 4,888 m
// by the time anybody presses the row), and that the result is VERIFIED against
// the walker's own collision predicate before the feet are put there.
//
// THE SCAN IS THE GUARD AND IT IS DETERMINISTIC. If the socket is clear, the
// socket is used and the scan never runs; that is the shipping case, measured.
// If a re-authored asset ever puts furniture on the spawn, this walks outward
// along the DECK PLANE in fixed rings and takes the first clear spot, with the
// ring order fixed so two runs of the same world produce the same metre. It
// invents no geometry: every test is `StructureBodies.blocks`, the exact call
// `KinematicBody` resolves the walker against, at the exact heights
// `CAPSULE_SAMPLES_M` gives it.

/** The walker's own collision query, structurally. `StructureBodies` satisfies
 *  it and is not imported: this file must not learn what a structure registry
 *  is, only what "is this point solid" means. */
export interface SolidQuery {
  blocks(x: number, y: number, z: number): boolean;
}

/** Directions tried per ring, and the ring spacing. 8 and 0.5 m give a 0.38 m
 *  arc at the first ring, well under the capsule's 0.4 m radius, so a clear
 *  pocket cannot be stepped over. */
const SCAN_DIRS = 8;
const SCAN_STEP_M = 0.5;
/** Past this the search has left the hall, and a spawn 12 m from the socket is
 *  not the room the button promised. Refusing is better than wandering. */
const SCAN_MAX_M = 12;

export interface StationArrival {
  /** Body-frame feet position. */
  pos: [number, number, number];
  /** How far along the deck the scan had to walk. 0 is the shipping case. */
  scannedM: number;
  /** False when nothing within `SCAN_MAX_M` was clear. The caller still seats
   *  the player (a menu press that silently does nothing is worse), and the
   *  probe asserts this is true so a re-authored asset fails loudly. */
  clear: boolean;
}

/**
 * CE-49. Is a whole capsule clear of every structure box at this LOCAL point?
 *
 * FIVE COLUMNS AND NOT ONE, because the capsule is 0.4 m in radius and its axis
 * being clear says nothing about its shoulders: the centre plus four offsets at
 * exactly `CAPSULE.radiusM` in the deck plane. Three heights each, and they are
 * `CAPSULE_SAMPLES_M` imported rather than retyped, because a probe or a helper
 * that wrote its own 0.15 / 0.9 / 1.65 would agree with itself and not with the
 * walker.
 */
function capsuleClearAt(q: SolidQuery, pose: FramePose,
                        lx: number, ly: number, lz: number): boolean {
  const p: V3 = { x: 0, y: 0, z: 0 };
  const R = CAPSULE.radiusM;
  const cols: readonly [number, number][] =
    [[0, 0], [R, 0], [-R, 0], [0, R], [0, -R]];
  for (const [dx, dz] of cols) {
    for (const h of CAPSULE_SAMPLES_M) {
      apply(pose, lx + dx, ly + h, lz + dz, p);
      if (q.blocks(p.x, p.y, p.z)) return false;
    }
  }
  return true;
}

/**
 * CE-49. WHERE AN ARRIVING PLAYER'S FEET GO, in the body frame, right now.
 *
 * The asset's own spawn socket, carried by the LIVE solid's pose, verified
 * against the walker's own collision query, and scanned outward along the deck
 * only if that point is occupied. Returns null when there is no station.
 */
/**
 * CE-54. THE LIVE POSE OF THE STATION'S COLLISION SOLID, or null with no
 * station. The one local -> body transform for the ASSET'S OWN authored frame,
 * which is the frame `stationStandLocal` and every socket in the glb are
 * written in.
 *
 * Extracted from `stationArrivalBody` rather than written a second time,
 * because CE-54 gave it a second caller (`seatOnStationDeck`'s `localAt`) and
 * two spellings of "where is the station right now" is the two-authority shape
 * this file already argues against twice.
 *
 * NOT the carrier frame's pose. The frame's basis is LVLH from the record's own
 * r x v; the asset's is nadir-pointing from +Y, and the constant between them is
 * MEASURED at install (see this file's header). A caller that wants the spine
 * wants this one.
 */
export function stationSolidPose(out: FramePose): FramePose | null {
  const solid = lastStationSolid();
  if (solid === null) return null;
  // Not a second derivation of where the station is: it IS the collision body,
  // re-posed every fixed tick by `CarrierMount.syncAt`.
  out.px = solid.pos.x; out.py = solid.pos.y; out.pz = solid.pos.z;
  out.qx = solid.quat.x; out.qy = solid.quat.y;
  out.qz = solid.quat.z; out.qw = solid.quat.w;
  return out;
}

export function stationArrivalBody(q: SolidQuery): StationArrival | null {
  const pose = stationSolidPose(newPose());
  if (pose === null) return null;
  const [lx, ly, lz] = stationStandLocal();
  const out: V3 = { x: 0, y: 0, z: 0 };

  if (capsuleClearAt(q, pose, lx, ly, lz)) {
    apply(pose, lx, ly, lz, out);
    return { pos: [out.x, out.y, out.z], scannedM: 0, clear: true };
  }
  // RINGS OUTWARD IN THE DECK PLANE (station-local XZ; local +Y is up, which is
  // the whole reason the offset is applied in LOCAL space and transformed once).
  // Fixed order, so the same world seats at the same metre every time.
  for (let r = SCAN_STEP_M; r <= SCAN_MAX_M + 1e-9; r += SCAN_STEP_M) {
    for (let i = 0; i < SCAN_DIRS; i++) {
      const a = (2 * Math.PI * i) / SCAN_DIRS;
      const cx = lx + Math.cos(a) * r;
      const cz = lz + Math.sin(a) * r;
      if (!capsuleClearAt(q, pose, cx, ly, cz)) continue;
      apply(pose, cx, ly, cz, out);
      return { pos: [out.x, out.y, out.z], scannedM: r, clear: true };
    }
  }
  // Nothing clear. Seat at the socket anyway and say so: a press that refuses
  // leaves the player with no way to reach the station at all, and `clear:
  // false` is the loud reading a probe fails on.
  apply(pose, lx, ly, lz, out);
  return { pos: [out.x, out.y, out.z], scannedM: SCAN_MAX_M, clear: false };
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
