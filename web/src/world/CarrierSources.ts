// TWO REAL CARRIERS (core-engine, CE-35, CE-36). Both DERIVE from an authority
// that already exists; neither invents a position, a velocity or a period.
//
// This file is the answer to "is the abstraction general, or is it one special
// case with an interface on top". The two sources have nothing in common:
//
//   `OrbitCarrier`      a vessel record on a conic, solved through /core's
//                       `of_orb_resume` by `VesselRegistry.stateOf`. It has an
//                       orientation (an LVLH deck) and it ROTATES about the
//                       body centre as it goes round.
//   `EphemerisCarrier`  a celestial body's state through `of_body_state`. It has
//                       no orientation at all, and it is a pure TRANSLATION of
//                       the body frame (`CelestialEphemeris.relativeTo` states
//                       that property and names this file's job if it ever
//                       stops being true).
//
// One rotates and has a basis; the other translates and does not. If the ride
// only worked for one of them, the abstraction would be a special case, and the
// probe measures both for exactly that reason.
//
// WHY THE ABSOLUTE BASIS CONVENTION DOES NOT MATTER, restated here because it
// is the reason `OrbitCarrier` is allowed to pick LVLH without consulting the
// station's own `stationAxes`: the ride applies `B . A^-1`, and composing a
// constant local re-basis `C` into both gives `(B C)(A C)^-1 = B C C^-1 A^-1 =
// B A^-1`, unchanged. A consumer that needs the station's AUTHORED orientation
// (a docking port pose) composes its own constant offset onto `poseAt`, and
// that offset is that consumer's, not this one's. See FramePose.ts.

import * as THREE from 'three';
import {
  copyPose, newPose, rotatePoseAboutOrigin, setPoseFromBasis, type FramePose,
} from './FramePose.js';
import type { CarrierFrame } from './CarrierFrame.js';
import type { OfCoreModule } from '../sim/wasm/heap.js';
import {
  registry as vesselRegistry, stateOf as vesselStateAt, type VesselRecord,
} from '../sim/VesselRegistry.js';
import {
  hasEphemeris, stateOf as bodyStateAt, type EphemerisModule,
} from '../render/CelestialEphemeris.js';

/**
 * Local Vertical / Local Horizontal, from a state vector.
 *
 * Local +Y is UP (radially out), +X is ALONG-TRACK (the component of velocity
 * perpendicular to up), +Z completes it. Y-up matches the walker's own radial
 * axis and matches the station asset's authored up, so a reader comparing the
 * two is not also converting a handedness.
 *
 * DEGENERATE INPUTS ARE REFUSED, NOT REPAIRED. A state with zero velocity, or
 * one whose velocity is purely radial, has no along-track direction, and a
 * fallback axis invented here would be a basis that silently changes the moment
 * the orbit stops being degenerate. Returning false makes the caller decide.
 */
function lvlh(out: FramePose,
              px: number, py: number, pz: number,
              vx: number, vy: number, vz: number): boolean {
  const r = Math.hypot(px, py, pz);
  if (!(r > 1e-6)) return false;
  const uy0 = px / r, uy1 = py / r, uy2 = pz / r;
  const dot = vx * uy0 + vy * uy1 + vz * uy2;
  let ax = vx - uy0 * dot, ay = vy - uy1 * dot, az = vz - uy2 * dot;
  const al = Math.hypot(ax, ay, az);
  if (!(al > 1e-9)) return false;
  ax /= al; ay /= al; az /= al;
  // across = along x up, because for columns (X, Y, Z) a RIGHT-handed basis
  // needs Z = X x Y. Written the other way round (`up x along`) this produced a
  // determinant of -1, i.e. a reflection, and `setPoseFromBasis` then returned
  // a quaternion of magnitude 0.790 that looked entirely healthy and scaled
  // every vector it touched. It now throws instead; the comment stays because
  // the mistake is one line and reads correct.
  const cx = ay * uy2 - az * uy1;
  const cy = az * uy0 - ax * uy2;
  const cz = ax * uy1 - ay * uy0;
  setPoseFromBasis(out, px, py, pz, ax, ay, az, uy0, uy1, uy2, cx, cy, cz);
  return true;
}

/**
 * A carrier riding a `VesselRecord`'s conic. Anchorage is the first consumer.
 *
 * THE RECORD IS THE ONLY AUTHORITY AND IT IS NOT COPIED. `stateOf` is called
 * per `poseAt`, which is one Kepler solve, and nothing is cached between calls
 * (PH-3's rule: "nothing is advanced per tick, so an unattended fleet costs
 * exactly zero until somebody asks"). A cached pose here would be the second
 * copy of the station's position, which is the exact defect D-014 settled.
 *
 * A FROZEN RECORD PRODUCES A STATIONARY CARRIER, WITH NO BRANCH. `mintStation`
 * leaves `stampedTick = -1`, and `VesselRegistry.clockAt` then returns
 * `rec.clockS` unchanged for every tick, so `poseAt(t)` is constant for all `t`
 * and the transport is the identity. That is the right behaviour and it is also
 * the trap: a probe that boards Anchorage as it ships today measures a carrier
 * that does not move, which is GP-142's identity element wearing a real
 * feature's name. `movesOver` exists so a probe can assert the fixture before
 * it asserts the behaviour.
 */
export class OrbitCarrier implements CarrierFrame {
  readonly what: string;

  constructor(readonly id: string,
              private readonly M: OfCoreModule,
              private readonly rec: VesselRecord) {
    this.what = `orbit:${rec.name}`;
  }

  poseAt(tick: number, out: FramePose): FramePose {
    const s = vesselStateAt(this.M, vesselRegistry, this.rec, tick);
    if (!lvlh(out, s.pos[0], s.pos[1], s.pos[2], s.vel[0], s.vel[1], s.vel[2])) {
      // No along-track axis: seat the translation and leave the rotation
      // identity rather than invent an orientation. The ride still transports
      // correctly, because a translation needs no basis.
      out.px = s.pos[0]; out.py = s.pos[1]; out.pz = s.pos[2];
      out.qx = 0; out.qy = 0; out.qz = 0; out.qw = 1;
    }
    return out;
  }

  /** Metres the frame's ORIGIN travels between two ticks. The fixture assertion. */
  movesOver(tickA: number, tickB: number): number {
    const a = vesselStateAt(this.M, vesselRegistry, this.rec, tickA).pos;
    const b = vesselStateAt(this.M, vesselRegistry, this.rec, tickB).pos;
    return Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  }

  /** The record's own state at a tick. Exposed so a caller can derive the
   *  rotation an LVLH frame on this conic has, without a second Kepler solve. */
  stateAt(tick: number): { pos: readonly number[]; vel: readonly number[] } {
    return vesselStateAt(this.M, vesselRegistry, this.rec, tick);
  }
}

/**
 * A frame turning at a constant rate about an axis through the body centre.
 *
 * THE INSTRUMENT FOR THE ROTATING CASE, and it exists because the one real
 * rotating carrier in this client is frozen by design. `mintStation` ships
 * Anchorage with `stampedTick = -1`, so `OrbitCarrier` over it answers the same
 * pose for every tick, which is exactly the identity element GP-142 says a
 * fixture must never be. Removing that freeze is D-014's other half and is a
 * ruling with rendering and gameplay in it, not a probe's to take.
 *
 * `fromOrbit` DERIVES its axis and rate from the record's own state vector, so
 * nothing here is invented: it is the rotation `OrbitCarrier` will produce by
 * itself the day the record is stamped, and on a circular conic the two are the
 * same motion. For an eccentric one they are not, and the class says so rather
 * than pretending: this is a constant-rate approximation used to exercise the
 * quaternion path, and the shipping answer is `OrbitCarrier`.
 */
export class RotorCarrier implements CarrierFrame {
  readonly what: string;
  private readonly base = newPose();

  constructor(readonly id: string,
              base: FramePose,
              private readonly ax: number, private readonly ay: number,
              private readonly az: number,
              /** rad/s. */
              readonly rateRadS: number,
              private readonly tick0: number,
              private readonly secsPerTick: number,
              what = 'rotor') {
    copyPose(base, this.base);
    this.what = what;
  }

  poseAt(tick: number, out: FramePose): FramePose {
    const angle = this.rateRadS * (tick - this.tick0) * this.secsPerTick;
    return rotatePoseAboutOrigin(this.base, this.ax, this.ay, this.az, angle, out);
  }

  /**
   * The rotation an LVLH frame on this conic carries, at the given tick.
   *
   * Returns null when the state is degenerate (no radius, or no along-track
   * component), for the same reason `lvlh` refuses: an invented axis is a basis
   * that silently changes the day the input stops being degenerate.
   */
  static fromOrbit(id: string, orbit: OrbitCarrier, tick0: number,
                   secsPerTick: number): RotorCarrier | null {
    const s = orbit.stateAt(tick0);
    const px = s.pos[0] ?? 0, py = s.pos[1] ?? 0, pz = s.pos[2] ?? 0;
    const vx = s.vel[0] ?? 0, vy = s.vel[1] ?? 0, vz = s.vel[2] ?? 0;
    const r = Math.hypot(px, py, pz);
    if (!(r > 1e-6)) return null;
    // The orbit normal, from the record's own r x v. No convention is chosen
    // here: the sense comes out of the state vector, so a retrograde record
    // produces a retrograde rotor with no branch.
    let nx = py * vz - pz * vy;
    let ny = pz * vx - px * vz;
    let nz = px * vy - py * vx;
    const nl = Math.hypot(nx, ny, nz);
    if (!(nl > 1e-9)) return null;
    nx /= nl; ny /= nl; nz /= nl;
    // |r x v| / r^2 is the areal rate over the radius squared, i.e. the angular
    // rate, and it is exact for any conic at this instant. Derived rather than
    // taken as `v / r`, which is only the angular rate where the velocity is
    // purely tangential.
    const rate = nl / (r * r);
    const base = newPose();
    orbit.poseAt(tick0, base);
    return new RotorCarrier(id, base, nx, ny, nz, rate, tick0, secsPerTick,
      `rotor:${orbit.what}`);
  }
}

/**
 * A carrier riding a celestial body's ephemeris. Cinder is the first consumer,
 * and this is physics R79 made addressable.
 *
 * NO ORIENTATION, AND THAT IS THE MEASUREMENT RATHER THAN AN OMISSION.
 * `of_body_state` publishes a position and a velocity and no attitude, because
 * `sim_world.h` installs Cinder as a pure TRANSLATION of Forge's frame. So the
 * pose's rotation is the identity, and the transport is one subtraction and one
 * addition in f64 with no quaternion in it at all. If /core ever gives a body a
 * frame ROTATION, `CelestialEphemeris.relativeTo` names itself as the place that
 * has to be answered, and this class is the second.
 *
 * SECONDS, NOT TICKS, IS THE ONE CONVERSION AND IT IS SUPPLIED. `of_body_state`
 * takes sim seconds; `poseAt` takes a tick. `secsPerTick` is passed in from
 * `Loop.fixedDt` rather than written as `1 / 60` here, because there are already
 * two spellings of that constant in the client (`Loop.FIXED_DT` and
 * `VesselRegistry.RAILS_DT`) and a third would be the one that drifts.
 */
export class EphemerisCarrier implements CarrierFrame {
  readonly what: string;
  private readonly tmp = new THREE.Vector3();

  constructor(readonly id: string,
              private readonly M: EphemerisModule,
              private readonly bodyId: number,
              private readonly secsPerTick: number) {
    this.what = `ephemeris:body${bodyId}`;
  }

  /** False when the wasm predates PH-161. The caller refuses loudly rather than
   *  registering a carrier that would silently never move. */
  get available(): boolean { return hasEphemeris(this.M); }

  poseAt(tick: number, out: FramePose): FramePose {
    bodyStateAt(this.M, this.bodyId, tick * this.secsPerTick, this.tmp);
    out.px = this.tmp.x; out.py = this.tmp.y; out.pz = this.tmp.z;
    out.qx = 0; out.qy = 0; out.qz = 0; out.qw = 1;
    return out;
  }

  movesOver(tickA: number, tickB: number): number {
    const a = new THREE.Vector3();
    bodyStateAt(this.M, this.bodyId, tickA * this.secsPerTick, a);
    const b = new THREE.Vector3();
    bodyStateAt(this.M, this.bodyId, tickB * this.secsPerTick, b);
    return a.distanceTo(b);
  }
}
