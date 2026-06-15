# Phase 0 — Spike Roll-Up & Engine Verdict (Admin synthesis)

> **Owner:** Admin Master Controller · **Status:** All 3 Phase-0 spikes DESIGNED (build not started) · **Last updated:** 2026-06-14
> Spikes: [Spike 1 plan](spike1-PLAN.md) (core-engine + world-gen + rendering) · [Spike 2 physics](spike2-physics.md) · [Spike 3 factory-sim](spike3-factory-sim.md)

---

## 1. Purpose
Phase 0 exists to **retire the project's highest technical risks on paper before committing engine code**, and to **confirm or overturn D-001 (Unreal Engine 5)**. Three spikes were designed through the controller architecture:

| Spike | Domain(s) | Proves | Status |
|-------|-----------|--------|--------|
| 1 — Seamless traversal | core-engine (lead), world-gen, rendering | Walk→orbit→cross→land with no loading screen, no precision wobble, no kraken | Designed ✓ |
| 2 — Orbital + vessel physics | physics | Patched-conics + a rigid-body craft within active/on-rails; resolves Chaos-vs-custom | Designed ✓ |
| 3 — Factory at scale | factory-sim | 100k+ active entities @ 60 UPS; pins the factory→render/network stream | Designed ✓ |

## 2. Engine verdict (D-001)
**No engine-overturning blocker was found on paper. D-001 (UE5) holds — provisionally, pending the build gates.** The two biggest risks both resolved into *contained* outcomes rather than reasons to abandon UE5:
- **Active-vessel physics (was R1/RC-4):** UE Chaos is not trusted to integrate orbital-scale gravity under rebasing. **Resolution = hybrid (PH-4):** a custom fixed-step symplectic integrator owns the active vessel's flight dynamics; Chaos is retained *only* for collision/contact. This is an in-domain physics decision, not a D-001 overturn. Confirmation gate: Spike-1 **V4 / Spike-2 G8** ("no kraken at 3 km/s") with a real craft.
- **Factory scale (R1 factory):** 100k @ 60 UPS is **bandwidth-bound, not compute-bound**, and the pure-CPU core is **benchmarkable headless** (Spike-3 G1) before any UE work. The residual UE-specific risk is Mass Entity dispatch overhead (Spike-3 G8).

**Still must be proven by building** (cannot be validated without the engine): the floating-origin rebase under Chaos at speed, the scaled↔near cross-fade, and the Mass Entity throughput. Each spike's pure-CPU core is headless-testable first.

## 3. Consolidated cross-domain contract surface (the project's interface skeleton)
All pinned and cross-validated. Treat changes as breaking → escalate to Admin.

- **core-engine** → all: `FUniverseCoord`(+`FFrameId`), `IFrameGraph`/`FReferenceFrame` (μ/radius/SOI/spin via D-006), `ISimProxy`/`ISimRegistry` (4 content hooks), `ISimClock` (`FixedDt`/`Alpha()`/`TickIndex()`), events `OnOriginRebased` + `OnSOIChange` (pos+vel), CE-6 velocity subtraction.
- **world-gen** → rendering/physics: `FTerrainChunk` + `ITerrainProvider`; `SampleTerrainHeight`/`GetGroundContact`/`RaycastTerrain` (analytic, resident-free, `bFromVoxelPatch` seam); `FBodyParams`/`FAtmosphereProfile`.
- **physics** → gameplay/persistence/networking: `FVesselOrbitalState` (mode, frame, elements, true pos+vel, predicted path + next SOI). *(new, Spike 2)*
- **factory-sim** → rendering: `FFactoryEntityState` + `FFactoryBeltFlowState` + on-demand `GetLineItems` (the only O(items) call, pulled only at RN-3 LOD-0). → networking: `FFactoryDelta` keyed by `TickIndex()`. → persistence: factory snapshot + on-rails `FRailState`. *(new, Spike 3)*
- **factory-sim** defines `ISolarProvider::SampleSolar → {SunVisibility, DistanceToStarM, AtmoTransmittance}` — implemented later by physics (first two) + world-gen (third).

## 4. Consolidated reconciliation register
| # | Item | Owner | Status / resolution | When |
|---|------|-------|---------------------|------|
| RC-1 | Body constants duplicated | core-engine+world-gen | **Resolved → D-006** | Done |
| RC-2 | `FAtmosphereProfile` needs Mie params | world-gen | **Resolved (WG-10)** — added `MieScaleHeightM`/`MieScatteringScale`/`MieAnisotropy`; Forge values, Cinder N/A | Done |
| RC-3 | Analytic queries vs baked collision meshes | world-gen↔physics | **Resolved → PH-5** (analytic adopted; baked deferred, non-breaking) | Done |
| RC-4 | Chaos vs custom for active vessel | physics | **Resolved → PH-4 hybrid** | Done |
| RC-5 | Rendering reads frame graph per-frame | core-engine | Keep frame reads cheap/thread-safe | Build |
| RC-6 | UE Sky-Atmosphere = one atmosphere on screen | rendering | Fine for v1; note for multi-atmo future | Phase 4 |
| RC-7 | Add `SlopeRad` + `SurfaceHardness` to terrain contact structs | world-gen | **Resolved (WG-10)** — appended to `FTerrainContact`/`FTerrainHit`; `SurfaceHardness` harmonized to `[0,1]` double | Done |
| RC-8 | Confirm factory entity-state stream + LOD-0-only `GetLineItems` satisfies RN-3 render wall | rendering | **Resolved — CONFIRMED** (draw calls scale with machine-type variety, not entity count); spawned RC-12. Integrated 100k-*rendered* test → Phase-1 joint | Done (paper) |
| RC-9 | Confirm `FFactoryDelta`/`TickIndex` is a sufficient replication seam | networking | Open — networking not engaged until Phase 3 | Phase 3 |
| RC-10 | Confirm `ISimRegistry` tolerates chunk-granular proxies (factory FS-7) alongside per-vessel (physics) | core-engine | **Resolved → CE-7** — added defaulted `ISimProxy::PromotionRadius()`; near-edge bubble test. Adopted by factory-sim (FS-9) | Done |
| RC-11 | Implement `ISolarProvider` (physics: sun visibility + distance; world-gen: atmo transmittance) | physics+world-gen | Defined+stubbed; wire later | Phase 1 |
| RC-12 | Surface per-entity bound on `FFactoryEntityState` for cull/LOD | factory-sim (← rendering) | **Resolved (FS-9)** — added `uint16 BoundRadius` (+2 B); same data backs `PromotionRadius()` | Done |

**Interface surface CLOSED for build.** Resolved: RC-1/2/3/4/7/8/10/12. **Build-time notes (not blocking):** RC-5 (cheap frame reads), RC-6 (single-atmosphere, Phase 4). **Phase-deferred confirms/impl:** RC-9 (networking, Phase 3), RC-11 (solar wiring, Phase 1). The only substantive thing still *unproven* is the integrated render wall (RC-8 confirmed on paper; measured in Phase-1 co-validation).

## 5. The one big OPEN cross-risk
**The render wall (R1 factory / RC-8).** Spike 3 proves the *sim* can hold 100k+ entities; it does **not** prove rendering can draw them — that's deliberately out of scope. Sim-scale ≠ render-scale. The factory→render stream is designed so item-render cost collapses to O(lines) above LOD-0, but the integrated "100k entities *rendered* at framerate" case is a **Phase-1 co-validation jointly owned by factory-sim + rendering.** This is the highest remaining unknown.

## 6. Phase-0 exit options (Admin recommendation)
The design phase mapped the full risk surface and found no blocker that overturns the plan.
- **(A) Close the interface surface — ✅ DONE (2026-06-14).** Reconciliation round complete: rendering confirmed the render wall (RC-8), core-engine confirmed mixed proxy granularity (RC-10 → CE-7), world-gen folded in the additive fields (RC-2/RC-7 → WG-10), factory-sim adopted CE-7 + RC-12 (FS-9). All build-blocking RCs resolved; remaining items are phase-deferred.
- **(B) Build the Wave-0 pure-CPU cores** — all four are headless-testable with no engine: core-engine coord/rebase math, world-gen crack-free terrain, physics `FConics`+integrator+SimProxy, factory-sim 100k benchmark. Actually retires the scale / crack-free / no-drift / propagation claims. *(Needs a C++/C# toolchain.)*
- **(C) Plan Phase 1 (SP vertical slice)** — integrate everything: planet+moon, node mining, basic factory + power, manual flight surface→orbit→land. The first time the fusion is *played*.
