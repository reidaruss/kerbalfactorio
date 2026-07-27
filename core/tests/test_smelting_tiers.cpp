// =============================================================================
// test_smelting_tiers.cpp — the smelting ladder (gameplay.h §S.0).
//
//   primitive furnace   180 ticks/smelt   burns wood or coal
//   coal smelter         60 ticks/smelt   burns coal
//   electric smelter     30 ticks/smelt   draws 30 kW off an of::power grid
//
// The thing this suite is really defending is that there are TWO engines and
// THREE rungs, not three engines. The fuel rungs are run by survival::Furnace,
// the powered rung by a factory_sim machine, and the §S.0 table is a descriptor
// that says which is which. So the central test is that the same ten ore become
// the same ten ingots on all three, at three different, hand-computed rates.
//
// Every tick count here was derived by hand from the tier speeds, not read off
// a run.
// =============================================================================
#include <cstdio>
#include <vector>

#include "test_framework.h"
#include "of/gameplay.h"
#include "of/automation.h"
#include "of/power.h"

using namespace of;
using namespace of::gameplay;
namespace sv = of::gameplay::survival;
namespace au = of::automation;
namespace pw = of::power;

// =============================================================================
// 1. THE LADDER IS ONE TABLE, OPEN AT THE BOTTOM.
// =============================================================================
TEST(the_ladder_is_data_and_says_who_runs_each_rung) {
  const std::vector<sv::SmeltTierDef>& t = sv::smeltTiers();
  CHECK(t.size() == 3);

  CHECK(t[0].id == sv::SmeltTierId::PrimitiveFurnace);
  CHECK(t[0].ticksPerSmelt == 180);
  CHECK(t[0].powerW == 0);
  CHECK(t[0].authority == sv::SmeltAuthority::FuelPool);
  CHECK(!t[0].isPowered());

  CHECK(t[1].id == sv::SmeltTierId::Smelter);
  CHECK(t[1].ticksPerSmelt == 60);
  CHECK(t[1].powerW == 0);
  CHECK(t[1].authority == sv::SmeltAuthority::FuelPool);

  CHECK(t[2].id == sv::SmeltTierId::ElectricSmelter);
  CHECK(t[2].ticksPerSmelt == 30);
  CHECK(t[2].powerW == 30000);
  CHECK(t[2].authority == sv::SmeltAuthority::PowerNetwork);
  CHECK(t[2].isPowered());

  // The ladder is monotonic: each rung is strictly faster than the one above.
  for (size_t i = 1; i < t.size(); ++i)
    CHECK(t[i].ticksPerSmelt < t[i - 1].ticksPerSmelt);
  // 6 : 2 : 1, so the progression reads as a progression.
  CHECK(t[0].ticksPerSmelt == 6 * t[2].ticksPerSmelt);
  CHECK(t[1].ticksPerSmelt == 2 * t[2].ticksPerSmelt);

  // The two-tier FurnaceTier enum that shipped still answers, and it answers
  // FROM THE TABLE, so the speeds are stated exactly once.
  CHECK(sv::ticksPerSmeltFor(sv::FurnaceTier::Furnace) == 180);
  CHECK(sv::ticksPerSmeltFor(sv::FurnaceTier::Smelter) == 60);
  CHECK(sv::smeltTierOf(sv::FurnaceTier::Furnace) ==
        sv::SmeltTierId::PrimitiveFurnace);
  CHECK(sv::smeltTierOf(sv::FurnaceTier::Smelter) == sv::SmeltTierId::Smelter);

  // Only the FUEL rungs are FurnaceTiers. A Furnace has a burn pool and no
  // network, so there is deliberately no FurnaceTier::Electric to construct.
  CHECK(sv::smeltTier(sv::smeltTierOf(sv::FurnaceTier::Furnace)).authority ==
        sv::SmeltAuthority::FuelPool);
  CHECK(sv::smeltTier(sv::smeltTierOf(sv::FurnaceTier::Smelter)).authority ==
        sv::SmeltAuthority::FuelPool);
}

TEST(the_electric_tier_reuses_shipped_type_ids_rather_than_minting_new_ones) {
  // ASSET-SPECS §4 is the TypeId authority and it already ships a smelter mesh
  // at 0x12, a generator at 0x15 and a power pole at 0x16. Minting 0x32/0x33/
  // 0x34 for the same three things would be a second id for one mesh.
  CHECK(sv::types::ElectricSmelter == 0x12);
  CHECK(sv::types::BurnerGenerator == 0x15);
  CHECK(sv::types::PowerPole == 0x16);
  CHECK(sv::types::ElectricSmelter == types::Smelter);
  CHECK(sv::types::BurnerGenerator == types::Generator);
  CHECK(sv::types::PowerPole == types::PowerPole);
  // The fuel rungs keep their own art, which is a different mesh and correctly
  // a different id.
  CHECK(sv::types::PrimitiveFurnace == 0x30);
  CHECK(sv::types::SurvivalSmelter == 0x31);
  CHECK(sv::smeltTier(sv::SmeltTierId::ElectricSmelter).typeId == 0x12);

  // The item ids are new (a distinct buildable), the entity ids are not.
  CHECK(sv::items::ElectricSmelter == 0x003D);
  CHECK(sv::items::BurnerGenerator == 0x003E);
  CHECK(sv::items::PowerPole == 0x003F);
}

TEST(the_new_buildables_register_and_are_craftable) {
  SliceRegistry reg;
  CHECK(sv::RegisterSurvivalContent(reg));
  const ItemDef* es = reg.item(sv::items::ElectricSmelter);
  const ItemDef* bg = reg.item(sv::items::BurnerGenerator);
  const ItemDef* pp = reg.item(sv::items::PowerPole);
  CHECK(es != nullptr && bg != nullptr && pp != nullptr);
  CHECK(es && es->isBuildable() && es->placesEntityTypeId == 0x12);
  CHECK(bg && bg->isBuildable() && bg->placesEntityTypeId == 0x15);
  CHECK(pp && pp->isBuildable() && pp->placesEntityTypeId == 0x16);

  // The craft menu grew by exactly three; the four that shipped keep their
  // positions, so nothing that indexes the list moved.
  const std::vector<sv::CraftRecipe> hand = sv::handRecipes();
  CHECK(hand.size() == 7);
  CHECK(hand[0].output == sv::items::CrudePickaxe);
  CHECK(hand[3].output == sv::items::SurvivalSmelter);
  CHECK(hand[4].output == sv::items::PowerPole);
  CHECK(hand[5].output == sv::items::BurnerGenerator);
  CHECK(hand[6].output == sv::items::ElectricSmelter);

  // The power tier is priced in SMELTED metal, so it is gated behind having run
  // the fuel tier: you cannot build the thing that replaces the furnace until
  // the furnace has done some work. Progression as a bill of materials.
  bool needsIngot = false;
  for (const ItemStack& in : sv::recipeElectricSmelter().inputs)
    if (in.item == sv::items::Iron || in.item == sv::items::Copper)
      needsIngot = true;
  CHECK(needsIngot);
  for (const ItemStack& in : sv::recipeElectricSmelter().inputs)
    CHECK(in.item != sv::items::RawIron && in.item != sv::items::RawCopper);

  // All-or-nothing crafting still holds for the new recipes.
  Inventory inv(reg);
  CHECK(!sv::HandCrafter::canCraft(sv::recipeElectricSmelter(), inv));
  inv.add(sv::items::Iron, 10);
  inv.add(sv::items::Copper, 5);
  CHECK(!sv::HandCrafter::canCraft(sv::recipeElectricSmelter(), inv));  // no stone
  inv.add(sv::items::Stone, 5);
  CHECK(sv::HandCrafter::canCraft(sv::recipeElectricSmelter(), inv));
  CHECK(sv::HandCrafter::craft(sv::recipeElectricSmelter(), inv));
  CHECK(inv.count(sv::items::ElectricSmelter) == 1);
  CHECK(inv.count(sv::items::Iron) == 0);
}

// =============================================================================
// 2. THE SAME TEN ORE, THE SAME TEN INGOTS, THREE RATES.
// =============================================================================
namespace {

// Run a fuel-driven rung until it has smelted `want` ingots, and report the tick
// it finished on plus the fuel ticks it burned.
struct FuelRun {
  uint32_t ticks = 0;
  uint32_t fuelTicksBurned = 0;
  uint16_t ingots = 0;
  ItemId ingotItem = kNoItem;
};

FuelRun runFuelTier(sv::FurnaceTier tier, ItemId ore, ItemId fuel,
                    uint16_t oreCount, uint16_t fuelUnits) {
  sv::Furnace f(tier);
  f.loadOre(ore, oreCount);
  const uint32_t fuelBefore = sv::fuelTicksPerUnit(fuel) * fuelUnits;
  f.loadFuel(fuel, fuelUnits);
  FuelRun r;
  for (uint32_t t = 1; t <= 100000; ++t) {
    f.tick();
    if (f.outputCount() >= oreCount) {
      r.ticks = t;
      break;
    }
  }
  r.ingots = f.outputCount();
  r.ingotItem = f.outputItem();
  r.fuelTicksBurned = fuelBefore - f.fuelTicks();
  return r;
}

// The powered rung, through the real automation.h path: a pole, a fuelled
// burner generator, and one electric smelter registered on the grid.
struct ElectricRun {
  uint32_t ticks = 0;
  uint64_t ingots = 0;
  uint32_t satisfactionQ16 = 0;
  int64_t demandW = 0;
};

ElectricRun runElectricTier(ItemId ore, ItemId ingot, uint16_t oreCount) {
  au::BuildableNetwork net;
  net.enableGrid();
  net.placePole(0, 0, 0);
  const au::GeneratorId g = net.placeBurnerGenerator(1, 0, 0, sv::items::Coal);
  net.insertFuel(g, sv::items::Coal, 10);
  const uint32_t tps =
      sv::smeltTier(sv::SmeltTierId::ElectricSmelter).ticksPerSmelt;
  const int32_t watts =
      sv::smeltTier(sv::SmeltTierId::ElectricSmelter).powerW;
  au::BuildId s = net.placeElectricSmelter(ore, ingot, 1.0f, 0.5f, 0, tps, watts);
  net.sim().feedMachine(s.entity, oreCount);

  ElectricRun r;
  for (uint32_t t = 1; t <= 100000; ++t) {
    net.step();
    if (t == 1) {
      r.satisfactionQ16 = net.networkStats(0).satisfactionQ16;
      r.demandW = net.networkStats(0).demandW;
    }
    if (net.producedCountOf(ingot) >= oreCount) {
      r.ticks = t;
      break;
    }
  }
  r.ingots = net.producedCountOf(ingot);
  return r;
}

}  // namespace

TEST(all_three_tiers_produce_the_same_ingots_at_hand_computed_rates) {
  const uint16_t kOre = 10;

  // PRIMITIVE FURNACE, wood-fired. Hand: 10 x 180 = 1800 ticks = 30.0 s at
  // 60 Hz, burning one fuel tick per progressing tick = 1800 fuel ticks. Wood
  // is 360 fuel ticks a unit, so 5 units exactly, with nothing left over.
  FuelRun furnace =
      runFuelTier(sv::FurnaceTier::Furnace, sv::items::RawIron, sv::items::Wood,
                  kOre, 5);
  CHECK(furnace.ingots == kOre);
  CHECK(furnace.ingotItem == sv::items::Iron);
  CHECK(furnace.ticks == 1800);
  CHECK(furnace.fuelTicksBurned == 1800);
  CHECK(5 * sv::fuelTicksPerUnit(sv::items::Wood) == 1800);

  // COAL SMELTER. Hand: 10 x 60 = 600 ticks = 10.0 s. 600 fuel ticks, and coal
  // is 1440 a unit, so a single unit does the lot with 840 ticks spare.
  FuelRun smelter =
      runFuelTier(sv::FurnaceTier::Smelter, sv::items::RawIron, sv::items::Coal,
                  kOre, 1);
  CHECK(smelter.ingots == kOre);
  CHECK(smelter.ingotItem == sv::items::Iron);
  CHECK(smelter.ticks == 600);
  CHECK(smelter.fuelTicksBurned == 600);
  CHECK(sv::fuelTicksPerUnit(sv::items::Coal) - 600 == 840);

  // ELECTRIC SMELTER. Hand: 10 x 30 = 300 ticks = 5.0 s, at full satisfaction
  // because one 90 kW generator covers a single 30 kW smelter three times over.
  ElectricRun electric =
      runElectricTier(sv::items::RawIron, sv::items::Iron, kOre);
  CHECK(electric.ingots == kOre);
  CHECK(electric.ticks == 300);
  CHECK(electric.satisfactionQ16 == 65536u);
  CHECK(electric.demandW == 30000);

  // SAME OUTPUT, DIFFERENT RATES. That is the whole ladder in one assertion.
  CHECK(furnace.ingots == smelter.ingots);
  CHECK(static_cast<uint64_t>(smelter.ingots) == electric.ingots);
  CHECK(furnace.ticks == 6 * electric.ticks);
  CHECK(smelter.ticks == 2 * electric.ticks);
  std::printf(
      "    ladder: 10 ore -> 10 iron in %u t (%.1f s) furnace, %u t (%.1f s) "
      "smelter, %u t (%.1f s) electric\n",
      furnace.ticks, furnace.ticks / 60.0, smelter.ticks, smelter.ticks / 60.0,
      electric.ticks, electric.ticks / 60.0);

  // Copper takes the same three paths.
  FuelRun cu = runFuelTier(sv::FurnaceTier::Smelter, sv::items::RawCopper,
                           sv::items::Coal, kOre, 1);
  CHECK(cu.ingotItem == sv::items::Copper);
  CHECK(cu.ticks == 600);
  ElectricRun cuE =
      runElectricTier(sv::items::RawCopper, sv::items::Copper, kOre);
  CHECK(cuE.ingots == kOre);
  CHECK(cuE.ticks == 300);
}

TEST(coal_beats_wood_per_unit_and_the_faster_rung_gets_more_smelts_per_unit) {
  // Coal is 4x wood per unit, so it is strictly the better fuel at any rung.
  CHECK(sv::fuelTicksPerUnit(sv::items::Coal) == 1440);
  CHECK(sv::fuelTicksPerUnit(sv::items::Wood) == 360);
  CHECK(sv::fuelTicksPerUnit(sv::items::Coal) ==
        4 * sv::fuelTicksPerUnit(sv::items::Wood));
  CHECK(sv::fuelTicksPerUnit(sv::items::Iron) == 0);  // not a fuel

  // The fuel pool is denominated in TICKS, so a faster rung gets more smelts out
  // of the same unit for free. Hand: 1440 / 180 = 8 on the furnace, 1440 / 60 =
  // 24 on the smelter.
  const uint32_t coal = sv::fuelTicksPerUnit(sv::items::Coal);
  CHECK(coal / sv::ticksPerSmeltFor(sv::FurnaceTier::Furnace) == 8);
  CHECK(coal / sv::ticksPerSmeltFor(sv::FurnaceTier::Smelter) == 24);
  // Wood: 360/180 = 2 and 360/60 = 6.
  const uint32_t wood = sv::fuelTicksPerUnit(sv::items::Wood);
  CHECK(wood / sv::ticksPerSmeltFor(sv::FurnaceTier::Furnace) == 2);
  CHECK(wood / sv::ticksPerSmeltFor(sv::FurnaceTier::Smelter) == 6);

  // Measured, not just divided: one coal unit into a furnace with plenty of ore.
  sv::Furnace f(sv::FurnaceTier::Furnace);
  f.loadOre(sv::items::RawIron, 50);
  f.loadFuel(sv::items::Coal, 1);
  const uint32_t made = f.run(5000);
  CHECK(made == 8);
  CHECK(f.fuelTicks() == 0);
  CHECK(f.outputCount() == 8);
  CHECK(f.oreCount() == 42);  // ore left over: it ran out of FUEL, not of ore
}

TEST(a_fuel_rung_stalls_without_fuel_and_a_powered_rung_stalls_without_watts) {
  // The two failure modes are the same shape from the player's side (it stopped)
  // but they are different states, and each rung reports its own honestly.
  sv::Furnace f(sv::FurnaceTier::Smelter);
  f.loadOre(sv::items::RawIron, 5);
  f.run(600);
  CHECK(f.outputCount() == 0);   // no fuel was ever loaded
  CHECK(!f.hasFuel());
  CHECK(!f.smelting());
  CHECK(f.oreCount() == 5);      // and nothing was consumed
  f.loadFuel(sv::items::Coal, 1);
  CHECK(f.run(300) == 5);        // 5 x 60 = 300 ticks

  // The powered rung with a generator that has no coal: satisfaction 0, and the
  // machine makes no progress at all rather than crawling.
  au::BuildableNetwork net;
  net.enableGrid();
  net.placePole(0, 0, 0);
  net.placeBurnerGenerator(1, 0, 0, sv::items::Coal);  // deliberately unfuelled
  au::BuildId s = net.placeElectricSmelter(sv::items::RawIron, sv::items::Iron,
                                           1.0f, 0.5f, 0);
  net.sim().feedMachine(s.entity, 5);
  net.stepN(600);
  CHECK(net.networkStats(0).satisfactionQ16 == 0u);
  CHECK(net.networkStats(0).capacityW == 0);
  CHECK(net.producedCountOf(sv::items::Iron) == 0u);
  CHECK(net.satisfactionQ16Of(s) == 0u);

  // And a smelter that no pole reaches is a THIRD, distinguishable state: it is
  // not short of power, it is not connected to any.
  au::BuildableNetwork off;
  off.enableGrid();
  off.placePole(0, 0, 0);
  const au::GeneratorId g = off.placeBurnerGenerator(1, 0, 0, sv::items::Coal);
  off.insertFuel(g, sv::items::Coal, 5);
  au::BuildId far = off.placeElectricSmelter(sv::items::RawIron, sv::items::Iron,
                                             40.0f, 0, 0);
  off.sim().feedMachine(far.entity, 5);
  off.stepN(600);
  CHECK(off.networkOfBuild(far) == pw::kNoNetwork);
  CHECK(off.satisfactionQ16Of(far) == 0u);
  CHECK(off.producedCountOf(sv::items::Iron) == 0u);
  // The far smelter's draw never reached the network it is not on.
  CHECK(off.networkStats(0).demandW == 0);
}

TEST(the_electric_recipe_is_the_same_conversion_authored_against_a_faster_rung) {
  // One conversion, three machines: the recipe id and the item pair never
  // change, only the machine type, the tick cost and the watts. This is what
  // stops a third rung from arriving as a third recipe id for iron.
  const RecipeDef furnace =
      sv::makeSmeltRecipeFor(sv::SmeltTierId::PrimitiveFurnace, sv::items::RawIron);
  const RecipeDef smelter =
      sv::makeSmeltRecipeFor(sv::SmeltTierId::Smelter, sv::items::RawIron);
  const RecipeDef electric =
      sv::makeSmeltRecipeFor(sv::SmeltTierId::ElectricSmelter, sv::items::RawIron);

  for (const RecipeDef* r : {&furnace, &smelter, &electric}) {
    CHECK(r->recipeId == sv::recipes::SmeltIron);
    CHECK(r->inputItem == sv::items::RawIron);
    CHECK(r->inputCount == 1);
    CHECK(r->outputItem == sv::items::Iron);
    CHECK(r->outputCount == 1);
  }
  CHECK(furnace.timeTicks == 180 && furnace.powerW == 0);
  CHECK(smelter.timeTicks == 60 && smelter.powerW == 0);
  CHECK(electric.timeTicks == 30 && electric.powerW == 30000);
  CHECK(furnace.machineTypeId == 0x30);
  CHECK(smelter.machineTypeId == 0x31);
  CHECK(electric.machineTypeId == 0x12);

  // Copper likewise, and it keeps its own recipe id.
  const RecipeDef cu =
      sv::makeSmeltRecipeFor(sv::SmeltTierId::ElectricSmelter, sv::items::RawCopper);
  CHECK(cu.recipeId == sv::recipes::SmeltCopper);
  CHECK(cu.inputItem == sv::items::RawCopper);
  CHECK(cu.outputItem == sv::items::Copper);
  CHECK(cu.timeTicks == 30);

  // The shipped registration is unchanged: it still registers the furnace-tier
  // def, with the furnace's 180 ticks and no power draw.
  CHECK(sv::makeSmeltIronRecipe().timeTicks == 180);
  CHECK(sv::makeSmeltIronRecipe().powerW == 0);
  CHECK(sv::makeSmeltIronRecipe().machineTypeId == 0x30);

  // And the executable factory_sim Recipe the powered rung hands to the sim
  // carries the tier's numbers through unchanged.
  const of::factory::Recipe exec = electric.toFactoryRecipe();
  CHECK(exec.craftTimeTicks == 30);
  CHECK(exec.powerW == 30000);
  CHECK(exec.inputItem == sv::items::RawIron);
  CHECK(exec.outputItem == sv::items::Iron);
}

TEST(the_whole_ladder_runs_deterministically) {
  auto run = [](std::vector<uint64_t>& trace) {
    sv::Furnace f(sv::FurnaceTier::Furnace);
    f.loadOre(sv::items::RawIron, 20);
    f.loadFuel(sv::items::Coal, 3);
    au::BuildableNetwork net;
    net.enableGrid();
    net.placePole(0, 0, 0);
    const au::GeneratorId g = net.placeBurnerGenerator(1, 0, 0, sv::items::Coal);
    net.insertFuel(g, sv::items::Coal, 5);
    for (int i = 0; i < 4; ++i) {
      au::BuildId s = net.placeElectricSmelter(
          sv::items::RawIron, sv::items::Iron, 1.0f, 0.4f + 0.1f * i, 0);
      net.sim().feedMachine(s.entity, 100);
    }
    for (uint32_t t = 0; t < 1000; ++t) {
      f.tick();
      net.step();
      trace.push_back(f.outputCount());
      trace.push_back(f.fuelTicks());
      trace.push_back(net.producedCountOf(sv::items::Iron));
      trace.push_back(net.networkStats(0).satisfactionQ16);
    }
  };
  std::vector<uint64_t> a, b;
  run(a);
  run(b);
  CHECK(a.size() == b.size());
  CHECK(a.size() == 4000);
  bool same = a.size() == b.size();
  for (size_t i = 0; same && i < a.size(); ++i)
    if (a[i] != b[i]) same = false;
  CHECK(same);
  // And it actually did something, so the comparison is not vacuous (DW-20).
  CHECK(a[a.size() - 2] > 0);
  CHECK(a[a.size() - 4] > 0);
}
