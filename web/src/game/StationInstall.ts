// THE STATION IN THE WORLD: the interior solid, its id, the asset it is read
// off, where a player stands on it, and the one function that puts it in the
// walker's solid set.
//
// Split out of SpaceStation.ts at the 400-line cap (2.2 rule 1). A pure move,
// and cohesive for the same reason the proxies half is: `installed` and
// `lastReport` are owned here and every writer of either is here.
// SpaceStation.ts imports and RE-EXPORTS all of it.

import * as THREE from 'three';
import { boundOf, type Solid, type StructureBodies } from './StructureBody.js';
import type { OfCoreModule } from '../sim/wasm/heap.js';
import { registry, stateOf, type Vec3n } from '../sim/VesselRegistry.js';
import { learned, spawns, stationStandLocal } from './StationProxies.js';
import { findStation, mintStation, stationQuat } from './StationVessel.js';

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

