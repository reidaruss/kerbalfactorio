// =============================================================================
// test_approach.cpp - the auto-approach (of/approach.h, D-015 layer two).
//
// THE ACCEPTANCE IS A FLIGHT, not a guidance vector. The driver runs the real
// `FlightSim`, applies the program's own attitude and thruster commands every
// tick at the browser's own 1/60 s, and the check at the end is
// `docking::sweptCapture` saying the ports mated. Nothing here is trusted on
// the strength of the law agreeing with itself.
//
// It starts where the flown rendezvous actually ended: PH-154 measured 108.87 m
// at 0.23133 m/s relative, so that is the state it is given.
// =============================================================================
#include <cmath>
#include <cstdio>

#include "of/approach.h"
#include "of/cubed_sphere.h"
#include "of/docking.h"
#include "of/flight.h"
#include "of/orbital.h"
#include "of/vessel.h"
#include "test_framework.h"

using namespace of;
using namespace of::vessel;
using namespace of::flight;
namespace dk = of::docking;
namespace ap2 = of::approach;

static const double kDeg = 180.0 / orbital::kPi;
static const double kMu = 9.81 * 600.0e3 * 600.0e3;

// A vessel that can actually dock: a pod to think with, RCS to translate with,
// monopropellant to pay for it, and a port on the stack axis.
static Vessel dockingCraft() {
  Vessel v;
  PartHandle pod = v.addRoot(parts::CommandPod);
  PartHandle tank = v.attach(pod, parts::TankMonoprop, Attach::StackBottom);
  v.attach(tank, parts::RcsBlock, Attach::Radial, 0.0, 0.0);
  v.attach(tank, parts::RcsBlock, Attach::Radial, orbital::kPi, 0.0);
  v.attach(pod, parts::DockingPort, Attach::StackTop);
  v.layout();
  return v;
}

// The vessel's port in VESSEL-LOCAL metres. The asset lane measured the shipped
// frame: local (0, 0.30, 0), face +Y, roll +X.
static dk::PortPose vesselPortLocal() {
  dk::PortPose p;
  p.posM = Vec3{0.0, 0.30, 0.0};
  p.faceAxis = Vec3{0, 1, 0};
  p.rollAxis = Vec3{1, 0, 0};
  return p;
}

static FlightEnvironment vacuumEnv() {
  FlightEnvironment e;
  e.muM3S2 = kMu;
  e.bodyRadiusM = 600.0e3;
  e.air = atmo::makeForgeAtmosphere();
  return e;
}

// =============================================================================
// DW-20: the vehicle can do the thing before anything measures whether it did.
// =============================================================================
TEST(a_docking_craft_has_translational_thrust_and_an_axial_port) {
  Vessel v = dockingCraft();
  v.layout();
  // R15's shape, closed: `rcsThrustN` was authored and spent on torque only.
  const double T = rcsTranslationThrustN(v);
  CHECK_NEAR(T, 2000.0, 1e-9);            // two blocks at 1000 N
  const MassProperties mp = massProperties(v);
  CHECK(mp.totalKg > 0.0);
  // It can push itself about at a useful rate: a docking approach that took an
  // hour would be a different kind of failure.
  CHECK(T / mp.totalKg > 0.5);

  // AND WITHOUT MONOPROPELLANT IT CANNOT, which is the two-sided half: the
  // thrust is a property of the tank as much as of the blocks.
  Vessel dry = v;
  for (auto& p : dry.parts)
    if (dry.def(p).propellant == Propellant::Monopropellant) p.propellantKg = 0.0;
  dry.layout();
  CHECK(rcsTranslationThrustN(dry) == 0.0);
}

TEST(translational_rcs_accelerates_the_vehicle_and_is_paid_for_in_monopropellant) {
  FlightSim sim;
  sim.craft = dockingCraft();
  sim.env = vacuumEnv();
  sim.state.posM = Vec3{680.0e3, 0, 0};
  sim.state.velMS = Vec3{0, 0, std::sqrt(kMu / 680.0e3)};
  sim.state.forward = Vec3{0, 1, 0};
  sim.state.right = Vec3{1, 0, 0};
  sim.sas = SasMode::Off;

  const double m0 = massProperties(sim.craft).totalKg;
  const double mono0 = propellantAboardKg(sim.craft, Propellant::Monopropellant);
  const Vec3 v0 = sim.state.velMS;

  // Push along +Z at full throttle for one second.
  sim.rcsTranslate = Vec3{0, 0, 1};
  const double dt = 1.0 / 60.0;
  for (int i = 0; i < 60; ++i) sim.step(dt);

  const Vec3 dv = sim.state.velMS - v0;
  // It accelerated along the commanded axis and essentially nowhere else. The
  // small cross terms are the orbit turning underneath it over the same second.
  CHECK(dv.z > 0.0);
  const double a = 2000.0 / m0;
  CHECK_NEAR(dv.z, a * 1.0, 0.05 * a);
  CHECK(sim.telemetry.rcsThrustN > 0.0);

  // AND IT WAS PAID FOR. Monopropellant went down by thrust/(Isp g0) per
  // second, which for 2000 N at 240 s is 0.8497 kg.
  const double mono1 = propellantAboardKg(sim.craft, Propellant::Monopropellant);
  CHECK_NEAR(mono0 - mono1, 2000.0 / (240.0 * atmo::kG0), 1e-6);

  // THE CONTROL: the same command with the tank empty does nothing at all, and
  // says so through telemetry rather than by silently coasting.
  FlightSim dry = sim;
  for (auto& p : dry.craft.parts)
    if (dry.craft.def(p).propellant == Propellant::Monopropellant)
      p.propellantKg = 0.0;
  dry.craft.layout();
  FlightSim dryIdle = dry;
  dry.rcsTranslate = Vec3{0, 0, 1};
  dryIdle.rcsTranslate = Vec3{0, 0, 0};
  dry.step(dt);
  dryIdle.step(dt);
  CHECK(dry.telemetry.rcsThrustN == 0.0);
  // AND THE COMMAND CHANGED NOTHING, BIT FOR BIT, against the same vehicle not
  // commanding at all. Asserted as a difference rather than as "gravity is
  // perpendicular to +Z", which was the first version of this line and was
  // false: the vessel has been thrusting for a second, so it is no longer at
  // the point where that held.
  CHECK(dry.state.velMS.x == dryIdle.state.velMS.x);
  CHECK(dry.state.velMS.y == dryIdle.state.velMS.y);
  CHECK(dry.state.velMS.z == dryIdle.state.velMS.z);
}

// -----------------------------------------------------------------------------
// EVERY EXISTING FLIGHT IS UNCHANGED, because the command defaults to zero.
// This is the assertion that says a new force in the integrator did not quietly
// become a force in every other test.
// -----------------------------------------------------------------------------
TEST(a_vehicle_that_commands_no_rcs_flies_exactly_as_it_did_before) {
  auto fly = [](bool touchTheField) {
    FlightSim sim;
    sim.craft = dockingCraft();
    sim.env = vacuumEnv();
    sim.state.posM = Vec3{680.0e3, 0, 0};
    sim.state.velMS = Vec3{0, 0, std::sqrt(kMu / 680.0e3)};
    sim.state.forward = Vec3{0, 1, 0};
    sim.state.right = Vec3{1, 0, 0};
    sim.sas = SasMode::Off;
    if (touchTheField) sim.rcsTranslate = Vec3{0, 0, 0};
    for (int i = 0; i < 600; ++i) sim.step(1.0 / 60.0);
    return sim;
  };
  const FlightSim a = fly(false), b = fly(true);
  CHECK(a.state.posM.x == b.state.posM.x);
  CHECK(a.state.posM.y == b.state.posM.y);
  CHECK(a.state.posM.z == b.state.posM.z);
  CHECK(a.state.velMS.z == b.state.velMS.z);
  CHECK(propellantAboardKg(a.craft, Propellant::Monopropellant)
        == propellantAboardKg(b.craft, Propellant::Monopropellant));
}

// =============================================================================
// THE ACCEPTANCE: the last hundred metres, flown.
// =============================================================================
struct ApproachResult {
  bool captured = false;
  double flownS = 0.0;
  double finalRangeM = 0.0;
  double contactSpeedMS = 0.0;
  double contactConeDeg = 0.0;
  double worstLateralInFinalM = 0.0;
  // How far OUTSIDE the corridor cone it ever got. This is the invariant the
  // design actually claims; a bare metre bound on the lateral error is not,
  // because the cone widens with range and 5.24 m at 30 m out is inside it.
  double worstCorridorBreachM = -1e300;
  double monoUsedKg = 0.0;
  double closestApproachM = 1e300;
  ap2::Leg lastLeg = ap2::Leg::Align;
  const char* note = "";
};

// Fly it. The target port is HANDED IN every tick (R77/R79's independence), so
// this driver owns the target's motion and the program never asks where it is.
static ApproachResult flyApproach(const Vec3& startRelPosM,
                                  const Vec3& startRelVelMS,
                                  const Vec3& targetFaceAxis,
                                  double limitS,
                                  const ap2::Corridor& corridor) {
  const dk::Limits lim;
  // The station's port: parked in a circular orbit, with the whole thing (port
  // and vessel alike) carried at orbital speed so the common motion is real
  // rather than assumed away.
  const Vec3 stationPos{680.0e3, 0, 0};
  const Vec3 stationVel{0, 0, std::sqrt(kMu / 680.0e3)};

  FlightSim sim;
  sim.craft = dockingCraft();
  sim.env = vacuumEnv();
  sim.state.forward = orbital::normalized(targetFaceAxis) * -1.0;
  sim.state.right = orbital::normalized(
      orbital::cross(sim.state.forward, Vec3{0.3, 0.5, 0.81}));
  sim.sas = SasMode::Command;
  sim.sasCommand = sim.state.forward;

  dk::PortPose tgt;
  tgt.faceAxis = orbital::normalized(targetFaceAxis);
  tgt.rollAxis = orbital::normalized(
      orbital::cross(tgt.faceAxis, Vec3{0.11, 0.93, 0.35}));
  tgt.posM = stationPos;

  // Place the VESSEL so that its PORT starts at the requested relative offset.
  const dk::PortPose local = vesselPortLocal();
  {
    const dk::PortPose atOrigin =
        dk::portAt(Vec3{0, 0, 0}, sim.state.forward, sim.state.right, local);
    sim.state.posM = (tgt.posM + startRelPosM) - atOrigin.posM;
    sim.state.velMS = stationVel + startRelVelMS;
  }

  const double mono0 = propellantAboardKg(sim.craft, Propellant::Monopropellant);
  ApproachResult r;
  const double dt = 1.0 / 60.0;
  const int steps = static_cast<int>(limitS / dt);
  dk::PortPose minePrev =
      dk::portAt(sim.state.posM, sim.state.forward, sim.state.right, local);
  dk::PortPose tgtPrev = tgt;

  const orbital::StateVector station0{stationPos, stationVel};
  for (int i = 0; i < steps; ++i) {
    // THE TARGET IS PROPAGATED ON ITS REAL ORBIT, AND THE FIRST VERSION OF THIS
    // DRIVER MOVED IT IN A STRAIGHT LINE. That is a harness defect of exactly
    // the kind INSTRUMENTS.md keeps cataloguing: the vessel was integrating
    // under gravity while its target flew off tangentially, so the two
    // separated by 85 km over the approach and the program was being asked to
    // fight 7.6 m/s^2 of gravity with 2 m/s^2 of thrusters. The approach failed
    // for a reason that had nothing to do with the approach.
    const orbital::StateVector st =
        orbital::propagate(station0, sim.state.timeS, kMu);
    tgt.posM = st.r;

    const ap2::Guidance g =
        ap2::guide(tgt, st.v, sim.state.posM, sim.state.velMS,
                   sim.state.forward, sim.state.right, local, lim, corridor);
    r.lastLeg = g.leg;
    r.note = g.note;
    if (g.leg == ap2::Leg::Aborted) break;
    if (g.leg == ap2::Leg::Final) {
      if (g.lateralM > r.worstLateralInFinalM) r.worstLateralInFinalM = g.lateralM;
      const double allowed = lim.captureRadiusM
          + std::fmax(0.0, g.alongM) * std::tan(corridor.corridorHalfAngleRad);
      const double breach = g.lateralM - allowed;
      if (breach > r.worstCorridorBreachM) r.worstCorridorBreachM = breach;
    }

    sim.sas = SasMode::Command;
    sim.sasCommand = g.sasCommand;
    sim.rcsTranslate = g.rcsTranslate;
    // BOTH ENDS OF THE TICK, FOR BOTH BODIES, AT THE SAME TWO INSTANTS. The
    // first version of this driver compared the station over [t-dt, t] against
    // the vessel over [t, t+dt], because it read the target BEFORE the step and
    // the vessel AFTER it. One tick of orbital motion is 38 m at 2278 m/s, so
    // `sweptCapture` was handed a 38 m offset and reported a closest approach
    // of 38 m while the two ports were 0.356 m apart with the nose dead on.
    // The program was arriving correctly the whole time and the instrument was
    // measuring two different moments.
    minePrev = dk::portAt(sim.state.posM, sim.state.forward, sim.state.right, local);
    tgtPrev = tgt;
    sim.step(dt);
    tgt.posM = orbital::propagate(station0, sim.state.timeS, kMu).r;

    const dk::PortPose mine =
        dk::portAt(sim.state.posM, sim.state.forward, sim.state.right, local);
    const dk::CaptureResult cap =
        dk::sweptCapture(tgtPrev, tgt, minePrev, mine, lim, dt);
    if (cap.closestApproachM < r.closestApproachM)
      r.closestApproachM = cap.closestApproachM;
    if (cap.captured) {
      r.captured = true;
      r.contactSpeedMS = cap.closingMS;
      r.contactConeDeg = cap.coneErrorRad * kDeg;
      r.finalRangeM = cap.separationM;
      r.flownS = sim.state.timeS;
      break;
    }
    r.flownS = sim.state.timeS;
    r.finalRangeM = (mine.posM - tgt.posM).length();
  }
  r.monoUsedKg =
      mono0 - propellantAboardKg(sim.craft, Propellant::Monopropellant);
  return r;
}

TEST(the_autopilot_flies_the_last_hundred_metres_and_the_ports_mate) {
  const ap2::Corridor c;
  // PH-154's own measured arrival: 108.87 m out at 0.23133 m/s relative. Offset
  // sideways as well as along, because a rendezvous does not arrive on the
  // docking axis and a fixture that started on it would test nothing about the
  // corridor.
  const Vec3 face{0, 0, 1};
  const Vec3 start = Vec3{60.0, 70.0, 30.0};
  CHECK_NEAR(start.length(), 96.95, 0.05);
  const ApproachResult r =
      flyApproach(start, Vec3{0, 0, -0.23133}, face, 1200.0, c);

  // THE ASSERTION REID NAMED: it docked.
  CHECK(r.captured);
  CHECK(r.lastLeg != ap2::Leg::Aborted);
  // Gently, and pointed the right way, which is what makes it a dock rather
  // than a collision that happened to end at the right place.
  CHECK(r.contactSpeedMS < 1.0);
  CHECK(r.contactSpeedMS > 0.0);
  CHECK(r.contactConeDeg < 5.0);
  CHECK(r.finalRangeM <= 0.60 + 1e-9);
  // IT ARRIVED DOWN THE AXIS, and the assertion is the corridor invariant
  // rather than a metre count: the cone is `captureRadius + along*tan(10 deg)`,
  // so it widens with range and a bare bound would be either vacuous far out or
  // impossible close in. MEASURED: the worst lateral error during the final
  // approach is 5.24 m, at 30 m out where the cone allows 5.89, and it never
  // breaches the cone at all.
  CHECK(r.worstCorridorBreachM <= 0.0);
  CHECK(r.worstLateralInFinalM > 1.0);   // the fixture really was off-axis
  CHECK(r.worstLateralInFinalM < 8.0);
  // It cost propellant, which proves the thrusters did the work rather than the
  // fixture drifting into place.
  CHECK(r.monoUsedKg > 0.0);
  CHECK(r.flownS > 10.0);
}

// -----------------------------------------------------------------------------
// THE NEGATIVE CONTROL, AND IT IS THE ONE THAT MATTERS: the same flight with
// the program's thrusters silenced. If the vessel arrives anyway, the test
// above was measuring a fixture that was already pointed at the target.
// -----------------------------------------------------------------------------
TEST(without_the_approach_program_the_same_flight_drifts_past) {
  ap2::Corridor c;
  const Vec3 face{0, 0, 1};
  const Vec3 start = Vec3{60.0, 70.0, 30.0};
  const Vec3 vel{0, 0, -0.23133};

  // Same driver, one thing removed: the thruster command is zeroed.
  const dk::Limits lim;
  const Vec3 stationPos{680.0e3, 0, 0};
  const Vec3 stationVel{0, 0, std::sqrt(kMu / 680.0e3)};
  FlightSim sim;
  sim.craft = dockingCraft();
  sim.env = vacuumEnv();
  sim.state.forward = orbital::normalized(face) * -1.0;
  sim.state.right =
      orbital::normalized(orbital::cross(sim.state.forward, Vec3{0.3, 0.5, 0.81}));
  sim.sas = SasMode::Command;
  sim.sasCommand = sim.state.forward;
  dk::PortPose tgt;
  tgt.faceAxis = orbital::normalized(face);
  tgt.rollAxis = orbital::normalized(orbital::cross(tgt.faceAxis, Vec3{0.11, 0.93, 0.35}));
  tgt.posM = stationPos;
  const dk::PortPose local = vesselPortLocal();
  const dk::PortPose atOrigin =
      dk::portAt(Vec3{0, 0, 0}, sim.state.forward, sim.state.right, local);
  sim.state.posM = (tgt.posM + start) - atOrigin.posM;
  sim.state.velMS = stationVel + vel;

  double closest = 1e300;
  const double dt = 1.0 / 60.0;
  dk::PortPose minePrev =
      dk::portAt(sim.state.posM, sim.state.forward, sim.state.right, local);
  dk::PortPose tgtPrev = tgt;
  bool captured = false;
  const orbital::StateVector station0{stationPos, stationVel};
  for (int i = 0; i < 72000; ++i) {          // the same 1200 s
    tgt.posM = orbital::propagate(station0, sim.state.timeS, kMu).r;
    sim.rcsTranslate = Vec3{0, 0, 0};        // THE ONE DIFFERENCE
    minePrev = dk::portAt(sim.state.posM, sim.state.forward, sim.state.right, local);
    tgtPrev = tgt;
    sim.step(dt);
    tgt.posM = orbital::propagate(station0, sim.state.timeS, kMu).r;
    const dk::PortPose mine =
        dk::portAt(sim.state.posM, sim.state.forward, sim.state.right, local);
    const dk::CaptureResult cap =
        dk::sweptCapture(tgtPrev, tgt, minePrev, mine, lim, dt);
    if (cap.closestApproachM < closest) closest = cap.closestApproachM;
    if (cap.captured) { captured = true; break; }
  }
  // It does NOT dock, and it does not come remotely close: a 0.23 m/s drift
  // aimed 98.5 m away misses by tens of metres, which is exactly why the last
  // hundred metres needs a program rather than patience.
  CHECK(!captured);
  CHECK(closest > 5.0);
}

// -----------------------------------------------------------------------------
// IT WILL NOT COME THROUGH THE HULL. Started on the WRONG SIDE of the station's
// port, the program must go round rather than straight, and the tell is that it
// spends time in Align with `alongM` negative before it ever closes.
// -----------------------------------------------------------------------------
TEST(an_approach_from_behind_the_port_goes_round_rather_than_through) {
  const ap2::Corridor c;
  const dk::Limits lim;
  dk::PortPose tgt;
  tgt.posM = Vec3{0, 0, 0};
  tgt.faceAxis = Vec3{0, 0, 1};
  tgt.rollAxis = Vec3{1, 0, 0};
  const dk::PortPose local = vesselPortLocal();

  // 80 m out on the far side: `alongM` is negative, so any straight line to the
  // port passes through the station.
  const Vec3 behind{0, 0, -80.0};
  const Vec3 fwd = tgt.faceAxis * -1.0;
  const Vec3 right = orbital::normalized(orbital::cross(fwd, Vec3{0.2, 0.9, 0.3}));
  const ap2::Guidance g = ap2::guide(tgt, Vec3{0, 0, 0}, behind, Vec3{0, 0, 0},
                                     fwd, right, local, lim, c);
  CHECK(g.leg == ap2::Leg::Align);
  CHECK(g.alongM < 0.0);
  CHECK(std::string(g.note) == "swinging round to the port's own side");
  // AND THE COMMANDED PUSH IS AWAY FROM THE STATION, not toward it: the aim
  // point is the standoff, which is on the other side, so the thruster
  // command's component along the port's axis is POSITIVE.
  CHECK(g.rcsTranslate.dot(tgt.faceAxis) > 0.0);
}

// -----------------------------------------------------------------------------
// AND A RADIALLY MOUNTED PORT IS REFUSED BY NAME, because `flight.h` has no
// roll command (PH-44) and a nose direction alone does not determine where a
// side-mounted port is pointing.
// -----------------------------------------------------------------------------
TEST(a_port_that_is_not_on_the_stack_axis_is_refused_rather_than_aimed) {
  const ap2::Corridor c;
  const dk::Limits lim;
  dk::PortPose tgt;
  tgt.posM = Vec3{0, 0, 0};
  tgt.faceAxis = Vec3{0, 0, 1};
  tgt.rollAxis = Vec3{1, 0, 0};

  dk::PortPose sideways = vesselPortLocal();
  sideways.faceAxis = Vec3{1, 0, 0};        // out of the flank
  sideways.rollAxis = Vec3{0, 1, 0};
  const ap2::Guidance g =
      ap2::guide(tgt, Vec3{0, 0, 0}, Vec3{0, 0, 50.0}, Vec3{0, 0, 0},
                 Vec3{0, 0, -1}, Vec3{1, 0, 0}, sideways, lim, c);
  CHECK(g.leg == ap2::Leg::Aborted);
  CHECK(std::string(g.note)
        == "cannot auto-approach on a port that is not on the stack axis");
  CHECK(g.rcsTranslate.length() == 0.0);    // and it commands nothing

  // THE POSITIVE CONTROL: the same call with the shipped axial port is not
  // refused, so the refusal is about the mounting and not about the geometry.
  const ap2::Guidance ok =
      ap2::guide(tgt, Vec3{0, 0, 0}, Vec3{0, 0, 50.0}, Vec3{0, 0, 0},
                 Vec3{0, 0, -1}, Vec3{1, 0, 0}, vesselPortLocal(), lim, c);
  CHECK(ok.leg != ap2::Leg::Aborted);
}
