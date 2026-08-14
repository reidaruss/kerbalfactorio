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
// The SURVIVAL tech tree (§D) gates armour, so it names armour ItemIds. The
// dependency is one-way and states the layering honestly: a tech tree is
// CONTENT that references content, and nothing in progression.h knows research
// exists. progression.h consumes gameplay.h and nothing else, so there is no
// cycle.
#include "of/progression.h"

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
// §A.2 — Science RECIPES (GAP-3): the content that turns intermediates / off-
// world ore into the science packs above. "Produce science in the factory" is
// just a recipe whose OUTPUT is a science ItemId (research.h §intro) — so these
// are ordinary RecipeDefs the factory executes, authored as data (GP-12). They
// append in the shared RecipeId space at 0x0120+ (mirroring the 0x0020+ science
// item block; the playable-slice recipes end at 0x0105, never renumbered).
//
//   CraftAutomationScience : 1 Ferrite plate  -> 1 AutomationScience   (basic)
//   RefineCinderScience    : 1 Cinderite      -> 1 CinderScience     (OFF-WORLD)
//
// RefineCinderScience is the missing conversion the slice's off-world gate needs:
// CinderiteRefining costs CinderScience (GP-2), and CinderScience can ONLY be made
// from Cinderite, which is Cinder-only (WG-4) — so this recipe closes the
// mine-Cinder → refine → research-off-world-tech chain as real content.
// =============================================================================
namespace recipes {
static constexpr RecipeId CraftAutomationScience = 0x0120;  // plate -> automation sci
static constexpr RecipeId RefineCinderScience = 0x0121;     // Cinderite -> cinder sci (off-world)
}  // namespace recipes

// Build the basic science recipe def (Ferrite plate -> AutomationScience).
inline RecipeDef makeAutomationScienceRecipe() {
  RecipeDef r;
  r.recipeId = recipes::CraftAutomationScience;
  r.machineTypeId = types::Assembler;  // crafted in an assembler (a "lab", slice-level)
  r.inputItem = items::FerritePlate;
  r.inputCount = 1;
  r.outputItem = items::AutomationScience;
  r.outputCount = 1;
  r.timeTicks = 60;
  r.powerW = 1200;
  return r;
}

// Build the OFF-WORLD science recipe def (Cinderite -> CinderScience). This is
// the GP-2 refining step: only runnable once the player has mined Cinderite.
inline RecipeDef makeCinderScienceRecipe() {
  RecipeDef r;
  r.recipeId = recipes::RefineCinderScience;
  r.machineTypeId = types::Assembler;
  r.inputItem = items::Cinderite;       // off-world ore in
  r.inputCount = 1;
  r.outputItem = items::CinderScience;  // off-world science out
  r.outputCount = 1;
  r.timeTicks = 90;
  r.powerW = 1500;
  return r;
}

// Register the science recipes into a SliceRegistry (append-only, GP-12). Call
// once after RegisterScienceItems. Idempotent: re-registering is a no-op. Returns
// true once both science recipes are present in the registry.
inline bool RegisterScienceRecipes(SliceRegistry& reg) {
  reg.registerRecipe(makeAutomationScienceRecipe());
  reg.registerRecipe(makeCinderScienceRecipe());
  return reg.recipe(recipes::CraftAutomationScience) &&
         reg.recipe(recipes::RefineCinderScience);
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
// --- The SURVIVAL tree (§D), the one the playable client gates on. Appended,
// so the three slice ids above are never renumbered.
static constexpr TechId Electrification = 0x0010;    // poles + burner generator
static constexpr TechId ElectricSmelting = 0x0011;   // the 30 kW smelting rung
static constexpr TechId Metallurgy = 0x0012;         // helm + boots
static constexpr TechId PlateArmour = 0x0013;        // cuirass + greaves
static constexpr TechId FlightAutopilot = 0x0014;    // DW-29: earned by flying, then researched
static constexpr TechId CinderRefining = 0x0015;     // OFF-WORLD GATE over survival content
static constexpr TechId LaunchFacilities = 0x0016;   // DW-29: the launch pad (GP-57)
static constexpr TechId ScanningAntenna = 0x0017;    // GP-533: the ruin-reveal antenna
}  // namespace techs

// GP-267. THE ITEM `FlightAutopilot` UNLOCKS, and the one id in this file that
// is allocated somewhere else.
//
// `vessel.h` says in its own header that the ITEM form of a part belongs to a
// pinned table and not to it, so the block is allocated in
// `web/wasm/of_vessel_api.inc` as `ItemId = 0x0050 + (PartId - 0x0100)`.
// `vessel::parts::AutopilotModule` is 0x010D, so the item is 0x005D.
//
// It is NOT re-derived here and it is NOT trusted: `of_vessel_api.inc` carries
// a `static_assert` that `partItemId(parts::AutopilotModule)` equals this
// constant, so the day either side moves the BUILD fails rather than the gate
// quietly unlocking nothing. A cross-file invariant that only a test can catch
// is a cross-file invariant that gets shipped broken once.
namespace parts_items {
static constexpr ItemId AutopilotModule = 0x005D;
}  // namespace parts_items

// =============================================================================
// A MILESTONE is a thing the player DID, not a thing they bought.
//
// DW-29 asks for a flight autopilot that is a research unlock EARNED BY HAVING
// REACHED ORBIT MANUALLY. That is not a science cost and it is not a prereq
// tech: it is a fact about the save. Modelling it as a third kind of
// precondition is what stops it being faked as either. A tech with no
// milestone (`kNoMilestone`, the default) behaves exactly as before, so every
// existing tech and every existing test is untouched by this field.
//
// The set is deliberately tiny and append-only. A milestone that no tech reads
// is a flag in a save file, and this project already has enough of those.
// =============================================================================
using MilestoneId = uint16_t;
static constexpr MilestoneId kNoMilestone = 0;

namespace milestones {
static constexpr MilestoneId ReachedOrbit = 0x0001;    // DW-29's own condition
static constexpr MilestoneId LandedOffWorld = 0x0002;  // the GP-2 crossover, later
// L7 (GP-546 to GP-549). `story_line_outline_v1.txt`'s ruins rung: "Investigate
// ruins (upon searching the ruins you gain the ability to research ... as well
// as research electricity)". Earned once, from live play, the SAME way
// `ReachedOrbit` is (grantMilestone in the web client): walking into the ruin
// and interacting at its `socket_investigate` point (WG-166/RN-1450 built the
// place; this is the lane that reads it). Deliberately NOT per-ruin: a second
// ruin's own "have I searched THIS one" bit is poi.h's existing `visited_`
// (WG-151), kept separate, because two ruins sharing one flag would make the
// second one's own visit un-rewardable and un-noticeable to the player.
static constexpr MilestoneId RuinInvestigated = 0x0003;
// GP-718. `story_line_outline_v1.txt`'s station rung, and the ONE-SHOT LATCH for
// the full-map reveal Reid ruled on 2026-08-13: "the full map should reveal
// whenever you explore the space station".
//
// IT IS A MILESTONE RATHER THAN A BOOLEAN IN THE CLIENT FOR ONE REASON, and it
// is the reason this whole namespace exists: a milestone is the only flag in
// this project that a LOAD restores without counting as something the player
// DID. `Research::setMilestone` no-ops on one already held, and the web client's
// restore path feeds `earn` directly rather than `grantMilestone`, so the reveal
// fires exactly once in a save's life and a reload cannot re-fire it. A `let
// revealed = false` next to the trigger would have to be persisted, migrated and
// kept honest by hand, and would be a second answer to "has this happened yet".
//
// NO TECH READS IT TODAY, which the note above says is normally a smell. It is
// declared anyway because what it gates is not a tech: it gates a world-state
// mutation (discovery.h's survey layer), and the append-only set is where a
// "thing the player did" belongs regardless of who reads it.
static constexpr MilestoneId StationBoarded = 0x0004;
}  // namespace milestones

inline const char* milestoneName(MilestoneId m) {
  switch (m) {
    case milestones::ReachedOrbit: return "reach orbit and come back";
    case milestones::LandedOffWorld: return "land on another world";
    case milestones::RuinInvestigated: return "investigate a ruin";
    case milestones::StationBoarded: return "board the space station";
    default: return "";
  }
}

// One node of the tech tree (GP-12: pure data, no code per tech).
//   - prereqs          : techs that must already be unlocked
//   - requiresMilestone: something the player must have DONE (DW-29)
//   - cost             : the science (ItemStacks) consumed on research —
//                        affordability is checked against, and deducted from, a
//                        provided inventory pool
//   - unlockRecipes / unlockEntities / unlockItems : the content this tech
//                        makes available
struct TechDef {
  TechId id = kNoTech;
  std::string name;
  std::vector<TechId> prereqs;
  MilestoneId requiresMilestone = kNoMilestone;
  std::vector<ItemStack> cost;            // science items + counts (GP-1)
  std::vector<RecipeId> unlockRecipes;    // recipes unlocked on research
  std::vector<TypeId> unlockEntities;     // entity classes unlocked on research
  // The ITEMS this tech makes craftable and placeable. Items rather than
  // RecipeIds because the survival hand recipes (`survival::CraftRecipe`) are
  // keyed by their OUTPUT and carry no RecipeId at all, so the output item is
  // the only handle both the craft menu and the build hotbar can hold.
  std::vector<ItemId> unlockItems;
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

  /** Build a tree from an authored table (§D's survival tree uses this). The
   *  default constructor is left alone so every existing caller and every
   *  existing test gets the same slice tree it always did. */
  explicit TechTree(std::vector<TechDef> defs) : techs_(std::move(defs)) {}

  const TechDef* tech(TechId id) const {
    for (const TechDef& t : techs_)
      if (t.id == id) return &t;
    return nullptr;
  }
  const std::vector<TechDef>& allTechs() const { return techs_; }

  /** Longest prereq chain behind this tech, so a UI can lay the graph out in
   *  columns without re-deriving the topology. 0 for a root. A cycle would
   *  recurse for ever, so the walk is bounded by the tree's own size, which is
   *  also the only depth a legal tree can reach. */
  uint32_t depthOf(TechId id) const { return depth(id, techs_.size() + 1); }

  // --- WHAT IS GATED AT ALL ---------------------------------------------------
  // THE RULE, and it is the whole design: an item or an entity is GATED if and
  // only if some tech in this tree mentions it. Everything the tree never names
  // is free for ever. That is why adding a tech is the ONLY edit needed to gate
  // something, and why there is no second "locked by default" list anywhere to
  // fall out of step with this one. Wood was never in a tech, so wood is free,
  // and nobody had to write that down.
  bool gatesItem(ItemId item) const {
    for (const TechDef& t : techs_)
      for (ItemId i : t.unlockItems)
        if (i == item) return true;
    return false;
  }
  bool gatesEntity(TypeId type) const {
    for (const TechDef& t : techs_)
      for (TypeId e : t.unlockEntities)
        if (e == type) return true;
    return false;
  }
  bool gatesRecipe(RecipeId r) const {
    for (const TechDef& t : techs_)
      for (RecipeId x : t.unlockRecipes)
        if (x == r) return true;
    return false;
  }

 private:
  std::vector<TechDef> techs_;

  uint32_t depth(TechId id, size_t budget) const {
    const TechDef* d = tech(id);
    if (d == nullptr || budget == 0) return 0;
    uint32_t best = 0;
    for (TechId p : d->prereqs) {
      const uint32_t k = depth(p, budget - 1) + 1;
      if (k > best) best = k;
    }
    return best;
  }

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

/** Why `tryResearch` would refuse. `None` means it would succeed. */
enum class ResearchBlock : uint8_t {
  None = 0,
  UnknownTech = 1,
  AlreadyUnlocked = 2,
  PrereqMissing = 3,
  MilestoneMissing = 4,
  CostShort = 5,
};

/** The refusal, with the thing that caused it. Exactly one of `prereq`,
 *  `milestone` and `item` is set, according to `block`. */
struct ResearchStatus {
  ResearchBlock block = ResearchBlock::None;
  TechId prereq = kNoTech;
  MilestoneId milestone = kNoMilestone;
  ItemId item = kNoItem;
  /** How many more of `item` are needed. 0 unless block == CostShort. */
  uint16_t shortBy = 0;

  bool ok() const { return block == ResearchBlock::None; }
};

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

  bool isItemUnlocked(ItemId id) const {
    for (ItemId i : unlockedItems_)
      if (i == id) return true;
    return false;
  }

  // --- WHAT THE UX ACTUALLY ASKS ---------------------------------------------
  // "Unlocked" and "available" are DIFFERENT QUESTIONS and conflating them is
  // how a tech tree ends up locking wood. Unlocked means a tech granted it.
  // AVAILABLE means the player may use it right now, which is true when the
  // tree never gated it at all OR when a tech has granted it. Every gate in the
  // client asks the second question; the first exists so a panel can say which
  // tech did the granting.
  bool isItemAvailable(ItemId id) const {
    return !tree_->gatesItem(id) || isItemUnlocked(id);
  }
  bool isEntityAvailable(TypeId id) const {
    return !tree_->gatesEntity(id) || isEntityUnlocked(id);
  }
  bool isRecipeAvailable(RecipeId id) const {
    return !tree_->gatesRecipe(id) || isRecipeUnlocked(id);
  }

  // --- MILESTONES (DW-29) -----------------------------------------------------
  /** Record that the player DID something. Monotonic and dedup-safe, like every
   *  other unlock here: a milestone that could be un-earned would need a rule
   *  for what happens to the tech it gated. */
  bool setMilestone(MilestoneId m) {
    if (m == kNoMilestone || hasMilestone(m)) return false;
    milestones_.push_back(m);
    return true;
  }
  bool hasMilestone(MilestoneId m) const {
    if (m == kNoMilestone) return true;   // "no requirement" is always met
    for (MilestoneId x : milestones_)
      if (x == m) return true;
    return false;
  }
  const std::vector<MilestoneId>& milestones() const { return milestones_; }

  /** Has this tech's milestone (if any) been earned? */
  bool milestoneMet(TechId id) const {
    const TechDef* def = tree_->tech(id);
    return def == nullptr ? false : hasMilestone(def->requiresMilestone);
  }

  const std::vector<TechId>& unlockedTechs() const { return unlockedTechs_; }
  const std::vector<RecipeId>& unlockedRecipes() const { return unlockedRecipes_; }
  const std::vector<TypeId>& unlockedEntities() const { return unlockedEntities_; }
  const std::vector<ItemId>& unlockedItems() const { return unlockedItems_; }

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
    return prereqsMet(id) && hasMilestone(def->requiresMilestone) &&
           costAffordable(id, science);
  }

  /**
   * WHY a tech cannot be researched, as data rather than as a sentence.
   *
   * The sentence needs item and tech NAMES, which live in the SliceRegistry,
   * which this class deliberately does not hold. So the reason comes back as a
   * code plus the offending id and whoever has the names composes the line.
   * That also makes the reason TESTABLE: "refused because the prereq is
   * missing" and "refused because the science is short" are different
   * assertions, and a single boolean cannot tell them apart, which is exactly
   * how a gate that refuses for the wrong reason passes its own test.
   *
   * The order is the order a player meets them: does it exist, is it already
   * done, is the prereq in, was the deed done, is the science on the shelf.
   */
  ResearchStatus status(TechId id, const Inventory& science) const {
    ResearchStatus s;
    const TechDef* def = tree_->tech(id);
    if (def == nullptr) { s.block = ResearchBlock::UnknownTech; return s; }
    if (isUnlocked(id)) { s.block = ResearchBlock::AlreadyUnlocked; return s; }
    for (TechId p : def->prereqs) {
      if (!isUnlocked(p)) {
        s.block = ResearchBlock::PrereqMissing;
        s.prereq = p;
        return s;
      }
    }
    if (!hasMilestone(def->requiresMilestone)) {
      s.block = ResearchBlock::MilestoneMissing;
      s.milestone = def->requiresMilestone;
      return s;
    }
    for (const ItemStack& c : def->cost) {
      if (c.item != kNoItem && !science.has(c.item, c.count)) {
        s.block = ResearchBlock::CostShort;
        s.item = c.item;
        s.shortBy = static_cast<uint16_t>(c.count - science.count(c.item));
        return s;
      }
    }
    return s;   // ResearchBlock::None: it can be researched right now.
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

  // ---- Restore-from-persistence (GAP-4) ------------------------------------
  // Mark a tech unlocked DIRECTLY (no science spend, no prereq/affordability
  // check) and apply its recipe/entity unlocks. This is the save→reload path:
  // persistence carries the unlocked-tech id list, and on load we RESTORE the
  // unlock set rather than re-deriving it by replaying tryResearch (the latter
  // would require reconstructing the exact science the player spent). Monotonic +
  // dedup-safe like apply(); an unknown/zero id is ignored. Idempotent.
  bool restoreUnlocked(TechId id) {
    const TechDef* def = tree_->tech(id);
    if (!def) return false;
    apply(*def);  // adds to unlockedTechs_ + unlockedRecipes_ + unlockedEntities_
    return true;
  }

  // Restore a whole persisted unlock set in one call (load order is irrelevant —
  // apply() is order-independent because restore skips prereq checks). Returns
  // the number of ids that resolved to a real tech and were applied.
  size_t restoreUnlocked(const std::vector<TechId>& techs) {
    size_t applied = 0;
    for (TechId t : techs)
      if (restoreUnlocked(t)) ++applied;
    return applied;
  }

 private:
  const TechTree* tree_;
  std::vector<TechId> unlockedTechs_;
  std::vector<RecipeId> unlockedRecipes_;
  std::vector<TypeId> unlockedEntities_;
  std::vector<ItemId> unlockedItems_;
  std::vector<MilestoneId> milestones_;

  // Mark the tech unlocked and apply its unlocks (monotonic; dedup-safe).
  void apply(const TechDef& def) {
    if (!isUnlocked(def.id)) unlockedTechs_.push_back(def.id);
    for (RecipeId r : def.unlockRecipes)
      if (!isRecipeUnlocked(r)) unlockedRecipes_.push_back(r);
    for (TypeId e : def.unlockEntities)
      if (!isEntityUnlocked(e)) unlockedEntities_.push_back(e);
    for (ItemId i : def.unlockItems)
      if (!isItemUnlocked(i)) unlockedItems_.push_back(i);
  }
};

// =============================================================================
// §D — THE SURVIVAL TECH TREE: the one the playable client actually gates on.
//
// The §B.2 tree above is the Phase-1 SLICE tree. It gates `types::Smelter`,
// `types::Belt` and the Ferrite recipes, none of which the web client uses, so
// wiring it into the browser verbatim would have produced a tech tree that
// unlocks nothing a player can see, which is a menu.
//
// This tree gates SURVIVAL content, and every row of it gates something the
// player can hold or place. It is deliberately built out of things that DID NOT
// EXIST BEFORE TONIGHT (the power pole, the burner generator, the electric
// smelter, the four armour pieces) plus one flag another lane consumes, because
// gating content that already ships would silently lock a dozen green probes
// out of the machines they place. Adding an existing item to a tech's
// `unlockItems` is a one-line change the day that is wanted, and TechTree's
// "gated iff mentioned" rule means it is the ONLY line.
//
// SCIENCE IS HAND-CRAFTED HERE, AND THAT IS AN HONEST FIRST CUT RATHER THAN
// THE END STATE. Factorio's model, which GP-1 adopts, is that the FACTORY
// produces science; the recipes below are authored as ordinary `CraftRecipe`
// data precisely so a lab or an assembler reads the same table on the day one
// exists. What they buy today is that science costs Iron and Copper, which cost
// a furnace and fuel and swings, so research is downstream of the production
// chain from the very first pack rather than being a free button.
// =============================================================================

/** Automation and logistic science, crafted by hand from smelted metal.
 *
 *  Cinder science is deliberately ABSENT from this list. It is refined from
 *  Cinderite (§A.2), Cinderite is Cinder-only (WG-4), and there is no Cinderite
 *  on Forge, so `CinderRefining` below is a node the player can SEE and can
 *  never research without leaving the planet. That visible, permanently
 *  unaffordable row IS the GP-2 crossover gate, stated on screen instead of
 *  only in a header. */
inline std::vector<survival::CraftRecipe> scienceHandRecipes() {
  using survival::items::Copper;
  using survival::items::Iron;
  using survival::items::Stone;
  return {
      survival::CraftRecipe{items::AutomationScience, 1,
                            {ItemStack{Iron, 2}, ItemStack{Copper, 1}}},
      survival::CraftRecipe{items::LogisticScience, 1,
                            {ItemStack{Iron, 1}, ItemStack{Copper, 2},
                             ItemStack{Stone, 2}}},
  };
}

/** Every science ItemId, in tier order, so a UI lists them without a table. */
inline std::vector<ItemId> scienceItems() {
  return {items::AutomationScience, items::LogisticScience, items::CinderScience};
}

/** The survival tech tree as DATA (GP-12). Eight techs, three tiers deep. */
inline std::vector<TechDef> survivalTechs() {
  namespace pi = progression::items;
  using survival::items::BurnerGenerator;
  using survival::items::ElectricSmelter;
  using survival::items::PowerPole;

  std::vector<TechDef> t;

  // GP-533. THE SCANNING ANTENNA, and it is deliberately the FIRST tech in
  // this vector and the cheapest one payable straight off the research
  // station. `story_line_outline_v1.txt` researches and builds it before
  // Electrification: the ruins it reveals are what unlocks electricity
  // research in the first place ("Investigate ruins ... researching
  // electricity"), so gating this on Electrification would be the same
  // kind of cycle GP-267 already refused for the launch pad and the
  // autopilot. NO PREREQ AND NO MILESTONE: the station gate
  // (`ModeRules.researchStationGated`) is what makes the whole tree
  // reachable at all, and once it is, this is the first rung of it.
  TechDef antenna;
  antenna.id = techs::ScanningAntenna;
  antenna.name = "Scanning Antenna";
  antenna.cost = {ItemStack{items::AutomationScience, 8}};
  antenna.unlockItems = {survival::items::ScanningAntenna};
  antenna.unlockEntities = {survival::types::ScanningAntenna};
  t.push_back(antenna);

  // L7, SCOPED AND DELIBERATELY NOT ADDED HERE: `story_line_outline_v1.txt`
  // also has investigating a ruin grant "the ability to research and build an
  // antenna upgrade". `milestones::RuinInvestigated` above is minted so that
  // tech CAN be gated on it the day it exists, but a `TechDef` with no
  // `unlockItems`/`unlockEntities`/`unlockRecipes` would trip
  // `survival_tree_shape_and_id_space`'s "every survival tech now grants
  // something" invariant (GP-267) on a fake row invented just to satisfy this
  // brief's wording, and the real upgrade (its item, its build cost, what it
  // does) is content this lane does not own. OWED to whichever lane builds
  // tier-2 scanning; the gate to use is `milestones::RuinInvestigated`.

  // L7 (GP-546 to GP-549). THE CYCLE THE ANTENNA'S OWN COMMENT ABOVE PROMISED
  // IS NOW CLOSED: the antenna is un-gated so it can be researched off the
  // station alone, it reveals a ruin, and INVESTIGATING that ruin (the web
  // client's `RuinInteract.ts`, at the asset's `socket_investigate` point) is
  // what earns `milestones::RuinInvestigated` and opens electricity, exactly as
  // `story_line_outline_v1.txt` orders it. This is not the launch-pad/autopilot
  // cycle GP-267 refused, because the KEY (the antenna) and the LOCK
  // (Electrification) are two different techs on two different gates
  // (tech-cost vs. milestone) with a real-world action between them, not one
  // tech gating itself.
  TechDef elec;
  elec.id = techs::Electrification;
  elec.name = "Electrification";
  elec.requiresMilestone = milestones::RuinInvestigated;
  elec.cost = {ItemStack{items::AutomationScience, 10}};
  elec.unlockItems = {PowerPole, BurnerGenerator};
  elec.unlockEntities = {survival::types::PowerPole, survival::types::BurnerGenerator};
  t.push_back(elec);

  // The third rung of the smelting ladder (FS-23). A hand furnace burns coal at
  // 180 ticks and the hand smelter at 60; this one burns WATTS, so it is the
  // first machine whose speed depends on something the player has to manage.
  TechDef esmelt;
  esmelt.id = techs::ElectricSmelting;
  esmelt.name = "Electric Smelting";
  esmelt.prereqs = {techs::Electrification};
  esmelt.cost = {ItemStack{items::AutomationScience, 15},
                 ItemStack{items::LogisticScience, 10}};
  esmelt.unlockItems = {ElectricSmelter};
  t.push_back(esmelt);

  TechDef metal;
  metal.id = techs::Metallurgy;
  metal.name = "Metallurgy";
  metal.cost = {ItemStack{items::AutomationScience, 8}};
  metal.unlockItems = {pi::ArmourHead, pi::ArmourFeet};
  t.push_back(metal);

  TechDef plate;
  plate.id = techs::PlateArmour;
  plate.name = "Plate Armour";
  plate.prereqs = {techs::Metallurgy};
  plate.cost = {ItemStack{items::AutomationScience, 12},
                ItemStack{items::LogisticScience, 6}};
  plate.unlockItems = {pi::ArmourChest, pi::ArmourLegs};
  t.push_back(plate);

  // DW-29. The autopilot is not bought, it is EARNED and then bought: you fly
  // the ascent by hand once, and only then may you spend the science that lets
  // the machine do it. Its payload is the unlock flag itself, which the flight
  // lane reads.
  //
  // GP-267: IT NOW UNLOCKS AN ITEM. This comment used to end "it deliberately
  // unlocks no item, because inventing a part for it here would be this lane
  // authoring another lane's content." That was right, and the gameplay lane is
  // the lane in question; it has now authored the part
  // (`vessel::parts::AutopilotModule`, 0x010D) and this is the tech that was
  // written for it. The sentence is kept above rather than deleted because the
  // REASON the field was empty is still the reason it took this long to fill.
  TechDef autopilot;
  autopilot.id = techs::FlightAutopilot;
  autopilot.name = "Flight Autopilot";
  autopilot.prereqs = {techs::Electrification};
  autopilot.requiresMilestone = milestones::ReachedOrbit;
  autopilot.cost = {ItemStack{items::AutomationScience, 25},
                    ItemStack{items::LogisticScience, 15}};
  autopilot.unlockItems = {parts_items::AutopilotModule};
  t.push_back(autopilot);

  // DW-29 / GP-57. THE LAUNCH PAD, gated behind ground progression.
  //
  // ITS PREREQ IS ELECTRIFICATION AND ITS COST IS SCIENCE, AND NEITHER IS
  // DECORATION. DW-29's sequencing argument is that gating the pad behind
  // ground progression is what ties the two halves of the game into one game
  // instead of two modes, and a tech whose prereq is nothing would gate on
  // patience rather than on progression. Electrification is the first rung that
  // genuinely requires a working factory (poles and a generator), so requiring
  // it is requiring a base.
  //
  // IT DELIBERATELY REQUIRES NO MILESTONE. `FlightAutopilot` above is the tech
  // that is EARNED (`milestones::ReachedOrbit`), and it must stay the only one:
  // gating the PAD on having reached orbit would be a cycle, because reaching
  // orbit is what the pad is for. The two techs are the two ends of the same
  // arc and the milestone belongs on the far one.
  TechDef pad;
  pad.id = techs::LaunchFacilities;
  pad.name = "Launch Facilities";
  pad.prereqs = {techs::Electrification};
  pad.cost = {ItemStack{items::AutomationScience, 20},
              ItemStack{items::LogisticScience, 12}};
  pad.unlockItems = {survival::items::LaunchPad};
  pad.unlockEntities = {survival::types::LaunchPad};
  t.push_back(pad);

  // GP-2, visible. Costs an item that cannot be made on this planet.
  TechDef cinder;
  cinder.id = techs::CinderRefining;
  cinder.name = "Cinderite Refining";
  cinder.prereqs = {techs::ElectricSmelting};
  cinder.cost = {ItemStack{items::AutomationScience, 20},
                 ItemStack{items::CinderScience, 5}};
  cinder.unlockRecipes = {recipes::RefineCinderScience};
  t.push_back(cinder);

  return t;
}

inline TechTree survivalTechTree() { return TechTree(survivalTechs()); }

}  // namespace gameplay
}  // namespace of
