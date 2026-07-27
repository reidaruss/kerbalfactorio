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

// =============================================================================
// MANUAL PICK-OFF (§2.3): TransportLine::takeAt + FactorySim::TakeLineItemNear.
//
// The player verb "aim at a belt, pull one item off it". popHead only ever
// serves a consumer at the head; these tests pin the property that makes an
// arbitrary-slot removal safe, namely that removing an item does not move any
// OTHER item by a single unit. Because items are stored as gaps rather than
// positions (§2), that property is entirely arithmetic, so every expectation
// below is a literal hand-computed number, never a re-derivation of the code
// under test.
// =============================================================================

// Recompute the §2 invariant straight from the raw line state:
//   headGap + Σ(itemGaps[k], k > head_) + itemCount*kItemSpacing + tailGap
// must equal capacityUnits. This is the check that catches gap arithmetic that
// is subtly wrong: an offset-preserving take that donates the freed span to the
// WRONG end still reads correctly through GetLineItems for one call, and then
// silently mis-sizes the line's remaining room forever after.
static uint32_t gapInvariantSum(const TransportLine& l) {
  uint32_t sum = l.headGap + l.tailGap;
  for (size_t k = l.head_ + 1; k < l.itemGaps.size(); ++k) sum += l.itemGaps[k];
  sum += static_cast<uint32_t>(l.itemCount()) * kItemSpacing;
  return sum;
}

// A hand-built 5-tile line (capacity 1280 units) carrying 4 items whose offsets
// are computed here, once, by hand:
//   headGap     = 100                 -> item 101 at 100
//   itemGaps[1] = 20  (+64 body)      -> item 102 at 100 + 64 + 20 = 184
//   itemGaps[2] = 0   (+64 body)      -> item 103 at 184 + 64 +  0 = 248
//   itemGaps[3] = 36  (+64 body)      -> item 104 at 248 + 64 + 36 = 348
//   tailGap     = 1280 - (100 + 56 + 4*64) = 868
// The gaps are deliberately NON-uniform: on a min-spaced belt every gap is 64
// and so is every item body, which would hide an implementation that confuses
// the two. headGap > 0 on purpose as well, so the line is mid-flow (the state
// popHead is allowed to assume away and a hand pick is not).
static void buildHandLine(TransportLine& l) {
  l = TransportLine{};
  l.capacityUnits = 5 * kUnitsPerTile;  // 1280
  l.speedUnitsPerTick = 8;
  l.headGap = 100;
  l.itemGaps = {0, 20, 0, 36};  // slot 0's entry is unused (its gap IS headGap)
  l.itemTypes = {101, 102, 103, 104};
  l.head_ = 0;
  l.tailGap = 868;
}

// --- Conservation, the headline claim (gate G3 for the new verb). ------------
// N = 12 items (a 3-tile line, 768 units, 4 items per tile). Seven takes, each
// preceded by a deliberately bogus one: a successful take drops the live count
// by EXACTLY one, a refused take by exactly zero, and the ids taken plus the
// ids still on the line add back up to the ids pushed, once each.
TEST(belt_take_at_conserves_items_one_per_take) {
  FactorySim sim;
  EntityHandle belt = sim.addBeltLine(/*tiles*/ 3, /*speed*/ 8);
  const uint32_t N = sim.line(belt).fillSaturated(/*item*/ 1);
  CHECK(N == 12);  // 3 * 256 / 64, hand-computed
  // Distinct ids 101..112 so the multiset comparison below has teeth (a single
  // repeated id would pass even if takeAt returned the wrong slot's item).
  for (uint32_t i = 0; i < N; ++i)
    sim.line(belt).itemTypes[i] = static_cast<ItemId>(101 + i);

  const FEntityId lineId = belt.index;
  CHECK(sim.lineItemCount(lineId) == 12);

  int takenById[12] = {0};
  int successes = 0;
  uint32_t expected = 12;
  for (int i = 0; i < 7; ++i) {
    TransportLine& l = sim.line(belt);
    // Refused take: a slot past the end changes NOTHING, not even the count.
    CHECK(l.takeAt(9999) == kNoItem);
    CHECK(sim.lineItemCount(lineId) == expected);
    const size_t slot = l.head_ + l.itemCount() / 2;  // an interior slot
    const ItemId got = l.takeAt(slot);
    CHECK(got >= 101 && got <= 112);
    if (got >= 101 && got <= 112) takenById[got - 101] += 1;
    ++successes;
    --expected;
    CHECK(sim.lineItemCount(lineId) == expected);
  }
  CHECK(successes == 7);
  CHECK(expected == 5);
  CHECK(sim.lineItemCount(lineId) == 5);  // 12 - 7, hand-computed

  int onLineById[12] = {0};
  for (const FLineItem& it : sim.GetLineItems(lineId)) {
    CHECK(it.ItemType >= 101 && it.ItemType <= 112);
    if (it.ItemType >= 101 && it.ItemType <= 112)
      onLineById[it.ItemType - 101] += 1;
  }
  // multiset(taken) + multiset(still on the line) == multiset(pushed).
  for (int i = 0; i < 12; ++i) CHECK(takenById[i] + onLineById[i] == 1);
}

// --- Nothing else moves: head, interior and last, all three cases. -----------
// Three identical hand-built lines; one item removed from each; every SURVIVING
// offset must compare EXACTLY equal (==, no tolerance) to what it was, and the
// removed item's offset must be gone.
TEST(belt_take_at_moves_no_other_item) {
  FactorySim sim;
  EntityHandle bHead = sim.addBeltLine(5, 8);
  EntityHandle bMid = sim.addBeltLine(5, 8);
  EntityHandle bLast = sim.addBeltLine(5, 8);
  buildHandLine(sim.line(bHead));
  buildHandLine(sim.line(bMid));
  buildHandLine(sim.line(bLast));

  // The fixture, asserted against its hand-computed offsets before any take.
  const std::vector<FLineItem> before = sim.GetLineItems(bHead.index);
  CHECK(before.size() == 4);
  CHECK(before[0].ItemType == 101 && before[0].UnitOffset == 100);
  CHECK(before[1].ItemType == 102 && before[1].UnitOffset == 184);
  CHECK(before[2].ItemType == 103 && before[2].UnitOffset == 248);
  CHECK(before[3].ItemType == 104 && before[3].UnitOffset == 348);

  // (a) HEAD slot. headGap must GROW to swallow the hole (100 + 64 + 20 = 184),
  // not reset to 0 the way popHead does, or the whole line snaps forward.
  TransportLine& lh = sim.line(bHead);
  CHECK(lh.takeAt(lh.head_) == 101);
  CHECK(lh.headGap == 184);
  CHECK(lh.tailGap == 868);  // the head side absorbed it; the tail gained nothing
  const std::vector<FLineItem> afterHead = sim.GetLineItems(bHead.index);
  CHECK(afterHead.size() == 3);
  CHECK(afterHead[0].ItemType == 102 && afterHead[0].UnitOffset == 184);
  CHECK(afterHead[1].ItemType == 103 && afterHead[1].UnitOffset == 248);
  CHECK(afterHead[2].ItemType == 104 && afterHead[2].UnitOffset == 348);
  for (const FLineItem& it : afterHead) CHECK(it.UnitOffset != 100);
  CHECK(gapInvariantSum(lh) == 1280);

  // (b) INTERIOR slot (item 102 at 184). The hole folds into the FOLLOWING
  // item's lead gap: itemGaps[2] becomes 0 + 64 + 20 = 84, so 103 stays at 248.
  TransportLine& lm = sim.line(bMid);
  CHECK(lm.takeAt(lm.head_ + 1) == 102);
  CHECK(lm.headGap == 100);  // untouched: the head end did not move
  CHECK(lm.tailGap == 868);  // untouched: the tail end did not move
  const std::vector<FLineItem> afterMid = sim.GetLineItems(bMid.index);
  CHECK(afterMid.size() == 3);
  CHECK(afterMid[0].ItemType == 101 && afterMid[0].UnitOffset == 100);
  CHECK(afterMid[1].ItemType == 103 && afterMid[1].UnitOffset == 248);
  CHECK(afterMid[2].ItemType == 104 && afterMid[2].UnitOffset == 348);
  for (const FLineItem& it : afterMid) CHECK(it.UnitOffset != 184);
  CHECK(gapInvariantSum(lm) == 1280);

  // (c) LAST slot (item 104 at 348). This is the ONE case that gives room back
  // to the tail: 868 + 64 + 36 = 968.
  TransportLine& lt = sim.line(bLast);
  CHECK(lt.takeAt(lt.itemTypes.size() - 1) == 104);
  CHECK(lt.headGap == 100);
  CHECK(lt.tailGap == 968);
  const std::vector<FLineItem> afterLast = sim.GetLineItems(bLast.index);
  CHECK(afterLast.size() == 3);
  CHECK(afterLast[0].ItemType == 101 && afterLast[0].UnitOffset == 100);
  CHECK(afterLast[1].ItemType == 102 && afterLast[1].UnitOffset == 184);
  CHECK(afterLast[2].ItemType == 103 && afterLast[2].UnitOffset == 248);
  for (const FLineItem& it : afterLast) CHECK(it.UnitOffset != 348);
  CHECK(gapInvariantSum(lt) == 1280);
}

// --- The invariant holds after EVERY take, all the way to empty. -------------
// 12 items on a 3-tile line, drained one at a time through a fixed head /
// interior / tail rotation (no RNG: this core is a determinism core), checking
// the gap sum against capacityUnits after each one.
TEST(belt_take_at_holds_gap_invariant_to_empty) {
  FactorySim sim;
  EntityHandle belt = sim.addBeltLine(3, 8);
  TransportLine& l = sim.line(belt);
  const uint32_t loaded = l.fillSaturated(/*item*/ 5);
  CHECK(loaded == 12);
  CHECK(l.capacityUnits == 768);
  CHECK(gapInvariantSum(l) == 768);  // the fixture itself is balanced

  int rotation = 0;
  int took = 0;
  while (!l.empty()) {
    size_t slot;
    if (rotation % 3 == 0) slot = l.head_;                         // head
    else if (rotation % 3 == 1) slot = l.head_ + l.itemCount() / 2;  // interior
    else slot = l.itemTypes.size() - 1;                            // last
    CHECK(l.takeAt(slot) == 5);
    ++rotation;
    ++took;
    CHECK(gapInvariantSum(l) == 768);
  }
  CHECK(took == 12);  // exactly the number loaded: no take was a silent no-op
  CHECK(l.empty());
  CHECK(gapInvariantSum(l) == 768);
}

// --- Emptying by hand leaves a line indistinguishable from a fresh one. ------
// Drained line vs a belt that was never touched: same push, same offsets.
TEST(belt_take_at_drain_then_refill_matches_a_fresh_line) {
  FactorySim sim;
  EntityHandle used = sim.addBeltLine(3, 8);
  EntityHandle fresh = sim.addBeltLine(3, 8);
  TransportLine& lu = sim.line(used);
  const uint32_t loaded = lu.fillSaturated(/*item*/ 9);
  CHECK(loaded == 12);

  int drained = 0;
  while (!lu.empty()) {
    CHECK(lu.takeAt(lu.head_) == 9);
    ++drained;
  }
  CHECK(drained == 12);
  CHECK(lu.empty());
  CHECK(lu.itemCount() == 0);
  CHECK(sim.lineItemCount(used.index) == 0);
  CHECK(sim.GetLineItems(used.index).empty());
  // Exactly the state addBeltLine leaves behind, field by field.
  CHECK(lu.head_ == 0);
  CHECK(lu.itemGaps.empty());
  CHECK(lu.itemTypes.empty());
  CHECK(lu.headGap == 0);
  CHECK(lu.tailGap == 768);
  CHECK(lu.tailGap == lu.capacityUnits);

  // Refill: the same push on both lines must land the item at the same offset.
  CHECK(lu.tryPushTail(/*item*/ 77));
  CHECK(sim.line(fresh).tryPushTail(/*item*/ 77));
  const std::vector<FLineItem> a = sim.GetLineItems(used.index);
  const std::vector<FLineItem> b = sim.GetLineItems(fresh.index);
  CHECK(a.size() == 1);
  CHECK(b.size() == 1);
  CHECK(a[0].ItemType == 77 && b[0].ItemType == 77);
  CHECK(a[0].UnitOffset == 704);  // capacity 768 - spacing 64, hand-computed
  CHECK(a[0].UnitOffset == b[0].UnitOffset);
  CHECK(lu.headGap == sim.line(fresh).headGap);
  CHECK(lu.tailGap == sim.line(fresh).tailGap);
}

// --- The line still FLOWS after a take, at exactly the belt speed. -----------
// This is the property a naive implementation breaks by rebuilding headGap from
// zero: the picked line and an untouched control line are stepped together, and
// every survivor must have advanced by speed * ticks, no more and no less.
TEST(belt_take_at_leaves_the_line_flowing) {
  FactorySim sim;
  EntityHandle picked = sim.addBeltLine(5, 8);
  EntityHandle control = sim.addBeltLine(5, 8);
  buildHandLine(sim.line(picked));
  buildHandLine(sim.line(control));

  TransportLine& lp = sim.line(picked);
  CHECK(lp.takeAt(lp.head_ + 1) == 102);  // the interior item at 184

  const int ticks = 5;  // 5 ticks * 8 units/tick = 40 units of travel
  for (int t = 0; t < ticks; ++t) sim.step();

  const std::vector<FLineItem> p = sim.GetLineItems(picked.index);
  const std::vector<FLineItem> c = sim.GetLineItems(control.index);
  CHECK(p.size() == 3);
  CHECK(c.size() == 4);
  // Hand-computed: every surviving offset is its pre-take value minus 40.
  CHECK(p[0].ItemType == 101 && p[0].UnitOffset == 60);   // 100 - 40
  CHECK(p[1].ItemType == 103 && p[1].UnitOffset == 208);  // 248 - 40
  CHECK(p[2].ItemType == 104 && p[2].UnitOffset == 308);  // 348 - 40
  // The untouched control line, same arithmetic, including the item that was
  // taken off the other line (144 = 184 - 40).
  CHECK(c[0].UnitOffset == 60);
  CHECK(c[1].UnitOffset == 144);
  CHECK(c[2].UnitOffset == 208);
  CHECK(c[3].UnitOffset == 308);
  // ... and the picked line is the control line minus exactly one row.
  CHECK(p[0].UnitOffset == c[0].UnitOffset);
  CHECK(p[1].UnitOffset == c[2].UnitOffset);
  CHECK(p[2].UnitOffset == c[3].UnitOffset);
  // FS-30. This line used to read `gapInvariantSum(lp) + 40 == 1280`, with the
  // comment "advance() spends headGap, §2.2". It was the ONLY place in 594
  // checks where the invariant was measured across advance(), it saw the
  // violation exactly, and it was written to absorb it. Rule 11's sentence
  // applies literally: assert the property the code claims, never a threshold
  // tuned until it passes. The claim is that the column moving 40 units toward
  // the head hands 40 units back to the tail, so the sum does not move at all.
  CHECK(gapInvariantSum(lp) == 1280);
  CHECK(lp.invariantHolds());
  CHECK(lp.headGap == 60);    // 100 - 40, the lead item really did travel
  CHECK(lp.tailGap == 908);   // 868 + 40, and the tail really did gain it
}

// --- TakeLineItemNear: the aim window, the guards, and the misses. -----------
TEST(take_line_item_near_aim_window_and_guards) {
  FactorySim sim;
  EntityHandle belt = sim.addBeltLine(5, 8);
  buildHandLine(sim.line(belt));
  const FEntityId lineId = belt.index;
  CHECK(sim.lineItemCount(lineId) == 4);

  // A pick at 1000 is 652 units past the last item (348); a 16-unit window
  // misses, and a miss must change nothing at all.
  CHECK(sim.TakeLineItemNear(lineId, 1000, 16) == kNoItem);
  CHECK(sim.lineItemCount(lineId) == 4);
  const std::vector<FLineItem> afterMiss = sim.GetLineItems(lineId);
  CHECK(afterMiss.size() == 4);
  CHECK(afterMiss[0].UnitOffset == 100 && afterMiss[1].UnitOffset == 184);
  CHECK(afterMiss[2].UnitOffset == 248 && afterMiss[3].UnitOffset == 348);

  // A pick at 250: item 103 sits at 248, distance 2, inside a window of 4.
  CHECK(sim.TakeLineItemNear(lineId, 250, 4) == 103);
  CHECK(sim.lineItemCount(lineId) == 3);
  const std::vector<FLineItem> afterHit = sim.GetLineItems(lineId);
  CHECK(afterHit.size() == 3);
  CHECK(afterHit[0].UnitOffset == 100);  // survivors, still exactly in place
  CHECK(afterHit[1].UnitOffset == 184);
  CHECK(afterHit[2].UnitOffset == 348);

  // Distance exactly equal to the window is a HIT (the test is <=): item 101 at
  // 100, pick at 108, window 8.
  CHECK(sim.TakeLineItemNear(lineId, 108, 8) == 101);
  CHECK(sim.lineItemCount(lineId) == 2);
  // One unit further out is a miss: item 102 at 184, pick at 193, window 8.
  CHECK(sim.TakeLineItemNear(lineId, 193, 8) == kNoItem);
  CHECK(sim.lineItemCount(lineId) == 2);

  // Guards, matching GetLineItems / lineItemCount: an id past the entity table,
  // and a live id that is not a belt. Neither may crash.
  CHECK(sim.TakeLineItemNear(99999u, 100, 100000) == kNoItem);
  Recipe r;
  r.inputItem = 1;
  r.outputItem = 2;
  r.craftTimeTicks = 10;
  r.powerW = 0;
  EntityHandle machine = sim.addMachine(r);
  CHECK(sim.TakeLineItemNear(machine.index, 100, 100000) == kNoItem);
  // An empty belt is a miss, not an out-of-bounds read.
  EntityHandle emptyBelt = sim.addBeltLine(2, 8);
  CHECK(sim.TakeLineItemNear(emptyBelt.index, 0, 100000) == kNoItem);
  CHECK(sim.lineItemCount(emptyBelt.index) == 0);
}

// --- Ties resolve toward the HEAD, deterministically. ------------------------
// Two items at 100 and 200; a pick at 150 is exactly 50 from each. Determinism
// (NW-4) means the answer cannot depend on iteration luck: the head-most item
// wins, always.
TEST(take_line_item_near_ties_resolve_toward_the_head) {
  FactorySim sim;
  EntityHandle belt = sim.addBeltLine(5, 8);
  TransportLine& l = sim.line(belt);
  l = TransportLine{};
  l.capacityUnits = 5 * kUnitsPerTile;  // 1280
  l.speedUnitsPerTick = 8;
  l.headGap = 100;              // item 201 at 100
  l.itemGaps = {0, 36};         // item 202 at 100 + 64 + 36 = 200
  l.itemTypes = {201, 202};
  l.head_ = 0;
  l.tailGap = 1280 - (100 + 36 + 2 * 64);  // 1016
  CHECK(l.tailGap == 1016);
  CHECK(gapInvariantSum(l) == 1280);

  const std::vector<FLineItem> before = sim.GetLineItems(belt.index);
  CHECK(before.size() == 2);
  CHECK(before[0].UnitOffset == 100 && before[1].UnitOffset == 200);

  CHECK(sim.TakeLineItemNear(belt.index, 150, 64) == 201);
  const std::vector<FLineItem> after = sim.GetLineItems(belt.index);
  CHECK(after.size() == 1);
  CHECK(after[0].ItemType == 202);
  CHECK(after[0].UnitOffset == 200);  // the survivor did not move
  CHECK(gapInvariantSum(l) == 1280);
}

// --- DW-20 negative control: prove the fixture was real. ---------------------
// Every assertion above is of the form "nothing moved" or "the count dropped".
// A broken build in which takeAt always returned kNoItem, or in which the line
// was empty from the start, could satisfy a careless version of those. This
// test fails in exactly that world: it asserts the belt really was loaded, that
// takes really SUCCEEDED, and that bogus slots really were refused.
TEST(belt_take_at_negative_control_setup_really_had_items) {
  FactorySim sim;
  EntityHandle belt = sim.addBeltLine(3, 8);
  TransportLine& l = sim.line(belt);
  const uint32_t loaded = l.fillSaturated(/*item*/ 42);
  CHECK(loaded == 12);
  CHECK(!l.empty());
  CHECK(sim.lineItemCount(belt.index) == 12);  // the belt was NOT empty

  int succeeded = 0;
  int refused = 0;
  for (int i = 0; i < 4; ++i) {
    if (l.takeAt(l.head_) == 42) ++succeeded;
    if (l.takeAt(l.itemTypes.size() + 500) == kNoItem) ++refused;
  }
  CHECK(succeeded == 4);  // at least one (here four) take actually happened
  CHECK(refused == 4);
  CHECK(sim.lineItemCount(belt.index) == 8);  // 12 - 4, hand-computed
  CHECK(l.head_ == 4);
  // A slot BELOW the head cursor is dead storage, not a live item.
  CHECK(l.takeAt(0) == kNoItem);
  CHECK(l.takeAt(3) == kNoItem);
  CHECK(sim.lineItemCount(belt.index) == 8);

  const std::vector<FLineItem> items = sim.GetLineItems(belt.index);
  CHECK(items.size() == 8);
  for (const FLineItem& it : items) CHECK(it.ItemType == 42);
  CHECK(gapInvariantSum(l) == 768);
}

// =============================================================================
// FS-30 — THE GAP INVARIANT, ASSERTED DIRECTLY, ON EVERY OPERATION.
//
// Why these exist, which matters more than what they check. Three defects in
// this struct's gap accounting survived 594 green checks for months, and the
// belt they produced carried ONE item however hard it was fed. The suite missed
// them by a mechanism worth naming, because it is reusable and it is still
// sitting in other suites:
//
//   1. EVERY test of a FULL belt built its fullness with fillSaturated(), which
//      writes the end state directly. Its own doc comment claims it "models a
//      belt that has been running and is full" — which is exactly the claim it
//      was standing in for, and exactly the claim that was false. A fixture that
//      constructs the state the production path is supposed to REACH is a second
//      implementation of that state, and only the fixture was ever run.
//   2. EVERY test of tryPushTail pushed exactly ONE item. So the operation that
//      fills a belt and the state of a filled belt were tested on opposite sides
//      of a gap that no test ever crossed.
//   3. The invariant helper existed, and was applied to ONE of the five mutating
//      operations. Where it met advance() (belt_take_at_leaves_the_line_flowing)
//      the assertion was written as `sum + 40 == 1280` with a comment naming the
//      violation as intended behaviour.
//
// So the closure is not "add a check for a one-item belt". It is: state the
// invariant ON THE STRUCT (TransportLine::invariantHolds), assert it after every
// operation rather than after one, and PIN THE FIXTURE AGAINST THE PRODUCTION
// PATH so a setup shortcut can never again quietly disagree with the code it
// stands in for.
// =============================================================================

// --- Every mutating operation preserves the invariant, in one driven walk. ---
// Push, advance, pop, and all three erasing takeAt cases, interleaved, on a line
// that is alternately flowing, saturated and blocked. The invariant is checked
// after EVERY call, and the counters at the bottom are the DW-20 negative
// control: a build in which nothing ever happened would satisfy every invariant
// check trivially, so the test also asserts that each operation really fired.
TEST(belt_gap_invariant_holds_after_every_operation) {
  FactorySim sim;
  EntityHandle belt = sim.addBeltLine(/*tiles*/ 4, /*speed*/ 8);
  TransportLine& l = sim.line(belt);
  CHECK(l.capacityUnits == 1024);
  CHECK(l.maxItems() == 16);  // 1024 / 64, hand-computed
  CHECK(l.invariantHolds());

  int pushed = 0, refusedPush = 0, advanced = 0, popped = 0, taken = 0;
  int sawFull = 0, sawBlocked = 0;
  for (int tick = 0; tick < 4000; ++tick) {
    // A feeder that never gives up: it offers an item every single tick.
    if (l.tryPushTail(static_cast<ItemId>(200 + (tick % 7)))) ++pushed;
    else ++refusedPush;
    CHECK(l.invariantHolds());

    l.advance();
    ++advanced;
    CHECK(l.invariantHolds());

    if (static_cast<uint32_t>(l.itemCount()) == l.maxItems()) ++sawFull;
    if (l.headReady()) ++sawBlocked;

    // Drain at the head every 40 ticks (a slow consumer), and pull one off by
    // hand every 137 ticks (a player), so all the takeAt cases are exercised
    // against a line that is genuinely mid-flow rather than hand-built.
    if (tick % 40 == 39 && l.headReady()) {
      CHECK(l.popHead() != kNoItem);
      ++popped;
      CHECK(l.invariantHolds());
    }
    if (tick % 137 == 136 && !l.empty()) {
      const size_t n = l.itemCount();
      size_t slot = l.head_;                                        // head case
      if (n > 2 && (tick / 137) % 3 == 1) slot = l.head_ + n / 2;    // interior
      if (n > 2 && (tick / 137) % 3 == 2) slot = l.itemTypes.size() - 1;  // last
      if (l.takeAt(slot) != kNoItem) ++taken;
      CHECK(l.invariantHolds());
    }
    // The ceiling is arithmetic, not a second constant: a line can never hold
    // more items than its own length admits. This is the assertion that fails
    // against popHead's old `tailGap += kItemSpacing`, which minted one item of
    // belt per pop and let a long-running line grow past its own capacity.
    CHECK(l.itemCount() <= l.maxItems());
  }

  // Negative control (DW-20): prove the walk above was not a long list of
  // no-ops. Every branch must have fired, and the belt must genuinely have
  // reached saturation and genuinely have blocked at the head.
  CHECK(pushed > 100);       // items really boarded, repeatedly
  CHECK(refusedPush > 100);  // and the belt really did fill up and refuse
  CHECK(advanced == 4000);
  CHECK(popped >= 50);       // the consumer really drained the head
  CHECK(taken >= 20);        // the player really picked items off
  CHECK(sawFull > 0);        // the line really reached maxItems()
  CHECK(sawBlocked > 0);     // and really sat blocked at the head
  CHECK(l.invariantHolds());
}

// --- THE CLASS-CLOSING TEST: the fixture must equal the production path. -----
// fillSaturated() is a setup shortcut that WRITES the state of a full belt.
// Feeding a belt through tryPushTail() + advance() is the code a real drill
// runs. Those are two independent implementations of "a saturated line", and
// for months only the shortcut was ever executed while every claim about full
// belts was read off it. So: build one of each and compare them FIELD BY FIELD.
//
// The terminal state is not a coincidence of the belt speed, so it is proved at
// two kinds of speed: one that divides kItemSpacing exactly (8, so one item
// boards every 8 ticks) and one that does not (12, so a push happens whenever
// tailGap crosses 64 and leaves a different remainder each time). Both must
// converge on the same bytes, because the invariant forces them to: a min-spaced
// line of n items has headGap + tailGap == capacityUnits - n*kItemSpacing, and a
// line fed until it refuses and advanced until it blocks has headGap == 0 and
// tailGap < kItemSpacing.
static void pushFilledEqualsFillSaturated(uint32_t tiles, uint32_t speed) {
  FactorySim sim;
  EntityHandle fed = sim.addBeltLine(tiles, speed);
  EntityHandle set = sim.addBeltLine(tiles, speed);
  TransportLine& lf = sim.line(fed);
  TransportLine& ls = sim.line(set);

  const uint32_t written = ls.fillSaturated(/*item*/ 55);
  int boarded = 0;
  for (int tick = 0; tick < 5000; ++tick) {
    if (lf.tryPushTail(/*item*/ 55)) ++boarded;
    lf.advance();
  }

  // The headline: the two roads arrive at the same belt.
  CHECK(static_cast<uint32_t>(boarded) == written);
  CHECK(lf.itemCount() == ls.itemCount());
  CHECK(static_cast<uint32_t>(lf.itemCount()) == lf.maxItems());
  CHECK(lf.headGap == ls.headGap);
  CHECK(lf.tailGap == ls.tailGap);
  CHECK(lf.headGap == 0);          // the column reached the head
  CHECK(lf.tailGap == 0);          // and the belt is packed to its own end
  CHECK(lf.fullyCompressed == ls.fullyCompressed);
  CHECK(lf.fullyCompressed);       // latched by advance(), not by the fixture
  CHECK(lf.isMinSpaced() && ls.isMinSpaced());
  CHECK(lf.invariantHolds() && ls.invariantHolds());
  // ... and the items are at the same offsets, which is the only comparison a
  // renderer or a hand-pick actually cares about.
  const std::vector<FLineItem> af = sim.GetLineItems(fed.index);
  const std::vector<FLineItem> as = sim.GetLineItems(set.index);
  CHECK(af.size() == as.size());
  for (size_t i = 0; i < af.size() && i < as.size(); ++i)
    CHECK(af[i].UnitOffset == as[i].UnitOffset);
  // Negative control: this comparison is only worth anything if the belt was
  // not empty and the feeder was not a no-op.
  CHECK(written > 0 && boarded > 0);
}

TEST(belt_filled_by_pushing_matches_the_fillSaturated_fixture) {
  pushFilledEqualsFillSaturated(/*tiles*/ 3, /*speed*/ 8);    // 12 items
  pushFilledEqualsFillSaturated(/*tiles*/ 10, /*speed*/ 8);   // 40 items
  pushFilledEqualsFillSaturated(/*tiles*/ 10, /*speed*/ 12);  // speed not a divisor
  pushFilledEqualsFillSaturated(/*tiles*/ 1, /*speed*/ 32);   // one tile, turbo
}

// --- What a saturated belt carries, stated as a number. ----------------------
// The single sentence this whole change is about: a belt carries a COLUMN of
// items. Every count below is capacity/spacing, computed by hand. Against the
// pre-FS-30 code every one of these reads 1.
TEST(belt_fed_continuously_carries_a_full_column) {
  const uint32_t tiles[] = {1, 3, 5, 10, 20};
  const uint32_t expect[] = {4, 12, 20, 40, 80};
  for (int c = 0; c < 5; ++c) {
    FactorySim sim;
    EntityHandle belt = sim.addBeltLine(tiles[c], 8);
    TransportLine& l = sim.line(belt);
    uint32_t peak = 0;
    for (int tick = 0; tick < 6000; ++tick) {
      l.tryPushTail(/*item*/ 3);
      l.advance();
      if (l.itemCount() > peak) peak = static_cast<uint32_t>(l.itemCount());
    }
    CHECK(peak == expect[c]);
    CHECK(peak == l.maxItems());
    CHECK(l.invariantHolds());
  }
}

// --- popHead may not mint belt, and advance() may not consume it. ------------
// The two halves of the old accounting error, isolated from each other so
// neither can hide behind the other's cancellation. Each block below fails
// against the pre-FS-30 code, in a different direction.
TEST(belt_pop_and_advance_each_conserve_the_line_length) {
  // (a) popHead in isolation: ONE pop off a saturated line, nothing else. The
  //     freed body is charged to the head side, so the tail may not gain a unit.
  {
    FactorySim sim;
    EntityHandle belt = sim.addBeltLine(3, 8);
    TransportLine& l = sim.line(belt);
    CHECK(l.fillSaturated(/*item*/ 4) == 12);
    CHECK(l.tailGap == 0);       // packed to its own end
    CHECK(l.headReady());
    CHECK(l.popHead() == 4);
    CHECK(l.tailGap == 0);       // OLD: 64. Nothing at the tail moved.
    CHECK(l.headGap == 64);      // the new lead has one body-length to travel
    CHECK(l.invariantHolds());   // OLD: 832 after one pop, and growing
    // Drain the rest, advancing the 64 units between each pop.
    int pops = 1;
    for (int guard = 0; guard < 100000 && !l.empty(); ++guard) {
      if (l.headReady()) { CHECK(l.popHead() == 4); ++pops; }
      else l.advance();
      CHECK(l.invariantHolds());
    }
    CHECK(pops == 12);                    // conservation: 12 in, 12 out
    CHECK(l.empty());
    CHECK(l.tailGap == l.capacityUnits);  // 768 exactly, not 768 + 12*64
    CHECK(l.headGap == 0);
  }
  // (b) advance() alone: one item walked the length of a 10-tile line.
  {
    FactorySim sim;
    EntityHandle belt = sim.addBeltLine(10, 8);
    TransportLine& l = sim.line(belt);
    CHECK(l.tryPushTail(/*item*/ 6));
    CHECK(l.headGap == 2496);  // 2560 - 64, hand-computed
    CHECK(l.tailGap == 0);     // an item standing on the last 64 units
    int ticks = 0;
    while (!l.headReady() && ticks < 10000) { l.advance(); ++ticks; }
    CHECK(ticks == 312);       // 2496 / 8, hand-computed
    CHECK(l.headGap == 0);
    CHECK(l.tailGap == 2496);  // OLD: 0 forever, which IS the one-item belt
    CHECK(l.invariantHolds()); // OLD: 64, i.e. 2496 units of belt evaporated
    // The consequence, in one line: a second item can now follow the first.
    CHECK(l.tryPushTail(/*item*/ 6));
    CHECK(l.itemCount() == 2);
  }
  // (c) a long-running line can never exceed its own length. This is the
  //     observable the belt lane predicted from the arithmetic: pop-and-refill
  //     for 20,000 ticks used to hand the tail 64 free units per pop.
  {
    FactorySim sim;
    EntityHandle belt = sim.addBeltLine(2, 8);
    TransportLine& l = sim.line(belt);
    int pops = 0;
    for (int tick = 0; tick < 20000; ++tick) {
      l.tryPushTail(/*item*/ 9);
      l.advance();
      if (l.headReady()) { l.popHead(); ++pops; }
      CHECK(l.itemCount() <= l.maxItems());
    }
    CHECK(pops > 1000);   // negative control: the line really was churning
    CHECK(l.maxItems() == 8);
    CHECK(l.invariantHolds());
  }
}

// --- FS-32, pinned rather than fixed: a blocked line does not compress. ------
// While headGap == 0 the whole line is frozen, so an interior gap left by a
// hand pick does NOT close up behind a stalled belt the way Factorio's would.
// That is invariant-preserving (the layout still fits) and it is a real
// behavioural difference, so it is pinned here with its number rather than left
// to be rediscovered. When FS-32 lands, this is the test that must change, and
// it says so here so that changing it reads as intent rather than as breakage.
TEST(belt_blocked_line_does_not_compress_interior_gaps) {
  FactorySim sim;
  EntityHandle belt = sim.addBeltLine(3, 8);
  TransportLine& l = sim.line(belt);
  CHECK(l.fillSaturated(/*item*/ 7) == 12);
  CHECK(l.headReady());  // head blocked: no consumer

  // Pull an interior item off. FS-29's rule donates the freed span (one body of
  // kItemSpacing, plus the removed item's own extra gap, which is 0 on a
  // min-spaced line) to the FOLLOWING item's lead gap, so no surviving offset
  // moves. After the erase that gap sits at the same index the removed item had.
  const size_t mid = l.head_ + 6;
  CHECK(l.takeAt(mid) == 7);
  CHECK(l.itemGaps[mid] == 64);  // 64 body + 0 extra, hand-computed
  CHECK(l.invariantHolds());

  const std::vector<FLineItem> before = sim.GetLineItems(belt.index);
  for (int tick = 0; tick < 600; ++tick) l.advance();
  const std::vector<FLineItem> after = sim.GetLineItems(belt.index);

  // Nothing moved, because the head is blocked and nothing behind it slides.
  CHECK(before.size() == 11 && after.size() == 11);
  for (size_t i = 0; i < before.size() && i < after.size(); ++i)
    CHECK(before[i].UnitOffset == after[i].UnitOffset);
  CHECK(l.itemGaps[mid] == 64);  // the hole is still open: THIS is FS-32
  CHECK(l.tailGap == 0);         // and the freed room is stranded in the middle
  // The sharpest statement of the cost: the belt refuses a new item at the tail
  // while carrying a whole item's worth of free space in its own middle. In
  // Factorio the column behind the hole would slide forward and close it.
  CHECK(!l.tryPushTail(/*item*/ 8));
  CHECK(l.itemCount() == 11);
  CHECK(l.invariantHolds());
}
