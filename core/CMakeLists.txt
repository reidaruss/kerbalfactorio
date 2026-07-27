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

# --- POLLUTION INTEGRATION (FS-35): the enemies loop driven by a REAL factory
#     (stock-take F2 closure). Machines carry emitters at their own positions;
#     once per pollution window each rate becomes base * duty, where duty is
#     work ACTUALLY done read off the sim's fixed-point counters (machine
#     milliticks, miner accrual, generator fuel energy burned). Proves: the
#     hand-derived steady rates of a drill-belt-smelter-generator scene
#     (6.5999320/s, including the 29999 W truncation chain); field mass against
#     the closed form with decay off and between hand bounds with decay on;
#     brownout scaling emission by the same Q16 factor that slowed the craft
#     while the generator pays the balance; the NEGATIVE CONTROL (an idle
#     factory emits nothing and no wave ever forms, for 15 simulated minutes);
#     a wave dispatched THROUGH the real pipeline targeting the generator that
#     fed the nest; the joined save round-trip (bit-identical hash, stable
#     emitter joins, byte-identical re-serialize); and the joined per-tick cost
#     at 1,200 machines against the enemies-suite baseline.
add_executable(factory_pollution_tests
  tests/test_main.cpp
  tests/test_factory_pollution.cpp)
target_link_libraries(factory_pollution_tests PRIVATE of_core)
target_include_directories(factory_pollution_tests PRIVATE tests)
add_test(NAME factory_pollution_tests COMMAND factory_pollution_tests)

# --- ITEM IDENTITY (FS-37): a machine accepts only items its current recipe
#     consumes, enforced at the inserter's pickup (a refused item stays on its
#     belt / in the source out-slot: visible back-pressure, never destruction)
#     and again at the drop. Pins the player-reported "coal belt into a smelter
#     produces iron" transmutation: counts conserved, identity not. Every
#     scenario drives the REAL pipeline (worldgen node -> placeMinerForNode ->
#     belt -> smelter, wired with the same item-less connect() calls the web
#     wiring layer makes; standing rule 11, no fillSaturated-style fixtures).
#     Includes the negative control (raw iron still smelts), a MIXED coal+iron
#     line whose ledger balances exactly per item type, and a data-driven
#     (machine, item) acceptance sweep over the recipe table.
add_executable(item_identity_tests
  tests/test_main.cpp
  tests/test_item_identity.cpp)
target_link_libraries(item_identity_tests PRIVATE of_core)
target_include_directories(item_identity_tests PRIVATE tests)
add_test(NAME item_identity_tests COMMAND item_identity_tests)

# --- ELECTRICITY (power.h + its automation.h binding): the grid. Generators
#     produce, consumers demand, poles form networks by connectivity, and when
#     demand exceeds supply EVERYTHING on that network slows by the same factor.
#     Every expected value in the suite was hand-computed from the arithmetic
#     before the implementation was run against it. Proves: the satisfaction
#     division against nine hand pairs; network formation and the SPLIT when a
#     bridging pole is removed; that wires are a spanning tree (N-1) and not one
#     per in-reach pair (9 vs 4 in a dense line, 182 vs 29 at 30 poles); that
#     proportional slowdown really is the same factor for every consumer, and
#     where integer truncation makes it only approximately so; the four-smelters-
#     on-one-generator scenario where the fourth smelter adds ZERO output; fuel
#     burn proportional to actual output with energy conserved exactly; that a
#     generator which also consumes cannot collapse its own network (the power
#     analogue of the FS-17 belt deadlock); and determinism.
add_executable(power_tests
  tests/test_main.cpp
  tests/test_power.cpp)
target_link_libraries(power_tests PRIVATE of_core)
target_include_directories(power_tests PRIVATE tests)
add_test(NAME power_tests COMMAND power_tests)

# --- SMELTING LADDER (gameplay.h §S.0): primitive furnace -> coal smelter ->
#     electric smelter, one open table of tiers rather than three models of
#     smelting. Proves the ladder is data, that the fuel rungs and the powered
#     rung produce the SAME ingots at different rates (1800 / 600 / 300 ticks
#     for ten), what each fuel rung costs in wood and coal, and that the new
#     tier reuses the shipped TypeIds rather than minting duplicates.
add_executable(smelting_tiers_tests
  tests/test_main.cpp
  tests/test_smelting_tiers.cpp)
target_link_libraries(smelting_tiers_tests PRIVATE of_core)
target_include_directories(smelting_tiers_tests PRIVATE tests)
add_test(NAME smelting_tiers_tests COMMAND smelting_tiers_tests)

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

# --- World-gen SIGNED DENSITY FIELD + SURFACE NETS (WG-24): voxel_field.h stores
#     a signed distance at lattice CORNERS instead of one occupancy bit per cell,
#     and surface_nets.h extracts its zero level as triangles instead of drawing
#     cell faces. This is the change that makes a dig round, a levelled pad flat
#     to floating point rather than to a cell, and the drawn surface the same
#     surface a body collides with (the DW-26 bound, re-derived).
add_executable(voxel_field_tests
  tests/test_main.cpp
  tests/test_voxel_field.cpp)
target_link_libraries(voxel_field_tests PRIVATE of_core)
target_include_directories(voxel_field_tests PRIVATE tests)
add_test(NAME voxel_field_tests COMMAND voxel_field_tests)

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

# --- VESSEL: the part and vessel data model (DW-29). A vessel is a TREE of
#     parts with stack and radial attachment, grouped into ordered stages;
#     firing a stage severs the tree and hands back the discarded subtree as a
#     vessel in its own right. Covers the authored part catalogue, tree layout
#     against the shipped 1.25 m art stack contract, mass properties, centre of
#     mass and centre of pressure, Tsiolkovsky delta-v per stage pinned to an
#     independently hand-computed number, thrust-to-weight read off
#     BodyParams::muM3S2 (DW-18), and mass conservation across staging.
add_executable(vessel_tests
  tests/test_main.cpp
  tests/test_vessel.cpp)
target_link_libraries(vessel_tests PRIVATE of_core)
target_include_directories(vessel_tests PRIVATE tests)
add_test(NAME vessel_tests COMMAND vessel_tests)

# --- FLIGHT: powered atmospheric and near-body flight (DW-29 / DW-30). The
#     exponential atmosphere and its consequences (drag, thrust and Isp lapse,
#     the space boundary), the DW-30 anti-flip model with its negative control,
#     stability assist limited by the parts actually bolted on, a full ascent
#     from the pad to a stable orbit, and the handoff to of::orbital, which is
#     asserted BIT-EXACT rather than to a tolerance.
add_executable(flight_tests
  tests/test_main.cpp
  tests/test_flight.cpp)
target_link_libraries(flight_tests PRIVATE of_core)
target_include_directories(flight_tests PRIVATE tests)
add_test(NAME flight_tests COMMAND flight_tests)

# --- MANEUVER: maneuver node planning (maneuver.h, PH-37 to PH-40). A node
#     answers four questions and commands nothing: how much delta-v, which way
#     to point, when to start, how long for, plus the orbit that results. The
#     numbers are pinned against a HAND computation done on paper first (the
#     vis-viva speeds at 680 km and the transfer periapsis, and Tsiolkovsky
#     inverted for the burn time), and the last test FLIES the burn the node
#     describes through FlightSim and compares the orbit reached against the
#     orbit predicted, because a node that predicts an orbit you cannot fly to
#     is worse than no node.
add_executable(maneuver_tests
  tests/test_main.cpp
  tests/test_maneuver.cpp)
target_link_libraries(maneuver_tests PRIVATE of_core)
target_include_directories(maneuver_tests PRIVATE tests)
add_test(NAME maneuver_tests COMMAND maneuver_tests)

# --- ENEMIES: the pollution / evolution / nest-attack feedback loop (W11 lane
#     E). enemies.h is the Factorio-inspired base-defense loop as a SIMULATION
#     rather than a wave timer: machines emit pollution into a coarse sparse
#     grid over the surface, the grid diffuses and decays, nests absorb what
#     reaches them and grow an attack budget in proportion, absorbed pollution
#     plus elapsed time plus nests destroyed raise a saturating evolution factor
#     that gates the enemy roster, and waves are dispatched AT the emitter that
#     actually fed the nest. Nests also expand toward the pollution, so cleared
#     ground does not stay cleared.
#
#     What this suite proves, and why each one is here:
#       * diffusion pinned to HAND-COMPUTED values at distance 0/1/2/diagonal,
#         so the scheme is fixed to independently derived arithmetic rather than
#         to a previous run of itself;
#       * mass conservation to a closed form, including ACROSS a cube-face seam,
#         which is where a naive neighbour table silently reflects;
#       * evolution isolated input by input (hold two at zero, vary the third),
#         monotone, bounded below 1, and decomposed BIT-EXACTLY into its three
#         terms so a UI's breakdown is a decomposition and not an estimate;
#       * THE NEGATIVE CONTROL: nests with no pollution dispatch nothing over
#         thirty simulated minutes while evolution provably rises from its time
#         term (DW-20), which is what separates this from a wave timer wearing a
#         pollution costume; plus its complement, that switching the factory off
#         stops the attacks;
#       * targeting: the wave goes to the emitter that FED the nest, checked
#         against a nearest-emitter heuristic that would answer differently;
#       * determinism (standing rule 4) and a save/load that resumes bit-exactly;
#       * cost measured at 1,200 machines (the DW-28 render limit), with the
#         O(cells)-not-O(machines) claim tested by doubling the machine count.
#     Header-only; consumes cubed_sphere.h read-only (+ persistence.h in the
#     test only, for the byte cursor). Does NOT touch factory_sim.h, the voxel
#     layer or the surface oracle.
add_executable(enemies_tests
  tests/test_main.cpp
  tests/test_enemies.cpp)
target_link_libraries(enemies_tests PRIVATE of_core)
target_include_directories(enemies_tests PRIVATE tests)
add_test(NAME enemies_tests COMMAND enemies_tests)

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
  tests/test_research.cpp
  # §D, the SURVIVAL tech tree: the one the playable web client gates on. Its
  # own translation unit on the same target because several lanes edit these
  # files in one night and a second simultaneous editor of one file is how
  # commits start sweeping each other (the GP-41 argument, applied to a test).
  tests/test_research_survival.cpp)
target_link_libraries(research_tests PRIVATE of_core)
target_include_directories(research_tests PRIVATE tests)
add_test(NAME research_tests COMMAND research_tests)

# --- Player progression (W11 lane C / GP-41 to GP-43): the four armour slots
#     the art lane shipped meshes for and the headless cores had no referent
#     for, five practised skills whose level 0 is EXACTLY neutral so the layer
#     is optional for every existing caller, and a five-byte palette-indexed
#     appearance. Header-only; consumes gameplay.h verbatim, exactly as
#     research.h does, and is a SEPARATE header because gameplay.h already has
#     three lanes editing it.
add_executable(progression_tests
  tests/test_main.cpp
  tests/test_progression.cpp)
target_link_libraries(progression_tests PRIVATE of_core)
target_include_directories(progression_tests PRIVATE tests)
add_test(NAME progression_tests COMMAND progression_tests)

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

# --- Tools: terrain_probe — world-gen DIAGNOSTIC. Measures WHERE the height
#     field has detail: patch min/max/mean at the start point and at the nearest
#     mountain, the |dh| slope spectrum at 2 m / 10 m / 100 m / 1 km spacing, an
#     RMS-vs-spacing sweep from 1 m to 10 km (a constant RMS/spacing ratio proves
#     there is NO content below that scale), the planetary relief histogram by
#     biome, measured valueNoise calls per sample + verts/sec, and the home
#     flat-pad flatness / blend-slope / bit-identity radius. A pure CONSUMER of
#     of_core (no test framework, not registered with ctest). ---
add_executable(terrain_probe
  tools/terrain_probe.cpp)
target_link_libraries(terrain_probe PRIVATE of_core)

# --- Tools: spawn_probe: world-gen DIAGNOSTIC. Searches the WHOLE planet for
#     the best player spawn site and reports it with numbers: local slope from
#     rings at 4 m and 20 m, the worst height step between samples 4 m apart (the
#     DW-32 module), min/max/mean relief in a 6 km box with the site's height
#     against that mean (a valley FLOOR sits below it, a plateau does not), and
#     the highest ground plus nearest Mountains sample within 8 km. Coarse global
#     sweep -> regional refine -> fine flat-spot search. Samples
#     designedHeightNoPad so the existing home pad cannot contaminate a result.
#     A pure CONSUMER of of_core (no test framework, not registered with ctest). ---
add_executable(spawn_probe
  tools/spawn_probe.cpp)
target_link_libraries(spawn_probe PRIVATE of_core)

# --- Per-test timeout: every suite finishes in seconds; a generous 120 s cap
#     means a future loader/DLL failure fails FAST instead of stalling ~1000 s
#     in Windows Error Reporting (the historical "hung overnight run" mode). ---
get_property(_of_all_tests DIRECTORY PROPERTY TESTS)
set_tests_properties(${_of_all_tests} PROPERTIES TIMEOUT 120)
