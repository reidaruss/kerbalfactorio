// THE CARRIER FRAME (core-engine, CE-31 to CE-34). A second, NON-EXCLUSIVE
// reference frame attached to a moving thing, and the one term that lets
// something standing on it not be left behind.
//
// ---------------------------------------------------------------------------
// WHY THIS EXISTS, in one measured number per consumer.
//
// `KinematicBody.step` integrates an ABSOLUTE body-frame position
// (KinematicBody.ts:258, `qx = p.x + (tx + ux * vUp) * dt`). Nothing in that
// expression knows what the floor under it is doing. Three features hit that
// same missing term from three directions and D-014 named it as accepted rather
// than solved:
//
//   the station   Anchorage on a 400 km conic. A real one passes a frozen one
//                 at 1879.26 m/s, i.e. 31.32 m per 1/60 s tick, MEASURED off
//                 the station's own record. (Physics R67 and SpaceStation.ts
//                 both say 7.5 km/s and 125 m per tick; that is Earth's low
//                 orbit, not Forge's. Forge's mu is 3.5316e12, so at the 1e6 m
//                 orbit radius sqrt(mu/r) is 1879.2 m/s. The conclusion is
//                 unchanged and the figure is 4.05x out; routed to Admin.)
//   the moon      `sim_world.h` now advances Cinder from `cinderStateAt` every
//                 step. Anything parented to that frame and integrated
//                 absolutely is left behind at 9.04 m per tick (physics R79),
//                 and 9.04 is Cinder's whole 542.5 m/s orbital speed over 60.
//   docking       an approach program needs the target port's pose PER TICK,
//                 and that pose is on a moving thing (physics R77).
//
// One term, three consumers. `standOnStation()` would have to be deleted when
// the moon arrived, and again when a player builds their own station.
//
// ---------------------------------------------------------------------------
// THE CONCEPT ALREADY EXISTED HERE FOR ACCELERATION, AND ONLY FOR ACCELERATION.
// Verified rather than assumed, because the whole design rests on it:
// `GravityPort.ts:21` states the model as `apparent g = g(where I am) - a(the
// frame I am riding in)`, and `GravityVolumes.ts:110` implements it. But
// `carrierG` is a SCALAR MAGNITUDE (`GravityVolumes.ts:60`, "radially inward"),
// subtracted from the magnitude of the true gravity. There is no frame VELOCITY
// and no frame POSITION anywhere in the client. So the sentence was already
// written down and only half of it was built, which is why this file is
// finishing a design rather than importing one.
//
// ---------------------------------------------------------------------------
// THE SHAPE: A FRAME IS A FUNCTION OF TIME, NOT A CACHED POSE.
//
// `poseAt(tick)` is asked for a pose at a tick and nothing is stored between
// calls. That is the same rule `VesselRegistry.stateOf` follows ("nothing is
// cached, so nobody can read a stale one, and nothing is advanced per tick, so
// an unattended fleet costs exactly zero until somebody asks"), and it is what
// makes a carrier free when nobody is riding it.
//
// NON-EXCLUSIVE, which is the word that does the design work. The body frame
// stays what it is; a carrier is an ADDITIONAL frame on a moving thing. Several
// can exist at once, a rider is on at most one, and a carrier with no rider
// still answers `poseAt` for a renderer or a docking test. Nothing here assumes
// the body frame is the only frame, which is the door CE-20/CE-21 deliberately
// left open.

import type { Lifetime } from '../app/Lifetime.js';
import { copyPose, newPose, type FramePose } from './FramePose.js';

/**
 * A moving reference frame in the current body's frame.
 *
 * `poseAt` takes a SIM TICK, fractional allowed, because that is the client's
 * one clock: `Loop.tickIndex` counts it and `VesselRegistry.clockAt(rec, tick)`
 * is the only thing that maps it to mission seconds. Taking seconds here would
 * mean every implementation converted, and two conversions is two clocks.
 *
 * MUST be a pure function of the tick. A carrier that remembers where it was
 * cannot be asked about `tick + 1` before `tick` has happened, and the ride
 * below does exactly that, every tick.
 */
export interface CarrierFrame {
  /** Stable, unique within a registry. Appears in the census and in reports. */
  readonly id: string;
  /** Human label for a report line. Never parsed. */
  readonly what: string;
  /** Writes the local -> parent pose at `tick` into `out` and returns it. */
  poseAt(tick: number, out: FramePose): FramePose;
}

/**
 * A carrier that does not move. The IDENTITY ELEMENT, and it is here to be an
 * instrument rather than a feature.
 *
 * GP-142's rule is that a fixture whose value is the identity of the operation
 * reads exactly like a pass, so a probe must never pick one by accident. The
 * inverse is also true and is what this is for: to claim the ride is a no-op
 * when the carrier is not moving, something has to BE a carrier that is not
 * moving. Boarding this and measuring zero drift is a positive control on the
 * transport; boarding a moving one and measuring zero LOCAL drift is the
 * feature. A probe that only ever boards this one proves nothing, and the probe
 * asserts the distinction out loud.
 */
export class FixedCarrier implements CarrierFrame {
  private readonly pose = newPose();
  constructor(readonly id: string, readonly what = 'fixed') {}
  /** Seat it somewhere other than the origin, so it is not doubly degenerate. */
  seat(p: FramePose): this { copyPose(p, this.pose); return this; }
  poseAt(_tick: number, out: FramePose): FramePose { return copyPose(this.pose, out); }
}

/**
 * Constant velocity in a straight line, seeded from a real speed.
 *
 * The other instrument. It exists because a translating carrier and a rotating
 * one fail differently: the transport of a pure translation is exact in f64
 * (one subtraction, one addition, no quaternion), and a rotation is not, so a
 * drift bound measured only on one of them says nothing about the other. Both
 * are driven, and the probe reports which is which.
 */
export class LinearCarrier implements CarrierFrame {
  constructor(readonly id: string,
              private readonly ox: number, private readonly oy: number,
              private readonly oz: number,
              private readonly vx: number, private readonly vy: number,
              private readonly vz: number,
              private readonly dtPerTick: number,
              /** The tick at which the frame is AT its origin. */
              private readonly tick0 = 0,
              readonly what = 'linear') {}

  poseAt(tick: number, out: FramePose): FramePose {
    const t = (tick - this.tick0) * this.dtPerTick;
    out.px = this.ox + this.vx * t;
    out.py = this.oy + this.vy * t;
    out.pz = this.oz + this.vz * t;
    out.qx = 0; out.qy = 0; out.qz = 0; out.qw = 1;
    return out;
  }
}

/**
 * The carriers that currently exist, and the census that proves they stop
 * existing.
 *
 * BODY-SCOPED BY REGISTRATION (CE-20's rule). A carrier is expressed in the
 * current body's frame, so a carrier that survived a body switch would be a
 * `UniverseCoord` without its `FFrameId`, which is exactly the nonsense CE-21
 * refused for the floating origin: Anchorage's 1,000,000 m orbit about Forge is
 * five body-radii outside Cinder. `bindTo` registers the clear with the body
 * `Lifetime`, so the reverse-of-registration teardown empties it for free and
 * `census()` is the evidence.
 */
export class CarrierRegistry {
  private readonly byId = new Map<string, CarrierFrame>();
  /** Registrations since construction. Only ever grows; the census is the pair. */
  added = 0;
  removed = 0;

  get size(): number { return this.byId.size; }

  /**
   * THROWS on a duplicate id. A registry that silently replaces is a registry
   * in which a rider can be holding a frame nobody can reach any more, and the
   * symptom is a rider that stops moving with no error, hours later.
   */
  add(f: CarrierFrame): CarrierFrame {
    if (this.byId.has(f.id)) {
      throw new Error(`CarrierRegistry: '${f.id}' is already registered as `
        + `'${this.byId.get(f.id)?.what}'. Ids are unique; remove it first.`);
    }
    this.byId.set(f.id, f);
    this.added++;
    return f;
  }

  remove(id: string): boolean {
    if (!this.byId.delete(id)) return false;
    this.removed++;
    return true;
  }

  get(id: string): CarrierFrame | null { return this.byId.get(id) ?? null; }

  /** Every carrier drops. Registered with the body `Lifetime` by `bindTo`. */
  clear(): void {
    this.removed += this.byId.size;
    this.byId.clear();
  }

  /**
   * Register the clear with a body scope.
   *
   * Named as a verb the composition root calls rather than done in the
   * constructor, because the registry itself is PROCESS-scoped (it is on
   * `Services` and its identity outlives a body) while its CONTENTS are
   * body-scoped. That is CE-20's re-seat/rebuild rule arriving a third time,
   * and the split is why this is not simply `lt.own(...)`.
   */
  bindTo(lt: Lifetime): void {
    lt.add('carriers:clear', () => { this.clear(); });
  }

  census(): { size: number; added: number; removed: number; ids: string[] } {
    return {
      size: this.byId.size, added: this.added, removed: this.removed,
      ids: [...this.byId.keys()].sort(),
    };
  }
}
