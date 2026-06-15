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

// Generate the full deposit catalog for one body. DETERMINISTIC from
// (bodySeed, body): same inputs -> identical vector (ids, positions, resources,
// amounts) bitwise; a different seed -> a different catalog.
inline std::vector<FDepositNode> GenerateDeposits(const BodyParams& body,
                                                  uint64_t bodySeed,
                                                  FrameId bodyFrame) {
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

    // Snap to the surface: the SAME sampleHeightField the mesh uses (so the node
    // sits exactly on the terrain at its dir — within float error of the mesh).
    const double h = sampleHeightField(body, dir);
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
                                FrameId bodyFrame) {
    return DepositCatalog(GenerateDeposits(body, bodySeed, bodyFrame));
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

}  // namespace worldgen
}  // namespace of
