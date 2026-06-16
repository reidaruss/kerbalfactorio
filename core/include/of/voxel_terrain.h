#pragma once
// =============================================================================
// voxel_terrain.h — headless TRUE VOXEL TUNNELING layer (1 m^3 destruction).
//
// The deterministic, persistable VOXEL edit layer that supersedes the heightfield
// deform (terrain_deform.h) for DIGGING: where the heightfield can only LOWER the
// surface column under a direction (so you can dig DOWN but never sideways), the
// voxel layer carves ARBITRARY 1 m^3 cells — so the player can tunnel sideways,
// leave overhangs, hollow out caverns. It is the headless foundation the UE cube
// mesher + dig + voxel-collision pass binds to:
//
//   * VOXEL CELL — an integer (cx,cy,cz) = the BODY-FRAME position quantized to
//     kVoxelSizeM = 1.0 m (floor(pos / 1)), packed to a stable uint64 id. The
//     grid is a plain Cartesian lattice in the body frame (NOT the angular cubed-
//     sphere deform lattice) — that is what lets a cell be ANYWHERE in the solid
//     volume, including horizontally adjacent below the surface (a tunnel).
//   * SOLIDITY = PROCEDURAL-SOLID xor REMOVED (the seed+diff property): a cell is
//     solid iff its centre is at/below the terrain surface (cubed_sphere.h's
//     sampleHeightField at the cell-centre direction) AND it is not in the
//     removed set. Cells above the surface are AIR. We never store the (enormous)
//     full volume — only the sparse REMOVED diff. The procedural-solid half is a
//     PURE function of the height field, so the same (body, edits) -> the same
//     solidity, bit-for-bit, on any machine.
//   * DIG BRUSH (the tunnel maker) — VoxelEdits::dig(body, centerWorldPos,
//     radiusM): mark every currently-solid cell whose centre is within radiusM as
//     removed; returns the count removed (drives harvest yield). Because it removes
//     ARBITRARY cells (including ones horizontally below the surface), a sequence
//     of digs carves a tunnel / overhang / cavern the heightfield can't express.
//   * MESH EXTRACTION (for the UE cube mesher) — exposedFaces(body, edits, region):
//     emit a FaceQuad for each SOLID cell face whose 6-neighbour is AIR (the
//     visible voxel surface) over a region AABB or centre+radius. The UE side
//     builds a unit quad + outward normal per FaceQuad and builds collision from
//     the same solid cells (isSolid + the region iterator).
//   * DIRTY REGION — after a dig, the touched-cell AABB (dirtyRegion()) so UE
//     re-meshes only the changed region.
//   * PERSISTENCE — serialize/deserialize the removed set (sparse), in
//     persistence.h / terrain_deform.h style (templated over the byte cursor so
//     this header stays leaf).
//
// DETERMINISM: procedural-solid is a pure function of sampleHeightField; edits are
// EXPLICIT ops (a removed cell-id set). Same ops -> same state, bit-for-bit.
//
// ADDITIVE / NON-DESTRUCTIVE: sampleHeightField (cubed_sphere.h) is consumed
// READ-ONLY and unchanged. This is a NEW layer alongside terrain_deform.h, not a
// replacement of any existing output.
//
// Header-only C++17. Consumes cubed_sphere.h READ-ONLY. No UE, no rendering, no
// physics — the isolation harness the UE voxel layer mirrors.
// =============================================================================
#include <cstdint>
#include <cmath>
#include <vector>
#include <unordered_set>
#include <algorithm>

#include "of/vec3.h"
#include "of/cubed_sphere.h"

namespace of {
namespace worldgen {

// =============================================================================
// §1 — The voxel CELL lattice (1 m^3 body-frame Cartesian quantization).
//
// A voxel cell is the integer lattice cell containing a body-frame position:
//   (cx,cy,cz) = ( floor(pos.x), floor(pos.y), floor(pos.z) )   [kVoxelSizeM=1 m]
// The cell CENTRE is (cx+0.5, cy+0.5, cz+0.5) m. We pack the three signed
// integer coords into one uint64 id: 21 bits per axis, bias-encoded
// (add kVoxelBias) so the key is monotone and unique. 21 bits -> +/- 2^20 m =
// +/- 1,048,576 m, which covers Forge's 600 km and Cinder's 200 km radii (the
// solid shell lives within +/- (radius + relief) of the centre on each axis).
// =============================================================================

// Voxel edge length (metres). The 1 m^3 destruction granularity.
static constexpr double kVoxelSizeM = 1.0;

// Bits per packed axis and the centring bias (so negative coords pack monotone).
static constexpr int      kVoxelAxisBits = 21;
static constexpr int64_t  kVoxelBias     = int64_t(1) << (kVoxelAxisBits - 1);  // 2^20
static constexpr uint64_t kVoxelAxisMask = (uint64_t(1) << kVoxelAxisBits) - 1;

// An integer voxel cell coordinate in the body frame.
struct VoxelCell {
  int32_t cx = 0, cy = 0, cz = 0;
  bool operator==(const VoxelCell& o) const {
    return cx == o.cx && cy == o.cy && cz == o.cz;
  }
};

// Pack a cell into a stable 64-bit id (the sparse-set key). Bias-encoded per axis.
inline uint64_t voxelCellId(const VoxelCell& c) {
  const uint64_t px = static_cast<uint64_t>(static_cast<int64_t>(c.cx) + kVoxelBias) & kVoxelAxisMask;
  const uint64_t py = static_cast<uint64_t>(static_cast<int64_t>(c.cy) + kVoxelBias) & kVoxelAxisMask;
  const uint64_t pz = static_cast<uint64_t>(static_cast<int64_t>(c.cz) + kVoxelBias) & kVoxelAxisMask;
  return (px << (2 * kVoxelAxisBits)) | (py << kVoxelAxisBits) | pz;
}

// Unpack an id back to its cell coords (inverse of voxelCellId).
inline VoxelCell voxelCellFromId(uint64_t id) {
  VoxelCell c;
  c.cz = static_cast<int32_t>(static_cast<int64_t>(id & kVoxelAxisMask) - kVoxelBias);
  c.cy = static_cast<int32_t>(static_cast<int64_t>((id >> kVoxelAxisBits) & kVoxelAxisMask) - kVoxelBias);
  c.cx = static_cast<int32_t>(static_cast<int64_t>((id >> (2 * kVoxelAxisBits)) & kVoxelAxisMask) - kVoxelBias);
  return c;
}

// The voxel cell containing a body-frame position (floor-quantize to 1 m).
inline VoxelCell cellForPos(const Vec3& pos) {
  VoxelCell c;
  c.cx = static_cast<int32_t>(std::floor(pos.x / kVoxelSizeM));
  c.cy = static_cast<int32_t>(std::floor(pos.y / kVoxelSizeM));
  c.cz = static_cast<int32_t>(std::floor(pos.z / kVoxelSizeM));
  return c;
}

// The body-frame CENTRE of a voxel cell (where solidity is sampled).
inline Vec3 cellCenter(const VoxelCell& c) {
  return Vec3((static_cast<double>(c.cx) + 0.5) * kVoxelSizeM,
              (static_cast<double>(c.cy) + 0.5) * kVoxelSizeM,
              (static_cast<double>(c.cz) + 0.5) * kVoxelSizeM);
}

// =============================================================================
// §2 — PROCEDURAL solidity (the seed+diff base, before any edits).
//
// A cell is procedurally solid iff its centre lies at/below the terrain surface:
//   |cellCentre| <= body.radiusM + sampleHeightField(body, dir(cellCentre)).
// i.e. the cell sits inside the planet's solid shell. PURE function of the height
// field -> deterministic & bit-stable. (The far interior is solid too — for a real
// game UE only ever meshes/queries a thin region around the player, so the
// "everything below the surface is solid" model costs nothing: we only ever
// iterate a bounded region, never the whole volume.)
// =============================================================================

// Unit direction of a body-frame point (the sampler needs a UNIT dir — its noise
// stack reads the magnitude of the input, so a raw 600 km-scale vector would alias
// height wildly between adjacent metre-scale cells).
inline Vec3 unitOf(const Vec3& p) {
  const double l = p.length();
  return (l > 0.0) ? Vec3(p.x / l, p.y / l, p.z / l) : Vec3(0, 1, 0);
}

// Surface radius (metres from body centre) under the direction of a point. `p`
// may be any body-frame vector; it is normalized to a unit dir before sampling.
inline double surfaceRadiusAt(const BodyParams& body, const Vec3& p) {
  return body.radiusM + sampleHeightField(body, unitOf(p));
}

// Is this cell solid in the PURE procedural world (ignoring edits)?
inline bool isProcSolid(const BodyParams& body, const VoxelCell& cell) {
  const Vec3 p = cellCenter(cell);
  const double r = p.length();
  if (r <= 0.0) return true;                 // dead centre is solid
  return r <= surfaceRadiusAt(body, p);      // normalized inside surfaceRadiusAt
}

// =============================================================================
// §3 — VoxelEdits: the sparse REMOVED-cell set + the dig brush + queries.
//
// Holds the player's destruction diff: the set of cell ids carved to AIR. (An
// `added` set is reserved for later placed-voxel support; digging only uses
// `removed`.) Solidity = procedural-solid AND NOT removed.
// =============================================================================
class VoxelEdits {
 public:
  VoxelEdits() = default;

  // ---- raw removed-set access (the UE/gameplay layer binds to these) -------
  const std::unordered_set<uint64_t>& removedSet() const { return removed_; }
  size_t removedCount() const { return removed_.size(); }
  bool empty() const { return removed_.empty(); }

  bool isRemoved(uint64_t id) const { return removed_.count(id) != 0; }
  bool isRemoved(const VoxelCell& c) const { return isRemoved(voxelCellId(c)); }

  // Mark a single cell removed (the atomic carve op). Returns true if newly
  // removed (was present in the set after the call & wasn't before).
  bool digCell(const VoxelCell& c) { return removed_.insert(voxelCellId(c)).second; }
  bool digCellId(uint64_t id) { return removed_.insert(id).second; }

  // ---- SOLIDITY = procedural-solid AND NOT removed ------------------------
  bool isSolid(const BodyParams& body, const VoxelCell& c) const {
    if (isRemoved(c)) return false;          // carved to air
    return isProcSolid(body, c);
  }
  // Solidity at a body-frame position (the cell containing it).
  bool isSolidAt(const BodyParams& body, const Vec3& pos) const {
    return isSolid(body, cellForPos(pos));
  }

  // ---- DIG BRUSH (the tunnel maker) ---------------------------------------
  //
  // Remove every currently-SOLID cell whose CENTRE is within `radiusM` of
  // `centerWorldPos` (body-frame). Returns the count of cells newly removed
  // (drives harvest yield). Because the brush removes ARBITRARY cells — including
  // ones horizontally below the surface — repeated digs carve tunnels / overhangs
  // / caverns. Cells already air (above surface or already removed) are skipped,
  // so the count is the true newly-carved volume in 1 m^3 units.
  int dig(const BodyParams& body, const Vec3& centerWorldPos, double radiusM) {
    if (radiusM <= 0.0) return 0;
    dirtyValid_ = false;                     // recompute dirty AABB below
    const double r2 = radiusM * radiusM;
    // Scan the integer cell box covering the sphere; test each centre.
    const VoxelCell c0 = cellForPos(Vec3(centerWorldPos.x - radiusM,
                                         centerWorldPos.y - radiusM,
                                         centerWorldPos.z - radiusM));
    const VoxelCell c1 = cellForPos(Vec3(centerWorldPos.x + radiusM,
                                         centerWorldPos.y + radiusM,
                                         centerWorldPos.z + radiusM));
    int count = 0;
    for (int32_t z = c0.cz; z <= c1.cz; ++z)
      for (int32_t y = c0.cy; y <= c1.cy; ++y)
        for (int32_t x = c0.cx; x <= c1.cx; ++x) {
          const VoxelCell c{x, y, z};
          const Vec3 ctr = cellCenter(c);
          const Vec3 d = ctr - centerWorldPos;
          if (d.lengthSq() > r2) continue;   // outside the sphere
          if (!isProcSolid(body, c)) continue;   // already air (above surface)
          if (!digCell(c)) continue;             // already removed
          ++count;
          accumulateDirty(c);
        }
    return count;
  }

  // ---- DIRTY REGION (the re-mesh hint) ------------------------------------
  //
  // The inclusive AABB of cells touched since the last clearDirty(). UE re-meshes
  // only this region after a dig. dirtyValid() is false if nothing was touched.
  struct CellAABB {
    VoxelCell min, max;
    bool valid = false;
  };
  CellAABB dirtyRegion() const { return CellAABB{dirtyMin_, dirtyMax_, dirtyValid_}; }
  bool dirtyValid() const { return dirtyValid_; }
  void clearDirty() { dirtyValid_ = false; }

  // ---- persistence (the destruction diff as a compact sparse set) ----------
  //
  // Templated over the SaveWriter / SaveReader cursors (persistence.h §1 style)
  // WITHOUT depending on persistence.h, so this layer stays leaf. Writer needs
  // varint(uint64); reader the inverse. Format: [varint count][varint cellId]*.
  // The set is written in SORTED id order so the byte stream is deterministic.
  template <typename Writer>
  void serialize(Writer& w) const {
    std::vector<uint64_t> ids(removed_.begin(), removed_.end());
    std::sort(ids.begin(), ids.end());
    w.varint(ids.size());
    for (uint64_t id : ids) w.varint(id);
  }
  template <typename Reader>
  void deserialize(Reader& r) {
    removed_.clear();
    dirtyValid_ = false;
    const uint64_t n = r.varint();
    removed_.reserve(n);
    for (uint64_t i = 0; i < n; ++i) removed_.insert(r.varint());
  }

 private:
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

  std::unordered_set<uint64_t> removed_;   // carved-to-air cell ids (the diff)
  VoxelCell dirtyMin_{}, dirtyMax_{};      // inclusive touched-cell AABB
  bool dirtyValid_ = false;
};

// =============================================================================
// §4 — MESH EXTRACTION (for the UE cube mesher) + region iteration.
//
// A FaceQuad names one exposed voxel face: a SOLID cell whose neighbour across
// (axis,sign) is AIR. axis in {0,1,2} = X/Y/Z; sign in {-1,+1} = which of the two
// faces along that axis. (cell, axis, sign) is enough for UE to build the unit
// quad (the four corners of that face of the unit cube at `cell`) and the outward
// normal (the (axis,sign) unit vector). Iterating the region ONCE, we test each
// solid cell's six neighbours and emit a quad per solid->air boundary.
// =============================================================================
struct FaceQuad {
  VoxelCell cell;   // the solid cell owning the face
  int axis = 0;     // 0=X 1=Y 2=Z
  int sign = 0;     // -1 or +1 (which face along axis)
};

// The 6 axis-aligned neighbour offsets, paired with (axis,sign).
inline VoxelCell voxelNeighbour(const VoxelCell& c, int axis, int sign) {
  VoxelCell n = c;
  if (axis == 0) n.cx += sign;
  else if (axis == 1) n.cy += sign;
  else n.cz += sign;
  return n;
}

// The outward unit normal of a (axis,sign) face — what UE uses for lighting.
inline Vec3 faceNormal(int axis, int sign) {
  const double s = static_cast<double>(sign);
  return axis == 0 ? Vec3(s, 0, 0) : axis == 1 ? Vec3(0, s, 0) : Vec3(0, 0, s);
}

// Visit every SOLID cell in an inclusive cell AABB exactly once. fn(VoxelCell).
// UE builds voxel collision from the same solid set via this iterator.
template <typename Fn>
inline void forSolidCellsInRegion(const BodyParams& body, const VoxelEdits& edits,
                                  const VoxelCell& cmin, const VoxelCell& cmax,
                                  Fn&& fn) {
  for (int32_t z = cmin.cz; z <= cmax.cz; ++z)
    for (int32_t y = cmin.cy; y <= cmax.cy; ++y)
      for (int32_t x = cmin.cx; x <= cmax.cx; ++x) {
        const VoxelCell c{x, y, z};
        if (edits.isSolid(body, c)) fn(c);
      }
}

// Emit the exposed faces (solid->air boundaries) within an inclusive cell AABB.
// Efficient: iterates the region once; per solid cell tests its 6 neighbours.
inline std::vector<FaceQuad> exposedFaces(const BodyParams& body,
                                          const VoxelEdits& edits,
                                          const VoxelCell& cmin,
                                          const VoxelCell& cmax) {
  std::vector<FaceQuad> faces;
  forSolidCellsInRegion(body, edits, cmin, cmax, [&](const VoxelCell& c) {
    for (int axis = 0; axis < 3; ++axis)
      for (int sign = -1; sign <= 1; sign += 2) {
        const VoxelCell nb = voxelNeighbour(c, axis, sign);
        if (!edits.isSolid(body, nb))        // neighbour is AIR -> face is visible
          faces.push_back(FaceQuad{c, axis, sign});
      }
  });
  return faces;
}

// Convenience: exposed faces in the cell box covering a sphere (centre+radius).
inline std::vector<FaceQuad> exposedFaces(const BodyParams& body,
                                          const VoxelEdits& edits,
                                          const Vec3& centerWorldPos,
                                          double radiusM) {
  const VoxelCell cmin = cellForPos(Vec3(centerWorldPos.x - radiusM,
                                         centerWorldPos.y - radiusM,
                                         centerWorldPos.z - radiusM));
  const VoxelCell cmax = cellForPos(Vec3(centerWorldPos.x + radiusM,
                                         centerWorldPos.y + radiusM,
                                         centerWorldPos.z + radiusM));
  return exposedFaces(body, edits, cmin, cmax);
}

}  // namespace worldgen
}  // namespace of
