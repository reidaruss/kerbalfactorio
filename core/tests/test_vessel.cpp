// =============================================================================
// test_vessel.cpp - the part catalogue, the vessel tree, staging, and the
// Tsiolkovsky delta-v budget (DW-29, DW-30 item 4).
//
// The delta-v numbers in this file were derived INDEPENDENTLY, by hand, from
// the authored part masses and Isps before the implementation was run, so that
// of::vessel::stagePerformance is pinned to an outside answer rather than to
// itself. The reference vehicle, its arithmetic and the two failure modes those
// numbers discriminate are all recorded in docs/controllers/physics.md §5.
// =============================================================================
#include <cmath>

#include "of/vessel.h"
#include "of/cubed_sphere.h"
#include "of/orbital.h"
#include "test_framework.h"

using namespace of;
using namespace of::vessel;

// -----------------------------------------------------------------------------
// The reference vehicle: "Ascender I". Two stages, all 1.25 m parts.
//
//   stage 0 (jettisoned)  stack decoupler + large tank + main engine + 4 fins
//   stage 1 (final)       command pod + parachute + small tank + vacuum engine
//
// Built root-down: the pod is the root (it is what a player places first and
// what survives to the end), and everything hangs below it.
// -----------------------------------------------------------------------------
struct Ascender {
  Vessel v;
  PartHandle pod = kNoHandle, chute = kNoHandle, tankUp = kNoHandle,
             engUp = kNoHandle, dec = kNoHandle, tankLo = kNoHandle,
             engLo = kNoHandle;
  PartHandle fins[4] = {kNoHandle, kNoHandle, kNoHandle, kNoHandle};
};

static Ascender makeAscender(bool withFins = true) {
  Ascender a;
  Vessel& v = a.v;
  a.pod = v.addRoot(parts::CommandPod);
  a.chute = v.attach(a.pod, parts::Parachute, Attach::StackBottom);
  a.tankUp = v.attach(a.chute, parts::TankSmall, Attach::StackBottom);
  a.engUp = v.attach(a.tankUp, parts::EngineSmall, Attach::StackBottom);
  a.dec = v.attach(a.engUp, parts::DecouplerStack, Attach::StackBottom);
  a.tankLo = v.attach(a.dec, parts::TankLarge, Attach::StackBottom);
  a.engLo = v.attach(a.tankLo, parts::EngineMain, Attach::StackBottom);
  if (withFins) {
    for (int i = 0; i < 4; ++i)
      a.fins[i] = v.attach(a.tankLo, parts::Fin, Attach::Radial,
                           i * 0.5 * orbital::kPi, 0.15);
  }

  // The decoupler and everything below it is stage group 0: it burns during
  // stage 0 and leaves at the end of it. Everything above the decoupler keeps
  // the kNeverDecoupled default, so it is the final stage.
  v.assignSubtreeToStage(a.dec, 0);

  // The KSP sequence: press once to light the lower engine (nothing is dropped
  // yet), press again to drop the whole lower stage AND light the upper engine.
  Stage s0;
  s0.activate.push_back(a.engLo);
  Stage s1;
  s1.activate.push_back(a.engUp);
  s1.decouple.push_back(a.dec);
  v.stages.push_back(s0);
  v.stages.push_back(s1);
  v.layout();
  return a;
}

// =============================================================================
TEST(catalogue_is_complete_and_self_consistent) {
  const PartCatalogue& c = catalogue();
  // Tier 1 (13) + Tier 2 (7) = 20 authored parts.
  CHECK(c.size() == 20);

  // Every id resolves, and no id is duplicated.
  for (const PartDef& d : c.all()) {
    CHECK(c.get(d.id) != nullptr);
    int n = 0;
    for (const PartDef& e : c.all()) if (e.id == d.id) ++n;
    CHECK(n == 1);
    CHECK(d.dryMassKg > 0.0);
    CHECK(d.diameterM > 0.0);
    CHECK(d.heightM > 0.0);
    // Everything has some drag in both axes; a part with none would silently
    // vanish from the aerodynamic model.
    CHECK(d.dragCdAxial > 0.0 && d.dragAreaAxialM2 > 0.0);
    CHECK(d.dragCdNormal > 0.0 && d.dragAreaNormalM2 > 0.0);
    // Every part is attachable somehow, or it cannot be built with.
    CHECK(d.nodeTop || d.nodeBottom || d.radialMount);
  }

  // The stack contract: every part that publishes a stack node is 1.25 m across
  // (ASSET-SPECS.md section 3.3). Radial-only parts are exempt.
  for (const PartDef& d : c.all())
    if (d.nodeTop || d.nodeBottom)
      if (d.id != parts::SolidBooster)  // the booster is a 1.00 m strap-on
        CHECK_NEAR(d.diameterM, 1.25, 1e-12);

  // Terminators, per the art contract: an engine ends a stack downward and a
  // nose cone ends it upward.
  CHECK(c.get(parts::EngineMain)->nodeTop && !c.get(parts::EngineMain)->nodeBottom);
  CHECK(c.get(parts::EngineSmall)->nodeTop && !c.get(parts::EngineSmall)->nodeBottom);
  CHECK(!c.get(parts::NoseCone)->nodeTop && c.get(parts::NoseCone)->nodeBottom);

  // DW-29: the solid booster has no throttle and no restart.
  const PartDef* srb = c.get(parts::SolidBooster);
  CHECK(!srb->throttleable);
  CHECK(!srb->restartable);
  CHECK(srb->gimbalRangeRad == 0.0);
  CHECK(srb->propellant == Propellant::SolidFuel);

  // Crew: exactly one crewed part in Tier 1/2, and it carries one.
  int crewed = 0;
  for (const PartDef& d : c.all()) if (d.crewCapacity > 0) ++crewed;
  CHECK(crewed == 1);
  CHECK(c.get(parts::CommandPod)->crewCapacity == 1);
}

// -----------------------------------------------------------------------------
// Mass flow must not depend on altitude. That is true if and only if every
// engine is authored with thrust_sl / Isp_sl == thrust_vac / Isp_vac, and it is
// checked here rather than trusted because the alternative failure is a burn
// time that quietly drifts as the vehicle climbs.
// -----------------------------------------------------------------------------
TEST(engine_mass_flow_is_altitude_invariant) {
  int engines = 0;
  for (const PartDef& d : catalogue().all()) {
    if (!d.isEngine()) continue;
    ++engines;
    CHECK(d.ispSeaLevelS > 0.0 && d.ispVacuumS > 0.0);
    CHECK(d.thrustSeaLevelN > 0.0 && d.thrustVacuumN > 0.0);
    const double mdotSl = d.thrustSeaLevelN / (d.ispSeaLevelS * atmo::kG0);
    const double mdotVac = d.thrustVacuumN / (d.ispVacuumS * atmo::kG0);
    CHECK_NEAR(mdotSl, mdotVac, 1e-9);
    // Vacuum Isp is never worse than sea-level Isp.
    CHECK(d.ispVacuumS >= d.ispSeaLevelS);
  }
  CHECK(engines == 4);  // main, small, vernier, solid booster

  // The two engines the reference vehicle flies, to 4 dp.
  const PartDef* m = catalogue().get(parts::EngineMain);
  const PartDef* s = catalogue().get(parts::EngineSmall);
  CHECK_NEAR(m->thrustVacuumN / (m->ispVacuumS * atmo::kG0), 61.8010, 1e-4);
  CHECK_NEAR(s->thrustVacuumN / (s->ispVacuumS * atmo::kG0), 16.9953, 1e-4);
}

// =============================================================================
TEST(tree_layout_follows_the_art_stack_contract) {
  Ascender a = makeAscender();
  const Vessel& v = a.v;

  // The root pod's origin is (0,0,0) and it is 2.50 m tall, so its top node is
  // at +2.50. Everything below it stacks downward from 0.
  CHECK_NEAR(v.find(a.pod)->originM.y, 0.0, 1e-12);
  // Parachute (0.75) hangs below the pod: its own bottom plane at -0.75.
  CHECK_NEAR(v.find(a.chute)->originM.y, -0.75, 1e-12);
  // Small tank (2.00) below that: -2.75.
  CHECK_NEAR(v.find(a.tankUp)->originM.y, -2.75, 1e-12);
  // Vacuum engine (1.00): -3.75.
  CHECK_NEAR(v.find(a.engUp)->originM.y, -3.75, 1e-12);
  // Decoupler (0.25): -4.00.
  CHECK_NEAR(v.find(a.dec)->originM.y, -4.00, 1e-12);
  // Large tank (4.00): -8.00.
  CHECK_NEAR(v.find(a.tankLo)->originM.y, -8.00, 1e-12);
  // Main engine (1.60): -9.60.
  CHECK_NEAR(v.find(a.engLo)->originM.y, -9.60, 1e-12);

  // Overall length: from the main engine's bottom (-9.60) to the pod's top
  // (+2.50) is 12.10 m.
  CHECK_NEAR(v.lengthM(), 12.10, 1e-9);

  // A radial fin sits on the large tank's surface at R = 0.625, at four
  // quarter-turn angles, 0.15 m up from that tank's bottom plane.
  const PartInstance* f0 = v.find(a.fins[0]);
  const PartInstance* f1 = v.find(a.fins[1]);
  CHECK_NEAR(f0->originM.x, 0.625, 1e-12);
  CHECK_NEAR(f0->originM.z, 0.0, 1e-12);
  CHECK_NEAR(f1->originM.z, 0.625, 1e-12);
  CHECK_NEAR(f0->originM.y, -8.00 + 0.15, 1e-12);

  // Four symmetric fins put no lateral offset into the centre of mass.
  const MassProperties mp = massProperties(v);
  CHECK_NEAR(mp.comM.x, 0.0, 1e-9);
  CHECK_NEAR(mp.comM.z, 0.0, 1e-9);
}

// =============================================================================
TEST(mass_properties_match_the_authored_parts) {
  Ascender a = makeAscender();
  const MassProperties mp = massProperties(a.v);

  // Dry: pod 800 + chute 100 + small tank 215 + vac engine 400
  //    + decoupler 50 + large tank 430 + main engine 1200 + 4 fins 160 = 3355.
  CHECK_NEAR(mp.dryKg, 3355.0, 1e-9);
  // Propellant: 2150 (small) + 4300 (large) + 40 monoprop in the pod = 6490.
  CHECK_NEAR(mp.propellantKg, 6490.0, 1e-9);
  // Launch mass on the pad.
  CHECK_NEAR(mp.totalKg, 9845.0, 1e-9);

  // Split by kind, because the delta-v sum depends on the split being right.
  CHECK_NEAR(propellantAboardKg(a.v, Propellant::LiquidFuel), 6450.0, 1e-9);
  CHECK_NEAR(propellantAboardKg(a.v, Propellant::Monopropellant), 40.0, 1e-9);
  CHECK_NEAR(propellantAboardKg(a.v, Propellant::SolidFuel), 0.0, 1e-12);

  // The centre of mass sits low, between the two tanks, and inside the hull.
  CHECK(mp.comM.y < -3.0);
  CHECK(mp.comM.y > -9.6);
  // Non-zero, finite inertia about all three axes, and the transverse axes are
  // equal for an axisymmetric stack with symmetric fins.
  CHECK(mp.IxxKgM2 > 0.0 && mp.IyyKgM2 > 0.0 && mp.IzzKgM2 > 0.0);
  CHECK_NEAR(mp.IxxKgM2, mp.IzzKgM2, 1e-6);
  // Roll inertia is far smaller than pitch inertia for a 12 m, 1.25 m rocket.
  CHECK(mp.IyyKgM2 < mp.IxxKgM2 * 0.05);
}

// -----------------------------------------------------------------------------
// Fins are what move the centre of pressure aft. This asserts the sign of the
// static margin flips when they are bolted on, which is the whole mechanism the
// anti-flip model in flight.h keys off.
// -----------------------------------------------------------------------------
TEST(fins_move_the_centre_of_pressure_aft) {
  const MassProperties bare = massProperties(makeAscender(false).v);
  const MassProperties finned = massProperties(makeAscender(true).v);

  const double marginBare = staticMarginM(bare);
  const double marginFinned = staticMarginM(finned);

  // Bare: centre of pressure FORWARD of the centre of mass -> unstable.
  // Measured: CoM -4.4977 m, CoP -1.3097 m, margin +3.188 m. A blunt capsule on
  // a bare tube is very unstable, which is correct and is why KSP beginners flip.
  CHECK(marginBare > 0.0);
  CHECK_NEAR(marginBare, 3.188, 0.01);

  // Finned: pulled aft, past the centre of mass -> statically stable.
  // Measured: CoM -4.5432 m, CoP -5.4267 m, margin -0.884 m.
  CHECK(marginFinned < 0.0);
  CHECK_NEAR(marginFinned, -0.884, 0.01);

  // Four fins moved the centre of pressure 4.117 m down the stack.
  CHECK_NEAR(bare.copM.y - finned.copM.y, 4.117, 0.01);
  // Four fins add 9.35 m^2 of normal-force slope (2.5 x 0.935 each) against the
  // bare airframe's 4.254, so they more than triple the vehicle's.
  CHECK_NEAR(finned.normalForceSlope - bare.normalForceSlope, 9.35, 1e-9);
  CHECK_NEAR(bare.normalForceSlope, 4.254, 0.001);
  // They add real broadside area (4 x 1.30 x 0.935 = 4.862 m^2) ...
  CHECK_NEAR(finned.normalCdA - bare.normalCdA, 4.862, 1e-9);
  // ... and almost no axial area (4 x 0.05 x 0.11 = 0.022 m^2), which is why a
  // fin is nearly free in drag and expensive in stability.
  CHECK_NEAR(finned.axialCdA - bare.axialCdA, 0.022, 1e-9);

  // Stability must survive the tanks emptying, or a rocket that launched
  // straight would flip on the way up. Drain every liquid tank and re-check.
  Ascender drained = makeAscender(true);
  for (auto& p : drained.v.parts)
    if (drained.v.def(p).propellant == Propellant::LiquidFuel) p.propellantKg = 0.0;
  drained.v.layout();
  const MassProperties dm = massProperties(drained.v);
  CHECK(staticMarginM(dm) < 0.0);
  CHECK_NEAR(staticMarginM(dm), -0.960, 0.01);
}

// =============================================================================
// DELTA-V. The numbers below were computed by hand, off the authored masses,
// before this code ran. See docs/controllers/physics.md section 5.
//
//   stage 0: m0 = 9845, m1 = 5545, ratio 1.7754733995, ln 0.5740670913,
//            Isp_vac 330  ->  1857.79 m/s     (Isp_sl 264 -> 1486.23 m/s)
//   stage 1: m0 = 3705, m1 = 1555, ratio 2.3826366559, ln 0.8682077131,
//            Isp_vac 360  ->  3065.12 m/s     (Isp_sl 180 -> 1532.56 m/s)
//   total vacuum: 4922.91 m/s
// =============================================================================
TEST(per_stage_delta_v_matches_the_hand_computation) {
  Ascender a = makeAscender();
  const std::vector<StagePerformance> sp = allStagePerformance(a.v);
  CHECK(sp.size() == 2);

  // ---- stage 0 -----------------------------------------------------------
  CHECK_NEAR(sp[0].startMassKg, 9845.0, 1e-9);
  CHECK_NEAR(sp[0].endMassKg, 5545.0, 1e-9);
  CHECK_NEAR(sp[0].propellantKg, 4300.0, 1e-9);
  CHECK_NEAR(sp[0].ispVacuumS, 330.0, 1e-9);
  CHECK_NEAR(sp[0].ispSeaLevelS, 264.0, 1e-9);
  CHECK_NEAR(sp[0].deltaVVacuumMS, 1857.79, 0.01);
  CHECK_NEAR(sp[0].deltaVSeaLevelMS, 1486.23, 0.01);
  CHECK_NEAR(sp[0].massFlowKgS, 61.8010, 1e-4);
  CHECK_NEAR(sp[0].burnTimeS, 69.58, 0.01);

  // ---- stage 1 (final) ---------------------------------------------------
  // The 40 kg of monopropellant is INERT to a liquid-engine burn, so it is in
  // both m0 and m1. Treating it as burnable is the classic way a home-made
  // readout comes out about 95 m/s optimistic; that is what this pins.
  CHECK_NEAR(sp[1].startMassKg, 3705.0, 1e-9);
  CHECK_NEAR(sp[1].endMassKg, 1555.0, 1e-9);
  CHECK_NEAR(sp[1].propellantKg, 2150.0, 1e-9);
  CHECK_NEAR(sp[1].ispVacuumS, 360.0, 1e-9);
  CHECK_NEAR(sp[1].deltaVVacuumMS, 3065.12, 0.01);
  CHECK_NEAR(sp[1].deltaVSeaLevelMS, 1532.56, 0.01);
  CHECK_NEAR(sp[1].massFlowKgS, 16.9953, 1e-4);
  CHECK_NEAR(sp[1].burnTimeS, 126.51, 0.01);

  // ---- the whole vehicle -------------------------------------------------
  CHECK_NEAR(totalDeltaVVacuumMS(a.v), 4922.91, 0.02);

  // Tsiolkovsky itself, hit directly with the same numbers.
  CHECK_NEAR(tsiolkovsky(330.0, 9845.0, 5545.0), 1857.79, 0.01);
  CHECK_NEAR(tsiolkovsky(360.0, 3705.0, 1555.0), 3065.12, 0.01);
  // Degenerate inputs return 0 rather than a NaN or an infinity.
  CHECK(tsiolkovsky(330.0, 1000.0, 1000.0) == 0.0);
  CHECK(tsiolkovsky(330.0, 1000.0, 0.0) == 0.0);
  CHECK(tsiolkovsky(0.0, 1000.0, 500.0) == 0.0);
}

// -----------------------------------------------------------------------------
// Thrust-to-weight. Gravity comes from BodyParams::muM3S2 and nothing else
// (DW-18), so this test reads the body the world generator publishes rather
// than a constant of its own.
// -----------------------------------------------------------------------------
TEST(thrust_to_weight_reads_the_one_gravity_authority) {
  Ascender a = makeAscender();
  const worldgen::BodyParams forge = worldgen::makeForge(12345);
  const atmo::AtmosphereProfile air = atmo::makeForgeAtmosphere();

  // The body's own mu, not a transcribed g. Forge: 9.81 * 600e3^2.
  CHECK_NEAR(forge.muM3S2, 3.5316e12, 1.0);
  // and it agrees bit-for-bit with the propagator's copy, which is the pin that
  // stopped the walker and the propagator disagreeing about the same planet.
  CHECK(forge.muM3S2 == orbital::kForgeMu);

  const double twrPad = thrustToWeight(a.v, 0, forge.muM3S2, forge.radiusM, 0.0, air);
  // 160 kN sea level / (9845 kg * 9.81 m/s^2) = 1.6567.
  CHECK_NEAR(twrPad, 1.6567, 1e-4);

  // Climbing raises it twice over: thrust rises toward vacuum and weight falls.
  const double twr40k = thrustToWeight(a.v, 0, forge.muM3S2, forge.radiusM, 40000.0, air);
  CHECK(twr40k > twrPad);
  // At 40 km the air is essentially gone, so thrust is within 0.1% of vacuum.
  const double g40 = forge.muM3S2 / ((forge.radiusM + 40000.0) * (forge.radiusM + 40000.0));
  CHECK_NEAR(twr40k, 200000.0 / (9845.0 * g40), 1e-3);

  // The upper stage's TWR in vacuum: 60 kN on 3705 kg.
  const double twrUpper =
      thrustToWeight(a.v, 1, forge.muM3S2, forge.radiusM, 60000.0, air);
  const double g60 = forge.muM3S2 / ((forge.radiusM + 60000.0) * (forge.radiusM + 60000.0));
  CHECK_NEAR(twrUpper, 60000.0 / (3705.0 * g60), 1e-9);
  CHECK(twrUpper > 1.5);
}

// =============================================================================
// STAGING: the tree splits, and mass is conserved.
// =============================================================================
TEST(firing_a_stage_splits_the_tree_and_conserves_mass) {
  Ascender a = makeAscender();
  const double before = massProperties(a.v).totalKg;
  CHECK_NEAR(before, 9845.0, 1e-9);
  const size_t partsBefore = a.v.parts.size();
  CHECK(partsBefore == 11);  // 7 stack parts + 4 fins

  // Burn stage 0 dry first, the way a real flight would, so the conservation
  // check is not trivially satisfied by full tanks.
  for (auto& p : a.v.parts)
    if (p.stage == 0 && a.v.def(p).propellant == Propellant::LiquidFuel)
      p.propellantKg = 0.0;
  const double afterBurn = massProperties(a.v).totalKg;
  CHECK_NEAR(afterBurn, 9845.0 - 4300.0, 1e-9);

  // Press one: light the lower engine. Nothing is dropped, nothing changes mass.
  const StageResult ignite = fireStage(a.v);
  CHECK(ignite.fired);
  CHECK(ignite.stageIndex == 0);
  CHECK(ignite.jettisoned.empty());
  CHECK_NEAR(massProperties(a.v).totalKg, afterBurn, 1e-12);
  CHECK(activeEngines(a.v).size() == 1);
  CHECK(activeEngines(a.v)[0] == a.engLo);

  // Press two: drop the spent lower stage AND light the upper engine.
  const StageResult r = fireStage(a.v);
  CHECK(r.fired);
  CHECK(r.stageIndex == 1);
  CHECK(r.jettisoned.size() == 1);

  const double kept = massProperties(a.v).totalKg;
  const double gone = massProperties(r.jettisoned[0]).totalKg;

  // THE conservation assertion.
  CHECK_NEAR(kept + gone, afterBurn, 1e-9);
  CHECK_NEAR(gone, r.jettisonedMassKg, 1e-9);
  // Stage 0's dry structure is 1840 kg: decoupler 50 + tank 430 + engine 1200
  // + 4 fins 160. Its tanks are empty, so that is all that leaves.
  CHECK_NEAR(gone, 1840.0, 1e-9);
  // What is left is the final stage, wet.
  CHECK_NEAR(kept, 3705.0, 1e-9);

  // No part was lost or duplicated.
  CHECK(a.v.parts.size() + r.jettisoned[0].parts.size() == partsBefore);
  CHECK(a.v.parts.size() == 4);         // pod, chute, small tank, vacuum engine
  CHECK(r.jettisoned[0].parts.size() == 7);  // decoupler, tank, engine, 4 fins

  // The jettisoned subtree is a legal vessel: it has exactly one root, and that
  // root is the decoupler that severed it.
  CHECK(r.jettisoned[0].root() != kNoHandle);
  CHECK(r.jettisoned[0].root() == a.dec);
  CHECK(r.jettisoned[0].find(a.dec)->parent == kNoHandle);
  CHECK(r.jettisoned[0].find(a.dec)->attach == Attach::Root);
  // The fins went with the tank they were bolted to, which is the point of
  // splitting a tree rather than a span: they are not adjacent in any list.
  for (int i = 0; i < 4; ++i) {
    CHECK(r.jettisoned[0].find(a.fins[i]) != nullptr);
    CHECK(a.v.find(a.fins[i]) == nullptr);
  }

  // The spent engine left with the stage, and the upper engine is now the only
  // one lit: activeEngines() filters parts that no longer exist, so no separate
  // shutdown call exists or can be forgotten.
  CHECK(activeEngines(a.v).size() == 1);
  CHECK(activeEngines(a.v)[0] == a.engUp);

  // The remaining vessel is burning stage 1, and its remaining delta-v is the
  // upper stage's alone.
  CHECK(a.v.nextStageIndex == 2);
  CHECK_NEAR(remainingDeltaVVacuumMS(a.v), 3065.12, 0.02);
}

// -----------------------------------------------------------------------------
// A radial decoupler splits a strap-on booster off the side of the stack. Same
// rule, no special case, and the mass conservation is asserted with TWO
// jettisoned vessels so the multi-decoupler path is covered.
// -----------------------------------------------------------------------------
TEST(radial_decouplers_split_two_boosters_at_once) {
  Vessel v;
  const PartHandle pod = v.addRoot(parts::CommandPod);
  const PartHandle tank = v.attach(pod, parts::TankLarge, Attach::StackBottom);
  const PartHandle eng = v.attach(tank, parts::EngineMain, Attach::StackBottom);
  PartHandle decR[2], srb[2];
  for (int i = 0; i < 2; ++i) {
    decR[i] = v.attach(tank, parts::DecouplerRadial, Attach::Radial,
                       i * orbital::kPi, 1.0);
    srb[i] = v.attach(decR[i], parts::SolidBooster, Attach::Radial, 0.0, -1.0);
    v.assignSubtreeToStage(decR[i], 0);
  }
  (void)eng;
  Stage s0;
  s0.activate.push_back(srb[0]);
  s0.activate.push_back(srb[1]);
  Stage s1;
  s1.activate.push_back(eng);
  s1.decouple.push_back(decR[0]);
  s1.decouple.push_back(decR[1]);
  v.stages.push_back(s0);
  v.stages.push_back(s1);
  v.layout();

  const double before = massProperties(v).totalKg;
  // pod 840 (800 + 40 mono) + tank 4730 + engine 1200
  //   + 2 x (radial decoupler 25 + booster 500 + 3350 solid) = 14520.
  CHECK_NEAR(before, 840.0 + 4730.0 + 1200.0 + 2.0 * (25.0 + 3850.0), 1e-9);
  CHECK_NEAR(before, 14520.0, 1e-9);

  CHECK(fireStage(v).jettisoned.empty());   // press one: light both boosters
  const StageResult r = fireStage(v);      // press two: drop both, light the core
  CHECK(r.fired);
  CHECK(r.jettisoned.size() == 2);

  double gone = 0.0;
  for (const Vessel& j : r.jettisoned) gone += massProperties(j).totalKg;
  const double kept = massProperties(v).totalKg;
  CHECK_NEAR(kept + gone, before, 1e-9);
  CHECK_NEAR(gone, 2.0 * (25.0 + 500.0 + 3350.0), 1e-9);
  CHECK_NEAR(kept, 840.0 + 4730.0 + 1200.0, 1e-9);
  CHECK(v.parts.size() == 3);
  CHECK(r.jettisoned[0].parts.size() == 2);
  CHECK(r.jettisoned[1].parts.size() == 2);
  // Solid fuel is gone with the boosters; it was never transferable.
  CHECK_NEAR(propellantAboardKg(v, Propellant::SolidFuel), 0.0, 1e-12);
}

// -----------------------------------------------------------------------------
// Firing past the last stage is a no-op rather than an error, because a player
// mashing the space bar at apoapsis must not corrupt a vessel.
// -----------------------------------------------------------------------------
TEST(staging_past_the_end_is_a_no_op) {
  Ascender a = makeAscender();
  CHECK(fireStage(a.v).fired);       // light the lower engine
  CHECK(fireStage(a.v).fired);       // drop the lower stage, light the upper
  const double m = massProperties(a.v).totalKg;
  const size_t n = a.v.parts.size();
  for (int i = 0; i < 5; ++i) {
    const StageResult r = fireStage(a.v);
    CHECK(!r.fired);
    CHECK(r.jettisoned.empty());
  }
  CHECK_NEAR(massProperties(a.v).totalKg, m, 1e-12);
  CHECK(a.v.parts.size() == n);
}

// -----------------------------------------------------------------------------
// Determinism (standing rule 4): the same construction sequence produces the
// same vessel, bit for bit, including every derived quantity.
// -----------------------------------------------------------------------------
TEST(vessel_construction_is_bit_deterministic) {
  Ascender a = makeAscender();
  Ascender b = makeAscender();
  const MassProperties ma = massProperties(a.v);
  const MassProperties mb = massProperties(b.v);
  CHECK(ma.totalKg == mb.totalKg);
  CHECK(ma.comM.x == mb.comM.x && ma.comM.y == mb.comM.y && ma.comM.z == mb.comM.z);
  CHECK(ma.copM.y == mb.copM.y);
  CHECK(ma.IxxKgM2 == mb.IxxKgM2);
  CHECK(ma.IyyKgM2 == mb.IyyKgM2);
  CHECK(totalDeltaVVacuumMS(a.v) == totalDeltaVVacuumMS(b.v));

  // and after an identical staging sequence.
  fireStage(a.v);
  fireStage(b.v);
  const StageResult ra = fireStage(a.v);
  const StageResult rb = fireStage(b.v);
  CHECK(ra.jettisonedMassKg == rb.jettisonedMassKg);
  CHECK(massProperties(a.v).totalKg == massProperties(b.v).totalKg);
}
