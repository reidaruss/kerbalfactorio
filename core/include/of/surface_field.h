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
// §3b — DERIVED RAISING (the far-field heightfield view of PLACED ground, WG-22).
//
// The exact mirror of derivedLoweringAt, and it has to exist for the same reason
// that one does: the heightfield is what the streamed mesh, the LOD metric and
// the far-field walker read, so ground the player PUT DOWN has to show up there
// or the surface disagrees with the voxels — the five-surfaces failure, restaged
// with the sign flipped.
//
// For a surface dir, walk UP from the designed surface one voxel step at a time
// and count the CONTIGUOUS run of ADDED cells that starts AT the surface. Stop
// at the first cell that is not filled:
//   * A levelled pad on a hollow -> the cells above the base are filled -> the run
//     is the pad's thickness -> the heightfield rises to meet it.
//   * A filled cell floating above a gap (a bridge, a roof) -> the cell directly
//     above the surface is NOT filled -> the run is 0 -> NO raising. The voxel
//     layer alone carries it, exactly as it alone carries a tunnel.
// Bounded by maxFillM. PURE function of (body, dir, added set).
// =============================================================================
inline double derivedRaisingAt(const BodyParams& body, const Vec3& dir,
                               const VoxelEdits& edits,
                               double maxFillM = kSurfaceMaxFillM) {
  if (edits.addedCount() == 0) return 0.0;  // no fill -> bit-identical old path
  const Vec3 u = unitOf(dir);
  const double surfR = baseSurfaceRadius(body, u);
  double placed = 0.0;
  for (double d = 0.0; d < maxFillM; d += kVoxelSizeM) {
    // surfR + d + 0.5 is the centre of the d-th metre cell ABOVE the base.
    const Vec3 p = u * (surfR + d + 0.5 * kVoxelSizeM);
    if (edits.isAdded(cellForPos(p))) placed = d + kVoxelSizeM;
    else break;                            // first unfilled cell ends the run
  }
  if (placed > maxFillM) placed = maxFillM;
  return placed;
}

// =============================================================================
// §4 — surfaceHeight: the ONE surface the whole engine reads.
//
//   surfaceHeight = clamp(baseHeight − derivedLowering + derivedRaising,
//                         baseHeight − maxDigDepth, baseHeight + maxFill)
//
// The single bedrock clamp lives here, and so does its WG-22 mirror. The two runs
// read DIFFERENT cells (raising walks up from the base, lowering walks down), so
// both can be non-zero at once: a player who digs a pit and then fills it above
// the old ground line. Raising is resolved FIRST and wins, because the topmost
// solid surface is the one you stand on and it is the placed pad, not the buried
// pit under it.
//
// Where nothing is dug or filled (edits empty, or the column is untouched) this
// returns baseHeight BIT-IDENTICALLY — no regression to the designed terrain.
// Overload without edits = the base (an unedited body).
// =============================================================================
inline double surfaceHeight(const BodyParams& body, const Vec3& dir,
                            const VoxelEdits& edits,
                            double maxDigDepthM = kSurfaceMaxDigDepthM,
                            double maxFillM = kSurfaceMaxFillM) {
  const double base = baseHeight(body, dir);
  const double raising = derivedRaisingAt(body, dir, edits, maxFillM);
  if (raising > 0.0) {
    double h = base + raising;
    const double ceilH = base + maxFillM;           // the fill cap
    if (h > ceilH) h = ceilH;
    return h;
  }
  const double lowering = derivedLoweringAt(body, dir, edits, maxDigDepthM);
  if (lowering <= 0.0) return base;                 // bit-identical unedited path
  double h = base - lowering;
  const double floorH = base - maxDigDepthM;        // bedrock under this dir
  if (h < floorH) h = floorH;                       // the ONE clamp
  return h;
}

// The SIGNED offset of the edited surface from the designed base, in metres DOWN
// (negative = the surface moved up). This is what the chunk mesher subtracts, so
// one callback carries both halves of terraforming and generateQuadMesh needs no
// second hook. Exactly `baseHeight − surfaceHeight` by construction.
inline double surfaceOffsetAt(const BodyParams& body, const Vec3& dir,
                              const VoxelEdits& edits,
                              double maxDigDepthM = kSurfaceMaxDigDepthM,
                              double maxFillM = kSurfaceMaxFillM) {
  return baseHeight(body, dir)
       - surfaceHeight(body, dir, edits, maxDigDepthM, maxFillM);
}

// Undug overload (no voxel edits): surfaceHeight ≡ baseHeight.
inline double surfaceHeight(const BodyParams& body, const Vec3& dir) {
  return baseHeight(body, dir);
}

// Absolute surface radius (metres from centre) including lowering and raising.
inline double surfaceRadius(const BodyParams& body, const Vec3& dir,
                            const VoxelEdits& edits,
                            double maxDigDepthM = kSurfaceMaxDigDepthM,
                            double maxFillM = kSurfaceMaxFillM) {
  return body.radiusM + surfaceHeight(body, dir, edits, maxDigDepthM, maxFillM);
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

  // The ONE surface (base − lowering + raising, clamped both ways) under a dir.
  double heightAt(const Vec3& dir) const {
    return edits_ ? surfaceHeight(body_, dir, *edits_, maxDigDepthM_, maxFillM_)
                  : baseHeight(body_, dir);
  }
  double radiusAt(const Vec3& dir) const { return body_.radiusM + heightAt(dir); }

  // The far-field lowering (0 if no top-anchored open column here).
  double loweringAt(const Vec3& dir) const {
    return edits_ ? derivedLoweringAt(body_, dir, *edits_, maxDigDepthM_) : 0.0;
  }
  // The far-field raising (0 if nothing is stacked on the base here). WG-22.
  double raisingAt(const Vec3& dir) const {
    return edits_ ? derivedRaisingAt(body_, dir, *edits_, maxFillM_) : 0.0;
  }

  // Voxel solidity (designed base XOR removed). No edits bound -> procedural solid.
  bool solid(const VoxelCell& cell) const {
    if (edits_) return edits_->isSolid(body_, cell);
    return isProcSolid(body_, cell);
  }
  bool solidAtPos(const Vec3& bodyFramePos) const {
    return solid(cellForPos(bodyFramePos));
  }

  // A HeightLoweringFn (cubed_sphere.h) bound to this field's SIGNED surface
  // offset — pass to generateQuadMesh / buildChunk so the streamed mesh drops
  // exactly where the player dug an open column (and nowhere a tunnel merely
  // passes) and RISES exactly where they filled one (WG-22). The callback returns
  // metres DOWN, so a negative value raises; generateQuadMesh subtracts it either
  // way and needs no second hook.
  HeightLoweringFn loweringFn() const {
    const BodyParams body = body_;         // capture by value (dir-pure)
    const VoxelEdits* edits = edits_;
    const double maxDig = maxDigDepthM_;
    const double maxFill = maxFillM_;
    return [body, edits, maxDig, maxFill](const Vec3& dir) -> double {
      return edits ? surfaceOffsetAt(body, dir, *edits, maxDig, maxFill) : 0.0;
    };
  }

 private:
  BodyParams body_;
  const VoxelEdits* edits_ = nullptr;
  double maxDigDepthM_ = kSurfaceMaxDigDepthM;
  double maxFillM_ = kSurfaceMaxFillM;
};

// =============================================================================
// §7 — levelArea: the TERRAFORMING op (WG-22). Flatten a disc toward one height.
//
// The rule a player asks for when they say "let me flatten a spot to build on"
// is simple and it belongs HERE, in the surface authority, not in a client:
//
//   Inside a cylinder of radius `radiusM` about the aim point, aligned with the
//   local up, every cell whose centre is ABOVE the target radius becomes AIR and
//   every cell whose centre is BELOW it becomes SOLID.
//
// That is one predicate on |cellCentre| against ONE target radius, so the result
// is a spherical cap at constant altitude — locally, over a few metres, a plane.
// Cut and fill fall out of the same comparison rather than being two tools, which
// is why a slope levels in one press instead of needing the player to guess which
// half needs which.
//
// BOUNDS, and what happens at them. The cut reaches `maxCutM` above the target
// and the fill `maxFillM` below it. Ground higher than the cut band is left
// standing: it reads as a lip at the rim, not as a floating slab, because the
// band is measured from the target and the rock above it is CONTIGUOUS with the
// rock outside the disc. Deliberately bounded rather than unbounded: the scan is
// a cell box, so an unbounded vertical reach on a cliff is an unbounded cost.
//
// TARGET HEIGHT is a relief height in the same units as baseHeight, so the caller
// passes "the height I am standing at" and gets a floor at their own feet.
//
// Determinism: an explicit op over a pure predicate. Same (body, target, radius,
// centre) applied to the same edit set gives the same two sets, bit for bit. It
// is also IDEMPOTENT: applying it twice changes nothing the second time, which is
// what lets the client repeat it on a held key without the pad creeping.
// =============================================================================
struct LevelResult {
  int dug = 0;      // cells that changed solid -> air
  int filled = 0;   // cells that changed air -> solid
  int scanned = 0;  // cells inside the cylinder that were considered
  int cells() const { return dug + filled; }
};

inline LevelResult levelArea(const BodyParams& body, VoxelEdits& edits,
                             const Vec3& centerPos, double radiusM,
                             double targetHeightM,
                             double maxCutM = kSurfaceMaxFillM,
                             double maxFillM = kSurfaceMaxFillM) {
  LevelResult out;
  const double centreR = centerPos.length();
  if (radiusM <= 0.0 || centreR <= 0.0) return out;

  const Vec3 up = centerPos * (1.0 / centreR);
  const double targetR = body.radiusM + targetHeightM;
  // Half a cell of slack on each side so the band is inclusive of the cells whose
  // centres sit exactly on the boundary rather than dropping them to rounding.
  const double rHigh = targetR + maxCutM + 0.5 * kVoxelSizeM;
  const double rLow  = targetR - maxFillM - 0.5 * kVoxelSizeM;
  if (rLow <= 0.0) return out;

  // A tight AABB for { p : |p perp up| <= radius, rLow <= |p| <= rHigh }. The
  // cylinder's axis passes through the body centre because `up` is the unit of
  // `centerPos`, so the perpendicular offset of the axis is exactly zero and the
  // axial coordinate runs from sqrt(rLow^2 − radius^2) to rHigh. Bounding it
  // properly instead of taking centre +/- (radius + band) is worth roughly an
  // order of magnitude in cells scanned at these sizes.
  const double axLo = std::sqrt(std::max(0.0, rLow * rLow - radiusM * radiusM));
  double lo[3], hi[3];
  const double u[3] = {up.x, up.y, up.z};
  for (int i = 0; i < 3; ++i) {
    const double a = axLo * u[i], b = rHigh * u[i];
    const double perp = radiusM * std::sqrt(std::max(0.0, 1.0 - u[i] * u[i]));
    lo[i] = std::min(a, b) - perp;
    hi[i] = std::max(a, b) + perp;
  }
  const VoxelCell c0 = cellForPos(Vec3(lo[0], lo[1], lo[2]));
  const VoxelCell c1 = cellForPos(Vec3(hi[0], hi[1], hi[2]));

  const double r2 = radiusM * radiusM;
  edits.clearDirty();
  for (int32_t z = c0.cz; z <= c1.cz; ++z)
    for (int32_t y = c0.cy; y <= c1.cy; ++y)
      for (int32_t x = c0.cx; x <= c1.cx; ++x) {
        const VoxelCell c{x, y, z};
        const Vec3 p = cellCenter(c);
        const double r = p.length();
        if (r > rHigh || r < rLow) continue;          // outside the band
        // Perpendicular distance from the cylinder axis.
        const double axial = p.x * up.x + p.y * up.y + p.z * up.z;
        const double perp2 = p.lengthSq() - axial * axial;
        if (perp2 > r2) continue;                     // outside the disc
        ++out.scanned;
        const bool wantSolid = (r <= targetR);
        const bool isSolidNow = edits.isSolid(body, c);
        if (wantSolid == isSolidNow) continue;        // already right: idempotent
        if (wantSolid) { if (edits.fillCell(body, c)) { ++out.filled; edits.touch(c); } }
        else           { if (edits.digCell(c))        { ++out.dug;    edits.touch(c); } }
      }
  return out;
}

}  // namespace worldgen
}  // namespace of
