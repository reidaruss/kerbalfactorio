// =============================================================================
// terrain_probe.cpp: world-gen DIAGNOSTIC tool. A pure CONSUMER of of_core
// (like lod_probe / procgen_bench; not a ctest). It answers, with numbers,
// "where does the height field actually have detail, and where is it a plane?".
//
//  1 PATCH STATS      min/max/mean over a 6 km patch at the start point, the
//                     nearest mountain, and the nearest plains.
//  2 SLOPE SPECTRUM   the |dh| distribution between horizontally adjacent
//                     samples at 2 m / 10 m / 100 m / 1 km. A field that is
//                     locally a PLANE gives p50 == p90 == max; real content
//                     spreads the distribution. That ratio is the tell.
//  3 WAVELENGTH SWEEP RMS neighbour difference vs spacing, 1 m to 10 km. Below
//                     the shortest wavelength present the RMS falls LINEARLY
//                     with spacing, so the RMS/spacing column goes flat. That
//                     plateau is the smoking gun.
//  4 PLANETARY RELIEF raw + designed extremes and a per-biome histogram.
//  5 COST             measured valueNoise calls per sample, and verts/sec.
//  6 FLAT PAD         worst height step over a 4 m span inside the pad, the max
//                     blend-annulus slope against the natural slope of the same
//                     ground, and the radius past which the pad provably stops
//                     perturbing the field (uint64 bit compare).
//
// Sections 1 to 3 sample designedHeightNoPad, NOT sampleDesignedHeight, so the
// terrain numbers are not contaminated by the home pad; section 6 measures the
// pad. Usage: terrain_probe [--seed <hex|dec>] [--pad flat,blend]
// =============================================================================
#define OF_NOISE_COUNT 1

#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <vector>

#include "of/vec3.h"
#include "of/cubed_sphere.h"
#include "of/biome.h"

using namespace of;
using namespace of::worldgen;

namespace {

constexpr double kDeg = 3.14159265358979323846 / 180.0;
constexpr double kHomeLatDeg = 2.0, kHomeLonDeg = 144.0;

static uint64_t asBits(double d) {
  uint64_t u; std::memcpy(&u, &d, sizeof(u)); return u;
}

// A local tangent frame at a unit dir: east/north orthonormal to it.
struct Frame { Vec3 c, east, north; };

Frame frameAt(const Vec3& c) {
  Vec3 up(0, 1, 0);
  if (std::fabs(c.y) > 0.99) up = Vec3(1, 0, 0);
  Vec3 e(up.y * c.z - up.z * c.y, up.z * c.x - up.x * c.z,
         up.x * c.y - up.y * c.x);
  e = e * (1.0 / e.length());
  return Frame{c, e, Vec3(c.y * e.z - c.z * e.y, c.z * e.x - c.x * e.z,
                          c.x * e.y - c.y * e.x)};
}

// Point (dx, dy) metres from the frame origin, gnomonic (error < 3 cm at 3 km).
Vec3 offsetDir(const Frame& f, double R, double dx, double dy) {
  const double a = dx / R, b = dy / R;
  Vec3 p(f.c.x + a * f.east.x + b * f.north.x,
         f.c.y + a * f.east.y + b * f.north.y,
         f.c.z + a * f.east.z + b * f.north.z);
  return p * (1.0 / p.length());
}

struct Dist { double mean = 0, rms = 0, p50 = 0, p90 = 0, p99 = 0, max = 0; };

Dist distOf(std::vector<double>& v) {
  Dist d;
  if (v.empty()) return d;
  double s = 0, s2 = 0;
  for (double x : v) { s += x; s2 += x * x; }
  d.mean = s / v.size();
  d.rms = std::sqrt(s2 / v.size());
  std::sort(v.begin(), v.end());
  d.p50 = v[v.size() / 2];  d.p90 = v[(v.size() * 9) / 10];
  d.p99 = v[(v.size() * 99) / 100];  d.max = v.back();
  return d;
}

const char* biomeName(Biome b) {
  static const char* kNames[] = {"Ocean", "Beach", "Plains", "Forest", "Hills",
                                 "Mountains", "Polar", "Regolith",
                                 "MoonHighland", "CraterFloor", "Unknown"};
  const int i = static_cast<int>(b);
  return (i >= 0 && i < 11) ? kNames[i] : "Unknown";
}

// --- 1 + 2: patch stats and slope spectrum -----------------------------------
void probePatch(const BodyParams& body, const char* label, const Vec3& centre) {
  const Frame f = frameAt(centre);
  const double R = body.radiusM;
  std::printf("\n## patch: %s  (biome %s)\n", label,
              biomeName(biomeAt(body, centre)));

  // 6 km x 6 km at 30 m spacing (201 x 201 = 40401 samples).
  const int N = 201;
  const double step = 6000.0 / (N - 1);
  double mn = 1e300, mx = -1e300, sum = 0;
  for (int j = 0; j < N; ++j)
    for (int i = 0; i < N; ++i) {
      const double h = designedHeightNoPad(
          body, offsetDir(f, R, (i - N / 2) * step, (j - N / 2) * step));
      mn = std::min(mn, h); mx = std::max(mx, h); sum += h;
    }
  std::printf("   6 km grid (201x201, %.0f m spacing): min %10.2f  max %10.2f  "
              "mean %10.2f  relief %8.2f m\n"
              "   slope spectrum (|dh| between horizontally adjacent samples)\n"
              "   | spacing |   mean |    rms |    p50 |    p90 |    p99 |    "
              "max |  mean grade |   max grade |\n",
              step, mn, mx, sum / (N * N), mx - mn);
  const double spacings[] = {2.0, 10.0, 100.0, 1000.0};
  for (double s : spacings) {
    const int M = 200;
    std::vector<double> dh;
    dh.reserve(M * M);
    for (int j = 0; j < M; ++j) {
      double prev = designedHeightNoPad(
          body, offsetDir(f, R, (0 - M / 2) * s, (j - M / 2) * s));
      for (int i = 1; i < M; ++i) {
        const double h = designedHeightNoPad(
            body, offsetDir(f, R, (i - M / 2) * s, (j - M / 2) * s));
        dh.push_back(std::fabs(h - prev));
        prev = h;
      }
    }
    const Dist d = distOf(dh);
    std::printf("   | %7.0f | %6.3f | %6.3f | %6.3f | %6.3f | %6.3f | %6.2f |"
                " %10.3f%% | %10.2f%% |\n",
                s, d.mean, d.rms, d.p50, d.p90, d.p99, d.max,
                100.0 * d.mean / s, 100.0 * d.max / s);
  }
}

// --- 3: shortest wavelength present ------------------------------------------
void probeWavelength(const BodyParams& body, const Vec3& centre,
                     const char* label) {
  const double R = body.radiusM;
  std::printf("\n## wavelength sweep at %s: RMS |h(p+s) - h(p)| vs spacing s\n"
              "   (RMS/s CONSTANT as s falls => NO content below that scale; "
              "RMS/s RISING as s falls => content present)\n"
              "   | spacing s |    rms dh |  rms/s (grade) |\n", label);
  const double spacings[] = {1, 2, 5, 10, 20, 50, 100, 200, 500,
                             1000, 2000, 5000, 10000};
  const int K = 3000;
  // A deterministic scatter of base points inside a 40 km cap around `centre`.
  std::vector<Vec3> base;
  std::vector<Frame> frames;
  base.reserve(K);
  const Frame cf = frameAt(centre);
  for (int i = 0; i < K; ++i) {
    const Vec3 p = offsetDir(cf, R,
        hashToSigned(mix64(uint64_t(i) * 2u + 1u)) * 20000.0,
        hashToSigned(mix64(uint64_t(i) * 2u + 2u)) * 20000.0);
    base.push_back(p);
    frames.push_back(frameAt(p));
  }
  for (double s : spacings) {
    double s2 = 0;
    for (int i = 0; i < K; ++i) {
      const double h0 = designedHeightNoPad(body, base[i]);
      const double h1 = designedHeightNoPad(body, offsetDir(frames[i], R, s, 0));
      s2 += (h1 - h0) * (h1 - h0);
    }
    const double rms = std::sqrt(s2 / K);
    std::printf("   | %9.0f | %9.5f | %13.5f%% |\n", s, rms, 100.0 * rms / s);
  }
}

// --- 4: planetary relief ------------------------------------------------------
void probePlanetary(const BodyParams& body) {
  const int N = 2000;
  double mn = 1e300, mx = -1e300, sum = 0;
  struct Bin { int n = 0; double mn = 1e300, mx = -1e300, sum = 0; };
  Bin bins[static_cast<int>(Biome::COUNT)];
  for (int i = 0; i < N; ++i) {
    const Vec3 d = fibonacciDir(i, N);
    const double h = sampleDesignedHeight(body, d);
    mn = std::min(mn, h); mx = std::max(mx, h); sum += h;
    Bin& b = bins[static_cast<int>(biomeAt(body, d))];
    ++b.n; b.mn = std::min(b.mn, h); b.mx = std::max(b.mx, h); b.sum += h;
  }
  // RAW extremes over a much denser sample: world_gen_tests asserts
  // |raw| <= maxReliefM + 1, so this is the guard on that invariant.
  double rmn = 1e300, rmx = -1e300;
  for (int i = 0; i < 200000; ++i) {
    const double h = sampleHeightField(body, fibonacciDir(i, 200000));
    rmn = std::min(rmn, h); rmx = std::max(rmx, h);
  }
  std::printf("\n## planetary relief (2000-pt Fibonacci, designed height)\n"
              "   RAW  over 200k pts: min %10.2f   max %10.2f   "
              "(|h| must stay <= maxRelief+1 = %.0f)\n"
              "   min %10.2f   max %10.2f   mean %10.2f   span %10.2f m\n"
              "   | biome        |    n |   pct |       min |       max |"
              "      mean |\n",
              rmn, rmx, body.maxReliefM + 1.0, mn, mx, sum / N, mx - mn);
  for (int i = 0; i < static_cast<int>(Biome::COUNT); ++i) {
    if (bins[i].n == 0) continue;
    std::printf("   | %-12s | %4d | %4.1f%% | %9.1f | %9.1f | %9.1f |\n",
                biomeName(static_cast<Biome>(i)), bins[i].n,
                100.0 * bins[i].n / N, bins[i].mn, bins[i].mx,
                bins[i].sum / bins[i].n);
  }
}

// --- 5: cost ------------------------------------------------------------------
void probeCost(const BodyParams& body, const Vec3& centre) {
  const Frame f = frameAt(centre);
  const double R = body.radiusM;
  std::printf("\n## cost\n");
  // Measured well OUTSIDE the home pad: inside it sampleDesignedHeight
  // legitimately evaluates the field twice (sample + pad centre).
  const Vec3 far = offsetDir(f, R, 60000.0, 40000.0);
  uint64_t n[5];
  n[0] = noiseCalls(); sampleHeightField(body, far);
  n[1] = noiseCalls(); sampleDesignedHeight(body, far);
  n[2] = noiseCalls(); biomeAt(body, far);
  n[3] = noiseCalls(); sampleDesignedHeight(body, body.homeDir);
  n[4] = noiseCalls();
  std::printf("   valueNoise calls/sample: sampleHeightField=%llu  biomeAt=%llu"
              "  sampleDesignedHeight=%llu  (inside pad=%llu)\n",
              (unsigned long long)(n[1] - n[0]), (unsigned long long)(n[3] - n[2]),
              (unsigned long long)(n[2] - n[1]), (unsigned long long)(n[4] - n[3]));

  // verts/sec through both samplers. Sampled around `far`, NOT the pad centre:
  // inside the pad sampleDesignedHeight legitimately evaluates the field twice,
  // and a timing grid straddling the blend radius reports a blend of the two.
  const Frame ff = frameAt(far);
  const int M = 350;  // 122500 samples
  std::vector<Vec3> dirs;
  dirs.reserve(M * M);
  for (int j = 0; j < M; ++j)
    for (int i = 0; i < M; ++i)
      dirs.push_back(offsetDir(ff, R, (i - M / 2) * 2.0, (j - M / 2) * 2.0));
  static volatile double sink = 0;   // keeps the sampler from being optimized out
  for (int which = 0; which < 2; ++which) {
    double best = 1e300;
    for (int rep = 0; rep < 3; ++rep) {
      const auto t0 = std::chrono::high_resolution_clock::now();
      double acc = 0;
      for (const Vec3& d : dirs)
        acc += which ? sampleDesignedHeight(body, d) : sampleHeightField(body, d);
      best = std::min(best, std::chrono::duration<double>(
          std::chrono::high_resolution_clock::now() - t0).count());
      sink = acc;
      (void)sink;
    }
    std::printf("   %-22s %10.0f verts/sec   (%.3f us/vert)\n",
                which ? "sampleDesignedHeight" : "sampleHeightField (raw)",
                dirs.size() / best, best / dirs.size() * 1e6);
  }
}

// --- 6: the flat home pad -----------------------------------------------------
void probePad(const BodyParams& body) {
  std::printf("\n## home flat pad\n");
  if (body.homeFlatRadiusM <= 0.0) {
    std::printf("   (disabled: homeFlatRadiusM = 0)\n");
    return;
  }
  const Vec3 c = body.homeDir;
  const Frame f = frameAt(c);
  const double R = body.radiusM;
  const double h0 = sampleDesignedHeight(body, c);
  std::printf("   flat radius %.1f m, blend radius %.1f m, pad height %.3f m\n",
              body.homeFlatRadiusM, body.homeBlendRadiusM, h0);

  // Worst height step over a 4 m span (the DW-32 structural module) inside the
  // flat radius, checked on a dense grid in x, y and both diagonals.
  double worst4 = 0.0, worstAbs = 0.0;
  const double lim = body.homeFlatRadiusM;
  const double d[4][2] = {{4, 0}, {0, 4}, {2.828, 2.828}, {2.828, -2.828}};
  for (double y = -lim; y <= lim; y += 0.5)
    for (double x = -lim; x <= lim; x += 0.5) {
      if (x * x + y * y > lim * lim) continue;
      const double h = sampleDesignedHeight(body, offsetDir(f, R, x, y));
      worstAbs = std::max(worstAbs, std::fabs(h - h0));
      for (auto& o : d) {
        const double nx = x + o[0], ny = y + o[1];
        if (nx * nx + ny * ny > lim * lim) continue;
        worst4 = std::max(worst4, std::fabs(
            sampleDesignedHeight(body, offsetDir(f, R, nx, ny)) - h));
      }
    }
  std::printf("   worst height step over a 4 m span INSIDE the pad: %.6f m\n"
              "   worst deviation from pad centre height        : %.6f m\n",
              worst4, worstAbs);

  // Max radial slope in the blend annulus, alongside the NATURAL slope over the
  // same ground, so "is the ramp a cliff" is answered against the right baseline.
  double maxGrade = 0.0, atR = 0.0, natAtMax = 0.0, maxNat = 0.0;
  for (double r = body.homeFlatRadiusM; r <= body.homeBlendRadiusM + 20.0; ++r)
    for (int a = 0; a < 180; ++a) {
      const double ca = std::cos(a * 2.0 * kDeg), sa = std::sin(a * 2.0 * kDeg);
      const Vec3 da = offsetDir(f, R, r * ca, r * sa);
      const Vec3 db = offsetDir(f, R, (r + 1.0) * ca, (r + 1.0) * sa);
      const double g = std::fabs(sampleDesignedHeight(body, db) -
                                 sampleDesignedHeight(body, da));
      const double nat = std::fabs(designedHeightNoPad(body, db) -
                                   designedHeightNoPad(body, da));
      if (nat > maxNat) maxNat = nat;
      if (g > maxGrade) { maxGrade = g; atR = r; natAtMax = nat; }
    }
  std::printf("   max slope in the blend annulus: %.4f m/m (%.2f%% grade, "
              "%.1f deg) at r = %.0f m\n"
              "   natural slope over the SAME ground: %.2f%% there, %.2f%% worst"
              " => pad adds %.2f pct-pt\n",
              maxGrade, maxGrade * 100.0, std::atan(maxGrade) / kDeg, atR,
              natAtMax * 100.0, maxNat * 100.0, (maxGrade - natAtMax) * 100.0);

  // The radius at which the pad provably stops perturbing the field (bit compare
  // against the same body with the pad disabled).
  BodyParams noPad = body;
  noPad.homeFlatRadiusM = 0.0; noPad.homeBlendRadiusM = 0.0;
  double firstClean = -1.0;
  for (double r = 1.0; r <= body.homeBlendRadiusM + 200.0 && firstClean < 0; ++r) {
    bool clean = true;
    for (int a = 0; a < 360 && clean; ++a) {
      const Vec3 d =
          offsetDir(f, R, r * std::cos(a * kDeg), r * std::sin(a * kDeg));
      clean = asBits(sampleDesignedHeight(body, d)) ==
              asBits(sampleDesignedHeight(noPad, d));
    }
    if (clean) firstClean = r;
  }
  std::printf("   BIT-IDENTICAL to the un-padded field from r = %.0f m outward"
              " (blend radius %.0f m)\n", firstClean, body.homeBlendRadiusM);
}

// One scan of the cap around `centre`: the highest-relief Mountains dir (falling
// back to the highest relief of any biome) and the NEAREST Plains dir. Plains is
// the ground the player walks on for most of the game and is the case a
// mountain-only probe would never show.
struct Sites { Vec3 peak, plains; bool foundMountain = false; };
Sites findSites(const BodyParams& body, const Vec3& centre, double capM) {
  const Frame f = frameAt(centre);
  const double R = body.radiusM;
  Sites s{centre, centre, false};
  double bestM = -1e300, bestAny = -1e300, nearest = 1e300;
  Vec3 outAny = centre;
  const int N = 400;
  const double st = 2.0 * capM / N;
  for (int j = 0; j <= N; ++j)
    for (int i = 0; i <= N; ++i) {
      const double x = -capM + i * st, y = -capM + j * st, d2 = x * x + y * y;
      if (d2 > capM * capM) continue;
      const Vec3 d = offsetDir(f, R, x, y);
      const double h = designedHeightNoPad(body, d);
      const Biome b = biomeAt(body, d);
      if (h > bestAny) { bestAny = h; outAny = d; }
      if (b == Biome::Mountains && h > bestM) { bestM = h; s.peak = d; }
      if (b == Biome::Plains && d2 < nearest) { nearest = d2; s.plains = d; }
    }
  s.foundMountain = bestM > -1e299;
  if (!s.foundMountain) s.peak = outAny;
  return s;
}

}  // namespace

int main(int argc, char** argv) {
  uint64_t worldSeed = 0x0bf00d01ull;
  double padFlat = -1.0, padBlend = -1.0;
  for (int i = 1; i + 1 < argc; ++i) {
    if (std::strcmp(argv[i], "--seed") == 0)
      worldSeed = std::strtoull(argv[i + 1], nullptr, 0);
    if (std::strcmp(argv[i], "--pad") == 0)
      std::sscanf(argv[i + 1], "%lf,%lf", &padFlat, &padBlend);
  }

  BodyParams forge = makeForge(worldSeed);
  if (padFlat >= 0.0) { forge.homeFlatRadiusM = padFlat;
                        forge.homeBlendRadiusM = padBlend; }
  const Vec3 home = latLonToDir(kHomeLatDeg * kDeg, kHomeLonDeg * kDeg);

  std::printf("=== terrain_probe: Forge R=%.0f km, worldSeed 0x%llx, "
              "bodySeed 0x%llx ===\n"
              "home lat %.1f lon %.1f -> dir (%.17g, %.17g, %.17g)\n"
              "home raw %.2f m, designed %.2f m, biome %s\n",
              forge.radiusM / 1000.0, (unsigned long long)worldSeed,
              (unsigned long long)forge.bodySeed, kHomeLatDeg, kHomeLonDeg,
              home.x, home.y, home.z, sampleHeightField(forge, home),
              sampleDesignedHeight(forge, home),
              biomeName(biomeAt(forge, home)));

  const Sites sites = findSites(forge, home, 200000.0);
  double plat, plon; dirToLatLon(sites.peak, plat, plon);
  std::printf("peak within 200 km: lat %.3f lon %.3f, designed %.1f m, biome %s"
              " (Mountains found: %s)\n", plat / kDeg, plon / kDeg,
              designedHeightNoPad(forge, sites.peak),
              biomeName(biomeAt(forge, sites.peak)),
              sites.foundMountain ? "yes" : "NO, fell back to highest relief");

  probePatch(forge, "home (lat 2, lon 144)", home);
  probePatch(forge, "peak within 200 km", sites.peak);
  probePatch(forge, "nearest Plains", sites.plains);
  probeWavelength(forge, home, "home");
  probeWavelength(forge, sites.peak, "peak");
  probePlanetary(forge);
  probeCost(forge, home);
  probePad(forge);
  return 0;
}
