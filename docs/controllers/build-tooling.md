# Build, Tooling & Test Infrastructure — Master Controller Context

> **Domain owner:** `build-tooling-controller` · **Reports to:** Admin · **Phase:** build · **Status:** Both builds GREEN · headless harness (g++/CMake/Ninja, **21 suites, 21/21 green, shell-independent** since BT-8) + UE 5.7 project (MSVC 14.44) · asset pipeline **46/46 green, zero-byte rebuild diff** (BT-9) · repo history rewritten onto **git LFS** (BT-7); **no remote yet, adding one is the next repo task** · **Last updated:** 2026-07-26
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
| BT-7 | **Repo surgery (RETHINK R3): one-time history rewrite onto git LFS, done PRE-remote.** `git lfs migrate import --include="*.uasset,*.umap,*.png,*.jpg,*.zip,*.fbx,*.exr,*.wav" --everything` over all 96 commits; 10 vendor demo maps (+BuiltData) untracked and gitignored first; the 3 unwired Fab packs (B3D, Megaplant_Library, WaterMaterials) gitignored; reflog expired + `gc --aggressive --prune=now`. Result: 1,060 LFS objects; git object store 2.43 GiB loose / 0 packs → **1.14 MiB packed** (binaries live in `.git/lfs`, ~2.7 GB). Rollback bundle: `C:\Users\reida\of-backup-pre-lfs-2026-06-16.bundle` (2.47 GB, verified). **No remote exists yet; adding one (LFS-capable host) is the next repo task, and is now safe.** All pre-rewrite hashes are dead; do not cite them. | 2.55 GB of binary blobs in plain git history could never be pushed to a normal host (GitHub 100 MB/file cap); rewrite was cheap only while no remote/collaborators existed. Reid approved the one-time rewrite. | **Done** | 2026-07-05 |
| BT-9 | **Base-building art set: one MODULE, owned in one file.** `tools/blender/structure_common.py` holds `CELL 1.00`, `DECK_H 0.50`, `WALL_H 2.50`, `WALL_T 0.25`, `STOREY 3.00` and asserts `DECK_H + WALL_H == STOREY` at import; the four build scripts (`build_foundation/floor/wall/door.py`) import it and declare nothing dimensional of their own. Two anchors, published as sockets rather than as constants a caller re-derives: a **deck** snaps to a cell CENTRE, a **wall** to a cell EDGE MIDPOINT and straddles it. `floor.glb` IS the ceiling (same part, placed at `y = 3(N+1)`); there is no `ceiling.glb`. Door collision is **three** proxies, not one, because a convex hull of a doorway is a sealed wall. Verified: 46/46 `validate_glb.py` green, full 46-script rebuild byte-identical, tiling measured off the shipped GLBs (collinear gap `+0.000000000 m`, storey pitch 3.000 exact). New tool `render_structures.py` assembles the shipped files into a room, because every part passes in isolation and the interesting failure is BETWEEN parts. | Reid asked for free-place/grid-snap base building; the art half had to land before the placement lane could start. Building four assets independently would have left the storey pitch unowned, which is exactly how a tiling set drifts. | **Done** (art only; **no sim referent exists**, see risk R4) | 2026-07-26 |
| BT-8 | **Static-link the GNU runtime in all headless test/tool exes** (`add_link_options(-static-libstdc++ -static-libgcc -static)` for MinGW in `core/CMakeLists.txt`) **+ ctest `TIMEOUT 120` on all 21 suites.** | Exes dynamically linked `libstdc++-6.dll`; Git for Windows ships an older DLL on the system PATH missing the `<filesystem>` symbols, so the two `<filesystem>` suites died at load (0xc0000139) or passed depending on the shell, and each loader death stalled ~1000 s in WER (the "hung overnight run"). Root cause proven in [core-docs-audit Task A](../review-2026-06-16/core-docs-audit.md). Verified after fix: fresh configure+build, **21/21 green from plain PowerShell AND Git Bash**, no PATH setup needed. | **Done** | 2026-07-05 |

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
- [Done 2026-07-26] Tier-0 base-building art set (BT-9). The **placement, grid-snap and ghost-preview code is another lane's**; this domain shipped the meshes, the module constants and the socket interface it codes against (ASSET-SPECS 4.23).
- [Later] Asset pipeline/cooking; perf-capture tooling for the render-wall + perf-budget gates.
- [Next repo task] **Add a remote** (LFS-capable host) and push; safe now that BT-7 landed. Until then the only off-machine copy is the BT-7 bundle.
- [Deferred] Wire or delete the three gitignored Fab packs (B3D ~71 MB, WaterMaterials ~88 MB, Megaplant_Library ~694 MB skeletal-only); remove from `.gitignore` when wired.

## 7. Open questions & risks
- **R1:** does the user's machine have the VS2022/MSVC + UE5 toolchain installed? (Verify before the build greenlight.)
- **R2:** sharing C++ code between a headless lib and a UE module cleanly (UE's build system vs plain CMake) — keep cores as engine-agnostic libs.
- **R3:** Nextcloud + git in the same folder can fight (sync vs `.git`); confirm the repo location/ignore rules.
- **R4 (opened 2026-07-26, BT-9):** the four structural parts are the first Tier-0 assets with **no referent in the headless headers**. `automation.h`'s `BuildKind` has no `Foundation`/`Wall`/`Floor`/`Door`, `gameplay.h` has no structural items, and there are no `TypeId`s. The meshes ship and validate, but nothing can place one until **factory-sim** adds the `BuildKind` values and `TypeId`s and **gameplay** adds item ids and recipes. Also unanswered and not an art call: does a foundation deform terrain (world-gen/physics voxel interaction) or merely rest on it? Art has published geometry and anchors only. Escalated to Admin.

## 8. Subagent delegation log
| Date | Subagent task | Status | Outcome |
|------|---------------|--------|---------|
| 2026-07-05 | RETHINK R3: repo surgery (LFS history rewrite, vendor-map untrack, bundle backup) + test-env static-link fix (BT-7/BT-8) | Done | 1,060 LFS objects, git store 2.43 GiB → 1.14 MiB; 21/21 ctest green from PowerShell and Git Bash |
| 2026-07-26 | Tier-0 base-building art set (BT-9). **Not delegated**, deliberately: the four parts are one geometric contract, not four scoped tasks, and splitting them across subagents is precisely how a tiling set ends up with four opinions about the storey pitch. Handled in-controller. | Done | 4 GLBs, 59.3 KB, dist 2.43 → 2.48 MB; 46/46 validator green; 46-script rebuild byte-identical; 4 assembled renders under `docs/screenshots/structures_*.png` |

## 9. References
[EXECUTION-PLAN](../EXECUTION-PLAN.md) (§2–4, §8), [REVIEW-2026-06-14](../REVIEW-2026-06-14.md) (Q7 finding). The spike gate lists (V/WV/RV/G-series) across docs/spikes/.
