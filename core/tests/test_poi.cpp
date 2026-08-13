// Headless tests for POI / SITE PLACEMENT (poi.h, WG-200 to WG-206).
//
// The suite is organised around the four ways this feature goes wrong, and
// every one of them has a precedent in this project's own history:
//
//   * IT IS AN INSTANCE, NOT A TYPE. One hard-coded ruin, and adding the
//     scattered ones later is a rewrite. Tests 1 to 3 exercise BOTH anchor
//     modes and the spec table's plurality, so a `theRuin()` cannot creep in.
//   * NOBODY ASKED WHICH BODY. `seedNests` put 51 nodes on the moon regardless
//     of body: not a wrong table, an ABSENT QUESTION. Tests 4 to 6.
//   * THE GATE CANNOT SEE THE CASE IT EXISTS FOR. WG-146: slope saturates on a
//     crater wall, so it separated "tilted" from "featured" by 1.31x where
//     curvature separated by 33x. Tests 7 to 11 include a REACHABLE refusing
//     case for every gate, each proven red in this same loop by loosening only
//     that gate and watching the identical direction be admitted.
//   * THE SAVE POINTS AT A SITE THAT MOVED. Test 14 is the one that protects a
//     player's progress: the id must survive a terrain change that moves the
//     site, or every "I have been here" bit in every save is silently orphaned.
//
// POSITIVE CONTROL, first test, so a suite that generated nothing at all cannot
// go green while every property test passes vacuously over an empty table.
//
// Header-only; consumes poi.h (the subject) and cubed_sphere.h / biome.h /
// water_field.h READ-ONLY.
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

constexpr uint64_t kSeed = 0x0bf00d01ull;   // the client's default world seed
constexpr double kPi = 3.14159265358979323846;

/** A minimal writer/reader pair matching persistence.h's cursor style, so the
 *  serialize test does not drag persistence.h into a leaf header's suite. */
struct Buf {
  std::vector<uint8_t> b;
  size_t at = 0;
  void varint(uint64_t v) {
    while (v >= 0x80) { b.push_back(static_cast<uint8_t>(v) | 0x80u); v >>= 7; }
    b.push_back(static_cast<uint8_t>(v));
  }
  uint64_t varint() {
    uint64_t v = 0; int s = 0;
    while (at < b.size()) {
      const uint8_t c = b[at++];
      v |= static_cast<uint64_t>(c & 0x7Fu) << s;
      if ((c & 0x80u) == 0) break;
      s += 7;
    }
    return v;
  }
};

const SiteSpec& forgeRuinSpec() {
  int n = 0;
  const SiteSpec* s = siteSpecsFor(0, &n);
  return s[0];
}

}  // namespace

// =============================================================================
// 1. POSITIVE CONTROL. The run reaches the end and produces something.
// =============================================================================
TEST(forge_places_the_ruin_and_prints_what_it_placed) {
  const BodyParams forge = makeForge(kSeed);
  SiteCatalog cat = SiteCatalog::ForBody(forge);
  CHECK(cat.size() == 1);
  CHECK(std::strlen(cat.refusal()) == 0);
  if (cat.size() == 0) return;
  const FSite& s = cat.sites()[0];
  const WalkMeasure w = measureWalk(forge, forge.homeDir, s.dir);
  std::printf(
      "    THE SHIPPED RUIN: lat %.5f lon %.5f  arc %.1f m  ground %.1f m\n"
      "      tilt %.3f deg  residP95 %.3f m  footprint %.1f m  biome %d\n"
      "      walk: %.1f m, max grade %.2f deg at 5 m and %.2f deg at 20 m,\n"
      "            net climb %+.1f m, ascent %.1f m, wet samples %d of %d\n"
      "      id 0x%016llx  yaw %.4f rad  variant %u\n",
      s.latRad * 180.0 / kPi, s.lonRad * 180.0 / kPi, s.arcFromAnchorM,
      s.groundM, s.tiltDeg, s.residP95M, s.footprintM, (int)s.biome,
      w.lengthM, w.maxGrade5Deg, w.maxGrade20Deg, w.climbM, w.ascentM,
      w.wetSamples, w.samples,
      (unsigned long long)s.id, s.yawRad, s.variant);
  const PlacementReport& r = cat.reports()[0];
  std::printf("    placement: asked %u, placed %u, tried %u  (band %.0f..%.0f m,"
              " %u refusals: bandwidth is not the constraint)\n",
              r.asked, r.placed, r.tried, forgeRuinSpec().minArcM,
              forgeRuinSpec().maxArcM, r.tried - r.placed);
  CHECK(r.placed == r.asked);
}

// =============================================================================
// 2. Determinism. WG-6 discipline: a pure function of the seed, nothing else.
// =============================================================================
TEST(same_seed_is_bit_identical_and_a_different_seed_is_not) {
  const BodyParams a = makeForge(kSeed);
  const BodyParams b = makeForge(kSeed);
  const std::vector<FSite> sa = generateSites(a);
  const std::vector<FSite> sb = generateSites(b);
  CHECK(sa.size() == sb.size());
  bool identical = sa.size() == sb.size();
  for (size_t i = 0; identical && i < sa.size(); ++i) {
    // BITWISE, not near: the whole persistence argument is that the table
    // regenerates exactly, so "close enough" is the wrong comparison.
    identical = std::memcmp(&sa[i].dir, &sb[i].dir, sizeof(Vec3)) == 0
             && sa[i].id == sb[i].id
             && std::memcmp(&sa[i].pos, &sb[i].pos, sizeof(Vec3)) == 0;
  }
  CHECK(identical);

  // A different seed puts the ruin somewhere else. Seed 0x63 rather than an
  // arbitrary xor, and the reason is a finding in its own right, recorded in
  // the next test: `homeDir` is a LITERAL calibrated for seed 0x0bf00d01, so
  // most other seeds put the spawn in the sea and the band has nowhere to put
  // anything. This test needs a seed whose spawn is on land.
  const BodyParams c = makeForge(0x63ull);
  const std::vector<FSite> sc = generateSites(c);
  CHECK(sc.size() == 1);
  bool moved = false;
  for (size_t i = 0; i < sc.size() && i < sa.size(); ++i)
    if (std::memcmp(&sa[i].dir, &sc[i].dir, sizeof(Vec3)) != 0) moved = true;
  CHECK(moved);   // a seed that changes nothing would be the real defect
}

// =============================================================================
// 2b. THE OCEAN GATE'S REACHABLE REFUSING CASE, and it is a finding.
//
// `BodyParams::homeDir` is a literal chosen for the client's default seed. On
// seed 0x7 that same point is OCEAN, and all 4096 candidates in the band are
// refused for it. That is the correct behaviour, it is the only way to reach
// the ocean gate at all today, and it is worth stating out loud that ?seed=
// does NOT move the spawn: it moves the world under a fixed spawn point.
// =============================================================================
TEST(a_seed_whose_spawn_is_at_sea_places_nothing_and_the_reason_is_ocean) {
  const BodyParams sea = makeForge(0x7ull);
  std::vector<PlacementReport> reps;
  const std::vector<FSite> s = generateSites(sea, &reps);
  CHECK(s.empty());
  CHECK(reps.size() == 1);
  if (reps.empty()) return;
  std::printf("    seed 0x7: %u candidates tried, %u refused as ocean\n",
              reps[0].tried, reps[0].refusals[(int)Refusal::Ocean]);
  CHECK(reps[0].tried == forgeRuinSpec().maxTries);
  // EVERY one of them, which is what "the spawn is in the sea" looks like from
  // in here, and it is distinguishable from "the gate never ran".
  CHECK(reps[0].refusals[(int)Refusal::Ocean] == reps[0].tried);
}

// =============================================================================
// 3. IT IS A TYPE. The Global anchor mode works on the same code path, proven
//    with a spec that no shipped body uses yet, so the "scattered later" case
//    is not an untested claim in a comment.
// =============================================================================
TEST(the_global_anchor_mode_places_many_sites_through_the_same_admit) {
  const BodyParams forge = makeForge(kSeed);
  SiteSpec spec = forgeRuinSpec();
  spec.anchor = Anchor::Global;
  spec.count = 12;
  spec.separationM = 50000.0;
  spec.maxTries = 4096;
  int placed = 0;
  std::vector<Vec3> dirs;
  for (uint32_t i = 0; i < spec.maxTries && placed < 12; ++i) {
    const Vec3 d = candidateDir(forge, spec, forge.homeDir, i);
    Verdict v = admit(forge, forge.homeDir, d, spec);
    if (!v.ok) continue;
    bool close = false;
    for (const Vec3& p : dirs)
      if (geom::arcBetween(p, d, forge.radiusM) < spec.separationM)
        close = true;
    if (close) continue;
    dirs.push_back(d);
    ++placed;
  }
  std::printf("    Global mode placed %d of 12 sites over the whole body\n",
              placed);
  CHECK(placed == 12);
  // And they are genuinely spread, not twelve samples of one valley.
  double minSep = 1e30;
  for (size_t i = 0; i < dirs.size(); ++i)
    for (size_t j = i + 1; j < dirs.size(); ++j) {
      const double s = geom::arcBetween(dirs[i], dirs[j], forge.radiusM);
      if (s < minSep) minSep = s;
    }
  std::printf("    closest pair %.0f m against a %.0f m separation\n",
              minSep, spec.separationM);
  CHECK(minSep >= spec.separationM);
}

// =============================================================================
// 4 to 6. ASK WHICH BODY IT IS.
// =============================================================================
TEST(cinder_has_no_ruins_and_says_why) {
  const BodyParams cinder = makeCinder(kSeed);
  SiteCatalog cat = SiteCatalog::ForBody(cinder);
  CHECK(cat.size() == 0);
  // The refusal is the deliverable. An empty table with no reason is
  // indistinguishable from a table nobody wrote.
  CHECK(std::strlen(cat.refusal()) > 0);
  std::printf("    Cinder: %s\n", cat.refusal());
}

TEST(an_unknown_body_places_nothing_and_does_not_fall_back_to_forge) {
  BodyParams odd = makeForge(kSeed);
  odd.bodyId = 47;
  SiteCatalog cat = SiteCatalog::ForBody(odd);
  CHECK(cat.size() == 0);
  CHECK(std::strlen(cat.refusal()) > 0);
  std::printf("    body 47: %s\n", cat.refusal());
}

TEST(the_body_test_is_the_id_not_the_terrain) {
  // Cinder with Forge's terrain constants still places nothing: the refusal is
  // keyed on the body, not on whether the ground happens to be admissible.
  // This is the exact shape `seedNests` was missing.
  BodyParams fake = makeForge(kSeed);
  fake.bodyId = 1;               // claim to be Cinder, keep Forge's ground
  CHECK(generateSites(fake).empty());
  fake.bodyId = 0;               // and the same ground under Forge's id places
  CHECK(generateSites(fake).size() == 1);
}

// =============================================================================
// 7 to 11. THE GATES, each with a REACHABLE refusing case, and each proven to
//          be the gate rather than the terrain by loosening only that gate.
// =============================================================================
TEST(the_pad_blend_is_refused_and_the_gate_is_what_refuses_it) {
  const BodyParams forge = makeForge(kSeed);
  SiteSpec spec = forgeRuinSpec();
  const geom::Tangent f = geom::tangentAt(forge.homeDir);
  // Half way into the blend: inside the pad, outside the dead-flat disc.
  const Vec3 d = geom::offsetDir(f, forge.radiusM,
                                   forge.homeBlendRadiusM * 0.5, 0.0);
  SiteSpec wide = spec;
  wide.minArcM = 0.0;            // let it past the band gate so the PAD gate
  wide.maxArcM = 100000.0;       // is the one under test
  const Verdict v = admit(forge, forge.homeDir, d, wide);
  std::printf("    at %.0f m from spawn: %s (padDelta %+.4f m)\n",
              forge.homeBlendRadiusM * 0.5, refusalName(v.refusal),
              v.foot.padDeltaM);
  CHECK(!v.ok);
  CHECK(v.refusal == Refusal::InsidePadBlend);
  CHECK(v.foot.padDeltaM != 0.0);
  // THE CONTROL: the identical direction on a body with NO pad is not refused
  // for this reason, which proves the pad gate is what refused it rather than
  // the ground being bad anyway.
  BodyParams noPad = forge;
  noPad.homeFlatRadiusM = 0.0;
  noPad.homeBlendRadiusM = 0.0;
  const Verdict v2 = admit(noPad, noPad.homeDir, d, wide);
  std::printf("    with the pad removed, the same direction: %s\n",
              refusalName(v2.refusal));
  CHECK(v2.refusal != Refusal::InsidePadBlend);

  // AND A MEASUREMENT THAT CORRECTS A COMMENT. `makeForge` says of the blend
  // that it "adds ~1 percentage point of grade over the natural slope of the
  // same ground, so it does not read as a cut disc". Over an 18 m disc that is
  // not what it does, and the numbers are printed rather than asserted because
  // the pad is not this header's to change.
  std::printf("    the blend's own grade, over an %.0f m disc:\n",
              spec.footprintM);
  const double offsets[5] = {150.0, 300.0, 450.0, 600.0, 900.0};
  for (int i = 0; i < 5; ++i) {
    const Vec3 p = geom::offsetDir(f, forge.radiusM, offsets[i], 0.0);
    const FootMeasure mp = measureFootprint(forge, p, spec.footprintM);
    const FootMeasure mn = measureFootprint(noPad, p, spec.footprintM);
    std::printf("      %5.0f m: padded tilt %6.3f deg (%5.1f%% grade),"
                " natural %6.3f deg (%5.1f%%), padDelta %+8.3f m\n",
                offsets[i], mp.tiltDeg, std::tan(mp.tiltDeg * kPi / 180.0) * 100.0,
                mn.tiltDeg, std::tan(mn.tiltDeg * kPi / 180.0) * 100.0,
                mp.padDeltaM);
  }
  // What IS assertable and is the reason the band starts at 700 m: outside the
  // blend the two are bit-identical, so the site stands on natural ground.
  const Vec3 outside = geom::offsetDir(f, forge.radiusM,
                                       forge.homeBlendRadiusM * 1.5, 0.0);
  CHECK(measureFootprint(forge, outside, spec.footprintM).padDeltaM == 0.0);
}

// -----------------------------------------------------------------------------
// THE WATER GATE, AND WHY IT IS ORDERED BEFORE THE PAD GATE.
//
// Forge's only water is the home pond, 55.0 m from `homeDir` and therefore
// INSIDE the 600 m pad blend. The first draft of `admit` tested the pad first,
// which made the water gate UNREACHABLE BY ANY INPUT: every wet candidate on
// the only body that has water was refused as InsidePadBlend before the water
// gate ran. It was found by a shoreline test that could not be made to go red.
//
// That is WG-116's slope gate again, reached from a different direction: a gate
// no input can reach is not a gate, and it reads exactly like a working one
// from the pass rate. The fix is the ordering, and the ordering happens to be
// the cheaper one too (13 depth queries against 37 height samples).
//
// What remains true and is stated rather than hidden: the SHIPPED spec's band
// starts at 700 m, so the shipped generator still cannot reach the pond. This
// gate guards future ponds, lakes and a second body's water, and its reachable
// refusing case below is driven through `admit` directly.
// -----------------------------------------------------------------------------
TEST(a_candidate_in_the_pond_is_refused_by_water_and_not_by_the_pad) {
  const BodyParams forge = makeForge(kSeed);
  const double pondArc = geom::arcBetween(forge.homeDir, forge.pondDir,
                                          forge.radiusM);
  std::printf("    the only water on Forge is the home pond, %.1f m from the"
              " spawn, inside a %.0f m pad blend\n",
              pondArc, forge.homeBlendRadiusM);
  CHECK(pondArc < forge.homeBlendRadiusM);
  SiteSpec wide = forgeRuinSpec();
  wide.minArcM = 0.0;
  wide.maxArcM = 100000.0;
  const Verdict v = admit(forge, forge.homeDir, forge.pondDir, wide);
  CHECK(!v.ok);
  CHECK(v.refusal == Refusal::Wet);
  std::printf("    a candidate in the pond itself is refused as: %s"
              " (deepest %.3f m)\n", refusalName(v.refusal), v.wetM);
  // And the SHIPPED band still cannot reach it, which is why the generator
  // never exercises this gate today.
  CHECK(pondArc < forgeRuinSpec().minArcM);
}

TEST(the_pond_is_refused_over_the_footprint_not_only_at_the_centre) {
  // The pond as it ships, pad and all. An earlier draft removed the pad to
  // reach the water gate, and that was wrong twice: it papered over the
  // ordering bug above, and removing the pad drops the pond bowl onto a 13
  // degree natural hillside, so the thing it then measured was not the shipped
  // pond at all.
  const BodyParams forge = makeForge(kSeed);
  CHECK(forge.pondRadiusM > 0.0);
  SiteSpec spec = forgeRuinSpec();
  spec.minArcM = 0.0;
  spec.maxArcM = 100000.0;
  // THE SHORELINE, not the middle: a point on dry ground whose footprint ring
  // reaches into the water. A centre-only test admits this, which is the whole
  // reason the gate samples the ring.
  const geom::Tangent f = geom::tangentAt(forge.pondDir);
  bool foundShore = false;
  int dryCentres = 0;
  for (int k = 0; k < 48 && !foundShore; ++k) {
    const double a = (k / 48.0) * 2.0 * kPi;
    const double off = water::shorelineM(forge) + 2.0;
    const Vec3 d = geom::offsetDir(f, forge.radiusM, std::cos(a) * off,
                                   std::sin(a) * off);
    if (water::depthAt(forge, d) > 0.0) continue;    // must be DRY at centre
    ++dryCentres;
    const Verdict v = admit(forge, forge.homeDir, d, spec);
    if (v.refusal != Refusal::Wet) continue;
    foundShore = true;
    std::printf("    shoreline candidate %.1f m from the pond centre:"
                " DRY underfoot (depth %.3f m) and refused as %s"
                " (deepest on the %.0f m ring %.3f m)\n",
                off, water::depthAt(forge, d), refusalName(v.refusal),
                spec.footprintM, v.wetM);
    CHECK(!v.ok);
    CHECK(water::depthAt(forge, d) <= 0.0);   // the centre really is dry
    CHECK(v.wetM > 0.0);                      // and the ring really is not
    // THE CONTROL: a centre-only water test would have ADMITTED this, so far
    // as water is concerned. Asserted rather than argued.
    CHECK(water::depthAt(forge, d) <= 0.0 && v.wetM > 0.0);
  }
  std::printf("    %d of 48 bearings had a dry centre; shoreline case found: %s\n",
              dryCentres, foundShore ? "yes" : "NO");
  CHECK(foundShore);
}

TEST(a_steep_direction_is_refused_by_tilt_and_admitted_when_tilt_is_loosened) {
  const BodyParams forge = makeForge(kSeed);
  SiteSpec spec = forgeRuinSpec();
  // Walk the candidate sequence for the FIRST tilt refusal, so the case is one
  // the generator genuinely reaches rather than a direction picked to fail.
  bool found = false;
  for (uint32_t i = 0; i < 512 && !found; ++i) {
    const Vec3 d = candidateDir(forge, spec, forge.homeDir, i);
    const Verdict v = admit(forge, forge.homeDir, d, spec);
    if (v.refusal != Refusal::Tilt) continue;
    found = true;
    SiteSpec loose = spec;
    loose.maxTiltDeg = 89.0;
    const Verdict v2 = admit(forge, forge.homeDir, d, loose);
    std::printf("    candidate %u: tilt %.3f deg vs gate %.2f -> %s;"
                " with the gate at 89 deg -> %s\n",
                i, v.foot.tiltDeg, spec.maxTiltDeg, refusalName(v.refusal),
                refusalName(v2.refusal));
    CHECK(!v.ok);
    CHECK(v.foot.tiltDeg > spec.maxTiltDeg);
    // THE CONTROL: loosening ONLY the tilt gate admits the identical
    // direction, which proves the tilt gate is what refused it. Without this
    // the test passes on any direction that fails for any reason.
    CHECK(v2.ok);
  }
  CHECK(found);
}

TEST(broken_ground_is_refused_by_the_residual_that_tilt_cannot_see) {
  const BodyParams forge = makeForge(kSeed);
  SiteSpec spec = forgeRuinSpec();
  // A WIDER BAND THAN THE SHIPPED ONE, on purpose. The shipped 700 to 1400 m
  // band around the WG-214 spawn is gentle Hills, and 4096 candidates in it
  // yield no case that passes tilt and fails residual: the reachable refusing
  // case for this gate is not reachable THERE any more. Widening the band is
  // the honest response, because the gate is band-independent and the
  // alternative (loosening the assertion until the shipped band satisfies it)
  // would leave the gate untested. It was reachable in the shipped band at the
  // old Mountains spawn, which is a fact about the terrain, not about the gate.
  spec.minArcM = 700.0;
  spec.maxArcM = 60000.0;
  // The case the whole plane fit exists for: a direction whose FITTED PLANE is
  // inside the tilt gate and whose ground is broken inside the footprint. A
  // slope-only gate admits this, every time.
  bool found = false;
  for (uint32_t i = 0; i < 16384 && !found; ++i) {
    const Vec3 d = candidateDir(forge, spec, forge.homeDir, i);
    const Verdict v = admit(forge, forge.homeDir, d, spec);
    if (v.refusal != Refusal::Residual) continue;
    found = true;
    SiteSpec loose = spec;
    loose.maxResidM = 1000.0;
    const Verdict v2 = admit(forge, forge.homeDir, d, loose);
    std::printf("    candidate %u: tilt %.3f deg (INSIDE the %.2f deg gate),"
                " residP95 %.3f m vs %.2f -> %s; residual loosened -> %s\n",
                i, v.foot.tiltDeg, spec.maxTiltDeg, v.foot.residP95M,
                spec.maxResidM, refusalName(v.refusal), refusalName(v2.refusal));
    CHECK(!v.ok);
    // The load-bearing pair: tilt PASSES and residual REFUSES. If this ever
    // stops being reachable, the residual gate has become decoration.
    CHECK(v.foot.tiltDeg <= spec.maxTiltDeg);
    CHECK(v.foot.residP95M > spec.maxResidM);
    CHECK(v2.ok);
  }
  CHECK(found);
}

TEST(the_band_refuses_both_ends_and_the_placed_site_is_inside_it) {
  const BodyParams forge = makeForge(kSeed);
  const SiteSpec& spec = forgeRuinSpec();
  const geom::Tangent f = geom::tangentAt(forge.homeDir);
  const Vec3 tooNear = geom::offsetDir(f, forge.radiusM,
                                         spec.minArcM * 0.5, 0.0);
  const Vec3 tooFar = geom::offsetDir(f, forge.radiusM,
                                        spec.maxArcM * 2.0, 0.0);
  CHECK(admit(forge, forge.homeDir, tooNear, spec).refusal
        == Refusal::OutOfBand);
  CHECK(admit(forge, forge.homeDir, tooFar, spec).refusal
        == Refusal::OutOfBand);
  SiteCatalog cat = SiteCatalog::ForBody(forge);
  CHECK(cat.size() == 1);
  if (cat.size() == 0) return;
  CHECK(cat.sites()[0].arcFromAnchorM >= spec.minArcM);
  CHECK(cat.sites()[0].arcFromAnchorM <= spec.maxArcM);
  // And the inner edge really does clear the pad, measured rather than assumed
  // from the arithmetic, so growing the pad fails here rather than silently.
  CHECK(spec.minArcM > forge.homeBlendRadiusM + spec.footprintM);
}

// =============================================================================
// 12. Every placed site passes its own gates when re-measured independently.
//     A generator that admits a site it would refuse on a second look is the
//     failure this catches.
// =============================================================================
TEST(every_placed_site_survives_an_independent_re_measurement) {
  const BodyParams forge = makeForge(kSeed);
  const SiteSpec& spec = forgeRuinSpec();
  SiteCatalog cat = SiteCatalog::ForBody(forge);
  for (const FSite& s : cat.sites()) {
    const FootMeasure m = measureFootprint(forge, s.dir, s.footprintM);
    CHECK(m.tiltDeg <= spec.maxTiltDeg);
    CHECK(m.residP95M <= spec.maxResidM);
    CHECK(m.padDeltaM == 0.0);
    CHECK(water::depthAt(forge, s.dir) <= 0.0);
    // The published numbers are the numbers, bitwise, not a re-derivation that
    // happens to agree.
    CHECK(m.tiltDeg == s.tiltDeg);
    CHECK(m.residP95M == s.residP95M);
    // Seated on the BASE surface, so terraforming cannot move it.
    CHECK_NEAR(s.pos.length(), forge.radiusM + sampleDesignedHeight(forge, s.dir),
               1e-6);
  }
}

// =============================================================================
// 13. THE WALK from spawn, asserted on the shipped instance.
//     Not a generator gate: the straight great circle is the WORST case, so
//     gating on it would refuse good sites for a reason that is not true.
// =============================================================================
TEST(the_shipped_ruin_is_reachable_on_foot_from_the_spawn) {
  const BodyParams forge = makeForge(kSeed);
  SiteCatalog cat = SiteCatalog::ForBody(forge);
  CHECK(cat.size() == 1);
  if (cat.size() == 0) return;
  const WalkMeasure w = measureWalk(forge, forge.homeDir, cat.sites()[0].dir);
  // The client's walker refuses ground steeper than its own slope gate; the
  // tree field's is 43.95 degrees (TREE_MIN_SLOPE_COS 0.72) and is the
  // steepest published figure in the client. 35 degrees at a 20 m arm leaves
  // real margin, and 20 m is the arm at which a landform rather than a detail
  // octave is being measured.
  std::printf("    walk %.0f m: max grade %.2f deg at 5 m, %.2f deg at 20 m,"
              " climb %+.1f m, %d wet of %d samples,"
              " %.1f min at 4.6 m/s\n",
              w.lengthM, w.maxGrade5Deg, w.maxGrade20Deg, w.climbM,
              w.wetSamples, w.samples, w.lengthM / 4.6 / 60.0);
  CHECK(w.maxGrade20Deg <= 35.0);
  CHECK(w.wetSamples == 0);
}

// =============================================================================
// 14. THE ID SURVIVES A TERRAIN CHANGE THAT MOVES THE SITE.
//     This is the one that protects a player's save. An id derived from the
//     chosen direction would orphan every visited bit on the planet, silently,
//     the next time anybody touched the height field.
// =============================================================================
TEST(the_site_id_is_stable_when_the_site_moves) {
  const BodyParams forge = makeForge(kSeed);
  const std::vector<FSite> before = generateSites(forge);
  CHECK(before.size() == 1);
  if (before.empty()) return;
  // MOVE THE WINNER without touching the seed, the body or the ordinal, by
  // tightening the tilt gate so an earlier candidate stops qualifying.
  //
  // Two mechanisms were tried first and BOTH failed to move it, which is worth
  // recording because each looks like it should work. Growing the pad blend to
  // 1100 m moves nothing, because the winner sits at 753.8 m and was never
  // inside it. Scaling `maxReliefM` moves nothing either, and that one is
  // instructive: `sampleHeightField` ends in `h *= body.maxReliefM`, so relief
  // is a UNIFORM scale on every height, which scales every candidate's tilt by
  // the same factor and therefore preserves the ORDER in which they pass a
  // tilt gate. A change that moves every number and no verdict is not a
  // terrain change as far as this code is concerned.
  SiteSpec tight = forgeRuinSpec();
  tight.maxTiltDeg = 1.5;
  const std::vector<FSite> after = generateFrom(forge, &tight, 1);
  CHECK(after.size() == 1);
  if (after.empty()) return;
  const double movedM = geom::arcBetween(before[0].dir, after[0].dir,
                                           forge.radiusM);
  std::printf("    the ruin moved %.1f m under a terrain change;"
              " id 0x%016llx -> 0x%016llx\n", movedM,
              (unsigned long long)before[0].id,
              (unsigned long long)after[0].id);
  // The site really did move: an assertion about stability under a change that
  // did not happen proves nothing.
  CHECK(movedM > 1.0);
  CHECK(before[0].id == after[0].id);
}

// =============================================================================
// 14b. THE STATE MACHINE: unknown -> known -> visited, and it is MONOTONE.
//      `markVisited` must not let a site end up visited-but-not-known, because
//      that is a state a scan-then-investigate questline can never produce and
//      a save that held it would be describing an impossible player.
// =============================================================================
TEST(known_and_visited_are_a_monotone_state_machine) {
  const BodyParams forge = makeForge(kSeed);
  SiteCatalog cat = SiteCatalog::ForBody(forge);
  CHECK(cat.size() == 1);
  if (cat.size() == 0) return;
  const SiteId id = cat.sites()[0].id;
  CHECK(!cat.known(id));
  CHECK(!cat.visited(id));
  // The scan reaches it first: known without visited is a legal state.
  CHECK(cat.markKnown(id));     // TRUE the first time
  CHECK(!cat.markKnown(id));    // FALSE afterwards
  CHECK(cat.known(id));
  CHECK(!cat.visited(id));
  CHECK(cat.knownCount() == 1);
  // The walk-up. Visiting must not un-know it, obviously, and must not
  // re-fire "first known" now that it already was.
  CHECK(cat.markVisited(id));
  CHECK(cat.known(id));
  CHECK(cat.visited(id));

  // AND THE ORDER THAT MATTERS: a player who stumbles onto an unscanned ruin
  // visits it WITHOUT ever calling markKnown. `markVisited` alone must still
  // leave `known` true, or the state machine runs backwards.
  SiteCatalog stumbled = SiteCatalog::ForBody(forge);
  CHECK(!stumbled.known(id));
  CHECK(stumbled.markVisited(id));
  CHECK(stumbled.known(id));
  CHECK(stumbled.visited(id));
}

// =============================================================================
// 15. Seed + diff. Regenerate from the seed, re-apply BOTH bits, get the same
//     state. WG-3 / C-6, and the whole reason the world is cheap to save.
// =============================================================================
TEST(known_and_visited_are_both_saved_and_round_trip) {
  const BodyParams forge = makeForge(kSeed);
  SiteCatalog live = SiteCatalog::ForBody(forge);
  CHECK(live.size() == 1);
  if (live.size() == 0) return;
  const SiteId id = live.sites()[0].id;
  CHECK(!live.visited(id));
  CHECK(live.markVisited(id));    // TRUE the first time
  CHECK(!live.markVisited(id));   // and FALSE afterwards
  CHECK(live.visited(id));
  CHECK(live.known(id));          // markVisited implies known
  CHECK(live.visitedCount() == 1);
  CHECK(live.knownCount() == 1);
  Buf b;
  live.serialize(b);
  std::printf("    one known+visited site serialises to %zu bytes\n",
              b.b.size());
  SiteCatalog reloaded = SiteCatalog::ForBody(forge);
  CHECK(!reloaded.known(id));     // regenerated clean, as it must be
  CHECK(!reloaded.visited(id));
  CHECK(reloaded.deserialize(b));
  CHECK(reloaded.known(id));
  CHECK(reloaded.visited(id));
  CHECK(reloaded.knownCount() == 1);
  CHECK(reloaded.visitedCount() == 1);
  // And the regenerated table is the same table.
  CHECK(reloaded.sites()[0].id == live.sites()[0].id);
  CHECK(std::memcmp(&reloaded.sites()[0].dir, &live.sites()[0].dir,
                    sizeof(Vec3)) == 0);

  // KNOWN WITHOUT VISITED round-trips too, and independently: the scan bit
  // must survive a save on its own rather than only riding along with a visit.
  SiteCatalog knownOnly = SiteCatalog::ForBody(forge);
  CHECK(knownOnly.markKnown(id));
  Buf kb;
  knownOnly.serialize(kb);
  SiteCatalog knownReloaded = SiteCatalog::ForBody(forge);
  CHECK(knownReloaded.deserialize(kb));
  CHECK(knownReloaded.known(id));
  CHECK(!knownReloaded.visited(id));

  // A save from a world with nothing known or visited is TWO bytes, not zero:
  // each of the two lists always writes its count, so an empty save and a
  // truncated one are distinguishable.
  SiteCatalog fresh = SiteCatalog::ForBody(forge);
  Buf e;
  fresh.serialize(e);
  CHECK(e.b.size() == 2);
}

TEST(an_unknown_id_in_a_save_is_dropped_rather_than_refused) {
  const BodyParams forge = makeForge(kSeed);
  Buf b;
  b.varint(2);                       // the KNOWN list
  b.varint(0x1234567890ABCDEFull);   // a site that does not exist
  b.varint(1);                       // and another
  b.varint(0);                       // the VISITED list: empty
  SiteCatalog cat = SiteCatalog::ForBody(forge);
  CHECK(cat.deserialize(b));
  CHECK(cat.knownCount() == 0);
  CHECK(cat.visitedCount() == 0);
}

// =============================================================================
// 16. THE KEEP-OUT every other placement system has to ask.
// =============================================================================
TEST(the_footprint_keep_out_answers_in_directions_not_in_positions) {
  const BodyParams forge = makeForge(kSeed);
  SiteCatalog cat = SiteCatalog::ForBody(forge);
  CHECK(cat.size() == 1);
  if (cat.size() == 0) return;
  const FSite& s = cat.sites()[0];
  CHECK(cat.insideAnySite(forge, s.dir));
  // A SURFACE POSITION, not a unit direction. This is the exact call that beat
  // the tree field's 6 m clearing keep-out silently: `pos` is at
  // radius + height, and comparing it against a unit direction scaled by the
  // radius alone differs by the terrain height, 27 m at the Forest site. The
  // keep-out must normalise, and this asserts that it does.
  CHECK(cat.insideAnySite(forge, s.pos));
  const geom::Tangent f = geom::tangentAt(s.dir);
  const Vec3 justInside = geom::offsetDir(f, forge.radiusM,
                                            s.footprintM * 0.9, 0.0);
  const Vec3 wellOutside = geom::offsetDir(f, forge.radiusM,
                                             s.footprintM * 4.0, 0.0);
  CHECK(cat.insideAnySite(forge, justInside));
  CHECK(!cat.insideAnySite(forge, wellOutside));
  // With a margin the outer point is refused too, which is what a tree field
  // will pass so a canopy does not overhang the roof.
  CHECK(cat.insideAnySite(forge, wellOutside, s.footprintM * 4.0));
}

// =============================================================================
// 17. The cone query, and it is a CONE rather than a projection (WG-29).
// =============================================================================
TEST(the_cone_query_finds_the_site_and_a_narrow_cone_elsewhere_does_not) {
  const BodyParams forge = makeForge(kSeed);
  SiteCatalog cat = SiteCatalog::ForBody(forge);
  CHECK(cat.size() == 1);
  if (cat.size() == 0) return;
  const FSite& s = cat.sites()[0];
  // A 5 km scan radius about the spawn on a 600 km body.
  const double cos5km = std::cos(5000.0 / forge.radiusM);
  CHECK(cat.near(forge.homeDir, cos5km).size() == 1);
  // A 200 m scan finds nothing, because the site is further than that. A query
  // that always answers is not a query.
  const double cos200m = std::cos(200.0 / forge.radiusM);
  CHECK(cat.near(forge.homeDir, cos200m).empty());
  // The antipode finds nothing at all.
  const Vec3 anti(-forge.homeDir.x, -forge.homeDir.y, -forge.homeDir.z);
  CHECK(cat.near(anti, cos5km).empty());
  CHECK(cat.nearest(forge.homeDir, SiteKind::Ruin) == 0);
  CHECK(cat.nearest(forge.homeDir, SiteKind::None) == 0);
  CHECK(cat.byId(s.id) != nullptr);
  CHECK(cat.byId(s.id ^ 1ull) == nullptr);
}

// =============================================================================
// 18. THE BRIDGE'S ID SPLIT, ROUND-TRIPPED. `of_poi_api.inc` (web/wasm) cannot
//     hand a 64-bit SiteId across the ABI as one f64 word (WG-167: "a uint64
//     id does not survive a single f64"), so `of_poi_row` splits it into
//     [idLo, idHi] and every visited/known/mark_* export takes the halves
//     back and rejoins them. This is that arithmetic, exercised natively so
//     the client's poiabi.ts driver has a pinned, non-JS proof that the split
//     is lossless before it ever touches a browser: a 32-bit half is always
//     exactly representable in an f64's 52-bit mantissa, so the only place
//     this could go wrong is the split/join arithmetic itself.
// =============================================================================
TEST(the_id_split_into_two_32_bit_halves_round_trips_through_an_f64_exactly) {
  const BodyParams forge = makeForge(kSeed);
  SiteCatalog cat = SiteCatalog::ForBody(forge);
  CHECK(cat.size() == 1);
  std::vector<uint64_t> ids;
  if (cat.size() > 0) ids.push_back(cat.sites()[0].id);
  // Edge cases the shipped ruin's id cannot exercise on its own: both halves
  // zero, both halves saturated, and each half saturated alone.
  ids.push_back(0ull);
  ids.push_back(~0ull);
  ids.push_back(0x00000000FFFFFFFFull);
  ids.push_back(0xFFFFFFFF00000000ull);
  ids.push_back(0x9f051605d9480737ull);   // the shipped ruin's id, pinned
  for (uint64_t id : ids) {
    const uint32_t idLo = static_cast<uint32_t>(id);
    const uint32_t idHi = static_cast<uint32_t>(id >> 32);
    // THE F64 CROSSING: what actually crosses the bridge is a double in the
    // scratch row, never the integer itself.
    const double idLoF = static_cast<double>(idLo);
    const double idHiF = static_cast<double>(idHi);
    const uint32_t backLo = static_cast<uint32_t>(idLoF);
    const uint32_t backHi = static_cast<uint32_t>(idHiF);
    CHECK(backLo == idLo);
    CHECK(backHi == idHi);
    const uint64_t joined = (static_cast<uint64_t>(backHi) << 32) | backLo;
    CHECK(joined == id);
  }
}


