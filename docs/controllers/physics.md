# Physics & Orbital Mechanics — Master Controller Context

> **Domain owner:** `physics-controller` · **Reports to:** Admin · **Phase:** 0 · **Status:** Spike 2 designed · **Last updated:** 2026-06-14
> Read alongside: [MASTER_PLAN](../MASTER_PLAN.md) · [AGENT_ARCHITECTURE](../AGENT_ARCHITECTURE.md) · [ADMIN](ADMIN.md)

## 1. Mission
Deliver believable, stable, time-warpable orbital flight and rigid-body vehicle/structure physics — KSP-grade credibility — within the active/on-rails framework, while staying cheap enough to coexist with the factory sim.

## 2. Scope & owned subsystems
- **Orbital mechanics** — patched conics (two-body + SOI switching), analytic propagation for on-rails bodies/vessels.
- **Rigid-body vehicle physics** — multi-part craft, joints, thrust, mass/CoM, aerodynamics & drag in atmospheres.
- **Surface & character physics** — walking, vehicles on terrain, collision against world-gen terrain.
- **SOI transitions** — handing a vessel between reference frames as it crosses sphere-of-influence boundaries (with [core-engine](core-engine.md)).
- **Active↔on-rails conversion** — produce/consume orbital element sets so a vessel can "park" on rails and resume under physics.
- **Non-goals:** the coordinate/frame substrate (→ core-engine); rendering of trajectories (→ rendering/gameplay map view).

## 3. Key design decisions
| # | Decision | Rationale | Status | Date |
|---|----------|-----------|--------|------|
| PH-1 | Patched conics, **not** n-body (mirrors D-002) | Time-warp + stable orbits + cheap + deterministic | Accepted | 2026-06-14 |
| PH-2 | Full rigid-body physics only for active vessel + nearby; rest on rails | Core scalability (D-003) | Accepted | 2026-06-14 |
| PH-3 | On-rails state = classical Keplerian element set + epoch; advance via **universal-variable** Kepler solve (one path for elliptic/parabolic/hyperbolic) | Analytic propagation; warp-free; trivial save/restore; hyperbolic transfers need no separate code path | **Accepted** (Spike 2) | 2026-06-14 |
| PH-4 | ~~Use Chaos for active rigid bodies; custom integrator for orbits~~ **REVISED → HYBRID (RC-4 call): custom fixed-step symplectic integrator owns the active vessel's flight dynamics (gravity/thrust/drag/joints); Chaos retained ONLY for collision detection + contact response.** Fallback: fully-custom analytic ground contact (Chaos-free) if touchdown contact is unstable. | CE-6 removes the velocity problem but not the integration problem; UE5 LWC jitters ≥3 km so Chaos is only trustworthy near origin and would accumulate error on 600 km gravity; closed-form-consistent integrator preserves the on-rails no-drift guarantee + Phase-3 determinism; matches core-engine's predicted "partial-pass" path. | **Accepted** (Spike 2, RC-4) | 2026-06-14 |
| PH-5 | Terrain collision = world-gen's **analytic** queries (`GetGroundContact`/`RaycastTerrain`/`SampleTerrainHeight`), NOT baked per-quad meshes; baked-mesh emission deferred (Phase-1 perf option, non-breaking). | Resident-free (need ground before LOD streams), floating-origin-clean, deterministic, point-local contact. | **Accepted** (Spike 2, RC-3) | 2026-06-14 |

## 4. Architecture & approach
- **Two regimes:** (a) **On-rails** — vessel = Keplerian elements in its dominant frame; advance analytically, including under time-warp; (b) **Active** — full rigid-body sim near the player. core-engine's `SimProxy` triggers promotion/demotion; physics fills the content of each side and must make the handoff smooth (KSP's load-in wobble is the cautionary tale).
- **Patched conics:** vessel feels gravity from exactly one body (its SOI). Crossing an SOI boundary = a frame switch event (core-engine) + re-derivation of elements relative to the new body. Predicted trajectories (for the map/maneuver UI) computed by propagating conics forward and intersecting SOIs.
- **Vehicle structure:** parts as rigid bodies joined by constraints; thrust applied at engine parts; aero forces from atmosphere density (world-gen) × velocity. Joint stability/wobble is a known KSP pain — consider rigidified part-trees or substepping.
- **Surface:** character controller + vehicle contact against world-gen collision (heightfield, or voxel patch where dug). Gravity from the local body.

## 5. Interfaces & dependencies
**Depends on (inbound) — Spike-1 contracts CONSUMED verbatim:**
- core-engine: `FUniverseCoord`(+`FFrameId`), `FReferenceFrame`/`IFrameGraph` (μ/SOI/spin, D-006), `ISimProxy`/`ISimRegistry` (we implement the four hooks; core-engine owns promotion/demotion + hysteresis), `ISimClock` (warp, `TickIndex`), `OnOriginRebased`, **`OnSOIChange` (carries pos+vel re-expressed in new frame — we consume both)**, **CE-6 frame-velocity subtraction** (we read TRUE velocity, integrate the slow residual). All honored; no requested change.
- world-gen: `SampleTerrainHeight`/`GetGroundContact`/`RaycastTerrain` (analytic, resident-free), `FBodyParams`/`FAtmosphereProfile`. Adopted as the collision source (PH-5).

**Provides to (outbound):**
- Interpolated transforms of active physical entities → [rendering](rendering.md).
- **`FVesselOrbitalState`** (mode, dominant frame, elements, true pos+vel, predicted path + next SOI crossing) → [gameplay](gameplay.md) (map/maneuver UI — we compute, they draw), [persistence](persistence.md) (save = ~10 doubles), [networking](networking.md) (replication; pure time-addressable conic + fixed-step integrator = determinism-friendly per D-004). *New outbound contract — flagged to Admin (spike2-physics §8.2).*
- Contact/landing events, structural state → gameplay.

**Negotiated with world-gen (RC-3, settled PH-5):** analytic queries adopted; **one non-breaking additive request** — add `SlopeRad` + `SurfaceHardness` to `FTerrainContact`/`FTerrainHit` (spike2-physics §5.2). Append-only, no caller breaks. Baked collision meshes deferred (Phase-1 perf option, contract already supports it).

## 6. Task backlog / roadmap
- **[Phase 0 / Spike 2]** ✅ **Designed** — [spike2-physics.md](../spikes/spike2-physics.md): patched-conics propagator (universal-variable Kepler), on-rails↔active conversion (the four `ISimProxy` hooks, no-drift guarantee), one rigid-body craft (hybrid integrator), RC-4 hybrid resolution, RC-3 analytic-query resolution, full launch→orbit→coast→SOI→land build plan + gates G1–G11. **Build NOT started** (needs UE5 project).
- [Phase 1] Full per-part aerodynamics + atmospheric entry (Spike 2 ships single-`Cd·A` only); surface vehicle physics; baked-mesh collision option if contact-query volume bottlenecks (PH-5 deferral).
- [Phase 1] Multi-part flex joints beyond the spike's compound-rigid default (KSP wobble mitigations 1/3/4 are built+stubbed in the spike).
- [Phase 3] Cross-platform determinism verification of the custom integrator with networking (D-004).

## 7. Open questions & risks
- **R1 (mitigated, design-level):** Joint/wobble for multi-part craft. Spike 2 default = **compound rigid body** (sidesteps it entirely for the spike flow); flex joints use stiff 6-DOF constraints + fixed sub-stepping + strain-free promotion (spike2-physics §3.3). Validated by gate G10. Residual risk moves to Phase-1 multi-part craft.
- **R2 (resolved, design-level):** on-rails↔active handoff smoothness — **no-drift guarantee** via lossless conic fit on demote + strain-free re-seed on promote (spike2-physics §2.2, gate G6). Build-time validation pending UE5.
- **R3 (Admin Q1):** time-warp semantics when other players have active vessels (MP) — deferred, networking-coupled. Unchanged by Spike 2.
- **R4 (RC-4, RESOLVED → PH-4 hybrid):** Chaos-vs-custom for the active vessel. Resolved: custom fixed-step integrator for flight dynamics, Chaos for contact only (fallback: fully-custom analytic contact). Confirmation gate = G8 (= Spike-1 V4, no kraken at 3 km/s). Only escalates to D-001/Admin if near-origin low-speed contact itself fails — which the hybrid is designed to avoid.

## 8. Subagent delegation log
| Date | Subagent task | Status | Outcome |
|------|---------------|--------|---------|
| 2026-06-14 | Scoped web research (run directly, no subagent — 5 targeted searches) for Spike 2: (1) UE5 Chaos under origin shifting / LWC jitter; (2) KSP Krakensbane / why analytic orbits; (3) Kepler universal-variable + patched-conic SOI; (4) UE5 Chaos fixed-substep / Async Physics Tick; (5) KSP joint-wobble mitigation (KJR/autostrut/JOINT_RIGIDITY). | Done | **Decisive for RC-4.** Findings: LWC meshes jitter ≥3 km, peak 10 km (validates REBASE_RADIUS=4 km; Chaos only trustworthy near origin); Krakensbane is a *coordinate workaround* not a physics fix (CE-6 handles velocity, not integration); universal-variable Kepler = one path for all conic types; Chaos Async Physics Tick gives fixed substep but per-substep force callbacks changed/awkward; joint stiffness is a Chaos solver-iteration problem too. → **PH-4 HYBRID** (custom integrator + Chaos-for-contact). Folded into spike2-physics §4. |

## 9. References
MASTER_PLAN §6 (orbital), D-002, D-006. Spike-2 design + full citations: [spike2-physics.md](../spikes/spike2-physics.md) §9. Key: universal-variable Kepler propagation; patched-conic SOI intersection (poliastro); KSP Krakensbane (coordinate workaround); UE5 LWC jitter ≥3 km + Chaos Async Physics Tick; Kerbal Joint Reinforcement / autostrut (wobble mitigation). Principia (n-body, cautionary — not adopted, D-002).
