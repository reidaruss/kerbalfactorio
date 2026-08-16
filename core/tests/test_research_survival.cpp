// =============================================================================
// test_research_survival.cpp — research.h §D, THE SURVIVAL TECH TREE: the one
// the playable web client actually gates on.
//
// A separate translation unit on the same `research_tests` target rather than
// more of test_research.cpp, for the same reason progression.h is a separate
// header: several lanes edit these files in one night and a fourth simultaneous
// editor of one file is how commits start sweeping each other.
//
// EVERY TEST HERE CARRIES ITS NEGATIVE CONTROL, because standing rule 11 is
// about exactly this shape of test. "The thing became available after research"
// is also true of a gate that always says yes, so each one first proves the
// REFUSAL, then flips ONE input, then proves the refusal is gone, and where the
// property allows it, proves that the neighbouring thing did NOT open too.
// =============================================================================
#include <cstdio>
#include <vector>

#include "test_framework.h"
#include "of/gameplay.h"
#include "of/progression.h"
#include "of/research.h"

using namespace of;
using namespace of::gameplay;

// The registry the CLIENT builds: survival content, the science items and the
// armour, in the order of_gp_init registers them.
static SliceRegistry makeSurvivalReg() {
  SliceRegistry reg;
  survival::RegisterSurvivalContent(reg);
  RegisterScienceItems(reg);
  progression::RegisterArmour(reg);
  return reg;
}

// -----------------------------------------------------------------------------
// D1. THE GATE, WITH ITS NEGATIVE CONTROL: the power pole is refused, becomes
//     affordable, unlocks, and the item it gates becomes available. The control
//     is the SAME query on the SAME item before the research, plus a second
//     control on an item the tree never mentions.
// -----------------------------------------------------------------------------
TEST(survival_electrification_gates_the_pole_and_the_generator) {
  SliceRegistry reg = makeSurvivalReg();
  TechTree tree = survivalTechTree();
  ResearchState rs(tree);
  Inventory science(reg, 20);
  // L7 (GP-546 to GP-549): Electrification now ALSO requires
  // `milestones::RuinInvestigated`. Granted up front so this test can stay
  // about the COST gate in isolation; the milestone gate on this same tech
  // has its own dedicated test below (D8), on D3's pattern.
  CHECK(rs.setMilestone(milestones::RuinInvestigated));

  // THE REFUSAL FIRST. Nothing researched: the pole and the generator are
  // gated by the tree, so they are NOT available.
  CHECK(tree.gatesItem(survival::items::PowerPole));
  CHECK(tree.gatesItem(survival::items::BurnerGenerator));
  CHECK(!rs.isItemAvailable(survival::items::PowerPole));
  CHECK(!rs.isItemAvailable(survival::items::BurnerGenerator));
  CHECK(!rs.isEntityAvailable(survival::types::PowerPole));
  CHECK(!rs.isEntityAvailable(survival::types::BurnerGenerator));

  // THE CONTROL THAT MAKES THAT MEAN SOMETHING: wood is in no tech, so it is
  // available with nothing researched at all. Without this, a build in which
  // isItemAvailable simply returned false would pass every assertion above.
  CHECK(!tree.gatesItem(survival::items::Wood));
  CHECK(rs.isItemAvailable(survival::items::Wood));
  CHECK(rs.isItemAvailable(survival::items::CrudePickaxe));
  CHECK(rs.isItemAvailable(survival::items::SurvivalSmelter));
  CHECK(rs.isEntityAvailable(survival::types::SurvivalSmelter));
  CHECK(rs.isEntityAvailable(survival::types::PrimitiveFurnace));

  // Broke: cannot research, and the refusal names the SCIENCE, not a prereq.
  CHECK(!rs.canResearch(techs::Electrification, science));
  ResearchStatus s0 = rs.status(techs::Electrification, science);
  CHECK(s0.block == ResearchBlock::CostShort);
  CHECK(s0.item == items::AutomationScience);
  CHECK(s0.shortBy == 10);
  CHECK(!s0.ok());

  // Nine packs is still one short, and the refusal SAYS one.
  CHECK(science.add(items::AutomationScience, 9) == 0);
  CHECK(!rs.canResearch(techs::Electrification, science));
  CHECK(rs.status(techs::Electrification, science).shortBy == 1);
  CHECK(!rs.isItemAvailable(survival::items::PowerPole));

  // The tenth pack flips it, and NOTHING ELSE changed in between.
  CHECK(science.add(items::AutomationScience, 1) == 0);
  CHECK(rs.canResearch(techs::Electrification, science));
  CHECK(rs.status(techs::Electrification, science).ok());
  CHECK(rs.tryResearch(techs::Electrification, science));

  // The science is SPENT, exactly and entirely, and the gated things opened.
  CHECK(science.count(items::AutomationScience) == 0);
  CHECK(rs.isUnlocked(techs::Electrification));
  CHECK(rs.isItemAvailable(survival::items::PowerPole));
  CHECK(rs.isItemAvailable(survival::items::BurnerGenerator));
  CHECK(rs.isEntityAvailable(survival::types::PowerPole));
  CHECK(rs.isEntityAvailable(survival::types::BurnerGenerator));
  CHECK(rs.isItemUnlocked(survival::items::PowerPole));

  // And the thing one rung further up did NOT open with it.
  CHECK(!rs.isItemAvailable(survival::items::ElectricSmelter));
  CHECK(rs.status(techs::ElectricSmelting, science).block == ResearchBlock::CostShort);
}

// -----------------------------------------------------------------------------
// D2. THE PREREQ IS A DIFFERENT REFUSAL FROM THE COST, and status() says which.
//     A boolean cannot tell them apart, which is exactly how a gate that
//     refuses for the wrong reason passes its own test.
// -----------------------------------------------------------------------------
TEST(survival_status_distinguishes_prereq_from_cost) {
  SliceRegistry reg = makeSurvivalReg();
  TechTree tree = survivalTechTree();
  ResearchState rs(tree);
  Inventory science(reg, 20);
  // Rich enough for ElectricSmelting's whole cost (15 auto + 10 logistic).
  CHECK(science.add(items::AutomationScience, 100) == 0);
  CHECK(science.add(items::LogisticScience, 100) == 0);
  // L7 (GP-546 to GP-549): Electrification's own milestone gate is not this
  // test's subject (D8 below owns it), so it is granted up front.
  CHECK(rs.setMilestone(milestones::RuinInvestigated));

  // Affordable, and STILL refused, because Electrification is not in.
  CHECK(rs.costAffordable(techs::ElectricSmelting, science));
  CHECK(!rs.canResearch(techs::ElectricSmelting, science));
  ResearchStatus s = rs.status(techs::ElectricSmelting, science);
  CHECK(s.block == ResearchBlock::PrereqMissing);
  CHECK(s.prereq == techs::Electrification);
  CHECK(s.item == kNoItem);        // the cost is NOT blamed
  CHECK(s.shortBy == 0);

  // Refused in DEED as well as in report: the science is untouched afterwards,
  // which is what catches a status() that is right while tryResearch is wrong.
  const uint32_t before = science.count(items::AutomationScience);
  CHECK(!rs.tryResearch(techs::ElectricSmelting, science));
  CHECK(science.count(items::AutomationScience) == before);

  // Take the prereq and the SAME query flips, with no science added.
  CHECK(rs.tryResearch(techs::Electrification, science));
  CHECK(science.count(items::AutomationScience) == before - 10);
  CHECK(rs.status(techs::ElectricSmelting, science).ok());
  CHECK(rs.tryResearch(techs::ElectricSmelting, science));
  CHECK(rs.isItemAvailable(survival::items::ElectricSmelter));

  // Researching it twice is a no-op that spends nothing (idempotent, GP-1).
  const uint32_t after = science.count(items::AutomationScience);
  CHECK(!rs.tryResearch(techs::ElectricSmelting, science));
  CHECK(science.count(items::AutomationScience) == after);
  CHECK(rs.status(techs::ElectricSmelting, science).block
        == ResearchBlock::AlreadyUnlocked);
}

// -----------------------------------------------------------------------------
// D3. DW-29's MILESTONE: the autopilot is EARNED and then bought. Science alone
//     never buys it, and the refusal names the deed rather than the cost.
//
//     GP-965: THE DEED IS BOARDING THE STATION. It was `ReachedOrbit` until the
//     tech and Reid's task-39 ordering ruling were reconciled; `ReachedOrbit` is
//     now this test's negative control, which is the strongest place for it,
//     because reaching orbit is a rung the player passes ON THE WAY to the
//     station and an autopilot that opened there would be available for the
//     hand-flown mission it exists to sit behind.
// -----------------------------------------------------------------------------
TEST(survival_autopilot_needs_the_station_boarded_by_hand) {
  SliceRegistry reg = makeSurvivalReg();
  TechTree tree = survivalTechTree();
  ResearchState rs(tree);
  Inventory science(reg, 20);
  CHECK(science.add(items::AutomationScience, 200) == 0);
  CHECK(science.add(items::LogisticScience, 200) == 0);
  // L7 (GP-546 to GP-549): Electrification's own milestone gate is D8's
  // subject, granted here only so THIS test can reach FlightAutopilot's
  // prereq the way it always did.
  CHECK(rs.setMilestone(milestones::RuinInvestigated));
  CHECK(rs.tryResearch(techs::Electrification, science));

  // Everything BUT the deed. Prereq in, cost on the shelf, still refused.
  CHECK(rs.prereqsMet(techs::FlightAutopilot));
  CHECK(rs.costAffordable(techs::FlightAutopilot, science));
  CHECK(!rs.canResearch(techs::FlightAutopilot, science));
  ResearchStatus s = rs.status(techs::FlightAutopilot, science);
  CHECK(s.block == ResearchBlock::MilestoneMissing);
  CHECK(s.milestone == milestones::StationBoarded);
  CHECK(!rs.milestoneMet(techs::FlightAutopilot));
  CHECK(!rs.hasMilestone(milestones::StationBoarded));

  const uint32_t before = science.count(items::AutomationScience);
  CHECK(!rs.tryResearch(techs::FlightAutopilot, science));
  CHECK(science.count(items::AutomationScience) == before);

  // The WRONG milestone does not open it either.
  CHECK(rs.setMilestone(milestones::LandedOffWorld));
  CHECK(!rs.canResearch(techs::FlightAutopilot, science));
  CHECK(rs.status(techs::FlightAutopilot, science).block
        == ResearchBlock::MilestoneMissing);

  // GP-965's OWN NEGATIVE CONTROL, and the one that encodes the ruling:
  // REACHING ORBIT IS NOT ENOUGH. This is the state a player is in when they
  // have flown to orbit and are on their way to Anchorage, which is precisely
  // the mission task 39 says must be hand flown, so the autopilot must still be
  // shut here.
  CHECK(rs.setMilestone(milestones::ReachedOrbit));
  CHECK(rs.hasMilestone(milestones::ReachedOrbit));
  CHECK(!rs.canResearch(techs::FlightAutopilot, science));
  CHECK(rs.status(techs::FlightAutopilot, science).block
        == ResearchBlock::MilestoneMissing);
  CHECK(rs.status(techs::FlightAutopilot, science).milestone
        == milestones::StationBoarded);

  // The right one does, and it is monotonic and dedup-safe.
  CHECK(rs.setMilestone(milestones::StationBoarded));
  CHECK(!rs.setMilestone(milestones::StationBoarded));   // already earned
  // 4, not 3: RuinInvestigated (granted above for Electrification), then
  // LandedOffWorld, then ReachedOrbit, then StationBoarded.
  CHECK(rs.milestones().size() == 4);
  CHECK(rs.canResearch(techs::FlightAutopilot, science));
  CHECK(rs.tryResearch(techs::FlightAutopilot, science));
  CHECK(rs.isUnlocked(techs::FlightAutopilot));
  CHECK(science.count(items::AutomationScience) == before - 25);

  // kNoMilestone means "no requirement", so every tech that names none of
  // the three earned milestones is unaffected. Electrification is
  // DELIBERATELY not used here any more (L7 gated it on RuinInvestigated,
  // which this test granted above, so it would no longer be a control) --
  // LaunchFacilities is the genuinely milestone-free tech instead.
  CHECK(rs.hasMilestone(kNoMilestone));
  CHECK(rs.milestoneMet(techs::LaunchFacilities));
  CHECK(rs.milestoneMet(techs::Metallurgy));
}

// -----------------------------------------------------------------------------
// D4. GP-2, THE OFF-WORLD GATE, over survival content: Cinderite Refining can
//     be reached in every way BUT one, and that one cannot be made on Forge.
// -----------------------------------------------------------------------------
TEST(survival_cinder_refining_cannot_be_bought_on_this_planet) {
  SliceRegistry reg = makeSurvivalReg();
  TechTree tree = survivalTechTree();
  ResearchState rs(tree);
  Inventory science(reg, 20);
  CHECK(science.add(items::AutomationScience, 500) == 0);
  CHECK(science.add(items::LogisticScience, 500) == 0);
  // L7 (GP-546 to GP-549): needed to reach Electrification at all now.
  CHECK(rs.setMilestone(milestones::RuinInvestigated));
  CHECK(rs.tryResearch(techs::Electrification, science));
  CHECK(rs.tryResearch(techs::ElectricSmelting, science));

  // Prereq in, no milestone asked for, unlimited LOCAL science: still refused.
  CHECK(rs.prereqsMet(techs::CinderRefining));
  CHECK(rs.milestoneMet(techs::CinderRefining));
  ResearchStatus s = rs.status(techs::CinderRefining, science);
  CHECK(s.block == ResearchBlock::CostShort);
  CHECK(s.item == items::CinderScience);      // the OFF-WORLD item, by name
  CHECK(s.shortBy == 5);

  // And NO hand recipe on this planet makes that item. This is the assertion
  // that makes the gate a GATE rather than a price: every recipe the client
  // offers is enumerated here, and none of them outputs Cinder science, so no
  // amount of play on Forge closes the shortfall.
  const std::vector<survival::CraftRecipe> sci = scienceHandRecipes();
  CHECK(sci.size() == 2);
  bool anyLocalRecipeMakesIt = false;
  for (const survival::CraftRecipe& r : sci)
    if (r.output == items::CinderScience) anyLocalRecipeMakesIt = true;
  for (const survival::CraftRecipe& r : survival::handRecipes())
    if (r.output == items::CinderScience) anyLocalRecipeMakesIt = true;
  for (const survival::CraftRecipe& r : progression::armourRecipes())
    if (r.output == items::CinderScience) anyLocalRecipeMakesIt = true;
  CHECK(!anyLocalRecipeMakesIt);
  // The two that DO exist produce the two local packs, so the refusal above is
  // about the third pack and not about science being unobtainable in general.
  CHECK(sci[0].output == items::AutomationScience);
  CHECK(sci[1].output == items::LogisticScience);

  // The complement, so the refusal is about the ITEM and not about the tech:
  // hand the player the off-world science and the identical query flips.
  CHECK(science.add(items::CinderScience, 5) == 0);
  CHECK(rs.canResearch(techs::CinderRefining, science));
  CHECK(rs.tryResearch(techs::CinderRefining, science));
  CHECK(rs.isRecipeUnlocked(recipes::RefineCinderScience));
  CHECK(science.count(items::CinderScience) == 0);
}

// -----------------------------------------------------------------------------
// D5. SCIENCE COSTS SOMETHING SMELTED, which is what makes research downstream
//     of the production chain rather than a free button.
// -----------------------------------------------------------------------------
TEST(survival_science_is_paid_for_in_smelted_metal) {
  SliceRegistry reg = makeSurvivalReg();
  Inventory pack(reg, 20);
  const std::vector<survival::CraftRecipe> sci = scienceHandRecipes();

  // An empty pack crafts nothing, and crafting is all-or-nothing.
  CHECK(!survival::HandCrafter::canCraft(sci[0], pack));
  CHECK(!survival::HandCrafter::craft(sci[0], pack));
  CHECK(pack.count(items::AutomationScience) == 0);

  // RAW ore is not enough: it has to have been through a furnace. That is the
  // whole design of the cost, so it is asserted rather than assumed.
  CHECK(pack.add(survival::items::RawIron, 10) == 0);
  CHECK(pack.add(survival::items::RawCopper, 10) == 0);
  CHECK(!survival::HandCrafter::canCraft(sci[0], pack));

  // Two iron and one copper, and exactly those, buy one pack.
  CHECK(pack.add(survival::items::Iron, 2) == 0);
  CHECK(pack.add(survival::items::Copper, 1) == 0);
  CHECK(survival::HandCrafter::canCraft(sci[0], pack));
  CHECK(survival::HandCrafter::craft(sci[0], pack));
  CHECK(pack.count(items::AutomationScience) == 1);
  CHECK(pack.count(survival::items::Iron) == 0);
  CHECK(pack.count(survival::items::Copper) == 0);
  // The raw ore was NOT touched, which proves the recipe read the ingots.
  CHECK(pack.count(survival::items::RawIron) == 10);
  CHECK(pack.count(survival::items::RawCopper) == 10);

  // Ten packs is Electrification's whole cost, so the first tech is 20 Iron and
  // 10 Copper of real mining. Pinned so a rebalance is deliberate.
  uint32_t iron = 0, copper = 0;
  for (const ItemStack& in : sci[0].inputs) {
    if (in.item == survival::items::Iron) iron = in.count;
    if (in.item == survival::items::Copper) copper = in.count;
  }
  CHECK(iron * 10 == 20);
  CHECK(copper * 10 == 10);
}

// -----------------------------------------------------------------------------
// D6. THE ARMOUR BRANCH, and the property that ties research to progression.h:
//     a piece is not craftable until its tech is in, and `armourRecipes()` is
//     DERIVED from `armourDefs()` so the two can never disagree about a cost.
// -----------------------------------------------------------------------------
TEST(survival_armour_is_gated_and_its_costs_are_not_transcribed) {
  SliceRegistry reg = makeSurvivalReg();
  TechTree tree = survivalTechTree();
  ResearchState rs(tree);
  Inventory science(reg, 20);
  CHECK(science.add(items::AutomationScience, 100) == 0);
  CHECK(science.add(items::LogisticScience, 100) == 0);

  CHECK(!rs.isItemAvailable(progression::items::ArmourHead));
  CHECK(!rs.isItemAvailable(progression::items::ArmourFeet));
  CHECK(!rs.isItemAvailable(progression::items::ArmourChest));
  CHECK(!rs.isItemAvailable(progression::items::ArmourLegs));

  CHECK(rs.tryResearch(techs::Metallurgy, science));
  CHECK(rs.isItemAvailable(progression::items::ArmourHead));
  CHECK(rs.isItemAvailable(progression::items::ArmourFeet));
  // The SECOND tier did NOT come with the first: a tech that unlocked its whole
  // branch would pass the two assertions above and fail these two.
  CHECK(!rs.isItemAvailable(progression::items::ArmourChest));
  CHECK(!rs.isItemAvailable(progression::items::ArmourLegs));

  CHECK(rs.tryResearch(techs::PlateArmour, science));
  CHECK(rs.isItemAvailable(progression::items::ArmourChest));
  CHECK(rs.isItemAvailable(progression::items::ArmourLegs));

  // Derived, not transcribed: four recipes, in armourDefs() order, each one the
  // def's OWN cost object field for field.
  const std::vector<progression::ArmourDef> defs = progression::armourDefs();
  const std::vector<survival::CraftRecipe> rec = progression::armourRecipes();
  CHECK(rec.size() == defs.size());
  CHECK(rec.size() == 4);
  for (size_t i = 0; i < rec.size(); ++i) {
    CHECK(rec[i].output == defs[i].item);
    CHECK(rec[i].outputCount == defs[i].cost.outputCount);
    CHECK(rec[i].inputs.size() == defs[i].cost.inputs.size());
    for (size_t k = 0; k < rec[i].inputs.size(); ++k) {
      CHECK(rec[i].inputs[k].item == defs[i].cost.inputs[k].item);
      CHECK(rec[i].inputs[k].count == defs[i].cost.inputs[k].count);
    }
  }
  // The shipped iron helm is 6 Iron + 2 Wood, pinned so a rebalance is a
  // deliberate edit rather than a silent one.
  CHECK(rec[0].output == progression::items::ArmourHead);
  CHECK(rec[0].inputs[0].item == survival::items::Iron);
  CHECK(rec[0].inputs[0].count == 6);
}

// -----------------------------------------------------------------------------
// D7. THE TREE'S OWN SHAPE: the depths a panel lays out in columns, the two
//     trees not colliding in the TechId space, and the reload path.
// -----------------------------------------------------------------------------
TEST(survival_tree_shape_and_id_space) {
  TechTree tree = survivalTechTree();
  // GP-533 appends the scanning antenna as the eighth tech
  // (test_scanning_antenna.cpp carries its own dedicated assertions).
  CHECK(tree.allTechs().size() == 8);

  CHECK(tree.depthOf(techs::Electrification) == 0);
  CHECK(tree.depthOf(techs::Metallurgy) == 0);
  // GP-533. NO PREREQ, deliberately: the antenna is researched off the
  // station alone, before Electrification even exists, because investigating
  // the ruins it reveals is what the story line unlocks electricity FROM.
  CHECK(tree.depthOf(techs::ScanningAntenna) == 0);
  CHECK(tree.depthOf(techs::ElectricSmelting) == 1);
  CHECK(tree.depthOf(techs::PlateArmour) == 1);
  CHECK(tree.depthOf(techs::FlightAutopilot) == 1);
  CHECK(tree.depthOf(techs::LaunchFacilities) == 1);
  CHECK(tree.depthOf(techs::CinderRefining) == 2);

  // GP-57 / DW-29. THE PAD AND THE AUTOPILOT ARE THE TWO ENDS OF ONE ARC, and
  // the milestone belongs on the FAR end. Gating the pad on having reached
  // orbit would be a cycle, because reaching orbit is what the pad is for, so
  // this asserts the direction rather than the presence: exactly one of the two
  // carries a milestone, and it is the autopilot.
  CHECK(tree.tech(techs::LaunchFacilities)->requiresMilestone == kNoMilestone);
  // GP-965. THE FAR END MOVED FURTHER OUT, and this line is the tech-tree half
  // of the reconciliation `FlightAuto.ts` already shipped: the autopilot's deed
  // is boarding the station, which is what `story_line_outline_v1.txt` awards
  // it for and what Reid's task-39 ruling orders it behind.
  CHECK(tree.tech(techs::FlightAutopilot)->requiresMilestone
        == milestones::StationBoarded);
  // AND IT IS NOT THE ORBIT ANY MORE, asserted by name so a revert is loud.
  CHECK(tree.tech(techs::FlightAutopilot)->requiresMilestone
        != milestones::ReachedOrbit);
  // L7 (GP-546 to GP-549). Electrification carries its OWN milestone, distinct
  // from the autopilot's, so a save with one earned and not the other is a
  // real and reachable state rather than the two ids silently meaning the
  // same requirement.
  CHECK(tree.tech(techs::Electrification)->requiresMilestone
        == milestones::RuinInvestigated);
  CHECK(milestones::RuinInvestigated != milestones::ReachedOrbit);
  CHECK(tree.depthOf(kNoTech) == 0);           // an unknown id is a root, not a hang

  // The SLICE tree (§B.2) is untouched by all of this, and the two id blocks
  // are disjoint: a save carrying unlocked ids from one can never be read as
  // the other's.
  TechTree slice;
  CHECK(slice.allTechs().size() == 3);
  for (const TechDef& a : slice.allTechs())
    for (const TechDef& b : tree.allTechs())
      CHECK(a.id != b.id);

  // GP-267. EVERY SURVIVAL TECH NOW GRANTS SOMETHING, and this line used to
  // say the opposite. It read `grantsNothing == 1` with `FlightAutopilot`
  // named as the one exception, because that tech shipped as a bare flag:
  // the comment beside it said inventing a part for it there would be one
  // lane authoring another lane's content. The gameplay lane has now
  // authored that part (`vessel::parts::AutopilotModule`, 0x010D) and this
  // tech grants it. The assertion is kept and INVERTED rather than deleted,
  // so a tech that silently unlocks nothing still cannot be added without
  // this line failing.
  size_t grantsNothing = 0;
  for (const TechDef& t : tree.allTechs()) {
    if (t.unlockItems.empty() && t.unlockEntities.empty() && t.unlockRecipes.empty())
      ++grantsNothing;
  }
  CHECK(grantsNothing == 0);
  // And it grants EXACTLY the part, by id. The id is checked as a literal on
  // purpose: `parts_items::AutopilotModule` is a hand-written copy of a
  // mapping owned by web/wasm/of_vessel_api.inc, that file carries a
  // static_assert pinning the two together, and this is the third leg. A
  // gate wired to the wrong ItemId unlocks nothing and reads on screen as
  // "you have not researched it" for ever, which is indistinguishable from
  // working.
  CHECK(tree.tech(techs::FlightAutopilot)->unlockItems.size() == 1);
  CHECK(tree.tech(techs::FlightAutopilot)->unlockItems[0]
        == parts_items::AutopilotModule);
  CHECK(parts_items::AutopilotModule == 0x005D);

  // Restore-from-persistence carries the ITEM unlocks too, not only the techs:
  // a reloaded world in which the pole was researched but not available is the
  // failure this asserts against.
  ResearchState rs(tree);
  CHECK(rs.restoreUnlocked(std::vector<TechId>{techs::Electrification,
                                               techs::Metallurgy}) == 2);
  CHECK(rs.isItemAvailable(survival::items::PowerPole));
  CHECK(rs.isItemAvailable(progression::items::ArmourHead));
  CHECK(!rs.isItemAvailable(survival::items::ElectricSmelter));
  // Restoring does NOT restore milestones: they are their own saved list, and
  // silently granting one would hand out DW-29's autopilot on every reload.
  // Electrification restored above via restoreUnlocked with NO milestone set
  // proves the same: restore bypasses the gate rather than earning it.
  CHECK(!rs.hasMilestone(milestones::ReachedOrbit));
  // GP-965: and the one the autopilot actually reads now.
  CHECK(!rs.hasMilestone(milestones::StationBoarded));
  CHECK(!rs.hasMilestone(milestones::RuinInvestigated));
}

// -----------------------------------------------------------------------------
// D8. L7's MILESTONE (GP-546 to GP-549): ELECTRIFICATION IS EARNED BY
//     INVESTIGATING A RUIN, NOT BOUGHT ON SCIENCE ALONE. The antenna reveals a
//     ruin; walking in and interacting at its `socket_investigate` point is
//     what `story_line_outline_v1.txt` says unlocks electricity research.
//     D3's own shape, restated for a second, independent milestone gate.
// -----------------------------------------------------------------------------
TEST(survival_electrification_needs_the_ruin_investigated) {
  SliceRegistry reg = makeSurvivalReg();
  TechTree tree = survivalTechTree();
  ResearchState rs(tree);
  Inventory science(reg, 20);
  CHECK(science.add(items::AutomationScience, 200) == 0);

  // Full science, no deed: refused, and the refusal NAMES the deed.
  CHECK(rs.costAffordable(techs::Electrification, science));
  CHECK(!rs.canResearch(techs::Electrification, science));
  ResearchStatus s = rs.status(techs::Electrification, science);
  CHECK(s.block == ResearchBlock::MilestoneMissing);
  CHECK(s.milestone == milestones::RuinInvestigated);
  CHECK(!rs.milestoneMet(techs::Electrification));
  CHECK(!rs.hasMilestone(milestones::RuinInvestigated));

  const uint32_t before = science.count(items::AutomationScience);
  CHECK(!rs.tryResearch(techs::Electrification, science));
  CHECK(science.count(items::AutomationScience) == before);

  // The WRONG milestone does not open it either.
  CHECK(rs.setMilestone(milestones::ReachedOrbit));
  CHECK(!rs.canResearch(techs::Electrification, science));
  CHECK(rs.status(techs::Electrification, science).block
        == ResearchBlock::MilestoneMissing);

  // The right one does, and it is monotonic and dedup-safe (poi.h's own
  // `visited_`, not this: RuinSites'/Sites' per-ruin bit is a SEPARATE
  // concern from this single research-tree flag, see the header comment on
  // `milestones::RuinInvestigated`).
  CHECK(rs.setMilestone(milestones::RuinInvestigated));
  CHECK(!rs.setMilestone(milestones::RuinInvestigated));   // already earned
  CHECK(rs.canResearch(techs::Electrification, science));
  CHECK(rs.tryResearch(techs::Electrification, science));
  CHECK(rs.isUnlocked(techs::Electrification));
  CHECK(science.count(items::AutomationScience) == before - 10);

  // And the antenna's OWN tech (no prereq, no milestone) is unaffected: it
  // was reachable before this and stays reachable, the ordering the story
  // line and GP-535 both insist on (the antenna comes BEFORE electricity).
  CHECK(tree.tech(techs::ScanningAntenna)->requiresMilestone == kNoMilestone);
}
