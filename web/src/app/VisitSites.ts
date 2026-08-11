// GP-167 / GP-168. VISIT SITE: teleport on foot to the seven surveyed spawn
// candidates, from the cheat panel. Reid asked "can I like teleport to other
// biomes to check them out somehow", and the seven places worth checking out
// already exist: the WG-55 spawn survey shortlisted them, photographed them and
// measured them (docs/controllers/world-gen.md sections 6.1 and 6.2). This is
// also his spawn-decision tool: the pick is a pending decision he owns, and
// each row carries the one line that makes its site a DIFFERENT place, so he is
// choosing between true statements rather than between button names.
//
// THE COORDINATES ARE COPIED FROM THE DOC, and that is stated rather than
// hidden: the survey's numbers were only ever passed to `probes/sitelook.js` as
// command-line arguments, so the section 6.1 table IS the machine-readable
// source of record and there is no second one to cross-check against. `groundM`
// is the survey's designed ground height at each site; the probe asserts
// arrival against it, which is what catches a mistyped digit here (a wrong
// latitude does not land at the right altitude).
//
// THE TELEPORT IS NOT WRITTEN HERE. `pressVisit` is handed the ONE ground
// teleport authority the client has, the path `__of.teleport` and every site
// probe already drives (Debug.ts -> ViewRouter.teleport -> the walker's own
// spawn, which puts the feet ON the designed surface, grounded, at rest). A
// second teleport in this file would be a second authority, which is this
// project's catalogued failure shape.
//
// WHY THE GUARD IS "ABOARD" AND NOT "A CRAFT EXISTS": ViewRouter routes the
// teleport to the ACTIVE view source, and a vessel's `teleport()` is by design
// a no-op ("a vessel is rolled out, never teleported", VesselObserver.ts). So a
// press while flying would report success and move nothing, which is worse
// than a refusal. A craft parked on the pad is fine: the walker is the source.
//
// ---------------------------------------------------------------------------
// GP-231 to GP-234. THE EIGHTH DESTINATION IS NOT A SITE, AND IT DRAWS IN ITS
// OWN GROUP.
//
// PH-94 to PH-97 put a walkable station in a 400 km orbit and Reid asked to be
// able to get to it from this menu. It is handled in this file, because this is
// where a teleport destination lives, and it is drawn under its OWN heading,
// for three reasons that are all about the seven rows above it rather than
// about tidiness:
//
//   1. THOSE SEVEN ARE A DECISION TOOL. They are the WG-55 survey's candidate
//      SPAWNS and each carries sun, treeline and ground so Reid can compare
//      them (world-gen 6.1 is his pending pick). An eighth row that is not a
//      candidate would put a non-comparable thing in the comparison.
//   2. THE GUARDS DIFFER. A site cannot be switched off; the station can
//      (`?station=0`), and then there is literally nothing up there to stand
//      on. One group greying for a reason the others can never have would read
//      as a bug in the group.
//   3. THE DOOR DIFFERS, and this is the load-bearing one. A site goes through
//      the lat/lon ground teleport, which DISCARDS its altitude argument by a
//      documented contract (Config.ts line 51) that two walking scenarios ship
//      `alt: 2` against. The station is not on the heightfield at all, so it
//      goes through `Controller.standAt`, PH-90's body-frame Cartesian door,
//      built for exactly this. Honouring `altM` instead would have moved every
//      walking probe in the suite by two metres, which is why R50 exists.
//
// The row still uses the panel's one row renderer and the same `Go` verb, and
// its id keeps the `visit:` prefix so GP-168's arrival-closes-the-menu applies
// with nothing added to MenuBoot.
//
// ---------------------------------------------------------------------------
// CE-41. AND THE STATION ROW NOW HANDS THE PLAYER TO THE STATION'S FRAME.
//
// The door above was `Controller.standAt`, which zeroes the ABSOLUTE velocity.
// On a station that is actually travelling that is not an arrival, it is a
// player put on the deck and immediately left behind at 31.32 m per tick, and
// it is why `of.carrier('census').ride` read `boards: 0` on a world with a
// person standing inside Anchorage. `rideStation` is the same arrival plus the
// one missing number; see `StationMount.seatOnStationDeck`.
//
// THE RECEIPT DOES NOT CLAIM THE PLAYER IS GROUNDED, deliberately.
// `Controller.standAt` writes the feet and leaves `grounded` FALSE, because
// "whether there is a floor here is exactly what the caller is asking, so
// asserting one would be the instrument answering its own question" (its own
// words). Whether the deck caught the player is a fact one fixed tick later, so
// `probes/stationvisit.js` asserts `grounded` AND `onDeck` after ticking, and
// this file asserts neither. GP-155's pending/terminal rule, applied the other
// way round from the site rows: the position IS terminal, the footing is not.

import { labelOf } from '../player/Bindings.js';
import {
  STATION_ALT_M, STATION_NAME, lastStationInstall,
} from '../game/SpaceStation.js';
import type { CheatRow } from '../ui/PauseMenu.js';
import type { FlightMode } from './FlightMode.js';
import type { StationSeat } from './StationMount.js';

export interface VisitSite {
  id: string;
  label: string;
  /** What makes this site a different place, in one line, off sections 6.1/6.2:
   *  best-ever noon sun (Forge has no axial tilt, so it is permanent), the
   *  treeline, and the ground. */
  note: string;
  latDeg: number;
  lonDeg: number;
  /** The survey's designed ground height, m. The probe's arrival oracle. */
  groundM: number;
}

/** Doc order (world-gen.md section 6.1, "The candidates"): the control first. */
export const VISIT_SITES: readonly VisitSite[] = [
  { id: 'spawn', label: 'Hills: the spawn',
    note: 'THE SPAWN since WG-214, 797.6 m: below the treeline, ~1,296 trees '
      + 'in the 620 m ring, 623 m of relief in 6 km with 54.2% of it above, '
      + 'noon sun 63.8 deg. core/tests/test_spawn.cpp asserts all of it',
    latDeg: -3.41413, lonDeg: 150.27984, groundM: 797.6 },
  { id: 'current', label: 'Mountains: the FORMER spawn (retired WG-214)',
    note: 'retired 2026-08-03, 4,668 m: noon sun 69.2 deg, snow props, 1,174 m '
      + 'of relief in 6 km. 2,818 m ABOVE the treeline, so zero natural wood '
      + 'within 20 km. The survey ranked it last of 21',
    latDeg: 2.0, lonDeg: 144.0, groundM: 4667.8 },
  { id: 'hills', label: 'Hills: the valley floor',
    note: '2,077 m, ABOVE the treeline: no forest at all. Noon sun 36.1 deg. '
      + 'The survey\'s own recommendation on the numbers',
    latDeg: -31.165, lonDeg: -86.27401, groundM: 2077.2 },
  { id: 'hills2', label: 'Hills: the treeline view',
    note: '1,897 m, ON the treeline: 79% bare, wooded slopes falling away. The '
      + 'highest sun on the planet, 89.5 deg at noon',
    latDeg: 22.286, lonDeg: 108.84406, groundM: 1897.2 },
  { id: 'plains', label: 'Plains: the basin',
    note: '332 m: open grass with isolated copses, noon sun 59.3 deg. The most '
      + 'expensive frame of the seven (2.66 M triangles)',
    latDeg: -7.9675, lonDeg: 116.53189, groundM: 331.8 },
  { id: 'beach', label: 'Beach: the desert',
    note: '12 m: THE DESERT. The flattest ground on the planet, bare pale sand '
      + 'and dry scrub, no trees ever. Noon sun 31.6 deg',
    latDeg: -35.6028, lonDeg: 53.30131, groundM: 12.2 },
  { id: 'beach2', label: 'Beach: permanent golden light',
    note: '8 m: flatter still, but the sun NEVER rises above 9.3 deg here, so '
      + 'it is low golden light at every hour of every day',
    latDeg: -57.938, lonDeg: -85.626, groundM: 8.3 },
  { id: 'forest', label: 'Forest',
    note: '27 m: the densest canopy of the seven, 1,560 trees in one frame. '
      + 'Noon sun 47.4 deg',
    latDeg: -19.85, lonDeg: -72.7853, groundM: 27.3 },
];

/** Eye height handed to the teleport. The walker's spawn snaps the feet to the
 *  designed surface and ignores it (Controller.teleport), so the value only
 *  matters to a free camera; 2.0 is what sitelook.js has always passed. */
export const VISIT_EYE_ALT_M = 2.0;

/** GP-231. The station row's id. `visit:` so GP-168's close-on-arrival, which
 *  matches on that prefix in MenuBoot, covers this row with nothing added. */
export const STATION_ROW_ID = 'visit:station';

/**
 * The two ports a press needs, held as one shape so `Cheats.press` hands over
 * its own deps and no third copy of either call exists. `teleport` is the
 * lat/lon ground door (altitude discarded by contract); `standAt` is the
 * body-frame Cartesian one and returns false when there is no walker.
 */
export interface VisitPorts {
  teleport: (latDeg: number, lonDeg: number, altM: number) => void;
  standAt: (x: number, y: number, z: number) => boolean;
  /**
   * CE-41. THE THIRD DOOR, and it is the one this row should always have used:
   * arrive on the station's deck AND ON ITS FRAME, at rest in it.
   *
   * `standAt` above zeroes the ABSOLUTE velocity, so on a moving station it
   * seats a player who is instantly 31.32 m behind the deck per tick. That is
   * the defect todo #1 names. This port boards the frame the station's geometry
   * is currently mounted on and seats the rider at rest IN it; see
   * `StationMount.seatOnStationDeck` for why the destination is the live solid.
   *
   * OPTIONAL, and null-returning, on purpose: a caller with no carrier services
   * (a unit test, a future headless host) keeps the `standAt` behaviour that
   * shipped, and the press below falls back to it rather than refusing.
   */
  rideStation?: () => StationSeat | null;
}

/** Just enough of `PlanetBody` to say what the gravity is up there. Structural
 *  rather than imported so this file gains no dependency on world/. */
export interface GravityRef {
  readonly radiusM: number;
  gravityAccel(rM: number): number;
}

/** Why no site can be visited right now, or ''. One sentence, naming the keys
 *  that fix it, off the binding table and never a literal (GP-140). */
export function visitBlocked(f: FlightMode | null): string {
  return f !== null && f.aboard
    ? `you are aboard a vessel: get out first (${labelOf('board')} to `
      + `disembark, ${labelOf('recover')} clears the pad)`
    : '';
}

/**
 * The rows the panel draws. Derived per view, like every other row.
 *
 * GP-502. THE SEVEN ARE FORGE'S, AND THEY REFUSE ON ANY OTHER BODY. Every one
 * of them is a WG-55 survey candidate: a latitude, a longitude, and a sentence
 * about the sun angle, the treeline and the ground there. The lat/lon is a
 * valid point on any sphere, so `Controller.teleport` would happily land the
 * player somewhere on Cinder and every word of the note would be false -- a
 * desert with no trees, on an airless moon that has no trees anywhere.
 *
 * This became reachable the moment GP-500 gave the player a door to another
 * body, which is the general shape worth naming: a new destination does not
 * only add a row, it can make an existing row's sentence untrue.
 *
 * `hereId` defaults to Forge so no existing caller changed, and the default is
 * the correct answer for every world that shipped before this one.
 */
export function visitRows(f: FlightMode | null, hereId = 0): CheatRow[] {
  const blocked = hereId !== 0
    ? 'these seven are surveyed sites ON FORGE and their sun, treeline and '
      + 'ground are Forge\'s: go back to Forge (Another world, below) and they '
      + 'come back'
    : visitBlocked(f);
  return VISIT_SITES.map((s) => ({
    id: `visit:${s.id}`, label: s.label, note: s.note,
    kind: 'button' as const, blocked }));
}

/**
 * GP-232. Why the station cannot be visited right now, or ''.
 *
 * THE ORDER IS NOT ARBITRARY. "There is no station" comes first because it is
 * the one a player cannot act on: it is a property of how this world was
 * booted, and telling someone to disembark first, so that they can then press a
 * button that would refuse anyway, is a worse sentence than the true one.
 *
 * `lastStationInstall()` and NOT `findStation()` is the authority, and the
 * difference is the whole guard. The record is a `VesselRecord` and it SAVES;
 * the interior is a `Solid` derived at boot and never saved (SpaceStation.ts).
 * So a world saved with a station and reloaded with `?station=0` has the record
 * and no floor, and a check on the record would happily put the player 400 km
 * up with nothing under them. The install report exists exactly when the solid
 * was added to `StructureBodies`, which is the thing being stood on.
 */
export function stationBlocked(f: FlightMode | null): string {
  if (lastStationInstall() === null) {
    return 'this world was booted with ?station=0, so there is no station in '
      + 'orbit: reload without that flag and it will be there';
  }
  return visitBlocked(f);
}

/**
 * GP-233. The station's row, in its own group. One row or none, so the group is
 * data like every other group here.
 *
 * THE NUMBERS ARE READ OFF THE LIVE WORLD rather than written into the prose
 * (GP-165's rule): the altitude is the install's own, and both gravities come
 * from `PlanetBody`, which is the client's single gravity authority. A row that
 * said "400 km" as a literal would keep saying it after the orbit moved, and
 * this project has put the wrong number on screen enough times to have a rule
 * about it. The jump ratio is `g_surface / g_here` because apex height goes as
 * 1/g at a fixed take-off speed, and it is on the row because the 2.5 m
 * headroom up there is REACHABLE: a player who jumps meets the ceiling, which
 * is a bonk and not a leak (SpaceStation.ts says so), and a player who was told
 * reads it as the place being low rather than the game being broken.
 */
export function stationRows(f: FlightMode | null, body: GravityRef): CheatRow[] {
  const st = lastStationInstall();
  const altM = st?.altM ?? STATION_ALT_M;
  const deckR = st?.deckR ?? body.radiusM + STATION_ALT_M;
  const g = body.gravityAccel(deckR);
  const g0 = body.gravityAccel(body.radiusM);
  const note = `${(altM / 1000).toFixed(0)} km circular orbit. Gravity up `
    + `there is ${g.toFixed(2)} m/s2, ${((100 * g) / g0).toFixed(0)}% of the `
    + `surface, so a jump goes ${(g0 / g).toFixed(1)} times as high and the `
    + '2.5 m ceiling is within reach of one. You arrive standing in the hub, '
    + 'with a doorway out into the corridor';
  return [{
    id: STATION_ROW_ID, label: `${STATION_NAME}: the orbital station`,
    note, kind: 'button' as const, blocked: stationBlocked(f),
  }];
}

export interface VisitOutcome {
  done: boolean;
  message: string;
  detail?: Record<string, unknown>;
}

/**
 * Handle a `visit:` press, or null for an id this file does not own.
 *
 * THE RECEIPT IS TERMINAL, not pending (GP-155's lesson checked, not just
 * cited): the teleport writes the feet synchronously, so by the time this
 * returns the player IS at the site. What follows is streaming, and the world
 * already reports that on its own channel (`chunks.converged`).
 */
export function pressVisit(id: string, f: FlightMode | null, ports: VisitPorts,
                           hereId = 0): VisitOutcome | null {
  if (!id.startsWith('visit:')) return null;
  if (id === STATION_ROW_ID) return pressStation(f, ports);
  const s = VISIT_SITES.find((x) => `visit:${x.id}` === id) ?? null;
  if (s === null) return { done: false, message: `no such site: ${id.slice(6)}` };
  // GP-502. The VERB refuses off-Forge too, and not only the button. A greyed
  // row cannot be clicked, so a guard that lived only in `visitRows` would be
  // reachable exactly by `of.cheat`, which is the startfresh-refusal pattern
  // and the reason that one is asserted at the entry point.
  const blocked = hereId !== 0
    ? visitRows(f, hereId)[0].blocked ?? '' : visitBlocked(f);
  if (blocked !== '') return { done: false, message: `refused: ${blocked}` };
  ports.teleport(s.latDeg, s.lonDeg, VISIT_EYE_ALT_M);
  return {
    done: true,
    message: `standing at ${s.label} (lat ${s.latDeg}, lon ${s.lonDeg}) while `
      + 'the ground streams in',
    detail: { site: s.id, latDeg: s.latDeg, lonDeg: s.lonDeg,
      groundM: s.groundM },
  };
}

/**
 * GP-234. Put the player in the station's hub.
 *
 * THE DESTINATION IS THE INSTALL'S OWN `pos` AND NOTHING IS RECOMPUTED HERE.
 * The station is nadir pointing and its local origin is both the hub centre and
 * the deck's top face (SpaceStation.ts), so `pos` IS the spot to stand on, and
 * `|pos|` is `deckR`. A second derivation, even the obvious `up * (R + alt)`,
 * would be a second authority on where the station is, and the day it disagreed
 * with the conic the player would arrive beside the floor rather than on it.
 * `probes/stationwalk.js` P2 is the assertion that keeps those two in step.
 *
 * NO DROP HEIGHT. The feet go exactly on the top face, so the walker's very
 * first tick has `gap <= 0` and lands (KinematicBody.step), rather than the
 * half-second fall a clearance would buy. The rise allowance in `deckUnder` is
 * the walker's own first step rung, so being a hair inside the 0.5 m slab seats
 * the feet on top of it: that is GP-53's fix and it is why arriving exactly at
 * the face is safe rather than a coin flip about which side of it we land on.
 */
function pressStation(f: FlightMode | null, ports: VisitPorts): VisitOutcome {
  const blocked = stationBlocked(f);
  if (blocked !== '') return { done: false, message: `refused: ${blocked}` };
  const st = lastStationInstall();
  // Unreachable while `stationBlocked` returns '' for a non-null install, and
  // kept because the compiler cannot know that and a thrown null here would be
  // a crash in a menu press.
  if (st === null) return { done: false, message: 'refused: no station' };
  // CE-41. THE CARRIER DOOR FIRST, the bare teleport as the fallback.
  //
  // Both land the feet on the same face; they differ in one number, the
  // velocity, and that number is the whole feature. `rideStation` returns null
  // when there is no mount, no walker or no ride, and then this is exactly the
  // press that shipped before, which is why the fallback is a fallback and not
  // a refusal.
  const seat = ports.rideStation?.() ?? null;
  if (seat !== null) {
    return {
      done: true,
      message: `standing in the hub of ${STATION_NAME}, `
        + `${(st.altM / 1000).toFixed(0)} km up, riding it at `
        + `${seat.speedMS.toFixed(0)} m/s`,
      detail: { site: 'station', name: STATION_NAME, altM: st.altM,
        deckR: st.deckR, feet: seat.feet, proxies: st.proxies,
        carrier: seat.carrier, velMS: seat.speedMS, tick: seat.tick },
    };
  }
  const [x, y, z] = st.pos;
  if (!ports.standAt(x, y, z)) {
    return { done: false, message: 'refused: there is no walker to move' };
  }
  return {
    done: true,
    message: `standing in the hub of ${STATION_NAME}, `
      + `${(st.altM / 1000).toFixed(0)} km up`,
    detail: { site: 'station', name: STATION_NAME, altM: st.altM,
      deckR: st.deckR, feet: [x, y, z], proxies: st.proxies, carrier: null },
  };
}
