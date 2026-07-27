// =============================================================================
// test_progression.cpp — the player's own progression (progression.h):
// what they wear, what they are good at, and what they look like.
//
//   1. Armour is DATA: four defs, one per slot, pinned ids in the 0x0070 block
//      that skip the 0x0050..0x006A the vessel part items already own, and node
//      names that are the SAME STRINGS armour_set.glb ships.
//   2. Equipping is a SWAP and it is ALL OR NOTHING: a full pack refuses the
//      exchange and leaves both the body and the pack exactly as they were.
//   3. The suit SUMS reduction, MULTIPLIES encumbrance, and is CAPPED, so no
//      assembly of four pieces can make a player immune.
//   4. Skills are monotonic, level 0 is EXACTLY neutral (which is what makes
//      the layer optional for every existing caller), and the curve is
//      quadratic rather than exponential.
//   5. Appearance survives a save written by a build with a longer palette.
//   6. All of it is deterministic: the same sequence gives the same state.
// =============================================================================
#include <cstdio>

#include "test_framework.h"
#include "of/progression.h"

using namespace of;
using namespace of::gameplay;
namespace prog = of::gameplay::progression;
namespace sitems = of::gameplay::survival::items;

static SliceRegistry makeRegistry() {
  SliceRegistry reg;
  survival::RegisterSurvivalContent(reg);
  prog::RegisterArmour(reg);
  return reg;
}

// =============================================================================
// 1. ARMOUR IS DATA
// =============================================================================
TEST(armour_is_data_with_pinned_ids_and_the_art_lane_node_names) {
  const std::vector<prog::ArmourDef> defs = prog::armourDefs();
  CHECK(defs.size() == prog::kEquipSlotCount);

  CHECK(defs[0].item == prog::items::ArmourHead);
  CHECK(defs[0].item == 0x0070);
  CHECK(defs[1].item == 0x0071);
  CHECK(defs[2].item == 0x0072);
  CHECK(defs[3].item == 0x0073);

  // ONE def per slot, and in slot order, so `defs[k].slot == EquipSlot(k)` is a
  // property a consumer may rely on rather than a coincidence of authoring.
  for (size_t k = 0; k < defs.size(); ++k)
    CHECK(static_cast<size_t>(defs[k].slot) == k);

  // THE ART CONTRACT, verbatim. tools/blender/contracts.json ships these four
  // node names in armour_set.glb and says the names are SLOT names rather than
  // SET names; if either side renames one, this line is where it is caught.
  CHECK(std::string(prog::armourNode(prog::EquipSlot::Head)) == "Armour_Head_LOD0");
  CHECK(std::string(prog::armourNode(prog::EquipSlot::Chest)) == "Armour_Chest_LOD0");
  CHECK(std::string(prog::armourNode(prog::EquipSlot::Legs)) == "Armour_Legs_LOD0");
  CHECK(std::string(prog::armourNode(prog::EquipSlot::Feet)) == "Armour_Feet_LOD0");

  // The 0x0050..0x006A gap is DELIBERATE (GP-31's vessel part items) and this
  // asserts the intent rather than the accident.
  for (const prog::ArmourDef& d : defs) {
    CHECK(d.item >= 0x0070);
    CHECK(d.name[0] != '\0');
    CHECK(!d.cost.inputs.empty());
    CHECK(d.cost.output == d.item);
    CHECK(d.stats.damageReduction > 0.0f);
    CHECK(d.stats.moveSpeedMul > 0.0f);
    CHECK(d.stats.moveSpeedMul <= 1.0f);   // armour never makes you faster
  }
  // The chest is the most valuable piece and the boots the least, which is the
  // ordering every player already expects. Pinned as a RELATION, so a rebalance
  // that inverts it has to be a decision.
  CHECK(defs[1].stats.damageReduction > defs[2].stats.damageReduction);
  CHECK(defs[2].stats.damageReduction > defs[0].stats.damageReduction);
  CHECK(defs[0].stats.damageReduction > defs[3].stats.damageReduction);
}

TEST(armour_registers_additively_and_collides_with_nothing) {
  SliceRegistry reg;
  survival::RegisterSurvivalContent(reg);
  const size_t before = reg.allItems().size();

  CHECK(prog::RegisterArmour(reg));
  CHECK(reg.allItems().size() == before + prog::kEquipSlotCount);
  // Idempotent: a second call adds nothing and says so.
  CHECK(!prog::RegisterArmour(reg));
  CHECK(reg.allItems().size() == before + prog::kEquipSlotCount);

  // Every id in the whole registry is still distinct.
  const std::vector<ItemDef>& all = reg.allItems();
  for (size_t i = 0; i < all.size(); ++i)
    for (size_t j = i + 1; j < all.size(); ++j) CHECK(all[i].id != all[j].id);

  // A worn piece is a THING, not a pile: stackMax 1, so a player cannot carry
  // eleven helmets in one slot and lose track of which one is on their head.
  for (const prog::ArmourDef& d : prog::armourDefs()) {
    const ItemDef* it = reg.item(d.item);
    CHECK(it != nullptr);
    CHECK(it->stackMax == 1);
    CHECK(!it->isBuildable());
  }
  // The survival ids are untouched.
  CHECK(reg.item(sitems::Iron) != nullptr);
  CHECK(reg.item(sitems::Door) != nullptr);
}

// =============================================================================
// 2. EQUIPPING IS A SWAP, AND IT IS ALL OR NOTHING
// =============================================================================
TEST(equipping_moves_the_piece_off_the_pack_and_back) {
  SliceRegistry reg = makeRegistry();
  Inventory inv(reg);
  prog::Equipment eq;

  CHECK(eq.empty());
  // Not in the pack: refused, nothing moves.
  CHECK(!eq.equip(prog::items::ArmourChest, inv));
  CHECK(eq.worn(prog::EquipSlot::Chest) == kNoItem);

  inv.add(prog::items::ArmourChest, 1);
  CHECK(eq.equip(prog::items::ArmourChest, inv));
  CHECK(eq.worn(prog::EquipSlot::Chest) == prog::items::ArmourChest);
  CHECK(inv.count(prog::items::ArmourChest) == 0);   // it is ON you, not IN the pack
  CHECK(!eq.empty());

  // And back.
  CHECK(eq.unequip(prog::EquipSlot::Chest, inv));
  CHECK(eq.worn(prog::EquipSlot::Chest) == kNoItem);
  CHECK(inv.count(prog::items::ArmourChest) == 1);
  // An empty slot refuses rather than silently succeeding.
  CHECK(!eq.unequip(prog::EquipSlot::Chest, inv));

  // A NON-ARMOUR item is refused and is not consumed.
  inv.add(sitems::Iron, 4);
  CHECK(!eq.equip(sitems::Iron, inv));
  CHECK(inv.count(sitems::Iron) == 4);
}

TEST(a_swap_always_has_room_because_the_removed_piece_frees_the_slot) {
  SliceRegistry reg = makeRegistry();
  prog::Equipment eq;

  // THE INTERESTING CASE IS THAT THERE ISN'T ONE, and it is worth pinning
  // rather than leaving as a fact somebody rediscovers. `equip` guards against
  // a displaced piece that will not fit back and puts the new one back if so,
  // and while armour has `stackMax == 1` that guard CANNOT FIRE: taking the
  // incoming piece out empties exactly one slot, which is exactly the room the
  // outgoing piece needs. So a swap in a pack with no free space at all still
  // succeeds, and the assertion below is what tells the next person that the
  // branch above it is defence for a future stackable piece rather than dead
  // code somebody forgot to delete.
  Inventory oneSlot(reg, 1);
  oneSlot.add(prog::items::ArmourHead, 1);
  CHECK(oneSlot.count(prog::items::ArmourHead) == 1);
  CHECK(eq.equip(prog::items::ArmourHead, oneSlot));
  CHECK(eq.worn(prog::EquipSlot::Head) == prog::items::ArmourHead);
  CHECK(oneSlot.count(prog::items::ArmourHead) == 0);

  // Now the pack is empty and the head is covered. Put a second helm in the one
  // slot and swap it in: the worn one comes back into the slot the new one just
  // left, and nothing is destroyed on the way.
  oneSlot.add(prog::items::ArmourHead, 1);
  CHECK(eq.equip(prog::items::ArmourHead, oneSlot));
  CHECK(eq.worn(prog::EquipSlot::Head) == prog::items::ArmourHead);
  CHECK(oneSlot.count(prog::items::ArmourHead) == 1);

  // UNEQUIP is the one that CAN be refused, because it adds without removing.
  // A pack with its only slot taken by something else has nowhere to put a
  // helmet, and the helmet stays on the head rather than evaporating.
  Inventory blocked(reg, 1);
  blocked.add(sitems::Stone, 1);
  prog::Equipment worn;
  Inventory spare(reg);
  spare.add(prog::items::ArmourChest, 1);
  CHECK(worn.equip(prog::items::ArmourChest, spare));
  CHECK(!worn.unequip(prog::EquipSlot::Chest, blocked));
  CHECK(worn.worn(prog::EquipSlot::Chest) == prog::items::ArmourChest);
  CHECK(blocked.count(prog::items::ArmourChest) == 0);
  CHECK(blocked.count(sitems::Stone) == 1);
}

// =============================================================================
// 3. THE SUIT SUMS, MULTIPLIES AND IS CAPPED
// =============================================================================
TEST(a_full_suit_sums_reduction_multiplies_encumbrance_and_is_capped) {
  SliceRegistry reg = makeRegistry();
  Inventory inv(reg);
  prog::Equipment eq;

  const prog::ArmourStats bare = eq.total();
  CHECK(bare.damageReduction == 0.0f);
  CHECK(bare.moveSpeedMul == 1.0f);
  // Nothing worn changes nothing: a 100 damage hit is still 100.
  CHECK(eq.damageAfter(100.0f) == 100.0f);

  float wantSum = 0.0f;
  float wantMul = 1.0f;
  for (const prog::ArmourDef& d : prog::armourDefs()) {
    inv.add(d.item, 1);
    CHECK(eq.equip(d.item, inv));
    wantSum += d.stats.damageReduction;
    wantMul *= d.stats.moveSpeedMul;
  }
  const prog::ArmourStats full = eq.total();
  CHECK_NEAR(full.damageReduction, wantSum, 1e-5f);
  CHECK_NEAR(full.moveSpeedMul, wantMul, 1e-5f);
  CHECK(full.damageReduction <= prog::kMaxDamageReduction);
  // A full set is a real but not decisive cost in speed, and a real but not
  // decisive gain in survivability. Both pinned as BANDS, because the digits
  // will move and the shape of the trade should not.
  CHECK(full.moveSpeedMul > 0.80f);
  CHECK(full.moveSpeedMul < 1.00f);
  CHECK(full.damageReduction > 0.25f);
  CHECK(full.damageReduction < 0.60f);
  CHECK(full.insulationC > 0.0f);

  // The one number a combat model will actually call.
  CHECK_NEAR(eq.damageAfter(100.0f), 100.0f * (1.0f - full.damageReduction), 1e-3f);
  CHECK(eq.damageAfter(100.0f) < 100.0f);
  // NOBODY IS IMMUNE. Even a cap-busting stat table cannot take a hit to zero.
  CHECK(eq.damageAfter(100.0f) >= 100.0f * (1.0f - prog::kMaxDamageReduction));
}

TEST(equipment_round_trips_through_bytes_and_refuses_a_corrupt_row) {
  SliceRegistry reg = makeRegistry();
  Inventory inv(reg);
  prog::Equipment eq;
  inv.add(prog::items::ArmourHead, 1);
  inv.add(prog::items::ArmourFeet, 1);
  CHECK(eq.equip(prog::items::ArmourHead, inv));
  CHECK(eq.equip(prog::items::ArmourFeet, inv));

  const std::array<uint8_t, prog::kEquipSlotCount> bytes = eq.serialize();
  prog::Equipment back;
  back.deserialize(bytes);
  for (size_t k = 0; k < prog::kEquipSlotCount; ++k)
    CHECK(back.worn(static_cast<prog::EquipSlot>(k))
          == eq.worn(static_cast<prog::EquipSlot>(k)));

  // An out-of-range row degrades to empty rather than to an id nothing knows.
  std::array<uint8_t, prog::kEquipSlotCount> bad{200, 0xFF, 0xFF, 0xFF};
  prog::Equipment junk;
  junk.deserialize(bad);
  CHECK(junk.empty());

  // BOOTS ON A HEAD is refused. A hand-edited or migrated save is the only way
  // this arises and it is exactly the way it would otherwise never be noticed.
  std::array<uint8_t, prog::kEquipSlotCount> swapped{3, 0xFF, 0xFF, 0xFF};
  prog::Equipment wrong;
  wrong.deserialize(swapped);
  CHECK(wrong.worn(prog::EquipSlot::Head) == kNoItem);
  CHECK(wrong.empty());
}

// =============================================================================
// 4. SKILLS
// =============================================================================
TEST(skill_curve_is_quadratic_and_level_zero_is_exactly_neutral) {
  CHECK(prog::xpForLevel(0) == 0);
  CHECK(prog::xpForLevel(1) == 100);
  CHECK(prog::xpForLevel(2) == 400);
  CHECK(prog::xpForLevel(10) == 10000);
  // Quadratic, not exponential: the last level costs less than the whole game
  // before it, which is the difference between a skill and a treadmill.
  CHECK(prog::xpForLevel(10) - prog::xpForLevel(9) < prog::xpForLevel(9));

  // THE PROPERTY THAT MAKES THIS LAYER OPTIONAL. A caller that never granted a
  // point gets its old numbers to the bit.
  CHECK(prog::skillMultiplier(0) == 1.0f);
  CHECK(prog::skillMultiplier(10) > prog::skillMultiplier(9));
  CHECK_NEAR(prog::skillMultiplier(10), 1.5f, 1e-6f);
  // Past the cap it clamps rather than running away.
  CHECK(prog::skillMultiplier(200) == prog::skillMultiplier(prog::kMaxSkillLevel));
}

TEST(skills_are_monotonic_and_report_the_levels_a_press_bought) {
  prog::Skills sk;
  CHECK(sk.level(prog::SkillId::Mining) == 0);
  CHECK(sk.xp(prog::SkillId::Mining) == 0);
  CHECK(sk.applyYield(prog::SkillId::Mining, 3) == 3);   // neutral at level 0

  CHECK(sk.addXp(prog::SkillId::Mining, 99) == 0);
  CHECK(sk.level(prog::SkillId::Mining) == 0);
  CHECK(sk.addXp(prog::SkillId::Mining, 1) == 1);        // 100 xp = level 1
  CHECK(sk.level(prog::SkillId::Mining) == 1);
  // One grant may buy several levels, and it SAYS how many.
  CHECK(sk.addXp(prog::SkillId::Mining, 800) == 2);      // 900 xp = level 3
  CHECK(sk.level(prog::SkillId::Mining) == 3);

  // The other four skills are untouched: practice is per verb.
  CHECK(sk.level(prog::SkillId::Forestry) == 0);
  CHECK(sk.level(prog::SkillId::Smelting) == 0);
  CHECK(sk.level(prog::SkillId::Building) == 0);
  CHECK(sk.level(prog::SkillId::Piloting) == 0);

  // Never goes backwards, and never past the cap.
  sk.addXp(prog::SkillId::Mining, 10'000'000);
  CHECK(sk.level(prog::SkillId::Mining) == prog::kMaxSkillLevel);
  CHECK(sk.addXp(prog::SkillId::Mining, 10'000'000) == 0);
  CHECK(sk.level(prog::SkillId::Mining) == prog::kMaxSkillLevel);
  CHECK(sk.progress(prog::SkillId::Mining) == 1.0f);

  // ROUNDING IS DOWN, and it is pinned, because three call sites would round
  // the other way within a month. Level 10 is +50%: 3 becomes 4, not 5.
  CHECK(sk.applyYield(prog::SkillId::Mining, 3) == 4);
  CHECK(sk.applyYield(prog::SkillId::Mining, 10) == 15);
  CHECK(sk.applyYield(prog::SkillId::Mining, 0) == 0);

  // A bar has something honest to draw at every point.
  prog::Skills mid;
  mid.addXp(prog::SkillId::Forestry, 250);
  CHECK(mid.level(prog::SkillId::Forestry) == 1);
  CHECK(mid.progress(prog::SkillId::Forestry) > 0.0f);
  CHECK(mid.progress(prog::SkillId::Forestry) < 1.0f);
}

TEST(skills_round_trip_and_are_deterministic) {
  prog::Skills a, b;
  const uint32_t grants[] = {13, 400, 77, 1200, 5, 90, 3000};
  for (uint32_t g : grants) {
    a.addXp(prog::SkillId::Smelting, g);
    b.addXp(prog::SkillId::Smelting, g);
    a.addXp(prog::SkillId::Building, g / 2);
    b.addXp(prog::SkillId::Building, g / 2);
  }
  for (size_t k = 0; k < prog::kSkillCount; ++k) {
    const prog::SkillId s = static_cast<prog::SkillId>(k);
    CHECK(a.xp(s) == b.xp(s));
    CHECK(a.level(s) == b.level(s));
  }
  prog::Skills c;
  c.restore(a.raw());
  for (size_t k = 0; k < prog::kSkillCount; ++k) {
    const prog::SkillId s = static_cast<prog::SkillId>(k);
    CHECK(c.xp(s) == a.xp(s));
    CHECK(c.level(s) == a.level(s));
  }
  // Every skill has a name, so a menu never draws an empty row.
  for (size_t k = 0; k < prog::kSkillCount; ++k)
    CHECK(prog::skillName(static_cast<prog::SkillId>(k))[0] != '\0');
}

// =============================================================================
// 5. APPEARANCE
// =============================================================================
TEST(appearance_is_five_bytes_of_palette_indices_and_survives_a_bad_save) {
  CHECK(sizeof(prog::Appearance) == 5);
  CHECK(prog::skinTones().size() >= 4);
  CHECK(prog::suitColours().size() >= 4);
  CHECK(prog::visorTints().size() >= 2);

  // The default is legal.
  prog::Appearance def;
  const prog::Appearance ok = prog::sanitise(def);
  CHECK(ok.skin == def.skin);
  CHECK(ok.build == def.build);

  // A save from a build with a longer palette degrades to a LEGAL player rather
  // than to an index the renderer discovers at draw time.
  prog::Appearance wild;
  wild.skin = 250;
  wild.suitPrimary = 99;
  wild.suitSecondary = 200;
  wild.visor = 40;
  wild.build = 77;
  const prog::Appearance fixed = prog::sanitise(wild);
  CHECK(fixed.skin < prog::skinTones().size());
  CHECK(fixed.suitPrimary < prog::suitColours().size());
  CHECK(fixed.suitSecondary < prog::suitColours().size());
  CHECK(fixed.visor < prog::visorTints().size());
  CHECK(fixed.build <= 2);
  // Idempotent: sanitising a legal profile is a no-op, so a load-save-load
  // cycle cannot walk a player's face across the palette.
  const prog::Appearance again = prog::sanitise(fixed);
  CHECK(again.skin == fixed.skin);
  CHECK(again.suitPrimary == fixed.suitPrimary);
  CHECK(again.visor == fixed.visor);
  CHECK(again.build == fixed.build);
}

TEST(a_profile_is_one_object_for_persistence_to_version) {
  SliceRegistry reg = makeRegistry();
  Inventory inv(reg);
  prog::PlayerProfile p;
  inv.add(prog::items::ArmourLegs, 1);
  CHECK(p.equipment.equip(prog::items::ArmourLegs, inv));
  p.skills.addXp(prog::SkillId::Building, 500);
  p.appearance.suitPrimary = 2;

  CHECK(p.equipment.worn(prog::EquipSlot::Legs) == prog::items::ArmourLegs);
  CHECK(p.skills.level(prog::SkillId::Building) == 2);
  CHECK(prog::sanitise(p.appearance).suitPrimary == 2);
  // The whole of the player, outside their pack, is 4 + 20 + 5 bytes of state.
  CHECK(p.equipment.serialize().size() == 4);
  CHECK(p.skills.raw().size() == 5);
}
