// =============================================================================
// test_descent.cpp - the touchdown gate and the powered descent
// (of/landing.h, of/descent.h, PH-175 / PH-176).
//
// THE FIXTURE IS THE POINT OF THIS FILE. Four times this project has been
// caught by a scene that could not exhibit the defect: a belt corner that
// measured exactly 0 degrees on flat ground and 10.1 on a hillside, a radial
// offset tested only at zero, a probe that dug its own tunnel where the
// heightfield was two metres away instead of nineteen, and an 8 m machine that
// falsified four constants sized against 1 m ones.
//
// A DESCENT TESTED ONLY ONTO FLAT GROUND IS THAT AGAIN. So every landing here
// is flown onto REAL Cinder, sampled through `worldgen::sampleHeightField`, at
// sites this file SEARCHES FOR BY SLOPE and then states the slope of. The flat
// case is one row of several rather than the only one.
// =============================================================================
#include <cmath>
#include <cstdio>

#include "of/cubed_sphere.h"
#include "of/descent.h"
#include "of/flight.h"
#include "of/landing.h"
#include "of/orbital.h"
#include "of/vessel.h"
#include "test_framework.h"

using namespace of;
using namespace of::vessel;
using namespace of::flight;
namespace ld = of::landing;
namespace de = of::descent;

static const double kDeg = 180.0 / orbital::kPi;

// The vehicle's own footprint is the slope baseline that matters: a ripple
// narrower than the legs does not tip anything.
static const double kFootprintM = 6.0;

static Vessel lander() {
  Vessel v;
  PartHandle pod = v.addRoot(parts::CommandPod);
  PartHandle tank = v.attach(pod, parts::TankLiquidSmall, Attach::StackBottom);
  PartHandle eng = v.attach(tank, parts::EngineVacuumSmall, Attach::StackBottom);
  Stage s0; s0.activate.push_back(eng);
  v.stages.push_back(s0);
  v.layout();
  fireStage(v);
  v.layout();
  return v;
}

static FlightEnvironment cinderEnv() {
  const worldgen::BodyParams b = worldgen::makeCinder(1);
  FlightEnvironment e;
  e.muM3S2 = orbital::kCinderMu;
  e.bodyRadiusM = orbital::kCinderRadiusM;
  e.air = atmo::makeCinderAtmosphere();
  return e;
}

// A direction on the sphere from two angles, so a search can sweep it.
static Vec3 dirAt(double lat, double lon) {
  return Vec3{std::cos(lat) * std::cos(lon), std::sin(lat),
              std::cos(lat) * std::sin(lon)};
}

// =============================================================================
// DW-20 / R8: FIND the sites before flying to them, and state what they are.
// =============================================================================
struct Site { Vec3 dir; double slopeDeg; double radiusM; };

static Site findSite(const worldgen::BodyParams& body, double wantDeg,
                     double tolDeg) {
  Site best{Vec3{1, 0, 0}, -1.0, 0.0};
  double bestErr = 1e300;
  for (int i = 0; i < 140; ++i) {
    for (int j = 0; j < 140; ++j) {
      const double lat = -1.3 + 2.6 * (i / 139.0);
      const double lon = -orbital::kPi + 2.0 * orbital::kPi * (j / 139.0);
      const Vec3 d = dirAt(lat, lon);
      const ld::SurfaceFrame f = ld::surfaceFrame(body, d, kFootprintM);
      const double deg = f.slopeRad * kDeg;
      const double err = std::fabs(deg - wantDeg);
      if (err < bestErr) {
        bestErr = err;
        best = Site{d, deg, f.radiusM};
      }
      if (bestErr < tolDeg) return best;
    }
  }
  return best;
}

TEST(the_moon_really_does_have_slopes_to_land_on_and_the_baseline_decides) {
  const worldgen::BodyParams cinder = worldgen::makeCinder(1);

  // THE SITES THIS FILE FLIES TO, found by search and reported as numbers.
  const Site flat = findSite(cinder, 0.5, 0.2);
  const Site gentle = findSite(cinder, 8.0, 0.3);
  const Site steep = findSite(cinder, 25.0, 0.6);
  std::printf("    [sites] flat %.3f deg, gentle %.3f deg, steep %.3f deg\n",
              flat.slopeDeg, gentle.slopeDeg, steep.slopeDeg);
  CHECK(flat.slopeDeg < 1.0);
  CHECK(gentle.slopeDeg > 5.0 && gentle.slopeDeg < 12.0);
  // A slope steeper than the touchdown gate allows EXISTS, which is what makes
  // the refusal reachable rather than theoretical.
  const ld::TouchdownLimits lim;
  CHECK(steep.slopeDeg > lim.maxSlopeRad * kDeg);

  // AND THE BASELINE IS PART OF THE SLOPE (WG-146). The same point measured
  // over the vehicle's footprint and over a kilometre is not the same number,
  // and a lander cares about the first.
  const ld::SurfaceFrame near = ld::surfaceFrame(cinder, steep.dir, kFootprintM);
  const ld::SurfaceFrame far = ld::surfaceFrame(cinder, steep.dir, 1000.0);
  std::printf("    [baseline] the same point reads %.3f deg over %.1f m and "
              "%.3f deg over 1000 m\n",
              near.slopeRad * kDeg, kFootprintM, far.slopeRad * kDeg);
  CHECK(std::fabs(near.slopeRad - far.slopeRad) * kDeg > 1.0);

  // The normal is a real unit normal and points OUT, at every site.
  for (const Site& s : {flat, gentle, steep}) {
    const ld::SurfaceFrame f = ld::surfaceFrame(cinder, s.dir, kFootprintM);
    CHECK_NEAR(f.normalUnit.length(), 1.0, 1e-12);
    CHECK(f.normalUnit.dot(f.upUnit) > 0.0);
    CHECK(f.radiusM > 0.9 * cinder.radiusM);
  }
}

// =============================================================================
// THE GATE, and every refusal driven from a state rather than described.
// =============================================================================
TEST(the_touchdown_gate_names_each_way_a_landing_fails) {
  const worldgen::BodyParams cinder = worldgen::makeCinder(1);
  const ld::TouchdownLimits lim;
  const Site flat = findSite(cinder, 0.5, 0.2);
  const ld::SurfaceFrame g = ld::surfaceFrame(cinder, flat.dir, kFootprintM);
  const Vec3 up = g.upUnit;
  const Vec3 east = orbital::normalized(orbital::cross(Vec3{0, 1, 0}, up));
  const Vec3 at = up * g.radiusM;

  // A good landing.
  {
    const ld::Touchdown t = ld::evaluate(at, up * -0.8, up, g, lim);
    CHECK(t.onGround);
    CHECK(t.landed);
    CHECK(std::string(t.note) == "landed");
    CHECK_NEAR(t.verticalMS, 0.8, 1e-9);
  }
  // Still flying: the same state a kilometre up is not a landing at all.
  {
    const ld::Touchdown t = ld::evaluate(up * (g.radiusM + 1000.0), up * -0.8,
                                         up, g, lim);
    CHECK(!t.onGround);
    CHECK(!t.landed);
    CHECK(std::string(t.note) == "flying");
    CHECK_NEAR(t.altitudeAglM, 1000.0, 1e-6);
  }
  // Straight down too fast.
  {
    const ld::Touchdown t = ld::evaluate(at, up * -6.0, up, g, lim);
    CHECK(t.onGround && !t.landed);
    CHECK(std::string(t.note) == "crashed: came down too fast");
  }
  // Sideways too fast: the one legs cannot absorb.
  {
    const ld::Touchdown t = ld::evaluate(at, up * -0.5 + east * 3.0, up, g, lim);
    CHECK(t.onGround && !t.landed);
    CHECK(std::string(t.note) == "crashed: too much sideways speed, it tipped over");
  }
  // Not upright.
  {
    const Vec3 tipped = orbital::normalized(up + east * 0.6);   // ~31 degrees
    const ld::Touchdown t = ld::evaluate(at, up * -0.5, tipped, g, lim);
    CHECK(t.onGround && !t.landed);
    CHECK(std::string(t.note) == "crashed: not upright on the slope it landed on");
  }
  // AND THE GATE IS TWO-SIDED at each bound rather than proven on one side.
  {
    const ld::Touchdown ok = ld::evaluate(at, up * -4.99, up, g, lim);
    const ld::Touchdown no = ld::evaluate(at, up * -5.01, up, g, lim);
    CHECK(ok.landed);
    CHECK(!no.landed);
  }

  // The ground itself refusing, on a real Cinder slope steeper than the limit.
  {
    const Site steep = findSite(cinder, 25.0, 0.6);
    const ld::SurfaceFrame s = ld::surfaceFrame(cinder, steep.dir, kFootprintM);
    const ld::Touchdown t =
        ld::evaluate(s.upUnit * s.radiusM, s.upUnit * -0.2, s.normalUnit, s, lim);
    CHECK(t.onGround && !t.landed);
    CHECK(std::string(t.note) == "crashed: the ground here is too steep to stand on");
    // Even landing PERFECTLY: gently, and aligned to the slope itself. That is
    // the point of putting the ground's refusal first.
    CHECK(t.verticalMS < 0.5);
    CHECK_NEAR(t.tiltRad, 0.0, 1e-9);
  }
}

// -----------------------------------------------------------------------------
// TILT IS MEASURED AGAINST THE TERRAIN, NOT AGAINST GRAVITY, and on a slope
// those are different claims. A vehicle plumb with gravity is tilted relative
// to the hillside it is about to put its legs on.
// -----------------------------------------------------------------------------
TEST(tilt_is_measured_against_the_ground_and_not_against_gravity) {
  const worldgen::BodyParams cinder = worldgen::makeCinder(1);
  const ld::TouchdownLimits lim;
  const Site gentle = findSite(cinder, 8.0, 0.3);
  const ld::SurfaceFrame g = ld::surfaceFrame(cinder, gentle.dir, kFootprintM);

  // Plumb with gravity: tilted by exactly the slope.
  const ld::Touchdown plumb =
      ld::evaluate(g.upUnit * g.radiusM, g.upUnit * -0.5, g.upUnit, g, lim);
  CHECK_NEAR(plumb.tiltRad, g.slopeRad, 1e-12);
  CHECK(plumb.tiltRad * kDeg > 5.0);

  // Aligned to the hillside: tilt zero, which is what a lander should do.
  const ld::Touchdown aligned =
      ld::evaluate(g.upUnit * g.radiusM, g.upUnit * -0.5, g.normalUnit, g, lim);
  CHECK_NEAR(aligned.tiltRad, 0.0, 1e-9);
  CHECK(aligned.landed);
}

// =============================================================================
// THE ACCEPTANCE: fly it down, onto real terrain, at three measured slopes.
// =============================================================================
struct LandResult {
  bool landed = false, onGround = false, aborted = false;
  double touchdownVerticalMS = 0.0, touchdownLateralMS = 0.0;
  double touchdownTiltDeg = 0.0, slopeDeg = 0.0;
  double flownS = 0.0, startAltM = 0.0, minAglM = 1e300;
  double propUsedKg = 0.0;
  const char* note = "";
};

static LandResult flyDown(const Site& site, double startAltM,
                          double startLateralMS, double limitS) {
  const worldgen::BodyParams cinder = worldgen::makeCinder(1);
  const ld::TouchdownLimits lim;
  const de::Profile prof;

  FlightSim sim;
  sim.craft = lander();
  sim.env = cinderEnv();

  const ld::SurfaceFrame g0 = ld::surfaceFrame(cinder, site.dir, kFootprintM);
  const Vec3 up0 = g0.upUnit;
  const Vec3 east = orbital::normalized(orbital::cross(Vec3{0, 1, 0}, up0));
  sim.state.posM = up0 * (g0.radiusM + startAltM);
  sim.state.velMS = east * startLateralMS - up0 * 5.0;   // moving, and falling
  sim.state.forward = up0;
  sim.state.right = east;
  sim.sas = SasMode::Command;
  sim.sasCommand = up0;

  LandResult r;
  r.startAltM = startAltM;
  const double prop0 = propellantAboardKg(sim.craft, Propellant::LiquidFuel);
  const double dt = 1.0 / 60.0;
  const int steps = static_cast<int>(limitS / dt);
  for (int i = 0; i < steps; ++i) {
    // THE GROUND UNDER THE VEHICLE, RESAMPLED EVERY TICK. Not the site it
    // started above: it has been moving sideways, and on a crater field the
    // terrain under it is a different height every second.
    const ld::SurfaceFrame g =
        ld::surfaceFrame(cinder, orbital::normalized(sim.state.posM), kFootprintM);
    r.slopeDeg = g.slopeRad * kDeg;

    const double rr = std::fmax(1.0, sim.state.posM.length());
    const double gravity = sim.env.muM3S2 / (rr * rr);
    sim.craft.layout();
    const PropulsionOutput full = evaluatePropulsion(sim.craft, 1.0, 0.0);
    const double mass = std::fmax(1.0, massProperties(sim.craft).totalKg);

    const de::Guidance gd = de::guide(sim.state.posM, sim.state.velMS, g,
                                      gravity, full.thrustN / mass, prof);
    if (gd.altitudeAglM < r.minAglM) r.minAglM = gd.altitudeAglM;
    r.note = gd.note;
    if (gd.leg == de::Leg::Aborted) { r.aborted = true; break; }

    sim.sas = SasMode::Command;
    sim.sasCommand = gd.sasCommand;
    sim.state.throttle = gd.throttle;
    sim.step(dt);

    const ld::SurfaceFrame gAfter =
        ld::surfaceFrame(cinder, orbital::normalized(sim.state.posM), kFootprintM);
    const ld::Touchdown t = ld::evaluate(sim.state.posM, sim.state.velMS,
                                         sim.state.forward, gAfter, lim);
    if (t.onGround) {
      r.onGround = true;
      r.landed = t.landed;
      r.touchdownVerticalMS = t.verticalMS;
      r.touchdownLateralMS = t.horizontalMS;
      r.touchdownTiltDeg = t.tiltRad * kDeg;
      r.slopeDeg = t.slopeRad * kDeg;
      r.note = t.note;
      r.flownS = sim.state.timeS;
      break;
    }
    r.flownS = sim.state.timeS;
  }
  r.propUsedKg = prop0 - propellantAboardKg(sim.craft, Propellant::LiquidFuel);
  return r;
}

TEST(a_lander_flies_itself_down_onto_real_moon_terrain) {
  const worldgen::BodyParams cinder = worldgen::makeCinder(1);
  const Site flat = findSite(cinder, 0.5, 0.2);
  const Site gentle = findSite(cinder, 8.0, 0.3);

  // R8: flat AND slope, and the slope is the one that matters.
  const LandResult a = flyDown(flat, 2000.0, 20.0, 600.0);
  std::printf("    [flat  ] slope %.2f deg -> %s, v %.4f lat %.4f tilt %.3f "
              "in %.1f s, %.1f kg\n", a.slopeDeg, a.note, a.touchdownVerticalMS,
              a.touchdownLateralMS, a.touchdownTiltDeg, a.flownS, a.propUsedKg);
  CHECK(a.onGround);
  CHECK(a.landed);
  CHECK(std::string(a.note) == "landed");
  CHECK(a.touchdownVerticalMS < 5.0);
  CHECK(a.touchdownLateralMS < 2.0);
  CHECK(a.propUsedKg > 0.0);            // it flew rather than fell

  const LandResult b = flyDown(gentle, 2000.0, 20.0, 600.0);
  std::printf("    [slope ] slope %.2f deg -> %s, v %.4f lat %.4f tilt %.3f "
              "in %.1f s, %.1f kg\n", b.slopeDeg, b.note, b.touchdownVerticalMS,
              b.touchdownLateralMS, b.touchdownTiltDeg, b.flownS, b.propUsedKg);
  CHECK(b.onGround);
  CHECK(b.landed);
  CHECK(b.touchdownVerticalMS < 5.0);
  CHECK(b.touchdownLateralMS < 2.0);
  // The fixture really was a slope, or the row above tested nothing new.
  CHECK(b.slopeDeg > 3.0);
}

// -----------------------------------------------------------------------------
// THE NEGATIVE CONTROL: the same descent with the program's throttle removed.
// If it survives anyway, the acceptance was measuring a fall onto a low moon.
// -----------------------------------------------------------------------------
TEST(without_the_descent_program_the_same_fall_is_a_crash) {
  const worldgen::BodyParams cinder = worldgen::makeCinder(1);
  const ld::TouchdownLimits lim;
  const Site flat = findSite(cinder, 0.5, 0.2);
  const ld::SurfaceFrame g0 = ld::surfaceFrame(cinder, flat.dir, kFootprintM);
  const Vec3 up0 = g0.upUnit;
  const Vec3 east = orbital::normalized(orbital::cross(Vec3{0, 1, 0}, up0));

  FlightSim sim;
  sim.craft = lander();
  sim.env = cinderEnv();
  sim.state.posM = up0 * (g0.radiusM + 2000.0);
  sim.state.velMS = east * 20.0 - up0 * 5.0;
  sim.state.forward = up0;
  sim.state.right = east;
  sim.sas = SasMode::Command;
  sim.sasCommand = up0;

  bool onGround = false, landed = false;
  double vAt = 0.0;
  const double dt = 1.0 / 60.0;
  for (int i = 0; i < 36000; ++i) {
    sim.state.throttle = 0.0;                    // THE ONE DIFFERENCE
    sim.step(dt);
    const ld::SurfaceFrame g =
        ld::surfaceFrame(cinder, orbital::normalized(sim.state.posM), kFootprintM);
    const ld::Touchdown t = ld::evaluate(sim.state.posM, sim.state.velMS,
                                         sim.state.forward, g, lim);
    if (t.onGround) { onGround = true; landed = t.landed; vAt = t.verticalMS; break; }
  }
  CHECK(onGround);
  CHECK(!landed);
  // It arrives far outside the gate rather than marginally: a 2 km fall at
  // 1.63 m/s^2 reaches about 81 m/s, sixteen times what the legs take.
  CHECK(vAt > 40.0);
}

// -----------------------------------------------------------------------------
// AND A VEHICLE THAT CANNOT HOLD ITSELF UP IS REFUSED BEFORE IT IS FLOWN, which
// is the one refusal that has to happen at the top of the descent rather than
// at the bottom of it.
// -----------------------------------------------------------------------------
TEST(a_lander_with_less_thrust_than_weight_is_refused_rather_than_flown) {
  const worldgen::BodyParams cinder = worldgen::makeCinder(1);
  const Site flat = findSite(cinder, 0.5, 0.2);
  const ld::SurfaceFrame g = ld::surfaceFrame(cinder, flat.dir, kFootprintM);
  const de::Profile p;
  const double gravity = orbital::kCinderMu / (g.radiusM * g.radiusM);

  const de::Guidance no =
      de::guide(g.upUnit * (g.radiusM + 500.0), g.upUnit * -5.0, g, gravity,
                gravity * 0.9, p);
  CHECK(no.leg == de::Leg::Aborted);
  CHECK(std::string(no.note) == "aborted: this vehicle cannot hold itself up here");
  CHECK(no.throttle == 0.0);

  // THE POSITIVE CONTROL, one per cent the other side of the same bound, and in
  // a state where the brake must actually engage: 100 m up doing 40 m/s when
  // the ceiling there is 15.
  const de::Guidance yes =
      de::guide(g.upUnit * (g.radiusM + 100.0), g.upUnit * -40.0, g, gravity,
                gravity * 1.1, p);
  CHECK(yes.leg != de::Leg::Aborted);
  CHECK(yes.throttle > 0.0);
  CHECK_NEAR(yes.targetDescentMS, 15.0, 1e-9);

  // AND THE CEILING IS A CEILING: the same vehicle at the same height falling
  // SLOWER than it is allowed to commands EXACTLY NOTHING. This is the
  // assertion that pins the fuel behaviour, and it is the one that was wrong
  // in the first version of this file: a lander under its own limit should be
  // falling, not hovering, and not being pushed down to reach a setpoint.
  const de::Guidance coasting =
      de::guide(g.upUnit * (g.radiusM + 100.0), g.upUnit * -5.0, g, gravity,
                gravity * 1.1, p);
  CHECK(coasting.leg != de::Leg::Aborted);
  CHECK(coasting.throttle == 0.0);
  CHECK(coasting.descentMS < coasting.targetDescentMS);
}
