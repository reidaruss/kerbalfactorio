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
#include "of/voxel_field.h"
#include "of/surface_nets.h"
#include "of/surface_field.h"
#include "of/water_field.h"   // ABI 16: the water level, published separately
#include "of/terrain_stream.h"
#include "of/factory_sim.h"
#include "of/automation.h"
#include "of/persistence.h"   // byte serializer only — works fine in WASM
#include "of/gameplay.h"      // survival slice: inventory, harvest, craft, furnace
#include "of/progression.h"   // ABI 9: armour slots, skills, appearance
#include "of/research.h"      // ABI 9: the tech tree (includes progression.h too)

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
//   3: ORE PATCHES (deposits.h §P). New of_gp_patch_* surface (layout, state,
//       mesh, outcrops, cover, find, drill_rate, drain) plus
//       of_gp_node_add_outcrop. of_gp_node_state and of_gp_node_drain now
//       report/mutate the PATCH for a node that is one of its outcrops, so a
//       deposit has exactly one pool however many outcrops stand on it.
//   4: TERRAFORMING (WG-22). VoxelEdits gained a second sparse set, so fill is
//       representable at all: new of_edits_fill / of_edits_fill_cell /
//       of_edits_added_count / of_edits_is_added_cell, the of_level_area op, and
//       of_derived_raising / of_surface_offset / of_max_fill. The persistence
//       bytes of_edits_serialize writes are a NEW self-describing format that
//       carries both sets; of_edits_deserialize still reads the old one, so
//       existing slots load. Additive: no existing signature changed.
//   5: STRUCTURAL BUILDING SET (gameplay.h §S.6). The base-building parts
//       (foundation, floor, wall, door) as data: items 0x0040..0x0043, entity
//       TypeIds 0x40..0x43. New of_gp_structure_count / of_gp_structure_info /
//       of_gp_structure_can_afford / of_gp_structure_pay. Placement PAYS a build
//       cost rather than crafting an item, so of_gp_recipe_* is unchanged and
//       still lists exactly the four hand recipes. Additive: no existing
//       signature changed.
//   6: THE VESSEL SURFACE (vessel.h / atmosphere.h / flight.h). The part
//       catalogue as data (of_vs_part_*), the item form of a part and its build
//       cost (ItemId block 0x0050..0x006A, allocated in of_vessel_api.inc),
//       building and editing a vessel TREE (of_vs_create / _add_root / _attach /
//       _remove / _parts / _transforms), STAGING including an autostage and a
//       reorder that renumbers the parts with the rows (of_vs_autostage /
//       _stage_move), and the derived figures DW-30 item 4 makes non-negotiable
//       (of_vs_stage_performance / _total_dv_vacuum / _mass_properties / _twr).
//       Plus the atmosphere as pure functions (of_atmo_*) and a FlightSim
//       pass-through (of_fl_*) for the flight lane, landed here because an ABI
//       bump is atomic and a second one would cost more than one file.
//       Additive: no existing signature changed.
//   7-8: the flight lane's staging / atmosphere additions and lane F's
//       of_net_take_line_item, landed together rather than as two bumps.
//   9: PROGRESSION, POWER AND EQUIPMENT, all three in ONE bump because standing
//       rule 9 makes a bump atomic and three of them cost three times as much
//       and give three chances to break the client.
//       (a) RESEARCH (research.h, green in /core since June and never once
//           called from the browser): the SURVIVAL tech tree as data, the
//           gates the craft menu and the build hotbar ask (of_rs_item_available
//           / _entity_available / _recipe_available), the spend (of_rs_try),
//           the refusal AS A CODE rather than a sentence (of_rs_tech_state),
//           and DW-29's MILESTONE, a precondition that is a thing the player
//           DID rather than a thing they bought.
//       (b) POWER (power.h through automation.h, lane D's roadmap blocker D-1):
//           poles, burner generators, the electric smelting rung, the
//           per-network supply/demand statistics a panel draws, the history
//           ring it graphs, and the spanning-tree wire list a renderer needs.
//           WATTS ARE int32 AND ENERGY IS NOT: one coal unit is 4e9 mJ, so
//           of_net_generator_energy_j returns joules as a double.
//       (c) PLAYER PROGRESSION (progression.h): four equip slots, the armour
//           table with its stats and its .glb node names, the summed suit,
//           five skills and the five-byte palette-indexed appearance.
//       of_gp_init now also registers the science items and the armour items,
//       and of_gp_recipe_count therefore grows from 7 to 13. The first seven
//       indices are UNCHANGED (the list is appended to, never reordered), so
//       every existing caller and probe still names the same recipe.
//       Additive: no existing signature changed.
//   10: GP-51. ONE new export, of_gp_craft_block(i), and a BEHAVIOUR change
//       behind an unchanged signature: of_gp_craft now REFUSES a craft whose
//       output would not fit, where it used to spend the inputs, drop the
//       output and return 1. The bump is what makes the client's refusal text
//       and /core's refusal reason land together, because a client that showed
//       "crafted a furnace" against a wasm that had just eaten the wood is the
//       failure this fixes wearing a different hat.
//       Additive: no existing signature changed.
//   11: MANEUVER NODES (maneuver.h, PH-37 to PH-40) and four new SAS modes.
//       (a) of_mn_plan / of_mn_path / of_mn_orbit_meta: what a burn costs,
//           which way to point, when to light it, how long for, and the orbit
//           it produces, plus the conic itself as a polyline the map draws.
//           Pure functions of a flight handle; nothing is stored and nothing
//           is commanded, because a node is a PLAN and autopilot is gated
//           behind DW-29's research unlock.
//       (b) of_fl_set_sas now accepts 0..8 rather than 0..4. SasMode gained
//           Normal(5), Antinormal(6), RadialIn(7), RadialOut(8), APPENDED, so
//           every existing value, probe and constant still means what it did.
//           There is deliberately no Node mode: a node's direction is fixed in
//           inertial space, so Command(4) already holds it.
//       Additive: no existing signature changed. The only behaviour change is
//       that four integers of_fl_set_sas used to REFUSE are now accepted.
//   12: THE DISCOVERABLE MAP (discovery.h, WG-29 / DW-36). §18, of_disc_*.
//       What the player has SEEN of a body, as WORLD state rather than UI
//       state: one rule (a cell is discovered when the observer has been
//       somewhere it was above their horizon) read at TWO resolutions, a
//       coarse SURVEY layer that orbit fills in and a fine EXPLORE layer capped
//       at 10 km of ground chord so a lap does not hand you the ore.
//       of_disc_reset / _ensure / _configure / _clear own the field,
//       of_disc_observe feeds both layers from ONE call, of_disc_has is the
//       gate a UI or an ore
//       reveal asks, of_disc_window hands the map the discovered cells' CORNERS
//       (not centres: the projection is orthographic and a limb cell is a
//       sliver), of_disc_report publishes the counts taken inside those calls
//       including the truncation flag of_disc_window sets, and
//       of_disc_serialize / _alloc_bytes / _deserialize persist it through the
//       same three-call sequence of_edits_* uses.
//       TUNING IS DATA: of_disc_configure moves every number without touching
//       a code path, and a non-positive field means "the default for that one".
//       THE SAVE IS SELF-DESCRIBING, and that is an ordering fix rather than a
//       format preference. discovery.h's stream carries the body radius, so
//       of_disc_deserialize needs NO field to exist first and rebuilds the
//       lattices from the bytes; and of_disc_ensure resets ONLY when there is no
//       field or it is cut for another body, so a map built AFTER the save was
//       applied cannot wipe what was just restored. Without both halves a page
//       reload lost everything the player had explored and the next autosave
//       made the loss permanent (measured: restored.discovery = -1).
//       Additive: no existing signature changed and no existing value moved.
//       of_disc_ensure is new; the discovery format changed, and it may, because
//       12 is not landed and nothing has ever shipped a save written with it.
//  13: THE MAP DRAWS THE WORLD (DW-37). One new export, §19's of_map_sample:
//       the biome, the designed height and the SURVEY bit over a view region —
//       a centre, two in-plane axes, a span, an aspect and a grid density — so
//       the map can paint ground instead of an empty plane. Specified in
//       view-region rather than pixel terms because DW-37 turns the map into a
//       rotatable 3D camera next and a camera asks the same question. Every
//       height is sampleDesignedHeight and every biome is biomeAt (standing
//       rule 1): this adds a CONSUMER of the surface oracle, never a second
//       definition of it. Additive: no existing signature changed and no
//       existing value moved. of_disc_window is untouched and still exported;
//       it is simply no longer the map's shading source, because a per-sample
//       survey bit is a finer and simpler mask than a 9,375 m quad.
//  14: THE MAP SAMPLES THE EDITED SURFACE, NOT THE DESIGNED BASE (WG-33).
//       §19's of_map_sample gains an `edits` parameter in second position and
//       reads surface_field.h's `surfaceHeight` rather than biome.h's
//       `sampleDesignedHeight`. BREAKING on that ONE signature, which is a day
//       old and has exactly one caller (web/src/world/MapTerrain.ts). Every
//       other export is untouched. It is a real defect and not a refinement:
//       the designed base is by definition the world BEFORE the player touched
//       it, so a dug hole, a levelled pad and a tunnel mouth could not reach the
//       map however the painter shaded them, and the close-in map's whole job is
//       to show you your own work. With `edits <= 0` the value is bit-identical
//       to ABI 13's, by surface_field.h's own undug overload.
//  15: THE ENEMY LOOP CROSSES THE BRIDGE (enemies.h, GP-85). §20 adds the
//       of_en_* surface: emitters in, the pollution field spreads and decays,
//       nests absorb and attribute, evolution rises from three separately
//       accounted inputs, and AttackWaves come out with an origin, a target and
//       a roster. PURELY ADDITIVE: not one existing export changed name,
//       signature or scratch layout, so every ABI 14 caller is unaffected and
//       the bump exists only so the handshake can say the new surface is there.
//       The line of the seam is enemies.h's own: it does not own pathfinding,
//       movement, combat resolution or anything rendered, so the client spawns,
//       paths, draws and kills the individual creatures and reports kills back
//       through of_en_damage_nest. The catalogue's health/damagePerSecond/
//       speedMps/reachM cross through of_en_type so the CLIENT never authors an
//       enemy's numbers.
//  16: THE WATER LEVEL CROSSES THE BRIDGE (water_field.h, WG-36). §3b adds the
//       of_water_* surface. PURELY ADDITIVE: not one existing export changed
//       name, signature or scratch layout.
//       The bump is nonetheless load-bearing rather than cosmetic, because the
//       BASIN that the water stands in is a change to sampleDesignedHeight, and
//       sampleDesignedHeight is what of_base_height / of_surface_height /
//       of_surface_radius / of_solid_at and every streamed chunk return. A
//       client running the old wasm against the new terrain would mesh a pond
//       nothing collided with; the handshake refusing to start is the point.
//       Note what is NOT here: there is no "of_surface_water" and no flag on
//       any existing surface call. Water is asked for by name or not at all
//       (DW-26), so no caller can receive a water height while believing it
//       asked for the ground.
OF_API int of_abi_version(void) { return 16; }

// Defined in of_research_api.inc at the foot of this file. Forward-declared so
// of_gp_init can bring the research layer up in the same call that builds the
// pack: a client that has an inventory but no tech tree is a client whose gates
// all silently answer "yes", which is the exact failure this ABI closes.
extern "C" int of_rs_init(void);

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
// §2 — The terrain edit field (voxel_field.h DensityField). WG-24.
//
// Was a pair of sparse CELL-id sets carrying one occupancy bit each. It is now a
// sparse SIGNED DISTANCE per lattice corner, so a dig is a sphere and a levelled
// pad is a plane rather than the lattice's best staircase approximation of one.
// The handle type and every entry point's NAME survive; four signatures gained a
// bodyId, because a question that used to be answerable from a cell id alone (is
// this cell removed) is now DERIVED from the field against the procedural
// surface, which needs the body. That is what the ABI 7 bump is.
//
// A brush of half a cell diagonal is the smallest one that takes all eight of a
// cell's corners negative, so it is what a single-cell carve means on a field.
namespace { constexpr double kCellBrushM = 0.95; }
// =============================================================================
namespace { Registry<wg::DensityField> g_edits; }

OF_API int of_edits_create(void) { return g_edits.add(new wg::DensityField()); }
OF_API void of_edits_destroy(int e) { g_edits.remove(e); }

// dig(): remove every currently-solid cell within radiusM of a body-frame point.
// Returns the count of cells newly carved (drives harvest yield).
OF_API int of_edits_dig(int editsId, int bodyId, double x, double y, double z,
                        double radiusM) {
  wg::DensityField* e = g_edits.get(editsId);
  const wg::BodyParams* b = g_bodies.get(bodyId);
  if (!e || !b) return -1;
  return e->digSphere(*b, vec(x, y, z), radiusM);
}
// Carve exactly one cell (tests and precise tools). Returns the number of cells
// whose solidity flipped, which at this brush radius is 1 when the cell was rock
// and 0 when it was already air.
OF_API int of_edits_dig_cell(int editsId, int bodyId,
                             int32_t cx, int32_t cy, int32_t cz) {
  wg::DensityField* e = g_edits.get(editsId);
  const wg::BodyParams* b = g_bodies.get(bodyId);
  if (!e || !b) return -1;
  return e->digSphere(*b, wg::cellCenter(wg::VoxelCell{cx, cy, cz}), kCellBrushM);
}
// Carve the cell containing a body-frame position.
OF_API int of_edits_dig_cell_at(int editsId, int bodyId,
                                double x, double y, double z) {
  wg::DensityField* e = g_edits.get(editsId);
  const wg::BodyParams* b = g_bodies.get(bodyId);
  if (!e || !b) return -1;
  return e->digSphere(*b, wg::cellCenter(wg::cellForPos(vec(x, y, z))), kCellBrushM);
}
// fill(): the mirror of dig(). Make every currently-AIR cell within radiusM
// solid. Returns the count of cells placed (drives the material cost). WG-22.
OF_API int of_edits_fill(int editsId, int bodyId, double x, double y, double z,
                         double radiusM) {
  wg::DensityField* e = g_edits.get(editsId);
  const wg::BodyParams* b = g_bodies.get(bodyId);
  if (!e || !b) return -1;
  return e->fillSphere(*b, vec(x, y, z), radiusM);
}
// Place exactly one cell. 1 if the cell changed from air to solid.
OF_API int of_edits_fill_cell(int editsId, int bodyId,
                              int32_t cx, int32_t cy, int32_t cz) {
  wg::DensityField* e = g_edits.get(editsId);
  const wg::BodyParams* b = g_bodies.get(bodyId);
  if (!e || !b) return -1;
  return e->fillSphere(*b, wg::cellCenter(wg::VoxelCell{cx, cy, cz}), kCellBrushM);
}
// The two counts are now overrides pushing toward AIR and toward ROCK. They are
// no longer cell counts and are not comparable to a pre-ABI-7 number; the client
// uses them only to notice that the edit set moved by a route that was not an op
// (VoxelWorld.driftedFromCore), for which any monotone pair serves.
OF_API int of_edits_removed_count(int editsId) {
  wg::DensityField* e = g_edits.get(editsId);
  return e ? static_cast<int>(e->airCount()) : -1;
}
OF_API int of_edits_added_count(int editsId) {
  wg::DensityField* e = g_edits.get(editsId);
  return e ? static_cast<int>(e->rockCount()) : -1;
}
// Added and removed are DERIVED now: a cell is added when it is solid and
// procedurally was not, removed when it is air and procedurally was rock. Both
// therefore need the body, which is the other half of the ABI 7 signature change.
OF_API int of_edits_is_added_cell(int editsId, int bodyId,
                                  int32_t cx, int32_t cy, int32_t cz) {
  wg::DensityField* e = g_edits.get(editsId);
  const wg::BodyParams* b = g_bodies.get(bodyId);
  if (!e || !b) return -1;
  const wg::VoxelCell c{cx, cy, cz};
  return (!wg::isProcSolid(*b, c) && e->solidCell(*b, c)) ? 1 : 0;
}
OF_API int of_edits_is_removed_cell(int editsId, int bodyId,
                                    int32_t cx, int32_t cy, int32_t cz) {
  wg::DensityField* e = g_edits.get(editsId);
  const wg::BodyParams* b = g_bodies.get(bodyId);
  if (!e || !b) return -1;
  const wg::VoxelCell c{cx, cy, cz};
  return (wg::isProcSolid(*b, c) && !e->solidCell(*b, c)) ? 1 : 0;
}
// Dirty AABB since the last clear. Fills i32 scratch with 6 ints
// [minX,minY,minZ,maxX,maxY,maxZ]; returns 1 if valid, 0 if nothing touched.
OF_API int of_edits_dirty_region(int editsId) {
  wg::DensityField* e = g_edits.get(editsId);
  resetI32(6);
  if (!e) return -1;
  wg::DensityField::CellAABB r = e->dirtyRegion();
  if (!r.valid) return 0;
  g_i32.push_back(r.min.cx); g_i32.push_back(r.min.cy); g_i32.push_back(r.min.cz);
  g_i32.push_back(r.max.cx); g_i32.push_back(r.max.cy); g_i32.push_back(r.max.cz);
  return 1;
}
OF_API void of_edits_clear_dirty(int editsId) {
  wg::DensityField* e = g_edits.get(editsId);
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

// surfaceNets(): the TRIANGLES of the field's zero level. Replaces
// of_exposed_faces, which answered in cube faces and is gone at ABI 7, a cube
// face being exactly the thing the user called sharp edges that are not clean.
//
// Returns the VERTEX count and fills BOTH scratch buffers in one call:
//   f32 scratch, stride 6: [px, py, pz, nx, ny, nz] per vertex, position in
//                          metres RELATIVE to the anchor cell corner (standing
//                          rule 6: never absolute planet-scale floats).
//   i32 scratch:           the triangle index list; read its length from
//                          of_surface_nets_index_count() after this call.
// Copy both out before the next call into WASM (standing rule 5).
//
// editedOnly=1 emits only cells near a corner the player has actually changed,
// because this mesh SUPPLEMENTS the streamed heightfield rather than replacing it
// (ARCHITECTURE 15.2 item 108). 0 meshes the whole region, which is what a probe
// or a test wants.
namespace { int g_snIndexCount = 0; }

OF_API int of_surface_nets(int bodyId, int editsId, double x, double y, double z,
                           double radiusM, int32_t anchorCx, int32_t anchorCy,
                           int32_t anchorCz, int editedOnly) {
  const wg::BodyParams* b = g_bodies.get(bodyId);
  wg::DensityField* e = g_edits.get(editsId);
  resetF32(1024);
  resetI32(1024);
  g_snIndexCount = 0;
  if (!b) return -1;
  static const wg::DensityField kEmpty;
  const wg::DensityField& ed = e ? *e : kEmpty;
  wg::SurfaceNetsOpts o;
  o.editedOnly = editedOnly != 0;
  const wg::SurfaceNetsMesh m =
      wg::surfaceNetsAround(*b, ed, vec(x, y, z), radiusM, o);
  const Vec3 anchor = wg::cornerPos(wg::VoxelCell{anchorCx, anchorCy, anchorCz});
  g_f32.reserve(m.positions.size() * 6);
  for (size_t i = 0; i < m.positions.size(); ++i) {
    g_f32.push_back(static_cast<float>(m.positions[i].x - anchor.x));
    g_f32.push_back(static_cast<float>(m.positions[i].y - anchor.y));
    g_f32.push_back(static_cast<float>(m.positions[i].z - anchor.z));
    g_f32.push_back(static_cast<float>(m.normals[i].x));
    g_f32.push_back(static_cast<float>(m.normals[i].y));
    g_f32.push_back(static_cast<float>(m.normals[i].z));
  }
  g_i32.reserve(m.indices.size());
  for (uint32_t idx : m.indices) g_i32.push_back(static_cast<int32_t>(idx));
  g_snIndexCount = static_cast<int>(m.indices.size());
  return static_cast<int>(m.positions.size());
}
OF_API int of_surface_nets_index_count(void) { return g_snIndexCount; }

// The per-BRICK form the client actually meshes with, so it can cache a brick and
// rebuild only what a dig touched. The tiling rule (grow the region one cell on
// the low side, emit only the edges this brick owns) lives in surface_nets.h, not
// here and not in the client, because it is the kind of off-by-one that draws a
// seam or a doubled triangle and it should be stated once.
OF_API int of_surface_nets_brick(int bodyId, int editsId, int32_t bx, int32_t by,
                                 int32_t bz, int32_t brick, int32_t anchorCx,
                                 int32_t anchorCy, int32_t anchorCz,
                                 int editedOnly) {
  const wg::BodyParams* b = g_bodies.get(bodyId);
  wg::DensityField* e = g_edits.get(editsId);
  resetF32(1024);
  resetI32(1024);
  g_snIndexCount = 0;
  if (!b) return -1;
  static const wg::DensityField kEmpty;
  const wg::DensityField& ed = e ? *e : kEmpty;
  wg::SurfaceNetsOpts o;
  o.editedOnly = editedOnly != 0;
  const wg::SurfaceNetsMesh m =
      wg::surfaceNetsBrick(*b, ed, bx, by, bz, brick, o);
  const Vec3 anchor = wg::cornerPos(wg::VoxelCell{anchorCx, anchorCy, anchorCz});
  g_f32.reserve(m.positions.size() * 6);
  for (size_t i = 0; i < m.positions.size(); ++i) {
    g_f32.push_back(static_cast<float>(m.positions[i].x - anchor.x));
    g_f32.push_back(static_cast<float>(m.positions[i].y - anchor.y));
    g_f32.push_back(static_cast<float>(m.positions[i].z - anchor.z));
    g_f32.push_back(static_cast<float>(m.normals[i].x));
    g_f32.push_back(static_cast<float>(m.normals[i].y));
    g_f32.push_back(static_cast<float>(m.normals[i].z));
  }
  g_i32.reserve(m.indices.size());
  for (uint32_t idx : m.indices) g_i32.push_back(static_cast<int32_t>(idx));
  g_snIndexCount = static_cast<int>(m.indices.size());
  return static_cast<int>(m.positions.size());
}

// --- persistence (persistence.h byte cursors, no filesystem) ------------------
// Serialize the removed-cell diff to bytes in the u8 scratch. Returns byte count.
// JS persists these to IndexedDB / OPFS.
OF_API int of_edits_serialize(int editsId) {
  wg::DensityField* e = g_edits.get(editsId);
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
  wg::DensityField* e = g_edits.get(editsId);
  if (!e) return -1;
  of::persist::SaveReader r(g_u8);
  if (!e->deserialize(r)) return -1;   // not a density-field stream
  return static_cast<int>(e->overrideCount());
}

// =============================================================================
// §3 — The SURFACE ORACLE (surface_field.h). The single surface authority.
// `editsId <= 0` means "no digs" (the pure designed base).
// =============================================================================
namespace {
const wg::DensityField* editsOrNull(int id) { return g_edits.get(id); }
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
  const wg::DensityField* e = editsOrNull(editsId);
  return e ? wg::surfaceHeight(*b, vec(dx, dy, dz), *e)
           : wg::surfaceHeight(*b, vec(dx, dy, dz));
}
OF_API double of_surface_radius(int bodyId, int editsId,
                                double dx, double dy, double dz) {
  const wg::BodyParams* b = g_bodies.get(bodyId);
  if (!b) return NAN;
  const wg::DensityField* e = editsOrNull(editsId);
  return e ? wg::surfaceRadius(*b, vec(dx, dy, dz), *e)
           : b->radiusM + wg::baseHeight(*b, vec(dx, dy, dz));
}
OF_API double of_derived_lowering(int bodyId, int editsId,
                                  double dx, double dy, double dz) {
  const wg::BodyParams* b = g_bodies.get(bodyId);
  if (!b) return NAN;
  const wg::DensityField* e = editsOrNull(editsId);
  return e ? wg::derivedLoweringAt(*b, vec(dx, dy, dz), *e) : 0.0;
}
OF_API double of_max_dig_depth(void) { return wg::kSurfaceMaxDigDepthM; }

// =============================================================================
// §3b: THE WATER LEVEL (water_field.h, ABI 16). A SEPARATE surface, on purpose.
//
// Everything above this comment answers "where is the ground". Everything below
// it answers "where is the water". They are different questions with different
// answers and they are never mixed: no export in §3 gained a water flag, and no
// export here returns a ground height. That separation is DW-26 applied to the
// third surface, and it is the whole reason this is its own section rather than
// four more functions in the one above.
//
// `of_water_no_value()` hands JS the EXACT sentinel bits rather than making the
// client transcribe -1e30. A transcribed constant that drifts by one digit is a
// comparison that silently always takes one branch.
// =============================================================================
OF_API double of_water_no_value(void) { return wg::water::kNoWater; }

/** The body's ONE water level, metres above the datum, or kNoWater. */
OF_API double of_water_level(int bodyId) {
  const wg::BodyParams* b = g_bodies.get(bodyId);
  if (!b) return NAN;
  return wg::water::levelM(*b);
}

/** The water surface height under a direction, or kNoWater for a dry column. */
OF_API double of_water_level_at(int bodyId, double dx, double dy, double dz) {
  const wg::BodyParams* b = g_bodies.get(bodyId);
  if (!b) return NAN;
  return wg::water::levelAt(*b, vec(dx, dy, dz));
}

/** Metres of water standing over the EDITED ground under a direction; 0 if dry. */
OF_API double of_water_depth_at(int bodyId, int editsId,
                                double dx, double dy, double dz) {
  const wg::BodyParams* b = g_bodies.get(bodyId);
  if (!b) return NAN;
  const wg::DensityField* e = editsOrNull(editsId);
  return e ? wg::water::depthAt(*b, vec(dx, dy, dz), *e)
           : wg::water::depthAt(*b, vec(dx, dy, dz));
}

/**
 * How far a body-frame POINT sits below the water surface, metres. Negative
 * above it, a large negative where there is no water. This is the character
 * controller's one question and it takes no ground argument at all.
 */
OF_API double of_water_submersion(int bodyId, double x, double y, double z) {
  const wg::BodyParams* b = g_bodies.get(bodyId);
  if (!b) return NAN;
  return wg::water::submersionM(*b, vec(x, y, z));
}

/**
 * The pond's geometry, for whoever has to draw its surface. f64 scratch, 7:
 *   [0..2] pondDir (unit, body frame)
 *   [3]    shorelineM   - radius where the water meets the ground
 *   [4]    basinRadiusM - radius where the BASIN meets the surrounding ground
 *   [5]    levelM       - the water surface height above the datum
 *   [6]    maxDepthM    - deepest water, at the centre
 * Returns the element count, or 0 if this body has no pond.
 *
 * Both radii cross, and the caller is expected to care about the difference:
 * between them is dry beach INSIDE the bowl. A surface drawn out to
 * basinRadiusM would be a disc of water climbing the bank, which is precisely
 * the "sitting on the surface" read this whole change exists to remove.
 */
OF_API int of_water_disc(int bodyId) {
  const wg::BodyParams* b = g_bodies.get(bodyId);
  resetF64(7);
  if (!b || !wg::water::hasPond(*b)) return 0;
  g_f64.push_back(b->pondDir.x);
  g_f64.push_back(b->pondDir.y);
  g_f64.push_back(b->pondDir.z);
  g_f64.push_back(wg::water::shorelineM(*b));
  g_f64.push_back(b->pondRadiusM);
  g_f64.push_back(wg::water::levelM(*b));
  g_f64.push_back(wg::water::maxDepthM(*b));
  return 7;
}

// WG-22 the terraforming half of the oracle.
OF_API double of_derived_raising(int bodyId, int editsId,
                                 double dx, double dy, double dz) {
  const wg::BodyParams* b = g_bodies.get(bodyId);
  if (!b) return NAN;
  const wg::DensityField* e = editsOrNull(editsId);
  return e ? wg::derivedRaisingAt(*b, vec(dx, dy, dz), *e) : 0.0;
}
// The SIGNED metres the edited surface sits BELOW the designed base (negative =
// the ground came up). Exactly of_base_height - of_surface_height.
OF_API double of_surface_offset(int bodyId, int editsId,
                                double dx, double dy, double dz) {
  const wg::BodyParams* b = g_bodies.get(bodyId);
  if (!b) return NAN;
  const wg::DensityField* e = editsOrNull(editsId);
  return e ? wg::surfaceOffsetAt(*b, vec(dx, dy, dz), *e) : 0.0;
}
OF_API double of_max_fill(void) { return wg::kSurfaceMaxFillM; }

// THE LEVELLING OP (surface_field.h levelArea). Inside a cylinder of radiusM
// about the aim point, aligned with the local up, every cell above
// `targetHeightM` becomes air and every cell below it becomes solid.
//
// The rule lives in /core, not here and not in the browser: it is a statement
// about what the surface IS, and standing rule 1 says there is one author of
// those. This shim only unpacks the result.
//
// Returns the total cells changed (dug + filled), or -1 for a bad handle.
// i32 scratch holds 3 ints: [dug, filled, scanned].
OF_API int of_level_area(int editsId, int bodyId, double x, double y, double z,
                         double radiusM, double targetHeightM,
                         double maxCutM, double maxFillM) {
  wg::DensityField* e = g_edits.get(editsId);
  const wg::BodyParams* b = g_bodies.get(bodyId);
  resetI32(4);
  if (!e || !b) return -1;
  const wg::LevelResult r = wg::levelArea(
      *b, *e, vec(x, y, z), radiusM, targetHeightM,
      maxCutM > 0.0 ? maxCutM : wg::kSurfaceMaxFillM,
      maxFillM > 0.0 ? maxFillM : wg::kSurfaceMaxFillM);
  g_i32.push_back(r.dug);
  g_i32.push_back(r.filled);
  g_i32.push_back(r.scanned);
  g_i32.push_back(r.corners);
  // ABI 8 RETURNS CORNERS, not cells, and the distinction is the whole reason
  // for the bump. On a signed field, shaving 40 cm off a slope moves the surface
  // under the entire disc without carrying one cell CENTRE across the zero level,
  // so `cells()` is legitimately 0 for an op that did real work. The client gates
  // its re-mesh on this number; returning cells made a working tool draw nothing
  // and read as a dead key, which is WG-23's complaint with a new cause.
  return r.corners;
}

// Voxel solidity through the oracle (designed base XOR removed).
OF_API int of_solid_at(int bodyId, int editsId, double x, double y, double z) {
  const wg::BodyParams* b = g_bodies.get(bodyId);
  if (!b) return -1;
  const wg::DensityField* e = editsOrNull(editsId);
  if (e) return wg::solidAt(*b, vec(x, y, z), *e) ? 1 : 0;
  return wg::isProcSolid(*b, wg::cellForPos(vec(x, y, z))) ? 1 : 0;
}
OF_API int of_solid_cell(int bodyId, int editsId,
                         int32_t cx, int32_t cy, int32_t cz) {
  const wg::BodyParams* b = g_bodies.get(bodyId);
  if (!b) return -1;
  const wg::VoxelCell c{cx, cy, cz};
  const wg::DensityField* e = editsOrNull(editsId);
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
  const wg::DensityField* e = editsOrNull(editsId);
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
  const wg::DensityField* e = editsOrNull(editsId);
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
namespace {
// Rebuild every resident chunk whose quad could contain a column the edit
// touched, and publish them through `last.ready`. Distance is measured centre to
// centre against the chunk's own radius, so a coarse far chunk that merely
// happens to face the edit is not re-meshed. Shared by dig and level (WG-22).
int rebuildQuadsNear(StreamerRec& r, const Vec3& p, double reachM) {
  std::vector<wg::FQuadKey> hits;
  for (const auto& kv : r.s->resident()) {
    const wg::FQuadKey& k = kv.second.key;
    const Vec3 c = kv.second.centerUniverse.pos;
    const double reach = kv.second.chunkRadiusM + reachM + wg::kVoxelSizeM;
    if ((c - p).lengthSq() <= reach * reach) hits.push_back(k);
  }
  r.last.ready.clear();
  for (const wg::FQuadKey& k : hits) {
    const wg::TerrainChunk* ch = r.s->rebuildChunk(k);
    if (ch) r.last.ready.push_back(*ch);
  }
  return static_cast<int>(r.last.ready.size());
}
}  // namespace

OF_API int of_streamer_dig(int sId, double x, double y, double z, double radiusM) {
  StreamerRec* r = g_streamers.get(sId);
  if (!r) return -1;
  wg::DensityField* e = g_edits.get(r->editsId);
  if (!e) return -1;
  const int removed = e->digSphere(r->body, vec(x, y, z), radiusM);
  if (removed <= 0) { r->last.ready.clear(); return 0; }
  return rebuildQuadsNear(*r, vec(x, y, z), radiusM);
}

// WG-22 the same reconciliation for a LEVEL op. Apply levelArea to the
// streamer's OWN edit set and re-mesh every resident chunk it can have touched.
// It shares `rebuildQuadsNear` with the dig path deliberately: the chunks a
// terrain edit invalidates are a function of WHERE it happened and how wide it
// was, not of which verb did it, and a second copy of that rule is a second
// authority waiting to disagree.
//
// Returns the number of chunks re-meshed, or -1 for a bad handle.
OF_API int of_streamer_level(int sId, double x, double y, double z,
                             double radiusM, double targetHeightM,
                             double maxCutM, double maxFillM) {
  StreamerRec* r = g_streamers.get(sId);
  if (!r) return -1;
  wg::DensityField* e = g_edits.get(r->editsId);
  if (!e) return -1;
  const wg::LevelResult res = wg::levelArea(
      r->body, *e, vec(x, y, z), radiusM, targetHeightM,
      maxCutM > 0.0 ? maxCutM : wg::kSurfaceMaxFillM,
      maxFillM > 0.0 ? maxFillM : wg::kSurfaceMaxFillM);
  // CORNERS, not cells, for exactly the reason `of_level_area` returns corners
  // (ABI 8). WG-27 fixed the main-thread path and left this one, so half the
  // engine still believed a level op that moved no cell CENTRE had done nothing:
  // the near voxel mesh rebuilt from the client's dirty box while the STREAMED
  // chunk under the same pad kept the hill. That is the drawn-versus-collided
  // disagreement DW-26 exists to bound, arriving through the back door of an
  // early-out. It is not an edge case: shaving 40 cm off a slope moves the
  // surface under the whole disc without carrying one cell centre across zero,
  // and a held key does exactly that on every application after the first.
  if (res.corners <= 0) { r->last.ready.clear(); return 0; }
  // The touched volume is the cylinder, so its bounding sphere is the reach.
  const double band = (maxCutM > 0.0 ? maxCutM : wg::kSurfaceMaxFillM)
                    + (maxFillM > 0.0 ? maxFillM : wg::kSurfaceMaxFillM);
  return rebuildQuadsNear(*r, vec(x, y, z),
                          std::sqrt(radiusM * radiusM + band * band));
}

// Load the streamer's OWN edit set from bytes previously written into the u8
// scratch, then re-mesh every resident chunk within `radiusM` of (x,y,z).
//
// WHY THIS EXISTS. The worker learns about terrain edits by replaying an op log
// (DW-16), which works while the main thread is the only thing that mutates the
// edit set. A SAVE RESTORE is not that: it replaces the whole set from bytes, and
// an op log replayed on top of it is at best redundant and at worst a different
// edit (a levelling op replayed as a dig is a 13 m sphere carved out of a build
// pad). Reconciling the worker against the AUTHORITY, rather than against a
// history of how the authority got there, is the same argument standing rule 1
// makes about surfaces, applied to the copy.
//
// Returns the number of chunks re-meshed, or -1 for a bad handle.
OF_API int of_streamer_load_edits(int sId, double x, double y, double z,
                                  double radiusM) {
  StreamerRec* r = g_streamers.get(sId);
  if (!r) return -1;
  wg::DensityField* e = g_edits.get(r->editsId);
  if (!e) return -1;
  of::persist::SaveReader rd(g_u8);
  e->deserialize(rd);
  return rebuildQuadsNear(*r, vec(x, y, z), radiusM);
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
  const wg::DensityField* e = editsOrNull(editsId);
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
// Place a miner on a worldgen survival NODE KIND, letting deposits.h map the
// kind to the mined ItemId (automation.h placeMinerForNode). The build layer
// holds a node's kind, never an item id, so this is the call it wants: pass the
// kind and the units left in the node and /core decides what comes out.
OF_API int of_net_place_miner_for_node(int nId, int kind, double depositAmount,
                                       double ratePerSecond, int outCap) {
  NetRec* r = g_nets.get(nId);
  if (!r || kind < 0 || kind > 6) return -1;
  r->builds.push_back(r->net->placeMinerForNode(
      static_cast<wg::survival::NodeKind>(kind),
      static_cast<uint64_t>(depositAmount), ratePerSecond,
      static_cast<uint16_t>(outCap)));
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

// Take up to `want` units out of a building's output buffer by hand. Returns the
// count actually removed (automation.h takeOutput). This is how the last machine
// in a line gets emptied: nothing downstream drains it, so without a collection
// verb the ingots accumulate where no player can reach them.
OF_API int of_net_take_output(int nId, int build, int want) {
  NetRec* r = g_nets.get(nId); if (!r || want <= 0) return 0;
  au::BuildId* b = r->build(build); if (!b) return 0;
  return static_cast<int>(r->net->takeOutput(*b, static_cast<uint16_t>(want)));
}

// Stamp §6 render metadata on a building: TypeId (which mesh set), position, and
// bound radius in centimetres. WITHOUT THIS EVERY ROW STREAMS AT THE ORIGIN,
// because FactorySim defaults the position to (0,0,0) and never derives one.
//
// POSITION IS LOCAL METRES, not planet-scale (standing rule 6). The stream field
// is float32; at Forge's 600 km radius an absolute f32 quantizes to ~64 mm, so
// the JS build layer keeps the 64-bit anchor and passes offsets from it. Passing
// an absolute body-frame metre here would reproduce the floating-machine bug.
OF_API void of_net_set_placement(int nId, int build, int typeId,
                                 double x, double y, double z, int boundCm) {
  NetRec* r = g_nets.get(nId); if (!r) return;
  au::BuildId* b = r->build(build); if (!b) return;
  r->net->setPlacement(*b, static_cast<uint16_t>(typeId),
                       static_cast<float>(x), static_cast<float>(y),
                       static_cast<float>(z),
                       static_cast<uint16_t>(boundCm <= 0 ? 100 : boundCm));
}

// The dense entity index behind a build handle — the key EmitEntityStates writes
// as FFactoryEntityState::Id and EmitBeltFlowStates as LineId. -1 if unknown.
OF_API int of_net_entity_index(int nId, int build) {
  NetRec* r = g_nets.get(nId); if (!r) return -1;
  au::BuildId* b = r->build(build); if (!b || !b->valid()) return -1;
  return static_cast<int>(r->net->entityIndex(*b));
}
OF_API int of_net_build_count(int nId) {
  NetRec* r = g_nets.get(nId);
  return r ? static_cast<int>(r->builds.size()) : -1;
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

// FS-28. Take ONE discrete item off a belt by hand, nearest to `unitOffset`
// (units from the line head, the same coordinate `of_net_get_line_items`
// reports) and within `toleranceUnits`. Returns the ItemId taken, or 0 for
// kNoItem when nothing was in range.
//
// It is the belt half of `of_net_take_output`'s argument, and it exists for the
// same reason: nothing else drains a belt whose head feeds nowhere, so without a
// collection verb the ore rides to the end and stops where no player can reach
// it. Reid asked for it in one clause, "i should be able to pick up that stuff
// off the belts", which is exactly what makes visible cargo a mechanic rather
// than a decal.
//
// The NEAREST-item rule rather than pop-the-head is what makes it a world verb:
// the player aims at a tile and takes what is on THAT tile, so which item they
// get is a consequence of where they were looking. /core resolves ties toward
// the head so two clients pointing at the same midpoint agree.
OF_API int of_net_take_line_item(int nId, int build, int unitOffset,
                                 int toleranceUnits) {
  NetRec* r = g_nets.get(nId); if (!r || unitOffset < 0) return 0;
  au::BuildId* b = r->build(build); if (!b || !b->valid()) return 0;
  return static_cast<int>(r->net->sim().TakeLineItemNear(
      b->entity.index, static_cast<uint32_t>(unitOffset),
      static_cast<uint32_t>(toleranceUnits < 0 ? 0 : toleranceUnits)));
}

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

// The ORE PATCHES (deposits.h §P) and, for each node, which patch it is an
// outcrop OF (-1 = a standalone node such as a tree). A linked node holds no ore
// of its own: its state is re-derived from the patch on every read, which is the
// whole reason the link is an index here and not a copied number.
std::vector<wg::patches::OrePatch> g_gpPatches;
std::vector<int32_t> g_gpNodePatch;

std::vector<sv::CraftRecipe> g_gpRecipes;

// The base-building structural set (gameplay.h §S.6). Pure content with no
// dependency on the registry or the inventory, so it is materialised once on
// first use rather than in of_gp_init: the build menu can be populated before a
// world exists, and there is still exactly one copy of the data.
const std::vector<sv::StructureDef>& gpStructures() {
  static const std::vector<sv::StructureDef> s = sv::structureDefs();
  return s;
}
const sv::StructureDef* gpStructure(int i) {
  const std::vector<sv::StructureDef>& s = gpStructures();
  if (i < 0 || static_cast<size_t>(i) >= s.size()) return nullptr;
  return &s[static_cast<size_t>(i)];
}

Registry<sv::Furnace> g_furnaces;

bool gpReady() { return g_reg && g_inv; }

// The patch a node is an outcrop of, or null.
wg::patches::OrePatch* patchOfNode(int i) {
  if (i < 0 || static_cast<size_t>(i) >= g_gpNodePatch.size()) return nullptr;
  const int p = g_gpNodePatch[static_cast<size_t>(i)];
  if (p < 0 || static_cast<size_t>(p) >= g_gpPatches.size()) return nullptr;
  return &g_gpPatches[static_cast<size_t>(p)];
}

// Re-derive a linked node's pool from its patch. Called before every read and
// before every harvest, so the node never carries a number of its own.
void syncNodeToPatch(int i) {
  wg::patches::OrePatch* p = patchOfNode(i);
  if (!p) return;
  wg::FDepositNode& n = g_gpNodes[static_cast<size_t>(i)];
  n.Resource = p->Resource;
  n.InitialAmount = p->InitialAmount;
  n.RemainingAmount = p->RemainingAmount;
}
}  // namespace

// Build the registry + inventory. Idempotent; returns 1 when ready, 0 on failure.
OF_API int of_gp_init(void) {
  if (gpReady()) return 1;
  g_reg.reset(new gp::SliceRegistry());
  if (!sv::RegisterSurvivalContent(*g_reg)) { g_reg.reset(); return 0; }
  // ABI 9. The science packs and the four armour pieces join the SAME item
  // registry through the same additive extension point the survival content
  // uses, so they stack, serialise and draw exactly like a plank does. Both
  // calls are idempotent.
  gp::RegisterScienceItems(*g_reg);
  gp::progression::RegisterArmour(*g_reg);
  g_inv.reset(new gp::Inventory(*g_reg));
  // APPENDED, NEVER REORDERED. The four survival recipes and the three power
  // buildables keep indices 0..6, so every existing caller and every probe that
  // names a recipe by index still names the same one. Science first because it
  // is ungated and armour second because it is not.
  g_gpRecipes = sv::handRecipes();
  for (const sv::CraftRecipe& r : gp::scienceHandRecipes()) g_gpRecipes.push_back(r);
  for (const sv::CraftRecipe& r : gp::progression::armourRecipes())
    g_gpRecipes.push_back(r);
  // The tech tree comes up WITH the pack, not after it. A client holding an
  // inventory and no ResearchState is a client whose every gate silently
  // answers "yes", which is indistinguishable from having no gates at all.
  of_rs_init();
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

// --- the pack, as persistence.h bytes (DW-17) --------------------------------
// The CONTAINER is JS's, because persistence_file.h needs a filesystem the
// browser does not have. The BYTES are persistence.h's, written with the same
// SaveWriter the native suites read, so the save format keeps exactly one
// author and a JS-side encoder can never drift from it.
//
// Slots are written in order INCLUDING the empty ones, because slot order is
// player-visible state: a pack restored with everything shuffled to the front
// is not the pack that was saved.
OF_API int of_gp_inventory_serialize(void) {
  g_u8.clear();
  if (!gpReady()) return -1;
  of::persist::SaveWriter w;
  const int n = g_inv->slotCount();
  w.varint(static_cast<uint64_t>(n));
  for (int i = 0; i < n; ++i) {
    const gp::ItemStack& s = g_inv->slot(i);
    w.varint(static_cast<uint64_t>(s.item));
    w.varint(static_cast<uint64_t>(s.count));
  }
  g_u8 = w.bytes();
  return static_cast<int>(g_u8.size());
}

// Load a pack from `n` bytes previously written into the u8 scratch (JS: call
// of_gp_bytes_alloc(n), copy into HEAPU8 at of_scratch_u8(), then call this).
// Returns the total unit count restored, or -1.
OF_API void of_gp_bytes_alloc(int n) { g_u8.assign(n > 0 ? n : 0, 0); }

OF_API int of_gp_inventory_deserialize(void) {
  if (!gpReady() || g_u8.empty()) return -1;
  of::persist::SaveReader r(g_u8);
  const uint64_t n = r.varint();
  // A slot count larger than any pack that has ever existed means the bytes are
  // not a pack. Refuse rather than walk off the end of the buffer.
  if (n > 4096) return -1;
  g_inv.reset(new gp::Inventory(*g_reg));
  int restored = 0;
  for (uint64_t i = 0; i < n; ++i) {
    const auto item = static_cast<gp::ItemId>(r.varint());
    const auto count = static_cast<uint16_t>(r.varint());
    if (item == gp::kNoItem || count == 0) continue;
    // add(), not a slot write: stack caps are the registry's rule and a
    // restored pack must obey exactly the same one a crafted pack does.
    const uint16_t over = g_inv->add(item, count);
    restored += count - over;
  }
  return restored;
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
OF_API void of_gp_nodes_clear(void) {
  g_gpNodes.clear(); g_gpKinds.clear(); g_gpNodePatch.clear();
}
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
  const wg::DensityField* e = editsOrNull(editsId);
  const wg::BodyParams& body = *b;
  wg::SnapHeightFn snap = [&body, e](const Vec3& d) {
    return e ? wg::surfaceHeight(body, d, *e) : wg::surfaceHeight(body, d);
  };
  const std::vector<wg::FDepositNode> made = wg::survival::LayoutTestArea(
      body, body.bodySeed, FrameId(0), vec(dx, dy, dz), kinds, ringRadiusRad, snap);
  for (size_t i = 0; i < made.size(); ++i) {
    g_gpNodes.push_back(made[i]);
    g_gpKinds.push_back(g_gpPending[i % g_gpPending.size()]);
    g_gpNodePatch.push_back(-1);
  }
  return static_cast<int>(g_gpNodes.size());
}

// Add ONE node at a caller-chosen direction, snapped to the oracle surface.
// Returns its index, or -1 if the body is unknown.
//
// WHY THIS EXISTS ALONGSIDE of_gp_nodes_layout. LayoutTestArea jitters each node
// by up to 0.0003 rad, which is 180 m at Forge's 600 km radius. That is sane for
// the "test area" it was written for (a 1.2 km ring) and useless for a walkable
// clearing: at a 20 m ring radius the jitter is nine times the ring and the
// patch is a random 360 m smear. So the CHOICE of position is the caller's, and
// everything that is a rule stays /core's: resourceOf, baseAmountOf, the same
// position-hashed Grade, and wg::surfaceHeight for where the ground is.
OF_API int of_gp_node_add(int bodyId, int editsId, int kind,
                          double dx, double dy, double dz) {
  const wg::BodyParams* b = g_bodies.get(bodyId);
  if (!b || kind < 0 || kind > 6) return -1;
  const double len = std::sqrt(dx * dx + dy * dy + dz * dz);
  if (!(len > 0.0)) return -1;
  const Vec3 dir(dx / len, dy / len, dz / len);
  const auto nk = static_cast<wg::survival::NodeKind>(kind);
  const wg::DensityField* e = editsOrNull(editsId);
  const double h = e ? wg::surfaceHeight(*b, dir, *e) : wg::surfaceHeight(*b, dir);
  wg::FDepositNode n;
  n.Position = UniverseCoord(dir * (b->radiusM + h), FrameId(0));
  wg::dirToLatLon(dir, n.Lat, n.Lon);
  n.SurfaceNormal = dir;
  n.Body = b->bodyId;
  n.Resource = wg::survival::resourceOf(nk);
  n.Grade = static_cast<float>(
      0.5 + 0.5 * wg::hashToUnit(wg::hashPos(b->bodySeed, dir, 0x57A47u)));
  n.InitialAmount = wg::survival::baseAmountOf(nk) * n.Grade;
  n.RemainingAmount = n.InitialAmount;
  n.Id = wg::hashCombine(wg::mix64(b->bodySeed ^ 0x5E2D17ull),
                         static_cast<uint64_t>(g_gpNodes.size()));
  g_gpNodes.push_back(n);
  g_gpKinds.push_back(static_cast<uint8_t>(kind));
  g_gpNodePatch.push_back(-1);
  return static_cast<int>(g_gpNodes.size()) - 1;
}

// f64 scratch [x, y, z, remaining, initial, grade, kind, resource]. Returns 8,
// or 0 for an out-of-range index. Position is body-frame metres.
//
// A node linked to a PATCH reports the PATCH's pool, re-derived here on every
// read. That is the whole point of the link: an outcrop is the part of an ore
// body that breaks the surface, so "how much is left" has exactly one answer
// however many outcrops the patch has.
OF_API int of_gp_node_state(int i) {
  resetF64(8);
  if (i < 0 || static_cast<size_t>(i) >= g_gpNodes.size()) return 0;
  syncNodeToPatch(i);
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
//
// PASS 0 FOR BOTH YIELDS and gameplay.h applies its authored pacing (§S.2a):
// swings-to-clear is the constant and the per-swing yield is derived from the
// node's own size, so the browser holds no balance opinion of its own. A
// non-zero yield overrides it, which is only for probes that want a fixed pull.
//
// The sub-unit remainder this shim used to absorb (a node parking at 0.72 with
// no swing able to finish it) is FIXED IN /core as of the §S.2a work: harvestNode
// rounds a positive remainder up to one unit and drains the node. Nothing to
// paper over here any more.
OF_API int of_gp_node_harvest(int i, int baseYield, int toolYield) {
  resetI32(4);
  if (!gpReady() || i < 0 || static_cast<size_t>(i) >= g_gpNodes.size()) return 0;
  wg::FDepositNode& n = g_gpNodes[static_cast<size_t>(i)];
  const auto kind =
      static_cast<wg::survival::NodeKind>(g_gpKinds[static_cast<size_t>(i)]);
  // An OUTCROP goes through §S.5, which is harvestNode with the patch's pool
  // handed in and the deduction taken back out of the patch. Same rule, one
  // pool; the yields it uses are deposits.h §P's, not this file's.
  wg::patches::OrePatch* patch = patchOfNode(i);
  if (patch) {
    sv::HarvestResult pr = sv::harvestPatch(*patch, n, kind, *g_inv);
    g_i32.push_back(static_cast<int32_t>(pr.granted));
    g_i32.push_back(pr.usedTool ? 1 : 0);
    g_i32.push_back(pr.nodeEmpty ? 1 : 0);
    g_i32.push_back(static_cast<int32_t>(n.Resource));
    return static_cast<int>(pr.granted);
  }
  sv::HarvestResult r = sv::harvestNode(
      n, kind, *g_inv, static_cast<uint16_t>(baseYield < 0 ? 0 : baseYield),
      static_cast<uint16_t>(toolYield < 0 ? 0 : toolYield));
  g_i32.push_back(static_cast<int32_t>(r.granted));
  g_i32.push_back(r.usedTool ? 1 : 0);
  g_i32.push_back(r.nodeEmpty ? 1 : 0);
  g_i32.push_back(static_cast<int32_t>(n.Resource));
  return static_cast<int>(r.granted);
}

// Drain `units` of ore out of a node WITHOUT granting them to the pack, and
// return the units actually removed (clamped at the node's remaining amount).
//
// WHY THIS EXISTS. A miner placed on a node is seeded from that node's remaining
// amount, and from then on TWO counters describe the same ore: the FDepositNode
// the world draws and the miner's bound deposit inside the sim. If only the
// second one falls, the node stands full for ever while the ore it holds is
// carried away on a belt, which is the same class of defect as two surfaces or
// two gravities. The build layer syncs the node down by exactly what the miner
// consumed, so the pair conserves: node loss == miner extraction, always. It
// deliberately grants nothing (that is harvestNode's job) — this is a transfer
// between two ledgers, not a source of items.
OF_API int of_gp_node_drain(int i, double units) {
  if (i < 0 || static_cast<size_t>(i) >= g_gpNodes.size() || units <= 0.0) return 0;
  // An outcrop has no ore of its own, so the transfer lands on its patch.
  if (wg::patches::OrePatch* p = patchOfNode(i)) {
    const double took = wg::patches::extract(*p, units);
    syncNodeToPatch(i);
    return static_cast<int>(took);
  }
  wg::FDepositNode& n = g_gpNodes[static_cast<size_t>(i)];
  // Subtract in DOUBLE and store once. `RemainingAmount` is a float, so
  // `remaining -= (float)remaining` at deposit scale leaves a 3.6e-7 crumb, and
  // a node that reads 0.00000036 is not empty: it is the same "node parks just
  // above empty for ever" defect §S.2a already deleted from harvestNode, walked
  // back in through a different door.
  const double rem = static_cast<double>(n.RemainingAmount);
  const double take = units < rem ? units : rem;
  const double left = rem - take;
  n.RemainingAmount = static_cast<float>(left < 1e-3 ? 0.0 : left);
  return static_cast<int>(take);
}

// --- ORE PATCHES (deposits.h §P) ---------------------------------------------
// A deposit is a piece of GROUND: an irregular lobed area holding ONE pool of
// ore, with coverage falling from a rich centre to a thin rim. Every shape,
// richness and balance question below is answered by /core; this file only
// copies numbers into the scratch arena.
//
// SURFACE AUTHORITY, again. The layout snaps each patch centre through
// wg::surfaceHeight, and the mesh/outcrop calls hand back UNIT DIRECTIONS rather
// than positions, so the caller re-asks the same oracle for the radius and a
// levelled or dug patch still hugs the ground it is in.
OF_API void of_gp_patches_clear(void) { g_gpPatches.clear(); }
OF_API int of_gp_patches_count(void) { return static_cast<int>(g_gpPatches.size()); }

// Lay out a field of patches around `dir`, one per kind queued with
// of_gp_kinds_push. Returns the TOTAL patch count, or -1 if the body is unknown.
OF_API int of_gp_patch_layout(int bodyId, int editsId, double dx, double dy,
                              double dz, double spreadM) {
  const wg::BodyParams* b = g_bodies.get(bodyId);
  if (!b) return -1;
  if (g_gpPending.empty()) return static_cast<int>(g_gpPatches.size());
  const wg::DensityField* e = editsOrNull(editsId);
  const wg::BodyParams& body = *b;
  wg::SnapHeightFn snap = [&body, e](const Vec3& d) {
    return e ? wg::surfaceHeight(body, d, *e) : wg::surfaceHeight(body, d);
  };
  const std::vector<wg::patches::OrePatch> made = wg::patches::LayoutPatchField(
      body, body.bodySeed, FrameId(0), vec(dx, dy, dz), g_gpPending, spreadM, snap);
  for (const wg::patches::OrePatch& p : made) g_gpPatches.push_back(p);
  return static_cast<int>(g_gpPatches.size());
}

// f64 scratch, 18 entries:
//   [0..2]  centre, body-frame metres
//   [3..5]  centre unit direction
//   [6..8]  tangent basis T1
//   [9..11] tangent basis T2
//   [12]    nominal radius, metres      [13] NodeKind      [14] resource ItemId
//   [15]    peak grade                  [16] initial       [17] remaining
OF_API int of_gp_patch_state(int i) {
  resetF64(18);
  if (i < 0 || static_cast<size_t>(i) >= g_gpPatches.size()) return 0;
  const wg::patches::OrePatch& p = g_gpPatches[static_cast<size_t>(i)];
  const Vec3 v[4] = {p.Centre, p.Dir, p.T1, p.T2};
  for (const Vec3& a : v) { g_f64.push_back(a.x); g_f64.push_back(a.y); g_f64.push_back(a.z); }
  g_f64.push_back(p.RadiusM);
  g_f64.push_back(static_cast<double>(p.Kind));
  g_f64.push_back(static_cast<double>(p.Resource));
  g_f64.push_back(static_cast<double>(p.Grade));
  g_f64.push_back(p.InitialAmount);
  g_f64.push_back(p.RemainingAmount);
  return 18;
}

// The drawable skin: (rings+1) x segs vertices as [dirX, dirY, dirZ, coverage].
// Returns the VERTEX count. The caller multiplies each direction by the surface
// oracle's radius; the coverage is the same number the drill rate reads, which
// is what makes the tint an honest picture of the ore rather than a decoration.
OF_API int of_gp_patch_mesh(int i, int rings, int segs) {
  resetF64(0);
  if (i < 0 || static_cast<size_t>(i) >= g_gpPatches.size()) return 0;
  const std::vector<wg::patches::DiscVertex> d =
      wg::patches::sampleDisc(g_gpPatches[static_cast<size_t>(i)], rings, segs);
  resetF64(d.size() * 4);
  for (const wg::patches::DiscVertex& v : d) {
    g_f64.push_back(v.Dir.x); g_f64.push_back(v.Dir.y); g_f64.push_back(v.Dir.z);
    g_f64.push_back(v.Coverage);
  }
  return static_cast<int>(d.size());
}

// The outcrops: [dirX, dirY, dirZ, scale, sinkFrac, coverage] each. Returns the
// count. These are the pieces of the ore body that break the surface, which is
// what makes a patch visible from a distance and gives a hand something to swing
// at (the bootstrap: you cannot build a drill before you have mined by hand).
OF_API int of_gp_patch_outcrops(int i) {
  resetF64(0);
  if (i < 0 || static_cast<size_t>(i) >= g_gpPatches.size()) return 0;
  const wg::patches::OrePatch& p = g_gpPatches[static_cast<size_t>(i)];
  const int n = wg::patches::outcropCount(p);
  resetF64(static_cast<size_t>(n) * 6);
  for (int k = 0; k < n; ++k) {
    const wg::patches::Outcrop o = wg::patches::outcropAt(p, k);
    g_f64.push_back(o.Dir.x); g_f64.push_back(o.Dir.y); g_f64.push_back(o.Dir.z);
    g_f64.push_back(o.Scale); g_f64.push_back(o.SinkFrac); g_f64.push_back(o.Coverage);
  }
  return n;
}

// Coverage in [0,1] at a body-frame point: 0 means "not on this patch".
OF_API double of_gp_patch_cover(int i, double x, double y, double z) {
  if (i < 0 || static_cast<size_t>(i) >= g_gpPatches.size()) return 0.0;
  return wg::patches::coverageAt(g_gpPatches[static_cast<size_t>(i)], vec(x, y, z));
}

// THE PLACEMENT QUESTION, and the reason the refusal can be trusted: which patch
// is under this point, or -1 for ordinary ground. A drill asks exactly this.
OF_API int of_gp_patch_find(double x, double y, double z) {
  return wg::patches::findPatch(g_gpPatches, vec(x, y, z));
}

// A drill's extraction rate at a point, units per second: the authored rate
// times the richness where it stands. Zero off the patch, so a drill that was
// somehow placed on nothing would mine nothing rather than mine for free.
OF_API double of_gp_patch_drill_rate(int i, double x, double y, double z) {
  if (i < 0 || static_cast<size_t>(i) >= g_gpPatches.size()) return 0.0;
  return wg::patches::kDrillUnitsPerSec
       * wg::patches::richnessAt(g_gpPatches[static_cast<size_t>(i)], vec(x, y, z));
}

// Take ore out of a patch WITHOUT granting it (the drill's ledger transfer, and
// the depletion diff's way back in on load). Returns what was actually removed.
OF_API double of_gp_patch_drain(int i, double units) {
  if (i < 0 || static_cast<size_t>(i) >= g_gpPatches.size()) return 0.0;
  return wg::patches::extract(g_gpPatches[static_cast<size_t>(i)], units);
}

// Add a harvest node that is an OUTCROP of patch `patchIndex`: same node array,
// same index space, same harvest call, but it holds no ore of its own. Returns
// the node index, or -1.
OF_API int of_gp_node_add_outcrop(int bodyId, int editsId, int patchIndex,
                                  double dx, double dy, double dz) {
  if (patchIndex < 0 || static_cast<size_t>(patchIndex) >= g_gpPatches.size())
    return -1;
  const wg::patches::OrePatch& p = g_gpPatches[static_cast<size_t>(patchIndex)];
  const int idx = of_gp_node_add(bodyId, editsId, static_cast<int>(p.Kind),
                                 dx, dy, dz);
  if (idx < 0) return -1;
  g_gpNodePatch[static_cast<size_t>(idx)] = patchIndex;
  syncNodeToPatch(idx);
  return idx;
}

// What `ore` smelts into (gameplay.h smeltOutputFor), or 0 if it is not an ore.
// A placed smelter needs an input AND an output item to be given a recipe, and
// the pairing is a RULE: transcribing "raw iron becomes iron" into JS is exactly
// the second-authority mistake, one furnace-tier balance pass away from being
// wrong. The auto-line smelter and the hand furnace now read the same table.
OF_API int of_gp_smelt_output_for(int ore) {
  return static_cast<int>(sv::smeltOutputFor(static_cast<gp::ItemId>(ore)));
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

// All-or-nothing craft, in BOTH directions since GP-51: 1 on success, 0 if the
// inputs are not all present OR the output would not fit. A 0 consumes nothing.
OF_API int of_gp_craft(int i) {
  if (!gpReady() || i < 0 || static_cast<size_t>(i) >= g_gpRecipes.size()) return 0;
  return sv::HandCrafter::craft(g_gpRecipes[static_cast<size_t>(i)], *g_inv) ? 1 : 0;
}

// WHY a craft would be refused, as gameplay.h's CraftBlock code (GP-51, and
// GP-46's rule that a refusal crosses the bridge as a CODE plus its subject).
// 0 none, 1 no such recipe, 2 inputs short, 3 pack full.
//
// A SENTENCE CANNOT BE BUILT HERE and that is deliberate: /core has no display
// names, so composing one would need a second copy of the item name table
// inside this shim. It is also the difference between two opposite actions, "go
// and mine" against "go and drop something", which a boolean throws away.
OF_API int of_gp_craft_block(int i) {
  if (!gpReady() || i < 0 || static_cast<size_t>(i) >= g_gpRecipes.size())
    return static_cast<int>(sv::CraftBlock::NoRecipe);
  return static_cast<int>(
      sv::HandCrafter::craftBlock(g_gpRecipes[static_cast<size_t>(i)], *g_inv));
}

// --- Structural building set (gameplay.h §S.6) -------------------------------
// Foundation / floor / wall / door. These are NOT factory-sim entities: they
// never tick, have no ports, no power and no inventory, so the sim never sees
// them and there is no of_fs_* call here. The client places a TypeId and pays a
// build cost; that is the whole contract.
//
// PLACEMENT PAYS, IT DOES NOT CRAFT. of_gp_structure_pay consumes the cost and
// adds NO item to the pack, because the thing produced is a building in the
// world, not a stack. That is why these four never appear in of_gp_recipe_*.

// How many structural parts exist. Content, so this is valid before of_gp_init.
OF_API int of_gp_structure_count(void) {
  return static_cast<int>(gpStructures().size());
}

// i32 scratch [item, typeId, kind, inputCount, (itemId, count)*inputCount].
// Returns the element count written, or 0 for an out-of-range index. `count` is
// the cost, not what the pack holds: use of_gp_count / of_gp_structure_can_afford
// for affordability so the two never disagree.
OF_API int of_gp_structure_info(int i) {
  resetI32(12);
  const sv::StructureDef* d = gpStructure(i);
  if (!d) return 0;
  g_i32.push_back(static_cast<int32_t>(d->item));
  g_i32.push_back(static_cast<int32_t>(d->typeId));
  g_i32.push_back(static_cast<int32_t>(d->kind));
  g_i32.push_back(static_cast<int32_t>(d->cost.inputs.size()));
  for (const gp::ItemStack& in : d->cost.inputs) {
    g_i32.push_back(static_cast<int32_t>(in.item));
    g_i32.push_back(static_cast<int32_t>(in.count));
  }
  return static_cast<int>(g_i32.size());
}

// 1 if the pack holds the whole build cost right now, else 0. Read-only.
OF_API int of_gp_structure_can_afford(int i) {
  const sv::StructureDef* d = gpStructure(i);
  if (!gpReady() || !d) return 0;
  return sv::HandCrafter::canCraft(d->cost, *g_inv) ? 1 : 0;
}

// Pay the build cost, ALL-OR-NOTHING. 1 on success (every input removed, nothing
// added), 0 if any input is short (nothing removed). The caller commits the
// placement only on 1, so the units cannot exist as both a wall and a stack.
OF_API int of_gp_structure_pay(int i) {
  const sv::StructureDef* d = gpStructure(i);
  if (!gpReady() || !d) return 0;
  return sv::HandCrafter::payInputs(d->cost, *g_inv) ? 1 : 0;
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

// =============================================================================
// §11-§13 — the VESSEL surface (ABI 6). Split into three included files so that
// none of them, and not this one either, grows past reading size. They are
// #included rather than compiled separately because the scratch arena, the
// Registry template and the gameplay inventory above all have internal linkage:
// one translation unit is the contract, and build.ps1 stays a one-file command.
// =============================================================================
#include "of_vessel_api.inc"    // §11  catalogue, part costs, the tree
#include "of_staging_api.inc"   // §12  staging, autostage, reorder, delta-v
#include "of_flight_api.inc"    // §13  atmosphere + FlightSim (for the next lane)
#include "of_power_api.inc"     // §14  ABI 9: poles, generators, the grid panel
#include "of_research_api.inc"  // §15/16 ABI 9: the tech tree, armour, skills
#include "of_maneuver_api.inc"  // §17  ABI 11: maneuver node planning
#include "of_discovery_api.inc" // §18  ABI 12: the discoverable map (DW-36)
// AFTER §18, and it must be: of_map_sample reads that file's `g_disc` for the
// survey bit it writes per sample.
#include "of_map_api.inc"       // §19  ABI 14: the map samples the world (DW-37)
#include "of_enemies_api.inc" // §20  ABI 15: the pollution/evolution/nest loop
