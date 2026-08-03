#pragma once
// =============================================================================
// of::autopilot - FLYING THE PLAN (PH-150).
//
// Everything else in this stack is a pure function. This is the one header that
// COMMANDS a vehicle, and it is deliberately the last one written, because the
// rule it exists to honour is Admin's:
//
//   AUTOPILOT FLIES THE PLAN THE SOLVER PRODUCED. IT DOES NOT RE-DERIVE IT IN
//   FLIGHT.
//
// A `Program` is built ONCE from `transfer.h` / `orbital.h` and then executed.
// Nothing in `update()` solves an orbit, fits a conic or calls Lambert. If the
// plan was wrong, the flight is wrong and the instruments say so, which is a
// better failure than an autopilot that quietly re-plans every tick and can
// therefore never be compared against anything.
//
// WHAT IS CLOSED-LOOP, AND WHY THAT IS NOT A CONTRADICTION. A burn is cut on
// MEASURED delta-v, not on a stopwatch. An impulsive plan says "spend 90.59 m/s
// prograde"; a real engine spends it over 5.5 s at a mass that is falling, and
// `estimateBurn`'s duration is a prediction rather than a promise. Terminating
// on the clock would bank the prediction's error into the orbit. Terminating on
// the integral of what the engine actually delivered is executing THE SAME PLAN
// more accurately, which is the opposite of re-deriving it.
//
// THREE THINGS IT REFUSES TO DO, each of which is how an autopilot loses a
// vehicle:
//   * it will not burn while mis-pointed. Attitude first, throttle second, and
//     if the vehicle cannot get its nose round in time the burn is LATE rather
//     than sideways;
//   * it will not command a burn it cannot pay for. The program is checked
//     against `remainingDeltaVVacuumMS` when it is built and again when each
//     burn starts, because a staging between the two changes the answer;
//   * it will not throttle past the target on the last tick. The final tick is
//     throttled proportionally, so the terminal error is second order in dt
//     rather than a whole tick of thrust.
//
// WHERE IT RUNS. `flight::FlightSim::step` lives inside the browser's
// `VesselObserver::step`, so a promoted vessel with nobody aboard does not
// advance (measured, PH-111). An autopilot therefore flies a vessel the player
// is aboard or following, and a parked vessel stays nine numbers and a clock.
// This header does not fight that: it is a per-tick function of a FlightSim, so
// it runs exactly when the vessel runs and not otherwise.
//
// Sections:
//   §1  the program: a schedule of impulses
//   §2  the executor
//   §3  the builders: hold-this-orbit, and a transfer
// =============================================================================
#include <cmath>

#include "of/flight.h"
#include "of/maneuver.h"
#include "of/orbital.h"
#include "of/transfer.h"
#include "of/vessel.h"

namespace of {
namespace autopilot {

// =============================================================================
// §1 - the program.
// =============================================================================

// WHICH FRAME A BURN'S VECTOR LIVES IN (PH-159).
//
// A trip to a moon crosses a sphere-of-influence boundary, and past it the
// vessel is on a conic about a DIFFERENT body. The capture burn cannot be
// expressed in the departure frame at all: it is retrograde relative to
// Cinder, and Cinder is itself doing 1.7 km/s round Forge.
//
// This looks like the exception to "the executor does not re-derive in flight"
// and it is not, because the crossing time and the arrival hyperbola are both
// PREDICTABLE from the departure state. The solver produces both burns up
// front and tags each with the frame it lives in; the executor flies each one
// in its own frame. Nothing is re-derived. The plan simply has two frames.
enum class BurnFrame : uint8_t {
  Primary = 0,   // the body the program was planned around
  Target = 1,    // the destination body's own frame, after the SOI handoff
};

// One scheduled impulse.
struct Burn {
  double nodeTimeS = 0.0;    // when the IMPULSE is centred (absolute sim time)
  Vec3 deltaV{0, 0, 0};      // inertial, IN `frame`
  double deltaVMS = 0.0;
  double durationS = 0.0;    // predicted, from estimateBurn at the mass it has
  double leadS = 0.0;        // half of it: light the engine this early
  BurnFrame frame = BurnFrame::Primary;

  // Light the engine here, so the impulse straddles the node. `leadS` is
  // maneuver.h's own half-duration and is not halved a second time here.
  double ignitionS() const { return nodeTimeS - leadS; }
};

enum class Mode : uint8_t { Off, HoldOrbit, Transfer };

enum class Phase : uint8_t {
  Idle,     // no program
  Coast,    // waiting for the orientation window
  Orient,   // pointing, engine off
  Burn,     // burning
  Done,     // every burn flown
  Aborted,  // it refused; `note` says why
};

struct Program {
  static const int kMaxBurns = 4;
  Mode mode = Mode::Off;
  Burn burns[kMaxBurns];
  int burnCount = 0;
  double targetRadiusM = 0.0;   // HoldOrbit's requested circular radius
  double totalDvMS = 0.0;
  bool valid = false;
  const char* note = "";

  // THE SOI HANDOFF, when the program crosses into a body's sphere of
  // influence. Everything an executor needs to switch frames at the right
  // instant, published by the SOLVER rather than discovered in flight.
  bool crossesSoi = false;
  double soiEntryS = 0.0;          // absolute sim time of the handoff
  double targetMuM3S2 = 0.0;       // the body it hands off TO
  double targetSoiRadiusM = 0.0;
  double captureRadiusM = 0.0;     // the circular orbit the capture produces
  int targetBodyId = -1;           // which body the handoff is TO, -1 for none
  Vec3 aimPointM{0, 0, 0};         // what the transfer was aimed at
  double arriveS = 0.0;            // when it was aimed to get there

  // A CORRECTION SLOT, RESERVED AT PLAN TIME AND FILLED AT EXECUTION TIME.
  // A moon transfer needs a mid-course correction (PH-159: 468 km of error at
  // the sphere of influence against a 543 km aim offset), and its delta-v
  // cannot be known when the plan is made, because it corrects for what the
  // burn ACTUALLY did. So the plan reserves the burn and says when it happens;
  // the executor computes its vector once, from the state the injection really
  // produced. That is the same sanctioned category as the capture re-plan: not
  // re-deriving the mission, but measuring what the world did to it.
  int correctionIndex = -1;        // which burn is the reserved correction
};

struct Command {
  flight::SasMode sas = flight::SasMode::Off;
  Vec3 sasCommand{0, 1, 0};
  double throttle = 0.0;
};

struct Status {
  Phase phase = Phase::Idle;
  int burnIndex = 0;
  double timeToIgnitionS = 0.0;
  double dvSpentThisBurnMS = 0.0;
  double dvSpentTotalMS = 0.0;
  double pointingErrorDeg = 180.0;
  double rateDegS = 0.0;
  bool burningNow = false;
  const char* note = "";
};

// How close the nose has to be before the engine is allowed to light. 2 degrees
// costs cos(2 deg) = 0.06% of the burn along the intended axis and leaves 3.5%
// of it across, which a later trim absorbs. The stability-assist tracking error
// under load was MEASURED at 4.35 degrees during the reference ascent, so this
// is a gate the vehicle can actually pass in vacuum and cannot pass in a
// tumble, which is the distinction it is for.
const double kPointingGateDeg = 2.0;

// AND THE NOSE MUST BE STILL, NOT MERELY IN THE RIGHT PLACE. Gating on the
// angle alone lights the engine at the instant a slewing vehicle SWEEPS THROUGH
// the target, and it then carries on rotating under thrust. Measured on the
// orbit-lowering case, which starts prograde and has to flip 180 degrees: with
// an angle-only gate the worst attitude reached with the engine lit was 3.92
// degrees, nearly twice the gate it had supposedly passed. Requiring the rate
// to be down as well is what makes the gate mean what it says.
//
// 0.5 deg/s over a 5 s burn is 2.5 degrees of drift if nothing damped it, and
// the rate term damps it hard once the proportional term is inside the
// deadband, so this is a bound rather than an estimate.
const double kRateGateDegS = 0.5;

// AND IT WAS PROPOSED THAT THIS GATE BE RE-EXPRESSED AS A DRIFT, AND MEASURED,
// AND REFUSED (PH-166). The refusal is recorded because the argument for the
// change is a good one and only a measurement defeats it.
//
// The argument: the sentence above justifies 0.5 deg/s entirely by "over a 5 s
// burn that is 2.5 degrees", so the quantity actually being bounded is the
// ATTITUDE the residual rate adds while the engine is lit, and a bare rate is
// a proxy for it calibrated at exactly one burn length. This executor flies
// 5.5 s (a hold-orbit circularisation), 12.7 s (a lunar capture) and 47.2 s
// (a lunar injection), so on paper the proxy is nine times too loose at the
// long end: 0.4994 deg/s should add 23.6 degrees over the injection.
//
// IT ADDS 0.3548 DEGREES. The premise "if nothing damped it" is false, and it
// is false by construction rather than by luck: the SAS rate term keeps
// running while the engine burns, so the drift is a CLOSED-LOOP quantity and
// the open-loop bound overstates it by a factor of 66.
//
// The two flights side by side, same mission, only the gate changed:
//   gate 0.5 deg/s     rate at ignition 0.4994   worst attitude lit 0.3548 deg
//   gate 2.5/47.178    rate at ignition 0.0529   worst attitude lit 0.0716 deg
// and the tightening COSTS: waiting for a rate 9.4x lower is 2.24 e-foldings
// at kd = 3, so ignition goes 1.166 s late, and a late burn is exactly what
// PH-38's lead exists to prevent. Measured, that moved the flown capture orbit
// from 270141.1 m to 271020.9 m, 880 m, and moved the mid-course correction
// from 33.330 to 35.215 m/s. It bought 0.28 degrees of attitude that no
// assertion in this project was close to failing on.
//
// So the gate stays a bare rate, and what gets written down instead of a new
// constant is the DEPENDENCY that makes it adequate: 0.5 deg/s is safe at any
// burn length only because stability assist stays active under thrust. If a
// future change ever gates SAS on the throttle, this gate becomes the
// open-loop one its own comment describes and 23.6 degrees becomes real.

// HOW LONG THE EXECUTOR WILL WAIT FOR A CONDITION THAT MAY NEVER ARRIVE.
//
// R71, and the gameplay lane's stuck burn, are ONE BUG WITH TWO FACES: the
// executor holds on a condition, and holding is only correct while the
// condition can still arrive. When it cannot, holding is a hang, and a hang in
// a player's hands is worse than a refusal because nothing on screen says so.
//
// This is deliberately a PROGRESS test and not a deadline. A deadline would
// abort a big, low-authority vehicle that is slewing correctly but slowly,
// which is a real vehicle a player can build. Progress cannot: a converging
// controller keeps improving its own worst-case distance from the gate, and a
// limit cycle, a dead reaction wheel or an empty monopropellant tank does not.
// 60 s is `kOrientLeadS`: the burn was given that long to point before it was
// due, and a further lead's worth of overdue with NO improvement at all is not
// a slow vehicle, it is a stuck one.
const double kNoProgressS = 60.0;

// How early to start pointing. A burn that has to slew 180 degrees needs time;
// starting the slew 60 s out and holding costs nothing on a coast.
const double kOrientLeadS = 60.0;

// =============================================================================
// §2 - the executor.
// =============================================================================
class Autopilot {
 public:
  Program program;
  Status status;

  // Re-arm at a chosen burn, keeping the delta-v already spent on the record.
  // Used by the SOI handoff, which replaces burn 1 after burn 0 has been flown
  // and must not rewind the programme to the start.
  void armFrom(const Program& p, int startBurn) {
    // The delta-v already spent and the stagings already made are FACTS ABOUT
    // THE FLIGHT and survive a re-arm; the plan is what is being replaced.
    const double spent = dvAll_;
    const int staged = stagings_;
    arm(p);
    burnIndex_ = startBurn;
    status.burnIndex = startBurn;
    dvAll_ = spent;
    status.dvSpentTotalMS = spent;
    stagings_ = staged;
  }

  void arm(const Program& p) {
    program = p;
    status = Status();
    status.phase = p.valid ? Phase::Coast : Phase::Aborted;
    status.note = p.valid ? "armed" : p.note;
    burnIndex_ = 0;
    dvThis_ = 0.0;
    dvAll_ = 0.0;
    lastThrottle_ = 0.0;
    stagings_ = 0;
    bestGap_ = 1e300;
    bestGapAtS_ = 0.0;
  }

  void disarm() {
    program = Program();
    status = Status();
    lastThrottle_ = 0.0;
    stagings_ = 0;
    bestGap_ = 1e300;
    bestGapAtS_ = 0.0;
  }

  bool running() const {
    return status.phase == Phase::Coast || status.phase == Phase::Orient
           || status.phase == Phase::Burn;
  }

  // ONE TICK. Call it BEFORE `FlightSim::step(dt)` and apply the Command to the
  // sim; `dt` must be the same dt that step will use.
  //
  // It is a const read of the sim plus its own small state, so it can be called
  // on a vessel it does not own and cannot corrupt one by being called twice.
  Command update(flight::FlightSim& sim, double dt) {
    Command c;
    // Bank what the ENGINE ACTUALLY DELIVERED since the last tick, before
    // anything else looks at the totals. Thrust and mass both come from the
    // same functions `FlightSim::step` uses, so this is a measurement of that
    // step rather than a second model of it.
    if (lastThrottle_ > 0.0) {
      const double a = thrustAccel(sim, lastThrottle_);
      dvThis_ += a * dt;
      dvAll_ += a * dt;
    }
    lastThrottle_ = 0.0;
    status.dvSpentThisBurnMS = dvThis_;
    status.dvSpentTotalMS = dvAll_;
    status.burnIndex = burnIndex_;
    status.burningNow = false;

    if (!running()) return c;
    if (burnIndex_ >= program.burnCount) {
      status.phase = Phase::Done;
      status.note = "program complete";
      return c;
    }

    const Burn& b = program.burns[burnIndex_];
    const double now = sim.state.timeS;
    status.timeToIgnitionS = b.ignitionS() - now;

    // A RESERVED BURN THAT WAS NEVER FILLED IN IS SKIPPED, not pointed at.
    // `normalized` of a zero vector is a zero vector, so a correction slot the
    // executor never got round to computing would otherwise command the SAS to
    // aim at nothing and hold there for ever. Skipping is the safe failure:
    // the vehicle flies the uncorrected trajectory, which is wrong in a way
    // that is visible, rather than stopping dead in a way that is not.
    if (b.deltaVMS <= 0.0) {
      ++burnIndex_;
      dvThis_ = 0.0;
      if (burnIndex_ >= program.burnCount) {
        status.phase = Phase::Done;
        status.note = "program complete";
      } else {
        status.phase = Phase::Coast;
        status.note = "skipped an empty burn";
      }
      return c;
    }

    // Point at the burn, always: there is no phase in which a different
    // attitude is wanted, and holding it early costs nothing.
    const Vec3 want = orbital::normalized(b.deltaV);
    c.sas = flight::SasMode::Command;
    c.sasCommand = want;
    const Vec3 nose = orbital::normalized(sim.state.forward);
    double cosErr = nose.dot(want);
    if (cosErr > 1.0) cosErr = 1.0;
    if (cosErr < -1.0) cosErr = -1.0;
    status.pointingErrorDeg = std::acos(cosErr) * 180.0 / orbital::kPi;

    if (status.phase == Phase::Coast) {
      if (status.timeToIgnitionS <= kOrientLeadS) {
        status.phase = Phase::Orient;
        status.note = "slewing to the burn attitude";
        bestGap_ = 1e300;
        bestGapAtS_ = now;
      }
      return c;
    }

    if (status.phase == Phase::Orient) {
      if (now < b.ignitionS()) return c;
      // Ignition time has arrived. THE NOSE DECIDES, NOT THE CLOCK, and the
      // nose has to be STILL as well as aimed: igniting as a slewing vehicle
      // sweeps through the target just moves the error into the burn.
      status.rateDegS = sim.state.angVelRadS.length() * 180.0 / orbital::kPi;
      const bool aimed = status.pointingErrorDeg <= kPointingGateDeg;
      const bool still = status.rateDegS <= kRateGateDegS;
      if (!aimed || !still) {
        // THE PROGRESS TEST. `gap` is how far the worse of the two gated
        // quantities is from its own threshold, normalised so that 1.0 IS the
        // threshold and the two are comparable. A vehicle that is converging
        // keeps setting a new best; one that cannot pass stops.
        const double gap = std::fmax(status.pointingErrorDeg / kPointingGateDeg,
                                     status.rateDegS / kRateGateDegS);
        if (gap < bestGap_ * (1.0 - 1e-9)) {
          bestGap_ = gap;
          bestGapAtS_ = now;
        } else if (now - bestGapAtS_ > kNoProgressS) {
          status.phase = Phase::Aborted;
          status.note = aimed
              ? "aborted: the vehicle will not stop turning, so the burn cannot start"
              : "aborted: the vehicle will not point at the burn";
          return c;
        }
        status.note = aimed ? "holding: still swinging through the target"
                            : "holding: not pointed yet, the burn will be late";
        return c;
      }
      // And it will not start a burn it cannot pay for. A staging since the
      // program was built can have changed this answer.
      if (vessel::remainingDeltaVVacuumMS(sim.craft) + 1e-9 < b.deltaVMS - dvThis_) {
        status.phase = Phase::Aborted;
        status.note = "aborted: not enough delta-v left for this burn";
        return c;
      }
      status.phase = Phase::Burn;
      status.note = "burning";
    }

    if (status.phase == Phase::Burn) {
      const double left = b.deltaVMS - dvThis_;
      if (left <= 0.0) {
        // This burn is done. Bank it and move on.
        ++burnIndex_;
        dvThis_ = 0.0;
        if (burnIndex_ >= program.burnCount) {
          status.phase = Phase::Done;
          status.note = "program complete";
        } else {
          status.phase = Phase::Coast;
          status.note = "coasting to the next burn";
        }
        return c;
      }
      // A burn that drifts off axis is stopped rather than continued: past
      // about 15 degrees the cross-track it is adding costs more than the
      // along-track it is buying.
      if (status.pointingErrorDeg > 15.0) {
        status.note = "throttled back: attitude lost";
        return c;
      }
      // A COMMANDED BURN THAT PRODUCES NO THRUST USED TO RUN FOR EVER (PH-167).
      //
      // Measured from the client by the gameplay lane: 900 polls at full
      // throttle, 0.0000 m/s spent, the orbit unmoved, and every status field
      // reporting healthy. This is R71's shape with a different quantity, and
      // the cause is that the executor had NO VERB FOR STAGING while the
      // PLANNER prices every program against `remainingDeltaVVacuumMS`, which
      // sums across stages. The plan therefore assumes a staging the executor
      // could not perform, and a burn cut on measured delta-v then waits on a
      // number that can never move.
      //
      // Cutting on measured delta-v is NOT the thing to revert (PH-150 pinned
      // it by sabotaging the predicted duration 40% both ways). The gap is the
      // missing verb, so here it is: when the engine is commanded on and the
      // vehicle produces no thrust at all, press the button a player would
      // press. It cannot loop, because `fireStage` runs out and then this
      // aborts by name instead of holding.
      const double aFull = thrustAccel(sim, 1.0);
      if (!(aFull > 0.0)) {
        const vessel::StageResult sr = sim.stage();
        if (sr.fired) {
          ++stagings_;
          status.note = "staged: the burning stage was dry";
          return c;
        }
        status.phase = Phase::Aborted;
        status.note = "aborted: the engine is commanded on and produces no thrust";
        return c;
      }
      double th = 1.0;
      if (aFull * dt > left && aFull * dt > 0.0) th = left / (aFull * dt);
      if (th < 0.0) th = 0.0;
      if (th > 1.0) th = 1.0;
      c.throttle = th;
      lastThrottle_ = th;
      status.burningNow = th > 0.0;
    }
    return c;
  }

  // Apply a Command to a sim. One place, so a caller cannot wire the throttle
  // and forget the attitude.
  static void apply(flight::FlightSim& sim, const Command& c) {
    sim.sas = c.sas;
    sim.sasCommand = c.sasCommand;
    sim.state.throttle = c.throttle;
  }

  // How many times the executor pressed the staging button for itself. A screen
  // that says "it staged" is telling the truth about something the player did
  // not do, so it is counted rather than only mentioned in a note that the next
  // tick overwrites.
  int stagings() const { return stagings_; }

 private:
  int burnIndex_ = 0;
  double dvThis_ = 0.0;
  double dvAll_ = 0.0;
  double lastThrottle_ = 0.0;
  int stagings_ = 0;
  // The progress test's memory: the best (lowest) normalised distance from the
  // ignition gate seen since this Orient began, and when it was last improved.
  double bestGap_ = 1e300;
  double bestGapAtS_ = 0.0;

  // Thrust acceleration at a throttle setting, through the SAME
  // `evaluatePropulsion` and `massProperties` the integrator uses.
  static double thrustAccel(flight::FlightSim& sim, double throttle) {
    sim.craft.layout();
    const vessel::MassProperties mp = vessel::massProperties(sim.craft);
    const double alt = sim.state.altitudeM(sim.env.bodyRadiusM);
    const double pr = atmo::pressureRatio(sim.env.air, alt);
    const flight::PropulsionOutput p =
        flight::evaluatePropulsion(sim.craft, throttle, pr);
    const double m = std::fmax(1.0, mp.totalKg);
    return p.thrustN / m;
  }
};

// =============================================================================
// §3 - the builders.
// =============================================================================

// The tangential direction at a state, in its own orbital plane and in the
// direction it is already going. `(r x v) x r` is `r^2 v - r (r.v)`, which is
// the component of v perpendicular to r, so this is prograde by construction
// and needs no axis and no sign convention (PH-40's rule again).
inline Vec3 tangentialAt(const orbital::StateVector& s) {
  const Vec3 h = orbital::cross(s.r, s.v);
  return orbital::normalized(orbital::cross(h, s.r));
}

// HOLD THIS ORBIT. Reid's fifth ask and the smallest closed loop in the whole
// feature: no target, no phase, no window, just "put me on a circular orbit at
// this radius". Two burns, which is the Hohmann every player flies by hand.
//
//   1. at the current point, set the velocity to the transfer ellipse's, which
//      raises (or lowers) the OPPOSITE apsis to the requested radius. Taking
//      the whole vector rather than a tangential magnitude means an eccentric
//      or off-tangential starting orbit is circularised by the same burn
//      instead of needing a third;
//   2. coast half the transfer period;
//   3. circularise there.
//
// The arrival state is PROPAGATED with the real propagator rather than assumed,
// so burn 2's direction is where the vehicle will actually be and not where a
// circular approximation says it should be.
// `slewAllowanceS` IS NOT PADDING AND THE DEFAULT IS NOT A ROUND NUMBER.
//
// A program that schedules its first burn for RIGHT NOW cannot be flown by a
// vehicle that is not already pointed at it, and the second burn of every
// hold-orbit is retrograde relative to the first, so "not already pointed"
// is the normal case rather than the awkward one. Measured: with the burn at
// t = 0 the vehicle spent the whole ignition window slewing, the rate gate
// held it, the burn went LATE rather than centred, and the eccentricity it
// left behind was 6x worse (0.001862 against 0.000305) even though the
// pointing was 12x better. Improving the attitude gate without giving the plan
// time to use it just moved the error.
//
// So the plan starts by PROPAGATING to where the vehicle will be once it has
// had time to turn, and is computed from there. The whole thing stays a single
// forward solve; nothing is re-derived in flight.
inline Program holdOrbit(const orbital::StateVector& atCall, double callS,
                         double mu, double targetRadiusM,
                         const vessel::Vessel& craft,
                         double slewAllowanceS = kOrientLeadS) {
  Program p;
  p.mode = Mode::HoldOrbit;
  p.targetRadiusM = targetRadiusM;
  if (!(mu > 0.0) || !(atCall.r.length() > 0.0) || !(targetRadiusM > 0.0)) {
    p.note = "degenerate orbit request";
    return p;
  }
  if (slewAllowanceS < 0.0) slewAllowanceS = 0.0;
  const double nowS = callS + slewAllowanceS;
  const orbital::StateVector now =
      (slewAllowanceS > 0.0) ? orbital::propagate(atCall, slewAllowanceS, mu)
                             : atCall;
  const double rNow = now.r.length();
  if (std::fabs(targetRadiusM - rNow) < 1.0) {
    p.note = "already there";
    p.valid = true;      // a program with no burns is a valid answer
    return p;
  }

  const double aT = 0.5 * (rNow + targetRadiusM);
  const double vT = std::sqrt(mu * (2.0 / rNow - 1.0 / aT));
  const Vec3 tHat = tangentialAt(now);
  const Vec3 v1 = tHat * vT;

  p.burns[0].nodeTimeS = nowS;
  p.burns[0].deltaV = v1 - now.v;
  p.burns[0].deltaVMS = p.burns[0].deltaV.length();

  const double coastS = orbital::kPi * std::sqrt(aT * aT * aT / mu);
  const orbital::StateVector atArrival =
      orbital::propagate(orbital::StateVector{now.r, v1}, coastS, mu);
  const double rArr = atArrival.r.length();
  const Vec3 v2 = tangentialAt(atArrival) * std::sqrt(mu / rArr);

  p.burns[1].nodeTimeS = nowS + coastS;
  p.burns[1].deltaV = v2 - atArrival.v;
  p.burns[1].deltaVMS = p.burns[1].deltaV.length();
  p.burnCount = 2;
  p.totalDvMS = p.burns[0].deltaVMS + p.burns[1].deltaVMS;

  // Durations are CUMULATIVE through estimateBurn, because the second burn
  // happens at the mass the first one left behind. Pricing it on its own would
  // use the pre-burn mass and come out short.
  const maneuver::BurnEstimate e1 = maneuver::estimateBurn(craft, p.burns[0].deltaVMS);
  const maneuver::BurnEstimate eAll = maneuver::estimateBurn(craft, p.totalDvMS);
  p.burns[0].durationS = e1.durationS;
  p.burns[0].leadS = 0.5 * e1.durationS;
  p.burns[1].durationS = std::fmax(0.0, eAll.durationS - e1.durationS);
  p.burns[1].leadS = 0.5 * p.burns[1].durationS;

  if (!eAll.feasible) {
    p.note = "not enough delta-v aboard for this orbit";
    return p;
  }
  p.valid = true;
  p.note = "hold orbit";
  return p;
}

// A TRANSFER, EXECUTED. Built from a `transfer::Transfer` the solver already
// produced rather than from anything computed here: burn one is its injection,
// burn two is its arrival.
//
// THE GUARD IS DOWN (PH-159). This used to take a bare `arrivalIsMatch` bool
// and a body target simply got a one-burn program, because `transfer.h` will
// not publish an arrival VECTOR for a capture and there was nowhere to put a
// burn in another frame. That was a categorical refusal standing in for work.
// It now does the work: for a body it finds the SOI entry, plans the capture at
// the arrival hyperbola's own periapsis, and tags that burn `BurnFrame::Target`.
//
// AND IT REFUSES FOR A REASON RATHER THAN CATEGORICALLY. There are three
// distinct ways a body transfer has no capture, and a caller that could not
// tell them apart would show the same message for a trajectory that misses the
// moon entirely and one that hits it:
//   * the trajectory never enters the sphere of influence;
//   * it enters, and the arrival conic hits the surface;
//   * it enters cleanly but the vehicle cannot pay for the capture.
// Each sets `note` to its own sentence and leaves `valid` false.
inline Program flyTransfer(const transfer::Transfer& tr,
                           const orbital::Elements& shipEl,
                           const transfer::Target& tgt,
                           const vessel::Vessel& craft) {
  Program p;
  p.mode = Mode::Transfer;
  if (!tr.valid) {
    p.note = "no transfer to fly";
    return p;
  }
  p.burns[0].nodeTimeS = tr.departS;
  p.burns[0].deltaV = tr.departDv;
  p.burns[0].deltaVMS = tr.departDvMS;
  p.burns[0].frame = BurnFrame::Primary;
  p.burnCount = 1;
  p.totalDvMS = tr.departDvMS;

  if (!tgt.isBody()) {
    // A VESSEL: the arrival is a velocity match, in the same frame.
    if (tr.arriveDvMS > 0.0) {
      p.burns[1].nodeTimeS = tr.arriveS;
      p.burns[1].deltaV = tr.arriveDv;
      p.burns[1].deltaVMS = tr.arriveDvMS;
      p.burns[1].frame = BurnFrame::Primary;
      p.burnCount = 2;
      p.totalDvMS += tr.arriveDvMS;
    }
  } else if (tgt.captureAltitudeM > 0.0 || tgt.bodyRadiusM > 0.0) {
    // A BODY: find the handoff, then plan the capture inside its frame.
    //
    // The conic searched is the POST-INJECTION one, `transferStart`, because
    // that is the trajectory the vehicle will actually be on. Searching the
    // pre-burn orbit would find a crossing that never happens.
    const orbital::Elements after =
        orbital::park(tr.transferStart, shipEl.mu, tr.departS);
    // The window runs a little past the planned arrival, because the SOI is
    // entered BEFORE the point the Lambert solve aimed at: the sphere has a
    // radius and the aim point is its centre.
    const double window = (tr.arriveS - tr.departS) * 1.25 + 600.0;
    const transfer::SoiCrossing x =
        transfer::findSoiEntry(after, tgt, tr.departS, tr.departS + window);
    if (!x.found) {
      p.note = x.note;                       // names WHICH way it failed
      return p;
    }
    const transfer::CaptureBurn cap = transfer::planCapture(x, tgt);
    if (!cap.valid) {
      p.note = cap.note;
      return p;
    }
    p.crossesSoi = true;
    p.soiEntryS = x.timeS;
    p.targetMuM3S2 = tgt.muM3S2;
    p.targetSoiRadiusM = tgt.soiRadiusM;
    p.captureRadiusM = cap.circularRadiusM;
    p.aimPointM = tr.aimPointM;
    p.arriveS = tr.arriveS;

    // RESERVE THE MID-COURSE CORRECTION. Its delta-v CANNOT be known now: it
    // corrects for what the injection actually did, and the injection has not
    // happened. So the plan says WHEN and the executor says HOW MUCH, which is
    // measurement rather than re-derivation (PH-159: without one, 468 km of
    // error at the sphere of influence against a 543 km aim offset, and a
    // planned 250 km capture becomes a 14 km deep hole in the ground).
    //
    // A third of the way is early enough to be cheap and late enough that the
    // error it is correcting has fully expressed itself.
    p.burns[1] = Burn();
    p.burns[1].nodeTimeS = tr.departS + 0.35 * (tr.arriveS - tr.departS);
    p.burns[1].frame = BurnFrame::Primary;
    p.correctionIndex = 1;

    p.burns[2].nodeTimeS = cap.timeS;
    p.burns[2].deltaV = cap.deltaV;
    p.burns[2].deltaVMS = cap.deltaVMS;
    p.burns[2].frame = BurnFrame::Target;    // Cinder's frame, not Forge's
    p.burnCount = 3;
    p.totalDvMS += cap.deltaVMS;
  }

  const maneuver::BurnEstimate e1 = maneuver::estimateBurn(craft, p.burns[0].deltaVMS);
  const maneuver::BurnEstimate eAll = maneuver::estimateBurn(craft, p.totalDvMS);
  p.burns[0].durationS = e1.durationS;
  p.burns[0].leadS = 0.5 * e1.durationS;
  if (p.burnCount > 1) {
    p.burns[1].durationS = std::fmax(0.0, eAll.durationS - e1.durationS);
    p.burns[1].leadS = 0.5 * p.burns[1].durationS;
  }
  if (!eAll.feasible) {
    p.note = "not enough delta-v aboard for this transfer";
    return p;
  }
  p.valid = true;
  p.note = "transfer";
  return p;
}

// A MID-COURSE CORRECTION, AND THE MEASUREMENT THAT MAKES IT COMPULSORY.
//
// A moon transfer CANNOT BE FLOWN OPEN-LOOP, and the numbers say why rather
// than a rule of thumb. The injection to Cinder is 861 m/s, which is a long
// burn, and an impulsive plan's finite-burn residue over a 7.4 hour coast comes
// out at 468 km of position error at the sphere of influence. The aim offset
// that keeps the vehicle out of the moon is itself only 543 km, so the error is
// the same size as the thing it is perturbing: MEASURED, the flown arrival
// hyperbola has a periapsis of 185669 m against a body radius of 200000 m. The
// planned 250 km capture orbit is a 14 km deep hole in the ground.
//
// This is not a defect in the solver and it is not slack in the executor. It is
// the reason every real interplanetary mission budgets trajectory correction
// manoeuvres, and it is R66 arriving at a scale where it stops being a residue
// and starts being the mission.
//
// The correction is one Lambert from WHERE THE VEHICLE ACTUALLY IS to the aim
// point it was always going to, in the time that is left. It is small, it is
// early enough to be cheap, and it uses the same solver the mission was planned
// with rather than a second opinion about the same trajectory.
inline Burn midCourseCorrection(const orbital::StateVector& actual, double nowS,
                                const Vec3& aimPointM, double arriveS, double mu,
                                const vessel::Vessel& craft) {
  Burn b;
  b.nodeTimeS = nowS;
  b.frame = BurnFrame::Primary;
  const double tof = arriveS - nowS;
  if (!(tof > 0.0) || !(mu > 0.0)) return b;
  const Vec3 h = orbital::cross(actual.r, actual.v);
  const orbital::LambertSolution L =
      orbital::lambert(actual.r, aimPointM, tof, mu, h);
  if (!L.valid) return b;
  b.deltaV = L.v1 - actual.v;
  b.deltaVMS = b.deltaV.length();
  const maneuver::BurnEstimate e = maneuver::estimateBurn(craft, b.deltaVMS);
  b.durationS = e.durationS;
  b.leadS = 0.5 * e.durationS;
  return b;
}

// Put a burn into a program at `at`, shuffling the rest along. Returns false if
// there is no room, which is a refusal rather than a silent drop.
inline bool insertBurn(Program& p, int at, const Burn& b) {
  if (at < 0 || at > p.burnCount || p.burnCount >= Program::kMaxBurns) return false;
  for (int i = p.burnCount; i > at; --i) p.burns[i] = p.burns[i - 1];
  p.burns[at] = b;
  ++p.burnCount;
  p.totalDvMS += b.deltaVMS;
  return true;
}

// FILL THE RESERVED CORRECTION FROM WHERE THE VEHICLE ACTUALLY IS.
//
// Called once, after the injection has been flown, while there is still most of
// the coast left. It is the second half of the slot `flyTransfer` reserved: the
// plan said when, this says how much, and the how-much is a measurement of what
// the injection really did rather than a second opinion about what it should
// have done. The Lambert is the same solver the mission was planned with.
inline bool fillCorrection(Autopilot& pilot, const orbital::StateVector& actual,
                           double nowS, double mu, const vessel::Vessel& craft) {
  Program p = pilot.program;
  const int i = p.correctionIndex;
  if (i < 0 || i >= p.burnCount) return false;
  if (p.burns[i].deltaVMS > 0.0) return false;      // already filled
  if (!(p.arriveS > nowS)) return false;

  // PROPAGATE TO THE NODE FIRST. `midCourseCorrection` solves a Lambert FROM
  // the position it is handed, so handing it TODAY position with TOMORROW time
  // of flight asks for a transfer that starts where the vehicle is not. The
  // first version of this did exactly that and produced a 2016 m/s correction
  // against an 861 m/s injection, which is not a correction, it is a second
  // mission with the wrong departure point.
  const double tNode = (p.burns[i].nodeTimeS > nowS) ? p.burns[i].nodeTimeS : nowS;
  const orbital::StateVector atNode =
      (tNode > nowS) ? orbital::propagate(actual, tNode - nowS, mu) : actual;
  const Burn b = midCourseCorrection(atNode, tNode, p.aimPointM, p.arriveS,
                                     mu, craft);
  if (!(b.deltaVMS > 0.0)) return false;
  p.burns[i] = b;
  p.totalDvMS = 0.0;
  for (int k = 0; k < p.burnCount; ++k) p.totalDvMS += p.burns[k].deltaVMS;
  pilot.armFrom(p, i);
  return true;
}

// THE ONE PLACE THE EXECUTOR RE-PLANS, AND THE MEASUREMENT THAT FORCES IT.
//
// Everything else in this header flies the plan the solver produced. This does
// not, and the reason is a number rather than a preference.
//
// An injection to Cinder is 861 m/s, which is a LONG burn, and the impulsive
// plan's finite-burn residue is then amplified by a 7.4 hour coast. MEASURED:
// the vehicle reaches the sphere of influence 468 km from where the solver
// predicted, which at the arrival closing speed is about twenty minutes late.
// The capture burn's time, direction and magnitude were all computed for a
// state the vehicle does not arrive in, and flying them open-loop produced a
// 1046804 m orbit where the plan said 253999 m.
//
// So the handoff is a MEASUREMENT, not a prediction. The world says when the
// boundary was actually crossed and in what relative state; this re-plans the
// capture from that state and replaces the second burn. The MISSION is not
// re-derived: the destination, the injection and the decision to capture all
// stand. What is recomputed is one burn, in a frame that did not exist when the
// plan was made, from data that did not exist either.
//
// The alternative is a mid-course correction burn part-way along the coast,
// which is what real missions fly and what R68 tracks. That would let the
// original capture plan stand, at the cost of a third burn and a fourth thing
// to get wrong. This is the smaller change and it is honest about being one.
inline bool replanCaptureAtHandoff(Autopilot& pilot,
                                   const orbital::StateVector& relativeState,
                                   double nowS, const transfer::Target& body,
                                   const vessel::Vessel& craft) {
  if (!body.isBody()) return false;
  Program p = pilot.program;
  if (!p.crossesSoi || p.burnCount < 2) return false;

  // Rebuild the crossing from what the world actually delivered.
  transfer::SoiCrossing x;
  x.found = true;
  x.timeS = nowS;
  x.relative = relativeState;
  x.vInfMS = relativeState.v.length();
  x.hyperbola = orbital::stateToElements(relativeState, body.muM3S2, nowS);
  x.periapsisRadiusM = x.hyperbola.a * (1.0 - x.hyperbola.e);
  x.impacts = x.periapsisRadiusM < body.bodyRadiusM;
  {
    const double crossS = 4.0 * body.soiRadiusM / std::fmax(1.0, x.vInfMS);
    double lo = 0.0, hi = crossS;
    auto radialRate = [&](double dt) {
      const orbital::StateVector q =
          orbital::propagate(x.relative, dt, body.muM3S2);
      return q.r.dot(q.v);
    };
    if (radialRate(0.0) < 0.0 && radialRate(hi) > 0.0) {
      for (int i = 0; i < 80 && (hi - lo) > 1e-6; ++i) {
        const double m = 0.5 * (lo + hi);
        if (radialRate(m) < 0.0) lo = m; else hi = m;
      }
      x.timeToPeriapsisS = 0.5 * (lo + hi);
    }
  }
  const transfer::CaptureBurn cap = transfer::planCapture(x, body);
  if (!cap.valid) return false;

  // R69. THE CAPTURE IS THE LAST BURN, NOT BURN 1, and hardcoding 1 cost
  // 232 m/s and an orbit nobody asked for. A mid-course correction gets
  // INSERTED at index 1 (see ), which pushes the capture to 2, so
  // writing to 1 overwrote the CORRECTION with the capture and left the stale
  // capture at 2 -- and  below then flew that stale
  // one. Everything ran, nothing threw, and the vehicle captured into the
  // wrong orbit while the programme total double-counted a burn it never flew.
  // The index is derived from the same expression the re-arm uses, so the two
  // cannot disagree again.
  const int last = p.burnCount - 1;
  p.burns[last].nodeTimeS = cap.timeS;
  p.burns[last].deltaV = cap.deltaV;
  p.burns[last].deltaVMS = cap.deltaVMS;
  p.burns[last].frame = BurnFrame::Target;
  p.captureRadiusM = cap.circularRadiusM;
  const maneuver::BurnEstimate e = maneuver::estimateBurn(craft, cap.deltaVMS);
  p.burns[last].durationS = e.durationS;
  p.burns[last].leadS = 0.5 * e.durationS;
  // Sum EVERY burn, not the first plus the capture: a mid-course correction may
  // have been inserted since the program was built, and dropping it here would
  // make the executor and its own total disagree by exactly that burn.
  p.totalDvMS = 0.0;
  for (int i = 0; i < p.burnCount; ++i) p.totalDvMS += p.burns[i].deltaVMS;

  // Re-arm at the SECOND burn: the injection is flown and must not be repeated.
  pilot.armFrom(p, last);
  return true;
}

}  // namespace autopilot
}  // namespace of
