// =============================================================================
// test_integration.cpp — Phase-1 headless integration (M2.1–M2.4 logic).
//
// Proves the four green Wave-0 cores COMPOSE into one fixed-tick game loop by
// running a controllable craft through the whole flight spine and asserting the
// composition properties at each stage:
//
//   1. Surface start  — vessel sits on Forge at the world-gen terrain altitude
//                       (ground contact via SampleTerrainHeight).
//   2. Ascent ACTIVE  — thrust up, symplectic-integrate; the floating origin
//                       rebases as we climb (rebaseCount grows) and engine-space
//                       coords stay bounded near zero (the seamless / no-wobble
//                       precision property at planetary scale).
//   3. Orbit ON-RAILS — circularize, park to Kepler elements, propagate many
//                       ticks; the parked conic does not drift (energy bounded).
//   4. Cross to Cinder — drive toward Cinder; on entering Cinder's SOI the frame
//                       switches (Forge→Cinder) and the PHYSICAL position is
//                       continuous across the switch (no jump) — patched conics.
//   5. Land on Cinder — descend to Cinder's terrain altitude (ground contact).
//   6. Factory runs   — the factory ticked every step under the same SimClock
//                       and its produced-output counter increased monotonically
//                       across the whole journey (active AND on-rails phases).
//
// The trajectory is deliberately SIMPLIFIED but physically plausible: the point
// is to prove clock + frames + floating-origin + active/on-rails + terrain +
// factory all run inside ONE loop, not to optimize an interplanetary transfer.
// =============================================================================
#include <cstdio>

#include "test_framework.h"
#include "of/sim_world.h"

using namespace of;

// --- A minimal 1-machine factory: a miner-style machine fed every few ticks so
// it crafts continuously and the produced counter climbs throughout the flight.
// (Slice-scale, per P1-D3: we only need "the base keeps working", not 100k.)
static factory::EntityHandle standUpFactory(SimWorld& world) {
  factory::Recipe r;
  r.inputItem = 1;        // ore in
  r.inputCount = 1;
  r.outputItem = 2;       // ingot out
  r.outputCount = 1;
  r.craftTimeTicks = 5;   // fast craft so production is visible over the run
  r.powerW = 1000;

  factory::FactorySim& sim = world.factory();
  factory::EntityHandle m = sim.addMachine(r);
  factory::EntityHandle gen = sim.addGenerator(/*network*/ 1, /*supplyW*/ 100000);
  (void)gen;
  sim.setMachineNetwork(m, 1);
  sim.feedMachine(m, /*count*/ 30000);  // a big input buffer so it never starves
  return m;
}

// =============================================================================
// THE JOURNEY — one continuous run, asserting composition at each milestone.
// =============================================================================
TEST(journey_forge_surface_to_cinder_landing_composes_all_cores) {
  SimWorld world(/*seed*/ 0xABCDEFull);
  factory::EntityHandle machine = standUpFactory(world);

  // ----------------------------------------------------------------------- //
  // STAGE 1 — Surface start: ground contact on Forge.                        //
  // ----------------------------------------------------------------------- //
  const double lat = 0.15, lon = -0.40;  // an arbitrary launch site
  world.placeOnForgeSurface(lat, lon);

  CHECK(world.vesselFrame() == world.forgeFrame());
  CHECK(world.vesselMode() == VesselMode::Active);
  // Sits exactly on the terrain surface (relief from SampleTerrainHeight).
  CHECK_NEAR(world.vesselTerrainAltitude(), 0.0, 1.0);
  CHECK(world.vesselLanded());
  // The body radius really is Forge's 600 km (D-006), so this is physical.
  CHECK_NEAR(world.centralRadius(), 600.0e3, 1.0);

  const uint64_t producedAtStart = world.factory().producedCount();

  // ----------------------------------------------------------------------- //
  // STAGE 2 — Ascent (ACTIVE): thrust up; floating origin rebases; engine    //
  //           coords stay bounded near zero (precision preserved).           //
  // ----------------------------------------------------------------------- //
  // Radially-outward thrust well above Forge surface gravity (≈9.81 m/s²) so we
  // actually climb. Direction = local "up" = the surface normal at the vessel.
  const Vec3 up = orbital::normalized(world.vesselState().r);
  world.setThrust(up * 25.0);  // 25 m/s² up — net ~15 m/s² after gravity

  const int rebasesBeforeAscent = world.floatingOrigin().rebaseCount();
  double maxEngineDist = 0.0;
  const double startAltitude = world.vesselAltitude();

  // Burn for ~90 s of sim time (enough to climb tens of km and rebase a lot).
  const int ascentTicks = 90 * 60;  // 90 s at 60 Hz
  for (int k = 0; k < ascentTicks; ++k) {
    if (world.factory().machineInput(machine) < 4)
      world.factory().feedMachine(machine, 1000);
    world.step();
    // Engine-space position of the vessel relative to the floating origin must
    // stay small (well under the 4 km rebase threshold + one step of travel) —
    // this is the "no precision wobble at planetary scale" property: even though
    // the vessel is ~1.5e11 m from the star, the engine only ever sees ~metres.
    const Vec3f eng = world.floatingOrigin().toEngine(world.vesselRootCoord());
    const double engDist =
        std::sqrt(double(eng.x) * eng.x + double(eng.y) * eng.y +
                  double(eng.z) * eng.z);
    if (engDist > maxEngineDist) maxEngineDist = engDist;
  }

  // We climbed.
  CHECK(world.vesselAltitude() > startAltitude + 10.0e3);  // > 10 km gained
  // The floating origin rebased repeatedly as we climbed (the seamless rebase).
  CHECK(world.floatingOrigin().rebaseCount() > rebasesBeforeAscent + 1);
  // Engine coords stayed bounded near zero the whole ascent (precision win):
  // never more than the rebase threshold plus a single step's worth of motion.
  CHECK(maxEngineDist < 6000.0);  // ≪ planetary scale; bounded by the threshold
  // Factory kept producing through the active ascent.
  CHECK(world.factory().producedCount() > producedAtStart);

  const uint64_t producedAfterAscent = world.factory().producedCount();

  // ----------------------------------------------------------------------- //
  // STAGE 3 — Orbit (park to ON-RAILS): circularize, park, propagate; the    //
  //           on-rails conic does not drift (energy bounded over many ticks). //
  // ----------------------------------------------------------------------- //
  world.setThrust(Vec3{0, 0, 0});  // cut the engine

  // Circularize: set a circular orbital velocity perpendicular to the radius,
  // in the equatorial plane, at the vessel's current radius (a low Forge orbit).
  const Vec3 r = world.vesselState().r;
  const Vec3 radial = orbital::normalized(r);
  // A horizontal direction perpendicular to radial (cross with the pole +z).
  Vec3 horiz = orbital::cross(Vec3{0, 0, 1}, radial);
  horiz = orbital::normalized(horiz);
  const double vCirc = world.circularSpeedHere();
  world.setVesselVelocity(horiz * vCirc);

  // Demote to on-rails (park the live state into Kepler elements).
  world.parkToRails();
  CHECK(world.vesselMode() == VesselMode::OnRails);
  // It really is a near-circular bound orbit about Forge.
  CHECK(world.railElements().e < 0.05);
  CHECK(world.railElements().a > world.centralRadius());

  // Energy of the parked orbit, sampled across many on-rails ticks: analytic
  // propagation is exact, so specific energy must stay put (no secular drift) —
  // the on-rails half of the active/on-rails no-drift guarantee.
  const double E0 =
      orbital::specificEnergy(world.vesselState(), world.centralMu());
  double maxRelEnergyErr = 0.0;
  const int orbitTicks = 4000;  // many ticks of on-rails coasting
  for (int k = 0; k < orbitTicks; ++k) {
    if (world.factory().machineInput(machine) < 4)
      world.factory().feedMachine(machine, 1000);
    world.step();
    const double E = orbital::specificEnergy(world.vesselState(), world.centralMu());
    const double rel = std::fabs((E - E0) / E0);
    if (rel > maxRelEnergyErr) maxRelEnergyErr = rel;
  }
  // No drift: the on-rails orbit's energy is bounded to a tiny relative error.
  CHECK(maxRelEnergyErr < 1e-9);
  // Still a bound orbit (didn't escape or decay).
  CHECK(world.vesselAltitude() > 0.0);
  // Factory kept producing through the on-rails coast too.
  CHECK(world.factory().producedCount() > producedAfterAscent);

  const uint64_t producedAfterOrbit = world.factory().producedCount();

  // ----------------------------------------------------------------------- //
  // STAGE 4 — Cross to Cinder (FRAME SWITCH): drive the vessel toward Cinder; //
  //           on entering Cinder's SOI the frame re-parents and the physical  //
  //           position is continuous across the switch (no jump).             //
  // ----------------------------------------------------------------------- //
  CHECK(world.vesselFrame() == world.forgeFrame());
  const int soiBefore = world.soiSwitchCount();

  // Simplified transfer: place the vessel just OUTSIDE Cinder's SOI (in Forge's
  // frame) on a course that carries it across the boundary, then step ACTIVE
  // (symplectic-integrated) until the SOI detector fires. Cinder sits at
  // Forge-frame +x = 1.2e7 m with SOI 2.4e6 m. We approach from below-and-left
  // of Cinder so the closing velocity has both an x and a y component — a proper
  // (non-degenerate, non-radial) trajectory, not a singular straight-line drop.
  // ACTIVE integration is used here (the craft is being flown across): the
  // symplectic integrator handles any approach geometry; Forge's pull at this
  // 9.5e6 m radius is ~0.04 m/s², so the craft essentially coasts to Cinder.
  const double cinderX = 1.2e7;                  // Forge-frame x of Cinder centre
  const double soiR = world.cinderSoiRadius();   // 2.4e6 m
  // Start ~50 km outside the SOI bubble, offset off-axis, heading in toward it.
  const Vec3 approachR{cinderX - (soiR + 5.0e4) * 0.92,
                       -(soiR + 5.0e4) * 0.39, 0.0};
  const Vec3 approachV{1400.0, 560.0, 0.0};      // ~1.5 km/s closing toward Cinder
  world.setVesselState(orbital::StateVector{approachR, approachV});
  world.makeActiveFromCurrentState();  // fly the crossing ACTIVE (use this state)
  world.setThrust(Vec3{0, 0, 0});      // coast across (gravity negligible here)

  // Record the physical (root-space) position just before the crossing fires.
  UniverseCoord rootBefore = world.vesselRootCoord();
  bool crossed = false;
  UniverseCoord rootAtCrossPre, rootAtCrossPost;

  const int transferTicks = 4000;
  for (int k = 0; k < transferTicks; ++k) {
    if (world.factory().machineInput(machine) < 4)
      world.factory().feedMachine(machine, 1000);
    // Capture the physical point immediately BEFORE this step (still Forge frame
    // until the SOI check inside step() may switch it).
    const UniverseCoord pre = world.vesselRootCoord();
    const FrameId frameBefore = world.vesselFrame();
    world.step();
    if (world.vesselFrame() != frameBefore) {
      // The SOI switch happened during this step. Compare the physical point
      // expressed in root space immediately before vs after — it must be
      // continuous (the frame change is an exact static offset, no jump).
      rootAtCrossPre = pre;
      rootAtCrossPost = world.vesselRootCoord();
      crossed = true;
      break;
    }
    rootBefore = pre;
  }

  CHECK(crossed);  // the vessel entered Cinder's SOI and the frame switched
  CHECK(world.soiSwitchCount() == soiBefore + 1);
  CHECK(world.vesselFrame() == world.cinderFrame());
  // Position continuity across the switch: the root-space physical point moved
  // only by ONE step of orbital travel (≪ the SOI radius), NOT by a frame jump.
  const double crossJump =
      (rootAtCrossPost.pos - rootAtCrossPre.pos).length();
  CHECK(crossJump < 1.0e4);  // < 10 km (one ~1.5 km/s step ≈ 25 m of real motion)
  // Now inside Cinder's SOI, the central μ is Cinder's (patched conics).
  CHECK_NEAR(world.centralMu(), orbital::kCinderMu, 1e6);
  CHECK_NEAR(world.centralRadius(), 200.0e3, 1.0);  // Cinder R = 200 km (D-006)
  // Factory kept producing across the interplanetary transfer + SOI switch.
  CHECK(world.factory().producedCount() > producedAfterOrbit);

  const uint64_t producedAfterTransfer = world.factory().producedCount();

  // ----------------------------------------------------------------------- //
  // STAGE 5 — Land on Cinder: descend to Cinder's terrain altitude (contact). //
  // ----------------------------------------------------------------------- //
  CHECK(world.vesselFrame() == world.cinderFrame());

  // Simplified powered descent: aim the vessel straight down at Cinder's centre
  // along its current radial, then integrate ACTIVE with a retro/gravity-turn
  // burn until it touches the surface. (We do not model a soft-landing profile —
  // we only need "reaches terrain altitude = ground contact".)
  const Vec3 cinderRadial = orbital::normalized(world.vesselState().r);
  const double surfR = SimWorld::terrainRadius(world.cinder(), cinderRadial);
  // Start the descent from just above the surface on this radial, moving down.
  world.setVesselState(orbital::StateVector{
      cinderRadial * (surfR + 2.5e3),     // 2.5 km up
      cinderRadial * -80.0});             // 80 m/s descent
  world.makeActiveFromCurrentState();     // descend ACTIVE from this state
  world.setThrust(Vec3{0, 0, 0});         // let Cinder gravity pull it in (airless)

  bool landed = false;
  const int descentTicks = 90 * 60;  // up to 90 s of descent (plenty of margin)
  for (int k = 0; k < descentTicks; ++k) {
    if (world.factory().machineInput(machine) < 4)
      world.factory().feedMachine(machine, 1000);
    world.step();
    if (world.vesselLanded(/*toleranceM*/ 5.0)) { landed = true; break; }
  }
  CHECK(landed);
  CHECK(world.vesselTerrainAltitude() <= 5.0);  // ground contact on Cinder
  CHECK(world.vesselFrame() == world.cinderFrame());

  // ----------------------------------------------------------------------- //
  // STAGE 6 — Factory ran throughout: produced grew in EVERY phase and the    //
  //           lifetime counter is monotonic + strictly positive.              //
  // ----------------------------------------------------------------------- //
  const uint64_t producedFinal = world.factory().producedCount();
  CHECK(producedFinal > producedAfterTransfer);  // produced during descent too
  // Strict monotonic growth across the whole journey (no phase stalled it):
  CHECK(producedAtStart == 0);
  CHECK(producedAfterAscent  > producedAtStart);      // active ascent
  CHECK(producedAfterOrbit   > producedAfterAscent);  // on-rails orbit
  CHECK(producedAfterTransfer> producedAfterOrbit);   // transfer + SOI switch
  CHECK(producedFinal        > producedAfterTransfer);// active descent
  CHECK(producedFinal > 0);

  // The whole world ran on ONE clock: factory tick index == world tick index.
  CHECK(world.factory().tickIndex() == world.clock().tickIndex());

  std::printf(
      "    [journey] rebases=%d  max_engine_dist=%.1f m  "
      "rail_maxdE/E=%.2e  cross_jump=%.3g m  soi_switches=%d  produced=%llu  "
      "ticks=%llu\n",
      world.floatingOrigin().rebaseCount(), maxEngineDist, maxRelEnergyErr,
      crossJump, world.soiSwitchCount(),
      (unsigned long long)producedFinal,
      (unsigned long long)world.clock().tickIndex());
}

// =============================================================================
// Composition unit checks — small, fast assertions on the individual seams the
// journey relies on, so a failure localizes (which core/seam broke).
// =============================================================================

// The frame graph places Forge and Cinder where SimWorld expects, and root-space
// round-trips are exact (the SOI-switch continuity rests on this).
TEST(simworld_frame_layout_and_roundtrip) {
  SimWorld world;
  // Cinder is inside Forge's SOI and Cinder's SOI bubble is well clear of Forge.
  const Vec3 forgeRoot = world.frames().rootOffset(world.forgeFrame());
  const Vec3 cinderRoot = world.frames().rootOffset(world.cinderFrame());
  const double forgeCinder = (cinderRoot - forgeRoot).length();
  CHECK(forgeCinder > orbital::kCinderSoiRadius);     // Cinder SOI clears Forge
  CHECK(forgeCinder < orbital::kForgeSoiRadius);       // Cinder is Forge's moon

  // A point in Cinder's frame round-trips Cinder→root→Cinder exactly.
  UniverseCoord p(Vec3{2.05e5, 1.0e3, -500.0}, world.cinderFrame());
  UniverseCoord back = world.frames().toFrame(world.frames().toRoot(p),
                                              world.cinderFrame());
  CHECK_NEAR(back.pos.x, p.pos.x, 1e-3);
  CHECK_NEAR(back.pos.y, p.pos.y, 1e-3);
  CHECK_NEAR(back.pos.z, p.pos.z, 1e-3);
}

// Surface placement really lands on the world-gen heightfield (not the mean
// sphere): the terrain altitude is ~0 while the mean-radius altitude is the
// local relief, and they differ by exactly the sampled height.
TEST(simworld_surface_placement_uses_terrain_height) {
  SimWorld world(0x1234ull);
  const double lat = -0.6, lon = 1.1;
  world.placeOnForgeSurface(lat, lon);

  const double relief =
      worldgen::SampleTerrainHeight(world.forge(), lat, lon);
  // Mean-radius altitude == the relief; terrain altitude == 0 (on the surface).
  CHECK_NEAR(world.vesselAltitude(), relief, 1.0);
  CHECK_NEAR(world.vesselTerrainAltitude(), 0.0, 1.0);
}

// park→promote at the SAME SimTime is the identity on (r, v): the active↔on-rails
// handoff introduces no drift (the MASTER_PLAN §3 seam, at the SimWorld level).
TEST(simworld_park_promote_is_identity) {
  SimWorld world;
  world.placeOnForgeSurface(0.0, 0.0);
  // Put it in a real low orbit.
  const Vec3 r = world.vesselState().r;
  Vec3 horiz = orbital::normalized(orbital::cross(Vec3{0, 0, 1},
                                                  orbital::normalized(r)));
  world.setVesselState(orbital::StateVector{
      Vec3{world.centralRadius() + 120.0e3, 0, 0},
      horiz * 0.0});  // placeholder, fixed below
  // Build a clean circular state at 120 km.
  const double rr = world.centralRadius() + 120.0e3;
  const double vc = std::sqrt(world.centralMu() / rr);
  world.setVesselState(orbital::StateVector{Vec3{rr, 0, 0}, Vec3{0, vc, 0}});

  const orbital::StateVector before = world.vesselState();
  world.parkToRails();
  world.promoteToActive();  // same SimTime → identity
  const orbital::StateVector after = world.vesselState();

  CHECK_NEAR(after.r.x, before.r.x, 1e-3);
  CHECK_NEAR(after.r.y, before.r.y, 1e-3);
  CHECK_NEAR(after.r.z, before.r.z, 1e-3);
  CHECK_NEAR(after.v.x, before.v.x, 1e-6);
  CHECK_NEAR(after.v.y, before.v.y, 1e-6);
  CHECK_NEAR(after.v.z, before.v.z, 1e-6);
}

// The factory ticks on the SAME clock as the world: N world steps == N factory
// ticks, and the produced counter is monotonic.
TEST(simworld_factory_shares_the_clock) {
  SimWorld world;
  factory::Recipe rec;
  rec.inputItem = 1; rec.outputItem = 2; rec.craftTimeTicks = 3; rec.powerW = 10;
  factory::EntityHandle m = world.factory().addMachine(rec);
  factory::EntityHandle g = world.factory().addGenerator(1, 100000);
  (void)g;
  world.factory().setMachineNetwork(m, 1);
  world.factory().feedMachine(m, 30000);

  world.placeOnForgeSurface(0.0, 0.0);

  uint64_t prev = world.factory().producedCount();
  for (int k = 0; k < 100; ++k) {
    world.step();
    const uint64_t now = world.factory().producedCount();
    CHECK(now >= prev);  // never decreases
    prev = now;
  }
  CHECK(world.factory().tickIndex() == world.clock().tickIndex());
  CHECK(world.clock().tickIndex() == 100u);
  CHECK(world.factory().producedCount() > 0);
}
