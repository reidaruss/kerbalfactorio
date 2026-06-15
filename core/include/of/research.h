#pragma once
// =============================================================================
// research.h — Phase-2 research / tech tree (the Factorio-style progression
// spine the slice deferred: GP-1 produce-science→unlock, GP-2 off-world gating).
//
// This realizes the two progression decisions the Phase-1 slice planted but did
// NOT wire (docs/controllers/gameplay.md GP-1, GP-2; docs/phase1 §7.4 "the gate
// is the Phase-2 hook gameplay adds when research lands"):
//
//   GP-1  Research = produce *science* in the factory, then SPEND it to UNLOCK
//         recipes / entities. Science is just ItemStacks in an inventory pool;
//         a tech's `cost` is the science it consumes. (Factorio model.)
//   GP-2  Off-world resources GATE mid/late tech. A tech (CinderiteRefining)
//         costs a Cinderite-derived item — so it CANNOT be researched until the
//         player has mined Cinder. This is the mechanism that makes the
//         KSP×Factorio crossover *matter*: progression forces you off-world.
//   GP-12 The tech tree is DATA (a curated TechDef table), so balance iterates
//         without code — exactly as the slice content is data in SliceRegistry.
//
// Additive, header-only. CONSUMES gameplay.h verbatim (ItemId / ItemStack /
// Inventory / RecipeId / TypeId / SliceRegistry, the SINGLE id space, C-3).
// It never touches the factory / world / physics cores — research is a pure
// gameplay progression layer: it reads a science inventory and flips unlock
// bits the build/recipe UX gates on (IsRecipeUnlocked / IsTechUnlocked).
//
// Science items live in the same opaque uint16 ItemId space (C-3 / GP-13);
// the slice's playable 12-item block ended at 0x0016, so science packs append
// at 0x0020+ (stable, never reused). They are produced by the factory exactly
// like any other item (a future assembler recipe), so "produce science" needs
// no new mechanism — it is just inventory the player accumulates and spends.
// =============================================================================
#include <cstdint>
#include <vector>
#include <string>

#include "of/gameplay.h"

namespace of {
namespace gameplay {

// =============================================================================
// §A — Science items: appended to the canonical ItemId block (C-3, stable).
//
// Not part of the pinned playable-slice 12 (those are 0x0001…0x0016); these are
// the research-layer additions, appended at 0x0020 so the slice block is never
// renumbered. They are ordinary ItemDefs (Category::None == "science" grouping
// for now) the factory could produce; research just consumes them.
// =============================================================================
namespace items {
static constexpr ItemId AutomationScience = 0x0020;  // tier-1 science pack
static constexpr ItemId LogisticScience = 0x0021;    // tier-2 science pack
static constexpr ItemId CinderScience = 0x0022;      // off-world science (Cinderite-derived)
}  // namespace items

// Register the research-layer science items into a SliceRegistry so the existing
// Inventory plumbing (stack caps, lookups) works for them. Call once after
// constructing the registry, before building any science Inventory from it.
// Idempotent: re-registering an already-present id is a no-op (returns true if
// all three are present afterwards). Data-driven (GP-12) — the only "code" per
// science item is this table row.
inline bool RegisterScienceItems(SliceRegistry& reg) {
  reg.registerItem(ItemDef{items::AutomationScience, "Automation science",
                           ItemCategory::None, /*stackMax*/ 200, kFlagNone,
                           kNoType});
  reg.registerItem(ItemDef{items::LogisticScience, "Logistic science",
                           ItemCategory::None, /*stackMax*/ 200, kFlagNone,
                           kNoType});
  reg.registerItem(ItemDef{items::CinderScience, "Cinder science",
                           ItemCategory::None, /*stackMax*/ 200, kFlagNone,
                           kNoType});
  return reg.item(items::AutomationScience) && reg.item(items::LogisticScience) &&
         reg.item(items::CinderScience);
}

// =============================================================================
// §B — TechId + TechDef (the data-driven tech tree, GP-12).
// =============================================================================

// A tech id. uint16, opaque, hand-assigned stable constants (mirrors ItemId's
// discipline, GP-13). 0 = no tech.
using TechId = uint16_t;
static constexpr TechId kNoTech = 0;

// Canonical TechId block (stable, append-only, never reused).
namespace techs {
static constexpr TechId BasicSmelting = 0x0001;     // unlocks smelter + assembler recipes
static constexpr TechId Logistics = 0x0002;         // unlocks belts + box (needs BasicSmelting)
static constexpr TechId CinderiteRefining = 0x0003; // OFF-WORLD GATE: needs Cinderite (GP-2)
}  // namespace techs

// One node of the tech tree (GP-12: pure data, no code per tech).
//   - prereqs : techs that must already be unlocked
//   - cost    : the science (ItemStacks) consumed on research — affordability
//               is checked against, and deducted from, a provided inventory pool
//   - unlockRecipes / unlockEntities : the content this tech makes available
struct TechDef {
  TechId id = kNoTech;
  std::string name;
  std::vector<TechId> prereqs;
  std::vector<ItemStack> cost;            // science items + counts (GP-1)
  std::vector<RecipeId> unlockRecipes;    // recipes unlocked on research
  std::vector<TypeId> unlockEntities;     // entity classes unlocked on research
};

// =============================================================================
// §B.2 — The slice tech tree as DATA (GP-12). A handful of techs:
//   BasicSmelting   — cheap (automation science) → unlocks smelter + assembler
//                     recipes (Smelt Ferrite, Assemble Frame). No prereqs.
//   Logistics       — needs BasicSmelting → unlocks belt + box entities.
//   CinderiteRefining — the OFF-WORLD tech (GP-2): its cost includes a
//                     Cinderite-derived item, so it CANNOT be researched on
//                     Forge alone. Needs BasicSmelting. Unlocks the Mine
//                     Cinderite recipe (the off-world extraction gate hook).
// =============================================================================
class TechTree {
 public:
  TechTree() { build(); }

  const TechDef* tech(TechId id) const {
    for (const TechDef& t : techs_)
      if (t.id == id) return &t;
    return nullptr;
  }
  const std::vector<TechDef>& allTechs() const { return techs_; }

 private:
  std::vector<TechDef> techs_;

  void build() {
    using namespace techs;
    using namespace items;

    TechDef basicSmelting;
    basicSmelting.id = BasicSmelting;
    basicSmelting.name = "Basic Smelting";
    // No prereqs — the first tech, cheap.
    basicSmelting.cost = {ItemStack{AutomationScience, 10}};
    basicSmelting.unlockRecipes = {recipes::SmeltFerrite, recipes::AssembleFrame};
    basicSmelting.unlockEntities = {types::Smelter, types::Assembler};

    TechDef logistics;
    logistics.id = Logistics;
    logistics.name = "Logistics";
    logistics.prereqs = {BasicSmelting};
    logistics.cost = {ItemStack{AutomationScience, 15},
                      ItemStack{LogisticScience, 10}};
    logistics.unlockEntities = {types::Belt, types::Box};

    // The off-world gate (GP-2): CinderiteRefining costs a Cinderite-derived
    // science pack. CinderScience can only be produced from Cinderite, which is
    // Cinder-only (P1-D4 / WG-4) — so this tech is unreachable until the player
    // has mined Cinder. This is the crossover-making gate.
    TechDef cinderite;
    cinderite.id = CinderiteRefining;
    cinderite.name = "Cinderite Refining";
    cinderite.prereqs = {BasicSmelting};
    cinderite.cost = {ItemStack{AutomationScience, 20},
                      ItemStack{CinderScience, 5}};  // <-- the off-world gate item
    cinderite.unlockRecipes = {recipes::MineCinderite};

    techs_ = {basicSmelting, logistics, cinderite};
  }
};

// =============================================================================
// §C — ResearchState: unlocked techs + the unlocked recipe/entity sets, plus
// TryResearch (the spend-science-to-unlock operation, GP-1).
//
// `science` is any Inventory holding the produced science items (and, for the
// off-world gate, the Cinderite-derived item). TryResearch is ALL-OR-NOTHING:
// it succeeds and consumes the cost only if every prereq is unlocked AND the
// full cost is affordable; otherwise it consumes nothing and returns false.
// Unlocking is monotonic (a tech, once unlocked, never re-locks) and
// deterministic (no hidden state — same tree + same inputs → same result).
// =============================================================================
class ResearchState {
 public:
  explicit ResearchState(const TechTree& tree) : tree_(&tree) {}

  // ---- Queries -------------------------------------------------------------
  bool isUnlocked(TechId id) const {
    for (TechId t : unlockedTechs_)
      if (t == id) return true;
    return false;
  }

  // A recipe is unlocked iff some unlocked tech listed it (the build/craft UX
  // gates on this — a recipe behind a tech is unavailable until researched).
  bool isRecipeUnlocked(RecipeId id) const {
    for (RecipeId r : unlockedRecipes_)
      if (r == id) return true;
    return false;
  }

  // An entity class is unlocked iff some unlocked tech listed it (the build
  // palette gates on this).
  bool isEntityUnlocked(TypeId id) const {
    for (TypeId e : unlockedEntities_)
      if (e == id) return true;
    return false;
  }

  const std::vector<TechId>& unlockedTechs() const { return unlockedTechs_; }
  const std::vector<RecipeId>& unlockedRecipes() const { return unlockedRecipes_; }
  const std::vector<TypeId>& unlockedEntities() const { return unlockedEntities_; }

  // Are all of a tech's prereqs unlocked? (A precondition of researchability.)
  bool prereqsMet(TechId id) const {
    const TechDef* def = tree_->tech(id);
    if (!def) return false;
    for (TechId p : def->prereqs)
      if (!isUnlocked(p)) return false;
    return true;
  }

  // Is the tech's full science cost affordable from `science`? (The other
  // precondition — and the OFF-WORLD GATE check for CinderiteRefining: its
  // Cinderite-derived cost item is only present once Cinder was reached.)
  bool costAffordable(TechId id, const Inventory& science) const {
    const TechDef* def = tree_->tech(id);
    if (!def) return false;
    for (const ItemStack& c : def->cost)
      if (c.item != kNoItem && !science.has(c.item, c.count)) return false;
    return true;
  }

  // Can this tech be researched RIGHT NOW from this science pool? (Not yet
  // unlocked, def exists, prereqs met, cost affordable.) Pure query — no
  // mutation; the ghost/UI uses it to grey-out unaffordable techs.
  bool canResearch(TechId id, const Inventory& science) const {
    const TechDef* def = tree_->tech(id);
    if (!def) return false;
    if (isUnlocked(id)) return false;  // already done (idempotent)
    return prereqsMet(id) && costAffordable(id, science);
  }

  // ---- The unlock operation (GP-1) -----------------------------------------
  // Attempt to research `id`, spending science from `science`. Returns true and
  // applies the unlock (consuming the cost) iff canResearch held; otherwise
  // returns false and consumes NOTHING. Idempotent: researching an already-
  // unlocked tech is a no-op that returns false (nothing to consume/apply).
  bool tryResearch(TechId id, Inventory& science) {
    if (!canResearch(id, science)) return false;
    const TechDef* def = tree_->tech(id);
    // Consume the cost (validated affordable above — every remove succeeds).
    for (const ItemStack& c : def->cost)
      if (c.item != kNoItem) science.remove(c.item, c.count);
    apply(*def);
    return true;
  }

 private:
  const TechTree* tree_;
  std::vector<TechId> unlockedTechs_;
  std::vector<RecipeId> unlockedRecipes_;
  std::vector<TypeId> unlockedEntities_;

  // Mark the tech unlocked and apply its unlocks (monotonic; dedup-safe).
  void apply(const TechDef& def) {
    if (!isUnlocked(def.id)) unlockedTechs_.push_back(def.id);
    for (RecipeId r : def.unlockRecipes)
      if (!isRecipeUnlocked(r)) unlockedRecipes_.push_back(r);
    for (TypeId e : def.unlockEntities)
      if (!isEntityUnlocked(e)) unlockedEntities_.push_back(e);
  }
};

}  // namespace gameplay
}  // namespace of
