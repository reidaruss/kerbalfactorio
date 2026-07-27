#pragma once
// =============================================================================
// surface_nets.h — extract the ZERO LEVEL of the density field as triangles.
//
// The mesher half of WG-24. voxel_field.h stores a signed distance at lattice
// corners; this file turns it into geometry. Naive surface nets (Gibson 1998),
// which is dual contouring without the QEF: ONE vertex per cell that the surface
// passes through, placed at the mean of the surface's crossings on that cell's
// twelve edges, and one quad per lattice edge that changes sign, joining the
// four cells around it.
//
// WHY THIS ALGORITHM AND NOT MARCHING CUBES. Both extract the same isosurface.
// Surface nets gives one vertex per cell instead of up to five triangles per
// cell, has no 256-entry case table, needs no ambiguous-face resolution, and
// produces quads whose connectivity is trivially watertight. It is also the
// algorithm whose output shape the user described: rounded but not blobby, with
// flat regions genuinely flat.
//
// THE PROPERTY THAT MATTERS FOR TERRAFORMING. Vertex placement is linear
// interpolation along each edge. If the field is LINEAR in space (which is
// exactly what levelDisc writes: d = targetRadius − |p|, and over a few metres
// |p| is planar to millimetres), then every edge crossing lies exactly on the
// target plane, so their mean lies exactly on the target plane, so the extracted
// surface IS the plane. A flat pad is flat to floating point rather than to a
// cell. That is the whole answer to "Q makes the ground rougher, not flatter".
//
// AND FOR DIGGING. A dig writes d = min(d, |p − c| − r), so the crater's zero
// level is a sphere and the extracted surface follows it smoothly. No cube
// faces, no axis-aligned steps, no 0.87 m shell standing proud of the ground.
//
// FILTERING (ARCHITECTURE 15.2 item 108). This mesh SUPPLEMENTS the streamed
// heightfield chunk; it does not replace it. Over untouched ground the two would
// draw the same surface and fight for the depth buffer, so `editedOnly` emits
// only cells within `growCells` of an actual override. That filter is defined on
// the EDIT STORE rather than on solidity, so it is exact: a cell is ours if the
// player changed the field near it. Tunnels and overhangs, which the heightfield
// cannot express, are always near an override and are always drawn.
//
// Header-only C++17. Consumes voxel_field.h READ-ONLY.
// =============================================================================
#include <cmath>
#include <cstdint>
#include <unordered_map>
#include <vector>

#include "of/vec3.h"
#include "of/voxel_field.h"

namespace of {
namespace worldgen {

/** Triangles in the body frame, metres. Positions are doubles because the body
 *  frame is 600 km across; the bridge narrows to f32 against a near anchor
 *  (standing rule 6). */
struct SurfaceNetsMesh {
  std::vector<Vec3> positions;
  std::vector<Vec3> normals;
  std::vector<uint32_t> indices;
  int cellsScanned = 0;
  int cellsCrossed = 0;   // cells the surface passes through
  int cellsEmitted = 0;   // of those, the ones that survived the edit filter
};

struct SurfaceNetsOpts {
  /** Emit only cells within `growCells` of a corner the player has overridden.
   *  False meshes the whole region, which is what a test or a full-voxel-world
   *  renderer wants. */
  bool editedOnly = true;
  int growCells = 1;
  /** Refuse regions larger than this many cells, so a mistaken AABB allocates a
   *  bounded amount rather than gigabytes. */
  int64_t maxCells = 4ll << 20;
  /** QUAD OWNERSHIP, inclusive corner range. A quad belongs to the lattice EDGE
   *  it crosses, and an edge is named by its lower corner, so restricting which
   *  corners may emit is what lets a caller mesh one brick at a time without
   *  either a seam or a doubled triangle. Leave `quadsOwned` false to emit every
   *  quad the region can form, which is what a whole-region call wants. */
  bool quadsOwned = false;
  VoxelCell quadMin{}, quadMax{};
};

// The twelve edges of a cell, as pairs of corner indices in the
// i = bx | (by<<1) | (bz<<2) convention.
namespace detail {
struct CellEdge { int a, b; };
inline const CellEdge* cellEdges() {
  static const CellEdge e[12] = {
      {0, 1}, {2, 3}, {4, 5}, {6, 7},   // along X
      {0, 2}, {1, 3}, {4, 6}, {5, 7},   // along Y
      {0, 4}, {1, 5}, {2, 6}, {3, 7},   // along Z
  };
  return e;
}
inline void cornerOffset(int i, int& bx, int& by, int& bz) {
  bx = i & 1;
  by = (i >> 1) & 1;
  bz = (i >> 2) & 1;
}
}  // namespace detail

/**
 * Extract the surface over an inclusive CELL range.
 *
 * Vertices are deterministic: one per crossed cell, at the mean of that cell's
 * edge crossings, accumulated in a fixed edge order. Two calls over overlapping
 * regions therefore place the SAME vertex for a shared cell, which is what makes
 * a per-brick re-mesh join seamlessly onto its neighbours.
 */
inline SurfaceNetsMesh surfaceNets(const BodyParams& body,
                                   const DensityField& field,
                                   const VoxelCell& cmin, const VoxelCell& cmax,
                                   const SurfaceNetsOpts& opts = {}) {
  SurfaceNetsMesh out;
  if (cmax.cx < cmin.cx || cmax.cy < cmin.cy || cmax.cz < cmin.cz) return out;

  const int64_t nx = static_cast<int64_t>(cmax.cx) - cmin.cx + 1;
  const int64_t ny = static_cast<int64_t>(cmax.cy) - cmin.cy + 1;
  const int64_t nz = static_cast<int64_t>(cmax.cz) - cmin.cz + 1;
  if (nx * ny * nz > opts.maxCells) return out;

  // Corner grid: one more corner than cell on each axis.
  const int64_t gx = nx + 1, gy = ny + 1, gz = nz + 1;
  std::vector<double> d(static_cast<size_t>(gx * gy * gz));
  std::vector<uint8_t> ov(static_cast<size_t>(gx * gy * gz), 0);
  const auto dAt = [&](int64_t x, int64_t y, int64_t z) -> double {
    return d[static_cast<size_t>((z * gy + y) * gx + x)];
  };
  for (int64_t z = 0; z < gz; ++z)
    for (int64_t y = 0; y < gy; ++y)
      for (int64_t x = 0; x < gx; ++x) {
        const VoxelCell c{static_cast<int32_t>(cmin.cx + x),
                          static_cast<int32_t>(cmin.cy + y),
                          static_cast<int32_t>(cmin.cz + z)};
        const size_t i = static_cast<size_t>((z * gy + y) * gx + x);
        d[i] = field.cornerDensity(body, c);
        ov[i] = field.hasOverride(c) ? 1u : 0u;
      }

  // "Is this cell the player's" reads the local byte grid, not the hash map, so
  // the filter costs byte loads rather than a lookup per neighbour.
  const int g = opts.growCells;
  const auto ownedCell = [&](int64_t x, int64_t y, int64_t z) -> bool {
    for (int64_t cz = std::max<int64_t>(0, z - g);
         cz <= std::min<int64_t>(gz - 1, z + 1 + g); ++cz)
      for (int64_t cy = std::max<int64_t>(0, y - g);
           cy <= std::min<int64_t>(gy - 1, y + 1 + g); ++cy)
        for (int64_t cx = std::max<int64_t>(0, x - g);
             cx <= std::min<int64_t>(gx - 1, x + 1 + g); ++cx)
          if (ov[static_cast<size_t>((cz * gy + cy) * gx + cx)]) return true;
    return false;
  };

  // Cell -> vertex index, or -1. Dense; the region is bounded above.
  std::vector<int32_t> vidx(static_cast<size_t>(nx * ny * nz), -1);
  const auto vAt = [&](int64_t x, int64_t y, int64_t z) -> int32_t& {
    return vidx[static_cast<size_t>((z * ny + y) * nx + x)];
  };

  const detail::CellEdge* E = detail::cellEdges();
  for (int64_t z = 0; z < nz; ++z)
    for (int64_t y = 0; y < ny; ++y)
      for (int64_t x = 0; x < nx; ++x) {
        ++out.cellsScanned;
        double cd[8];
        bool anyPos = false, anyNeg = false;
        for (int i = 0; i < 8; ++i) {
          int bx, by, bz;
          detail::cornerOffset(i, bx, by, bz);
          cd[i] = dAt(x + bx, y + by, z + bz);
          if (cd[i] >= 0.0) anyPos = true; else anyNeg = true;
        }
        if (!(anyPos && anyNeg)) continue;      // no surface in this cell
        ++out.cellsCrossed;

        const VoxelCell cell{static_cast<int32_t>(cmin.cx + x),
                             static_cast<int32_t>(cmin.cy + y),
                             static_cast<int32_t>(cmin.cz + z)};
        if (opts.editedOnly && !ownedCell(x, y, z)) continue;

        // Mean of the crossings on the twelve edges, in cell-local [0,1].
        double sx = 0.0, sy = 0.0, sz = 0.0;
        int n = 0;
        for (int e = 0; e < 12; ++e) {
          const double da = cd[E[e].a], db = cd[E[e].b];
          if ((da >= 0.0) == (db >= 0.0)) continue;
          const double denom = da - db;
          double t = (denom != 0.0) ? (da / denom) : 0.5;
          if (t < 0.0) t = 0.0;
          if (t > 1.0) t = 1.0;
          int ax, ay, az, bx2, by2, bz2;
          detail::cornerOffset(E[e].a, ax, ay, az);
          detail::cornerOffset(E[e].b, bx2, by2, bz2);
          sx += ax + (bx2 - ax) * t;
          sy += ay + (by2 - ay) * t;
          sz += az + (bz2 - az) * t;
          ++n;
        }
        if (n == 0) continue;
        const double lx = sx / n, ly = sy / n, lz = sz / n;

        const Vec3 base = cornerPos(cell);
        out.positions.push_back(Vec3(base.x + lx * kVoxelSizeM,
                                     base.y + ly * kVoxelSizeM,
                                     base.z + lz * kVoxelSizeM));

        // Gradient of the trilinear field AT the vertex, from the eight values
        // we already have. No extra field sampling, and adjacent cells share
        // corners, so neighbouring normals agree closely and the surface shades
        // smoothly instead of faceting.
        const double ix = 1.0 - lx, iy = 1.0 - ly, iz = 1.0 - lz;
        const double ddx = iy * iz * (cd[1] - cd[0]) + ly * iz * (cd[3] - cd[2]) +
                           iy * lz * (cd[5] - cd[4]) + ly * lz * (cd[7] - cd[6]);
        const double ddy = ix * iz * (cd[2] - cd[0]) + lx * iz * (cd[3] - cd[1]) +
                           ix * lz * (cd[6] - cd[4]) + lx * lz * (cd[7] - cd[5]);
        const double ddz = ix * iy * (cd[4] - cd[0]) + lx * iy * (cd[5] - cd[1]) +
                           ix * ly * (cd[6] - cd[2]) + lx * ly * (cd[7] - cd[3]);
        Vec3 nrm(-ddx, -ddy, -ddz);   // density falls outward, so negate
        const double nl = nrm.length();
        if (nl > 1e-12) nrm = Vec3(nrm.x / nl, nrm.y / nl, nrm.z / nl);
        else nrm = unitOf(out.positions.back());
        out.normals.push_back(nrm);

        vAt(x, y, z) = static_cast<int32_t>(out.positions.size() - 1);
        ++out.cellsEmitted;
      }

  // Quads. A lattice edge that changes sign is pierced by the surface, and the
  // four cells sharing that edge each hold a vertex, so joining them in order
  // gives a quad. Winding follows the sign so the front face is the rock side.
  const auto quad = [&](int32_t a, int32_t b, int32_t c2, int32_t d2, bool flip) {
    if (a < 0 || b < 0 || c2 < 0 || d2 < 0) return;
    if (flip) {
      out.indices.push_back(static_cast<uint32_t>(a));
      out.indices.push_back(static_cast<uint32_t>(c2));
      out.indices.push_back(static_cast<uint32_t>(b));
      out.indices.push_back(static_cast<uint32_t>(a));
      out.indices.push_back(static_cast<uint32_t>(d2));
      out.indices.push_back(static_cast<uint32_t>(c2));
    } else {
      out.indices.push_back(static_cast<uint32_t>(a));
      out.indices.push_back(static_cast<uint32_t>(b));
      out.indices.push_back(static_cast<uint32_t>(c2));
      out.indices.push_back(static_cast<uint32_t>(a));
      out.indices.push_back(static_cast<uint32_t>(c2));
      out.indices.push_back(static_cast<uint32_t>(d2));
    }
  };

  for (int64_t z = 1; z < nz; ++z)
    for (int64_t y = 1; y < ny; ++y)
      for (int64_t x = 1; x < nx; ++x) {
        if (opts.quadsOwned) {
          const int64_t gxw = cmin.cx + x, gyw = cmin.cy + y, gzw = cmin.cz + z;
          if (gxw < opts.quadMin.cx || gxw > opts.quadMax.cx ||
              gyw < opts.quadMin.cy || gyw > opts.quadMax.cy ||
              gzw < opts.quadMin.cz || gzw > opts.quadMax.cz) continue;
        }
        const double d0 = dAt(x, y, z);
        // Edge along +X from corner (x,y,z): shared by cells (x, y-1..y, z-1..z).
        if ((d0 >= 0.0) != (dAt(x + 1, y, z) >= 0.0))
          quad(vAt(x, y - 1, z - 1), vAt(x, y, z - 1), vAt(x, y, z),
               vAt(x, y - 1, z), d0 >= 0.0);
        if ((d0 >= 0.0) != (dAt(x, y + 1, z) >= 0.0))
          quad(vAt(x - 1, y, z - 1), vAt(x, y, z - 1), vAt(x, y, z),
               vAt(x - 1, y, z), d0 < 0.0);
        if ((d0 >= 0.0) != (dAt(x, y, z + 1) >= 0.0))
          quad(vAt(x - 1, y - 1, z), vAt(x, y - 1, z), vAt(x, y, z),
               vAt(x - 1, y, z), d0 >= 0.0);
      }

  return out;
}

/**
 * Mesh ONE BRICK of the world, so the client can cache the result per brick and
 * rebuild only what a dig touched. The tiling rule lives here rather than in the
 * client because it is the kind of off-by-one that draws a seam or a doubled
 * triangle, and it should be stated once:
 *
 *   the region is the brick's cells GROWN BY ONE ON THE LOW SIDE, because the
 *   quad for an edge needs the four cells around it and the two on the low side
 *   belong to the previous brick;
 *   the quads emitted are those whose edge's lower corner lies in the brick's own
 *   corner range, so every edge in the world is emitted by exactly one brick.
 *
 * Vertices in the grown row are produced twice, once here and once by the
 * neighbour. That is a handful of duplicated positions and no duplicated
 * geometry, which is the right side of that trade.
 */
inline SurfaceNetsMesh surfaceNetsBrick(const BodyParams& body,
                                        const DensityField& field, int32_t bx,
                                        int32_t by, int32_t bz, int32_t brick,
                                        SurfaceNetsOpts opts = {}) {
  if (brick <= 0) return SurfaceNetsMesh{};
  const VoxelCell lo{bx * brick - 1, by * brick - 1, bz * brick - 1};
  const VoxelCell hi{bx * brick + brick - 1, by * brick + brick - 1,
                     bz * brick + brick - 1};
  opts.quadsOwned = true;
  opts.quadMin = VoxelCell{bx * brick, by * brick, bz * brick};
  opts.quadMax = hi;
  return surfaceNets(body, field, lo, hi, opts);
}

/** Convenience: the cell box covering a sphere, the shape the client asks for. */
inline SurfaceNetsMesh surfaceNetsAround(const BodyParams& body,
                                         const DensityField& field,
                                         const Vec3& centre, double radiusM,
                                         const SurfaceNetsOpts& opts = {}) {
  const VoxelCell a = cellForPos(Vec3(centre.x - radiusM, centre.y - radiusM,
                                      centre.z - radiusM));
  const VoxelCell b = cellForPos(Vec3(centre.x + radiusM, centre.y + radiusM,
                                      centre.z + radiusM));
  return surfaceNets(body, field, a, b, opts);
}

}  // namespace worldgen
}  // namespace of
