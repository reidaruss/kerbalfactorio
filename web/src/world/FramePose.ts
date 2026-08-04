// A RIGID POSE AND ITS ALGEBRA (core-engine, CE-30). The value type a reference
// frame answers with, and the four operations that are the whole of "the same
// point, expressed in another frame".
//
// WHY THIS IS A FILE AND NOT A `THREE.Matrix4`. Three reasons, and the third is
// the one that decides it.
//
//  1. Everything here is f64 body-frame metres, the same as `KinematicBody` and
//     `FloatingOrigin`. `THREE.Matrix4` is f64 in JS, but its API is written for
//     an object graph (`Object3D.matrixWorld`), and reaching for it here would
//     put a render-layer type in the sim path.
//  2. A pose is a value with SEVEN numbers, not sixteen. A 4x4 can hold a scale
//     and a shear, and neither of those is a thing a reference frame may have.
//     A type that can express a state the domain forbids is a type that will one
//     day hold one.
//  3. THE OPERATION THAT MATTERS IS THE DELTA, NOT THE POSE. `transportPoint`
//     below applies `B . A^-1`, and that composition is INDEPENDENT of whatever
//     basis convention a frame chose for its own local axes: pick a different
//     local basis and A and B both change, while `B . A^-1` does not move by one
//     bit. That is what lets a carrier be defined by a source that has no
//     opinion about orientation at all (a body ephemeris) and by one that does
//     (a station's LVLH deck), through one interface.
//
// CONVENTION, stated once because every sign error in this file class comes from
// leaving it implicit: a pose maps LOCAL to PARENT.
//
//     parent = q * local + p
//
// so `p` is where the local origin sits in the parent frame, and `q` rotates a
// local direction into a parent one. `applyInv` is the other way.
//
// NO ALLOCATION. Every function writes into an `out` the caller owns, because
// these run inside the fixed tick and the walker's step already costs 1.9 to
// 3.2 us of oracle time that a GC pause would dwarf.

/** Three f64 metres. Structurally identical to `PlanetBody.Vec3d` on purpose:
 *  this file must not import the world's body model to describe a point. */
export interface V3 { x: number; y: number; z: number }

/**
 * A rigid transform local -> parent. Translation plus a unit quaternion.
 *
 * `w` last, matching `THREE.Quaternion`'s constructor order, so nobody
 * transcribing between the two has to think about it.
 */
export interface FramePose {
  px: number; py: number; pz: number;
  qx: number; qy: number; qz: number; qw: number;
}

/** The identity pose: a frame coincident with its parent and not moving. */
export function newPose(): FramePose {
  return { px: 0, py: 0, pz: 0, qx: 0, qy: 0, qz: 0, qw: 1 };
}

export function setIdentity(out: FramePose): FramePose {
  out.px = 0; out.py = 0; out.pz = 0;
  out.qx = 0; out.qy = 0; out.qz = 0; out.qw = 1;
  return out;
}

export function copyPose(a: FramePose, out: FramePose): FramePose {
  out.px = a.px; out.py = a.py; out.pz = a.pz;
  out.qx = a.qx; out.qy = a.qy; out.qz = a.qz; out.qw = a.qw;
  return out;
}

/**
 * CE-82. `out = a^-1`: the parent -> local pose.
 *
 * The partner of `composePose` and it exists for one question: "what is this
 * thing's FIXED pose inside that frame?", answered by `compose(invert(frame),
 * authored)`. A consumer with an authored attitude (the station's nadir-from-Y
 * hull) and a carrier with its own basis (an LVLH deck) do not agree, and
 * neither is wrong; measuring the constant between them once is the only
 * answer that does not require one of them to change convention.
 *
 * `out` may be `a`. The gate asserts `compose(a, invert(a))` is the identity
 * to 1e-12 over random poses, which is the only check that cannot pass by
 * transcribing the same sign error into both functions.
 */
export function invertPose(a: FramePose, out: FramePose): FramePose {
  const qx = -a.qx, qy = -a.qy, qz = -a.qz, qw = a.qw;
  // -R(a)^-1 . a.p, i.e. rotate the negated translation by the conjugate.
  const px = -a.px, py = -a.py, pz = -a.pz;
  const tx = 2 * (qy * pz - qz * py);
  const ty = 2 * (qz * px - qx * pz);
  const tz = 2 * (qx * py - qy * px);
  out.px = px + qw * tx + qy * tz - qz * ty;
  out.py = py + qw * ty + qz * tx - qx * tz;
  out.pz = pz + qw * tz + qx * ty - qy * tx;
  out.qx = qx; out.qy = qy; out.qz = qz; out.qw = qw;
  return out;
}

/**
 * CE-82. `out = a . b`: the pose of a frame `b` that is fixed INSIDE frame `a`,
 * expressed in `a`'s parent.
 *
 * The defining identity, and it is what `posecheck.mjs` asserts rather than the
 * arithmetic: `apply(compose(a, b), x) === apply(a, apply(b, x))` for every `x`.
 * That is the only property any caller wants and it is checkable without
 * anybody agreeing on a quaternion convention first.
 *
 * IT EXISTS FOR THE CONSTANT OFFSET AND FOR NOTHING ELSE. A carrier answers
 * where the moving thing is; a docking port, a deck light or a seat is a FIXED
 * pose within it, and the alternative to composing here is every consumer
 * rotating its own offset by the carrier's quaternion by hand, which is the
 * one-hand-rolled-copy-per-subsystem outcome `setPoseFromBasis` was written to
 * stop. Physics R77's per-tick port pose is exactly this call with
 * `stationSocketFrame('socket_dock')` as `b`.
 *
 * ALIASING IS SAFE for `a` and `b` but `out` must not be either of them: the
 * translation is read after the rotation is written otherwise. Asserted in the
 * gate rather than left to a reader, because the failure is a silently wrong
 * pose and not a throw.
 */
export function composePose(a: FramePose, b: FramePose, out: FramePose): FramePose {
  // R(a) . b.p, inline rather than through `rotate` so `out` may be `a`'s twin
  // without a scratch V3 allocation on a per-tick path.
  const { qx: ax, qy: ay, qz: az, qw: aw } = a;
  const tx = 2 * (ay * b.pz - az * b.py);
  const ty = 2 * (az * b.px - ax * b.pz);
  const tz = 2 * (ax * b.py - ay * b.px);
  const rx = b.px + aw * tx + ay * tz - az * ty;
  const ry = b.py + aw * ty + az * tx - ax * tz;
  const rz = b.pz + aw * tz + ax * ty - ay * tx;
  const qx = aw * b.qx + ax * b.qw + ay * b.qz - az * b.qy;
  const qy = aw * b.qy - ax * b.qz + ay * b.qw + az * b.qx;
  const qz = aw * b.qz + ax * b.qy - ay * b.qx + az * b.qw;
  const qw = aw * b.qw - ax * b.qx - ay * b.qy - az * b.qz;
  out.px = a.px + rx; out.py = a.py + ry; out.pz = a.pz + rz;
  out.qx = qx; out.qy = qy; out.qz = qz; out.qw = qw;
  return out;
}

/**
 * Seat a pose from a translation and an ORTHONORMAL basis given as three
 * columns of the local->parent rotation (the local x, y and z axes expressed in
 * the parent frame).
 *
 * Takes the basis rather than a quaternion because that is the form every
 * source in this project actually has: an LVLH deck knows its up, along and
 * across; a body ephemeris has no basis at all and passes the identity. The
 * quaternion is derived here, once, so no caller has to own a matrix-to-quat
 * conversion (there are four sign branches in it and this project has already
 * paid for one hand-rolled copy of a standard transform per subsystem).
 *
 * The caller owns orthonormality. This does NOT re-orthogonalise, because
 * silently repairing a basis is how a subsystem stops finding out that its
 * basis is wrong.
 *
 * IT DOES, HOWEVER, REFUSE A LEFT-HANDED ONE, and that refusal was paid for.
 * Shepperd's method assumes a proper rotation; hand it a reflection
 * (determinant -1, which is what you get by writing `up x along` where the
 * convention wants `along x up`) and it returns a perfectly plausible
 * quaternion that is NOT UNIT. Measured: |q| = 0.790 on the station's own LVLH
 * frame, which then scaled every vector it rotated. Nothing downstream could
 * see it: the pose looked like a pose, `transportPoint(A, A, p)` was still
 * exactly the identity because the same wrong rotation cancelled itself, and
 * the only symptom was a rider drifting 40 m in ten seconds. The determinant is
 * nine multiplies and it turns an invisible corruption into a named throw.
 */
export function setPoseFromBasis(out: FramePose,
                                 px: number, py: number, pz: number,
                                 xx: number, xy: number, xz: number,
                                 yx: number, yy: number, yz: number,
                                 zx: number, zy: number, zz: number): FramePose {
  out.px = px; out.py = py; out.pz = pz;
  // det(R) with the three axes as COLUMNS. +1 is a rotation; -1 is a reflection
  // and is refused; anything else means the basis is not orthonormal, which
  // Shepperd's method cannot represent either.
  const det = xx * (yy * zz - yz * zy) - yx * (xy * zz - xz * zy)
            + zx * (xy * yz - xz * yy);
  if (!(Math.abs(det - 1) < 1e-6)) {
    throw new Error('setPoseFromBasis: the three axes are not a right-handed '
      + `orthonormal basis (det ${det.toFixed(9)}, want +1). A left-handed one `
      + '(det -1) yields a NON-UNIT quaternion that silently scales every '
      + 'vector it rotates. Check the order of your cross product: for columns '
      + '(X, Y, Z) the convention is Z = X x Y.');
  }
  // Shepperd's method, branching on the largest of the four candidate
  // denominators so the division is never by something near zero.
  // THE SIGNS ARE THE WHOLE BUG SURFACE AND THEY WERE WRONG FIRST TIME ROUND.
  // The three axis triples are COLUMNS of the local->parent matrix, so `yz` is
  // the z-component of the local Y axis, i.e. `m[2][1]`, and the antisymmetric
  // pairs must be read in THAT order. Written the other way round the result is
  // a perfectly unit quaternion that happens to be the CONJUGATE, which no
  // magnitude check can see and which turns every transport into its own
  // inverse. Caught by a round-trip test asserting `rotate(pose, localX)` comes
  // back as the parent X axis; it read 1.9957 out of a possible 2.
  const trace = xx + yy + zz;
  if (trace > 0) {
    const s = Math.sqrt(trace + 1) * 2;
    out.qw = 0.25 * s;
    out.qx = (yz - zy) / s;
    out.qy = (zx - xz) / s;
    out.qz = (xy - yx) / s;
  } else if (xx > yy && xx > zz) {
    const s = Math.sqrt(1 + xx - yy - zz) * 2;
    out.qw = (yz - zy) / s;
    out.qx = 0.25 * s;
    out.qy = (yx + xy) / s;
    out.qz = (zx + xz) / s;
  } else if (yy > zz) {
    const s = Math.sqrt(1 + yy - xx - zz) * 2;
    out.qw = (zx - xz) / s;
    out.qx = (yx + xy) / s;
    out.qy = 0.25 * s;
    out.qz = (zy + yz) / s;
  } else {
    const s = Math.sqrt(1 + zz - xx - yy) * 2;
    out.qw = (xy - yx) / s;
    out.qx = (zx + xz) / s;
    out.qy = (zy + yz) / s;
    out.qz = 0.25 * s;
  }
  return out;
}

/** Rotate a DIRECTION by a pose's rotation. No translation. */
export function rotate(a: FramePose, x: number, y: number, z: number, out: V3): V3 {
  const { qx, qy, qz, qw } = a;
  // t = 2 * (q_vec x v);  out = v + qw * t + q_vec x t
  const tx = 2 * (qy * z - qz * y);
  const ty = 2 * (qz * x - qx * z);
  const tz = 2 * (qx * y - qy * x);
  out.x = x + qw * tx + qy * tz - qz * ty;
  out.y = y + qw * ty + qz * tx - qx * tz;
  out.z = z + qw * tz + qx * ty - qy * tx;
  return out;
}

/** Rotate a DIRECTION by a pose's INVERSE rotation. */
export function rotateInv(a: FramePose, x: number, y: number, z: number, out: V3): V3 {
  const tx = 2 * (-a.qy * z + a.qz * y);
  const ty = 2 * (-a.qz * x + a.qx * z);
  const tz = 2 * (-a.qx * y + a.qy * x);
  out.x = x + a.qw * tx - a.qy * tz + a.qz * ty;
  out.y = y + a.qw * ty - a.qz * tx + a.qx * tz;
  out.z = z + a.qw * tz - a.qx * ty + a.qy * tx;
  return out;
}

/** local -> parent. */
export function apply(a: FramePose, x: number, y: number, z: number, out: V3): V3 {
  rotate(a, x, y, z, out);
  out.x += a.px; out.y += a.py; out.z += a.pz;
  return out;
}

/** parent -> local. */
export function applyInv(a: FramePose, x: number, y: number, z: number, out: V3): V3 {
  return rotateInv(a, x - a.px, y - a.py, z - a.pz, out);
}

/**
 * THE ONE THAT DOES THE WORK: `B . A^-1` applied to a PARENT-frame point.
 *
 * "Where does a point that is fixed in the carrier end up, when the carrier goes
 * from pose A to pose B." Written as one function rather than as
 * `apply(b, applyInv(a, ...))` because the two-call form invites a caller to
 * keep the intermediate local coordinate, and a stored local coordinate is a
 * second authority for the rider's position (DW-26). The rider's position stays
 * in the parent frame; the carrier's contribution is applied to it. There is
 * only ever one number.
 *
 * `transportPoint(A, A, p)` is the identity to within the quaternion round trip,
 * which is what makes "a carrier that has not moved changes nothing" a property
 * of the algebra rather than a special case in a caller.
 */
export function transportPoint(a: FramePose, b: FramePose,
                               x: number, y: number, z: number, out: V3): V3 {
  applyInv(a, x, y, z, out);
  return apply(b, out.x, out.y, out.z, out);
}

/** `B . A^-1` on a DIRECTION: the rotation half only. */
export function transportDir(a: FramePose, b: FramePose,
                             x: number, y: number, z: number, out: V3): V3 {
  rotateInv(a, x, y, z, out);
  return rotate(b, out.x, out.y, out.z, out);
}

/**
 * Turn a whole pose about an axis through the PARENT origin.
 *
 * This is what "a frame going round a body" IS, and writing it once here is
 * what stops a source spelling it out in its own axis-angle arithmetic. Both
 * halves move: the origin swings round the circle and the BASIS turns with it,
 * which is the difference between an orbiting deck (whose floor keeps facing
 * the planet) and a platform being translated along a curve (whose floor would
 * end up pointing at the horizon a quarter of an orbit later).
 *
 * `out` may alias `base`.
 */
export function rotatePoseAboutOrigin(base: FramePose,
                                      ax: number, ay: number, az: number,
                                      angle: number, out: FramePose): FramePose {
  const h = angle * 0.5;
  const s = Math.sin(h);
  const rx = ax * s, ry = ay * s, rz = az * s, rw = Math.cos(h);
  // out.p = r * base.p
  const tx = 2 * (ry * base.pz - rz * base.py);
  const ty = 2 * (rz * base.px - rx * base.pz);
  const tz = 2 * (rx * base.py - ry * base.px);
  const px = base.px + rw * tx + ry * tz - rz * ty;
  const py = base.py + rw * ty + rz * tx - rx * tz;
  const pz = base.pz + rw * tz + rx * ty - ry * tx;
  // out.q = r * base.q
  const { qx, qy, qz, qw } = base;
  out.qw = rw * qw - rx * qx - ry * qy - rz * qz;
  out.qx = rw * qx + rx * qw + ry * qz - rz * qy;
  out.qy = rw * qy + ry * qw + rz * qx - rx * qz;
  out.qz = rw * qz + rz * qw + rx * qy - ry * qx;
  out.px = px; out.py = py; out.pz = pz;
  return out;
}

/**
 * The PARENT-frame velocity of a point that is fixed in the carrier, at a
 * parent-frame point, over the interval A -> B.
 *
 * A FINITE DIFFERENCE OVER EXACTLY THE INTERVAL THE TICK WILL USE, and that is
 * deliberate rather than lazy. An analytic velocity (the ephemeris's own `v`,
 * or `omega x r`) is the derivative of a CONTINUOUS motion, while the transport
 * applied to the rider is a DISCRETE jump from A to B. Subtracting one and
 * applying the other leaves a residue proportional to the frame's curvature
 * over a tick, which accumulates. Differencing the same two poses the transport
 * uses makes the subtraction and the re-addition exact inverses of the same
 * quantity, so a rider that does nothing stays exactly where it is.
 *
 * This is the "one authority" rule applied to a derivative: the velocity is
 * derived from the pose function, never supplied beside it.
 */
export function pointVelocity(a: FramePose, b: FramePose, dt: number,
                              x: number, y: number, z: number, out: V3): V3 {
  transportPoint(a, b, x, y, z, out);
  out.x = (out.x - x) / dt;
  out.y = (out.y - y) / dt;
  out.z = (out.z - z) / dt;
  return out;
}
