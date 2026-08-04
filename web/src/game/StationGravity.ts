// THE STATION'S TWO GRAVITY REGIONS (PH-100, PH-102).
//
// `SpaceStation.ts` composes an ORBIT (a VesselRecord on a conic) with an
// INTERIOR (a Solid in StructureBodies). This file adds the third thing those
// two cannot say between them: WHAT YOU WEIGH THERE. It is a separate file for
// the same reason those are two systems and not one -- and it deliberately
// does NOT edit SpaceStation.ts, because the Blender lane is live in that file
// swapping the placeholder interior for the authored mesh.
//
// TWO VOLUMES, AND THE PAIR IS THE DESIGN:
//
//   FREEFALL, ~120 m about the station. Cancels the carrier's acceleration.
//     This is what makes an EVA an EVA: step off the hull and you keep the
//     station's state of motion, which in the frozen-body-frame model of PH-94
//     is "at rest beside it", i.e. you float. Without this volume, leaving the
//     structure would drop you at 3.5 m/s^2, because the frozen station is
//     dynamically a tower and stepping off a tower is a fall.
//
//   GENERATOR, THE DECKS THEMSELVES. Puts it back, while powered.
//     Inside a powered deck's volume the apparent gravity is EXACTLY the true
//     local value (bit for bit -- see GravityVolumes.ts), so the deck behaves as
//     the tower PH-90 measured and not one figure taken then has to be re-taken.
//
// THE GENERATOR IS THE DECKS AND NOT THE BOUNDING BOX (PH-106), which is the
// one thing in this file that changed when the placeholder interior was
// replaced by the shipped asset, and it changed because the placeholder could
// not tell the difference.
//
// It used to be `extentOfBoxes(everything) + 1 m`: ONE axis-aligned box round
// the whole interior. On twelve boxes in a straight line that is very nearly
// the interior. On the real station it is a 67 x 25 x 62 m slab enclosing five
// branches, four hull breaches and every cubic metre of vacuum between them, so
// it would have held a player at full weight while they floated in open space a
// metre off the hull, and it would have held them at full weight standing in
// the torn-open aft section. The feature this lane exists to deliver would have
// been switched off by its own bounding box.
//
// So the volume is now ONE BOX PER DECK, footprint taken from the deck proxy
// and extruded up by the authored headroom. That is not a convenience: gravity
// plating under a floor is what an artificial-gravity deck physically IS, and
// deriving the volume from the floor rather than from the hull makes two
// properties fall out that nothing had to be written for.
//
//   EVERY DECK EDGE IS AN EVA EXIT. Walk off the end of any run and you leave
//   the field, so the way out of the station is not a feature that had to be
//   authored, it is what the model says. There is no cliff to fall off: the
//   freefall volume is still there, so you float rather than drop.
//
//   THE VENTED SECTION HAS NO GRAVITY, FOR FREE. See the airlock below.
//
// WHERE THE 120 m COMES FROM, STATED AS A CONCESSION RATHER THAN A DERIVATION.
// In reality a body that leaves a station keeps its orbital velocity and
// co-orbits indefinitely; there is no radius at which freefall stops. This
// model has no such thing to keep, because PH-94 froze the station in the body
// frame and its velocity is therefore zero. A bounded freefall region is the
// SECOND concession of the same family as PH-94's first ("the ground does not
// slide past underneath"), and it is labelled rather than dressed up.
//
// 120 m is three times the station's own 40 m corridor, which is enough room
// for a genuine EVA around the outside of it, and it is comfortably inside the
// 200 m at which `probes/stationwalk.js` P3 requires a player to FALL -- so
// that negative control still holds, and it now proves two things instead of
// one (no deck AND no frame). Straying past it is a real hazard with a real
// signal, which is the best that can be made of a fiction that has to end
// somewhere. The honest fix is a carrier frame in the walker, which is the same
// thing PH-94 named as the prerequisite for the station ever moving.

// THE AIRLOCK IS THE VENTED SECTION, AND THE ASSET AUTHORED IT (PH-107, R55).
//
// R55 said "the station has no way out" and that was true of the PLACEHOLDER,
// which really was sealed: twelve boxes with `col_CorrCap` shutting the far
// end. It is FALSE of the shipped mesh, and the measurement is the finding.
// `build_space_station.py` names its own aft end:
//
//     AFT_X   = -36.00   # the torn aft rim, open to space
//     BLOWN_X = -28.00   # the bulkhead that failed
//
// and `col_SpineAftFloor` runs to x = -28.000 with NO cap beyond it, because
// there is nothing left there to collide with. The station is a DERELICT and
// the hole is the whole argument for one. The way out has been in the asset
// since it landed; what was missing was that the gravity did not know.
//
// WHAT THE PRESSURE BOUNDARY IS. `col_JambAftFrame{L,R}` at x = -20.000 is the
// aft-most bulkhead in the asset and it is the last hatch that HELD. Everything
// aft of it is open to space through one of two holes: the spine through the
// blown bulkhead at x = -28, and the reactor drum (`col_ReactorFloor`, the
// branch at x = -23) through the 146 degrees of its own roof that
// `_reactor_drum` deliberately never emits. Both regions therefore have no
// pressure and no gravity, and the rule that produces them is one line:
//
//     A DECK IS POWERED ONLY FORWARD OF THE AFT-MOST BULKHEAD JAMB.
//
// which is derived from the shipped proxies rather than typed in, so an asset
// that moves its bulkhead moves the airlock with it.
//
// WHY THIS IS THE MOMENT WORTH BUILDING, and it is a design claim, not a
// geometry one. Every deck edge is already an exit, but at a deck edge you lose
// your footing and your weight in the SAME tick, and a player cannot tell which
// one happened. The airlock separates them: you walk through a doorway you can
// see, you become weightless, AND THERE IS STILL A FLOOR UNDER YOU. You get
// 8 m of lit corridor with walls to push off before there is 400 km underneath,
// which is a tutorial made of architecture rather than of text. Then the deck
// runs out at the blown bulkhead and you are outside.
//
// NO DOOR STATE, and that is a decision rather than an omission. A door you
// could shut would be a claim that the chamber can be re-pressurised, and it
// cannot: the far end of it is gone. Modelling a working airlock cycle here
// would be a mechanism whose whole purpose is to hold back an atmosphere that
// this hull has not had since before the player arrived. The hole is the story.

import * as THREE from 'three';
import type { Vec3n } from '../sim/VesselRegistry.js';
import {
  stationProxies, stationQuat, type NamedBox,
} from './SpaceStation.js';
import {
  boundOfBoxes, type GravityVolume, type GravityVolumes,
} from './GravityVolumes.js';
import type { LocalBox } from './StructureBody.js';

/** Half-extent of the freefall region about the station, metres. See header. */
export const STATION_FREEFALL_HALF_M = 120;

/**
 * Clear headroom a deck's gravity plating reaches, metres.
 *
 * 4.000 m is MEASURED off the asset and not chosen here: every ceiling proxy's
 * underside sits at local y = 4.000 against a deck top of y = 0.000. Extruding
 * by the authored headroom means the powered volume is exactly the space a
 * person occupies, and a player's feet -- which is where `readWeight` samples
 * -- are on the box's own bottom face, at exterior distance 0, hence at weight
 * EXACTLY 1 and apparent gravity bit-identical to the true local value.
 */
export const DECK_HEADROOM_M = 4.0;

/**
 * Metres over which the generator fades at a boundary.
 *
 * 1.5 m, RAISED FROM 0.5, and the old comment's invariant is deliberately
 * broken by the new number, so here is the replacement argument.
 *
 * The old one said the fringe must lie entirely outside the structure, so that
 * "no point a player can stand on is ever at partial strength". With one box
 * round the whole hull that was achievable and worth having. With one box per
 * deck it is neither, because a deck box's faces ARE the surfaces of the room:
 * the two side faces are the wall inner faces, the top is the ceiling
 * underside, the bottom is the deck top. A fringe of any size at all reaches
 * into a wall (0.6 m thick), a ceiling (0.8 m) or a deck slab (0.3 m) and then
 * into the vacuum past it, and a player can stand in none of those.
 *
 * THE ONE PLACE A FRINGE CAN BE WALKED IN IS A DOORWAY ONTO AN UNPOWERED
 * REGION, because a doorway is the only boundary of a deck box that is neither
 * a wall nor a floor. That is exactly one place in this asset -- the aft
 * bulkhead -- and it is precisely where the transition SHOULD be felt rather
 * than stepped over. So the fringe stops being a mode-gate nicety and becomes
 * the thing that makes the airlock read: 1.5 m at a 4.6 m/s walk is a third of
 * a second of getting lighter, instead of a single tick of full weight followed
 * by a single tick of none.
 *
 * It cannot chatter the float gate. `weightGate`'s hysteresis band is
 * 0.15 to 0.30 m/s^2, which on a 3.53 m/s^2 carrier is fringe weights 0.0425 to
 * 0.085, i.e. a 6.4 cm band of position. Measured deck jitter is 0.000000 m.
 */
export const GENERATOR_FRINGE_M = 1.5;

const FREEFALL_ID = -101;
const GENERATOR_ID = -102;

function box(min: [number, number, number],
             max: [number, number, number]): LocalBox {
  return { min, max, leaf: false };
}

/**
 * The station-local x of the aft-most bulkhead jamb: the airlock's inner door.
 *
 * DERIVED FROM THE SHIPPED PROXIES, never typed in. The asset's own value is
 * -20.000 (`col_JambAftFrame{L,R}`, spelled "AftFrame" in
 * `build_space_station.py`), and it is published on the report so a probe can
 * assert the number rather than assume it: a jamb that moved would move the
 * airlock silently, and this lane has paid for silent agreement before.
 *
 * Null when the asset carries no jamb at all, in which case NOTHING is treated
 * as vented and every deck is powered. That is the conservative direction: an
 * asset with no bulkheads is a station with no airlock, not a station that is
 * entirely airlock.
 */
export function airlockPlaneM(boxes: readonly NamedBox[]): number | null {
  let aft: number | null = null;
  for (const b of boxes) {
    if (!b.name.startsWith('col_Jamb')) continue;
    const cx = (b.min[0] + b.max[0]) * 0.5;
    if (aft === null || cx < aft) aft = cx;
  }
  return aft;
}

/**
 * One powered box per deck run, clipped at the airlock plane.
 *
 * A deck is any proxy with `Floor` in its name, which is the asset's own naming
 * rule for a walking surface, so this reads the contract rather than a list.
 *
 * `includes` AND NOT `endsWith`, and the difference was measured rather than
 * reasoned: `endsWith` yielded FIVE boxes where the station has nine, because
 * the four mezzanine slabs are `col_GalleryFloorN/E/S/W` and a compass letter
 * is not the word Floor. The whole gallery deck would have had no gravity on
 * it, and nothing would have said so -- a player who got up there would simply
 * have floated, in a station whose power was on, and the most likely reading of
 * that is "zero g is broken" rather than "one suffix did not match".
 *
 * The gallery then comes out right for free: those slabs sit at y = 5.100 and
 * get their own volume above themselves, which is what a mezzanine with its own
 * plating would do.
 *
 * A run entirely aft of the plane yields NOTHING rather than an inverted box.
 * That case is real and is not a guard against a hypothetical: `col_ReactorFloor`
 * spans x -24.500 to -21.500, which is wholly inside the vented section,
 * because the module that failed is the reactor and its whole branch went with
 * the aft spine.
 */
export function generatorDecks(boxes: readonly NamedBox[],
                               planeX: number | null): LocalBox[] {
  const out: LocalBox[] = [];
  for (const b of boxes) {
    if (!b.name.includes('Floor')) continue;
    const x0 = planeX === null ? b.min[0] : Math.max(b.min[0], planeX);
    if (x0 >= b.max[0]) continue;
    // THE BOX STARTS AT THE DECK'S UNDERSIDE, NOT AT ITS TOP FACE, and that
    // 0.3 m is not padding. A standing player's feet are sampled EXACTLY on the
    // deck top; if the volume's bottom face were the same plane, the feet would
    // sit exactly on the boundary, and the body-frame round trip at radius 1e6 m
    // carries ~2e-10 m of error, so they land a fraction of a nanometre outside
    // it as often as in. Measured: `zerog.js` Z4 went red with apparent
    // 3.5315999991723803 against a true 3.531600000000002, an 8.3e-10 deficit
    // that is entirely the fringe charging for a rounding. Taking the box down
    // to the slab's own underside puts the feet 0.3 m inside it and restores
    // `apparentG === trueG` -- and it is also what the thing physically is,
    // because gravity plating lives IN the deck rather than on top of it.
    out.push(box([x0, b.min[1], b.min[2]],
      [b.max[0], b.max[1] + DECK_HEADROOM_M, b.max[2]]));
  }
  return out;
}

/**
 * Is the station's artificial gravity running?
 *
 * PERSISTED SINCE PH-108, through the one `writeSlot` choke point and no other
 * writer, which is what PS-13 to PS-15 built that choke point for. It was
 * module state that ships TRUE, and the defect that made it worth one field is
 * narrow and real: a player who switches the generator off, floats down the
 * corridor and then reloads comes back standing up in gravity, so the world
 * silently undid the only thing they did to it. A station that is powered
 * before a reload and dead after is worse than one that was never powered.
 *
 * TRI-STATE ON READ, NOT `=== true`. `stashStationPower(undefined)` leaves the
 * default alone, because the legacy behaviour of every slot written before this
 * field existed is POWERED, and collapsing a missing field to `false` would
 * switch the gravity off in Reid's existing world on the first load. Same rule
 * `dayT` follows, same reason, and `SAVE_VERSION` does not move: an old slot is
 * not misread, it is one field short of a default it already had.
 *
 * What is still owed is the FEATURE rather than the field: a real generator is
 * a placed, powered entity with a draw on the electric budget, whose absence is
 * what makes a derelict a derelict. See PH-103 and the research-gate note.
 */
let powered = true;

export function stationGravityPowered(): boolean { return powered; }

export function setStationGravityPowered(on: boolean): boolean {
  powered = on;
  for (const v of installed) if (v.mode === 'generator') v.powered = on;
  return powered;
}

/** What `writeSlot` stamps. One boolean, read at the choke point. */
export function currentStationPower(): boolean { return powered; }

/**
 * What `readSlot` stashes off an accepted slot. Takes `unknown` and validates,
 * so a missing field, a null and a string all mean "this slot predates the
 * field" and leave the default standing.
 */
export function stashStationPower(v: unknown): void {
  if (typeof v === 'boolean') setStationGravityPowered(v);
}

let installed: GravityVolume[] = [];

/**
 * CE-83. The two registered volumes themselves (freefall, generator), or empty.
 *
 * The sibling of `lastStationSolid` and published for the same one reason: a
 * station that travels has to take its freefall region and its deck generators
 * with it, or a player standing on a moving deck would be weightless in the
 * place the station used to be. `GravityVolumes.weightOf` reads `pos`/`quat`
 * off the stored volume every call, so re-posing these objects is the binding.
 */
export function lastStationVolumes(): readonly GravityVolume[] { return installed; }

export interface StationGravityReport {
  /** Gravity at the station's own centre: its freefall acceleration. */
  carrierG: number;
  freefallHalfM: number;
  /** One powered box per deck run. Was one box round the whole hull (PH-106). */
  deckBoxes: number;
  /** Station-local x of the airlock's inner door, or null if the asset has none. */
  airlockX: number | null;
  headroomM: number;
  fringeM: number;
  powered: boolean;
  volumes: number;
}

let lastReport: StationGravityReport | null = null;
export function lastStationGravity(): StationGravityReport | null {
  return lastReport;
}

/**
 * Put the station's gravity regions in the world.
 *
 * `carrierG` is passed IN rather than computed here, from the caller's own
 * `PlanetBody.gravityAccel`, so this file holds no opinion about how hard the
 * planet pulls (standing rule 1). It is the gravity at the station's CENTRE,
 * which for a body on a free trajectory is exactly its own acceleration.
 *
 * The decks are read from `stationProxies()`, which is the SAME list
 * `stationSolid` builds the collider from and the same traversal that produced
 * it. One list, so the boxes that hold a player up and the boxes that give them
 * weight can never come to disagree about which boxes the asset has.
 */
export function installStationGravity(volumes: GravityVolumes, pos: Vec3n,
                                      carrierG: number):
StationGravityReport | null {
  for (const v of installed) volumes.remove((w) => w === v);
  installed = [];

  const proxies = stationProxies();
  if (proxies.length === 0) return null;
  const airlockX = airlockPlaneM(proxies);
  const deckBoxes = generatorDecks(proxies, airlockX);
  if (deckBoxes.length === 0) return null;
  const quat = stationQuat(pos);
  const p = { x: pos[0], y: pos[1], z: pos[2] };

  const H = STATION_FREEFALL_HALF_M;
  const freeBox = box([-H, -H, -H], [H, H, H]);

  const mk = (id: number, mode: 'freefall' | 'generator',
              boxes: LocalBox[], fringeM: number, on: boolean): GravityVolume => ({
    id, mode, pos: p, quat, boxes,
    cx: pos[0], cy: pos[1], cz: pos[2], cr: boundOfBoxes(boxes),
    carrierG, fringeM, powered: on,
  });

  const free = mk(FREEFALL_ID, 'freefall', [freeBox], 0, true);
  const gen = mk(GENERATOR_ID, 'generator', deckBoxes, GENERATOR_FRINGE_M, powered);
  volumes.add(free);
  volumes.add(gen);
  installed = [free, gen];

  lastReport = {
    carrierG,
    freefallHalfM: H,
    deckBoxes: deckBoxes.length,
    airlockX,
    headroomM: DECK_HEADROOM_M,
    fringeM: GENERATOR_FRINGE_M,
    powered,
    volumes: volumes.count,
  };
  return lastReport;
}

/** Forget the installed volumes without touching the registry. */
export function resetStationGravity(): void { installed = []; }

/** Unused today; kept so a caller can name the axis without importing three. */
export function stationUp(pos: Vec3n): THREE.Vector3 {
  return new THREE.Vector3(pos[0], pos[1], pos[2]).normalize();
}
