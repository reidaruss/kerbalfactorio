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
