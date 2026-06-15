# Orbital Foundry (working title)

A 3D crossover of **Kerbal Space Program** (seamless physics flight, orbital mechanics) and **Factorio** (factory automation, power, research) — with procedural worlds, exploration, and multiplayer. Continuously traversable surface → orbit → another world, no loading screens.

## Repo layout
- `docs/` — all design. Start at [`CLAUDE.md`](CLAUDE.md) → [`docs/MASTER_PLAN.md`](docs/MASTER_PLAN.md). Includes the agentic dev architecture, per-domain controller contexts, the Phase-0 spikes, the Phase-1 slice plan, and the execution plan.
- `core/` — headless C++ **Wave-0 cores** + tests, *no engine dependency*. These retire the hard technical claims (planetary-scale precision, crack-free terrain, orbital propagation, 100k-entity throughput) before any UE5 investment.
- `ue/` — the Unreal Engine 5 project (added later, once the cores pass).

## Build & test the headless cores
```
cmake -S core -B core/build -G Ninja -DCMAKE_CXX_COMPILER=g++
cmake --build core/build
core/build/core_engine_tests.exe
```
Requires CMake, Ninja, and a C++17 compiler (g++/MinGW or MSVC).

## Status
Phase-0 (de-risking) and Phase-1 (vertical-slice design) are complete; the build is underway, starting with the Wave-0 cores. The current target is the **"First Foundry"** slice: one planet + one moon, node mining, a basic automated factory + power, and manual flight surface → orbit → land.

## How it's built
Developed via an **agentic controller architecture** — an Admin controller delegates to nine domain controllers (engine, rendering, physics, world-gen, factory, networking, gameplay, persistence, build-tooling), each with its own context file and runnable agent. See [`docs/AGENT_ARCHITECTURE.md`](docs/AGENT_ARCHITECTURE.md).
