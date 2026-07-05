# Core + Docs Design-Coherence Audit

**Auditor:** design-coherence subagent, reporting to Admin Master Controller
**Date:** 2026-07-05 (audit label: review-2026-06-16 series) · **Scope:** headless `/core`, `ue/Plugins` height consumers, all decision registers. Read-only; no code or doc edited; nothing committed.

---

## Task A — Definitive test status: 21/21 GREEN; the "failures" are a PATH/DLL artifact

Fresh out-of-tree configure + build of `core/` (CMake + Ninja, WinLibs GCC 16.1.0 UCRT, Release): **clean build, 21 registered ctest suites**.

| Run condition | Result |
|---|---|
| PowerShell, WinLibs `mingw64\bin` on PATH (before Git's) | **21/21 PASS** (6.2 s total) |
| MSYS/Git Bash (any PATH) | `persistence_file_tests` + `slice_e2e_tests` **fail to load** (exit 127 / `0xc0000139` STATUS_ENTRYPOINT_NOT_FOUND); all other 19 pass |
| PowerShell with WinLibs stripped from PATH | Same two suites fail to load; under ctest each stalls in Windows Error Reporting ~1000 s (matches the historical `ctest_m46.log` "Exception: 1019.28 sec") |

**Root cause (proven, not inferred):** every test exe dynamically links `libstdc++-6.dll` + `libgcc_s_seh-1.dll` (objdump confirmed). Git for Windows ships an **older** `libstdc++-6.dll` (2,345,455 bytes) at `C:\Program Files\Git\mingw64\bin`, which is on the **system PATH**, and in Git Bash `/mingw64/bin` always precedes everything. The WinLibs GCC 16 DLL is 2,608,670 bytes. Only the two `<filesystem>`-using suites import symbols missing from the old DLL, so exactly those two die at load; the other 19 happen to resolve. **Both prior agent reports were accurate observations of the same binaries under different PATHs. There is no code regression.**

One genuinely historical failure: `core/build/ctest_m46.log` shows `terrain_stream_tests` **Failed** (a real assertion failure, not a load error) at M4.6-time. Current source passes it, so it was fixed before landing; worth knowing the suite did break mid-M4.6.

**Tooling debt (flag for build-tooling):**
1. The suite's greenness depends on ambient PATH ordering. Fix: add `-static-libstdc++ -static-libgcc` (or full `-static`) for MinGW targets in `core/CMakeLists.txt`; suites become PATH-independent everywhere, including Git Bash and CI.
2. The load failure manifests as a ~17 min ctest stall per suite (WER), which is how "hung overnight runs" happen. A ctest `TIMEOUT` property is cheap insurance.
3. Neither the env sensitivity nor the canonical run recipe is recorded in `build-tooling.md` (whose status line still says "7 suites"; there are 21).
4. `ue/CLAUDE.md` M5.2 calls the two failures "pre-existing": they are environmental, and the honest statement is 21/21 under the correct toolchain PATH.

---

## Task B — The four heights: hypothesis CONFIRMED (and it is effectively five surfaces)

### The four definitions

| # | Name | Function | Value |
|---|---|---|---|
| 1 | RAW | `cubed_sphere.h sampleHeightField` | noise stack only |
| 2 | DESIGNED | `biome.h sampleDesignedHeight` | RAW reshaped per biome (mountains ×1.60, plains ×0.45, beach ×0.15, ocean carved below datum, polar +0.04·maxRelief). Diverges from RAW by up to tens-to-hundreds of metres |
| 3 | DEFORMED | `terrain_deform.h deformedHeight` | DESIGNED − edit, clamped to DESIGNED − 80 m |
| 4 | VOXEL-SOLID | `voxel_terrain.h isProcSolid` | solid iff radius ≤ body R + **RAW** (not designed, not deformed) |

**The fifth surface:** the rendered/collision mesh is none of the above. `generateQuadMesh` samples **RAW** and subtracts the deform map via `HeightLoweringFn` (`cubed_sphere.h:527`, bound to `depthDugAt` at `OFPlanetTerrain.cpp:180`). So the SAME edit map produces two different dug surfaces: mesh = RAW − edit, sampler = DESIGNED − edit (with the bedrock clamp living only on the sampler path). `/core` even contradicts itself in comments: `surface_walk.h:29` claims the snap uses "the SAME sampleDesignedHeight the mesh uses" (the mesh uses RAW), and `terrain_deform.h:18` claims "terrain_stream + UE collision sample this [deformedHeight]" (they sample RAW − lowering).

### Consumer map

| Consumer | Surface used | Evidence |
|---|---|---|
| Rendered mesh + player collision (`generateQuadMesh`, `buildChunk`, `TerrainStreamer`, incl. M4.6 lowering) | RAW − deform lowering | `cubed_sphere.h:527`, `terrain_stream.h:388,435`, `OFPlanetTerrain.cpp:180` |
| LOD/streaming observer distances | RAW | `terrain_stream.h:178,187` |
| Player eye / surface snap (`SurfaceObserver`) | DESIGNED (no deform, no voxels) | `surface_walk.h:129-135` |
| UE player spawn (`PlacePlayerOnSurface`) | DESIGNED eye + 2 m, falls onto RAW−lowering collision | `OFPlanetTerrain.cpp:1210-1234` |
| Deposit nodes, core catalog (`deposits.h`) | RAW | `deposits.h:152-154,174,398` |
| Planet-wide resources (`biome.h GeneratePlanetResources`) | DESIGNED | `biome.h:426` |
| UE local deposits + foliage | DESIGNED, then rescued by a world line-trace onto collision | `OFPlanetTerrain.cpp:645,684,1046,1099` |
| Voxel solidity (`isProcSolid`, `surfaceRadiusAt`) | RAW | `voxel_terrain.h:145-155` |
| Vessel landing / terrain altitude (`sim_world.h`) | RAW | `sim_world.h:216` |
| Deform sampler `deformedHeight` | DESIGNED − edit (used by tests; NOT by the mesh path) | `terrain_deform.h:422-431` |

### Bug forensics: were the fixed bugs mismatch symptoms?

- **M4.4 floating nodes: YES.** Nodes at DESIGNED, collision at RAW; the fix (`SnapNodeToGround`, `OFPlanetTerrain.cpp:684`) is a runtime trace that papers over the gap and even logs `designedGap`. Every deposit/foliage placement now pays a line-trace to undo the mismatch.
- **M4.0/M4.3 floating player + teleport: YES (compound).** Player pinned to the DESIGNED eye over a RAW mesh with no collision; fixed by adding collision and letting gravity absorb the designed-vs-raw delta.
- **M5.2 voxel dig landing in air: YES.** Voxel surface = RAW, the ray hits RAW−lowering collision, plus a real precision wrinkle (`unitOf` on a ~6e5 m vector). The "surface-snap" hack probes up to 18 m inward for the first solid cell (`OFPlanetTerrain.cpp:1622-1649`). The comment says verbatim: "designed-vs-raw relief gap".
- **M4.2 tilted-ground: NO.** That was `ComputeFrameRot` matrix/handedness, not a height mismatch. So "every major experience bug" slightly overclaims; "every floating/air-gap bug" is exactly right.

### Consolidation proposal: ONE layered surface authority

Add a small `/core` type (world-gen owned), e.g. `worldgen::SurfaceField { const BodyParams&; const VoxelEdits*; }` exposing:

- `heightAt(dir)` = `sampleDesignedHeight(dir)` − `loweringAt(dir)`, clamped to bedrock (the ONLY height anyone samples), where `loweringAt` is **derived from voxels** (see below);
- `solidAt(cell)` = `|cellCenter| ≤ R + heightAt(unitOf(center))` AND NOT removed. Voxel solidity thereby derives from THE SAME function as the mesh.

Rewiring: `generateQuadMesh`/`buildChunk` take a full height callback (replacing `HeightLoweringFn`) or the `SurfaceField`; `surface_walk` snap → `heightAt` (players stop hovering over their own digs); `deposits.h` snap → `heightAt` (kills the RAW/DESIGNED node split; `SnapNodeToGround` becomes belt-and-suspenders, not load-bearing); `isProcSolid` gains an injected height fn (header stays leaf); `sim_world::terrainRadius` → `heightAt`; the M5.2 surface-snap probe and per-column reconciliation move from `OFPlanetTerrain.cpp` into `/core` where they are testable.

**Re-baselining cost (the honest bill):** every bit-pinned RAW baseline changes: `test_world_gen` (contentHash/bit-identity pins), `test_terrain_stream` (~20 bit checks incl. the optimized-sampler identity and chunk heights), `test_voxel_terrain` (RAW solidity), `test_deposits` (RAW snap), `tools/procgen_bench` (its embedded reference copy). Unaffected: `test_biome` (designed-edge identity survives), `test_terrain_deform` (already designed-based), most of `test_surface_walk`. These pins are regression anchors, not external contracts; a one-time deliberate re-baseline is the price of one truth.

### Two destruction systems: subordinate terrain_deform to voxels

Today `terrain_deform` (~3.6 m cells, 80 m bedrock) and `voxel_terrain` (1 m³) are BOTH independent player-edit stores, reconciled UE-side: `DigVoxelAtWorld` back-derives a heightfield lowering from each column's top-anchored run of removed voxels (`OpenColumn`, `OFPlanetTerrain.cpp:1663-1708`), and miners drive BOTH drills. Both serialize into one ad-hoc file.

**Recommendation: keep the heightfield LAYER, retire it as an edit AUTHORITY.** The voxel removed-set becomes the sole source of truth for destruction; heightfield lowering becomes a derived view (promote the existing `OpenColumn` logic into `/core`, e.g. `VoxelEdits::surfaceLoweringAt(dir)` or a sync pass producing a `TerrainDeform` cache), regenerated on load rather than persisted alongside. Justification for keeping the layer: a planet-scale LOD mesh cannot be cubes, so a smooth lowered heightfield remains the right far/mid representation. Justification for keeping it as an independent edit store is now gone: since M5.2 the pickaxe routes through voxels anyway, and dual authorities are exactly where the drift bugs breed. This also halves the destruction persistence surface.

---

## Task C — Doc drift + decision-register audit

### (1) Decisions VALIDATED by what got built
D-002/PH-3/PH-6 (patched conics, no-drift 2.4e-11); D-003/CE-2/FS-4/FS-12 (on-rails, zero-dup promote/demote); D-006 (1:1 Forge 600 km actually shipped and walked on); CE-4/CE-5/CE-6 (floating origin: 99 rebases over 180 km, bounded coords); WG-6 (bit-identical seams held through biomes, deform, streaming); WG-4 + GP-2 (Cinderite off-world gate proven end-to-end); FS-11 (100k @ 510-576 UPS); FS-14/RC-8/RN-3 (72 draw calls @ 100k entities); NW-4/NW-6 (delta-replay seam); PS-1/PS-9/PS-10 (seed+diff + atomic container, headless); GP-1, GP-19 (built as specified); WG-11/C-1 (FDepositNode consumed verbatim by UE); BT-1 (the headless-harness bet carried the entire project).

### (2) Decisions CONTRADICTED by reality
- **Root `CLAUDE.md`: "Planning repo for now. No engine/code is committed yet."** Flatly false: `/core` (22 headers, 21 suites) + a playable UE project at M5.2.
- **`MASTER_PLAN.md` §8: "Current phase: Phase 0 — Planning. Spikes not yet greenlit"** and "No content before the hard tech is proven": the repo shipped foliage packs, a build grid, and voxel tunneling while Phase-0 spike #1 (seamless surface↔orbit) has never run in-engine.
- **RN-5: terrain = RealtimeMesh.** Actual: `UProceduralMeshComponent` everywhere; no RealtimeMesh plugin exists in the repo. The register was never amended.
- **RN-1: dual-camera scaled space, Accepted 2026-06-14.** Never built; M4.0 explicitly ships "REAL scale... NOT the 0.001 scaled-space". The orbital preview and the surface world remain two disconnected scenes.
- **D-005 / Q4 / WG-2: "v1 = node-based mining, no voxel (voxel = Phase 4)."** WG-18 heightfield digging AND WG-20 voxel tunneling both shipped in Phase 1, with no Admin-logged supersession of D-005's scope line.
- **PH-5: terrain collision = analytic queries, NOT baked per-quad meshes.** M4.3 bakes complex-as-simple PMC collision and the character physically stands on it (the vessel path is still analytic). Unlogged reversal for the character domain.
- **`ADMIN.md` dashboard: rendering "Phase 0, Spike 1 designed"** while `rendering.md` itself says Phase 1 / M5.2 landed. The Admin's own dashboard contradicts its subordinate file.

### (3) Decisions with NO owner
- **The voxel near-field pipeline.** WG-20 covers only the core header. The cube mesher (rendering), dig UX (gameplay), the deform↔voxel reconciliation policy, and the surface-snap hack all live in `OFPlanetTerrain.cpp` with no decision entry in rendering.md or gameplay.md; the reconciliation policy exists only as `ue/CLAUDE.md` prose.
- **Foliage scatter (M5.1).** No decision ID in any register.
- **The shipped save file** (`Saved/OrbitalFoundry/deform_<seed|slot>.bin`). persistence.md has no entry; the persistence controller does not own what the game actually writes to disk.
- **`OFPlanetTerrain.cpp` itself** (2,100 lines) spans world-gen, rendering, gameplay, and persistence with no domain owner; it is where all four height definitions meet and where every workaround lives.

### (4) Stale status lines
Root `CLAUDE.md` ("Planning repo", "today: 2026-06-14"); `MASTER_PLAN.md` header (last updated 06-14, Phase-0 current-phase line); `ADMIN.md` (last updated 06-14; M1 "build pending"; rendering row Phase 0); `physics.md` "Phase: 0" while claiming Wave-0 BUILT; `networking.md` "Phase: 0, Scoping"; `build-tooling.md` "7 suites" (21) and "8 commits"; `ue/CLAUDE.md` "19/21 green, 2 pre-existing failures" (env artifact; 21/21).

### The THREE persistence paths (unified-save gap)
1. **Headless slots:** `persistence.h` + `persistence_file.h` `SaveToSlot`/`LoadFromSlot` (PS-6/PS-10: temp-then-rename atomic, .bak). Zero UE consumers (grep-confirmed).
2. **UE ad-hoc file:** `SaveDeform`/`LoadDeform` write `of::persist::SaveWriter` bytes via `FFileHelper` to `deform_<seed|slot>.bin`. NOT atomic (no temp-rename), so it violates the spirit of PS-6 in the only place players can lose data.
3. **Voxel piggyback:** `VoxelEdits::serialize` appended to stream #2 (M5.2).

The larger gap: the UE game persists ONLY terrain edits. Inventory, factory network, research, and player position are saved nowhere in UE (the full slice save exists only headless). **Recommendation:** one UE save slot built on `persistence_file.h`'s atomic container with sections (core state, voxel diff [deform derived], factory, gameplay), retiring the ad-hoc file. Owner: persistence-controller, with an Admin-logged contract.

### GP-19: two smelting models the player can see
Survival `Furnace` (gameplay.h §S: fuel-burn pool, furnace 180 / smelter 60 ticks) vs `automation.h placeSmelter` (FactorySim machine, craftTicks 60, `powerW` **defaults to 0**, i.e. currently smelts for free; FS-5 brownout exists but is unexercised). In UE the SAME actor shell (`AOFFurnaceActor`) is both the standalone survival furnace and the automation smelter's visual (M3.2, `bRunning=false`). So the player sees one object with two rule systems: one consumes fuel, one consumes nothing. **Assessment:** GP-19's rationale (don't distort the factory power SoA with fuel) remains sound as a *tier* design, but as shipped it is an unpresented duality. Recommend an Admin decision: fuel Furnace = primitive tier, powered Smelter = automation tier, one shared recipe/rate table, and a nonzero `powerW` so FS-5 actually gates it; visually differentiate the actors.

---

## Punchline for the rethink
The worst experience bugs were not random UE friction: they were the deterministic tax of four (really five) surface definitions, each patched at the symptom (trace-snap nodes, drop-the-player, probe-inward digging, per-column reconciliation) instead of consolidated at the source. One `SurfaceField` authority in `/core` plus voxels-as-sole-edit-truth removes the entire hack family, at the cost of a one-time test re-baseline. The docs meanwhile describe a project two phases behind the code; the registers need a reconciliation pass (RN-5, RN-1, D-005/Q4, PH-5) and three systems need owners (voxel pipeline, foliage, the real save path).
