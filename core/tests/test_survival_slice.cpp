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
//   7. Structures   — the base-building set (§S.6) is DATA: four defs with pinned
//                     item/entity ids and a build cost paid all-or-nothing by
//                     payInputs, which never leaks into the hand-craft menu.
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
using surv::CraftBlock;
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
using surv::StructureKind;
using surv::StructureDef;
using surv::structureDefs;

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

  // 21 survival items (7 raw + 2 ingot + 2 tool + 2 machine + 3 electrification
  // + 5 structural, the fifth being GP-57's launch pad) appended.
  CHECK(reg.allItems().size() == 12 + 21);
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
  CHECK(reg.allItems().size() == 12 + 21);
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

// GP-51 — A CRAFT INTO A FULL PACK IS REFUSED, AND IT IS REFUSED BY THE OUTPUT
// SIDE, WHICH IS THE WHOLE POINT.
//
// The shipped defect returned TRUE here: it spent 5 Wood and 2 Raw iron, called
// inv.add(), threw the overflow away and reported success. The only symptom is
// that nothing happens. `canCraft` is asserted TRUE in the same breath as the
// refusal, because that is what makes the claim specific: this is not "the
// inputs are missing" wearing a different hat.
//
// THE FULL PACK IS REACHED, NOT WRITTEN. Slot counts are derived from the
// registry's own stackMax and fullness is proven by the only honest test there
// is — one more of a new item does not fit — so a stacking-rule change cannot
// leave this test asserting against a state the production path can no longer
// produce. That is standing rule 11's fixture-versus-production-path lesson.
TEST(a_craft_into_a_full_pack_is_refused_and_spends_nothing) {
  SliceRegistry reg = makeSurvivalRegistry();
  Inventory inv(reg, 20);
  const CraftRecipe furnace = recipePrimitiveFurnace();  // 5 Wood + 2 Raw iron

  const uint16_t cap = reg.stackMax(sitems::Wood);
  CHECK(cap >= 4);
  // Four slots per item x five items = every one of the twenty slots, and each
  // item's LAST slot is a half stack, so spending a few units frees nothing.
  const uint16_t perItem = static_cast<uint16_t>(cap * 3 + cap / 2);
  const ItemId fill[5] = {sitems::Wood, sitems::Stone, sitems::Coal,
                          sitems::RawIron, sitems::RawCopper};
  for (const ItemId it : fill) CHECK(inv.add(it, perItem) == 0);
  // Proven full by the production path: a new item has nowhere to go.
  CHECK(inv.add(sitems::CrudePickaxe, 1) == 1);
  CHECK(inv.count(sitems::CrudePickaxe) == 0);

  // The inputs ARE there. This is the discriminator: a boolean "cannot craft"
  // cannot tell this state from an empty pack, and the two need opposite fixes.
  CHECK(HandCrafter::canCraft(furnace, inv));
  CHECK(HandCrafter::craftBlock(furnace, inv) == CraftBlock::PackFull);

  const uint32_t woodBefore = inv.count(sitems::Wood);
  const uint32_t ironBefore = inv.count(sitems::RawIron);
  CHECK(!HandCrafter::craft(furnace, inv));
  CHECK(inv.count(sitems::PrimitiveFurnace) == 0);   // no output...
  CHECK(inv.count(sitems::Wood) == woodBefore);      // ...and NOTHING was paid
  CHECK(inv.count(sitems::RawIron) == ironBefore);

  // NEGATIVE CONTROL, on the SAME pack with ONE slot different. Emptying ONE
  // stack of Coal changes nothing about the inputs and everything about the
  // room, and the identical craft now succeeds and charges exactly its bill.
  CHECK(inv.remove(sitems::Coal, cap) == cap);
  CHECK(HandCrafter::craftBlock(furnace, inv) == CraftBlock::None);
  CHECK(HandCrafter::craft(furnace, inv));
  CHECK(inv.count(sitems::PrimitiveFurnace) == 1);
  CHECK(inv.count(sitems::Wood) == woodBefore - 5);
  CHECK(inv.count(sitems::RawIron) == ironBefore - 2);
}

// GP-51's OTHER direction, and the one a lazy fix gets wrong: THE INPUTS FREE
// THEIR OWN SLOTS, so a pack with no spare slot at all can still craft when the
// spend empties one. A check that counted free slots BEFORE spending would
// refuse this, which would be a second silent failure wearing the fix's badge.
TEST(a_full_pack_still_crafts_when_the_spend_frees_the_slot) {
  SliceRegistry reg = makeSurvivalRegistry();
  Inventory inv(reg, 20);
  const CraftRecipe pick = recipeCrudePickaxe();  // 1 RawIron + 1 Wood

  const uint16_t cap = reg.stackMax(sitems::Stone);
  for (int s = 0; s < 18; ++s) CHECK(inv.add(sitems::Stone, cap) == 0);
  // The last two slots hold EXACTLY the bill, so spending them empties both.
  CHECK(inv.add(sitems::Wood, 1) == 0);
  CHECK(inv.add(sitems::RawIron, 1) == 0);
  CHECK(inv.add(sitems::Coal, 1) == 1);  // full, by the production path

  CHECK(HandCrafter::craftBlock(pick, inv) == CraftBlock::None);
  CHECK(HandCrafter::craft(pick, inv));
  CHECK(inv.count(sitems::CrudePickaxe) == 1);
  CHECK(inv.count(sitems::Wood) == 0);
  CHECK(inv.count(sitems::RawIron) == 0);

  // And the block code names the OTHER refusal correctly on the same pack.
  CHECK(HandCrafter::craftBlock(pick, inv) == CraftBlock::InputsShort);
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

  // handRecipes() exposes the full offered set for the UE craft menu. Four
  // tier-0 recipes plus the three electrification craftables (§S.5: pole,
  // burner generator, electric smelter), APPENDED, so the original four keep
  // their positions and anything that indexes the list is unmoved.
  CHECK(handRecipes().size() == 7);
  CHECK(handRecipes()[0].output == sitems::CrudePickaxe);
  CHECK(handRecipes()[3].output == sitems::SurvivalSmelter);
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

// =============================================================================
// 7. ORE PATCHES (deposits.h §P + gameplay.h §S.5): a deposit is GROUND, and
//    an outcrop is a window onto it rather than a second reservoir.
//
//    The three things that must hold before a drill can exist:
//      a. BOOTSTRAP : bare hands ALWAYS yield ore from a patch, so the player
//                      can reach the iron a drill costs. The matching tool
//                      raises the yield; it is never required.
//      b. ONE POOL  : the units the player keeps come OUT of the patch, exactly,
//                      and every outcrop of that patch reports the same number.
//      c. FINISHABLE: the patch drains to zero and then grants nothing.
// =============================================================================
TEST(patch_hand_mining_is_one_pool_and_never_deadlocks) {
  using NK = worldgen::survival::NodeKind;
  namespace wp = worldgen::patches;

  const worldgen::BodyParams forge = worldgen::makeForge(6100ull);
  const Vec3 c = worldgen::latLonToDir(0.2, 0.4);
  std::vector<uint8_t> kinds{static_cast<uint8_t>(NK::IronOre)};
  auto field = wp::LayoutPatchField(forge, forge.bodySeed, FrameId(1), c, kinds);
  CHECK(field.size() == 1u);
  wp::OrePatch& patch = field[0];
  const double initial = patch.InitialAmount;
  CHECK(initial > 500.0);
  CHECK(patch.Resource == sitems::RawIron);

  SliceRegistry reg;
  CHECK(RegisterSurvivalContent(reg));
  Inventory inv(reg);

  // Two DIFFERENT outcrops of the same patch. Nothing in the pack: bare hands.
  worldgen::FDepositNode a, b;
  a.Resource = patch.Resource;
  b.Resource = patch.Resource;

  HarvestResult r1 = survival::harvestPatch(patch, a, NK::IronOre, inv);
  CHECK(r1.granted == wp::kHandYieldBare);   // (a) bare hands always work
  CHECK(!r1.usedTool);
  CHECK_NEAR(patch.RemainingAmount, initial - wp::kHandYieldBare, 1e-9);
  // (b) the OTHER outcrop draws from the SAME pool: it is handed the patch's
  //     number on the way in, so it can neither refill it nor hold one of its
  //     own. `a` is deliberately not re-read here: an outcrop is a view that is
  //     re-derived when it is used, and asserting a stale copy would be
  //     asserting the bug this design exists to prevent.
  HarvestResult r2 = survival::harvestPatch(patch, b, NK::IronOre, inv);
  CHECK(r2.granted == wp::kHandYieldBare);
  CHECK_NEAR(b.RemainingAmount, patch.RemainingAmount, 1e-9);
  CHECK_NEAR(b.InitialAmount, patch.InitialAmount, 1e-9);
  CHECK(inv.count(sitems::RawIron) == 2 * wp::kHandYieldBare);
  CHECK_NEAR(initial - patch.RemainingAmount,
             static_cast<double>(inv.count(sitems::RawIron)), 1e-9);

  // The tool raises the pull and is still not required.
  inv.add(sitems::CrudePickaxe, 1);
  const double beforeTool = patch.RemainingAmount;
  HarvestResult r3 = survival::harvestPatch(patch, a, NK::IronOre, inv);
  CHECK(r3.usedTool);
  CHECK(r3.granted == wp::kHandYieldTool);
  CHECK(wp::kHandYieldTool > wp::kHandYieldBare);
  CHECK_NEAR(beforeTool - patch.RemainingAmount,
             static_cast<double>(wp::kHandYieldTool), 1e-9);

  // (c) drain it flat and confirm it stays empty.
  wp::extract(patch, patch.RemainingAmount);
  CHECK_NEAR(patch.RemainingAmount, 0.0, 1e-12);
  HarvestResult r4 = survival::harvestPatch(patch, a, NK::IronOre, inv);
  CHECK(r4.granted == 0);
  CHECK(r4.nodeEmpty);
}

// =============================================================================
// 7. STRUCTURAL BUILDING SET (gameplay.h §S.6) — the base-building parts are
//    DATA: four defs with pinned item/entity ids and a build COST that is paid
//    all-or-nothing on placement, and that never leaks into the craft menu.
// =============================================================================
TEST(structure_defs_are_data_with_pinned_ids_and_costs) {
  const std::vector<StructureDef> defs = structureDefs();
  CHECK(defs.size() == 5);

  // Pinned ids: items 0x0040.. , entity TypeIds 0x40.. (ASSET-SPECS §4).
  CHECK(defs[0].kind == StructureKind::Foundation);
  CHECK(defs[0].item == sitems::Foundation);
  CHECK(defs[0].item == 0x0040);
  CHECK(defs[0].typeId == stypes::Foundation);
  CHECK(defs[0].typeId == 0x40);

  CHECK(defs[1].kind == StructureKind::Floor);
  CHECK(defs[1].item == sitems::Floor);
  CHECK(defs[1].item == 0x0041);
  CHECK(defs[1].typeId == 0x41);

  CHECK(defs[2].kind == StructureKind::Wall);
  CHECK(defs[2].item == sitems::Wall);
  CHECK(defs[2].item == 0x0042);
  CHECK(defs[2].typeId == 0x42);

  CHECK(defs[3].kind == StructureKind::Door);
  CHECK(defs[3].item == sitems::Door);
  CHECK(defs[3].item == 0x0043);
  CHECK(defs[3].typeId == 0x43);

  // GP-57. The launch pad continues the SAME two blocks rather than opening a
  // third, which is the whole claim behind putting it in this enum.
  CHECK(defs[4].kind == StructureKind::LaunchPad);
  CHECK(defs[4].item == sitems::LaunchPad);
  CHECK(defs[4].item == 0x0044);
  CHECK(defs[4].typeId == stypes::LaunchPad);
  CHECK(defs[4].typeId == 0x44);
  // AND IT DOES NOT COLLIDE WITH THE VESSEL PART ITEM BLOCK. GP-31 spent
  // 0x0050..0x006A on the part items and GP-42 left the gap deliberately; a pad
  // that had simply taken "the next id" after the armour block would have
  // landed inside it. The bound is asserted rather than the digit alone,
  // because the digit alone cannot say WHY it is that digit.
  CHECK(defs[4].item < 0x0050);
  CHECK(defs[4].item > sitems::Door);

  // Every def carries a name and a non-empty cost whose output is its own item
  // (one coherent id space: the cost is a CraftRecipe, not a second concept).
  for (const StructureDef& d : defs) {
    CHECK(d.name != nullptr);
    CHECK(d.name[0] != '\0');
    CHECK(!d.cost.inputs.empty());
    CHECK(d.cost.output == d.item);
    CHECK(d.cost.outputCount == 1);
    for (const ItemStack& in : d.cost.inputs) {
      CHECK(in.item != kNoItem);
      CHECK(in.count > 0);
    }
  }

  // The authored Tier-0 costs, RE-PRICED for the 4 m module (GP-40 / DW-32).
  // A deck is an area and went up 16x in plan, so it is priced at 10x; a wall
  // is a line and grew 5.6x in panel, so it is priced at 4x. Both are
  // deliberately short of parity, because DW-32 existed to cut the grind.
  CHECK(defs[0].cost.inputs.size() == 1);
  CHECK(defs[0].cost.inputs[0].item == sitems::Stone);
  CHECK(defs[0].cost.inputs[0].count == 40);

  CHECK(defs[1].cost.inputs.size() == 2);
  CHECK(defs[1].cost.inputs[0].item == sitems::Wood);
  CHECK(defs[1].cost.inputs[0].count == 20);
  CHECK(defs[1].cost.inputs[1].item == sitems::Stone);
  CHECK(defs[1].cost.inputs[1].count == 20);

  CHECK(defs[2].cost.inputs.size() == 1);
  CHECK(defs[2].cost.inputs[0].item == sitems::Wood);
  CHECK(defs[2].cost.inputs[0].count == 12);

  CHECK(defs[3].cost.inputs.size() == 2);
  CHECK(defs[3].cost.inputs[0].item == sitems::Wood);
  CHECK(defs[3].cost.inputs[0].count == 16);
  CHECK(defs[3].cost.inputs[1].item == sitems::Iron);
  CHECK(defs[3].cost.inputs[1].count == 4);

  // A DECK COSTS MORE THAN A WALL AND A DOOR COSTS MORE THAN A WALL, whatever
  // the digits are. Pinned as a RELATION as well as as values, because the
  // values will be rebalanced again and the ordering is the part that is a
  // design decision rather than a number.
  CHECK(defs[0].cost.inputs[0].count > defs[2].cost.inputs[0].count);
  CHECK(defs[3].cost.inputs[0].count > defs[2].cost.inputs[0].count);

  // GP-57's pad price, and the PROPERTY it is set by rather than the digits.
  // The pad is founded on 36 foundations (GP-58), so what makes its own bill
  // right is that it is a STEEL bill: its binding ingredient is smelted, which
  // no other structural part's is, and that is what ties the rocket programme
  // to the factory. Asserted as "the pad needs more iron than every other
  // structural part put together", which stays true through a rebalance and
  // which a pad priced in stone alone could not satisfy by accident.
  int ironElsewhere = 0;
  for (size_t k = 0; k + 1 < defs.size(); ++k) {
    for (const ItemStack& in : defs[k].cost.inputs) {
      if (in.item == sitems::Iron) ironElsewhere += in.count;
    }
  }
  int padIron = 0;
  int padStone = 0;
  for (const ItemStack& in : defs[4].cost.inputs) {
    if (in.item == sitems::Iron) padIron = in.count;
    if (in.item == sitems::Stone) padStone = in.count;
  }
  CHECK(padIron > ironElsewhere);
  CHECK(padIron == 60);
  // And its stone is LESS than the 36 foundations it stands on cost, because
  // the platform is already the stone and charging for it twice would put the
  // gate on the wrong ingredient. 36 * 40 = 1,440.
  CHECK(padStone == 120);
  CHECK(padStone < 36 * defs[0].cost.inputs[0].count);
}

// The four structural items land in the registry, buildable, and cross-linked to
// their entity TypeIds — and their ids collide with nothing already registered.
TEST(structure_items_register_and_do_not_collide) {
  SliceRegistry reg = makeSurvivalRegistry();

  const ItemDef* fnd = reg.item(sitems::Foundation);
  const ItemDef* flr = reg.item(sitems::Floor);
  const ItemDef* wal = reg.item(sitems::Wall);
  const ItemDef* dor = reg.item(sitems::Door);
  CHECK(fnd != nullptr);
  CHECK(flr != nullptr);
  CHECK(wal != nullptr);
  CHECK(dor != nullptr);

  CHECK(fnd->displayName == "Foundation");
  CHECK(flr->displayName == "Floor");
  CHECK(wal->displayName == "Wall");
  CHECK(dor->displayName == "Door");

  // GP-57. The pad is a registered, buildable item with its own entity, so the
  // browser's `of_gp_structure_info` row and the research tree's `unlockItems`
  // are naming a thing the registry actually holds. It stacks ONE and every
  // other structural part stacks 50, which is the one place the pad's size
  // shows up in /core at all.
  const ItemDef* pad = reg.item(sitems::LaunchPad);
  CHECK(pad != nullptr);
  CHECK(pad->displayName == "Launch pad");
  CHECK(pad->isBuildable());
  CHECK(pad->stackMax == 1);
  CHECK(pad->stackMax < fnd->stackMax);
  CHECK(reg.entityForItem(sitems::LaunchPad) == stypes::LaunchPad);

  // Placeables stack 50 and place their entity TypeId.
  CHECK(fnd->stackMax == 50);
  CHECK(dor->stackMax == 50);
  CHECK(fnd->isBuildable());
  CHECK(dor->isBuildable());
  CHECK(reg.entityForItem(sitems::Foundation) == stypes::Foundation);
  CHECK(reg.entityForItem(sitems::Floor) == stypes::Floor);
  CHECK(reg.entityForItem(sitems::Wall) == stypes::Wall);
  CHECK(reg.entityForItem(sitems::Door) == stypes::Door);

  // NO COLLISION: every registered item id is distinct, and the four structural
  // ids sit past every previously pinned id (survival tops out at 0x003C).
  const std::vector<ItemDef>& all = reg.allItems();
  for (size_t i = 0; i < all.size(); ++i)
    for (size_t j = i + 1; j < all.size(); ++j)
      CHECK(all[i].id != all[j].id);
  CHECK(sitems::Foundation > sitems::SurvivalSmelter);
  CHECK(sitems::Foundation == 0x0040);
  CHECK(sitems::Door == 0x0043);
  // ... and the entity TypeIds sit past the survival machine block (0x30/0x31).
  CHECK(stypes::Foundation > stypes::SurvivalSmelter);
}

// payInputs is the PLACEMENT payment: all-or-nothing, and it adds NO item (a
// structure is raised in the world, it is never crafted into the pack first).
TEST(structure_pay_inputs_is_all_or_nothing_and_adds_nothing) {
  SliceRegistry reg = makeSurvivalRegistry();
  const CraftRecipe foundation = structureDefs()[0].cost;

  // The cost is READ from the def rather than retyped, so a rebalance moves one
  // table and this test keeps testing all-or-nothing instead of arithmetic.
  const uint32_t stoneCost = foundation.inputs[0].count;

  // One stone short. Nothing is consumed, nothing is produced.
  Inventory poor(reg);
  poor.add(sitems::Stone, stoneCost - 1);
  CHECK(!HandCrafter::canCraft(foundation, poor));
  CHECK(!HandCrafter::payInputs(foundation, poor));
  CHECK(poor.count(sitems::Stone) == stoneCost - 1);
  CHECK(poor.count(sitems::Foundation) == 0);

  // Exactly the cost: pays exactly, and the pack is left with NO foundation.
  Inventory rich(reg);
  rich.add(sitems::Stone, stoneCost);
  CHECK(HandCrafter::canCraft(foundation, rich));
  CHECK(HandCrafter::payInputs(foundation, rich));
  CHECK(rich.count(sitems::Stone) == 0);
  CHECK(rich.count(sitems::Foundation) == 0);
  // A second placement is no longer affordable and still consumes nothing.
  CHECK(!HandCrafter::payInputs(foundation, rich));
  CHECK(rich.count(sitems::Stone) == 0);

  // craft() on the same recipe DOES yield the item — payInputs is the same rule
  // minus the output, not a different rule.
  Inventory both(reg);
  both.add(sitems::Stone, stoneCost);
  CHECK(HandCrafter::craft(foundation, both));
  CHECK(both.count(sitems::Foundation) == 1);

  // Multi-input all-or-nothing: a door needs wood AND iron.
  const CraftRecipe door = structureDefs()[3].cost;
  const uint32_t doorWood = door.inputs[0].count;
  const uint32_t doorIron = door.inputs[1].count;
  Inventory woodOnly(reg);
  woodOnly.add(sitems::Wood, doorWood + 4);
  CHECK(!HandCrafter::payInputs(door, woodOnly));
  CHECK(woodOnly.count(sitems::Wood) == doorWood + 4);
  woodOnly.add(sitems::Iron, doorIron);
  CHECK(HandCrafter::payInputs(door, woodOnly));
  CHECK(woodOnly.count(sitems::Wood) == 4);
  CHECK(woodOnly.count(sitems::Iron) == 0);
  CHECK(woodOnly.count(sitems::Door) == 0);
}

// The structural set did NOT leak into the hand-craft menu: the four original
// hand recipes (pickaxe, axe, furnace, smelter) plus the three electrification
// craftables appended after them. Structures are still placed from the build
// menu against their bill of materials, never crafted into a carried item.
TEST(structures_do_not_leak_into_hand_recipes) {
  const std::vector<CraftRecipe> hand = handRecipes();
  CHECK(hand.size() == 7);
  for (const CraftRecipe& r : hand) {
    CHECK(r.output != sitems::Foundation);
    CHECK(r.output != sitems::Floor);
    CHECK(r.output != sitems::Wall);
    CHECK(r.output != sitems::Door);
    // GP-57. The pad is placed against its bill, exactly like the other four,
    // and is emphatically not a thing you craft into your pack and carry.
    CHECK(r.output != sitems::LaunchPad);
  }
  CHECK(hand[0].output == sitems::CrudePickaxe);
  CHECK(hand[1].output == sitems::CrudeAxe);
  CHECK(hand[2].output == sitems::PrimitiveFurnace);
  CHECK(hand[3].output == sitems::SurvivalSmelter);
  CHECK(hand[4].output == sitems::PowerPole);
  CHECK(hand[5].output == sitems::BurnerGenerator);
  CHECK(hand[6].output == sitems::ElectricSmelter);
}
