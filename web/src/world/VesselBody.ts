// GP-650 to GP-654. WHICH BODY IS THIS VESSEL AT, AND WHAT IS THAT BODY.
//
// Reid, on a real GPU, build cfeffad: teleport to the moon, open the map, and
// the space station is drawn in orbit around CINDER. Teleport home and the
// panel's numbers change. The two readings he sent are the whole diagnosis:
//
//   on Cinder (biome 9)   Anchorage AP / PE   800.0 / 800.0 km
//   on Forge  (biome 1)   Anchorage AP / PE   400.0 / 400.0 km
//
// Anchorage's conic is ONE conic and it never moved: a = 1,000,000.0000000008 m,
// e = 5.3e-16, measured off `of.flight('vessels')` on both bodies in the same
// driven run. 1,000,000 - 600,000 is 400 km and 1,000,000 - 200,000 is 800 km.
// So the altitude was being taken against WHICHEVER BODY THE PLAYER WAS
// STANDING ON, and the orbit line and the marker were being drawn in that
// body's frame for the same reason: nothing anywhere asked which body the
// record is at, because a record could not answer.
//
// IT COULD NOT ANSWER BECAUSE IT DID NOT CARRY THE QUESTION. `SaveWorlds.ts`
// classifies `vessels` as a GLOBAL save key, deliberately and correctly -- "the
// pack, the research, the milestones, the vessels and the time of day are ONE
// world's, not one body's" -- so every record crosses to the moon with the
// player. What was missing is the other half of that decision: a global record
// has to SAY where it is. `VesselRecord.bodyId` is that half, and this file is
// the one place that reads it and turns it into numbers.
//
// NO NEW BODY TABLE, AND THE RULE IS NOT A STYLE PREFERENCE. `SaveSlots.ts`
// counted four separate places that already map a bodyId to a word and refused
// to author a fifth for a list row. So the facts here come from `readFacts`,
// which is the client's ONE reader of `of_body_facts` (RN-845), and which
// answers for a body NOBODY IS STANDING ON -- which is precisely the case that
// has no live `PlanetBody` to ask. Nothing below transcribes a radius, a mu or
// a name, and a third body authored in /core is handled with no edit here.
//
// NOTHING IS CACHED. A body's radius and mu are constants, so a cache would be
// safe and would also be a second copy of a fact this project has paid for four
// times already. The call is one wasm entry point per row per frame over a
// handful of rows; the map already pays a 192-sample Kepler sweep per orbit.

import { readFacts } from '../render/CelestialEphemeris.js';
import type { EphemerisModule } from '../render/CelestialEphemeris.js';
import type { OfCoreModule } from '../sim/wasm/heap.js';
import type { VesselRecord } from '../sim/VesselRegistry.js';

/** A body as an orbit needs it: what to subtract, what to propagate with, and
 *  what to call it on screen. /core's own `BodyParams`, never a constant. */
export interface OrbitBody {
  readonly id: number;
  readonly name: string;
  readonly radiusM: number;
  readonly muM3S2: number;
}

/** How far the id search below will look before giving up. NOT a body count:
 *  /core's own refusal is the terminator (see `bodyIdFromMu`). */
const SEARCH_MAX_ID = 8;

/**
 * `of_body_facts(id)` as an `OrbitBody`, or null when /core refuses the id.
 *
 * The refusal is preserved rather than turned into a plausible default, exactly
 * as `CelestialEphemeris` preserves it: a row that cannot name its body must
 * say so, because an altitude quietly taken against the wrong radius is the
 * defect this file exists to remove and it reads perfectly healthy.
 */
export function orbitBody(M: OfCoreModule, id: number): OrbitBody | null {
  const f = readFacts(M as EphemerisModule, id);
  if (f === null) return null;
  return { id: f.id, name: f.name, radiusM: f.radiusM, muM3S2: f.muM3S2 };
}

/**
 * Recover a body id from a conic's own `mu`, for a record written before
 * `bodyId` existed.
 *
 * This is not a guess. `fitConic` hands `of_orb_park` the mu it was given and
 * /core copies it into the elements verbatim, and the mu it was given is the
 * live body's `_of_body_mu`. So the mu ON THE RECORD is the mu OF THE BODY, and
 * matching it back is reading the number the conic was fitted with.
 *
 * A RELATIVE TOLERANCE AND NOT `===`, because the two readings arrive by
 * different exports (`_of_body_mu(handle)` against `of_body_facts(id)`) and a
 * bit of difference between two spellings of one constant would silently return
 * "no such body" and put every legacy record back on the observer's radius,
 * which is the defect wearing a new hat. 1e-9 is far tighter than the gap
 * between any two bodies (Forge and Cinder differ by a factor of 54).
 */
export function bodyIdFromMu(M: OfCoreModule, mu: number): number {
  if (!(mu > 0)) return -1;
  for (let id = 0; id < SEARCH_MAX_ID; ++id) {
    const b = orbitBody(M, id);
    // /core returns 0 words for an unknown id, which IS the end of the list.
    if (b === null) return -1;
    if (Math.abs(b.muM3S2 - mu) <= 1e-9 * Math.max(b.muM3S2, mu)) return b.id;
  }
  return -1;
}

/**
 * THE BODY A RECORD IS AT.
 *
 * `rec.bodyId` is the authority and every record minted since GP-650 has one.
 * A record read off a slot written before then has no field at all, so its
 * conic's mu is asked instead; a PARKED or FROZEN legacy record has neither,
 * and `fallbackId` (the body the client is on) is the honest answer for it,
 * because a record with a fixed position in a body frame and no body named is
 * a record about the world it was saved in.
 */
export function bodyIdOf(M: OfCoreModule, rec: VesselRecord,
                        fallbackId: number): number {
  if (typeof rec.bodyId === 'number' && rec.bodyId >= 0) return rec.bodyId;
  if (rec.where.kind === 'conic') {
    const id = bodyIdFromMu(M, rec.where.el.mu);
    if (id >= 0) return id;
  }
  return fallbackId;
}

/** A record's apo/periapsis ALTITUDE and the body they are measured against. */
export interface RecordOrbit {
  /** null when /core does not know the record's body id. */
  readonly body: OrbitBody | null;
  /** NaN when the record has no conic (parked, frozen) or no known body. */
  readonly apoapsisAltM: number;
  readonly periapsisAltM: number;
}

/**
 * AP / PE FOR ONE RECORD, AGAINST ITS OWN BODY.
 *
 * The one arithmetic this file does, and it is here rather than at each of the
 * three call sites (the map's vessel rows, the autopilot's target list and the
 * 3D scene's own filter) because three copies of `a(1 +/- e) - R` is three
 * chances to pick the wrong R, which is the bug being fixed.
 */
export function recordOrbit(M: OfCoreModule, rec: VesselRecord,
                            fallbackId: number): RecordOrbit {
  const body = orbitBody(M, bodyIdOf(M, rec, fallbackId));
  const el = rec.where.kind === 'conic' ? rec.where.el : null;
  if (body === null || el === null) {
    return { body, apoapsisAltM: Number.NaN, periapsisAltM: Number.NaN };
  }
  return {
    body,
    apoapsisAltM: el.a * (1 + el.e) - body.radiusM,
    periapsisAltM: el.a * (1 - el.e) - body.radiusM,
  };
}
