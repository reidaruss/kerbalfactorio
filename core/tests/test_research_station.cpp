// =============================================================================
// test_research_station.cpp — D-019, THE RESEARCH STATION AS A REAL BUILDABLE.
//
// Reid confirmed D-019 on 2026-08-11: the research station stops being a
// free-floating J-key panel and becomes a machine you build. `story_line_outline_v1.txt`
// puts building it AFTER belts and smelting and BEFORE the scanning antenna, so
// the whole of /core's share of that is one `StructureDef` row: an item, an
// entity TypeId and a bill of materials that a player who has run a furnace can
// pay and a player who has only swung an axe cannot.
//
// WHAT THIS FILE ASSERTS, and each one with a control that can fail:
//
//   1. THE ROW EXISTS AND IS APPENDED, not inserted. Every pre-existing kind is
//      still at its own index with its own pinned ids, which is what makes the
//      claim "no ABI change" true: `of_gp_structure_info(i)` is an indexed read
//      and a renumbering here would silently repoint the browser's build menu.
//   2. THE IDS ARE THE NEXT FREE ONES IN THE STRUCTURAL BLOCKS and collide with
//      nothing. Bounded rather than merely spelled, because a digit cannot say
//      why it is that digit.
//   3. THE PRICE IS PAYABLE ALL-OR-NOTHING, with the REFUSING CONTROL that is
//      the point of the assertion: one ingot short pays NOTHING, and the pack
//      is byte-for-byte what it was.
//   4. THE PRICE IS POST-SMELTING, as a PROPERTY rather than as three digits: it
//      needs both smelted metals, so a pack of raw ore and timber cannot buy it
//      however much of them there is. That is the storyline slot expressed as a
//      bill of materials, and it is the assertion that would fail if somebody
//      re-priced the station in wood and stone.
//   5. IT IS NOT IN THE CRAFT MENU. A structure is paid for and placed, never
//      crafted into a carried item (§S.6), and `handRecipes()` is where that
//      rule is visible.
//   6. IT IS NOT RESEARCH-GATED, and this one is a DEADLOCK CHECK rather than a
//      style point: the station is what unlocks the research screen, so a tech
//      that unlocked the station would be a lock whose key is behind itself.
// =============================================================================
#include <string>
#include <vector>

#include "test_framework.h"
#include "of/gameplay.h"
#include "of/progression.h"
#include "of/research.h"

using namespace of;
using namespace of::gameplay;
namespace surv = of::gameplay::survival;

using surv::CraftRecipe;
using surv::HandCrafter;
using surv::StructureDef;
using surv::StructureKind;
using surv::handRecipes;
using surv::structureDefs;

namespace sitems = of::gameplay::survival::items;
namespace stypes = of::gameplay::survival::types;

namespace {

// The registry the CLIENT builds, in the order `of_gp_init` registers them, so
// the collision assertion below is made against the real id space rather than
// against the survival block in isolation.
SliceRegistry makeSurvivalRegistry() {
  SliceRegistry reg;
  surv::RegisterSurvivalContent(reg);
  RegisterScienceItems(reg);
  progression::RegisterArmour(reg);
  return reg;
}

const StructureDef* stationDef() {
  static const std::vector<StructureDef> defs = structureDefs();
  for (const StructureDef& d : defs) {
    if (d.kind == StructureKind::ResearchStation) return &d;
  }
  return nullptr;
}

}  // namespace

// -----------------------------------------------------------------------------
// 1. The row exists, and it is an APPEND.
// -----------------------------------------------------------------------------
TEST(research_station_is_appended_to_the_structural_set) {
  const std::vector<StructureDef> defs = structureDefs();
  // GP-533 appended a SEVENTH row (the scanning antenna) after this file was
  // written; bumped here rather than left to rot, because "6" silently
  // passing over an inserted row is exactly the ABI-change-with-no-compile-
  // error hazard the comment below is naming. See test_scanning_antenna.cpp
  // for that row's own assertions.
  CHECK(defs.size() == 7);

  // NOTHING MOVED. This is the whole of the "no ABI change" claim: the browser
  // reads these by index through `of_gp_structure_info`, so an insert rather
  // than an append would repoint every existing build-menu tile at the wrong
  // price with no compile error anywhere.
  CHECK(defs[0].kind == StructureKind::Foundation);
  CHECK(defs[1].kind == StructureKind::Floor);
  CHECK(defs[2].kind == StructureKind::Wall);
  CHECK(defs[3].kind == StructureKind::Door);
  CHECK(defs[4].kind == StructureKind::LaunchPad);
  CHECK(defs[5].kind == StructureKind::ResearchStation);
  CHECK(defs[6].kind == StructureKind::ScanningAntenna);
  CHECK(defs[4].item == sitems::LaunchPad);
  CHECK(defs[4].typeId == stypes::LaunchPad);

  const StructureDef* st = stationDef();
  CHECK(st != nullptr);
  CHECK(st->name != nullptr);
  CHECK(std::string(st->name) == "Research station");
  // The cost is a CraftRecipe whose output is the station's own item, which is
  // what keeps one id space rather than two.
  CHECK(st->cost.output == st->item);
  CHECK(st->cost.outputCount == 1);
  CHECK(!st->cost.inputs.empty());
}

// -----------------------------------------------------------------------------
// 2. The ids are the next free ones, and they collide with nothing.
// -----------------------------------------------------------------------------
TEST(research_station_ids_continue_the_structural_blocks) {
  const StructureDef* st = stationDef();
  CHECK(st != nullptr);
  CHECK(st->item == sitems::ResearchStation);
  CHECK(st->item == 0x0045);
  CHECK(st->typeId == stypes::ResearchStation);
  CHECK(st->typeId == 0x45);

  // NEXT, and INSIDE. The pad's own comment reserved 0x0045..0x004F for the
  // next structural part and warned off 0x0050, which GP-31 spent on the vessel
  // part items. Both bounds are asserted rather than the digit alone.
  CHECK(st->item == sitems::LaunchPad + 1);
  CHECK(st->item < 0x0050);
  CHECK(st->typeId == stypes::LaunchPad + 1);

  // And it really is in the registry, buildable and cross-linked to its entity,
  // with no id registered twice anywhere in the slice.
  SliceRegistry reg = makeSurvivalRegistry();
  const ItemDef* it = reg.item(sitems::ResearchStation);
  CHECK(it != nullptr);
  CHECK(it->displayName == "Research station");
  CHECK(it->isBuildable());
  CHECK(reg.entityForItem(sitems::ResearchStation) == stypes::ResearchStation);
  const std::vector<ItemDef>& all = reg.allItems();
  for (size_t i = 0; i < all.size(); ++i) {
    for (size_t j = i + 1; j < all.size(); ++j) CHECK(all[i].id != all[j].id);
  }
}

// -----------------------------------------------------------------------------
// 3. All-or-nothing, WITH THE REFUSING CONTROL.
// -----------------------------------------------------------------------------
TEST(research_station_cost_is_paid_all_or_nothing) {
  SliceRegistry reg = makeSurvivalRegistry();
  const StructureDef* st = stationDef();
  CHECK(st != nullptr);
  const CraftRecipe cost = st->cost;

  // ONE SHORT OF THE FIRST INGREDIENT. Read off the def rather than retyped, so
  // a rebalance moves one table and this keeps testing the RULE.
  Inventory poor(reg);
  for (size_t k = 0; k < cost.inputs.size(); ++k) {
    const gameplay::ItemStack& in = cost.inputs[k];
    poor.add(in.item, k == 0 ? in.count - 1 : in.count);
  }
  CHECK(!HandCrafter::canCraft(cost, poor));
  CHECK(!HandCrafter::payInputs(cost, poor));
  // NOTHING WAS TAKEN. The refusal that matters is the one that leaves the pack
  // alone: a partial spend would leave a player poorer with no station.
  for (size_t k = 0; k < cost.inputs.size(); ++k) {
    const gameplay::ItemStack& in = cost.inputs[k];
    CHECK(poor.count(in.item) == (k == 0 ? in.count - 1 : in.count));
  }
  CHECK(poor.count(sitems::ResearchStation) == 0);

  // EXACTLY ENOUGH. Every input goes, and NO item is added: a structure is
  // raised in the world, never crafted into the pack (§S.6).
  Inventory rich(reg);
  for (const gameplay::ItemStack& in : cost.inputs) rich.add(in.item, in.count);
  CHECK(HandCrafter::canCraft(cost, rich));
  CHECK(HandCrafter::payInputs(cost, rich));
  for (const gameplay::ItemStack& in : cost.inputs) CHECK(rich.count(in.item) == 0);
  CHECK(rich.count(sitems::ResearchStation) == 0);
  // And a second one cannot be paid for out of an emptied pack.
  CHECK(!HandCrafter::payInputs(cost, rich));
}

// -----------------------------------------------------------------------------
// 4. The price is POST-SMELTING, as a property.
// -----------------------------------------------------------------------------
TEST(research_station_price_sits_after_smelting_in_the_storyline) {
  SliceRegistry reg = makeSurvivalRegistry();
  const StructureDef* st = stationDef();
  CHECK(st != nullptr);

  int iron = 0;
  int copper = 0;
  int stone = 0;
  int wood = 0;
  for (const gameplay::ItemStack& in : st->cost.inputs) {
    if (in.item == sitems::Iron) iron = static_cast<int>(in.count);
    if (in.item == sitems::Copper) copper = static_cast<int>(in.count);
    if (in.item == sitems::Stone) stone = static_cast<int>(in.count);
    if (in.item == sitems::Wood) wood = static_cast<int>(in.count);
  }

  // BOTH SMELTED METALS. That is what "after smelting" means as a bill rather
  // than as a lock, and it is the first thing in the game that makes the copper
  // patch on the player's map worth digging for a non-power reason.
  CHECK(iron > 0);
  CHECK(copper > 0);
  CHECK(stone > 0);

  // NO WOOD, and this is the judgement worth pinning. `StarterContent`'s own
  // invariant refuses to place a tree on an airless body, which is why the
  // checklist has a `moot` clause for "Harvest a tree" on Cinder. A wood cost
  // here would not make a checklist row moot, it would make the research screen
  // itself unreachable on a whole class of body.
  CHECK(wood == 0);

  // A PACK OF RAW ORE AND TIMBER CANNOT BUY IT, however much of it there is.
  // The refusing control for the claim above: a station priced in raw materials
  // would pass every assertion so far and fail this one.
  Inventory unsmelted(reg);
  unsmelted.add(sitems::RawIron, 100);
  unsmelted.add(sitems::RawCopper, 100);
  unsmelted.add(sitems::Wood, 100);
  unsmelted.add(sitems::Stone, 100);
  CHECK(!HandCrafter::canCraft(st->cost, unsmelted));

  // AND IT IS CHEAPER THAN THE LAUNCH PAD IN IRON, which is the ORDER the
  // storyline asks for stated as a relation rather than as digits: the station
  // is a rung on the way to the pad, so it cannot cost more of the binding
  // ingredient than the thing it comes before.
  int padIron = 0;
  for (const StructureDef& d : structureDefs()) {
    if (d.kind != StructureKind::LaunchPad) continue;
    for (const gameplay::ItemStack& in : d.cost.inputs) {
      if (in.item == sitems::Iron) padIron = static_cast<int>(in.count);
    }
  }
  CHECK(padIron > 0);
  CHECK(iron < padIron);
}

// -----------------------------------------------------------------------------
// 5. It is not in the craft menu.
// -----------------------------------------------------------------------------
TEST(research_station_is_never_a_hand_recipe) {
  for (const CraftRecipe& r : handRecipes()) {
    CHECK(r.output != sitems::ResearchStation);
  }
  // The control: the hand furnace IS in there, so this is not a test of an
  // empty list.
  bool sawFurnace = false;
  for (const CraftRecipe& r : handRecipes()) {
    if (r.output == sitems::PrimitiveFurnace) sawFurnace = true;
  }
  CHECK(sawFurnace);
}

// -----------------------------------------------------------------------------
// 6. It is NOT research-gated. The deadlock check.
// -----------------------------------------------------------------------------
TEST(research_station_is_not_gated_by_the_tech_tree) {
  const std::vector<TechDef> techs = survivalTechs();
  CHECK(!techs.empty());
  for (const TechDef& t : techs) {
    for (ItemId it : t.unlockItems) CHECK(it != sitems::ResearchStation);
    for (TypeId ty : t.unlockEntities) CHECK(ty != stypes::ResearchStation);
  }
  // The control: the LAUNCH PAD is gated by exactly this mechanism, so an empty
  // or wrongly-shaped tree would fail here rather than pass the check above.
  bool padGated = false;
  for (const TechDef& t : techs) {
    for (ItemId it : t.unlockItems) {
      if (it == sitems::LaunchPad) padGated = true;
    }
  }
  CHECK(padGated);
}
