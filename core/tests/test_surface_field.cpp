// Headless tests for the SINGLE SURFACE AUTHORITY (surface_field.h, WG-21) — the
// "surface oracle" that replaces the five competing surface definitions.
// Proves:
//   - oracle BASE ≡ DESIGNED everywhere unedited, bit-identical (baseHeight ==
//     sampleDesignedHeight).
//   - VOXEL SOLIDITY is consistent with the oracle base: a cell just UNDER the
//     DESIGNED surface is solid, a cell just above is air (the old raw/designed
//     gap case — a cell between raw and designed used to be misclassified).
//   - digging a voxel COLUMN drops surfaceHeight by exactly the derived lowering.
//   - the ONE bedrock clamp is honoured from the single definition.
//   - a horizontal TUNNEL below the surface produces NO surface lowering (no top-
//     anchored open run -> the ceiling/heightfield is intact).
//   - determinism: same (body, edits) -> same surface bits.
#include <cstdint>
#include <cstring>

#include "test_framework.h"
#include "of/cubed_sphere.h"
#include "of/biome.h"
#include "of/voxel_terrain.h"
#include "of/surface_field.h"

using namespace of;
using namespace of::worldgen;

static uint64_t asBits(double d) {
  uint64_t u;
  std::memcpy(&u, &d, sizeof(u));
  return u;
}

// A direction safely on open surface (away from cube seams) for digging.
static Vec3 sampleDir() { return latLonToDir(0.20, 0.55); }

// =============================================================================
// BASE ≡ DESIGNED everywhere unedited (bit-identical). RAW is NOT the base.
// =============================================================================
TEST(oracle_base_is_designed_bit_identical) {
  const BodyParams forge = makeForge(20260616ull);
  const BodyParams cinder = makeCinder(4242ull);
  // A spread of dirs across faces / latitudes.
  for (int i = 0; i < 200; ++i) {
    const double lat = -1.4 + (2.8 * i) / 200.0;
    const double lon = -3.0 + (6.0 * ((i * 7) % 200)) / 200.0;
    const Vec3 d = latLonToDir(lat, lon);
    CHECK(asBits(baseHeight(forge, d)) == asBits(sampleDesignedHeight(forge, d)));
    CHECK(asBits(baseHeight(cinder, d)) == asBits(sampleDesignedHeight(cinder, d)));
    // surfaceHeight with no edits == baseHeight, bit-for-bit (undug path).
    VoxelEdits none;
    CHECK(asBits(surfaceHeight(forge, d, none)) == asBits(baseHeight(forge, d)));
    CHECK(asBits(surfaceHeight(forge, d)) == asBits(baseHeight(forge, d)));
  }
}

// =============================================================================
// VOXEL SOLIDITY consistent with the ORACLE (designed) base. A cell just under
// the DESIGNED surface is solid; a cell just above is air. This is the exact case
// the old RAW solidity got wrong wherever designed != raw (mountains ×1.6, etc.).
// =============================================================================
TEST(voxel_solidity_matches_designed_surface) {
  const BodyParams forge = makeForge(20260616ull);
  VoxelEdits none;
  // Sample many dirs; the designed surface radius is what solidity must key off.
  int checked = 0, gapCases = 0;
  for (int i = 0; i < 400; ++i) {
    const double lat = -1.2 + (2.4 * i) / 400.0;
    const double lon = -2.9 + (5.8 * ((i * 13) % 400)) / 400.0;
    const Vec3 d = latLonToDir(lat, lon);
    const double desR = forge.radiusM + sampleDesignedHeight(forge, d);
    const double rawR = forge.radiusM + sampleHeightField(forge, d);

    // 3 m below the DESIGNED surface -> solid; 3 m above -> air.
    const Vec3 below = d * (desR - 3.0);
    const Vec3 above = d * (desR + 3.0);
    CHECK(solidAt(forge, below, none));       // designed-based: solid under designed
    CHECK(!solidAt(forge, above, none));      // air above designed
    ++checked;

    // Where designed and raw diverge by > a few metres, a cell BETWEEN them exposes
    // the old bug: it is solid under DESIGNED but air under RAW (or vice versa).
    if (desR - rawR > 4.0) {
      // A point above raw but below designed -> must be SOLID now (designed truth).
      const Vec3 mid = d * ((rawR + desR) * 0.5);
      CHECK(solidAt(forge, mid, none));
      ++gapCases;
    } else if (rawR - desR > 4.0) {
      const Vec3 mid = d * ((rawR + desR) * 0.5);
      CHECK(!solidAt(forge, mid, none));       // above designed -> air
      ++gapCases;
    }
  }
  CHECK(checked > 0);
  CHECK(gapCases > 0);   // the raw/designed gap actually occurs (biomes reshape relief)
}

// =============================================================================
// DIG A VOXEL COLUMN -> surfaceHeight drops by exactly the derived lowering.
// =============================================================================
TEST(dig_column_lowers_surface_by_derived_amount) {
  const BodyParams forge = makeForge(20260616ull);
  const Vec3 d = sampleDir();
  const Vec3 u = unitOf(d);
  const double surfR = forge.radiusM + sampleDesignedHeight(forge, u);

  VoxelEdits edits;
  // Carve a vertical column: remove the top N one-metre cells straight down.
  const int N = 6;
  for (int k = 0; k < N; ++k) {
    const Vec3 p = u * (surfR - (k + 0.5) * kVoxelSizeM);
    edits.digCell(cellForPos(p));
  }

  const double lowering = derivedLoweringAt(forge, u, edits);
  CHECK(lowering >= (N - 1) * kVoxelSizeM);   // ~N metres opened (allow 1 m quantization)
  CHECK(lowering <= (N + 1) * kVoxelSizeM);

  const double base = baseHeight(forge, u);
  const double sh = surfaceHeight(forge, u, edits);
  CHECK_NEAR(base - sh, lowering, 1e-9);       // surface dropped by exactly the lowering
  CHECK(sh < base);
}

// =============================================================================
// THE ONE BEDROCK CLAMP: dig past maxDigDepth -> surfaceHeight bottoms at
// base − maxDigDepth and no further, from the single definition here.
// =============================================================================
TEST(bedrock_clamp_from_single_definition) {
  const BodyParams forge = makeForge(20260616ull);
  const Vec3 u = unitOf(sampleDir());
  const double maxDig = 20.0;   // a small explicit floor for the test
  const double surfR = forge.radiusM + sampleDesignedHeight(forge, u);

  VoxelEdits edits;
  // Remove WAY more cells than the clamp allows (down to 40 m).
  for (int k = 0; k < 40; ++k) {
    const Vec3 p = u * (surfR - (k + 0.5) * kVoxelSizeM);
    edits.digCell(cellForPos(p));
  }
  const double lowering = derivedLoweringAt(forge, u, edits, maxDig);
  CHECK_NEAR(lowering, maxDig, 1e-9);          // lowering capped at the clamp

  const double base = baseHeight(forge, u);
  const double sh = surfaceHeight(forge, u, edits, maxDig);
  CHECK_NEAR(sh, base - maxDig, 1e-9);         // surface bottoms exactly at bedrock
}

// =============================================================================
// TUNNEL: a horizontal removed run a few metres BELOW the surface, under solid
// ground, produces NO surface lowering (no top-anchored open column -> ceiling
// intact). The heightfield view never sees the tunnel; only the voxel layer does.
// =============================================================================
TEST(horizontal_tunnel_no_surface_lowering) {
  const BodyParams forge = makeForge(20260616ull);
  const Vec3 d = sampleDir();
  const Vec3 u = unitOf(d);
  const double surfR = forge.radiusM + sampleDesignedHeight(forge, u);

  // Horizontal tangent at the surface.
  Vec3 tangent(-u.z, 0.0, u.x);
  const double tl = tangent.length();
  tangent = Vec3(tangent.x / tl, tangent.y / tl, tangent.z / tl);

  VoxelEdits edits;
  // Carve a horizontal run 5 m below the surface (leaves ~4 m of solid ceiling).
  const Vec3 start = u * (surfR - 5.0);
  int removed = 0;
  for (int s = 0; s <= 12; ++s) {
    const Vec3 p = start + tangent * static_cast<double>(s);
    removed += edits.dig(forge, p, 1.4);
  }
  CHECK(removed > 0);

  // The column straight down from the surface hits SOLID before any removed cell,
  // so the top-anchored open run is 0 -> NO lowering. Sample a few columns across.
  int noLowering = 0, cols = 0;
  for (int s = 0; s <= 12; s += 3) {
    const Vec3 colDir = unitOf(start + tangent * static_cast<double>(s));
    const double low = derivedLoweringAt(forge, colDir, edits);
    if (low < 0.5) ++noLowering;   // effectively zero (ceiling intact)
    ++cols;
    // And the surface stays at the base there (bit-identical to undug).
    CHECK_NEAR(surfaceHeight(forge, colDir, edits), baseHeight(forge, colDir), 1e-9);
  }
  CHECK(noLowering == cols);   // EVERY column over the tunnel keeps its ceiling
}

// =============================================================================
// A dig-DOWN pit that then tunnels sideways at the bottom: the pit column DOES
// lower (top-anchored run = pit depth), but the run stops at the first solid cell,
// so the sideways branch below does not deepen the surface further.
// =============================================================================
TEST(pit_lowers_only_to_first_solid) {
  const BodyParams forge = makeForge(20260616ull);
  const Vec3 u = unitOf(sampleDir());
  const double surfR = forge.radiusM + sampleDesignedHeight(forge, u);

  VoxelEdits edits;
  // Open the top 3 cells (a shallow pit)...
  for (int k = 0; k < 3; ++k)
    edits.digCell(cellForPos(u * (surfR - (k + 0.5) * kVoxelSizeM)));
  // ...leave cell 3 SOLID (skip it)...
  // ...then remove cells 4 and 5 (an isolated pocket below the intact floor).
  edits.digCell(cellForPos(u * (surfR - 4.5 * kVoxelSizeM)));
  edits.digCell(cellForPos(u * (surfR - 5.5 * kVoxelSizeM)));

  const double lowering = derivedLoweringAt(forge, u, edits);
  // Only the top run counts: ~3 m, NOT 6 m (the pocket below the solid floor is unseen).
  CHECK(lowering >= 2.0 && lowering <= 4.0);
}

// =============================================================================
// Determinism: same (body, edits) -> same surface bits; SurfaceField view agrees
// with the free functions.
// =============================================================================
TEST(determinism_and_surfacefield_view) {
  const BodyParams forge = makeForge(20260616ull);
  const Vec3 u = unitOf(sampleDir());
  const double surfR = forge.radiusM + sampleDesignedHeight(forge, u);

  VoxelEdits a, b;
  for (int k = 0; k < 5; ++k) {
    const Vec3 p = u * (surfR - (k + 0.5) * kVoxelSizeM);
    a.digCell(cellForPos(p));
    b.digCell(cellForPos(p));
  }
  CHECK(asBits(surfaceHeight(forge, u, a)) == asBits(surfaceHeight(forge, u, b)));

  // SurfaceField binder matches the free functions.
  SurfaceField field(forge, &a);
  CHECK(asBits(field.heightAt(u)) == asBits(surfaceHeight(forge, u, a)));
  CHECK(asBits(field.baseHeightAt(u)) == asBits(baseHeight(forge, u)));
  CHECK_NEAR(field.loweringAt(u), derivedLoweringAt(forge, u, a), 1e-12);

  // A null-edits SurfaceField is the undug base everywhere.
  SurfaceField undug(forge, nullptr);
  CHECK(asBits(undug.heightAt(u)) == asBits(baseHeight(forge, u)));
  CHECK(undug.solid(cellForPos(u * (surfR - 3.0))));       // solid under designed
  CHECK(!undug.solid(cellForPos(u * (surfR + 3.0))));      // air above

  // The bound loweringFn matches derivedLoweringAt (what buildChunk consumes).
  auto fn = field.loweringFn();
  CHECK_NEAR(fn(u), derivedLoweringAt(forge, u, a), 1e-12);
}
