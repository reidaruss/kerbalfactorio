// =============================================================================
// test_survival_slice.cpp — headless tests for the WP1 primitive-survival slice.
//
// Maps the survival-crafting content + mechanics (gameplay.h §S / deposits.h §S)
// to concrete assertions, consuming the green gameplay + world-gen cores:
//
//   1. Content      — RegisterSurvivalContent appends the raw/ingot/tool/structure
//                     items + the two smelting recipes (ids in the 0x0030/0x0130
//                     blocks); the pinned slice + science ids are untouched.
//   2. Test-area    — LayoutTestArea lays out a small DETERMINISTIC patch of
//                     survival nodes (one per kind), each yielding its raw ItemId.
//   3. Hand harvest — harvesting a node by hand grants its raw item, depletes
//                     RemainingAmount, stops at 0; the matching TOOL raises yield
//                     (tool helps but is NOT required — no bootstrap deadlock).
//   4. Hand-craft   — a CraftRecipe crafts iff ALL inputs are present (tools,
//                     furnace, smelter); a missing input crafts NOTHING.
//   5. Smelting     — a Furnace smelts ore->ingot over time, BURNING fuel; coal
//                     yields more smelts/unit than wood; the SMELTER tier is
//                     faster than the FURNACE tier; deterministic stalls.
//   6. Determinism  — same seed/inputs -> identical layout + identical furnace
//                     run (bit-for-bit reproducible).
// =============================================================================
#include <cstdio>

#include "test_framework.h"
#include "of/gameplay.h"
#include "of/deposits.h"
#include "of/cubed_sphere.h"

using namespace of;
using namespace of::gameplay;             // core: SliceRegistry, Inventory, ItemDef, ...
namespace surv = of::gameplay::survival;  // the survival slice content lives here
namespace wsv = of::worldgen::survival;

// Pull the survival TYPES / FREE FUNCTIONS this file uses into scope (these do NOT
// collide with the core namespace). The id namespaces (items/types/recipes) DO
// collide with of::gameplay's, so they are referenced via the `surv::` prefix
// below — kept explicit to avoid the ambiguity.
using surv::Furnace;
using surv::FurnaceTier;
using surv::HandCrafter;
using surv::CraftRecipe;
using surv::HarvestResult;
using surv::ToolKind;
using surv::harvestNode;
using surv::assistingToolFor;
using surv::fuelTicksPerUnit;
using surv::ticksPerSmeltFor;
using surv::RegisterSurvivalContent;
using surv::recipeCrudePickaxe;
using surv::recipeCrudeAxe;
using surv::recipePrimitiveFurnace;
using surv::recipeSurvivalSmelter;
using surv::handRecipes;

// Short aliases for the survival id blocks (used pervasively below).
namespace sitems = of::gameplay::survival::items;
namespace stypes = of::gameplay::survival::types;
namespace srecipes = of::gameplay::survival::recipes;

// A registry with the survival content registered (the common slice fixture).
static SliceRegistry makeSurvivalRegistry() {
  SliceRegistry reg;
  RegisterSurvivalContent(reg);
  return reg;
}

// The full set of survival node kinds (one of each), for a complete test patch.
static std::vector<wsv::NodeKind> allKinds() {
  using NK = wsv::NodeKind;
  return {NK::Tree,      NK::Rock,      NK::CoalSeam, NK::IronOre,
          NK::CopperOre, NK::WaterPool, NK::OilSeep};
}

// =============================================================================
// 1. CONTENT — the survival items + recipes register cleanly + additively (§S.1).
// =============================================================================
TEST(survival_content_registers_additively) {
  SliceRegistry reg;
  // The pinned slice block is present before we add anything (12 items / 5 recipes).
  CHECK(reg.allItems().size() == 12);
  CHECK(reg.allRecipes().size() == 5);

  CHECK(RegisterSurvivalContent(reg));

  // 13 survival items (7 raw + 2 ingot + 2 tool + 2 structure) appended.
  CHECK(reg.allItems().size() == 12 + 13);
  // 2 smelting recipes appended.
  CHECK(reg.allRecipes().size() == 5 + 2);

  // The pinned ids are untouched (no renumber/collision).
  CHECK(reg.item(of::gameplay::items::FerriteOre) != nullptr);

  // Raw resources resolve with the right category / stack cap.
  const ItemDef* wood = reg.item(sitems::Wood);
  CHECK(wood != nullptr);
  CHECK(wood->stackMax == 100);
  CHECK((wood->flags & kFlagFuel) != 0);  // wood is a fuel

  const ItemDef* coal = reg.item(sitems::Coal);
  CHECK(coal != nullptr);
  CHECK(coal->category == ItemCategory::Fuel);

  // Ingots, tools, structures present.
  CHECK(reg.item(sitems::Iron) != nullptr);
  CHECK(reg.item(sitems::Copper) != nullptr);
  CHECK(reg.item(sitems::CrudePickaxe) != nullptr);
  CHECK(reg.item(sitems::CrudeAxe) != nullptr);

  // Structures are buildable + cross-link to their entity TypeIds.
  CHECK(reg.item(sitems::PrimitiveFurnace)->isBuildable());
  CHECK(reg.entityForItem(sitems::PrimitiveFurnace) == stypes::PrimitiveFurnace);
  CHECK(reg.entityForItem(sitems::SurvivalSmelter) == stypes::SurvivalSmelter);

  // The smelt recipes do ore -> ingot and are fuel-driven (powerW 0).
  const RecipeDef* si = reg.recipe(srecipes::SmeltIron);
  CHECK(si != nullptr);
  CHECK(si->inputItem == sitems::RawIron);
  CHECK(si->outputItem == sitems::Iron);
  CHECK(si->powerW == 0);
  const RecipeDef* sc = reg.recipe(srecipes::SmeltCopper);
  CHECK(sc != nullptr);
  CHECK(sc->inputItem == sitems::RawCopper);
  CHECK(sc->outputItem == sitems::Copper);

  // Re-registering is idempotent (no duplicates added).
  RegisterSurvivalContent(reg);
  CHECK(reg.allItems().size() == 12 + 13);
  CHECK(reg.allRecipes().size() == 5 + 2);
}

// Survival content coexists with the science layer (no id collisions across the
// 0x0020 / 0x0030 / 0x0120 / 0x0130 blocks).
TEST(survival_content_coexists_with_pinned_and_science_ids) {
  // Survival raw/ingot/tool/structure ids are all >= 0x0030 (past science 0x0022).
  CHECK(sitems::Wood == 0x0030);
  CHECK(sitems::SurvivalSmelter == 0x003C);
  CHECK(srecipes::SmeltIron == 0x0130);
  CHECK(srecipes::SmeltCopper == 0x0131);
  // Each survival ItemId mirrors the worldgen Resource id (Resource IS the ItemId).
  CHECK(sitems::Wood == wsv::kItemWood);
  CHECK(sitems::RawIron == wsv::kItemRawIron);
  CHECK(sitems::Oil == wsv::kItemOil);
}

// =============================================================================
// 2. TEST-AREA — a small deterministic patch of nodes, each yielding its item.
// =============================================================================
TEST(layout_test_area_places_one_node_per_kind_on_surface) {
  worldgen::BodyParams forge = worldgen::makeForge(0xACE1ull);
  const Vec3 centerDir = worldgen::latLonToDir(0.2, 0.5);

  std::vector<wsv::NodeKind> kinds = allKinds();
  std::vector<worldgen::FDepositNode> nodes =
      wsv::LayoutTestArea(forge, forge.bodySeed, /*frame*/ 1, centerDir, kinds);

  CHECK(nodes.size() == kinds.size());  // one node per requested kind

  // Each node yields the right raw ItemId, has a positive amount, valid grade,
  // and a stable nonzero id.
  for (size_t i = 0; i < nodes.size(); ++i) {
    const worldgen::FDepositNode& n = nodes[i];
    CHECK(n.Resource == wsv::resourceOf(kinds[i]));
    CHECK(n.Resource != 0);
    CHECK(n.RemainingAmount > 0.0);
    CHECK(n.Grade > 0.5f && n.Grade <= 1.0f);
    CHECK(n.Id != 0);
    CHECK(n.Body == forge.bodyId);
  }

  // Ids are distinct across kinds (no two nodes share a save key).
  for (size_t i = 0; i < nodes.size(); ++i)
    for (size_t j = i + 1; j < nodes.size(); ++j)
      CHECK(nodes[i].Id != nodes[j].Id);
}

// =============================================================================
// 3. HAND HARVEST — grants the raw item, depletes to 0; the tool raises yield
//    but is NOT required (no bootstrap deadlock).
// =============================================================================
TEST(hand_harvest_grants_item_and_depletes_to_zero) {
  SliceRegistry reg = makeSurvivalRegistry();
  Inventory inv(reg, 20);

  // A small wood node (a tree) so we can hit empty quickly.
  worldgen::FDepositNode tree;
  tree.Id = 1;
  tree.Resource = sitems::Wood;
  tree.Grade = 1.0f;
  tree.RemainingAmount = 4.0;

  // Bare-hands base yield = 1/pull. Four pulls empties the node.
  for (int i = 0; i < 4; ++i) {
    HarvestResult r = harvestNode(tree, wsv::NodeKind::Tree, inv,
                                  /*baseYield*/ 1, /*toolYield*/ 3);
    CHECK(r.granted == 1);
    CHECK(!r.usedTool);  // no axe in the pack
  }
  CHECK(inv.count(sitems::Wood) == 4);
  CHECK(tree.RemainingAmount == 0.0);

  // A further pull on the empty node yields nothing + reports empty.
  HarvestResult after = harvestNode(tree, wsv::NodeKind::Tree, inv);
  CHECK(after.granted == 0);
  CHECK(after.nodeEmpty);
  CHECK(inv.count(sitems::Wood) == 4);  // nothing conjured from an empty node
}

TEST(tool_assisted_harvest_yields_more_than_hand) {
  SliceRegistry reg = makeSurvivalRegistry();

  // --- Bare hands on a rock: base yield per pull. ---
  Inventory hands(reg, 20);
  worldgen::FDepositNode rock1;
  rock1.Id = 10;
  rock1.Resource = sitems::Stone;
  rock1.Grade = 1.0f;
  rock1.RemainingAmount = 100.0;
  HarvestResult bare = harvestNode(rock1, wsv::NodeKind::Rock, hands,
                                   /*baseYield*/ 1, /*toolYield*/ 3);
  CHECK(!bare.usedTool);
  CHECK(bare.granted == 1);

  // --- With a pickaxe: higher yield per pull on the SAME kind. ---
  Inventory withPick(reg, 20);
  withPick.add(sitems::CrudePickaxe, 1);
  worldgen::FDepositNode rock2 = rock1;
  rock2.Id = 11;
  HarvestResult tooled = harvestNode(rock2, wsv::NodeKind::Rock, withPick,
                                     /*baseYield*/ 1, /*toolYield*/ 3);
  CHECK(tooled.usedTool);
  CHECK(tooled.granted == 3);
  CHECK(tooled.granted > bare.granted);  // tool helps

  // Water/oil need no tool — bare hands collect at base rate (assist = None), and
  // a pickaxe does NOT boost them (wrong tool / no tool needed).
  CHECK(assistingToolFor(wsv::NodeKind::WaterPool) == ToolKind::None);
  Inventory pool(reg, 20);
  pool.add(sitems::CrudePickaxe, 1);  // pickaxe present but irrelevant to water
  worldgen::FDepositNode water;
  water.Id = 12;
  water.Resource = sitems::Water;
  water.Grade = 1.0f;
  water.RemainingAmount = 50.0;
  HarvestResult w = harvestNode(water, wsv::NodeKind::WaterPool, pool, 1, 3);
  CHECK(!w.usedTool);     // no assisting tool for water -> base yield
  CHECK(w.granted == 1);
}

// A node's RemainingAmount is a double — InitialAmount is baseAmountOf(kind)
// times a FRACTIONAL Grade — so the last pull on every node in the world is a
// sub-unit remainder. Truncating that to a uint16 gave 0: no grant, no
// decrement, nodeEmpty never fired, and the node parked just above empty
// forever. This pins the fix: a positive remainder always yields at least one
// unit and always drains the node.
TEST(hand_harvest_finishes_a_sub_unit_remainder) {
  SliceRegistry reg = makeSurvivalRegistry();
  Inventory inv(reg, 20);

  // Exactly the shape LayoutTestArea/of_gp_node_add produce: base 40 * grade.
  worldgen::FDepositNode tree;
  tree.Id = 20;
  tree.Resource = sitems::Wood;
  tree.Grade = 0.518f;
  tree.InitialAmount = 40.0 * 0.518;   // 20.72 — never an integer
  tree.RemainingAmount = tree.InitialAmount;

  // Drain everything but the fraction with whole-unit pulls, and check that the
  // node loses EXACTLY what the pack gains while there is a whole unit left.
  int guard = 0;
  while (tree.RemainingAmount >= 1.0 && guard++ < 100) {
    const double before = tree.RemainingAmount;
    const uint32_t held = inv.count(sitems::Wood);
    HarvestResult r = harvestNode(tree, wsv::NodeKind::Tree, inv, 4, 8);
    CHECK(r.granted > 0);                                   // never an empty swing
    CHECK(inv.count(sitems::Wood) == held + r.granted);
    if (before >= static_cast<double>(r.granted))
      CHECK(std::fabs((before - tree.RemainingAmount) -
                      static_cast<double>(r.granted)) < 1e-9);
  }
  CHECK(guard < 100);
  // The old defect: a remainder in (0, 1) that no swing could ever remove.
  CHECK(tree.RemainingAmount > 0.0);
  CHECK(tree.RemainingAmount < 1.0);

  const uint32_t held = inv.count(sitems::Wood);
  HarvestResult last = harvestNode(tree, wsv::NodeKind::Tree, inv, 4, 8);
  CHECK(last.granted == 1);                       // the crumb rounds up to a unit
  CHECK(last.nodeEmpty);                          // and the node reports finished
  CHECK(tree.RemainingAmount == 0.0);
  CHECK(inv.count(sitems::Wood) == held + 1);

  // A node can now actually be finished: the total taken is the node's amount
  // rounded up, never more than one unit over.
  const double total = static_cast<double>(inv.count(sitems::Wood));
  CHECK(total >= tree.InitialAmount);
  CHECK(total < tree.InitialAmount + 1.0);
}

// The authored pacing: swings-to-clear is the constant, the per-swing yield is
// derived from the node's own size. Every kind clears in the same handful of
// swings, and the matching tool halves it.
TEST(harvest_pacing_clears_every_node_in_a_handful_of_swings) {
  SliceRegistry reg = makeSurvivalRegistry();
  const wsv::NodeKind kinds[] = {wsv::NodeKind::Tree, wsv::NodeKind::Rock,
                                 wsv::NodeKind::CoalSeam, wsv::NodeKind::IronOre,
                                 wsv::NodeKind::CopperOre};
  for (const wsv::NodeKind k : kinds) {
    // Grade 0.5 and 1.0 bracket the whole range LayoutTestArea can produce.
    for (const double grade : {0.5, 1.0}) {
      for (const bool withTool : {false, true}) {
        Inventory inv(reg, 20);
        if (withTool) {
          inv.add(sitems::CrudePickaxe, 1);
          inv.add(sitems::CrudeAxe, 1);
        }
        worldgen::FDepositNode n;
        n.Id = 30;
        n.Resource = wsv::resourceOf(k);
        n.Grade = static_cast<float>(grade);
        n.InitialAmount = wsv::baseAmountOf(k) * grade;
        n.RemainingAmount = n.InitialAmount;
        const uint32_t want = static_cast<uint32_t>(n.InitialAmount);

        int swings = 0;
        while (n.RemainingAmount > 0.0 && swings < 64) {
          HarvestResult r = harvestNode(n, k, inv);  // 0,0 = authored pacing
          CHECK(r.granted > 0);
          CHECK(r.usedTool == withTool);
          ++swings;
        }
        // The authored count, for every kind and every grade. It is a ceiling,
        // never an overrun: one fewer only when the amount divides the swing
        // count exactly (grade 0.5 on a 40-unit tree is 20 / 4 = 5), which is a
        // rounding gift, not a grind.
        const int want_swings =
            static_cast<int>(withTool ? surv::kToolSwings : surv::kBareHandSwings);
        CHECK(swings <= want_swings);
        CHECK(swings >= want_swings - 1);
        CHECK(n.RemainingAmount == 0.0);
        // Nothing lost on the way: the pack holds the whole node.
        CHECK(inv.count(n.Resource) >= want);
      }
    }
  }
  // Bare hands always work — the no-bootstrap-deadlock property.
  CHECK(surv::kBareHandSwings > 0);
  CHECK(surv::kToolSwings > 0);
  CHECK(surv::kToolSwings < surv::kBareHandSwings);
}

// =============================================================================
// 4. HAND-CRAFT — crafts iff ALL inputs present; a missing input crafts nothing.
// =============================================================================
TEST(hand_craft_succeeds_only_with_all_inputs) {
  SliceRegistry reg = makeSurvivalRegistry();
  Inventory inv(reg, 20);

  CraftRecipe pick = recipeCrudePickaxe();  // 1 raw_iron + 1 wood
  CHECK(pick.output == sitems::CrudePickaxe);

  // Empty pack -> cannot craft, and craft() consumes nothing.
  CHECK(!HandCrafter::canCraft(pick, inv));
  CHECK(!HandCrafter::craft(pick, inv));

  // Only wood (missing the raw_iron) -> still cannot craft.
  inv.add(sitems::Wood, 1);
  CHECK(!HandCrafter::canCraft(pick, inv));
  CHECK(!HandCrafter::craft(pick, inv));
  CHECK(inv.count(sitems::Wood) == 1);  // the lone wood is untouched

  // Add the raw_iron -> now craftable; craft consumes both inputs, adds the tool.
  inv.add(sitems::RawIron, 1);
  CHECK(HandCrafter::canCraft(pick, inv));
  CHECK(HandCrafter::craft(pick, inv));
  CHECK(inv.count(sitems::CrudePickaxe) == 1);
  CHECK(inv.count(sitems::Wood) == 0);     // consumed
  CHECK(inv.count(sitems::RawIron) == 0);  // consumed

  // A second craft now fails (inputs spent) — all-or-nothing.
  CHECK(!HandCrafter::craft(pick, inv));
  CHECK(inv.count(sitems::CrudePickaxe) == 1);
}

// The full bootstrap chain hand-crafts: tools, then a furnace, then (after a
// smelt to get iron) a smelter — all from the pack, no machine.
TEST(hand_craft_furnace_and_smelter_bill_of_materials) {
  SliceRegistry reg = makeSurvivalRegistry();
  Inventory inv(reg, 20);

  // Furnace = 5 wood + 2 raw_iron.
  inv.add(sitems::Wood, 5);
  inv.add(sitems::RawIron, 2);
  CHECK(HandCrafter::craft(recipePrimitiveFurnace(), inv));
  CHECK(inv.count(sitems::PrimitiveFurnace) == 1);
  CHECK(inv.count(sitems::Wood) == 0);
  CHECK(inv.count(sitems::RawIron) == 0);

  // Smelter = 5 iron(smelted) + 5 stone. With only stone it must NOT craft.
  inv.add(sitems::Stone, 5);
  CHECK(!HandCrafter::canCraft(recipeSurvivalSmelter(), inv));
  // Add the smelted iron -> now craftable.
  inv.add(sitems::Iron, 5);
  CHECK(HandCrafter::craft(recipeSurvivalSmelter(), inv));
  CHECK(inv.count(sitems::SurvivalSmelter) == 1);
  CHECK(inv.count(sitems::Iron) == 0);
  CHECK(inv.count(sitems::Stone) == 0);

  // handRecipes() exposes the full offered set for the UE craft menu.
  CHECK(handRecipes().size() == 4);
}

// =============================================================================
// 5. SMELTING — Furnace smelts ore->ingot over time, burning fuel; coal beats
//    wood per unit; smelter is faster than furnace; stalls deterministically.
// =============================================================================
TEST(furnace_smelts_ore_to_ingot_over_time_consuming_fuel) {
  Furnace furnace(FurnaceTier::Furnace);
  CHECK(furnace.ticksPerSmelt() == 180);

  // Load 1 raw_iron + 1 wood of fuel (wood = 360 fuel ticks = ~2 furnace smelts).
  CHECK(furnace.loadOre(sitems::RawIron, 1) == 1);
  CHECK(furnace.loadFuel(sitems::Wood, 1));
  CHECK(furnace.fuelTicks() == 360);
  CHECK(furnace.outputCount() == 0);

  // Before the smelt time, no ingot yet (but progress + fuel are being spent).
  furnace.run(179);
  CHECK(furnace.outputCount() == 0);
  CHECK(furnace.oreCount() == 1);
  CHECK(furnace.fuelTicks() == 360 - 179);

  // The 180th progressing tick completes one iron ingot; the ore is consumed.
  CHECK(furnace.tick());  // returns true on completion
  CHECK(furnace.outputCount() == 1);
  CHECK(furnace.outputItem() == sitems::Iron);
  CHECK(furnace.oreCount() == 0);
  CHECK(furnace.fuelTicks() == 360 - 180);  // exactly one smelt of fuel burned

  // Taking the ingot out empties the output buffer.
  CHECK(furnace.takeOutput(1) == 1);
  CHECK(furnace.outputCount() == 0);
}

TEST(furnace_stalls_without_ore_or_fuel) {
  Furnace furnace(FurnaceTier::Furnace);

  // No ore, no fuel: ticking makes no progress (deterministic idle).
  CHECK(furnace.run(500) == 0);
  CHECK(!furnace.smelting());

  // Ore but NO fuel: still stalls (fuel is required to burn).
  furnace.loadOre(sitems::RawIron, 1);
  CHECK(furnace.run(500) == 0);
  CHECK(furnace.outputCount() == 0);
  CHECK(furnace.progress() == 0);

  // Add just under one smelt of fuel -> it runs out mid-smelt, no ingot, ore kept.
  furnace.loadFuel(sitems::Wood, 1);          // 360 ticks
  CHECK(furnace.fuelTicks() == 360);
  // Burn 180 of fuel = exactly one smelt -> one ingot, 180 fuel left.
  uint32_t done = furnace.run(180);
  CHECK(done == 1);
  CHECK(furnace.outputCount() == 1);
}

TEST(coal_yields_more_smelts_per_unit_than_wood) {
  // Coal contributes far more burn time than wood per unit.
  CHECK(fuelTicksPerUnit(sitems::Coal) > fuelTicksPerUnit(sitems::Wood));

  // Smelts-per-unit at the furnace tier (180 t/smelt): wood ~2, coal ~8.
  const uint32_t per = ticksPerSmeltFor(FurnaceTier::Furnace);
  CHECK(fuelTicksPerUnit(sitems::Wood) / per == 2);
  CHECK(fuelTicksPerUnit(sitems::Coal) / per == 8);

  // A furnace fed ONE coal unit smelts ~8 ore where one wood unit smelts ~2.
  auto smeltsFromOneFuel = [](ItemId fuel) {
    Furnace f(FurnaceTier::Furnace);
    f.loadOre(sitems::RawIron, 100);  // plenty of ore
    f.loadFuel(fuel, 1);             // exactly one unit of fuel
    return f.run(100000);           // run until fuel exhausts
  };
  CHECK(smeltsFromOneFuel(sitems::Wood) == 2);
  CHECK(smeltsFromOneFuel(sitems::Coal) == 8);

  // A non-fuel item cannot be loaded as fuel.
  Furnace f(FurnaceTier::Furnace);
  CHECK(!f.loadFuel(sitems::Stone, 1));
  CHECK(f.fuelTicks() == 0);
}

TEST(smelter_is_faster_than_furnace) {
  CHECK(ticksPerSmeltFor(FurnaceTier::Smelter) <
        ticksPerSmeltFor(FurnaceTier::Furnace));

  // Same ore + ample fuel: count smelts completed in a fixed window. The smelter
  // (60 t/smelt) completes strictly more than the furnace (180 t/smelt).
  auto smeltsInWindow = [](FurnaceTier tier, uint32_t ticks) {
    Furnace f(tier);
    f.loadOre(sitems::RawCopper, 1000);
    f.loadFuel(sitems::Coal, 1000);  // effectively unlimited fuel for the window
    return f.run(ticks);
  };
  const uint32_t window = 1800;
  const uint32_t furnaceSmelts = smeltsInWindow(FurnaceTier::Furnace, window);
  const uint32_t smelterSmelts = smeltsInWindow(FurnaceTier::Smelter, window);
  std::printf("    [smelt] furnace=%u  smelter=%u  (window=%u ticks)\n",
              furnaceSmelts, smelterSmelts, window);
  CHECK(furnaceSmelts == window / 180);   // 10
  CHECK(smelterSmelts == window / 60);    // 30
  CHECK(smelterSmelts > furnaceSmelts);

  // The smelter outputs the right ingot (copper from raw_copper).
  Furnace s(FurnaceTier::Smelter);
  s.loadOre(sitems::RawCopper, 1);
  s.loadFuel(sitems::Coal, 1);
  CHECK(s.run(60) == 1);
  CHECK(s.outputItem() == sitems::Copper);
}

// =============================================================================
// 6. DETERMINISM — same inputs reproduce the same layout + furnace run bit-for-bit.
// =============================================================================
TEST(layout_and_smelt_are_deterministic) {
  worldgen::BodyParams forge = worldgen::makeForge(0x1234ull);
  const Vec3 centerDir = worldgen::latLonToDir(-0.3, 1.1);
  std::vector<wsv::NodeKind> kinds = allKinds();

  std::vector<worldgen::FDepositNode> a =
      wsv::LayoutTestArea(forge, forge.bodySeed, 1, centerDir, kinds);
  std::vector<worldgen::FDepositNode> b =
      wsv::LayoutTestArea(forge, forge.bodySeed, 1, centerDir, kinds);

  CHECK(a.size() == b.size());
  for (size_t i = 0; i < a.size(); ++i) {
    CHECK(a[i].Id == b[i].Id);
    CHECK(a[i].Resource == b[i].Resource);
    CHECK(a[i].Grade == b[i].Grade);
    CHECK(a[i].RemainingAmount == b[i].RemainingAmount);
    CHECK(a[i].Position.pos.x == b[i].Position.pos.x);
    CHECK(a[i].Position.pos.y == b[i].Position.pos.y);
    CHECK(a[i].Position.pos.z == b[i].Position.pos.z);
  }

  // Two furnaces given identical ore+fuel produce identical results tick-for-tick.
  Furnace f1(FurnaceTier::Furnace), f2(FurnaceTier::Furnace);
  for (Furnace* f : {&f1, &f2}) {
    f->loadOre(sitems::RawIron, 3);
    f->loadFuel(sitems::Coal, 1);
  }
  for (int i = 0; i < 1000; ++i) {
    const bool c1 = f1.tick();
    const bool c2 = f2.tick();
    CHECK(c1 == c2);
  }
  CHECK(f1.outputCount() == f2.outputCount());
  CHECK(f1.fuelTicks() == f2.fuelTicks());
  CHECK(f1.oreCount() == f2.oreCount());
}

// =============================================================================
// End-to-end mini survival loop: hand-harvest -> hand-craft tools -> harvest
// faster with the tool -> craft a furnace -> smelt ore into iron with fuel.
// =============================================================================
TEST(end_to_end_survival_bootstrap_loop) {
  SliceRegistry reg = makeSurvivalRegistry();
  worldgen::BodyParams forge = worldgen::makeForge(0xBEEFull);
  Inventory inv(reg, 20);

  // Lay out a patch with a tree, an iron node, and a coal seam.
  using NK = wsv::NodeKind;
  const Vec3 centerDir = worldgen::latLonToDir(0.1, 0.4);
  std::vector<worldgen::FDepositNode> nodes = wsv::LayoutTestArea(
      forge, forge.bodySeed, 1, centerDir, {NK::Tree, NK::IronOre, NK::CoalSeam});
  worldgen::FDepositNode& tree = nodes[0];
  worldgen::FDepositNode& iron = nodes[1];
  worldgen::FDepositNode& coal = nodes[2];

  // 1) Hand-harvest wood + raw_iron (bare hands — bootstrap with no tools yet).
  while (inv.count(sitems::Wood) < 1) harvestNode(tree, NK::Tree, inv, 1, 3);
  while (inv.count(sitems::RawIron) < 1) harvestNode(iron, NK::IronOre, inv, 1, 3);
  CHECK(inv.has(sitems::Wood, 1));
  CHECK(inv.has(sitems::RawIron, 1));

  // 2) Hand-craft a crude pickaxe (1 raw_iron + 1 wood).
  CHECK(HandCrafter::craft(recipeCrudePickaxe(), inv));
  CHECK(inv.has(sitems::CrudePickaxe, 1));

  // 3) With the pickaxe, an iron pull now yields MORE than the bare-hand pull.
  const uint32_t before = inv.count(sitems::RawIron);
  HarvestResult tooled = harvestNode(iron, NK::IronOre, inv, 1, 3);
  CHECK(tooled.usedTool);
  CHECK(inv.count(sitems::RawIron) - before == 3);

  // 4) Gather enough for a furnace (5 wood + 2 raw_iron) and craft it.
  while (inv.count(sitems::Wood) < 5) harvestNode(tree, NK::Tree, inv, 1, 3);
  while (inv.count(sitems::RawIron) < 2) harvestNode(iron, NK::IronOre, inv, 1, 3);
  CHECK(HandCrafter::craft(recipePrimitiveFurnace(), inv));
  CHECK(inv.has(sitems::PrimitiveFurnace, 1));

  // 5) Harvest coal for fuel + a raw_iron to smelt, then smelt to iron.
  while (inv.count(sitems::Coal) < 1) harvestNode(coal, NK::CoalSeam, inv, 1, 3);
  while (inv.count(sitems::RawIron) < 1) harvestNode(iron, NK::IronOre, inv, 1, 3);

  Furnace furnace(FurnaceTier::Furnace);
  CHECK(furnace.loadOre(sitems::RawIron, 1) == 1);
  CHECK(inv.remove(sitems::RawIron, 1) == 1);  // ore leaves the pack into the furnace
  CHECK(furnace.loadFuel(sitems::Coal, 1));     // coal: 1440 fuel ticks
  CHECK(furnace.run(180) == 1);                // one smelt completes
  CHECK(furnace.outputItem() == sitems::Iron);
  CHECK(furnace.takeOutput(1) == 1);
  inv.add(sitems::Iron, 1);                     // ingot back into the pack
  CHECK(inv.has(sitems::Iron, 1));              // the survival payoff: smelted iron
}
