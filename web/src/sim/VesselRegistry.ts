// PH-64. THE ONE ANSWER TO "WHERE IS THIS VESSEL".
//
// Before this file there were two answers and neither of them was written down.
// A rocket you rolled out existed as a live `/core` flight handle inside the one
// `FlightSession` the client owns, and it existed nowhere else at all: not in the
// save slot, not in a list, not under an id. Close the tab and it was gone, with
// no message (R12, PH-30). Roll out a second one and `FlightSession.rollOut`
// destroyed the first as its opening statement.
//
// The registry is the authority. A vessel IS a record here, with a stable id.
// The live flight handle is a CACHE of the PROMOTED record and is explicitly not
// a second copy: `syncPromoted` writes it back before anything reads the record,
// and the save path calls that first. This is DW-26's rule applied to an object
// rather than to a query: when one thing must be true in two places, name which
// place is true and make the other one derive.
//
// PH-65. A RECORD IS IN EXACTLY ONE OF THREE MODES, and the mode says which
// question "where is it" answers:
//
//   PARKED  the vessel is standing on the ground or clamped to a pad. Its place
//           is a position, it does not change, and that is not an approximation:
//           a rocket on a pad really does stay on the pad.
//   RAILS   the vessel is on a conic and NOTHING is simulating it. Its place is
//           NINE NUMBERS AND A CLOCK, and the position is DERIVED on demand.
//           There is no stored position, deliberately, because a stored one
//           would be the second authority this file exists to remove.
//   FROZEN  the vessel is in flight and is NOT on-rails eligible: in the air, or
//           under thrust. Its place is the state vector it had at the instant
//           the world stopped looking, held exactly.
//
// FROZEN is the honest one and it is worth stating why it is not a cheat. A
// vessel in the atmosphere is under drag, and a vessel with an engine lit is
// under thrust; neither is a conic, so neither can be advanced by arithmetic
// (PH-16 fixes `onRailsEligible` as exactly this boundary). The two available
// answers are "keep integrating it", which is the cost that leaving it was meant
// to avoid, and "hold it", which is what a closed tab does anyway. Holding it is
// therefore the truthful reading of a browser reload, and the seam publishes
// `mayLeave` so a future control handoff can REFUSE to abandon a vessel in that
// state rather than silently hovering it (see §5).
import { scratchF64 } from './wasm/heap.js';
import type { OfCoreModule } from './wasm/heap.js';
import { ORBIT_ELEMENT_WORDS, vesselAbi } from './wasm/vesselabi.js';
import type { OfVesselModule } from './wasm/vesselabi.js';
import type { DesignJson } from '../game/VesselDesign.js';

export type VesselMode = 'parked' | 'rails' | 'frozen';

export type Vec3n = [number, number, number];

/** The conic, verbatim from `of_orb_park`. Nine numbers, no opinions. */
export interface RailElements {
  a: number; e: number; i: number; lan: number; argp: number;
  nu: number; m0: number; epoch: number; mu: number;
}

/**
 * WHERE the vessel is, as ONE field that says which kind of answer it is.
 *
 * A record with `el` has no position and a record with `pos` has no elements.
 * Carrying both would be exactly the ambiguity this file removes, and it is the
 * ambiguity that cost this project days twice (DW-26).
 */
export type VesselWhere =
  | { kind: 'conic'; el: RailElements }
  | { kind: 'fixed'; pos: Vec3n; vel: Vec3n };

/**
 * The attitude and control state a promoted vessel comes back with. Split out
 * from `where` because it is true of all three modes and because a conic has
 * nothing to say about which way the nose points.
 */
export interface VesselPose {
  fwd: Vec3n; right: Vec3n; angVel: Vec3n;
  throttle: number; sasMode: number; command: Vec3n;
}

export interface VesselRecord {
  /** Stable for the life of the world, 1-based, NEVER reused. See `nextId`. */
  id: number;
  name: string;
  /**
   * GP-650. WHICH BODY THIS VESSEL IS AT, as /core's own `BodyParams::bodyId`.
   *
   * This field is the other half of a decision persistence had already made and
   * this file had not answered for. `SaveWorlds.ts` classifies `vessels` as a
   * GLOBAL save key on purpose ("the pack, the research, the milestones, the
   * vessels and the time of day are ONE world's, not one body's"), so every
   * record here crosses to the moon with the player. A record that crosses
   * bodies and does not say which body it is at leaves every consumer to assume
   * the observer's, and all of them did: the map drew Anchorage's 1000 km Forge
   * conic around a 200 km moon and the panel reported its altitude as 800 km,
   * because 1,000,000 - 200,000 is 800,000 and nothing had asked.
   *
   * A NUMBER RATHER THAN `world/PlanetBody`'s `BodyId` UNION, so this file keeps
   * its one dependency direction (it reads /core and nothing else) and so a
   * third body authored in `cubed_sphere.h` needs no edit here. It is /core's
   * key either way; `world/VesselBody.ts` is what turns it into a radius, a mu
   * and a name, and it is the only place that does.
   */
  bodyId: number;
  mode: VesselMode;
  /** The design AS ROLLED OUT, in `VesselDesign`'s own format. Snapshotted at
   *  roll-out because the bay's handle keeps being edited afterwards (PH-27). */
  design: DesignJson;
  /** `nextStageIndex`: how many stage presses have happened. Restored by
   *  REPLAYING them, which is why no `nextStageIndex` setter was needed. */
  fired: number;
  /** [design part index, kg] for every part still attached that holds any. */
  fuel: [number, number][];
  /** The `/core` part handle for each design part, in `design.parts` order.
   *  Carried rather than assumed: handles are allocated by `Vessel::attach` and
   *  are NOT guaranteed to be 1..n, because a design the player edited has had
   *  parts removed. Guessing the mapping would mis-key the fuel onto the wrong
   *  tanks, silently, and a rocket with the right total in the wrong places
   *  flies differently and reads perfectly healthy. Rewritten on every promote
   *  from the rebuilt design, so it is always the live truth. */
  handles: number[];
  where: VesselWhere;
  pose: VesselPose;
  /** The vessel's OWN mission clock, in seconds, and the epoch every conic in
   *  `where` is measured against. It is not the world's clock and it is not
   *  `FlightState.timeS`, which restarts at zero for every new `FlightSim`. */
  clockS: number;
  /** The world tick at which `clockS` was last stamped, or -1 when the record
   *  is not being carried by a live session (a freshly loaded save). */
  stampedTick: number;
  /** The flight status word the HUD reads, carried so a promoted vessel does
   *  not have to re-derive CLAMPED / ASCENT / COAST / ORBIT / DOWN from scratch. */
  status: string;
  metS: number;
  liftedOff: boolean;
  releases: number;
  stagings: number;
  maxQPa: number;
  /** Pad anchorage, so a PARKED vessel comes back on its pad and not merely at
   *  the right radius. `padUp` is the surface normal it was stood up along. */
  onPad: boolean;
  padRadiusM: number;
  padUp: Vec3n;
}

/** How long one fixed tick is. Must match `Loop.FIXED_DT`; it is passed in
 *  rather than imported so this file has no dependency on the loop. */
export const RAILS_DT = 1 / 60;

function v3(a: readonly number[]): Vec3n {
  return [a[0] ?? 0, a[1] ?? 0, a[2] ?? 0];
}

/**
 * THE REGISTRY. Module-level, exactly like `SaveInhibit`, and for the same
 * reason: the save path and the flight path both need it and neither owns the
 * other, so making it a field on one of them would decide that question wrongly.
 */
export class VesselRegistry {
  private records: VesselRecord[] = [];
  /** Monotonic. Ids are NEVER reused, unlike `/core` handles, which are reused
   *  the moment a slot frees (of_core_api.cpp's `Registry::add` scans for the
   *  first hole). A reused id would silently alias one vessel onto another the
   *  first time a save named one, which is the handle trap of PH-27 with a save
   *  file attached to it. */
  private nextId = 1;
  /** The id of the record the live `FlightSession` is carrying, or 0. */
  promotedId = 0;
  demotions = 0;
  promotions = 0;

  list(): readonly VesselRecord[] { return this.records; }
  get count(): number { return this.records.length; }
  find(id: number): VesselRecord | null {
    return this.records.find((r) => r.id === id) ?? null;
  }
  get promoted(): VesselRecord | null {
    return this.promotedId > 0 ? this.find(this.promotedId) : null;
  }

  /** Take a record and its id. Used by roll-out and by the save restore, which
   *  is why the id is supplied rather than allocated: a restored world must get
   *  its own ids back or every saved reference to one would break. */
  adopt(rec: VesselRecord): VesselRecord {
    this.records = this.records.filter((r) => r.id !== rec.id);
    this.records.push(rec);
    if (rec.id >= this.nextId) this.nextId = rec.id + 1;
    return rec;
  }

  allocateId(): number { return this.nextId++; }

  remove(id: number): boolean {
    const before = this.records.length;
    this.records = this.records.filter((r) => r.id !== id);
    if (this.promotedId === id) this.promotedId = 0;
    return this.records.length !== before;
  }

  clear(): void {
    this.records = [];
    this.promotedId = 0;
    this.nextId = 1;
  }

  // --- the clock -----------------------------------------------------------

  /**
   * The vessel's own mission time at world tick `tick`.
   *
   * A record that is not stamped (a save just loaded) reads its stored clock
   * unchanged, which is the correct answer: the world was not running, so the
   * vessel did not move. That is the whole reason the clock is the vessel's and
   * not the loop's, whose `tickIndex` restarts at zero on every page load.
   */
  clockAt(rec: VesselRecord, tick: number): number {
    if (rec.stampedTick < 0 || tick < rec.stampedTick) return rec.clockS;
    return rec.clockS + (tick - rec.stampedTick) * RAILS_DT;
  }

  /** Fold elapsed time into the stored clock and re-stamp. Called before a save
   *  and before a promote, so the two never disagree about how far it has come. */
  stamp(rec: VesselRecord, tick: number): void {
    rec.clockS = this.clockAt(rec, tick);
    rec.stampedTick = tick;
  }
}

/**
 * WHERE IT IS, RIGHT NOW, as a position and a velocity.
 *
 * For a conic this is the ONLY place a position exists, and it costs one Kepler
 * solve. Nothing is cached, so nobody can read a stale one, and nothing is
 * advanced per tick, so an unattended fleet costs exactly zero until somebody
 * asks. That is not an optimisation, it is what "on rails" means (PH-3).
 */
export function stateOf(M: OfCoreModule, reg: VesselRegistry,
                        rec: VesselRecord, tick: number)
    : { pos: Vec3n; vel: Vec3n } {
  if (rec.where.kind === 'fixed') {
    return { pos: rec.where.pos, vel: rec.where.vel };
  }
  const el = rec.where.el;
  const V = vesselAbi(M);
  const n = V._of_orb_resume(el.a, el.e, el.i, el.lan, el.argp, el.nu, el.m0,
                             el.epoch, el.mu, reg.clockAt(rec, tick));
  if (n !== 6) return { pos: [0, 0, 0], vel: [0, 0, 0] };
  const w = scratchF64(M, 6);
  return { pos: [w[0] ?? 0, w[1] ?? 0, w[2] ?? 0],
           vel: [w[3] ?? 0, w[4] ?? 0, w[5] ?? 0] };
}

/** Fit a conic to a state vector at a given mission time. The client never
 *  computes elements itself: `of_orb_park` is `orbital::park`, which is the one
 *  authority, and a second Kepler fit in TypeScript would be a second physics. */
export function fitConic(M: OfCoreModule, pos: Vec3n, vel: Vec3n,
                         mu: number, clockS: number): RailElements | null {
  const V: OfVesselModule = vesselAbi(M);
  const n = V._of_orb_park(pos[0], pos[1], pos[2], vel[0], vel[1], vel[2],
                           mu, clockS);
  if (n !== ORBIT_ELEMENT_WORDS) return null;
  const w = scratchF64(M, ORBIT_ELEMENT_WORDS);
  const el: RailElements = {
    a: w[0] ?? 0, e: w[1] ?? 0, i: w[2] ?? 0, lan: w[3] ?? 0, argp: w[4] ?? 0,
    nu: w[5] ?? 0, m0: w[6] ?? 0, epoch: w[7] ?? 0, mu: w[8] ?? 0,
  };
  // A conic that is not a number is not a conic. Refusing here is what keeps a
  // degenerate state (a vessel at the body centre, a NaN out of a bad restore)
  // from becoming a record nothing can ever evaluate again.
  for (const k of Object.values(el)) if (!Number.isFinite(k)) return null;
  return el;
}

export const registry = new VesselRegistry();

export function poseFrom(fwd: readonly number[], right: readonly number[],
                         angVel: readonly number[], throttle: number,
                         sasMode: number, command: readonly number[]): VesselPose {
  return { fwd: v3(fwd), right: v3(right), angVel: v3(angVel),
           throttle, sasMode, command: v3(command) };
}

export { v3 };
