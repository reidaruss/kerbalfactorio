// Wave-3 headless tests for the BIOME + terrain-design + planet-wide RESOURCE
// layer (biome.h). Proves:
//   - biomeAt determinism (same dir -> same biome), order-independent.
//   - latitude -> Polar at high |lat|.
//   - low elevation -> Ocean (planet); crater floor (moon).
//   - designed relief VARIES by biome (mountains >> plains, ocean below datum),
//     AND preserves the crack-free shared-edge BIT-IDENTITY (additive layer).
//   - materialForBiome is total + stable; hardness in range.
//   - planet-wide resource distribution is deterministic (bit-identical catalog)
//     + plausible (ore concentrates in hills/mountains; coverage across the
//     sphere; Cinderite only on the moon) + region query works.
#include <cstdint>
#include <cstring>
#include <map>
#include <set>
#include <vector>

#include "test_framework.h"
#include "of/cubed_sphere.h"
#include "of/deposits.h"
#include "of/biome.h"
#include "of/terrain_stream.h"  // buildChunk / TerrainChunk / quadCenterDir wiring check

using namespace of;
using namespace of::worldgen;

static uint64_t asBits(double d) {
  uint64_t u; std::memcpy(&u, &d, sizeof(u)); return u;
}

// --- local tangent-plane helpers (WG-26 / WG-25 tests) -----------------------
// A unit dir offset by (dx, dy) metres along the surface. Gnomonic, so the arc
// error is under 3 cm at 3 km on a 600 km body: far below anything asserted.
struct TFrame { Vec3 c, east, north; };
static TFrame tframe(const Vec3& c) {
  Vec3 up(0, 1, 0);
  if (std::fabs(c.y) > 0.99) up = Vec3(1, 0, 0);
  Vec3 e(up.y * c.z - up.z * c.y, up.z * c.x - up.x * c.z,
         up.x * c.y - up.y * c.x);
  e = e * (1.0 / e.length());
  Vec3 n(c.y * e.z - c.z * e.y, c.z * e.x - c.x * e.z, c.x * e.y - c.y * e.x);
  return TFrame{c, e, n};
}
static Vec3 toff(const TFrame& f, double R, double dx, double dy) {
  const double a = dx / R, b = dy / R;
  Vec3 p(f.c.x + a * f.east.x + b * f.north.x,
         f.c.y + a * f.east.y + b * f.north.y,
         f.c.z + a * f.east.z + b * f.north.z);
  return p * (1.0 / p.length());
}
// The SAME arc distance the pad itself measures: radiusM * chord.
static double padDist(const BodyParams& b, const Vec3& d) {
  const double dx = d.x - b.homeDir.x, dy = d.y - b.homeDir.y,
               dz = d.z - b.homeDir.z;
  return b.radiusM * std::sqrt(dx * dx + dy * dy + dz * dz);
}
// The SAME arc distance the pond basin measures (WG-36), in the same metric, so
// "inside the basin" means here exactly what it means in pondBasinDropM.
static double pondDist(const BodyParams& b, const Vec3& d) {
  const double dx = d.x - b.pondDir.x, dy = d.y - b.pondDir.y,
               dz = d.z - b.pondDir.z;
  return b.radiusM * std::sqrt(dx * dx + dy * dy + dz * dz);
}
// The seed the terrain is tuned against (world-gen brief, 2026-07-25).
static const uint64_t kTunedSeed = 0x0bf00d01ull;

// =============================================================================
// biomeAt is a PURE function of (body, dir): the same dir always classifies to
// the same biome, regardless of call order. (WG-6 determinism discipline.)
// =============================================================================
TEST(biome_is_deterministic_per_dir) {
  const BodyParams forge = makeForge(1234567ull);
  // Sample a spread of directions twice in different orders; must agree.
  std::vector<Vec3> dirs;
  for (int i = 0; i < 200; ++i) dirs.push_back(fibonacciDir(i, 200));

  std::map<int, Biome> first;
  for (int i = 0; i < 200; ++i) first[i] = biomeAt(forge, dirs[i]);
  // Reverse order — same result.
  for (int i = 199; i >= 0; --i) CHECK(biomeAt(forge, dirs[i]) == first[i]);

  // A different world seed reclassifies at least some dirs (seed matters).
  const BodyParams forge2 = makeForge(7654321ull);
  int differ = 0;
  for (int i = 0; i < 200; ++i)
    if (biomeAt(forge2, dirs[i]) != first[i]) ++differ;
  CHECK(differ > 0);
}

// =============================================================================
// Latitude drives the poles cold: directions at very high |lat| classify Polar.
// =============================================================================
TEST(high_latitude_is_polar) {
  const BodyParams forge = makeForge(42ull);
  // North + south pole directions (lat ~ +/- 90 deg).
  CHECK(biomeAt(forge, latLonToDir(1.55, 0.0)) == Biome::Polar);
  CHECK(biomeAt(forge, latLonToDir(-1.55, 1.0)) == Biome::Polar);
  // A ring of high-latitude points should be overwhelmingly Polar.
  int polar = 0, total = 0;
  for (int i = 0; i < 36; ++i) {
    const double lon = -3.14 + 6.28 * i / 36.0;
    if (biomeAt(forge, latLonToDir(1.45, lon)) == Biome::Polar) ++polar;
    ++total;
  }
  CHECK(polar >= total * 9 / 10);  // ~all high-lat points are polar
  // And the equator is NOT polar.
  CHECK(biomeAt(forge, latLonToDir(0.0, 0.0)) != Biome::Polar);
}

// =============================================================================
// Low elevation -> Ocean on a planet. The flat clamp band (relief at the datum)
// reads as ocean. We find a near-equatorial dir at the datum and confirm Ocean,
// and confirm the ocean designed-height sits BELOW the datum (a real basin).
// =============================================================================
TEST(low_elevation_is_ocean_and_below_datum) {
  const BodyParams forge = makeForge(2026ull);
  int oceanFound = 0;
  for (int i = 0; i < 4000 && oceanFound < 1; ++i) {
    const Vec3 d = fibonacciDir(i, 4000);
    double lat, lon; dirToLatLon(d, lat, lon);
    if (std::fabs(lat) > 1.0) continue;  // avoid polar
    if (biomeAt(forge, d) == Biome::Ocean) {
      // Designed height must be strictly below the sea-level datum (basin).
      CHECK(sampleDesignedHeight(forge, d) < forge.seaLevelM);
      ++oceanFound;
    }
  }
  CHECK(oceanFound == 1);  // oceans exist somewhere at low latitude
}

// Moon: deep relief reads as CraterFloor, raised as MoonHighland; no Ocean ever.
TEST(moon_has_no_ocean_and_has_elevation_bands) {
  const BodyParams cinder = makeCinder(2026ull);
  std::set<Biome> seen;
  for (int i = 0; i < 4000; ++i) {
    const Biome b = biomeAt(cinder, fibonacciDir(i, 4000));
    CHECK(b != Biome::Ocean);
    CHECK(b != Biome::Forest);
    seen.insert(b);
  }
  // At least two distinct moon bands appear over the sphere.
  CHECK(seen.size() >= 2);
}

// =============================================================================
// Designed relief VARIES by biome: mountains read much higher above the datum
// than plains. We average designed relief over many mountain vs plains dirs.
// =============================================================================
TEST(designed_relief_varies_by_biome) {
  const BodyParams forge = makeForge(99ull);
  double mtnSum = 0, plnSum = 0;
  int mtnN = 0, plnN = 0;
  for (int i = 0; i < 6000; ++i) {
    const Vec3 d = fibonacciDir(i, 6000);
    const Biome b = biomeAt(forge, d);
    const double rel = sampleDesignedHeight(forge, d) - forge.seaLevelM;
    if (b == Biome::Mountains) { mtnSum += rel; ++mtnN; }
    else if (b == Biome::Plains) { plnSum += rel; ++plnN; }
  }
  CHECK(mtnN > 0);
  CHECK(plnN > 0);
  const double mtnAvg = mtnSum / mtnN;
  const double plnAvg = plnSum / plnN;
  // Mountains stand well above plains in the designed terrain.
  CHECK(mtnAvg > plnAvg * 2.0);
}

// =============================================================================
// The designed-height layer PRESERVES crack-free shared-edge bit-identity.
// Two neighbouring quads share an edge; the base sampleHeightField is already
// bit-identical there (WV2), and biome + modulation are pure functions of the
// (bit-identical) shared dir, so the DESIGNED height must also be bit-identical.
// =============================================================================
TEST(designed_height_preserves_shared_edge_bit_identity) {
  const BodyParams forge = makeForge(31415ull);
  const int depth = 3;
  FQuadKey a{forge.bodyId, /*face*/ 0, depth, /*qx*/ 2, /*qy*/ 5};
  FQuadKey b = a; b.qx = a.qx + 1;  // east neighbour
  const QuadMesh ma = generateQuadMesh(forge, a);
  const QuadMesh mb = generateQuadMesh(forge, b);

  int compared = 0;
  for (int j = 0; j < ma.gridDim; ++j) {
    const Vec3 da = ma.dirs[ma.idx(ma.gridDim - 1, j)];  // A east edge dir
    const Vec3 db = mb.dirs[mb.idx(0, j)];               // B west edge dir
    // dirs are bit-identical (proven in world_gen tests); designed heights too.
    const double ha = sampleDesignedHeight(forge, da);
    const double hb = sampleDesignedHeight(forge, db);
    CHECK(asBits(ha) == asBits(hb));
    ++compared;
  }
  CHECK(compared == ma.gridDim);
}

// =============================================================================
// WG-26: THE HOME FLAT PAD.
//
// The pad lives inside sampleDesignedHeight, the single surface authority, so
// the mesh, collision, the walker, voxel solidity, deposit snapping and build
// placement all inherit it with no special case. These tests pin the four
// properties that makes it safe to put there.
// =============================================================================

// The pad centre is a LITERAL Vec3, never latLonToDir at runtime (DW-14: cos/sin
// can differ 1 ULP between mingw libm and emscripten musl, and height is
// position-hashed from raw bits, so a 1-ULP difference would hash the pad to an
// unrelated height). This pins the literal to the geodetic coordinate it claims.
TEST(home_dir_literal_matches_lat2_lon144) {
  const BodyParams forge = makeForge(kTunedSeed);
  const double kPi = 3.14159265358979323846;
  const Vec3 want = latLonToDir(2.0 * kPi / 180.0, 144.0 * kPi / 180.0);
  CHECK(std::fabs(forge.homeDir.x - want.x) < 1e-12);
  CHECK(std::fabs(forge.homeDir.y - want.y) < 1e-12);
  CHECK(std::fabs(forge.homeDir.z - want.z) < 1e-12);
  // And it is a unit vector, which the chord-distance maths assumes.
  CHECK(std::fabs(forge.homeDir.length() - 1.0) < 1e-12);
  // Cinder declares no pad, so its designed surface is untouched by WG-26.
  const BodyParams cinder = makeCinder(kTunedSeed);
  CHECK(cinder.homeFlatRadiusM == 0.0);
}

// Dead flat inside the flat radius: the worst height step over a 4 m span (the
// DW-32 structural module, i.e. the span one foundation piece bridges) must be
// under 0.05 m. It is in fact EXACTLY zero, smoothstep returns exactly 0.0
// inside the flat radius and the blend is written pad-first, so every sample
// returns the pad height's exact bits: so this asserts bit-equality, which is a
// far stronger statement than the 0.05 m budget.
//
// WG-36 RE-BASELINE, AND WHY THE OLD ASSERTION WAS WRONG RATHER THAN UNLUCKY.
// The home pond's basin is cut into the pad: its centre is 55 m from homeDir and
// its rim 22 m from that, so a 44 m disc of the 300 m dead-flat disc now has real
// terrain relief in it, on purpose. A pond the ground does not go down into is a
// decal (WG-36), so "the whole pad is bit-flat" is a claim this build must NOT
// make. What survives, and is what the pad was ever for, is that the pad is flat
// everywhere the basin is not.
//
// So this test now asserts the STRONGER, exact statement in place of the old
// blanket one: the set of directions where the padded ground differs from the pad
// height is EXACTLY the set inside pondRadiusM, the difference there is EXACTLY
// pondBasinDropM, and it is strictly downward. That fails if the basin moves, if
// it leaks outside its radius, or if someone flattens it away, none of which the
// old assertion could tell apart from each other.
TEST(home_pad_is_bit_exactly_flat_over_a_4m_span) {
  const BodyParams forge = makeForge(kTunedSeed);
  CHECK(forge.homeFlatRadiusM > 0.0);
  const TFrame f = tframe(forge.homeDir);
  // homeDir is 55 m from the pond centre and the basin is 22 m across, so the pad
  // height itself is OUTSIDE the basin and is unmoved by WG-36. Pinned here, so
  // that the two names below being interchangeable is a checked fact.
  CHECK(pondDist(forge, forge.homeDir) > forge.pondRadiusM);
  const double padH = sampleDesignedHeight(forge, forge.homeDir);
  CHECK(asBits(padH) == asBits(designedHeightNoPond(forge, forge.homeDir)));
  const double lim = forge.homeFlatRadiusM * 0.97;  // margin for gnomonic error

  auto inBasin = [&](const Vec3& d) {
    return pondDist(forge, d) < forge.pondRadiusM;
  };

  double worst4 = 0.0;
  int samples = 0, basinSamples = 0;
  for (double y = -lim; y <= lim; y += 2.0)
    for (double x = -lim; x <= lim; x += 2.0) {
      if (x * x + y * y > lim * lim) continue;
      const Vec3 d = toff(f, forge.radiusM, x, y);
      CHECK(padDist(forge, d) <= forge.homeFlatRadiusM);
      const double h = sampleDesignedHeight(forge, d);
      ++samples;
      if (inBasin(d)) {
        // Inside the basin the ground is SUPPOSED to have moved, and by exactly
        // the amount the basin claims, measured off the same flat pad.
        ++basinSamples;
        CHECK(h < padH);                                        // really down
        CHECK(std::fabs((padH - h) - pondBasinDropM(forge, d)) < 1e-12);
        CHECK(asBits(designedHeightNoPond(forge, d)) == asBits(padH));
        continue;
      }
      CHECK(asBits(h) == asBits(padH));            // bit-exactly level
      // Every 4 m neighbour (axial and diagonal) inside the pad and outside the
      // basin. A step that straddles the rim is a step across real terrain, not
      // across the pad, so it is not this test's subject.
      const double o[4][2] = {{4, 0}, {0, 4}, {2.8284271, 2.8284271},
                              {2.8284271, -2.8284271}};
      for (const auto& n : o) {
        const double nx = x + n[0], ny = y + n[1];
        if (nx * nx + ny * ny > lim * lim) continue;
        const Vec3 dn = toff(f, forge.radiusM, nx, ny);
        if (inBasin(dn)) continue;
        const double hn = sampleDesignedHeight(forge, dn);
        const double step = std::fabs(hn - h);
        if (step > worst4) worst4 = step;
      }
    }
  CHECK(samples > 5000);      // the pad really was swept, not skipped
  // ...and the basin really is inside the swept pad, so the skip above is a
  // carve-out for something that exists rather than a silent exemption.
  CHECK(basinSamples > 200);
  CHECK(worst4 < 0.05);       // the stated budget
  CHECK(worst4 == 0.0);       // and it is actually exact
}

// The blend is EXACTLY the smoothstep it claims: monotone, 1 inside the flat
// radius, and reaching zero influence at the blend radius. Recovering the weight
// from the three surfaces (padded, natural, pad height) means this pins the
// observable shape rather than re-stating the implementation.
//
// WG-36: the PADDED surface here is designedHeightNoPond, not
// sampleDesignedHeight. Those were the same function until the pond arrived, and
// the rename is the whole point of designedHeightNoPond existing: the pad blend
// is a property of the pad, and the basin is a second, independent term
// subtracted afterwards. Reading the ponded height here would recover a weight
// contaminated by up to 4 m of basin on the rays that cross it (the pond centre
// is 55 m out, so three of these eight rays do), i.e. it would report the pad
// blend as broken because a different feature was working. The basin's own shape
// is asserted in home_pad_is_bit_exactly_flat_over_a_4m_span and, in full, in
// test_water_field.cpp.
TEST(home_pad_blend_is_monotone_and_reaches_zero) {
  const BodyParams forge = makeForge(kTunedSeed);
  const TFrame f = tframe(forge.homeDir);
  const double padH = designedHeightNoPad(forge, forge.homeDir);
  int checked = 0;
  for (int ray = 0; ray < 8; ++ray) {
    const double th = ray * (3.14159265358979323846 / 4.0);
    const double ca = std::cos(th), sa = std::sin(th);
    double prevW = 2.0;
    for (double r = 0.0; r <= forge.homeBlendRadiusM + 150.0; r += 5.0) {
      const Vec3 d = toff(f, forge.radiusM, r * ca, r * sa);
      const double nat = designedHeightNoPad(forge, d);
      const double pad = designedHeightNoPond(forge, d);
      if (std::fabs(nat - padH) < 1.0) continue;   // weight not observable here
      const double w = (pad - nat) / (padH - nat); // 1 = full pad, 0 = natural
      const double dist = padDist(forge, d);
      const double want =
          1.0 - smoothstep(forge.homeFlatRadiusM, forge.homeBlendRadiusM, dist);
      CHECK(std::fabs(w - want) < 1e-9);           // exactly the declared shape
      CHECK(w <= prevW + 1e-9);                    // monotone non-increasing
      if (dist <= forge.homeFlatRadiusM) CHECK(std::fabs(w - 1.0) < 1e-12);
      if (dist >= forge.homeBlendRadiusM) CHECK(w == 0.0);
      prevW = w;
      ++checked;
    }
  }
  CHECK(checked > 400);
}

// Outside the blend radius the pad contributes NOTHING, not "nothing to a
// tolerance", the identical 64 bits. This is what keeps essentially the whole
// planet unaffected by the feature, so adding a pad re-baselines nothing.
TEST(outside_blend_radius_is_bit_identical_to_unpadded) {
  const BodyParams forge = makeForge(kTunedSeed);
  const TFrame f = tframe(forge.homeDir);
  int compared = 0, inside = 0;

  // WG-36 PREMISE, made explicit rather than assumed. This test reads the FULL
  // sampleDesignedHeight, which is now pad minus basin, so it is only a statement
  // about the PAD while the basin lives wholly inside the blend radius. It does
  // (55 m + 22 m against 600 m). If a body ever puts a pond outside its pad, this
  // check goes red first and says so, instead of the comparisons below failing
  // under a name that would then be a lie.
  CHECK(pondDist(forge, forge.homeDir) + forge.pondRadiusM <
        forge.homeBlendRadiusM);

  // A ring just outside the blend radius, where a sloppy implementation would
  // leak a rounding residue.
  for (int a = 0; a < 720; ++a) {
    const double th = a * (3.14159265358979323846 / 360.0);
    const double r = forge.homeBlendRadiusM + 1.0 + (a % 40);
    const Vec3 d = toff(f, forge.radiusM, r * std::cos(th), r * std::sin(th));
    CHECK(asBits(sampleDesignedHeight(forge, d)) ==
          asBits(designedHeightNoPad(forge, d)));
    ++compared;
  }
  // And the rest of the planet: every point outside the blend radius agrees
  // bitwise, every point inside it is the only place the pad may differ.
  for (int i = 0; i < 20000; ++i) {
    const Vec3 d = fibonacciDir(i, 20000);
    if (padDist(forge, d) < forge.homeBlendRadiusM) { ++inside; continue; }
    CHECK(asBits(sampleDesignedHeight(forge, d)) ==
          asBits(designedHeightNoPad(forge, d)));
    ++compared;
  }
  CHECK(compared > 20000);
  CHECK(inside == 0);   // a 600 m disc on a 600 km body: nothing else is touched
}

// =============================================================================
// WG-25: the height field has REAL CONTENT at short wavelengths.
//
// The defect this pins against: the old stack's finest octave was frequency 320,
// a 1.9 km lattice cell, so below ~2 km the field was an exact PLANE. It showed
// up as a degenerate |dh| distribution: at 2 m spacing on a mountain the old
// field gave p50 0.616 m, p90 0.624 m, max 0.630 m, a spread of 1.3%, which is
// a plane with a constant tilt and nothing else. Real terrain has a wide spread.
// =============================================================================
TEST(mountain_terrain_has_short_wavelength_content) {
  const BodyParams forge = makeForge(kTunedSeed);
  // Highest-relief Mountains dir on a coarse global scan (deterministic).
  Vec3 peak = forge.homeDir;
  double best = -1e300;
  for (int i = 0; i < 20000; ++i) {
    const Vec3 d = fibonacciDir(i, 20000);
    if (biomeAt(forge, d) != Biome::Mountains) continue;
    const double h = designedHeightNoPad(forge, d);
    if (h > best) { best = h; peak = d; }
  }
  CHECK(best > 0.0);

  const TFrame f = tframe(peak);
  auto spectrum = [&](double s, double& mean, double& p50, double& p90) {
    std::vector<double> dh;
    for (int j = 0; j < 100; ++j) {
      double prev = designedHeightNoPad(forge, toff(f, forge.radiusM,
                                                    -50.0 * s, (j - 50) * s));
      for (int i = -49; i < 50; ++i) {
        const double h = designedHeightNoPad(
            forge, toff(f, forge.radiusM, i * s, (j - 50) * s));
        dh.push_back(std::fabs(h - prev));
        prev = h;
      }
    }
    std::sort(dh.begin(), dh.end());
    double sum = 0; for (double v : dh) sum += v;
    mean = sum / dh.size();
    p50 = dh[dh.size() / 2];
    p90 = dh[(dh.size() * 9) / 10];
  };

  double mean100 = 0, p50_100 = 0, p90_100 = 0;
  spectrum(100.0, mean100, p50_100, p90_100);
  // Content at the 100 m wavelength. Measured 14.6 m mean at this seed's peak;
  // the threshold is well below that but far above a plane's contribution.
  CHECK(mean100 > 8.0);

  double mean2 = 0, p50_2 = 0, p90_2 = 0;
  spectrum(2.0, mean2, p50_2, p90_2);
  // Content at the 2 m wavelength: the player's LOD. A PLANE gives p90/p50 == 1
  // (the old field measured 1.013). Real content spreads the distribution;
  // measured 1.99 here.
  CHECK(p50_2 > 0.0);
  CHECK(p90_2 / p50_2 > 1.5);
}

// =============================================================================
// WG-25: the designed surface is CONTINUOUS: no biome-boundary cliffs.
//
// The old design layer switched its relief gain on the DISCRETE biome, which made
// the shaped surface discontinuous at every biome edge. Measured on this seed,
// two samples 100 m apart differed by 985 m vertically at the Hills/Mountains
// threshold (2700 m of base relief read 3375 m as Hills, 4320 m as Mountains),
// and every coastline carried a ~1.2 km wall. This pins the fix.
// =============================================================================
TEST(designed_surface_has_no_biome_boundary_cliffs) {
  const BodyParams forge = makeForge(kTunedSeed);
  double worst = 0.0;
  int crossings = 0, samples = 0;
  // Great-circle transects across the whole planet at 100 m sample spacing.
  for (int t = 0; t < 24; ++t) {
    const Vec3 c = fibonacciDir(t * 977, 24000);
    const TFrame f = tframe(c);
    double prev = designedHeightNoPad(forge, toff(f, forge.radiusM, -50000.0, 0));
    Biome prevB = biomeAt(forge, toff(f, forge.radiusM, -50000.0, 0));
    for (int i = -499; i <= 500; ++i) {
      const Vec3 d = toff(f, forge.radiusM, i * 100.0, 0.0);
      const double h = designedHeightNoPad(forge, d);
      const Biome b = biomeAt(forge, d);
      if (b != prevB) ++crossings;
      const double step = std::fabs(h - prev);
      if (step > worst) worst = step;
      prev = h; prevB = b;
      ++samples;
    }
  }
  CHECK(samples > 20000);
  CHECK(crossings > 50);   // the transects really do cross biome boundaries
  // 300 m over 100 m of ground is a 71-degree slope: steep, but terrain. The old
  // field produced 985 m here, which is a wall, not a slope.
  CHECK(worst < 300.0);
}

// =============================================================================
// materialForBiome is total + stable, and distinct biomes get distinct ids for
// the renderer (no two surface biomes collapse to one material).
// =============================================================================
TEST(material_ids_stable_and_distinct) {
  // Pinned values (these cross the renderer contract — must not drift).
  CHECK(materialForBiome(Biome::Ocean) == 0);
  CHECK(materialForBiome(Biome::Mountains) == 5);
  CHECK(materialForBiome(Biome::Polar) == 6);
  CHECK(materialForBiome(Biome::CraterFloor) == 9);

  // All real biomes map to a unique, non-Unknown material.
  std::set<uint16_t> ids;
  Biome real[] = {Biome::Ocean, Biome::Beach, Biome::Plains, Biome::Forest,
                  Biome::Hills, Biome::Mountains, Biome::Polar, Biome::Regolith,
                  Biome::MoonHighland, Biome::CraterFloor};
  for (Biome b : real) {
    const uint16_t m = materialForBiome(b);
    CHECK(m != kMatUnknown);
    ids.insert(m);
    // Hardness is a valid [0,1] value for every biome.
    const double hd = hardnessForBiome(b);
    CHECK(hd >= 0.0 && hd <= 1.0);
  }
  CHECK(ids.size() == 10);  // all distinct
}

// A terrain chunk picks up its biome material (terrain_stream wiring).
TEST(terrain_chunk_material_follows_biome) {
  const BodyParams forge = makeForge(2026ull);
  FQuadKey k{forge.bodyId, 0, 4, 8, 8};
  const TerrainChunk ch = buildChunk(forge, k, StreamConfig{});
  CHECK(ch.materialId == materialForBiome(biomeAt(forge, quadCenterDir(k))));
  CHECK(ch.materialId != kMatUnknown);
}

// =============================================================================
// Planet-wide resource distribution: DETERMINISTIC (bit-identical catalog from
// the same seed; different from a different seed).
// =============================================================================
TEST(biome_resources_are_deterministic) {
  const BodyParams forge = makeForge(20260615ull);
  const auto a = GenerateBiomeDeposits(forge, forge.bodySeed, 1);
  const auto b = GenerateBiomeDeposits(forge, forge.bodySeed, 1);
  CHECK(a.size() == b.size());
  CHECK(a.size() > 0);
  bool identical = true;
  for (size_t i = 0; i < a.size(); ++i) {
    if (a[i].Id != b[i].Id) identical = false;
    if (a[i].Resource != b[i].Resource) identical = false;
    if (asBits(a[i].Position.pos.x) != asBits(b[i].Position.pos.x)) identical = false;
    if (asBits(a[i].RemainingAmount) != asBits(b[i].RemainingAmount)) identical = false;
  }
  CHECK(identical);

  // Different seed -> different catalog.
  const BodyParams forge2 = makeForge(11111111ull);
  const auto c = GenerateBiomeDeposits(forge2, forge2.bodySeed, 1);
  CHECK(!(c.size() == a.size() && c[0].Id == a[0].Id));
}

// =============================================================================
// Plausibility: ore concentrates in hills/mountains, the catalog covers the
// whole sphere (all six cube faces have deposits), and Cinderite NEVER appears
// on the planet (WG-4) but DOES on the moon.
// =============================================================================
TEST(biome_resources_are_plausible) {
  const BodyParams forge = makeForge(20260615ull);
  const auto planet = GenerateBiomeDeposits(forge, forge.bodySeed, 1);
  CHECK(planet.size() > 100);

  // Coverage: deposits land on all six cube faces (planet-wide, not a patch).
  std::set<int> faces;
  int iron = 0, ironInHilly = 0, cinderiteOnPlanet = 0;
  for (const FDepositNode& d : planet) {
    const Vec3& p = d.Position.pos;
    const double l = p.length();
    const Vec3 dir(p.x / l, p.y / l, p.z / l);
    faces.insert(faceOfDir(dir));
    if (d.Resource == kItemCinderite) ++cinderiteOnPlanet;
    if (d.Resource == survival::kItemRawIron) {
      ++iron;
      const Biome b = biomeAt(forge, dir);
      if (b == Biome::Hills || b == Biome::Mountains) ++ironInHilly;
    }
  }
  CHECK(faces.size() == 6);          // whole-sphere coverage
  CHECK(cinderiteOnPlanet == 0);     // WG-4: never on the planet
  CHECK(iron > 0);
  // Most iron ore sits in hilly/mountainous biomes (the favoured ore zones).
  CHECK(ironInHilly * 2 > iron);     // > 50% of iron is in hills/mountains

  // The moon carries Cinderite (off-world hook); the planet never does.
  const BodyParams cinder = makeCinder(20260615ull);
  const auto moon = GenerateBiomeDeposits(cinder, cinder.bodySeed, 2);
  int cinderiteOnMoon = 0;
  for (const FDepositNode& d : moon)
    if (d.Resource == kItemCinderite) ++cinderiteOnMoon;
  CHECK(cinderiteOnMoon > 0);
}

// =============================================================================
// Region query: BiomeResourceField.QueryRegionDeposits returns the deposits
// within a cube quad's footprint, and the union over a face's quads recovers all
// of that face's deposits (no node lost, region partitions the planet).
// =============================================================================
TEST(region_query_returns_local_deposits) {
  const BodyParams forge = makeForge(20260615ull);
  const BiomeResourceField field =
      BiomeResourceField::ForBody(forge, forge.bodySeed, 1);
  CHECK(field.size() > 0);

  // A depth-2 grid (4x4) over face 0 — every face-0 deposit must appear in at
  // least one quad's region query (with a small margin for seam nodes).
  std::set<DepositId> faceDeposits;
  for (const FDepositNode& d : field.GetDeposits()) {
    const Vec3& p = d.Position.pos;
    const double l = p.length();
    const Vec3 dir(p.x / l, p.y / l, p.z / l);
    if (faceOfDir(dir) == 0) faceDeposits.insert(d.Id);
  }

  std::set<DepositId> covered;
  int totalHits = 0;
  for (uint32_t qx = 0; qx < 4; ++qx)
    for (uint32_t qy = 0; qy < 4; ++qy) {
      FQuadKey k{forge.bodyId, 0, 2, qx, qy};
      const auto hits = field.QueryRegionDeposits(forge, k, /*margin*/ 0.15);
      totalHits += static_cast<int>(hits.size());
      for (const FDepositNode& d : hits) covered.insert(d.Id);
    }
  CHECK(!faceDeposits.empty());
  // Every face-0 deposit is covered by some quad's region query.
  for (DepositId id : faceDeposits) CHECK(covered.count(id) == 1);
  // The region query is selective (doesn't just return the whole planet per quad).
  CHECK(totalHits < static_cast<int>(field.size()) * 16);

  // Extraction on the field decrements only RemainingAmount (depletion diff).
  const DepositId id0 = field.GetDeposits()[0].Id;
  FDepositNode before; CHECK(field.GetDeposit(id0, before));
  BiomeResourceField mut = field;
  const double got = mut.ExtractFromDeposit(id0, 100.0);
  CHECK(got > 0.0);
  FDepositNode after; CHECK(mut.GetDeposit(id0, after));
  CHECK(after.RemainingAmount < before.RemainingAmount);
}
