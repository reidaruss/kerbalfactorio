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

// -----------------------------------------------------------------------------
// OPT-IN noise-call instrumentation (terrain_probe / procgen_bench only).
// Compiled entirely OUT unless the TU defines OF_NOISE_COUNT=1 before including
// this header, so the shipped hot path is byte-for-byte the code it always was.
// -----------------------------------------------------------------------------
#ifndef OF_NOISE_COUNT
#define OF_NOISE_COUNT 0
#endif
#if OF_NOISE_COUNT
inline uint64_t& noiseCalls() { static uint64_t n = 0; return n; }
#define OF_COUNT_NOISE() (++::of::worldgen::noiseCalls())
#else
#define OF_COUNT_NOISE() ((void)0)
#endif

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

  // --- WG-26: the HOME FLAT PAD (the level starting area) --------------------
  // A body may declare ONE flat landing/base pad, dead level inside
  // homeFlatRadiusM and smoothly blended back to the natural surface by
  // homeBlendRadiusM. It is applied inside biome.h's sampleDesignedHeight, the
  // single surface authority (standing rule 1), so the mesh, collision, the
  // walker, voxel solidity, deposit snapping and build placement ALL get it with
  // no special case anywhere.
  //
  // homeFlatRadiusM <= 0 disables the pad, and outside homeBlendRadiusM the
  // designed height is BIT-IDENTICAL to the un-padded field, so 99.999% of the
  // planet is untouched by this feature (proved in test_biome.cpp).
  //
  // homeDir is a LITERAL unit vector, never computed with trig at runtime: DW-14
  // says cos/sin can differ by 1 ULP between mingw libm and emscripten musl, and
  // because height is position-hashed from raw bits a 1-ULP difference in the pad
  // centre would hash to an unrelated height. test_biome.cpp pins the literal
  // against latLonToDir to 1e-12.
  Vec3 homeDir{0.0, 0.0, 0.0};
  double homeFlatRadiusM = 0.0;   // dead flat within this arc distance (m)
  double homeBlendRadiusM = 0.0;  // pad effect reaches exactly zero here (m)

  // --- WG-36: the HOME POND, a real BASIN cut into the designed surface ------
  // A body may declare ONE pond: a smooth bowl whose floor is pondDepthM below
  // the surrounding ground at its centre and which reaches that ground exactly
  // at pondRadiusM. Like the pad it is applied inside biome.h's
  // sampleDesignedHeight, so the mesh, collision, the walker, voxel solidity,
  // deposit snapping and build placement ALL see the basin with no special case.
  //
  // THE BASIN IS TERRAIN. THE WATER LEVEL IS NOT.
  // These four fields describe the shape of the GROUND only. Where the water
  // surface sits is a separate published quantity that lives in water_field.h
  // and is never obtained by asking any height function for "the surface"
  // (DW-26: an unnamed second shape of an answer becomes a sixth definition of
  // the surface; a named one is an interface). pondFreeboardM below is an input
  // to that quantity, parked here only because BodyParams is where a body's
  // constants live; nothing in this header or in biome.h ever reads it.
  //
  // pondRadiusM <= 0 disables the pond, and outside pondRadiusM the designed
  // height is BIT-IDENTICAL to the un-ponded field (the basin term returns
  // exactly 0.0 and `x - 0.0 == x`), so the feature perturbs a disc a few tens
  // of metres across and leaves the rest of the planet alone.
  //
  // pondDir is a LITERAL unit vector for the same DW-14 reason homeDir is.
  Vec3 pondDir{0.0, 0.0, 0.0};
  double pondRadiusM = 0.0;     // basin meets the surrounding ground here (m)
  double pondDepthM = 0.0;      // ground drop at the basin centre (m)
  double pondFreeboardM = 0.0;  // water surface sits this far BELOW rim ground
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
  // WG-26: the home flat pad at lat 2 deg, lon 144 deg (the scenario spawn).
  // LITERAL doubles, never latLonToDir at runtime: DW-14 says cos/sin can differ
  // by 1 ULP between mingw libm and emscripten musl, and since height is
  // position-hashed from raw bits, a 1-ULP difference in this vector would hash
  // the pad to an entirely unrelated height on the other toolchain. These are
  // the exact bits latLonToDir(2*pi/180, 144*pi/180) produces; test_biome.cpp
  // pins them against it to 1e-12.
  b.homeDir = Vec3(-0.80852416308088182, 0.034899496702500969,
                   0.58742718939820271);
  // 300 m of dead-level ground to start a base on, blended back to the natural
  // surface by 600 m. Measured: the blend adds ~1 percentage point of grade over
  // the natural slope of the same ground, so it does not read as a cut disc.
  b.homeFlatRadiusM = 150.0;
  b.homeBlendRadiusM = 600.0;
  // WG-36: the home pond, 55.000000 m from the pad centre and therefore wholly
  // inside the 150 m dead-flat disc, so the ground the basin is cut into is the
  // pad's own bit-exact constant and the shoreline is a circle rather than a
  // contour of the noise. Literal doubles for the DW-14 reason above; these are
  // the exact bits of homeDir rotated 55 m along a heading 30 deg east of north,
  // and test_water_field.cpp pins both the unit length and the 55 m separation.
  b.pondDir = Vec3(-0.80849497812912174, 0.034978833858176704,
                   0.58746263840512714);
  // 22 m basin, 4 m deep at the middle, water standing 0.60 m below the rim.
  // Solving t*t*(3 - 2t) = 1 - 0.60/4.00 = 0.85 gives t = 0.755598, so the
  // waterline is at 16.623148 m: a 33.2 m pond inside a 44 m bowl, leaving a
  // 5.4 m ring of dry beach to walk down. 3.40 m of water at the centre, which
  // is 1.89 capsule heights, so swimming is the only way across rather than a
  // deep wade. All four numbers are DERIVED in water_field.h and MEASURED in
  // test_water_field.cpp, which prints them rather than pinning this comment.
  // (This comment first shipped saying 16.11 m and "a 32 m pond", from an
  // arithmetic slip in the same solve. The test caught it, which is the point
  // of asking a suite to print a derived quantity instead of asserting the
  // number a comment claims.)
  b.pondRadiusM = 22.0;
  b.pondDepthM = 4.0;
  b.pondFreeboardM = 0.60;
  return b;
}

// Spike §5.2 — moon "Cinder".
inline BodyParams makeCinder(uint64_t worldSeed) {
  BodyParams b;
  b.bodyId = 1;
  b.bodySeed = mix64(worldSeed ^ 0x0C0C0C0Cull);
  b.radiusM = 2.0e5;          // 200 km
  b.kind = kMoon;
  // WG-141: 4000 was the spike's guess and the crater ladder overruns it. The
  // MEASURED extremes of the shipped field over 200,000 lattice directions are
  // about -5.1 km to +4.9 km, so the declared relief is raised to cover them
  // with margin. `moon_relief_within_declared_max` asserts both the bound and
  // that the field genuinely uses its range, so this number cannot drift back
  // into being a fiction. For scale, KSP's Mun is also a 200 km body and carries
  // roughly 7 km of relief, so this is dramatic but not absurd.
  //
  // 5000 rather than 6000, and the difference is not cosmetic: this number is
  // ALSO the denominator biomeAtMoonH's bands are expressed in, so every metre
  // of headroom added here widens every biome band. The worst measured seed of
  // five is -4565 m to +3985 m, so 5000 covers the field with margin while
  // keeping the bands tight enough that all three moon biomes stay populated.
  b.maxReliefM = 5000.0;
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

// C1 smoothstep, 0 at/below e0 and 1 at/above e1. Used everywhere a threshold
// would otherwise put a STEP in the height field. Multiply/add only, no trig,
// no pow: so it is bit-portable across mingw libm and emscripten musl (DW-14).
inline double smoothstep(double e0, double e1, double x) {
  if (!(e1 > e0)) return x < e0 ? 0.0 : 1.0;
  double t = (x - e0) / (e1 - e0);
  if (t <= 0.0) return 0.0;
  if (t >= 1.0) return 1.0;
  return t * t * (3.0 - 2.0 * t);
}

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
  OF_COUNT_NOISE();
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

// -----------------------------------------------------------------------------
// Ridged MULTIFRACTAL (Musgrave), normalized to ~[0,1]. WG-25.
//
// Why this and not `ridged()` above: `ridged` starts at amp 0.5 and halves, so
// its FIRST octave carries half the total amplitude. At the frequency it was
// called with (20 on a 600 km body) that first octave has a 30 km lattice cell,
// which is why a "mountain" was a 30 km-wide dome and read as a rounded lump at
// human scale. Here the caller picks lacunarity/gain explicitly and the octave
// span is wide enough to carry ridges from tens of kilometres down to hundreds
// of metres.
//
// The `weight` term is the cheap erosion analogue: an octave's detail is
// multiplied by the PREVIOUS octave's value, so fine roughness accumulates on
// the ridges and the valley floors stay smooth: the sediment-filled-valley,
// rocky-crest look, with no derivative evaluation. `n *= n` keeps the crest a
// sharp V (the 1-|n| tent's slope discontinuity survives the squaring) while
// flattening the valley floor.
//
// Multiply/add/fabs only: no pow, no trig (DW-14).
inline double ridgedMF(uint64_t seed, const Vec3& dir, double freq, int octaves,
                       uint64_t channel, double lacunarity, double gain,
                       double weightGain) {
  double sum = 0.0, norm = 0.0, amp = 1.0, f = freq, weight = 1.0;
  for (int o = 0; o < octaves; ++o) {
    double n =
        valueNoise(seed, dir * f, channel + static_cast<uint64_t>(o) + 777u);
    n = 1.0 - std::fabs(n);
    n *= n;
    n *= weight;
    weight = n * weightGain;
    if (weight > 1.0) weight = 1.0;
    sum += amp * n;
    norm += amp;
    f *= lacunarity;
    amp *= gain;
  }
  return (norm > 0.0) ? (sum / norm) : 0.0;
}

// Domain warp: displace the sample position by a low-frequency noise VECTOR.
// The standard cure for "every ridge looks like every other ridge", it bends
// and braids the ranges instead of leaving them axis-aligned and self-similar.
// Three noise calls at ONE low frequency, so it is cheap (WG-25).
inline Vec3 domainWarp(uint64_t seed, const Vec3& dir, double freq, double amp,
                       uint64_t channel) {
  const Vec3 p = dir * freq;
  return Vec3(dir.x + amp * valueNoise(seed, p, channel),
              dir.y + amp * valueNoise(seed, p, channel + 1u),
              dir.z + amp * valueNoise(seed, p, channel + 2u));
}

// Crater profile constants (WG-141). `kCraterReach` is the profile's outer ZERO
// measured in crater radii: at t == kCraterReach the rim contribution is exactly
// 0, so clipping at that distance loses nothing. `kCraterRadiusMax * kCraterReach
// <= 1.0` is the EXACT condition that makes a 3x3x3 cell neighbourhood
// sufficient, which is the subject of the defect note on craterField below.
constexpr double kCraterReach      = 1.6;
constexpr double kCraterRadiusMin  = 0.30;
constexpr double kCraterRadiusSpan = 0.325;  // max 0.625; 0.625 * 1.6 == 1.0
constexpr double kCraterExistMax   = 0.55;   // fraction of cells holding one
constexpr double kCraterRimHeight  = 0.50;   // crest height above the datum

// THE crater profile, shared by both crater fields so the two cannot disagree.
// `t` is distance from the centre in crater radii. The profile is -1 on the
// floor, rises to +kCraterRimHeight at the crest (t == 1), then fades to exactly
// zero with zero slope at t == kCraterReach. Floor-to-crest depth is therefore
// (1 + kCraterRimHeight) times the layer amplitude, which is what the amplitude
// ladder in sampleHeightFieldMoon is calibrated against.
//
// WG-141 FIXES A DISCONTINUITY HERE, AND IT WAS A LARGE ONE. The spike profile
// was `-(1 - t*t)` inside and `(1 - rim) * 0.5` outside. The first tends to 0 as
// t approaches 1 from below; the second is 0.5 AT t == 1. That is a step of half
// the layer amplitude AT EVERY CRATER RIM, on every body that has craters. On
// the old moon it was a 1,400 m vertical wall ringing every crater, which is why
// a 2 m-spacing slope sample on a crater floor could report a 1,589 m step and
// why the wavelength sweep's RMS column was unreadable. The crest is now simply
// the top of the bowl, which is also what a crater looks like.
//
// The outer fade is squared rather than linear so its slope reaches zero at the
// same point its value does; a linear fade leaves a circular crease in the
// derivative, which a shaded normal shows even though the height is continuous.
inline double craterProfile(double t) {
  if (t < 1.0) return -1.0 + (1.0 + kCraterRimHeight) * t * t;
  const double rim = (t - 1.0) / (kCraterReach - 1.0);
  const double f = 1.0 - rim;
  return (f > 0.0) ? kCraterRimHeight * f * f : 0.0;
}

// Hashed-grid crater field (moon signature, spike §2.2). Hash cells on the
// scaled direction; one candidate crater per cell; accumulate nearest profiles.
// Position-hashed so craters are identical across runs / LOD.
//
// WG-141 makes TWO changes here, and the first is a DEFECT FIX, not a tuning.
//
// (1) THE 3x3x3 NEIGHBOURHOOD WAS NOT BIG ENOUGH FOR THE RADIUS IT ALLOWED.
// A crater reaches `cr * 1.6` cells from its centre and the centre is jittered
// anywhere inside its own cell, so a crater influences ground up to `cr * 1.6`
// cells BEYOND that cell. The old `cr` maximum of 0.75 gives a reach of 1.2
// cells, so a crater sitting in a cell TWO away could touch a sample this loop
// never visits: the profile is then clipped part way down its rim and the field
// takes a STEP. Worked case: a sample at a cell's near edge, a crater centred on
// the far edge of the cell two away, distance 1.0, cr 0.75, so t = 1.333 and the
// clipped profile is 0.222, which against this layer's metre amplitude is a
// several-hundred-metre cliff out of nothing. Rare, but real, and it had been
// in the field since the spike.
// The bound is exact and cheap to honour: 3x3x3 is sufficient IF AND ONLY IF the
// reach is at most 1.0 cell, so the radius is capped at 0.625. This MOVES BITS
// on the moon deliberately. `crater_neighbourhood_is_sufficient` in
// test_world_gen.cpp asserts it by brute force against a 5x5x5 sweep and fails
// on the old coefficients by name, so the refusing case is reachable.
//
// (2) The hash chain is hoisted exactly as WG-16 hoisted valueNoise's. The base
// mix is loop-invariant (it was recomputed 27 times), the x stage depends only
// on dx (3 values, was 27) and the xy stage only on dx and dy (9, was 27); the
// existence draw is pulled AHEAD of the centre jitter so the ~45% of cells with
// no crater cost one hash instead of five. This requires the loop NESTING to
// match the hash chain order, so dx is now outermost. That reorders the `h +=`
// accumulation and is therefore not bit-preserving on its own; the hoist itself
// is proven bit-identical against a verbatim unhoisted reference at the same
// nesting in `crater_hoist_is_bit_identical`.
inline double craterField(uint64_t seed, const Vec3& dir, double freq) {
  const Vec3 p = dir * freq;
  const double fx = std::floor(p.x), fy = std::floor(p.y), fz = std::floor(p.z);
  const int cx = static_cast<int>(fx), cy = static_cast<int>(fy),
            cz = static_cast<int>(fz);
  const uint64_t base = mix64(seed ^ 0xC0FFEEull);
  double h = 0.0;
  for (int dx = -1; dx <= 1; ++dx) {
    const uint64_t hx =
        hashCombine(base, static_cast<uint64_t>(static_cast<int64_t>(cx + dx)));
    for (int dy = -1; dy <= 1; ++dy) {
      const uint64_t hxy =
          hashCombine(hx, static_cast<uint64_t>(static_cast<int64_t>(cy + dy)));
      for (int dz = -1; dz <= 1; ++dz) {
        const uint64_t cell = hashCombine(
            hxy, static_cast<uint64_t>(static_cast<int64_t>(cz + dz)));
        // Existence first: a cell with no crater must not pay for a centre.
        if (hashToUnit(hashCombine(cell, 4)) > kCraterExistMax) continue;
        // Jittered crater centre within the cell.
        const Vec3 centre(fx + dx + hashToUnit(hashCombine(cell, 1)),
                          fy + dy + hashToUnit(hashCombine(cell, 2)),
                          fz + dz + hashToUnit(hashCombine(cell, 3)));
        const Vec3 d = p - centre;
        const double dist = d.length();
        const double cr =
            kCraterRadiusMin + kCraterRadiusSpan * hashToUnit(hashCombine(cell, 5));
        if (dist > cr * kCraterReach) continue;
        h += craterProfile(dist / cr);
      }
    }
  }
  return h;
}

// CONFINED crater field (WG-141): exactly one candidate crater per lattice cell,
// jittered so that the whole profile INCLUDING its rim fits inside that cell.
// That makes a ONE-cell lookup exact where craterField needs twenty-seven, which
// is the entire reason the fine rungs of the crater ladder are affordable: a
// confined rung costs about one twelfth of a full rung.
//
// The price is that craters on a single rung can neither overlap nor cross a
// cell boundary, which on its own would read as a lattice. The ladder pays it
// back, because four confined rungs at 3x frequency ratios overlap EACH OTHER
// and sit under three full rungs, so no one lattice is legible. This is a
// deliberate trade and the picture is the arbiter, not this comment.
inline double craterFieldConfined(uint64_t seed, const Vec3& dir, double freq) {
  const Vec3 p = dir * freq;
  const double fx = std::floor(p.x), fy = std::floor(p.y), fz = std::floor(p.z);
  uint64_t cell = mix64(seed ^ 0xC7A7E812ull);
  cell = hashCombine(cell, static_cast<uint64_t>(static_cast<int64_t>(static_cast<int>(fx))));
  cell = hashCombine(cell, static_cast<uint64_t>(static_cast<int64_t>(static_cast<int>(fy))));
  cell = hashCombine(cell, static_cast<uint64_t>(static_cast<int64_t>(static_cast<int>(fz))));
  if (hashToUnit(hashCombine(cell, 4)) > 0.62) return 0.0;
  // Radius small enough that bowl + rim fit within the cell: cr * kCraterReach
  // is the half-extent, so 2 * cr * kCraterReach must be under 1.
  const double cr = 0.10 + 0.18 * hashToUnit(hashCombine(cell, 5));  // <= 0.28
  const double half = cr * kCraterReach;                             // <= 0.448
  const double span = 1.0 - 2.0 * half;
  const Vec3 centre(fx + half + span * hashToUnit(hashCombine(cell, 1)),
                    fy + half + span * hashToUnit(hashCombine(cell, 2)),
                    fz + half + span * hashToUnit(hashCombine(cell, 3)));
  const double dist = (p - centre).length();
  if (dist > half) return 0.0;
  return craterProfile(dist / cr);
}

// =============================================================================
// §2 — SampleHeightField(bodySeed, dir): metres of relief. PURE & POSITION-
// HASHED (WG-6). The SAME (bodySeed, dir) always returns the SAME bits.
//
// `dir` is canonicalised through the cube-face seam rule BEFORE sampling, but
// because the sampler operates directly on the dir vector (not on face/uv),
// callers that already pass a canonical lattice dir get identical results.
// =============================================================================
// -----------------------------------------------------------------------------
// WG-25: the planet noise stack.
//
// WAVELENGTHS. `dir` is a unit vector, so `dir * f` puts one noise lattice cell
// every 1/f radians, i.e. every radiusM/f metres of ARC. On Forge (R = 600 km)
// frequency f therefore has a feature size of 600000/f metres. That one line is
// the whole diagnosis of the old stack: its highest frequency was 320 (fbm 80,
// 3 octaves), a 1.9 km feature at roughly 30 m of amplitude. Below ~2 km the old
// field had NO content whatsoever, so at the player's 1.8 m terrain LOD the
// ground was an exact plane and a "mountain" was a 30 km dome, a 3% grade,
// which is why they read as rounded lumps rather than mountains.
//
// The stack below spans 240 km down to 60 m:
//   warp   f=3.0            200 km        domain warp vector  (3 calls)
//   L0     f=2.5 .. 20      240..30 km    continents          (4 calls)
//   L1     f=24 .. 6144      25 km..98 m  ridged massifs      (9 calls)
//   L2     f=2500 .. 10000  240..60 m     ground detail       (3 calls)
// 19 valueNoise calls against the old 11. That is under 2x on the RAW sampler,
// and biome.h's sampleDesignedHeight, the surface everything actually consumes
//: gets FASTER, because it used to evaluate this field three times per vertex.
//
// AMPLITUDE CALIBRATION. For an fBm-like stack with lacunarity 2 and gain 0.5,
// every octave contributes the SAME local grade, so the RMS grade of a layer is
// about sqrt(octaves) * A * f0 / radiusM, where A is the layer's total metre
// amplitude and f0 its base frequency. That closed form is how the numbers below
// were chosen rather than guessed: L1 lands near 40% grade in a full massif
// (a real 22-degree mountainside) and L2 near 8% underfoot.
//
// The sea-level CLAMP is gone. It forced every ocean pixel to exactly the datum,
// which meant biome.h had to invent a basin depth out of a separate fBm, which
// in turn put a ~1.2 km VERTICAL WALL on every coastline. Letting the field go
// negative on its own gives a continuous shore and costs nothing.
inline double sampleHeightFieldPlanet(const BodyParams& body, const Vec3& dir) {
  // L0: continents. Unchanged frequency/octaves: the landmass layout is the one
  // part of the old field that was doing its job.
  const double L0 = fbm(body.bodySeed, dir, 2.5, 4, 11);
  // OROGENY MASK: where mountains are allowed to grow. The old `max(0, L0)`
  // put a slope KINK exactly on the shoreline; a smoothstep over a WIDE band of
  // L0 does two jobs instead: it removes the kink, and it confines the massifs
  // to high continental interiors so coasts get plains and the planet does not
  // come out 100% mountain range.
  const double uplift = smoothstep(0.10, 0.62, L0);
  // L1: domain-warped ridged massifs. The warp amplitude (0.018 rad ~ 10.8 km)
  // is deliberately just under one L1 lattice cell: enough to bend and braid the
  // ranges, not so much that it dissolves them.
  const Vec3 wd = domainWarp(body.bodySeed, dir, 3.0, 0.018, 0x57A1u);
  const double L1 = ridgedMF(body.bodySeed, wd, 24.0, 9, 23,
                             /*lacunarity*/ 2.0, /*gain*/ 0.50,
                             /*weightGain*/ 2.0);
  // L2: ground detail. THE layer the player sees underfoot; the old stack had
  // nothing at all in this band. Small in absolute metres (about 12 m across the
  // whole layer) but its top wavelength is 300 m, so it reads as an ~8% local
  // grade: rough natural ground rather than a polished plane.
  const double L2 = fbm(body.bodySeed, dir, 2500.0, 3, 37);
  double h = L0 * 0.58 + uplift * L1 * 0.52 + L2 * 0.0021;
  h *= body.maxReliefM;
  return h;
}

// -----------------------------------------------------------------------------
// WG-141: the moon noise stack.
//
// THE DIAGNOSIS, and it is WG-25's diagnosis one body later. The stack this
// replaces was the spike-era original and it was never revisited when the planet
// was. On Cinder (R = 200 km) a frequency f has a feature size of 200000/f
// metres of arc, and an N-octave fbm at lacunarity 2 tops out at f * 2^(N-1):
//   M0  fbm f=3, 3 oct    top f 12    16.7 km    amplitude 1600 m
//   M1  craterField f=9   cell 22.2 km           craters 13 to 33 km across
//   M2  fbm f=90, 2 oct   top f 180   1.11 km    amplitude 120 m
// BELOW 1.11 km THE FIELD HAD NO CONTENT AT ALL. The smallest landform on the
// entire moon was a kilometre wide, so a player standing on Cinder saw smooth
// grey rolling ground and could not have walked into a single crater. Craters
// are the whole character of an airless body, and at human scale there were
// none. That is not a moon, it is a grey planet.
//
// THE LADDER. Craters are scale-free in two ways that a single noise layer
// cannot express: the production population goes roughly as N(>D) ~ D^-2, and
// simple craters hold a near-constant depth-to-diameter ratio around 0.12. A
// GEOMETRIC LADDER of crater rungs reproduces both at once. Tripling the
// frequency shrinks the cell to a third, which puts NINE times as many craters
// per unit surface area at a third of the diameter, and thirding the amplitude
// alongside holds the depth ratio fixed. Eight rungs span 28 km down to 5.5 m.
//
// Amplitudes are chosen from the ratio, not guessed. craterProfile spans 1.5
// units floor-to-crest, so a layer amplitude A yields a crater 1.5A deep; for a
// full rung the mean crater is 0.925 cells across and for a confined rung 0.38,
// giving A = (0.12 / 1.5) * 0.925 * R/f = 14800/f and A = 6080/f respectively.
// Those two closed forms are where every crater number below comes from, and
// they are why the ladder is self-similar: every rung has the same wall grade.
//
// THE DICHOTOMY. The one thing that makes a moon read as a moon in a wide shot
// is mare against highland: dark smooth flooded plain against bright rough
// crater-saturated upland. `mare` is a low-frequency mask BIASED INTO THE BASINS
// the big rungs dig, because that is where lava actually ponded. It lowers the
// ground and it suppresses the fine rungs, since a flooded surface is young and
// its small craters are buried. It also finally makes the three moon biome names
// in biome.h mean something a classifier can see.
//
// EJECTA RAYS ARE DELIBERATELY ABSENT FROM THIS FIELD. Real rays are albedo, not
// topography: they are bright dust lying flat on the ground. Putting them in the
// height field would be a lie that also costs a transcendental. They are routed
// to rendering as a material ask instead.
inline double sampleHeightFieldMoon(const BodyParams& body, const Vec3& dir) {
  const uint64_t s = body.bodySeed;

  // Base relief: broad rises and basins, 80 km down to 10 km.
  const double base = fbm(s, dir, 2.5, 4, 41) * 1200.0;

  // The two coarse rungs are the BASINS, so they are computed first: the mare
  // mask needs to know where the ground is already low.
  const double c0 = craterField(s, dir, 9.0)   * 1644.0;   // 13.3 to 27.8 km
  const double c1 = craterField(s, dir, 27.0)  * 548.0;    // 4.44 to 9.26 km
  const double big = c0 + c1;

  // MARE. A low-frequency field gated into the basins: `basinGate` is 1 deep
  // inside a big crater and 0 on open highland, and the mask keeps a little
  // presence outside so the maria are not perfect discs of the rungs above.
  const double mareN = fbm(s, dir, 2.0, 3, 61);
  const double basinGate = 1.0 - smoothstep(-800.0, 0.0, big);
  const double mare = smoothstep(0.02, 0.26, mareN) * (0.35 + 0.65 * basinGate);
  // Fine craters survive on highland and are buried by the flood in the mare.
  const double young = 1.0 - 0.72 * mare;

  // The fine rungs. Full-neighbourhood down to 494 m, then CONFINED, which is
  // what makes eight rungs cost about what three would have.
  const double c2 = craterField(s, dir, 81.0)   * 183.0;   // 1.48 to 3.09 km
  const double c3 = craterField(s, dir, 243.0)  * 60.9;    // 494 m to 1.03 km
  const double c4 = craterFieldConfined(s, dir, 270.0)   * 22.5;  // 148 to 415 m
  const double c5 = craterFieldConfined(s, dir, 810.0)   * 7.51;  // 49 to 138 m
  const double c6 = craterFieldConfined(s, dir, 2430.0)  * 2.50;  // 16.5 to 46 m
  const double c7 = craterFieldConfined(s, dir, 7290.0)  * 0.834; // 5.5 to 15.4 m
  // The bottom rung earns its place on a MEASUREMENT, not on symmetry: without
  // it the median curvature over a 4 m baseline is 0.0204 m against a 0.020 m
  // floor, i.e. the ladder passed its own feature test by 2%. Small craters are
  // also the rung a player standing still actually looks at. The terrain mesh
  // resolves about 0.6 m per vertex at maxDepth on this body, so this is the
  // last rung that is not mostly aliased away.
  const double c8 = craterFieldConfined(s, dir, 21870.0) * 0.278; // 1.8 to 5.1 m

  // Regolith roll: the layer underfoot, 240 m down to 60 m. Small in absolute
  // metres but it is what stops the ground between craters being a polished
  // plane. 10 m over an 833 base frequency reads as a ~7% local grade.
  const double rego = fbm(s, dir, 833.0, 3, 53) * 10.0;

  return base - mare * 800.0 + big
       + (c2 + c3 + c4 + c5 + c6 + c7 + c8) * young + rego;
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
