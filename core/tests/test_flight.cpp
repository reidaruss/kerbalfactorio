// =============================================================================
// test_flight.cpp - the atmosphere, flight forces, the DW-30 anti-flip model,
// stability assist, a full ascent to orbit, and the handoff to of::orbital.
//
// The acceptance test in this file is `a_reference_rocket_reaches_a_stable_orbit`:
// it integrates the hand-checked reference vehicle from the pad to a circular
// orbit and asserts the orbit it got. Everything above it is the isolation
// (standing rule 7) that says WHICH part is responsible when it stops working.
// =============================================================================
#include <cmath>
#include <cstdio>

#include "of/cubed_sphere.h"
#include "of/flight.h"
#include "of/orbital.h"
#include "of/vessel.h"
#include "test_framework.h"

using namespace of;
using namespace of::vessel;
using namespace of::flight;

static const double kDeg = 180.0 / orbital::kPi;

// The same reference vehicle test_vessel.cpp pins: 9845 kg on the pad,
// 4922.91 m/s of vacuum delta-v, pad TWR 1.6567.
struct Ascender {
  Vessel v;
  PartHandle pod, chute, tankUp, engUp, dec, tankLo, engLo;
};

static Ascender makeAscender(bool withFins) {
  Ascender a;
  Vessel& v = a.v;
  a.pod = v.addRoot(parts::CommandPod);
  a.chute = v.attach(a.pod, parts::Parachute, Attach::StackBottom);
  a.tankUp = v.attach(a.chute, parts::TankLiquidSmall, Attach::StackBottom);
  a.engUp = v.attach(a.tankUp, parts::EngineVacuumSmall, Attach::StackBottom);
  a.dec = v.attach(a.engUp, parts::DecouplerStackSmall, Attach::StackBottom);
  a.tankLo = v.attach(a.dec, parts::TankLiquidSmallLong, Attach::StackBottom);
  a.engLo = v.attach(a.tankLo, parts::EngineLiquidSmall, Attach::StackBottom);
  if (withFins)
    for (int i = 0; i < 4; ++i)
      v.attach(a.tankLo, parts::Fin, Attach::Radial, i * 0.5 * orbital::kPi, 0.15);
  v.assignSubtreeToStage(a.dec, 0);
  Stage s0; s0.activate.push_back(a.engLo);
  Stage s1; s1.activate.push_back(a.engUp); s1.decouple.push_back(a.dec);
  v.stages.push_back(s0);
  v.stages.push_back(s1);
  v.layout();
  return a;
}

static FlightEnvironment forgeEnv() {
  const worldgen::BodyParams b = worldgen::makeForge(1);
  FlightEnvironment e;
  e.muM3S2 = b.muM3S2;          // DW-18: the ONE gravity authority
  e.bodyRadiusM = b.radiusM;
  e.air = atmo::makeForgeAtmosphere();
  return e;
}

// =============================================================================
// THE ATMOSPHERE (PH-10, PH-11).
// =============================================================================
TEST(density_falls_off_exponentially_with_altitude) {
  const atmo::AtmosphereProfile air = atmo::makeForgeAtmosphere();
  CHECK(air.present());
  CHECK_NEAR(air.seaLevelDensityKgM3, 1.225, 1e-12);
  CHECK_NEAR(air.scaleHeightM, 5600.0, 1e-12);   // D-006, and the same 5.6 km
  CHECK_NEAR(air.topM, 60000.0, 1e-12);          // the rendering lane already uses

  // The pure exponential, rho = 1.225 * exp(-h / 5600), stated as numbers.
  CHECK_NEAR(atmo::densityRaw(air, 0.0),      1.225,        1e-12);
  CHECK_NEAR(atmo::densityRaw(air, 5600.0),   0.45065232,   1e-8);   // one scale height, 1/e
  CHECK_NEAR(atmo::densityRaw(air, 10000.0),  0.20540463,   1e-8);
  CHECK_NEAR(atmo::densityRaw(air, 20000.0),  0.03444168,   1e-8);
  CHECK_NEAR(atmo::densityRaw(air, 30000.0),  0.00577509,   1e-8);
  CHECK_NEAR(atmo::densityRaw(air, 50000.0),  1.6237037e-4, 1e-11);
  CHECK_NEAR(atmo::densityRaw(air, 60000.0),  2.7225817e-5, 1e-12);
  // One scale height is a factor of e, everywhere, which is the definition.
  for (double h = 0.0; h < 40000.0; h += 3000.0)
    CHECK_NEAR(atmo::densityRaw(air, h) / atmo::densityRaw(air, h + 5600.0),
               std::exp(1.0), 1e-9);

  // Below the datum it clamps rather than growing without bound: a vessel in a
  // dug trench must not meet treacle.
  CHECK_NEAR(atmo::densityRaw(air, -500.0), 1.225, 1e-12);

  // Cinder is airless (D-006). Every query is exactly zero and `present()`
  // is false, so a caller can branch once instead of per sample.
  const atmo::AtmosphereProfile none = atmo::makeCinderAtmosphere();
  CHECK(!none.present());
  CHECK(atmo::density(none, 0.0) == 0.0);
  CHECK(atmo::density(none, 100000.0) == 0.0);
  CHECK(atmo::inSpace(none, 0.0));
  CHECK(atmo::atmosphereForBody(0).present());
  CHECK(!atmo::atmosphereForBody(1).present());
}

TEST(the_atmosphere_fades_to_exactly_zero_at_its_ceiling) {
  const atmo::AtmosphereProfile air = atmo::makeForgeAtmosphere();

  // Below the fade start the shipped density IS the raw exponential, to the
  // bit. All of an ascent's drag integral lives here.
  for (double h = 0.0; h <= 50000.0; h += 500.0)
    CHECK(atmo::density(air, h) == atmo::densityRaw(air, h));

  // Above the ceiling it is exactly 0.0, which is what makes "am I on rails" a
  // boolean rather than a threshold.
  CHECK(atmo::density(air, 60000.0) == 0.0);
  CHECK(atmo::density(air, 60000.1) == 0.0);
  CHECK(atmo::density(air, 200000.0) == 0.0);
  CHECK(atmo::inSpace(air, 60000.0));
  CHECK(!atmo::inSpace(air, 59999.0));

  // And in between it is continuous: no step anywhere, and in particular none
  // at the ceiling, where the raw exponential would have dropped 2.723e-5
  // kg/m^3 in a single metre. On a 2 t vessel at orbital speed that step is
  // 0.072 m/s^2, i.e. the difference between an orbit that decays and one that
  // does not, decided by which side of a line you circularised on.
  double prev = atmo::density(air, 49000.0);
  double worstStep = 0.0;
  for (double h = 49000.0; h <= 61000.0; h += 1.0) {
    const double d = atmo::density(air, h);
    worstStep = std::fmax(worstStep, std::fabs(d - prev));
    prev = d;
  }
  CHECK(worstStep < 1.0e-7);   // measured 3.7e-8 kg/m^3 per metre
  // Monotone decreasing throughout, so the fade never makes the air thicken.
  for (double h = 0.0; h < 60000.0; h += 250.0)
    CHECK(atmo::density(air, h) >= atmo::density(air, h + 250.0));

  // Pressure shares the exponential with density (isothermal), so one curve
  // serves the wing and the engine bell and they cannot drift apart.
  CHECK_NEAR(atmo::pressureRatio(air, 0.0), 1.0, 1e-12);
  CHECK(atmo::pressureRatio(air, 60000.0) == 0.0);
  for (double h = 0.0; h < 60000.0; h += 1000.0)
    CHECK_NEAR(atmo::pressureRatio(air, h),
               atmo::density(air, h) / 1.225, 1e-15);
}

// =============================================================================
TEST(thrust_and_isp_rise_as_the_air_thins) {
  const atmo::AtmosphereProfile air = atmo::makeForgeAtmosphere();
  const PartDef& e = *catalogue().get(parts::EngineLiquidSmall);

  // On the pad: exactly the authored sea-level figures.
  CHECK_NEAR(atmo::lapse(e.thrustSeaLevelN, e.thrustVacuumN,
                         atmo::pressureRatio(air, 0.0)), 160000.0, 1e-6);
  CHECK_NEAR(atmo::lapse(e.ispSeaLevelS, e.ispVacuumS,
                         atmo::pressureRatio(air, 0.0)), 264.0, 1e-9);

  // In space: exactly the vacuum figures, because the pressure ratio is
  // exactly zero rather than nearly zero.
  CHECK(atmo::lapse(e.thrustSeaLevelN, e.thrustVacuumN,
                    atmo::pressureRatio(air, 60000.0)) == 200000.0);
  CHECK(atmo::lapse(e.ispSeaLevelS, e.ispVacuumS,
                    atmo::pressureRatio(air, 60000.0)) == 330.0);

  // At one scale height the air is down to 1/e, so 63.2% of the way to vacuum.
  const double pr = atmo::pressureRatio(air, 5600.0);
  CHECK_NEAR(pr, 1.0 / std::exp(1.0), 1e-9);
  CHECK_NEAR(atmo::lapse(160000.0, 200000.0, pr), 185285.4, 1.0);
  // At 20 km the engine is within 3% of its vacuum thrust.
  CHECK(atmo::lapse(160000.0, 200000.0, atmo::pressureRatio(air, 20000.0)) > 194000.0);

  // Mass flow does not move, at any altitude, by more than a rounding error.
  // That is the invariant the catalogue is authored to satisfy, and it is what
  // makes a stage's burn time a property of the stage rather than of the sky.
  for (double h = 0.0; h <= 70000.0; h += 250.0) {
    const double p = atmo::pressureRatio(air, h);
    const double T = atmo::lapse(e.thrustSeaLevelN, e.thrustVacuumN, p);
    const double I = atmo::lapse(e.ispSeaLevelS, e.ispVacuumS, p);
    CHECK_NEAR(T / (I * atmo::kG0), 61.8010, 1e-4);
  }
}

// =============================================================================
TEST(drag_scales_with_density_and_speed_squared) {
  Ascender a = makeAscender(true);
  a.v.layout();
  const MassProperties mp = massProperties(a.v);
  const FlightEnvironment env = forgeEnv();

  // The reference vehicle's axial Cd*A. Parts in a stack shade one another, so
  // this is nose pressure drag plus skin friction plus the unshaded fins, NOT a
  // sum over parts (which gave 3.274 m^2, an effective Cd of 2.67 for a rocket).
  //   nose  0.55 * pi*0.625^2                       = 0.674884
  //   skin  0.004 * pi * 15.125 m^2 of side profile = 0.190066
  //   fins  4 * 0.05 * 0.11                         = 0.022
  CHECK_NEAR(mp.axialCdA, 0.8870179, 1e-6);
  CHECK_NEAR(mp.axialCdA / (orbital::kPi * 0.625 * 0.625), 0.7228, 1e-3);

  // Zero angle of attack: drag is purely axial and opposes the airflow.
  FlightState s;
  s.posM = Vec3{env.bodyRadiusM + 8000.0, 0, 0};
  s.velMS = Vec3{300.0, 0, 0};
  s.forward = Vec3{1, 0, 0};
  s.right = Vec3{0, 1, 0};
  AeroTuning tune;

  const AeroForces f1 = aerodynamics(a.v, mp, s, env, tune);
  const double rho8k = 1.225 * std::exp(-8000.0 / 5600.0);
  CHECK_NEAR(f1.densityKgM3, rho8k, 1e-12);
  CHECK_NEAR(f1.densityKgM3, 0.2935725, 1e-6);
  CHECK_NEAR(f1.dynamicPressurePa, 0.5 * rho8k * 300.0 * 300.0, 1e-9);
  CHECK_NEAR(f1.dynamicPressurePa, 13210.8, 0.2);
  CHECK_NEAR(f1.angleOfAttackRad, 0.0, 1e-12);
  // F = q * Cd*A, straight back along the flow.
  CHECK_NEAR(f1.forceN.length(), f1.dynamicPressurePa * mp.axialCdA, 1e-6);
  CHECK_NEAR(f1.forceN.length(), 11718.2, 0.5);
  CHECK(f1.forceN.x < 0.0);
  CHECK_NEAR(f1.forceN.y, 0.0, 1e-12);
  CHECK_NEAR(f1.forceN.z, 0.0, 1e-12);

  // Double the speed, quadruple the drag.
  s.velMS = Vec3{600.0, 0, 0};
  const AeroForces f2 = aerodynamics(a.v, mp, s, env, tune);
  CHECK_NEAR(f2.forceN.length() / f1.forceN.length(), 4.0, 1e-9);

  // One scale height higher, e times less of it.
  s.velMS = Vec3{300.0, 0, 0};
  s.posM = Vec3{env.bodyRadiusM + 13600.0, 0, 0};
  const AeroForces f3 = aerodynamics(a.v, mp, s, env, tune);
  CHECK_NEAR(f1.forceN.length() / f3.forceN.length(), std::exp(1.0), 1e-9);

  // In space there is no drag at all, exactly.
  s.posM = Vec3{env.bodyRadiusM + 80000.0, 0, 0};
  const AeroForces f4 = aerodynamics(a.v, mp, s, env, tune);
  CHECK(f4.forceN.x == 0.0 && f4.forceN.y == 0.0 && f4.forceN.z == 0.0);
  CHECK(f4.torqueNm.x == 0.0 && f4.torqueNm.y == 0.0 && f4.torqueNm.z == 0.0);

  // Broadside, the vehicle presents its whole flank: 21.174 m^2 of Cd*A against
  // 0.887 nose-on, so flying sideways is 24 times the drag. That penalty is
  // what still teaches a player not to, with the flip removed.
  s.posM = Vec3{env.bodyRadiusM + 8000.0, 0, 0};
  s.forward = Vec3{0, 0, 1};
  s.right = Vec3{0, 1, 0};
  const AeroForces f5 = aerodynamics(a.v, mp, s, env, tune);
  CHECK_NEAR(f5.angleOfAttackRad * kDeg, 90.0, 1e-9);
  CHECK_NEAR(f5.forceN.length() / f1.forceN.length(), mp.normalCdA / mp.axialCdA, 1e-9);
  CHECK_NEAR(f5.forceN.length() / f1.forceN.length(), 23.87, 0.01);
}

// =============================================================================
// DW-30 item 1: AERODYNAMIC FLIP IS DAMPED OUT.
//
// A wind tunnel, deliberately: position and velocity are held fixed and only
// the rotation is integrated, so the angle of attack that comes out is the
// aerodynamic moment's doing and nothing else's. Three vehicles, one of which
// is the negative control that tumbles.
// =============================================================================
struct TunnelResult {
  double maxAoADeg = 0.0;
  double finalAoADeg = 0.0;
  double aoaFiveSecondsEarlierDeg = 0.0;
  double finalRateDegS = 0.0;
  double timeToNinetyDegS = -1.0;   // -1 means it never got there
};

static TunnelResult windTunnel(Vessel& v, double gain, double initialAoARad,
                               double initialRateRadS, double durationS) {
  v.layout();
  const FlightEnvironment env = forgeEnv();
  AeroTuning tune;
  tune.unstableAeroGain = gain;

  FlightState s;
  s.posM = Vec3{env.bodyRadiusM + 8000.0, 0, 0};
  s.velMS = Vec3{500.0, 0, 0};                 // climbing at 500 m/s
  s.right = Vec3{0, 1, 0};
  // Tilt the nose off the airflow by the initial angle of attack.
  s.forward = normalized(Vec3{std::cos(initialAoARad), 0.0, std::sin(initialAoARad)});
  s.angVelRadS = Vec3{0, initialRateRadS, 0};  // pitch rate about +Y

  const double dt = 0.01;
  TunnelResult r;
  const MassProperties mp0 = massProperties(v);
  const double Itrans = std::fmax(mp0.IxxKgM2, mp0.IzzKgM2);
  for (int i = 0; i * dt < durationS; ++i) {
    const MassProperties mp = massProperties(v);
    const AeroForces af = aerodynamics(v, mp, s, env, tune);
    const Vec3 f = normalized(s.forward);
    const Vec3 tRoll = f * af.torqueNm.dot(f);
    const Vec3 tPerp = af.torqueNm - tRoll;
    s.angVelRadS = s.angVelRadS + tPerp * (dt / Itrans);
    const double w = s.angVelRadS.length();
    if (w > 1e-14) {
      const Vec3 k = s.angVelRadS * (1.0 / w);
      s.forward = normalized(rotateAbout(s.forward, k, w * dt));
      s.right = normalized(rotateAbout(s.right, k, w * dt));
    }
    const double aoa = af.angleOfAttackRad * kDeg;
    if (aoa > r.maxAoADeg) r.maxAoADeg = aoa;
    if (r.timeToNinetyDegS < 0.0 && aoa >= 90.0) r.timeToNinetyDegS = i * dt;
    if (i * dt <= durationS - 5.0) r.aoaFiveSecondsEarlierDeg = aoa;
    r.finalAoADeg = aoa;
    r.finalRateDegS = s.angVelRadS.length() * kDeg;
  }
  return r;
}

TEST(a_rocket_at_a_modest_angle_of_attack_does_not_tumble) {
  const double aoa0 = 10.0 / kDeg;

  // ---- NEGATIVE CONTROL: the real, unforgiving physics -------------------
  // Unstable airframe (no fins, static margin +3.188 m), gain 1.0. This is what
  // KSP does to a beginner, and it is what the shipped model must not.
  Vessel bare1 = makeAscender(false).v;
  const TunnelResult real = windTunnel(bare1, 1.0, aoa0, 0.0, 30.0);
  CHECK(real.timeToNinetyDegS > 0.0);
  CHECK(real.timeToNinetyDegS < 5.0);     // measured 2.7 s
  CHECK(real.maxAoADeg > 90.0);

  // ---- SHIPPED: the same airframe with the DW-30 concession --------------
  // Destabilising pitching moment removed; rate damping still real. A 5.7 deg/s
  // gust plus 10 degrees of initial angle of attack must settle, not diverge.
  // The rate is negative because the tunnel rotates about +Y while the vehicle
  // is pitched into +Z: a positive rate would push the nose back TOWARDS the
  // airflow, which is the easy direction and would prove nothing.
  Vessel bare2 = makeAscender(false).v;
  const TunnelResult damped = windTunnel(bare2, 0.0, aoa0, -0.1, 60.0);
  CHECK(damped.timeToNinetyDegS < 0.0);   // never tumbled
  CHECK(damped.maxAoADeg < 30.0);
  // The gust is damped out: the residual rate is a small fraction of the 5.73
  // deg/s it started with.
  CHECK(damped.finalRateDegS < 0.1);
  // and the attitude has stopped moving: the last five seconds of a sixty
  // second run moved the angle of attack by less than a tenth of a degree.
  CHECK(std::fabs(damped.finalAoADeg - damped.aoaFiveSecondsEarlierDeg) < 0.1);

  std::printf(
      "    anti-flip, 10 deg AoA at 36.7 kPa, unstable airframe (margin +3.188 m):\n"
      "      gain 1.0 (real physics)  max AoA %6.1f deg, past 90 deg at %.2f s\n"
      "      gain 0.0 (shipped)       max AoA %6.2f deg, never tumbled, settles "
      "at %.2f deg with %.4f deg/s left\n",
      real.maxAoADeg, real.timeToNinetyDegS, damped.maxAoADeg,
      damped.finalAoADeg, damped.finalRateDegS);

  // ---- FINS STILL DO REAL WORK ------------------------------------------
  // A finned airframe is on the RESTORING branch, which the concession does not
  // touch at all, so it weathercocks: the angle of attack actively falls back
  // toward the airflow. If the concession had been implemented as a blanket
  // scale on aerodynamic torque, this assertion would fail and building a good
  // rocket would have stopped meaning anything.
  Vessel finned = makeAscender(true).v;
  const TunnelResult weathercock = windTunnel(finned, 0.0, aoa0, 0.0, 30.0);
  CHECK(weathercock.timeToNinetyDegS < 0.0);
  CHECK(weathercock.finalAoADeg < 1.0);              // measured 0.06 deg
  CHECK(weathercock.finalAoADeg < 0.5 * 10.0);
  CHECK(weathercock.maxAoADeg < 12.0);               // one small overshoot only

  std::printf(
      "      gain 0.0, FINNED         max AoA %6.2f deg, weathercocks to %.2f deg\n",
      weathercock.maxAoADeg, weathercock.finalAoADeg);

  // The mechanism, asserted directly rather than inferred: the sign of the
  // static margin is what decides which branch a vehicle is on.
  Vessel b3 = makeAscender(false).v; b3.layout();
  Vessel f3 = makeAscender(true).v;  f3.layout();
  CHECK(staticMarginM(massProperties(b3)) > 0.0);
  CHECK(staticMarginM(massProperties(f3)) < 0.0);

  // And the concession is CONTINUOUS: the moment is proportional to the static
  // margin, so it is exactly zero where the gain switches, and a step gain
  // applied to it introduces no step in the torque. Sweep the fins from the
  // bottom of the lower tank to the top of it, which walks the centre of
  // pressure forward straight through the centre of mass, and watch for a jump.
  const FlightEnvironment env = forgeEnv();
  AeroTuning tune;
  FlightState s;
  s.posM = Vec3{env.bodyRadiusM + 8000.0, 0, 0};
  s.velMS = Vec3{500.0, 0, 0};
  s.right = Vec3{0, 1, 0};
  s.forward = normalized(Vec3{std::cos(aoa0), 0.0, std::sin(aoa0)});
  Vessel sweep = makeAscender(true).v;
  double prevTau = 0.0, prevMargin = 0.0, worstJump = 0.0, tauAtCrossing = 1e300;
  bool first = true, crossed = false;
  const int kSteps = 400;
  for (int i = 0; i <= kSteps; ++i) {
    const double offset = 0.15 + (3.70 * i) / kSteps;   // 0.15 m up to 3.85 m
    for (auto& p : sweep.parts)
      if (sweep.def(p).id == parts::Fin) p.radialOffsetM = offset;
    sweep.layout();
    const MassProperties mp = massProperties(sweep);
    const AeroForces af = aerodynamics(sweep, mp, s, env, tune);
    const double tau = af.torqueNm.length();
    const double margin = staticMarginM(mp);
    if (!first) {
      worstJump = std::fmax(worstJump, std::fabs(tau - prevTau));
      if (margin * prevMargin < 0.0) {
        crossed = true;
        tauAtCrossing = std::fmax(std::fabs(tau), std::fabs(prevTau));
      }
    }
    prevTau = tau; prevMargin = margin; first = false;
  }
  CHECK(crossed);                    // the sweep really did pass through zero
  CHECK(tauAtCrossing < 6000.0);     // the torque there is near zero from both
                                     // sides, which is what makes the switch
                                     // invisible
  CHECK(worstJump < 6000.0);         // and no step appeared anywhere in it
}

// =============================================================================
// DW-30 item 2: stability assist is on by default, and it is NOT free.
// =============================================================================
TEST(stability_assist_is_limited_by_the_parts_actually_bolted_on) {
  const FlightEnvironment env = forgeEnv();

  // ---- a vessel with NO control parts at all -----------------------------
  // A bare tank and engine: no pod, no reaction wheel, no RCS. With the throttle
  // shut there is not even a gimbal. It must be unable to stop a spin, because
  // "stability assist is on by default" must not quietly mean "attitude is free".
  {
    Vessel v;
    const PartHandle t = v.addRoot(parts::TankLiquidSmallLong);
    const PartHandle e = v.attach(t, parts::EngineLiquidSmall, Attach::StackBottom);
    Stage s0; s0.activate.push_back(e);
    v.stages.push_back(s0);
    v.layout();
    const MassProperties mp = massProperties(v);
    const ControlAuthority ca = controlAuthority(v, mp, 0.0, 0.0);
    CHECK(ca.reactionNm == 0.0);
    CHECK(ca.rcsNm == 0.0);
    CHECK(ca.gimbalNm == 0.0);
    CHECK(ca.totalNm() == 0.0);

    FlightSim sim;
    sim.craft = v;
    sim.env = env;
    sim.state.posM = Vec3{env.bodyRadiusM + 200000.0, 0, 0};
    sim.state.velMS = Vec3{0, 2000.0, 0};
    sim.state.forward = Vec3{1, 0, 0};
    sim.state.right = Vec3{0, 1, 0};
    sim.state.angVelRadS = Vec3{0, 0.2, 0};
    sim.state.throttle = 0.0;
    sim.sas = SasMode::Hold;
    sim.captureHold();
    for (int i = 0; i < 6000; ++i) sim.step(0.01);   // 60 seconds
    // The spin is untouched: no air up here, no torque aboard.
    CHECK_NEAR(sim.state.angVelRadS.length(), 0.2, 1e-9);
    CHECK(sim.telemetry.sasSaturated);
  }

  // ---- the reference vehicle, coasting in vacuum on its pod alone --------
  {
    Ascender a = makeAscender(true);
    a.v.layout();
    const MassProperties mp = massProperties(a.v);
    const ControlAuthority ca = controlAuthority(a.v, mp, 0.0, 0.0);
    CHECK_NEAR(ca.reactionNm, 5000.0, 1e-9);   // the pod, and only the pod
    CHECK(ca.rcsNm == 0.0);                    // no RCS block fitted
    CHECK(ca.gimbalNm == 0.0);                 // throttle shut

    // With the engine lit, the gimbal dwarfs the pod: 160 kN at 5 degrees on a
    // 4.26 m arm. That is why an unpowered coast handles differently, and it is
    // DW-30 item 3 ("generous gimbal") being generous.
    Vessel lit = a.v;
    fireStage(lit);
    lit.layout();
    const ControlAuthority caLit = controlAuthority(lit, mp, 1.0, 1.0);
    CHECK(caLit.gimbalNm > 50000.0);
    CHECK(caLit.gimbalNm / caLit.reactionNm > 10.0);

    FlightSim sim;
    sim.craft = a.v;
    sim.env = env;
    sim.state.posM = Vec3{env.bodyRadiusM + 200000.0, 0, 0};
    sim.state.velMS = Vec3{0, 2000.0, 0};
    sim.state.forward = Vec3{1, 0, 0};
    sim.state.right = Vec3{0, 1, 0};
    sim.state.angVelRadS = Vec3{0, 0.05, 0};
    sim.state.throttle = 0.0;
    sim.sas = SasMode::Hold;
    sim.captureHold();
    const Vec3 held = sim.sasHold;
    for (int i = 0; i < 30000; ++i) sim.step(0.01);   // 300 seconds
    // 5000 N.m against 90,896 kg.m^2 is a slow hand, but it is a hand: the spin
    // is stopped and the vessel is back where it was told to point.
    CHECK(sim.state.angVelRadS.length() < 1e-3);
    CHECK(sim.telemetry.sasErrorRad < 0.01);
    CHECK(normalized(sim.state.forward).dot(held) > 0.9999);
  }

  // ---- RCS adds authority, and spends monopropellant to do it ------------
  {
    Ascender a = makeAscender(true);
    // Four RCS blocks around the pod, well forward of the centre of mass so
    // they have a real arm. A block level with the CoM would add nothing, which
    // is a placement decision the model represents rather than hides.
    for (int i = 0; i < 4; ++i)
      a.v.attach(a.pod, parts::RcsBlock, Attach::Radial, i * 0.5 * orbital::kPi, 2.0);
    a.v.layout();
    const MassProperties mp = massProperties(a.v);
    const ControlAuthority ca = controlAuthority(a.v, mp, 0.0, 0.0);
    CHECK(ca.rcsNm > 0.0);
    CHECK(ca.totalNm() > 20000.0);

    const double mono0 = propellantAboardKg(a.v, Propellant::Monopropellant);
    CHECK_NEAR(mono0, 40.0, 1e-9);   // the pod's own tank

    FlightSim sim;
    sim.craft = a.v;
    sim.env = env;
    sim.state.posM = Vec3{env.bodyRadiusM + 200000.0, 0, 0};
    sim.state.velMS = Vec3{0, 2000.0, 0};
    sim.state.forward = Vec3{1, 0, 0};
    sim.state.right = Vec3{0, 1, 0};
    sim.state.angVelRadS = Vec3{0, 0.2, 0};
    sim.state.throttle = 0.0;
    sim.sas = SasMode::Hold;
    sim.captureHold();
    for (int i = 0; i < 6000; ++i) sim.step(0.01);   // 60 seconds
    const double mono1 = propellantAboardKg(sim.craft, Propellant::Monopropellant);
    // The spin is stopped, and it was paid for.
    CHECK(sim.state.angVelRadS.length() < 1e-3);
    CHECK(mono1 < mono0);
    CHECK(mono0 - mono1 > 0.0005);
    CHECK(mono1 > 0.0);   // and it was not a rounding artefact that emptied it
  }

  // ---- prograde and retrograde hold, available from the first flight -----
  {
    Ascender a = makeAscender(true);
    a.v.layout();
    FlightSim sim;
    sim.craft = a.v;
    sim.env = env;
    sim.state.posM = Vec3{env.bodyRadiusM + 200000.0, 0, 0};
    sim.state.velMS = Vec3{0, 2000.0, 0};
    sim.state.forward = Vec3{1, 0, 0};    // 90 degrees off prograde
    sim.state.right = Vec3{0, 0, 1};
    sim.state.throttle = 0.0;

    sim.sas = SasMode::Prograde;
    for (int i = 0; i < 60000; ++i) sim.step(0.01);   // 600 seconds
    CHECK(normalized(sim.state.forward).dot(normalized(sim.state.velMS)) > 0.999);

    sim.sas = SasMode::Retrograde;
    for (int i = 0; i < 60000; ++i) sim.step(0.01);
    CHECK(normalized(sim.state.forward).dot(normalized(sim.state.velMS)) < -0.999);
  }
}

// =============================================================================
// THE BOUNDARY WITH of::orbital, asserted bit-exact rather than to a tolerance.
// =============================================================================
TEST(coasting_above_the_atmosphere_is_bit_identical_to_the_orbital_integrator) {
  const FlightEnvironment env = forgeEnv();
  Ascender a = makeAscender(true);
  a.v.layout();

  const Vec3 r0{env.bodyRadiusM + 120000.0, 0, 0};
  const Vec3 v0{0, 2200.0, 300.0};

  FlightSim sim;
  sim.craft = a.v;
  sim.env = env;
  sim.state.posM = r0;
  sim.state.velMS = v0;
  sim.state.forward = Vec3{1, 0, 0};
  sim.state.right = Vec3{0, 1, 0};
  sim.state.throttle = 0.0;
  sim.sas = SasMode::Hold;
  sim.captureHold();

  // Above the ceiling with the engine shut, nothing this file models is acting.
  CHECK(sim.onRailsEligible());

  orbital::Integrator ref(orbital::StateVector{r0, v0}, env.muM3S2);

  const double dt = 0.02;
  for (int i = 0; i < 50000; ++i) {   // 1000 seconds
    sim.step(dt);
    ref.step(dt);
  }
  // Not "within a tolerance": the same arithmetic in the same order. Anything
  // less than exact would mean one of the two had quietly drifted, which is the
  // failure this boundary exists to make impossible.
  CHECK(sim.state.posM.x == ref.s.r.x);
  CHECK(sim.state.posM.y == ref.s.r.y);
  CHECK(sim.state.posM.z == ref.s.r.z);
  CHECK(sim.state.velMS.x == ref.s.v.x);
  CHECK(sim.state.velMS.y == ref.s.v.y);
  CHECK(sim.state.velMS.z == ref.s.v.z);

  // And inside the atmosphere it is NOT eligible, so the boundary is a decision
  // and not an accident.
  sim.state.posM = Vec3{env.bodyRadiusM + 50000.0, 0, 0};
  CHECK(!sim.onRailsEligible());
  sim.state.posM = Vec3{env.bodyRadiusM + 60000.0, 0, 0};
  CHECK(sim.onRailsEligible());
  // Nor with the engine lit, however high it is.
  sim.state.posM = Vec3{env.bodyRadiusM + 120000.0, 0, 0};
  fireStage(sim.craft);
  sim.state.throttle = 1.0;
  CHECK(!sim.onRailsEligible());
}

TEST(thrust_cut_above_the_atmosphere_follows_the_conic_orbital_predicts) {
  const FlightEnvironment env = forgeEnv();
  Ascender a = makeAscender(true);
  a.v.layout();

  // A 120 km circular orbit, cut engines, park it as a conic.
  const double r = env.bodyRadiusM + 120000.0;
  const double vCirc = std::sqrt(env.muM3S2 / r);
  CHECK_NEAR(vCirc, 2214.72, 0.01);

  FlightSim sim;
  sim.craft = a.v;
  sim.env = env;
  sim.state.posM = Vec3{r, 0, 0};
  sim.state.velMS = Vec3{0, vCirc, 0};
  sim.state.forward = Vec3{0, 1, 0};
  sim.state.right = Vec3{1, 0, 0};
  sim.state.throttle = 0.0;
  sim.sas = SasMode::Prograde;
  CHECK(sim.onRailsEligible());

  const orbital::Elements parked = sim.park();
  CHECK_NEAR(parked.a, r, 1.0);
  CHECK(parked.e < 1e-9);

  // Integrate one full orbit at 20 ms and compare against the conic of::orbital
  // predicts for the same instant.
  const double period = orbital::orbitalPeriod(parked.a, env.muM3S2);
  CHECK_NEAR(period, 2042.64, 0.1);
  const int steps = static_cast<int>(period / 0.02);
  for (int i = 0; i < steps; ++i) sim.step(0.02);

  const orbital::StateVector predicted = orbital::resume(parked, sim.state.timeS);
  const double posErrM = (sim.state.posM - predicted.r).length();
  const double velErrMS = (sim.state.velMS - predicted.v).length();

  // Measured after one complete 2042.6 s revolution at a 20 ms step (102132
  // steps). The residual is the integrator's own truncation error, not a
  // disagreement about physics: that is what the bit-exact test above
  // established.
  //
  // The bounds below are the MEASURED residue times kResidueMargin, not round
  // numbers. They were round numbers until 2026-07-28 (PH-73), and 5.0 m against
  // a 0.0057 m residue is a control that cannot fail: the integrator could have
  // degraded by two orders of magnitude and this test would still have passed.
  //
  // Why 2x is the right margin, rather than a number picked for looking safe.
  // The residue is DETERMINISTIC: repeated runs agree on every printed digit, so
  // the margin does not have to cover run-to-run noise, only the same source
  // built by a different compiler. That variation is bounded by instruction
  // selection and libm differences, about 1 ulp (2.2e-16 relative) per operation
  // over 102132 steps, so below ~2.3e-11 relative even if it accumulated
  // linearly. The smallest regression this test exists to catch is a change in
  // the integrator's order or step size, and the leading term goes as dt^2, so
  // the cheapest real regression (a doubled step) moves the residue by 4x. The
  // usable window is therefore [1 + 2.3e-11, 4). 2x sits at the log-scale middle
  // of that window: ~1e10 times any portability wobble, and half the smallest
  // regression worth catching.
  //
  // If a compiler change ever trips these, the fix is to re-measure and restate
  // the residue, NOT to widen the margin back into decoration.
  constexpr double kResidueMargin = 2.0;
  constexpr double kPosResidueM   = 0.00570342259015;   // measured 2026-07-28
  constexpr double kVelResidueMS  = 1.75437028384e-05;  // measured 2026-07-28
  CHECK(posErrM < kPosResidueM * kResidueMargin);
  CHECK(velErrMS < kVelResidueMS * kResidueMargin);

  // The orbit itself is unchanged after a full revolution: no secular drift.
  // Same treatment, and these three were the worst of the set: 5.0 m against an
  // 8e-09 m apoapsis deviation is a bound 6e8 times its own residue, and the
  // eccentricity bound was 1e8 times its. All three now assert the measurement.
  constexpr double kApoResidueM  = 8.03265720606e-09;   // measured 2026-07-28
  constexpr double kPeriResidueM = 1.09313987195e-07;   // measured 2026-07-28
  constexpr double kEccResidue   = 7.02847016676e-14;   // measured 2026-07-28
  const OrbitSummary after = summarize(sim.orbitalState(), env.muM3S2, env.bodyRadiusM);
  CHECK_NEAR(after.apoapsisAltM, 120000.0, kApoResidueM * kResidueMargin);
  CHECK_NEAR(after.periapsisAltM, 120000.0, kPeriResidueM * kResidueMargin);
  CHECK(after.eccentricity < kEccResidue * kResidueMargin);

  // Park and resume at the same instant is the identity, which is the on-rails
  // no-drift guarantee of::orbital already proves and this re-checks through
  // the flight-side wrapper.
  const orbital::Elements el2 = sim.park();
  const orbital::StateVector back = orbital::resume(el2, sim.state.timeS);
  CHECK_NEAR((back.r - sim.state.posM).length(), 0.0, 1e-6);
  CHECK_NEAR((back.v - sim.state.velMS).length(), 0.0, 1e-9);
}

// =============================================================================
// THE ACCEPTANCE TEST: pad to orbit.
//
// The pilot lives here and not in flight.h, deliberately. DW-29 makes reaching
// orbit a MANUAL skill first and autopilot a research unlock, so the core
// publishes the guidance ribbon (GravityTurnProgram) and the angle-of-attack
// clamp a hand-flown ascent needs, and something outside it does the flying.
// This test is that something.
// =============================================================================
struct AscentResult {
  bool reachedOrbit = false;
  double apoAltM = 0.0, periAltM = 0.0, eccentricity = 0.0, periodS = 0.0;
  double remainingDeltaVMS = 0.0, propellantLeftKg = 0.0, finalMassKg = 0.0;
  double maxQPa = 0.0, maxQAltM = 0.0, maxAoADeg = 0.0, maxSasErrDeg = 0.0;
  double maxAoAUnderLoadDeg = 0.0, maxSasErrUnderLoadDeg = 0.0;
  double stageTimeS = -1.0, cutoffTimeS = -1.0, circStartS = -1.0, totalTimeS = 0.0;
  double speedAtCutoffMS = 0.0;
  int ticks = 0;
};

static AscentResult flyToOrbit(double targetApoM, double dt) {
  const FlightEnvironment env = forgeEnv();
  Ascender a = makeAscender(true);

  FlightSim sim;
  sim.craft = a.v;
  sim.env = env;
  sim.state.posM = Vec3{env.bodyRadiusM, 0, 0};   // on the pad
  sim.state.velMS = Vec3{0, 0, 0};
  sim.state.forward = Vec3{1, 0, 0};              // straight up
  sim.state.right = Vec3{0, 1, 0};
  sim.state.throttle = 1.0;
  sim.sas = SasMode::Command;
  sim.sasCommand = Vec3{1, 0, 0};
  sim.stage();                                    // light the first engine

  const GravityTurnProgram prog;
  const double maxAoARad = 5.0 / kDeg;
  // The angle-of-attack limit is a smooth function of dynamic pressure: five
  // degrees at and above 5 kPa, unlimited at and below 1 kPa, interpolated in
  // between.
  //
  // Two things force that shape. A hard limit from the pad is a trap, because
  // off the pad the velocity IS vertical: a clamp measured against the velocity
  // forbids the pitch-over that starts the turn, so the velocity stays vertical
  // and the clamp forbids it again. Flown that way the vehicle went straight up,
  // hit 79.7 kPa at 22 km, and fell back. But a hard SWITCH at 5 kPa is also
  // wrong: it steps the commanded attitude by 23 degrees the instant it opens,
  // and stability assist then chases a discontinuity it did not cause.
  const double kClampFullPa = 5000.0;
  const double kClampFreePa = 1000.0;
  AscentResult r;
  double maxAoAUnderLoadDeg = 0.0;
  double maxSasErrUnderLoadDeg = 0.0;
  double eccMin = 1e300;
  bool staged = false, coasting = false, circularising = false, done = false;

  for (int i = 0; i < 400000 && !done; ++i) {
    const Vec3 up = normalized(sim.state.posM);
    const Vec3 east = normalized(cross(up, Vec3{0, 1, 0}));
    const double alt = sim.state.altitudeM(env.bodyRadiusM);
    const OrbitSummary os = summarize(sim.orbitalState(), env.muM3S2, env.bodyRadiusM);

    if (!coasting) {
      // Fly the ribbon, but where the air is working, never chase it more than
      // five degrees off the airflow.
      const Vec3 ribbon = prog.commandedForward(alt, up, east);
      const double q = atmo::dynamicPressure(atmo::density(env.air, alt),
                                             sim.state.velMS.length());
      double t = (q - kClampFreePa) / (kClampFullPa - kClampFreePa);
      t = std::fmax(0.0, std::fmin(1.0, t));
      const double limit = (0.5 * orbital::kPi) +
                           t * (maxAoARad - 0.5 * orbital::kPi);
      sim.sasCommand = clampToMaxAoA(ribbon, sim.state.velMS, limit);
      if (alt > 2000.0 && os.bound && os.apoapsisAltM >= targetApoM) {
        coasting = true;
        sim.state.throttle = 0.0;
        sim.sas = SasMode::Prograde;
        r.cutoffTimeS = sim.state.timeS;
        r.speedAtCutoffMS = sim.state.velMS.length();
      }
    } else if (!circularising) {
      // Coast out of the atmosphere, then start the circularisation burn HALF A
      // BURN TIME BEFORE apoapsis, so that it is centred on it.
      //
      // Waiting for apoapsis itself and then burning is what a first attempt
      // does and it does not work: this burn is about 37 seconds long, and a
      // vehicle that starts it at the top is already falling for all of it, so
      // the thrust raises the far side instead of the near one. Flown that way
      // the best the eccentricity ever reached was 0.065, a 121 x 33 km orbit
      // whose periapsis is 27 km INSIDE the atmosphere. Leading the burn is
      // what a manoeuvre node does and what a player does by eye.
      const double vr = sim.state.velMS.dot(up);
      const double rNow = sim.state.posM.length();
      const double vh = (sim.state.velMS - up * vr).length();
      const double aRadial = env.muM3S2 / (rNow * rNow) - vh * vh / rNow;
      const double tToApo = (vr > 0.0 && aRadial > 0.0) ? vr / aRadial : 0.0;

      const double rApo = env.bodyRadiusM + os.apoapsisAltM;
      const double vApo = (os.bound && os.semiMajorAxisM > 0.0)
                              ? std::sqrt(std::fmax(0.0, env.muM3S2 *
                                    (2.0 / rApo - 1.0 / os.semiMajorAxisM)))
                              : 0.0;
      const double dvNeeded = std::sqrt(env.muM3S2 / rApo) - vApo;
      const double massKg = massProperties(sim.craft).totalKg;
      const PropulsionOutput pr0 = evaluatePropulsion(sim.craft, 1.0, 0.0);
      const double mdot = pr0.massFlowKgS;
      // Rocket equation, not dv * m / thrust: the linear form is 15% long on
      // this burn (42.3 s against 36.8 s) because it ignores the mass thrown
      // away, and a long estimate starts the burn early, which raises the
      // apoapsis rather than the periapsis.
      const double burnS =
          (mdot > 0.0 && pr0.ispS > 0.0)
              ? (massKg / mdot) * (1.0 - std::exp(-dvNeeded / (pr0.ispS * atmo::kG0)))
              : 0.0;

      if (atmo::inSpace(env.air, alt) && os.bound && tToApo <= 0.5 * burnS) {
        circularising = true;
        sim.state.throttle = 1.0;
        r.circStartS = sim.state.timeS;
      }
    } else if (os.bound) {
      // Cut at the MINIMUM of eccentricity, not when the periapsis reaches the
      // apoapsis. The moment the orbit passes through circular the two labels
      // swap: the burn point becomes the periapsis and the far side becomes the
      // new apoapsis, so a "has the periapsis caught the apoapsis" test can
      // never fire again. Flown that way this vehicle burned its upper stage to
      // depletion and left on a hyperbola (e 1.34) with the tanks dry.
      //
      // Watching the eccentricity turn round is the criterion that works, and
      // it is the same one a player uses by eye on the map view.
      if (os.eccentricity < eccMin) {
        eccMin = os.eccentricity;
      } else if (os.eccentricity > eccMin + 1e-6 && eccMin < 0.30) {
        sim.state.throttle = 0.0;
        done = true;
      }
    }

    sim.step(dt);
    ++r.ticks;

    if (sim.telemetry.machlessQPa > r.maxQPa) {
      r.maxQPa = sim.telemetry.machlessQPa;
      r.maxQAltM = sim.telemetry.altitudeM;
    }
    if (sim.telemetry.densityKgM3 > 1e-4)
      r.maxAoADeg = std::fmax(r.maxAoADeg, sim.telemetry.angleOfAttackRad * kDeg);
    if (sim.telemetry.machlessQPa > kClampFullPa)
      maxAoAUnderLoadDeg =
          std::fmax(maxAoAUnderLoadDeg, sim.telemetry.angleOfAttackRad * kDeg);
    if (sim.telemetry.machlessQPa > kClampFullPa)
      maxSasErrUnderLoadDeg =
          std::fmax(maxSasErrUnderLoadDeg, sim.telemetry.sasErrorRad * kDeg);
    r.maxSasErrDeg = std::fmax(r.maxSasErrDeg, sim.telemetry.sasErrorRad * kDeg);

    if (!staged) {
      double lf = 0.0;
      for (const auto& p : sim.craft.parts)
        if (p.stage == 0 && sim.craft.def(p).propellant == Propellant::LiquidFuel)
          lf += p.propellantKg;
      if (lf <= 0.0) {
        sim.stage();          // drop the spent stage AND light the upper engine
        staged = true;
        r.stageTimeS = sim.state.timeS;
      }
    }
    if (sim.telemetry.altitudeM < -100.0) break;    // flew into the ground
    if (sim.state.timeS > 4000.0) break;
  }

  const OrbitSummary os = summarize(sim.orbitalState(), env.muM3S2, env.bodyRadiusM);
  r.reachedOrbit = done && os.bound && os.periapsisAltM > 60000.0;
  r.apoAltM = os.apoapsisAltM;
  r.periAltM = os.periapsisAltM;
  r.eccentricity = os.eccentricity;
  r.periodS = os.periodS;
  r.totalTimeS = sim.state.timeS;
  r.remainingDeltaVMS = remainingDeltaVVacuumMS(sim.craft);
  r.propellantLeftKg = propellantAboardKg(sim.craft, Propellant::LiquidFuel);
  r.finalMassKg = massProperties(sim.craft).totalKg;
  r.maxAoAUnderLoadDeg = maxAoAUnderLoadDeg;
  r.maxSasErrUnderLoadDeg = maxSasErrUnderLoadDeg;
  return r;
}

TEST(a_reference_rocket_flies_from_the_pad_to_a_stable_orbit) {
  const AscentResult r = flyToOrbit(80000.0, 0.02);

  std::printf(
      "    ascent: apo %.0f m  peri %.0f m  e %.5f  period %.0f s\n"
      "            staged at %.1f s, cutoff %.1f s at %.0f m/s, circ %.1f s, total %.1f s\n"
      "            max q %.0f Pa at %.0f m, max AoA %.2f deg (%.2f under load)\n"
      "            max SAS error %.2f deg (%.2f under load)\n"
      "            remaining dV %.0f m/s, propellant %.0f kg, mass %.0f kg, %d ticks\n",
      r.apoAltM, r.periAltM, r.eccentricity, r.periodS, r.stageTimeS,
      r.cutoffTimeS, r.speedAtCutoffMS, r.circStartS, r.totalTimeS, r.maxQPa,
      r.maxQAltM, r.maxAoADeg, r.maxAoAUnderLoadDeg, r.maxSasErrDeg,
      r.maxSasErrUnderLoadDeg, r.remainingDeltaVMS, r.propellantLeftKg,
      r.finalMassKg, r.ticks);

  CHECK(r.reachedOrbit);

  // ---- the orbit ---------------------------------------------------------
  // Aimed at 80 km. Both ends are above the 60 km atmosphere ceiling, so the
  // orbit is genuinely stable rather than slowly decaying.
  // BOTH ends are above the 60 km ceiling, so the orbit is genuinely stable
  // rather than slowly decaying. That is the claim that matters.
  CHECK(r.periAltM > 62000.0);
  CHECK(r.apoAltM > 70000.0 && r.apoAltM < 110000.0);
  CHECK(r.periAltM < r.apoAltM);
  // It is close to round. The residual eccentricity is the guidance, not the
  // physics: a pure prograde burn centred on apoapsis is the manoeuvre a player
  // flies with a node, and it leaves a few percent. Real ascent guidance pitches
  // slightly below prograde near the end to take the rest out, and that belongs
  // behind DW-29's autopilot unlock rather than in the flight model.
  CHECK(r.eccentricity < 0.05);
  CHECK(std::fabs(r.apoAltM - r.periAltM) < 40000.0);
  CHECK(r.periodS > 1700.0 && r.periodS < 2100.0);

  // ---- the flight --------------------------------------------------------
  // Staging happens when the lower tank runs dry, which is the burn time
  // test_vessel.cpp computed by hand: 4300 kg at 61.8010 kg/s = 69.58 s.
  CHECK_NEAR(r.stageTimeS, 69.58, 0.1);
  // The angle-of-attack clamp held where it was armed: while dynamic pressure
  // was above 5 kPa the vehicle never flew more than about five degrees off the
  // airflow. Higher up, where the ribbon asks for more and the air can no longer
  // make it cost anything, it is deliberately free.
  CHECK(r.maxAoAUnderLoadDeg < 5.5);
  // Stability assist tracked the ribbon closely wherever the air was doing
  // anything. The larger figure over the whole flight is a COMMAND step, not a
  // control failure: above 45 km the ribbon is fully horizontal while the
  // trajectory is still climbing, so switching to prograde hold at engine
  // cutoff moves the target by tens of degrees in one tick, in vacuum, where it
  // costs nothing.
  CHECK(r.maxSasErrUnderLoadDeg < 5.0);
  CHECK(r.maxSasErrDeg < 35.0);
  // Max q is in the low tens of kPa, in the altitude band where it belongs.
  CHECK(r.maxQPa > 5000.0 && r.maxQPa < 60000.0);
  CHECK(r.maxQAltM > 3000.0 && r.maxQAltM < 20000.0);

  // ---- the budget --------------------------------------------------------
  // The vehicle carries 4922.91 m/s and this ascent leaves a real reserve, so
  // a first-time player has room to fly it badly and still get there. That
  // margin is the whole of DW-30's "greased, not arcade": the physics is not
  // softened, the vehicle is simply not built to the edge.
  CHECK(r.remainingDeltaVMS > 600.0);
  CHECK(r.remainingDeltaVMS < 2000.0);
  CHECK(r.propellantLeftKg > 0.0);
  // Losses to gravity and drag: total spent, less the orbital speed reached.
  const double spent = 4922.91 - r.remainingDeltaVMS;
  const double vOrbit = std::sqrt(3.5316e12 / (600000.0 + r.periAltM));
  CHECK(spent > vOrbit);                    // it cannot cost less than the speed
  CHECK(spent - vOrbit > 500.0);            // and gravity losses are real
  CHECK(spent - vOrbit < 2200.0);           // but not absurd for this profile
}

// -----------------------------------------------------------------------------
// The same ascent at half the step must reach essentially the same orbit. This
// is what says the acceptance above is measuring the vehicle and not the
// integrator's step size.
// -----------------------------------------------------------------------------
TEST(the_ascent_does_not_depend_on_the_step_size) {
  const AscentResult coarse = flyToOrbit(80000.0, 0.02);
  const AscentResult fine = flyToOrbit(80000.0, 0.01);
  CHECK(coarse.reachedOrbit && fine.reachedOrbit);
  // Staging fires on a propellant quantity, so it lands on the same second
  // whatever the step: 4300 kg at 61.8010 kg/s.
  CHECK_NEAR(coarse.stageTimeS, fine.stageTimeS, 0.05);
  // Both put the whole orbit above the atmosphere with a comparable reserve.
  CHECK(coarse.periAltM > 62000.0 && fine.periAltM > 62000.0);
  CHECK(std::fabs(coarse.remainingDeltaVMS - fine.remainingDeltaVMS) < 120.0);
  // The orbits themselves agree to within a few km. They are not identical and
  // cannot be: the engine is cut when the eccentricity turns round, which is a
  // threshold on a quantity passing through a minimum, so half a tick of
  // difference in WHERE that is detected moves both ends of the orbit. What has
  // to be step-independent is the flight, and it is.
  CHECK(std::fabs(coarse.apoAltM - fine.apoAltM) < 12000.0);
  CHECK(std::fabs(coarse.periAltM - fine.periAltM) < 12000.0);
}

// -----------------------------------------------------------------------------
// Determinism (standing rule 4): same inputs, same trajectory, bit for bit.
// -----------------------------------------------------------------------------
TEST(flight_is_bit_deterministic) {
  const FlightEnvironment env = forgeEnv();
  auto run = [&](FlightState& out, double& fuelOut) {
    Ascender a = makeAscender(true);
    FlightSim sim;
    sim.craft = a.v;
    sim.env = env;
    sim.state.posM = Vec3{env.bodyRadiusM, 0, 0};
    sim.state.forward = Vec3{1, 0, 0};
    sim.state.right = Vec3{0, 1, 0};
    sim.state.throttle = 1.0;
    sim.sas = SasMode::Command;
    sim.sasCommand = Vec3{1, 0, 0};
    sim.stage();
    const GravityTurnProgram prog;
    for (int i = 0; i < 5000; ++i) {
      const Vec3 up = normalized(sim.state.posM);
      const Vec3 east = normalized(cross(up, Vec3{0, 1, 0}));
      sim.sasCommand = clampToMaxAoA(
          prog.commandedForward(sim.state.altitudeM(env.bodyRadiusM), up, east),
          sim.state.velMS, 5.0 / kDeg);
      sim.step(0.02);
    }
    out = sim.state;
    fuelOut = propellantAboardKg(sim.craft, Propellant::LiquidFuel);
  };
  FlightState s1, s2;
  double f1 = 0.0, f2 = 0.0;
  run(s1, f1);
  run(s2, f2);
  CHECK(s1.posM.x == s2.posM.x && s1.posM.y == s2.posM.y && s1.posM.z == s2.posM.z);
  CHECK(s1.velMS.x == s2.velMS.x && s1.velMS.y == s2.velMS.y && s1.velMS.z == s2.velMS.z);
  CHECK(s1.forward.x == s2.forward.x && s1.forward.y == s2.forward.y &&
        s1.forward.z == s2.forward.z);
  CHECK(s1.angVelRadS.x == s2.angVelRadS.x);
  CHECK(f1 == f2);
  CHECK(s1.timeS == s2.timeS);
  // and it actually advanced (DW-20: a probe proves it ran before its numbers
  // are trusted).
  CHECK_NEAR(s1.timeS, 100.0, 1e-9);   // 5000 steps of 20 ms actually ran
  CHECK(f1 < 6450.0);
  CHECK(s1.posM.length() > env.bodyRadiusM + 1000.0);
}
