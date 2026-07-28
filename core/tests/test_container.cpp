// FS-66: A STORAGE CONTAINER IS A REAL ENTITY, AND STORAGE IS NOT PRODUCTION.
//
// FS-49 refused to build this as a pass-through machine, and the refusal is the
// reason this file exists at all. The shortcut was a machine whose recipe turns
// item X into item X in one tick. It would have worked, it would have taken
// about four lines, and it would have called `recordProduced` on every unit that
// passed through, so `producedCountOf` (a LIFETIME PRODUCTION tally that the
// client report publishes and the probes read) would have counted a box passing
// 500 iron along as having MANUFACTURED 500 iron. Storage would have become
// production in the one ledger that answers "what did the factory make".
//
// SO THE HEADLINE ASSERTION HERE IS A NEGATIVE ONE, and it is the whole point:
// after a drill fills a chest through a belt, `producedCount()` is EXACTLY
// ZERO and `producedCountOf(ore)` is EXACTLY ZERO, while the chest demonstrably
// holds the ore. That is asserted against a real driven line rather than against
// an empty scene, because "nothing was produced" is trivially true of a scene
// where nothing happened, and this scene moved hundreds of units.
//
// The property is structural rather than enforced: a Container has no Recipe, so
// there is no code path from one to `recordProduced` and no rule for a future
// change to forget. This suite pins that it stays that way.
//
// STANDING RULE 11 THROUGHOUT: every scenario drives the REAL pipeline, a
// worldgen node kind through `placeMinerForNode`, a belt, and the same item-less
// `connect()` calls the web wiring layer makes. Nothing writes a state the
// production path is supposed to reach, and no test calls `containerInsert`
// except the two that are explicitly ABOUT the hand-fill path.
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
const ItemId kIron = gsurv::smeltOutputFor(kRawIron);

// One unit can legitimately sit in an inserter's hand mid-transfer, so a ledger
// that cannot see it is off by one and flaky by tick phase.
uint32_t heldCountOf(const BuildableNetwork& net,
                     const std::vector<EntityHandle>& arms, ItemId item) {
  uint32_t n = 0;
  for (EntityHandle h : arms)
    if (h.valid() && net.sim().inserterHeldItem(h) == item) ++n;
  return n;
}

uint32_t beltCountOf(const BuildableNetwork& net, const BuildId& belt,
                     ItemId item) {
  uint32_t n = 0;
  for (const of::factory::FLineItem& it :
       net.sim().GetLineItems(belt.entity.index))
    if (it.ItemType == item) ++n;
  return n;
}

}  // namespace

// =============================================================================
// 1. A DRILL FILLS A CHEST THROUGH A BELT, AND THE PRODUCTION LEDGER STAYS ZERO.
// =============================================================================
TEST(container_stores_but_does_not_produce) {
  BuildableNetwork net;
  BuildId drill = net.placeMinerForNode(wsurv::NodeKind::IronOre, 5000, 4.0);
  BuildId belt = net.placeBelt(10);
  BuildId chest = net.placeContainer(300);
  EntityHandle a1 = net.connect(drill, belt);
  EntityHandle a2 = net.connect(belt, chest);

  CHECK(net.containerCount(chest) == 0);
  CHECK(net.containerItem(chest) == of::factory::kNoItem);
  CHECK(net.containerCapacity(chest) == 300);

  net.stepN(3600);

  // It really stored something, so the zero below is a fact about a busy scene.
  const uint16_t stored = net.containerCount(chest);
  CHECK(stored > 0);
  CHECK(net.containerItem(chest) == kRawIron);
  std::printf("  chest holds %u %s after 3600 ticks\n",
              static_cast<unsigned>(stored), "raw iron");

  // And nothing was invented or lost: what the deposit gave up is what is in
  // the chest, on the belt, or in an inserter's hand.
  const uint64_t mined = 5000 - net.minerRemaining(drill);

  // THE HEADLINE, AND THE FIRST DRAFT OF IT WAS WRONG IN AN INSTRUCTIVE WAY.
  // It asserted `producedCountOf(ore) == 0`, which failed, and the failure was
  // correct: `minerSystem` calls `recordProduced` on every unit it extracts,
  // because MINING RAW ORE IS PRODUCTION and always has been. So "zero" was a
  // claim about the wrong thing.
  //
  // The real claim is EXACTLY ONCE, and it is a much better test than zero:
  // every unit is counted when the drill lifts it out of the ground, and the
  // chest storing hundreds of them adds NOTHING further. A pass-through-recipe
  // container (the shortcut FS-49 refused) would have recorded a SECOND
  // production for each unit as it passed through, so this equality is precisely
  // the double count that design would have caused, and it cannot be satisfied
  // by an idle scene the way `== 0` could.
  CHECK(net.producedCountOf(kRawIron) == mined);
  CHECK(net.producedCount() == mined);
  const uint32_t onBelt = beltCountOf(net, belt, kRawIron);
  const uint32_t held = heldCountOf(net, {a1, a2}, kRawIron);
  std::printf("  mined %llu = chest %u + belt %u + hand %u\n",
              static_cast<unsigned long long>(mined),
              static_cast<unsigned>(stored), onBelt, held);
  CHECK(mined == stored + onBelt + held);
}

// =============================================================================
// 2. A CHEST HOLDS ONE TYPE, AND REFUSES THE SECOND WITH BACK PRESSURE.
//
// The refused item must STAY ON ITS BELT, not vanish and not sit invisibly in an
// inserter's hand for ever. That is FS-37's rule and the reason acceptance is
// asked at the PICKUP as well as the drop.
// =============================================================================
TEST(container_refuses_a_second_item_type_and_the_line_backs_up) {
  BuildableNetwork net;
  BuildId ironDrill = net.placeMinerForNode(wsurv::NodeKind::IronOre, 5000, 4.0);
  BuildId coalDrill = net.placeMinerForNode(wsurv::NodeKind::CoalSeam, 5000, 4.0);
  BuildId ironBelt = net.placeBelt(10);
  BuildId coalBelt = net.placeBelt(10);
  BuildId chest = net.placeContainer(300);
  EntityHandle b1 = net.connect(ironDrill, ironBelt);
  EntityHandle b2 = net.connect(coalDrill, coalBelt);
  EntityHandle b3 = net.connect(ironBelt, chest);
  EntityHandle b4 = net.connect(coalBelt, chest);

  net.stepN(3600);

  const ItemId claimed = net.containerItem(chest);
  CHECK(claimed == kRawIron || claimed == kCoal);
  const ItemId refused = claimed == kRawIron ? kCoal : kRawIron;
  const BuildId& refusedBelt = claimed == kRawIron ? coalBelt : ironBelt;

  // Everything in the chest is the claimed type. A count cannot remember what
  // it was, so a mixed chest would be undetectable after the fact: this is the
  // assertion that has to hold at every tick, and the ledger below is how.
  const uint16_t stored = net.containerCount(chest);
  CHECK(stored > 0);

  // THE REFUSED TYPE BACKED UP RATHER THAN VANISHING. Its belt is carrying
  // items, which is what visible back pressure looks like.
  const uint32_t stuck = beltCountOf(net, refusedBelt, refused);
  std::printf("  chest claimed %u, holds %u; refused type %u has %u backed up\n",
              static_cast<unsigned>(claimed), static_cast<unsigned>(stored),
              static_cast<unsigned>(refused), stuck);
  CHECK(stuck > 0);

  // Conservation for the REFUSED type: none of it reached the chest, so all of
  // it is on its belt or in a hand.
  //
  // THE MINER'S OWN OUT-SLOT IS PART OF THE LEDGER and the first draft forgot
  // it. A miner has a finite `outCap` (50 by default) precisely so it BACKS UP
  // when its belt is full rather than mining into the void, so a refused line
  // parks ore in three places, not two: the belt, the drill's buffer, and a
  // hand. Leaving the buffer out made the conservation check fail by exactly
  // the buffer's depth, which reads like a leak and is the opposite.
  const BuildId& refusedDrill = claimed == kRawIron ? coalDrill : ironDrill;
  const uint64_t minedRefused = 5000 - net.minerRemaining(refusedDrill);
  const uint16_t inDrill = net.outputBuffer(refusedDrill);
  const uint32_t heldRefused = heldCountOf(net, {b1, b2, b3, b4}, refused);
  std::printf("  refused ledger: mined %llu = belt %u + drill %u + hand %u\n",
              static_cast<unsigned long long>(minedRefused), stuck,
              static_cast<unsigned>(inDrill), heldRefused);
  CHECK(minedRefused == stuck + inDrill + heldRefused);

  // EXACTLY ONCE, per type, with two drills running for a minute and a chest
  // storing hundreds of one of them. The chest contributes nothing to either
  // tally, including for the type it actually holds.
  const uint64_t minedClaimed =
      5000 - net.minerRemaining(claimed == kRawIron ? ironDrill : coalDrill);
  CHECK(net.producedCountOf(claimed) == minedClaimed);
  CHECK(net.producedCountOf(refused) == minedRefused);
  CHECK(net.producedCount() == minedClaimed + minedRefused);
}

// =============================================================================
// 3. A FULL CHEST STOPS ACCEPTING, AND THE LINE BACKS UP INSTEAD OF OVERFILLING.
// =============================================================================
TEST(container_fills_to_capacity_and_no_further) {
  BuildableNetwork net;
  BuildId drill = net.placeMinerForNode(wsurv::NodeKind::IronOre, 5000, 8.0);
  BuildId belt = net.placeBelt(10);
  BuildId chest = net.placeContainer(40);
  net.connect(drill, belt);
  net.connect(belt, chest);


  net.stepN(3600);
  CHECK(net.containerCount(chest) == 40);
  CHECK(net.containerCapacity(chest) == 40);

  // Another minute changes nothing, which is the difference between a cap and a
  // race that happens to have stopped.
  net.stepN(3600);
  CHECK(net.containerCount(chest) == 40);
  // Exactly once: a chest sitting FULL for a minute records nothing, which is
  // the state a pass-through implementation would have been quietest in.
  CHECK(net.producedCount() == 5000 - net.minerRemaining(drill));

  // Taking some out makes room, and the line refills it: the back pressure was
  // a state and not a latch.
  const uint16_t took = net.containerTake(chest, 15);
  CHECK(took == 15);
  CHECK(net.containerCount(chest) == 25);
  net.stepN(1800);
  CHECK(net.containerCount(chest) == 40);
  std::printf("  cap 40 held across 7200 ticks, refilled after taking 15\n");
}

// =============================================================================
// 4. EMPTYING A CHEST RELEASES ITS TYPE, SO IT CAN BE REUSED.
//
// Without this the first item to wander into a chest commits it for ever, which
// makes the one-type rule a trap rather than a rule.
// =============================================================================
TEST(container_releases_its_type_when_emptied) {
  BuildableNetwork net;
  BuildId chest = net.placeContainer(100);

  CHECK(net.containerInsert(chest, kCoal, 10) == 10);
  CHECK(net.containerItem(chest) == kCoal);
  // A different type is refused while it holds coal.
  CHECK(net.containerInsert(chest, kRawIron, 10) == 0);
  CHECK(net.containerCount(chest) == 10);

  CHECK(net.containerTake(chest, 10) == 10);
  CHECK(net.containerCount(chest) == 0);
  CHECK(net.containerItem(chest) == of::factory::kNoItem);

  // Now it takes the other type.
  CHECK(net.containerInsert(chest, kRawIron, 7) == 7);
  CHECK(net.containerItem(chest) == kRawIron);

  // The hand-fill respects the cap and reports what it ACCEPTED, not what it
  // was offered, so a caller stores the truth.
  BuildId small = net.placeContainer(5);
  CHECK(net.containerInsert(small, kCoal, 50) == 5);
  CHECK(net.containerCount(small) == 5);
  CHECK(net.producedCount() == 0);
}

// =============================================================================
// 5. A CHEST FEEDS A MACHINE, WHICH IS THE HALF THAT MAKES IT A BUFFER.
//
// A container that can only be filled is a bin. Draining one INTO a smelter is
// what makes it part of the factory, and it exercises the added kind on the
// inserter's drain branch rather than the new branch on its drop.
// =============================================================================
TEST(container_feeds_a_smelter_and_the_smelter_is_what_produces) {
  BuildableNetwork net;
  BuildId chest = net.placeContainer(300);
  BuildId smelter = net.placeSmelter(kRawIron, kIron, 60);
  EntityHandle c1 = net.connect(chest, smelter);

  // Prime the chest by hand: this test is about the DRAIN, and a drill would
  // only add a second variable.
  CHECK(net.containerInsert(chest, kRawIron, 120) == 120);
  CHECK(net.producedCount() == 0);

  net.stepN(3600);

  const uint16_t left = net.containerCount(chest);
  const uint64_t ingots = net.producedCountOf(kIron);
  std::printf("  chest 120 -> %u left, smelter made %llu iron\n",
              static_cast<unsigned>(left),
              static_cast<unsigned long long>(ingots));
  CHECK(left < 120);
  CHECK(ingots > 0);

  // THE LEDGER NAMES THE SMELTER AND NOT THE CHEST. Iron was produced; RAW iron
  // never was, however much of it the chest passed along.
  CHECK(net.producedCountOf(kRawIron) == 0);
  CHECK(net.producedCount() == ingots);

  // Conservation across the hand-off: every unit that left the chest is now an
  // ingot, inside the smelter, in a hand, or still an ingot in its out-slot.
  // ONE UNIT CAN BE MID-CRAFT, consumed out of the hopper and not yet emitted,
  // and the first draft of this ledger was off by exactly that one. A ledger
  // that cannot see the in-flight unit is flaky by tick PHASE, which is worse
  // than one that is simply wrong, because it passes most of the time.
  const uint64_t drained = 120 - left;
  const uint16_t inSmelter = net.inputBuffer(smelter);
  const uint32_t held = heldCountOf(net, {c1}, kRawIron);
  const uint64_t inFlight = net.working(smelter) ? 1 : 0;
  std::printf("  drained %llu = made %llu + hopper %u + hand %u + inflight %llu\n",
              static_cast<unsigned long long>(drained),
              static_cast<unsigned long long>(ingots),
              static_cast<unsigned>(inSmelter), held,
              static_cast<unsigned long long>(inFlight));
  CHECK(drained == ingots + inSmelter + held + inFlight);
}

// =============================================================================
// 6. A CONTAINER IS NOT A MACHINE ANYWHERE THE FACADE IS ASKED.
//
// The facade answers `working` and `progress01` by switching on BuildKind, and a
// kind appended to that enum without a case falls to the default. Pinning it
// means a future change that gives containers a progress bar has to say so.
// =============================================================================
TEST(container_reports_as_storage_not_as_a_machine) {
  BuildableNetwork net;
  BuildId chest = net.placeContainer(50);
  CHECK(net.containerInsert(chest, kCoal, 20) == 20);
  net.stepN(600);

  CHECK(!net.working(chest));
  CHECK(net.progress01(chest) == 0.0);
  // It holds what it held: with nothing connected, a container is inert by
  // construction because nothing ticks it.
  CHECK(net.containerCount(chest) == 20);
  // No drill in this scene, so here zero IS the right claim and it is checked
  // as such: a container alone produces nothing because nothing ticks it.
  CHECK(net.producedCount() == 0);

  // A filtered chest pins its type up front and refuses everything else from
  // tick zero, with no first-arrival to claim it.
  BuildId filtered = net.placeContainer(50, kIron);
  CHECK(net.containerItem(filtered) == kIron);
  CHECK(net.containerInsert(filtered, kCoal, 5) == 0);
  CHECK(net.containerInsert(filtered, kIron, 5) == 5);
}

// =============================================================================
// 7. FS-67: AN ASSEMBLER'S SECOND INGREDIENT ARRIVES ON ITS OWN BELT.
//
// This test is in this file rather than beside the other assembler tests
// because it was found by the SAME class of defect the container hit and fixed
// in the same breath: an inserter's item filter is decided once, at connect
// time, by `inferItem`, and anything it infers from a belt is a snapshot of a
// belt that has not started running.
//
// For a single-input machine that is harmless: there is one answer. For a
// two-input machine the old fallback was `return in1`, so BOTH belts feeding an
// assembler bound to ingredient A, and the line carrying ingredient B waited for
// ingredient A for ever. It was fatal ALWAYS rather than intermittently, because
// the client rebuilds the network from the plan on every placement and a rebuild
// empties every belt, so the inference never had anything to look at.
//
// The scene below is the one `probes/assembler.js` drives in the browser, headless
// and minimal: two drills, two belts, one two-ingredient machine. Before the fix
// the SECOND hopper stays at zero for ever while the first fills.
// =============================================================================
TEST(assembler_second_ingredient_arrives_on_its_own_belt) {
  BuildableNetwork net;
  BuildId ironDrill = net.placeMinerForNode(wsurv::NodeKind::IronOre, 5000, 4.0);
  BuildId coalDrill = net.placeMinerForNode(wsurv::NodeKind::CoalSeam, 5000, 4.0);
  BuildId ironBelt = net.placeBelt(10);
  BuildId coalBelt = net.placeBelt(10);
  // 2 raw iron + 3 coal -> 1 of an arbitrary output. The counts differ on
  // purpose so a machine that consumed the wrong slot would show up as a wrong
  // RATIO rather than only as a wrong total.
  const ItemId kPart = 0x0300;
  BuildId asm_ = net.placeAssembler(kRawIron, 2, kCoal, 3, kPart, 1, 60);
  net.connect(ironDrill, ironBelt);
  net.connect(coalDrill, coalBelt);
  // The item-less connect the web wiring layer makes. THIS is the call whose
  // inference was wrong, so passing an explicit item here would test nothing.
  net.connect(ironBelt, asm_);
  net.connect(coalBelt, asm_);

  net.stepN(3600);

  const uint16_t slot1 = net.inputBuffer(asm_);
  const uint16_t slot2 = net.input2Buffer(asm_);
  const uint64_t made = net.producedCountOf(kPart);
  std::printf("  assembler slot1 %u, slot2 %u, made %llu\n",
              static_cast<unsigned>(slot1), static_cast<unsigned>(slot2),
              static_cast<unsigned long long>(made));

  // BOTH hoppers, which is the assertion a one-ingredient machine cannot have
  // and the one that fails against the old fallback.
  CHECK(slot1 > 0 || made > 0);
  CHECK(slot2 > 0 || made > 0);
  CHECK(made > 0);

  // And it really consumed BOTH, in the recipe's own ratio: 2 iron and 3 coal
  // per craft. A machine fed only ingredient A would have made nothing at all.
  const uint64_t ironMined = 5000 - net.minerRemaining(ironDrill);
  const uint64_t coalMined = 5000 - net.minerRemaining(coalDrill);
  std::printf("  mined iron %llu, coal %llu, for %llu crafts (2:3 per craft)\n",
              static_cast<unsigned long long>(ironMined),
              static_cast<unsigned long long>(coalMined),
              static_cast<unsigned long long>(made));
  CHECK(ironMined >= made * 2);
  CHECK(coalMined >= made * 3);

  // The ledger names the PART and neither ore a second time: the assembler
  // produced parts, the drills produced ore, and nothing double counted.
  CHECK(net.producedCountOf(kPart) == made);
  CHECK(net.producedCountOf(kRawIron) == ironMined);
  CHECK(net.producedCountOf(kCoal) == coalMined);
}
