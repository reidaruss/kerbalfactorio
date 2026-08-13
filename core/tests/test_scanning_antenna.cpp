// =============================================================================
// test_scanning_antenna.cpp — GP-533, THE SCANNING ANTENNA AS A REAL BUILDABLE.
//
// `story_line_outline_v1.txt` puts this immediately after the research station
// D-019 built: "Research scanning antenna. Build scanning antenna (upon
// building the scanning antenna it shows the location of nearby ruins)." The
// reveal itself (`of_poi_near` + `of_poi_mark_known`, WG-151, already-shipped
// ABI 24) is orchestrated entirely on the web side (Antennas.ts /
// GameplayActions.ts) and is not this file's claim; what /core owns is the
// SAME two-header shape D-019 pinned — a `StructureDef` row in gameplay.h and
// a `TechDef` row in research.h — and this file is that claim, following
// test_research_station.cpp's own six-part shape.
//
//   1. THE ROW EXISTS AND IS APPENDED (the 7th structural row), not inserted.
//   2. THE IDS ARE THE NEXT FREE ONES in the structural blocks.
//   3. THE PRICE IS PAID ALL-OR-NOTHING, with the refusing control.
//   4. THE PRICE SITS BETWEEN THE STATION AND THE PAD, as a property: more
//      iron than the station and less than the pad, and AS MUCH copper as the
//      pad asks for, which is the judgement GP-533's price comment defends.
//   5. IT IS NOT IN THE CRAFT MENU (paid and placed, never crafted, §S.6).
//   6. IT IS RESEARCH-GATED BY ITS OWN TECH — the opposite pole from D-019's
//      station, which is deliberately un-gated because it is the key to the
//      screen that gates everything else. The antenna has no such role, so it
//      is an ordinary gated item, and this asserts it is gated by name.
//   7. THE TECH ITSELF HAS NO PREREQ AND NO MILESTONE, because the ruins it
//      reveals are what unlocks Electrification research in the story line —
//      gating the antenna ON Electrification would be the same cycle GP-267
//      already refused for the launch pad and the autopilot.
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

SliceRegistry makeSurvivalRegistry() {
  SliceRegistry reg;
  surv::RegisterSurvivalContent(reg);
  RegisterScienceItems(reg);
  progression::RegisterArmour(reg);
  return reg;
}

const StructureDef* antennaDef() {
  static const std::vector<StructureDef> defs = structureDefs();
  for (const StructureDef& d : defs) {
    if (d.kind == StructureKind::ScanningAntenna) return &d;
  }
  return nullptr;
}

const StructureDef* stationDef() {
  static const std::vector<StructureDef> defs = structureDefs();
  for (const StructureDef& d : defs) {
    if (d.kind == StructureKind::ResearchStation) return &d;
  }
  return nullptr;
}

const StructureDef* padDef() {
  static const std::vector<StructureDef> defs = structureDefs();
  for (const StructureDef& d : defs) {
    if (d.kind == StructureKind::LaunchPad) return &d;
  }
  return nullptr;
}

int ironOf(const StructureDef* d) {
  if (d == nullptr) return -1;
  for (const gameplay::ItemStack& in : d->cost.inputs) {
    if (in.item == sitems::Iron) return static_cast<int>(in.count);
  }
  return 0;
}

int copperOf(const StructureDef* d) {
  if (d == nullptr) return -1;
  for (const gameplay::ItemStack& in : d->cost.inputs) {
    if (in.item == sitems::Copper) return static_cast<int>(in.count);
  }
  return 0;
}

}  // namespace

// -----------------------------------------------------------------------------
// 1. The row exists, and it is an APPEND.
// -----------------------------------------------------------------------------
TEST(scanning_antenna_is_appended_to_the_structural_set) {
  const std::vector<StructureDef> defs = structureDefs();
  CHECK(defs.size() == 7);
  CHECK(defs[5].kind == StructureKind::ResearchStation);
  CHECK(defs[6].kind == StructureKind::ScanningAntenna);

  const StructureDef* an = antennaDef();
  CHECK(an != nullptr);
  CHECK(an->name != nullptr);
  CHECK(std::string(an->name) == "Scanning antenna");
  CHECK(an->cost.output == an->item);
  CHECK(an->cost.outputCount == 1);
  CHECK(!an->cost.inputs.empty());
}

// -----------------------------------------------------------------------------
// 2. The ids are the next free ones, and they collide with nothing.
// -----------------------------------------------------------------------------
TEST(scanning_antenna_ids_continue_the_structural_blocks) {
  const StructureDef* an = antennaDef();
  CHECK(an != nullptr);
  CHECK(an->item == sitems::ScanningAntenna);
  CHECK(an->item == 0x0046);
  CHECK(an->typeId == stypes::ScanningAntenna);
  CHECK(an->typeId == 0x46);
  CHECK(an->item == sitems::ResearchStation + 1);
  CHECK(an->typeId == stypes::ResearchStation + 1);
  CHECK(an->item < 0x0050);   // GP-31's vessel-part block, still untouched.

  SliceRegistry reg = makeSurvivalRegistry();
  const ItemDef* it = reg.item(sitems::ScanningAntenna);
  CHECK(it != nullptr);
  CHECK(it->displayName == "Scanning antenna");
  CHECK(it->isBuildable());
  CHECK(reg.entityForItem(sitems::ScanningAntenna) == stypes::ScanningAntenna);
  const std::vector<ItemDef>& all = reg.allItems();
  for (size_t i = 0; i < all.size(); ++i) {
    for (size_t j = i + 1; j < all.size(); ++j) CHECK(all[i].id != all[j].id);
  }
}

// -----------------------------------------------------------------------------
// 3. All-or-nothing, WITH THE REFUSING CONTROL.
// -----------------------------------------------------------------------------
TEST(scanning_antenna_cost_is_paid_all_or_nothing) {
  SliceRegistry reg = makeSurvivalRegistry();
  const StructureDef* an = antennaDef();
  CHECK(an != nullptr);
  const CraftRecipe cost = an->cost;

  Inventory poor(reg);
  for (size_t k = 0; k < cost.inputs.size(); ++k) {
    const gameplay::ItemStack& in = cost.inputs[k];
    poor.add(in.item, k == 0 ? in.count - 1 : in.count);
  }
  CHECK(!HandCrafter::canCraft(cost, poor));
  CHECK(!HandCrafter::payInputs(cost, poor));
  for (size_t k = 0; k < cost.inputs.size(); ++k) {
    const gameplay::ItemStack& in = cost.inputs[k];
    CHECK(poor.count(in.item) == (k == 0 ? in.count - 1 : in.count));
  }
  CHECK(poor.count(sitems::ScanningAntenna) == 0);

  Inventory rich(reg);
  for (const gameplay::ItemStack& in : cost.inputs) rich.add(in.item, in.count);
  CHECK(HandCrafter::canCraft(cost, rich));
  CHECK(HandCrafter::payInputs(cost, rich));
  for (const gameplay::ItemStack& in : cost.inputs) CHECK(rich.count(in.item) == 0);
  CHECK(rich.count(sitems::ScanningAntenna) == 0);
  CHECK(!HandCrafter::payInputs(cost, rich));
}

// -----------------------------------------------------------------------------
// 4. THE PRICE SITS BETWEEN THE STATION AND THE PAD, as a property.
// -----------------------------------------------------------------------------
TEST(scanning_antenna_price_sits_between_the_station_and_the_pad) {
  const StructureDef* an = antennaDef();
  const StructureDef* st = stationDef();
  const StructureDef* pad = padDef();
  CHECK(an != nullptr);
  CHECK(st != nullptr);
  CHECK(pad != nullptr);

  const int anIron = ironOf(an);
  const int stIron = ironOf(st);
  const int padIron = ironOf(pad);
  CHECK(anIron > 0);
  CHECK(anIron > stIron);
  CHECK(anIron < padIron);

  // THE JUDGEMENT: the antenna's own copper matches the PAD's exactly, which
  // is what makes it the first structure in the game that asks for as much
  // copper as the pad does.
  const int anCopper = copperOf(an);
  const int padCopper = copperOf(pad);
  CHECK(anCopper > 0);
  CHECK(anCopper == padCopper);
  CHECK(anCopper > copperOf(st));

  // NO WOOD, for the station's own reason (an airless body has none).
  int wood = 0;
  for (const gameplay::ItemStack& in : an->cost.inputs) {
    if (in.item == sitems::Wood) wood = static_cast<int>(in.count);
  }
  CHECK(wood == 0);
}

// -----------------------------------------------------------------------------
// 5. It is not in the craft menu.
// -----------------------------------------------------------------------------
TEST(scanning_antenna_is_never_a_hand_recipe) {
  for (const CraftRecipe& r : handRecipes()) {
    CHECK(r.output != sitems::ScanningAntenna);
  }
}

// -----------------------------------------------------------------------------
// 6. IT IS RESEARCH-GATED, by its own named tech — the opposite pole from the
//    station, which is deliberately never gated (test_research_station.cpp's
//    own check 6).
// -----------------------------------------------------------------------------
TEST(scanning_antenna_is_gated_by_its_own_tech) {
  const TechTree tree = survivalTechTree();
  CHECK(tree.gatesItem(sitems::ScanningAntenna));
  CHECK(tree.gatesEntity(stypes::ScanningAntenna));
  // The control: the RESEARCH STATION stays ungated (D-019's own deadlock
  // check), so an empty or wrongly-shaped tree would fail here too.
  CHECK(!tree.gatesItem(sitems::ResearchStation));

  const TechDef* t = tree.tech(techs::ScanningAntenna);
  CHECK(t != nullptr);
  CHECK(t->name == "Scanning Antenna");
}

// -----------------------------------------------------------------------------
// 7. THE TECH HAS NO PREREQ AND NO MILESTONE (the electricity-cycle argument).
// -----------------------------------------------------------------------------
TEST(scanning_antenna_tech_has_no_prereq_and_no_milestone) {
  const std::vector<TechDef> techList = survivalTechs();
  const TechDef* t = nullptr;
  const TechDef* elec = nullptr;
  for (const TechDef& d : techList) {
    if (d.id == techs::ScanningAntenna) t = &d;
    if (d.id == techs::Electrification) elec = &d;
  }
  CHECK(t != nullptr);
  CHECK(elec != nullptr);
  CHECK(t->prereqs.empty());
  CHECK(t->requiresMilestone == kNoMilestone);

  // COSTS AUTOMATION SCIENCE ONLY, and nothing else — no LogisticScience, no
  // CinderScience — which is what "reachable as the first purchase off a
  // freshly-built station" means as a bill rather than as a claim: this is the
  // one science a fresh AutomationScience batch already produces.
  CHECK(t->cost.size() == 1);
  CHECK(t->cost[0].item == items::AutomationScience);
  CHECK(t->cost[0].count > 0);

  // CHEAPER THAN ELECTRIFICATION, the tech `story_line_outline_v1.txt` puts
  // right after it: the antenna is the rung BEFORE electricity is even
  // unlocked, so it must not cost more of the one science that exists yet.
  int elecAutomationScience = 0;
  for (const gameplay::ItemStack& c : elec->cost) {
    if (c.item == items::AutomationScience) elecAutomationScience = static_cast<int>(c.count);
  }
  const int antennaAutomationScience = static_cast<int>(t->cost[0].count);
  CHECK(elecAutomationScience > 0);
  CHECK(antennaAutomationScience <= elecAutomationScience);
}
