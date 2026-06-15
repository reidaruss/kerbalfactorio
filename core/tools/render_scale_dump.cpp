// =============================================================================
// render_scale_dump.cpp — headless render-wall SCALE sweep (a NEW consumer of
// of_core / render_cost.h). Makes the RC-8 "render wall cleared" verdict
// VISIBLE as a number that scales the right way.
//
// It sweeps total factory ENTITY COUNT across a realistic range (1k -> 200k) and
// at each count builds a SceneDesc with a FIXED, realistic LOD distribution:
//
//   * a small NEAR bay (LOD-0) that stays ~constant in absolute size as the
//     factory grows — the foreground you actually look at. This is the ONLY band
//     that pays the O(items) GetLineItems cost.
//   * the REST of the base spread across LOD-1 (mid ring) / LOD-2 (impostor
//     field) / LOD-3 (on-rails, NOT rendered) — i.e. most of a big base is far
//     or on rails, exactly as the LOD ladder intends.
//
// With ~20 machine types and ~8 items/tile, it then runs ComputeRenderCost and
// records, per entity count:
//
//   entities, items_in_flight, draw_calls, instances, item_evals,
//   naive_o_items (== items_in_flight — the work a naive O(items) renderer would
//                  do every frame, the explosion the LOD ladder AVOIDS).
//
// The headline: draw_calls stays FLAT (~tens, type-bucketed) and item_evals
// scales with the NEAR bay's LINES (O(lines), ~constant), while the naive
// O(items) baseline climbs into the millions. The wall is cleared.
//
// This file modifies NO core header — it only READS the public render_cost.h API
// and records what it computes, exactly like a test would.
// =============================================================================
#include <cstdio>
#include <cstdint>
#include <array>

#include "of/render_cost.h"

using of::render::BandPopulation;
using of::render::ComputeRenderCost;
using of::render::LodBand;
using of::render::RenderCost;
using of::render::SceneDesc;

namespace {

// --- Fixed, realistic scene parameters (mirror test_render_cost.cpp's stress
//     scene assumptions so the numbers are directly comparable). ---------------
constexpr uint32_t kDistinctMachineTypes = 20;  // ~20 machine kinds (tens)
constexpr uint32_t kDistinctBeltMaterials = 6;  // a handful of item materials

// ~8 items/tile saturated over a ~75-tile, 2-lane line -> ~600 items/line. This
// is the per-line item population that exists on belts in EVERY band — but is
// only EVALUATED at LOD-0 (the collapse). Mirrors test_render_cost.cpp.
constexpr uint64_t kItemsPerLine = 600;

// A factory has roughly one transport line per ~5 machines. Used to derive a
// line count from a machine count per band, so item population scales with the
// base the way it would in-game.
constexpr uint64_t kMachinesPerLine = 5;

// The NEAR (LOD-0) bay stays ~constant in ABSOLUTE size as the base grows — it
// is the foreground you can actually see at full detail. THIS is what makes
// item-eval work O(near lines), not O(total items).
constexpr uint64_t kNear0Machines = 1500;  // ~the on-screen foreground bay
constexpr uint64_t kNear0Lines = kNear0Machines / kMachinesPerLine;  // 300

// As the factory scales past the near bay, the REMAINDER is split across the
// farther bands by these fractions (most of a big base is far / on rails).
constexpr double kFracMid1 = 0.15;   // mid ring (LOD-1): flow-material belts
constexpr double kFracFar2 = 0.25;   // impostor field (LOD-2)
// remainder (0.60) -> OnRails3 (LOD-3): NOT rendered.

// Helper: set one band's population.
void setBand(SceneDesc& s, LodBand b, uint64_t machines, uint64_t lines,
             uint64_t items) {
  s.bands[static_cast<int>(b)] = BandPopulation{machines, lines, items};
}

// Build the realistic scene for a given TOTAL entity count.
SceneDesc buildScene(uint64_t totalEntities) {
  SceneDesc s;
  s.distinctMachineTypes = kDistinctMachineTypes;
  s.distinctBeltMaterials = kDistinctBeltMaterials;

  // NEAR bay (LOD-0) — fixed absolute size, clamped so tiny factories still fit.
  uint64_t near0Machines =
      totalEntities < kNear0Machines ? totalEntities : kNear0Machines;
  uint64_t near0Lines = near0Machines / kMachinesPerLine;
  setBand(s, LodBand::Near0, near0Machines, near0Lines,
          near0Lines * kItemsPerLine);

  // Everything beyond the near bay is split across the farther bands.
  uint64_t remainder = totalEntities - near0Machines;
  uint64_t mid1Machines = static_cast<uint64_t>(remainder * kFracMid1);
  uint64_t far2Machines = static_cast<uint64_t>(remainder * kFracFar2);
  uint64_t railsMachines = remainder - mid1Machines - far2Machines;

  uint64_t mid1Lines = mid1Machines / kMachinesPerLine;
  uint64_t far2Lines = far2Machines / kMachinesPerLine;
  uint64_t railsLines = railsMachines / kMachinesPerLine;

  setBand(s, LodBand::Mid1, mid1Machines, mid1Lines, mid1Lines * kItemsPerLine);
  setBand(s, LodBand::Far2, far2Machines, far2Lines, far2Lines * kItemsPerLine);
  setBand(s, LodBand::OnRails3, railsMachines, railsLines,
          railsLines * kItemsPerLine);
  return s;
}

}  // namespace

int main() {
  const char* kCsvPath = "docs/phase1/artifacts/render_scale.csv";
  FILE* csv = std::fopen(kCsvPath, "w");
  if (!csv) {
    std::fprintf(stderr,
                 "render_scale_dump: could not open %s for writing\n", kCsvPath);
    return 1;
  }

  std::fprintf(csv,
      "entities,items_in_flight,draw_calls,instances,item_evals,naive_o_items\n");

  // Realistic entity-count sweep: 1k -> 200k.
  const std::array<uint64_t, 8> sweep = {
      1000, 2000, 5000, 10000, 20000, 50000, 100000, 200000};

  // Capture the 100k row for the one-line summary.
  uint64_t at100k_drawCalls = 0, at100k_itemEvals = 0, at100k_itemsInFlight = 0;

  for (uint64_t entities : sweep) {
    SceneDesc s = buildScene(entities);
    RenderCost c = ComputeRenderCost(s);

    // "items in flight" = every discrete belt item that physically exists across
    // ALL bands this frame — the population a naive O(items) renderer would have
    // to evaluate. The LOD ladder only evaluates item_evals (Near0) of them.
    const uint64_t itemsInFlight = c.totalItems;

    std::fprintf(csv, "%llu,%llu,%llu,%llu,%llu,%llu\n",
                 (unsigned long long)entities,
                 (unsigned long long)itemsInFlight,
                 (unsigned long long)c.drawCalls,
                 (unsigned long long)c.instances,
                 (unsigned long long)c.itemEvals,
                 (unsigned long long)itemsInFlight);  // naive_o_items

    if (entities == 100000) {
      at100k_drawCalls = c.drawCalls;
      at100k_itemEvals = c.itemEvals;
      at100k_itemsInFlight = itemsInFlight;
    }
  }

  std::fclose(csv);

  // One-line summary (printed to stdout).
  std::printf(
      "[render_scale_dump] sweep 1k..200k entities -> %s\n"
      "  at 100k entities: draw_calls=%llu  item_evals=%llu  "
      "items_in_flight=%llu  (naive O(items) would eval all %llu)\n",
      kCsvPath,
      (unsigned long long)at100k_drawCalls,
      (unsigned long long)at100k_itemEvals,
      (unsigned long long)at100k_itemsInFlight,
      (unsigned long long)at100k_itemsInFlight);

  return 0;
}
