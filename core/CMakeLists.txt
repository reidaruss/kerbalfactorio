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
