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

// One scheduled impulse, in the primary's inertial frame.
struct Burn {
  double nodeTimeS = 0.0;    // when the IMPULSE is centred (absolute sim time)
  Vec3 deltaV{0, 0, 0};      // inertial
  double deltaVMS = 0.0;
  double durationS = 0.0;    // predicted, from estimateBurn at the mass it has
  double leadS = 0.0;        // half of it: light the engine this early

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

  void arm(const Program& p) {
    program = p;
    status = Status();
    status.phase = p.valid ? Phase::Coast : Phase::Aborted;
    status.note = p.valid ? "armed" : p.note;
    burnIndex_ = 0;
    dvThis_ = 0.0;
    dvAll_ = 0.0;
    lastThrottle_ = 0.0;
  }

  void disarm() {
    program = Program();
    status = Status();
    lastThrottle_ = 0.0;
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
      }
      return c;
    }

    if (status.phase == Phase::Orient) {
      if (now < b.ignitionS()) return c;
      // Ignition time has arrived. THE NOSE DECIDES, NOT THE CLOCK, and the
      // nose has to be STILL as well as aimed: igniting as a slewing vehicle
      // sweeps through the target just moves the error into the burn.
      status.rateDegS = sim.state.angVelRadS.length() * 180.0 / orbital::kPi;
      if (status.pointingErrorDeg > kPointingGateDeg) {
        status.note = "holding: not pointed yet, the burn will be late";
        return c;
      }
      if (status.rateDegS > kRateGateDegS) {
        status.note = "holding: still swinging through the target";
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
      // THE LAST TICK IS THROTTLED PROPORTIONALLY, so the terminal error is
      // second order in dt instead of a whole tick of thrust. `aFull` is what
      // one tick at full throttle would deliver.
      const double aFull = thrustAccel(sim, 1.0);
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

 private:
  int burnIndex_ = 0;
  double dvThis_ = 0.0;
  double dvAll_ = 0.0;
  double lastThrottle_ = 0.0;

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

// A TRANSFER, EXECUTED. The same shape, built from a `transfer::Transfer` the
// solver already produced rather than from anything computed here: burn one is
// its injection, burn two is its arrival match. A body capture publishes no
// arrival VECTOR (transfer.h refuses to, so nobody flies one), so a body target
// yields a single-burn program and the capture is a separate plan made inside
// the moon's own frame after the SOI crossing.
inline Program flyTransfer(const transfer::Transfer& tr,
                           const vessel::Vessel& craft, bool arrivalIsMatch) {
  Program p;
  p.mode = Mode::Transfer;
  if (!tr.valid) {
    p.note = "no transfer to fly";
    return p;
  }
  p.burns[0].nodeTimeS = tr.departS;
  p.burns[0].deltaV = tr.departDv;
  p.burns[0].deltaVMS = tr.departDvMS;
  p.burnCount = 1;
  p.totalDvMS = tr.departDvMS;

  if (arrivalIsMatch && tr.arriveDvMS > 0.0) {
    p.burns[1].nodeTimeS = tr.arriveS;
    p.burns[1].deltaV = tr.arriveDv;
    p.burns[1].deltaVMS = tr.arriveDvMS;
    p.burnCount = 2;
    p.totalDvMS += tr.arriveDvMS;
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

}  // namespace autopilot
}  // namespace of
