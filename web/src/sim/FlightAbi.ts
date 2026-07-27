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
  vesselAbi, FLIGHT_STATE_WORDS, TELEMETRY_WORDS, ORBIT_WORDS,
  PART_ROW_WORDS, TRANSFORM_WORDS,
} from './wasm/vesselabi.js';
import type { OfVesselModule } from './wasm/vesselabi.js';

export type Vec3 = [number, number, number];

/** flight.h `FlightState`. `forward` is the vessel +Y (the stack axis toward
 *  the nose) and `right` is the vessel +X, both in the body-centred frame. */
export interface FlightStateRow {
  pos: Vec3; vel: Vec3; forward: Vec3; right: Vec3; angVel: Vec3;
  timeS: number; throttle: number;
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
}

/** SasMode, flight.h §5. DW-30 item 2 ships Hold and the prograde holds. */
export const SAS_OFF = 0;
export const SAS_HOLD = 1;
export const SAS_PROGRADE = 2;
export const SAS_RETROGRADE = 3;
export const SAS_COMMAND = 4;

export const SAS_NAMES = ['OFF', 'HOLD', 'PRO', 'RET', 'CMD'] as const;

const ZERO: Vec3 = [0, 0, 0];

function v3(a: Float64Array, i: number): Vec3 {
  return [a[i] ?? 0, a[i + 1] ?? 0, a[i + 2] ?? 0];
}

export function flightState(M: OfCoreModule, f: number): FlightStateRow {
  const n = vesselAbi(M)._of_fl_state(f);
  if (n !== FLIGHT_STATE_WORDS) {
    return { pos: ZERO, vel: ZERO, forward: [0, 1, 0], right: [1, 0, 0],
             angVel: ZERO, timeS: 0, throttle: 0 };
  }
  const a = scratchF64(M, n);
  return {
    pos: v3(a, 0), vel: v3(a, 3), forward: v3(a, 6), right: v3(a, 9),
    angVel: v3(a, 12), timeS: a[15] ?? 0, throttle: a[16] ?? 0,
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
    });
  }
  return out;
}

/** DW-30 item 6: the gravity-turn ribbon, in radians from local vertical.
 *  `pastVertical` is false while the program is still holding straight up. */
export function guidancePitch(M: OfCoreModule, altitudeM: number):
    { pitchFromVerticalRad: number; pastVertical: boolean } {
  const n = vesselAbi(M)._of_fl_guidance_pitch(altitudeM);
  if (n !== 2) return { pitchFromVerticalRad: 0, pastVertical: false };
  const a = scratchF64(M, n);
  return { pitchFromVerticalRad: a[0] ?? 0, pastVertical: (a[1] ?? 0) !== 0 };
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
