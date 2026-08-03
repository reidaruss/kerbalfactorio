// The LOCAL HORIZON FRAME: the one frame the player and the navball share.
//
// Everything a pilot reads and everything a pilot commands lives here, and that
// is a design decision rather than a convenience. The ball draws heading and
// pitch above the horizon; if the keys moved the nose in the vessel's own BODY
// frame instead, "put the nose on the marker" would be a two-axis coordination
// problem whose meaning changes as the vehicle rolls.
//
// It was measured the wrong way round first. Pitching about the vessel's own
// right axis tracked the guidance ribbon's PITCH perfectly while flying to
// heading 180, because the ribbon leads east and the body-frame pitch axis moved
// the nose south. The ascent looked correct in every number the pilot was
// watching and went to the wrong place.
import { add, cross, dot, len, norm, rotateAbout, scale } from './FlightAbi.js';
import type { Vec3 } from './FlightAbi.js';

/** Heading (0 = north, 90 = east) and pitch above the horizon, in degrees. */
export interface HorizonAngles { headingDeg: number; pitchDeg: number }

/**
 * The local east and north at a radial `up`. Poles are not special.
 *
 * THE SIGN OF `east` IS `player/ViewSource.tangentFrame`'s, and it is copied
 * from there deliberately rather than re-derived: `Y x up`, not `up x Y`. The
 * two differ by a reflection, and with the wrong one the triad (east, north, up)
 * is LEFT-handed, which every angle READOUT survives unharmed because heading
 * and pitch are both computed in the same broken frame. What does not survive is
 * a ROTATION: the ascent tracked the guidance ribbon's pitch to within three
 * degrees the whole way up while flying to heading 270 against a ribbon asking
 * for 90, because the pitch-over axis came out backwards. A frame that only
 * fails when something turns is exactly the kind that reads healthy.
 */
export function horizonFrame(up: Vec3): { east: Vec3; north: Vec3 } {
  let east = cross([0, 1, 0], up);
  if (len(east) < 1e-9) east = cross([1, 0, 0], up);
  east = norm(east);
  return { east, north: norm(cross(up, east)) };
}

/** Where a unit direction points, in the horizon frame at `up`. */
export function horizonAngles(dir: Vec3, up: Vec3): HorizonAngles {
  const { east, north } = horizonFrame(up);
  const d = norm(dir);
  const pitch = Math.asin(Math.max(-1, Math.min(1, dot(d, up))));
  const h = Math.atan2(dot(d, east), dot(d, north));
  return {
    headingDeg: ((h * 180) / Math.PI + 360) % 360,
    pitchDeg: (pitch * 180) / Math.PI,
  };
}

/**
 * Move a commanded direction in the horizon frame.
 *
 * `pitchRad` > 0 LOWERS the nose toward the horizon, which is the direction a
 * gravity turn goes and the direction the ribbon leads. `yawRad` > 0 turns the
 * heading to the right. Returns the new unit command.
 */
export function slewCommand(command: Vec3, up: Vec3,
                            pitchRad: number, yawRad: number): Vec3 {
  let c = norm(command);
  // The command's horizontal component IS its heading. Straight up it has none,
  // so the launch azimuth (east) stands in, which is what gives the very first
  // pitch-over off the pad a direction at all.
  let hor = add(c, up, -dot(c, up));
  hor = len(hor) < 1e-6 ? horizonFrame(up).east : norm(hor);
  if (yawRad !== 0) {
    hor = norm(rotateAbout(hor, up, -yawRad));
    const sinP = Math.max(-1, Math.min(1, dot(c, up)));
    c = norm(add(scale(up, sinP), hor, Math.sqrt(Math.max(0, 1 - sinP * sinP))));
  }
  // cross(up, heading) is the horizontal axis the nose pitches about, so a
  // positive angle rotates the nose from the zenith towards the heading.
  if (pitchRad !== 0) c = norm(rotateAbout(c, norm(cross(up, hor)), pitchRad));
  return c;
}

/**
 * Roll angle of a vessel about its own nose, measured from the local horizontal.
 * Zero when the wings are level. Radians. NaN-free but MEANINGLESS within about
 * 2.5 degrees of the zenith, where the reference degenerates: use `rollDefined`.
 */
export function rollAngle(forward: Vec3, right: Vec3, up: Vec3): number {
  const f = norm(forward);
  const r = norm(right);
  const uPerp = norm(add(up, f, -dot(up, f)));
  const rRef = norm(cross(f, up));
  return Math.atan2(dot(r, uPerp), dot(r, rRef));
}

/** False where the nose is close enough to vertical that roll has no reference. */
export function rollDefined(forward: Vec3, up: Vec3): boolean {
  return Math.abs(dot(norm(forward), up)) < 0.999;
}

/**
 * ROLL HOLD, the third thing stability assist has to do and the one that is
 * easy to forget because nothing flies badly without it.
 *
 * `/core`'s SAS points the NOSE and has no opinion about roll, and the only
 * thing that damps roll in `flight.h` is an aerodynamic derivative, which does
 * nothing in vacuum. What it protects is the NAVBALL, which rolls with the
 * craft as KSP's does, so an undamped vessel ends up with a vertical horizon
 * and the single most important instrument in the game reads as broken.
 *
 * R73, 2026-08-03. THE EVIDENCE THIS COMMENT USED TO CITE WAS A BUG, AND THE
 * BUG IS FIXED, SO THE MEASUREMENT IS RETRACTED AND THE REASON IS KEPT.
 *
 * It said a vessel "picks up half a degree per second on the way up" and named
 * an aerodynamic derivative as the cause. The real cause was a sim INERTIA
 * error that the physics lane found and fixed (PH-165 to PH-169), peaking at
 * 41.98 deg/s on ninety seconds of ordinary ascent. That is not a rounding
 * drift, it is the shipped rocket rolling hard, and nobody reported it for
 * months because THIS FUNCTION WAS HIDING IT: `levelWings` rewrites `right`
 * every tick, so the one instrument that would have shown it was being
 * corrected before it was drawn. An instrument that silently repairs its own
 * input cannot report on it.
 *
 * So the function is NOT deletable and its job is now a different one. On the
 * reference rocket it has nothing left to do (2.1e-15 deg/s), which is what
 * "the bug is fixed" looks like from here. An ASYMMETRIC rocket still develops
 * a real 5.55 deg/s from real asymmetric thrust and drag, and that is physics
 * rather than a defect: it is exactly the case a roll damper is for, and it is
 * the case the original 0.5 deg/s figure never described.
 *
 * The old measurement is left in the retraction rather than deleted, because a
 * comment that quietly stops citing a number reads as though it never had one.
 *
 * It is bounded per tick, so it is assistance and not a weld: a player rolling
 * on purpose out-runs it and it settles them afterwards.
 */
export function holdRoll(forward: Vec3, right: Vec3, up: Vec3,
                         maxRad: number): Vec3 {
  if (!rollDefined(forward, up)) return right;
  const roll = rollAngle(forward, right, up);
  if (Math.abs(roll) < 1e-4) return right;
  // POSITIVE, not negative, and the sign is the whole function. `rollAngle` is
  // atan2 of `right` against the level reference, so rotating `right` about the
  // nose by +roll is what carries it back to level. The other sign has a fixed
  // point too, at 180 degrees, and it converges there just as smoothly and just
  // as fast: the first build settled at ROL 179.998 and looked, from the code,
  // exactly like a working damper.
  const d = Math.max(-maxRad, Math.min(maxRad, roll));
  return norm(rotateAbout(norm(right), norm(forward), d));
}
