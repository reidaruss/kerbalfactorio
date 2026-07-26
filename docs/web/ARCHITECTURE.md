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
3. **Cross-fade. SHIPPED at W3, with one addition the design did not anticipate.**
   A per-chunk fade START TIME rides in an `aFadeT0` attribute (written once at
   stream-in, never per frame) and the ramp comes from one global `uTime`, driving a
   dithered (Bayer 4×4) alpha test. **The addition: the OUTGOING chunk has to be held
   for the length of the dissolve.** `/core` evicts a parent in the *same*
   `StreamUpdate` its four children arrive, so fading only the incoming half leaves
   the dither with nothing behind it and the "fade" reads as a hole punched in the
   ground. `world/ChunkRetire.ts` keeps the evicted view and its pooled slot for
   `fadeSecs` and stamps it with a **negative** `aFadeT0`, which the shader reads as
   the complementary dither threshold, so exactly one of the pair covers each pixel
   and they never z-fight. Measured in section 17.2. `?fade=0` reproduces the pop.

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

> **W3 (2026-07-25): `CSM.js` is NOT used, and cannot be.** It patches materials
> through `onBeforeCompile` at `#include <lights_fragment_begin>`, and
> `TerrainMaterial` is a `ShaderMaterial` that lights itself from `uSunDir`, so
> there is no such include to patch. `render/ShadowRig.ts` instead makes each
> cascade a real `THREE.DirectionalLight` with `castShadow`, which leaves three
> owning the depth material, the reversed-depth projection flip, the packing, the
> PCF kernel and the per-cascade frustum culling. Cascades 1 and 2 carry
> **intensity 0**: they exist only to produce a map, and the terrain shader picks
> between them by view depth with constant sampler indices (GLSL ES 3.00 forbids
> dynamic indexing of a sampler array). Only the near scene holds shadow-casting
> lights, so `WebGLShadowMap` returns early for the sky, far and view-model passes
> and the maps render **once** per frame, not four times.

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

- **W3 (SHIPPED, and `Sky.js` was skipped entirely).** The Preetham stand-in was not
  built: it does not fade to black from space, and the analytic model turned out to
  cost less than the measurement floor, so there was nothing to stage. `SkyAtmosphere`
  is a **skybox BOX in the SKY pass**, not a full-screen quad in the far scene: the
  sky camera never translates, so the fragment's object-space position IS the view
  ray and no inverse-matrix uniform is needed at all.
- Analytic single scattering, Rayleigh + Mie, ray-marched, **10 view x 3 light samples
  on high** (6x2 low, 8x3 med) and **4 x 2 for aerial perspective**, where the segment
  is short and nearly iso-altitude. Measured at 1600x900 on an RTX 4060 Ti: **below the
  0.03 ms run-to-run variance**, so no half-resolution pass was needed. Scale that by
  roughly 4x for the GTX 1660 target before assuming it is free there.

**Aerial perspective is in `TerrainMaterial`, not post-processing** (§4.4): the same optical-depth function evaluated along the fragment's view ray. Mountains at 40 km go blue and the horizon matches the sky exactly, with no depth-buffer round trip and no post pass. This is the single cheapest big visual win available.

**The near/far agreement is structural, and it is measured.** `materials/Atmosphere.glsl.ts`
holds ONE model, exported as a GLSL string and as ONE uniform record **shared by
reference** between the sky material and both terrain materials, so there is nothing to
keep in sync. Every position handed to it is **planet-centred metres**; the near scene
subtracts the body centre and the scaled scene multiplies by `uMetresPerUnit` = 1e5, and
that is the only difference between them. Verified at W3 by moving 56 chunks from the far
scaled scene into the near 1:1 scene (`?cutoff=6` against `?cutoff=3`) and diffing the
frame: **zero of 14,400 tile means differ**.

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
| **W2** | **Floating origin + walk** ✅ **shipped 2026-07-25, see §16** | `KinematicBody` vs the oracle, FP/TP with an aim-preserving toggle, the one `OriginRebased` broadcast, chunk re-anchor, input tapes, edge stitching, the depth probe | scripted 5 km walk ✅ · grounded every tick ✅ (100%) · frame p95 ≤ 18 ms ✅ (0.6 ms) · no jitter ✅ (64.76 mm → 0.0034 mm). **"≥ 3 rebases" was written against a threshold that does not produce three in 5 km:** `of::FloatingOrigin`'s 4,000 m default fires **once**. Read as "rebases fire during a sustained walk and are invisible", which is verified at 1 and at 20 rebases, as pixels (§16.1) |
| **W3** | **Sky, sun, shadows, atmosphere** ✅ **shipped 2026-07-25, see §17** | star field, cascaded shadows (NOT `CSM.js`, see §7.2), `SkyAtmosphere` analytic scattering, aerial perspective in `TerrainMaterial`, day/night, stream-in cross-fade, the missing cube faces | 7 golden images ✅ · shadow VRAM ≤ 50 MB ✅ (48.0) · GPU ≤ 10 ms ✅ (0.99 ms whole frame). **The runtime IBL was NOT built:** `TerrainMaterial` reads the sky ambient from the same scattering integral per fragment, so a 64² cubemap plus `PMREMGenerator` would be a second, coarser answer to a question already answered. Revisit at W4 when stock PBR materials arrive and actually need an `environment` |
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

Added at W3 (2026-07-25):

20. **The "limb fringe" of item 19 was a MISDIAGNOSIS, and the real defect was much
    larger.** `/core` parametrizes three of its six cube faces **left-handed**, so one
    shared index buffer makes those faces back-facing and `side: FrontSide` culled them
    away entirely. From orbit with the `PlanetProxy` hidden: **150,265 void pixels**
    before, **0** after. The proxy was filling the hole, which is why W1 and W2 only ever
    saw the 279-pixel residue at the limb where the proxy's silhouette ends.
    `SharedIndex` now carries a second, mirrored buffer and the pool picks per chunk by
    **measuring** the first triangle's winding against the vertex normal `/core` already
    stored, so a convention change cannot silently reintroduce it. `?side=double` was the
    one-line test that found it.
21. **`Loop.countHoles` has a floor, and `space` is at it.** The heuristic counts
    clear-colour pixels with a run of opaque pixels above them in the same column, which
    at the left and right flanks of a planet DISC counts genuine space. A perfect
    analytic sphere in the `space` framing reports **3,088**; the terrain shell reports
    **3,067**. Any future void census at that altitude has to compare against the sphere,
    not against zero. `orbit`, `ascent` and `surface` all report 0 and are trustworthy.
22. **The cross-fade needs the outgoing chunk, not just the incoming one.** See §4.5
    mechanism 3. Fading only the arrival made the artefact **fifteen times worse** than
    the pop it was meant to fix.
23. **In GLSL, `-0.0 >= 0.0` is TRUE.** The cross-fade encoded the outgoing half as a
    negated ramp, so at ramp 0 the outgoing chunk took the *incoming* branch for exactly
    the first frame of every dissolve, both halves discarded everything, and the bright
    far-scene terrain showed through the ground for one frame (191/255 tile impulse). The
    outgoing ramp now lives in [-2,-1], where no value can be mistaken for the other
    half. **Never use the sign of a computed float as a discriminator without an offset.**
24. **A shadow camera tests layer 0 only.** `WebGLShadowMap` culls casters with
    `object.layers.test(shadowCamera.layers)`, so the player body on `LAYER_PLAYER_BODY`
    never entered the map and §3.4's "the player still casts a shadow" was quietly false
    until `light.shadow.camera.layers.enable(LAYER_PLAYER_BODY)`. Anything W4 puts on a
    non-default layer needs the same line.
25. **Do NOT set `HAS_NORMAL` in a material's `defines`.** `WebGLProgram` already emits
    it for any geometry with a normal attribute, and defining it twice is a hard compile
    failure. `shadowmap_vertex` reads it to decide whether to apply the normal bias, so
    it must come from three.
26. **A `lights: true` `ShaderMaterial` must merge `UniformsLib.lights`.** three writes
    `ambientLightColor`, `directionalLights`, `directionalShadowMap` and friends straight
    into `material.uniforms` and throws if the slots are missing. Merge them, then
    `Object.assign` your own uniforms AFTER, because `UniformsUtils.merge` deep-clones and
    would break any uniform object you are deliberately sharing by reference.
27. **`Loop.run(1/60)` never yields a macrotask, so a one-frame-at-a-time probe streams
    nothing.** `run()` only awaits a `setTimeout` every 8 frames, and a worker
    `postMessage` needs one. The first pop probe reported `chunksBuilt: 0` over a
    kilometre of walking and was measuring a world that never streamed. Every
    frame-stepping probe must `await new Promise(r => setTimeout(r, 0))` itself. This is
    DW-20 in miniature and it is the third time this class of bug has appeared.
28. **A tile-mean frame hash cannot see a chunk swap.** `frameHash` averages 8x8 pixel
    blocks, which divides a few thousand changed pixels by 64. `render/debug/FrameDiff.ts`
    keeps two frames of luminance and reports the per-PIXEL second difference; that is the
    instrument that separated a 25-pixel walk artefact from a 166,446-pixel teleport one.
29. **`run.mjs --out` cannot photograph a transition.** It fires after `settle()`, which by
    design waits for the world to stop changing. `probes/popshot.js` grabs the canvas with
    `toDataURL` inside the same task as the render, and `tools/smoke/writeshot.mjs` decodes
    it. Any future before/after pair of a moving artefact needs that path.
30. **The atmosphere breaks `?clear=`.** A painted sky makes every void pixel opaque, so a
    hole census silently reads zero. `Boot` disables the sky whenever `clearColor` is set,
    rather than requiring every crack probe to remember `--atmos=0`.

Added at W4 (2026-07-25):

31. **`BatchedMesh` costs the shared index buffer, and that is the price of the
    draw-call collapse.** Each slot needs its OWN index range inside the batch
    (offset by its `vertexStart`), so `SharedIndex`'s one 13.5 kB buffer for 384
    chunks becomes 6,912 x 4 B per slot. Pooled terrain went **12.0 MB to
    28.4 MB** at 2 x 230 slots. Draw calls went **118 to 8** on the same framing,
    with the same 241,312 triangles, so it is clearly worth it, but the §10.2
    line "Near terrain 13 MB pooled" is now wrong by design.
32. **Terrain needs TWO batches, not one.** A `BatchedMesh` has one material and
    one parent, and the near 1:1 scene and the scaled far scene differ in both.
    `ChunkGeometryPool` therefore has two free lists, and a chunk crossing
    `nearDepthCutoff` swaps slots and is re-uploaded from its retained pristine
    payload. That is a second reason the payload is retained (the first was edge
    stitching) and it only happens on a regime change.
33. **`setGeometryAt` is not the upload path.** It copies the index one element
    at a time (6,912 `setX` calls per chunk) and re-derives the bounding sphere
    by scanning every vertex. `ChunkBatch` writes the slot's window with
    `array.set()` plus an explicit `addUpdateRange`, and touches three's private
    `_geometryInfo` to set the bounding sphere and the skirt draw range. That is
    the only private access in the codebase and it is contained in one file.
34. **A view must not claim to be visible before its slot is.** `ChunkBatch`
    allocates every instance invisible; `ChunkView.visible` started `true`, so
    the first `setVisible(true)` was a no-op and the terrain never drew. The
    frame reported **3 draw calls** and looked like a triumph in the JSON. Any
    handle over a pooled GPU slot must initialise to the slot's actual state.
35. **`GLTFLoader` splits a multi-primitive mesh into `<name>_0`, `<name>_1`...**,
    so the player body's six materials arrive as `Player_LOD0_0` through
    `Player_LOD0_5` and a `_LOD(\d)$` anchor matches none of them. All three LOD
    levels drew at once: 103 draw calls where 49 was the truth, with LOD1 and
    LOD2 z-fighting invisibly inside LOD0. Every LOD selector needs `(_\d+)?`.
36. **A `MeshStandardMaterial` is only shadowed by a light that CASTS.** W3's
    near scene had a non-casting sun plus three intensity-0 cascades, so the
    player was lit and never shadowed by the ground under him (§17.4). Cascade 0
    is now also the sun and Boot adds no second directional. **The view-model
    pass has no lights at all**, which is separate and easy to miss: the FP arms
    rendered as a black silhouette until that scene got its own hemisphere, its
    own sun and the same IBL.
37. **`PMREMGenerator.fromScene` allocates a new render target every call and
    offers no way to reuse one.** Disposing only `.texture` leaks the target:
    `info.memory.textures` climbed past 50 and the near pass hit **170 ms**. The
    renderer seam owns the target now, and the IBL is 64^2 per §7.1.
38. **`BatchedMesh` per-instance frustum culling is a LOSS for small props**,
    against §6.2's prediction that it "matters most here". `onBeforeRender` walks
    every live slot once per pass doing a `getMatrixAt`, a bounding-sphere copy,
    a transform and a frustum test. At 9,340 props over four passes (main plus
    three cascades) that measured **8.2 ms** of near pass with sorting on and
    **11.1 ms** with it off; with culling AND sorting off the method early-returns
    and the cost is zero for roughly twice the triangles. Terrain keeps culling
    on (33 x 33 chunks are worth testing); the factory at W6 should re-measure.
39. **Prop slots are allocated LAZILY.** Priming 7,000 per material up front cost
    **2.5 s** at boot and made every pass walk 70,000 slots for a scene holding
    9,340 props in five batches.
40. **Scatter placement is limited by the LOD the streamer actually reaches, not
    by `maxDepth`.** Under a walking player at `maxDepth` 12 the finest resident
    chunk is **depth 11**, about 900 m across, so its grid cell is about 28 m and
    on high mountains it is coarser still. The first scatter used a 14 m cell
    limit, rejected every chunk on the planet, and reported success with zero
    instances. Props are placed by bilinear interpolation inside a cell, so the
    cell size IS the placement accuracy, and DW-19's finer LOD is what fixes both.
41. **Scatter walks CELLS inside the radius, not the chunk.** A uniform draw over
    a 900 m chunk puts nine props in ten outside a 170 m scatter radius, and the
    ground under the player reads as empty. Per-cell placement also makes density
    mean instances per square kilometre of GROUND, independent of chunk depth.
42. **A 40-degree slope limit empties the Mountains biome.** A mountain flank is
    steeper than that almost everywhere, so the one biome whose identity is loose
    rock had no loose rock on it. 57 degrees is the shipped value.
43. **The browser was serving a WASM three commits stale, and it looked exactly
    like the bug it was hiding.** `web/wasm/build.ps1` writes `web/wasm/dist`;
    the client loads `web/public/wasm`, which is gitignored and only refreshed by
    `npm run sync-wasm`. Nothing had run it since before the DW-19 fix, so the
    browser kept producing byte-identical resident sets at `maxDepth` 12, 13, 14
    and 15 — the precise signature of the saturating metric that had already been
    fixed in `/core`. **A rebuild is not a deploy.** Any `/core` change must end
    with `build.ps1` AND `sync-wasm`, and a bridge measurement that disagrees with
    the native one should suspect the binary before the algorithm.
44. **`chunks()` reports `meshPos` in RENDER space, so ranking by `|meshPos|`
    measures distance from the floating ORIGIN, not from the camera.** The origin
    had drifted 549 m over the probe's walk (rebases 0), so the "chunk under the
    player's feet" came back as a depth-12 neighbour while depth-14 chunks were
    genuinely underfoot: the LOD tuning read as two levels worse than it was.
    `world().eyeRel` now publishes the eye in render space, and the probe asserts
    `containsFeet` (centre within half a chunk diagonal) instead of trusting a
    sort. This is item 21's floating-origin trap in a new costume.
45. **The LOD split metric measures the observer to the quad CENTRE, so `s/d`
    tops out near 2 and `splitRatio` has a CLIFF rather than a curve.** A quad the
    observer stands inside reports up to a half-diagonal of distance, so at
    `splitRatio` 2.0 a face root stops splitting and the entire quadtree collapses
    to the `minResidentDepth` shell: measured on a mountain as 108 chunks, 0 near,
    no terrain in the near scene at all. Below the cliff the ratio behaves as
    designed. 1.4 ships because it is the highest value that still refines on a
    mountain; a future distance-to-nearest-point metric would remove the cliff and
    let the far field go coarser, at the cost of re-baselining the LOD pins.
46. **A transcribed constant is a second authority wearing a copy's clothes.**
    `KinematicBody.gravityAccel` reimplemented `/core`'s uniform-density gravity
    in JS "EXACTLY, constants included", and was correct on the day it was
    written. The moment DW-18 moved `/core` to `mu`, that comment was the only
    thing holding the browser at 0.587 m/s^2 while the propagator ran at 9.81.
    Standing rule 1 is not only about terrain height: anything the browser can
    ask `/core` for, it must ask for. `of_body_mu` / `of_gravity_accel` are the
    additive ABI-2 exports that closed it.
47. **"Below the ground" is not "landing" once tunnels exist.** The W2 walker
    snapped the feet to `surfaceRadius` whenever `gap <= 0`, which is correct for
    every world without an overhang. Two strikes into a tunnel wall and the next
    step teleported the player out through their own ceiling, because a sideways
    tunnel leaves the top of its column solid, `derivedLoweringAt` correctly
    reports no lowering, and `surfaceRadius` still names the hillside metres
    overhead. Once the feet are DEEP below the heightfield (1.5 m, more than a
    voxel and less than a capsule) the voxel world is the only authority: floor
    from `solidCell`, and a step into rock REFUSED rather than resolved upward.
48. **A radial push sized from the whole capsule levitates the player out of a
    tunnel.** `resolveVoxels` samples six points up the capsule and pushes the
    feet outward far enough to clear the deepest one. That is right for a dig
    rim; inside a tunnel the HEAD sample sits under the ceiling, the push fires
    at 2.8 m, and the player rises through the roof one tick at a time. It
    ejected to open sky on the third strike, every time, and it looked like the
    dig failing rather than the collision resolving. Skipped entirely when deep.
49. **Both of the above were found by a PER-STRIKE TRACE, not by reading the
    code.** The dig probe records altitude, grounded and surface height after
    every strike; "hits 7, misses 15" said nothing, while the trace showed the
    surface height jumping 7 m between two consecutive samples and named the
    failure immediately. When a driven probe reports a bad aggregate, the next
    move is to make it report a sequence.
50. **The voxel re-mesh cost is the surface ORACLE, not the mesher.**
    `exposedFaces` tests six neighbours per cell and every `isSolid` evaluates
    the designed-height noise stack at about 2 us, so a modest dirty box costs
    27 to 69 ms for a few hundred faces while the greedy merge itself is
    microseconds. The fix is a per-column base-height cache over the dirty box,
    not a faster mesher; the greedy pass is already returning a 1.4x to 2.2x
    merge and is not where the time goes.

51. **The harvest nodes were never in the world.** ASSET-SPECS records all nine
    node `.glb` files as built and validated, and STATUS calls the art manifest
    complete, so "the biome harvest nodes are already scattered" reads as true
    from the docs. Nothing placed them: `Registry.ts` had no node entry,
    `BIOME_PROPS` lists only Tier 1 decoration, and `Scatter.ts` scatters that
    decoration alone. A validated asset that no system references is invisible
    at every gate the project has, because `validate_glb.py` checks the file and
    `check-limits` checks the source and neither asks whether anything reads it.

52. **`worldgen::survival::LayoutTestArea` cannot place a walkable clearing.**
    It jitters every node by up to 0.0003 rad, which is **180 m** at Forge's
    600 km radius. That is proportionate to the 1.2 km test ring it was written
    for and useless at any radius a player would walk: at a 20 m ring the jitter
    is nine times the ring, and the "patch" is a 360 m smear. `of_gp_node_add`
    therefore takes the position from the caller and leaves every RULE with
    `/core` (resource, base amount, the position-hashed grade, and the oracle
    surface it snaps to). The general shape: a `/core` helper written for a test
    fixture is not automatically a gameplay placement primitive, and the tell is
    a tolerance expressed in radians on a 600 km body.

53. **`gameplay.h`'s `harvestNode` can never finish a node.** `InitialAmount` is
    `baseAmountOf(kind) * Grade` with `Grade` in (0.5, 1.0], so every node's
    amount is fractional. The pull is clamped with
    `pull = (uint16_t)RemainingAmount`, which is **0** once under one unit
    remains, and the function then grants 0 and decrements by 0. A node sticks
    at, say, 0.72 for ever: it never reports `nodeEmpty`, its depletion mesh can
    never reach its final state, and a "drain this node" loop does not terminate.
    Caught by parity CASE 9's drain assertion, which is only there because it
    checks a DELTA rather than a return value. `of_gp_node_harvest` collapses a
    sub-unit remainder to zero as a bridge-level fix; the real one belongs in
    `gameplay.h` and is logged for core-engine.

54. **`__of.look()` did not move the aim ray, and the first harvest probe swept
    60 yaw candidates, picked the worst one and walked 41 m the wrong way while
    reporting no error.** `ViewMode` derives `aim` in `update()`, which runs on
    the fixed tick, so `look()` immediately followed by `aim()` returned the
    PREVIOUS orientation. This is DW-20 one level up: the defect was in the
    verification API, and every driven probe that turns and then reads would
    have measured the wrong thing. `look()` now rebuilds the tangent frame
    before returning. The generalisation: an API whose write and read straddle
    the tick boundary needs the read to be immediate, or callers silently get
    last frame.

55. **An interaction sphere on a ground pivot is missed by a level crosshair.**
    Machines and harvest nodes pivot at the ground plane (ASSET-SPECS 2.7) while
    the eye is 1.6 m up, so a ray cast level from the eye passes 1.6 m above a
    1.1 m sphere centred on the origin and "press E on the furnace" does
    nothing, silently and at every range. The pick sphere is raised 0.7 m and
    widened. Worth stating because it will recur for every placeable: the pick
    volume belongs to the SILHOUETTE, not to the transform.

56. **E is one key with two verbs, and the arbitration is what the player
    means.** Digging (W5 voxels) and harvesting both landed on the mine key. A
    node under the crosshair takes the press, then a machine, then the dig.
    Splitting them onto two keys was the obvious fix and the wrong one: a player
    looking at a tree who presses mine means the tree, and cratering the ground
    under it instead reads as the game not listening.
57. **A refused STEP was refusing the whole TICK, and that is what made the
    tunnel unusable.** The underground branch tested one point (the feet), and
    on any contact it restored the previous position AND zeroed the tangential
    velocity. Brushing a wall at a glancing angle therefore stopped the player
    dead, so the excavation ran on ahead of someone who could not follow it and
    the bore looked too narrow when the resolver was the actual fault.
    `resolveDeepStep` now takes the move, climbs a ledge (0.55 / 1.1 m), or
    slides by dropping the blocked body-frame axis. Dropping an axis is not an
    approximation here: a voxel face is always perpendicular to a body-frame
    axis, so the wall normal IS an axis and the drop is the exact projection
    onto the wall plane. Measured: 0 blocked samples over a 7.73 m driven walk
    that was previously 0 m.
58. **A sphere brush of radius r does NOT clear 2r of bore.** `dig` removes
    cells whose CENTRE is inside the sphere, so the bore depends on the phase of
    the sphere against the 1 m lattice: radius 1.2 clears three cells only when
    the centre lands near a cell centre and two otherwise, which is 2 m of
    passage for a 1.8 m capsule. 1.5 is the smallest radius that guarantees a
    3x3 cross-section in every phase, because a one-cell offset on two axes is
    1.414 m (inside) and a two-cell offset is 2 m (outside). Brush radii are
    lattice questions, not diameter questions.
59. **Item 50 named the right cost and the wrong unit of work.** The oracle
    inside `exposedFaces` was indeed the whole 27 to 69 ms, but a per-column
    height cache was not available: the voxel lattice is body-frame Cartesian
    while the surface is a function of DIRECTION, so an axis-aligned column
    shares no exact sample. Three exact changes did it instead, and the third
    matters most: memoize `isProcSolid` (a pure function, so the seed+diff
    property is untouched); resolve solidity once per cell into a dense slab
    rather than up to seven times; and stop re-meshing the UNION of every box
    ever dug on every strike. That last one was O(tunnelLength^3) work per swing
    for O(1) new geometry. `VoxelMesh` now caches 8-cell BRICKS on a fixed
    disjoint lattice and re-meshes only the ones a strike touched, so the cost
    of a swing no longer grows with the length of the tunnel at all.
    **Measured on the same probe: 55.3 ms and a 61.1 ms worst frame, to 5.0 ms
    max / 1.65 ms mean and a 3.8 ms worst frame.** The brick radius is
    `(BRICK-1)/2`, not `BRICK/2`, because `exposedFaces` floors `centre +/-
    radius`: half a brick spills one cell into the next one and every boundary
    face is emitted, drawn, and z-fights with itself.
60. **A probe that walks a tunnel must be stopped before it reaches daylight.**
    The first tunnel-walk run reported `walkableTunnel false` with every sample
    showing the eye 1.6 m ABOVE the surface: the new step-up let the player
    climb straight back out of their own shaft, and the run ended measuring a
    stroll across a field. The probe now walks IN first, OUT second, on a slice
    budget short of the shaft, and asserts rock overhead plus
    `derivedLoweringAt == 0` on every sample. This is DW-20's failure mode with
    the numbers all present and plausible and the subject absent.
61. **Item 53 is CLOSED in `/core`, and the fix is "round the crumb up".** A
    positive `RemainingAmount` below one unit now yields one unit and drains the
    node, which is the rule `mineDeposit` already applied. The over-grant is
    bounded by strictly less than one unit per node over its whole life, and in
    exchange a node can be finished at all. The bridge shim that was absorbing
    it is gone. Test: `hand_harvest_finishes_a_sub_unit_remainder`.
62. **A flat per-swing yield cannot balance both a 30-unit tree and a 200-unit
    coal seam.** At 2 and 5 a tree was about 15 bare swings and a seam was 40 to
    100, which is not progression, it is a chore with a progress bar. The
    authored constant is now SWINGS-TO-CLEAR (`gameplay.h` S.2a: 6 bare, 3 with
    the matching tool) and the per-swing yield is DERIVED from the node's own
    `InitialAmount`. Measured in the browser across all five kinds: bare 6
    swings every time (tree 4/swing, rock 6, iron 29, coal 30, copper 33), tool
    3 swings every time. The generalisation: when one number has to serve
    content of wildly different sizes, author the PLAYER-FACING quantity and
    derive the content-facing one, never the other way round.
63. **One BatchedMesh per material is not automatically a win; the shadow
    cascades multiply it.** Collapsing the 24 cloned node Groups into 8
    per-material batches (the PropLibrary pattern, DW-11) measured **28 draw
    calls**, no better than the clones, because every batch is redrawn in the
    main pass and in each cascade. The six node files use eight roles but only
    TWO shading families, and every role is an untextured flat colour, so the
    colour is baked into a vertex attribute, the batch key is the family, and
    everything one file draws in one family for one variant is merged into a
    single geometry. **8 draws for the whole gameplay layer** (31 at
    `?gameplay=0`, 39 with it), surface total 39 to 40 of 150. The rule: the
    batch key is the SHADING FAMILY, and the material count only bounds it.
64. **An all-hidden BatchedMesh still costs its draw call.** Both effect systems
    are idle almost all of the time, so they set `visible` from their live count.
65. **Reach measured to a pivot is not reach.** A tree's origin is on the ground
    and the eye is 1.6 m above it, so a player at a natural chopping distance
    was 4.13 m from the pivot against a 4.0 m reach: the trunk filled the screen
    and the swing was refused, with nowhere closer to stand. Item 55 raised and
    widened the pick SPHERE and did not touch the RANGE test, which is the same
    bug one line further down. Reach now subtracts the node's own radius.
66. **The .glb shipped the furnace's fire and smoke and nothing consumed them.**
    `Furnace_FireCard` on its own `OF_EmissiveState` slot, `socket_smoke` on the
    flue, and a 180-frame flicker clip whose length IS `ticksPerSmeltFor`. The
    furnace was 180 ticks of a progress bar with a static machine underneath it.
    Three traps on the way in, all worth stating: (a) `of_lib` names every
    material `OF_<Role>`, so a match on the bare role name silently finds
    nothing, and the role ships a WHITE emissive at full strength, so the
    unclaimed card draws as a white rectangle that reads as a hole in the mesh;
    (b) ACES at exposure 1 pushes an emissive much past 1 to white, so 2.6 was
    still white and 1.15 is orange; (c) `Object3D.clone(true)` SHARES materials,
    so without a per-machine clone the first furnace to light lights every
    furnace ever placed, including the cold ones.
67. **Standing a machine on the ground normal is only half a placement.** The
    fire card is recessed in the mouth, so a machine dropped at an arbitrary yaw
    shows the player its blank back and the one signal that says "this is
    working" is invisible from where they are standing. The mouth now yaws
    towards whoever placed it.
68. **The same key read as an edge in one branch and as a level in another.**
    E closed the furnace panel on the tick it was pressed and the still-held key
    reopened it on the next, because the "panel is open" branch edge-detected
    the mine key and the "aiming at a machine" branch did not. The panel could
    not be closed by the key that opened it. One edge, computed once at the top
    of the tick, used by every branch.
69. **`FactorySim` has no entity removal, and should not grow one.** The dense
    entity index IS the render key and the SoA is append-only by design, so a
    belt run cannot gain a tile in place. The build layer therefore holds the
    PLAN as plain JS records and re-creates the whole network on any topology
    change, which is cheap (a handful of entities, only ever on a placement) and
    buys one property free: the network is always exactly what the plan says, so
    a wiring bug cannot survive one rebuild and hide. State is carried across
    explicitly (the miner keeps the ore it had LEFT, machine inputs are re-fed,
    finished output goes to the pack) and belt items in flight are genuinely
    lost, which is reported as a counter rather than swallowed. A silent loss is
    how a conservation claim rots.
70. **Two counters for the same ore is the five-surfaces failure in miniature.**
    A miner is seeded from its harvest node's remaining amount, and from then on
    the `FDepositNode` the world draws and the miner's bound deposit inside the
    sim describe the SAME ore. Without `of_gp_node_drain` the node stands full
    for ever while the ore it holds rides away on a belt. The drain is the delta
    of the miner's own remaining, so the pair conserves by construction: the
    driven probe measures node loss 64, miner extraction 64, drain 64.
71. **A float32 deposit does not reach zero by subtraction.** `RemainingAmount`
    is a float; `remaining -= (float)remaining` at deposit scale leaves a 3.6e-7
    crumb, and a node reading 0.00000036 is not empty. This is exactly the
    "node parks just above empty for ever" defect item 61 deleted from
    `harvestNode`, walking back in through a different door six weeks later. The
    drain subtracts in double and stores once, with a 1e-3 floor.
72. **The ghost's DIRECTION is snapped to a lattice axis and its POSITION is
    not, so a heading off the axis lays a diagonal.** Consecutive tiles are then
    not each other's neighbour, and `/core` correctly treats the result as two
    transport lines rather than one. It still runs (both fragments get wired),
    which is why it took a driven run to notice: the acceptance passed while the
    thing on the ground was two belts, not one. A player aligns by eye once the
    ghost shows the direction; the probe aligns by maximising the dot of the aim
    with the ghost's own `fwd`.
73. **A conservation snapshot taken when the line is FINISHED is not the start
    of the unattended window.** The factory has been ticking since the miner
    went down, including through the step back to frame the capture, so a
    snapshot taken earlier attributes those ticks' ore to the window and the
    check misses by exactly that much. It did, by 2 units of 64.
74. **Perpendicular distance to a LINE does not care which way along it the
    target lies.** The probe's yaw search scored a heading 180 degrees wrong as
    well as the right one, so it walked away from the deposit reporting a good
    aim. A DW-20 failure inside the verification harness, which is the class the
    decision exists for. The fix is one guard: infinite miss behind the eye.
75. **Belt animation costs one texel per tile (DW-8, kept as an ABSENCE).**
    There is no `AnimationMixer`, no per-belt clock and no per-item object
    anywhere in `web/src/game`. A tile's flow speed and fill fraction come from
    ONE `FFactoryBeltFlowState` row, written into a `DataTexture` indexed by
    three's own batching id (`getIndirectIndex(gl_DrawID)`, the same mechanism
    three uses for per-instance colour, so it cannot fall out of step with the
    matrix texture). A per-vertex `aRole` attribute lets ONE material serve the
    machine body, the emissive status chip and the scrolling deck, so the whole
    factory is one `BatchedMesh`: measured 39 -> **43 draw calls** of 150 for a
    six-building line plus its inserters, which is one batch times the main pass
    plus three shadow cascades and nothing else.

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

*(The cross-fade and the "limb fringe" are both closed at W3. The limb fringe was a
misdiagnosis: see §15.2 item 20.)*

---

## 17. W3 implementation record (2026-07-25)

Sky, sun, cascaded shadows, analytic atmosphere, the stream-in cross-dissolve, and the
half of the planet that was never being drawn. Same machine as §15 and §16: Chrome /
ANGLE D3D11 / RTX 4060 Ti, 1600 x 900 unless stated.

### 17.1 Measured numbers

| Thing | Budget (§10, §7.2) | Measured |
|---|---|---|
| Whole frame, surface walk, 900 timed frames | p99 25 ms | **0.993 ms** (variance 0.003 across 3 runs) |
| Cost of the shadow pass | inside GPU 10.0 ms | **0.123 ms** (0.993 with, 0.870 without) |
| Cost of the atmosphere | ~0.6 ms projected (§7.3) | **below the 0.03 ms measurement floor** |
| Cost of the star field | not budgeted | below the measurement floor |
| Draw calls, surface, shadows on | <= 150 target | **141 to 157** (83 to 95 without shadows) |
| Draw calls, surface, sun below the horizon | <= 150 | **106** (164 before the night cut-off) |
| Draw calls, orbit | <= 150 | **32 to 46**, shadow rig inactive |
| Triangles, surface | <= 2.7 M | **288k to 320k** |
| Shadow VRAM | <= 50 MB (§7.2) | **48.0 MB** (3 x 2048^2 x 4 B) |
| Total VRAM estimate | <= 260 MB | **60.1 MB** (12.1 pooled terrain + 48.0 shadows) |
| Shadow contrast, A/B at 1000x560 | visible | **119 tiles of 22,400 darkened, peak 80/255, mean 62.6** |
| Programs | alert 40 | **4 to 7** |
| 5 km driven walk, W2 regression | grounded 100% | **100%**, 372 chunks built, 2 rebases, p99 0.7 ms, worst 1.9 ms |
| Walk jitter, W2 regression | 0.0034 mm mean | **0.021 mm mean / 0.150 mm max** float32; eye jerk 0.00025 mm mean |
| `?scenario=zfight`, W2 regression | PASS | **PASS**, 0% bleed at every scale |

### 17.2 The three defects, closed by measurement

**1. Half the planet was missing.** Not a limb fringe. Void census with `?clear=ff00ff`:

| Framing | shell only (`?proxy=0`) | shell + proxy | proxy only (`?shell=0`) |
|---|---|---|---|
| orbit, before | **150,265** | 279 | 0 |
| orbit, after | **0** | **0** | 0 |
| ascent / surface, after | 0 | 0 | n/a |
| space, after | 3,067 | 3,067 | 3,088 *(the metric's floor, §15.2 item 21)* |

Three of `/core`'s six cube faces are parametrized left-handed. See §15.2 item 20.

**2. Stream-in pop.** The dissolve is measured with `probes/pop.js`, which second-
differences the frame because a moving camera changes every pixel every frame and only a
discontinuity survives differentiation twice.

| | walk, 1,375 m at 45 m/s, 279 chunks | teleport, 321 chunks onto a STATIONARY camera |
|---|---|---|
| worst frame, pixels jumping >= 16/255, `?fade=0` | 25 of 360,000 | **166,446** (46% of frame) |
| worst frame, `?fade=0.25` | 29 of 360,000 | **42,295** (12%) |
| worst tile step (100x56), `?fade=0` | 5.8 / 255 | **102.97** |
| worst tile step, `?fade=0.25` | 6.6 / 255 | **15.28** |
| frames carrying the change | n/a | 10 -> **33** |

**The honest reading: the pop is real but small on a surface walk** (25 pixels of 360,000
in the worst frame, with or without the fade), and the dissolve is what keeps a large
resident-set change from being a cut. W8's descent is the case it was built for.
`W3_pop_before.png` / `W3_pop_after.png` are the same moment of the same teleport.

**3. Near/far horizon agreement.** Rendering the identical settled framing with
`?cutoff=6` and `?cutoff=3` moves **56 chunks** from the far scaled scene into the near
1:1 scene and changes **0 of 14,400 tile means**, maximum delta 0.00. Both scenes
evaluate the same scattering integral in planet-centred metres; `uMetresPerUnit` is the
only difference between the two programs.

### 17.3 Verified at W3

* Surface to space reads as one continuous fade: `W3_ascent_02km`, `W3_ascent_fade`
  (12 km), `W3_ascent_60km`, `W3_ascent_200km`, `W3_orbit_limb`. The sky darkens, the
  stars emerge, the limb lights up, and nothing switches: one uniform (air density times
  sun elevation) drives the star fade and the rest is the same integral at a different
  altitude.
* Day and night: `W3_surface_day` shows the player's cast shadow on the ground,
  `W3_surface_night` shows a dark surface, a full star field and a warm terminator glow
  on the horizon in the sun's direction.
* The shadow rig switches itself off in ORBIT and whenever the sun is below the horizon,
  which is 58 draw calls in each case.
* Every W3 capture goes through `probes/frame.js`, which converges on the SYNTHETIC clock
  and reports ticks advanced, so DW-20 is satisfied per screenshot, not per milestone.

### 17.4 Outstanding into W4

* **Draw calls are the tight budget now, not frame time.** 141 to 157 on the surface with
  shadows, against a 150 target, and W4 adds foliage. The terrain `BatchedMesh` upgrade
  (§4.4) is the planned answer and it also collapses the 58 shadow draws.
* **Shadow cascade blending is not implemented.** Cascade selection is a hard `if` on
  view depth with only the LAST cascade faded out. A visible band at 22 m and 80 m is
  possible on high-contrast ground; nothing showed at W3's contrast levels.
* **The avatar receives no shadow from `TerrainMaterial`.** It is a `MeshStandardMaterial`
  lit by the one stock sun light, which does not cast, so terrain never shadows the
  player. It casts correctly. W4's rigged player is the moment to fix it.
* **`uSunColor` is 15 and `sunIntensity` was tuned by rendering, not derived.** The first
  pass at 1.5x Earth Rayleigh coefficients put a 25 km mesa at pure white. The knobs live
  in `forgeAtmosphere()`; Cinder needs an airless profile (`uAtmosOn` 0) at W9.
* **No runtime IBL.** See the W3 milestone row: the terrain already samples the sky
  ambient from the same integral. Stock PBR materials at W4 will need
  `nearScene.environment` and that is the moment to build the 64^2 cubemap.
* **The atmosphere is free on an RTX 4060 Ti and that proves nothing about a GTX 1660.**
  10 x 3 samples at full resolution is the shipping config; `Quality` already tiers it to
  6 x 2 on low. Re-measure on the target class before assuming the headroom.
