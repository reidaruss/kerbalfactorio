#pragma once
// =============================================================================
// of::transfer - GETTING TO SOMETHING ELSE (PH-146).
//
// Four questions, in the order a player asks them:
//
//   1. can this vehicle reach that thing, and with how much margin
//   2. when should it leave, and how much would waiting save
//   3. what path does it take
//   4. what burns does it fly
//
// This header answers 1 and 2 and hands 3 and 4 the numbers they need. It
// COMPOSES and it does not re-derive: `orbital::lambert` is the only inverse in
// the codebase and it lives one header down beside the propagator that shares
// its Stumpff functions; `orbital::elementsToState` says where anything is at
// any time; `vessel::remainingDeltaVVacuumMS` is the sole authority on what a
// vehicle has left; `maneuver::estimateBurn` is the sole authority on how long
// a burn takes and whether it fits. A second orbital solver in the client is
// the two-authority failure this project has paid for repeatedly, so the map
// and the VAB draw these answers rather than computing their own.
//
// A BODY IS NOT A SPECIAL CASE, and that is a design constraint rather than an
// aspiration. Cinder orbits Forge at 1.2e7 m (sim_world.h `kCinderOrbitRadiusM`)
// well inside Forge's 8.4e7 m SOI, so "fly to the station" and "fly to the moon"
// are the SAME same-primary Lambert problem. They differ in exactly one place:
// what the arrival burn costs. A vessel target is matched (kill the relative
// velocity); a body target is captured (arrive on a hyperbola inside its SOI and
// burn down to a circular orbit). That is one branch in `arrivalCostMS`, and
// nothing else in this header knows which kind of thing it is aiming at.
//
// NOTHING HERE COMMANDS ANYTHING. Same rule as maneuver.h: these are pure
// functions of (elements, target, clock, craft). Autopilot flies the plan this
// produces and does not re-derive it in flight.
//
// Sections:
//   §1  the target, and where it is at time t
//   §2  one transfer: depart at t0, arrive at t0 + tof
//   §3  the budget: what it costs against what the vehicle has
//   §4  the window: delta-v as a function of DEPARTURE TIME (Reid's chart)
// =============================================================================
#include <cmath>
#include <vector>

#include "of/maneuver.h"
#include "of/orbital.h"
#include "of/vessel.h"

namespace of {
namespace transfer {

// =============================================================================
// §1 - the target.
// =============================================================================

// Anything you can aim at. A parked vessel, a station and a moon are all this
// struct; `muM3S2` and `soiRadiusM` are what make one of them a body.
//
// `el` is the target's conic about the SAME primary the vehicle is orbiting. A
// station's comes straight out of `orbital::park` (the client's `fitConic`); a
// moon's is its orbit about its parent. If the target never moves relative to
// the primary the elements are simply circular with the right period, which is
// the degenerate case and needs no separate code path.
struct Target {
  orbital::Elements el;             // where it is, as a function of time
  double muM3S2 = 0.0;              // > 0: it has gravity of its own
  double soiRadiusM = 0.0;          // > 0: it has a sphere of influence
  double bodyRadiusM = 0.0;         // surface radius, for a capture altitude
  double captureAltitudeM = 0.0;    // the orbit to capture into; 0 = fly past
  double dockingRadiusM = 0.0;      // > 0: it has a port worth aiming at

  bool isBody() const { return muM3S2 > 0.0 && soiRadiusM > 0.0; }
};

inline orbital::StateVector targetStateAt(const Target& t, double simTimeS) {
  return orbital::elementsToState(t.el, simTimeS);
}

// WHAT THE ARRIVAL BURN COSTS, and the one place a body differs from a vessel.
//
// A vessel: kill the relative velocity, so the cost is its magnitude. That is a
// rendezvous, and for a docking target it is also what puts the two hulls at
// rest with respect to each other before the port work starts.
//
// A body: you do not match its velocity, you fall into its SOI on a hyperbola
// and burn at periapsis. With v_inf the relative speed at the boundary and
// r_c the capture radius, vis-viva gives the hyperbolic periapsis speed
// sqrt(v_inf^2 + 2 mu/r_c), and circularising there costs the difference from
// sqrt(mu/r_c). Capturing is CHEAPER than matching, often by a lot, because the
// body's own gravity does part of the work; a readout that billed a moon like a
// station would tell a player they cannot afford a trip they can.
//
// `captureAltitudeM` of 0 means a flyby: arrive and do not burn.
inline double arrivalCostMS(const Target& t, const Vec3& vArrive,
                            const Vec3& vTarget) {
  const double vRel = (vArrive - vTarget).length();
  if (!t.isBody()) return vRel;
  const double rc = t.bodyRadiusM + t.captureAltitudeM;
  if (!(t.captureAltitudeM > 0.0) || !(rc > 0.0)) return 0.0;
  const double vPeri = std::sqrt(vRel * vRel + 2.0 * t.muM3S2 / rc);
  const double vCirc = std::sqrt(t.muM3S2 / rc);
  return vPeri - vCirc;
}

// =============================================================================
// §2 - one transfer.
// =============================================================================

struct Transfer {
  bool valid = false;
  double departS = 0.0;             // absolute sim time of the injection burn
  double timeOfFlightS = 0.0;
  double arriveS = 0.0;

  double departDvMS = 0.0;
  double arriveDvMS = 0.0;
  double totalDvMS = 0.0;

  Vec3 departDv{0, 0, 0};           // inertial, in the primary's frame
  Vec3 arriveDv{0, 0, 0};           // zero for a body capture: it is not a match

  orbital::StateVector departState;   // the vehicle at departS, BEFORE the burn
  orbital::StateVector transferStart; // the same point, AFTER it
  orbital::StateVector transferEnd;   // arrival, on the transfer conic
  orbital::StateVector targetState;   // the target at arriveS

  double sweepRad = 0.0;            // transfer angle actually flown
  double missDistanceM = 0.0;       // |transferEnd.r - targetState.r|, a residual
};

// Leave at `departS`, arrive `tofS` later. Everything else follows.
//
// The reference normal handed to Lambert is the DEPARTURE ORBIT'S OWN h, never
// an axis: this codebase carries two inclination conventions at once (PH-40) and
// an axis test here would be a third. "The short way round in the direction I am
// already going" is frame-free and is what a player means.
inline Transfer solveTransfer(const orbital::Elements& vesselEl,
                              const Target& tgt, double departS, double tofS) {
  Transfer out;
  out.departS = departS;
  out.timeOfFlightS = tofS;
  out.arriveS = departS + tofS;
  if (!(tofS > 0.0) || !(vesselEl.mu > 0.0)) return out;

  out.departState = orbital::elementsToState(vesselEl, departS);
  out.targetState = targetStateAt(tgt, out.arriveS);

  const Vec3 h = orbital::cross(out.departState.r, out.departState.v);
  const orbital::LambertSolution L =
      orbital::lambert(out.departState.r, out.targetState.r, tofS, vesselEl.mu, h);
  if (!L.valid) return out;

  out.sweepRad = L.sweepRad;
  out.transferStart = orbital::StateVector{out.departState.r, L.v1};
  out.transferEnd = orbital::StateVector{out.targetState.r, L.v2};
  out.departDv = L.v1 - out.departState.v;
  out.departDvMS = out.departDv.length();
  out.arriveDvMS = arrivalCostMS(tgt, L.v2, out.targetState.v);
  // A capture is not a velocity match, so there is no arrival vector to publish
  // for a body. Publishing one would invite a caller to fly it.
  if (!tgt.isBody()) out.arriveDv = out.targetState.v - L.v2;
  out.totalDvMS = out.departDvMS + out.arriveDvMS;

  // The residual, published rather than assumed away. Lambert lands ON the
  // target's position by construction, so this is the arithmetic's own error
  // and it is the number that would catch a mismatched clock or a target whose
  // elements are about a different primary.
  out.missDistanceM = (out.transferEnd.r - out.targetState.r).length();
  out.valid = true;
  return out;
}

// =============================================================================
// §3 - the budget.
// =============================================================================

// Can this vehicle afford that transfer, and by how much.
//
// `availableMS` is `vessel::remainingDeltaVVacuumMS` and NOTHING ELSE, so the
// gate that refuses a destination and the number on the navball can never
// disagree. R43 is why this is worth saying out loud: until 2026-08-02 a
// mixed-propellant stage published 17% of its real delta-v, and a "have you got
// enough fuel" gate built on that would have refused trips the vehicle could
// fly and, on other designs, accepted ones it could not.
//
// The two burn durations are cumulative rather than independent, which is the
// only honest way to bill them: `estimateBurn` walks the stages from the current
// state, so the arrival burn's duration is what the total costs MINUS what the
// departure costs. Billing the second burn on its own would price it at the
// pre-departure mass and come out short.
struct Budget {
  double requiredMS = 0.0;
  double availableMS = 0.0;
  double marginMS = 0.0;            // negative means short by this much
  bool feasible = false;

  double departBurnS = 0.0;
  double arriveBurnS = 0.0;
  int stagesUsed = 0;

  // A burn that takes a large slice of an orbit is not the impulse the plan
  // assumed it was. Published for the same reason maneuver.h publishes it: a
  // caller that shows the plan without showing this is hiding its own error.
  double departBurnFractionOfPeriod = 0.0;
};

inline Budget budgetFor(const vessel::Vessel& v, const Transfer& tr) {
  Budget b;
  if (!tr.valid) return b;
  b.requiredMS = tr.totalDvMS;
  const maneuver::BurnEstimate whole = maneuver::estimateBurn(v, tr.totalDvMS);
  const maneuver::BurnEstimate first = maneuver::estimateBurn(v, tr.departDvMS);
  b.availableMS = whole.deltaVAvailableMS;
  b.marginMS = b.availableMS - b.requiredMS;
  b.feasible = whole.feasible;
  b.departBurnS = first.durationS;
  b.arriveBurnS = std::fmax(0.0, whole.durationS - first.durationS);
  b.stagesUsed = whole.stagesUsed;
  b.departBurnFractionOfPeriod = first.burnFractionOfPeriod;
  return b;
}

// =============================================================================
// §4 - the window. DELTA-V AS A FUNCTION OF DEPARTURE TIME.
//
// This is the shape Reid asked for in as many words: "a chart showing how
// optimal the current time would be to launch vs waiting later in terms of fuel
// burn". So the published thing is a SAMPLED CURVE and not a single best answer,
// because the curve IS the feature: a player wants to see that leaving now costs
// 900 m/s, that it drops to 210 in forty minutes, and that waiting three hours
// buys nothing more.
// =============================================================================

// The Hohmann time between two semi-major axes: half the period of the ellipse
// that touches both. It is the natural scale for a time of flight and it is what
// the sweep below is measured in, rather than an invented constant.
inline double hohmannTimeS(double a1, double a2, double mu) {
  if (!(mu > 0.0) || !(a1 > 0.0) || !(a2 > 0.0)) return 0.0;
  const double aT = 0.5 * (a1 + a2);
  return orbital::kPi * std::sqrt(aT * aT * aT / mu);
}

// How long until the relative geometry of two orbits repeats. This, not a round
// number, is the horizon a window scan should cover: past one synodic period the
// chart begins repeating itself, so a longer scan costs time and shows nothing.
// Coincident periods return 0, meaning "the geometry never comes round" (two
// vessels on the same orbit hold their phase for ever), and a caller must pick
// its own horizon in that case.
inline double synodicPeriodS(double a1, double a2, double mu) {
  if (!(mu > 0.0) || !(a1 > 0.0) || !(a2 > 0.0)) return 0.0;
  const double p1 = orbital::orbitalPeriod(a1, mu);
  const double p2 = orbital::orbitalPeriod(a2, mu);
  const double d = std::fabs(1.0 / p1 - 1.0 / p2);
  if (d < 1e-15) return 0.0;
  return 1.0 / d;
}

struct WindowSample {
  double departS = 0.0;
  double timeOfFlightS = 0.0;   // the best one found AT this departure time
  double departDvMS = 0.0;
  double arriveDvMS = 0.0;
  double totalDvMS = 0.0;
  bool valid = false;           // false: no transfer solves from here
};

struct Window {
  std::vector<WindowSample> samples;   // the chart, in departure-time order
  int bestIndex = -1;
  Transfer best;                        // the full transfer at bestIndex
  double horizonS = 0.0;
  double tofMinS = 0.0;
  double tofMaxS = 0.0;
  // The cheapest and dearest VALID samples, so a caller can scale an axis
  // without a second pass and without inventing its own bounds.
  double minDvMS = 0.0;
  double maxDvMS = 0.0;
  int validCount = 0;
};

// Sweep departure time over [nowS, nowS + horizonS] and, at each one, sweep the
// time of flight to find the cheapest transfer that leaves then.
//
// THE TIME OF FLIGHT IS BOUNDED AT ONE REVOLUTION AND THAT IS NOT ARBITRARY.
// `orbital::lambert` solves the SINGLE-revolution problem: hand it a time of
// flight longer than the transfer's own period and it does not fail, it
// confidently answers a different question (see the test that pins this in
// test_physics.cpp). The caller owns that rule because the caller knows the
// periods, so the sweep runs over [0.25, 1.75] Hohmann times, which brackets the
// optimum from both sides and stays well inside one revolution for any pair of
// orbits about the same primary.
//
// `horizonS <= 0` asks for one synodic period, which is the interval after which
// the chart repeats. If the two orbits have the same period the geometry never
// comes round and the horizon falls back to one orbital period, which is the
// honest answer for two things on the same ring: waiting does not help.
inline Window scanWindow(const orbital::Elements& vesselEl, const Target& tgt,
                         double nowS, double horizonS,
                         int departSamples, int tofSamples) {
  Window w;
  if (departSamples < 2) departSamples = 2;
  if (tofSamples < 2) tofSamples = 2;
  const double mu = vesselEl.mu;
  if (!(mu > 0.0) || !(vesselEl.a > 0.0) || !(tgt.el.a > 0.0)) return w;

  const double tH = hohmannTimeS(vesselEl.a, tgt.el.a, mu);
  if (!(tH > 0.0)) return w;
  w.tofMinS = 0.25 * tH;
  w.tofMaxS = 1.75 * tH;

  if (!(horizonS > 0.0)) {
    horizonS = synodicPeriodS(vesselEl.a, tgt.el.a, mu);
    if (!(horizonS > 0.0)) horizonS = orbital::orbitalPeriod(vesselEl.a, mu);
  }
  w.horizonS = horizonS;

  w.samples.reserve(static_cast<size_t>(departSamples));
  double bestOverall = 1e308;
  for (int i = 0; i < departSamples; ++i) {
    const double f = static_cast<double>(i) / (departSamples - 1);
    const double depart = nowS + f * horizonS;

    WindowSample s;
    s.departS = depart;
    double bestHere = 1e308;
    for (int j = 0; j < tofSamples; ++j) {
      const double g = static_cast<double>(j) / (tofSamples - 1);
      const double tof = w.tofMinS + g * (w.tofMaxS - w.tofMinS);
      const Transfer t = solveTransfer(vesselEl, tgt, depart, tof);
      if (!t.valid || !(t.totalDvMS < bestHere)) continue;
      bestHere = t.totalDvMS;
      s.valid = true;
      s.timeOfFlightS = tof;
      s.departDvMS = t.departDvMS;
      s.arriveDvMS = t.arriveDvMS;
      s.totalDvMS = t.totalDvMS;
    }
    if (s.valid) {
      ++w.validCount;
      if (w.validCount == 1) { w.minDvMS = s.totalDvMS; w.maxDvMS = s.totalDvMS; }
      if (s.totalDvMS < w.minDvMS) w.minDvMS = s.totalDvMS;
      if (s.totalDvMS > w.maxDvMS) w.maxDvMS = s.totalDvMS;
      if (s.totalDvMS < bestOverall) {
        bestOverall = s.totalDvMS;
        w.bestIndex = static_cast<int>(w.samples.size());
      }
    }
    w.samples.push_back(s);
  }

  if (w.bestIndex >= 0) {
    const WindowSample& b = w.samples[static_cast<size_t>(w.bestIndex)];
    w.best = solveTransfer(vesselEl, tgt, b.departS, b.timeOfFlightS);
  }
  return w;
}

// "Can I go now, and if not, when?" in one call: the whole answer a VAB gate
// needs. It refuses a destination the vehicle cannot reach AT ANY departure time
// in the horizon, and it distinguishes that from "not now, but at t you can",
// which is the case Reid asked for by name.
struct Verdict {
  bool anyTransferExists = false;   // the geometry admits a transfer at all
  bool feasibleNow = false;         // affordable leaving at the first sample
  bool feasibleLater = false;       // affordable at SOME departure in the horizon
  double bestDepartS = 0.0;         // the cheapest departure in the horizon
  double bestTotalDvMS = 0.0;
  double nowTotalDvMS = 0.0;
  double savingByWaitingMS = 0.0;   // now minus best; 0 if now IS the best
  Budget budgetNow;
  Budget budgetBest;
};

inline Verdict verdictFor(const vessel::Vessel& craft,
                          const orbital::Elements& vesselEl, const Target& tgt,
                          double nowS, double horizonS,
                          int departSamples, int tofSamples) {
  Verdict v;
  const Window w = scanWindow(vesselEl, tgt, nowS, horizonS,
                              departSamples, tofSamples);
  if (w.validCount == 0 || w.bestIndex < 0) return v;
  v.anyTransferExists = true;

  const WindowSample& best = w.samples[static_cast<size_t>(w.bestIndex)];
  v.bestDepartS = best.departS;
  v.bestTotalDvMS = best.totalDvMS;
  v.budgetBest = budgetFor(craft, w.best);
  v.feasibleLater = v.budgetBest.feasible;

  if (w.samples.front().valid) {
    const WindowSample& s0 = w.samples.front();
    const Transfer tNow = solveTransfer(vesselEl, tgt, s0.departS, s0.timeOfFlightS);
    v.nowTotalDvMS = s0.totalDvMS;
    v.budgetNow = budgetFor(craft, tNow);
    v.feasibleNow = v.budgetNow.feasible;
    v.savingByWaitingMS = std::fmax(0.0, s0.totalDvMS - best.totalDvMS);
  }
  return v;
}

}  // namespace transfer
}  // namespace of
