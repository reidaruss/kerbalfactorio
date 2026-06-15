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
using DepositId = uint32_t;
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

}  // namespace gameplay
}  // namespace of
