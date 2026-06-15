# Build, Tooling & Test Infrastructure — Master Controller Context

> **Domain owner:** `build-tooling-controller` · **Reports to:** Admin · **Phase:** build · **Status:** Both builds GREEN — headless harness (g++/CMake/Ninja, 7 suites) + UE 5.7 project (MSVC 14.44) · **Last updated:** 2026-06-15
> Read alongside: [MASTER_PLAN](../MASTER_PLAN.md) · [AGENT_ARCHITECTURE](../AGENT_ARCHITECTURE.md) · [ADMIN](ADMIN.md) · **[EXECUTION-PLAN](../EXECUTION-PLAN.md)** (the plan that created this domain)
> Created 2026-06-14 to own the execution layer the [review](../REVIEW-2026-06-14.md) found unowned (Q7).

## 1. Mission
Make the project buildable, testable, and reproducible. Own version control, the toolchain, the headless test harness that the entire "prove it Wave-0 first" thesis depends on, CI, and the asset pipeline. If a domain can't build or test its core, that's this controller's problem.

## 2. Scope & owned subsystems
- **Version control** — git repo, `.gitignore` (UE5 + build artifacts), branch/commit conventions, Git LFS for binary assets.
- **Toolchain** — UE5 version pinning, Visual Studio 2022 / MSVC, project generation, dependency management.
- **Headless test harness** — the standalone C++ test project (no UE5 dependency) + framework (Catch2/GoogleTest) for the Wave-0 pure-CPU cores; the bench harness for the 100k @ 60 UPS claim.
- **CI** — automated headless tests per commit; later, UE5 build CI.
- **Asset pipeline** — placeholder-art workflow for the slice; LFS + import conventions; cooking/packaging later.
- **Non-goals:** the gameplay/sim code itself (each domain owns its code + its tests); art *content* (Reid's hiring/asset call); the design (the controllers).

## 3. Key design decisions
| # | Decision | Rationale | Status | Date |
|---|----------|-----------|--------|------|
| BT-1 | Standalone **headless C++ test harness** built BEFORE the UE5 project | Wave-0 cores are engine-independent; retire the biggest claims cheaply first | **Accepted** — dependency-free harness; 7 suites green under g++/CMake/Ninja | 2026-06-14 |
| BT-2 | **git from day one** | docs+code were un-versioned (real risk) | **Accepted** — `git init` done; 8 commits on `main`; `.gitignore`/`.gitattributes` set (Git LFS deferred until binary assets exist) | 2026-06-14 |
| BT-3 | **UE 5.7** + VS2022/MSVC on Windows | Mirrors D-001; LWC is load-bearing | **Accepted** — UE 5.7.4 at `D:\UnrealEngine\UE_5.7`; editor target builds green | 2026-06-15 |
| BT-4 | **UE 5.7 Windows build prerequisites** — install via the **"Game development with C++" workload** to get them all: MSVC **≥14.44.35207** (UBT **BANS 14.40–14.43**); **Windows 11 SDK 10.0.22621**; **.NET Framework SDK 4.6.2+** (SwarmInterface needs the NetFxSDK). VS **17.13**'s channel offered only banned toolchains → had to update VS to **17.14** first. | The first UE build hit each of these one at a time; documenting so it is never re-debugged | **Accepted** | 2026-06-15 |
| BT-5 | **Install VS components via the GUI (self-elevating), NOT CLI `setup.exe modify --quiet`** | `--quiet` refuses to self-elevate from a non-elevated shell (exit **5007**, no UAC); `--wait` is also rejected by this installer version (exit 87) | **Accepted** | 2026-06-15 |
| BT-6 | **UE build command (reproducible):** `D:\UnrealEngine\UE_5.7\Engine\Build\BatchFiles\Build.bat OrbitalFoundryEditor Win64 Development -Project="<repo>\ue\OrbitalFoundry.uproject" -WaitMutex` | The headless cores build separately via `cmake -S core -B core/build -G Ninja -DCMAKE_CXX_COMPILER=g++` | **Accepted** | 2026-06-15 |

## 4. Architecture & approach
- **Two build targets:** (1) the **headless core lib + tests** — pure C++, CMake or minimal MSVC solution, no UE; each domain's Wave-0 core compiles here and is unit/bench-tested. (2) the **UE5 project** — created after the headless cores pass, links the core libs.
- **Gates → tests:** translate the spike gate lists (V/WV/RV/G-series) into automated tests; headless gates run in CI, in-engine gates run manually post-M2.1 (EXECUTION-PLAN §4).
- **Repo layout (proposed):** `/docs` (design), `/core` (headless libs + tests), `/ue` (the UE5 project), `/tools` (scripts/CI). Single repo, LFS for `/ue` binaries.

## 5. Interfaces & dependencies
**Depends on (inbound):** Reid's go-ahead to init git + install the toolchain; each domain's Wave-0 core source (they write it, this harness builds/tests it).
**Provides to (outbound):** a working build + test + CI environment for every domain; the headless harness API (how a domain registers its core's tests/benches); the repo + LFS.
**Cross-cutting:** like networking, this touches every domain — but as *infrastructure they build on*, not sim they depend on.

## 6. Task backlog / roadmap
- [Step 0] `git init` + `.gitignore` + LFS + first commit of `/docs` (BT-2 — **needs Reid's go-ahead**).
- [Pre-build] Stand up the headless C++ test harness skeleton (BT-1); pick the test framework; CI wiring.
- [Wave 0] Build/test the four headless cores with the domains: core-engine coord/rebase, world-gen crack-free terrain, physics Kepler+integrator, factory-sim 100k bench.
- [M2.1+] Scaffold the UE5 project; link cores; set up UE build CI + packaging.
- [Later] Asset pipeline/cooking; perf-capture tooling for the render-wall + perf-budget gates.

## 7. Open questions & risks
- **R1:** does the user's machine have the VS2022/MSVC + UE5 toolchain installed? (Verify before the build greenlight.)
- **R2:** sharing C++ code between a headless lib and a UE module cleanly (UE's build system vs plain CMake) — keep cores as engine-agnostic libs.
- **R3:** Nextcloud + git in the same folder can fight (sync vs `.git`); confirm the repo location/ignore rules.

## 8. Subagent delegation log
| Date | Subagent task | Status | Outcome |
|------|---------------|--------|---------|
| — | *(none yet — idle until build greenlit)* | — | — |

## 9. References
[EXECUTION-PLAN](../EXECUTION-PLAN.md) (§2–4, §8), [REVIEW-2026-06-14](../REVIEW-2026-06-14.md) (Q7 finding). The spike gate lists (V/WV/RV/G-series) across docs/spikes/.
