#pragma once
// =============================================================================
// of::ascent - THE AIRLESS ASCENT (PH-200), and it is `descent.h` read upwards.
//
// `descent.h` flies a lander from orbit onto the ground. This flies one off the
// ground into orbit. They are the same shape deliberately: a stateless control
// law with named legs, taking the terrain under the vehicle as an input, so a
// round trip to Cinder is two headers rather than one header and a test.
//
// It exists because a number needed it. `transfer::ascentDvMS` was CALIBRATED
// against this project's own flown Forge ascent and REFUSED every other body,
// on the stated grounds that nobody had flown one (R63). Refusing was right.
// Flying one is the way out of it, and this is the program that flies it.
//
// -----------------------------------------------------------------------------
// WHY AIRLESS IS A DIFFERENT PROGRAM AND NOT A TUNING OF THE FORGE ONE.
//
// `flight::GravityTurnProgram` pitches on ALTITUDE, which is the right variable
// when the atmosphere is the thing you are racing: you must be through the thick
// air before you are fast, so height is the schedule. With no air there is
// nothing to be through. The only reason to gain height at all is to put the
// orbit's periapsis above the rocks, so the schedule here is APOAPSIS PROGRESS:
// pitch over in proportion to how much of the target apoapsis you have already
// bought. That is self-terminating (at 100 per cent you are horizontal and the
// burn is over) and it needs no per-body tuning constant, which the altitude
// ribbon does: `turnCompleteM = 45000` is a Forge number and on a 200 km moon
// with 20 km of parking orbit it is nonsense.
//
// -----------------------------------------------------------------------------
// APOAPSIS COMES FROM THE STATE VECTOR AND NEVER FROM A `bound` FLAG (R14).
//
// This is the trap that stopped the previous attempt, and it is worth stating
// in the file rather than in a risk entry. A vehicle climbing nearly straight
// up has an eccentricity of 1 to within rounding, so `flight::summarize()` sets
// `bound = false` and publishes `apoapsisAltM = 1e308` for the FIRST SECONDS OF
// EVERY LAUNCH. A cutoff gated on that flag never fires during the phase it
// exists to watch. So `arcPeak` below computes the peak radius directly from
// energy and angular momentum, where the radial case is not a special case at
// all: as h goes to zero, e goes to 1 and a(1+e) goes to 2a = -mu/E, which is
// exactly the height a stone thrown straight up comes back down from.
//
// -----------------------------------------------------------------------------
// THE TARGET APOAPSIS IS A FLOOR, NOT A SETPOINT, WHICH IS `descent.h`'s OWN
// LESSON POINTING THE OTHER WAY.
//
// The descent's first version treated its descent rate as a target, so a lander
// arriving gently was commanded to THRUST DOWNWARD to reach it, and it emptied
// a tank. The ascent form of that mistake is a vehicle whose apoapsis is
// already above target being asked to trim it back down. It does not: the
// ascent burn is over the instant the apoapsis is bought, overshoot is kept
// rather than paid for twice, and the engine commands exactly zero. Pinned in
// `test_ascent.cpp` by asserting exactly that, on a vehicle that is past its
// target and still low.
//
// -----------------------------------------------------------------------------
// THE GROUND IS AN INPUT, FOR THE SAME REASON IT IS ONE IN `descent.h`.
//
// Cinder's relief is about -3.0 km to +2.7 km, so "500 m up" off a crater floor
// can be 2 km INSIDE the rim next door. The caller samples the surface under
// the vehicle every tick and hands the frame in, and the schedule's pitch is
// then CLAMPED by the clearance actually available: under `clearanceM` the
// command is straight up whatever the schedule wants, and it is released
// linearly to the full schedule by `clearedAtM`. A rising crater wall therefore
// shortens the altitude and re-imposes the clamp, which is the descent header's
// hazard behaviour with the sign flipped.
// =============================================================================
#include <cmath>
#include <cstdint>

#include "of/landing.h"
#include "of/orbital.h"
#include "of/vec3.h"

namespace of {
namespace ascent {

// -----------------------------------------------------------------------------
// The peak of the arc the vehicle is currently on, from the state vector alone.
//
// No `stateToElements`, no `bound` flag, no Kepler solve. Energy and angular
// momentum are both exact functions of (r, v) and both are continuous through
// the radial case, which is the case R14 breaks on.
// -----------------------------------------------------------------------------
struct ArcPeak {
  bool comesBackDown = false;   // specific energy < 0: there IS a peak
  double apoapsisRadiusM = 0.0; // 0 when there is not
  double periapsisRadiusM = 0.0;
  double speedAtApoapsisMS = 0.0;  // h / rApo, and it is purely horizontal there
  double timeToApoapsisS = 0.0;    // exact, through the eccentric anomaly
  double periodS = 0.0;
  // How long ago the LAST apoapsis was, which is the same solve read the other
  // way. It exists because "when do I start the burn" and "may I still be
  // burning" are different questions and one number cannot answer both.
  double timeSinceApoapsisS = 0.0;
};

inline ArcPeak arcPeak(const Vec3& posM, const Vec3& velMS, double muM3S2) {
  ArcPeak k;
  const double r = posM.length();
  if (!(r > 0.0) || !(muM3S2 > 0.0)) return k;
  const double v2 = velMS.lengthSq();
  const double energy = 0.5 * v2 - muM3S2 / r;
  if (!(energy < 0.0)) return k;                 // escaping: no peak at all
  const double h = orbital::cross(posM, velMS).length();
  const double a = -muM3S2 / (2.0 * energy);
  double e2 = 1.0 + 2.0 * energy * h * h / (muM3S2 * muM3S2);
  if (e2 < 0.0) e2 = 0.0;                        // rounding at the circular limit
  const double e = std::sqrt(e2);
  k.comesBackDown = true;
  k.apoapsisRadiusM = a * (1.0 + e);
  k.periapsisRadiusM = a * (1.0 - e);
  k.speedAtApoapsisMS = (k.apoapsisRadiusM > 0.0) ? h / k.apoapsisRadiusM : 0.0;

  // TIME TO APOAPSIS, EXACTLY, AND THE APPROXIMATION IT REPLACES WAS THE WORST
  // DEFECT IN THIS FILE.
  //
  // The first version dodged the anomaly conversion with `vUp / (gravity minus
  // the centripetal term)`, which is right NEAR APOAPSIS and nowhere else. The
  // program then used it to decide WHETHER IT WAS NEAR APOAPSIS. Flown, a
  // vehicle that cut off low on a 20 x 6 km ellipse sat at its PERIAPSIS with
  // the centripetal term exceeding gravity, the estimate returned 0 s, and the
  // insertion fired at 6 km trying to circularise a 20 km orbit. It could never
  // finish, so it thrashed between the turn and the insertion for a thousand
  // seconds and ran the tank dry. That is why three cells of an 11 x 8
  // robustness grid failed while their neighbours passed.
  //
  // This is exact and it still never touches `summarize().bound` (R14): a and e
  // come from energy and angular momentum above, and the eccentric anomaly is
  // read off the radius with the radial velocity choosing the branch.
  k.periodS = orbital::orbitalPeriod(a, muM3S2);
  if (e < 1e-12) {
    k.timeToApoapsisS = 0.0;                     // circular: no apoapsis to wait for
    k.timeSinceApoapsisS = 0.0;
  } else {
    double cosE = (1.0 - r / a) / e;
    if (cosE > 1.0) cosE = 1.0;
    if (cosE < -1.0) cosE = -1.0;
    double E = std::acos(cosE);                  // [0, pi]
    if (posM.dot(velMS) < 0.0) E = orbital::kTwoPi - E;   // falling: past apoapsis
    double dM = orbital::kPi - (E - e * std::sin(E));
    if (dM < 0.0) dM += orbital::kTwoPi;
    const double n = std::sqrt(muM3S2 / (a * a * a));
    k.timeToApoapsisS = (n > 0.0) ? dM / n : 0.0;
    k.timeSinceApoapsisS = k.periodS - k.timeToApoapsisS;
  }
  return k;
}

struct Profile {
  // The orbit being bought, as an altitude above the body's DATUM radius (not
  // above the terrain, which differs by kilometres and is not what an orbit is
  // measured against).
  double targetApoapsisM = 20000.0;

  // THE THROTTLE CEILING, EXPRESSED AS A THRUST-TO-WEIGHT AND NOT AS A NUMBER.
  //
  // This is not a convenience. The reference lander leaves Cinder's surface at
  // a TWR of 10.2 and reaches 25.3 as its tank drains, and at full throttle it
  // passes the 807.47 m/s escape speed before an ascent profile has happened:
  // what such a flight measures is how quickly an over-engined vehicle can
  // leave, not what an ascent costs. It also destroys the control resolution
  // the insertion needs, because one 1/60 tick at that thrust delivers 0.28 m/s
  // and an insertion wanting 0.1 m/s more can only overshoot.
  //
  // Held as a RATIO so it survives the mass falling and the body changing. The
  // cost of the ceiling is measured rather than assumed: `test_ascent.cpp`
  // sweeps it and prints the delta-v against it.
  double maxTwr = 2.0;

  // The turn: pitch from vertical is `90 deg * frac^exponent`, where frac is
  // the share of the target apoapsis already bought.
  //
  // 0.30 IS THE ROBUST CHOICE AND NOT THE CHEAPEST ONE, and the difference was
  // measured rather than argued. `flight::GravityTurnProgram` uses 0.55 against
  // ALTITUDE; swept here against apoapsis progress over an 11 x 8 grid of pad
  // TWR (1.15 to 10) and exponent (0.15 to 0.55), the delta-v falls
  // monotonically as the exponent falls, so a pure cost argument would pick
  // 0.15. It is not picked, because at 0.15 and 0.20 the grid has cells that do
  // not reach orbit AT ALL while their neighbours do, and a launch program with
  // a hole in it next to its default is worse than one costing five metres per
  // second more. 0.30 reached orbit in every cell.
  double turnExponent = 0.30;

  // TERRAIN CLEARANCE, and both numbers are sized against the body's relief
  // rather than picked. Under `clearanceM` above the ground the command is
  // straight up whatever the schedule asks; the schedule is restored linearly
  // by `clearedAtM`. Cinder's measured relief is -2968 m to +2747 m, so a
  // vehicle 3 km above the terrain under it can no longer meet anything.
  double clearanceM = 500.0;
  double clearedAtM = 3000.0;

  // THE ASCENT CUTOFF IS A BAND AND NOT A KNIFE EDGE, AND THE WIDTH IS
  // MEASURED RATHER THAN PICKED.
  //
  // Without it this law hunts, and the hunt was flown before this line existed:
  // the insertion burn nulls the residual climb, which lowers the apoapsis a
  // few metres, the bare `>= target` test flips back to false, the program
  // returns to the ascent, and the commanded direction alternates every tick
  // between the turn's pure prograde and the insertion's slightly-downward
  // vector. Measured on that flight: the legs alternated 1,3,1,3 for forty
  // seconds and the vehicle ended up burning at **151.60 degrees off its own
  // command**, which is what put 3.6 m/s of climb into an orbit that was
  // supposed to be circular.
  //
  // The apoapsis drifts about 7 m over the whole insertion, so 50 m is seven
  // times the disturbance it has to reject. The cost is that the orbit comes
  // out up to 50 m below the target, which is 0.25 per cent of a 20 km parking
  // orbit and is reported rather than hidden.
  double apoapsisBandM = 50.0;

  // THE INSERTION FINISHES ON ECCENTRICITY, NOT ON A VELOCITY RESIDUAL, AND
  // THE REASON IS A MEASURED FAILURE OF THE VELOCITY VERSION.
  //
  // The first version cut the burn when the velocity was within 0.1 m/s of
  // circular. That tolerance is UNREACHABLE, and the log says why: the residual
  // bottoms out at 0.310 m/s and then GROWS, because by then the whole residual
  // is a 0.3 m/s radial component whose direction is almost perpendicular to
  // the orbit. The commanded direction therefore rotates about eight degrees
  // per tick, the vehicle cannot follow, and it kept thrusting on a stale nose
  // through 151 degrees of command swing, driving the apoapsis from 19961 m to
  // 21185 m IN 0.65 SECONDS.
  //
  // A 0.3 m/s radial residual at 544 m/s is an eccentricity of 0.0006. The law
  // was chasing a quantity that does not matter, through a slew that does. So
  // the test is now on the thing "circular" actually means, and it is the thing
  // the mission cares about: an orbit is inserted when its eccentricity is
  // under this.
  double targetEccentricity = 0.0015;

  // AND THE BURN WILL NOT RUN WHILE THE NOSE IS OFF THE COMMAND, which is
  // `autopilot.h`'s own rule at its own angle (`kAttitudeGateRad`, 15 degrees,
  // PH-152's second defect). It is the same failure in a different program:
  // thrust applied along a nose that is no longer pointed where the plan wants
  // it is not a smaller version of the right burn, it is a different burn.
  //
  // It cannot deadlock the way PH-167's hold could, and the difference is
  // structural rather than lucky: this is a THROTTLE decision and not a phase
  // hold. With the engine off the state stops changing, so the command stops
  // rotating and the vehicle closes on it; and the vehicle keeps coasting
  // either way, so the next apoapsis brings the insertion round again.
  double maxPointingErrorRad = 15.0 * orbital::kPi / 180.0;

  // How much of the insertion burn is spent BEFORE apoapsis. Half, which is
  // what centres a finite burn on the impulsive instant it approximates
  // (PH-38's lead, and PH-152's third defect is what happens without one).
  double insertionLeadFraction = 0.5;

  // AND HOW FAR EITHER SIDE OF APOAPSIS IT MAY STILL BE BURNING, as an arc.
  //
  // The window CANNOT be the burn's own length alone, and finding that out cost
  // a lander a trip through the middle of the moon. The remaining burn shrinks
  // as it is spent, so a window sized on it closes faster than the burn
  // finishes: measured, the insertion cut out with 14.92 m/s still owed and the
  // periapsis still 2,601 m BELOW the surface, whereupon the vehicle coasted
  // down through Cinder and came back for another go. Three passes, 7,715 s,
  // and 10 km underground at the worst of it.
  //
  // So there is a second term and it is an ANGLE, because efficiency is what
  // the rule is really about: burning `theta` of mean anomaly away from
  // apoapsis loses roughly `1 - cos(theta)`, which at 22.5 degrees is 7.6 per
  // cent. That is a price worth paying to finish a burn and not one worth
  // paying to start one, which is why the two terms ADD rather than replace.
  double insertionArcRad = 22.5 * orbital::kPi / 180.0;
};

enum class Leg : uint8_t {
  Vertical,     // off the pad, clearing the terrain
  Turn,         // the gravity turn, pitched on apoapsis progress
  Coast,        // apoapsis bought; engine off, rising to it
  Circularise,  // the insertion burn
  Orbit,        // done
  Aborted,
};

struct Guidance {
  Leg leg = Leg::Vertical;
  Vec3 sasCommand{0, 1, 0};    // where the nose (and so the engine) must point
  double throttle = 0.0;

  double altitudeAglM = 0.0;   // against the TERRAIN under the vehicle
  double altitudeDatumM = 0.0; // against the body radius, which is what an orbit uses
  double apoapsisAltM = 0.0;   // from the state vector (R14), datum-relative
  double periapsisAltM = 0.0;
  bool hasApoapsis = false;    // false: this arc does not come back down
  double speedMS = 0.0;
  double verticalMS = 0.0;     // + is up
  double pitchFromVerticalRad = 0.0;   // COMMANDED, after the terrain clamp
  double schedulePitchRad = 0.0;       // what the schedule asked for, before it
  double insertionDvMS = 0.0;  // circularising AT APOAPSIS will cost this
  double matchDvMS = 0.0;      // matching a circle HERE, this instant, would cost this
  double eccentricity = 0.0;   // of the arc the vehicle is on, right now
  double timeToApoapsisS = 0.0;
  double timeSinceApoapsisS = 0.0;
  double pointingErrorRad = 0.0;  // nose against `sasCommand`, 0 with no nose given
  const char* note = "";
};

// ONE CALL, NO STATE, and the things it cannot derive are passed in.
//
// `ground` is the surface under the vehicle RIGHT NOW, sampled by the caller
// exactly as `descent::guide` takes it. `bodyRadiusM` is the DATUM, and it is
// separate from `ground.radiusM` because on Cinder the two differ by up to
// three kilometres and an orbit is measured against the first while a crater
// wall is a fact about the second.
//
// `downrangeHint` is the horizontal direction to fly, which physics genuinely
// does not know: a launch picks its orbital plane with its azimuth and only the
// caller knows what plane it wants (R63's second note). It is used only while
// the vehicle is slow; past `kHeadingFromVelocityMS` the ACHIEVED horizontal
// velocity is the heading, because by then the plane is a fact rather than an
// intention and steering off it would be a plane change nobody asked for.
//
// `dtS` is here for one reason and it is the reason `autopilot.h` needs it: the
// final tick of the insertion is throttled PROPORTIONALLY, so the terminal
// error is second order in the step rather than one whole tick of thrust.
const double kHeadingFromVelocityMS = 50.0;

// The angle between a nose and a command, with a zero-length nose reading as
// zero error rather than as a right angle: a caller that does not track
// attitude gets the ungated law, which is what it had before the gate existed.
inline double pointingErrorRad(const Vec3& forwardUnit, const Vec3& command) {
  const double fl = forwardUnit.length(), cl = command.length();
  if (fl < 1e-9 || cl < 1e-9) return 0.0;
  double c = forwardUnit.dot(command) / (fl * cl);
  if (c > 1.0) c = 1.0;
  if (c < -1.0) c = -1.0;
  return std::acos(c);
}

inline Guidance guide(const Vec3& posM, const Vec3& velMS, const Vec3& forwardUnit,
                      const landing::SurfaceFrame& ground,
                      const Vec3& downrangeHint, double muM3S2,
                      double bodyRadiusM, double thrustAccelFull, double dtS,
                      const Profile& p) {
  Guidance g;
  const Vec3 up = ground.upUnit;
  const double r = std::fmax(1.0, posM.length());
  const double gravity = muM3S2 / (r * r);
  const double vUp = velMS.dot(up);
  const Vec3 lateralV = velMS - up * vUp;
  g.verticalMS = vUp;
  g.speedMS = velMS.length();
  g.altitudeAglM = r - ground.radiusM;

  const ArcPeak peak = arcPeak(posM, velMS, muM3S2);
  g.hasApoapsis = peak.comesBackDown;

  g.altitudeDatumM = r - bodyRadiusM;
  const double targetRadiusM = bodyRadiusM + p.targetApoapsisM;
  g.apoapsisAltM = peak.comesBackDown ? peak.apoapsisRadiusM - bodyRadiusM : 0.0;
  g.periapsisAltM = peak.comesBackDown ? peak.periapsisRadiusM - bodyRadiusM : 0.0;
  {
    const double sum = peak.apoapsisRadiusM + peak.periapsisRadiusM;
    g.eccentricity = (peak.comesBackDown && sum > 0.0)
        ? (peak.apoapsisRadiusM - peak.periapsisRadiusM) / sum
        : 1.0;
  }

  // The throttle that holds the commanded thrust-to-weight, re-derived every
  // tick so a draining tank does not let it climb.
  double twrThrottle = 1.0;
  if (thrustAccelFull > 0.0) {
    twrThrottle = p.maxTwr * gravity / thrustAccelFull;
    if (twrThrottle > 1.0) twrThrottle = 1.0;
    if (twrThrottle < 0.0) twrThrottle = 0.0;
  }

  // THE HEADING. Past `kHeadingFromVelocityMS` the achieved horizontal velocity
  // IS the plane; below it the caller's hint is all there is, and on the pad
  // there is no horizontal velocity at all.
  const double latSpeed = lateralV.length();
  Vec3 headingUnit{0, 0, 0};
  if (latSpeed > kHeadingFromVelocityMS) {
    headingUnit = lateralV * (1.0 / latSpeed);
  } else {
    Vec3 h = downrangeHint - up * downrangeHint.dot(up);
    const double hl = h.length();
    if (hl > 1e-9) {
      headingUnit = h * (1.0 / hl);
    } else if (latSpeed > 1e-9) {
      headingUnit = lateralV * (1.0 / latSpeed);
    }
    // else: no usable heading at all, and one is NOT invented. See below.
  }

  // TWO DIFFERENT INSERTION NUMBERS, AND CONFLATING THEM IS WHAT PUT A BURN AT
  // PERIAPSIS.
  //
  // `matchDvMS` is the INSTANTANEOUS velocity match: the target is the
  // horizontal circular velocity AT THIS RADIUS along the heading, so the same
  // expression that adds the missing speed also removes whatever vertical the
  // ascent left behind. A law that only added speed along prograde would raise
  // the periapsis and leave the orbit elliptical by exactly the residual climb.
  // It is what the burn STEERS by, and it is only the right question once the
  // vehicle is at apoapsis.
  //
  // `insertionDvMS` is the MISSION number: what circularising at the apoapsis
  // will cost, from wherever the vehicle is now. It is what the burn is
  // SCHEDULED by, and unlike the instantaneous match it is monotone and it does
  // not collapse to nothing at periapsis.
  //
  // Neither is special-cased to zero on the pad. A vehicle standing still needs
  // the whole surface circular speed, which is what this returns, and a law
  // that reported 0 there would make "already circular" true on the ground.
  const Vec3 vWant = headingUnit * std::sqrt(muM3S2 / r);
  Vec3 dvVec = vWant - velMS;
  // THE TARGET APOAPSIS IS A FLOOR FOR THE INSERTION TOO, AND LEAVING IT OUT
  // MADE THE PROGRAM HUNT.
  //
  // On the way UP to apoapsis the vehicle is still climbing, so the velocity
  // match has a DOWNWARD component: nulling that residual climb is right at
  // apoapsis and premature before it, because it takes the apoapsis with it.
  // Measured: the apoapsis dropped back through the cutoff test, the program
  // returned to the ascent legs fourteen times in one flight, and the command
  // alternating between the two put the worst burning attitude at 27.17 degrees
  // against a 15 degree gate.
  //
  // So while the apoapsis is at or under the target, the insertion may add
  // speed and may push OUT, and it may not pull IN. Past apoapsis the vehicle
  // is descending, the same component points outward, and the full match runs
  // untouched -- which is where an orbit gets circularised anyway.
  if (peak.comesBackDown && peak.apoapsisRadiusM <= targetRadiusM) {
    const double inward = dvVec.dot(up);
    if (inward < 0.0) dvVec = dvVec - up * inward;
  }
  g.matchDvMS = dvVec.length();
  g.insertionDvMS =
      peak.comesBackDown && peak.apoapsisRadiusM > 0.0
          ? std::fmax(0.0, std::sqrt(muM3S2 / peak.apoapsisRadiusM)
                               - peak.speedAtApoapsisMS)
          : g.matchDvMS;

  g.timeToApoapsisS = peak.timeToApoapsisS;

  // ---------------------------------------------------------------------------
  // THE LEGS.
  // ---------------------------------------------------------------------------
  const bool apoapsisBought =
      (!peak.comesBackDown)
      || (peak.apoapsisRadiusM >= targetRadiusM - p.apoapsisBandM);

  if (!apoapsisBought) {
    // STILL BUYING THE ORBIT. This is the only phase that needs to hold itself
    // up, so it is the only phase that refuses a vehicle which cannot.
    if (!(thrustAccelFull > gravity)) {
      g.leg = Leg::Aborted;
      g.note = "aborted: this vehicle cannot lift off here";
      g.sasCommand = up;
      g.throttle = 0.0;
      return g;
    }
    const double frac = (p.targetApoapsisM > 0.0)
        ? std::fmax(0.0, std::fmin(1.0, g.apoapsisAltM / p.targetApoapsisM))
        : 1.0;
    double pitch = 0.5 * orbital::kPi * std::pow(frac, p.turnExponent);
    g.schedulePitchRad = pitch;

    // THE TERRAIN'S VETO. Under `clearanceM` nothing but straight up is
    // allowed; between there and `clearedAtM` the schedule is released
    // linearly. It is a CLAMP and never a command of its own, so over ground
    // that is already far below the schedule is untouched and this whole
    // paragraph is invisible.
    double allowed = 0.5 * orbital::kPi;
    if (g.altitudeAglM <= p.clearanceM) {
      allowed = 0.0;
    } else if (g.altitudeAglM < p.clearedAtM && p.clearedAtM > p.clearanceM) {
      allowed = 0.5 * orbital::kPi * (g.altitudeAglM - p.clearanceM)
                / (p.clearedAtM - p.clearanceM);
    }
    if (pitch > allowed) pitch = allowed;
    // No usable heading: fly straight up rather than pick one. A vertical climb
    // is a legal, if useless, ascent; an invented azimuth is a plane the caller
    // did not ask for.
    if (headingUnit.length() < 1e-9) pitch = 0.0;
    g.pitchFromVerticalRad = pitch;

    g.sasCommand = orbital::normalized(up * std::cos(pitch)
                                       + headingUnit * std::sin(pitch));
    g.throttle = twrThrottle;
    g.leg = (g.altitudeAglM <= p.clearanceM) ? Leg::Vertical : Leg::Turn;
    g.note = (g.leg == Leg::Vertical) ? "climbing clear of the ground"
                                      : "gravity turn on apoapsis progress";
    return g;
  }

  // THE ORBIT IS BOUGHT. From here the engine only ever adds the difference
  // between what the vehicle is doing and a circle, and the first thing it does
  // is check whether that difference is already nothing.
  //
  // BOTH conditions are physical rather than proxies for one: the velocity is a
  // circle's, AND the circle clears the datum. A suborbital arc whose speed
  // happens to match at the top of it fails the second, which is the whole
  // difference between reaching orbit and reaching altitude.
  const Vec3 alongUnit = (headingUnit.length() > 1e-9) ? headingUnit : up;
  if (g.eccentricity <= p.targetEccentricity && peak.comesBackDown
      && peak.periapsisRadiusM > bodyRadiusM) {
    g.leg = Leg::Orbit;
    g.sasCommand = alongUnit;
    g.throttle = 0.0;
    g.note = "in orbit";
    return g;
  }

  // HOW LONG THE INSERTION WILL TAKE, AND IT IS PRICED AT THE ACCELERATION THE
  // PROGRAM WILL ACTUALLY COMMAND, NOT AT FULL THROTTLE.
  //
  // The first version of this line divided by `thrustAccelFull` while the burn
  // is flown at the TWR ceiling, which on the reference lander is a throttle of
  // 0.13. It therefore predicted a 7.4 s burn for one that took 56.6 s, led it
  // by 3.7 s instead of 28, and ran the whole thing PAST apoapsis: the first
  // insertion came out 21306 x 18388 and the program had to coast most of an
  // orbit to trim it. Same shape as PH-158, a plausible number read off the
  // wrong quantity.
  const double aCommanded = thrustAccelFull * twrThrottle;
  const double burnS = (aCommanded > 0.0) ? g.insertionDvMS / aCommanded : 0.0;
  // An escaping arc has no apoapsis to lead, so the lead is zero and the trim
  // starts now. It is reachable (an over-energetic ascent) and it is named.
  const double lead =
      peak.comesBackDown
          ? p.insertionLeadFraction * burnS
                + peak.periodS * p.insertionArcRad / orbital::kTwoPi
          : 1e300;

  // THE BURN IS A WINDOW CENTRED ON APOAPSIS, NOT A START TIME, AND USING ONE
  // FOR THE OTHER FLEW A LANDER THROUGH THE MOON.
  //
  // The first version gated on `timeToApoapsis <= lead` alone. That is the
  // right test for LIGHTING the engine and the wrong one for KEEPING it lit:
  // the instant the vehicle crosses apoapsis, time-to-apoapsis jumps from zero
  // to a whole period, so the burn was cut halfway through EVERY TIME, having
  // spent only its lead. The vehicle then fell back down the ellipse it had not
  // finished raising, and since `flight.h` has no contact model it went STRAIGHT
  // THROUGH CINDER: measured, 9,364 m below the datum at t = 1614 s, and the
  // "orbit" was only reached after three subsurface passes over 7,715 s.
  //
  // So the test is on the distance to apoapsis in EITHER direction, which is
  // one more read of the same Kepler solve. The window is `burnS` wide and
  // shrinks with the remaining delta-v, so it closes exactly when the burn is
  // done rather than at a time somebody picked.
  const double toApo = g.timeToApoapsisS;
  const double sinceApo = peak.comesBackDown ? peak.timeSinceApoapsisS : 1e300;
  g.timeSinceApoapsisS = sinceApo;
  if (std::fmin(toApo, sinceApo) > lead) {
    g.leg = Leg::Coast;
    // POINTED AT THE BURN BEFORE IT STARTS (PH-152's third defect), and the
    // direction is `alongUnit` rather than the instantaneous match, because at
    // apoapsis the insertion IS purely prograde-horizontal and the match vector
    // a quarter of an orbit early points somewhere the burn never will.
    g.sasCommand = alongUnit;
    g.throttle = 0.0;
    g.note = "coasting to apoapsis, pointed at the insertion";
    return g;
  }

  g.leg = Leg::Circularise;
  g.sasCommand = (g.matchDvMS > 1e-9) ? orbital::normalized(dvVec) : alongUnit;
  // THE PROPORTIONAL LAST TICK. Without it a burn that needs 0.2 m/s more gets
  // a whole tick of thrust and passes "close enough" on the far side, every
  // tick, for ever. With it, the terminal error is what one tick of the
  // REMAINDER costs rather than one tick of the ENGINE.
  double th = twrThrottle;
  if (thrustAccelFull > 0.0 && dtS > 0.0) {
    const double proportional = g.matchDvMS / (thrustAccelFull * dtS);
    if (proportional < th) th = proportional;
  }
  if (th < 0.0) th = 0.0;
  if (th > 1.0) th = 1.0;
  // ATTITUDE FIRST, THROTTLE SECOND. Measured before this existed: the vehicle
  // burned through 151 degrees of command swing on a stale nose.
  g.pointingErrorRad = pointingErrorRad(forwardUnit, g.sasCommand);
  if (g.pointingErrorRad > p.maxPointingErrorRad) {
    g.throttle = 0.0;
    g.note = "holding: the nose is not on the insertion yet";
    return g;
  }
  g.throttle = th;
  g.note = "insertion burn";
  return g;
}

}  // namespace ascent
}  // namespace of
