#pragma once
// =============================================================================
// voxel_field.h — the SIGNED DENSITY FIELD that replaces binary occupancy (WG-24).
//
// WHY THIS EXISTS. Three separate user complaints had ONE cause:
//   1. "the way the ground breaks when you dig is kinda fucky ... all these
//      sharp edges" — because the mesher drew whole 1 m cubes.
//   2. "Q still makes the ground more rough not flat" — because a whole-cell
//      edit can only put a cell's surface at a lattice plane, so a pad cut by a
//      non-axis-aligned target plane terminates on a staircase (WG-22/WG-23
//      measured 0.973 m of residual step over a 4 m span against a 0.25 m
//      perceptual threshold).
//   3. DW-33: ordinary ground spreads 1.01 m under a 4 m structural module and
//      every cell at the default spawn refused a foundation.
// All three are the same sentence: a binary lattice cannot represent a surface
// that does not lie on the lattice. The answer is not a finer lattice (that is
// eight times the memory for one bit of precision); it is to stop storing a BIT
// and start storing a DISTANCE.
//
// THE MODEL.
//   * The field is sampled at integer CORNERS of the same 1 m lattice, not at
//     cell centres. Corner (i,j,k) sits at body-frame (i,j,k) metres.
//   * density(corner) > 0 means rock, < 0 means air, and the magnitude is
//     roughly metres to the surface. The PROCEDURAL value is
//         procDensity(p) = surfaceRadiusAt(dir(p)) − |p|
//     which is already smooth and continuous everywhere: along a radial it is
//     EXACTLY a signed distance (d/dr = −1). Nothing had to be invented for the
//     untouched planet; the old code was throwing this away by comparing it to
//     zero and keeping only the sign.
//   * An EDIT stores a sparse per-corner override. Ops are SDF CSG:
//       dig(c, r)  : d <- min(d, |p−c| − r)     (subtract a sphere)
//       fill(c, r) : d <- max(d, r − |p−c|)     (union a sphere)
//       level(...) : d <- targetR − |p|          (assign a plane, inside a disc)
//     A dig therefore leaves a genuinely round crater and a level leaves a
//     genuinely flat plane, both to sub-millimetre, because the surface is the
//     zero level of an interpolated field rather than a set of cell faces.
//   * ANY point's density is the TRILINEAR interpolation of its cell's eight
//     corners. That interpolation is THE authority: the mesher, collision, the
//     aim ray and the column height query all read the same interpolated field,
//     so they cannot disagree about where the surface is (standing rule 1).
//
// WHAT THIS BUYS, stated as bounds rather than adjectives (see §6 and the DW-26
// re-derivation in test_voxel_field.cpp):
//   * A levelled pad is flat to the field's own interpolation error, not to a
//     cell. The plane targetR − |p| is linear in p along any lattice edge, so
//     trilinear interpolation reproduces it EXACTLY and the extracted surface is
//     planar to floating point.
//   * The drawn surface and the collided surface are the same zero level, so the
//     DW-26 disagreement stops being half a cell diagonal (0.866 m, the worst
//     case of a binary lattice) and becomes the curvature-driven interpolation
//     error of a smooth field over one cell, which is centimetres.
//
// DETERMINISM (WG-6, standing rule 4). procDensity is a pure function of
// (body, p) through sampleDesignedHeight. Overrides are explicit ops evaluated
// in a fixed lattice order. Interpolation is IEEE double arithmetic in a fixed
// order. Same inputs, same bits, on any machine that agrees on the noise stack.
//
// Header-only C++17. Consumes cubed_sphere.h + biome.h + voxel_terrain.h
// READ-ONLY (voxel_terrain.h for the shared lattice: kVoxelSizeM, VoxelCell,
// voxelCellId, cellForPos, unitOf, surfaceRadiusAt). No engine, no rendering.
// The mesher lives next door in surface_nets.h so each file stays small.
// =============================================================================
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <unordered_map>
#include <unordered_set>
#include <vector>

#include "of/vec3.h"
#include "of/cubed_sphere.h"
#include "of/biome.h"
#include "of/voxel_terrain.h"

namespace of {
namespace worldgen {

// =============================================================================
// §1 — The CORNER lattice.
//
// Same 1 m spacing as the cell lattice, offset by half a cell: a corner sits at
// integer metres, a cell centre at half-integers. We reuse VoxelCell as the
// index type and voxelCellId as the key, because the packing is the same and
// the two live in different maps.
// =============================================================================

/** Body-frame position of a lattice CORNER (integer metres). */
inline Vec3 cornerPos(const VoxelCell& c) {
  return Vec3(static_cast<double>(c.cx) * kVoxelSizeM,
              static_cast<double>(c.cy) * kVoxelSizeM,
              static_cast<double>(c.cz) * kVoxelSizeM);
}

/** The corner at or below a body-frame position on every axis. */
inline VoxelCell cornerForPos(const Vec3& p) {
  VoxelCell c;
  c.cx = static_cast<int32_t>(std::floor(p.x / kVoxelSizeM));
  c.cy = static_cast<int32_t>(std::floor(p.y / kVoxelSizeM));
  c.cz = static_cast<int32_t>(std::floor(p.z / kVoxelSizeM));
  return c;
}

/**
 * PROCEDURAL density at an arbitrary body-frame point: metres of rock above the
 * point, negative in air. Positive inside the planet.
 *
 * This is the whole reason the change is cheap: the untouched world already had
 * a smooth signed field and the old code reduced it to one bit per cell.
 */
inline double procDensityAt(const BodyParams& body, const Vec3& p) {
  const double r = p.length();
  if (r <= 0.0) return body.radiusM;          // dead centre: deep rock
  return surfaceRadiusAt(body, p) - r;        // surfaceRadiusAt normalizes p
}

// =============================================================================
// §2 — DensityField: the sparse override store + the interpolated authority.
// =============================================================================
class DensityField {
 public:
  DensityField() = default;

  // ---- the authority: one interpolated field everything reads --------------

  /** Density at a lattice corner: the override if one exists, else procedural. */
  double cornerDensity(const BodyParams& body, const VoxelCell& c) const {
    if (!ov_.empty()) {
      const auto it = ov_.find(voxelCellId(c));
      if (it != ov_.end()) return static_cast<double>(it->second);
    }
    return procCorner(body, c);
  }

  /**
   * Density at ANY body-frame point, trilinear over the containing cell's eight
   * corners. THIS is the surface authority: the mesher extracts its zero level,
   * collision tests its sign, the aim ray marches it, and the column query in
   * §5 root-finds it. One function, so they cannot disagree.
   */
  double densityAt(const BodyParams& body, const Vec3& p) const {
    const VoxelCell c0 = cornerForPos(p);
    const double tx = p.x / kVoxelSizeM - static_cast<double>(c0.cx);
    const double ty = p.y / kVoxelSizeM - static_cast<double>(c0.cy);
    const double tz = p.z / kVoxelSizeM - static_cast<double>(c0.cz);
    double d[8];
    for (int i = 0; i < 8; ++i) {
      const VoxelCell c{c0.cx + (i & 1), c0.cy + ((i >> 1) & 1),
                        c0.cz + ((i >> 2) & 1)};
      d[i] = cornerDensity(body, c);
    }
    const double x00 = d[0] + (d[1] - d[0]) * tx;
    const double x10 = d[2] + (d[3] - d[2]) * tx;
    const double x01 = d[4] + (d[5] - d[4]) * tx;
    const double x11 = d[6] + (d[7] - d[6]) * tx;
    const double y0 = x00 + (x10 - x00) * ty;
    const double y1 = x01 + (x11 - x01) * ty;
    return y0 + (y1 - y0) * tz;
  }

  /** Solid at a point: the sign of the ONE interpolated field. */
  bool solidAt(const BodyParams& body, const Vec3& p) const {
    return densityAt(body, p) >= 0.0;
  }

  /** Solid CELL: the interpolated field at the cell's own centre. Kept because
   *  region iteration, harvest counting and the persistence diff are all
   *  cell-shaped; it is a QUANTISED VIEW of the field above, never a second
   *  authority. The bound between the two is asserted (DW-26). */
  bool solidCell(const BodyParams& body, const VoxelCell& c) const {
    return densityAt(body, cellCenter(c)) >= 0.0;
  }

  /** Surface NORMAL at a point: the normalized gradient of the field, by central
   *  difference over half a cell. Points OUT of the rock (density decreases
   *  outward, so the outward normal is the negated gradient). */
  Vec3 normalAt(const BodyParams& body, const Vec3& p) const {
    const double h = 0.5 * kVoxelSizeM;
    const double gx = densityAt(body, Vec3(p.x + h, p.y, p.z)) -
                      densityAt(body, Vec3(p.x - h, p.y, p.z));
    const double gy = densityAt(body, Vec3(p.x, p.y + h, p.z)) -
                      densityAt(body, Vec3(p.x, p.y - h, p.z));
    const double gz = densityAt(body, Vec3(p.x, p.y, p.z + h)) -
                      densityAt(body, Vec3(p.x, p.y, p.z - h));
    const Vec3 g(-gx, -gy, -gz);
    const double l = g.length();
    if (l <= 1e-12) return unitOf(p);          // degenerate: fall back to up
    return Vec3(g.x / l, g.y / l, g.z / l);
  }

  // ---- edit ops (SDF CSG) --------------------------------------------------

  /** Override one corner, keeping the brick index and the counters in step.
   *  Returns true if the stored value changed. */
  bool setCorner(const BodyParams& body, const VoxelCell& c, double d) {
    const uint64_t id = voxelCellId(c);
    const float fv = static_cast<float>(d);
    const auto it = ov_.find(id);
    if (it != ov_.end()) {
      if (it->second == fv) return false;
      it->second = fv;
      return true;
    }
    // Storing a value equal to the procedural one is pure save bloat.
    if (std::fabs(d - procCorner(body, c)) <= kNoopEpsM) return false;
    ov_.emplace(id, fv);
    if (fv < 0.0f) ++airCount_;
    if (ov_.size() == 1) {
      aabbMin_ = aabbMax_ = c;
    } else {
      aabbMin_.cx = std::min(aabbMin_.cx, c.cx);
      aabbMin_.cy = std::min(aabbMin_.cy, c.cy);
      aabbMin_.cz = std::min(aabbMin_.cz, c.cz);
      aabbMax_.cx = std::max(aabbMax_.cx, c.cx);
      aabbMax_.cy = std::max(aabbMax_.cy, c.cy);
      aabbMax_.cz = std::max(aabbMax_.cz, c.cz);
    }
    return true;
  }

  /** Carve a sphere: d <- min(d, |p − centre| − radius). Returns the number of
   *  CELLS whose solidity flipped to air, which is what drives harvest yield
   *  and is the same unit the old whole-cell brush returned. */
  int digSphere(const BodyParams& body, const Vec3& centre, double radiusM) {
    return brush(body, centre, radiusM, /*subtract=*/true);
  }

  /** Place a sphere: d <- max(d, radius − |p − centre|). Mirror of digSphere. */
  int fillSphere(const BodyParams& body, const Vec3& centre, double radiusM) {
    return brush(body, centre, radiusM, /*subtract=*/false);
  }

  // ---- bookkeeping ---------------------------------------------------------

  /** Has the player written this corner? The mesher filters on THIS rather than
   *  on solidity, because the near voxel mesh exists to draw what the streamed
   *  heightfield cannot, and "the player changed it here" is exactly that set
   *  (ARCHITECTURE 15.2 item 108). */
  bool hasOverride(const VoxelCell& corner) const {
    return !ov_.empty() && ov_.count(voxelCellId(corner)) != 0;
  }

  bool empty() const { return ov_.empty(); }
  size_t overrideCount() const { return ov_.size(); }
  /** Overrides that push toward AIR, and toward ROCK. The old removed/added
   *  counts, re-expressed; the client uses them for drift detection only. */
  size_t airCount() const { return airCount_; }
  size_t rockCount() const { return ov_.size() - airCount_; }
  void clear() {
    ov_.clear();
    airCount_ = 0;
    dirtyValid_ = false;
    aabbMin_ = aabbMax_ = VoxelCell{};
  }

  /**
   * Does any override actually reach the radial segment through `dir` between
   * the two radii? This must be EXACT, not conservative, in both directions.
   *
   * Too loose and a column near an edit but not on it takes the root-find path
   * and returns the TRILINEAR surface where its untouched neighbour returns the
   * exact designed height, which is a centimetre step in the heightfield with no
   * edit under it. Too tight and a real dig fails to lower the ground. So: an
   * O(1) global reject on the edit set's own bounding box, and inside that box
   * the eight corners of each cell the radial passes through, which is the exact
   * stencil `densityAt` will read. The expensive branch is a thin ring of
   * columns around an edit that contain no edit, which is a small set.
   */
  bool columnTouched(const Vec3& dir, double rLo, double rHi) const {
    if (ov_.empty()) return false;
    const Vec3 u = unitOf(dir);
    // Global reject: does the segment come within a cell of the override AABB?
    {
      const double lo[3] = {double(aabbMin_.cx) - 1.0, double(aabbMin_.cy) - 1.0,
                            double(aabbMin_.cz) - 1.0};
      const double hi[3] = {double(aabbMax_.cx) + 1.0, double(aabbMax_.cy) + 1.0,
                            double(aabbMax_.cz) + 1.0};
      const double ud[3] = {u.x, u.y, u.z};
      double tLo = rLo, tHi = rHi;
      for (int i = 0; i < 3 && tLo <= tHi; ++i) {
        if (std::fabs(ud[i]) < 1e-15) {
          if (0.0 < lo[i] || 0.0 > hi[i]) return false;
          continue;
        }
        double a = lo[i] / ud[i], b = hi[i] / ud[i];
        if (a > b) std::swap(a, b);
        tLo = std::max(tLo, a);
        tHi = std::min(tHi, b);
      }
      if (tLo > tHi) return false;
    }
    for (double r = rHi; r >= rLo; r -= kVoxelSizeM) {
      const VoxelCell c0 = cornerForPos(u * r);
      for (int i = 0; i < 8; ++i)
        if (ov_.count(voxelCellId(VoxelCell{c0.cx + (i & 1),
                                            c0.cy + ((i >> 1) & 1),
                                            c0.cz + ((i >> 2) & 1)})) != 0)
          return true;
    }
    return false;
  }

  // Dirty CELL AABB since the last clearDirty (the re-mesh hint). Cells, not
  // corners, because that is what the mesher and the client already speak.
  struct CellAABB {
    VoxelCell min, max;
    bool valid = false;
  };
  CellAABB dirtyRegion() const { return CellAABB{dirtyMin_, dirtyMax_, dirtyValid_}; }
  bool dirtyValid() const { return dirtyValid_; }
  void clearDirty() { dirtyValid_ = false; }
  void touchCell(const VoxelCell& c) { accumulateDirty(c); }

  // ---- persistence ---------------------------------------------------------
  //
  //   [varint kFieldMagic][varint version][varint count]{[varint id][varint f32bits]}
  //
  // Ids ascend so the byte stream is deterministic. The float is written as its
  // raw IEEE bit pattern through the varint the cursor already has, so this
  // header still depends on nothing but the cursor's varint pair.
  static constexpr uint64_t kFieldMagic   = 0x4F464633ull;  // 'OFF3'
  static constexpr uint64_t kFieldVersion = 3;

  template <typename Writer>
  void serialize(Writer& w) const {
    w.varint(kFieldMagic);
    w.varint(kFieldVersion);
    std::vector<uint64_t> ids;
    ids.reserve(ov_.size());
    for (const auto& kv : ov_) ids.push_back(kv.first);
    std::sort(ids.begin(), ids.end());
    w.varint(ids.size());
    for (uint64_t id : ids) {
      uint32_t bits = 0;
      const float v = ov_.find(id)->second;
      std::memcpy(&bits, &v, sizeof(bits));
      w.varint(id);
      w.varint(static_cast<uint64_t>(bits));
    }
  }

  /** Read the field back. `first` is the leading varint the caller already
   *  consumed when it was dispatching between save formats; pass 0 to have this
   *  read it itself. Returns false if the stream is not a density field, which
   *  is how VoxelEdits routes a legacy binary-occupancy slot to its own reader. */
  template <typename Reader>
  bool deserialize(Reader& r, uint64_t first = 0) {
    const uint64_t magic = first ? first : r.varint();
    if (magic != kFieldMagic) return false;
    r.varint();                                   // version; only 3 so far
    clear();
    const uint64_t n = r.varint();
    ov_.reserve(static_cast<size_t>(n));
    for (uint64_t i = 0; i < n; ++i) {
      const uint64_t id = r.varint();
      const uint32_t bits = static_cast<uint32_t>(r.varint());
      float v = 0.0f;
      std::memcpy(&v, &bits, sizeof(v));
      const VoxelCell c = voxelCellFromId(id);
      ov_.emplace(id, v);
      if (v < 0.0f) ++airCount_;
      if (ov_.size() == 1) {
        aabbMin_ = aabbMax_ = c;
      } else {
        aabbMin_.cx = std::min(aabbMin_.cx, c.cx);
        aabbMin_.cy = std::min(aabbMin_.cy, c.cy);
        aabbMin_.cz = std::min(aabbMin_.cz, c.cz);
        aabbMax_.cx = std::max(aabbMax_.cx, c.cx);
        aabbMax_.cy = std::max(aabbMax_.cy, c.cy);
        aabbMax_.cz = std::max(aabbMax_.cz, c.cz);
      }
    }
    return true;
  }

  /** Diagnostic only; never a gameplay input. */
  size_t memoSize() const { return memo_.size(); }

 private:
  // Below this, an override is indistinguishable from the procedural value and
  // storing it is save bloat. 1 mm is far under the mesher's own error.
  static constexpr double kNoopEpsM = 1e-3;

  /** Memoized procedural corner density. A pure function of (body, corner), so
   *  memoizing cannot change a result: this is a cache, not a second authority.
   *  Keyed on the world-generation identity so a different body clears it, and
   *  bounded so a long walk cannot grow it without limit (mirrors the discipline
   *  VoxelEdits::procSurfaceRadius already established). */
  double procCorner(const BodyParams& body, const VoxelCell& c) const {
    const uint64_t sig = fieldWorldSig(body);
    if (!memoValid_ || sig != memoSig_) {
      memo_.clear();
      memoSig_ = sig;
      memoValid_ = true;
    } else if (memo_.size() >= kMemoMax) {
      memo_.clear();
    }
    const uint64_t id = voxelCellId(c);
    const auto it = memo_.find(id);
    if (it != memo_.end()) return it->second;
    const double d = procDensityAt(body, cornerPos(c));
    memo_.emplace(id, d);
    return d;
  }

  int brush(const BodyParams& body, const Vec3& centre, double radiusM,
            bool subtract) {
    if (radiusM <= 0.0) return 0;
    // Corners out to one cell past the sphere, so the trilinear stencil of every
    // cell the sphere touches is fully written and the surface closes.
    const double reach = radiusM + kVoxelSizeM;
    const VoxelCell a = cornerForPos(Vec3(centre.x - reach, centre.y - reach,
                                          centre.z - reach));
    const VoxelCell b = cornerForPos(Vec3(centre.x + reach, centre.y + reach,
                                          centre.z + reach));
    // Which cells were solid before, so the return value is a true cell count.
    const VoxelCell cmin{a.cx, a.cy, a.cz};
    const VoxelCell cmax{b.cx - 1, b.cy - 1, b.cz - 1};
    std::vector<uint8_t> before = sampleCells(body, cmin, cmax);
    for (int32_t z = a.cz; z <= b.cz; ++z)
      for (int32_t y = a.cy; y <= b.cy; ++y)
        for (int32_t x = a.cx; x <= b.cx; ++x) {
          const VoxelCell c{x, y, z};
          const Vec3 p = cornerPos(c);
          const double sphere = (p - centre).length() - radiusM;
          const double old = cornerDensity(body, c);
          const double nd = subtract ? std::min(old, sphere)
                                     : std::max(old, -sphere);
          if (nd != old) setCorner(body, c, nd);
        }
    return commitCells(body, cmin, cmax, before, subtract);
  }

  std::vector<uint8_t> sampleCells(const BodyParams& body, const VoxelCell& cmin,
                                   const VoxelCell& cmax) const {
    std::vector<uint8_t> out;
    if (cmax.cx < cmin.cx || cmax.cy < cmin.cy || cmax.cz < cmin.cz) return out;
    const size_t nx = static_cast<size_t>(cmax.cx - cmin.cx + 1);
    const size_t ny = static_cast<size_t>(cmax.cy - cmin.cy + 1);
    const size_t nz = static_cast<size_t>(cmax.cz - cmin.cz + 1);
    out.resize(nx * ny * nz, 0);
    size_t i = 0;
    for (int32_t z = cmin.cz; z <= cmax.cz; ++z)
      for (int32_t y = cmin.cy; y <= cmax.cy; ++y)
        for (int32_t x = cmin.cx; x <= cmax.cx; ++x)
          out[i++] = solidCell(body, VoxelCell{x, y, z}) ? 1u : 0u;
    return out;
  }

  int commitCells(const BodyParams& body, const VoxelCell& cmin,
                  const VoxelCell& cmax, const std::vector<uint8_t>& before,
                  bool wantAir) {
    if (before.empty()) return 0;
    int changed = 0;
    size_t i = 0;
    for (int32_t z = cmin.cz; z <= cmax.cz; ++z)
      for (int32_t y = cmin.cy; y <= cmax.cy; ++y)
        for (int32_t x = cmin.cx; x <= cmax.cx; ++x, ++i) {
          const VoxelCell c{x, y, z};
          const bool now = solidCell(body, c);
          if ((before[i] != 0) == now) continue;
          accumulateDirty(c);
          if (now != wantAir) ++changed;   // flipped the way the op intended
        }
    return changed;
  }

  void accumulateDirty(const VoxelCell& c) {
    if (!dirtyValid_) {
      dirtyMin_ = dirtyMax_ = c;
      dirtyValid_ = true;
      return;
    }
    dirtyMin_.cx = std::min(dirtyMin_.cx, c.cx);
    dirtyMin_.cy = std::min(dirtyMin_.cy, c.cy);
    dirtyMin_.cz = std::min(dirtyMin_.cz, c.cz);
    dirtyMax_.cx = std::max(dirtyMax_.cx, c.cx);
    dirtyMax_.cy = std::max(dirtyMax_.cy, c.cy);
    dirtyMax_.cz = std::max(dirtyMax_.cz, c.cz);
  }

  static uint64_t fieldWorldSig(const BodyParams& body) {
    uint64_t h = body.bodySeed;
    const double f[3] = {body.radiusM, body.maxReliefM, body.seaLevelM};
    for (int i = 0; i < 3; ++i) {
      uint64_t bits = 0;
      std::memcpy(&bits, &f[i], sizeof(bits));
      h ^= bits + 0x9e3779b97f4a7c15ull + (h << 6) + (h >> 2);
    }
    return h;
  }
  static constexpr size_t kMemoMax = 4u << 20;

  std::unordered_map<uint64_t, float> ov_;      // corner id -> density override
  VoxelCell aabbMin_{}, aabbMax_{};             // O(1) reject for column queries
  size_t airCount_ = 0;
  VoxelCell dirtyMin_{}, dirtyMax_{};
  bool dirtyValid_ = false;
  mutable std::unordered_map<uint64_t, double> memo_;
  mutable uint64_t memoSig_ = 0;
  mutable bool memoValid_ = false;
};

// =============================================================================
// §3 — levelDisc: the terraforming op, as a CSG half-space inside a cylinder.
//
// WG-22 stated the rule and WG-23 had to bolt a recording band onto it, because
// a whole-cell edit is read back through a run of explicitly edited cells and a
// staircase surface keeps breaking that run. On a signed field the rule needs no
// prosthetic at all:
//
//   inside a cylinder of radius R about the local up, within the reach band,
//     d <- targetR − r
//
// A DIRECT ASSIGNMENT, and it took one measurement to learn that it has to be.
// The obvious CSG form, min above the target and max below it, gets every SIGN
// right and is still wrong, because surface nets interpolates VALUES: a corner
// half a metre under the target on a cut column keeps its procedural +2.78 while
// the corner above it holds the plane's −0.4, so the crossing lands at 12% of
// the edge instead of at the plane and the pad comes out 1.24 m rough. Measured
// exactly that way. The correct signed distance for "the solid inside this
// cylinder is everything below targetR" IS targetR − r, so write it.
//
// The zero level is then the sphere of radius targetR, which over a 12 m pad
// departs from a plane by 12^2/(8 * 600000) = 0.03 mm. It is idempotent by
// construction, since assigning the same function twice changes nothing, which
// is what lets the client repeat it on a held key without the pad creeping.
//
// maxCutM / maxFillM bound the REACH. Rock standing higher than the cut reach is
// left alone; its underside then reads as a lip at the top of the band, which is
// the honest consequence of a bounded op and is why the client passes 24 m, three
// times the spread of the steepest site the tool is meant for.
// =============================================================================
/** How far from the new surface a levelling op writes the exact plane. Two cells
 *  plus a margin: the trilinear stencil reaches one cell, and the sphere trace in
 *  §4 steps by the value it reads, so a slightly wider skirt keeps its first step
 *  honest. */
static constexpr double kLevelExactBandM = 3.0;

struct LevelDiscResult {
  int dug = 0;       // cells whose centre went rock -> air
  int filled = 0;    // cells whose centre went air -> rock
  int scanned = 0;   // corners considered
  int corners = 0;   // corners whose stored value changed
  int cells() const { return dug + filled; }
};

inline LevelDiscResult levelDisc(const BodyParams& body, DensityField& field,
                                 const Vec3& centrePos, double radiusM,
                                 double targetHeightM, double maxCutM = 24.0,
                                 double maxFillM = 24.0) {
  LevelDiscResult out;
  const double centreR = centrePos.length();
  if (radiusM <= 0.0 || centreR <= 0.0) return out;
  const Vec3 up = centrePos * (1.0 / centreR);
  const double targetR = body.radiusM + targetHeightM;

  // Corner box: the cylinder padded by one cell so every cell the surface can
  // cross has all eight of its corners written, and the band padded likewise.
  const double pad = 2.0 * kVoxelSizeM;
  const double rHigh = targetR + maxCutM + pad;
  const double rLow = std::max(1.0, targetR - maxFillM - pad);
  const double rad = radiusM + pad;
  const double axLo = std::sqrt(std::max(0.0, rLow * rLow - rad * rad));
  double lo[3], hi[3];
  const double u[3] = {up.x, up.y, up.z};
  for (int i = 0; i < 3; ++i) {
    const double a = axLo * u[i], b = rHigh * u[i];
    const double perp = rad * std::sqrt(std::max(0.0, 1.0 - u[i] * u[i]));
    lo[i] = std::min(a, b) - perp;
    hi[i] = std::max(a, b) + perp;
  }
  const VoxelCell c0 = cornerForPos(Vec3(lo[0], lo[1], lo[2]));
  const VoxelCell c1 = cornerForPos(Vec3(hi[0], hi[1], hi[2]));
  const VoxelCell cellMin{c0.cx, c0.cy, c0.cz};
  const VoxelCell cellMax{c1.cx - 1, c1.cy - 1, c1.cz - 1};

  // Cell solidity before, so the [dug, filled] the client already reads stays
  // in the same unit it has always been in.
  std::vector<uint8_t> before;
  {
    for (int32_t z = cellMin.cz; z <= cellMax.cz; ++z)
      for (int32_t y = cellMin.cy; y <= cellMax.cy; ++y)
        for (int32_t x = cellMin.cx; x <= cellMax.cx; ++x)
          before.push_back(field.solidCell(body, VoxelCell{x, y, z}) ? 1u : 0u);
  }

  const double r2 = radiusM * radiusM;
  for (int32_t z = c0.cz; z <= c1.cz; ++z)
    for (int32_t y = c0.cy; y <= c1.cy; ++y)
      for (int32_t x = c0.cx; x <= c1.cx; ++x) {
        const VoxelCell c{x, y, z};
        const Vec3 p = cornerPos(c);
        const double r = p.length();
        if (r > rHigh || r < rLow) continue;
        const double axial = p.x * up.x + p.y * up.y + p.z * up.z;
        if (p.lengthSq() - axial * axial > r2) continue;   // outside the disc
        ++out.scanned;
        const double plane = targetR - r;
        // Write the plane where it can be SEEN, and nowhere else. A corner is
        // visible to the mesher, the collider and the column query only through
        // (a) the sign it carries and (b) its value inside the stencil that
        // brackets the zero level. So store it when the sign moves, which is the
        // earth actually shifted, or when it is within kLevelExactBandM of the
        // new surface, which is where the interpolation must be exact. Beyond
        // that the plane and the procedural value agree in sign and no cell can
        // cross between them, so storing it would only inflate the save: this
        // cut one pad from 44,360 bytes to a few thousand with the measured
        // flatness unchanged at 0.0000 m.
        const double cur = field.cornerDensity(body, c);
        const bool signMoves = (cur >= 0.0) != (plane >= 0.0);
        if (!signMoves && std::fabs(plane) > kLevelExactBandM) continue;
        if (field.setCorner(body, c, plane)) ++out.corners;
      }

  size_t i = 0;
  field.clearDirty();
  for (int32_t z = cellMin.cz; z <= cellMax.cz; ++z)
    for (int32_t y = cellMin.cy; y <= cellMax.cy; ++y)
      for (int32_t x = cellMin.cx; x <= cellMax.cx; ++x, ++i) {
        const VoxelCell c{x, y, z};
        const bool now = field.solidCell(body, c);
        if ((before[i] != 0) == now) continue;
        field.touchCell(c);
        if (now) ++out.filled; else ++out.dug;
      }
  return out;
}

// =============================================================================
// §4 — columnSurfaceHeight: the heightfield VIEW of the field.
//
// The topmost radius along a direction at which the interpolated field turns
// solid, expressed as a relief height. This REPLACES derivedLoweringAt and
// derivedRaisingAt (WG-21 / WG-22) and deletes the WG-23 band-recording hack
// they forced: those two walked a contiguous run of explicitly edited CELLS,
// which a staircase surface kept breaking, whereas a root find on a continuous
// field simply finds the surface. A sideways tunnel still lowers nothing, for
// the same reason as before and now automatically: the rock above it is solid,
// so the topmost crossing is unmoved.
//
// The march is SPHERE TRACING, which is sound here because the field is
// 1-Lipschitz along a radial: the procedural part has d(density)/dr == −1
// exactly, and min/max of 1-Lipschitz functions is 1-Lipschitz. So a step of
// −density from an air sample cannot step past a surface. That turns a hundred
// fixed 1 m probes into a handful.
// =============================================================================
inline double columnSurfaceHeight(const BodyParams& body,
                                  const DensityField& field, const Vec3& dir,
                                  double maxDigM, double maxFillM) {
  // sampleDesignedHeight IS surface_field.h's baseHeight (WG-21). Named through
  // biome.h here only because that header is the definition site and this one
  // must stay below surface_field.h in the include order.
  //
  // `dir` is passed through UNNORMALIZED, exactly as baseHeight takes it. That is
  // not a detail: unitOf(unitOf(v)) is not bit-identical to unitOf(v), because an
  // already-unit vector has a length of 1 plus an ulp and dividing by it moves
  // the mantissa. Normalizing here would make this function disagree with the
  // oracle in the last bits at every untouched column, which is a second surface
  // definition arriving by rounding (standing rule 1).
  const double base = sampleDesignedHeight(body, dir);
  if (field.empty()) return base;
  const Vec3 u = unitOf(dir);
  const double rTop = body.radiusM + base + maxFillM;
  const double rBot = body.radiusM + base - maxDigM;
  if (!field.columnTouched(u, rBot, rTop)) return base;

  double r = rTop;
  double dPrev = field.densityAt(body, u * r);
  if (dPrev >= 0.0) return base + maxFillM;        // filled to the cap
  double rPrev = r;
  for (int i = 0; i < 512 && r > rBot; ++i) {
    const double step = std::min(4.0, std::max(0.25, -dPrev));
    r -= step;
    if (r < rBot) r = rBot;
    const double d = field.densityAt(body, u * r);
    if (d >= 0.0) {
      // REFINE the bracket before interpolating. A single linear interpolation
      // is only exact when both samples carry the true distance to the surface,
      // and the far sample often does not: a levelling op writes the exact plane
      // only near its own zero level, so a step taken from procedural air can
      // land past the pad and the chord then reports the surface up to 0.15 m
      // low. Measured exactly that way. Bisecting to a quarter of a cell puts
      // both ends inside the exact band, after which the chord is right.
      double rA = rPrev, dA = dPrev, rB = r, dB = d;
      for (int k = 0; k < 8 && (rA - rB) > 0.25 * kVoxelSizeM; ++k) {
        const double rM = 0.5 * (rA + rB);
        const double dM = field.densityAt(body, u * rM);
        if (dM >= 0.0) { rB = rM; dB = dM; } else { rA = rM; dA = dM; }
      }
      const double denom = dB - dA;
      const double t = (denom != 0.0) ? (-dA / denom) : 0.0;
      return rA + (rB - rA) * t - body.radiusM;
    }
    dPrev = d;
    rPrev = r;
  }
  return base - maxDigM;                            // bedrock
}

}  // namespace worldgen
}  // namespace of
