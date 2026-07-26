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
//     solid iff its centre is at/below the terrain surface (the DESIGNED surface,
//     biome.h's sampleDesignedHeight at the cell-centre direction — WG-21: the
//     single surface authority; RAW sampleHeightField is NOT the voxel surface)
//     AND it is not in the removed set. Cells above the surface are AIR. We never store the (enormous)
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
// ADDITIVE / NON-DESTRUCTIVE: sampleHeightField / sampleDesignedHeight
// (cubed_sphere.h / biome.h) are consumed READ-ONLY and unchanged. This is the
// destruction layer; terrain_deform.h is now a DERIVED far-field view (WG-21), no
// longer an independent edit authority.
//
// WG-21 (single surface authority): solidity is sampled against the DESIGNED
// surface (sampleDesignedHeight), NOT the raw heightfield. This makes the voxel
// solid shell agree with the rendered/collision mesh and the walker, which all
// read the designed surface — retiring the UE 18 m "surface-snap" hack whose root
// cause was the raw-vs-designed gap.
//
// Header-only C++17. Consumes cubed_sphere.h + biome.h READ-ONLY. No UE, no
// rendering, no physics — the isolation harness the UE voxel layer mirrors.
// =============================================================================
#include <cstdint>
#include <cstring>
#include <cmath>
#include <vector>
#include <unordered_map>
#include <unordered_set>
#include <algorithm>

#include "of/vec3.h"
#include "of/cubed_sphere.h"
#include "of/biome.h"

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
//   |cellCentre| <= body.radiusM + sampleDesignedHeight(body, dir(cellCentre)).
// i.e. the cell sits inside the planet's solid shell (the DESIGNED surface, WG-21
// — the SAME base the mesh/collision/walker read, so the voxel shell agrees with
// them). PURE function of the height field -> deterministic & bit-stable. (The far interior is solid too — for a real
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
// WG-21: samples the DESIGNED surface (sampleDesignedHeight) — the single surface
// authority — so voxel solidity agrees with the mesh/collision/walker.
inline double surfaceRadiusAt(const BodyParams& body, const Vec3& p) {
  return body.radiusM + sampleDesignedHeight(body, unitOf(p));
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
    return procSolidMemo(body, c);
  }

  /**
   * MEMOIZED isProcSolid. isProcSolid evaluates the designed-height noise stack
   * (about 2 us), and the callers ask the same question about the same cell over
   * and over: exposedFaces tests a cell plus its six neighbours, every neighbour
   * is itself a cell, and the whole region is re-meshed after every dig; the
   * walker's floor march re-samples the same column 60 times a tick. That is why
   * a modest dirty box cost 27 to 69 ms of oracle and microseconds of mesher
   * (ARCHITECTURE.md 15.2 item 50).
   *
   * Memoizing a PURE function of (body, cell) cannot change a result, so
   * determinism and the seed+diff property are untouched: this is a cache, not a
   * second authority (standing rule 1). It is keyed on the world-generation
   * fields of BodyParams, so a different body clears it rather than answering
   * for the wrong planet, and it is bounded so a long walk cannot grow it
   * without limit.
   */
  bool procSolidMemo(const BodyParams& body, const VoxelCell& c) const {
    const uint64_t sig = worldSig(body);
    if (!procValid_ || sig != procSig_) {
      proc_.clear();
      procSig_ = sig;
      procValid_ = true;
    } else if (proc_.size() >= kProcMemoMax) {
      proc_.clear();
    }
    const uint64_t id = voxelCellId(c);
    const auto it = proc_.find(id);
    if (it != proc_.end()) return it->second != 0;
    const bool s = isProcSolid(body, c);
    proc_.emplace(id, static_cast<uint8_t>(s ? 1 : 0));
    return s;
  }

  /** Cells currently memoized. Diagnostic only; never a gameplay input. */
  size_t procMemoSize() const { return proc_.size(); }
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

  // The world-generation identity of a body: the ONLY fields solidity reads
  // (see BodyParams — mu and bodyId take no part in world generation). Two
  // bodies that agree on all four produce the same solid shell, so the memo is
  // valid across them; anything else clears it.
  static uint64_t worldSig(const BodyParams& body) {
    uint64_t h = body.bodySeed;
    const double f[3] = {body.radiusM, body.maxReliefM, body.seaLevelM};
    for (int i = 0; i < 3; ++i) {
      uint64_t bits = 0;
      static_assert(sizeof(bits) == sizeof(f[i]), "double is 64 bits");
      std::memcpy(&bits, &f[i], sizeof(bits));
      h ^= bits + 0x9e3779b97f4a7c15ull + (h << 6) + (h >> 2);
    }
    return h;
  }
  // 4 M cells is roughly a 160 m cube of terrain, far more than the near field
  // ever holds, and bounds the memo at a few tens of MB.
  static constexpr size_t kProcMemoMax = 4u << 20;

  std::unordered_set<uint64_t> removed_;   // carved-to-air cell ids (the diff)
  VoxelCell dirtyMin_{}, dirtyMax_{};      // inclusive touched-cell AABB
  bool dirtyValid_ = false;
  // Pure-function memo (procSolidMemo). `mutable` because it is a cache: it can
  // be filled through a const VoxelEdits without changing what that object means.
  mutable std::unordered_map<uint64_t, uint8_t> proc_;
  mutable uint64_t procSig_ = 0;
  mutable bool procValid_ = false;
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
//
// Solidity is resolved ONCE per cell into a dense slab covering the region
// padded by one, and the six-neighbour test then reads the slab. The naive form
// below (kept as the fallback) asks isSolid up to SEVEN times per cell — its own
// test plus once as each of its six neighbours' neighbour — and every one of
// those was a hash probe or a noise evaluation. Emission order is unchanged
// (z,y,x then axis,sign), so the face list is byte-identical to the old path.
inline std::vector<FaceQuad> exposedFaces(const BodyParams& body,
                                          const VoxelEdits& edits,
                                          const VoxelCell& cmin,
                                          const VoxelCell& cmax) {
  std::vector<FaceQuad> faces;
  if (cmax.cx < cmin.cx || cmax.cy < cmin.cy || cmax.cz < cmin.cz) return faces;

  // +2 for the one-cell pad the neighbour test reaches into.
  const int64_t nx = static_cast<int64_t>(cmax.cx) - cmin.cx + 3;
  const int64_t ny = static_cast<int64_t>(cmax.cy) - cmin.cy + 3;
  const int64_t nz = static_cast<int64_t>(cmax.cz) - cmin.cz + 3;
  const int64_t total = nx * ny * nz;
  // A region big enough to blow the slab out is not a near-field re-mesh; take
  // the direct path rather than allocate hundreds of MB.
  static constexpr int64_t kMaxSlabCells = 8ll << 20;
  if (total > kMaxSlabCells) {
    forSolidCellsInRegion(body, edits, cmin, cmax, [&](const VoxelCell& c) {
      for (int axis = 0; axis < 3; ++axis)
        for (int sign = -1; sign <= 1; sign += 2)
          if (!edits.isSolid(body, voxelNeighbour(c, axis, sign)))
            faces.push_back(FaceQuad{c, axis, sign});
    });
    return faces;
  }

  std::vector<uint8_t> slab(static_cast<size_t>(total), 0);
  const auto at = [&](int64_t x, int64_t y, int64_t z) -> int64_t {
    return ((z - cmin.cz + 1) * ny + (y - cmin.cy + 1)) * nx + (x - cmin.cx + 1);
  };
  for (int64_t z = cmin.cz - 1; z <= static_cast<int64_t>(cmax.cz) + 1; ++z)
    for (int64_t y = cmin.cy - 1; y <= static_cast<int64_t>(cmax.cy) + 1; ++y)
      for (int64_t x = cmin.cx - 1; x <= static_cast<int64_t>(cmax.cx) + 1; ++x) {
        const VoxelCell c{static_cast<int32_t>(x), static_cast<int32_t>(y),
                          static_cast<int32_t>(z)};
        slab[static_cast<size_t>(at(x, y, z))] = edits.isSolid(body, c) ? 1 : 0;
      }

  for (int64_t z = cmin.cz; z <= cmax.cz; ++z)
    for (int64_t y = cmin.cy; y <= cmax.cy; ++y)
      for (int64_t x = cmin.cx; x <= cmax.cx; ++x) {
        if (!slab[static_cast<size_t>(at(x, y, z))]) continue;
        const VoxelCell c{static_cast<int32_t>(x), static_cast<int32_t>(y),
                          static_cast<int32_t>(z)};
        for (int axis = 0; axis < 3; ++axis)
          for (int sign = -1; sign <= 1; sign += 2) {
            const int64_t ax = x + (axis == 0 ? sign : 0);
            const int64_t ay = y + (axis == 1 ? sign : 0);
            const int64_t az = z + (axis == 2 ? sign : 0);
            if (!slab[static_cast<size_t>(at(ax, ay, az))])
              faces.push_back(FaceQuad{c, axis, sign});
          }
      }
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
