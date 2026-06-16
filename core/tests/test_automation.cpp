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
