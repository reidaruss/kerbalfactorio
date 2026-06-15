// Wave-1 headless tests for the factory RENDER-COST model (Q6 / RC-8, gate G7).
//
// These NUMERICALLY back the render-wall claim that rendering only confirmed on
// paper (rendering.md §5 RC-8), with NO GUI and NO GPU:
//
//   * Slice scale  — a few hundred machines + lines, all near (LOD-0): draw
//                    calls are on the order of the machine-TYPE count (tens, via
//                    instancing), and the per-frame item-eval count is modest.
//   * Stress scale — 100,000 entities with a realistic LOD distribution (a small
//                    near bay at LOD-0, the rest at LOD-1/2/3): item-render work
//                    scales with LINES at LOD-0 (hundreds), NOT items (millions)
//                    — the O(items)→O(lines) collapse, quantified — and total
//                    draw calls stay in the low thousands, NOT ~100k.
//   * Monotonicity — pushing entities to farther LOD bands strictly reduces
//                    cost; LOD-3 (on-rails) contributes exactly zero.
//
// It also exercises the §6 STREAM EMISSION end-to-end (G7): it builds a real
// FactorySim, drains EmitEntityStates / EmitBeltFlowStates / GetLineItems, and
// scores the result through render_cost.h — proving the stream is what feeds the
// LOD ladder and that LOD-1+ needs no per-item pulls.
#include <cstdio>
#include <vector>

#include "test_framework.h"
#include "of/factory_sim.h"
#include "of/render_cost.h"

using namespace of::factory;
using of::render::BandPopulation;
using of::render::ComputeRenderCost;
using of::render::LodBand;
using of::render::RenderCost;
using of::render::SceneDesc;

// Small helper: set one band's population in a SceneDesc.
static void setBand(SceneDesc& s, LodBand b, uint64_t machines, uint64_t lines,
                    uint64_t items) {
  s.bands[static_cast<int>(b)] = BandPopulation{machines, lines, items};
}

// =============================================================================
// STREAM EMISSION (G7) — the §6 contract is additive + read-only.
// =============================================================================

// EmitEntityStates / EmitBeltFlowStates / GetLineItems produce the pinned §6
// rows without disturbing the sim. GetLineItems is the ONLY O(items) call and
// reconstructs item offsets from the §2 gap arrays.
TEST(stream_emits_entity_and_belt_rows_and_line_items) {
  FactorySim sim;
  Recipe r;
  r.inputItem = 1; r.inputCount = 1; r.outputItem = 2; r.outputCount = 1;
  r.craftTimeTicks = 10; r.powerW = 0;

  EntityHandle m = sim.addMachine(r);
  sim.setEntityTypeId(m, /*assembler type*/ 7);
  sim.setEntityPosition(m, 10.0f, 0.0f, -3.0f);
  sim.setEntityBoundRadiusCm(m, 150);  // 1.5 m

  EntityHandle belt = sim.addBeltLine(10, 8);
  sim.setEntityTypeId(belt, /*belt type*/ 3);
  const uint32_t loaded = sim.line(belt).fillSaturated(/*item*/ 42);

  auto ents = sim.EmitEntityStates();
  auto belts = sim.EmitBeltFlowStates();

  // One row per live entity (machine + belt); one belt-flow row for the line.
  CHECK(ents.size() == 2);
  CHECK(belts.size() == 1);

  // The machine row carries the metadata we set (additive surfacing).
  bool foundMachine = false;
  for (const auto& e : ents) {
    if (e.TypeId == 7) {
      foundMachine = true;
      CHECK(e.Position[0] == 10.0f);
      CHECK(e.Position[2] == -3.0f);
      CHECK(e.BoundRadius == 150);
    }
  }
  CHECK(foundMachine);

  // The belt-flow row: dominant item, compressed flag, full density.
  CHECK(belts[0].ItemTypeDominant == 42);
  CHECK(belts[0].Compressed == 1);     // fillSaturated latches compression
  CHECK(belts[0].Density > 200);       // a saturated line reads near-full

  // GetLineItems (the lone O(items) call) returns every live item, in order.
  auto items = sim.GetLineItems(belt.index);
  CHECK(items.size() == loaded);       // 40 on a saturated 10-tile line
  CHECK(sim.lineItemCount(belt.index) == loaded);  // O(1) probe agrees
  for (const auto& it : items) CHECK(it.ItemType == 42);
  // Offsets are strictly increasing from the head (min-spaced when compressed).
  for (size_t i = 1; i < items.size(); ++i)
    CHECK(items[i].UnitOffset > items[i - 1].UnitOffset);

  // Emission did not mutate the sim: the line still carries every item.
  CHECK(sim.line(belt).itemCount() == loaded);
}

// The §6 stream is additive: a legacy scene that never touches the new setters
// still streams sane rows (TypeId 0 at the origin, defaulted ~1 m bound).
TEST(stream_is_additive_legacy_scene_streams_sane_defaults) {
  FactorySim sim;
  EntityHandle belt = sim.addBeltLine(5, 8);
  (void)belt;
  auto ents = sim.EmitEntityStates();
  CHECK(ents.size() == 1);
  CHECK(ents[0].TypeId == 0);
  CHECK(ents[0].Position[0] == 0.0f);
  CHECK(ents[0].BoundRadius == 100);  // defaulted to ~1 m on emit
}

// =============================================================================
// SLICE SCALE — a few hundred machines + lines, all near (LOD-0). Draw calls on
// the order of the machine-TYPE count (tens), item-evals bounded/modest.
//
// Built through the REAL §6 stream (EmitEntityStates + EmitBeltFlowStates +
// GetLineItems → BuildSceneFromStream → ComputeRenderCost) so the path the
// renderer would take is the path under test.
// =============================================================================
TEST(slice_scale_draw_calls_track_type_count_not_entity_count) {
  FactorySim sim;
  const int kMachines = 400;
  const int kLines = 200;
  const int kMachineTypes = 12;  // a slice has ~a dozen machine kinds...
  const int kItemTypes = 4;      // ...and a handful of belt item types.

  std::vector<EntityHandle> machineHandles;
  for (int i = 0; i < kMachines; ++i) {
    Recipe r;
    r.inputItem = 1; r.inputCount = 1;
    r.outputItem = 2; r.outputCount = 1;
    r.craftTimeTicks = 30; r.powerW = 0;
    EntityHandle m = sim.addMachine(r);
    sim.setEntityTypeId(m, static_cast<uint16_t>(100 + (i % kMachineTypes)));
    machineHandles.push_back(m);
  }
  std::vector<EntityHandle> lineHandles;
  for (int i = 0; i < kLines; ++i) {
    EntityHandle b = sim.addBeltLine(20, 8);
    sim.line(b).fillSaturated(static_cast<ItemId>(500 + (i % kItemTypes)));
    lineHandles.push_back(b);
  }

  // Drain the §6 stream. Machines are the entity rows; belts the flow rows.
  // Everything is near → LOD-0. (We tag machine rows Near0 via the lod-hint fn;
  // lines are mapped to Near0 by bandOfLine below.)
  auto ents = sim.EmitEntityStates(
      [](const FactorySim&, EntityHandle) { return Lod::Near0; });
  // Keep only machine rows for the entity-row stream (belts go through the belt
  // stream). The slice streams machines + belts separately (FS-8 split).
  std::vector<FFactoryEntityState> machineRows;
  for (auto& e : ents)
    if (e.TypeId >= 100 && e.TypeId < 100 + kMachineTypes)
      machineRows.push_back(e);
  auto belts = sim.EmitBeltFlowStates();

  SceneDesc scene = of::render::BuildSceneFromStream(
      machineRows, belts,
      /*bandOfLine*/ [](of::factory::FEntityId) { return LodBand::Near0; },
      /*itemsOnLine*/ [&](of::factory::FEntityId id) {
        return sim.lineItemCount(id);
      });

  RenderCost c = ComputeRenderCost(scene);

  std::printf(
      "    [slice]  machines=%d lines=%d  distinctTypes=%u beltMats=%u\n"
      "             drawCalls=%llu  instances=%llu (mach=%llu item=%llu)  "
      "itemEvals=%llu lineEvals=%llu\n",
      kMachines, kLines, scene.distinctMachineTypes, scene.distinctBeltMaterials,
      (unsigned long long)c.drawCalls, (unsigned long long)c.instances,
      (unsigned long long)c.machineInstances,
      (unsigned long long)c.itemInstances, (unsigned long long)c.itemEvals,
      (unsigned long long)c.lineEvalsLod1);

  // The stream surfaced exactly the slice's machine types + item materials.
  CHECK(scene.distinctMachineTypes == static_cast<uint32_t>(kMachineTypes));
  CHECK(scene.distinctBeltMaterials == static_cast<uint32_t>(kItemTypes));

  // DRAW CALLS track the TYPE count, NOT the 600 entities. At LOD-0:
  //   machine types (12) + near-belt item-mesh draws (≤ beltMats=4) = 16.
  // Far below the entity count; on the order of "tens".
  CHECK(c.drawCalls < 50);
  CHECK(c.drawCalls < static_cast<uint64_t>(kMachines));  // ≪ entities
  CHECK(c.drawCalls >= scene.distinctMachineTypes);        // at least 1/type

  // Per-frame item-eval count is bounded by the items actually on the near
  // lines (200 lines × 80 items/saturated-20-tile-line = 16,000) — modest, and
  // exactly equal to the discrete items the renderer would place at LOD-0.
  CHECK(c.itemEvals == c.itemEvalsLod0);
  CHECK(c.itemEvals == c.totalItems);   // all near → all evaluated (none avoided)
  CHECK(c.itemEvals <= 20000);          // bounded/modest for a slice bay
  CHECK(c.instances < 2000000);         // well under a ~2M GPU instance ceiling
}

// =============================================================================
// STRESS SCALE — 100,000 entities, realistic LOD distribution. The item-render
// work must scale with LINES at LOD-0 (hundreds), NOT items (millions). Draw
// calls stay in the low thousands, NOT ~100k. Prints the numbers for the record.
// =============================================================================
TEST(stress_scale_item_work_collapses_to_lines_not_items) {
  // 100k entities split across the 4 bands per the RC-8 budget: a small near
  // bay (LOD-0), a mid ring (LOD-1), a far field of impostors (LOD-2), and the
  // bulk on-rails (LOD-3, not rendered). Items exist on lines in EVERY band —
  // millions of them — but only the near bay's lines hit the O(items) path.
  const uint64_t kTotalEntities = 100000;

  // ~8 items/tile saturated × tens of tiles → ~hundreds of items per line.
  const uint64_t kItemsPerLine = 600;  // a near-saturated ~75-tile line, 2 lanes

  SceneDesc s;
  s.distinctMachineTypes = 20;   // tens of machine kinds, recurring in all bands
  s.distinctBeltMaterials = 6;   // a handful of item materials

  // Near0 — the small foreground bay: a few hundred machines + a few hundred
  // lines. THIS is the only band that pays O(items).
  const uint64_t near0Machines = 1500;
  const uint64_t near0Lines = 300;
  setBand(s, LodBand::Near0, near0Machines, near0Lines,
          near0Lines * kItemsPerLine);

  // Mid1 — the surrounding ring: instanced machines + lines as flow material.
  const uint64_t mid1Machines = 8000;
  const uint64_t mid1Lines = 2000;
  setBand(s, LodBand::Mid1, mid1Machines, mid1Lines,
          mid1Lines * kItemsPerLine);

  // Far2 — impostor field: many machines, lines folded into the impostor field.
  const uint64_t far2Machines = 30000;
  const uint64_t far2Lines = 6000;
  setBand(s, LodBand::Far2, far2Machines, far2Lines,
          far2Lines * kItemsPerLine);

  // OnRails3 — the bulk of the base, demoted to the rate model: NOT rendered.
  const uint64_t railsMachines =
      kTotalEntities - near0Machines - mid1Machines - far2Machines;  // 60,500
  const uint64_t railsLines = 12000;
  setBand(s, LodBand::OnRails3, railsMachines, railsLines,
          railsLines * kItemsPerLine);

  RenderCost c = ComputeRenderCost(s);

  std::printf(
      "\n    [STRESS 100k] entities=%llu  (Near0 m=%llu/l=%llu  Mid1 m=%llu/l=%llu"
      "  Far2 m=%llu/l=%llu  OnRails3 m=%llu/l=%llu)\n"
      "    distinctMachineTypes=%u  distinctBeltMaterials=%u\n"
      "    -> DRAW CALLS   = %llu        (NOT ~%llu entities)\n"
      "    -> INSTANCES    = %llu  (machines=%llu  near items=%llu)\n"
      "    -> ITEM-EVALS   = %llu        (O(items) work — Near0 ONLY)\n"
      "    -> LINE-EVALS   = %llu        (Mid1 flow-material, O(lines))\n"
      "    -> total items on belts = %llu  ;  items NOT evaluated (collapsed) = %llu\n",
      (unsigned long long)kTotalEntities, (unsigned long long)near0Machines,
      (unsigned long long)near0Lines, (unsigned long long)mid1Machines,
      (unsigned long long)mid1Lines, (unsigned long long)far2Machines,
      (unsigned long long)far2Lines, (unsigned long long)railsMachines,
      (unsigned long long)railsLines, s.distinctMachineTypes,
      s.distinctBeltMaterials, (unsigned long long)c.drawCalls,
      (unsigned long long)kTotalEntities, (unsigned long long)c.instances,
      (unsigned long long)c.machineInstances,
      (unsigned long long)c.itemInstances, (unsigned long long)c.itemEvals,
      (unsigned long long)c.lineEvalsLod1, (unsigned long long)c.totalItems,
      (unsigned long long)c.itemsAvoided);

  // --- THE O(items) → O(lines) COLLAPSE, QUANTIFIED -------------------------
  // Item-eval work == items on the Near0 lines == near0Lines × itemsPerLine.
  // It is bounded by LINES, not the total item population.
  CHECK(c.itemEvals == near0Lines * kItemsPerLine);   // 300 × 600 = 180,000
  // Items actually exist in the MILLIONS across all bands...
  CHECK(c.totalItems > 12000000);                     // ~12.2M discrete items
  // ...yet item-eval work is a tiny fraction of them: the collapse.
  CHECK(c.itemEvals * 50 < c.totalItems);             // <2% of items evaluated
  // The work scales with LINES at LOD-0, not items: itemEvals / itemsPerLine is
  // the Near0 LINE count (hundreds), the O(lines) quantity the wall demands.
  CHECK(c.itemEvals / kItemsPerLine == near0Lines);   // == 300 lines
  CHECK(near0Lines < 1000);                            // "hundreds, not millions"
  // The vast majority of items were collapsed away (LOD-1 material / LOD-2
  // impostor / LOD-3 not-rendered) and never hit pathUnitToWorld.
  CHECK(c.itemsAvoided >= 12000000);
  CHECK(c.itemsAvoided == c.totalItems - c.itemEvals);

  // --- DRAW CALLS scale with TYPE variety (tens), NOT entity count ----------
  // Machines instanced per TypeId in each of the 3 drawing bands (20 each) +
  // belt material draws (Near0 items + Mid1 lines): a few dozen total. The
  // budget says "low thousands at most"; we land far below even that.
  CHECK(c.drawCalls < 2000);                           // stated budget ceiling
  CHECK(c.drawCalls < kTotalEntities / 25);            // ≪ entity count (<4000)
  // Concretely: 3 drawing bands × 20 types + 6 (near item draws) + 6 (mid mats)
  // = 72. Assert it is genuinely "tens", on the order of the type count.
  CHECK(c.drawCalls <= 4 * s.distinctMachineTypes + 4 * s.distinctBeltMaterials);

  // --- INSTANCES stay under a realistic GPU ceiling -------------------------
  // Machines: 1500+8000+30000 = 39,500 drawn instances. Near items: 180,000.
  // Total ~220k — comfortably under the ~2M instance ceiling (rendering §5.2).
  CHECK(c.machineInstances == near0Machines + mid1Machines + far2Machines);
  CHECK(c.instances < 2000000);
  // The 60,500 on-rails machines + their 12k lines + 7.2M items cost ZERO.
}

// =============================================================================
// MONOTONICITY / SANITY — pushing entities to farther bands strictly reduces
// cost; LOD-3 (on-rails) contributes exactly zero.
// =============================================================================
TEST(pushing_entities_farther_strictly_reduces_cost) {
  // A fixed population of lines+machines+items, moved band-by-band from Near0
  // outward. Each step must NOT increase cost, and the item-eval count must
  // strictly drop the moment a line leaves Near0.
  const uint64_t M = 5000, L = 1000, ITEMS_PER = 500;

  auto costAllInBand = [&](LodBand b) {
    SceneDesc s;
    s.distinctMachineTypes = 15;
    s.distinctBeltMaterials = 5;
    setBand(s, b, M, L, L * ITEMS_PER);
    return ComputeRenderCost(s);
  };

  RenderCost near0 = costAllInBand(LodBand::Near0);
  RenderCost mid1 = costAllInBand(LodBand::Mid1);
  RenderCost far2 = costAllInBand(LodBand::Far2);
  RenderCost rails3 = costAllInBand(LodBand::OnRails3);

  std::printf(
      "    [monotonic] itemEvals: Near0=%llu Mid1=%llu Far2=%llu OnRails3=%llu  |"
      "  instances: %llu %llu %llu %llu  |  drawCalls: %llu %llu %llu %llu\n",
      (unsigned long long)near0.itemEvals, (unsigned long long)mid1.itemEvals,
      (unsigned long long)far2.itemEvals, (unsigned long long)rails3.itemEvals,
      (unsigned long long)near0.instances, (unsigned long long)mid1.instances,
      (unsigned long long)far2.instances, (unsigned long long)rails3.instances,
      (unsigned long long)near0.drawCalls, (unsigned long long)mid1.drawCalls,
      (unsigned long long)far2.drawCalls, (unsigned long long)rails3.drawCalls);

  // Item-eval work: Near0 pays O(items); the instant you leave Near0 it drops
  // to zero (Mid1 is a material, Far2/OnRails3 draw no items).
  CHECK(near0.itemEvals == L * ITEMS_PER);   // O(items)
  CHECK(mid1.itemEvals == 0);                // collapsed to a material
  CHECK(far2.itemEvals == 0);
  CHECK(rails3.itemEvals == 0);
  CHECK(near0.itemEvals > mid1.itemEvals);   // STRICTLY reduces leaving Near0

  // Mid1 still draws machine meshes + flow-material lines; Far2 draws impostors
  // (no belt material) → fewer draws than Mid1. Cost is non-increasing outward.
  CHECK(mid1.drawCalls <= near0.drawCalls + 0 + 1);  // comparable; both draw machines
  CHECK(far2.drawCalls <= mid1.drawCalls);           // Far2 drops the belt material
  CHECK(near0.instances >= mid1.instances);          // Near0 adds item instances
  CHECK(mid1.instances == far2.instances);           // same machine count, no items

  // LOD-3 (on-rails) contributes EXACTLY ZERO of everything — not rendered.
  CHECK(rails3.drawCalls == 0);
  CHECK(rails3.instances == 0);
  CHECK(rails3.itemEvals == 0);
  CHECK(rails3.lineEvalsLod1 == 0);

  // Total ordering of total cost (draws+instances+itemEvals) is non-increasing
  // as the population moves outward — the core monotonicity guarantee.
  auto totalCost = [](const RenderCost& c) {
    return c.drawCalls + c.instances + c.itemEvals;
  };
  CHECK(totalCost(near0) > totalCost(mid1));
  CHECK(totalCost(mid1) >= totalCost(far2));
  CHECK(totalCost(far2) > totalCost(rails3));
  CHECK(totalCost(rails3) == 0);
}
