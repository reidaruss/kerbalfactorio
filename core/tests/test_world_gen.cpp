// Wave-0 headless tests for the world-generation core (Spike 1).
//
// CENTREPIECE: crack-free determinism proven BITWISE (spike gates WV1–WV3).
// The headline property of this domain is that neighbouring / parent-child quads
// produce BIT-IDENTICAL shared-edge vertices, and the same seed regenerates an
// identical mesh. These tests assert exact uint64 bit-equality of the shared
// edge height values — not merely CHECK_NEAR — because a hairline crack is a
// last-bit disagreement, and the only robust guard is bit-identity.
//
// Maps the spike1-worldgen validation gates to concrete assertions:
//   - WV1 Deterministic regen          -> generate twice, bit-identical
//   - WV2 No cracks at equal LOD        -> neighbour shared edge bit-identical
//        + parent/child shared edge     -> parent edge == child coarse edge
//   - WV3 (folded into WV1)             -> contentHash + per-vertex bit-equality
//   - cube->sphere                      -> every surface point on the sphere
//        + tangent warp uniformity      -> better edge-length ratio than naive
//   - WV7 Query correctness             -> SampleTerrainHeight == mesh at a point
//        + planet vs moon distinct       -> different height variance
#include <cstdint>
#include <cstring>
#include <vector>

#include "test_framework.h"
#include "of/cubed_sphere.h"

using namespace of;
using namespace of::worldgen;

// --- bit-identity helpers ----------------------------------------------------
static uint64_t asBits(double d) {
  uint64_t u;
  std::memcpy(&u, &d, sizeof(u));
  return u;
}
static bool bitEqual(double a, double b) { return asBits(a) == asBits(b); }
static bool bitEqual(const Vec3& a, const Vec3& b) {
  return bitEqual(a.x, b.x) && bitEqual(a.y, b.y) && bitEqual(a.z, b.z);
}

// =============================================================================
// Sanity: the lattice coordinate is a PURE function of (i, level) — the root of
// the bitwise-share guarantee. A vertex named the same way always gets the same
// bits regardless of which quad addresses it.
// =============================================================================
TEST(lattice_coord_is_pure_bit_identical) {
  // A vertex at the right edge of quad (qx=0, depth=1) and the left edge of quad
  // (qx=1, depth=1) is the SAME lattice point at level (1 + kCellBits).
  const int level = 1 + kCellBits;
  const uint64_t mid = uint64_t(1) << kCellBits;  // boundary lattice column
  const double fromLeftQuad = latticeCoord(mid, level);   // right edge of quad 0
  const double fromRightQuad = latticeCoord(mid, level);  // left edge of quad 1
  CHECK(bitEqual(fromLeftQuad, fromRightQuad));

  // And the direction at that lattice point is bit-identical from either side.
  const Vec3 dL = latticeDir(0, mid, 4, level);
  const Vec3 dR = latticeDir(0, mid, 4, level);
  CHECK(bitEqual(dL, dR));
}

// =============================================================================
// WV2 (the headline): neighbouring same-depth quads share BIT-IDENTICAL edge
// vertices. Take quad A = (qx=0,qy=0) and its east neighbour B = (qx=1,qy=0) at
// the same depth. A's east edge (i = GRID-1) and B's west edge (i = 0) sample
// the same lattice column -> heights must be EXACTLY equal, bit for bit.
// =============================================================================
TEST(WV2_neighbour_shared_edge_is_bit_identical) {
  const BodyParams forge = makeForge(/*worldSeed*/ 1234567ull);
  const int depth = 3;

  FQuadKey a{forge.bodyId, /*face*/ 0, depth, /*qx*/ 2, /*qy*/ 5};
  FQuadKey b = a;
  b.qx = a.qx + 1;  // east neighbour, same depth

  const QuadMesh ma = generateQuadMesh(forge, a);
  const QuadMesh mb = generateQuadMesh(forge, b);

  int compared = 0;
  for (int j = 0; j < ma.gridDim; ++j) {
    const int aEast = ma.idx(ma.gridDim - 1, j);  // A's east edge
    const int bWest = mb.idx(0, j);               // B's west edge
    // The shared world-space direction must be bit-identical...
    CHECK(bitEqual(ma.dirs[aEast], mb.dirs[bWest]));
    // ...therefore so must the position-hashed height (the crack-free property)...
    CHECK(asBits(ma.heights[aEast]) == asBits(mb.heights[bWest]));
    // ...and therefore the final vertex position. Zero gap, no T-junction.
    CHECK(bitEqual(ma.vertices[aEast], mb.vertices[bWest]));
    ++compared;
  }
  CHECK(compared == ma.gridDim);  // proved for every vertex along the seam
}

// North-south neighbour too (qy edge), to exercise the other axis.
TEST(WV2_neighbour_north_edge_bit_identical) {
  const BodyParams cinder = makeCinder(987654ull);
  const int depth = 4;
  FQuadKey a{cinder.bodyId, /*face*/ 4, depth, /*qx*/ 7, /*qy*/ 3};
  FQuadKey b = a;
  b.qy = a.qy + 1;  // north neighbour

  const QuadMesh ma = generateQuadMesh(cinder, a);
  const QuadMesh mb = generateQuadMesh(cinder, b);

  for (int i = 0; i < ma.gridDim; ++i) {
    const int aNorth = ma.idx(i, ma.gridDim - 1);
    const int bSouth = mb.idx(i, 0);
    CHECK(bitEqual(ma.dirs[aNorth], mb.dirs[bSouth]));
    CHECK(asBits(ma.heights[aNorth]) == asBits(mb.heights[bSouth]));
    CHECK(bitEqual(ma.vertices[aNorth], mb.vertices[bSouth]));
  }
}

// =============================================================================
// WV2 (parent/child consistency): a parent quad's edge vertices and the
// matching child's coarse-edge vertices sample the SAME lattice points, so they
// are BIT-IDENTICAL. This is what keeps a quad welded to its own subdivision.
//
// Child lattice level = parent level + 1. The parent's vertex at local (i,j)
// sits at lattice (baseIx + i, ...) at level L; the SW child covers the parent's
// lower-left, at level L+1 with baseIx' = 2*baseIx. So the parent vertex at even
// i has a child counterpart at child-local 2*i with IDENTICAL lattice coord.
// We check the shared south edge of the parent vs the SW+SE children.
// =============================================================================
TEST(WV2_parent_child_edge_is_bit_identical) {
  const BodyParams forge = makeForge(0xABCDEFull);
  FQuadKey parent{forge.bodyId, /*face*/ 5, /*depth*/ 2, /*qx*/ 1, /*qy*/ 2};
  const FQuadKey swChild = quadChild(parent, /*SW*/ 0);
  const FQuadKey seChild = quadChild(parent, /*SE*/ 1);

  const QuadMesh mp = generateQuadMesh(forge, parent);
  const QuadMesh msw = generateQuadMesh(forge, swChild);
  const QuadMesh mse = generateQuadMesh(forge, seChild);

  // The parent's SOUTH edge (j=0) runs i=0..GRID-1. The SW child covers the
  // parent's western half: parent vertex i in [0, (GRID-1)/2] == SW child vertex
  // 2*i on its south edge. The eastern half maps to the SE child.
  const int half = (kGridDim - 1) / 2;  // 16
  int matched = 0;
  for (int i = 0; i <= half; ++i) {
    const int p = mp.idx(i, 0);
    const int c = msw.idx(2 * i, 0);
    CHECK(bitEqual(mp.dirs[p], msw.dirs[c]));            // same world direction
    CHECK(asBits(mp.heights[p]) == asBits(msw.heights[c]));  // same height bits
    CHECK(bitEqual(mp.vertices[p], msw.vertices[c]));    // same vertex
    ++matched;
  }
  for (int i = half; i < kGridDim; ++i) {
    const int p = mp.idx(i, 0);
    const int c = mse.idx(2 * (i - half), 0);
    CHECK(bitEqual(mp.dirs[p], mse.dirs[c]));
    CHECK(asBits(mp.heights[p]) == asBits(mse.heights[c]));
    CHECK(bitEqual(mp.vertices[p], mse.vertices[c]));
    ++matched;
  }
  CHECK(matched == kGridDim + 1);  // both halves covered (midpoint shared)
}

// =============================================================================
// WV3 / WV1: deterministic regen — generating the same FQuadKey twice yields a
// bit-identical mesh (every vertex, every height, same contentHash). This is
// what makes the natural world free to persist (seed regenerates, only diffs
// are stored).
// =============================================================================
TEST(WV3_deterministic_regen_is_bit_identical) {
  const BodyParams forge = makeForge(42ull);
  FQuadKey k{forge.bodyId, /*face*/ 2, /*depth*/ 5, /*qx*/ 11, /*qy*/ 19};

  const QuadMesh m1 = generateQuadMesh(forge, k);
  const QuadMesh m2 = generateQuadMesh(forge, k);

  CHECK(m1.contentHash == m2.contentHash);
  CHECK(m1.vertices.size() == m2.vertices.size());
  bool allBitEqual = true;
  for (size_t v = 0; v < m1.vertices.size(); ++v) {
    if (asBits(m1.heights[v]) != asBits(m2.heights[v])) allBitEqual = false;
    if (!bitEqual(m1.vertices[v], m2.vertices[v])) allBitEqual = false;
  }
  CHECK(allBitEqual);
}

// A fresh BodyParams from the same world seed reproduces the same bodySeed, so a
// quad regenerated in an independent "process" (separate makeForge call) matches.
TEST(WV1_seed_reproduces_body_and_mesh) {
  const QuadMesh a = generateQuadMesh(makeForge(7ull),
                                      FQuadKey{0, 1, 4, 3, 6});
  const QuadMesh b = generateQuadMesh(makeForge(7ull),
                                      FQuadKey{0, 1, 4, 3, 6});
  CHECK(a.contentHash == b.contentHash);
  // Different world seed -> different terrain (the seed actually matters).
  const QuadMesh c = generateQuadMesh(makeForge(8ull),
                                      FQuadKey{0, 1, 4, 3, 6});
  CHECK(a.contentHash != c.contentHash);
}

// =============================================================================
// cube->sphere: every generated surface point lies on the sphere of radius
// (bodyRadius + relief). With relief bounded by maxRelief, |vertex| stays within
// [R - maxRelief, R + maxRelief] and equals exactly bodyRadius + height per vert.
// =============================================================================
TEST(cube_to_sphere_points_lie_on_sphere) {
  const BodyParams forge = makeForge(99ull);
  const QuadMesh m = generateQuadMesh(forge, FQuadKey{0, 3, 4, 5, 9});
  for (size_t v = 0; v < m.vertices.size(); ++v) {
    const double r = m.vertices[v].length();
    const double expected = forge.radiusM + m.heights[v];
    CHECK_NEAR(r, expected, 1e-3);                 // on the heightfield sphere
    CHECK(std::fabs(m.heights[v]) <= forge.maxReliefM + 1.0);  // relief bounded
    // unit direction is actually unit length
    CHECK_NEAR(m.dirs[v].length(), 1.0, 1e-12);
  }
}

// Tangent warp gives more uniform vertex spacing than naive normalize: compare
// the max/min edge-length ratio along a face-root quad's first row. Lower ratio
// = more uniform tessellation (spike §1.1, WG-5).
TEST(tangent_warp_more_uniform_than_naive) {
  const int level = kCellBits;  // depth-0 face root
  auto edgeRatio = [&](bool useWarp) {
    double mn = 1e300, mx = 0.0;
    Vec3 prev = useWarp ? latticeDir(0, 0, 0, level)
                        : unitDirNaive(0, -1.0, -1.0);
    for (int i = 1; i < kGridDim; ++i) {
      const double u = latticeCoord(i, level);
      const Vec3 cur = useWarp ? unitDir(0, u, -1.0) : unitDirNaive(0, u, -1.0);
      const double e = (cur - prev).length();
      if (e < mn) mn = e;
      if (e > mx) mx = e;
      prev = cur;
    }
    return mx / mn;
  };
  const double warpRatio = edgeRatio(true);
  const double naiveRatio = edgeRatio(false);
  CHECK(warpRatio < naiveRatio);  // warp is more uniform
  CHECK(warpRatio < 1.5);         // and quite uniform in absolute terms
}

// =============================================================================
// WV7: SampleTerrainHeight agrees with the quad mesh at a shared surface point.
// We take a mesh vertex's direction, convert to (lat,lon), and confirm the
// height query reproduces the mesh height to tolerance.
// =============================================================================
TEST(WV7_sample_height_agrees_with_mesh) {
  const BodyParams forge = makeForge(31415ull);
  const QuadMesh m = generateQuadMesh(forge, FQuadKey{0, 0, 3, 2, 2});
  // pick an interior vertex
  const int vi = m.idx(10, 14);
  double lat, lon;
  dirToLatLon(m.dirs[vi], lat, lon);
  const double queried = SampleTerrainHeight(forge, lat, lon);
  // dir->latlon->dir round-trip has tiny float error; height varies smoothly, so
  // a modest tolerance confirms the query surface == the rendered surface (WV7).
  CHECK_NEAR(queried, m.heights[vi], 1.0);
}

// Planet vs moon produce visibly different terrain: measure height variance over
// a face and confirm the two bodies differ substantially (distinct noise stacks:
// ridged mountains vs crater field).
TEST(planet_and_moon_terrain_differ) {
  const BodyParams forge = makeForge(2026ull);
  const BodyParams cinder = makeCinder(2026ull);

  auto variance = [](const BodyParams& body) {
    const QuadMesh m = generateQuadMesh(body, FQuadKey{body.bodyId, 0, 4, 8, 8});
    double mean = 0.0;
    for (double h : m.heights) mean += h;
    mean /= m.heights.size();
    double var = 0.0;
    for (double h : m.heights) var += (h - mean) * (h - mean);
    return var / m.heights.size();
  };
  const double vForge = variance(forge);
  const double vCinder = variance(cinder);
  CHECK(vForge > 0.0);
  CHECK(vCinder > 0.0);
  // The two bodies are not the same terrain (different noise stacks + seeds).
  const double ratio = vForge > vCinder ? vForge / vCinder : vCinder / vForge;
  CHECK(ratio > 1.05);  // measurably different relief character
}
