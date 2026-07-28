// =============================================================================
// of_vessel_api.inc: §11 of the bridge: the VESSEL surface (ABI 6).
//
// Included from of_core_api.cpp (one translation unit, so the scratch arena and
// the Registry template are the same ones every other section uses). It is a
// separate file only so neither file grows past reading size.
//
// What this publishes, and nothing more:
//   * the PART CATALOGUE as data (vessel.h §3), so the assembly UI never
//     hard-codes a dimension, a mass or an Isp;
//   * the ITEM FORM of a part and its BUILD COST, which vessel.h deliberately
//     has no opinion about (physics R9). See the block comment on
//     of_vs_part_item for the id allocation;
//   * building and editing a vessel TREE (add root, attach, remove a subtree);
//   * STAGING, including a reorder that renumbers the parts with the rows so a
//     delta-v filter over PartInstance::stage stays honest;
//   * the derived figures DW-30 item 4 makes non-negotiable: per-stage delta-v,
//     mass properties and thrust-to-weight.
//
// Everything here is a copy of a /core number into the scratch arena. No rule is
// restated: if a figure disagrees with core/tests/test_vessel.cpp, this file is
// wrong.
// =============================================================================
#include "of/vessel.h"

namespace vs = of::vessel;

namespace {

Registry<vs::Vessel> g_vessels;

// --- The ITEM form of a part -------------------------------------------------
//
// vessel.h's PartId space starts at 0x0100 precisely so a PartId and an ItemId
// can never be confused, and it says in its own header comment that the item
// form belongs to gameplay.h's pinned table. gameplay.h cannot be edited from
// this lane, so the block is ALLOCATED HERE and is a pure function of the
// PartId, which makes it stable, append-only and checkable by inspection:
//
//     ItemId(part) = 0x0050 + (PartId - 0x0100)
//
// That reserves 0x0050..0x006A (27 ids for the 27-wide PartId range; 24 are in
// use and the three gaps are held by the PartId gap at 0x010D..0x010F). It sits
// clear of every pinned block: slice 0x0001..0x0016, science 0x0020+, survival
// 0x0030..0x003C, structures 0x0040..0x0043.
//
// The ids are NOT registered in the SliceRegistry, because registration lives in
// gameplay.h. The practical consequence is exact and worth stating: a part item
// cannot be ADDED to the pack today (Inventory::add asks the registry for a
// stack size and refuses an unknown item). Nothing needs it to be: a part is
// PAID for and placed on the rocket, the same contract of_gp_structure_pay has,
// where the thing produced is a building rather than a stack.
constexpr int kPartItemBase = 0x0050;
inline gp::ItemId partItemId(vs::PartId id) {
  return static_cast<gp::ItemId>(kPartItemBase + (id - 0x0100));
}

// --- Build costs -------------------------------------------------------------
//
// Balance, not physics, so it is authored here as data and stated in one place.
// Rules it follows: pay in the survival materials that already exist (iron and
// copper from the furnace, wood from a tree, coal from a seam); a class-L part
// costs about 4x its class-S equivalent, which is its cross-section ratio and
// is the number the player can see; and the whole reference vehicle comes to
// 38 iron, 8 copper and 4 wood, which is a first-factory pack and not a grind.
struct PartCost {
  vs::PartId part;
  gp::survival::CraftRecipe cost;
};

const std::vector<PartCost>& partCosts() {
  using gp::ItemStack;
  namespace it = gp::survival::items;
  auto mk = [](vs::PartId p, std::vector<ItemStack> in) {
    return PartCost{p, gp::survival::CraftRecipe{partItemId(p), 1, std::move(in)}};
  };
  static const std::vector<PartCost> t = {
      // Tier 1, class S.
      mk(vs::parts::CommandPod,          {{it::Iron, 8}, {it::Copper, 2}}),
      mk(vs::parts::TankLiquidSmall,     {{it::Iron, 4}}),
      mk(vs::parts::TankLiquidSmallLong, {{it::Iron, 8}}),
      mk(vs::parts::EngineLiquidSmall,   {{it::Iron, 6}, {it::Copper, 2}}),
      mk(vs::parts::EngineVacuumSmall,   {{it::Iron, 4}, {it::Copper, 3}}),
      mk(vs::parts::SolidBooster,        {{it::Iron, 6}, {it::Coal, 4}}),
      mk(vs::parts::DecouplerStackSmall, {{it::Iron, 2}}),
      mk(vs::parts::DecouplerRadial,     {{it::Iron, 1}}),
      mk(vs::parts::NoseCone,            {{it::Iron, 2}}),
      mk(vs::parts::LandingLeg,          {{it::Iron, 2}, {it::Copper, 1}}),
      mk(vs::parts::Parachute,           {{it::Iron, 2}, {it::Copper, 1}}),
      mk(vs::parts::Fin,                 {{it::Iron, 1}, {it::Wood, 1}}),
      mk(vs::parts::CargoBay,            {{it::Iron, 4}}),
      // Tier 2.
      mk(vs::parts::RcsBlock,            {{it::Copper, 2}}),
      mk(vs::parts::TankMonoprop,        {{it::Iron, 2}, {it::Copper, 1}}),
      mk(vs::parts::ReactionWheel,       {{it::Iron, 3}, {it::Copper, 2}}),
      mk(vs::parts::Battery,             {{it::Iron, 1}, {it::Copper, 3}}),
      mk(vs::parts::SolarPanel,          {{it::Iron, 1}, {it::Copper, 3}}),
      mk(vs::parts::DockingPort,         {{it::Iron, 3}, {it::Copper, 2}}),
      mk(vs::parts::EngineVernier,       {{it::Iron, 2}, {it::Copper, 2}}),
      // Class L: roughly 4x class S, which is the cross-section ratio.
      mk(vs::parts::TankLiquidLarge,     {{it::Iron, 16}}),
      mk(vs::parts::EngineLiquidLarge,   {{it::Iron, 24}, {it::Copper, 8}}),
      mk(vs::parts::DecouplerStackLarge, {{it::Iron, 6}}),
      mk(vs::parts::StackAdapter,        {{it::Iron, 8}}),
  };
  return t;
}

const gp::survival::CraftRecipe* partCostFor(vs::PartId id) {
  for (const PartCost& c : partCosts())
    if (c.part == id) return &c.cost;
  return nullptr;
}

const vs::PartDef* partAt(int i) {
  const auto& all = vs::catalogue().all();
  if (i < 0 || static_cast<size_t>(i) >= all.size()) return nullptr;
  return &all[static_cast<size_t>(i)];
}

// Copy a C string into the u8 arena. Returns the byte count (NOT null
// terminated), matching of_gp_item_name.
int textOut(const char* s) {
  g_u8.clear();
  if (!s) return 0;
  for (const char* p = s; *p; ++p) g_u8.push_back(static_cast<uint8_t>(*p));
  return static_cast<int>(g_u8.size());
}

}  // namespace

// =============================================================================
// §11.1: the catalogue. CONTENT, so every call here is valid before of_gp_init
// and before any body exists.
// =============================================================================

// 24. The count is asserted in core/tests/test_vessel.cpp, so a client that
// checks it against a literal is checking the wasm is not stale.
OF_API int of_vs_part_count(void) {
  return static_cast<int>(vs::catalogue().size());
}

// Catalogue index of a PartId, or -1. The client addresses parts by INDEX
// everywhere else in this section, so this is the one translation point.
OF_API int of_vs_part_index_of(int partId) {
  const auto& all = vs::catalogue().all();
  for (size_t i = 0; i < all.size(); ++i)
    if (all[i].id == static_cast<vs::PartId>(partId)) return static_cast<int>(i);
  return -1;
}

// f64 scratch, EXACTLY 34 doubles, fixed stride:
//   0  id                    1  cls                  2  diameterM
//   3  heightM               4  nodeTop               5  nodeBottom
//   6  radialMount           7  dryMassKg             8  propellant
//   9  propellantCapacityKg  10 electricCapacity      11 electricRatePerS
//   12 thrustSeaLevelN       13 thrustVacuumN         14 ispSeaLevelS
//   15 ispVacuumS            16 consumes              17 throttleable
//   18 restartable           19 minThrottle           20 gimbalRangeRad
//   21 reactionTorqueNm      22 rcsThrustN            23 rcsIspS
//   24 crewCapacity          25 dragCdAxial           26 dragAreaAxialM2
//   27 dragCdNormal          28 dragAreaNormalM2      29 normalForceSlopeM2
//   30 chuteDragAreaM2       31 legReachM             32 dockCaptureRadiusM
//   33 dockCaptureConeRad
// Returns 34, or 0 for a bad index.
OF_API int of_vs_part_info(int i) {
  resetF64(34);
  const vs::PartDef* d = partAt(i);
  if (!d) return 0;
  const double v[34] = {
      static_cast<double>(d->id), static_cast<double>(d->cls), d->diameterM,
      d->heightM, d->nodeTop ? 1.0 : 0.0, d->nodeBottom ? 1.0 : 0.0,
      d->radialMount ? 1.0 : 0.0, d->dryMassKg, static_cast<double>(d->propellant),
      d->propellantCapacityKg, d->electricCapacity, d->electricRatePerS,
      d->thrustSeaLevelN, d->thrustVacuumN, d->ispSeaLevelS,
      d->ispVacuumS, static_cast<double>(d->consumes), d->throttleable ? 1.0 : 0.0,
      d->restartable ? 1.0 : 0.0, d->minThrottle, d->gimbalRangeRad,
      d->reactionTorqueNm, d->rcsThrustN, d->rcsIspS,
      static_cast<double>(d->crewCapacity), d->dragCdAxial, d->dragAreaAxialM2,
      d->dragCdNormal, d->dragAreaNormalM2, d->normalForceSlopeM2,
      d->chuteDragAreaM2, d->legReachM, d->dockCaptureRadiusM,
      d->dockCaptureConeRad};
  for (double x : v) g_f64.push_back(x);
  return 34;
}

// Display name -> u8 scratch. Returns the byte count.
OF_API int of_vs_part_name(int i) {
  const vs::PartDef* d = partAt(i);
  return d ? textOut(d->name) : textOut(nullptr);
}

// The glb NODE NAME, exactly (ASSET-SPECS §3.3) -> u8 scratch. A renderer looks
// the mesh up by this string and by nothing else, which is what keeps the art
// lane and the catalogue from drifting apart silently.
OF_API int of_vs_part_asset(int i) {
  const vs::PartDef* d = partAt(i);
  return d ? textOut(d->asset) : textOut(nullptr);
}

// The ItemId of the part's item form (see partItemId above). 0 for a bad index.
OF_API int of_vs_part_item(int i) {
  const vs::PartDef* d = partAt(i);
  return d ? static_cast<int>(partItemId(d->id)) : 0;
}

// i32 scratch [item, inputCount, (itemId, count)*inputCount]. Returns the word
// count, or 0 for a bad index / a part with no authored cost.
OF_API int of_vs_part_cost_info(int i) {
  resetI32(12);
  const vs::PartDef* d = partAt(i);
  const gp::survival::CraftRecipe* c = d ? partCostFor(d->id) : nullptr;
  if (!c) return 0;
  g_i32.push_back(static_cast<int32_t>(c->output));
  g_i32.push_back(static_cast<int32_t>(c->inputs.size()));
  for (const gp::ItemStack& in : c->inputs) {
    g_i32.push_back(static_cast<int32_t>(in.item));
    g_i32.push_back(static_cast<int32_t>(in.count));
  }
  return static_cast<int>(g_i32.size());
}

// 1 if the pack holds the whole cost right now. Read-only.
OF_API int of_vs_part_can_afford(int i) {
  const vs::PartDef* d = partAt(i);
  const gp::survival::CraftRecipe* c = d ? partCostFor(d->id) : nullptr;
  if (!gpReady() || !c) return 0;
  return gp::survival::HandCrafter::canCraft(*c, *g_inv) ? 1 : 0;
}

// Pay the cost, ALL-OR-NOTHING, adding NO item (the thing produced is a part on
// a rocket). Commit the placement only on 1.
OF_API int of_vs_part_pay(int i) {
  const vs::PartDef* d = partAt(i);
  const gp::survival::CraftRecipe* c = d ? partCostFor(d->id) : nullptr;
  if (!gpReady() || !c) return 0;
  return gp::survival::HandCrafter::payInputs(*c, *g_inv) ? 1 : 0;
}

// Give the cost back when a part is taken off the rocket. Returns the number of
// input stacks fully returned; a short return means the pack was full, which the
// caller should surface rather than swallow. It lives here rather than in JS so
// that the cost has exactly one reader.
OF_API int of_vs_part_refund(int i) {
  const vs::PartDef* d = partAt(i);
  const gp::survival::CraftRecipe* c = d ? partCostFor(d->id) : nullptr;
  if (!gpReady() || !c) return 0;
  int full = 0;
  for (const gp::ItemStack& in : c->inputs)
    if (g_inv->add(in.item, in.count) == 0) ++full;
  return full;
}

// =============================================================================
// §11.2: the tree.
// =============================================================================

OF_API int of_vs_create(void) { return g_vessels.add(new vs::Vessel()); }
OF_API void of_vs_destroy(int v) { g_vessels.remove(v); }

OF_API int of_vs_clear(int v) {
  vs::Vessel* p = g_vessels.get(v);
  if (!p) return 0;
  p->parts.clear();
  p->stages.clear();
  p->nextStageIndex = 0;
  return 1;
}

// -> the new part's HANDLE, or -1. A vessel has exactly one root; a second call
// is refused rather than silently making an orphan.
OF_API int of_vs_add_root(int v, int partId) {
  vs::Vessel* p = g_vessels.get(v);
  if (!p || !vs::catalogue().get(static_cast<vs::PartId>(partId))) return -1;
  if (p->root() != vs::kNoHandle) return -1;
  const vs::PartHandle h = p->addRoot(static_cast<vs::PartId>(partId));
  p->layout();
  return static_cast<int>(h);
}

// how: 1 = StackTop (on the parent's top node), 2 = StackBottom (hanging below),
// 3 = Radial. -> the new handle, or -1.
OF_API int of_vs_attach(int v, int parentHandle, int partId, int how,
                        double radialAngleRad, double radialOffsetM) {
  vs::Vessel* p = g_vessels.get(v);
  if (!p || !vs::catalogue().get(static_cast<vs::PartId>(partId))) return -1;
  if (!p->find(static_cast<vs::PartHandle>(parentHandle))) return -1;
  if (how < 1 || how > 3) return -1;
  const vs::PartHandle h = p->attach(static_cast<vs::PartHandle>(parentHandle),
                                     static_cast<vs::PartId>(partId),
                                     static_cast<vs::Attach>(how),
                                     radialAngleRad, radialOffsetM);
  p->layout();
  return static_cast<int>(h);
}

// Remove the part and EVERYTHING attached below it, which is the same subtree
// rule fireStage severs on. -> the number of parts removed.
OF_API int of_vs_remove(int v, int handle) {
  vs::Vessel* p = g_vessels.get(v);
  if (!p) return 0;
  const auto h = static_cast<vs::PartHandle>(handle);
  if (!p->find(h)) return 0;
  std::vector<vs::PartInstance> keep;
  int removed = 0;
  for (const auto& q : p->parts) {
    if (p->isInSubtree(q.handle, h)) ++removed;
    else keep.push_back(q);
  }
  p->parts.swap(keep);
  for (vs::Stage& s : p->stages) {
    std::vector<vs::PartHandle> a, d;
    for (vs::PartHandle x : s.activate) if (p->find(x)) a.push_back(x);
    for (vs::PartHandle x : s.decouple) if (p->find(x)) d.push_back(x);
    s.activate.swap(a);
    s.decouple.swap(d);
  }
  p->layout();
  return removed;
}

OF_API int of_vs_count(int v) {
  vs::Vessel* p = g_vessels.get(v);
  return p ? static_cast<int>(p->parts.size()) : 0;
}

// i32 scratch, 5 per part: [handle, partId, parentHandle, attach, stage].
// parentHandle is -1 for the root. Row order is the vessel's own part order and
// is the SAME order of_vs_transforms uses.
OF_API int of_vs_parts(int v) {
  vs::Vessel* p = g_vessels.get(v);
  resetI32(p ? p->parts.size() * 5 : 0);
  if (!p) return 0;
  for (const auto& q : p->parts) {
    g_i32.push_back(static_cast<int32_t>(q.handle));
    g_i32.push_back(static_cast<int32_t>(q.def));
    g_i32.push_back(q.parent == vs::kNoHandle ? -1 : static_cast<int32_t>(q.parent));
    g_i32.push_back(static_cast<int32_t>(q.attach));
    g_i32.push_back(static_cast<int32_t>(q.stage));
  }
  return static_cast<int>(p->parts.size());
}

// f64 scratch, 9 per part, SAME ROW ORDER as of_vs_parts:
//   [originX, originY, originZ, centroidX, centroidY, centroidZ,
//    radialAngleRad, propellantKg, radialOffsetM]
// origin is the part's own bottom mating plane (stack) or mount plane (radial)
// in the vessel body frame, +Y toward the nose: exactly the frame the glb is
// authored in, so a renderer needs no convention translation.
//
// ABI 20: `radialOffsetM` IS THE NINTH WORD, appended rather than inserted so
// every existing index is unmoved. Radial placement is TWO numbers, the angle
// around the parent and the height up it, and this row published one of them.
// `VesselDesign.toJson` therefore re-derived the height by subtracting the two
// origins, which is exact (nothing else touches that axis) but leaves the row
// one field short of describing a part: a reader with the row alone could not
// say where a radial part was mounted without also holding its parent's row.
// PH-81 also makes the outward distance depend on the CHILD's declared
// convention, so the subtraction trick is no longer the only thing a caller
// might want and the input belongs in the output.
OF_API int of_vs_transforms(int v) {
  vs::Vessel* p = g_vessels.get(v);
  resetF64(p ? p->parts.size() * 9 : 0);
  if (!p) return 0;
  p->layout();
  for (const auto& q : p->parts) {
    g_f64.push_back(q.originM.x);   g_f64.push_back(q.originM.y);
    g_f64.push_back(q.originM.z);   g_f64.push_back(q.centroidM.x);
    g_f64.push_back(q.centroidM.y); g_f64.push_back(q.centroidM.z);
    g_f64.push_back(q.radialAngleRad);
    g_f64.push_back(q.propellantKg);
    // Zero for anything not radially attached, matching the field's own
    // "ignored unless attach == Attach::Radial" contract in vessel.h §4.
    g_f64.push_back(q.attach == vs::Attach::Radial ? q.radialOffsetM : 0.0);
  }
  return static_cast<int>(p->parts.size());
}

OF_API double of_vs_length(int v) {
  vs::Vessel* p = g_vessels.get(v);
  if (!p) return 0.0;
  p->layout();
  return p->lengthM();
}

// Assign ONE part to stage group `s`. -1 means the kNeverDecoupled default.
// This is what a save/restore needs: the subtree form below is the authoring
// convenience, and a restore that had to reproduce a hand-edited table out of
// subtree calls would be re-deriving rather than reloading.
OF_API int of_vs_set_part_stage(int v, int handle, int s) {
  vs::Vessel* p = g_vessels.get(v);
  if (!p) return 0;
  vs::PartInstance* q = p->find(static_cast<vs::PartHandle>(handle));
  if (!q) return 0;
  q->stage = (s < 0) ? vs::kNeverDecoupled : s;
  return 1;
}

// Assign the whole subtree at `handle` to stage group `s`. -1 means the
// kNeverDecoupled default (payload, rides to the end).
OF_API int of_vs_assign_stage(int v, int handle, int s) {
  vs::Vessel* p = g_vessels.get(v);
  if (!p || !p->find(static_cast<vs::PartHandle>(handle))) return 0;
  p->assignSubtreeToStage(static_cast<vs::PartHandle>(handle),
                          s < 0 ? vs::kNeverDecoupled : s);
  return 1;
}
