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
// WHAT WAS MISSING, IN ONE SENTENCE PER HALF.
//
// CE-30 to CE-38 built the frame term: `poseAt(tick)` answers where a moving
// thing is, and `CarrierRide` keeps a walker standing on it to 0.000000 m over
// 600 ticks. Nothing boarded it. `installStation` puts 57 `col_*` proxies into
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
// That is also why this file mutates instead of rebuilding. A rebuilt `Solid`
// per tick would be 57 boxes of allocation at 60 Hz AND would break identity
// removal (`bodies.remove((s) => s === installed)`), which is how the station's
// own teardown finds its solid.
//
// ---------------------------------------------------------------------------
// NOTHING IS CACHED, WHICH IS THE RULE AND NOT AN OPTIMISATION.
//
// `syncAt(tick)` asks the frame once and writes what it got. It stores no pose
// between calls, so there is no stale one to read, and a mount whose frame is
// stationary writes the same numbers forever at a cost of one `poseAt`. Section
// 7b's handback is explicit that "anything that caches a pose is D-014's defect
// rebuilt"; `lastTick` and `applied` are counters for the census, never inputs.
//
// ---------------------------------------------------------------------------
// AND THE TRAP THIS FILE IS STANDING IN, SAID OUT LOUD.
//
// `mintStation` ships Anchorage with `stampedTick = -1`, so `clockAt` returns
// the same clock for every tick and an `OrbitCarrier` over it is CONSTANT.
// Every line below therefore runs correctly and writes identical numbers on the
// station as it ships: the mount is the IDENTITY ELEMENT of its own operation
// and a probe that only mounts Anchorage proves nothing (GP-142, and CE-32 says
// the same thing about the ride). `probes/stationride.js` drives a moving frame
// and asserts the frozen one separately, and the negative control is run
// against the moving one for exactly this reason.
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
 * (CE-33): `Solid` (game/StructureBody.ts) and `GravityVolume`
 * (game/GravityVolumes.ts) both satisfy it already, this file imports neither,
 * and a player-built station, a docked ship's collision hull or a moving
 * platform satisfies it without knowing this exists.
 *
 * `cx/cy/cz` is the body-frame bounding-sphere CENTRE both registries use for
 * their O(1) reject. It is written because a bound that stayed at the boot pose
 * would reject every query the moment the thing moved further than its own
 * radius, which is a deck that silently stops existing rather than one that is
 * in the wrong place: `cr` is unchanged because a rigid motion does not change
 * a radius.
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
 * A mount is NOT a second frame. It holds a `CarrierFrame` and asks it; the
 * frame stays the one authority on where the thing is, which is what lets the
 * deck, the person standing on it and the docking port all be answers from one
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

  constructor(readonly frame: CarrierFrame) {}

  /**
   * Attach something rigid.
   *
   * `local` is COPIED, not held, because a caller that kept a reference and
   * mutated it would have made the attachment a second moving frame with no
   * `poseAt` and no census, which is the shape this whole design refuses.
   *
   * CE-39. `bounds` (default true) is whether this attachment's bounding sphere
   * is part of WHERE THE CARRIER IS, for `containsPoint`. True by default because
   * the ordinary attachment is a collision body and a collision body IS the
   * carrier's extent. It exists at all because Anchorage's freefall gravity
   * volume is an attachment too, at 207.85 m against the interior's 28.64 m: a
   * union over everything would board a player seven times further out than the
   * station reaches, and would do it BY READING THE GRAVITY MODEL, which Admin
   * ruled against. A field is not a floor.
   */
  attach(body: PosedInFrame, what: string, local?: FramePose,
         opts?: { readonly bounds?: boolean }): this {
    this.items.push({ body, what, bounds: opts?.bounds ?? true,
      local: local === undefined ? null : copyPose(local, newPose()) });
    return this;
  }

  /** The same attachment for a consumer whose pose fields are private and whose
   *  setter is the published way in. It is handed the SAME composed pose an
   *  attached body would have been written, so a watcher and an item can never
   *  end up describing the station differently. */
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
   * WHERE THEY ARE RIGHT NOW: `syncAt` re-poses `cx/cy/cz` every tick, so this
   * tests the deck's live position and never a remembered one.
   *
   * A SPHERE AND NOT THE BOXES, deliberately. `StructureBodies.blocks` already
   * answers "is this point inside a wall", and it answers FALSE for the air a
   * person standing on a deck occupies, so it is the wrong question. Membership
   * is "am I with this thing", which is the O(1) reject the registries already
   * hold. `marginM` is the caller's, so board and release are ONE predicate at
   * two radii rather than two predicates that could disagree.
   *
   * False with nothing bounding attached, which is the right answer for a frame
   * with no geometry on it: an instrument carrier is not a place.
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

  report(): {
    id: string; what: string; items: string[]; watchers: string[];
    applied: number; lastTick: number; offsets: number; bounding: number;
  } {
    return {
      id: this.frame.id, what: this.frame.what,
      items: this.items.map((i) => i.what),
      watchers: this.watchers.map((w) => w.what),
      applied: this.applied, lastTick: this.lastTick,
      offsets: this.items.filter((i) => i.local !== null).length,
      bounding: this.items.filter((i) => i.bounds).length,
    };
  }
}

/**
 * Every mount the current body scope has. Driven once per fixed tick.
 *
 * PROCESS-SCOPED OBJECT, BODY-SCOPED CONTENTS, exactly as `CarrierRegistry` is
 * and for the identical reason (CE-31): a mount holds body-frame geometry and
 * a frame expressed in this body, so one that survived a switch would be posing
 * Forge's station against Cinder. `bindTo` registers the clear with the body
 * `Lifetime`, and it is registered AFTER the carrier registry's, so that
 * reverse-of-registration teardown drops the MOUNTS FIRST and the frames last:
 * a mount holding a frame the registry has already forgotten is the dead-handle
 * state clause 4 of the teardown contract exists to make impossible. That is
 * the same argument, in the same order, that puts `ride.bindTo` after
 * `carriers.bindTo` in Boot.
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
   * A REPORT FIELD, and the loop is still the one authority: this is written by
   * `syncAt` and read by nobody who could act on a stale one. It exists because
   * `Loop` is constructed in `main.ts`, AFTER `boot()` resolves, so the
   * composition root has no `tickIndex` to hand a rebuild hook, and a rebuild
   * that re-poses the station at the wrong tick puts the deck wherever the conic
   * was at that other tick. `syncAt` runs unconditionally every fixed tick, even
   * with an empty list, so this is live whether or not anything is mounted,
   * which is exactly the state a rebuild reads it in.
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
