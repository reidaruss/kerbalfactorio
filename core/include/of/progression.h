#pragma once
// =============================================================================
// progression.h — the PLAYER's own progression: what they wear, what they are
// good at, and what they look like.
//
// Reid, W11: "Player skills, player customization (appearance), armor and armor
// slots for head chest legs feet."
//
// Additive and header-only, consuming gameplay.h verbatim, exactly as research.h
// does. It is a SEPARATE header rather than a section of gameplay.h for one
// blunt reason recorded here so nobody undoes it later: gameplay.h is edited by
// three lanes at once (survival content, the smelting ladder, the structural
// set) and a fourth simultaneous editor is how commits start sweeping each
// other. A new header also keeps the layering honest: equipment reads the item
// registry, and nothing in the item registry needs to know equipment exists.
//
// THE ART CONTRACT IS ALREADY WRITTEN AND THIS IS ITS MISSING HALF. The art
// lane shipped `assets/models/dist/player/armour_set.glb` with four skinned
// slots and left a note in `tools/blender/contracts.json` saying, correctly,
// "NO REFERENT IN THE HEADLESS HEADERS. gameplay.h has no equipment slots, no
// armour items and no ItemCategory for them: grepping core/include for
// armor|armour|equip returns nothing." This header is that referent, and the
// node names below are the SAME STRINGS the .glb ships, published once here so
// the client looks a slot up rather than typing a mesh name into a switch.
//
// WHAT THIS DELIBERATELY DOES NOT DO. There is no damage model in /core yet:
// the enemies lane is building one tonight. So armour publishes a REDUCTION and
// does not apply it, in the same way `Skills` publishes multipliers that the
// harvest and smelt paths may opt into rather than reaching in and rewriting
// their signatures. A layer that silently changed the numbers under twenty
// pinned tests would be a worse gift than one that hands out an interface.
// =============================================================================

#include <array>
#include <cstdint>
#include <string>
#include <vector>

#include "of/gameplay.h"

namespace of {
namespace gameplay {
namespace progression {

using survival::CraftRecipe;
using survival::HandCrafter;

// =============================================================================
// §E — EQUIPMENT: four slots, and the art nodes they bind to.
// =============================================================================

enum class EquipSlot : uint8_t { Head = 0, Chest = 1, Legs = 2, Feet = 3 };
inline constexpr size_t kEquipSlotCount = 4;

/** The mesh node an equipped piece is drawn as, from `armour_set.glb`.
 *
 *  THE NODE NAMES ARE SLOT NAMES, NOT SET NAMES, which is the art lane's own
 *  design and the reason this is a pure function of the slot: a second armour
 *  set is a second .glb carrying the same four node names, so swapping a set is
 *  swapping a file and nothing here moves. */
inline const char* armourNode(EquipSlot s) {
  switch (s) {
    case EquipSlot::Head: return "Armour_Head_LOD0";
    case EquipSlot::Chest: return "Armour_Chest_LOD0";
    case EquipSlot::Legs: return "Armour_Legs_LOD0";
    case EquipSlot::Feet: return "Armour_Feet_LOD0";
  }
  return "";
}

inline const char* slotName(EquipSlot s) {
  switch (s) {
    case EquipSlot::Head: return "Head";
    case EquipSlot::Chest: return "Chest";
    case EquipSlot::Legs: return "Legs";
    case EquipSlot::Feet: return "Feet";
  }
  return "";
}

/** What a worn piece is worth.
 *
 *  `damageReduction` is a FRACTION of incoming damage removed, and the four
 *  slots SUM rather than multiply, capped below, because a player should be
 *  able to read "chest is worth twice what boots are worth" off the table.
 *  `moveSpeedMul` is the price: plate is heavy, and armour with no cost is not
 *  a choice. `insulation` is a placeholder with a real unit (degrees C of cold
 *  a suit holds off) rather than an abstract point, so that whichever lane
 *  builds environment hazards inherits a number instead of a name. */
struct ArmourStats {
  float damageReduction = 0.0f;
  float moveSpeedMul = 1.0f;
  float insulationC = 0.0f;
};

/** No suit may remove more than this share of a hit, however it is assembled.
 *  Immunity is not a build, it is a bug that takes a week to find. */
inline constexpr float kMaxDamageReduction = 0.80f;

// --- ARMOUR ItemId BLOCK: 0x0070+ --------------------------------------------
// NOT 0x0044, and NOT 0x0050. The survival block runs to 0x0043 (the structural
// door), and 0x0050..0x006A is ALREADY SPOKEN FOR by the vessel parts' item
// forms: GP-31 allocated it as the pure function `ItemId = 0x0050 + (PartId -
// 0x0100)` and it currently lives in `web/wasm/of_vessel_api.inc` because that
// lane could not touch /core. It is due to be promoted into a header the next
// time /core is opened, and minting armour on top of it would turn a scheduled
// promotion into a renumbering of saved worlds. Leaving the gap costs nothing:
// an ItemId is opaque (GP-13) and there is no arithmetic over it anywhere.
namespace items {
static constexpr ItemId ArmourHead = 0x0070;
static constexpr ItemId ArmourChest = 0x0071;
static constexpr ItemId ArmourLegs = 0x0072;
static constexpr ItemId ArmourFeet = 0x0073;
}  // namespace items

struct ArmourDef {
  ItemId item = kNoItem;
  EquipSlot slot = EquipSlot::Head;
  const char* name = "";
  ArmourStats stats;
  CraftRecipe cost;
};

/** The tier-1 set: iron plate over a work suit, hand-crafted from the pack.
 *
 *  The chest is worth the most and the head next, which is the ordering every
 *  player already expects; the encumbrance is spread so that a full set costs
 *  **10.6% of walking speed** (0.99 * 0.95 * 0.97 * 0.98 = 0.8940393), which is
 *  felt without being a punishment. Costs are in the same Iron and Wood the
 *  structural set spends, so armour competes with a base for the same ingots,
 *  which is the whole point of a cost.
 *
 *  GP-52, and it is worth the line because of HOW it was caught. This comment
 *  and GP-42 both said "0.892 / 12%", which is a TRANSCRIPTION of the table
 *  below that drifted from it; the table was always right. `probes/equip.js`
 *  found it by equipping one piece at a time, differencing, and asserting that
 *  the suit's encumbrance is the PRODUCT of the pieces and its reduction the
 *  SUM. Asserting the published constant instead would have meant tuning the
 *  constant until it passed, which is standing rule 11's exact failure. The
 *  property assertion stays; the published number is what moves. */
inline std::vector<ArmourDef> armourDefs() {
  using survival::items::Iron;
  using survival::items::Wood;
  return {
      ArmourDef{items::ArmourHead, EquipSlot::Head, "Iron helm",
                ArmourStats{0.08f, 0.99f, 2.0f},
                CraftRecipe{items::ArmourHead, 1,
                            {ItemStack{Iron, 6}, ItemStack{Wood, 2}}}},
      ArmourDef{items::ArmourChest, EquipSlot::Chest, "Iron cuirass",
                ArmourStats{0.16f, 0.95f, 5.0f},
                CraftRecipe{items::ArmourChest, 1,
                            {ItemStack{Iron, 14}, ItemStack{Wood, 4}}}},
      ArmourDef{items::ArmourLegs, EquipSlot::Legs, "Iron greaves",
                ArmourStats{0.10f, 0.97f, 3.0f},
                CraftRecipe{items::ArmourLegs, 1,
                            {ItemStack{Iron, 10}, ItemStack{Wood, 3}}}},
      ArmourDef{items::ArmourFeet, EquipSlot::Feet, "Iron boots",
                ArmourStats{0.06f, 0.98f, 2.0f},
                CraftRecipe{items::ArmourFeet, 1,
                            {ItemStack{Iron, 5}, ItemStack{Wood, 2}}}},
  };
}

/** The four armour pieces as HAND RECIPES, so the craft menu offers them the
 *  same way it offers a pickaxe and nothing transcribes a cost twice. The list
 *  is derived from `armourDefs()` rather than authored beside it, which is the
 *  whole reason `ArmourDef::cost` is a `CraftRecipe` and not a loose vector. */
inline std::vector<CraftRecipe> armourRecipes() {
  std::vector<CraftRecipe> out;
  for (const ArmourDef& d : armourDefs()) out.push_back(d.cost);
  return out;
}

inline const ArmourDef* armourFor(ItemId item) {
  static const std::vector<ArmourDef> defs = armourDefs();
  for (const ArmourDef& d : defs)
    if (d.item == item) return &d;
  return nullptr;
}

/** Register the armour items additively, exactly as the survival and science
 *  layers do. Idempotent, because `SliceRegistry::registerItem` refuses a
 *  duplicate id and every call site here reports whether it took. */
inline bool RegisterArmour(SliceRegistry& reg) {
  bool any = false;
  for (const ArmourDef& d : armourDefs()) {
    ItemDef def;
    def.id = d.item;
    def.displayName = d.name;
    def.category = ItemCategory::Part;
    def.stackMax = 1;   // a worn piece is a THING, not a pile
    def.flags = kFlagNone;
    def.placesEntityTypeId = kNoType;
    any = reg.registerItem(def) || any;
  }
  return any;
}

/**
 * What the player is wearing. Four slots, each holding one ItemId or nothing.
 *
 * EQUIPPING IS A SWAP, AND IT IS ALL OR NOTHING. `equip` takes the piece out of
 * the pack and puts whatever was in that slot back into it, and if the pack
 * cannot take the displaced piece the whole exchange is refused and NOTHING
 * moves. The alternative, dropping the old piece on the floor, needs a world to
 * drop it into and this header has none; refusing is the answer a headless
 * layer can give honestly.
 *
 * THAT REFUSAL CANNOT CURRENTLY FIRE, and the test says so out loud rather than
 * leaving it as a fact somebody rediscovers with a debugger. Armour stacks to
 * one, so taking the incoming piece out empties exactly one slot, which is
 * exactly the room the outgoing piece needs. The branch is defence for a future
 * stackable piece, not dead code; `unequip` is the direction that genuinely can
 * be refused, because it adds without removing.
 */
class Equipment {
 public:
  ItemId worn(EquipSlot s) const { return slots_[static_cast<size_t>(s)]; }
  bool empty() const {
    for (ItemId i : slots_)
      if (i != kNoItem) return false;
    return true;
  }

  /** Move `item` from `inv` onto the body. Returns false and changes nothing if
   *  the item is not armour, is not in the pack, or the displaced piece would
   *  not fit back. */
  bool equip(ItemId item, Inventory& inv) {
    const ArmourDef* d = armourFor(item);
    if (d == nullptr || inv.count(item) < 1) return false;
    const size_t k = static_cast<size_t>(d->slot);
    const ItemId old = slots_[k];
    if (inv.remove(item, 1) != 1) return false;
    if (old != kNoItem && inv.add(old, 1) != 0) {
      inv.add(item, 1);   // put it back; the pack was full for the swap
      return false;
    }
    slots_[k] = item;
    return true;
  }

  /** Take a slot's piece back into the pack. False (and no change) if the slot
   *  is empty or the pack is full. */
  bool unequip(EquipSlot s, Inventory& inv) {
    const size_t k = static_cast<size_t>(s);
    if (slots_[k] == kNoItem) return false;
    if (inv.add(slots_[k], 1) != 0) return false;
    slots_[k] = kNoItem;
    return true;
  }

  /** The suit as one number set. Reduction SUMS and is capped; the speed
   *  penalties MULTIPLY, because they are independent drags on the same walk. */
  ArmourStats total() const {
    ArmourStats out{0.0f, 1.0f, 0.0f};
    for (ItemId i : slots_) {
      const ArmourDef* d = armourFor(i);
      if (d == nullptr) continue;
      out.damageReduction += d->stats.damageReduction;
      out.moveSpeedMul *= d->stats.moveSpeedMul;
      out.insulationC += d->stats.insulationC;
    }
    if (out.damageReduction > kMaxDamageReduction)
      out.damageReduction = kMaxDamageReduction;
    return out;
  }

  /** THE INTERFACE THE ENEMIES LANE ASKED FOR WITHOUT KNOWING IT. Damage after
   *  the suit, so a combat model consumes one call rather than re-deriving the
   *  cap and the summation and getting a different answer. */
  float damageAfter(float raw) const { return raw * (1.0f - total().damageReduction); }

  /** Five bytes: four worn ids as slot INDICES into `armourDefs()` plus a
   *  sentinel. Deliberately not the raw ItemIds: a save that carried ids would
   *  have to be migrated the day an id moves, and this is a fixed four-entry
   *  table. 0xFF is empty. */
  std::array<uint8_t, kEquipSlotCount> serialize() const {
    std::array<uint8_t, kEquipSlotCount> out{};
    const std::vector<ArmourDef> defs = armourDefs();
    for (size_t k = 0; k < kEquipSlotCount; ++k) {
      out[k] = 0xFF;
      for (size_t j = 0; j < defs.size(); ++j)
        if (defs[j].item == slots_[k]) out[k] = static_cast<uint8_t>(j);
    }
    return out;
  }

  void deserialize(const std::array<uint8_t, kEquipSlotCount>& in) {
    const std::vector<ArmourDef> defs = armourDefs();
    for (size_t k = 0; k < kEquipSlotCount; ++k) {
      slots_[k] = kNoItem;
      if (in[k] >= defs.size()) continue;
      const ArmourDef& d = defs[in[k]];
      // A row is only accepted into the slot it BELONGS to, so a corrupt or
      // hand-edited save cannot put boots on a head.
      if (static_cast<size_t>(d.slot) == k) slots_[k] = d.item;
    }
  }

 private:
  std::array<ItemId, kEquipSlotCount> slots_{kNoItem, kNoItem, kNoItem, kNoItem};
};

// =============================================================================
// §K — SKILLS: five verbs the game already has, and what practising them buys.
// =============================================================================

/** One per verb the player ALREADY performs, and deliberately not one more.
 *  A skill with no action behind it is a line in a menu. */
enum class SkillId : uint8_t {
  Mining = 0,    // swinging at rock, ore and coal
  Forestry = 1,  // felling trees
  Smelting = 2,  // running a furnace or a smelter
  Building = 3,  // placing structural parts and machines
  Piloting = 4,  // flying, for when the vessel lane lands
};
inline constexpr size_t kSkillCount = 5;
inline constexpr uint8_t kMaxSkillLevel = 10;

inline const char* skillName(SkillId s) {
  switch (s) {
    case SkillId::Mining: return "Mining";
    case SkillId::Forestry: return "Forestry";
    case SkillId::Smelting: return "Smelting";
    case SkillId::Building: return "Building";
    case SkillId::Piloting: return "Piloting";
  }
  return "";
}

/** Total experience to REACH level n, quadratic: 100 * n^2.
 *
 *  Quadratic and not exponential on purpose. An exponential curve means the
 *  last level costs more than the whole game before it, which is a treadmill,
 *  and this project's own progression spine is the tech tree rather than a
 *  level bar. Level 10 is 10,000 xp against level 1's 100. */
inline uint32_t xpForLevel(uint8_t level) {
  return level == 0 ? 0u : 100u * static_cast<uint32_t>(level) * level;
}

/** What a level is worth, as a multiplier on the skill's own verb.
 *
 *  +5% per level, so level 10 is +50% and level 0 is exactly 1.0. Level 0
 *  being exactly neutral is what makes this layer optional: a caller that has
 *  never granted a point gets the numbers it has always had, to the bit. */
inline float skillMultiplier(uint8_t level) {
  return 1.0f + 0.05f * static_cast<float>(level > kMaxSkillLevel ? kMaxSkillLevel
                                                                 : level);
}

/**
 * The player's practice. Monotonic: experience only ever goes up, and a level
 * once earned is never lost, which is the same discipline `ResearchState` has
 * for unlocks and for the same reason (a progression that can go backwards
 * needs a rule for what happens to everything it gated).
 */
class Skills {
 public:
  /** Grant experience. Returns how many levels that press bought, so a caller
   *  can put a message on screen without diffing two reports. */
  uint8_t addXp(SkillId s, uint32_t n) {
    const size_t k = static_cast<size_t>(s);
    const uint8_t was = level(s);
    xp_[k] += n;
    return static_cast<uint8_t>(level(s) - was);
  }

  uint32_t xp(SkillId s) const { return xp_[static_cast<size_t>(s)]; }

  uint8_t level(SkillId s) const {
    const uint32_t have = xp_[static_cast<size_t>(s)];
    uint8_t lv = 0;
    while (lv < kMaxSkillLevel && have >= xpForLevel(static_cast<uint8_t>(lv + 1)))
      ++lv;
    return lv;
  }

  /** Progress through the CURRENT level, 0 to 1. What a bar draws. */
  float progress(SkillId s) const {
    const uint8_t lv = level(s);
    if (lv >= kMaxSkillLevel) return 1.0f;
    const uint32_t lo = xpForLevel(lv), hi = xpForLevel(static_cast<uint8_t>(lv + 1));
    if (hi <= lo) return 1.0f;
    return static_cast<float>(xp(s) - lo) / static_cast<float>(hi - lo);
  }

  float multiplier(SkillId s) const { return skillMultiplier(level(s)); }

  /** Apply a skill to an integer yield, rounding DOWN. The rounding is the
   *  whole reason this is a published call and not `int(n * mul)` at four call
   *  sites: three of them would round the other way within a month. */
  uint32_t applyYield(SkillId s, uint32_t base) const {
    return static_cast<uint32_t>(static_cast<float>(base) * multiplier(s));
  }

  const std::array<uint32_t, kSkillCount>& raw() const { return xp_; }
  void restore(const std::array<uint32_t, kSkillCount>& in) { xp_ = in; }

 private:
  std::array<uint32_t, kSkillCount> xp_{0, 0, 0, 0, 0};
};

// =============================================================================
// §A — APPEARANCE: five bytes, and two palettes nobody else may retype.
// =============================================================================

/** RGB, 0 to 255, so this is exactly what a material wants and nothing has to
 *  guess a colour space. */
struct Rgb {
  uint8_t r = 0, g = 0, b = 0;
};

/** The choices, as PALETTE INDICES rather than free colour.
 *
 *  A fixed palette is five bytes in a save, is trivially validated, cannot
 *  produce an invisible player against the terrain, and gives the art lane a
 *  finite set of combinations to actually look at. Free RGB is twelve bytes,
 *  needs clamping rules nobody writes, and its most likely use is a player who
 *  makes themselves the exact grey of the rock they are standing on. */
struct Appearance {
  uint8_t skin = 0;
  uint8_t suitPrimary = 0;
  uint8_t suitSecondary = 0;
  uint8_t visor = 0;
  /** 0 slight, 1 average, 2 heavy. A shape, not a colour, and it is a byte
   *  here because the rig is one skeleton: the client scales, it does not
   *  reshape. */
  uint8_t build = 1;
};

inline const std::vector<Rgb>& skinTones() {
  static const std::vector<Rgb> v = {
      {242, 209, 184}, {224, 180, 148}, {198, 148, 112}, {160, 110, 78},
      {118, 78, 54},   {82, 54, 40},    {214, 196, 190}, {166, 176, 168}};
  return v;
}

inline const std::vector<Rgb>& suitColours() {
  static const std::vector<Rgb> v = {
      {236, 118, 34},  {228, 196, 60}, {70, 132, 196}, {64, 160, 108},
      {186, 62, 58},   {150, 152, 158}, {58, 62, 70},  {236, 236, 232}};
  return v;
}

inline const std::vector<Rgb>& visorTints() {
  static const std::vector<Rgb> v = {
      {58, 74, 92}, {40, 40, 46}, {150, 120, 40}, {70, 130, 120}};
  return v;
}

/** Clamp every field into its own palette. Called on load, so a save written by
 *  an older build with a longer palette degrades to a legal player rather than
 *  to an out-of-range index the renderer discovers at draw time. */
inline Appearance sanitise(Appearance a) {
  a.skin = static_cast<uint8_t>(a.skin % skinTones().size());
  a.suitPrimary = static_cast<uint8_t>(a.suitPrimary % suitColours().size());
  a.suitSecondary = static_cast<uint8_t>(a.suitSecondary % suitColours().size());
  a.visor = static_cast<uint8_t>(a.visor % visorTints().size());
  if (a.build > 2) a.build = 1;
  return a;
}

/** Everything about the player that is not their inventory, in one object, so
 *  persistence has ONE thing to serialise and one thing to version. */
struct PlayerProfile {
  Equipment equipment;
  Skills skills;
  Appearance appearance;
};

}  // namespace progression
}  // namespace gameplay
}  // namespace of
