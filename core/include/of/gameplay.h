#pragma once
// =============================================================================
// gameplay.h — Wave-0 headless gameplay-logic core (Phase-1 "First Foundry").
//
// The player-facing *rules* of the vertical slice that need no rendering. This
// is gameplay's thin, data-driven layer over the closed sim substrate — it
// owns rules, content, and player state; it never produces sim numbers
// (factory-sim / world-gen / physics do) and never renders.
//
// Implements the PINNED Phase-1 design (docs/phase1/gameplay-phase1.md §7–§8):
//   §A  Item registry  — ItemId (uint16, opaque, hand-assigned stable, C-3/GP-13)
//                        + FItemDef + the slice content table (12 items, 5
//                        recipes, 7 entity defs: ids 0x0001…/0x0101…/0x10…).
//   §B  Inventory      — fixed-slot, add/remove/stack honoring StackMax (GP-9).
//   §C  Mining         — extract from a deposit node (Resource ItemId + remaining
//                        + grade): grant items, decrement remaining, stop at 0.
//   §D  Build/place    — validate a build intent (deposit-for-miner, slope via
//                        terrain normal, inventory cost) → place into the factory
//                        sim + deduct cost (IFactoryBuildIntent, §3.4).
//   §E  Recipe I/O     — smelt/assemble consume inputs → produce outputs, driven
//                        through the factory-sim recipe model (§7.2).
//   §F  Objective FSM  — the linear slice objective chain (§6): mine → smelt →
//                        assemble → power → fly → land/mine off-world, advancing
//                        as each step's predicate (read from inventory/factory/
//                        world state) is satisfied. Terminal step = "land a
//                        working automated outpost on the moon".
//
// Header-only. Consumes ONLY the green Wave-0 cores: of::factory::FactorySim
// (recipes/machines/producedCount), of::worldgen (SampleTerrainHeight + body
// params for slope), of::Vec3 / of::UniverseCoord. No UE, no rendering.
//
// ItemId is the SINGLE id space (C-3): the same uint16 identifies an item in the
// player's pack, a smelter's slot (factory-sim ItemId == this ItemId, both
// uint16), a deposit's mined product (FDepositNode.Resource), and on disk. We
// reuse of::factory::ItemId verbatim so the two never drift.
// =============================================================================
#include <cstdint>
#include <vector>
#include <array>
#include <string>
#include <cmath>

#include "of/vec3.h"
#include "of/universe_coord.h"
#include "of/factory_sim.h"
#include "of/cubed_sphere.h"
#include "of/deposits.h"

namespace of {
namespace gameplay {

// =============================================================================
// §A — Item registry: ItemId, FItemDef, and the slice content tables (C-3).
// =============================================================================

// The SINGLE id space (C-3 / GP-13). uint16, opaque, hand-assigned, stable.
// Reuse factory-sim's width verbatim so a player-pack item and a machine-slot
// item are the same key — no per-domain item space, no remap table.
using ItemId = of::factory::ItemId;          // uint16_t
static constexpr ItemId kNoItem = of::factory::kNoItem;  // 0 = the null item

// Entity-class id (factory-sim's FFactoryEntityState.TypeId space). Buildables
// map 1:1 to these via FItemDef.PlacesEntityTypeId.
using TypeId = uint16_t;
static constexpr TypeId kNoType = 0;

// A recipe id (factory-sim's executable recipeId space, §7.2).
using RecipeId = uint16_t;
static constexpr RecipeId kNoRecipe = 0;

// A stable deposit id (world-gen's FDepositNode key; C-1). 0 = none.
// GAP-1: this IS world-gen's FDepositNode::Id type (a shared `using`, not a
// parallel narrower type) — a uint64 deposit key carries verbatim from the
// catalog through gameplay mining and into the persistence depletion diff, with
// NO truncating bridge. Unifying the id width is what lets gameplay consume a
// worldgen::FDepositNode directly (see the mineDeposit overload below).
using DepositId = worldgen::DepositId;            // uint64_t (was a narrower uint32)
static constexpr DepositId kNoDeposit = 0;

// Item category — HUD grouping / filters (§7.1).
enum class ItemCategory : uint8_t {
  None = 0,
  Ore,
  Material,
  Part,
  Fuel,
  Buildable,
};

// Item-def flag bits (§8.C). Opaque to consumers except as named here.
enum ItemFlags : uint8_t {
  kFlagNone = 0,
  kFlagBuildable = 1 << 0,
  kFlagFuel = 1 << 1,
  kFlagOffWorldOnly = 1 << 2,  // Cinderite — only on Cinder (P1-D4 identity hook)
};

// --- The shared item stack (§4.1, §7.1). 4 B: {ItemId u16, Count u16}. --------
struct ItemStack {
  ItemId item = kNoItem;
  uint16_t count = 0;

  bool empty() const { return item == kNoItem || count == 0; }
};

// --- FItemDef (§8.C): one row of the gameplay-authored item registry. ---------
struct ItemDef {
  ItemId id = kNoItem;
  std::string displayName;
  ItemCategory category = ItemCategory::None;
  uint16_t stackMax = 1;
  uint8_t flags = kFlagNone;
  // Buildable items only: the FEntityDef.TypeId this item places (0 = none).
  TypeId placesEntityTypeId = kNoType;

  bool isBuildable() const { return (flags & kFlagBuildable) != 0; }
};

// --- Canonical ItemId block (PINNED §7.1). Stable, append-only, never reused. -
namespace items {
static constexpr ItemId FerriteOre = 0x0001;    // base ore (Forge)
static constexpr ItemId FerritePlate = 0x0002;  // intermediate (smelter)
static constexpr ItemId FramePart = 0x0003;     // slice target output (step 4)
static constexpr ItemId Cinderite = 0x0004;     // off-world identity hook (Cinder)
static constexpr ItemId Combustite = 0x0005;    // fuel (feeds the generator)
static constexpr ItemId Miner = 0x0010;         // buildable item forms ↓
static constexpr ItemId Belt = 0x0011;
static constexpr ItemId Smelter = 0x0012;
static constexpr ItemId Assembler = 0x0013;
static constexpr ItemId Box = 0x0014;
static constexpr ItemId Generator = 0x0015;
static constexpr ItemId PowerPole = 0x0016;
}  // namespace items

// --- Canonical entity TypeId block (PINNED §7.3). 1:1 with buildable items. ---
namespace types {
static constexpr TypeId Miner = 0x10;
static constexpr TypeId Belt = 0x11;
static constexpr TypeId Smelter = 0x12;
static constexpr TypeId Assembler = 0x13;
static constexpr TypeId Box = 0x14;
static constexpr TypeId Generator = 0x15;
static constexpr TypeId PowerPole = 0x16;
}  // namespace types

// --- Canonical RecipeId block (PINNED §7.2). ---------------------------------
namespace recipes {
static constexpr RecipeId SmeltFerrite = 0x0101;   // 1 ore -> 1 plate (smelter)
static constexpr RecipeId AssembleFrame = 0x0102;  // 2 plate -> 1 part (assembler)
static constexpr RecipeId MineFerrite = 0x0103;    // deposit Ferrite -> ore (miner)
static constexpr RecipeId MineCinderite = 0x0104;  // deposit Cinderite -> ore (miner)
static constexpr RecipeId BurnCombustite = 0x0105; // 1 fuel -> power (generator)
}  // namespace recipes

// --- FRecipeDef (§8.B): gameplay-authored content against factory-sim's shape.
// Single-input/single-output is the factory-sim Recipe shape; Assemble Frame
// needs 2× plate, modeled as inputCount=2 (the sim's Recipe.inputCount).
struct RecipeDef {
  RecipeId recipeId = kNoRecipe;
  TypeId machineTypeId = kNoType;  // which machine class can run it
  ItemId inputItem = kNoItem;
  uint16_t inputCount = 1;
  ItemId outputItem = kNoItem;
  uint16_t outputCount = 1;
  uint32_t timeTicks = 60;
  int32_t powerW = 1000;

  // Translate to the factory-sim executable Recipe (§E drives the sim with this).
  of::factory::Recipe toFactoryRecipe() const {
    of::factory::Recipe r;
    r.inputItem = inputItem;
    r.inputCount = inputCount;
    r.outputItem = outputItem;
    r.outputCount = outputCount;
    r.craftTimeTicks = timeTicks;
    r.powerW = powerW;
    return r;
  }
};

// --- A port on a placeable (for §3.3 legibility; kind is opaque to logic). ----
enum class PortKind : uint8_t { Input = 0, Output = 1, PowerIn = 2, PowerOut = 3, PowerLink = 4 };

// --- FEntityDef (§8.B, §7.3): gameplay-authored placeable definition. ---------
// Superset of factory-sim's executable def (C-2): BuildCost + SlopeToleranceRad
// are gameplay-only (sim-ignored); TypeId + ports are shared.
struct EntityDef {
  TypeId typeId = kNoType;
  ItemStack buildCost;              // inventory cost consumed on placement
  float slopeToleranceRad = 0.5f;   // §3.2 validity (radians)
  bool requiresDeposit = false;     // miner: footprint must overlap a deposit (§2.2)
  RecipeId defaultRecipe = kNoRecipe;  // smelter/generator fixed; assembler set via intent
  uint8_t inputPorts = 0;
  uint8_t outputPorts = 0;
  bool hasPower = false;            // draws/links the power network
};

// =============================================================================
// §A.2 — The slice registry: the 12 items / 5 recipes / 7 entity defs as DATA.
//
// Built once (a curated array, not a DataTable file in the headless harness).
// Gameplay OWNS the content; factory-sim loads stack caps + executes recipes.
// =============================================================================
class SliceRegistry {
 public:
  SliceRegistry() {
    buildItems();
    buildRecipes();
    buildEntities();
  }

  // ---- Item lookup ---------------------------------------------------------
  const ItemDef* item(ItemId id) const {
    for (const ItemDef& d : items_)
      if (d.id == id) return &d;
    return nullptr;
  }
  uint16_t stackMax(ItemId id) const {
    const ItemDef* d = item(id);
    return d ? d->stackMax : 1;
  }
  const std::vector<ItemDef>& allItems() const { return items_; }

  // ---- Recipe lookup -------------------------------------------------------
  const RecipeDef* recipe(RecipeId id) const {
    for (const RecipeDef& r : recipes_)
      if (r.recipeId == id) return &r;
    return nullptr;
  }
  const std::vector<RecipeDef>& allRecipes() const { return recipes_; }

  // ---- Entity lookup -------------------------------------------------------
  const EntityDef* entity(TypeId id) const {
    for (const EntityDef& e : entities_)
      if (e.typeId == id) return &e;
    return nullptr;
  }
  const std::vector<EntityDef>& allEntities() const { return entities_; }

  // Resolve "select build item -> ghost which entity" via the §7.1 cross-link.
  TypeId entityForItem(ItemId id) const {
    const ItemDef* d = item(id);
    return d ? d->placesEntityTypeId : kNoType;
  }

  // --- Extension point (additive) -------------------------------------------
  // Register an item def that lives outside the pinned playable-slice block —
  // e.g. the Phase-2 research-layer science packs (research.h), which append in
  // the same opaque ItemId space (C-3) at 0x0020+. Keeps the pinned §7.1 table
  // untouched while letting later content reuse the registry/Inventory plumbing
  // (stack caps, lookups). Returns false if the id is already registered.
  bool registerItem(const ItemDef& def) {
    if (item(def.id) != nullptr) return false;  // never reuse/override an id
    items_.push_back(def);
    return true;
  }

  // Register a recipe def outside the pinned slice block — the research layer's
  // SCIENCE recipes (research.h), which turn intermediates/off-world ore into
  // science packs (e.g. Ferrite plate → AutomationScience, Cinderite →
  // CinderScience). Same discipline as registerItem: append-only in the shared
  // RecipeId space, never reuse/override an id. Returns false if already present.
  // (GAP-3 — the off-world science chain is authored as data, GP-12.)
  bool registerRecipe(const RecipeDef& def) {
    if (recipe(def.recipeId) != nullptr) return false;
    recipes_.push_back(def);
    return true;
  }

 private:
  std::vector<ItemDef> items_;
  std::vector<RecipeDef> recipes_;
  std::vector<EntityDef> entities_;

  static ItemDef mkItem(ItemId id, const char* name, ItemCategory cat,
                        uint16_t stackMax, uint8_t flags, TypeId places) {
    ItemDef d;
    d.id = id;
    d.displayName = name;
    d.category = cat;
    d.stackMax = stackMax;
    d.flags = flags;
    d.placesEntityTypeId = places;
    return d;
  }

  void buildItems() {
    using namespace items;
    items_ = {
        // resources / intermediates
        mkItem(FerriteOre, "Ferrite ore", ItemCategory::Ore, 100, kFlagNone, kNoType),
        mkItem(FerritePlate, "Ferrite plate", ItemCategory::Material, 100, kFlagNone, kNoType),
        mkItem(FramePart, "Frame part", ItemCategory::Part, 50, kFlagNone, kNoType),
        mkItem(Cinderite, "Cinderite", ItemCategory::Ore, 100,
               kFlagOffWorldOnly, kNoType),
        mkItem(Combustite, "Combustite", ItemCategory::Fuel, 100, kFlagFuel, kNoType),
        // buildables (item form -> entity TypeId)
        mkItem(Miner, "Miner", ItemCategory::Buildable, 20, kFlagBuildable, types::Miner),
        mkItem(Belt, "Belt", ItemCategory::Buildable, 50, kFlagBuildable, types::Belt),
        mkItem(Smelter, "Smelter", ItemCategory::Buildable, 20, kFlagBuildable, types::Smelter),
        mkItem(Assembler, "Assembler", ItemCategory::Buildable, 20, kFlagBuildable, types::Assembler),
        mkItem(Box, "Box", ItemCategory::Buildable, 20, kFlagBuildable, types::Box),
        mkItem(Generator, "Generator", ItemCategory::Buildable, 20, kFlagBuildable, types::Generator),
        mkItem(PowerPole, "Power pole", ItemCategory::Buildable, 20, kFlagBuildable, types::PowerPole),
    };
  }

  void buildRecipes() {
    using namespace recipes;
    // Times/powers are TBD-playtest; chosen sane for headless determinism.
    RecipeDef smelt;
    smelt.recipeId = SmeltFerrite;
    smelt.machineTypeId = types::Smelter;
    smelt.inputItem = items::FerriteOre;
    smelt.inputCount = 1;
    smelt.outputItem = items::FerritePlate;
    smelt.outputCount = 1;
    smelt.timeTicks = 60;
    smelt.powerW = 1000;

    RecipeDef assemble;
    assemble.recipeId = AssembleFrame;
    assemble.machineTypeId = types::Assembler;
    assemble.inputItem = items::FerritePlate;
    assemble.inputCount = 2;  // 2x plate -> 1 frame part
    assemble.outputItem = items::FramePart;
    assemble.outputCount = 1;
    assemble.timeTicks = 90;
    assemble.powerW = 1500;

    RecipeDef mineFe;
    mineFe.recipeId = MineFerrite;
    mineFe.machineTypeId = types::Miner;
    mineFe.inputItem = kNoItem;  // miner reads the deposit, not an input slot
    mineFe.inputCount = 0;
    mineFe.outputItem = items::FerriteOre;
    mineFe.outputCount = 1;
    mineFe.timeTicks = 30;
    mineFe.powerW = 800;

    RecipeDef mineCi = mineFe;
    mineCi.recipeId = MineCinderite;
    mineCi.outputItem = items::Cinderite;

    RecipeDef burn;
    burn.recipeId = BurnCombustite;
    burn.machineTypeId = types::Generator;
    burn.inputItem = items::Combustite;
    burn.inputCount = 1;
    burn.outputItem = kNoItem;  // emits power, not an item
    burn.outputCount = 0;
    burn.timeTicks = 120;
    burn.powerW = -5000;  // produces (negative demand)

    recipes_ = {smelt, assemble, mineFe, mineCi, burn};
  }

  void buildEntities() {
    using namespace types;
    auto mk = [](TypeId t, ItemId costItem, float slope, bool deposit,
                 RecipeId recipe, uint8_t in, uint8_t out, bool power) {
      EntityDef e;
      e.typeId = t;
      e.buildCost = ItemStack{costItem, 1};  // 1x self (§7.3)
      e.slopeToleranceRad = slope;
      e.requiresDeposit = deposit;
      e.defaultRecipe = recipe;
      e.inputPorts = in;
      e.outputPorts = out;
      e.hasPower = power;
      return e;
    };
    // Slope tolerances: machines need flatter ground than a pole. (TBD-playtest.)
    entities_ = {
        mk(Miner, items::Miner, 0.35f, /*deposit*/ true, recipes::MineFerrite, 0, 1, true),
        mk(Belt, items::Belt, 0.60f, false, kNoRecipe, 1, 1, false),
        mk(Smelter, items::Smelter, 0.30f, false, recipes::SmeltFerrite, 1, 1, true),
        mk(Assembler, items::Assembler, 0.30f, false, kNoRecipe /*set via intent*/, 2, 1, true),
        mk(Box, items::Box, 0.45f, false, kNoRecipe, 1, 1, false),
        mk(Generator, items::Generator, 0.30f, false, recipes::BurnCombustite, 1, 0, true),
        mk(PowerPole, items::PowerPole, 0.70f, false, kNoRecipe, 0, 0, true),
    };
  }
};

// =============================================================================
// §B — Inventory: fixed-slot, add/remove/stack honoring StackMax (GP-9).
//
// N fixed slots (slice: 20). Each slot is one ItemStack. add() fills existing
// matching stacks first (up to StackMax), then empty slots; returns the count
// that did NOT fit. remove() pulls across slots; query counts across all slots.
// =============================================================================
class Inventory {
 public:
  static constexpr int kDefaultSlots = 20;

  explicit Inventory(const SliceRegistry& reg, int slots = kDefaultSlots)
      : reg_(&reg), slots_(slots) {}

  int slotCount() const { return static_cast<int>(slots_.size()); }
  const ItemStack& slot(int i) const { return slots_[i]; }

  // Add `count` of `item`. Returns the number that did NOT fit (0 = all added).
  uint16_t add(ItemId item, uint16_t count) {
    if (item == kNoItem || count == 0) return count;
    const uint16_t cap = reg_->stackMax(item);
    if (cap == 0) return count;
    uint16_t remaining = count;
    // 1) top up existing matching stacks.
    for (ItemStack& s : slots_) {
      if (remaining == 0) break;
      if (s.item == item && s.count < cap) {
        const uint16_t room = static_cast<uint16_t>(cap - s.count);
        const uint16_t take = remaining < room ? remaining : room;
        s.count = static_cast<uint16_t>(s.count + take);
        remaining = static_cast<uint16_t>(remaining - take);
      }
    }
    // 2) fill empty slots with new stacks.
    for (ItemStack& s : slots_) {
      if (remaining == 0) break;
      if (s.empty()) {
        const uint16_t take = remaining < cap ? remaining : cap;
        s.item = item;
        s.count = take;
        remaining = static_cast<uint16_t>(remaining - take);
      }
    }
    return remaining;  // overflow that did not fit
  }

  // Remove up to `count` of `item` across slots. Returns the amount removed.
  uint16_t remove(ItemId item, uint16_t count) {
    if (item == kNoItem || count == 0) return 0;
    uint16_t removed = 0;
    for (ItemStack& s : slots_) {
      if (removed >= count) break;
      if (s.item == item && s.count > 0) {
        const uint16_t want = static_cast<uint16_t>(count - removed);
        const uint16_t take = s.count < want ? s.count : want;
        s.count = static_cast<uint16_t>(s.count - take);
        removed = static_cast<uint16_t>(removed + take);
        if (s.count == 0) s.item = kNoItem;  // free the slot
      }
    }
    return removed;
  }

  // Total count of `item` across all slots.
  uint32_t count(ItemId item) const {
    uint32_t n = 0;
    for (const ItemStack& s : slots_)
      if (s.item == item) n += s.count;
    return n;
  }

  bool has(ItemId item, uint16_t atLeast) const { return count(item) >= atLeast; }

  bool empty() const {
    for (const ItemStack& s : slots_)
      if (!s.empty()) return false;
    return true;
  }

 private:
  const SliceRegistry* reg_;
  // `slots_` holds N fixed slots; the size ctor builds N empty stacks (GP-9).
  std::vector<ItemStack> slots_;
};

// =============================================================================
// §C — Mining: extract from a deposit node (Resource ItemId + remaining + grade).
//
// A DepositNode mirrors world-gen's FDepositNode consumable shape (C-1/§8.A):
// Resource IS the ItemId directly (no DepositTypeId indirection). Mining grants
// items into an inventory, decrements remaining, and stops cleanly at 0.
// =============================================================================
struct DepositNode {
  DepositId id = kNoDeposit;
  UniverseCoord position;     // node center (body frame)
  Vec3 surfaceNormal{0, 1, 0};
  ItemId resource = kNoItem;  // the mined ItemId directly (C-1/WG-11)
  float grade = 1.0f;         // richness -> extraction-rate multiplier
  double remainingAmount = 0; // depletion state (a persistence diff, WG-3)

  bool depleted() const { return remainingAmount <= 0.0; }
};

// Result of one extraction tick.
struct MineResult {
  uint16_t granted = 0;     // units added to inventory (after stack overflow)
  uint16_t extracted = 0;   // units pulled from the deposit (before overflow)
  bool depositEmpty = false;  // the node hit 0 this call (or was already empty)
};

// Extract from a deposit into an inventory. baseRate is units/extraction at
// grade 1.0; grade scales it (richer node = more per pull, §2.1 "respect grade").
// remaining is decremented by what was actually pulled; never goes negative.
// If the inventory can't hold everything (StackMax full), the overflow is left
// in the ground (remaining is only decremented by what the player keeps).
inline MineResult mineDeposit(DepositNode& node, Inventory& inv,
                              uint16_t baseRate = 1) {
  MineResult res;
  if (node.depleted() || node.resource == kNoItem) {
    res.depositEmpty = true;
    return res;
  }
  // Effective pull this call: baseRate * grade, clamped to what remains.
  double want = static_cast<double>(baseRate) * static_cast<double>(node.grade);
  if (want < 1.0) want = 1.0;  // always extract at least a unit while non-empty
  if (want > node.remainingAmount) want = node.remainingAmount;
  uint16_t pull = static_cast<uint16_t>(want);
  if (pull == 0) pull = 1;

  // Grant into inventory; only deplete what the player actually keeps.
  uint16_t overflow = inv.add(node.resource, pull);
  uint16_t kept = static_cast<uint16_t>(pull - overflow);
  node.remainingAmount -= static_cast<double>(kept);
  if (node.remainingAmount < 0.0) node.remainingAmount = 0.0;

  res.extracted = kept;
  res.granted = kept;
  res.depositEmpty = node.depleted();
  return res;
}

// GAP-1: mine a world-gen FDepositNode DIRECTLY (no gameplay::DepositNode bridge).
// The slice's mining loop holds the catalog's own FDepositNode (uint64 Id, opaque
// uint16 Resource — the SAME id space, C-3/WG-11); since gameplay::DepositId now
// IS worldgen::DepositId there is nothing to truncate. This overload reads/decrements
// the FDepositNode's RemainingAmount in place — identical extraction semantics to
// the gameplay::DepositNode path above, just over the world-gen consumable shape.
// (Same grade-scaled pull, same "deplete only what the player keeps" rule.)
inline MineResult mineDeposit(worldgen::FDepositNode& node, Inventory& inv,
                              uint16_t baseRate = 1) {
  MineResult res;
  if (node.RemainingAmount <= 0.0 || node.Resource == kNoItem) {
    res.depositEmpty = true;
    return res;
  }
  double want = static_cast<double>(baseRate) * static_cast<double>(node.Grade);
  if (want < 1.0) want = 1.0;
  if (want > node.RemainingAmount) want = node.RemainingAmount;
  uint16_t pull = static_cast<uint16_t>(want);
  if (pull == 0) pull = 1;

  uint16_t overflow = inv.add(node.Resource, pull);
  uint16_t kept = static_cast<uint16_t>(pull - overflow);
  node.RemainingAmount -= static_cast<double>(kept);
  if (node.RemainingAmount < 0.0) node.RemainingAmount = 0.0;

  res.extracted = kept;
  res.granted = kept;
  res.depositEmpty = (node.RemainingAmount <= 0.0);
  return res;
}

// =============================================================================
// §D — Build validation + placement.
//
// Given a build intent (entity TypeId, position, target deposit for miners),
// validate against the §3.2 / §2.2 rules, then on success place the machine
// into the factory sim and deduct the build cost from the inventory.
// =============================================================================

// Why a placement was rejected (drives the §3.2 red-ghost reason label).
enum class BuildReject : uint8_t {
  Ok = 0,
  UnknownType,        // no such EntityDef
  NoDeposit,          // miner placed off any deposit node (§2.2)
  WrongDeposit,       // miner's target deposit doesn't exist / id mismatch
  SlopeTooSteep,      // terrain slope > entity tolerance (§3.2)
  InsufficientItems,  // inventory lacks the build cost (§3.2)
};

struct BuildResult {
  BuildReject reject = BuildReject::Ok;
  bool placed = false;
  of::factory::EntityHandle handle;  // valid() iff placed into the factory sim
  bool valid() const { return reject == BuildReject::Ok && placed; }
};

// A build intent (the §8.E IFactoryBuildIntent payload, headless subset).
struct BuildIntent {
  TypeId typeId = kNoType;
  // lat/lon (radians) of the placement on the body surface — used to sample the
  // terrain slope (world-gen). The full intent carries a snapped UniverseCoord;
  // headless we derive slope from the geo coordinate the ghost projected to.
  double lat = 0.0;
  double lon = 0.0;
  DepositId targetDeposit = kNoDeposit;  // miner only (§2.2)
};

// Terrain slope (radians) at (lat,lon): the angle between the local radial-up
// and the surface normal, derived from the world-gen heightfield via finite
// differences (the slope a ghost reads from RaycastTerrain's SlopeRad, RC-7).
inline double terrainSlopeRad(const worldgen::BodyParams& body, double lat,
                              double lon) {
  // Sample a small geodesic neighbourhood and build an approximate normal.
  const double eps = 1.0e-4;  // ~ a few hundred m at planetary radius
  const double h = worldgen::SampleTerrainHeight(body, lat, lon);
  const double hLat = worldgen::SampleTerrainHeight(body, lat + eps, lon);
  const double hLon = worldgen::SampleTerrainHeight(body, lat, lon + eps);
  // Local metric: 1 rad of lat ≈ radius m; 1 rad of lon ≈ radius*cos(lat) m.
  const double mPerLat = body.radiusM;
  const double mPerLon = body.radiusM * std::cos(lat);
  const double dzLat = (hLat - h) / (eps * mPerLat);  // slope along lat
  double dzLon = 0.0;
  if (mPerLon > 1.0) dzLon = (hLon - h) / (eps * mPerLon);  // slope along lon
  // The terrain gradient magnitude -> slope angle from horizontal tangent plane.
  const double grad = std::sqrt(dzLat * dzLat + dzLon * dzLon);
  return std::atan(grad);
}

// The builder: validates + places against a factory sim, a registry, an
// inventory, the body, and a deposit table. Owns the placement *rule*; the sim
// owns the authoritative entity (§3.4: gameplay does not create the entity, the
// factory sim does — here, in the same process, we drive its add* API directly).
class Builder {
 public:
  Builder(const SliceRegistry& reg, const worldgen::BodyParams& body)
      : reg_(&reg), body_(&body) {}

  // Look up a deposit by id in a caller-supplied table (world-gen's catalog).
  static DepositNode* findDeposit(std::vector<DepositNode>& deposits,
                                  DepositId id) {
    if (id == kNoDeposit) return nullptr;
    for (DepositNode& d : deposits)
      if (d.id == id) return &d;
    return nullptr;
  }

  // Validate only (no mutation) — the ghost colour/reason (§3.2). Pass the
  // deposit table so a miner's NoDeposit/WrongDeposit can be evaluated.
  BuildReject validate(const BuildIntent& intent, const Inventory& inv,
                       const std::vector<DepositNode>& deposits) const {
    const EntityDef* def = reg_->entity(intent.typeId);
    if (!def) return BuildReject::UnknownType;

    // Rule 1 (miner only, §2.2): footprint must overlap a deposit node.
    if (def->requiresDeposit) {
      if (intent.targetDeposit == kNoDeposit) return BuildReject::NoDeposit;
      bool found = false;
      for (const DepositNode& d : deposits)
        if (d.id == intent.targetDeposit) { found = true; break; }
      if (!found) return BuildReject::WrongDeposit;
    }

    // Rule 2 (§3.2): terrain slope within the entity's tolerance.
    const double slope = terrainSlopeRad(*body_, intent.lat, intent.lon);
    if (slope > static_cast<double>(def->slopeToleranceRad))
      return BuildReject::SlopeTooSteep;

    // Rule 3 (§3.2): the inventory holds the build cost.
    if (def->buildCost.item != kNoItem &&
        !inv.has(def->buildCost.item, def->buildCost.count))
      return BuildReject::InsufficientItems;

    return BuildReject::Ok;
  }

  // Validate + (on success) place into the factory sim and deduct the cost.
  // The deposit table is passed mutably so a placed miner can be bound to its
  // node's Resource (the recipe it extracts) — the sim reads the node directly
  // per C-1/WG-11. Returns the factory handle on success.
  BuildResult place(const BuildIntent& intent, Inventory& inv,
                    of::factory::FactorySim& sim,
                    std::vector<DepositNode>& deposits) {
    BuildResult out;
    out.reject = validate(intent, inv, deposits);
    if (out.reject != BuildReject::Ok) return out;

    const EntityDef* def = reg_->entity(intent.typeId);

    // Deduct the build cost (validated present above).
    if (def->buildCost.item != kNoItem)
      inv.remove(def->buildCost.item, def->buildCost.count);

    // Create the authoritative entity in the factory sim.
    if (intent.typeId == types::Belt) {
      // Belts are a transport line, not a recipe machine (§3.5).
      out.handle = sim.addBeltLine(/*tiles*/ 4, /*speed*/ 8);
    } else if (intent.typeId == types::Box || intent.typeId == types::PowerPole) {
      // Box / pole: no recipe. Model the box as a passive 1-tile buffer line so
      // it exists in the sim; the pole as a no-recipe machine carrier.
      if (intent.typeId == types::Box) {
        out.handle = sim.addBeltLine(/*tiles*/ 1, /*speed*/ 8);
      } else {
        of::factory::Recipe none;  // empty recipe -> never crafts (pole carrier)
        none.inputItem = kNoItem;
        none.inputCount = 0xFFFF;  // unreachable input -> inert
        out.handle = sim.addMachine(none);
      }
    } else if (intent.typeId == types::Generator) {
      // Generator: a power supply in the network (the brownout source, §7.2).
      const RecipeDef* rd = reg_->recipe(recipes::BurnCombustite);
      out.handle = sim.addGenerator(/*network*/ 1,
                                    rd ? -rd->powerW : 5000);
    } else {
      // Miner / smelter / assembler: a recipe machine.
      RecipeId rid = def->defaultRecipe;
      // Miner: pick the recipe whose output is the deposit's Resource (§7.2).
      if (def->requiresDeposit) {
        DepositNode* node = findDeposit(deposits, intent.targetDeposit);
        if (node) {
          if (node->resource == items::Cinderite) rid = recipes::MineCinderite;
          else rid = recipes::MineFerrite;
        }
      }
      const RecipeDef* rd = reg_->recipe(rid);
      of::factory::Recipe r = rd ? rd->toFactoryRecipe() : of::factory::Recipe{};
      out.handle = sim.addMachine(r);
      sim.setMachineNetwork(out.handle, /*network*/ 1);
    }

    out.placed = out.handle.valid();
    return out;
  }

 private:
  const SliceRegistry* reg_;
  const worldgen::BodyParams* body_;
};

// =============================================================================
// §F — Objective state machine (the linear slice chain, §6 / GP-11).
//
// A tiny ordered list of steps, each with a completion predicate read from the
// inventory / factory / world state. Advances exactly one step per satisfied
// predicate; the terminal step ("land a working automated outpost on the moon")
// fires only when ITS conditions hold. Not a quest engine: no branching, no data
// assets. Steps mirror §6's chain.
// =============================================================================
enum class ObjectiveStep : uint8_t {
  MineFirstOre = 1,   // §6.1 — first Ferrite ore mined (Forge)
  SmeltPlate = 2,     // §6.2 — a Ferrite plate exists (smelter ran)
  AssembleFrame = 3,  // §6.4 — a Frame part exists (assembler ran)
  StandUpPower = 4,   // §6.3 — a powered machine network (brownout back to 1.0)
  ReachCinder = 5,    // §6.5 — landed in Cinder's SOI/frame
  MineOffWorld = 6,   // §6.6 — Cinderite extracted (the off-world payoff)
  OutpostComplete = 7 // §6.7 — a running automated outpost on the moon (TERMINAL)
};

// A read-only snapshot of the streams the predicates evaluate against. Gameplay
// fills this from the inventory + factory + world each tick; the FSM never
// touches the sims directly (keeps it a pure predicate evaluator).
struct ObjectiveContext {
  // Inventory / production facts.
  bool hasFerriteOre = false;     // mined any Ferrite ore
  bool hasFerritePlate = false;   // smelted any plate
  bool hasFramePart = false;      // assembled any frame part
  bool hasCinderite = false;      // extracted the off-world resource

  // Power facts (§6.3 / brownout). powerStable = supply met demand last tick.
  bool powerNetworkUp = false;    // at least one powered machine on a network
  bool powerStable = false;       // brownout factor ~ 1.0 (supply >= demand)

  // Flight / world facts (§6.5).
  bool onCinder = false;          // vessel in Cinder's frame
  bool landedOnCinder = false;    // ground contact on Cinder

  // Outpost terminal facts (§6.7): a running automated chain on Cinder.
  bool cinderMinerRunning = false;   // a powered miner producing Cinderite
  bool cinderOutpostPowered = false; // its network is up + stable on Cinder
};

class ObjectiveTracker {
 public:
  ObjectiveStep current() const { return step_; }
  bool complete() const { return done_; }

  // Step index 1..7 (matches FGameplayPersistState.ObjectiveStep).
  uint8_t stepIndex() const { return static_cast<uint8_t>(step_); }

  // Has the predicate for the CURRENT step been met by this context?
  bool currentStepSatisfied(const ObjectiveContext& c) const {
    return predicate(step_, c);
  }

  // Evaluate the current step's predicate; if satisfied, advance one step (and
  // latch `done_` when the terminal step fires). Returns true iff it advanced.
  bool tick(const ObjectiveContext& c) {
    if (done_) return false;
    if (!predicate(step_, c)) return false;
    if (step_ == ObjectiveStep::OutpostComplete) {
      done_ = true;
      return true;  // terminal step satisfied — objective complete
    }
    step_ = static_cast<ObjectiveStep>(static_cast<uint8_t>(step_) + 1);
    return true;
  }

  // The per-step predicate (§6). PURE: reads only the context snapshot.
  static bool predicate(ObjectiveStep s, const ObjectiveContext& c) {
    switch (s) {
      case ObjectiveStep::MineFirstOre:   return c.hasFerriteOre;
      case ObjectiveStep::SmeltPlate:     return c.hasFerritePlate;
      case ObjectiveStep::AssembleFrame:  return c.hasFramePart;
      case ObjectiveStep::StandUpPower:   return c.powerNetworkUp && c.powerStable;
      case ObjectiveStep::ReachCinder:    return c.onCinder && c.landedOnCinder;
      case ObjectiveStep::MineOffWorld:   return c.hasCinderite;
      case ObjectiveStep::OutpostComplete:
        // The terminal "land a working automated outpost on the moon" gate:
        // a powered miner producing the off-world resource on a stable network,
        // on Cinder. Only fires when ALL hold (no early trigger).
        return c.onCinder && c.landedOnCinder && c.hasCinderite &&
               c.cinderMinerRunning && c.cinderOutpostPowered;
      default: return false;
    }
  }

 private:
  ObjectiveStep step_ = ObjectiveStep::MineFirstOre;
  bool done_ = false;
};

// =============================================================================
// §S — PRIMITIVE SURVIVAL-CRAFTING SLICE (WP1).
//
// A coherent "first hour" content set authored ON TOP of the registries above:
// raw resources harvested by hand from terrestrial nodes (deposits.h §S),
// hand-crafted tools + structures, and fuel-driven furnace/smelter smelting.
// Everything is additive — the pinned §7.1 ids (…0x0016), science (0x0020+) and
// science recipes (0x0120+) are untouched. The survival block lives at:
//   items   0x0030+   entity types 0x30+   recipes 0x0130+
// and the base-building structural set (§S.6) takes the next free blocks:
//   items   0x0040+   entity types 0x40+
// (the deposit/node Resource ids mirror the item ids — Resource IS the ItemId,
// WG-11; the node KINDS live in worldgen::survival).
//
// DESIGN — the three mechanics this section adds over the existing core:
//   1. CONTENT  — RegisterSurvivalContent() appends the items / smelting recipes
//                 (and tool/structure HAND recipes) into a SliceRegistry, reusing
//                 the additive registerItem/registerRecipe extension points.
//   2. HAND-CRAFT — HandCrafter turns an Inventory + a CraftRecipe (multi-input)
//                 into output, consuming inputs only if ALL are present. Tools,
//                 furnace and smelter are made this way (no machine needed).
//   3. SMELTING  — a focused gameplay-layer `Furnace` type: ore-in + a FUEL-BURN
//                 pool, tick-driven, ore→ingot at the tier's rate; smelter is the
//                 faster tier. (See the Furnace doc-comment for WHY this is its
//                 own type and not a factory-sim machine.)
//
// TOOL / BOOTSTRAP (no deadlock): hand harvest always works (slow, low yield);
// the matching tool (axe for wood, pickaxe for stone/coal/ore) raises the yield.
// "Tool helps but isn't required" — encoded in harvestNode() below.
// =============================================================================
namespace survival {

// --- Survival ItemId block (append-only at 0x0030+, stable, never reused). -----
namespace items {
// raw resources (mirror worldgen::survival::kItem* — Resource IS the ItemId).
static constexpr ItemId Wood          = 0x0030;
static constexpr ItemId Stone         = 0x0031;
static constexpr ItemId Coal          = 0x0032;  // also a fuel
static constexpr ItemId RawIron       = 0x0033;
static constexpr ItemId RawCopper     = 0x0034;
static constexpr ItemId Water         = 0x0035;
static constexpr ItemId Oil           = 0x0036;
// smelted ingots.
static constexpr ItemId Iron          = 0x0037;
static constexpr ItemId Copper        = 0x0038;
// tools (hand-crafted from the pack).
static constexpr ItemId CrudePickaxe  = 0x0039;
static constexpr ItemId CrudeAxe      = 0x003A;
// structures (hand-crafted, then placeable).
static constexpr ItemId PrimitiveFurnace = 0x003B;
static constexpr ItemId SurvivalSmelter  = 0x003C;
// electrification (§S.5). The third smelting rung plus the two things that make
// it work: something that makes watts and something that carries them.
static constexpr ItemId ElectricSmelter  = 0x003D;
static constexpr ItemId BurnerGenerator  = 0x003E;
static constexpr ItemId PowerPole        = 0x003F;
// base-building structural set (§S.6). A separate 0x0040 block so the structural
// parts read as their own family rather than as a tail of the machine items.
static constexpr ItemId Foundation    = 0x0040;
static constexpr ItemId Floor         = 0x0041;
static constexpr ItemId Wall          = 0x0042;
static constexpr ItemId Door          = 0x0043;
// The launch pad (§S.6, GP-57). Still inside the 0x0040 structural block and
// deliberately NOT at 0x0050, which GP-31 spent on the vessel part items
// (`ItemId = 0x0050 + (PartId - 0x0100)`, allocated in of_vessel_api.inc and due
// to be promoted here). 0x0046..0x004F stay free for the next structural part.
static constexpr ItemId LaunchPad     = 0x0044;
// D-019 / GP-613. THE RESEARCH STATION, and it takes the next free id in the
// structural block exactly as the pad's comment above said the next one would.
// It is a STRUCTURE and not a machine for §S.6's own stated criterion: it never
// ticks, holds no inventory, has no ports and draws no power. What it does is
// exist, which is what the J key now asks about.
static constexpr ItemId ResearchStation = 0x0045;
}  // namespace items

// --- Survival entity TypeId block (0x30+, for the placeable structures). -------
namespace types {
static constexpr TypeId PrimitiveFurnace = 0x30;
static constexpr TypeId SurvivalSmelter  = 0x31;
// --- ALIASES, NOT NEW IDS. ----------------------------------------------------
// The electric smelter, the generator and the power pole already exist in the
// machine TypeId block with shipped art (ASSET-SPECS §4.15 / §4.18 / §4.19:
// machines/smelter.glb 0x12, machines/generator.glb 0x15, machines/power_pole.glb
// 0x16). Minting 0x32/0x33/0x34 for them would be a second id for one mesh and
// one machine, which is the duplicate-authority mistake this project keeps
// paying for. These names simply let survival-side code say what it means.
static constexpr TypeId ElectricSmelter = of::gameplay::types::Smelter;    // 0x12
static constexpr TypeId BurnerGenerator = of::gameplay::types::Generator;  // 0x15
static constexpr TypeId PowerPole       = of::gameplay::types::PowerPole;  // 0x16
// Base-building structural set (§S.6). ASSET-SPECS §4 is the TypeId authority:
// machines own 0x10..0x16 and 0x30/0x31, structures own the 0x40 block.
static constexpr TypeId Foundation = 0x40;
static constexpr TypeId Floor      = 0x41;
static constexpr TypeId Wall       = 0x42;
static constexpr TypeId Door       = 0x43;
// The launch pad. Its art is assets/models/dist/rocket/launch_pad.glb, which
// lives under rocket/ rather than structures/ because it is launch
// infrastructure; the TypeId is still a structural one because what a TypeId
// answers is "which mesh and which family", and the pad's family is this one.
static constexpr TypeId LaunchPad  = 0x44;
// D-019. The research station. 0x45 continues the structural TypeId block; the
// art lane owes `structures/research_station.glb` against it (ASSET-SPECS §4 is
// still the authority) and the client draws an existing machine mesh under this
// id until it ships, which is a PLACEHOLDER and is said out loud in
// ResearchStations.ts rather than left to be discovered.
static constexpr TypeId ResearchStation = 0x45;
}  // namespace types

// --- Survival smelting RecipeId block (0x0130+, append-only). ------------------
// These are the FUEL-DRIVEN smelts the Furnace runs (NOT factory-sim recipes —
// the Furnace owns its own fuel-pool tick; see below). They are still registered
// as RecipeDefs so the registry/UE layer can list "what a furnace can smelt".
namespace recipes {
static constexpr RecipeId SmeltIron   = 0x0130;  // raw_iron  -> iron
static constexpr RecipeId SmeltCopper = 0x0131;  // raw_copper -> copper
}  // namespace recipes

// =============================================================================
// §S.0 — THE SMELTING LADDER. One table, open at the bottom.
//
// Three rungs today, and the list is deliberately OPEN: a fourth tier is a row,
// never a branch and never a new type.
//
//   primitive furnace   180 t/smelt   burns wood or coal
//   smelter              60 t/smelt   burns coal (3x the furnace)
//   electric smelter     30 t/smelt   draws 30 kW (2x the smelter, 6x the furnace)
//
// WHAT THE `authority` COLUMN IS FOR, and why this table is a DESCRIPTOR rather
// than a third implementation of smelting:
//
//   the fuel rungs are run by the gameplay-layer Furnace (§S.4, a solid-fuel
//   burn pool), and the electric rung is run by a factory_sim machine on an
//   of::power grid (automation.h placeElectricSmelter). That split already
//   existed and is the right one: a fuel pool has no representation in a power
//   network and a power network has none of a fuel pool, and §S.4 argues it out
//   at length. What did NOT exist was a single place saying which rungs there
//   are, how fast each is, and who runs it. Without that, "add the electric
//   tier" reads as an invitation to grow a THIRD smelting model, and this
//   project has repeatedly paid for two authorities modelling one thing.
//
// So: this table owns the LADDER (what the rungs are, and what each costs in
// ticks and in watts). The two existing engines own the RUNNING. Nothing in
// this table simulates anything.
//
// The ticks are a 6:2:1 progression, so the ladder is legible as a ladder: ten
// smelts take 30 s, then 10 s, then 5 s.
// =============================================================================
enum class SmeltAuthority : uint8_t {
  FuelPool = 0,      // run by survival::Furnace (§S.4)
  PowerNetwork = 1,  // run by a factory_sim machine on an of::power grid
};

enum class SmeltTierId : uint8_t {
  PrimitiveFurnace = 0,
  Smelter = 1,
  ElectricSmelter = 2,
  // append here; do not renumber.
};

struct SmeltTierDef {
  SmeltTierId id = SmeltTierId::PrimitiveFurnace;
  SmeltAuthority authority = SmeltAuthority::FuelPool;
  const char* name = "";
  uint32_t ticksPerSmelt = 180;
  int32_t powerW = 0;       // 0 for the fuel rungs
  ItemId item = kNoItem;    // the buildable item form
  TypeId typeId = kNoType;  // the placed entity / mesh (ASSET-SPECS is authority)

  bool isPowered() const { return authority == SmeltAuthority::PowerNetwork; }
};

// The ladder, in order. The 180 and the 60 live HERE and nowhere else.
inline const std::vector<SmeltTierDef>& smeltTiers() {
  static const std::vector<SmeltTierDef> kTiers = {
      SmeltTierDef{SmeltTierId::PrimitiveFurnace, SmeltAuthority::FuelPool,
                   "Primitive furnace", 180, 0, items::PrimitiveFurnace,
                   types::PrimitiveFurnace},
      SmeltTierDef{SmeltTierId::Smelter, SmeltAuthority::FuelPool, "Smelter", 60,
                   0, items::SurvivalSmelter, types::SurvivalSmelter},
      SmeltTierDef{SmeltTierId::ElectricSmelter, SmeltAuthority::PowerNetwork,
                   "Electric smelter", 30, 30000, items::ElectricSmelter,
                   types::ElectricSmelter},
  };
  return kTiers;
}

inline const SmeltTierDef& smeltTier(SmeltTierId id) {
  const std::vector<SmeltTierDef>& t = smeltTiers();
  const size_t i = static_cast<size_t>(id);
  return t[i < t.size() ? i : 0];
}
inline uint32_t ticksPerSmeltFor(SmeltTierId t) {
  return smeltTier(t).ticksPerSmelt;
}

// --- Tool kind (for the tool-assisted harvest rule). ---------------------------
// Which hand-tool speeds up which node kind. None = bare hands (always allowed).
enum class ToolKind : uint8_t { None = 0, Axe = 1, Pickaxe = 2 };

// The tool that ASSISTS a given node kind (axe for wood, pickaxe for the hard
// resources). Water/oil need no tool — bare-hands collect at the base rate.
inline ToolKind assistingToolFor(worldgen::survival::NodeKind k) {
  using NK = worldgen::survival::NodeKind;
  switch (k) {
    case NK::Tree:      return ToolKind::Axe;
    case NK::Rock:      return ToolKind::Pickaxe;
    case NK::CoalSeam:  return ToolKind::Pickaxe;
    case NK::IronOre:   return ToolKind::Pickaxe;
    case NK::CopperOre: return ToolKind::Pickaxe;
    case NK::WaterPool: return ToolKind::None;
    case NK::OilSeep:   return ToolKind::None;
  }
  return ToolKind::None;
}

// The item form of a tool kind (so harvestNode can check the pack for it).
inline ItemId itemForTool(ToolKind t) {
  switch (t) {
    case ToolKind::Axe:      return items::CrudeAxe;
    case ToolKind::Pickaxe:  return items::CrudePickaxe;
    case ToolKind::None:     return kNoItem;
  }
  return kNoItem;
}

// =============================================================================
// §S.1 — Content registration. Appends the survival items + smelting recipes
// into an existing SliceRegistry (the SAME additive registerItem/registerRecipe
// the science layer uses; pinned ids untouched). Idempotent — re-registering a
// present id is a no-op. Call once after constructing the registry.
// =============================================================================
inline RecipeDef makeSmeltIronRecipe() {
  RecipeDef r;
  r.recipeId = recipes::SmeltIron;
  r.machineTypeId = types::PrimitiveFurnace;
  r.inputItem = items::RawIron;
  r.inputCount = 1;
  r.outputItem = items::Iron;
  r.outputCount = 1;
  // Nominal tier = the primitive furnace, read from the §S.0 ladder rather than
  // spelled again here. The higher rungs run the SAME conversion faster: see
  // smeltTiers() for the speeds and makeSmeltRecipeFor() for a per-tier def.
  const SmeltTierDef& t0 = smeltTier(SmeltTierId::PrimitiveFurnace);
  r.timeTicks = t0.ticksPerSmelt;
  r.powerW = t0.powerW;  // 0: the fuel rungs are FUEL-driven, not power-driven
  return r;
}
// The same ore -> ingot conversion authored against any rung of the ladder. One
// conversion, three machines: the recipe id and the item pair never change, only
// the machine type, the tick cost and the watts. A caller that wants "what does
// an electric smelter do with raw iron" asks here instead of writing a second
// recipe with a second id, which is how a duplicate authority starts.
inline RecipeDef makeSmeltRecipeFor(SmeltTierId tier, ItemId ore) {
  RecipeDef r = makeSmeltIronRecipe();
  if (ore == items::RawCopper) {
    r.recipeId = recipes::SmeltCopper;
    r.inputItem = items::RawCopper;
    r.outputItem = items::Copper;
  }
  const SmeltTierDef& t = smeltTier(tier);
  r.machineTypeId = t.typeId;
  r.timeTicks = t.ticksPerSmelt;
  r.powerW = t.powerW;
  return r;
}
inline RecipeDef makeSmeltCopperRecipe() {
  RecipeDef r = makeSmeltIronRecipe();
  r.recipeId = recipes::SmeltCopper;
  r.inputItem = items::RawCopper;
  r.outputItem = items::Copper;
  return r;
}

inline bool RegisterSurvivalContent(SliceRegistry& reg) {
  using namespace items;
  auto mk = [](ItemId id, const char* name, ItemCategory cat, uint16_t stackMax,
               uint8_t flags, TypeId places) {
    return ItemDef{id, name, cat, stackMax, flags, places};
  };
  // raw resources
  reg.registerItem(mk(Wood, "Wood", ItemCategory::Material, 100, kFlagFuel, kNoType));
  reg.registerItem(mk(Stone, "Stone", ItemCategory::Material, 100, kFlagNone, kNoType));
  reg.registerItem(mk(Coal, "Coal", ItemCategory::Fuel, 100, kFlagFuel, kNoType));
  reg.registerItem(mk(RawIron, "Raw iron", ItemCategory::Ore, 100, kFlagNone, kNoType));
  reg.registerItem(mk(RawCopper, "Raw copper", ItemCategory::Ore, 100, kFlagNone, kNoType));
  reg.registerItem(mk(Water, "Water", ItemCategory::Material, 100, kFlagNone, kNoType));
  reg.registerItem(mk(Oil, "Oil", ItemCategory::Material, 100, kFlagNone, kNoType));
  // smelted ingots
  reg.registerItem(mk(Iron, "Iron", ItemCategory::Material, 100, kFlagNone, kNoType));
  reg.registerItem(mk(Copper, "Copper", ItemCategory::Material, 100, kFlagNone, kNoType));
  // tools
  reg.registerItem(mk(CrudePickaxe, "Crude pickaxe", ItemCategory::Part, 1, kFlagNone, kNoType));
  reg.registerItem(mk(CrudeAxe, "Crude axe", ItemCategory::Part, 1, kFlagNone, kNoType));
  // structures (buildable item forms -> survival entity TypeIds)
  reg.registerItem(mk(PrimitiveFurnace, "Primitive furnace", ItemCategory::Buildable,
                      10, kFlagBuildable, types::PrimitiveFurnace));
  reg.registerItem(mk(SurvivalSmelter, "Smelter", ItemCategory::Buildable, 10,
                      kFlagBuildable, types::SurvivalSmelter));
  // electrification (§S.5): the powered smelting rung and its supporting cast.
  // These place the EXISTING machine-block TypeIds (0x12 / 0x15 / 0x16), whose
  // art already ships — see the alias note in the types block above.
  reg.registerItem(mk(ElectricSmelter, "Electric smelter", ItemCategory::Buildable,
                      10, kFlagBuildable, types::ElectricSmelter));
  reg.registerItem(mk(BurnerGenerator, "Burner generator", ItemCategory::Buildable,
                      10, kFlagBuildable, types::BurnerGenerator));
  reg.registerItem(mk(PowerPole, "Power pole", ItemCategory::Buildable, 50,
                      kFlagBuildable, types::PowerPole));
  // base-building structural set (§S.6): placeable, never ticked, no ports.
  reg.registerItem(mk(Foundation, "Foundation", ItemCategory::Buildable, 50,
                      kFlagBuildable, types::Foundation));
  reg.registerItem(mk(Floor, "Floor", ItemCategory::Buildable, 50,
                      kFlagBuildable, types::Floor));
  reg.registerItem(mk(Wall, "Wall", ItemCategory::Buildable, 50,
                      kFlagBuildable, types::Wall));
  reg.registerItem(mk(Door, "Door", ItemCategory::Buildable, 50,
                      kFlagBuildable, types::Door));
  // The launch pad (GP-57). One per stack, because a stack cap is a statement
  // about how many you would ever carry and the answer for a 24 x 24 m pad is
  // one; every other structural part stacks 50 because you carry a wall by the
  // dozen. Nothing reads the cap today (a structure is paid for and placed, it
  // never enters the pack, §S.6) and it is set honestly anyway, because the day
  // something does read it a 50 here would be a silent lie.
  reg.registerItem(mk(LaunchPad, "Launch pad", ItemCategory::Buildable, 1,
                      kFlagBuildable, types::LaunchPad));
  // D-019. One per stack for the pad's own reason: you would never carry two,
  // and nothing reads the cap today because a structure is paid for and placed
  // rather than carried (§S.6). Set honestly anyway.
  reg.registerItem(mk(ResearchStation, "Research station", ItemCategory::Buildable,
                      1, kFlagBuildable, types::ResearchStation));
  // smelting recipes (fuel-driven; registered so the UE layer can list them)
  reg.registerRecipe(makeSmeltIronRecipe());
  reg.registerRecipe(makeSmeltCopperRecipe());

  return reg.item(Wood) && reg.item(Iron) && reg.item(SurvivalSmelter) &&
         reg.item(Foundation) && reg.item(Door) && reg.item(ResearchStation) &&
         reg.recipe(recipes::SmeltIron) && reg.recipe(recipes::SmeltCopper);
}

// =============================================================================
// §S.2 — Hand harvest (no machine; the tool-assisted-but-not-required rule).
//
// Harvest a worldgen::survival node by hand into an inventory. ALWAYS works while
// the node has resource (no bootstrap deadlock); holding the matching tool raises
// the yield. baseYield is the bare-hands pull; with the tool the pull is
// toolYield (>= baseYield). The node's RemainingAmount is decremented by what the
// player actually keeps (same "deplete only what's kept" rule as mineDeposit).
//
// PACING (§S.2a below): pass 0 for either yield and the pull is DERIVED from the
// node's own size, so every node clears in the same satisfying handful of swings
// whatever its kind. Passing an explicit yield overrides the pacing, which is how
// the unit tests pin the tool rule independently of the balance constants.
// =============================================================================
struct HarvestResult {
  uint16_t granted = 0;       // units added to inventory
  bool usedTool = false;      // the assisting tool was present (improved yield)
  bool nodeEmpty = false;     // node hit 0 (or was already empty)
};

// -----------------------------------------------------------------------------
// §S.2a — Harvest pacing: the AUTHORED number is swings-to-clear, not the yield.
//
// A flat per-swing yield cannot serve both a ~30 unit tree and a ~200 unit coal
// seam: whatever number makes the tree a handful of swings makes the seam a
// chore. So the constant that is authored is how many swings a node should take,
// and the per-swing yield falls out of the node's own InitialAmount. Big nodes
// pay big per swing; every node is the same satisfying commitment; and the
// matching tool halves the swings AND doubles the number on the readout, which
// is what makes a tool read as an upgrade rather than a rounding error.
//
// Bare hands still always work (no bootstrap deadlock) — the tool only changes
// which of the two swing counts is used.
// -----------------------------------------------------------------------------
static constexpr uint16_t kBareHandSwings = 6;  // swings to clear a node by hand
static constexpr uint16_t kToolSwings     = 3;  // ... with the matching tool

// Units per swing so that `swings` swings clear `initialAmount`. Rounds UP, so
// the count is a ceiling and never an off-by-one extra swing.
inline uint16_t yieldPerSwing(double initialAmount, uint16_t swings) {
  if (swings == 0) swings = 1;
  double y = std::ceil(initialAmount / static_cast<double>(swings));
  if (y < 1.0) y = 1.0;
  if (y > 65535.0) y = 65535.0;
  return static_cast<uint16_t>(y);
}

inline HarvestResult harvestNode(worldgen::FDepositNode& node,
                                 worldgen::survival::NodeKind kind, Inventory& inv,
                                 uint16_t baseYield = 0, uint16_t toolYield = 0) {
  HarvestResult res;
  if (node.RemainingAmount <= 0.0 || node.Resource == kNoItem) {
    res.nodeEmpty = true;
    return res;
  }
  // Tool helps but isn't required: if the pack holds the assisting tool, the pull
  // is the higher toolYield; otherwise bare-hands baseYield (still > 0).
  const ToolKind tool = assistingToolFor(kind);
  const ItemId toolItem = itemForTool(tool);
  const bool hasTool = (toolItem != kNoItem) && inv.has(toolItem, 1);
  uint16_t pull = hasTool ? toolYield : baseYield;
  if (pull == 0)  // 0 = "use the authored pacing", derived from this node's size.
    pull = yieldPerSwing(node.InitialAmount > 0.0 ? node.InitialAmount
                                                  : node.RemainingAmount,
                         hasTool ? kToolSwings : kBareHandSwings);
  if (pull == 0) pull = 1;

  // Clamp to what the node still holds — and this is where the node used to get
  // stuck. RemainingAmount is a double (InitialAmount is baseAmountOf(kind) times
  // a FRACTIONAL Grade), so the last pull is almost always a sub-unit remainder.
  // Truncating that to a uint16 gives 0: the swing then grants nothing, the node
  // is decremented by nothing, nodeEmpty never fires, and a node parks at e.g.
  // 0.72 forever — a resource that can never be finished. One unit is the
  // granularity of the whole item system, so a positive remainder is rounded UP
  // and the node drains in that one swing. The player is never handed an empty
  // swing, and the over-grant is bounded by strictly less than one unit per node
  // over its whole life. (mineDeposit applies the same "always at least a unit
  // while non-empty" rule; this is that rule stated once for the harvest path.)
  if (static_cast<double>(pull) > node.RemainingAmount) {
    const double whole = std::ceil(node.RemainingAmount);
    pull = (whole >= 65535.0) ? static_cast<uint16_t>(65535)
                              : static_cast<uint16_t>(whole);
    if (pull == 0) pull = 1;  // unreachable while RemainingAmount > 0; belt+braces
  }

  const uint16_t overflow = inv.add(node.Resource, pull);
  const uint16_t kept = static_cast<uint16_t>(pull - overflow);
  node.RemainingAmount -= static_cast<double>(kept);
  if (node.RemainingAmount < 0.0) node.RemainingAmount = 0.0;

  res.granted = kept;
  res.usedTool = hasTool;
  res.nodeEmpty = (node.RemainingAmount <= 0.0);
  return res;
}

// =============================================================================
// §S.5: Hand-mining an ORE PATCH through one of its outcrops (deposits.h §P).
//
// A patch is a piece of ground with ONE pool of ore in it. An outcrop is the
// part of that body which breaks the surface: it is what the player aims at and
// swings at, and it is NOT a second reservoir. So this function does not
// re-implement a single rule: it hands the outcrop the patch's own pool as its
// remaining amount, lets harvestNode do exactly what it does for any node (the
// tool check, the grant, the clamp, the round-up of the last sub-unit), and then
// takes out of the PATCH precisely what harvestNode removed from the view.
//
// The two yields are authored in deposits.h §P rather than derived from the
// node's size, because a patch holds thousands of units and the §S.2a pacing
// (six swings to clear) would hand over six hundred ore in one swing. Bare hands
// still always work: that is the no-bootstrap-deadlock invariant, and it matters
// more here than anywhere else, because a drill is the thing you cannot build
// until you have mined by hand.
// =============================================================================
inline HarvestResult harvestPatch(worldgen::patches::OrePatch& patch,
                                  worldgen::FDepositNode& outcrop,
                                  worldgen::survival::NodeKind kind,
                                  Inventory& inv) {
  namespace wp = worldgen::patches;
  outcrop.Resource = patch.Resource;
  outcrop.InitialAmount = patch.InitialAmount;
  outcrop.RemainingAmount = patch.RemainingAmount;
  const double before = outcrop.RemainingAmount;
  HarvestResult res = harvestNode(outcrop, kind, inv, wp::kHandYieldBare,
                                  wp::kHandYieldTool);
  const double took = before - outcrop.RemainingAmount;
  if (took > 0.0) wp::extract(patch, took);
  // The outcrop is a VIEW, re-derived after the fact. Leaving it holding its own
  // number is how a second counter is born.
  outcrop.RemainingAmount = patch.RemainingAmount;
  res.nodeEmpty = (patch.RemainingAmount <= 0.0);
  return res;
}

// =============================================================================
// §S.3 — Hand-crafting (tools / furnace / smelter are made this way).
//
// A CraftRecipe is a small multi-input -> single-output bill of materials (the
// factory-sim Recipe is single-input; tools/structures need 2 inputs). HandCrafter
// crafts it against an Inventory: succeeds (consuming ALL inputs, adding the
// output) ONLY if every input is present AND THE OUTPUT FITS; otherwise it
// consumes nothing and `craftBlock` says which of the two refused it (GP-51).
// =============================================================================
struct CraftRecipe {
  ItemId output = kNoItem;
  uint16_t outputCount = 1;
  std::vector<ItemStack> inputs;  // every stack must be present to craft
};

// The pinned survival HAND recipes (data; the UE layer lists/offers these).
inline CraftRecipe recipeCrudePickaxe() {
  return CraftRecipe{items::CrudePickaxe, 1,
                     {ItemStack{items::RawIron, 1}, ItemStack{items::Wood, 1}}};
}
inline CraftRecipe recipeCrudeAxe() {
  return CraftRecipe{items::CrudeAxe, 1,
                     {ItemStack{items::RawIron, 1}, ItemStack{items::Wood, 1}}};
}
inline CraftRecipe recipePrimitiveFurnace() {
  return CraftRecipe{items::PrimitiveFurnace, 1,
                     {ItemStack{items::Wood, 5}, ItemStack{items::RawIron, 2}}};
}
inline CraftRecipe recipeSurvivalSmelter() {
  return CraftRecipe{items::SurvivalSmelter, 1,
                     {ItemStack{items::Iron, 5}, ItemStack{items::Stone, 5}}};
}
// --- Electrification (§S.5). Costs are stated in SMELTED metal, so the power
// tier is gated behind having run the fuel tier first: you cannot build the
// thing that replaces the furnace until the furnace has done some work. That
// ordering is the whole progression, expressed as a bill of materials rather
// than as a lock.
inline CraftRecipe recipePowerPole() {
  return CraftRecipe{items::PowerPole, 1,
                     {ItemStack{items::Wood, 2}, ItemStack{items::Copper, 1}}};
}
inline CraftRecipe recipeBurnerGenerator() {
  return CraftRecipe{items::BurnerGenerator, 1,
                     {ItemStack{items::Iron, 8}, ItemStack{items::Copper, 4},
                      ItemStack{items::Stone, 4}}};
}
inline CraftRecipe recipeElectricSmelter() {
  return CraftRecipe{items::ElectricSmelter, 1,
                     {ItemStack{items::Iron, 10}, ItemStack{items::Copper, 5},
                      ItemStack{items::Stone, 5}}};
}

// All the hand recipes the survival slice offers (the UE craft menu binds to this).
inline std::vector<CraftRecipe> handRecipes() {
  return {recipeCrudePickaxe(),   recipeCrudeAxe(),
          recipePrimitiveFurnace(), recipeSurvivalSmelter(),
          recipePowerPole(),      recipeBurnerGenerator(),
          recipeElectricSmelter()};
}

// WHY A CRAFT IS REFUSED, as a CODE and never as a sentence (GP-46's rule, and
// GP-51's defect). /core has no display names, so a sentence here would need a
// second copy of the name table inside the shim; and a boolean cannot tell
// "you are short of wood" from "your pack is full", which are opposite actions.
enum class CraftBlock : uint8_t {
  None = 0,        // craftable right now
  NoRecipe = 1,    // the recipe has no output (an empty/unknown row)
  InputsShort = 2, // some input stack is not in the pack
  PackFull = 3,    // the inputs ARE there and the output would not fit
};

class HandCrafter {
 public:
  // Can this recipe be crafted from `inv` right now? (Every input present.)
  //
  // DELIBERATELY INPUTS ONLY, and it stays that way: `payInputs` produces no
  // output at all, so a fit test here would refuse a foundation because the
  // pack was full of stone it was about to spend. The OUTPUT side is
  // `craftBlock`, which is the question `craft` asks.
  static bool canCraft(const CraftRecipe& r, const Inventory& inv) {
    if (r.output == kNoItem) return false;
    for (const ItemStack& in : r.inputs)
      if (in.item != kNoItem && !inv.has(in.item, in.count)) return false;
    return true;
  }

  /**
   * Why this craft would be refused, or `None`.
   *
   * THE FIT TEST RUNS ON A COPY OF THE REAL PACK, THROUGH THE REAL OPERATIONS
   * (GP-51). It is not a model of the stacking rules and must never become one:
   * the inputs are removed FIRST, which frees slots, so "is there room" is only
   * answerable after the spend. A pack of 20 full slots whose last slot holds
   * exactly the 5 Wood a furnace costs HAS room for the furnace, and a
   * free-slot count taken before the spend says it does not. An `Inventory` is
   * 20 `ItemStack`s and a registry pointer, so the copy is a few dozen bytes and
   * costs nothing at UI rates.
   */
  static CraftBlock craftBlock(const CraftRecipe& r, const Inventory& inv) {
    if (r.output == kNoItem) return CraftBlock::NoRecipe;
    if (!canCraft(r, inv)) return CraftBlock::InputsShort;
    Inventory probe = inv;  // the production path, not a re-derivation of it
    spend(r, probe);
    return probe.add(r.output, r.outputCount) == 0 ? CraftBlock::None
                                                   : CraftBlock::PackFull;
  }

  /**
   * Craft it: ALL-OR-NOTHING, in BOTH directions.
   *
   * GP-51. This used to spend the inputs, call `inv.add`, DISCARD the overflow
   * and return true, with a comment reasoning that tools and structures stack
   * small so it was "effectively never hit in the slice". The slice then grew a
   * science pack that a player crafts a dozen times with a pack full of ore, and
   * the only symptom of the loss is that nothing happens: the materials are
   * gone, the item never existed, and every instrument reads success. An
   * operation that reports an outcome it did not achieve is the failure class
   * standing rule 11 is about, so the craft now REFUSES and the caller has a
   * code (`craftBlock`) to say why.
   */
  static bool craft(const CraftRecipe& r, Inventory& inv) {
    if (craftBlock(r, inv) != CraftBlock::None) return false;
    spend(r, inv);
    // Asserted by construction: craftBlock ran this exact sequence on a copy of
    // this exact pack and saw zero overflow, so the output cannot be dropped.
    const uint16_t dropped = inv.add(r.output, r.outputCount);
    return dropped == 0;
  }

  // PAY the inputs of a recipe WITHOUT producing its output (§S.6). This is what
  // placing a structure costs: a foundation is raised straight out of the pack
  // against its bill of materials, it is never crafted into a carried item first.
  // Same all-or-nothing rule as craft(), and deliberately expressed in terms of
  // canCraft() so the rule lives in exactly one place: false consumes nothing.
  static bool payInputs(const CraftRecipe& r, Inventory& inv) {
    if (!canCraft(r, inv)) return false;
    spend(r, inv);
    return true;
  }

 private:
  // The consume half, in ONE place, so the fit probe and the real craft cannot
  // spend different things. This is the "pin the fixture against the production
  // path" rule from standing rule 11 applied at the point it matters.
  static void spend(const CraftRecipe& r, Inventory& inv) {
    for (const ItemStack& in : r.inputs)
      if (in.item != kNoItem) inv.remove(in.item, in.count);
  }
};

// =============================================================================
// §S.4 — Furnace / smelter: tick-driven, FUEL-pool smelting.
//
// WHY ITS OWN TYPE (not a factory-sim machine) — the design decision:
//   factory_sim.h's machine model converts ore->ingot over time gated by a POWER
//   NETWORK (per-tick supply/demand → brownout). The survival furnace is gated by
//   a consumable SOLID-FUEL pool instead: each smelt burns "fuel ticks" from a
//   pool topped up by inserting wood/coal, where coal yields far more smelts per
//   unit than wood. That fuel-burn pool has no representation in the power model,
//   and bolting it on would distort factory-sim's hot SoA path. A small, focused,
//   deterministic gameplay-layer Furnace is cleaner and self-contained; the only
//   difference between the two tiers (furnace vs smelter) is a data parameter —
//   ticksPerSmelt — so "smelter is faster" is one number, not new code.
//
// FUEL MODEL: a fuel item contributes `fuelTicksPerUnit` ticks of burn time when
// inserted (the pool, `fuelTicks_`). One smelt costs `ticksPerSmelt` of BOTH craft
// progress AND fuel burn. Per the brief's "smelts per unit" framing: with
// furnace ticksPerSmelt=180, wood gives ~2 smelts/unit (360 fuel ticks) and coal
// ~8 (1440 fuel ticks); the smelter (ticksPerSmelt=60) gets MORE smelts per unit
// of the same fuel because each smelt is cheaper — the fuel pool is in ticks, so
// the "smelts per unit" scales naturally with the tier. The furnace only makes
// progress on a tick when it has BOTH an ore loaded AND fuel remaining, so it
// stalls deterministically when starved of either.
// =============================================================================

// Fuel burn-time (in furnace ticks) a unit of a fuel item contributes. Coal burns
// far longer than wood. Non-fuel items contribute nothing (cannot be loaded).
inline uint32_t fuelTicksPerUnit(ItemId item) {
  if (item == items::Coal) return 1440;  // ~8 furnace smelts (180t) / unit
  if (item == items::Wood) return 360;   // ~2 furnace smelts (180t) / unit
  return 0;                               // not a fuel
}

// The furnace tier — the two FUEL rungs, which are the ones survival::Furnace
// can run. The electric rung is not a FurnaceTier because it is not a Furnace:
// it has no fuel pool, and asking a Furnace to draw watts is exactly the second
// authority the §S.0 ladder table exists to prevent.
enum class FurnaceTier : uint8_t { Furnace = 0, Smelter = 1 };

inline SmeltTierId smeltTierOf(FurnaceTier t) {
  return t == FurnaceTier::Smelter ? SmeltTierId::Smelter
                                   : SmeltTierId::PrimitiveFurnace;
}
// Reads the §S.0 ladder, so the tier speeds are stated once.
inline uint32_t ticksPerSmeltFor(FurnaceTier t) {
  return smeltTier(smeltTierOf(t)).ticksPerSmelt;
}

// What a furnace smelts: ore in -> ingot out (the two survival smelts).
inline ItemId smeltOutputFor(ItemId ore) {
  if (ore == items::RawIron) return items::Iron;
  if (ore == items::RawCopper) return items::Copper;
  return kNoItem;
}

class Furnace {
 public:
  explicit Furnace(FurnaceTier tier = FurnaceTier::Furnace)
      : tier_(tier), ticksPerSmelt_(ticksPerSmeltFor(tier)) {}

  FurnaceTier tier() const { return tier_; }
  uint32_t ticksPerSmelt() const { return ticksPerSmelt_; }

  // --- Loading (scene/UI ops, not the tick) --------------------------------
  // Load ore into the input buffer (only smeltable ore is accepted). Returns the
  // amount actually accepted.
  uint16_t loadOre(ItemId ore, uint16_t count) {
    if (smeltOutputFor(ore) == kNoItem || count == 0) return 0;
    if (oreItem_ != kNoItem && oreItem_ != ore && oreCount_ > 0) return 0;  // one ore type at a time
    oreItem_ = ore;
    oreCount_ = static_cast<uint16_t>(oreCount_ + count);
    return count;
  }

  // Insert fuel: adds the item's burn time to the fuel pool. Returns true if the
  // item was a valid fuel (and was burned into the pool).
  bool loadFuel(ItemId fuel, uint16_t count = 1) {
    const uint32_t per = fuelTicksPerUnit(fuel);
    if (per == 0 || count == 0) return false;
    fuelTicks_ += per * count;
    return true;
  }

  // Pull finished ingots out of the output buffer (e.g. into an inventory).
  uint16_t takeOutput(uint16_t want) {
    const uint16_t take = want < outCount_ ? want : outCount_;
    outCount_ = static_cast<uint16_t>(outCount_ - take);
    if (outCount_ == 0) outItem_ = kNoItem;
    return take;
  }

  // --- The deterministic tick ----------------------------------------------
  // Advance one tick. Progress is made ONLY when there is ore loaded AND fuel in
  // the pool; each progressing tick burns one fuel tick. On reaching ticksPerSmelt
  // a unit of ore becomes a unit of ingot. Returns true on the tick a smelt
  // completes. Idle (no ore / no fuel) ticks are no-ops — deterministic stalls.
  bool tick() {
    // Need ore to smelt and fuel to burn; otherwise stall (no progress).
    if (oreCount_ == 0 || fuelTicks_ == 0) {
      smelting_ = false;
      return false;
    }
    smelting_ = true;
    ++progress_;
    --fuelTicks_;
    if (progress_ >= ticksPerSmelt_) {
      // complete one smelt: one ore -> one ingot.
      const ItemId ingot = smeltOutputFor(oreItem_);
      --oreCount_;
      if (outItem_ == kNoItem) outItem_ = ingot;
      if (outItem_ == ingot) ++outCount_;
      progress_ = 0;
      if (oreCount_ == 0) oreItem_ = kNoItem;
      smelting_ = false;
      return true;
    }
    return false;
  }

  // Run N ticks; returns the number of smelts completed in the window.
  uint32_t run(uint32_t ticks) {
    uint32_t done = 0;
    for (uint32_t i = 0; i < ticks; ++i)
      if (tick()) ++done;
    return done;
  }

  // --- Read state (tests / UI) ---------------------------------------------
  uint16_t oreCount() const { return oreCount_; }
  ItemId oreItem() const { return oreItem_; }
  uint16_t outputCount() const { return outCount_; }
  ItemId outputItem() const { return outItem_; }
  uint32_t fuelTicks() const { return fuelTicks_; }
  uint32_t progress() const { return progress_; }
  bool smelting() const { return smelting_; }
  bool hasFuel() const { return fuelTicks_ > 0; }

 private:
  FurnaceTier tier_;
  uint32_t ticksPerSmelt_ = 180;
  ItemId oreItem_ = kNoItem;
  uint16_t oreCount_ = 0;
  ItemId outItem_ = kNoItem;
  uint16_t outCount_ = 0;
  uint32_t fuelTicks_ = 0;   // the fuel burn-time pool (ticks remaining)
  uint32_t progress_ = 0;    // current smelt progress in ticks
  bool smelting_ = false;    // true while actively progressing (ore+fuel present)
};

// =============================================================================
// §S.6 — STRUCTURAL BUILDING SET (base building).
//
// Five placeable structural parts (foundation, floor, wall, door and, since
// GP-57, the launch pad) authored as DATA (GP-12), so balance iterates without a
// recompile of any system.
//
// WHY THESE ARE NOT automation.h BuildKinds — the decision, already taken:
//   a foundation never ticks, has no input or output ports, draws no power and
//   holds no inventory. Handing it to FactorySim would put a permanently inert
//   row in the hot SoA entity arrays and make "does this entity do anything?" a
//   runtime question instead of a type-level one. So the structural set is a
//   gameplay-layer type, exactly as GP-19 made the survival Furnace a
//   gameplay-layer type rather than a factory-sim machine. The renderer/placement
//   layer binds to the TypeId; the sim never sees it.
//
// WHY THE COST IS A CraftRecipe BUT NOT A HAND RECIPE — a structure is placed
// from the build menu straight against its bill of materials; it is never
// crafted into a carried item first. Reusing CraftRecipe keeps one id space and
// one all-or-nothing rule (HandCrafter::payInputs, §S.3, which pays the inputs
// and adds nothing). handRecipes() deliberately does NOT list these four: they
// are not in the craft menu.
//
// Ids: items 0x0040..0x0043, entity TypeIds 0x40..0x43 (ASSET-SPECS §4 is the
// TypeId authority; the shipped art is assets/models/dist/structures/*.glb).
// =============================================================================
// GP-57. THE LAUNCH PAD IS THE FIFTH MEMBER OF THIS ENUM, AND IT IS NOT THE
// FIFTH MEMBER OF THE CLIENT'S ENUM OF THE SAME NAME. Worth stating here,
// because the two look like one thing and are not.
//
// THIS enum is a COST-AND-IDENTITY TAG. `StructureDef` is {kind, item, typeId,
// name, cost} and carries no geometry, no address, no footprint and no tiling
// rule, so the only question membership asks is the one the section header
// above already poses: does this thing tick, hold ports, draw power or carry an
// inventory? A launch pad does none of those, exactly as a foundation does
// none of them, so it belongs here by the section's own stated criterion. Its
// reward for joining is the entire `of_gp_structure_*` bridge surface: count,
// info, can_afford and pay are all indexed reads over `structureDefs()`, so a
// fifth row reaches the browser with NO ABI CHANGE and with one cost authority
// rather than two.
//
// THE CLIENT's `StructureKind` is a different thing wearing the same four
// names: it is the 4 m TILING MODULE, and every function that switches on it
// (`isDeck`, `addressAt`, `anchorOf`, `footprintOf`, `supported`, `addrKey`)
// asks a question a 24 x 24 m monolith cannot answer. Adding a fifth member
// there would grow six branches that all say "not this one", which is precisely
// the argument this section already makes for keeping a foundation out of
// `automation.h`'s `BuildKind`, one level down. So the pad has its own client
// module and the two enums are joined by `StructureDef::kind` as a FIELD rather
// than by array position.
//
// D-019 APPENDS THE RESEARCH STATION AS THE SIXTH MEMBER, on the identical
// argument and with the identical reward. It ticks nothing, holds nothing, has
// no ports and draws no power; it is a thing that STANDS somewhere, and the
// whole of what the game asks of it is "does one exist". So it joins here, it
// inherits count / info / can_afford / pay through `of_gp_structure_*` with NO
// ABI CHANGE (every one of those is an indexed read over `structureDefs()`),
// and its price has exactly one authority, which is the row below.
//
// AND IT IS NOT IN THE CLIENT'S `StructureKind` EITHER, for the pad's reason
// verbatim: that enum is the 4 m tiling module and a research station answers
// none of its questions. The client places it the way it places a hand furnace,
// which is the closest existing simple machine and is the pattern this followed.
enum class StructureKind : uint8_t {
  Foundation = 0, Floor = 1, Wall = 2, Door = 3, LaunchPad = 4,
  ResearchStation = 5,
};

struct StructureDef {
  StructureKind kind;
  ItemId item;        // the item form (items::Foundation, ...)
  uint16_t typeId;    // the placed entity TypeId (types::Foundation, ...)
  const char* name;   // display name
  CraftRecipe cost;   // output = this structure's own item; inputs = BUILD COST
};

// The structural parts. The first four are Tier-0 costs: cheap, legible, and
// payable from a first-hour pack (stone from rocks, wood from trees, iron ingots
// for a door). The fifth, the launch pad, is not Tier-0 at all and says why.
//
// RE-PRICED FOR THE 4 m MODULE ON 2026-07-27 (GP-40, following DW-32). The
// prices were authored against a 1 m module and DW-32 made every part sixteen
// times the area, so a 20 x 20 m platform fell from 400 foundations at 1,600
// Stone to 25 at 100 Stone: a 16x discount that nobody chose. The new prices are
// 10x on the two decks and 4x on the two wall parts, DELIBERATELY short of full
// area parity, because DW-32's stated purpose was to cut the grind rather than
// to relabel it. Full parity would have restored 1,600 Stone for the same
// platform and made the rescale purely cosmetic; 10x lands it at 1,000, which
// is a real discount that still reads as a serious commitment of stone.
//
// The two families scale differently because they are different shapes. A deck
// is an AREA and went up 16x in plan, so 10x is a visible discount on it. A wall
// is a LINE: it went from 1 m to 4 m wide and from 2.50 m to 3.50 m tall, which
// is 5.6x the panel, so 4x is the same kind of discount applied to the same kind
// of growth. The door keeps the wall's wood ratio and its iron goes 1 -> 4,
// because iron is the gate on a door and a gate that did not move would have
// been a 16x discount on the only interesting ingredient in the set.
//
// A 20 x 20 m room with four walls a side and one door now costs 1,000 Stone,
// 500 Wood + 500 Stone of decking if it is floored, and 16 wall panels at 12
// Wood with one of them a door at 16 Wood + 4 Iron.
inline std::vector<StructureDef> structureDefs() {
  return {
      StructureDef{StructureKind::Foundation, items::Foundation, types::Foundation,
                   "Foundation",
                   CraftRecipe{items::Foundation, 1,
                               {ItemStack{items::Stone, 40}}}},
      StructureDef{StructureKind::Floor, items::Floor, types::Floor, "Floor",
                   CraftRecipe{items::Floor, 1,
                               {ItemStack{items::Wood, 20}, ItemStack{items::Stone, 20}}}},
      StructureDef{StructureKind::Wall, items::Wall, types::Wall, "Wall",
                   CraftRecipe{items::Wall, 1,
                               {ItemStack{items::Wood, 12}}}},
      StructureDef{StructureKind::Door, items::Door, types::Door, "Door",
                   CraftRecipe{items::Door, 1,
                               {ItemStack{items::Wood, 16}, ItemStack{items::Iron, 4}}}},
      // GP-57 / GP-58. THE LAUNCH PAD, and its price is set by what it SITS ON
      // rather than by its own area. It is founded on a 6 x 6 block of decks
      // (GP-58: measured, a 24 m footprint on natural ground is accepted at
      // 3.7% of sampled origins against 59.3% for a 4 m one, so a pad is laid
      // on prepared ground and never on soil), which is 36 foundations at 40
      // Stone = 1,440 Stone before this row is paid at all. So the pad's own
      // bill is deliberately NOT another 1,440: it is the STEEL, because the
      // platform is already the stone and charging for it twice would price the
      // gate at the wrong thing.
      //
      // Iron is the binding ingredient on purpose. 60 ingots is 60 smelts, and
      // a hand furnace runs one every 180 ticks, so a player who tries to reach
      // orbit on a single furnace is looking at three hours of it. That is the
      // pressure DW-29 asks for in one number: the two halves of the game are
      // tied together by making the rocket programme need the factory. Copper
      // is 20 rather than 60 because it is the floodlights, the umbilical and
      // the wiring, and a second sixty-unit gate would be one gate too many.
      StructureDef{StructureKind::LaunchPad, items::LaunchPad, types::LaunchPad,
                   "Launch pad",
                   CraftRecipe{items::LaunchPad, 1,
                               {ItemStack{items::Iron, 60},
                                ItemStack{items::Stone, 120},
                                ItemStack{items::Copper, 20}}}},
      // D-019, THE RESEARCH STATION, and its price is set by WHERE IT SITS IN
      // THE STORYLINE. `story_line_outline_v1.txt` puts building it after belts
      // and smelting and before the scanning antenna, so the bill has to be
      // payable by a player who has run a furnace and cannot be payable by one
      // who has only swung an axe.
      //
      // IRON 20 IS THE GATE, and it is a third of the pad's 60 on purpose: 20
      // smelts is 3,600 ticks on a primitive furnace, which is a minute of a
      // furnace's life rather than the pad's three hours. This is the rung that
      // teaches "smelt more", not the one that teaches "automate or give up".
      //
      // COPPER 10 IS WHY YOU EVER MINED THE OTHER ORE. Raw copper has until now
      // been worth digging only for the power branch (pole / generator /
      // electric smelter), so a first-hour player has a copper patch on their
      // map and no reason to touch it. Ten ingots makes the station the first
      // thing that wants BOTH metals, which is exactly what "after smelting"
      // means as a bill of materials rather than as a lock.
      //
      // STONE 30 IS THE MASS, hand-harvested and cheap: less than one
      // foundation (40), so it reads as a bench and a floor under it.
      //
      // AND THERE IS DELIBERATELY NO WOOD IN IT, which is the one judgement in
      // this row worth defending. Wood is the obvious first-hour ingredient and
      // it is the one ingredient this game has a body with NONE of:
      // `StarterContent`'s own invariant refuses to place a tree on an airless
      // body, and `OBJECTIVES`' `moot` clause exists because "Harvest a tree"
      // was the first impossible line a player read on Cinder. A wood cost here
      // would make the research station itself impossible there, which is a
      // progression deadlock rather than a moot checklist row. Stone, iron and
      // copper exist on every body in the game.
      StructureDef{StructureKind::ResearchStation, items::ResearchStation,
                   types::ResearchStation, "Research station",
                   CraftRecipe{items::ResearchStation, 1,
                               {ItemStack{items::Iron, 20},
                                ItemStack{items::Stone, 30},
                                ItemStack{items::Copper, 10}}}},
  };
}

}  // namespace survival

}  // namespace gameplay
}  // namespace of
