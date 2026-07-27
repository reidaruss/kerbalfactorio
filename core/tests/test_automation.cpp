// Phase-1 headless tests for the BUILDABLE AUTO-LINE (automation.h over
// factory_sim.h). Proves a Factorio-style production line runs END-TO-END with
// NO manual feeding — every item propagates on step():
//
//     deposit -> MINER -> belt -> SMELTER -> belt -> ASSEMBLER -> output
//
// Assertions:
//   - End-to-end flow: ore mined, carried on belts, smelted to ingots, assembled
//     into a part — the assembler PRODUCES output, fed only by the miner.
//   - Deposit depletes and the miner STOPS when empty (no item from nothing).
//   - Multi-input assembler: a 2nd ingredient gates the craft (real Recipe path).
//   - Determinism: two identical builds stepped the same N ticks match bit-for-bit.
//   - The buildable API surface (place* / connect / query) is exercised exactly
//     as the UE placement layer will call it.
#include <cstdio>

#include "test_framework.h"
#include "of/automation.h"
#include "of/deposits.h"

using namespace of::automation;
namespace survival = of::worldgen::survival;

namespace {

// Item ids for the chain (opaque keys; mirror gameplay's id space loosely).
constexpr ItemId kOre    = 0x0033;  // raw iron ore (from the deposit)
constexpr ItemId kIngot  = 0x0010;  // smelted iron ingot
constexpr ItemId kCopper = 0x0011;  // a second ingredient for the assembler
constexpr ItemId kPart   = 0x0040;  // the crafted part (assembler output)

// Build the pure auto-line: deposit -> miner -> belt -> smelter -> belt ->
// assembler -> part, with a SINGLE-ingredient assembler (1 ingot -> 1 part) so
// the ENTIRE chain is fed only by the miner — no manual feeding, no side supply.
// (The multi-input assembler gate is proven separately.) Returns handles by
// out-param so the test can query each stage.
struct Chain {
  BuildId miner, belt1, smelter, belt2, assembler;
  EntityHandle insMinerToBelt1, insBelt1ToSmelter, insSmelterToBelt2,
      insBelt2ToAssembler;
};

BuildableNetwork buildChain(Chain& c, uint64_t depositAmount) {
  BuildableNetwork net;
  // Short belts + brisk craft times so the chain fills within a few k ticks.
  c.miner   = net.placeMinerOnDeposit(depositAmount, kOre, /*rate/s*/ 8.0,
                                      /*outCap*/ 50);
  c.belt1   = net.placeBelt(/*tiles*/ 2, /*speed*/ 32);
  c.smelter = net.placeSmelter(kOre, kIngot, /*craftTicks*/ 20);
  c.belt2   = net.placeBelt(/*tiles*/ 2, /*speed*/ 32);
  // Assembler: 1 ingot -> 1 part (single ingredient = the full auto-line output).
  c.assembler = net.placeAssembler(kIngot, 1, kNoItem, 0, kPart, 1,
                                   /*craftTicks*/ 25);

  // Wire the line — this is ALL the feeding there is. No feedMachine() anywhere.
  c.insMinerToBelt1     = net.connect(c.miner, c.belt1);       // miner -> belt
  c.insBelt1ToSmelter   = net.connect(c.belt1, c.smelter);     // belt -> smelter
  c.insSmelterToBelt2   = net.connect(c.smelter, c.belt2);     // smelter -> belt
  c.insBelt2ToAssembler = net.connect(c.belt2, c.assembler);   // belt -> assembler
  return net;
}

}  // namespace

// =============================================================================
// END-TO-END: ore flows mine->belt->smelt->belt->assemble with NO manual feed.
// The assembler produces parts, fed ENTIRELY by the miner through the auto-line.
// Items must be observed on belts AND in machine buffers in transit (real
// propagation, not a teleport).
// =============================================================================
TEST(auto_line_flows_end_to_end_no_manual_feeding) {
  Chain c;
  BuildableNetwork net = buildChain(c, /*deposit*/ 100000);

  // Nothing produced yet.
  CHECK(net.producedCountOf(kPart) == 0);

  // Run the line. Watch for items in flight + final assembler output.
  bool sawOreMined = false, sawItemOnBelt1 = false, sawIngot = false;
  for (int t = 0; t < 5000; ++t) {
    net.step();
    if (net.producedCountOf(kOre) > 0) sawOreMined = true;
    if (net.beltItemCount(c.belt1) > 0) sawItemOnBelt1 = true;
    if (net.producedCountOf(kIngot) > 0) sawIngot = true;
  }

  std::printf("    [e2e] ore mined=%llu  ingots=%llu  parts=%llu  "
              "deposit left=%llu\n",
              (unsigned long long)net.producedCountOf(kOre),
              (unsigned long long)net.producedCountOf(kIngot),
              (unsigned long long)net.producedCountOf(kPart),
              (unsigned long long)net.minerRemaining(c.miner));

  // Each stage of the chain actually carried items.
  CHECK(sawOreMined);                       // the miner extracted ore
  CHECK(sawItemOnBelt1);                     // ore rode belt 1 (real transport)
  CHECK(sawIngot);                           // the smelter made ingots
  CHECK(net.producedCountOf(kIngot) > 0);    // ingots produced
  CHECK(net.producedCountOf(kPart) > 0);     // THE ASSEMBLER PRODUCED PARTS
  // The chain is fed only by the miner -> parts are bounded by mined ore.
  CHECK(net.producedCountOf(kPart) <= net.producedCountOf(kIngot));
}

// =============================================================================
// DEPOSIT DEPLETES + MINER STOPS. A small deposit must run dry; the miner then
// produces no more ore, and the downstream chain drains and halts. No item from
// nothing.
// =============================================================================
TEST(miner_depletes_deposit_and_stops) {
  Chain c;
  const uint64_t deposit = 40;  // small: the miner will exhaust it
  BuildableNetwork net = buildChain(c, deposit);

  // Run long enough to fully drain a 40-unit deposit at 8 ore/s.
  for (int t = 0; t < 20000; ++t) net.step();

  std::printf("    [deplete] deposit left=%llu  ore mined=%llu  ingots=%llu\n",
              (unsigned long long)net.minerRemaining(c.miner),
              (unsigned long long)net.producedCountOf(kOre),
              (unsigned long long)net.producedCountOf(kIngot));

  // Deposit fully depleted, miner stopped.
  CHECK(net.minerRemaining(c.miner) == 0);
  CHECK(net.minerDepleted(c.miner));
  // Exactly the deposit's worth of ore was ever mined — never more (no minting).
  CHECK(net.producedCountOf(kOre) == deposit);

  // After depletion, more ticks produce no further ore.
  const uint64_t oreAfter = net.producedCountOf(kOre);
  for (int t = 0; t < 2000; ++t) net.step();
  CHECK(net.producedCountOf(kOre) == oreAfter);   // miner truly stopped
}

// =============================================================================
// MULTI-INPUT GATE. An assembler with a 2nd ingredient cannot craft until BOTH
// ingredients are present — proving the real Recipe multi-input path. Here the
// ingot arm flows from the miner but the copper arm is withheld: zero parts.
// Then supply copper: parts appear. (Isolated assembler, no downstream.)
// =============================================================================
TEST(assembler_multi_input_gates_on_both_ingredients) {
  BuildableNetwork net;
  // Assembler alone, hand-stocked on slot 1 only (via a belt), copper withheld.
  BuildId asm1 = net.placeAssembler(kIngot, 1, kCopper, 1, kPart, 1,
                                    /*craftTicks*/ 10);
  BuildId ingotBelt = net.placeBelt(1, 32);
  net.sim().line(ingotBelt.entity).fillSaturated(kIngot);
  net.connect(ingotBelt, asm1);   // ingot arm flowing; copper arm empty

  for (int t = 0; t < 2000; ++t) net.step();
  std::printf("    [gate] ingot-only parts=%llu (expect 0)  in1=%u in2=%u\n",
              (unsigned long long)net.producedCountOf(kPart),
              net.inputBuffer(asm1), net.input2Buffer(asm1));
  // No copper -> no parts, even with ingots piling up on slot 1.
  CHECK(net.producedCountOf(kPart) == 0);
  CHECK(net.inputBuffer(asm1) > 0);     // ingots accumulated, waiting on copper

  // Now feed the copper arm: parts must start flowing.
  BuildId copperBelt = net.placeBelt(1, 32);
  net.sim().line(copperBelt.entity).fillSaturated(kCopper);
  net.connect(copperBelt, asm1);
  for (int t = 0; t < 2000; ++t) net.step();
  std::printf("    [gate] after copper parts=%llu (expect >0)\n",
              (unsigned long long)net.producedCountOf(kPart));
  CHECK(net.producedCountOf(kPart) > 0);  // both ingredients -> craft proceeds
}

// =============================================================================
// DETERMINISM (NW-4): two identical builds, stepped the same N ticks, produce
// bit-identical results at every queryable stage. The auto-line is deterministic.
// =============================================================================
TEST(auto_line_is_deterministic) {
  Chain a, b;
  BuildableNetwork na = buildChain(a, /*deposit*/ 5000);
  BuildableNetwork nb = buildChain(b, /*deposit*/ 5000);

  const int N = 4000;
  for (int t = 0; t < N; ++t) { na.step(); nb.step(); }

  std::printf("    [determinism] A ore=%llu ingot=%llu part=%llu | "
              "B ore=%llu ingot=%llu part=%llu\n",
              (unsigned long long)na.producedCountOf(kOre),
              (unsigned long long)na.producedCountOf(kIngot),
              (unsigned long long)na.producedCountOf(kPart),
              (unsigned long long)nb.producedCountOf(kOre),
              (unsigned long long)nb.producedCountOf(kIngot),
              (unsigned long long)nb.producedCountOf(kPart));

  CHECK(na.producedCountOf(kOre)   == nb.producedCountOf(kOre));
  CHECK(na.producedCountOf(kIngot) == nb.producedCountOf(kIngot));
  CHECK(na.producedCountOf(kPart)  == nb.producedCountOf(kPart));
  CHECK(na.minerRemaining(a.miner) == nb.minerRemaining(b.miner));
  CHECK(na.outputBuffer(a.smelter) == nb.outputBuffer(b.smelter));
  CHECK(na.beltItemCount(a.belt1)  == nb.beltItemCount(b.belt1));
  CHECK(na.tickIndex() == nb.tickIndex());
  CHECK(na.producedCountOf(kPart) > 0);  // and the deterministic run is non-trivial
}

// =============================================================================
// MINER RATE + DEPLETION ARITHMETIC. A standalone miner extracts at its rate and
// the lifetime-mined total equals the deposit when fully drained — the fixed-
// point rate accumulates exactly (no float drift), bounded by the deposit.
// =============================================================================
TEST(miner_rate_is_exact_and_deposit_bounded) {
  BuildableNetwork net;
  const uint64_t deposit = 600;
  // 60 ore/s at 60 UPS = exactly 1 ore/tick; unbounded out buffer (no inserter,
  // so the buffer just fills — we measure raw extraction).
  BuildId miner = net.placeMinerOnDeposit(deposit, kOre, /*rate/s*/ 60.0,
                                          /*outCap*/ 0);
  // 600 ore at 1/tick -> drained in 600 ticks.
  for (int t = 0; t < 600; ++t) net.step();
  std::printf("    [rate] after 600 ticks mined=%llu left=%llu\n",
              (unsigned long long)net.producedCountOf(kOre),
              (unsigned long long)net.minerRemaining(miner));
  CHECK(net.producedCountOf(kOre) == deposit);   // exactly the deposit, drained
  CHECK(net.minerRemaining(miner) == 0);
  // Further ticks add nothing (depleted).
  for (int t = 0; t < 100; ++t) net.step();
  CHECK(net.producedCountOf(kOre) == deposit);
}

// =============================================================================
// placeMinerForNode: the miner infers the mined ItemId from the worldgen survival
// NodeKind (deposits.h §S resourceOf) — no hand mapping in the UE layer. The mined
// item must equal survival::resourceOf(kind) for several kinds, and the miner must
// otherwise behave exactly like placeMinerOnDeposit (extract + deplete + stop).
// =============================================================================
TEST(place_miner_for_node_mines_kinds_resource) {
  struct Case { survival::NodeKind kind; ItemId expect; };
  const Case cases[] = {
      {survival::NodeKind::IronOre,   survival::kItemRawIron},
      {survival::NodeKind::CopperOre, survival::kItemRawCopper},
      {survival::NodeKind::CoalSeam,  survival::kItemCoal},
      {survival::NodeKind::Tree,      survival::kItemWood},
  };
  for (const Case& cs : cases) {
    BuildableNetwork net;
    const uint64_t deposit = 30;
    BuildId miner = net.placeMinerForNode(cs.kind, deposit, /*rate/s*/ 60.0,
                                          /*outCap*/ 0);
    // resourceOf is the contract the overload binds to.
    CHECK(survival::resourceOf(cs.kind) == cs.expect);
    // Drain the deposit: every produced unit is the kind's resource id, and the
    // miner stops exactly at the deposit amount (same depletion as placeMinerOnDeposit).
    for (uint64_t t = 0; t < deposit + 50; ++t) net.step();
    std::printf("    [node] kind=%u item=0x%04X mined=%llu left=%llu\n",
                (unsigned)cs.kind, (unsigned)cs.expect,
                (unsigned long long)net.producedCountOf(cs.expect),
                (unsigned long long)net.minerRemaining(miner));
    CHECK(net.producedCountOf(cs.expect) == deposit);   // mined the right item
    CHECK(net.minerDepleted(miner));                    // and stopped at empty
  }
}

// =============================================================================
// working() / progress01(): the per-building craft probe the UE HUD reads through
// the facade (no sim().entityVisualState reach-through). A smelter reports
// not-working / progress 0 while idle, then working / rising progress mid-craft,
// reaching ~1.0 just before completion; a miner reports working while it has ore;
// a belt reports working while it carries items. Deterministic across two builds.
// =============================================================================
TEST(working_and_progress01_track_craft_state) {
  BuildableNetwork net;
  // A lone smelter with a LONG craft so we can watch progress climb. Hand-feed it
  // one ore so it crafts exactly once (no upstream noise).
  const uint32_t craftTicks = 100;
  BuildId smelter = net.placeSmelter(kOre, kIngot, craftTicks);

  // Idle (unfed): not working, progress 0.
  CHECK(!net.working(smelter));
  CHECK(net.progress01(smelter) == 0.0);

  // Feed one ore -> the craft starts on the next step.
  net.sim().feedMachine(smelter.entity, 1);
  net.step();                          // craft begins this tick
  CHECK(net.working(smelter));         // now crafting
  const double pEarly = net.progress01(smelter);
  CHECK(pEarly > 0.0);                 // some progress accrued
  CHECK(pEarly < 0.5);                 // but early in a 100-tick craft

  // Step to near the END of the craft and watch progress rise toward 1.0.
  for (uint32_t t = 0; t < craftTicks - 3; ++t) net.step();
  const double pLate = net.progress01(smelter);
  std::printf("    [progress] early=%.3f late=%.3f produced=%llu\n", pEarly, pLate,
              (unsigned long long)net.producedCountOf(kIngot));
  CHECK(pLate > pEarly);               // monotonically rising
  CHECK(pLate > 0.9);                  // ~1.0 just before completion
  CHECK(net.progress01(smelter) <= 1.0);  // always clamped

  // Finish the craft: output emitted, machine returns to idle (not working, 0).
  for (int t = 0; t < 5; ++t) net.step();
  CHECK(net.producedCountOf(kIngot) >= 1);
  CHECK(!net.working(smelter));
  CHECK(net.progress01(smelter) == 0.0);

  // Miner: working while it has ore, progress01 is 0 (no craft cycle).
  BuildId miner = net.placeMinerForNode(survival::NodeKind::IronOre, 5, 60.0, 0);
  CHECK(net.working(miner));
  CHECK(net.progress01(miner) == 0.0);
  for (int t = 0; t < 50; ++t) net.step();   // drain the 5-unit deposit
  CHECK(!net.working(miner));                // depleted -> not working

  // Belt: working only while it carries items.
  BuildId belt = net.placeBelt(2, 32);
  CHECK(!net.working(belt));                  // empty belt: idle
  net.sim().line(belt.entity).fillSaturated(kOre);
  CHECK(net.working(belt));                   // now carrying items
  CHECK(net.progress01(belt) == 0.0);         // belts have no craft progress

  // Invalid handle is safe.
  BuildId none;
  CHECK(!net.working(none));
  CHECK(net.progress01(none) == 0.0);
}

// =============================================================================
// DETERMINISM of the new probes: two identical lone-smelter builds report
// bit-identical working()/progress01() at the same tick.
// =============================================================================
TEST(working_and_progress01_are_deterministic) {
  BuildableNetwork na, nb;
  BuildId sa = na.placeSmelter(kOre, kIngot, 80);
  BuildId sb = nb.placeSmelter(kOre, kIngot, 80);
  na.sim().feedMachine(sa.entity, 1);
  nb.sim().feedMachine(sb.entity, 1);
  for (int t = 0; t < 40; ++t) { na.step(); nb.step(); }
  CHECK(na.working(sa) == nb.working(sb));
  CHECK(na.progress01(sa) == nb.progress01(sb));   // exact bit-for-bit (fixed-point)
  CHECK(na.progress01(sa) > 0.0);                  // non-trivial
}

// =============================================================================
// FS-30 — THROUGHPUT ON A REAL DRILL -> BELT -> SMELTER LINE.
//
// The primitive-level proof lives in test_factory_sim.cpp. This is the same
// change measured where a player meets it: the exact scene the client builds in
// FactoryCommit.ts (belt speed 8 units/tick, smelter 60 ticks), driven for 60
// seconds of sim time, with every number below hand-derived BEFORE it was read
// off the code. Against the pre-FS-30 accounting this test fails on almost every
// line, because the belt carried one ore however hard the drill ran.
// =============================================================================
TEST(auto_line_belt_carries_a_column_and_throughput_follows_the_drill) {
  BuildableNetwork net;
  // 4 ore/s drill, a 10-tile belt, a 60-tick smelter. 3,600 ticks = 60 s.
  BuildId miner = net.placeMinerOnDeposit(/*deposit*/ 1000000, kOre,
                                          /*ratePerSecond*/ 4.0, /*outCap*/ 50);
  BuildId belt = net.placeBelt(/*tiles*/ 10, /*speed*/ 8);
  BuildId smelter = net.placeSmelter(kOre, kIngot, /*craftTicks*/ 60);
  net.connect(miner, belt);
  net.connect(belt, smelter);

  const of::factory::TransportLine& line = net.sim().line(belt.entity);
  CHECK(line.capacityUnits == 2560);  // 10 tiles * 256
  CHECK(line.maxItems() == 40);       // 2560 / 64

  uint32_t peak = 0;
  int invariantBreaks = 0;
  for (int t = 0; t < 3600; ++t) {
    net.step();
    const uint32_t n = net.beltItemCount(belt);
    if (n > peak) peak = n;
    if (!line.invariantHolds()) ++invariantBreaks;
  }

  // The invariant holds on a driven line, tick by tick, not just in a unit test.
  CHECK(invariantBreaks == 0);

  // Ore: 4/s for 60 s. The +1 is the fixed-point extraction accumulator
  // (milli-units/tick) freeing one extra whole unit inside the window.
  CHECK(net.producedCountOf(kOre) == 241);  // OLD: 63, capped by a 50-unit buffer

  // Ingots: the smelter runs one 60-tick craft per second and is the bottleneck,
  // so the ceiling is 60. What it loses is startup latency: the FIRST ore has to
  // walk the whole belt, (2560 - 64) / 8 = 312 ticks, before anything can smelt.
  // (3600 - 312) / 60 = 54.8 -> 54 completed crafts.
  CHECK(net.producedCountOf(kIngot) == 54);  // OLD: 11

  // The belt carries a COLUMN. Ore boards every 15 ticks (4/s) and takes 312
  // ticks to cross, so 312 / 15 = 20.8 -> 21 items are in flight at steady
  // state. This single number is the whole change: it read 1 before.
  CHECK(peak == 21);
  CHECK(peak > 1);
  CHECK(peak <= line.maxItems());

  // Negative control (DW-20): the same drill and smelter with the belt NOT
  // connected must make zero ingots, so the numbers above cannot be coming from
  // some path other than the belt.
  BuildableNetwork ctl;
  BuildId cMiner = ctl.placeMinerOnDeposit(1000000, kOre, 4.0, 50);
  BuildId cBelt = ctl.placeBelt(10, 8);
  BuildId cSmelt = ctl.placeSmelter(kOre, kIngot, 60);
  ctl.connect(cMiner, cBelt);  // ore reaches the belt, and stops there
  for (int t = 0; t < 3600; ++t) ctl.step();
  CHECK(ctl.producedCountOf(kIngot) == 0);
  CHECK(ctl.outputBuffer(cSmelt) == 0);  // the smelter exists and never ran
  CHECK(ctl.beltItemCount(cBelt) > 0);   // ... and the belt really was carrying
}

// --- A saturated belt, driven: the drill outruns what a belt can accept. -----
// A belt accepts one item per kItemSpacing / speed = 64 / 8 = 8 ticks, i.e. 7.5
// items/s. Feed it 8/s and the line fills to its own capacity and the drill's
// output buffer backs up behind it, which is the Factorio-legible signal that
// the belt is the constraint. Every one of these read 1 / 0 / never before.
TEST(auto_line_belt_saturates_when_the_drill_outruns_it) {
  BuildableNetwork net;
  BuildId miner = net.placeMinerOnDeposit(1000000, kOre, /*8 ore/s*/ 8.0, 50);
  BuildId belt = net.placeBelt(10, 8);
  BuildId smelter = net.placeSmelter(kOre, kIngot, 60);
  net.connect(miner, belt);
  net.connect(belt, smelter);

  const of::factory::TransportLine& line = net.sim().line(belt.entity);
  uint32_t peak = 0;
  for (int t = 0; t < 3600; ++t) {
    net.step();
    const uint32_t n = net.beltItemCount(belt);
    if (n > peak) peak = n;
    CHECK(n <= line.maxItems());  // a line may never exceed its own length
  }
  CHECK(net.producedCountOf(kOre) == 478);   // OLD: 63
  CHECK(net.producedCountOf(kIngot) == 54);  // smelter-bound, same as at 4/s
  CHECK(peak == 39);                         // OLD: 1
  CHECK(net.outputBuffer(miner) > 0);        // the drill really did back up
  CHECK(line.invariantHolds());
}
