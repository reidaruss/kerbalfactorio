// RN-845. WHERE THE BODIES ARE, read from /core and never derived.
//
// Split out of CelestialBodies.ts on the 400-line cap, and the boundary is a
// real one rather than a convenience: everything in this file is a READ of
// PH-161's two exports, and nothing in it knows what a mesh is. That matters
// because the whole reason this feature exists is that the client had no way to
// ask where a body was, and the previous rendering lane refused to transcribe
// `kCinderOrbitRadiusM` rather than answer the question itself. This file is
// where that refusal is kept honest: if a number about a body's position or
// size ever appears anywhere else in the render tree, it is a bug.
//
// TWO REFUSALS FROM PHYSICS ARE PRESERVED HERE RATHER THAN PAPERED OVER:
//
//  - FORGE RETURNS ZEROS, because Forge IS the parent frame and its position in
//    its own frame is the origin. That is the truth and not a stub, and
//    `relativeTo` below is written so the zeros do the right thing arithmetically
//    instead of being special-cased.
//  - AN UNKNOWN BODY RETURNS 0 WORDS rather than a plausible origin. `readFacts`
//    turns that into null, and `discover` uses it as the END OF THE BODY LIST.
//    A third body authored in /core therefore appears with no edit here, and the
//    refusing case is exercised on every boot instead of being a branch nobody
//    reaches.

import * as THREE from 'three';
import type { BodyId } from '../world/PlanetBody.js';
import { scratchF64, type OfCoreModule } from '../sim/wasm/heap.js';
import { BODY_STATE_WORDS, BODY_FACTS_WORDS } from '../sim/wasm/vesselabi.js';

/** The two additive PH-161 exports, symbol-detected exactly as `Autopilot.ts`
 *  detects the planning half: a client running an older wasm must say what it
 *  is missing rather than draw a moon at the origin. */
export interface BodyEphemerisAbi {
  _of_body_state?(bodyId: number, simTimeS: number): number;
  _of_body_facts?(bodyId: number): number;
}

export type EphemerisModule = OfCoreModule & BodyEphemerisAbi;

export interface BodyFacts {
  readonly id: BodyId;
  readonly name: string;
  readonly radiusM: number;
  readonly muM3S2: number;
  readonly soiRadiusM: number;
  readonly orbitPeriodS: number;
  readonly airless: boolean;
  /** /core's atmosphere ceiling, metres. 0 on an airless body. */
  readonly atmoTopM: number;
  /**
   * THE AIR'S SCALE HEIGHT, MEASURED FROM /core'S OWN DENSITY PROFILE rather
   * than assumed. `_of_atmo_density(id, alt)` is already exported and already
   * used by `MapBoot`, so the twilight arc's falloff can be the real profile's
   * instead of a number in a shader. 0 on an airless body.
   *
   * Two samples and a log, at the datum and at a sixth of the ceiling, which is
   * where a roughly exponential column still has most of its mass. If /core
   * ever ships a profile that is NOT exponential this stays a fit rather than a
   * fact, which is why it is named `fit` in the report and not `scaleHeight`.
   */
  readonly atmoScaleHM: number;
}

/** How far the discovery loop will look before giving up. Not a body count. */
const SEARCH_MAX_ID = 8;

export function hasEphemeris(M: EphemerisModule): boolean {
  return typeof M._of_body_state === 'function'
    && typeof M._of_body_facts === 'function';
}

/** `of_body_facts`, or null when /core refuses the id. */
export function readFacts(M: EphemerisModule, id: number): BodyFacts | null {
  if (M._of_body_facts === undefined) return null;
  if (M._of_body_facts(id) !== BODY_FACTS_WORDS) return null;
  const f = scratchF64(M, BODY_FACTS_WORDS);
  // The atmosphere query is a pure function of the bodyId (atmosphere.h
  // section 2), so it takes no handle, and the disc's photometric law ends up
  // decided by exactly the authority `PlanetBody.hasAtmosphere` uses.
  const rho0 = M._of_atmo_density(id, 0);
  const top = M._of_atmo_space_altitude(id);
  const air = rho0 > 0 && top > 0;
  let scaleH = 0;
  if (air) {
    const a = top / 6;
    const rho = M._of_atmo_density(id, a);
    scaleH = rho > 0 && rho < rho0 ? -a / Math.log(rho / rho0) : top / 6;
  }
  return {
    id: id as BodyId,
    name: id === 1 ? 'Cinder' : id === 0 ? 'Forge' : `body${id}`,
    radiusM: f[0], muM3S2: f[1], soiRadiusM: f[2], orbitPeriodS: f[3],
    airless: !air,
    atmoTopM: air ? top : 0,
    atmoScaleHM: scaleH,
  };
}

/** Every body /core will admit to, plus the id it refused. */
export function discover(M: EphemerisModule): {
  bodies: BodyFacts[]; refusedId: number;
} {
  const bodies: BodyFacts[] = [];
  for (let id = 0; id < SEARCH_MAX_ID; ++id) {
    const f = readFacts(M, id);
    if (f === null) return { bodies, refusedId: id };
    bodies.push(f);
  }
  return { bodies, refusedId: -1 };
}

/** Position of `id` in the ROOT frame, metres, at `t`. Zero on a refusal, which
 *  is correct for Forge (it IS the root) and harmless for an unknown id,
 *  because `discover` has already established which ids exist. */
export function stateOf(M: EphemerisModule, id: number, t: number,
  out: THREE.Vector3): THREE.Vector3 {
  if (M._of_body_state === undefined) return out.set(0, 0, 0);
  if (M._of_body_state(id, t) !== BODY_STATE_WORDS) return out.set(0, 0, 0);
  const s = scratchF64(M, BODY_STATE_WORDS);
  return out.set(s[0], s[1], s[2]);
}

/**
 * `id`'s position in the frame centred on `hostId`, at `t`.
 *
 * This is the whole of the frame arithmetic and it is one subtraction, which is
 * the point: the observer's own body is the origin of the frame being drawn, so
 * every other body is its root-frame state minus the host's. For a host of
 * Forge that subtracts the zeros physics deliberately returns, and the same
 * expression then draws Forge from Cinder with no branch and no second sign
 * convention. It is exact because `sim_world.h` installs Cinder as a pure
 * TRANSLATION of Forge's frame; if a body is ever given a frame rotation this
 * function is where that has to be answered.
 */
export function relativeTo(M: EphemerisModule, id: number, hostId: number,
  t: number, out: THREE.Vector3): THREE.Vector3 {
  const host = stateOf(M, hostId, t, new THREE.Vector3());
  return stateOf(M, id, t, out).sub(host);
}

/**
 * /core's density column, normalised, as a curve rather than a fit.
 *
 * `atmoScaleHM` above is a TWO-POINT fit and a two-point fit to a curve that is
 * not exponential is a number that looks like a measurement and is not one.
 * This publishes the shape it was fitted to, so the assumption can be checked
 * against the thing it assumes about instead of being believed.
 */
export function airProfile(M: EphemerisModule, id: number, n = 13):
  { altM: number; rel: number }[] {
  const top = M._of_atmo_space_altitude(id);
  const rho0 = M._of_atmo_density(id, 0);
  if (!(top > 0) || !(rho0 > 0)) return [];
  const out: { altM: number; rel: number }[] = [];
  for (let i = 0; i < n; ++i) {
    const altM = (top * i) / (n - 1);
    out.push({ altM, rel: M._of_atmo_density(id, altM) / rho0 });
  }
  return out;
}
