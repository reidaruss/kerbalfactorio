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

  // And a vehicle that cannot make it at ANY departure is refused outright,
  // rather than being offered a time that would not work either.
  Vessel empty = craft;
  for (auto& p : empty.parts) p.propellantKg = 0.0;
  const tr::Verdict never = tr::verdictFor(empty, ship, tgt, 0.0, 0.0, 48, 24);
  CHECK(never.anyTransferExists);             // the GEOMETRY is fine
  CHECK(!never.feasibleNow);
  CHECK(!never.feasibleLater);                // the VEHICLE is not
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

  // The injection burn is IDENTICAL to the last bit: the geometry does not know
  // what is waiting at the far end.
  CHECK(body.departDvMS == vess.departDvMS);
  CHECK(body.sweepRad == vess.sweepRad);
  // The arrival is not. Capturing into a 50 km orbit is cheaper than matching,
  // because the moon's own gravity does part of the work.
  CHECK(body.arriveDvMS < vess.arriveDvMS);
  CHECK(body.arriveDvMS > 0.0);
  // Hand check: v_inf is the match cost, r_c = 200 km + 50 km = 250 km,
  // dv = sqrt(v_inf^2 + 2 mu_c / r_c) - sqrt(mu_c / r_c).
  {
    const double vInf = vess.arriveDvMS;
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
