// =============================================================================
// AutopilotTargets.ts - WHAT AN AUTOPILOT CAN BE POINTED AT.
//
// GP-263. Reid asked for "objects in orbit, later also other planetary bodies",
// and the word that matters in that sentence is LATER. A list built around the
// vessel registry with a body bolted on afterwards is the shape this project
// has paid for before: the second kind arrives, it does not fit, and the fix is
// a branch in every consumer. So there is ONE row type here and every consumer
// (the VAB gate, the map picker, the chart, the scheduler) sees only that type.
// A body is a SOURCE, exactly like the registry is a source, and adding one
// changes no picker, no gate and no chart.
//
// The row carries an ORBIT or it carries a REASON it has none, never neither
// and never both. That is VesselRegistry's own `VesselWhere` discipline (DW-26,
// "when one thing must be true in two places, name which place is true"), and
// it is why a body with no transfer solver is a visible greyed row rather than
// an absence: an absent destination teaches the player nothing, and the build
// menu already settled that argument (GP-114, four buildables locked BY NAME).
//
// NOTHING HERE COMPUTES A TRAJECTORY OR A DELTA-V. The elements are copied
// verbatim from whoever owns them (the registry for a vessel, the player's own
// two numbers for a requested orbit) and handed to the physics lane's solver.
// A second answer to "how much fuel does that cost" is the failure this project
// has paid for repeatedly, and `Autopilot.ts` states the whole rule.
// =============================================================================
import { registry } from '../sim/VesselRegistry.js';
import type { RailElements } from '../sim/VesselRegistry.js';

export type TargetKind = 'vessel' | 'body' | 'orbit';

/**
 * The destination orbit, in the SAME nine numbers `of_orb_park` publishes and
 * the registry stores. Copied, never re-derived: an element set that has been
 * through a conversion is a second conic, and an axis-convention mistake in one
 * is invisible until something flies.
 */
export interface TargetOrbit {
  semiMajorAxisM: number;
  eccentricity: number;
  inclinationRad: number;
  lanRad: number;
  argpRad: number;
  /**
   * WHERE ON THAT ORBIT the target actually is, at `epochS`. NaN when the
   * target has no phase, which is the honest state of a REQUESTED orbit: any
   * point on it will do, so there is no phase angle and no launch window, and
   * the departure curve for it is flat by construction rather than by accident.
   */
  trueAnomalyRad: number;
  epochS: number;
  muM3S2: number;
}

export interface AutopilotTarget {
  /** Stable within a session. 'v:<recordId>', 'b:<name>', 'orbit'. */
  readonly id: string;
  readonly kind: TargetKind;
  readonly name: string;
  /** One line saying what makes this a destination. Never a duplicate of the
   *  numbers beside it: the numbers are drawn from `orbit`. */
  readonly detail: string;
  readonly orbit: TargetOrbit | null;
  /** '' when this row can be planned for. Otherwise WHY NOT, as a sentence the
   *  screen prints verbatim. A row is never both plannable and blocked. */
  readonly blocked: string;
}

/** Where rows come from. The registry is one; a body table is another. */
export interface TargetSource {
  readonly id: string;
  list(): AutopilotTarget[];
}

/** The body the vehicle is at: its radius and gravity, from /core and never
 *  from a constant here (DW-18, the one gravity authority). */
export interface HomeBody {
  readonly name: string;
  readonly radiusM: number;
  readonly muM3S2: number;
}

function altOf(el: RailElements, radiusM: number, sign: number): number {
  return el.a * (1 + sign * el.e) - radiusM;
}

function km(m: number): string {
  if (!Number.isFinite(m)) return '---';
  return `${(m / 1000).toFixed(0)} km`;
}

export function degOf(rad: number): number { return (rad * 180) / Math.PI; }

/**
 * THE REGISTRY SOURCE. Every record the map already lists (GP-210), including
 * `Anchorage`, which is a VesselRecord like any other and needs no case of its
 * own here. That is the whole point of PH-64 making the registry the one answer
 * to "where is this vessel".
 *
 * A record that is PARKED or FROZEN has no conic, so it becomes a blocked row
 * naming that, rather than being filtered out: "my rocket on the pad is not in
 * the list" is a bug report, and "it is on the ground, so there is nothing to
 * rendezvous with" is an answer.
 */
export function registrySource(home: HomeBody, excludeId = 0): TargetSource {
  return {
    id: 'registry',
    list(): AutopilotTarget[] {
      const out: AutopilotTarget[] = [];
      for (const rec of registry.list()) {
        if (rec.id === excludeId) continue;
        const el = rec.where.kind === 'conic' ? rec.where.el : null;
        if (el === null) {
          out.push({
            id: `v:${rec.id}`, kind: 'vessel', name: rec.name,
            detail: rec.mode === 'parked'
              ? 'on the ground: nothing to rendezvous with'
              : 'held in flight: it is not on a conic',
            orbit: null,
            blocked: rec.mode === 'parked'
              ? `${rec.name} is on the ground, not in orbit`
              : `${rec.name} is in powered or atmospheric flight, so it has no `
                + 'orbit to aim at yet',
          });
          continue;
        }
        out.push({
          id: `v:${rec.id}`, kind: 'vessel', name: rec.name,
          detail: `${km(altOf(el, home.radiusM, 1))} / `
            + `${km(altOf(el, home.radiusM, -1))}, `
            + `${degOf(el.i).toFixed(1)} deg`,
          orbit: {
            semiMajorAxisM: el.a, eccentricity: el.e, inclinationRad: el.i,
            lanRad: el.lan, argpRad: el.argp, trueAnomalyRad: el.nu,
            epochS: el.epoch, muM3S2: el.mu,
          },
          blocked: '',
        });
      }
      return out;
    },
  };
}

/**
 * THE BODY SOURCE. Reid's "later also other planetary bodies", present TODAY as
 * rows that say what is missing.
 *
 * Data, not code: adding Cinder's transfer is deleting one `blocked` string and
 * filling one `orbit`, and no consumer moves. The reason is stated as physics'
 * own open item rather than as "not implemented", because a player who reads
 * "not implemented" learns nothing and a player who reads "the moon needs a
 * hand-off between two gravity fields, which this game cannot fly yet" does.
 */
export interface BodyRow {
  readonly name: string;
  readonly detail: string;
  readonly blocked: string;
}

export const BODIES: readonly BodyRow[] = [
  {
    name: 'Cinder',
    detail: 'the moon: a transfer leaves the gravity you are in',
    // GP-279. THE REASON CHANGED, SO THE SENTENCE CHANGED. It used to say the
    // hand-off "is not flown yet", and that is no longer true: physics has
    // flown a full moon mission in /core, ending in a bound orbit about Cinder
    // at 61.5 x 124.0 km with nobody at the controls. What is not true is the
    // BRIDGE. `of_ap_arm_transfer` builds a two-burn program and inserts no
    // mid-course correction, and nothing on the wasm face exposes the hand-off
    // at all, so a body armed through it today would fly its injection and
    // MISS. That distinction matters enough to spend a sentence on, because a
    // row that refuses for a reason that has already been fixed teaches a
    // player to distrust every other refusal on the screen.
    //
    // It is a REFUSAL and not an absence for GP-114's reason, and it refuses
    // rather than flying badly for the reason the numbers make obvious: the
    // injection's finite-burn residue is 468 km of error at the sphere of
    // influence against a 543 km aim offset, so the error is the same size as
    // the thing it perturbs, and an open-loop moon transfer put a planned
    // 250 km capture orbit 14 km underground.
    blocked: 'the moon flight itself works: physics flies injection, a '
      + 'mid-course correction, the hand-off between the two gravities and the '
      + 'capture, ending in a real orbit around Cinder. What is missing is the '
      + 'bridge into this game: the arm call builds a two-burn programme with '
      + 'no correction in it, and a moon transfer flown without one misses by '
      + 'more than the moon is wide. So this row refuses rather than flying '
      + 'you into the ground. Orbits around this body, and rendezvous with '
      + 'anything in it, can be flown today.',
  },
];

export function bodySource(): TargetSource {
  return {
    id: 'bodies',
    list(): AutopilotTarget[] {
      return BODIES.map((b) => ({
        id: `b:${b.name.toLowerCase()}`, kind: 'body' as const, name: b.name,
        detail: b.detail, orbit: null, blocked: b.blocked,
      }));
    },
  };
}

/**
 * THE REQUESTED-ORBIT SOURCE. Reid's fifth ask ("set an automatic take it to
 * this orbit") is not a second feature: it is a target whose orbit the player
 * authors instead of reading off a record. Making it a row means the reach
 * gate, the departure chart and the scheduler are one code path for both asks,
 * and the day a body becomes plannable it is the same path a third time.
 *
 * `trueAnomalyRad` is NaN on purpose. See TargetOrbit.
 */
export function requestedOrbit(home: HomeBody, altitudeM: number,
                               inclinationDeg: number): AutopilotTarget {
  const a = home.radiusM + altitudeM;
  const i = (inclinationDeg * Math.PI) / 180;
  return {
    id: 'orbit', kind: 'orbit', name: 'A circular orbit',
    detail: `${km(altitudeM)} circular, ${inclinationDeg.toFixed(1)} deg`,
    orbit: {
      semiMajorAxisM: a, eccentricity: 0, inclinationRad: i,
      lanRad: 0, argpRad: 0, trueAnomalyRad: NaN, epochS: 0,
      muM3S2: home.muM3S2,
    },
    blocked: altitudeM > 0 ? '' : 'an orbit has to be above the ground',
  };
}

/** Every source, in list order. Sources are asked in turn and never merged by
 *  kind, so the order on screen is the order here and is stable. */
export function collect(sources: readonly TargetSource[]): AutopilotTarget[] {
  const out: AutopilotTarget[] = [];
  for (const s of sources) out.push(...s.list());
  return out;
}

/** The row with this id, or null. Ids are compared whole; nothing parses the
 *  prefix back out, so a fourth kind needs no change here either. */
export function findTarget(rows: readonly AutopilotTarget[],
                           id: string): AutopilotTarget | null {
  return rows.find((r) => r.id === id) ?? null;
}
