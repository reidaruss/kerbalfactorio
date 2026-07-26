# WASM Bridge — `/core` in the browser

> **Owner:** core-engine-controller · **Status:** spike complete, VIABLE · **Date:** 2026-07-25
> **Code:** [`web/wasm/`](../../web/wasm) · **Build + run:** [`web/wasm/README.md`](../../web/wasm/README.md)
> Read alongside: [ARCHITECTURE.md](ARCHITECTURE.md) (renderer, owns the Three.js side) · [core-engine.md](../controllers/core-engine.md)

The headless C++17 simulation in [`core/`](../../core) compiles to WebAssembly and
runs from JavaScript. `web/wasm/of_core_api.cpp` is a **thin flat-C shim over the
unmodified `core/include/of/*.h` headers** — no game logic is re-implemented, so
the 22 green ctest suites still cover the code the browser executes.

**Verdict: viable.** The WASM core is bit-for-bit self-reproducing (the property
multiplayer and seed-and-diff persistence actually need), runs at 82–94% of
native for the two hot paths, and clears the R1 chunk-delivery gate with 3.5×
headroom. One honest caveat, fully diagnosed, in [§6](#6-parity-the-result-of-the-spike).

---

## 1. Why a flat C ABI and not embind

Every hot path across this boundary produces a **bulk array** — 1,217 vertices of
chunk geometry, a face-quad list, an entity-state stream. embind marshals values
through a JS object graph and would copy those element by element; it also adds
~40 KB of glue and an RTTI dependency.

The flat C ABI plus a **scratch arena inside the WASM heap** lets JS build a
typed-array *view* over the result with zero copies, then upload it straight to a
GPU buffer. The cold calls (create a body, place a machine) are cheap enough as
flat functions too, so the whole module is one uniform surface: **no embind
anywhere.**

Module size: **`of-core.wasm` 127 KB + `of-core.mjs` 19 KB** glue.

---

## 2. Loading

```js
import createOrbitalFoundryCore from './of-core.mjs';
const M = await createOrbitalFoundryCore();   // one instance
```

Built with `-sMODULARIZE=1 -sEXPORT_ES6=1 -sEXPORT_NAME=createOrbitalFoundryCore
-sALLOW_MEMORY_GROWTH=1 -sFILESYSTEM=0 -sENVIRONMENT=web,worker,node -O3`.
Every exported function is reachable as `M._of_<name>` (leading underscore).

`M._of_abi_version()` returns `1`. Check it on load and fail loudly on a mismatch
rather than reading a stale `.wasm` with a shifted layout.

### 2.1 64-bit values

We deliberately do **not** build with `-sWASM_BIGINT`. Forcing every 64-bit value
through JS `BigInt` is a papercut for the renderer and a silent-truncation hazard
when mixed with `Number`. Instead:

* Values that fit exactly in a double (counts, tick indices, deposit amounts) are
  passed and returned as **`double`**. All are far below 2^53.
* True 64-bit **hashes and seeds** are returned as a `uint32` low word, with the
  high word available from **`of_last_hi()`** — which you must read *immediately*,
  before any other call that returns a 64-bit value.

```js
const lo = M._of_quadmesh_content_hash_lo(mesh) >>> 0;
const hi = M._of_last_hi() >>> 0;             // read it NOW
const key = hi.toString(16).padStart(8,'0') + lo.toString(16).padStart(8,'0');
```

---

## 3. Memory and ownership — read this before writing any binding

### 3.1 Handles, not pointers

Stateful objects (bodies, voxel edit sets, terrain streamers, factory networks,
quad meshes) live in WASM-side registries. JS holds a positive `int` handle.
`0` or a negative return means "invalid".

**Every `*_create` / `*_generate` needs its matching `*_destroy`.** Nothing is
garbage-collected on the WASM side. A leaked `TerrainStreamer` holds its entire
resident chunk set.

Handle id spaces are **per module instance**. Handle `3` in a worker is a
different object from handle `3` on the main thread.

### 3.2 The scratch arena and the `ALLOW_MEMORY_GROWTH` footgun

This is the classic WASM/JS bug and it will bite anyone who is careless.

Array-returning calls write into one of four module-level scratch buffers and
return the **element count**. JS then asks for the current base pointer:

| Accessor | Buffer |
|---|---|
| `of_scratch_f32()` | `float32` |
| `of_scratch_f64()` | `float64` |
| `of_scratch_i32()` | `int32` |
| `of_scratch_u8()` | `uint8` |

**The rule, in one line:**

> Never cache a heap view or a scratch pointer across a call into WASM. Re-read
> `M.HEAPxx` **and** re-read the pointer, in that order, every single time.

Two independent things invalidate a cached view:

1. **Memory growth.** With `-sALLOW_MEMORY_GROWTH`, any allocation can replace the
   entire `WebAssembly.Memory` buffer. Every typed array over the old buffer is
   **detached** — it silently reads as length 0, or throws. `M.HEAPF32` is
   re-bound by the runtime, but *your* `subarray` is not.
2. **Scratch reallocation.** The scratch vectors grow; `of_scratch_f64()` can
   return a different address after any producing call.

The safe pattern, which is all the helpers in `test/parity.mjs` do:

```js
function scratchF64(M, n) {                       // correct
  const p = M._of_scratch_f64();                  // pointer AFTER the producer
  return M.HEAPF64.subarray(p >>> 3, (p >>> 3) + n);   // HEAP re-read too
}

const n = M._of_chunk_heights_f64(streamer, i);   // producer first
const heights = scratchF64(M, n);                 // then the view
```

And the anti-pattern that will corrupt your frame:

```js
const HEAP = M.HEAPF32;                           // WRONG - stale after growth
const base = M._of_scratch_f32();                 // WRONG - stale after any call
```

**Lifetime:** a scratch view is valid only until the next call that writes the
*same* arena. The four arenas are independent, so
`of_net_emit_entity_states()` filling both `i32` (per-entity ints) and `f32`
(positions) can be read in either order — but a second `of_net_*` call clobbers
both. **If the data outlives the next WASM call, copy it** (`.slice()`), or
upload it to the GPU immediately.

Retained-mesh pointers (`of_quadmesh_positions_f32` etc.) are stable for the
lifetime of the mesh handle, but are *still* invalidated by memory growth. Same
rule applies.

---

## 4. The exported C API

Signatures below are the C declarations; call them in JS as `M._of_name(...)`.
`dx,dy,dz` is a unit direction in the body frame. `x,y,z` is a body-frame
position in metres. `editsId <= 0` everywhere means "no digs" (the pristine
procedural world).

### 4.0 Surface authority: which export reads what

**One surface: [`surface_field.h`](../../core/include/of/surface_field.h) (WG-21,
[DECISIONS.md](DECISIONS.md) standing rule 1).** `baseHeight` (identically
`sampleDesignedHeight`) is the designed relief; `surfaceHeight` is that minus the
voxel-derived lowering with the single bedrock clamp. RAW `sampleHeightField` is
an **internal ingredient** of the designed shaping and of the biome classifier.
Nothing stands on it, collides with it or is positioned relative to it. On Forge
the two disagree by kilometres.

The audit of 2026-07-25 walked every export and found **three** places the bridge
had drifted off the authority. Fixed in ABI 2; the table is the contract.

| Export | Reads | Notes |
|---|---|---|
| `of_base_height` | **oracle** `baseHeight` | the designed base |
| `of_surface_height` / `of_surface_radius` | **oracle** `surfaceHeight` | base minus lowering, one clamp |
| `of_derived_lowering` | **oracle** | top-anchored open-column depth |
| `of_derived_raising` / `of_surface_offset` | **oracle** | WG-22: the fill mirror, and the signed offset the mesher subtracts |
| `of_solid_at` / `of_solid_cell` | **oracle** | designed shell, plus added, minus removed |
| `of_edits_dig` / `of_edits_fill` / `of_exposed_faces` | **oracle** (via `VoxelEdits::isSolid`) | designed since WG-21 |
| `of_level_area` / `of_streamer_level` | **oracle** `levelArea` | WG-22: the rule lives in `/core`, the shim only unpacks the result |
| `of_sample_designed_height_latlon` | **oracle** base at a geo coord | same value as `of_base_height` |
| `of_chunk_*` (streamed chunk data) | **oracle** (via `buildChunk`) | designed base + bound lowering |
| `of_chunk_packed` | **oracle** | positions/heights from the chunk above |
| `of_quadmesh_generate` | **oracle when `rawBase == 0`** | **was a violation:** the flag used to be `designedBase`, so `0` (the value a forgetful caller passes) selected RAW. Zero now means correct, and raw-base + edits is rejected |
| `of_observer_latlon_alt` | **oracle** `surfaceRadius` | **was a violation:** built on `makeObserverLatLonAlt`, i.e. RAW. See below |
| `of_chunk_max_offset` | geometry only | **was wrong as a bound:** largest single AXIS offset, interior only. Now the true Euclidean radius over interior + skirt |
| `of_biome_at`, `of_temperature_at`, `of_moisture_at` | RAW **as a classifier input** | legitimate: `biome.h` defines climate on the raw field. Not a surface |
| `of_sample_raw_height_latlon` | RAW | **diagnostic only**, RAW is in the name. Never position anything with it |
| `of_diag_scan_quad` | RAW **and** designed, side by side | diagnostic: its whole job is to expose the gap |
| `of_body_radius`, `of_quadmesh_chunk_radius`, `of_chunk_anchor` | neither | datum / geometric extents, no relief |

**The observer defect, concretely.** `of_observer_latlon_alt` called
`terrain_stream.h`'s `makeObserverLatLonAlt`, which samples the raw heightfield.
At lat 48 / lon 18 on Forge (seed `0x0BF00D01`) that is **4,075.51 m** where the
designed surface is **6,520.81 m**, so an "altitude 60 m" observer was placed
**2,445.30 m underground** and every terrain chunk rendered behind the camera.
It now returns `dir * (of_surface_radius(body, edits, dir) + altM)` bit-exactly,
and takes the `edits` handle so altitude is measured above the surface the player
actually walks on, digs included.

Two things keep it fixed: `dump_expected.cpp` **CASE 7b** self-checks the
identity natively and refuses to emit a fixture if it breaks, and `parity.mjs`
**CASE 7b** asserts both halves in WASM: the observer *equals* the oracle
position, and it *does not* equal the raw one (that negative half matters. If raw
and designed ever agreed at the sample point the test would pass vacuously, so
the gap itself is asserted).

Rules for any export added later:

1. Anything that answers "where is the ground" calls the oracle.
2. RAW may be exposed only with RAW in the name, documented as a diagnostic.
3. **Zero means correct.** If a flag picks an authority, `0` picks the oracle.
4. Never mix bases. A lowering computed against the designed base must never be
   applied to a raw base; that is the original WG-21 bug rebuilt by hand.

### 4.1 Module

```c
int      of_abi_version(void);                 // 4
uint32_t of_last_hi(void);                     // high word of the last uint64 return
float*   of_scratch_f32(void);
double*  of_scratch_f64(void);
int32_t* of_scratch_i32(void);
uint8_t* of_scratch_u8(void);
```

`of_abi_version` is checked at load (`OfCore.ts`) and a mismatch throws, so a
stale `.wasm` fails loudly instead of misbehaving. **It does NOT catch a stale
build at the same ABI**, which is how the browser ran three-commit-old world
generation for most of a session: `build.ps1` writes `web/wasm/dist`, the client
serves `web/public/wasm`, and only `npm run sync-wasm` connects them. Treat
`build.ps1 && sync-wasm` as one operation.

**ABI 4, 2026-07-26 — TERRAFORMING (WG-22).** The voxel layer gained a second
sparse set (`added`), so **fill is representable at all**; before this the model
was subtractive by construction and levelling a slope could not be expressed.
New: `of_edits_fill` / `of_edits_fill_cell` / `of_edits_added_count` /
`of_edits_is_added_cell`, the `of_level_area` op, `of_streamer_level` (the mouth
reconciliation for a level, sharing the dig path's re-mesh rule), and
`of_derived_raising` / `of_surface_offset` / `of_max_fill`. **The bytes
`of_edits_serialize` writes are a NEW self-describing format** carrying both
sets; `of_edits_deserialize` still reads the old one, so slots written before
today still load. No existing signature changed. ABI 3 (2026-07-26) was the
`of_gp_patch_*` ore-body surface. **`OfCore.ts` sat at 2 while the shim already
returned 3**, which is exactly the mismatch the constant exists to catch and is
why it is worth checking both numbers when touching this file.

**ABI 2 additions, 2026-07-26 (additive: no signature changed, so the version
does not move).** `of_body_mu(body)` and `of_gravity_accel(body, rM)` publish
`BodyParams::muM3S2`, THE gravity authority (DW-18); the browser must never
re-derive g. `of_streamer_dig(s, x, y, z, radiusM)` replays one dig into the
STREAMER's own `VoxelEdits` and re-meshes every resident chunk within reach,
publishing them through the ordinary `last.ready` path, which is the W5 mouth
reconciliation: the heightfield opens only because `buildChunk` runs through
`SurfaceField::loweringFn`, so a sideways tunnel correctly opens nothing.

**ABI 2** (2026-07-25, the
surface-authority audit) changed three things: `of_observer_latlon_alt` gained an
`edits` parameter and now reads the oracle; `of_quadmesh_generate`'s last
parameter became `rawBase`, inverting its polarity so `0` is the safe value; and
`of_chunk_max_offset` became a true Euclidean bound including the skirt.

### 4.2 Bodies

```c
int    of_body_create_forge (uint32_t seedLo, uint32_t seedHi);   // planet, R=600 km
int    of_body_create_cinder(uint32_t seedLo, uint32_t seedHi);   // moon,   R=200 km
int    of_body_create(uint32_t bodyId, uint32_t seedLo, uint32_t seedHi,
                      double radiusM, int kind /*0=planet 1=moon*/,
                      double maxReliefM, double seaLevelM);
void   of_body_destroy(int body);
double of_body_radius(int body);
double of_body_max_relief(int body);
int    of_body_kind(int body);
uint32_t of_body_seed_lo(int body);            // + of_last_hi()
```

### 4.3 Surface oracle — **synchronous, main-thread safe, zero allocation**

These are the calls the character step, aim/placement raycast and build-grid snap
make *inside the frame*. Plain exported C functions: scalars in, a `double` or
`int` out, no allocation, no scratch arena, no `postMessage`. Measured cost in
[§7](#7-benchmarks).

```c
double of_base_height      (int body, double dx, double dy, double dz);
double of_surface_height   (int body, int edits, double dx, double dy, double dz);
double of_surface_radius   (int body, int edits, double dx, double dy, double dz);
double of_derived_lowering (int body, int edits, double dx, double dy, double dz);
double of_derived_raising  (int body, int edits, double dx, double dy, double dz);
double of_surface_offset   (int body, int edits, double dx, double dy, double dz);
double of_max_dig_depth(void);                 // 80.0 m bedrock clamp
double of_max_fill(void);                      // 24.0 m fill cap (WG-22)

int    of_solid_at  (int body, int edits, double x,  double y,  double z);   // 0/1
int    of_solid_cell(int body, int edits, int32_t cx, int32_t cy, int32_t cz);

double of_sample_raw_height_latlon     (int body, double lat, double lon);
double of_sample_designed_height_latlon(int body, double lat, double lon);
void   of_latlon_to_dir(double lat, double lon);   // -> f64 scratch [x,y,z]
void   of_dir_to_latlon(double dx, double dy, double dz); // -> f64 scratch [lat,lon]
```

`baseHeight ≡ sampleDesignedHeight` (WG-21: the single surface authority).
`surfaceHeight = clamp(base − derivedLowering + derivedRaising, base − 80 m,
base + 24 m)`. With no edits bound, `surfaceHeight` returns `baseHeight`
**bit-identically**.

`of_derived_raising` is the WG-22 mirror of `of_derived_lowering`: the run of
PLACED cells anchored at the base surface. A filled cell floating above a gap
raises nothing, exactly as a sideways tunnel lowers nothing.
`of_surface_offset` is the signed `base − surface` the chunk mesher subtracts, so
**one** callback carries both halves of terraforming and `generateQuadMesh` needs
no second hook. It is negative where the ground came up.

`of_sample_raw_height_latlon` is a **diagnostic, not a surface** ([§4.0](#40-surface-authority-which-export-reads-what)).
It exists so a test can prove the raw/designed gap is still there and that
nothing is reading it by accident. To position anything, use `of_surface_radius`
or `of_observer_latlon_alt`.

### 4.4 Biomes

```c
int    of_biome_at(int body, double dx, double dy, double dz);   // Biome enum
int    of_biome_at_latlon(int body, double lat, double lon);
int    of_material_for_biome(int biome);       // uint16 material id
double of_hardness_for_biome(int biome);       // [0,1]
double of_temperature_at(int body, double dx, double dy, double dz);
double of_moisture_at   (int body, double dx, double dy, double dz);
```

`Biome`: `0 Ocean, 1 Beach, 2 Plains, 3 Forest, 4 Hills, 5 Mountains, 6 Polar,
7 Regolith, 8 MoonHighland, 9 CraterFloor`. Material ids match one-to-one.

### 4.5 Voxels

```c
int  of_edits_create(void);
void of_edits_destroy(int edits);
int  of_edits_dig(int edits, int body, double x, double y, double z, double radiusM);
int  of_edits_dig_cell   (int edits, int32_t cx, int32_t cy, int32_t cz);
int  of_edits_dig_cell_at(int edits, double x, double y, double z);
int  of_edits_removed_count(int edits);
int  of_edits_is_removed_cell(int edits, int32_t cx, int32_t cy, int32_t cz);
int  of_edits_dirty_region(int edits);   // 1=valid; i32 scratch [minXYZ, maxXYZ]
void of_edits_clear_dirty(int edits);

// --- WG-22 terraforming: the FILL half, the mirror of dig ---------------------
int  of_edits_fill(int edits, int body, double x, double y, double z, double radiusM);
int  of_edits_fill_cell(int edits, int body, int32_t cx, int32_t cy, int32_t cz);
int  of_edits_added_count(int edits);
int  of_edits_is_added_cell(int edits, int32_t cx, int32_t cy, int32_t cz);

// THE LEVELLING OP. Inside a cylinder of radiusM about (x,y,z) aligned with the
// local up, every cell above targetHeightM becomes air and every cell below it
// becomes solid. Returns total cells changed; i32 scratch [dug, filled, scanned].
// Pass 0 for either bound to take /core's default (24 m each way).
int of_level_area(int edits, int body, double x, double y, double z,
                  double radiusM, double targetHeightM,
                  double maxCutM, double maxFillM);

void   of_cell_for_pos(double x, double y, double z);   // -> i32 scratch [cx,cy,cz]
void   of_cell_center(int32_t cx, int32_t cy, int32_t cz); // -> f64 scratch [x,y,z]
double of_voxel_size(void);                             // 1.0 m

// Exposed solid->air faces for the cube mesher. Returns the FACE COUNT;
// i32 scratch holds 5 ints per face: [cx, cy, cz, axis(0=X,1=Y,2=Z), sign(-1|+1)].
int of_exposed_faces(int body, int edits, double x, double y, double z, double radiusM);

// persistence.h byte cursors (no filesystem). Save to IndexedDB / OPFS.
int  of_edits_serialize(int edits);      // -> byte count, bytes in u8 scratch
void of_edits_alloc_bytes(int n);        // size the u8 scratch, then copy bytes in
int  of_edits_deserialize(int edits);    // -> removed count
```

**The serialized format changed in ABI 4 and it is self-describing.** The stream
now opens with a magic varint (`0x4F464532`) and a version, then the removed set,
then the added set. `of_edits_deserialize` branches on the first varint, so a
slot written before terraforming existed still loads and simply arrives with no
added cells. `VoxelSave.ts`'s "put the rock back" reset writes a single `0` byte,
which is a legacy empty stream, and that still means "no edits at all".

`dig()` returns the count of cells newly carved — the harvest yield. Because it
removes arbitrary cells including horizontally below the surface, repeated digs
carve real tunnels and overhangs; the heightfield view correctly reports **no
lowering** over an intact ceiling (proven in parity, [§6](#6-parity-the-result-of-the-spike)).

### 4.6 Quad meshes (standalone, for tools and previews)

```c
int of_quadmesh_generate(int body, int faceId, int depth, uint32_t qx, uint32_t qy,
                         int edits, int rawBase);        // -> mesh handle, 0 on error
void of_quadmesh_destroy(int mesh);
int  of_quadmesh_grid_dim(int mesh);        // 33
int  of_quadmesh_vertex_count(int mesh);    // 1089
double of_quadmesh_chunk_radius(int mesh);
uint32_t of_quadmesh_content_hash_lo(int mesh);   // + of_last_hi()
float*  of_quadmesh_positions_f32(int mesh);      // 3N, CENTRE-RELATIVE
float*  of_quadmesh_normals_f32(int mesh);        // 3N
float*  of_quadmesh_dirs_f32(int mesh);           // 3N unit sphere normals
double* of_quadmesh_heights_f64(int mesh);        // N, exact
void    of_quadmesh_center(int mesh);             // -> f64 scratch [x,y,z]
int     of_quadmesh_positions_f64(int mesh);      // -> f64 scratch, 3N exact
```

**`rawBase = 0` is the surface everything else in the engine reads** (the oracle's
designed base, exactly what `buildChunk` uses). `rawBase = 1` selects the raw
heightfield and exists only to reproduce the historical `cubed_sphere.h`
determinism baselines. Before ABI 2 this parameter was `designedBase`, so a
caller passing `0` silently got a raw mesh; the polarity was inverted so the
default value is the correct one.

`rawBase = 1` **with an edits handle bound returns 0** (refused). The
voxel-derived lowering is defined against the designed base, so subtracting it
from a raw base recreates the "mesh and edits disagree about the base" defect
WG-21 removed.

### 4.7 Terrain streaming

```c
int  of_streamer_create(int body, double splitRatio, double mergeHysteresis,
                        int maxDepth, int minResidentDepth,
                        double skirtFraction, int genBudget);
void of_streamer_destroy(int s);
void of_streamer_set_edits(int s, int edits);   // bind the voxel surface offset (0 = none)
// The mouth reconciliation. Replay ONE edit into the streamer's own VoxelEdits
// and re-mesh every resident chunk within reach, published through last.ready.
// Both share one re-mesh rule: the chunks an edit invalidates are a function of
// WHERE it happened and how wide it was, not of which verb did it.
int  of_streamer_dig(int s, double x, double y, double z, double radiusM);
int  of_streamer_level(int s, double x, double y, double z, double radiusM,
                       double targetHeightM, double maxCutM, double maxFillM);

void of_observer_latlon_alt(int body, int edits,
                            double lat, double lon, double altM);
                                                // -> f64 scratch [x,y,z]
int  of_streamer_update(int s, double ox, double oy, double oz);  // -> ready count
int  of_streamer_ready_count(int s);
int  of_streamer_evicted_count(int s);
int  of_streamer_generated(int s);              // meshes built this call (<= budget)
int  of_streamer_converged(int s);              // resident set == target set
int  of_streamer_resident_count(int s);
int  of_streamer_on_origin_rebased(int s);      // O(resident) re-anchor cost probe

int  of_streamer_ready_keys(int s);   // -> count; i32 scratch 4/key [face,depth,qx,qy]
int  of_streamer_evicted_keys(int s); // -> count; same layout
```

Defaults if you pass 0: `splitRatio 1.0`, `mergeHysteresis 0.6`, `maxDepth 14`,
`skirtFraction 0.5`. `genBudget` caps meshes built per update (0 = unlimited);
the resident set converges to the same set over several budgeted updates.

`of_observer_latlon_alt` takes lat/lon in **radians** and `altM` **above the
surface oracle**: it returns exactly `dir * (of_surface_radius(body, edits, dir)
+ altM)`, so with an edits handle bound the altitude follows the player's digs.
See [§4.0](#40-surface-authority-which-export-reads-what) for why this is the one
export the audit was opened for.

Per-ready-chunk accessors, indexed `0..readyCount-1`, **valid until the next
`of_streamer_update`**:

```c
int of_chunk_meta(int s, int i);   // -> i32 scratch, 11 ints:
     // [faceId, depth, qx, qy, gridDim, materialId, biome,
     //  contentHashLo, contentHashHi, skirtVertexCount, vertexCount]
int of_chunk_anchor(int s, int i); // -> f64 scratch [cx, cy, cz, chunkRadiusM, skirtDepthM]
int of_chunk_neighbour_depths(int s, int i);  // -> i32 scratch [-X, +X, -Y, +Y]
int of_chunk_positions_f32(int s, int i);     // -> vert count; f32 scratch 3/vert
int of_chunk_normals_f32(int s, int i);
int of_chunk_dirs_f32(int s, int i);
int of_chunk_skirt_f32(int s, int i);
int of_chunk_heights_f64(int s, int i);       // exact, for physics
double of_chunk_max_offset(int s, int i);     // bounding radius, metres
```

`of_chunk_max_offset` is the chunk's **bounding radius**: the largest Euclidean
`|vertex − centre|` over **every vertex the chunk emits, interior grid and skirt
ring**. Pair it with `of_chunk_anchor`'s centre for a bounding sphere, and use it
to bound the float32 quantization of the packed positions (`quantum ≤ r · 2⁻²³`).

Before ABI 2 it returned the largest single-**axis** offset (an L∞ half-extent,
up to √3 short of the radius) over the **interior only**, while the skirt hangs
radially inward and is routinely the furthest geometry: 52,639 m reported for a
depth-3 Forge chunk whose furthest emitted vertex is 108,403 m out. Used as a
bounding sphere that frustum-culled chunks that were on screen. It now equals,
to f32 rounding, the maximum the renderer's own de-interleave loop measures over
the packed buffer, which is what `parity.mjs` CASE 7c asserts.

`of_chunk_anchor`'s centre is the chunk's **64-bit authority position**. The
renderer places the mesh at `centre − floatingOrigin`; the vertex data never
carries the absolute position. This is the mechanism that fixes the planet-scale
precision problem — see [§4.8](#48-the-packed-chunk-vertex-buffer-the-r1-path).

### 4.8 The packed chunk vertex buffer (the R1 path)

**One pre-interleaved, GPU-ready buffer per chunk, written directly into the WASM
heap.** Nothing is traversed element by element across the boundary; the chunk
crosses as a single span you can view and upload.

```c
int of_chunk_packed(int s, int i);      // -> BYTE LENGTH; bytes in the u8 scratch
int of_packed_stride(void);             // 28
int of_packed_vertex_count(void);       // 1217
int of_packed_offset_position(void);    // 0
int of_packed_offset_normal(void);      // 12
int of_packed_offset_uv(void);          // 16
int of_packed_offset_biome(void);       // 20
int of_packed_offset_height(void);      // 24
```

**Layout — 28 bytes per vertex, little-endian:**

| Offset | Type | Attribute | Notes |
|---:|---|---|---|
| 0 | `float32[3]` | position | metres, **relative to `of_chunk_anchor`'s centre** |
| 12 | `int8[4]` | normal | normalized (`n = v/127`); `w` unused, 0 |
| 16 | `uint16[2]` | uv | normalized (`uv = v/65535`), spans the quad |
| 20 | `uint8[4]` | biome | `[biomeId, materialId, hardness*255, flags]` |
| 24 | `float32` | height | relief in metres above the body datum |

`flags` bit 0 = 1 means the vertex belongs to the **skirt** ring.

`kGridDim` is `constexpr 33`, so **every chunk is exactly 1,089 interior + 128
skirt = 1,217 vertices = 34,076 bytes.** Constant size, so JS can pool and reuse
buffers with a fixed stride and never reallocate.

The matching index buffer is built once and reused for every chunk:

```c
int       of_chunk_index_buffer(void);          // -> total index count (6912)
uint16_t* of_chunk_index_ptr(void);
int       of_chunk_interior_index_count(void);  // 6144; skirt is the remaining 768
```

Triangle order per cell, with `a=(i,j) b=(i+1,j) c=(i,j+1) d=(i+1,j+1)`:
`(a,c,b)` then `(b,c,d)`. Interior indices come first so the renderer can draw
interior and skirt as separate ranges.

**Consuming it: de-interleave, do not bind the interleaved buffer directly.**

An earlier revision of this section showed a `THREE.InterleavedBuffer` over the
28-byte stride with one `InterleavedBufferAttribute` per attribute. **That does
not work and never did.** `InterleavedBufferAttribute` takes its GL type from the
*backing array of the shared `InterleavedBuffer`*, not per attribute, so one
buffer cannot carry float32 positions **and** int8 normals **and** uint16 UVs.
Only a single-type layout can be bound that way. The snippet is corrected here
because W1 hit it in practice.

What the client actually ships (`web/src/world/ChunkFormat.ts`,
`web/src/workers/terrain.worker.ts`, `web/src/render/geometry/ChunkGeometryPool.ts`):
the worker copies the packed span out of the heap and **de-interleaves it in one
pass into a single `ArrayBuffer` with five contiguous, 4-byte-aligned sections**
(position f32×3, height f32, uv u16×2, biome u8×4, normal i8×3, int8 last). That
is still exactly **one transferable per chunk**, still a constant size, and the
pass is not wasted work: it also computes the chunk's exact bounding radius while
it is already touching every vertex. The main thread never re-reads the WASM heap
for chunk geometry.

```js
// worker: WASM heap -> one transferable blob (five sections)
const nBytes = M._of_chunk_packed(streamer, i);
const packed = scratchU8(M, nBytes).slice().buffer;   // copy out; also 4-byte aligned
const blob   = new ArrayBuffer(layout.byteLength);
const radius = deinterleave(packed, chunkBlobViews(blob, layout), verts);
postMessage({ ...meta, blob, maxOffsetM: radius }, [blob]);

// main thread: five plain BufferAttributes, pre-allocated once per pool slot
pool.upload(slot, blob, layout, maxOffsetM);   // attr.array.set(section) + needsUpdate
```

The pool allocates every attribute once at construction (`kGridDim` is
`constexpr`, so all chunks are 1,217 vertices), so stream-in is `set` plus
`needsUpdate` with zero allocation and zero `dispose` during play. Interior
indices come first in `of_chunk_index_buffer`, which lets the pool draw the skirt
as a separate range via `setDrawRange`.

**A note on "biome weights":** `/core`'s `biomeAt` is a *hard* classifier — one
biome per direction — so there is no 4-way weight vector to pack. The four bytes
at offset 20 carry `biomeId`, `materialId` and quantized `hardness` instead. A
smooth blend is best derived in the fragment shader from the three corner
`biomeId`s of a triangle using barycentric weights, which is where a blend
belongs. If world-gen later grows a weighted classifier, offset 20 is its slot
and the stride does not change.

### 4.9 Factory / automation

```c
int  of_net_create(double fixedDt);     // 0 -> 1/60
void of_net_destroy(int net);

// Placement -> a per-network build index (JS never sees an EntityHandle).
int of_net_place_miner(int net, double depositAmount, int item,
                       double ratePerSecond, int outCap);
int of_net_place_belt(int net, int tiles, int speed);          // 8 basic .. 32 turbo
int of_net_place_smelter(int net, int ore, int ingot, int craftTicks,
                         int powerW, int outCap);
int of_net_place_assembler(int net, int inA, int countA, int inB, int countB,
                           int out, int outCount, int craftTicks,
                           int powerW, int outCap);
int of_net_connect(int net, int fromBuild, int toBuild, int item);  // item 0 = infer

void   of_net_step(int net);
void   of_net_step_n(int net, double n);
double of_net_tick_index(int net);

double of_net_produced_of(int net, int item);
double of_net_produced_total(int net);
double of_net_miner_remaining(int net, int build);
int    of_net_miner_depleted(int net, int build);
int    of_net_output_buffer(int net, int build);
int    of_net_input_buffer(int net, int build);
int    of_net_input2_buffer(int net, int build);
int    of_net_belt_item_count(int net, int build);
int    of_net_working(int net, int build);          // HUD: is it busy this tick
double of_net_progress01(int net, int build);       // HUD: craft progress [0,1]

// Debug / test helpers.
int of_net_belt_fill_saturated(int net, int belt, int item);
int of_net_feed_machine(int net, int build, int count);
int of_net_units_per_tile(void);                    // 256
```

The §6 render stream:

```c
// One row per live entity. Returns the ROW COUNT and fills BOTH arenas:
//   i32 scratch, 6/row : [Id, TypeId, VisualState, AnimPhase, Lod, BoundRadiusCm]
//   f32 scratch, 3/row : [x, y, z]
int of_net_emit_entity_states(int net);

// One row per belt line — the O(lines) view used at LOD 1+.
//   i32 scratch, 5/row : [LineId, ItemTypeDominant, FlowSpeedQuant, Density, Compressed]
int of_net_emit_belt_flows(int net);

// The ONE O(items) pull, for LOD-0 belts only.
//   i32 scratch, 2/item : [ItemType, UnitOffset]
int of_net_get_line_items(int net, int beltBuild);
```

`VisualState`: `0 idle, 1 working, 2 blocked, 3 no-power`.
`Lod`: `0 near, 1 mid, 2 far, 3 on-rails`.

### 4.10 Determinism diagnostics

Not game API; ~200 bytes, kept exported so a future divergence can be pinned in
minutes instead of bisected.

```c
double of_diag_libm(int fn, double a, double b);
       // 0 sin, 1 cos, 2 tan, 3 asin, 4 acos, 5 atan2, 6 sqrt,
       // 7 floor, 8 fabs, 9 exp, 10 log, 11 pow
int of_diag_scan_quad(int body, int faceId, int depth, uint32_t qx, uint32_t qy);
       // -> vertex count; f64 scratch 8/vertex:
       //    [dirX, dirY, dirZ, latitude, temperature, moisture, rawH, designedH]
       // and i32 scratch 1/vertex: biomeId
```

---

## 5. Threading, instances and COOP/COEP

### 5.1 Recommendation: single-threaded module, one instance per thread

**Do not build with `-sUSE_PTHREADS`.** The v1 recommendation is one
single-threaded WASM instance **per JS thread**:

* **Main thread** — one instance for the synchronous surface oracle (character
  step, aim raycast, build-grid snap) at 1.4–3.8 µs per call.
* **Meshing worker(s)** — one instance each, running the `TerrainStreamer` and
  producing packed chunk buffers.
* **Sim worker** (optional) — one instance running the factory network.

This needs **no `SharedArrayBuffer`, and therefore no COOP/COEP headers at all**.
That matters: `Cross-Origin-Opener-Policy: same-origin` +
`Cross-Origin-Embedder-Policy: require-corp` are required for
`SharedArrayBuffer`, they break third-party embeds and any cross-origin asset
that lacks CORP headers, and they cannot be set on a plain static host without
server config. Avoiding them keeps deployment to "upload the files".

Parallelism is not lost: the work is already coarse-grained per chunk, so N
worker instances scale nearly linearly, and only the finished 34 KB buffers cross
between threads (as transferables).

**Verified:** `test/parity.mjs` Tier 0 creates two independent instances and
asserts they produce identical answers and that a mutation in one is invisible to
the other. Multiple instances are safe with these build flags.

### 5.2 The ownership corollary — plan for it

Each instance has **its own heap**. A voxel dig performed on the main thread is
**not visible** to a worker instance, and vice versa. Recommended model:

* **The main thread owns the authoritative `VoxelEdits`** (it is where digs
  originate, and where the oracle must answer synchronously during a frame).
* Every mutation is appended to an **edit op-log** — the same ops the shim
  already exposes: `dig(center, radius)` and `digCell(cell)`, each a handful of
  numbers.
* Workers receive the op-log by `postMessage` and **replay** it onto their own
  `VoxelEdits` before re-meshing. Replay is exact: the voxel layer is a pure
  function of (body, ordered op list), which the parity test proves bit-for-bit.
* On worker startup or after a long gap, **snapshot instead of replay**:
  `of_edits_serialize` on the main thread, transfer the bytes,
  `of_edits_alloc_bytes` + `of_edits_deserialize` on the worker. The same byte
  stream is what goes to IndexedDB, so there is one format, not two.

Do **not** try to share a `VoxelEdits` across threads. The op-log is smaller than
the state, it is already the persistence format, and it keeps every instance
independently deterministic.

### 5.3 If `SharedArrayBuffer` is ever needed

Set `Cross-Origin-Opener-Policy: same-origin` and
`Cross-Origin-Embedder-Policy: require-corp` on the document, ensure every
cross-origin asset sends `Cross-Origin-Resource-Policy: cross-origin`, and
rebuild with `-sUSE_PTHREADS -sPTHREAD_POOL_SIZE=N`. Nothing in this shim
requires it, and the current design deliberately does not.

---

## 6. Parity — the result of the spike

`node web/wasm/test/parity.mjs` replays a fixed scenario against the WASM build
and diffs it against **`test/expected.json`**, produced by a native **WinLibs
g++ -O2** build of the *same shim* (the toolchain that builds the 22 ctest
suites). Every double is compared as its raw IEEE-754 bit pattern; every array as
a bit-sensitive FNV-1a hash. The native generator re-asserts the ctest invariants
before emitting, and refuses to write a fixture if any of them break.

| Tier | Result | Gating |
|---|---|---|
| **0 — self-determinism** (WASM vs itself) | **29 / 29** | yes |
| **A — cross-toolchain, transcendental-free** | **94 / 94** | yes |
| **B — cross-toolchain, transcendental-dependent** | 147 / 150 | no |

Tier 0 grew from 19 to 29 in the 2026-07-25 surface-authority audit: **CASE 7b**
(the observer equals the oracle position bit-exactly, does *not* equal the raw
one, the raw/designed gap is real, and a dug column lowers the observer by
exactly the derived lowering) and **CASE 7c** (`of_chunk_max_offset` equals the
bound measured over the packed buffer, and the skirt is what sets it). Tier B
grew by the nine fixture-pinned doubles those cases emit; all nine pass.

The audit re-baselined the fixture by exactly three lines, and *what did not
change* is the evidence the fix is scoped: `abi` 1 → 2, the parity observer's
`obsX/Y/Z` (it now sits 514.78 m higher, on the designed surface), and the new
`observer` block. Every streaming update hash, per-chunk content hash, LOD
`keyHash` and both quad-mesh content hashes are byte-identical to before.

### 6.1 Tier 0 — the property that actually matters: PASS

Inside one WASM binary, everything reproduces exactly:

* the same quad regenerated twice → identical heights and identical 64-bit
  content hash;
* **shared quad edges are bit-identical from either neighbour** — the crack-free
  guarantee (WG-6) survives the port;
* two identically-built factory networks stepped 4,000 ticks → identical produced
  counts, miner state, belt occupancy;
* two identical voxel edit sets → identical removed sets, identical
  `surfaceHeight`, identical serialized bytes;
* two independent module instances agree, and their heaps are isolated;
* **the observer position is the surface oracle's, bit-exactly, and provably not
  the raw heightfield's** (CASE 7b, [§4.0](#40-surface-authority-which-export-reads-what)).

This is the property multiplayer determinism and seed-and-diff persistence
require, and every client runs this same binary.

### 6.2 Tier A — cross-toolchain exactness where it is achievable: PASS

Bit-identical to the native build: the **factory sim** in full (all integer /
fixed-point — auto-line end-to-end counts, deposit depletion, the exact
miner-rate case, the entity/belt-flow/line-item render streams), **voxel** cell
ids, dig counts, exposed-face sets and the dirty AABB, the **persistence byte
stream**, **LOD quad selection** (the resident key set at every update), chunk
shapes and vertex counts, and the index buffer.

### 6.3 Tier B — the honest caveat, fully diagnosed

Three checks diverge, and they all trace to **one** root cause. `test/diag.mjs`
isolates it:

```
libm probe (1 ULP worst case)   sin, cos, tan, atan2, exp DIFFER
                                asin, acos, sqrt, floor, fabs, log, pow identical

tan() over the cube-sphere lattice arguments, per LOD level:
  L0..L7  0 differ        L8  6/257        L9..L14  16/513 each
  TOTAL 102/3598 lattice directions differ (2.83%) by 1 ULP

terrain pipeline over the 48 quads the streamer built (52,272 vertices):
  dirX/Y/Z            0.6-1.2%  (worst 2 ULP)
  rawHeight           1.73%     (worst 2781 ULP)
  designedHeight      1.81%     (worst 3337 ULP)
  biome (classify)    0.00%
```

**What is happening.** `cubed_sphere.h`'s `warp()` is `std::tan(s·π/4)`, and
`unitDir` is the sole producer of every sampled direction. `biome.h` adds
`asin`/`atan2`/`cos`. None of those are bit-specified by IEEE-754, so mingw-w64's
libm and emscripten's musl libm differ by 1 ULP at ~2.8% of the arguments the
lattice actually uses. Because height is **position-hashed from the direction's
raw double bits** (WG-6, deliberately — that is what makes shared edges
bit-identical), a 1-ULP direction difference does not produce a 1-ULP height
difference; it produces a **completely unrelated height**. Hence 2 ULP in,
~3,000 ULP out, at ~1.7% of vertices, which makes about half of streamed chunks
differ somewhere.

**What it means.** Both builds are internally perfect. They simply grow slightly
different planets from the same seed. For a browser-only game this is a
non-issue: there is one binary, every client agrees with every other client, and
saves are portable because the seed-and-diff model regenerates from that same
binary. It would matter only if a **native** process ever had to share world
state with browser clients (a native dedicated server, or a native tool that
pre-bakes world content).

**The fix, if that day comes.** The determinism-critical libm surface is exactly
four functions: `tan` (in `warp`), `asin` + `atan2` (in `dirToLatLon`), `cos` (in
`temperatureAt`). Every other operation in the noise stack is
`floor`/`fabs`/`sqrt`/multiply/add, all of which are bit-exact across both
toolchains (measured, not assumed). Vendoring fixed implementations of those four
into `/core` makes all toolchains agree. It is a `/core` change and therefore an
Admin decision, because it shifts the seed→world mapping once and re-baselines
any pinned world content.

**Recommendation: accept it. Declare the WASM build the single canonical target
for world generation.** Note it in the core-engine decision log rather than
paying the `/core` change now.

### 6.4 Are `float64` values crossing to JS exact?

**Yes, exactly.** A WASM `f64` and a JS `Number` are the same IEEE-754
double-precision value; there is no conversion, no rounding, no intermediate
`float`. The parity test relies on this: it reads returned doubles into JS,
re-encodes their bits with a `DataView`, and compares 16-hex-digit strings
against the native fixture. 138 such comparisons match bit-for-bit. Passing a
double *into* WASM is equally exact.

Two caveats that are about JS, not WASM: integers above 2^53 lose precision as
`Number` (which is why 64-bit hashes use the lo/hi pair), and JSON round-tripping
a double through `toString` is only safe at 17 significant digits (which is why
the fixture stores hex bit patterns).

### 6.5 Where precision *is* lost, and why it is fine

The **packed vertex buffer** stores positions as `float32`. That is a real
precision reduction, and it is exactly where the UE version repeatedly broke.
The fix is the per-chunk 64-bit anchor: positions are stored **relative to the
chunk centre**, so the magnitude is bounded by the chunk extent rather than the
600 km body radius. Measured:

| LOD depth | chunk extent | float32 quantum |
|---:|---:|---:|
| 0 | 427.1 km | 50.9 mm |
| 1 | 221.4 km | 26.4 mm |
| 2 | 120.9 km | 14.4 mm |
| 3 | 65.1 km | 7.8 mm |
| 4 | 32.3 km | 3.9 mm |
| 5 | 15.4 km | 1.8 mm |
| 6 | 7.7 km | 0.9 mm |

The relative precision is a constant 2^-23 of the chunk extent, so a chunk is
only ever coarse when it is far away — at walking LOD it is sub-millimetre. For
comparison, **absolute** `float32` at Forge's 600 km radius would be 71.5 mm
*everywhere*, including under the player's feet. That is the failure mode the
anchor removes.

Nothing else in the packed path loses meaningful precision: the normal is
`int8`-normalized (~0.45° worst case, invisible after interpolation), uv is
`uint16` (1/65535 of a quad), and `height` is `float32` relief in metres
(~0.5 mm at a 6 km maximum relief). **The exact doubles remain available** via
`of_chunk_heights_f64` and `of_quadmesh_positions_f64` for physics and collision,
and via the surface oracle for anything that must agree with the simulation.

---

## 7. Benchmarks

Node v22.14.0, emscripten 6.0.4 `-O3`, vs the same loops through the same C API
in a native WinLibs g++ `-O2` build. Both sides include the shim's staging work,
so the ratio is what the browser really pays.

| Path | WASM | Native | Ratio |
|---|---:|---:|---:|
| Quad-mesh generation | 5.46e5 verts/s | 5.81e5 verts/s | **94.0%** |
| Factory sim | 2.09e7 ticks/s | 2.55e7 ticks/s | **81.8%** |
| Voxel dig + exposed faces | 1.90e4 faces/s | 3.08e4 faces/s | 61.6% * |

\* single-shot measurement of one dig plus one `exposedFaces` call; noisier than
the other two rows and dominated by `unordered_set` behaviour rather than float
math. Treat it as indicative.

Context: the `core/tools/procgen_bench` figure of ~2.39 M verts/s measures the
**bare noise sampler** in isolation. The 5.5e5 verts/s here is the *whole*
`generateQuadMesh` including the designed-biome base, per-vertex normals, the
bounding radius pass and f32 staging — a different, more honest unit of work.
The number that matters for streaming is the per-chunk cost below.

### 7.1 R1 gate — streamed chunk to GPU-ready buffer

| Stage | ms / chunk |
|---|---:|
| `buildChunk` (designed heights + normals + skirt) | 2.00 |
| Pack into the 28 B/vertex interleaved buffer | 1.39 |
| **TOTAL** | **3.39** |

**Gate is ≤ 12 ms per chunk → PASS with 3.5× headroom.**

Buffer: 34,076 B = 1,217 verts × 28 B (33.3 KiB), **constant per chunk, so it is
poolable**. Index buffer: 6,912 `uint16` (6,144 interior + 768 skirt), built once
and shared by every chunk.

At 3.39 ms/chunk a single meshing worker sustains ~295 chunks/s; the streamer's
default `genBudget` of 16 chunks per update is ~54 ms of work, which is why it
belongs in a worker and why the budget exists. Two workers comfortably cover a
fast descent.

### 7.2 Main-thread surface oracle (synchronous, inside the frame)

| Call | ns | µs |
|---|---:|---:|
| `baseHeight(body, dir)` | 1,834 | 1.83 |
| `surfaceHeight(body, edits, dir)` | 3,746 | 3.75 |
| `biomeAt(body, dir)` | 1,451 | 1.45 |
| `solidAt(body, edits, pos)` | 2,054 | 2.05 |
| `solidCell(body, edits, cell)` | 2,022 | 2.02 |

**All single-digit microseconds → target met.** A 60 Hz frame is 16,667 µs, so a
character step plus a handful of aim/placement probes (say 20 oracle calls) costs
~0.05 ms, about 0.3% of the frame. No allocation per call, no `postMessage`, no
async.

`surfaceHeight` is the most expensive because with edits bound it walks the
column downward one metre at a time looking for the top-anchored open run; the
undug path short-circuits to `baseHeight`. If a future build needs many hundreds
of oracle calls per frame, the cheap win is caching `baseHeight` per direction —
it is a pure function.

---

## 8. Build reproducibility

Flags that are load-bearing for determinism, pinned in `web/wasm/build.ps1`:

* **`-O3`, and `-ffast-math` is OFF everywhere.** The entire determinism story
  rests on strict IEEE-754 doubles, because position-hashing reinterprets a
  double's bits. `-ffast-math` would silently destroy it.
* **`-ffp-contract=off`.** Forbids FMA contraction so an expression can never be
  rounded once instead of twice. Harmless on WASM MVP today (no scalar `f64`
  FMA), pinned so a future relaxed-SIMD backend cannot change results silently.
* **`-fno-rtti`.** Nothing uses `dynamic_cast`/`typeid`; saves ~10 KB.
* **`-sFILESYSTEM=0`.** No FS glue. `persistence_file.h` is excluded.

There is no x87 concern: WASM has no 80-bit extended precision, and the native
x86-64 baseline uses SSE2 for doubles. The 64-bit position-hash path
(`bitsOf`/`mix64`/`hashCombine`) is pure integer arithmetic and was verified
bit-identical across both toolchains.

---

## 9. Verdict and open items

**The WASM core is viable. The pivot keeps the simulation.**

* All 22 ctest suites' subject code runs unmodified in the browser.
* Self-determinism, crack-free seams, tunnel/ceiling semantics, exact factory
  arithmetic and the persistence byte stream all hold, bit-for-bit.
* Performance is 82–94% of native on the hot paths, and the chunk-delivery gate
  passes with 3.5× headroom.
* No COOP/COEP headers required.

Open items for Admin:

1. **Decide on the cross-toolchain libm delta** ([§6.3](#63-tier-b--the-honest-caveat-fully-diagnosed)).
   Recommendation: accept it, declare WASM the canonical world-gen target, log it
   as a core-engine decision. Revisit only if a native peer is ever planned.
2. **`persistence_file.h` replacement.** `persistence.h` works; something on the
   JS side must own IndexedDB/OPFS storage of its byte streams. That is a
   persistence-domain task, not a core one.
3. **Op-log plumbing** between the main-thread `VoxelEdits` and worker instances
   ([§5.2](#52-the-ownership-corollary--plan-for-it)) is a renderer/networking
   integration task; the shim provides everything it needs.
4. **ABI 2 requires a two-line client change** (W2): bump `OF_ABI_VERSION` in
   `web/src/sim/wasm/OfCore.ts` to `2`, and update the
   `_of_observer_latlon_alt(body, edits, lat, lon, altM)` declaration in
   `web/src/sim/wasm/heap.ts`. Until then `loadOfCore` throws on the version
   check, which is the intended loud failure.

### 9.1 Process finding from the 2026-07-25 audit

[DECISIONS.md](DECISIONS.md) standing rule 1 ("one surface authority; no module
re-derives terrain height") was written, and the very next component built
against it (this bridge) broke it in three places on the first pass, including
one that put the player 2.4 km underground. A rule in a document is not a
control. Every authority-sensitive contract now needs an executable guard that
fails the build, which is what CASE 7b/7c are. The pattern worth copying: assert
the positive identity **and** the negative one, so the test cannot start passing
because both sides quietly became the same wrong thing.
