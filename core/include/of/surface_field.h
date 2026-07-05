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
#include <cstdint>
#include <cmath>
#include <functional>

#include "of/vec3.h"
#include "of/cubed_sphere.h"
#include "of/biome.h"
#include "of/voxel_terrain.h"

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

// =============================================================================
// §3 — DERIVED LOWERING (the far-field heightfield view of voxel digs).
//
// This is the UE OpenColumn logic (OFPlanetTerrain.cpp) promoted into /core so it
// is testable and single-sourced. For a surface dir, walk DOWN the column from the
// (designed) surface one voxel step (kVoxelSizeM) at a time; count the CONTIGUOUS
// run of REMOVED cells that starts AT the surface. Stop at the first solid cell:
//   * A dig-down pit -> the top cells are removed -> the run == the pit depth ->
//     the heightfield lowers to match the mouth.
//   * A sideways tunnel below intact ground -> the top cell is still solid -> the
//     run is 0 -> NO lowering (the ceiling/overhang is preserved). The voxel layer
//     alone carries the tunnel; the smooth heightfield never sees it.
// Bounded by maxDigDepth (bedrock). PURE function of (body, dir, removed set).
//
// We test isRemoved (NOT isProcSolid) for the run so a tunnel whose mouth cells
// were procedurally air (e.g. a pit dug into a slope) still reads correctly: the
// "opening" is the run of explicitly-removed cells from the surface downward.
// (Matches the UE OpenColumn, which counted Voxels.isRemoved(cellForPos(p)).)
// =============================================================================
inline double derivedLoweringAt(const BodyParams& body, const Vec3& dir,
                                const VoxelEdits& edits,
                                double maxDigDepthM = kSurfaceMaxDigDepthM) {
  if (edits.empty()) return 0.0;  // no digs -> bit-identical undug path
  const Vec3 u = unitOf(dir);
  const double surfR = baseSurfaceRadius(body, u);
  double open = 0.0;
  // Step down in 1 m (kVoxelSizeM) increments; sample the cell centre at each
  // depth (surfR - d - 0.5 puts the probe at the centre of the d-th metre cell).
  for (double d = 0.0; d <= maxDigDepthM; d += kVoxelSizeM) {
    const Vec3 p = u * (surfR - d - 0.5 * kVoxelSizeM);
    if (edits.isRemoved(cellForPos(p))) {
      open = d + kVoxelSizeM;   // this metre is open; the run extends this far
    } else {
      break;                    // hit solid -> ceiling; stop (don't open below it)
    }
  }
  if (open > maxDigDepthM) open = maxDigDepthM;
  return open;
}

// =============================================================================
// §4 — surfaceHeight: the ONE surface the whole engine reads.
//
//   surfaceHeight = clamp(baseHeight − derivedLowering, baseHeight − maxDigDepth)
//
// The single bedrock clamp lives here. Where nothing is dug (edits empty, or the
// column is unopened) this returns baseHeight BIT-IDENTICALLY — no regression to
// the designed terrain. Overload without edits = the base (an undug body).
// =============================================================================
inline double surfaceHeight(const BodyParams& body, const Vec3& dir,
                            const VoxelEdits& edits,
                            double maxDigDepthM = kSurfaceMaxDigDepthM) {
  const double base = baseHeight(body, dir);
  const double lowering = derivedLoweringAt(body, dir, edits, maxDigDepthM);
  if (lowering <= 0.0) return base;                 // bit-identical undug path
  double h = base - lowering;
  const double floorH = base - maxDigDepthM;        // bedrock under this dir
  if (h < floorH) h = floorH;                       // the ONE clamp
  return h;
}

// Undug overload (no voxel edits): surfaceHeight ≡ baseHeight.
inline double surfaceHeight(const BodyParams& body, const Vec3& dir) {
  return baseHeight(body, dir);
}

// Absolute surface radius (metres from centre) including derived lowering.
inline double surfaceRadius(const BodyParams& body, const Vec3& dir,
                            const VoxelEdits& edits,
                            double maxDigDepthM = kSurfaceMaxDigDepthM) {
  return body.radiusM + surfaceHeight(body, dir, edits, maxDigDepthM);
}

// =============================================================================
// §5 — VOXEL SOLIDITY derived from the SAME base (designed, not raw).
//
// A cell is solid iff its centre is at/below the DESIGNED surface radius AND it is
// not in the removed set. Identical shape to voxel_terrain.h's isSolid, but the
// surface radius comes from baseHeight (designed) — so the voxel solid shell and
// the rendered/collision mesh finally agree (the raw/designed gap is gone).
// voxel_terrain.h's own isProcSolid/surfaceRadiusAt are switched to designed too
// (they route through baseHeight), so isSolid(body, cell) and solidCell here are
// the same predicate; this is the oracle-named entry point.
// =============================================================================
inline bool solidCell(const BodyParams& body, const VoxelCell& cell,
                      const VoxelEdits& edits) {
  return edits.isSolid(body, cell);  // designed-based after the RAW->DESIGNED switch
}
inline bool solidAt(const BodyParams& body, const Vec3& bodyFramePos,
                    const VoxelEdits& edits) {
  return edits.isSolidAt(body, bodyFramePos);
}

// =============================================================================
// §6 — SurfaceField: a bound (body, voxelEdits) view — the object callers hold.
//
// The audit's proposed type: worldgen::SurfaceField { const BodyParams&; const
// VoxelEdits*; }. A thin binder over the free functions above so a consumer that
// already has "the body + the player's voxel diff" queries the ONE surface without
// re-passing them. A null VoxelEdits* means the undug base everywhere (the
// far-from-player / freshly-generated case).
// =============================================================================
class SurfaceField {
 public:
  SurfaceField(const BodyParams& body, const VoxelEdits* edits,
               double maxDigDepthM = kSurfaceMaxDigDepthM)
      : body_(body), edits_(edits), maxDigDepthM_(maxDigDepthM) {}

  const BodyParams& body() const { return body_; }
  double maxDigDepth() const { return maxDigDepthM_; }

  // The designed base (no edits) under a dir.
  double baseHeightAt(const Vec3& dir) const { return baseHeight(body_, dir); }

  // The ONE surface (base − derived voxel lowering, bedrock-clamped) under a dir.
  double heightAt(const Vec3& dir) const {
    return edits_ ? surfaceHeight(body_, dir, *edits_, maxDigDepthM_)
                  : baseHeight(body_, dir);
  }
  double radiusAt(const Vec3& dir) const { return body_.radiusM + heightAt(dir); }

  // The far-field lowering (0 if no top-anchored open column here).
  double loweringAt(const Vec3& dir) const {
    return edits_ ? derivedLoweringAt(body_, dir, *edits_, maxDigDepthM_) : 0.0;
  }

  // Voxel solidity (designed base XOR removed). No edits bound -> procedural solid.
  bool solid(const VoxelCell& cell) const {
    if (edits_) return edits_->isSolid(body_, cell);
    return isProcSolid(body_, cell);
  }
  bool solidAtPos(const Vec3& bodyFramePos) const {
    return solid(cellForPos(bodyFramePos));
  }

  // A HeightLoweringFn (cubed_sphere.h) bound to this field's derived lowering —
  // pass to generateQuadMesh / buildChunk so the streamed mesh lowers exactly
  // where the player has dug an open column (and nowhere a tunnel merely passes).
  HeightLoweringFn loweringFn() const {
    const BodyParams body = body_;         // capture by value (dir-pure)
    const VoxelEdits* edits = edits_;
    const double maxDig = maxDigDepthM_;
    return [body, edits, maxDig](const Vec3& dir) -> double {
      return edits ? derivedLoweringAt(body, dir, *edits, maxDig) : 0.0;
    };
  }

 private:
  BodyParams body_;
  const VoxelEdits* edits_ = nullptr;
  double maxDigDepthM_ = kSurfaceMaxDigDepthM;
};

}  // namespace worldgen
}  // namespace of
