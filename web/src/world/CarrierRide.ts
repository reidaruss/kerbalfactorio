// A BODY RIDING A CARRIER (core-engine, CE-33). The sandwich that makes the
// walker's absolute integration correct on a moving frame, without the walker
// learning that frames exist.
//
// Split from CarrierFrame.ts, which owns what a frame IS and which ones exist.
// This owns what it means to be ON one. The two questions have different
// consumers: a renderer or a docking test asks a frame where it is and never
// rides it, and the split keeps that path free of the walker entirely.
//
// See CarrierFrame.ts for why the term is needed and what it is worth per tick
// to each of the three features waiting on it.

import type { Lifetime } from '../app/Lifetime.js';
import type { CarrierFrame } from './CarrierFrame.js';
import {
  apply, applyInv, newPose, pointVelocity, transportDir, transportPoint,
  type V3,
} from './FramePose.js';

/**
 * What a ride can carry: a mutable body-frame position and velocity.
 *
 * STRUCTURAL, not an import. `KinematicBody` is physics's file by charter and
 * this domain owns the frame abstraction, so the seam between them is a shape
 * rather than a dependency: nothing here imports `player/`, and physics can
 * change the walker freely as long as `feet` and `vel` remain body-frame f64
 * metres, which is the contract its own header already states. A vessel, a
 * dropped item or a second player satisfies this interface without knowing this
 * file exists.
 */
export interface CarriedBody {
  readonly feet: V3;
  readonly vel: V3;
}

/** What one ride tick did, for the census and for a probe. */
export interface RideReport {
  readonly carrier: string | null;
  readonly boards: number;
  readonly releases: number;
  /** Ticks on which a transport was applied. 0 while nobody is riding. */
  readonly applied: number;
  /** The rider's position in the carrier's local frame, or null with no carrier. */
  readonly local: [number, number, number] | null;
  /** The carrier's own velocity at the rider, m/s, parent frame. */
  readonly carrierVel: [number, number, number] | null;
}

/**
 * A BODY RIDING A CARRIER, and the ordering that makes it correct.
 *
 * THE WHOLE FEATURE IS THIS SANDWICH:
 *
 *     v -= carrierVelocity(A -> B, at the rider)      into the carrier's frame
 *     step()                                          the walker's own tick
 *     p  = transport(A -> B, p)                       carried with the frame
 *     v  = transportDir(A -> B, v) + carrierVelocity(B -> C, at the new p)
 *
 * where A, B and C are the frame's pose at t, t+1 and t+2. The B -> C on the
 * last line is not a typo and it is measured; see `tick` below.
 *
 * which is "integrate in the carrier's frame and transform out", written so
 * that `step()` NEVER SEES A CARRIER. That is not a stylistic choice, it is the
 * ownership boundary: `KinematicBody.step` stays byte-for-byte physics's, its
 * signature is unchanged, and the frame term lives entirely on this side.
 *
 * AND IT IS ONE CALL, not a `before()` and an `after()` a caller must pair up.
 * A caller that could do half of it would eventually do half of it, and half of
 * it is a rider that gains the frame's velocity without losing it, i.e. a
 * player accelerating off a station at its full orbital speed every tick. `KinematicBody.step`
 * has the same shape of comment about water winning over freefall: "the
 * alternative is that the answer is decided by which branch happens to be
 * first, and that is the kind of thing this project has paid for."
 *
 * WITH NO CARRIER THIS IS `step()` AND NOTHING ELSE. Not "almost nothing": the
 * early return is the first line, so a world with no carrier in it runs the
 * exact instruction sequence it ran before this file existed, and `applied`
 * stays 0 as the evidence.
 */
export class CarrierRide {
  private frame: CarrierFrame | null = null;
  private readonly a = newPose();
  private readonly b = newPose();
  private readonly c = newPose();
  private readonly tmp: V3 = { x: 0, y: 0, z: 0 };
  private readonly tmp2: V3 = { x: 0, y: 0, z: 0 };
  boards = 0;
  releases = 0;
  applied = 0;
  /**
   * The last tick's carrier velocity at the rider. Published because it is the
   * quantity a release must hand over, and a probe that cannot see it cannot
   * tell "stepped off and kept the station's velocity" from "stepped off and
   * kept nothing", which are the two possible answers and only one is physics.
   */
  private readonly lastCarrierVel: V3 = { x: 0, y: 0, z: 0 };

  constructor(private readonly body: CarriedBody) {}

  get carrier(): CarrierFrame | null { return this.frame; }
  get riding(): boolean { return this.frame !== null; }

  /**
   * Release when the body scope ends.
   *
   * The ride's IDENTITY is process-scoped (it is the walker's, and the walker
   * survives a body switch) while what it is RIDING is body-scoped, so this is
   * CE-20's re-seat/rebuild rule arriving on an object that is neither: the
   * object is kept and one field is dropped. Registered by the composition root
   * against the same scope that clears the registry, and AFTER it in
   * registration order so that it runs BEFORE it in teardown order: the rider
   * lets go, and only then do the frames stop existing.
   *
   * `release` is silent and leaves position and velocity untouched, so this is
   * not a physics event: it is a rider on Anchorage discovering that the frame
   * Anchorage was expressed in no longer exists. What happens to the walker
   * afterwards is `WorldSession`'s residue problem (R7), not this file's.
   */
  bindTo(lt: Lifetime): void {
    lt.add('carrier:release', () => { this.release(); });
  }

  /**
   * Step ONTO a carrier. Changes nothing about where the rider is.
   *
   * Boarding is a change of DESCRIPTION, not of state: the same point, named in
   * a second frame. Position and velocity are untouched, deliberately and
   * measurably, because the alternative (snap the rider to a socket, zero the
   * relative velocity) is a teleport wearing a verb, and it would hide exactly
   * the discontinuity a seam like this has to be proven not to have.
   */
  board(f: CarrierFrame): void {
    this.frame = f;
    this.boards++;
  }

  /**
   * Step OFF. Also changes nothing.
   *
   * The rider keeps the absolute velocity it had, which INCLUDES the carrier's,
   * because that is what letting go of a moving thing does. Nothing is
   * subtracted here: the absolute velocity has been the authoritative number
   * the whole time and the carrier's contribution was only ever removed for the
   * duration of one `step` call. A `release` that had to un-add something would
   * mean the rider had been holding a relative velocity between ticks, which is
   * the second authority this design exists to avoid.
   */
  release(): CarrierFrame | null {
    const was = this.frame;
    if (was !== null) this.releases++;
    this.frame = null;
    this.lastCarrierVel.x = 0;
    this.lastCarrierVel.y = 0;
    this.lastCarrierVel.z = 0;
    return was;
  }

  /**
   * One fixed tick, with `step` run inside the carrier's frame.
   *
   * `tick` is the index the tick STARTS at and `dt` its length in seconds. The
   * transport spans exactly the interval `step` integrates over; the outgoing
   * velocity spans the NEXT one, for the reason spelled out inside.
   */
  tick(tick: number, dt: number, step: () => void): void {
    const f = this.frame;
    if (f === null) { step(); return; }

    const p = this.body.feet;
    const v = this.body.vel;
    // THREE POSES, NOT TWO, AND THE THIRD IS THE WHOLE OF "CARRIED".
    //
    // The velocity is removed over [t, t+1] and given back over [t+1, t+2],
    // because the rider comes out of the tick at pose B and what it needs is
    // the frame's velocity FROM there. Using the same interval on both sides
    // costs the rider the frame's own acceleration: measured on Cinder's frame
    // that is 1.2283 m of drift in ten seconds against a predicted 1/2 g T^2 of
    // 1.2260, i.e. a rider that stops being carried the instant the carrier
    // accelerates. A rotating frame hid it, because there the outgoing point
    // velocity happens to be the incoming one rotated, so the two intervals
    // agree and only a TRANSLATING accelerating frame can exhibit it.
    //
    // The invariant this buys, and it is the one the whole feature rests on:
    // a rider with zero relative velocity and zero apparent gravity stays at
    // exactly zero relative velocity, in ANY frame, translating or turning or
    // accelerating. That is what "standing on it" means.
    f.poseAt(tick, this.a);
    f.poseAt(tick + 1, this.b);
    f.poseAt(tick + 2, this.c);

    // 1. INTO THE CARRIER'S FRAME. The rider's velocity becomes relative.
    const vc = pointVelocity(this.a, this.b, dt, p.x, p.y, p.z, this.tmp);
    v.x -= vc.x; v.y -= vc.y; v.z -= vc.z;

    // 2. The walker's own tick, against geometry at pose A, in a frame that is
    //    instantaneously coincident with the body frame. Every oracle call,
    //    every solid box and every voxel it touches is the same one it would
    //    have touched with no carrier, which is why nothing downstream of
    //    `step` had to learn about frames.
    step();

    // 3. OUT. Carried rigidly with the frame, then given the frame's motion
    //    back at the place it ended up.
    transportPoint(this.a, this.b, p.x, p.y, p.z, this.tmp2);
    p.x = this.tmp2.x; p.y = this.tmp2.y; p.z = this.tmp2.z;
    transportDir(this.a, this.b, v.x, v.y, v.z, this.tmp2);
    const vc2 = pointVelocity(this.b, this.c, dt, p.x, p.y, p.z, this.tmp);
    v.x = this.tmp2.x + vc2.x;
    v.y = this.tmp2.y + vc2.y;
    v.z = this.tmp2.z + vc2.z;
    this.lastCarrierVel.x = vc2.x;
    this.lastCarrierVel.y = vc2.y;
    this.lastCarrierVel.z = vc2.z;
    this.applied++;
  }

  /** The rider's position in the carrier's local frame at `tick`, or null. */
  localAt(tick: number, out: V3): V3 | null {
    const f = this.frame;
    if (f === null) return null;
    f.poseAt(tick, this.a);
    const p = this.body.feet;
    return applyInv(this.a, p.x, p.y, p.z, out);
  }

  /** A local point back in the body frame at `tick`. The inverse of `localAt`. */
  parentAt(tick: number, x: number, y: number, z: number, out: V3): V3 | null {
    const f = this.frame;
    if (f === null) return null;
    f.poseAt(tick, this.a);
    return apply(this.a, x, y, z, out);
  }

  /**
   * AT REST IN THE CARRIER'S FRAME: the body-frame position and velocity of a
   * rider sitting still at a local point.
   *
   * This is a state the client CANNOT CURRENTLY EXPRESS, and that is the whole
   * reason it needs a name. `Controller.standAt` puts the feet at a body-frame
   * point and zeroes the velocity, which on a moving carrier means "at rest in
   * the BODY frame", i.e. being left behind at the carrier's full speed. The
   * two readings are the feature and the defect and they differ only in this
   * velocity, so anything measuring one has to be able to set up the other.
   *
   * The velocity is the same `pointVelocity` the tick uses, over the same
   * interval, so seating a rider and then ticking it produces zero local drift
   * by construction rather than by luck.
   *
   * WRITES NOTHING. The caller applies the result through whatever door owns
   * the body's position (for the walker that is `Controller.standAt`, which
   * also re-seats the render interpolation's `prevFeet`; writing `feet`
   * directly here would draw a 400 km streak on the frame it lands, which is
   * PH-31's lesson and cost a whole pass once).
   */
  restAt(tick: number, dt: number, x: number, y: number, z: number,
         outPos: V3, outVel: V3): boolean {
    const f = this.frame;
    if (f === null) return false;
    f.poseAt(tick, this.a);
    f.poseAt(tick + 1, this.b);
    apply(this.a, x, y, z, outPos);
    pointVelocity(this.a, this.b, dt, outPos.x, outPos.y, outPos.z, outVel);
    return true;
  }

  report(tick: number): RideReport {
    const l = this.localAt(tick, this.tmp);
    return {
      carrier: this.frame?.id ?? null,
      boards: this.boards, releases: this.releases, applied: this.applied,
      local: l === null ? null : [l.x, l.y, l.z],
      carrierVel: this.frame === null ? null
        : [this.lastCarrierVel.x, this.lastCarrierVel.y, this.lastCarrierVel.z],
    };
  }
}
