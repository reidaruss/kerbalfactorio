// Headless tests for the SIGNED DENSITY FIELD + SURFACE NETS (WG-24).
//
// The claim under test is that replacing binary 1 m occupancy with a signed
// distance sampled at lattice corners, and meshing its zero level rather than
// its cell faces, fixes three separately-reported complaints at once:
//
//   * digging leaves smooth craters instead of axis-aligned cube faces;
//   * a levelled pad is FLAT, measured as the worst height step between two
//     points 4 m apart (the DW-32 structural module), against the 0.25 m
//     perceptual threshold WG-23 defined and could not meet at 0.973 m;
//   * the surface that is DRAWN and the surface a body COLLIDES with are the
//     same zero level, so the DW-26 bound between the two shapes of "solid"
//     collapses from half a cell diagonal (0.866 m) to the interpolation error
//     of a smooth field over one cell.
//
// Every number this file prints is quoted in the report, so the tests print
// their measurements rather than only asserting them (WG-23's lesson: a spread
// is a claim about the middle of a distribution, and a surface is judged by its
// worst neighbouring pair).
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <array>
#include <algorithm>
#include <vector>

#include "test_framework.h"
#include "of/voxel_field.h"
#include "of/surface_nets.h"

using namespace of;
using namespace of::worldgen;

namespace {

// The byte cursor the serializer is templated over. Written out here rather
// than pulled from persistence.h so this suite stays leaf and cannot be broken
// by churn in a header it does not test; the shape is persistence.h's SaveWriter
// / SaveReader varint pair exactly, which is what the WASM bridge passes.
struct ByteWriter {
  std::vector<uint8_t> buf;
  void varint(uint64_t v) {
    while (v >= 0x80) { buf.push_back(uint8_t(v) | 0x80u); v >>= 7; }
    buf.push_back(uint8_t(v));
  }
};
struct ByteReader {
  const std::vector<uint8_t>& b;
  size_t i = 0;
  explicit ByteReader(const std::vector<uint8_t>& v) : b(v) {}
  uint64_t varint() {
    uint64_t v = 0;
    int s = 0;
    while (i < b.size()) {
      const uint8_t c = b[i++];
      v |= uint64_t(c & 0x7f) << s;
      if (!(c & 0x80)) break;
      s += 7;
    }
    return v;
  }
};

BodyParams forge() { return makeForge(0x0bf00d01ull); }

Vec3 dirAt(double latDeg, double lonDeg) {
  return latLonToDir(latDeg * 3.14159265358979323846 / 180.0,
                     lonDeg * 3.14159265358979323846 / 180.0);
}

// Body-frame surface point under a lat/lon, on the designed base.
Vec3 surfacePoint(const BodyParams& b, double latDeg, double lonDeg) {
  const Vec3 u = dirAt(latDeg, lonDeg);
  return u * (b.radiusM + sampleDesignedHeight(b, u));
}

// Two orthonormal tangents at a direction, so a test can step a metre sideways.
void tangents(const Vec3& u, Vec3& t1, Vec3& t2) {
  const Vec3 ref = (std::fabs(u.y) < 0.9) ? Vec3(0, 1, 0) : Vec3(1, 0, 0);
  Vec3 a(u.y * ref.z - u.z * ref.y, u.z * ref.x - u.x * ref.z,
         u.x * ref.y - u.y * ref.x);
  double l = a.length();
  t1 = Vec3(a.x / l, a.y / l, a.z / l);
  Vec3 c(u.y * t1.z - u.z * t1.y, u.z * t1.x - u.x * t1.z,
         u.x * t1.y - u.y * t1.x);
  l = c.length();
  t2 = Vec3(c.x / l, c.y / l, c.z / l);
}

uint64_t bits(double d) {
  uint64_t u = 0;
  std::memcpy(&u, &d, sizeof(u));
  return u;
}

}  // namespace

// -----------------------------------------------------------------------------
// 1. The untouched world is unchanged. The field is a re-reading of the SAME
//    designed surface, so an empty field must agree with the oracle exactly.
// -----------------------------------------------------------------------------
TEST(empty_field_is_the_designed_surface_bit_identically) {
  const BodyParams b = forge();
  DensityField f;
  CHECK(f.empty());
  int n = 0;
  for (int i = 0; i < 40; ++i) {
    const Vec3 u = dirAt(-70.0 + i * 3.5, -170.0 + i * 8.0);
    const double h = columnSurfaceHeight(b, f, u, 80.0, 24.0);
    CHECK(bits(h) == bits(sampleDesignedHeight(b, u)));
    ++n;
  }
  CHECK(n == 40);
  // And the field's sign at a point matches "is this inside the planet".
  const Vec3 u = dirAt(2.0, 144.0);
  const double surfR = b.radiusM + sampleDesignedHeight(b, u);
  CHECK(f.densityAt(b, u * (surfR - 5.0)) > 0.0);   // 5 m under: rock
  CHECK(f.densityAt(b, u * (surfR + 5.0)) < 0.0);   // 5 m over: air
}

// -----------------------------------------------------------------------------
// 2. THE DW-26 RE-DERIVATION. Two shapes of "solid" still exist and must still
//    have a stated, asserted bound. On a binary lattice the bound was half a
//    cell diagonal, 0.866 m, because a cell is entirely solid or entirely air
//    and its worst corner is that far from its centre. On the field the
//    quantised shape is `solidCell` (the field at the cell CENTRE) and the
//    continuous shape is `solidAt` (the field at the POINT). They can only
//    disagree where a point and its cell centre straddle the zero level, and
//    because the field is 1-Lipschitz the disagreement is bounded by the
//    distance between them, which is at most half a cell diagonal.
//
//    The number that actually changed is the one below it: how far the DRAWN
//    surface is from the COLLIDED surface. On the old model that was the same
//    0.866 m, because the mesher drew whole cell faces. Here the mesher emits
//    the zero level itself, so it is the field's own interpolation error.
// -----------------------------------------------------------------------------
TEST(dw26_bound_between_the_two_shapes_of_solid) {
  const BodyParams b = forge();
  DensityField f;
  const double halfDiag = 0.5 * std::sqrt(3.0) * kVoxelSizeM;

  int disagree = 0, sampled = 0;
  double worstOffset = 0.0;
  for (int i = 0; i < 900; ++i) {
    const Vec3 u = dirAt(-60.0 + (i % 30) * 4.0, -170.0 + (i / 30) * 11.0);
    const double surfR = b.radiusM + sampleDesignedHeight(b, u);
    for (int k = -2; k <= 2; ++k) {
      const Vec3 p = u * (surfR + k * 0.4);
      const VoxelCell c = cellForPos(p);
      ++sampled;
      if (f.solidAt(b, p) != f.solidCell(b, c)) {
        ++disagree;
        // Where they disagree, the point is within half a cell diagonal of the
        // centre BY CONSTRUCTION, and the field is 1-Lipschitz, so the density
        // magnitude at the point bounds how deep the disagreement can be.
        const double off = std::fabs(f.densityAt(b, p));
        if (off > worstOffset) worstOffset = off;
      }
    }
  }
  std::printf("    DW-26 cell-vs-point: %d of %d samples disagree, worst |d| "
              "%.4f m, bound %.4f m\n",
              disagree, sampled, worstOffset, halfDiag);
  CHECK(worstOffset <= halfDiag);

  // THE BOUND THAT MATTERS: drawn versus collided. Every vertex the mesher
  // emits must lie ON the zero level of the field that collision reads.
  DensityField g;
  const Vec3 site = surfacePoint(b, 2.0, 144.0);
  g.digSphere(b, site, 3.0);
  SurfaceNetsOpts o;
  o.editedOnly = false;
  const SurfaceNetsMesh m = surfaceNetsAround(b, g, site, 8.0, o);
  CHECK(m.positions.size() > 200);
  double worstVert = 0.0;
  for (const Vec3& v : m.positions) {
    const double e = std::fabs(g.densityAt(b, v));
    if (e > worstVert) worstVert = e;
  }
  std::printf("    DW-26 drawn-vs-collided: %zu vertices, worst |density| at a "
              "drawn vertex %.6f m (old model: %.4f m, a whole cell face)\n",
              m.positions.size(), worstVert, halfDiag);
  // Surface nets places a vertex at the MEAN of its cell's edge crossings, so
  // on a curved surface it sits slightly off the exact zero level. A quarter of
  // a cell is a generous, checkable bound and is 7x tighter than the shell was.
  CHECK(worstVert <= 0.25 * kVoxelSizeM);
}

// -----------------------------------------------------------------------------
// 3. A DIG LEAVES A SPHERE, not a staircase. The complaint was "all these sharp
//    edges". The test: after carving a sphere, points on that sphere's surface
//    sit on the field's zero level, and the extracted mesh has smoothly varying
//    normals rather than six discrete ones.
// -----------------------------------------------------------------------------
TEST(a_dig_leaves_a_round_crater_not_cube_faces) {
  const BodyParams b = forge();
  DensityField f;
  const Vec3 site = surfacePoint(b, 2.0, 144.0);
  const double R = 2.5;
  const int flipped = f.digSphere(b, site, R);
  CHECK(flipped > 20);

  // The carved boundary is the sphere: sample it and read the field.
  double worst = 0.0;
  for (int i = 0; i < 200; ++i) {
    const double a = i * 0.31, e = std::sin(i * 0.17);
    Vec3 dirv(std::cos(a) * std::sqrt(1 - e * e), e,
              std::sin(a) * std::sqrt(1 - e * e));
    const Vec3 p(site.x + dirv.x * R, site.y + dirv.y * R, site.z + dirv.z * R);
    // Only where the crater wall is genuinely the carved sphere (i.e. the
    // point was inside rock before the dig) does the sphere define the surface.
    DensityField pristine;
    if (pristine.densityAt(b, p) < 0.5) continue;
    const double d = f.densityAt(b, p);
    if (std::fabs(d) > worst) worst = std::fabs(d);
  }
  std::printf("    crater wall: worst |density| on the carved sphere %.4f m\n",
              worst);
  CHECK(worst < 0.30);

  // Normals: a cube mesher emits exactly 6 distinct normals. Count distinct
  // normals to 2 decimal places over the crater mesh.
  SurfaceNetsOpts o;
  o.editedOnly = false;
  const SurfaceNetsMesh m = surfaceNetsAround(b, f, site, 6.0, o);
  std::vector<uint64_t> keys;
  for (const Vec3& n : m.normals) {
    const int64_t a = static_cast<int64_t>(std::floor(n.x * 50.0));
    const int64_t c = static_cast<int64_t>(std::floor(n.y * 50.0));
    const int64_t e = static_cast<int64_t>(std::floor(n.z * 50.0));
    keys.push_back(static_cast<uint64_t>((a + 200) * 160000 + (c + 200) * 400 +
                                         (e + 200)));
  }
  std::sort(keys.begin(), keys.end());
  keys.erase(std::unique(keys.begin(), keys.end()), keys.end());
  std::printf("    crater mesh: %zu vertices, %zu distinct normals "
              "(a cube mesher emits exactly 6)\n",
              m.normals.size(), keys.size());
  CHECK(keys.size() > 50);
  CHECK(m.indices.size() % 3 == 0);
}

// -----------------------------------------------------------------------------
// 3b. THE WINDING. WG-28, and it is here because of what the suite around it
// could not see.
//
// Every triangle the mesher emitted was wound INSIDE OUT. Not some of them, not
// on one shape: 258 of 258 on a dug crater and 259 of 260 on a placed mound.
// The client draws this mesh through a `MeshLambertMaterial` with no `side`
// override, so three.js back-face-culls it, and an inverted mesh does not
// disappear (which anyone would have noticed) but draws the FAR side of the
// surface through the near side. That is what the disconnected pale fragments
// inside a carved crater were.
//
// It survived 143 green checks because winding is invisible to every question
// the suite asked. Triangle counts, watertightness, vertex positions, the
// gradient normals, the crater's roundness, determinism and the brick tiling
// are all winding-blind, and the tiling test SORTS each index triple before
// comparing, which erases the ordering deliberately. This is standing rule 11's
// exact shape: a check that passes because it never examined the thing it
// claims to cover.
//
// So the property is asserted TWO independent ways, because a cross-product
// convention is precisely the kind of thing to get backwards twice and agree
// with yourself:
//
//   A. AGAINST THE FIELD. Step off each triangle's centroid along its geometric
//      normal (B-A)x(C-A). Outward means AIR ahead and ROCK behind, asked of
//      `solidAt`, which is the same authority the collider uses. This test knows
//      nothing about `out.normals`.
//   B. AGAINST THE MESHER'S OWN NORMALS. Dot the geometric normal against the
//      per-vertex gradient normal the same call wrote. These must agree, and if
//      they ever disagree the mesh is lit as one surface and drawn as its
//      opposite.
//
// Test A is the load-bearing one: B alone would pass if both were flipped.
// -----------------------------------------------------------------------------
TEST(mesh_triangles_face_out_of_the_rock) {
  const BodyParams b = forge();
  const Vec3 site = surfacePoint(b, 2.0, 144.0);
  const double up[3] = {site.x, site.y, site.z};
  const double ul = std::sqrt(up[0] * up[0] + up[1] * up[1] + up[2] * up[2]);

  struct Shape { const char* name; int kind; };
  const Shape shapes[3] = {{"dug crater", 0}, {"placed mound", 1},
                           {"levelled pad", 2}};
  long long totalOut = 0, totalIn = 0, totalAgree = 0, totalDisagree = 0;
  for (const Shape& s : shapes) {
    DensityField f;
    double regionR = 6.0;
    if (s.kind == 0) {
      f.digSphere(b, site, 2.5);
    } else if (s.kind == 1) {
      f.fillSphere(b, Vec3(site.x + up[0] / ul * 1.5, site.y + up[1] / ul * 1.5,
                           site.z + up[2] / ul * 1.5), 2.0);
    } else {
      // Level to 1.5 m BELOW the ground so the pad is a real cut with walls,
      // not a plane that happens to coincide with the surface it replaced.
      const Vec3 u(up[0] / ul, up[1] / ul, up[2] / ul);
      levelDisc(b, f, site, 6.0, sampleDesignedHeight(b, u) - 1.5, 12.0, 12.0);
      regionR = 9.0;
    }
    SurfaceNetsOpts o;
    o.editedOnly = false;
    const SurfaceNetsMesh m = surfaceNetsAround(b, f, site, regionR, o);
    CHECK(m.indices.size() >= 3);

    // The step has to clear the field's own interpolation error over one cell,
    // measured at 0.087 m, and stay well inside one cell so a neighbouring
    // feature cannot answer instead. A third of a cell does both.
    const double step = 0.35;
    long long outward = 0, inward = 0, flat = 0, agree = 0, disagree = 0;
    for (size_t i = 0; i + 2 < m.indices.size(); i += 3) {
      const Vec3& A = m.positions[m.indices[i]];
      const Vec3& B = m.positions[m.indices[i + 1]];
      const Vec3& C = m.positions[m.indices[i + 2]];
      const double e1[3] = {B.x - A.x, B.y - A.y, B.z - A.z};
      const double e2[3] = {C.x - A.x, C.y - A.y, C.z - A.z};
      double g[3] = {e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2],
                     e1[0] * e2[1] - e1[1] * e2[0]};
      const double gl = std::sqrt(g[0] * g[0] + g[1] * g[1] + g[2] * g[2]);
      if (gl <= 1e-15) { ++flat; continue; }   // a degenerate sliver: no opinion
      g[0] /= gl; g[1] /= gl; g[2] /= gl;
      const Vec3 cen((A.x + B.x + C.x) / 3.0, (A.y + B.y + C.y) / 3.0,
                     (A.z + B.z + C.z) / 3.0);
      const bool ahead = f.solidAt(b, Vec3(cen.x + g[0] * step, cen.y + g[1] * step,
                                           cen.z + g[2] * step));
      const bool behind = f.solidAt(b, Vec3(cen.x - g[0] * step, cen.y - g[1] * step,
                                            cen.z - g[2] * step));
      if (!ahead && behind) ++outward;
      else if (ahead && !behind) ++inward;
      else ++flat;                              // a thin wall: both sides air
      const Vec3& vn = m.normals[m.indices[i]];
      if (g[0] * vn.x + g[1] * vn.y + g[2] * vn.z >= 0.0) ++agree; else ++disagree;
    }
    const long long decided = outward + inward;
    std::printf("    %-13s %5zu triangles: %lld face OUT of the rock, %lld face IN, "
                "%lld undecided; %lld agree with the vertex normal, %lld disagree\n",
                s.name, m.indices.size() / 3, outward, inward, flat, agree, disagree);
    // A. NOT ONE triangle may face into the rock. This is the assertion that
    // fails on the pre-WG-28 mesher, on every shape, on every triangle.
    CHECK(inward == 0);
    CHECK(decided > 20);                       // the shape was actually meshed
    // B. and the lighting must agree with the geometry.
    CHECK(disagree == 0);
    totalOut += outward; totalIn += inward;
    totalAgree += agree; totalDisagree += disagree;
  }
  std::printf("    winding, all shapes: %lld out, %lld in; %lld agree, %lld disagree\n",
              totalOut, totalIn, totalAgree, totalDisagree);
  CHECK(totalIn == 0);
  CHECK(totalDisagree == 0);
  CHECK(totalOut > 100);
}

// -----------------------------------------------------------------------------
// 4. THE HEADLINE. A levelled pad is FLAT, measured the way WG-23 defined it:
//    the worst height difference between two points 4 m apart, which is the span
//    a DW-32 foundation module bridges. WG-23 measured 0.973 m on the drawn
//    geometry after its repair, against a 0.25 m threshold it could not meet
//    because a 1 m Cartesian lattice cut by a non-axis-aligned plane terminates
//    on a staircase. This test measures the same quantity on the same kind of
//    site and asserts the threshold.
// -----------------------------------------------------------------------------
TEST(a_levelled_pad_is_flat_over_a_four_metre_span) {
  const BodyParams b = forge();

  // Find a genuinely sloped site: a levelling tool cannot be proven on flat
  // ground (ARCHITECTURE 15.2 item 99).
  //
  // The site must be a genuine SLOPE, not a cliff: `sampleDesignedHeight` is
  // DISCONTINUOUS at a coastline, because the Ocean branch of the biome design
  // returns a carved basin while its neighbour returns shaped relief, so an
  // unconstrained search for "the largest spread" finds a 1.4 km step across
  // 12 m and measures the coast rather than the tool. Bound the spread to a
  // range a levelling tool is actually for.
  double bestSpread = 0.0;
  Vec3 bestDir = dirAt(2.0, 144.0);
  for (int i = 0; i < 400; ++i) {
    const Vec3 u = dirAt(-50.0 + (i % 20) * 5.0, -170.0 + (i / 20) * 17.0);
    Vec3 t1, t2;
    tangents(u, t1, t2);
    double lo = 1e30, hi = -1e30;
    for (int a = -1; a <= 1; ++a)
      for (int c = -1; c <= 1; ++c) {
        const Vec3 p = u * (b.radiusM) + t1 * (a * 6.0) + t2 * (c * 6.0);
        const double h = sampleDesignedHeight(b, unitOf(p));
        if (h < lo) lo = h;
        if (h > hi) hi = h;
      }
    // Bounded ABOVE as well as maximised: a 12 m patch spreading more than 8 m
    // is steeper than 34 degrees, and past the tool's own 24 m cut reach the op
    // deliberately leaves rock standing, so a steeper site measures the bound
    // rather than the flatness. Bounded BELOW because a levelling tool cannot be
    // proven on flat ground (ARCHITECTURE 15.2 item 99).
    const double sp = hi - lo;
    if (sp > 8.0) continue;
    if (sp > bestSpread) { bestSpread = sp; bestDir = u; }
  }
  const Vec3 u = bestDir;
  const double baseH = sampleDesignedHeight(b, u);
  const Vec3 centre = u * (b.radiusM + baseH);
  Vec3 t1, t2;
  tangents(u, t1, t2);

  // The measurement, shared by the before and after passes: over a grid inside
  // the pad, the worst height difference between neighbours 4 m apart.
  const double padR = 10.0;
  const auto worstStep4m = [&](const DensityField& f) {
    double worst = 0.0;
    const int N = 11;                      // 11 x 11 samples, 2 m apart
    std::vector<double> h(N * N, 0.0);
    for (int j = 0; j < N; ++j)
      for (int i = 0; i < N; ++i) {
        const double x = (i - (N - 1) * 0.5) * 2.0;
        const double y = (j - (N - 1) * 0.5) * 2.0;
        const Vec3 p = centre + t1 * x + t2 * y;
        h[j * N + i] = columnSurfaceHeight(b, f, unitOf(p), 80.0, 24.0);
      }
    for (int j = 0; j < N; ++j)
      for (int i = 0; i < N; ++i) {
        const double x = (i - (N - 1) * 0.5) * 2.0;
        const double y = (j - (N - 1) * 0.5) * 2.0;
        if (x * x + y * y > (padR - 2.0) * (padR - 2.0)) continue;
        if (i + 2 < N) {
          const double xb = (i + 2 - (N - 1) * 0.5) * 2.0;
          if (xb * xb + y * y <= (padR - 2.0) * (padR - 2.0))
            worst = std::max(worst, std::fabs(h[j * N + i] - h[j * N + i + 2]));
        }
        if (j + 2 < N) {
          const double yb = (j + 2 - (N - 1) * 0.5) * 2.0;
          if (x * x + yb * yb <= (padR - 2.0) * (padR - 2.0))
            worst = std::max(worst,
                             std::fabs(h[j * N + i] - h[(j + 2) * N + i]));
        }
      }
    return worst;
  };

  DensityField before;
  const double b4 = worstStep4m(before);

  DensityField f;
  const LevelDiscResult r = levelDisc(b, f, centre, padR, baseH, 24.0, 24.0);
  const double a4 = worstStep4m(f);

  // Which columns did not reach the target, and by how much. A spread is a claim
  // about the middle of a distribution; the tool is judged by its worst column.
  {
    int off = 0, tot = 0;
    double worst = 0.0, worstX = 0, worstY = 0;
    for (int j = 0; j < 11; ++j)
      for (int i = 0; i < 11; ++i) {
        const double x = (i - 5) * 2.0, y = (j - 5) * 2.0;
        if (x * x + y * y > 8.0 * 8.0) continue;
        ++tot;
        const Vec3 p = centre + t1 * x + t2 * y;
        const double e =
            std::fabs(columnSurfaceHeight(b, f, unitOf(p), 80.0, 24.0) - baseH);
        if (e > 0.25) ++off;
        if (e > worst) { worst = e; worstX = x; worstY = y; }
      }
    std::printf("    columns off target: %d of %d, worst %.4f m at (%.0f, %.0f) "
                "m from the pad centre\n", off, tot, worst, worstX, worstY);
  }
  std::printf("    LEVELLING, site spread %.3f m over 12 m:\n", bestSpread);
  std::printf("      worst step over a 4 m span, BEFORE %.4f m, AFTER %.4f m "
              "(WG-23 threshold 0.25 m; WG-23 achieved 0.973 m)\n", b4, a4);
  std::printf("      op: %d corners written, %d cells cut, %d filled, %d "
              "corners scanned\n", r.corners, r.dug, r.filled, r.scanned);
  CHECK(a4 <= 0.25);
  CHECK(a4 < b4);

  // IDEMPOTENT: a held key must not make the pad creep.
  const size_t nOv = f.overrideCount();
  const LevelDiscResult r2 = levelDisc(b, f, centre, padR, baseH, 24.0, 24.0);
  CHECK(f.overrideCount() == nOv);
  CHECK(r2.cells() == 0);
  CHECK_NEAR(worstStep4m(f), a4, 1e-12);

  // Outside the disc, untouched to the bit.
  for (int i = 0; i < 12; ++i) {
    const double a = i * 0.52;
    const Vec3 p = centre + t1 * (std::cos(a) * 30.0) + t2 * (std::sin(a) * 30.0);
    const Vec3 uu = unitOf(p);
    CHECK(bits(columnSurfaceHeight(b, f, uu, 80.0, 24.0)) ==
          bits(sampleDesignedHeight(b, uu)));
  }
}

// -----------------------------------------------------------------------------
// 5. The DRAWN pad is flat too. Item 123's lesson: the oracle and the picture
//    are different instruments, and the one the player sees is the mesh.
// -----------------------------------------------------------------------------
TEST(the_drawn_pad_is_flat_over_a_four_metre_span) {
  const BodyParams b = forge();
  const Vec3 u = dirAt(2.0, 144.0);
  const double baseH = sampleDesignedHeight(b, u);
  const Vec3 centre = u * (b.radiusM + baseH);
  DensityField f;
  levelDisc(b, f, centre, 10.0, baseH, 24.0, 24.0);

  SurfaceNetsOpts o;
  o.editedOnly = false;
  const SurfaceNetsMesh m = surfaceNetsAround(b, f, centre, 12.0, o);
  CHECK(m.positions.size() > 100);

  // Every DRAWN vertex that lies over the pad, projected to a height. The pad's
  // target is one radius, so the spread of |v| over the pad is the flatness of
  // the picture, in metres, with no interpretation in between.
  const double targetR = centre.length();
  double lo = 1e30, hi = -1e30, worstAbs = 0.0;
  int n = 0, off = 0;
  for (const Vec3& v : m.positions) {
    const Vec3 d = v - centre;
    const double axial = d.x * u.x + d.y * u.y + d.z * u.z;
    const double perp2 = d.lengthSq() - axial * axial;
    if (perp2 > 7.0 * 7.0) continue;             // well inside the rim
    const double r = v.length();
    // A vertex more than a couple of cells off the target is not ON the pad: it
    // is the crater-wall or lip geometry the op deliberately left standing. Count
    // them separately rather than folding them into the flatness claim.
    if (std::fabs(r - targetR) > 2.0) { ++off; continue; }
    if (r < lo) lo = r;
    if (r > hi) hi = r;
    if (std::fabs(r - targetR) > worstAbs) worstAbs = std::fabs(r - targetR);
    ++n;
  }
  std::printf("    DRAWN pad: %d vertices inside 7 m on the pad (%d off it), "
              "radial spread %.6f m, worst departure from the target plane "
              "%.6f m\n", n, off, hi - lo, worstAbs);
  CHECK(n > 40);
  CHECK(hi - lo <= 0.25);
}

// -----------------------------------------------------------------------------
// 5b. WG-28. The two bookkeeping defects an adversarial review found in this
//     header, both of the shape standing rule 11 names: a number that reports
//     success on something it never examined.
//
//     (a) THE MEMO KEY. `fieldWorldSig` decides when the procedural memo is
//         stale. It listed seven BodyParams fields and world generation reads
//         nine: `kind` dispatches the entire height stack and `homeBlendRadiusM`
//         sets the start pad's blend width. One field warmed on one body then
//         answered for another, silently, and the comment above the hash already
//         said in words that this must never happen.
//
//     (b) THE AIR/ROCK SPLIT. `setCorner` incremented `airCount_` on insert and
//         left it alone on overwrite, so the split drifted as soon as a second
//         op touched a corner the first had written. The client compares these
//         two numbers against the worker's to detect that the two copies of the
//         edit set have diverged, so a counter that lies disarms a detector.
//
//     The round-trip test that should have caught (b) applies exactly ONE op,
//     which is the only case where the bug is invisible. This one applies two.
// -----------------------------------------------------------------------------
TEST(the_memo_key_and_the_air_rock_split_cannot_lie) {
  // (a) two bodies that differ in ONE field each must not share a memo.
  const BodyParams base = forge();
  {
    BodyParams other = base;
    other.homeBlendRadiusM = base.homeBlendRadiusM * 0.5;
    CHECK(DensityField::fieldWorldSig(base) != DensityField::fieldWorldSig(other));

    BodyParams moon = base;
    moon.kind = (base.kind == kPlanet) ? kMoon : kPlanet;
    CHECK(DensityField::fieldWorldSig(base) != DensityField::fieldWorldSig(moon));

    // And the memo must actually FOLLOW it: warm on one body, ask the other,
    // and get that other body's own answer rather than the cached one.
    DensityField f;
    const Vec3 u = dirAt(2.0, 144.0);
    // A direction inside the blend annulus, where the two bodies disagree.
    Vec3 t1, t2;
    tangents(u, t1, t2);
    const double armM = 0.5 * (base.homeFlatRadiusM + base.homeBlendRadiusM);
    const Vec3 q = unitOf(u * base.radiusM + t1 * armM);
    const VoxelCell c = cornerForPos(q * (base.radiusM
                                          + sampleDesignedHeight(base, q)));
    const double warm = f.cornerDensity(base, c);
    const double crossed = f.cornerDensity(other, c);
    DensityField clean;
    const double truth = clean.cornerDensity(other, c);
    std::printf("    memo key: warmed on the shipped body %.6f m, then asked a "
                "body with half the blend radius %.6f m against its own truth "
                "%.6f m (error %.6f m)\n",
                warm, crossed, truth, std::fabs(crossed - truth));
    CHECK_NEAR(crossed, truth, 1e-9);
  }

  // (b) the air/rock split survives a SECOND op over the same corners.
  //
  // The truth comes from a round trip, because `deserialize` recomputes the
  // split from the signs it actually reads rather than carrying the live
  // counter across. Two ops rather than one is the whole point: the shipped
  // round-trip assertion in test_surface_field.cpp does exactly this comparison
  // and passes, because its fixture applies a single op and a single op is the
  // one case where an insert-only counter is right.
  {
    DensityField f;
    const Vec3 site = surfacePoint(base, 2.0, 144.0);
    f.digSphere(base, site, 2.5);
    f.fillSphere(base, site, 3.2);              // overwrites many of the same corners
    ByteWriter w;
    f.serialize(w);
    ByteReader rd(w.buf);
    DensityField back;
    CHECK(back.deserialize(rd));
    std::printf("    air/rock after dig-then-fill: live %zu air / %zu rock, "
                "recomputed %zu / %zu over %zu overrides\n",
                f.airCount(), f.rockCount(), back.airCount(), back.rockCount(),
                f.overrideCount());
    CHECK(f.overrideCount() > 100);             // the ops really did overlap
    CHECK(back.overrideCount() == f.overrideCount());
    CHECK(f.airCount() == back.airCount());
    CHECK(f.rockCount() == back.rockCount());
  }
}

// -----------------------------------------------------------------------------
// 6. A sideways tunnel still lowers nothing. The property WG-21 built
//    derivedLoweringAt for survives the model change, and now falls out of the
//    root find rather than needing a contiguous-run rule.
// -----------------------------------------------------------------------------
TEST(a_sideways_tunnel_does_not_move_the_heightfield) {
  const BodyParams b = forge();
  const Vec3 u = dirAt(2.0, 144.0);
  const double baseH = sampleDesignedHeight(b, u);
  Vec3 t1, t2;
  tangents(u, t1, t2);
  DensityField f;
  // Bore horizontally 8 m below the surface.
  for (int i = 0; i < 12; ++i) {
    const Vec3 p = u * (b.radiusM + baseH - 8.0) + t1 * (i * 1.0);
    f.digSphere(b, p, 1.5);
  }
  CHECK(!f.empty());
  int unmoved = 0, tested = 0;
  double worst = 0.0;
  for (int i = 0; i < 10; ++i) {
    const Vec3 p = u * (b.radiusM + baseH) + t1 * (i * 1.0);
    const Vec3 uu = unitOf(p);
    ++tested;
    const double h = columnSurfaceHeight(b, f, uu, 80.0, 24.0);
    const double e = std::fabs(h - sampleDesignedHeight(b, uu));
    if (e > worst) worst = e;
    if (e < 0.10) ++unmoved;
    // and the rock above the bore is still solid
    CHECK(f.solidAt(b, uu * (b.radiusM + sampleDesignedHeight(b, uu) - 2.0)));
  }
  // The residual is NOT the tunnel: it is the difference between the exact
  // designed height and the TRILINEAR field's zero level, which a column over an
  // edit reads and an untouched column does not. It is the honest price of the
  // model and it replaces a 0.87 m shell, so it is reported rather than hidden.
  std::printf("    tunnel: %d of %d surface columns unmoved above an 8 m-deep "
              "12 m bore; worst residual %.4f m (interpolation, not lowering)\n",
              unmoved, tested, worst);
  CHECK(unmoved == tested);
  CHECK(worst < 0.10);
}

// -----------------------------------------------------------------------------
// 7. A pit DOES lower the surface, and by the amount dug.
// -----------------------------------------------------------------------------
TEST(a_pit_lowers_the_surface_by_what_was_dug) {
  const BodyParams b = forge();
  const Vec3 u = dirAt(2.0, 144.0);
  const double baseH = sampleDesignedHeight(b, u);
  DensityField f;
  for (int i = 0; i < 6; ++i)
    f.digSphere(b, u * (b.radiusM + baseH - i * 1.5), 2.0);
  const double h = columnSurfaceHeight(b, f, u, 80.0, 24.0);
  const double drop = baseH - h;
  std::printf("    pit: surface dropped %.3f m after six 2 m spheres down a "
              "column\n", drop);
  CHECK(drop > 6.0);
  CHECK(drop < 12.0);
  // The bedrock clamp still exists and is still the only one.
  DensityField deep;
  for (int i = 0; i < 120; ++i)
    deep.digSphere(b, u * (b.radiusM + baseH - i * 1.0), 1.6);
  const double hd = columnSurfaceHeight(b, deep, u, 80.0, 24.0);
  CHECK(hd >= baseH - 80.0 - 1e-9);
}

// -----------------------------------------------------------------------------
// 8. Determinism and persistence. Standing rule 4.
// -----------------------------------------------------------------------------
TEST(field_is_deterministic_and_round_trips) {
  const BodyParams b = forge();
  const Vec3 u = dirAt(2.0, 144.0);
  const double baseH = sampleDesignedHeight(b, u);
  const Vec3 centre = u * (b.radiusM + baseH);

  const auto build = [&](DensityField& f) {
    f.digSphere(b, centre, 2.0);
    f.fillSphere(b, centre + Vec3(0, 0, 4.0), 1.5);
    levelDisc(b, f, centre, 6.0, baseH - 1.0, 12.0, 12.0);
  };
  DensityField a, c;
  build(a);
  build(c);
  CHECK(a.overrideCount() == c.overrideCount());

  ByteWriter wa, wc;
  a.serialize(wa);
  c.serialize(wc);
  CHECK(wa.buf.size() == wc.buf.size());
  CHECK(wa.buf == wc.buf);
  std::printf("    determinism: %zu overrides, %zu save bytes, identical "
              "across two builds\n", a.overrideCount(), wa.buf.size());

  ByteReader r(wa.buf);
  DensityField back;
  CHECK(back.deserialize(r));
  CHECK(back.overrideCount() == a.overrideCount());
  for (int i = 0; i < 40; ++i) {
    const Vec3 p = centre + Vec3(i % 7 - 3, (i / 7) % 7 - 3, i % 5 - 2);
    CHECK(bits(back.densityAt(b, p)) == bits(a.densityAt(b, p)));
  }
  // A stream that is not a density field is refused rather than misread.
  ByteWriter junk;
  junk.varint(7);
  ByteReader jr(junk.buf);
  DensityField nope;
  CHECK(!nope.deserialize(jr));
}

// -----------------------------------------------------------------------------
// 9. The mesher's edit filter, and per-region seam consistency: two adjacent
//    regions must place the SAME vertex for a cell they both contain, or a
//    per-brick re-mesh tears.
// -----------------------------------------------------------------------------
TEST(surface_nets_filters_to_edits_and_tiles_seamlessly) {
  const BodyParams b = forge();
  const Vec3 u = dirAt(2.0, 144.0);
  const Vec3 centre = u * (b.radiusM + sampleDesignedHeight(b, u));
  DensityField f;
  f.digSphere(b, centre, 2.5);

  SurfaceNetsOpts all;
  all.editedOnly = false;
  SurfaceNetsOpts edited;          // the shipped default
  const SurfaceNetsMesh mAll = surfaceNetsAround(b, f, centre, 14.0, all);
  const SurfaceNetsMesh mEd = surfaceNetsAround(b, f, centre, 14.0, edited);
  std::printf("    filter: %d cells crossed, %zu vertices unfiltered, %zu "
              "filtered to edits (%.1f%% dropped)\n",
              mAll.cellsCrossed, mAll.positions.size(), mEd.positions.size(),
              100.0 * (1.0 - double(mEd.positions.size()) /
                                 double(mAll.positions.size() + 1)));
  CHECK(mEd.positions.size() < mAll.positions.size());
  CHECK(mEd.positions.size() > 20);

  // Seam: mesh a cell from two different region origins and compare its vertex.
  // Take the cell FROM the mesh, so the test cannot silently pass by naming a
  // cell the surface does not cross.
  CHECK(!mAll.positions.empty());
  const VoxelCell c = cellForPos(mAll.positions[mAll.positions.size() / 2]);
  const auto vertexIn = [&](const VoxelCell& lo, const VoxelCell& hi, Vec3& out) {
    const SurfaceNetsMesh m = surfaceNets(b, f, lo, hi, all);
    // Recover the vertex belonging to cell c by matching its containing cell.
    for (const Vec3& v : m.positions) {
      const VoxelCell vc = cellForPos(v);
      if (vc == c) { out = v; return true; }
    }
    return false;
  };
  Vec3 v1, v2;
  const bool got1 = vertexIn(VoxelCell{c.cx - 5, c.cy - 5, c.cz - 5},
                             VoxelCell{c.cx + 5, c.cy + 5, c.cz + 5}, v1);
  const bool got2 = vertexIn(VoxelCell{c.cx - 2, c.cy - 9, c.cz - 3},
                             VoxelCell{c.cx + 8, c.cy + 2, c.cz + 7}, v2);
  CHECK(got1 && got2);
  if (got1 && got2) {
    CHECK(bits(v1.x) == bits(v2.x));
    CHECK(bits(v1.y) == bits(v2.y));
    CHECK(bits(v1.z) == bits(v2.z));
  }
}

// -----------------------------------------------------------------------------
// 10. Cost. The chunk gate is 12 ms and the shipped round trip is 6.0 ms
//     (DW-19), so a re-mesh must stay in the same order it was.
// -----------------------------------------------------------------------------
TEST(a_remesh_of_a_dig_region_is_affordable) {
  const BodyParams b = forge();
  const Vec3 u = dirAt(2.0, 144.0);
  const Vec3 centre = u * (b.radiusM + sampleDesignedHeight(b, u));
  DensityField f;
  f.digSphere(b, centre, 2.0);
  const SurfaceNetsMesh m = surfaceNetsAround(b, f, centre, 8.0, {});
  std::printf("    remesh: %d cells scanned, %d crossed, %d emitted, %zu "
              "vertices, %zu triangles, %zu field entries memoized\n",
              m.cellsScanned, m.cellsCrossed, m.cellsEmitted,
              m.positions.size(), m.indices.size() / 3, f.memoSize());
  CHECK(m.cellsScanned > 1000);
  CHECK(m.positions.size() > 0);
  CHECK(m.indices.size() > 0);
}

// -----------------------------------------------------------------------------
// 11. BRICK TILING. The client meshes one 8-cell brick at a time and caches the
//     result, so the rule that decides which brick owns which quad is the
//     difference between a seamless surface and either a visible crack or a
//     doubled triangle. Neither shows up in a vertex count, so assert it: the
//     union of the per-brick meshes must carry EXACTLY the same triangles, once
//     each, as one whole-region mesh over the same cells.
// -----------------------------------------------------------------------------
TEST(bricks_tile_without_a_seam_or_a_doubled_triangle) {
  const BodyParams b = forge();
  const Vec3 u = dirAt(2.0, 144.0);
  const Vec3 centre = u * (b.radiusM + sampleDesignedHeight(b, u));
  DensityField f;
  // A bore long enough to cross several brick boundaries in every axis.
  Vec3 t1, t2;
  tangents(u, t1, t2);
  for (int i = 0; i < 20; ++i)
    f.digSphere(b, centre + t1 * (i * 1.2) - u * 3.0, 2.0);

  const int B = 8;
  const VoxelCell c = cellForPos(centre);
  const int32_t b0x = (c.cx - 24) / B, b1x = (c.cx + 24) / B;
  const int32_t b0y = (c.cy - 24) / B, b1y = (c.cy + 24) / B;
  const int32_t b0z = (c.cz - 24) / B, b1z = (c.cz + 24) / B;

  SurfaceNetsOpts all;
  all.editedOnly = false;

  // A triangle is named by the three CELLS its vertices live in, sorted, so the
  // same triangle found from two different region origins compares equal even
  // though its vertex indices differ.
  const auto triKeys = [&](const SurfaceNetsMesh& m) {
    std::vector<std::array<uint64_t, 3>> out;
    for (size_t i = 0; i + 2 < m.indices.size(); i += 3) {
      std::array<uint64_t, 3> k{voxelCellId(cellForPos(m.positions[m.indices[i]])),
                                voxelCellId(cellForPos(m.positions[m.indices[i + 1]])),
                                voxelCellId(cellForPos(m.positions[m.indices[i + 2]]))};
      std::sort(k.begin(), k.end());
      out.push_back(k);
    }
    std::sort(out.begin(), out.end());
    return out;
  };

  std::vector<std::array<uint64_t, 3>> fromBricks;
  int brickVerts = 0;
  for (int32_t bz = b0z; bz <= b1z; ++bz)
    for (int32_t by = b0y; by <= b1y; ++by)
      for (int32_t bx = b0x; bx <= b1x; ++bx) {
        const SurfaceNetsMesh m = surfaceNetsBrick(b, f, bx, by, bz, B, all);
        brickVerts += static_cast<int>(m.positions.size());
        for (const auto& k : triKeys(m)) fromBricks.push_back(k);
      }
  std::sort(fromBricks.begin(), fromBricks.end());

  // The whole-region reference, over exactly the cells the bricks covered.
  const SurfaceNetsMesh whole = surfaceNets(
      b, f, VoxelCell{b0x * B, b0y * B, b0z * B},
      VoxelCell{b1x * B + B - 1, b1y * B + B - 1, b1z * B + B - 1}, all);
  std::vector<std::array<uint64_t, 3>> ref = triKeys(whole);

  // Duplicates: a doubled triangle is z-fighting, and it is silent.
  size_t dupes = 0;
  for (size_t i = 1; i < fromBricks.size(); ++i)
    if (fromBricks[i] == fromBricks[i - 1]) ++dupes;

  // Every triangle the whole-region mesh found must be present in the union.
  // The reverse need not hold at the outermost brick ring, which reaches one
  // cell further out than the reference region does.
  size_t missing = 0;
  for (const auto& k : ref)
    if (!std::binary_search(fromBricks.begin(), fromBricks.end(), k)) ++missing;

  std::printf("    bricks: %zu triangles from %d brick meshes (%d vertices) "
              "against %zu in one whole-region mesh; %zu duplicated, %zu of the "
              "reference missing\n",
              fromBricks.size(),
              (b1x - b0x + 1) * (b1y - b0y + 1) * (b1z - b0z + 1), brickVerts,
              ref.size(), dupes, missing);
  CHECK(ref.size() > 200);
  CHECK(dupes == 0);
  CHECK(missing == 0);
}

// -----------------------------------------------------------------------------
// 12. A FLOATING SLAB DOES NOT MOVE THE SMOOTH SURFACE, and neither does the
//     height it happens to sit at.
//
//     WG-22 established the property with a rule (a run of edited cells ANCHORED
//     at the base) and the port of test_surface_field.cpp had to drop it, because
//     the first version of the root find answered "the topmost crossing" and was
//     ALSO stepping over thin structures: the same 0.87 m block measured 6.6169 m
//     from one height and 0.0002 m from another, which is a coin flip rather than
//     a behaviour. Both halves are fixed here, so both halves are asserted: the
//     march steps one cell and can no longer skip a slab, and a solid run that
//     turns back to air before the ground is not the surface.
//
//     Why it matters beyond tidiness: the heightfield is what the streamed chunk
//     draws, so raising it under a bridge would build a ramp of ground up to
//     something the player deliberately put in the air.
// -----------------------------------------------------------------------------
TEST(a_floating_slab_does_not_raise_the_heightfield_at_any_height) {
  const BodyParams b = forge();
  const Vec3 u = dirAt(2.0, 144.0);
  const double baseH = sampleDesignedHeight(b, u);
  const double surfR = b.radiusM + baseH;

  int tested = 0, unmoved = 0;
  double worst = 0.0, worstAt = 0.0;
  // Sweep the height so the answer cannot depend on where the march's steps
  // happen to land, which is exactly the failure this case exists to catch.
  for (double up = 3.0; up <= 12.0; up += 0.35) {
    DensityField f;
    const int placed = f.fillSphere(b, u * (surfR + up), 1.2);
    if (placed <= 0) continue;
    ++tested;
    const double h = columnSurfaceHeight(b, f, u, 80.0, 24.0);
    const double e = std::fabs(h - baseH);
    if (e > worst) { worst = e; worstAt = up; }
    if (e < 0.10) ++unmoved;
    // The slab is still SOLID, though: the voxel layer carries it, exactly as it
    // alone carries a tunnel. If this fails the test is passing vacuously.
    CHECK(f.solidAt(b, u * (surfR + up)));
  }
  std::printf("    floating slab: %d of %d heights leave the surface unmoved, "
              "worst %.4f m at %.2f m up\n", unmoved, tested, worst, worstAt);
  CHECK(tested >= 20);
  CHECK(unmoved == tested);

  // And the mirror: ground that IS attached raises the surface, or the rule
  // above would be indistinguishable from ignoring fill altogether.
  DensityField g;
  for (int i = 0; i <= 6; ++i) g.fillSphere(b, u * (surfR + i * 0.8), 1.5);
  const double raised = columnSurfaceHeight(b, g, u, 80.0, 24.0) - baseH;
  std::printf("    attached fill: surface rose %.3f m\n", raised);
  CHECK(raised > 3.0);
}
