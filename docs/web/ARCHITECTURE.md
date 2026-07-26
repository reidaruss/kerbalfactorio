# Orbital Foundry · Web Rendering & Engine Architecture

> **Owner:** rendering-controller (Rendering Architect) · **Reports to:** Admin Master Controller
> **Date:** 2026-07-25 · **Status:** design of record for the `web/` client, pending Admin approval
> **Scope:** the browser client only. `/core` (22 headers, 22 green ctest suites) is unchanged and is the sim authority.
> **Read alongside:** [MASTER_PLAN](../MASTER_PLAN.md) · [RETHINK](../review-2026-06-16/RETHINK.md) · [ue-architecture-audit](../review-2026-06-16/ue-architecture-audit.md) · [rendering.md](../controllers/rendering.md) · `docs/web/ASSET-SPECS.md` (parallel agent)

---

## 0. Executive summary

Ten things, then the detail.

1. **Stack:** three.js **r185** (`three@0.185.1`, released 2026-07-01) + TypeScript + Vite 8.1.5, rendered by **`WebGLRenderer` (WebGL 2)**, behind a one-file renderer seam so a WebGPU swap is a milestone and not a rewrite. Verified below (§1).
2. **Depth:** the D3 "logarithmic depth" clause is **challenged**. three r185 ships `reversedDepthBuffer` (`EXT_clip_control`, 86.05% of WebGL2 users) which its own docs call "a more faster and accurate version than logarithmic depth buffer". Log depth costs Early-Z, breaks MSAA, and needs shader chunks in every custom material. We use a **4-pass camera ladder** as the primary fix and reversed-Z (log-depth fallback) as belt and braces (§3).
3. **Scaled space:** not two scenes but **four passes** (sky · far scaled · near 1:1 · view model), depth cleared between. Each camera sees at most ~6 decades of range.
4. **The god-object antidote is structural:** ~50 named modules with one responsibility each, a **400-line hard CI cap per file**, an eslint layering gate, and **exactly one `OriginRebased` broadcast** with one subscriber contract (the UE layer had four hand-rolled `Reanchor*` copies in one 2,511-line class).
5. **No ECS library and no JS-side entity store.** `/core` owns entities. The JS side owns *views*: pooled `Float32Array` instance rows keyed by sim id. A second entity store is the duplication that killed the UE layer.
6. **`BatchedMesh` is the workhorse**, not `InstancedMesh`. Verified API: `setGeometryIdAt(instanceId, geometryId)` swaps geometry per instance inside one draw call, which **is** our LOD ladder, and `perObjectFrustumCulled` defaults true (`InstancedMesh` culls only as a whole). Target: the entire factory in 3 to 6 draw calls (§6).
7. **Terrain exploits a structural gift:** `kGridDim` is a compile-time constant 33, so every chunk is exactly 1089 + 128 vertices. That makes **fixed-size geometry pooling with zero reallocation** and **one shared index buffer for all chunks** possible (§4).
8. **The D4 SharedArrayBuffer clause is challenged.** Transferable `ArrayBuffer`s cover every worker path we actually have. COOP/COEP breaks all cross-origin subresources, blocks OAuth popups, and Emscripten pthreads + `ALLOW_MEMORY_GROWTH` is documented slow. Ship without cross-origin isolation; add it only if a measurement demands it (§2.5).
9. **No physics engine for the player.** A kinematic capsule against the `/core` surface oracle plus `solidCell` is O(1), deterministic, double-precision, floating-origin-safe, and cannot disagree with the visual surface. That is the entire point of D-011 (§8).
10. **Performance headline: 1080p60 on a GTX 1660 class GPU at ≤ 150 draw calls (300 alert / 500 fail), ≤ 2.7 M triangles, ≤ 135k instances, ≤ 260 MB VRAM, ≤ 4 MB/frame worker traffic, p99 frame ≤ 25 ms** (§10).

---

## 1. Verified stack (web research, 2026-07-25)

Everything in this section was read from a primary source during this design pass. Nothing here is from memory.

### 1.1 three.js

| Fact | Value | Source |
|---|---|---|
| Current release | **r185, 2026-07-01**; npm `three@0.185.1` | `api.github.com/repos/mrdoob/three.js/releases`, `registry.npmjs.org/three/latest` |
| Addon import path | `three/addons/*` maps to `examples/jsm/*` in package `exports` (both forms work; `three/addons/` is what the sources' own `@three_import` lines use) | `registry.npmjs.org/three/latest` |
| Docs URL shape | `https://threejs.org/docs/pages/<Class>.html` (old `docs/examples/en/...` 404s) | threejs.org |
| `WebGLRenderer` | **WebGL 2 only since r163.** Not deprecated, no deprecation notice in r185 docs | `threejs.org/docs/pages/WebGLRenderer.html` |
| `logarithmicDepthBuffer` | Still present, default `false`. Docs: "uses `gl_FragDepth` if available which **disables the Early Fragment Test optimization and can cause a decrease in performance**" | same |
| `reversedDepthBuffer` | Present, default `false`. Docs: "Requires the `EXT_clip_control` extension. **This is a more faster and accurate version than logarithmic depth buffer.**" Also exposed read-only on `renderer.capabilities` | same |
| `EXT_clip_control` reach | **86.05% overall.** Windows 91.98% · macOS 92.39% · iOS 97.89% · Linux 74.9% · Android 55.32% | `web3dsurvey.com/webgl2/extensions/EXT_clip_control` |
| `BatchedMesh` | **Stable.** `new BatchedMesh(maxInstanceCount, maxVertexCount, maxIndexCount, material)`. `addGeometry` · `addInstance` · **`setGeometryIdAt(instanceId, geometryId)`** · `deleteGeometry` · `setGeometryAt` · `setInstanceCount` · `setVisibleAt` · `setColorAt` · `setMatrixAt` · `optimize()` · `setCustomSort()`. `perObjectFrustumCulled` default `true`, `sortObjects` default `true`. **Limitation: negatively scaled matrices unsupported** | `threejs.org/docs/pages/BatchedMesh.html` |
| `InstancedMesh` | `instanceMatrix` · `instanceColor` · `morphTexture` · `count`. Custom per-instance data needs an `InstancedBufferAttribute` on the geometry. Culled as a whole, not per instance | `threejs.org/docs/pages/InstancedMesh.html` |
| CSM | **`three/addons/csm/CSM.js`** (+ `CSMFrustum.js`, `CSMHelper.js`, `CSMShader.js`). **WebGLRenderer only**; `CSMShadowNode.js` is the WebGPURenderer counterpart. 3 cascades default | `threejs.org/docs/pages/CSM.html`, unpkg `three@0.185.1/examples/jsm/csm` |
| Sky / water addons | `three/addons/objects/Sky.js` (9.94 kB, Preetham), `SkyMesh.js` (11.1 kB, node/TSL variant), `Water.js`, `WaterMesh.js`, `GroundedSkybox.js`, `Lensflare.js` | unpkg `three@0.185.1/examples/jsm/objects` |
| Post-processing | **`PostProcessing` deprecated since r183**, renamed to **`RenderPipeline`** (node-based, WebGPU-first with WebGL2 fallback). `EffectComposer` still exists and targets `WebGLRenderer` only | `threejs.org/docs/pages/PostProcessing.html` |
| r185 notes | WebGPU **ClusteredLighting (Forward+)** added; `Matrix3.scale/rotate/translate` deprecated; `DRACOLoader.setDecoderConfig` deprecated; fixes for reversed-depth render-list sorting and log-depth point shadows | `github.com/mrdoob/three.js/releases/tag/r185` |
| TypeScript types | `@types/three@0.184.1`, one minor behind r185. WebGPU types now come from TypeScript 6 | `npmjs.com/package/@types/three` |

### 1.2 Renderer choice: WebGL 2, with a seam

`WebGPURenderer` (`three/webgpu`) does auto-fall back to WebGL 2 and takes `forceWebGL`, `logarithmicDepthBuffer`, `reversedDepthBuffer`, `antialias`, `samples`, `multiview`. It requires `await renderer.init()`. Its own r185 doc page calls it "the new alternative of `WebGLRenderer`" and **does not state it is stable or production-ready**.

Against adopting it now:

- **Reach.** WebGPU is at **83.63%** global usage (caniuse), and MDN still classifies the `GPU` interface as **"Limited availability, not Baseline"**. WebGL 2 is **94.67%**. Firefox only reached Apple Silicon macOS in v147 (Jan 2026) and Linux is still rolling out on both Chromium and Firefox.
- **Measured regressions exist.** three.js issue **#31055** ("The performance of the WebGPU Renderer is much slower than WebGL", ~10x on 3,000 unbatched meshes) was closed as a duplicate of **#30560**, which is the open tracker. The WebGPU backend is not uniformly faster.
- **Shader substrate.** Custom shading on `WebGPURenderer` means TSL. We are an agent-written codebase; GLSL + `ShaderMaterial` + `onBeforeCompile` has a decade of training corpus, TSL has about one year. That is a direct velocity argument, and velocity is the reason for this whole pivot.
- **Our bottleneck is not draw submission.** WebGPU's headline win is CPU draw-call overhead. We batch everything (§6), so we are budgeted at ≤ 150 draws. We are vertex, fill and worker-CPU bound, not submission bound.

For adopting it later: **ClusteredLighting (Forward+), new in r185, WebGPU only.** That is the one feature that flips the decision, because tunnel lamps, furnace glow and factory emissives are exactly the many-small-lights case WebGL 2 forward rendering handles badly.

**Call:** ship `WebGLRenderer` for W0 through W7. Contain the swap cost:

- `src/render/Renderer.ts` is the **only** file that names a concrete renderer class. Everything else takes an `OFRenderer` interface (`render(scene, cam)`, `clearDepth()`, `caps`, `info`).
- **Custom shading is capped at 5 shaders**: `TerrainMaterial`, `VoxelMaterial`, `BeltFlowMaterial`, `SkyAtmosphere`, `StarfieldMaterial`. Everything else uses stock `MeshStandardMaterial` / `MeshPhysicalMaterial`, which have TSL equivalents for free.
- The migration is therefore a bounded, one-milestone job: 5 GLSL shaders to TSL, `CSM.js` to `CSMShadowNode.js`, `EffectComposer` to `RenderPipeline`. **Re-evaluate at W6 (factory lighting).**

### 1.3 Supporting libraries

| Package | Version | Note |
|---|---|---|
| `vite` | **8.1.5** (needs Node `^20.19` or `>=22.12`) | `server.headers` is the COOP/COEP mechanism. `vite-plugin-cross-origin-isolation` is **dead** (0.1.6, last published 2022-02-03), do not use |
| `meshoptimizer` | **1.2.0** (2026-06-30) | decoder at `meshoptimizer/decoder`; SIMD path runs 1 to 3 GB/s |
| `gltfpack` | 1.2.0 | **Gotcha: the npm/WASM build cannot do `-tc` (KTX2).** Texture compression needs a native binary |
| `@gltf-transform/cli` | **4.4.1** | Bundles `draco3dgltf`, `meshoptimizer`, `ktx-parse`, `sharp`. **No separate KTX-Software install.** This is why it wins over gltfpack for us |
| `three-mesh-bvh` | **0.9.10** (2026-05-13) | `computeBoundsTree` / `acceleratedRaycast`. Not dynamic; use `refit()` when vertices move |
| `@dimforge/rapier3d` | **0.19.3** | wasm 1.57 MB + 211 kB glue. **Since 0.15.0 the plain build has enhanced-determinism OFF**; use `rapier3d-deterministic` if determinism matters. `-simd` variants exist |
| `jolt-physics` | 1.1.0 (2026-07-11) | Live alternative |
| Emscripten | **6.0.4** (2026-07-24) | `WASM_BIGINT` now defaults **true**. `MODULARIZE` requires `EXPORT_ES6`. **pthreads + `ALLOW_MEMORY_GROWTH` is documented slow** |
| WASM SIMD | **93.57%** (Chrome 91+, FF 89+, Safari 16.4+) | `-msimd128` is safe to assume |
| wasm memory64 | 70.5%, **no Safari at all** | Do not ship |
| `SharedArrayBuffer` | 93.97%, but gated behind COOP/COEP everywhere | See §2.5 |
| `OffscreenCanvas` | 93.83% (Safari **17.0+**) | three supports worker rendering (`webgl_worker_offscreencanvas`) with an `ElementProxy` pattern for input. **Not adopted**, see §2.6 |

---

## 2. Engine skeleton

### 2.1 Module layout

```
web/
  index.html                     # canvas + the HTML/CSS UI root. No game logic.
  vite.config.ts
  package.json                   # three@0.185.1, @types/three@0.184.1 pinned exactly
  public/
    wasm/of_core.{js,wasm}       # Emscripten build of /core (D1)
    basis/basis_transcoder.{js,wasm}   # 57.5 kB + 527 kB, SELF-HOSTED
    draco/                              # only if Draco is used at all (§9)
    assets/                             # .glb + .ktx2
  src/
    main.ts                      # COMPOSITION ROOT ONLY. Constructs, wires, starts. Zero logic. Cap: 120 lines.
    app/
      Loop.ts                    # fixed sim tick + render interpolation (of::SimClock semantics)
      Services.ts                # explicit typed dependency record. No global singletons, ever.
      Config.ts                  # seed, quality tier, tunables, URL param parsing
      Events.ts                  # typed pub/sub. OriginRebased, SoiChanged, ChunkReady, DigApplied, RegimeChanged
      Debug.ts                   # builds window.__of. The agent-facing API (§11)
    render/
      Renderer.ts                # owns THREE.WebGLRenderer + canvas + resize + caps probe. NOTHING else.
      Frame.ts                   # the 4-pass compositor. Owns clear order and only that.
      CameraRig.ts               # sky/far/near/viewmodel cameras. Sole owner of every camera.
      Scenes.ts                  # the 3 THREE.Scene handles + LAYER constants
      DepthPolicy.ts             # reversed-Z vs log-depth probe; exports the shader prelude every custom material must include
      Quality.ts                 # low/med/high tier -> concrete knobs (shadow res, foliage density, postfx)
      materials/                 # THE FIVE custom shaders, and no more
        TerrainMaterial.ts  VoxelMaterial.ts  BeltFlowMaterial.ts
        SkyAtmosphere.ts    StarfieldMaterial.ts
      instancing/
        InstancePool.ts          # BatchedMesh/InstancedMesh pool + free list + id->slot map
        LodLadder.ts             # screen-space size -> of::render_cost LodBand, with hysteresis
        GeometrySet.ts           # per-type LOD0/1/2 geometry ids registered into a BatchedMesh
      geometry/
        ChunkGeometryPool.ts     # fixed-size 1089+128 vert pool, zero realloc (§4.3)
        SharedIndex.ts           # THE one 33x33 + skirt index buffer, shared by every chunk
      postfx/PostFX.ts           # EffectComposer chain, quality-gated, off on low
      debug/StatsProbe.ts        # renderer.info + performance marks -> ring buffer
    sim/
      wasm/OfCore.ts             # THE ONLY module that touches the Emscripten Module object
      wasm/heap.ts               # typed-array views over the WASM heap; re-acquired after growth
      SimBridge.ts               # main-thread facade over the worker pool. Request/response typing.
      SimClock.ts                # mirrors of::SimClock (fixedDt 1/60, advance/alpha/tickIndex)
      Snapshot.ts                # double-buffered SoA state + interpolation
      OpLog.ts                   # append-only voxel/build op log, mirrored to every worker (§2.4)
    world/
      PlanetBody.ts              # BodyParams + FrameId. The one body-constant reader (D-006).
      FloatingOrigin.ts          # mirrors of::FloatingOrigin. THE ONE rebase authority. Emits ONE event.
      SurfaceOracle.ts           # sync typed wrapper over surfaceHeight / solidCell / baseHeight / biomeAt
      TerrainStream.ts           # terrain.worker client. Emits ChunkReady / ChunkEvicted.
      ChunkView.ts               # TerrainChunk payload -> pooled BufferGeometry -> Mesh. Re-anchors on rebase.
      VoxelField.ts              # dig intents -> op log -> voxel.worker; owns the dirty region
      VoxelView.ts               # greedy-mesh payload -> BufferGeometry. Re-anchors on rebase.
      Scatter.ts                 # ONE global angular lattice. Serves foliage AND resource nodes. (RETHINK R2)
      Regime.ts                  # SURFACE / ASCENT / ORBIT band + the continuous blend factors (§3.5)
    player/
      Input.ts                   # DOM/pointer-lock -> an input tape. Scriptable for tests.
      Controller.ts              # input tape -> movement intent. No physics, no camera.
      KinematicBody.ts           # capsule vs surface oracle + solidCell. No physics engine. (§8)
      ViewMode.ts                # FP/TP state, yaw/pitch authority, spring arm, aim preservation (§3.4)
      Interaction.ts             # aim ray -> dig / harvest / place intent. Emits, never applies.
      ViewModel.ts               # FP arms/tool in the 4th pass
    factory/
      FactoryView.ts             # of::factory §6 entity stream -> BatchedMesh instance rows
      BeltView.ts                # LOD-0 discrete items vs LOD-1 flow material (RN-3)
      BuildPreview.ts            # grid snap + ghost + validity
    ui/                          # HTML/CSS overlay. ZERO three.js imports (eslint-enforced).
      Hud.ts Inventory.ts Crafting.ts Research.ts BuildBar.ts Menu.ts
      styles/*.css
    assets/
      Registry.ts                # THE one id -> {glb, lods, material, footprint} lookup
      Loaders.ts                 # GLTFLoader + KTX2Loader + MeshoptDecoder wiring, once
      Streaming.ts               # priority queue, <=2 concurrent, 4 ms/frame decode budget
    gen/
      ids.ts                     # GENERATED from /core at build time. Never hand-edited. (§9.4)
  workers/
    terrain.worker.ts            # WASM TerrainStreamer + buildChunk -> packed transferables
    voxel.worker.ts              # WASM VoxelEdits + exposedFaces -> greedy mesh -> transferables
    factory.worker.ts            # WASM FactorySim at 60 UPS -> §6 delta stream
  tools/
    smoke/                       # Playwright scenarios, input tapes, golden images
```

### 2.2 The anti-god-object rules (CI-enforced, not advisory)

The UE failure was one 2,511-line class holding ten responsibilities, four copies of the same re-anchor logic, and a second god object forming at 1,330 lines. These rules exist to make that structurally impossible.

1. **400 lines hard cap per file** (250 preferred), enforced by a CI script. A file that needs more is two files.
2. **One authority per fact.** `FloatingOrigin` is the only rebase authority. `SurfaceOracle` is the only surface answer. `CameraRig` is the only camera owner. `Registry` is the only asset lookup. `DepthPolicy` is the only depth-policy source. Adding a second is a review-blocking bug.
3. **No module both simulates and renders.** `world/*` and `sim/*` produce data. `render/*` consumes it. `render/` may not import from `player/` or `factory/`; those push data down through `Events`.
4. **`ui/` imports zero three.js.** eslint `no-restricted-imports` on `three` under `src/ui/**`. This is the UMG win made permanent.
5. **One rebase contract.** Every world-anchored system implements `onOriginRebased(delta: Vector3): void` and subscribes once. There is exactly one broadcast site (§3.6). Four hand-rolled `Reanchor*` copies cannot recur because there is one interface to implement.
6. **No `new` in the steady-state frame path.** Vectors, matrices and buffers are pooled or preallocated. Enforced by a heap-growth assertion in the smoke suite.
7. **Integration pass after every 3 feature milestones** (RETHINK §5.2). God-object growth is a blocker, not a smell.
8. **No game rules in TypeScript.** Any new simulation rule goes into `/core` with a ctest. `src/sim/` may contain marshalling and nothing else. This is the single most important rule in the document.

### 2.3 The frame loop

`of::SimClock` semantics: `fixedDt = 1/60`, `advance(wallDt)` returns the number of elapsed fixed ticks, `alpha()` is the render interpolation factor, `tickIndex()` is the determinism key.

Three clocks, deliberately:

| Clock | Rate | Owner | Determinism key |
|---|---|---|---|
| **Player/interaction** | fixed 60 Hz, main thread | `app/Loop.ts` + `sim/SimClock.ts` | tick index |
| **Factory sim** | fixed 60 UPS, `factory.worker` | worker-side `of::SimClock` | tick index, authoritative |
| **Render** | vsync (variable) | `render/Frame.ts` | interpolates with `alpha()` |

```
frame(now):
  dt = min(now - last, 0.25)            # clamp the spiral of death
  ticks = clock.advance(dt)             # of::SimClock
  for i in 0 .. min(ticks, 5):          # cap catch-up; never block a frame
      input.sample(tickIndex)
      player.step(fixedDt)              # KinematicBody vs SurfaceOracle (sync WASM)
      floatingOrigin.maybeRebase()      # -> at most ONE OriginRebased event
      simBridge.postIntents(tickIndex)  # dig/build/move intents to workers
  alpha = clock.alpha()
  simBridge.drain()                     # apply worker payloads: chunks, voxel mesh, factory deltas
  snapshot.interpolate(alpha)           # SoA prev/curr -> instance matrices
  viewMode.update(dt)                   # camera smoothing, variable rate on purpose
  frame.render()                        # the 4 passes (§3.1)
  stats.sample()
```

Why the player runs on the main thread and not in a worker: the character step is one capsule against a pure analytic function, roughly 20 microseconds. Putting it in a worker adds a round trip of input latency for zero gain, and it would force the surface oracle to be async, which would poison every raycast and placement query. The factory sim is the opposite (expensive, tolerant of a frame of latency), so it goes in a worker.

### 2.4 Sim state ownership, and the op log

`/core` owns entity state. The JS side never holds a second copy of a game entity.

The one piece of mutable sim state that main thread **and** workers both need is the voxel edit set, because `surfaceHeight(body, dir, voxelEdits)` and `solidCell` both take it and the character step needs both synchronously. `std::unordered_set<uint64_t>` cannot be shared across WASM heaps.

**Solution: an append-only op log.** A dig is `{tick, kind: 'dig', centre: Vec3, radius: number}`. `sim/OpLog.ts` appends and broadcasts; the main-thread WASM instance and both terrain/voxel workers apply the same ops in the same tick order. Because `VoxelEdits::dig` is a pure deterministic function of `(body, centre, radius)` and the removed set is a set (order-independent), every instance converges bit-identically.

Three payoffs: it is the save format (matches `VoxelEdits::serialize`), it is the replication format (RETHINK already notes voxel edits are replication-friendly), and it makes multi-instance WASM safe by construction rather than by discipline.

### 2.5 Challenge to D4: no SharedArrayBuffer, no cross-origin isolation

D4 says "transferables and/or SharedArrayBuffer (COOP/COEP headers via a Vite plugin)". Recommend **transferables only**.

Evidence:

- The plugin named in D4 does not exist in maintained form: `vite-plugin-cross-origin-isolation` is at **0.1.6, last published 2022-02-03**. The supported path is two lines of `server.headers`, which only covers `vite dev` (production hosting needs the same headers independently, and `preview.headers` separately).
- COOP/COEP **breaks every cross-origin subresource** unless it sends `Cross-Origin-Resource-Policy` or is CORS-loaded. That means CDN-hosted three builds, jsDelivr basis/draco transcoders and texture CDNs all fail. It also, per web.dev, "will break integrations that require cross-origin window interactions such as OAuth and payments", which forecloses a login story later.
- Emscripten's own docs: pthreads **plus** `ALLOW_MEMORY_GROWTH` "currently causes JS accessing the Wasm memory to be slow" and forces HEAP view re-acquisition after every growth. Our terrain worker grows memory constantly.
- **We have no workload that needs it.** Every worker path is one-directional bulk handoff: geometry buffers worker to main (transferable, zero copy), intents main to worker (tiny). rendering.md's own RC-8 analysis puts the factory delta stream at "single-digit MB/s", which is not worth a deployment-wide constraint.
- Practical: itch.io, GitHub Pages and most static hosts do not let you set response headers. Not requiring isolation keeps every cheap hosting option open, which matters for playtest builds.

**Consequence to accept:** we self-host `basis_transcoder.{js,wasm}` anyway (good practice regardless), and `-pthread` is off in the Emscripten build. Revisit only if a profile shows a measured copy cost above 1 ms/frame.

### 2.6 Not adopting: OffscreenCanvas rendering in a worker

three supports it (`webgl_worker_offscreencanvas`, an official manual page). We are not using it in v1. Reasons: Safari only reached `OffscreenCanvas` at 17.0, the worker has no DOM so `OrbitControls`-style input needs the `ElementProxy` shim, and our HTML/CSS UI overlay (D2's big win) sits on the main thread anyway. The main thread's job is already thin (1.5 ms budget). Revisit if main-thread JS ever exceeds 4 ms.

---

## 3. Scaled space, cameras, depth, regimes

### 3.1 Four passes, one canvas

D3 says dual camera. The honest count is four, because the FP view model and the star field each need their own depth range and each is trivially cheap.

| # | Pass | Scene | Camera | near / far | Depth | Contents |
|---|---|---|---|---|---|---|
| 1 | **Sky** | `skyScene` | `skyCam` (rotation only, no translation) | 0.1 / 10 | write off, test off | star `Points`, sun disc, `SkyAtmosphere` full-screen quad |
| 2 | **Far scaled** | `farScene` | `farCam`, scale **1e-5 units/m** | 0.01 / 1e5 | own buffer, **cleared after** | planet + moon proxies, coarse terrain shell (chunk depth < cutoff), distant vessels, orbit lines |
| 3 | **Near 1:1** | `nearScene` | `nearCam`, metres, floating origin | **0.1** / 1e5 | own buffer, **cleared after** | fine terrain chunks, voxel near-field, foliage, factory, props, TP character |
| 4 | **View model** | `vmScene` | `vmCam`, FOV 60 | 0.01 / 5 | own buffer | FP arms + held tool (FP only) |
| 5 | **UI** | DOM | n/a | n/a | n/a | HTML/CSS overlay |

`renderer.autoClear = false`. `Frame.ts` runs: `clear(color+depth)` · pass 1 · `clearDepth()` · pass 2 · `clearDepth()` · pass 3 · `clearDepth()` · pass 4. Compositing is by clear order, never by depth merge, exactly as rendering.md §4 specifies. `Frame.ts` owns that order and nothing else, and it is about 60 lines.

At `1e-5 units/m`: Forge (R = 600 km) is a 6-unit sphere, Cinder (R = 200 km) is 2 units, a 12,000 km separation is 120 units. Comfortably inside `farCam`'s 7 decades.

### 3.2 The near/far terrain split

`TerrainStreamer` keeps `minResidentDepth` coarse shells resident for the whole body, so the near scene would otherwise need a 1,200 km far plane. Instead, **partition resident chunks by `TerrainChunk.depth`**:

For Forge (R = 600 km) a cube-face edge is about 942 km, so `quadEdgeLengthM` at depth `d` is `942 km / 2^d`:

| depth | chunk edge | vertex spacing (33 verts) | goes to |
|---|---|---|---|
| 0 to 4 | 942 to 59 km | 29 km to 1.8 km | `farScene`, scaled |
| 5 | 29.4 km | 920 m | `farScene`, scaled |
| **6 and finer** | ≤ 14.7 km | ≤ 460 m | `nearScene`, 1:1 |
| 14 (`maxDepth`) | 57.5 m | **1.8 m** | `nearScene`, 1:1 |

The cutoff is a `Regime` output, not a constant: `nearDepthCutoff = 6` on the surface, sliding to `4` then `0` through ascent so that at orbit *all* terrain is in the far scene. A chunk crossing the cutoff is generated by the same oracle at the same `centerUniverse`, so the two representations are subpixel-identical at the crossing distance (≥ 15 km) and the swap is invisible. Depth 14 at 1.8 m spacing is exactly the resolution the 1 m voxel layer needs to seam against.

`nearCam.far = 1e5` (100 km) covers the depth-6 ring plus atmospheric haze distance with margin.

### 3.3 Depth: challenge to D3's logarithmic-depth clause

D3 specifies "plus logarithmic depth". Three verified facts argue against making that the primary mechanism:

1. three's own `WebGLRenderer` docs on `logarithmicDepthBuffer`: it "uses `gl_FragDepth` if available which **disables the Early Fragment Test optimization and can cause a decrease in performance**". Early-Z is worth a lot to us: terrain is heavily overdrawn from a low eye height.
2. three's own docs on `reversedDepthBuffer`: "**This is a more faster and accurate version than logarithmic depth buffer.**" It also composes with MSAA, which log depth does not.
3. Log depth **infects every custom shader**. A `ShaderMaterial` must include `logdepthbuf_pars_vertex` / `logdepthbuf_vertex` / `logdepthbuf_pars_fragment` / `logdepthbuf_fragment`, and the three.js forum carries multiple unresolved reports of render-order and depth-write bugs with `ShaderMaterial` even when the chunks are present. We have five custom shaders and they are all load-bearing.

**Policy (`render/DepthPolicy.ts`, the sole authority):**

```
1. The camera split (§3.1/§3.2) is the PRIMARY mechanism. Each camera sees <= 6 decades.
2. If renderer.capabilities.reversedDepthBuffer  -> reversedDepthBuffer: true      (86.05% of users)
3. else if quality tier != low                   -> logarithmicDepthBuffer: true   (fallback)
4. else                                          -> plain depth; nearCam.far = 30 km, cutoff -> depth 5
```

`DepthPolicy` exports `SHADER_PRELUDE_VS` / `SHADER_PRELUDE_FS` strings holding the correct chunk includes for the active mode, and **every one of the five custom materials concatenates them unconditionally**. No shader can forget, because forgetting is not reachable.

**Verification is a test, not a hope.** `?scenario=zfight` builds a probe scene: a 1 mm decal at 1 m, a machine at 30 m, a cliff at 2 km, a mountain at 60 km, a scaled moon at 400,000 km. The smoke suite orbits it for 200 frames and pixel-diffs consecutive frames in fixed regions; any flicker above threshold fails CI. This runs from W1 onward, so the depth question is closed by measurement before any content depends on it.

### 3.4 First person / third person

One state object, `player/ViewMode.ts`. **Yaw and pitch are the authority in both modes**; only the camera *position* differs. That is what makes the toggle preserve aim, structurally rather than by fixup.

```
state: { mode: 'FP' | 'TP', yaw, pitch, armLength, armTarget }
basis: from surface_walk.h -> localUp(dir), north, east  (the tangent frame)
eye   = footPositionUniverse + up * eyeHeight            (of::SurfaceObserver::eyeHeight)
aimRay = { origin: eye, dir: fromYawPitch(yaw, pitch, basis) }   // IDENTICAL in FP and TP
```

- **FP:** `nearCam` sits at `eye` with `aimRay`'s orientation. Crosshair at screen centre.
- **TP:** `nearCam` sits at `eye - aimDir * armLength + up * armLift`, same orientation. The crosshair is drawn where `aimRay` hits, **projected into the TP camera**, so it moves off centre. That is correct and it is what tells the player the aim did not change.
- **Spring arm:** sphere-cast (radius 0.25 m) backward from `eye` along `-aimDir` for `armTargetMax` (3.5 m), testing `SurfaceOracle.solidCell` at 0.25 m steps plus a `three-mesh-bvh` raycast against near-field static meshes. Clamp `armLength` to `hit - 0.3`. **Extend with a critically-damped spring (about 8 rad/s), retract instantly.** Never smooth a retraction, or the camera clips.
- **Toggle:** swaps `mode` and nothing else. Yaw, pitch and the aim ray are untouched, so what you were pointing at stays what you are pointing at, frame-exactly. A 150 ms ease on `armLength` from 0 makes it read as a pull-back rather than a cut.
- **View model:** the FP arms and held tool live in `vmScene` with `vmCam` (pass 4). Because it is a separate scene with its own depth buffer, **it can never clip into world geometry**, and the main `nearCam.near` can sit at 0.1 m instead of 0.01 m, which buys a decade of depth precision. Tool sway and bob are a damped offset on the view-model root only, so world motion is never affected.
- **Own body:** the character mesh is on `LAYER_PLAYER_BODY`. In FP, `nearCam.layers.disable(LAYER_PLAYER_BODY)` but the shadow-casting light keeps it enabled, so the player still casts a shadow without rendering a slab in front of the camera. This is the M3.1b "FP black slab self-shadow" bug fixed by construction rather than by workaround.

### 3.5 Regime transition

`world/Regime.ts` computes altitude above the designed surface (`SurfaceOracle.baseHeight`) once per tick and publishes **continuous blend factors**, not a switch. Every consumer smoothsteps.

| Band | Altitude | `nearDepthCutoff` | `StreamConfig.maxDepth` | Voxel near-field | Foliage | CSM cascades | Atmosphere | Time warp |
|---|---|---|---|---|---|---|---|---|
| **SURFACE** | 0 to 2 km | 6 | 14 | on | on | 3 | thick | off |
| **ASCENT** | 2 to 100 km | 6 to 4 | 14 to 8 | off above 3 km | fade out 2 to 5 km | 3 to 1 | thinning, stars fading in | off |
| **ORBIT** | > 100 km | 0 (all terrain scaled) | 8 to 4 | off | off | 0 (no shadow caster in view) | rim only | on |

Hysteresis is 10% of band width on every threshold. The only discrete event in the whole transition is a chunk moving between scenes, which happens at ≥ 15 km where the two representations are subpixel-identical (§3.2). `RegimeChanged` is emitted for logging and gameplay gating (time warp), never for rendering, because rendering reads the continuous factors.

### 3.6 Floating origin: exactly one broadcast

```
world/FloatingOrigin.ts   // the ONE authority
  step(observer: UniverseCoord):
     if (wasm.floatingOrigin.maybeRebase(observer)):
        const delta = wasm.floatingOrigin.lastDelta()
        events.emit('OriginRebased', { delta, newOrigin, frame })   // <- the ONLY emit site
```

Subscribers implement one interface, `onOriginRebased(delta: Vector3)`, and re-derive their engine-space transform from their cached `UniverseCoord` via `floatingOrigin.toEngine()`:

`ChunkView` (per resident chunk root) · `VoxelView` · `Scatter` (instance matrices) · `FactoryView` · `player/KinematicBody` · `CameraRig` (refit CSM) · `BuildPreview`.

Cost: the rebase threshold is `of::FloatingOrigin`'s default 4,000 m, which at 6 m/s walking is one rebase every ~11 minutes. The heavy part is shifting up to ~135k instance matrices, which is about 1 M float adds in a tight `Float32Array` loop, roughly 1 ms. It must be atomic (spreading it over frames makes the world visibly shear), and 1 ms once per 11 minutes is acceptable. Budgeted and asserted in the smoke suite (`?scenario=long_walk` requires ≥ 3 rebases and no frame above 25 ms).

Ordering: `FloatingOrigin` fires before any render read in the same tick, so no consumer can ever observe a half-rebased world. This is enforced by `Loop.ts` call order, which is the only place ordering is expressible.

---

## 4. Terrain pipeline

### 4.1 The path

```
main: TerrainStream.request(observerUniverseCoord)
  -> terrain.worker: of::TerrainStreamer::updateStreaming(observer)
       -> StreamUpdate { ready: TerrainChunk[], evicted: FQuadKey[], generated, converged }
  -> worker PACKS each TerrainChunk into flat float32/uint8 buffers (§4.2)
  -> postMessage(payload, [transferables])       // zero copy
  -> main: ChunkGeometryPool.acquire() -> attribute.array.set(buf) -> needsUpdate
  -> ChunkView adds Mesh to nearScene or farScene by depth (§3.2)
```

`genBudget` (default 16 new meshes per `updateStreaming`) already caps worker burst cost. Set it to 8 during ASCENT so a fast descent spreads generation instead of stalling.

### 4.2 Vertex layout

`TerrainChunk` carries `std::vector<Vec3>` of **doubles** for positions, normals, dirs and heights. **None of that crosses the WASM boundary as-is.** The worker calls a thin C shim that writes a pre-packed buffer straight into the WASM heap and hands JS a view to `slice()` and transfer. Reading `std::vector<Vec3>` element-by-element from JS via Embind would be a per-chunk disaster and is banned.

Packed layout, `V = 1089 core verts + 128 skirt verts = 1217`:

| Attribute | Type | Bytes/vert | Content |
|---|---|---|---|
| `position` | `Float32Array` × 3 | 12 | **chunk-local metres**, relative to `centerUniverse.pos`. At a 15 km chunk extent f32 gives about 1 mm precision |
| `normal` | `Int8Array` × 4, normalized | 4 | geometric normal, w unused |
| `aBiomeW` | `Uint8Array` × 4, normalized | 4 | 4 biome weights, blurred (see below) |
| `aTerrain` | `Float32Array` × 2 | 8 | x = relief height (m) for snowline/tint, y = slope dot(normal, dir) for triplanar blend |
| **total** | | **28 B** | **34.1 kB per chunk** |

> **W1 implementation note (2026-07-25): the chunk does NOT cross as one interleaved buffer.**
> `THREE.InterleavedBufferAttribute` takes its GL type from the `InterleavedBuffer`'s array, so a
> single buffer cannot carry float32 positions *and* int8 normals *and* uint16 uvs; the snippet in
> WASM-BRIDGE.md §4.8 would upload every attribute as float32. `terrain.worker` therefore
> **de-interleaves** `of_chunk_packed`'s 28 B/vertex span into ONE contiguous `ArrayBuffer` with five
> fixed-offset sections (position f32×3, height f32, uv u16×2, biome u8×4, normal i8×3 — see
> `src/world/ChunkFormat.ts`). It is still one transferable per chunk, still constant size
> (32,859 B), still zero-copy on the wire, and the pool still preallocates it. Measured cost of the
> de-interleave loop is inside the pack figure below.

Indices are **identical for every chunk** (33×33 grid + skirt ring): one `Uint16Array` of 2,304 triangles built once in `render/geometry/SharedIndex.ts` and assigned to every chunk geometry. 200 resident chunks share **one** index buffer instead of 200 copies. Triangles per chunk: 32×32×2 = 2,048 core + 256 skirt = **2,304**.

**Biome weights.** `TerrainChunk` gives one `biome` and one `materialId` for the whole chunk, which is too coarse to look good. The worker computes `biomeAt(body, dirs[i])` per vertex (the `dirs` array is right there, and this is the same `/core` call the UE layer used), maps to a slot in the 8-layer terrain array texture, then runs a **2-pass box blur over the grid** to feather boundaries into a transition band. This is the M4.1 technique that killed the hard diagonal seam, reproduced here as a worker-side step instead of a per-frame engine step.

### 4.3 Chunk pooling: the structural gift

`kGridDim` is `constexpr` 33. **Every chunk has exactly 1,217 vertices and 2,304 triangles.** So:

- `ChunkGeometryPool` preallocates **384** `BufferGeometry` objects at construction, each with fixed-size attribute arrays and the shared index. Total: 384 × 34.1 kB ≈ **13.1 MB**, allocated once.
- Stream-in is `pool.acquire()` then `attr.array.set(payload)` then `attr.needsUpdate = true`. **Zero allocation, zero GC, no `BufferGeometry` construction, no index upload.**
- Eviction returns the geometry to the free list. Nothing is disposed during play, so `renderer.info.memory.geometries` is flat, which makes a leak trivially visible.
- Attributes use `THREE.DynamicDrawUsage`, set **before first render** (three docs: "After the initial use of a buffer, its usage cannot be changed").

This is the single highest-leverage decision in the terrain pipeline and it is only available because `/core` fixed the grid dimension. It also removes the whole class of "terrain hitches on stream-in" bugs.

### 4.4 Material strategy

**One shared `TerrainMaterial` (`ShaderMaterial`) for every chunk in both scenes.** Same program, same uniforms, so chunks batch trivially and the shader cache never thrashes.

- **Surfaces:** one `THREE.CompressedArrayTexture` (KTX2/BasisU) with 8 layers × 1024², each layer holding albedo; a second array for normal+roughness+AO packed into RGB. Indexed by the 4 `aBiomeW` weights, sampled 4 times and blended. Cost: 4 array samples per surface set, which is the standard splat cost.
- **Triplanar** on slopes only, gated by `aTerrain.y` so flat ground pays the cheap single-projection path. This is what makes cliffs not stretch.
- **Aerial perspective** is computed **in this material**, not as post-processing: optical depth along the view ray from `SkyAtmosphere`'s analytic model, so a mountain 40 km out goes blue for free and matches the sky exactly (§7.3).
- **Uniforms are global** (sun dir, atmosphere params, origin, time), so per-chunk state is zero. Per-chunk fade uses a single attribute rather than a uniform, keeping the material shareable.
- Far-scene chunks use the **same material with a `#define OF_SCALED`** that skips triplanar and aerial perspective. One program variant, not a second material.

**Draw-call plan:** start with one `THREE.Mesh` per resident chunk sharing that material, about 200 draws. Trigger to move terrain into a `BatchedMesh` (one draw for everything): `renderer.info.render.calls > 300` sustained, or CPU submission > 1.5 ms. `BatchedMesh` fits perfectly here (fixed-size geometries, `setGeometryAt` for stream-in, per-object frustum culling built in), so this is a planned, cheap upgrade rather than a rewrite. Do not do it in W1: 200 draws is inside budget and the simple path is easier to debug.

### 4.5 LOD transitions and cracks

Three mechanisms, layered:

1. ~~**Skirts (always on).** `StreamConfig.skirtFraction` = **0.9**~~ **Withdrawn at W1 (2026-07-25).**
   `of::TerrainStreamer` sizes the skirt apron in **proportion to the chunk**, so 0.9 gives an
   **82 km** drop on a depth-3 chunk (measured: `chunkRadius` 78,815 m, `skirtDepth` 82,306 m). Those
   aprons render as vertical walls and flat shelves lying across the landscape, not as hidden crack
   plugs; at 0.02 they become ribbons and at 0.005 hairlines, and at no value do they plug the
   far-scene cracks. W1 therefore draws **the interior index range only**
   (`geometry.setDrawRange(0, of_chunk_interior_index_count())` — the interior indices come first
   precisely so this is possible), and `?skirts=1&skirtfrac=` re-enables them for comparison.
   **Consequence, stated honestly: LOD T-junction cracks are visible at chunk boundaries in the
   scaled scene** (see `docs/screenshots/W1_streaming.png`, the dark slivers on the distant mesa).
   Mechanism 2 below is the real fix and is a W2 task; `of_chunk_neighbour_depths` is already
   exposed for it.
2. **Edge stitching. SHIPPED at W2, on the main thread.** When a neighbour is coarser, this chunk's
   shared-edge vertices are snapped onto the coarser edge's interpolated line, removing the
   T-junction properly rather than hiding it. It is exact: `cubed_sphere.h` derives every vertex from
   its integer lattice point, so the coincident vertices on both sides are bit-identical and a lerp
   between two of them lies exactly on the coarse triangle's edge. Measured: **139 crack pixels to
   0** in the `W1_streaming.png` framing, 0.1 to 0.2 ms, only when the resident set changes.
   **It does NOT use `TerrainChunk.neighbourDepth[4]`,** because /core annotates that only on
   freshly-ready chunks and it goes stale the moment a neighbour merges. See section 15.2 item 16.
3. **Cross-fade.** A per-chunk `aFade` value ramps 0 to 1 over 250 ms on stream-in, driving a dithered (Bayer 4×4) alpha-test in the fragment shader. Dithering rather than blending keeps it opaque, keeps Early-Z, and needs no sorting. This kills the pop that skirts cannot address.

### 4.6 Re-mesh on dig

```
Interaction.dig(aimHit)
  -> OpLog.append({tick, dig, centre, radius})           # broadcast to all WASM instances
  -> main-thread WASM: VoxelEdits.dig(...)               # so the character step sees it THIS tick
  -> voxel.worker:  rebuild greedy mesh over dirtyRegion()          (§5)
  -> terrain.worker: for each resident chunk whose ANGULAR extent overlaps the dig dir:
                       TerrainStreamer::rebuildChunk(key)  -> repacked payload
  -> main: pool swap in place (same geometry object, new data)
```

Chunk selection is by angular overlap with the dig direction, which is the R2a approach and does not need any deform-store query. Because `surfaceHeight = base - derivedLowering` and `derivedLowering` counts only the **top-anchored contiguous removed run**, a pit lowers the heightfield at its mouth while a sideways tunnel under intact ground lowers nothing and the ceiling survives. The mesh and the voxel field cannot disagree, because they read the same function. That is D-011 paying off.

Budget: dig to visible ≤ 100 ms. At most 4 chunks re-meshed per dig (a 1.5 m brush at depth 14, where a chunk is 57.5 m across, touches at most 4).

---

## 5. Voxel near-field

### 5.1 Greedy meshing

`of::worldgen::exposedFaces(body, edits, cmin, cmax)` returns one `FaceQuad` per solid-to-air face. A fully exposed 48³ region can emit tens of thousands of quads, most of them coplanar and adjacent. Greedy meshing merges them into rectangles.

Runs in `voxel.worker` in **TypeScript over the WASM-returned quad array**, not in `/core`. Deliberate: the brief forbids touching `/core`, `exposedFaces` already does the expensive part (the solidity sweep), and the merge is a cheap 2D pass. If it ever shows up in a profile, it promotes to `/core` with a ctest.

```
for axis in {x, y, z}, sign in {+, -}:            # 6 face directions
    bucket quads by their slab coordinate along `axis`
    for each slab:
        rasterize into a 2D boolean mask (u, v)
        greedy sweep: find the largest axis-aligned rectangle of set cells,
                      emit one quad, clear it, repeat
emit: position f32[4 verts * 3], one packed uint8 per quad for (axis, sign, materialSlot),
      and a per-quad (uScale, vScale) so the material tiles correctly across a merged rect
```

Expected reduction for a walked tunnel: **5x to 20x** fewer quads. A 20 m tunnel goes from roughly 4,000 quads to a few hundred.

Output is `{ positions: Float32Array, normals: Int8Array, aFace: Uint8Array, aTile: Float32Array, index: Uint32Array }`, transferred. Main thread writes into a second fixed-capacity pooled geometry (capacity 48k verts), same zero-realloc pattern as terrain.

### 5.2 Region, triggers, budget

- **Region:** ±24 m around the player's voxel cell, so a 48³ = 110,592-cell AABB. `forSolidCellsInRegion` walks it in WASM.
- **Triggers:** (a) the player crosses an 8 m cell band, (b) any dig op, (c) load, (d) origin rebase (re-anchor only, no re-mesh).
- **Dirty region:** `VoxelEdits::dirtyRegion()` returns a `CellAABB`; a dig re-meshes only the intersection of that AABB with the resident region, then `clearDirty()`. A single dig touches a ~4³ cell box, which is a sub-millisecond rebuild.
- **Budget:** full region rebuild ≤ 8 ms p95 in the worker; incremental dirty rebuild ≤ 2 ms. Never blocks a frame because it is a worker.

### 5.3 Collision

**No mesh collision, at all.** The capsule tests `SurfaceOracle.solidCell(cell)` directly, which is `|cellCentre| <= radiusM + baseHeight(unitDir)` and not removed. This is O(1), exact, needs no cook, needs no rebuild on stream or dig, and **cannot** disagree with what is rendered because the renderer derives from the same function.

Compare to the UE path (cooked complex-as-simple PMC collision, D-010), which needed a synchronous cook per chunk, a re-cook per dig, and a re-bake per origin rebase. All three costs vanish. This is the strongest single argument that the pivot is architecturally correct, not just a tooling change.

### 5.4 Seaming with the far-field heightfield

Structurally the two already agree (§4.6). The residual is cosmetic: the heightfield is a smooth ~1.8 m-spaced grid, the voxel walls are 1 m axis-aligned blocks, so the pit mouth shows a small ledge.

Three cheap fixes:

1. `VoxelMaterial` uses `polygonOffset: true, polygonOffsetFactor: -1` so voxel faces win z-fighting at the mouth.
2. The topmost 1 m ring of voxel faces samples the **same terrain biome array texture** with the same `aBiomeW` (fetched from the oracle at the face's dir), so it reads as soil continuing into the hole rather than as a different material.
3. Voxel faces get a small ambient-occlusion darkening from neighbour occupancy (a 4-neighbour count per corner, computed during the greedy pass, packed into vertex color). This is standard voxel AO and it is what makes a dark cavity read as a cavity instead of a black hole. It also directly addresses the M5.2 gotcha that "a deep voxel cavity renders BLACK".

Tunnel lighting is a small point light on the player (headlamp), which on WebGL 2 forward rendering costs one light; do not add more than 4 dynamic point lights on the low tier.

---

## 6. Instancing at scale

### 6.1 The choice, and why `BatchedMesh` wins

| | `InstancedMesh` | `BatchedMesh` |
|---|---|---|
| Geometries per draw | **1** | **many** (`addGeometry`) |
| Per-instance geometry swap | no | **yes, `setGeometryIdAt`** |
| Frustum culling | whole object only | **per instance (`perObjectFrustumCulled`, default true)** |
| Sorting | none | **`sortObjects`, `setCustomSort`** |
| Per-instance data | matrix, color, morph | matrix, color, visibility, geometryId |
| Caveat | culled as a blob | **negative scale unsupported** |

`setGeometryIdAt(instanceId, geometryId)` **is our LOD ladder**. Register LOD0/LOD1/LOD2 geometries for a machine type once, then switching an instance's LOD is a single call that changes nothing about draw-call count. That collapses the RN-3 ladder from "one instanced draw per type per LOD bucket" (rendering.md's estimate of 72 draws for a 100k-entity scene) to **one draw per material family**.

`InstancedMesh` is still right where there is genuinely one geometry and per-instance culling is worthless (grass patches inside one lattice cell, belt items of one type packed along visible lines).

### 6.2 Per subsystem

| Content | Container | Count cap | LOD mechanism |
|---|---|---|---|
| **Factory machines** | 3 `BatchedMesh` (opaque · emissive · transparent), all types + all LODs registered | 20k instances | `setGeometryIdAt` LOD0/1/2; `setVisibleAt(false)` for `OnRails3` |
| **Belt decks** | 1 `BatchedMesh`, `BeltFlowMaterial` | 4k | segment geometry variants |
| **Belt items, LOD-0** | 1 `InstancedMesh` per item type (about 6 types) | 50k total | discrete meshes; matrices built in the worker from `GetLineItems` + baked `pathUnitToWorld` |
| **Belt items, LOD-1** | none | 0 | the deck's flow material scrolls; params from `FFactoryBeltFlowState` (`FlowSpeedQuant`, `Density`, `Compressed`) |
| **Foliage: trees/shrubs/rocks** | 1 `BatchedMesh` per biome material, species × LOD registered as geometries | 15k | `setGeometryIdAt` for species and LOD; per-instance frustum culling matters most here |
| **Foliage: grass** | 1 `InstancedMesh` of a **merged multi-blade patch** per lattice cell | 45k patch instances | distance fade in the vertex shader, hard cut at 60 m |
| **Resource nodes** | 1 `BatchedMesh` | 400 | 2 LODs |
| **Dropped items** | 1 `BatchedMesh` | 500 | 1 LOD |
| **Placed structures / walls** | 1 `BatchedMesh` | 5k | 2 LODs |

**Grass is never one instance per blade.** That is the classic web GPU killer. A merged patch of 24 blades as one geometry turns 45k draws' worth of vertex work into 45k instances of a 96-triangle mesh, and the wind animation is a vertex-shader function of world position and time (zero CPU).

### 6.3 Per-instance data beyond the built-ins

`BatchedMesh` gives matrix, color, visibility, geometryId. Anything else goes one of two ways:

- **Cheap scalars** pack into the instance color's unused channels (color is stored as `Color | Vector4`, so alpha is available): biome tint index, wind phase.
- **Richer per-instance state** (machine animation phase, power level, damage) goes in a `THREE.DataTexture` of `RGBA32F`, indexed by `gl_DrawID`-derived instance index in the shader. One texture per `BatchedMesh`, updated as a subrect per frame from the `FactoryView` SoA arrays. 20k instances × 16 B = 320 kB, which is nothing.

### 6.4 LOD bands and hysteresis

`render/instancing/LodLadder.ts` maps **screen-space size**, not metric distance, so it auto-scales with FOV and resolution (rendering.md §RC-8 §2 requires exactly this).

```
sizePx = (boundingRadiusM / distanceM) * (viewportHeightPx / (2 * tan(fovY/2)))

sizePx >= 24  -> Near0     full mesh, discrete belt items
sizePx >= 6   -> Mid1      instanced mesh, belt flow material, no discrete items
sizePx >= 1.5 -> Far2      impostor geometry (2 tris), no items
else          -> OnRails3  setVisibleAt(false); the sim proxy is demoted anyway
```

**Hysteresis of 25%** on every threshold (a band you entered at 24 px is not left until 18 px). This closes RC-8's residual risk (c), LOD-band popping, which the UE analysis flagged but never resolved. The band names map 1:1 onto `of::render::LodBand { Near0, Mid1, Far2, OnRails3 }`, so `render_cost.h`'s validated cost model stays the budgeting authority: its 100k-entity result (72 draws, 219,500 instances, 180,000 item-evals vs 12,180,000 belt items, >98% collapsed) is the number we hold ourselves to, and `BatchedMesh` should beat the draw-call half of it.

Band evaluation cost: 20k instances × a few flops is ~0.2 ms if done naively every frame. Instead evaluate **one eighth of the instance set per frame** (round-robin) with hysteresis absorbing the staleness. 0.03 ms/frame.

---

## 7. Lighting, atmosphere, sky

Design constraint: **cheap**. WebGL 2 forward rendering has no clustered lighting (that is the r185 WebGPU feature we are deferring), so the light count is a hard budget.

### 7.1 Lights

- **1 `DirectionalLight`** (the sun). Colour and intensity driven by sun elevation from the same analytic model as the sky, so they cannot desynchronise.
- **1 `HemisphereLight`** for the cheap ambient term, sky colour from `SkyAtmosphere`'s zenith sample, ground colour from the biome average.
- **1 IBL** from a **runtime-generated 64² cubemap**: render `SkyAtmosphere` into it once every 30 frames (or immediately on a large sun-angle change), run `PMREMGenerator`, assign to `nearScene.environment`. This is why the ambient goes correctly black in orbit and warm at dawn with no authored HDRIs. Cost: about 0.2 ms every half second.
- **Point lights: 4 max** on the low tier, 8 on high (headlamp, furnace glow, a couple of lamps). Everything else that should look lit is **emissive material plus bloom**, which costs nothing.

### 7.2 Shadows

`three/addons/csm/CSM.js` (verified present in r185, WebGLRenderer only; `CSMShadowNode.js` is the WebGPU counterpart for the future swap).

| Tier | Cascades | Map size | `maxFar` | Type |
|---|---|---|---|---|
| high | 3 | 2048² | 300 m | `PCFSoftShadowMap` |
| med | 3 | 1024² | 200 m | `PCFShadowMap` |
| low | 1 | 1024² | 80 m | `BasicShadowMap` |

- CSM re-fits on `OriginRebased` (it is a subscriber like everything else) and on regime change.
- Cascade count drops 3 to 1 through ASCENT and to 0 in ORBIT (nothing casts onto anything at that range).
- VRAM: 3 × 2048² × 4 B ≈ **50 MB** on high. That is the largest single texture cost in the budget and it is worth it.
- Foliage below 8 m and all `Far2` instances do not cast. Grass never casts.

### 7.3 Atmosphere

Two phases:

- **W3 (get something on screen):** `three/addons/objects/Sky.js` (Preetham, 9.94 kB, verified present). Good-looking, near-free, and it does **not** fade to black correctly from space, which is fine because W3 is a surface milestone.
- **W3b onward (the actual sell):** one custom `SkyAtmosphere` full-screen shader in the **far** scene: analytic single-scattering, Rayleigh + Mie, parameterized by `FAtmosphereProfile` from world-gen (D-006: Forge scale height 5.6 km, Cinder airless). Two nested spheres (ground radius, atmosphere radius), 16 view-ray samples with 8 light-ray samples, evaluated per pixel at half resolution and upsampled. Roughly 0.6 ms at 1080p on the target GPU.

**Aerial perspective is in `TerrainMaterial`, not post-processing** (§4.4): the same optical-depth function evaluated along the fragment's view ray. Mountains at 40 km go blue and the horizon matches the sky exactly, with no depth-buffer round trip and no post pass. This is the single cheapest big visual win available.

**The surface-to-space fade is free** from the same model: as the camera climbs, optical depth to the zenith falls, the sky darkens continuously, and stars (already rendered in pass 1, always present) emerge as the sky luminance drops below them. No transition code, no blend states, no regime special case. **Night side** is the same function with `dot(sunDir, up) < 0`.

**Not in v1:** volumetric fog, volumetric clouds, god rays. A flat scrolling cloud shell on the far-scene planet proxy gives the from-orbit look for one texture sample.

### 7.4 Star field

One `THREE.Points`, about 4,000 stars, in the sky scene: positions generated on the unit sphere from the world seed, per-star magnitude driving size and a blackbody colour ramp. Additive blending, depth test and write off, custom `StarfieldMaterial` for point size attenuation and a soft disc. 4,000 × 16 B = **64 kB**. Preferred over a cubemap because there are no seams, it rotates exactly with the frame, and it is deterministic from the seed (which the smoke suite needs for golden images).

The sun is a single billboard in the same pass with a small `Lensflare` on the high tier only.

---

## 8. Physics and the character controller

### 8.1 The player: kinematic, custom, no engine

**A capsule integrated against the `/core` surface oracle.** No Rapier, no Jolt, no Havok for the player.

```
step(dt):
  up      = SurfaceOracle.up(dir)                # surface_walk.h localUp
  gravity = up * -observer.gravityAccel()        # surface_walk.h gravityAccel
  vel    += (moveIntent_tangent + gravity) * dt
  proposed = pos + vel * dt

  # 1. far-field ground: the oracle IS the ground
  groundR = SurfaceOracle.surfaceHeight(dir(proposed)) + body.radiusM
  if |proposed| < groundR + capsuleFootOffset:
        snap to groundR + capsuleFootOffset;  vel -= up * dot(vel, up);  grounded = true

  # 2. near-field voxel walls: 6-point capsule sample against solidCell
  for p in capsuleSamplePoints(proposed):        # 6 points, feet/mid/head x 2
      if SurfaceOracle.solidCell(cellForPos(p)):
          resolve along the dominant axis of the cell face (1 m cells, so the face is exact)

  # 3. step-up: a <=0.6 m rise is climbed, not blocked
  # 4. slope limit 50 deg from dot(normal, up)
```

Why this is right and a physics engine is wrong here:

- **It cannot disagree with what you see.** The mesh, the collision and the walker read one function (D-011). The entire UE bug family (floating player, floating nodes, dig-in-air, the 18 m surface-snap hack) was caused by them reading different functions. A physics engine would reintroduce a *fourth* representation, a triangle collider, which must be rebuilt on every chunk stream and every dig. That is precisely the cost the UE layer paid.
- **Cost is O(1), not O(triangles).** No broadphase, no cooking, no collider lifetime, no rebuild on origin rebase.
- **It is deterministic and double-precision.** `/core` semantics, so the walk is reproducible from a seed, which the agent dev loop (§11) depends on completely.
- **`of::SurfaceObserver` already does the hard part** (geodetic walking, `move(forward, right)`, tangent frames, floating-origin rebase). We are wrapping an existing tested implementation, not writing one.

Ray needs (aim, placement, harvest) use the oracle analytically for the terrain (march along the ray in adaptive steps, bisect the sign change of `|p| - surfaceRadius(dir(p))`, about 20 iterations for millimetre accuracy) and **`three-mesh-bvh@0.9.10`** for placed structures and props, where the geometry genuinely is a mesh.

### 8.2 Props, items and ships: custom now, Rapier maybe later

**Dropped items and debris:** custom. Point mass, gravity from the oracle, ground contact from the oracle, a 4-second settle timer then sleep. About 60 lines, tens of microseconds for hundreds of items, deterministic, and it inherits the floating origin for free. A rigid-body engine for a bouncing iron ore is not a reasonable trade.

**Vehicles and constructed ships (W8+): this is where Rapier earns its keep, conditionally.** A multi-part welded vessel with joints, thrust torque, part-vs-part collision and structural failure is genuinely a rigid-body problem, and writing that from scratch is a multi-month detour.

Decide at W8 against these verified facts:

- `@dimforge/rapier3d@0.19.3`: 1.57 MB wasm + 211 kB glue, on top of our own `/core` wasm. Real budget.
- **Determinism is opt-in and easy to get wrong.** Since 0.15.0 the plain build ships with `enhanced-determinism` **off**; you must use `@dimforge/rapier3d-deterministic`. This matters enormously to us: the whole project is built on `/core` determinism, and quietly adopting a non-deterministic solver would poison save/replay and the eventual netcode.
- Rapier has **no double precision and no floating-origin concept**. It works fine only because we already keep everything near the origin, so it must live entirely inside the near scene and be shut down above the ASCENT band, where `orbital.h` patched conics take over. That handoff is a design item for W8, not a free lunch.
- Its official JS guide currently documents 0.17 while npm is at 0.19.3, and there is no primary documentation on worker or SharedArrayBuffer use.

**Recommendation:** custom through W7. At W8, prototype the vessel with Rapier **deterministic** behind `physics/VesselSolver.ts` (one interface, so it is swappable), and only adopt if the spike shows joint stability the custom path cannot reach in comparable effort. Do not add it speculatively.

---

## 9. Asset pipeline

### 9.1 Authoring to runtime

```
Blender (headless Python, D5)
   -> .glb  (glTF 2.0, Y-up, metres, 1 unit = 1 m, +Z forward)
   -> @gltf-transform/cli@4.4.1:
        gltf-transform optimize in.glb out.glb \
          --compress meshopt --texture-compress ktx2 --texture-size 1024
   -> public/assets/*.glb          (geometry meshopt-compressed, textures KTX2/BasisU)
```

**Use glTF Transform, not gltfpack.** Verified reason: the **npm/WASM gltfpack build cannot do `-tc`** (KTX2), because texture compression requires a native binary linked against `basis_universal` and `libwebp`. glTF Transform 4.4.1 bundles `draco3dgltf`, `meshoptimizer`, `ktx-parse` and `sharp`, so `npm i -g @gltf-transform/cli` is the entire toolchain install. For an agent-driven pipeline that runs in CI, "no native binary" is decisive.

**Prefer meshopt over Draco.** Draco needs a 719 kB JS + 286 kB wasm decoder; meshopt's decoder is small, SIMD-accelerated (1 to 3 GB/s per its own README), and decodes to already-quantized GPU-ready attributes. We ship no Draco decoder at all unless a third-party asset forces it.

### 9.2 Runtime loading

```ts
// src/assets/Loaders.ts  -- wired exactly ONCE, at startup
const ktx2 = new KTX2Loader()
  .setTranscoderPath('/basis/')     // SELF-HOSTED: basis_transcoder.js 57.5 kB + .wasm 527 kB
  .detectSupport(renderer);         // MANDATORY, before any load (three docs)

const gltf = new GLTFLoader()
  .setKTX2Loader(ktx2)
  .setMeshoptDecoder(MeshoptDecoder);   // from 'meshoptimizer/decoder', v1.2.0
```

Import paths are `three/addons/loaders/GLTFLoader.js` and `three/addons/loaders/KTX2Loader.js` (the canonical form in r185's own `@three_import` annotations). Transcoders are copied from `node_modules/three/examples/jsm/libs/basis/` into `public/basis/` by a `postinstall` script, never CDN-linked (correct regardless of COOP/COEP, and mandatory if we ever enable it).

`detectSupport(renderer)` accepts `WebGLRenderer | WebGPURenderer` in r185, so this line survives the renderer swap unchanged.

### 9.3 Streaming and budget

- **Critical preload (blocks first interaction, target ≤ 25 MB):** terrain biome array texture, 6 machine types, 8 foliage species, player tool set, UI atlas. Target time-to-interactive ≤ 6 s on 50 Mbit.
- **Lazy, priority queue:** everything else. Max 2 concurrent fetches, decode budget 4 ms per frame (`GLTFLoader` parse is main-thread; a budget check before starting one prevents hitches).
- **Never dispose during play.** The asset set is small and bounded. Flat `renderer.info.memory` makes leaks obvious.
- On load, every mesh is immediately **decomposed into the instancing containers** (§6.2) and the source `Mesh` is discarded. Nothing from a `.glb` is ever added to a scene directly, which prevents the "one draw call per prop" default.

### 9.4 The registry, and the id-duplication bug that must not recur

The UE audit (H4.2) found item-id constants duplicated as magic numbers "that must match `/core` by hand". Fix it at the tooling layer:

- `src/gen/ids.ts` is **generated at build time** from `/core`'s enums (a small script parsing the headers, or better, a WASM export that dumps the id table as JSON). Hand-editing it fails CI.
- `assets/registry.json` is keyed by those generated ids: `{ id, glb, lods: [id0, id1, id2], materialFamily, gridFootprint, colliderKind, emissive }`.
- `assets/Registry.ts` is the **only** id-to-asset lookup in the codebase. `FactoryView`, `Scatter`, `BuildPreview` and `ui/` all go through it.
- A CI check asserts every `/core` machine and item id has a registry entry, and every registry entry resolves to a file on disk. A missing asset is a build failure, never a silent invisible machine.

---

## 10. Performance budget

**Target: 1080p (1920×1080) at 60 fps sustained on a GTX 1660 / RX 6600 / Apple M1 class GPU, in a surface scene with a running factory.** 16.6 ms.

### 10.1 Frame budget

| Slice | Budget | Notes |
|---|---|---|
| Main-thread JS | **1.5 ms** | loop, player step, LOD round-robin, instance writes, snapshot interpolation |
| CPU draw submission | **1.5 ms** | at ≤ 150 draws this is generous |
| GPU | **10.0 ms** | shadows 2.5, near opaque 4.5, far + sky 1.0, voxel 0.5, postfx 1.5 |
| Headroom | **3.6 ms** | absorbs dig re-mesh uploads, chunk swaps, GC |

### 10.2 Per-subsystem ceilings

| Subsystem | Draw calls | Triangles | Instances | VRAM | Worker latency |
|---|---:|---:|---:|---:|---|
| Far scaled terrain shell | 8 | 60k | | 1 MB | |
| Near terrain (200 chunks) | 200 (target 1 via `BatchedMesh`) | 461k | | 13 MB pooled | chunk pack ≤ 12 ms, ≤ 16/update |
| Voxel near-field | 2 | 40k | | 2 MB | full ≤ 8 ms p95, dirty ≤ 2 ms |
| Foliage: trees/shrubs/rocks | 4 | 700k | 15k | 30 MB | scatter ≤ 4 ms |
| Foliage: grass patches | 2 | 260k | 45k | 6 MB | |
| Resource nodes | 1 | 60k | 400 | 8 MB | |
| Factory machines | 3 | 600k | 20k | 30 MB | tick ≤ 8 ms @ 60 UPS, 20k active |
| Belt decks + flow | 1 | 80k | 4k | 2 MB | |
| Belt items (LOD-0) | 4 | 400k | 50k | 4 MB | matrix build ≤ 3 ms |
| Dropped items + structures | 2 | 40k | 1k | 4 MB | |
| Sky + stars + atmosphere | 4 | 10k | | 4 MB | |
| Shadows (CSM ×3, re-draw) | +3 sets | (re-draw of casters) | | 50 MB | |
| View model (FP) | 3 | 30k | | 4 MB | |
| Post-processing | 3 | | | 32 MB (2 RTs) | |
| **Totals** | **≤ 150 target / 300 alert / 500 fail** | **≤ 2.7 M** | **≤ 135k** | **≤ 260 MB** | |

### 10.3 Hard thresholds (CI-asserted)

| Metric | Source | Alert | Fail |
|---|---|---|---|
| Draw calls | `renderer.info.render.calls` | 300 | 500 |
| Triangles | `renderer.info.render.triangles` | 2.7 M | 4 M |
| Shader programs | `renderer.info.programs.length` | 40 | 80 |
| Geometries live | `renderer.info.memory.geometries` | 600 | 900 (leak) |
| Textures live | `renderer.info.memory.textures` | 120 | 200 (leak) |
| JS heap | `performance.memory.usedJSHeapSize` | 384 MB | 512 MB |
| Frame p50 / p99 | ring buffer | 16.6 / 25 ms | 20 / 40 ms |
| Worst frame (steady state) | ring buffer | 33 ms | 50 ms |
| Steady-state allocation | heap delta over 600 frames | 2 MB | 8 MB |
| Worker to main bytes/frame | instrumented `postMessage` | 4 MB | 12 MB |
| Chunk request to visible | instrumented | 250 ms p95 | 600 ms |
| Dig to visible | instrumented | 100 ms | 250 ms |
| Time to interactive | Playwright | 6 s | 12 s |
| Critical payload | build report | 25 MB | 40 MB |
| JS bundle (gz) | build report | 600 kB | 1.2 MB |

### 10.4 Instrumentation

- **`render/debug/StatsProbe.ts`** samples `renderer.info` plus `performance.now()` deltas per pass into a 600-frame ring buffer every frame (about 30 numbers, preallocated, zero allocation).
- **`performance.mark` / `measure`** around each of the 4 passes, each worker round trip, and the player step. A `PerformanceObserver` feeds the same ring buffer, so browser devtools traces and our JSON agree.
- **GPU timings** via `EXT_disjoint_timer_query_webgl2` when present (probe, do not assume). Per-pass GPU ms on the debug HUD.
- **`window.__of.stats()`** returns the whole ring buffer as JSON: p50/p95/p99 frame, per-pass CPU and GPU, draw calls, triangles, instances per container, memory counters, worker latency histograms. **This is what the smoke suite asserts on**, so performance regressions fail CI the same way logic regressions do.
- **Spector.js** as a dev-only opt-in (`?spector=1`) for single-frame captures when a number looks wrong and the cause is not obvious.
- A debug HUD (backtick key) renders the same data as HTML, so a screenshot carries its own performance evidence. Every milestone screenshot in `docs/web/screenshots/` will have the numbers baked into the image.

---

## 11. Dev loop (the reason for the pivot)

The UE loop was: launch the editor (60 to 120 s), enter PIE, drive a Python bridge, take a screenshot, and hope. It was the project's biggest velocity sink. The replacement:

### 11.1 The agent-facing API

`app/Debug.ts` builds `window.__of` (dev builds and `?debug=1` only). This is a first-class deliverable, not a debugging afterthought, because it is the interface an AI agent programs against.

```
__of.ready          Promise<void>            resolves when the first frame has presented
__of.stats()        FrameStats               the §10.4 JSON
__of.world()        WorldState               player {lat, lon, alt, grounded, mode},
                                             chunks {resident, near, far}, voxels {removed},
                                             factory {entities, ups}, regime, rebases, seed
__of.input.tape(t)  void                     queue a scripted input tape (deterministic)
__of.input.press(code, ms)                   single scripted key
__of.teleport(lat, lon, alt)                 jump the observer
__of.setTime(t)                              set sun angle deterministically
__of.dig(lat, lon, depth)                    apply a dig op without aiming
__of.screenshot()   Promise<Blob>            forces a settled frame first
__of.scene()        SceneDump                object counts by container, per-material draw counts
__of.settle(n)      Promise<void>            render n frames with no streaming pending
```

**`__of.settle()` matters more than it looks.** The UE screenshots were flaky because captures raced streaming. Here, `settle()` blocks until `StreamUpdate.converged` is true and the asset queue is empty, so a screenshot is reproducible by construction.

### 11.2 Headless verification

```
tools/smoke/run.ts  (Playwright + Chromium)
  1. vite build && vite preview          (2 s + 1 s)
  2. page.goto('/?seed=42&scenario=surface_walk&debug=1&t=0.35')
  3. await page.evaluate(() => __of.ready)
  4. await page.evaluate(() => __of.input.tape(TAPE))    // scripted, not synthetic DOM events
  5. await page.evaluate(() => __of.settle(30))
  6. await page.screenshot({path: 'docs/web/screenshots/W2_surface_walk.png'})
  7. assert on __of.stats() and __of.world()
  8. fail on ANY console.error / pageerror / WebGL warning
```

Total wall clock for a full scenario: **about 6 seconds**. That is roughly 20x faster than the UE editor loop and it runs unattended in CI.

**Input tapes, not synthetic events.** `Input.ts` reads from an input queue that either the DOM or a tape fills. A tape is `[{tick, keys, mouseDelta}]`. Replays are bit-identical because the sim is `/core` and the tick sequence is fixed. This directly fixes the UE limitation that "the held-key WASD walk isn't sustainable through the bridge" (rendering.md R2a residual).

### 11.3 Determinism

Every stochastic value derives from `Config.seed` through `/core`'s hash chain. `?seed=` sets it. A scenario file pins seed, start lat/lon, sun angle `t`, quality tier and the input tape. Two runs of the same scenario produce the same `__of.world()` and the same pixels. This is what makes golden images and performance assertions possible at all.

### 11.4 Test tiers

| Tier | Tool | Runs | Asserts |
|---|---|---|---|
| **Type + lint** | `tsc --noEmit`, eslint (incl. the §2.2 layering rules and the 400-line cap) | every save | structure |
| **Unit** | vitest | every save | packing, greedy meshing, LOD bands, op log, registry, pooling |
| **WASM parity** | vitest + `/core` ctest vectors | pre-commit | `surfaceHeight`, `biomeAt`, `solidCell` match the C++ bit-for-bit |
| **Smoke** | Playwright headless | pre-commit | boots, no console errors, `__of.world()` invariants, budget thresholds |
| **Golden image** | Playwright + pixelmatch, 1% tolerance | pre-commit | 8 canonical framings (surface dawn/noon/night, orbit, tunnel interior, factory, FP, TP) |
| **Perf gate** | Playwright, 600-frame run | pre-merge | §10.3 thresholds |
| **Depth probe** | `?scenario=zfight`, 200 frames | pre-merge | no z-flicker across 5 scales (§3.3) |

**The M5.2 lesson is encoded:** "a deep voxel cavity renders BLACK and the forest canopy hides the pit", so the tunnel was proven functionally rather than visually. Here, `__of.world().voxels` plus targeted `solidCell` probes are the acceptance criterion for digging, and the screenshot is supporting evidence, not proof. Every milestone states which of the two it is verified by.

### 11.5 Console and network capture

Playwright hooks `page.on('console')`, `page.on('pageerror')` and `page.on('requestfailed')`. Any error fails the run. WebGL warnings (shader compile warnings, texture-unit overflow, `INVALID_OPERATION`) are surfaced through the same channel because three logs them through `console.warn`. A silent shader fallback, which is one of the easiest failure modes to miss visually, becomes a hard CI failure.

---

## 12. Risks, ranked

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| **R1** | **WASM to JS marshalling cost for terrain chunks.** `TerrainChunk` holds `std::vector<Vec3>` of doubles; naive Embind traversal per chunk is fatal | high | high | Never touch `std::vector` from JS. A C shim writes the packed §4.2 buffer directly into the WASM heap; JS `slice()`s and transfers. **Microbenchmark this in W0**, target ≤ 12 ms end to end per chunk. This is the single most important thing to prove first |
| **R2** | **The Emscripten `/core` spike (D1) fails or the boundary is unusable** | medium | critical | Parallel agent is spiking it now. **Hand them a hard requirement today: the surface oracle (`baseHeight`, `surfaceHeight`, `solidCell`, `biomeAt`) must be callable SYNCHRONOUSLY on the main thread** (the character step, aim rays and placement all depend on it). Fallback: port those 4 pure functions to TS with the ctest vectors as parity tests, keep the rest in WASM |
| **R3** | **Depth precision at the seam** | medium | high | Camera split first (§3.2), reversed-Z where `EXT_clip_control` (86.05%), log-depth fallback, plain-depth low tier. Closed by the `?scenario=zfight` CI probe from W1, before content depends on it |
| **R4** | **Custom shaders break under log depth.** Verified: `ShaderMaterial` needs 4 chunk includes and still has known render-order bugs | medium | medium | Prefer reversed-Z. Cap custom shaders at 5. `DepthPolicy` exports the prelude and every material concatenates it unconditionally, so forgetting is unreachable |
| **R5** | **Foliage and grass GPU cost.** Web budgets are far tighter than the UE version's 2,600 resident instances | medium | medium | Merged grass patches (never per-blade), `BatchedMesh` per-instance frustum culling, 60 m hard cut, quality tiers, no shadow casting from grass |
| **R6** | **A JS-side entity store creeps in**, giving us two sources of truth (the exact UE failure) | medium | critical | Rule §2.2.8: no game rules in TypeScript. `src/sim/` is marshalling only. Review gate on every pass. Any new sim rule goes to `/core` with a ctest |
| **R7** | **God objects reappear** | medium | high | 400-line CI cap, layering eslint rules, one `OriginRebased` contract, integration pass every 3 milestones |
| **R8** | **WebGPU pressure.** ClusteredLighting (r185, WebGPU only) is genuinely wanted for tunnel and factory lights | medium | medium | Renderer seam in one file, 5-shader cap, re-evaluate at W6. Until then: 4 to 8 point lights plus emissive and bloom |
| **R9** | **Asset volume balloons** and time-to-interactive slips | low | medium | 25 MB critical budget as a CI gate, KTX2 everywhere, meshopt, lazy queue |
| **R10** | **Rapier adopted speculatively** and quietly breaks determinism (plain build has enhanced-determinism OFF since 0.15.0) | low | high | Not adopted before W8. If adopted, `rapier3d-deterministic` only, behind `VesselSolver.ts`, near-scene only |
| **R11** | Vite 8 needs Node `^20.19` or `>=22.12`; toolchain drift | low | low | Pin Node in CI and in `package.json` `engines` |
| **R12** | `@types/three@0.184.1` lags `three@0.185.1` | low | low | Pin both exactly; a tiny `src/types/three-shims.d.ts` for anything missing; bump only when types land |

---

## 13. Milestone sequence

Empty repo to "walk on the planet, dig, build, launch". Each milestone has an explicit exit gate that a headless run can assert.

| # | Milestone | Delivers | Exit gate (CI-assertable) |
|---|---|---|---|
| **W0** | **Skeleton + WASM handshake** | Vite 8 + TS + three r185, canvas, the 4-pass compositor with a placeholder in each layer, `window.__of`, Playwright smoke + screenshot, `/core` WASM loaded in a worker | `sampleDesignedHeight` round-trips against a `/core` ctest vector bit-for-bit · **R1 microbenchmark: a packed chunk buffer crosses the boundary in ≤ 12 ms** · green screenshot in CI |
| **W1** | **The planet renders** | terrain.worker + `TerrainStreamer`, `ChunkGeometryPool`, `SharedIndex`, `TerrainMaterial` (flat biome colours), near/far scene split, orbit camera, `?scenario=zfight` | 200 chunks resident · ≤ 220 draws · 60 fps · golden image · **zero z-flicker across 5 scales** |
| **W2** | **Floating origin + walk** | `SurfaceObserver` + `FloatingOrigin` on the main thread, `KinematicBody` vs the oracle, FP camera, the one `OriginRebased` broadcast, chunk re-anchor, input tapes | scripted 5 km walk · ≥ 3 rebases · no jitter · grounded every tick · frame p95 ≤ 18 ms |
| **W3** | **Sky, sun, shadows, atmosphere** | star field, CSM, `SkyAtmosphere` analytic scattering, aerial perspective in `TerrainMaterial`, day/night, runtime IBL | 4 golden images (dawn / noon / dusk / night) · shadow VRAM ≤ 50 MB · GPU ≤ 10 ms |
| **W4** | **Look and feel** | glTF + KTX2 + meshopt pipeline live, first Blender assets, terrain array texture, `Scatter` lattice, foliage + resource-node `BatchedMesh`, TP camera + FP view model + aim-preserving toggle | ≤ 150 draws with foliage · 60k instances · **aim ray identical across an FP/TP toggle (asserted numerically)** · time-to-interactive ≤ 6 s |
| **W5** | **Dig** | voxel.worker, greedy mesher, op log mirrored main and workers, dirty-region rebuild, capsule vs `solidCell`, mouth reconciliation, voxel AO, headlamp | dig down then tunnel sideways then walk in · **ceiling reads SOLID and interior reads AIR via `__of.world()` probes** (not by screenshot) · remesh ≤ 8 ms p95 · save/load restores the exact removed count |
| **W6** | **Build** | grid snap + placement preview, machine `BatchedMesh` family, belts with real transforms, factory.worker running `FactorySim` at 60 UPS, `BeltView` LOD-0/1, HTML build bar | miner to belt to smelter to assembler runs · **≤ 6 factory draws at 20k entities** · LOD band crossing shows no pop (frame-diff assertion) · **WebGPU re-evaluation decision recorded** |
| **W7** | **Progression** | inventory / crafting / research HTML overlay, placement costs, real power, the launch-pad objective, unified save on the `/core` container | a scripted playthrough reaches "launch pad buildable" · save round-trips every subsystem · `ui/` still imports zero three.js |
| **W8** | **The seam** | far scene carries Forge and Cinder for real, regime transition on ascent, boardable 1:1 vessel, `orbital.h` driving the far scene, vessel solver decision | **launch from the surface and reach orbit with no loading screen** · frame p95 held through every regime · terrain scene handoff invisible in a frame-diff |
| **W9** | **Cinder** | SOI transfer, descent, landing, the far-side resource loop | surface to orbit to transfer to landing, continuous, in one scripted run |

W0 through W3 are the tech-risk retirement phase and should not accrue content. W4 is the first milestone where the game is allowed to look like anything.

---

## 14. Decisions log (rendering domain, web)

| ID | Decision | Rationale | Status |
|---|---|---|---|
| **WR-1** | **`WebGLRenderer` (WebGL 2) for W0 to W7**, behind a one-file renderer seam, custom shaders capped at 5 | WebGL2 94.67% vs WebGPU 83.63%; MDN still marks `navigator.gpu` "Limited availability, not Baseline"; open WebGPU perf tracker #30560; GLSL is the substrate agent tooling is best at; we are not draw-submission bound | Proposed |
| **WR-2** | **Challenge D3's log-depth clause.** Camera split is primary; `reversedDepthBuffer` where `EXT_clip_control` (86.05%); log depth is the fallback | three's own docs: reversed-Z is "a more faster and accurate version than logarithmic depth buffer"; log depth disables Early-Z, breaks MSAA, and infects every custom shader | **Challenge to D3** |
| **WR-3** | **Four passes, not two** (sky · far scaled · near 1:1 · view model) | The FP view model needs its own depth range anyway, and giving it one lets `nearCam.near` move from 0.01 to 0.1 m, buying a decade of precision and removing view-model clipping structurally | Proposed |
| **WR-4** | **Challenge D4's SharedArrayBuffer clause.** Transferables only, no COOP/COEP, no pthreads | The named plugin is dead (2022); COOP/COEP breaks all cross-origin subresources and OAuth; Emscripten documents pthreads + memory growth as slow; no workload needs it (RC-8 puts the factory stream at single-digit MB/s) | **Challenge to D4** |
| **WR-5** | **`BatchedMesh` over `InstancedMesh` as the default container**; `setGeometryIdAt` is the LOD ladder | One draw per material family instead of one per type per band; per-instance frustum culling built in; collapses the whole factory to 3 to 6 draws | Proposed |
| **WR-6** | **Fixed-size chunk geometry pooling**, one shared index buffer | `kGridDim` is `constexpr` 33, so every chunk is exactly 1,217 verts. Zero realloc, zero GC, flat memory counters | Proposed |
| **WR-7** | **No physics engine for the player**; capsule against the surface oracle and `solidCell` | O(1), deterministic, double-precision, floating-origin-safe, and it cannot disagree with the rendered surface. Retires cooked-collision cost entirely (supersedes D-010 for the web client) | Proposed |
| **WR-8** | **No ECS library, no JS entity store.** `/core` owns entities; JS owns pooled instance views | A second entity store is the duplication that produced the UE god objects and the two-smelting-sims bug | Proposed |
| **WR-9** | **glTF Transform 4.4.1, meshopt not Draco** | npm gltfpack cannot do `-tc` (needs a native binary); glTF Transform bundles its encoders; meshopt's decoder is far smaller and SIMD-accelerated | Proposed |
| **WR-10** | **Voxel edits are an append-only op log** mirrored to every WASM instance | The only mutable state both main thread and workers need; a set is order-independent so convergence is bit-exact; it is also the save format and the future replication format | Proposed |
| **WR-11** | **`window.__of` is a first-class deliverable**, and `__of.settle()` gates every capture | The dev loop is the reason for the pivot. Race-free captures and JSON assertions are what make a headless agent loop possible at all | Proposed |

---

## 15. W0 / W1 implementation record (2026-07-25)

What the `web/` client actually does after milestones W0 and W1, and every place reality diverged
from the design above. Written from measurements on Chrome / ANGLE D3D11 / RTX 4060 Ti at
1600 x 900, captured by `web/tools/smoke/run.mjs`.

### 15.1 Measured numbers

| Thing | Budget (section 10) | Measured |
|---|---|---|
| Main-thread oracle, per call | single-digit us | `baseHeight` 2.1 to 3.2 us · `surfaceHeight` 1.9 to 2.9 · `biomeAt` 1.2 to 2.0 · `solidAt` 1.9 to 2.5 |
| Chunk build + pack, per chunk (worker) | <= 12 ms (DW-13) | **1.8 to 3.5 ms** (streamer walk plus pack plus de-interleave, batches of 16) |
| Chunk upload to the pool, per frame | inside 1.5 ms main thread | **0.3 to 0.9 ms** for a whole 16-chunk batch |
| Worker round trip | | 8 to 130 ms depending on batch size |
| Draw calls, surface | <= 150 target | **70 to 107** |
| Draw calls, from 1,600 km | <= 150 target | **95 to 99** |
| Triangles | <= 2.7 M | **145k to 250k** |
| Frame p50 / p99 | 16.6 / 25 ms | **0.2 to 0.4 / 0.6 to 1.1 ms** (W1 has no shadows, atmosphere, foliage or factory yet) |
| Pooled terrain VRAM | 13 MB | **12.0 MB** (384 x 32,859 B) plus one 13.8 kB shared index |
| Resident chunks | 200 | 96 in orbit · 183 to 273 on the surface · pool never exhausted |
| WASM module load | | 16 to 38 ms main thread, 5 to 9 ms per worker |

### 15.2 Divergences from the design, and why

1. **Chunk vertex delivery is de-interleaved, not interleaved** (section 4.2 note). three.js cannot
   bind mixed attribute types from one `InterleavedBuffer`.
2. **`of_observer_latlon_alt` is NOT used, and should be treated as a bridge defect.** It is built
   on `sampleRawHeight`: at lat 48 / lon 18 on Forge it returns **4,075.51 m** where the designed
   surface (`baseHeight` === `sampleDesignedHeight`, WG-21) is **6,520.81 m**. An "altitude 60 m"
   observer therefore starts **2.4 km underground** and every terrain mesh renders behind the
   camera. This is precisely the multiple-surfaces failure D-011 exists to prevent.
   `SurfaceOracle.observerPos` derives the position from `surfaceRadius` instead. **Raised to
   core-engine: either rebase the helper on the designed surface or delete it.**
3. **`of_chunk_max_offset` excludes the skirt ring** and cannot be used as a bounding-sphere radius:
   it reports 52,639 m for a depth-3 chunk whose furthest vertex is at 108,403 m, which
   frustum-culls chunks that are genuinely on screen. The exact radius is computed for free in the
   worker's de-interleave loop instead.
4. **Skirts are off** (section 4.5, mechanism 1 withdrawn).
5. **A custom `ShaderMaterial` must not include `<tonemapping_pars_fragment>` or
   `<colorspace_pars_fragment>`.** `WebGLProgram` already injects both into every ShaderMaterial
   prefix when `toneMapping` and `outputColorSpace` are set; including them again is a hard compile
   failure ("function already has a body") and the material then draws nothing while still counting
   draw calls. Only the BODY chunks belong in the shader. `DepthPolicy` follows the same rule for
   the log-depth chunks.
6. **`renderer.info.autoReset` must be false.** three resets `info` at the top of every `render()`,
   so with the four-pass ladder the counters would only ever describe pass 4.
7. **`/core` has no runtime setter for `maxDepth` or `genBudget`**, so `Regime` tunes the near/far
   split only; the streamer is created once from `Config`.
8. **`nearDepthCutoff` is "the finest depth still allowed in the far scene, plus one".** The design
   text says orbit uses cutoff 0, but a chunk is near when `depth >= cutoff`, so 0 would put the
   entire planet in the near scene where the 100 km far plane culls it. `Regime.ALL_FAR` (99) is the
   orbit value.
9. **`src/workers/` lives under `src/`**, not beside it, so it is inside the TypeScript project and
   Vite's worker resolution.
10. **The chunk key comes from `of_chunk_meta`, never `of_streamer_ready_keys`.** Meta is the same
    indexed per-chunk accessor family as the anchor and the packed buffer, so key, anchor and
    vertices are guaranteed to describe the same quad.

Added at W2 (2026-07-25):

11. **Headless Chrome does not pump `requestAnimationFrame` continuously, and W1's numbers were
    measured in a burst.** A 20 second scripted walk advanced **90 fixed ticks**: rAF fired for
    roughly a second after load and then stalled, and `Loop`'s `dt` clamp (0.25 s) plus `MAX_CATCHUP`
    (5) threw away every real-time gap. Any driven verification written the obvious way is silently
    measuring a **standing still** player. `Loop.run(seconds, renderHz)` advances a synthetic clock
    instead: same `fixedTick`, same drain, same render, but deterministic and about 15x faster than
    wall clock. `renderHz` defaults to **144.3**, deliberately not a multiple of 60, so
    `of::SimClock`'s alpha sweeps its whole range rather than sitting at one value.
12. **`--evalfile` probes silently returned `undefined`.** The wrapper was `((OF_ARGS) => { return
    <file> })(args)` and every probe starts with a comment block, so ASI turned it into `return;`.
    The file body is now wrapped in parentheses. Worth knowing because the failure mode is a
    **passing** smoke run with no result rather than an error.
13. **The float32 `matrixWorld` risk the W1 handoff raised does not exist in the form predicted, and
    the rebase threshold is irrelevant to it.** three composes `modelViewMatrix` in **f64** as
    `camera.matrixWorldInverse * object.matrixWorld` and downcasts only the CAMERA-RELATIVE result on
    upload, so the quantization scales with camera-to-anchor distance and never with distance from
    the floating origin. Replaying that pipeline exactly (`Math.fround` on the 16 elements and on the
    vertex, multiplied in f32) over a 5 km walk on real resident chunks: **max 0.139 mm, mean
    0.024 mm, frame-to-frame 0.188 mm = 0.033 px**, and **identical to 8 significant figures** at
    rebase thresholds of 250 m and 4,000 m. The predicted 7.8 mm applies to an object at the 100 km
    near plane, where it subtends 0.00007 px. **Do not "fix" this by rebasing harder.**
14. **The real walk jitter was fixed-tick aliasing, and it is 19,000x larger.** The capsule advances
    at 60 Hz and rendering samples it at vsync; without interpolation the eye traces a staircase
    whose step is exactly one tick of travel. Second difference of the eye over a 60 s walk:
    **mean 64.76 mm / max 77.99 mm before, mean 0.0034 mm / max 3.69 mm after**. `?interp=0`
    reproduces the before. Any new world-anchored, tick-driven visual (W3's shadows, W6's machines)
    needs the same alpha treatment or it will judder against the terrain.
15. **The "LOD T-junction cracks" in `W1_streaming.png` were a MISDIAGNOSIS.** The wide dark vertical
    slits in the mesa are steep, unlit gullies, not holes: rendering the same framing with
    `?clear=ff00ff` shows **not one void pixel** in them. Real cracks were there, but they are thin
    and elsewhere: **139 void pixels** in that framing, gone to **0** with edge stitching on. A dark
    slit and a hole are indistinguishable against a black sky, so `?clear=` and
    `Loop.frameHash().holePixels` now exist and any future crack claim should carry a number.
16. **Edge stitching reads the LIVE resident set, not `of_chunk_neighbour_depths`.** `/core`
    annotates neighbour depths only on freshly-**ready** chunks, so an already-resident chunk whose
    neighbour later merges keeps a stale answer and its crack reopens with nothing to trigger a
    rebuild. `TerrainStream.stitchAll` derives the four strides from the resident map (skipping
    chunks hidden by coverage, or the always-resident depth-2 shells would be found as everyone's
    coarse neighbour and snap the planet to a 7 km grid). Snapping is destructive and a stride can
    go back DOWN, so `ChunkView` retains the pristine payload: 32,859 B per resident chunk, 12.6 MB
    at a 384 pool.
17. **The default framebuffer's depth attachment is 24-bit FIXED POINT** (`DEPTH_BITS` 24,
    `FRAMEBUFFER_ATTACHMENT_COMPONENT_TYPE` is not `FLOAT`), so reversed-Z cannot deliver its
    headline win, which needs a float depth buffer. It is still clearly worth having: measured at
    2 km with a 2 m separation, reversed-Z bleeds **2.1%** where plain depth bleeds **100%**, because
    reversed-Z keeps the depth value near 0 where f32 in the pipeline is dense. See section 16.2 for
    the full curve.
18. **Cube-face seams are not stitchable and are not stitched.** Chunks on adjacent cube faces share
    no vertex lattice, so `neighbourStrides` skips off-face neighbours exactly as `/core`'s own
    `annotateNeighbours` does. No crack from a face seam was observed at W2; if one appears it needs
    a different mechanism.
19. **A limb artefact exists in the far scene and is NOT a LOD crack.** From orbit, `?clear=ff00ff`
    shows **279 void pixels (194 ppm)**, all in a ragged fringe on the planet's silhouette, and edge
    stitching does not change the number by one pixel (at that altitude every resident chunk is
    depth 2, so there are no LOD boundaries at all). It is the coarse terrain shell and the
    `PlanetProxy` sphere interleaving at grazing angles, both carrying relief at different
    resolutions. W3/W8 item.

### 15.3 The dev loop, concretely

```
# once per session (or use the .claude/launch.json entry "of-web")
npm --prefix web run dev

# then, per capture, from web/
node tools/smoke/run.mjs --scenario=surface --out=docs/screenshots/x.png
node tools/smoke/run.mjs --scenario=space --seed=1234 --settle=30
node tools/smoke/run.mjs --scenario=surface --eval='(async()=>{ ...window.__of... })()'
```

Headless Chrome via `playwright-core` against the locally installed browser (no download). The
runner waits for `__of.ready`, runs an optional `--eval` probe whose return value is included in the
report, waits for `__of.settle(n)` (which gates on `StreamUpdate.converged`), screenshots, prints
`__of.stats()` / `__of.world()` / `__of.scene()` as JSON, and **fails on any `console.error`,
`pageerror`, failed request or WebGL warning**. That last rule is what caught divergence 5 above:
the terrain material was submitting 70 draw calls per frame and painting nothing.

### 15.4 Verified at W1

* The planet renders from 1,600 km and from 40 m, from real streamed `/core` geometry.
* Streaming adds and removes: a 110 km teleport streamed **66 new chunks in and evicted 48**, pool
  219 in use / 165 free, never exhausted, zero reallocation.
* Determinism: `?seed=1234` produced **byte-identical PNGs across two separate page loads**, and
  `?seed=9999` produced a different planet.
* Cross-instance determinism in the browser: a second `/core` instance in a Web Worker agrees with
  the main-thread instance **bit-for-bit** over 512 sampled directions (IEEE-754 patterns compared).
* Reversed-Z is active (`EXT_clip_control` present), so the log-depth path is untested in practice.

### 15.5 Outstanding into W2

* `?scenario=zfight` exists as a start state but the five-scale probe scene and the frame-diff
  assertion are not built.
* LOD T-junction cracks (section 4.5 mechanism 2, edge stitching in the worker).
* Cross-fade on stream-in (section 4.5 mechanism 3) is not implemented; chunks pop.
* `FloatingOrigin` is wired with the one broadcast and one subscriber and rebases correctly on a
  teleport, but has not been exercised by a sustained walk. That is the W2 risk.

*(All three closed at W2. Edge stitching landed on the MAIN THREAD, not in the worker; see 15.2
item 16 for why.)*

---

## 16. W2 implementation record (2026-07-25)

Character controller, sustained-walk floating origin, LOD edge stitching and the depth probe.
Same machine as section 15: Chrome / ANGLE D3D11 / RTX 4060 Ti at 1600 x 900.

### 16.1 Measured numbers

| Thing | Budget (section 10) | Measured |
|---|---|---|
| Character step, oracle calls per tick | ~20 us (section 2.3) | **3 calls** (`surfaceRadius` + a 2-tap slope gradient) at 2.1 to 3.3 us |
| Grounded, over a driven 5 km walk | every tick | **100%** of polled ticks, eye alt 1.62 m at every sample |
| Walk speed held | 4.6 m/s | **4.60 m/s**, 5,014 m of ground travel in 1,090 s |
| Streaming during the walk | ring add/evict | **372 chunks built**, 18 added and 18 evicted, pool 252/384, never exhausted |
| Rebases over 5 km | >= 3 (exit gate) | **1** at the production 4,000 m threshold, **20** at 250 m |
| Rebase visibility | invisible | **1 of 1,296 luminance tiles differs, by 0.01 of 255** between a 1-rebase and a 20-rebase run of the same walk |
| Walk jitter (fixed-tick aliasing) | not budgeted | **64.76 mm mean before, 0.0034 mm after** (second difference of the eye) |
| Walk jitter (float32 modelView) | not budgeted | **0.024 mm mean, 0.139 mm max, 0.033 px** |
| LOD crack pixels, surface framing | 0 | **139 without stitching, 0 with** |
| Edge stitch cost | inside 1.5 ms main thread | **0.1 to 0.2 ms**, and only when the resident set changes |
| Draw calls, walking | <= 150 | **69 to 81** |
| Triangles, walking | <= 2.7 M | **157k to 161k** |
| Frame p50 / p95 / p99, walking | 16.6 / 18 / 25 ms | **0.3 / 0.6 / 0.8 ms**, worst 1.7 ms including rebase frames |
| Pooled terrain VRAM | 13 MB | **12.0 MB**, flat |
| Chunk payload retained for restitching | not budgeted | **12.6 MB** JS heap at a 384 pool (alert 384 MB) |

### 16.2 The depth probe: DW-3 closed by measurement

`?scenario=zfight` builds the five scales from section 3.3 as GREEN front / RED back quad pairs and
reads each pair's interior back with `gl.readPixels` every rendered frame while the camera sweeps.
Correct depth ordering is **0% red**; a tie reads 100% red, because the later draw wins. That is
stronger than a frame diff (it is unambiguous in a single frame), and the frame-to-frame change in
the same number is the frame-diff assertion.

Minimum separation each scale resolves, as a fraction of its distance, swept with `?zsep=`:

| Scale | reversed-Z (default) | log depth | plain |
|---|---|---|---|
| decal @ 1 m | **1e-4** (0.1 mm) | 1e-5 (10 um) | ok |
| machine @ 30 m | **1e-4** (3 mm) | 1e-5 (0.3 mm) | ok |
| cliff @ 2 km | **1e-2** (20 m); 1e-3 bleeds 2.1% | 1e-5 (20 mm) | **fails at 1e-3 (100%)** |
| mountain @ 60 km | **1e-1** (6 km) | 1e-5 (0.6 m) | out of range (far plane 30 km) |
| moon @ 400,000 km (far cam) | **3e-2** (12,000 km) | 1e-5 (4,000 km) | 1e-3 bleeds 70.8% |

**Verdict: DW-3 stands, with a documented ceiling.** The camera split plus reversed-Z resolves
everything content actually sits at. Reversed-Z beats plain depth by roughly 50x at 2 km even though
the buffer is fixed point (15.2 item 17), and log depth remains a working, measured fallback that is
clean at 1e-5 at every scale if W3 ever needs far-field separation inside the near camera.

The near camera's weak half is 20 km to 100 km, where it cannot separate surfaces closer than about
0.4% of the distance. Nothing is at risk today because `nearDepthCutoff` moves anything coarser than
depth 6 (chunks beyond roughly 15 km) into the far scene. **If W3 puts anything thin and layered at
20 km or more in the NEAR scene, re-run this probe first.**

A default run (`?zsep` absent) uses each scale's measured budget, so it is a regression gate rather
than an arbitrary threshold, and it currently returns `verdict: PASS` with 0% bleed and 0% delta.

### 16.3 Verified at W2

* It walks. A driven 5 km walk at 4.6 m/s, grounded 100% of the way, terrain streaming around the
  walker, at 0.3 ms p50.
* FP is the default and V toggles to TP. The aim ray is **identical bit for bit** across four
  toggles including one with the spring arm fully extended, at yaw 54.774765 / pitch -20.540537.
  The own body is on `LAYER_PLAYER_BODY` and is culled by CAMERA layer in FP, not by object
  visibility, so a W3 shadow caster will still see it.
* Rebasing is invisible as PIXELS, not as an argument: the same walk at a 4,000 m and a 250 m
  threshold ends at a bit-identical lat/lon with origins 1 km apart and presents the same frame to
  within one tile of 1,296, by 0.01 of 255.
* LOD cracks are gone in the near scene, counted rather than eyeballed: 139 void pixels to 0.
* The depth probe passes at every scale's budget and the whole precision curve is recorded above.

### 16.4 Outstanding into W3

* **Cross-fade on stream-in (section 4.5 mechanism 3) is still not implemented; chunks pop.** It is
  now the most visible remaining terrain artefact during a walk.
* **The far-scene limb fringe** (15.2 item 19): 279 void pixels from orbit where the coarse terrain
  shell and the `PlanetProxy` interleave. Cosmetic today, ugly against a lit atmosphere.
* **`maxDepth` defaults to 12, not the 14 in section 3.2.** Ground under the player is a 7.2 m
  vertex grid, which reads as smooth and featureless up close. Raising it multiplies the resident
  set; measure before changing.
* **Gravity is transcribed, not bridged.** `KinematicBody.gravityAccel` copies
  `of::SurfaceObserver::gravityAccel()` including its constants, because the bridge does not export
  it. On Forge that is 0.587 m/s^2, so jumps are deliberately floaty. Raised to core-engine.
* **The near-field voxel sweep is written but dormant.** `KinematicBody.resolveVoxels` runs only
  when an edit set is bound, because on a pristine world `solidAt` is just "below the heightfield"
  and the ground resolve has already handled it. W5 arms it, and W5 is where face-axis resolution
  and step-up have to be finished.
* **Aim rays, placement and harvest** (`player/Interaction.ts`) are not built. The aim ray exists and
  is asserted; nothing consumes it yet.
