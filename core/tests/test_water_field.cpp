// Headless tests for THE WATER LEVEL AUTHORITY (water_field.h, WG-36) and for
// the POND BASIN it stands in (biome.h pondBasinDropM / sampleDesignedHeight).
//
// The suite is organised around the one thing WG-36 is actually risking, which
// is not "is there water" but "how many answers does the engine now have to the
// question where is the surface". It had two, deliberately and with an asserted
// bound between them (DW-26: surfaceHeight is the smooth ground, solidCell is
// the voxel shell). Water is a third, and the two ways it goes wrong are both
// ways of collapsing it back into the other two:
//
//   * THE DECAL. The water renders and the ground under it does not move, so
//     there is nothing to wade into, the "pond" is a texture, and the surface
//     the player walks on never learned about it. Tests 1 to 5 and 14 fail if
//     the basin stops being real terrain.
//   * THE CONTAMINATION. Some height function starts returning the water level,
//     or the water level starts being measured off a height that already has the
//     basin subtracted out of it (the circularity water_field.h's header warns
//     about, which presents as "the pond gets deeper every time you look at it").
//     Tests 6 to 11 and 14 fail if the two authorities start reading each other.
//
// Every assertion below is a property one of those two headers CLAIMS in words.
// Nothing here is a threshold tuned until it went green: where a number is
// measured rather than derived (the basin's steepest grade, the shoreline
// radius) it is PRINTED next to the bound it is checked against, so the bound
// can be audited rather than trusted.
//
// Both defects were injected and confirmed to turn this suite red by name
// (standing rule 11): making pondBasinDropM return 0 fails 8 tests, and making
// levelM read sampleDesignedHeight fails 5.
//
// Header-only; consumes water_field.h (the subject), biome.h and surface_field.h
// READ-ONLY, and cubed_sphere.h for the body constants.
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <vector>

#include "test_framework.h"
#include "of/vec3.h"
#include "of/cubed_sphere.h"
#include "of/biome.h"
#include "of/voxel_field.h"
#include "of/surface_field.h"
#include "of/water_field.h"

using namespace of;
using namespace of::worldgen;

namespace {

const uint64_t kTunedSeed = 0x0bf00d01ull;   // the seed the terrain is tuned to
const double kPi = 3.14159265358979323846;

BodyParams forge() { return makeForge(kTunedSeed); }
BodyParams cinder() { return makeCinder(kTunedSeed); }

uint64_t asBits(double d) {
  uint64_t u;
  std::memcpy(&u, &d, sizeof(u));
  return u;
}

// --- local tangent-plane helpers (the same construction test_biome.cpp uses) --
struct TFrame { Vec3 c, east, north; };
TFrame tframe(const Vec3& c) {
  Vec3 up(0, 1, 0);
  if (std::fabs(c.y) > 0.99) up = Vec3(1, 0, 0);
  Vec3 e(up.y * c.z - up.z * c.y, up.z * c.x - up.x * c.z,
         up.x * c.y - up.y * c.x);
  e = e * (1.0 / e.length());
  Vec3 n(c.y * e.z - c.z * e.y, c.z * e.x - c.x * e.z, c.x * e.y - c.y * e.x);
  return TFrame{c, e, n};
}
// A unit dir offset by (dx, dy) metres along the surface, gnomonically.
Vec3 toff(const TFrame& f, double R, double dx, double dy) {
  const double a = dx / R, b = dy / R;
  Vec3 p(f.c.x + a * f.east.x + b * f.north.x,
         f.c.y + a * f.east.y + b * f.north.y,
         f.c.z + a * f.east.z + b * f.north.z);
  return p * (1.0 / p.length());
}
// A dir at nominal (r, bearing) from the pond centre.
Vec3 pondOff(const BodyParams& b, const TFrame& f, double r, double bearing) {
  return toff(f, b.radiusM, r * std::cos(bearing), r * std::sin(bearing));
}

// A direction on `bearing` whose distFromPondM is the SMALLEST value at or
// beyond `wantM`.
//
// WHY THIS IS BISECTED rather than just offset by wantM metres. The gnomonic
// offset above is short of its nominal arc by 0.375*r^3/R^2, which at the 22 m
// rim is 4 nanometres. That is far below anything the pond cares about and it is
// on the WRONG SIDE of a `>=` test, so a nominal 22 m offset lands INSIDE the
// basin, and "just inside the rim" and "on the rim" are different claims: the
// first has a drop of 3e-18 m in it and the second is required to be bit-exactly
// zero. So the distance is solved for in the SAME metric the code under test
// measures, instead of being assumed from the offset.
Vec3 dirAtOrBeyond(const BodyParams& b, const TFrame& f, double bearing,
                   double wantM) {
  const double ca = std::cos(bearing), sa = std::sin(bearing);
  double lo = wantM * 0.5, hi = wantM * 1.5 + 1e-3;
  Vec3 best = toff(f, b.radiusM, hi * ca, hi * sa);
  for (int i = 0; i < 100; ++i) {
    const double mid = 0.5 * (lo + hi);
    const Vec3 d = toff(f, b.radiusM, mid * ca, mid * sa);
    if (water::distFromPondM(b, d) >= wantM) { hi = mid; best = d; }
    else { lo = mid; }
  }
  return best;
}

// A golden-angle spiral over a disc of radius rMax: uniform area coverage with
// no lattice artefacts and no random-number generator to make deterministic.
Vec3 discSample(const BodyParams& b, const TFrame& f, int i, int n,
                double rMax) {
  const double r = rMax * std::sqrt((i + 0.5) / n);
  const double th = i * 2.39996322972865332;
  return pondOff(b, f, r, th);
}

}  // namespace

// =============================================================================
// §0 - the constants this whole file reasons about, pinned and printed.
//
// makeForge's comment claims pondDir is a unit vector exactly 55 m from the pad
// centre and that THIS FILE pins both. It does, here, because every other test
// below depends on the pond sitting wholly inside the pad's 150 m dead-flat disc
// (that is what makes the ground the basin is cut into a bit-exact constant and
// the shoreline a circle rather than a contour of the noise).
// =============================================================================
TEST(pond_constants_are_what_the_body_claims) {
  const BodyParams b = forge();
  CHECK(water::hasPond(b));
  CHECK(std::fabs(b.pondDir.length() - 1.0) < 1e-15);

  const double dx = b.pondDir.x - b.homeDir.x;
  const double dy = b.pondDir.y - b.homeDir.y;
  const double dz = b.pondDir.z - b.homeDir.z;
  const double sepM = b.radiusM * std::sqrt(dx * dx + dy * dy + dz * dz);
  std::printf("    pond centre is %.6f m from the pad centre\n", sepM);
  CHECK(std::fabs(sepM - 55.0) < 1e-6);

  // Wholly inside the dead-flat disc, which is the premise of every bit-exact
  // claim below, and inside the blend disc, which is the premise of the pad
  // tests in test_biome.cpp.
  CHECK(sepM + b.pondRadiusM < b.homeFlatRadiusM);
  // The water stands at all (freeboard below depth) and does not overflow.
  CHECK(b.pondFreeboardM > 0.0);
  CHECK(b.pondFreeboardM < b.pondDepthM);

  const double padH = designedHeightNoPond(b, b.homeDir);
  const double rimH = designedHeightNoPond(b, b.pondDir);
  const double floorH = sampleDesignedHeight(b, b.pondDir);
  std::printf("    pad height %.6f m, un-ponded ground at the pond centre "
              "%.6f m, basin floor %.6f m\n", padH, rimH, floorH);
  std::printf("    levelM %.6f m, shorelineM %.6f m, maxDepthM %.6f m\n",
              water::levelM(b), water::shorelineM(b), water::maxDepthM(b));
  // The ground the basin is cut into IS the pad's own constant, bit for bit.
  CHECK(asBits(rimH) == asBits(padH));
}

// =============================================================================
// §1 - THE BASIN IS REAL TERRAIN.
//
// A pond you can only see is a decal (WG-36). These five say the ground itself
// went down, by the amount claimed, exactly where claimed and nowhere else.
// =============================================================================

// 1. The floor is a full pondDepthM below the ground the basin was cut into.
TEST(basin_centre_is_exactly_pond_depth_below_the_unponded_ground) {
  const BodyParams b = forge();
  const double ground = sampleDesignedHeight(b, b.pondDir);
  const double unponded = designedHeightNoPond(b, b.pondDir);
  CHECK_NEAR(ground, unponded - b.pondDepthM, 1e-9);
  // And the drop term itself is the full depth at t = 0.
  CHECK_NEAR(pondBasinDropM(b, b.pondDir), b.pondDepthM, 1e-12);
}

// 2. At and beyond the rim the two heights are the SAME 64 BITS, not the same
//    number to a tolerance. This is what keeps the rest of the planet's designed
//    height re-baseline-free: `x - 0.0 == x`, and the basin term is required to
//    return a hard 0.0 rather than something that rounds to it.
TEST(outside_the_rim_the_designed_height_is_bit_identical_to_unponded) {
  const BodyParams b = forge();
  const TFrame f = tframe(b.pondDir);
  int onRim = 0, outside = 0;

  // The rim ring itself: 64 bearings placed AT the rim in the pond's own metric.
  for (int i = 0; i < 64; ++i) {
    const double th = i * (2.0 * kPi / 64.0);
    const Vec3 d = dirAtOrBeyond(b, f, th, b.pondRadiusM);
    const double dist = water::distFromPondM(b, d);
    CHECK(dist >= b.pondRadiusM);          // really at or beyond the rim
    CHECK(dist - b.pondRadiusM < 1e-9);    // and really AT it, not near it
    CHECK(pondBasinDropM(b, d) == 0.0);    // exactly zero, not 3e-18
    CHECK(asBits(sampleDesignedHeight(b, d)) ==
          asBits(designedHeightNoPond(b, d)));
    ++onRim;
  }

  // And outside it, out to 200 m: 16 rings of 16 bearings.
  for (int ring = 0; ring < 16; ++ring) {
    const double r = b.pondRadiusM + 0.5 + ring * (200.0 - b.pondRadiusM) / 16.0;
    for (int i = 0; i < 16; ++i) {
      const double th = i * (2.0 * kPi / 16.0) + ring * 0.11;
      const Vec3 d = pondOff(b, f, r, th);
      CHECK(water::distFromPondM(b, d) > b.pondRadiusM);
      CHECK(pondBasinDropM(b, d) == 0.0);
      CHECK(asBits(sampleDesignedHeight(b, d)) ==
            asBits(designedHeightNoPond(b, d)));
      ++outside;
    }
  }
  CHECK(onRim == 64);
  CHECK(outside == 256);
}

// 3. The bowl is MONOTONE: walking in from the rim the ground never rises. A
//    basin with a bump in it has a puddle rather than a pond in it, and a lip
//    the walker would have to climb out of on the way down.
TEST(basin_never_rises_walking_from_the_rim_to_the_centre) {
  const BodyParams b = forge();
  const TFrame f = tframe(b.pondDir);
  int steps = 0;
  for (int ray = 0; ray < 8; ++ray) {
    const double th = ray * (2.0 * kPi / 8.0);
    double prev = sampleDesignedHeight(b, pondOff(b, f, b.pondRadiusM, th));
    for (int k = 199; k >= 0; --k) {      // rim -> centre
      const double r = b.pondRadiusM * k / 200.0;
      const double h = sampleDesignedHeight(b, pondOff(b, f, r, th));
      CHECK(h <= prev);
      prev = h;
      ++steps;
    }
  }
  CHECK(steps == 8 * 200);
}

// 4. The bowl has a REAL WALL, and a wall the player can walk down.
//
//    Two-sided on purpose. The upper bound (0.30) is the walkability claim:
//    biome.h says the steepest grade is 1.5*depth/radius = 0.2727 and that this
//    is inside CAPSULE.slopeLimitCos, so the player wades in rather than slides
//    in. The LOWER bound (0.25) is the one that matters more, because it is what
//    fails if somebody "fixes" a rendering artefact by flattening the bowl: a
//    basin with no grade in it is the decal again, and it would pass every
//    monotonicity and bit-identity check in this file.
TEST(basin_grade_is_steep_enough_to_be_a_bowl_and_shallow_enough_to_walk) {
  const BodyParams b = forge();
  const TFrame f = tframe(b.pondDir);
  const int kN = 2000;
  double worst = 0.0;
  for (int ray = 0; ray < 8; ++ray) {
    const double th = ray * (2.0 * kPi / 8.0);
    Vec3 prevD = pondOff(b, f, 0.0, th);
    double prevH = sampleDesignedHeight(b, prevD);
    double prevR = water::distFromPondM(b, prevD);
    for (int k = 1; k <= kN; ++k) {
      const Vec3 d = pondOff(b, f, b.pondRadiusM * k / kN, th);
      const double h = sampleDesignedHeight(b, d);
      const double r = water::distFromPondM(b, d);
      const double ds = r - prevR;
      if (ds > 0.0) {
        const double grade = std::fabs(h - prevH) / ds;
        if (grade > worst) worst = grade;
      }
      prevH = h;
      prevR = r;
    }
  }
  std::printf("    steepest measured basin grade %.6f (analytic "
              "1.5*depth/radius = %.6f), bounds [0.25, 0.30]\n",
              worst, 1.5 * b.pondDepthM / b.pondRadiusM);
  CHECK(worst <= 0.30);
  CHECK(worst >= 0.25);
}

// 5. A body with no pond is completely untouched: not "close to", the drop term
//    returns the literal 0.0 that makes `x - drop` bit-identical to `x`.
TEST(a_body_with_no_pond_gets_exactly_zero_basin_drop) {
  const BodyParams m = cinder();
  CHECK(m.pondRadiusM == 0.0);
  CHECK(!water::hasPond(m));
  int n = 0;
  for (int i = 0; i < 1000; ++i) {
    const Vec3 d = fibonacciDir(i, 1000);
    CHECK(pondBasinDropM(m, d) == 0.0);
    CHECK(asBits(sampleDesignedHeight(m, d)) ==
          asBits(designedHeightNoPond(m, d)));
    ++n;
  }
  CHECK(n == 1000);
}

// =============================================================================
// §2 - THE WATER LEVEL IS ITS OWN QUANTITY WITH ITS OWN BOUND.
//
// This is the DW-26 assertion applied to the third surface, and it is the point
// of the whole file. The water level is published as its own named scalar and
// bounded against the two ground authorities it sits between, so that a future
// change which quietly makes one of them stand in for another goes red here
// instead of shipping as a sinking deck.
// =============================================================================

// 6. Water never below its own bed, never above its own rim.
//
//    NOTE ON EXTENT. "Inside the pond" is r < shorelineM, not r < pondRadiusM:
//    the annulus between them is the dry beach, where the ground stands ABOVE
//    the water by construction, and the complementary assertion for that band is
//    made here too rather than left as a gap.
TEST(the_water_level_is_bounded_by_its_own_bed_and_its_own_rim) {
  const BodyParams b = forge();
  const TFrame f = tframe(b.pondDir);
  const double lvl = water::levelM(b);
  const double shore = water::shorelineM(b);
  const int kN = 4000;

  int wet = 0;
  for (int i = 0; i < kN; ++i) {
    const Vec3 d = discSample(b, f, i, kN, shore);
    CHECK(water::distFromPondM(b, d) < shore);   // genuinely under water
    // The bed. Strict at the centre, and never violated anywhere.
    CHECK(sampleDesignedHeight(b, d) <= lvl);
    // The rim. Strict everywhere: the water surface is always below the ground
    // the basin was cut into, by pondFreeboardM at the rim and more inside it.
    CHECK(lvl < designedHeightNoPond(b, d));
    ++wet;
  }
  CHECK(wet == kN);

  // The right-hand bound holds over the WHOLE basin, not only the wet part.
  for (int i = 0; i < kN; ++i) {
    const Vec3 d = discSample(b, f, i, kN, b.pondRadiusM);
    CHECK(lvl < designedHeightNoPond(b, d));
  }

  // And the beach really is a beach: dry ground standing above the water, inside
  // the basin. Without this the bound above could be satisfied by a pond that
  // fills the bowl to the brim.
  int beach = 0;
  for (int i = 0; i < 512; ++i) {
    const double t = (i + 0.5) / 512.0;
    const double r = shore + t * (b.pondRadiusM - shore);
    const Vec3 d = pondOff(b, f, r, i * 0.37);
    CHECK(sampleDesignedHeight(b, d) > lvl);
    ++beach;
  }
  CHECK(beach == 512);
}

// 7. The freeboard is exactly what the body declares, at the rim, in metres.
TEST(the_rim_stands_exactly_one_freeboard_above_the_water) {
  const BodyParams b = forge();
  const TFrame f = tframe(b.pondDir);
  const double lvl = water::levelM(b);
  for (int i = 0; i < 64; ++i) {
    const double th = i * (2.0 * kPi / 64.0);
    const Vec3 d = dirAtOrBeyond(b, f, th, b.pondRadiusM);
    CHECK_NEAR(designedHeightNoPond(b, d) - lvl, b.pondFreeboardM, 1e-9);
  }
}

// 8. levelAt is a COLUMN question and it answers kNoWater for every column that
//    has no water in it: outside the basin entirely, and on the dry beach inside
//    it. The second half is the one that stops a player walking the rim from
//    being told they are in a pond.
TEST(level_at_is_no_water_outside_the_rim_and_on_the_dry_beach) {
  const BodyParams b = forge();
  const TFrame f = tframe(b.pondDir);
  const double shore = water::shorelineM(b);

  int out = 0;
  for (int i = 0; i < 512; ++i) {
    const double th = i * (2.0 * kPi / 512.0);
    // Half exactly on the rim, half spread outwards to 500 m.
    const double r = (i % 2 == 0) ? b.pondRadiusM
                                  : b.pondRadiusM + 0.25 + (i % 128) * 3.9;
    const Vec3 d = (i % 2 == 0) ? dirAtOrBeyond(b, f, th, b.pondRadiusM)
                                : pondOff(b, f, r, th);
    CHECK(water::distFromPondM(b, d) >= b.pondRadiusM);
    CHECK(water::levelAt(b, d) == water::kNoWater);
    ++out;
  }
  CHECK(out == 512);

  int dry = 0;
  for (int i = 0; i < 512; ++i) {
    const double t = (i + 0.5) / 512.0;
    const double r = shore + t * (b.pondRadiusM - shore);
    const Vec3 d = pondOff(b, f, r, i * 0.37);
    const double dist = water::distFromPondM(b, d);
    CHECK(dist > shore && dist < b.pondRadiusM);   // genuinely on the beach
    CHECK(water::levelAt(b, d) == water::kNoWater);
    ++dry;
  }
  CHECK(dry == 512);
}

// 9. The deepest water is depth minus freeboard, and it is at the centre.
TEST(max_depth_is_depth_minus_freeboard_and_is_reached_at_the_centre) {
  const BodyParams b = forge();
  CHECK_NEAR(water::maxDepthM(b), b.pondDepthM - b.pondFreeboardM, 1e-9);
  CHECK_NEAR(water::maxDepthM(b), 3.40, 1e-9);
  CHECK_NEAR(water::depthAt(b, b.pondDir), water::maxDepthM(b), 1e-9);
}

// 10. THE SHORELINE IS DERIVED, NOT STORED.
//
//     water_field.h solves for the radius at which the basin has dropped exactly
//     one freeboard, rather than shipping the waterline as a fourth constant,
//     precisely so it cannot come to police a ring the basin has since moved
//     away from. This checks the solved radius against the thing it is supposed
//     to be a solution OF: the ground meets the water there, water stands just
//     inside it, and there is none just outside it.
TEST(the_shoreline_is_solved_from_the_basin_profile) {
  const BodyParams b = forge();
  const TFrame f = tframe(b.pondDir);
  const double shore = water::shorelineM(b);
  const double lvl = water::levelM(b);
  std::printf("    shorelineM measured %.6f m (basin rim %.2f m, so the water "
              "is %.2f m across inside a %.2f m bowl)\n",
              shore, b.pondRadiusM, 2.0 * shore, 2.0 * b.pondRadiusM);
  CHECK(shore > 0.0);
  CHECK(shore < b.pondRadiusM);

  for (int i = 0; i < 32; ++i) {
    const double th = i * (2.0 * kPi / 32.0);

    // AT the shoreline the ground IS the water level. Asserted on the raw
    // difference, not on depthAt, because depthAt short-circuits to 0.0 the
    // moment the column reads dry and would satisfy the bound for free.
    const Vec3 dOn = dirAtOrBeyond(b, f, th, shore);
    CHECK(std::fabs(lvl - sampleDesignedHeight(b, dOn)) < 1e-9);
    CHECK(std::fabs(water::depthAt(b, dOn)) < 1e-9);

    // A thousandth inside: real water.
    const Vec3 dIn = pondOff(b, f, shore * 0.999, th);
    CHECK(water::depthAt(b, dIn) > 0.0);

    // A thousandth outside: no water at all, and exactly zero rather than a
    // small negative dressed up as a depth.
    const Vec3 dOut = pondOff(b, f, shore * 1.001, th);
    CHECK(water::depthAt(b, dOut) == 0.0);
  }
}

// 11. Depth increases STRICTLY all the way in from the shore. A pond with a flat
//     depth is a plane pretending to be a volume; the strictness is what says
//     the water is standing in the bowl rather than being painted over it.
TEST(depth_increases_strictly_from_the_shore_to_the_centre) {
  const BodyParams b = forge();
  const TFrame f = tframe(b.pondDir);
  const double shore = water::shorelineM(b);
  int steps = 0;
  for (int ray = 0; ray < 8; ++ray) {
    const double th = ray * (2.0 * kPi / 8.0);
    double prev = water::depthAt(b, dirAtOrBeyond(b, f, th, shore));
    for (int k = 499; k >= 0; --k) {
      const double r = shore * k / 500.0;
      const double d = water::depthAt(b, pondOff(b, f, r, th));
      CHECK(d > prev);
      prev = d;
      ++steps;
    }
    CHECK_NEAR(prev, water::maxDepthM(b), 1e-6);   // arrived at the deepest point
  }
  CHECK(steps == 8 * 500);
}

// 12. submersionM is the character controller's ONE question, in metres, signed.
TEST(submersion_is_signed_metres_below_the_water_surface) {
  const BodyParams b = forge();
  const TFrame f = tframe(b.pondDir);
  const double surfR = water::levelRadius(b);

  const Vec3 onSurface = b.pondDir * surfR;
  CHECK_NEAR(water::submersionM(b, onSurface), 0.0, 1e-6);
  CHECK_NEAR(water::submersionM(b, b.pondDir * (surfR + 1.0)), -1.0, 1e-6);
  CHECK_NEAR(water::submersionM(b, b.pondDir * (surfR - 1.0)), 1.0, 1e-6);
  // On the surface is NOT submerged; a hair under it is.
  CHECK(!water::submerged(b, onSurface));
  CHECK(water::submerged(b, b.pondDir * (surfR - 0.01)));

  // submerged() is exactly submersionM > 0, everywhere, with no daylight between
  // the convenience and the quantity it wraps.
  int agreed = 0;
  for (int i = 0; i < 2000; ++i) {
    const Vec3 d = discSample(b, f, i, 2000, b.pondRadiusM * 1.4);
    // A ladder of altitudes about the water surface, including exactly on it.
    const double dh = -3.0 + 6.0 * ((i % 25) / 24.0);
    const Vec3 p = d * (surfR + dh);
    CHECK(water::submerged(b, p) == (water::submersionM(b, p) > 0.0));
    ++agreed;
  }
  CHECK(agreed == 2000);
}

// 13. Outside the pond, submersionM is a large NEGATIVE rather than NaN or 0, so
//     `submersionM(p) > 0` is a COMPLETE test for "in water" and a caller that
//     writes it needs no companion check. This is the property that stops a
//     forgotten guard from silently reading as "not in water" on a body that has
//     water, or as "in water" at the datum on a body that has none.
TEST(submersion_is_unreachably_negative_where_there_is_no_water) {
  const BodyParams b = forge();
  const TFrame f = tframe(b.pondDir);
  for (int i = 0; i < 256; ++i) {
    const double th = i * (2.0 * kPi / 256.0);
    const double r = b.pondRadiusM + 0.5 + (i % 64) * 8.0;
    const Vec3 d = pondOff(b, f, r, th);
    // At three altitudes, including below the water surface radius: being deep
    // is not being wet if you are not in the pond.
    for (double dh = -5.0; dh <= 5.0; dh += 5.0) {
      const Vec3 p = d * (water::levelRadius(b) + dh);
      CHECK(water::submersionM(b, p) < -1e29);
      CHECK(!water::submerged(b, p));
    }
  }
  // A body with no water at all answers the same way, at its own surface.
  const BodyParams m = cinder();
  for (int i = 0; i < 64; ++i) {
    const Vec3 d = fibonacciDir(i, 64);
    const Vec3 p = d * (m.radiusM + sampleDesignedHeight(m, d));
    CHECK(water::submersionM(m, p) < -1e29);
    CHECK(!water::submerged(m, p));
  }
}

// =============================================================================
// §3 - THE TWO AUTHORITIES DO NOT CONTAMINATE EACH OTHER.
// =============================================================================

// 14. THE NEGATIVE CONTROL, and the reason this file exists.
//
//     The surface oracle at the pond centre must return the BASIN FLOOR, the
//     thing the player's feet rest on, and must not have quietly become the
//     water level. Both halves are asserted: the floor to 1e-9, and a hard 3 m
//     of daylight between the floor and the water surface, so that a height
//     function which started returning the water level cannot pass by being
//     "close enough". If anyone ever wires the two together, this check goes red
//     BY NAME and the name says what happened.
TEST(the_surface_oracle_returns_the_basin_floor_and_never_the_water_level) {
  const BodyParams b = forge();
  const DensityField noEdits;                 // pristine world, no digging
  const double lvl = water::levelM(b);

  const double ground = surfaceHeight(b, b.pondDir, noEdits);
  CHECK_NEAR(ground, lvl - water::maxDepthM(b), 1e-9);
  CHECK(std::fabs(ground - lvl) >= 3.0);
  // The same statement said the other way: the oracle is the designed ground,
  // bit for bit, and the designed ground under the pond is the basin floor.
  CHECK(asBits(ground) == asBits(sampleDesignedHeight(b, b.pondDir)));
  CHECK(asBits(ground) == asBits(baseHeight(b, b.pondDir)));

  // And across the whole wet disc, never once the water level.
  const TFrame f = tframe(b.pondDir);
  for (int i = 0; i < 512; ++i) {
    const Vec3 d = discSample(b, f, i, 512, water::shorelineM(b));
    const double g = surfaceHeight(b, d, noEdits);
    CHECK(asBits(g) == asBits(sampleDesignedHeight(b, d)));
    CHECK(g < lvl);                            // under water, and knows it is
  }
}

// 15. Determinism (standing rule 4): the same body built twice answers with the
//     same BITS, for the derived scalars and for the ground under them.
TEST(the_water_level_and_the_ground_under_it_are_deterministic) {
  const BodyParams a = makeForge(kTunedSeed);
  const BodyParams b = makeForge(kTunedSeed);
  CHECK(asBits(water::levelM(a)) == asBits(water::levelM(b)));
  CHECK(asBits(water::shorelineM(a)) == asBits(water::shorelineM(b)));
  CHECK(asBits(water::maxDepthM(a)) == asBits(water::maxDepthM(b)));
  CHECK(asBits(water::levelRadius(a)) == asBits(water::levelRadius(b)));

  const TFrame f = tframe(a.pondDir);
  int n = 0;
  for (int i = 0; i < 1000; ++i) {
    const Vec3 d = discSample(a, f, i, 1000, a.pondRadiusM * 1.5);
    CHECK(asBits(sampleDesignedHeight(a, d)) == asBits(sampleDesignedHeight(b, d)));
    CHECK(asBits(water::depthAt(a, d)) == asBits(water::depthAt(b, d)));
    ++n;
  }
  CHECK(n == 1000);
}

// 16. A body with no pond has no water anywhere, and says so in every function.
TEST(a_body_with_no_pond_has_no_water_in_any_of_the_answers) {
  const BodyParams m = cinder();
  CHECK(!water::hasPond(m));
  CHECK(water::levelM(m) == water::kNoWater);
  CHECK(water::levelRadius(m) == water::kNoWater);
  CHECK(water::shorelineM(m) == 0.0);
  CHECK(water::maxDepthM(m) == 0.0);
  const DensityField noEdits;
  for (int i = 0; i < 500; ++i) {
    const Vec3 d = fibonacciDir(i, 500);
    CHECK(water::levelAt(m, d) == water::kNoWater);
    CHECK(water::depthAt(m, d) == 0.0);
    CHECK(water::depthAt(m, d, noEdits) == 0.0);
  }
}
