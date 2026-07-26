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
// WG-22 adds the TERRAFORMING half: fill is representable at all, it raises the
// same one surface, dig and fill are inverses, and levelArea flattens a disc and
// only that disc.
#include <cstdint>
#include <cstring>
#include <vector>

#include "test_framework.h"
#include "of/cubed_sphere.h"
#include "of/biome.h"
#include "of/voxel_terrain.h"
#include "of/surface_field.h"
#include "of/persistence.h"  // reuse SaveWriter/SaveReader as the byte cursor

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

// =============================================================================
// WG-22 â€” TERRAFORMING. Fill is representable, it moves the ONE surface, and
// levelArea collapses the height spread inside its disc and nowhere else.
// =============================================================================
static Vec3 crossOf(const Vec3& a, const Vec3& b) {
  return Vec3(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
}

// A ring of dirs at `metresOut` tangential metres from `u`, for sampling a disc.
static void ringDirs(const BodyParams& body, const Vec3& u, double metresOut,
                     int n, std::vector<Vec3>& out) {
  const Vec3 seed = (std::fabs(u.x) < 0.9) ? Vec3(1, 0, 0) : Vec3(0, 1, 0);
  Vec3 e1 = crossOf(u, seed);
  e1 = e1 * (1.0 / e1.length());
  const Vec3 e2 = crossOf(u, e1);
  const double R = body.radiusM;
  for (int i = 0; i < n; ++i) {
    const double a = (2.0 * 3.14159265358979323846 * i) / n;
    const Vec3 p = u * R + (e1 * std::cos(a) + e2 * std::sin(a)) * metresOut;
    out.push_back(unitOf(p));
  }
}

// =============================================================================
// FILL IS REPRESENTABLE AT ALL. Before WG-22 the model was subtractive by
// construction: a removed set can only take rock away. This is the assertion the
// whole feature rests on, so it is stated on its own.
// =============================================================================
TEST(fill_makes_air_solid_and_raises_the_one_surface) {
  const BodyParams forge = makeForge(20260616ull);
  const Vec3 u = unitOf(sampleDir());
  const double surfR = forge.radiusM + baseHeight(forge, u);

  VoxelEdits edits;
  // The three cells directly above the designed surface are AIR to begin with.
  for (int k = 0; k < 3; ++k)
    CHECK(!edits.isSolid(forge, cellForPos(u * (surfR + (k + 0.5) * kVoxelSizeM))));
  CHECK_NEAR(surfaceHeight(forge, u, edits), baseHeight(forge, u), 1e-12);

  for (int k = 0; k < 3; ++k)
    CHECK(edits.fillCell(forge, cellForPos(u * (surfR + (k + 0.5) * kVoxelSizeM))));
  CHECK(edits.addedCount() == 3);

  // Solidity says solid...
  for (int k = 0; k < 3; ++k)
    CHECK(edits.isSolid(forge, cellForPos(u * (surfR + (k + 0.5) * kVoxelSizeM))));
  // ...and the SAME oracle the mesh, the walker and collision read says the
  // surface came up with it. Anything less is the five-surfaces failure.
  const double raised = surfaceHeight(forge, u, edits);
  CHECK_NEAR(raised - baseHeight(forge, u), 3.0, 1e-9);
  CHECK_NEAR(derivedRaisingAt(forge, u, edits), 3.0, 1e-9);
  CHECK_NEAR(surfaceRadius(forge, u, edits), forge.radiusM + raised, 1e-9);
  // The signed offset the chunk mesher consumes is negative when ground rose.
  CHECK_NEAR(surfaceOffsetAt(forge, u, edits), -3.0, 1e-9);

  // A cell floating with a gap under it does NOT raise the heightfield, exactly
  // as a sideways tunnel does not lower it.
  VoxelEdits floating;
  floating.fillCell(forge, cellForPos(u * (surfR + 5.5 * kVoxelSizeM)));
  CHECK(floating.addedCount() == 1);
  CHECK_NEAR(derivedRaisingAt(forge, u, floating), 0.0, 1e-12);
  CHECK(asBits(surfaceHeight(forge, u, floating)) == asBits(baseHeight(forge, u)));
}

// =============================================================================
// dig and fill are INVERSES cell for cell, and the two sets stay disjoint, so
// undoing an edit SHRINKS the save instead of growing it.
// =============================================================================
TEST(dig_and_fill_are_inverses_and_the_diff_shrinks) {
  const BodyParams forge = makeForge(20260616ull);
  const Vec3 u = unitOf(sampleDir());
  const double surfR = forge.radiusM + baseHeight(forge, u);
  const VoxelCell under = cellForPos(u * (surfR - 2.5 * kVoxelSizeM));
  const VoxelCell over  = cellForPos(u * (surfR + 0.5 * kVoxelSizeM));

  VoxelEdits e;
  CHECK(e.digCell(under));
  CHECK(e.removedCount() == 1 && e.addedCount() == 0);
  CHECK(!e.isSolid(forge, under));
  // Filling a dug cell forgets the dig rather than storing a second fact.
  CHECK(e.fillCell(forge, under));
  CHECK(e.removedCount() == 0 && e.addedCount() == 0);
  CHECK(e.isSolid(forge, under));
  CHECK(e.empty());

  CHECK(e.fillCell(forge, over));
  CHECK(e.addedCount() == 1 && e.removedCount() == 0);
  // Digging placed ground takes it back and again stores nothing.
  CHECK(e.digCell(over));
  CHECK(e.addedCount() == 0 && e.removedCount() == 0);
  CHECK(!e.isSolid(forge, over));

  // Filling rock that is already there is a no-op, not a stored fact.
  CHECK(!e.fillCell(forge, under));
  CHECK(e.empty());
}

// =============================================================================
// THE HEADLINE: levelArea collapses the height spread inside its radius, leaves
// the ground outside it untouched, and is idempotent.
// =============================================================================
TEST(level_area_flattens_the_disc_and_only_the_disc) {
  const BodyParams forge = makeForge(20260616ull);
  // A site with REAL relief. sampleDir() is a smooth spot whose 8 m disc spans
  // 0.73 m — less than one voxel — so levelling it could only prove that a 1 m
  // lattice cannot beat 1 m. This dir was found by scanning the body for the
  // steepest 8 m disc under 12 m of spread: 7.70 m across 16 m, a 26 degree
  // slope, which is a hillside a player would actually want to flatten.
  const Vec3 u = unitOf(latLonToDir(1.00, -0.90));
  const double radiusM = 8.0;

  // Sample points: rings inside the disc, and a ring well outside it.
  std::vector<Vec3> in, out;
  in.push_back(u);
  ringDirs(forge, u, radiusM * 0.4, 8, in);
  ringDirs(forge, u, radiusM * 0.8, 8, in);
  ringDirs(forge, u, radiusM * 3.0, 12, out);

  VoxelEdits edits;
  const auto spread = [&](const std::vector<Vec3>& pts) {
    double lo = 1e30, hi = -1e30;
    for (size_t i = 0; i < pts.size(); ++i) {
      const double h = surfaceHeight(forge, pts[i], edits);
      if (h < lo) lo = h;
      if (h > hi) hi = h;
    }
    return hi - lo;
  };
  const double beforeIn = spread(in);
  const double beforeOut = spread(out);
  std::vector<double> outBefore;
  for (size_t i = 0; i < out.size(); ++i)
    outBefore.push_back(surfaceHeight(forge, out[i], edits));

  // Stand at the centre; level to the height under the player's own feet.
  const double target = baseHeight(forge, u);
  const LevelResult r = levelArea(forge, edits, u * (forge.radiusM + target),
                                  radiusM, target);
  CHECK(r.scanned > 0);
  CHECK(r.cells() > 0);                       // it actually moved ground

  const double afterIn = spread(in);
  // A pad, not a suggestion. The floor is the MEDIUM, not the algorithm: a
  // Cartesian 1 m lattice cut by a plane that is not axis-aligned terminates on a
  // staircase, so a pad is flat to about one voxel and never to zero. Measured
  // 7.703 m -> 1.511 m here. The threshold is two voxels, and the collapse factor
  // is asserted as well, because "under 2 m" would also pass on ground that was
  // already under 2 m.
  CHECK(afterIn <= 2.0 * kVoxelSizeM);
  CHECK(afterIn * 3.0 < beforeIn);

  // THE NEGATIVE CONTROL. Outside the radius nothing moved AT ALL, bitwise.
  for (size_t i = 0; i < out.size(); ++i)
    CHECK(asBits(surfaceHeight(forge, out[i], edits)) == asBits(outBefore[i]));
  CHECK_NEAR(spread(out), beforeOut, 1e-12);

  // Every sampled point on the pad reads the target height, and the cell just
  // under it is SOLID while the cell just over it is AIR: the surface the mesh
  // draws and the solidity collision reads are the same answer.
  for (size_t i = 0; i < in.size(); ++i) {
    const double h = surfaceHeight(forge, in[i], edits);
    CHECK(std::fabs(h - target) <= kVoxelSizeM + 1e-9);
    // THE AGREEMENT THAT MATTERS. If these two ever disagree the player floats
    // above the pad or sinks into it, which is the five-surfaces bug returning.
    const double rr = forge.radiusM + h;
    CHECK(edits.isSolid(forge, cellForPos(in[i] * (rr - 0.5 * kVoxelSizeM))));
    CHECK(!edits.isSolid(forge, cellForPos(in[i] * (rr + 1.5 * kVoxelSizeM))));
  }

  // IDEMPOTENT: a held key must not make the pad creep.
  const size_t cellsAfter = edits.removedCount() + edits.addedCount();
  const LevelResult again = levelArea(forge, edits, u * (forge.radiusM + target),
                                      radiusM, target);
  CHECK(again.cells() == 0);
  CHECK(edits.removedCount() + edits.addedCount() == cellsAfter);
}

// =============================================================================
// Levelling is deterministic, and it survives a save/load round trip with BOTH
// sets intact â€” including a legacy stream that predates the added set.
// =============================================================================
TEST(level_is_deterministic_and_round_trips) {
  const BodyParams forge = makeForge(20260616ull);
  const Vec3 u = unitOf(latLonToDir(1.00, -0.90));   // the sloped site again
  const double target = baseHeight(forge, u) - 1.0;
  const Vec3 centre = u * (forge.radiusM + target);

  VoxelEdits a, b;
  const LevelResult ra = levelArea(forge, a, centre, 6.0, target);
  const LevelResult rb = levelArea(forge, b, centre, 6.0, target);
  CHECK(ra.dug == rb.dug && ra.filled == rb.filled);
  CHECK(a.removedCount() == b.removedCount() && a.addedCount() == b.addedCount());
  CHECK(asBits(surfaceHeight(forge, u, a)) == asBits(surfaceHeight(forge, u, b)));
  CHECK(a.addedCount() > 0);        // the pad really needed fill, not only cut

  of::persist::SaveWriter w;
  a.serialize(w);
  of::persist::SaveReader rd(w.bytes());
  VoxelEdits back;
  back.deserialize(rd);
  CHECK(back.removedCount() == a.removedCount());
  CHECK(back.addedCount() == a.addedCount());
  CHECK(asBits(surfaceHeight(forge, u, back)) == asBits(surfaceHeight(forge, u, a)));
  for (std::unordered_set<uint64_t>::const_iterator it = a.addedSet().begin();
       it != a.addedSet().end(); ++it) CHECK(back.isAdded(*it));
  for (std::unordered_set<uint64_t>::const_iterator it = a.removedSet().begin();
       it != a.removedSet().end(); ++it) CHECK(back.isRemoved(*it));

  // A PRE-WG-22 stream (bare [count][ids...], no magic) still loads, and arrives
  // with no added cells. Slots written before fill existed must not be bricked.
  of::persist::SaveWriter legacy;
  legacy.varint(2);
  legacy.varint(1234567ull);
  legacy.varint(7654321ull);
  of::persist::SaveReader lr(legacy.bytes());
  VoxelEdits old;
  old.deserialize(lr);
  CHECK(old.removedCount() == 2 && old.addedCount() == 0);
  CHECK(old.isRemoved(1234567ull) && old.isRemoved(7654321ull));
}
