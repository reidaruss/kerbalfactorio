# M2 — Headless Integration: the four cores compose into the slice-loop logic

> **Owner:** Integration (cross-cutting glue) · **Phase:** 1 · **Status:** BUILT + GREEN ✓ · **Last updated:** 2026-06-14
> Built artifact: `core/include/of/sim_world.h` + `core/tests/test_integration.cpp` (target `integration_tests`, ctest suite #5).
> Reads alongside: [PHASE1-PLAN §2/§5](PHASE1-PLAN.md) (playable loop + the M2.1–M2.5 spine), [spike1-PLAN §5](../spikes/spike1-PLAN.md) (the seamless acceptance loop), [MASTER_PLAN §3](../MASTER_PLAN.md) (active/on-rails) + §11 D-006 (body μ).

---

## 1. What this is

The four Wave-0 cores (core-engine, physics, world-gen, factory-sim) were each proven **green in isolation**. This milestone is the first time they are **composed into one fixed-tick loop** — the Phase-1 flight spine's *logic*, with **no rendering and no UE5**. It is M2.1–M2.4 minus the visual shell: it proves the cores fit together to drive the playable journey, so that when the UE5 project (M2.1+) is stood up, the integration risk is already retired at the logic level.

It is **glue, not a rewrite**: `SimWorld` consumes the existing cores unchanged (one additive, non-breaking accessor was added to factory-sim — see §6). All four original suites stay green.

## 2. The journey it proves (`integration_tests`)

A single controllable craft runs the whole loop **continuously, under one `SimClock`**, while a factory ticks every step:

| Stage | What happens | What it composes | Asserted |
|-------|--------------|------------------|----------|
| **1 Surface start** | Vessel placed on **Forge** at the world-gen terrain altitude | core-engine frames + world-gen `SampleTerrainHeight` | ground contact: terrain-altitude ≈ 0; body radius = 600 km (D-006) |
| **2 Ascent (ACTIVE)** | Radial thrust; symplectic `Integrator` climbs | physics integrator + core-engine `FloatingOrigin` | floating origin **rebases repeatedly** as it climbs (67 rebases); engine-space coords stay **bounded < 6 km** (≈3999 m) though the craft is ~1.5e11 m from the star — the *seamless / no-precision-wobble* property |
| **3 Orbit (ON-RAILS)** | Circularize, **park** to Kepler elements, propagate analytically | physics `park`/`resume` + the active↔on-rails handoff | over 4000 ticks the parked conic's specific energy holds to **rel err 1.2e-15** — *no drift* |
| **4 Cross to Cinder (FRAME SWITCH)** | Fly toward Cinder; on entering Cinder's SOI the frame re-parents Forge→Cinder and μ switches | core-engine `FrameGraph` + physics patched conics (D-002) | SOI switch fires once; the **physical (root-space) point is continuous** across the switch — jump = **25.1 m** (one ~1.5 km/s step), *not* a frame discontinuity; central μ/radius become Cinder's (D-006) |
| **5 Land on Cinder** | Powered descent under Cinder gravity to the terrain surface | physics integrator + world-gen Cinder heightfield | ground contact on Cinder's terrain altitude |
| **6 Factory runs throughout** | A slice-scale machine crafts every tick under the same clock | factory-sim under the shared `SimClock` | `producedCount()` grows **monotonically in every phase** (active ascent, on-rails orbit, transfer+switch, active descent); produced = 2563; factory `tickIndex` == world `tickIndex` |

Measured run (final): `rebases=67  max_engine_dist=3999.4 m  rail_maxdE/E=1.23e-15  cross_jump=25.1 m  soi_switches=1  produced=2563  ticks=12815`.

Plus four localizing unit checks (frame layout/round-trip, surface placement uses terrain height, `park→promote` identity, factory-shares-the-clock) so a regression points at the broken seam.

## 3. The active/on-rails handoff (MASTER_PLAN §3, the unifying principle)

`SimWorld::Vessel` is exactly the §3 lever applied to one craft:
- **ACTIVE** — `(r, v)` advanced one symplectic `of::orbital::Integrator` step per tick (full flight dynamics, optional constant thrust). Used for ascent, the Cinder crossing, and descent.
- **ON-RAILS** — the state is `park()`-ed into `of::orbital::Elements` and propagated analytically with `resume()` each tick (no integration, no drift). Used for the orbital coast.
- **`parkToRails()` / `promoteToActive()`** are the demote/promote. A park-then-immediately-resume at the same SimTime is the identity on `(r, v)` (verified). `makeActiveFromCurrentState()` hands a freshly-set state to the integrator (manual control for a transfer/descent) without resuming a stale conic.

The SOI switch re-parents **both** the reference frame *and* the gravitational μ — the patched-conics model (D-002): the two-body problem the integrator/propagator solves is always about whichever body owns the vessel's current frame.

## 4. The "base keeps working while you fly" property

The factory is ticked **every** `SimWorld::step()`, before vessel motion, on the same `SimClock` (so `factory.tickIndex() == world.tickIndex()` always). The test asserts the cumulative produced counter strictly increased across *each* flight phase — the base never stalled because the player was flying. This is the slice-scale (P1-D3) demonstration of the on-rails-base premise, headless.

## 5. What remains for the UE5 visual shell (M2.1+)

This milestone is the **logic** of M2.1–M2.4. Still required to make it a *playable* slice (all gated on the engine, the environment boundary):
- **M2.1 visual shell** — the UE5 project: dual-camera scaled space, log/cascaded depth, terrain LOD meshing of the world-gen heightfield, the scaled↔near cross-fade, Sky-Atmosphere (rendering's RV1–RV8). `SimWorld` drives *where* things are; rendering draws them.
- **M2.2 real craft + character** — replace the single point-mass vessel with the Spike-2 rigid-body craft + surface/character physics and the on-foot↔in-craft handoff (P1-D1); wire player intent (C-5) into thrust/attitude rather than the test's scripted thrust/state-sets.
- **M2.3 automation at slice scale** — the 5-machine chain (miner→belt→smelter→assembler→box) placed on terrain with build/placement UX (P1-D6) + power/brownout, and the **render-wall co-validation (Q6/RC-8)** — the one carried-over unknown, unmeasurable headless.
- **M2.4 progression hook** — deposits on both bodies incl. the Cinder-only resource (world-gen `FDepositNode`, C-1) + the slice objective/HUD.
- **Streaming + frames over time** — `FrameGraph` here uses **static** offsets (the slice never leaves Forge's SOI and the bodies are treated as fixed); orbital motion of the frames themselves (Cinder orbiting Forge over SimTime) and chunk streaming (`ITerrainProvider`) are the next core-engine/world-gen integration step.
- **Persistence (M2.5)** — `SimWorld` state (clock tick, vessel mode/frame/state, factory SoA, floating-origin observer) is the surface persistence will serialize via `IPersistable` (C-6); not exercised here.

## 6. Accessor added to a core header (flag for Admin)

**INT-1 — `factory::FactorySim::producedCount()`** (additive, non-breaking) in `core/include/of/factory_sim.h`. A `uint64_t totalProduced_` lifetime counter, incremented at the **same** craft-completion point that already bumps `outSlotCount_`, exposed via a const getter. It exists because the existing `machineOutput()` reflects the *current* out-slot, which an inserter drains — so it is **not monotonic** and can't witness "the base kept producing across the whole flight." The new counter only ever increases. No existing behavior changed; all four original suites stay green (re-verified). **Admin: please record INT-1 against the factory-sim interface.**

## 7. How to build + run

```
cmake -S core -B core/build -G Ninja -DCMAKE_CXX_COMPILER=g++
cmake --build core/build
core/build/integration_tests.exe          # the journey + the 4 unit checks
ctest --test-dir core/build               # all 5 suites (the existing 4 + integration)
```

Result: `integration_tests` green; **5/5 ctest suites pass** (no regression in the four Wave-0 cores). Built with `-O2` like the rest of the core.
