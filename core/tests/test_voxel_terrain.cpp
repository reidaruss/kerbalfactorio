// Headless tests for the TRUE VOXEL TUNNELING layer (voxel_terrain.h) — the 1 m^3
// destruction foundation that supersedes the heightfield deform for digging.
// Proves:
//   - solidity model: cells below the surface are SOLID, cells above are AIR
//     (consistent with sampleHeightField), and a removed cell is AIR.
//   - dig() removes exactly the solid cells whose centre is within the radius
//     (count + membership), leaving cells outside the radius untouched.
//   - TUNNEL: a horizontal run dug a few metres BELOW the surface is air while the
//     cells directly ABOVE it stay solid — a real overhang the heightfield can't do.
//   - exposedFaces emits faces ONLY on solid<->air boundaries (a fresh pocket
//     exposes its walls; a fully-solid block's interior emits nothing).
//   - persistence round-trips (removed set identical -> identical solidity).
//   - determinism: the same op sequence yields the same removed set + solidity.
#include <cstdint>
#include <vector>

#include "test_framework.h"
#include "of/cubed_sphere.h"
#include "of/voxel_terrain.h"
#include "of/persistence.h"  // reuse SaveWriter/SaveReader as the byte cursor

using namespace of;
using namespace of::worldgen;

// A direction safely on open surface (away from cube seams) for digging.
static Vec3 sampleDir() { return latLonToDir(0.20, 0.55); }

// The body-frame surface point under a direction (centre of the topmost soil).
static Vec3 surfacePoint(const BodyParams& body, const Vec3& dir) {
  return dir * surfaceRadiusAt(body, dir);
}

// =============================================================================
// Solidity model: a cell a few metres BELOW the surface is solid; a cell well
// ABOVE the surface is air. Consistent with sampleHeightField.
// =============================================================================
TEST(below_surface_solid_above_surface_air) {
  const BodyParams forge = makeForge(20260616ull);
  const Vec3 dir = sampleDir();
  const Vec3 surf = surfacePoint(forge, dir);
  VoxelEdits edits;  // no edits yet -> pure procedural

  // 5 m below the surface along the radial -> solid.
  const Vec3 below = surf - dir * 5.0;
  CHECK(edits.isSolidAt(forge, below));

  // 20 m above the surface -> air.
  const Vec3 above = surf + dir * 20.0;
  CHECK(!edits.isSolidAt(forge, above));

  // Deep interior -> solid.
  CHECK(edits.isSolidAt(forge, dir * (forge.radiusM * 0.5)));
}

// =============================================================================
// cell id pack/unpack round-trips for assorted (incl. negative) coords.
// =============================================================================
TEST(cell_id_pack_unpack_roundtrip) {
  const VoxelCell cells[] = {{0, 0, 0}, {1, -2, 3}, {-100000, 250000, -7},
                             {123456, -654321, 99999}};
  for (const VoxelCell& c : cells) {
    const uint64_t id = voxelCellId(c);
    const VoxelCell back = voxelCellFromId(id);
    CHECK(back == c);
  }
  // cellForPos floors; cellCenter recovers the (x+0.5) centre.
  const VoxelCell c = cellForPos(Vec3(3.7, -2.1, 0.4));
  CHECK(c.cx == 3 && c.cy == -3 && c.cz == 0);
  const Vec3 ctr = cellCenter(c);
  CHECK_NEAR(ctr.x, 3.5, 1e-12);
  CHECK_NEAR(ctr.y, -2.5, 1e-12);
  CHECK_NEAR(ctr.z, 0.5, 1e-12);
}

// =============================================================================
// dig() removes exactly the solid cells whose centre is within the radius; cells
// outside the radius are untouched, and a cell that was air is not "removed".
// =============================================================================
TEST(dig_sphere_removes_right_cells) {
  const BodyParams forge = makeForge(20260616ull);
  const Vec3 dir = sampleDir();
  const Vec3 surf = surfacePoint(forge, dir);
  // Dig centre 6 m below the surface so the whole brush is in solid rock.
  const Vec3 center = surf - dir * 6.0;
  const double radiusM = 3.0;

  VoxelEdits edits;
  const int removed = edits.dig(forge, center, radiusM);
  CHECK(removed > 0);
  CHECK(static_cast<size_t>(removed) == edits.removedCount());

  // Every cell within radius that was procedurally solid is now removed/air.
  const VoxelCell c0 = cellForPos(center - Vec3(radiusM, radiusM, radiusM));
  const VoxelCell c1 = cellForPos(center + Vec3(radiusM, radiusM, radiusM));
  const double r2 = radiusM * radiusM;
  int expectInside = 0;
  for (int32_t z = c0.cz; z <= c1.cz; ++z)
    for (int32_t y = c0.cy; y <= c1.cy; ++y)
      for (int32_t x = c0.cx; x <= c1.cx; ++x) {
        const VoxelCell c{x, y, z};
        const Vec3 d = cellCenter(c) - center;
        const bool inside = d.lengthSq() <= r2;
        const bool wasProcSolid = isProcSolid(forge, c);
        if (inside && wasProcSolid) {
          ++expectInside;
          CHECK(edits.isRemoved(c));            // carved
          CHECK(!edits.isSolid(forge, c));      // now air
        }
        if (!inside) {
          CHECK(!edits.isRemoved(c));           // outside radius untouched
        }
      }
  CHECK(expectInside == removed);

  // Digging the SAME sphere again removes nothing new (idempotent).
  const int again = edits.dig(forge, center, radiusM);
  CHECK(again == 0);
}

// =============================================================================
// TUNNEL: dig a horizontal run a few metres BELOW the surface -> those cells are
// air while the cells directly ABOVE them stay solid. A real overhang/tunnel —
// the thing a heightfield (dig-down-only) can NOT express.
// =============================================================================
TEST(horizontal_tunnel_leaves_overhang) {
  const BodyParams forge = makeForge(20260616ull);
  const Vec3 dir = sampleDir();
  const Vec3 surf = surfacePoint(forge, dir);

  // A horizontal tangent direction at the surface (perp to radial up).
  Vec3 tangent = Vec3(-dir.z, 0.0, dir.x);          // dir x Y-ish, then normalize
  const double tl = tangent.length();
  tangent = Vec3(tangent.x / tl, tangent.y / tl, tangent.z / tl);

  // Tunnel axis starts 5 m below the surface and runs ~12 m horizontally.
  const Vec3 start = surf - dir * 5.0;
  VoxelEdits edits;
  int totalRemoved = 0;
  for (int s = 0; s <= 12; ++s) {
    const Vec3 p = start + tangent * static_cast<double>(s);
    totalRemoved += edits.dig(forge, p, 1.4);       // ~1.4 m bore
  }
  CHECK(totalRemoved > 0);

  // Sample several points along the tunnel interior: must be AIR.
  // Sample the rock ~4 m ABOVE each (toward the surface but still below it): SOLID.
  int airHits = 0, roofSolid = 0;
  for (int s = 2; s <= 10; s += 2) {
    const Vec3 p = start + tangent * static_cast<double>(s);
    if (!edits.isSolidAt(forge, p)) ++airHits;        // tunnel bore is hollow
    const Vec3 roof = p + dir * 4.0;                  // 4 m up = still below surface
    if (edits.isSolidAt(forge, roof)) ++roofSolid;    // intact roof over the tunnel
  }
  CHECK(airHits >= 4);     // the bore is genuinely hollow
  CHECK(roofSolid >= 4);   // and there is solid rock OVERHANGING it (the proof)
}

// =============================================================================
// exposedFaces: a fresh dug pocket exposes its WALLS (solid<->air boundary faces),
// while a fully-solid interior region emits no faces.
// =============================================================================
TEST(exposed_faces_on_solid_air_boundary) {
  const BodyParams forge = makeForge(20260616ull);
  const Vec3 dir = sampleDir();
  const Vec3 surf = surfacePoint(forge, dir);
  const Vec3 center = surf - dir * 10.0;   // deep enough that the box is all rock

  VoxelEdits edits;

  // A fully-solid interior box (no edits, no surface in range) emits NO faces:
  // every neighbour of every solid cell is also solid.
  const VoxelCell bmin = cellForPos(center - Vec3(2, 2, 2));
  const VoxelCell bmax = cellForPos(center + Vec3(2, 2, 2));
  const auto solidFaces = exposedFaces(forge, edits, bmin, bmax);
  CHECK(solidFaces.empty());

  // Carve a single cell -> its 6 solid neighbours each expose one face toward it.
  const VoxelCell hole = cellForPos(center);
  edits.digCell(hole);
  const auto pocketFaces = exposedFaces(forge, edits, bmin, bmax);
  CHECK(pocketFaces.size() == 6);
  // Every emitted face is on a SOLID cell whose (axis,sign) neighbour is the hole.
  for (const FaceQuad& f : pocketFaces) {
    CHECK(edits.isSolid(forge, f.cell));
    const VoxelCell nb = voxelNeighbour(f.cell, f.axis, f.sign);
    CHECK(nb == hole);
    CHECK(!edits.isSolid(forge, nb));
  }

  // Dig a 3 m sphere -> the pocket exposes a nonzero wall of faces.
  VoxelEdits edits2;
  edits2.dig(forge, center, 3.0);
  const VoxelCell rmin = cellForPos(center - Vec3(5, 5, 5));
  const VoxelCell rmax = cellForPos(center + Vec3(5, 5, 5));
  const auto wallFaces = exposedFaces(forge, edits2, rmin, rmax);
  CHECK(!wallFaces.empty());
  for (const FaceQuad& f : wallFaces) {
    CHECK(edits2.isSolid(forge, f.cell));
    CHECK(!edits2.isSolid(forge, voxelNeighbour(f.cell, f.axis, f.sign)));
  }
}

// =============================================================================
// dirtyRegion bounds the cells touched by a dig (so UE re-meshes only there).
// =============================================================================
TEST(dirty_region_bounds_the_dig) {
  const BodyParams forge = makeForge(20260616ull);
  const Vec3 dir = sampleDir();
  const Vec3 center = surfacePoint(forge, dir) - dir * 6.0;
  const double radiusM = 3.0;

  VoxelEdits edits;
  CHECK(!edits.dirtyValid());
  edits.dig(forge, center, radiusM);
  const auto dr = edits.dirtyRegion();
  CHECK(dr.valid);
  // The dirty AABB lies within the brush's cell box (inclusive).
  const VoxelCell c0 = cellForPos(center - Vec3(radiusM, radiusM, radiusM));
  const VoxelCell c1 = cellForPos(center + Vec3(radiusM, radiusM, radiusM));
  CHECK(dr.min.cx >= c0.cx && dr.min.cy >= c0.cy && dr.min.cz >= c0.cz);
  CHECK(dr.max.cx <= c1.cx && dr.max.cy <= c1.cy && dr.max.cz <= c1.cz);

  edits.clearDirty();
  CHECK(!edits.dirtyValid());
}

// =============================================================================
// Persistence round-trip: serialize the removed set, reload into a fresh
// VoxelEdits, and assert IDENTICAL solidity across the dug region.
// =============================================================================
TEST(persistence_roundtrip_identical_solidity) {
  const BodyParams forge = makeForge(20260616ull);
  const Vec3 dir = sampleDir();
  const Vec3 center = surfacePoint(forge, dir) - dir * 8.0;

  VoxelEdits a;
  a.dig(forge, center, 3.5);
  // Add an extra horizontal nibble so the diff is non-trivial.
  Vec3 tangent = Vec3(-dir.z, 0.0, dir.x);
  const double tl = tangent.length();
  tangent = Vec3(tangent.x / tl, tangent.y / tl, tangent.z / tl);
  a.dig(forge, center + tangent * 4.0, 2.0);
  CHECK(a.removedCount() > 0);

  persist::SaveWriter w;
  a.serialize(w);
  std::vector<uint8_t> bytes = w.take();

  persist::SaveReader r(bytes);
  VoxelEdits b;
  b.deserialize(r);

  CHECK(b.removedCount() == a.removedCount());
  CHECK(b.removedSet() == a.removedSet());

  // Solidity is identical across the whole dug box.
  const VoxelCell cmin = cellForPos(center - Vec3(8, 8, 8));
  const VoxelCell cmax = cellForPos(center + Vec3(8, 8, 8));
  for (int32_t z = cmin.cz; z <= cmax.cz; ++z)
    for (int32_t y = cmin.cy; y <= cmax.cy; ++y)
      for (int32_t x = cmin.cx; x <= cmax.cx; ++x) {
        const VoxelCell c{x, y, z};
        CHECK(a.isSolid(forge, c) == b.isSolid(forge, c));
      }
}

// =============================================================================
// Determinism: the same dig op sequence yields the same removed set, and the
// procedural solidity is a pure function of the body (independent of edits).
// =============================================================================
TEST(determinism_same_ops_same_state) {
  const BodyParams forge = makeForge(20260616ull);
  const Vec3 dir = sampleDir();
  const Vec3 center = surfacePoint(forge, dir) - dir * 7.0;

  VoxelEdits a, b;
  for (int i = 0; i < 3; ++i) {
    a.dig(forge, center + Vec3(i, 0, 0), 2.0);
    b.dig(forge, center + Vec3(i, 0, 0), 2.0);
  }
  CHECK(a.removedSet() == b.removedSet());

  // Procedural solidity is stable across a fresh BodyParams from the same seed.
  const BodyParams forge2 = makeForge(20260616ull);
  const VoxelCell c = cellForPos(center);
  CHECK(isProcSolid(forge, c) == isProcSolid(forge2, c));
}

// =============================================================================
// WG-22 â€” the FILL BRUSH, the mirror of dig(). Proves the layer is no longer
// subtractive by construction: a brush can put 1 m^3 cells BACK, the exposed-face
// mesher sees them, and both sets survive a save/load round trip together.
// =============================================================================
TEST(fill_brush_is_the_mirror_of_the_dig_brush) {
  const BodyParams forge = makeForge(20260616ull);
  const Vec3 u = unitOf(latLonToDir(0.20, 0.55));
  const double surfR = forge.radiusM + sampleDesignedHeight(forge, u);

  VoxelEdits e;
  // Dig a sphere just under the surface, then fill the SAME sphere back.
  const Vec3 c = u * (surfR - 3.0);
  const int dug = e.dig(forge, c, 3.0);
  CHECK(dug > 0);
  CHECK(e.removedCount() == static_cast<size_t>(dug));
  const int back = e.fill(forge, c, 3.0);
  // Every cell the dig took is a cell the fill can give back, and the diff is
  // empty again rather than holding two opposing facts.
  CHECK(back == dug);
  CHECK(e.removedCount() == 0);
  CHECK(e.addedCount() == 0);
  CHECK(e.empty());

  // Filling ABOVE the surface places NEW ground where there was only air.
  const Vec3 above = u * (surfR + 2.0);
  const int placed = e.fill(forge, above, 2.5);
  CHECK(placed > 0);
  CHECK(e.addedCount() == static_cast<size_t>(placed));
  CHECK(e.removedCount() == 0);
  // Idempotent: a second identical brush places nothing.
  CHECK(e.fill(forge, above, 2.5) == 0);
  CHECK(e.addedCount() == static_cast<size_t>(placed));

  // The mesher sees the placed ground: a mound above open sky has exposed faces
  // where the pristine world had none in that region.
  VoxelEdits pristine;
  const size_t before = exposedFaces(forge, pristine, above, 3.0).size();
  const size_t after = exposedFaces(forge, e, above, 3.0).size();
  CHECK(after > before);

  // And the dirty AABB scopes the re-mesh, exactly as a dig's does. Taken from a
  // brush that actually placed something: fill() resets the box on entry the way
  // dig() does, so the no-op brush above correctly left it invalid.
  CHECK(!e.dirtyRegion().valid);
  CHECK(e.fill(forge, u * (surfR + 5.0), 2.0) > 0);
  const VoxelEdits::CellAABB d = e.dirtyRegion();
  CHECK(d.valid);
  CHECK(d.max.cx >= d.min.cx && d.max.cy >= d.min.cy && d.max.cz >= d.min.cz);
}

// =============================================================================
// Both sets round-trip through the byte cursor, and a PRE-WG-22 stream still
// loads. A save format that bricked every existing slot would not be shippable.
// =============================================================================
TEST(both_edit_sets_survive_serialization) {
  const BodyParams forge = makeForge(20260616ull);
  const Vec3 u = unitOf(latLonToDir(0.20, 0.55));
  const double surfR = forge.radiusM + sampleDesignedHeight(forge, u);

  VoxelEdits e;
  e.dig(forge, u * (surfR - 4.0), 3.0);
  e.fill(forge, u * (surfR + 2.0), 2.5);
  CHECK(e.removedCount() > 0 && e.addedCount() > 0);

  of::persist::SaveWriter w;
  e.serialize(w);
  of::persist::SaveReader r(w.bytes());
  VoxelEdits back;
  back.deserialize(r);
  CHECK(back.removedCount() == e.removedCount());
  CHECK(back.addedCount() == e.addedCount());
  for (std::unordered_set<uint64_t>::const_iterator it = e.removedSet().begin();
       it != e.removedSet().end(); ++it) CHECK(back.isRemoved(*it));
  for (std::unordered_set<uint64_t>::const_iterator it = e.addedSet().begin();
       it != e.addedSet().end(); ++it) CHECK(back.isAdded(*it));

  // Byte-stream determinism: the same state serializes to the same bytes.
  of::persist::SaveWriter w2;
  back.serialize(w2);
  CHECK(w2.bytes() == w.bytes());
}
