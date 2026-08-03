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
#include <algorithm>
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

// =============================================================================
// WG-141 â€” the moon. Four properties, and three of them demonstrate a REACHABLE
// refusing case inside the test itself, because this lane has twice shipped a
// gate that could not fire.
// =============================================================================

// Local helpers: cubed_sphere.h has no cross product and no sphere lattice, and
// pulling deposits.h in for one function would add a dependency this suite does
// not otherwise have.
static Vec3 vcross(const Vec3& a, const Vec3& b) {
  return Vec3(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
}
static Vec3 vnorm(const Vec3& v) {
  const double l = v.length();
  return (l > 0.0) ? v * (1.0 / l) : Vec3(0, 1, 0);
}
// Fibonacci sphere lattice: even coverage without clustering at the poles.
static Vec3 sphereDir(int n, int count) {
  const double y = 1.0 - 2.0 * (static_cast<double>(n) + 0.5) / count;
  const double r = std::sqrt((y * y < 1.0) ? (1.0 - y * y) : 0.0);
  const double th = 2.39996322972865332 * n;  // golden angle
  return Vec3(std::cos(th) * r, y, std::sin(th) * r);
}
// Step `metres` along the surface from `dir`, in a tangent direction.
static Vec3 stepDir(const Vec3& dir, double radiusM, double metres) {
  const Vec3 up = (std::fabs(dir.y) < 0.9) ? Vec3(0, 1, 0) : Vec3(1, 0, 0);
  const Vec3 t = vnorm(vcross(up, dir));
  return vnorm(dir + t * (metres / radiusM));
}

// Reference crater field, parameterised on the radius span and the neighbourhood
// half-width, so a test can ask "would a WIDER neighbourhood have found more?".
// Deliberately unhoisted and written in the shipped nesting order, so it doubles
// as the bit-identity reference for the WG-141 hash hoist.
static double craterRef(uint64_t seed, const Vec3& dir, double freq, double span,
                        int halfWidth) {
  const Vec3 p = dir * freq;
  const double fx = std::floor(p.x), fy = std::floor(p.y), fz = std::floor(p.z);
  const int cx = static_cast<int>(fx), cy = static_cast<int>(fy),
            cz = static_cast<int>(fz);
  double h = 0.0;
  for (int dx = -halfWidth; dx <= halfWidth; ++dx)
    for (int dy = -halfWidth; dy <= halfWidth; ++dy)
      for (int dz = -halfWidth; dz <= halfWidth; ++dz) {
        uint64_t cell = mix64(seed ^ 0xC0FFEEull);
        cell = hashCombine(cell, static_cast<uint64_t>(static_cast<int64_t>(cx + dx)));
        cell = hashCombine(cell, static_cast<uint64_t>(static_cast<int64_t>(cy + dy)));
        cell = hashCombine(cell, static_cast<uint64_t>(static_cast<int64_t>(cz + dz)));
        if (hashToUnit(hashCombine(cell, 4)) > kCraterExistMax) continue;
        const Vec3 centre(fx + dx + hashToUnit(hashCombine(cell, 1)),
                          fy + dy + hashToUnit(hashCombine(cell, 2)),
                          fz + dz + hashToUnit(hashCombine(cell, 3)));
        const double dist = (p - centre).length();
        const double cr = kCraterRadiusMin + span * hashToUnit(hashCombine(cell, 5));
        if (dist > cr * kCraterReach) continue;
        h += craterProfile(dist / cr);
      }
  return h;
}

// The SPIKE-ERA crater field, verbatim: the 0.45 radius span AND the
// discontinuous profile that steps by 0.5 at every rim. Used only by the
// negative control below, so that "old" means what actually shipped rather than
// the old frequencies wearing the new profile.
static double craterSpike(uint64_t seed, const Vec3& dir, double freq) {
  const Vec3 p = dir * freq;
  const double fx = std::floor(p.x), fy = std::floor(p.y), fz = std::floor(p.z);
  const int cx = static_cast<int>(fx), cy = static_cast<int>(fy),
            cz = static_cast<int>(fz);
  double h = 0.0;
  for (int dz = -1; dz <= 1; ++dz)
    for (int dy = -1; dy <= 1; ++dy)
      for (int dx = -1; dx <= 1; ++dx) {
        uint64_t cell = mix64(seed ^ 0xC0FFEEull);
        cell = hashCombine(cell, static_cast<uint64_t>(static_cast<int64_t>(cx + dx)));
        cell = hashCombine(cell, static_cast<uint64_t>(static_cast<int64_t>(cy + dy)));
        cell = hashCombine(cell, static_cast<uint64_t>(static_cast<int64_t>(cz + dz)));
        const Vec3 centre(fx + dx + hashToUnit(hashCombine(cell, 1)),
                          fy + dy + hashToUnit(hashCombine(cell, 2)),
                          fz + dz + hashToUnit(hashCombine(cell, 3)));
        if (hashToUnit(hashCombine(cell, 4)) > 0.55) continue;
        const double dist = (p - centre).length();
        const double cr = 0.30 + 0.45 * hashToUnit(hashCombine(cell, 5));
        if (dist > cr * 1.6) continue;
        const double t = dist / cr;
        double prof;
        if (t < 1.0) {
          prof = -(1.0 - t * t);
        } else {
          const double rim = (t - 1.0) / 0.6;
          prof = (rim < 1.0) ? (1.0 - rim) * 0.5 : 0.0;
        }
        h += prof;
      }
  return h;
}

// The shipped 3x3x3 neighbourhood must find EVERY crater that contributes, so
// widening it to 5x5x5 must change nothing, bitwise. That is only true because
// WG-141 capped the radius so a crater's reach is at most one cell.
//
// THE REFUSING CASE IS REACHABLE AND THIS TEST PROVES IT IN THE SAME BREATH: the
// same sweep at the OLD 0.45 span (reach 1.2 cells) DOES disagree between 3x3x3
// and 5x5x5, so the property is a real constraint and not a tautology.
TEST(crater_neighbourhood_is_sufficient) {
  const BodyParams cinder = makeCinder(2026ull);
  const uint64_t s = cinder.bodySeed;
  const double freqs[4] = {9.0, 27.0, 81.0, 243.0};

  long shippedMismatch = 0, oldMismatch = 0;
  double worstOldStep = 0.0;
  const int N = 40000;
  for (int i = 0; i < N; ++i) {
    const Vec3 d = sphereDir(i, N);
    for (int k = 0; k < 4; ++k) {
      const double f = freqs[k];
      // Shipped span: a wider neighbourhood must find nothing extra.
      if (!bitEqual(craterRef(s, d, f, kCraterRadiusSpan, 1),
                    craterRef(s, d, f, kCraterRadiusSpan, 2))) {
        ++shippedMismatch;
      }
      // Old span: the negative control. This is what used to ship.
      const double o1 = craterRef(s, d, f, 0.45, 1);
      const double o2 = craterRef(s, d, f, 0.45, 2);
      if (!bitEqual(o1, o2)) {
        ++oldMismatch;
        const double step = std::fabs(o1 - o2);
        if (step > worstOldStep) worstOldStep = step;
      }
    }
  }
  std::printf("      crater neighbourhood: shipped span %.3f -> %ld misses; "
              "old span 0.450 -> %ld misses, worst clipped profile %.4f "
              "(x 2467 m = %.1f m step)\n",
              kCraterRadiusSpan, shippedMismatch, oldMismatch, worstOldStep,
              worstOldStep * 2467.0);
  CHECK(shippedMismatch == 0);   // the property
  CHECK(oldMismatch > 0);        // the property is REACHABLE, not inert
}

// The WG-141 hash hoist changed which operands are recomputed, never their
// values or their order, so it must be bit-identical to an unhoisted reference
// at the same loop nesting.
TEST(crater_hoist_is_bit_identical) {
  const BodyParams cinder = makeCinder(2026ull);
  const uint64_t s = cinder.bodySeed;
  const double freqs[4] = {9.0, 27.0, 81.0, 243.0};
  const int N = 20000;
  for (int i = 0; i < N; ++i) {
    const Vec3 d = sphereDir(i, N);
    for (int k = 0; k < 4; ++k) {
      CHECK(bitEqual(craterField(s, d, freqs[k]),
                     craterRef(s, d, freqs[k], kCraterRadiusSpan, 1)));
    }
  }
}

// The old moon stack as the negative control for the test below, with ONE
// deliberate correction: it evaluates its crater layer over a 5x5x5
// neighbourhood, which is the width the old 0.45 span actually needed.
//
// THAT CORRECTION IS THE WHOLE POINT AND IT COST ME A WRONG ANSWER FIRST. Run
// verbatim at 3x3x3, the old stack reports 22.16 m RMS over a 4 m step, which
// would say the old moon had ample content at human scale. It does not: that
// number is ENTIRELY its own discontinuity. The measured miss rate is 346 in
// 160,000 samples at a worst clipped profile of 0.1906, i.e. 0.2% of ground
// carrying a ~470 m cliff, and sqrt(0.002 * 470^2) is 21 m. The instrument was
// faithfully reporting a defect as if it were terrain. An implausible magnitude
// is an instrument bug until proven otherwise, and this one was proven.
static double oldMoonHeight(const BodyParams& body, const Vec3& dir) {
  const double M0 = fbm(body.bodySeed, dir, 3.0, 3, 41);
  const double M1 = craterSpike(body.bodySeed, dir, 9.0);
  const double M2 = fbm(body.bodySeed, dir, 90.0, 2, 53);
  // 4000 was the old declared maxReliefM; WG-141 raised it, and the control has
  // to keep the old constant or it is not the old field.
  return (M0 * 0.4 + M1 * 0.7 + M2 * 0.03) * 4000.0;
}

// THE FEATURE TEST, and getting to it took a correction I should record because
// the first version of it gave a confident wrong answer.
//
// I expected the old moon to be a PLANE underfoot, on the arithmetic that its
// finest layer had a 1.11 km wavelength. It is not, and SLOPE is the wrong
// instrument for the question. A crater wall is a continuous 24% to 48% grade at
// EVERY scale you sample it, so even a field whose only crater is 22 km across
// reports a healthy median slope over a 4 m step: measured, the old stack gives
// p50 0.554 m over 4 m, a 14% grade, against the new stack's 0.727 m. On slope
// alone the rewrite would look like a 1.3x tweak.
//
// What the old moon actually lacked was STRUCTURE, not gradient: no crater you
// could walk into, no rim you could stand on, no shape at all under a kilometre.
// The quantity that separates "tilted" from "featured" is CURVATURE, the second
// difference h(a-d) - 2h(a) + h(a+d). A straight slope of any steepness has
// none; a crater of size d has curvature of order its own depth. That is the
// measurement below, and it separates the two fields by about two orders of
// magnitude where slope separated them by 1.3x.
TEST(moon_has_features_at_human_scale) {
  const BodyParams cinder = makeCinder(2026ull);
  const double R = cinder.radiusM;
  const int N = 4000;
  const double spacings[2] = {4.0, 40.0};

  // The MEDIAN is the gate, not the mean. Curvature over a crater field is
  // heavy-tailed: the few percent of samples sitting on a rim carry enormous
  // values and would let a mean pass on a handful of features. p50 asks the
  // honest question, which is whether TYPICAL ground has shape.
  for (int k = 0; k < 2; ++k) {
    const double d = spacings[k];
    std::vector<double> cNew(N), cOld(N), sNew(N), sOld(N);
    for (int i = 0; i < N; ++i) {
      const Vec3 a = sphereDir(i, N);
      const Vec3 lo = stepDir(a, R, -d), hi = stepDir(a, R, d);
      const double n0 = sampleHeightField(cinder, lo);
      const double n1 = sampleHeightField(cinder, a);
      const double n2 = sampleHeightField(cinder, hi);
      const double o0 = oldMoonHeight(cinder, lo);
      const double o1 = oldMoonHeight(cinder, a);
      const double o2 = oldMoonHeight(cinder, hi);
      cNew[i] = std::fabs(n0 - 2.0 * n1 + n2);
      cOld[i] = std::fabs(o0 - 2.0 * o1 + o2);
      sNew[i] = std::fabs(n2 - n1);
      sOld[i] = std::fabs(o2 - o1);
    }
    std::sort(cNew.begin(), cNew.end());
    std::sort(cOld.begin(), cOld.end());
    std::sort(sNew.begin(), sNew.end());
    std::sort(sOld.begin(), sOld.end());
    // A feature of size d has curvature of order its own depth. The crater
    // ladder's amplitude law puts that near 0.045 * d, so a floor of 0.005 * d
    // is a ninth of the design target: passing it means "has shape", not "is
    // well tuned". The old stack is measured in the same loop as the control.
    const double floorM = d * 0.005;
    std::printf("      features @ %5.1f m: curvature p50 new %.4f m / old "
                "%.5f m (%.0fx), floor %.3f m | slope p50 new %.3f m / old "
                "%.3f m (%.2fx)\n",
                d, cNew[N / 2], cOld[N / 2],
                cOld[N / 2] > 0.0 ? cNew[N / 2] / cOld[N / 2] : 0.0, floorM,
                sNew[N / 2], sOld[N / 2],
                sOld[N / 2] > 0.0 ? sNew[N / 2] / sOld[N / 2] : 0.0);
    CHECK(cNew[N / 2] > floorM);   // the property
    CHECK(cOld[N / 2] < floorM);   // REACHABLE: the old stack fails it
  }
}

// Relief must stay inside the body's own declared maxReliefM, because that is
// what biome.h divides by and what the renderer is told. The WG-141 moon stack
// is written in absolute metres rather than as a fraction of maxRelief, so this
// is a real constraint on the amplitude ladder and not an identity.
TEST(moon_relief_within_declared_max) {
  const BodyParams cinder = makeCinder(2026ull);
  const int N = 200000;
  double lo = 0.0, hi = 0.0;
  for (int i = 0; i < N; ++i) {
    const double h = sampleHeightField(cinder, sphereDir(i, N));
    if (h < lo) lo = h;
    if (h > hi) hi = h;
  }
  std::printf("      moon relief over %d samples: min %.1f m, max %.1f m, "
              "declared maxRelief %.1f m\n", N, lo, hi, cinder.maxReliefM);
  CHECK(hi <= cinder.maxReliefM);
  CHECK(lo >= -cinder.maxReliefM);
  // And it must actually USE its range: a moon that never leaves a tenth of its
  // declared relief has a maxReliefM that is a fiction.
  CHECK(hi - lo > cinder.maxReliefM * 0.5);
}
