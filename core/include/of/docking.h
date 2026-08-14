#pragma once
// =============================================================================
// of::docking - THE CAPTURE TEST AND THE JOIN (PH-170, D-015).
//
// D-015 rules that a docking port is a PART INSTANCE IN A DESIGN and not a
// special case bolted to the station, and that "automatically dock" means full
// auto-approach shipped in two layers. This header is the FIRST layer: capture
// is the mechanism, and manual docking needs it just as much as an autopilot
// does, so it is built first and on its own.
//
// It computes nothing about vessels, parts or frames. It is handed two port
// POSES at the start and end of a tick and answers one question: did these two
// ports mate during that tick, and if not, WHICH condition failed. Everything
// about where a port is comes from the caller, because a port's pose is a
// vessel-layout question and `vessel.h` already owns that.
//
// -----------------------------------------------------------------------------
// WHY THE TEST IS SWEPT AND NOT A POINT-IN-SPHERE, WHICH IS THE WHOLE DESIGN.
//
// A port's capture radius is 0.60 m (`vessel.h`, DW-30 item 5). A tick is
// 1/60 s. So a point-in-sphere test at tick boundaries is blind to any relative
// speed above about 72 m/s, and completely blind at orbital speeds: R67
// measured 7.6 km/s of pass speed against a stationary station, which is 127 m
// of travel per tick through a 1.2 m diameter sphere. **The two ports can be
// exactly coincident mid-tick and the test sees nothing at either end.**
//
// D-014 has since ruled that an orbiting thing genuinely orbits, so a real
// rendezvous arrives slowly (PH-154 flew one: 0.23133 m/s relative at 108.87 m)
// and the pathological 7.6 km/s case is gone. THE SWEEP STAYS ANYWAY, for two
// reasons that outlive that ruling: a player can fly an approach badly at any
// speed they like, and a test whose correctness depends on the approach being
// slow is a test that fails exactly when a player makes a mistake, which is the
// moment it most needs to be right.
//
// -----------------------------------------------------------------------------
// CAPTURE IS AT FIRST CONTACT, NOT AT CLOSEST APPROACH.
//
// A magnetic capture cone grabs the instant the port is inside it. Solving for
// the closest approach and testing that would latch a port that came within
// 0.1 m and left again at the WRONG INSTANT: the vessel would be pinned at the
// bottom of the approach rather than where it first touched. So the quadratic
// is solved for its FIRST root inside the tick, and the closest approach is
// computed as well and reported, because it is what a refusal needs to say.
//
// -----------------------------------------------------------------------------
// A CAPTURE THAT IS TOO FAST IS A REFUSAL AND NOT A LATCH, AND THAT IS A
// DELIBERATE GAP RATHER THAN A MODEL.
//
// There is no structural damage anywhere in this project: nothing breaks, bends
// or explodes. So a 40 m/s arrival has two honest outcomes and one dishonest
// one. Honest: refuse, and say the closing speed, so a screen can tell the
// player they came in too fast. Honest: model the damage. DISHONEST: latch
// silently, because that teaches a player that speed does not matter and then
// silently becomes wrong the day damage exists. This refuses, and `note` says
// so in words.
// =============================================================================
#include <cmath>

#include "of/orbital.h"
#include "of/vec3.h"

namespace of {
namespace docking {

// A port in whatever frame the caller is working in. Both poses handed to
// `sweptCapture` must be in the SAME frame; which frame that is, is the
// caller's business and this header never asks.
//
// `faceAxis` points OUT of the port, along the direction a partner approaches
// from. Two ports mate when their face axes are ANTIPARALLEL, which is the
// only orientation in which they are pointing at each other.
//
// `rollAxis` is perpendicular to `faceAxis` and fixes the port's clocking. It
// is NOT used by the capture test: a magnetic cone has no opinion about roll,
// and requiring an alignment the mechanism does not have would refuse dockings
// that a real port accepts. It is used by `matedPose`, which has to produce one
// definite answer for where the two vessels end up.
struct PortPose {
  Vec3 posM{0, 0, 0};
  Vec3 faceAxis{0, 1, 0};
  Vec3 rollAxis{1, 0, 0};
};

// The three numbers a capture is gated on. The first two come off the part
// (`vessel.h`'s `dockCaptureRadiusM` and `dockCaptureConeRad`) and are NOT
// duplicated here: a caller reads them from the `PartDef` and passes them, for
// the same reason physics owns mu (DW-18). The third has no home yet.
struct Limits {
  double captureRadiusM = 0.60;
  double captureConeRad = 30.0 * orbital::kPi / 180.0;
  // WHAT COUNTS AS AN ARRIVAL RATHER THAN A CRASH. 2.0 m/s is not measured off
  // anything in this project, because there is nothing to measure: it is the
  // number this header refuses ABOVE, chosen so that the flown rendezvous
  // (0.23133 m/s) clears it by an order of magnitude and a careless approach
  // does not. It is a POLICY and it is the only one in this file, so it is
  // stated here rather than buried in a comparison.
  double maxClosingMS = 2.0;
};

struct CaptureResult {
  bool captured = false;
  // Where in the tick it happened, 0 at the start and 1 at the end. A caller
  // that wants sub-tick fidelity can interpolate to it; a caller that does not
  // can ignore it and pin at the end of the tick, which is 16.7 ms of error.
  double tFraction = 0.0;
  // At the capture instant when `captured`; at CLOSEST APPROACH otherwise, so
  // a refusal can say how near it got.
  double separationM = 0.0;
  double closestApproachM = 0.0;
  // How far the face axes are from antiparallel, at the same instant.
  double coneErrorRad = 0.0;
  double closingMS = 0.0;
  const char* note = "no approach";
};

// Interpolate a pose across the tick. Positions are exact under a constant
// relative velocity, which is what a tick of a rigid body is to first order.
//
// AXES ARE LERPED AND RENORMALISED RATHER THAN SLERPED, and the error is
// bounded and stated instead of assumed: at the largest rotation a tick can
// contain in practice (the 42 deg/s R71 used to produce, i.e. 0.7 degrees per
// tick at 1/60) the angular error of a normalised lerp at the midpoint is
// under 2e-5 degrees. A slerp would need a branch for the antiparallel case,
// which is exactly the singularity PH-151 was about, for no measurable gain.
inline PortPose lerpPose(const PortPose& a, const PortPose& b, double s) {
  PortPose p;
  p.posM = a.posM + (b.posM - a.posM) * s;
  p.faceAxis = orbital::normalized(a.faceAxis + (b.faceAxis - a.faceAxis) * s);
  p.rollAxis = orbital::normalized(a.rollAxis + (b.rollAxis - a.rollAxis) * s);
  return p;
}

// The angle between two face axes AND ANTIPARALLEL, which is the mated
// orientation. Returns 0 when the ports point exactly at each other.
inline double coneErrorRad(const Vec3& faceA, const Vec3& faceB) {
  double c = -orbital::normalized(faceA).dot(orbital::normalized(faceB));
  if (c > 1.0) c = 1.0;
  if (c < -1.0) c = -1.0;
  return std::acos(c);
}

// THE CAPTURE TEST. `a` is one port and `b` is the other, each at the start and
// end of the tick, in one shared frame. `dtS` is the tick, and is needed only
// to turn the sweep parameter into a speed.
inline CaptureResult sweptCapture(const PortPose& a0, const PortPose& a1,
                                  const PortPose& b0, const PortPose& b1,
                                  const Limits& lim, double dtS) {
  CaptureResult r;
  const Vec3 d0 = b0.posM - a0.posM;
  const Vec3 d1 = b1.posM - a1.posM;
  const Vec3 dv = d1 - d0;                 // relative travel over the whole tick

  // |d0 + s*dv|^2 = A s^2 + B s + C, minimised at s = -B / 2A.
  const double A = dv.lengthSq();
  const double B = 2.0 * d0.dot(dv);
  const double C = d0.lengthSq();

  double sClosest = 0.0;
  if (A > 0.0) {
    sClosest = -B / (2.0 * A);
    if (sClosest < 0.0) sClosest = 0.0;
    if (sClosest > 1.0) sClosest = 1.0;
  }
  const double closestSq = std::fmax(0.0, A * sClosest * sClosest
                                          + B * sClosest + C);
  r.closestApproachM = std::sqrt(closestSq);

  const double R = lim.captureRadiusM;
  // FIRST contact, not closest approach: solve A s^2 + B s + (C - R^2) = 0 and
  // take the smaller root that lies inside the tick.
  const double c2 = C - R * R;
  double sHit = -1.0;
  if (c2 <= 0.0) {
    sHit = 0.0;                             // already inside at the tick's start
  } else if (A > 0.0) {
    const double disc = B * B - 4.0 * A * c2;
    if (disc >= 0.0) {
      const double sq = std::sqrt(disc);
      const double sA = (-B - sq) / (2.0 * A);
      const double sB = (-B + sq) / (2.0 * A);
      const double lo = std::fmin(sA, sB), hi = std::fmax(sA, sB);
      if (lo >= 0.0 && lo <= 1.0) sHit = lo;
      else if (hi >= 0.0 && hi <= 1.0) sHit = hi;
    }
  }

  const double closingMS = (dtS > 0.0) ? std::sqrt(A) / dtS : 0.0;
  r.closingMS = closingMS;

  if (sHit < 0.0) {
    r.separationM = r.closestApproachM;
    r.coneErrorRad = coneErrorRad(lerpPose(a0, a1, sClosest).faceAxis,
                                  lerpPose(b0, b1, sClosest).faceAxis);
    r.tFraction = sClosest;
    r.note = "no capture: the ports never came within the capture radius";
    return r;
  }

  const PortPose aH = lerpPose(a0, a1, sHit);
  const PortPose bH = lerpPose(b0, b1, sHit);
  r.tFraction = sHit;
  r.separationM = (bH.posM - aH.posM).length();
  r.coneErrorRad = coneErrorRad(aH.faceAxis, bH.faceAxis);

  // ORDER MATTERS AND IS DELIBERATE. Being outside the cone is a different
  // sentence from arriving too fast, and a player who is both should be told
  // about the pointing first, because that is the one they can see on a
  // navball. Each refusal names itself, the same way `flyTransfer` does.
  if (r.coneErrorRad > lim.captureConeRad) {
    r.note = "no capture: the ports are not facing each other";
    return r;
  }
  if (closingMS > lim.maxClosingMS) {
    r.note = "no capture: closing too fast to latch";
    return r;
  }
  r.captured = true;
  r.note = "captured";
  return r;
}

// WHERE THE TWO VESSELS END UP ONCE THEY ARE LATCHED.
//
// The capture test says WHETHER; this says WHERE, and the two are separate on
// purpose: capture is a per-tick predicate on poses, and the join is a
// one-shot construction that has to be exactly right because it is what the
// save will carry.
//
// Given the station's port in some frame, and the arriving vessel's port
// expressed in the VESSEL'S OWN LOCAL FRAME, this returns the vessel's origin
// and attitude such that the two ports are face to face, mating planes
// touching, with the roll axes aligned.
//
// The vessel's attitude is published in `flight.h`'s own convention (`forward`
// is the vessel +Y, `right` is the vessel +X) so it feeds `of_fl_set_attitude`
// with nothing in between to get wrong.
struct MatedPose {
  Vec3 originM{0, 0, 0};
  Vec3 forward{0, 1, 0};
  Vec3 right{1, 0, 0};
};

// Rotate `v` by the rotation that carries the orthonormal triad
// (f0, r0, f0 x r0) onto (f1, r1, f1 x r1).
inline Vec3 applyTriadRotation(const Vec3& f0, const Vec3& r0,
                               const Vec3& f1, const Vec3& r1, const Vec3& v) {
  const Vec3 F0 = orbital::normalized(f0);
  // Gram-Schmidt, so a roll axis that is not exactly perpendicular to the face
  // axis (which is what reading one off a shipped mesh gives you) still yields
  // an orthonormal triad instead of a skewed one.
  const Vec3 R0 = orbital::normalized(r0 - F0 * F0.dot(r0));
  const Vec3 U0 = orbital::cross(F0, R0);
  const Vec3 F1 = orbital::normalized(f1);
  const Vec3 R1 = orbital::normalized(r1 - F1 * F1.dot(r1));
  const Vec3 U1 = orbital::cross(F1, R1);
  // Decompose v in the source triad, recompose in the target one.
  const double a = v.dot(F0), b = v.dot(R0), c = v.dot(U0);
  return F1 * a + R1 * b + U1 * c;
}

inline MatedPose matedPose(const PortPose& stationPort,
                           const PortPose& vesselPortLocal) {
  // The vessel's port must end up pointing BACK at the station's port, so the
  // target for the vessel port's face axis is the station port's face axis
  // NEGATED. This one minus sign is the entire content of "docking", and it is
  // also the sign an asset lane just found shipped the wrong way round on the
  // station's own socket, so it is written out rather than folded into a
  // matrix.
  const Vec3 targetFace = orbital::normalized(stationPort.faceAxis) * -1.0;
  const Vec3 targetRoll = stationPort.rollAxis;

  MatedPose m;
  m.forward = applyTriadRotation(vesselPortLocal.faceAxis,
                                 vesselPortLocal.rollAxis,
                                 targetFace, targetRoll, Vec3{0, 1, 0});
  m.right = applyTriadRotation(vesselPortLocal.faceAxis,
                               vesselPortLocal.rollAxis,
                               targetFace, targetRoll, Vec3{1, 0, 0});
  // The port's local offset, rotated into the mated attitude, then subtracted:
  // the port lands on the station's port and the origin follows.
  const Vec3 offset = applyTriadRotation(vesselPortLocal.faceAxis,
                                         vesselPortLocal.rollAxis,
                                         targetFace, targetRoll,
                                         vesselPortLocal.posM);
  m.originM = stationPort.posM - offset;
  return m;
}

// The vessel's port, in the same frame as everything else, once the vessel is
// at a given origin and attitude. The inverse of the construction above, and
// it exists so a test can close the loop rather than trusting it: mate, then
// place the port, then check it lands on the station's.
inline PortPose portAt(const Vec3& originM, const Vec3& forward,
                       const Vec3& right, const PortPose& portLocal) {
  const Vec3 F = orbital::normalized(forward);
  const Vec3 R = orbital::normalized(right - F * F.dot(right));
  const Vec3 U = orbital::cross(F, R);
  auto toWorld = [&](const Vec3& v) {
    // local +Y is forward, local +X is right, local +Z is the third axis.
    return F * v.y + R * v.x + U * v.z;
  };
  PortPose p;
  p.posM = originM + toWorld(portLocal.posM);
  p.faceAxis = orbital::normalized(toWorld(portLocal.faceAxis));
  p.rollAxis = orbital::normalized(toWorld(portLocal.rollAxis));
  return p;
}

// =============================================================================
// PH-360. THE LIVE ENVELOPE VERDICT, WHICH IS WHAT A BUTTON NEEDS AND THE SWEPT
// TEST IS NOT.
//
// `sweptCapture` answers "did these two ports mate during that tick". A DOCK
// BUTTON asks a different question: "if I pressed you right now, would you
// latch, and if not, WHICH sentence do I put on the screen". The two differ in
// three ways that matter and none of them is cosmetic.
//
//   1. IT IS ASKED BETWEEN TICKS, including on a paused sim, so it takes the
//      poses as they are rather than at two ends of an interval.
//   2. THE CLOSING RATE IS SIGNED. The sweep reports |travel|/dt, which is a
//      SPEED: 0.3 m/s reads the same whether you are arriving or drifting away,
//      and those are opposite sentences on a screen. This projects the relative
//      velocity onto the line between the ports, so POSITIVE IS CLOSING.
//   3. IT HAS VERDICTS THE MECHANISM DOES NOT. "Already docked" and "that is
//      your own vessel" are refusals a button must make and a magnet cannot.
//
// WHY THE SELF-DOCK RULE LIVES HERE RATHER THAN IN THE CLIENT. A vessel latched
// to itself is not a UI mistake, it is a physical impossibility, and every
// caller that ever grows a second docking path would otherwise have to remember
// it. `sameVessel` is the caller's own identity comparison, because what an
// identity IS belongs to whoever owns the registry, exactly as `mu` is passed
// rather than known (DW-18). What the rule MEANS belongs here.
//
// -----------------------------------------------------------------------------
// THE ORDER OF THE REFUSALS IS THE ORDER A PILOT CAN ACT ON THEM.
//
// Self-dock and already-docked come first because they are facts about which
// two things are being asked about and no amount of flying changes them. Then
// range, then pointing, then speed, which is `sweptCapture`'s own order and is
// kept in step with it deliberately: a player who is out of range, pointing the
// wrong way AND too fast should be told about the range, because that is the
// one that has to be fixed first. The NUMBERS for all three are published
// regardless, so a screen that wants to say "12.4 m out, closing 15.0 (limit
// 2.0)" can, and the R89 lesson holds: the verdict says which gate is shut, the
// numbers say whether the approach is winning.
// =============================================================================
enum class Verdict {
  Available = 0,    // press it and it latches
  OutOfRange = 1,   // farther apart than the capture radius
  NotFacing = 2,    // outside the capture cone
  TooFast = 3,      // inside the envelope, arriving faster than it can latch
  AlreadyDocked = 4,
  SelfDock = 5,     // a vessel cannot dock to itself
};

struct Candidate {
  bool available = false;
  Verdict verdict = Verdict::OutOfRange;
  double separationM = 0.0;
  // POSITIVE IS CLOSING. See the header above: this is the whole difference
  // between "arriving" and "drifting away", and `CaptureResult::closingMS`
  // cannot tell them apart because it is a magnitude.
  double closingMS = 0.0;
  double coneErrorRad = 0.0;
};

// `mine` and `theirs` are the two ports in one shared frame, `relVelMS` is the
// arriving vessel's velocity MINUS the target's in that same frame.
inline Candidate candidate(const PortPose& mine, const PortPose& theirs,
                           const Vec3& relVelMS, const Limits& lim,
                           bool alreadyDocked, bool sameVessel) {
  Candidate c;
  const Vec3 d = theirs.posM - mine.posM;
  c.separationM = d.length();
  c.coneErrorRad = coneErrorRad(mine.faceAxis, theirs.faceAxis);
  // The component of the relative velocity along the line to the target port.
  // At zero separation the line is undefined and the honest answer is 0: two
  // coincident ports have no radial rate, whatever else they are doing.
  if (c.separationM > 1e-9) {
    c.closingMS = relVelMS.dot(d) / c.separationM;
  }

  if (sameVessel) { c.verdict = Verdict::SelfDock; return c; }
  if (alreadyDocked) { c.verdict = Verdict::AlreadyDocked; return c; }
  if (c.separationM > lim.captureRadiusM) { c.verdict = Verdict::OutOfRange; return c; }
  if (c.coneErrorRad > lim.captureConeRad) { c.verdict = Verdict::NotFacing; return c; }
  // The GATE IS ON THE MAGNITUDE and not on the signed rate, which is a real
  // decision rather than an oversight. A vessel sliding sideways through the
  // envelope at 8 m/s has a signed closing rate near zero and is not docking;
  // gating on the projection would latch it. So the sign is published for the
  // screen and the magnitude is what the mechanism is judged by, which is also
  // exactly what `sweptCapture` gates on, so the two cannot disagree.
  if (relVelMS.length() > lim.maxClosingMS) { c.verdict = Verdict::TooFast; return c; }
  c.verdict = Verdict::Available;
  c.available = true;
  return c;
}

// =============================================================================
// PH-361. LETTING GO, AND WHY IT NEEDS A NUMBER OF ITS OWN.
//
// Undocking is not "stop being docked". Two hulls released at zero relative
// velocity sit at 0.00 m separation inside a 0.60 m capture radius for ever:
// under an auto-latching rig they re-capture on the next tick, and under a
// manual one the player is left pressing a button that puts them back where
// they already are. The release has to PUSH, and the push has to be along the
// one direction that cannot scrape the other hull, which is straight out of the
// port's own mating plane.
//
// 0.20 m/s, and it is derived rather than picked. It has to clear the 0.60 m
// capture radius promptly, which it does in 3.0 s; it has to be small enough
// that a mis-pressed undock is trivially recoverable, so it is an order below
// `Limits::maxClosingMS`; and it is the same order as the closing rate the one
// rendezvous this project has actually flown arrived at (0.23133 m/s, PH-154),
// i.e. a speed the vehicle has demonstrated it can null with the RCS it has.
inline constexpr double kReleaseSepMS = 0.20;

// The velocity a released vessel should have: the host's, plus a push straight
// out of its own port. `hostVelMS` is the thing it was latched to.
inline Vec3 releaseVelocity(const PortPose& myPortWorld, const Vec3& hostVelMS,
                            double sepMS) {
  const double v = sepMS > 0.0 ? sepMS : kReleaseSepMS;
  return hostVelMS + orbital::normalized(myPortWorld.faceAxis) * v;
}

}  // namespace docking
}  // namespace of
