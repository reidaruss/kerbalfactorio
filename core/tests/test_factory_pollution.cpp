// =============================================================================
// test_factory_pollution.cpp — the enemies loop driven by a REAL factory (FS-33).
//
// The stock-take's F2 in one sentence: enemies.h shipped complete (525 checks)
// and no machine emitted a gram of pollution, so the loop was inert in game
// while fully exercised in test. This suite closes it THROUGH THE PRODUCTION
// PATH, which is the FS-30 lesson: every prior enemies fixture drove emitters
// directly, exactly the way fillSaturated() wrote a belt's end state, and the
// claim that matters ("a running factory feeds the field") was never the claim
// being tested. Here a drill mines, belts carry, smelters craft, a burner
// generator burns coal for an electric smelter, and the FIELD that results is
// asserted against numbers derived on paper before the code ran.
//
// Hand-derived constants (FS-25 discipline — computed BEFORE running):
//   * Drill at 2.0/s: addMiner rounds to 33 milli-units/tick, so full-rate
//     work per 60-tick window is exactly 33*60 = 1980 == the denominator, and
//     an unblocked drill's duty is exactly 1.0 (the accrual, not whole units,
//     is metered — whole units would jitter with the accumulator phase).
//   * A continuously-crafting machine advances exactly 1000 milliticks/tick at
//     satisfaction 65536, so duty is exactly 1.0.
//   * ONE 30 kW electric smelter on ONE 90 kW generator:
//       loadQ16  = floor(30000 * 65536 / 90000)  = 21845
//       outputW  = floor(90000 * 21845 / 65536)  = 29999   (not 30000)
//       burn/tick = floor(29999 * 1000 / 60)     = 499,983 mJ
//       window    = 499,983 * 60 = 29,998,980 mJ against 90,000,000 rated
//       generator rate = 6.0 * 29998980/90000000 = 1.9999320/s
//   * Emission table at the machines: drill 1.0, fuel smelter 2.0, electric
//     smelter 2.0 * 0.3 = 0.6 (grid consumers emit at the electric factor;
//     the combustion happens at the generator), belts and poles nothing.
//   * Steady producedPerSecond of the whole scene:
//       1.0 + 1.0 + 2.0 + 0.6 + 1.9999320 = 6.5999320
// =============================================================================
#include <chrono>
#include <cmath>
#include <cstdio>
#include <vector>

#include "of/automation.h"
#include "of/persistence.h"
#include "test_framework.h"

using of::Vec3;
using of::automation::BuildableNetwork;
using of::automation::BuildId;
using of::automation::GeneratorId;
namespace en = of::enemies;

namespace {

constexpr uint64_t kSeed = 0x0bf00d01ull;  // the project's default world seed
constexpr of::factory::ItemId kOre = 1, kIngot = 2, kCoal = 3;

of::worldgen::BodyParams forge() { return of::worldgen::makeForge(kSeed); }
Vec3 baseDir() { return en::unitOf(Vec3(0.1, 0.05, 1.0)); }

// The hand-derived generator arithmetic (see the header comment).
const double kGenDuty = 29998980.0 / 90000000.0;
const double kGenRate = 6.0 * kGenDuty;
const double kSteadySum = 1.0 + 1.0 + 2.0 + 0.6 + kGenRate;

struct Scene {
  BuildId drillA, beltA, s1, drillB, beltB, s2;
  GeneratorId gen = 0;
};

// The acceptance factory: a FUEL line at the local origin (drill -> belt ->
// 60-tick smelter at 0 W) and an ELECTRIC cluster 600 m east (pole, 90 kW
// burner generator, drill -> belt -> 30 kW electric smelter). Both drills run
// at 2.0/s against 1/s smelter consumption, so after warmup nothing is ever
// starved and every duty cycle is exactly 1.0 — which is what makes the field
// hand-derivable.
Scene buildScene(BuildableNetwork& net, const en::EnemyTuning& tuning,
                 uint64_t depositUnits = 1000000, uint16_t coalUnits = 10) {
  net.enableGrid();
  net.enableEnemies(forge(), kSeed, baseDir(), tuning);
  Scene sc;
  sc.drillA = net.placeMinerOnDeposit(depositUnits, kOre, 2.0, 50);
  net.setPlacement(sc.drillA, 0x10, 0.0f, 0.0f, 0.0f);
  sc.beltA = net.placeBelt(3, 8);
  net.setPlacement(sc.beltA, 0x11, 1.0f, 0.0f, 0.0f);  // belts: no emitter
  sc.s1 = net.placeSmelter(kOre, kIngot, 60, 0, 0);
  net.setPlacement(sc.s1, 0x12, 2.0f, 0.0f, 0.0f);
  net.connect(sc.drillA, sc.beltA);
  net.connect(sc.beltA, sc.s1);
  net.placePole(600.0f, 0.0f, 0.0f);
  sc.gen = net.placeBurnerGenerator(600.5f, 0.0f, 0.5f, kCoal);
  if (coalUnits) net.insertFuel(sc.gen, kCoal, coalUnits);
  sc.drillB = net.placeMinerOnDeposit(depositUnits, kOre, 2.0, 50);
  net.setPlacement(sc.drillB, 0x10, 599.0f, 0.0f, 0.0f);
  sc.beltB = net.placeBelt(3, 8);
  sc.s2 = net.placeElectricSmelter(kOre, kIngot, 600.5f, 0.0f, -0.5f,
                                   60, 30000, 0);
  net.setPlacement(sc.s2, 0x12, 600.5f, 0.0f, -0.5f);
  net.connect(sc.drillB, sc.beltB);
  net.connect(sc.beltB, sc.s2);
  return sc;
}

double rateOf(const BuildableNetwork& net, en::EmitterId id) {
  for (const en::Emitter& e : net.enemySim().emitters())
    if (e.id == id) return e.ratePerSecond;
  return -1.0;  // distinguishable from a real 0.0
}

}  // namespace

// =============================================================================
// §1 — The emission table, as data, with the policy applied.
// =============================================================================
TEST(emission_table_and_electric_policy) {
  // The base table is the enemies lane's authored data, unchanged.
  CHECK(en::pollutionRateForMachine(0x10) == 1.0);  // drill
  CHECK(en::pollutionRateForMachine(0x11) == 0.0);  // belt
  CHECK(en::pollutionRateForMachine(0x12) == 2.0);  // smelter
  CHECK(en::pollutionRateForMachine(0x13) == 1.5);  // assembler
  CHECK(en::pollutionRateForMachine(0x14) == 0.0);  // box
  CHECK(en::pollutionRateForMachine(0x15) == 6.0);  // generator dominates
  CHECK(en::pollutionRateForMachine(0x16) == 0.0);  // pole
  // The one knob this layer adds: a grid consumer emits at 0.3x its base at
  // the machine; the burning happens at the generator.
  BuildableNetwork::PollutionPolicy p;
  CHECK_NEAR(p.electricEmissionFactor, 0.3, 1e-15);
  CHECK_NEAR(2.0 * p.electricEmissionFactor, 0.6, 1e-15);
}

// =============================================================================
// §2 — Steady-state emitter rates, each hand-derived, read off a REAL line
// after 4 pollution windows (240 ticks; every source is at full duty from
// window 4 at the latest — first ore lands in a smelter near tick 132).
// =============================================================================
TEST(working_line_rates_are_hand_derived_exactly) {
  BuildableNetwork net;
  en::EnemyTuning t;  // defaults; decay/prune irrelevant to the rates
  Scene sc = buildScene(net, t);

  // Exactly five emitters: two drills, two smelters, one generator. The belt
  // has a placement and NO emitter — logistics must not lengthen the scan.
  CHECK(net.enemySim().emitters().size() == 5);
  CHECK(net.pollutionEmitterOf(sc.beltA) == en::kNoEmitter);
  CHECK(net.pollutionEmitterOf(sc.drillA) != en::kNoEmitter);
  CHECK(net.generatorEmitterOf(sc.gen) != en::kNoEmitter);

  net.stepN(240);

  CHECK_NEAR(rateOf(net, net.pollutionEmitterOf(sc.drillA)), 1.0, 1e-12);
  CHECK_NEAR(rateOf(net, net.pollutionEmitterOf(sc.drillB)), 1.0, 1e-12);
  CHECK_NEAR(rateOf(net, net.pollutionEmitterOf(sc.s1)), 2.0, 1e-12);
  CHECK_NEAR(rateOf(net, net.pollutionEmitterOf(sc.s2)), 0.6, 1e-12);
  CHECK_NEAR(rateOf(net, net.generatorEmitterOf(sc.gen)), kGenRate, 1e-12);
  CHECK_NEAR(net.pollutionReport().producedPerSecond, kSteadySum, 1e-9);

  // The factory really is producing (this is not a scripted emitter scene).
  CHECK(net.producedCountOf(kIngot) > 0);
  CHECK(net.satisfactionOf(sc.s2) == 1.0);  // 30 kW on 90 kW: no brownout
}

// =============================================================================
// §3 — Mass balance against the closed form. Decay 0 and prune 0 make the
// field a pure integrator: between two window boundaries past warmup, the
// total mass grows by EXACTLY (steady emission) * (windows elapsed).
// =============================================================================
TEST(field_mass_matches_closed_form_with_decay_off) {
  BuildableNetwork net;
  en::EnemyTuning t;
  t.decayRate = 0.0;
  t.pruneEpsilon = 0.0;
  buildScene(net, t);

  net.stepN(300);  // 5 windows: past every warmup edge
  const double m5 = net.enemySim().field().totalMass();
  net.stepN(60 * 100);  // 100 more windows
  const double m105 = net.enemySim().field().totalMass();

  // 100 windows * 6.5999320 units/s * 1 s/window, derived on paper.
  CHECK_NEAR(m105 - m5, 100.0 * kSteadySum, 1e-6);
  // And nothing was pruned or decayed, so the field only ever grew.
  CHECK(m105 > m5);
}

// =============================================================================
// §3b — With decay ON (default 0.0025/window) and prune 0, the field obeys
// M_n = s*(M_{n-1} + E). Warmup windows emit less than E, so after N windows
// the mass sits BETWEEN the closed form started at window 5 and the closed
// form started at window 1 — both derived by hand.
// =============================================================================
TEST(decayed_field_sits_between_hand_derived_bounds) {
  BuildableNetwork net;
  en::EnemyTuning t;
  t.pruneEpsilon = 0.0;  // decay stays at its default 0.0025
  buildScene(net, t);

  const int N = 120;
  net.stepN(60 * N);
  const double m = net.enemySim().field().totalMass();

  const double s = 1.0 - t.decayRate;
  // Sum of E*s^(N-w+1) for w = a..N  ==  E * s * (1 - s^(N-a+1)) / (1 - s).
  const double upper =
      kSteadySum * s * (1.0 - std::pow(s, N)) / (1.0 - s);          // from w=1
  const double lower =
      kSteadySum * s * (1.0 - std::pow(s, N - 4)) / (1.0 - s);      // from w=5
  CHECK(m <= upper * (1.0 + 1e-9));
  CHECK(m >= lower * (1.0 - 1e-9));
}

// =============================================================================
// §4 — Brownout scales machine emission by the SAME Q16 factor that slowed
// the craft, and the flat-out generator pays the balance. Four 30 kW electric
// smelters on one 90 kW generator: satisfaction 49152 (exactly 0.75), each
// smelter advances 750 milliticks/tick, so each emits 0.6 * 0.75 = 0.45 while
// the generator runs at duty exactly 1.0 and emits the full 6.0.
// =============================================================================
TEST(brownout_scales_emission_and_the_generator_pays) {
  BuildableNetwork net;
  net.enableGrid();
  net.enableEnemies(forge(), kSeed, baseDir());
  net.placePole(0.0f, 0.0f, 0.0f);
  GeneratorId gen = net.placeBurnerGenerator(0.5f, 0.0f, 0.0f, kCoal);
  net.insertFuel(gen, kCoal, 20);
  BuildId smelters[4];
  const float sx[4] = {1.0f, 1.0f, -1.0f, -1.0f};
  const float sz[4] = {1.0f, -1.0f, 1.0f, -1.0f};
  for (int i = 0; i < 4; ++i) {
    smelters[i] = net.placeElectricSmelter(kOre, kIngot, sx[i], 0.0f, sz[i],
                                           60, 30000, 0);
    net.setPlacement(smelters[i], 0x12, sx[i], 0.0f, sz[i]);
    BuildId d = net.placeMinerOnDeposit(1000000, kOre, 2.0, 50);
    net.setPlacement(d, 0x10, 3.0f + i, 0.0f, 3.0f);
    net.connect(d, smelters[i]);  // direct drill -> smelter hand-off
  }

  net.stepN(300);  // 5 windows; steady from window 2

  CHECK(net.networkStats(0).satisfactionQ16 == 49152u);  // exactly 3/4
  for (int i = 0; i < 4; ++i)
    CHECK_NEAR(rateOf(net, net.pollutionEmitterOf(smelters[i])),
               0.6 * 0.75, 1e-12);
  CHECK_NEAR(rateOf(net, net.generatorEmitterOf(gen)), 6.0, 1e-12);
  // 4 drills at 1.0 + 4 smelters at 0.45 + the generator at 6.0.
  CHECK_NEAR(net.pollutionReport().producedPerSecond,
             4.0 * 1.0 + 4.0 * 0.45 + 6.0, 1e-9);
}

// =============================================================================
// §5 — THE NEGATIVE CONTROL. A fully idle factory (empty deposits, no fuel)
// emits NOTHING over fifteen simulated minutes: zero rate, zero field mass,
// zero cells, and a nest parked next to it absorbs nothing and NEVER attacks.
// The run provably ran (the evolution time term rises), per DW-20.
// =============================================================================
TEST(idle_factory_emits_nothing_and_no_wave_ever_forms) {
  BuildableNetwork net;
  en::EnemyTuning t;
  t.attackThresholdPollution = 50.0;  // give a wave every possible chance
  t.attackCooldownTicks = 600;
  buildScene(net, t, /*depositUnits=*/0, /*coalUnits=*/0);
  const en::NestId nest =
      net.enemySim().addNest(net.surfaceDirOfLocal(750.0f, 0.0f, 0.0f));
  CHECK(nest != en::kNoNest);

  net.stepN(60 * 900);  // 15 simulated minutes

  CHECK(net.enemySim().emitters().size() == 5);  // wired, just idle
  CHECK(net.pollutionReport().producedPerSecond == 0.0);
  CHECK(net.enemySim().field().totalMass() == 0.0);
  CHECK(net.enemySim().field().activeCells() == 0);
  CHECK(net.enemySim().nest(nest)->absorbedLifetime == 0.0);
  CHECK(net.enemySim().nest(nest)->wavesDispatched == 0);
  CHECK(net.enemySim().pendingWaves().empty());
  CHECK(net.evolutionState().fromPollution == 0.0);
  CHECK(net.evolutionState().fromTime > 0.0);  // the run demonstrably ran
}

// =============================================================================
// §5b — Emission is a consequence of PRODUCTION, not placement: when the
// deposits run dry the line winds down to zero on its own and the cloud
// decays away behind it.
// =============================================================================
TEST(depleted_line_winds_emission_down_to_zero) {
  BuildableNetwork net;
  en::EnemyTuning t;  // defaults: decay 0.0025, prune 0.05
  Scene sc = buildScene(net, t, /*depositUnits=*/40);

  net.stepN(60 * 60);  // 60 windows; deposits die near window 21
  const double m60 = net.enemySim().field().totalMass();
  net.stepN(60 * 30);
  const double m90 = net.enemySim().field().totalMass();

  CHECK(net.minerDepleted(sc.drillA));
  CHECK(net.minerDepleted(sc.drillB));
  CHECK(net.pollutionReport().producedPerSecond == 0.0);
  for (const en::Emitter& e : net.enemySim().emitters())
    CHECK(e.ratePerSecond == 0.0);
  CHECK(m90 < m60);  // nothing feeds the field; decay is winning
  CHECK(net.producedCountOf(kIngot) > 0);  // it DID produce before dying
}

// =============================================================================
// §6 — THE WAVE ARRIVES AT THE MACHINE THAT CAUSED IT, through the real
// pipeline: drill -> belt -> electric smelter, generator burning coal, cloud
// diffusing to a nest 150 m east of the power cluster, and the dispatched
// wave targeting the GENERATOR's emitter at the generator's own direction —
// the dominant polluter of the cluster's cell.
// =============================================================================
TEST(wave_targets_the_generator_that_fed_the_nest) {
  BuildableNetwork net;
  en::EnemyTuning t;
  t.attackThresholdPollution = 120.0;
  t.attackCooldownTicks = 600;
  Scene sc = buildScene(net, t);

  // Premise: the three electric-cluster machines share one pollution cell, so
  // the cell's plurality source is the generator (2.0/s > 1.0 > 0.6).
  const en::PollutionField& f = net.enemySim().field();
  const en::CellKey clusterCell =
      f.cellOf(net.surfaceDirOfLocal(600.5f, 0.0f, 0.5f));
  CHECK(f.cellOf(net.surfaceDirOfLocal(599.0f, 0.0f, 0.0f)) == clusterCell);
  CHECK(f.cellOf(net.surfaceDirOfLocal(600.5f, 0.0f, -0.5f)) == clusterCell);

  const Vec3 nestDir = net.surfaceDirOfLocal(750.0f, 0.0f, 0.0f);
  net.enemySim().addNest(nestDir);

  int windows = 0;
  while (windows < 260 && net.enemySim().pendingWaves().empty()) {
    net.stepN(60);
    ++windows;
  }
  std::printf("    [wave]  dispatched after %d windows\n", windows);

  CHECK(!net.enemySim().pendingWaves().empty());
  const en::AttackWave& w = net.enemySim().pendingWaves().front();
  const double R = forge().radiusM;
  // Origin: the nest. Target: the generator's OWN direction — the wave
  // arrives at the part of the base that caused it.
  CHECK(en::chordDistanceM(w.originDir, nestDir, R) < 1.0);
  CHECK(w.targetEmitter == net.generatorEmitterOf(sc.gen));
  CHECK(en::chordDistanceM(
            w.targetDir, net.surfaceDirOfLocal(600.5f, 0.0f, 0.5f), R) < 10.0);
  CHECK(w.totalCount > 0);
  // The loop is CLOSED: production polluted, a nest ate it, evolution rose
  // from the pollution term, all through the real factory.
  CHECK(net.evolutionState().fromPollution > 0.0);
  CHECK(net.evolutionState().pollutionAbsorbed > 0.0);
}

// =============================================================================
// §7 — PERSISTENCE. The joined state (field, nests, waves, evolution,
// emitters, and the machine->emitter joins) round-trips through the enemies.h
// §10 cursor idiom: rebuild the factory by replaying the same construction,
// deserialize, and the state hash is bit-identical, every join lands on the
// SAME emitter id (so nest source credits still point at the same machines),
// and a re-serialize is byte-identical. The resumed run keeps emitting into
// the restored field through the restored emitter ids.
// =============================================================================
TEST(joined_state_round_trips_and_rebinds) {
  en::EnemyTuning t;  // defaults
  BuildableNetwork a;
  Scene sa = buildScene(a, t);
  a.stepN(1200);  // 20 windows: field populated, credits accrued

  of::persist::SaveWriter w;
  a.serializePollution(w);

  BuildableNetwork b;
  Scene sb = buildScene(b, t);  // the replay: identical construction sequence
  of::persist::SaveReader r(w.bytes());
  CHECK(b.deserializePollution(r));

  CHECK(b.pollutionRebindMisses() == 0);
  CHECK(b.enemySim().stateHash() == a.enemySim().stateHash());
  CHECK(b.enemySim().emitters().size() == 5);  // adopted, not duplicated
  CHECK(b.pollutionEmitterOf(sb.drillA) == a.pollutionEmitterOf(sa.drillA));
  CHECK(b.pollutionEmitterOf(sb.s1) == a.pollutionEmitterOf(sa.s1));
  CHECK(b.pollutionEmitterOf(sb.s2) == a.pollutionEmitterOf(sa.s2));
  CHECK(b.generatorEmitterOf(sb.gen) == a.generatorEmitterOf(sa.gen));

  // Byte-identical re-serialize: the load lost nothing the save wrote.
  of::persist::SaveWriter w2;
  b.serializePollution(w2);
  CHECK(w2.bytes() == w.bytes());

  // And the resumed world keeps LIVING: the rebuilt factory works, feeds the
  // restored emitters, and the restored field grows from where it left off.
  const double massAtLoad = b.enemySim().field().totalMass();
  b.stepN(60 * 5);
  CHECK(b.pollutionReport().producedPerSecond > 0.0);
  CHECK(b.enemySim().field().totalMass() > massAtLoad);
  CHECK(b.enemySim().emitters().size() == 5);  // still no duplicate minting
}

// =============================================================================
// §8 — COST OF THE JOINED SYSTEM at the DW-28 scale (1,200 emitting machines:
// 600 drills + 600 smelters, plus their 600 inserters), measured against the
// same factory with enemies OFF. The enemies-side baseline on this scene
// shape was 8.04 us/sim-tick (test_enemies perf_cost, 1,200 machines); the
// DELTA here is that field cost plus the whole integration (emitter refresh
// once per window + one uint64 add per working entity per tick).
// =============================================================================
namespace {
struct JoinedCost {
  double usPerTick = 0.0;
  size_t cells = 0;
  double mass = 0.0;
};

JoinedCost measureJoined(bool enemiesOn, int pairs, int seconds) {
  BuildableNetwork net;
  if (enemiesOn) net.enableEnemies(forge(), kSeed, baseDir());
  for (int i = 0; i < pairs; ++i) {
    const float x = 10.0f * static_cast<float>(i % 40);
    const float z = 10.0f * static_cast<float>(i / 40);
    BuildId d = net.placeMinerOnDeposit(10000000ull, kOre, 2.0, 50);
    net.setPlacement(d, 0x10, x, 0.0f, z);
    BuildId s = net.placeSmelter(kOre, kIngot, 60, 0, 0);
    net.setPlacement(s, 0x12, x + 5.0f, 0.0f, z);
    net.connect(d, s);
  }
  if (enemiesOn) {
    for (int i = 0; i < 12; ++i)
      net.enemySim().addNest(net.surfaceDirOfLocal(
          2000.0f + 600.0f * static_cast<float>(i), 0.0f,
          static_cast<float>((i % 3) * 900 - 900)));
  }
  const uint64_t ticks = static_cast<uint64_t>(seconds) * 60u;
  const auto t0 = std::chrono::steady_clock::now();
  net.stepN(ticks);
  const auto t1 = std::chrono::steady_clock::now();
  JoinedCost c;
  c.usPerTick = static_cast<double>(
                    std::chrono::duration_cast<std::chrono::microseconds>(
                        t1 - t0).count()) /
                static_cast<double>(ticks);
  if (enemiesOn) {
    c.cells = net.enemySim().field().activeCells();
    c.mass = net.enemySim().field().totalMass();
  }
  return c;
}
}  // namespace

TEST(joined_cost_at_1200_machines) {
  const int kPairs = 600;    // 1,200 emitting machines
  const int kSeconds = 600;  // ten simulated minutes, the enemies-suite shape
  const JoinedCost off = measureJoined(false, kPairs, kSeconds);
  const JoinedCost on = measureJoined(true, kPairs, kSeconds);
  const double delta = on.usPerTick - off.usPerTick;
  std::printf(
      "    [cost]  1200 machines, 600 s: factory alone %.3f us/tick, joined "
      "%.3f us/tick, delta %.3f us/tick (%zu cells, %.0f in field)\n",
      off.usPerTick, on.usPerTick, delta, on.cells, on.mass);
  CHECK(on.cells > 0);   // the joined run really polluted
  CHECK(on.mass > 0.0);
  // The gate is deliberately loose (a floor on sanity, not a benchmark — the
  // printed number is the deliverable): the whole enemies loop plus the
  // integration must stay well under one millisecond per tick.
  CHECK(delta < 200.0);
}
