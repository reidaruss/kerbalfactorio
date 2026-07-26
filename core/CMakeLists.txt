cmake_minimum_required(VERSION 3.16)
project(orbital_foundry_core CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

if(NOT CMAKE_BUILD_TYPE)
  set(CMAKE_BUILD_TYPE Release)
endif()

if(NOT MSVC)
  add_compile_options(-Wall -Wextra -O2)
endif()

# Static-link the GNU runtime into every target (tests + tools) so the exes do
# not depend on whichever libstdc++-6.dll is first on PATH. Git for Windows
# ships an older libstdc++-6.dll on the system PATH that lacks the
# <filesystem> symbols, which made the two <filesystem> suites die at load
# (0xc0000139) or pass depending on the shell. Static linking makes ctest
# results shell-independent (PowerShell, Git Bash, CI). `-static` also pulls
# in winpthread statically.
if(MINGW)
  add_link_options(-static-libstdc++ -static-libgcc -static)
endif()

# Header-only shared core library (the substrate every domain core builds on).
add_library(of_core INTERFACE)
target_include_directories(of_core INTERFACE ${CMAKE_CURRENT_SOURCE_DIR}/include)

enable_testing()

# --- Wave-0 headless test executables (one per domain core) ---
add_executable(core_engine_tests
  tests/test_main.cpp
  tests/test_core_engine.cpp)
target_link_libraries(core_engine_tests PRIVATE of_core)
target_include_directories(core_engine_tests PRIVATE tests)
add_test(NAME core_engine_tests COMMAND core_engine_tests)

add_executable(factory_sim_tests
  tests/test_main.cpp
  tests/test_factory_sim.cpp)
target_link_libraries(factory_sim_tests PRIVATE of_core)
target_include_directories(factory_sim_tests PRIVATE tests)
add_test(NAME factory_sim_tests COMMAND factory_sim_tests)

# --- Factory ON-RAILS abstraction (FS-4, gate G2): demote a distant chunk to a
#     steady-state production-rate model, advance it by rate x elapsed (bounded
#     by input/output storage), promote it back with buffers reconstructed —
#     deterministically, with NO duplication. Headless; proves G2 fidelity +
#     the storage bound against the continuous-active baseline.
add_executable(factory_rails_tests
  tests/test_main.cpp
  tests/test_factory_rails.cpp)
target_link_libraries(factory_rails_tests PRIVATE of_core)
target_include_directories(factory_rails_tests PRIVATE tests)
add_test(NAME factory_rails_tests COMMAND factory_rails_tests)

# --- Factory RENDER-COST model (Q6 / RC-8, gate G7): numerically back the
#     render-wall claim HEADLESSLY. The factory's §6 stream (additive emission
#     from FactorySim — FFactoryEntityState/FFactoryBeltFlowState/GetLineItems)
#     feeds a pure render-cost model (render_cost.h) that proves item-render
#     cost collapses O(items)→O(lines) above LOD-0 and draw calls scale with
#     machine-TYPE count (tens via instancing), not entity count — so a slice
#     factory AND a 100k-entity stress factory both fit a per-frame budget.
#     This is RC-8 (rendering "confirmed on paper") validated without a GUI.
#     Header-only; consumes factory_sim.h + render_cost.h read-only.
add_executable(render_cost_tests
  tests/test_main.cpp
  tests/test_render_cost.cpp)
target_link_libraries(render_cost_tests PRIVATE of_core)
target_include_directories(render_cost_tests PRIVATE tests)
add_test(NAME render_cost_tests COMMAND render_cost_tests)

# --- Factory AUTO-LINE (Phase 1): the buildable production-network logic the UE
#     placement layer binds to (automation.h over factory_sim.h). Composes miner
#     (bound to a depletable deposit), belts, inserters, and powered smelter +
#     multi-input assembler machines into a connected line that flows END-TO-END
#     on step() with NO manual feeding: deposit -> miner -> belt -> smelter ->
#     belt -> assembler -> output. Proves end-to-end flow, deposit depletion +
#     miner stop, the multi-input assembler gate, miner-rate exactness, and
#     determinism. Header-only; consumes factory_sim.h + automation.h.
add_executable(automation_tests
  tests/test_main.cpp
  tests/test_automation.cpp)
target_link_libraries(automation_tests PRIVATE of_core)
target_include_directories(automation_tests PRIVATE tests)
add_test(NAME automation_tests COMMAND automation_tests)

add_executable(world_gen_tests
  tests/test_main.cpp
  tests/test_world_gen.cpp)
target_link_libraries(world_gen_tests PRIVATE of_core)
target_include_directories(world_gen_tests PRIVATE tests)
add_test(NAME world_gen_tests COMMAND world_gen_tests)

# --- World-gen deposits (C-1 / WG-11): seeded resource-deposit placement +
#     the mining query surface (FDepositNode / DepositCatalog). Deterministic-
#     from-seed depletable ore nodes snapped to the cubed-sphere surface, with
#     Cinderite found ONLY on Cinder (WG-4 off-world hook). Headless; proves
#     determinism, Cinder-only, on-surface, queries, and extraction/depletion
#     (the seed+diff property). Consumes cubed_sphere.h read-only.
add_executable(deposits_tests
  tests/test_main.cpp
  tests/test_deposits.cpp)
target_link_libraries(deposits_tests PRIVATE of_core)
target_include_directories(deposits_tests PRIVATE tests)
add_test(NAME deposits_tests COMMAND deposits_tests)

# --- World-gen terrain STREAMING + LOD (Wave-1, Spike 1 §3, §4.1–§4.2): the
#     headless terrain-streaming manager the UE renderer binds to for "player on a
#     whole planet" — selectResidentSet (distance-based LOD, deepens toward the
#     observer, balanced <=1-level seam) + TerrainStreamer.updateStreaming
#     (ready/evict events under a per-update generation budget) + crack-free skirts.
#     Headless; proves selection determinism, LOD-deepens, crack-free bit-identical
#     shared edges across a LOD boundary, eviction on recede, budget respected, and
#     the optimized procgen sampler is bit-identical to the original. Consumes
#     cubed_sphere.h read-only (+ adds terrain_stream.h).
add_executable(terrain_stream_tests
  tests/test_main.cpp
  tests/test_terrain_stream.cpp)
target_link_libraries(terrain_stream_tests PRIVATE of_core)
target_include_directories(terrain_stream_tests PRIVATE tests)
add_test(NAME terrain_stream_tests COMMAND terrain_stream_tests)

# --- World-gen BIOMES + terrain design + planet-wide RESOURCES (Wave-3, Spike 1
#     §2 biomes/materials, §4.5 resources): biome.h layers a designed, varied
#     planet on top of the raw heightfield — oceans/plains/hills/mountains/polar
#     (planet) + regolith/highland/crater-floor (moon), each with a per-biome
#     surface material id (feeds terrain_stream chunk + renderer) and per-biome
#     RELIEF modulation (mountains ridge high, plains flatten, ocean basins below
#     datum) layered ADDITIVELY so the pinned crack-free heights are unchanged —
#     plus a planet-WIDE biome-biased resource distribution (ore concentrates in
#     hills/mountains) queryable by cube-quad region. Headless; proves biome
#     determinism, latitude->polar, low-elevation->ocean, relief-varies-by-biome,
#     designed-height shared-edge bit-identity, material-id stability, and
#     resource determinism + plausibility + region query. Consumes
#     cubed_sphere.h + deposits.h read-only (+ adds biome.h).
add_executable(biome_tests
  tests/test_main.cpp
  tests/test_biome.cpp)
target_link_libraries(biome_tests PRIVATE of_core)
target_include_directories(biome_tests PRIVATE tests)
add_test(NAME biome_tests COMMAND biome_tests)

# --- World-gen SURFACE-WALK data layer (Phase-3 character mode): surface_walk.h
#     is the headless math/queries the UE whole-planet PLAYER controller binds to
#     when the player stands / walks ON a body surface (distinct from the orbital
#     vessel path). A SurfaceObserver maps geodetic (lat,lon,heading,eyeHeight) <->
#     a body-frame UniverseCoord, exposes radial UP + centre-pointing GRAVITY, snaps
#     the player onto the DESIGNED terrain (biome.h SampleDesignedTerrainHeight),
#     moves by GREAT-CIRCLE steps, drives a FloatingOrigin rebase as the walker
#     travels (one-shot consumeRebased() event for chunk re-anchor), yields the
#     TerrainStreamer observer that follows the walker, and answers local biome /
#     hardness / nearby-deposit queries. Headless; proves up==radial &
#     gravity-to-centre, great-circle steps, on-designed-surface snap, >=1 rebase +
#     bounded engine pos, stream-observer tracking, and deterministic local queries.
#     Consumes cubed_sphere.h + biome.h + terrain_stream.h + floating_origin.h.
add_executable(surface_walk_tests
  tests/test_main.cpp
  tests/test_surface_walk.cpp)
target_link_libraries(surface_walk_tests PRIVATE of_core)
target_include_directories(surface_walk_tests PRIVATE tests)
add_test(NAME surface_walk_tests COMMAND surface_walk_tests)

# --- World-gen TERRAIN-DEFORMATION layer (Valheim-style digging): terrain_deform.h
#     is the headless edit layer the UE pickaxe + automated-miner + collision pass
#     binds to. A sparse map from a quantized cubed-sphere deform cell -> an
#     accumulated lowering (metres) over the procedural base; deformedHeight =
#     sampleDesignedHeight − edit, clamped to a DEEP bedrock floor (base − maxDig).
#     digBrush carves soft-falloff holes (pickaxe/terraform), drillStep sinks a
#     narrow shaft (automated miner) toward bedrock over many calls, and a
#     quad-overlap query tells the renderer which chunks to re-mesh. Edits are
#     explicit ops (deterministic), the undeformed path is BIT-IDENTICAL to the
#     procedural terrain, and the edit map persists as a compact diff. Headless;
#     proves brush-falloff + max-depth clamp, base bit-identity, drill-to-bedrock,
#     the quad query, persistence round-trip, and op determinism. Consumes
#     cubed_sphere.h + biome.h read-only (+ adds terrain_deform.h).
add_executable(terrain_deform_tests
  tests/test_main.cpp
  tests/test_terrain_deform.cpp)
target_link_libraries(terrain_deform_tests PRIVATE of_core)
target_include_directories(terrain_deform_tests PRIVATE tests)
add_test(NAME terrain_deform_tests COMMAND terrain_deform_tests)

# --- World-gen TRUE VOXEL TUNNELING layer (1 m^3 destruction): voxel_terrain.h is
#     the headless voxel edit layer the UE cube-mesher + dig + voxel-collision pass
#     binds to. It SUPERSEDES the heightfield deform for digging: solidity =
#     procedural-solid (cell centre at/below sampleHeightField's surface) XOR a
#     sparse REMOVED cell set, over a 1 m^3 body-frame Cartesian lattice. dig()
#     carves ARBITRARY cells (incl. horizontally below the surface) so a run of digs
#     makes a real TUNNEL / overhang the heightfield can't; exposedFaces() emits the
#     solid<->air boundary quads for the cube mesher, a region iterator builds voxel
#     collision from the same solid set, and a dirty AABB scopes the re-mesh. Edits
#     are explicit (deterministic), procedural-solid is a pure function of the height
#     field, and the removed set persists as a compact sparse diff. Headless; proves
#     the solidity model, dig membership/count, the TUNNEL/overhang, exposed-face
#     boundaries, the dirty region, persistence round-trip, and determinism.
#     Consumes cubed_sphere.h read-only (+ adds voxel_terrain.h).
add_executable(voxel_terrain_tests
  tests/test_main.cpp
  tests/test_voxel_terrain.cpp)
target_link_libraries(voxel_terrain_tests PRIVATE of_core)
target_include_directories(voxel_terrain_tests PRIVATE tests)
add_test(NAME voxel_terrain_tests COMMAND voxel_terrain_tests)

# --- World-gen SINGLE SURFACE AUTHORITY ("surface oracle", WG-21): surface_field.h
#     is the ONE sanctioned surface API — baseHeight ≡ sampleDesignedHeight (RAW is
#     an internal ingredient only), voxel solidity derived from the SAME base, a
#     voxel-derived far-field lowering (top-anchored open-column depth, the UE
#     OpenColumn logic promoted into core), surfaceHeight = base − lowering with the
#     ONE bedrock clamp, and a SurfaceField binder. Replaces the five competing
#     surface definitions that caused the floating/air-gap experience bugs (RC-A).
#     Headless; proves base≡designed bit-identity, designed-based voxel solidity
#     (the raw/designed gap case), dig-column lowering, the single bedrock clamp,
#     tunnel-produces-no-lowering (ceiling intact), and determinism. Consumes
#     cubed_sphere.h + biome.h + voxel_terrain.h read-only (+ adds surface_field.h).
add_executable(surface_field_tests
  tests/test_main.cpp
  tests/test_surface_field.cpp)
target_link_libraries(surface_field_tests PRIVATE of_core)
target_include_directories(surface_field_tests PRIVATE tests)
add_test(NAME surface_field_tests COMMAND surface_field_tests)

add_executable(physics_tests
  tests/test_main.cpp
  tests/test_physics.cpp)
target_link_libraries(physics_tests PRIVATE of_core)
target_include_directories(physics_tests PRIVATE tests)
add_test(NAME physics_tests COMMAND physics_tests)

# --- Gameplay logic: the player-facing rules over the closed sim substrate ---
add_executable(gameplay_tests
  tests/test_main.cpp
  tests/test_gameplay.cpp)
target_link_libraries(gameplay_tests PRIVATE of_core)
target_include_directories(gameplay_tests PRIVATE tests)
add_test(NAME gameplay_tests COMMAND gameplay_tests)

# --- Survival-crafting slice (WP1): the primitive survival content + mechanics
#     layered on the gameplay/world-gen cores — raw resources harvested from
#     terrestrial nodes (deposits.h §S), hand-crafted tools/structures, and a
#     FUEL-driven Furnace/Smelter (gameplay.h §S). The furnace is a focused
#     gameplay-layer type (a consumable solid-fuel pool, not a power network), so
#     "smelter is faster" is one data parameter. Headless; proves content
#     registration, deterministic test-area layout, tool-assisted-but-not-required
#     hand harvest, all-or-nothing hand-crafting, and fuel-burn smelting (coal >
#     wood per unit, smelter > furnace rate). Consumes gameplay.h + deposits.h.
add_executable(survival_slice_tests
  tests/test_main.cpp
  tests/test_survival_slice.cpp)
target_link_libraries(survival_slice_tests PRIVATE of_core)
target_include_directories(survival_slice_tests PRIVATE tests)
add_test(NAME survival_slice_tests COMMAND survival_slice_tests)

# --- Research / tech tree (Phase 2, GP-1/GP-2): factory-produced science is
#     spent to unlock recipes/entities, with OFF-WORLD gating — a mid/late tech
#     (CinderiteRefining) costs a Cinderite-derived item, so it is unreachable
#     until the player mines Cinder. The progression spine that makes the
#     KSP×Factorio crossover matter. Header-only; consumes gameplay.h verbatim.
add_executable(research_tests
  tests/test_main.cpp
  tests/test_research.cpp)
target_link_libraries(research_tests PRIVATE of_core)
target_include_directories(research_tests PRIVATE tests)
add_test(NAME research_tests COMMAND research_tests)

# --- Headless integration: composes all four cores into the slice-loop logic ---
add_executable(integration_tests
  tests/test_main.cpp
  tests/test_integration.cpp)
target_link_libraries(integration_tests PRIVATE of_core)
target_include_directories(integration_tests PRIVATE tests)
add_test(NAME integration_tests COMMAND integration_tests)

# --- Networking: replication seam (RC-9) — chunk-local determinism + delta-replay
#     client sync over the factory sim. Headless, no sockets: validates that the
#     FFactoryDelta/TickIndex input stream is a sufficient client-sync seam (NW-4).
add_executable(net_replication_tests
  tests/test_main.cpp
  tests/test_net_replication.cpp)
target_link_libraries(net_replication_tests PRIVATE of_core)
target_include_directories(net_replication_tests PRIVATE tests)
add_test(NAME net_replication_tests COMMAND net_replication_tests)

# --- Persistence: seed+diff save/load round-trip over the slice state ---
add_executable(persistence_tests
  tests/test_main.cpp
  tests/test_persistence.cpp)
target_link_libraries(persistence_tests PRIVATE of_core)
target_include_directories(persistence_tests PRIVATE tests)
add_test(NAME persistence_tests COMMAND persistence_tests)

# --- Persistence FILE container: atomic single-slot save FILE on disk (PS-6) ---
#     Layers the write-temp-then-rename atomic commit (persistence_file.h) over
#     the in-memory format above. Uses <filesystem> — link stdc++fs on the older
#     GCC/Clang runtimes that still split it out (a no-op on modern toolchains).
add_executable(persistence_file_tests
  tests/test_main.cpp
  tests/test_persistence_file.cpp)
target_link_libraries(persistence_file_tests PRIVATE of_core)
target_include_directories(persistence_file_tests PRIVATE tests)
if(CMAKE_CXX_COMPILER_ID STREQUAL "GNU" AND CMAKE_CXX_COMPILER_VERSION VERSION_LESS 9.0)
  target_link_libraries(persistence_file_tests PRIVATE stdc++fs)
endif()
add_test(NAME persistence_file_tests COMMAND persistence_file_tests)

# --- End-to-end slice loop (CAPSTONE): composes ALL the domain cores into the
#     complete vertical-slice game loop — mine -> automate -> research -> fly
#     Forge→Cinder -> mine off-world Cinderite -> research the off-world-gated
#     tech -> save the whole played state and reload it -> verify consistency.
#     Proves the cores fit together end-to-end (not just individually). Consumes
#     deposits/gameplay/factory_sim/research/sim_world/persistence read-only.
#     Uses <filesystem> (link stdc++fs on older GCC, a no-op on modern toolchains).
add_executable(slice_e2e_tests
  tests/test_main.cpp
  tests/test_slice_e2e.cpp)
target_link_libraries(slice_e2e_tests PRIVATE of_core)
target_include_directories(slice_e2e_tests PRIVATE tests)
if(CMAKE_CXX_COMPILER_ID STREQUAL "GNU" AND CMAKE_CXX_COMPILER_VERSION VERSION_LESS 9.0)
  target_link_libraries(slice_e2e_tests PRIVATE stdc++fs)
endif()
add_test(NAME slice_e2e_tests COMMAND slice_e2e_tests)

# --- Tools: journey_dump — flies the full Forge→Cinder slice headless and dumps
#     a per-tick CSV (docs/phase1/artifacts/journey.csv) for plotting. A pure
#     CONSUMER of of_core (no test framework, not registered with ctest). ---
add_executable(journey_dump
  tools/journey_dump.cpp)
target_link_libraries(journey_dump PRIVATE of_core)

# --- Tools: render_scale_dump — sweeps factory entity count (1k..200k) through
#     the render-cost model (render_cost.h) and dumps a CSV
#     (docs/phase1/artifacts/render_scale.csv) showing draw calls stay FLAT and
#     item-eval work scales O(lines), while a naive O(items) baseline explodes —
#     the RC-8 "render wall cleared" verdict, made visible. A pure CONSUMER of
#     of_core (no test framework, not registered with ctest). ---
add_executable(render_scale_dump
  tools/render_scale_dump.cpp)
target_link_libraries(render_scale_dump PRIVATE of_core)

# --- Tools: procgen_bench — micro-benchmark for the world-gen procedural hot
#     path (generateQuadMesh sampler). Times the OPTIMIZED cubed_sphere.h noise
#     stack vs a self-contained REFERENCE copy of the ORIGINAL stack in ONE binary,
#     reports verts/sec before->after + speedup, and asserts the two are
#     BIT-IDENTICAL (exit non-zero on any bit mismatch). A pure CONSUMER of of_core
#     (no test framework, not registered with ctest). ---
add_executable(procgen_bench
  tools/procgen_bench.cpp)
target_link_libraries(procgen_bench PRIVATE of_core)

# --- Tools: lod_probe — DW-19 measurement. Sweeps StreamConfig (splitRatio x
#     maxDepth) for a player standing on a plain and on a mountain, and reports
#     the LOD depth and vertex spacing UNDER THE FEET alongside the cost of it
#     (resident chunk count, packed pool bytes, total mesh build time). The
#     number DW-19 has to hit is 2 m or finer at the feet before W5 digging.
#     A pure CONSUMER of of_core (no test framework, not registered with ctest). ---
add_executable(lod_probe
  tools/lod_probe.cpp)
target_link_libraries(lod_probe PRIVATE of_core)

# --- Per-test timeout: every suite finishes in seconds; a generous 120 s cap
#     means a future loader/DLL failure fails FAST instead of stalling ~1000 s
#     in Windows Error Reporting (the historical "hung overnight run" mode). ---
get_property(_of_all_tests DIRECTORY PROPERTY TESTS)
set_tests_properties(${_of_all_tests} PROPERTIES TIMEOUT 120)
