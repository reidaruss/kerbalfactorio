// =============================================================================
// test_maneuver.cpp - maneuver node planning (of/maneuver.h, PH-37 to PH-40).
//
// The acceptance is the LAST test in this file: a node is planned, the burn it
// describes is actually FLOWN through FlightSim, and the orbit that comes out
// is compared against the orbit the node predicted. A node that predicts an
// orbit you cannot fly to is worse than no node, so nothing here is trusted on
// the strength of the plan agreeing with itself.
//
// The numbers the plan is pinned against were computed BY HAND first, on paper,
// from the vis-viva equation, before any of this ran. They are written out in
// the test so a future reader can re-derive them without reading the header:
//
//   Forge:  mu = 9.81 * 600e3^2 = 3.5316e12 m^3/s^2   (DW-18, the one authority)
//   80 km circular orbit, r1 = 680,000 m
//     v_circ = sqrt(mu / r1) = 2278.931638 m/s
//   Raise apoapsis to 200 km, r2 = 800,000 m; a = (r1 + r2)/2 = 740,000 m
//     v_peri = sqrt(mu * (2/r1 - 1/a)) = 2369.520287 m/s
//     dv     = 90.588649 m/s, prograde, at the 80 km point
//   Ascender I upper stage: m0 = 3705 kg, Isp_vac 360 s, mdot 16.9953 kg/s
//     Isp * g0 = 360 * 9.80665 = 3530.394 m/s
//     m1 = 3705 * exp(-90.588649 / 3530.394) = 3611.140 kg
//     burn = (3705 - 3611.140) / 16.9953 = 5.5227 s,  lead = 2.7614 s
// =============================================================================
#include <cmath>

#include "of/cubed_sphere.h"
#include <cstdio>
#include <string>

#include "of/autopilot.h"
#include "of/flight.h"
#include "of/maneuver.h"
#include "of/orbital.h"
#include "of/transfer.h"
#include "of/vessel.h"
#include "test_framework.h"

using namespace of;
using namespace of::vessel;
using namespace of::flight;
namespace mn = of::maneuver;

// --- the hand-computed constants, written once ------------------------------
static const double kMu = 9.81 * 600.0e3 * 600.0e3;   // 3.5316e12
static const double kR = 600.0e3;
static const double kR1 = 680.0e3;                    // 80 km circular
static const double kVCircHand = 2278.931638;         // sqrt(mu / r1)
static const double kDvHand = 90.588649;              // to a 200 km apoapsis
static const double kBurnHand = 5.5227;               // s, Ascender upper stage
static const double kLeadHand = 2.7614;               // s

// The same reference vehicle test_vessel.cpp and test_flight.cpp pin.
struct Ascender {
  Vessel v;
  PartHandle pod, chute, tankUp, engUp, dec, tankLo, engLo;
};

static Ascender makeAscender() {
  Ascender a;
  Vessel& v = a.v;
  a.pod = v.addRoot(parts::CommandPod);
  a.chute = v.attach(a.pod, parts::Parachute, Attach::StackBottom);
  a.tankUp = v.attach(a.chute, parts::TankLiquidSmall, Attach::StackBottom);
  a.engUp = v.attach(a.tankUp, parts::EngineVacuumSmall, Attach::StackBottom);
  a.dec = v.attach(a.engUp, parts::DecouplerStackSmall, Attach::StackBottom);
  a.tankLo = v.attach(a.dec, parts::TankLiquidSmallLong, Attach::StackBottom);
  a.engLo = v.attach(a.tankLo, parts::EngineLiquidSmall, Attach::StackBottom);
  v.assignSubtreeToStage(a.dec, 0);
  Stage s0; s0.activate.push_back(a.engLo);
  Stage s1; s1.activate.push_back(a.engUp); s1.decouple.push_back(a.dec);
  v.stages.push_back(s0);
  v.stages.push_back(s1);
  v.layout();
  return a;
}

// The Ascender with its booster already gone: the upper stage, full, which is
// the vehicle that is actually in orbit when a node gets planned.
static Vessel upperStageOnly() {
  Ascender a = makeAscender();
  a.v.layout();
  fireStage(a.v);   // press 1: lights the lower engine
  fireStage(a.v);   // press 2: drops the booster, lights the vacuum engine
  a.v.layout();
  return a.v;
}

static FlightEnvironment forgeEnv() {
  const worldgen::BodyParams b = worldgen::makeForge(1);
  FlightEnvironment e;
  e.muM3S2 = b.muM3S2;
  e.bodyRadiusM = b.radiusM;
  e.air = atmo::makeForgeAtmosphere();
  return e;
}

// An 80 km circular orbit in the XZ plane, moving +Z at the +X point.
static orbital::StateVector circular80km() {
  orbital::StateVector s;
  s.r = Vec3{kR1, 0.0, 0.0};
  s.v = Vec3{0.0, 0.0, std::sqrt(kMu / kR1)};
  return s;
}

// =============================================================================
// The environment the whole file rests on. DW-20: prove the setup before
// trusting a measurement taken in it.
// =============================================================================
TEST(the_body_and_the_circular_speed_are_the_hand_computed_ones) {
  const worldgen::BodyParams b = worldgen::makeForge(1);
  CHECK_NEAR(b.muM3S2, kMu, 1.0);
  CHECK_NEAR(b.radiusM, kR, 1e-9);

  // The whole delta-v figure below is a difference of two speeds, so if this
  // one is wrong by a millimetre per second the answer is wrong by the same.
  CHECK_NEAR(std::sqrt(kMu / kR1), kVCircHand, 1e-5);

  // And the vis-viva speed at the periapsis of the transfer ellipse.
  const double a = 0.5 * (kR1 + 800.0e3);
  CHECK_NEAR(std::sqrt(kMu * (2.0 / kR1 - 1.0 / a)), 2369.520287, 1e-5);
  CHECK_NEAR(std::sqrt(kMu * (2.0 / kR1 - 1.0 / a)) - std::sqrt(kMu / kR1),
             kDvHand, 1e-5);
}

// =============================================================================
// §1 - the basis. One definition, shared with SAS.
// =============================================================================
TEST(the_node_basis_is_orthonormal_and_radial_out_really_points_out) {
  // Circular first, where radial-out and r-hat coincide and the answer is
  // checkable by eye.
  const orbital::StateVector c = circular80km();
  const mn::Basis b = mn::basisAt(c);
  CHECK_NEAR(b.prograde.length(), 1.0, 1e-12);
  CHECK_NEAR(b.normal.length(), 1.0, 1e-12);
  CHECK_NEAR(b.radialOut.length(), 1.0, 1e-12);
  CHECK_NEAR(b.prograde.dot(b.normal), 0.0, 1e-12);
  CHECK_NEAR(b.prograde.dot(b.radialOut), 0.0, 1e-12);
  CHECK_NEAR(b.normal.dot(b.radialOut), 0.0, 1e-12);
  CHECK(b.radialOut.dot(c.r) > 0.0);
  CHECK_NEAR(b.radialOut.dot(orbital::normalized(c.r)), 1.0, 1e-12);

  // Eccentric, where they do NOT coincide: radial-out stays perpendicular to
  // prograde (that is the definition) and still points away from the body.
  orbital::StateVector e = c;
  e.v = e.v * 1.25;                       // now an ellipse, and we sit at its periapsis
  const orbital::StateVector mid = orbital::propagate(e, 900.0, kMu);
  const mn::Basis be = mn::basisAt(mid);
  CHECK(std::fabs(orbital::normalized(mid.r).dot(orbital::normalized(mid.v))) > 1e-3);
  CHECK_NEAR(be.prograde.dot(be.radialOut), 0.0, 1e-12);
  CHECK(be.radialOut.dot(mid.r) > 0.0);
  CHECK_NEAR(be.radialOut.length(), 1.0, 1e-12);

  // A rocket standing still on the pad is the FIRST state this is ever asked
  // about. It must be finite and orthonormal, not NaN.
  orbital::StateVector pad;
  pad.r = Vec3{0.0, kR, 0.0};
  pad.v = Vec3{0.0, 0.0, 0.0};
  const mn::Basis bp = mn::basisAt(pad);
  CHECK(std::isfinite(bp.prograde.x + bp.prograde.y + bp.prograde.z));
  CHECK_NEAR(bp.prograde.length(), 1.0, 1e-12);
  CHECK_NEAR(bp.prograde.dot(bp.normal), 0.0, 1e-12);
}

// =============================================================================
// §2 - the plan against the hand computation.
// =============================================================================
TEST(a_hand_computed_prograde_burn_produces_the_hand_computed_orbit) {
  const orbital::StateVector now = circular80km();
  const Vessel craft = upperStageOnly();

  mn::Node n;
  n.tFromNowS = 0.0;
  n.progradeMS = kDvHand;
  const mn::Plan p = mn::plan(now, kMu, kR, craft, n);

  CHECK(p.valid);
  CHECK_NEAR(p.deltaVMS, kDvHand, 1e-9);

  // The orbit we started in: circular at 80 km.
  CHECK_NEAR(p.orbitBefore.apoapsisAltM, 80.0e3, 1.0);
  CHECK_NEAR(p.orbitBefore.periapsisAltM, 80.0e3, 1.0);
  CHECK(p.orbitBefore.eccentricity < 1e-9);

  // The orbit the paper says this burn produces: 80 x 200 km.
  CHECK_NEAR(p.orbitAfter.periapsisAltM, 80.0e3, 1.0);
  CHECK_NEAR(p.orbitAfter.apoapsisAltM, 200.0e3, 1.0);
  CHECK_NEAR(p.orbitAfter.semiMajorAxisM, 740.0e3, 1.0);

  // The direction to point is prograde, because that is the only handle used.
  CHECK_NEAR(p.burnDirection.dot(p.basis.prograde), 1.0, 1e-12);

  // A pure prograde burn does not move the plane. Checked because "normal" and
  // "radial" being swapped would still produce a plausible-looking apoapsis.
  const Vec3 h0 = orbital::cross(p.before.r, p.before.v);
  const Vec3 h1 = orbital::cross(p.after.r, p.after.v);
  CHECK_NEAR(orbital::normalized(h0).dot(orbital::normalized(h1)), 1.0, 1e-12);

  // NEGATIVE CONTROL on the handle decomposition: the same magnitude spent
  // NORMAL instead must leave the apoapsis where it was and tilt the plane.
  mn::Node nn;
  nn.normalMS = kDvHand;
  const mn::Plan pn = mn::plan(now, kMu, kR, craft, nn);
  const Vec3 hn = orbital::cross(pn.after.r, pn.after.v);
  CHECK(orbital::normalized(h0).dot(orbital::normalized(hn)) < 0.9995);
  CHECK(std::fabs(pn.orbitAfter.apoapsisAltM - 200.0e3) > 100.0e3);
  // It changes the SPEED only in quadrature, so the energy barely moves and the
  // orbit stays close to circular. That is the property that makes normal the
  // plane handle rather than a second prograde.
  CHECK(std::fabs(pn.orbitAfter.apoapsisAltM - pn.orbitAfter.periapsisAltM) < 5.0e3);

  // And RADIAL: rotates the line of apsides, so both apsides move away from
  // 80 km in opposite directions while the period barely changes.
  mn::Node nr;
  nr.radialMS = kDvHand;
  const mn::Plan pr = mn::plan(now, kMu, kR, craft, nr);
  CHECK(pr.orbitAfter.apoapsisAltM > 80.0e3 + 1.0e3);
  CHECK(pr.orbitAfter.periapsisAltM < 80.0e3 - 1.0e3);
  CHECK_NEAR(pr.orbitAfter.periodS / p.orbitBefore.periodS, 1.0, 0.02);
}

TEST(the_node_basis_is_taken_at_the_node_and_not_at_the_ship) {
  // On an ellipse, prograde a quarter-orbit away points somewhere else
  // entirely. If the basis were evaluated at the ship, a node placed at
  // apoapsis would burn in the wrong direction and would still produce a
  // plausible-looking (and wrong) predicted orbit.
  orbital::StateVector e = circular80km();
  e.v = e.v * 1.25;
  const Vessel craft = upperStageOnly();

  const mn::Basis atShip = mn::basisAt(e);
  const orbital::Elements el = orbital::stateToElements(e, kMu, 0.0);
  const double halfPeriod = 0.5 * orbital::orbitalPeriod(el.a, kMu);

  mn::Node n;
  n.tFromNowS = halfPeriod;   // apoapsis of this ellipse
  n.progradeMS = 50.0;
  const mn::Plan p = mn::plan(e, kMu, kR, craft, n);

  // Half an orbit later prograde is very nearly reversed.
  CHECK(p.basis.prograde.dot(atShip.prograde) < -0.99);
  CHECK_NEAR(p.burnDirection.dot(p.basis.prograde), 1.0, 1e-12);

  // Burning prograde at apoapsis raises the PERIAPSIS, which is the whole
  // reason a node exists. Burning "prograde" as measured at the ship would
  // lower it instead, so this assertion has a wrong answer to fail against.
  CHECK(p.orbitAfter.periapsisAltM > p.orbitBefore.periapsisAltM + 1.0e3);
  CHECK_NEAR(p.orbitAfter.apoapsisAltM, p.orbitBefore.apoapsisAltM, 200.0);
}

// =============================================================================
// §3 - the burn: duration, lead, feasibility.
// =============================================================================
TEST(burn_duration_inverts_tsiolkovsky_and_the_lead_is_half_of_it) {
  const Vessel craft = upperStageOnly();

  // Prove the fixture is the vehicle the hand computation was done on.
  const StagePerformance sp = stagePerformance(craft, 1);
  CHECK_NEAR(sp.startMassKg, 3705.0, 1e-6);
  CHECK_NEAR(sp.endMassKg, 1555.0, 1e-6);
  CHECK_NEAR(sp.ispVacuumS, 360.0, 1e-9);
  CHECK_NEAR(sp.massFlowKgS, 16.9953, 1e-4);

  const mn::BurnEstimate e = mn::estimateBurn(craft, kDvHand);
  CHECK_NEAR(e.durationS, kBurnHand, 1e-3);
  CHECK_NEAR(e.leadS, kLeadHand, 1e-3);
  CHECK_NEAR(e.leadS * 2.0, e.durationS, 1e-12);
  CHECK(e.feasible);
  CHECK_NEAR(e.shortfallMS, 0.0, 1e-12);
  CHECK(e.stagesUsed == 1);

  // The PROPERTY, independent of the hand number: the propellant the duration
  // implies is exactly the propellant Tsiolkovsky says that delta-v costs.
  const double burnedKg = e.durationS * sp.massFlowKgS;
  const double m1 = sp.startMassKg - burnedKg;
  CHECK_NEAR(tsiolkovsky(sp.ispVacuumS, sp.startMassKg, m1), kDvHand, 1e-6);

  // Spending the stage's WHOLE delta-v takes exactly the stage's own burn
  // time, which vessel.h computed by a different route (propellant / mdot).
  const mn::BurnEstimate full = mn::estimateBurn(craft, sp.deltaVVacuumMS);
  CHECK_NEAR(full.durationS, sp.burnTimeS, 1e-6);

  // Zero delta-v is a zero burn and is feasible, not a divide by zero.
  const mn::BurnEstimate none = mn::estimateBurn(craft, 0.0);
  CHECK_NEAR(none.durationS, 0.0, 1e-12);
  CHECK(none.feasible);
}

TEST(a_node_that_costs_more_than_the_ship_carries_says_so) {
  const Vessel craft = upperStageOnly();
  const double have = remainingDeltaVVacuumMS(craft);
  CHECK(have > 3000.0);   // the fixture's upper stage is 3065 m/s

  const mn::BurnEstimate ok = mn::estimateBurn(craft, have - 1.0);
  CHECK(ok.feasible);
  CHECK_NEAR(ok.shortfallMS, 0.0, 1e-12);

  // One metre per second past what is aboard is infeasible. A threshold that
  // only fails at 9000 m/s would pass against a broken comparison.
  const mn::BurnEstimate over = mn::estimateBurn(craft, have + 1.0);
  CHECK(!over.feasible);
  CHECK_NEAR(over.shortfallMS, 1.0, 1e-6);

  const mn::BurnEstimate way = mn::estimateBurn(craft, 9000.0);
  CHECK(!way.feasible);
  CHECK_NEAR(way.shortfallMS, 9000.0 - have, 1e-6);
  // An infeasible burn still reports a duration, and it is the time the ship
  // would burn before running dry. Reporting 0 or infinity there would be a
  // readout that says nothing on the one occasion it matters.
  CHECK(way.durationS > 100.0);

  // The plan carries the same answer, so a caller reads it in one place.
  mn::Node n; n.progradeMS = 9000.0;
  const mn::Plan p = mn::plan(circular80km(), kMu, kR, craft, n);
  CHECK(!p.burn.feasible);
  CHECK_NEAR(p.burn.deltaVAvailableMS, have, 1e-9);
}

// =============================================================================
// §4 - the path the map draws.
// =============================================================================
TEST(the_sampled_path_is_the_conic_and_its_apsides_are_where_it_says) {
  orbital::StateVector e = circular80km();
  e.v = e.v * 1.18;                  // a decent ellipse, periapsis where we are
  const mn::Path path = mn::samplePath(e, kMu, kR, 128);

  CHECK(path.bound);
  CHECK(path.points.size() == 128);

  const double ra = path.apoapsisAltM + kR;
  const double rp = path.periapsisAltM + kR;
  CHECK(ra > rp + 1.0e3);

  // Every sampled point lies on the conic: its radius is inside [rp, ra] and
  // its specific energy matches the orbit's. The energy check is the one that
  // would catch a rotation bug, because a rotated ellipse still has radii in
  // range.
  const double energy = orbital::specificEnergy(e, kMu);
  double rmin = 1e300, rmax = 0.0;
  for (const Vec3& q : path.points) {
    const double r = q.length();
    rmin = std::fmin(rmin, r);
    rmax = std::fmax(rmax, r);
    CHECK(r >= rp - 1.0 && r <= ra + 1.0);
  }
  // E-uniform sampling reaches both apsides essentially exactly (a
  // time-uniform sweep would miss periapsis by a visible margin).
  CHECK_NEAR(rmin, rp, 1.0);
  CHECK_NEAR(rmax, ra, 1.0);
  CHECK_NEAR(path.apoapsis.length(), ra, 1.0);
  CHECK_NEAR(path.periapsis.length(), rp, 1.0);
  CHECK_NEAR(-kMu / (2.0 * path.semiMajorAxisM), energy, 1e-6);

  // The apsis TIMES are mean-anomaly arithmetic; check them against an
  // independent route, the universal-variable propagator.
  CHECK(path.timeToApoapsisS >= 0.0);
  CHECK(path.timeToPeriapsisS >= 0.0);
  CHECK_NEAR(orbital::propagate(e, path.timeToApoapsisS, kMu).r.length(), ra, 1.0);
  CHECK_NEAR(orbital::propagate(e, path.timeToPeriapsisS, kMu).r.length(), rp, 1.0);

  // We start AT periapsis, so the time to it is one full period and the time
  // to apoapsis is half of one.
  CHECK_NEAR(path.timeToApoapsisS, 0.5 * path.periodS, 1.0);

  // The orbit is in the XZ plane, so its pole is +/-Y: inclination is 0 or pi
  // against the world's OWN pole. orbital::Elements::i would say 90 degrees
  // here, which is the mislabel PH-40 exists to avoid.
  const double incDeg = path.inclinationRad * 180.0 / orbital::kPi;
  CHECK(incDeg < 1.0 || incDeg > 179.0);
  CHECK_NEAR(orbital::stateToElements(e, kMu, 0.0).i * 180.0 / orbital::kPi,
             90.0, 1e-6);
}

// =============================================================================
// §5 - the four new SAS modes point at the same triad the node's handles use.
// =============================================================================
TEST(sas_points_at_the_orbital_triad_the_node_handles_are_expressed_in) {
  const orbital::StateVector c = circular80km();
  FlightState s;
  s.posM = c.r;
  s.velMS = c.v;
  const mn::Basis b = mn::basisAt(c);
  const Vec3 zero{0, 0, 0};

  CHECK_NEAR(sasTarget(SasMode::Prograde, s, zero, zero).dot(b.prograde), 1.0, 1e-12);
  CHECK_NEAR(sasTarget(SasMode::Retrograde, s, zero, zero).dot(b.prograde), -1.0, 1e-12);
  CHECK_NEAR(sasTarget(SasMode::Normal, s, zero, zero).dot(b.normal), 1.0, 1e-12);
  CHECK_NEAR(sasTarget(SasMode::Antinormal, s, zero, zero).dot(b.normal), -1.0, 1e-12);
  CHECK_NEAR(sasTarget(SasMode::RadialOut, s, zero, zero).dot(b.radialOut), 1.0, 1e-12);
  CHECK_NEAR(sasTarget(SasMode::RadialIn, s, zero, zero).dot(b.radialOut), -1.0, 1e-12);

  // The four new modes are distinct directions, not four names for one. This
  // is the assertion that would fail if a copy-paste left two cases equal.
  CHECK(sasTarget(SasMode::Normal, s, zero, zero)
            .dot(sasTarget(SasMode::RadialOut, s, zero, zero)) < 1e-9);
  CHECK(sasTarget(SasMode::Normal, s, zero, zero)
            .dot(sasTarget(SasMode::Prograde, s, zero, zero)) < 1e-9);

  // The existing five values did not move, which is what keeps the bridge, the
  // client constants and every shipped probe speaking the same language.
  CHECK(static_cast<int>(SasMode::Off) == 0);
  CHECK(static_cast<int>(SasMode::Hold) == 1);
  CHECK(static_cast<int>(SasMode::Prograde) == 2);
  CHECK(static_cast<int>(SasMode::Retrograde) == 3);
  CHECK(static_cast<int>(SasMode::Command) == 4);
  CHECK(static_cast<int>(SasMode::RadialOut) == 8);
}

// =============================================================================
// §6 - THE ACCEPTANCE.
//
// Plan a node, fly the burn it describes exactly as it describes it, and check
// the orbit that comes out against the orbit that was predicted. This is the
// only test in the file that can catch a node which is internally consistent
// and unflyable.
// =============================================================================

struct FlownResult {
  OrbitSummary orbit;
  double burnedS = 0.0;
  double deltaVAchievedMS = 0.0;   // the integrated thrust impulse, not |dv|
};

// The step the driver flies at. 0.002 s is deliberately finer than the 1/60 s
// the client runs, because the burn's START and STOP are quantised to it: at
// 1/60 a 5.52 s burn can only be resolved to 0.3%, which is 0.3 m/s, which is
// 400 m of apoapsis. Measured, so this is not a guess: the SAME code at
// dt 0.02 lands 414.7 m high and at dt 0.002 lands 19.4 m low. Testing the
// node against the coarse number would have been testing the driver's clock.
static const double kDriverDt = 0.002;

// Fly the plan. `leadFraction` is how much of the burn is spent BEFORE the
// node: 0.5 is what the node publishes, 0.0 is the mistake it exists to stop.
static FlownResult flyTheNode(const mn::Plan& p, double leadFraction) {
  FlightSim sim;
  sim.craft = upperStageOnly();
  sim.env = forgeEnv();
  sim.state.posM = circular80km().r;
  sim.state.velMS = circular80km().v;
  // Hold the node's own published direction. This is exactly what a hold-node
  // SAS mode does, and it is why the plan publishes a direction at all.
  sim.state.forward = p.burnDirection;
  sim.state.right = orbital::normalized(orbital::cross(p.basis.normal, p.burnDirection));
  sim.sas = SasMode::Command;
  sim.sasCommand = p.burnDirection;
  sim.state.throttle = 0.0;

  const double startS = p.timeToNodeS - p.burn.durationS * leadFraction;
  const double endS = startS + p.burn.durationS;

  FlownResult out;
  const int steps = static_cast<int>((endS + 10.0) / kDriverDt) + 2;
  for (int i = 0; i < steps; ++i) {
    const double t = sim.state.timeS;
    if (t >= endS) break;
    const bool burning = (t >= startS);
    sim.state.throttle = burning ? 1.0 : 0.0;
    sim.step(kDriverDt);
    if (burning) {
      out.burnedS += kDriverDt;
      // The thrust impulse actually delivered, read off the sim's own
      // telemetry. |v_after - v_before| would be useless here: over a coast
      // the velocity VECTOR rotates through the whole orbit, so that
      // difference is thousands of m/s of pure geometry.
      out.deltaVAchievedMS +=
          sim.telemetry.thrustN / sim.telemetry.massKg * kDriverDt;
    }
  }
  out.orbit = summarize(sim.orbitalState(), sim.env.muM3S2, sim.env.bodyRadiusM);
  return out;
}

TEST(the_orbit_a_node_predicts_is_the_orbit_the_burn_actually_reaches) {
  const orbital::StateVector now = circular80km();
  const Vessel craft = upperStageOnly();

  mn::Node n;
  n.tFromNowS = 30.0;           // plan it half a minute ahead, as a player would
  n.progradeMS = kDvHand;
  const mn::Plan p = mn::plan(now, kMu, kR, craft, n);

  CHECK(p.burn.feasible);
  CHECK_NEAR(p.timeToBurnStartS, 30.0 - kLeadHand, 1e-2);
  CHECK_NEAR(p.orbitAfter.apoapsisAltM, 200.0e3, 1.0);

  const FlownResult flown = flyTheNode(p, 0.5);

  // The burn really happened, and for the time and the delta-v the node said.
  // DW-20: a probe proves its own setup before its measurement is trusted, and
  // this is the setup - if the driver did not burn, the orbit check below
  // would be comparing two coasts.
  CHECK_NEAR(flown.burnedS, p.burn.durationS, 2.0 * kDriverDt);
  CHECK_NEAR(flown.deltaVAchievedMS, kDvHand, 0.05);

  // THE ASSERTION THAT MATTERS: a node that predicts an orbit you cannot fly
  // to is worse than no node.
  //
  // Tolerances are the MEASURED residue plus headroom, and they are stated as
  // fractions so they mean something: 100 m on a 200 km apoapsis is 0.05%
  // (measured 19.4 m), 5 m on the periapsis is 6e-5 (measured 0.0 m). The
  // residue is the finite-burn error of an impulsive plan and it is real
  // physics, not slack.
  CHECK_NEAR(flown.orbit.apoapsisAltM, p.orbitAfter.apoapsisAltM, 100.0);
  CHECK_NEAR(flown.orbit.periapsisAltM, p.orbitAfter.periapsisAltM, 5.0);
  CHECK_NEAR(flown.orbit.periodS, p.orbitAfter.periodS, 1.0);
}

TEST(leading_the_burn_by_half_its_duration_is_load_bearing) {
  // PH-38's whole justification, measured. A LONG burn is used because that is
  // where the difference lives: on a 5.5 s burn from a circular orbit the two
  // are within 5 m of each other, because a circular orbit is the same at
  // every point and there is nothing for the lead to centre ON. At 44 s there
  // is, and the answer is not subtle.
  const orbital::StateVector now = circular80km();
  const Vessel craft = upperStageOnly();

  mn::Node n;
  n.tFromNowS = 60.0;
  n.progradeMS = 800.0;         // stays bound: escape from here needs 944 m/s
  const mn::Plan p = mn::plan(now, kMu, kR, craft, n);
  CHECK(p.burn.feasible);
  CHECK(p.burn.durationS > 40.0);
  CHECK(p.orbitAfter.bound);

  const FlownResult led = flyTheNode(p, 0.5);
  const FlownResult late = flyTheNode(p, 0.0);

  // Both spent the same delta-v. That is what makes this a control: the ONLY
  // difference between the two flights is when the burn was centred.
  CHECK_NEAR(led.deltaVAchievedMS, 800.0, 0.1);
  CHECK_NEAR(late.deltaVAchievedMS, 800.0, 0.1);
  // Within one step of each other: the two start times land on different sides
  // of a tick boundary, which is the driver's clock and not a difference in
  // the burn.
  CHECK_NEAR(led.burnedS, late.burnedS, 1.5 * kDriverDt);

  // Led: the periapsis the node promised, held to a metre. Late: 302 m below
  // it. The node's own advice is worth 300 m of periapsis on one burn.
  CHECK_NEAR(led.orbit.periapsisAltM, p.orbitAfter.periapsisAltM, 5.0);
  CHECK(std::fabs(late.orbit.periapsisAltM - p.orbitAfter.periapsisAltM) > 100.0);
  CHECK(std::fabs(late.orbit.periapsisAltM - p.orbitAfter.periapsisAltM) >
        50.0 * std::fabs(led.orbit.periapsisAltM - p.orbitAfter.periapsisAltM));

  // And on the apoapsis, where the numbers are big: led is 0.61% low, late is
  // 1.95% low. Both are the finite-burn residue of a 44 s burn against an
  // impulsive plan, and it is REPORTED rather than hidden: `Plan` publishes
  // burnFractionOfPeriod so a caller can say "this burn is too long for the
  // prediction to be tight" instead of quietly being 40 km out.
  CHECK(std::fabs(led.orbit.apoapsisAltM - p.orbitAfter.apoapsisAltM) <
        0.01 * p.orbitAfter.apoapsisAltM);
  CHECK(std::fabs(late.orbit.apoapsisAltM - p.orbitAfter.apoapsisAltM) >
        2.0 * std::fabs(led.orbit.apoapsisAltM - p.orbitAfter.apoapsisAltM));
  CHECK(p.burn.burnFractionOfPeriod > 0.02);

  // The short burn of the previous test is the other end of that scale, and it
  // is under a third of a percent of an orbit.
  mn::Node s; s.progradeMS = kDvHand;
  CHECK(mn::plan(now, kMu, kR, craft, s).burn.burnFractionOfPeriod < 0.003);
}

// =============================================================================
// TRANSFERS, WINDOWS AND THE FUEL GATE (PH-146, of/transfer.h).
//
// Reid's ask, in the order he asked it: "tell me if there is enough fuel on the
// current rocket to rendezvous with the destination", then "a chart showing how
// optimal the current time would be to launch vs waiting later in terms of fuel
// burn", then "do not let me program a destination I cannot reach, but do let me
// set a later time if I will be able to reach it then".
//
// Every one of those sentences is a delta-v figure being true, which is why R43
// had to be closed before any of this was worth building.
//
// The target is `Anchorage`: a 400 km circular orbit about Forge, r = 1e6 m
// exactly (`SpaceStation.ts` mints it at a = 1000000.0000000002, e = 1.3e-16).
// =============================================================================
namespace tr = of::transfer;

static orbital::Elements circularAbout(double radiusM, double mu, double phaseRad) {
  const Vec3 r(radiusM * std::cos(phaseRad), 0.0, -radiusM * std::sin(phaseRad));
  const double v = std::sqrt(mu / radiusM);
  const Vec3 vel(-v * std::sin(phaseRad), 0.0, -v * std::cos(phaseRad));
  return orbital::park(orbital::StateVector{r, vel}, mu, 0.0);
}

// -----------------------------------------------------------------------------
// The transfer itself, against the closed form. A vehicle in an 80 km circular
// orbit (r = 680 km, the orbit every other test in this file uses) going to
// Anchorage at r = 1000 km:
//
//   v1c = sqrt(mu / 680e3)                    = 2278.931638 m/s
//   v2c = sqrt(mu / 1000e3)                   = 1879.255172 m/s
//   aT  = 840e3,  vP = sqrt(mu(2/r1 - 1/aT))  = 2486.518270 m/s
//                 vA = sqrt(mu(2/r2 - 1/aT))  = 1690.832424 m/s
//   dv1 = 207.586632,  dv2 = 188.422748,  total 396.009380 m/s
//   Hohmann time = pi sqrt(aT^3 / mu) = 1287.013338 s
// -----------------------------------------------------------------------------
TEST(a_transfer_to_a_station_costs_what_the_closed_form_says) {
  const double r1 = kR1, r2 = 1.0e6;
  const double v1c = std::sqrt(kMu / r1), v2c = std::sqrt(kMu / r2);
  const double aT = 0.5 * (r1 + r2);
  const double vP = std::sqrt(kMu * (2.0 / r1 - 1.0 / aT));
  const double vA = std::sqrt(kMu * (2.0 / r2 - 1.0 / aT));
  const double dv1 = vP - v1c, dv2 = v2c - vA;
  CHECK_NEAR(dv1, 207.586632, 1e-5);
  CHECK_NEAR(dv2, 188.422748, 1e-5);
  CHECK_NEAR(tr::hohmannTimeS(r1, r2, kMu), 1287.013338, 1e-5);

  // Put the station where a Hohmann would land: half a revolution ahead of the
  // vehicle, minus what the station itself travels during the flight.
  const double tH = tr::hohmannTimeS(r1, r2, kMu);
  const double stationRate = std::sqrt(kMu / (r2 * r2 * r2));   // rad/s
  tr::Target tgt;
  tgt.el = circularAbout(r2, kMu, orbital::kPi - stationRate * tH);
  tgt.dockingRadiusM = 0.60;
  CHECK(!tgt.isBody());

  const orbital::Elements ship = circularAbout(r1, kMu, 0.0);
  // 0.999 of the Hohmann time, because a 180 degree sweep is exactly the
  // collinear case Lambert is singular on (pinned in test_physics.cpp).
  const tr::Transfer t = tr::solveTransfer(ship, tgt, 0.0, tH * 0.999);
  CHECK(t.valid);
  // It lands ON the station, which is the check that would catch a clock or a
  // frame error before any delta-v number is believed.
  CHECK(t.missDistanceM < 1e-6);
  CHECK_NEAR(t.departDvMS, dv1, 0.5);
  CHECK_NEAR(t.arriveDvMS, dv2, 0.5);
  CHECK(t.totalDvMS >= dv1 + dv2);          // nothing beats Hohmann
  CHECK(t.totalDvMS - (dv1 + dv2) < 0.5);
  // The arrival burn is a velocity MATCH for a vessel target, so flying it puts
  // the two at rest with respect to each other.
  CHECK((t.transferEnd.v + t.arriveDv - t.targetState.v).length() < 1e-6);
}

// -----------------------------------------------------------------------------
// THE CHART. Delta-v as a function of DEPARTURE TIME, which is the artefact Reid
// asked for and the reason this publishes a sampled curve rather than one best
// number.
//
// Two coplanar circular orbits have a phase angle that drifts, so the cost of
// leaving NOW depends on where the station happens to be, and the curve must
// have a real minimum somewhere inside one synodic period.
// -----------------------------------------------------------------------------
TEST(the_departure_window_is_a_curve_with_a_real_minimum) {
  const double r1 = kR1, r2 = 1.0e6;
  const orbital::Elements ship = circularAbout(r1, kMu, 0.0);
  tr::Target tgt;
  tgt.el = circularAbout(r2, kMu, 0.35);    // deliberately a bad phase right now

  const double syn = tr::synodicPeriodS(r1, r2, kMu);
  CHECK(syn > 0.0);
  // Periods 1874.81 s and 3343.44 s, so the geometry comes round every 4268 s.
  CHECK_NEAR(orbital::orbitalPeriod(r1, kMu), 1874.810958, 1e-4);
  CHECK_NEAR(orbital::orbitalPeriod(r2, kMu), 3343.444468, 1e-4);
  CHECK_NEAR(syn, 4268.135166, 1e-3);

  const tr::Window w = tr::scanWindow(ship, tgt, 0.0, 0.0, 48, 24);
  CHECK(static_cast<int>(w.samples.size()) == 48);
  CHECK(w.validCount == 48);                 // every departure admits a transfer
  CHECK_NEAR(w.horizonS, syn, 1e-9);         // horizon 0 asks for one synodic
  CHECK(w.bestIndex >= 0);

  // A CURVE, not a constant: waiting genuinely changes the price.
  CHECK(w.maxDvMS > w.minDvMS * 1.05);
  // and the minimum is INSIDE the scan rather than at an end, which is what
  // makes "wait until t" an answer rather than "leave now" or "leave last".
  CHECK(w.bestIndex > 0);
  CHECK(w.bestIndex < 47);
  // The cheapest departure is a Hohmann, so it cannot beat the closed form.
  const double hohmann = 207.586632 + 188.422748;   // 396.009380
  CHECK(w.minDvMS >= hohmann);
  CHECK(w.minDvMS < hohmann + 5.0);
  // and the sample the index points at is the one the window published.
  CHECK_NEAR(w.samples[static_cast<size_t>(w.bestIndex)].totalDvMS, w.minDvMS, 1e-12);
  CHECK(w.best.valid);
  CHECK_NEAR(w.best.totalDvMS, w.minDvMS, 1e-9);
  CHECK(w.best.missDistanceM < 1e-6);
  // Every sample's own time of flight stays inside the single-revolution bound
  // the scan set, which is the rule that keeps Lambert answering the question
  // it was asked (test_physics.cpp pins what happens when it does not).
  for (const tr::WindowSample& s : w.samples) {
    if (!s.valid) continue;
    CHECK(s.timeOfFlightS >= w.tofMinS - 1e-9);
    CHECK(s.timeOfFlightS <= w.tofMaxS + 1e-9);
    CHECK(s.timeOfFlightS < orbital::orbitalPeriod(r2, kMu));
    CHECK_NEAR(s.totalDvMS, s.departDvMS + s.arriveDvMS, 1e-9);
  }
}

// -----------------------------------------------------------------------------
// THE GATE. "It should not let you program in a destination for autopilot if you
// do not have enough fuel to reach it, but you should be able to set it to a
// later time if you don't have enough fuel right now but will at a more optimal
// time." That is three distinct verdicts and this pins all three.
// -----------------------------------------------------------------------------
TEST(the_fuel_gate_tells_now_from_later_from_never) {
  const double r1 = kR1, r2 = 1.0e6;
  const orbital::Elements ship = circularAbout(r1, kMu, 0.0);
  tr::Target tgt;
  tgt.el = circularAbout(r2, kMu, 0.35);

  // The reference vehicle's upper stage, in orbit with its lower stage gone.
  Ascender a = makeAscender();
  Vessel craft = a.v;
  craft.nextStageIndex = 2;
  const double available = remainingDeltaVVacuumMS(craft);
  CHECK_NEAR(available, 3065.115301, 1e-5);

  const tr::Verdict rich = tr::verdictFor(craft, ship, tgt, 0.0, 0.0, 48, 24);
  CHECK(rich.anyTransferExists);
  CHECK(rich.feasibleNow);
  CHECK(rich.feasibleLater);
  // Waiting saves something real, and it is reported as a number rather than a
  // recommendation.
  CHECK(rich.savingByWaitingMS > 1.0);
  CHECK_NEAR(rich.nowTotalDvMS - rich.bestTotalDvMS, rich.savingByWaitingMS, 1e-9);
  CHECK(rich.budgetNow.marginMS > 0.0);
  CHECK(rich.budgetBest.marginMS > rich.budgetNow.marginMS);
  CHECK_NEAR(rich.budgetBest.availableMS, available, 1e-9);
  // Both burns are billed, and the second on the mass left after the first.
  CHECK(rich.budgetBest.departBurnS > 0.0);
  CHECK(rich.budgetBest.arriveBurnS > 0.0);

  // NOW DRAIN IT to between the two prices: it cannot go yet, but it can go at
  // the window. This is the case Reid named, and it is the reason the verdict
  // carries two booleans rather than one.
  Vessel poor = craft;
  {
    const double want = rich.bestTotalDvMS + 2.0;
    for (auto& p : poor.parts)
      if (poor.def(p).propellant == Propellant::LiquidFuel) p.propellantKg = 0.0;
    for (auto& p : poor.parts) {
      if (poor.def(p).propellant != Propellant::LiquidFuel) continue;
      double lo = 0.0, hi = poor.def(p).propellantCapacityKg;
      for (int i = 0; i < 200; ++i) {
        const double mid = 0.5 * (lo + hi);
        p.propellantKg = mid;
        if (remainingDeltaVVacuumMS(poor) < want) lo = mid; else hi = mid;
      }
      p.propellantKg = 0.5 * (lo + hi);
      break;
    }
  }
  const double poorDv = remainingDeltaVVacuumMS(poor);
  CHECK_NEAR(poorDv, rich.bestTotalDvMS + 2.0, 0.5);
  CHECK(poorDv < rich.nowTotalDvMS);          // cannot afford to leave now
  CHECK(poorDv > rich.bestTotalDvMS);         // can afford the window

  const tr::Verdict later = tr::verdictFor(poor, ship, tgt, 0.0, 0.0, 48, 24);
  CHECK(later.anyTransferExists);
  CHECK(!later.feasibleNow);                  // REFUSED right now
  CHECK(later.feasibleLater);                 // ALLOWED at later.bestDepartS
  CHECK(later.bestDepartS > 0.0);
  CHECK(later.budgetNow.marginMS < 0.0);
  CHECK(later.budgetBest.marginMS > 0.0);

  // THE EARLIEST FLYABLE DEPARTURE IS NOT THE CHEAPEST ONE, which the gameplay
  // lane raised and which a screen conflating the two would get wrong. On the
  // rich vehicle it can leave immediately and the two answers are far apart; on
  // the drained one it must wait, and even then the first window it can pay for
  // comes BEFORE the optimum.
  CHECK(rich.anyFeasible);
  CHECK(rich.firstFeasibleIndex == 0);        // it can afford to go right now
  CHECK(rich.firstFeasibleDepartS < rich.bestDepartS);
  CHECK(rich.firstFeasibleTotalDvMS > rich.bestTotalDvMS);   // and pay for it

  CHECK(later.anyFeasible);
  CHECK(later.firstFeasibleIndex > 0);        // not now
  CHECK(later.firstFeasibleDepartS > 0.0);
  CHECK(later.firstFeasibleDepartS <= later.bestDepartS);
  CHECK(later.firstFeasibleTotalDvMS <= later.budgetBest.availableMS);
  CHECK(later.firstFeasibleTotalDvMS >= later.bestTotalDvMS);

  // And a vehicle that cannot make it at ANY departure is refused outright,
  // rather than being offered a time that would not work either.
  Vessel empty = craft;
  for (auto& p : empty.parts) p.propellantKg = 0.0;
  const tr::Verdict never = tr::verdictFor(empty, ship, tgt, 0.0, 0.0, 48, 24);
  CHECK(never.anyTransferExists);             // the GEOMETRY is fine
  CHECK(!never.feasibleNow);
  CHECK(!never.feasibleLater);                // the VEHICLE is not
  CHECK(!never.anyFeasible);
  CHECK(never.firstFeasibleIndex == -1);      // there is no such window
  CHECK(never.budgetBest.availableMS == 0.0);
}

// -----------------------------------------------------------------------------
// A BODY IS NOT A SPECIAL CASE. Cinder orbits Forge at 1.2e7 m (sim_world.h
// `kCinderOrbitRadiusM`), well inside Forge's 8.4e7 m SOI, so flying to the moon
// is the SAME same-primary Lambert as flying to the station. The one thing that
// differs is what arrival costs, and this measures that difference rather than
// asserting the code path exists.
// -----------------------------------------------------------------------------
TEST(a_moon_is_the_same_transfer_with_a_cheaper_arrival) {
  const double r1 = kR1, rMoon = 1.2e7;
  const orbital::Elements ship = circularAbout(r1, kMu, 0.0);

  const double tH = tr::hohmannTimeS(r1, rMoon, kMu);
  const double rate = std::sqrt(kMu / (rMoon * rMoon * rMoon));

  tr::Target moon;
  moon.el = circularAbout(rMoon, kMu, orbital::kPi - rate * tH);
  moon.muM3S2 = orbital::kCinderMu;
  moon.soiRadiusM = orbital::kCinderSoiRadius;
  moon.bodyRadiusM = orbital::kCinderRadiusM;
  moon.captureAltitudeM = 50.0e3;
  CHECK(moon.isBody());

  // The same target with its gravity removed: identical geometry, arrival billed
  // as a velocity match instead of a capture.
  tr::Target asIfVessel = moon;
  asIfVessel.muM3S2 = 0.0;
  asIfVessel.soiRadiusM = 0.0;
  CHECK(!asIfVessel.isBody());

  const tr::Transfer body = tr::solveTransfer(ship, moon, 0.0, tH * 0.999);
  const tr::Transfer vess = tr::solveTransfer(ship, asIfVessel, 0.0, tH * 0.999);
  CHECK(body.valid && vess.valid);
  CHECK(body.missDistanceM < 1e-4 && vess.missDistanceM < 1e-4);

  // THIS ASSERTION USED TO READ "the injection burn is IDENTICAL to the last
  // bit", and PH-159 made it FALSE on purpose. A body is now AIMED OFF-CENTRE,
  // because a Lambert that aims at a moon's centre delivers the vehicle to the
  // moon's centre: measured, periapsis 1214.7 m against a 200000 m body radius,
  // which `planCapture` correctly refused as "enters, and hits the surface".
  // The injection therefore differs by the few m/s the offset costs, and the
  // claim that survives is the one that mattered: the two trips are the same
  // Lambert differing in ARRIVAL, and the difference is small.
  CHECK(std::fabs(body.departDvMS - vess.departDvMS) < 10.0);
  CHECK(body.departDvMS != vess.departDvMS);      // aimed, not centred
  CHECK(body.aimOffsetM > 0.0);
  CHECK(vess.aimOffsetM == 0.0);                  // a vessel is aimed AT
  // The arrival is the real difference. Capturing into a 50 km orbit is
  // cheaper than matching, because the moon's own gravity does part of the work.
  CHECK(body.arriveDvMS < vess.arriveDvMS);
  CHECK(body.arriveDvMS > 0.0);
  // Hand check on the ARRIVAL COST MODEL, which prices the capture at the
  // requested radius: r_c = 200 km + 50 km = 250 km,
  // dv = sqrt(v_inf^2 + 2 mu_c / r_c) - sqrt(mu_c / r_c).
  {
    const double vInf = (body.transferEnd.v - body.targetState.v).length();
    const double rc = orbital::kCinderRadiusM + 50.0e3;
    const double hand = std::sqrt(vInf * vInf + 2.0 * orbital::kCinderMu / rc)
                        - std::sqrt(orbital::kCinderMu / rc);
    CHECK_NEAR(body.arriveDvMS, hand, 1e-9);
  }
  // A flyby costs nothing at all on arrival, which is the third case and needs
  // no third code path.
  tr::Target flyby = moon;
  flyby.captureAltitudeM = 0.0;
  const tr::Transfer past = tr::solveTransfer(ship, flyby, 0.0, tH * 0.999);
  CHECK(past.valid);
  CHECK(past.arriveDvMS == 0.0);
  CHECK(past.totalDvMS == past.departDvMS);
}

// =============================================================================
// THE FIVE LEGS THE REACH ROW DRAWS (PH-147, transfer.h §5 and §6).
//
// Admin's rule for this work was "either compute them or say the split is wrong,
// and do not publish a zero into a field a screen will draw". Four of the five
// are computed here and the fifth is a policy that is named as one. The two
// zeros that DO appear are physical (a launch pays nothing for its plane, a
// craft already in orbit pays nothing for ascent) and both are asserted as
// zeros-that-mean-zero rather than left unexamined.
// =============================================================================

// -----------------------------------------------------------------------------
// The ascent leg is CALIBRATED against this project's own flown ascent, and it
// refuses every body it has not flown off.
//
//   flight_tests: Ascender I, Forge pad to 86.9 x 75.5 km, 1200 m/s left of
//   4922.91, so 3722.91 m/s spent to a mean radius of 681.2 km whose circular
//   speed is 2276.9235. Losses 1445.9865 against a surface circular speed of
//   2426.107994, which is a fraction of 0.596011.
//
//   The published constants are 0.3500 + 0.2459 = 0.5959, so the model returns
//   3724.649392 against the 3722.91 that was flown: 1.74 m/s, or 0.047%.
// -----------------------------------------------------------------------------
TEST(the_ascent_leg_reproduces_the_ascent_this_project_actually_flew) {
  const double R = orbital::kForgeRadiusM;
  const double rPark = R + tr::kParkingAltitudeM;
  CHECK_NEAR(std::sqrt(kMu / rPark), 2278.931638, 1e-5);
  CHECK_NEAR(std::sqrt(kMu / R), 2426.107994, 1e-5);

  const tr::AscentCost a = tr::ascentDvMS(kMu, R, rPark, true);
  CHECK(a.calibrated);
  CHECK_NEAR(a.deltaVMS, 3724.649392, 1e-4);
  // Against the flown figure, which is the whole point of a calibration.
  CHECK(std::fabs(a.deltaVMS - 3722.91) < 2.0);

  // No atmosphere on the same body drops exactly the drag fraction and nothing
  // else, so the two constants are separable in the answer as well as in source.
  const tr::AscentCost dry = tr::ascentDvMS(kMu, R, rPark, false);
  CHECK(dry.calibrated);
  CHECK_NEAR(a.deltaVMS - dry.deltaVMS,
             2426.107994 * tr::kAscentDragLossFraction, 1e-6);

  // AND IT REFUSES A BODY IT HAS NEVER FLOWN OFF. A 35% gravity loss is what an
  // atmosphere and a modest pad TWR cost; on an airless low-gravity moon you fly
  // nearly horizontally from the first second and it is a few percent. Rather
  // than publish a fraction nobody measured, this says it does not know.
  const tr::AscentCost moon = tr::ascentDvMS(orbital::kCinderMu,
                                             orbital::kCinderRadiusM,
                                             orbital::kCinderRadiusM + 10.0e3,
                                             false);
  CHECK(!moon.calibrated);
  CHECK(moon.deltaVMS == 0.0);
  // and the degenerate arguments refuse too, rather than returning a speed.
  CHECK(!tr::ascentDvMS(kMu, R, R, true).calibrated);          // orbit at the surface
  CHECK(!tr::ascentDvMS(0.0, R, rPark, true).calibrated);      // no gravity
}

// -----------------------------------------------------------------------------
// THE BAY'S ROW, end to end, on the reference vehicle. This is the number Reid's
// "is there enough fuel to get there" gate will actually print.
// -----------------------------------------------------------------------------
TEST(the_bay_prices_the_reference_rocket_to_anchorage) {
  Ascender a = makeAscender();
  const tr::MissionBudget b = tr::launchBudget(a.v, 1.0e6);   // Anchorage
  CHECK(b.ok);

  //   ascent  3724.649392   (80 km parking orbit, calibrated above)
  //   plane        0        (a launch picks its plane with its azimuth)
  //   transfer  207.586632  (Hohmann 680 km -> 1000 km, first burn)
  //   arrival   188.422748  (the circularising burn at the far end)
  //   reserve   206.032939  (5% policy, transfer.h kMissionReserveFraction)
  //   total    4326.691711  against 4922.91 aboard: margin 596.218289
  CHECK_NEAR(b.ascentMS, 3724.649392, 1e-4);
  CHECK(b.planeChangeMS == 0.0);
  CHECK_NEAR(b.transferMS, 207.586632, 1e-5);
  CHECK_NEAR(b.arrivalMS, 188.422748, 1e-5);
  CHECK_NEAR(b.reserveMS, 206.032939, 1e-4);
  CHECK_NEAR(b.totalMS, 4326.691711, 1e-3);

  // THE FIVE SUM TO THE TOTAL EXACTLY. A screen that draws five bars beside a
  // total must be able to add them up, and this is what makes that true.
  CHECK_NEAR(b.ascentMS + b.planeChangeMS + b.transferMS + b.arrivalMS
             + b.reserveMS, b.totalMS, 1e-9);
  // and the reserve is exactly the stated fraction of the four real legs.
  CHECK_NEAR(b.reserveMS,
             (b.ascentMS + b.planeChangeMS + b.transferMS + b.arrivalMS)
             * tr::kMissionReserveFraction, 1e-12);

  // The availability is the DESIGN's whole-vehicle figure, because a design on
  // the pad has fired nothing.
  //
  // 4964.635217 and NOT the 4922.91 the other suites pin, because THIS file's
  // `makeAscender` carries no fins: four at 40 kg is 160 kg off stage 0's dry
  // mass, which lifts stage 0 from 1857.79 to 1899.519915 and leaves stage 1's
  // 3065.115301 untouched. Written out because a reader who knows the reference
  // figure would otherwise think this one was wrong, and because it is the
  // cheapest possible proof that the fixture is being read rather than a
  // constant being repeated.
  CHECK_NEAR(b.availableMS, 4964.635217, 1e-4);
  CHECK_NEAR(b.availableMS, totalDeltaVVacuumMS(a.v), 1e-12);
  CHECK_NEAR(b.availableMS - 4922.91,
             330.0 * atmo::kG0 * std::log(9685.0 / 5385.0)
             - 330.0 * atmo::kG0 * std::log(9845.0 / 5545.0), 0.01);
  CHECK_NEAR(b.marginMS, 637.943506, 1e-3);
  CHECK(b.feasible);

  // A ring it cannot reach is refused rather than shrugged at: 20,000 km needs
  // far more than this rocket carries.
  const tr::MissionBudget far = tr::launchBudget(a.v, 2.0e7);
  CHECK(far.ok);                       // physics ANSWERED
  CHECK(!far.feasible);                // and the answer is no
  CHECK(far.marginMS < 0.0);
  // A target inside the planet is not an answer at all.
  CHECK(!tr::launchBudget(a.v, 1.0e5).ok);
}

// -----------------------------------------------------------------------------
// THE PLANE-CHANGE LEG IS ALLOCATED, NOT DECOMPOSED, and this is the test that
// says why. A 3D Lambert already prices the plane mismatch inside the departure
// burn, and it prices it BETTER than two separate burns would, so billing a
// textbook `2 v sin(theta/2)` beside the transfer would double-count it. What is
// published is the difference between two transfers that were both solved.
// -----------------------------------------------------------------------------
TEST(the_plane_change_leg_is_the_difference_between_two_real_transfers) {
  const double r1 = kR1, r2 = 1.0e6;
  const orbital::Elements ship = circularAbout(r1, kMu, 0.0);
  const double tH = tr::hohmannTimeS(r1, r2, kMu);
  const double rate = std::sqrt(kMu / (r2 * r2 * r2));

  Ascender a = makeAscender();
  Vessel craft = a.v;
  craft.nextStageIndex = 2;
  const tr::AscentCost none;                    // already in orbit: no ascent

  // COPLANAR FIRST. The leg must be EXACTLY zero, not nearly zero, because the
  // rotation that makes the reference is the identity when the planes match.
  tr::Target flat;
  flat.el = circularAbout(r2, kMu, orbital::kPi - rate * tH);
  const tr::Transfer tFlat = tr::solveTransfer(ship, flat, 0.0, tH * 0.999);
  CHECK(tFlat.valid);
  const tr::MissionBudget bFlat = tr::missionBudget(craft, ship, flat, tFlat, none);
  CHECK(bFlat.ok);
  CHECK(bFlat.ascentMS == 0.0);                 // a real zero: it is up already
  CHECK(bFlat.planeChangeMS == 0.0);            // a real zero: the planes match
  CHECK_NEAR(bFlat.transferMS + bFlat.arrivalMS, tFlat.totalDvMS, 1e-9);

  // NOW TILT THE TARGET. Same radius, same phase, 15 degrees out of plane.
  const double tilt = 15.0 * orbital::kPi / 180.0;
  tr::Target tilted;
  {
    const orbital::StateVector s = orbital::elementsToState(flat.el, 0.0);
    const double c = std::cos(tilt), sn = std::sin(tilt);
    // Rotate about the x axis, which is across the orbit built by circularAbout.
    auto rx = [&](const Vec3& v) { return Vec3(v.x, v.y * c - v.z * sn,
                                               v.y * sn + v.z * c); };
    tilted.el = orbital::park(orbital::StateVector{rx(s.r), rx(s.v)}, kMu, 0.0);
  }
  const tr::Transfer tTilt = tr::solveTransfer(ship, tilted, 0.0, tH * 0.999);
  CHECK(tTilt.valid);
  const tr::MissionBudget bTilt = tr::missionBudget(craft, ship, tilted, tTilt, none);
  CHECK(bTilt.ok);

  // The mismatch costs something real, and it is the WHOLE of the difference.
  CHECK(bTilt.planeChangeMS > 100.0);
  CHECK_NEAR(bTilt.transferMS + bTilt.arrivalMS + bTilt.planeChangeMS,
             tTilt.totalDvMS, 1e-9);
  // The in-plane legs are what the trip would cost with the planes matched, so
  // they are close to the coplanar case rather than inflated by the tilt.
  CHECK(std::fabs(bTilt.transferMS - bFlat.transferMS) < 5.0);
  CHECK(std::fabs(bTilt.arrivalMS - bFlat.arrivalMS) < 5.0);
  // And the whole trip really did get dearer by about the plane-change leg.
  CHECK(tTilt.totalDvMS > tFlat.totalDvMS + 100.0);

  // THE ONE THAT WOULD HAVE BEEN DOUBLE-COUNTED. Billing a separate textbook
  // plane change at the departure speed and ADDING it to the coplanar transfer
  // overstates the trip, because the 3D solve does both in one burn.
  const double vDep = orbital::elementsToState(ship, 0.0).v.length();
  const double textbook = 2.0 * vDep * std::sin(0.5 * tilt);
  CHECK(textbook > bTilt.planeChangeMS);
  CHECK(bFlat.transferMS + bFlat.arrivalMS + textbook > tTilt.totalDvMS);

  // The five still sum, on the tilted case too.
  CHECK_NEAR(bTilt.ascentMS + bTilt.planeChangeMS + bTilt.transferMS
             + bTilt.arrivalMS + bTilt.reserveMS, bTilt.totalMS, 1e-9);
  // and availability here is the REMAINING figure, not the design's total,
  // because the subject is a craft that has already burned a stage (R44b).
  CHECK_NEAR(bTilt.availableMS, remainingDeltaVVacuumMS(craft), 1e-12);
}

// =============================================================================
// HOLD THIS ORBIT: THE FIRST THING THAT ACTUALLY FLIES (PH-150, autopilot.h).
//
// Reid's fifth ask, verbatim: "You should also be able to set an automatic
// 'take it to this orbit'." Admin called it the smallest closed loop that
// proves execution, and it is: a target orbit, a burn schedule, and a vessel
// that ends up where it said it would. Everything after it is the same machine
// with a harder target.
//
// THE ASSERTION IS THE ORBIT REACHED, NOT THE PLAN AGREEING WITH ITSELF. The
// same rule as the node acceptance above it: an autopilot whose plan is
// internally consistent and unflyable is worse than no autopilot. So the driver
// below runs the REAL `FlightSim` at a real tick, applies the autopilot's own
// Command every step, and the check at the end is the summarised conic.
// =============================================================================
namespace ap = of::autopilot;

struct AutoResult {
  OrbitSummary orbit;
  double dvSpentMS = 0.0;
  double burnTicks = 0.0;
  double flownS = 0.0;
  ap::Phase phase = ap::Phase::Idle;
  const char* note = "";
  double worstPointingWhileBurningDeg = 0.0;
};

// Fly a program to completion. `dt` is the driver tick; `limitS` bounds the
// run so a program that never finishes fails as a timeout rather than hanging.
static AutoResult flyProgram(const ap::Program& prog, const Vessel& craft,
                             const orbital::StateVector& start, double dt,
                             double limitS) {
  FlightSim sim;
  sim.craft = craft;
  sim.env = forgeEnv();
  sim.state.posM = start.r;
  sim.state.velMS = start.v;
  // Start pointed PROGRADE, which is where a coasting vehicle actually is, so
  // the autopilot has to slew for itself rather than being handed the attitude.
  sim.state.forward = orbital::normalized(start.v);
  sim.state.right = orbital::normalized(orbital::cross(start.r, start.v));
  sim.sas = SasMode::Command;
  sim.sasCommand = sim.state.forward;

  ap::Autopilot pilot;
  pilot.arm(prog);

  AutoResult out;
  const int steps = static_cast<int>(limitS / dt) + 2;
  for (int i = 0; i < steps; ++i) {
    const ap::Command c = pilot.update(sim, dt);
    ap::Autopilot::apply(sim, c);
    if (pilot.status.burningNow) {
      out.burnTicks += 1.0;
      if (pilot.status.pointingErrorDeg > out.worstPointingWhileBurningDeg)
        out.worstPointingWhileBurningDeg = pilot.status.pointingErrorDeg;
    }
    sim.step(dt);
    out.flownS = sim.state.timeS;
    if (!pilot.running()) break;
  }
  out.dvSpentMS = pilot.status.dvSpentTotalMS;
  out.phase = pilot.status.phase;
  out.note = pilot.status.note;
  out.orbit = summarize(sim.orbitalState(), sim.env.muM3S2, sim.env.bodyRadiusM);
  return out;
}

// -----------------------------------------------------------------------------
// THE ACCEPTANCE. 80 km circular, asked for 200 km circular, flown.
//
// Hand figures, computed before the code ran:
//   r1 = 680 km, r2 = 800 km, aT = 740 km
//   v1 = sqrt(mu/r1)              = 2278.931638
//   vP = sqrt(mu(2/r1 - 1/aT))    = 2369.520287   burn 1 =  90.588649
//   vA = sqrt(mu(2/r2 - 1/aT))    = 2014.092244
//   v2 = sqrt(mu/r2)              = 2101.071155   burn 2 =  86.978911
//   total 177.567560 m/s, coast = pi sqrt(aT^3/mu) = 1064.171683 s
// -----------------------------------------------------------------------------
TEST(hold_this_orbit_flies_itself_to_the_orbit_it_promised) {
  const orbital::StateVector start = circular80km();
  const Vessel craft = upperStageOnly();
  const double rTarget = 800.0e3;

  const ap::Program p = ap::holdOrbit(start, 0.0, kMu, rTarget, craft);
  CHECK(p.valid);
  CHECK(p.burnCount == 2);
  CHECK_NEAR(p.burns[0].deltaVMS, 90.588649, 1e-4);
  CHECK_NEAR(p.burns[1].deltaVMS, 86.978911, 1e-4);
  CHECK_NEAR(p.totalDvMS, 177.567560, 1e-3);
  CHECK_NEAR(p.burns[1].nodeTimeS - p.burns[0].nodeTimeS, 1064.171683, 1e-3);
  // The first burn is scheduled a SLEW ALLOWANCE ahead of the call, not for
  // right now, and the plan is computed from where the vehicle will be then.
  CHECK_NEAR(p.burns[0].nodeTimeS, ap::kOrientLeadS, 1e-9);
  // The second burn is billed at the mass the FIRST ONE LEFT BEHIND, which is
  // lower, so the same engine accelerates harder and the burn is SHORTER even
  // though the two delta-v figures are within 4 m/s of each other. 5.523 s
  // against 5.171 s. Pricing burn 2 on its own would have used the pre-burn
  // mass and come out long.
  CHECK(p.burns[1].durationS < p.burns[0].durationS);
  CHECK_NEAR(p.burns[0].durationS, 5.523, 0.01);
  CHECK_NEAR(p.burns[1].durationS, 5.171, 0.01);
  CHECK_NEAR(p.burns[0].leadS, 0.5 * p.burns[0].durationS, 1e-12);

  const AutoResult r = flyProgram(p, craft, start, 0.002, 1400.0);

  // DW-20: prove the setup before believing the measurement. If it never
  // burned, the orbit below would be the one it started in.
  CHECK(r.phase == ap::Phase::Done);
  CHECK(r.burnTicks > 100.0);
  CHECK_NEAR(r.dvSpentMS, p.totalDvMS, 0.5);

  // IT NEVER BURNED WHILE MIS-POINTED. The gate is 2 degrees at ignition; this
  // is the worst it reached at any instant with the engine lit.
  CHECK(r.worstPointingWhileBurningDeg < 3.0);

  // THE ASSERTION THAT MATTERS. Both apsides at 200 km, and a circular orbit
  // means the two agree with each other as well as with the request.
  //
  // MEASURED: apoapsis 200295.1, periapsis 199693.3, e 0.000376, semi-major
  // axis 799994.2 against a requested 800000. Five point eight metres of
  // semi-major axis on a 120 km orbit raise, flown by the autopilot with no
  // hand on the throttle. The residue is the finite-burn error of an impulsive
  // plan and it is real physics rather than slack.
  CHECK_NEAR(r.orbit.apoapsisAltM, 200.0e3, 400.0);
  CHECK_NEAR(r.orbit.periapsisAltM, 200.0e3, 400.0);
  CHECK(r.orbit.eccentricity < 0.001);
  CHECK(r.orbit.bound);
  // and the radius it actually holds is the radius that was asked for.
  CHECK_NEAR(r.orbit.semiMajorAxisM, rTarget, 400.0);
}

// -----------------------------------------------------------------------------
// IT GOES DOWN AS WELL AS UP, which is the same code with the sign of the
// transfer reversed and is worth one test because "raise the orbit" is the case
// everyone writes and "lower it" is the one that finds a sign error.
// -----------------------------------------------------------------------------
TEST(hold_this_orbit_lowers_an_orbit_too) {
  orbital::StateVector start;
  start.r = Vec3{900.0e3, 0.0, 0.0};
  start.v = Vec3{0.0, 0.0, std::sqrt(kMu / 900.0e3)};
  const Vessel craft = upperStageOnly();
  const double rTarget = 700.0e3;

  const ap::Program p = ap::holdOrbit(start, 0.0, kMu, rTarget, craft);
  CHECK(p.valid);
  CHECK(p.burnCount == 2);
  // Both burns are RETROGRADE now: the delta-v opposes the motion.
  CHECK(p.burns[0].deltaV.dot(start.v) < 0.0);

  const AutoResult r = flyProgram(p, craft, start, 0.002, 1400.0);
  CHECK(r.phase == ap::Phase::Done);
  CHECK_NEAR(r.orbit.semiMajorAxisM, rTarget, 400.0);
  CHECK(r.orbit.eccentricity < 0.001);
  // MEASURED: worst attitude with the engine lit 0.0521 deg, semi-major axis
  // 700004.99 against a requested 700000 (FIVE METRES), eccentricity 0.000016,
  // 264.1895 m/s spent. Both burns of this program are retrograde and the
  // vehicle starts prograde, so it is the case that found all three defects
  // below at once.
  CHECK(r.worstPointingWhileBurningDeg < 0.5);
  CHECK_NEAR(r.orbit.semiMajorAxisM, rTarget, 50.0);
  CHECK(r.orbit.eccentricity < 0.0002);
}

// -----------------------------------------------------------------------------
// IT CIRCULARISES AN ECCENTRIC ORBIT, which is the case that justifies taking
// the whole velocity VECTOR in burn one rather than a tangential magnitude. A
// vehicle on an ellipse has a radial velocity component, and a plan that only
// changed the speed would leave it there and need a third burn.
// -----------------------------------------------------------------------------
TEST(hold_this_orbit_takes_the_whole_vector_so_an_ellipse_needs_no_third_burn) {
  orbital::StateVector start = circular80km();
  start.v = start.v * 1.15;                    // an ellipse, periapsis here
  // Tilt the velocity so there IS a radial component to remove: a pure speed
  // change could not fix this and the test would catch it.
  start.v = start.v + orbital::normalized(start.r) * 60.0;
  const Vessel craft = upperStageOnly();
  const double rTarget = 800.0e3;

  const ap::Program p = ap::holdOrbit(start, 0.0, kMu, rTarget, craft);
  CHECK(p.valid);
  CHECK(p.burnCount == 2);

  const AutoResult r = flyProgram(p, craft, start, 0.002, 1600.0);
  CHECK(r.phase == ap::Phase::Done);
  // MEASURED: a single 18.634 s burn of 315.4429 m/s takes an ellipse with a
  // radial component straight to a circle, semi-major axis 799927.87 against
  // 800000 (72 m) and eccentricity 0.000173. The burn is three times longer
  // than the circular case's, and the residue is correspondingly larger and is
  // still under a tenth of a kilometre: that is the finite-burn error of an
  // impulsive plan, which `maneuver::BurnEstimate::burnFractionOfPeriod`
  // exists to let a caller see coming.
  CHECK_NEAR(p.burns[0].durationS, 18.634, 0.01);
  CHECK_NEAR(r.orbit.semiMajorAxisM, rTarget, 200.0);
  CHECK(r.orbit.eccentricity < 0.0005);        // circular, from an ellipse
  CHECK(r.worstPointingWhileBurningDeg < 0.5);
}

// -----------------------------------------------------------------------------
// THE THREE REFUSALS. Each of these is a way an autopilot loses a vehicle, and
// each is asserted rather than described.
// -----------------------------------------------------------------------------
TEST(the_autopilot_refuses_rather_than_flying_something_it_cannot) {
  const orbital::StateVector start = circular80km();

  // (1) IT WILL NOT PLAN A BURN IT CANNOT PAY FOR.
  //
  //     THE FIRST DRAFT OF THIS ASSERTION WAS WRONG AND THE MEASUREMENT IS
  //     WORTH KEEPING: it asked for a 20,000 km orbit expecting that to be out
  //     of reach, and it is not. A two-burn Hohmann from 680 km to a circular
  //     orbit costs at MOST about 1222 m/s (peaking near 10,000 km and falling
  //     again after, because both burns shrink as the target recedes), so the
  //     upper stage's 3065 m/s reaches EVERY bound orbit around Forge. The
  //     refusal has to be provoked with a vehicle, not with a distance.
  {
    Vessel craft = upperStageOnly();
    // Confirm the finding rather than just asserting around it.
    const ap::Program rich = ap::holdOrbit(start, 0.0, kMu, 1.0e7, craft);
    CHECK(rich.valid);
    CHECK(rich.totalDvMS < 1300.0);

    // Now drain it to 200 m/s, which cannot buy a 10,000 km orbit.
    for (auto& q : craft.parts)
      if (craft.def(q).propellant == Propellant::LiquidFuel) q.propellantKg *= 0.05;
    const double have = remainingDeltaVVacuumMS(craft);
    CHECK(have > 0.0);
    CHECK(have < rich.totalDvMS);

    const ap::Program p = ap::holdOrbit(start, 0.0, kMu, 1.0e7, craft);
    CHECK(!p.valid);
    CHECK(p.burnCount == 2);            // it still SAYS what the trip would be
    CHECK(p.totalDvMS > have);
    ap::Autopilot pilot;
    pilot.arm(p);
    CHECK(pilot.status.phase == ap::Phase::Aborted);
    CHECK(!pilot.running());
  }

  // (2) IT WILL NOT BURN WHILE MIS-POINTED. Arm a program whose burn is due
  //     immediately, start the vehicle pointing the WRONG WAY, and assert that
  //     the first tick commands attitude and NOT throttle.
  {
    const Vessel craft = upperStageOnly();
    const ap::Program p = ap::holdOrbit(start, 0.0, kMu, 800.0e3, craft);
    CHECK(p.valid);
    FlightSim sim;
    sim.craft = craft;
    sim.env = forgeEnv();
    sim.state.posM = start.r;
    sim.state.velMS = start.v;
    sim.state.forward = orbital::normalized(start.v) * -1.0;   // 180 degrees out
    sim.state.right = orbital::normalized(orbital::cross(start.r, start.v));
    ap::Autopilot pilot;
    pilot.arm(p);
    // Several ticks, so it gets past the coast-to-orient transition and is
    // genuinely sitting at the ignition time with the nose in the wrong place.
    for (int i = 0; i < 5; ++i) {
      const ap::Command c = pilot.update(sim, 0.002);
      CHECK(c.throttle == 0.0);              // NEVER, while it is this far off
      CHECK(c.sas == SasMode::Command);      // and it IS trying to turn
      CHECK(pilot.status.phase != ap::Phase::Burn);
      ap::Autopilot::apply(sim, c);
      sim.step(0.002);
    }
    CHECK(pilot.status.pointingErrorDeg > 90.0);
    // It is HOLDING rather than failing: the burn will be late, not sideways.
    CHECK(pilot.running());
  }

  // (3) A REQUEST FOR THE ORBIT IT IS ALREADY ON IS A VALID PROGRAM WITH NO
  //     BURNS, not an error and not a burn of zero.
  {
    const Vessel craft = upperStageOnly();
    const ap::Program p = ap::holdOrbit(start, 0.0, kMu, kR1, craft);
    CHECK(p.valid);
    CHECK(p.burnCount == 0);
    CHECK(p.totalDvMS == 0.0);
  }
}

// -----------------------------------------------------------------------------
// A BURN IS CUT ON MEASURED DELTA-V, NOT ON A STOPWATCH, and this is the test
// that says why that is executing the plan rather than re-deriving it.
//
// `estimateBurn`'s duration is a PREDICTION. Terminating on it banks the
// prediction's error into the orbit. Terminating on the integral of what the
// engine actually delivered spends exactly what the plan asked for, whatever
// the prediction was, so the two ways of being wrong are separated: a bad plan
// gives a bad orbit and a bad predictor gives only a slightly late shutdown.
// -----------------------------------------------------------------------------
TEST(a_burn_is_cut_on_delivered_delta_v_and_not_on_the_predicted_duration) {
  const orbital::StateVector start = circular80km();
  const Vessel craft = upperStageOnly();
  ap::Program p = ap::holdOrbit(start, 0.0, kMu, 800.0e3, craft);
  CHECK(p.valid);
  const double honestDuration = p.burns[0].durationS;

  // SABOTAGE THE PREDICTION by 40% in both directions, changing nothing else.
  // A stopwatch-driven autopilot would spend 40% too much or too little; this
  // one must spend the same delta-v and reach the same orbit either way.
  for (double factor : {0.6, 1.4}) {
    ap::Program bad = p;
    bad.burns[0].durationS = honestDuration * factor;
    bad.burns[0].leadS = 0.5 * bad.burns[0].durationS;
    const AutoResult r = flyProgram(bad, craft, start, 0.002, 1400.0);
    CHECK(r.phase == ap::Phase::Done);
    // The delta-v spent is the delta-v PLANNED, not the delta-v the sabotaged
    // duration implies.
    CHECK_NEAR(r.dvSpentMS, p.totalDvMS, 0.5);
    // and the orbit still arrives, because only the burn's CENTRING moved.
    CHECK_NEAR(r.orbit.semiMajorAxisM, 800.0e3, 3000.0);
  }
}

// =============================================================================
// RENDEZVOUS, FLOWN (PH-154). Reid: "when on autopilot it should fly
// automatically and rendezvous at the destination."
//
// Admin's acceptance, verbatim: prove arrival with a NUMBER, not a screenshot,
// and the numbers are the closing distance and the relative velocity at the
// match burn against what the plan predicted.
//
// This is the same machine as hold-this-orbit with a harder target: instead of
// a ring at a radius there is an object with a PHASE, so the arrival has to
// happen at a place AND a time, and the second burn is a velocity match rather
// than a circularisation.
// =============================================================================

struct RendezvousResult {
  double closingDistanceAtMatchM = -1.0;   // when the match burn lights
  double closingSpeedAtMatchMS = -1.0;
  double finalDistanceM = -1.0;            // after the match burn
  double finalRelativeSpeedMS = -1.0;
  double closestApproachM = 1e308;
  double dvSpentMS = 0.0;
  ap::Phase phase = ap::Phase::Idle;
  double worstPointingWhileBurningDeg = 0.0;
};

// Fly a transfer program and watch the TARGET the whole way, so the assertion at
// the end is about two objects and not about one conic.
// `coastUntilS` is not a convenience. The driver used to stop the instant the
// PROGRAM finished, which makes the single-burn control below meaningless: it
// ended 66 s in, still in the parking orbit, and reported a closest approach of
// 525 km against a target it had not started travelling towards. A control has
// to fly the same trajectory and differ in ONE thing.
static RendezvousResult flyToTarget(const ap::Program& prog, const Vessel& craft,
                                    const orbital::StateVector& start,
                                    const tr::Target& tgt, double dt,
                                    double limitS, double coastUntilS) {
  FlightSim sim;
  sim.craft = craft;
  sim.env = forgeEnv();
  sim.state.posM = start.r;
  sim.state.velMS = start.v;
  sim.state.forward = orbital::normalized(start.v);
  sim.state.right = orbital::normalized(orbital::cross(start.r, start.v));
  sim.sas = SasMode::Command;
  sim.sasCommand = sim.state.forward;

  ap::Autopilot pilot;
  pilot.arm(prog);

  RendezvousResult out;
  bool sawMatchStart = false;
  const int steps = static_cast<int>(limitS / dt) + 2;
  for (int i = 0; i < steps; ++i) {
    const ap::Command c = pilot.update(sim, dt);
    ap::Autopilot::apply(sim, c);

    const orbital::StateVector ts = tr::targetStateAt(tgt, sim.state.timeS);
    const double d = (sim.state.posM - ts.r).length();
    if (d < out.closestApproachM) out.closestApproachM = d;
    // The instant the SECOND burn lights is "the match burn", and it is
    // recorded once rather than being recomputed at the end from a time.
    if (!sawMatchStart && pilot.status.burningNow && pilot.status.burnIndex == 1) {
      sawMatchStart = true;
      out.closingDistanceAtMatchM = d;
      out.closingSpeedAtMatchMS = (sim.state.velMS - ts.v).length();
    }
    if (pilot.status.burningNow
        && pilot.status.pointingErrorDeg > out.worstPointingWhileBurningDeg)
      out.worstPointingWhileBurningDeg = pilot.status.pointingErrorDeg;

    sim.step(dt);
    if (!pilot.running() && sim.state.timeS >= coastUntilS) break;
  }
  const orbital::StateVector ts = tr::targetStateAt(tgt, sim.state.timeS);
  out.finalDistanceM = (sim.state.posM - ts.r).length();
  out.finalRelativeSpeedMS = (sim.state.velMS - ts.v).length();
  out.dvSpentMS = pilot.status.dvSpentTotalMS;
  out.phase = pilot.status.phase;
  return out;
}

// -----------------------------------------------------------------------------
// THE ACCEPTANCE. An 80 km parking orbit to Anchorage's 400 km ring, phased so
// the vehicle actually has somewhere to arrive, flown end to end.
// -----------------------------------------------------------------------------
TEST(the_autopilot_flies_a_rendezvous_and_arrives_with_the_relative_velocity_gone) {
  const double r1 = kR1, r2 = 1.0e6;
  const double slew = ap::kOrientLeadS;
  const Vessel craft = upperStageOnly();

  // BOTH orbits are built by , and that is not tidiness. It and
  //  run in OPPOSITE senses, so mixing them plans a RETROGRADE
  // rendezvous: the first draft of this test asked for 3818.69 m/s against a
  // Hohmann of 396 and was correctly refused as infeasible by a vehicle
  // carrying 3065. One convention per test.
  const orbital::Elements ship = circularAbout(r1, kMu, 0.0);
  const orbital::StateVector start = orbital::elementsToState(ship, 0.0);
  const double tH = tr::hohmannTimeS(r1, r2, kMu);
  const double tof = tH * 0.999;
  const double rate = std::sqrt(kMu / (r2 * r2 * r2));
  tr::Target tgt;
  tgt.el = circularAbout(r2, kMu, orbital::kPi - rate * (slew + tof));
  tgt.dockingRadiusM = 0.60;

  const tr::Transfer trans = tr::solveTransfer(ship, tgt, slew, tof);
  CHECK(trans.valid);
  // The PLAN's own prediction, which is what the flown numbers are measured
  // against: Lambert lands on the target by construction, so the plan says the
  // closing distance is zero and the match burn removes all of the relative
  // velocity.
  CHECK(trans.missDistanceM < 1e-6);
  CHECK((trans.transferEnd.v + trans.arriveDv - trans.targetState.v).length() < 1e-6);

  const ap::Program prog = ap::flyTransfer(trans, ship, tgt, craft);
  CHECK(prog.valid);
  CHECK(prog.burnCount == 2);
  CHECK_NEAR(prog.burns[0].deltaVMS, trans.departDvMS, 1e-12);
  CHECK_NEAR(prog.burns[1].deltaVMS, trans.arriveDvMS, 1e-12);
  CHECK_NEAR(prog.burns[0].nodeTimeS, slew, 1e-12);
  CHECK_NEAR(prog.burns[1].nodeTimeS, slew + tof, 1e-12);

  const RendezvousResult r =
      flyToTarget(prog, craft, start, tgt, 0.002, slew + tof + 200.0, slew + tof);

  // DW-20: prove the flight happened before believing the arrival. Without
  // this, a vehicle that never left the pad would report a beautiful zero
  // closing speed against a target it is 320 km away from.
  CHECK(r.phase == ap::Phase::Done);
  CHECK_NEAR(r.dvSpentMS, prog.totalDvMS, 0.5);
  CHECK(r.worstPointingWhileBurningDeg < 0.5);

  // THE TWO NUMBERS ADMIN ASKED FOR.
  //
  // Closing distance at the moment the match burn lights, against a plan that
  // predicted zero; and the relative velocity left after it, against a plan
  // that predicted zero. Both are the finite-burn residue of an impulsive plan
  // accumulated over a 1286 s transfer, and both are reported rather than
  // tolerated: if either grows, the arithmetic upstream has moved.
  //
  // MEASURED: the match burn lights at 1306.61 m and 206.4555 m/s of closing
  // speed, and the flight ends 108.87 m from the station at 0.23133 m/s. The
  // plan predicted zero for both, so those figures ARE the accumulated
  // finite-burn residue of an impulsive plan over a 1286 s transfer, which is
  // real physics rather than slack. 458.8236 m/s spent.
  CHECK(r.closingDistanceAtMatchM >= 0.0);      // the match burn DID light
  CHECK(r.closingDistanceAtMatchM < 2000.0);
  CHECK(r.closingSpeedAtMatchMS > 100.0);       // it was still closing fast
  CHECK_NEAR(r.closingSpeedAtMatchMS, 206.4555, 1.0);
  CHECK(r.finalDistanceM < 300.0);
  // THE RENDEZVOUS ITSELF: the relative velocity is gone. Two objects at rest
  // with respect to each other is what "rendezvous" means, and it is the one
  // number a docking approach would start from.
  CHECK(r.finalRelativeSpeedMS < 1.0);
  // and it is a THOUSAND-fold reduction from the speed it arrived at, which is
  // what makes the match burn the thing that did it rather than luck.
  CHECK(r.finalRelativeSpeedMS < 0.02 * r.closingSpeedAtMatchMS);
  // 0.23133 against 206.4555 is a factor of 892.
}

// -----------------------------------------------------------------------------
// AND THE NEGATIVE CONTROL, because every number above would look just as good
// on a vehicle that flew the injection and then coasted past. Fly ONLY the
// first burn and assert the arrival is a fly-by rather than a rendezvous.
// -----------------------------------------------------------------------------
TEST(without_the_match_burn_the_same_flight_is_a_fly_past) {
  const double r1 = kR1, r2 = 1.0e6;
  const double slew = ap::kOrientLeadS;
  const Vessel craft = upperStageOnly();
  const orbital::Elements ship = circularAbout(r1, kMu, 0.0);
  const orbital::StateVector start = orbital::elementsToState(ship, 0.0);
  const double tH = tr::hohmannTimeS(r1, r2, kMu);
  const double tof = tH * 0.999;
  const double rate = std::sqrt(kMu / (r2 * r2 * r2));
  tr::Target tgt;
  tgt.el = circularAbout(r2, kMu, orbital::kPi - rate * (slew + tof));

  const tr::Transfer trans = tr::solveTransfer(ship, tgt, slew, tof);
  CHECK(trans.valid);
  // THE SAME PROGRAM WITH THE SECOND BURN REMOVED, which is the whole content
  // of the control: one difference, stated in one line, and no second code
  // path that could differ from the real one in some other way too.
  ap::Program prog = ap::flyTransfer(trans, ship, tgt, craft);
  CHECK(prog.valid);
  CHECK(prog.burnCount == 2);
  prog.burnCount = 1;
  prog.totalDvMS = prog.burns[0].deltaVMS;

  const RendezvousResult r =
      flyToTarget(prog, craft, start, tgt, 0.002, slew + tof + 200.0, slew + tof);
  CHECK(r.phase == ap::Phase::Done);
  // It still gets THERE: the injection alone puts it alongside.
  CHECK(r.closestApproachM < 5000.0);
  // But it is not a rendezvous, and the difference is the whole point: the
  // injection puts you alongside the station at 200-odd m/s, which is a fly-by
  // and not an arrival. The match burn is what turns one into the other.
  CHECK(r.finalRelativeSpeedMS > 150.0);
  // The match burn was never scheduled, so it was never recorded.
  CHECK(r.closingDistanceAtMatchM < 0.0);
}

// =============================================================================
// THE MOON (PH-159). Reid's second acceptance test: "orbit around the moon".
//
// Cinder orbits Forge at 1.2e7 m (sim_world.h kCinderOrbitRadiusM), well inside
// Forge's 8.4e7 m SOI, so the transfer is the SAME same-primary Lambert as the
// station. The thing that is genuinely different is that the flight CROSSES AN
// SOI BOUNDARY part-way, and a plan computed once in Forge's frame has to
// survive being re-expressed in Cinder's.
//
// Hand figures, off the authored constants, before any of this ran:
//   r1 = 680 km, rMoon = 1.2e7, aT = 6.34e6
//   dv1 = 856.3553 m/s, time of flight 26686.89 s (7.41 h)
//   Cinder's period 138984.4 s, its orbital speed 542.49 m/s
//   the ship reaches apoapsis at 177.67 m/s, so v_inf is about 364.83 m/s
//   mu_Cinder 6.52e10, and at a 250 km radius v_circ is 510.69 m/s
// =============================================================================

static tr::Target cinderAt(double phaseRad, double captureAltM) {
  tr::Target t;
  t.el = circularAbout(1.2e7, kMu, phaseRad);
  t.muM3S2 = orbital::kCinderMu;
  t.soiRadiusM = orbital::kCinderSoiRadius;
  t.bodyRadiusM = orbital::kCinderRadiusM;
  t.captureAltitudeM = captureAltM;
  return t;
}

// -----------------------------------------------------------------------------
// THE ROOT-FIND. Spike2-physics PH-Build 0 step 4, outstanding since the
// propagator was written, and the whole content of a patched-conic handoff.
// -----------------------------------------------------------------------------
TEST(the_soi_root_find_locates_the_handoff_and_the_handoff_is_a_subtraction) {
  const double r1 = kR1, rM = 1.2e7;
  const orbital::Elements ship = circularAbout(r1, kMu, 0.0);
  const double tH = tr::hohmannTimeS(r1, rM, kMu);
  CHECK_NEAR(tH, 26686.89, 0.1);
  const double rate = std::sqrt(kMu / (rM * rM * rM));
  const tr::Target moon = cinderAt(orbital::kPi - rate * tH, 50.0e3);

  const tr::Transfer t = tr::solveTransfer(ship, moon, 0.0, tH * 0.999);
  CHECK(t.valid);
  // 860.9649 and not the 856.3553 a centre-aimed Hohmann costs: the extra
  // 4.61 m/s is what aiming 563 km off the moon's centre buys, and what it
  // buys is a periapsis outside the moon instead of inside it.
  CHECK_NEAR(t.departDvMS, 860.9649, 0.01);
  CHECK_NEAR(t.aimOffsetM, 543144.0, 500.0);

  // The conic searched is the POST-INJECTION one, because that is the
  // trajectory the vehicle will actually be on.
  const orbital::Elements after = orbital::park(t.transferStart, kMu, 0.0);
  const tr::SoiCrossing x = tr::findSoiEntry(after, moon, 0.0, tH * 1.25);
  CHECK(x.found);

  // IT IS AN ENTRY, not an exit: the separation is falling THROUGH the radius.
  CHECK_NEAR(tr::separationAt(after, moon, x.timeS), moon.soiRadiusM, 1.0);
  CHECK(tr::separationAt(after, moon, x.timeS - 60.0) > moon.soiRadiusM);
  CHECK(tr::separationAt(after, moon, x.timeS + 60.0) < moon.soiRadiusM);
  // and it happens BEFORE the aim point, because the sphere has a radius and
  // the Lambert solve aimed at its centre.
  CHECK(x.timeS < tH * 0.999);

  // THE HANDOFF IS ONE SUBTRACTION, and this asserts exactly that rather than
  // trusting the function to have done it.
  {
    const orbital::StateVector s = orbital::elementsToState(after, x.timeS);
    const orbital::StateVector b = orbital::elementsToState(moon.el, x.timeS);
    CHECK((x.relative.r - (s.r - b.r)).length() < 1e-9);
    CHECK((x.relative.v - (s.v - b.v)).length() < 1e-12);
    CHECK_NEAR(x.relative.r.length(), moon.soiRadiusM, 1.0);
  }

  // The arrival is HYPERBOLIC about Cinder, which is the whole reason a second
  // frame is needed: in Forge's frame this is a perfectly ordinary ellipse.
  CHECK(x.hyperbola.e > 1.0);
  CHECK(x.hyperbola.a < 0.0);
  CHECK(x.vInfMS > 100.0);
  CHECK(x.periapsisRadiusM > 0.0);
  CHECK(x.timeToPeriapsisS > 0.0);

  // Periapsis is where the radial velocity changes sign, and this checks the
  // bisection landed there rather than merely returning a number.
  {
    const orbital::StateVector q =
        orbital::propagate(x.relative, x.timeToPeriapsisS, moon.muM3S2);
    // r.v is metres-squared per second, so a bare tolerance is meaningless at
    // r ~ 2.5e5 and v ~ 800: this is the RELATIVE one, i.e. the cosine of the
    // angle between them, which is what "periapsis" actually asserts.
    CHECK(std::fabs(q.r.dot(q.v)) / (q.r.length() * q.v.length()) < 1e-6);
    CHECK_NEAR(q.r.length(), x.periapsisRadiusM, 10.0);
  }
}

// -----------------------------------------------------------------------------
// IT REFUSES FOR A REASON RATHER THAN CATEGORICALLY, which is the guard coming
// down properly. Three distinct ways a body transfer has no capture, and a
// caller must be able to tell them apart.
// -----------------------------------------------------------------------------
TEST(a_body_transfer_that_cannot_capture_says_which_way_it_failed) {
  const double r1 = kR1, rM = 1.2e7;
  const orbital::Elements ship = circularAbout(r1, kMu, 0.0);
  const Vessel craft = upperStageOnly();
  const double tH = tr::hohmannTimeS(r1, rM, kMu);
  const double rate = std::sqrt(kMu / (rM * rM * rM));

  // (1) THE PLAN IS STALE: solved against the moon where it was, flown against
  //     the moon where it is. `solveTransfer` always LANDS on whatever target
  //     it was given, so a miss cannot be provoked by mis-phasing the target it
  //     solved for. It has to be provoked the way it happens in life, by the
  //     world moving after the plan was made.
  {
    const tr::Target planned = cinderAt(orbital::kPi - rate * tH, 50.0e3);
    const tr::Target actual = cinderAt(orbital::kPi - rate * tH + 1.5, 50.0e3);
    const tr::Transfer t = tr::solveTransfer(ship, planned, 0.0, tH * 0.999);
    CHECK(t.valid);                      // the TRANSFER is fine
    const ap::Program p = ap::flyTransfer(t, ship, actual, craft);
    CHECK(!p.valid);                     // the CAPTURE is not
    CHECK(p.burnCount == 1);             // the injection still stands
    CHECK(std::string(p.note).find("never enters") != std::string::npos);
  }

  // (1b) IT HITS THE SURFACE, which is the OTHER refusal and the one aiming
  //      exists to prevent. Provoked by taking the aim away: a target that is a
  //      body but asks for no capture altitude is not aimed off-centre, and a
  //      Lambert that aims at a moon's centre arrives at the moon's centre.
  {
    tr::Target centred = cinderAt(orbital::kPi - rate * tH, 0.0);
    const tr::Transfer t = tr::solveTransfer(ship, centred, 0.0, tH * 0.999);
    CHECK(t.valid);
    CHECK(t.aimOffsetM == 0.0);
    const orbital::Elements after = orbital::park(t.transferStart, kMu, 0.0);
    const tr::SoiCrossing x = tr::findSoiEntry(after, centred, 0.0, tH * 1.25);
    CHECK(x.found);
    CHECK(x.impacts);
    CHECK(x.periapsisRadiusM < orbital::kCinderRadiusM);
    // MEASURED: 1214.7 m of periapsis against a 200000 m body. Aiming at the
    // centre is a crater, and this is the number that says so.
    CHECK(x.periapsisRadiusM < 2000.0);
    centred.captureAltitudeM = 50.0e3;   // now ASK for a capture off that conic
    const tr::CaptureBurn cap = tr::planCapture(x, centred);
    CHECK(!cap.valid);
    CHECK(std::string(cap.note).find("hits the surface") != std::string::npos);
  }

  // (2) A VESSEL TARGET IS UNAFFECTED by any of this: same call, two burns,
  //     both in the primary's frame, no SOI anywhere.
  {
    tr::Target station;
    station.el = circularAbout(1.0e6, kMu, 0.0);
    const double tS = tr::hohmannTimeS(r1, 1.0e6, kMu);
    const double rS = std::sqrt(kMu / (1.0e6 * 1.0e6 * 1.0e6));
    station.el = circularAbout(1.0e6, kMu, orbital::kPi - rS * tS);
    const tr::Transfer t = tr::solveTransfer(ship, station, 0.0, tS * 0.999);
    const ap::Program p = ap::flyTransfer(t, ship, station, craft);
    CHECK(p.valid);
    CHECK(p.burnCount == 2);
    CHECK(!p.crossesSoi);
    CHECK(p.burns[0].frame == ap::BurnFrame::Primary);
    CHECK(p.burns[1].frame == ap::BurnFrame::Primary);
  }

  // (3) AND THE ONE THAT WORKS carries the handoff in the plan, with the
  //     capture burn tagged as living in the MOON's frame.
  {
    const tr::Target moon = cinderAt(orbital::kPi - rate * tH, 50.0e3);
    const tr::Transfer t = tr::solveTransfer(ship, moon, 0.0, tH * 0.999);
    const ap::Program p = ap::flyTransfer(t, ship, moon, craft);
    CHECK(p.valid);
    CHECK(p.burnCount == 2);
    CHECK(p.crossesSoi);
    CHECK(p.burns[0].frame == ap::BurnFrame::Primary);
    CHECK(p.burns[1].frame == ap::BurnFrame::Target);
    CHECK_NEAR(p.targetMuM3S2, orbital::kCinderMu, 1e-6);
    CHECK(p.soiEntryS > 0.0 && p.soiEntryS < p.burns[1].nodeTimeS);
    CHECK(p.captureRadiusM > orbital::kCinderRadiusM);
    // The capture is the cheaper half, which is the whole reason a body is
    // billed differently from a station.
    CHECK(p.burns[1].deltaVMS < p.burns[0].deltaVMS);
  }
}

// -----------------------------------------------------------------------------
// THE ACCEPTANCE: FLY IT, AND END UP IN ORBIT AROUND CINDER.
//
// The coast is PROPAGATED rather than integrated, because the transfer is 7.4
// hours and 0.002 s ticks would be thirteen million steps. That is not a
// shortcut, it is what the game does: park/resume is proven bit-identical
// across 3000 looped resumes and agrees with flown integration to 6.5e-5 m
// (PH-64 to PH-70). The BURNS are flown for real, in their own frames, by the
// autopilot, which is the part under test.
// -----------------------------------------------------------------------------
TEST(the_autopilot_flies_to_the_moon_and_ends_in_orbit_around_it) {
  const double r1 = kR1, rM = 1.2e7;
  const orbital::Elements ship = circularAbout(r1, kMu, 0.0);
  const orbital::StateVector start = orbital::elementsToState(ship, 0.0);
  const Vessel craft = upperStageOnly();
  const double tH = tr::hohmannTimeS(r1, rM, kMu);
  const double rate = std::sqrt(kMu / (rM * rM * rM));
  const tr::Target moon = cinderAt(orbital::kPi - rate * tH, 50.0e3);

  const tr::Transfer t = tr::solveTransfer(ship, moon, 0.0, tH * 0.999);
  const ap::Program p = ap::flyTransfer(t, ship, moon, craft);
  CHECK(p.valid);
  CHECK(p.crossesSoi);
  // It has to be affordable, and the upper stage's 3065 m/s is what pays.
  CHECK(p.totalDvMS < remainingDeltaVVacuumMS(craft));

  ap::Autopilot pilot;
  pilot.arm(p);

  // ---- LEG 1: the injection, flown in FORGE's frame ------------------------
  FlightSim sim;
  sim.craft = craft;
  sim.env = forgeEnv();
  sim.state.posM = start.r;
  sim.state.velMS = start.v;
  sim.state.forward = orbital::normalized(start.v);
  sim.state.right = orbital::normalized(orbital::cross(start.r, start.v));
  sim.sas = SasMode::Command;
  sim.sasCommand = sim.state.forward;
  const double dt = 0.002;
  for (int i = 0; i < 200000; ++i) {
    const ap::Command c = pilot.update(sim, dt);
    ap::Autopilot::apply(sim, c);
    sim.step(dt);
    if (pilot.status.burnIndex >= 1) break;      // injection done
  }
  CHECK(pilot.status.burnIndex == 1);
  CHECK_NEAR(pilot.status.dvSpentTotalMS, p.burns[0].deltaVMS, 0.5);

  // ---- THE HANDOFF, AND IT HAPPENS AT THE BOUNDARY --------------------------
  //
  // THE FIRST VERSION OF THIS DRIVER COASTED IN FORGE'S FRAME ALL THE WAY TO
  // THE CAPTURE BURN and then subtracted the moon, which put it 654 km and
  // e 0.34 away from the orbit the plan predicted. That is not a bug in the
  // plan, it is the patched-conic rule being broken by the harness: past the
  // SOI boundary the vehicle is on a conic about CINDER, and propagating it
  // under Forge's mu through the moon's own gravity well is simply the wrong
  // two-body problem. D-002 says one body at a time, and this is what one body
  // at a time costs: hand off AT the crossing, then propagate in the new frame.
  orbital::StateVector afterBurn{sim.state.posM, sim.state.velMS};

  // ---- LEG 1b: THE MID-COURSE CORRECTION, WHICH IS COMPULSORY --------------
  //
  // MEASURED, flying without it: the 861 m/s injection's finite-burn residue
  // grows over the 7.4 hour coast into 468 km of position error at the sphere
  // of influence, and the aim offset that keeps the vehicle out of the moon is
  // itself only 543 km. The flown arrival hyperbola then has a periapsis of
  // 185669 m against a 200000 m body: the planned 250 km capture orbit is a
  // 14 km deep hole in the ground, and `planCapture` refuses it, correctly, as
  // "the arrival conic hits the surface".
  //
  // So the trip gets a correction, which is what every real mission does. One
  // Lambert from where the vehicle ACTUALLY is to the aim point it was always
  // going to, in the time that is left.
  {
    const double tTcm = t.departS + 0.35 * (t.arriveS - t.departS);
    const double coastToTcm = tTcm - sim.state.timeS;
    CHECK(coastToTcm > 0.0);
    const orbital::StateVector atTcm =
        orbital::propagate(afterBurn, coastToTcm, kMu);
    const ap::Burn tcm = ap::midCourseCorrection(atTcm, tTcm, t.aimPointM,
                                                 t.arriveS, kMu, sim.craft);
    CHECK(tcm.deltaVMS > 0.0);
    // It is SMALL against the injection, which is what makes a correction a
    // correction rather than a second mission.
    CHECK(tcm.deltaVMS < 0.1 * p.burns[0].deltaVMS);

    ap::Program corrected = pilot.program;
    CHECK(ap::insertBurn(corrected, 1, tcm));
    CHECK(corrected.burnCount == 3);
    pilot.armFrom(corrected, 1);

    // Fly it for real, in Forge's frame, like any other burn.
    sim.state.posM = atTcm.r;
    sim.state.velMS = atTcm.v;
    sim.state.timeS = tTcm - ap::kOrientLeadS - 5.0;   // arrive with slew time
    const orbital::StateVector back =
        orbital::propagate(atTcm, sim.state.timeS - tTcm, kMu);
    sim.state.posM = back.r;
    sim.state.velMS = back.v;
    sim.state.forward = orbital::normalized(tcm.deltaV);
    sim.state.right = orbital::normalized(orbital::cross(back.r, back.v));
    for (int i = 0; i < 300000; ++i) {
      const ap::Command c = pilot.update(sim, dt);
      ap::Autopilot::apply(sim, c);
      sim.step(dt);
      if (pilot.status.burnIndex >= 2) break;
    }
    CHECK(pilot.status.burnIndex == 2);
    afterBurn = orbital::StateVector{sim.state.posM, sim.state.velMS};
  }

  // THE CROSSING IS STILL MEASURED, NOT ASSUMED.
  //
  // The solver predicted the boundary at `p.soiEntryS` from the IDEAL
  // post-injection conic. The vehicle flew a real 861 m/s burn over a real
  // duration, and by the time it arrives the two disagree: at the predicted
  // instant the flown trajectory is 2868066 m from Cinder against a 2400000 m
  // sphere, i.e. 468 km short, about twenty minutes late at the closing speed.
  // That is not a defect in the plan, it is the finite-burn residue of an
  // impulsive plan amplified by a 7.4 hour coast (R66, at scale). Flying the
  // planned capture open-loop from there produced a 1046804 m orbit where the
  // plan said 253999 m.
  // The boundary is found on the trajectory the vehicle is actually on, which
  // is what core-engine's SOI change event will do with the real position.
  // This is a MEASUREMENT the world makes, exactly as core-engine's SOI change
  // event will: propagate the real state and watch the separation fall.
  double tCross = 0.0;
  {
    const orbital::Elements flown = orbital::park(afterBurn, kMu, sim.state.timeS);
    const tr::SoiCrossing real =
        tr::findSoiEntry(flown, moon, sim.state.timeS, sim.state.timeS + tH * 1.4);
    CHECK(real.found);
    tCross = real.timeS;
  }
  const orbital::StateVector atBoundary =
      orbital::propagate(afterBurn, tCross - sim.state.timeS, kMu);
  const orbital::StateVector moonNow = tr::targetStateAt(moon, tCross);
  const orbital::StateVector entry{atBoundary.r - moonNow.r,
                                   atBoundary.v - moonNow.v};
  CHECK_NEAR(entry.r.length(), moon.soiRadiusM, 100.0);

  // AND THE CAPTURE IS RE-PLANNED FROM THE STATE THE WORLD DELIVERED. The
  // mission is not re-derived: the destination, the injection and the decision
  // to capture all stand. One burn is recomputed, in a frame that did not exist
  // when the plan was made, from data that did not exist either.
  // The corrected arrival clears the moon, which is the whole point of the
  // correction: without it this periapsis was 185669 m against a 200000 m body.
  {
    const orbital::Elements hyp =
        orbital::stateToElements(entry, orbital::kCinderMu, tCross);
    CHECK(hyp.e > 1.0);
    CHECK(hyp.a * (1.0 - hyp.e) > orbital::kCinderRadiusM);
  }
  CHECK(ap::replanCaptureAtHandoff(pilot, entry, tCross, moon, sim.craft));
  CHECK(pilot.status.burnIndex == 2);                // injection and TCM stand
  CHECK(pilot.program.burns[2].frame == ap::BurnFrame::Target);

  const double tIgnite = pilot.program.burns[2].ignitionS();
  const double inSoiS = tIgnite - tCross - 30.0;     // arrive 30 s early
  CHECK(inSoiS > 0.0);
  const orbital::StateVector rel =
      orbital::propagate(entry, inSoiS, orbital::kCinderMu);
  const double tAtHandoff = tCross + inSoiS;
  CHECK(rel.r.length() < moon.soiRadiusM);

  // ---- LEG 2: the capture, flown in CINDER's frame -------------------------
  FlightSim moonSim;
  moonSim.craft = sim.craft;                 // the tanks the injection left
  moonSim.env.muM3S2 = orbital::kCinderMu;
  moonSim.env.bodyRadiusM = orbital::kCinderRadiusM;
  moonSim.env.air = atmo::makeCinderAtmosphere();
  moonSim.state.posM = rel.r;
  moonSim.state.velMS = rel.v;
  moonSim.state.timeS = tAtHandoff;          // ONE clock across both frames
  moonSim.state.forward = orbital::normalized(rel.v);
  moonSim.state.right = orbital::normalized(orbital::cross(rel.r, rel.v));
  moonSim.sas = SasMode::Command;
  moonSim.sasCommand = moonSim.state.forward;
  for (int i = 0; i < 400000; ++i) {
    const ap::Command c = pilot.update(moonSim, dt);
    ap::Autopilot::apply(moonSim, c);
    moonSim.step(dt);
    if (!pilot.running()) break;
  }

  CHECK(pilot.status.phase == ap::Phase::Done);

  // R69, CLOSED. This assertion used to pin a 232 m/s GAP between the plan and
  // the flight, deliberately, rather than widening a tolerance over it. The
  // cause was an index: `replanCaptureAtHandoff` wrote the new capture to
  // `burns[1]` while re-arming at `burnCount - 1`, and once a mid-course
  // correction is INSERTED at index 1 those are different slots. So it
  // overwrote the correction with the capture, left the STALE capture at index
  // 2, and then flew the stale one. Everything ran, nothing threw, the vehicle
  // captured into the wrong orbit, and the total double-counted a burn it never
  // flew. The index is now derived from the same expression the re-arm uses.
  //
  // The plan and the flight now agree to 2.0e-07 m/s.
  CHECK_NEAR(pilot.status.dvSpentTotalMS, pilot.program.totalDvMS, 1e-5);

  // THE ASSERTION REID NAMED: in orbit around the moon.
  const OrbitSummary o = summarize(moonSim.orbitalState(), orbital::kCinderMu,
                                   orbital::kCinderRadiusM);
  CHECK(o.bound);                                  // captured, not flying past
  CHECK(o.periapsisAltM > 0.0);                    // and not into the ground
  // MEASURED, and this IS Reid's second acceptance test: a CIRCULAR orbit about
  // Cinder at a semi-major axis of 270379.5 m against a planned 270369.7, which
  // is 9.8 m, with an eccentricity of 0.000448. Reached by an autopilot that
  // flew an injection, a mid-course correction, an SOI handoff and a capture
  // with no hand on the controls at any point.
  //
  // Before R69 was closed this same flight ended at 292750.2 m and e 0.106588,
  // which is what flying a stale capture burn looks like: still bound, still
  // clear of the ground, and wrong by 22 km and two orders of magnitude of
  // eccentricity. Both sets of numbers are kept because the difference between
  // them is the whole value of having pinned the gap instead of widening it.
  CHECK_NEAR(o.semiMajorAxisM, 270379.5, 200.0);
  CHECK(o.eccentricity < 0.002);
  CHECK_NEAR(o.semiMajorAxisM, pilot.program.captureRadiusM, 100.0);
  CHECK(o.periapsisAltM > 65.0e3);       // comfortably clear of the ground
  CHECK(o.apoapsisAltM < 80.0e3);        // and a LOW orbit, not a long ellipse
  // The orbit is about CINDER and nothing else: its radius is a few hundred km,
  // not the 1.2e7 m it would be if the frame had not changed.
  CHECK(o.semiMajorAxisM < moon.soiRadiusM);
  CHECK(o.semiMajorAxisM > orbital::kCinderRadiusM);
}
