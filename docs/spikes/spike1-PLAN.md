# Spike 1 — Integrated Build Plan (Admin synthesis)

> **Owner:** Admin Master Controller · **Phase:** 0 · **Status:** DESIGNED across all 3 domains — ready to build · **Last updated:** 2026-06-14
> Synthesizes the three domain designs into one buildable plan + a single acceptance gate.
> Domain designs: [core-engine](spike1-core-engine.md) · [world-gen](spike1-worldgen.md) · [rendering](spike1-rendering.md)

---

## 1. Objective & what "pass" means
Prove the **seamless-traversal premise**: a single player can **walk on a planet → fly to orbit → cross to a moon → land and walk**, continuously, with **no loading screens, no precision wobble, and no physics "kraken"** at orbital speed. Placeholder art. Single-player.

This spike is the project's **highest-risk gate**. Its real purpose is to **retire risk R1** and thereby **confirm or overturn D-001 (Unreal Engine 5)**:
- **PASS** → D-001 confirmed; proceed to Spike 2 (physics) and Spike 3 (factory) on UE5.
- **PARTIAL PASS** (expected most-likely outcome, flagged by core-engine) → coordinates/rendering/terrain are fine, but **UE's Chaos physics misbehaves for the active vessel under rebasing at speed** → escalate to a physics-domain decision in Spike 2 (custom integrator for the active craft), *without* overturning UE5 itself.
- **FAIL** → revisit D-001 (Unity/DOTS or custom engine).

## 2. The two bodies (canonical — D-006)
| Body | Type | Radius | Surface g | Atmosphere |
|------|------|--------|-----------|------------|
| **Forge** | planet | 600 km | ≈9.81 m/s² | yes, scale-height ≈5.6 km |
| **Cinder** | moon | 200 km | ≈1.63 m/s² | airless |
Values live in the single canonical Body Definition (D-006); core-engine loads them into `FReferenceFrame`, world-gen `FBodyParams` and rendering consume them. No domain hardcodes its own copy.

## 3. Confirmed cross-domain contract surface
All three domains independently validated these as consistent. **This is the stable interface skeleton the whole project will build on** — treat changes as breaking (escalate to Admin).

**core-engine provides** ([§5](spike1-core-engine.md)):
- `FUniverseCoord` (64-bit position **+ `FFrameId`** — never a bare `FVector`) + `ToEngine/FromEngine(FFloatingOrigin)`
- `FReferenceFrame` / `IFrameGraph` (`ToUniverse(SimTime)`; carries μ/radius/SOI/spin from D-006)
- `ISimProxy` / `ISimRegistry` (promotion/demotion owned by core-engine; `EvalOnRails/StepActive/OnPromote/OnDemote` content owned by domains)
- `ISimClock` (fixed tick, warp, interpolation `Alpha()`, `TickIndex()` for determinism/replication)
- **Events:** `OnOriginRebased(DeltaEngine, NewOrigin)` · `OnSOIChange(FSOIChangeEvent{pos+vel in new frame})`

**world-gen provides** ([§4–5](spike1-worldgen.md)), all `FUniverseCoord`-based:
- `FTerrainChunk` (center as `FUniverseCoord`, body-relative verts, skirts, `MaterialId`, `ContentHash`)
- `ITerrainProvider` (`OnChunkReady`/`OnChunkEvicted`/`UpdateStreaming(observerPos, simTime)`)
- `SampleTerrainHeight(FBodyId, lat, lon)` · `GetGroundContact(...)` · `RaycastTerrain(...)` — resident-free; every result carries `bFromVoxelPatch` (the D-005 voxel seam, stubbed no-op)
- `FBodyParams` / `FAtmosphereProfile`

**rendering consumes** all of the above; produces no new outbound contract this spike.

## 4. Integration sequencing (build order)
Designed so the **pure-CPU core is testable with zero engine first**, then engine bring-up, then the visual rig.

- **Wave 0 — Pure CPU, no engine (unit-testable):**
  - core-engine: `FUniverseCoord`, `IFrameGraph`, rebase math, `SimClock` accumulator.
  - world-gen: cube→sphere warp, position-hashed heightfield, quadtree, crack-free seam guarantee (world-gen gates **WV1–WV3**).
  - *Exit:* math validated headless; the crack-free + deterministic-regen guarantees proven before any UE work.
- **Wave 1 — UE5 bring-up (the demo skeleton):**
  - core-engine build steps → floating-origin rebase + frame graph + SimProxy (bodies on-rails, observer active) + **placeholder single camera** so the loop runs.
  - world-gen step 8 → real terrain replaces placeholder sphere colliders; `ITerrainProvider` streaming live.
  - *Exit:* you can fly the placeholder observer through the full loop on real terrain (core-engine gates **V1–V5**, world-gen **WV4–WV8**).
- **Wave 2 — Rendering rig (the seamless sell):**
  - rendering build (RN-Build 0–3) → dual-camera scaled space, depth strategy, terrain LOD rendering, scaled↔near cross-fade, Sky-Atmosphere; **replaces** core-engine's placeholder camera.
  - *Exit:* the loop is *visually* seamless (rendering gates **RV1–RV8**).

## 5. Unified acceptance gate (the seamless loop)
Spike 1 PASSES when this single continuous run holds, combining the domain gates:
1. **Walk on Forge** — stand/walk on streamed terrain; no cracks/popping at quad seams (WV2, RV5).
2. **Ascend to orbit** — continuous; floating-origin rebases cause **no hitch** (V2) and **no precision wobble** out to 10⁹ m (V3); sky **fades to black** via scattering (RV7); scaled-space proxy takes over the far view with **no pop** at the cross-fade (RV3/RV8).
3. **Coast at orbital speed (~3 km/s)** — Krakensbane velocity-subtraction keeps the active frame sub-orbital; **no kraken** (V4). A 1 m object and the 10⁹ m body coexist with **no z-fighting** (RV2).
4. **Cross to Cinder (SOI change)** — `OnSOIChange` re-parents the observer seamlessly (V5); approach body re-targets; no visual discontinuity.
5. **Descend & land on Cinder** — airless (no atmosphere), real terrain streams in, land and walk; symmetric to step 1.
6. **Round-trip back** — no accumulated drift, no leaks, stable UPS/FPS throughout.

> Per-domain gate definitions: core-engine V1–V7 ([§7](spike1-core-engine.md)), world-gen WV1–WV8 ([§6](spike1-worldgen.md)), rendering RV1–RV8 ([§6](spike1-rendering.md)).

## 6. Open reconciliation items (Admin-tracked)
| # | Item | Resolution | Owner | When |
|---|------|-----------|-------|------|
| RC-1 | Body constants duplicated (core-engine vs world-gen) | **Resolved → D-006** single canonical Body Definition | core-engine + world-gen | Done |
| RC-2 | `FAtmosphereProfile` lacks **Mie** params (rendering needs `MieScaleHeightM`/`MieScatteringScale`/`MieAnisotropy` for horizon haze) | Non-breaking additive field add; rendering uses placeholder Mie until then | world-gen | At build start (Wave 0) |
| RC-3 | Analytic height queries vs baked per-quad **collision meshes** | Defer; negotiate when physics spins up — contract supports adding mesh emission without breaking callers | world-gen ↔ physics | Spike 2 |
| RC-4 | **Chaos-vs-custom** physics for the active vessel under rebasing at speed | Pre-warned; decide in Spike 2 based on Spike-1 V4 result | physics | Spike 2 |
| RC-5 | Rendering reads `IFrameGraph`/`ToUniverse` **per-frame** (read-frequency note) | Acceptable; core-engine to keep frame reads cheap/thread-safe | core-engine | Build |
| RC-6 | UE5 Sky Atmosphere renders **one atmosphere on screen at a time** | Fine for v1 (only Forge); note for multi-atmospheric-body future | rendering | Phase 4 |

## 7. Out of scope for Spike 1 (deliberately)
Real multi-part vehicle physics & aerodynamics (Spike 2), the factory sim (Spike 3), voxel digging (Phase 4), multiplayer (Phase 3), final art, UI/map view, audio. Spike 1 uses a **simple controllable observer**, not a real craft.

## 8. Status & go/no-go
**Design phase: COMPLETE** for all three domains; contracts pinned and cross-validated. **Build phase: NOT STARTED** — requires an actual UE5 project + C++ implementation (cannot be validated without the engine). RC-2 is the only pre-build reconciliation (trivial, additive).

**Admin recommendation:** the design has materially de-risked Spike 1 and surfaced the one likely failure mode early (Chaos for the active vessel → a contained Spike-2 decision, not an engine-wide overturn). Two viable next moves:
- **(A)** Continue de-risking on paper: dispatch **Spike 2 (physics)** and **Spike 3 (factory-sim)** designs so the entire Phase-0 risk surface is mapped before any engine code.
- **(B)** Begin **building** Spike 1 (stand up the UE5 project + Wave-0 pure-CPU core, which is unit-testable without the full engine), to start actually retiring R1.
