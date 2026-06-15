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

# --- Persistence: seed+diff save/load round-trip over the slice state ---
add_executable(persistence_tests
  tests/test_main.cpp
  tests/test_persistence.cpp)
target_link_libraries(persistence_tests PRIVATE of_core)
target_include_directories(persistence_tests PRIVATE tests)
add_test(NAME persistence_tests COMMAND persistence_tests)
