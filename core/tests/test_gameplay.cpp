// =============================================================================
// test_gameplay.cpp — Wave-0 headless tests for the gameplay-logic core.
//
// Maps the pinned Phase-1 gameplay design (docs/phase1/gameplay-phase1.md §7–§8)
// to concrete assertions, consuming the green factory-sim + world-gen cores:
//
//   1. Registry        — the 12 items / 5 recipes / 7 entity defs are present,
//                        stable-id'd, and cross-linked (item -> entity TypeId).
//   2. Inventory       — add/remove/stack honoring StackMax (overflow, draining,
//                        cross-slot queries) — GP-9.
//   3. Mining          — extracting from a deposit grants the right ItemId,
//                        depletes `remaining`, and stops cleanly at 0 — §C.
//   4. Build validation— a valid placement succeeds + deducts cost; the three
//                        invalid cases (no-deposit miner, slope-too-steep,
//                        insufficient items) are REJECTED with the right reason.
//   5. Recipe I/O      — a recipe consumes inputs and yields outputs, driven
//                        through the factory-sim recipe model (smelt + assemble).
//   6. Objective FSM   — advances through the linear chain as predicates are
//                        satisfied; the terminal "outpost on the moon" step fires
//                        ONLY when all its conditions hold (no early trigger).
// =============================================================================
#include <cstdio>

#include "test_framework.h"
#include "of/gameplay.h"
#include "of/factory_sim.h"
#include "of/cubed_sphere.h"

using namespace of;
using namespace of::gameplay;

// A fresh, empty deposit table for placements that need no deposit (smelter,
// box, etc.). A function (not a shared static) so each test gets a clean slate.
static std::vector<DepositNode> noDeposits() { return {}; }

// =============================================================================
// 1. REGISTRY — the slice content is present, stable, and cross-linked (§7).
// =============================================================================
TEST(registry_holds_the_pinned_slice_content) {
  SliceRegistry reg;

  // 12 items, 5 recipes, 7 entity defs (§7).
  CHECK(reg.allItems().size() == 12);
  CHECK(reg.allRecipes().size() == 5);
  CHECK(reg.allEntities().size() == 7);

  // Canonical ids resolve with the pinned categories / stack caps (§7.1).
  const ItemDef* ore = reg.item(items::FerriteOre);
  CHECK(ore != nullptr);
  CHECK(ore->category == ItemCategory::Ore);
  CHECK(ore->stackMax == 100);

  const ItemDef* part = reg.item(items::FramePart);
  CHECK(part != nullptr);
  CHECK(part->category == ItemCategory::Part);
  CHECK(part->stackMax == 50);

  // Cinderite is flagged off-world-only (the P1-D4 identity hook).
  const ItemDef* cind = reg.item(items::Cinderite);
  CHECK(cind != nullptr);
  CHECK((cind->flags & kFlagOffWorldOnly) != 0);

  // Buildable item -> entity TypeId cross-link is 1:1 (§7.1 note).
  CHECK(reg.entityForItem(items::Miner) == types::Miner);
  CHECK(reg.entityForItem(items::Smelter) == types::Smelter);
  CHECK(reg.entityForItem(items::Generator) == types::Generator);
  // A non-buildable item places nothing.
  CHECK(reg.entityForItem(items::FerriteOre) == kNoType);

  // The smelt recipe is keyed to the smelter and does ore -> plate (§7.2).
  const RecipeDef* smelt = reg.recipe(recipes::SmeltFerrite);
  CHECK(smelt != nullptr);
  CHECK(smelt->machineTypeId == types::Smelter);
  CHECK(smelt->inputItem == items::FerriteOre);
  CHECK(smelt->outputItem == items::FerritePlate);

  // The miner entity requires a deposit (§2.2); the box does not.
  CHECK(reg.entity(types::Miner)->requiresDeposit);
  CHECK(!reg.entity(types::Box)->requiresDeposit);
}

// =============================================================================
// 2. INVENTORY — add/remove/stack honoring StackMax (GP-9).
// =============================================================================
TEST(inventory_add_remove_stack_honors_stackmax) {
  SliceRegistry reg;
  Inventory inv(reg, /*slots*/ 20);

  CHECK(inv.empty());
  CHECK(inv.count(items::FerriteOre) == 0);

  // Add 250 ore (StackMax 100) -> fills across slots, none lost (3 slots: 100/100/50).
  uint16_t overflow = inv.add(items::FerriteOre, 250);
  CHECK(overflow == 0);
  CHECK(inv.count(items::FerriteOre) == 250);

  // No single slot exceeds StackMax (the stack cap is respected per-slot).
  int slotsUsed = 0;
  for (int i = 0; i < inv.slotCount(); ++i) {
    const ItemStack& s = inv.slot(i);
    if (!s.empty()) {
      ++slotsUsed;
      CHECK(s.count <= reg.stackMax(s.item));
    }
  }
  CHECK(slotsUsed == 3);  // 100 + 100 + 50

  // Remove 120 -> draws across slots; 130 left.
  uint16_t removed = inv.remove(items::FerriteOre, 120);
  CHECK(removed == 120);
  CHECK(inv.count(items::FerriteOre) == 130);

  // Removing more than held returns only what was there, and empties cleanly.
  removed = inv.remove(items::FerriteOre, 1000);
  CHECK(removed == 130);
  CHECK(inv.count(items::FerriteOre) == 0);
  CHECK(inv.empty());

  // Overflow when the whole inventory can't hold the request. 20 slots * 50
  // (Frame part StackMax) = 1000 max; add 1100 -> 100 do not fit.
  uint16_t over = inv.add(items::FramePart, 1100);
  CHECK(over == 100);
  CHECK(inv.count(items::FramePart) == 1000);

  // Adding the null item or zero is a no-op (returns the unfit count = input).
  CHECK(inv.add(kNoItem, 5) == 5);
  CHECK(inv.add(items::FerriteOre, 0) == 0);
}

// =============================================================================
// 3. MINING — extract grants the right item, depletes remaining, stops at 0 (§C).
// =============================================================================
TEST(mining_grants_item_and_depletes_to_zero) {
  SliceRegistry reg;
  Inventory inv(reg, 20);

  DepositNode node;
  node.id = 42;
  node.resource = items::FerriteOre;
  node.grade = 1.0f;
  node.remainingAmount = 5.0;  // a small node so we can hit empty

  // Each pull at grade 1.0 extracts 1 unit of the deposit's Resource.
  for (int i = 0; i < 5; ++i) {
    MineResult res = mineDeposit(node, inv, /*baseRate*/ 1);
    CHECK(res.granted == 1);
    CHECK(res.extracted == 1);
  }
  // Exactly the right ItemId landed in the pack, and the node is now empty.
  CHECK(inv.count(items::FerriteOre) == 5);
  CHECK(node.remainingAmount == 0.0);
  CHECK(node.depleted());

  // A further pull yields nothing and reports the node empty (stops at 0).
  MineResult after = mineDeposit(node, inv, 1);
  CHECK(after.granted == 0);
  CHECK(after.depositEmpty);
  CHECK(inv.count(items::FerriteOre) == 5);  // no item conjured from an empty node
}

// Grade scales the per-pull rate; the last pull clamps to what remains (no
// over-extraction past 0).
TEST(mining_respects_grade_and_clamps_at_remaining) {
  SliceRegistry reg;
  Inventory inv(reg, 20);

  DepositNode rich;
  rich.id = 7;
  rich.resource = items::Cinderite;  // off-world resource
  rich.grade = 4.0f;                 // richer node -> 4 units / pull
  rich.remainingAmount = 10.0;

  MineResult a = mineDeposit(rich, inv, /*baseRate*/ 1);
  CHECK(a.extracted == 4);  // 1 * grade 4
  CHECK(rich.remainingAmount == 6.0);

  MineResult b = mineDeposit(rich, inv, 1);
  CHECK(b.extracted == 4);
  CHECK(rich.remainingAmount == 2.0);

  // Final pull wants 4 but only 2 remain -> clamps to 2, then empties.
  MineResult c = mineDeposit(rich, inv, 1);
  CHECK(c.extracted == 2);
  CHECK(rich.remainingAmount == 0.0);
  CHECK(c.depositEmpty);

  CHECK(inv.count(items::Cinderite) == 10);  // total kept == node's original amount
}

// =============================================================================
// 4. BUILD VALIDATION — valid placement succeeds + deducts; invalids rejected.
// =============================================================================

// A flat launch site on Forge: find a (lat,lon) whose terrain slope is gentle so
// slope is NOT the limiter for the valid-placement test.
static void findFlatSite(const worldgen::BodyParams& body, double& lat,
                         double& lon) {
  double bestSlope = 1e9;
  double bl = 0, bo = 0;
  for (int i = 0; i < 64; ++i) {
    const double la = -1.2 + 2.4 * (i / 63.0);
    for (int j = 0; j < 64; ++j) {
      const double lo = -3.0 + 6.0 * (j / 63.0);
      const double s = terrainSlopeRad(body, la, lo);
      if (s < bestSlope) { bestSlope = s; bl = la; bo = lo; }
    }
  }
  lat = bl;
  lon = bo;
}

// A steep site on Forge (max slope over the same scan) — to trip SlopeTooSteep.
static void findSteepSite(const worldgen::BodyParams& body, double& lat,
                          double& lon, double& slopeOut) {
  double worst = -1.0;
  double bl = 0, bo = 0;
  for (int i = 0; i < 96; ++i) {
    const double la = -1.2 + 2.4 * (i / 95.0);
    for (int j = 0; j < 96; ++j) {
      const double lo = -3.0 + 6.0 * (j / 95.0);
      const double s = terrainSlopeRad(body, la, lo);
      if (s > worst) { worst = s; bl = la; bo = lo; }
    }
  }
  lat = bl;
  lon = bo;
  slopeOut = worst;
}

TEST(build_valid_placement_succeeds_and_deducts_cost) {
  SliceRegistry reg;
  worldgen::BodyParams forge = worldgen::makeForge(0xACE1ull);
  Builder builder(reg, forge);
  factory::FactorySim sim;

  Inventory inv(reg, 20);
  inv.add(items::Smelter, 3);  // 3 smelter items in the pack

  double lat, lon;
  findFlatSite(forge, lat, lon);

  BuildIntent intent;
  intent.typeId = types::Smelter;
  intent.lat = lat;
  intent.lon = lon;  // no deposit needed for a smelter

  const size_t entitiesBefore = sim.entityCount();
  std::vector<DepositNode> deposits = noDeposits();
  BuildResult res = builder.place(intent, inv, sim, deposits);

  CHECK(res.reject == BuildReject::Ok);
  CHECK(res.placed);
  CHECK(res.handle.valid());
  // The authoritative entity now exists in the factory sim (gameplay didn't
  // create it — it drove the sim's add API, §3.4).
  CHECK(sim.entityCount() == entitiesBefore + 1);
  // The build cost (1x Smelter) was deducted from the pack (3 -> 2).
  CHECK(inv.count(items::Smelter) == 2);
}

TEST(build_miner_with_no_deposit_is_rejected) {
  SliceRegistry reg;
  worldgen::BodyParams forge = worldgen::makeForge(0xACE1ull);
  Builder builder(reg, forge);
  factory::FactorySim sim;

  Inventory inv(reg, 20);
  inv.add(items::Miner, 1);

  double lat, lon;
  findFlatSite(forge, lat, lon);

  BuildIntent intent;
  intent.typeId = types::Miner;
  intent.lat = lat;
  intent.lon = lon;
  intent.targetDeposit = kNoDeposit;  // a miner placed off any node (§2.2)

  std::vector<DepositNode> noDeposits;
  BuildResult res = builder.place(intent, inv, sim, noDeposits);

  CHECK(res.reject == BuildReject::NoDeposit);
  CHECK(!res.placed);
  // No entity placed and NO cost deducted on a rejected build.
  CHECK(sim.entityCount() == 0);
  CHECK(inv.count(items::Miner) == 1);
}

TEST(build_on_too_steep_slope_is_rejected) {
  SliceRegistry reg;
  worldgen::BodyParams forge = worldgen::makeForge(0xACE1ull);
  Builder builder(reg, forge);
  factory::FactorySim sim;

  Inventory inv(reg, 20);
  inv.add(items::Smelter, 1);

  double lat, lon, slope;
  findSteepSite(forge, lat, lon, slope);
  // The steep site must exceed the smelter's tolerance for this test to mean
  // something. The smelter tolerance is 0.30 rad; Forge has multi-km relief, so
  // its steepest sampled slope comfortably exceeds that.
  const float tol = reg.entity(types::Smelter)->slopeToleranceRad;
  std::printf("    [slope] steepest sampled=%.3f rad  smelter tol=%.3f rad\n",
              slope, tol);
  CHECK(slope > tol);

  BuildIntent intent;
  intent.typeId = types::Smelter;
  intent.lat = lat;
  intent.lon = lon;

  std::vector<DepositNode> deposits = noDeposits();
  BuildResult res = builder.place(intent, inv, sim, deposits);
  CHECK(res.reject == BuildReject::SlopeTooSteep);
  CHECK(!res.placed);
  CHECK(sim.entityCount() == 0);
  CHECK(inv.count(items::Smelter) == 1);  // cost not deducted
}

TEST(build_with_insufficient_inventory_is_rejected) {
  SliceRegistry reg;
  worldgen::BodyParams forge = worldgen::makeForge(0xACE1ull);
  Builder builder(reg, forge);
  factory::FactorySim sim;

  Inventory inv(reg, 20);
  // Pack is EMPTY — no smelter item to pay the build cost.

  double lat, lon;
  findFlatSite(forge, lat, lon);

  BuildIntent intent;
  intent.typeId = types::Smelter;
  intent.lat = lat;
  intent.lon = lon;

  std::vector<DepositNode> deposits = noDeposits();
  BuildResult res = builder.place(intent, inv, sim, deposits);
  CHECK(res.reject == BuildReject::InsufficientItems);
  CHECK(!res.placed);
  CHECK(sim.entityCount() == 0);
}

// A valid miner placement (on a real deposit, flat ground, with the item) both
// succeeds AND binds the right extraction recipe by the deposit's Resource (the
// miner reads FDepositNode.Resource directly — C-1/WG-11).
TEST(build_valid_miner_on_cinderite_deposit_binds_offworld_recipe) {
  SliceRegistry reg;
  worldgen::BodyParams cinder = worldgen::makeCinder(0xACE1ull);
  Builder builder(reg, cinder);
  factory::FactorySim sim;

  Inventory inv(reg, 20);
  inv.add(items::Miner, 1);

  double lat, lon;
  findFlatSite(cinder, lat, lon);

  std::vector<DepositNode> deposits;
  DepositNode cinderite;
  cinderite.id = 9001;
  cinderite.resource = items::Cinderite;  // the off-world resource
  cinderite.grade = 2.0f;
  cinderite.remainingAmount = 10000.0;
  deposits.push_back(cinderite);

  BuildIntent intent;
  intent.typeId = types::Miner;
  intent.lat = lat;
  intent.lon = lon;
  intent.targetDeposit = 9001;

  BuildResult res = builder.place(intent, inv, sim, deposits);
  CHECK(res.reject == BuildReject::Ok);
  CHECK(res.placed);
  CHECK(sim.entityCount() == 1);
  CHECK(inv.count(items::Miner) == 0);  // cost deducted

  // The placed miner is on power network 1 (Builder binds it); supply it so it
  // isn't browned out to zero throughput.
  factory::EntityHandle gen = sim.addGenerator(/*network*/ 1, /*supplyW*/ 100000);
  (void)gen;

  // The placed miner runs the Cinderite extraction recipe: feed it and step;
  // its output slot must accumulate the off-world ItemId (recipe bound by node).
  const RecipeDef* mineCi = reg.recipe(recipes::MineCinderite);
  for (uint32_t t = 0; t < mineCi->timeTicks + 2; ++t) {
    sim.feedMachine(res.handle, 1);  // keep the machine working
    sim.step();
  }
  CHECK(sim.machineOutput(res.handle) > 0);  // produced the off-world ore
}

// =============================================================================
// 5. RECIPE I/O — a recipe consumes inputs and yields outputs (driven through
// the factory-sim recipe model). Smelt: 1 ore -> 1 plate. Assemble: 2 plate -> 1
// frame part. We assert input consumption + output production for both.
// =============================================================================
TEST(recipe_smelt_consumes_ore_and_yields_plate) {
  SliceRegistry reg;
  factory::FactorySim sim;

  const RecipeDef* smelt = reg.recipe(recipes::SmeltFerrite);
  CHECK(smelt != nullptr);
  factory::EntityHandle m = sim.addMachine(smelt->toFactoryRecipe());
  factory::EntityHandle g = sim.addGenerator(/*network*/ 1, /*supplyW*/ 100000);
  (void)g;
  sim.setMachineNetwork(m, 1);

  // Feed exactly one craft worth of input (1 ore), then run the craft time.
  sim.feedMachine(m, smelt->inputCount);  // 1 ore
  CHECK(sim.machineInput(m) == 1);
  CHECK(sim.machineOutput(m) == 0);

  for (uint32_t t = 0; t < smelt->timeTicks; ++t) sim.step();

  CHECK(sim.machineOutput(m) == smelt->outputCount);  // 1 plate produced
  CHECK(sim.machineInput(m) == 0);                    // ore consumed
  // No more input -> no further output (no items conjured).
  for (int t = 0; t < 50; ++t) sim.step();
  CHECK(sim.machineOutput(m) == smelt->outputCount);
}

TEST(recipe_assemble_consumes_two_plates_and_yields_part) {
  SliceRegistry reg;
  factory::FactorySim sim;

  const RecipeDef* asm_ = reg.recipe(recipes::AssembleFrame);
  CHECK(asm_ != nullptr);
  CHECK(asm_->inputCount == 2);  // 2x plate per frame part (§7.2)

  factory::EntityHandle m = sim.addMachine(asm_->toFactoryRecipe());
  factory::EntityHandle g = sim.addGenerator(1, 100000);
  (void)g;
  sim.setMachineNetwork(m, 1);

  // Only ONE plate available -> the assembler must NOT craft (input < required).
  sim.feedMachine(m, 1);
  for (uint32_t t = 0; t < asm_->timeTicks + 5; ++t) sim.step();
  CHECK(sim.machineOutput(m) == 0);   // starved on inputs, no part
  CHECK(sim.machineInput(m) == 1);    // the lone plate is untouched

  // Top up to 2 plates -> now it crafts exactly one frame part.
  sim.feedMachine(m, 1);  // now 2 total
  for (uint32_t t = 0; t < asm_->timeTicks; ++t) sim.step();
  CHECK(sim.machineOutput(m) == asm_->outputCount);  // 1 frame part
  CHECK(sim.machineInput(m) == 0);                   // both plates consumed
}

// =============================================================================
// 6. OBJECTIVE FSM — advances through the chain as predicates are satisfied; the
// terminal "outpost on the moon" step fires ONLY when all conditions hold (§6).
// =============================================================================
TEST(objective_fsm_advances_through_the_slice_chain) {
  ObjectiveTracker obj;
  ObjectiveContext ctx;  // all false initially

  // Start at step 1 (mine first ore), not complete.
  CHECK(obj.current() == ObjectiveStep::MineFirstOre);
  CHECK(obj.stepIndex() == 1);
  CHECK(!obj.complete());

  // With nothing satisfied, ticking does NOT advance.
  CHECK(!obj.tick(ctx));
  CHECK(obj.current() == ObjectiveStep::MineFirstOre);

  // Step 1: mine first ore.
  ctx.hasFerriteOre = true;
  CHECK(obj.tick(ctx));
  CHECK(obj.current() == ObjectiveStep::SmeltPlate);

  // Step 2: smelt a plate.
  ctx.hasFerritePlate = true;
  CHECK(obj.tick(ctx));
  CHECK(obj.current() == ObjectiveStep::AssembleFrame);

  // Step 3: assemble a frame part.
  ctx.hasFramePart = true;
  CHECK(obj.tick(ctx));
  CHECK(obj.current() == ObjectiveStep::StandUpPower);

  // Step 4: a powered, stable network (brownout back to 1.0). Both required.
  ctx.powerNetworkUp = true;
  CHECK(!obj.tick(ctx));  // network up but not yet stable -> no advance
  ctx.powerStable = true;
  CHECK(obj.tick(ctx));
  CHECK(obj.current() == ObjectiveStep::ReachCinder);

  // Step 5: reach + land on Cinder. Both required (in SOI AND landed).
  ctx.onCinder = true;
  CHECK(!obj.tick(ctx));  // in Cinder's SOI but not landed -> no advance
  ctx.landedOnCinder = true;
  CHECK(obj.tick(ctx));
  CHECK(obj.current() == ObjectiveStep::MineOffWorld);

  // Step 6: mine the off-world resource (Cinderite).
  ctx.hasCinderite = true;
  CHECK(obj.tick(ctx));
  CHECK(obj.current() == ObjectiveStep::OutpostComplete);

  // Step 7 (TERMINAL): "land a working automated outpost on the moon" — fires
  // ONLY when a powered miner is running the off-world extraction on a stable
  // network on Cinder. The earlier facts alone are NOT enough.
  CHECK(!obj.tick(ctx));  // not yet: miner-running + outpost-powered are false
  CHECK(!obj.complete());

  ctx.cinderMinerRunning = true;
  CHECK(!obj.tick(ctx));  // still missing the powered-outpost condition
  ctx.cinderOutpostPowered = true;
  CHECK(obj.tick(ctx));   // ALL terminal conditions now hold
  CHECK(obj.complete());
  CHECK(obj.current() == ObjectiveStep::OutpostComplete);
  CHECK(obj.stepIndex() == 7);

  // Once complete, further ticks are no-ops (latched).
  CHECK(!obj.tick(ctx));
}

// The terminal step never triggers early even if every NON-outpost fact is set
// but the two outpost-specific predicates are missing (guards the "only when its
// conditions hold" requirement directly).
TEST(objective_terminal_does_not_trigger_without_outpost_conditions) {
  ObjectiveContext ctx;
  ctx.hasFerriteOre = ctx.hasFerritePlate = ctx.hasFramePart = true;
  ctx.powerNetworkUp = ctx.powerStable = true;
  ctx.onCinder = ctx.landedOnCinder = true;
  ctx.hasCinderite = true;
  // The two outpost-only predicates remain false.
  ctx.cinderMinerRunning = false;
  ctx.cinderOutpostPowered = false;

  CHECK(!ObjectiveTracker::predicate(ObjectiveStep::OutpostComplete, ctx));

  // Flip exactly one on -> still not enough (both are required).
  ctx.cinderMinerRunning = true;
  CHECK(!ObjectiveTracker::predicate(ObjectiveStep::OutpostComplete, ctx));
  ctx.cinderOutpostPowered = true;
  CHECK(ObjectiveTracker::predicate(ObjectiveStep::OutpostComplete, ctx));
}

// =============================================================================
// End-to-end mini-slice: mine -> inventory -> hand-feed a smelter -> plate, and
// drive the objective FSM from real inventory/factory state. Proves the pieces
// compose (the headless analogue of the playable loop's first beats).
// =============================================================================
TEST(end_to_end_mine_then_smelt_drives_objective) {
  SliceRegistry reg;
  worldgen::BodyParams forge = worldgen::makeForge(0xACE1ull);
  Builder builder(reg, forge);
  factory::FactorySim sim;
  Inventory inv(reg, 20);
  ObjectiveTracker obj;

  // A Ferrite deposit + a hand-placed miner on flat ground.
  double lat, lon;
  findFlatSite(forge, lat, lon);
  std::vector<DepositNode> deposits;
  DepositNode fe;
  fe.id = 1;
  fe.resource = items::FerriteOre;
  fe.grade = 1.0f;
  fe.remainingAmount = 1000.0;
  deposits.push_back(fe);

  inv.add(items::Miner, 1);
  inv.add(items::Smelter, 1);

  BuildIntent mineIntent;
  mineIntent.typeId = types::Miner;
  mineIntent.lat = lat;
  mineIntent.lon = lon;
  mineIntent.targetDeposit = 1;
  CHECK(builder.place(mineIntent, inv, sim, deposits).valid());

  // Hand-mine a few units of ore into the pack (the §4.3 hand bridge).
  for (int i = 0; i < 5; ++i) mineDeposit(*Builder::findDeposit(deposits, 1), inv, 1);
  CHECK(inv.count(items::FerriteOre) == 5);

  // Build a smelter + a generator network and hand-feed the smelter ore.
  BuildIntent smeltIntent;
  smeltIntent.typeId = types::Smelter;
  smeltIntent.lat = lat;
  smeltIntent.lon = lon;
  BuildResult sm = builder.place(smeltIntent, inv, sim, deposits);
  CHECK(sm.valid());
  factory::EntityHandle gen = sim.addGenerator(1, 100000);
  (void)gen;

  // Hand-feed 1 ore from the pack into the smelter and run it -> a plate.
  CHECK(inv.remove(items::FerriteOre, 1) == 1);
  sim.feedMachine(sm.handle, 1);
  const RecipeDef* smelt = reg.recipe(recipes::SmeltFerrite);
  for (uint32_t t = 0; t < smelt->timeTicks; ++t) sim.step();
  CHECK(sim.machineOutput(sm.handle) >= 1);  // a plate exists in the smelter out

  // Build the objective context from REAL state and advance the FSM. We mined 5
  // ore and spent 1 on the smelter, so 4 remain in the pack — the step-1
  // predicate (mined Ferrite ore) reads straight from the live inventory.
  ObjectiveContext ctx;
  ctx.hasFerriteOre = inv.has(items::FerriteOre, 1);  // genuinely true (4 left)
  CHECK(ctx.hasFerriteOre);
  CHECK(obj.tick(ctx));  // step 1 -> 2
  CHECK(obj.current() == ObjectiveStep::SmeltPlate);
  ctx.hasFerritePlate = sim.machineOutput(sm.handle) >= 1;  // smelter made a plate
  CHECK(ctx.hasFerritePlate);
  CHECK(obj.tick(ctx));  // step 2 -> 3
  CHECK(obj.current() == ObjectiveStep::AssembleFrame);
}
