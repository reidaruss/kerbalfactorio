// =============================================================================
// ManeuverAbi.ts - the typed reader for §17 of the bridge (ABI 11).
//
// One field per scratch word, in the order of_maneuver_api.inc writes them.
// Nothing here computes: the conic, the triad, the delta-v and the burn time
// are /core's, pinned by 242 checks in core/tests/test_maneuver.cpp including
// one that FLIES the burn a node describes and compares the orbit reached
// against the orbit predicted. A TypeScript re-derivation would be a second
// answer to "where is the trajectory", which is the failure this project has
// paid for six times.
//
// Standing rule 5: the scratch view is re-read after every call and copied out
// before the next one. Never hold a view across a call into WASM.
// =============================================================================
import { scratchF64 } from './wasm/heap.js';
import type { OfVesselModule } from './wasm/vesselabi.js';
import { NODE_PLAN_WORDS, ORBIT_META_WORDS } from './wasm/vesselabi.js';

export type Vec3 = [number, number, number];

/** The scalars that go beside a drawn conic. */
export interface OrbitMeta {
  bound: boolean;
  periodS: number;
  semiMajorAxisM: number;
  eccentricity: number;
  /** Against the WORLD's +Y pole, not orbital::Elements::i (PH-40). */
  inclinationRad: number;
  apoapsisAltM: number;
  periapsisAltM: number;
  /** -1 when there is no such time (an unbound trajectory has no apoapsis). */
  timeToApoapsisS: number;
  timeToPeriapsisS: number;
  apoapsis: Vec3;
  periapsis: Vec3;
  /** The orbit pole, from /core. A map builds its projection frame off this
   *  rather than taking its own cross product of r and v. */
  normal: Vec3;
}

/** Everything a maneuver node publishes. It commands nothing. */
export interface NodePlan {
  valid: boolean;
  /** Where the burn happens, body-centred inertial. */
  position: Vec3;
  /** Velocity AT the node AFTER the impulse: feed it with `position` to
   *  orbitPath() to draw the trajectory this node produces. */
  postBurnVel: Vec3;
  /** Unit, inertial. Where to point the nose; also what hold-node feeds to
   *  SAS Command. */
  burnDirection: Vec3;

  deltaVMS: number;
  timeToNodeS: number;
  /** When to LIGHT IT: the node minus half the burn. Negative means late. */
  timeToBurnStartS: number;
  burnDurationS: number;
  burnLeadS: number;

  deltaVAvailableMS: number;
  shortfallMS: number;
  feasible: boolean;
  stagesUsed: number;
  /** How much of an orbit the burn takes. The impulsive plan is only as good
   *  as this is small, and it is published rather than assumed. */
  burnFractionOfPeriod: number;

  apoapsisAltM: number;
  periapsisAltM: number;
  semiMajorAxisM: number;
  eccentricity: number;
  periodS: number;
  boundAfter: boolean;
}

const ZERO3: Vec3 = [0, 0, 0];

function v3(a: Float64Array, i: number): Vec3 {
  return [a[i], a[i + 1], a[i + 2]];
}

export const EMPTY_META: OrbitMeta = {
  bound: false, periodS: 0, semiMajorAxisM: 0, eccentricity: 0,
  inclinationRad: 0, apoapsisAltM: 0, periapsisAltM: 0,
  timeToApoapsisS: -1, timeToPeriapsisS: -1,
  apoapsis: ZERO3, periapsis: ZERO3, normal: [0, 1, 0],
};

export const EMPTY_PLAN: NodePlan = {
  valid: false, position: ZERO3, postBurnVel: ZERO3, burnDirection: [0, 1, 0],
  deltaVMS: 0, timeToNodeS: 0, timeToBurnStartS: 0,
  burnDurationS: 0, burnLeadS: 0,
  deltaVAvailableMS: 0, shortfallMS: 0, feasible: true, stagesUsed: 0,
  burnFractionOfPeriod: 0,
  apoapsisAltM: 0, periapsisAltM: 0, semiMajorAxisM: 0, eccentricity: 0,
  periodS: 0, boundAfter: false,
};

/**
 * The conic through (p, v) as a flat [x,y,z, x,y,z, ...] array in the
 * body-centred inertial frame. Copied out of the scratch immediately.
 */
export function orbitPath(M: OfVesselModule, f: number, p: Vec3, v: Vec3,
                          samples: number): Float64Array {
  const n = M._of_mn_path(f, p[0], p[1], p[2], v[0], v[1], v[2], samples);
  if (n <= 0) return new Float64Array(0);
  return scratchF64(M, n * 3).slice();
}

export function orbitMeta(M: OfVesselModule, f: number, p: Vec3, v: Vec3): OrbitMeta {
  const n = M._of_mn_orbit_meta(f, p[0], p[1], p[2], v[0], v[1], v[2]);
  if (n !== ORBIT_META_WORDS) return EMPTY_META;
  const a = scratchF64(M, ORBIT_META_WORDS);
  return {
    bound: a[0] !== 0, periodS: a[1], semiMajorAxisM: a[2], eccentricity: a[3],
    inclinationRad: a[4], apoapsisAltM: a[5], periapsisAltM: a[6],
    timeToApoapsisS: a[7], timeToPeriapsisS: a[8],
    apoapsis: v3(a, 9), periapsis: v3(a, 12), normal: v3(a, 15),
  };
}

export function nodePlan(M: OfVesselModule, f: number, tFromNowS: number,
                         dvProgradeMS: number, dvNormalMS: number,
                         dvRadialMS: number): NodePlan {
  const n = M._of_mn_plan(f, tFromNowS, dvProgradeMS, dvNormalMS, dvRadialMS);
  if (n !== NODE_PLAN_WORDS) return EMPTY_PLAN;
  const a = scratchF64(M, NODE_PLAN_WORDS);
  return {
    valid: a[0] !== 0,
    position: v3(a, 1), postBurnVel: v3(a, 4), burnDirection: v3(a, 7),
    deltaVMS: a[10], timeToNodeS: a[11], timeToBurnStartS: a[12],
    burnDurationS: a[13], burnLeadS: a[14],
    deltaVAvailableMS: a[15], shortfallMS: a[16], feasible: a[17] !== 0,
    stagesUsed: a[18], burnFractionOfPeriod: a[19],
    apoapsisAltM: a[20], periapsisAltM: a[21], semiMajorAxisM: a[22],
    eccentricity: a[23], periodS: a[24], boundAfter: a[25] !== 0,
  };
}
