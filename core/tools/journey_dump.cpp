// =============================================================================
// journey_dump.cpp — headless journey CSV dumper (a NEW consumer of of_core).
//
// Builds a SimWorld, stands up a producing factory, and flies the FULL Phase-1
// flight spine — mirroring core/tests/test_integration.cpp's journey:
//
//   Forge surface → ascent (ACTIVE) → circularize + park (ON-RAILS) →
//   cross to Cinder (FRAME / SOI switch) → descend (ACTIVE) → land on Cinder,
//
// while the factory ticks every step and keeps producing. It samples world
// state every N ticks and writes a CSV to docs/phase1/artifacts/journey.csv so
// a plot can show the KSP×Factorio fusion working end-to-end.
//
// This file does NOT modify any core header — it only READS the public SimWorld
// / FactorySim API and records what it sees, exactly like a test would.
// =============================================================================
#include <cstdio>
#include <cstdint>
#include <cmath>

#include "of/sim_world.h"

using namespace of;

// --- CSV sink ----------------------------------------------------------------
namespace {

constexpr int kSampleEvery = 10;  // record one CSV row per 10 ticks.

FILE* g_csv = nullptr;
long  g_rows = 0;
double g_peakAltKm = 0.0;

// Stand up a minimal 1-machine factory that crafts continuously (mirrors
// test_integration.cpp's standUpFactory): a generator powers a fast recipe and
// a big input buffer keeps it from starving, so producedCount() climbs steadily.
factory::EntityHandle standUpFactory(SimWorld& world) {
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
  sim.feedMachine(m, /*count*/ 30000);  // big input buffer so it never starves
  return m;
}

// Write the header row once.
void writeHeader() {
  std::fprintf(g_csv,
      "tick,simTime_s,altitude_km,terrainAltitude_km,speed_mps,mode,"
      "factoryProduced,rebases,soiSwitches,distToCinder_km\n");
}

// Sample the world into one CSV row (called from inside the journey loops).
void sample(SimWorld& world) {
  const uint64_t tick = world.clock().tickIndex();
  if (tick % kSampleEvery != 0) return;

  const double altKm   = world.vesselAltitude() / 1000.0;
  const double terrKm  = world.vesselTerrainAltitude() / 1000.0;
  const double speed   = world.vesselState().v.length();
  const int    mode    = (world.vesselMode() == VesselMode::OnRails) ? 1 : 0;
  const double distKm  = world.distanceToCinderCentre() / 1000.0;

  if (altKm > g_peakAltKm) g_peakAltKm = altKm;

  std::fprintf(g_csv,
      "%llu,%.4f,%.4f,%.4f,%.4f,%d,%llu,%d,%d,%.4f\n",
      (unsigned long long)tick,
      world.clock().simTime(),
      altKm, terrKm, speed, mode,
      (unsigned long long)world.factory().producedCount(),
      world.floatingOrigin().rebaseCount(),
      world.soiSwitchCount(),
      distKm);
  ++g_rows;
}

// Keep the machine fed (same pattern the integration test uses every loop).
void keepFed(SimWorld& world, factory::EntityHandle machine) {
  if (world.factory().machineInput(machine) < 4)
    world.factory().feedMachine(machine, 1000);
}

}  // namespace

int main() {
  const char* kCsvPath = "docs/phase1/artifacts/journey.csv";
  g_csv = std::fopen(kCsvPath, "w");
  if (!g_csv) {
    std::fprintf(stderr, "journey_dump: could not open %s for writing\n", kCsvPath);
    return 1;
  }
  writeHeader();

  SimWorld world(/*seed*/ 0xABCDEFull);
  factory::EntityHandle machine = standUpFactory(world);

  // ----------------------------------------------------------------------- //
  // STAGE 1 — Surface start: ground contact on Forge.                        //
  // ----------------------------------------------------------------------- //
  const double lat = 0.15, lon = -0.40;  // an arbitrary launch site
  world.placeOnForgeSurface(lat, lon);
  sample(world);  // tick 0: sitting on the pad

  // ----------------------------------------------------------------------- //
  // STAGE 2 — Ascent (ACTIVE): thrust up; floating origin rebases.           //
  // ----------------------------------------------------------------------- //
  const Vec3 up = orbital::normalized(world.vesselState().r);
  world.setThrust(up * 25.0);  // 25 m/s² up — net ~15 m/s² after gravity

  const int ascentTicks = 90 * 60;  // 90 s at 60 Hz
  for (int k = 0; k < ascentTicks; ++k) {
    keepFed(world, machine);
    world.step();
    sample(world);
  }

  // ----------------------------------------------------------------------- //
  // STAGE 3 — Orbit (park to ON-RAILS): circularize, park, propagate.        //
  // ----------------------------------------------------------------------- //
  world.setThrust(Vec3{0, 0, 0});  // cut the engine

  const Vec3 r = world.vesselState().r;
  const Vec3 radial = orbital::normalized(r);
  Vec3 horiz = orbital::cross(Vec3{0, 0, 1}, radial);
  horiz = orbital::normalized(horiz);
  const double vCirc = world.circularSpeedHere();
  world.setVesselVelocity(horiz * vCirc);

  world.parkToRails();  // demote to on-rails (Kepler elements)

  const int orbitTicks = 4000;  // many ticks of on-rails coasting
  for (int k = 0; k < orbitTicks; ++k) {
    keepFed(world, machine);
    world.step();
    sample(world);
  }

  // ----------------------------------------------------------------------- //
  // STAGE 4 — Cross to Cinder (FRAME / SOI switch).                          //
  // ----------------------------------------------------------------------- //
  const double cinderX = 1.2e7;                  // Forge-frame x of Cinder centre
  const double soiR = world.cinderSoiRadius();   // 2.4e6 m
  const Vec3 approachR{cinderX - (soiR + 5.0e4) * 0.92,
                       -(soiR + 5.0e4) * 0.39, 0.0};
  const Vec3 approachV{1400.0, 560.0, 0.0};      // ~1.5 km/s closing toward Cinder
  world.setVesselState(orbital::StateVector{approachR, approachV});
  world.makeActiveFromCurrentState();  // fly the crossing ACTIVE
  world.setThrust(Vec3{0, 0, 0});      // coast across (gravity negligible here)

  uint64_t crossTick = 0;  // tick at which the SOI switch fired (for the summary)
  const int transferTicks = 4000;
  for (int k = 0; k < transferTicks; ++k) {
    keepFed(world, machine);
    const FrameId frameBefore = world.vesselFrame();
    world.step();
    sample(world);
    if (world.vesselFrame() != frameBefore) {
      crossTick = world.clock().tickIndex();
      break;
    }
  }

  // ----------------------------------------------------------------------- //
  // STAGE 5 — Land on Cinder: descend to terrain altitude (contact).         //
  // ----------------------------------------------------------------------- //
  const Vec3 cinderRadial = orbital::normalized(world.vesselState().r);
  const double surfR = SimWorld::terrainRadius(world.cinder(), cinderRadial);
  world.setVesselState(orbital::StateVector{
      cinderRadial * (surfR + 2.5e3),     // 2.5 km up
      cinderRadial * -80.0});             // 80 m/s descent
  world.makeActiveFromCurrentState();     // descend ACTIVE
  world.setThrust(Vec3{0, 0, 0});         // let Cinder gravity pull it in (airless)

  bool landed = false;
  const int descentTicks = 90 * 60;  // up to 90 s of descent
  for (int k = 0; k < descentTicks; ++k) {
    keepFed(world, machine);
    world.step();
    sample(world);
    if (world.vesselLanded(/*toleranceM*/ 5.0)) { landed = true; break; }
  }

  std::fclose(g_csv);

  // ----------------------------------------------------------------------- //
  // One-line journey summary (printed to stdout).                            //
  // ----------------------------------------------------------------------- //
  std::printf(
      "[journey_dump] peak_alt=%.1f km  produced=%llu  rebases=%d  "
      "soi_switches=%d  ticks=%llu  cross_tick=%llu  landed=%s  rows=%ld -> %s\n",
      g_peakAltKm,
      (unsigned long long)world.factory().producedCount(),
      world.floatingOrigin().rebaseCount(),
      world.soiSwitchCount(),
      (unsigned long long)world.clock().tickIndex(),
      (unsigned long long)crossTick,
      landed ? "yes" : "no",
      g_rows, kCsvPath);

  return landed ? 0 : 2;
}
