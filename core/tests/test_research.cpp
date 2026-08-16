// =============================================================================
// test_research.cpp — Phase-2 research / tech tree (GP-1 produce-science→unlock,
// GP-2 off-world gating). Proves the progression spine the slice deferred.
//
// Consumes the gameplay-logic core (gameplay.h Inventory/SliceRegistry/ItemId)
// and the new research layer (research.h TechTree / ResearchState). Asserts:
//
//   1. Affordable research → unlocked, science consumed, its recipes/entities
//      become unlocked; INSUFFICIENT science → fails, nothing consumed.
//   2. A tech with prereqs cannot be researched until its prereqs are unlocked.
//   3. OFF-WORLD GATING (GP-2): the Cinderite tech CANNOT be researched with
//      only Forge-derived science; once the Cinderite-derived item is available
//      it CAN — this is the gate that requires reaching Cinder.
//   4. Unlocking is monotonic + deterministic; a recipe gated behind a tech is
//      unavailable until that tech is unlocked.
// =============================================================================
#include <cstdio>

#include "test_framework.h"
#include "of/gameplay.h"
#include "of/research.h"

using namespace of;
using namespace of::gameplay;

// Build a registry with the research-layer science items registered, so the
// Inventory plumbing (stack caps) works for science packs.
static SliceRegistry makeReg() {
  SliceRegistry reg;
  RegisterScienceItems(reg);
  return reg;
}

// =============================================================================
// 1. AFFORDABLE RESEARCH unlocks + consumes; INSUFFICIENT fails clean (GP-1).
// =============================================================================
TEST(research_basic_tech_when_affordable_unlocks_and_consumes) {
  SliceRegistry reg = makeReg();
  TechTree tree;
  ResearchState rs(tree);

  // BasicSmelting costs 10 Automation science. Stock exactly enough.
  Inventory science(reg, 20);
  CHECK(science.add(items::AutomationScience, 10) == 0);
  CHECK(science.count(items::AutomationScience) == 10);

  // Pre-state: nothing unlocked; the smelt recipe is NOT available yet.
  CHECK(!rs.isUnlocked(techs::BasicSmelting));
  CHECK(!rs.isRecipeUnlocked(recipes::SmeltFerrite));
  CHECK(!rs.isRecipeUnlocked(recipes::AssembleFrame));
  CHECK(!rs.isEntityUnlocked(types::Smelter));
  CHECK(rs.canResearch(techs::BasicSmelting, science));

  // Research it: succeeds, unlocks tech + its recipes/entities, consumes cost.
  CHECK(rs.tryResearch(techs::BasicSmelting, science));
  CHECK(rs.isUnlocked(techs::BasicSmelting));
  CHECK(rs.isRecipeUnlocked(recipes::SmeltFerrite));   // recipe now available
  CHECK(rs.isRecipeUnlocked(recipes::AssembleFrame));
  CHECK(rs.isEntityUnlocked(types::Smelter));          // entity now buildable
  CHECK(rs.isEntityUnlocked(types::Assembler));
  CHECK(science.count(items::AutomationScience) == 0); // science was spent

  // Idempotent: re-researching an unlocked tech is a no-op (returns false,
  // consumes nothing — there is nothing left to spend anyway).
  CHECK(!rs.tryResearch(techs::BasicSmelting, science));
  CHECK(rs.isUnlocked(techs::BasicSmelting));
}

TEST(research_insufficient_science_fails_and_consumes_nothing) {
  SliceRegistry reg = makeReg();
  TechTree tree;
  ResearchState rs(tree);

  // BasicSmelting needs 10; stock only 9.
  Inventory science(reg, 20);
  science.add(items::AutomationScience, 9);

  CHECK(!rs.costAffordable(techs::BasicSmelting, science));
  CHECK(!rs.canResearch(techs::BasicSmelting, science));

  // The attempt fails AND leaves the science pool untouched (all-or-nothing).
  CHECK(!rs.tryResearch(techs::BasicSmelting, science));
  CHECK(!rs.isUnlocked(techs::BasicSmelting));
  CHECK(!rs.isRecipeUnlocked(recipes::SmeltFerrite));  // still gated
  CHECK(science.count(items::AutomationScience) == 9); // nothing consumed
}

// =============================================================================
// 2. PREREQ GATING — a tech with prereqs cannot be researched until they unlock.
// =============================================================================
TEST(research_tech_with_prereqs_blocked_until_prereqs_unlocked) {
  SliceRegistry reg = makeReg();
  TechTree tree;
  ResearchState rs(tree);

  // Logistics requires BasicSmelting. Stock ample science for BOTH so the only
  // thing that can block Logistics is the missing prereq.
  Inventory science(reg, 20);
  science.add(items::AutomationScience, 100);
  science.add(items::LogisticScience, 100);

  // Cost is affordable, but the prereq is NOT met -> cannot research yet.
  CHECK(rs.costAffordable(techs::Logistics, science));
  CHECK(!rs.prereqsMet(techs::Logistics));
  CHECK(!rs.canResearch(techs::Logistics, science));
  CHECK(!rs.tryResearch(techs::Logistics, science));
  CHECK(!rs.isUnlocked(techs::Logistics));
  CHECK(!rs.isEntityUnlocked(types::Belt));  // belts still gated

  // The pool is untouched by the blocked attempt.
  CHECK(science.count(items::AutomationScience) == 100);
  CHECK(science.count(items::LogisticScience) == 100);

  // Unlock the prereq, then Logistics becomes researchable.
  CHECK(rs.tryResearch(techs::BasicSmelting, science));
  CHECK(rs.prereqsMet(techs::Logistics));
  CHECK(rs.canResearch(techs::Logistics, science));
  CHECK(rs.tryResearch(techs::Logistics, science));
  CHECK(rs.isUnlocked(techs::Logistics));
  CHECK(rs.isEntityUnlocked(types::Belt));   // belts now buildable
  CHECK(rs.isEntityUnlocked(types::Box));
}

// =============================================================================
// 3. OFF-WORLD GATING (GP-2) — the WHOLE POINT. CinderiteRefining costs a
// Cinderite-derived science pack, which only exists once Cinder has been mined.
// With only Forge-derived science it is UNREACHABLE; once the off-world item is
// in the pool it becomes researchable. This is the gate that makes the
// KSP×Factorio crossover matter — you MUST leave the planet to progress.
// =============================================================================
TEST(offworld_gate_cinderite_tech_unresearchable_without_cinder) {
  SliceRegistry reg = makeReg();
  TechTree tree;
  ResearchState rs(tree);

  // A pure-Forge science pool: plenty of Automation science, the prereq met,
  // but NO Cinder science (the Cinderite-derived item) — because the player has
  // not reached Cinder. CinderScience can ONLY be made from Cinderite (0x0004),
  // which world-gen places ONLY on Cinder (WG-4 / P1-D4).
  Inventory science(reg, 20);
  science.add(items::AutomationScience, 100);

  // Unlock the prereq (BasicSmelting) so the ONLY thing blocking the off-world
  // tech is its off-world cost item — isolating the gate.
  CHECK(rs.tryResearch(techs::BasicSmelting, science));
  CHECK(rs.prereqsMet(techs::CinderiteRefining));

  // THE GATE: prereqs met, automation science plentiful — but the Cinderite-
  // derived cost item is absent, so the tech is NOT affordable / researchable.
  CHECK(!science.has(items::CinderScience, 1));
  CHECK(!rs.costAffordable(techs::CinderiteRefining, science));
  CHECK(!rs.canResearch(techs::CinderiteRefining, science));
  CHECK(!rs.tryResearch(techs::CinderiteRefining, science));
  CHECK(!rs.isUnlocked(techs::CinderiteRefining));
  CHECK(!rs.isRecipeUnlocked(recipes::MineCinderite));  // off-world recipe gated
  std::printf("    [off-world gate] CinderiteRefining BLOCKED without Cinder-"
              "derived science (must reach Cinder).\n");

  // Now the player reaches Cinder, mines Cinderite, and refines it into Cinder
  // science (modeled here as the off-world item entering the pool). The SAME
  // tech is now researchable — the gate opens precisely because the off-world
  // resource is present.
  science.add(items::CinderScience, 5);
  CHECK(science.has(items::CinderScience, 5));
  CHECK(rs.costAffordable(techs::CinderiteRefining, science));
  CHECK(rs.canResearch(techs::CinderiteRefining, science));
  CHECK(rs.tryResearch(techs::CinderiteRefining, science));
  CHECK(rs.isUnlocked(techs::CinderiteRefining));
  CHECK(rs.isRecipeUnlocked(recipes::MineCinderite));   // gate opened
  // Cost consumed (both the automation AND the off-world science).
  CHECK(science.count(items::CinderScience) == 0);
  std::printf("    [off-world gate] CinderiteRefining UNLOCKED once Cinder-"
              "derived science available (crossover gate proven).\n");
}

// The off-world cost item is genuinely a *Cinderite-derived* identity: the tech
// depends on the off-world ItemId, not on some Forge-obtainable substitute. We
// assert the cost names the off-world science pack specifically.
TEST(offworld_gate_cost_names_the_cinderite_derived_item) {
  TechTree tree;
  const TechDef* cind = tree.tech(techs::CinderiteRefining);
  CHECK(cind != nullptr);

  bool requiresOffWorld = false;
  for (const ItemStack& c : cind->cost)
    if (c.item == items::CinderScience && c.count > 0) requiresOffWorld = true;
  CHECK(requiresOffWorld);  // the gate is keyed to the off-world item (GP-2)

  // And it unlocks the off-world extraction recipe (the hook the gate guards).
  bool unlocksOffWorldRecipe = false;
  for (RecipeId r : cind->unlockRecipes)
    if (r == recipes::MineCinderite) unlocksOffWorldRecipe = true;
  CHECK(unlocksOffWorldRecipe);
}

// =============================================================================
// 4. MONOTONIC + DETERMINISTIC unlocking; recipe gated until its tech unlocks.
// =============================================================================
TEST(unlocking_is_monotonic_and_recipe_gated_until_tech) {
  SliceRegistry reg = makeReg();
  TechTree tree;
  ResearchState rs(tree);

  Inventory science(reg, 20);
  science.add(items::AutomationScience, 100);
  science.add(items::LogisticScience, 100);

  // A recipe behind a tech is unavailable until that tech is unlocked.
  CHECK(!rs.isRecipeUnlocked(recipes::SmeltFerrite));
  CHECK(rs.tryResearch(techs::BasicSmelting, science));
  CHECK(rs.isRecipeUnlocked(recipes::SmeltFerrite));

  // MONOTONIC: unlock more, and previously-unlocked content stays unlocked
  // (never re-locks). Also the unlocked-tech count only grows.
  const size_t techsAfterFirst = rs.unlockedTechs().size();
  CHECK(rs.tryResearch(techs::Logistics, science));
  CHECK(rs.unlockedTechs().size() == techsAfterFirst + 1);
  CHECK(rs.isRecipeUnlocked(recipes::SmeltFerrite));   // still unlocked
  CHECK(rs.isUnlocked(techs::BasicSmelting));           // still unlocked
  CHECK(rs.isEntityUnlocked(types::Belt));

  // No duplicate entries accumulate even though re-applying would re-list.
  CHECK(!rs.tryResearch(techs::BasicSmelting, science));  // already done, no-op
  int smeltCount = 0;
  for (RecipeId r : rs.unlockedRecipes())
    if (r == recipes::SmeltFerrite) ++smeltCount;
  CHECK(smeltCount == 1);  // unlock set is a set, not a multiset
}

// DETERMINISM: two independent runs of the same research sequence from identical
// starting science produce identical unlock sets and identical leftover science.
TEST(research_is_deterministic_across_identical_runs) {
  auto run = [](std::vector<TechId>& outTechs, uint32_t& outAuto) {
    SliceRegistry reg = makeReg();
    TechTree tree;
    ResearchState rs(tree);
    Inventory science(reg, 20);
    science.add(items::AutomationScience, 100);
    science.add(items::LogisticScience, 100);
    science.add(items::CinderScience, 100);

    // A fixed sequence (BasicSmelting -> Logistics -> CinderiteRefining).
    rs.tryResearch(techs::BasicSmelting, science);
    rs.tryResearch(techs::Logistics, science);
    rs.tryResearch(techs::CinderiteRefining, science);
    outTechs = rs.unlockedTechs();
    outAuto = science.count(items::AutomationScience);
  };

  std::vector<TechId> a, b;
  uint32_t autoA = 0, autoB = 0;
  run(a, autoA);
  run(b, autoB);

  CHECK(a.size() == 3);          // all three researched
  CHECK(a == b);                 // identical unlock order/content
  CHECK(autoA == autoB);         // identical leftover science
  // 100 - 10(BasicSmelting) - 15(Logistics) - 20(CinderiteRefining) = 55.
  CHECK(autoA == 55);
}

// =============================================================================
// 5. MILESTONES (DW-29) — a thing the player DID, not something bought. GP-530
// gives the web client's `Research.earn` its first live caller (`grantMilestone`
// in `web/src/game/Research.ts`, wired off a real ORBIT status transition in
// `web/src/app/Systems.ts`); this is the ctest for the mechanism underneath it,
// `ResearchState::setMilestone`/`hasMilestone`, run here because it needs no
// browser and no vessel to prove "grant twice, state changes once."
// =============================================================================
TEST(milestone_grant_is_idempotent_and_gates_the_tech) {
  TechTree tree = survivalTechTree();  // FlightAutopilot lives in the survival tree
  ResearchState rs(tree);

  // Not earned yet: FlightAutopilot's own milestone requirement is unmet. This
  // is the exact live bug GP-530 fixes in the client — `Research.earn` had no
  // caller that could ever reach this line outside a save restore.
  //
  // GP-965: the deed is `StationBoarded`, not `ReachedOrbit`. Reid's task-39
  // ordering ruling moved it; see the tech's own comment in research.h.
  CHECK(!rs.hasMilestone(milestones::StationBoarded));
  CHECK(!rs.milestoneMet(techs::FlightAutopilot));

  // GP-965, ON-SCENE NEGATIVE CONTROL: the milestone this tech USED to want
  // does not open it. Reaching orbit is a rung the player passes on the way to
  // the station, so if this line ever went green the ruling would be broken and
  // the autopilot would be available for the mission it sits behind.
  CHECK(rs.setMilestone(milestones::ReachedOrbit));
  CHECK(rs.hasMilestone(milestones::ReachedOrbit));
  CHECK(!rs.milestoneMet(techs::FlightAutopilot));

  // First grant of the RIGHT one: succeeds, the milestone is now held.
  CHECK(rs.setMilestone(milestones::StationBoarded));
  CHECK(rs.hasMilestone(milestones::StationBoarded));
  CHECK(rs.milestoneMet(techs::FlightAutopilot));
  CHECK(rs.milestones().size() == 2);

  // SECOND grant of the SAME milestone: a no-op. Returns false and the held
  // set does not grow — "grant twice, research state changes once," which is
  // the property `grantMilestone`'s idempotence in the client rests on
  // entirely: it adds a logged cause and nothing else (Research.ts).
  CHECK(!rs.setMilestone(milestones::StationBoarded));
  CHECK(rs.milestones().size() == 2);
  CHECK(rs.hasMilestone(milestones::StationBoarded));

  // A third, DIFFERENT milestone grants independently and does not disturb
  // the others (the set is a set, not a single slot) — LandedOffWorld, granted
  // on landing off Forge, is the client's other live caller.
  CHECK(rs.setMilestone(milestones::LandedOffWorld));
  CHECK(rs.milestones().size() == 3);
  CHECK(rs.hasMilestone(milestones::ReachedOrbit));
  CHECK(rs.hasMilestone(milestones::StationBoarded));
  CHECK(rs.hasMilestone(milestones::LandedOffWorld));
}

// A save RESTORE (PersistProgress.ts's `restoreProgress`) calls `earn`/
// `setMilestone` directly, once per saved milestone id, and must not grant a
// SECOND time on a second load of the same save. Modelled here as calling
// `setMilestone` again for an id already held from a "previous session":
// still idempotent, by the same mechanism proven above, so the restore path
// needs no separate dedup logic of its own.
TEST(milestone_restore_of_an_already_held_id_is_a_no_op) {
  TechTree tree = survivalTechTree();
  ResearchState rs(tree);

  // "Session 1": earned live, then saved.
  CHECK(rs.setMilestone(milestones::ReachedOrbit));
  const std::vector<MilestoneId> savedMilestones = rs.milestones();

  // "Session 2": a fresh state, restoring from the save — the restore path's
  // OWN shape (PersistProgress.ts iterates `saved.milestones` and calls
  // `earn` per id, never `grantMilestone`).
  ResearchState restored(tree);
  int grantedOnRestore = 0;
  for (MilestoneId m : savedMilestones) if (restored.setMilestone(m)) ++grantedOnRestore;
  CHECK(grantedOnRestore == 1);
  CHECK(restored.hasMilestone(milestones::ReachedOrbit));

  // A SECOND load of the SAME save (e.g. a reload of a reload) must not grant
  // again: the restore call is applied to a state that already holds it.
  int grantedOnSecondRestore = 0;
  for (MilestoneId m : savedMilestones) if (restored.setMilestone(m)) ++grantedOnSecondRestore;
  CHECK(grantedOnSecondRestore == 0);
  CHECK(restored.milestones().size() == 1);
}
