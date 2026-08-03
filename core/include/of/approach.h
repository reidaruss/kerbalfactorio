#pragma once
// =============================================================================
// of::approach - THE AUTO-APPROACH (D-015 layer two, PH-174).
//
// Reid's words: "For destinations with a docking mechanism it should
// automatically dock. Otherwise it should just rendezvous." D-015 splits that
// into capture (the mechanism, `docking.h`) and auto-approach (the program that
// drives to it). This is the program.
//
// It picks up where `transfer.h` and `autopilot.h` put the vehicle down. The
// flown rendezvous ends 108.87 m from the station at 0.23133 m/s relative
// (PH-154), and this flies that last hundred metres.
//
// -----------------------------------------------------------------------------
// IT IS A CONTROL LAW AND NOT A PLAN, WHICH IS A DELIBERATE DEPARTURE FROM
// `autopilot.h`'s STANDING RULE, so here is the argument for it.
//
// `autopilot.h` opens with "AUTOPILOT FLIES THE PLAN THE SOLVER PRODUCED. IT
// DOES NOT RE-DERIVE IT IN FLIGHT", and that rule is right for a transfer,
// where the trajectory is a conic and a plan can be compared against the flight
// that followed it. It is wrong here, for a reason that is measurable rather
// than stylistic:
//
//   * THERE IS NO CONIC TO SOLVE. Over a 100 m approach the differential
//     gravity between the two vehicles is about 3e-6 m/s^2, which over a ten
//     minute approach is a couple of millimetres. The orbit is not what moves
//     the vehicle here; the thrusters are.
//   * THE DISPERSION IS THE SAME SIZE AS THE TASK. The rendezvous arrives
//     108.87 m out, and the approach is 108.87 m long. A schedule of impulses
//     computed in advance would be correcting an error as large as itself,
//     which is R66 at the scale where it stops being a residue (the same
//     argument that made the lunar mid-course correction compulsory).
//
// So this publishes a GUIDANCE function: given where the two ports are right
// now, where should the nose point and which way should the thrusters push.
// Nothing is stored between calls, so it cannot drift out of step with the
// vehicle and cannot be called twice to different effect.
//
// -----------------------------------------------------------------------------
// THE TARGET POSE IS HANDED IN, AND THAT IS WHAT MAKES THIS INDEPENDENT OF THE
// CARRIER-TERM WORK (R77 / R79).
//
// Where a station's port is, tick by tick, is a reference-frame question:
// D-014 made an orbiting thing genuinely orbit, and `KinematicBody` still
// integrates an absolute position with no carrier term. That work is open and
// held. This header does not wait for it, because it never asks where the
// target is: it is TOLD, every call, in whatever frame the caller is working
// in. The day the frame work lands, this inherits the correct pose with no
// change here.
//
// -----------------------------------------------------------------------------
// WHY THE APPROACH IS A CORRIDOR AND NOT A STRAIGHT LINE.
//
// The shortest path from the rendezvous point to the port goes through the
// station. A port faces OUT along its own axis, so the only direction a vessel
// may arrive from is along that axis: `docking::sweptCapture` enforces it with
// the 30 degree cone, and the hull enforces it rather more firmly. So the
// program flies to a STANDOFF point out along the axis first and only then
// closes, and the closing rate is gated on the lateral error so that it cannot
// arrive off-axis by closing faster than it centres.
// =============================================================================
#include <cmath>
#include <cstdint>

#include "of/docking.h"
#include "of/orbital.h"
#include "of/vec3.h"

namespace of {
namespace approach {

struct Corridor {
  // Where the final approach begins, out along the target port's face axis.
  double standoffM = 30.0;
  // The cone a vessel must be inside before it is allowed to close. Deliberately
  // TIGHTER than `docking::Limits::captureConeRad` (30 degrees), because that
  // one is about which way the ports POINT at the instant of contact and this
  // one is about which direction the vessel ARRIVES FROM. A vessel that is
  // 25 degrees off the axis at 30 m is heading for the hull.
  double corridorHalfAngleRad = 10.0 * orbital::kPi / 180.0;
  // Nothing may move faster than this relative to the target, at any range.
  double vMaxMS = 1.0;
  // Closing speed is proportional to range, so the approach slows as it
  // arrives: 0.05 per second means 30 m out it is doing 1.5 m/s (capped to
  // vMax) and 1 m out it is doing 0.05.
  double closeGainPerS = 0.05;
  // ... with a floor, or the exponential never actually arrives.
  double vMinMS = 0.05;
  // The nose must be this well aimed before the program is allowed to CLOSE.
  // It may translate sideways while still turning; it may not drive at the
  // port while pointing somewhere else.
  double aimGateDeg = 5.0;
  // Velocity error above this saturates the thrusters. Below it the command is
  // proportional, which is what stops the approach chattering at full throttle
  // around a 0.05 m/s target.
  double velErrorSaturationMS = 0.25;
};

enum class Leg : uint8_t {
  Align,     // outside the corridor: get onto the axis, do not close
  Corridor,  // inside the corridor, closing to the standoff point
  Final,     // inside the standoff, closing to contact
  Contact,   // within the capture radius; `docking::sweptCapture` decides
  Aborted,   // it refuses, and `note` says why
};

struct Guidance {
  Leg leg = Leg::Align;
  Vec3 sasCommand{0, 1, 0};    // where the nose must point, inertial
  Vec3 rcsTranslate{0, 0, 0};  // inertial; magnitude 0..1 of RCS thrust
  double rangeM = 0.0;         // port to port
  double alongM = 0.0;         // along the target port's face axis, + is in front
  double lateralM = 0.0;       // off the axis
  double closingMS = 0.0;      // + is closing
  double aimErrorDeg = 180.0;  // how far the nose is from the docking attitude
  const char* note = "";
};

// ONE CALL, NO STATE. `targetPort` and `targetVelMS` are the other port's pose
// and velocity in whatever frame the caller uses; the vessel's state must be in
// the same one. `vesselPortLocal` is the vessel's own port in VESSEL-LOCAL
// coordinates, which is where `vessel.h`'s layout puts it.
inline Guidance guide(const docking::PortPose& targetPort,
                      const Vec3& targetVelMS,
                      const Vec3& vesselPosM, const Vec3& vesselVelMS,
                      const Vec3& vesselForward, const Vec3& vesselRight,
                      const docking::PortPose& vesselPortLocal,
                      const docking::Limits& lim,
                      const Corridor& c) {
  Guidance g;

  // A PORT THAT IS NOT ON THE STACK AXIS IS REFUSED RATHER THAN AIMED
  // APPROXIMATELY, and this is a real limit rather than an oversight.
  //
  // `flight.h` has no roll command, deliberately (PH-44: roll through
  // `commandDirection` silently dropped a vessel out of PROGRADE into COMMAND).
  // So the only attitude this program can ask for is a direction for the NOSE.
  // If the port's own face axis IS the nose, that one direction determines the
  // whole docking attitude and the command is exact. If the port is mounted
  // radially, it is not: the same nose direction admits a whole circle of roll
  // angles and only some of them point the port at anything. Aiming anyway
  // would produce an approach that looks correct and misses.
  const Vec3 pf = orbital::normalized(vesselPortLocal.faceAxis);
  if (pf.dot(Vec3{0, 1, 0}) < 0.999999) {
    g.leg = Leg::Aborted;
    g.note = "cannot auto-approach on a port that is not on the stack axis";
    return g;
  }

  const Vec3 axis = orbital::normalized(targetPort.faceAxis);
  const docking::PortPose mine =
      docking::portAt(vesselPosM, vesselForward, vesselRight, vesselPortLocal);

  // Geometry, port to port, decomposed on the target port's own axis.
  const Vec3 toMe = mine.posM - targetPort.posM;
  g.rangeM = toMe.length();
  g.alongM = toMe.dot(axis);
  const Vec3 lateralVec = toMe - axis * g.alongM;
  g.lateralM = lateralVec.length();

  const Vec3 relV = vesselVelMS - targetVelMS;
  g.closingMS = -relV.dot(orbital::normalized(toMe));

  // THE DOCKING ATTITUDE. The port faces back along the target port's axis, and
  // because the port IS the nose (checked above) that is the whole command.
  g.sasCommand = axis * -1.0;
  double ca = orbital::normalized(vesselForward).dot(g.sasCommand);
  if (ca > 1.0) ca = 1.0;
  if (ca < -1.0) ca = -1.0;
  g.aimErrorDeg = std::acos(ca) * 180.0 / orbital::kPi;

  if (g.rangeM <= lim.captureRadiusM) {
    // Inside the capture radius. THE PROGRAM STOPS COMMANDING and lets the
    // capture test decide: continuing to push while latched is how a docking
    // program tears something off, and `docking.h` is the authority on whether
    // this counts.
    g.leg = Leg::Contact;
    g.note = "at the port; the capture test decides";
    return g;
  }

  // WHERE IT IS TRYING TO GET TO. The corridor is a cone about the axis that
  // widens with distance, so a vessel far out has room and a vessel close in
  // does not.
  const double corridorAtRange =
      lim.captureRadiusM + std::fmax(0.0, g.alongM) * std::tan(c.corridorHalfAngleRad);
  const bool inCorridor = (g.alongM > 0.0) && (g.lateralM <= corridorAtRange);

  Vec3 aimPoint;
  if (!inCorridor) {
    // OUTSIDE, or behind the port plane, which means on the far side of the
    // station. Fly to the standoff point and do not close at all: `alongM <= 0`
    // is a vessel that would have to pass through the hull to reach the port.
    g.leg = Leg::Align;
    g.note = (g.alongM <= 0.0) ? "swinging round to the port's own side"
                               : "moving onto the approach axis";
    aimPoint = targetPort.posM + axis * c.standoffM;
  } else if (g.alongM > c.standoffM) {
    g.leg = Leg::Corridor;
    g.note = "closing to the standoff point";
    aimPoint = targetPort.posM + axis * c.standoffM;
  } else {
    g.leg = Leg::Final;
    g.note = "final approach";
    // Down the axis to the port itself.
    aimPoint = targetPort.posM;
    // AND IT WILL NOT DRIVE AT THE PORT WHILE POINTING SOMEWHERE ELSE. Holding
    // station and continuing to turn is the safe failure: a late dock is a
    // dock, and a fast one at the wrong attitude is a collision the capture
    // test will refuse anyway.
    if (g.aimErrorDeg > c.aimGateDeg) {
      g.note = "holding: still turning to the docking attitude";
      aimPoint = mine.posM;          // stop where you are
    }
  }

  // THE DESIRED RELATIVE VELOCITY: toward the aim point, proportional to how
  // far away it is, capped and floored.
  const Vec3 toAim = aimPoint - mine.posM;
  const double distAim = toAim.length();
  Vec3 vWant{0, 0, 0};
  if (distAim > 1e-6) {
    double sp = c.closeGainPerS * distAim;
    if (sp > c.vMaxMS) sp = c.vMaxMS;
    if (sp < c.vMinMS) sp = c.vMinMS;
    // Never plan to arrive at the port faster than the mechanism will latch.
    // `docking::Limits::maxClosingMS` is the authority and is not restated.
    if (g.leg == Leg::Final && sp > lim.maxClosingMS * 0.5)
      sp = lim.maxClosingMS * 0.5;
    vWant = toAim * (sp / distAim);
  }

  // THE THRUSTERS TRACK THE VELOCITY ERROR, not the position error. Commanding
  // position directly through a thruster is a second-order system with no
  // damping term, which oscillates; commanding VELOCITY makes the position loop
  // first order and it cannot overshoot.
  const Vec3 vErr = (targetVelMS + vWant) - vesselVelMS;
  const double e = vErr.length();
  if (e > 1e-9) {
    double th = e / c.velErrorSaturationMS;
    if (th > 1.0) th = 1.0;
    g.rcsTranslate = vErr * (th / e);
  }
  return g;
}

}  // namespace approach
}  // namespace of
