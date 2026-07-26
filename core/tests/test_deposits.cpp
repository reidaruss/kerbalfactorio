// Wave-2 headless tests for the seeded resource-deposit catalog + mining query
// surface (Spike 1 §4.5; contract C-1; decision WG-11).
//
// Proves the five properties the slice's mining loop depends on:
//   1. DETERMINISM      — same seed -> identical catalog bitwise; diff seed -> different.
//   2. CINDER-ONLY      — no Cinderite on Forge; Cinder has Cinderite (WG-4 hook).
//   3. ON THE SURFACE   — each node's radius == SampleTerrainHeight at its lat/lon.
//   4. QUERIES          — QueryDepositsNear in/excludes by radius; GetDeposit round-trips.
//   5. EXTRACTION/DEPLETION — grants up to RemainingAmount, decrements, stops at 0;
//                         and depletion is the ONLY change (seed+diff: regenerate +
//                         re-apply recorded depletions reproduces the live state).
#include <cstdint>
#include <cstring>
#include <vector>

#include "test_framework.h"
#include "of/deposits.h"

using namespace of;
using namespace of::worldgen;

// --- bit-identity helpers (mirror test_world_gen.cpp) ------------------------
static uint64_t asBits(double d) {
  uint64_t u;
  std::memcpy(&u, &d, sizeof(u));
  return u;
}
static bool bitEqual(double a, double b) { return asBits(a) == asBits(b); }
static bool bitEqual(const Vec3& a, const Vec3& b) {
  return bitEqual(a.x, b.x) && bitEqual(a.y, b.y) && bitEqual(a.z, b.z);
}

// A frame id convention for these tests: body's frame == bodyId + 1 (matches the
// quad mesh's centerUniverse frame in cubed_sphere.h).
static FrameId frameOf(const BodyParams& b) {
  return static_cast<FrameId>(b.bodyId + 1);
}

// =============================================================================
// 1. DETERMINISM — same seed regenerates the identical catalog (ids, positions,
// resources, amounts) BITWISE; a different seed yields a different catalog.
// This is the seed half of seed+diff persistence (WV1 extended to deposits).
// =============================================================================
TEST(deposits_same_seed_regenerates_bit_identical) {
  const BodyParams forge = makeForge(/*worldSeed*/ 1234567ull);
  const std::vector<FDepositNode> a =
      GenerateDeposits(forge, forge.bodySeed, frameOf(forge));
  const std::vector<FDepositNode> b =
      GenerateDeposits(forge, forge.bodySeed, frameOf(forge));

  CHECK(a.size() == b.size());
  CHECK(!a.empty());  // the planet actually has deposits
  bool allEqual = true;
  for (size_t i = 0; i < a.size() && i < b.size(); ++i) {
    if (a[i].Id != b[i].Id) allEqual = false;
    if (a[i].Resource != b[i].Resource) allEqual = false;
    if (a[i].Body != b[i].Body) allEqual = false;
    if (asBits(a[i].Grade) != asBits(b[i].Grade) && a[i].Grade != b[i].Grade)
      allEqual = false;
    if (!bitEqual(a[i].Position.pos, b[i].Position.pos)) allEqual = false;
    if (a[i].Position.frame != b[i].Position.frame) allEqual = false;
    if (!bitEqual(a[i].Lat, b[i].Lat)) allEqual = false;
    if (!bitEqual(a[i].Lon, b[i].Lon)) allEqual = false;
    if (!bitEqual(a[i].SurfaceNormal, b[i].SurfaceNormal)) allEqual = false;
    if (!bitEqual(a[i].InitialAmount, b[i].InitialAmount)) allEqual = false;
    if (!bitEqual(a[i].RemainingAmount, b[i].RemainingAmount)) allEqual = false;
  }
  CHECK(allEqual);
}

TEST(deposits_different_seed_differs) {
  const BodyParams f1 = makeForge(42ull);
  const BodyParams f2 = makeForge(43ull);
  const std::vector<FDepositNode> a =
      GenerateDeposits(f1, f1.bodySeed, frameOf(f1));
  const std::vector<FDepositNode> b =
      GenerateDeposits(f2, f2.bodySeed, frameOf(f2));
  // Same body kind, different seed -> the placement must diverge. Compare the
  // full id set: identical sets would mean the seed didn't matter.
  bool identical = (a.size() == b.size());
  if (identical) {
    for (size_t i = 0; i < a.size(); ++i) {
      if (a[i].Id != b[i].Id || !bitEqual(a[i].Position.pos, b[i].Position.pos)) {
        identical = false;
        break;
      }
    }
  }
  CHECK(!identical);  // the seed actually changes the catalog
}

// =============================================================================
// 2. CINDERITE IS CINDER-ONLY (WG-4, §4.5.3, the off-world hook).
// No Forge node carries the Cinderite id; Cinder DOES carry it.
// =============================================================================
TEST(deposits_cinderite_is_cinder_only) {
  const BodyParams forge = makeForge(2026ull);
  const BodyParams cinder = makeCinder(2026ull);

  const std::vector<FDepositNode> fdep =
      GenerateDeposits(forge, forge.bodySeed, frameOf(forge));
  const std::vector<FDepositNode> cdep =
      GenerateDeposits(cinder, cinder.bodySeed, frameOf(cinder));

  // No Forge node may carry the Cinderite id — and every Forge node IS Ferrite.
  int forgeCinderite = 0;
  for (const FDepositNode& d : fdep) {
    if (d.Resource == kItemCinderite) ++forgeCinderite;
    CHECK(d.Resource == kItemFerriteOre);  // Forge: base ore only
  }
  CHECK(forgeCinderite == 0);  // the hard rule of WG-4

  // Cinder must actually have Cinderite (the off-world resource exists to mine).
  int cinderCinderite = 0;
  for (const FDepositNode& d : cdep) {
    if (d.Resource == kItemCinderite) ++cinderCinderite;
  }
  CHECK(cinderCinderite > 0);
}

// =============================================================================
// 3. ON THE SURFACE — every node's |Position| ~= bodyRadius + SampleTerrainHeight
// at its (lat,lon). It sits on the terrain, not floating above / buried below.
// =============================================================================
TEST(deposits_sit_on_the_surface) {
  const BodyParams cinder = makeCinder(99ull);
  const std::vector<FDepositNode> dep =
      GenerateDeposits(cinder, cinder.bodySeed, frameOf(cinder));
  CHECK(!dep.empty());
  for (const FDepositNode& d : dep) {
    const double r = d.Position.pos.length();
    const double queried =
        cinder.radiusM + SampleTerrainHeight(cinder, d.Lat, d.Lon);
    // lat/lon round-trip introduces tiny float error; height varies smoothly so
    // a 1 m tolerance confirms the node lies on the heightfield (matches WV7).
    CHECK_NEAR(r, queried, 1.0);
    // and the relief is bounded (node didn't escape the body shell)
    const double relief = r - cinder.radiusM;
    CHECK(std::fabs(relief) <= cinder.maxReliefM + 1.0);
    // surface normal is a unit vector pointing outward
    CHECK_NEAR(d.SurfaceNormal.length(), 1.0, 1e-6);
    CHECK(d.SurfaceNormal.dot(d.Position.pos) > 0.0);
  }
}

// =============================================================================
// 4. QUERIES — QueryDepositsNear returns nodes inside the radius and excludes
// far ones; GetDeposit(id) round-trips a placed node; unknown id misses.
// =============================================================================
TEST(deposits_query_near_and_by_id) {
  const BodyParams forge = makeForge(7777ull);
  DepositCatalog cat = DepositCatalog::ForBody(forge, forge.bodySeed, frameOf(forge));
  CHECK(cat.size() > 0);

  const FDepositNode& target = cat.GetDeposits()[cat.size() / 2];

  // GetDeposit round-trips by id.
  FDepositNode fetched;
  CHECK(cat.GetDeposit(target.Id, fetched));
  CHECK(fetched.Id == target.Id);
  CHECK(bitEqual(fetched.Position.pos, target.Position.pos));
  CHECK(fetched.Resource == target.Resource);

  // Unknown id misses.
  FDepositNode miss;
  CHECK(!cat.GetDeposit(target.Id ^ 0xFFFFFFFFFFFFFFFFull, miss));

  // QueryDepositsNear: a tight radius around the target returns the target
  // itself; a near-zero radius around a far point (antipode) excludes it.
  {
    const std::vector<FDepositNode> near =
        cat.QueryDepositsNear(target.Position, 1.0 /*m*/);
    bool foundTarget = false;
    for (const FDepositNode& d : near) {
      if (d.Id == target.Id) foundTarget = true;
      // every returned node is genuinely within the radius
      const Vec3 delta = d.Position.pos - target.Position.pos;
      CHECK(delta.length() <= 1.0 + 1e-9);
    }
    CHECK(foundTarget);
  }
  {
    // A point on the far side of the body, tiny radius -> nothing.
    UniverseCoord antipode(target.Position.pos * -1.0, target.Position.frame);
    const std::vector<FDepositNode> none =
        cat.QueryDepositsNear(antipode, 1.0 /*m*/);
    CHECK(none.empty());
  }
  {
    // A radius spanning the whole body returns ALL same-frame nodes.
    const std::vector<FDepositNode> all =
        cat.QueryDepositsNear(target.Position, 4.0 * forge.radiusM);
    CHECK(all.size() == cat.size());
  }
}

// =============================================================================
// 5a. EXTRACTION/DEPLETION — grants up to RemainingAmount, decrements it, stops
// at 0 (no negative, no over-grant); unknown id grants nothing.
// =============================================================================
TEST(deposits_extraction_depletes_and_clamps) {
  const BodyParams forge = makeForge(555ull);
  DepositCatalog cat = DepositCatalog::ForBody(forge, forge.bodySeed, frameOf(forge));
  const DepositId id = cat.GetDeposits()[0].Id;

  FDepositNode before;
  CHECK(cat.GetDeposit(id, before));
  const double initial = before.RemainingAmount;
  CHECK(initial > 0.0);

  // Partial extraction grants exactly what's requested and decrements.
  const double g1 = cat.ExtractFromDeposit(id, initial * 0.25);
  CHECK_NEAR(g1, initial * 0.25, 1e-9);
  FDepositNode mid;
  cat.GetDeposit(id, mid);
  CHECK_NEAR(mid.RemainingAmount, initial - g1, 1e-9);

  // Over-request grants only what remains; never goes negative.
  const double g2 = cat.ExtractFromDeposit(id, initial * 10.0);
  CHECK_NEAR(g2, initial - g1, 1e-9);  // exactly the remainder
  FDepositNode end;
  cat.GetDeposit(id, end);
  CHECK(end.RemainingAmount == 0.0);  // depleted, clamped at 0 (not negative)

  // Further extraction from an exhausted node grants nothing.
  const double g3 = cat.ExtractFromDeposit(id, 1000.0);
  CHECK(g3 == 0.0);
  cat.GetDeposit(id, end);
  CHECK(end.RemainingAmount == 0.0);

  // Total granted never exceeds the initial amount (no duplication).
  CHECK_NEAR(g1 + g2 + g3, initial, 1e-9);

  // Unknown id grants nothing and mutates nothing.
  const double gx = cat.ExtractFromDeposit(0xBADBADBADBADull, 100.0);
  CHECK(gx == 0.0);

  // Negative / zero request is a no-op.
  CHECK(cat.ExtractFromDeposit(id, -5.0) == 0.0);
  CHECK(cat.ExtractFromDeposit(id, 0.0) == 0.0);
}

// =============================================================================
// 5b. THE SEED+DIFF PROPERTY (WG-3 / C-6): depletion is the ONLY thing that
// changes. Regenerating the catalog from seed + re-applying the RECORDED
// depletions (depositId, amountExtracted)[] reproduces the live state EXACTLY —
// every other field is identical to a fresh generation. This is what makes the
// natural world free to persist (only RemainingAmount is a diff).
// =============================================================================
TEST(deposits_seed_plus_depletion_diff_reproduces_state) {
  const BodyParams forge = makeForge(31415ull);
  const FrameId frame = frameOf(forge);

  // The "live" catalog the player has been mining.
  DepositCatalog live = DepositCatalog::ForBody(forge, forge.bodySeed, frame);

  // Record a depletion log as a real session would (the diff that gets saved).
  struct Drain { DepositId id; double extracted; };
  std::vector<Drain> log;
  const auto& nodes = live.GetDeposits();
  CHECK(nodes.size() >= 3);
  // Drain three nodes by varying amounts (one to exhaustion).
  {
    const DepositId a = nodes[0].Id, b = nodes[1].Id, c = nodes[2].Id;
    const double aInit = nodes[0].RemainingAmount;
    log.push_back({a, live.ExtractFromDeposit(a, aInit * 0.5)});
    log.push_back({b, live.ExtractFromDeposit(b, 1234.0)});
    log.push_back({c, live.ExtractFromDeposit(c, 1e18 /*exhaust*/)});  // clamps
  }

  // RELOAD: regenerate placement from seed (free), then re-apply the saved diff.
  DepositCatalog reloaded = DepositCatalog::ForBody(forge, forge.bodySeed, frame);
  for (const Drain& d : log) {
    const double granted = reloaded.ExtractFromDeposit(d.id, d.extracted);
    // The diff re-binds to the SAME node (stable id) and drains the same amount.
    CHECK_NEAR(granted, d.extracted, 1e-9);
  }

  // The reloaded catalog now equals the live catalog field-for-field, BITWISE —
  // proving depletion (RemainingAmount) is the only thing that ever changed.
  const auto& L = live.GetDeposits();
  const auto& R = reloaded.GetDeposits();
  CHECK(L.size() == R.size());
  bool identical = true;
  for (size_t i = 0; i < L.size() && i < R.size(); ++i) {
    if (L[i].Id != R[i].Id) identical = false;
    if (L[i].Resource != R[i].Resource) identical = false;
    if (!bitEqual(L[i].Position.pos, R[i].Position.pos)) identical = false;
    if (!bitEqual(L[i].InitialAmount, R[i].InitialAmount)) identical = false;
    if (!bitEqual(L[i].RemainingAmount, R[i].RemainingAmount)) identical = false;  // the diff
  }
  CHECK(identical);
}

// =============================================================================
// §P — ORE PATCHES: a deposit is an area of ground, not a pebble.
//
// The properties a patch has to have before anything can be built on it:
//   P1. DETERMINISM  — same seed regenerates the field bitwise; a different seed
//                      gives a different field.
//   P2. IT IS A PATCH — a measurable extent, an irregular (non-circular) outline,
//                      and a richness that falls from the centre to the rim.
//   P3. IN / OUT      — a point in the middle is inside, a point well outside is
//                      NOT, and findPatch answers -1 there. This is the negative
//                      control the drill's placement refusal is built on.
//   P4. ONE POOL      — extraction depletes the patch, clamps at zero, and never
//                      over-grants.
//   P5. SEED + DIFF   — regenerating and re-applying the recorded depletion
//                      reproduces the live state (DW-17 / WG-3).
// =============================================================================
static Vec3 unit(const Vec3& v) {
  const double l = v.length();
  return (l > 0.0) ? Vec3(v.x / l, v.y / l, v.z / l) : Vec3(0, 1, 0);
}

static std::vector<uint8_t> patchKinds() {
  using NK = survival::NodeKind;
  return {static_cast<uint8_t>(NK::IronOre), static_cast<uint8_t>(NK::CoalSeam),
          static_cast<uint8_t>(NK::CopperOre), static_cast<uint8_t>(NK::Rock),
          static_cast<uint8_t>(NK::IronOre)};
}

TEST(patches_same_seed_regenerates_bit_identical) {
  const BodyParams forge = makeForge(777001ull);
  const Vec3 c = unit(Vec3(0.31, 0.62, 0.72));
  const auto a = patches::LayoutPatchField(forge, forge.bodySeed, frameOf(forge),
                                           c, patchKinds());
  const auto b = patches::LayoutPatchField(forge, forge.bodySeed, frameOf(forge),
                                           c, patchKinds());
  CHECK(a.size() == patchKinds().size());
  CHECK(a.size() == b.size());
  bool same = true;
  for (size_t i = 0; i < a.size(); ++i) {
    if (a[i].Id != b[i].Id) same = false;
    if (a[i].Resource != b[i].Resource) same = false;
    if (a[i].Shape != b[i].Shape) same = false;
    if (!bitEqual(a[i].Centre, b[i].Centre)) same = false;
    if (!bitEqual(a[i].Dir, b[i].Dir)) same = false;
    if (!bitEqual(a[i].RadiusM, b[i].RadiusM)) same = false;
    if (!bitEqual(a[i].InitialAmount, b[i].InitialAmount)) same = false;
  }
  CHECK(same);

  const BodyParams other = makeForge(777002ull);
  const auto d = patches::LayoutPatchField(other, other.bodySeed, frameOf(other),
                                           c, patchKinds());
  bool differs = false;
  for (size_t i = 0; i < a.size() && i < d.size(); ++i)
    if (a[i].Id != d[i].Id || !bitEqual(a[i].RadiusM, d[i].RadiusM)) differs = true;
  CHECK(differs);
}

TEST(patches_are_an_irregular_area_with_falling_richness) {
  const BodyParams forge = makeForge(777003ull);
  const auto field = patches::LayoutPatchField(
      forge, forge.bodySeed, frameOf(forge), unit(Vec3(0, 1, 0)), patchKinds());
  CHECK(!field.empty());

  for (const patches::OrePatch& p : field) {
    // A real extent, in metres, not a point.
    CHECK(p.RadiusM >= patches::kMinRadiusM);
    CHECK(p.RadiusM <= patches::kMaxRadiusM);
    CHECK(p.InitialAmount > 500.0);
    CHECK(p.Grade > 0.0f && p.Grade <= 1.0f);

    // The outline is IRREGULAR: sweeping the azimuth must produce a spread of
    // boundary radii. A circle would give min == max, and a circle reads as a
    // decal rather than as an ore body.
    double lo = 1e30, hi = -1e30;
    for (int s = 0; s < 64; ++s) {
      const double th = 6.283185307179586 * s / 64.0;
      const double r = patches::lobeRadiusM(p, th);
      if (r < lo) lo = r;
      if (r > hi) hi = r;
    }
    CHECK(hi - lo > 0.5);           // measurably not a circle
    CHECK(lo > 0.30 * p.RadiusM);   // and still star-shaped about the centre

    // Richness falls from the centre outward, and the centre is the peak.
    const double c0 = patches::coverageAt(p, p.Centre);
    const double cMid = patches::coverageAt(
        p, p.Centre + p.T1 * (0.5 * lo));
    const double cRim = patches::coverageAt(p, p.Centre + p.T1 * (hi * 1.6));
    CHECK_NEAR(c0, 1.0, 1e-9);
    CHECK(cMid < c0 && cMid > 0.0);
    CHECK_NEAR(cRim, 0.0, 1e-12);
    CHECK_NEAR(patches::richnessAt(p, p.Centre),
               static_cast<double>(p.Grade), 1e-9);
  }
}

TEST(patches_contain_their_own_ground_and_refuse_everything_else) {
  const BodyParams forge = makeForge(777004ull);
  const auto field = patches::LayoutPatchField(
      forge, forge.bodySeed, frameOf(forge), unit(Vec3(0.5, 0.5, 0.7)),
      patchKinds());
  CHECK(!field.empty());
  const patches::OrePatch& p = field[0];

  CHECK(patches::contains(p, p.Centre));
  CHECK(patches::findPatch(field, p.Centre) == 0);

  // THE NEGATIVE CONTROL. 400 m out along the patch's own tangent is ordinary
  // ground: no patch contains it, and findPatch says so. This is exactly the
  // question a drill placement asks before it refuses.
  const Vec3 far = p.Centre + p.T1 * 400.0;
  CHECK(!patches::contains(p, far));
  CHECK(patches::findPatch(field, far) < 0);

  // Every outcrop stands ON its own patch, sunk into the ground rather than on
  // top of it, and the pieces are not all in one place.
  const int n = patches::outcropCount(p);
  CHECK(n >= 5);
  double minCover = 1e30, spread = 0.0;
  for (int i = 0; i < n; ++i) {
    const patches::Outcrop o = patches::outcropAt(p, i);
    const Vec3 at = o.Dir * p.Centre.length();
    CHECK(patches::coverageAt(p, at) > 0.0);
    CHECK(o.SinkFrac > 0.2 && o.SinkFrac < 0.7);
    CHECK(o.Scale > 0.4);
    if (o.Coverage < minCover) minCover = o.Coverage;
    const patches::Outcrop o0 = patches::outcropAt(p, 0);
    const double d = (o.Dir - o0.Dir).length() * p.Centre.length();
    if (d > spread) spread = d;
  }
  CHECK(spread > 1.0);   // they are scattered across the patch, not stacked

  // The drawable skin covers the same ground the rule does: the rim samples land
  // at coverage 0 and the centre at 1, so the tint and the drill rate agree.
  const auto disc = patches::sampleDisc(p, 3, 24);
  CHECK(disc.size() == 4u * 24u);
  CHECK_NEAR(disc[0].Coverage, 1.0, 1e-12);
  CHECK_NEAR(disc[disc.size() - 1].Coverage, 0.0, 1e-12);
}

TEST(patches_are_one_pool_that_depletes_and_clamps) {
  const BodyParams forge = makeForge(777005ull);
  auto field = patches::LayoutPatchField(
      forge, forge.bodySeed, frameOf(forge), unit(Vec3(0, 0, 1)), patchKinds());
  patches::OrePatch& p = field[0];
  const double initial = p.InitialAmount;

  CHECK_NEAR(patches::extract(p, 100.0), 100.0, 1e-9);
  CHECK_NEAR(p.RemainingAmount, initial - 100.0, 1e-9);
  CHECK_NEAR(patches::extract(p, -5.0), 0.0, 1e-12);        // never a source
  CHECK_NEAR(p.RemainingAmount, initial - 100.0, 1e-9);

  // Asking for more than is left grants exactly what is left and stops at zero.
  const double left = p.RemainingAmount;
  CHECK_NEAR(patches::extract(p, left * 10.0), left, 1e-9);
  CHECK_NEAR(p.RemainingAmount, 0.0, 1e-12);
  CHECK_NEAR(patches::extract(p, 50.0), 0.0, 1e-12);
  CHECK(p.InitialAmount == initial);   // the seed baseline never moved

  // P5, seed + diff: regenerate the field and re-apply the recorded depletion.
  auto reloaded = patches::LayoutPatchField(
      forge, forge.bodySeed, frameOf(forge), unit(Vec3(0, 0, 1)), patchKinds());
  CHECK(reloaded[0].Id == p.Id);
  patches::extract(reloaded[0], initial);
  CHECK_NEAR(reloaded[0].RemainingAmount, p.RemainingAmount, 1e-9);
}
