#pragma once
// =============================================================================
// cubed_sphere.h — Wave-0 headless world-generation core (Spike 1).
//
// A cubed-sphere quadtree heightfield generator whose HEADLINE PROPERTY is
// crack-free determinism: neighbouring / parent-child quads produce
// BIT-IDENTICAL shared-edge vertices, and the same seed regenerates an
// identical mesh. (See docs/spikes/spike1-worldgen.md §1–§2, §4–§5.)
//
// The single rule that makes this work (WG-6, spike §1.3):
//   Height is POSITION-hashed from (bodySeed, unitDir) — never sequence-hashed.
//   Two quads that share an edge sample the SAME unitDir on that edge, so they
//   get the SAME height bits. The quadPath only chooses WHICH dirs are sampled
//   and at what density, never WHAT value a dir yields.
//
// For that to hold bitwise, the shared edge's (u,v) face coordinate — and hence
// its unitDir — must be computed identically regardless of which quad / depth
// produces it. We achieve this with:
//   * a closed-form, integer-exact quad extent in a face-grid lattice (§1.2),
//   * a face-grid coordinate (faceId, level, ix, iy) that is the SAME integer
//     lattice point for a shared edge vertex from either neighbour or
//     parent/child — so the produced double (u,v) is bit-identical, and
//   * canonical-edge ownership across the 3 cube-face seams (WG-6 / WR1): a
//     shared cube edge is always evaluated from one canonical face so both
//     faces read identical doubles.
//
// Header-only. Depends only on of::Vec3 / of::Vec3f / of::UniverseCoord /
// of::FrameId from the green core-engine core, plus the C++17 stdlib.
// No UE, no rendering, no physics — this is the isolation harness.
// =============================================================================
#include <cstdint>
#include <cstring>
#include <cmath>
#include <vector>
#include <array>
#include <functional>

#include "of/vec3.h"
#include "of/universe_coord.h"

namespace of {
namespace worldgen {

// =============================================================================
// §0 — Deterministic position hash (the determinism substrate, WG-6).
//
// A pure 64-bit integer hash (SplitMix64 finalizer family) over bit-reinterpreted
// doubles. Float inputs are quantised to their exact IEEE-754 bits, so the same
// double always produces the same hash — the foundation of position-hashing.
// =============================================================================

// Reinterpret a double's bits as a uint64 (no precision loss, no rounding).
inline uint64_t bitsOf(double d) {
  uint64_t u;
  std::memcpy(&u, &d, sizeof(u));
  return u;
}

// SplitMix64 finalizer — strong avalanche, no state.
inline uint64_t mix64(uint64_t x) {
  x += 0x9E3779B97F4A7C15ull;
  x = (x ^ (x >> 30)) * 0xBF58476D1CE4E5B9ull;
  x = (x ^ (x >> 27)) * 0x94D049BB133111EBull;
  x = x ^ (x >> 31);
  return x;
}

inline uint64_t hashCombine(uint64_t a, uint64_t b) {
  return mix64(a ^ (mix64(b) + 0x9E3779B97F4A7C15ull + (a << 6) + (a >> 2)));
}

// Position hash: (bodySeed, unitDir, channel) -> uint64. Pure, order-independent.
inline uint64_t hashPos(uint64_t seed, const Vec3& dir, uint64_t channel) {
  uint64_t h = mix64(seed ^ (channel * 0x9E3779B97F4A7C15ull));
  h = hashCombine(h, bitsOf(dir.x));
  h = hashCombine(h, bitsOf(dir.y));
  h = hashCombine(h, bitsOf(dir.z));
  return h;
}

// uint64 -> double in [0,1) (top 53 bits -> mantissa). Deterministic.
inline double hashToUnit(uint64_t h) {
  return (h >> 11) * (1.0 / 9007199254740992.0);  // / 2^53
}

// uint64 -> double in [-1,1).
inline double hashToSigned(uint64_t h) { return hashToUnit(h) * 2.0 - 1.0; }

// =============================================================================
// §1.1 — The six cube faces and the tangent (equal-angle) cube->sphere warp.
//
// Fixed face IDs (spike §1.1): 0:+Z  1:-Z  2:+Y  3:-Y  4:-X  5:+X.
// Each face has an orthonormal basis {right, up, normal}.
// =============================================================================
struct FaceBasis {
  Vec3 right, up, normal;
};

inline const FaceBasis& faceBasis(int faceId) {
  // right/up chosen so face-local (u,v) tiles consistently; normal is outward.
  static const std::array<FaceBasis, 6> kBases = {{
      /*0 +Z*/ {Vec3(1, 0, 0), Vec3(0, 1, 0), Vec3(0, 0, 1)},
      /*1 -Z*/ {Vec3(-1, 0, 0), Vec3(0, 1, 0), Vec3(0, 0, -1)},
      /*2 +Y*/ {Vec3(1, 0, 0), Vec3(0, 0, 1), Vec3(0, 1, 0)},
      /*3 -Y*/ {Vec3(1, 0, 0), Vec3(0, 0, -1), Vec3(0, -1, 0)},
      /*4 -X*/ {Vec3(0, 0, 1), Vec3(0, 1, 0), Vec3(-1, 0, 0)},
      /*5 +X*/ {Vec3(0, 0, -1), Vec3(0, 1, 0), Vec3(1, 0, 0)},
  }};
  return kBases[faceId];
}

// Tangent (equal-angle) warp: s in [-1,1] -> [-1,1]. tan(s*pi/4) compresses
// toward face centres and expands at corners, giving near-uniform triangle area
// across the sphere vs raw normalize (spike §1.1, WG-5).
inline double warp(double s) { return std::tan(s * 0.78539816339744830961);  /* pi/4 */ }

// Face-local (u,v) in [-1,1]^2 -> unit-sphere direction, with tangent warp.
// This is the ONLY producer of unitDir — every sampler routes through it so a
// shared (faceId,u,v) yields a bit-identical dir.
inline Vec3 unitDir(int faceId, double u, double v) {
  const FaceBasis& b = faceBasis(faceId);
  const double wu = warp(u);
  const double wv = warp(v);
  Vec3 p(b.normal.x + wu * b.right.x + wv * b.up.x,
         b.normal.y + wu * b.right.y + wv * b.up.y,
         b.normal.z + wu * b.right.z + wv * b.up.z);
  const double inv = 1.0 / p.length();
  return Vec3(p.x * inv, p.y * inv, p.z * inv);
}

// Naive normalize (no warp) — used only to demonstrate the warp's uniformity win.
inline Vec3 unitDirNaive(int faceId, double u, double v) {
  const FaceBasis& b = faceBasis(faceId);
  Vec3 p(b.normal.x + u * b.right.x + v * b.up.x,
         b.normal.y + u * b.right.y + v * b.up.y,
         b.normal.z + u * b.right.z + v * b.up.z);
  const double inv = 1.0 / p.length();
  return Vec3(p.x * inv, p.y * inv, p.z * inv);
}

// --- Canonical-edge ownership across cube-face seams (WG-6 / WR1) -------------
// A direction exactly ON a cube edge/corner is reachable from 2 (edge) or 3
// (corner) faces. To guarantee both faces read identical doubles, we snap a dir
// to its CANONICAL face: the face whose normal axis has the largest |component|,
// breaking ties toward the lower faceId. Producing the dir from that one face's
// (u,v) makes a seam vertex bit-identical from either side.
inline int faceOfDir(const Vec3& d) {
  const double ax = std::fabs(d.x), ay = std::fabs(d.y), az = std::fabs(d.z);
  // Tie-break order matches face-id order so a shared edge resolves canonically.
  if (az >= ax && az >= ay) return d.z >= 0.0 ? 0 : 1;  // +Z / -Z
  if (ay >= ax && ay >= az) return d.y >= 0.0 ? 2 : 3;  // +Y / -Y
  return d.x >= 0.0 ? 5 : 4;                            // +X / -X
}

// =============================================================================
// §1.2 — FQuadKey: face + quadtree path. The deterministic seed coordinate.
//
// The face is bisected `depth` times along a base-4 path (SW=0 SE=1 NW=2 NE=3).
// We address quads through an INTEGER face-grid lattice: at a given `level`, the
// face is a (2^level) x (2^level) grid of quads, the quad at (qx,qy). This makes
// the quad extent integer-exact and, crucially, lets a vertex be named by an
// integer lattice point (faceId, sampleLevel, ix, iy) that is the SAME for a
// shared edge from any neighbour / parent / child — the bitwise-share key.
// =============================================================================
struct FQuadKey {
  uint32_t bodyId = 0;
  int faceId = 0;
  int depth = 0;    // quadtree level (0 = whole face)
  uint32_t qx = 0;  // quad column in the 2^depth x 2^depth face grid
  uint32_t qy = 0;  // quad row

  bool operator==(const FQuadKey& o) const {
    return bodyId == o.bodyId && faceId == o.faceId && depth == o.depth &&
           qx == o.qx && qy == o.qy;
  }
};

// Child of a quad. childIdx: SW=0 SE=1 NW=2 NE=3 (x = bit0, y = bit1).
inline FQuadKey quadChild(const FQuadKey& k, int childIdx) {
  FQuadKey c = k;
  c.depth = k.depth + 1;
  c.qx = (k.qx << 1) | (childIdx & 1);
  c.qy = (k.qy << 1) | ((childIdx >> 1) & 1);
  return c;
}

// Parent of a quad (depth>0).
inline FQuadKey quadParent(const FQuadKey& k) {
  FQuadKey p = k;
  p.depth = k.depth - 1;
  p.qx = k.qx >> 1;
  p.qy = k.qy >> 1;
  return p;
}

// =============================================================================
// §1.2b — The integer vertex lattice (the bitwise-share mechanism).
//
// Pick a SAMPLE LEVEL L deep enough that every quad's GRID vertices land on
// lattice points: with GRID = 2^cellBits + 1 cells per side at quad depth d, a
// vertex lives at face-grid level L = d + cellBits, integer coordinate
// (ix, iy) in [0, 2^L]. The face-space coordinate of lattice point i at level L
// is the SAME double regardless of which quad addresses it, because it is a
// pure function of (i, L):
//      u = -1 + 2 * (i / 2^L)
// computed identically (same operands, same order) everywhere. So a shared edge
// vertex -> same (ix,iy,L) -> same (u,v) bits -> same unitDir bits -> same
// height bits. This is the crux of WV1/WV2/WV3.
// =============================================================================

// cells-per-quad-side = 2^kCellBits  (GRID = 2^kCellBits + 1 vertices/side).
static constexpr int kCellBits = 5;            // 32 cells -> GRID = 33 (spike §1.3)
static constexpr int kGridDim = (1 << kCellBits) + 1;  // 33

// Face-space u (or v) coordinate of integer lattice point `i` at level `L`.
// PURE function of (i, L) -> bit-identical from any caller. THE share guarantee.
inline double latticeCoord(uint64_t i, int level) {
  const double denom = static_cast<double>(uint64_t(1) << level);  // 2^L (exact)
  return -1.0 + 2.0 * (static_cast<double>(i) / denom);
}

// Direction at lattice point (faceId, ix, iy, level). Routes through unitDir so
// it is bit-identical to any other caller naming the same lattice point.
inline Vec3 latticeDir(int faceId, uint64_t ix, uint64_t iy, int level) {
  return unitDir(faceId, latticeCoord(ix, level), latticeCoord(iy, level));
}

// =============================================================================
// §2 — Body parameters (the 2 spike bodies, spike §5).
// =============================================================================
enum BodyKind { kPlanet = 0, kMoon = 1 };

struct BodyParams {
  uint32_t bodyId = 0;
  uint64_t bodySeed = 0;
  double radiusM = 6.0e5;
  BodyKind kind = kPlanet;
  double maxReliefM = 6000.0;
  double seaLevelM = 0.0;   // relief clamp datum (planet); ignored for moon
  // DW-18 — the body's gravitational parameter mu = G*M (m^3/s^2), and THE ONE
  // authority for gravity on this body. Read it; never re-derive g from a
  // density model. 0 means "unknown", which makes surface_walk.h fall back to
  // its uniform-sphere estimate for a body nobody has given a mu.
  //
  // It is NOT derived from radiusM: Forge is deliberately an artificially dense
  // world (600 km across with 9.81 m/s^2 at the surface) so that walking reads
  // correctly while orbital velocity stays near 2.3 km/s, exactly the trade KSP
  // makes with Kerbin and for exactly the same reason. Deriving mass from radius
  // is what produced the 0.587 m/s^2 / 4.8 second jump.
  //
  // NOTE: mu takes no part in world generation. Height, biome and voxel solidity
  // read bodySeed / radiusM / maxReliefM / seaLevelM only, so this field cannot
  // move a vertex and no terrain baseline changes with it.
  double muM3S2 = 0.0;
};

// Spike §5.1 — planet "Forge".
inline BodyParams makeForge(uint64_t worldSeed) {
  BodyParams b;
  b.bodyId = 0;
  b.bodySeed = mix64(worldSeed ^ 0xF0F0F0F0ull);
  b.radiusM = 6.0e5;          // 600 km
  b.kind = kPlanet;
  b.maxReliefM = 6000.0;      // ~6 km continents + mountains
  b.seaLevelM = 0.0;
  // DW-18: mu = g * R^2 with g = 9.81 m/s^2 at R = 600 km -> 3.5316e12.
  // MUST equal of::orbital::kForgeMu; world_gen_tests pins the two together so
  // the walker and the propagator can never disagree about the same planet.
  b.muM3S2 = 9.81 * 6.0e5 * 6.0e5;
  return b;
}

// Spike §5.2 — moon "Cinder".
inline BodyParams makeCinder(uint64_t worldSeed) {
  BodyParams b;
  b.bodyId = 1;
  b.bodySeed = mix64(worldSeed ^ 0x0C0C0C0Cull);
  b.radiusM = 2.0e5;          // 200 km
  b.kind = kMoon;
  b.maxReliefM = 4000.0;      // ~4 km craters + rolling
  b.seaLevelM = 0.0;
  // mu = 1.63 * 200e3^2 = 6.52e10. MUST equal of::orbital::kCinderMu.
  b.muM3S2 = 1.63 * 2.0e5 * 2.0e5;
  return b;
}

// =============================================================================
// §2 — The deterministic noise stack (spike §2).
//
// All noise is POSITION-hashed over the unit-sphere direction (3D domain -> no
// UV-seam artefacts). Value noise with gradient-smoothed interpolation; cheap,
// deterministic, order-independent. fBm + a body "signature" layer:
//   planet -> ridged-multifractal mountains
//   moon   -> hashed-grid crater field
// =============================================================================

inline double fade(double t) {  // quintic smoothstep (C2)
  return t * t * t * (t * (t * 6.0 - 15.0) + 10.0);
}
inline double lerp(double a, double b, double t) { return a + (b - a) * t; }

// 3D value noise on a lattice of the scaled direction. Position-hashed corners.
//
// HOT-PATH OPTIMIZATION (bit-identical): the original computed the full 4-step
// hash chain (base mix + 3 hashCombines) independently for all 8 corners — but
// the chain shares prefixes. Because dx,dy,dz are each in {0,1}, there are only:
//   * ONE base hash  = mix64(seed ^ channel*C)           (was computed 8x)
//   * TWO x-stage     = hashCombine(base, ix+{0,1})        (was 8x -> 2x)
//   * FOUR xy-stage   = hashCombine(hx,   iy+{0,1})        (was 8x -> 4x)
//   * EIGHT final     = hashCombine(hxy,  iz+{0,1})        (the unavoidable leaf)
// We precompute the shared prefixes ONCE. Identical operands in identical order
// => identical bits, but ~ half the mix64/hashCombine calls per valueNoise(). The
// integer-cast operands are also hoisted (ix..iz+1 computed once each).
inline double valueNoise(uint64_t seed, const Vec3& p, uint64_t channel) {
  const double fx = std::floor(p.x), fy = std::floor(p.y), fz = std::floor(p.z);
  const int ix = static_cast<int>(fx), iy = static_cast<int>(fy),
            iz = static_cast<int>(fz);
  const double tx = fade(p.x - fx), ty = fade(p.y - fy), tz = fade(p.z - fz);

  // Integer corner operands (each used in 4 of the 8 corners) — hoisted.
  const uint64_t ix0 = static_cast<uint64_t>(static_cast<int64_t>(ix));
  const uint64_t ix1 = static_cast<uint64_t>(static_cast<int64_t>(ix + 1));
  const uint64_t iy0 = static_cast<uint64_t>(static_cast<int64_t>(iy));
  const uint64_t iy1 = static_cast<uint64_t>(static_cast<int64_t>(iy + 1));
  const uint64_t iz0 = static_cast<uint64_t>(static_cast<int64_t>(iz));
  const uint64_t iz1 = static_cast<uint64_t>(static_cast<int64_t>(iz + 1));

  // Shared prefixes (computed once, not per corner).
  const uint64_t base = mix64(seed ^ (channel * 0x9E3779B97F4A7C15ull));
  const uint64_t hx0 = hashCombine(base, ix0);
  const uint64_t hx1 = hashCombine(base, ix1);
  const uint64_t hx0y0 = hashCombine(hx0, iy0);
  const uint64_t hx0y1 = hashCombine(hx0, iy1);
  const uint64_t hx1y0 = hashCombine(hx1, iy0);
  const uint64_t hx1y1 = hashCombine(hx1, iy1);

  const double c000 = hashToSigned(hashCombine(hx0y0, iz0));
  const double c100 = hashToSigned(hashCombine(hx1y0, iz0));
  const double c010 = hashToSigned(hashCombine(hx0y1, iz0));
  const double c110 = hashToSigned(hashCombine(hx1y1, iz0));
  const double c001 = hashToSigned(hashCombine(hx0y0, iz1));
  const double c101 = hashToSigned(hashCombine(hx1y0, iz1));
  const double c011 = hashToSigned(hashCombine(hx0y1, iz1));
  const double c111 = hashToSigned(hashCombine(hx1y1, iz1));

  const double x00 = lerp(c000, c100, tx), x10 = lerp(c010, c110, tx);
  const double x01 = lerp(c001, c101, tx), x11 = lerp(c011, c111, tx);
  const double y0 = lerp(x00, x10, ty), y1 = lerp(x01, x11, ty);
  return lerp(y0, y1, tz);
}

// fBm: sum of octaves of value noise.
inline double fbm(uint64_t seed, const Vec3& dir, double freq, int octaves,
                  uint64_t channel) {
  double sum = 0.0, amp = 0.5, f = freq;
  for (int o = 0; o < octaves; ++o) {
    sum += amp * valueNoise(seed, dir * f, channel + static_cast<uint64_t>(o));
    f *= 2.0;
    amp *= 0.5;
  }
  return sum;
}

// Ridged-multifractal: 1 - |noise|, squared and accumulated -> sharp ridges.
inline double ridged(uint64_t seed, const Vec3& dir, double freq, int octaves,
                     uint64_t channel) {
  double sum = 0.0, amp = 0.5, f = freq, prev = 1.0;
  for (int o = 0; o < octaves; ++o) {
    double n =
        valueNoise(seed, dir * f, channel + static_cast<uint64_t>(o) + 777u);
    n = 1.0 - std::fabs(n);
    n *= n;
    sum += amp * n * prev;
    prev = n;
    f *= 2.0;
    amp *= 0.5;
  }
  return sum;
}

// Hashed-grid crater field (moon signature, spike §2.2). Hash cells on the
// scaled direction; one candidate crater per cell; accumulate nearest profiles.
// Position-hashed so craters are identical across runs / LOD.
inline double craterField(uint64_t seed, const Vec3& dir, double freq) {
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
        // Jittered crater centre within the cell.
        const Vec3 centre(fx + dx + hashToUnit(hashCombine(cell, 1)),
                          fy + dy + hashToUnit(hashCombine(cell, 2)),
                          fz + dz + hashToUnit(hashCombine(cell, 3)));
        const double exist = hashToUnit(hashCombine(cell, 4));
        if (exist > 0.55) continue;  // not every cell has a crater
        const Vec3 d = p - centre;
        const double dist = d.length();
        const double cr = 0.30 + 0.45 * hashToUnit(hashCombine(cell, 5));  // radius
        if (dist > cr * 1.6) continue;
        // Crater profile: bowl (negative) + raised rim (positive bump).
        const double t = dist / cr;
        double prof;
        if (t < 1.0) {
          prof = -(1.0 - t * t);            // bowl
        } else {
          const double rim = (t - 1.0) / 0.6;
          prof = (rim < 1.0) ? (1.0 - rim) * 0.5 : 0.0;  // rim falloff
        }
        h += prof;
      }
  return h;
}

// =============================================================================
// §2 — SampleHeightField(bodySeed, dir): metres of relief. PURE & POSITION-
// HASHED (WG-6). The SAME (bodySeed, dir) always returns the SAME bits.
//
// `dir` is canonicalised through the cube-face seam rule BEFORE sampling, but
// because the sampler operates directly on the dir vector (not on face/uv),
// callers that already pass a canonical lattice dir get identical results.
// =============================================================================
inline double sampleHeightFieldPlanet(const BodyParams& body, const Vec3& dir) {
  // L0 continents (low freq fBm), L1 ridged mountains (masked), L2 detail.
  const double L0 = fbm(body.bodySeed, dir, 2.5, 4, 11);            // continents
  const double mask = std::max(0.0, L0);                            // land mask
  const double L1 = ridged(body.bodySeed, dir, 20.0, 4, 23);       // mountains
  const double L2 = fbm(body.bodySeed, dir, 80.0, 3, 37);          // detail
  double h = L0 * 0.6 + mask * L1 * 0.9 + L2 * 0.04;
  h *= body.maxReliefM;
  if (h < body.seaLevelM) h = body.seaLevelM;  // flat ocean placeholder
  return h;
}

inline double sampleHeightFieldMoon(const BodyParams& body, const Vec3& dir) {
  const double M0 = fbm(body.bodySeed, dir, 3.0, 3, 41);           // rolling base
  const double M1 = craterField(body.bodySeed, dir, 9.0);          // craters
  const double M2 = fbm(body.bodySeed, dir, 90.0, 2, 53);          // detail
  double h = (M0 * 0.4 + M1 * 0.7 + M2 * 0.03) * body.maxReliefM;
  return h;
}

inline double sampleHeightField(const BodyParams& body, const Vec3& dir) {
  return body.kind == kPlanet ? sampleHeightFieldPlanet(body, dir)
                              : sampleHeightFieldMoon(body, dir);
}

// =============================================================================
// §4.3 — SampleTerrainHeight(bodyRadius, bodySeed, lat, lon): relief at a geo
// coord. PURE, frame-independent, resident-free. lat,lon in radians.
//   lat in [-pi/2, pi/2], lon in [-pi, pi]. Returns relief (metres above datum).
// We convert (lat,lon) -> dir, then route through the SAME sampler the mesh uses
// (no face/uv quantisation) so it agrees with the mesh (WV7).
// =============================================================================
inline Vec3 latLonToDir(double lat, double lon) {
  const double cl = std::cos(lat);
  return Vec3(cl * std::cos(lon), std::sin(lat), cl * std::sin(lon));
}

inline void dirToLatLon(const Vec3& dir, double& lat, double& lon) {
  lat = std::asin(std::max(-1.0, std::min(1.0, dir.y)));
  lon = std::atan2(dir.z, dir.x);
}

inline double SampleTerrainHeight(const BodyParams& body, double lat,
                                  double lon) {
  return sampleHeightField(body, latLonToDir(lat, lon));
}

// =============================================================================
// §1.3 / §4.1 — The generated quad mesh.
//
// vertices are body-center-relative (metres, double). normals are body-frame.
// `dirs` are kept so tests can prove shared edges share the SAME unitDir bits.
// `latticeLevel` (= depth + kCellBits) names this quad's vertex lattice.
// =============================================================================
struct QuadMesh {
  FQuadKey key;
  int gridDim = kGridDim;
  int latticeLevel = 0;            // depth + kCellBits
  uint64_t baseIx = 0, baseIy = 0; // lattice origin (lower-left) of this quad
  UniverseCoord centerUniverse;    // chunk center (§3.4 anchor)
  double chunkRadiusM = 0.0;
  std::vector<Vec3> vertices;      // gridDim*gridDim, body-center-relative
  std::vector<Vec3> normals;       // per-vertex, body-frame
  std::vector<Vec3> dirs;          // per-vertex unit direction (for seam proofs)
  std::vector<double> heights;     // per-vertex relief (metres)
  uint64_t contentHash = 0;        // determinism / cache key (WV1)

  // index helper (row-major: idx = j*gridDim + i)
  int idx(int i, int j) const { return j * gridDim + i; }
};

// Optional per-vertex SURFACE-OFFSET callback (surface_field.h binds this).
// Given a vertex's unit dir, returns the SIGNED metres the edited surface sits
// BELOW the base: positive where the player dug an open column, negative where
// they filled one (WG-22). The mesh subtracts it, so a dig hole and a levelled
// pad both appear in the SAME surface the player walks on. Default = null => the loop
// below is BIT-IDENTICAL to the original (no edit contributes exactly nothing),
// so the undeformed mesh + all determinism proofs are unchanged. ADDITIVE: the
// header stays leaf (no terrain_deform dependency); the caller supplies the fn.
using HeightLoweringFn = std::function<double(const Vec3& dir)>;

// Optional per-vertex BASE-HEIGHT callback (WG-21). Given a vertex's unit dir,
// returns the metres of relief BEFORE any dig lowering — i.e. the surface the mesh
// should draw. Default = null => the mesh samples the RAW sampleHeightField as it
// always did (bit-identical). terrain_stream.h's buildChunk binds this to
// biome.h's sampleDesignedHeight so the STREAMED MESH draws the DESIGNED surface
// (the single surface authority), finally matching the walker + collision + voxel
// shell. Kept as a callback so this header stays LEAF (no biome.h dependency); the
// caller (which already includes biome.h) supplies the designed sampler.
using HeightFieldFn = std::function<double(const Vec3& dir)>;

// Generate the heightfield mesh for a quad at a given resolution (spike §1.3).
//
// Determinism: each vertex's unitDir is named by its INTEGER lattice point
// (faceId, baseIx+i, baseIy+j, latticeLevel) and produced via latticeDir, a pure
// function of those integers. A shared edge vertex therefore resolves to the
// IDENTICAL lattice point — and identical bits — from a neighbour or a parent/
// child. Height is then position-hashed from that bit-identical dir (WG-6).
//
// `lowering` (optional): when set, each vertex height is reduced by lowering(dir)
// metres (the voxel-derived dig depth, surface_field.h). Null = no lowering.
// `baseHeight` (optional, WG-21): when set, replaces the RAW sampleHeightField as
// the base surface (buildChunk passes sampleDesignedHeight). Null = RAW, so the
// no-arg call is BIT-IDENTICAL to the original. A designed base is still a pure
// function of the (bit-identical shared) dir, so shared-edge heights stay
// bit-identical across quads / LOD — the crack-free proof survives the switch.
inline QuadMesh generateQuadMesh(const BodyParams& body, const FQuadKey& key,
                                 const HeightLoweringFn& lowering = nullptr,
                                 const HeightFieldFn& baseHeight = nullptr) {
  QuadMesh m;
  m.key = key;
  m.gridDim = kGridDim;
  m.latticeLevel = key.depth + kCellBits;
  // A quad at depth d occupies columns [qx, qx+1) of a 2^d grid; in the vertex
  // lattice (level = d + cellBits) that is [qx<<cellBits, (qx+1)<<cellBits].
  m.baseIx = static_cast<uint64_t>(key.qx) << kCellBits;
  m.baseIy = static_cast<uint64_t>(key.qy) << kCellBits;

  m.vertices.resize(kGridDim * kGridDim);
  m.normals.resize(kGridDim * kGridDim);
  m.dirs.resize(kGridDim * kGridDim);
  m.heights.resize(kGridDim * kGridDim);

  uint64_t ch = mix64(body.bodySeed ^ (uint64_t(key.faceId) * 0x1000003ull));
  ch = hashCombine(ch, key.depth);
  ch = hashCombine(ch, (uint64_t(key.qy) << 32) | key.qx);

  Vec3 centerAccum{};
  for (int j = 0; j < kGridDim; ++j) {
    for (int i = 0; i < kGridDim; ++i) {
      const uint64_t ix = m.baseIx + static_cast<uint64_t>(i);
      const uint64_t iy = m.baseIy + static_cast<uint64_t>(j);
      // THE shared-edge guarantee: dir is a pure function of (faceId,ix,iy,L).
      const Vec3 dir = latticeDir(key.faceId, ix, iy, m.latticeLevel);
      double h = baseHeight ? baseHeight(dir)          // WG-21: designed base
                            : sampleHeightField(body, dir);  // null = RAW (bit-identical)
      if (lowering) {                       // subtract the voxel-derived offset
        const double dug = lowering(dir);
        // SIGNED since WG-22: positive lowers (a dug column), negative raises (a
        // filled one). The old guard was `dug > 0.0`, which silently discarded
        // every fill and would have left terraformed ground rendering at the
        // height it used to be while the walker stood on the new one — the
        // five-surfaces failure with the sign flipped. `!= 0.0` keeps the undug
        // path bit-identical (an exact 0 still contributes nothing).
        if (dug != 0.0) h -= dug;           // move the SAME surface the mesh draws
      }
      const double radius = body.radiusM + h;
      const Vec3 pos = dir * radius;  // body-center-relative
      const int vi = m.idx(i, j);
      m.dirs[vi] = dir;
      m.heights[vi] = h;
      m.vertices[vi] = pos;
      centerAccum = centerAccum + pos;
      ch = hashCombine(ch, bitsOf(h));
    }
  }
  centerAccum = centerAccum * (1.0 / (kGridDim * kGridDim));
  m.centerUniverse = UniverseCoord(centerAccum, static_cast<FrameId>(body.bodyId + 1));
  m.contentHash = ch;

  // Per-vertex normals via central differences on the grid (spike §1.3).
  // Edge vertices fall back to the radial-up direction (good enough for spike;
  // normals are not part of the bitwise-share contract, heights are).
  for (int j = 0; j < kGridDim; ++j) {
    for (int i = 0; i < kGridDim; ++i) {
      const int vi = m.idx(i, j);
      if (i == 0 || i == kGridDim - 1 || j == 0 || j == kGridDim - 1) {
        m.normals[vi] = m.dirs[vi];  // radial up at the boundary
        continue;
      }
      const Vec3 du = m.vertices[m.idx(i + 1, j)] - m.vertices[m.idx(i - 1, j)];
      const Vec3 dv = m.vertices[m.idx(i, j + 1)] - m.vertices[m.idx(i, j - 1)];
      // cross(du, dv)
      Vec3 n(du.y * dv.z - du.z * dv.y, du.z * dv.x - du.x * dv.z,
             du.x * dv.y - du.y * dv.x);
      const double len = n.length();
      if (len > 0.0) n = n * (1.0 / len);
      // orient outward
      if (n.dot(m.dirs[vi]) < 0.0) n = n * -1.0;
      m.normals[vi] = n;
    }
  }

  // Bounding radius (max vertex distance from chunk center) for culling/LOD.
  double maxR = 0.0;
  for (const Vec3& v : m.vertices) {
    const double r = (v - centerAccum).length();
    if (r > maxR) maxR = r;
  }
  m.chunkRadiusM = maxR;
  return m;
}

}  // namespace worldgen
}  // namespace of
