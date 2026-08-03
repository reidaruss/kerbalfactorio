// =============================================================================
// procgen_bench.cpp — micro-benchmark for the world-gen procedural hot path
// (a NEW consumer of of_core; not a ctest, a timed CONSUMER like render_scale_dump).
//
// The hot path is the per-vertex noise cost: generateQuadMesh -> sampleHeightField
// -> fbm/ridged/craterField -> valueNoise -> the integer position hash. This tool
// times generateQuadMesh over a batch of quads and reports VERTICES/SEC and
// QUADS/SEC for the OPTIMIZED sampler currently in cubed_sphere.h, alongside a
// self-contained REFERENCE implementation of the ORIGINAL noise stack so the
// speedup is measured in ONE binary (no cross-build bookkeeping) and the two are
// proven BIT-IDENTICAL on the same vertices.
//
// Determinism guard: every vertex height from the reference path and the optimized
// path is compared by raw uint64 bit-reinterpret. If a single bit differs the
// tool prints a MISMATCH and exits non-zero — the optimization is only valid if
// output bits are unchanged.
// =============================================================================
#include <cstdint>
#include <cstring>
#include <cmath>
#include <chrono>
#include <cstdio>
#include <vector>

#include "of/vec3.h"
#include "of/cubed_sphere.h"

using namespace of;
using namespace of::worldgen;

// -----------------------------------------------------------------------------
// REFERENCE (original) noise stack — a verbatim copy of the pre-optimization
// cubed_sphere.h sampler, kept here ONLY as the bit-identity oracle + the "before"
// timing. Namespaced `ref` so it cannot collide with the optimized production code.
// -----------------------------------------------------------------------------
namespace ref {

inline double valueNoise(uint64_t seed, const Vec3& p, uint64_t channel) {
  const double fx = std::floor(p.x), fy = std::floor(p.y), fz = std::floor(p.z);
  const int ix = static_cast<int>(fx), iy = static_cast<int>(fy),
            iz = static_cast<int>(fz);
  const double tx = fade(p.x - fx), ty = fade(p.y - fy), tz = fade(p.z - fz);

  auto corner = [&](int dx, int dy, int dz) -> double {
    uint64_t h = mix64(seed ^ (channel * 0x9E3779B97F4A7C15ull));
    h = hashCombine(h, static_cast<uint64_t>(static_cast<int64_t>(ix + dx)));
    h = hashCombine(h, static_cast<uint64_t>(static_cast<int64_t>(iy + dy)));
    h = hashCombine(h, static_cast<uint64_t>(static_cast<int64_t>(iz + dz)));
    return hashToSigned(h);
  };

  const double c000 = corner(0, 0, 0), c100 = corner(1, 0, 0);
  const double c010 = corner(0, 1, 0), c110 = corner(1, 1, 0);
  const double c001 = corner(0, 0, 1), c101 = corner(1, 0, 1);
  const double c011 = corner(0, 1, 1), c111 = corner(1, 1, 1);

  const double x00 = lerp(c000, c100, tx), x10 = lerp(c010, c110, tx);
  const double x01 = lerp(c001, c101, tx), x11 = lerp(c011, c111, tx);
  const double y0 = lerp(x00, x10, ty), y1 = lerp(x01, x11, ty);
  return lerp(y0, y1, tz);
}

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

inline double smoothstep(double e0, double e1, double x) {
  if (!(e1 > e0)) return x < e0 ? 0.0 : 1.0;
  double t = (x - e0) / (e1 - e0);
  if (t <= 0.0) return 0.0;
  if (t >= 1.0) return 1.0;
  return t * t * (3.0 - 2.0 * t);
}

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

inline Vec3 domainWarp(uint64_t seed, const Vec3& dir, double freq, double amp,
                       uint64_t channel) {
  const Vec3 p = dir * freq;
  return Vec3(dir.x + amp * valueNoise(seed, p, channel),
              dir.y + amp * valueNoise(seed, p, channel + 1u),
              dir.z + amp * valueNoise(seed, p, channel + 2u));
}


inline double sampleHeightFieldPlanetRef(const BodyParams& body, const Vec3& dir) {
  const double L0 = fbm(body.bodySeed, dir, 2.5, 4, 11);
  const double uplift = smoothstep(0.10, 0.62, L0);
  const Vec3 wd = domainWarp(body.bodySeed, dir, 3.0, 0.018, 0x57A1u);
  const double L1 = ridgedMF(body.bodySeed, wd, 24.0, 9, 23, 2.0, 0.50, 2.0);
  const double L2 = fbm(body.bodySeed, dir, 2500.0, 3, 37);
  double h = L0 * 0.58 + uplift * L1 * 0.52 + L2 * 0.0021;
  h *= body.maxReliefM;
  return h;
}
// WG-141 re-baseline: this tracks sampleHeightFieldMoon, exactly as the planet
// reference above tracks sampleHeightFieldPlanet. What the bench measures is
// unchanged, because ref::valueNoise is still the naive eight-chain version and
// every fbm below routes through it.
//
// The crater rungs call the REAL of::worldgen functions on purpose. Neither
// craterField nor craterFieldConfined contains a valueNoise call (they hash
// cells directly), so a local copy would measure nothing this bench is about and
// would be a third place to keep the ladder in sync. ref::craterField is gone
// for that reason; its cost now appears identically on both sides of the
// comparison, which is the honest way to time a part that did not change.
inline double sampleHeightFieldMoonRef(const BodyParams& body, const Vec3& dir) {
  const uint64_t s = body.bodySeed;
  const double base = fbm(s, dir, 2.5, 4, 41) * 1200.0;
  const double c0 = of::worldgen::craterField(s, dir, 9.0)  * 1644.0;
  const double c1 = of::worldgen::craterField(s, dir, 27.0) * 548.0;
  const double big = c0 + c1;
  const double mareN = fbm(s, dir, 2.0, 3, 61);
  const double basinGate = 1.0 - of::worldgen::smoothstep(-800.0, 0.0, big);
  const double mare =
      of::worldgen::smoothstep(0.02, 0.26, mareN) * (0.35 + 0.65 * basinGate);
  const double young = 1.0 - 0.72 * mare;
  const double c2 = of::worldgen::craterField(s, dir, 81.0)  * 183.0;
  const double c3 = of::worldgen::craterField(s, dir, 243.0) * 60.9;
  const double c4 = of::worldgen::craterFieldConfined(s, dir, 270.0)   * 22.5;
  const double c5 = of::worldgen::craterFieldConfined(s, dir, 810.0)   * 7.51;
  const double c6 = of::worldgen::craterFieldConfined(s, dir, 2430.0)  * 2.50;
  const double c7 = of::worldgen::craterFieldConfined(s, dir, 7290.0)  * 0.834;
  const double c8 = of::worldgen::craterFieldConfined(s, dir, 21870.0) * 0.278;
  const double rego = fbm(s, dir, 833.0, 3, 53) * 10.0;
  return base - mare * 800.0 + big
       + (c2 + c3 + c4 + c5 + c6 + c7 + c8) * young + rego;
}
inline double sampleHeightField(const BodyParams& body, const Vec3& dir) {
  return body.kind == kPlanet ? sampleHeightFieldPlanetRef(body, dir)
                              : sampleHeightFieldMoonRef(body, dir);
}

}  // namespace ref

// -----------------------------------------------------------------------------
static uint64_t asBits(double d) {
  uint64_t u;
  std::memcpy(&u, &d, sizeof(u));
  return u;
}

template <typename F>
static double timeQuads(const BodyParams& body,
                        const std::vector<FQuadKey>& keys, F sampler,
                        uint64_t& outChecksum, size_t& outVerts) {
  using clk = std::chrono::high_resolution_clock;
  uint64_t checksum = 0;
  size_t verts = 0;
  const auto t0 = clk::now();
  for (const FQuadKey& key : keys) {
    const int level = key.depth + kCellBits;
    const uint64_t baseIx = static_cast<uint64_t>(key.qx) << kCellBits;
    const uint64_t baseIy = static_cast<uint64_t>(key.qy) << kCellBits;
    for (int j = 0; j < kGridDim; ++j) {
      for (int i = 0; i < kGridDim; ++i) {
        const Vec3 dir =
            latticeDir(key.faceId, baseIx + i, baseIy + j, level);
        const double h = sampler(body, dir);
        checksum ^= asBits(h) + 0x9E3779B97F4A7C15ull + (checksum << 6) +
                    (checksum >> 2);
        ++verts;
      }
    }
  }
  const auto t1 = clk::now();
  outChecksum = checksum;
  outVerts = verts;
  return std::chrono::duration<double>(t1 - t0).count();
}

int main() {
  const BodyParams forge = makeForge(20260615ull);
  const BodyParams cinder = makeCinder(20260615ull);

  // A representative batch: a spread of depths/faces on both bodies.
  std::vector<FQuadKey> forgeKeys, cinderKeys;
  for (int f = 0; f < 6; ++f)
    for (int d = 2; d <= 6; ++d)
      for (uint32_t q = 0; q < (1u << d) && q < 4; ++q) {
        forgeKeys.push_back({forge.bodyId, f, d, q, q});
        cinderKeys.push_back({cinder.bodyId, f, d, q, q});
      }

  struct Run {
    const char* name;
    const BodyParams& body;
    const std::vector<FQuadKey>& keys;
  };
  Run runs[] = {{"Forge(planet)", forge, forgeKeys},
                {"Cinder(moon)", cinder, cinderKeys}};

  std::printf("=== procgen hot-path benchmark (generateQuadMesh sampler) ===\n");
  std::printf("GRID=%dx%d (%d verts/quad)\n\n", kGridDim, kGridDim,
              kGridDim * kGridDim);

  bool ok = true;
  const int reps = 4;
  for (const Run& r : runs) {
    uint64_t csRef = 0, csOpt = 0;
    size_t vRef = 0, vOpt = 0;
    double tRef = 1e9, tOpt = 1e9;
    // warm + best-of-reps (min time = least noise).
    for (int rep = 0; rep < reps; ++rep) {
      uint64_t c; size_t v;
      double t = timeQuads(r.body, r.keys,
                           [](const BodyParams& b, const Vec3& d) {
                             return ref::sampleHeightField(b, d);
                           },
                           c, v);
      if (t < tRef) { tRef = t; csRef = c; vRef = v; }
    }
    for (int rep = 0; rep < reps; ++rep) {
      uint64_t c; size_t v;
      double t = timeQuads(r.body, r.keys,
                           [](const BodyParams& b, const Vec3& d) {
                             return sampleHeightField(b, d);  // optimized prod
                           },
                           c, v);
      if (t < tOpt) { tOpt = t; csOpt = c; vOpt = v; }
    }
    const bool bitMatch = (csRef == csOpt) && (vRef == vOpt);
    if (!bitMatch) ok = false;
    const double vpsRef = vRef / tRef, vpsOpt = vOpt / tOpt;
    std::printf("%-14s  verts=%zu  quads=%zu\n", r.name, vOpt,
                r.keys.size());
    std::printf("   BEFORE (ref)  : %8.2f ms  %10.0f verts/sec\n", tRef * 1e3,
                vpsRef);
    std::printf("   AFTER  (opt)  : %8.2f ms  %10.0f verts/sec\n", tOpt * 1e3,
                vpsOpt);
    std::printf("   speedup       : %.2fx   bit-identical=%s (checksum %s)\n\n",
                tRef / tOpt, bitMatch ? "YES" : "NO",
                bitMatch ? "match" : "MISMATCH");
  }

  std::printf("%s\n", ok ? "OK: optimized output is BIT-IDENTICAL to reference."
                         : "FAIL: optimized output DIFFERS from reference!");
  return ok ? 0 : 1;
}
