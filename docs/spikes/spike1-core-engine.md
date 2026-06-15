# Spike 1 — Core Engine: Seamless Floating-Origin Traversal

> **Domain:** Core Engine & Simulation Framework (lead) · **Phase:** 0 · **Spike:** 1 (highest-risk item) · **Status:** Designed, ready to build · **Last updated:** 2026-06-14 (RC-10: `ISimProxy.PromotionRadius()` added — mixed proxy granularity, §3.2.1/§5.3)
> **Owner:** `core-engine-controller` · Read alongside: [core-engine.md](../controllers/core-engine.md) · [MASTER_PLAN](../MASTER_PLAN.md) §3,§4,§9,§11 · [AGENT_ARCHITECTURE](../AGENT_ARCHITECTURE.md)
> **Co-domains:** world-gen (minimal terrain, parallel) · rendering (Wave 2, consumes the §5 contracts below)

---

## 0. Purpose & the one question this spike answers

Prove that the **seamless-traversal premise is physically achievable in UE5**: a single observer can **walk on a planet → fly to orbit → land on a moon** with **no loading screens, no precision wobble, no physics "kraken," and no frame hitch**, using placeholder art.

Everything here exists to retire **R1** (core-engine.md §7): *Does UE5's Large World Coordinates (LWC) + Chaos physics behave well under aggressive floating-origin rebasing at speed?* If R1 fails, **D-001 (UE5) is overturned** and the whole stack is re-scoped. That is why this is the first thing built.

**Non-goals (hard scope fence):** no factory, no real rigid-body vehicle/aero (Spike 2 / physics domain), no real orbital integrator beyond a closed-form rail, one star + one planet + one moon only, no networking implementation (but the design is replication-shaped per D-004).

---

## 1. Floating-origin rebasing algorithm

### 1.1 Why UE5 LWC does **not** remove the need for rebasing (key research finding)

LWC gives us a **64-bit double-precision *world coordinate authority*** — but the GPU vertex pipeline and Chaos solver still do their hot-loop math in an effectively **32-bit working set referenced to the current render/physics origin**. LWC widens the *authority*; it does not make the *solver* 64-bit-stable at 10⁷ m. UE's own automatic World-Composition origin shifting is **single-player only, snaps in integer-meter quanta, and is known to jitter or break world-space materials, GPU particles, and Chaos bodies**. 

**Conclusion (de-risking decision CE-5, below):** we do **not** rely on UE's automatic world-origin shifting. We keep the **64-bit `UniverseCoord` as the sole authority** and drive **our own explicit rebase** that moves the rendered/physics world under the observer. This exactly mirrors CE-4 (64-bit authority; 32-bit near origin) and is the only path we control tightly enough to stress-test R1.

### 1.2 What "the origin" is

- `UniverseOrigin` — a **64-bit `UniverseCoord`** marking where UE world `(0,0,0)` currently sits in the universe, **expressed in the active observer's current `ReferenceFrame`** (see §2). This is the bridge between 64-bit authority and 32-bit engine space.
- **Engine-space (UE world) transform of any entity** = `(entity.UniverseCoord − UniverseOrigin)` projected into the observer's frame, cast to 32-bit `FVector`. Near the origin this is small → GPU/Chaos stay precise.

### 1.3 Trigger — dual threshold (position **and** velocity)

A position-only threshold is **insufficient at orbital speed** (~2–3 km/s on a small moon, higher near a planet). KSP's *Krakensbane* shifts **both the origin position and a frame velocity** so the active object stays near origin **and slow relative to the physics frame**. We adopt both:

| Trigger | Condition | Action |
|---|---|---|
| **Position rebase** | `‖observer.EnginePos‖ > REBASE_RADIUS` (default **4 km**, soft) — *or* hard cap `> 8 km` forces it next tick regardless | Shift origin by the observer's current engine offset (§1.4). |
| **Velocity rebase (frame-velocity subtraction)** | `‖observer.frameRelVelocity‖ > VEL_REBASE` (default **800 m/s**) | Rebase **every fixed tick** while above threshold; additionally subtract a **frame velocity** so the observer's *physics-frame* speed stays low (§1.5). |

`REBASE_RADIUS = 4 km` keeps engine coords comfortably inside the precision-safe 32-bit band (well under the ~16 km where float steps reach ~1 mm, and far under the ~16,777 km where steps reach 1 m). The 800 m/s velocity trigger ensures that at ≥ Mach-2-ish surface flight and all orbital speeds we are in **per-tick rebase mode**, never letting a single tick travel a precision-damaging distance (at 3 km/s and a 1/60 s tick that's only 50 m/tick — trivially safe, but we rebase anyway to keep the frame-velocity correction live).

> **Rebasing is evaluated at the end of every fixed sim tick** (§4), on the **64-bit authority**, *before* render interpolation reads transforms. It is deterministic and decoupled from FPS.

### 1.4 Position rebase — exactly what shifts

On a position rebase with delta `D = observer.EnginePos` (a 32-bit `FVector`):

1. `UniverseOrigin += toUniverse(D)` — accumulate the shift into the **64-bit** origin (no precision loss; D is small).
2. Translate **all engine-space transforms by `−D`**, in this order:
   - **Scene/Actors:** call `ApplyWorldOffset(−D, /*bWorldShift=*/true)` on every rebasable root component / Actor (the observer ends near (0,0,0)).
   - **Chaos bodies:** `ApplyWorldOffset` on a physics-simulated body moves the body transform; we additionally **re-anchor the Chaos `FPhysScene`** by the same `−D` so the solver's broadphase and contact manifolds shift coherently (do **not** let solver-space and actor-space diverge — that is a primary kraken source). Velocities are frame-invariant under a pure translation, so linear/angular velocities are **left untouched** here (velocity handling is §1.5).
   - **GPU/render:** notify via the **`OnOriginRebased(D)` event** (§1.6). World-space materials, Niagara world-space emitters, decals, and any cached world-space deltas must re-anchor. Camera follows the observer so it also lands near origin.
   - **World-gen / streaming:** world-gen subscribes to `OnOriginRebased` to shift its loaded terrain tiles (it stores tile centers in `UniverseCoord`, so it just re-projects).
3. Set a one-tick `rebasedThisTick` flag so interpolation (§4.3) does **not** interpolate across the discontinuity (anti-pop).

> **What never shifts:** the **64-bit `UniverseCoord` of any entity** (that is authority — it is *frame*-relative, not *origin*-relative). Only the *engine-space projection* shifts. This separation is the whole trick.

### 1.5 Velocity rebase (Krakensbane-style) — behavior at high velocity

At high speed we also maintain a **`frameVelocity`** (64-bit) on the active `ReferenceFrame`'s working set:

- Each tick while above `VEL_REBASE`, compute the observer's velocity in physics-frame space and **subtract a `frameVelocity` correction** so the observer's *Chaos-space* velocity is bounded (target: keep |physics-space v| ≤ a few hundred m/s). The subtracted amount accumulates into `frameVelocity`; the **true** universe velocity is reconstructed as `physicsSpaceVel + frameVelocity`.
- Render and gameplay read **true** velocity (`physicsSpaceVel + frameVelocity`); Chaos only ever integrates the **small residual**, which is what keeps contact resolution and CCD stable at orbital speed.
- On touchdown / low-speed (below `VEL_REBASE − hysteresis`, default 600 m/s), `frameVelocity` is **bled back to zero** over a few ticks (or hard-reset via `ResetVelocityFrame()` analogue when grounded) so surface walking runs in a plain, zero-frame-velocity space.

This is the single most important mechanism for R1: **Chaos never sees a 3 km/s rigid body**, only a slow residual, no matter how fast we traverse.

### 1.6 Notification contract (subsystems)

A single broadcast after each rebase:

```cpp
// Broadcast on the SimClock thread at end-of-tick, BEFORE render reads transforms.
DECLARE_MULTICAST_DELEGATE_TwoParams(FOnOriginRebased,
    const FVector& /*DeltaEngine*/, const FUniverseCoord& /*NewOrigin*/);
FOnOriginRebased OnOriginRebased;   // rendering, world-gen, VFX, audio subscribe
```

Subscribers: **rendering** (re-anchor world-space shaders/Niagara, scaled-space camera), **world-gen** (re-project loaded tiles), **physics** (Spike 2: re-anchor any extra physics islands), **audio** (world-space sound sources). Core-engine handles Actor + Chaos scene shift itself before broadcasting.

---

## 2. Reference-frame hierarchy + SOI switch

### 2.1 Hierarchy

```
StarFrame (universe root; position = universe (0,0,0), non-rotating)
 └─ PlanetFrame   (orbits Star on a rail; rotates about its axis — sidereal spin)
     └─ MoonFrame (orbits Planet on a rail; rotates about its axis)
```

Each `ReferenceFrame` holds, in **64-bit**:
- `parent` (null for Star), `frameId`.
- `localOrbit` — closed-form rail (Keplerian elements or, for the spike, a simple circular `{radius, period, phase}`) giving position **in parent frame** at time `t`.
- `spin` — `{axis, period, phase0}` body rotation (so a walker co-rotates with the surface).
- `mu` (gravitational parameter) and `soiRadius` — defines where this frame "wins."

A `ReferenceFrame` resolves **frame→universe** by composing the chain to the root at the current `SimClock` time. The **observer is parented to its dominant frame** (the deepest frame whose SOI contains it). `UniverseCoord` is stored **relative to the observer's current dominant frame** so numbers stay small and the floating origin lives inside that frame.

### 2.2 SOI determination (spike rule)

Dominant frame = **deepest frame in the chain whose `‖observerPos − framePos‖ < soiRadius`.** For the spike this is a pure geometric containment test (no gravity ratio needed with one moon); it generalizes later to physics-domain patched-conics. Evaluated every fixed tick for the observer (cheap: 3 frames).

### 2.3 SOI crossing — event shape

When the dominant frame changes between tick *n* and *n+1*:

1. **Re-express** the observer's `UniverseCoord` **and** velocity from the old frame into the new frame (compose the relative transform of the two frames at time `t`). Position and velocity are continuous across this re-expression — it is a change of *coordinates*, not a teleport. (At a Planet→Moon entry, the observer's velocity gains the Moon's orbital velocity relative to the Planet, exactly as in patched conics.)
2. **Re-anchor the floating origin** into the new frame (recompute `UniverseOrigin` in new-frame coordinates; usually triggers an immediate position rebase).
3. **Emit `FSOIChangeEvent`** (§5.2) to physics + rendering + gameplay.
4. Reset `frameVelocity` accounting into the new frame.

```cpp
struct FSOIChangeEvent {
    FEntityId  Entity;        // the observer (generalized: any SimProxy)
    FFrameId   OldFrame;
    FFrameId   NewFrame;
    ECrossing  Direction;     // Entering (descend) | Exiting (ascend)
    double     SimTime;       // SimClock tick time of the crossing
    FUniverseCoord NewFramePos;   // position re-expressed in NewFrame
    FVector3d  NewFrameVel;       // velocity re-expressed in NewFrame
};
```

This is **the** seam in "seamless." It must be silent to the player: no hitch (it's a handful of double ops), no visual pop (rendering re-anchors via the same `OnOriginRebased`).

---

## 3. Active / on-rails SimProxy skeleton

Per D-003, active/on-rails is generalized to **all entities**. For Spike 1 the registry is tiny: **the 3 bodies are always on rails; the observer is always active.** The value of building it now is to **pin the promotion/demotion contract** so physics & factory-sim code against it later.

### 3.1 Modes

- **`OnRails`** — state advanced **analytically** by Δt (here: evaluate the body's closed-form `localOrbit` + `spin` at `t`). No per-tick force integration. This is what makes time-warp and 1M-entity scale possible.
- **`Active`** — state advanced by **full per-tick simulation** owned by the relevant domain (here: the observer's kinematic/Chaos movement). Lives near the floating origin.

### 3.2 Promotion / demotion triggers + hysteresis (R3)

General rule (pinned now, exercised lightly in the spike):

| Transition | Trigger | Hysteresis |
|---|---|---|
| OnRails → **Active** (promote) | entity enters the **active bubble**: `gap(entity, observer) < ACTIVATE_DIST` (default **2 km**) **and** is in the observer's dominant frame | — |
| Active → **OnRails** (demote) | `gap(entity, observer) > DEACTIVATE_DIST` (default **3 km**) **or** leaves dominant frame **or** time-warp engaged | must hold for `DEMOTE_HOLD` (default **2 s**) below threshold |

The **gap between 2 km (activate) and 3 km (deactivate)** plus the **2 s dwell** is the anti-thrash hysteresis: an entity hovering at the boundary cannot flip modes every tick. **Promotion is immediate** (correctness/safety: you must simulate something the player can touch); **demotion is lazy** (cheap to keep simulating a moment longer; expensive to pop). On promotion, `OnRails` analytic state is **handed off** as initial conditions to the Active sim (position+velocity); on demotion, the Active state is **fit back** to an analytic state (for the spike, bodies never promote, so handoff is stubbed but the hooks exist).

#### 3.2.1 Mixed proxy granularity — `gap()` is extent-aware (RC-10)

A proxy is **opaque** to the registry: it is an `ISimProxy` regardless of whether it represents a **point** (physics: one proxy per active vessel — spike2-physics §2) or a **coarse region** (factory-sim FS-7: one proxy per factory *chunk* — spike3-factory-sim §5.4, the whole chunk promotes/demotes together to keep the registry small). The state machine above runs **per-proxy, identical for both** — there is no vessel/chunk branch anywhere in promotion, demotion, or the hysteresis dwell. RC-10 confirms this is sound, with **one extent fix**:

- **The distance test must use the proxy's near edge, not its centroid.** `Position()` alone is a single point. For a *point* proxy (vessel) the centroid **is** the entity, so centroid-distance is exact. For a *coarse* proxy (a chunk spanning tens–hundreds of metres) it is **wrong**: a chunk whose centroid sits 2.5 km out (outside the 2 km activate band) can have its **near edge 200 m from the observer** — entities the player can walk up to would wrongly stay on-rails, violating "promote anything the player can touch." So the bubble test is defined on the **gap to the proxy's bounding extent**:

  ```
  gap(p, observer) = max(0, ‖p.Position() − observerPos‖ − p.PromotionRadius())
  ```

  where `PromotionRadius()` is the proxy's bounding-sphere radius about its `Position()` (0 for a point). Both thresholds (`ACTIVATE_DIST`, `DEACTIVATE_DIST`) compare against this `gap`, so a chunk's band is **inflated by its extent** while a vessel's band is unchanged (radius 0 → `gap == ‖·‖`, the original formula exactly). This is the **only** granularity-aware adjustment; everything downstream (hysteresis gap, 2 s dwell, immediate-promote/lazy-demote, frame check, time-warp demote) is untouched and uniform.

- **`PromotionRadius()` is an additive, defaulted accessor on `ISimProxy`** (§5.3): existing point proxies that don't override it return `0` and behave **exactly** as before (no breaking change; physics need not touch their proxy). Factory-sim overrides it to return the chunk's half-extent (it already carries `StaticDef.AABB bounds` per entity and a chunk AABB — spike3 §1.3). A chunk's bounding-sphere radius is a conservative over-approximation (it promotes slightly early), which is the **safe** direction for the "must simulate what the player can touch" invariant.

- **No coexistence conflict** (point 3): ordering is granularity-independent (the registry iterates proxies in a fixed order — register order / `Id()` — and the per-proxy decision reads only that proxy's `gap` + dwell timer; proxies never interact during the promotion pass). **Hysteresis still holds** because the 2 km/3 km band and 2 s dwell are applied to the *same* `gap` metric for both kinds, so a coarse chunk at its boundary cannot thrash any more than a point can. **No double-promotion:** the active set is keyed by `Id()`; a chunk and a vessel are distinct proxies with distinct ids and disjoint state — promoting one never touches the other. A chunk and a vessel can overlap in *space* without any registry conflict; each is promoted/demoted on its own `gap`. The only ordering subtlety — a vessel that is physically *inside* an on-rails chunk's volume — is fine: they are independent proxies; the vessel promotes on its own point-gap and the chunk on its extent-gap, and factory-sim's chunk content (§5) is what reconciles entities, not the registry.

> Bodies stay OnRails the entire spike (they're never inside the 2 km bubble of a walking player). The observer is registered `Active` and pinned. The registry, the bubble test, and the hysteresis state machine are all built and unit-tested even though only the trivial path runs — that is the de-risking: the *contract* is real, the *content* is stubbed.

---

## 4. SimClock — fixed tick + render interpolation (CE-3)

### 4.1 Fixed-step loop

- **Sim runs at a fixed `TICK_HZ` (default 60 UPS, `dt = 1/60 s`)**, fully decoupled from render FPS.
- Accumulator pattern: each engine frame adds real `frameDelta` to an accumulator; while `accumulator ≥ dt`, run **exactly one fixed sim tick** (advance frames' rails, integrate the active observer, evaluate SOI, evaluate rebase) and subtract `dt`. Clamp max ticks/frame (e.g. 5) to avoid spiral-of-death on a stall.
- **Time-warp** multiplies *sim* time advance per tick (`warp × dt` of universe time advanced), but **Active entities cannot be warped past Chaos stability** → warp is gated by what is Active (core-engine.md §4). In the spike, warp stays 1× while the observer is Active near a body; the field exists and is honored by the rails so the contract is real.

### 4.2 Tick order (deterministic)

```
1. Advance SimClock (simTime += warp·dt)
2. Advance all OnRails proxies analytically to simTime   (bodies)
3. Step Active proxies one fixed dt                      (observer + Chaos sub-step)
4. Resolve SOI for the observer; emit FSOIChangeEvent if changed
5. Evaluate velocity-rebase (subtract frameVelocity if needed)
6. Evaluate position-rebase (shift if past REBASE_RADIUS); ApplyWorldOffset + re-anchor Chaos scene
7. Broadcast OnOriginRebased if a rebase occurred
8. Snapshot transforms for interpolation (store prev + curr)
```

### 4.3 Render interpolation (decoupled FPS)

- Render reads `alpha = accumulator / dt` and interpolates each visible transform between its **previous** and **current** fixed-tick snapshot: `lerp(prev, curr, alpha)` (slerp rotation).
- **On a rebased tick**, the `prev` snapshot is re-expressed into the new origin (or interpolation is skipped for that one tick via `rebasedThisTick`) so we never lerp across the teleport — this is what prevents a visible pop at rebase.
- Result: smooth motion at any FPS over a stable 60 UPS sim; the seam between ticks is invisible.

---

## 5. Pinned API contracts (rendering & world-gen code against these)

> These supersede the prose stubs in core-engine.md §5. **Deltas vs. the §5 documentation are flagged at the end of each block.** UE/C++-flavored pseudocode; names are the contract.

### 5.1 `UniverseCoord` — 64-bit position authority

```cpp
// 64-bit position, ALWAYS interpreted relative to a ReferenceFrame (frameId).
USTRUCT()
struct FUniverseCoord {
    double X, Y, Z;          // meters, double precision (CE-4 authority); int64 fixed-point deferred (R2)
    FFrameId Frame;          // which ReferenceFrame these coords are in

    // Project into engine (UE world) space given the current floating origin.
    // Result is a small 32-bit FVector safe for GPU/Chaos.
    FVector  ToEngine(const FFloatingOrigin& O) const;          // (this - O.UniverseOrigin) in O's frame
    static FUniverseCoord FromEngine(const FVector& Local, const FFloatingOrigin& O);

    // Re-express these coords into a different frame at a given sim time (SOI crossing).
    FUniverseCoord InFrame(FFrameId Target, double SimTime) const;

    FUniverseCoord operator+(const FVector3d& deltaMeters) const;
    FVector3d      operator-(const FUniverseCoord& other) const;  // both re-expressed to a common frame first
};
```
*Delta vs §5:* §5 listed "`UniverseCoord` (64-bit) + conversion to/from local render/physics space" — now **made concrete**, and **`Frame` is now part of the type** (a coord is meaningless without its frame). `ToEngine/FromEngine` take an explicit `FFloatingOrigin`. **Rendering & world-gen: a `UniverseCoord` is not a bare double3 — it carries its frame.**

### 5.2 `ReferenceFrame` — frame hierarchy + SOI

```cpp
USTRUCT()
struct FReferenceFrame {
    FFrameId Id;
    FFrameId Parent;             // INVALID for the star/root
    FKeplerRail LocalOrbit;      // position in PARENT frame at time t (spike: circular)
    FBodySpin   Spin;            // axis, period, phase0  (surface co-rotation)
    double      Mu;              // gravitational parameter (physics uses later)
    double      SoiRadius;       // meters; containment test for dominance

    // Frame -> universe(root) transform at sim time t (composes the parent chain).
    FFrameTransform ToUniverse(double SimTime) const;
    // Relative transform from this frame to Other at time t (used to re-express coords/velocity).
    FFrameTransform RelativeTo(FFrameId Other, double SimTime) const;
};

// Owned by core-engine; queried by physics/rendering/world-gen.
class IFrameGraph {
    virtual const FReferenceFrame& Get(FFrameId) const = 0;
    virtual FFrameId DominantFrame(const FUniverseCoord& Pos, double SimTime) const = 0; // deepest SOI hit
    // SOI crossing events for any tracked entity (observer in the spike).
    virtual FOnSOIChange& OnSOIChange() = 0;   // broadcasts FSOIChangeEvent (see §2.3)
};
```
*Delta vs §5:* §5 promised "`ReferenceFrame` API + SOI-change events" — now concrete. **`FSOIChangeEvent` carries re-expressed position AND velocity in the new frame** (§2.3) — physics needs both at a crossing; flag this to physics.

### 5.3 `SimProxy` — active/on-rails registration

```cpp
UENUM() enum class ESimMode : uint8 { OnRails, Active };

class ISimProxy {
public:
    virtual FEntityId Id() const = 0;
    virtual ESimMode  Mode() const = 0;
    virtual FFrameId  Frame() const = 0;

    // OnRails: advance analytic state to absolute sim time.
    virtual void EvalOnRails(double SimTime) = 0;
    // Active: step full sim by one fixed dt.
    virtual void StepActive(double Dt) = 0;

    // Handoff hooks (owned by the entity's domain; core-engine calls them on transition).
    virtual void OnPromote(const FRailState& from) = 0;   // rails -> active: seed ICs
    virtual FRailState OnDemote() const = 0;              // active -> rails: fit analytic state

    virtual FUniverseCoord Position() const = 0;
    virtual FVector3d      Velocity() const = 0;          // TRUE universe-frame velocity

    // Bounding-sphere radius about Position() (meters). Lets the bubble test (§3.2.1) use the
    // proxy's NEAR EDGE for coarse/extended proxies. DEFAULT 0 → a point proxy behaves exactly
    // as before (gap == ‖Position()−observer‖). Override for region-granular proxies (factory chunks).
    virtual double PromotionRadius() const { return 0.0; }   // RC-10: mixed granularity
};

// Core-engine owns the registry, the bubble test, and the hysteresis state machine (§3.2, §3.2.1).
class ISimRegistry {
    virtual void Register(ISimProxy*) = 0;
    virtual void Unregister(FEntityId) = 0;
    // Uses gap(p,observer) = max(0, ‖p.Position()−observerPos‖ − p.PromotionRadius()) per proxy (§3.2.1).
    virtual void TickPromotions(const FUniverseCoord& observerPos, double SimTime) = 0;
};
```
*Delta vs §5:* §5 promised "`SimProxy` registration + Active/OnRails promotion/demotion hooks" — now concrete. **Promotion/demotion is core-engine's; the *content* of each mode (`EvalOnRails`/`StepActive`/`OnPromote`/`OnDemote`) is the owning domain's** (physics, factory-sim). Flag to physics & factory-sim: implement `ISimProxy` for your entities. **RC-10 (mixed granularity, §3.2.1): added a defaulted `PromotionRadius()` accessor so a coarse chunk proxy's activation band reflects its spatial extent; point proxies (vessels) inherit `0` and are unaffected — additive, non-breaking. Physics need not change; factory-sim overrides it to return the chunk half-extent.**

### 5.4 `SimClock` — fixed tick + warp + interpolation alpha

```cpp
class ISimClock {
public:
    virtual double SimTime() const = 0;      // absolute universe time (seconds)
    virtual double FixedDt() const = 0;      // 1/TICK_HZ
    virtual double Warp() const = 0;         // time-warp factor (1.0 in spike)
    virtual double Alpha() const = 0;        // render interpolation [0,1): accumulator/dt
    virtual uint64 TickIndex() const = 0;    // monotonic fixed-tick counter (determinism/replication)

    virtual void  RequestWarp(double factor) = 0;   // gated by active-set stability
    virtual FOnFixedTick& OnFixedTick() = 0;        // sim domains subscribe

    // --- CE-8 (C-7) save-quiesce handle (additive, non-breaking) -----------------
    // Capture a CONSISTENT cross-domain snapshot at a tick boundary. The clock parks
    // sim advance at end-of-tick N (after step 8 of §4.2, before the next tick begins),
    // calls `body` exactly once with the frozen TickIndex N, then resumes. While `body`
    // runs, NO domain advances — every domain reads state stamped with the SAME N, so
    // there is no torn read across domains (the persistence ask, persistence-phase1 §4.2/§7).
    // `body` must be synchronous, must not advance the sim, and should only READ.
    // Returns the TickIndex N at which the world was quiesced (== `out.savedTickIndex`).
    virtual uint64 QuiesceAtTickBoundary(TFunctionRef<void(uint64 /*quiescedTick*/)> body) = 0;
};
```
*Delta vs §5:* §5 promised "`SimClock` (fixed tick, current warp factor, interpolation alpha)" — delivered, **plus `TickIndex()`** (determinism/replication, D-004) and **`QuiesceAtTickBoundary()`** (CE-8 / C-7, the save-quiesce handle). Both are **pure additions** — no existing signature changed; existing callers are unaffected.

#### 5.4.1 `QuiesceAtTickBoundary` — the cross-domain snapshot guarantee (CE-8 / C-7)

Persistence (persistence-phase1 §4.2 step 1, §7 "save-quiesce boundary") needs every domain to snapshot at the **same** `TickIndex` so a save has no torn read (e.g. factory state from tick N while the craft orbit is from tick N+1). Core-engine owns the only authority that can enforce this — the fixed-tick loop (§4) — so the handle lives on `ISimClock`.

**Mechanism (rides the §4.2 deterministic tick order):**
1. The clock finishes the current tick **N** fully (all 8 steps of §4.2 complete: rails advanced, active stepped, SOI resolved, rebase evaluated, transforms snapshotted). The world is now in a complete, self-consistent state stamped `TickIndex()==N`.
2. **Before** the accumulator runs tick N+1, the clock invokes `body(N)`. Sim advance is **parked**: `SimTime`/`TickIndex` do not change, no `OnFixedTick` fires, no rail/active step runs, no rebase mutates transforms. Render interpolation may keep drawing the last snapshot (read-only) — quiesce freezes the *sim*, not the frame.
3. Inside `body`, persistence walks every domain's `IPersistable.SaveDiffs(...)` (§2.1 / §4.2 steps 4–5). Every domain reads its state as of tick N — guaranteed, because nothing advanced it.
4. When `body` returns, the clock resumes: the accumulator continues from where it parked (it does **not** fast-forward to make up wall-clock time spent saving — a save is not a time-warp; this mirrors persistence's `snapshotTick` rebase rule, persistence-phase1 §4.4).

**Guarantees (the contract):**
- **Single-tick consistency:** every read inside `body` observes state at exactly `TickIndex()==N`. No domain is mid-advance.
- **No torn read across domains:** because advance is parked, the read order across domains is immaterial — core-engine, world-gen, physics, factory-sim, gameplay all see the identical N. This is precisely what persistence's load-order dependency (§4.5) assumes.
- **Determinism preserved:** quiescing changes no sim state and consumes no sim time, so the resumed timeline is bit-identical to one that never quiesced (replay/replication safe, D-004).
- **Call-site discipline:** `body` must be synchronous and read-only w.r.t. sim state. It is core-engine's contract that the handle is invoked **from the sim thread at an end-of-tick boundary** (persistence calls it as the first step of `Save`). It is *not* a general "pause button" for gameplay — `RequestWarp(0)` is the player-facing pause; `QuiesceAtTickBoundary` is the persistence snapshot fence.

> Spike-1 scope: the spike has one Active proxy (the observer) and three OnRails bodies, so a quiesce is trivially consistent already; the handle is **built and unit-tested now** (assert `TickIndex` is unchanged across the call and identical inside `body`) so persistence (Phase 1) and replication (D-004) code against a real fence, not a stub. This mirrors the §3 discipline: the *contract* is real, the heavy *content* (multi-domain save) lands in Phase 1.

> **Floating origin** is exposed as a small read-only struct that consumers pass to `ToEngine/FromEngine`:
> ```cpp
> struct FFloatingOrigin { FUniverseCoord UniverseOrigin; FFrameId Frame; FOnOriginRebased& OnRebased(); };
> ```

### 5.5 `FChunkKey.RegionDepth` — save-region ↔ factory-chunk granule (CE-9 / C-8)

Persistence keys every save region by truncating world-gen's `FQuadKey` to a fixed coarse depth `RegionDepth` (persistence-phase1 §3.1: `FChunkKey` is a **path-prefix** of `FQuadKey` — `truncate(FQuadKey, RegionDepth)`, closed-form, no lookup). The ask (persistence-phase1 §3.2): pick `RegionDepth` so **one save region ≈ one factory-chunk `ISimProxy`** — i.e. a save region's surface span ≈ a factory chunk's extent, so the promote/demote bubble (§3.2/§3.2.1) that flushes/loads chunks aligns 1:1 with the persistence region granule.

**Region span vs depth (from world-gen's `FQuadKey` + body radii, spike1-worldgen §1.1–1.2, §5).** A cube face uses the **tangent (equal-angle) warp** (WG-5), so a depth-0 face edge subtends `π/2` rad of arc; a region edge at depth `d` is `R·(π/2)/2^d` of surface arc. Computed (R: Forge 600 km, Cinder 200 km — spike1-worldgen §5.1/§5.2):

| depth | **Forge** region edge (R=600 km) | **Cinder** region edge (R=200 km) |
|---|---|---|
| 8  | 3,682 m | 1,227 m |
| 9  | **1,841 m** | 614 m |
| 10 | 920 m | 307 m |
| 11 | 460 m | 153 m |

**Chunk extent — CONFIRMED by factory-sim (E ≈ 1 km).** factory-sim registers one `ISimProxy` per factory *chunk* (FS-7, spike3 §5.4) and has confirmed its chunk extent as **≈ 1 km on a side** (spike3 §11.4). It comfortably holds a slice-scale machine cluster (hundreds of entities at grid-snap density) while staying inside the 2 km activate bubble (§3.2), and maps cleanly onto a quadtree region. *(This supersedes the earlier ~256 m placeholder, which gave 11/9 and whose Cinder digit was itself off — 256 m → Forge 11 / Cinder 10.)*

**DECISION CE-9 — `RegionDepth` is per-body, chosen so each region edge is the smallest value ≥ the confirmed ~1 km chunk extent (region ⊇ chunk, with margin so a chunk rarely straddles 4 regions). Locked per PHASE1-PLAN §10, 2026-06-14 (reconciled per the 2026-06-14 review):**

| Body | `RegionDepth` | Region edge | Region/chunk ratio (~1 km chunk) | Region **half-extent** (Forge/Cinder radii, for §3.2.1 `PromotionRadius`) |
|---|---|---|---|---|
| **Forge** (R=600 km) | **9** | **≈ 1,841 m** | ≈ 1.8× | ≈ 920 m |
| **Cinder** (R=200 km) | **8** | **≈ 1,227 m** | ≈ 1.2× | ≈ 614 m |

- **Why per-body depth:** `FChunkKey.RegionDepth` is a `uint8` carried *per key* (persistence-phase1 §3.1), so each body picks its own. Cinder is 3× smaller in radius than Forge, so the **same surface span** needs a depth **1 shallower** on Cinder. Depths 9/8 keep the *absolute* region span comparable across bodies (≈1227–1841 m) — both ≈1.2–1.8× a ~1 km chunk — which is the alignment persistence wants (one region ≈ one chunk proxy, not one region = thousands of micro-files nor one region = the whole factory).
- **This corrects persistence's placeholder guess of "coarse depth 5–6 (regions a few km across)"** (persistence-phase1 §3.1). Depth 5–6 was sized to *swallow the whole slice factory in one file*; but the pinned ask in §3.2 is **region ≈ chunk proxy** (the promote/demote granule), which is ~1 km, landing at depth 9/8 — finer. At slice scale this still yields only a handful of dirty region files (the factory is small), so the "few-files" property persistence wanted is preserved; the granule is just correctly aligned to the chunk proxy rather than to the whole factory.
- **Tie-in to §3.2.1 (mixed proxy granularity):** a factory chunk's `PromotionRadius()` (its half-extent ≈ 500 m for a ~1 km chunk) and the save region's half-extent (≈920 m Forge / ≈614 m Cinder) are the *same order of magnitude* and the region ⊇ chunk — so a chunk demoted by the bubble flushes exactly one region (persistence-phase1 §3.2). The extent-aware `gap()` test already promotes the chunk slightly early (conservative), which keeps "load the region before factory-sim reconstructs" correct.

> **RECONCILED — factory-sim confirmed its chunk extent E ≈ 1 km; Admin locked the values (this was C-8's joint pick).** Per body, `RegionDepth(body) = floor( log2( R_body·(π/2) / E ) )` (smallest depth with region edge ≥ E). For E ≈ 1 km this gives **Forge 9 / Cinder 8** (above; locked per PHASE1-PLAN §10, 2026-06-14). **No core contract changes** — `RegionDepth` is a *value* in persistence's `FChunkKey`, derived from world-gen's `FQuadKey` depth scale that I've pinned here; only the chosen integer per body moves.

---

## 6. Step-by-step UE5 build plan

Built in waves so world-gen (parallel) and rendering (Wave 2) can hook in at defined seams.

### Wave 0 — Foundations (core-engine only)
1. **Project setup:** UE5 C++ project, **LWC enabled** (default in 5.x), Chaos default. Confirm `WITH_LARGE_WORLD_COORDINATES`.
2. **`SimClock`** (§5.4): accumulator fixed-tick loop in a `UGameInstanceSubsystem` (or world subsystem); `OnFixedTick` broadcast; interpolation `Alpha`. **Validate first** with an on-screen UPS/FPS counter showing 60 UPS stable while FPS varies.
3. **`UniverseCoord` + `FFloatingOrigin`** (§5.1): the 64-bit type and `ToEngine/FromEngine`. Unit tests for round-trip precision at 10⁹ m.
4. **`ReferenceFrame` / `IFrameGraph`** (§5.2): build the Star→Planet→Moon graph with circular rails + spin. Unit-test `ToUniverse`/`RelativeTo` continuity.

### Wave 1 — Floating origin + frames live
5. **Floating-origin rebaser** (§1): position rebase via `ApplyWorldOffset(-D)` on rebasable actors **+ Chaos `FPhysScene` re-anchor**; `OnOriginRebased` broadcast; `rebasedThisTick` flag into interpolation.
6. **Velocity-frame (Krakensbane) rebaser** (§1.5): maintain `frameVelocity`; subtract from the active observer above `VEL_REBASE`; bleed to zero when grounded.
7. **Observer pawn:** a simple controllable observer (character controller for walking; free-fly "craft" mode for ascent — *not* a real vehicle). Registered `Active` via `SimProxy`. Camera parented so it lands near origin every rebase.
8. **Bodies as `OnRails` SimProxies:** planet + moon advance on rails each tick. Placeholder collision: a UE sphere/landscape per body sized for the demo (world-gen supplies real minimal terrain when ready; until then a primitive sphere collider).
9. **SOI resolver** (§2.2–2.3): per-tick dominant-frame test for the observer; `FSOIChangeEvent` on change; re-express coord+velocity + re-anchor origin into the new frame.

### Wave 2 — Seams for rendering (rendering domain consumes contracts)
10. **Publish the four contracts** and the two events (`OnOriginRebased`, `OnSOIChange`) as the rendering hook points. Rendering builds scaled-space dual-camera + log-depth against these (their domain). Core-engine provides a placeholder single-camera so the demo runs before rendering lands.

### The demo flow (what you actually fly)
Spawn on the planet surface (walking, co-rotating with `Spin`) → switch to free-fly craft → ascend through `REBASE_RADIUS` rebases (watch them fire) → cross past planet `SoiRadius` is *not* hit (we go to the moon, child frame) → translate toward moon, **enter MoonFrame SOI** (event fires) → descend, `frameVelocity` bleeds out, walk on the moon. **No loading screen anywhere.**

### 6.1 Validation steps — proving seamlessness (the acceptance gates)

| # | What to prove | How | Pass criteria |
|---|---|---|---|
| V1 | Sim/render decoupled | Cap & vary FPS (20–144) with 60 UPS | Motion smooth at all FPS; UPS pinned 60; no judder |
| V2 | Rebase is invisible | Log every rebase; record framerate + a high-contrast static reference mesh near origin | **Zero frame hitch** (no spike in frametime graph) and **zero visible pop** at each rebase |
| V3 | Precision holds at distance | Walk/strafe at 10⁹ m authority distance; inspect a 1 cm reference object | **No vertex/jitter wobble**; sub-cm stable (engine coords stay < REBASE_RADIUS) |
| V4 | High-velocity stability (R1 core) | Free-fly to 3 km/s, hold, then collide/land | **No Chaos "kraken"** (no explosive velocities, no tunneling); residual physics-space speed stays bounded by frameVelocity subtraction |
| V5 | SOI crossing seamless | Fly planet→moon across the boundary | `FSOIChangeEvent` fires once; **no teleport, no hitch**; velocity continuous (matches patched-conics expectation) |
| V6 | Full traversal | Run the whole walk→orbit→land flow end-to-end | Completes with **no loading screen, no hitch, no wobble, no kraken** across the entire run |
| V7 | No thrash | Sit the observer at a body boundary; jitter position | SimProxy modes do **not** oscillate (hysteresis holds) |

Instrument with UE's `stat unit` / frametime CSV + a logged rebase/SOI timeline so V2/V4/V5 are *measured*, not eyeballed.

---

## 7. Risk retirement — R1 pass/fail (decides D-001)

**R1:** *Does UE5 LWC + Chaos behave well under aggressive floating-origin rebasing at speed?*

This spike attacks R1 from three angles simultaneously:
- **Precision** (LWC authority is enough, engine-space stays small) → V3.
- **Rebase coherence** (Actor shift + Chaos scene re-anchor stay in lockstep; no solver/actor divergence) → V2, V4.
- **Velocity stability** (frame-velocity subtraction keeps Chaos sub-orbital even at 3 km/s) → V4, V5.

### Pass / fail criteria

**R1 PASSES → D-001 (UE5) confirmed** if **all** hold:
- V2: rebasing produces **no measurable frame hitch** (frametime spike < ~2 ms over baseline) and **no visible pop**.
- V3: **no precision wobble** at ≥10⁹ m authority distance (sub-cm stable).
- V4: **no Chaos instability** at ≥3 km/s through rebases and on landing impact (no NaN/explosion/tunnel; residual speed bounded).
- V5: SOI crossing is **continuous and hitch-free**.
- V6: full traversal completes seamlessly.

**R1 FAILS → escalate, revisit D-001** if any of:
- Chaos bodies destabilize when the `FPhysScene` is re-anchored mid-flight (solver can't tolerate origin shifts), **and** no workaround (e.g. detaching the active body from the shifted scene) holds → UE5 Chaos is unfit → consider **Unity/DOTS + custom double layer** or **custom engine** (MASTER_PLAN §4 alternatives).
- LWC + our rebase still wobbles (UE's render/material pipeline can't be re-anchored cleanly) → D-001 at risk.
- Per-tick rebasing at speed costs enough to break the 60 UPS budget → architectural rethink of rebase cadence.

**Partial pass** (precision fine, Chaos shaky) → narrower escalation: keep UE5 for coords/render, **replace Chaos with a custom/decoupled physics layer for the active vessel** (a Spike-2 / physics-domain decision). This is the most likely realistic outcome and worth calling out to Admin.

---

## 8. Dependencies & cross-domain notes (for Admin)

- **world-gen (parallel):** needs `UniverseCoord` (with frame) + `OnOriginRebased` to place/re-anchor its minimal terrain tiles. Body colliders are placeholder primitives until world-gen's minimal terrain lands. **They must store tile centers as `UniverseCoord`, not `FVector`.**
- **rendering (Wave 2):** consumes all four §5 contracts + `OnOriginRebased` + `OnSOIChange`. Scaled-space dual-camera, log-depth, and surface↔space visual blend are theirs; core-engine ships a placeholder single camera so the demo runs first.
- **physics (Spike 2):** `ISimProxy.StepActive/EvalOnRails/OnPromote/OnDemote` is the hook for the real rigid-body craft + patched-conics. `FSOIChangeEvent` gives them position **and** velocity re-expressed in the new frame. **Most likely R1 escalation lands in their lap** (Chaos-vs-custom for the active vessel).
- **networking (D-004):** `TickIndex()` + the deterministic tick order (§4.2) + server-authoritative SimProxy are the replication seams. Not implemented in the spike; the shape is preserved.
- **persistence (Phase 1 — consumes two NEW core-engine items, both pinned above; closes Phase-1 contracts C-6/C-7/C-8):**
  - **C-7 — `ISimClock::QuiesceAtTickBoundary` (§5.4 / §5.4.1):** the save-quiesce fence. Persistence calls it as `Save` step 1 (persistence-phase1 §4.2) to snapshot every domain at one `TickIndex` with no torn read. **Additive `ISimClock` method — no break.**
  - **C-8 — `FChunkKey.RegionDepth` (§5.5, CE-9):** **Forge depth 9 (≈1841 m region), Cinder depth 8 (≈1227 m region)**, under factory-sim's **confirmed ~1 km factory-chunk extent** (locked per PHASE1-PLAN §10, 2026-06-14; was 11/9 under a 256 m placeholder). `FChunkKey` = a coarse **prefix** of world-gen's `FQuadKey` truncated to `RegionDepth`. **Reconciled: factory-sim confirmed E ≈ 1 km; depth = `floor(log2(R·(π/2)/E))` per body.** No core contract change — only the chosen per-body integer moves.
  - **C-6 (core-engine side) — `IPersistable` confirmed:** core-engine implements persistence's `IPersistable` (DomainId `CoreEngine`, GLOBAL record) and serializes exactly the **regeneration anchors** (NOT user diffs): `worldSeed` + the active observer's authoritative `FUniverseCoord`+`FFrameId` + `SimTime`/`TickIndex` at save + the floating-origin `UniverseOrigin`+`Frame`. Read **first** / baseline established **last** on load (persistence-phase1 §2.1, §4.5). All fields already exist on the §5 contracts — no contract change, only an `IPersistable` impl over them.
```
