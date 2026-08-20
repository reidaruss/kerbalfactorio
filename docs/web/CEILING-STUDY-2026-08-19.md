# The Ceiling Study: is the browser the blocker for world graphics?

> **Lane:** `lane/ceiling-study` · **Numbers:** RN-2085 to RN-2099 · **Date:** 2026-08-19
> **Owner:** rendering-controller · **Reports to:** Admin
> **Status:** decision document. **No game code lands from this block.** The only
> code in the branch is two measurement instruments (§1.2).
> **Read alongside:** [ARCHITECTURE](ARCHITECTURE.md) §1.2 and §10 · [NUMBERS](NUMBERS.md)
> WG-189 · [MASTER_PLAN](../MASTER_PLAN.md) D-018 and D-020 · [rendering.md](../controllers/rendering.md) §2.8

---

## 0. The answer, in one page

**No. The browser is not the blocker, and the measurement says where the blocker
actually is with more confidence than it says anything else.**

At the pose this project calibrates its art on, on a real D3D11 RTX 4060 Ti at
1600x900, the frame costs about **10 to 11 ms** against a 16.6 ms budget. It
draws **76 of its 150 budgeted draw calls** and **1.45 M of its 2.7 M budgeted
triangles**. Nothing in the frame is close to a WebGL2 ceiling.

**Multiply the pixel count by sixteen and the frame time does not change** (§2.4,
with a VRAM positive control proving the resolution actually changed). The frame
is not fill-rate bound and not fragment-shader bound, so the two things a faster
graphics API is best at are not the two things costing us anything.

**58.8 per cent of every triangle in that frame is drawn into a shadow map**, and
`rendering.md` §2.8 R2 already diagnosed why: 45 prop subtrees sit at the full
4.0x shadow-LOD multiplier, so every cascade redraws the foliage at LOD0. That
is an authored-content defect with a known fix and a measured saving. It is not
a platform property, and no renderer on any platform makes it go away.

The three candidate moves stack up like this:

| Move | What it fixes | What it costs | Verdict |
|---|---|---|---|
| **Fix the LOD ladder and the shadow budget** | the actual measured cost | 1 to 3 lane-weeks, already scoped as §2.8 R2 | **Do this** |
| **three.js `WebGPURenderer`** | draw-call submission, which is not our bottleneck | 8 to 14 lane-weeks, and the three.js manual says our entire shader surface is unsupported | **Not now.** Re-gate on ClusteredLighting need |
| **Native client** | bindless, sparse textures, mesh shaders, real threads: none of which we are limited by today | 40 to 80 lane-weeks, and it deletes the HTML UI, the probe harness and Reid's LAN play model | **Not now.** It stays D-018's deferred endgame |

**The single most alarming number in this study is not a frame time.** It is
that `ARCHITECTURE.md` recorded the whole frame at **0.99 ms** when W3 shipped on
2026-07-25, and it is **about 10 ms today**, 2026-08-19. A tenfold growth in
frame cost landed across three and a half weeks of art work and **nothing gated
it**, because no gate in this project measures frame cost. §2.6 is about that.

---

## 1. How this was measured

### 1.1 The environment is part of the measurement

| Fact | Value |
|---|---|
| GPU, as reported by the client itself | `ANGLE (NVIDIA, NVIDIA GeForce RTX 4060 Ti (0x00002803) Direct3D11 vs_5_0 ps_5_0, D3D11)` |
| Backend | **Real D3D11. Not SwiftShader.** Asserted by the probe, not assumed |
| Served tree | `vite preview` on port 5200 out of this worktree, `--strictPort`, PID-verified, bundle `index-oLWalsdK.js` |
| Quality tier | `high`: 3 cascades at 2048², `maxResidentChunks` 384, post on |
| Viewport | 1600x900 at `deviceScaleFactor` 1 unless a row says otherwise |
| Pose | `forestfloor` (lat -19.85, lon -72.7853, yaw 300, pitch -26, sun dot 0.70), lifted verbatim from `artframe.js`'s own manifest |

Two traps this project has already paid for were checked explicitly rather than
assumed away:

- **The foreign-port hazard** (`ADMIN.md`, 2026-08-19: 36 orphaned preview
  servers, one of which answered a verifier's port and nearly blocked a clean
  reland). Port 5200 was confirmed to be owned by this worktree's own
  `vite preview` process by PID, and `--strictPort` guarantees it bound rather
  than silently falling through to somebody else's server.
- **The software-rasteriser trap.** `probes/ceiling.js` **fails** if the backend
  string matches SwiftShader, llvmpipe or software, unless `allowSoftware` is
  passed deliberately. A frame cost measured on a software rasteriser is not a
  frame cost.

### 1.2 The instruments this lane added

Two files, both new, both gated:

- **`web/tools/smoke/probes/ceiling.js`** measures the frame cost at a named
  pose. It exists because `cost.js`, the nearest prior instrument, inherits the
  scenario's spawn point and reports no pose. This one takes the teleport, the
  aim and the sun as arguments and echoes every one of them back **as measured**,
  pins the sun by elevation with the miss asserted (`artframe.js`'s rule, because
  `setSunElev` returns the closest reachable phase and an unreachable target
  comes back as the site's maximum with no complaint), asserts convergence, and
  refuses a software backend.
- **`web/tools/smoke/ceilingsweep.mjs`** is WG-189's interleaved paired method
  generalised from two arms to N. It rotates arm order every repeat so drift is
  shared out across arms instead of landing on whichever ran last, and it prints
  the **within-arm spread beside every delta**.

`npm run check:probes` passes: 328 probe files, 316 documented, 12 exempt, 0
offenders.

### 1.3 What this instrument can and cannot resolve, stated before the numbers

**`frameMs` is not a frame time and never was.** The Loop's own `frameMs` and
`renderer.info` both stop at draw submission. Every `frameMs` figure previously
published by this project is a submission time. `ceiling.js` reports a wall-clock
`wallMsPerFrame` across a long driven run terminated by a read-back that flushes
the pipeline, and reports the submission time separately and labelled, so the gap
between the two is visible rather than assumed.

**The timing arm of this instrument is noisy and the structural arm is not.**
Across a five-arm interleave the draw-call, triangle, VRAM and chunk counts
reproduced **exactly**, digit for digit, on every repeat. The timings did not:
each arm produced three runs inside a roughly 0.9 ms band and one outlier 4 to 6
ms high. That is the signature of a transient on a shared box, and in this case
the cause is known, because two Opus research agents were running on the same
machine during that sweep.

**Consequence, and it is a limit on this document's conclusions:** the timing
instrument on a contended box **cannot resolve a delta below about 2 ms**, and
this study does not claim any. Where a delta failed the separation test it is
reported as NOT SEPARATED, never as a small effect. Where a structural count
moved it is reported to the digit, because it reproduced to the digit.

---

## 2. The measured ceiling

### 2.1 The absolute number

Four interleaved repeats, 400 timed frames each, `forestfloor`, 1600x900:

| Quantity | Value | Budget (`ARCHITECTURE.md` §10.3) | Headroom |
|---|---|---|---|
| **Wall ms/frame, median** | **10.22 ms** and **10.87 ms** on two independent sweeps | 16.6 ms at 60 fps | **~1.5x at the median**, see §2.4a |
| Submission-only p50 | 14.70 ms | n/a | **not a frame time, and not comparable to the row above**: `StatsProbe`'s ring is 600 frames and spans the warm-up, so it carries streaming spikes the timed window excludes. It is reported for the record, not for arithmetic |
| Draw calls | **76** | 150 target, 300 alert, 500 fail | **2.0x to target** |
| Triangles | **1,452,463** | 2.7 M alert, 4.0 M fail | **1.9x to alert** |
| Programs | 41 | n/a | |
| Textures / geometries | 141 / 70 | n/a | |
| VRAM estimate | 104.2 MB | 260 MB | **2.5x** |
| Resident chunks | 342 | 384 cap | **1.1x, the tightest ratio in the table** |
| Scatter props placed | 41,300 over 89,430 m² | 135k instances | 3.3x |
| **Programs** | **41** | **40 alert (`ARCHITECTURE.md` §17.1)** | **BREACHED** |

> **A number this table used to carry, and why it was removed.** An earlier draft
> listed "p99 frame (submission) 27.5 ms, ALERT" here and asserted the ALERT as a
> standing fact in four places. **It was a single reading off a contended box, and
> §1.3 of this document forbids treating a timing statistic from a contended box
> as standing.** A fresh-context verifier on a quieter machine read
> `submitMs.p99` at **14** with the client's own `budget.frameP99` reporting
> **ok**. The p99 claim is **withdrawn**. The programs breach replaces it because
> it is structural and reproduces.

**Nothing here is a WebGL2 limit.** The frame uses half its draw-call budget and
half its triangle budget. The two tight numbers are the chunk pool (342 of 384)
and the program count (41 against 40), and neither is a property of the graphics
API.

### 2.2 Where the time goes

Pass timings from a single settled run, as fractions of the frame (the absolute
values in this particular run were taken while the box was contended, so the
**ratios** are the finding and the magnitudes are not):

| Pass | ms | share |
|---|---|---|
| sky | 0.1 | 0.6% |
| far (scaled space) | 0.2 | 1.1% |
| **near (1:1 world)** | **14.6** | **82.0%** |
| view model | 2.4 | 13.5% |
| post | 0.5 | 2.8% |

The scaled-space machinery this domain was chartered to build (sky pass, far
pass, the four-camera ladder) costs **1.7 per cent of the frame**. The seamless
traversal architecture is not the problem and is not close to being the problem.
The whole frame is the near pass, and the near pass includes the three shadow
cascades.

The post stack is 0.5 ms: AO at 3 slices by 6 steps at half resolution, a 5-level
bloom pyramid, composite and FXAA, across 13 files and 2,372 lines. It is not a
cost centre and removing it is not an optimisation.

### 2.3 The ablation ladder

Four interleaved repeats per arm, 400 frames, `forestfloor`, 1600x900. **The box
was contended during this sweep** (§1.3), so read the structural columns as fact
and the timing column as indicative.

| arm | wall ms/frame p50 | full range | vs base | separated? | calls | triangles | VRAM MB |
|---|---|---|---|---|---|---|---|
| base | 10.22 | 6.73 | - | - | 76 | 1,452,463 | 104.2 |
| `shadows=0` | 8.99 | 5.01 | -1.22 | **no** | 46 | **598,788** | 56.2 |
| `props=0` | 6.21 | 2.96 | -4.01 | **no** | 52 | 717,438 | 104.2 |
| `terrainart=0` | 10.77 | 2.93 | +0.56 | **no** | 76 | 1,452,463 | 104.2 |
| `post=0` | 10.76 | 4.29 | +0.55 | **no** | 59 | 1,452,446 | 76.0 |

**Not one timing delta separated from its own arm's spread on this box.** That is
the honest verdict for this sweep and it is reported as such. **A fresh-context
verifier on a quieter machine got the shadow arm to separate, at -3.09 ms against
within-arm spreads of 2.31 and 0.36 ms, so this table under-claims rather than
over-claims** (see §3, shadow row, for provenance). The conservative reading is
kept here because it is what this box measured; the verifier's datum is kept
separate because it is a different box.

The structural columns did separate, they reproduced to the digit, and they carry
the finding:

- **58.8 per cent of every triangle drawn in this frame is shadow-map geometry.**
  Base draws 1,452,463 triangles; with casting off it draws 598,788. The
  difference, **853,675 triangles, exists only to fill three 2048² depth maps.**
- **Shadow casting also costs 30 of the 76 draw calls and 48 MB of the 104 MB
  VRAM estimate.**
- **Props are half the frame's geometry**: 735,025 triangles and 24 draw calls.
  Props and shadows overlap, because the props are what the cascades are
  redrawing.
- **The nine-term terrain surface art costs nothing measurable and moves no
  geometry at all.** `terrainart=0` changed neither triangles nor draw calls and
  its timing delta was not separated. This refutes the hypothesis this lane
  started with, which was that the frame is fragment-ALU bound on the procedural
  ground material. It is recorded because a refuted hypothesis is a result.

This lines up exactly with `rendering.md` §2.8 **R2**, which measured 45 prop
subtrees at the full 4.0x shadow-LOD multiplier with every cascade still on tier
0, and named the fix: shadow-safe LOD1 tiers so the cascades stop paying 4.0x.
R2 called the budget consequence "a saving". **This study prices that saving at
up to 853,675 triangles and 48 MB, which is the largest single identified waste
in the frame.**

### 2.4 Resolution scaling, and the clearest result in this study

This is the discriminating experiment. If the frame is fill-rate or
fragment-shader bound, frame time tracks pixel count. If it is bound by CPU work
or vertex throughput, it does not. Five interleaved repeats per arm, 600 timed
frames each, `forestfloor`, on a **quiet box** (no other agents running):

| arm | pixels | rel. pixels | wall ms/frame p50 | full range | vs base | separated? | calls | triangles | VRAM MB |
|---|---|---|---|---|---|---|---|---|---|
| 800 x 450 | 0.36 M | **0.25x** | 11.87 | 5.24 | +1.00 | **no** | 76 | 1,452,471 | 82.4 |
| **1600 x 900 (base)** | 1.44 M | **1.0x** | **10.87** | 5.60 | - | - | 76 | 1,452,471 | 104.2 |
| 2560 x 1440 | 3.69 M | **2.56x** | 12.18 | 6.62 | +1.31 | **no** | 76 | 1,452,471 | 149.5 |
| 3200 x 1800 | 5.76 M | **4.0x** | 13.99 | 12.89 | +3.11 | **no** | 76 | 1,452,471 | 191.4 |

**The arm actually took effect, and the VRAM column is the positive control that
proves it.** The render targets scale exactly as they should, 82.4 to 191.4 MB,
while triangles and draw calls stay identical to the digit across all four arms.
So the only thing varying is pixels.

**Across a 16-fold change in pixel count, from 0.36 M to 5.76 M, the frame time
does not separate from noise.** The quarter-resolution arm is not faster than
base; it is nominally 1.00 ms *slower*, which is noise, and that is exactly the
point. A fill-bound frame at 0.25x the pixels would have been roughly four times
cheaper. This one was not cheaper at all.

**Conclusion: the frame is not fill-rate bound and not fragment-shader bound.**
Combined with §2.3, which found that the nine-term procedural ground material
costs nothing measurable, the fragment-cost hypothesis is dead twice over. What
remains is CPU-side per-frame work and vertex/geometry throughput, and §2.3 says
58.8 per cent of the geometry is shadow-map fill for unLODed foliage.

**The leading mechanism, named as a hypothesis and explicitly not claimed as
measured.** `BatchedMesh.perObjectFrustumCulled` defaults true and culls on the
CPU, per instance. The scene carries **41,300 scatter props**, and they are
submitted to the main camera plus three shadow cascades, which is on the order of
**165,000 JavaScript frustum tests per frame**. That is the right order of
magnitude to explain a ~10 ms frame that ignores resolution, and it is consistent
with `props=0` producing the largest (though unseparated) timing delta in the
ladder. **The experiment that would settle it is one interleaved sweep of `base`
against `propcull=0` against `shadowcast=0` on a quiet box with enough repeats to
beat a 5 ms noise floor.** This lane did not have the budget to run it and does
not assert the mechanism.

**Two practical consequences for Reid, which do not depend on the mechanism:**

- **Rendering at higher resolution is nearly free right now.** 2560x1440 costs
  nothing separable over 1600x900. If he plays at 1440p, the frame cost is
  roughly what this document reports.
- **VRAM, not frame time, is what resolution actually spends.** At 3200x1800 the
  estimate is **191.4 MB of the 260 MB budget**, and that is before any texture
  or asset growth. 4K would breach it.

### 2.4a What the noise floor means for every timing claim here

Across both sweeps the within-arm full range was **2.9 to 12.9 ms** while the
deltas under test were 0.5 to 4 ms. **Not one timing delta in this study
separated**, and none is reported as a cost. The honest summary of the absolute
level is: **median 10.2 and 10.9 ms across two independent five- and four-repeat
sweeps, against a 16.6 ms budget, with individual frames that exceed it.** That
is "at or inside budget with roughly a 1.5x margin at the median", not "1.6x
headroom", and §6.2 asks for the gate that would let a future lane say it more
precisely.

### 2.5 The budget was set once and never re-measured

`ARCHITECTURE.md` §17 is a full measured record of W3, taken on **the same
machine, the same backend and the same resolution** as this study: *"Chrome /
ANGLE D3D11 / RTX 4060 Ti, 1600 x 900"*.

**Two caveats before the table, because "same machine and resolution" is not the
same as "same measurement".**

1. **The pose is not the same.** W3's figures came through the `cost.js` family,
   which takes a yaw and a pitch and **inherits whatever the scenario's spawn
   was**; that is precisely the gap §1.2 says `ceiling.js` was written to close.
   The W3 row is "a surface walk", this study's row is the pinned `forestfloor`
   calibration pose. They are the same *class* of frame, not the same frame.
2. **The scene is materially different, and that is the whole point rather than a
   confound.** W3 predates the props, the machines, the voxel face, the nine
   surface-art terms, the view model and the post stack. **The growth below is the
   art campaign doing its job, not a renderer regression**, and nothing in this
   document argues otherwise.

Read the table as an order-of-magnitude trend with those two caveats attached,
not as a controlled A/B. On that reading it is still the most useful comparison
available, because the trend is 10x and the caveats are not.

| Quantity | W3, 2026-07-25 | Today, 2026-08-19 | Change | Threshold |
|---|---|---|---|---|
| **Whole frame** | **0.993 ms** (variance 0.003 across 3 runs) | **~10 ms** | **~10x** | 16.6 ms |
| Triangles | 288k to 320k | **1,452,463** | **~4.7x** | 2.7 M alert |
| Draw calls | 141 to 157 | **76** | **0.5x, improved** | 150 target |
| Programs | 4 to 7 | **41** | **~7x** | **alert 40, BREACHED** |
| Total VRAM | 60.1 MB | 104.2 MB | 1.7x | 260 MB |
| Cost of the shadow pass | **0.123 ms** (0.993 with, 0.870 without) | 853,675 triangles, 30 draws, 48 MB | see §2.3 | |

Three things fall out of that table:

1. **Draw calls went the right way.** 157 to 76, because the batching work landed.
   That is the one budget the architecture actively managed, and it worked. It is
   also the budget `WebGPURenderer` would improve, which is precisely why
   `WebGPURenderer` is not the answer.
2. **Programs are over their documented alert and nothing noticed.** §17.1 lists
   "Programs, alert 40, measured 4 to 7". It is **41** today.
3. **The shadow pass was 0.123 ms at W3 because the whole frame only had 288k to
   320k triangles.** Today the shadow geometry *alone* is 853,675 triangles,
   nearly three times the entire W3 frame. The pass did not get slower; it got
   handed 20x more work by the art campaign.

None of that growth was wrong. Every term was measured and argued for in its own
lane. **What is wrong is that no gate ever summed them.** The project has 327
probes, `probe-budgets.json` bounds every probe's *wall-clock runtime* (a
different quantity), and both `StatsProbe`'s ALERT/FAIL thresholds and §17.1's
program alert are **published and unenforced**: **the program count is at 41
against a documented alert of 40 right now, and no check went red.**

### 2.6 The instrument this study depends on is about to be removed

`STATE_OF_THE_UNION.md` §1 states: *"The harness still cannot measure frame cost,
so Reid actually playing on real hardware remains the only genuine performance
signal this project has."*

**That is true on the Proxmox VM and false on Reid's desktop.** On this box the
existing harness, unmodified, launches headless Chrome with `--use-angle=default`
and gets real D3D11 on the RTX 4060 Ti. Every number in this document came out of
it. WG-189 already used the same path and said so ("real D3D11 boot (RTX 4060 Ti,
ANGLE)").

The Proxmox decision moves every lane onto a GPU-less VM where the same harness
falls back to `--enable-unsafe-swiftshader`. **If that move completes as written,
this study cannot be repeated and the frame-cost gate §2.5 asks for cannot be
built.** This is a decision point (§7 Q4), not a complaint.

---

## 3. Structural limits: three.js on WebGL2 for this game's world roadmap

Each row is graded against **this** codebase, not in general. HARD LIMIT means
the API cannot do it. SOFT LIMIT means it is possible and slow or laborious.
MYTH means the concern does not survive contact with what we actually run.

| Capability the roadmap wants | Verdict on WebGL2 | Evidence, from this codebase |
|---|---|---|
| **Compute-driven terrain synthesis** | **MYTH, for us.** WebGL2 genuinely has no compute shaders (HARD in the abstract), but we do not want it there. Terrain meshing is already C++ in `of-core.wasm` inside `terrain.worker.ts`, it is deterministic, it is shared with 41 native ctest suites, and `DW-14` makes the wasm build the canonical world generator. Moving it to the GPU would fork determinism from the sim. | `web/src/workers/terrain.worker.ts`, `web/src/world/TerrainStream.ts`, `core/include/of/terrain_stream.h` |
| **Compute-driven scatter placement** | **SOFT LIMIT, and not currently binding.** Placement is CPU on the main thread (`Scatter.ts` and friends, ~1,700 lines). Measured `buildMs` at the heaviest pose is **0.1 ms** with `scatterBacklog` 0 and `cellsCapped` 0. There is nothing to accelerate yet. | `w.props.buildMs = 0.1`, `scatterBacklog: 0` |
| **GPU-driven culling** | **HARD LIMIT on WebGL2** (no indirect draw). **Also effectively unavailable on WebGPU**: three's BatchedMesh-over-indirect is draft PR #30645, unmerged as of today. **Not binding either way:** we issue 76 draws against a 150 target, and `BatchedMesh.perObjectFrustumCulled` already culls per instance on the CPU. | `draw.calls: 76`; `PropLibrary.ts:123` |
| **Shadow techniques beyond cascaded maps** | **SOFT LIMIT.** Virtual/ray-traced shadow maps need compute and indirect draw, so WebGL2 cannot host them. **But we are not limited by the technique, we are limited by what we feed it**: 58.8% of triangles go into three cascades because the foliage has no shadow-safe LOD. Fix the input before changing the algorithm. **CORROBORATED, AND THIS STUDY UNDER-CLAIMED IT:** §2.3 reported the `shadows=0` timing delta as NOT SEPARATED on a contended box. A fresh-context verifier re-ran it on a quieter machine and the delta **did separate, at -3.09 ms against within-arm spreads of 2.31 and 0.36 ms**. Provenance: independent verifier, independent build, own sweep; not this lane's measurement, and recorded here rather than folded into §2.3 so the two boxes stay distinguishable. | §2.3; `rendering.md` §2.8 R2; verifier sweep 2026-08-19 |
| **Volumetric atmosphere** | **SHIPPED, not a limit.** Ray-marched Rayleigh + Mie single scattering already runs, with aerial perspective evaluated per terrain fragment at 4 view steps by 2 light steps. `terrainart=0` and the pass split both say it is not a measured cost. | `materials/Atmosphere.glsl.ts`, `TerrainProgram.ts:29-30` |
| **Volumetric clouds** | **SOFT LIMIT.** Doable in WebGL2 as a raymarched fullscreen or shell pass; WebGPU makes it cleaner via `storageTexture3D` (new in r185) and compute-generated noise volumes. This is the one roadmap item where WebGPU has a genuine, shipped advantage. Cost is fill rate, which §2.4 addresses. | three.js r185 `webgpu_volume_cloud` |
| **Texture streaming / virtual texturing** | **HARD LIMIT, and identical on WebGPU.** Neither WebGL2 nor WebGPU exposes sparse or partially-resident textures; gpuweb has no proposal for it. True megatextures are unavailable in a browser at all, and any VT must be a hand-rolled software indirection table. **This is therefore not a WebGPU argument.** We are at 104.2 MB of 260 MB budget and KTX2 + Basis is already live, so it is not pressing. | `assets/Loaders.ts`, gpuweb issue #380 |
| **Bindless resources** | **HARD LIMIT, browser-wide.** gpuweb #380 open since 2019-08-01, blocked on Android support. Available only natively. Not binding at 141 textures. | gpuweb #380 |
| **Worker-thread limits on the sim** | **SOFT LIMIT, self-imposed and correctly so.** No SharedArrayBuffer, no COOP/COEP, by the `D4`-challenge decision; transferable `ArrayBuffer`s cover every path we have. Terrain payloads already transfer zero-copy. In Electron, COOP/COEP would be free if it were ever wanted. | `sim/wasm/OfCore.ts:6`, `terrain.worker.ts` |
| **Memory ceiling** | **SOFT LIMIT.** wasm32 caps the sim heap at 4 GB and a tab has its own limits. We are at 104.2 MB VRAM and 11.2 MB of terrain buffers. Nowhere near. | `terrain.bytesTotal: 11,237,778` |
| **Many small lights (tunnel lamps, furnace glow, factory emissives)** | **HARD LIMIT on WebGL2 forward rendering, and it is the one real one.** ClusteredLighting / Forward+ is WebGPU-only in r185. Current mitigation is a hard budget of 4 to 8 point lights plus emissive and bloom. **This is the only capability in the table that WebGPU unlocks and WebGL2 cannot reach.** | `ARCHITECTURE.md` §11 and R8; three.js r185 `ClusteredLighting` |
| **Real GPU timer queries** | **SOFT LIMIT.** `EXT_disjoint_timer_query_webgl2` is restricted in Chrome, which is why `passMs` is a CPU-side wall timer around each pass and why this lane had to add a read-back-flushed wall clock. Workable, less precise than native. | `render/Frame.ts:181-184`, `probes/ceiling.js` |

**Summary of the inventory: exactly one hard limit binds this roadmap, and it is
clustered lighting.** Everything else is either already solved in wasm, not yet
loaded enough to matter, or equally unavailable on WebGPU.

---

## 4. The middle path: three's `WebGPURenderer` in the browser

### 4.1 What it would unlock

Genuinely shipped in three r185, WebGPU backend only:

- **ClusteredLighting (Forward+).** The one hard limit in §3. Retires R8.
- **Compute.** 17 compute examples in r185, including `webgpu_compute_geometry`
  and `storageTexture3D`, which is the clean path to volumetric clouds.
- **`IndirectStorageBufferAttribute`.** Indirect draw landed (issue #28389 closed
  completed 2025-02-10), though GPU-driven culling over BatchedMesh is still
  draft PR #30645, unmerged.
- **`RenderPipeline`** post stack, bringing SSGI, SSR, TRAA, motion blur and DOF
  implementations we do not have.

### 4.2 What breaks, and this is the part `ARCHITECTURE.md` got wrong

`ARCHITECTURE.md` §1.2 promised the swap would be contained: *"Custom shading is
capped at 5 shaders"* and *"the migration is therefore a bounded, one-milestone
job: 5 GLSL shaders to TSL."*

**The cap was breached and the plan did not survive contact.** Measured today:

| Category | Files | Lines | Fate under WebGPURenderer |
|---|---|---|---|
| `ShaderMaterial` / `RawShaderMaterial` | **6** | | rewrite in TSL or `wgslFn` |
| **`onBeforeCompile` patches of three's built-in shaders** | **14** | | **no equivalent exists** |
| All shader-authoring files | **49** | **10,744** | |
| `.glsl.ts` chunk libraries | 17 | 3,598 | |
| Custom post stack (not `EffectComposer`) | 13 | 2,372 | rewrite as `RenderPipeline` nodes |
| Cascaded shadows via 3 real `DirectionalLight`s | `ShadowRig.ts` 366 + `ShadowLod.ts` 356 | | `CSMShadowNode`, behavioural change |
| The renderer seam itself | `render/Renderer.ts` | 328 | **cheap, and the one thing the plan got right** |

The 14 `onBeforeCompile` files are: `game/MachineBatch.ts`, `game/NodeBatch.ts`,
`render/instancing/PropWind.ts`, `render/instancing/Surfaces.ts`,
`render/instancing/SurfaceUv.ts`, `render/materials/FurShader.ts`,
`render/materials/MachineFx.ts`, `render/materials/MachineMat.ts`,
`render/materials/PartMaterial.ts`, `render/materials/RockShader.ts`,
`render/post/UnderwaterGlsl.ts`, `render/ShadowRig.ts`,
`render/ViewModelLight.ts`, `world/VoxelFaceMaterial.ts`.

**The three.js manual for r185 settles this in one sentence, verbatim:**

> "Custom materials based on `ShaderMaterial`, `RawShaderMaterial` and
> modifications of built-in materials via `onBeforeCompile()` are not supported
> in `WebGPURenderer`. This part of your application must be ported to node
> materials and TSL."

There is no automated path. The `examples/jsm/transpiler/` GLSL-to-TSL
transpiler shipped in r185 handles **standalone** GLSL; it cannot understand a
string replacement against three's internal shader chunks, because on the WebGPU
side those chunks do not exist. `glslFn` and `wgslFn` both exist but are
backend-locked, so using either forfeits the WebGL2 fallback that is
`WebGPURenderer`'s main safety net.

**The cost nobody has counted: the golden images.** 153 of the 327 probes assert
by screenshot or pixel diff. A different renderer produces different pixels.
Every golden and every `pngdiff` threshold in the corpus would need re-baselining,
and re-baselining is exactly the operation `NUMBERS.md` exists to warn about,
because a re-baseline hides every regression that happened to land in the same
commit.

### 4.3 Maturity risk

- The official r185 manual still says, **quoted in full so the sentence is not
  tilted by an ellipsis**: *"The renderer itself is still in an experimental
  state, although its maturity level has been greatly improved in the last years.
  Depending on your application and scene setup, you will encounter missing
  features or a better performance with `WebGLRenderer`."* **The concessive
  clause is real and cuts the other way**: three's own maintainers say the
  renderer has improved substantially. What has not changed is that they still
  call it experimental and still name `WebGLRenderer` as potentially faster for a
  given scene.
- **Issue #30560, the WebGPU UBO/draw-call performance tracker, has been open
  since 2025-02-19 and is the only open issue in the entire three.js repository
  carrying the "High priority" label.** Its reproduction is 20,000 non-instanced
  cubes at ~60 fps on WebGL against ~15 fps on WebGPU. The architectural fix
  (batched UBOs with `bindBufferRange`, or storage buffers) is not landed in r185.
- Maintainer guidance on that issue is *"use instancing and batching whenever
  possible"*, which we already do, so we would plausibly avoid the worst of it,
  but that is inference and not a measurement. No published BatchedMesh
  WebGL-vs-WebGPU benchmark exists.
- The claim circulating that WebGPURenderer has been production-ready since r171
  is **not supported by any primary source** and is contradicted by the manual.

### 4.4 Migration cost

**8 to 14 lane-weeks**, distributed roughly: terrain material family 3 to 5
(15 files, ~3,000 lines, the largest single block); the other 5 ShaderMaterials 1
to 2; the 14 `onBeforeCompile` sites 2 to 4 (each is a reimplementation, not a
port); post stack to `RenderPipeline` 1 to 2; shadows to `CSMShadowNode` 0.5 to 1;
seam and boot 0.5; **golden re-baselining and probe repair 2 to 3, and this is the
one most likely to be underestimated**.

Against that: the headline benefit is CPU draw-call overhead, and **we are at 76
draw calls.** `ARCHITECTURE.md` predicted exactly this in July and the measurement
confirms it.

---

## 5. Native

### 5.1 What survives

| Bucket | Lines | Fate |
|---|---|---|
| `core/` C++17, header-only, 40 headers + 46 test files + 9 tools | **58,345** | **Survives verbatim.** Zero windowing, GL, SDL or Emscripten dependencies. **Native is already the primary build**: there is no wasm target in `core/CMakeLists.txt` at all, and **41 ctest suites are green** on Windows/MinGW and on the Linux VM |
| `core/include/of/persistence_file.h` | | Already written, already ctested, **excluded from the wasm build.** A native client gets atomic file saves for free and deletes the IndexedDB layer |
| `core/include/of/net_replication.h` + tests | 517 | Unaffected. Multiplayer is Phase 3, no transport exists anywhere, and the seam is pure C++ over `factory_sim.h`, so it is arguably **more** natural natively |
| WASM ABI shim, 427 exports | 7,910 | **Deleted.** A native client links the headers directly |

> Housekeeping, two items found while costing this: `CLAUDE.md` says core has
> "21 green ctest suites". It is **41**, re-counted at BT-34; the root doc is
> stale. And there is **no CI**: no `.github/workflows`, no `build.ps1` or
> `build.sh` for `core/` (unlike `web/wasm/`, which has both), and no `ctest`
> invocation in `web/tools/check-all.mjs`. The 41/41 green result is produced by
> running the documented `cmake` and `ctest` commands **by hand**. That is a gap
> in automation, not in portability, but it means the strongest asset in the
> native case is currently unguarded.

### 5.2 What it costs

| Bucket | Lines | Work |
|---|---|---|
| `render/` and everything importing three | **42,313** (173 files, 40% of the client) | Rebuilt against a new API. The renderer alone is 103 files / 20,722 lines |
| Pure-TS gameplay with no renderer and no wasm tie | **~11,800** (63 files) | Ported by hand or promoted into C++. This is **health, weapons, objectives, the buildable catalogue, recipes, save slots, build mode, the hotbar** |
| HTML/CSS HUD and menus | **8,361 TS + 3,274 CSS** | Rebuilt in a native UI toolkit. `ui/` is entirely HTML string construction plus canvas-2D navball and map |
| Audio, input, storage, workers, loop, asset loading | ~5,800 | Re-platformed |
| **Probe harness** | **96,086 across 327 probes** | Needs a native twin. 47% assert by screenshot, 44% by DOM, and only **33% are sim-only and portable in content** (and even those need re-pointing at a native debug bridge) |

**40 to 80 lane-weeks**, and the harness is the part that makes it dangerous
rather than merely long: this project's own `NUMBERS.md` records roughly twenty
harness defects found in one week against effectively none in the systems being
measured. Rebuilding the harness means rebuilding the thing that catches the
mistakes, without the harness to catch mistakes in it.

### 5.3 What dies

- **Reid's LAN play model.** He points a browser at a served build and the game
  renders on his GPU. A native client needs a build channel and a copy on his
  machine for every iteration.
- **The 153 screenshot probes** and the whole `pngdiff` / `pngmask` /
  `writeshot` / `pairshot` infrastructure.
- **Iteration speed**, which D-018 names as the explicit reason the web stack was
  chosen: *"its iteration speed is what produced the mechanics progress and the
  failed UE attempt showed what re-platforming mid-mechanics costs."*

### 5.4 What native actually buys for world graphics, honestly

Bindless resources, sparse/partially-resident textures for real virtual
texturing, mesh shaders, real threads without COOP/COEP, reliable GPU timer
queries, no wasm32 4 GB ceiling, and better shader compilers.

**Every one of those is real, and not one of them is what the measurement says we
are limited by.** We are limited by 853,675 triangles of foliage redrawn into
three shadow cascades because the props have no shadow-safe LOD. A native
renderer on the same RTX 4060 Ti draws those same triangles at the same speed.

**Electron is worth separating from "native".** `electron/` already exists, is
~1,700 hand-written lines, bundles `steamworks.js`, and has produced a **214 MB
packaged `OrbitalFoundry.exe` dated 2026-07-26**. It delivers D-018's Steam ship
target today. But it is a browser in a box: it removes **no** browser dependency
from §5.2 and unlocks **none** of §5.4. What it does remove is the WebGPU reach
argument, because a pinned Chromium makes browser market share irrelevant.

---

## 6. Recommendation

**Stay on three.js and WebGL2, and spend the next graphics block on the LOD and
shadow ladder rather than on the platform, because the measurement says 58.8 per
cent of the frame's geometry is foliage redrawn into shadow cascades and no
change of renderer or platform makes that cost less.** Re-gate the WebGPU
question on one specific trigger, clustered lighting, which is the single hard
limit this study found, and leave native where D-018 already put it, at the
pre-alpha gate.

**The corollary matters as much as the recommendation: build the frame-cost gate
before the next art wave, and do not put the only GPU that can run it out of
reach.** The frame went from 0.99 ms to about 10 ms in three and a half weeks
with nothing watching, and the program count is sitting at 41 against a
documented alert of 40 that no check reads.

### The work this study actually recommends, in order

1. **Shadow-safe LOD tiers for the 45 prop subtrees** (`rendering.md` §2.8 R2).
   Priced here at up to 853,675 triangles, 30 draw calls and 48 MB. 1 to 3
   lane-weeks, already scoped.
2. **A frame-cost gate.** `ceiling.js` and `ceilingsweep.mjs` exist now. Wire the
   `StatsProbe` ALERT and FAIL thresholds to a check that can go red, and run it
   at the canonical poses.
3. **Nothing else about the platform** until (1) and (2) have run and the frame
   has been re-measured.

---

## 7. Decision points only Reid can rule on

Each is a question with the evidence beside it.

**Q1. The measured gap to the Space Engineers bar is authored content, not
renderer capability. Do you accept that, or do you see something in the frames
that the numbers are missing?**
*Evidence:* all seven items in the `rendering.md` §2.8 look audit (R1 ground
variation, R2 flat understorey cards, R3 masonry tile scale, R4 view-model
fidelity, R5 an unreproducible station shot, R6 untextured hero-machine surfaces,
R7 a dusk frame that is really midday) are art or harness items. **Not one says
WebGL2 cannot draw it.** Against that, the frame uses half its draw-call budget
and half its triangle budget. This is the question the whole study rests on, and
it is a question about your eye, which no probe can answer.

**Q2. Clustered lighting is the one thing WebGL2 genuinely cannot do. How much do
you want many small lights?**
*Evidence:* ClusteredLighting / Forward+ is WebGPU-only in three r185. Today's
mitigation is a hard budget of 4 to 8 point lights plus emissive and bloom. The
storyline sends players into tunnels and factories, which is exactly the
many-small-lights case. If the answer is "a lot", the WebGPU cost in §4.4 (8 to 14
lane-weeks, against an experimental renderer with an 18-month-old open
high-priority performance issue) becomes a live trade rather than a deferral.

**Q3. W6's exit criteria required a recorded WebGPU re-evaluation decision. W6
shipped on 2026-07-26 without one. Does this document discharge that, or do you
want the spike run for real?**
*Evidence:* `ARCHITECTURE.md` §16 lists "WebGPU re-evaluation decision recorded"
as a W6 exit criterion; no such decision exists in `DECISIONS.md`. This study is
a paper re-evaluation grounded in current sources and current measurements. A
real spike would be porting one material to TSL and timing it, which is roughly
one lane-week and would replace inference with measurement on the one claim §4.3
cannot source: whether our heavily-batched scene avoids #30560.

**Q4. The Proxmox move puts every lane on a GPU-less VM. That deletes the only
frame-cost instrument this project has. Do you want a GPU in the loop?**
*Evidence:* every number in this document came from the existing harness running
headless Chrome on this desktop's RTX 4060 Ti through ANGLE D3D11. On a GPU-less
VM the same harness falls back to SwiftShader, where a prior rendering lane
recorded that frame cost is not measurable. `STATE_OF_THE_UNION.md` §1 currently
asserts the harness cannot measure frame cost at all, which is true of the VM and
false of this box. **Options: keep one GPU-bearing box as a measurement node,
pass a GPU through to the VM, or accept that the frame-cost gate in §6.2 cannot
exist.**

**Q5. Electron already packages a 214 MB Steam-ready binary and bundles
`steamworks.js`. Does that satisfy "endgame native installed from Steam", or do
you mean a true native renderer?**
*Evidence:* D-018 records your words as *"the platform is always meant to be
endgame native installed from steam"*, and DW-27 chose an Electron shell. Electron
delivers the Steam channel today at ~1,700 lines. It does not deliver any item in
§5.4. The two readings differ by 40 to 80 lane-weeks, and the roadmap should not
carry both.

**Q6. Frame cost grew tenfold in three and a half weeks with nothing gating it.
Do you want a gate that can block an art wave?**
*Evidence:* W3 recorded 0.99 ms for the whole frame on 2026-07-25; it is about 10
ms today, with the §2.5 caveats attached. `StatsProbe` already defines ALERT at
300 draws / 2.7 M triangles / 25 ms p99 and FAIL at 500 / 4.0 M / 40 ms, and
`ARCHITECTURE.md` §17.1 defines a program alert at 40, and **nothing reads any of
them**. **The program count is at 41 right now and no check went red.** (An
earlier draft also claimed the p99 was at ALERT; that came off a contended box,
a verifier read it at 14 with the client reporting `ok`, and it is withdrawn. The
structural breach stands on its own.) A gate that can go red will occasionally
stop a lane from landing something that looks good, and that is the cost of
having one.

---

## Appendix A. Reproducing every number here

```
npm --prefix web ci
npm --prefix web run build
npm --prefix web run preview -- --port 5200 --strictPort

# the absolute ceiling and the full report at the calibration pose
node web/tools/smoke/ceilingsweep.mjs --url=http://127.0.0.1:5200/ \
  --pose=forestfloor --repeats=4 --frames=400 --dump base

# the ablation ladder, interleaved
node web/tools/smoke/ceilingsweep.mjs --url=http://127.0.0.1:5200/ \
  --pose=forestfloor --repeats=4 --frames=400 \
  base shadows=0 props=0 terrainart=0 post=0

# resolution scaling
node web/tools/smoke/ceilingsweep.mjs --url=http://127.0.0.1:5200/ \
  --pose=forestfloor --repeats=5 --frames=600 \
  base width=800+height=450 width=2560+height=1440 width=3200+height=1800

# the poses this driver knows
node web/tools/smoke/ceilingsweep.mjs --list
```

**Run it on a box with a real GPU.** The probe refuses a software backend on
purpose, and §2.6 is about why that matters.
