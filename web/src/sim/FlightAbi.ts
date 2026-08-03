// Typed readers over the `of_fl_*` half of the bridge (ABI 6, WASM-BRIDGE §13.2).
//
// Every function here calls the producing export FIRST and copies out of the
// scratch arena IMMEDIATELY, before any other call into WASM. That is standing
// rule 5 and it is not optional: ALLOW_MEMORY_GROWTH detaches every ArrayBuffer,
// so a cached view is a silent corruption waiting for the next allocation.
//
// Nothing in this file computes anything. If a number here disagrees with
// core/tests/test_flight.cpp, this file is wrong and /core is right.
import { scratchF64, scratchI32 } from './wasm/heap.js';
import type { OfCoreModule } from './wasm/heap.js';
import {
  vesselAbi, FLIGHT_STATE_WORDS, SAS_MODE_UNKNOWN, TELEMETRY_WORDS, ORBIT_WORDS,
  PART_ROW_WORDS, TRANSFORM_WORDS, RCS_WORDS, DOCK_STATUS_WORDS,
} from './wasm/vesselabi.js';
import type { OfVesselModule } from './wasm/vesselabi.js';

export type Vec3 = [number, number, number];

/** flight.h `FlightState`. `forward` is the vessel +Y (the stack axis toward
 *  the nose) and `right` is the vessel +X, both in the body-centred frame. */
export interface FlightStateRow {
  pos: Vec3; vel: Vec3; forward: Vec3; right: Vec3; angVel: Vec3;
  timeS: number; throttle: number;
  /** /core's OWN sas mode, indexes `SAS_NAMES`. `SAS_MODE_UNKNOWN` (-1) means
   *  the wasm predates the word; it is NOT a mode and must not be shown as
   *  OFF, which is a real mode and a different claim. */
  sasMode: number;
}

/** flight.h `FlightTelemetry`. `altitudeM` is above the 600 km DATUM, not above
 *  the ground under the vessel; the session computes AGL itself. */
export interface FlightTelemetryRow {
  altitudeM: number; speedMS: number; qPa: number; densityKgM3: number;
  massKg: number; thrustN: number; accelMS2: number; aoaRad: number;
  staticMarginM: number; sasErrorRad: number;
  sasSaturated: boolean; inSpace: boolean;
}

/** flight.h `OrbitSummary`. An unbound trajectory reports apoapsis 1e308. */
export interface OrbitRow {
  apoapsisAltM: number; periapsisAltM: number; semiMajorAxisM: number;
  eccentricity: number; periodS: number; bound: boolean;
}

export interface FlightPartRow {
  handle: number; partId: number; parent: number; attach: number; stage: number;
  originM: Vec3; radialAngleRad: number; propellantKg: number;
  /** ABI 20, word 8. 0 unless `attach` is ATTACH_RADIAL. */
  radialOffsetM: number;
}

/** SasMode, flight.h §5. DW-30 item 2 ships Hold and the prograde holds. */
export const SAS_OFF = 0;
export const SAS_HOLD = 1;
export const SAS_PROGRADE = 2;
export const SAS_RETROGRADE = 3;
export const SAS_COMMAND = 4;
/** ABI 11. APPENDED, so 0..4 still mean what every shipped probe thinks. They
 *  point at orbital::basisAt's triad, the SAME triad a maneuver node's handles
 *  are expressed in. There is no Node mode: a node's direction is fixed in
 *  inertial space, so SAS_COMMAND plus FlightSession.commandDirection IS it. */
export const SAS_NORMAL = 5;
export const SAS_ANTINORMAL = 6;
export const SAS_RADIAL_IN = 7;
export const SAS_RADIAL_OUT = 8;

export const SAS_NAMES =
  ['OFF', 'HOLD', 'PRO', 'RET', 'CMD', 'NML', 'ANM', 'RIN', 'ROT'] as const;

const ZERO: Vec3 = [0, 0, 0];

function v3(a: Float64Array, i: number): Vec3 {
  return [a[i] ?? 0, a[i + 1] ?? 0, a[i + 2] ?? 0];
}

/** THE STRIDE CHECK IS A MINIMUM AND NOT AN EQUALITY, AND THAT IS DELIBERATE
 *  (PH-168). `!== FLIGHT_STATE_WORDS` was here, and it means that appending a
 *  single word to `of_fl_state` without bumping the constant in the same commit
 *  returns THE ZERO ROW: no position, no velocity, no attitude, silently, for
 *  every consumer. That is R39's shape (`of_vs_part_info`'s exact stride would
 *  have emptied the whole parts catalogue) landing on the row that carries the
 *  vehicle itself, and it is a trap in a repository where the wasm binary and
 *  the TypeScript are committed by different lanes at different times.
 *
 *  The row is a PREFIX CONTRACT: words 0..16 have one meaning for ever, and
 *  anything past them is read defensively. So an older wasm yields a correct
 *  state row and `sasMode` -1, which a screen can render as "unknown" instead
 *  of rendering a vehicle at the origin. */
const FLIGHT_STATE_WORDS_MIN = 17;

export function flightState(M: OfCoreModule, f: number): FlightStateRow {
  const n = vesselAbi(M)._of_fl_state(f);
  if (n < FLIGHT_STATE_WORDS_MIN) {
    return { pos: ZERO, vel: ZERO, forward: [0, 1, 0], right: [1, 0, 0],
             angVel: ZERO, timeS: 0, throttle: 0, sasMode: SAS_MODE_UNKNOWN };
  }
  const a = scratchF64(M, n);
  return {
    pos: v3(a, 0), vel: v3(a, 3), forward: v3(a, 6), right: v3(a, 9),
    angVel: v3(a, 12), timeS: a[15] ?? 0, throttle: a[16] ?? 0,
    sasMode: n >= FLIGHT_STATE_WORDS ? (a[17] ?? SAS_MODE_UNKNOWN)
                                     : SAS_MODE_UNKNOWN,
  };
}

export function flightTelemetry(M: OfCoreModule, f: number): FlightTelemetryRow {
  const n = vesselAbi(M)._of_fl_telemetry(f);
  if (n !== TELEMETRY_WORDS) {
    return { altitudeM: 0, speedMS: 0, qPa: 0, densityKgM3: 0, massKg: 0,
             thrustN: 0, accelMS2: 0, aoaRad: 0, staticMarginM: 0,
             sasErrorRad: 0, sasSaturated: false, inSpace: false };
  }
  const a = scratchF64(M, n);
  return {
    altitudeM: a[0] ?? 0, speedMS: a[1] ?? 0, qPa: a[2] ?? 0,
    densityKgM3: a[3] ?? 0, massKg: a[4] ?? 0, thrustN: a[5] ?? 0,
    accelMS2: a[6] ?? 0, aoaRad: a[7] ?? 0, staticMarginM: a[8] ?? 0,
    sasErrorRad: a[9] ?? 0, sasSaturated: (a[10] ?? 0) !== 0,
    inSpace: (a[11] ?? 0) !== 0,
  };
}

export function flightOrbit(M: OfCoreModule, f: number): OrbitRow {
  const n = vesselAbi(M)._of_fl_orbit(f);
  if (n !== ORBIT_WORDS) {
    return { apoapsisAltM: 0, periapsisAltM: 0, semiMajorAxisM: 0,
             eccentricity: 0, periodS: 0, bound: false };
  }
  const a = scratchF64(M, n);
  return {
    apoapsisAltM: a[0] ?? 0, periapsisAltM: a[1] ?? 0, semiMajorAxisM: a[2] ?? 0,
    eccentricity: a[3] ?? 0, periodS: a[4] ?? 0, bound: (a[5] ?? 0) !== 0,
  };
}

/**
 * The live craft's tree AND its layout, in one call pair.
 *
 * The two exports share the row order by contract (`of_flight_api.inc`), and
 * the i32 read is taken and COPIED before the f64 call runs, because the second
 * call resets the arena and may grow the heap under the first view.
 */
export function flightParts(M: OfCoreModule, f: number): FlightPartRow[] {
  const V: OfVesselModule = vesselAbi(M);
  const n = V._of_fl_parts(f);
  if (n <= 0) return [];
  const rows = Array.from(scratchI32(M, n * PART_ROW_WORDS));
  const m = V._of_fl_transforms(f);
  if (m !== n) return [];
  const t = Array.from(scratchF64(M, n * TRANSFORM_WORDS));
  const out: FlightPartRow[] = [];
  for (let i = 0; i < n; ++i) {
    const r = i * PART_ROW_WORDS;
    const q = i * TRANSFORM_WORDS;
    out.push({
      handle: rows[r] ?? -1, partId: rows[r + 1] ?? 0, parent: rows[r + 2] ?? -1,
      attach: rows[r + 3] ?? 0, stage: rows[r + 4] ?? 0,
      originM: [t[q] ?? 0, t[q + 1] ?? 0, t[q + 2] ?? 0],
      radialAngleRad: t[q + 6] ?? 0, propellantKg: t[q + 7] ?? 0,
      radialOffsetM: t[q + 8] ?? 0,
    });
  }
  return out;
}

export interface AscentGuidance {
  /** Where to aim, as an angle from the local vertical, AFTER every clamp.
   *  Compose it with your own east: east stays this side's (PH-40). */
  pitchFromVerticalRad: number;
  /** What the schedule asked for BEFORE the terrain clamp. Apart from the
   *  above means the ground is vetoing the turn, which a screen can say. */
  schedulePitchRad: number;
  /** Datum-relative, off the state vector rather than a `bound` flag (R14).
   *  0 when the arc does not come back down. */
  apoapsisAltM: number;
  /** WHICH LAW IS DRAWING. True: the altitude schedule, scheduled off this
   *  body's own air. False: apoapsis progress, which is what an airless ascent
   *  actually flies and is 82.56 m/s cheaper on Cinder than the other one. */
  atmospheric: boolean;
  /** False when this body is airless and no ascent target has been set, so
   *  there is no schedule to draw. Draw nothing and refuse by name. */
  usable: boolean;
}

/**
 * DW-30 item 6, R87: the guidance ribbon, with a body under it.
 *
 * `targetApoapsisM` is ignored on a body with air and required without one.
 * `altitudeAglM` is this side's, because terrain is this side's: /core's flight
 * sim knows the datum radius and nothing about the ground under the vehicle.
 *
 * A ZERO-WORD ANSWER IS A REFUSAL AND NOT A ZERO PITCH, which is why `usable`
 * is false rather than the pitch being 0: pitch 0 is a legitimate command
 * (straight up, off the pad, every launch) and must never double as "no idea".
 */
export function ascentGuidance(M: OfCoreModule, f: number,
                               targetApoapsisM: number,
                               altitudeAglM: number): AscentGuidance {
  const none: AscentGuidance = {
    pitchFromVerticalRad: 0, schedulePitchRad: 0, apoapsisAltM: 0,
    atmospheric: false, usable: false,
  };
  const n = vesselAbi(M)._of_fl_ascent_guidance(f, targetApoapsisM, altitudeAglM);
  if (n !== 5) return none;
  const a = scratchF64(M, n);
  return {
    pitchFromVerticalRad: a[0] ?? 0,
    schedulePitchRad: a[1] ?? 0,
    apoapsisAltM: a[2] ?? 0,
    atmospheric: (a[3] ?? 0) !== 0,
    usable: (a[4] ?? 0) !== 0,
  };
}

/** PH-301. What the RCS is doing, which is three states that all look like
 *  "nothing happened" from outside: no command, no blocks, no monopropellant. */
export interface RcsRow {
  /** What the LAST STEP actually applied. Never the command: a vehicle out of
   *  monopropellant is commanded and delivering nothing, and an approach that
   *  assumed its command landed would fly into the station. */
  deliveredN: number;
  /** Already zero when the monopropellant is gone, so `availableN === 0` with
   *  `monopropKg > 0` is "no blocks fitted" and with 0 is "empty". */
  availableN: number;
  monopropKg: number;
  commandT: number;
}

export function flightRcs(M: OfCoreModule, f: number): RcsRow {
  const none: RcsRow = { deliveredN: 0, availableN: 0, monopropKg: 0, commandT: 0 };
  const n = vesselAbi(M)._of_fl_rcs?.(f) ?? 0;
  if (n < RCS_WORDS) return none;
  const a = scratchF64(M, RCS_WORDS);
  return { deliveredN: a[0] ?? 0, availableN: a[1] ?? 0,
           monopropKg: a[2] ?? 0, commandT: a[3] ?? 0 };
}

/** PH-303. How the approach is going. Words 2 and 4..6 describe THIS TICK;
 *  words 3 and 8..10 describe the BEST PASS since arming, and the split is why
 *  a screen can say "too fast" after the vehicle has already flown past. */
export interface DockStatusRow {
  armed: boolean; captured: boolean;
  separationM: number; closestApproachM: number;
  closingMS: number; coneErrorRad: number;
  /** 0 captured or nothing yet, 1 never within the capture radius, 2 not
   *  facing each other, 3 too fast. THIS TICK. */
  reason: number;
  tests: number;
  /** The reason AT the closest pass. THE ONE A SCREEN SHOWS. */
  bestReason: number;
  bestClosingMS: number;
  bestConeErrorRad: number;
}

const NO_DOCK: DockStatusRow = {
  armed: false, captured: false, separationM: 0, closestApproachM: -1,
  closingMS: 0, coneErrorRad: 0, reason: 0, tests: 0,
  bestReason: 0, bestClosingMS: 0, bestConeErrorRad: 0,
};

export function dockStatus(M: OfCoreModule, f: number): DockStatusRow {
  const n = vesselAbi(M)._of_fl_dock_status?.(f) ?? 0;
  if (n < DOCK_STATUS_WORDS) return NO_DOCK;
  const a = scratchF64(M, DOCK_STATUS_WORDS);
  return {
    armed: (a[0] ?? 0) !== 0, captured: (a[1] ?? 0) !== 0,
    separationM: a[2] ?? 0, closestApproachM: a[3] ?? -1,
    closingMS: a[4] ?? 0, coneErrorRad: a[5] ?? 0,
    reason: a[6] ?? 0, tests: a[7] ?? 0,
    bestReason: a[8] ?? 0, bestClosingMS: a[9] ?? 0,
    bestConeErrorRad: a[10] ?? 0,
  };
}

/** PH-303. The sentence for a refusal code. It lives here rather than in a
 *  panel because two panels would otherwise write two vocabularies for one
 *  answer, and `docking.h`'s own `note` is a `const char*` the bridge cannot
 *  carry. Kept word for word in step with that header. */
export function dockReasonText(reason: number): string {
  if (reason === 1) return 'the ports never came within the capture radius';
  if (reason === 2) return 'the ports are not facing each other';
  if (reason === 3) return 'closing too fast to latch';
  return '';
}

// --- small vector helpers, used by the session and the observer -------------

export function norm(v: Vec3): Vec3 {
  const l = Math.hypot(v[0], v[1], v[2]);
  if (!(l > 1e-12)) return [0, 1, 0];
  return [v[0] / l, v[1] / l, v[2] / l];
}
export function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
export function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2],
          a[0] * b[1] - a[1] * b[0]];
}
export function add(a: Vec3, b: Vec3, s = 1): Vec3 {
  return [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];
}
export function scale(a: Vec3, s: number): Vec3 {
  return [a[0] * s, a[1] * s, a[2] * s];
}
export function len(a: Vec3): number { return Math.hypot(a[0], a[1], a[2]); }

/** Rotate `v` about a unit `axis` by `ang` radians (Rodrigues). */
export function rotateAbout(v: Vec3, axis: Vec3, ang: number): Vec3 {
  const c = Math.cos(ang), s = Math.sin(ang);
  const k = cross(axis, v);
  const d = dot(axis, v) * (1 - c);
  return [v[0] * c + k[0] * s + axis[0] * d,
          v[1] * c + k[1] * s + axis[1] * d,
          v[2] * c + k[2] * s + axis[2] * d];
}
