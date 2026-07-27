// =============================================================================
// of_staging_api.inc: §12 of the bridge: STAGING and the derived figures.
//
// Included from of_core_api.cpp, after of_vessel_api.inc.
//
// Two things here are more than a copy-out and are therefore documented in full:
//
//   * of_vs_autostage derives a default staging FROM THE TREE. The rule is
//     PH-17's, applied outward: a decoupler and everything below it burns
//     together, deeper decouplers fire first, and a stage press lights burn k
//     while dropping the hardware of burn k-1. It exists because an assembly UI
//     that made the player hand-build the stage table before seeing a delta-v
//     number would be unusable, and because getting it wrong by one is the
//     classic KSP failure this view exists to prevent.
//
//   * of_vs_stage_move REORDERS the stage table AND renumbers every part's
//     stage group through the same permutation. Moving the rows alone would
//     leave PartInstance::stage pointing at the old row, and since every
//     per-stage figure is a filter over that integer (vessel.h §7), the readout
//     would silently describe a vessel that does not exist. The permutation is
//     applied to both or to neither.
// =============================================================================

#include <algorithm>   // std::sort, for the autostage depth ordering

namespace {

// Depth from the root, or -1 for an orphan. Small trees; a walk is cheaper than
// an index.
int partDepth(const vs::Vessel& v, const vs::PartInstance& p) {
  int d = 0;
  vs::PartHandle cur = p.parent;
  while (cur != vs::kNoHandle && d < 4096) {
    const vs::PartInstance* q = v.find(cur);
    if (!q) return -1;
    cur = q->parent;
    ++d;
  }
  return d;
}

}  // namespace

// =============================================================================
// §12.1: the stage table.
// =============================================================================

OF_API int of_vs_stage_count(int v) {
  vs::Vessel* p = g_vessels.get(v);
  return p ? static_cast<int>(p->stages.size()) : 0;
}

// i32 scratch [nActivate, nDecouple, activate handles..., decouple handles...].
// Returns the word count, or 0 for a bad index.
OF_API int of_vs_stage_info(int v, int k) {
  resetI32(16);
  vs::Vessel* p = g_vessels.get(v);
  if (!p || k < 0 || k >= static_cast<int>(p->stages.size())) return 0;
  const vs::Stage& s = p->stages[static_cast<size_t>(k)];
  g_i32.push_back(static_cast<int32_t>(s.activate.size()));
  g_i32.push_back(static_cast<int32_t>(s.decouple.size()));
  for (vs::PartHandle h : s.activate) g_i32.push_back(static_cast<int32_t>(h));
  for (vs::PartHandle h : s.decouple) g_i32.push_back(static_cast<int32_t>(h));
  return static_cast<int>(g_i32.size());
}

OF_API int of_vs_stage_clear(int v) {
  vs::Vessel* p = g_vessels.get(v);
  if (!p) return 0;
  p->stages.clear();
  p->nextStageIndex = 0;
  for (auto& q : p->parts) q.stage = vs::kNeverDecoupled;
  return 1;
}

// Append an empty stage row. -> its index, or -1.
OF_API int of_vs_stage_add(int v) {
  vs::Vessel* p = g_vessels.get(v);
  if (!p) return -1;
  p->stages.push_back(vs::Stage{});
  return static_cast<int>(p->stages.size()) - 1;
}

// which: 0 = activate list, 1 = decouple list.
OF_API int of_vs_stage_push(int v, int k, int which, int handle) {
  vs::Vessel* p = g_vessels.get(v);
  if (!p || k < 0 || k >= static_cast<int>(p->stages.size())) return 0;
  const auto h = static_cast<vs::PartHandle>(handle);
  if (!p->find(h)) return 0;
  if (which == 0) p->stages[static_cast<size_t>(k)].activate.push_back(h);
  else            p->stages[static_cast<size_t>(k)].decouple.push_back(h);
  return 1;
}

// Derive the whole stage table from the tree. -> the number of stages.
//
// A vessel with no decouplers is ONE stage: everything is payload, the engines
// light on the first press, and that is the correct reading of a single-stage
// rocket rather than a degenerate case needing its own branch.
OF_API int of_vs_autostage(int v) {
  vs::Vessel* p = g_vessels.get(v);
  if (!p || p->parts.empty()) return 0;

  // Decouplers, grouped by tree depth, deepest first: parts furthest from the
  // pod leave first, and two radial decouplers at the same depth (a pair of
  // strap-ons) leave together, which needs no special case precisely because
  // the rule is stated over the tree.
  std::vector<std::pair<int, vs::PartHandle>> decs;
  for (const auto& q : p->parts)
    if (p->def(q).isDecoupler()) decs.push_back({partDepth(*p, q), q.handle});
  std::sort(decs.begin(), decs.end(),
            [](const std::pair<int, vs::PartHandle>& a,
               const std::pair<int, vs::PartHandle>& b) { return a.first > b.first; });

  std::vector<std::vector<vs::PartHandle>> groups;   // one entry per burn, 0 first
  for (size_t i = 0; i < decs.size();) {
    size_t j = i;
    std::vector<vs::PartHandle> same;
    while (j < decs.size() && decs[j].first == decs[i].first) {
      same.push_back(decs[j].second);
      ++j;
    }
    groups.push_back(same);
    i = j;
  }

  for (auto& q : p->parts) q.stage = vs::kNeverDecoupled;
  for (size_t g = 0; g < groups.size(); ++g) {
    for (vs::PartHandle dh : groups[g]) {
      for (auto& q : p->parts) {
        if (q.stage != vs::kNeverDecoupled) continue;   // a deeper group owns it
        if (p->isInSubtree(q.handle, dh)) q.stage = static_cast<int>(g);
      }
    }
  }

  // The KSP press sequence: stage k lights burn k and drops burn k-1.
  const int burns = static_cast<int>(groups.size()) + 1;
  p->stages.clear();
  for (int k = 0; k < burns; ++k) {
    vs::Stage s;
    const int want = (k == burns - 1) ? vs::kNeverDecoupled : k;
    for (const auto& q : p->parts)
      if (q.stage == want && p->def(q).isEngine()) s.activate.push_back(q.handle);
    if (k > 0)
      for (vs::PartHandle dh : groups[static_cast<size_t>(k) - 1]) s.decouple.push_back(dh);
    p->stages.push_back(s);
  }
  p->nextStageIndex = 0;
  p->layout();
  return burns;
}

// Move stage row `from` to index `to`, renumbering every part's stage group
// through the SAME permutation (see the file header). -> 1 on success.
OF_API int of_vs_stage_move(int v, int from, int to) {
  vs::Vessel* p = g_vessels.get(v);
  if (!p) return 0;
  const int n = static_cast<int>(p->stages.size());
  if (from < 0 || from >= n || to < 0 || to >= n || from == to) return 0;

  std::vector<int> order;                       // new index -> old index
  for (int i = 0; i < n; ++i) if (i != from) order.push_back(i);
  order.insert(order.begin() + to, from);

  std::vector<int> oldToNew(static_cast<size_t>(n), 0);
  for (int i = 0; i < n; ++i) oldToNew[static_cast<size_t>(order[static_cast<size_t>(i)])] = i;

  std::vector<vs::Stage> rows;
  rows.reserve(static_cast<size_t>(n));
  for (int i = 0; i < n; ++i) rows.push_back(p->stages[static_cast<size_t>(order[static_cast<size_t>(i)])]);
  p->stages.swap(rows);

  for (auto& q : p->parts)
    if (q.stage >= 0 && q.stage < n) q.stage = oldToNew[static_cast<size_t>(q.stage)];

  p->nextStageIndex = 0;
  return 1;
}

// Fire the next stage on the DESIGN (the assembly view never calls this; flight
// does, through of_fl_stage). -> the jettisoned mass in kg, or -1 if there was
// nothing left to fire.
OF_API double of_vs_fire_stage(int v) {
  vs::Vessel* p = g_vessels.get(v);
  if (!p) return -1.0;
  const vs::StageResult r = vs::fireStage(*p);
  return r.fired ? r.jettisonedMassKg : -1.0;
}

OF_API int of_vs_next_stage_index(int v) {
  vs::Vessel* p = g_vessels.get(v);
  return p ? p->nextStageIndex : -1;
}

// =============================================================================
// §12.2: the derived figures. DW-30 item 4: per-stage delta-v is ALWAYS
// visible, so this is the call the assembly view makes every time anything
// changes, and it is one pass over a tree of tens of parts.
// =============================================================================

// f64 scratch, 12 per stage, in firing order:
//   [index, startMassKg, endMassKg, propellantKg, ispVacuumS, ispSeaLevelS,
//    thrustVacuumN, thrustSeaLevelN, massFlowKgS, deltaVVacuumMS,
//    deltaVSeaLevelMS, burnTimeS]
// Returns the STAGE COUNT (so the element count is 12x that).
OF_API int of_vs_stage_performance(int v) {
  vs::Vessel* p = g_vessels.get(v);
  resetF64(p ? p->stages.size() * 12 : 0);
  if (!p) return 0;
  p->layout();
  const std::vector<vs::StagePerformance> all = vs::allStagePerformance(*p);
  for (const vs::StagePerformance& s : all) {
    g_f64.push_back(static_cast<double>(s.index));
    g_f64.push_back(s.startMassKg);   g_f64.push_back(s.endMassKg);
    g_f64.push_back(s.propellantKg);  g_f64.push_back(s.ispVacuumS);
    g_f64.push_back(s.ispSeaLevelS);  g_f64.push_back(s.thrustVacuumN);
    g_f64.push_back(s.thrustSeaLevelN); g_f64.push_back(s.massFlowKgS);
    g_f64.push_back(s.deltaVVacuumMS);  g_f64.push_back(s.deltaVSeaLevelMS);
    g_f64.push_back(s.burnTimeS);
  }
  return static_cast<int>(all.size());
}

OF_API double of_vs_total_dv_vacuum(int v) {
  vs::Vessel* p = g_vessels.get(v);
  if (!p) return 0.0;
  p->layout();
  return vs::totalDeltaVVacuumMS(*p);
}

OF_API double of_vs_remaining_dv_vacuum(int v) {
  vs::Vessel* p = g_vessels.get(v);
  if (!p) return 0.0;
  p->layout();
  return vs::remainingDeltaVVacuumMS(*p);
}

// f64 scratch, EXACTLY 15:
//   [dryKg, propellantKg, totalKg, comX, comY, comZ, copX, copY, copZ,
//    normalCdA, axialCdA, normalForceSlope, IxxKgM2, IyyKgM2, IzzKgM2]
OF_API int of_vs_mass_properties(int v) {
  resetF64(15);
  vs::Vessel* p = g_vessels.get(v);
  if (!p) return 0;
  p->layout();
  const vs::MassProperties m = vs::massProperties(*p);
  const double a[15] = {m.dryKg, m.propellantKg, m.totalKg,
                        m.comM.x, m.comM.y, m.comM.z,
                        m.copM.x, m.copM.y, m.copM.z,
                        m.normalCdA, m.axialCdA, m.normalForceSlope,
                        m.IxxKgM2, m.IyyKgM2, m.IzzKgM2};
  for (double x : a) g_f64.push_back(x);
  return 15;
}

// Negative is STABLE (the centre of pressure is behind the centre of mass).
OF_API double of_vs_static_margin(int v) {
  vs::Vessel* p = g_vessels.get(v);
  if (!p) return 0.0;
  p->layout();
  return vs::staticMarginM(vs::massProperties(*p));
}

// Thrust-to-weight for one stage at a body and altitude. `body` is an
// of_body_create* handle: gravity comes from its muM3S2 and NOTHING ELSE
// (DW-18), and thrust lapses through that body's own atmosphere, so the pad
// number is honest and it rises as the vehicle climbs.
OF_API double of_vs_twr(int v, int stageIndex, int body, double altitudeM) {
  vs::Vessel* p = g_vessels.get(v);
  const wg::BodyParams* b = g_bodies.get(body);
  if (!p || !b) return 0.0;
  p->layout();
  return vs::thrustToWeight(*p, stageIndex, b->muM3S2, b->radiusM, altitudeM,
                            of::atmo::atmosphereForBody(b->bodyId));
}

// Total propellant of one kind aboard, in kg. 1 = LiquidFuel, 2 = SolidFuel,
// 3 = Monopropellant.
OF_API double of_vs_propellant_aboard(int v, int kind) {
  vs::Vessel* p = g_vessels.get(v);
  if (!p) return 0.0;
  return vs::propellantAboardKg(*p, static_cast<vs::Propellant>(kind));
}

// Crew capacity summed over the tree, so the UI can say "1 seat" without
// knowing which part carries it.
OF_API int of_vs_crew_capacity(int v) {
  vs::Vessel* p = g_vessels.get(v);
  if (!p) return 0;
  int n = 0;
  for (const auto& q : p->parts) n += p->def(q).crewCapacity;
  return n;
}
