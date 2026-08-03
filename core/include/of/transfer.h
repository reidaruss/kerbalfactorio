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
  double missDistanceM = 0.0;       // distance to the AIM POINT, a residual
  // A BODY IS AIMED OFF-CENTRE ON PURPOSE (PH-159). See `aimOffsetFor` below:
  // 0 for a vessel target, and the impact parameter for a body.
  double aimOffsetM = 0.0;
  Vec3 aimPointM{0, 0, 0};          // where the Lambert actually aimed
};

// HOW FAR OFF THE BODY'S CENTRE TO AIM, AND WHY AIMING AT IT IS A CRATER.
//
// A Lambert solve aims at a POINT. Given the body's centre, it delivers the
// vehicle to the body's centre, and the arrival hyperbola's periapsis is then
// essentially zero: MEASURED on a Hohmann to Cinder, periapsis 1214.7 m against
// a body radius of 200000 m. `planCapture` correctly refused it as "enters, and
// hits the surface", which is a true statement about a plan nobody should fly.
//
// Real missions aim at an OFFSET, and the offset is the impact parameter b. For
// a hyperbola with periapsis r_p and hyperbolic excess v_inf,
//
//     b = r_p * sqrt(1 + 2 mu / (r_p v_inf^2))
//
// which for a 250 km periapsis at Cinder and a v_inf of 348.94 m/s is 574670 m,
// comfortably inside the 2.4e6 m sphere of influence.
inline double aimOffsetFor(double periapsisRadiusM, double bodyMu,
                           double vInfMS) {
  if (!(periapsisRadiusM > 0.0) || !(bodyMu > 0.0) || !(vInfMS > 0.0)) return 0.0;
  return periapsisRadiusM
         * std::sqrt(1.0 + 2.0 * bodyMu / (periapsisRadiusM * vInfMS * vInfMS));
}

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
  Vec3 aim = out.targetState.r;

  // AIMING A BODY OFF-CENTRE. Two passes, because the offset depends on v_inf
  // and v_inf depends on the offset. It converges immediately in practice: the
  // offset is a few hundred km against a transfer of twelve thousand, so the
  // second pass moves v_inf by well under a percent. Solving it exactly would
  // be a fixed point on a quantity whose own error bar is larger than the
  // correction, which is arithmetic for its own sake.
  if (tgt.isBody() && tgt.captureAltitudeM > 0.0) {
    const double rp = tgt.bodyRadiusM + tgt.captureAltitudeM;
    for (int pass = 0; pass < 2; ++pass) {
      const orbital::LambertSolution probe =
          orbital::lambert(out.departState.r, aim, tofS, vesselEl.mu, h);
      if (!probe.valid) break;
      const Vec3 vRel = probe.v2 - out.targetState.v;
      const double vInf = vRel.length();
      const double b = aimOffsetFor(rp, tgt.muM3S2, vInf);
      if (!(b > 0.0)) break;
      // Perpendicular to the arrival velocity, in the transfer plane. The sign
      // decides which way round the body the capture orbit goes; this one is
      // the same sense as the transfer, so a prograde trip captures prograde.
      const Vec3 dir = orbital::normalized(orbital::cross(h, vRel));
      if (dir.lengthSq() <= 0.0) break;
      aim = out.targetState.r + dir * b;
      out.aimOffsetM = b;
      out.aimPointM = aim;
    }
  }

  const orbital::LambertSolution L =
      orbital::lambert(out.departState.r, aim, tofS, vesselEl.mu, h);
  if (!L.valid) return out;
  if (out.aimOffsetM == 0.0) out.aimPointM = aim;

  out.sweepRad = L.sweepRad;
  out.transferStart = orbital::StateVector{out.departState.r, L.v1};
  out.transferEnd = orbital::StateVector{out.aimPointM, L.v2};
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
  out.missDistanceM = (out.transferEnd.r - out.aimPointM).length();
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

// =============================================================================
// §4b - THE SOI CROSSING (PH-156). Patched conics, finally patched.
//
// This is spike2-physics PH-Build 0 step 4, "predictive SOI root-find", which
// has been outstanding since the propagator was written. It was not needed
// while everything flew around one body. It is needed the moment a plan has to
// survive being re-expressed in another body's frame, which is Reid's second
// named test: orbit around the moon.
//
// D-002 is patched conics, not n-body: a vessel feels exactly ONE body at a
// time. So a trip to Cinder is TWO conics with a discontinuity between them,
// and the whole content of the handoff is
//
//     r_rel = r_ship - r_body        v_rel = v_ship - v_body
//
// evaluated at the instant the separation equals the SOI radius. That is a
// SUBTRACTION, and the reason it needs a root-find is only that the instant is
// not known in closed form.
//
// THE PLAN IS STILL COMPUTED ONCE. `autopilot.h`'s rule is that the executor
// does not re-derive in flight, and an SOI crossing looks like the exception:
// the capture burn cannot be expressed in the departure frame at all. It is
// not an exception, because the crossing time and the arrival hyperbola are
// both PREDICTABLE from the departure state. The solver produces both burns up
// front, each tagged with the frame it lives in, and the executor flies each in
// its own frame. Nothing is re-derived; the plan simply has two frames in it.
// =============================================================================

struct SoiCrossing {
  bool found = false;
  double timeS = 0.0;                  // absolute sim time of ENTRY
  orbital::StateVector relative;       // state RELATIVE TO THE BODY at entry
  orbital::Elements hyperbola;         // its conic ABOUT THE BODY
  double vInfMS = 0.0;                 // speed relative to the body at entry
  double periapsisRadiusM = 0.0;       // of the arrival conic, about the body
  double timeToPeriapsisS = 0.0;       // from entry
  bool impacts = false;                // periapsis is inside the body
  const char* note = "no crossing";
};

// Separation between the vessel and the body at a time, both on their own
// conics about the shared primary.
inline double separationAt(const orbital::Elements& shipEl, const Target& body,
                           double t) {
  const orbital::StateVector s = orbital::elementsToState(shipEl, t);
  const orbital::StateVector b = orbital::elementsToState(body.el, t);
  return (s.r - b.r).length();
}

// WHEN DOES THE VESSEL FALL INTO THE BODY'S SPHERE OF INFLUENCE.
//
// Sampled, then bisected on the FIRST inward crossing. Sampling rather than
// solving because the separation of two conics about a shared primary has no
// closed form, and FIRST because a trajectory that grazes the SOI, leaves and
// returns must hand off at the first entry: handing off at the second would
// integrate the wrong conic through the gap between them.
//
// `samples` is the coarse pass. It has to be fine enough not to step over the
// whole SOI: the vessel crosses Cinder's 2.4e6 m bubble in about 1500 s at a
// typical arrival speed, so the default 2000 over a 30000 s window (15 s a
// step) has two orders of magnitude of margin. Too coarse and the crossing is
// MISSED rather than mislocated, which is why this is stated rather than tuned.
inline SoiCrossing findSoiEntry(const orbital::Elements& shipEl,
                                const Target& body, double fromS, double toS,
                                int samples = 2000) {
  SoiCrossing x;
  if (!body.isBody() || !(toS > fromS) || samples < 2) {
    x.note = "not a body, or an empty window";
    return x;
  }
  const double soi = body.soiRadiusM;
  double tPrev = fromS;
  double dPrev = separationAt(shipEl, body, fromS) - soi;
  if (dPrev <= 0.0) {
    x.note = "already inside the sphere of influence at the window's start";
    return x;
  }

  double tLo = 0.0, tHi = 0.0;
  bool bracketed = false;
  for (int i = 1; i <= samples; ++i) {
    const double t = fromS + (toS - fromS) * (static_cast<double>(i) / samples);
    const double d = separationAt(shipEl, body, t) - soi;
    if (d <= 0.0) { tLo = tPrev; tHi = t; bracketed = true; break; }
    tPrev = t;
    dPrev = d;
  }
  if (!bracketed) {
    x.note = "the trajectory never enters the sphere of influence";
    return x;
  }

  // Bisect. 80 halvings takes a 30000 s window to well under a nanosecond, so
  // the loop is bounded by the double's mantissa rather than by the tolerance.
  for (int i = 0; i < 80 && (tHi - tLo) > 1e-6; ++i) {
    const double tm = 0.5 * (tLo + tHi);
    if (separationAt(shipEl, body, tm) - soi > 0.0) tLo = tm; else tHi = tm;
  }
  x.timeS = tHi;
  x.found = true;

  // THE HANDOFF ITSELF, which is one subtraction.
  const orbital::StateVector s = orbital::elementsToState(shipEl, x.timeS);
  const orbital::StateVector b = orbital::elementsToState(body.el, x.timeS);
  x.relative = orbital::StateVector{s.r - b.r, s.v - b.v};
  x.vInfMS = x.relative.v.length();
  x.hyperbola = orbital::stateToElements(x.relative, body.muM3S2, x.timeS);
  x.periapsisRadiusM = x.hyperbola.a * (1.0 - x.hyperbola.e);
  x.impacts = x.periapsisRadiusM < body.bodyRadiusM;
  x.note = x.impacts ? "enters, and hits the surface" : "enters";

  // TIME TO PERIAPSIS BY ROOT-FINDING ON r.v, NOT BY INVERTING KEPLER AGAIN.
  // Periapsis is exactly where the radial velocity changes sign, so this is a
  // bisection on a quantity the PROPAGATOR produces, which means the answer
  // agrees with the trajectory that will actually be flown rather than with a
  // second derivation of it.
  {
    const double crossS = 4.0 * soi / std::fmax(1.0, x.vInfMS);
    double lo = 0.0, hi = crossS;
    auto radialRate = [&](double dt) {
      const orbital::StateVector q = orbital::propagate(x.relative, dt, body.muM3S2);
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
  return x;
}

// THE CAPTURE BURN, IN THE BODY'S OWN FRAME.
//
// At periapsis the radial velocity is zero, so the arrival velocity is purely
// tangential and the burn is purely retrograde: the whole manoeuvre is
// |v_hyperbolic| - |v_circular| at whatever radius the hyperbola happens to
// have. It captures at THAT radius rather than at a requested altitude,
// because aiming the periapsis is a mid-course correction and not a capture,
// and pretending otherwise would publish a burn that does not produce the
// orbit it claims. The radius reached is published so a caller can see it.
struct CaptureBurn {
  bool valid = false;
  double timeS = 0.0;                 // absolute, at periapsis
  Vec3 deltaV{0, 0, 0};               // IN THE BODY'S FRAME
  double deltaVMS = 0.0;
  double circularRadiusM = 0.0;       // the orbit it produces
  orbital::StateVector atPeriapsis;   // relative to the body, BEFORE the burn
  const char* note = "no capture";
};

inline CaptureBurn planCapture(const SoiCrossing& x, const Target& body) {
  CaptureBurn c;
  if (!x.found || !body.isBody()) { c.note = "nothing to capture into"; return c; }
  if (x.impacts) { c.note = "the arrival conic hits the surface"; return c; }
  if (!(x.timeToPeriapsisS > 0.0)) { c.note = "no periapsis ahead"; return c; }

  c.atPeriapsis = orbital::propagate(x.relative, x.timeToPeriapsisS, body.muM3S2);
  const double r = c.atPeriapsis.r.length();
  if (!(r > body.bodyRadiusM)) { c.note = "periapsis is inside the body"; return c; }

  const double vCirc = std::sqrt(body.muM3S2 / r);
  const Vec3 vHat = orbital::normalized(c.atPeriapsis.v);
  c.deltaV = vHat * vCirc - c.atPeriapsis.v;   // retrograde, by construction
  c.deltaVMS = c.deltaV.length();
  c.timeS = x.timeS + x.timeToPeriapsisS;
  c.circularRadiusM = r;
  c.valid = true;
  c.note = "capture at the arrival periapsis";
  return c;
}

// =============================================================================
// §5 - THE MISSION BUDGET: the five legs a reach readout draws.
//
// The gameplay lane's `Autopilot.ts` publishes `REACH_LEGS = [ascent, plane
// change, transfer, arrival, reserve]` and a 10-word row. Admin's rule for this
// header was "either compute them or say the split is wrong, and do not publish
// a zero into a field a screen will draw". Four of the five are computed and the
// fifth is a POLICY that is named as one. Where a leg is genuinely zero it is
// zero because the physics says so, and where physics cannot answer, `ok` is
// false and the whole row is refused rather than padded.
// =============================================================================

// The pad-to-orbit leg, and it is the one number here with no closed form.
//
// Ascent delta-v is orbital speed PLUS gravity and drag losses, and the losses
// depend on the vehicle's thrust-to-weight and the profile it flies. There is no
// formula. So this is CALIBRATED against this project's own flown reference
// ascent rather than modelled: `flight_tests` puts Ascender I from the Forge pad
// into an 86.9 x 75.5 km orbit with 1200 m/s left of 4922.91, so it spent
// 3722.91 m/s to reach a mean radius of 681.2 km whose circular speed is
// 2277.0 m/s. The losses are therefore 1445.9 m/s against a surface circular
// speed of 2426.06, which is the fraction below.
//
// THE CALIBRATION IS FORGE'S AND IT DOES NOT TRANSFER. A 35% gravity loss is
// what an atmosphere and a modest pad TWR cost; on an airless low-gravity body
// you fly nearly horizontally from the first second and the losses are a few
// percent. Rather than publish a fraction nobody measured, `ascentDvMS` REFUSES
// for a body it has not been calibrated against. There is no launch site off
// Forge today, so this costs nothing now and it fails loudly the day there is
// one (R63).
constexpr double kAscentGravityLossFraction = 0.3500;
constexpr double kAscentDragLossFraction    = 0.2459;   // sums to the measured
                                                        // 0.5959 at Forge
struct AscentCost {
  bool calibrated = false;   // false: this body has no measured ascent
  double deltaVMS = 0.0;
};

inline AscentCost ascentDvMS(double muM3S2, double bodyRadiusM,
                             double parkingRadiusM, bool hasAtmosphere) {
  AscentCost a;
  if (!(muM3S2 > 0.0) || !(bodyRadiusM > 0.0) || !(parkingRadiusM > bodyRadiusM))
    return a;
  // Only the body this lane has actually flown a rocket off.
  const bool isForge = std::fabs(muM3S2 - orbital::kForgeMu) < 1e6
                       && std::fabs(bodyRadiusM - orbital::kForgeRadiusM) < 1.0;
  if (!isForge) return a;
  a.calibrated = true;
  const double vPark = std::sqrt(muM3S2 / parkingRadiusM);
  const double vSurf = std::sqrt(muM3S2 / bodyRadiusM);
  const double loss = kAscentGravityLossFraction
                      + (hasAtmosphere ? kAscentDragLossFraction : 0.0);
  a.deltaVMS = vPark + vSurf * loss;
  return a;
}

// THE RESERVE, AND IT IS THE ONE POLICY IN THIS HEADER.
//
// It is not a physics quantity and it is not pretending to be. It is included in
// the total because three measured facts say a plan costing exactly what you
// carry does not fly:
//   * the burns are FINITE, not impulsive. `test_maneuver.cpp` measured a burn
//     at 0.023 of a period landing 0.61% low on apoapsis, which is 39.5 km on a
//     200 km target;
//   * the window scan is a GRID, and its best sample was measured 2.32 m/s (0.6%)
//     above the true Hohmann optimum on the Anchorage case;
//   * a gate that says yes at a margin of 0.0 says yes to a mission that fails.
// Five percent covers all three with room, and it is ONE named constant so
// gameplay can argue with it in one place rather than in five.
constexpr double kMissionReserveFraction = 0.05;

// The whole row, in the order `Autopilot.ts` draws it. The first four sum to
// the mission and the fifth is added on top, so `totalMS` is all five.
struct MissionBudget {
  bool ok = false;              // false: physics refuses to answer, not "zero"
  double ascentMS = 0.0;
  double planeChangeMS = 0.0;
  double transferMS = 0.0;
  double arrivalMS = 0.0;
  double reserveMS = 0.0;
  double totalMS = 0.0;         // the sum of the five, exactly
  double availableMS = 0.0;
  double marginMS = 0.0;
  bool feasible = false;
};

// Rotate a state so its orbit lies in `targetNormal`'s plane, keeping radius,
// speed and the angle between them. Rodrigues about the axis between the two
// normals: an identity when the planes already match, which is what makes the
// plane-change leg exactly 0 for a coplanar transfer rather than nearly 0.
inline orbital::StateVector coplanarWith(const orbital::StateVector& s,
                                         const Vec3& targetNormal) {
  const Vec3 nS = orbital::normalized(orbital::cross(s.r, s.v));
  const Vec3 nT = orbital::normalized(targetNormal);
  const Vec3 axis = orbital::cross(nS, nT);
  const double sinA = axis.length();
  double cosA = nS.dot(nT);
  if (cosA > 1.0) cosA = 1.0;
  if (cosA < -1.0) cosA = -1.0;
  if (sinA < 1e-15) return s;                 // already coplanar, or antipodal
  const Vec3 k = axis * (1.0 / sinA);
  const double angle = std::atan2(sinA, cosA);
  const double c = std::cos(angle), sn = std::sin(angle);
  auto rot = [&](const Vec3& v) {
    return v * c + orbital::cross(k, v) * sn + k * (k.dot(v) * (1.0 - c));
  };
  return orbital::StateVector{rot(s.r), rot(s.v)};
}

// THE PLANE-CHANGE LEG IS ALLOCATED, NOT DECOMPOSED, and the difference matters.
//
// `solveTransfer` is a 3D Lambert: it already prices the plane mismatch INSIDE
// the departure burn, and it prices it better than two separate burns would,
// because a combined burn beats the sum of its parts. So splitting the vector
// into in-plane and out-of-plane components would publish two numbers that do
// not add up to the burn (they add in quadrature), and billing a textbook
// `2 v sin(theta/2)` alongside the transfer would DOUBLE-COUNT it.
//
// What is published instead is the difference between two transfers that were
// both actually solved: the same trip with the target rotated into the vehicle's
// plane, and the real one. `transfer` and `arrival` are what the trip would cost
// if the planes matched; `plane change` is exactly what the mismatch adds. The
// three sum to the real burn total by construction, and the leg is exactly 0
// when the planes match rather than a small residue.
inline MissionBudget missionBudget(const vessel::Vessel& craft,
                                   const orbital::Elements& vesselEl,
                                   const Target& tgt, const Transfer& tr,
                                   const AscentCost& ascent) {
  MissionBudget b;
  if (!tr.valid) return b;
  if (!ascent.calibrated && ascent.deltaVMS != 0.0) return b;
  b.ascentMS = ascent.deltaVMS;

  // The same trip, coplanar. Rotate the TARGET's arrival state into the
  // vehicle's plane and re-price arrival and departure against it.
  const Vec3 hV = orbital::cross(tr.departState.r, tr.departState.v);
  const orbital::StateVector flat = coplanarWith(tr.targetState, hV);
  const orbital::LambertSolution L =
      orbital::lambert(tr.departState.r, flat.r, tr.timeOfFlightS, vesselEl.mu, hV);
  if (L.valid) {
    b.transferMS = (L.v1 - tr.departState.v).length();
    b.arrivalMS = arrivalCostMS(tgt, L.v2, flat.v);
    const double flatTotal = b.transferMS + b.arrivalMS;
    b.planeChangeMS = std::fmax(0.0, tr.totalDvMS - flatTotal);
    // If the coplanar reference somehow came out DEARER, the allocation is
    // meaningless and the real burn is billed to `transfer` whole rather than
    // to a leg that would read as a negative saving.
    if (tr.totalDvMS < flatTotal) {
      b.transferMS = tr.departDvMS;
      b.arrivalMS = tr.arriveDvMS;
      b.planeChangeMS = 0.0;
    }
  } else {
    // No coplanar reference solves, so there is nothing to allocate against.
    // Bill the real burn and say the plane change is not separable here.
    b.transferMS = tr.departDvMS;
    b.arrivalMS = tr.arriveDvMS;
    b.planeChangeMS = 0.0;
  }

  const double mission = b.ascentMS + b.planeChangeMS + b.transferMS + b.arrivalMS;
  b.reserveMS = mission * kMissionReserveFraction;
  b.totalMS = mission + b.reserveMS;
  b.availableMS = vessel::remainingDeltaVVacuumMS(craft);
  b.marginMS = b.availableMS - b.totalMS;
  b.feasible = b.marginMS >= 0.0;
  b.ok = true;
  return b;
}

// =============================================================================
// §6 - THE LAUNCH BUDGET: the bay's question, which is a different question.
//
// `of_ap_design_reach` asks "can this vehicle, as drawn, reach that orbit at
// all". It is NOT a rendezvous: the bay's call carries no true anomaly, because
// a rocket on a pad has no phase relationship with anything until it launches,
// and the target orbit is a RING rather than a place. So there is no window, no
// Lambert and no departure curve here. It is ascent, then a Hohmann up to the
// ring, and the plane is chosen with the launch azimuth.
//
// THE BODY. A design handle carries no body: `vs::Vessel` is parts and geometry,
// and every `of_vs_*` that needs gravity takes a body handle explicitly. The
// gameplay lane's published signature has no room for one, and a JS-supplied mu
// is forbidden (DW-18). It does not need one: `ascentDvMS` is calibrated against
// a flown Forge ascent and REFUSES every other body, so the only launch this
// function can price is a Forge launch, and `orbital::kForgeMu` is that body's
// one authority rather than a second copy of it (test_vessel.cpp pins
// `worldgen::makeForge().muM3S2 == orbital::kForgeMu`). The day there is a pad
// anywhere else this refuses instead of guessing (R63).
//
// THE PARKING ORBIT is 80 km, which is not a round number chosen for looks: it
// is the orbit this project's reference ascent actually reaches and the one the
// ascent calibration above was measured against.
constexpr double kParkingAltitudeM = 80.0e3;

// A Hohmann between two circular radii, both burns. The bay's transfer leg.
inline void hohmannBurnsMS(double r1, double r2, double mu,
                           double* dv1, double* dv2) {
  *dv1 = 0.0;
  *dv2 = 0.0;
  if (!(mu > 0.0) || !(r1 > 0.0) || !(r2 > 0.0)) return;
  if (std::fabs(r2 - r1) < 1e-9) return;          // already there: exactly 0
  const double aT = 0.5 * (r1 + r2);
  *dv1 = std::fabs(std::sqrt(mu * (2.0 / r1 - 1.0 / aT)) - std::sqrt(mu / r1));
  *dv2 = std::fabs(std::sqrt(mu / r2) - std::sqrt(mu * (2.0 / r2 - 1.0 / aT)));
}

// The bay's whole row. `targetRadiusM` is the ring the design must reach.
//
// `planeChangeMS` is 0 and it is a PHYSICAL zero rather than an uncomputed one:
// a launch picks its orbital plane with its azimuth and pays nothing for it, for
// any inclination at or above the launch site's latitude. Physics does not know
// the site (the design handle carries none), so the assumption is stated rather
// than hidden, and the dogleg a low-inclination target would cost is R63.
inline MissionBudget launchBudget(const vessel::Vessel& craft,
                                  double targetRadiusM) {
  MissionBudget b;
  const double mu = orbital::kForgeMu;
  const double R = orbital::kForgeRadiusM;
  const double rPark = R + kParkingAltitudeM;
  if (!(targetRadiusM > R)) return b;             // inside the planet: refuse

  const AscentCost a = ascentDvMS(mu, R, rPark, true);
  if (!a.calibrated) return b;
  b.ascentMS = a.deltaVMS;
  b.planeChangeMS = 0.0;
  hohmannBurnsMS(rPark, targetRadiusM, mu, &b.transferMS, &b.arrivalMS);

  const double mission = b.ascentMS + b.planeChangeMS + b.transferMS + b.arrivalMS;
  b.reserveMS = mission * kMissionReserveFraction;
  b.totalMS = mission + b.reserveMS;
  // THE DESIGN'S number, which is the whole vehicle from the pad, and not
  // `remainingDeltaVVacuumMS`, which is what is left from the CURRENT stage.
  // On an unfired design they agree; the distinction is R44b's, one call up.
  b.availableMS = vessel::totalDeltaVVacuumMS(craft);
  b.marginMS = b.availableMS - b.totalMS;
  b.feasible = b.marginMS >= 0.0;
  b.ok = true;
  return b;
}

// "Can I go now, and if not, when?" in one call: the whole answer a VAB gate
// needs. It refuses a destination the vehicle cannot reach AT ANY departure time
// in the horizon, and it distinguishes that from "not now, but at t you can",
// which is the case Reid asked for by name.
struct Verdict {
  bool anyTransferExists = false;   // the geometry admits a transfer at all
  bool feasibleNow = false;         // affordable leaving at the first sample
  bool feasibleLater = false;       // affordable at SOME departure in the horizon
  double bestDepartS = 0.0;         // the CHEAPEST departure in the horizon
  double bestTotalDvMS = 0.0;
  double nowTotalDvMS = 0.0;
  double savingByWaitingMS = 0.0;   // now minus best; 0 if now IS the best
  Budget budgetNow;
  Budget budgetBest;

  // THE EARLIEST AFFORDABLE DEPARTURE, WHICH IS NOT THE CHEAPEST ONE.
  //
  // The gameplay lane raised this and it is right: "the cheapest window and the
  // first flyable window are different questions, and a screen that conflated
  // them would let a player schedule a departure they still cannot afford".
  // A vehicle can often afford to go a while before the optimum arrives, and a
  // player in a hurry wants that time; a player saving fuel wants the other.
  // Both are published so neither has to be re-derived.
  bool anyFeasible = false;
  double firstFeasibleDepartS = 0.0;
  double firstFeasibleTotalDvMS = 0.0;
  int firstFeasibleIndex = -1;
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

  // The earliest departure the vehicle can actually pay for. One pass over the
  // curve against the SAME `availableMS` the budget used, so the two answers
  // cannot drift apart. `feasibleLater` stays the "is it ever possible" flag;
  // this is "and the first time it is".
  const double available = v.budgetBest.availableMS;
  for (size_t i = 0; i < w.samples.size(); ++i) {
    const WindowSample& s = w.samples[i];
    if (!s.valid || s.totalDvMS > available) continue;
    v.anyFeasible = true;
    v.firstFeasibleIndex = static_cast<int>(i);
    v.firstFeasibleDepartS = s.departS;
    v.firstFeasibleTotalDvMS = s.totalDvMS;
    break;
  }
  return v;
}

}  // namespace transfer
}  // namespace of
