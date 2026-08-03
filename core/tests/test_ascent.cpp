// =============================================================================
// test_ascent.cpp - the airless ascent program (of/ascent.h, PH-200), and the
// R63 calibration that falls out of flying it.
//
// THE FIXTURE IS THE POINT OF THIS FILE, exactly as it is in test_descent.cpp.
// A descent tested only onto flat ground is the flat-spawn trap this project
// has been caught by five times; AN ASCENT TESTED ONLY FROM A FLAT PAD IS THE
// SAME FAILURE. So every launch here is flown off REAL Cinder through
// `worldgen::sampleHeightField`, from sites this file SEARCHES FOR and then
// states, and one of them is a CRATER FLOOR with the rim standing above it,
// which is the site where the terrain gets a vote on the profile.
//
// THREE THINGS THAT WOULD MAKE A GREEN HERE MEANINGLESS, AND WHAT IS DONE
// ABOUT EACH:
//
//  * A run that never reached the interesting leg. Every flight counts the
//    ticks it spent in each leg and the acceptance asserts that all five were
//    VISITED, so a flight that fell out of the loop cannot read as one that
//    flew the profile.
//  * A gate that is only ever seen to pass. Every refusal here has a positive
//    control on the other side of the same bound, in the same test.
//  * An instrument that costs more than the thing it measures. The terrain is
//    resampled EVERY TICK near the ground and once a second above the
//    clearance ceiling, where the law provably cannot read it -- and that claim
//    is not asserted in prose, it is driven: `the_cheap_terrain_schedule_
//    changes_nothing` flies both and compares the orbits.
// =============================================================================
#include <cmath>
#include <cstdio>
#include <string>

#include "of/ascent.h"
#include "of/cubed_sphere.h"
#include "of/flight.h"
#include "of/landing.h"
#include "of/orbital.h"
#include "of/transfer.h"
#include "of/vessel.h"
#include "test_framework.h"

using namespace of;
using namespace of::vessel;
using namespace of::flight;
namespace ld = of::landing;
namespace as = of::ascent;

static const double kDeg = 180.0 / orbital::kPi;
static const double kFootprintM = 6.0;

// The same lander test_descent.cpp puts DOWN on Cinder. A round trip should be
// one vehicle, or neither half is about the other.
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
  FlightEnvironment e;
  e.muM3S2 = orbital::kCinderMu;
  e.bodyRadiusM = orbital::kCinderRadiusM;
  e.air = atmo::makeCinderAtmosphere();
  return e;
}

static Vec3 dirAt(double lat, double lon) {
  return Vec3{std::cos(lat) * std::cos(lon), std::sin(lat),
              std::cos(lat) * std::sin(lon)};
}

// =============================================================================
// THE SITES, FOUND AND THEN STATED. Two searches, because an ascent cares about
// a different property of the ground than a descent does: a descent needs a
// SLOPE it can stand on, an ascent needs to know what is IN THE WAY.
// =============================================================================
struct Site {
  Vec3 dir;
  double slopeDeg = 0.0;
  double terrainM = 0.0;    // terrain height above the datum at the pad
  double rimAheadM = 0.0;   // the highest terrain within 30 km downrange
};

// The highest ground the vehicle will fly over in the first 10 km downrange.
//
// TEN AND NOT THIRTY, AND THE DIFFERENCE IS WHETHER THE TEST CAN SEE ANYTHING.
// The vehicle is already 7 km up by the time it is 10 km downrange, so a rim
// 30 km out is passed at an altitude nothing could threaten. A search over
// 30 km duly found a "pit" whose clamp fired 29 times and changed the flight by
// 0.0002 m/s, which is a fixture that cannot exhibit the behaviour it is for.
static double rimAhead(const worldgen::BodyParams& body, const Vec3& d,
                       const Vec3& east) {
  double hi = -1e300;
  for (int i = 1; i <= 10; ++i) {
    const double ang = (i * 1000.0) / body.radiusM;
    const Vec3 q = orbital::normalized(d + east * ang);
    const double h = worldgen::sampleHeightField(body, q);
    if (h > hi) hi = h;
  }
  return hi;
}

static Vec3 eastAt(const Vec3& d) {
  Vec3 e = orbital::cross(Vec3{0, 1, 0}, d);
  if (e.length() < 1e-9) e = orbital::cross(Vec3{1, 0, 0}, d);
  return orbital::normalized(e);
}

// A gentle pad: near-flat, and near the datum.
static Site findFlatPad(const worldgen::BodyParams& body) {
  Site best; double bestErr = 1e300;
  for (int i = 0; i < 120; ++i)
    for (int j = 0; j < 120; ++j) {
      const Vec3 d = dirAt(-1.3 + 2.6 * (i / 119.0),
                           -orbital::kPi + 2.0 * orbital::kPi * (j / 119.0));
      const ld::SurfaceFrame f = ld::surfaceFrame(body, d, kFootprintM);
      const double deg = f.slopeRad * kDeg;
      if (deg > 1.0) continue;
      const double err = std::fabs(f.radiusM - body.radiusM);
      if (err < bestErr) {
        bestErr = err;
        best = Site{d, deg, f.radiusM - body.radiusM, 0.0};
      }
      if (bestErr < 50.0) { i = 999; break; }
    }
  best.rimAheadM = rimAhead(body, best.dir, eastAt(best.dir));
  return best;
}

// A pad DOWN A HOLE: the site whose downrange rim stands highest above it.
// This is the one where the terrain gets a vote, and it is searched for rather
// than chosen so the file cannot quietly be testing a plain.
static Site findPitPad(const worldgen::BodyParams& body) {
  Site best; double bestRise = -1e300;
  for (int i = 0; i < 90; ++i)
    for (int j = 0; j < 90; ++j) {
      const Vec3 d = dirAt(-1.2 + 2.4 * (i / 89.0),
                           -orbital::kPi + 2.0 * orbital::kPi * (j / 89.0));
      const ld::SurfaceFrame f = ld::surfaceFrame(body, d, kFootprintM);
      if (f.slopeRad * kDeg > 12.0) continue;      // still landable/launchable
      const double here = f.radiusM - body.radiusM;
      const double rim = rimAhead(body, d, eastAt(d));
      if (rim - here > bestRise) {
        bestRise = rim - here;
        best = Site{d, f.slopeRad * kDeg, here, rim};
      }
    }
  return best;
}

// =============================================================================
// THE DRIVER. One real `FlightSim`, one real terrain, keys nobody presses.
// =============================================================================
struct Flown {
  bool orbit = false, aborted = false, ranOut = false;
  double dvMS = 0.0, flownS = 0.0, propKg = 0.0;
  double apoAltM = 0.0, periAltM = 0.0, eccentricity = 0.0;
  double cutoffAltM = 0.0, cutoffS = 0.0, minAglM = 1e300;
  double minAglAtDatumM = 0.0, minAglAtGroundM = 0.0, minAglAtS = 0.0;
  // THE CLOSEST IT CAME TO THE GROUND ONCE IT WAS CLEAR OF IT.
  //
  // Two earlier versions of this number measured nothing. The minimum over the
  // whole flight is the PAD, 1.0 m, on every launch. The minimum after a fixed
  // fifteen seconds is just the altitude at fifteen seconds, which is set by
  // thrust and gravity and not by the terrain. This one starts once the vehicle
  // has been above the clearance ceiling, so it can only be moved by the ground
  // coming back up to meet it.
  double minAglClearM = 1e300;
  bool everCleared = false;
  double worstPointDeg = 0.0;
  int clampTicks = 0;
  // NOT "any leg number that went down". Coast follows the insertion every time
  // the trim needs another apoapsis, and that is the program working. What is a
  // DEFECT is going back to the ASCENT legs once the orbit has been bought,
  // which is the hunt the apoapsis band exists to stop.
  int resumedAscent = 0;
  int leg[6] = {0, 0, 0, 0, 0, 0};
  const char* note = "";
};

// `cheapTerrain`: resample the height field every tick under 10 km AGL and once
// a second above it. Above `Profile::clearedAtM` the clamp cannot bind and no
// other decision reads the ground, so up there the sample is an INSTRUMENT and
// not an input. Driven, not assumed: see the control test.
static Flown fly(const Site& site, const as::Profile& prof, double limitS,
                 bool cheapTerrain = true, double aglMultiplier = 1.0) {
  const worldgen::BodyParams cinder = worldgen::makeCinder(1);
  FlightSim sim;
  sim.craft = lander();
  sim.env = cinderEnv();

  const ld::SurfaceFrame g0 = ld::surfaceFrame(cinder, site.dir, kFootprintM);
  const Vec3 up0 = g0.upUnit;
  const Vec3 east = eastAt(up0);
  sim.state.posM = up0 * (g0.radiusM + 1.0);
  sim.state.velMS = Vec3{0, 0, 0};
  sim.state.forward = up0;
  sim.state.right = east;
  sim.sas = SasMode::Command;
  sim.sasCommand = up0;

  Flown f;
  const double prop0 = propellantAboardKg(sim.craft, Propellant::LiquidFuel);
  const double dt = 1.0 / 60.0;
  const int steps = static_cast<int>(limitS / dt);
  ld::SurfaceFrame ground = g0;
  bool cutoffSeen = false;
  int prevLeg = 0;
  for (int i = 0; i < steps; ++i) {
    const Vec3 dir = orbital::normalized(sim.state.posM);
    const double aglNow = sim.state.posM.length() - ground.radiusM;
    if (!cheapTerrain || aglNow < 10000.0 * aglMultiplier || (i % 60) == 0) {
      ground = ld::surfaceFrame(cinder, dir, kFootprintM);
    } else {
      // The direction is free; the HEIGHT is what costs. And it is normalized
      // exactly the way `surfaceFrame` normalizes it, because normalizing an
      // already-unit vector a second time is not the identity in binary and a
      // one-ulp difference in `up` was enough to move the final orbit.
      ground.upUnit = orbital::normalized(dir);
    }
    sim.craft.layout();
    const PropulsionOutput full = evaluatePropulsion(sim.craft, 1.0, 0.0);
    const double mass = std::fmax(1.0, massProperties(sim.craft).totalKg);
    const double aFull = full.thrustN / mass;

    const as::Guidance g =
        as::guide(sim.state.posM, sim.state.velMS, sim.state.forward, ground,
                  east, sim.env.muM3S2, cinder.radiusM, aFull, dt, prof);
    if (g.altitudeAglM < f.minAglM) {
      f.minAglM = g.altitudeAglM;
      f.minAglAtDatumM = g.altitudeDatumM;
      f.minAglAtGroundM = ground.radiusM - cinder.radiusM;
      f.minAglAtS = sim.state.timeS;
    }
    // A FIXED 3,000 m, NOT `prof.clearedAtM`. The control below flies one
    // profile with the clamp and one WITHOUT, and `clearedAtM` is 0 in the
    // second, so keying the metric off it made the two runs measure different
    // quantities and report 3000.8 m against 1.0 m for trajectories that were
    // 0.0002 m/s apart. That is INSTRUMENTS.md's dominant failure: a control
    // that depends on the thing it is controlling for.
    if (g.altitudeAglM > 3000.0) f.everCleared = true;
    if (f.everCleared && g.altitudeAglM < f.minAglClearM)
      f.minAglClearM = g.altitudeAglM;
    f.note = g.note;
    if (g.schedulePitchRad > g.pitchFromVerticalRad + 1e-9) ++f.clampTicks;
    if (prevLeg >= 2 && static_cast<int>(g.leg) <= 1) ++f.resumedAscent;
    prevLeg = static_cast<int>(g.leg);
    ++f.leg[static_cast<int>(g.leg)];
    if (g.leg == as::Leg::Aborted) { f.aborted = true; break; }
    if (!cutoffSeen && static_cast<int>(g.leg) >= 2) {
      cutoffSeen = true;
      f.cutoffAltM = g.altitudeDatumM;
      f.cutoffS = sim.state.timeS;
    }
    {
      double c = orbital::normalized(sim.state.forward).dot(g.sasCommand);
      if (c > 1.0) c = 1.0;
      if (c < -1.0) c = -1.0;
      const double pt = std::acos(c) * kDeg;
      if (pt > f.worstPointDeg && g.throttle > 0.0) f.worstPointDeg = pt;
    }
    if (g.leg == as::Leg::Orbit) {
      f.orbit = true;
      f.apoAltM = g.apoapsisAltM;
      f.periAltM = g.periapsisAltM;
      f.eccentricity = g.eccentricity;
      f.flownS = sim.state.timeS;
      break;
    }
    sim.sas = SasMode::Command;
    sim.sasCommand = g.sasCommand;
    sim.state.throttle = g.throttle;
    sim.step(dt);
    // Delta-v SPENT, integrated through the same propulsion the integrator used
    // rather than differenced off the velocity, because the velocity also
    // carries gravity and the question here is what the engine cost.
    const PropulsionOutput used = evaluatePropulsion(sim.craft, g.throttle, 0.0);
    f.dvMS += (used.thrustN / std::fmax(1.0, massProperties(sim.craft).totalKg)) * dt;
    f.flownS = sim.state.timeS;
  }
  f.ranOut = !f.orbit && !f.aborted;
  f.propKg = prop0 - propellantAboardKg(sim.craft, Propellant::LiquidFuel);
  if (!f.orbit) {
    const OrbitSummary os = summarize(orbital::StateVector{sim.state.posM,
                                                           sim.state.velMS},
                                      sim.env.muM3S2, cinder.radiusM);
    f.apoAltM = os.apoapsisAltM; f.periAltM = os.periapsisAltM;
    f.eccentricity = os.eccentricity;
  }
  return f;
}

static const char* verdict(const Flown& f) {
  return f.orbit ? "orbit" : (f.aborted ? "ABORTED" : "RAN OUT OF TIME");
}

// =============================================================================
// R14: THE APOAPSIS OF A NEARLY-VERTICAL CLIMB, WHICH `summarize()` REFUSES TO
// HAVE AN OPINION ABOUT.
//
// This is the trap that stopped the previous attempt at this work, and it is
// asserted here from BOTH sides: the shipped summary really does report the
// climb as unbound, and `arcPeak` really does return the peak anyway.
// =============================================================================
TEST(a_vertical_climb_has_an_apoapsis_even_though_summarize_says_it_is_unbound) {
  const double mu = orbital::kCinderMu, R = orbital::kCinderRadiusM;
  const Vec3 up{0, 1, 0};
  // 100 m/s straight up off the surface, which is every launch at t = 2 s.
  const Vec3 pos = up * (R + 100.0);
  const Vec3 vel = up * 100.0;

  const OrbitSummary os = summarize(orbital::StateVector{pos, vel}, mu, R);
  std::printf("    [R14] summarize: bound=%d e=%.12f apoapsisAltM=%.4g\n",
              static_cast<int>(os.bound), os.eccentricity, os.apoapsisAltM);
  CHECK(!os.bound);                       // THE TRAP, reproduced
  CHECK(os.eccentricity >= 1.0 - 1e-12);
  CHECK(os.apoapsisAltM > 1e100);         // ... and the number it publishes

  const as::ArcPeak k = as::arcPeak(pos, vel, mu);
  // A stone thrown up at v from radius r peaks where the energy runs out:
  // r_peak = -mu/E exactly, for the radial case.
  const double energy = 0.5 * 100.0 * 100.0 - mu / (R + 100.0);
  const double want = -mu / energy;
  std::printf("    [R14] arcPeak: comesBackDown=%d apoapsis %.6f m against a "
              "hand computation of %.6f m\n",
              static_cast<int>(k.comesBackDown), k.apoapsisRadiusM, want);
  CHECK(k.comesBackDown);
  CHECK_NEAR(k.apoapsisRadiusM, want, 1e-6);
  // And a SIZE check beside the exactness one, because `want` is computed from
  // the same energy `arcPeak` uses and would agree with a sign error. A flat
  // 1.63 m/s^2 gives v^2/2g = 3067 m; gravity weakens on the way up, so the
  // true peak is a little higher and 3218 m is the right kind of number.
  CHECK(k.apoapsisRadiusM - R > 3100.0 && k.apoapsisRadiusM - R < 3300.0);

  // AND THE TIME TO IT, which the first version of this header approximated and
  // got catastrophically wrong away from apoapsis. Straight up at 100 m/s under
  // 1.63 m/s^2 comes back to rest in about 61 s; the exact Kepler answer is a
  // little more because gravity weakens on the way up.
  std::printf("    [R14] timeToApoapsis %.6f s against a flat-gravity 61.35 s\n",
              k.timeToApoapsisS);
  CHECK(k.timeToApoapsisS > 61.0 && k.timeToApoapsisS < 64.0);

  // THE OTHER END OF THE SAME FUNCTION: at periapsis of a real ellipse it must
  // return HALF A PERIOD and not zero, which is the case that fired an
  // insertion burn 14 km below where it belonged.
  {
    const double rp = R + 6000.0, ra = R + 20000.0;
    const double a = 0.5 * (rp + ra);
    const double vp = std::sqrt(mu * (2.0 / rp - 1.0 / a));
    const as::ArcPeak q = as::arcPeak(Vec3{rp, 0, 0}, Vec3{0, 0, vp}, mu);
    const double half = 0.5 * orbital::orbitalPeriod(a, mu);
    std::printf("    [R14] at PERIAPSIS of a %.0f x %.0f km ellipse: "
                "timeToApoapsis %.4f s against half a period, %.4f s\n",
                (rp - R) / 1000.0, (ra - R) / 1000.0, q.timeToApoapsisS, half);
    CHECK_NEAR(q.timeToApoapsisS, half, 1e-6);
    CHECK_NEAR(q.apoapsisRadiusM, ra, 1e-6);
  }
}

// =============================================================================
// THE CEILING RULE, WHICH IS `descent.h`'s LESSON POINTING UP.
// =============================================================================
TEST(the_target_apoapsis_is_a_floor_and_an_overshoot_is_never_paid_for_twice) {
  const worldgen::BodyParams cinder = worldgen::makeCinder(1);
  const Site pad = findFlatPad(cinder);
  const ld::SurfaceFrame g = ld::surfaceFrame(cinder, pad.dir, kFootprintM);
  const as::Profile p;
  const double mu = orbital::kCinderMu, R = cinder.radiusM;
  const Vec3 up = g.upUnit, east = eastAt(up);

  // A vehicle LOW but with its apoapsis already well past the target: on a
  // 40 km x 3 km ellipse at 3 km. The ascent is over; the engine must be out.
  {
    const double rp = R + 3000.0, ra = R + 40000.0;
    const double a = 0.5 * (rp + ra);
    const double vp = std::sqrt(mu * (2.0 / rp - 1.0 / a));
    const Vec3 pos = up * rp, vel = east * vp;
    const as::Guidance q = as::guide(pos, vel, east, g, east, mu, R, 16.6, 1.0 / 60.0, p);
    std::printf("    [ceiling] apoapsis %.1f m against a %.1f m target -> leg %d, "
                "throttle %.17g\n", q.apoapsisAltM, p.targetApoapsisM,
                static_cast<int>(q.leg), q.throttle);
    CHECK(q.leg != as::Leg::Vertical && q.leg != as::Leg::Turn);
    CHECK(q.throttle == 0.0);        // EXACTLY, and that is the assertion
  }
  // ... and one metre of target the OTHER side of the same bound still climbs.
  {
    as::Profile low = p;
    low.targetApoapsisM = 60000.0;
    const double rp = R + 3000.0, ra = R + 40000.0;
    const double a = 0.5 * (rp + ra);
    const double vp = std::sqrt(mu * (2.0 / rp - 1.0 / a));
    const as::Guidance q = as::guide(up * rp, east * vp, east, g, east, mu, R,
                                     16.6, 1.0 / 60.0, low);
    CHECK(q.leg == as::Leg::Turn);
    CHECK(q.throttle > 0.0);
  }
  // A vehicle ALREADY IN THE ORBIT IT WANTS commands exactly nothing, which is
  // the identity case Admin named: the first thing a player presses is often a
  // programme with nothing to do, and it must not invent work.
  {
    const double r = R + p.targetApoapsisM;
    const Vec3 pos = up * r, vel = east * std::sqrt(mu / r);
    const as::Guidance q = as::guide(pos, vel, east, g, east, mu, R, 16.6,
                                     1.0 / 60.0, p);
    std::printf("    [identity] already circular at the target: leg %d, note "
                "\"%s\", throttle %.17g, e %.3g\n", static_cast<int>(q.leg),
                q.note, q.throttle, q.eccentricity);
    CHECK(q.leg == as::Leg::Orbit);
    CHECK(std::string(q.note) == "in orbit");
    CHECK(q.throttle == 0.0);
  }
  // AND THE SAME VEHICLE ON THE PAD IS NOT IN ORBIT, which is what stops the
  // identity case above from being reachable from a launch clamp: standing
  // still, the arc's periapsis is the body's CENTRE.
  {
    const as::Guidance q = as::guide(up * g.radiusM, Vec3{0, 0, 0}, up, g, east,
                                     mu, R, 16.6, 1.0 / 60.0, p);
    std::printf("    [pad] standing still: leg %d, insertion needs %.4f m/s, "
                "throttle %.6f\n", static_cast<int>(q.leg), q.insertionDvMS,
                q.throttle);
    CHECK(q.leg == as::Leg::Vertical);
    CHECK(q.insertionDvMS > 500.0);       // the whole surface circular speed
    CHECK(q.throttle > 0.0);
  }
}

// =============================================================================
// A VEHICLE THAT CANNOT LIFT OFF IS REFUSED BEFORE IT IS FLOWN, and a coasting
// one is NOT, because those are different questions asked of the same number.
// =============================================================================
TEST(a_vehicle_that_cannot_lift_off_is_refused_and_a_coasting_one_is_not) {
  const worldgen::BodyParams cinder = worldgen::makeCinder(1);
  const Site pad = findFlatPad(cinder);
  const ld::SurfaceFrame g = ld::surfaceFrame(cinder, pad.dir, kFootprintM);
  const as::Profile p;
  const double mu = orbital::kCinderMu, R = cinder.radiusM;
  const Vec3 up = g.upUnit, east = eastAt(up);
  const double gravity = mu / (g.radiusM * g.radiusM);

  const as::Guidance no = as::guide(up * g.radiusM, Vec3{0, 0, 0}, up, g, east,
                                    mu, R, gravity * 0.99, 1.0 / 60.0, p);
  CHECK(no.leg == as::Leg::Aborted);
  CHECK(std::string(no.note) == "aborted: this vehicle cannot lift off here");
  CHECK(no.throttle == 0.0);

  // THE POSITIVE CONTROL, two per cent the other side of the same bound.
  const as::Guidance yes = as::guide(up * g.radiusM, Vec3{0, 0, 0}, up, g, east,
                                     mu, R, gravity * 1.01, 1.0 / 60.0, p);
  CHECK(yes.leg == as::Leg::Vertical);
  CHECK(yes.throttle > 0.0);

  // AND A VEHICLE ALREADY IN ORBIT WITH A DEAD ENGINE IS NOT "UNABLE TO LIFT
  // OFF": it does not need to hold itself up, so the refusal must not fire.
  const double r = R + p.targetApoapsisM;
  const as::Guidance coasting = as::guide(up * r, east * std::sqrt(mu / r), east,
                                          g, east, mu, R, 0.0, 1.0 / 60.0, p);
  CHECK(coasting.leg != as::Leg::Aborted);
  CHECK(coasting.leg == as::Leg::Orbit);
}

// =============================================================================
// THE ACCEPTANCE: off real Cinder, from a flat pad and from the floor of a hole.
// =============================================================================
TEST(it_flies_itself_off_the_moon_from_a_flat_pad_and_from_a_crater_floor) {
  const worldgen::BodyParams cinder = worldgen::makeCinder(1);
  const Site flat = findFlatPad(cinder);
  const Site pit = findPitPad(cinder);
  std::printf("    [sites] flat: slope %.3f deg, terrain %+.1f m, rim ahead "
              "%+.1f m | pit: slope %.3f deg, terrain %+.1f m, rim ahead %+.1f m "
              "(%.1f m ABOVE the pad)\n",
              flat.slopeDeg, flat.terrainM, flat.rimAheadM,
              pit.slopeDeg, pit.terrainM, pit.rimAheadM,
              pit.rimAheadM - pit.terrainM);
  // THE FIXTURE CAN EXHIBIT THE DEFECT. If the "pit" is not actually a hole,
  // the terrain clamp below has nothing to bite on and its test is vacuous.
  CHECK(pit.rimAheadM - pit.terrainM > 1000.0);
  CHECK(flat.rimAheadM - flat.terrainM < pit.rimAheadM - pit.terrainM);

  const as::Profile prof;
  const Flown a = fly(flat, prof, 12000.0);
  std::printf("    [flat ] %s in %.1f s: %.1f x %.1f km, e %.6f, dv %.4f m/s, "
              "%.1f kg, cutoff at %.0f m / %.1f s, legs V%d T%d C%d I%d, "
              "clamp %d, worst burning attitude %.2f deg, min AGL %.1f m "
              "(datum %.0f over terrain %.0f at t=%.0f)\n",
              verdict(a), a.flownS, a.apoAltM / 1000.0, a.periAltM / 1000.0,
              a.eccentricity, a.dvMS, a.propKg, a.cutoffAltM, a.cutoffS,
              a.leg[0], a.leg[1], a.leg[2], a.leg[3], a.clampTicks,
              a.worstPointDeg, a.minAglM, a.minAglAtDatumM, a.minAglAtGroundM,
              a.minAglAtS);
  CHECK(a.orbit);
  CHECK(!a.aborted && !a.ranOut);
  CHECK(a.eccentricity <= prof.targetEccentricity);
  CHECK(a.periAltM > 0.9 * prof.targetApoapsisM - prof.apoapsisBandM);
  CHECK(a.apoAltM <= prof.targetApoapsisM + 500.0);
  // EVERY LEG WAS VISITED. Without this, a flight that skipped the coast (or
  // never turned) reads exactly like one that flew the whole profile.
  CHECK(a.leg[0] > 0 && a.leg[1] > 0 && a.leg[2] > 0 && a.leg[3] > 0);
  // ... and once the orbit was bought it never went back to buying it, which is
  // what the apoapsis band exists to prevent.
  CHECK(a.resumedAscent == 0);

  const Flown b = fly(pit, prof, 12000.0);
  std::printf("    [pit  ] %s in %.1f s: %.1f x %.1f km, e %.6f, dv %.4f m/s, "
              "%.1f kg, clamp %d ticks (flat pad %d), min AGL %.1f m "
              "(datum %.0f over terrain %.0f at t=%.0f)\n",
              verdict(b), b.flownS, b.apoAltM / 1000.0, b.periAltM / 1000.0,
              b.eccentricity, b.dvMS, b.propKg, b.clampTicks, a.clampTicks,
              b.minAglM, b.minAglAtDatumM, b.minAglAtGroundM, b.minAglAtS);
  CHECK(b.orbit);
  CHECK(b.eccentricity <= prof.targetEccentricity);
  CHECK(b.resumedAscent == 0);
  // Launching from 2 km down a hole is not free, and the cost is stated rather
  // than swept up: the whole depth has to be climbed before the orbit starts.
  CHECK(b.dvMS > a.dvMS);
}

// -----------------------------------------------------------------------------
// THE CLEARANCE CLAMP, AND THE HONEST ANSWER ABOUT IT: IT IS REACHABLE, IT
// COSTS 41.6 m/s, AND ITS BENEFIT COULD NOT BE DEMONSTRATED ON THIS BODY.
//
// The first version of this test asserted "the pit clamps more than the plain",
// which was BACKWARDS: the pit pad sits 2.1 km below the datum, the pitch
// schedule is drawn against DATUM-relative apoapsis, so down a hole the
// schedule is still asking for nearly nothing and there is nothing to clamp.
// Measured, 29 clamped ticks off the pit against 3026 off the plain.
//
// The second version asserted "removing it flies lower over the ground", and
// it passed on a difference of one ten-thousandth of a metre. A control that
// passes on noise is worse than one that fails, so it is not asserted here.
//
// WHAT IS TRUE AND MEASURED IS ASSERTED; WHAT IS NOT, IS PRINTED AND SAID OUT
// LOUD. The clamp fires thousands of times on a real launch, it costs real
// propellant, and on both pads this file searches for, Cinder's terrain is too
// gentle relative to the vehicle's climb for its absence to change where the
// rocket goes. It is kept as a guard against a pad geometry this body's
// generator did not produce, and R84 carries that to whoever owns the next moon.
// -----------------------------------------------------------------------------
TEST(the_clearance_clamp_is_reachable_and_its_cost_is_stated) {
  const worldgen::BodyParams cinder = worldgen::makeCinder(1);
  const Site flat = findFlatPad(cinder);
  as::Profile with;
  as::Profile without;
  without.clearanceM = 0.0;
  without.clearedAtM = 0.0;
  const Flown y = fly(flat, with, 12000.0);
  const Flown n = fly(flat, without, 12000.0);
  std::printf("    [clamp] with: %d clamped ticks, min clear AGL %.1f m, "
              "dv %.4f | without: %d clamped ticks, min clear AGL %.1f m, "
              "dv %.4f, %s. The clamp COSTS %.4f m/s and BUYS %.4f m of "
              "clearance, which is nothing.\n",
              y.clampTicks, y.minAglClearM, y.dvMS,
              n.clampTicks, n.minAglClearM, n.dvMS, verdict(n),
              y.dvMS - n.dvMS, y.minAglClearM - n.minAglClearM);
  // IT IS REACHABLE: it fired on a real launch, so it is not dead code.
  CHECK(y.clampTicks > 1000);
  // AND IT IS THE THING THAT MAKES THE DIFFERENCE: with it removed, nothing
  // clamps, which is what says the counter is counting the clamp.
  CHECK(n.clampTicks == 0);
  // IT COSTS. This is the number a later lane should weigh, and it is asserted
  // as a real cost rather than mentioned.
  CHECK(y.dvMS - n.dvMS > 20.0);
  // AND REMOVING IT DOES NOT BREAK THE FLIGHT, which is why the value is
  // unproven rather than negative.
  CHECK(n.orbit);
}

// -----------------------------------------------------------------------------
// THE NEGATIVE CONTROL: the same launch with the guidance removed. If a rocket
// pointed straight up reaches orbit anyway, the acceptance measured a low moon
// and not a program.
// -----------------------------------------------------------------------------
TEST(without_the_turn_the_same_rocket_does_not_reach_orbit) {
  const worldgen::BodyParams cinder = worldgen::makeCinder(1);
  const Site flat = findFlatPad(cinder);
  FlightSim sim;
  sim.craft = lander();
  sim.env = cinderEnv();
  const ld::SurfaceFrame g0 = ld::surfaceFrame(cinder, flat.dir, kFootprintM);
  const Vec3 up0 = g0.upUnit;
  sim.state.posM = up0 * (g0.radiusM + 1.0);
  sim.state.forward = up0;
  sim.state.right = eastAt(up0);
  sim.sas = SasMode::Command;
  sim.sasCommand = up0;

  const double dt = 1.0 / 60.0;
  double best = -1e300;
  bool bound = false;
  for (int i = 0; i < 60 * 3000; ++i) {
    sim.sasCommand = orbital::normalized(sim.state.posM);   // THE ONE DIFFERENCE
    sim.state.throttle = 1.0;
    sim.step(dt);
    const OrbitSummary os = summarize(orbital::StateVector{sim.state.posM,
                                                           sim.state.velMS},
                                      sim.env.muM3S2, cinder.radiusM);
    if (os.bound && os.periapsisAltM > 0.0) { bound = true; break; }
    if (os.periapsisAltM > best) best = os.periapsisAltM;
    if (sim.state.posM.length() < cinder.radiusM) break;     // came back down
  }
  std::printf("    [control] straight up at full throttle: best periapsis "
              "%.1f m, in orbit %d\n", best, static_cast<int>(bound));
  CHECK(!bound);
  CHECK(best < 0.0);     // a radial climb has its periapsis inside the body
}

// -----------------------------------------------------------------------------
// THE APOAPSIS BAND, AND ITS OWN NEGATIVE CONTROL. With the band at zero the
// cutoff straddles its own threshold and the program hunts; that is a REACHABLE
// refusing case in the same loop rather than a paragraph in a comment.
// -----------------------------------------------------------------------------
TEST(with_no_band_on_the_cutoff_the_program_hunts_between_two_legs) {
  const worldgen::BodyParams cinder = worldgen::makeCinder(1);
  const Site flat = findFlatPad(cinder);
  as::Profile bare;
  bare.apoapsisBandM = 0.0;
  const Flown n = fly(flat, bare, 12000.0);
  const as::Profile good;
  const Flown y = fly(flat, good, 12000.0);
  std::printf("    [band] 0 m: %d returns to the ascent legs, worst burning "
              "attitude %.2f deg, dv %.4f | %.0f m: %d returns, %.2f deg, "
              "dv %.4f\n",
              n.resumedAscent, n.worstPointDeg, n.dvMS,
              good.apoapsisBandM, y.resumedAscent, y.worstPointDeg, y.dvMS);
  CHECK(n.resumedAscent > 0);      // the defect is REACHABLE
  CHECK(y.resumedAscent == 0);     // ... and the band is what closes it
}

// -----------------------------------------------------------------------------
// THE INSTRUMENT'S OWN CONTROL: sampling the terrain once a second above the
// clearance ceiling changes NOTHING, because up there nothing reads it. Flown
// both ways and compared, rather than argued from the source.
// -----------------------------------------------------------------------------
TEST(the_cheap_terrain_schedule_changes_nothing_it_is_allowed_to_change) {
  const worldgen::BodyParams cinder = worldgen::makeCinder(1);
  const Site flat = findFlatPad(cinder);
  const as::Profile p;
  const Flown cheap = fly(flat, p, 12000.0, true);
  const Flown full = fly(flat, p, 12000.0, false);
  std::printf("    [terrain] every tick: %.1f x %.1f km, dv %.6f | cheap above "
              "10 km: %.1f x %.1f km, dv %.6f | difference %.3g m/s\n",
              full.apoAltM / 1000.0, full.periAltM / 1000.0, full.dvMS,
              cheap.apoAltM / 1000.0, cheap.periAltM / 1000.0, cheap.dvMS,
              std::fabs(full.dvMS - cheap.dvMS));
  CHECK(full.orbit && cheap.orbit);
  CHECK(full.dvMS == cheap.dvMS);
  CHECK(full.apoAltM == cheap.apoAltM);
  CHECK(full.periAltM == cheap.periAltM);
}

// =============================================================================
// R63: THE CALIBRATION, AND IT IS FLOWN RATHER THAN ASSERTED.
//
// `transfer::ascentDvMS` refused every body but Forge because nobody had flown
// one. This is the flight. The constant it publishes is a LITERAL in
// transfer.h, typed from the number this suite prints; this test re-flies and
// checks the two agree, so a change to either one goes red. It is deliberately
// NOT `a == f(a)`: the flight does not read the constant and the constant does
// not read the flight.
// =============================================================================
TEST(the_cinder_ascent_calibration_agrees_with_a_flown_ascent) {
  const worldgen::BodyParams cinder = worldgen::makeCinder(1);
  const Site flat = findFlatPad(cinder);
  const as::Profile prof;
  const Flown a = fly(flat, prof, 12000.0);
  CHECK(a.orbit);

  const double R = orbital::kCinderRadiusM, mu = orbital::kCinderMu;
  const double rPark = R + prof.targetApoapsisM;
  const double vPark = std::sqrt(mu / rPark);
  const double vSurf = std::sqrt(mu / R);
  const double measured = (a.dvMS - vPark) / vSurf;
  // The two-impulse Hohmann from the surface: the floor NO ascent can beat, and
  // the reason the published fraction is not "a few percent".
  const double ideal = std::sqrt(mu * (2.0 / R - 2.0 / (R + rPark)))
      + (vPark - std::sqrt(mu * (2.0 / rPark - 2.0 / (R + rPark))));
  std::printf("    [R63] flown %.4f m/s to a %.1f x %.1f km orbit. vPark "
              "%.4f, vSurf %.4f -> loss fraction %.6f. The impulsive ideal is "
              "%.4f m/s, which is ALREADY %.6f of vSurf, so %.6f of the "
              "fraction is guidance and the rest is arithmetic.\n",
              a.dvMS, a.apoAltM / 1000.0, a.periAltM / 1000.0, vPark, vSurf,
              measured, ideal, (ideal - vPark) / vSurf,
              (a.dvMS - ideal) / vSurf);

  const transfer::AscentCost c = transfer::ascentDvMS(mu, R, rPark, false);
  std::printf("    [R63] ascentDvMS: calibrated=%d, %.6f m/s against the flown "
              "%.6f m/s, %.4f m/s apart\n", static_cast<int>(c.calibrated),
              c.deltaVMS, a.dvMS, std::fabs(c.deltaVMS - a.dvMS));
  CHECK(c.calibrated);
  CHECK(std::fabs(c.deltaVMS - a.dvMS) < 0.05);

  // AND THE REFUSAL STILL STANDS FOR A BODY NOBODY HAS FLOWN. Forge and Cinder
  // are the two that have been; a third gets nothing, which is R63's own rule
  // and it survives R63 being closed.
  const transfer::AscentCost none =
      transfer::ascentDvMS(4.9028e12, 1.737e6, 1.737e6 + 20000.0, false);
  CHECK(!none.calibrated);
  CHECK(none.deltaVMS == 0.0);

  // Forge's own number has NOT moved, which is what says this change added a
  // body rather than edited one. 3724.649392 is PH-147's published figure.
  const transfer::AscentCost forge =
      transfer::ascentDvMS(orbital::kForgeMu, orbital::kForgeRadiusM,
                           680000.0, true);
  std::printf("    [R63] Forge, untouched: %.6f m/s\n", forge.deltaVMS);
  CHECK(forge.calibrated);
  CHECK_NEAR(forge.deltaVMS, 3724.649392, 1e-5);
}
