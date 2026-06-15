# Spike 2 — Physics & Orbital Mechanics: Patched Conics + One Rigid-Body Craft

> **Domain:** Physics & Orbital Mechanics (lead) · **Phase:** 0 · **Spike:** 2 · **Status:** Designed, ready to build · **Last updated:** 2026-06-14
> **Owner:** `physics-controller` · Read alongside: [physics.md](../controllers/physics.md) · **[Spike 1 core-engine](spike1-core-engine.md)** §1–§5 (the pinned frame/SimProxy/clock contracts + CE-6 velocity subtraction) · **[Spike 1 world-gen](spike1-worldgen.md)** §4–§5 (terrain queries + `FBodyParams`) · [spike1-PLAN](spike1-PLAN.md) §2,§5,§6 (canonical bodies, acceptance loop, RC-3/RC-4) · [MASTER_PLAN](../MASTER_PLAN.md) §6,§11 (D-002, D-006)
> **Co-domains:** core-engine (consumed — frames, SimProxy, clock, SOI events) · world-gen (consumed + ONE additive request, RC-3) · gameplay/persistence/networking (provided — orbital state)

---

## 0. Purpose & the one question this spike answers

Prove that **patched-conics orbital flight + ONE rigid-body craft is stable and seamless inside core-engine's active/on-rails framework**: a multi-part craft launches from **Forge**, reaches orbit, coasts at orbital speed (~3 km/s), crosses into **Cinder's** SOI, and lands — with no orbit drift, no on-rails↔active handoff pop, and **no Chaos "kraken."**

The headline this spike must deliver is **RC-4** (spike1-PLAN §6): *given core-engine's CE-6 Krakensbane velocity subtraction, does UE5 Chaos survive floating-origin rebasing at orbital speed for the **active vessel**, or do we need a custom integrator?* Spike-1 (core-engine §7) flagged this as the **most likely partial-pass outcome** and put the decision in our lap. §4 resolves it.

**Non-goals (hard scope fence):** no factory; no full aerodynamics model beyond a single-drag-coefficient atmosphere pass on Forge; no re-entry heating; no maneuver-node UI (gameplay owns the map view — we provide the predicted-trajectory *data*); no n-body (D-002); two bodies only (Forge + Cinder, D-006); one craft of a small handful of parts; single-player.

We **consume** core-engine's and world-gen's pinned contracts verbatim — we do not redefine them. The only new outbound interface is **orbital state → gameplay/persistence/networking**; the only inbound *request* is one additive field on world-gen's terrain query (RC-3, §5).

---

## 1. Patched-conics propagator

### 1.1 Decision PH-3 confirmed: on-rails state is a Keplerian element set

An on-rails vessel (or any on-rails body) is, in its **dominant frame**, a closed-form two-body conic about that frame's central mass `μ`. We store it as a **classical orbital element set** plus an epoch:

```cpp
USTRUCT()
struct FOrbitalElements {
    FFrameId Frame;       // the central body's frame (μ comes from FReferenceFrame.Mu / FBodyParams.Mu)
    double   SemiMajorA;  // a  (m)            — negative for hyperbolic (e>1)
    double   Ecc;         // e  (0..; 1 = parabolic edge case clamped, see 1.4)
    double   IncRad;      // i  (rad)
    double   LanRad;      // Ω  longitude of ascending node (rad)
    double   ArgPeRad;    // ω  argument of periapsis (rad)
    double   MeanAnomEpoch; // M0 mean anomaly at Epoch (rad)
    double   Epoch;       // SimClock time at which M0 holds (s)
    double   Mu;          // cached central μ (= frame's body μ) for propagation without a frame lookup
};
```

**Why classical elements (not state vectors) for the rail:** `a, e, i, Ω, ω` are *constant* under two-body motion; only the anomaly advances. Advancing the orbit is therefore advancing **one scalar** (mean anomaly) and solving Kepler's equation — trivially cheap, exact, and time-warp-proof. State vectors would force a numerical integrator and reintroduce drift, defeating the whole on-rails point (MASTER_PLAN §6; KSP/Krakensbane research: "use Kepler's equation to move bodies as a function of time… far less CPU than mutual gravitational interactions").

> Internally we round-trip through **state vectors** `(r, v)` at the frame boundaries (park/resume, SOI crossing) because core-engine's contracts traffic in `FUniverseCoord` position + `FVector3d` velocity (spike1-core-engine §5.1, §2.3). `Elements ↔ (r,v)` conversions are the standard astrodynamics transforms (§1.5).

### 1.2 Analytic advance (incl. under time-warp) — universal-variable Kepler solve

To get position/velocity at any `SimTime t`:

```
M(t)  = M0 + n·(t − Epoch),   n = sqrt(μ / |a|^3)            // mean motion
E(t)  = solveKepler(M, e)                                    // eccentric/hyperbolic anomaly
(r,v) = elementsToState(a,e,i,Ω,ω, E, μ)
```

**Solver choice — universal variables, not branch-per-conic.** We use the **universal-variable formulation** (Stumpff functions `C(z), S(z)`) which solves elliptic, parabolic, and hyperbolic orbits with **one Newton iteration loop on a single universal anomaly χ**, no special-casing per conic type ([Universal variable formulation, Wikipedia](https://en.wikipedia.org/wiki/Universal_variable_formulation); [MathWorks Orbit Propagator Kepler (unperturbed)](https://www.mathworks.com/help/aeroblks/orbitpropagatorkeplerunperturbed.html)). This matters because a craft on an **escape/transfer trajectory between Forge and Cinder is hyperbolic** in at least one frame during the spike's flight, and we must not have a separate, separately-buggy code path for it. Newton converges in 3–5 iterations to double precision; a Laguerre fallback handles high-`e` robustness.

**Under time-warp:** advancing is *literally just evaluating the closed form at the warped `SimClock.SimTime()`*. core-engine's clock advances `simTime += warp·dt` per tick (spike1-core-engine §4.1); the on-rails propagator reads `SimTime()` and evaluates — there is **no per-tick integration to blow up at high warp**. This is the core reason D-002 (patched conics) exists: time-warp is free for on-rails entities. `EvalOnRails(SimTime)` (spike1-core-engine §5.3) is implemented as exactly the three lines above.

> **Determinism note (networking, D-004):** the Kepler solve is a pure function of `(elements, SimTime)`. Given the same `TickIndex()`/`SimTime` it yields bit-stable results within a platform; cross-platform determinism is a Phase-3 concern (R-net), but the *shape* (pure, stateless, time-addressable) is already replication-friendly.

### 1.3 SOI-crossing detection (analytic, look-ahead)

Patched conics = the craft feels gravity from **exactly one body** (its dominant frame's central body). A crossing happens when the craft's distance to a **child** body's center drops below that child's `SoiRadius` (descend, e.g. Forge→Cinder), or its distance to the **current** central body exceeds that body's `SoiRadius` (ascend, e.g. Cinder→Forge).

Two detection layers:

1. **core-engine owns the authoritative per-tick test.** `IFrameGraph::DominantFrame(pos, SimTime)` returns the deepest frame whose SOI contains the position (spike1-core-engine §2.2, §5.2). When it changes between ticks, core-engine emits **`FSOIChangeEvent`** with position **and** velocity already re-expressed in the new frame (spike1-core-engine §2.3). **We consume this — we do not run our own dominance test for the live craft.** This keeps a single source of truth for "which frame am I in" and avoids the classic patched-conics bug of physics and the frame graph disagreeing about the SOI at the boundary.

2. **Physics owns predictive crossing for the trajectory/UI.** For the *predicted* forward trajectory (so gameplay's map can draw "you will enter Cinder's SOI at T+412 s"), we propagate the conic analytically and **root-find the SOI intersection**: solve for the time `t*` where `‖r_craft(t) − r_childBody(t)‖ = SoiRadius_child`, where `r_childBody(t)` is the child's own on-rails conic. This is a 1-D root find on a smooth function (bisection bracketed by a coarse march, then Newton) — the standard patched-conic SOI-intersection computation ([poliastro: Patched-conics computations](https://github.com/poliastro/poliastro/wiki/Patched-conics-computations); [ScienceDirect: Patched Conic overview](https://www.sciencedirect.com/topics/engineering/patched-conic)). The predicted crossing is **advisory** (drives UI + warp-to-SOI); the **actual** frame switch is still driven by core-engine's per-tick `OnSOIChange` so prediction error can never desync the sim.

> **SOI model (spike):** geometric sphere of influence using `FBodyParams.SoiRadiusM` / `FReferenceFrame.SoiRadius` (Forge 8.4e7 m, Cinder 2.4e6 m per D-006). This matches core-engine's spike rule (§2.2) exactly. The physically "correct" SOI `r_soi ≈ a·(m/M)^(2/5)` ([arXiv 2205.09340](https://arxiv.org/pdf/2205.09340)) is a Phase-1 tuning of the *constant*, not a model change — the patched-conic machinery is identical.

### 1.4 The frame switch — consuming `OnSOIChange` (pos + vel)

On the `FSOIChangeEvent`, the craft (whether active or on-rails at that instant) does:

```cpp
void OnSOIChange(const FSOIChangeEvent& E) {       // physics subscribes to IFrameGraph::OnSOIChange()
    // E.NewFramePos / E.NewFrameVel are ALREADY re-expressed into NewFrame by core-engine (§2.3).
    // Position & velocity are continuous; the velocity gains/loses the relative orbital velocity
    // of the two frames automatically — exactly the patched-conics velocity discontinuity-free patch.
    if (Mode() == ESimMode::OnRails) {
        // Re-derive a fresh conic in the NEW central body's μ from the re-expressed state vector:
        Elements = stateToElements(E.NewFramePos.ToBodyCentric(),  // r relative to new central body
                                   E.NewFrameVel,                  // v in new frame
                                   FrameGraph.Get(E.NewFrame).Mu,
                                   SimClock.SimTime());            // new Epoch
    } else { // Active: the rigid-body integrator just keeps integrating in the new frame.
        ActiveState.Frame = E.NewFrame;                            // gravity source switches to new μ
        // r,v unchanged in value (already re-expressed); the integrator now pulls toward the new body.
    }
}
```

The crucial correctness point: **we never recompute the velocity discontinuity ourselves.** core-engine guarantees `E.NewFrameVel` already includes the relative orbital velocity of the two frames (spike1-core-engine §2.3: "the observer's velocity gains the Moon's orbital velocity relative to the Planet, exactly as in patched conics"). So an on-rails craft entering Cinder's SOI gets a clean hyperbolic capture conic in Cinder's frame with no manual frame-velocity bookkeeping. This is the single biggest place patched-conics implementations go wrong, and core-engine's contract has already de-risked it for us.

### 1.5 Elements ↔ state-vector transforms (the conversion library)

A small, unit-tested, pure module (`FConics`):

- `stateToElements(r, v, μ, t) → FOrbitalElements` — compute specific angular momentum `h = r×v`, eccentricity vector `e = (v×h)/μ − r̂`, energy `ε = v²/2 − μ/r` → `a = −μ/2ε`; derive `i, Ω, ω, M0`. Handles `e≥1` (hyperbolic) and near-zero `e`/`i` degeneracies (equatorial/circular) with the standard fallbacks.
- `elementsToState(elements, t) → (r, v)` — universal-variable propagate to `t`, return position/velocity in the frame.
- `solveKepler(M, e)` / universal `solveUniversal(χ; r0,v0,Δt,μ)` — Newton + Laguerre fallback, Stumpff `C/S`.

These are the only place trig/`sqrt` orbital math lives; everything else passes `FOrbitalElements` or `(r,v)` `FUniverseCoord`s around.

---

## 2. On-rails ↔ active conversion (implementing `ISimProxy`)

The craft is a `ISimProxy` (spike1-core-engine §5.3). core-engine owns the registry, the 2 km/3 km bubble test, and the 2 s demote hysteresis (spike1-core-engine §3.2); **physics owns the *content* of the four hooks.** This is the contract Spike-1 explicitly handed us ("implement `ISimProxy` for your entities").

### 2.1 The four hooks

```cpp
class FCraftSimProxy : public ISimProxy {
    ESimMode      Mode;            // core-engine flips this via promote/demote
    FFrameId      Frame;           // dominant frame (updated by OnSOIChange)
    FOrbitalElements RailOrbit;    // valid when OnRails
    FRigidCraft   Active;          // valid when Active (§3): parts, joints, aggregate r/v/q/ω

    // ON-RAILS: advance the analytic conic to absolute SimTime (§1.2). O(1), warp-proof.
    void EvalOnRails(double SimTime) override {
        auto [r,v] = FConics::elementsToState(RailOrbit, SimTime);
        RailState.Pos = FUniverseCoord{r, Frame};
        RailState.Vel = v;
    }

    // ACTIVE: integrate the rigid craft one fixed dt (§3, §4). Gravity from Frame's μ.
    void StepActive(double Dt) override { Active.Integrate(Dt, FrameGraph.Get(Frame).Mu, /*atmo*/...); }

    // PROMOTE (rails → active): seed the integrator's ICs from the analytic state. NO physics yet —
    // pure handoff of position+velocity+attitude. This is where KSP's load-in wobble is killed (§2.2).
    void OnPromote(const FRailState& from) override {
        Active.SeedFromRail(from.Pos.ToBodyCentric(), from.Vel, RailOrbit, /*attitude=*/lastKnownQuat);
        Active.ZeroInternalStrain();           // joints start at rest length, zero velocity → no wobble
    }

    // DEMOTE (active → rails): FIT a conic to the craft's current CoM state. The craft "parks."
    FRailState OnDemote() const override {
        FVector3d r = Active.CoMPositionBodyCentric();
        FVector3d v = Active.CoMVelocity();
        const_cast<FCraftSimProxy*>(this)->RailOrbit =
            FConics::stateToElements(r, v, FrameGraph.Get(Frame).Mu, SimClock.SimTime());
        return FRailState{ FUniverseCoord{r,Frame}, v };
    }

    FUniverseCoord Position() const override { return Mode==Active ? Active.CoMUniverse() : RailState.Pos; }
    FVector3d      Velocity() const override { return Mode==Active ? Active.CoMVelocity()  : RailState.Vel; } // TRUE universe vel
};
```

### 2.2 Park-to-elements and resume-without-drift (the no-drift guarantee)

**Park (active → rails / `OnDemote`):** fit a conic to the craft's **center-of-mass** `(r, v)` at the instant of demotion. Because two-body motion is exactly the conic through any `(r,v)`, the fit is **lossless** for the CoM trajectory — no integration error, no drift. We discard internal rigid-body state (joint flex, spin of individual parts); the craft on rails is a point following its conic plus a stored attitude. (Bodies in the spike never promote, so their park path is trivial — but the craft exercises it every time the player time-warps.)

**Resume (rails → active / `OnPromote`):** evaluate the conic at the current `SimTime` to get `(r, v)`, seed the integrator, **start all joints at rest length with zero internal velocity** (`ZeroInternalStrain`). This is the explicit fix for **KSP's notorious load-in wobble / "krakening on load,"** where a craft restored from rails has its joints instantaneously stressed and the solver explodes. By seeding a strain-free, zero-relative-velocity initial state and letting joints settle under a few **sub-stepped** ticks before the player regains control (a ~5-tick "settle" ramp), the handoff is smooth. (Research: KJR/autostrut exist precisely because KSP's joint restore is fragile — we avoid the problem at the seam rather than patch it after, [Kerbal Joint Reinforcement](https://github.com/KSP-RO/Kerbal-Joint-Reinforcement-Continued).)

**Continuity invariant (the test, §7 gate G6):** demote-then-immediately-promote must be the identity on CoM `(r, v)` to within solver tolerance. `‖r_after − r_before‖ < ε_pos` and `‖v_after − v_before‖ < ε_vel`. Because park is a lossless conic fit and resume re-evaluates the same conic at the same `SimTime`, the round-trip is exact up to float error — **this is the formal no-drift guarantee.**

### 2.3 Frame-velocity (CE-6) interaction with the rail

When the craft is **Active** at orbital speed, core-engine's CE-6 keeps it near origin and slow in physics space via `frameVelocity` subtraction; `ISimProxy::Velocity()` returns the **TRUE** universe velocity (`physicsSpaceVel + frameVelocity`, spike1-core-engine §1.5, §5.3). **We always fit/propagate the conic from the TRUE velocity**, never the physics-space residual. So CE-6 is invisible to the orbital layer: rails and SOI math see true universe `(r,v)`; Chaos sees the slow residual. This clean separation is what lets the same conic machinery work whether the craft is parked, coasting at 3 km/s, or landing.

---

## 3. Active rigid-body craft

### 3.1 Structure — parts, joints, mass, CoM, thrust

The spike craft is a small stack (e.g. **command pod → fuel tank → engine**, plus 2 landing legs and optional fins) — a handful of parts, enough to exercise multi-body joints, off-axis thrust, and ground contact.

```cpp
struct FPart {
    FVector3f LocalCoM; double MassKg; FInertiaTensor I;   // mass properties
    // attach points to parent/children; engine parts carry thrust; legs/fins carry contact/aero tags
};
struct FRigidCraft {
    TArray<FPart> Parts;
    TArray<FJoint> Joints;     // 6-DOF constraints between adjacent parts (see 3.3)
    // Aggregate (for the conic fit on demote and the floating-origin anchor):
    FVector3d CoMPos, CoMVel;  // true universe (body-centric) — CoM is the SimProxy anchor point
    FQuat     Attitude; FVector3d AngVel;
};
```

- **Mass / CoM / inertia** recomputed when fuel mass changes (engine burns) — CoM shifts as tanks drain, which the integrator must track (affects thrust torque). Aggregate inertia tensor via parallel-axis from per-part tensors.
- **Thrust** applied at each engine part's nozzle position along its thrust axis → produces force **and** torque about the current CoM. Gimbal (optional) rotates the thrust axis for control.
- **The CoM is the craft's `SimProxy` anchor**: the point whose `(r,v)` becomes the conic on demote and which core-engine keeps near the floating origin.

### 3.2 Integration under floating-origin rebasing

The integrator runs in **physics-frame space near the origin** (core-engine keeps it there via position rebase, and sub-orbital via CE-6 velocity subtraction). Each `StepActive(dt)`:

```
1. Compute true universe state from physics-space + frameVelocity (read from core-engine).
2. Gravity: a_grav = −μ · r̂ / r²   (μ from current dominant Frame; r = CoM relative to body center).
   → patched conics: ONE body's gravity, no n-body sum.
3. Atmosphere (Forge only, §3.4): a_drag from density(alt)·v_rel² ; zero on Cinder.
4. Thrust + control torques at engine parts.
5. Joint constraint forces (§3.3).
6. Integrate (semi-implicit / symplectic Euler at fixed dt, sub-stepped — §4).
7. Hand transforms to core-engine; it applies CE-6 subtraction + position rebase at end-of-tick.
```

**Rebasing is transparent to the integrator** because (a) it integrates in physics-frame coordinates that core-engine translates by `−D` coherently (actors **and** the Chaos scene re-anchored together — spike1-core-engine §1.4), and (b) velocities are frame-invariant under the pure-translation rebase, so a rebase mid-step does not perturb the dynamics. The integrator never reads absolute engine coordinates for dynamics — only relative offsets and the true `(r,v)` reconstructed from `frameVelocity`. **This is precisely the property RC-4 must validate (§4): does the *engine's* contact/joint solver also stay coherent across the rebase, or only our integrator?**

### 3.3 Joint-wobble mitigation (the KSP cautionary tale)

KSP's perennial pain is wobbly/exploding multi-part craft because the constraint solver under-resolves stiff joint chains (research: KJR, autostrut, and KSP2 raising `JOINT_RIGIDITY` from 1,500 → 150,000 all exist to fight this — [KJR-Continued](https://github.com/KSP-RO/Kerbal-Joint-Reinforcement-Continued), [autostrut guide](https://umatechnology.org/how-to-auto-strut-in-ksp/)). Our mitigations, layered:

1. **Rigidified part-tree by default.** Adjacent parts are joined by **stiff 6-DOF constraints** with high linear/angular stiffness; small craft behave as a near-rigid body. Flex is opt-in (e.g. designated docking joints), not the default. (This is KSP2's "raise JOINT_RIGIDITY" lesson, applied from the start.)
2. **Auto-strut analogue.** Optionally collapse a rigid sub-tree into a **single compound rigid body** (one inertia tensor) when no joint in it is meant to flex — the cheapest, most stable option, equivalent to KSP's "autostrut to heaviest part." For the spike's near-rigid stack this is the default: the craft integrates as **one rigid body with aggregate mass properties**, and joints exist only to (a) allow staging/separation and (b) model leg suspension on contact.
3. **Fixed-step sub-stepping for the joint solver.** Joints are resolved at a **fixed physics sub-step** (e.g. 2–4 sub-steps per 1/60 s tick) independent of frame rate, so stiffness doesn't blow up at low FPS — UE5 Chaos's **Async Physics Tick** provides exactly this fixed-substep, game-thread-decoupled cadence ([UE5 substepping/Async physics](https://www.aclockworkberry.com/unreal-engine-substepping/), [taming Chaos with async physics](https://dev.to/fgrenoville/taming-chaos-stable-vehicle-suspensions-with-async-physics-in-ue5-319l)).
4. **Strain-free promotion** (§2.2) so the craft never *starts* a session already stressed.

For the spike, default to **option 2** (compound rigid body) — it sidesteps joint instability entirely for the launch→orbit→land flow, while the joint machinery (1, 3, 4) is built and unit-tested for Phase-1 multi-part craft. *Contract real, content minimal* — same discipline core-engine used for SimProxy.

### 3.4 Aerodynamics — Forge atmosphere, none on Cinder

Forge has an atmosphere; Cinder is airless (`FBodyParams.bHasAtmosphere`, D-006). We consume world-gen's **`FAtmosphereProfile`** (spike1-worldgen §5: exponential isothermal, `ScaleHeightM ≈ 5,600 m`, `SeaLevelDensity ≈ 1.2 kg/m³`, `AtmoTopM ≈ 70 km`):

```
ρ(alt) = SeaLevelDensity · exp(−alt / ScaleHeightM),  0 above AtmoTopM   // density(alt)
F_drag = −½ · ρ · |v_rel|² · Cd · A · v̂_rel                              // v_rel relative to rotating atmo
```

- `v_rel` is velocity **relative to the rotating atmosphere** — the atmosphere co-rotates with Forge's `Spin` (spike1-core-engine §2.1), so we subtract the surface rotational velocity at the craft's position. (This is why a rocket on the pad isn't experiencing a 6 h-rotation gale.)
- **Spike fidelity: single `Cd·A` drag per craft + a crude lift on fins.** No per-part aero, no Mach effects, no heating. Enough to make ascent require a gravity turn and to give Forge landings air resistance. Full aero is Phase-1 (physics.md §6 backlog).
- **On Cinder:** `bHasAtmosphere == false` → drag term skipped entirely; landing is pure thrust + gravity (1.63 m/s²), which stresses the low-g touchdown path (spike1-core-engine V4 / spike1-worldgen Cinder note).

---

## 4. RC-4 RESOLUTION (headline) — Chaos vs. custom integrator for the active vessel

### 4.1 The question, framed precisely

Given core-engine's **CE-6** (Krakensbane-style velocity subtraction keeps the active vessel's *physics-space* speed bounded to a few hundred m/s no matter the true orbital speed, spike1-core-engine §1.5): **can UE5 Chaos integrate the active vessel's flight dynamics, or do we need a custom fixed-step integrator?**

### 4.2 What the research establishes

1. **CE-6 removes the velocity problem, not the integration problem.** Krakensbane is explicitly a *coordinate-system workaround*: it shifts the origin and frame velocity so the active vessel is near origin and slow relative to the physics frame — Chaos "never sees a 3 km/s rigid body." Confirmed by KSP's own design (Krakensbane "shifts the reference frame so the active vessel is moving slowly w.r.t. the underlying coordinate system" — [KSP API: Krakensbane](https://anatid.github.io/XML-Documentation-for-the-KSP-API/class_krakensbane.html)). **So contact/CCD/precision at orbital speed are handled by CE-6 + rebasing — this is not where Chaos fails.**
2. **Where engine physics *does* fail is precision-at-distance and orbital force integration.** UE5 LWC meshes **visibly jitter starting at ~3 km from origin, peaking at 10 km** ([Epic forums: LWC wobble for FPS/driving](https://forums.unrealengine.com/t/lwc-large-world-coordinates-do-not-work-for-first-person-shooters-driving-games-wobbly-rendering-artefacts-ue5-only-ue4-works-fine/652748); [Cesium: UE5 precision jitter](https://community.cesium.com/t/ue5-floating-point-precision-jitter-with-lat-lon-doubles/20531)). This is *why* core-engine's `REBASE_RADIUS = 4 km` exists and is correct — but it also means Chaos's solver is only trustworthy in a small near-origin bubble, and **gravity over a 600 km body integrated by Chaos's general solver would accumulate error** that a closed-form/symplectic orbital integrator does not.
3. **Chaos can deliver a fixed, game-thread-decoupled substep.** UE5's **Async Physics Tick** runs Chaos at a constant `dt` independent of frame rate ([UE5 substepping & Chaos](https://forums.unrealengine.com/t/physics-substepping-and-chaos-ue5/559373); [aclockworkberry substepping](https://www.aclockworkberry.com/unreal-engine-substepping/)). So a deterministic fixed step (which orbital integration and stable joints both need) is *available* — but note **`AddCustomPhysics`/per-substep force callbacks changed under Chaos** (Chaos calls the callback once, not per substep — [Bullet-in-UE notes](https://www.stevestreeting.com/2020/07/26/using-bullet-for-physics-in-ue4/)), so applying our own gravity/thrust forces through Chaos's force API is awkward and version-fragile.
4. **Joint stiffness is a solver-iteration problem in Chaos too.** Chaos's default low iteration counts under-resolve stiff/stacked constraints and jitter ([Bugnet: Chaos jitter fix](https://bugnet.io/blog/fix-unreal-chaos-physics-jittering-stacking)); KSP needed KJR/autostrut/raised rigidity for the same reason. A general contact solver is **not** the right tool for a stiff rocket's flight dynamics.

### 4.3 Recommendation (decision PH-4, REVISED → Accepted)

**Hybrid: a custom fixed-step integrator owns the active vessel's flight dynamics; Chaos is retained ONLY for collision detection + contact resolution (landing, ground, part-part collision).**

| Concern | Owner | Why |
|---|---|---|
| Gravity, thrust, drag, orbital/ballistic integration of the CoM | **Custom symplectic fixed-step integrator** | Closed-form-consistent, drift-free, warp-aware, deterministic; matches the on-rails conic at the seam (§2.2). A general solver accumulates energy error on a 600 km-scale gravity field. |
| Rigid-body attitude / joint dynamics | **Custom fixed-step** (compound-rigid by default, §3.3) | Stiff joints need controlled sub-stepping, not a contact-tuned iterative solver. Avoids KSP's wobble class entirely. |
| Collision **detection** (broadphase, narrowphase, raycasts) | **Chaos** (queries) | Chaos's collision/scene-query system is mature and already near-origin-coherent post-rebase; reusing it for contact is the "don't reinvent contact physics" half of the original PH-4. |
| Contact **response** at touchdown / ground | **Chaos contacts, fed by our integrator's state** | At low speed near a surface, CE-6 has bled `frameVelocity` to ~0 (spike1-core-engine §1.5) so the craft is slow in physics space — exactly the regime Chaos handles well. We let Chaos resolve the landing impact while our integrator owns free-flight. |

**In one line:** *We integrate the vessel ourselves (gravity/thrust/drag/joints at a fixed symplectic step) and use Chaos as a collision/contact engine, not as the flight integrator.* This is the **"partial pass" path core-engine predicted** (spike1-core-engine §7: "keep UE5 for coords/render, replace Chaos with a custom/decoupled physics layer for the active vessel") — formalized here as a deliberate architecture, not a fallback.

**Rationale:**
- **It does not gamble the project on Chaos surviving a regime it was never built for** (planetary-scale gravity integration, stiff multi-part rockets). The riskiest dependency becomes the smallest: Chaos only needs to do near-origin, low-speed contact — which CE-6 + rebasing already guarantee is its happy path.
- **It preserves the on-rails↔active no-drift guarantee (§2.2).** A custom symplectic integrator can be made *consistent with the closed-form conic* (same μ, same frame, energy-conserving), so the park/resume round-trip stays clean. A black-box Chaos integrator cannot give that guarantee.
- **It keeps determinism reachable for Phase-3 networking** — our integrator is a pure fixed-step function we control; Chaos's internal solver is not something we can make cross-platform deterministic.
- **Custom rigid-body + gravity integration is well-trodden and cheap** for one vessel of a handful of parts (semi-implicit Euler / velocity-Verlet at 60–240 Hz). The cost is trivial next to the factory sim.

### 4.4 Fallback ladder (if the hybrid shows trouble)

1. **If Chaos contact is *also* unstable at touchdown even at low speed** (the regime should be fine, but if not): replace contact with **our own analytic ground-contact** against world-gen's `GetGroundContact`/`RaycastTerrain` (§5) — a penalty-spring + friction contact model fed by terrain queries. This makes physics **fully custom**, Chaos-free, with UE5 retained purely for coords/render/scene-query. This is the strongest fallback and **strictly within our domain to execute.**
2. **If the custom integrator can't hit the perf budget** (it will — one vessel): reduce sub-step count; the joint default is already compound-rigid (§3.3), so the per-tick cost is one rigid body's integration.
3. **Only if precision/coherence fails even for near-origin contact** does this escalate to Admin as a D-001 (UE5) concern — but RC-4 is **explicitly scoped to NOT require that**: Spike-1's V4 (no kraken at 3 km/s) tests the engine-coherence half; our hybrid removes flight integration from Chaos so V4 reduces to "does near-origin low-speed contact stay coherent across rebases," which is Chaos's designed-for case.

### 4.5 Validation that confirms RC-4 (ties to Spike-1 gate V4)

| Check | Method | Pass criteria |
|---|---|---|
| **RC4-A: integrator-vs-analytic agreement** | Integrate a coasting craft (engines off) for one full orbit with the custom integrator; compare to the closed-form conic | Position drift < 0.1% of orbit radius per orbit; energy drift bounded (symplectic) — proves the integrator is conic-consistent |
| **RC4-B: no kraken at 3 km/s (= Spike-1 V4)** | Fly to ~3 km/s, hold through ≥20 rebases, then land/collide | No NaN/explosion/tunnel; physics-space residual speed stays bounded by CE-6; **Chaos contact resolves the landing cleanly** |
| **RC4-C: rebase transparency to dynamics** | Force a rebase mid-burn and mid-coast; diff the trajectory vs an un-rebased reference run | Trajectory identical to within float ε — proves rebasing doesn't perturb our integration (and that the Chaos scene re-anchor stays coherent, spike1-core-engine §1.4) |
| **RC4-D: landing contact stability** | Touch down on Forge (with drag) and Cinder (airless, 1.63 m/s²) at several descent rates | Legs absorb impact, no bounce-explosion, craft rests stable; CE-6 `frameVelocity` bled to ~0 at contact |
| **RC4-E: joint stability** | Multi-part (non-compound) craft under thrust + rotation | No wobble growth; compound-rigid default passes trivially; flex joints stay bounded under sub-stepping |

RC4-B **is** Spike-1's V4 — the same physical run, now with a real craft instead of a free-fly observer. Passing RC4-A..E **confirms PH-4 (hybrid)** and resolves RC-4.

---

## 5. RC-3 RESOLUTION — analytic terrain queries vs baked per-quad collision meshes

### 5.1 Decision (PH-5, Accepted): analytic queries for flight/landing; opt-in baked mesh deferred

**Use world-gen's analytic queries (`SampleTerrainHeight` / `GetGroundContact` / `RaycastTerrain`, spike1-worldgen §4.3) as the primary collision source for the craft and character.** Do **not** require baked per-quad collision meshes for the spike.

**Rationale:**
- **Resident-free is essential for physics.** world-gen's queries are pure noise evals, callable for a body the renderer hasn't streamed (spike1-worldgen §4.3: "physics must not depend on render residency"). A descending craft needs ground height *before* fine LOD has streamed in; analytic queries provide it; baked meshes only exist for resident quads.
- **Floating-origin-clean.** Queries take/return `FUniverseCoord` (carry their frame), so they're correct regardless of where the origin sits — exactly the "cheap and floating-origin-aware" contract physics.md §5 flagged to negotiate. A baked `UBodySetup` collision mesh would have to be re-anchored every rebase like the render mesh, adding cost for no precision benefit at the contact point.
- **Landing/contact is point-local.** A landing craft contacts terrain at a few points (legs, hull). `GetGroundContact` (radial projection to the heightfield, returns surface point + normal) and `RaycastTerrain` (gear/lidar) cover this exactly. We feed those contact points into the Chaos contact solver (§4.3) **or** the analytic penalty-contact fallback (§4.4) — either way the *terrain side* is analytic.
- **Determinism + persistence.** Analytic queries are deterministic from seed (spike1-worldgen WV1); no baked-mesh state to persist or version.

**When baked meshes *would* win (and why we defer, not reject):** a large fast-moving craft skidding across terrain, or many simultaneous contacts, can be cheaper against a pre-baked convex/heightfield collision body than many analytic raycasts. world-gen already noted the contract supports **adding** baked collision-mesh emission to `FTerrainChunk` later **without breaking callers** (spike1-worldgen §7 WR5). So PH-5 is: *analytic now; baked-mesh emission is a non-breaking Phase-1 perf option if contact-query volume becomes a bottleneck.*

### 5.2 The ONE additive request to world-gen (non-breaking)

The current `FTerrainContact` (spike1-worldgen §4.3) returns `SurfacePoint`, `Normal`, `Height`, `MaterialId`, `bFromVoxelPatch`. For a **stable landing contact model**, physics needs **two more scalars** the query already has in hand at near-zero cost:

```cpp
// REQUESTED ADDITIVE FIELDS on FTerrainContact (and FTerrainHit) — non-breaking, append-only:
double  SlopeRad;        // terrain slope at the contact (angle of Normal from local radial-up).
                         //   physics: reject/flag landings on slopes > leg tolerance; tip-over check.
uint8   SurfaceHardness; // placeholder 0..255 (e.g. rock vs regolith vs future ice/sand) →
                         //   physics maps to a friction/restitution coefficient for contact response.
```

Both are trivially derivable inside the existing query (`SlopeRad` from the `Normal` already computed; `SurfaceHardness` keyed off the same `MaterialId` world-gen already returns). **This is an append-only addition to two result structs — it changes no existing caller, no signature.** It mirrors how world-gen kept the `bFromVoxelPatch` seam: callers that don't need slope/hardness ignore the fields.

> **Formally to Admin (RC-3):** physics adopts world-gen's analytic queries (no baked meshes required for Spike 2). We request **one non-breaking additive change**: add `SlopeRad` + `SurfaceHardness` to `FTerrainContact`/`FTerrainHit`. Baked per-quad collision mesh emission stays deferred (Phase-1 perf option), contract already supports it. **No conflict, one additive field set.**

---

## 6. Minimal surface/character physics

Symmetric with Spike-1's walking observer, but now physics owns the dynamics:

- **Character on a body:** a kinematic capsule controller. Each tick: query `GetGroundContact(body, capsulePos)` → snap to `SurfacePoint + capsuleHalfHeight·Normal`; apply local gravity `g = μ/r²` along `−r̂` when airborne; movement input in the surface-tangent plane; the body's `Spin` co-rotation is inherited because the character is parented to the body's frame (spike1-core-engine §2.1) and its `UniverseCoord` is frame-relative. Walking on Forge (9.81) vs Cinder (1.63) differs only by `g`.
- **Craft ground contact:** at low speed near a surface (CE-6 `frameVelocity ≈ 0`), each landing-leg contact point queries `GetGroundContact`/`RaycastTerrain` for the surface point + normal + (requested) slope/hardness; contact response via Chaos contacts (§4.3) or the analytic penalty-spring fallback (§4.4). Legs model simple suspension (spring + damper along the leg axis). Resting stability requires the support polygon (contact points) to contain the CoM projection along `−r̂` — the standard tip-over test, using the requested `SlopeRad`.
- **Transition walk↔board:** out of spike scope as a *mechanic* (gameplay owns it); the *physics* (character on rails-frame, craft active) is what we provide.

This is intentionally minimal: one capsule, one craft, two bodies. It exercises gravity direction, surface co-rotation, terrain queries, and contact — the surface half of the launch→land loop.

---

## 7. Step-by-step build plan + validation gates

Built **pure-CPU-first** (like Spike-1) so the orbital math and the integrator are unit-tested headless before any UE work, then integrated against core-engine's Wave-1 skeleton and world-gen's terrain.

### PH-Build 0 — Pure-CPU orbital + integrator core (no engine, unit-testable)
1. **`FConics`** (§1.5): `stateToElements`, `elementsToState`, universal-variable Kepler solve (Stumpff `C/S`, Newton+Laguerre). Unit-test: round-trip `(r,v) → elements → (r,v)` bit-stable; elliptic/parabolic/hyperbolic all solve; propagate a known orbit one period → returns to start.
2. **On-rails propagator** (§1.2): `EvalOnRails(SimTime)` = evaluate conic at time. Unit-test: advancing in one big step == many small steps (warp-invariance); zero drift over 1000 orbits.
3. **Custom rigid-body integrator** (§3.2, §4.3): symplectic fixed-step; gravity + thrust + drag; compound-rigid body. Unit-test: **RC4-A** (integrator vs analytic conic agreement, coasting); energy drift bounded.
4. **Patched-conic SOI root-find** (§1.3): predictive crossing time. Unit-test: predicted Forge→Cinder entry time matches a fine-step reference integration.
5. **`FCraftSimProxy` hooks** (§2.1): `OnPromote`/`OnDemote` round-trip. Unit-test: **G6** demote→promote is identity on CoM `(r,v)` (no-drift guarantee, §2.2).

### PH-Build 1 — Integrate with core-engine + world-gen (UE5)
6. **Register the craft as `ISimProxy`** in core-engine's `ISimRegistry`; wire the four hooks; subscribe to `IFrameGraph::OnSOIChange` (§1.4). Confirm core-engine flips Mode via its bubble/hysteresis (we own only the hook content).
7. **Active integrator under floating origin + CE-6** (§3.2): integrate in physics-frame space; read TRUE velocity via `frameVelocity`; let core-engine apply rebase + velocity subtraction at end-of-tick. Validate **RC4-C** (rebase transparency).
8. **Chaos as contact engine** (§4.3): register craft collision proxies + landing legs with Chaos for *collision/contact only*; feed our integrator's transforms; resolve touchdown via Chaos contacts.
9. **Atmosphere on Forge** (§3.4): consume `FAtmosphereProfile`; drag relative to rotating atmosphere; zero on Cinder.
10. **Terrain contact** (§5, §6): consume `GetGroundContact`/`RaycastTerrain`; character capsule + craft legs; request the `SlopeRad`/`SurfaceHardness` additive fields from world-gen.

### PH-Build 2 — The full flight (launch → orbit → coast → SOI → land)
11. **Launch from Forge:** craft active on pad (co-rotating), thrust up through atmosphere (drag + gravity turn), watch rebases fire (RC4-C) and CE-6 engage past `VEL_REBASE`.
12. **Reach + coast orbit:** circularize; coast at ~3 km/s; **time-warp** → craft demotes to rails (G6), conic propagates warp-free (§1.2), promote back on warp-exit.
13. **Trans-Cinder + SOI cross:** burn to a Forge-escape / Cinder-intercept trajectory (hyperbolic in Forge frame); predictive SOI root-find drives "warp to SOI"; **`OnSOIChange` fires once** → fresh capture conic in Cinder's frame (§1.4), velocity continuous.
14. **Descend + land on Cinder:** airless; thrust-only descent at 1.63 m/s²; legs contact terrain (analytic queries + Chaos contact); rest stable. Walk on the surface.

### 7.1 Validation gates (each pass/fail)

| # | Gate | What it proves | Pass criteria |
|---|------|----------------|---------------|
| **G1** | Conic correctness | `FConics` round-trip + propagation | round-trip bit-stable; 1-period propagation returns to start < ε; all three conic types solve |
| **G2** | On-rails warp-invariance | `EvalOnRails` under warp | one-step == many-step advance; **zero drift over 1000 orbits** |
| **G3** | Integrator vs analytic (**RC4-A**) | custom integrator is conic-consistent | coasting drift < 0.1%/orbit; energy bounded (symplectic) |
| **G4** | Predictive SOI crossing | root-find vs reference | predicted entry time matches fine-step integration < tolerance |
| **G5** | SOI frame switch | consuming `OnSOIChange` | event fires **once** at boundary; pos+vel continuous; fresh conic in new μ correct (matches patched-conics) |
| **G6** | Park/resume no-drift | `OnDemote`/`OnPromote` round-trip | demote→promote identity on CoM `(r,v)` < ε_pos/ε_vel; **no load-in wobble** (strain-free seed) |
| **G7** | Rebase transparency (**RC4-C**) | integration unaffected by rebase | trajectory == un-rebased reference to float ε; Chaos scene stays coherent |
| **G8** | High-velocity stability (**RC4-B = Spike-1 V4**) | no kraken at 3 km/s | no NaN/explosion/tunnel through ≥20 rebases; residual speed bounded; **clean landing** |
| **G9** | Landing contact (**RC4-D**) | touchdown on both bodies | legs absorb impact, no bounce-explosion, rests stable on Forge (with drag) and Cinder (1.63, airless) |
| **G10** | Joint stability (**RC4-E**) | wobble mitigation | compound-rigid passes trivially; flex joints bounded under sub-stepping; no wobble growth |
| **G11** | Full flight | end-to-end launch→orbit→coast→SOI→land | completes with no drift, no handoff pop, no kraken; UPS stable; matches Spike-1's acceptance loop (spike1-PLAN §5 steps 2–5) |

G8 is the **RC-4 verdict gate** (= Spike-1 V4 with a real craft). G3+G6+G7 confirm the hybrid integrator is correct and seam-clean. G11 is the integrated acceptance run.

---

## 8. Interfaces & cross-domain notes (for Admin)

### 8.1 Consumed (honored verbatim, not redefined)
- **core-engine:** `FUniverseCoord`(+`FFrameId`), `FReferenceFrame`/`IFrameGraph` (μ/SOI/spin), `ISimProxy`/`ISimRegistry` (we implement the four hooks; core-engine owns promotion/demotion + hysteresis), `ISimClock` (warp, `TickIndex`), `OnOriginRebased`, **`OnSOIChange` (pos+vel re-expressed in new frame — we consume both)**, **CE-6 frame-velocity subtraction** (we read TRUE velocity, integrate the residual). All honored; no requested change.
- **world-gen:** `SampleTerrainHeight`/`GetGroundContact`/`RaycastTerrain` (analytic, resident-free), `FBodyParams`/`FAtmosphereProfile`, D-006 body constants. Adopted as the collision source (RC-3).

### 8.2 Provided (new outbound contract — flag to Admin)
**Orbital state → gameplay (map/maneuver UI), persistence (save), networking (replication):**
```cpp
struct FVesselOrbitalState {
    FEntityId        Vessel;
    ESimMode         Mode;            // OnRails | Active
    FFrameId         DominantFrame;   // current SOI body
    FOrbitalElements Elements;        // valid on rails; fitted CoM conic when active (advisory)
    FUniverseCoord   Position;        // true (r) — same as ISimProxy::Position()
    FVector3d        Velocity;        // TRUE universe velocity
    // Predicted trajectory for the map view (advisory; physics-computed, gameplay-rendered):
    TArray<FTrajSample> PredictedPath; // sampled conic + next predicted SOI crossing (time, frame)
    double           NextSOITime; FFrameId NextSOIFrame; // from the §1.3 root-find (INVALID if none)
};
```
- **gameplay** renders `PredictedPath`/`NextSOI*` as the orbit line + SOI-entry marker (we compute, they draw — physics.md §5 non-goal: rendering of trajectories is gameplay's).
- **persistence** saves `Elements + Mode + DominantFrame` — an on-rails vessel is ~10 doubles (PH-3 payoff: trivial save/restore).
- **networking** replicates `FVesselOrbitalState`; the pure time-addressable conic + fixed-step integrator are the determinism-friendly shape (D-004) — Phase-3 detail.

### 8.3 Requested of world-gen (RC-3, non-breaking)
Add `SlopeRad` + `SurfaceHardness` to `FTerrainContact`/`FTerrainHit` (§5.2). Append-only; no caller breaks. Baked collision-mesh emission stays deferred (Phase-1 perf option; contract already supports it per spike1-worldgen WR5).

### 8.4 Open / for Admin
- **Cross-platform determinism** of the custom integrator (networking, D-004) — designed pure/fixed-step; *verified* in Phase 3, not Spike 2.
- **MP time-warp** when other players have active vessels — deferred, networking-coupled (physics.md R3 / Admin Q1). Unchanged by this spike.

---

## 9. References

Patched conics / Kepler propagation: [Universal variable formulation (Wikipedia)](https://en.wikipedia.org/wiki/Universal_variable_formulation), [MathWorks Orbit Propagator Kepler (unperturbed)](https://www.mathworks.com/help/aeroblks/orbitpropagatorkeplerunperturbed.html), [poliastro Patched-conics computations](https://github.com/poliastro/poliastro/wiki/Patched-conics-computations), [ScienceDirect: Patched Conic overview](https://www.sciencedirect.com/topics/engineering/patched-conic), [SOI dynamical definition (arXiv 2205.09340)](https://arxiv.org/pdf/2205.09340). KSP active-vessel / Krakensbane: [KSP API Krakensbane](https://anatid.github.io/XML-Documentation-for-the-KSP-API/class_krakensbane.html). UE5 Chaos + LWC: [LWC wobble FPS/driving (Epic forums)](https://forums.unrealengine.com/t/lwc-large-world-coordinates-do-not-work-for-first-person-shooters-driving-games-wobbly-rendering-artefacts-ue5-only-ue4-works-fine/652748), [Cesium UE5 precision jitter](https://community.cesium.com/t/ue5-floating-point-precision-jitter-with-lat-lon-doubles/20531), [Chaos jitter when stacking](https://bugnet.io/blog/fix-unreal-chaos-physics-jittering-stacking), [UE5 substepping & Chaos async](https://www.aclockworkberry.com/unreal-engine-substepping/), [physics substepping & Chaos (Epic forums)](https://forums.unrealengine.com/t/physics-substepping-and-chaos-ue5/559373), [taming Chaos with async physics](https://dev.to/fgrenoville/taming-chaos-stable-vehicle-suspensions-with-async-physics-in-ue5-319l). Joint wobble: [Kerbal Joint Reinforcement Continued](https://github.com/KSP-RO/Kerbal-Joint-Reinforcement-Continued), [KSP autostrut guide](https://umatechnology.org/how-to-auto-strut-in-ksp/). Consumed contracts: [spike1-core-engine.md](spike1-core-engine.md) §1–§5, [spike1-worldgen.md](spike1-worldgen.md) §4–§5, [spike1-PLAN.md](spike1-PLAN.md) §2,§5,§6. Decisions: D-002, D-006 ([MASTER_PLAN §11](../MASTER_PLAN.md)).
