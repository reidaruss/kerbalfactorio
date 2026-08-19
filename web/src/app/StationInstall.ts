// Installing the station and mounting it, together, at one tick. Split out
// of StationMount.ts (line-cap batch 2, BT-285): CE-47's whole argument is
// that this must be the only place the two calls are sequenced, which makes
// it a cohesive unit that only calls INTO the mount group, never the reverse.

import { installStation, type StationReport } from '../game/SpaceStation.js';
import { installStationGravity } from '../game/StationGravity.js';
import type { StructureBodies } from '../game/StructureBody.js';
import type { GravityVolumes } from '../game/GravityVolumes.js';
import type { Vec3n } from '../sim/VesselRegistry.js';
import type { CarrierMounts } from '../world/CarrierGeometry.js';
import type { CarrierRegistry } from '../world/CarrierFrame.js';
import type { OfCoreModule } from '../sim/wasm/heap.js';
import type { StationView } from '../render/StationView.js';
import { mountStation } from './StationMount.js';

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
  // RN-821 / CE-116. THE MESH IS POSED BY THE MOUNT AND BY NOTHING ELSE.
  //
  // This line used to be `d.view?.place(st.pos, stationQuat(st.pos))`, on the
  // argument that the mount "re-poses it every tick after this" and this call
  // only fixed the frame it starts on. Both halves of that were true and it was
  // still a second authority for the hull's pose: the comment was the only thing
  // keeping the two spellings in agreement, and `mountStationOn` now poses the
  // hull itself at the install tick through the same watcher every later tick
  // goes through. One writer, no agreement to maintain.
  mountStation(d.core, d.carriers, d.mounts, d.view, tick);
  return st;
}
