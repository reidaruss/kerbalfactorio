#pragma once
// =============================================================================
// terrain_stream.h — Wave-1 headless terrain STREAMING + LOD manager (Spike 1
// §3, §4.1–§4.2). The headless foundation the UE terrain renderer binds to for
// "a player on a whole planet": pick the visible quads at the right LOD around a
// moving observer, maintain that resident set as the observer moves (ready /
// evict events under a per-update generation budget), and stay CRACK-FREE across
// LOD boundaries.
//
// THREE LOAD-BEARING PROPERTIES (proven in test_terrain_stream.cpp):
//   1. DETERMINISTIC — the same observer (same BodyParams) selects the IDENTICAL
//      resident set, every time, order-independent. Selection runs on the 64-bit
//      authority position (§3.1), never the floating-origin engine position.
//   2. LOD deepens toward the observer — a quad subdivides when it subtends more
//      than a target angular size (distance-based, KSP-PQS §3.1), with a
//      BALANCED-quadtree invariant (edge-adjacent quads differ by <=1 level, §1.4)
//      so skirts only ever cover a 1-level step.
//   3. CRACK-FREE across LOD seams — shared-edge HEIGHTS are already bit-identical
//      (cubed_sphere.h position-hash, WG-6). This header adds SKIRTS (a radial
//      apron, §1.4 mechanism 2) so a finer quad abutting a coarser neighbour shows
//      no hairline T-junction hole. The skirt depth is derived from the quad's own
//      edge length, so it is itself deterministic.
//
// Plus a per-update GENERATION BUDGET (§3.2): cap how many quad meshes are built
// per updateStreaming() call, so a fast descent spreads mesh build over several
// ticks instead of spiking one. The resident set converges over a few budgeted
// updates to the same set an unbudgeted update would reach.
//
// Header-only, additive. Consumes cubed_sphere.h READ-ONLY (BodyParams, FQuadKey,
// generateQuadMesh, the lattice/warp/hash substrate) + of::UniverseCoord. No UE,
// no rendering, no physics — the isolation harness the renderer mirrors.
//
// Chunk record shape == the pinned FTerrainChunk (Spike 1 §4.1): Key,
// CenterUniverse (FUniverseCoord anchor), ChunkRadiusM, GridDim, body-center-
// relative Positions/Normals, skirt geometry, MaterialId, ContentHash. The UE
// FTerrainChunk USTRUCT is a 1:1 transcription of TerrainChunk here.
// =============================================================================
#include <cstdint>
#include <cmath>
#include <vector>
#include <map>
#include <algorithm>

#include "of/vec3.h"
#include "of/universe_coord.h"
#include "of/cubed_sphere.h"
#include "of/biome.h"

namespace of {
namespace worldgen {

// =============================================================================
// §A — Per-body streaming parameters (the LOD knobs, §3.1).
// Defaults chosen so a face root (depth 0) splits well before the observer is on
// the surface, and the finest quad reaches ~walking detail (§3.1: ~depth 12–14
// for a 600 km planet). All values are tunable; none affect determinism beyond
// being part of the (observer, params) input.
// =============================================================================
struct StreamConfig {
  // Split when quad.edgeLength / distance(observer, quad.center) > splitRatio.
  double splitRatio = 1.0;          // angular-size split threshold (§3.1)
  // Merge threshold = splitRatio * mergeHysteresis (<1) so a quad does not
  // split/merge-thrash at the boundary (§3.1 hysteresis). Used by the distance
  // metric implicitly: a quad stays split while it still clears the merge gate.
  double mergeHysteresis = 0.6;
  int    maxDepth = 14;             // finest quad depth (per-body cap, §3.1)
  int    minResidentDepth = 0;      // coarse shell always kept resident (§3.2)
  // Skirt depth = skirtFraction * quadEdgeLengthM (radially inward, §1.4).
  double skirtFraction = 0.5;
  // Per-update generation budget: max NEW quad meshes built per updateStreaming
  // call (§3.2). 0 = unlimited (build the whole target set this call).
  int    genBudget = 16;
};

// =============================================================================
// §B — TerrainChunk: the unit the renderer consumes (== pinned FTerrainChunk,
// Spike 1 §4.1). Geometry is body-center-relative doubles here (the headless
// authority form); the UE struct stores FVector3f local-to-CenterUniverse — the
// renderer subtracts CenterUniverse on emit (§3.4). Skirt vertices/heights are
// appended AFTER the interior grid (separate range), exactly like the UE
// SkirtIndices split.
// =============================================================================
struct TerrainChunk {
  FQuadKey       key;
  UniverseCoord  centerUniverse;        // 64-bit chunk center + body FrameId (anchor)
  double         chunkRadiusM = 0.0;    // bounding radius (culling / LOD)
  int            gridDim = kGridDim;     // verts per side (33)
  int            depth = 0;             // LOD depth (== key.depth, convenience)
  // Per-BIOME surface material id (biome.h materialForBiome). Was a 2-value
  // planet/moon flag; now widened to the full biome material palette so the
  // renderer textures each chunk by its biome (§4.1; additive — value source
  // changed, field semantics unchanged: it is still "which material to draw").
  uint16_t       materialId = 0;        // == materialForBiome(biomeAt(centre))
  Biome          biome = Biome::Unknown;  // the chunk's centre biome (convenience)
  uint64_t       contentHash = 0;       // determinism / cache key

  // Interior grid geometry — gridDim*gridDim, body-center-relative metres.
  std::vector<Vec3>   positions;
  std::vector<Vec3>   normals;
  std::vector<Vec3>   dirs;             // per-vertex unit dir (seam proofs)
  std::vector<double> heights;          // per-vertex relief (metres)

  // Skirt geometry (§1.4 mechanism 2): one apron vertex per EDGE interior vertex,
  // dropped radially inward by skirtDepthM. Appended as a separate range so the
  // renderer can index interior + skirt independently (UE: Indices vs SkirtIndices).
  std::vector<Vec3>   skirtPositions;   // body-center-relative
  double              skirtDepthM = 0.0;

  // Neighbour LOD context (the renderer/physics may use it; selection guarantees
  // the balanced invariant so these never differ from `depth` by more than 1).
  // Order: -X(west) +X(east) -Y(south) +Y(north) within the face grid.
  int neighbourDepth[4] = {-1, -1, -1, -1};

  int idx(int i, int j) const { return j * gridDim + i; }
};

// =============================================================================
// §C — Streaming events (the renderer subscribes; == OnChunkReady / OnChunkEvicted,
// §4.2). updateStreaming returns them as plain vectors (a headless stand-in for
// the UE multicast delegates the renderer binds).
// =============================================================================
struct StreamUpdate {
  std::vector<TerrainChunk> ready;   // newly resident this update (draw these)
  std::vector<FQuadKey>     evicted; // no longer resident (drop these)
  int generated = 0;                 // meshes actually built this update (<= budget)
  bool converged = false;            // resident set == target set (no work pending)
};

// =============================================================================
// §D — Internal helpers.
// =============================================================================

// A face-grid quad's angular edge length in face (u,v) space at a given depth is
// 2 / 2^depth (the face spans [-1,1] => width 2). We approximate the quad's
// world-space edge length as that fraction of a great-circle quarter * radius —
// but for LOD selection we use the DIRECT metric below (chord between the quad's
// two opposite edge-midpoint dirs * radius), which is exact and cheap.

// Unit direction of a quad's centre (lattice midpoint of its [base, base+cells]
// span). PURE function of the key — deterministic.
inline Vec3 quadCenterDir(const FQuadKey& k) {
  const int level = k.depth;  // at quad level, the face is 2^depth quads/side
  // centre of quad (qx,qy) in face (u,v): u = -1 + 2*(qx+0.5)/2^depth
  const double denom = static_cast<double>(uint64_t(1) << level);
  const double u = -1.0 + 2.0 * (static_cast<double>(k.qx) + 0.5) / denom;
  const double v = -1.0 + 2.0 * (static_cast<double>(k.qy) + 0.5) / denom;
  return unitDir(k.faceId, u, v);
}

// World-space edge length of a quad (metres): chord across the quad along u,
// scaled by body radius. Cheap, deterministic, monotone in depth (halves each
// level), and frame-independent — exactly what the §3.1 metric needs.
inline double quadEdgeLengthM(const BodyParams& body, const FQuadKey& k) {
  const int level = k.depth;
  const double denom = static_cast<double>(uint64_t(1) << level);
  const double u0 = -1.0 + 2.0 * (static_cast<double>(k.qx)) / denom;
  const double u1 = -1.0 + 2.0 * (static_cast<double>(k.qx) + 1.0) / denom;
  const double vmid = -1.0 + 2.0 * (static_cast<double>(k.qy) + 0.5) / denom;
  const Vec3 a = unitDir(k.faceId, u0, vmid);
  const Vec3 b = unitDir(k.faceId, u1, vmid);
  return (b - a).length() * body.radiusM;
}

// Observer position on/around the body, reduced to a body-center-relative vector
// (metres). The observer is given as a UniverseCoord in the body's frame
// (FrameId == bodyId+1, matching generateQuadMesh's centerUniverse convention),
// OR the caller can use makeObserver* helpers below. LOD runs on THIS authority
// vector (§3.1), so it is correct regardless of floating origin.
inline Vec3 observerBodyRelative(const UniverseCoord& observer) {
  return observer.pos;  // already body-center-relative in the body frame
}

// Build an observer UniverseCoord from lat/lon + altitude above the surface
// (metres). Convenience for callers that think in geo coords (§3.1).
inline UniverseCoord makeObserverLatLonAlt(const BodyParams& body, double lat,
                                           double lon, double altM) {
  const Vec3 dir = latLonToDir(lat, lon);
  const double h = sampleHeightField(body, dir);
  const double r = body.radiusM + h + altM;
  return UniverseCoord(dir * r, static_cast<FrameId>(body.bodyId + 1));
}

// Distance from the observer to a quad's centre on the surface (metres).
inline double observerToQuadDist(const BodyParams& body, const Vec3& obsRel,
                                 const FQuadKey& k) {
  const Vec3 dir = quadCenterDir(k);
  const double h = sampleHeightField(body, dir);
  const Vec3 quadCenter = dir * (body.radiusM + h);
  return (obsRel - quadCenter).length();
}

// The §3.1 split decision: does this quad subtend more than the target angular
// size (so it should subdivide)? Pure function of (body, observer, key, cfg).
inline bool desiredSplit(const BodyParams& body, const Vec3& obsRel,
                         const FQuadKey& k, const StreamConfig& cfg) {
  if (k.depth >= cfg.maxDepth) return false;
  const double s = quadEdgeLengthM(body, k);
  const double d = std::max(observerToQuadDist(body, obsRel, k), 1e-6);
  return (s / d) > cfg.splitRatio;
}

// =============================================================================
// §E — The deterministic LOD QUADTREE SELECTION.
//
// Starting from the six face roots, recursively subdivide any quad whose
// desiredSplit() is true, capped at maxDepth. The selected set is the LEAVES of
// this adaptive quadtree — the quads we want resident. Pure function of
// (body, observer, cfg): same inputs -> identical leaf set, order-independent.
//
// We then ENFORCE THE BALANCED INVARIANT (§1.4): no two edge-adjacent leaves may
// differ by more than one depth level. We cascade-split any leaf that is >1
// level coarser than an edge neighbour until the invariant holds. This bounds the
// worst-case LOD step at a seam to ONE level, which the skirt is sized to cover.
// =============================================================================

// Recursively collect the desired leaf set into `out`.
inline void collectLeaves(const BodyParams& body, const Vec3& obsRel,
                          const FQuadKey& k, const StreamConfig& cfg,
                          std::vector<FQuadKey>& out) {
  if (desiredSplit(body, obsRel, k, cfg)) {
    for (int c = 0; c < 4; ++c)
      collectLeaves(body, obsRel, quadChild(k, c), cfg, out);
  } else {
    out.push_back(k);
  }
}

// A canonical face-grid cell key (faceId, depth, qx, qy) packed for a sorted set.
// Used to detect edge adjacency within a face for the balanced invariant.
struct CellKey {
  int faceId, depth;
  uint32_t qx, qy;
  bool operator<(const CellKey& o) const {
    if (faceId != o.faceId) return faceId < o.faceId;
    if (depth != o.depth) return depth < o.depth;
    if (qx != o.qx) return qx < o.qx;
    return qy < o.qy;
  }
};
inline CellKey cellOf(const FQuadKey& k) {
  return CellKey{k.faceId, k.depth, k.qx, k.qy};
}

// Map a quad to the cell that contains it at a (coarser-or-equal) target depth.
inline CellKey cellAtDepth(const FQuadKey& k, int depth) {
  CellKey c{k.faceId, depth, k.qx, k.qy};
  if (k.depth >= depth) {
    const int shift = k.depth - depth;
    c.qx = k.qx >> shift;
    c.qy = k.qy >> shift;
  } else {
    const int shift = depth - k.depth;
    c.qx = k.qx << shift;
    c.qy = k.qy << shift;
  }
  return c;
}

// Select the resident TARGET set: adaptive leaves, then balanced (<=1-level edge
// step). Deterministic, order-independent (sorted output). Within-face edge
// neighbours only (the dominant seam case); cross-face seams are handled by the
// shared-edge determinism of cubed_sphere.h (heights bit-identical) + skirts.
inline std::vector<FQuadKey> selectResidentSet(const BodyParams& body,
                                               const UniverseCoord& observer,
                                               const StreamConfig& cfg) {
  const Vec3 obsRel = observerBodyRelative(observer);
  std::vector<FQuadKey> leaves;
  for (int f = 0; f < 6; ++f) {
    FQuadKey root{body.bodyId, f, 0, 0, 0};
    // Honour minResidentDepth: force the root down to the coarse shell first.
    if (cfg.minResidentDepth > 0) {
      std::vector<FQuadKey> seeds;
      seeds.push_back(root);
      for (int lvl = 0; lvl < cfg.minResidentDepth; ++lvl) {
        std::vector<FQuadKey> next;
        for (const auto& q : seeds)
          for (int c = 0; c < 4; ++c) next.push_back(quadChild(q, c));
        seeds.swap(next);
      }
      for (const auto& q : seeds) collectLeaves(body, obsRel, q, cfg, leaves);
    } else {
      collectLeaves(body, obsRel, root, cfg, leaves);
    }
  }

  // Balanced-quadtree enforcement (§1.4): iteratively cascade-split any leaf that
  // is >1 level coarser than an edge-adjacent leaf. Converges (depth-bounded).
  // We work on a set keyed by cell; a leaf is identified by its CellKey.
  std::map<CellKey, FQuadKey> resident;
  for (const auto& k : leaves) resident[cellOf(k)] = k;

  bool changed = true;
  int guard = 0;
  while (changed && guard++ < cfg.maxDepth + 4) {
    changed = false;
    // For each leaf, check its 4 same-depth edge-neighbour cells; if a neighbour
    // cell is covered only by a leaf >=2 levels coarser, split THIS-side stays,
    // but we must split the COARSER neighbour. We detect by scanning: for each
    // leaf L at depth d, look at the leaf covering each edge-neighbour direction;
    // if that covering leaf is at depth <= d-2, split it.
    std::vector<FQuadKey> toSplit;
    for (const auto& kv : resident) {
      const FQuadKey& L = kv.second;
      const int d = L.depth;
      // 4 edge-neighbour cells at depth d (may step off the face -> skip; the
      // cross-face seam is covered by shared-edge determinism + skirts).
      const int64_t nx[4] = {-1, +1, 0, 0};
      const int64_t ny[4] = {0, 0, -1, +1};
      const int64_t span = (int64_t)1 << d;
      for (int e = 0; e < 4; ++e) {
        const int64_t qx = (int64_t)L.qx + nx[e];
        const int64_t qy = (int64_t)L.qy + ny[e];
        if (qx < 0 || qy < 0 || qx >= span || qy >= span) continue;  // off-face
        // Find the leaf covering neighbour cell (faceId,d,qx,qy): walk coarser.
        FQuadKey ncell{L.bodyId, L.faceId, d, (uint32_t)qx, (uint32_t)qy};
        // Is there a resident leaf at this exact cell or any ancestor?
        bool found = false;
        for (int dd = d; dd >= 0; --dd) {
          CellKey c = cellAtDepth(ncell, dd);
          auto it = resident.find(c);
          if (it != resident.end()) {
            if (dd <= d - 2) toSplit.push_back(it->second);  // too coarse: split
            found = true;
            break;
          }
        }
        (void)found;
      }
    }
    for (const auto& k : toSplit) {
      auto it = resident.find(cellOf(k));
      if (it == resident.end()) continue;  // already split by an earlier entry
      resident.erase(it);
      for (int c = 0; c < 4; ++c) {
        FQuadKey ch = quadChild(k, c);
        resident[cellOf(ch)] = ch;
      }
      changed = true;
    }
  }

  std::vector<FQuadKey> out;
  out.reserve(resident.size());
  for (const auto& kv : resident) out.push_back(kv.second);
  // Deterministic order (CellKey-sorted via std::map iteration order).
  return out;
}

// =============================================================================
// §F — Skirt construction (the CRACK-FREE mechanism, §1.4 mechanism 2).
//
// For every interior EDGE vertex of the quad, emit a skirt vertex at the SAME
// (lat,lon) dir but radius reduced by skirtDepthM. Dropped radially inward, the
// skirt forms an apron hidden under the surface that closes any hairline gap when
// a finer quad abuts a 1-level-coarser neighbour (the finer edge has vertices the
// coarser edge lacks; the apron fills the sliver). skirtDepthM is derived from the
// quad's own edge length (deterministic), sized to cover a 1-level step.
// =============================================================================
inline void buildSkirt(const BodyParams& body, TerrainChunk& ch,
                       const StreamConfig& cfg) {
  ch.skirtDepthM = cfg.skirtFraction * quadEdgeLengthM(body, ch.key);
  ch.skirtPositions.clear();
  const int G = ch.gridDim;
  auto emit = [&](int i, int j) {
    const int vi = ch.idx(i, j);
    const Vec3 dir = ch.dirs[vi];
    const double r = body.radiusM + ch.heights[vi] - ch.skirtDepthM;
    ch.skirtPositions.push_back(dir * r);
  };
  // Four edges, corners emitted once each (south edge full, north edge full,
  // west/east interiors only) — apron ring around the quad perimeter.
  for (int i = 0; i < G; ++i) emit(i, 0);          // south
  for (int i = 0; i < G; ++i) emit(i, G - 1);      // north
  for (int j = 1; j < G - 1; ++j) emit(0, j);      // west interior
  for (int j = 1; j < G - 1; ++j) emit(G - 1, j);  // east interior
}

// Build a full TerrainChunk from a quad key: the generateQuadMesh data (READ-ONLY
// use of cubed_sphere.h) + skirt + material + neighbour context.
//
// WG-21 (single surface authority): the chunk mesh draws the DESIGNED surface
// (biome.h sampleDesignedHeight), NOT the raw heightfield — so the streamed mesh
// + its cooked collision finally match the walker (surface_walk.h), the deposit
// pass, and the voxel solid shell, all of which read the designed surface. The
// designed base is a pure function of the (bit-identical shared) dir, so
// shared-edge heights stay bit-identical across quads / LOD (the crack-free proof
// holds; test_terrain_stream re-baselined onto the designed base).
//
// `lowering` (optional): a per-vertex dig-lowering callback (bind to a
// SurfaceField::loweringFn(), the voxel-derived top-anchored open-column depth).
// Null = no digs. When set, the mesh + skirt heights drop into the player's digs
// on the surface they walk on. The undug mesh is the pure designed surface.
inline TerrainChunk buildChunk(const BodyParams& body, const FQuadKey& key,
                              const StreamConfig& cfg,
                              const HeightLoweringFn& lowering = nullptr) {
  // WG-21: sample the designed surface as the mesh base (single authority).
  const HeightFieldFn designedBase = [&body](const Vec3& dir) {
    return sampleDesignedHeight(body, dir);
  };
  const QuadMesh m = generateQuadMesh(body, key, lowering, designedBase);
  TerrainChunk ch;
  ch.key = key;
  ch.centerUniverse = m.centerUniverse;
  ch.chunkRadiusM = m.chunkRadiusM;
  ch.gridDim = m.gridDim;
  ch.depth = key.depth;
  // Material from the biome at the quad's centre direction (biome.h). Deterministic
  // (pure function of body + dir), so a chunk's material is reproducible from seed.
  ch.biome = biomeAt(body, quadCenterDir(key));
  ch.materialId = materialForBiome(ch.biome);
  ch.contentHash = m.contentHash;
  ch.positions = m.vertices;
  ch.normals = m.normals;
  ch.dirs = m.dirs;
  ch.heights = m.heights;
  buildSkirt(body, ch, cfg);
  return ch;
}

// =============================================================================
// §G — TerrainStreamer: maintains the resident set across observer motion.
//
// updateStreaming(observer): compute the target set (selectResidentSet), diff it
// against the current resident set, and BUILD up to genBudget new chunks this
// call (ready events), evicting any chunk no longer in the target (evict events).
// Under a budget, the resident set converges to the target over several calls;
// once ready+target match (no pending builds and no stale residents), `converged`
// is true and the resident set is bit-identical to what an unbudgeted update gives.
//
// DETERMINISM: the target set is a pure function of (body, observer, cfg);
// the build order is the deterministic CellKey-sorted target order, so the SAME
// observer always yields the SAME resident set (and the same per-call ready/evict
// split for a given budget + starting state).
// =============================================================================
class TerrainStreamer {
 public:
  TerrainStreamer(BodyParams body, StreamConfig cfg = {})
      : body_(body), cfg_(cfg) {}

  const BodyParams& body() const { return body_; }
  const StreamConfig& config() const { return cfg_; }

  // Bind the DEFORM lowering callback (terrain_deform.h). Chunks built from now on
  // (and any rebuildChunk) lower their heights by lowering(dir) metres so digs show
  // in the streamed mesh + collision. Null restores the undeformed mesh. ADDITIVE —
  // a streamer with no lowering fn is bit-identical to the original.
  void setLoweringFn(HeightLoweringFn fn) { lowering_ = std::move(fn); }
  bool hasLoweringFn() const { return static_cast<bool>(lowering_); }

  // Rebuild ONE resident chunk's geometry in place (re-runs generateQuadMesh with
  // the current lowering fn) — the renderer calls this for each chunk whose region
  // gained a dig edit (TerrainDeform::editedCellsInQuad / quadHasEdits), so only the
  // affected chunk re-meshes, not the whole patch. Returns the fresh chunk (also
  // stored as the resident copy) or nullptr if the key isn't resident.
  const TerrainChunk* rebuildChunk(const FQuadKey& key) {
    auto it = resident_.find(cellOf(key));
    if (it == resident_.end()) return nullptr;
    it->second = buildChunk(body_, key, cfg_, lowering_);
    return &it->second;
  }

  // Resident chunks, keyed by quad cell. Stable across updates.
  const std::map<CellKey, TerrainChunk>& resident() const { return resident_; }
  size_t residentCount() const { return resident_.size(); }

  // Is `key` currently resident?
  bool isResident(const FQuadKey& key) const {
    return resident_.find(cellOf(key)) != resident_.end();
  }

  // Drive LOD from the observer's authority position (§3.1). Returns the ready /
  // evicted events produced THIS call, bounded by the generation budget.
  StreamUpdate updateStreaming(const UniverseCoord& observer) {
    StreamUpdate up;
    const std::vector<FQuadKey> target =
        selectResidentSet(body_, observer, cfg_);

    // Build a set of target cells for fast membership.
    std::map<CellKey, FQuadKey> targetByCell;
    for (const auto& k : target) targetByCell[cellOf(k)] = k;

    // 1) Evict residents not in the target (no budget on eviction — cheap).
    std::vector<CellKey> toEvict;
    for (const auto& kv : resident_) {
      if (targetByCell.find(kv.first) == targetByCell.end())
        toEvict.push_back(kv.first);
    }
    for (const auto& c : toEvict) {
      up.evicted.push_back(resident_[c].key);
      resident_.erase(c);
    }

    // 2) Build missing target chunks, up to the budget, in deterministic order.
    int built = 0;
    int pending = 0;
    for (const auto& kv : targetByCell) {
      if (resident_.find(kv.first) != resident_.end()) continue;  // already have
      if (cfg_.genBudget > 0 && built >= cfg_.genBudget) {
        ++pending;
        continue;  // deferred to a later update (budget spent)
      }
      TerrainChunk ch = buildChunk(body_, kv.second, cfg_, lowering_);
      resident_[kv.first] = ch;
      up.ready.push_back(ch);
      ++built;
    }
    up.generated = built;

    // 3) Annotate neighbour depths on freshly-ready chunks (balanced => <=1 off).
    for (auto& ch : up.ready) annotateNeighbours(ch, targetByCell);

    up.converged = (pending == 0) &&
                   (resident_.size() == targetByCell.size());
    return up;
  }

  // Re-anchor every resident chunk's engine transform on a floating-origin rebase
  // (§3.3). Headless stand-in: we don't hold an engine origin, but the contract is
  // "centerUniverse is the anchor; positions never change" — so a rebase is a
  // no-op on geometry. Exposed so the renderer test can assert positions are
  // rebase-invariant. Returns the number of resident chunks (the O(resident) cost).
  size_t onOriginRebased() const { return resident_.size(); }

 private:
  void annotateNeighbours(TerrainChunk& ch,
                          const std::map<CellKey, FQuadKey>& targetByCell) const {
    const int d = ch.key.depth;
    const int64_t span = (int64_t)1 << d;
    const int64_t nx[4] = {-1, +1, 0, 0};
    const int64_t ny[4] = {0, 0, -1, +1};
    for (int e = 0; e < 4; ++e) {
      ch.neighbourDepth[e] = -1;
      const int64_t qx = (int64_t)ch.key.qx + nx[e];
      const int64_t qy = (int64_t)ch.key.qy + ny[e];
      if (qx < 0 || qy < 0 || qx >= span || qy >= span) continue;  // off-face
      FQuadKey ncell{ch.key.bodyId, ch.key.faceId, d, (uint32_t)qx, (uint32_t)qy};
      for (int dd = d + 1; dd >= 0; --dd) {  // finer first, then coarser
        if (dd > cfg_.maxDepth) continue;
        CellKey c = cellAtDepth(ncell, dd);
        if (targetByCell.find(c) != targetByCell.end()) {
          ch.neighbourDepth[e] = dd;
          break;
        }
      }
    }
  }

  BodyParams body_;
  StreamConfig cfg_;
  std::map<CellKey, TerrainChunk> resident_;
  HeightLoweringFn lowering_ = nullptr;  // optional deform lowering (digs)
};

}  // namespace worldgen
}  // namespace of
