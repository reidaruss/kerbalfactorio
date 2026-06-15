# Admin Master Controller — Context

> **Domain owner:** Admin (Tier 0) · **Last updated:** 2026-06-14
> Read alongside: [MASTER_PLAN](../MASTER_PLAN.md) · [AGENT_ARCHITECTURE](../AGENT_ARCHITECTURE.md)
> This is the live nerve-center. It tracks *who is doing what*, cross-domain decisions, and integration. It does **not** hold domain implementation detail — that lives in each controller file.

---

## 1. Mission
Own the global plan, the cross-domain interfaces, the dependency graph, and integration. Delegate fully-briefed high-level tasks to Domain Master Controllers; arbitrate interface disagreements; keep [MASTER_PLAN](../MASTER_PLAN.md) coherent. **Do not** absorb domain detail — delegate it.

## 2. Current project phase
**Phase 1 — PLANNED** (2026-06-14). Phase 0 complete: 3 spikes designed + interface surface closed (D-001/UE5 holds — see [PHASE0-SUMMARY](../spikes/PHASE0-SUMMARY.md)). Phase-1 blueprint authored: **[PHASE1-PLAN.md](../phase1/PHASE1-PLAN.md)** — the playable slice *"First Foundry"* (walk → automate → fly Forge→orbit→Cinder → mine an off-world resource → save/reload), the **M2.1–M2.5 integration spine**, scope guardrails, and 6 Phase-1 decisions (P1-D1…D6). The two net-new domains delivered their first design pass: gameplay ([gameplay-phase1.md](../phase1/gameplay-phase1.md)) + persistence ([persistence-phase1.md](../phase1/persistence-phase1.md)). **All 8 domains now have a Phase-1 design.** Phase-1 contract surface **C-1…C-9 ALL CLOSED** (reconciliation round 2026-06-14 — [PHASE1-PLAN §10](../phase1/PHASE1-PLAN.md#10-phase-1-cross-domain-contract-register-surfaced-by-wave-1-design-confirm-in-wave-2)): schemas pinned (`FDepositNode`/`FRecipeDef`/`FEntityDef`/`ItemId`), intents + `IPersistable` confirmed, C-7 quiesce handle defined, **C-8 `RegionDepth` locked Forge=9/Cinder=8** (Admin reconcile of factory-sim's ~1 km chunk). **Phase-1 *design* is COMPLETE; C-1…C-9 closed.** An independent review ([REVIEW-2026-06-14](../REVIEW-2026-06-14.md)) flagged: C-8 not propagated (BLOCKER), `DepositTypeId` stale (SHOULD-FIX), and an unowned execution layer. **All addressed 2026-06-14:** (1) propagation/scrub cleanup DONE — C-8 locked value (Forge=9/Cinder=8) propagated to all owning files + `DepositTypeId` scrubbed; docs now internally consistent (grep-verified). (2) [EXECUTION-PLAN](../EXECUTION-PLAN.md) authored — toolchain/CI/headless-harness/perf-budget/schedule. (3) **build-tooling controller created** (9th domain) to own Q7. **State: design-complete, internally consistent, execution-planned.**

**BUILD STARTED 2026-06-14** (Reid: *"git init and start building, iterate until MVP"* — resourcing handled by the agent studio, no schedule needed). Progress:
- **git repo initialized** (`main`, commit `7fd1e6f`); headless C++ harness live (g++/CMake/Ninja installed and working); `.gitattributes`/`.gitignore` set.
- **core-engine Wave-0 core BUILT + GREEN ✓** — `UniverseCoord` / `FloatingOrigin` / `FrameGraph` / `SimClock` in `core/include/of/`; 5 gate tests / 28 checks, 0 failures. **The #1 project risk is now retired on real hardware:** 64-bit authority + floating origin preserves sub-metre precision at 1,000,000 km (naive float32 loses it).
- **factory-sim Wave-0 core BUILT + GREEN ✓** — SoA belt/factory sim (transport-line belts, inserters, machines, power graph w/ brownout); **100,000 entities @ ~535 UPS measured** (8.9× over the 60 UPS bar — gate G1 retired, bandwidth-bound as predicted); belt transport, update-on-demand, and brownout all tested. (FS-11)
- **Next:** world-gen crack-free terrain core → physics conics+integrator core → then the UE5 project (M2.1).

## 3. Controller status dashboard
| # | Controller | Phase | Status | Owner of | Blocking / blocked by |
|---|---|---|---|---|---|
| 1 | core-engine | 1 | **Wave-0 core BUILT + GREEN ✓** | coords, floating origin, frames, active/on-rails, tick | `core/include/of/` compiled+tested (g++); the substrate other cores build on |
| 2 | rendering | 0 | **Spike 1 designed ✓ (ready to build)** | scaled space, LOD, instancing, shaders | Consumed Wave-1 contracts OK; RN-5 added; flagged RC-2 (Mie) |
| 3 | physics | 0 | **Spike 2 designed ✓** | patched conics, rigid bodies, collision | RC-4 resolved → PH-4 hybrid integrator; provides `FVesselOrbitalState`; owns RC-11 (solar) |
| 4 | world-gen | 0 | **Spike 1 designed ✓ (ready to build)** | planet gen, deposits, POIs, voxel patches | Contracts pinned; owns RC-2 (add Mie fields) + RC-3 (collision-mesh negotiation) |
| 5 | factory-sim | 1 | **Wave-0 core BUILT + GREEN ✓** | belts, machines, power, on-rails factory | 100k @ **535 UPS** measured (8.9× headroom — G1 retired); SoA sim + brownout + update-on-demand tested |
| 6 | networking | 0 | Scoping | server authority, AOI, replication, prediction | Cross-cutting; constrains all from day one |
| 7 | gameplay | 1 | **Phase-1 designed ✓** | research, quests, loot, UI | Slice designed (GP-6…14); C-1/2/3/5 closed; research tree = Phase 2 |
| 8 | persistence | 1 | **Phase-1 designed ✓** | seed+diff, streaming, serialization | Slice save/load designed (PS-5…8); C-6/7/8 closed (RegionDepth 9/8) |
| 9 | build-tooling | build | **Harness LIVE ✓** | git, toolchain, headless harness, CI, assets | git + CMake/Ninja/g++ harness up; core-engine core green; CI wiring = next |

## 4. Dependency graph (quick reference)
```
core-engine ─┬─▶ everyone (coords, frames, tick, active/on-rails)
world-gen  ──┼─▶ rendering, physics, factory-sim, gameplay, persistence
physics  ────┼─▶ rendering           (depends on core-engine, world-gen)
factory-sim ─┼─▶ rendering, persistence, gameplay (depends on core-engine, world-gen)
rendering  ──┘   (depends on core-engine, world-gen, physics, factory-sim)
gameplay  ───▶ (depends on factory-sim, world-gen, persistence)
persistence ─▶ (depends on world-gen, factory-sim, gameplay)
networking ──▶ CROSS-CUTTING — wraps all sim; server-authoritative constraint on all
```
Full version: [MASTER_PLAN §5.3](../MASTER_PLAN.md#53-dependency-graph-who-depends-on-whom).

## 5. Cross-domain decisions
Authoritative log is [MASTER_PLAN §11](../MASTER_PLAN.md#11-global-decision-log). Current locked decisions: **D-001** UE5 (provisional, validated by Spike-1 R1), **D-002** patched conics, **D-003** active/on-rails generalized to factory, **D-004** no lockstep / authoritative server, **D-005** v1 scope cuts, **D-006** single canonical Body Definition (resolved Spike-1 RC-1). Admin appends new cross-domain decisions there.

## 6. Active delegations / in-flight briefs

**Spike 1 — floating-origin + scaled-space seamless surface↔orbit↔moon (Phase 0, highest risk).**
Orchestration: Wave 1 (core-engine lead + world-gen) pins API contracts → Wave 2 (rendering) consumes them → Admin synthesizes `docs/spikes/spike1-PLAN.md`.

| Date | To | Brief (goal) | Wave | Status |
|------|----|--------------|------|--------|
| 2026-06-14 | core-engine | Floating-origin + frames + active/on-rails skeleton; pin UniverseCoord/ReferenceFrame/SimProxy/SimClock; buildable UE5 plan → `spike1-core-engine.md` | 1 | **Done ✓** (CE-5/CE-6 added; R1 test designed) |
| 2026-06-14 | world-gen | Minimal cubed-sphere heightfield for 1 planet + 1 moon; pin chunk format + height/collision query; buildable plan → `spike1-worldgen.md` | 1 | **Done ✓** (re-dispatched after a transient socket drop; WG-5…9) |
| 2026-06-14 | rendering | Scaled space + dual cameras + log depth + seamless transition + atmosphere; buildable plan → `spike1-rendering.md` | 2 | **Done ✓** (RN-1/2 accepted, RN-5 added) |
| 2026-06-14 | Admin | Synthesize the three designs → unified build plan + acceptance gate | — | **Done ✓** → [spike1-PLAN.md](../spikes/spike1-PLAN.md) |

| 2026-06-14 | physics | Spike 2 — patched conics + rigid-body craft; resolve RC-4/RC-3 → `spike2-physics.md` | — | **Done ✓** (RC-4→PH-4 hybrid, RC-3→PH-5) |
| 2026-06-14 | factory-sim | Spike 3 — 100k @ 60 UPS isolation; pin factory streams → `spike3-factory-sim.md` | — | **Done ✓** (bandwidth-bound; FS-7/8 added) |
| 2026-06-14 | Admin | Phase-0 roll-up: consolidated contracts + reconciliation register + engine verdict | — | **Done ✓** → [PHASE0-SUMMARY.md](../spikes/PHASE0-SUMMARY.md) |

**Consolidated reconciliation register:** now in [PHASE0-SUMMARY §4](../spikes/PHASE0-SUMMARY.md#4-consolidated-reconciliation-register) (RC-1…RC-11). Resolved: RC-1/3/4. Trivial additive (build start): RC-2, RC-7. Open quick-confirms: **RC-8** (rendering ← factory stream / render wall), **RC-10** (core-engine ← chunk-granular proxies), RC-9 (networking, Phase 3). Deferred: RC-5, RC-6, RC-11.

**All three Phase-0 spikes designed; interface surface CLOSED** (reconciliation round 2026-06-14 — 4 controller agents: rendering confirmed RC-8 render wall; core-engine added CE-7 mixed proxy granularity; world-gen WG-10 Mie + slope/hardness; factory-sim FS-9 adopted CE-7 + RC-12). All build-blocking RCs resolved — see [PHASE0-SUMMARY §4](../spikes/PHASE0-SUMMARY.md#4-consolidated-reconciliation-register). Domain-local decisions added this round: CE-7, WG-10, FS-9 (not global — live in their controller files).

**Phase 1 PLANNED (2026-06-14).** Admin authored [PHASE1-PLAN.md](../phase1/PHASE1-PLAN.md); Wave-1 design dispatched to the two net-new domains:
| Date | To | Brief (goal) | Status |
|------|----|--------------|--------|
| 2026-06-14 | gameplay | Phase-1 player-loop design (avatar, mining/build UX, inventory, HUD, map) → `gameplay-phase1.md` | **Done ✓** (GP-6…12; surfaced C-1/2/3/5) |
| 2026-06-14 | persistence | Phase-1 slice save/load design (seed+diff, `IPersistable`, chunk keys) → `persistence-phase1.md` | **Done ✓** (PS-5…8; defined C-6; needs C-7/C-8) |

**Phase-1 contract surface C-1…C-9 CLOSED** (reconciliation round 2026-06-14 — 4 controller agents: world-gen pinned `FDepositNode` (C-1/WG-11,12); factory-sim pinned `FRecipeDef`/`FEntityDef` (C-2/FS-10); gameplay pinned `ItemId`/`FItemDef` + slice content + intents (C-3/4/5/GP-13,14); core-engine defined the quiesce handle + `RegionDepth` (C-7/8/CE-8,9,10). Admin reconciled C-8 to Forge=9/Cinder=8, and recorded C-5 physics-side + C-9 rendering confirms (build-time validated). See [PHASE1-PLAN §10](../phase1/PHASE1-PLAN.md#10-phase-1-cross-domain-contract-register-surfaced-by-wave-1-design-confirm-in-wave-2).

**Review pass DONE (2026-06-14)** → [REVIEW-2026-06-14.md](../REVIEW-2026-06-14.md). Independent auditor verdict: strong, disciplined design with a sound thesis, but "build-ready" was overstated. Open items it surfaced (tracked as Q7–Q10 below + the C-8/DepositTypeId doc-debt):
1. **BLOCKER — C-8 not propagated:** lock Forge=9/Cinder=8 into core-engine, factory-sim §11.4, persistence §3.1 (currently 11/9, ~10, 5–6). Mechanical; needs a cleanup pass.
2. **SHOULD-FIX — `DepositTypeId` stale** in gameplay-phase1 (§2.2/3.4/7.2/8.A/8.C) after WG-11 collapsed it into `ItemId`.
3. **Unowned execution layer** → Q7–Q10.

**Post-review cleanup + execution plan DONE (2026-06-14):**
| Item | Status |
|------|--------|
| C-8 propagation (9/8) + `DepositTypeId` scrub | **Done ✓** (1 cleanup agent, grep-verified — no stale live refs) |
| Execution plan (Q7–Q10) | **Done ✓** → [EXECUTION-PLAN](../EXECUTION-PLAN.md) |
| build-tooling controller (owns Q7) | **Created ✓** (9th domain) |

**State: design-complete, internally consistent, execution-planned.** Open for Reid: (a) go-ahead to **start building** (Step-0 git + headless Wave-0 cores — no UE5 needed); (b) **Q9 resourcing answer** (solo/team, hobby/full-time) to turn M2.1–M2.5 into a dated roadmap. Deferred owners: Q8 audio/art, Q10 networking paper-spike.

## 7. Integration milestones
- **M0 — Scaffold (DONE 2026-06-14):** plan + agent architecture + controller files created.
- **M1 — Spikes pass:** all three Phase-0 spikes demonstrated in isolation → engine decision D-001 confirmed or revised. *(All 3 DESIGNED 2026-06-14; D-001 holds on paper. Build/benchmark pending — the actual "pass" needs the Wave-0 headless cores + UE gates.)*
- **M2 — SP vertical slice (Phase 1):** PLANNED 2026-06-14 ([PHASE1-PLAN](../phase1/PHASE1-PLAN.md)) — integration spine M2.1 seamless world → M2.2 flight → M2.3 automation (render-wall measured) → M2.4 progression hook → M2.5 persistence. Build pending (UE5 project + toolchain).
- **M3 — Persistence:** save/load via seed+diff (Phase 2).
- **M4 — Co-op:** authoritative server, 2–8 players (Phase 3).

## 8. Open cross-cutting questions (Admin-owned)
- **Q1 — MP time-warp.** The hardest cross-domain design problem (physics×networking×factory-sim). v1 decision: likely no warp / vote-to-warp. Needs a joint networking+physics+factory-sim mini-study before Phase 3. *Owner: Admin, deferred.*
- **Q2 — Engine confirm.** D-001 (UE5) is provisional until Phase-0 spikes. Spike 1 *design* found no engine-overturning blocker; the open question narrowed to **Chaos physics for the active vessel** (Q5), not UE5 as a whole. Full confirm still gated on building Spike 1 + running the V1–V7/RV/WV gates. *Owner: Admin, gated on M1.*
- **Q3 — Perspective (1st vs 3rd person).** Affects rendering + gameplay + physics (collision capsule, camera). Decision deferred to Phase 1. *Owner: gameplay+rendering.*
- **Q4 — Voxel vs node mining commitment.** v1 = node-based (D-005). Voxel deferred to Phase 4; world-gen kept the API seam (`bFromVoxelPatch`) open. *Owner: world-gen.*
- **Q5 — Chaos vs custom integrator for the active vessel.** **RESOLVED (Spike 2 → PH-4 hybrid):** custom fixed-step symplectic integrator owns the active vessel's flight dynamics; Chaos retained only for collision/contact. Contained in-domain; not a D-001 overturn. Build-time confirmation gate = Spike-1 V4 / Spike-2 G8. *Owner: physics.*
- **Q6 — The render wall (NEW, from Spike 3 RC-8).** Sim can hold 100k+ entities; rendering drawing them at framerate is unproven and out of Spike-3 scope. The factory→render stream is designed to collapse item cost to O(lines) above LOD-0, but integrated "100k *rendered*" is a Phase-1 co-validation jointly owned by factory-sim + rendering. **The single biggest remaining technical unknown.** *Owner: factory-sim + rendering, gated on Phase 1.*
- **Q7 — Toolchain / CI / test-harness owner.** **RESOLVED (2026-06-14):** created the **build-tooling controller** (9th domain) to own version control, the UE5 toolchain, the headless test harness, CI, and the asset pipeline. Plan in [EXECUTION-PLAN](../EXECUTION-PLAN.md). *Owner: build-tooling.*
- **Q8 — Unowned production domains (NEW, review).** Audio, art/asset pipeline, and a *global* performance budget + target-hardware spec have no owner. May warrant new controllers (e.g. an audio/tools or tech-art controller). *Owner: Admin to assign.*
- **Q9 — Schedule / scope / headcount realism (NEW, review).** No effort estimate, timeline, or team-size assumption exists anywhere, despite the plan noting each pillar has cost talented teams *years*. The biggest strategic unknown. *Owner: Reid (resourcing call).*
- **Q10 — Networking replication validation (NEW, review).** RC-9 (is `FFactoryDelta`/`TickIndex` a sufficient replication seam?) is deferred to Phase 3 with zero consumer-side validation, so the "replication-friendly" claims across factory-sim/physics are unaudited. *Owner: networking, gated on Phase 3 — but a paper validation could de-risk earlier.*

## 9. Admin working notes
- Keep this file current as briefs are dispatched and reports return. Update §3 status and §6 table on every delegation cycle.
- Resist absorbing domain detail. If asked a domain-deep question, delegate to the controller and record only the *answer + decision*, not the derivation.
