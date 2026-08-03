// Headless tests for THE SPAWN (WG-213 to WG-218): the gate that would have
// caught the drift.
//
// -----------------------------------------------------------------------------
// WHY THIS FILE EXISTS, WHICH IS THE WHOLE POINT OF IT
// -----------------------------------------------------------------------------
// `Config.ts:31` described the spawn, in prose, as "a Hills valley floor at
// 2,963 m". Measured at HEAD on 2026-08-03 the spawn was **4,667.789 m in the
// MOUNTAINS**: a drift of +1,704.789 m and a biome change, and nobody noticed,
// because the only thing making the claim was a comment.
//
// The consequence was not cosmetic. `TREELINE_BARE_M` is 1850 m, so the spawn
// stood 2,817.8 m above the treeline, and a sweep found 100% Mountains and 0%
// sub-treeline ground at every band out to 20 km. **The only wood within 20 km
// was the 14 hand-placed starter trees, and the first goal of the game is
// "gather wood".**
//
// This project has written down twice this week that prose is for the reason
// and never for the constraint: "when you write down a relationship between two
// authored values, either DERIVE one from the other or ASSERT it in the build".
// So the spawn's description is now a set of assertions, and the comment in
// `makeForge` points at them.
//
// EVERY THRESHOLD BELOW IS DELIBERATELY LOOSER THAN THE CHOSEN SITE. A gate
// tuned to the site it was written for fails on any change at all and gets
// deleted; a gate with a stated band fails only when the property it names
// stops being true. Each one prints its measured value beside its bound.
//
// -----------------------------------------------------------------------------
// THE CONSTANTS THIS DUPLICATES, AND THE HONEST NOTE ABOUT THEM
// -----------------------------------------------------------------------------
// The treeline and the tree densities live in the CLIENT (`ScatterTuning.ts`,
// `TreeTuning.ts`) because vegetation is drawn there. This file therefore holds
// a SECOND COPY of four numbers, which is a thing this project keeps getting
// bitten by. It is done deliberately and with the trade named: a gate in C++
// that duplicates a TS constant can go stale, but a spawn with no gate at all
// already drifted 1.7 km. **The right long-term home is `BodyParams`**, and
// that is flagged rather than done here, because moving a client constant into
// a body parameter is a cross-domain change and this is not the pass for it.
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <vector>

#include "test_framework.h"
#include "of/vec3.h"
#include "of/cubed_sphere.h"
#include "of/biome.h"
#include "of/water_field.h"
#include "of/poi.h"

using namespace of;
using namespace of::worldgen;
using namespace of::worldgen::poi;

namespace {

constexpr uint64_t kSeed = 0x0bf00d01ull;   // web/src/app/Config.ts default
constexpr double kPi = 3.14159265358979323846;
constexpr double kDeg = kPi / 180.0;

// --- MIRRORED CLIENT CONSTANTS, each with the file that owns it. ---
constexpr double kTreelineFullM = 950.0;    // ScatterTuning.ts TREELINE_FULL_M
constexpr double kTreelineBareM = 1850.0;   // ScatterTuning.ts TREELINE_BARE_M
constexpr double kTreelineWanderM = 240.0;  // ScatterTuning.ts TREELINE_WANDER_M
constexpr double kTreeRadiusM = 620.0;      // TreeTuning.ts   TREE_RADIUS_M
const double kTreeDensityKm2[10] = {        // TreeTuning.ts   TREE_DENSITY_KM2
  0.0, 0.0, 420.0, 3840.0, 1200.0, 480.0, 0.0, 0.0, 0.0, 0.0,
};
// web/src/app/Config.ts HOME, which must agree with `homeDir` or the client
// spawns somewhere the body constants know nothing about.
constexpr double kConfigLatDeg = -3.41413;
constexpr double kConfigLonDeg = 150.27984;

const char* biomeName(Biome b) {
  static const char* kNames[] = {"Ocean", "Beach", "Plains", "Forest", "Hills",
                                 "Mountains", "Polar", "Regolith",
                                 "MoonHighland", "CraterFloor", "Unknown"};
  const int i = static_cast<int>(b);
  return (i >= 0 && i < 11) ? kNames[i] : "Unknown";
}

double treelineFade(double h) {
  if (h <= kTreelineFullM) return 1.0;
  if (h >= kTreelineBareM) return 0.0;
  return (kTreelineBareM - h) / (kTreelineBareM - kTreelineFullM);
}

/** Expected trees in the shipped 620 m ring, at a treeline offset by `wanderM`
 *  (positive = the pessimistic direction, the treeline pushed DOWN onto us). */
double treesInRing(const BodyParams& body, const Vec3& dir, double wanderM) {
  const geom::Tangent f = geom::tangentAt(dir);
  const double areaKm2 = kPi * (kTreeRadiusM / 1000.0) * (kTreeRadiusM / 1000.0);
  double sum = 0;
  int n = 0;
  for (int iy = -7; iy <= 7; ++iy) {
    for (int ix = -7; ix <= 7; ++ix) {
      const double x = ix * (kTreeRadiusM / 7.0), y = iy * (kTreeRadiusM / 7.0);
      if (x * x + y * y > kTreeRadiusM * kTreeRadiusM) continue;
      const Vec3 d = geom::offsetDir(f, body.radiusM, x, y);
      const int bi = static_cast<int>(biomeAt(body, d));
      const double dens = (bi >= 0 && bi < 10) ? kTreeDensityKm2[bi] : 0.0;
      ++n;
      if (dens <= 0.0) continue;
      sum += dens * treelineFade(designedHeightNoPad(body, d) + wanderM);
    }
  }
  return n > 0 ? areaKm2 * sum / n : 0.0;
}

/** The pad's own work: a plane fit over the pad's flat radius on NATURAL
 *  ground, with the pad and pond removed so the fit is not measuring the
 *  flattening it exists to assess. */
FootMeasure padWork(const BodyParams& body) {
  BodyParams bare = body;
  bare.homeFlatRadiusM = 0.0;
  bare.homeBlendRadiusM = 0.0;
  bare.pondRadiusM = 0.0;
  return measureFootprint(bare, body.homeDir, body.homeFlatRadiusM);
}

}  // namespace

// =============================================================================
// 1. THE SPAWN IS WHERE THE CLIENT THINKS IT IS.
//    `homeDir` is a DW-14 literal and `Config.ts` is a lat/lon. Two encodings
//    of one place, and nothing checked they agreed.
// =============================================================================
TEST(the_homedir_literal_is_the_lat_lon_config_ts_ships) {
  const BodyParams forge = makeForge(kSeed);
  const Vec3 want = latLonToDir(kConfigLatDeg * kDeg, kConfigLonDeg * kDeg);
  const double dx = forge.homeDir.x - want.x;
  const double dy = forge.homeDir.y - want.y;
  const double dz = forge.homeDir.z - want.z;
  const double offM = forge.radiusM * std::sqrt(dx * dx + dy * dy + dz * dz);
  std::printf("    homeDir vs Config.ts lat %.5f lon %.5f: %.6f m apart,"
              " |homeDir| - 1 = %.3g\n",
              kConfigLatDeg, kConfigLonDeg, offM, forge.homeDir.length() - 1.0);
  // 1e-12 of a unit vector on a 600 km body is 6e-7 m. The bound is 0.001 m,
  // which is the resolution the 5-decimal lat/lon can express at all.
  CHECK(offM < 1.0e-3);
  CHECK(std::fabs(forge.homeDir.length() - 1.0) < 1e-12);
}

// =============================================================================
// 2. THE CLAIM `Config.ts` MAKES, ASSERTED. This is the gate that would have
//    caught the +1,704.789 m drift on the commit that caused it.
// =============================================================================
TEST(the_spawn_is_a_hills_valley_floor_below_the_treeline) {
  const BodyParams forge = makeForge(kSeed);
  const double h = designedHeightNoPad(forge, forge.homeDir);
  const Biome b = biomeAt(forge, forge.homeDir);
  std::printf("    spawn: %.3f m, biome %s\n", h, biomeName(b));

  // (a) A TREE-BEARING BIOME. Not "Hills" specifically: Plains and Forest are
  //     both legitimate spawns and pinning the exact biome would fail on a
  //     deliberate move rather than on a drift. What may NEVER be true is
  //     Mountains, Polar, Ocean or Beach, all of which carry zero or near-zero
  //     tree density.
  CHECK(b == Biome::Hills || b == Biome::Forest || b == Biome::Plains);

  // (b) BELOW THE TREELINE WITH THE WANDER'S OWN MARGIN. The threshold is
  //     displaced by up to TREELINE_WANDER_M, so being under BARE is not
  //     enough: under FULL - WANDER means no instance of the displaced
  //     treeline can put the spawn in thinning forest.
  std::printf("    treeline: FULL %.0f, BARE %.0f, wander %.0f"
              " -> the spawn must be under %.0f m\n",
              kTreelineFullM, kTreelineBareM, kTreelineWanderM,
              kTreelineBareM - kTreelineWanderM);
  CHECK(h < kTreelineBareM - kTreelineWanderM);

  // (c) NOT A LAKE BED and not at sea level, so the pad is on real ground.
  CHECK(h > 30.0);
  CHECK(water::depthAt(forge, forge.homeDir) <= 0.0);
}

// =============================================================================
// 3. THERE IS WOOD HERE. The one that matters, because it is the storyline's
//    first goal and the reason the spawn moved.
// =============================================================================
TEST(there_is_wood_within_the_shipped_tree_ring) {
  const BodyParams forge = makeForge(kSeed);
  const double mid = treesInRing(forge, forge.homeDir, 0.0);
  const double lo = treesInRing(forge, forge.homeDir, kTreelineWanderM);
  const double hi = treesInRing(forge, forge.homeDir, -kTreelineWanderM);
  std::printf("    estimated trees in the %.0f m ring: %.0f pessimistic,"
              " %.0f nominal, %.0f optimistic\n", kTreeRadiusM, lo, mid, hi);
  // 400 is the bound and it is deliberately far below the site's own number.
  // For scale: the OLD spawn scored 0 on all three columns, the WG-55 Hills
  // shortlist scored 0 pessimistic at 2,077 m and 1,897 m, and Beach scores 0
  // by table because the desert has no wood at all. Anything that trips this
  // has put the spawn somewhere a player cannot start the game.
  CHECK(lo > 400.0);
  // Two-sided: the estimate must also be finite and not absurd. A ring cannot
  // hold more trees than the densest biome at full density.
  CHECK(hi < 5000.0);
}

// =============================================================================
// 4. THE PAD IS NOT DOING THE WORK OF A CUT SHELF (WG-208).
// =============================================================================
TEST(the_pad_sits_on_ground_that_is_already_nearly_flat) {
  const BodyParams forge = makeForge(kSeed);
  const FootMeasure m = padWork(forge);
  std::printf("    natural ground over the pad's %.0f m flat radius:"
              " tilt %.3f deg, p95 residual %.3f m, span %.3f m\n",
              forge.homeFlatRadiusM, m.tiltDeg, m.residP95M, m.spanM);
  std::printf("    (the OLD spawn measured 10.517 deg and 8.424 m here)\n");
  // Bounds set between the old site and the new one, so this is a real
  // discriminator rather than a rubber stamp: it fails on the old spawn.
  CHECK(m.tiltDeg < 6.0);
  CHECK(m.residP95M < 6.0);
}

// =============================================================================
// 5. THE POND MOVED WITH THE PAD (WG-57). Move `homeDir` and forget `pondDir`
//    and the basin is orphaned in whatever biome sits 55 m from a site nobody
//    chose.
// =============================================================================
TEST(the_pond_moved_with_the_pad_and_is_inside_the_flat_disc) {
  const BodyParams forge = makeForge(kSeed);
  const double sep = geom::arcBetween(forge.homeDir, forge.pondDir,
                                      forge.radiusM);
  std::printf("    pond is %.6f m from the pad centre (flat radius %.1f m)\n",
              sep, forge.homeFlatRadiusM);
  CHECK(std::fabs(sep - 55.0) < 0.01);
  // Wholly inside the dead-flat disc, INCLUDING its rim, so the ground the
  // basin is cut into is the pad's own bit-exact constant and the shoreline is
  // a circle rather than a contour of the noise.
  CHECK(sep + forge.pondRadiusM < forge.homeFlatRadiusM);
  CHECK(std::fabs(forge.pondDir.length() - 1.0) < 1e-12);
}

// =============================================================================
// 6. THE VIEW. `Config.ts` has always said the start is "deliberately on rugged
//    land: an ocean or plateau start makes every terrain screenshot useless",
//    and the WG-55 shortlist's Plains and Forest candidates were flagged for
//    exactly this (26 m and 23 m of relief in a 6 km box).
// =============================================================================
TEST(the_spawn_is_on_rugged_land_and_is_a_floor_rather_than_a_tabletop) {
  const BodyParams forge = makeForge(kSeed);
  const geom::Tangent f = geom::tangentAt(forge.homeDir);
  const double h = designedHeightNoPad(forge, forge.homeDir);
  double lo = 1e30, hi = -1e30;
  int above = 0, n = 0;
  for (int iy = -10; iy <= 10; ++iy)
    for (int ix = -10; ix <= 10; ++ix) {
      const Vec3 d = geom::offsetDir(f, forge.radiusM, ix * 300.0, iy * 300.0);
      const double hh = designedHeightNoPad(forge, d);
      if (hh < lo) lo = hh;
      if (hh > hi) hi = hh;
      if (hh > h) ++above;
      ++n;
    }
  const double relief = hi - lo;
  const double pctAbove = 100.0 * above / n;
  std::printf("    inside a 6 km box: %.0f m of relief, %.1f%% of it stands"
              " above the spawn\n", relief, pctAbove);
  // Rugged, and a FLOOR rather than a tabletop. A plateau has relief and
  // almost nothing above it; a valley floor has most of its surroundings
  // above. Both halves are needed: relief alone passes a hilltop.
  CHECK(relief > 250.0);
  CHECK(pctAbove > 35.0);
}

// =============================================================================
// 7. THE RUIN STILL PLACES, AND IT MOVED WITH THE SPAWN.
//    This is the WG-200 design paying off: the anchor is read from the body,
//    so a spawn move needs no edit to poi.h. Asserted rather than assumed.
// =============================================================================
TEST(the_ruin_follows_the_spawn_and_is_still_a_walk_away) {
  const BodyParams forge = makeForge(kSeed);
  SiteCatalog cat = SiteCatalog::ForBody(forge);
  CHECK(cat.size() == 1);
  if (cat.size() == 0) return;
  const FSite& s = cat.sites()[0];
  const WalkMeasure w = measureWalk(forge, forge.homeDir, s.dir);
  std::printf("    ruin: lat %.5f lon %.5f, %.1f m out, ground %.1f m,"
              " biome %s, tilt %.3f deg, residP95 %.3f m\n",
              s.latRad / kDeg, s.lonRad / kDeg, s.arcFromAnchorM, s.groundM,
              biomeName(static_cast<Biome>(s.biome)), s.tiltDeg, s.residP95M);
  std::printf("    walk: %.0f m, worst grade %.2f deg at 5 m and %.2f deg at"
              " 20 m, climb %+.1f m, %d wet of %d, %.1f min at 4.6 m/s\n",
              w.lengthM, w.maxGrade5Deg, w.maxGrade20Deg, w.climbM,
              w.wetSamples, w.samples, w.lengthM / 4.6 / 60.0);
  CHECK(w.maxGrade20Deg <= 35.0);
  CHECK(w.wetSamples == 0);
  // And the ruin is on the same body's tree-bearing ground, not stranded up a
  // mountain: it should be within the treeline band the spawn is in, or the
  // walk to it leaves the playable world.
  CHECK(s.groundM < kTreelineBareM);
}

// =============================================================================
// 8. NEGATIVE CONTROL. Every gate above must FAIL on the spawn we just left.
//    A gate nobody has watched go red is not a gate, and these were all
//    written after the fact, which is exactly when that risk is highest.
// =============================================================================
TEST(every_gate_above_refuses_the_old_spawn) {
  BodyParams old_ = makeForge(kSeed);
  // lat 2 / lon 144, the literal that shipped until 2026-08-03.
  old_.homeDir = Vec3(-0.80852416308088182, 0.034899496702500969,
                      0.58742718939820271);
  old_.pondDir = Vec3(-0.80849497812912174, 0.034978833858176704,
                      0.58746263840512714);
  const double h = designedHeightNoPad(old_, old_.homeDir);
  const Biome b = biomeAt(old_, old_.homeDir);
  const double lo = treesInRing(old_, old_.homeDir, kTreelineWanderM);
  const FootMeasure m = padWork(old_);
  std::printf("    the OLD spawn: %.3f m, biome %s, %.0f trees pessimistic,"
              " pad tilt %.3f deg, pad residual %.3f m\n",
              h, biomeName(b), lo, m.tiltDeg, m.residP95M);
  // Four independent refusals, each naming the gate it trips.
  CHECK(!(b == Biome::Hills || b == Biome::Forest || b == Biome::Plains));
  CHECK(!(h < kTreelineBareM - kTreelineWanderM));
  CHECK(!(lo > 400.0));
  CHECK(!(m.tiltDeg < 6.0 && m.residP95M < 6.0));
  std::printf("    all four gates refuse it, so none of them is a rubber"
              " stamp on whatever ships\n");
}
