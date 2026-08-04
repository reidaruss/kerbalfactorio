// CARRIER-LOCAL GEOMETRY (core-engine, CE-80 to CE-86). The CONSUMER half of
// the carrier frame, and the first thing in this game that boards one.
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
   */
  attach(body: PosedInFrame, what: string, local?: FramePose): this {
    this.items.push({ body, what,
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

  report(): {
    id: string; what: string; items: string[]; watchers: string[];
    applied: number; lastTick: number; offsets: number;
  } {
    return {
      id: this.frame.id, what: this.frame.what,
      items: this.items.map((i) => i.what),
      watchers: this.watchers.map((w) => w.what),
      applied: this.applied, lastTick: this.lastTick,
      offsets: this.items.filter((i) => i.local !== null).length,
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

  get size(): number { return this.list.length; }

  mount(frame: CarrierFrame): CarrierMount {
    const m = new CarrierMount(frame);
    this.list.push(m);
    this.added++;
    return m;
  }

  /** One tick for every mount. Called from `Loop.fixedTick` and nowhere else. */
  syncAt(tick: number): void {
    for (const m of this.list) m.syncAt(tick);
  }

  clear(): void {
    this.removed += this.list.length;
    this.list.length = 0;
  }

  bindTo(lt: Lifetime): void {
    lt.add('mounts:clear', () => { this.clear(); });
  }

  census(): {
    size: number; added: number; removed: number;
    mounts: ReturnType<CarrierMount['report']>[];
  } {
    return { size: this.list.length, added: this.added, removed: this.removed,
      mounts: this.list.map((m) => m.report()) };
  }
}
