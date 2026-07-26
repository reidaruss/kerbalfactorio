// =============================================================================
// lod_probe.cpp — DW-19 measurement tool: what ground resolution does the
// TerrainStreamer actually deliver under a standing player, and what does each
// extra level cost?
//
// A pure CONSUMER of of_core (not a ctest, like journey_dump / procgen_bench).
// It answers four questions with numbers instead of assertions:
//
//   1. What LOD depth does the leaf UNDER THE PLAYER'S FEET reach, and what
//      vertex spacing (metres) does that give? (quadEdgeLengthM / 32 cells.)
//   2. Why does it stop there — maxDepth, or the split metric refusing to
//      subdivide? Reported per config so the two causes separate.
//   3. What does refining cost: resident chunk count, packed bytes (the web
//      pool's 27 B/vert x 1217 verts), and total mesh build time.
//   4. How much worse is it on a MOUNTAIN than on a plain? (The LOD split
//      metric measures distance to a point sampled from the RAW heightfield
//      while the player stands on the DESIGNED surface; where the two diverge
//      the metric over-estimates distance and refuses to split.)
//
// Usage: lod_probe [--json]
// =============================================================================
#include <cstdint>
#include <cmath>
#include <chrono>
#include <cstdio>
#include <cstring>
#include <string>
#include <vector>

#include "of/vec3.h"
#include "of/cubed_sphere.h"
#include "of/biome.h"
#include "of/terrain_stream.h"

using namespace of;
using namespace of::worldgen;

namespace {

constexpr double kDeg = 3.14159265358979323846 / 180.0;
// The web wire format: 1217 verts (33x33 interior + 128 skirt) x 27 B/vert.
constexpr double kBytesPerChunk = 1217.0 * 27.0;

struct Probe {
  int    resident = 0;
  int    deepest = 0;          // finest depth anywhere in the set
  int    feetDepth = 0;        // depth of the leaf containing the observer
  double feetCellM = 0.0;      // vertex spacing of that leaf (m)
  double buildMs = 0.0;        // total buildChunk time for the whole set
  double perChunkMs = 0.0;
  double bytesMB = 0.0;
  int    nearChunks = 0;       // depth >= 6 (the web nearDepthCutoff band)
  double selectMs = 0.0;       // selectResidentSet cost (the per-observe cost)
};

// The leaf whose centre direction is closest to the observer's direction: the
// quad the player is standing on.
int feetLeafIndex(const std::vector<FQuadKey>& leaves, const Vec3& obsDir) {
  int best = -1;
  double bestDot = -2.0;
  for (size_t i = 0; i < leaves.size(); ++i) {
    const Vec3 c = quadCenterDir(leaves[i]);
    const double d = c.x * obsDir.x + c.y * obsDir.y + c.z * obsDir.z;
    if (d > bestDot) { bestDot = d; best = static_cast<int>(i); }
  }
  return best;
}

Probe measure(const BodyParams& body, const UniverseCoord& obs,
              const StreamConfig& cfg, bool build) {
  Probe p;
  const auto ts0 = std::chrono::steady_clock::now();
  const std::vector<FQuadKey> leaves = selectResidentSet(body, obs, cfg);
  const auto ts1 = std::chrono::steady_clock::now();
  p.selectMs = std::chrono::duration<double, std::milli>(ts1 - ts0).count();
  p.resident = static_cast<int>(leaves.size());
  for (const auto& k : leaves) {
    if (k.depth > p.deepest) p.deepest = k.depth;
    if (k.depth >= 6) ++p.nearChunks;
  }
  Vec3 od = obs.pos;
  const double L = od.length();
  if (L > 0) od = Vec3(od.x / L, od.y / L, od.z / L);
  const int fi = feetLeafIndex(leaves, od);
  if (fi >= 0) {
    p.feetDepth = leaves[fi].depth;
    p.feetCellM = quadEdgeLengthM(body, leaves[fi]) / static_cast<double>(kGridDim - 1);
  }
  p.bytesMB = p.resident * kBytesPerChunk / (1024.0 * 1024.0);
  if (build) {
    const auto t0 = std::chrono::steady_clock::now();
    for (const auto& k : leaves) {
      TerrainChunk ch = buildChunk(body, k, cfg);
      // Touch the result so the build cannot be optimized away.
      if (ch.positions.empty()) std::fprintf(stderr, "empty chunk\n");
    }
    const auto t1 = std::chrono::steady_clock::now();
    p.buildMs = std::chrono::duration<double, std::milli>(t1 - t0).count();
    p.perChunkMs = p.resident > 0 ? p.buildMs / p.resident : 0.0;
  }
  return p;
}

// Observer standing ON the designed surface (what the walker does), NOT on the
// raw heightfield: this is the position the web pushes into the streamer.
UniverseCoord standOn(const BodyParams& body, double latDeg, double lonDeg,
                      double eyeM) {
  const Vec3 dir = latLonToDir(latDeg * kDeg, lonDeg * kDeg);
  const double h = sampleDesignedHeight(body, dir);
  return UniverseCoord(dir * (body.radiusM + h + eyeM),
                       static_cast<FrameId>(body.bodyId + 1));
}

struct Site { const char* name; double lat, lon; };

// Find a Mountains site by scanning a coarse lat/lon grid; deterministic.
Site findMountain(const BodyParams& body, double& outLat, double& outLon) {
  double bestRelief = -1e30;
  outLat = 0; outLon = 0;
  for (int i = 0; i < 180; ++i) {
    for (int j = 0; j < 360; ++j) {
      const double la = -85.0 + i;
      const double lo = -180.0 + j;
      const Vec3 d = latLonToDir(la * kDeg, lo * kDeg);
      if (biomeAt(body, d) != Biome::Mountains) continue;
      const double h = sampleDesignedHeight(body, d);
      if (h > bestRelief) { bestRelief = h; outLat = la; outLon = lo; }
    }
  }
  return Site{"mountain", outLat, outLon};
}

void row(const StreamConfig& cfg, const Probe& p) {
  std::printf("| %4.2f | %2d | %5d | %5d | %2d | %7.2f | %7.2f | %8.1f | %6.3f | %6.3f |\n",
              cfg.splitRatio, cfg.maxDepth, p.resident, p.nearChunks,
              p.feetDepth, p.feetCellM, p.bytesMB, p.buildMs, p.perChunkMs,
              p.selectMs);
}

}  // namespace

int main(int argc, char** argv) {
  bool buildAll = true;
  for (int i = 1; i < argc; ++i)
    if (std::strcmp(argv[i], "--noreset") == 0) buildAll = false;

  const uint64_t worldSeed = 200281345ull;  // the web default seed
  const BodyParams body = makeForge(worldSeed);

  double mlat = 0, mlon = 0;
  findMountain(body, mlat, mlon);

  // The web `surface` scenario spawn, and the worst-case mountain site.
  const struct { const char* name; double lat, lon; } sites[] = {
    {"plain (lat 2, lon 144)", 2.0, 144.0},
    {"mountain", mlat, mlon},
  };

  std::printf("# lod_probe — Forge R=%.0f km, seed %llu\n",
              body.radiusM / 1000.0, (unsigned long long)worldSeed);
  std::printf("# mountain site: lat %.1f lon %.1f, designed relief %.0f m, "
              "raw relief %.0f m (divergence %.0f m)\n",
              mlat, mlon,
              sampleDesignedHeight(body, latLonToDir(mlat * kDeg, mlon * kDeg)),
              sampleHeightField(body, latLonToDir(mlat * kDeg, mlon * kDeg)),
              sampleDesignedHeight(body, latLonToDir(mlat * kDeg, mlon * kDeg)) -
                  sampleHeightField(body, latLonToDir(mlat * kDeg, mlon * kDeg)));

  // Theoretical ground resolution per depth (equal-angle warp: a face spans 90
  // degrees exactly, so a depth-d quad is R*(pi/2)/2^d across, over 32 cells).
  std::printf("\n# cell size by depth (R*(pi/2)/2^d/32):\n#");
  for (int d = 10; d <= 16; ++d)
    std::printf("  d%d=%.2fm", d, body.radiusM * 1.5707963267948966 /
                                      std::pow(2.0, d) / 32.0);
  std::printf("\n");

  const double split[] = {1.0, 1.2, 1.4, 2.0, 3.0, 4.0};
  const int depths[] = {12, 13, 14, 15, 16};

  for (const auto& s : sites) {
    const UniverseCoord obs = standOn(body, s.lat, s.lon, 1.62);
    const Vec3 sd = latLonToDir(s.lat * kDeg, s.lon * kDeg);
    std::printf("\n## %s  (designed %.0f m, raw %.0f m, divergence %.0f m)\n",
                s.name, sampleDesignedHeight(body, sd),
                sampleHeightField(body, sd),
                sampleDesignedHeight(body, sd) - sampleHeightField(body, sd));
    std::printf("| spl | md | chunks | near | fd | cell m  | pool MB | build ms | ms/chk | sel ms |\n");
    std::printf("|-----|----|--------|------|----|---------|---------|----------|--------|--------|\n");
    for (double sr : split) {
      for (int md : depths) {
        StreamConfig cfg;
        cfg.splitRatio = sr;
        cfg.maxDepth = md;
        cfg.minResidentDepth = 2;
        cfg.skirtFraction = 0.15;
        cfg.genBudget = 0;
        const Probe p = measure(body, obs, cfg, buildAll);
        row(cfg, p);
      }
    }
  }
  return 0;
}
