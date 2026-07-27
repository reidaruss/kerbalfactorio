// =============================================================================
// test_discovery.cpp — the discoverable map (WG-29 / DW-36), adversarially.
//
// STANDING RULE 11 IS THE POINT OF THIS FILE. Two of that rule's five worked
// examples came out of this lane: a mesher whose every triangle was wound inside
// out survived 143 green checks because the one test that read indices SORTED
// each triple, and a negative control policed a stale private copy of a radius
// it did not own. So every check below asserts the property the header CLAIMS,
// against a value derived from the geometry on paper, and never against a
// threshold moved until it passed. Where a number is a band, the derivation of
// the band is written next to it.
//
// The five things being proved, in the order they can hurt:
//
//   §1 THE LATTICE CROSS-CHECK, and the reason this suite exists.
//      SurfaceCellGrid is a SECOND COPY of the raw-gnomonic cube lattice inside
//      enemies.h's PollutionField. A second unnamed authority is the failure
//      this project has paid for five times, so the copy is not left as a claim
//      in a comment: this file includes BOTH headers and asserts they agree
//      cell-for-cell over 200,000 directions spread across face interiors, every
//      seam, every edge midpoint and all eight cube corners, at six shared bit
//      counts on two bodies — cellOf EXACTLY, cellCentreDir BIT-IDENTICAL (by
//      uint64 memcpy, not CHECK_NEAR: this lane proves identity with bits), and
//      neighbours() cell-for-cell over every border ring. If either header ever
//      drifts, this fails by name.
//
//   §2 THE FLOOD, BY BRUTE FORCE AND NOT BY TOLERANCE. The breadth-first pass is
//      the part most able to silently miss ground, because a region that is
//      inside the cap but disconnected on the lattice is invisible to it and
//      leaves no trace. So at a small bit count the WHOLE body is enumerated,
//      every cell tested against the same threshold the pass used, and the two
//      sets compared exactly, both directions. The seed cell is accepted
//      unconditionally by design and is handled as the one named exception
//      rather than by loosening the comparison.
//
//   §3 THE HORIZON ALGEBRA, against the geometry rather than against itself. The
//      threshold is asserted BIT-EQUAL to R/(R+h) — the tangent point — the cap
//      BIT-EQUAL to its own chord form, chordFor pinned as the exact inverse,
//      altitude proved monotone as a SET INCLUSION, and the cap's crossover
//      altitude pinned to the closed form h* = R u^2/(2-u^2) = 83.345 m by
//      bracketing it from both sides.
//
//   §4 DETERMINISM, including the truncated pass, which is the one nobody
//      remembers to check.
//
//   §5 SERIALIZATION: exact round trip, a stream that is a pure function of the
//      SET, a foreign lattice REFUSED with the cursor left where the caller
//      expects, and the corrupt-stream guard — which is where this suite found
//      the header's one real defect (see `corrupt_stream_cannot_leave_an_
//      unsorted_vector`).
//
//   §6 COST: that a pass is O(AREA) and cannot be O(entities), asserted through
//      the gnomonic area Jacobian rather than printed, plus the measured table.
//
// Consumes of/discovery.h (the subject), of/enemies.h READ-ONLY (the lattice it
// must agree with — this file never writes to it and the enemy model is another
// lane's), of/cubed_sphere.h READ-ONLY (mix64/hashToUnit, for deterministic
// directions), and of/persistence.h for the byte cursors discovery.h is
// templated over but deliberately does not include.
// =============================================================================
#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <vector>

#include "test_framework.h"

#include "of/cubed_sphere.h"
#include "of/discovery.h"
#include "of/enemies.h"
#include "of/persistence.h"

namespace dsc = of::worldgen::discovery;
using of::Vec3;
using dsc::CellKey;

// -----------------------------------------------------------------------------
// Bodies. Bare radii, because DiscoveryGrid takes a radius and not a BodyParams.
// -----------------------------------------------------------------------------
static const double kForgeR = 6.0e5;    // Forge, 600 km
static const double kCinderR = 2.0e5;   // Cinder, 200 km
static const double kPi = 3.14159265358979323846;

// --- bit-identity helpers (the same shape as test_world_gen.cpp) -------------
static uint64_t asBits(double d) {
  uint64_t u;
  std::memcpy(&u, &d, sizeof(u));
  return u;
}
static bool bitEqual(double a, double b) { return asBits(a) == asBits(b); }
static bool bitEqual(const Vec3& a, const Vec3& b) {
  return bitEqual(a.x, b.x) && bitEqual(a.y, b.y) && bitEqual(a.z, b.z);
}

static Vec3 unit(const Vec3& v) {
  const double l = v.length();
  return Vec3(v.x / l, v.y / l, v.z / l);
}

// A great-circle direction: rotate `a` toward `b` by angle t. Trig is fine HERE
// (this is a test fixture, not world state); the header itself is the thing that
// must stay transcendental-free, and §3 checks its thresholds by exact algebra.
static Vec3 greatCircle(const Vec3& a, const Vec3& b, double t) {
  const double c = std::cos(t), s = std::sin(t);
  return unit(Vec3(a.x * c + b.x * s, a.y * c + b.y * s, a.z * c + b.z * s));
}

// -----------------------------------------------------------------------------
// Deterministic direction generator for the §1 sweep. mix64/hashToUnit so the
// 200,000 directions are the same on every machine and every run, and every 16th
// sample is FORCED onto a face seam, an edge midpoint, a cube corner or an exact
// axis — the places a lattice disagreement would actually live. A uniform random
// sweep would visit a face boundary with probability ~0.
// -----------------------------------------------------------------------------
static Vec3 sweepDir(uint64_t i) {
  using of::worldgen::hashToUnit;
  using of::worldgen::mix64;
  const uint64_t h = mix64(i * 0x9E3779B97F4A7C15ull + 0xD15C0FFEEull);
  double x = hashToUnit(mix64(h ^ 0x11)) * 2.0 - 1.0;
  double y = hashToUnit(mix64(h ^ 0x22)) * 2.0 - 1.0;
  double z = hashToUnit(mix64(h ^ 0x33)) * 2.0 - 1.0;
  if (std::fabs(x) + std::fabs(y) + std::fabs(z) < 1e-9) return Vec3(0, 0, 1);
  const double sx = x < 0 ? -1.0 : 1.0, sy = y < 0 ? -1.0 : 1.0,
               sz = z < 0 ? -1.0 : 1.0;
  const double eps = (hashToUnit(mix64(h ^ 0x44)) - 0.5) * 4e-16;
  switch (i % 16) {
    case 1:  // exact axis
      switch ((i / 16) % 6) {
        case 0: return Vec3(0, 0, 1);
        case 1: return Vec3(0, 0, -1);
        case 2: return Vec3(0, 1, 0);
        case 3: return Vec3(0, -1, 0);
        case 4: return Vec3(-1, 0, 0);
        default: return Vec3(1, 0, 0);
      }
    case 2: return unit(Vec3(sx, sy, 0));            // edge midpoint
    case 3: return unit(Vec3(0, sy, sz));            // edge midpoint
    case 4: return unit(Vec3(sx, 0, sz));            // edge midpoint
    case 5: return unit(Vec3(sx, sy, sz));           // cube corner, exact
    case 6: return unit(Vec3(sx + eps, sy, sz));     // a hair off a corner
    case 7: return unit(Vec3(x, y, sz * std::fabs(x)));  // exactly on a +-Z/+-X seam
    case 8: return unit(Vec3(sx * std::fabs(z), y, z));  // exactly on a +-X/+-Z seam
    case 9: return unit(Vec3(x, sy * std::fabs(z), z));  // exactly on a +-Y/+-Z seam
    case 10: return unit(Vec3(x, y, sz * (std::fabs(x) + eps)));  // a hair off it
    default: return unit(Vec3(x, y, z));
  }
}

// =============================================================================
// §1 — THE LATTICE CROSS-CHECK. The most important test in the file.
// =============================================================================

// The six cell targets below are not decoration: 10000 and 250 are the survey
// and explore layers' own defaults, 200 is enemies.h's own default, and 40000 /
// 100000 / 50 bracket the resolveBits ladder at both ends so the sqrt(2) rounding
// bias is exercised where it flips.
static const double kSharedTargets[] = {10000.0, 250.0,  200.0, 1000.0,
                                        50.0,    5000.0, 37.0,  40000.0,
                                        100000.0};

TEST(lattice_bit_count_agrees_with_pollution_field) {
  for (double R : {kForgeR, kCinderR}) {
    for (double target : kSharedTargets) {
      of::worldgen::BodyParams body;
      body.radiusM = R;
      of::enemies::EnemyTuning et;
      et.cellTargetM = target;
      const of::enemies::PollutionField pf(body, et);
      const dsc::SurfaceCellGrid sg(R, target);
      // Same subdivision, therefore the same cells. Not "close": the same.
      CHECK(sg.cellBits() == pf.cellBits());
      CHECK(sg.cellsPerFaceSide() == pf.cellsPerFaceSide());
      // And the size each one QUOTES has to match too, or a caller reading one
      // number and indexing with the other is off by a factor.
      CHECK(bitEqual(sg.cellSizeAtFaceCentreM(), pf.cellSizeAtFaceCentreM()));
    }
  }
  // The two documented realisations, pinned so a resolveBits change is loud.
  const dsc::SurfaceCellGrid survey(kForgeR, 10000.0);
  CHECK(survey.cellsPerFaceSide() == 128u);
  CHECK(survey.totalCells() == 98304ull);
  CHECK_NEAR(survey.cellSizeAtFaceCentreM(), 9375.0, 1e-9);
  const dsc::SurfaceCellGrid explore(kForgeR, 250.0);
  CHECK(explore.cellsPerFaceSide() == 4096u);
  CHECK(explore.totalCells() == 100663296ull);
  CHECK_NEAR(explore.cellSizeAtFaceCentreM(), 292.96875, 1e-9);
}

// The headline. 200,000 directions through BOTH lattices at the explore
// resolution, plus 20,000 more at each of five other shared bit counts and on
// Cinder. Mismatches are ACCUMULATED and asserted once (200k CHECK calls would
// drown the suite), with the first disagreement printed so a failure is
// diagnosable rather than merely loud.
namespace {
struct CrossCheck {
  uint64_t cellMismatch = 0;
  uint64_t centreMismatch = 0;
  uint64_t samples = 0;
  CellKey firstA = 0, firstB = 0;
  Vec3 firstDir{0, 0, 0};
};

CrossCheck crossCheck(double R, double target, uint64_t n, uint64_t salt) {
  of::worldgen::BodyParams body;
  body.radiusM = R;
  of::enemies::EnemyTuning et;
  et.cellTargetM = target;
  const of::enemies::PollutionField pf(body, et);
  const dsc::SurfaceCellGrid sg(R, target);
  CrossCheck cc;
  for (uint64_t i = 0; i < n; ++i) {
    const Vec3 d = sweepDir(i + salt);
    const CellKey a = sg.cellOf(d);
    const CellKey b = pf.cellOf(d);
    ++cc.samples;
    if (a != b) {
      if (cc.cellMismatch == 0) { cc.firstA = a; cc.firstB = b; cc.firstDir = d; }
      ++cc.cellMismatch;
      continue;
    }
    // Bit-identical centres, by uint64 compare. A last-bit difference here is
    // exactly the kind that flips a boundary cell and desyncs a SAVED set, so
    // CHECK_NEAR would be the wrong instrument.
    if (!bitEqual(sg.cellCentreDir(a), pf.cellCentreDir(b))) ++cc.centreMismatch;
  }
  return cc;
}
}  // namespace

TEST(lattice_cell_of_and_centre_agree_with_pollution_field_bitwise) {
  // 200,000 at the explore lattice (bits 12), the one the ore patches ride on.
  const CrossCheck main = crossCheck(kForgeR, 250.0, 200000, 0);
  std::printf("    [lattice] %llu directions at explore bits: %llu cell / %llu centre mismatches\n",
              (unsigned long long)main.samples,
              (unsigned long long)main.cellMismatch,
              (unsigned long long)main.centreMismatch);
  if (main.cellMismatch != 0) {
    std::printf("    [lattice] FIRST mismatch dir (%.17g, %.17g, %.17g): sg %llu vs pf %llu\n",
                main.firstDir.x, main.firstDir.y, main.firstDir.z,
                (unsigned long long)main.firstA, (unsigned long long)main.firstB);
  }
  CHECK(main.samples == 200000u);
  CHECK(main.cellMismatch == 0);
  CHECK(main.centreMismatch == 0);

  // Every other bit count the two headers share, on both bodies. A lattice that
  // agrees at one subdivision and not another is the interesting failure.
  uint64_t totalCell = 0, totalCentre = 0, totalSamples = 0;
  uint64_t salt = 7777;
  for (double R : {kForgeR, kCinderR}) {
    for (double target : kSharedTargets) {
      const CrossCheck cc = crossCheck(R, target, 20000, salt);
      salt += 20011;
      totalCell += cc.cellMismatch;
      totalCentre += cc.centreMismatch;
      totalSamples += cc.samples;
    }
  }
  std::printf("    [lattice] %llu more directions over %zu (radius, target) pairs: "
              "%llu cell / %llu centre mismatches\n",
              (unsigned long long)totalSamples,
              size_t(2 * (sizeof(kSharedTargets) / sizeof(double))),
              (unsigned long long)totalCell, (unsigned long long)totalCentre);
  CHECK(totalSamples == 360000u);
  CHECK(totalCell == 0);
  CHECK(totalCentre == 0);
}

TEST(lattice_neighbours_agree_with_pollution_field_across_every_seam) {
  // Border rings at three subdivisions. The border ring of all six faces
  // contains every face edge and, four times over, all eight cube corners, which
  // is where a neighbour step stops being integer arithmetic and starts being
  // geometry. Interior cells are sampled too so the cheap path is covered.
  uint64_t mismatches = 0, cells = 0, corners = 0;
  for (double target : {40000.0, 10000.0, 5000.0}) {
    of::worldgen::BodyParams body;
    body.radiusM = kForgeR;
    of::enemies::EnemyTuning et;
    et.cellTargetM = target;
    const of::enemies::PollutionField pf(body, et);
    const dsc::SurfaceCellGrid sg(kForgeR, target);
    CHECK(sg.cellBits() == pf.cellBits());
    const uint32_t side = sg.cellsPerFaceSide();
    const uint32_t stride = side > 64 ? side / 64 : 1;
    for (int f = 0; f < 6; ++f) {
      for (uint32_t i = 0; i < side; ++i) {
        for (uint32_t j = 0; j < side; ++j) {
          const bool border =
              (i == 0 || i == side - 1 || j == 0 || j == side - 1);
          if (!border && (i % stride != 0 || j % stride != 0)) continue;
          const CellKey k = dsc::SurfaceCellGrid::packKey(f, i, j);
          CellKey a[4], b[4];
          sg.neighbours(k, a);
          pf.neighbours(k, b);
          ++cells;
          if ((i == 0 || i == side - 1) && (j == 0 || j == side - 1)) ++corners;
          for (int n = 0; n < 4; ++n)
            if (a[n] != b[n]) ++mismatches;
        }
      }
    }
  }
  std::printf("    [lattice] neighbours: %llu cells (%llu of them cube-corner cells), "
              "%llu mismatches\n",
              (unsigned long long)cells, (unsigned long long)corners,
              (unsigned long long)mismatches);
  CHECK(cells > 3000u);
  CHECK(corners == 72u);  // 6 faces x 4 corner cells x 3 subdivisions
  CHECK(mismatches == 0);
}

// A cell's centre must land back in that same cell, or the flood's accept test
// and the store's membership test are asking about different cells. This is not
// implied by anything above it: cellOf and cellCentreDir are separate functions.
TEST(cell_centre_round_trips_to_its_own_cell) {
  uint64_t bad = 0, n = 0;
  for (double R : {kForgeR, kCinderR}) {
    const dsc::SurfaceCellGrid g(R, 40000.0);
    const uint32_t side = g.cellsPerFaceSide();
    for (int f = 0; f < 6; ++f)
      for (uint32_t i = 0; i < side; ++i)
        for (uint32_t j = 0; j < side; ++j) {
          const CellKey k = dsc::SurfaceCellGrid::packKey(f, i, j);
          ++n;
          if (g.cellOf(g.cellCentreDir(k)) != k) ++bad;
        }
  }
  std::printf("    [lattice] cellOf(cellCentreDir(k)) == k: %llu bad of %llu\n",
              (unsigned long long)bad, (unsigned long long)n);
  CHECK(n > 6000u);
  CHECK(bad == 0);
}

// =============================================================================
// §2 — THE FLOOD, BY BRUTE FORCE.
//
// SOUNDNESS: nothing in the store was outside the cap. COMPLETENESS: nothing
// inside the cap was left out of the store. The second is the negative control
// and the one that matters, because a flood that misses a disconnected region
// leaves no counter, no warning and no visible symptom until a player walks over
// ore the map says they have already seen.
//
// The seed cell is accepted UNCONDITIONALLY by design ("you are standing in it"),
// so it is the single legal member that may fail the dot test. It is named and
// excluded explicitly rather than absorbed into a looser comparison.
// =============================================================================
namespace {
struct BruteResult {
  size_t stored = 0;
  size_t inCap = 0;      // cells the brute-force sweep found inside the cap
  size_t missing = 0;    // inside the cap but NOT in the store  <- completeness
  size_t unsound = 0;    // in the store but outside the cap (seed excluded)
  size_t seedOutside = 0;
};

BruteResult bruteCheck(dsc::DiscoveryGrid& g, const Vec3& site, double h) {
  g.clear();
  const dsc::ObservePass p = g.observe(site, h, 1.0);
  const Vec3 d = dsc::unitOfDir(site);
  const CellKey seed = g.grid().cellOf(d);
  const uint32_t side = g.grid().cellsPerFaceSide();
  BruteResult r;
  r.stored = g.size();
  for (int f = 0; f < 6; ++f)
    for (uint32_t i = 0; i < side; ++i)
      for (uint32_t j = 0; j < side; ++j) {
        const CellKey k = dsc::SurfaceCellGrid::packKey(f, i, j);
        if (g.grid().cellCentreDir(k).dot(d) >= p.cosMin) {
          ++r.inCap;
          if (!g.has(k)) ++r.missing;
        }
      }
  for (CellKey k : g.cells()) {
    if (k == seed) continue;
    if (g.grid().cellCentreDir(k).dot(d) < p.cosMin) ++r.unsound;
  }
  if (g.grid().cellCentreDir(seed).dot(d) < p.cosMin) r.seedOutside = 1;
  // The store must be exactly the cap plus, at most, the seed.
  return r;
}
}  // namespace

TEST(flood_is_sound_and_complete_against_a_whole_body_enumeration) {
  const Vec3 sites[] = {
      Vec3(0, 0, 1),                  // a face centre, where cells are biggest
      unit(Vec3(1, 0, 1)),            // a face-edge midpoint, across a seam
      unit(Vec3(1, 1, 1)),            // an exact cube corner, three faces meeting
      unit(Vec3(-1, 1, -1)),          // another corner, opposite winding
      unit(Vec3(0.31, -0.72, 0.19)),  // arbitrary
      unit(Vec3(-0.88, 0.13, 0.45)),  // arbitrary
  };
  // 0 is the on-foot case where the disc is far smaller than a cell and only the
  // seed survives; 400 km is more than a hemisphere on Forge.
  const double alts[] = {0.0, 250.0, 1000.0, 10000.0, 80000.0, 400000.0};

  size_t totalInCap = 0, totalMissing = 0, totalUnsound = 0, cases = 0,
         altZero = 0, enumerated = 0;
  // 40000 m -> side 32 (6,144 cells); 20000 m -> side 64 (24,576 cells). Small
  // enough to enumerate the WHOLE body per case, which is the only way to know
  // the flood missed nothing.
  for (double target : {40000.0, 20000.0}) {
    dsc::DiscoveryGrid g(kForgeR, target, 0.0, 1u << 20);
    for (const Vec3& s : sites) {
      for (double h : alts) {
        const BruteResult r = bruteCheck(g, s, h);
        totalInCap += r.inCap;
        totalMissing += r.missing;
        totalUnsound += r.unsound;
        enumerated += size_t(g.grid().totalCells());
        ++cases;
        // The store is the cap, plus the seed iff the seed is outside it. Both
        // directions in one equation, and the seed named rather than smuggled.
        CHECK(r.stored == r.inCap + r.seedOutside);
        if (h == 0.0) {
          // At zero altitude the threshold is exactly 1, so NO cell centre can
          // pass and the store is the seed alone. This is the design's one
          // unconditional acceptance, isolated so it cannot hide in the totals.
          ++altZero;
          CHECK(r.inCap == 0u);
          CHECK(r.stored == 1u);
          CHECK(r.seedOutside == 1u);
        }
      }
    }
  }
  std::printf("    [flood] %zu cases, %zu cells enumerated, %zu inside the cap: "
              "%zu MISSING, %zu unsound (%zu altitude-0 seed-only passes)\n",
              cases, enumerated, totalInCap, totalMissing, totalUnsound, altZero);
  CHECK(cases == 72u);
  CHECK(enumerated == 1105920u);
  CHECK(altZero == 12u);
  CHECK(totalInCap > 30000u);        // the sweep really did find ground
  CHECK(totalMissing == 0);          // COMPLETENESS
  CHECK(totalUnsound == 0);          // SOUNDNESS
}

// The seed exception, isolated so it cannot hide inside the sweep above: on foot
// the disc is 1.4 km and a survey cell is 9.4 km, so the pass discovers exactly
// one cell and it is the one the observer is standing in.
TEST(standing_still_discovers_the_cell_you_are_standing_in_and_nothing_else) {
  dsc::DiscoveryGrid survey(kForgeR, 10000.0, 0.0, 65536);
  const Vec3 here = unit(Vec3(0.2, -0.3, 0.9));
  const dsc::ObservePass p = survey.observe(here, 1.7, 1.0);
  CHECK(p.accepted == 1u);
  CHECK(p.added == 1u);
  CHECK(survey.size() == 1u);
  CHECK(survey.cells()[0] == survey.grid().cellOf(here));
  CHECK(survey.hasDir(here));
  // 1.4 km of horizon at eye height, from the chord form, on a 600 km body.
  CHECK_NEAR(p.radiusChordM, 1428.3, 0.5);
  // And the cell next door is NOT discovered. (The negative half; without it
  // "everything is discovered" would pass the line above.)
  CellKey nb[4];
  survey.grid().neighbours(survey.cells()[0], nb);
  for (int k = 0; k < 4; ++k) CHECK(!survey.has(nb[k]));
}

// =============================================================================
// §3 — THE HORIZON ALGEBRA, against the geometry.
// =============================================================================

TEST(threshold_is_the_tangent_point_exactly) {
  // Uncapped, the threshold IS the tangent condition dot == R/(R+h). Bit-equal,
  // not near: this number decides membership of a set that gets SAVED.
  dsc::DiscoveryGrid uncapped(kForgeR, 10000.0, 0.0, 65536);
  for (double h : {0.0, 1.7, 100.0, 1000.0, 10000.0, 80000.0, 1.0e6}) {
    const double want = kForgeR / (kForgeR + h);
    CHECK(bitEqual(uncapped.cosMinFor(h, 1.0), want));
  }
  // h <= 0 is clamped to 0, so the threshold is exactly 1: you see the ground
  // under your feet and nothing else. Negative altitude must not widen it.
  CHECK(bitEqual(uncapped.cosMinFor(0.0, 1.0), 1.0));
  CHECK(bitEqual(uncapped.cosMinFor(-500.0, 1.0), 1.0));

  // The tangent point, checked as GEOMETRY rather than as algebra: a point on
  // the sphere at exactly the threshold angle is the one the line of sight
  // grazes, so the observer-to-point vector is perpendicular to the surface
  // normal there. |obs| = R+h, |p| = R, dot(p, obs) = R*(R+h)*cosMin = R^2, so
  // (obs - p).p == 0. That is the definition of "on the horizon" and it is
  // independent of the formula the header used.
  for (double h : {1.7, 1000.0, 80000.0}) {
    const double cosMin = uncapped.cosMinFor(h, 1.0);
    const double dotPobs = kForgeR * (kForgeR + h) * cosMin;
    CHECK_NEAR(dotPobs - kForgeR * kForgeR, 0.0, 1e-3);
  }

  // horizonFraction scales the HEIGHT, monotonically, and 1.0 is the derived
  // default. Half the height is a strictly tighter threshold, never a looser one.
  CHECK(uncapped.cosMinFor(80000.0, 0.5) > uncapped.cosMinFor(80000.0, 1.0));
  CHECK(bitEqual(uncapped.cosMinFor(80000.0, 0.5),
                 kForgeR / (kForgeR + 40000.0)));
  // Out-of-range fractions are clamped, not extrapolated.
  CHECK(bitEqual(uncapped.cosMinFor(80000.0, 4.0),
                 uncapped.cosMinFor(80000.0, 1.0)));
  CHECK(bitEqual(uncapped.cosMinFor(80000.0, -1.0), 1.0));
}

TEST(chord_form_inverts_the_threshold_and_the_cap_binds_where_it_should) {
  const double cap = 10000.0;
  dsc::DiscoveryGrid capped(kForgeR, 250.0, cap, 65536);
  const double u = cap / kForgeR;
  const double capCos = 1.0 - 0.5 * u * u;

  // The cap is the chord form, bit for bit, wherever it binds.
  CHECK(bitEqual(capped.cosMinFor(80000.0, 1.0), capCos));
  // chordFor is its exact inverse: R*sqrt(2(1-cos)) recovers the chord.
  CHECK_NEAR(capped.chordFor(capCos), cap, 1e-6);
  CHECK_NEAR(capped.chordFor(capped.cosMinFor(80000.0, 1.0)), cap, 1e-6);
  // And it inverts the HORIZON form too: the chord to the tangent point at
  // height h is R*sqrt(2h/(R+h)), which is the closed form for that geometry.
  dsc::DiscoveryGrid uncapped(kForgeR, 250.0, 0.0, 65536);
  for (double h : {1.7, 1000.0, 10000.0, 80000.0}) {
    const double want =
        kForgeR * std::sqrt(2.0 * h / (kForgeR + h));
    CHECK_NEAR(uncapped.chordFor(uncapped.cosMinFor(h, 1.0)), want, 1e-6);
  }
  // The three horizon radii the header's opening paragraph quotes in prose,
  // recomputed here from the closed form and PRINTED rather than pinned to the
  // prose. The prose reads "1.4 km on foot, 110 km at 10 km up, 285 km at 80 km";
  // the algebra gives 1428.3 m, 108,642.9 m and 291,044.9 m. The first two round
  // to what is written, the third does not -- 285 km is not the chord (291.0 km)
  // and not the arc (294.0 km) either. The comment is the thing that is wrong,
  // and this test says so instead of widening a tolerance until the prose fits,
  // which is exactly the move standing rule 11 exists to forbid.
  const double onFoot = uncapped.chordFor(uncapped.cosMinFor(1.7, 1.0));
  const double at10km = uncapped.chordFor(uncapped.cosMinFor(10000.0, 1.0));
  const double at80km = uncapped.chordFor(uncapped.cosMinFor(80000.0, 1.0));
  std::printf("    [horizon] ground chord on Forge: %.1f m on foot, %.1f m at "
              "10 km, %.1f m at 80 km (header prose says 1.4 km / 110 km / 285 km)\n",
              onFoot, at10km, at80km);
  CHECK_NEAR(onFoot, kForgeR * std::sqrt(2.0 * 1.7 / (kForgeR + 1.7)), 1e-6);
  CHECK_NEAR(at10km, kForgeR * std::sqrt(2.0 * 10000.0 / (kForgeR + 10000.0)), 1e-6);
  CHECK_NEAR(at80km, kForgeR * std::sqrt(2.0 * 80000.0 / (kForgeR + 80000.0)), 1e-6);
  // The ORDER of magnitude the design argument rests on is what the prose was
  // reaching for, and that does survive: on foot is a kilometre, 10 km up is a
  // hundred, 80 km up is a few hundred.
  CHECK(onFoot > 1000.0 && onFoot < 2000.0);
  CHECK(at10km > 100000.0 && at10km < 120000.0);
  CHECK(at80km > 280000.0 && at80km < 300000.0);

  // WHERE the cap starts to bind is not a taste: the horizon chord reaches the
  // cap at exactly h* = R u^2 / (2 - u^2) = 83.345 m on Forge. Bracket it from
  // both sides -- one metre below, the horizon is still the binding constraint;
  // one metre above, the cap is.
  const double hStar = kForgeR * u * u / (2.0 - u * u);
  CHECK_NEAR(hStar, 83.345, 0.01);
  CHECK(bitEqual(capped.cosMinFor(hStar - 1.0, 1.0),
                 kForgeR / (kForgeR + hStar - 1.0)));   // horizon binds
  CHECK(bitEqual(capped.cosMinFor(hStar + 1.0, 1.0), capCos));  // cap binds

  // The design claim, both halves: on foot the explore layer is horizon-limited
  // (walking really does explore its own 1.4 km disc), and in orbit it is
  // cap-limited (a lap is a thread, not a planet). The SURVEY layer is never
  // capped at all -- surveyMaxRadiusM is 0, which is the derived value.
  dsc::WorldDiscovery wd(kForgeR);
  const double eye = wd.tuning().eyeHeightM;
  CHECK(bitEqual(wd.explore().cosMinFor(eye, 1.0), kForgeR / (kForgeR + eye)));
  CHECK(bitEqual(wd.explore().cosMinFor(80000.0 + eye, 1.0), capCos));
  for (double h : {eye, 1000.0, 80000.0, 1.0e6}) {
    CHECK(bitEqual(wd.survey().cosMinFor(h, 1.0), kForgeR / (kForgeR + h)));
  }
}

TEST(more_altitude_never_discovers_less) {
  // Monotone as a SET INCLUSION, which is the property, rather than as a count,
  // which is only a proxy for it: everything visible from lower down is still
  // visible from higher up. Losses are accumulated and asserted once per rung so
  // one failure does not emit sixteen thousand check lines.
  const Vec3 site = unit(Vec3(0.4, 0.6, 0.7));
  const double alts[] = {0.0, 10.0, 100.0, 1000.0, 5000.0, 20000.0, 80000.0,
                         300000.0};
  struct Cfg { double target; double cap; };
  // The two shipped configurations plus a finer uncapped one, so the sweep is
  // not only testing the resolution it was written against.
  const Cfg cfgs[] = {{10000.0, 0.0}, {5000.0, 0.0}, {250.0, 10000.0}};
  size_t lost = 0, rungs = 0;
  for (const Cfg& c : cfgs) {
    std::vector<CellKey> prev;
    double prevCos = 2.0;
    for (double h : alts) {
      dsc::DiscoveryGrid g(kForgeR, c.target, c.cap, 1u << 20);
      const dsc::ObservePass p = g.observe(site, h, 1.0);
      CHECK(!p.budgetHit);                 // else the comparison is meaningless
      CHECK(p.cosMin <= prevCos);          // the threshold never tightens
      prevCos = p.cosMin;
      for (CellKey k : prev)
        if (!g.has(k)) ++lost;
      CHECK(g.size() >= prev.size());
      prev = g.cells();
      ++rungs;
    }
  }
  std::printf("    [monotone] %zu altitude rungs, %zu cells lost by climbing\n",
              rungs, lost);
  CHECK(rungs == 24u);
  CHECK(lost == 0u);
}

// =============================================================================
// §4 — DETERMINISM. Same seed, same ops, same world (standing rule 4).
// =============================================================================
namespace {
struct Obs { Vec3 dir; double alt; };

std::vector<Obs> walkPlan(int n) {
  std::vector<Obs> plan;
  const Vec3 a(0, 0, 1), b(1, 0, 0);
  for (int i = 0; i < n; ++i) {
    const double t = 0.02 + 0.0007 * i;
    const double alt = (i % 5 == 0) ? 12000.0 : ((i % 3 == 0) ? 300.0 : 0.0);
    plan.push_back({greatCircle(a, b, t), alt});
  }
  return plan;
}
}  // namespace

TEST(the_same_sequence_of_observations_produces_a_bit_identical_set) {
  const std::vector<Obs> plan = walkPlan(120);
  dsc::WorldDiscovery A(kForgeR), B(kForgeR);
  for (const Obs& o : plan) {
    dsc::ObservePass s, e;
    A.observe(o.dir, o.alt, s, e);
  }
  for (const Obs& o : plan) {
    dsc::ObservePass s, e;
    B.observe(o.dir, o.alt, s, e);
  }
  CHECK(A.survey().cells() == B.survey().cells());
  CHECK(A.explore().cells() == B.explore().cells());
  CHECK(A.observations() == B.observations());
  CHECK(A.survey().size() > 10u);
  CHECK(A.explore().size() > 1000u);
}

TEST(a_different_order_over_the_same_places_produces_the_identical_set) {
  // THE property that makes the set safe to save: what you have seen does not
  // depend on the order you saw it in. Reversed, and index-shuffled by a
  // deterministic hash, so this is not merely "twice in the same direction".
  const std::vector<Obs> plan = walkPlan(120);
  dsc::WorldDiscovery fwd(kForgeR), rev(kForgeR), shuffled(kForgeR);
  for (const Obs& o : plan) {
    dsc::ObservePass s, e;
    fwd.observe(o.dir, o.alt, s, e);
  }
  for (size_t i = plan.size(); i-- > 0;) {
    dsc::ObservePass s, e;
    rev.observe(plan[i].dir, plan[i].alt, s, e);
  }
  std::vector<size_t> order(plan.size());
  for (size_t i = 0; i < order.size(); ++i) order[i] = i;
  std::sort(order.begin(), order.end(), [](size_t x, size_t y) {
    return of::worldgen::mix64(x + 991) < of::worldgen::mix64(y + 991);
  });
  for (size_t i : order) {
    dsc::ObservePass s, e;
    shuffled.observe(plan[i].dir, plan[i].alt, s, e);
  }
  CHECK(fwd.survey().cells() == rev.survey().cells());
  CHECK(fwd.explore().cells() == rev.explore().cells());
  CHECK(fwd.survey().cells() == shuffled.survey().cells());
  CHECK(fwd.explore().cells() == shuffled.explore().cells());
  // ...and the sets are sorted, which is what makes `has()` a binary search and
  // the byte stream a function of the set rather than of the history.
  CHECK(std::is_sorted(fwd.explore().cells().begin(), fwd.explore().cells().end()));
  CHECK(std::adjacent_find(fwd.explore().cells().begin(),
                           fwd.explore().cells().end()) ==
        fwd.explore().cells().end());
}

TEST(a_truncated_pass_reports_it_and_is_still_deterministic) {
  // DW-28: a resource that silently drops work when full is worse than one that
  // fails. The budget is a CEILING THAT REPORTS, and the truncation itself has
  // to be deterministic or `budgetHit` would produce a different world on a
  // different toolchain -- which is precisely why the flood's queue is a FIFO
  // vector and the visited marker answers only membership.
  const Vec3 site = unit(Vec3(0.2, 0.3, 1.0));
  for (uint32_t budget : {200u, 1000u, 5000u}) {
    dsc::DiscoveryGrid g1(kForgeR, 250.0, 0.0, budget);
    dsc::DiscoveryGrid g2(kForgeR, 250.0, 0.0, budget);
    const dsc::ObservePass p1 = g1.observe(site, 80000.0, 1.0);
    const dsc::ObservePass p2 = g2.observe(site, 80000.0, 1.0);
    CHECK(p1.budgetHit);
    CHECK(p2.budgetHit);
    // It stopped AT the budget, not past it: the pass counts visits itself.
    CHECK(p1.visited == budget);
    CHECK(p1.visited == p2.visited);
    CHECK(p1.accepted == p2.accepted);
    CHECK(p1.added == p2.added);
    CHECK(g1.cells() == g2.cells());
    CHECK(g1.size() == size_t(p1.added));
  }
  // And a NORMAL pass is nowhere near it, which is the claim the default budget
  // rests on: 65,536 is two thirds of a fully surveyed Forge (98,304 cells). The
  // worst legal pass is 80 km over a CUBE CORNER, where the raw gnomonic lattice
  // packs 5.196x more cells into the same solid angle than it does at a face
  // centre -- which is exactly why this is checked there and not at (0,0,1).
  dsc::WorldDiscovery wd(kForgeR);
  dsc::ObservePass s, e;
  wd.observe(unit(Vec3(1, 1, 1)), 80000.0, s, e);
  std::printf("    [budget] worst legal pass (80 km over a cube corner): survey "
              "visited %u, explore visited %u, budget %u\n",
              s.visited, e.visited, wd.tuning().maxCellsPerPass);
  CHECK(!s.budgetHit);
  CHECK(!e.budgetHit);
  CHECK(s.visited * 2u < wd.tuning().maxCellsPerPass);
  CHECK(e.visited * 2u < wd.tuning().maxCellsPerPass);
}

// =============================================================================
// §5 — SERIALIZATION.
// =============================================================================
namespace {
dsc::WorldDiscovery walkedWorld(int steps, double alt, double stepM) {
  dsc::WorldDiscovery wd(kForgeR);
  const Vec3 a(0, 0, 1), b(1, 0, 0);
  for (int i = 0; i < steps; ++i) {
    dsc::ObservePass s, e;
    wd.observe(greatCircle(a, b, (stepM * i) / kForgeR), alt, s, e);
  }
  return wd;
}
}  // namespace

TEST(round_trip_is_exact_for_both_layers) {
  const dsc::WorldDiscovery src = walkedWorld(300, 0.0, 200.0);
  of::persist::SaveWriter w;
  src.serialize(w);
  of::persist::SaveReader r(w.bytes());
  dsc::WorldDiscovery dst(kForgeR);
  CHECK(dst.deserialize(r));
  CHECK(dst.survey().cells() == src.survey().cells());
  CHECK(dst.explore().cells() == src.explore().cells());
  CHECK(dst.explore().size() > 1000u);
  // The reader consumed exactly the stream and no more: a trailing sentinel
  // still reads back, which is what lets discovery sit inside a larger save.
  of::persist::SaveWriter w2;
  src.serialize(w2);
  w2.u32(0xC0FFEEu);
  of::persist::SaveReader r2(w2.bytes());
  dsc::WorldDiscovery dst2(kForgeR);
  CHECK(dst2.deserialize(r2));
  CHECK(r2.u32() == 0xC0FFEEu);
}

// -----------------------------------------------------------------------------
// THE SECOND DEFECT THIS SUITE FOUND, and it was found by a RELOAD rather than
// by a round trip. `reload.mjs --phase=ground` reported restored.discovery = -1
// while the in-page save/wipe/load round trip above passed byte-identically at
// 279 cells, which is exactly why an in-page probe alone would have shipped it.
//
// The cause was ORDER, not format. The browser applies the save while the world
// is still coming up, BEFORE anything has said which body the player is on, so
// the field did not exist and the load refused; the map was built afterwards and
// wrote a fresh empty field over the top; and the 20 second autosave then wrote
// the empty set back to disk. What the player had explored was lost, and
// permanently.
//
// The fix is to make the stream SELF-DESCRIBING rather than to manage the order:
// it carries the body radius, so a WorldDiscovery built for the WRONG body (or
// for no body in particular) re-cuts both lattices from the bytes and restores
// the world anyway. That property is the whole fix, so it is asserted here
// rather than assumed, and this test fails without the preamble.
// -----------------------------------------------------------------------------
TEST(a_stream_carries_its_own_body_into_a_field_built_for_another) {
  // Explored on CINDER (200 km). Its lattices are cut for a 200 km body, so its
  // keys mean nothing against a 600 km one.
  dsc::WorldDiscovery src(kCinderR);
  const Vec3 a(0, 0, 1), b(1, 0, 0);
  std::vector<Vec3> walked;
  for (int i = 0; i < 120; ++i) {
    dsc::ObservePass s, e;
    const Vec3 d = greatCircle(a, b, (300.0 * i) / kCinderR);
    src.observe(d, 0.0, s, e);
    walked.push_back(d);
  }
  CHECK(src.explore().size() > 100u);
  CHECK(src.bodyRadiusM() == kCinderR);

  of::persist::SaveWriter w;
  src.serialize(w);
  w.u32(0xC0FFEEu);   // the caller's next field, to prove the cursor lands right

  // The load happens into a field built for FORGE, which is the browser's case:
  // nothing had told it which body this was, so it was whatever it was built at.
  dsc::WorldDiscovery dst(kForgeR);
  CHECK(dst.bodyRadiusM() == kForgeR);
  CHECK(dst.explore().grid().cellBits() != src.explore().grid().cellBits());
  of::persist::SaveReader r(w.bytes());
  CHECK(dst.deserialize(r));

  // The LATTICE came across, not just the keys. Without this the cells would be
  // restored into a 600 km grid and every one of them would name other ground.
  CHECK(dst.bodyRadiusM() == kCinderR);
  CHECK(dst.survey().grid().cellBits() == src.survey().grid().cellBits());
  CHECK(dst.explore().grid().cellBits() == src.explore().grid().cellBits());
  CHECK(dst.explore().grid().cellSizeAtFaceCentreM()
        == src.explore().grid().cellSizeAtFaceCentreM());
  // The CELLS came across exactly.
  CHECK(dst.survey().cells() == src.survey().cells());
  CHECK(dst.explore().cells() == src.explore().cells());
  // And the restored field ANSWERS the same question the original does, which is
  // the property a player actually feels: every place walked reads as explored.
  for (const Vec3& d : walked) { CHECK(dst.explored(d)); CHECK(dst.surveyed(d)); }
  CHECK(r.u32() == 0xC0FFEEu);
  std::printf("    [radius] %zu explore cells cut at %.0f m survived a load into "
              "a field built at %.0f m; lattice now %u bits, %.1f m cells\n",
              dst.explore().size(), kCinderR, kForgeR,
              dst.explore().grid().cellBits(),
              dst.explore().grid().cellSizeAtFaceCentreM());
}

TEST(the_self_describing_preamble_refuses_without_eating_the_payload) {
  // A wrong magic must stop on the byte after the magic. The layer LENGTHS live
  // after it, so a reader that carried on would be consuming a payload it cannot
  // measure -- and the caller's own next field is what proves it did not.
  {
    of::persist::SaveWriter w;
    w.varint(0x12345678ull);            // not ours
    w.u32(0xFEEDFACEu);
    of::persist::SaveReader r(w.bytes());
    dsc::WorldDiscovery dst(kForgeR);
    CHECK(!dst.deserialize(r));
    CHECK(r.u32() == 0xFEEDFACEu);      // exactly one varint consumed
  }
  {
    of::persist::SaveWriter w;
    w.varint(dsc::WorldDiscovery::kWorldMagic);
    w.varint(dsc::WorldDiscovery::kWorldVersion + 1);
    w.u32(0xFEEDFACEu);
    of::persist::SaveReader r(w.bytes());
    dsc::WorldDiscovery dst(kForgeR);
    CHECK(!dst.deserialize(r));
    CHECK(r.u32() == 0xFEEDFACEu);
  }
  // ALL OR NOTHING SURVIVED THE PREAMBLE, and the rollback now has to put the
  // LATTICE back too: a stream at a different radius rebuilds both grids BEFORE
  // the layers are read, so a refusal after that point must undo the rebuild as
  // well as the keys. Restoring a live field's cells into the wrong grid would
  // be precisely the "world that never existed" the method exists to prevent.
  {
    // A stream whose preamble says CINDER, whose survey half is a genuine Cinder
    // survey stream, and whose explore half is cut at a third cell size. The
    // survey half can only READ because the preamble already re-cut the lattice
    // (Cinder's survey is 5 bits and the live Forge field's is 7), so this
    // reaches the explore refusal with a rebuilt grid AND a loaded survey layer
    // -- which is exactly the state the rollback has to undo completely.
    dsc::WorldDiscovery cin(kCinderR);
    dsc::ObservePass cs, ce;
    cin.observe(Vec3(0, 0, 1), 5000.0, cs, ce);
    dsc::DiscoveryGrid foreign(kCinderR, 700.0, 10000.0, 65536);
    foreign.observe(Vec3(0, 0, 1), 5000.0, 1.0);
    CHECK(!foreign.empty());
    CHECK(foreign.grid().cellBits() != cin.explore().grid().cellBits());

    of::persist::SaveWriter w;
    w.varint(dsc::WorldDiscovery::kWorldMagic);
    w.varint(dsc::WorldDiscovery::kWorldVersion);
    w.f64(kCinderR);
    cin.survey().serialize(w);          // reads, and only after the rebuild
    foreign.serialize(w);               // refused: a third lattice
    w.u32(0xFEEDFACEu);

    dsc::WorldDiscovery live(kForgeR);
    dsc::ObservePass s, e;
    live.observe(Vec3(0, 0, 1), 40000.0, s, e);
    const std::vector<CellKey> keptS = live.survey().cells();
    const std::vector<CellKey> keptE = live.explore().cells();
    const uint32_t bitsS = live.survey().grid().cellBits();
    const uint32_t bitsE = live.explore().grid().cellBits();
    CHECK(!keptS.empty());
    CHECK(!keptE.empty());
    CHECK(bitsS != cin.survey().grid().cellBits());

    of::persist::SaveReader r(w.bytes());
    CHECK(!live.deserialize(r));
    CHECK(live.bodyRadiusM() == kForgeR);              // the body came back
    CHECK(live.survey().grid().cellBits() == bitsS);   // and so did the lattice
    CHECK(live.explore().grid().cellBits() == bitsE);
    CHECK(live.survey().cells() == keptS);             // and both halves of the set
    CHECK(live.explore().cells() == keptE);
    CHECK(r.u32() == 0xFEEDFACEu);
  }
}

TEST(the_byte_stream_is_a_pure_function_of_the_set) {
  // Fill two worlds over the same places in opposite orders. Same set, and
  // therefore the same BYTES -- which is what makes a save file comparable and
  // a checksum meaningful. If the store were a hash set this would fail.
  const std::vector<Obs> plan = walkPlan(80);
  dsc::WorldDiscovery fwd(kForgeR), rev(kForgeR);
  for (const Obs& o : plan) { dsc::ObservePass s, e; fwd.observe(o.dir, o.alt, s, e); }
  for (size_t i = plan.size(); i-- > 0;) {
    dsc::ObservePass s, e;
    rev.observe(plan[i].dir, plan[i].alt, s, e);
  }
  of::persist::SaveWriter a, b;
  fwd.serialize(a);
  rev.serialize(b);
  CHECK(a.bytes() == b.bytes());
  CHECK(a.size() > 100u);
}

TEST(a_stream_from_a_different_lattice_is_refused_not_reinterpreted) {
  // Reading explore-resolution keys into a survey-resolution grid would place
  // the discovered world somewhere it has never been. It must be REFUSED, and
  // the cursor must still land where the caller expects so the rest of the save
  // is readable -- a refusal that desyncs the stream is a worse bug than the one
  // it prevents.
  const dsc::WorldDiscovery src = walkedWorld(60, 0.0, 400.0);
  of::persist::SaveWriter w;
  src.explore().serialize(w);      // written at bits 12
  w.u32(0xFEEDFACEu);              // the sentinel the caller expects next
  of::persist::SaveReader r(w.bytes());
  dsc::DiscoveryGrid wrong(kForgeR, 10000.0, 0.0, 65536);  // bits 7
  CHECK(wrong.grid().cellBits() != src.explore().grid().cellBits());
  CHECK(!wrong.deserialize(r));    // refused
  CHECK(wrong.empty());            // and left empty, not half-filled
  CHECK(r.u32() == 0xFEEDFACEu);   // cursor exactly where it should be

  // A stream that is not ours at all, and a version we do not know.
  {
    of::persist::SaveWriter bad;
    bad.varint(0x12345678ull);
    of::persist::SaveReader br(bad.bytes());
    dsc::DiscoveryGrid g(kForgeR, 10000.0, 0.0, 65536);
    CHECK(!g.deserialize(br));
  }
  {
    of::persist::SaveWriter bad;
    bad.varint(dsc::DiscoveryGrid::kMagic);
    bad.varint(dsc::DiscoveryGrid::kVersion + 1);
    of::persist::SaveReader br(bad.bytes());
    dsc::DiscoveryGrid g(kForgeR, 10000.0, 0.0, 65536);
    CHECK(!g.deserialize(br));
  }
}

TEST(the_empty_cases_work) {
  // A grid that has seen nothing round trips as a grid that has seen nothing.
  dsc::DiscoveryGrid empty(kForgeR, 10000.0, 0.0, 65536);
  of::persist::SaveWriter w;
  empty.serialize(w);
  of::persist::SaveReader r(w.bytes());
  dsc::DiscoveryGrid dst(kForgeR, 10000.0, 0.0, 65536);
  dst.observe(Vec3(0, 0, 1), 80000.0, 1.0);   // dirty it first
  CHECK(!dst.empty());
  CHECK(dst.deserialize(r));
  CHECK(dst.empty());

  // The other empty case: a save slot where discovery was never written at all,
  // which the format reads as a leading zero varint.
  of::persist::SaveWriter z;
  z.varint(0);
  of::persist::SaveReader zr(z.bytes());
  dsc::DiscoveryGrid g(kForgeR, 10000.0, 0.0, 65536);
  g.observe(Vec3(0, 0, 1), 80000.0, 1.0);
  CHECK(g.deserialize(zr));
  CHECK(g.empty());
  CHECK(g.fraction() == 0.0);
}

// -----------------------------------------------------------------------------
// THE DEFECT THIS SUITE FOUND. discovery.h's deserialize claims, in its own
// words, that "a corrupt stream must not leave an UNSORTED vector, because every
// query here is a binary search and would then answer wrongly rather than
// loudly". The guard as first written tested only `d == 0`. But the accumulator
// is a uint64 and the delta is attacker-supplied, so a delta near 2^64 makes
// `prev` go BACKWARDS with d != 0 -- the guard waves it through, `ascending`
// stays true, the sort never runs, and every subsequent has() is a binary search
// over an unsorted vector.
//
// Measured before the fix: the three-cell stream below deserialized to
// [1000, 499, 509] and returned true. The fix is one comparison (`next <= prev`
// instead of `d == 0`), it is free on the legal path because legal deltas are
// strictly positive, and this test fails without it.
// -----------------------------------------------------------------------------
TEST(corrupt_stream_cannot_leave_an_unsorted_vector) {
  dsc::DiscoveryGrid g(kForgeR, 10000.0, 0.0, 65536);
  const uint64_t bits = g.grid().cellBits();

  // (a) the WRAPAROUND case: a delta that overflows the accumulator.
  {
    of::persist::SaveWriter w;
    w.varint(dsc::DiscoveryGrid::kMagic);
    w.varint(dsc::DiscoveryGrid::kVersion);
    w.varint(bits);
    w.varint(3);
    w.varint(1000);
    w.varint(~uint64_t(0) - 500);  // 1000 + this wraps to 499
    w.varint(10);
    of::persist::SaveReader r(w.bytes());
    CHECK(g.deserialize(r));
    CHECK(std::is_sorted(g.cells().begin(), g.cells().end()));
    // and the store still answers membership correctly for what it holds
    for (CellKey k : g.cells()) CHECK(g.has(k));
  }

  // (b) the duplicate case the original guard did cover, kept so the fix cannot
  //     regress it while fixing (a).
  {
    of::persist::SaveWriter w;
    w.varint(dsc::DiscoveryGrid::kMagic);
    w.varint(dsc::DiscoveryGrid::kVersion);
    w.varint(bits);
    w.varint(4);
    w.varint(500);
    w.varint(0);   // duplicate
    w.varint(0);   // duplicate
    w.varint(7);
    of::persist::SaveReader r(w.bytes());
    CHECK(g.deserialize(r));
    CHECK(std::is_sorted(g.cells().begin(), g.cells().end()));
    CHECK(g.size() == 2u);          // dedup ran
    CHECK(g.has(500));
    CHECK(g.has(507));
  }

  // (c) the legal path is untouched: a real stream still deserializes to the
  //     identical vector, so the guard cannot be "fixed" by sorting everything.
  {
    const dsc::WorldDiscovery src = walkedWorld(80, 0.0, 300.0);
    of::persist::SaveWriter w;
    src.explore().serialize(w);
    of::persist::SaveReader r(w.bytes());
    dsc::DiscoveryGrid dst(kForgeR, 250.0, 10000.0, 65536);
    CHECK(dst.deserialize(r));
    CHECK(dst.cells() == src.explore().cells());
  }
}

TEST(bytes_per_cell_is_the_delta_varint_bound) {
  // The claim behind delta encoding: keys ascend and j is the low field, so a
  // run of cells across one row costs ONE byte each, and only a row break costs
  // more (the i field starts at bit 28, so a row jump is a ~2.7e8 delta = 4
  // varint bytes). A disc of radius r therefore costs at most
  //     1 + 4 / (r / cellSize)
  // bytes per cell, using the disc RADIUS in cells as a conservative stand-in
  // for the mean row length (the true mean is longer, so this is a ceiling).
  // Nothing here is tuned: both terms come from the key layout.
  const dsc::WorldDiscovery walk = walkedWorld(400, 0.0, 200.0);
  of::persist::SaveWriter ww;
  walk.explore().serialize(ww);
  const double walkPerCell = double(ww.size()) / double(walk.explore().size());

  // And a realistic ORBITAL field: one lap at 80 km, where the explore layer is
  // cap-limited to 10 km discs, which is the biggest field a session produces.
  dsc::WorldDiscovery lap(kForgeR);
  const Vec3 a(0, 0, 1), b(1, 0, 0);
  const int N = 400;
  for (int i = 0; i < N; ++i) {
    dsc::ObservePass s, e;
    lap.observe(greatCircle(a, b, 2.0 * kPi * double(i) / double(N)), 80000.0, s, e);
  }
  of::persist::SaveWriter lw, ls;
  lap.explore().serialize(lw);
  lap.survey().serialize(ls);
  const double lapPerCell = double(lw.size()) / double(lap.explore().size());
  const double surveyPerCell = double(ls.size()) / double(lap.survey().size());

  const double cellM = lap.explore().grid().cellSizeAtFaceCentreM();
  const double runCells = 10000.0 / cellM;             // cap radius in cells
  const double bound = 1.0 + 4.0 / runCells;

  std::printf("    [bytes] on-foot walk (400 x 200 m): %zu cells, %zu B -> %.4f B/cell\n",
              walk.explore().size(), ww.size(), walkPerCell);
  std::printf("    [bytes] one 80 km lap, explore:     %zu cells, %zu B -> %.4f B/cell "
              "(bound 1 + 4/%.1f = %.4f)\n",
              lap.explore().size(), lw.size(), lapPerCell, runCells, bound);
  std::printf("    [bytes] one 80 km lap, survey:      %zu cells, %zu B -> %.4f B/cell\n",
              lap.survey().size(), ls.size(), surveyPerCell);
  std::printf("    [bytes] whole lap, both layers:     %zu B for %.2f%% of Forge surveyed\n",
              lw.size() + ls.size(), 100.0 * lap.survey().fraction());

  CHECK(lapPerCell < bound);
  CHECK(lapPerCell > 1.0);          // it cannot beat one byte per cell
  CHECK(surveyPerCell < 1.5);       // the coarse layer's rows are shorter
  // The on-foot field is a 1.4 km thread, so its rows are ~10 cells and the
  // bound is correspondingly looser: 1 + 4/(1428/292.97) = 1.82.
  CHECK(walkPerCell < 1.0 + 4.0 / (1428.3 / cellM));
}

// =============================================================================
// §6 — COST. The claim is O(AREA), and it cannot be O(entities) because
// `observe` takes a direction and an altitude and cannot see an entity at all.
// The tests below assert that shape rather than print it.
// =============================================================================

TEST(re_observing_the_same_ground_adds_nothing_and_merges_nothing) {
  dsc::DiscoveryGrid g(kForgeR, 250.0, 10000.0, 65536);
  const Vec3 here = unit(Vec3(0.3, 0.4, 0.9));
  const dsc::ObservePass first = g.observe(here, 10000.0, 1.0);
  CHECK(first.added == first.accepted);
  CHECK(g.size() == size_t(first.added));

  const size_t sizeBefore = g.size();
  const CellKey* dataBefore = g.cells().data();
  for (int i = 0; i < 5; ++i) {
    const dsc::ObservePass again = g.observe(here, 10000.0, 1.0);
    // "adds nothing" and "merges nothing" are two different claims. The first is
    // the counter; the second is that mergeFound returned before building a new
    // vector, which is observable EXACTLY as the store's buffer not moving. A
    // threshold on time would not distinguish them; this does.
    CHECK(again.added == 0u);
    CHECK(again.accepted == first.accepted);
    CHECK(again.visited == first.visited);
    CHECK(g.size() == sizeBefore);
    CHECK(g.cells().data() == dataBefore);
  }
}

TEST(a_pass_sweeps_its_disc_and_not_the_planet) {
  // The whole design rests on one number: an 80 km pass must not hand over the
  // planet. Checked at the four kinds of place on a cube lattice, because cells
  // are 5.196x denser at a corner than at a face centre and a test that only
  // ever stood at a face centre would be measuring the easy case.
  const Vec3 sites[] = {Vec3(0, 0, 1), unit(Vec3(1, 0, 1)), unit(Vec3(1, 1, 1)),
                        unit(Vec3(0.31, -0.72, 0.19))};
  const char* names[] = {"face centre", "edge mid   ", "cube corner", "arbitrary  "};
  for (int i = 0; i < 4; ++i) {
    dsc::DiscoveryGrid g(kForgeR, 10000.0, 0.0, 65536);
    const dsc::ObservePass p = g.observe(sites[i], 80000.0, 1.0);
    std::printf("    [cost] survey 80 km at %s: accepted %5u visited %5u  "
                "%.2f%% of Forge\n",
                names[i], p.accepted, p.visited, 100.0 * g.fraction());
    CHECK(!p.budgetHit);
    CHECK(p.accepted < g.grid().totalCells() / 8);
    CHECK(p.accepted > 1000u);   // and it is not sweeping nothing either
    // The flood is a fringe wider than the disc by its own perimeter and no
    // more: it never wanders. visited - accepted is the rejected boundary ring,
    // which for a disc of A cells is about 2*sqrt(pi*A).
    const double perim = 2.0 * std::sqrt(kPi * double(p.accepted));
    CHECK(double(p.visited - p.accepted) < 2.0 * perim);
  }
}

TEST(accepted_scales_as_radius_squared_and_as_the_gnomonic_jacobian) {
  // At a face centre the cell density is exactly (side^2 / 4) per steradian, so
  // a cap of half-angle t holds exactly
  //       2*pi*(1 - cosMin) * side^2 / 4
  // cells in the continuum. That is an EXACT prediction, not a fit, and because
  // (1 - cosMin) = (c/R)^2 / 2 it IS the r^2 law: it is asserted here directly
  // instead of comparing two counts and hoping.
  //
  // The tolerance is the disc's own PERIMETER, 2*sqrt(pi*N) cells, which is the
  // exact number of cells a boundary can round either way. No part of it was
  // moved to make a run pass.
  dsc::DiscoveryGrid g(kForgeR, 250.0, 0.0, 1u << 21);
  const double side = double(g.grid().cellsPerFaceSide());
  const double chords[] = {7500.0, 15000.0, 30000.0};
  double acc[3];
  for (int i = 0; i < 3; ++i) {
    const double u = chords[i] / kForgeR;
    const double cosMin = 1.0 - 0.5 * u * u;
    const double h = kForgeR * (1.0 / cosMin - 1.0);
    g.clear();
    const dsc::ObservePass p = g.observe(Vec3(0, 0, 1), h, 1.0);
    const double predicted = 2.0 * kPi * (1.0 - p.cosMin) * side * side / 4.0;
    const double perim = 2.0 * std::sqrt(kPi * predicted);
    acc[i] = double(p.accepted);
    std::printf("    [cost] chord %6.0f m at a face centre: accepted %7u, "
                "continuum %9.1f, delta %+6.1f cells (perimeter %.1f)\n",
                chords[i], p.accepted, predicted, acc[i] - predicted, perim);
    CHECK(!p.budgetHit);
    CHECK_NEAR(acc[i], predicted, perim);
  }
  // Doubling the radius quadruples the count. Stated separately because it is
  // the sentence in the header, and bounded by the same perimeter term.
  CHECK_NEAR(acc[1] / acc[0], 4.0, 4.0 * 2.0 / std::sqrt(kPi * acc[0]));
  CHECK_NEAR(acc[2] / acc[1], 4.0, 4.0 * 2.0 / std::sqrt(kPi * acc[1]));

  // And the SAME disc at an edge midpoint and at a cube corner must hold more
  // cells, by exactly the raw gnomonic area Jacobian (1 + u^2 + v^2)^{3/2}:
  // 2^{3/2} = 2.828 at an edge, 3^{3/2} = 5.196 at a corner. That 5.196 IS the
  // 2.12x linear non-uniformity this lattice pays for being transcendental-free,
  // squared into area (2.12 = 3/sqrt(2) is its larger linear factor). If anyone
  // ever swapped the raw projection for cubed_sphere.h's equal-angle tan() warp,
  // both ratios would collapse toward 1 and this test would say so by name.
  //
  // The Jacobian is exact only for a disc smaller than one cell. Across a disc
  // of angular radius t the density itself varies: d(ln rho)/du = 3u/(1+u^2+v^2),
  // which is 1 per unit u at a corner, and du/dt is about 3 there, so the
  // systematic error is ~3t = 3.8% at t = 7500/600000, and the disc's own
  // perimeter adds ~2/sqrt(N) = 2.0%. 8% is what those two give.
  const double u2 = 7500.0 / kForgeR;
  const double cos2 = 1.0 - 0.5 * u2 * u2;
  const double h2 = kForgeR * (1.0 / cos2 - 1.0);
  g.clear();
  const double centre = double(g.observe(Vec3(0, 0, 1), h2, 1.0).accepted);
  g.clear();
  const double edge = double(g.observe(unit(Vec3(1, 0, 1)), h2, 1.0).accepted);
  g.clear();
  const double corner = double(g.observe(unit(Vec3(1, 1, 1)), h2, 1.0).accepted);
  const double wantEdge = std::pow(2.0, 1.5), wantCorner = std::pow(3.0, 1.5);
  std::printf("    [cost] same 7.5 km disc: centre %.0f, edge %.0f (%.4f, "
              "Jacobian %.4f), corner %.0f (%.4f, Jacobian %.4f)\n",
              centre, edge, edge / centre, wantEdge, corner, corner / centre,
              wantCorner);
  CHECK_NEAR(edge / centre, wantEdge, wantEdge * 0.08);
  CHECK_NEAR(corner / centre, wantCorner, wantCorner * 0.08);
}

TEST(a_lap_gives_the_shape_of_the_world_and_only_a_thread_of_its_detail) {
  // DW-36's whole argument, measured. One 80 km lap sweeps a band of angular
  // half-width t about the ground track, and a band of half-width t is exactly
  // sin(t) of a sphere. So:
  //     survey  t = acos(R/(R+h))            = 28.07 deg -> sin = 0.4706
  //     explore t = acos(1 - (c/R)^2/2)      =  0.96 deg -> sin = 0.0167
  // Those are AREA fractions and the grid reports a CELL-COUNT fraction, which
  // differ by wherever the track ran: cell density spans [0.524, 2.72] times its
  // own mean across a raw gnomonic cube (the 1/J extremes normalised by the mean
  // Jacobian 4*pi/24). That interval is the band below, and it is the lattice's
  // own geometry, not a tolerance anybody chose.
  dsc::WorldDiscovery wd(kForgeR);
  const Vec3 a(0, 0, 1), b(1, 0, 0);
  const int N = 400;   // 9.4 km spacing, closer than the 10 km explore cap, so
                       // the thread is continuous rather than a dotted line
  const auto t0 = std::chrono::steady_clock::now();
  for (int i = 0; i < N; ++i) {
    dsc::ObservePass s, e;
    wd.observe(greatCircle(a, b, 2.0 * kPi * double(i) / double(N)), 80000.0, s, e);
  }
  const auto t1 = std::chrono::steady_clock::now();

  const double sinSurvey = std::sin(std::acos(kForgeR / (kForgeR + 80000.0)));
  const double sinExplore =
      std::sin(std::acos(1.0 - 0.5 * std::pow(10000.0 / kForgeR, 2.0)));
  const double fs = wd.survey().fraction(), fe = wd.explore().fraction();
  std::printf("    [lap] %d observations at 80 km in %lld ms: survey %.2f%% "
              "(band %.2f-%.2f%%), explore %.3f%% (band %.3f-%.3f%%), ratio %.1fx\n",
              N,
              (long long)std::chrono::duration_cast<std::chrono::milliseconds>(t1 - t0).count(),
              100.0 * fs, 100.0 * 0.524 * sinSurvey, 100.0 * std::min(1.0, 2.72 * sinSurvey),
              100.0 * fe, 100.0 * 0.524 * sinExplore, 100.0 * 2.72 * sinExplore,
              fs / fe);

  CHECK(fs > 0.524 * sinSurvey);
  CHECK(fs < std::min(1.0, 2.72 * sinSurvey));
  CHECK(fe > 0.524 * sinExplore);
  CHECK(fe < 2.72 * sinExplore);          // THE constraint: a lap is a thread
  // Height bought EXTENT and cost RESOLUTION. Continuum ratio 28.2x; the floor
  // below is that times the worst the density spread can do to it.
  CHECK(fs / fe > 0.524 / 2.72 * (sinSurvey / sinExplore));

  // The negative control, and it is not a restatement: 90 degrees off the ground
  // track is outside a 28.07 degree band, so the lap cannot have surveyed it. If
  // this ever passes trivially the test above has stopped meaning anything.
  const Vec3 trackPole = unit(Vec3(0, 1, 0));
  CHECK(!wd.surveyed(trackPole));
  CHECK(!wd.explored(trackPole));
  // Nor anywhere 45 degrees off it, which is still outside the band.
  CHECK(!wd.surveyed(unit(Vec3(1, 1, 0))));
  CHECK(!wd.surveyed(unit(Vec3(0, 1, 1))));
  // But the track itself, and a point 20 degrees off it, ARE surveyed and the
  // near one is explored, so the band is a band and not an empty set.
  CHECK(wd.surveyed(unit(Vec3(0, 0, 1))));
  CHECK(wd.explored(unit(Vec3(0, 0, 1))));
  CHECK(wd.surveyed(unit(Vec3(0.0, 0.34, 0.94))));   // ~20 deg off track
  CHECK(!wd.explored(unit(Vec3(0.0, 0.34, 0.94))));  // ...but not in detail
}

// -----------------------------------------------------------------------------
// The measured table. Shaped after test_enemies.cpp's perf_cost_* : the printed
// numbers are the deliverable, the CHECKs are floors on sanity.
// -----------------------------------------------------------------------------
namespace {
struct PassCost {
  double usFresh = 0.0;
  double usWarm = 0.0;
  uint32_t accepted = 0;
  uint32_t visited = 0;
  double chordM = 0.0;
};

PassCost timePass(double R, double target, double cap, double altM, int reps) {
  dsc::DiscoveryGrid g(R, target, cap, 65536);
  const double h = altM + 1.7;
  PassCost c;
  // FRESH: the store is emptied before each pass, so mergeFound does the full
  // set_union every time. This is the cost of seeing ground for the first time.
  const auto t0 = std::chrono::steady_clock::now();
  for (int i = 0; i < reps; ++i) {
    g.clear();
    const dsc::ObservePass p = g.observe(Vec3(0, 0, 1), h, 1.0);
    c.accepted = p.accepted;
    c.visited = p.visited;
    c.chordM = p.radiusChordM;
  }
  const auto t1 = std::chrono::steady_clock::now();
  // WARM: the identical pass over ground already held, which is the common case.
  uint32_t added = 0;
  const auto t2 = std::chrono::steady_clock::now();
  for (int i = 0; i < reps; ++i) added += g.observe(Vec3(0, 0, 1), h, 1.0).added;
  const auto t3 = std::chrono::steady_clock::now();
  c.usFresh =
      std::chrono::duration_cast<std::chrono::nanoseconds>(t1 - t0).count() /
      1000.0 / double(reps);
  c.usWarm =
      std::chrono::duration_cast<std::chrono::nanoseconds>(t3 - t2).count() /
      1000.0 / double(reps);
  // The load-bearing assertion of the whole warm run: a repeat pass adds NOTHING.
  if (added != 0) c.usWarm = -1.0;
  return c;
}
}  // namespace

TEST(perf_observe_cost) {
  struct Case { const char* name; double target; double cap; double alt; };
  const Case cases[] = {
      {"survey  on foot ", 10000.0, 0.0, 0.0},
      {"survey  10 km   ", 10000.0, 0.0, 10000.0},
      {"survey  80 km   ", 10000.0, 0.0, 80000.0},
      {"explore on foot ", 250.0, 10000.0, 0.0},
      {"explore 10 km   ", 250.0, 10000.0, 10000.0},
      {"explore 80 km   ", 250.0, 10000.0, 80000.0},
  };
  double worstFresh = 0.0;
  for (const Case& c : cases) {
    const PassCost r = timePass(kForgeR, c.target, c.cap, c.alt, 200);
    std::printf("    [cost] Forge %s: %5u accepted / %5u visited, chord %7.0f m -> "
                "%8.2f us first pass, %8.2f us over known ground (%.2fx)\n",
                c.name, r.accepted, r.visited, r.chordM, r.usFresh, r.usWarm,
                r.usWarm / r.usFresh);
    CHECK(r.usWarm >= 0.0);       // a repeat pass added nothing (see timePass)
    if (r.usFresh > worstFresh) worstFresh = r.usFresh;
  }
  // The gate: a pass is meant to run at about 1 Hz beside a 60 UPS sim, so the
  // ceiling that matters is "well under a sim tick's 16,667 us". Deliberately
  // loose, because the printed table is the deliverable and this is a floor on
  // sanity, exactly as test_enemies.cpp says of its own.
  std::printf("    [cost] worst single pass on Forge: %.2f us (one sim tick is 16667 us)\n",
              worstFresh);
  CHECK(worstFresh < 5000.0);

  // The other half of the cost story, and the one that is easy to lose: a pass
  // that ADDS anything rebuilds the whole sorted store, so the per-pass cost
  // carries an O(cells already known) term on top of the O(area) flood. That is
  // asserted STRUCTURALLY -- the store's buffer moves, which a set_union into a
  // fresh vector must do and an in-place no-op cannot -- rather than by
  // stopwatch, and then measured for the record. A timing threshold here would
  // be a number tuned until it passed; a buffer address is the mechanism itself.
  {
    dsc::DiscoveryGrid g(kForgeR, 250.0, 10000.0, 65536);
    g.observe(Vec3(0, 0, 1), 80000.0, 1.0);
    const CellKey* before = g.cells().data();
    const dsc::ObservePass moved = g.observe(unit(Vec3(0.02, 0.0, 1.0)), 80000.0, 1.0);
    CHECK(moved.added > 0u);
    CHECK(g.cells().data() != before);          // the merge rebuilt the store
    const CellKey* after = g.cells().data();
    CHECK(g.observe(unit(Vec3(0.02, 0.0, 1.0)), 80000.0, 1.0).added == 0u);
    CHECK(g.cells().data() == after);           // and did NOT when it added none
  }
  double first = 0.0, last = 0.0;
  size_t firstN = 0, lastN = 0;
  for (int pre : {0, 1, 2, 3}) {
    dsc::DiscoveryGrid g(kForgeR, 250.0, 10000.0, 65536);
    const Vec3 a(1, 0, 0), bb(0, 1, 0);
    const int fill[] = {0, 40, 400, 2000};
    for (int i = 0; i < fill[pre]; ++i)
      g.observe(greatCircle(a, bb, 0.9 + 0.0009 * i), 80000.0, 1.0);
    const int M = 40;
    const auto t0 = std::chrono::steady_clock::now();
    for (int k = 0; k < M; ++k)
      g.observe(unit(Vec3(0.0005 * k, 0.0003 * k, 1.0)), 80000.0, 1.0);
    const auto t1 = std::chrono::steady_clock::now();
    const double us =
        std::chrono::duration_cast<std::chrono::nanoseconds>(t1 - t0).count() /
        1000.0 / M;
    std::printf("    [cost] explore pass with %8zu cells already known: %8.2f us\n",
                g.size(), us);
    if (pre == 0) { first = us; firstN = g.size(); }
    last = us;
    lastN = g.size();
  }
  const double sizeRatio = double(lastN) / double(firstN > 0 ? firstN : 1);
  std::printf("    [cost] store grew %.0fx, pass cost grew %.2fx (flood is "
              "O(area); merge is O(cells already known))\n",
              sizeRatio, last / first);
  // Sublinear, with no fudge factor: the flood term does not move at all, so a
  // store N times bigger must cost strictly less than N times as much. If this
  // ever fails, the pass has stopped being O(area) in its dominant term.
  CHECK(last / first < sizeRatio);
}

TEST(cinder_is_the_same_rule_at_a_third_the_radius) {
  // The tuning is in METRES, not in fractions of a body, so a smaller moon gets
  // a coarser survey lattice and a finer explore one for the same targets. Both
  // realisations are pinned; a body-relative regression would move them.
  dsc::WorldDiscovery moon(kCinderR);
  CHECK(moon.survey().grid().cellsPerFaceSide() == 32u);
  CHECK(moon.explore().grid().cellsPerFaceSide() == 2048u);
  CHECK_NEAR(moon.survey().grid().cellSizeAtFaceCentreM(), 12500.0, 1e-9);
  CHECK_NEAR(moon.explore().grid().cellSizeAtFaceCentreM(), 195.3125, 1e-9);
  CHECK(moon.survey().grid().totalCells() == 6144ull);

  // The horizon is the body's own, so the same 10 km altitude sees a much
  // smaller absolute area on Cinder... and a much larger FRACTION of it.
  dsc::ObservePass s, e;
  moon.observe(Vec3(0, 0, 1), 10000.0, s, e);
  CHECK(bitEqual(moon.survey().cosMinFor(10000.0 + moon.tuning().eyeHeightM, 1.0),
                 kCinderR / (kCinderR + 10000.0 + moon.tuning().eyeHeightM)));
  CHECK_NEAR(s.radiusChordM,
             kCinderR * std::sqrt(2.0 * 10001.7 / (kCinderR + 10001.7)), 1e-6);
  // The explore cap is a metre count, so it is the SAME 10 km on both bodies.
  CHECK_NEAR(e.radiusChordM, 10000.0, 1e-6);
  std::printf("    [cinder] 10 km pass: survey chord %.0f m (%.2f%% of the moon), "
              "explore chord %.0f m, %u cells\n",
              s.radiusChordM, 100.0 * moon.survey().fraction(), e.radiusChordM,
              e.accepted);
  CHECK(moon.survey().fraction() > 0.005);
  CHECK(moon.survey().fraction() < 0.10);
}

TEST(a_place_you_have_never_been_is_never_discovered) {
  // The rule in one sentence, negated. A long walk on one side of Forge tells
  // you nothing about the other side, at either resolution -- and, sharper,
  // nothing about ground 50 km away on the SAME side, which is the claim that
  // makes the ore in the next valley worth walking to.
  const dsc::WorldDiscovery wd = walkedWorld(500, 0.0, 200.0);
  const Vec3 start(0, 0, 1);
  CHECK(wd.surveyed(start));
  CHECK(wd.explored(start));
  CHECK(!wd.surveyed(Vec3(0, 0, -1)));            // antipode
  CHECK(!wd.explored(Vec3(0, 0, -1)));
  CHECK(!wd.surveyed(unit(Vec3(0, 1, 0))));       // 90 deg off the walk
  CHECK(!wd.explored(unit(Vec3(0, 1, 0))));
  // 50 km along the walk's own great circle, well past the 100 km the walk
  // covered... no: the walk covered 500 x 200 m = 100 km of ground, so check
  // 300 km along it, which is beyond the end plus the 1.4 km horizon.
  const Vec3 far = greatCircle(Vec3(0, 0, 1), Vec3(1, 0, 0), 300000.0 / kForgeR);
  CHECK(!wd.surveyed(far));
  CHECK(!wd.explored(far));
  // And 20 km PERPENDICULAR to the walk, which no amount of walking in a line
  // can reach on foot.
  const Vec3 side = greatCircle(Vec3(0, 0, 1), Vec3(0, 1, 0), 20000.0 / kForgeR);
  CHECK(!wd.surveyed(side));
  CHECK(!wd.explored(side));
  std::printf("    [walk] 100 km on foot: survey %.5f%% of Forge, explore %.5f%%, "
              "%zu + %zu cells\n",
              100.0 * wd.survey().fraction(), 100.0 * wd.explore().fraction(),
              wd.survey().size(), wd.explore().size());
  // A walk cannot survey more of the planet than the strip it walked: 100 km of
  // ground times the 2 x 1.4 km horizon is 2.9e8 m^2 of a 4.52e12 m^2 planet,
  // 0.0064%, and the cell quantisation can only inflate that by the survey cell
  // (9.4 km) being far bigger than the horizon.
  CHECK(wd.explore().fraction() < 0.0005);
}
