#pragma once
// =============================================================================
// terrain_deform.h — headless TERRAIN-DEFORMATION layer (Valheim-style digging).
//
// The deterministic, persistable edit layer that lets the player's pickaxe and
// automated miners LOWER / REMOVE terrain — dig holes and sink mine shafts — on
// top of the otherwise pure-procedural cubed-sphere surface. It is the headless
// foundation the UE digging/mining + collision layer binds to:
//
//   * EDIT STORE — a sparse map from a QUANTIZED surface cell (a fine angular
//     lattice on the cubed sphere, a stable integer (face, ix, iy) cell id) to an
//     accumulated LOWERING in metres (how much terrain has been removed there).
//     Fine enough (kDeformLevel) that a pickaxe dig and a drill shaft read as
//     real holes in the mesh + collision.
//   * DEFORMED SAMPLER — deformedHeight(body, dir, deform) = baseDesignedHeight −
//     edit(cell), CLAMPED so you can never dig below base − maxDigDepthM. Where
//     there is no edit it returns the base height BIT-IDENTICALLY (no regression
//     to the existing procedural terrain). terrain_stream + UE collision sample
//     this so holes appear in mesh AND collision.
//   * DIG BRUSH (pickaxe / terraform) — digBrush(centerDir, radiusM, amountM):
//     lowers cells within the radius by `amount` with a SOFT FALLOFF toward the
//     edge (natural-looking holes), clamped to max depth; returns the volume-ish
//     lowering actually removed (0 at bedrock).
//   * DRILL COLUMN (automated miner) — drillStep(centerDir, columnRadiusM,
//     depthPerStepM): progressively deepens a narrow column (a shaft) toward max
//     depth over many calls; query the current shaft depth + whether it bottomed.
//   * QUERIES the UE/gameplay layer needs — editAt(cell), depthDugAt(dir),
//     atBedrock(dir, maxDepth), and editedCellsInQuad(key) (the set of edited
//     cells overlapping a cube quad/chunk, so the renderer knows which chunks to
//     re-mesh).
//   * PERSISTENCE — serialize/deserialize the edit map in persistence.h's style
//     (SaveWriter/SaveReader-compatible put/get): the player's terraforming saved
//     as a compact diff over the procedural base.
//
// DETERMINISM: edits are EXPLICIT ops (not procedural). The same op sequence
// yields the same edit map → the same deformed heights, bit-for-bit, on any
// machine. The undeformed path is bit-identical to sampleDesignedHeight: a cell
// with no edit contributes exactly 0.0, so deformedHeight == base verbatim.
//
// ADDITIVE / NON-DESTRUCTIVE: sampleHeightField / sampleDesignedHeight
// (cubed_sphere.h / biome.h) are left BIT-FOR-BIT UNCHANGED. The deform layer is
// a pure subtraction on TOP, opted into by callers (terrain_stream / collision).
//
// Header-only C++17. Consumes cubed_sphere.h + biome.h READ-ONLY. No UE, no
// rendering, no physics — the isolation harness the UE dig/mine layer mirrors.
// =============================================================================
#include <cstdint>
#include <cmath>
#include <map>
#include <vector>
#include <algorithm>

#include "of/vec3.h"
#include "of/cubed_sphere.h"
#include "of/biome.h"

namespace of {
namespace worldgen {

// =============================================================================
// §1 — The deform CELL lattice (quantization).
//
// A deform cell is a fixed-resolution angular cell on the cubed sphere, named by
// its canonical (faceId, ix, iy) integer lattice point at a deep, fixed level
// kDeformLevel (reusing the SAME lattice machinery as the mesh — latticeCoord /
// unitDir / faceOfDir — so a dig cell aligns with the procedural grid and a quad
// region maps cleanly to a contiguous block of deform cells).
//
// The cell id is the bit-stable packing (faceId<<58) | (ix<<29) | iy, an integer
// key for the sparse edit map. At kDeformLevel = 18 on a 600 km planet the cell
// pitch is ~2*pi*R / 4 / 2^18 ≈ 3.6 m — fine enough that a pickaxe hole and a
// drill shaft each touch a handful of cells (sub-metre after warp near corners).
// =============================================================================

// Lattice level of the deform grid (cells per cube-face side = 2^kDeformLevel).
static constexpr int kDeformLevel = 18;

// Cell-id packing: 6-bit faceId (0..5) + two 29-bit lattice indices.
// 29 bits covers ix,iy in [0, 2^kDeformLevel] for any kDeformLevel <= 28.
static constexpr int kDeformIndexBits = 29;
static constexpr uint64_t kDeformIndexMask = (uint64_t(1) << kDeformIndexBits) - 1;

// A quantized surface cell on the deform lattice.
struct DeformCell {
  int      faceId = 0;
  uint32_t ix = 0;   // lattice column in [0, 2^kDeformLevel]
  uint32_t iy = 0;   // lattice row
  bool operator==(const DeformCell& o) const {
    return faceId == o.faceId && ix == o.ix && iy == o.iy;
  }
};

// Pack a cell into a stable 64-bit id (the sparse-map key).
inline uint64_t deformCellId(const DeformCell& c) {
  return (static_cast<uint64_t>(c.faceId) << (2 * kDeformIndexBits)) |
         (static_cast<uint64_t>(c.ix) << kDeformIndexBits) |
         static_cast<uint64_t>(c.iy);
}
inline DeformCell deformCellFromId(uint64_t id) {
  DeformCell c;
  c.iy = static_cast<uint32_t>(id & kDeformIndexMask);
  c.ix = static_cast<uint32_t>((id >> kDeformIndexBits) & kDeformIndexMask);
  c.faceId = static_cast<int>(id >> (2 * kDeformIndexBits));
  return c;
}

// Inverse of cubed_sphere::warp (s -> tan(s*pi/4)): unwarp(w) = atan(w)*4/pi.
// (Mirrors surface_walk.h's unwarp — the face (u,v) of a direction.)
inline double deformUnwarp(double w) {
  return std::atan(w) * (4.0 / 3.14159265358979323846);
}

// Map a unit direction to its canonical deform cell (face + nearest lattice
// point). PURE function of the dir + kDeformLevel — deterministic, seam-stable
// (canonical face via faceOfDir so a dir on a cube edge resolves identically).
inline DeformCell cellForDir(const Vec3& dir) {
  const int faceId = faceOfDir(dir);
  const FaceBasis& b = faceBasis(faceId);
  const double dn = dir.dot(b.normal);
  const double dr = dir.dot(b.right);
  const double du = dir.dot(b.up);
  const double wu = (std::fabs(dn) > 1e-12) ? dr / dn : 0.0;   // warped u
  const double wv = (std::fabs(dn) > 1e-12) ? du / dn : 0.0;   // warped v
  const double u = deformUnwarp(wu);                            // face (u,v) [-1,1]
  const double v = deformUnwarp(wv);
  const double denom = static_cast<double>(uint64_t(1) << kDeformLevel);  // 2^L
  auto toIdx = [&](double s) -> uint32_t {
    double t = (s + 1.0) * 0.5 * denom + 0.5;  // round to nearest lattice point
    if (t < 0.0) t = 0.0;
    if (t > denom) t = denom;
    return static_cast<uint32_t>(t);
  };
  DeformCell c;
  c.faceId = faceId;
  c.ix = toIdx(u);
  c.iy = toIdx(v);
  return c;
}

// The unit direction at a deform cell's CENTRE (its lattice point). Routes
// through latticeDir so it is bit-identical to any other caller naming the cell.
inline Vec3 dirForCell(const DeformCell& c) {
  return latticeDir(c.faceId, c.ix, c.iy, kDeformLevel);
}

// Approximate world-space pitch of one deform cell (metres) at the body scale —
// the cube-face span is 2 over 2^L lattice steps, scaled to a great-circle.
// Used to convert a brush RADIUS in metres into a lattice-index half-width.
inline double deformCellPitchM(const BodyParams& body) {
  // Face spans a quarter great circle (~pi/2 * R) across 2^L cells (warp makes
  // this near-uniform). Quarter-circumference / cellsPerSide.
  const double quarter = 1.57079632679489661923 * body.radiusM;  // (pi/2) R
  const double cellsPerSide = static_cast<double>(uint64_t(1) << kDeformLevel);
  return quarter / cellsPerSide;
}

// =============================================================================
// §2 — TerrainDeform: the sparse edit store + the dig/drill ops + queries.
//
// Holds a sparse map cellId -> lowering metres (accumulated removed terrain).
// maxDigDepthM is the DEEP bedrock floor (default 80 m): no cell can be lowered
// past base − maxDigDepthM. Configurable per body / per save.
// =============================================================================

// Default maximum dig depth (metres below the base surface = bedrock). DEEP, so
// shafts and pits reach meaningfully far down before hitting bedrock.
static constexpr double kDefaultMaxDigDepthM = 80.0;

class TerrainDeform {
 public:
  TerrainDeform() = default;
  explicit TerrainDeform(double maxDigDepthM) : maxDigDepthM_(maxDigDepthM) {}

  // ---- config --------------------------------------------------------------
  double maxDigDepth() const { return maxDigDepthM_; }
  void setMaxDigDepth(double m) { maxDigDepthM_ = m; }

  // ---- raw edit-store access (the UE/gameplay layer binds to these) --------

  // Accumulated lowering (metres) at a cell id; 0 if the cell is unedited.
  double editAt(uint64_t cellId) const {
    auto it = edits_.find(cellId);
    return (it != edits_.end()) ? it->second : 0.0;
  }
  // Accumulated lowering at a cell.
  double editAt(const DeformCell& c) const { return editAt(deformCellId(c)); }

  // Number of edited cells (sparse footprint of the terraforming diff).
  size_t editedCount() const { return edits_.size(); }
  bool empty() const { return edits_.empty(); }

  // The whole sparse map (cellId -> lowering metres). For persistence / debug.
  const std::map<uint64_t, double>& edits() const { return edits_; }

  // Directly set a cell's lowering (clamped to [0, maxDigDepth]). 0 erases it so
  // the undeformed path stays bit-identical (no zero-valued entries lingering).
  void setEdit(uint64_t cellId, double loweringM) {
    if (loweringM <= 0.0) {
      edits_.erase(cellId);
      return;
    }
    if (loweringM > maxDigDepthM_) loweringM = maxDigDepthM_;
    edits_[cellId] = loweringM;
  }

  // ---- the DEFORMED sampler ------------------------------------------------

  // Lowering (metres) currently removed at a direction (the edit at its cell).
  double depthDugAt(const Vec3& dir) const { return editAt(cellForDir(dir)); }

  // At bedrock under `dir`? (dug down to (or past) the depth limit.)
  // `maxDepth` lets a caller test against a depth other than this store's floor
  // (e.g. a per-tool reach); defaults to the store's maxDigDepth.
  bool atBedrock(const Vec3& dir) const {
    return depthDugAt(dir) >= maxDigDepthM_ - 1e-9;
  }
  bool atBedrock(const Vec3& dir, double maxDepth) const {
    return depthDugAt(dir) >= maxDepth - 1e-9;
  }

  // ---- DIG BRUSH (pickaxe / terraform) -------------------------------------
  //
  // Lower every deform cell within `radiusM` of `centerDir` by up to `amountM`,
  // with a SOFT FALLOFF: full `amountM` at the centre, easing to 0 at the rim
  // (smooth (1 - t^2) profile) so the hole has natural sloped walls. Each cell is
  // clamped to maxDigDepth (bedrock). Returns the TOTAL lowering actually applied
  // across all cells (0 once everything in reach is already at bedrock).
  double digBrush(const BodyParams& body, const Vec3& centerDir, double radiusM,
                  double amountM) {
    if (amountM <= 0.0 || radiusM <= 0.0) return 0.0;
    double removed = 0.0;
    forCellsInRadius(body, centerDir, radiusM, [&](const DeformCell& c,
                                                   double distM) {
      // Soft falloff: full at centre, 0 at rim (smooth quadratic).
      const double t = distM / radiusM;            // 0..1
      const double fall = (t >= 1.0) ? 0.0 : (1.0 - t * t);
      const double want = amountM * fall;
      if (want <= 0.0) return;
      const uint64_t id = deformCellId(c);
      const double cur = editAt(id);
      double next = cur + want;
      if (next > maxDigDepthM_) next = maxDigDepthM_;
      const double applied = next - cur;
      if (applied > 0.0) {
        edits_[id] = next;
        removed += applied;
      }
    });
    return removed;
  }
  // Convenience: brush at a lat/lon.
  double digBrushLatLon(const BodyParams& body, double lat, double lon,
                        double radiusM, double amountM) {
    return digBrush(body, latLonToDir(lat, lon), radiusM, amountM);
  }

  // ---- DRILL COLUMN (automated miner shaft) --------------------------------
  //
  // Progressively deepen a NARROW column at `centerDir` by `depthPerStepM` this
  // call (a single miner tick). The column is the cells within `columnRadiusM`
  // (flat profile — a clean vertical shaft, no falloff), all advanced together
  // toward bedrock. Returns the lowering actually applied this step (0 once the
  // shaft has bottomed out at maxDigDepth). Call repeatedly to sink the shaft.
  double drillStep(const BodyParams& body, const Vec3& centerDir,
                   double columnRadiusM, double depthPerStepM) {
    if (depthPerStepM <= 0.0 || columnRadiusM <= 0.0) return 0.0;
    double removed = 0.0;
    forCellsInRadius(body, centerDir, columnRadiusM, [&](const DeformCell& c,
                                                         double /*distM*/) {
      const uint64_t id = deformCellId(c);
      const double cur = editAt(id);
      double next = cur + depthPerStepM;           // flat column (no falloff)
      if (next > maxDigDepthM_) next = maxDigDepthM_;
      const double applied = next - cur;
      if (applied > 0.0) {
        edits_[id] = next;
        removed += applied;
      }
    });
    return removed;
  }

  // Current depth of the shaft at a drill site (the deepest cell at its centre).
  double shaftDepthAt(const Vec3& centerDir) const { return depthDugAt(centerDir); }
  // Has the shaft at `centerDir` bottomed out (reached bedrock)?
  bool shaftBottomedOut(const Vec3& centerDir) const { return atBedrock(centerDir); }

  // ---- region query: edited cells overlapping a cube quad / chunk ----------
  //
  // The renderer asks "which deform cells fall inside this quad?" so it knows
  // which resident chunks to RE-MESH after a dig. We answer by the quad's angular
  // footprint (centre dir + centre-to-corner half-angle, padded by marginRad):
  // an edited cell is "in" if its centre dir lies within that cone. Cheap
  // angular containment over the sparse edit set (only edited cells are tested).
  std::vector<uint64_t> editedCellsInQuad(const FQuadKey& key,
                                          double marginRad = 0.0) const {
    const Vec3 c = quadCenterDirLocal(key);
    const double halfAngle = quadAngularRadiusLocal(key) + marginRad;
    const double cosThresh =
        std::cos(std::min(3.14159265358979323846, halfAngle));
    std::vector<uint64_t> hits;
    for (const auto& kv : edits_) {
      const Vec3 cd = dirForCell(deformCellFromId(kv.first));
      if (cd.dot(c) >= cosThresh) hits.push_back(kv.first);
    }
    return hits;
  }
  // Does this quad overlap ANY edit? (cheap "needs re-mesh?" predicate.)
  bool quadHasEdits(const FQuadKey& key, double marginRad = 0.0) const {
    const Vec3 c = quadCenterDirLocal(key);
    const double halfAngle = quadAngularRadiusLocal(key) + marginRad;
    const double cosThresh =
        std::cos(std::min(3.14159265358979323846, halfAngle));
    for (const auto& kv : edits_) {
      const Vec3 cd = dirForCell(deformCellFromId(kv.first));
      if (cd.dot(c) >= cosThresh) return true;
    }
    return false;
  }

  // ---- persistence (the player's terraforming as a compact diff) -----------
  //
  // Templated over the SaveWriter / SaveReader cursors (persistence.h §1 style)
  // WITHOUT depending on persistence.h, so this layer stays leaf. The writer
  // needs varint(uint64)/u64(uint64)/f64(double); the reader the inverses.
  // Format: [varint maxDigDepthBits? no — f64 maxDigDepth][varint count]
  //         repeat count: [varint cellId][f64 loweringM].
  template <typename Writer>
  void serialize(Writer& w) const {
    w.f64(maxDigDepthM_);
    w.varint(edits_.size());
    for (const auto& kv : edits_) {
      w.varint(kv.first);
      w.f64(kv.second);
    }
  }
  template <typename Reader>
  void deserialize(Reader& r) {
    edits_.clear();
    maxDigDepthM_ = r.f64();
    const uint64_t n = r.varint();
    for (uint64_t i = 0; i < n; ++i) {
      const uint64_t id = r.varint();
      const double lowering = r.f64();
      // Only keep meaningful, clamped edits (defends the bit-identical undug path).
      if (lowering > 0.0) {
        edits_[id] = (lowering > maxDigDepthM_) ? maxDigDepthM_ : lowering;
      }
    }
  }

 private:
  // Visit every deform cell whose CENTRE lies within `radiusM` (great-circle) of
  // `centerDir`, invoking fn(cell, distM). We scan a lattice-index window sized
  // from the cell pitch (cheap, exact enough; the rim falloff zeroes overreach).
  template <typename Fn>
  void forCellsInRadius(const BodyParams& body, const Vec3& centerDir,
                        double radiusM, Fn&& fn) const {
    const DeformCell center = cellForDir(centerDir);
    const double pitch = deformCellPitchM(body);
    // Index half-width covering the radius (+1 guard ring for warp non-uniformity).
    int half = static_cast<int>(std::ceil(radiusM / std::max(pitch, 1e-6))) + 1;
    if (half < 0) half = 0;
    const int64_t maxIdx = static_cast<int64_t>(uint64_t(1) << kDeformLevel);
    // Unit center for great-circle distance (centerDir need not be unit-exact).
    const double cl = centerDir.length();
    const Vec3 cu = (cl > 0.0) ? Vec3(centerDir.x / cl, centerDir.y / cl,
                                      centerDir.z / cl)
                               : Vec3(0, 1, 0);
    for (int dy = -half; dy <= half; ++dy) {
      for (int dx = -half; dx <= half; ++dx) {
        const int64_t ix = static_cast<int64_t>(center.ix) + dx;
        const int64_t iy = static_cast<int64_t>(center.iy) + dy;
        if (ix < 0 || iy < 0 || ix > maxIdx || iy > maxIdx) continue;  // off-face
        DeformCell c{center.faceId, static_cast<uint32_t>(ix),
                     static_cast<uint32_t>(iy)};
        const Vec3 cd = dirForCell(c);
        // Great-circle distance centre->cell (metres) on the body surface.
        double dot = cu.dot(cd);
        if (dot > 1.0) dot = 1.0;
        if (dot < -1.0) dot = -1.0;
        const double distM = std::acos(dot) * body.radiusM;
        if (distM <= radiusM) fn(c, distM);
      }
    }
  }

  // Quad centre dir (mirrors terrain_stream's quadCenterDir without a hard dep).
  static Vec3 quadCenterDirLocal(const FQuadKey& k) {
    const double denom = static_cast<double>(uint64_t(1) << k.depth);
    const double u = -1.0 + 2.0 * (static_cast<double>(k.qx) + 0.5) / denom;
    const double v = -1.0 + 2.0 * (static_cast<double>(k.qy) + 0.5) / denom;
    return unitDir(k.faceId, u, v);
  }
  // Half-angle from the quad centre to a corner (the quad's angular radius).
  static double quadAngularRadiusLocal(const FQuadKey& k) {
    const double denom = static_cast<double>(uint64_t(1) << k.depth);
    const double u0 = -1.0 + 2.0 * (static_cast<double>(k.qx)) / denom;
    const double v0 = -1.0 + 2.0 * (static_cast<double>(k.qy)) / denom;
    const Vec3 ctr = quadCenterDirLocal(k);
    const Vec3 corner = unitDir(k.faceId, u0, v0);
    double d = ctr.dot(corner);
    if (d > 1.0) d = 1.0;
    if (d < -1.0) d = -1.0;
    return std::acos(d);
  }

  std::map<uint64_t, double> edits_;            // cellId -> lowering metres
  double maxDigDepthM_ = kDefaultMaxDigDepthM;  // bedrock floor below base
};

// =============================================================================
// §3 — The DEFORMED-HEIGHT samplers (the surface the mesh + collision read).
//
// deformedHeight = sampleDesignedHeight(base) − edit(cell), clamped so the
// result never drops below base − maxDigDepth. Where the cell is unedited the
// subtraction is exactly 0.0, so the returned bits are IDENTICAL to the
// undeformed sampleDesignedHeight — no regression to existing terrain.
// =============================================================================

// Deformed designed-terrain height (metres relief) at a direction.
inline double deformedHeight(const BodyParams& body, const Vec3& dir,
                             const TerrainDeform& deform) {
  const double base = sampleDesignedHeight(body, dir);   // unchanged, additive
  const double lowering = deform.depthDugAt(dir);        // 0 where unedited
  if (lowering <= 0.0) return base;                      // bit-identical path
  double dug = base - lowering;
  const double floorH = base - deform.maxDigDepth();     // bedrock under this dir
  if (dug < floorH) dug = floorH;                        // clamp to bedrock
  return dug;
}

// Deformed height at a geo coord (mirrors SampleDesignedTerrainHeight, deformed).
inline double DeformedTerrainHeight(const BodyParams& body, double lat,
                                    double lon, const TerrainDeform& deform) {
  return deformedHeight(body, latLonToDir(lat, lon), deform);
}

}  // namespace worldgen
}  // namespace of
