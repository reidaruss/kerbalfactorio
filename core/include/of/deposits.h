#pragma once
// =============================================================================
// deposits.h — Wave-2 seeded resource-deposit placement + the mining query
// surface (Spike 1 §4.5; contract C-1; decision WG-11).
//
// Realizes the pinned `FDepositNode` catalog: a DETERMINISTIC, seed-generated
// set of depletable ore nodes snapped to the cubed-sphere surface, plus the
// query surface the slice's mining loop calls
//   GetDeposits / QueryDepositsNear / GetDeposit / ExtractFromDeposit.
//
// THE TWO PINNED RULES this file obeys (Spike 1 §4.5, WG-11 / WG-6 / WG-4):
//   1. Placement is POSITION-hashed from (bodySeed, dir) — never sequence-hashed
//      (WG-6). So the catalog is a PURE function of (bodySeed, body): two runs /
//      two machines / save-reload reproduce the identical catalog bit-for-bit
//      (WV1). Only `RemainingAmount` is mutable — that one field is the depletion
//      diff persistence saves (WG-3 / C-6). Re-generating from seed + re-applying
//      the recorded depletions reproduces the live state (the seed+diff property).
//   2. `Resource` is the gameplay `ItemId` DIRECTLY (WG-11) — an OPAQUE uint16
//      world-gen never interprets. World-gen owns only PLACEMENT: which body's
//      nodes carry which id. Ferrite-ore (0x0001) on Forge; Cinderite (0x0004)
//      ONLY on Cinder (WG-4, the off-world hook §4.5.3) — placed on NO Forge node.
//
// Additive, header-only. Consumes cubed_sphere.h READ-ONLY (BodyParams,
// sampleHeightField, latLonToDir/dirToLatLon, the position-hash substrate) and
// of::UniverseCoord / of::FrameId. No gameplay.h include — `Resource` is a bare
// uint16_t per WG-11 (the id space is gameplay's C-3, referenced not defined).
// =============================================================================
#include <cstdint>
#include <vector>
#include <algorithm>
#include <functional>

#include "of/vec3.h"
#include "of/universe_coord.h"
#include "of/cubed_sphere.h"

namespace of {
namespace worldgen {

// =============================================================================
// §0 — Resource ids (OPAQUE — gameplay C-3 owns the id space; WG-11).
//
// World-gen treats `Resource` as a bare uint16_t and only decides WHICH id a
// body's deposits carry. These two constants name the ids the slice needs; they
// are referenced, NOT authoritative — gameplay's registry is the source of truth.
// =============================================================================
using ItemId = uint16_t;
constexpr ItemId kItemFerriteOre = 0x0001;  // base on-planet ore (Forge)
constexpr ItemId kItemCinderite  = 0x0004;  // off-world hook (Cinder-ONLY, WG-4)

// Stable 64-bit deposit id (the persistence key for depletion, §4.6 / C-6).
using DepositId = uint64_t;

// =============================================================================
// §4.5.1 — FDepositNode (PINNED, Spike 1 §4.5, WG-11).
//
// Every position is a UniverseCoord (carries its FrameId); deterministic from
// seed; `RemainingAmount` is the ONLY mutable field (the depletion diff).
// =============================================================================
struct FDepositNode {
  DepositId      Id = 0;             // stable: hashCombine(bodySeed, region, localIndex)
  UniverseCoord  Position;          // node center on the heightfield, body frame (64-bit)
  double         Lat = 0.0;         // surface latitude  (radians)
  double         Lon = 0.0;         // surface longitude (radians)
  Vec3           SurfaceNormal;     // body-frame terrain normal at the node
  uint32_t       Body = 0;          // FBodyId (== Position.frame's body; 0=Forge 1=Cinder)
  ItemId         Resource = 0;      // OPAQUE gameplay-owned item id (WG-11) — what it yields
  float          Grade = 0.0f;      // richness in (0,1] — extraction-rate multiplier
  double         InitialAmount = 0.0;   // seed baseline (regenerates — NOT saved)
  double         RemainingAmount = 0.0; // current quantity left — THE mutable depletion diff
};

// =============================================================================
// §4.5.2 — GenerateDeposits: deterministic seeded placement pass.
//
// A Fibonacci-sphere candidate lattice gives an even Poisson-ish distribution
// for free; each candidate is then position-hashed (bodySeed, dir) to decide
// existence (per-body density), jitter, grade and amount — so placement order is
// irrelevant and the catalog is a pure function of (bodySeed, body). Each kept
// node is SNAPPED to the surface via the SAME sampleHeightField the mesh uses
// (so it sits exactly on the terrain), and tagged with the per-body resource id.
// =============================================================================
namespace detail {

// Per-body candidate count + acceptance density (tunable balance numbers).
// Forge: broad/rich. Cinder: sparse (the off-world resource is scarce, WG-4).
inline int candidateCount(const BodyParams& body) {
  return body.kind == kPlanet ? 4096 : 2048;
}
inline double depositDensity(const BodyParams& body) {
  return body.kind == kPlanet ? 0.18 : 0.10;  // fraction of candidates that spawn
}

// Per-body base extractable amount (item units) before the grade multiplier.
inline double baseAmount(ItemId resource) {
  return resource == kItemCinderite ? 50000.0 : 120000.0;
}

// PickResource (§4.5.3, WG-4): the per-body resource-identity rule.
//   Forge -> always Ferrite ore. Never Cinderite.
//   Cinder -> Cinderite (the off-world id, placed on no Forge node), with a
//             fraction of common Ferrite ore too so the moon isn't single-ore.
// The Cinderite id is returned ONLY for the moon — the hard rule of WG-4.
inline ItemId pickResource(uint64_t bodySeed, const BodyParams& body,
                           const Vec3& dir) {
  if (body.kind == kPlanet) {
    return kItemFerriteOre;  // Forge: base ore only — NEVER Cinderite.
  }
  // Cinder: mostly the Cinder-only id, with some common Ferrite ore mixed in.
  const double r = hashToUnit(hashPos(bodySeed, dir, /*channel*/ 0xC1DE));
  return r < 0.7 ? kItemCinderite : kItemFerriteOre;
}

}  // namespace detail

// The even-distribution candidate direction for index n of N (Fibonacci sphere).
inline Vec3 fibonacciDir(int n, int count) {
  // golden-ratio spiral: y in (-1,1), longitude by the golden angle.
  const double ga = 2.39996322972865332;  // pi * (3 - sqrt(5))
  const double y = 1.0 - (2.0 * n + 1.0) / static_cast<double>(count);  // (-1,1)
  const double r = std::sqrt(std::max(0.0, 1.0 - y * y));
  const double theta = ga * n;
  return Vec3(std::cos(theta) * r, y, std::sin(theta) * r);
}

// Optional surface-snap height callback (WG-21). Given a node's unit dir, returns
// the relief (metres) the node should sit on. Default null = RAW sampleHeightField
// (bit-identical to the original placement). The oracle-aligned callers (the UE
// local-deposit pass) pass biome.h's sampleDesignedHeight so nodes snap to the
// DESIGNED surface the mesh/collision/walker read — no more floating nodes (the
// M4.4 bug). This header stays LEAF (no biome.h dependency); the caller supplies
// the sampler. The planet-WIDE path (biome.h GenerateBiomeDeposits) already snaps
// to sampleDesignedHeight directly.
using SnapHeightFn = std::function<double(const Vec3& dir)>;

// Generate the full deposit catalog for one body. DETERMINISTIC from
// (bodySeed, body): same inputs -> identical vector (ids, positions, resources,
// amounts) bitwise; a different seed -> a different catalog.
inline std::vector<FDepositNode> GenerateDeposits(const BodyParams& body,
                                                  uint64_t bodySeed,
                                                  FrameId bodyFrame,
                                                  const SnapHeightFn& snapH = nullptr) {
  std::vector<FDepositNode> out;
  const int count = detail::candidateCount(body);
  const double density = detail::depositDensity(body);

  for (int n = 0; n < count; ++n) {
    const Vec3 cand = fibonacciDir(n, count);

    // Existence: position-hashed acceptance. Order-independent (WG-6).
    const double exist = hashToUnit(hashPos(bodySeed, cand, /*channel*/ 0xDEAd));
    if (exist >= density) continue;

    // Jitter the direction slightly so nodes don't sit on a perfect lattice.
    const Vec3 jit(hashToSigned(hashPos(bodySeed, cand, 0x1A)) * 0.01,
                   hashToSigned(hashPos(bodySeed, cand, 0x2B)) * 0.01,
                   hashToSigned(hashPos(bodySeed, cand, 0x3C)) * 0.01);
    Vec3 p(cand.x + jit.x, cand.y + jit.y, cand.z + jit.z);
    const double invLen = 1.0 / p.length();
    const Vec3 dir(p.x * invLen, p.y * invLen, p.z * invLen);

    FDepositNode node;

    // Snap to the surface (WG-21): the oracle base if a sampler is supplied
    // (sampleDesignedHeight — the mesh/collision/walker surface), else RAW
    // sampleHeightField (bit-identical default). Node sits exactly on that surface.
    const double h = snapH ? snapH(dir) : sampleHeightField(body, dir);
    const double radius = body.radiusM + h;
    node.Position = UniverseCoord(dir * radius, bodyFrame);
    dirToLatLon(dir, node.Lat, node.Lon);

    // Surface normal via finite differences of the heightfield along two tangent
    // directions (radial-up gradient). Cheap, deterministic, points outward.
    {
      // Build an orthonormal tangent basis at `dir`.
      Vec3 up = (std::fabs(dir.y) < 0.99) ? Vec3(0, 1, 0) : Vec3(1, 0, 0);
      Vec3 t1(up.y * dir.z - up.z * dir.y, up.z * dir.x - up.x * dir.z,
              up.x * dir.y - up.y * dir.x);
      double t1l = t1.length();
      t1 = t1 * (1.0 / t1l);
      Vec3 t2(dir.y * t1.z - dir.z * t1.y, dir.z * t1.x - dir.x * t1.z,
              dir.x * t1.y - dir.y * t1.x);
      const double eps = 1e-4;
      auto surfAt = [&](const Vec3& d) {
        const double il = 1.0 / d.length();
        const Vec3 nd(d.x * il, d.y * il, d.z * il);
        return nd * (body.radiusM + sampleHeightField(body, nd));
      };
      const Vec3 c = node.Position.pos;
      const Vec3 du = surfAt(dir + t1 * eps) - c;
      const Vec3 dv = surfAt(dir + t2 * eps) - c;
      Vec3 nrm(du.y * dv.z - du.z * dv.y, du.z * dv.x - du.x * dv.z,
               du.x * dv.y - du.y * dv.x);
      const double nl = nrm.length();
      if (nl > 0.0) nrm = nrm * (1.0 / nl);
      if (nrm.dot(dir) < 0.0) nrm = nrm * -1.0;  // orient outward
      node.SurfaceNormal = nrm;
    }

    node.Body = body.bodyId;
    node.Resource = detail::pickResource(bodySeed, body, dir);
    // Grade in (0.3, 1.0], position-hashed.
    node.Grade = static_cast<float>(
        0.3 + 0.7 * hashToUnit(hashPos(bodySeed, dir, /*channel*/ 0x67ade)));
    node.InitialAmount = detail::baseAmount(node.Resource) * node.Grade;
    node.RemainingAmount = node.InitialAmount;

    // Stable id: hash64(bodySeed, region, localIndex). The placement "region" is
    // the canonical cube face of the dir (faceOfDir); localIndex is the candidate
    // ordinal — together unique + reproducible (regenerates to the identical id).
    const uint64_t region = static_cast<uint64_t>(faceOfDir(dir));
    uint64_t id = mix64(bodySeed ^ 0xDE0517ull);
    id = hashCombine(id, region);
    id = hashCombine(id, static_cast<uint64_t>(n));
    node.Id = id;

    out.push_back(node);
  }
  return out;
}

// =============================================================================
// §4.5.2 — DepositCatalog: holds the generated nodes + the mining query surface.
//
// The query surface the slice's mining loop calls (Spike 1 §4.5.2). Built once
// from a GenerateDeposits() result; ExtractFromDeposit is the ONLY mutator.
// =============================================================================
class DepositCatalog {
 public:
  DepositCatalog() = default;
  explicit DepositCatalog(std::vector<FDepositNode> nodes)
      : nodes_(std::move(nodes)) {}

  // Generate + hold the catalog for a body in one step.
  static DepositCatalog ForBody(const BodyParams& body, uint64_t bodySeed,
                                FrameId bodyFrame,
                                const SnapHeightFn& snapH = nullptr) {
    return DepositCatalog(GenerateDeposits(body, bodySeed, bodyFrame, snapH));
  }

  // ---- Queries (Spike 1 §4.5.2) -------------------------------------------
  const std::vector<FDepositNode>& GetDeposits() const { return nodes_; }
  size_t size() const { return nodes_.size(); }

  // Nodes whose center is within `radiusM` of `at` (same frame assumed — the
  // slice queries one body at a time). Straight Euclidean distance in metres.
  std::vector<FDepositNode> QueryDepositsNear(const UniverseCoord& at,
                                              double radiusM) const {
    std::vector<FDepositNode> hits;
    const double r2 = radiusM * radiusM;
    for (const FDepositNode& d : nodes_) {
      if (d.Position.frame != at.frame) continue;
      const Vec3 delta = d.Position.pos - at.pos;
      if (delta.lengthSq() <= r2) hits.push_back(d);
    }
    return hits;
  }

  // Single-node fetch by id (round-trips a node placed by GenerateDeposits).
  bool GetDeposit(DepositId id, FDepositNode& out) const {
    for (const FDepositNode& d : nodes_) {
      if (d.Id == id) {
        out = d;
        return true;
      }
    }
    return false;
  }

  // Extraction sink — the ONLY mutator. Grants up to RemainingAmount, decrements
  // it, clamps at 0 (never negative, never over-grants). Returns amount granted.
  double ExtractFromDeposit(DepositId id, double requested) {
    if (requested <= 0.0) return 0.0;
    for (FDepositNode& d : nodes_) {
      if (d.Id == id) {
        const double granted = std::min(requested, d.RemainingAmount);
        d.RemainingAmount -= granted;
        if (d.RemainingAmount < 0.0) d.RemainingAmount = 0.0;  // belt-and-braces
        return granted;
      }
    }
    return 0.0;  // unknown id grants nothing
  }

 private:
  std::vector<FDepositNode> nodes_;
};

// =============================================================================
// §S — Primitive-survival terrestrial resource nodes (WP1 survival slice).
//
// The pinned slice ships ONE on-planet ore (Ferrite, §0). The survival-crafting
// slice needs a richer terrestrial harvest set — trees, rocks, coal seams, two
// ore kinds, water pools, oil seeps — each yielding its raw `ItemId` directly
// (the SAME WG-11 rule: `Resource` IS the opaque gameplay item id; world-gen
// owns only PLACEMENT). These constants are REFERENCED here (named for the
// placement code) but gameplay's SliceRegistry remains the source of truth for
// the ids — they mirror the survival ItemId block authored in gameplay.h §S.
//
// This is deliberately a SMALL, deterministic TEST-AREA layout — NOT a planet-
// wide population pass like GenerateDeposits. WP2 (the UE layer) just needs a
// handful of nodes laid out in a small patch to harvest by hand; LayoutTestArea
// gives exactly that, position-hashed from (seed, ring index) so it is
// reproducible bit-for-bit (the same determinism discipline as the catalog).
// =============================================================================
namespace survival {

// The raw-resource ItemIds the survival nodes yield. OPAQUE here (WG-11) — these
// are referenced, gameplay's registry (gameplay.h §S) is authoritative. Block at
// 0x0030+ so it never collides with the pinned slice (…0x0016) or science (0x0020+).
constexpr ItemId kItemWood      = 0x0030;  // tree
constexpr ItemId kItemStone     = 0x0031;  // rock
constexpr ItemId kItemCoal      = 0x0032;  // coal seam (also a fuel)
constexpr ItemId kItemRawIron   = 0x0033;  // iron ore
constexpr ItemId kItemRawCopper = 0x0034;  // copper ore
constexpr ItemId kItemWater     = 0x0035;  // water pool
constexpr ItemId kItemOil       = 0x0036;  // oil seep

// The harvestable node KINDS — one per terrestrial resource. Kept as an explicit
// enum (not just the ItemId) so the layout helper can vary base amount / grade by
// kind, and so the UE layer can pick an icon/mesh per kind without decoding the id.
enum class NodeKind : uint8_t {
  Tree = 0,    // -> wood
  Rock,        // -> stone
  CoalSeam,    // -> coal
  IronOre,     // -> raw_iron
  CopperOre,   // -> raw_copper
  WaterPool,   // -> water
  OilSeep,     // -> oil
};

// The ItemId a NodeKind yields when harvested (the WG-11 Resource).
inline ItemId resourceOf(NodeKind k) {
  switch (k) {
    case NodeKind::Tree:      return kItemWood;
    case NodeKind::Rock:      return kItemStone;
    case NodeKind::CoalSeam:  return kItemCoal;
    case NodeKind::IronOre:   return kItemRawIron;
    case NodeKind::CopperOre: return kItemRawCopper;
    case NodeKind::WaterPool: return kItemWater;
    case NodeKind::OilSeep:   return kItemOil;
  }
  return 0;
}

// Per-kind seed amount before the grade multiplier (item units). Renewable-ish
// kinds (trees/water) are smaller per node; ore/coal seams are deeper. Balance
// numbers — simple, deterministic, tweak freely.
inline double baseAmountOf(NodeKind k) {
  switch (k) {
    case NodeKind::Tree:      return 40.0;
    case NodeKind::Rock:      return 60.0;
    case NodeKind::CoalSeam:  return 200.0;
    case NodeKind::IronOre:   return 250.0;
    case NodeKind::CopperOre: return 250.0;
    case NodeKind::WaterPool: return 1000.0;  // a pool refills conceptually; big
    case NodeKind::OilSeep:   return 500.0;
  }
  return 0.0;
}

// Lay out a small DETERMINISTIC test-area patch of survival nodes around a centre
// direction on a body. `kinds` lists which node kinds to place (one node each, in
// order); they are spread on a tiny geodesic ring so they sit in a walkable patch.
// Position-hashed from (bodySeed, ringIndex) for grade/jitter so the patch is
// reproducible bit-for-bit (re-running with the same inputs gives identical ids/
// positions/grades). Each node is snapped to the terrain via the SAME
// sampleHeightField the mesh uses, exactly like GenerateDeposits.
//
// `centerDir` is a unit direction on the body (the patch centre); `ringRadiusRad`
// is the angular spread of the ring (small — a few hundred metres at planetary
// radius). Returns a freshly-built node vector (mutable RemainingAmount).
inline std::vector<FDepositNode> LayoutTestArea(const BodyParams& body,
                                                uint64_t bodySeed,
                                                FrameId bodyFrame,
                                                const Vec3& centerDir,
                                                const std::vector<NodeKind>& kinds,
                                                double ringRadiusRad = 0.002,
                                                const SnapHeightFn& snapH = nullptr) {
  std::vector<FDepositNode> out;
  out.reserve(kinds.size());

  // Normalise the centre direction + build a tangent basis to place the ring.
  const double clen = centerDir.length();
  const Vec3 c = (clen > 0.0) ? Vec3(centerDir.x / clen, centerDir.y / clen,
                                     centerDir.z / clen)
                              : Vec3(0, 1, 0);
  Vec3 up = (std::fabs(c.y) < 0.99) ? Vec3(0, 1, 0) : Vec3(1, 0, 0);
  Vec3 t1(up.y * c.z - up.z * c.y, up.z * c.x - up.x * c.z,
          up.x * c.y - up.y * c.x);
  const double t1l = t1.length();
  t1 = (t1l > 0.0) ? Vec3(t1.x / t1l, t1.y / t1l, t1.z / t1l) : Vec3(1, 0, 0);
  Vec3 t2(c.y * t1.z - c.z * t1.y, c.z * t1.x - c.x * t1.z,
          c.x * t1.y - c.y * t1.x);

  const int n = static_cast<int>(kinds.size());
  for (int i = 0; i < n; ++i) {
    const NodeKind kind = kinds[i];
    // Even ring placement + a small position-hashed jitter so it's not a perfect
    // circle (still fully deterministic from seed + index).
    const double ang = (n > 0) ? (2.0 * 3.14159265358979323846 * i / n) : 0.0;
    Vec3 ringDir(c.x + ringRadiusRad * (std::cos(ang) * t1.x + std::sin(ang) * t2.x),
                 c.y + ringRadiusRad * (std::cos(ang) * t1.y + std::sin(ang) * t2.y),
                 c.z + ringRadiusRad * (std::cos(ang) * t1.z + std::sin(ang) * t2.z));
    const double jx = hashToSigned(hashPos(bodySeed, ringDir, 0x5A1u)) * 0.0003;
    const double jy = hashToSigned(hashPos(bodySeed, ringDir, 0x5A2u)) * 0.0003;
    const double jz = hashToSigned(hashPos(bodySeed, ringDir, 0x5A3u)) * 0.0003;
    Vec3 p(ringDir.x + jx, ringDir.y + jy, ringDir.z + jz);
    const double invLen = 1.0 / p.length();
    const Vec3 dir(p.x * invLen, p.y * invLen, p.z * invLen);

    FDepositNode node;
    const double h = snapH ? snapH(dir) : sampleHeightField(body, dir);  // WG-21 oracle base if supplied
    const double radius = body.radiusM + h;
    node.Position = UniverseCoord(dir * radius, bodyFrame);
    dirToLatLon(dir, node.Lat, node.Lon);
    node.SurfaceNormal = dir;  // approx outward normal (patch is locally flat)
    node.Body = body.bodyId;
    node.Resource = resourceOf(kind);
    // Grade in (0.5, 1.0], position-hashed — survival nodes are richer/less spread
    // than the catalog so a hand harvest is workable.
    node.Grade = static_cast<float>(
        0.5 + 0.5 * hashToUnit(hashPos(bodySeed, dir, 0x57A47u)));
    node.InitialAmount = baseAmountOf(kind) * node.Grade;
    node.RemainingAmount = node.InitialAmount;
    // Stable id: hash of (bodySeed, kind, index) — reproducible across runs.
    uint64_t id = mix64(bodySeed ^ 0x5E2D17ull);
    id = hashCombine(id, static_cast<uint64_t>(kind));
    id = hashCombine(id, static_cast<uint64_t>(i));
    node.Id = id;

    out.push_back(node);
  }
  return out;
}

}  // namespace survival

// =============================================================================
// §P — ORE PATCHES: a deposit is a piece of GROUND, not a pebble on it.
//
// The survival layer above scatters individual boulders you swing at until they
// vanish. That reads as litter: a player cannot tell a resource from scenery,
// and there is nothing for a mining drill to stand ON. Factorio's answer, and
// Satisfactory's, is the same one: an ore body is an irregular AREA of ground
// holding one resource, whose richness varies across it, and machines are
// placed on top of it.
//
// THE MODEL, three numbers and a shape:
//   * a CENTRE direction on the body, its own tangent basis, and a nominal
//     radius in metres;
//   * a LOBED boundary, r(theta) = RadiusM * lobeShape(Shape, theta), three
//     hashed harmonics so the outline is irregular, closed, and smooth. A circle
//     reads as a decal; a lobe reads as ore;
//   * COVERAGE in (0,1] inside that outline, 1 at the centre falling to 0 at the
//     edge, which is BOTH the drill's rate multiplier and the tint the ground
//     is drawn with. One function, so what the player sees is what the machine
//     gets.
//
// ONE POOL. RemainingAmount is the patch's, and it is the only mutable field.
// Hand-mining an outcrop (gameplay.h §S.5) and a drill sitting on the patch draw
// from THAT number and nothing else. Two counters for one ore body is the
// five-surfaces failure wearing a different hat, and it shows up as a mountain
// that stands full for ever while its ore rides away on a belt.
//
// DETERMINISM is the §4.5 rule unchanged: everything except RemainingAmount is
// position-hashed from (bodySeed, dir), so the field is a pure function of the
// seed and only the depletion is a diff (WG-6, DW-17).
//
// TERRAIN. A patch is defined in DIRECTION space and carries no height opinion
// of its own beyond where its centre was snapped. Digging or levelling the
// ground moves the surface, never the ore body: the same column still holds the
// same patch. Callers re-snap what they draw through the surface oracle.
// =============================================================================
namespace patches {

// ---- Authored balance (DATA, GP-12: tune without touching code paths) -------
// Units of ore per square metre of patch, before the grade multiplier. A 9 m
// patch at grade 0.8 is then ~3,600 units: about twenty minutes of one drill,
// which is long enough to be a place you come back to.
static constexpr double kUnitsPerSquareMetreM2 = 16.0;
// Hand yields, passed to harvestNode so the tool rule is unchanged: the matching
// tool triples the pull, and bare hands ALWAYS work (no bootstrap deadlock —
// you cannot craft a drill before you have mined anything by hand).
static constexpr uint16_t kHandYieldBare = 3;
static constexpr uint16_t kHandYieldTool = 9;
// A drill's extraction rate at full richness, in units per second.
static constexpr double kDrillUnitsPerSec = 3.0;
// Patch radius range, metres. Small enough to walk across, big enough to hold a
// line of drills.
static constexpr double kMinRadiusM = 6.0;
static constexpr double kMaxRadiusM = 11.0;

// A single ore body: an area of ground, its resource, and its pool.
struct OrePatch {
  DepositId Id = 0;
  Vec3      Dir;                 // unit direction of the centre
  Vec3      Centre;              // body-frame metres, on the snapped surface
  Vec3      T1, T2;              // the patch's own tangent basis (azimuth 0 = T1)
  double    RadiusM = 0.0;       // nominal radius; the lobe modulates it
  ItemId    Resource = 0;        // OPAQUE gameplay item id (WG-11)
  uint8_t   Kind = 0;            // survival::NodeKind, for art selection only
  float     Grade = 0.0f;        // peak richness in (0,1]
  double    InitialAmount = 0.0;    // regenerates from seed — NOT saved
  double    RemainingAmount = 0.0;  // THE mutable depletion diff
  uint64_t  Shape = 0;           // drives the lobed outline
};

// The outline multiplier at azimuth `theta`. Three hashed harmonics, amplitudes
// 0.18 / 0.12 / 0.07, so the result lives in roughly [0.63, 1.37] and the
// boundary never doubles back on itself. Pure function of (Shape, theta).
inline double lobeShape(uint64_t shape, double theta) {
  const double kTau = 6.28318530717958647692;
  const double a2 = 0.18 * hashToSigned(hashCombine(shape, 2ull));
  const double p2 = kTau * hashToUnit(hashCombine(shape, 3ull));
  const double a3 = 0.12 * hashToSigned(hashCombine(shape, 5ull));
  const double p3 = kTau * hashToUnit(hashCombine(shape, 7ull));
  const double a5 = 0.07 * hashToSigned(hashCombine(shape, 11ull));
  const double p5 = kTau * hashToUnit(hashCombine(shape, 13ull));
  double f = 1.0 + a2 * std::cos(2.0 * theta + p2)
                 + a3 * std::cos(3.0 * theta + p3)
                 + a5 * std::cos(5.0 * theta + p5);
  if (f < 0.45) f = 0.45;   // belt and braces: the outline stays star-shaped
  return f;
}

// The boundary radius, in metres, at azimuth `theta`.
inline double lobeRadiusM(const OrePatch& p, double theta) {
  return p.RadiusM * lobeShape(p.Shape, theta);
}

// The patch-local tangent offset of a body-frame point: (along T1, along T2).
inline void localOffset(const OrePatch& p, const Vec3& pos, double& x, double& y) {
  const Vec3 v = pos - p.Centre;
  const Vec3 t = v - p.Dir * v.dot(p.Dir);   // drop the radial part
  x = t.dot(p.T1);
  y = t.dot(p.T2);
}

// COVERAGE: 0 outside the lobe, 1 at the centre, falling to 0 at the boundary.
// This one function is the drill's rate multiplier AND the ground tint, so what
// the player reads off the terrain is exactly what the machine is standing in.
inline double coverageAt(const OrePatch& p, const Vec3& pos) {
  double x = 0.0, y = 0.0;
  localOffset(p, pos, x, y);
  const double d = std::sqrt(x * x + y * y);
  if (d <= 0.0) return 1.0;
  const double r = lobeRadiusM(p, std::atan2(y, x));
  if (!(r > 0.0) || d >= r) return 0.0;
  const double u = d / r;
  return 1.0 - u * u;
}

// Richness = peak grade times coverage. Zero outside the patch.
inline double richnessAt(const OrePatch& p, const Vec3& pos) {
  return static_cast<double>(p.Grade) * coverageAt(p, pos);
}

inline bool contains(const OrePatch& p, const Vec3& pos) {
  return coverageAt(p, pos) > 0.0;
}

// The unit direction of a patch-local tangent offset, so a caller can turn
// (x, y) metres into something the surface oracle can be asked about.
inline Vec3 dirAtLocal(const OrePatch& p, double x, double y) {
  const double r0 = p.Centre.length();
  const Vec3 v = p.Dir * (r0 > 0.0 ? r0 : 1.0) + p.T1 * x + p.T2 * y;
  const double l = v.length();
  return (l > 0.0) ? Vec3(v.x / l, v.y / l, v.z / l) : p.Dir;
}

// EXTRACTION — the ONLY mutator. Grants up to RemainingAmount and clamps at 0.
// Sub-millimetre crumbs are snapped to empty for the same reason harvestNode
// rounds its last pull up: a patch reading 3.6e-7 is not a patch you can finish.
inline double extract(OrePatch& p, double requested) {
  if (requested <= 0.0) return 0.0;
  const double granted = std::min(requested, p.RemainingAmount);
  double left = p.RemainingAmount - granted;
  if (left < 1e-3) left = 0.0;
  p.RemainingAmount = left;
  return granted;
}

// ---- §P.2 — the disc sample: what a renderer draws the patch WITH ----------
// One vertex of the ground skin: a unit direction and the coverage there. The
// caller multiplies the direction by the surface oracle's radius, so the skin
// hugs whatever the ground currently is (including a levelled or dug patch) and
// this header keeps no height opinion.
struct DiscVertex { Vec3 Dir; double Coverage; };

// A (rings+1) x segs vertex grid over the patch: ring 0 is the centre point
// repeated, ring `rings` is the boundary. Row-major, ring by ring.
inline std::vector<DiscVertex> sampleDisc(const OrePatch& p, int rings, int segs) {
  std::vector<DiscVertex> out;
  if (rings < 1 || segs < 3) return out;
  const double kTau = 6.28318530717958647692;
  out.reserve(static_cast<size_t>(rings + 1) * static_cast<size_t>(segs));
  for (int r = 0; r <= rings; ++r) {
    const double f = static_cast<double>(r) / static_cast<double>(rings);
    for (int s = 0; s < segs; ++s) {
      const double th = kTau * static_cast<double>(s) / static_cast<double>(segs);
      const double rad = lobeRadiusM(p, th) * f;
      DiscVertex v;
      v.Dir = dirAtLocal(p, rad * std::cos(th), rad * std::sin(th));
      // The rim is pinned to exactly 0 so the skin fades out rather than
      // ending on a visible step; inside, it is the same 1 - u^2 the drill
      // rate reads.
      v.Coverage = 1.0 - f * f;
      out.push_back(v);
    }
  }
  return out;
}

// ---- §P.3 — outcrops: the part of the ore body that breaks the surface -----
// A patch is IN the ground, so something has to say it is there from a distance
// and give a hand a place to swing. Outcrops are position-hashed inside the
// lobe, denser and larger toward the rich centre, and sunk into the ground by a
// fraction of their own size so they read as rock breaking through rather than
// as boulders dropped on top.
struct Outcrop {
  Vec3   Dir;        // unit direction (snap it through the surface oracle)
  double Scale;      // art scale multiplier
  double SinkFrac;   // how much of the piece is buried, in (0,1)
  double Coverage;   // the patch coverage where it stands
};

// How many outcrops a patch carries: proportional to its area, bounded.
inline int outcropCount(const OrePatch& p) {
  int n = static_cast<int>(p.RadiusM * 1.1);
  if (n < 5) n = 5;
  if (n > 14) n = 14;
  return n;
}

inline Outcrop outcropAt(const OrePatch& p, int i) {
  const double kTau = 6.28318530717958647692;
  const uint64_t h = hashCombine(p.Id ^ 0x0C7C40Bull, static_cast<uint64_t>(i));
  // Golden-angle azimuth so a handful of pieces still spread evenly, plus a
  // hashed radial fraction biased inward (sqrt would spread them to the rim).
  const double th = 2.39996322972865332 * static_cast<double>(i)
                  + kTau * hashToUnit(hashCombine(h, 1ull));
  const double f = 0.12 + 0.74 * hashToUnit(hashCombine(h, 2ull));
  const double rad = lobeRadiusM(p, th) * f;
  Outcrop o;
  o.Dir = dirAtLocal(p, rad * std::cos(th), rad * std::sin(th));
  o.Coverage = 1.0 - f * f;
  o.Scale = 0.55 + 0.75 * o.Coverage + 0.25 * hashToUnit(hashCombine(h, 3ull));
  o.SinkFrac = 0.32 + 0.26 * hashToUnit(hashCombine(h, 4ull));
  return o;
}

// ---- §P.4 — the field: a deterministic patch layout around a centre --------
// Placement is done in METRES and converted to an angle through the body radius,
// unlike survival::LayoutTestArea whose angular jitter is 180 m at Forge scale
// and therefore unusable for anything a player walks across.
inline std::vector<OrePatch> LayoutPatchField(const BodyParams& body,
                                              uint64_t bodySeed,
                                              FrameId bodyFrame,
                                              const Vec3& centreDir,
                                              const std::vector<uint8_t>& kinds,
                                              double spreadM = 90.0,
                                              const SnapHeightFn& snapH = nullptr) {
  std::vector<OrePatch> out;
  const int n = static_cast<int>(kinds.size());
  if (n <= 0) return out;
  out.reserve(kinds.size());

  const double clen = centreDir.length();
  const Vec3 c = (clen > 0.0) ? Vec3(centreDir.x / clen, centreDir.y / clen,
                                     centreDir.z / clen)
                              : Vec3(0, 1, 0);
  Vec3 up = (std::fabs(c.y) < 0.99) ? Vec3(0, 1, 0) : Vec3(1, 0, 0);
  Vec3 e1(up.y * c.z - up.z * c.y, up.z * c.x - up.x * c.z,
          up.x * c.y - up.y * c.x);
  const double e1l = e1.length();
  e1 = (e1l > 0.0) ? Vec3(e1.x / e1l, e1.y / e1l, e1.z / e1l) : Vec3(1, 0, 0);
  const Vec3 e2(c.y * e1.z - c.z * e1.y, c.z * e1.x - c.x * e1.z,
                c.x * e1.y - c.y * e1.x);
  const double r0 = body.radiusM;

  for (int i = 0; i < n; ++i) {
    // Golden-angle spiral in the tangent plane: even coverage, no lattice look.
    const uint64_t hi = hashCombine(mix64(bodySeed ^ 0x0DEB05ull),
                                    static_cast<uint64_t>(i));
    const double ang = 2.39996322972865332 * static_cast<double>(i)
                     + 0.7 * hashToUnit(hashCombine(hi, 1ull));
    const double rad = 22.0 + spreadM
        * std::sqrt((static_cast<double>(i) + 0.5) / static_cast<double>(n))
        + 6.0 * hashToUnit(hashCombine(hi, 2ull));
    const Vec3 v = c * r0 + e1 * (std::cos(ang) * rad) + e2 * (std::sin(ang) * rad);
    const double vl = v.length();
    const Vec3 dir(v.x / vl, v.y / vl, v.z / vl);

    OrePatch p;
    p.Dir = dir;
    // The patch's OWN basis, derived from its own direction, so coverage is a
    // pure function of the patch and not of whoever laid the field out.
    Vec3 pu = (std::fabs(dir.y) < 0.99) ? Vec3(0, 1, 0) : Vec3(1, 0, 0);
    Vec3 t1(pu.y * dir.z - pu.z * dir.y, pu.z * dir.x - pu.x * dir.z,
            pu.x * dir.y - pu.y * dir.x);
    const double t1l = t1.length();
    p.T1 = (t1l > 0.0) ? Vec3(t1.x / t1l, t1.y / t1l, t1.z / t1l) : Vec3(1, 0, 0);
    p.T2 = Vec3(dir.y * p.T1.z - dir.z * p.T1.y, dir.z * p.T1.x - dir.x * p.T1.z,
                dir.x * p.T1.y - dir.y * p.T1.x);

    const double h = snapH ? snapH(dir) : sampleHeightField(body, dir);
    p.Centre = dir * (body.radiusM + h);
    p.Kind = kinds[static_cast<size_t>(i)];
    p.Resource = survival::resourceOf(static_cast<survival::NodeKind>(p.Kind));
    p.Grade = static_cast<float>(
        0.45 + 0.55 * hashToUnit(hashPos(bodySeed, dir, 0x0A5E11u)));
    p.RadiusM = kMinRadiusM + (kMaxRadiusM - kMinRadiusM)
        * hashToUnit(hashPos(bodySeed, dir, 0x0BADA55u));
    p.Shape = hashPos(bodySeed, dir, 0x510BEu);
    const double kPi = 3.14159265358979323846;
    p.InitialAmount = kUnitsPerSquareMetreM2 * kPi * p.RadiusM * p.RadiusM
                    * static_cast<double>(p.Grade);
    p.RemainingAmount = p.InitialAmount;
    uint64_t id = mix64(bodySeed ^ 0x0A7C4Eull);
    id = hashCombine(id, static_cast<uint64_t>(p.Kind));
    id = hashCombine(id, static_cast<uint64_t>(i));
    p.Id = id;
    (void)bodyFrame;
    out.push_back(p);
  }
  return out;
}

// The patch containing `pos`, or -1. Ties break on the richer one, because two
// overlapping bodies should hand a drill the better ground.
inline int findPatch(const std::vector<OrePatch>& field, const Vec3& pos) {
  int best = -1;
  double bestCover = 0.0;
  for (size_t i = 0; i < field.size(); ++i) {
    const double c = coverageAt(field[i], pos);
    if (c > bestCover) { bestCover = c; best = static_cast<int>(i); }
  }
  return best;
}

}  // namespace patches

}  // namespace worldgen
}  // namespace of
