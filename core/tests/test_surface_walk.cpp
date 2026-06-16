// Headless tests for the SURFACE-WALK data layer (surface_walk.h) — the math /
// queries the UE whole-planet player controller binds to when the player walks
// ON a body surface. Proves the load-bearing properties:
//
//   - UP IS RADIAL + GRAVITY POINTS TO CENTRE: localUp == dir, gravityDir == -up,
//     up.dot(gravityDir) == -1 everywhere on the body.
//   - WALK MOVES LAT/LON BY THE EXPECTED GREAT-CIRCLE AMOUNT: a pure-north step of
//     arc length L changes latitude by L / R radians (at the equator), and a step
//     stays on a great circle (arc length recovered from the angular displacement).
//   - PLAYER STAYS ON THE DESIGNED SURFACE: after any move, the eye radius equals
//     body.radius + SampleDesignedTerrainHeight(lat,lon) + eyeHeight, bit-close.
//   - A LONG WALK TRIGGERS >=1 FLOATING-ORIGIN REBASE + the rebased engine pos
//     stays bounded by the rebase threshold; consumeRebased() is a one-shot event.
//   - THE STREAM OBSERVER TRACKS THE WALKER: makeStreamObserver moves with the
//     player and drives TerrainStreamer LOD that deepens under the new position.
//   - BIOME / DEPOSIT QUERIES UNDER THE PLAYER ARE DETERMINISTIC: same site ->
//     same biome / hardness / quad / nearby-deposit set.
#include <cstdint>
#include <cstring>
#include <cmath>
#include <set>
#include <vector>

#include "test_framework.h"
#include "of/cubed_sphere.h"
#include "of/biome.h"
#include "of/terrain_stream.h"
#include "of/surface_walk.h"

using namespace of;
using namespace of::worldgen;

static uint64_t asBits(double d) {
  uint64_t u;
  std::memcpy(&u, &d, sizeof(u));
  return u;
}

// =============================================================================
// UP IS RADIAL + GRAVITY POINTS TO CENTRE everywhere on the body.
// =============================================================================
TEST(walk_up_is_radial_gravity_to_centre) {
  const BodyParams forge = makeForge(20260615ull);
  // Sample a spread of sites (incl. near a pole) and check up/gravity geometry.
  const double lats[] = {0.0, 0.7, -1.2, 1.4, -0.3};
  const double lons[] = {0.0, -2.0, 1.1, 3.0, -0.6};
  for (int i = 0; i < 5; ++i) {
    SurfaceObserver obs(forge, lats[i], lons[i]);
    const Vec3 up = obs.localUp();
    const Vec3 g = obs.gravityDir();
    // up is unit + radial (== dir).
    CHECK_NEAR(up.length(), 1.0, 1e-12);
    CHECK_NEAR(up.dot(obs.dir()), 1.0, 1e-12);
    // gravity is -up: dot == -1.
    CHECK_NEAR(up.dot(g), -1.0, 1e-12);
    // gravity points from the eye toward the centre: eyePos + g aims inward.
    const Vec3 eye = obs.eyePositionUniverse().pos;
    CHECK(eye.dot(g) < 0.0);  // moving along g reduces radius
    // gravity acceleration is positive + plausible (a few m/s^2 on a 600km body).
    CHECK(obs.gravityAccel() > 0.0);
    CHECK(obs.gravityAccel() < 20.0);
  }
}

// =============================================================================
// WALK MOVES LAT/LON BY THE EXPECTED GREAT-CIRCLE AMOUNT. From the equator a pure
// "north" step of arc length L changes latitude by ~ L / R. We verify the angular
// displacement of the radial direction equals L / R for a forward walk.
// =============================================================================
TEST(walk_step_is_great_circle) {
  const BodyParams forge = makeForge(7ull);
  // Start at the equator, heading north (0). Use a moderate step well under R.
  SurfaceObserver obs(forge, /*lat*/ 0.0, /*lon*/ 0.0, /*heading*/ 0.0);
  const Vec3 dir0 = obs.dir();
  const double R0 = obs.surfaceRadiusM();
  const double stepM = 50000.0;  // 50 km — large enough to dwarf terrain relief

  obs.move(/*forwardM*/ stepM, /*rightM*/ 0.0);

  const Vec3 dir1 = obs.dir();
  // Angular displacement of the radial dir == arc / R (great-circle property).
  double cosT = dir0.dot(dir1);
  if (cosT > 1.0) cosT = 1.0;
  if (cosT < -1.0) cosT = -1.0;
  const double measuredAngle = std::acos(cosT);
  const double expectedAngle = stepM / R0;
  // Tolerance: terrain relief makes R vary by < maxRelief/R ~ 1% of the angle.
  CHECK_NEAR(measuredAngle, expectedAngle, expectedAngle * 0.02);

  // A pure-north step from the equator increases latitude (lon ~ unchanged).
  CHECK(obs.lat() > 0.0);
  CHECK_NEAR(obs.lat(), expectedAngle, expectedAngle * 0.02);
  CHECK_NEAR(obs.lon(), 0.0, 1e-6);

  // A pure-east step (right) from the equator moves longitude, not latitude.
  SurfaceObserver obsE(forge, 0.0, 0.0, 0.0);
  obsE.move(/*forwardM*/ 0.0, /*rightM*/ stepM);
  CHECK(std::fabs(obsE.lon()) > 0.0);
  CHECK_NEAR(obsE.lat(), 0.0, expectedAngle * 0.05);
}

// =============================================================================
// PLAYER STAYS ON THE DESIGNED SURFACE. After every step the eye radius equals
// body.radius + designedHeight(here) + eyeHeight, to the metre — the renderer can
// trust the character is glued to the shaped terrain it draws.
// =============================================================================
TEST(walk_stays_on_designed_surface) {
  const BodyParams cinder = makeCinder(2024ull);
  SurfaceObserver obs(cinder, -0.4, 1.7, /*heading*/ 0.9, /*eyeHeight*/ 1.8);
  for (int k = 0; k < 40; ++k) {
    obs.move(/*forwardM*/ 1200.0, /*rightM*/ 0.0);
    const double designed = SampleDesignedTerrainHeight(cinder, obs.lat(), obs.lon());
    const double expectedR = cinder.radiusM + designed + obs.eyeHeight();
    const double eyeR = obs.eyePositionUniverse().pos.length();
    CHECK_NEAR(eyeR, expectedR, 1e-6);
    // Foot position sits exactly on the designed surface (no eyeHeight).
    const double footR = obs.footPositionUniverse().pos.length();
    CHECK_NEAR(footR, cinder.radiusM + designed, 1e-6);
    // And surfaceHeightM() agrees with the direct query (the snap source).
    CHECK(asBits(obs.surfaceHeightM()) == asBits(designed));
  }
}

// =============================================================================
// A LONG WALK TRIGGERS >=1 FLOATING-ORIGIN REBASE, the rebased engine position
// stays bounded by the threshold, and consumeRebased() is a one-shot event.
// =============================================================================
TEST(walk_drives_floating_origin_rebase) {
  const BodyParams forge = makeForge(555ull);
  const double threshold = 4000.0;
  SurfaceObserver obs(forge, 0.1, 0.1, /*heading*/ 0.0, /*eyeHeight*/ 1.7,
                      /*rebaseThresholdM*/ threshold);

  int rebaseEvents = 0;
  double maxEngineOffset = 0.0;
  // Walk ~30 km in 200 m strides (> the 4 km threshold many times over).
  for (int k = 0; k < 150; ++k) {
    obs.move(/*forwardM*/ 200.0, /*rightM*/ 0.0);
    if (obs.consumeRebased()) ++rebaseEvents;
    const double off = obs.enginePosition().length();
    if (off > maxEngineOffset) maxEngineOffset = off;
  }
  CHECK(rebaseEvents >= 1);                 // a long walk rebases at least once
  CHECK(obs.rebaseCount() >= 1);
  // After each rebase the engine offset resets near zero; between rebases it grows
  // at most to ~threshold + one stride. Bounded => floating origin works.
  CHECK(maxEngineOffset < threshold + 1000.0);

  // consumeRebased is one-shot: a second poll with no new rebase returns false.
  CHECK(obs.consumeRebased() == false);

  // The streamer re-anchor hook is callable with the walker's body (renderer path).
  TerrainStreamer streamer(forge);
  CHECK(streamer.onOriginRebased() == streamer.residentCount());  // 0 == 0 pre-stream
}

// =============================================================================
// THE STREAM OBSERVER TRACKS THE WALKER: feeding makeStreamObserver into a
// TerrainStreamer streams chunks AROUND the player, and after walking a long way
// the deepest LOD has moved to sit under the NEW position (not the old one).
// =============================================================================
TEST(walk_stream_observer_tracks_player) {
  const BodyParams forge = makeForge(31415ull);
  StreamConfig cfg;
  cfg.maxDepth = 8;
  cfg.genBudget = 0;  // converge in one update

  SurfaceObserver obs(forge, 0.0, 0.0, /*heading*/ 0.0);
  TerrainStreamer streamer(forge, cfg);

  // Stream at the start position; record where the deepest quad sits.
  const Vec3 startDir = obs.dir();
  streamer.updateStreaming(obs.makeStreamObserver());
  CHECK(streamer.residentCount() > 6);  // it actually subdivided around the player

  auto deepestDir = [&]() -> Vec3 {
    int md = -1; Vec3 best(0, 1, 0);
    for (const auto& kv : streamer.resident()) {
      if (kv.second.key.depth > md) { md = kv.second.key.depth;
        best = quadCenterDir(kv.second.key); }
    }
    return best;
  };
  const Vec3 deepStart = deepestDir();
  // The deepest quad is near the player's start direction.
  CHECK(deepStart.dot(startDir) > 0.9);

  // Walk ~300 km away (a big surface displacement) and re-stream.
  for (int k = 0; k < 30; ++k) obs.move(/*forwardM*/ 10000.0, /*rightM*/ 0.0);
  const Vec3 endDir = obs.dir();
  CHECK(endDir.dot(startDir) < 0.95);  // we genuinely moved on the sphere

  streamer.updateStreaming(obs.makeStreamObserver());
  const Vec3 deepEnd = deepestDir();
  // The deepest LOD has followed the walker to the new position.
  CHECK(deepEnd.dot(endDir) > 0.9);
  CHECK(deepEnd.dot(startDir) < deepEnd.dot(endDir));  // closer to where we are now
}

// =============================================================================
// BIOME / HARDNESS / DEPOSIT QUERIES UNDER THE PLAYER ARE DETERMINISTIC + agree
// with the underlying world-gen layer.
// =============================================================================
TEST(walk_local_queries_are_deterministic) {
  const BodyParams forge = makeForge(8675309ull);
  const FrameId frame = static_cast<FrameId>(forge.bodyId + 1);
  const BiomeResourceField field =
      BiomeResourceField::ForBody(forge, forge.bodySeed, frame);

  // Two observers at the SAME site must report identical local queries.
  SurfaceObserver a(forge, -0.6, 2.2);
  SurfaceObserver b(forge, -0.6, 2.2);
  CHECK(a.biomeHere() == b.biomeHere());
  CHECK(a.biomeHere() == biomeAt(forge, a.dir()));            // agrees with world-gen
  CHECK(asBits(a.hardnessHere()) == asBits(b.hardnessHere()));
  CHECK(asBits(a.hardnessHere()) == asBits(hardnessForBiome(a.biomeHere())));

  // The quad under the player is a pure function of the site.
  CHECK(a.quadHere(8) == b.quadHere(8));

  // The quad under the player actually CONTAINS the player's direction (the quad
  // key maps the dir to the right cube cell).
  const FQuadKey q = a.quadHere(8);
  const Vec3 qc = quadCenterDir(q);
  CHECK(qc.dot(a.dir()) > 0.99);  // player dir is within the small quad's cone

  // Nearby-deposit queries are deterministic + a subset of the global catalog.
  const std::vector<FDepositNode> da = a.nearbyDeposits(field, 8, 0.02);
  const std::vector<FDepositNode> db = b.nearbyDeposits(field, 8, 0.02);
  CHECK(da.size() == db.size());
  bool same = (da.size() == db.size());
  for (size_t i = 0; i < da.size() && same; ++i) same = (da[i].Id == db[i].Id);
  CHECK(same);
  // Every returned deposit lies within the player's quad cone (+margin) — i.e. it
  // really is "near me", not the whole planet.
  for (const FDepositNode& d : da) {
    const Vec3& p = d.Position.pos;
    const double l = p.length();
    const Vec3 nd = (l > 0.0) ? Vec3(p.x / l, p.y / l, p.z / l) : Vec3(0, 1, 0);
    CHECK(nd.dot(qc) > 0.5);  // within the (small) quad's angular footprint
  }
  // Sanity: the local set is no larger than the global catalog.
  CHECK(da.size() <= field.size());
}
