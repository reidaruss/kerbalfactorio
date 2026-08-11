// CARRIER-LOCAL GEOMETRY (core-engine, CE-80 to CE-86, then CE-39 and CE-40).
// The CONSUMER half of the carrier frame, and the first thing in this game that
// boards one.
//
// ---------------------------------------------------------------------------
// CE-39 / CE-40 ADDED THE MISSING HALF: WHO IS ON IT.
//
// Everything below CE-86 answers "where is the deck" and "carry this rider".
// Nothing answered "is this rider ON the deck", so `CarrierRide` was constructed
// at boot and never handed a frame by any shipped path: `of.carrier('census')
// .ride` read `boards: 0` on a station a player was standing inside.
// `containsPoint` here is the membership predicate; the DECISION built on it
// lives in CarrierBoarding.ts, split off on the same seam CarrierFrame.ts and
// CarrierRide.ts were split on, and `decideAt` below is one line of delegation.
//
// Owned by core-engine and listed by file in core-engine.md section 2, per
// CE-21's rule that naming a subsystem is not the same as naming its files.
//
// ---------------------------------------------------------------------------
// WHAT WAS MISSING. `installStation` put 57 `col_*` proxies into
// `StructureBodies` at the record's pose ONCE, at tick 0, and `KinematicBody`
// resolves the walker against them in the body frame, so a station that started
// travelling would carry the player and leave the deck behind. Admin ruled R13
// on 2026-08-03: the geometry moves into the carrier's frame, NOT the world into
// the station's. This is that ruling, built.
//
// ---------------------------------------------------------------------------
// THE BINDING IS THE FIVE FIELDS THE QUERIES ALREADY READ, AND NOTHING ELSE.
//
// `StructureBodies.blocks / deckUnder / resolveStep / rayHit` and
// `GravityVolumes.weightOf` do not hold a copy of anything: every call reads
// `pos`, `quat` and `cx/cy/cz` off the stored object (StructureBody.ts:187,196,
// 269; GravityVolumes.ts:101,125). So writing those five fields IS the whole
// consumer, and a parallel "posed things" registry beside them would be D-014's
// second authority rebuilt by hand, three days after D-014 removed the first.
//
// That is also why this file mutates instead of rebuilding: a rebuilt `Solid`
// per tick would be 57 boxes of allocation at 60 Hz AND would break the identity
// removal the station's own teardown uses to find its solid.
//
// NOTHING IS CACHED, WHICH IS THE RULE AND NOT AN OPTIMISATION. `syncAt(tick)`
// asks the frame once and writes what it got, storing no pose between calls, so
// there is no stale one to read. Section 7b: "anything that caches a pose is
// D-014's defect rebuilt". `lastTick` and `applied` are census counters, never
// inputs.
//
// ---------------------------------------------------------------------------
// AND THE TRAP THIS FILE IS STANDING IN, SAID OUT LOUD.
//
// RETRACTED BY PH-357 AND KEPT FOR THE ARGUMENT. It used to say `mintStation`
// ships Anchorage with `stampedTick = -1`, so an `OrbitCarrier` over it is
// CONSTANT and the mount is the IDENTITY ELEMENT of its own operation, which
// made every probe that only mounted Anchorage prove nothing (GP-142). The
// record is stamped now and the station really travels. The rule the trap taught
// still stands and `probes/stationride.js` still asserts the rate before it
// asserts anything else.
//
// TWO CLOCKS, DELIBERATELY (CE-51). `syncAt` poses the COLLISION geometry at
// INTEGER ticks, because that is what the walker's step was resolved against.
// `syncWatchersAt` poses the DRAWN geometry at the FRACTIONAL tick being drawn,
// because that is where the interpolated camera is. Giving both the same clock
// IS the stutter: 27.04 m of peak-to-peak sawtooth per rendered frame, on a
// player standing perfectly still.
import type { CarrierFrame } from './CarrierFrame.js';
import type { Lifetime } from '../app/Lifetime.js';
import { composePose, copyPose, newPose, type FramePose } from './FramePose.js';
import {
  BoardingRule, type RideDecision, type RideSeat,
} from './CarrierBoarding.js';

/**
 * Anything whose BODY-FRAME pose is a rigid function of a carrier's pose.
 *
 * STRUCTURAL ON PURPOSE, the same decision `CarriedBody` made for the rider
 * (CE-33): `Solid` and `GravityVolume` both satisfy it already, this file
 * imports neither, and a player-built station or a moving platform satisfies it
 * without knowing this exists.
 *
 * `cx/cy/cz` is the bounding-sphere CENTRE both registries use for their O(1)
 * reject, written because a bound left at the boot pose would reject every query
 * the moment the thing moved further than its own radius: a deck that silently
 * stops existing rather than one in the wrong place.
 */
export interface PosedInFrame {
  pos: { x: number; y: number; z: number };
  quat: { set(x: number, y: number, z: number, w: number): unknown };
  cx: number; cy: number; cz: number;
  /** The bounding-sphere RADIUS both registries reject against. Read and never
   *  written: a rigid motion does not change a radius. CE-39 needs it because
   *  the membership predicate below is a distance against exactly this bound,
   *  and both existing implementors (`Solid`, `GravityVolume`) already carry it,
   *  so requiring it here narrows nothing that is attached today. */
  readonly cr: number;
}

/** A consumer with no writable pose fields of its own. `StationView.place` is
 *  the one that exists: the drawn hull's f64 pose is private and its setter is
 *  already the published way in, so it is called rather than reached into. */
export type PoseWatcher = (pose: FramePose) => void;

interface Attached {
  readonly body: PosedInFrame;
  /** The FIXED pose of this item inside the carrier, or null for coincident.
   *  Null rather than an identity pose so the common case costs no compose. */
  readonly local: FramePose | null;
  readonly what: string;
  /** CE-39. Whether this attachment's bound is part of what the carrier IS,
   *  for the membership test. See `attach` for why it is not simply true. */
  readonly bounds: boolean;
}

/**
 * One moving frame and everything rigidly attached to it.
 *
 * A mount is NOT a second frame: it holds a `CarrierFrame` and asks it, so the
 * deck, the person standing on it and the docking port are all answers from one
 * `poseAt` rather than three things kept in agreement.
 */
export class CarrierMount {
  private readonly here = newPose();
  private readonly there = newPose();
  private readonly items: Attached[] = [];
  private readonly watchers:
    { fn: PoseWatcher; what: string; local: FramePose | null }[] = [];
  /** Syncs performed. 0 after a boot that never ticked is the evidence that
   *  nothing runs behind the loop's back. */
  applied = 0;
  /** The tick of the last sync, NaN before the first. A report field only. */
  lastTick = Number.NaN;
  /** CE-51. Watcher-only syncs and the FRACTIONAL tick of the last. `drawn`
   *  outgrowing `applied` is the evidence the hull is posed per FRAME and the
   *  collider per TICK, which is the whole of the fix. */
  drawn = 0;
  lastDrawnTick = Number.NaN;
  /** CE-51. Body-frame position of the last watcher `syncWatchersAt` posed:
   *  where the DRAWN geometry is. NaN until a frame has drawn. */
  readonly drawnPos = { x: Number.NaN, y: Number.NaN, z: Number.NaN };

  constructor(readonly frame: CarrierFrame) {}

  /**
   * Attach something rigid. `local` is COPIED, not held: a caller that kept a
   * reference and mutated it would have made the attachment a second moving
   * frame with no `poseAt` and no census, the shape this design refuses.
   *
   * CE-39. `bounds` (default true) is whether this attachment's bounding sphere
   * is part of WHERE THE CARRIER IS, for `containsPoint`. True by default: the
   * ordinary attachment is a collision body and a collision body IS the extent.
   * It exists because Anchorage's freefall gravity volume is an attachment too,
   * at 207.85 m against the interior's 28.64 m, so a union over everything would
   * board a player seven times further out than the station reaches AND would do
   * it by reading the GRAVITY MODEL, which Admin ruled against. A field is not a
   * floor.
   */
  attach(body: PosedInFrame, what: string, local?: FramePose,
         opts?: { readonly bounds?: boolean }): this {
    this.items.push({ body, what, bounds: opts?.bounds ?? true,
      local: local === undefined ? null : copyPose(local, newPose()) });
    return this;
  }

  /** The same attachment for a consumer whose pose fields are private and whose
   *  setter is the published way in. Handed the SAME composed pose an attached
   *  body would get, so the two can never describe the station differently. */
  watch(fn: PoseWatcher, what: string, local?: FramePose): this {
    this.watchers.push({ fn, what,
      local: local === undefined ? null : copyPose(local, newPose()) });
    return this;
  }

  /**
   * Put everything where the frame is at `tick`. ONE `poseAt` call, whatever
   * is attached.
   *
   * The tick argument is the one `CarrierRide.tick` is given, and the agreement
   * between the two is the point rather than the particular number: the ride's
   * step 2 runs the walker "against geometry at pose A", where A is
   * `poseAt(tick)`, so a deck synced to any other tick is a deck the walker is
   * resolving against in the wrong place. See Loop.fixedTick for WHERE this is
   * called and why it is after the increment.
   */
  syncAt(tick: number): FramePose {
    const f = this.frame.poseAt(tick, this.here);
    for (const it of this.items) {
      const p = it.local === null ? f : composePose(f, it.local, this.there);
      it.body.pos.x = p.px; it.body.pos.y = p.py; it.body.pos.z = p.pz;
      it.body.quat.set(p.qx, p.qy, p.qz, p.qw);
      it.body.cx = p.px; it.body.cy = p.py; it.body.cz = p.pz;
    }
    for (const w of this.watchers) {
      w.fn(w.local === null ? f : composePose(f, w.local, this.there));
    }
    this.applied++;
    this.lastTick = tick;
    return f;
  }

  /**
   * CE-39. IS THIS BODY-FRAME POINT ON THIS CARRIER, with `marginM` of slack.
   *
   * The union of the bounding spheres of every attachment marked `bounds`, READ
   * WHERE THEY ARE RIGHT NOW (`syncAt` re-poses `cx/cy/cz` every tick).
   *
   * A SPHERE AND NOT THE BOXES, deliberately: `StructureBodies.blocks` answers
   * "is this point inside a wall" and is FALSE for the air a person standing on
   * a deck occupies, so it is the wrong question. Membership is "am I with this
   * thing", which is the O(1) reject the registries already hold. `marginM` is
   * the caller's, so board and release are ONE predicate at two radii rather
   * than two that could disagree. False with nothing bounding attached: an
   * instrument carrier is not a place.
   */
  containsPoint(x: number, y: number, z: number, marginM: number): boolean {
    for (const it of this.items) {
      if (!it.bounds) continue;
      const b = it.body;
      const dx = x - b.cx, dy = y - b.cy, dz = z - b.cz;
      const reach = b.cr + marginM;
      if (dx * dx + dy * dy + dz * dz <= reach * reach) return true;
    }
    return false;
  }

  /** Metres from this point to the nearest bounding attachment's SURFACE,
   *  negative inside it, or NaN with nothing bounding attached. A report field
   *  and the probe's continuous reading of the same predicate. */
  depthAt(x: number, y: number, z: number): number {
    let best = Number.NaN;
    for (const it of this.items) {
      if (!it.bounds) continue;
      const b = it.body;
      const d = Math.hypot(x - b.cx, y - b.cy, z - b.cz) - b.cr;
      if (Number.isNaN(best) || d < best) best = d;
    }
    return best;
  }

  /** True when `body` is one of this mount's attachments, by IDENTITY. The same
   *  identity test `StructureBodies.remove` uses to find the station's own
   *  solid, and the reason a caller can ask "what frame is this deck on" without
   *  a second registry of which mount owns what. */
  carries(body: PosedInFrame): boolean {
    return this.items.some((i) => i.body === body);
  }

  /**
   * CE-51. THE DRAWN half only, at a FRACTIONAL tick.
   *
   * `syncAt` above poses the COLLISION geometry once per fixed tick, which is
   * right and must not change: `KinematicBody` resolves the walker against those
   * boxes, and a collider that moved between ticks would be a floor that is in a
   * different place from the one the step was computed against.
   *
   * The DRAWN geometry has the opposite requirement, and this is the split.
   * `Loop` interpolates the camera between fixed ticks and drew the hull at the
   * last INTEGER tick, so at 1879.26 m/s the eye slid smoothly through a tick's
   * 31.32 m while the hull stood still and then jumped. MEASURED per rendered
   * frame before the fix: 27.04 m peak to peak, 13.52 m within one tick at two
   * frames per tick, correlation with alpha 0.9999999860. A pure clock
   * disagreement: at alpha = 1, where the clocks coincide, it was already right.
   *
   * `poseAt` TAKES A FRACTIONAL TICK BY CONTRACT (CarrierFrame.ts), so this
   * needs no new authority: the SAME function the collider, the rider and the
   * census ask, asked at the instant the frame is actually drawn.
   */
  syncWatchersAt(tick: number): FramePose {
    const f = this.frame.poseAt(tick, this.here);
    for (const w of this.watchers) {
      const p = w.local === null ? f : composePose(f, w.local, this.there);
      w.fn(p);
      // CE-51. THE POSE THE HULL WAS ACTUALLY DRAWN AT, published so an
      // instrument can ask about what the PLAYER SEES rather than about the
      // collider. They are on different clocks now, and the first frame trace
      // measured the collider and reported the fix as having changed nothing.
      this.drawnPos.x = p.px; this.drawnPos.y = p.py; this.drawnPos.z = p.pz;
    }
    this.drawn++;
    this.lastDrawnTick = tick;
    return f;
  }

  report(): {
    id: string; what: string; items: string[]; watchers: string[];
    applied: number; lastTick: number; drawn: number; lastDrawnTick: number;
    offsets: number; bounding: number;
  } {
    return {
      id: this.frame.id, what: this.frame.what,
      items: this.items.map((i) => i.what),
      watchers: this.watchers.map((w) => w.what),
      applied: this.applied, lastTick: this.lastTick,
      drawn: this.drawn, lastDrawnTick: this.lastDrawnTick,
      offsets: this.items.filter((i) => i.local !== null).length,
      bounding: this.items.filter((i) => i.bounds).length,
    };
  }
}

/**
 * Every mount the current body scope has. Driven once per fixed tick (the
 * colliders) and once per rendered frame (the watchers, CE-51).
 *
 * PROCESS-SCOPED OBJECT, BODY-SCOPED CONTENTS, exactly as `CarrierRegistry` is
 * and for the identical reason (CE-31): a mount holds body-frame geometry and a
 * frame expressed in this body, so one that survived a switch would be posing
 * Forge's station against Cinder. `bindTo` registers the clear AFTER the carrier
 * registry's, so reverse-of-registration teardown drops the MOUNTS FIRST and the
 * frames last: a mount holding a frame the registry has forgotten is the
 * dead-handle state clause 4 of the teardown contract makes impossible.
 */
export class CarrierMounts {
  private readonly list: CarrierMount[] = [];
  added = 0;
  removed = 0;
  /** CE-40. The membership decision and its counters. A FIELD rather than a
   *  constructor argument, because it holds no body-scoped state: it counts, and
   *  `clear()` deliberately does not reset it, exactly as `added`/`removed` are
   *  not reset. */
  readonly boarding = new BoardingRule();

  get size(): number { return this.list.length; }

  mount(frame: CarrierFrame): CarrierMount {
    const m = new CarrierMount(frame);
    this.list.push(m);
    this.added++;
    return m;
  }

  /**
   * CE-47. The tick this set was last driven at, NaN before the first.
   *
   * A REPORT FIELD; the loop is still the one authority. It exists because `Loop`
   * is constructed in `main.ts` AFTER `boot()` resolves, so the composition root
   * has no `tickIndex` to hand a rebuild hook, and a rebuild that re-poses the
   * station at the wrong tick puts the deck wherever the conic was then. `syncAt`
   * runs unconditionally every fixed tick even with an empty list, so this is
   * live whether or not anything is mounted, which is how a rebuild reads it.
   *
   * `clear()` deliberately does NOT reset it: it is a fact about the loop, not
   * about the contents, and the same reasoning keeps `added` and `removed`.
   */
  lastTick = Number.NaN;

  /** One tick for every mount. Called from `Loop.fixedTick` and nowhere else. */
  syncAt(tick: number): void {
    this.lastTick = tick;
    for (const m of this.list) m.syncAt(tick);
  }

  /** The mount whose attachments include `body`, or null. */
  mountCarrying(body: PosedInFrame | null): CarrierMount | null {
    if (body === null) return null;
    return this.list.find((m) => m.carries(body)) ?? null;
  }

  /** The mount driving `frame`, or null. */
  mountOf(frame: CarrierFrame | null): CarrierMount | null {
    if (frame === null) return null;
    return this.list.find((m) => m.frame === frame) ?? null;
  }

  /** CE-51. Every mount's DRAWN half, at the fractional tick being drawn. From
   *  `Loop.frame` and nowhere else; `syncAt` owns the collision half. */
  syncWatchersAt(tick: number): void {
    for (const m of this.list) m.syncWatchersAt(tick);
  }

  /** The first mount whose bounding attachments contain this point, or null. */
  mountContaining(x: number, y: number, z: number,
                  marginM: number): CarrierMount | null {
    return this.list.find((m) => m.containsPoint(x, y, z, marginM)) ?? null;
  }

  /** CE-40. THE PER-TICK BOARD / RELEASE DECISION, delegated whole to
   *  `CarrierBoarding.ts`. Called from `Loop.fixedTick` and nowhere else; the
   *  argument for that site is in `BoardingRule.decide` and beside the call. */
  decideAt(seat: RideSeat | null, x: number, y: number, z: number): RideDecision {
    return this.boarding.decide(this, seat, x, y, z);
  }

  clear(): void {
    this.removed += this.list.length;
    this.list.length = 0;
  }
  bindTo(lt: Lifetime): void {
    lt.add('mounts:clear', () => { this.clear(); });
  }

  census(): {
    size: number; added: number; removed: number; lastTick: number;
    boarding: ReturnType<BoardingRule['census']>;
    mounts: ReturnType<CarrierMount['report']>[];
  } {
    return { size: this.list.length, added: this.added, removed: this.removed,
      lastTick: this.lastTick,
      boarding: this.boarding.census(),
      mounts: this.list.map((m) => m.report()) };
  }
}
