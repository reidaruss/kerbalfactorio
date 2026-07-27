#pragma once
// =============================================================================
// surface_field.h — THE SINGLE SURFACE AUTHORITY ("surface oracle", WG-21).
//
// One truth for "what IS the surface", replacing the five competing definitions
// that produced every floating / air-gap experience bug (RETHINK §3 RC-A,
// docs/review-2026-06-16/core-docs-audit.md Task B). Before this file the engine
// held: RAW (cubed_sphere.h sampleHeightField), DESIGNED (biome.h
// sampleDesignedHeight), DEFORMED (terrain_deform.h), the MESH (RAW minus the
// deform edits — a DIFFERENT base for the same edit map!), and VOXEL-SOLID (RAW
// again). The bedrock clamp lived on only one path; two /core comments asserted
// consistencies that were false. Every consumer that read a different surface
// than its neighbour is where a node floated, a player hovered, or a dig landed
// in air.
//
// THE MODEL (one truth, three layers):
//   * BASE   = baseHeight(body, dir) ≡ sampleDesignedHeight(body, dir). The
//     DESIGNED relief is the canonical surface everyone samples. RAW
//     (sampleHeightField) is retained ONLY as an internal ingredient of the
//     designed shaping — it is never a surface anyone stands on / collides with.
//   * VOXELS = the sole destruction edit store. Solidity derives from the SAME
//     base: solidCell(cell) = |cellCentre| <= radiusM + baseHeight(unitDir(centre))
//     AND NOT removed(cell). (voxel_terrain.h's isProcSolid switched RAW->DESIGNED
//     via this oracle — which retires the UE 18 m "surface-snap" hack's root
//     cause: the mesh/collision and the voxel solid shell now agree.)
//   * DERIVED LOWERING = the far-field / heightfield VIEW of the voxel digs. For
//     a surface dir, the depth of the TOP-ANCHORED contiguous removed-voxel run
//     in that column (the UE OpenColumn logic, promoted into core). A sideways
//     tunnel under solid ground has solid cells at the top of its column, so it
//     produces NO lowering (the ceiling stays intact) — exactly what a heightfield
//     view of a tunnel must do.
//
//   surfaceHeight(body, dir, voxelEdits)
//       = clamp(baseHeight − derivedLowering, baseHeight − maxDigDepth)
//   is the ONE surface the chunk mesh, collision, the walker, and node/foliage
//   placement all read. The bedrock clamp is defined HERE and nowhere else.
//
// terrain_deform.h is DEMOTED (WG-21): kept compiling as a derived far/mid
// heightfield LAYER, but it is NO LONGER an independent edit authority. This
// oracle does NOT read a TerrainDeform edit store — surfaceHeight reads the
// voxel-derived lowering. (Migration note for R2: the UE pickaxe/miner currently
// write BOTH the voxel set and the deform store; after R2 they write voxels only,
// and the deform store is regenerated as this derived view on load, not persisted.)
//
// DETERMINISM (WG-6 discipline, inherited): baseHeight is a pure function of
// (body, dir); solidity + lowering are pure functions of (body, dir, removed set).
// Same inputs -> same bits on any machine. The seam bit-identity property is
// PRESERVED: designed height is a pure function of the (bit-identical) shared dir,
// so two quads sharing an edge sample the same base -> the same surface bits.
//
// Header-only C++17. Consumes cubed_sphere.h + biome.h + voxel_terrain.h
// READ-ONLY. No UE, no rendering, no physics — the isolation harness the UE
// surface layer binds to (R2 wires the UE side against the entry points below).
// =============================================================================
#include <algorithm>
#include <cstdint>
#include <cmath>
#include <functional>

#include "of/vec3.h"
#include "of/cubed_sphere.h"
#include "of/biome.h"
#include "of/voxel_terrain.h"
#include "of/voxel_field.h"

namespace of {
namespace worldgen {

// =============================================================================
// §1 — BASE height (the DESIGNED surface, the one canonical relief).
//
// baseHeight ≡ sampleDesignedHeight. A thin, INTENTIONAL alias so the whole
// codebase can name "the surface base" through one symbol; RAW sampleHeightField
// is never called by a surface consumer again (it survives only inside the
// designed shaping). Keeping the alias (rather than renaming) means biome.h stays
// the definition site and the pinned designed-edge identity test is untouched.
// =============================================================================
inline double baseHeight(const BodyParams& body, const Vec3& dir) {
  return sampleDesignedHeight(body, dir);
}

// Absolute surface radius (body radius + designed relief) under a dir, no edits.
inline double baseSurfaceRadius(const BodyParams& body, const Vec3& dir) {
  return body.radiusM + baseHeight(body, dir);
}

// =============================================================================
// §2 — Default bedrock floor (the ONE dig-depth limit).
//
// Mirrors terrain_deform.h's historical kDefaultMaxDigDepthM (80 m) so the single
// clamp defined here matches the depth the deform layer used to enforce on its own
// path. This is now the ONLY place the clamp is applied for the heightfield view.
// =============================================================================
static constexpr double kSurfaceMaxDigDepthM = 80.0;

// The mirror limit for PLACED ground (WG-22). A filled column can raise the
// heightfield view by at most this much above the designed base. It is far
// smaller than the dig depth on purpose: digging follows real rock down to
// bedrock, whereas fill is material the player carried, and a heightfield that
// can be raised 80 m turns a build pad into a tower the LOD was never sized for.
// The VOXEL layer is not limited by this — a filled cell above the cap is still
// solid and still walkable, it simply stops moving the smooth far-field surface,
// exactly as a sideways tunnel stops moving it downward.
static constexpr double kSurfaceMaxFillM = 24.0;

// =============================================================================
// §3 — THE EDITED SURFACE, root-found on the density field (WG-24).
//
// WG-21 read the far-field view of a dig as the depth of the TOP-ANCHORED
// contiguous run of removed CELLS in a column, and WG-22 mirrored it for placed
// ground. That rule existed because the store was a set of cells: there was
// nothing continuous to ask. It also had to be propped up, because a run of
// cells breaks the moment one cell in it is already in the state the op wanted,
// which on a staircase surface happens constantly (WG-23 measured 8.7% of the
// columns inside a levelled pad keeping their original height, worst 2.5 m out,
// and had to make levelling RECORD its decision over a band to keep the run
// unbroken).
//
// On a signed field none of that is needed. The surface under a direction is the
// topmost radius at which the field turns solid, found by sphere-tracing down the
// radial and refining the bracket (voxel_field.h §4). A sideways tunnel still
// lowers nothing, for the same physical reason as before and now automatically:
// the rock above it is solid, so the topmost crossing has not moved. The
// band-recording prosthetic is deleted, and with it the class of bug it existed
// to paper over.
//
// LOWERING and RAISING survive as NAMES, because callers and the bridge ask for
// them, but they are now views of the one root find rather than two independent
// walks that could disagree with each other.
// =============================================================================
inline double surfaceHeight(const BodyParams& body, const Vec3& dir,
                            const DensityField& edits,
                            double maxDigDepthM = kSurfaceMaxDigDepthM,
                            double maxFillM = kSurfaceMaxFillM) {
  const double base = baseHeight(body, dir);
  if (edits.empty()) return base;                     // bit-identical undug path
  double h = columnSurfaceHeight(body, edits, dir, maxDigDepthM, maxFillM);
  const double floorH = base - maxDigDepthM;          // the ONE bedrock clamp
  const double ceilH = base + maxFillM;               // and its WG-22 mirror
  if (h < floorH) h = floorH;
  if (h > ceilH) h = ceilH;
  return h;
}

/** Metres the edited surface sits BELOW the designed base under this dir. */
inline double derivedLoweringAt(const BodyParams& body, const Vec3& dir,
                                const DensityField& edits,
                                double maxDigDepthM = kSurfaceMaxDigDepthM) {
  const double d = baseHeight(body, dir) -
                   surfaceHeight(body, dir, edits, maxDigDepthM, kSurfaceMaxFillM);
  return d > 0.0 ? d : 0.0;
}

/** Metres the edited surface sits ABOVE the designed base under this dir. */
inline double derivedRaisingAt(const BodyParams& body, const Vec3& dir,
                               const DensityField& edits,
                               double maxFillM = kSurfaceMaxFillM) {
  const double d = surfaceHeight(body, dir, edits, kSurfaceMaxDigDepthM, maxFillM) -
                   baseHeight(body, dir);
  return d > 0.0 ? d : 0.0;
}

// The SIGNED offset of the edited surface from the designed base, in metres DOWN
// (negative = the surface moved up). This is what the chunk mesher subtracts, so
// one callback carries both halves of terraforming and generateQuadMesh needs no
// second hook. Exactly `baseHeight - surfaceHeight` by construction.
inline double surfaceOffsetAt(const BodyParams& body, const Vec3& dir,
                              const DensityField& edits,
                              double maxDigDepthM = kSurfaceMaxDigDepthM,
                              double maxFillM = kSurfaceMaxFillM) {
  return baseHeight(body, dir)
       - surfaceHeight(body, dir, edits, maxDigDepthM, maxFillM);
}

// Undug overload (no voxel edits): surfaceHeight == baseHeight.
inline double surfaceHeight(const BodyParams& body, const Vec3& dir) {
  return baseHeight(body, dir);
}

// Absolute surface radius (metres from centre) including lowering and raising.
inline double surfaceRadius(const BodyParams& body, const Vec3& dir,
                            const DensityField& edits,
                            double maxDigDepthM = kSurfaceMaxDigDepthM,
                            double maxFillM = kSurfaceMaxFillM) {
  return body.radiusM + surfaceHeight(body, dir, edits, maxDigDepthM, maxFillM);
}

// =============================================================================
// §5 — VOXEL SOLIDITY, the two named shapes of "solid" (DW-26).
//
// DW-26's rule survives the representation change and so does its bound. One
// authority still has to answer this question in two shapes, so both are still
// published by name and the ctest still asserts the size of their disagreement.
// What changed is which of the two shapes the MESHER draws.
//
//   solidCell   — the CELL-quantised answer: the field sampled at the cell's own
//                 centre. Region iteration, harvest counting and the dirty AABB
//                 are all cell-shaped, so this shape is still needed. It is a
//                 quantised VIEW of the field below it, never a second authority.
//   solidAt     — the CONTINUOUS answer: the field at the point. A body occupies
//                 this shape, and so does the aim ray.
//
// The two can disagree only where a point and its cell centre straddle the zero
// level, so the bound is still half a cell diagonal, 0.866 m, and it is still
// asserted (test_voxel_field.cpp measures 0.4012 m worst against it).
//
// THE BOUND THAT ACTUALLY HURT was never that one. It was the distance between
// the surface DRAWN and the surface COLLIDED, which on the old model was the same
// 0.866 m because the mesher drew whole cell faces: the walker collided with rock
// above the ground it stood on, the aim ray stopped short on invisible rock, and
// the near mesh drew black spikes over terraformed ground. Surface nets emits the
// zero level of THIS field, so the drawn surface and solidAt are the same
// surface, and the residual is the field's own interpolation error over one cell:
// MEASURED 0.087116 m, asserted at a quarter of a cell.
// =============================================================================
inline bool solidCell(const BodyParams& body, const VoxelCell& cell,
                      const DensityField& edits) {
  return edits.solidCell(body, cell);
}
inline bool solidAt(const BodyParams& body, const Vec3& bodyFramePos,
                    const DensityField& edits) {
  return edits.solidAt(body, bodyFramePos);
}

// =============================================================================
// §6 — SurfaceField: a bound (body, edits) view — the object callers hold.
//
// A thin binder over the free functions above so a consumer that already has
// "the body plus the player's terrain diff" queries the ONE surface without
// re-passing them. A null DensityField* means the undug base everywhere (the
// far-from-player / freshly-generated case).
// =============================================================================
class SurfaceField {
 public:
  SurfaceField(const BodyParams& body, const DensityField* edits,
               double maxDigDepthM = kSurfaceMaxDigDepthM)
      : body_(body), edits_(edits), maxDigDepthM_(maxDigDepthM) {}

  const BodyParams& body() const { return body_; }
  double maxDigDepth() const { return maxDigDepthM_; }

  double baseHeightAt(const Vec3& dir) const { return baseHeight(body_, dir); }

  double heightAt(const Vec3& dir) const {
    return edits_ ? surfaceHeight(body_, dir, *edits_, maxDigDepthM_, maxFillM_)
                  : baseHeight(body_, dir);
  }
  double radiusAt(const Vec3& dir) const { return body_.radiusM + heightAt(dir); }

  double loweringAt(const Vec3& dir) const {
    return edits_ ? derivedLoweringAt(body_, dir, *edits_, maxDigDepthM_) : 0.0;
  }
  double raisingAt(const Vec3& dir) const {
    return edits_ ? derivedRaisingAt(body_, dir, *edits_, maxFillM_) : 0.0;
  }

  bool solid(const VoxelCell& cell) const {
    if (edits_) return edits_->solidCell(body_, cell);
    return isProcSolid(body_, cell);
  }
  bool solidAtPos(const Vec3& bodyFramePos) const {
    if (edits_) return edits_->solidAt(body_, bodyFramePos);
    return procDensityAt(body_, bodyFramePos) >= 0.0;
  }

  // A HeightLoweringFn (cubed_sphere.h) bound to this field's SIGNED surface
  // offset. Pass to generateQuadMesh / buildChunk so the streamed mesh drops
  // exactly where the player dug an open column and RISES exactly where they
  // filled one. The callback returns metres DOWN, so a negative value raises;
  // generateQuadMesh subtracts it either way and needs no second hook.
  HeightLoweringFn loweringFn() const {
    const BodyParams body = body_;         // capture by value (dir-pure)
    const DensityField* edits = edits_;
    const double maxDig = maxDigDepthM_;
    const double maxFill = maxFillM_;
    return [body, edits, maxDig, maxFill](const Vec3& dir) -> double {
      return edits ? surfaceOffsetAt(body, dir, *edits, maxDig, maxFill) : 0.0;
    };
  }

 private:
  BodyParams body_;
  const DensityField* edits_ = nullptr;
  double maxDigDepthM_ = kSurfaceMaxDigDepthM;
  double maxFillM_ = kSurfaceMaxFillM;
};

// =============================================================================
// §7 — levelArea: the TERRAFORMING op, now one line over the field.
//
// The rule is unchanged from WG-22 and the name is kept because the bridge and
// the client ask for it. The IMPLEMENTATION is voxel_field.h's levelDisc, which
// assigns the plane's own signed distance inside the disc, so the extracted
// surface IS the plane rather than the lattice's best staircase approximation to
// it. WG-23's kLevelRecordBandM prosthetic is gone: it existed to keep a run of
// edited CELLS unbroken for a column walk that no longer happens.
// =============================================================================
struct LevelResult {
  int dug = 0;      // cells that changed solid -> air
  int filled = 0;   // cells that changed air -> solid
  int scanned = 0;  // corners the op considered
  // Corners whose STORED DISTANCE moved. This is the honest "did the op do
  // anything", and on a signed field it is frequently non-zero while dug and
  // filled are both zero: shaving 40 cm off a slope moves the surface everywhere
  // under the disc without moving a single cell CENTRE across the zero level.
  // The client used to gate its re-mesh on cells changing, so a real levelling
  // op drew nothing and read to the player as a dead key. That is WG-23's
  // complaint with a new cause, which is why the count the client watches has to
  // be the one that measures the diff rather than the one that measures cells.
  int corners = 0;
  int cells() const { return dug + filled; }
};

inline LevelResult levelArea(const BodyParams& body, DensityField& edits,
                             const Vec3& centerPos, double radiusM,
                             double targetHeightM,
                             double maxCutM = kSurfaceMaxFillM,
                             double maxFillM = kSurfaceMaxFillM) {
  const LevelDiscResult r =
      levelDisc(body, edits, centerPos, radiusM, targetHeightM, maxCutM, maxFillM);
  LevelResult out;
  out.dug = r.dug;
  out.filled = r.filled;
  out.scanned = r.scanned;
  out.corners = r.corners;
  return out;
}

}  // namespace worldgen
}  // namespace of
