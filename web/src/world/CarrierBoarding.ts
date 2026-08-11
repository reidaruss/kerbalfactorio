// WHO IS ON THE CARRIER (core-engine, CE-39 and CE-40).
//
// Split from CarrierGeometry.ts on the SAME seam CarrierFrame.ts and
// CarrierRide.ts were split on: that pair separates "what a frame is" from "what
// it means to be ON one", and this pair separates "where the deck is" from "who
// is standing on it". The two questions have different consumers. A renderer, a
// docking test and the mount loop all ask where the deck is and never ask this;
// only the loop's one decision line asks this.
//
// ---------------------------------------------------------------------------
// WHAT WAS MISSING, AND IT WAS THE WHOLE FEATURE.
//
// CE-30 to CE-38 built the frame, CE-80 to CE-86 put the station's geometry on
// it, and `CarrierRide` carries a rider to 1.7e-9 m over 600 ticks. NOBODY WAS
// EVER PUT ON IT. `CarrierRide` is constructed at boot and no shipped path ever
// called `board`, so `of.carrier('census').ride` read `boards: 0` on a world
// with a player standing inside Anchorage, and the arrival left them at rest in
// the BODY frame, which on a moving station is 31.32 m of being left behind per
// tick. This file is the missing predicate and the missing decision.
//
// ---------------------------------------------------------------------------
// IT IS A DISTANCE AND NOT A COLLISION TEST, AND THAT IS THE DESIGN.
//
// `StructureBodies.blocks` answers "is this point inside a wall". It is FALSE
// for the air a person standing on a deck occupies, so it cannot answer "am I on
// the station". The question membership asks is "am I with this thing", which is
// exactly the O(1) bounding-sphere reject both registries already hold, so the
// predicate reads the bound the geometry already publishes and invents nothing.
//
// TWO REJECTED ALTERNATIVES, both ruled out by Admin before this was written:
// the GRAVITY VOLUME (it would couple who is aboard to the gravity model, so
// resizing a field for a rendering or balance reason would silently change who
// gets carried), and a HAND-AUTHORED RADIUS (a second authority on how big the
// station is, next to the bound derived from its own 57 boxes).

import type { CarrierFrame } from './CarrierFrame.js';
import type { CarrierMount } from './CarrierGeometry.js';

/**
 * CE-39. HOW FAR OUTSIDE THE CARRIER'S OWN BOUND STILL COUNTS AS ON IT.
 *
 * The bound is a SPHERE around a set of boxes and already over-covers a
 * non-spherical interior in most directions, so this is slack on top of slack:
 * one metre for a walker whose feet are a hair proud of the deck edge. Small on
 * purpose, because it is added to a radius that is measured rather than guessed.
 */
export const BOARD_MARGIN_M = 1.0;

/**
 * CE-39. AND HOW MUCH FURTHER AGAIN BEFORE THE RIDER IS LET GO. MANDATORY.
 *
 * One radius would make boarding a comparison against a threshold the rider is
 * standing exactly on, and R36 measured what that costs elsewhere in this
 * client: 8 mode flips in 152 ticks. Here one un-boarded tick is 31.32 m of
 * Anchorage's orbital speed applied to a person standing still, so a flip is not
 * cosmetic, it is a player thrown off their own station. 4 m is tens of ticks to
 * cross at walking pace in either direction, and small enough next to that 31.32
 * m per tick that it cannot hide a real departure for long.
 */
export const RELEASE_HYSTERESIS_M = 4.0;

/**
 * CE-40. A rider seat, STRUCTURALLY: `CarrierRide` satisfies it and is not
 * imported, the same decision `CarriedBody` and `PosedInFrame` already made. The
 * membership decision is geometry's and the sandwich is the ride's, and keeping
 * the seam a shape lets a second rider be decided by this code without this file
 * learning that it exists.
 */
export interface RideSeat {
  readonly carrier: CarrierFrame | null;
  board(f: CarrierFrame): void;
  release(): CarrierFrame | null;
}

/** Just enough of `CarrierMounts` to decide. Structural for the same reason. */
export interface MountSet {
  mountOf(frame: CarrierFrame | null): CarrierMount | null;
  mountContaining(x: number, y: number, z: number,
                  marginM: number): CarrierMount | null;
}

/** What one per-tick membership decision did. Null is by far the common case. */
export type RideDecision = 'board' | 'release' | null;

/**
 * THE PER-TICK BOARD / RELEASE DECISION, and its own counters.
 *
 * A CLASS rather than a free function because the counters are the evidence:
 * `tested` growing while `boarded` does not is a decision that is running and
 * declining, which is a completely different state from one that is not running
 * at all, and a probe cannot tell them apart without both numbers. It is held by
 * `CarrierMounts` as a field, so nothing in the composition root changes.
 */
export class BoardingRule {
  tested = 0;
  boarded = 0;
  released = 0;

  /**
   * CALLED FROM EXACTLY ONE PLACE: `Loop.fixedTick`, IMMEDIATELY AFTER
   * `mounts.syncAt`. That is the only instant in the tick at which the deck and
   * the rider are described at the same tick index; the ordering argument is in
   * Loop beside the call. Anywhere else measures the rider at `poseAt(t+1)`
   * against geometry at `poseAt(t)`, a deck 31.32 m from where the test thinks
   * it is, which reads healthy on every frozen fixture and is wrong the day the
   * station moves.
   *
   * TWO RADII, ONE PREDICATE. Board at `cr + BOARD_MARGIN_M`, release only past
   * `+ RELEASE_HYSTERESIS_M`. Between them nothing happens, which is the point.
   *
   * A CARRIER WITH NO MOUNT GETS NO OPINION, and that is load-bearing rather
   * than defensive. `__of.carrier('board')` puts instrument frames (`fixed`,
   * `linear`, `rotor`) under the rider deliberately and none of them carries any
   * geometry, so a release rule that fired on "not inside anything" would
   * un-board every measurement in `probes/carrier.js` one tick after it started,
   * and `probes/stationride.js`'s `unmount` control IS the state "still riding,
   * deliberately, with the mount gone".
   *
   * The corner that follows, said out loud: after `remount` a rider still
   * holding the OLD frame keeps holding it, because that frame now carries
   * nothing and this refuses to speak. It ends when they leave and re-enter. A
   * rider-follows-the-geometry rule is a second policy about the same seam, and
   * it is deferred rather than missed.
   */
  decide(mounts: MountSet, seat: RideSeat | null,
         x: number, y: number, z: number): RideDecision {
    if (seat === null) return null;
    this.tested++;
    const held = seat.carrier;
    if (held === null) {
      const m = mounts.mountContaining(x, y, z, BOARD_MARGIN_M);
      if (m === null) return null;
      seat.board(m.frame);
      this.boarded++;
      return 'board';
    }
    const on = mounts.mountOf(held);
    if (on === null) return null;
    if (on.containsPoint(x, y, z, BOARD_MARGIN_M + RELEASE_HYSTERESIS_M)) return null;
    seat.release();
    this.released++;
    return 'release';
  }

  census(): {
    tested: number; boarded: number; released: number;
    boardMarginM: number; releaseMarginM: number;
  } {
    return {
      tested: this.tested, boarded: this.boarded, released: this.released,
      boardMarginM: BOARD_MARGIN_M,
      releaseMarginM: BOARD_MARGIN_M + RELEASE_HYSTERESIS_M,
    };
  }
}
