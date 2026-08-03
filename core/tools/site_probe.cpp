// =============================================================================
// site_probe.cpp: world-gen DIAGNOSTIC tool (WG-200). A pure CONSUMER of
// of_core, like spawn_probe / terrain_probe; NOT a ctest.
//
// It answers one question with numbers: "where may a RUIN stand, and how much
// of the planet can hold one?".
//
// -----------------------------------------------------------------------------
// NAME THE FAILURE MODE BEFORE MEASURING IT (INSTRUMENTS.md, WG-146)
// -----------------------------------------------------------------------------
// "Do not put it on a cliff" is two different failures wearing one word, and
// the instrument that sees one is blind to the other:
//
//   (a) TILT. The whole footprint is a uniform grade. A 30 m building on an
//       11 degree slope has one edge 5.8 m in the air. A single-point slope
//       sample sees this, and it is what everybody reaches for.
//
//   (b) BROKEN GROUND. The mean plane is level and there is a 9 m step, a
//       ledge or a boulder crest INSIDE the footprint. A point slope at the
//       centre reads a healthy 3 degrees and the building still has a hole
//       under it. WG-146 is the same shape one level up: slope saturates on a
//       crater wall, so it could not tell "tilted" from "featured".
//
// So the instrument is a LEAST-SQUARES PLANE FIT over the footprint disc, which
// reports both and cannot conflate them:
//
//   tiltDeg    = angle of the fitted plane from local horizontal          -> (a)
//   residP95M  = p95 of |h - plane| over the disc samples                 -> (b)
//
// p95, not max: one sample landing on a boulder crest must not veto otherwise
// good ground, and WG-146's corollary is that a curvature-like quantity over
// real terrain is heavy-tailed, so a mean would pass on typical ground while a
// few percent of it was a wall. spanM (max - min raw) is ALSO printed, purely
// so the report can show that a span-only gate conflates the two: a 30 m disc
// at 11 degrees tilt and a 30 m disc with a 5.8 m step both read spanM 5.8.
//
// EVERY BASELINE IS STATED BY CONSTRUCTION. The disc radius IS the footprint
// radius, the ring spacing is r/3, and the path grades are reported at two
// stated arms. The same Cinder point reads 24.500 deg over 6 m and 26.627 over
// 1000 m, so a terrain angle with no baseline beside it is not a number.
//
// Sphere curvature over the disc is r^2/(2R): 0.00075 m at r = 30 m on Forge.
// Two thousandths of the residual budget, so the plane fit is not corrected for
// it; at r = 300 m it would be 0.075 m and it would have to be.
//
// -----------------------------------------------------------------------------
// HEIGHTS
// -----------------------------------------------------------------------------
// Sites are measured on `sampleDesignedHeight`, the shipped surface authority
// (WG-21), because that is the ground the ruin will actually sit on. It is
// compared against `designedHeightNoPad` at every candidate and the difference
// is reported: outside homeBlendRadiusM the two are BIT-IDENTICAL, so a
// non-zero padDelta is the tell that a candidate is standing inside the spawn
// pad's blend and is not natural ground. That comparison is a two-sided control
// on the instrument itself (nonzero inside the blend, bit-zero outside), not a
// decoration.
//
// Usage:
//   site_probe [--seed <hex|dec>] [--body forge|cinder] [--r <m>]
//              [--min <m>] [--max <m>] [--n <candidates>]
//              [--tilt <deg>] [--resid <m>] [--top <n>]
// =============================================================================
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <vector>

#include "of/vec3.h"
#include "of/cubed_sphere.h"
#include "of/biome.h"
#include "of/water_field.h"

using namespace of;
using namespace of::worldgen;
namespace water = of::worldgen::water;

namespace {

constexpr double kPi = 3.14159265358979323846;
constexpr double kDeg = kPi / 180.0;
constexpr uint64_t kDefaultWorldSeed = 0x0bf00d01ull;

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

// Point (dx, dy) metres from the frame origin, gnomonic. Error is r^3/(3R^2):
// 3e-9 m at 30 m, 1.4e-4 m at 1200 m on Forge. Below every threshold here.
Vec3 offsetDir(const Frame& f, double R, double dx, double dy) {
  const double a = dx / R, b = dy / R;
  Vec3 p(f.c.x + a * f.east.x + b * f.north.x,
         f.c.y + a * f.east.y + b * f.north.y,
         f.c.z + a * f.east.z + b * f.north.z);
  return p * (1.0 / p.length());
}

double arcM(const Vec3& a, const Vec3& b, double R) {
  double d = a.x * b.x + a.y * b.y + a.z * b.z;
  if (d > 1.0) d = 1.0;
  if (d < -1.0) d = -1.0;
  return std::acos(d) * R;
}

const char* biomeName(Biome b) {
  static const char* kNames[] = {"Ocean", "Beach", "Plains", "Forest", "Hills",
                                 "Mountains", "Polar", "Regolith",
                                 "MoonHighland", "CraterFloor", "Unknown"};
  const int i = static_cast<int>(b);
  return (i >= 0 && i < 11) ? kNames[i] : "Unknown";
}

double pct(std::vector<double>& v, double p) {
  if (v.empty()) return 0.0;
  std::sort(v.begin(), v.end());
  double idx = p * (static_cast<double>(v.size()) - 1.0);
  size_t lo = static_cast<size_t>(idx);
  size_t hi = lo + 1 < v.size() ? lo + 1 : lo;
  double t = idx - static_cast<double>(lo);
  return v[lo] * (1.0 - t) + v[hi] * t;
}

// -----------------------------------------------------------------------------
// THE FOOTPRINT MEASUREMENT. Centre + 3 rings x 12 spokes = 37 samples over a
// disc of radius rM. Both numbers come out of ONE fit, so they cannot disagree
// about which samples they saw.
// -----------------------------------------------------------------------------
struct Foot {
  double tiltDeg = 0;
  double residP95M = 0;
  double residMaxM = 0;
  double spanM = 0;
  double hCentre = 0;
  double padDeltaM = 0;   // sampleDesignedHeight - designedHeightNoPad, centre
};

Foot footprintAt(const BodyParams& body, const Vec3& dir, double rM) {
  const Frame f = frameAt(dir);
  const double R = body.radiusM;
  double xs[37], ys[37], hs[37];
  int n = 0;
  xs[n] = 0; ys[n] = 0;
  hs[n] = sampleDesignedHeight(body, dir);
  ++n;
  for (int ring = 1; ring <= 3; ++ring) {
    const double rr = rM * (static_cast<double>(ring) / 3.0);
    for (int k = 0; k < 12; ++k) {
      const double a = (k / 12.0) * 2.0 * kPi + (ring & 1 ? 0.0 : kPi / 12.0);
      const double x = std::cos(a) * rr, y = std::sin(a) * rr;
      xs[n] = x; ys[n] = y;
      hs[n] = sampleDesignedHeight(body, offsetDir(f, R, x, y));
      ++n;
    }
  }
  // Least squares h = a x + b y + c. The ring layout is symmetric about the
  // centre so sum(x) = sum(y) = sum(xy) = 0 to rounding; the normal equations
  // are solved in full anyway rather than assuming it.
  double Sxx = 0, Syy = 0, Sxy = 0, Sx = 0, Sy = 0, S1 = 0;
  double Shx = 0, Shy = 0, Sh = 0;
  for (int i = 0; i < n; ++i) {
    Sxx += xs[i] * xs[i]; Syy += ys[i] * ys[i]; Sxy += xs[i] * ys[i];
    Sx += xs[i]; Sy += ys[i]; S1 += 1.0;
    Shx += hs[i] * xs[i]; Shy += hs[i] * ys[i]; Sh += hs[i];
  }
  const double m[3][3] = {{Sxx, Sxy, Sx}, {Sxy, Syy, Sy}, {Sx, Sy, S1}};
  const double rhs[3] = {Shx, Shy, Sh};
  // 3x3 Cramer.
  auto det3 = [](const double a[3][3]) {
    return a[0][0] * (a[1][1] * a[2][2] - a[1][2] * a[2][1])
         - a[0][1] * (a[1][0] * a[2][2] - a[1][2] * a[2][0])
         + a[0][2] * (a[1][0] * a[2][1] - a[1][1] * a[2][0]);
  };
  const double D = det3(m);
  double coef[3] = {0, 0, 0};
  if (std::fabs(D) > 1e-30) {
    for (int c = 0; c < 3; ++c) {
      double mc[3][3];
      for (int i = 0; i < 3; ++i) for (int j = 0; j < 3; ++j)
        mc[i][j] = (j == c) ? rhs[i] : m[i][j];
      coef[c] = det3(mc) / D;
    }
  }
  Foot out;
  out.hCentre = hs[0];
  out.tiltDeg = std::atan(std::sqrt(coef[0] * coef[0] + coef[1] * coef[1])) / kDeg;
  std::vector<double> res;
  res.reserve(static_cast<size_t>(n));
  double hmin = hs[0], hmax = hs[0];
  for (int i = 0; i < n; ++i) {
    const double r = std::fabs(hs[i] - (coef[0] * xs[i] + coef[1] * ys[i] + coef[2]));
    res.push_back(r);
    if (r > out.residMaxM) out.residMaxM = r;
    if (hs[i] < hmin) hmin = hs[i];
    if (hs[i] > hmax) hmax = hs[i];
  }
  out.spanM = hmax - hmin;
  out.residP95M = pct(res, 0.95);
  out.padDeltaM = hs[0] - designedHeightNoPad(body, dir);
  return out;
}

// -----------------------------------------------------------------------------
// THE PATH MEASUREMENT. The great circle from the anchor to the site, sampled
// every 5 m. This is the WORST CASE for reachability and deliberately so: a
// player may walk around an obstacle, so a walkable great circle proves the
// site is reachable, while an unwalkable one only fails to prove it.
//
// Two arms, because one is not a number. A 5 m grade is dominated by the
// detail octaves; a 20 m grade is the landform you actually have to climb.
// -----------------------------------------------------------------------------
struct Path {
  double maxGrade5Deg = 0;
  double maxGrade20Deg = 0;
  double climbM = 0;      // net height gain, anchor -> site
  double gainM = 0;       // total ascent, sum of positive steps
  int wetSamples = 0;
  int samples = 0;
};

Path pathTo(const BodyParams& body, const Vec3& from, const Vec3& to,
            double stepM) {
  const double R = body.radiusM;
  const double L = arcM(from, to, R);
  const int n = static_cast<int>(L / stepM) + 1;
  std::vector<double> h(static_cast<size_t>(n) + 1);
  std::vector<Vec3> d(static_cast<size_t>(n) + 1);
  for (int i = 0; i <= n; ++i) {
    const double t = static_cast<double>(i) / static_cast<double>(n);
    Vec3 p(from.x + (to.x - from.x) * t, from.y + (to.y - from.y) * t,
           from.z + (to.z - from.z) * t);
    p = p * (1.0 / p.length());
    d[static_cast<size_t>(i)] = p;
    h[static_cast<size_t>(i)] = sampleDesignedHeight(body, p);
  }
  Path out;
  out.samples = n + 1;
  const double dsM = L / static_cast<double>(n);
  const int span20 = std::max(1, static_cast<int>(20.0 / dsM + 0.5));
  for (int i = 0; i < n; ++i) {
    const double dh = h[static_cast<size_t>(i) + 1] - h[static_cast<size_t>(i)];
    const double g = std::atan(std::fabs(dh) / dsM) / kDeg;
    if (g > out.maxGrade5Deg) out.maxGrade5Deg = g;
    if (dh > 0) out.gainM += dh;
  }
  for (int i = 0; i + span20 <= n; ++i) {
    const double dh = h[static_cast<size_t>(i) + static_cast<size_t>(span20)]
                    - h[static_cast<size_t>(i)];
    const double g = std::atan(std::fabs(dh) / (dsM * span20)) / kDeg;
    if (g > out.maxGrade20Deg) out.maxGrade20Deg = g;
  }
  for (int i = 0; i <= n; ++i)
    if (water::depthAt(body, d[static_cast<size_t>(i)]) > 0.0) ++out.wetSamples;
  out.climbM = h[static_cast<size_t>(n)] - h[0];
  return out;
}

struct Cand {
  Vec3 dir;
  double latDeg = 0, lonDeg = 0;
  double arc = 0;
  Foot foot;
  Biome biome = Biome::Unknown;
  double wetMaxM = 0;     // deepest water over the footprint ring
  bool admitted = false;
};

}  // namespace

int main(int argc, char** argv) {
  uint64_t seed = kDefaultWorldSeed;
  const char* bodyName = "forge";
  double rM = 30.0, minM = 700.0, maxM = 1400.0;
  int nCand = 20000, top = 8;
  double tiltGate = 6.0, residGate = 1.5;
  for (int i = 1; i < argc; ++i) {
    auto next = [&](void) -> const char* { return (i + 1 < argc) ? argv[++i] : ""; };
    if (!std::strcmp(argv[i], "--seed")) seed = std::strtoull(next(), nullptr, 0);
    else if (!std::strcmp(argv[i], "--body")) bodyName = next();
    else if (!std::strcmp(argv[i], "--r")) rM = std::strtod(next(), nullptr);
    else if (!std::strcmp(argv[i], "--min")) minM = std::strtod(next(), nullptr);
    else if (!std::strcmp(argv[i], "--max")) maxM = std::strtod(next(), nullptr);
    else if (!std::strcmp(argv[i], "--n")) nCand = std::atoi(next());
    else if (!std::strcmp(argv[i], "--top")) top = std::atoi(next());
    else if (!std::strcmp(argv[i], "--tilt")) tiltGate = std::strtod(next(), nullptr);
    else if (!std::strcmp(argv[i], "--resid")) residGate = std::strtod(next(), nullptr);
  }
  const bool moon = !std::strcmp(bodyName, "cinder") || !std::strcmp(bodyName, "moon");
  const BodyParams body = moon ? makeCinder(seed) : makeForge(seed);
  const double R = body.radiusM;
  const Vec3 anchor = body.homeDir.length() > 0.5
      ? body.homeDir : latLonToDir(0.0, 0.0);

  std::printf("=============================================================\n");
  std::printf("site_probe  body=%s  bodyId=%u  seed=0x%llx  bodySeed=0x%llx\n",
              bodyName, (unsigned)body.bodyId, (unsigned long long)seed,
              (unsigned long long)body.bodySeed);
  std::printf("radius %.1f m   pad flat %.1f m   pad blend %.1f m   pond r %.1f m\n",
              R, body.homeFlatRadiusM, body.homeBlendRadiusM, body.pondRadiusM);
  std::printf("footprint radius %.1f m   band [%.0f, %.0f] m   candidates %d\n",
              rM, minM, maxM, nCand);
  std::printf("=============================================================\n\n");

  // ---------------------------------------------------------------------------
  // THE ANCHOR ITSELF. Reported first, because "near spawn" is a claim about
  // this point and the last written description of it is a comment.
  // ---------------------------------------------------------------------------
  {
    const double hPad = sampleDesignedHeight(body, anchor);
    const double hNat = designedHeightNoPad(body, anchor);
    const Foot af = footprintAt(body, anchor, rM);
    std::printf("--- THE ANCHOR (the spawn) ---\n");
    std::printf("dir            %.17g, %.17g, %.17g\n", anchor.x, anchor.y, anchor.z);
    std::printf("designed h     %.3f m   (padded, what the player stands on)\n", hPad);
    std::printf("natural h      %.3f m   (no pad)\n", hNat);
    std::printf("pad lift       %+.3f m\n", hPad - hNat);
    std::printf("biome          %s\n", biomeName(biomeAt(body, anchor)));
    std::printf("footprint@%.0fm tilt %.3f deg  residP95 %.3f m  span %.3f m\n\n",
                rM, af.tiltDeg, af.residP95M, af.spanM);
  }

  // ---------------------------------------------------------------------------
  // POSITIVE CONTROL ON THE INSTRUMENT, two-sided, run before any survey.
  // The pad delta must be NONZERO inside the blend and BIT-ZERO outside it.
  // A padDelta that is zero everywhere means the probe is not seeing the pad
  // at all, which reads exactly like "this candidate is on natural ground".
  // ---------------------------------------------------------------------------
  if (!moon && body.homeBlendRadiusM > 0.0) {
    const Frame f = frameAt(anchor);
    const Vec3 in = offsetDir(f, R, body.homeBlendRadiusM * 0.5, 0.0);
    const Vec3 out = offsetDir(f, R, body.homeBlendRadiusM * 2.0, 0.0);
    const double dIn = sampleDesignedHeight(body, in) - designedHeightNoPad(body, in);
    const double dOut = sampleDesignedHeight(body, out) - designedHeightNoPad(body, out);
    std::printf("--- CONTROL: does the probe see the spawn pad? ---\n");
    std::printf("at %.0f m (inside blend)  padDelta %+.6f m   %s\n",
                body.homeBlendRadiusM * 0.5, dIn,
                dIn != 0.0 ? "NONZERO, instrument alive" : "*** ZERO: BLIND ***");
    std::printf("at %.0f m (outside blend) padDelta %+.6f m   %s\n\n",
                body.homeBlendRadiusM * 2.0, dOut,
                dOut == 0.0 ? "BIT-ZERO as specified" : "*** NONZERO: pad leaks ***");
  }

  // ---------------------------------------------------------------------------
  // THE SWEEP. A golden-angle spiral over the annulus, area-uniform in radius
  // (r = sqrt(u) scaling), so the sample density is the same at 700 m and at
  // 1400 m rather than piling up at the inner edge.
  // ---------------------------------------------------------------------------
  const Frame af = frameAt(anchor);
  std::vector<Cand> cands;
  cands.reserve(static_cast<size_t>(nCand));
  std::vector<double> allTilt, allResid, allSpan;
  int nOcean = 0, nWet = 0, nPad = 0;
  for (int i = 0; i < nCand; ++i) {
    const double u = (static_cast<double>(i) + 0.5) / static_cast<double>(nCand);
    const double rr = std::sqrt(minM * minM + u * (maxM * maxM - minM * minM));
    const double ang = static_cast<double>(i) * 2.39996322972865332;
    const Vec3 d = offsetDir(af, R, std::cos(ang) * rr, std::sin(ang) * rr);
    Cand c;
    c.dir = d;
    c.arc = arcM(anchor, d, R);
    c.biome = biomeAt(body, d);
    if (c.biome == Biome::Ocean) { ++nOcean; continue; }
    c.foot = footprintAt(body, d, rM);
    if (c.foot.padDeltaM != 0.0) { ++nPad; continue; }
    // Water over the whole footprint, not only the centre: a shoreline site
    // passes a centre-only test with its back half under the pond.
    const Frame cf = frameAt(d);
    double wet = water::depthAt(body, d);
    for (int k = 0; k < 12; ++k) {
      const double a = (k / 12.0) * 2.0 * kPi;
      const double w = water::depthAt(body, offsetDir(cf, R, std::cos(a) * rM,
                                               std::sin(a) * rM));
      if (w > wet) wet = w;
    }
    c.wetMaxM = wet;
    if (wet > 0.0) { ++nWet; continue; }
    allTilt.push_back(c.foot.tiltDeg);
    allResid.push_back(c.foot.residP95M);
    allSpan.push_back(c.foot.spanM);
    c.latDeg = std::asin(d.y) / kDeg;
    c.lonDeg = std::atan2(d.z, d.x) / kDeg;
    cands.push_back(c);
  }

  // ---------------------------------------------------------------------------
  // WHAT KIND OF WORLD IS THIS BAND. Not decoration: the storyline's first two
  // goals are gather wood and gather stone, and the client's treeline is an
  // ALTITUDE (ScatterTuning.ts TREELINE_FULL_M 950, TREELINE_BARE_M 1850), so
  // "is there wood here" is a height question this probe can answer directly.
  // ---------------------------------------------------------------------------
  {
    int hist[11] = {0};
    int belowBare = 0, belowFull = 0;
    double hMin = 1e30, hMax = -1e30;
    for (const Cand& c : cands) {
      int b = static_cast<int>(c.biome);
      if (b < 0 || b > 10) b = 10;
      ++hist[b];
      if (c.foot.hCentre < 1850.0) ++belowBare;
      if (c.foot.hCentre < 950.0) ++belowFull;
      if (c.foot.hCentre < hMin) hMin = c.foot.hCentre;
      if (c.foot.hCentre > hMax) hMax = c.foot.hCentre;
    }
    std::printf("--- WHAT KIND OF GROUND IS IN THE BAND ---\n");
    std::printf("height %.1f m to %.1f m\n", hMin, hMax);
    std::printf("below TREELINE_BARE_M 1850: %d of %zu    "
                "below TREELINE_FULL_M 950: %d\n",
                belowBare, cands.size(), belowFull);
    for (int b = 0; b <= 10; ++b)
      if (hist[b] > 0)
        std::printf("  %-13s %6d  (%.2f%%)\n", biomeName(static_cast<Biome>(b)),
                    hist[b], 100.0 * hist[b] / static_cast<double>(cands.size()));
    std::printf("\n");
  }

  std::printf("--- THE DISTRIBUTION OF BUILDABLE GROUND IN THE BAND ---\n");
  std::printf("candidates %d   refused: ocean %d, inside pad blend %d, wet %d\n",
              nCand, nOcean, nPad, nWet);
  std::printf("surviving %zu, and these are their quantiles:\n\n", cands.size());
  std::printf("       %8s %8s %8s %8s %8s %8s\n",
              "p05", "p25", "p50", "p75", "p95", "p99");
  {
    std::vector<double> a = allTilt, b = allResid, s = allSpan;
    std::printf("tilt   %8.3f %8.3f %8.3f %8.3f %8.3f %8.3f  deg over a %.0f m disc\n",
                pct(a, .05), pct(a, .25), pct(a, .50), pct(a, .75), pct(a, .95),
                pct(a, .99), rM);
    std::printf("resid  %8.3f %8.3f %8.3f %8.3f %8.3f %8.3f  m, p95 |h - plane|\n",
                pct(b, .05), pct(b, .25), pct(b, .50), pct(b, .75), pct(b, .95),
                pct(b, .99));
    std::printf("span   %8.3f %8.3f %8.3f %8.3f %8.3f %8.3f  m, max - min raw\n\n",
                pct(s, .05), pct(s, .25), pct(s, .50), pct(s, .75), pct(s, .95),
                pct(s, .99));
  }

  // ---------------------------------------------------------------------------
  // WHY SPAN IS NOT THE INSTRUMENT. Count the candidates the two gates
  // disagree about. If span alone were sufficient these two sets would be
  // empty and the plane fit would be ceremony.
  // ---------------------------------------------------------------------------
  {
    // A span gate calibrated to admit the same FRACTION as the pair gate, so
    // the comparison is about WHICH ground each admits, not how much.
    int pairPass = 0;
    for (const Cand& c : cands)
      if (c.foot.tiltDeg <= tiltGate && c.foot.residP95M <= residGate) ++pairPass;
    std::vector<double> s = allSpan;
    const double frac = cands.empty() ? 0.0
        : static_cast<double>(pairPass) / static_cast<double>(cands.size());
    const double spanGate = pct(s, frac);
    int onlySpan = 0, onlyPair = 0, spanTilt = 0, spanResid = 0, spanBoth = 0;
    for (const Cand& c : cands) {
      const bool tOk = c.foot.tiltDeg <= tiltGate;
      const bool rOk = c.foot.residP95M <= residGate;
      const bool p = tOk && rOk;
      const bool q = c.foot.spanM <= spanGate;
      if (q && !p) {
        ++onlySpan;
        if (!tOk && !rOk) ++spanBoth;
        else if (!tOk) ++spanTilt;
        else ++spanResid;
      }
      if (p && !q) ++onlyPair;
    }
    std::printf("--- SPAN CANNOT REPLACE THE PAIR ---\n");
    std::printf("pair gate (tilt<=%.2f deg AND residP95<=%.2f m) admits %d of %zu (%.2f%%)\n",
                tiltGate, residGate, pairPass, cands.size(), frac * 100.0);
    std::printf("span gate calibrated to the SAME fraction is span <= %.3f m\n",
                spanGate);
    std::printf("admitted by span and REFUSED by the pair: %d"
                "   (tilt only %d, residual only %d, both %d)\n",
                onlySpan, spanTilt, spanResid, spanBoth);
    std::printf("admitted by the pair and REFUSED by span: %d\n", onlyPair);
    std::printf("(both zero would mean the plane fit is ceremony)\n\n");
  }

  // ---------------------------------------------------------------------------
  // THE RANKED ADMISSIBLE SITES, with the path check applied only here because
  // it is the expensive one.
  // ---------------------------------------------------------------------------
  std::vector<Cand> ok;
  for (const Cand& c : cands)
    if (c.foot.tiltDeg <= tiltGate && c.foot.residP95M <= residGate) ok.push_back(c);
  std::sort(ok.begin(), ok.end(), [](const Cand& a, const Cand& b) {
    return a.foot.residP95M + a.foot.tiltDeg * 0.25
         < b.foot.residP95M + b.foot.tiltDeg * 0.25;
  });
  std::printf("--- THE BEST %d ADMISSIBLE SITES, with the walk from spawn ---\n", top);
  std::printf("%9s %10s %8s %7s %8s %7s %8s %7s %7s %6s %s\n",
              "lat", "lon", "arc m", "tilt", "residP95", "span", "h m",
              "g5 deg", "g20", "climb", "biome");
  const int shown = std::min<int>(top, static_cast<int>(ok.size()));
  for (int i = 0; i < shown; ++i) {
    Cand& c = ok[static_cast<size_t>(i)];
    const Path p = pathTo(body, anchor, c.dir, 5.0);
    std::printf("%9.5f %10.5f %8.1f %7.3f %8.3f %7.3f %8.1f %7.2f %7.2f %6.1f %s%s\n",
                c.latDeg, c.lonDeg, c.arc, c.foot.tiltDeg, c.foot.residP95M,
                c.foot.spanM, c.foot.hCentre, p.maxGrade5Deg, p.maxGrade20Deg,
                p.climbM, biomeName(c.biome),
                p.wetSamples > 0 ? "  WET-PATH" : "");
  }
  std::printf("\n%zu of %zu surviving candidates are admissible.\n",
              ok.size(), cands.size());
  std::printf("g5/g20 are the steepest grade on the straight great circle from\n");
  std::printf("spawn at 5 m and 20 m arms. The great circle is the WORST case:\n");
  std::printf("a walkable one proves reachability, an unwalkable one does not\n");
  std::printf("disprove it, because a player may walk around things.\n");
  return 0;
}
