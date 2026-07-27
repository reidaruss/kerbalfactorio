// =============================================================================
// of_research_api.inc — §15 RESEARCH (research.h) and §16 PLAYER PROGRESSION
// (progression.h). #included into of_core_api.cpp so the scratch arena and the
// gameplay registry/inventory above are in scope.
//
// research.h has been green in /core since June and had NEVER been called from
// the browser. A sandbox probe reported `researchGatesInClient: 0` and said so
// plainly rather than faking a pass, which is how we know. progression.h landed
// last night at 823 checks in the same condition. This file is the door.
//
// THE SCIENCE POOL IS THE PLAYER'S OWN PACK, and that is a decision rather than
// a shortcut. `ResearchState::tryResearch` takes any `Inventory&`, so it could
// have had a second one; giving it the pack means a science pack is an ordinary
// item that stacks, is saved by the existing byte serializer, can be dropped,
// and is visible in the same grid as everything else. A separate pool would
// need its own UI, its own save field and its own transfer verb, all to model
// a shelf.
//
// NO REASON STRING CROSSES THIS BOUNDARY. `status()` returns a CODE plus the
// offending id, and the client composes the sentence with names it already has
// from `of_gp_item_name`. Two consequences worth stating: the refusal is
// TESTABLE (prereq-missing and cost-short are different assertions, and a
// boolean cannot tell them apart), and the shim never grows a second copy of
// the item names.
// =============================================================================

namespace {
namespace pg = of::gameplay::progression;

// One tree and one state for the session. The tree is the SURVIVAL tree (§D),
// not the Phase-1 slice tree: the slice tree gates Ferrite recipes the web
// client does not have, so wiring it in verbatim would give a player a tech
// tree that unlocks nothing they can see.
std::unique_ptr<gp::TechTree> g_tree;
std::unique_ptr<gp::ResearchState> g_research;
pg::PlayerProfile g_profile;

bool rsReady() { return g_tree && g_research && gpReady(); }

const gp::TechDef* techAt(int i) {
  if (!rsReady() || i < 0) return nullptr;
  const std::vector<gp::TechDef>& all = g_tree->allTechs();
  if (static_cast<size_t>(i) >= all.size()) return nullptr;
  return &all[static_cast<size_t>(i)];
}

// Copy a std::string into the u8 scratch and return its byte length. The same
// convention of_gp_item_name uses, so JS decodes it with the same helper.
int stringOut(const char* s) {
  const size_t n = s == nullptr ? 0 : std::strlen(s);
  g_u8.assign(s, s + n);
  return static_cast<int>(n);
}
}  // namespace

// Build the tree and the state. Idempotent; 1 when ready. Called by of_gp_init,
// and exported as well so a client running against an older world can bring the
// layer up without re-initialising the pack.
OF_API int of_rs_init(void) {
  if (rsReady()) return 1;
  if (!gpReady()) return 0;
  g_tree.reset(new gp::TechTree(gp::survivalTechTree()));
  g_research.reset(new gp::ResearchState(*g_tree));
  return 1;
}

OF_API int of_rs_tech_count(void) {
  return rsReady() ? static_cast<int>(g_tree->allTechs().size()) : 0;
}

OF_API int of_rs_tech_id(int i) {
  const gp::TechDef* d = techAt(i);
  return d == nullptr ? 0 : static_cast<int>(d->id);
}

OF_API int of_rs_tech_name(int i) {
  const gp::TechDef* d = techAt(i);
  return d == nullptr ? 0 : stringOut(d->name.c_str());
}

// i32 scratch, NINE fields:
//   [id, depth, unlocked, canResearch, block, prereq, milestone, costItem,
//    shortBy]
// `depth` is the longest prereq chain behind this tech, which is the column a
// graph lays it out in, computed in /core so a panel never re-derives topology.
// `block` is ResearchBlock in enum order: 0 none, 1 unknown, 2 already,
// 3 prereq, 4 milestone, 5 cost. Exactly one of prereq/milestone/costItem is
// set, according to `block`.
OF_API int of_rs_tech_state(int i) {
  resetI32(9);
  const gp::TechDef* d = techAt(i);
  if (d == nullptr) return 0;
  const gp::ResearchStatus s = g_research->status(d->id, *g_inv);
  g_i32.push_back(static_cast<int32_t>(d->id));
  g_i32.push_back(static_cast<int32_t>(g_tree->depthOf(d->id)));
  g_i32.push_back(g_research->isUnlocked(d->id) ? 1 : 0);
  g_i32.push_back(g_research->canResearch(d->id, *g_inv) ? 1 : 0);
  g_i32.push_back(static_cast<int32_t>(s.block));
  g_i32.push_back(static_cast<int32_t>(s.prereq));
  g_i32.push_back(static_cast<int32_t>(s.milestone));
  g_i32.push_back(static_cast<int32_t>(s.item));
  g_i32.push_back(static_cast<int32_t>(s.shortBy));
  return 9;
}

// i32 scratch of TechIds this tech depends on. Returns the count.
OF_API int of_rs_tech_prereqs(int i) {
  resetI32(4);
  const gp::TechDef* d = techAt(i);
  if (d == nullptr) return 0;
  for (gp::TechId p : d->prereqs) g_i32.push_back(static_cast<int32_t>(p));
  return static_cast<int>(d->prereqs.size());
}

// i32 scratch, THREE per cost row: [item, have, need]. `have` is the pack
// total, so a panel greys a whole cost without one call per row. Returns the
// ROW count.
OF_API int of_rs_tech_cost(int i) {
  resetI32(9);
  const gp::TechDef* d = techAt(i);
  if (d == nullptr) return 0;
  for (const gp::ItemStack& c : d->cost) {
    g_i32.push_back(static_cast<int32_t>(c.item));
    g_i32.push_back(static_cast<int32_t>(g_inv->count(c.item)));
    g_i32.push_back(static_cast<int32_t>(c.count));
  }
  return static_cast<int>(d->cost.size());
}

// i32 scratch, TWO per row: [kind, id], kind 0 = item, 1 = entity, 2 = recipe.
// Returns the ROW count. The client turns an item id into a name it already
// has; an entity or recipe id it labels from its own build tables, which is the
// only place those names exist at all.
OF_API int of_rs_tech_unlocks(int i) {
  resetI32(8);
  const gp::TechDef* d = techAt(i);
  if (d == nullptr) return 0;
  int rows = 0;
  for (gp::ItemId x : d->unlockItems) {
    g_i32.push_back(0); g_i32.push_back(static_cast<int32_t>(x)); ++rows;
  }
  for (gp::TypeId x : d->unlockEntities) {
    g_i32.push_back(1); g_i32.push_back(static_cast<int32_t>(x)); ++rows;
  }
  for (gp::RecipeId x : d->unlockRecipes) {
    g_i32.push_back(2); g_i32.push_back(static_cast<int32_t>(x)); ++rows;
  }
  return rows;
}

// SPEND the science and apply the unlock. ALL OR NOTHING: 1 means every cost
// row was removed from the pack and the unlocks applied; 0 means nothing at all
// moved. Idempotent, so researching an already-unlocked tech returns 0 and
// spends nothing.
OF_API int of_rs_try(int techId) {
  if (!rsReady()) return 0;
  return g_research->tryResearch(static_cast<gp::TechId>(techId), *g_inv) ? 1 : 0;
}

// --- THE GATES the client actually asks --------------------------------------
// "Unlocked" and "available" are DIFFERENT QUESTIONS. Unlocked means a tech
// granted it. AVAILABLE means the player may use it right now, which is true
// when the tree never gated it at all OR when a tech has granted it. Conflating
// them is how a tech tree ends up locking wood.
OF_API int of_rs_item_available(int item) {
  if (!rsReady()) return 1;
  return g_research->isItemAvailable(static_cast<gp::ItemId>(item)) ? 1 : 0;
}
OF_API int of_rs_entity_available(int typeId) {
  if (!rsReady()) return 1;
  return g_research->isEntityAvailable(static_cast<gp::TypeId>(typeId)) ? 1 : 0;
}
// Is this item gated by the tree AT ALL? A panel needs the difference so it can
// say "researched" on a pole and say nothing on a plank.
OF_API int of_rs_item_gated(int item) {
  if (!rsReady()) return 0;
  return g_tree->gatesItem(static_cast<gp::ItemId>(item)) ? 1 : 0;
}
// The hand recipe at `index` (the of_gp_recipe_* index space), by its OUTPUT.
// The survival hand recipes carry no RecipeId, so the output item is the only
// handle both the craft menu and the build hotbar can hold.
OF_API int of_rs_recipe_available(int index) {
  if (!rsReady() || index < 0 ||
      static_cast<size_t>(index) >= g_gpRecipes.size()) return 1;
  return g_research->isItemAvailable(
      g_gpRecipes[static_cast<size_t>(index)].output) ? 1 : 0;
}

// --- MILESTONES (DW-29): things the player DID ------------------------------
// The autopilot is EARNED and then bought. `of_rs_set_milestone` is what the
// flight lane calls the first time an ascent comes back down.
OF_API int of_rs_set_milestone(int m) {
  if (!rsReady()) return 0;
  return g_research->setMilestone(static_cast<gp::MilestoneId>(m)) ? 1 : 0;
}
OF_API int of_rs_has_milestone(int m) {
  if (!rsReady()) return 0;
  return g_research->hasMilestone(static_cast<gp::MilestoneId>(m)) ? 1 : 0;
}
OF_API int of_rs_milestone_name(int m) {
  return stringOut(gp::milestoneName(static_cast<gp::MilestoneId>(m)));
}
// i32 scratch of earned MilestoneIds. Returns the count. This is what the save
// carries; restoring is one call per id.
OF_API int of_rs_milestones(void) {
  resetI32(4);
  if (!rsReady()) return 0;
  for (gp::MilestoneId m : g_research->milestones())
    g_i32.push_back(static_cast<int32_t>(m));
  return static_cast<int>(g_i32.size());
}

// --- Persistence -------------------------------------------------------------
// i32 scratch of unlocked TechIds. Returns the count.
OF_API int of_rs_unlocked(void) {
  resetI32(8);
  if (!rsReady()) return 0;
  for (gp::TechId t : g_research->unlockedTechs())
    g_i32.push_back(static_cast<int32_t>(t));
  return static_cast<int>(g_i32.size());
}

// Restore ONE unlocked tech with no science spend and no prereq check. This is
// the load path: persistence carries the id list and we RESTORE the unlock set
// rather than re-deriving it by replaying tryResearch, which would need the
// exact science the player spent. Order is irrelevant. Milestones restore
// through of_rs_set_milestone, deliberately separately, because a reload that
// silently granted one would hand out the autopilot for free.
OF_API int of_rs_restore(int techId) {
  if (!rsReady()) return 0;
  return g_research->restoreUnlocked(static_cast<gp::TechId>(techId)) ? 1 : 0;
}

// i32 scratch of the science ItemIds, tier order. So JS never types 0x0020.
OF_API int of_rs_science_items(void) {
  resetI32(4);
  for (gp::ItemId i : gp::scienceItems()) g_i32.push_back(static_cast<int32_t>(i));
  return static_cast<int>(g_i32.size());
}

// =============================================================================
// §16 — PLAYER PROGRESSION (progression.h): what the player wears, what they
// are good at, and what they look like.
// =============================================================================

OF_API int of_pg_slot_count(void) { return static_cast<int>(pg::kEquipSlotCount); }

OF_API int of_pg_slot_name(int slot) {
  if (slot < 0 || static_cast<size_t>(slot) >= pg::kEquipSlotCount) return 0;
  return stringOut(pg::slotName(static_cast<pg::EquipSlot>(slot)));
}

// The mesh node an equipped piece is drawn as, from armour_set.glb. A PURE
// FUNCTION OF THE SLOT: the art lane's node names are SLOT names and not SET
// names, so a second armour set is a second file and nothing here moves.
OF_API int of_pg_armour_node(int slot) {
  if (slot < 0 || static_cast<size_t>(slot) >= pg::kEquipSlotCount) return 0;
  return stringOut(pg::armourNode(static_cast<pg::EquipSlot>(slot)));
}

OF_API int of_pg_worn(int slot) {
  if (slot < 0 || static_cast<size_t>(slot) >= pg::kEquipSlotCount) return 0;
  return static_cast<int>(g_profile.equipment.worn(static_cast<pg::EquipSlot>(slot)));
}

// Move a piece from the PACK onto the body, swapping out whatever was there.
// All or nothing: 0 means nothing moved.
OF_API int of_pg_equip(int item) {
  if (!gpReady()) return 0;
  return g_profile.equipment.equip(static_cast<gp::ItemId>(item), *g_inv) ? 1 : 0;
}
OF_API int of_pg_unequip(int slot) {
  if (!gpReady() || slot < 0 ||
      static_cast<size_t>(slot) >= pg::kEquipSlotCount) return 0;
  return g_profile.equipment.unequip(static_cast<pg::EquipSlot>(slot), *g_inv) ? 1 : 0;
}

OF_API int of_pg_armour_count(void) {
  return static_cast<int>(pg::armourDefs().size());
}

// f64 scratch, FIVE per row: [item, slot, damageReduction, moveSpeedMul,
// insulationC]. f64 because three of the five are floats and mixing scratch
// types across one row is how a reader loses their place.
OF_API int of_pg_armour_info(int i) {
  resetF64(5);
  const std::vector<pg::ArmourDef> defs = pg::armourDefs();
  if (i < 0 || static_cast<size_t>(i) >= defs.size()) return 0;
  const pg::ArmourDef& d = defs[static_cast<size_t>(i)];
  g_f64.push_back(static_cast<double>(d.item));
  g_f64.push_back(static_cast<double>(d.slot));
  g_f64.push_back(static_cast<double>(d.stats.damageReduction));
  g_f64.push_back(static_cast<double>(d.stats.moveSpeedMul));
  g_f64.push_back(static_cast<double>(d.stats.insulationC));
  return 5;
}

// The SUIT added up, straight from /core's own Equipment::total: reduction
// SUMS and is capped at 0.80, the speed penalties MULTIPLY. f64 scratch:
// [damageReduction, moveSpeedMul, insulationC].
OF_API int of_pg_total(void) {
  resetF64(3);
  const pg::ArmourStats t = g_profile.equipment.total();
  g_f64.push_back(static_cast<double>(t.damageReduction));
  g_f64.push_back(static_cast<double>(t.moveSpeedMul));
  g_f64.push_back(static_cast<double>(t.insulationC));
  return 3;
}

// Damage after the suit, so a combat model consumes ONE call rather than
// re-deriving the cap and the summation and getting a different answer.
OF_API double of_pg_damage_after(double raw) {
  return static_cast<double>(g_profile.equipment.damageAfter(static_cast<float>(raw)));
}

// i32 scratch of the four worn ItemIds, or 0 for an empty slot. This is what
// the save carries; restoring goes through of_pg_restore_worn so /core's own
// "a row is only accepted into the slot it belongs to" check runs on load.
OF_API int of_pg_worn_all(void) {
  resetI32(4);
  for (size_t k = 0; k < pg::kEquipSlotCount; ++k)
    g_i32.push_back(static_cast<int32_t>(
        g_profile.equipment.worn(static_cast<pg::EquipSlot>(k))));
  return static_cast<int>(pg::kEquipSlotCount);
}

// Restore the four slots from a saved ItemId list, WITHOUT touching the pack
// (the load path already restored the pack from its own bytes, and taking the
// armour out of it again would delete four items on every reload). Each id is
// validated against its own slot by /core's serialize/deserialize pair, so a
// hand-edited save cannot put boots on a head. Returns how many slots filled.
OF_API int of_pg_restore_worn(int head, int chest, int legs, int feet) {
  const int want[4] = {head, chest, legs, feet};
  const std::vector<pg::ArmourDef> defs = pg::armourDefs();
  std::array<uint8_t, pg::kEquipSlotCount> idx{};
  int filled = 0;
  for (size_t k = 0; k < pg::kEquipSlotCount; ++k) {
    idx[k] = 0xFF;
    for (size_t j = 0; j < defs.size(); ++j) {
      if (static_cast<int>(defs[j].item) == want[k]) {
        idx[k] = static_cast<uint8_t>(j);
        ++filled;
      }
    }
  }
  g_profile.equipment.deserialize(idx);
  return filled;
}

// --- Skills ------------------------------------------------------------------
OF_API int of_pg_skill_count(void) { return static_cast<int>(pg::kSkillCount); }

OF_API int of_pg_skill_name(int i) {
  if (i < 0 || static_cast<size_t>(i) >= pg::kSkillCount) return 0;
  return stringOut(pg::skillName(static_cast<pg::SkillId>(i)));
}

// f64 scratch, FIVE fields: [level, xp, progress, multiplier, nextAt].
// `nextAt` is the TOTAL xp to reach the next level, or 0 at the cap.
OF_API int of_pg_skill_state(int i) {
  resetF64(5);
  if (i < 0 || static_cast<size_t>(i) >= pg::kSkillCount) return 0;
  const pg::SkillId s = static_cast<pg::SkillId>(i);
  const uint8_t lv = g_profile.skills.level(s);
  g_f64.push_back(static_cast<double>(lv));
  g_f64.push_back(static_cast<double>(g_profile.skills.xp(s)));
  g_f64.push_back(static_cast<double>(g_profile.skills.progress(s)));
  g_f64.push_back(static_cast<double>(g_profile.skills.multiplier(s)));
  g_f64.push_back(lv >= pg::kMaxSkillLevel ? 0.0
      : static_cast<double>(pg::xpForLevel(static_cast<uint8_t>(lv + 1))));
  return 5;
}

// Grant experience. Returns how many LEVELS that press bought, so a caller can
// put a message on screen without diffing two reports.
OF_API int of_pg_add_xp(int i, int n) {
  if (i < 0 || static_cast<size_t>(i) >= pg::kSkillCount || n <= 0) return 0;
  return static_cast<int>(g_profile.skills.addXp(static_cast<pg::SkillId>(i),
                                                 static_cast<uint32_t>(n)));
}

// Apply a skill to an integer yield, rounding DOWN, through /core's one
// published call rather than `int(n * mul)` at four call sites.
OF_API int of_pg_apply_yield(int i, int base) {
  if (i < 0 || static_cast<size_t>(i) >= pg::kSkillCount || base <= 0) return base;
  return static_cast<int>(g_profile.skills.applyYield(
      static_cast<pg::SkillId>(i), static_cast<uint32_t>(base)));
}

// i32 scratch of the five raw xp totals. What the save carries.
OF_API int of_pg_skill_xp_all(void) {
  resetI32(5);
  for (uint32_t x : g_profile.skills.raw())
    g_i32.push_back(static_cast<int32_t>(x));
  return static_cast<int>(pg::kSkillCount);
}

OF_API void of_pg_restore_skills(int mining, int forestry, int smelting,
                                 int building, int piloting) {
  const int in[5] = {mining, forestry, smelting, building, piloting};
  std::array<uint32_t, pg::kSkillCount> xp{};
  for (size_t k = 0; k < pg::kSkillCount; ++k)
    xp[k] = in[k] > 0 ? static_cast<uint32_t>(in[k]) : 0u;
  g_profile.skills.restore(xp);
}

// --- Appearance --------------------------------------------------------------
// i32 scratch: [skin, suitPrimary, suitSecondary, visor, build]. Five bytes of
// PALETTE INDICES, not free colour: a fixed palette is trivially validated,
// gives the art lane a finite set of combinations to actually look at, and
// cannot produce a player the exact grey of the rock they are standing on.
OF_API int of_pg_appearance(void) {
  resetI32(5);
  const pg::Appearance a = g_profile.appearance;
  g_i32.push_back(a.skin);          g_i32.push_back(a.suitPrimary);
  g_i32.push_back(a.suitSecondary); g_i32.push_back(a.visor);
  g_i32.push_back(a.build);
  return 5;
}

// field 0 skin, 1 suitPrimary, 2 suitSecondary, 3 visor, 4 build. Every write
// goes through /core's `sanitise`, which is idempotent, so a load-save-load
// cycle cannot walk a player's face across the palette. Returns 1 if the stored
// value ended up equal to what was asked for, 0 if it was clamped.
OF_API int of_pg_set_appearance(int field, int value) {
  pg::Appearance a = g_profile.appearance;
  const uint8_t v = static_cast<uint8_t>(value < 0 ? 0 : value);
  switch (field) {
    case 0: a.skin = v; break;
    case 1: a.suitPrimary = v; break;
    case 2: a.suitSecondary = v; break;
    case 3: a.visor = v; break;
    case 4: a.build = v; break;
    default: return 0;
  }
  g_profile.appearance = pg::sanitise(a);
  const pg::Appearance& b = g_profile.appearance;
  const uint8_t got = field == 0 ? b.skin : field == 1 ? b.suitPrimary
      : field == 2 ? b.suitSecondary : field == 3 ? b.visor : b.build;
  return got == v ? 1 : 0;
}

// i32 scratch of packed 0xRRGGBB. which: 0 skin tones, 1 suit colours, 2 visor
// tints. The INDEX is the stored byte, so the client never keeps a parallel
// table that can fall out of step with /core's.
OF_API int of_pg_palette(int which) {
  resetI32(8);
  const std::vector<pg::Rgb>& v = which == 0 ? pg::skinTones()
      : which == 1 ? pg::suitColours() : pg::visorTints();
  if (which < 0 || which > 2) return 0;
  for (const pg::Rgb& c : v)
    g_i32.push_back((static_cast<int32_t>(c.r) << 16) |
                    (static_cast<int32_t>(c.g) << 8) | static_cast<int32_t>(c.b));
  return static_cast<int>(v.size());
}
