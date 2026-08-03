#pragma once
// =============================================================================
// of::descent - THE POWERED DESCENT (PH-176), layer two of the landing.
//
// `landing.h` decides whether an arrival was a landing. This flies to one.
//
// It is the same shape as `approach.h` and for the same reason: a control law
// rather than a plan, because the thing it is correcting is as large as the
// thing it is doing. `autopilot.h`'s rule (fly the plan the solver produced)
// holds where the trajectory is a conic; under power, a hundred metres above a
// crater wall, there is no conic and the terrain is arriving at the vehicle.
//
// -----------------------------------------------------------------------------
// THE GROUND IS AN INPUT, AND IT IS THE INPUT THAT MAKES THIS DIFFERENT FROM
// THE DOCKING APPROACH.
//
// A docking target sits still relative to you and its position is known. The
// ground does neither: it is wherever the terrain happens to be UNDER THE
// VEHICLE, which changes as the vehicle moves, and a descent that is fine over
// a plain flies into the side of a crater. So the caller samples the surface
// under the vehicle every tick and hands the frame in, exactly as the approach
// is handed its target pose, and for the same independence: this header never
// asks where the ground is.
//
// The consequence worth stating: because altitude is measured against the
// terrain that is actually below, a rising crater wall SHORTENS the altitude
// and the law reacts to it as a hazard rather than discovering it at contact.
//
// -----------------------------------------------------------------------------
// WHY THE DESCENT RATE IS A FUNCTION OF ALTITUDE AND NOT A SCHEDULE.
//
// The classic powered descent is a suicide burn: fall, then brake at the last
// possible instant. It is fuel-optimal and it is the wrong default here,
// because its margin for error is zero by construction and the error it has to
// tolerate is the terrain, which it cannot see until it is there. This instead
// tracks a target descent rate that falls with altitude, so the vehicle is
// always slow enough to stop in the distance it can see. It costs propellant
// and it does not fly into things.
// =============================================================================
#include <cmath>
#include <cstdint>

#include "of/landing.h"
#include "of/orbital.h"
#include "of/vec3.h"

namespace of {
namespace descent {

struct Profile {
  // THE DESCENT RATE IS A CEILING, NOT A SETPOINT, and the difference is the
  // whole fuel budget. `gain * altitude` is the fastest the vehicle may be
  // falling at that height: 1000 m up it may do 150 m/s, 10 m up it may do 1.5.
  // A vehicle falling SLOWER than the ceiling is left alone to fall, and one
  // falling faster is braked. The first version of this tracked the number as a
  // target instead, which meant a lander arriving gently at 5 m/s from 2000 m
  // was commanded to THRUST DOWNWARD to reach 60, and it emptied a 2150 kg tank
  // and then aborted at 126 s because it could no longer hold itself up.
  double descendGainPerS = 0.15;
  double maxDescentMS = 60.0;
  // The rate it aims to touch down at. `landing::TouchdownLimits` refuses above
  // 5 m/s, so this is well inside the gate rather than up against it: a program
  // that aims AT its own limit fails whenever anything is slightly off.
  double touchdownMS = 1.0;
  // Horizontal speed is nulled first and hardest. A lander with sideways speed
  // at contact tips over, which is the failure legs cannot absorb.
  double lateralGainPerS = 0.25;
  double maxLateralMS = 40.0;
  // Below this altitude the program stops trying to translate and only holds
  // the vertical, because chasing a horizontal target metres from the ground
  // tilts the vehicle exactly when it must be upright.
  double flareAltitudeM = 20.0;
  // How far the thrust axis may tip from the local surface normal. A lander
  // that points its engine at the horizon to kill lateral speed is a lander
  // that stops holding itself up.
  double maxTiltRad = 20.0 * orbital::kPi / 180.0;
  // Velocity error above this saturates the throttle; below it is proportional.
  double velErrorSaturationMS = 5.0;
};

// How hard the brake bites on the speed it is over the ceiling by. It is a
// per-second gain, so being 10 m/s too fast asks for 10 m/s^2 of braking on top
// of holding station against gravity, and the throttle clamp does the rest.
const double kBrakeGainPerS = 1.0;

enum class Leg : uint8_t {
  Brake,     // high and fast: kill the horizontal
  Descend,   // tracking the altitude/rate profile
  Flare,     // last metres, vertical only
  Down,      // at the surface; landing.h decides
  Aborted,
};

struct Guidance {
  Leg leg = Leg::Brake;
  Vec3 sasCommand{0, 1, 0};   // where the nose (and so the engine) must point
  double throttle = 0.0;
  double altitudeAglM = 0.0;
  double descentMS = 0.0;     // + is downward
  double lateralMS = 0.0;
  double targetDescentMS = 0.0;
  double tiltRad = 0.0;       // commanded thrust axis against the surface normal
  const char* note = "";
};

// ONE CALL, NO STATE. `ground` is the surface frame under the vehicle RIGHT
// NOW, sampled by the caller. `thrustAccelFull` is what one full-throttle tick
// would deliver, in m/s^2, which the caller reads from its own propulsion
// rather than this header re-deriving it.
inline Guidance guide(const Vec3& posM, const Vec3& velMS,
                      const landing::SurfaceFrame& ground,
                      double gravityMS2, double thrustAccelFull,
                      const Profile& p) {
  Guidance g;
  const Vec3 up = ground.upUnit;
  const double vUp = velMS.dot(up);
  g.descentMS = -vUp;
  const Vec3 lateralV = velMS - up * vUp;
  g.lateralMS = lateralV.length();
  g.altitudeAglM = posM.length() - ground.radiusM;

  if (!(thrustAccelFull > gravityMS2)) {
    g.leg = Leg::Aborted;
    g.note = "aborted: this vehicle cannot hold itself up here";
    g.sasCommand = up;
    return g;
  }

  // THE TARGET DESCENT RATE, and the floor is what makes it arrive rather than
  // asymptote. Above the flare it also brakes harder when the ground is close.
  double vWantDown = p.descendGainPerS * std::fmax(0.0, g.altitudeAglM);
  if (vWantDown > p.maxDescentMS) vWantDown = p.maxDescentMS;
  if (vWantDown < p.touchdownMS) vWantDown = p.touchdownMS;
  g.targetDescentMS = vWantDown;

  // ... and the horizontal target, which is always zero. The gain decides how
  // fast it is approached, not what it is.
  Vec3 vWantLateral{0, 0, 0};
  if (g.altitudeAglM > p.flareAltitudeM && g.lateralMS > 1e-6) {
    double keep = g.lateralMS - p.lateralGainPerS * g.lateralMS;
    if (keep < 0.0) keep = 0.0;
    vWantLateral = lateralV * (keep / g.lateralMS);
    g.leg = (g.lateralMS > p.maxLateralMS) ? Leg::Brake : Leg::Descend;
  } else {
    g.leg = (g.altitudeAglM > p.flareAltitudeM) ? Leg::Descend : Leg::Flare;
  }

  // THE VERTICAL: engage only when the ceiling is exceeded. Below it the engine
  // stays out of the way entirely, including the gravity term, because holding
  // against gravity while under the ceiling is a hover and a hover does not
  // land. Above it, cancel gravity AND brake off the excess.
  const double excess = g.descentMS - vWantDown;
  Vec3 aVert{0, 0, 0};
  if (excess > 0.0) {
    const double brake =
        std::fmin(thrustAccelFull, gravityMS2 + excess * kBrakeGainPerS);
    aVert = up * brake;
  }

  // THE LATERAL: always toward zero, never away from it, and switched off in
  // the flare because tilting to chase sideways speed metres from the ground is
  // how a lander arrives on its side.
  Vec3 aLat{0, 0, 0};
  if (g.altitudeAglM > p.flareAltitudeM && g.lateralMS > 1e-6) {
    const double want = std::fmin(thrustAccelFull * 0.5,
                                  g.lateralMS * p.lateralGainPerS);
    aLat = lateralV * (-want / g.lateralMS);
  }
  (void)vWantLateral;
  Vec3 aWant = aVert + aLat;

  // AND IT WILL NOT TIP THE ENGINE PAST THE POINT WHERE IT STOPS HOLDING THE
  // VEHICLE UP. Clamped against the SURFACE normal, not radial up, because on
  // a slope those differ and it is the surface the vehicle has to stand on.
  {
    const Vec3 n = ground.normalUnit;
    const double aLen = aWant.length();
    if (aLen > 1e-9) {
      const Vec3 dir = aWant * (1.0 / aLen);
      double c = dir.dot(n);
      if (c > 1.0) c = 1.0;
      if (c < -1.0) c = -1.0;
      const double ang = std::acos(c);
      if (ang > p.maxTiltRad) {
        // Rotate `dir` back toward `n` until it is exactly at the limit.
        const Vec3 perp = dir - n * c;
        const double pl = perp.length();
        if (pl > 1e-12) {
          aWant = (n * std::cos(p.maxTiltRad)
                   + perp * (std::sin(p.maxTiltRad) / pl)) * aLen;
        }
      }
    }
  }

  const double need = aWant.length();
  g.sasCommand = (need > 1e-9) ? aWant * (1.0 / need) : up;
  double th = need / thrustAccelFull;
  if (th < 0.0) th = 0.0;
  if (th > 1.0) th = 1.0;
  g.throttle = th;
  {
    double c = g.sasCommand.dot(ground.normalUnit);
    if (c > 1.0) c = 1.0;
    if (c < -1.0) c = -1.0;
    g.tiltRad = std::acos(c);
  }

  if (g.altitudeAglM <= 0.5) {
    g.leg = Leg::Down;
    g.note = "at the surface; the touchdown gate decides";
    return g;
  }
  g.note = (g.leg == Leg::Brake)   ? "braking: killing sideways speed"
         : (g.leg == Leg::Flare)   ? "flare: vertical only"
                                   : "descending on the profile";
  return g;
}

}  // namespace descent
}  // namespace of
