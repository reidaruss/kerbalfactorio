// =============================================================================
// spawn_probe.cpp: world-gen DIAGNOSTIC tool. A pure CONSUMER of of_core (like
// terrain_probe / lod_probe; NOT a ctest). It answers, with numbers, one
// question: "where on Forge is the best place to put the player's spawn?".
//
// The spawn wants four things at once, and they pull against each other:
//   1 FLAT       a gentle valley FLOOR: low local slope, and low enough that a
//                4 m structural module can sit on it without a step under it.
//   2 TEMPERATE  Plains / Forest / Hills. Not Ocean, Beach or Polar.
//   3 SCENIC     real relief inside a 6 km box and a Mountains biome sample
//                within about 3 to 8 km, so a screenshot has something in it.
//   4 DRY        comfortably above the sea-level datum, so it is not a lake bed.
//
// A "valley floor" is distinguished from a "tabletop plateau" by measuring the
// site's height AGAINST THE MEAN of the ground around it, at TWO scales (1 km
// and 6 km): a floor sits BELOW the local mean with most of the surrounding
// samples above it; a plateau sits at or above the mean with almost nothing
// above it. Both are flat; only one of them looks like anywhere.
//
// The PAD DISC metrics matter as much as the point slope. The body carries a
// 150 m dead-flat home pad blended back to natural ground by 600 m, so if the
// natural surface drops 200 m across that disc the pad reads as a cut shelf on
// a mountainside no matter how flat the single sample under the player is.
//
// PIPELINE (each stage feeds the next, so the expensive metric only ever runs on
// a few dozen sites):
//   A  global coarse sweep     0.50  deg (~5.2 km on Forge), lat -60..+60
//   B  regional refine         0.05  deg (~520 m) around the best coarse cells
//   C  fine flat-spot search   0.0025 deg (~26 m) around the best regions
//   D  full metric on the finalists, ranked
//   E  5 m polish of the leaders, re-scored in full, then the report
// Stage A's picks are spread by a minimum separation so the finalists are
// different PLACES, not fifty samples of one valley, and its longitude step is
// divided by cos(lat) so every cell covers the same ground area (a fixed lon
// step samples lat 60 twice as densely as the equator and biases any
// best-of-N search poleward for no physical reason).
//
// EVERY height here is designedHeightNoPad, NOT sampleDesignedHeight: the latter
// adds the flat home pad at the CURRENT homeDir and would contaminate any site
// near it (and would make the incumbent site read as perfectly flat by
// construction, which is exactly the measurement error to avoid).
//
// Usage: spawn_probe [--seed <hex|dec>] [--coarse <deg>] [--regions <n>]
//                    [--sep <km>] [--latmin <deg>] [--latmax <deg>]
//                    [--minpeak <m>] [--also <lat,lon>]...
//   --minpeak gates every candidate on having that much height above it inside
//             its own 6 km box; without it the search converges on featureless
//             lowland basins, which are the flattest ground on the planet and
//             exactly the empty-screenshot case WG-26 warned about.
//   --also    forces a named lat/lon into the ranked table for comparison.
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

using namespace of;
using namespace of::worldgen;

namespace {

constexpr double kPi = 3.14159265358979323846;
constexpr double kDeg = kPi / 180.0;
constexpr double kHomeLatDeg = 2.0, kHomeLonDeg = 144.0;

// The client's default world seed (web/src/app/Config.ts DEFAULT_SEED_LO, with
// seedHi 0). Asserted, printed, never assumed.
constexpr uint64_t kDefaultWorldSeed = 0x0bf00d01ull;

// The shipped pad geometry (makeForge). Read, not hard-coded: if the pad grows,
// the disc metrics grow with it.
double gFlatR = 150.0, gBlendR = 600.0;

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

// Point (dx, dy) metres from the frame origin, gnomonic (0.5 m of arc error at
// 8 km on a 600 km body, i.e. well under the 500 m grid it is used on there).
Vec3 offsetDir(const Frame& f, double R, double dx, double dy) {
  const double a = dx / R, b = dy / R;
  Vec3 p(f.c.x + a * f.east.x + b * f.north.x,
         f.c.y + a * f.east.y + b * f.north.y,
         f.c.z + a * f.east.z + b * f.north.z);
  return p * (1.0 / p.length());
}

// =============================================================================
// WG-57: THE POND MOVES WITH THE PAD, OR IT IS ORPHANED.
//
// `pondDir` is `homeDir` rotated 55 m along a heading 30 deg east of north, and
// cubed_sphere.h stores it as a LITERAL for the DW-14 reason `homeDir` is one.
// So moving `homeDir` without recomputing this leaves the basin at the OLD
// spawn, in whatever biome happens to sit 55 m from a site nobody chose, with
// its water level still referenced to a pad that is no longer there. Before this
// existed the probe never mentioned the pond at all and `printHomeDirLiteral`
// emitted `homeDir` alone, so acting on its output as printed did exactly that.
//
// THE CONSTRUCTION IS A TRUE GREAT-CIRCLE ROTATION AND NOT `offsetDir`'s
// tangent-offset-then-normalise, and that is not a detail. Measured against the
// shipped literal: tangent-offset lands 154 nm away with the separation at
// 54.999999827 m, while the great circle reproduces the shipped `pondDir`
// BIT-FOR-BIT on all three components at 54.999999981 m. Both pass the
// `|sep - 55| < 1e-6` that test_water_field.cpp pins, so a tolerance check would
// have accepted the wrong one; bit-identity is what identifies the construction.
// =============================================================================
constexpr double kPondSepM = 55.0;
constexpr double kPondHeadingDeg = 30.0;   // east of north

Vec3 pondDirFor(const Vec3& homeDir, double R) {
  const Frame f = frameAt(homeDir);
  const double th = kPondSepM / R;
  const double se = std::sin(kPondHeadingDeg * kDeg);
  const double cn = std::cos(kPondHeadingDeg * kDeg);
  const Vec3 t(f.east.x * se + f.north.x * cn, f.east.y * se + f.north.y * cn,
               f.east.z * se + f.north.z * cn);
  const double ct = std::cos(th), st = std::sin(th);
  return Vec3(homeDir.x * ct + t.x * st, homeDir.y * ct + t.y * st,
              homeDir.z * ct + t.z * st);
}

// Reconstructing the SHIPPED pondDir from the SHIPPED homeDir must return the
// shipped bits. If it ever does not, the construction above has drifted from the
// one that generated the literal, and every pondDir this tool prints would
// silently move the pond. Loud rather than tolerated: this is the only thing
// standing between "the spawn moved" and "the pond is somewhere else now".
bool pondDirSelfCheck(const BodyParams& body) {
  const Vec3 got = pondDirFor(body.homeDir, body.radiusM);
  const bool exact = got.x == body.pondDir.x && got.y == body.pondDir.y &&
                     got.z == body.pondDir.z;
  const double dx = got.x - body.pondDir.x, dy = got.y - body.pondDir.y,
               dz = got.z - body.pondDir.z;
  std::printf("pondDir self-check: reconstruct from homeDir -> %s"
              " (delta %.3g m, |v| - 1 = %.3g)\n",
              exact ? "BIT-IDENTICAL to the shipped literal"
                    : "*** MISMATCH, DO NOT USE THE PRINTED LITERAL ***",
              body.radiusM * std::sqrt(dx * dx + dy * dy + dz * dz),
              got.length() - 1.0);
  return exact;
}

// Longitude wrapped into [-180, 180). Applied BEFORE latLonToDir so the printed
// lat/lon and the dir (and therefore the homeDir literal) always agree: cos of
// -180.085 deg and cos of +179.915 deg are the same angle but not the same bits.
double wrapLon(double lonDeg) {
  while (lonDeg >= 180.0) lonDeg -= 360.0;
  while (lonDeg < -180.0) lonDeg += 360.0;
  return lonDeg;
}

// SNAP every candidate coordinate to the exact double its own printed form
// parses back to (5 decimal places = 0.1 m on Forge). Without this a search grid
// built by accumulating +0.0025 lands on a double that no human will ever
// retype, and because height is POSITION-HASHED from raw bits a 1-ULP miss
// hashes to a different fine-detail value: the measured site and the site the
// literal names would differ underfoot. Snapping makes the reported lat/lon,
// the measured numbers and the emitted homeDir literal the same place exactly.
double snap5(double v) {
  char b[40];
  std::snprintf(b, sizeof(b), "%.5f", v);
  return std::strtod(b, nullptr);
}

const char* biomeName(Biome b) {
  static const char* kNames[] = {"Ocean", "Beach", "Plains", "Forest", "Hills",
                                 "Mountains", "Polar", "Regolith",
                                 "MoonHighland", "CraterFloor", "Unknown"};
  const int i = static_cast<int>(b);
  return (i >= 0 && i < 11) ? kNames[i] : "Unknown";
}

bool temperate(Biome b) {
  return b == Biome::Plains || b == Biome::Forest || b == Biome::Hills;
}

// =============================================================================
// The per-site metric.
// =============================================================================
struct Site {
  double latDeg = 0, lonDeg = 0;
  Vec3 dir{0, 0, 0};
  double h = 0;                 // designedHeightNoPad at the site, metres
  Biome biome = Biome::Unknown;

  // --- local flatness (the numbers the request is actually about) ---
  double slope4 = 0, slope20 = 0, slope100 = 0;   // max |dh|/r on a ring, %
  double slope420 = 0;          // max of slope4 and slope20 (the headline)
  double worst4m = 0;           // worst |dh| between samples <= 4 m apart

  // --- the pad disc: does a 150 m flat pad fit here without reading as a cut? -
  double padRelief = 0;         // max-min inside the flat radius
  double padGrade = 0;          // worst 10 m-adjacent grade inside it, %
  double blendRelief = 0;       // max-min inside the blend radius

  // --- floor vs tabletop, at 1 km and 6 km ---
  double min6 = 0, max6 = 0, mean6 = 0;
  double belowMean6 = 0;        // mean6 - h; POSITIVE means the site is lower
  double pctAbove6 = 0;         // % of the 6 km box higher than the site
  double mean1 = 0, belowMean1 = 0, pctAbove1 = 0;   // same within 1 km
  double grade500 = 0;          // regional grade over 500 m, %

  // --- something to look at ---
  double max8 = 0, max8Dist = 0;
  bool   mtn8 = false;
  double mtnNearest = -1;       // metres to the nearest Mountains sample
  double max20 = 0, max20Dist = 0;   // the horizon proper

  // --- how safely inside its biome is it (does a nudge flip the class) ---
  double temp = 0, moist = 0, relNorm = 0;

  double score = 0, sFlat = 0, sFloor = 0, sView = 0;
};

// -----------------------------------------------------------------------------
// COARSE context: 13x13 at 500 m = a 6 km box, 169 samples. Fills the same
// fields the full metric later overwrites at higher resolution, so stage A/B and
// stage D score the same quantities.
void coarseContext(const BodyParams& body, Site& s) {
  const Frame f = frameAt(s.dir);
  const double R = body.radiusM;
  const int N = 13;
  const double step = 500.0;
  double mn = 1e300, mx = -1e300, sum = 0, sum1 = 0, adj = 0;
  int above = 0, n1 = 0, above1 = 0;
  for (int j = 0; j < N; ++j)
    for (int i = 0; i < N; ++i) {
      const double x = (i - N / 2) * step, y = (j - N / 2) * step;
      const double hh = designedHeightNoPad(body, offsetDir(f, R, x, y));
      mn = std::min(mn, hh); mx = std::max(mx, hh); sum += hh;
      if (hh > s.h) ++above;
      if (x * x + y * y <= 1000.0 * 1000.0) {
        sum1 += hh; ++n1;
        if (hh > s.h) ++above1;
      }
      if ((i == N / 2 && (j == N / 2 - 1 || j == N / 2 + 1)) ||
          (j == N / 2 && (i == N / 2 - 1 || i == N / 2 + 1)))
        adj = std::max(adj, std::fabs(hh - s.h) / step);
    }
  const double n = double(N) * N;
  s.min6 = mn; s.max6 = mx; s.mean6 = sum / n;
  s.belowMean6 = s.mean6 - s.h;
  s.pctAbove6 = 100.0 * above / n;
  s.mean1 = (n1 > 0) ? sum1 / n1 : s.h;
  s.belowMean1 = s.mean1 - s.h;
  s.pctAbove1 = (n1 > 0) ? 100.0 * above1 / n1 : 0.0;
  s.grade500 = 100.0 * adj;
}

// -----------------------------------------------------------------------------
// Local slope: rings at 4 m, 20 m and 100 m, 16 azimuths each, reported as
// max |dh|/r in percent. Plus the worst |dh| between any two samples within 4 m
// of each other over a 24 m x 24 m grid at 2 m spacing: 4 m is the DW-32
// structural module, so that is the number that decides whether a foundation can
// sit there without a step under it.
void localFlatness(const BodyParams& body, Site& s) {
  const Frame f = frameAt(s.dir);
  const double R = body.radiusM;
  const double h0 = s.h;
  const double radii[3] = {4.0, 20.0, 100.0};
  double out[3] = {0, 0, 0};
  for (int k = 0; k < 3; ++k)
    for (int a = 0; a < 16; ++a) {
      const double th = a * (2.0 * kPi / 16.0);
      const double hh = designedHeightNoPad(
          body,
          offsetDir(f, R, radii[k] * std::cos(th), radii[k] * std::sin(th)));
      out[k] = std::max(out[k], std::fabs(hh - h0) / radii[k]);
    }
  s.slope4 = 100.0 * out[0];
  s.slope20 = 100.0 * out[1];
  s.slope100 = 100.0 * out[2];
  s.slope420 = std::max(s.slope4, s.slope20);

  // 13x13 grid at 2 m = 24 m x 24 m. Index offsets whose separation is <= 4 m:
  // (1,0) 2 m, (0,1) 2 m, (1,1) 2.83 m, (1,-1) 2.83 m, (2,0) 4 m, (0,2) 4 m.
  const int N = 13;
  double g[N][N];
  for (int j = 0; j < N; ++j)
    for (int i = 0; i < N; ++i)
      g[j][i] = designedHeightNoPad(
          body, offsetDir(f, R, (i - N / 2) * 2.0, (j - N / 2) * 2.0));
  const int off[6][2] = {{1, 0}, {0, 1}, {1, 1}, {1, -1}, {2, 0}, {0, 2}};
  double worst = 0.0;
  for (int j = 0; j < N; ++j)
    for (int i = 0; i < N; ++i)
      for (auto& o : off) {
        const int ni = i + o[0], nj = j + o[1];
        if (ni < 0 || ni >= N || nj < 0 || nj >= N) continue;
        worst = std::max(worst, std::fabs(g[nj][ni] - g[j][i]));
      }
  s.worst4m = worst;
}

// -----------------------------------------------------------------------------
// The pad disc. 10 m grid out to the flat radius (relief + worst 10 m-adjacent
// grade), 50 m grid out to the blend radius (relief only). This is the test for
// "will a 150 m flat pad here read as a clearing or as a shelf cut into a
// hillside", which a single-point slope cannot answer.
void padDisc(const BodyParams& body, Site& s) {
  const Frame f = frameAt(s.dir);
  const double R = body.radiusM;

  const int NF = 2 * int(gFlatR / 10.0) + 1;    // 31 at flatR = 150
  std::vector<double> g(size_t(NF) * NF, 0.0);
  std::vector<char> in(size_t(NF) * NF, 0);
  double mn = 1e300, mx = -1e300;
  for (int j = 0; j < NF; ++j)
    for (int i = 0; i < NF; ++i) {
      const double x = (i - NF / 2) * 10.0, y = (j - NF / 2) * 10.0;
      if (x * x + y * y > gFlatR * gFlatR) continue;
      const double hh = designedHeightNoPad(body, offsetDir(f, R, x, y));
      g[size_t(j) * NF + i] = hh;
      in[size_t(j) * NF + i] = 1;
      mn = std::min(mn, hh); mx = std::max(mx, hh);
    }
  s.padRelief = mx - mn;
  double worst = 0.0;
  for (int j = 0; j < NF; ++j)
    for (int i = 0; i + 1 < NF; ++i) {
      if (in[size_t(j) * NF + i] && in[size_t(j) * NF + i + 1])
        worst = std::max(worst, std::fabs(g[size_t(j) * NF + i + 1] -
                                          g[size_t(j) * NF + i]));
      if (in[size_t(i) * NF + j] && in[size_t(i + 1) * NF + j])
        worst = std::max(worst, std::fabs(g[size_t(i + 1) * NF + j] -
                                          g[size_t(i) * NF + j]));
    }
  s.padGrade = 100.0 * worst / 10.0;

  const int NB = 2 * int(gBlendR / 50.0) + 1;   // 25 at blendR = 600
  double bmn = 1e300, bmx = -1e300;
  for (int j = 0; j < NB; ++j)
    for (int i = 0; i < NB; ++i) {
      const double x = (i - NB / 2) * 50.0, y = (j - NB / 2) * 50.0;
      if (x * x + y * y > gBlendR * gBlendR) continue;
      const double hh = designedHeightNoPad(body, offsetDir(f, R, x, y));
      bmn = std::min(bmn, hh); bmx = std::max(bmx, hh);
    }
  s.blendRelief = bmx - bmn;
}

// -----------------------------------------------------------------------------
// 41x41 at 150 m: the 6 km box at full resolution, plus the same restricted to
// the 1 km disc, so "floor or tabletop" is answered at two scales.
void relief6km(const BodyParams& body, Site& s) {
  const Frame f = frameAt(s.dir);
  const double R = body.radiusM;
  const int N = 41;
  const double step = 150.0;
  double mn = 1e300, mx = -1e300, sum = 0, sum1 = 0;
  int above = 0, n1 = 0, above1 = 0;
  for (int j = 0; j < N; ++j)
    for (int i = 0; i < N; ++i) {
      const double x = (i - N / 2) * step, y = (j - N / 2) * step;
      const double hh = designedHeightNoPad(body, offsetDir(f, R, x, y));
      mn = std::min(mn, hh); mx = std::max(mx, hh); sum += hh;
      if (hh > s.h) ++above;
      if (x * x + y * y <= 1000.0 * 1000.0) {
        sum1 += hh; ++n1;
        if (hh > s.h) ++above1;
      }
    }
  const double n = double(N) * N;
  s.min6 = mn; s.max6 = mx; s.mean6 = sum / n;
  s.belowMean6 = s.mean6 - s.h;
  s.pctAbove6 = 100.0 * above / n;
  s.mean1 = (n1 > 0) ? sum1 / n1 : s.h;
  s.belowMean1 = s.mean1 - s.h;
  s.pctAbove1 = (n1 > 0) ? 100.0 * above1 / n1 : 0.0;
}

// -----------------------------------------------------------------------------
// 33x33 at 500 m, radius-masked to 8 km: the highest ground the player can see
// and how far it is, plus whether any of it classifies as the Mountains biome
// and how close the nearest such sample is.
void horizonScan(const BodyParams& body, Site& s) {
  const Frame f = frameAt(s.dir);
  const double R = body.radiusM;
  const int N = 33;
  const double step = 500.0;
  double best = -1e300, bestD = 0, nearest = 1e300;
  bool mtn = false;
  for (int j = 0; j < N; ++j)
    for (int i = 0; i < N; ++i) {
      const double x = (i - N / 2) * step, y = (j - N / 2) * step;
      const double d2 = x * x + y * y;
      if (d2 > 8000.0 * 8000.0) continue;
      const Vec3 d = offsetDir(f, R, x, y);
      const double hh = designedHeightNoPad(body, d);
      if (hh > best) { best = hh; bestD = std::sqrt(d2); }
      if (biomeAt(body, d) == Biome::Mountains) {
        mtn = true;
        nearest = std::min(nearest, std::sqrt(d2));
      }
    }
  s.max8 = best; s.max8Dist = bestD;
  s.mtn8 = mtn; s.mtnNearest = mtn ? nearest : -1.0;

  // The horizon proper: 41x41 at 1 km, radius-masked to 20 km. On a 600 km body
  // the geometric horizon for a 1.7 m eye is only ~1.4 km, so anything the
  // player actually SEES on the skyline has to stand well above the ground: a
  // 2 km peak 20 km out subtends about the same as one 2 km away at 200 m.
  const int M = 41;
  double b20 = -1e300, d20 = 0;
  for (int j = 0; j < M; ++j)
    for (int i = 0; i < M; ++i) {
      const double x = (i - M / 2) * 1000.0, y = (j - M / 2) * 1000.0;
      const double d2 = x * x + y * y;
      if (d2 > 20000.0 * 20000.0) continue;
      const double hh = designedHeightNoPad(body, offsetDir(f, R, x, y));
      if (hh > b20) { b20 = hh; d20 = std::sqrt(d2); }
    }
  s.max20 = b20; s.max20Dist = d20;

  // Climate margin: how far the site is from flipping biome class.
  const double raw = sampleHeightField(body, s.dir);
  s.temp = temperatureAtH(body, s.dir, raw);
  s.moist = moistureAt(body, s.dir);
  s.relNorm = raw / reliefDenom(body);
}

// -----------------------------------------------------------------------------
// The score, in three named parts that are printed alongside the total so the
// ranking is arguable rather than a black box.
//   FLAT   what the request asked for: local slope, the 4 m step a foundation
//          sits on, and whether a 150 m pad fits without becoming a shelf.
//   FLOOR  is the site LOWER than the ground around it, at 1 km and at 6 km.
//   VIEW   relief in the 6 km box, height of the best peak within 8 km, and
//          whether any of it is actually the Mountains biome.
void computeScore(Site& s) {
  s.sFlat = -(3.0 * std::min(s.slope420, 60.0)
              + 20.0 * std::min(s.worst4m, 5.0)
              + 0.8 * std::min(s.padGrade, 60.0)
              + 0.10 * std::min(s.padRelief, 300.0)
              + 0.02 * std::min(s.blendRelief, 800.0));
  s.sFloor = 0.25 * s.pctAbove1 + 0.10 * s.pctAbove6
             + 0.010 * std::min(std::max(s.belowMean1, 0.0), 400.0);
  s.sView = 0.006 * std::min(s.max6 - s.min6, 4000.0)
            + 0.004 * std::max(0.0, s.max8 - s.h)
            + (s.mtn8 ? 12.0 : -15.0);
  s.score = s.sFlat + s.sFloor + s.sView;
}

// The cheap stage-A/B score: the same three ideas, from the 169-sample coarse
// context only (no ring, no pad disc, no biome scan of the neighbourhood).
double coarseScore(const Site& s) {
  return -2.5 * std::min(s.grade500, 60.0)
         + 0.25 * s.pctAbove1 + 0.10 * s.pctAbove6
         + 0.010 * std::min(std::max(s.belowMean1, 0.0), 400.0)
         + 0.006 * std::min(s.max6 - s.min6, 4000.0);
}

// Build a site at (lat, lon), wrapping longitude first. Returns false if the
// site is under water / a shoreline or not temperate.
bool makeSite(const BodyParams& body, double latDeg, double lonDeg,
              double minAlt, Site& s) {
  s = Site();
  s.latDeg = snap5(latDeg);
  s.lonDeg = snap5(wrapLon(lonDeg));
  s.dir = latLonToDir(s.latDeg * kDeg, s.lonDeg * kDeg);
  s.h = designedHeightNoPad(body, s.dir);
  if (s.h < minAlt) return false;
  s.biome = biomeAt(body, s.dir);
  return temperate(s.biome);
}

double chordM(const BodyParams& b, const Vec3& a, const Vec3& c) {
  const double dx = a.x - c.x, dy = a.y - c.y, dz = a.z - c.z;
  return b.radiusM * std::sqrt(dx * dx + dy * dy + dz * dz);
}

void printDetail(const BodyParams& body, const Site& s, const char* label) {
  char mtn[64];
  if (s.mtn8) std::snprintf(mtn, sizeof(mtn), "YES, nearest at %.0f m",
                            s.mtnNearest);
  else std::snprintf(mtn, sizeof(mtn), "no");
  std::printf(
      "\n--- %s ---\n"
      "  lat %+10.5f   lon %+11.5f\n"
      "  altitude            %9.2f m   (sea-level datum %.0f m)   biome %s\n"
      "  local slope           %7.2f %% at 4 m, %7.2f %% at 20 m, %7.2f %% at"
      " 100 m\n"
      "  worst 4 m step        %7.3f m   (24x24 m grid at 2 m spacing)\n"
      "  pad disc (r %3.0f m)    relief %6.1f m, worst 10 m grade %6.2f %%\n"
      "  blend disc (r %3.0f m)  relief %6.1f m\n"
      "  6 km box            min %8.1f  max %8.1f  mean %8.1f  relief %7.1f m\n"
      "  site - 6 km mean    %+8.1f m   %5.1f%% of the 6 km box is ABOVE it\n"
      "  site - 1 km mean    %+8.1f m   %5.1f%% of the 1 km disc is ABOVE it\n"
      "  within 8 km         max %8.1f m at %6.0f m (%+.0f m above the site)\n"
      "  within 20 km        max %8.1f m at %6.0f m (%+.0f m above the site)\n"
      "  Mountains in 8 km   %s\n"
      "  climate margin      temperature %.3f (Polar below 0.180), moisture "
      "%.3f (Forest above 0.550)\n"
      "                      normalised relief %.4f (Hills above %.3f, "
      "Mountains above %.3f)\n"
      "  score %.2f = flat %.2f + floor %.2f + view %.2f\n",
      label, s.latDeg, s.lonDeg, s.h, body.seaLevelM, biomeName(s.biome),
      s.slope4, s.slope20, s.slope100, s.worst4m,
      gFlatR, s.padRelief, s.padGrade, gBlendR, s.blendRelief,
      s.min6, s.max6, s.mean6, s.max6 - s.min6,
      -s.belowMean6, s.pctAbove6, -s.belowMean1, s.pctAbove1,
      s.max8, s.max8Dist, s.max8 - s.h,
      s.max20, s.max20Dist, s.max20 - s.h, mtn,
      s.temp, s.moist, s.relNorm, kHillsRel, kMountainsRel,
      s.score, s.sFlat, s.sFloor, s.sView);
}

void printRow(const Site& s, const char* tag) {
  std::printf("|%-3s| %+9.5f | %+10.5f | %8.1f | %-9s | %6.2f | %7.3f |"
              " %7.1f | %6.2f | %7.1f | %+8.1f | %+8.1f | %5.1f | %7.0f |"
              " %-3s | %7.2f |\n",
              tag, s.latDeg, s.lonDeg, s.h, biomeName(s.biome), s.slope420,
              s.worst4m, s.padRelief, s.padGrade, s.max6 - s.min6,
              -s.belowMean6, -s.belowMean1, s.pctAbove1, s.max8,
              s.mtn8 ? "YES" : "no", s.score);
}

// -----------------------------------------------------------------------------
// WOULD THE PAD READ AS A CLEARING OR AS A CUT SHELF? The one question the
// no-pad metrics cannot answer. Rebuild the body with homeDir MOVED to this
// candidate, then measure, exactly as terrain_probe's §6 does for the incumbent:
// the worst 4 m step inside the flat radius (must be ~0, that is the point of
// the pad), and the worst radial grade in the blend annulus ALONGSIDE the
// natural grade over the same ground. The difference between those two is what
// the eye reads as an artificial cut.
// WG-57: this function used to move `homeDir` and leave `pondDir` and
// `pondRadiusM` alone, then measure with `sampleDesignedHeight`, which since
// WG-36 subtracts the pond basin. So at any candidate near the shipped pond it
// charged the basin to the terrain: its "worst 4 m step inside the flat radius
// 1.078601 m" at the current spawn was ENTIRELY the pond, since inside the flat
// radius the un-ponded height is a bit-exact constant and the basin is the only
// varying term. The analytic 4 m span across the basin's steepest point is
// 1.080 m. Candidate rows read 0.000000 m only because the pond was thousands of
// km away from them, which is why it looked like a property of the sites.
//
// Both numbers are now measured and BOTH are printed, rather than picking one.
// DW-26's rule: when one authority must answer a question in two shapes, publish
// both shapes. `padOnly` is the pad's own flatness, which is the question this
// function exists to ask and is meaningless with a 4 m bowl cut into it.
// `withPond` is the ground as it would actually ship. The difference is the
// pond, and seeing it as a difference is what stops it being read as terrain.
void probePadHere(const BodyParams& body, const Site& s) {
  BodyParams b = body;
  b.homeDir = s.dir;                      // move the pad to this candidate
  b.pondDir = pondDirFor(s.dir, b.radiusM);   // and the pond moves WITH it
  const Frame f = frameAt(s.dir);
  const double R = b.radiusM;

  BodyParams noPond = b;
  noPond.pondRadiusM = 0.0;               // isolate the pad from its own basin
  const double h0 = sampleDesignedHeight(noPond, s.dir);

  double worst4 = 0.0, worst4Pond = 0.0;
  const double lim = b.homeFlatRadiusM;
  const double off[4][2] = {{4, 0}, {0, 4}, {2.828, 2.828}, {2.828, -2.828}};
  for (double y = -lim; y <= lim; y += 2.0)
    for (double x = -lim; x <= lim; x += 2.0) {
      if (x * x + y * y > lim * lim) continue;
      const double hh = sampleDesignedHeight(noPond, offsetDir(f, R, x, y));
      const double hp = sampleDesignedHeight(b, offsetDir(f, R, x, y));
      for (auto& o : off) {
        const double nx = x + o[0], ny = y + o[1];
        if (nx * nx + ny * ny > lim * lim) continue;
        const Vec3 d = offsetDir(f, R, nx, ny);
        worst4 = std::max(worst4,
                          std::fabs(sampleDesignedHeight(noPond, d) - hh));
        worst4Pond = std::max(worst4Pond,
                              std::fabs(sampleDesignedHeight(b, d) - hp));
      }
    }

  double maxGrade = 0, atR = 0, natThere = 0, maxNat = 0;
  for (double r = b.homeFlatRadiusM; r <= b.homeBlendRadiusM + 20.0; r += 2.0)
    for (int a = 0; a < 120; ++a) {
      const double ca = std::cos(a * 3.0 * kDeg), sa = std::sin(a * 3.0 * kDeg);
      const Vec3 da = offsetDir(f, R, r * ca, r * sa);
      const Vec3 db = offsetDir(f, R, (r + 1.0) * ca, (r + 1.0) * sa);
      const double g = std::fabs(sampleDesignedHeight(b, db) -
                                 sampleDesignedHeight(b, da));
      const double nat = std::fabs(designedHeightNoPad(b, db) -
                                   designedHeightNoPad(b, da));
      maxNat = std::max(maxNat, nat);
      if (g > maxGrade) { maxGrade = g; atR = r; natThere = nat; }
    }
  std::printf("  IF THE PAD MOVES HERE: pad height %.2f m; worst 4 m step "
              "inside the flat radius %.6f m (pad alone)\n"
              "                         %.6f m with the pond cut in, so the "
              "basin accounts for %.6f m of it\n"
              "                         worst blend-annulus grade %.2f%% at "
              "r = %.0f m; natural grade there %.2f%% (worst natural %.2f%%)\n"
              "                         => the pad adds %.2f percentage points "
              "of grade over the natural ground\n",
              h0, worst4, worst4Pond, worst4Pond - worst4, maxGrade * 100.0,
              atR, natThere * 100.0, maxNat * 100.0,
              (maxGrade - natThere) * 100.0);
}

// WG-57: this emitted `homeDir` ALONE, so pasting its output moved the pad and
// left the pond behind at the old spawn. Both literals are emitted together now,
// because they are one edit: `pondDir` is defined relative to `homeDir` and a
// half-applied move is worse than no move, since the world still builds and the
// pond is simply somewhere else. The separation is printed so the paste can be
// checked against the `|sep - 55| < 1e-6` that test_water_field.cpp pins.
void printHomeDirLiteral(double latDeg, double lonDeg, double R) {
  const Vec3 d = latLonToDir(latDeg * kDeg, lonDeg * kDeg);
  const Vec3 p = pondDirFor(d, R);
  const double dx = p.x - d.x, dy = p.y - d.y, dz = p.z - d.z;
  const double sep = R * std::sqrt(dx * dx + dy * dy + dz * dz);
  std::printf("  // BOTH literals move together or the pond is orphaned.\n"
              "  b.homeDir = Vec3(%.17g, %.17g,\n"
              "                   %.17g);\n"
              "  // |dir| - 1 = %.3g\n"
              "  b.pondDir = Vec3(%.17g, %.17g,\n"
              "                   %.17g);\n"
              "  // |dir| - 1 = %.3g ; separation %.9f m (test pins < 1e-6 "
              "from 55) %s\n",
              d.x, d.y, d.z, d.length() - 1.0, p.x, p.y, p.z,
              p.length() - 1.0, sep,
              std::fabs(sep - 55.0) < 1e-6 ? "OK" : "*** OUT OF TOLERANCE ***");
}

}  // namespace

int main(int argc, char** argv) {
  uint64_t worldSeed = kDefaultWorldSeed;
  double coarseStepDeg = 0.5, sepKm = 25.0, minAlt = 200.0;
  double latMin = -60.0, latMax = 60.0, minPeak = 0.0;
  int nRegions = 20;
  std::vector<std::pair<double, double>> also;   // sites forced into the table
  for (int i = 1; i + 1 < argc; ++i) {
    if (std::strcmp(argv[i], "--seed") == 0)
      worldSeed = std::strtoull(argv[i + 1], nullptr, 0);
    if (std::strcmp(argv[i], "--coarse") == 0)
      coarseStepDeg = std::atof(argv[i + 1]);
    if (std::strcmp(argv[i], "--regions") == 0)
      nRegions = std::atoi(argv[i + 1]);
    if (std::strcmp(argv[i], "--sep") == 0) sepKm = std::atof(argv[i + 1]);
    if (std::strcmp(argv[i], "--latmin") == 0) latMin = std::atof(argv[i + 1]);
    if (std::strcmp(argv[i], "--latmax") == 0) latMax = std::atof(argv[i + 1]);
    if (std::strcmp(argv[i], "--minpeak") == 0) minPeak = std::atof(argv[i + 1]);
    if (std::strcmp(argv[i], "--also") == 0) {
      double la = 0, lo = 0;
      if (std::sscanf(argv[i + 1], "%lf,%lf", &la, &lo) == 2)
        also.push_back({la, lo});
    }
  }

  const BodyParams forge = makeForge(worldSeed);
  const double R = forge.radiusM;
  gFlatR = (forge.homeFlatRadiusM > 0) ? forge.homeFlatRadiusM : 150.0;
  gBlendR = (forge.homeBlendRadiusM > 0) ? forge.homeBlendRadiusM : 600.0;

  // WG-57: prove the pond construction still matches the shipped literal before
  // any number below is trusted, because every pondDir this tool prints depends
  // on it and a wrong one moves the pond silently.
  const bool pondOk = pondDirSelfCheck(forge);

  std::printf("=== spawn_probe: Forge, R = %.0f km ===\n"
              "worldSeed 0x%llx  (client default is 0x%llx: %s)\n"
              "bodySeed  0x%llx   maxRelief %.0f m   seaLevel %.0f m   "
              "kind %s\n"
              "pad geometry from makeForge: flat r %.0f m, blend r %.0f m\n"
              "1 deg of arc = %.0f m; coarse step %.4f deg = %.0f m; "
              "region separation %.0f km\n"
              "ALL heights are designedHeightNoPad, so the existing home pad "
              "cannot contaminate any site.\n",
              R / 1000.0, (unsigned long long)worldSeed,
              (unsigned long long)kDefaultWorldSeed,
              worldSeed == kDefaultWorldSeed ? "MATCHES" : "DIFFERS",
              (unsigned long long)forge.bodySeed, forge.maxReliefM,
              forge.seaLevelM, forge.kind == kPlanet ? "planet" : "moon",
              gFlatR, gBlendR, R * kDeg, coarseStepDeg,
              R * kDeg * coarseStepDeg, sepKm);

  // The incumbent, measured with the same instrument as everything else.
  Site home;
  home.latDeg = kHomeLatDeg; home.lonDeg = kHomeLonDeg;
  home.dir = latLonToDir(kHomeLatDeg * kDeg, kHomeLonDeg * kDeg);
  {
    const Vec3 lit = forge.homeDir;
    const double dx = lit.x - home.dir.x, dy = lit.y - home.dir.y,
                 dz = lit.z - home.dir.z;
    std::printf("makeForge's homeDir literal vs latLonToDir(2,144): |delta| = "
                "%.3g  (test_biome pins this < 1e-12)\n",
                std::sqrt(dx * dx + dy * dy + dz * dz));
  }
  home.h = designedHeightNoPad(forge, home.dir);
  home.biome = biomeAt(forge, home.dir);
  localFlatness(forge, home);
  padDisc(forge, home);
  relief6km(forge, home);
  horizonScan(forge, home);
  computeScore(home);

  // ===========================================================================
  // STAGE A: global coarse sweep.
  // ===========================================================================
  std::fprintf(stderr, "stage A: global coarse sweep...\n");
  std::vector<Site> coarse;
  int nScanned = 0, nTemperate = 0;
  for (double lat = latMin; lat <= latMax + 1e-9; lat += coarseStepDeg) {
    // EQUAL-AREA lon step. A fixed lon step samples a lat-60 band twice as
    // densely per square kilometre as the equator, which biases any "best of N
    // samples" search toward high latitude for no physical reason. Dividing by
    // cos(lat) makes every cell the same ground area.
    const double lonStep =
        coarseStepDeg / std::max(std::cos(lat * kDeg), 0.25);
    for (double lon = -180.0; lon < 180.0 - 1e-9; lon += lonStep) {
      ++nScanned;
      Site s;
      if (!makeSite(forge, lat, lon, minAlt, s)) continue;
      ++nTemperate;
      coarseContext(forge, s);
      // The SCENERY gate. Without it the search converges on featureless
      // lowland basins: they are the flattest ground on the planet and they are
      // also the ground the WG-26 comment warns about, where every terrain
      // screenshot is an empty green plane. Requiring real height inside the
      // 6 km box forces the search into mountain-adjacent valleys.
      if (s.max6 - s.h < minPeak) continue;
      s.score = coarseScore(s);
      coarse.push_back(s);
    }
  }
  std::sort(coarse.begin(), coarse.end(),
            [](const Site& a, const Site& b) { return a.score > b.score; });
  std::printf("\nstage A: %d cells scanned, %d temperate and above %.0f m; "
              "best coarse score %.2f, median %.2f\n",
              nScanned, nTemperate, minAlt,
              coarse.empty() ? 0.0 : coarse.front().score,
              coarse.empty() ? 0.0 : coarse[coarse.size() / 2].score);

  // Spread the picks: a minimum separation so the finalists are different
  // PLACES rather than fifty samples of the same valley.
  std::vector<Site> seeds;
  for (const Site& c : coarse) {
    if ((int)seeds.size() >= nRegions * 4) break;
    bool tooClose = false;
    for (const Site& k : seeds)
      if (chordM(forge, c.dir, k.dir) < sepKm * 1000.0) { tooClose = true; break; }
    if (!tooClose) seeds.push_back(c);
  }
  std::printf("stage A: %d well-separated regions selected (>= %.0f km apart)\n",
              (int)seeds.size(), sepKm);

  // ===========================================================================
  // STAGE B: regional refine at 0.05 deg (~520 m), 11x11 around each seed.
  // ===========================================================================
  std::fprintf(stderr, "stage B: refining %d regions...\n", (int)seeds.size());
  std::vector<Site> refined;
  for (const Site& c : seeds) {
    Site best; bool have = false;
    for (int j = -5; j <= 5; ++j)
      for (int i = -5; i <= 5; ++i) {
        Site s;
        if (!makeSite(forge, c.latDeg + j * 0.05, c.lonDeg + i * 0.05, minAlt,
                      s)) continue;
        coarseContext(forge, s);
        if (s.max6 - s.h < minPeak) continue;
        s.score = coarseScore(s);
        if (!have || s.score > best.score) { best = s; have = true; }
      }
    if (have) refined.push_back(best);
  }
  std::sort(refined.begin(), refined.end(),
            [](const Site& a, const Site& b) { return a.score > b.score; });
  std::printf("stage B: %d regions refined at 0.05 deg (~520 m)\n",
              (int)refined.size());

  // ===========================================================================
  // STAGE C: fine flat-spot search at 0.0025 deg (~26 m), 41x41 inside the best
  // regions. This is the stage that finds an actually LEVEL patch: local slope
  // and the 4 m step vary at a scale stage B cannot see. Scored on flatness
  // ALONE, because the scenery and the valley-floor character are properties of
  // the region and were already settled by stages A and B.
  // ===========================================================================
  const int kFine = std::min<int>(nRegions, (int)refined.size());
  std::fprintf(stderr, "stage C: fine search in %d regions...\n", kFine);
  std::vector<Site> finalists;
  for (int r = 0; r < kFine; ++r) {
    const Site& c = refined[r];
    Site best; bool have = false;
    for (int j = -20; j <= 20; ++j)
      for (int i = -20; i <= 20; ++i) {
        Site s;
        if (!makeSite(forge, c.latDeg + j * 0.0025, c.lonDeg + i * 0.0025,
                      minAlt, s)) continue;
        localFlatness(forge, s);
        s.score = -(3.0 * s.slope420 + 20.0 * s.worst4m);
        if (!have || s.score > best.score) { best = s; have = true; }
      }
    if (have) finalists.push_back(best);
  }
  // Sites named on the command line are scored WITHOUT the fine search, exactly
  // as given, so a previously-proposed lat/lon can be compared like for like.
  for (auto& p : also) {
    Site s;
    s.latDeg = snap5(p.first); s.lonDeg = snap5(wrapLon(p.second));
    s.dir = latLonToDir(s.latDeg * kDeg, s.lonDeg * kDeg);
    s.h = designedHeightNoPad(forge, s.dir);
    s.biome = biomeAt(forge, s.dir);
    localFlatness(forge, s);
    finalists.push_back(s);
  }

  // ===========================================================================
  // STAGE D: the full metric on every finalist, then rank.
  // ===========================================================================
  std::fprintf(stderr, "stage D: full metric on %d finalists...\n",
               (int)finalists.size());
  for (Site& s : finalists) {
    padDisc(forge, s);
    relief6km(forge, s);
    horizonScan(forge, s);
    computeScore(s);
  }
  std::sort(finalists.begin(), finalists.end(),
            [](const Site& a, const Site& b) { return a.score > b.score; });

  // ===========================================================================
  // STAGE E: polish. The fine grid steps 26 m and the noise stack's shortest
  // wavelength is about 60 m, so a 5 m search inside +/- 100 m of each leader
  // finds the flattest spot the field actually holds, without moving far enough
  // to leave the valley (the FLOOR and VIEW terms barely move over 100 m, so
  // polishing on flatness alone is safe here and is re-scored in full after).
  // ===========================================================================
  {
    const int nPolish = std::min<int>(8, (int)finalists.size());
    std::fprintf(stderr, "stage E: polishing %d leaders at 0.0005 deg...\n",
                 nPolish);
    for (int r = 0; r < nPolish; ++r) {
      Site best = finalists[r];
      double bestFlat = -(3.0 * best.slope420 + 20.0 * best.worst4m);
      for (int j = -20; j <= 20; ++j)
        for (int i = -20; i <= 20; ++i) {
          if (i == 0 && j == 0) continue;
          Site s;
          if (!makeSite(forge, finalists[r].latDeg + j * 0.0005,
                        finalists[r].lonDeg + i * 0.0005, minAlt, s)) continue;
          localFlatness(forge, s);
          const double fl = -(3.0 * s.slope420 + 20.0 * s.worst4m);
          if (fl > bestFlat) { bestFlat = fl; best = s; }
        }
      padDisc(forge, best);
      relief6km(forge, best);
      horizonScan(forge, best);
      computeScore(best);
      // Keep the polish only if it did not cost more than it bought.
      if (best.score > finalists[r].score) finalists[r] = best;
    }
    std::sort(finalists.begin(), finalists.end(),
              [](const Site& a, const Site& b) { return a.score > b.score; });
  }

  // The recommendation must survive a round trip through its own printed form:
  // re-parse the 5-dp lat/lon strings, rebuild the dir, and demand the height is
  // BIT-IDENTICAL. If this line ever says MISMATCH the literal names a different
  // patch of ground than the one measured.
  if (!finalists.empty()) {
    const Site& w = finalists[0];
    char sa[40], so[40];
    std::snprintf(sa, sizeof(sa), "%.5f", w.latDeg);
    std::snprintf(so, sizeof(so), "%.5f", w.lonDeg);
    const Vec3 rd = latLonToDir(std::strtod(sa, nullptr) * kDeg,
                                std::strtod(so, nullptr) * kDeg);
    const double rh = designedHeightNoPad(forge, rd);
    std::printf("\nround-trip check on the winner: lat \"%s\" lon \"%s\" -> "
                "height %.17g vs measured %.17g : %s\n",
                sa, so, rh, w.h, (rh == w.h) ? "BIT-IDENTICAL" : "MISMATCH");
  }

  // ===========================================================================
  // Report.
  // ===========================================================================
  std::printf("\n=== RANKED CANDIDATES (every height is designedHeightNoPad) "
              "===\n"
              "| # |       lat |        lon |    alt m | biome     | slope%% |"
              " 4m step | padRel | padGr%% | rel 6km | site-m6k | site-m1k |"
              " %%abv1 | max 8km | mtn |   score |\n");
  for (size_t i = 0; i < finalists.size(); ++i) {
    char tag[8];
    std::snprintf(tag, sizeof(tag), "%2d ", (int)i + 1);
    printRow(finalists[i], tag);
  }
  printRow(home, "NOW");
  std::printf("  (row NOW is the CURRENT spawn, lat 2 / lon 144. slope%% is the "
              "worse of the 4 m and 20 m rings; site-m6k / site-m1k are the "
              "site's height MINUS the mean of the 6 km box / 1 km disc, so "
              "NEGATIVE means a floor and POSITIVE means a tabletop.)\n");

  std::printf("\n=== DETAIL: top 5 ===\n");
  for (size_t i = 0; i < finalists.size() && i < 5; ++i) {
    char label[64];
    std::snprintf(label, sizeof(label), "RANK %d", (int)i + 1);
    printDetail(forge, finalists[i], label);
    probePadHere(forge, finalists[i]);
  }
  printDetail(forge, home, "CURRENT SPAWN (lat 2, lon 144)");
  probePadHere(forge, home);

  if (!finalists.empty()) {
    std::printf("\n=== cubed_sphere.h homeDir literal for the RECOMMENDATION "
                "===\n// lat %.4f deg, lon %.4f deg\n",
                finalists[0].latDeg, finalists[0].lonDeg);
    printHomeDirLiteral(finalists[0].latDeg, finalists[0].lonDeg, forge.radiusM);
  }
  if (finalists.size() > 1) {
    std::printf("\n=== homeDir literal for the RUNNER-UP ===\n"
                "// lat %.4f deg, lon %.4f deg\n",
                finalists[1].latDeg, finalists[1].lonDeg);
    printHomeDirLiteral(finalists[1].latDeg, finalists[1].lonDeg, forge.radiusM);
  }
  std::printf("\n=== homeDir literal for the CURRENT spawn (must reproduce the "
              "shipped literal) ===\n");
  printHomeDirLiteral(kHomeLatDeg, kHomeLonDeg, forge.radiusM);
  return pondOk ? 0 : 2;
}
