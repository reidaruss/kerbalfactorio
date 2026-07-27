// =============================================================================
// test_power.cpp — the electrical grid (power.h) and its binding to the factory
// sim (automation.h).
//
// Every expected number in this file was computed BY HAND from the arithmetic
// spec, independently of the implementation, before the implementation was
// tested. Where a value is a plain integer the derivation is written next to it.
// A test that asserts whatever the code happens to print proves nothing.
//
//   1. Satisfaction  — the one division, against nine hand-computed pairs.
//   2. Topology      — networks form by pole connectivity; removing one pole
//                      SPLITS a network in two and each half follows its own
//                      generators.
//   3. Wires         — a network of N poles publishes exactly N-1 segments,
//                      NOT one per pole pair within reach. Measured against a
//                      dense layout where those two numbers differ (9 vs 4).
//   4. Brownout      — proportional slowdown really does slow every consumer by
//                      the SAME factor, and the one case where integer
//                      truncation makes it only approximately so is pinned.
//   5. Throughput    — the four-smelters-on-one-generator scenario, including
//                      the invariant that the fourth smelter adds nothing.
//   6. Fuel          — a generator burns in proportion to ACTUAL output, energy
//                      in equals energy out exactly, and a third of the load
//                      really does make a coal unit last three times as long.
//   7. Degenerate    — a generator that also consumes cannot collapse its own
//                      network. This is the power-side analogue of the belt
//                      deadlock that shipped (FS-17).
//   8. Determinism   — standing rule 4: two identical grids match bit for bit.
// =============================================================================
#include <cstdio>
#include <vector>

#include "test_framework.h"
#include "of/power.h"
#include "of/automation.h"
#include "of/gameplay.h"

using namespace of;
namespace pw = of::power;
namespace au = of::automation;
namespace sv = of::gameplay::survival;

namespace {

// A machine's per-tick craft advance in milliticks, as factory_sim computes it.
// Restated here so the test's expectations do not read the sim's source.
uint32_t advancePerTick(uint32_t satQ16) {
  return static_cast<uint32_t>((1000ull * satQ16) >> 16);
}
// Ticks for one craft of nominal length T at that advance (ceiling division).
uint32_t craftTicks(uint32_t T, uint32_t adv) {
  return adv == 0 ? 0 : (T * 1000u + adv - 1u) / adv;
}

}  // namespace

// =============================================================================
// 1. SATISFACTION — the one division.
// =============================================================================
TEST(satisfaction_matches_hand_computed_values) {
  // Hand arithmetic, each independently derived:
  //   90000*65536 = 5,898,240,000;  / 120000 = 49152        exactly 0.75
  CHECK(pw::SatisfactionQ16(90000, 120000) == 49152u);
  //   supply >= demand: clamped at 1.0. Surplus never overclocks.
  CHECK(pw::SatisfactionQ16(90000, 90000) == 65536u);
  CHECK(pw::SatisfactionQ16(90000, 30000) == 65536u);
  //   100000*65536 = 6,553,600,000;  / 300000 = 21845.333 -> floor 21845
  CHECK(pw::SatisfactionQ16(100000, 300000) == 21845u);
  //   500000*65536 = 32,768,000,000; / 1000000 = 32768      exactly 0.5
  CHECK(pw::SatisfactionQ16(500000, 1000000) == 32768u);
  //   no supply at all: 0, not 1.0.
  CHECK(pw::SatisfactionQ16(0, 60000) == 0u);
  //   an idle network is not in deficit.
  CHECK(pw::SatisfactionQ16(90000, 0) == 65536u);
  //   5,898,240,000 / 270000 = 21845.333 -> 21845. Same integer as the pair
  //   above despite different watts: both are exactly one third.
  CHECK(pw::SatisfactionQ16(90000, 270000) == 21845u);
  //   45000*65536 = 2,949,120,000;  / 120000 = 24576        exactly 0.375
  CHECK(pw::SatisfactionQ16(45000, 120000) == 24576u);

  // 21845/65536 = 0.3333282470703125. TRUNCATED, so it is under one third and
  // never over: a network can never deliver more work than it has watts for.
  CHECK(21845.0 / 65536.0 < 1.0 / 3.0);
  CHECK_NEAR(21845.0 / 65536.0, 1.0 / 3.0, 1e-4);
}

// =============================================================================
// 2 + 3. TOPOLOGY AND WIRES.
// =============================================================================
TEST(poles_within_wire_reach_form_one_network) {
  pw::PowerGrid g;
  // Five poles on a line 6 m apart, wire reach 7.5 m. Adjacent pairs are in
  // reach (6 <= 7.5); every other pair is 12 m or more and is not.
  for (int i = 0; i < 5; ++i) g.addPole(i * 6.0f, 0, 0);
  g.rebuildNow();

  CHECK(g.networkCount() == 1);
  CHECK(g.stats(0).poleCount == 5);
  // Hand: a spanning tree over 5 connected poles has 5 - 1 = 4 segments.
  CHECK(g.wireSegments().size() == 4);
  for (uint32_t i = 0; i < 5; ++i) CHECK(g.networkOfPole(i) == 0);
}

TEST(removing_one_pole_splits_a_network_in_two) {
  pw::PowerGrid g;
  const pw::PoleId p0 = g.addPole(0, 0, 0);
  const pw::PoleId p1 = g.addPole(6, 0, 0);
  const pw::PoleId p2 = g.addPole(12, 0, 0);   // the bridge
  const pw::PoleId p3 = g.addPole(18, 0, 0);
  const pw::PoleId p4 = g.addPole(24, 0, 0);
  (void)p0; (void)p1; (void)p3; (void)p4;

  const pw::NodeId genL =
      g.addGenerator(1, 0, 0, pw::burnerGeneratorSpec(sv::items::Coal));
  const pw::NodeId genR =
      g.addGenerator(23, 0, 0, pw::burnerGeneratorSpec(sv::items::Coal));
  g.insertFuel(genL, sv::items::Coal, 10);
  g.insertFuel(genR, sv::items::Coal, 10);
  // Consumers sit 0.5 m from a pole, well inside the 2.5 m supply radius.
  const pw::NodeId cL = g.addConsumer(5.5f, 0, 0, 120000);
  const pw::NodeId cR = g.addConsumer(18.5f, 0, 0, 45000);

  g.solve(0);
  CHECK(g.networkCount() == 1);
  CHECK(g.networkOfNode(cL) == g.networkOfNode(cR));
  // One network, two 90 kW generators, 120000 + 45000 = 165000 W of demand.
  // 180000 >= 165000, so nobody is short.
  CHECK(g.stats(0).capacityW == 180000);
  CHECK(g.stats(0).demandW == 165000);
  CHECK(g.stats(0).satisfactionQ16 == 65536u);
  CHECK(g.wireSegments().size() == 4);

  // Pull the bridge out.
  CHECK(g.removePole(p2));
  g.solve(1);

  CHECK(g.networkCount() == 2);
  const pw::NetworkId nL = g.networkOfNode(cL);
  const pw::NetworkId nR = g.networkOfNode(cR);
  CHECK(nL != nR);
  CHECK(nL != pw::kNoNetwork && nR != pw::kNoNetwork);
  CHECK(g.stats(nL).poleCount == 2);
  CHECK(g.stats(nR).poleCount == 2);
  CHECK(g.stats(nL).generatorCount == 1);
  CHECK(g.stats(nR).generatorCount == 1);
  // Hand: 4 live poles in 2 components -> 4 - 2 = 2 wire segments.
  CHECK(g.wireSegments().size() == 2);

  // The point of the split: the two halves now answer DIFFERENTLY. The left has
  // 90000 W against 120000 W of draw (hand: 49152); the right has 90000 against
  // 45000 and is fine.
  CHECK(g.stats(nL).satisfactionQ16 == 49152u);
  CHECK(g.stats(nR).satisfactionQ16 == 65536u);
  CHECK(g.satisfactionOfNode(cL) == 49152u);
  CHECK(g.satisfactionOfNode(cR) == 65536u);
}

TEST(wires_are_a_spanning_tree_not_every_pair_in_reach) {
  // The layout that makes the two numbers differ: five poles 2 m apart, wire
  // reach 7.5 m, so nearly every pair can see every other.
  const float xs[5] = {0, 2, 4, 6, 8};
  pw::PowerGrid g;
  for (int i = 0; i < 5; ++i) g.addPole(xs[i], 0, 0);
  g.rebuildNow();

  // Count the in-reach PAIRS independently, in the test, from the positions.
  int pairsInReach = 0;
  for (int i = 0; i < 5; ++i)
    for (int j = i + 1; j < 5; ++j)
      if (xs[j] - xs[i] <= 7.5f) ++pairsInReach;
  // Hand: all 10 pairs except (0, 8) whose separation is 8 > 7.5.
  CHECK(pairsInReach == 9);

  CHECK(g.networkCount() == 1);
  CHECK(g.stats(0).poleCount == 5);
  // The number that matters for instance count: 4, not 9.
  CHECK(g.wireSegments().size() == 4);
  CHECK(g.wireSegments().size() < static_cast<size_t>(pairsInReach));

  // And it stays linear as the cluster gets denser. 30 poles 1 m apart:
  // hand: pairs within 7.5 m are those 1..7 m apart, so sum(30-d) for d=1..7
  // = 29+28+27+26+25+24+23 = 182 pairs, against 29 wire segments.
  pw::PowerGrid dense;
  for (int i = 0; i < 30; ++i) dense.addPole(static_cast<float>(i), 0, 0);
  dense.rebuildNow();
  int densePairs = 0;
  for (int i = 0; i < 30; ++i)
    for (int j = i + 1; j < 30; ++j)
      if (j - i <= 7) ++densePairs;  // 7 m apart is in reach, 8 m is not
  CHECK(densePairs == 182);
  CHECK(dense.networkCount() == 1);
  CHECK(dense.wireSegments().size() == 29);
  // 6.3x fewer wires than the naive rule, and the gap widens with density.
  CHECK(densePairs > 6 * static_cast<int>(dense.wireSegments().size()));
  std::printf("    wires: 30 dense poles -> %d in-reach pairs, %zu segments\n",
              densePairs, dense.wireSegments().size());
}

TEST(a_consumer_no_pole_reaches_is_unpowered_not_free) {
  pw::PowerGrid g;
  g.addPole(0, 0, 0);
  const pw::NodeId gen =
      g.addGenerator(1, 0, 0, pw::burnerGeneratorSpec(sv::items::Coal));
  g.insertFuel(gen, sv::items::Coal, 5);
  const pw::NodeId near = g.addConsumer(2.0f, 0, 0, 30000);   // 2.0 m: inside
  const pw::NodeId far = g.addConsumer(3.0f, 0, 0, 30000);    // 3.0 m: outside
  g.solve(0);

  CHECK(g.networkOfNode(near) == 0);
  CHECK(g.networkOfNode(far) == pw::kNoNetwork);
  CHECK(g.satisfactionOfNode(near) == 65536u);
  CHECK(g.satisfactionOfNode(far) == 0u);
  // The unreachable consumer contributes nothing to the network's demand, so it
  // cannot brown out machines it is not even connected to.
  CHECK(g.stats(0).demandW == 30000);
  CHECK(g.stats(0).consumerCount == 1);
}

// =============================================================================
// 4. PROPORTIONAL BROWNOUT.
// =============================================================================
namespace {

// Build a network with one 90 kW generator, three machines of the given craft
// times all drawing 30 kW, plus a bare parasitic load to push demand where we
// want it. Returns the ticks each machine took to complete its FIRST craft.
struct SlowdownResult {
  uint32_t sat = 0;
  uint32_t ticks[3] = {0, 0, 0};
};

SlowdownResult measureSlowdown(int32_t parasiticW) {
  au::BuildableNetwork net;
  net.enableGrid();
  net.placePole(0, 0, 0);
  const au::GeneratorId gen =
      net.placeBurnerGenerator(1.0f, 0, 0, sv::items::Coal);
  net.insertFuel(gen, sv::items::Coal, 50);

  const uint32_t T[3] = {30, 60, 90};
  au::BuildId m[3];
  for (int i = 0; i < 3; ++i) {
    m[i] = net.placeElectricSmelter(sv::items::RawIron, sv::items::Iron,
                                    1.0f + 0.2f * i, 0.5f, 0, T[i], 30000);
    net.sim().feedMachine(m[i].entity, 200);
  }
  if (parasiticW > 0) net.grid().addConsumer(1.5f, 0, 0, parasiticW);

  SlowdownResult r;
  bool done[3] = {false, false, false};
  for (uint32_t t = 1; t <= 5000; ++t) {
    net.step();
    if (t == 1) r.sat = net.networkStats(0).satisfactionQ16;
    for (int i = 0; i < 3; ++i) {
      if (!done[i] && net.outputBuffer(m[i]) > 0) {
        r.ticks[i] = t;
        done[i] = true;
      }
    }
    if (done[0] && done[1] && done[2]) break;
  }
  return r;
}

}  // namespace

TEST(brownout_slows_every_consumer_by_the_same_factor) {
  // Baseline: three machines draw 90000 against a 90000 W generator, so nobody
  // is short and each craft takes its nominal time.
  SlowdownResult full = measureSlowdown(0);
  CHECK(full.sat == 65536u);
  CHECK(full.ticks[0] == 30);
  CHECK(full.ticks[1] == 60);
  CHECK(full.ticks[2] == 90);

  // Add 30 kW of parasitic load: demand 120000 against 90000.
  // Hand: satisfaction 49152 (exactly 0.75); advance 750 milliticks/tick;
  //       30000/750 = 40, 60000/750 = 80, 90000/750 = 120. Exactly 4/3 each.
  SlowdownResult q = measureSlowdown(30000);
  CHECK(q.sat == 49152u);
  CHECK(advancePerTick(49152u) == 750u);
  CHECK(q.ticks[0] == 40);
  CHECK(q.ticks[1] == 80);
  CHECK(q.ticks[2] == 120);
  CHECK_NEAR(q.ticks[0] / 30.0, 4.0 / 3.0, 1e-12);
  CHECK_NEAR(q.ticks[1] / 60.0, 4.0 / 3.0, 1e-12);
  CHECK_NEAR(q.ticks[2] / 90.0, 4.0 / 3.0, 1e-12);

  // Add 90 kW: demand 180000 against 90000. Hand: satisfaction 32768 (0.5),
  // advance 500, so 60 / 120 / 180 ticks. Exactly 2x each, all three the same.
  SlowdownResult h = measureSlowdown(90000);
  CHECK(h.sat == 32768u);
  CHECK(advancePerTick(32768u) == 500u);
  CHECK(h.ticks[0] == 60);
  CHECK(h.ticks[1] == 120);
  CHECK(h.ticks[2] == 180);
  for (int i = 0; i < 3; ++i)
    CHECK_NEAR(h.ticks[i] / static_cast<double>(full.ticks[i]), 2.0, 1e-12);
}

TEST(integer_truncation_makes_the_slowdown_only_approximately_proportional) {
  // 180 kW of parasitic load: demand 270000 against 90000.
  // Hand: satisfaction = floor(90000*65536/270000) = floor(21845.333) = 21845.
  //       advance = floor(1000*21845/65536) = floor(333.325) = 333.
  //       ceil(30000/333) = 91, ceil(60000/333) = 181, ceil(90000/333) = 271.
  // Two truncations stack: the advance loses 0.325 milliticks a tick, and the
  // craft's final partial tick is rounded up by a FIXED absolute amount, which
  // is a LARGER relative penalty on a short recipe. So the three ratios are
  // 3.0333, 3.0167 and 3.0111 rather than one number.
  SlowdownResult r = measureSlowdown(180000);
  CHECK(r.sat == 21845u);
  CHECK(advancePerTick(21845u) == 333u);
  CHECK(craftTicks(30, 333) == 91u);
  CHECK(r.ticks[0] == 91);
  CHECK(r.ticks[1] == 181);
  CHECK(r.ticks[2] == 271);

  const double a = r.ticks[0] / 30.0;   // 3.033333
  const double b = r.ticks[1] / 60.0;   // 3.016667
  const double c = r.ticks[2] / 90.0;   // 3.011111
  CHECK(a > b && b > c);                // short recipes lose the most
  // The spread is bounded and small: under 1% between the best and worst case.
  CHECK((a - c) / c < 0.01);
  CHECK_NEAR(a - c, 0.0222222, 1e-6);
  // And every one of them is close to the ideal 1/satisfaction = 3.0000458.
  CHECK(a < 3.04 && c > 3.00);
  std::printf(
      "    truncation: ratios %.6f / %.6f / %.6f (ideal %.6f), spread %.6f\n", a,
      b, c, 65536.0 / 21845.0, a - c);

  // The rule, stated so a future change cannot quietly break it: the slowdown
  // is EXACTLY proportional if and only if the advance divides the craft length.
  CHECK(30000u % 750u == 0);   // the 49152 case: exact
  CHECK(30000u % 500u == 0);   // the 32768 case: exact
  CHECK(30000u % 333u != 0);   // the 21845 case: not exact, hence the spread
}

// =============================================================================
// 5. THE FOUR-SMELTER SCENARIO — what a player actually meets.
// =============================================================================
namespace {

// N electric smelters on one 90 kW burner generator. Returns total ingots after
// `ticks` and the network's satisfaction.
struct SmelterRun {
  uint64_t ingots = 0;
  uint32_t sat = 0;
  int64_t demandW = 0;
  int64_t capacityW = 0;
  int64_t productionW = 0;
};

SmelterRun runSmelters(int n, uint32_t ticks) {
  au::BuildableNetwork net;
  net.enableGrid();
  net.placePole(0, 0, 0);
  const au::GeneratorId gen =
      net.placeBurnerGenerator(1.0f, 0, 0, sv::items::Coal);
  net.insertFuel(gen, sv::items::Coal, 50);
  for (int i = 0; i < n; ++i) {
    au::BuildId b = net.placeElectricSmelter(sv::items::RawIron, sv::items::Iron,
                                             1.0f, 0.5f + 0.1f * i, 0);
    net.sim().feedMachine(b.entity, 500);
  }
  net.stepN(ticks);
  SmelterRun r;
  r.ingots = net.producedCountOf(sv::items::Iron);
  const au::NetworkStats s = net.networkStats(0);
  r.sat = s.satisfactionQ16;
  r.demandW = s.demandW;
  r.capacityW = s.capacityW;
  r.productionW = s.productionW;
  return r;
}

}  // namespace

TEST(one_generator_runs_three_smelters_and_the_fourth_adds_nothing) {
  // THREE smelters: 3 x 30000 = 90000 W against a 90000 W generator. Exactly
  // met, so satisfaction is 1.0 and each craft takes its nominal 30 ticks.
  // Hand: 1200 / 30 = 40 crafts each, 3 x 40 = 120 ingots.
  SmelterRun three = runSmelters(3, 1200);
  CHECK(three.demandW == 90000);
  CHECK(three.capacityW == 90000);
  CHECK(three.sat == 65536u);
  CHECK(three.ingots == 120u);

  // FOUR smelters: 4 x 30000 = 120000 against 90000.
  // Hand: satisfaction 49152 (0.75), advance 750, 30000/750 = 40 ticks/craft,
  //       1200/40 = 30 crafts each, 4 x 30 = 120 ingots.
  SmelterRun four = runSmelters(4, 1200);
  CHECK(four.demandW == 120000);
  CHECK(four.capacityW == 90000);
  CHECK(four.sat == 49152u);
  CHECK(four.ingots == 120u);

  // THE POINT, and the reason the panel is worth building: the fourth smelter
  // produced NOTHING. The same 90 kW was spread over four machines instead of
  // three and the network's total output did not move. A player reading only
  // "my smelter is slower" cannot see that; a player reading "120 kW demanded,
  // 90 kW produced, 75%" can, and knows to place a second generator.
  CHECK(four.ingots == three.ingots);
  CHECK(four.productionW == three.productionW);
  CHECK(four.productionW == 90000);

  // Five is worse per machine, and slightly worse in TOTAL, which is honest
  // rather than convenient. Hand: floor(90000*65536/150000) = floor(39321.6) =
  // 39321; advance floor(1000*39321/65536) = 599; ceil(30000/599) = 51 ticks a
  // craft (599 x 50 = 29950, one short); 1200/51 = 23 crafts each; 5 x 23 = 115.
  // The missing 5 ingots are the SAME integer truncation the slowdown test
  // pins: 599 is 0.6 milliticks under the ideal 599.6, and the leftover is
  // rounded away once per craft. It is a 4.2% loss at this ratio and it is
  // bounded by one tick per craft, so it cannot compound.
  SmelterRun five = runSmelters(5, 1200);
  CHECK(five.demandW == 150000);
  CHECK(five.sat == 39321u);
  CHECK(advancePerTick(39321u) == 599u);
  CHECK(craftTicks(30, 599) == 51u);
  CHECK(five.ingots == 115u);
  CHECK(five.ingots < three.ingots);
  CHECK((three.ingots - five.ingots) * 100u / three.ingots < 5u);
  std::printf(
      "    smelters: 3 -> %llu ingots (sat %.3f), 4 -> %llu (sat %.3f), "
      "5 -> %llu (sat %.3f)\n",
      static_cast<unsigned long long>(three.ingots), three.sat / 65536.0,
      static_cast<unsigned long long>(four.ingots), four.sat / 65536.0,
      static_cast<unsigned long long>(five.ingots), five.sat / 65536.0);

  // Two generators clear the deficit and the fourth smelter starts earning.
  au::BuildableNetwork net;
  net.enableGrid();
  net.placePole(0, 0, 0);
  for (int i = 0; i < 2; ++i) {
    const au::GeneratorId g =
        net.placeBurnerGenerator(1.0f + 0.3f * i, 0, 0, sv::items::Coal);
    net.insertFuel(g, sv::items::Coal, 50);
  }
  for (int i = 0; i < 4; ++i) {
    au::BuildId b = net.placeElectricSmelter(sv::items::RawIron, sv::items::Iron,
                                             1.0f, 0.5f + 0.1f * i, 0);
    net.sim().feedMachine(b.entity, 500);
  }
  net.stepN(1200);
  CHECK(net.networkStats(0).capacityW == 180000);
  CHECK(net.networkStats(0).satisfactionQ16 == 65536u);
  // Hand: 4 smelters x 40 crafts = 160 ingots, up from 120.
  CHECK(net.producedCountOf(sv::items::Iron) == 160u);
}

// =============================================================================
// 6. FUEL — burn follows actual output, and energy is conserved exactly.
// =============================================================================
namespace {

struct BurnRun {
  uint32_t poweredTicks = 0;     // ticks on which the generator produced > 0
  uint32_t fullRatedTicks = 0;   // ticks at the full nameplate
  uint64_t deliveredMilliJ = 0;  // total energy handed to the network
  int32_t steadyOutputW = 0;     // the output it settled at
};

// One generator, one coal unit, a bare constant load. Runs until it dies.
BurnRun burnOneCoal(int32_t loadW) {
  pw::PowerGrid g;
  g.addPole(0, 0, 0);
  const pw::NodeId gen =
      g.addGenerator(1, 0, 0, pw::burnerGeneratorSpec(sv::items::Coal));
  g.insertFuel(gen, sv::items::Coal, 1);
  g.addConsumer(1, 0, 0, loadW);

  BurnRun r;
  for (uint32_t t = 1; t <= 20000; ++t) {
    g.solve(t);
    const int32_t out = g.generatorOutputW(gen);
    if (out <= 0) break;
    ++r.poweredTicks;
    if (out == 90000) ++r.fullRatedTicks;
    if (r.poweredTicks == 1) r.steadyOutputW = out;
    r.deliveredMilliJ += (static_cast<uint64_t>(out) * 1000ull) / 60ull;
  }
  return r;
}

}  // namespace

TEST(a_generator_burns_in_proportion_to_what_it_actually_produces) {
  // One coal is 4 MJ. At 60 Hz, W watts costs W*1000/60 mJ per tick, so a coal
  // unit is worth 4,000,000,000 / (1000/60) = 240,000,000 watt-ticks exactly.
  const uint64_t kWattTicksPerCoal = 240000000ull;

  // FULL LOAD. Hand: 90000 W costs 1,500,000 mJ/tick; 4e9 / 1.5e6 = 2666.67, so
  // 2666 full ticks and one final partly-funded tick at 60000 W = 2667 powered
  // ticks. ceil(240000000/90000) = 2667.
  BurnRun full = burnOneCoal(120000);  // over-subscribed: generator flat out
  CHECK(full.steadyOutputW == 90000);
  CHECK(full.fullRatedTicks == 2666);
  CHECK(full.poweredTicks == 2667);
  // ENERGY IS CONSERVED EXACTLY: nothing minted on the final partial tick.
  CHECK(full.deliveredMilliJ == pw::kCoalEnergyMilliJ);
  CHECK(kWattTicksPerCoal / 90000ull == 2666ull);

  // HALF LOAD. Hand: loadQ16 = 45000*65536/90000 = 32768 exactly, output 45000,
  // burn 750000 mJ/tick, ceil(240000000/45000) = 5334 powered ticks.
  BurnRun half = burnOneCoal(45000);
  CHECK(half.steadyOutputW == 45000);
  CHECK(half.poweredTicks == 5334);
  CHECK(half.deliveredMilliJ == pw::kCoalEnergyMilliJ);
  CHECK(half.poweredTicks == 2 * full.poweredTicks);

  // ONE THIRD LOAD. Hand: loadQ16 = floor(30000*65536/90000) = 21845, so the
  // output is (90000*21845)>>16 = 29999 W, ONE WATT under the request, and the
  // burn is 29999000/60 = 499983 mJ/tick. ceil(240000000/29999) = 8001.
  BurnRun third = burnOneCoal(30000);
  CHECK(third.steadyOutputW == 29999);
  CHECK(third.poweredTicks == 8001);
  CHECK(third.deliveredMilliJ == pw::kCoalEnergyMilliJ);
  // "A third of the load makes a coal unit last three times as long" — and here
  // it is EXACT, 3 x 2667 == 8001, despite the one-watt truncation.
  CHECK(third.poweredTicks == 3 * full.poweredTicks);

  std::printf(
      "    fuel: 1 coal = %u ticks @ 90 kW (%.2f s), %u @ 45 kW, %u @ 30 kW; "
      "energy delivered %llu mJ in every case\n",
      full.poweredTicks, full.poweredTicks / 60.0, half.poweredTicks,
      third.poweredTicks,
      static_cast<unsigned long long>(full.deliveredMilliJ));
}

TEST(a_generator_running_dry_fades_rather_than_cliff_edging) {
  pw::PowerGrid g;
  g.addPole(0, 0, 0);
  const pw::NodeId gen =
      g.addGenerator(1, 0, 0, pw::burnerGeneratorSpec(sv::items::Coal));
  g.insertFuel(gen, sv::items::Coal, 1);
  g.addConsumer(1, 0, 0, 120000);

  for (uint32_t t = 1; t <= 2666; ++t) g.solve(t);
  // Hand: after 2666 ticks at 1,500,000 mJ each, 4e9 - 3,999,000,000 remains.
  CHECK(g.storedEnergyMilliJ(gen) == 1000000ull);
  CHECK(g.generatorAvailableW(gen) == 90000);

  g.solve(2667);
  // The last tick can only fund 1,000,000 mJ = 60,000 W, so that is all it
  // offers. It does not promise 90 kW it cannot deliver.
  CHECK(g.generatorAvailableW(gen) == 60000);
  CHECK(g.generatorOutputW(gen) == 60000);
  CHECK(g.storedEnergyMilliJ(gen) == 0ull);
  // Hand: 60000/120000 = 32768.
  CHECK(g.stats(0).satisfactionQ16 == 32768u);

  g.solve(2668);
  CHECK(g.stats(0).capacityW == 0);
  CHECK(g.stats(0).fuelledGeneratorCount == 0);
  CHECK(g.stats(0).satisfactionQ16 == 0u);
  CHECK(g.generatorOutputW(gen) == 0);
}

TEST(refuelling_a_dead_generator_brings_the_network_back) {
  pw::PowerGrid g;
  g.addPole(0, 0, 0);
  const pw::NodeId gen =
      g.addGenerator(1, 0, 0, pw::burnerGeneratorSpec(sv::items::Coal));
  g.addConsumer(1, 0, 0, 90000);
  g.solve(0);
  CHECK(g.stats(0).satisfactionQ16 == 0u);  // no fuel at all
  CHECK(g.insertFuel(gen, sv::items::Coal, 3) == 3);
  g.solve(1);
  CHECK(g.stats(0).satisfactionQ16 == 65536u);
  // Wrong fuel is refused outright rather than silently accepted at 0 energy.
  CHECK(g.insertFuel(gen, sv::items::Wood, 5) == 0);
  CHECK(g.fuelUnits(gen) == 2);  // one unit moved into the burn pool
}

// =============================================================================
// 7. THE DEGENERATE CASE — a generator that also consumes.
//
// The belt sim shipped a permanent deadlock because a smelter could be both a
// source and a sink of one run (FS-17). The power analogue is a generator whose
// own draw depresses the satisfaction that would gate its output: that makes the
// solve a fixed point, and a bistable one. This test proves it cannot happen.
// =============================================================================
TEST(a_generator_that_also_consumes_cannot_collapse_its_own_network) {
  pw::PowerGrid g;
  g.addPole(0, 0, 0);
  const pw::NodeId gen =
      g.addGenerator(1, 0, 0, pw::burnerGeneratorSpec(sv::items::Coal));
  g.insertFuel(gen, sv::items::Coal, 50);
  // The SAME machine draws three times what it makes, on its own network, with
  // nothing else present. If supply were gated on satisfaction this is exactly
  // where it would spiral: less power -> less output -> less power -> 0.
  const pw::NodeId self = g.addConsumer(1, 0, 0, 270000);

  uint32_t firstSat = 0, lastSat = 0;
  for (uint32_t t = 1; t <= 1000; ++t) {
    g.solve(t);
    if (t == 1) firstSat = g.stats(0).satisfactionQ16;
    lastSat = g.stats(0).satisfactionQ16;
    // Supply is a function of FUEL alone and never sags.
    CHECK(g.generatorOutputW(gen) == 90000);
  }
  // Hand: 90000/270000 = one third = 21845. Stable, and identical on tick 1000.
  CHECK(firstSat == 21845u);
  CHECK(lastSat == 21845u);
  CHECK(g.satisfactionOfNode(self) == 21845u);
  CHECK(g.stats(0).capacityW == 90000);
  CHECK(g.stats(0).demandW == 270000);
  CHECK(g.stats(0).productionW == 90000);

  // The same shape one step further: TWO generators that each also consume more
  // than they make. Still a single well-defined answer, still not zero.
  pw::PowerGrid pair;
  pair.addPole(0, 0, 0);
  for (int i = 0; i < 2; ++i) {
    const pw::NodeId gg = pair.addGenerator(
        1.0f, 0.2f * i, 0, pw::burnerGeneratorSpec(sv::items::Coal));
    pair.insertFuel(gg, sv::items::Coal, 50);
    pair.addConsumer(1.0f, 0.2f * i, 0, 120000);
  }
  pair.solve(0);
  // Hand: capacity 180000, demand 240000, floor(180000*65536/240000) = 49152.
  CHECK(pair.stats(0).capacityW == 180000);
  CHECK(pair.stats(0).demandW == 240000);
  CHECK(pair.stats(0).satisfactionQ16 == 49152u);
  pair.solve(1);
  CHECK(pair.stats(0).satisfactionQ16 == 49152u);  // no drift on the second pass
}

// =============================================================================
// 8. HISTORY AND DETERMINISM.
// =============================================================================
TEST(the_network_keeps_a_history_a_panel_can_graph) {
  pw::PowerGrid g(8);  // small ring so wraparound is exercised
  g.addPole(0, 0, 0);
  const pw::NodeId gen =
      g.addGenerator(1, 0, 0, pw::burnerGeneratorSpec(sv::items::Coal));
  g.insertFuel(gen, sv::items::Coal, 50);
  g.addConsumer(1, 0, 0, 120000);

  for (uint32_t t = 1; t <= 20; ++t) g.solve(t);
  std::vector<pw::NetworkSample> h = g.history(0);
  CHECK(h.size() == 8);                 // bounded by the ring capacity
  CHECK(h.front().tick == 13);          // oldest kept: ticks 13..20
  CHECK(h.back().tick == 20);           // newest last
  for (const pw::NetworkSample& s : h) {
    CHECK(s.demandW == 120000);
    CHECK(s.productionW == 90000);
    CHECK(s.satisfactionQ16 == 49152u);
  }
  CHECK(g.historyCapacity() == 8);
}

TEST(the_grid_is_deterministic) {
  auto build = [](std::vector<uint64_t>& trace) {
    au::BuildableNetwork net;
    net.enableGrid();
    net.placePole(0, 0, 0);
    net.placePole(6, 0, 0);
    net.placePole(12, 0, 0);
    const au::GeneratorId g = net.placeBurnerGenerator(1, 0, 0, sv::items::Coal);
    net.insertFuel(g, sv::items::Coal, 5);
    for (int i = 0; i < 4; ++i) {
      au::BuildId b = net.placeElectricSmelter(
          sv::items::RawIron, sv::items::Iron, 1.0f, 0.4f + 0.1f * i, 0);
      net.sim().feedMachine(b.entity, 300);
    }
    au::BuildId miner = net.placeMinerOnDeposit(1000, sv::items::RawIron, 2.0);
    net.connectToGrid(miner, 11.5f, 0, 0, 5000);
    for (uint32_t t = 1; t <= 600; ++t) {
      net.step();
      const au::NetworkStats s0 = net.networkStats(0);
      trace.push_back(s0.satisfactionQ16);
      trace.push_back(static_cast<uint64_t>(s0.demandW));
      trace.push_back(static_cast<uint64_t>(s0.productionW));
      trace.push_back(net.producedCountOf(sv::items::Iron));
    }
    return net.producedCountOf(sv::items::Iron);
  };

  std::vector<uint64_t> a, b;
  const uint64_t ia = build(a);
  const uint64_t ib = build(b);
  CHECK(a.size() == b.size());
  CHECK(a.size() == 600 * 4);
  bool identical = a.size() == b.size();
  for (size_t i = 0; identical && i < a.size(); ++i)
    if (a[i] != b[i]) identical = false;
  CHECK(identical);
  CHECK(ia == ib);
  CHECK(ia > 0);

  // Two networks apart: a second, DISCONNECTED pole cluster must not perturb
  // the first one's numbers at all.
  std::vector<uint64_t> c;
  {
    au::BuildableNetwork net;
    net.enableGrid();
    net.placePole(0, 0, 0);
    net.placePole(6, 0, 0);
    net.placePole(12, 0, 0);
    net.placePole(200, 0, 0);  // far away: its own network
    const au::GeneratorId g = net.placeBurnerGenerator(1, 0, 0, sv::items::Coal);
    net.insertFuel(g, sv::items::Coal, 5);
    const au::GeneratorId g2 =
        net.placeBurnerGenerator(201, 0, 0, sv::items::Coal);
    net.insertFuel(g2, sv::items::Coal, 5);
    for (int i = 0; i < 4; ++i) {
      au::BuildId bb = net.placeElectricSmelter(
          sv::items::RawIron, sv::items::Iron, 1.0f, 0.4f + 0.1f * i, 0);
      net.sim().feedMachine(bb.entity, 300);
    }
    au::BuildId miner = net.placeMinerOnDeposit(1000, sv::items::RawIron, 2.0);
    net.connectToGrid(miner, 11.5f, 0, 0, 5000);
    CHECK(net.networkCount() == 2);
    for (uint32_t t = 1; t <= 600; ++t) {
      net.step();
      const au::NetworkStats s0 = net.networkStats(0);
      c.push_back(s0.satisfactionQ16);
      c.push_back(static_cast<uint64_t>(s0.demandW));
      c.push_back(static_cast<uint64_t>(s0.productionW));
      c.push_back(net.producedCountOf(sv::items::Iron));
    }
  }
  bool unperturbed = c.size() == a.size();
  for (size_t i = 0; unperturbed && i < a.size(); ++i)
    if (a[i] != c[i]) unperturbed = false;
  CHECK(unperturbed);
}

// =============================================================================
// 9. THE MINER STOPS BEING A FREE RIDER.
// =============================================================================
TEST(a_powered_miner_pays_for_the_brownout_it_suffers) {
  // Before this lane a miner's extraction was scaled by the network factor but
  // it contributed nothing to demand: it got slower when other machines browned
  // out and never caused one itself. A draw of 0, the default, keeps that exact
  // legacy behaviour so no existing scene moved.
  au::BuildableNetwork legacy;
  legacy.enableGrid();
  legacy.placePole(0, 0, 0);
  const au::GeneratorId g = legacy.placeBurnerGenerator(1, 0, 0, sv::items::Coal);
  legacy.insertFuel(g, sv::items::Coal, 50);
  au::BuildId m0 = legacy.placeMinerOnDeposit(100000, sv::items::RawIron, 60.0, 0);
  legacy.connectToGrid(m0, 1.0f, 0.5f, 0, 0);  // registered, but 0 W
  legacy.stepN(600);
  // Hand: 60 units/s for 600 ticks at 60 Hz = 600 units, unaffected by power.
  CHECK(legacy.producedCountOf(sv::items::RawIron) == 600u);
  CHECK(legacy.networkStats(0).demandW == 0);

  // Give it a real draw and it shows up in the panel and in the deficit.
  au::BuildableNetwork powered;
  powered.enableGrid();
  powered.placePole(0, 0, 0);
  const au::GeneratorId g2 =
      powered.placeBurnerGenerator(1, 0, 0, sv::items::Coal);
  powered.insertFuel(g2, sv::items::Coal, 50);
  au::BuildId m1 = powered.placeMinerOnDeposit(100000, sv::items::RawIron, 60.0, 0);
  powered.connectToGrid(m1, 1.0f, 0.5f, 0, 45000);
  au::BuildId s1 = powered.placeElectricSmelter(sv::items::RawIron,
                                                sv::items::Iron, 1.0f, 0.7f, 0);
  powered.sim().feedMachine(s1.entity, 500);
  powered.stepN(600);
  // Hand: 45000 (miner) + 30000 (smelter) = 75000 against 90000. In surplus, so
  // the miner runs at full rate and nothing is browned out — but the panel now
  // tells the truth about what the base is drawing.
  CHECK(powered.networkStats(0).demandW == 75000);
  CHECK(powered.networkStats(0).satisfactionQ16 == 65536u);
  CHECK(powered.sim().minerPower(m1.entity) == 45000);

  // Push the same network into deficit and the miner slows with everything else.
  au::BuildableNetwork starved;
  starved.enableGrid();
  starved.placePole(0, 0, 0);
  const au::GeneratorId g3 =
      starved.placeBurnerGenerator(1, 0, 0, sv::items::Coal);
  starved.insertFuel(g3, sv::items::Coal, 50);
  au::BuildId m2 = starved.placeMinerOnDeposit(100000, sv::items::RawIron, 60.0, 0);
  starved.connectToGrid(m2, 1.0f, 0.5f, 0, 45000);
  starved.grid().addConsumer(1.0f, 0.9f, 0, 135000);  // parasitic load
  starved.stepN(600);
  // Hand: demand 180000 against 90000 -> satisfaction 32768 (exactly half), and
  // the miner's milli-units per tick halve with it: 1000 -> 500, so 600 ticks
  // yield 300 units instead of 600.
  CHECK(starved.networkStats(0).demandW == 180000);
  CHECK(starved.networkStats(0).satisfactionQ16 == 32768u);
  CHECK(starved.producedCountOf(sv::items::RawIron) == 300u);
}
