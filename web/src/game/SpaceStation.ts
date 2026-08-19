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
import type { OfCoreModule } from '../sim/wasm/heap.js';
import {
  stateOf, type VesselRecord, type VesselRegistry, type Vec3n,
} from '../sim/VesselRegistry.js';

// BT-277. Three modules split out of this file at the 400-line cap (2.2 rule
// 1), each a pure move of whole declarations grouped around the state it owns:
// the asset's proxies and sockets, the vessel record, and the installed
// interior solid. They form a DAG under this file, which stays the barrel:
// every public symbol is RE-EXPORTED below, so no import site changes.
import { isStation, stationQuat } from './StationVessel.js';
import { lastStationSolid } from './StationInstall.js';

export { STATION_ALT_M, STATION_NAME, STATION_TAG, findStation, isStation,
  mintStation, stationQuat } from './StationVessel.js';
export { learnStationProxies, learnStationSockets, resetStationProxies,
  stationProxies, stationSocket, stationSocketFrame, stationSockets,
  stationStandLocal, type NamedBox, type StationSocketFrame }
  from './StationProxies.js';
export { STATION_ASSET, installStation, lastStationInstall, lastStationSolid,
  resetStationInstall, stationBodyPosNow, stationSolid, stationStandBody,
  type StationReport } from './StationInstall.js';

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
 *
 * ===========================================================================
 * CE-115. IT READS THE LIVE SOLID, BECAUSE `stationQuat(pos)` WAS A SECOND
 * ATTITUDE AND IT WALKED AWAY FROM THE ONE EVERYTHING IS DRAWN WITH.
 * ===========================================================================
 *
 * This used to be `stationQuat(pos)`, a POSITION-ONLY nadir lock whose roll is
 * THREE's shortest-arc convention. Nothing that is drawn or collided with has
 * been posed that way since CE-83: `CarrierMount` writes `poseAt(t) . local`
 * onto the collision solid, both gravity volumes and the drawn hull, and
 * `local` was measured ONCE at install as `poseAt(install)^-1 . authored`, so
 * its roll rides the LVLH basis and is tied to prograde. The two agree at the
 * install tick by construction and NOWHERE ELSE.
 *
 * MEASURED (`probes/stationpose.js`, before the fix, on the shipped station):
 * 0.230 degrees apart at tick 121 growing linearly to 1.373 degrees at tick
 * 721, i.e. 0.00190 degrees per tick with no bound on it, while the POSITIONS
 * agreed to 0 m exactly. So the disagreement was pure attitude, and it was
 * silent: this function was the answer `of.station().axes` published, which is
 * what `artframe.js`'s station shot aims its camera with while standing on
 * geometry posed the other way. A degree of aim error at a corridor mouth is
 * the difference between a frame of the hull against the star field and a frame
 * of the wall beside it, which is exactly the two captures that opened this.
 *
 * `stationQuat` KEEPS ITS ONE REAL JOB and loses the other. It CONSTRUCTS the
 * authored frame -- `stationSolid` and `installStationGravity` build the
 * install-tick geometry with it, and that geometry is what `local` is measured
 * against, so it still decides which way the station faces the day it is
 * installed. It is no longer an answer to "which way is it facing NOW".
 *
 * THE FALLBACK IS THE SAME ONE `stateOfDocked` ABOVE ALREADY DOCUMENTS, for the
 * same case and no other: before `installStation` has run there is no solid,
 * and a caller asking then gets the authored construction rather than a null or
 * a throw.
 */
export function stationAxes(pos: Vec3n): { up: Vec3n; along: Vec3n; across: Vec3n } {
  const solid = lastStationSolid();
  const q = solid !== null ? solid.quat : stationQuat(pos);
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

