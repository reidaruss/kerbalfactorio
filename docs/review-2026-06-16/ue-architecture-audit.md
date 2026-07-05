# UE Integration Layer: Architecture Audit (2026-07-05)

Auditor: architecture-audit subagent, reporting to Admin. Read-only pass over `ue/` at `main` (93 commits, HEAD `9d85a8d`). Evidence = file/line references, `git log`, line counts, `git count-objects`. No code was changed.

**Scope numbers:** the whole UE C++ layer is **9,824 lines across 41 files** (16 plugin classes in `OrbitalFoundryCore` + 4 runtime-module classes). It was built by ~15 sequential subagent passes (M2.1 through M5.2) over 3 days; each pass bolted onto the last.

---

## H1: "AOFPlanetTerrain is a god object" — VERIFIED

**Size:** `OFPlanetTerrain.cpp` = **2,100 lines**, `OFPlanetTerrain.h` = **411 lines**. Together 2,511 lines = **25.6% of the entire UE layer** in one class. **45 member-function definitions**, of which **12 are `Diag*` test hooks** (the class is also the test harness). The pImpl (`FImpl`, .cpp:52-74) owns four independent core systems at once: `BodyParams` + `SurfaceObserver` + `TerrainStreamer` + `TerrainDeform` + `VoxelEdits` + the `FrameRot` quaternion.

**Distinct responsibilities (10+), and the pass that added each** (`git log --follow -- OFPlanetTerrain.cpp` = 10 of the repo's ~41 UE-touching commits):

| Responsibility | Added by (pass) |
|---|---|
| Chunk streaming + PMC meshing + biome vertex paint | `ad472c5` (M4.0) |
| Floating origin + FrameRot + rebase + player-shift compensation | `ad472c5`, fixed `b9fe759` (M4.2) |
| Player placement + gravity/up service (`PlacePlayerOnSurface`, `GetGravityDir`) | `ad472c5`, reworked `21ac998` (M4.3) |
| Chunk collision (complex-as-simple, sync cook) | `21ac998` (M4.3) |
| Harvest-node streaming (`UpdateDeposits`/`ReanchorDeposits`/`SnapNodeToGround`) | `5d8bd30` (M4.1), lattice rewrite `fc66ed7` (M4.4), orient/embed `48d2ee9` (M4.5) |
| Heightfield deform dig/drill + selective remesh (`DigAtWorld`, `RemeshChunksAroundDir`) | `55e2d7d` (M4.6) |
| Deform persistence (`SaveDeform`/`LoadDeform`) | `c0130ec` (M4.6) |
| Foliage scatter, HISM management (`EnsureFoliage`/`UpdateFoliage`/`ReanchorFoliage`) | `8e3798c` (M5.1) |
| Voxel near-field mesh + collision + voxel dig + voxel persistence | `ff3dc12` (M5.2) |
| Material loading/selection (`MaterialForId`, `BiomeMaterials`) | M4.0/M4.3 |

Four hand-rolled re-anchor copies coexist (`ReanchorAllChunks`, `ReanchorDeposits`, `ReanchorFoliage`, `ReanchorVoxelMesh`), each re-implementing "re-derive root-local from cached body-frame position on rebase". Every new world-space system pays this tax again.

---

## H2: "Two parallel gameplay stacks" — PARTIAL (less duplicated than hypothesized, but real seams)

More is shared than the hypothesis assumed: **one character** (`AOFSurvivalCharacter`), **one node actor class** (`AOFResourceNode`), **one canvas HUD** (`AOFSurvivalHUD`, used by both maps via `AOFSurvivalGameMode`, which sets both DefaultPawn and HUDClass), **one automation manager**. The divergence is in *placement, smelting, dig, and legacy fallbacks*:

- **Node placement, two paths:** SurvivalTest nodes are authored flat into the umap (never got the M4.5 orient/embed pass, flagged in `ue/CLAUDE.md`); PlanetSurface nodes are streamed/ground-snapped/embedded by `AOFPlanetTerrain::UpdateDeposits`. Same actor, two lifecycles and two grounding rules.
- **Smelting, two sims:** `AOFFurnaceActor` owns and ticks its own `of::gameplay::survival::Furnace` (pImpl, `OFFurnaceActor.h:12-28`) for the SurvivalTest hand-load loop. `AOFAutomationManager::PlaceSmelter` runs a *different* smelter in `of::automation::BuildableNetwork` and spawns `AOFFurnaceActor` as a **visual shell with `bRunning=false`** (`OFAutomationManager.cpp:153-161`, comment: "it must NOT run its own embedded survival Furnace"). Every automation smelter carries a dormant duplicate sim.
- **Dig, three branches in one input handler:** `AOFSurvivalCharacter::OnDig` (`OFSurvivalCharacter.cpp:427-439`) dispatches build-mode → `OnPlaceBuilding()`, no-terrain (SurvivalTest) → legacy `HarvestNearest()`, planet → voxel dig. And there are **two live dig systems**: heightfield `TerrainDeform` (M4.6) and voxel `VoxelEdits` (M5.2). The pickaxe now uses voxels only (heightfield reconciled inside `DigVoxelAtWorld`); the **miner drill calls both every step** (`OFAutomationManager.cpp:325-328`: `DrillVoxelStepAtWorld` then `DrillStepAtWorld`), manually keeping the two representations in sync.
- **HUD residue:** the M2.5 UMG `WBP_SurvivalHUD` still lives in `/Game/UI` alongside the canvas HUD; `OFSurvivalHUD::DrawHUD` draws the automation readout on both maps unconditionally.
- **Two GameModes:** `AOrbitalFoundryGameMode` (M1 flight demo, subsystem readout/autopilot) vs `AOFSurvivalGameMode`; the former serves no current map's gameplay.

---

## H3: "Two scale regimes with no bridge" — VERIFIED (one correction)

- `AOFPlanetActor` `MetreToUE = 0.001f` (`OFPlanetActor.h:43`), `AOFVesselActor` `MetreToUE = 0.001f` (`OFVesselActor.h:49`): the scaled-space demos.
- **Correction:** `AOFFactoryActor` is `MetreToUE = 100.0f` (`OFFactoryActor.h:34`, "human scale"), not 0.001. The factory demo is a standalone human-scale render, not scaled-space.
- `AOFPlanetTerrain` `MetreToUE = 100.0f` (`OFPlanetTerrain.h:59`): 1:1 surface.
- **Zero shared UE-side code** between the regimes: the demo actors are referenced only by themselves (grep across `Source/` + plugin). The only shared layer is `/core` (`generateQuadMesh` is called by both `OFPlanetActor` and `OFPlanetTerrain`, which is the *right* kind of sharing).
- **No map, actor, or transition path links surface to orbit.** The demos are driven editor-side (no PIE) via `BuildJourney()`/`StepJourney()`. Worse, `OFVesselActor.cpp:18-23` states its autopilot state machine is "**ported verbatim** from `OrbitalFoundrySubsystem::AutopilotStep()`": a duplicated ~300-line journey script in two places.

The orbital/vessel work is a disconnected proof-of-render. The real scaled-space + dual-camera + regime-handoff architecture (rendering.md's plan) has no skeleton in code yet.

---

## H4: Structural smells — VERIFIED (itemized)

1. **Actors at the origin with world-space instances.** `OFBeltActor.h:45`: the belt "sits at the origin" and draws its deck via world-space instance transforms, so `GetActorLocation()==(0,0,0)`. Caused the M5.0 auto-connect bug; patched with `BuildingWorldLocation(idx, near)` (`OFAutomationManager.h:124-127`) rather than fixing the actor's transform. Any future system that queries belt location hits the same trap.
2. **Unity-build anonymous-namespace collisions, patched by renaming.** Evidence of three generations of collision-avoidance renames: `FMeshBuf` (`OFDroppedItem.cpp:96`) vs `FRNMeshBuf` + `RN*`-prefixed helpers (`OFResourceNode.cpp:27-132`), `kSc*` constants (`OFSurvivalCharacter.cpp:488,996-998`, renamed after colliding with `OFDroppedItem`'s `kRawIron`/`kIron`, per M4.6 gotcha 3). Root cause (shared mesh-building helpers copy-pasted per file into anonymous namespaces) never addressed; `OFPlanetTerrain.cpp` has two more anonymous namespaces (:868, :1484). The item-id constants are duplicated magic numbers that must match `/core` by hand.
3. **Per-frame world scans instead of events.** `AOFSurvivalHUD::DrawHUD` calls `Player->FindNearestNode()` **every frame** (`OFSurvivalHUD.cpp:63`), which is `GetAllActorsOfClass(AOFResourceNode)` + linear distance scan (`OFSurvivalCharacter.cpp:515-538`). `AOFDroppedItem` does `GetAllActorsOfClass(AOFSurvivalCharacter)` per item per tick (`OFDroppedItem.cpp:310`). Singleton lookups via `TActorIterator` on every `Get()` call. Fine at 40 nodes; wrong shape for a Factorio-scale game.
4. **`UOrbitalFoundrySubsystem` is now demo-only.** 335+122 lines; referenced only by `OrbitalFoundryGameMode` (the M1 flight readout) and by `OFVesselActor` (which duplicated its autopilot rather than calling it). Neither gameplay map uses it. It is not the "sim wrapper" anymore; it is a stale demo harness with a live copy-paste debt.
5. **The raw-vs-designed height split is systemic, not incidental.** Chunk meshes/collision sample RAW `sampleHeightField`; deposits and gravity/eye math use DESIGNED `sampleDesignedHeight` (`OFPlanetTerrain.cpp:645,1046,1099`; mismatch documented at :800-802). Every consumer that guessed wrong produced a shipped bug: floating nodes (M4.4, fixed by the `SnapNodeToGround` trace band-aid), and the voxel layer's own surface offset (M5.2 gotcha 1, fixed by the probe-inward "surface-snap" hack at .cpp:1622, stepping up to ~18 m along the radial to find real ground). Two band-aids, no single source of surface truth.
6. **Second god object forming.** `OFSurvivalCharacter.cpp` is 1,330 lines: movement, dual cameras, tools/anim, dig dispatch, harvest, sprint, menu gating, AND the build-placement + belt auto-connect wiring logic (:1219-1281), which is factory-domain logic living in the character.

---

## H5: Content/repo hygiene — VERIFIED

- `ue/Content` = **3,406 MB on disk**. Git-TRACKED: **2,553 MB of Content (2,670 MB tracked repo total)**. Untracked: `Megaplant_Library/` (694 MB, skeletal meshes, unusable), `WaterMaterials/` (88 MB), `B3D/` (71 MB) ≈ 853 MB.
- Tracked pack breakdown (MB): Maxtree 844, RockSample 535, OWD_Flowers_Pack 384, Materials_TreeBark 314, RockyGround 207, Characters (Mannequin) 98, BarkWillow 81, Abelia 38, Vitex 29, StarterContent 12, Lolium 5, Maps 5.
- **10 vendor demo maps ARE committed** (`git ls-files '*.umap'`): Abelia sample, BarkWillow `Demo`, Lolium, TreeBark `Showcase`, OWD `Scene`+`Showroom`, RockSample `Demo`+`Overview`, RockyGround `Overview_Map`, Vitex. Only `PlanetSurface.umap` + `SurvivalTest.umap` are ours.
- **No git-LFS.** `.gitattributes` only marks `*.uasset`/`*.umap`/`*.fbx` as `binary`; no `filter=lfs` lines; `git lfs ls-files` is empty.
- `git count-objects -vH`: **2,418 loose objects, 2.43 GiB, 0 packs** (never gc'd/packed). `.git` = 2.44 GiB. **No remote configured.** Consequence: the repo cannot be pushed to any normal host as-is (GitHub hard-caps 100 MB/file, and several uassets exceed that); every clone would pull ~2.5 GB of binary history; the 845 MB Maxtree pack is baked into history even if untracked later. Because there is NO remote yet, a history rewrite (or fresh-rooted repo with LFS from day one) is still cheap. That window closes at first push.

---

## Target consolidation architecture (minimal-churn, honest)

**Principle: one coordinate/origin authority, components per concern, one gameplay stack, demos quarantined.**

1. **Decompose `AOFPlanetTerrain` into a thin `AOFPlanetBody` actor + four components.**
   - `AOFPlanetBody` (keeps the actor root): owns `BodyParams` + `SurfaceObserver` + `FrameRot` + floating origin. Publishes TWO things everyone else consumes: an **origin/frame service** (world↔body transforms, `GetGravityDir`, and an `OnOriginRebased(delta)`/`OnFrameChanged` broadcast) and a **single surface oracle** (`SurfaceHeightAt(dir)` that answers from the SAME field the collision is meshed from, killing the raw-vs-designed bug class at the source).
   - `UOFTerrainStreamingComponent`: `TerrainStreamer` + chunk PMC mesh/collision + biome vertex paint.
   - `UOFDestructionComponent`: `TerrainDeform` + `VoxelEdits` + the near-field mesher + surface reconciliation, **merged into one component** because the two representations must stay in lockstep (today's miner calls both by hand; the seam/surface-snap hacks live here and get one owner).
   - `UOFScatterComponent`: ONE global-angular-lattice streamer with two consumers (harvest nodes, foliage HISMs) instead of two parallel implementations; ground-snap via the surface oracle.
   - Re-anchoring becomes: each component subscribes to `OnOriginRebased` (one contract, not four hand-rolled `Reanchor*` copies). `SaveDeform`/`LoadDeform` move to a `UOFWorldSaveSubsystem` (persistence domain owns the file format, terrain just serializes its diff).
2. **One gameplay stack; SurvivalTest demoted.** Keep `AOFResourceNode`, `UOFSurvivalComponent`, menus, dropped items as-is (they are already shared). Retire SurvivalTest as a *product* map: keep it only as a fast regression map, and delete its legacy code branches (the `OnDig` no-terrain fallback, the umap-authored flat nodes) once PlanetSurface has a flat-biome start preset. `AOFFurnaceActor` splits: visual mesh/readout stays; its embedded `survival::Furnace` sim is retired and the hand-fed furnace becomes a Tier-0 building in `BuildableNetwork` (one smelting truth). Move build-placement/auto-connect wiring out of `OFSurvivalCharacter` (:1219-1281) into `AOFAutomationManager`; give `AOFBeltActor` a real transform (actor at segment midpoint, instances local) so `GetActorLocation()` is meaningful and `BuildingWorldLocation` shrinks to a convenience.
3. **Events over scans.** Nearest-node comes from `UOFScatterComponent`'s resident set (it already owns a spatial lattice) via a throttled query the character caches; HUD reads the cache. Dropped-item pickup via overlap sphere, not per-tick actor scans.
4. **Quarantine the scaled-space demos; extract the one reusable piece.** `OFFactoryActor` + `OFVesselActor` + `OrbitalFoundryGameMode` + `UOrbitalFoundrySubsystem` retire to a `Demos/` module (or are deleted; git preserves them). The journey autopilot gets ONE home (a plain C++ `FJourneyAutopilot` in the plugin or `/core`), fixing the verbatim-port duplication. **`AOFPlanetActor` stays**: it is the seed of the future scaled-space far-field renderer. The surface↔orbit bridge is then an explicit new deliverable: a `RegimeManager` that owns the handoff between `AOFPlanetBody` (near-field, 1:1) and `AOFPlanetActor` (far-field, scaled), which is the M6-class rendering milestone, not something to retrofit into either class.
5. **Repo:** untrack the 10 vendor demo umaps + unused pack remainders; adopt LFS (or an asset-store submodule) for `uasset/umap/fbx`; `git gc`; and decide NOW (pre-remote) whether to rewrite history to strip the 2.4 GB of binary blobs, because after the first push it becomes a breaking change for every clone.

**Class disposition summary:** STAY: `OFPlanetActor`, `OFResourceNode`, `OFDroppedItem`, `OFSurvivalComponent`, `OFPlayerMenuWidget`/`OFInventorySlotWidget`, `OFSurvivalGameMode`/`OFSurvivalHUD`, `OFAutomationManager` (grows), `OFSurvivalCharacter` (shrinks). SPLIT: `OFPlanetTerrain` → `AOFPlanetBody` + 4 components. MERGE/ABSORB: `OFFurnaceActor` sim into automation; `OFMinerActor`/`OFBeltActor`/`OFAssemblerActor`/`OFFurnaceActor` visuals toward one data-driven building-visual family. RETIRE (to Demos/ or delete): `OFFactoryActor`, `OFVesselActor` (after autopilot extraction), `OrbitalFoundrySubsystem`, `OrbitalFoundryGameMode`.
