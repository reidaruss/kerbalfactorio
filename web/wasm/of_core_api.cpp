// =============================================================================
// of_core_api.cpp — the flat C ABI shim that exposes the headless /core C++17
// simulation to JavaScript (browser / Node) via WebAssembly.
//
// WHY A FLAT C ABI AND NOT EMBIND
//   The three hot paths (quad-mesh generation, terrain-chunk streaming, voxel
//   face extraction) all produce BULK ARRAYS that the renderer wants to hand
//   straight to a GPU buffer. embind marshals every value through a JS object
//   graph and would copy each array element-by-element; it also drags ~40 KB of
//   glue and an RTTI/exception dependency into the module. A flat C ABI plus a
//   scratch arena inside the WASM heap lets JS build a typed-array VIEW over the
//   result with ZERO copies (see §0). We use no embind at all: even the handful
//   of cold calls are cheap enough as flat functions, so the whole module stays
//   one uniform, easily-bound surface for the renderer agent.
//
// OWNERSHIP MODEL (the two rules JS must follow)
//   1. HANDLES. Stateful objects (bodies, voxel edit sets, terrain streamers,
//      factory networks, quad meshes) live in WASM-side registries. JS holds an
//      int32 handle, never a raw pointer, and calls the matching *_destroy to
//      free. A handle is never reused while live; destroyed handles return the
//      sentinel values documented per function.
//   2. SCRATCH ARENA. Every array-returning call writes into one of three
//      module-level scratch vectors (f32 / f64 / i32 / u8) and returns the
//      element COUNT. JS then calls of_scratch_*() to get the CURRENT base
//      pointer and builds a view. The view is valid only until the next
//      array-producing call. Because the scratch vectors can reallocate AND
//      because -sALLOW_MEMORY_GROWTH can detach every existing ArrayBuffer, JS
//      MUST re-read both the pointer and Module.HEAPF32/HEAPF64/HEAP32 after
//      every call. See docs/web/WASM-BRIDGE.md §"memory views".
//
// EXCLUDED: of/persistence_file.h (std::filesystem — no browser FS). The pure
// byte serializer of/persistence.h IS included and works; saving in the browser
// means handing those bytes to IndexedDB/OPFS on the JS side.
//
// Determinism: this file adds no math. Every numeric result is produced by the
// unmodified /core headers. Build with -O3 and WITHOUT -ffast-math (see
// build.ps1) so the IEEE-754 semantics the position-hash determinism relies on
// are preserved bit-for-bit.
//
// SURFACE AUTHORITY (WG-21 / DECISIONS.md standing rule 1): READ BEFORE EDITING
//   There is ONE surface: of/surface_field.h. baseHeight (== sampleDesignedHeight)
//   is the designed relief; surfaceHeight is that minus the voxel-derived
//   lowering with the single bedrock clamp. RAW `sampleHeightField` is an
//   INTERNAL INGREDIENT of the designed shaping and of the biome classifier. It
//   is NOT a surface: nothing stands on it, collides with it, or is positioned
//   relative to it. On Forge the two differ by kilometres (lat 48 / lon 18:
//   raw 4,075.51 m vs designed 6,520.81 m), so a single raw-derived position is
//   a player 2.4 km underground.
//
//   Rules this file now obeys, and every future export must:
//     1. Any export that returns or consumes "where the ground is" calls the
//        oracle (of/surface_field.h), never sampleHeightField/SampleTerrainHeight.
//     2. An export MAY expose RAW only if RAW is in its NAME and it is documented
//        as a diagnostic (today: of_sample_raw_height_latlon, of_diag_scan_quad,
//        of_quadmesh_generate's rawBase flag).
//     3. ZERO MEANS CORRECT. Where a flag selects between authorities, 0/default
//        must select the oracle, so a caller that forgets the flag is right.
//     4. NEVER mix bases: a voxel-derived lowering is defined against the
//        DESIGNED base, so applying it to a RAW base reconstructs the exact
//        "mesh vs edits use different bases" bug WG-21 deleted. Such a call is
//        rejected, not silently served.
//   Guarded by parity.mjs CASE 7b (oracle-vs-raw) and dump_expected.cpp's
//   SELF-CHECK of the same identity, so a regression cannot land quietly.
// =============================================================================
#include <cstdint>
#include <cstring>
#include <cmath>
#include <vector>
#include <map>
#include <memory>
#include <string>

#include "of/vec3.h"
#include "of/universe_coord.h"
#include "of/cubed_sphere.h"
#include "of/biome.h"
#include "of/deposits.h"
#include "of/voxel_terrain.h"
#include "of/surface_field.h"
#include "of/terrain_stream.h"
#include "of/factory_sim.h"
#include "of/automation.h"
#include "of/persistence.h"   // byte serializer only — works fine in WASM
#include "of/gameplay.h"      // survival slice: inventory, harvest, craft, furnace

#ifdef __EMSCRIPTEN__
#include <emscripten/emscripten.h>
#define OF_API extern "C" EMSCRIPTEN_KEEPALIVE
#else
#define OF_API extern "C"
#endif

using of::Vec3;
using of::UniverseCoord;
using of::FrameId;
namespace wg = of::worldgen;
namespace au = of::automation;
namespace fs = of::factory;
namespace gp = of::gameplay;
namespace sv = of::gameplay::survival;

// =============================================================================
// §0 — The scratch arena. One buffer per element type; every array-returning
// call fills exactly one of them. Reserved generously up-front so the common
// path never reallocates (a realloc is safe, it just moves the pointer — which
// is why JS re-reads of_scratch_*() after every call anyway).
// =============================================================================
namespace {
std::vector<float>    g_f32;
std::vector<double>   g_f64;
std::vector<int32_t>  g_i32;
std::vector<uint8_t>  g_u8;

inline void resetF32(size_t n) { g_f32.clear(); g_f32.reserve(n); }
inline void resetF64(size_t n) { g_f64.clear(); g_f64.reserve(n); }
inline void resetI32(size_t n) { g_i32.clear(); g_i32.reserve(n); }

// Split a uint64 into two uint32 halves. We deliberately do NOT use -sWASM_BIGINT:
// forcing every 64-bit value through JS BigInt is a papercut for the renderer and
// a silent-truncation hazard when mixed with Numbers. lo/hi pairs are explicit.
uint32_t g_hiWord = 0;   // set by any function returning a uint64 as lo + hi

inline uint32_t splitLo(uint64_t v) { g_hiWord = static_cast<uint32_t>(v >> 32);
                                      return static_cast<uint32_t>(v); }

// Rebuild a uint64 from a JS-supplied lo/hi pair.
inline uint64_t joinU64(uint32_t lo, uint32_t hi) {
  return (static_cast<uint64_t>(hi) << 32) | static_cast<uint64_t>(lo);
}

inline Vec3 vec(double x, double y, double z) { return Vec3(x, y, z); }

// A generic dense handle registry: ids are 1-based, 0/-1 are "invalid".
template <typename T>
struct Registry {
  std::vector<std::unique_ptr<T>> slots;
  int add(T* p) {
    for (size_t i = 0; i < slots.size(); ++i) {
      if (!slots[i]) { slots[i].reset(p); return static_cast<int>(i) + 1; }
    }
    slots.emplace_back(p);
    return static_cast<int>(slots.size());
  }
  T* get(int id) const {
    if (id <= 0 || static_cast<size_t>(id) > slots.size()) return nullptr;
    return slots[static_cast<size_t>(id) - 1].get();
  }
  void remove(int id) {
    if (id <= 0 || static_cast<size_t>(id) > slots.size()) return;
    slots[static_cast<size_t>(id) - 1].reset();
  }
};
}  // namespace

// The 64-bit companion accessor: after ANY call documented as "returns the low
// word of a uint64", read the high word here (before making another such call).
OF_API uint32_t of_last_hi(void) { return g_hiWord; }

OF_API float*   of_scratch_f32(void) { return g_f32.empty() ? nullptr : g_f32.data(); }
OF_API double*  of_scratch_f64(void) { return g_f64.empty() ? nullptr : g_f64.data(); }
OF_API int32_t* of_scratch_i32(void) { return g_i32.empty() ? nullptr : g_i32.data(); }
OF_API uint8_t* of_scratch_u8(void)  { return g_u8.empty()  ? nullptr : g_u8.data();  }

// ABI/version probe so JS can fail loudly against a stale .wasm.
//   1: W0/W1 bridge.
//   2: surface-authority audit: of_observer_latlon_alt gained an `edits`
//       parameter and now reads the oracle; of_quadmesh_generate's last
//       parameter flipped to `rawBase` (0 = the oracle, the safe default);
//       of_chunk_max_offset became a true Euclidean bound including skirts.
OF_API int of_abi_version(void) { return 2; }

// =============================================================================
// §1 — Bodies (cubed_sphere.h BodyParams).
// =============================================================================
namespace { Registry<wg::BodyParams> g_bodies; }

OF_API int of_body_create_forge(uint32_t seedLo, uint32_t seedHi) {
  return g_bodies.add(new wg::BodyParams(wg::makeForge(joinU64(seedLo, seedHi))));
}
OF_API int of_body_create_cinder(uint32_t seedLo, uint32_t seedHi) {
  return g_bodies.add(new wg::BodyParams(wg::makeCinder(joinU64(seedLo, seedHi))));
}
// Fully explicit body (for future bodies beyond the two spike ones).
OF_API int of_body_create(uint32_t bodyId, uint32_t seedLo, uint32_t seedHi,
                          double radiusM, int kind, double maxReliefM,
                          double seaLevelM) {
  wg::BodyParams* b = new wg::BodyParams();
  b->bodyId = bodyId;
  b->bodySeed = joinU64(seedLo, seedHi);
  b->radiusM = radiusM;
  b->kind = (kind == 1) ? wg::kMoon : wg::kPlanet;
  b->maxReliefM = maxReliefM;
  b->seaLevelM = seaLevelM;
  return g_bodies.add(b);
}
OF_API void of_body_destroy(int body) { g_bodies.remove(body); }

OF_API double of_body_radius(int body) {
  const wg::BodyParams* b = g_bodies.get(body);
  return b ? b->radiusM : 0.0;
}
OF_API uint32_t of_body_seed_lo(int body) {
  const wg::BodyParams* b = g_bodies.get(body);
  return splitLo(b ? b->bodySeed : 0);
}
OF_API int of_body_kind(int body) {
  const wg::BodyParams* b = g_bodies.get(body);
  return b ? static_cast<int>(b->kind) : -1;
}
OF_API double of_body_max_relief(int body) {
  const wg::BodyParams* b = g_bodies.get(body);
  return b ? b->maxReliefM : 0.0;
}
// DW-18 — the body's gravitational parameter mu = G*M (m^3/s^2). THE gravity
// authority. Before this existed KinematicBody.ts transcribed /core's
// uniform-density model into JS, which was a second rule pretending to be a
// copy: when /core switched to mu the transcription would have kept the browser
// at 0.587 m/s^2 while the propagator ran at 9.81. Read this; do not re-derive.
OF_API double of_body_mu(int body) {
  const wg::BodyParams* b = g_bodies.get(body);
  return b ? b->muM3S2 : 0.0;
}
// Gravitational acceleration (m/s^2) at radius rM from the body centre. Exactly
// of::worldgen::SurfaceObserver::gravityAccel(), fallback included, so the
// walker in the browser and the walker in /core cannot disagree.
OF_API double of_gravity_accel(int body, double rM) {
  const wg::BodyParams* b = g_bodies.get(body);
  if (!b || rM <= 0.0) return 0.0;
  if (b->muM3S2 > 0.0) return b->muM3S2 / (rM * rM);
  constexpr double kG = 6.67430e-11;
  constexpr double kRho = 3500.0;
  return (4.0 / 3.0) * 3.14159265358979323846 * kG * kRho * rM;
}

// =============================================================================
// §2 — Voxel edit sets (voxel_terrain.h VoxelEdits). The destruction diff.
// =============================================================================
namespace { Registry<wg::VoxelEdits> g_edits; }

OF_API int of_edits_create(void) { return g_edits.add(new wg::VoxelEdits()); }
OF_API void of_edits_destroy(int e) { g_edits.remove(e); }

// dig(): remove every currently-solid cell within radiusM of a body-frame point.
// Returns the count of cells newly carved (drives harvest yield).
OF_API int of_edits_dig(int editsId, int bodyId, double x, double y, double z,
                        double radiusM) {
  wg::VoxelEdits* e = g_edits.get(editsId);
  const wg::BodyParams* b = g_bodies.get(bodyId);
  if (!e || !b) return -1;
  return e->dig(*b, vec(x, y, z), radiusM);
}
// Carve exactly one cell (used by tests / precise tools). 1 if newly removed.
OF_API int of_edits_dig_cell(int editsId, int32_t cx, int32_t cy, int32_t cz) {
  wg::VoxelEdits* e = g_edits.get(editsId);
  if (!e) return -1;
  return e->digCell(wg::VoxelCell{cx, cy, cz}) ? 1 : 0;
}
// Carve the cell containing a body-frame position.
OF_API int of_edits_dig_cell_at(int editsId, double x, double y, double z) {
  wg::VoxelEdits* e = g_edits.get(editsId);
  if (!e) return -1;
  return e->digCell(wg::cellForPos(vec(x, y, z))) ? 1 : 0;
}
OF_API int of_edits_removed_count(int editsId) {
  wg::VoxelEdits* e = g_edits.get(editsId);
  return e ? static_cast<int>(e->removedCount()) : -1;
}
OF_API int of_edits_is_removed_cell(int editsId, int32_t cx, int32_t cy, int32_t cz) {
  wg::VoxelEdits* e = g_edits.get(editsId);
  if (!e) return -1;
  return e->isRemoved(wg::VoxelCell{cx, cy, cz}) ? 1 : 0;
}
// Dirty AABB since the last clear. Fills i32 scratch with 6 ints
// [minX,minY,minZ,maxX,maxY,maxZ]; returns 1 if valid, 0 if nothing touched.
OF_API int of_edits_dirty_region(int editsId) {
  wg::VoxelEdits* e = g_edits.get(editsId);
  resetI32(6);
  if (!e) return -1;
  wg::VoxelEdits::CellAABB r = e->dirtyRegion();
  if (!r.valid) return 0;
  g_i32.push_back(r.min.cx); g_i32.push_back(r.min.cy); g_i32.push_back(r.min.cz);
  g_i32.push_back(r.max.cx); g_i32.push_back(r.max.cy); g_i32.push_back(r.max.cz);
  return 1;
}
OF_API void of_edits_clear_dirty(int editsId) {
  wg::VoxelEdits* e = g_edits.get(editsId);
  if (e) e->clearDirty();
}

// The cell containing a body-frame position -> i32 scratch [cx,cy,cz].
OF_API void of_cell_for_pos(double x, double y, double z) {
  const wg::VoxelCell c = wg::cellForPos(vec(x, y, z));
  resetI32(3);
  g_i32.push_back(c.cx); g_i32.push_back(c.cy); g_i32.push_back(c.cz);
}
// The body-frame centre of a cell -> f64 scratch [x,y,z].
OF_API void of_cell_center(int32_t cx, int32_t cy, int32_t cz) {
  const Vec3 p = wg::cellCenter(wg::VoxelCell{cx, cy, cz});
  resetF64(3);
  g_f64.push_back(p.x); g_f64.push_back(p.y); g_f64.push_back(p.z);
}
OF_API double of_voxel_size(void) { return wg::kVoxelSizeM; }

// exposedFaces(): the solid->air boundary quads the cube mesher draws. Returns
// the FACE COUNT; i32 scratch holds 5 ints per face: [cx, cy, cz, axis, sign].
OF_API int of_exposed_faces(int bodyId, int editsId, double x, double y, double z,
                            double radiusM) {
  const wg::BodyParams* b = g_bodies.get(bodyId);
  wg::VoxelEdits* e = g_edits.get(editsId);
  resetI32(1024);
  if (!b) return -1;
  static const wg::VoxelEdits kEmpty;
  const wg::VoxelEdits& ed = e ? *e : kEmpty;
  const std::vector<wg::FaceQuad> faces =
      wg::exposedFaces(*b, ed, vec(x, y, z), radiusM);
  g_i32.reserve(faces.size() * 5);
  for (const wg::FaceQuad& f : faces) {
    g_i32.push_back(f.cell.cx); g_i32.push_back(f.cell.cy);
    g_i32.push_back(f.cell.cz); g_i32.push_back(f.axis); g_i32.push_back(f.sign);
  }
  return static_cast<int>(faces.size());
}

// --- persistence (persistence.h byte cursors, no filesystem) ------------------
// Serialize the removed-cell diff to bytes in the u8 scratch. Returns byte count.
// JS persists these to IndexedDB / OPFS.
OF_API int of_edits_serialize(int editsId) {
  wg::VoxelEdits* e = g_edits.get(editsId);
  g_u8.clear();
  if (!e) return -1;
  of::persist::SaveWriter w;
  e->serialize(w);
  g_u8 = w.bytes();
  return static_cast<int>(g_u8.size());
}
// Load a removed-cell diff from `n` bytes previously written into the u8 scratch
// (JS: call of_edits_alloc_bytes(n), copy into HEAPU8 at of_scratch_u8(), then
// call this). Returns the removed-cell count on success, -1 on failure.
OF_API void of_edits_alloc_bytes(int n) { g_u8.assign(n > 0 ? n : 0, 0); }
OF_API int of_edits_deserialize(int editsId) {
  wg::VoxelEdits* e = g_edits.get(editsId);
  if (!e) return -1;
  of::persist::SaveReader r(g_u8);
  e->deserialize(r);
  return static_cast<int>(e->removedCount());
}

// =============================================================================
// §3 — The SURFACE ORACLE (surface_field.h). The single surface authority.
// `editsId <= 0` means "no digs" (the pure designed base).
// =============================================================================
namespace {
const wg::VoxelEdits* editsOrNull(int id) { return g_edits.get(id); }
}  // namespace

OF_API double of_base_height(int bodyId, double dx, double dy, double dz) {
  const wg::BodyParams* b = g_bodies.get(bodyId);
  if (!b) return NAN;
  return wg::baseHeight(*b, vec(dx, dy, dz));
}
OF_API double of_surface_height(int bodyId, int editsId,
                                double dx, double dy, double dz) {
  const wg::BodyParams* b = g_bodies.get(bodyId);
  if (!b) return NAN;
  const wg::VoxelEdits* e = editsOrNull(editsId);
  return e ? wg::surfaceHeight(*b, vec(dx, dy, dz), *e)
           : wg::surfaceHeight(*b, vec(dx, dy, dz));
}
OF_API double of_surface_radius(int bodyId, int editsId,
                                double dx, double dy, double dz) {
  const wg::BodyParams* b = g_bodies.get(bodyId);
  if (!b) return NAN;
  const wg::VoxelEdits* e = editsOrNull(editsId);
  return e ? wg::surfaceRadius(*b, vec(dx, dy, dz), *e)
           : b->radiusM + wg::baseHeight(*b, vec(dx, dy, dz));
}
OF_API double of_derived_lowering(int bodyId, int editsId,
                                  double dx, double dy, double dz) {
  const wg::BodyParams* b = g_bodies.get(bodyId);
  if (!b) return NAN;
  const wg::VoxelEdits* e = editsOrNull(editsId);
  return e ? wg::derivedLoweringAt(*b, vec(dx, dy, dz), *e) : 0.0;
}
OF_API double of_max_dig_depth(void) { return wg::kSurfaceMaxDigDepthM; }

// Voxel solidity through the oracle (designed base XOR removed).
OF_API int of_solid_at(int bodyId, int editsId, double x, double y, double z) {
  const wg::BodyParams* b = g_bodies.get(bodyId);
  if (!b) return -1;
  const wg::VoxelEdits* e = editsOrNull(editsId);
  if (e) return wg::solidAt(*b, vec(x, y, z), *e) ? 1 : 0;
  return wg::isProcSolid(*b, wg::cellForPos(vec(x, y, z))) ? 1 : 0;
}
OF_API int of_solid_cell(int bodyId, int editsId,
                         int32_t cx, int32_t cy, int32_t cz) {
  const wg::BodyParams* b = g_bodies.get(bodyId);
  if (!b) return -1;
  const wg::VoxelCell c{cx, cy, cz};
  const wg::VoxelEdits* e = editsOrNull(editsId);
  if (e) return wg::solidCell(*b, c, *e) ? 1 : 0;
  return wg::isProcSolid(*b, c) ? 1 : 0;
}

// Geodetic conveniences.
//
// of_sample_raw_height_latlon is a DIAGNOSTIC, NOT A SURFACE. It exposes the raw
// heightfield ingredient so a test can prove the raw/designed gap is still there
// (and that nothing is accidentally reading it). Never position anything with it:
// use of_surface_radius / of_observer_latlon_alt. of_sample_designed_height_latlon
// IS the oracle's base at a geo coord (== of_base_height of the same dir).
OF_API double of_sample_raw_height_latlon(int bodyId, double lat, double lon) {
  const wg::BodyParams* b = g_bodies.get(bodyId);
  if (!b) return NAN;
  return wg::SampleTerrainHeight(*b, lat, lon);
}
OF_API double of_sample_designed_height_latlon(int bodyId, double lat, double lon) {
  const wg::BodyParams* b = g_bodies.get(bodyId);
  if (!b) return NAN;
  return wg::SampleDesignedTerrainHeight(*b, lat, lon);
}
// lat/lon (radians) -> unit dir, into f64 scratch [x,y,z].
OF_API void of_latlon_to_dir(double lat, double lon) {
  const Vec3 d = wg::latLonToDir(lat, lon);
  resetF64(3);
  g_f64.push_back(d.x); g_f64.push_back(d.y); g_f64.push_back(d.z);
}
// unit dir -> lat/lon (radians), into f64 scratch [lat,lon].
OF_API void of_dir_to_latlon(double dx, double dy, double dz) {
  double lat = 0, lon = 0;
  wg::dirToLatLon(vec(dx, dy, dz), lat, lon);
  resetF64(2);
  g_f64.push_back(lat); g_f64.push_back(lon);
}

// =============================================================================
// §4 — Biomes (biome.h).
// =============================================================================
OF_API int of_biome_at(int bodyId, double dx, double dy, double dz) {
  const wg::BodyParams* b = g_bodies.get(bodyId);
  if (!b) return -1;
  return static_cast<int>(wg::biomeAt(*b, vec(dx, dy, dz)));
}
OF_API int of_biome_at_latlon(int bodyId, double lat, double lon) {
  const wg::BodyParams* b = g_bodies.get(bodyId);
  if (!b) return -1;
  return static_cast<int>(wg::biomeAtLatLon(*b, lat, lon));
}
OF_API int of_material_for_biome(int biome) {
  return static_cast<int>(wg::materialForBiome(static_cast<wg::Biome>(biome)));
}
OF_API double of_hardness_for_biome(int biome) {
  return wg::hardnessForBiome(static_cast<wg::Biome>(biome));
}
OF_API double of_temperature_at(int bodyId, double dx, double dy, double dz) {
  const wg::BodyParams* b = g_bodies.get(bodyId);
  if (!b) return NAN;
  return wg::temperatureAt(*b, vec(dx, dy, dz));
}
OF_API double of_moisture_at(int bodyId, double dx, double dy, double dz) {
  const wg::BodyParams* b = g_bodies.get(bodyId);
  if (!b) return NAN;
  return wg::moistureAt(*b, vec(dx, dy, dz));
}

// =============================================================================
// §5 — Quad-mesh generation (cubed_sphere.h generateQuadMesh).
//
// The mesh is retained WASM-side so JS can pull several array views from it with
// no copies. Positions are also offered PRE-CENTRED as f32 (position minus the
// chunk centre) — that is what a Three.js BufferGeometry wants, and it keeps f32
// precision sane at a 600 km body radius (raw f32 positions there would quantize
// to ~0.06 m; centre-relative they are sub-millimetre).
// =============================================================================
namespace {
struct MeshRec {
  wg::QuadMesh mesh;
  Vec3 center;                 // == mesh.centerUniverse.pos
  std::vector<float> posF32;   // centre-relative, 3 per vertex
  std::vector<float> nrmF32;   // 3 per vertex
  std::vector<float> dirF32;   // 3 per vertex (sphere normal / UV basis)
};
Registry<MeshRec> g_meshes;
std::vector<uint16_t> g_gridIndices;   // shared 32x32-cell triangle index buffer

void buildMeshFloats(MeshRec& r) {
  const size_t n = r.mesh.vertices.size();
  r.posF32.resize(n * 3);
  r.nrmF32.resize(n * 3);
  r.dirF32.resize(n * 3);
  for (size_t i = 0; i < n; ++i) {
    const Vec3& p = r.mesh.vertices[i];
    r.posF32[i * 3 + 0] = static_cast<float>(p.x - r.center.x);
    r.posF32[i * 3 + 1] = static_cast<float>(p.y - r.center.y);
    r.posF32[i * 3 + 2] = static_cast<float>(p.z - r.center.z);
    const Vec3& nv = r.mesh.normals[i];
    r.nrmF32[i * 3 + 0] = static_cast<float>(nv.x);
    r.nrmF32[i * 3 + 1] = static_cast<float>(nv.y);
    r.nrmF32[i * 3 + 2] = static_cast<float>(nv.z);
    const Vec3& d = r.mesh.dirs[i];
    r.dirF32[i * 3 + 0] = static_cast<float>(d.x);
    r.dirF32[i * 3 + 1] = static_cast<float>(d.y);
    r.dirF32[i * 3 + 2] = static_cast<float>(d.z);
  }
}
}  // namespace

// Generate one quad mesh. `editsId <= 0` = undug.
//
// LAST PARAMETER IS `rawBase`, AND 0 IS THE CORRECT ANSWER (ABI 2). 0 builds the
// mesh on the surface authority: the DESIGNED base, exactly what buildChunk /
// the walker / voxel solidity read. Nonzero selects the RAW heightfield and
// exists ONLY to reproduce the historical cubed_sphere.h determinism baselines;
// it is not a surface anything else in the engine agrees with. (Before ABI 2
// this flag was `designedBase`, so 0 (the value a forgetful caller passes)
// silently produced a raw mesh. Zero now means correct.)
//
// rawBase != 0 WITH edits bound is REJECTED (returns 0): the voxel-derived
// lowering is defined against the DESIGNED base, so subtracting it from a RAW
// base is the "mesh and edits use different bases" defect WG-21 removed.
// Returns a mesh handle, or 0 on bad args.
OF_API int of_quadmesh_generate(int bodyId, int faceId, int depth,
                                uint32_t qx, uint32_t qy, int editsId,
                                int rawBase) {
  const wg::BodyParams* b = g_bodies.get(bodyId);
  if (!b) return 0;
  wg::FQuadKey key{b->bodyId, faceId, depth, qx, qy};

  wg::HeightLoweringFn lowering = nullptr;
  const wg::VoxelEdits* e = editsOrNull(editsId);
  if (e) {
    if (rawBase) return 0;                     // mixed authority: refuse
    lowering = wg::SurfaceField(*b, e).loweringFn();
  }

  wg::HeightFieldFn base = nullptr;            // null == RAW inside /core
  if (!rawBase) {
    const wg::BodyParams body = *b;
    base = [body](const Vec3& dir) { return wg::baseHeight(body, dir); };
  }

  MeshRec* r = new MeshRec();
  r->mesh = wg::generateQuadMesh(*b, key, lowering, base);
  r->center = r->mesh.centerUniverse.pos;
  buildMeshFloats(*r);
  return g_meshes.add(r);
}
OF_API void of_quadmesh_destroy(int m) { g_meshes.remove(m); }

OF_API int of_quadmesh_grid_dim(int m) {
  MeshRec* r = g_meshes.get(m); return r ? r->mesh.gridDim : -1;
}
OF_API int of_quadmesh_vertex_count(int m) {
  MeshRec* r = g_meshes.get(m);
  return r ? static_cast<int>(r->mesh.vertices.size()) : -1;
}
OF_API double of_quadmesh_chunk_radius(int m) {
  MeshRec* r = g_meshes.get(m); return r ? r->mesh.chunkRadiusM : NAN;
}
OF_API uint32_t of_quadmesh_content_hash_lo(int m) {
  MeshRec* r = g_meshes.get(m);
  return splitLo(r ? r->mesh.contentHash : 0);
}
// Direct pointers into the RETAINED mesh (not the scratch arena) — stable for
// the lifetime of the mesh handle, but still invalidated by memory GROWTH, so
// JS must re-derive the view from the current HEAP buffer on every use.
OF_API float*  of_quadmesh_positions_f32(int m) {
  MeshRec* r = g_meshes.get(m); return r ? r->posF32.data() : nullptr;
}
OF_API float*  of_quadmesh_normals_f32(int m) {
  MeshRec* r = g_meshes.get(m); return r ? r->nrmF32.data() : nullptr;
}
OF_API float*  of_quadmesh_dirs_f32(int m) {
  MeshRec* r = g_meshes.get(m); return r ? r->dirF32.data() : nullptr;
}
OF_API double* of_quadmesh_heights_f64(int m) {
  MeshRec* r = g_meshes.get(m); return r ? r->mesh.heights.data() : nullptr;
}
// Chunk centre (body-frame metres, doubles) -> f64 scratch [x,y,z].
OF_API void of_quadmesh_center(int m) {
  MeshRec* r = g_meshes.get(m);
  resetF64(3);
  if (!r) return;
  g_f64.push_back(r->center.x); g_f64.push_back(r->center.y);
  g_f64.push_back(r->center.z);
}
// Exact double vertex positions (body-frame) -> f64 scratch, 3 per vertex.
// For physics/collision that needs full precision; the renderer uses the f32 path.
OF_API int of_quadmesh_positions_f64(int m) {
  MeshRec* r = g_meshes.get(m);
  resetF64(3 * 1089);
  if (!r) return -1;
  for (const Vec3& p : r->mesh.vertices) {
    g_f64.push_back(p.x); g_f64.push_back(p.y); g_f64.push_back(p.z);
  }
  return static_cast<int>(r->mesh.vertices.size());
}

// The shared triangle index buffer for a gridDim x gridDim vertex grid
// (row-major, idx = j*gridDim + i). Built once; returns the index COUNT.
// Pointer via of_grid_indices_ptr(). u16 is safe: 33*33 = 1089 < 65536.
OF_API int of_grid_indices(int gridDim) {
  const int G = gridDim > 1 ? gridDim : wg::kGridDim;
  const size_t want = static_cast<size_t>(G - 1) * (G - 1) * 6;
  if (g_gridIndices.size() != want) {
    g_gridIndices.clear();
    g_gridIndices.reserve(want);
    for (int j = 0; j < G - 1; ++j) {
      for (int i = 0; i < G - 1; ++i) {
        const uint16_t a = static_cast<uint16_t>(j * G + i);
        const uint16_t b2 = static_cast<uint16_t>(j * G + i + 1);
        const uint16_t c = static_cast<uint16_t>((j + 1) * G + i);
        const uint16_t d = static_cast<uint16_t>((j + 1) * G + i + 1);
        g_gridIndices.push_back(a); g_gridIndices.push_back(c); g_gridIndices.push_back(b2);
        g_gridIndices.push_back(b2); g_gridIndices.push_back(c); g_gridIndices.push_back(d);
      }
    }
  }
  return static_cast<int>(g_gridIndices.size());
}
OF_API uint16_t* of_grid_indices_ptr(void) {
  return g_gridIndices.empty() ? nullptr : g_gridIndices.data();
}

// =============================================================================
// §6 — Terrain streaming (terrain_stream.h TerrainStreamer).
//
// The streamer owns the resident chunk set. updateStreaming returns ready +
// evicted lists; we retain the last StreamUpdate so JS can pull each ready
// chunk's buffers by index before calling update again.
// =============================================================================
namespace {
struct StreamerRec {
  std::unique_ptr<wg::TerrainStreamer> s;
  wg::BodyParams body;
  wg::StreamUpdate last;
  int editsId = 0;
  // Per-chunk f32 staging (rebuilt on demand into the scratch arena).
};
Registry<StreamerRec> g_streamers;
}  // namespace

OF_API int of_streamer_create(int bodyId, double splitRatio, double mergeHysteresis,
                              int maxDepth, int minResidentDepth,
                              double skirtFraction, int genBudget) {
  const wg::BodyParams* b = g_bodies.get(bodyId);
  if (!b) return 0;
  wg::StreamConfig cfg;
  if (splitRatio > 0.0) cfg.splitRatio = splitRatio;
  if (mergeHysteresis > 0.0) cfg.mergeHysteresis = mergeHysteresis;
  if (maxDepth > 0) cfg.maxDepth = maxDepth;
  cfg.minResidentDepth = minResidentDepth;
  if (skirtFraction >= 0.0) cfg.skirtFraction = skirtFraction;
  cfg.genBudget = genBudget;
  StreamerRec* r = new StreamerRec();
  r->body = *b;
  r->s.reset(new wg::TerrainStreamer(*b, cfg));
  return g_streamers.add(r);
}
OF_API void of_streamer_destroy(int s) { g_streamers.remove(s); }

// Bind (or clear, with editsId <= 0) the voxel-derived dig lowering so newly
// built chunks drop into the player's digs. Mirrors SurfaceField::loweringFn().
OF_API void of_streamer_set_edits(int sId, int editsId) {
  StreamerRec* r = g_streamers.get(sId);
  if (!r) return;
  r->editsId = editsId;
  const wg::VoxelEdits* e = editsOrNull(editsId);
  if (e) r->s->setLoweringFn(wg::SurfaceField(r->body, e).loweringFn());
  else   r->s->setLoweringFn(nullptr);
}

// W5 THE MOUTH RECONCILIATION. Apply a dig to the streamer's OWN edit set and
// re-mesh every resident chunk it can have opened, publishing them through
// `last.ready` so JS consumes them on the unchanged chunk path (same meta /
// anchor / packed accessors, same slot reuse, same stitching).
//
// This is the worker half of DW-16: the main thread owns the authoritative
// VoxelEdits, the worker replays the op here into its own heap. It is also
// WG-21 in practice: the dig writes VOXELS ONLY, and the heightfield opens
// because buildChunk runs through SurfaceField::loweringFn(), i.e.
// derivedLoweringAt. A sideways tunnel leaves the top of its column solid, so
// the lowering is 0 and the ceiling stays: the reconciliation is a consequence
// of the oracle, not a second rule about when to open the ground.
//
// Returns the number of chunks re-meshed, or -1 for a bad handle.
OF_API int of_streamer_dig(int sId, double x, double y, double z, double radiusM) {
  StreamerRec* r = g_streamers.get(sId);
  if (!r) return -1;
  wg::VoxelEdits* e = g_edits.get(r->editsId);
  if (!e) return -1;
  const int removed = e->dig(r->body, vec(x, y, z), radiusM);
  if (removed <= 0) { r->last.ready.clear(); return 0; }

  // Rebuild every resident chunk whose quad could contain an opened column.
  // Distance is measured centre to centre against the chunk's own radius, so a
  // coarse far chunk that merely happens to face the dig is not re-meshed.
  const Vec3 p = vec(x, y, z);
  std::vector<wg::FQuadKey> hits;
  for (const auto& kv : r->s->resident()) {
    const wg::FQuadKey& k = kv.second.key;
    const Vec3 c = kv.second.centerUniverse.pos;
    const double reach = kv.second.chunkRadiusM + radiusM + wg::kVoxelSizeM;
    if ((c - p).lengthSq() <= reach * reach) hits.push_back(k);
  }
  r->last.ready.clear();
  for (const wg::FQuadKey& k : hits) {
    const wg::TerrainChunk* ch = r->s->rebuildChunk(k);
    if (ch) r->last.ready.push_back(*ch);
  }
  return static_cast<int>(r->last.ready.size());
}

// Drive LOD from the observer's body-frame authority position (metres).
// Returns the number of chunks READY this call.
OF_API int of_streamer_update(int sId, double ox, double oy, double oz) {
  StreamerRec* r = g_streamers.get(sId);
  if (!r) return -1;
  const UniverseCoord obs(vec(ox, oy, oz),
                          static_cast<FrameId>(r->body.bodyId + 1));
  r->last = r->s->updateStreaming(obs);
  return static_cast<int>(r->last.ready.size());
}
// Convenience observer builder: lat/lon (RADIANS) + altitude above THE SURFACE.
// Fills f64 scratch [x,y,z] so JS can feed of_streamer_update / place a camera.
//
// altM is measured from the ONE surface (surface_field.h): with `editsId > 0`
// that is surfaceRadius (designed base minus the voxel-derived lowering, bedrock
// clamped); with `editsId <= 0` it is the pristine designed base. Identical, bit
// for bit, to of_surface_radius(body, edits, dir) + altM.
//
// It deliberately does NOT call terrain_stream.h's makeObserverLatLonAlt, which
// is built on the RAW heightfield: on Forge that helper put an "altitude 60 m"
// observer 2.4 km UNDERGROUND (raw 4,075.51 m vs designed 6,520.81 m at
// lat 48 / lon 18), which is the multiple-surfaces failure WG-21 exists to
// delete. /core keeps the raw helper for its own historical baselines; the
// bridge does not export it. Guarded by parity CASE 7b.
OF_API void of_observer_latlon_alt(int bodyId, int editsId,
                                   double lat, double lon, double altM) {
  const wg::BodyParams* b = g_bodies.get(bodyId);
  resetF64(3);
  if (!b) return;
  const Vec3 dir = wg::latLonToDir(lat, lon);        // already unit length
  const wg::VoxelEdits* e = editsOrNull(editsId);
  const double surfR = e ? wg::surfaceRadius(*b, dir, *e)
                         : b->radiusM + wg::baseHeight(*b, dir);
  const Vec3 p = dir * (surfR + altM);
  g_f64.push_back(p.x); g_f64.push_back(p.y); g_f64.push_back(p.z);
}

OF_API int of_streamer_ready_count(int sId) {
  StreamerRec* r = g_streamers.get(sId);
  return r ? static_cast<int>(r->last.ready.size()) : -1;
}
OF_API int of_streamer_evicted_count(int sId) {
  StreamerRec* r = g_streamers.get(sId);
  return r ? static_cast<int>(r->last.evicted.size()) : -1;
}
OF_API int of_streamer_generated(int sId) {
  StreamerRec* r = g_streamers.get(sId); return r ? r->last.generated : -1;
}
OF_API int of_streamer_converged(int sId) {
  StreamerRec* r = g_streamers.get(sId); return r ? (r->last.converged ? 1 : 0) : -1;
}
OF_API int of_streamer_resident_count(int sId) {
  StreamerRec* r = g_streamers.get(sId);
  return r ? static_cast<int>(r->s->residentCount()) : -1;
}
// O(resident) re-anchor cost probe on a floating-origin rebase (geometry is
// rebase-invariant by contract; centerUniverse is the anchor).
OF_API int of_streamer_on_origin_rebased(int sId) {
  StreamerRec* r = g_streamers.get(sId);
  return r ? static_cast<int>(r->s->onOriginRebased()) : -1;
}

// Ready / evicted key lists -> i32 scratch, 4 ints per key [faceId,depth,qx,qy].
OF_API int of_streamer_ready_keys(int sId) {
  StreamerRec* r = g_streamers.get(sId);
  resetI32(256);
  if (!r) return -1;
  for (const wg::TerrainChunk& c : r->last.ready) {
    g_i32.push_back(c.key.faceId); g_i32.push_back(c.key.depth);
    g_i32.push_back(static_cast<int32_t>(c.key.qx));
    g_i32.push_back(static_cast<int32_t>(c.key.qy));
  }
  return static_cast<int>(r->last.ready.size());
}
OF_API int of_streamer_evicted_keys(int sId) {
  StreamerRec* r = g_streamers.get(sId);
  resetI32(256);
  if (!r) return -1;
  for (const wg::FQuadKey& k : r->last.evicted) {
    g_i32.push_back(k.faceId); g_i32.push_back(k.depth);
    g_i32.push_back(static_cast<int32_t>(k.qx));
    g_i32.push_back(static_cast<int32_t>(k.qy));
  }
  return static_cast<int>(r->last.evicted.size());
}

namespace {
const wg::TerrainChunk* readyChunk(int sId, int i) {
  StreamerRec* r = g_streamers.get(sId);
  if (!r || i < 0 || static_cast<size_t>(i) >= r->last.ready.size()) return nullptr;
  return &r->last.ready[static_cast<size_t>(i)];
}
}  // namespace

// Scalar metadata for ready chunk `i` -> i32 scratch, 11 ints:
// [faceId, depth, qx, qy, gridDim, materialId, biome, hashLo, hashHi,
//  skirtVertexCount, vertexCount]. Returns 1 on success.
OF_API int of_chunk_meta(int sId, int i) {
  const wg::TerrainChunk* c = readyChunk(sId, i);
  resetI32(16);
  if (!c) return 0;
  g_i32.push_back(c->key.faceId);
  g_i32.push_back(c->key.depth);
  g_i32.push_back(static_cast<int32_t>(c->key.qx));
  g_i32.push_back(static_cast<int32_t>(c->key.qy));
  g_i32.push_back(c->gridDim);
  g_i32.push_back(static_cast<int32_t>(c->materialId));
  g_i32.push_back(static_cast<int32_t>(c->biome));
  g_i32.push_back(static_cast<int32_t>(c->contentHash & 0xFFFFFFFFull));
  g_i32.push_back(static_cast<int32_t>(c->contentHash >> 32));
  g_i32.push_back(static_cast<int32_t>(c->skirtPositions.size()));
  g_i32.push_back(static_cast<int32_t>(c->positions.size()));
  return 1;
}
// Chunk centre + radius + skirt depth -> f64 scratch [cx,cy,cz,radiusM,skirtM].
OF_API int of_chunk_anchor(int sId, int i) {
  const wg::TerrainChunk* c = readyChunk(sId, i);
  resetF64(5);
  if (!c) return 0;
  g_f64.push_back(c->centerUniverse.pos.x);
  g_f64.push_back(c->centerUniverse.pos.y);
  g_f64.push_back(c->centerUniverse.pos.z);
  g_f64.push_back(c->chunkRadiusM);
  g_f64.push_back(c->skirtDepthM);
  return 1;
}
// Chunk neighbour LOD depths -> i32 scratch [-X, +X, -Y, +Y].
OF_API int of_chunk_neighbour_depths(int sId, int i) {
  const wg::TerrainChunk* c = readyChunk(sId, i);
  resetI32(4);
  if (!c) return 0;
  for (int e = 0; e < 4; ++e) g_i32.push_back(c->neighbourDepth[e]);
  return 1;
}
// Interleaved CENTRE-RELATIVE f32 positions -> f32 scratch, 3 per vertex.
// Returns the vertex count. Centre-relative keeps f32 sub-mm at 600 km radius.
OF_API int of_chunk_positions_f32(int sId, int i) {
  const wg::TerrainChunk* c = readyChunk(sId, i);
  resetF32(3 * 1089);
  if (!c) return -1;
  const Vec3& o = c->centerUniverse.pos;
  for (const Vec3& p : c->positions) {
    g_f32.push_back(static_cast<float>(p.x - o.x));
    g_f32.push_back(static_cast<float>(p.y - o.y));
    g_f32.push_back(static_cast<float>(p.z - o.z));
  }
  return static_cast<int>(c->positions.size());
}
OF_API int of_chunk_normals_f32(int sId, int i) {
  const wg::TerrainChunk* c = readyChunk(sId, i);
  resetF32(3 * 1089);
  if (!c) return -1;
  for (const Vec3& n : c->normals) {
    g_f32.push_back(static_cast<float>(n.x));
    g_f32.push_back(static_cast<float>(n.y));
    g_f32.push_back(static_cast<float>(n.z));
  }
  return static_cast<int>(c->normals.size());
}
OF_API int of_chunk_dirs_f32(int sId, int i) {
  const wg::TerrainChunk* c = readyChunk(sId, i);
  resetF32(3 * 1089);
  if (!c) return -1;
  for (const Vec3& d : c->dirs) {
    g_f32.push_back(static_cast<float>(d.x));
    g_f32.push_back(static_cast<float>(d.y));
    g_f32.push_back(static_cast<float>(d.z));
  }
  return static_cast<int>(c->dirs.size());
}
OF_API int of_chunk_skirt_f32(int sId, int i) {
  const wg::TerrainChunk* c = readyChunk(sId, i);
  resetF32(3 * 256);
  if (!c) return -1;
  const Vec3& o = c->centerUniverse.pos;
  for (const Vec3& p : c->skirtPositions) {
    g_f32.push_back(static_cast<float>(p.x - o.x));
    g_f32.push_back(static_cast<float>(p.y - o.y));
    g_f32.push_back(static_cast<float>(p.z - o.z));
  }
  return static_cast<int>(c->skirtPositions.size());
}
// Exact per-vertex relief (metres) -> f64 scratch. The parity/physics path.
OF_API int of_chunk_heights_f64(int sId, int i) {
  const wg::TerrainChunk* c = readyChunk(sId, i);
  resetF64(1089);
  if (!c) return -1;
  for (double h : c->heights) g_f64.push_back(h);
  return static_cast<int>(c->heights.size());
}

// =============================================================================
// §6b — THE PACKED CHUNK VERTEX BUFFER (R1 — the renderer's critical path).
//
// ONE pre-interleaved, GPU-ready buffer per chunk, written straight into the
// WASM heap. JS makes a zero-copy Uint8Array view over it and hands it to a
// THREE.InterleavedBuffer / BufferGeometry. Nothing is traversed element by
// element across the boundary; the whole chunk crosses as one memcpy-able span.
//
// LAYOUT — 28 bytes per vertex, little-endian (bind these exact offsets):
//   off  0  float32[3]  position      metres, RELATIVE TO chunkCenter (see below)
//   off 12  int8[4]     normal        normalized signed: n = v/127, w unused (0)
//   off 16  uint16[2]   uv            normalized: uv = v/65535, over the quad
//   off 20  uint8[4]    biome         [biomeId, materialId, hardness*255, flags]
//                                     flags bit0 = 1 -> this is a SKIRT vertex
//   off 24  float32     height        relief in metres above the body datum
//
// VERTEX COUNT is constant: kGridDim is constexpr 33, so every chunk is
// 33*33 = 1089 interior + 128 skirt = 1217 vertices = 34,076 bytes. Buffers are
// therefore poolable and reusable on the JS side with a fixed stride.
//
// PRECISION AT PLANET SCALE (the thing that repeatedly broke in UE): positions
// are float32 but RELATIVE TO THE CHUNK'S OWN 64-bit anchor (centerUniverse,
// available exactly via of_chunk_anchor). Absolute float32 at Forge's 600 km
// radius quantizes to ~0.06 m; relative to a chunk centre the magnitudes are
// bounded by chunkRadiusM, so the quantization is ~0.03 m on the coarsest
// (depth-0) chunk and ~2 mm at depth 5+. The renderer must place the mesh at
// (centerUniverse - floatingOrigin) and never bake the absolute position into
// the vertex data. The exact double positions remain available via
// of_quadmesh_positions_f64 / of_chunk_heights_f64 for physics.
//
// NOTE on "biome weights": /core's biomeAt is a HARD classifier (one biome per
// direction), so there is no 4-way weight vector to pack. We hand the renderer
// the per-vertex biomeId + materialId + hardness instead; a smooth blend can be
// derived in the fragment shader from the three corner biomeIds of a triangle
// (barycentric weights), which is where a blend belongs anyway. If world-gen
// later grows a weighted classifier, the 4 bytes at offset 20 are the slot.
// =============================================================================
static constexpr int kPackedStride = 28;

OF_API int of_packed_stride(void) { return kPackedStride; }
OF_API int of_packed_offset_position(void) { return 0; }
OF_API int of_packed_offset_normal(void) { return 12; }
OF_API int of_packed_offset_uv(void) { return 16; }
OF_API int of_packed_offset_biome(void) { return 20; }
OF_API int of_packed_offset_height(void) { return 24; }

namespace {
inline void putF32(uint8_t* p, float v) { std::memcpy(p, &v, 4); }
inline int8_t packUnit(double v) {
  double s = v * 127.0;
  if (s > 127.0) s = 127.0;
  if (s < -127.0) s = -127.0;
  return static_cast<int8_t>(s >= 0 ? (s + 0.5) : (s - 0.5));
}
inline void putU16(uint8_t* p, uint16_t v) { std::memcpy(p, &v, 2); }

// The skirt ring's pairing with interior grid coords, matching terrain_stream.h
// buildSkirt's emission order: south row, north row, west interior, east
// interior. Returns the interior (i,j) that skirt vertex `s` hangs from.
inline void skirtPair(int s, int G, int& gi, int& gj) {
  if (s < G)            { gi = s;          gj = 0;     return; }
  if (s < 2 * G)        { gi = s - G;      gj = G - 1; return; }
  const int w = G - 2;
  if (s < 2 * G + w)    { gi = 0;          gj = s - 2 * G + 1;     return; }
  gi = G - 1;           gj = s - 2 * G - w + 1;
}
}  // namespace

// Pack ready chunk `i` into the u8 scratch. Returns the BYTE LENGTH (0 on bad
// args). JS: `const n = M._of_chunk_packed(s, i);
//            const buf = M.HEAPU8.subarray(M._of_scratch_u8(), M._of_scratch_u8() + n);`
// then copy/upload it BEFORE the next WASM call (see the memory-view rules).
OF_API int of_chunk_packed(int sId, int i) {
  StreamerRec* r = g_streamers.get(sId);
  const wg::TerrainChunk* c = readyChunk(sId, i);
  if (!r || !c) { g_u8.clear(); return 0; }
  const int G = c->gridDim;
  const size_t nIn = c->positions.size();
  const size_t nSk = c->skirtPositions.size();
  const size_t n = nIn + nSk;
  g_u8.assign(n * kPackedStride, 0);
  uint8_t* out = g_u8.data();
  const Vec3& o = c->centerUniverse.pos;
  const double invG = 1.0 / static_cast<double>(G - 1);

  // Interior grid. biomeAt is evaluated once per vertex here; the skirt reuses
  // its paired interior vertex's classification (a skirt is hidden geometry).
  std::vector<uint8_t> biomeOf(nIn), matOf(nIn), hardOf(nIn);
  for (size_t v = 0; v < nIn; ++v) {
    uint8_t* p = out + v * kPackedStride;
    const Vec3& pos = c->positions[v];
    putF32(p + 0, static_cast<float>(pos.x - o.x));
    putF32(p + 4, static_cast<float>(pos.y - o.y));
    putF32(p + 8, static_cast<float>(pos.z - o.z));
    const Vec3& nv = c->normals[v];
    p[12] = static_cast<uint8_t>(packUnit(nv.x));
    p[13] = static_cast<uint8_t>(packUnit(nv.y));
    p[14] = static_cast<uint8_t>(packUnit(nv.z));
    p[15] = 0;
    const int gi = static_cast<int>(v) % G;
    const int gj = static_cast<int>(v) / G;
    putU16(p + 16, static_cast<uint16_t>(gi * invG * 65535.0 + 0.5));
    putU16(p + 18, static_cast<uint16_t>(gj * invG * 65535.0 + 0.5));
    const wg::Biome b = wg::biomeAt(r->body, c->dirs[v]);
    const uint8_t bid = static_cast<uint8_t>(b);
    const uint8_t mid = static_cast<uint8_t>(wg::materialForBiome(b) & 0xFF);
    const uint8_t hrd = static_cast<uint8_t>(wg::hardnessForBiome(b) * 255.0 + 0.5);
    biomeOf[v] = bid; matOf[v] = mid; hardOf[v] = hrd;
    p[20] = bid; p[21] = mid; p[22] = hrd; p[23] = 0;
    putF32(p + 24, static_cast<float>(c->heights[v]));
  }
  // Skirt ring (flags bit0 set) — same dir/normal/uv/biome as its interior pair,
  // just dropped radially inward by skirtDepthM.
  for (size_t s = 0; s < nSk; ++s) {
    uint8_t* p = out + (nIn + s) * kPackedStride;
    const Vec3& pos = c->skirtPositions[s];
    putF32(p + 0, static_cast<float>(pos.x - o.x));
    putF32(p + 4, static_cast<float>(pos.y - o.y));
    putF32(p + 8, static_cast<float>(pos.z - o.z));
    int gi = 0, gj = 0;
    skirtPair(static_cast<int>(s), G, gi, gj);
    const size_t pair = static_cast<size_t>(gj) * G + gi;
    const Vec3& nv = c->normals[pair];
    p[12] = static_cast<uint8_t>(packUnit(nv.x));
    p[13] = static_cast<uint8_t>(packUnit(nv.y));
    p[14] = static_cast<uint8_t>(packUnit(nv.z));
    p[15] = 0;
    putU16(p + 16, static_cast<uint16_t>(gi * invG * 65535.0 + 0.5));
    putU16(p + 18, static_cast<uint16_t>(gj * invG * 65535.0 + 0.5));
    p[20] = biomeOf[pair]; p[21] = matOf[pair]; p[22] = hardOf[pair];
    p[23] = 1;                                     // flags bit0 = skirt
    putF32(p + 24, static_cast<float>(c->heights[pair]));
  }
  return static_cast<int>(g_u8.size());
}
OF_API int of_packed_vertex_count(void) { return wg::kGridDim * wg::kGridDim + 128; }

// The chunk INDEX buffer: interior triangles followed by the skirt apron
// triangles, uint16 (1217 < 65536). Built once and reused for every chunk,
// because kGridDim is constexpr. Returns the TOTAL index count; the interior
// portion is the first of_chunk_interior_index_count() entries, so the renderer
// can draw interior and skirt as separate draw ranges if it wants.
// Triangle order per cell (a=(i,j) b=(i+1,j) c=(i,j+1) d=(i+1,j+1)):
//   (a, c, b) then (b, c, d).
namespace { std::vector<uint16_t> g_chunkIndices; int g_interiorIdx = 0; }

OF_API int of_chunk_interior_index_count(void) { return g_interiorIdx; }
OF_API uint16_t* of_chunk_index_ptr(void) {
  return g_chunkIndices.empty() ? nullptr : g_chunkIndices.data();
}
OF_API int of_chunk_index_buffer(void) {
  if (!g_chunkIndices.empty()) return static_cast<int>(g_chunkIndices.size());
  const int G = wg::kGridDim;
  g_chunkIndices.reserve((G - 1) * (G - 1) * 6 + 4 * (G - 1) * 6);
  for (int j = 0; j < G - 1; ++j) {
    for (int i = 0; i < G - 1; ++i) {
      const uint16_t a = static_cast<uint16_t>(j * G + i);
      const uint16_t b = static_cast<uint16_t>(j * G + i + 1);
      const uint16_t cc = static_cast<uint16_t>((j + 1) * G + i);
      const uint16_t d = static_cast<uint16_t>((j + 1) * G + i + 1);
      g_chunkIndices.push_back(a); g_chunkIndices.push_back(cc); g_chunkIndices.push_back(b);
      g_chunkIndices.push_back(b); g_chunkIndices.push_back(cc); g_chunkIndices.push_back(d);
    }
  }
  g_interiorIdx = static_cast<int>(g_chunkIndices.size());

  // Skirt apron: for each perimeter edge, a quad joining the two interior
  // vertices to their two skirt vertices. Skirt base index = G*G.
  const int SB = G * G;
  // Map an interior perimeter (i,j) to its skirt slot (inverse of skirtPair).
  auto skirtSlot = [&](int i, int j) -> int {
    if (j == 0) return i;
    if (j == G - 1) return G + i;
    if (i == 0) return 2 * G + (j - 1);
    return 2 * G + (G - 2) + (j - 1);
  };
  auto edgeQuad = [&](int i0, int j0, int i1, int j1) {
    const uint16_t a = static_cast<uint16_t>(j0 * G + i0);
    const uint16_t b = static_cast<uint16_t>(j1 * G + i1);
    const uint16_t sa = static_cast<uint16_t>(SB + skirtSlot(i0, j0));
    const uint16_t sb = static_cast<uint16_t>(SB + skirtSlot(i1, j1));
    g_chunkIndices.push_back(a);  g_chunkIndices.push_back(sa); g_chunkIndices.push_back(b);
    g_chunkIndices.push_back(b);  g_chunkIndices.push_back(sa); g_chunkIndices.push_back(sb);
  };
  for (int i = 0; i < G - 1; ++i) edgeQuad(i, 0, i + 1, 0);                  // south
  for (int i = 0; i < G - 1; ++i) edgeQuad(i + 1, G - 1, i, G - 1);          // north
  for (int j = 0; j < G - 1; ++j) edgeQuad(0, j + 1, 0, j);                  // west
  for (int j = 0; j < G - 1; ++j) edgeQuad(G - 1, j, G - 1, j + 1);          // east
  return static_cast<int>(g_chunkIndices.size());
}

// The BOUNDING RADIUS of ready chunk `i`: max Euclidean |vertex - chunkCentre|
// in metres, over EVERY vertex the chunk emits: interior grid AND skirt ring.
//
// SEMANTICS FIXED IN ABI 2. It used to return the largest single-AXIS offset
// (an L-infinity half-extent, up to sqrt(3) short of the real radius) over the
// INTERIOR ONLY (the skirt hangs radially inward by skirtDepthM and is routinely
// the furthest geometry). Measured on a depth-3 Forge chunk it reported
// 52,639 m for a chunk whose furthest emitted vertex is at 108,403 m, so a
// renderer using it as a bounding sphere frustum-culled chunks that were on
// screen. It is now exactly the value the worker's de-interleave loop computes,
// so the renderer can take this instead of recomputing it.
//
// Two uses, both correct with this definition:
//   * bounding sphere: centre = of_chunk_anchor's centre, radius = this.
//   * float32 quantization bound of the packed positions: quantum <= r * 2^-23
//     (a Euclidean radius bounds every per-axis component, so this is
//     conservative in the safe direction).
OF_API double of_chunk_max_offset(int sId, int i) {
  const wg::TerrainChunk* c = readyChunk(sId, i);
  if (!c) return -1.0;
  const Vec3& o = c->centerUniverse.pos;
  double m2 = 0.0;
  auto acc = [&](const Vec3& p) {
    const double dx = p.x - o.x, dy = p.y - o.y, dz = p.z - o.z;
    const double r2 = dx * dx + dy * dy + dz * dz;
    if (r2 > m2) m2 = r2;
  };
  for (const Vec3& p : c->positions) acc(p);
  for (const Vec3& p : c->skirtPositions) acc(p);
  return std::sqrt(m2);
}

// =============================================================================
// §7 — Factory / automation (factory_sim.h + automation.h).
//
// One BuildableNetwork per handle; buildings are addressed by a per-network
// build index (JS never sees an EntityHandle).
// =============================================================================
namespace {
struct NetRec {
  std::unique_ptr<au::BuildableNetwork> net;
  std::vector<au::BuildId> builds;
  au::BuildId* build(int i) {
    if (i < 0 || static_cast<size_t>(i) >= builds.size()) return nullptr;
    return &builds[static_cast<size_t>(i)];
  }
};
Registry<NetRec> g_nets;
}  // namespace

OF_API int of_net_create(double fixedDt) {
  NetRec* r = new NetRec();
  r->net.reset(new au::BuildableNetwork(fixedDt > 0.0 ? fixedDt : 1.0 / 60.0));
  return g_nets.add(r);
}
OF_API void of_net_destroy(int n) { g_nets.remove(n); }

// depositAmount is passed as a double (exact for < 2^53 units — far beyond any
// real deposit). Returns the build index, or -1.
OF_API int of_net_place_miner(int nId, double depositAmount, int item,
                              double ratePerSecond, int outCap) {
  NetRec* r = g_nets.get(nId);
  if (!r) return -1;
  au::BuildId b = r->net->placeMinerOnDeposit(
      static_cast<uint64_t>(depositAmount), static_cast<fs::ItemId>(item),
      ratePerSecond, static_cast<uint16_t>(outCap));
  r->builds.push_back(b);
  return static_cast<int>(r->builds.size()) - 1;
}
OF_API int of_net_place_belt(int nId, int tiles, int speed) {
  NetRec* r = g_nets.get(nId);
  if (!r) return -1;
  r->builds.push_back(r->net->placeBelt(static_cast<uint32_t>(tiles),
                                        static_cast<uint32_t>(speed)));
  return static_cast<int>(r->builds.size()) - 1;
}
OF_API int of_net_place_smelter(int nId, int ore, int ingot, int craftTicks,
                                int powerW, int outCap) {
  NetRec* r = g_nets.get(nId);
  if (!r) return -1;
  r->builds.push_back(r->net->placeSmelter(
      static_cast<fs::ItemId>(ore), static_cast<fs::ItemId>(ingot),
      static_cast<uint32_t>(craftTicks), powerW, static_cast<uint16_t>(outCap)));
  return static_cast<int>(r->builds.size()) - 1;
}
OF_API int of_net_place_assembler(int nId, int inA, int countA, int inB, int countB,
                                  int out, int outCount, int craftTicks,
                                  int powerW, int outCap) {
  NetRec* r = g_nets.get(nId);
  if (!r) return -1;
  r->builds.push_back(r->net->placeAssembler(
      static_cast<fs::ItemId>(inA), static_cast<uint16_t>(countA),
      static_cast<fs::ItemId>(inB), static_cast<uint16_t>(countB),
      static_cast<fs::ItemId>(out), static_cast<uint16_t>(outCount),
      static_cast<uint32_t>(craftTicks), powerW, static_cast<uint16_t>(outCap)));
  return static_cast<int>(r->builds.size()) - 1;
}
// Wire two buildings. `item` 0 = auto-infer. Returns 1 on success, 0 on failure.
OF_API int of_net_connect(int nId, int from, int to, int item) {
  NetRec* r = g_nets.get(nId);
  if (!r) return 0;
  au::BuildId* a = r->build(from);
  au::BuildId* b = r->build(to);
  if (!a || !b) return 0;
  fs::EntityHandle e = r->net->connect(*a, *b, static_cast<fs::ItemId>(item));
  return e.valid() ? 1 : 0;
}
// Pre-fill a belt to saturation with `item` (test/debug helper mirroring
// FactorySim::line(h).fillSaturated). Returns the item count placed.
OF_API int of_net_belt_fill_saturated(int nId, int belt, int item) {
  NetRec* r = g_nets.get(nId);
  if (!r) return -1;
  au::BuildId* b = r->build(belt);
  if (!b || !b->valid()) return -1;
  return static_cast<int>(
      r->net->sim().line(b->entity).fillSaturated(static_cast<fs::ItemId>(item)));
}
// Hand-feed a machine's slot-1 input (test/debug helper).
OF_API int of_net_feed_machine(int nId, int build, int count) {
  NetRec* r = g_nets.get(nId);
  if (!r) return -1;
  au::BuildId* b = r->build(build);
  if (!b || !b->valid()) return -1;
  r->net->sim().feedMachine(b->entity, static_cast<uint16_t>(count));
  return 1;
}

OF_API void of_net_step(int nId) {
  NetRec* r = g_nets.get(nId); if (r) r->net->step();
}
OF_API void of_net_step_n(int nId, double n) {
  NetRec* r = g_nets.get(nId);
  if (r) r->net->stepN(static_cast<uint64_t>(n));
}
OF_API double of_net_tick_index(int nId) {
  NetRec* r = g_nets.get(nId);
  return r ? static_cast<double>(r->net->tickIndex()) : -1.0;
}
OF_API double of_net_produced_of(int nId, int item) {
  NetRec* r = g_nets.get(nId);
  return r ? static_cast<double>(r->net->producedCountOf(static_cast<fs::ItemId>(item)))
           : -1.0;
}
OF_API double of_net_produced_total(int nId) {
  NetRec* r = g_nets.get(nId);
  return r ? static_cast<double>(r->net->producedCount()) : -1.0;
}
OF_API double of_net_miner_remaining(int nId, int build) {
  NetRec* r = g_nets.get(nId); if (!r) return -1.0;
  au::BuildId* b = r->build(build); if (!b) return -1.0;
  return static_cast<double>(r->net->minerRemaining(*b));
}
OF_API int of_net_miner_depleted(int nId, int build) {
  NetRec* r = g_nets.get(nId); if (!r) return -1;
  au::BuildId* b = r->build(build); if (!b) return -1;
  return r->net->minerDepleted(*b) ? 1 : 0;
}
OF_API int of_net_output_buffer(int nId, int build) {
  NetRec* r = g_nets.get(nId); if (!r) return -1;
  au::BuildId* b = r->build(build); if (!b) return -1;
  return static_cast<int>(r->net->outputBuffer(*b));
}
OF_API int of_net_input_buffer(int nId, int build) {
  NetRec* r = g_nets.get(nId); if (!r) return -1;
  au::BuildId* b = r->build(build); if (!b) return -1;
  return static_cast<int>(r->net->inputBuffer(*b));
}
OF_API int of_net_input2_buffer(int nId, int build) {
  NetRec* r = g_nets.get(nId); if (!r) return -1;
  au::BuildId* b = r->build(build); if (!b) return -1;
  return static_cast<int>(r->net->input2Buffer(*b));
}
OF_API int of_net_belt_item_count(int nId, int build) {
  NetRec* r = g_nets.get(nId); if (!r) return -1;
  au::BuildId* b = r->build(build); if (!b) return -1;
  return static_cast<int>(r->net->beltItemCount(*b));
}
OF_API int of_net_working(int nId, int build) {
  NetRec* r = g_nets.get(nId); if (!r) return -1;
  au::BuildId* b = r->build(build); if (!b) return -1;
  return r->net->working(*b) ? 1 : 0;
}
OF_API double of_net_progress01(int nId, int build) {
  NetRec* r = g_nets.get(nId); if (!r) return -1.0;
  au::BuildId* b = r->build(build); if (!b) return -1.0;
  return r->net->progress01(*b);
}

// --- The §6 render stream ----------------------------------------------------
// EmitEntityStates: one row per live entity. Returns the ROW COUNT and fills
// BOTH scratch buffers:
//   i32 scratch, 6 ints/row : [Id, TypeId, VisualState, AnimPhase, Lod, BoundRadius]
//   f32 scratch, 3 floats/row: [x, y, z]
// JS reads the i32 view first, then the f32 view (neither call invalidates the
// other — they are separate arenas).
OF_API int of_net_emit_entity_states(int nId) {
  NetRec* r = g_nets.get(nId);
  resetI32(256); resetF32(128);
  if (!r) return -1;
  const std::vector<fs::FFactoryEntityState> rows = r->net->sim().EmitEntityStates();
  g_i32.reserve(rows.size() * 6);
  g_f32.reserve(rows.size() * 3);
  for (const fs::FFactoryEntityState& s : rows) {
    g_i32.push_back(static_cast<int32_t>(s.Id));
    g_i32.push_back(static_cast<int32_t>(s.TypeId));
    g_i32.push_back(static_cast<int32_t>(s.VisualState));
    g_i32.push_back(static_cast<int32_t>(s.AnimPhase));
    g_i32.push_back(static_cast<int32_t>(s.Lod));
    g_i32.push_back(static_cast<int32_t>(s.BoundRadius));
    g_f32.push_back(s.Position[0]); g_f32.push_back(s.Position[1]);
    g_f32.push_back(s.Position[2]);
  }
  return static_cast<int>(rows.size());
}
// EmitBeltFlowStates: the O(lines) belt view (LOD-1+). Returns the row count;
// i32 scratch, 5 ints/row: [LineId, ItemTypeDominant, FlowSpeedQuant, Density,
// Compressed].
OF_API int of_net_emit_belt_flows(int nId) {
  NetRec* r = g_nets.get(nId);
  resetI32(64);
  if (!r) return -1;
  const std::vector<fs::FFactoryBeltFlowState> rows =
      r->net->sim().EmitBeltFlowStates();
  for (const fs::FFactoryBeltFlowState& f : rows) {
    g_i32.push_back(static_cast<int32_t>(f.LineId));
    g_i32.push_back(static_cast<int32_t>(f.ItemTypeDominant));
    g_i32.push_back(static_cast<int32_t>(f.FlowSpeedQuant));
    g_i32.push_back(static_cast<int32_t>(f.Density));
    g_i32.push_back(static_cast<int32_t>(f.Compressed));
  }
  return static_cast<int>(rows.size());
}
// GetLineItems: the ONE O(items) pull, LOD-0 only. `build` is a belt build index.
// Returns the item count; i32 scratch, 2 ints/item: [ItemType, UnitOffset].
OF_API int of_net_get_line_items(int nId, int build) {
  NetRec* r = g_nets.get(nId);
  resetI32(128);
  if (!r) return -1;
  au::BuildId* b = r->build(build);
  if (!b || !b->valid()) return -1;
  const std::vector<fs::FLineItem> items =
      r->net->sim().GetLineItems(b->entity.index);
  for (const fs::FLineItem& it : items) {
    g_i32.push_back(static_cast<int32_t>(it.ItemType));
    g_i32.push_back(static_cast<int32_t>(it.UnitOffset));
  }
  return static_cast<int>(items.size());
}
OF_API int of_net_units_per_tile(void) { return static_cast<int>(fs::kUnitsPerTile); }

// =============================================================================
// §8 — DETERMINISM DIAGNOSTICS.
//
// Not part of the game API. These exist because cross-toolchain bit-parity can
// only fail in two places: the compiler's float codegen, or libm. The two probes
// below separate those cases so a future divergence can be pinned in minutes
// instead of bisected. Keep them exported — they cost ~200 bytes.
// =============================================================================

// Single libm call, so a native/WASM diff isolates WHICH function differs.
OF_API double of_diag_libm(int fn, double a, double b) {
  switch (fn) {
    case 0:  return std::sin(a);
    case 1:  return std::cos(a);
    case 2:  return std::tan(a);
    case 3:  return std::asin(a);
    case 4:  return std::acos(a);
    case 5:  return std::atan2(a, b);
    case 6:  return std::sqrt(a);
    case 7:  return std::floor(a);
    case 8:  return std::fabs(a);
    case 9:  return std::exp(a);
    case 10: return std::log(a);
    case 11: return std::pow(a, b);
    default: return NAN;
  }
}

// Walk a quad's 33x33 vertex lattice and report every intermediate the terrain
// pipeline computes, so a mismatch localises to a stage:
//   f64 scratch, 8 doubles per vertex:
//     [dirX, dirY, dirZ, latitude, temperature, moisture, rawHeight, designedHeight]
//   i32 scratch, 1 int per vertex: the biome id
// Returns the vertex count.
OF_API int of_diag_scan_quad(int bodyId, int faceId, int depth,
                             uint32_t qx, uint32_t qy) {
  const wg::BodyParams* b = g_bodies.get(bodyId);
  resetF64(8 * 1089); resetI32(1089);
  if (!b) return -1;
  const int level = depth + wg::kCellBits;
  const uint64_t bx = static_cast<uint64_t>(qx) << wg::kCellBits;
  const uint64_t by = static_cast<uint64_t>(qy) << wg::kCellBits;
  int n = 0;
  for (int j = 0; j < wg::kGridDim; ++j) {
    for (int i = 0; i < wg::kGridDim; ++i) {
      const Vec3 d = wg::latticeDir(faceId, bx + i, by + j, level);
      double lat = 0, lon = 0;
      wg::dirToLatLon(d, lat, lon);
      g_f64.push_back(d.x); g_f64.push_back(d.y); g_f64.push_back(d.z);
      g_f64.push_back(lat);
      g_f64.push_back(wg::temperatureAt(*b, d));
      g_f64.push_back(wg::moistureAt(*b, d));
      g_f64.push_back(wg::sampleHeightField(*b, d));
      g_f64.push_back(wg::sampleDesignedHeight(*b, d));
      g_i32.push_back(static_cast<int32_t>(wg::biomeAt(*b, d)));
      ++n;
    }
  }
  return n;
}

// =============================================================================
// SECTION 9 - GAMEPLAY (the survival slice): inventory, hand harvest, hand
// crafting, fuel-driven furnaces. A THIN shim over of/gameplay.h; no rule is
// restated here. The two conventions from the file header hold unchanged:
// stateful things are handles/indices, arrays land in the scratch arena, and JS
// re-reads both the pointer and HEAPxx after every call.
//
// SINGLE-PLAYER SINGLETONS. There is exactly one SliceRegistry and one
// Inventory per module instance, because Inventory holds a `const
// SliceRegistry*` and the registry must outlive it. of_gp_init() builds both,
// registers the survival content on top of the pinned slice table, and is
// idempotent, so a reload or a second caller cannot double-register.
//
// SURFACE AUTHORITY. of_gp_nodes_layout snaps every node with a SnapHeightFn
// that calls wg::surfaceHeight (the oracle, digs included), NOT the raw
// heightfield that LayoutTestArea defaults to. A node placed on RAW would sit
// kilometres off the ground the player stands on: the five-surfaces failure in
// miniature, and exactly the bug that has now bitten this project three times.
// =============================================================================
namespace {
std::unique_ptr<gp::SliceRegistry> g_reg;
std::unique_ptr<gp::Inventory> g_inv;

// The survival node patch. FDepositNode carries no NodeKind (world-gen derives
// Resource from the kind and then keeps the kind out of the record), so the kind
// rides alongside in a parallel vector. The shared index IS the node handle.
std::vector<wg::FDepositNode> g_gpNodes;
std::vector<uint8_t> g_gpKinds;
std::vector<uint8_t> g_gpPending;   // kinds queued for the next layout call

std::vector<sv::CraftRecipe> g_gpRecipes;

Registry<sv::Furnace> g_furnaces;

bool gpReady() { return g_reg && g_inv; }
}  // namespace

// Build the registry + inventory. Idempotent; returns 1 when ready, 0 on failure.
OF_API int of_gp_init(void) {
  if (gpReady()) return 1;
  g_reg.reset(new gp::SliceRegistry());
  if (!sv::RegisterSurvivalContent(*g_reg)) { g_reg.reset(); return 0; }
  g_inv.reset(new gp::Inventory(*g_reg));
  g_gpRecipes = sv::handRecipes();
  return 1;
}

// --- Inventory ---------------------------------------------------------------
OF_API int of_gp_slot_count(void) {
  return gpReady() ? g_inv->slotCount() : 0;
}

// Every slot as [itemId, count] pairs in the i32 scratch. Returns the slot count.
OF_API int of_gp_inventory(void) {
  if (!gpReady()) { resetI32(0); return 0; }
  const int n = g_inv->slotCount();
  resetI32(static_cast<size_t>(n) * 2);
  for (int i = 0; i < n; ++i) {
    const gp::ItemStack& s = g_inv->slot(i);
    g_i32.push_back(static_cast<int32_t>(s.item));
    g_i32.push_back(static_cast<int32_t>(s.count));
  }
  return n;
}

OF_API int of_gp_count(int item) {
  if (!gpReady()) return 0;
  return static_cast<int>(g_inv->count(static_cast<gp::ItemId>(item)));
}
// Returns the overflow that did NOT fit (0 = all added), matching Inventory::add.
OF_API int of_gp_add(int item, int count) {
  if (!gpReady()) return count;
  return g_inv->add(static_cast<gp::ItemId>(item), static_cast<uint16_t>(count));
}
OF_API int of_gp_remove(int item, int count) {
  if (!gpReady()) return 0;
  return g_inv->remove(static_cast<gp::ItemId>(item), static_cast<uint16_t>(count));
}
// Empty the pack (new game / test reset). Returns the slot count cleared.
OF_API int of_gp_clear(void) {
  if (!gpReady()) return 0;
  g_inv.reset(new gp::Inventory(*g_reg));
  return g_inv->slotCount();
}

// --- Item metadata (names come from /core, so the UI cannot drift) ------------
OF_API int of_gp_item_count(void) {
  return gpReady() ? static_cast<int>(g_reg->allItems().size()) : 0;
}
// i32 scratch [id, category, stackMax, flags, placesEntityTypeId]. Returns the id.
OF_API int of_gp_item_at(int index) {
  resetI32(5);
  if (!gpReady() || index < 0 ||
      static_cast<size_t>(index) >= g_reg->allItems().size()) return 0;
  const gp::ItemDef& d = g_reg->allItems()[static_cast<size_t>(index)];
  g_i32.push_back(static_cast<int32_t>(d.id));
  g_i32.push_back(static_cast<int32_t>(d.category));
  g_i32.push_back(static_cast<int32_t>(d.stackMax));
  g_i32.push_back(static_cast<int32_t>(d.flags));
  g_i32.push_back(static_cast<int32_t>(d.placesEntityTypeId));
  return static_cast<int>(d.id);
}
// The display name as UTF-8 bytes in the u8 scratch (NOT null terminated).
// Returns the byte length, or 0 for an unknown id.
OF_API int of_gp_item_name(int item) {
  g_u8.clear();
  if (!gpReady()) return 0;
  const gp::ItemDef* d = g_reg->item(static_cast<gp::ItemId>(item));
  if (!d) return 0;
  g_u8.assign(d->displayName.begin(), d->displayName.end());
  return static_cast<int>(g_u8.size());
}

// --- The survival node patch -------------------------------------------------
// Queue the kinds for the next layout, then lay them out as one geodesic ring
// around `dir` (worldgen::survival::LayoutTestArea). Calling layout repeatedly
// with different centres and radii builds a field; of_gp_nodes_clear resets it.
OF_API void of_gp_kinds_reset(void) { g_gpPending.clear(); }
OF_API void of_gp_kinds_push(int kind) {
  if (kind < 0 || kind > 6) return;
  g_gpPending.push_back(static_cast<uint8_t>(kind));
}
OF_API void of_gp_nodes_clear(void) { g_gpNodes.clear(); g_gpKinds.clear(); }
OF_API int of_gp_nodes_count(void) { return static_cast<int>(g_gpNodes.size()); }

// Append one ring. Returns the TOTAL node count, or -1 if the body is unknown.
OF_API int of_gp_nodes_layout(int bodyId, int editsId, double dx, double dy,
                              double dz, double ringRadiusRad) {
  const wg::BodyParams* b = g_bodies.get(bodyId);
  if (!b) return -1;
  if (g_gpPending.empty()) return static_cast<int>(g_gpNodes.size());
  std::vector<wg::survival::NodeKind> kinds;
  kinds.reserve(g_gpPending.size());
  for (uint8_t k : g_gpPending)
    kinds.push_back(static_cast<wg::survival::NodeKind>(k));
  // THE surface authority (standing rule 1). LayoutTestArea's default snap is
  // the RAW heightfield, which is an internal ingredient and not a surface.
  const wg::VoxelEdits* e = editsOrNull(editsId);
  const wg::BodyParams& body = *b;
  wg::SnapHeightFn snap = [&body, e](const Vec3& d) {
    return e ? wg::surfaceHeight(body, d, *e) : wg::surfaceHeight(body, d);
  };
  const std::vector<wg::FDepositNode> made = wg::survival::LayoutTestArea(
      body, body.bodySeed, FrameId(0), vec(dx, dy, dz), kinds, ringRadiusRad, snap);
  for (size_t i = 0; i < made.size(); ++i) {
    g_gpNodes.push_back(made[i]);
    g_gpKinds.push_back(g_gpPending[i % g_gpPending.size()]);
  }
  return static_cast<int>(g_gpNodes.size());
}

// f64 scratch [x, y, z, remaining, initial, grade, kind, resource]. Returns 8,
// or 0 for an out-of-range index. Position is body-frame metres.
OF_API int of_gp_node_state(int i) {
  resetF64(8);
  if (i < 0 || static_cast<size_t>(i) >= g_gpNodes.size()) return 0;
  const wg::FDepositNode& n = g_gpNodes[static_cast<size_t>(i)];
  const Vec3 p = n.Position.pos;
  g_f64.push_back(p.x); g_f64.push_back(p.y); g_f64.push_back(p.z);
  g_f64.push_back(n.RemainingAmount);
  g_f64.push_back(n.InitialAmount);
  g_f64.push_back(static_cast<double>(n.Grade));
  g_f64.push_back(static_cast<double>(g_gpKinds[static_cast<size_t>(i)]));
  g_f64.push_back(static_cast<double>(n.Resource));
  return 8;
}

// One hand harvest. i32 scratch [granted, usedTool, nodeEmpty, resource].
// Returns the granted count (0 when the node is empty or the pack is full).
OF_API int of_gp_node_harvest(int i, int baseYield, int toolYield) {
  resetI32(4);
  if (!gpReady() || i < 0 || static_cast<size_t>(i) >= g_gpNodes.size()) return 0;
  wg::FDepositNode& n = g_gpNodes[static_cast<size_t>(i)];
  const auto kind =
      static_cast<wg::survival::NodeKind>(g_gpKinds[static_cast<size_t>(i)]);
  const sv::HarvestResult r = sv::harvestNode(
      n, kind, *g_inv, static_cast<uint16_t>(baseYield),
      static_cast<uint16_t>(toolYield));
  g_i32.push_back(static_cast<int32_t>(r.granted));
  g_i32.push_back(r.usedTool ? 1 : 0);
  g_i32.push_back(r.nodeEmpty ? 1 : 0);
  g_i32.push_back(static_cast<int32_t>(n.Resource));
  return static_cast<int>(r.granted);
}

// --- Hand crafting -----------------------------------------------------------
OF_API int of_gp_recipe_count(void) { return static_cast<int>(g_gpRecipes.size()); }

// i32 scratch [output, outputCount, canCraft, inputCount, (item, have, need)*N].
// Returns the element count written, or 0 for an out-of-range index. `have` is
// the pack total, so the UI can grey one input without a call per input.
OF_API int of_gp_recipe_info(int i) {
  resetI32(16);
  if (!gpReady() || i < 0 || static_cast<size_t>(i) >= g_gpRecipes.size()) return 0;
  const sv::CraftRecipe& r = g_gpRecipes[static_cast<size_t>(i)];
  g_i32.push_back(static_cast<int32_t>(r.output));
  g_i32.push_back(static_cast<int32_t>(r.outputCount));
  g_i32.push_back(sv::HandCrafter::canCraft(r, *g_inv) ? 1 : 0);
  g_i32.push_back(static_cast<int32_t>(r.inputs.size()));
  for (const gp::ItemStack& in : r.inputs) {
    g_i32.push_back(static_cast<int32_t>(in.item));
    g_i32.push_back(static_cast<int32_t>(g_inv->count(in.item)));
    g_i32.push_back(static_cast<int32_t>(in.count));
  }
  return static_cast<int>(g_i32.size());
}

// All-or-nothing craft. 1 on success, 0 if the inputs are not all present.
OF_API int of_gp_craft(int i) {
  if (!gpReady() || i < 0 || static_cast<size_t>(i) >= g_gpRecipes.size()) return 0;
  return sv::HandCrafter::craft(g_gpRecipes[static_cast<size_t>(i)], *g_inv) ? 1 : 0;
}

// --- Furnaces ----------------------------------------------------------------
// tier 0 = primitive furnace (180 ticks per smelt), 1 = smelter (60).
OF_API int of_gp_furnace_create(int tier) {
  return g_furnaces.add(new sv::Furnace(
      tier == 1 ? sv::FurnaceTier::Smelter : sv::FurnaceTier::Furnace));
}
OF_API void of_gp_furnace_destroy(int f) { g_furnaces.remove(f); }

// Move `count` of `item` from the PACK into the furnace, as ore or as fuel
// depending on the item. Deducting the pack here rather than in JS is what makes
// "load the furnace" atomic: there is no window in which the units exist twice.
// Returns the number actually moved.
OF_API int of_gp_furnace_insert(int f, int item, int count) {
  sv::Furnace* fu = g_furnaces.get(f);
  if (!gpReady() || !fu || count <= 0) return 0;
  const auto id = static_cast<gp::ItemId>(item);
  const bool isOre = sv::smeltOutputFor(id) != gp::kNoItem;
  const bool isFuel = sv::fuelTicksPerUnit(id) > 0;
  if (!isOre && !isFuel) return 0;
  const uint16_t took = g_inv->remove(id, static_cast<uint16_t>(count));
  if (took == 0) return 0;
  // Ore first: no survival item is both, so the two branches cannot both claim
  // the same id (coal and wood are fuel only, the raw ores are ore only).
  const uint16_t moved = isOre ? fu->loadOre(id, took)
                               : (fu->loadFuel(id, took) ? took : 0);
  if (moved < took) g_inv->add(id, static_cast<uint16_t>(took - moved));
  return static_cast<int>(moved);
}

// Pull finished ingots out of the furnace into the pack. Returns the count moved.
OF_API int of_gp_furnace_collect(int f, int want) {
  sv::Furnace* fu = g_furnaces.get(f);
  if (!gpReady() || !fu || want <= 0) return 0;
  const gp::ItemId out = fu->outputItem();
  if (out == gp::kNoItem) return 0;
  const uint16_t took = fu->takeOutput(static_cast<uint16_t>(want));
  const uint16_t over = g_inv->add(out, took);
  return static_cast<int>(took - over);
}

// Advance the furnace. Returns the number of smelts completed in the window.
OF_API int of_gp_furnace_run(int f, int ticks) {
  sv::Furnace* fu = g_furnaces.get(f);
  if (!fu || ticks <= 0) return 0;
  return static_cast<int>(fu->run(static_cast<uint32_t>(ticks)));
}

// i32 scratch [oreItem, oreCount, outItem, outCount, fuelTicks, progress,
//              ticksPerSmelt, smelting]. Returns 8, or 0 for a dead handle.
OF_API int of_gp_furnace_state(int f) {
  resetI32(8);
  const sv::Furnace* fu = g_furnaces.get(f);
  if (!fu) return 0;
  g_i32.push_back(static_cast<int32_t>(fu->oreItem()));
  g_i32.push_back(static_cast<int32_t>(fu->oreCount()));
  g_i32.push_back(static_cast<int32_t>(fu->outputItem()));
  g_i32.push_back(static_cast<int32_t>(fu->outputCount()));
  g_i32.push_back(static_cast<int32_t>(fu->fuelTicks()));
  g_i32.push_back(static_cast<int32_t>(fu->progress()));
  g_i32.push_back(static_cast<int32_t>(fu->ticksPerSmelt()));
  g_i32.push_back(fu->smelting() ? 1 : 0);
  return 8;
}

// The survival ItemId block, so JS never hard-codes an id it could get wrong.
// i32 scratch, in this order: Wood, Stone, Coal, RawIron, RawCopper, Water, Oil,
// Iron, Copper, CrudePickaxe, CrudeAxe, PrimitiveFurnace, SurvivalSmelter.
OF_API int of_gp_item_ids(void) {
  resetI32(13);
  g_i32.push_back(sv::items::Wood);       g_i32.push_back(sv::items::Stone);
  g_i32.push_back(sv::items::Coal);       g_i32.push_back(sv::items::RawIron);
  g_i32.push_back(sv::items::RawCopper);  g_i32.push_back(sv::items::Water);
  g_i32.push_back(sv::items::Oil);        g_i32.push_back(sv::items::Iron);
  g_i32.push_back(sv::items::Copper);     g_i32.push_back(sv::items::CrudePickaxe);
  g_i32.push_back(sv::items::CrudeAxe);   g_i32.push_back(sv::items::PrimitiveFurnace);
  g_i32.push_back(sv::items::SurvivalSmelter);
  return 13;
}
