#pragma once
// =============================================================================
// of::maneuver - maneuver node PLANNING.
//
// A maneuver node answers four questions and commands nothing:
//   how much delta-v, which way to point, when to start burning, how long for.
// It also publishes the orbit the burn would produce, so the player can see
// what they are aiming at before they commit.
//
// PH-37: a node is a PLAN, never an autopilot. DW-29 gates autopilot behind a
// research unlock earned by reaching orbit manually, and DW-30's enumerated
// greasing list keeps auto-circularising on the far side of that gate on the
// grounds that it removes a DECISION. A node removes ARITHMETIC: the player
// still points the ship, still starts the burn at the right moment, and still
// stops it. Nothing in this header touches a FlightSim, sets a throttle, or
// advances time. It is a pure function of (state, mu, craft, handles) and that
// is deliberate - it is what makes "plan a burn" and "fly a burn" different
// skills, and only the second one is the game.
//
// Sections:
//   §1  the node: the KSP handle decomposition, and the basis it lives in
//   §2  the burn: duration across the remaining stages, and feasibility
//   §3  the plan: propagate, apply, summarize
//   §4  path sampling for the map view
//
// Everything here is deterministic double-precision arithmetic with no engine
// dependency, which is why it lives in /core and not in the client: the map
// draws the answer, it does not compute it. A second copy of conic geometry in
// TypeScript is the two-authority failure this project has paid for six times.
//
// Header-only, no state, no allocation except the path polyline.
// =============================================================================
#include <algorithm>
#include <cmath>
#include <vector>

#include "of/flight.h"
#include "of/orbital.h"
#include "of/vec3.h"
#include "of/vessel.h"

namespace of {
namespace maneuver {

using orbital::cross;
using orbital::normalized;

// =============================================================================
// §1 - the node and its basis.
// =============================================================================

// The classic KSP decomposition. Three orthogonal handles plus a time along the
// orbit. It is kept because it is the right one: each handle changes exactly
// one thing about the resulting conic at first order (prograde moves the
// opposite apsis, normal rotates the plane, radial rotates the line of apsides
// without changing the energy much), which is what makes a node adjustable by
// feel rather than by solving.
struct Node {
  double tFromNowS  = 0.0;  // seconds from the state's own epoch
  double progradeMS = 0.0;  // + along velocity
  double normalMS   = 0.0;  // + along r x v (the orbit normal)
  double radialMS   = 0.0;  // + AWAY from the body

  double magnitudeMS() const {
    return std::sqrt(progradeMS * progradeMS + normalMS * normalMS +
                     radialMS * radialMS);
  }
};

// The orthonormal triad the handles are expressed in. It is orbital::Basis and
// orbital::basisAt, NOT a copy: SAS points at the same three directions
// (flight.h §5) and a node whose burn marker disagreed with the SAS mode that
// holds it would be wrong in a way nothing catches, because both would look
// plausible on the ball.
//
// What IS this header's own decision is WHERE it is evaluated: at the NODE, not
// at the ship. That distinction is the whole point of a node. "Burn prograde in
// four minutes" means prograde where you will be, not prograde where you are,
// and on an eccentric orbit those differ by a lot.
using Basis = orbital::Basis;
using orbital::basisAt;

// The impulse a node asks for, in the body-centred inertial frame.
inline Vec3 deltaVVector(const Node& n, const Basis& b) {
  return b.prograde * n.progradeMS + b.normal * n.normalMS +
         b.radialOut * n.radialMS;
}

// =============================================================================
// §2 - the burn.
//
// PH-38: burn DURATION is published and the burn is LED BY HALF OF IT. This is
// not a nicety. The flight lane's own ascent recorded that starting a
// circularisation burn AT apoapsis instead of leading it by half a burn caps
// the vehicle at a 121 x 33 km orbit, because an impulsive plan executed as a
// finite burn spends its second half somewhere the plan never was. Half the
// duration is the first-order correction and it is what a node has to tell a
// player, because "burn for 42 s" and "start burning 21 s early" are the same
// fact and only the second one is actionable.
// =============================================================================

struct BurnEstimate {
  double durationS = 0.0;          // full throttle, vacuum
  double leadS = 0.0;              // durationS * 0.5
  double deltaVRequiredMS = 0.0;
  double deltaVAvailableMS = 0.0;  // vessel.h's own remaining figure
  double shortfallMS = 0.0;        // required - available, clamped at 0
  bool feasible = false;           // the ship carries the delta-v asked for
  int stagesUsed = 0;              // how many stagings the burn spans
  // How much of an orbit the burn takes. An impulsive plan is only as good as
  // this is small, and it is published rather than assumed: measured, a burn
  // at 0.0026 of a period lands 19 m from its prediction on a 200 km apoapsis
  // and one at 0.023 lands 39.5 km out (0.61%). A caller that shows the
  // predicted orbit without showing THIS is showing a number whose error it
  // has, and is choosing not to say.
  double burnFractionOfPeriod = 0.0;
};

// Walk the stages the vehicle has LEFT, in the order it will burn them, until
// the requested delta-v is spent. `available` comes from vessel.h's own
// remainingDeltaVVacuumMS so the feasibility answer and the HUD's delta-v
// readout can never disagree; the durations come from the same StagePerformance
// records that produced it.
inline BurnEstimate estimateBurn(const vessel::Vessel& v, double deltaVMS) {
  BurnEstimate e;
  e.deltaVRequiredMS = deltaVMS;
  e.deltaVAvailableMS = vessel::remainingDeltaVVacuumMS(v);
  if (!(deltaVMS > 0.0)) {
    e.feasible = true;
    return e;
  }
  e.shortfallMS = std::fmax(0.0, deltaVMS - e.deltaVAvailableMS);
  e.feasible = (e.shortfallMS <= 0.0);

  double left = deltaVMS;
  const int first = (v.nextStageIndex > 0) ? v.nextStageIndex - 1 : 0;
  const int last = static_cast<int>(v.stages.size());
  for (int k = first; k < last && left > 0.0; ++k) {
    const vessel::StagePerformance sp = vessel::stagePerformance(v, k);
    if (sp.massFlowKgS <= 0.0 || sp.ispVacuumS <= 0.0) continue;
    ++e.stagesUsed;
    if (sp.deltaVVacuumMS >= left) {
      // Partial burn: invert Tsiolkovsky for the mass this much delta-v costs.
      const double m1 = sp.startMassKg * std::exp(-left / (sp.ispVacuumS * atmo::kG0));
      e.durationS += (sp.startMassKg - m1) / sp.massFlowKgS;
      left = 0.0;
    } else {
      e.durationS += sp.burnTimeS;
      left -= sp.deltaVVacuumMS;
    }
  }
  e.leadS = e.durationS * 0.5;
  return e;
}

// =============================================================================
// §3 - the plan.
// =============================================================================

struct Plan {
  bool valid = false;
  orbital::StateVector before;   // state at the node, before the impulse
  orbital::StateVector after;    // state at the node, after the impulse
  Basis basis;                   // evaluated at `before`
  Vec3 deltaV{0, 0, 0};          // inertial
  Vec3 burnDirection{0, 1, 0};   // unit inertial: where the nose goes
  double deltaVMS = 0.0;
  double timeToNodeS = 0.0;
  double timeToBurnStartS = 0.0;  // negative means "you are already late"
  flight::OrbitSummary orbitBefore;
  flight::OrbitSummary orbitAfter;
  BurnEstimate burn;
};

// `now` is the vessel's current state in the body-centred inertial frame; the
// node's time is measured from it. Propagation is the conic, which is exact
// while the vehicle coasts in vacuum (PH-16's boundary) and is a PREDICTION
// while thrust or air is acting: the caller owns saying so, because
// FlightSim::onRailsEligible() already answers it and this header will not keep
// a second copy of that rule.
inline Plan plan(const orbital::StateVector& now, double mu, double bodyRadiusM,
                 const vessel::Vessel& craft, const Node& node) {
  Plan p;
  if (!(mu > 0.0)) return p;

  p.timeToNodeS = node.tFromNowS;
  p.before = (node.tFromNowS == 0.0) ? now
                                     : orbital::propagate(now, node.tFromNowS, mu);
  p.basis = basisAt(p.before);
  p.deltaV = deltaVVector(node, p.basis);
  p.deltaVMS = node.magnitudeMS();
  p.burnDirection =
      (p.deltaVMS > 1e-9) ? p.deltaV * (1.0 / p.deltaV.length()) : p.basis.prograde;

  p.after.r = p.before.r;
  p.after.v = p.before.v + p.deltaV;

  p.orbitBefore = flight::summarize(now, mu, bodyRadiusM);
  p.orbitAfter = flight::summarize(p.after, mu, bodyRadiusM);

  p.burn = estimateBurn(craft, p.deltaVMS);
  // Filled here rather than in estimateBurn, which knows only the vehicle: how
  // long a burn is only means something against the orbit it is flown in.
  if (p.orbitBefore.bound && p.orbitBefore.periodS > 0.0)
    p.burn.burnFractionOfPeriod = p.burn.durationS / p.orbitBefore.periodS;
  p.timeToBurnStartS = p.timeToNodeS - p.burn.leadS;
  p.valid = true;
  return p;
}

// =============================================================================
// §4 - path sampling, for the map view.
//
// The map DRAWS this; it does not compute it. Points come back in the same
// body-centred inertial frame everything else in flight uses, so a client only
// has to project, never to re-derive an ellipse from (a, e) - which would be a
// second answer to "where is the trajectory".
// =============================================================================

struct Path {
  std::vector<Vec3> points;      // in order; closed loop when `bound`
  bool bound = false;
  double periodS = 0.0;
  double semiMajorAxisM = 0.0;
  double eccentricity = 0.0;
  // PH-40: inclination is computed HERE against the world's +Y pole and is
  // deliberately NOT orbital::Elements::i, which is measured against +Z.
  // orbital.h takes h.z for the inclination and cross({0,0,1}, h) for the node
  // line, while the planet's pole is +Y (cubed_sphere.h's dirToLatLon reads
  // dir.y for latitude, and flight.h spins the atmosphere about +Y). The
  // element set is internally consistent, so state -> elements -> state
  // round-trips exactly and nothing that USES it is wrong; but its `i` is an
  // angle to a plane the planet does not have, and printing it on a map next
  // to a latitude would be a number that looks right and is not.
  double inclinationRad = 0.0;
  // The orbit pole, published so a map can build a projection frame from the
  // ONE authority instead of taking its own cross product of r and v. What a
  // view then does with it (choosing which way is "right" on screen, keeping
  // that choice stable frame to frame) is presentation and is the view's.
  Vec3 normal{0, 0, 1};
  Vec3 apoapsis{0, 0, 0};        // position; meaningless when !bound
  Vec3 periapsis{0, 0, 0};
  double apoapsisAltM = 0.0;
  double periapsisAltM = 0.0;
  double timeToApoapsisS = -1.0;   // -1 when there is no such time
  double timeToPeriapsisS = -1.0;
};

// Sample a conic through `samples` points. Bound orbits are sampled uniformly
// in ECCENTRIC anomaly, which puts points where the curvature is (dense at
// periapsis, sparse at apoapsis) rather than where the time is; a time-uniform
// sweep visibly cuts the corner at periapsis on anything eccentric. Unbound
// trajectories are swept in time out to the SOI-ish horizon the caller gives.
inline Path samplePath(const orbital::StateVector& sv, double mu,
                       double bodyRadiusM, int samples,
                       double unboundHorizonS = 3600.0) {
  Path path;
  if (!(mu > 0.0) || samples < 2) return path;
  const orbital::Elements el = orbital::stateToElements(sv, mu, 0.0);
  path.semiMajorAxisM = el.a;
  path.eccentricity = el.e;
  path.normal = basisAt(sv).normal;
  {
    const Vec3 h = cross(sv.r, sv.v);
    const double hm = h.length();
    path.inclinationRad =
        (hm > 0.0) ? std::acos(std::fmax(-1.0, std::fmin(1.0, h.y / hm))) : 0.0;
  }
  path.bound = (el.e < 1.0 && el.a > 0.0);

  path.points.reserve(static_cast<size_t>(samples));

  if (!path.bound) {
    path.periapsisAltM = el.a * (1.0 - el.e) - bodyRadiusM;
    const double dt = unboundHorizonS / static_cast<double>(samples - 1);
    for (int j = 0; j < samples; ++j)
      path.points.push_back(orbital::propagate(sv, dt * j, mu).r);
    return path;
  }

  path.periodS = orbital::orbitalPeriod(el.a, mu);
  const double n = orbital::kTwoPi / path.periodS;   // mean motion
  const double M0 = std::fmod(std::fmod(el.m0, orbital::kTwoPi) + orbital::kTwoPi,
                              orbital::kTwoPi);

  for (int j = 0; j < samples; ++j) {
    const double E = orbital::kTwoPi * static_cast<double>(j) /
                     static_cast<double>(samples);
    const double M = E - el.e * std::sin(E);
    path.points.push_back(orbital::elementsToState(el, (M - el.m0) / n).r);
  }

  // Apsides. M = 0 is periapsis and M = pi is apoapsis by construction, so the
  // times are one wrap of the mean anomaly and need no root find.
  path.timeToPeriapsisS = std::fmod(orbital::kTwoPi - M0, orbital::kTwoPi) / n;
  path.timeToApoapsisS =
      std::fmod(orbital::kPi - M0 + orbital::kTwoPi, orbital::kTwoPi) / n;
  path.periapsis = orbital::elementsToState(el, (0.0 - el.m0) / n).r;
  path.apoapsis = orbital::elementsToState(el, (orbital::kPi - el.m0) / n).r;
  path.apoapsisAltM = el.a * (1.0 + el.e) - bodyRadiusM;
  path.periapsisAltM = el.a * (1.0 - el.e) - bodyRadiusM;
  return path;
}

}  // namespace maneuver
}  // namespace of
