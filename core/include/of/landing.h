#pragma once
// =============================================================================
// of::landing - THE TOUCHDOWN GATE AND THE GROUND UNDER IT (PH-175).
//
// Reid, about the moon: "This will be a fully traversable thing, we will be
// landing on it later." Orbit is done and armable; this is the landing end.
//
// It is the same two-layer split docking got, for the same reason: the
// MECHANISM first, because a descent program needs something to succeed
// against and a hand-flown landing needs it just as much. This header is the
// mechanism. `descent.h` is the program.
//
// -----------------------------------------------------------------------------
// PHYSICS R5 SAID THE LANDING END WAS DEFERRED, AND THIS IS NOT IT ARRIVING.
//
// `flight.h` still has no contact model: nothing bounces, nothing bends,
// nothing carries a load. What this header does is DECIDE, at the instant a
// vehicle reaches the surface, whether that arrival was a landing or a crash,
// and say which of the four ways it failed. That is a gate, not a contact
// solver, and the distinction is worth keeping sharp: a gate can be honest
// about a vehicle it refuses, and a half-built contact model cannot.
//
// The four ways, and every one of them is a real way to lose a lander:
//   * straight down too fast  - the legs fold
//   * sideways too fast       - it tips over, which is what legs cannot survive
//   * not upright             - landing on the side of the engine bell
//   * the ground is too steep - it slides or topples whatever you do
//
// -----------------------------------------------------------------------------
// THE SLOPE IS PART OF THE PROBLEM, NOT A DETAIL, AND THE BASELINE IS PART OF
// THE SLOPE.
//
// Cinder's height field is a nine-rung crater ladder down to about 1.8 m, so
// "the ground under the vehicle" is a different number at every scale you ask
// it at. WG-146 measured exactly this trap from the other side: a crater wall
// is a continuous 24 to 48 per cent grade at EVERY sampling baseline, so slope
// alone cannot tell a tilted plain from a featured one.
//
// So `surfaceFrame` takes the baseline explicitly and never picks one. For a
// lander the honest baseline is the FOOTPRINT: the span of the legs, because
// that is the triangle the vehicle actually stands on, and a 40 degree ripple
// two metres wide does not tip a vehicle whose feet are eight metres apart.
// =============================================================================
#include <cmath>
#include <cstdint>

#include "of/cubed_sphere.h"
#include "of/orbital.h"
#include "of/vec3.h"

namespace of {
namespace landing {

// The ground under a point: where its surface is, and which way it faces.
struct SurfaceFrame {
  double radiusM = 0.0;    // body centre to the terrain, metres
  Vec3 upUnit{0, 1, 0};    // the body-radial outward direction (gravity's opposite)
  Vec3 normalUnit{0, 1, 0};// the TERRAIN's outward normal over the baseline
  double slopeRad = 0.0;   // angle between the two
};

// Sample the terrain and its local normal, over a stated baseline.
//
// Three samples, one at the point and two a baseline away along the local east
// and north, and the normal is the cross product of the two edges. It is the
// cheapest thing that is actually a plane fit rather than a finite difference
// in one direction, and a one-direction difference would report a ridge running
// north-south as flat.
inline SurfaceFrame surfaceFrame(const worldgen::BodyParams& body,
                                 const Vec3& dirIn, double baselineM) {
  SurfaceFrame f;
  const Vec3 d = orbital::normalized(dirIn);
  f.upUnit = d;
  f.radiusM = body.radiusM + worldgen::sampleHeightField(body, d);
  if (!(baselineM > 0.0) || !(f.radiusM > 0.0)) {
    f.normalUnit = d;
    return f;
  }
  // A local tangent basis. `+Y` is the pole, so east is `pole x up` unless the
  // point IS the pole, in which case any perpendicular will do and one is
  // chosen the same way `stabilityAssist` chooses at pi: from the vector
  // itself, so it stays deterministic.
  Vec3 east = orbital::cross(Vec3{0, 1, 0}, d);
  if (east.length() < 1e-9) east = orbital::cross(Vec3{1, 0, 0}, d);
  east = orbital::normalized(east);
  const Vec3 north = orbital::normalized(orbital::cross(d, east));

  const double ang = baselineM / f.radiusM;      // small-angle, metres to radians
  const Vec3 dE = orbital::normalized(d + east * ang);
  const Vec3 dN = orbital::normalized(d + north * ang);
  const double rE = body.radiusM + worldgen::sampleHeightField(body, dE);
  const double rN = body.radiusM + worldgen::sampleHeightField(body, dN);

  const Vec3 p0 = d * f.radiusM, pE = dE * rE, pN = dN * rN;
  Vec3 n = orbital::cross(pE - p0, pN - p0);
  if (n.dot(d) < 0.0) n = n * -1.0;              // outward, always
  f.normalUnit = orbital::normalized(n);
  double c = f.normalUnit.dot(d);
  if (c > 1.0) c = 1.0;
  if (c < -1.0) c = -1.0;
  f.slopeRad = std::acos(c);
  return f;
}

// What a vehicle survives. None of these is measured off a structural model,
// because there is not one; they are the numbers this gate REFUSES above, and
// they are stated here rather than buried in comparisons.
struct TouchdownLimits {
  double maxVerticalMS = 5.0;
  double maxHorizontalMS = 2.0;
  double maxTiltRad = 15.0 * orbital::kPi / 180.0;
  double maxSlopeRad = 20.0 * orbital::kPi / 180.0;
};

struct Touchdown {
  bool onGround = false;   // it has reached the surface
  bool landed = false;     // ... and survived it
  double verticalMS = 0.0; // + is downward
  double horizontalMS = 0.0;
  double tiltRad = 0.0;    // nose against the TERRAIN normal, not the radial up
  double slopeRad = 0.0;
  double altitudeAglM = 0.0;
  const char* note = "flying";
};

// Has this vehicle arrived, and did it survive? `posM`/`velMS`/`forward` are in
// the body-centred frame; `ground` is the frame under it.
//
// TILT IS MEASURED AGAINST THE TERRAIN NORMAL AND NOT AGAINST RADIAL UP, which
// is the whole reason `surfaceFrame` computes a normal at all. A vehicle
// perfectly aligned with gravity on a 20 degree slope is 20 degrees off the
// ground it is about to touch, and it is the ground that decides whether a leg
// takes the load.
inline Touchdown evaluate(const Vec3& posM, const Vec3& velMS,
                          const Vec3& forward, const SurfaceFrame& ground,
                          const TouchdownLimits& lim,
                          double contactToleranceM = 0.5) {
  Touchdown t;
  t.slopeRad = ground.slopeRad;
  t.altitudeAglM = posM.length() - ground.radiusM;
  const Vec3 up = ground.upUnit;
  const double vUp = velMS.dot(up);
  t.verticalMS = -vUp;                                  // + is coming down
  t.horizontalMS = (velMS - up * vUp).length();
  double c = orbital::normalized(forward).dot(ground.normalUnit);
  if (c > 1.0) c = 1.0;
  if (c < -1.0) c = -1.0;
  t.tiltRad = std::acos(c);

  if (t.altitudeAglM > contactToleranceM) return t;      // still flying
  t.onGround = true;

  // ORDER IS DELIBERATE: the ground first, because a slope nobody can stand on
  // is not the pilot's fault and is the one refusal a better approach cannot
  // fix. Then the three the pilot owns, worst first.
  if (t.slopeRad > lim.maxSlopeRad) {
    t.note = "crashed: the ground here is too steep to stand on";
    return t;
  }
  if (t.verticalMS > lim.maxVerticalMS) {
    t.note = "crashed: came down too fast";
    return t;
  }
  if (t.horizontalMS > lim.maxHorizontalMS) {
    t.note = "crashed: too much sideways speed, it tipped over";
    return t;
  }
  if (t.tiltRad > lim.maxTiltRad) {
    t.note = "crashed: not upright on the slope it landed on";
    return t;
  }
  t.landed = true;
  t.note = "landed";
  return t;
}

}  // namespace landing
}  // namespace of
