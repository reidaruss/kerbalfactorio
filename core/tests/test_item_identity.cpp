// FS-37: ITEM IDENTITY IS CONSERVED THROUGH DELIVERY — a machine accepts only
// items its current recipe consumes, and a refused item stays where it is.
//
// The player-reported defect (2026-07-27, Reid): a drill on a COAL patch, a
// belt of coal into a smelter, "+1 IRON READY". Every count conserved, so every
// conservation test passed, while item IDENTITY did not: machine input slots
// are COUNTS (inSlotCount_), and a count cannot remember what it was — one
// wrong unit dropped into the slot is transmuted into the recipe's input the
// moment the craft loop consumes it.
//
// Two seams made that reachable, and this file pins the /core one:
//   * the WEB authoring seam (FactoryCommit.ts) coerced "coal is not
//     smeltable" (smeltOutputFor(coal) == kNoItem) into a coal->iron RECIPE
//     via an `|| ids.iron` fallback — fixed web-side, asserted here only as
//     the table fact the fallback ignored;
//   * the /core DELIVERY seam (inserterSystem) never compared what it carried
//     against what the destination's recipe consumes: the drop branch put any
//     held item into slot 1. Fixed by machineAcceptsItem, enforced AT PICKUP
//     (the refused item stays ON ITS BELT / in the source out-slot -> visible
//     back-pressure, like a full machine) and again at the drop (unreachable
//     today; the wall for a future ISetRecipeIntent).
//
// STANDING RULE 11: every scenario here drives the REAL pipeline — worldgen
// node kind -> placeMinerForNode -> belt -> smelter, wired with the same
// item-less connect() calls FactoryWiring.ts makes. No fixture writes a state
// the production path is supposed to reach.
#include <cstdio>
#include <vector>

#include "test_framework.h"
#include "of/automation.h"
#include "of/deposits.h"
#include "of/gameplay.h"

using namespace of::automation;
namespace wsurv = of::worldgen::survival;
namespace gsurv = of::gameplay::survival;

namespace {

constexpr ItemId kCoal    = wsurv::kItemCoal;     // 0x0032
constexpr ItemId kRawIron = wsurv::kItemRawIron;  // 0x0033

// The ingot comes from the ONE smelt table (gameplay.h §S), not a local id.
const ItemId kIron = gsurv::smeltOutputFor(kRawIron);

// Count the items of one type on a belt line, through the published stream
// call (the same read the render layer makes).
uint32_t beltCountOf(const BuildableNetwork& net, const BuildId& belt,
                     ItemId item) {
  uint32_t n = 0;
  for (const of::factory::FLineItem& it :
       net.sim().GetLineItems(belt.entity.index))
    if (it.ItemType == item) ++n;
  return n;
}

// One unit can legitimately sit in an inserter's hand mid-transfer; a ledger
// that cannot see it would be off by one and flaky by tick phase.
uint32_t heldCountOf(const BuildableNetwork& net,
                     const std::vector<EntityHandle>& inserters, ItemId item) {
  uint32_t n = 0;
  for (EntityHandle h : inserters)
    if (h.valid() && net.sim().inserterHeldItem(h) == item) ++n;
  return n;
}

}  // namespace

// =============================================================================
// REID'S EXACT SHAPE, CORRECTLY AUTHORED: drill on a coal seam, belt, smelter
// whose recipe is raw-iron -> iron. The coal must be REFUSED — zero iron, zero
// coal in the ore slot — and refusal must be back-pressure, not destruction:
// the belt fills, the miner's out-slot caps, the miner stops, and every mined
// coal unit is still findable BY TYPE.
// =============================================================================
TEST(coal_belt_into_iron_smelter_is_refused_not_transmuted) {
  CHECK(kIron != kNoItem);
  // The table fact the web fallback ignored: coal is NOT smeltable.
  CHECK(gsurv::smeltOutputFor(kCoal) == kNoItem);

  BuildableNetwork net;
  BuildId miner = net.placeMinerForNode(wsurv::NodeKind::CoalSeam,
                                        /*deposit*/ 500, /*rate/s*/ 4.0,
                                        /*outCap*/ 50);
  BuildId belt = net.placeBelt(/*tiles*/ 4, /*speed*/ 8);
  BuildId smelter = net.placeSmelter(kRawIron, kIron, /*craftTicks*/ 60);
  // The web's two wiring calls, verbatim: no explicit item anywhere.
  EntityHandle insA = net.connect(miner, belt);
  EntityHandle insB = net.connect(belt, smelter);
  CHECK(insA.valid());
  CHECK(insB.valid());

  net.stepN(3600);  // 60 s

  const uint64_t mined = net.producedCountOf(kCoal);
  const uint32_t onBelt = beltCountOf(net, belt, kCoal);
  const uint32_t inMinerOut = net.outputBuffer(miner);
  const uint32_t held = heldCountOf(net, {insA, insB}, kCoal);

  std::printf("    [coal->Fe smelter] mined=%llu  belt=%u  minerOut=%u  "
              "held=%u  smelterIn=%u  ironMade=%llu\n",
              (unsigned long long)mined, onBelt, inMinerOut, held,
              net.inputBuffer(smelter),
              (unsigned long long)net.producedCountOf(kIron));

  // No transmutation: zero iron, zero anything in the ore slot, no craft ever.
  CHECK(net.producedCountOf(kIron) == 0);
  CHECK(net.inputBuffer(smelter) == 0);
  CHECK(net.producedCount() == mined);  // mining is the only tally

  // Identity ledger, exact: every mined coal is still coal, somewhere visible.
  CHECK(mined == inMinerOut + onBelt + held);
  // Nothing on the belt is anything BUT coal.
  CHECK(beltCountOf(net, belt, kRawIron) == 0);

  // Back-pressure reached the miner: a 4-tile belt saturates at 16 items
  // (kUnitsPerTile 256 / kItemSpacing 64 = 4 per tile), the out-slot caps at
  // 50, and extraction stops — the deposit is NOT silently drained.
  CHECK(onBelt == 16);
  CHECK(inMinerOut == 50);
  CHECK(net.minerRemaining(miner) == 500 - mined);
  const uint64_t minedBefore = mined;
  net.stepN(600);
  CHECK(net.producedCountOf(kCoal) == minedBefore);  // pinned, jammed, honest
  CHECK(net.producedCountOf(kIron) == 0);
}

// =============================================================================
// NEGATIVE CONTROL: the identical shape on an IRON node still produces, and
// its ledger balances by identity — raw iron mined equals raw iron in flight
// plus raw iron consumed, where consumed == ingots (a 1:1 recipe).
// =============================================================================
TEST(raw_iron_chain_still_produces_and_balances) {
  BuildableNetwork net;
  BuildId miner = net.placeMinerForNode(wsurv::NodeKind::IronOre,
                                        /*deposit*/ 500, /*rate/s*/ 4.0,
                                        /*outCap*/ 50);
  BuildId belt = net.placeBelt(4, 8);
  BuildId smelter = net.placeSmelter(kRawIron, kIron, 60);
  EntityHandle insA = net.connect(miner, belt);
  EntityHandle insB = net.connect(belt, smelter);

  net.stepN(3600);

  const uint64_t mined = net.producedCountOf(kRawIron);
  const uint64_t ingots = net.producedCountOf(kIron);
  const uint32_t onBelt = beltCountOf(net, belt, kRawIron);
  const uint32_t inMinerOut = net.outputBuffer(miner);
  const uint32_t held = heldCountOf(net, {insA, insB}, kRawIron);
  const uint32_t inSlot = net.inputBuffer(smelter);
  const uint32_t inOut = net.outputBuffer(smelter);
  // One raw iron entered the craft in flight if the smelter is mid-craft.
  const uint32_t inFlight = net.working(smelter) ? 1 : 0;

  std::printf("    [Fe control] mined=%llu  ingots=%llu  belt=%u  minerOut=%u "
              " held=%u  smelterIn=%u  smelterOut=%u  midCraft=%u\n",
              (unsigned long long)mined, (unsigned long long)ingots, onBelt,
              inMinerOut, held, inSlot, inOut, inFlight);

  CHECK(ingots > 0);
  CHECK(inOut == ingots);  // nothing drains the smelter here
  // Identity ledger, exact: raw iron is in flight, buffered, mid-craft, or
  // became exactly one ingot each.
  CHECK(mined == inMinerOut + onBelt + held + inSlot + inFlight + ingots);
  CHECK(beltCountOf(net, belt, kCoal) == 0);
}

// =============================================================================
// THE MIXED LINE (the brief's conservation acceptance): a coal drill AND an
// iron drill feed ONE belt into an iron smelter. Identities must balance per
// type: no coal is consumed, no raw iron vanishes, every ingot traces to a raw
// iron. (The first coal to reach the head jams the line — FS-17's shape, the
// honest cost of refusal-by-back-pressure on a single-lane belt.)
// =============================================================================
TEST(mixed_coal_and_iron_line_conserves_item_identity) {
  BuildableNetwork net;
  // A fast iron drill and a SLOW coal contaminator (a stray drill clipping a
  // coal seam), wired iron-first, so the line demonstrably produces before the
  // first refused coal reaches the head and jams it. (Two equal-rate drills
  // wired coal-first jam on item one and make zero ingots forever — measured;
  // valid back-pressure, but a weaker conservation exercise.)
  BuildId ironMiner = net.placeMinerForNode(wsurv::NodeKind::IronOre,
                                            500, 4.0, /*outCap*/ 20);
  BuildId coalMiner = net.placeMinerForNode(wsurv::NodeKind::CoalSeam,
                                            500, 0.25, /*outCap*/ 20);
  BuildId belt = net.placeBelt(6, 8);
  BuildId smelter = net.placeSmelter(kRawIron, kIron, 60);
  EntityHandle insIron = net.connect(ironMiner, belt);
  EntityHandle insCoal = net.connect(coalMiner, belt);
  EntityHandle insSink = net.connect(belt, smelter);

  net.stepN(3600);

  const std::vector<EntityHandle> arms = {insCoal, insIron, insSink};
  const uint64_t coalMined = net.producedCountOf(kCoal);
  const uint64_t ironMined = net.producedCountOf(kRawIron);
  const uint64_t ingots = net.producedCountOf(kIron);
  const uint32_t coalBelt = beltCountOf(net, belt, kCoal);
  const uint32_t ironBelt = beltCountOf(net, belt, kRawIron);
  const uint32_t coalHeld = heldCountOf(net, arms, kCoal);
  const uint32_t ironHeld = heldCountOf(net, arms, kRawIron);
  const uint32_t inSlot = net.inputBuffer(smelter);
  const uint32_t inFlight = net.working(smelter) ? 1 : 0;

  std::printf("    [mixed line] coal: mined=%llu belt=%u out=%u held=%u | "
              "iron: mined=%llu belt=%u out=%u held=%u in=%u  ingots=%llu\n",
              (unsigned long long)coalMined, coalBelt,
              net.outputBuffer(coalMiner), coalHeld,
              (unsigned long long)ironMined, ironBelt,
              net.outputBuffer(ironMiner), ironHeld, inSlot,
              (unsigned long long)ingots);

  // The line did real work before (or despite) the jam.
  CHECK(ingots > 0);
  // COAL: fully accounted, and NONE of it consumed — a coal ledger that
  // balances without a "consumed" term IS the no-transmutation claim.
  CHECK(coalMined ==
        net.outputBuffer(coalMiner) + coalBelt + coalHeld);
  // RAW IRON: fully accounted; consumed == ingots, 1:1.
  CHECK(ironMined == net.outputBuffer(ironMiner) + ironBelt + ironHeld +
                         inSlot + inFlight + ingots);
  // Nothing was minted: total tallies partition exactly by type.
  CHECK(net.producedCount() == coalMined + ironMined + ingots);
  CHECK(ingots <= ironMined);
}

// =============================================================================
// DIRECT HAND-OFF: a coal miner connected STRAIGHT to an iron smelter (the
// wiring layer's source->sink path, no belt). The refusal must hold at the
// out-slot pickup: nothing transfers, the miner backs up and stops.
// =============================================================================
TEST(direct_coal_source_to_iron_smelter_never_transfers) {
  BuildableNetwork net;
  BuildId miner = net.placeMinerForNode(wsurv::NodeKind::CoalSeam,
                                        500, 4.0, /*outCap*/ 50);
  BuildId smelter = net.placeSmelter(kRawIron, kIron, 60);
  EntityHandle ins = net.connect(miner, smelter);  // infers item = coal
  CHECK(ins.valid());

  net.stepN(1800);

  std::printf("    [direct] minerOut=%u  held=%d  smelterIn=%u  iron=%llu\n",
              net.outputBuffer(miner),
              (int)net.sim().inserterHeldItem(ins), net.inputBuffer(smelter),
              (unsigned long long)net.producedCountOf(kIron));

  CHECK(net.producedCountOf(kIron) == 0);
  CHECK(net.inputBuffer(smelter) == 0);
  CHECK(net.sim().inserterHeldItem(ins) == kNoItem);  // refused at pickup
  CHECK(net.outputBuffer(miner) == 50);               // capped, stopped
  CHECK(net.producedCountOf(kCoal) == 50);
  CHECK(net.minerRemaining(miner) == 450);
}

// =============================================================================
// AN EXPLICIT WRONG FILTER CANNOT FORCE DELIVERY: connect()'s public `item`
// parameter lets a caller build an inserter whose filter matches the belt's
// coal. The destination check must still refuse — the filter says what the arm
// CARRIES, the recipe says what the machine EATS, and only the recipe admits.
// =============================================================================
TEST(explicit_wrong_filter_cannot_force_delivery) {
  BuildableNetwork net;
  BuildId miner = net.placeMinerForNode(wsurv::NodeKind::CoalSeam,
                                        500, 4.0, 50);
  BuildId belt = net.placeBelt(4, 8);
  BuildId smelter = net.placeSmelter(kRawIron, kIron, 60);
  net.connect(miner, belt);
  EntityHandle forced = net.connect(belt, smelter, kCoal);  // filter == coal
  CHECK(forced.valid());

  net.stepN(3600);

  CHECK(net.producedCountOf(kIron) == 0);
  CHECK(net.inputBuffer(smelter) == 0);
  CHECK(net.sim().inserterHeldItem(forced) == kNoItem);
  // The coal is still on the belt, jammed at the head — back-pressure, not
  // destruction.
  CHECK(beltCountOf(net, belt, kCoal) == 16);
}

// =============================================================================
// THE GATE'S HONEST LIMIT, AND WHERE REID'S ACTUAL BUILD BREAKS: acceptance is
// measured against the machine's CURRENT RECIPE, so a machine AUTHORED with a
// coal -> iron recipe accepts coal and mints iron, and /core is right to let
// it: `Recipe` is the schema, gameplay authors the values (contract C-2), and
// nothing in factory_sim knows that coal is not smeltable.
//
// This is not hypothetical. `web/src/game/FactoryCommit.ts` authors the
// smelter as
//     const ore   = oreFedTo(f, p) || ids.rawIron;          // nearest drill's patch
//     const ingot = f.M._of_gp_smelt_output_for(ore) || ids.iron;
// and on a COAL patch `smeltOutputFor(coal)` is kNoItem == 0, which `||`
// coerces to iron: `placeSmelter(coal, iron)`. A coal -> iron recipe is
// literally authored, and every layer below it then behaves correctly. That
// one `||` is the whole of "+1 IRON READY" over a coal belt.
//
// So this test asserts the SHAPE of the remaining defect rather than a wish:
// while such a recipe can be authored, the transmutation is reachable. It is
// the pin that a web-side fix (fall back to the raw-iron RECIPE, not to the
// iron OUTPUT of a coal input) has to make unreachable at the authoring seam.
// =============================================================================
TEST(a_misauthored_recipe_transmutes_and_core_cannot_know_better) {
  BuildableNetwork net;
  BuildId miner = net.placeMinerForNode(wsurv::NodeKind::CoalSeam,
                                        500, 4.0, 50);
  BuildId belt = net.placeBelt(4, 8);
  // Exactly what FactoryCommit.ts's `|| ids.iron` fallback asks for today.
  BuildId smelter = net.placeSmelter(kCoal, kIron, 60);
  net.connect(miner, belt);
  net.connect(belt, smelter);

  net.stepN(3600);

  std::printf("    [misauthored coal->Fe recipe] coal mined=%llu  IRON=%llu"
              "  <- the authoring seam, not the delivery seam\n",
              (unsigned long long)net.producedCountOf(kCoal),
              (unsigned long long)net.producedCountOf(kIron));

  // Coal IS this machine's recipe input, so the delivery gate admits it and
  // the craft loop runs: iron from coal, exactly as reported.
  CHECK(net.sim().machineAcceptsItem(smelter.entity, kCoal));
  CHECK(net.producedCountOf(kIron) > 0);
  // And the table that the authoring layer overrode still says what it always
  // said. This CHECK is the fix's target: coal has no smelt output.
  CHECK(gsurv::smeltOutputFor(kCoal) == kNoItem);
}

// =============================================================================
// THE PREDICATE ITSELF, SWEPT DATA-DRIVEN OVER THE RECIPE TABLE: for every
// (machine, item) pair, acceptance is TRUE exactly when the item is one of the
// recipe's inputs. No item is special; coal is refused by the same clause that
// refuses an ingot fed back into its own smelter.
// =============================================================================
TEST(acceptance_is_the_recipe_table_and_nothing_else) {
  BuildableNetwork net;
  BuildId smelter = net.placeSmelter(kRawIron, kIron, 60);
  // A two-ingredient assembler: iron + copper-ish second arm.
  const ItemId kCopper = wsurv::kItemRawCopper;
  const ItemId kPart = 0x0040;
  BuildId assembler =
      net.placeAssembler(kIron, 1, kCopper, 2, kPart, 1, 90);
  BuildId miner = net.placeMinerForNode(wsurv::NodeKind::CoalSeam, 100, 1.0);

  const FactorySim& sim = net.sim();
  struct Case { EntityHandle m; ItemId item; bool accept; };
  const Case table[] = {
      // smelter (raw iron -> iron): input only.
      {smelter.entity, kRawIron, true},
      {smelter.entity, kCoal, false},
      {smelter.entity, kIron, false},   // its own OUTPUT is not an input
      {smelter.entity, kPart, false},
      {smelter.entity, kNoItem, false},
      // assembler (iron + copper -> part): both arms, nothing else.
      {assembler.entity, kIron, true},
      {assembler.entity, kCopper, true},
      {assembler.entity, kCoal, false},
      {assembler.entity, kRawIron, false},
      {assembler.entity, kPart, false},
      // a MINER is not a machine: it accepts nothing through this predicate.
      {miner.entity, kCoal, false},
  };
  int swept = 0;
  for (const Case& c : table) {
    CHECK(sim.machineAcceptsItem(c.m, c.item) == c.accept);
    ++swept;
  }
  std::printf("    [predicate] %d (machine,item) pairs swept\n", swept);
}

