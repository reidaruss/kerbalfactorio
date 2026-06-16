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
