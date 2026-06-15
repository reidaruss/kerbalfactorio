# Execution Plan — From Design-Complete to Building (Admin)

> **Owner:** Admin Master Controller · **Status:** Active · **Last updated:** 2026-06-14
> Addresses the unowned "execution layer" the [2026-06-14 review](REVIEW-2026-06-14.md) flagged (Q7–Q10). The *design* is complete and now internally consistent (C-1…C-9 closed + propagated). This plan is the bridge from design to a running build.

---

## 1. Where we are
- Phase 0 (3 spikes) + Phase 1 (slice design) complete; **C-1…C-9 closed and propagated** (cleanup 2026-06-14 — docs are now internally consistent, verified by grep).
- Engine verdict D-001 (UE5) holds; the biggest risks are contained (PH-4 hybrid physics) or benchmarkable headless (100k factory).
- **What's missing is not design — it's the execution layer.** That's this doc.

## 2. Step 0 — Version control (do this first)
**The project is NOT under version control** (environment reports "Is a git repository: false"). ~20 design docs + the entire architecture live as un-versioned files in a Nextcloud sync folder — a real risk (a sync conflict or stray delete loses everything; there's no history of the decisions).
- **Action:** `git init` + a UE5/build `.gitignore` + a first commit of the docs. The UE5 project later lives in the same repo.
- *Per Reid's standing rule I won't commit without a go-ahead — say the word and I'll init + make the first commit. This is the single cheapest risk-reducer available right now.*

## 3. Toolchain & environment (Q7 → owned by the new build-tooling controller)
- **Engine:** UE5, latest stable (5.4/5.5). Large World Coordinates is the load-bearing feature (D-001) — confirm it's the LWC-enabled build.
- **Compiler/IDE:** Visual Studio 2022 + MSVC (Windows; UE5's native toolchain).
- **The headless test harness — the linchpin.** The whole "prove it Wave-0 headless first" thesis depends on a **standalone C++ test project** (CMake or a minimal MSVC solution + Catch2/GoogleTest) that has **no UE5 dependency**. Built FIRST — it retires the biggest claims (crack-free terrain, Kepler propagation, 100k throughput, rebase precision) for the price of a C++ toolchain, before any engine investment.
- **CI:** GitHub Actions (or local pre-commit) runs the headless tests on every commit. UE5-build CI is heavier — defer until the UE project exists.

## 4. Test / validation strategy
The spikes already define explicit gate lists — these become real tests, not prose:
- **Headless (Wave-0) gates → automated unit/bench tests in the harness:** core-engine rebase/precision (V3), world-gen crack-free determinism (WV1–WV3), physics Kepler accuracy + no-drift (G-series), factory-sim 100k @ 60 UPS (G1). These run with no engine.
- **In-engine gates → validated after M2.1 in UE5:** seamless visual (RV-series), Chaos-at-speed / no-kraken (V4/G8), Mass Entity throughput (factory G8), scaled↔near cross-fade (RV3/RV8).
- **Owner split:** build-tooling owns the harness + CI; each domain writes its own tests against its core.

## 5. Unowned production gaps (Q8)
| Gap | Phase-1 impact | Recommendation |
|-----|----------------|----------------|
| **Audio** | None (slice can ship silent) | Defer to a future audio controller; tracked, not a blocker |
| **Art / asset pipeline** | Slice uses placeholder art → no blocker; but binary assets need **Git LFS** + a pipeline | build-tooling owns LFS/pipeline setup; art *content* is a later hire/contractor/asset-store call (Reid's) |
| **Global perf budget + target hardware** | The render-wall (Q6) and 100k (G1) gates need a concrete bar | Set a target (e.g. **1080p / 60 fps on a mid-range 2023 GPU**); rendering + Admin own the budget — needs Reid's target-hardware call |

## 6. Networking validation (Q10)
RC-9 (is `FFactoryDelta`/`TickIndex` a sufficient replication seam?) is deferred to Phase 3 with zero consumer-side validation, so the "replication-friendly" claims across factory-sim/physics are unaudited. **Cheap de-risk:** a short **networking paper-spike now** — does the factory delta stream + local chunk-determinism actually support client-sim + reconciliation, and what's the bandwidth/AOI shape? Not a Phase-1 blocker, but it removes a standing assumption before it's load-bearing.

## 7. Schedule / scope / headcount — the honest reality check (Q9 → needs Reid's input)
The biggest strategic unknown, and it's yours to set. Honest framing:
- **The full vision** (all of KSP + all of Factorio + seamless traversal + deformable terrain + multiplayer) is a *multi-studio, many-year* undertaking. Keep it as a **north star, not a plan.**
- **The Phase-1 slice** ("First Foundry") is genuinely achievable and is the right near-term target. The plan's ruthless scope discipline (D-005 + the OUT lists) is exactly what makes it tractable.
- **Rough effort by resourcing (very approximate, calibrate after you tell me):**
  - *Solo, hobby hours:* the slice is a multi-year journey; the **Wave-0 headless cores are achievable in months** and give real, motivating proof.
  - *Solo, full-time / experienced:* a rough playable slice in ~**12–24 months** leveraging UE5 + asset store.
  - *Small team (2–4):* slice in ~**6–12 months**; full v1 (Phases 1–5) is then a multi-year roadmap.
- **What I need from you to calibrate:** solo or team? hobby hours or full-time? That one answer turns the M2.1–M2.5 spine into a dated, effort-estimated roadmap instead of a sequence.

## 8. Recommended immediate path (lowest risk, NO UE5 required)
1. **`git init` + first commit** — protect the work (your go-ahead).
2. **Stand up the headless C++ test harness** (build-tooling controller).
3. **Build + test the four Wave-0 cores** — coord/rebase math (core-engine), crack-free terrain (world-gen), Kepler propagation + integrator (physics), 100k benchmark (factory-sim). These retire the biggest claims with runnable code, need only a C++ toolchain, and prove the thesis before any UE5 spend.
4. **Then** scaffold the UE5 project and build M2.1 (seamless world).

## 9. New & updated ownership
- **build-tooling controller (NEW — this plan):** owns version control, toolchain, the headless test harness, CI, and the asset pipeline/LFS. **Resolves Q7.** Context: [controllers/build-tooling.md](controllers/build-tooling.md).
- **Q8** audio/art → deferred owners (tracked above); perf budget → rendering + Admin, needs Reid's HW target.
- **Q9** schedule → Reid's resourcing call (above).
- **Q10** networking → networking controller, a paper-spike before Phase 3.

## 10. Status
Design-complete + internally consistent + execution layer now planned and (for Q7) owned. **The next concrete action is Step 0 (git) + the headless harness — neither needs UE5.** Everything is staged; what gates progress now is (a) your go-ahead to start building and (b) your Q9 resourcing answer to date the roadmap.
