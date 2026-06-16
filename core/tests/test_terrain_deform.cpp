// Headless tests for the TERRAIN-DEFORMATION layer (terrain_deform.h) — the
// Valheim-style digging foundation. Proves:
//   - digBrush lowers terrain by the requested amount within radius, with a soft
//     falloff (centre deeper than rim), NOT below max depth (clamp asserted),
//     and leaves cells OUTSIDE the radius untouched.
//   - deformedHeight == base where there are no edits (BIT-IDENTICAL), and
//     == base − edit (clamped to bedrock) where edited.
//   - drillStep deepens a column over N calls and STOPS at bedrock (max depth).
//   - editedCellsInQuad returns exactly the edited cells overlapping a quad.
//   - persistence round-trips (edit -> serialize -> deserialize -> identical
//     deformed heights).
//   - determinism: the same op sequence yields the same edit map + heights.
#include <cstdint>
#include <cstring>
#include <vector>

#include "test_framework.h"
#include "of/cubed_sphere.h"
#include "of/biome.h"
#include "of/terrain_deform.h"
#include "of/persistence.h"  // reuse SaveWriter/SaveReader as the cursor (style check)

using namespace of;
using namespace of::worldgen;

static uint64_t asBits(double d) {
  uint64_t u; std::memcpy(&u, &d, sizeof(u)); return u;
}

// A direction safely on land/open surface (away from the cube seams) for digging.
static Vec3 sampleDir() { return latLonToDir(0.20, 0.55); }

// =============================================================================
// digBrush lowers terrain within the radius by the requested amount, with a soft
// falloff (centre dug deeper than the rim), and does NOT touch cells outside the
// radius.
// =============================================================================
TEST(dig_brush_lowers_with_falloff_inside_radius) {
  const BodyParams forge = makeForge(20260616ull);
  TerrainDeform deform;
  const Vec3 c = sampleDir();
  const double radiusM = 30.0;
  const double amountM = 4.0;

  const double removed = deform.digBrush(forge, c, radiusM, amountM);
  CHECK(removed > 0.0);                 // something was dug
  CHECK(!deform.empty());

  // Centre cell lowered ~ the full amount.
  const double centreDug = deform.depthDugAt(c);
  CHECK_NEAR(centreDug, amountM, 0.5);  // near full at centre (falloff ~1)

  // A cell well outside the radius is untouched (still 0 / bit-identical base).
  const Vec3 farDir = latLonToDir(0.20, 0.55 + 0.05);  // ~ many cell pitches away
  CHECK(deform.depthDugAt(farDir) == 0.0);

  // Falloff: a point near the rim is dug LESS than the centre.
  // Step ~ 0.8 * radius along longitude from centre.
  const double pitch = deformCellPitchM(forge);
  const double dLon = (0.75 * radiusM) / (forge.radiusM);  // ~ arc angle
  const Vec3 rimDir = latLonToDir(0.20, 0.55 + dLon);
  const double rimDug = deform.depthDugAt(rimDir);
  CHECK(rimDug >= 0.0);
  CHECK(rimDug < centreDug);            // rim shallower than centre
  (void)pitch;
}

// =============================================================================
// digBrush CLAMPS at max dig depth: repeated digging never lowers a cell past
// base − maxDigDepth (bedrock), and returns 0 once bedrock is reached.
// =============================================================================
TEST(dig_brush_clamps_at_max_depth) {
  const BodyParams forge = makeForge(7ull);
  TerrainDeform deform(50.0);  // shallow-ish bedrock for a fast test
  const Vec3 c = sampleDir();

  // Hammer the same spot until the dig converges (everything in reach at bedrock).
  // Falloff means rim cells take more passes than the centre to bottom out, so we
  // dig to convergence rather than a fixed count.
  double lastRemoved = 1.0;
  int passes = 0;
  for (int i = 0; i < 500 && lastRemoved > 0.0; ++i) {
    lastRemoved = deform.digBrush(forge, c, 8.0, 10.0);
    ++passes;
  }

  // Centre is pinned at exactly the max depth, never deeper.
  CHECK_NEAR(deform.depthDugAt(c), 50.0, 1e-9);
  CHECK(deform.depthDugAt(c) <= 50.0 + 1e-9);
  CHECK(deform.atBedrock(c));
  CHECK(lastRemoved == 0.0);   // converged: nothing left to remove (all at bedrock)
  CHECK(passes < 500);         // converged well before the guard
  // No cell anywhere exceeds the bedrock floor (clamp holds globally).
  for (const auto& kv : deform.edits()) CHECK(kv.second <= 50.0 + 1e-9);
}

// =============================================================================
// deformedHeight == base where no edits (bit-identical), == base − edit
// (clamped) where edited.
// =============================================================================
TEST(deformed_height_matches_base_then_subtracts) {
  const BodyParams forge = makeForge(99ull);
  TerrainDeform deform(60.0);

  // Bit-identical to the undeformed designed height EVERYWHERE before any edit.
  for (int i = 0; i < 64; ++i) {
    const Vec3 d = fibonacciDir(i, 64);
    CHECK(asBits(deformedHeight(forge, d, deform)) ==
          asBits(sampleDesignedHeight(forge, d)));
  }

  // Dig a hole, then the dug cell drops by exactly its edit (within bedrock).
  const Vec3 c = sampleDir();
  const double base = sampleDesignedHeight(forge, c);
  deform.digBrush(forge, c, 10.0, 5.0);
  const double dug = deform.depthDugAt(c);
  CHECK(dug > 0.0);
  CHECK_NEAR(deformedHeight(forge, c, deform), base - dug, 1e-9);

  // A neighbouring untouched dir is still bit-identical to base.
  const Vec3 untouched = latLonToDir(-0.9, 2.3);
  CHECK(asBits(deformedHeight(forge, untouched, deform)) ==
        asBits(sampleDesignedHeight(forge, untouched)));

  // The clamp: deformedHeight never goes below base − maxDigDepth.
  TerrainDeform deep(40.0);
  for (int i = 0; i < 30; ++i) deep.digBrush(forge, c, 6.0, 20.0);
  const double floorH = sampleDesignedHeight(forge, c) - 40.0;
  CHECK_NEAR(deformedHeight(forge, c, deep), floorH, 1e-9);
  CHECK(deformedHeight(forge, c, deep) >= floorH - 1e-9);
}

// =============================================================================
// drillStep deepens a narrow column over N calls and STOPS at bedrock.
// =============================================================================
TEST(drill_step_deepens_column_and_stops_at_bedrock) {
  const BodyParams forge = makeForge(555ull);
  TerrainDeform deform(30.0);   // bedrock at 30 m
  const Vec3 c = sampleDir();
  const double colR = 5.0;
  const double perStep = 2.0;

  double prevDepth = 0.0;
  bool bottomed = false;
  int steps = 0;
  for (int i = 0; i < 100; ++i) {
    const double removed = deform.drillStep(forge, c, colR, perStep);
    const double depth = deform.shaftDepthAt(c);
    if (!bottomed) {
      // While sinking, the shaft monotonically deepens.
      CHECK(depth >= prevDepth);
    }
    prevDepth = depth;
    if (removed == 0.0) { bottomed = true; steps = i; break; }
  }
  CHECK(bottomed);
  CHECK(deform.shaftBottomedOut(c));
  CHECK_NEAR(deform.shaftDepthAt(c), 30.0, 1e-9);  // pinned at bedrock
  // 30 m at 2 m/step => ~15 productive steps (well under the 100 cap).
  CHECK(steps > 10 && steps < 30);

  // The shaft is a real hole in the deformed surface.
  const double base = sampleDesignedHeight(forge, c);
  CHECK_NEAR(deformedHeight(forge, c, deform), base - 30.0, 1e-9);
}

// =============================================================================
// editedCellsInQuad returns exactly the edited cells overlapping a quad; cells in
// a DIFFERENT, far-away quad are not returned.
// =============================================================================
TEST(edited_cells_in_quad_query) {
  const BodyParams forge = makeForge(31337ull);
  TerrainDeform deform;

  // Dig at site A, then at a far site B (different cube quad).
  const Vec3 a = latLonToDir(0.10, 0.10);
  const Vec3 b = latLonToDir(-0.80, -2.50);
  deform.digBrush(forge, a, 12.0, 3.0);
  const size_t afterA = deform.editedCount();
  CHECK(afterA > 0);
  deform.digBrush(forge, b, 12.0, 3.0);
  CHECK(deform.editedCount() > afterA);

  // The quad containing site A (mid LOD) overlaps A's edits, and they are a
  // STRICT subset of all edits (B's edits are elsewhere).
  const int depth = 6;
  // Build A's quad key from its cell's lattice (reuse the cell -> face mapping).
  const DeformCell ca = cellForDir(a);
  // Map A's deep cell down to a depth-`depth` quad on the same face.
  const int shift = kDeformLevel - depth;
  FQuadKey quadA{forge.bodyId, ca.faceId, depth, ca.ix >> shift, ca.iy >> shift};

  const std::vector<uint64_t> inA = deform.editedCellsInQuad(quadA, 0.0);
  CHECK(!inA.empty());
  CHECK(inA.size() < deform.editedCount());  // does NOT include B's far edits
  CHECK(deform.quadHasEdits(quadA));

  // Every returned cell really lies in A's region (its dir within the cone) and
  // none of B's cells sneak in: each returned id's centre is near A, far from B.
  for (uint64_t id : inA) {
    const Vec3 cd = dirForCell(deformCellFromId(id));
    CHECK(cd.dot(a) > cd.dot(b));  // closer to A than to B
  }
}

// =============================================================================
// Persistence round-trip: edit -> serialize -> deserialize -> identical deformed
// heights (and identical edit map). The terraforming diff survives save/reload.
// =============================================================================
TEST(persistence_round_trip) {
  const BodyParams forge = makeForge(0xABCDEFull);
  TerrainDeform deform(75.0);

  // A few digs + a drilled shaft.
  deform.digBrush(forge, latLonToDir(0.3, 0.3), 20.0, 6.0);
  deform.digBrush(forge, latLonToDir(0.31, 0.32), 15.0, 4.0);
  for (int i = 0; i < 10; ++i)
    deform.drillStep(forge, latLonToDir(-0.2, 1.1), 4.0, 3.0);

  const size_t cells = deform.editedCount();
  CHECK(cells > 0);

  // Serialize through the persistence cursor (style/contract check).
  persist::SaveWriter w;
  deform.serialize(w);
  std::vector<uint8_t> bytes = w.take();
  CHECK(!bytes.empty());

  persist::SaveReader r(bytes);
  TerrainDeform restored;
  restored.deserialize(r);

  // Same config + same sparse footprint.
  CHECK_NEAR(restored.maxDigDepth(), 75.0, 1e-12);
  CHECK(restored.editedCount() == cells);

  // Identical deformed heights across a spread of dirs (incl. the dug ones).
  std::vector<Vec3> probes = {latLonToDir(0.3, 0.3), latLonToDir(0.31, 0.32),
                              latLonToDir(-0.2, 1.1), fibonacciDir(5, 50),
                              fibonacciDir(40, 50)};
  for (const Vec3& d : probes) {
    CHECK(asBits(deformedHeight(forge, d, deform)) ==
          asBits(deformedHeight(forge, d, restored)));
  }
  // And the raw edit maps match cell-for-cell.
  CHECK(deform.edits() == restored.edits());
}

// =============================================================================
// Determinism: the SAME op sequence yields the SAME edit map and the SAME
// deformed heights (edits are explicit ops, not procedural).
// =============================================================================
TEST(determinism_same_ops_same_state) {
  const BodyParams forge = makeForge(2024ull);

  auto play = [&](TerrainDeform& d) {
    d.digBrush(forge, latLonToDir(0.1, 0.2), 25.0, 5.0);
    d.digBrush(forge, latLonToDir(0.12, 0.18), 10.0, 7.0);
    for (int i = 0; i < 8; ++i)
      d.drillStep(forge, latLonToDir(0.5, -0.5), 3.0, 2.5);
  };

  TerrainDeform a, b;
  play(a);
  play(b);

  CHECK(a.editedCount() == b.editedCount());
  CHECK(a.edits() == b.edits());  // bit-identical sparse map

  for (int i = 0; i < 80; ++i) {
    const Vec3 dir = fibonacciDir(i, 80);
    CHECK(asBits(deformedHeight(forge, dir, a)) ==
          asBits(deformedHeight(forge, dir, b)));
  }
}
