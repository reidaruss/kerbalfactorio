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

add_executable(world_gen_tests
  tests/test_main.cpp
  tests/test_world_gen.cpp)
target_link_libraries(world_gen_tests PRIVATE of_core)
target_include_directories(world_gen_tests PRIVATE tests)
add_test(NAME world_gen_tests COMMAND world_gen_tests)

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

# --- Tools: journey_dump — flies the full Forge→Cinder slice headless and dumps
#     a per-tick CSV (docs/phase1/artifacts/journey.csv) for plotting. A pure
#     CONSUMER of of_core (no test framework, not registered with ctest). ---
add_executable(journey_dump
  tools/journey_dump.cpp)
target_link_libraries(journey_dump PRIVATE of_core)
