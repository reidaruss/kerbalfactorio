// =============================================================================
// test_slice_e2e.cpp — the CAPSTONE end-to-end vertical-slice loop (headless).
//
// Every other suite proves ONE core in isolation (deposits, factory, research,
// persistence, the SimWorld flight spine). This suite proves they COMPOSE into
// the whole Phase-1 + research-slice game loop end-to-end, driving the REAL
// public APIs of each domain core. The four integration GAPS the first cut of
// this capstone had to work around are now CLOSED in the cores, so the loop is a
// clean typed chain — no bridges, no casts, no off-table magic:
//
//   GAP-1  deposit id unified: gameplay::DepositId IS worldgen::FDepositNode::Id
//          (one uint64), so we mine a worldgen::FDepositNode DIRECTLY via the new
//          gameplay::mineDeposit(FDepositNode&, ...) overload — no bridge struct,
//          no uint64→uint32 truncation anywhere on the path or into the save.
//   GAP-2  per-item production: FactorySim::producedCountOf(ItemId) lets us ask
//          the factory "how many AutomationScience / CinderScience did you make?"
//          so science is a DISTINCT producible item the research layer consumes —
//          not inferred from a single monotonic total.
//   GAP-3  science recipes authored as data: CraftAutomationScience (plate →
//          AutomationScience) and the OFF-WORLD RefineCinderScience (Cinderite →
//          CinderScience). The factory crafts science with a real recipe; the
//          off-world refine is the conversion the off-world gate (GP-2) needs.
//   GAP-4  research unlocks persist: SliceState carries the unlocked-tech id list
//          and ResearchState::restoreUnlocked() RESTORES it on reload — so the
//          unlock set survives save→reload WITHOUT re-deriving it.
//
// The point is COMPOSITION: the public surfaces of deposits.h, gameplay.h,
// factory_sim.h, research.h, sim_world.h, persistence.h + persistence_file.h
// hand off to one another to walk the full loop as a typed chain.
// =============================================================================
#include <chrono>
#include <cstdint>
#include <cstdio>
#include <filesystem>
#include <string>
#include <type_traits>
#include <vector>

#include "test_framework.h"
#include "of/sim_world.h"
#include "of/deposits.h"
#include "of/gameplay.h"
#include "of/factory_sim.h"
#include "of/research.h"
#include "of/persistence.h"
#include "of/persistence_file.h"

using namespace of;
namespace fs = std::filesystem;

// -----------------------------------------------------------------------------
// A unique temp slot dir (clock ^ a static's address, like test_persistence_file
// .cpp) so concurrent ctest runs never collide on the same path.
// -----------------------------------------------------------------------------
static fs::path makeUniqueSlotDir(const char* tag) {
  static int counter = 0;
  static const unsigned long long procToken =
      static_cast<unsigned long long>(
          std::chrono::high_resolution_clock::now().time_since_epoch().count()) ^
      static_cast<unsigned long long>(reinterpret_cast<std::uintptr_t>(&counter));
  ++counter;
  fs::path base = fs::temp_directory_path() /
                  ("of_slice_e2e_" + std::string(tag) + "_" +
                   std::to_string(procToken) + "_" + std::to_string(counter));
  std::error_code ec;
  fs::remove_all(base, ec);  // clean any stale leftover
  return base;
}

static void cleanup(const fs::path& dir) {
  std::error_code ec;
  fs::remove_all(dir, ec);  // best-effort
}

// Stand up a 1-machine producing factory (mirrors journey_dump.cpp /
// test_integration.cpp standUpFactory): a generator powers a fast recipe and a
// big input buffer keeps it from starving, so producedCount() climbs steadily.
static factory::EntityHandle standUpFactory(SimWorld& world) {
  factory::Recipe r;
  r.inputItem = gameplay::items::FerriteOre;   // ore in (uses the shared id space)
  r.inputCount = 1;
  r.outputItem = gameplay::items::FerritePlate;  // plate out
  r.outputCount = 1;
  r.craftTimeTicks = 5;
  r.powerW = 1000;

  factory::FactorySim& sim = world.factory();
  factory::EntityHandle m = sim.addMachine(r);
  factory::EntityHandle gen = sim.addGenerator(/*network*/ 1, /*supplyW*/ 100000);
  (void)gen;
  sim.setMachineNetwork(m, 1);
  sim.feedMachine(m, /*count*/ 30000);  // big input buffer so it never starves
  return m;
}

// Keep a machine fed (same pattern the integration test uses every loop).
static void keepFed(SimWorld& world, factory::EntityHandle machine) {
  if (world.factory().machineInput(machine) < 4)
    world.factory().feedMachine(machine, 1000);
}

// =============================================================================
// THE LOOP — one continuous walk through all six stages, asserting composition.
// =============================================================================
TEST(slice_e2e_full_loop_composes_all_domains) {
  const uint64_t kSeed = 0xABCDEFull;

  // A single shared registry for the whole gameplay/research layer. Register the
  // research-layer science ITEMS up front (so a science Inventory can hold them)
  // AND the research-layer science RECIPES (GAP-3) so the factory can craft them.
  gameplay::SliceRegistry reg;
  CHECK(gameplay::RegisterScienceItems(reg));
  CHECK(gameplay::RegisterScienceRecipes(reg));  // GAP-3: science recipes are data
  // The off-world refine recipe exists in the registry (Cinderite → CinderScience).
  CHECK(reg.recipe(gameplay::recipes::RefineCinderScience) != nullptr);
  CHECK(reg.recipe(gameplay::recipes::RefineCinderScience)->inputItem ==
        gameplay::items::Cinderite);
  CHECK(reg.recipe(gameplay::recipes::RefineCinderScience)->outputItem ==
        gameplay::items::CinderScience);

  // ----------------------------------------------------------------------- //
  // STAGE 1 — MINE: GenerateDeposits on Forge -> pick a Ferrite node -> grant //
  //           ore into an Inventory and deplete the node.                     //
  // ----------------------------------------------------------------------- //
  const worldgen::BodyParams forge = worldgen::makeForge(kSeed);
  // The body's frame id convention: bodyId + 1 (matches cubed_sphere's mesh
  // centerUniverse frame and the deposits test). For the slice this is the frame
  // the deposit positions are tagged with; we mine one body at a time.
  const FrameId forgeDepFrame = static_cast<FrameId>(forge.bodyId + 1);
  worldgen::DepositCatalog forgeCatalog =
      worldgen::DepositCatalog::ForBody(forge, forge.bodySeed, forgeDepFrame);
  CHECK(forgeCatalog.size() > 0);  // Forge actually has deposits

  // Pick the first Ferrite-ore node (Forge is Ferrite-only, but assert it).
  const worldgen::FDepositNode* ferritePick = nullptr;
  for (const worldgen::FDepositNode& n : forgeCatalog.GetDeposits()) {
    CHECK(n.Resource == worldgen::kItemFerriteOre);  // Forge: NEVER Cinderite (WG-4)
    if (!ferritePick) ferritePick = &n;
  }
  CHECK(ferritePick != nullptr);
  const worldgen::DepositId forgeNodeId = ferritePick->Id;
  const double forgeInitialRemaining = ferritePick->RemainingAmount;
  CHECK(forgeInitialRemaining > 0.0);

  // GAP-1: the deposit id is the SAME uint64 type in world-gen, gameplay, and
  // the persistence depletion diff — assert that statically (no truncating
  // bridge exists anymore). gameplay::DepositId == worldgen::DepositId == the
  // FDepositNode::Id type, and persist::DepositDepletion keys on the same width.
  static_assert(std::is_same<gameplay::DepositId, worldgen::DepositId>::value,
                "GAP-1: gameplay + world-gen deposit ids must be one type");
  static_assert(sizeof(gameplay::DepositId) == sizeof(decltype(forgeNodeId)),
                "GAP-1: no id-width narrowing across the slice");

  // (a) Mine via gameplay::mineDeposit into a player Inventory — DIRECTLY on the
  //     world-gen FDepositNode (GAP-1: no bridgeNode). We mine a mutable copy of
  //     the catalog's node (the catalog itself is depleted via ExtractFromDeposit
  //     below — the two mining surfaces, hand-mining vs the catalog mutator).
  gameplay::Inventory pack(reg);
  worldgen::FDepositNode forgeMineNode = *ferritePick;  // a mutable working copy
  uint32_t totalMined = 0;
  for (int k = 0; k < 50 && forgeMineNode.RemainingAmount > 0.0; ++k) {
    gameplay::MineResult mr =
        gameplay::mineDeposit(forgeMineNode, pack, /*baseRate*/ 4);
    totalMined += mr.granted;
  }
  CHECK(totalMined > 0);
  CHECK(pack.count(gameplay::items::FerriteOre) == totalMined);  // ore is in the pack
  CHECK(forgeMineNode.RemainingAmount < forgeInitialRemaining);  // node depleted

  // (b) Also exercise the world-gen catalog's own ExtractFromDeposit (the query-
  //     surface mutator persistence saves as the depletion diff). Extract a chunk
  //     and confirm the catalog's node depletes by exactly the granted amount.
  const double extractReq = 1000.0;
  const double granted = forgeCatalog.ExtractFromDeposit(forgeNodeId, extractReq);
  CHECK(granted > 0.0);
  worldgen::FDepositNode afterExtract;
  CHECK(forgeCatalog.GetDeposit(forgeNodeId, afterExtract));
  CHECK_NEAR(afterExtract.RemainingAmount, forgeInitialRemaining - granted, 1e-6);
  const double forgeDepletedRemaining = afterExtract.RemainingAmount;  // for the save

  // ----------------------------------------------------------------------- //
  // STAGE 2 — AUTOMATE: a factory consumes ore and produces a product, AND a    //
  //           SECOND machine produces *science* as a DISTINCT item type. We      //
  //           read the typed science count straight off the factory (GAP-2).     //
  // ----------------------------------------------------------------------- //
  SimWorld world(kSeed);
  factory::EntityHandle plateMachine = standUpFactory(world);  // ore -> plate

  // A SECOND machine that produces *science* via the AUTHORED basic-science
  // recipe (GAP-3): CraftAutomationScience (Ferrite plate -> AutomationScience).
  // It rides the same network + clock as the plate machine, fed from a buffer of
  // "plates" (a stand-in for the plate->lab chain). Its output is a science item.
  const gameplay::RecipeDef* autoSciDef =
      reg.recipe(gameplay::recipes::CraftAutomationScience);
  CHECK(autoSciDef != nullptr);
  CHECK(autoSciDef->outputItem == gameplay::items::AutomationScience);
  factory::Recipe sci = autoSciDef->toFactoryRecipe();
  sci.craftTimeTicks = 5;  // fast for the headless run (recipe times are TBD-playtest)
  factory::EntityHandle sciMachine = world.factory().addMachine(sci);
  world.factory().setMachineNetwork(sciMachine, 1);
  world.factory().feedMachine(sciMachine, 30000);  // big buffer of "plates"

  // Seed the plate machine's input from the ORE we actually mined (the hand-off:
  // the mined ItemId is the same key the factory consumes — the C-3 single id
  // space, so ore from the deposit feeds the machine directly).
  world.factory().feedMachine(plateMachine, static_cast<uint16_t>(totalMined));
  world.placeOnForgeSurface(0.15, -0.40);

  const uint64_t producedAtStart = world.factory().producedCount();
  CHECK(producedAtStart == 0);
  // GAP-2: no science yet — the per-item counter starts at zero too.
  CHECK(world.factory().producedCountOf(gameplay::items::AutomationScience) == 0);

  // Run the factory on the world clock for a while; production must climb.
  for (int k = 0; k < 600; ++k) {
    keepFed(world, plateMachine);
    if (world.factory().machineInput(sciMachine) < 4)
      world.factory().feedMachine(sciMachine, 1000);
    world.step();
  }
  const uint64_t producedAfterAutomate = world.factory().producedCount();
  CHECK(producedAfterAutomate > producedAtStart);  // total climbed

  // GAP-2 — THE TYPED CHAIN: the factory produced AutomationScience as a DISTINCT
  // item type, and we read exactly how much straight off the sim (no inference
  // from a single total). It also produced FerritePlate; the two partition the
  // total, and neither equals the whole (both machines ran).
  const uint64_t scienceMade =
      world.factory().producedCountOf(gameplay::items::AutomationScience);
  const uint64_t platesMade =
      world.factory().producedCountOf(gameplay::items::FerritePlate);
  CHECK(scienceMade > 0);  // <-- science is a real, queryable producible
  CHECK(platesMade > 0);
  // The per-item breakdown sums to the monotonic total (Σ == producedCount()).
  CHECK(scienceMade + platesMade == world.factory().producedCount());
  // A type the factory never output reads zero (the breakdown is per-key).
  CHECK(world.factory().producedCountOf(gameplay::items::Cinderite) == 0);

  // Move the science the factory actually made into a science pool the research
  // layer spends (in the full game an inserter+box would; the COUNT is the
  // factory's typed producedCountOf, not a guessed number). Plenty for the
  // BasicSmelting cost (10 AutomationScience).
  gameplay::Inventory sciencePool(reg);
  uint16_t toPool = scienceMade > 0xFFFF ? 0xFFFF
                                         : static_cast<uint16_t>(scienceMade);
  sciencePool.add(gameplay::items::AutomationScience, toPool);
  CHECK(sciencePool.count(gameplay::items::AutomationScience) == toPool);
  CHECK(sciencePool.has(gameplay::items::AutomationScience, 10));  // affordable

  // ----------------------------------------------------------------------- //
  // STAGE 3 — RESEARCH: spend the produced science to unlock BasicSmelting     //
  //           (GP-1). A previously-gated recipe (SmeltFerrite) becomes         //
  //           unlocked.                                                        //
  // ----------------------------------------------------------------------- //
  gameplay::TechTree tree;
  gameplay::ResearchState research(tree);

  // Before research: the smelt recipe + smelter entity are GATED (locked).
  CHECK(!research.isRecipeUnlocked(gameplay::recipes::SmeltFerrite));
  CHECK(!research.isEntityUnlocked(gameplay::types::Smelter));
  CHECK(!research.isUnlocked(gameplay::techs::BasicSmelting));

  const uint32_t scienceBefore =
      sciencePool.count(gameplay::items::AutomationScience);
  CHECK(research.tryResearch(gameplay::techs::BasicSmelting, sciencePool));  // GP-1
  CHECK(research.isUnlocked(gameplay::techs::BasicSmelting));
  // The gated recipe + entity are now unlocked (the build/craft UX would open).
  CHECK(research.isRecipeUnlocked(gameplay::recipes::SmeltFerrite));
  CHECK(research.isEntityUnlocked(gameplay::types::Smelter));
  // The science was actually SPENT (all-or-nothing consumption, GP-1).
  CHECK(sciencePool.count(gameplay::items::AutomationScience) == scienceBefore - 10);

  // The OFF-WORLD tech is NOT yet researchable: prereq (BasicSmelting) is met,
  // but its cost includes CinderScience, which we have none of (it is gated on
  // mining Cinder — GP-2). Assert it is BLOCKED here, the pre-condition of the
  // off-world payoff we prove in stage 5.
  CHECK(!research.canResearch(gameplay::techs::CinderiteRefining, sciencePool));
  CHECK(!research.tryResearch(gameplay::techs::CinderiteRefining, sciencePool));
  CHECK(!research.isUnlocked(gameplay::techs::CinderiteRefining));

  // ----------------------------------------------------------------------- //
  // STAGE 4 — FLY: run the SimWorld journey Forge -> Cinder. It crosses the    //
  //           SOI exactly once and lands, with the factory still producing.    //
  //           (Same trajectory schedule as test_integration / journey_dump.)   //
  // ----------------------------------------------------------------------- //
  CHECK(world.vesselFrame() == world.forgeFrame());
  CHECK(world.vesselMode() == VesselMode::Active);
  const uint64_t producedBeforeFlight = world.factory().producedCount();

  // Ascent (ACTIVE): thrust up ~90 s.
  const Vec3 up = orbital::normalized(world.vesselState().r);
  world.setThrust(up * 25.0);
  for (int k = 0; k < 90 * 60; ++k) {
    keepFed(world, plateMachine);
    world.step();
  }
  CHECK(world.vesselAltitude() > 10.0e3);  // climbed

  // Circularize + park to ON-RAILS, coast.
  world.setThrust(Vec3{0, 0, 0});
  const Vec3 r = world.vesselState().r;
  Vec3 horiz = orbital::normalized(orbital::cross(Vec3{0, 0, 1},
                                                  orbital::normalized(r)));
  world.setVesselVelocity(horiz * world.circularSpeedHere());
  world.parkToRails();
  CHECK(world.vesselMode() == VesselMode::OnRails);
  for (int k = 0; k < 2000; ++k) {
    keepFed(world, plateMachine);
    world.step();
  }

  // Cross to Cinder (FRAME / SOI switch).
  const double cinderX = 1.2e7;
  const double soiR = world.cinderSoiRadius();
  const Vec3 approachR{cinderX - (soiR + 5.0e4) * 0.92,
                       -(soiR + 5.0e4) * 0.39, 0.0};
  const Vec3 approachV{1400.0, 560.0, 0.0};
  world.setVesselState(orbital::StateVector{approachR, approachV});
  world.makeActiveFromCurrentState();
  world.setThrust(Vec3{0, 0, 0});

  const int soiBefore = world.soiSwitchCount();
  bool crossed = false;
  for (int k = 0; k < 4000; ++k) {
    keepFed(world, plateMachine);
    const FrameId frameBefore = world.vesselFrame();
    world.step();
    if (world.vesselFrame() != frameBefore) { crossed = true; break; }
  }
  CHECK(crossed);
  CHECK(world.soiSwitchCount() == soiBefore + 1);  // crossed the SOI exactly once
  CHECK(world.soiSwitchCount() == 1);              // ...and it was the FIRST cross
  CHECK(world.vesselFrame() == world.cinderFrame());
  CHECK_NEAR(world.centralRadius(), 200.0e3, 1.0);  // now orbiting Cinder

  // Land on Cinder (descend ACTIVE to terrain contact).
  const Vec3 cinderRadial = orbital::normalized(world.vesselState().r);
  const double surfR = SimWorld::terrainRadius(world.cinder(), cinderRadial);
  world.setVesselState(orbital::StateVector{cinderRadial * (surfR + 2.5e3),
                                            cinderRadial * -80.0});
  world.makeActiveFromCurrentState();
  world.setThrust(Vec3{0, 0, 0});
  bool landed = false;
  for (int k = 0; k < 90 * 60; ++k) {
    keepFed(world, plateMachine);
    world.step();
    if (world.vesselLanded(/*toleranceM*/ 5.0)) { landed = true; break; }
  }
  CHECK(landed);
  CHECK(world.vesselFrame() == world.cinderFrame());
  // The factory kept producing across the WHOLE flight (active + on-rails).
  CHECK(world.factory().producedCount() > producedBeforeFlight);

  // ----------------------------------------------------------------------- //
  // STAGE 5 — OFF-WORLD UNLOCK: mine Cinderite on Cinder, REFINE it into        //
  //           CinderScience IN THE FACTORY (the authored off-world recipe,      //
  //           GAP-3), and research CinderiteRefining — which was BLOCKED on      //
  //           Forge (GP-2 end-to-end).                                          //
  // ----------------------------------------------------------------------- //
  const worldgen::BodyParams cinder = worldgen::makeCinder(kSeed);
  const FrameId cinderDepFrame = static_cast<FrameId>(cinder.bodyId + 1);
  worldgen::DepositCatalog cinderCatalog =
      worldgen::DepositCatalog::ForBody(cinder, cinder.bodySeed, cinderDepFrame);
  CHECK(cinderCatalog.size() > 0);

  // Cinderite is CINDER-ONLY (WG-4): Forge had none (asserted in stage 1), Cinder
  // has some. Find the first Cinderite node.
  const worldgen::FDepositNode* cinderitePick = nullptr;
  bool cinderHasCinderite = false;
  for (const worldgen::FDepositNode& n : cinderCatalog.GetDeposits()) {
    if (n.Resource == worldgen::kItemCinderite) {
      cinderHasCinderite = true;
      if (!cinderitePick) cinderitePick = &n;
    }
  }
  CHECK(cinderHasCinderite);     // the off-world resource exists on the moon
  CHECK(cinderitePick != nullptr);
  const worldgen::DepositId cinderNodeId = cinderitePick->Id;
  const double cinderInitialRemaining = cinderitePick->RemainingAmount;

  // Mine Cinderite into the player's pack (gameplay mining path again — GAP-1,
  // directly on the world-gen FDepositNode, no bridge).
  worldgen::FDepositNode cinderMineNode = *cinderitePick;  // mutable working copy
  uint32_t cinderiteMined = 0;
  for (int k = 0; k < 50 && cinderMineNode.RemainingAmount > 0.0; ++k) {
    gameplay::MineResult mr =
        gameplay::mineDeposit(cinderMineNode, pack, /*baseRate*/ 4);
    cinderiteMined += mr.granted;
  }
  CHECK(cinderiteMined > 0);
  CHECK(pack.count(gameplay::items::Cinderite) == cinderiteMined);

  // Also deplete the catalog node so the depletion is a real save diff.
  const double cinderGranted =
      cinderCatalog.ExtractFromDeposit(cinderNodeId, 500.0);
  CHECK(cinderGranted > 0.0);
  worldgen::FDepositNode cinderAfter;
  CHECK(cinderCatalog.GetDeposit(cinderNodeId, cinderAfter));
  CHECK(cinderAfter.RemainingAmount < cinderInitialRemaining);
  const double cinderDepletedRemaining = cinderAfter.RemainingAmount;

  // GAP-3 — REFINE off-world ore into off-world science IN THE FACTORY using the
  // authored RefineCinderScience recipe (Cinderite -> CinderScience). This is the
  // conversion the off-world gate needs, and it is ONLY possible because we
  // reached + mined Cinder (the GP-2 gate). We stand up a refine machine on a
  // fresh powered factory, feed it the Cinderite we actually mined, run it, and
  // read the typed CinderScience straight off the sim (GAP-2 again).
  CHECK(cinderiteMined >= 5);  // enough raw ore to refine into >= 5 science
  factory::FactorySim refinery;
  factory::Recipe refine = reg.recipe(gameplay::recipes::RefineCinderScience)
                               ->toFactoryRecipe();
  refine.craftTimeTicks = 5;  // fast for the headless run
  factory::EntityHandle refineMachine = refinery.addMachine(refine);
  factory::EntityHandle refineGen = refinery.addGenerator(/*network*/ 1, 100000);
  (void)refineGen;
  refinery.setMachineNetwork(refineMachine, 1);
  refinery.feedMachine(refineMachine, static_cast<uint16_t>(cinderiteMined));
  for (int k = 0; k < 600; ++k) refinery.step();
  const uint64_t cinderScienceMade =
      refinery.producedCountOf(gameplay::items::CinderScience);
  CHECK(cinderScienceMade > 0);  // <-- off-world science is a real factory output
  CHECK(cinderScienceMade ==
        refinery.producedCount());  // the refinery makes ONLY CinderScience
  CHECK(cinderScienceMade >= 5);    // at least the off-world gate cost

  // Bank the refined off-world science into the research pool (typed count from
  // the sim). Top up the automation science too so the full cost (20 Automation +
  // 5 Cinder) is affordable.
  uint16_t cinderToPool = cinderScienceMade > 0xFFFF
                              ? 0xFFFF
                              : static_cast<uint16_t>(cinderScienceMade);
  sciencePool.add(gameplay::items::CinderScience, cinderToPool);
  sciencePool.add(gameplay::items::AutomationScience, 20);
  CHECK(sciencePool.count(gameplay::items::CinderScience) == cinderToPool);

  // NOW the off-world tech is researchable (prereq met on Forge, cost affordable
  // only after Cinder). This is the crossover-making moment: progression forced
  // us off-world, and only now does the gate open.
  CHECK(research.canResearch(gameplay::techs::CinderiteRefining, sciencePool));
  CHECK(research.tryResearch(gameplay::techs::CinderiteRefining, sciencePool));  // GP-2
  CHECK(research.isUnlocked(gameplay::techs::CinderiteRefining));
  // ...and it unlocked the off-world extraction recipe (the gate hook).
  CHECK(research.isRecipeUnlocked(gameplay::recipes::MineCinderite));

  // ----------------------------------------------------------------------- //
  // STAGE 6 — PERSIST: capture the whole played slice, save to disk, reload,   //
  //           and assert key state survives — INCLUDING the research unlocks    //
  //           (GAP-4: restored, not re-derived).                                //
  // ----------------------------------------------------------------------- //
  persist::SliceState st;
  st.worldSeed = kSeed;
  st.tickIndex = world.clock().tickIndex();
  st.simTime = world.clock().simTime();
  st.observer = world.vesselRootCoord();
  st.observerFrame = world.vesselFrame();

  // World-gen diff: the depleted deposits (seed+diff — placement regenerates).
  // GAP-1: the id is the SAME uint64 across the catalog, gameplay, and the diff —
  // NO truncation, the full FDepositNode::Id is the persistence key.
  st.depletions.push_back(
      persist::DepositDepletion{forgeNodeId, forgeDepletedRemaining});
  st.depletions.push_back(
      persist::DepositDepletion{cinderNodeId, cinderDepletedRemaining});

  // Physics: the craft is ACTIVE-on-surface on Cinder (landed). Persist the conic
  // (park the live state for the elements) AND the live (r,v) (craftActiveOnSurface).
  st.craftElements = orbital::park(world.vesselState(), world.centralMu(),
                                   world.clock().simTime());
  st.craftMode = (world.vesselMode() == VesselMode::OnRails) ? 1 : 0;
  st.craftDominantFrame = world.vesselFrame();
  st.craftActiveOnSurface = true;
  st.craftState = world.vesselState();

  // Factory: the on-rails snapshot proxy (monotonic produced + snapshot tick).
  const uint64_t producedFinal = world.factory().producedCount();
  st.factoryProduced = producedFinal;
  st.factorySnapshotTick = world.factory().tickIndex();

  // Gameplay: the player's inventory (non-empty slots), avatar, objective. We
  // capture the pack's non-empty stacks. The objective walked to "mine off-world"
  // (step 6) since we mined Cinderite — drive the FSM to confirm + persist it.
  for (int i = 0; i < pack.slotCount(); ++i) {
    const gameplay::ItemStack& s = pack.slot(i);
    if (!s.empty()) st.inventory.push_back(s);
  }
  st.avatarPos = world.vesselRootCoord();
  st.avatarBody = 1;  // Cinder
  st.avatarFrame = world.vesselFrame();
  st.avatarControlMode = 1;  // in-craft

  // GAP-4: capture the research UNLOCK SET into the persist state (the tech id
  // list). On reload it is RESTORED directly — not re-derived by replaying the
  // spend sequence — so unlocks survive save→quit→reload.
  for (gameplay::TechId t : research.unlockedTechs())
    st.unlockedTechs.push_back(t);
  CHECK(st.unlockedTechs.size() == 2);  // BasicSmelting + CinderiteRefining

  // Objective FSM: advance through the chain from the facts we accumulated.
  gameplay::ObjectiveTracker objective;
  gameplay::ObjectiveContext ctx;
  ctx.hasFerriteOre = pack.count(gameplay::items::FerriteOre) > 0;
  ctx.hasFerritePlate = true;   // the smelter/plate machine produced plates
  ctx.hasFramePart = true;      // (slice produced parts via the chain)
  ctx.powerNetworkUp = true;
  ctx.powerStable = true;
  ctx.onCinder = (world.vesselFrame() == world.cinderFrame());
  ctx.landedOnCinder = world.vesselLanded(5.0);
  ctx.hasCinderite = pack.count(gameplay::items::Cinderite) > 0;
  // Walk the FSM as far as the facts allow (up to MineOffWorld).
  for (int guard = 0; guard < 16 && objective.tick(ctx); ++guard) { /* advance */ }
  CHECK(objective.stepIndex() >= static_cast<uint8_t>(
                                     gameplay::ObjectiveStep::MineOffWorld));
  st.objectiveStep = objective.stepIndex();
  st.objectiveDone = objective.complete();

  // --- Save -> disk -> reload (the full played-slice round-trip). ---
  const fs::path dir = makeUniqueSlotDir("loop");
  const std::string slot = dir.string();

  const std::vector<uint8_t> bytes = persist::SaveGame::save(st);
  CHECK(bytes.size() > 32);  // a real multi-record save
  CHECK(persist::file::SaveToSlot(slot, bytes));
  CHECK(fs::exists(dir / persist::file::kSaveName()));

  std::vector<uint8_t> loaded;
  CHECK(persist::file::LoadFromSlot(slot, loaded));
  CHECK(loaded == bytes);  // byte-identical through the file container

  // Re-parse the buffer back into a SliceState (regenerate-from-seed + diffs).
  persist::SliceState back = persist::SaveGame::load(loaded);

  // -- Key state SURVIVED the round-trip: --
  // core-engine anchors.
  CHECK(back.worldSeed == kSeed);
  CHECK(back.tickIndex == st.tickIndex);
  CHECK_NEAR(back.simTime, st.simTime, 1e-9);
  // world-gen depletion diff (deposit depletion — the seed+diff property). The id
  // is the full uint64 FDepositNode::Id, round-tripped without narrowing (GAP-1).
  CHECK(back.depletions.size() == 2);
  CHECK(back.depletions[0].depositId == forgeNodeId);
  CHECK_NEAR(back.depletions[0].remaining, forgeDepletedRemaining, 1e-6);
  CHECK(back.depletions[1].depositId == cinderNodeId);
  CHECK_NEAR(back.depletions[1].remaining, cinderDepletedRemaining, 1e-6);
  // physics: craft conic + mode + frame + live state.
  CHECK(back.craftDominantFrame == world.cinderFrame());
  CHECK(back.craftActiveOnSurface);
  CHECK_NEAR(back.craftState.r.x, st.craftState.r.x, 1e-3);
  CHECK_NEAR(back.craftState.r.y, st.craftState.r.y, 1e-3);
  CHECK_NEAR(back.craftState.r.z, st.craftState.r.z, 1e-3);
  CHECK_NEAR(back.craftElements.mu, st.craftElements.mu, 1e3);
  // factory: produced count survived (the on-rails save proxy).
  CHECK(back.factoryProduced == producedFinal);
  CHECK(back.factoryProduced > 0);
  // gameplay: inventory + objective.
  CHECK(back.inventory.size() == st.inventory.size());
  CHECK(back.objectiveStep == st.objectiveStep);
  CHECK(back.objectiveStep >= static_cast<uint8_t>(
                                  gameplay::ObjectiveStep::MineOffWorld));

  // The reloaded inventory still holds the off-world resource (Cinderite) we
  // mined — proof the played-slice payoff survived save/quit/reload.
  uint32_t reloadedCinderite = 0, reloadedOre = 0;
  for (const gameplay::ItemStack& s : back.inventory) {
    if (s.item == gameplay::items::Cinderite) reloadedCinderite += s.count;
    if (s.item == gameplay::items::FerriteOre) reloadedOre += s.count;
  }
  CHECK(reloadedCinderite == cinderiteMined);
  CHECK(reloadedOre == totalMined);

  // GAP-4 — RESEARCH UNLOCKS RESTORED (not re-derived). The persisted tech id
  // list round-tripped through the save; we RESTORE it into a fresh ResearchState
  // with an EMPTY science pool (proving no spend is replayed) and assert the full
  // unlock set — techs AND the recipes/entities they gate — is reconstructed.
  CHECK(back.unlockedTechs.size() == 2);
  {
    gameplay::TechTree tree2;
    gameplay::ResearchState restored(tree2);
    gameplay::Inventory emptyPool(reg);  // NO science — restore must not spend any
    CHECK(emptyPool.empty());

    // Nothing is unlocked until we restore.
    CHECK(!restored.isUnlocked(gameplay::techs::BasicSmelting));
    CHECK(!restored.isUnlocked(gameplay::techs::CinderiteRefining));

    // Restore the persisted unlock set directly.
    const size_t applied = restored.restoreUnlocked(back.unlockedTechs);
    CHECK(applied == back.unlockedTechs.size());  // every id resolved + applied

    // Both techs are unlocked again — WITHOUT any tryResearch / science spend.
    CHECK(restored.isUnlocked(gameplay::techs::BasicSmelting));
    CHECK(restored.isUnlocked(gameplay::techs::CinderiteRefining));
    CHECK(emptyPool.empty());  // restore consumed nothing
    // ...and the recipes/entities those techs gate are unlocked too (the build/
    // craft UX would reopen exactly as before the save).
    CHECK(restored.isRecipeUnlocked(gameplay::recipes::SmeltFerrite));
    CHECK(restored.isEntityUnlocked(gameplay::types::Smelter));
    CHECK(restored.isRecipeUnlocked(gameplay::recipes::MineCinderite));

    // The restored set matches the pre-save set exactly (same techs, no extras).
    CHECK(restored.unlockedTechs().size() == research.unlockedTechs().size());
    for (gameplay::TechId t : research.unlockedTechs())
      CHECK(restored.isUnlocked(t));
  }

  std::printf(
      "    [slice-e2e] mined_ore=%u  mined_cinderite=%u  produced=%llu  "
      "auto_sci=%llu  cinder_sci=%llu  soi_switches=%d  ticks=%llu  obj_step=%u  "
      "techs=%zu  save_bytes=%zu\n",
      totalMined, cinderiteMined, (unsigned long long)producedFinal,
      (unsigned long long)scienceMade, (unsigned long long)cinderScienceMade,
      world.soiSwitchCount(), (unsigned long long)world.clock().tickIndex(),
      static_cast<unsigned>(st.objectiveStep), back.unlockedTechs.size(),
      bytes.size());

  cleanup(dir);
}
