// =============================================================================
// spawn_site.cpp: world-gen DIAGNOSTIC (WG-213). A pure CONSUMER of of_core,
// like site_probe / spawn_probe / terrain_probe; NOT a ctest.
//
// It answers the question WG-207 forced open: "where should the player spawn,
// given that the FIRST GOAL OF THE GAME IS TO GATHER WOOD?".
//
// -----------------------------------------------------------------------------
// WHY THIS EXISTS ALONGSIDE `spawn_probe`, WHICH ALREADY SEARCHES FOR A SPAWN
// -----------------------------------------------------------------------------
// `spawn_probe` (WG-55) is not wrong and is not superseded. It answered a
// different question, carefully: FLAT, TEMPERATE, SCENIC, DRY. Wood was not one
// of its four criteria because the treeline did not exist as a gameplay
// constraint when it was written.
//
// The consequence is exactly INSTRUMENTS.md's dominant failure, a control that
// depends on something that moved. Its shortlist's two Hills candidates sit at
// 2,077.2 m and 1,897.2 m, and the canopy survey in the same context file
// measured **0 canopy trees and 100% bare cells** at the first and **1 tree and
// 79% bare** at the second. Both are above `TREELINE_BARE_M`. Nobody made a
// mistake; the question changed underneath a correct answer.
//
// So this tool adds the criterion that decides it and keeps the rest.
//
// -----------------------------------------------------------------------------
// THE WOOD METRIC, AND WHY IT IS NOT A BIOME TEST
// -----------------------------------------------------------------------------
// `ScatterTuning.ts` puts the treeline on an ALTITUDE, not on a biome, and its
// own comment says why: "the survey has Hills at 861 m and at 2,077 m, a range
// of 1.2 km. That divergence is why an altitude is the right handle and a biome
// id is not." A Hills spawn therefore proves nothing about wood by itself,
// which is the whole reason the shortlist looks fine and is not.
//
// Expected trees in the shipped 620 m ring (`TREE_RADIUS_M`):
//
//   trees = area(disc) * density(biome) * fade(h)
//
// with `TREE_DENSITY_KM2` from `TreeTuning.ts` and `fade` the linear ramp from
// `TREELINE_FULL_M` 950 (full) to `TREELINE_BARE_M` 1850 (bare).
//
// **THE WANDER IS REPORTED AS A BAND, NOT SWALLOWED.** `TREELINE_WANDER_M` is
// 240 m and displaces the threshold by a world-space noise field so the treeline
// fingers up gullies. Reproducing that field here would be a SECOND COPY of a
// client rule in a second language, which is the thing this project keeps
// getting bitten by. Instead every site reports trees at h-240, h and h+240:
// the pessimistic column is the one to read, and a site whose pessimistic
// column is healthy cannot be surprised by the wander.
//
// -----------------------------------------------------------------------------
// THE PAD METRIC IS ON THE NATURAL GROUND, AND IT IS WG-208's NUMBER
// -----------------------------------------------------------------------------
// Every height here is `designedHeightNoPad`. The pad would otherwise flatten
// the very thing being measured and every candidate would read as perfect.
//
// The reported `padTilt`/`padResid` are a plane fit over the pad's own 150 m
// FLAT radius on the natural surface, so they say how much work the pad has to
// do. At the current spawn the pad turns a 13.300 degree hillside dead flat and
// gives 23.7 m back over 450 m of blend, reaching a 42.1% grade on the way out
// (WG-208). A site where the pad is a light touch does not have that ring.
//
// Usage:
//   spawn_site [--seed <hex|dec>] [--n <coarse>] [--top <n>] [--sep <km>]
//              [--maxalt <m>] [--minalt <m>] [--at <lat,lon>]...
//   --at forces a named site into the report for comparison (repeatable).
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
#include "of/poi.h"

using namespace of;
using namespace of::worldgen;
using namespace of::worldgen::poi;

namespace {

constexpr double kPi = 3.14159265358979323846;
constexpr double kDeg = kPi / 180.0;
constexpr uint64_t kDefaultWorldSeed = 0x0bf00d01ull;

// --- MIRRORED CLIENT CONSTANTS. Named with their source file, because a
//     duplicated constant with no provenance is how two systems drift apart.
//     If any of these move, this tool is reading a world the client does not
//     have. `test_spawn.cpp` asserts the spawn against the same numbers, so a
//     drift shows up as a failing gate rather than as a stale recommendation.
constexpr double kTreelineFullM = 950.0;    // ScatterTuning.ts TREELINE_FULL_M
constexpr double kTreelineBareM = 1850.0;   // ScatterTuning.ts TREELINE_BARE_M
constexpr double kTreelineWanderM = 240.0;  // ScatterTuning.ts TREELINE_WANDER_M
constexpr double kTreeRadiusM = 620.0;      // TreeTuning.ts   TREE_RADIUS_M
// TreeTuning.ts TREE_DENSITY_KM2, indexed by biome.h's Biome.
const double kTreeDensityKm2[10] = {
  0.0,     // Ocean
  0.0,     // Beach      (the desert stays the desert: NO WOOD AT ALL)
  420.0,   // Plains
  3840.0,  // Forest
  1200.0,  // Hills
  480.0,   // Mountains
  0.0,     // Polar
  0.0, 0.0, 0.0,   // moon biomes
};
// The pad, read from the body rather than typed.
double gPadFlatR = 150.0;

/**
 * HIGHEST THE SUN EVER GETS AT A LATITUDE, degrees.
 *
 * WG-53 measured this at six sites and found it decides the whole look of a
 * spawn: at lat -57.94 the sun never rises above 9.3 degrees, so that site is
 * in permanent low golden light at every hour of every day. That is a decision
 * rather than a surprise, and it is the sort of thing discovered a week after
 * the spawn moved.
 *
 * There are no seasons in this sim: the sun is one vector in the body frame, so
 * a single declination describes it. `kSunDeclDeg` is FITTED to WG-53's own six
 * measured rows (69.2, 59.3, 47.4, 36.1, 31.6, 9.3 at lat 2.00, -7.97, -19.85,
 * -31.17, -35.60, -57.94) and reproduces all six to within 0.07 degrees. It is
 * a fit to this lane's measurements, stated as one, NOT a constant read from
 * the renderer: if the sun ever gains a tilt or a season, this becomes wrong
 * and the fit residual is where it will show.
 */
constexpr double kSunDeclDeg = 22.8;
double sunMaxElevDeg(double latDeg) {
  return 90.0 - std::fabs(latDeg - kSunDeclDeg);
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

/** The client's treeline ramp: 1 below FULL, 0 above BARE, linear between. */
double treelineFade(double h) {
  if (h <= kTreelineFullM) return 1.0;
  if (h >= kTreelineBareM) return 0.0;
  return (kTreelineBareM - h) / (kTreelineBareM - kTreelineFullM);
}

double snap5(double v) {
  char b[40];
  std::snprintf(b, sizeof(b), "%.5f", v);
  return std::strtod(b, nullptr);
}

double wrapLon(double lonDeg) {
  while (lonDeg >= 180.0) lonDeg -= 360.0;
  while (lonDeg < -180.0) lonDeg += 360.0;
  return lonDeg;
}

struct Site {
  Vec3 dir;
  double latDeg = 0, lonDeg = 0;
  double h = 0;
  Biome biome = Biome::Unknown;
  // The pad's work: a plane fit over the pad's own flat radius, NATURAL ground.
  double padTiltDeg = 0, padResidP95M = 0, padSpanM = 0;
  // Wood in the shipped 620 m ring, at h-wander / h / h+wander.
  double treesLo = 0, treesMid = 0, treesHi = 0;
  // Scenery: relief inside a 6 km box, and how much of it stands above the
  // site (a valley FLOOR sits below its surroundings, a tabletop does not).
  double relief6k = 0, pctAbove6k = 0;
  // Ring composition. The shortlist's own warning was "do not ship the probe's
  // rank 1, it sits 0.0057 under kMountainsRel so a tuning nudge flips it".
  // A site whose 620 m tree ring is one biome cannot be flipped by a nudge; a
  // site sitting on a boundary can, and the reader should see which it is.
  double ringSameBiomePct = 0, ringWoodlessPct = 0;
  double nearestMountainsKm = 99.0;
  double score = 0;
  const char* label = "";
};

/** Plane fit over a disc of radius rM on the NATURAL (un-padded) surface. */
void measurePadDisc(const BodyParams& body, const Vec3& dir, double rM,
                    double* tiltDeg, double* residP95M, double* spanM) {
  // A body with the pad and pond zeroed, so the fit sees the ground the pad
  // would have to flatten rather than the ground the pad already flattened.
  BodyParams bare = body;
  bare.homeFlatRadiusM = 0.0;
  bare.homeBlendRadiusM = 0.0;
  bare.pondRadiusM = 0.0;
  const FootMeasure m = measureFootprint(bare, dir, rM);
  *tiltDeg = m.tiltDeg;
  *residP95M = m.residP95M;
  *spanM = m.spanM;
}

void measureWood(const BodyParams& body, const Vec3& dir, Site* s) {
  const geom::Tangent f = geom::tangentAt(dir);
  const double R = body.radiusM;
  // A 15 x 15 grid clipped to the disc: 177 samples inside a 620 m ring, which
  // is one sample per 6,800 m^2 against a 28 m tree lattice cell of 784 m^2.
  // Coarser than the lattice on purpose: this estimates the DENSITY FIELD the
  // lattice is sampled from, not the trees themselves.
  double areaKm2 = kPi * (kTreeRadiusM / 1000.0) * (kTreeRadiusM / 1000.0);
  double sumLo = 0, sumMid = 0, sumHi = 0;
  int n = 0, nSame = 0, nWoodless = 0;
  const Biome home = biomeAt(body, dir);
  for (int iy = -7; iy <= 7; ++iy) {
    for (int ix = -7; ix <= 7; ++ix) {
      const double x = ix * (kTreeRadiusM / 7.0), y = iy * (kTreeRadiusM / 7.0);
      if (x * x + y * y > kTreeRadiusM * kTreeRadiusM) continue;
      const Vec3 d = geom::offsetDir(f, R, x, y);
      const Biome b = biomeAt(body, d);
      const int bi = static_cast<int>(b);
      const double dens = (bi >= 0 && bi < 10) ? kTreeDensityKm2[bi] : 0.0;
      if (b == home) ++nSame;
      if (dens <= 0.0) { ++nWoodless; ++n; continue; }
      const double h = designedHeightNoPad(body, d);
      sumMid += dens * treelineFade(h);
      sumLo  += dens * treelineFade(h + kTreelineWanderM);
      sumHi  += dens * treelineFade(h - kTreelineWanderM);
      ++n;
    }
  }
  if (n == 0) return;
  s->ringSameBiomePct = 100.0 * nSame / n;
  s->ringWoodlessPct = 100.0 * nWoodless / n;
  s->treesMid = areaKm2 * sumMid / n;
  s->treesLo  = areaKm2 * sumLo  / n;
  s->treesHi  = areaKm2 * sumHi  / n;
}

void measureScenery(const BodyParams& body, const Vec3& dir, Site* s) {
  const geom::Tangent f = geom::tangentAt(dir);
  const double R = body.radiusM;
  double lo = 1e30, hi = -1e30;
  int above = 0, n = 0;
  double nearestMtn = 1e30;
  for (int iy = -10; iy <= 10; ++iy) {
    for (int ix = -10; ix <= 10; ++ix) {
      const double x = ix * 300.0, y = iy * 300.0;   // a 6 km box
      const Vec3 d = geom::offsetDir(f, R, x, y);
      const double h = designedHeightNoPad(body, d);
      if (h < lo) lo = h;
      if (h > hi) hi = h;
      if (h > s->h) ++above;
      ++n;
      if (biomeAt(body, d) == Biome::Mountains) {
        const double r = std::sqrt(x * x + y * y);
        if (r < nearestMtn) nearestMtn = r;
      }
    }
  }
  s->relief6k = hi - lo;
  s->pctAbove6k = 100.0 * above / n;
  s->nearestMountainsKm = nearestMtn < 1e29 ? nearestMtn / 1000.0 : 99.0;
}

}  // namespace

int main(int argc, char** argv) {
  uint64_t seed = kDefaultWorldSeed;
  int coarse = 400000, top = 10;
  double sepKm = 400.0, maxAltM = 900.0, minAltM = 30.0;
  // Filters, so a target stated in words ("a Hills valley floor below the
  // treeline, with real relief") can be asked for directly instead of being
  // hunted for in a score somebody tuned.
  const char* wantBiome = "";
  double minRelief = 0.0, maxPadResid = 1e30, maxPadTilt = 1e30;
  double minTrees = 0.0, minSunDeg = 0.0;
  std::vector<std::pair<double, double>> named;
  std::vector<const char*> namedLabels;
  for (int i = 1; i < argc; ++i) {
    auto next = [&]() -> const char* { return (i + 1 < argc) ? argv[++i] : ""; };
    if (!std::strcmp(argv[i], "--seed")) seed = std::strtoull(next(), nullptr, 0);
    else if (!std::strcmp(argv[i], "--n")) coarse = std::atoi(next());
    else if (!std::strcmp(argv[i], "--top")) top = std::atoi(next());
    else if (!std::strcmp(argv[i], "--sep")) sepKm = std::strtod(next(), nullptr);
    else if (!std::strcmp(argv[i], "--maxalt")) maxAltM = std::strtod(next(), nullptr);
    else if (!std::strcmp(argv[i], "--minalt")) minAltM = std::strtod(next(), nullptr);
    else if (!std::strcmp(argv[i], "--biome")) wantBiome = next();
    else if (!std::strcmp(argv[i], "--minrelief")) minRelief = std::strtod(next(), nullptr);
    else if (!std::strcmp(argv[i], "--maxresid")) maxPadResid = std::strtod(next(), nullptr);
    else if (!std::strcmp(argv[i], "--maxtilt")) maxPadTilt = std::strtod(next(), nullptr);
    else if (!std::strcmp(argv[i], "--mintrees")) minTrees = std::strtod(next(), nullptr);
    else if (!std::strcmp(argv[i], "--minsun")) minSunDeg = std::strtod(next(), nullptr);
    else if (!std::strcmp(argv[i], "--at")) {
      const char* a = next();
      double la = 0, lo = 0;
      if (std::sscanf(a, "%lf,%lf", &la, &lo) == 2) {
        named.push_back({la, lo});
        namedLabels.push_back("named");
      }
    }
  }
  const BodyParams body = makeForge(seed);
  gPadFlatR = body.homeFlatRadiusM > 0 ? body.homeFlatRadiusM : 150.0;
  const double R = body.radiusM;

  std::printf("=============================================================\n");
  std::printf("spawn_site  seed 0x%llx  bodySeed 0x%llx  radius %.0f m\n",
              (unsigned long long)seed, (unsigned long long)body.bodySeed, R);
  std::printf("pad flat %.0f m, blend %.0f m   treeline %.0f full / %.0f bare"
              " (wander +/-%.0f)   tree ring %.0f m\n",
              body.homeFlatRadiusM, body.homeBlendRadiusM, kTreelineFullM,
              kTreelineBareM, kTreelineWanderM, kTreeRadiusM);
  std::printf("coarse %d, altitude band [%.0f, %.0f] m, separation %.0f km\n",
              coarse, minAltM, maxAltM, sepKm);
  std::printf("=============================================================\n\n");

  // ---------------------------------------------------------------------------
  // COARSE SWEEP. Fibonacci sphere, so cells cover equal area and a best-of-N
  // is not biased poleward the way a fixed lon step is.
  // ---------------------------------------------------------------------------
  std::vector<Site> keep;
  int nOcean = 0, nBiome = 0, nAlt = 0;
  for (int i = 0; i < coarse; ++i) {
    const double t = (i + 0.5) / static_cast<double>(coarse);
    const double y = 1.0 - 2.0 * t;
    const double rr = std::sqrt(y * y < 1.0 ? 1.0 - y * y : 0.0);
    const double a = 2.39996322972865332 * i;
    const Vec3 d(std::cos(a) * rr, y, std::sin(a) * rr);
    const Biome b = biomeAt(body, d);
    if (b == Biome::Ocean) { ++nOcean; continue; }
    if (!temperate(b)) { ++nBiome; continue; }
    if (wantBiome[0] != '\0' && std::strcmp(biomeName(b), wantBiome) != 0) {
      ++nBiome; continue;
    }
    const double h = designedHeightNoPad(body, d);
    // THE GATE THE OLD SHORTLIST DID NOT HAVE. Below the FULL treeline minus
    // the wander, so no instance of the displaced threshold can put this site
    // in thinning forest.
    if (h < minAltM || h > maxAltM) { ++nAlt; continue; }
    Site s;
    s.dir = d;
    s.h = h;
    s.biome = b;
    keep.push_back(s);
  }
  std::printf("--- COARSE SWEEP ---\n");
  std::printf("%d points: %d ocean, %d wrong biome, %d outside the altitude"
              " band, %zu survive\n\n", coarse, nOcean, nBiome, nAlt,
              keep.size());
  if (keep.empty()) {
    std::printf("NOTHING SURVIVED. That is a finding, not an error.\n");
    return 0;
  }

  // Thin to distinct PLACES before paying for the expensive metric, so the
  // finalists are different valleys rather than fifty samples of one.
  std::vector<Site> distinct;
  for (const Site& s : keep) {
    bool close = false;
    for (const Site& d2 : distinct)
      if (geom::arcBetween(s.dir, d2.dir, R) < sepKm * 1000.0) { close = true; break; }
    if (!close) distinct.push_back(s);
    if (distinct.size() >= 900) break;
  }
  std::printf("thinned to %zu distinct places at a %.0f km separation\n\n",
              distinct.size(), sepKm);

  for (Site& s : distinct) {
    measurePadDisc(body, s.dir, gPadFlatR, &s.padTiltDeg, &s.padResidP95M,
                   &s.padSpanM);
    measureWood(body, s.dir, &s);
    measureScenery(body, s.dir, &s);
    s.latDeg = std::asin(s.dir.y) / kDeg;
    s.lonDeg = wrapLon(std::atan2(s.dir.z, s.dir.x) / kDeg);
    // The score is deliberately simple and every term is a stated criterion:
    // flat ground under the pad, wood in the ring, and something to look at.
    // It ranks; it does not decide. The table below it is the deliverable.
    const double flat = 1.0 / (1.0 + s.padTiltDeg);
    const double wood = s.treesLo / 2000.0;
    const double view = std::min(1.0, s.relief6k / 600.0);
    s.score = flat * 2.0 + std::min(wood, 1.5) + view * 0.75;
  }
  // The stated filters, applied AFTER the expensive metric because they read
  // it. Refusals are counted rather than dropped, so "no candidate" is
  // distinguishable from "the sweep found nothing to measure".
  {
    std::vector<Site> pass;
    int rRelief = 0, rResid = 0, rTilt = 0, rTrees = 0; int rSun = 0; (void)rSun;
    for (const Site& s : distinct) {
      if (sunMaxElevDeg(s.latDeg) < minSunDeg) { ++rSun; continue; }  // NOLINT
      if (s.relief6k < minRelief) { ++rRelief; continue; }
      if (s.padResidP95M > maxPadResid) { ++rResid; continue; }
      if (s.padTiltDeg > maxPadTilt) { ++rTilt; continue; }
      if (s.treesLo < minTrees) { ++rTrees; continue; }
      pass.push_back(s);
    }
    if (minRelief > 0 || maxPadResid < 1e29 || maxPadTilt < 1e29 || minTrees > 0)
      std::printf("filters refused: relief %d, padResid %d, padTilt %d,"
                  " trees %d -> %zu remain\n\n",
                  rRelief, rResid, rTilt, rTrees, pass.size());
    distinct.swap(pass);
  }
  if (distinct.empty()) {
    std::printf("NO CANDIDATE MEETS THE STATED FILTERS. That is a finding.\n");
    return 0;
  }
  std::sort(distinct.begin(), distinct.end(),
            [](const Site& a, const Site& b) { return a.score > b.score; });

  // ---------------------------------------------------------------------------
  // THE CONTROLS: today's spawn and the WG-55 shortlist, measured by the SAME
  // instrument. A recommendation is only as good as the thing it beats.
  // ---------------------------------------------------------------------------
  struct Ctl { const char* name; double lat, lon; };
  const Ctl kControls[] = {
    {"CURRENT spawn", 2.00000, 144.00000},
    {"WG-55 hills",  -31.16500, -86.27401},
    {"WG-55 hills2",  22.28600, 108.84406},
    {"WG-55 plains",  -7.96750, 116.53189},
    {"WG-55 beach",  -35.60280,  53.30131},
    {"WG-55 forest", -19.85000, -72.78530},
    {"RN-15 camera",   0.0, 0.0},   // filled below only if asked
  };
  std::printf("--- THE CONTROLS: today's spawn and the WG-55 shortlist,"
              " through THIS instrument ---\n");
  std::printf("%-15s %10s %11s %8s %-10s %7s %8s %9s %9s %9s %7s\n",
              "site", "lat", "lon", "alt m", "biome", "padTilt", "padResid",
              "trees-lo", "trees", "trees-hi", "relief");
  for (int i = 0; i < 6; ++i) {
    Site s;
    s.dir = latLonToDir(kControls[i].lat * kDeg, kControls[i].lon * kDeg);
    s.h = designedHeightNoPad(body, s.dir);
    s.biome = biomeAt(body, s.dir);
    measurePadDisc(body, s.dir, gPadFlatR, &s.padTiltDeg, &s.padResidP95M,
                   &s.padSpanM);
    measureWood(body, s.dir, &s);
    measureScenery(body, s.dir, &s);
    std::printf("%-15s %10.5f %11.5f %8.1f %-10s %7.3f %8.3f %9.0f %9.0f %9.0f %7.0f\n",
                kControls[i].name, kControls[i].lat, kControls[i].lon, s.h,
                biomeName(s.biome), s.padTiltDeg, s.padResidP95M,
                s.treesLo, s.treesMid, s.treesHi, s.relief6k);
  }
  std::printf("\ntrees-lo is the PESSIMISTIC treeline wander (+240 m) and is the"
              " column to read.\n\n");

  // ---------------------------------------------------------------------------
  std::printf("--- THE CANDIDATES ---\n");
  std::printf("%10s %11s %8s %-10s %7s %8s %9s %7s %7s %7s %7s\n",
              "lat", "lon", "alt m", "biome", "padTilt", "padResid",
              "trees-lo", "relief", "%above", "ringSam", "sunMax");
  const int shown = std::min<int>(top, static_cast<int>(distinct.size()));
  for (int i = 0; i < shown; ++i) {
    const Site& s = distinct[static_cast<size_t>(i)];
    std::printf("%10.5f %11.5f %8.1f %-10s %7.3f %8.3f %9.0f %7.0f %7.1f %7.1f %7.1f\n",
                snap5(s.latDeg), snap5(s.lonDeg), s.h, biomeName(s.biome),
                s.padTiltDeg, s.padResidP95M, s.treesLo,
                s.relief6k, s.pctAbove6k, s.ringSameBiomePct,
                sunMaxElevDeg(s.latDeg));
  }

  // ---------------------------------------------------------------------------
  // THE LITERALS, for whichever site is picked. DW-14: homeDir and pondDir are
  // literal unit vectors and never computed with trig at runtime, because
  // cos/sin can differ by 1 ULP between mingw libm and emscripten musl and
  // height is position-hashed from raw bits.
  //
  // pondDir is homeDir rotated 55 m along a heading 30 degrees east of north
  // (WG-57: move homeDir without recomputing this and the basin is orphaned in
  // whatever biome sits 55 m from a site nobody chose).
  // ---------------------------------------------------------------------------
  for (int i = 0; i < shown && i < 3; ++i) {
    const Site& s = distinct[static_cast<size_t>(i)];
    const double la = snap5(s.latDeg), lo = snap5(s.lonDeg);
    const Vec3 hd = latLonToDir(la * kDeg, lo * kDeg);
    const geom::Tangent f = geom::tangentAt(hd);
    const double hdg = 30.0 * kDeg;
    const Vec3 pd = geom::offsetDir(f, R, std::sin(hdg) * 55.0,
                                    std::cos(hdg) * 55.0);
    std::printf("\n--- LITERALS for candidate %d, lat %.5f lon %.5f ---\n",
                i + 1, la, lo);
    std::printf("  b.homeDir = Vec3(%.17g, %.17g,\n                   %.17g);\n",
                hd.x, hd.y, hd.z);
    std::printf("  b.pondDir = Vec3(%.17g, %.17g,\n                   %.17g);\n",
                pd.x, pd.y, pd.z);
    std::printf("  separation %.6f m (must be 55.000000), |homeDir|-1 = %.3g,"
                " |pondDir|-1 = %.3g\n",
                geom::arcBetween(hd, pd, R), hd.length() - 1.0,
                pd.length() - 1.0);
  }
  return 0;
}
