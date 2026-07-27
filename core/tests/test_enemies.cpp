// =============================================================================
// test_enemies.cpp — the pollution / evolution / nest-attack loop (W11 lane E).
//
// The project standard: a claim without a number is an opinion, and a test that
// cannot fail is not a test. The five load-bearing suites here are
//
//   1. DIFFUSION PINNED TO HAND ARITHMETIC. After one and two pollution ticks
//      from a single 1,000-unit source with D = 0.02 and decay = 0.01, the
//      values at distance 0, 1, 2 and diagonal are asserted against numbers
//      derived on paper (D*A*(1-k), D^2*A*(1-k)^2, 2*D^2*A*(1-k)^2), not
//      against a previous run of the same code.
//
//   2. EVOLUTION ISOLATED. Each of the three inputs is exercised with the other
//      two held at zero, so no term can be carrying another's credit.
//
//   3. THE NEGATIVE CONTROL. A world with nests and NO pollution dispatches
//      nothing, for thirty simulated minutes, while evolution provably rises
//      from its time term so the run cannot be silently doing nothing (DW-20).
//      This is the test that catches a wave timer wearing a pollution costume.
//
//   4. DETERMINISM (standing rule 4). Same seed, same ops, bit-identical state
//      hash; and a save/load resumes to a bit-identical hash.
//
//   5. COST AT A REALISTIC SCALE. Measured at 1,200 machines, which is where
//      DW-28 found the triangle budget binding, not at three machines.
// =============================================================================
#include <chrono>
#include <cmath>
#include <cstdio>
#include <utility>
#include <vector>

#include "of/cubed_sphere.h"
#include "of/enemies.h"
#include "of/persistence.h"
#include "test_framework.h"

using of::Vec3;
using namespace of::enemies;

namespace {

constexpr uint64_t kSeed = 0x0bf00d01ull;  // the project's default world seed

of::worldgen::BodyParams forge() { return of::worldgen::makeForge(kSeed); }

// A reference spot on the +Z face, well away from any cube seam.
Vec3 baseDir() { return unitOf(Vec3(0.1, 0.05, 1.0)); }

// Step `eastM` / `northM` metres from a surface direction. Chord step, which at
// these scales differs from a great circle by millimetres, and needs no
// transcendental (so the test is as portable as the header).
Vec3 offsetM(const Vec3& base, double eastM, double northM, double radiusM) {
  Vec3 axis(0, 1, 0);
  if (std::fabs(base.y) > 0.999) axis = Vec3(1, 0, 0);
  const Vec3 east = unitOf(crossOf(axis, base));
  const Vec3 north = crossOf(base, east);
  return unitOf(Vec3(base.x * radiusM + east.x * eastM + north.x * northM,
                     base.y * radiusM + east.y * eastM + north.y * northM,
                     base.z * radiusM + east.z * eastM + north.z * northM));
}

// A tuning with round numbers, so the diffusion arithmetic is hand-checkable.
EnemyTuning handTuning() {
  EnemyTuning t;
  t.diffusionRate = 0.02;
  t.decayRate = 0.01;
  t.pruneEpsilon = 0.0;  // nothing is dropped, so mass accounting is exact
  return t;
}

uint32_t countWaveEnemies(const std::vector<AttackWave>& waves) {
  uint32_t n = 0;
  for (const AttackWave& w : waves) n += w.totalCount;
  return n;
}

}  // namespace

// =============================================================================
// §1 — The lattice. A spatial index, with its geometry measured rather than
//      assumed.
// =============================================================================
TEST(lattice_resolution_and_round_trip) {
  const of::worldgen::BodyParams body = forge();
  EnemyTuning t;
  PollutionField f(body, t);

  // 200 m target on a 600 km body resolves to 2^13 cells per face side.
  CHECK(f.cellBits() == 13);
  CHECK(f.cellsPerFaceSide() == 8192u);
  CHECK_NEAR(f.cellSizeAtFaceCentreM(), 146.484375, 1e-9);  // 2R / 8192

  // Cinder is a third the radius, so it lands one level shallower and stays in
  // the same physical ballpark rather than getting 3x finer cells.
  PollutionField fc(of::worldgen::makeCinder(kSeed), t);
  CHECK(fc.cellBits() == 11);
  CHECK_NEAR(fc.cellSizeAtFaceCentreM(), 195.3125, 1e-9);

  // dir -> cell -> centre -> cell is a fixed point.
  const CellKey k = f.cellOf(baseDir());
  CHECK(f.cellOf(f.cellCentreDir(k)) == k);

  // 512 scattered directions all round-trip, including near the poles.
  int roundTripped = 0;
  for (int i = 0; i < 512; ++i) {
    const uint64_t h = of::worldgen::mix64(static_cast<uint64_t>(i));
    const Vec3 d = unitOf(Vec3(of::worldgen::hashToSigned(h),
                               of::worldgen::hashToSigned(of::worldgen::mix64(h)),
                               of::worldgen::hashToSigned(of::worldgen::mix64(h + 7))));
    const CellKey c = f.cellOf(d);
    if (f.cellOf(f.cellCentreDir(c)) == c) ++roundTripped;
  }
  CHECK(roundTripped == 512);
}

TEST(lattice_neighbours_and_the_gnomonic_non_uniformity) {
  const of::worldgen::BodyParams body = forge();
  PollutionField f(body, EnemyTuning());

  // Interior: the four neighbours are exactly the integer neighbours.
  const CellKey k = f.cellOf(baseDir());
  const int face = PollutionField::keyFace(k);
  const uint32_t i = PollutionField::keyI(k), j = PollutionField::keyJ(k);
  CellKey nb[4];
  f.neighbours(k, nb);
  CHECK(nb[0] == PollutionField::packKey(face, i + 1, j));
  CHECK(nb[1] == PollutionField::packKey(face, i - 1, j));
  CHECK(nb[2] == PollutionField::packKey(face, i, j + 1));
  CHECK(nb[3] == PollutionField::packKey(face, i, j - 1));

  // At a face edge the stepped neighbour lands on a DIFFERENT face, which is
  // the whole reason neighbours() steps geometrically instead of clamping.
  const CellKey edge = PollutionField::packKey(0, f.cellsPerFaceSide() - 1, 4000);
  f.neighbours(edge, nb);
  CHECK(PollutionField::keyFace(nb[0]) != 0);
  CHECK(PollutionField::keyFace(nb[1]) == 0);  // inward step stays home

  // EN-2's price, measured. The lattice bins the RAW gnomonic coordinate, so a
  // cell at a face CORNER is smaller than one at the face CENTRE. Publish the
  // ratio rather than hand-waving it: this is the cost of being
  // transcendental-free instead of equal-angle.
  const uint32_t n = f.cellsPerFaceSide();
  const Vec3 c0 = f.cellCentreDir(PollutionField::packKey(0, n / 2, n / 2));
  const Vec3 c0b = f.cellCentreDir(PollutionField::packKey(0, n / 2 + 1, n / 2));
  const Vec3 c1 = f.cellCentreDir(PollutionField::packKey(0, n - 1, n - 1));
  const Vec3 c1b = f.cellCentreDir(PollutionField::packKey(0, n - 2, n - 1));
  const double centreM = chordDistanceM(c0, c0b, body.radiusM);
  const double cornerM = chordDistanceM(c1, c1b, body.radiusM);
  const double ratio = centreM / cornerM;
  std::printf(
      "    [lattice] cell edge: face centre %.3f m, face corner %.3f m, "
      "ratio %.4fx\n",
      centreM, cornerM, ratio);
  // Analytic: the gnomonic linear scale is sqrt(1+wv^2)/(1+wu^2+wv^2), so the
  // corner-to-centre ratio tends to 3/sqrt(2) = 2.1213.
  CHECK_NEAR(ratio, 3.0 / std::sqrt(2.0), 0.01);
}

// =============================================================================
// §2 — DIFFUSION, PINNED TO HAND ARITHMETIC.
//
// Scatter form: a cell hands D*A to each of 4 neighbours and keeps (1-4D)*A,
// then everything is multiplied by (1-k). With A = 1000, D = 0.02, k = 0.01:
//
//   tick 1   source     1000 * (1 - 0.08) * 0.99            = 910.8
//            distance 1 1000 * 0.02 * 0.99                  =  19.8
//            distance 2 0
//   tick 2   source     (910.8*0.92 + 4*0.02*19.8) * 0.99   = 831.1248
//            distance 1 (19.8*0.92 + 0.02*910.8) * 0.99     =  36.06768
//            distance 2 (0.02*19.8) * 0.99                  =   0.39204
//            diagonal   (2 * 0.02*19.8) * 0.99              =   0.78408
//
// Every one of those six numbers is derived above, on paper, from D, k and A.
// None of them is read out of a previous run.
// =============================================================================
TEST(diffusion_matches_hand_computed_values) {
  PollutionField f(forge(), handTuning());
  const CellKey s = f.cellOf(baseDir());
  const int face = PollutionField::keyFace(s);
  const uint32_t i = PollutionField::keyI(s), j = PollutionField::keyJ(s);
  f.deposit(s, 1000.0, 1);
  CHECK_NEAR(f.amountAt(s), 1000.0, 0.0);

  f.diffuseAndDecay();
  CHECK_NEAR(f.amountAt(s), 910.8, 1e-9);
  CHECK_NEAR(f.amountAt(PollutionField::packKey(face, i + 1, j)), 19.8, 1e-9);
  CHECK_NEAR(f.amountAt(PollutionField::packKey(face, i - 1, j)), 19.8, 1e-9);
  CHECK_NEAR(f.amountAt(PollutionField::packKey(face, i, j + 1)), 19.8, 1e-9);
  CHECK_NEAR(f.amountAt(PollutionField::packKey(face, i, j - 1)), 19.8, 1e-9);
  // Nothing has reached distance 2 yet, and that is a real assertion: a scheme
  // that leaked further in one step would be over-diffusing.
  CHECK_NEAR(f.amountAt(PollutionField::packKey(face, i + 2, j)), 0.0, 0.0);
  CHECK(f.activeCells() == 5);

  f.diffuseAndDecay();
  CHECK_NEAR(f.amountAt(s), 831.1248, 1e-9);
  CHECK_NEAR(f.amountAt(PollutionField::packKey(face, i + 1, j)), 36.06768, 1e-9);
  CHECK_NEAR(f.amountAt(PollutionField::packKey(face, i + 2, j)), 0.39204, 1e-12);
  CHECK_NEAR(f.amountAt(PollutionField::packKey(face, i - 2, j)), 0.39204, 1e-12);
  CHECK_NEAR(f.amountAt(PollutionField::packKey(face, i + 1, j + 1)), 0.78408, 1e-12);
  CHECK_NEAR(f.amountAt(PollutionField::packKey(face, i - 1, j + 1)), 0.78408, 1e-12);
  CHECK(f.activeCells() == 13);  // 1 + 4 + 4 straight-2 + 4 diagonals
}

TEST(diffusion_conserves_mass_up_to_decay) {
  PollutionField f(forge(), handTuning());
  f.deposit(f.cellOf(baseDir()), 1000.0, 1);
  for (int k = 0; k < 30; ++k) f.diffuseAndDecay();
  // Closed form: nothing is created or destroyed except by the decay factor.
  const double expected = 1000.0 * std::pow(0.99, 30.0);
  std::printf("    [diffusion] mass after 30 ticks %.9f, closed form %.9f, %zu cells\n",
              f.totalMass(), expected, f.activeCells());
  CHECK_NEAR(f.totalMass(), expected, 1e-6);
  CHECK(f.activeCells() > 1000);  // the cloud really did spread
}

TEST(diffusion_conserves_mass_across_a_cube_seam) {
  // A cloud straddling a cube-face edge is where a naive integer neighbour
  // table silently reflects pollution back. Scatter form conserves mass even
  // where the neighbour relation is asymmetric; that is why it was chosen.
  PollutionField f(forge(), handTuning());
  const CellKey edge = PollutionField::packKey(0, f.cellsPerFaceSide() - 1, 4000);
  f.deposit(edge, 1000.0, 1);
  for (int k = 0; k < 25; ++k) f.diffuseAndDecay();
  const double expected = 1000.0 * std::pow(0.99, 25.0);
  int faces[6] = {0, 0, 0, 0, 0, 0};
  for (const PollutionCellView& c : f.cells()) ++faces[PollutionField::keyFace(c.key)];
  std::printf(
      "    [seam] mass %.9f vs closed form %.9f; cells per face "
      "%d/%d/%d/%d/%d/%d\n",
      f.totalMass(), expected, faces[0], faces[1], faces[2], faces[3], faces[4],
      faces[5]);
  CHECK_NEAR(f.totalMass(), expected, 1e-6);
  // The cloud genuinely crossed onto a second face, so the conservation claim
  // above is not vacuously true of a cloud that stayed put.
  int occupied = 0;
  for (int i = 0; i < 6; ++i)
    if (faces[i] > 0) ++occupied;
  CHECK(occupied >= 2);
}

TEST(pruning_bounds_the_cloud_and_absorption_is_a_sink) {
  EnemyTuning t = handTuning();
  t.pruneEpsilon = 1.0;
  PollutionField f(forge(), t);
  f.deposit(f.cellOf(baseDir()), 1000.0, 1);
  for (int k = 0; k < 30; ++k) f.diffuseAndDecay();
  const double unpruned = 1000.0 * std::pow(0.99, 30.0);
  // Pruning is the cost bound, and it is LOSSY on purpose: it trades a slice of
  // the cloud's thin outer tail for a hard ceiling on active-cell count. The
  // numbers below are the measured cost of that trade at pruneEpsilon = 1.0 on
  // a 1,000-unit point source, which is a deliberately harsh case (a real base
  // emits continuously, so its tail is replenished every tick).
  std::printf(
      "    [prune] eps 1.0: %.3f of %.3f units kept (%.1f%%) in %zu cells; "
      "unpruned was 1861 cells\n",
      f.totalMass(), unpruned, 100.0 * f.totalMass() / unpruned,
      f.activeCells());
  CHECK(f.totalMass() < unpruned);
  CHECK(f.totalMass() > unpruned * 0.55);
  CHECK(f.activeCells() < 700);

  // take() removes from the field: a nest is a genuine sink, which is what
  // makes distance from a nest a real mitigation.
  const CellKey s = f.cellOf(baseDir());
  const double before = f.amountAt(s);
  EmitterId src = kNoEmitter;
  double attributed = 0.0;
  const double took = f.take(s, 25.0, src, attributed);
  CHECK_NEAR(took, 25.0, 1e-12);
  CHECK_NEAR(f.amountAt(s), before - 25.0, 1e-9);
  CHECK(src == 1u);
  CHECK(attributed > 0.0);
}

// =============================================================================
// §3 — EVOLUTION. Three inputs, isolated one at a time.
// =============================================================================
namespace {
EnemyTuning evoOnly(double timeF, double pollF, double killF) {
  EnemyTuning t;
  t.evoTimeFactorPerSecond = timeF;
  t.evoPollutionFactorPerUnit = pollF;
  t.evoKillFactorPerNest = killF;
  return t;
}
}  // namespace

TEST(evolution_time_term_isolated) {
  // Pollution and kill factors zero. No emitters at all. Only time moves.
  EnemySim sim(forge(), kSeed, evoOnly(2.4e-4, 0.0, 0.0));
  sim.addNest(offsetM(baseDir(), 3000, 0, forge().radiusM));
  sim.step(60 * 600);  // 600 simulated seconds
  const EvolutionState& e = sim.evolution();
  std::printf("    [evo/time] factor %.9f = time %.9f + poll %.9f + kills %.9f\n",
              e.factor, e.fromTime, e.fromPollution, e.fromKills);
  CHECK(e.fromTime > 0.0);
  CHECK(e.fromPollution == 0.0);
  CHECK(e.fromKills == 0.0);
  CHECK_NEAR(e.secondsElapsed, 600.0, 1e-9);
  // Closed form for the continuous limit: 1/(1-f) - 1 = rate * t, so after
  // 600 s at 2.4e-4 the factor is 0.144/1.144 = 0.12587. The discrete sum is
  // slightly under because each step uses the factor at the START of the step.
  CHECK_NEAR(e.factor, 0.144 / 1.144, 2e-3);
}

TEST(evolution_pollution_term_isolated) {
  // Time and kill factors zero. The ONLY way the factor can move is by a nest
  // absorbing pollution, so a non-zero result is proof the loop is closed.
  EnemyTuning t = evoOnly(0.0, 1.2e-5, 0.0);
  EnemySim sim(forge(), kSeed, t);
  const double R = forge().radiusM;
  for (int i = 0; i < 8; ++i)
    sim.addEmitter(offsetM(baseDir(), i * 40.0, 0.0, R), 12.0);
  sim.addNest(offsetM(baseDir(), 400.0, 0.0, R));
  sim.step(60 * 600);
  const EvolutionState& e = sim.evolution();
  std::printf("    [evo/poll] factor %.9f, absorbed %.3f over %.0f s\n", e.factor,
              e.pollutionAbsorbed, e.secondsElapsed);
  CHECK(e.fromTime == 0.0);
  CHECK(e.fromKills == 0.0);
  CHECK(e.fromPollution > 0.0);
  CHECK(e.pollutionAbsorbed > 0.0);
  CHECK(e.factor == e.fromPollution);
}

TEST(evolution_kill_term_isolated) {
  EnemyTuning t = evoOnly(0.0, 0.0, 2.0e-3);
  EnemySim sim(forge(), kSeed, t);
  const double R = forge().radiusM;
  std::vector<NestId> ids;
  for (int i = 0; i < 10; ++i)
    ids.push_back(sim.addNest(offsetM(baseDir(), 3000.0 + i * 800.0, 0.0, R)));
  sim.step(120);
  CHECK(sim.evolution().factor == 0.0);  // nothing has happened yet
  for (NestId id : ids) CHECK(sim.destroyNest(id));
  sim.step(120);
  const EvolutionState& e = sim.evolution();
  std::printf("    [evo/kill] factor %.9f after %llu kills\n", e.factor,
              static_cast<unsigned long long>(e.nestsDestroyed));
  CHECK(e.nestsDestroyed == 10u);
  CHECK(e.fromTime == 0.0);
  CHECK(e.fromPollution == 0.0);
  CHECK(e.fromKills > 0.0);
  // 10 kills at 2e-3 with the (1-f)^2 damping applied once, all in one step.
  CHECK_NEAR(e.factor, 0.02, 1e-9);
  // Destroying an already-dead nest must not double-count.
  for (NestId id : ids) CHECK(!sim.destroyNest(id));
  sim.step(120);
  CHECK(sim.evolution().nestsDestroyed == 10u);
}

TEST(evolution_zero_control_and_the_produced_versus_absorbed_distinction) {
  // (a) With all three factors zero, nothing moves. If this ever fails, some
  //     term has a hidden constant in it.
  {
    EnemySim sim(forge(), kSeed, evoOnly(0.0, 0.0, 0.0));
    const double R = forge().radiusM;
    for (int i = 0; i < 20; ++i)
      sim.addEmitter(offsetM(baseDir(), i * 30.0, 0.0, R), 20.0);
    sim.addNest(offsetM(baseDir(), 500.0, 0.0, R));
    sim.step(60 * 600);
    CHECK(sim.evolution().factor == 0.0);
    CHECK(sim.evolution().pollutionAbsorbed > 0.0);  // the run DID run
  }
  // (b) EN-4, the deliberate deviation from Factorio, made mechanical: with a
  //     heavily polluting base and NO nest anywhere, the pollution term is
  //     exactly zero. Pollution PRODUCED evolves nothing; pollution ABSORBED
  //     does. This is what makes distance and nest-clearing real mitigations.
  {
    EnemySim sim(forge(), kSeed, evoOnly(0.0, 1.2e-5, 0.0));
    const double R = forge().radiusM;
    for (int i = 0; i < 50; ++i)
      sim.addEmitter(offsetM(baseDir(), i * 30.0, 0.0, R), 40.0);
    sim.step(60 * 600);
    CHECK(sim.pollutionPerSecond() == 2000.0);
    CHECK(sim.field().totalMass() > 0.0);  // pollution definitely exists
    CHECK(sim.evolution().pollutionAbsorbed == 0.0);
    CHECK(sim.evolution().fromPollution == 0.0);
    CHECK(sim.evolution().factor == 0.0);
  }
}

TEST(evolution_is_monotone_bounded_and_exactly_decomposed) {
  EnemySim sim(forge(), kSeed);  // shipped defaults, all three inputs live
  const double R = forge().radiusM;
  for (int i = 0; i < 40; ++i)
    sim.addEmitter(offsetM(baseDir(), (i % 8) * 50.0, (i / 8) * 50.0, R), 6.0);
  std::vector<NestId> nests;
  for (int i = 0; i < 6; ++i)
    nests.push_back(sim.addNest(offsetM(baseDir(), 600.0 + i * 300.0, 400.0, R)));

  double last = -1.0;
  int violations = 0;
  int decompositionBreaks = 0;
  for (int block = 0; block < 400; ++block) {
    sim.step(120);
    if (block == 150)
      for (size_t i = 0; i < 3; ++i) sim.destroyNest(nests[i]);
    const EvolutionState& e = sim.evolution();
    if (e.factor < last) ++violations;
    // The UI's breakdown must be a decomposition, not an estimate: bit-exact.
    if (e.factor != e.fromTime + e.fromPollution + e.fromKills)
      ++decompositionBreaks;
    if (e.factor >= 1.0) ++violations;
    last = e.factor;
  }
  const EvolutionState& e = sim.evolution();
  std::printf(
      "    [evo/all] factor %.6f = time %.6f + poll %.6f + kills %.6f "
      "(absorbed %.0f, %llu kills)\n",
      e.factor, e.fromTime, e.fromPollution, e.fromKills, e.pollutionAbsorbed,
      static_cast<unsigned long long>(e.nestsDestroyed));
  CHECK(violations == 0);
  CHECK(decompositionBreaks == 0);
  CHECK(e.factor > 0.0 && e.factor < 1.0);
  CHECK(e.fromTime > 0.0 && e.fromPollution > 0.0 && e.fromKills > 0.0);
}

TEST(evolution_gates_the_roster_and_publishes_the_next_unlock) {
  EnemyCatalogue cat;
  // At evolution 0 only the Skitterer exists.
  int unlockedAtZero = 0, unlockedAtHalf = 0, unlockedAtNine = 0;
  for (const EnemyTypeDef& d : cat.types()) {
    if (weightAtEvolution(d, 0.0) > 0.0) ++unlockedAtZero;
    if (weightAtEvolution(d, 0.5) > 0.0) ++unlockedAtHalf;
    if (weightAtEvolution(d, 0.9) > 0.0) ++unlockedAtNine;
  }
  CHECK(unlockedAtZero == 1);
  CHECK(unlockedAtHalf == 4);
  CHECK(unlockedAtNine == 5);
  CHECK(weightAtEvolution(*cat.type(types::Colossus), 0.79) == 0.0);
  CHECK(weightAtEvolution(*cat.type(types::Colossus), 0.81) > 0.0);
  // The Skitterer fades but never disappears, so a late-game nest can always
  // spend a small budget on something.
  CHECK(weightAtEvolution(*cat.type(types::Skitterer), 0.95) > 0.0);
  CHECK(weightAtEvolution(*cat.type(types::Skitterer), 0.95) <
        weightAtEvolution(*cat.type(types::Skitterer), 0.30));

  // The legibility contract: a UI can always say what comes next and when.
  EnemyTypeId id = kNoEnemyType;
  double at = 0.0;
  CHECK(cat.nextUnlock(0.0, id, at));
  CHECK(id == types::Ravager);
  CHECK_NEAR(at, 0.20, 1e-12);
  CHECK(cat.nextUnlock(0.55, id, at));
  CHECK(id == types::Colossus);
  CHECK(!cat.nextUnlock(0.99, id, at));

  // Content is DATA and extension is append-only.
  EnemyTypeDef extra;
  extra.id = 0x0A;
  extra.name = "Test";
  CHECK(cat.registerType(extra));
  CHECK(!cat.registerType(extra));  // never reuse/override an id
  CHECK(cat.types().size() == 6);
}

// =============================================================================
// §4 — ATTACK WAVES, and the negative control that is the point of the file.
// =============================================================================
TEST(attacks_come_from_the_nest_that_absorbed_and_only_from_it) {
  EnemySim sim(forge(), kSeed);
  const double R = forge().radiusM;
  for (int i = 0; i < 20; ++i)
    sim.addEmitter(offsetM(baseDir(), (i % 5) * 60.0, (i / 5) * 60.0, R), 6.0);
  const NestId nearNest = sim.addNest(offsetM(baseDir(), 600.0, 0.0, R));
  const NestId farNest = sim.addNest(offsetM(baseDir(), 25000.0, 0.0, R));
  sim.step(60 * 400);

  const std::vector<AttackWave>& waves = sim.pendingWaves();
  int fromNear = 0, fromFar = 0;
  for (const AttackWave& w : waves) {
    if (w.sourceNest == nearNest) ++fromNear;
    if (w.sourceNest == farNest) ++fromFar;
  }
  std::printf("    [waves] %zu waves, %u enemies; near nest %d, far nest %d\n",
              waves.size(), countWaveEnemies(waves), fromNear, fromFar);
  CHECK(fromNear >= 1);
  // THE NEGATIVE CONTROL, first form: the nest 25 km away absorbed exactly
  // nothing, so it must have sent exactly nothing.
  CHECK(fromFar == 0);
  CHECK(sim.nest(farNest)->absorbedLifetime == 0.0);
  CHECK(sim.nest(nearNest)->absorbedLifetime > 0.0);
  // Every wave carries the numbers the combat lane needs.
  for (const AttackWave& w : waves) {
    CHECK(w.totalCount > 0);
    CHECK(w.totalHealth > 0.0);
    CHECK(w.slowestSpeedMps > 0.0);
    CHECK(w.pollutionSpent > 0.0);
    CHECK(w.targetEmitter != kNoEmitter);
  }
}

TEST(negative_control_no_pollution_means_no_waves_ever) {
  // THE test that separates a pollution loop from a wave timer in a costume.
  // Six nests, thirty simulated minutes, no emitters at all. Evolution rises
  // from its time term, which proves the run advanced (DW-20): a green probe
  // that never ran is worse than no probe.
  EnemySim sim(forge(), kSeed);
  const double R = forge().radiusM;
  for (int i = 0; i < 6; ++i)
    sim.addNest(offsetM(baseDir(), 800.0 + i * 400.0, 300.0, R));
  sim.step(60 * 60 * 30);

  std::printf(
      "    [negative] %llu ticks, evolution %.6f, %zu nests, %zu waves, "
      "field mass %.6f\n",
      static_cast<unsigned long long>(sim.tickIndex()), sim.evolution().factor,
      sim.nests().size(), sim.pendingWaves().size(), sim.field().totalMass());
  CHECK(sim.tickIndex() == 108000u);
  CHECK(sim.evolution().factor > 0.0);   // the sim really did advance
  CHECK(sim.evolution().fromTime > 0.0);
  CHECK(sim.pendingWaves().empty());     // and it attacked nobody
  CHECK(sim.field().totalMass() == 0.0);
  for (const Nest& n : sim.nests()) {
    CHECK(n.absorbedLifetime == 0.0);
    CHECK(n.attackBudget == 0.0);
    CHECK(n.wavesDispatched == 0u);
  }
}

TEST(negative_control_pollution_that_is_switched_off_stops_the_attacks) {
  // The complement: attacks that were happening must STOP when the player
  // stops polluting. A timer would keep firing.
  EnemySim sim(forge(), kSeed);
  const double R = forge().radiusM;
  std::vector<EmitterId> ids;
  for (int i = 0; i < 20; ++i)
    ids.push_back(sim.addEmitter(offsetM(baseDir(), (i % 5) * 60.0, (i / 5) * 60.0, R), 8.0));
  sim.addNest(offsetM(baseDir(), 600.0, 0.0, R));
  sim.step(60 * 400);
  const size_t during = sim.drainWaves().size();
  CHECK(during >= 1);

  for (EmitterId id : ids) CHECK(sim.setEmitterActive(id, false));
  CHECK(sim.pollutionPerSecond() == 0.0);
  // Let the residual cloud drain, then measure a clean window.
  sim.step(60 * 1800);
  sim.drainWaves();
  const double massAfterDrain = sim.field().totalMass();
  sim.step(60 * 1800);
  const size_t after = sim.pendingWaves().size();
  std::printf(
      "    [switch-off] %zu waves while polluting, field mass %.4f after "
      "drain, %zu waves in the clean 30 min window\n",
      during, massAfterDrain, after);
  CHECK(after == 0);
}

TEST(waves_target_the_emitter_that_fed_the_nest_not_the_nearest_one) {
  const double R = forge().radiusM;
  const Vec3 nestSpot = offsetM(baseDir(), 0.0, 2500.0, R);

  // A is 1.5 km from the nest, B is 3.5 km on the far side. Whichever one is
  // actually feeding the nest is the one the wave goes for.
  auto run = [&](const char* label, double rateA, double rateB,
                 EmitterId& outTarget) {
    EnemySim sim(forge(), kSeed);
    const EmitterId a = sim.addEmitter(offsetM(baseDir(), 0.0, 1000.0, R), rateA);
    const EmitterId b = sim.addEmitter(offsetM(baseDir(), 0.0, -1000.0, R), rateB);
    const NestId n = sim.addNest(nestSpot);
    // 1,500 s, not 900: a nest 3.5 km from a 220/s source absorbs only about
    // 1.2/s, so the far-only case needs real time to cross its 500 threshold.
    // That trickle is itself the mechanic working — distance is a mitigation.
    sim.step(60 * 1500);
    const std::vector<AttackWave>& w = sim.pendingWaves();
    outTarget = w.empty() ? kNoEmitter : w.front().targetEmitter;
    std::printf(
        "    [targeting] %-14s A(near,%6.1f/s)=%u B(far,%6.1f/s)=%u -> %zu "
        "waves, target %u, nest absorbed %.1f\n",
        label, rateA, a, rateB, b, w.size(), outTarget,
        sim.nest(n) != nullptr ? sim.nest(n)->absorbedLifetime : -1.0);
    return std::make_pair(a, b);
  };

  EmitterId target = kNoEmitter;
  // 1. Only the FAR emitter pollutes. A nearest-emitter heuristic would answer
  //    A; the right answer is B, because B is what reached the nest.
  auto ids = run("far-only", 0.0, 220.0, target);
  CHECK(target == ids.second);
  // 2. Only the NEAR emitter pollutes.
  ids = run("near-only", 220.0, 0.0, target);
  CHECK(target == ids.first);
  // 3. Both live, the far one 44x stronger: it still wins, because attribution
  //    follows what arrived rather than raw rate or raw distance.
  ids = run("5-vs-220", 5.0, 220.0, target);
  CHECK(target == ids.second);
  // 4. The mirror image, so case 3 cannot be passing by always answering B.
  ids = run("220-vs-5", 220.0, 5.0, target);
  CHECK(target == ids.first);
}

TEST(wave_size_scales_with_the_pollution_that_reached_the_nest) {
  // The claim under test is the design's core proportionality: attack strength
  // follows what reached the nest. Three confounders are removed so the number
  // means what it says — the absorption ceiling (raised), the wave-size ceiling
  // (raised), and nest expansion (maxNests = 1). What is left is budget.
  struct Outcome {
    double absorbed = 0.0;
    uint32_t enemies = 0;
    double health = 0.0;   // the number a defender actually has to chew through
    double evolution = 0.0;
  };
  auto run = [](double ratePerEmitter) {
    EnemyTuning t;
    t.nestAbsorptionPerSecond = 1000.0;
    t.maxWaveSize = 100000;
    t.maxNests = 1;
    EnemySim sim(forge(), kSeed, t);
    const double R = of::worldgen::makeForge(kSeed).radiusM;
    for (int i = 0; i < 10; ++i)
      sim.addEmitter(offsetM(baseDir(), i * 40.0, 0.0, R), ratePerEmitter);
    sim.addNest(offsetM(baseDir(), 300.0, 0.0, R));
    sim.step(60 * 600);
    Outcome o;
    o.absorbed = sim.evolution().pollutionAbsorbed;
    o.enemies = countWaveEnemies(sim.pendingWaves());
    o.evolution = sim.evolution().factor;
    for (const AttackWave& w : sim.pendingWaves()) o.health += w.totalHealth;
    return o;
  };
  const Outcome small = run(4.0);
  const Outcome large = run(40.0);
  const double absorbedRatio = large.absorbed / small.absorbed;
  const double enemyRatio =
      static_cast<double>(large.enemies) / static_cast<double>(small.enemies);
  const double healthRatio = large.health / small.health;
  std::printf(
      "    [scaling]   40 poll/s: absorbed %8.0f, evo %.3f -> %5u enemies, "
      "%9.0f hp\n"
      "    [scaling]  400 poll/s: absorbed %8.0f, evo %.3f -> %5u enemies, "
      "%9.0f hp\n"
      "    [scaling]  %.2fx pollution -> %.2fx enemies but %.2fx hp: the extra "
      "pollution buys QUALITY as well as quantity\n",
      small.absorbed, small.evolution, small.enemies, small.health,
      large.absorbed, large.evolution, large.enemies, large.health,
      absorbedRatio, enemyRatio, healthRatio);
  CHECK(small.enemies > 0);
  CHECK(absorbedRatio > 5.0);
  // Head count grows sub-linearly because the higher evolution shifts the
  // roster onto costlier types. That is the intended behaviour, so the linear
  // claim is made about the thing that actually matters to a defender.
  CHECK(enemyRatio > 3.0);
  CHECK(healthRatio > absorbedRatio);
  CHECK(large.evolution > small.evolution);
}

// =============================================================================
// §5 — SPREADING. The frontier moves, and it moves at the player.
// =============================================================================
TEST(nests_expand_toward_the_pollution) {
  EnemyTuning t;
  t.expansionCost = 300.0;
  t.expansionCooldownTicks = 600;
  t.expansionDistanceM = 900.0;
  t.minNestSeparationM = 200.0;
  EnemySim sim(forge(), kSeed, t);
  const double R = forge().radiusM;
  const Vec3 base = baseDir();
  for (int i = 0; i < 16; ++i)
    sim.addEmitter(offsetM(base, (i % 4) * 50.0, (i / 4) * 50.0, R), 10.0);
  // Deliberately off a compass bearing so "toward the base" is not free.
  const NestId parent = sim.addNest(offsetM(base, 2500.0, 1600.0, R));
  const double parentDist = chordDistanceM(sim.nest(parent)->dir, base, R);
  sim.step(60 * 1200);

  CHECK(sim.aliveNestCount() > 1);
  int closer = 0, generationOne = 0;
  double bestChild = parentDist;
  for (const Nest& n : sim.nests()) {
    if (n.id == parent) continue;
    if (n.generation >= 1) ++generationOne;
    const double d = chordDistanceM(n.dir, base, R);
    if (d < parentDist) ++closer;
    if (d < bestChild) bestChild = d;
  }
  std::printf(
      "    [spread] %u nests; parent at %.0f m from the base, closest child at "
      "%.0f m, %d children, %d closer\n",
      sim.aliveNestCount(), parentDist, bestChild,
      static_cast<int>(sim.nests().size()) - 1, closer);
  CHECK(generationOne >= 1);
  CHECK(closer >= 1);
  CHECK(bestChild < parentDist - 500.0);  // it really did advance on the base
  CHECK(sim.nestPlacementsRefused() == 0u);

  // Separation is honoured: no two live nests are stacked on top of each other.
  int tooClose = 0;
  for (size_t i = 0; i < sim.nests().size(); ++i)
    for (size_t j = i + 1; j < sim.nests().size(); ++j)
      if (chordDistanceM(sim.nests()[i].dir, sim.nests()[j].dir, R) <
          t.minNestSeparationM * 0.999)
        ++tooClose;
  CHECK(tooClose == 0);
}

TEST(nest_count_is_capped_and_the_cap_is_reported) {
  // DW-28: a resource that silently drops work when full is worse than one that
  // fails. maxNests refuses loudly.
  EnemyTuning t;
  t.maxNests = 3;
  EnemySim sim(forge(), kSeed, t);
  const double R = forge().radiusM;
  for (int i = 0; i < 6; ++i) sim.addNest(offsetM(baseDir(), i * 900.0, 0.0, R));
  CHECK(sim.nests().size() == 3u);
  CHECK(sim.nestPlacementsRefused() == 3u);
}

// =============================================================================
// §6 — DETERMINISM (standing rule 4) and persistence (DW-17).
// =============================================================================
namespace {
// The same scripted world, built twice. Any divergence is a determinism bug.
void buildScriptedWorld(EnemySim& sim) {
  const double R = of::worldgen::makeForge(kSeed).radiusM;
  const Vec3 base = baseDir();
  for (int i = 0; i < 32; ++i)
    sim.addEmitter(offsetM(base, (i % 8) * 45.0, (i / 8) * 45.0, R),
                   2.0 + static_cast<double>(i % 5));
  for (int i = 0; i < 5; ++i)
    sim.addNest(offsetM(base, 700.0 + i * 350.0, 250.0 * i, R));
}
void runScript(EnemySim& sim) {
  sim.step(60 * 200);
  sim.damageNest(2, 260.0);
  sim.step(60 * 200);
  sim.setEmitterRate(4, 30.0);
  sim.damageNest(2, 400.0);  // kills it
  sim.step(60 * 200);
  sim.setEmitterActive(7, false);
  sim.step(60 * 200);
}
}  // namespace

TEST(determinism_same_seed_same_ops_same_bits) {
  EnemySim a(forge(), kSeed);
  EnemySim b(forge(), kSeed);
  buildScriptedWorld(a);
  buildScriptedWorld(b);
  CHECK(a.stateHash() == b.stateHash());
  runScript(a);
  runScript(b);
  std::printf("    [determinism] state hash 0x%016llx over %zu cells, %zu waves\n",
              static_cast<unsigned long long>(a.stateHash()),
              a.field().activeCells(), a.pendingWaves().size());
  CHECK(a.stateHash() == b.stateHash());
  CHECK(a.evolution().factor == b.evolution().factor);
  CHECK(a.field().totalMass() == b.field().totalMass());
  CHECK(a.field().activeCells() == b.field().activeCells());
  // The run must have been substantial, or the hash equality is vacuous.
  CHECK(a.field().activeCells() > 200);
  CHECK(a.evolution().factor > 0.0);

  // A DIFFERENT seed must give a different composition, or the seed is dead
  // weight and the equality above proves nothing about determinism.
  EnemySim c(forge(), kSeed ^ 0xABCDEFull);
  buildScriptedWorld(c);
  runScript(c);
  CHECK(c.stateHash() != a.stateHash());
}

TEST(persistence_round_trip_and_resume_are_bit_exact) {
  EnemySim a(forge(), kSeed);
  buildScriptedWorld(a);
  a.step(60 * 500);
  a.damageNest(3, 120.0);
  a.step(60 * 300);

  of::persist::SaveWriter w;
  a.serialize(w);
  const std::vector<uint8_t> bytes = w.bytes();

  EnemySim b(forge(), kSeed);
  of::persist::SaveReader r(bytes);
  b.deserialize(r);

  std::printf("    [persist] %zu bytes for %zu cells / %zu nests / %zu emitters\n",
              bytes.size(), a.field().activeCells(), a.nests().size(),
              a.emitters().size());
  CHECK(bytes.size() > 1000);
  CHECK(b.stateHash() == a.stateHash());
  CHECK(b.evolution().factor == a.evolution().factor);
  CHECK(b.tickIndex() == a.tickIndex());

  // A world that forgets its evolution factor on reload is broken, so resume
  // and keep stepping: the two must stay bit-identical.
  a.step(60 * 400);
  b.step(60 * 400);
  CHECK(b.stateHash() == a.stateHash());
  CHECK(b.evolution().fromPollution == a.evolution().fromPollution);
  CHECK(b.pendingWaves().size() == a.pendingWaves().size());
  CHECK(a.evolution().factor > 0.0);  // there was something to forget
}

// =============================================================================
// §7 — THE REPORTS. If a player cannot see why they are being attacked, the
//      whole design fails, so the numbers a UI needs are asserted to exist and
//      to be self-consistent.
// =============================================================================
TEST(reports_make_the_loop_legible) {
  EnemySim sim(forge(), kSeed);
  const double R = forge().radiusM;
  for (int i = 0; i < 24; ++i)
    sim.addEmitter(offsetM(baseDir(), (i % 6) * 55.0, (i / 6) * 55.0, R), 5.0);
  for (int i = 0; i < 4; ++i)
    sim.addNest(offsetM(baseDir(), 900.0 + i * 500.0, -400.0, R));
  sim.step(60 * 900);

  const PollutionReport p = sim.pollutionReport();
  const uint32_t nestsNow = sim.aliveNestCount();
  std::printf(
      "    [report] produced %.1f/s, in field %.0f, absorbed %.2f/s by %u of %u "
      "nests, %u cells (%u visible), extent %.0f m, cell %.2f m\n",
      p.producedPerSecond, p.totalInField, p.absorbedPerSecond, p.absorbingNests,
      nestsNow, p.activeCells, p.visibleCells, p.extentM, p.cellSizeM);
  CHECK_NEAR(p.producedPerSecond, 120.0, 1e-12);
  CHECK(p.totalInField > 0.0);
  CHECK(p.activeCells > 0);
  CHECK(p.visibleCells > 0 && p.visibleCells <= p.activeCells);
  CHECK(p.extentM > 500.0);
  CHECK(p.absorbingNests >= 1 && p.absorbingNests <= nestsNow);
  CHECK(p.absorbedPerSecond > 0.0);
  CHECK_NEAR(p.cellSizeM, 146.484375, 1e-9);
  // The reported centroid really is where the base is.
  CHECK(chordDistanceM(p.centroidDir, baseDir(), R) < 300.0);

  // The four seeded nests have expanded under the default tuning, which is the
  // spreading loop showing up in a test that was not written to look for it.
  const std::vector<NestThreat> threats = sim.threatReport();
  CHECK(threats.size() == nestsNow);
  CHECK(nestsNow > 4);
  // Sorted most-imminent-first, so a HUD can just take the head.
  for (size_t i = 1; i < threats.size(); ++i)
    CHECK(threats[i - 1].fractionOfAttackThreshold >=
          threats[i].fractionOfAttackThreshold);
  CHECK(threats.front().absorbedLifetime > 0.0);
  CHECK(threats.front().angriestAt != kNoEmitter);
  std::printf(
      "    [report] top threat: nest %u at %.0f%% of its attack threshold, "
      "angry at emitter %u %.0f m away\n",
      threats.front().id, threats.front().fractionOfAttackThreshold * 100.0,
      threats.front().angriestAt, threats.front().distanceToTargetM);

  EnemyTypeId next = kNoEnemyType;
  double atEvo = 0.0;
  CHECK(sim.nextUnlock(next, atEvo));
  CHECK(atEvo > sim.evolution().factor);
}

TEST(machine_pollution_rates_are_a_data_table) {
  // The factory-sim hook (§11): a machine's pollution is a table row, so
  // balancing it is an edit to data rather than to code.
  CHECK_NEAR(pollutionRateForMachine(0x15), 6.0, 0.0);  // Generator, the worst
  CHECK_NEAR(pollutionRateForMachine(0x12), 2.0, 0.0);  // Smelter
  CHECK_NEAR(pollutionRateForMachine(0x11), 0.0, 0.0);  // Belt: none
  CHECK_NEAR(pollutionRateForMachine(0x16), 0.0, 0.0);  // Pole: none
  CHECK_NEAR(pollutionRateForMachine(0xFF), 0.0, 0.0);  // unknown: none
  CHECK(defaultMachinePollution().size() == 7);
  // Power generation is the dominant polluter, which is what makes "build more
  // power" the decision that brings the enemies.
  double worst = 0.0;
  uint16_t worstId = 0;
  for (const MachinePollutionRow& r : defaultMachinePollution())
    if (r.perSecond > worst) {
      worst = r.perSecond;
      worstId = r.machineTypeId;
    }
  CHECK(worstId == 0x15);
}

// =============================================================================
// §8 — COST, MEASURED AT A REALISTIC FACTORY SIZE.
//
// DW-28 found the triangle budget binding near 1,180 machines, so 1,200 is the
// scale that matters, not three. The claim being pinned is that cost is
// O(active pollution cells) and NOT O(machines): the second half of this test
// doubles the machine count in the same footprint and shows the per-tick cost
// barely moves, because a thousand machines in one cell are one cell.
// =============================================================================
namespace {
struct CostResult {
  double usPerSimTick = 0.0;
  size_t cells = 0;
  double massInField = 0.0;
  uint64_t ticks = 0;
};

CostResult measure(int machines, int seconds) {
  EnemySim sim(forge(), kSeed);
  const double R = of::worldgen::makeForge(kSeed).radiusM;
  const Vec3 base = baseDir();
  // A 400 m x 400 m base, which is roughly what 1,200 machines occupy.
  for (int i = 0; i < machines; ++i) {
    const int gx = i % 40, gy = i / 40;
    sim.addEmitter(offsetM(base, gx * 10.0, gy * 10.0, R),
                   pollutionRateForMachine(i % 7 == 0 ? 0x15 : 0x12));
  }
  for (int i = 0; i < 12; ++i)
    sim.addNest(offsetM(base, 2000.0 + i * 600.0, (i % 3) * 900.0 - 900.0, R));

  const uint64_t ticks = static_cast<uint64_t>(seconds) * 60u;
  const auto t0 = std::chrono::steady_clock::now();
  sim.step(ticks);
  const auto t1 = std::chrono::steady_clock::now();
  const double us =
      std::chrono::duration_cast<std::chrono::microseconds>(t1 - t0).count();

  CostResult r;
  r.usPerSimTick = us / static_cast<double>(ticks);
  r.cells = sim.field().activeCells();
  r.massInField = sim.field().totalMass();
  r.ticks = sim.tickIndex();
  return r;
}
}  // namespace

TEST(perf_cost_is_per_pollution_cell_not_per_machine) {
  // A starting base: 30 machines. This is what a player meets first.
  const CostResult startup = measure(30, 600);
  std::printf(
      "    [cost]    30 machines, 600 s: %.3f us/sim-tick (%.1f us/pollution "
      "tick), %zu cells, %.0f in field\n",
      startup.usPerSimTick, startup.usPerSimTick * 60.0, startup.cells,
      startup.massInField);

  // A big base at the DW-28 render limit.
  const CostResult big = measure(1200, 600);
  std::printf(
      "    [cost]  1200 machines, 600 s: %.3f us/sim-tick (%.1f us/pollution "
      "tick), %zu cells, %.0f in field\n",
      big.usPerSimTick, big.usPerSimTick * 60.0, big.cells, big.massInField);

  // Double the machines in the SAME footprint. If cost were O(machines) this
  // would double; it is O(cells), and the cloud grows only logarithmically with
  // source strength (the prune radius moves like log of the emission rate).
  const CostResult doubled = measure(2400, 600);
  const double machineRatio = 2.0;
  const double costRatio = doubled.usPerSimTick / big.usPerSimTick;
  const double cellRatio =
      static_cast<double>(doubled.cells) / static_cast<double>(big.cells);
  std::printf(
      "    [cost]  2400 machines, 600 s: %.3f us/sim-tick, %zu cells "
      "-> %.2fx machines gave %.2fx cost and %.2fx cells\n",
      doubled.usPerSimTick, doubled.cells, machineRatio, costRatio, cellRatio);

  CHECK(startup.ticks == 36000u);
  CHECK(big.cells > 0);
  // The load-bearing claim: doubling the machine count does NOT double the
  // cost. If this ever fails, the field has become per-entity and the design
  // has regressed to the thing render_cost.h was built to prevent.
  CHECK(costRatio < 1.6);
  CHECK(cellRatio < 1.6);
  // And the absolute number has to be small enough to tick forever alongside a
  // factory. 60 sim ticks per second, so 100 us/tick would be 0.6% of wall
  // clock; the gate here is deliberately loose because it is a floor on
  // sanity, not a benchmark, and the printed number is the real deliverable.
  CHECK(big.usPerSimTick < 2000.0);
}
