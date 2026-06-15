// Wave-0 headless tests for the factory-sim core (Spike 3).
// Maps the spike3-factory-sim validation gates to concrete assertions:
//   - Correctness (§2/§1.4/§4): belt end-to-end transport, inserter transfer,
//     machine recipe completion, power brownout scaling.
//   - Update-on-demand (§3, gate G5): active-set work << total entity count.
//   - THE BENCHMARK (§7, gate G1): 100,000 forced-active entities at >= 60 UPS.
#include <chrono>
#include <cstdio>

#include "test_framework.h"
#include "of/factory_sim.h"

using namespace of::factory;

// =============================================================================
// CORRECTNESS
// =============================================================================

// --- §2: an item travels a belt end-to-end in the expected number of ticks. --
// A line of `tiles` tiles is `tiles * 256` units long; a fresh item enters at
// the tail with lead gap = capacity - spacing, and advances `speed` units/tick
// until it reaches the head. So ticks-to-head = ceil((cap - spacing) / speed).
TEST(belt_item_travels_end_to_end_in_expected_ticks) {
  FactorySim sim;
  const uint32_t tiles = 10;
  const uint32_t speed = 8;
  EntityHandle belt = sim.addBeltLine(tiles, speed);

  CHECK(sim.line(belt).tryPushTail(/*item*/ 7));
  CHECK(sim.line(belt).itemCount() == 1);
  CHECK(!sim.line(belt).headReady());  // not yet at the head

  const uint32_t cap = tiles * kUnitsPerTile;          // 2560
  const uint32_t startGap = cap - kItemSpacing;        // 2496
  const uint32_t expectedTicks = (startGap + speed - 1) / speed;  // ceil

  uint32_t ticks = 0;
  while (!sim.line(belt).headReady()) {
    sim.line(belt).advance();
    ++ticks;
    CHECK(ticks <= expectedTicks + 1);  // guard against runaway
  }
  CHECK(ticks == expectedTicks);
  CHECK(sim.line(belt).headReady());
  CHECK(sim.line(belt).headItem() == 7);
  // No item created/destroyed in transit (conservation, gate G3).
  CHECK(sim.line(belt).itemCount() == 1);
}

// --- §2.3: head-pop conserves items on a fully saturated line (no global list).
// A saturated 10-tile belt carries 40 items (4/tile); draining the whole line by
// repeated advance+popHead must yield exactly 40 items of the right type — none
// created or destroyed (conservation, gate G3), and the head cursor stays O(1).
TEST(belt_head_pop_conserves_items) {
  FactorySim sim;
  EntityHandle a = sim.addBeltLine(10, 8);
  const uint32_t loaded = sim.line(a).fillSaturated(/*item*/ 3);
  CHECK(loaded == (10u * kUnitsPerTile) / kItemSpacing);  // 40 items
  CHECK(static_cast<uint32_t>(sim.line(a).itemCount()) == loaded);

  // drain: pop head, let the line flow the gap forward, repeat to empty.
  uint32_t popped = 0;
  for (int guard = 0; guard < 1000000 && !sim.line(a).empty(); ++guard) {
    if (sim.line(a).headReady()) {
      ItemId got = sim.line(a).popHead();
      CHECK(got == 3);
      ++popped;
    } else {
      sim.line(a).advance();
    }
  }
  CHECK(popped == loaded);          // conservation: in == out
  CHECK(sim.line(a).empty());
  CHECK(sim.line(a).itemCount() == 0);
}

// --- §1.4: an inserter transfers from a belt head into a machine input. ------
TEST(inserter_transfers_belt_to_machine) {
  FactorySim sim;
  Recipe r;
  r.inputItem = 11;
  r.inputCount = 1;
  r.outputItem = 22;
  r.outputCount = 1;
  r.craftTimeTicks = 5;
  r.powerW = 0;  // unpowered -> no brownout in this test

  EntityHandle belt = sim.addBeltLine(1, 64);  // fast, short
  EntityHandle machine = sim.addMachine(r);
  sim.addInserter(belt, machine, /*item*/ 11);

  // put an item on the belt.
  CHECK(sim.line(belt).tryPushTail(11));

  // step until the inserter has moved the item into the machine input.
  bool transferred = false;
  for (int t = 0; t < 200 && !transferred; ++t) {
    sim.step();
    if (sim.machineInput(machine) >= 1 || sim.machineProgress(machine) > 0 ||
        sim.machineOutput(machine) > 0)
      transferred = true;
  }
  CHECK(transferred);
}

// --- §1.4: a machine completes a recipe and outputs (full power). ------------
TEST(machine_completes_recipe_and_outputs) {
  FactorySim sim;
  Recipe r;
  r.inputItem = 100;
  r.inputCount = 2;
  r.outputItem = 200;
  r.outputCount = 1;
  r.craftTimeTicks = 10;
  r.powerW = 0;

  EntityHandle m = sim.addMachine(r);
  sim.feedMachine(m, 2);  // exactly one craft worth of input

  CHECK(sim.machineOutput(m) == 0);
  // craftTimeTicks ticks at full power -> exactly one output.
  for (uint32_t t = 0; t < r.craftTimeTicks; ++t) sim.step();
  CHECK(sim.machineOutput(m) == 1);
  CHECK(sim.machineInput(m) == 0);  // input consumed

  // no more input -> no further output (no items conjured).
  for (int t = 0; t < 50; ++t) sim.step();
  CHECK(sim.machineOutput(m) == 1);
}

// --- §4: power brownout scales throughput when demand > supply. ---------------
// Two identical machines on two networks: one fully powered, one supplied at
// half its demand. Over the same window the under-supplied machine produces
// ~half as much (proportional brownout, gate G6).
TEST(power_brownout_halves_throughput_at_half_supply) {
  FactorySim sim;
  Recipe r;
  r.inputItem = 1;
  r.inputCount = 1;
  r.outputItem = 2;
  r.outputCount = 1;
  r.craftTimeTicks = 10;
  r.powerW = 1000;

  // Network 1: full supply. Network 2: half supply.
  EntityHandle full = sim.addMachine(r);
  EntityHandle half = sim.addMachine(r);
  sim.setMachineNetwork(full, 1);
  sim.setMachineNetwork(half, 2);
  sim.addGenerator(1, 1000);  // exactly meets demand -> factor 1.0
  sim.addGenerator(2, 500);   // half demand -> factor 0.5

  // keep both fed continuously so power is the only limiter.
  const int window = 600;  // ticks
  for (int t = 0; t < window; ++t) {
    sim.feedMachine(full, 1);
    sim.feedMachine(half, 1);
    sim.step();
  }

  CHECK_NEAR(sim.brownoutRatio(1), 1.0, 1e-6);
  CHECK_NEAR(sim.brownoutRatio(2), 0.5, 1e-6);

  const int outFull = sim.machineOutput(full);
  const int outHalf = sim.machineOutput(half);
  std::printf("    [brownout] full-power output=%d  half-power output=%d\n",
              outFull, outHalf);
  CHECK(outFull > 0);
  // half-power machine produced ~half. Allow a small boundary tolerance.
  const double ratio = static_cast<double>(outHalf) / static_cast<double>(outFull);
  CHECK(ratio > 0.40 && ratio < 0.60);
}

// =============================================================================
// UPDATE-ON-DEMAND (§3, gate G5): with most entities idle, per-tick work
// (the active set) is far below the total entity count.
// =============================================================================
TEST(update_on_demand_active_set_far_below_total) {
  FactorySim sim;
  const int total = 10000;
  std::vector<EntityHandle> belts;
  belts.reserve(total);
  for (int i = 0; i < total; ++i) belts.push_back(sim.addBeltLine(5, 8));

  CHECK(static_cast<int>(sim.entityCount()) == total);

  // Sleep all but ~5% (the idle-base case): only 500 do work.
  const int activeWanted = 500;
  for (int i = activeWanted; i < total; ++i) sim.setActive(belts[i], false);

  const size_t active = sim.activeCount();
  std::printf("    [update-on-demand] total=%d  active=%zu  (%.1f%%)\n", total,
              active, 100.0 * static_cast<double>(active) / total);
  CHECK(static_cast<int>(active) == activeWanted);
  CHECK(active * 10 < static_cast<size_t>(total));  // active << total
}

// =============================================================================
// THE BENCHMARK (§7, gate G1): 100,000 forced-active entities at >= 60 UPS.
//
// A realistic mixed scene (belts + inserters + machines + power), ALL pinned
// active (sleep disabled — the worst case where update-on-demand saves nothing).
// Belts kept near-saturated so millions of items are in flight, proving the
// item/entity decoupling (§2). We run a few hundred fixed ticks, time the hot
// loop with <chrono>, and assert UPS = ticks / wall-seconds >= 60.
// =============================================================================
TEST(benchmark_100k_active_entities_at_60_ups) {
  FactorySim sim;

  // --- Scene mix (§7.2): ~40% belts, ~25% inserters, ~25% machines, ~10% pwr.
  const int N = 100000;
  const int nBelts = N * 40 / 100;       // 40,000 transport lines
  const int nMachines = N * 25 / 100;    // 25,000 machines
  const int nInserters = N * 25 / 100;   // 25,000 inserters
  const int nPower = N - nBelts - nMachines - nInserters;  // ~10,000 generators

  std::vector<EntityHandle> belts;
  belts.reserve(nBelts);
  std::vector<EntityHandle> machines;
  machines.reserve(nMachines);

  Recipe r;
  r.inputItem = 1;
  r.inputCount = 1;
  r.outputItem = 2;
  r.outputCount = 1;
  r.craftTimeTicks = 30;
  r.powerW = 100;

  // Belts: 100 tiles each, FULLY saturated -> ~400 items/belt at min spacing.
  // A saturated 100-tile belt carries ~400 items yet advances in ONE subtraction
  // per tick (§2 latched compression) — this is the item/entity decoupling that
  // lets 40k belt entities carry MILLIONS of in-flight items at near-zero cost.
  long long itemsInFlight = 0;
  for (int i = 0; i < nBelts; ++i) {
    EntityHandle b = sim.addBeltLine(/*tiles*/ kMaxLineTiles, /*speed*/ 8);
    itemsInFlight += sim.line(b).fillSaturated(/*item*/ 2);
    belts.push_back(b);
  }
  for (int i = 0; i < nMachines; ++i) {
    EntityHandle m = sim.addMachine(r);
    sim.setMachineNetwork(m, static_cast<uint16_t>(1 + (i % 64)));  // 64 networks
    sim.feedMachine(m, 4);  // keep them busy
    machines.push_back(m);
  }
  // Inserters pull from a belt head into a machine input (real per-tick work).
  for (int i = 0; i < nInserters; ++i) {
    EntityHandle src = belts[i % nBelts];
    EntityHandle dst = machines[i % nMachines];
    sim.addInserter(src, dst, /*item*/ 2);
  }
  // Generators spread across the 64 networks (supply the machine demand).
  for (int i = 0; i < nPower; ++i)
    sim.addGenerator(static_cast<uint16_t>(1 + (i % 64)), /*supplyW*/ 100000);

  // Force EVERYTHING active — the honest worst case (§7.2 forced-active mode).
  sim.forceAllActive();
  const size_t active = sim.activeCount();
  std::printf("    [benchmark] entities=%zu  active=%zu  belt items in flight=%lld\n",
              sim.entityCount(), active, itemsInFlight);
  CHECK(static_cast<int>(sim.entityCount()) >= N);
  CHECK(active == sim.entityCount());  // all active, no mercy

  // --- Warm-up (cache + branch predictor), then the timed run. --------------
  const int warmup = 20;
  for (int t = 0; t < warmup; ++t) sim.step();

  const int timedTicks = 300;
  auto t0 = std::chrono::steady_clock::now();
  for (int t = 0; t < timedTicks; ++t) sim.step();
  auto t1 = std::chrono::steady_clock::now();

  const double seconds =
      std::chrono::duration<double>(t1 - t0).count();
  const double ups = static_cast<double>(timedTicks) / seconds;
  const double msPerTick = 1000.0 * seconds / timedTicks;

  std::printf(
      "    [benchmark] %d ticks of %zu active entities in %.4f s\n",
      timedTicks, active, seconds);
  std::printf(
      "    [benchmark] ==> %.1f UPS  (%.3f ms/tick, budget 16.67 ms)  "
      "headroom x%.2f\n",
      ups, msPerTick, ups / 60.0);

  // GATE G1: must sustain >= 60 UPS at 100k forced-active entities.
  CHECK(ups >= 60.0);
}
