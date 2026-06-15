#pragma once
// =============================================================================
// render_cost.h — Numeric render-cost model for the factory render wall (Q6 /
// RC-8), proven HEADLESSLY. Pure arithmetic over a scene description; no GPU,
// no UE, no GUI. This is the quantitative backing for the RC-8 verdict that
// rendering only confirmed *on paper*: it shows that with the RN-3 LOD ladder
// (spike1-rendering §5.4) fed by factory-sim's §6 stream,
//
//   1. per-frame ITEM-RENDER work collapses from O(items) to O(lines) the
//      instant a line leaves the closest LOD band (LOD-0 is the ONLY band that
//      calls GetLineItems — the lone O(items) pull, §6.2), and
//   2. DRAW CALLS scale with MACHINE-TYPE count (tens, via instancing), NOT
//      entity count — so a slice-scale factory AND a 100k-entity stress factory
//      both fit a realistic per-frame budget.
//
// The model is deliberately the *cost-counting half* of rendering's RN-3 ladder
// (rendering.md §5 RC-8 table) reduced to integers we can assert on. It is NOT
// a renderer; it counts the work a renderer would issue, given how the sim's
// §6 stream lets it stop pulling per-item data when zoomed out.
//
// Header-only, depends only on the C++17 stdlib (+ optionally factory_sim.h for
// the stream-consuming helpers). No engine, no rendering, no I/O.
// =============================================================================
#include <cstdint>
#include <vector>
#include <array>
#include <cstddef>

namespace of {
namespace render {

// The four RN-3 LOD bands (spike1-rendering §5.4 / rendering.md §5 RC-8 table).
//   Near0   : full instanced machine meshes + DISCRETE animated item meshes on
//             belts (GetLineItems → O(items) — the ONLY band that pays it).
//   Mid1    : instanced machines; belt items as a scrolling-flow MATERIAL
//             (FFactoryBeltFlowState) → O(lines), no per-item data.
//   Far2    : machine IMPOSTORS (2-tri billboards), no items → ~0 per-item work.
//   OnRails3: NOT rendered — the chunk is demoted to an ISimProxy rate model
//             (factory-sim §5); the proxy emits no per-entity stream → 0 cost.
enum class LodBand : uint8_t { Near0 = 0, Mid1 = 1, Far2 = 2, OnRails3 = 3 };
static constexpr int kNumLodBands = 4;

// --- Scene description ------------------------------------------------------
// A coarse, instancing-aware description of one frame's visible factory, split
// across the 4 LOD bands. This is what a renderer derives from the §6 stream +
// the camera (screen-space band selection); here we feed it directly so the
// model is a pure function of the scene, independent of any camera.
struct BandPopulation {
  uint64_t machines = 0;       // machine/impostor entities in this band
  uint64_t lines = 0;          // transport lines visible in this band
  uint64_t itemsOnLines = 0;   // discrete items carried by THIS band's lines
                               //   (only matters at Near0 — the O(items) input)
};

struct SceneDesc {
  // Per-band population. Index by static_cast<int>(LodBand).
  std::array<BandPopulation, kNumLodBands> bands{};

  // How many DISTINCT machine TypeIds appear in the visible set. Instancing
  // buckets draw calls by TypeId, so this — NOT the entity count — is what
  // drives the machine draw-call total. Tens, by design (a factory has tens of
  // machine kinds, however many thousands of instances of each).
  uint32_t distinctMachineTypes = 0;

  // How many DISTINCT belt materials appear (LOD-1 scrolling-flow material is
  // one instanced/merged draw per material). Usually a small handful.
  uint32_t distinctBeltMaterials = 0;
};

// --- Cost result ------------------------------------------------------------
// Everything the model computes for one frame. All integer; all assertable.
struct RenderCost {
  // DRAW CALLS — the headline. Machines instanced per TypeId per drawing band
  // (Near0/Mid1/Far2 each issue one instanced draw per TypeId present), belts
  // one per material at Mid1, impostors one merged draw at Far2. OnRails3 = 0.
  uint64_t drawCalls = 0;

  // INSTANCED-MESH INSTANCES pushed to the GPU (machines at Near0/Mid1 as full
  // meshes, Far2 as billboard impostors). Bounded by the instance ceiling, not
  // by draw calls. Items add instances only at Near0 (see itemInstances).
  uint64_t machineInstances = 0;
  uint64_t itemInstances = 0;   // discrete belt-item instances — Near0 ONLY
  uint64_t instances = 0;       // machineInstances + itemInstances

  // PER-FRAME ITEM-EVALUATION count — the O(items)→O(lines) collapse, made
  // numeric. This is the work that scales with items vs lines:
  //   itemEvalsLod0 : GetLineItems pulls + pathUnitToWorld evals at Near0
  //                   (O(items in the Near0 band) — the lone O(items) cost).
  //   lineEvalsLod1 : one flow-material param set per Mid1 line (O(lines)).
  //   itemEvals     : itemEvalsLod0 (the number the wall is fought over).
  uint64_t itemEvalsLod0 = 0;   // == items on Near0 lines (O(items), bounded)
  uint64_t lineEvalsLod1 = 0;   // == Mid1 lines             (O(lines))
  uint64_t itemEvals = 0;       // total discrete-item evals this frame (= Lod0)

  // Bookkeeping: how many lines/items existed vs how many actually hit the
  // O(items) path — quantifies "we paid for items only in the near bay".
  uint64_t totalLines = 0;
  uint64_t totalItems = 0;      // discrete items across ALL bands' lines
  uint64_t itemsAvoided = 0;    // totalItems - itemEvalsLod0 (collapsed away)
};

// --- The model --------------------------------------------------------------
// Pure function: SceneDesc -> RenderCost. The whole RC-8 argument lives here.
inline RenderCost ComputeRenderCost(const SceneDesc& s) {
  RenderCost c;

  const BandPopulation& n0 = s.bands[static_cast<int>(LodBand::Near0)];
  const BandPopulation& m1 = s.bands[static_cast<int>(LodBand::Mid1)];
  const BandPopulation& f2 = s.bands[static_cast<int>(LodBand::Far2)];
  const BandPopulation& r3 = s.bands[static_cast<int>(LodBand::OnRails3)];

  // ---- DRAW CALLS: bucket by TypeId/material per DRAWING band, NOT per entity.
  // Each band that draws machines issues one instanced draw per distinct TypeId
  // *present in the visible set*. We use distinctMachineTypes as the per-band
  // ceiling (the realistic case: the few machine kinds recur in every band). A
  // band with zero machines issues zero machine draws.
  auto machineTypesIn = [&](const BandPopulation& b) -> uint64_t {
    return b.machines ? s.distinctMachineTypes : 0;
  };
  // Near0: one instanced machine draw per TypeId.
  c.drawCalls += machineTypesIn(n0);
  // Mid1: one instanced machine draw per TypeId + one belt-material draw each.
  c.drawCalls += machineTypesIn(m1);
  c.drawCalls += (m1.lines ? s.distinctBeltMaterials : 0);
  // Far2: impostors — one merged billboard draw per TypeId (still type-bucketed,
  // and cheaper). No belt material at Far2 (items vanish into the impostor field).
  c.drawCalls += machineTypesIn(f2);
  // Near0 belts: discrete items are instanced per item-mesh TypeId (a handful);
  // model them as the same belt-material bucket count (one instanced item draw
  // per item-mesh type). Conservative: at most distinctBeltMaterials draws.
  c.drawCalls += (n0.lines ? s.distinctBeltMaterials : 0);
  // OnRails3 (r3): NOT rendered — contributes ZERO draw calls (and zero of
  // everything else). Referenced explicitly so the intent is unambiguous.
  (void)r3;

  // ---- INSTANCES: machines as full-mesh instances (Near0/Mid1), as impostor
  // billboards (Far2). Items as discrete instances ONLY at Near0.
  c.machineInstances = n0.machines + m1.machines + f2.machines;
  c.itemInstances = n0.itemsOnLines;  // discrete item meshes — Near0 only
  c.instances = c.machineInstances + c.itemInstances;

  // ---- THE COLLAPSE: item-evaluation work.
  // Near0 lines call GetLineItems → O(items on Near0 lines): one
  // pathUnitToWorld eval + one instance write per item. THIS is the only
  // O(items) cost (§6.2 / rendering R5).
  c.itemEvalsLod0 = n0.itemsOnLines;
  // Mid1 lines are a flow MATERIAL: one param set per line → O(lines), NOT
  // O(items). Far2/OnRails3 contribute zero item work.
  c.lineEvalsLod1 = m1.lines;
  c.itemEvals = c.itemEvalsLod0;

  // ---- Bookkeeping for the assertions / the record.
  c.totalLines = n0.lines + m1.lines + f2.lines + r3.lines;
  c.totalItems =
      n0.itemsOnLines + m1.itemsOnLines + f2.itemsOnLines + r3.itemsOnLines;
  c.itemsAvoided =
      c.totalItems > c.itemEvalsLod0 ? c.totalItems - c.itemEvalsLod0 : 0;
  return c;
}

// =============================================================================
// Stream-consuming helpers — build a SceneDesc straight from factory-sim's §6
// stream (EmitEntityStates / EmitBeltFlowStates / GetLineItems). These are the
// "expose helpers that take the stream from (1)" hook: given the per-entity
// rows (each carrying a Lod band) + the belt-flow rows + an item-count probe
// for the Near0 lines, assemble the SceneDesc the model scores.
//
// Templated on the row types so render_cost.h has NO hard dependency on
// factory_sim.h — a test (or any consumer) passes the §6 vectors directly.
// Each EntityRow must expose .TypeId and .Lod (0..3); each BeltRow must expose
// .LineId and .Lod-equivalent band (we take the band from a parallel lookup).
// =============================================================================

// Build a SceneDesc from entity rows + belt rows. `bandOfLine(lineId)` returns
// the LOD band for a given line; `itemsOnLine(lineId)` returns its live item
// count (only consulted for Near0 lines — the O(items) gate). Machine rows are
// bucketed into bands by their .Lod; distinct TypeIds are counted across all
// drawn (non-OnRails3) machine rows.
template <typename EntityRow, typename BeltRow, typename BandOfLineFn,
          typename ItemsOnLineFn>
SceneDesc BuildSceneFromStream(const std::vector<EntityRow>& entities,
                               const std::vector<BeltRow>& belts,
                               BandOfLineFn bandOfLine,
                               ItemsOnLineFn itemsOnLine) {
  SceneDesc s;
  // Count distinct machine TypeIds among DRAWN machines (bands 0..2). A small
  // dense set: factory machine TypeIds are few, so a flat presence vector is
  // cheap and avoids pulling in <unordered_set>.
  std::vector<uint8_t> seenType;  // index by TypeId
  uint32_t distinctTypes = 0;
  for (const EntityRow& e : entities) {
    int band = static_cast<int>(e.Lod);
    if (band < 0 || band >= kNumLodBands) continue;
    // Belts are streamed as belt rows, not here; entity rows are machines/
    // impostors. (Lines without a machine TypeId still count as a machine slot
    // only if the consumer streams them here; the slice streams machines here
    // and belts separately, which is the intended split.)
    s.bands[band].machines += 1;
    if (band != static_cast<int>(LodBand::OnRails3)) {
      if (e.TypeId >= seenType.size()) seenType.resize(e.TypeId + 1, 0);
      if (!seenType[e.TypeId]) {
        seenType[e.TypeId] = 1;
        ++distinctTypes;
      }
    }
  }
  s.distinctMachineTypes = distinctTypes;

  // Belt rows → per-band line counts (+ items on Near0 lines only).
  std::vector<uint8_t> seenMat;
  uint32_t distinctMats = 0;
  for (const BeltRow& b : belts) {
    int band = static_cast<int>(bandOfLine(b.LineId));
    if (band < 0 || band >= kNumLodBands) continue;
    s.bands[band].lines += 1;
    // distinct belt material ≈ distinct dominant item type among drawn lines.
    if (band != static_cast<int>(LodBand::OnRails3)) {
      uint16_t mat = b.ItemTypeDominant;
      if (mat >= seenMat.size()) seenMat.resize(mat + 1, 0);
      if (!seenMat[mat]) {
        seenMat[mat] = 1;
        ++distinctMats;
      }
    }
    // Items: count them for EVERY band into the band's itemsOnLines so the
    // model can report totalItems (and itemsAvoided). The model only EVALUATES
    // them at Near0 — that is the whole point.
    s.bands[band].itemsOnLines += itemsOnLine(b.LineId);
  }
  s.distinctBeltMaterials = distinctMats;
  return s;
}

}  // namespace render
}  // namespace of
