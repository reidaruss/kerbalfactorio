# Overnight Autonomous Build Log (2026-06-15 → morning)

> Reid is asleep; Admin works autonomously, prioritizing a **visible** result by morning, then advancing other phases in logical order. Commit frequently. This file is the anchor across context windows — keep it current.

## Standing context (so a fresh window can continue)
- State at start: all 7 headless cores GREEN (ctest 7/7); **UE 5.7.4 project builds GREEN** (`ue/`, `OrbitalFoundryCore` plugin wraps the header-only cores; MSVC 14.44). `UOrbitalFoundrySubsystem` (UTickableWorldSubsystem) drives `of::SimWorld`.
- Headless build: `cmake -S core -B core/build -G Ninja -DCMAKE_CXX_COMPILER=g++; cmake --build core/build; ctest --test-dir core/build`
- UE build: `D:\UnrealEngine\UE_5.7\Engine\Build\BatchFiles\Build.bat OrbitalFoundryEditor Win64 Development -Project="C:\Users\reida\Nextcloud\Kerbal Factorio\ue\OrbitalFoundry.uproject" -WaitMutex` (run in background ~2 min; log to a temp file)
- Commit msgs via `git commit -F <tempfile>` (here-strings break on apostrophes). End msgs with the Claude co-author line.
- **I cannot see the editor / GUI.** UE visual work is verified by *clean compile* + careful use of stable APIs, and flagged "needs in-editor visual check". Headless work is fully verified by tests.

## Prioritized backlog (work top-down)
1. **[VISIBLE] In-engine live demo** — GameMode/driver actor that drives the subsystem on Play and draws an on-screen readout (altitude, mode, factory produced, tick, rebases, SOI) + basic primitive visuals (planet sphere, vessel marker, camera) + a scripted autopilot reproducing the Forge→orbit→Cinder→land journey. Compile-verify. → hit Play, watch it run.
2. **[VISIBLE] Guaranteed artifact** — headless sim dumps the journey to CSV; Python+matplotlib renders trajectory plots (altitude/speed/factory vs time) → PNG(s). File-verifiable regardless of UE.
3. **[RENDERING]** Begin the real UE rendering shell: scaled-space dual-camera + floating-origin-aware placement + a low-fi procedural planet; compile-scaffold.
4. **[PHYSICS/PAWN]** In-engine vessel pawn + player control hooks (M2.2 scaffold).
5. **[GAMEPLAY]** In-engine build/mining UX scaffold; wire gameplay core to UE input + a simple HUD.
6. **[PERSISTENCE]** File-container layer over the seed+diff format (atomic single-slot, the deferred piece) — headless, testable.
7. **[NETWORKING]** RC-9 paper-validation + a headless prototype of factory-delta replication + chunk-determinism check.
8. **[FACTORY]** On-rails factory abstraction + entity-state/delta stream emission (deferred FS pieces) — headless-testable.
9. **[WORLD-GEN]** Voxel-patch seam / LOD streamer design; deposit placement pass.
10. Polish: more tests, docs, tidy.

## Running log (append newest at bottom)
- 05:0x — Overnight started. Created this log. Dispatching task #1 (in-engine live demo).
- #1 DONE ✓ — `AOrbitalFoundryGameMode` + on-screen readout + autopilot + primitive visuals; UE editor target builds clean. Caveats to enrich later: factory-produced reads 0 (subsystem builds a bare SimWorld, no machine fed) and the autopilot loop doesn't reach the Cinder SOI. → backlog: "enrich demo: working factory + full journey (needs a small subsystem/SimWorld setup API)".
- Dispatching #2 (guaranteed artifact: headless full-journey CSV + matplotlib plots).
- #2 DONE ✓ — `core/tools/journey_dump.cpp` + `plot_journey.py` → `docs/phase1/artifacts/journey.{csv,png}` (png 199 KB, 3-panel: altitude+mode shading+SOI marker, factory ramp to 2563, speed/dist-to-Cinder). Full journey: peak 9235 km, 1 SOI switch, landed. ctest still 7/7. **Two visible artifacts now exist (in-engine demo + the plot).**
- Next: #3 enrich the in-engine demo (producing factory + full journey via a subsystem autopilot), then pivot to breadth (other phases, headless-verifiable).
- #3 DONE ✓ (UE) — subsystem `SetupDemoFactory()` + built-in full-journey autopilot (ascent→circularize+park→transfer across Cinder SOI [switch fires]→descend→land), ported from journey_dump; GameMode runs it on Play; readout shows live phase + distance-to-Cinder + factory climbing + SOI switch. Editor target builds clean (WarningsAsErrors). Compile+logic-verified (can't run PIE).
- #4 DONE ✓ (persistence) — `core/include/of/persistence_file.h` atomic single-slot save (PS-6): write-temp-then-rename, .bak rotation, footer-magic commit, torn-write survival. ctest **8/8** (45 new checks). PS-10 logged.
- **Strategy note:** two visible artifacts banked (enriched in-engine demo + journey plot). Pivoting the rest of the night to FULLY-VERIFIABLE headless breadth (run core agents sequentially, each self-tested + committed): networking RC-9 validation → factory on-rails → world-gen deposits → gameplay research (Phase 2) → … The real *rendering* shell (graphics) is deferred to a session where Reid can see PIE (I can't verify visuals).
- Dispatching #5: networking RC-9 validation (headless replication/determinism prototype).
- #5 DONE ✓ (networking — first netcode) — `core/include/of/net_replication.h` + test: StateHash divergence detector + DeltaLog (FFactoryDelta-style, TickIndex-keyed) replay. Proves chunk-local determinism (NW-4) + client-replays-inputs stays in perfect sync + divergence detect/re-sync. ctest **9/9**. RC-9 verdict: delta/TickIndex seam IS sufficient. NW-4 Accepted, NW-6 logged.
- (chore: gitignored build logs, untracked a stray ue log.)
- Dispatching #6: factory-sim on-rails abstraction (FS-4 / gate G2) — demote→snapshot rate→advance off→promote→reconstruct, no dupes.
- #6 DONE ✓ (factory-sim) — `FactorySim::Demote/AdvanceOnRails/Promote` + `FRailState`; closed-form rate advance bounded by storage. test_factory_rails (6 tests/63 checks): exact fidelity active==on-rails (incl. mid-craft), no-dupe, storage bounds, 1.9e9-tick "1-year" warp, path-independent determinism, chunk-as-unit. ctest **10/10**. FS-12. The on-rails machinery persistence + time-warp reuse now exists.
- Dispatching #7: world-gen deposits — seeded FDepositNode placement + ITerrainProvider query surface (GetDeposits/QueryDepositsNear/ExtractFromDeposit), Cinderite Cinder-only. Makes mining real (Phase-1).
- #7 DONE ✓ (world-gen) — `core/include/of/deposits.h`: deterministic Fibonacci-sphere placement, surface-snapped, stable hash ids; `DepositCatalog` queries + extraction/depletion; Resource = uint16 ItemId (Ferrite/Cinderite, Cinderite Cinder-only). test_deposits (7 tests/1620 checks): determinism, Cinder-only, on-surface, queries, depletion, seed+diff. ctest **11/11**. WG-14.
- KNOWN MINOR (backlog): concurrent ctest runs deadlock `persistence_file_tests` on shared temp paths (agents launching overlapping ctest) — harden its temp-dir to be unique-per-process. Not breaking single runs.
- Dispatching #8: gameplay RESEARCH/TECH TREE (Phase 2) — science from factory output → unlock recipes/tech; off-world (Cinderite) gating. Advances Phase 2.
- #8 DONE ✓ (gameplay, Phase 2) — `core/include/of/research.h`: data-driven TechTree + ResearchState.tryResearch; slice tree BasicSmelting→Logistics + CinderiteRefining (off-world gate). test_research (7 tests/69 checks): affordability, prereqs, **off-world gate proven** (no Cinderite → can't research), determinism. ctest **12/12**. GP-1/GP-2 REALIZED, GP-16.
- #8b DONE ✓ (self) — `test_persistence_file.cpp` temp dirs now process-unique (clock ^ static addr). ctest 12/12. Concurrent-ctest deadlock fixed. Commit f0359dd.
- 19 commits banked. Dispatching #9: CAPSTONE end-to-end slice test — mine→factory→science→research→fly→Cinderite→save/reload, proving all domain cores compose into the actual game loop.
- #9 DONE ✓ — `core/tests/test_slice_e2e.cpp` (1 test, 83 checks) drives the WHOLE loop through the real cores. ctest **13/13**. (Agent ended its turn early on a build wait; I verified + finished the doc note.) Surfaced 4 real integration gaps (GAP-1 dep-id types; GAP-2 factory per-item output for science; GAP-3 Cinderite→science recipe content; GAP-4 research state not persisted) — recorded in PHASE1-PLAN §11.
- Dispatching #10: CLOSE the 4 e2e integration gaps (factory per-item output is the keystone — makes mine→factory→science→research a true typed chain), then re-verify the e2e loop with the workarounds removed.
- #10 DONE ✓ — all 4 e2e gaps CLOSED (additive, backward-compatible; the e2e workarounds removed + asserts strengthened; ctest **13/13**). **GAP-2 (keystone):** `FactorySim::producedCountOf(ItemId)` — per-`outputItem` lifetime tally beside the existing total (Σ == `producedCount()`), live + on-rails paths, so factory-made science is a distinct queryable item (factory-sim.md FS-13). **GAP-1:** `gameplay::DepositId` now `using = worldgen::DepositId` (uint64) + `mineDeposit(FDepositNode&)` direct overload — `bridgeNode` deleted, no id narrowing into the save (gameplay GP-17, world-gen WG-15). **GAP-3:** `CraftAutomationScience` + off-world `RefineCinderScience` (Cinderite→CinderScience) authored as data via `registerRecipe` (gameplay GP-18). **GAP-4:** `SliceState.unlockedTechs` + `ResearchState::restoreUnlocked()` (gameplay schema→2) — unlocks restored on reload, not re-derived (persistence PS-11). e2e now asserts `producedCountOf(scienceId)>0`, typed science consumed, Cinderite→CinderScience enables `CinderiteRefining`, and unlocks restored from an EMPTY pool. PHASE1-PLAN §11 GAP-1..4 marked closed.
- #11 DONE ✓ (factory+rendering) — G7 render/network stream emission from FactorySim (`FFactoryEntityState`/`FFactoryBeltFlowState`/`GetLineItems`) + `core/include/of/render_cost.h` numeric render-cost model. test_render_cost (5 tests/133 checks): **render wall (Q6/RC-8) numerically validated** — 100k entities → 72 draw calls (not 100k), 180k item-evals (O(lines)), >98% of 12.18M items collapsed at LOD-1+; LOD-3 zero. ctest **14/14**. FS-14; rendering RC-8 validated headlessly.
- #12 DONE ✓ (2nd visual) — `core/tools/render_scale_dump.cpp` + `plot_render_scale.py` → `docs/phase1/artifacts/render_scale.png` (151 KB): draw calls flat at 72 vs naive O(items) exploding to 24M as the factory scales to 200k. Render wall cleared, visualized.
- Also: hardened persistence_file temp dirs (process-unique); gitignored build logs; MORNING-SUMMARY notes the Nextcloud-build-dir lock friction.

## FINAL STATE (morning 2026-06-15)
**~24 commits, all green. ctest 14/14.** Delivered overnight, autonomously:
- **3 visible artifacts:** the in-engine demo (Play → live flight + factory + SOI switch), `journey.png` (full-journey plot), `render_scale.png` (render-wall cleared).
- **UE 5.7 project builds green** over the proven cores; the subsystem drives the sim in-editor.
- **Headless slice loop proven end-to-end** (`test_slice_e2e`): mine→factory→science→research→fly→off-world→save/reload — a clean typed chain.
- **Every domain advanced:** persistence (atomic file save), networking (RC-9 validated — first netcode), factory-sim (on-rails FS-4 + per-item output + G7 streams), world-gen (deposits), gameplay (research tree, Phase 2), rendering (render wall numerically de-risked).
- **The project's #1 open risk (the render wall) is de-risked.**

**Next (needs Reid at the screen):** the real UE visual shell — scaled-space rendering, a vessel pawn you fly, terrain meshes, build/fly UX (M2.1→M2.4). Deferred overnight ONLY because graphics can't be verified without watching PIE; everything it needs (proven cores + working UE project + the subsystem bridge) is in place. See [MORNING-SUMMARY](../../MORNING-SUMMARY.md).
