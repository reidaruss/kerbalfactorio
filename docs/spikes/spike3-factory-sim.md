# Spike 3 — Factory Sim: 100k-Entity Belt/Factory Sim @ 60 UPS in Isolation

> **Domain:** Factory & Automation Simulation (lead) · **Phase:** 0 · **Spike:** 3 · **Status:** Designed, ready to build · **Last updated:** 2026-06-14 (FS-10: Phase-1 contract closures — C-2 `FRecipeDef`/`FEntityDef` pinned §11.1; C-5 intent→mutation map confirmed §11.2; C-6 `IPersistable` form confirmed §11.3; C-8 factory chunk extent stated §11.4. Prior: FS-9 CE-7 `PromotionRadius()` override §5.4 + RC-12 `BoundRadius` §6.2 — both append-only)
> **Owner:** `factory-sim-controller` · Read alongside: [factory-sim.md](../controllers/factory-sim.md) · **[Spike 1 core-engine](spike1-core-engine.md)** (§3 SimProxy, §4 SimClock, §5 contracts) · **[Spike 1 rendering](spike1-rendering.md)** (§5.4 factory LOD ladder RN-3) · [MASTER_PLAN](../MASTER_PLAN.md) §3, §6, §11 (D-003, D-005) · [AGENT_ARCHITECTURE](../AGENT_ARCHITECTURE.md)
> **Co-domains:** core-engine (pinned `ISimClock`/`ISimProxy` — we implement against them) · rendering (consumes the §6 entity-state stream — **we pin it here, they confirm**) · networking (consumes the §6 delta/event stream — **we pin it here, they confirm**)

---

## 0. Purpose & the one question this spike answers

Prove that a **data-oriented factory sim can run 100,000+ active entities at a stable 60 UPS in isolation** on a single commodity CPU — retiring the **scale claim** (factory-sim.md §6, MASTER_PLAN §6 "GPU instancing + LOD for the render wall… naive = GPU death"). If 100k active entities cannot hold 60 UPS even *headless* (no rendering, no physics, no world-gen), then **FS-1/FS-6 are wrong** and the whole "Factorio-grade automation in 3D" pillar is re-scoped before any UE work.

This is a **throughput/scale benchmark, not an integration**. "In isolation" = a synthetic factory of belts/inserters/machines + power, stepped by a stand-in fixed clock, with **no rendering, no physics, no world-gen, no networking**. It runs first as a **pure-CPU headless harness** (Wave 0) so the core claim is provable *before* a single line of UE code (§8).

**The one question:** *Can our SoA + transport-line + update-on-demand design sustain ≥60 UPS at ≥100k active entities on one machine, and what is the actual limiting factor when it can't?*

**Non-goals (hard scope fence):**
- No fluids, no pipes, no circuit network (Phase 4 — FS scope).
- No physics, world-gen, or rendering *integration* (this is isolation; we *pin* the rendering/networking stream contracts but do not wire them).
- No real recipe-tree depth or UI — synthetic recipes only, enough to exercise machine ticks.
- No 1M-entity target. The v1 *gameplay* target stays **~thousands active/area (FS-6, D-005)**; this spike proves **engine headroom** to 100k+ so the on-rails abstraction (FS-4) is a *choice*, not a *crutch*.
- We do **not** redefine core-engine's `ISimClock`/`ISimProxy` (§5 of spike1-core-engine is pinned); we *consume* them. We *do* pin the entity-state + delta/event streams (rendering/networking said "negotiate later" — we negotiate now, flagged in §6 and the Completion Report).

---

## 1. Data layout — SoA component arrays + system scheduling

### 1.1 The core decision (FS-1): structures-of-arrays, not Actors, not AoS

Per **FS-1** (data-oriented ECS, Mass Entity under D-001) and the central tension (MASTER_PLAN §2: Factorio = "1,000,000+ active entities" via "ECS data layout"), every hot per-tick value lives in a **tightly-packed parallel array indexed by a dense handle**, iterated contiguously by systems. No `UObject`, no per-entity virtual dispatch, no pointer-chasing in the tick loop. This is the only path to 100k @ 60 UPS — the research is unambiguous: a tight archetype-SoA ECS does 100k boids in ~2.4 ms while a naive/managed ECS does the same in ~44 ms (§9 refs). **The data layout, not the language, is the 20× difference.** We design for the 2.4 ms regime.

### 1.2 Entity handle & archetype model

```text
EntityHandle  = { uint32 index; uint32 generation; }   // dense, generation guards stale handles
```

Entities are grouped by **archetype** (the set of components they carry). A `Miner` archetype has different arrays than an `Assembler`; iterating a system touches only the archetypes that carry the components that system reads/writes. This is exactly Mass Entity's `FMassFragment`/`FMassArchetype` model and DOTS's archetype chunks — we lean on it directly under D-001, and the **headless Wave-0 harness reimplements the same SoA layout in plain C++** so the algorithm is proven before the engine binding (§8).

### 1.3 Component arrays (the SoA tables)

Hot components (touched most ticks) are kept narrow and cache-line-friendly. Cold components (config, rarely read) live in separate arrays so they don't pollute hot cache lines.

| Component (fragment) | Fields (SoA arrays) | Hot/Cold | Carried by |
|---|---|---|---|
| `Transform` | `int32 gx,gy,gz` (grid cell) + `uint8 dir` | warm | all placed entities |
| `MachineProc` | `uint16 recipeId; uint32 progressTicks; uint8 flags` | **hot** | miners, smelters, assemblers |
| `Inventory` | `uint16 slotItem[K]; uint16 slotCount[K]` (small fixed K, e.g. 4) | **hot** | machines, chests |
| `InserterState` | `uint8 phase; uint16 heldItem; uint16 heldCount; EntityHandle src,dst` | **hot** | inserters |
| `TransportLine` | see §2 — its own SoA, the big one | **hot** | belts (one record per *line*, not per belt tile) |
| `BeltMember` | `uint32 lineId; uint16 offsetOnLine` | cold | individual belt tiles (placement/render only) |
| `PowerNode` | `uint16 networkId; int32 demandW; int32 supplyW; uint8 kind` | **hot** | every powered entity |
| `Sleep` | `uint8 state; uint32 wakeTick; uint16 wakeMask` | **hot** | all sim-active entities (§3) |
| `RenderState` | `uint8 visualState; uint8 animPhase; uint16 flowQuant` | warm | anything rendering streams (§6) |
| `StaticDef` | `uint16 typeId; AABB bounds; ...` | cold | all (read on place/LOD only) |

> **Cache rationale.** A machine tick reads `MachineProc` + `Inventory` + (on completion) writes `RenderState.visualState` and flips `Sleep`. Those three hot arrays are the only lines pulled per active machine. `StaticDef`/`BeltMember`/`Transform`-detail are *not* touched in the steady-state tick, so they never evict hot data. Items on belts carry **no per-item component at all** (§2) — that is the single biggest memory/throughput win and the reason 100k *entities* can imply millions of *items* moving.

### 1.4 Systems & per-tick schedule

Systems run in a **fixed deterministic order** every tick (locally deterministic, NW-4 requirement). Each system iterates its archetypes' SoA arrays linearly. Order is dependency-driven so a value produced early is consumed later the same tick (single-pass, no read-after-write hazards across systems):

```text
Fixed tick (driven by core-engine ISimClock.OnFixedTick, dt = 1/60):
 1. PowerSolveSystem      — per network: sum supply/demand, compute brownout factor (§4)
 2. MinerSystem           — active miners: advance progress (scaled by brownout), emit to output buffer
 3. MachineSystem         — active assemblers/smelters: advance recipe progress (×brownout), consume/produce
 4. InserterSystem        — active inserters: pick from src head / drop to dst tail; swing phases
 5. BeltSystem            — active transport lines: advance terminal gaps, resolve head/tail transfers (§2)
 6. WakeSystem            — process scheduled wakes + edge-triggered wakes into next tick's active set (§3)
 7. StreamSystem          — emit entity-state deltas + events to the ring buffer (§6); does NOT block the sim
```

- **Only the active set is iterated** (§3). Systems walk a compact *active index list* per archetype, not the full array. A factory of 100k entities with 5k currently doing work iterates ~5k — except in the benchmark, where we *deliberately* keep all 100k active to stress the worst case (§7).
- **Parallelism (within a tick):** systems 2–5 are internally data-parallel across **independent power/spatial partitions** (a chunk's belts don't touch another chunk's belts in one tick). We shard the active set by chunk and run shards on a job pool; cross-chunk transfers (belt→belt across a chunk boundary) are resolved in a deterministic fixup pass at the chunk seam so sharding stays order-independent. This is how we use cores without breaking local determinism: **deterministic given the shard order**, which is fixed by chunkId.
- **Determinism:** integer/fixed-point only in the sim hot path (no float in belt/inserter/machine state — floats are confined to power's brownout *ratio*, applied as a fixed-point multiply, and to nothing that feeds back into discrete state). This honors MASTER_PLAN §2 ("floating-point is banned from the sim" for the deterministic parts) and NW-4's client-sim requirement.

---

## 2. Belt compression — transport-line + item-offset representation in 3D (FS-3)

This is the heart of the scale trick, lifted from Factorio's transport-line optimization (FFF-176, §9) and **generalized to 3D placement**.

### 2.1 The transport line (segment), not the belt tile

Consecutive belt tiles with no inserter/splitter/merge between them are merged into **one logical `TransportLine`**. A 100-tile straight belt is **one record**, not 100. (Factorio: "treating sequences of adjacent belts as one single piece… performance-wise they behave like the underground belt's underground part.") A line is broken only by a splitter, a merge/junction, or a hard length cap (we cap at **100 tiles/line**, matching Factorio's practical cap, for inserter-addressing and render-chunking sanity).

Each `TransportLine` is itself SoA:

```text
TransportLine (per logical line, two lanes — left/right — handled as two sub-lines):
  lineId            : uint32
  capacityUnits     : uint32     // line length in sub-tile units = tiles × 256 (§2.2)
  speedUnitsPerTick : uint16     // belt-tier speed: 8 (basic) … 32 (turbo) units/tick
  headGap           : uint32     // free units before the FIRST item (the only thing that moves when flowing)
  tailGap           : uint32     // free units after the LAST item (where new items enter)
  itemGaps[]        : varint     // gap (units) BETWEEN consecutive items; items themselves store NO position
  itemTypes[]       : uint16     // the item id at each slot (parallel to itemGaps)
  fullyCompressed   : bool       // latched: once compressed, stays compressed (Factorio invariant)
  pathUnitToWorld   : compact spline ref   // 3D: maps a 1-D unit-offset → world transform (§2.4)
```

### 2.2 Items as offsets, never as objects (the win)

Following Factorio's wiki physics: a belt tile is **256 sub-tile positions**; a saturated belt holds items **64 units apart** (4 items/tile/lane). **We store the *distance between* items, not absolute positions** ("We no longer store absolute coordinates of items, instead we store the distance between items." — FFF-176). Consequences:

- **Moving the whole line = decrement `headGap` by `speedUnitsPerTick`.** *Nothing else is touched.* "For every transport line of 20–100 belt segments you only increment/decrement those terminal gap sizes, and do not touch items at all." A flowing 100-tile belt with 400 items costs **one subtraction per tick**, not 400.
- **No per-item entity, no per-item component, no per-item iteration.** This is why "100k entities" can carry **millions of in-flight items** at near-zero marginal cost. The belt item count is *decoupled* from the entity budget.
- **Compression is latched** (`fullyCompressed`): "whenever a belt compresses it will stay that way forever" until something removes from the head. A compressed line's interior `itemGaps` are all the minimum (64) and need no per-tick work at all — the line degenerates to "advance `headGap`, and when an item reaches the head, hand it off." This makes the algorithm **amortized O(items produced × lines)**, not O(items on belts × ticks).

### 2.3 Transfers — only heads and tails interact

Items only enter/leave at line ends, so only **two units per line** ever interact with the outside world:

- **Tail (input):** an inserter, miner, splitter, or upstream line deposits into `tailGap`. If `tailGap ≥ itemSize`, append an item (push `itemGaps`/`itemTypes`), shrink `tailGap`. Inserters "make room by enlarging a small gap until it's exactly big enough" — naturally compressing the line (wiki).
- **Head (output):** when `headGap == 0`, the lead item is presented to whatever consumes the head (inserter pickup, machine input, downstream line tail, splitter). On take, pop the head item, add its `itemGap` back into `headGap`. Downstream lines see this as their tail input — **line-to-line transfer is a head-pop + tail-push**, no global item list.
- **Inserters track sequentially** (FFF-176: "inserters need this item-tracking info sequentially every tick"): an inserter bound to a line head reads/writes only that head slot — O(1), and it *wakes* the line when it removes the head item (decompression event, §3).

### 2.4 The 3D generalization (what's new vs Factorio's 2D)

Factorio's lines are axis-aligned on a 2D grid. Ours sit on planet surfaces at arbitrary 3D transforms (entities "placed on terrain surfaces at grid-snapped or free 3D transforms" — factory-sim.md §4). The 1-D belt math is **identical** — the line is a 1-D parameter space of `capacityUnits`. The only addition is `pathUnitToWorld`: a compact, baked **arc-length-parameterized polyline/spline** (computed once at build time from the belt tiles' world transforms) that maps a scalar unit-offset → `(position, orientation)` in `UniverseCoord`. **The sim never evaluates it** — it operates purely on integer unit-offsets. **Only rendering evaluates `pathUnitToWorld`**, and only for items it actually draws at LOD-0 (§6). So the 3D-ness is free to the sim and paid only by the renderer for visible items, which is exactly where the render wall is fought (§7). Curves, ramps, and inclines are just nonlinear `pathUnitToWorld` mappings over a still-linear unit axis — belt *speed in units/tick is constant regardless of twists* (wiki: "density and speed of each lane is constant… regardless of twists and turns"), so throughput is curvature-independent, preserving Factorio's invariant.

> **Two lanes:** each physical belt is two independent sub-lines (left/right), per the wiki ("two independent parallel lanes"). They share `pathUnitToWorld` with a fixed lateral offset; everything else is per-lane. Doubles item capacity, same per-line cost structure.

---

## 3. Update-on-demand — the dirty/active set (FS-2)

Idle entities must cost **~zero** (FS-2: "idle machines must cost ~zero"). We never iterate the full entity array in steady state; we iterate an **active set**, and entities **sleep** until an event wakes them.

### 3.1 Sleep states

```text
Sleep.state ∈ { Active, SleepingTimed, SleepingEvent }
  Active        : in the active index list for its archetype; iterated every tick.
  SleepingTimed : not iterated; WakeSystem will re-activate at Sleep.wakeTick (e.g. machine
                  mid-craft that needs no input check until progress completes).
  SleepingEvent : not iterated; re-activated only when a subscribed input changes (wakeMask).
```

### 3.2 What sleeps, and why it's safe

- **A blocked machine** (output full / input empty) sleeps `SleepingEvent`, subscribed to "my output buffer drained" or "my input buffer filled." It does **zero** work until that edge fires.
- **A mid-craft machine** with all inputs present sleeps `SleepingTimed` until `wakeTick = now + remainingProgress`. It wakes once, completes, emits, re-checks. (No per-tick progress polling — progress is computed from `startTick` on wake.)
- **A fully compressed, fully flowing belt** with a consumer keeping the head clear advances by a **single `headGap -=` per tick** while flowing — but if its head is **blocked** (consumer gone/full) and it is compressed, it sleeps `SleepingEvent` on "head consumer took an item." A backed-up belt is *free*.
- **An inserter** with no source item *and* no destination room sleeps `SleepingEvent` on both edges.

### 3.3 Waking (edge-triggered)

The producer of a state change **wakes its subscribers** by setting their `Sleep.state = Active` and queuing them into next tick's active list. Wake sources are the few "boundary" interactions: a head-pop on a belt wakes the upstream line and the bound inserter; a buffer-fill wakes the consuming machine; a power-state flip (brownout on/off) wakes affected consumers. **Edges, not polls.** Worst case (a synchronized factory where everything changes every tick) degrades to "everything active" — which is *exactly the benchmark's stress scene* (§7): we measure the floor by forcing 100k entities `Active` permanently, so the benchmark proves the case where update-on-demand gives us *nothing* and raw SoA throughput is all that carries us.

### 3.4 Cost model

Steady-state per-tick CPU ≈ `O(active set)` + `O(networks)` for power + `O(scheduled wakes this tick)`. A 100k-entity base in normal play with ~5–15% active costs like a 5–15k-entity sim. The benchmark removes this mercy on purpose. **Sleeping is the gameplay scalability lever; SoA throughput is the headroom-proof lever** — Spike 3 proves the second so the first is gravy.

---

## 4. Power network — graph, per-tick supply/demand, brownout (FS-5)

### 4.1 Graph model

A power network is a connected component of generators + consumers + poles (the graph edges are pole coverage / wire connections). Each entity has a `PowerNode { networkId, demandW, supplyW, kind }`. Networks are **precomputed connected components**, rebuilt incrementally only when a pole/generator/consumer is placed or removed (a structural edit, rare) — **not per tick**. Per tick we iterate **networks**, not entities, for the solve.

### 4.2 Per-tick solve (Factorio's O(network) model — FS-5)

```text
PowerSolveSystem, per network N each tick:
  supply = Σ generator.supplyW   (solar evaluated via §4.4 hook; accumulators discharge here)
  demand = Σ consumer.demandW    (a consumer's demand is its *wanted* draw this tick)
  if demand <= supply:
       brownoutFactor[N] = 1.0
  else:
       brownoutFactor[N] = supply / demand        // proportional brownout (FS-5)
       (drain accumulators first if present, before scaling)
  // consumers read brownoutFactor[N] and scale their work this tick:
  //   machine progress += baseRate × brownoutFactor[N]   (fixed-point multiply)
```

A 50%-supplied network runs every machine at 50% craft speed this tick — Factorio's exact proven behavior. Cost is **O(#networks + #generators + #consumers updated)**, and demand/supply are **accumulated incrementally** as machines change state (a sleeping machine contributes a cached constant demand), so a network with all-idle members costs O(1). The brownout factor is the *only* float in the hot path and it never feeds back into discrete state non-deterministically (it's a per-network scalar applied identically to all members in a fixed order — locally deterministic).

### 4.3 Accumulators & priority (kept minimal for the spike)

Generators have a priority order (solar → accumulator discharge → fuel) so brownout drains buffers before throttling. The spike implements a single generator kind + a solar stub + optional accumulators; the full priority ladder is Phase-1 work. Enough to exercise the brownout path under load.

### 4.4 The solar hook — a stub interface to physics/world-gen (for later)

Solar output ties power to the orbital sim (MASTER_PLAN §6: "Solar output = f(day/night, distance from star, atmosphere)"). We **define the interface now and stub it** so Spike 3 stays in isolation but Phase 1 can wire it without a contract change:

```cpp
// factory-sim DEFINES this; physics + world-gen IMPLEMENT it later (flagged as a dependency).
struct FSolarConditions {
    float SunVisibility;      // [0,1] day/night × eclipse/occlusion (physics: sun-vs-body geometry)
    double DistanceToStarM;   // for inverse-square falloff (physics: orbital position)
    float AtmoTransmittance;  // [0,1] atmospheric attenuation at the panel (world-gen FAtmosphereProfile)
};
class ISolarProvider {
public:
    // Called by PowerSolveSystem per solar generator (or per chunk, amortized) at SimTime.
    virtual FSolarConditions SampleSolar(const FUniverseCoord& panelPos, double SimTime) const = 0;
};
// Output: panel.supplyW = ratedW × SunVisibility × (refDist² / DistanceToStarM²) × AtmoTransmittance
```

In the spike, a `StubSolarProvider` returns a scripted day/night sine — **no physics dependency**. The signature is pinned so physics/world-gen can drop in the real `SampleSolar` in Phase 1. **DEPENDENCY flagged (§ Completion Report):** physics owes `SunVisibility` + `DistanceToStarM` (from `FReferenceFrame::ToUniverse`/SOI geometry, spike1-core-engine §5.2); world-gen owes `AtmoTransmittance` (from `FAtmosphereProfile`, spike1-rendering §4.2 / worldgen §5).

---

## 5. On-rails factory abstraction — `ISimProxy` for distant bases (FS-4, D-003)

### 5.1 The model

When a factory chunk leaves the active bubble (core-engine demotes it via `ISimRegistry`/`ISimProxy`, spike1-core-engine §3.2, §5.3), we **stop per-entity simulation** and collapse the chunk to a **steady-state production-rate model** (D-003, MASTER_PLAN §3: "a distant factory becomes a production-rate model… not a million simulated items"). The chunk becomes a few rate equations + buffer levels, advanced analytically by Δt.

### 5.2 Demote — snapshot steady-state throughput

On `ISimProxy::OnDemote()` (core-engine calls it), the chunk computes its **bottleneck-limited steady-state rates**:

```text
FRailState (factory chunk):
  inputRates[]   : item/s consumed from chunk-external sources (cap = min upstream supply)
  outputRates[]  : item/s produced to chunk-external sinks    (cap = bottleneck machine)
  bufferLevels[] : current internal buffer fill per item (the de-dupe anchor, §5.4)
  bufferCaps[]   : max storage per item (bounds reconstruction — no infinite accumulation)
  snapshotTick   : TickIndex() at demotion (for exact Δt on re-entry)
  brownoutAvg    : recent avg power factor (so on-rails honors a power-starved base)
```

Rates are derived from the recipe graph + the *measured* recent throughput at demotion (we snapshot the actual flow, not the theoretical max, so a half-built or input-starved base on-rails matches what it was doing). This is **EvalOnRails**: advancing the chunk = `bufferLevels += (inputRates − consumptionForOutput) × Δt`, clamped to `[0, bufferCaps]`.

### 5.3 Re-entry / time-warp — reconstruct buffers, no dupes (R2)

On `ISimProxy::OnPromote(from)` (core-engine hands back control, or time-warp ends), we **reconstruct the active per-entity state** from the rate model:

```text
elapsedTicks = now - snapshotTick                  // exact, from TickIndex() (deterministic)
for each item:
   produced  = outputRates[i] × elapsed × brownoutAvg
   consumed  = inputRates[i]  × elapsed × brownoutAvg
   bufferLevels[i] = clamp(bufferLevels[i] + produced - consumed, 0, bufferCaps[i])  // BOUNDED
distribute bufferLevels[] back into the chunk's machine/chest inventories + belt fill
   up to each container's capacity; overflow is *discarded at the cap*, never created beyond storage.
```

**No-dupe / no-exploit guarantees (R2):**
- Reconstruction is **bounded by `bufferCaps`** — an on-rails base for a year cannot exceed its physical storage. Time-warp advances factories *the same way* (MASTER_PLAN §3) with the same cap, so warp can't mint items.
- Inputs are **debited from real upstream sources** as they're consumed (or the on-rails model is itself input-starved and produces less) — output isn't conjured from nothing; it's `min(recipe demand, available input)`.
- It is **deterministic** in `elapsedTicks` (integer ticks from `TickIndex()`), so two clients reconstructing the same chunk get the same buffers (NW-4: client-sim consistency).
- Re-entry is **conservative**: we under-fill rather than over-fill on ambiguity (partial recipes round down), so the worst case is a few seconds of catch-up sim, never duplication.

### 5.4 `ISimProxy` implementation (we honor core-engine's pinned contract)

We implement `ISimProxy` (spike1-core-engine §5.3) **per factory chunk** (not per entity — a chunk is the granule that promotes/demotes together, keeping the registry small):

```cpp
class FFactoryChunkProxy : public ISimProxy {
    FEntityId Id() const override;              // chunkId
    ESimMode  Mode() const override;            // Active (full sim) | OnRails (rate model)
    FFrameId  Frame() const override;           // the body frame the chunk sits in
    void EvalOnRails(double SimTime) override;  // §5.2 — advance buffers analytically to SimTime
    void StepActive(double Dt) override;        // run §1.4 systems for this chunk's active set, one dt
    void OnPromote(const FRailState& from) override; // §5.3 — reconstruct buffers → per-entity state
    FRailState OnDemote() const override;            // §5.2 — snapshot steady-state rates
    FUniverseCoord Position() const override;   // chunk centroid (for the bubble test) — UNCHANGED
    FVector3d      Velocity() const override;   // {0} — factories are surface-fixed (co-rotate via frame) — UNCHANGED
    // CE-7 / RC-10: a chunk is a COARSE proxy with spatial extent — override the defaulted
    // PromotionRadius() so the bubble test (spike1-core-engine §3.2.1) measures the chunk's
    // NEAR EDGE, not its centroid. Derived from the chunk AABB we already compute (§1.3):
    //   half-extent = ½·‖aabb.Max − aabb.Min‖  (bounding-sphere radius about the centroid)
    double PromotionRadius() const override {   // ½ the chunk AABB diagonal — bounding-sphere half-extent
        return 0.5 * (ChunkAABB.Max - ChunkAABB.Min).Size();   // metres; conservative over-approx
    }
};
```

Core-engine owns the bubble test + hysteresis (§3.2 of spike1-core-engine: 2 km activate / 3 km deactivate / 2 s dwell) — **we just implement the content hooks**. The spike builds and unit-tests demote→on-rails→promote→reconcile on a synthetic chunk to prove no-dupe + buffer-bound correctness, even though the *bubble* itself is core-engine's and stubbed here (we drive promote/demote manually in the harness). **Flag to core-engine & physics: factory-sim registers chunk-granular `ISimProxy`s, not per-entity — confirm the registry tolerates coarse proxies alongside physics's per-vessel ones.**

> **CE-7 (REQUIRED, RC-10 adoption) — `PromotionRadius()` override.** Core-engine closed RC-10 (mixed proxy granularity) by adding a **defaulted** accessor `virtual double PromotionRadius() const { return 0.0; }` to `ISimProxy` (spike1-core-engine §5.3) and defining the bubble test as `gap(p,obs) = max(0, ‖p.Position()−obsPos‖ − p.PromotionRadius())` (§3.2.1). A point proxy (physics vessel) inherits `0` and is unchanged; a **coarse** proxy like our `FFactoryChunkProxy` (FS-7: one proxy per whole chunk) has spatial **extent**, so it **must override** `PromotionRadius()` to return the chunk's **bounding-sphere half-extent**. Without it, a chunk whose *centroid* sits just outside the 2 km activate band but whose *near edge* is metres from the observer would wrongly stay on-rails — violating core-engine's "promote anything the player can touch" invariant. We derive the half-extent from the **chunk AABB we already compute** (§1.3 `StaticDef.AABB bounds`, accumulated per chunk), so this is **zero new stored data** — the same bounds also back the per-entity `Bounds` field surfaced to rendering (§6). A bounding-sphere radius is a conservative over-approximation (the chunk promotes *slightly early*), which is the **safe** direction for the touchability invariant. `Position()` (chunk centroid) and `Velocity()` ({0}) are **unchanged**. This is the one change core-engine asked of us; it is **additive and non-breaking** (we add an override of a defaulted method — no callers break, no other hook touched).

---

## 6. Entity-state stream contract — PIN IT (rendering + networking) {#sec-stream}

Rendering (spike1-rendering §5.4) sketched the factory LOD ladder (RN-3) and said "to negotiate later." **We pin both streams now** and flag for rendering + networking to confirm. These are the §5/§6 published interfaces of factory-sim.md.

### 6.1 Design principle — the sim owns *state*, the stream is a *view*

The sim never holds a pointer to a mesh and never knows about cameras. Each tick, `StreamSystem` (system 7, §1.4) writes **changes** into a lock-free ring buffer that rendering and networking drain on their own cadence. The sim is **never blocked by, and never reads back from, either consumer.** This is the clean boundary that lets sim scale (100k) while render scales differently (LOD, §7).

### 6.2 The entity-state stream → rendering (instancing/LOD, RN-3)

Rendering needs, per visible entity, the *minimum* to place an instance and pick an animation/flow visual — and crucially, a way to **stop needing per-item data** when zoomed out ("abstract when unobserved"). The contract:

```cpp
// One compact, instancing-friendly record. SoA on the sim side; rendering reads it as an instance row.
struct FFactoryEntityState {           // ~34 bytes (was ~32 B; +2 B for Bounds — RC-12, append-only)
    FEntityId      Id;
    uint16         TypeId;             // which mesh/material set (rendering maps to asset)
    FUniverseCoord Position;           // authority position; rendering does .ToEngine(FloatingOrigin)
    FQuat16        Orientation;        // packed quaternion (belts/machines orient to surface)
    uint8          VisualState;        // idle / working / blocked / no-power  → anim or emissive
    uint8          AnimPhase;          // 0..255 normalized progress (inserter swing, machine craft)
    uint8          Lod;               // sim's *hint* of current band (rendering may override)
    uint8          Flags;             // dirty bits: poweredOff, jammed, selected, ...
    uint16         BoundRadius;        // RC-12 (APPEND-ONLY): packed bound-radius about Position, in
                                       //   centimetres (0..65535 cm ≈ 655 m, covers any single entity).
                                       //   Sourced from StaticDef.AABB bounds (§1.3) — already stored.
                                       //   Lets rendering frustum-cull + compute screen-space size for
                                       //   LOD-band selection WITHOUT a per-TypeId asset-bounds lookup.
};

// Belts are special — they carry items but NOT as entities (§2). The stream exposes a belt as:
struct FBeltFlowState {               // one per visible transport line (NOT per item)
    FEntityId   LineId;
    uint16      ItemTypeDominant;     // most-common item on the line (for the scrolling-material LOD)
    uint8       FlowSpeedQuant;       // units/tick quantized → scroll rate of the flow material
    uint8       Density;              // 0..255 fill fraction → how "full" the flow looks
    uint8       Compressed;           // latched flag (render can use a cheaper path)
    // LOD-0 ONLY, on demand: rendering may request the item offset list to draw discrete item meshes:
    //   GetLineItems(LineId) -> view of {itemType, unitOffset}[]  (computed from §2 gaps; read-only)
};
```

> **RC-12 (rendering's request, ADOPTED — append-only, non-breaking) — per-entity `BoundRadius`.** During the reconciliation round rendering confirmed this §6 stream clears the render wall and asked for **one optional additive field**: a per-entity bound so rendering can **frustum-cull** and compute **screen-space size for LOD-band selection** without a per-`TypeId` asset-bounds lookup on its side. We surface it as a **packed 2-byte `BoundRadius`** (centimetres, bounding-sphere radius about `Position`) rather than a full `AABB` (24 B) — the entity record is GPU-instance-friendly and a scalar radius is sufficient for a conservative cull + screen-size estimate, so we pay **+2 B** (record goes from ~32 B to ~34 B) instead of +24 B. The data is **free to produce**: it comes from the `StaticDef.AABB bounds` we already store (§1.3) — the **same bounds that back the `PromotionRadius()` override** in §5.4 — so no new sim-side storage, just surfacing what exists. This is **strictly append-only**: it adds a trailing field, changes **no** existing field's meaning, and rendering has a render-side asset-bounds fallback if it ever declines — so no caller breaks. **Nothing else in §6 changed:** `FBeltFlowState`, `GetLineItems`, the LOD-ladder contract, the delta-only update rule, and the entire §6.3 delta/event stream (`FFactoryDelta`, `EFactoryEvent`) are **untouched**; the only edit is this one trailing field on `FFactoryEntityState`.

**How this feeds the RN-3 LOD ladder (rendering §5.4) and "abstract when unobserved":**

| RN-3 LOD band | What rendering draws | What it reads from our stream | Per-item cost |
|---|---|---|---|
| **0 (near)** | Instanced machine meshes + **discrete animated item meshes** on belts | `FFactoryEntityState` per machine + `GetLineItems(LineId)` to place item instances along `pathUnitToWorld` | O(visible items) — **only here** |
| **1 (mid)** | Instanced machines; items as a **scrolling flow material** on the belt | `FFactoryEntityState` + `FBeltFlowState` (`FlowSpeedQuant`,`Density`) — **no per-item data** | O(visible lines) |
| **2 (far)** | Machine **impostors**; no items | `FFactoryEntityState` (`TypeId`,`Position`,`VisualState`) only | ~0 |
| **3 (on-rails)** | Not rendered (sim is on-rails, §5) | nothing — proxy is demoted | 0 |

> **Band selection (RC-12):** which of the rows above a given entity lands in is rendering's call, and it now picks the band from the entity's **screen-space size** — computed from `Position` + the new `BoundRadius` field — without a per-`TypeId` asset-bounds lookup. `BoundRadius` also feeds rendering's **frustum cull** (cheap reject of off-screen entities before any draw). This is purely a rendering-side optimisation we *enable* by surfacing data we already hold; the sim's `Lod` hint (above) is unchanged and rendering may still override it.

The key contract guarantee for the render wall: **`GetLineItems` (the only O(items) call) is pulled *only at LOD-0*, on demand, for lines the renderer chose to draw discretely.** At LOD-1+, the belt is a material parameter (`FlowSpeedQuant`/`Density`), so **rendering's item cost collapses to O(lines), not O(items)** the instant you zoom out — that is the mechanism by which sim-scale (millions of items) decouples from render-scale (RN-3). This is the explicit answer to **R1, the render wall** (§7).

- **Update rate:** the stream is **delta-only** (changed entities since last drain). Rendering drains at *render* FPS and interpolates transforms using `ISimClock::Alpha()` (spike1-core-engine §5.4) between the last two sim snapshots — exactly as the engine does for everything else (decoupled UPS/FPS). `Position` updates only on actual movement (machines never move → near-zero traffic); `AnimPhase` updates each active tick but is 1 byte. **Belts emit `FBeltFlowState` only on flow-state *change*** (compress/decompress/speed change), not per tick — a steadily flowing belt is silent on the stream after its initial state.

### 6.3 The delta/event stream → networking (replication, NW-4)

Networking needs a **deterministic, delta-compressible event log** to replicate factory state and to client-sim chunks (NW-4, locally-deterministic requirement). Distinct from the render stream (which is lossy/interpolated): this one is **lossless and ordered**.

```cpp
enum class EFactoryEvent : uint8 {
    EntityPlaced, EntityRemoved, RecipeChanged,
    InventoryChanged,            // entity, slot, item, newCount  (delta)
    BeltStateChanged,            // line: compressed/decompressed, speed change, item added/removed at end
    InserterTransfer,            // src, dst, item, count
    MachineCompleted,            // entity, recipeId  (a craft finished — produces science/items)
    PowerStateChanged,           // network: brownoutFactor crossed a threshold
    ProxyDemoted, ProxyPromoted, // chunk went on-rails / came back (carries FRailState digest)
};
struct FFactoryDelta {
    uint64         TickIndex;    // from ISimClock::TickIndex() — the ordering/replication key (D-004)
    EFactoryEvent  Type;
    FEntityId      Entity;       // or LineId / networkId / chunkId per Type
    uint32         A, B;         // payload (slot/item/count/recipe/factor-quantized) — type-specific
};
```

- **Keyed by `TickIndex()`** (the pinned determinism/replication hook, spike1-core-engine §5.4 / D-004): every delta is stamped with the tick it occurred on, so the server's authoritative ordering is unambiguous and a client can replay deltas deterministically.
- **Locally deterministic (NW-4):** because the sim is integer/fixed-point and runs in fixed system order on a fixed shard order (§1.4), a client given the same `EntityPlaced`/`RecipeChanged`/input-deltas reproduces the *same* `InventoryChanged`/`BeltStateChanged`/`MachineCompleted` stream — so networking can **client-sim a chunk and only correct on divergence**, replicating *inputs/structural edits*, not every item. This is the factory analogue of Factorio lockstep, scoped to a locally-deterministic chunk (since the global game is not lockstep — D-004).
- **Delta-compressible:** events are sparse (a steady factory emits mostly `MachineCompleted` at recipe cadence + occasional `BeltStateChanged`); `InventoryChanged` carries deltas not absolutes. Networking applies its own AOI filter + delta compression on top (their domain).

> **FLAGGED for confirmation (Completion Report INTERFACES):** rendering confirms `FFactoryEntityState`/`FBeltFlowState` + the `GetLineItems`-at-LOD-0-only contract satisfies RN-3; networking confirms `FFactoryDelta` keyed by `TickIndex()` is a sufficient replication seam and that chunk-local determinism is what NW-4 wants. Both were "negotiate later" — this is the negotiation. **No core-engine contract is changed** (we only *consume* `TickIndex`/`Alpha`/`ISimProxy`).

---

## 7. The 100k-entity @ 60 UPS isolation benchmark

### 7.1 Exactly what's built

A **headless C++ harness** (Wave 0, §8) implementing §1–§4 with **no UE dependency**: the SoA tables, the 7 systems, transport-line belt sim, update-on-demand, and the power solve. A synthetic clock calls the tick at a fixed `dt`. Then (Wave 2) the **same algorithm rebound onto Mass Entity** inside UE to confirm the engine binding doesn't regress the headless numbers.

### 7.2 The test scene

A procedurally generated "worst-case-ish but realistic" factory, parameterized by entity count `N` (swept 10k → 100k → 250k):

- **Mix:** ~40% belt tiles (merged into transport lines — so far fewer *lines* than tiles), ~25% inserters, ~25% machines (miners/smelters/assemblers on multi-input synthetic recipes), ~10% power (poles/generators/consumers across several networks).
- **Items in flight:** belts kept near-saturated so **millions of items** move (decoupled from `N` by §2) — this proves the item/entity decoupling, the whole point of FS-3.
- **Forced-active stress mode:** all `N` entities pinned `Active` (sleep disabled) so the benchmark measures the **raw SoA throughput floor** — the case where update-on-demand (§3) saves us *nothing*. This is the honest worst case; if 60 UPS holds here, it holds easily in real play where 85–95% sleep.
- **Realistic mode:** sleep enabled, ~10% active — to report the *expected* in-play headroom (we expect this to clear 60 UPS at far higher `N`).
- **Determinism harness:** run the same scene twice (and sharded vs single-threaded); assert identical state hash each tick (locally-deterministic gate for NW-4).

### 7.3 How UPS is measured

- The harness runs the fixed tick **as fast as possible** (uncapped) for a fixed wall-clock window and reports **achieved UPS = ticks / seconds**, plus **per-tick time distribution** (mean, p99, max) and **per-system breakdown** (which of the 7 systems costs what). We report the *sustained* rate over ≥30 s (not a burst), and the **max `N` that holds ≥60 UPS** (i.e. mean tick ≤ 16.67 ms, p99 ≤ ~16.67 ms).
- **Pass/fail:**

| Gate | Criterion |
|---|---|
| **PASS (scale claim retired)** | Forced-active mode sustains **≥60 UPS at N ≥ 100,000** (mean tick ≤ 16.67 ms, p99 ≤ 16.67 ms) over a 30 s window, single commodity desktop CPU, with millions of belt items in flight, **and** the determinism hash matches across runs/shardings. |
| **PARTIAL** | Holds 60 UPS at 100k only in *realistic* (sleep-on) mode, not forced-active → still validates the gameplay target (FS-6) + on-rails strategy, but the "100k *active*" headroom claim is qualified; report the forced-active ceiling. |
| **FAIL → escalate** | Cannot hold 60 UPS at 100k even with sleep on → FS-1/FS-6 wrong; escalate to Admin, revisit the sim approach (tighter SoA, more sharding, or lower the active-band target / lean harder on on-rails). |

### 7.4 The explicit render-wall note — sim scale ≠ render scale (R1)

**This benchmark proves only half the wall.** It proves the **sim** can step 100k entities + millions of items at 60 UPS. It says **nothing** about whether the GPU can *draw* them — and it can't, naively (MASTER_PLAN §6: "every 3D item is a mesh — naive = GPU death"; factory-sim.md R1). The two halves and their owners:

| Half | Owner | Mechanism | Proven where |
|---|---|---|---|
| **Sim scale** (step 100k entities + Nk items @ 60 UPS) | **factory-sim (us)** | SoA + transport-line + update-on-demand (§1–§3) | **This spike (Spike 3)** |
| **Render scale** (draw only what's worth drawing) | **rendering** | RN-3 LOD ladder: instancing → flow-material → impostor → not-drawn, fed by §6 stream | rendering's later spike, consuming §6 |

The seam between them is **§6's stream contract**: the sim emits state for *all* active entities, rendering's RN-3 ladder decides what to draw, and the **`GetLineItems`-at-LOD-0-only** rule (§6.2) means rendering's per-item cost collapses to O(visible lines) the moment you zoom past LOD-0 — so the sim's "millions of items" never becomes the GPU's problem. **Co-validation of both halves together is a Phase-1 integration task (factory-sim.md R1), not this spike.** Spike 3's job is to prove the sim half is real and hand rendering a stream that *lets* them solve their half. We flag (and do not solve here) that the integrated 100k *rendered* case must be co-tested with rendering before the scale claim is fully closed.

---

## 8. Step-by-step build plan + validation gates

Built so the **pure-CPU sim core is benchmarkable headless (Wave 0) before any UE work** — the scale claim is retired (or not) without the engine in the loop, de-risking fastest.

### Wave 0 — Headless pure-CPU sim core (NO UE) — *the de-risking wave*
1. **SoA tables + entity handles** (§1.2–1.3): the component arrays, archetype iteration, dense handles. Plain C++.
2. **Transport-line belt sim** (§2): line representation, gap-based item offsets, head/tail transfer, latched compression. Unit-test: a 100-tile line with 400 items advances in O(1) when flowing; item conservation holds across transfers (no items created/destroyed).
3. **Inserter + machine systems** (§1.4): synthetic recipes, multi-input, progress ticks.
4. **Power solve + brownout** (§4): networks, supply/demand, proportional brownout; `StubSolarProvider`.
5. **Update-on-demand** (§3): sleep states, edge-wakes, timed-wakes, the active index lists.
6. **Benchmark harness** (§7): scene generator, forced-active + realistic modes, UPS/per-system timing, determinism hash.

   **GATE G1 (the spike's whole point):** run §7 → does forced-active hold ≥60 UPS at 100k? Report the curve (UPS vs N) + per-system breakdown + the limiting system. **This is the pass/fail that retires the scale claim — before UE.**

### Wave 1 — On-rails + stream contracts (still headless-testable)
7. **`ISimProxy` chunk proxy** (§5): demote→snapshot, on-rails eval, promote→reconstruct. Unit-test no-dupe + buffer-bound + determinism across demote/promote cycles and across a simulated time-warp.
8. **Entity-state + delta/event streams** (§6): `StreamSystem` writes both ring buffers; a stub consumer drains and validates delta-replay reproduces the same state (NW-4 local-determinism check) and that LOD-1+ needs no per-item pulls.

   **GATE G2:** demote/promote a synthetic chunk over a long simulated elapsed time → buffers reconstruct identically, bounded by caps, zero dupes, deterministic in `TickIndex`.

### Wave 2 — Bind to Mass Entity in UE (confirm no regression)
9. **Rebind the SoA core onto Mass Entity** (D-001): fragments = our components, processors = our systems, archetypes = our entity types. Implement `ISimProxy` against core-engine's real registry (consume spike1-core-engine §5.3). Subscribe the tick to `ISimClock::OnFixedTick` (§5.4).
10. **Re-run the §7 benchmark inside UE** → confirm Mass Entity binding holds within a tolerance of the headless numbers (if Mass Entity adds unacceptable overhead, that's a D-001 finding to escalate — but the *algorithm* is already proven by G1).
11. **Publish the §6 contracts** as the rendering/networking hook points (events + ring buffers) for their later spikes to consume.

### Validation gates (acceptance)

| # | Proves | How | Pass criterion |
|---|---|---|---|
| **G1** | **Scale claim (the spike)** | §7 forced-active sweep, headless | ≥60 UPS at N≥100k, p99 ≤16.67 ms, over 30 s |
| **G2** | On-rails correctness (R2) | Demote/promote + time-warp on synthetic chunk | Buffers reconstruct deterministically, bounded by caps, **zero dupes** |
| **G3** | Item conservation | Long run with belts + inserters + machines | No item created/destroyed except by recipe; mass-balance holds |
| **G4** | Local determinism (NW-4) | Same scene ×2, single-thread vs sharded | Identical per-tick state hash |
| **G5** | Update-on-demand pays off | Realistic mode (10% active) vs forced-active | Realistic mode clears 60 UPS at far higher N (report the multiplier) |
| **G6** | Power brownout | Under-supply a network | All consumers scale by supply/demand; deterministic; no oscillation |
| **G7** | Stream decouples render cost | Drain stream at LOD-1+ | Zero per-item pulls above LOD-0; belt = material params only |
| **G8** | Mass Entity binding (D-001) | Re-run §7 inside UE | UE numbers within tolerance of headless G1 |

Instrument with a per-system microprofiler + CSV (so G1's limiting factor is *measured*, not guessed) and a state-hash logger (G4).

---

## 9. Risk retirement & honest assessment

**Is 100k active @ 60 UPS realistic? — Qualified yes, with the limiting factor named.**

- **The honest answer:** 100k entities at 60 UPS in **forced-active** mode on one CPU is **aggressive but achievable IF the hot path is genuinely SoA + branch-light + the belt cost is decoupled from item count (§2).** The reference point: a tight C-style archetype ECS does 100k boids (a *heavier* per-entity workload than a sleeping-friendly factory tick) in ~2.4 ms (§ refs) — that's a ~7× headroom under the 16.67 ms budget. Our per-entity work (integer progress increment, buffer check, gap decrement) is *lighter* than boids' neighbor search. **So the sim arithmetic is not the risk.**
- **The real limiting factor is memory bandwidth / cache behavior, not FLOPs.** At 100k entities × several hot arrays, the working set exceeds L2 and we become bandwidth-bound. The design mitigations (narrow hot components §1.3, no per-item objects §2, active-set iteration §3, chunk-sharding for cache-local parallelism §1.4) all target *this*, not arithmetic. **If G1 fails, it fails on bandwidth/cache-misses** — and the fix is tighter packing / better archetype locality, not a different algorithm. We expect the per-system breakdown to show `InserterSystem` (random-ish src/dst access) and `MachineSystem` (inventory writes) as the hot spots, with `BeltSystem` cheap (the §2 win).
- **The Mass Entity wrap is the second risk (G8).** The *algorithm* will pass headless (G1); whether **UE's Mass Entity adds enough overhead** (processor dispatch, fragment access patterns) to regress below 60 UPS at 100k is a genuine open question and a **D-001 stress point**. If headless passes but UE-bound fails, that's a *binding* problem to escalate (use a thinner Mass Entity path, or a custom SoA subsystem under UE rather than full Mass Entity) — **not** a refutation of the factory design. We deliberately prove the algorithm headless *first* so this risk is isolated and attributable.
- **R1 (the render wall) is NOT retired by this spike and we say so plainly (§7.4).** Sim scale ≠ render scale. We retire the *sim* half and pin the §6 stream that lets rendering retire the *render* half later. The integrated 100k-*rendered* case is a Phase-1 co-validation with rendering — the single biggest cross-risk, explicitly left open and owned jointly.
- **R2 (on-rails dupes/exploits):** addressed by the buffer-cap bound + deterministic `TickIndex` reconstruction + conservative under-fill (§5.3); validated by G2. Residual risk: rate-model *accuracy* for complex multi-stage recipes (a deep recipe chain's true steady-state ≠ naive bottleneck rate) — flagged as a Phase-2 refinement, harmless for the spike's synthetic recipes.
- **Determinism residual:** the brownout float is the one non-integer in the hot path; we apply it as a fixed-point per-network scalar in fixed order so it stays locally deterministic (G4 guards this). If G4 ever fails, the float brownout is the prime suspect and gets fully fixed-point.

**Bottom line:** the scale claim is **probably true and cheaply falsifiable** — Wave-0/G1 tells us in days, headless, before any UE cost. The dominant residual risks are (a) the **render wall**, owned jointly with rendering via the §6 stream (not solved here, by design), and (b) the **Mass Entity binding overhead** (G8), isolated from the algorithm by the headless-first plan. Nothing here threatens FS-1; the most likely surprise is needing a thinner-than-full-Mass-Entity SoA path under UE, which is a D-001 detail, not a re-scope.

---

## 10. References

- **Factorio belt internals** — [FFF-176: Belts optimization for 0.15](https://www.factorio.com/blog/post/fff-176) (transport-line merging; store *gaps* not absolute positions; "increment/decrement terminal gap sizes, do not touch items"; latched compression; amortized-constant w.r.t. items × lines). [Transport belts / Physics (wiki)](https://wiki.factorio.com/Transport_belts/Physics) (256 positions/tile, 64-unit saturation spacing, 4 items/tile/lane, speed in positions/tick by tier, two independent lanes, splitter 128+51 buffer).
- **ECS throughput** — custom C archetype ECS ~2.4 ms vs managed ECS ~44 ms for 100k boids ([80.lv coverage](https://80.lv/articles/developer-s-ecs-in-custom-c-engine-outperforms-unity-s-dots)); [Unreal Mass Entity community sample](https://github.com/getnamo/MassCommunitySample) (archetype/fragment model, "tightly packed arrays of identical fragment arrangements"). The lesson folded in: **data layout, not language, is the order-of-magnitude lever** — design for the tight-SoA regime.
- **Cross-domain contracts consumed/pinned:** [spike1-core-engine.md](spike1-core-engine.md) §3 (SimProxy promote/demote + hysteresis), §4 (SimClock fixed tick + Alpha + TickIndex), §5 (ISimClock/ISimProxy/UniverseCoord pinned). [spike1-rendering.md](spike1-rendering.md) §5.4 (RN-3 factory LOD ladder), §4.2 (FAtmosphereProfile for solar). [MASTER_PLAN](../MASTER_PLAN.md) §3 (active/on-rails), §6 (factory + power), §11 (D-003 on-rails, D-005 scope).
- **Research method:** two targeted web searches + two source fetches (Factorio FFF-176 + belt-physics wiki for the belt/update-on-demand mechanics; ECS throughput comparison for the 100k feasibility anchor). Folded into §2 (belt math), §3 (update-on-demand), §9 (feasibility). Logged in factory-sim.md §8.

---

## 11. Phase-1 contract closures (C-2, C-5, C-6, C-8)

> **Added 2026-06-14 (FS-10).** Phase-1 reconciliation round (PHASE1-PLAN §10 register). These close factory-sim's side of four Phase-1 contracts. All are **additive** — they pin/confirm schemas and behaviours the spike already implies; **no Phase-0 pinned contract changes**. Gameplay *proposed* shapes for C-2 in [gameplay-phase1.md](../phase1/gameplay-phase1.md) §8.B; persistence specified the `IPersistable` form in [persistence-phase1.md](../phase1/persistence-phase1.md) §2–4; the §10 register routes C-8 as a joint pick with core-engine + persistence. **We DEFINE + EXECUTE the schemas; gameplay AUTHORS the content.**

### 11.1 C-2 — PIN `FRecipeDef` + `FEntityDef` (factory-sim owns the schema; gameplay authors content)

The spike ran on synthetic recipes keyed by an integer `recipeId` into `MachineProc.recipeId` (§1.3). Phase 1 needs the **real data-driven schema**. We pin it. **Ownership split (the C-2 contract):** factory-sim **defines the loadable schema and executes it** (the recipe drives `MachineProc`/`Inventory`; the entity def drives placement footprint, IO ports, and power); **gameplay authors the content/balance values** ([gameplay-phase1.md](../phase1/gameplay-phase1.md) §7 item/recipe set). `ItemId` is **gameplay's opaque C-3 handle** — factory-sim treats it as an uninterpreted `uint16` key into machine inventories (§1.3 `Inventory.slotItem`); it never decodes what an `ItemId` *means*.

```cpp
// ── C-2 PINNED — factory-sim DEFINES + EXECUTES this schema; gameplay AUTHORS values. ──

// An (ItemId, count) pair. ItemId is gameplay's C-3 opaque handle — factory-sim never interprets it.
struct FItemStack {
    uint16 ItemId;     // C-3 opaque handle (gameplay-owned registry). Factory-sim = uninterpreted key.
    uint16 Count;
};

// A recipe: what a machine consumes/produces, how long it takes, and which machine class runs it.
struct FRecipeDef {
    uint16     RecipeId;          // dense key → MachineProc.recipeId (§1.3); the executed handle
    uint16     MachineTypeId;     // which FEntityDef.MachineTypeId class may run this recipe
    FItemStack Inputs[K_IN];      // (ItemId, count)[] consumed per craft — small fixed K_IN (e.g. ≤4, matches Inventory K)
    uint8      InputCount;        // # valid entries in Inputs
    FItemStack Outputs[K_OUT];    // (ItemId, count)[] produced per craft — small fixed K_OUT
    uint8      OutputCount;
    uint32     CraftTimeTicks;    // craft duration at full power (×brownoutFactor at run time, §4.2)
    int32      PowerW;            // demand while crafting → PowerNode.demandW (§1.3, §4)
};

// A machine/placeable definition: its class, recipe capacity, power, footprint, and IO ports.
struct FAABB { FVector3f Min, Max; };            // local-space footprint box (also backs §1.3 StaticDef.AABB,
                                                 //   the §5.4 PromotionRadius() override, and the §6.2 BoundRadius)
struct FPortDef {
    FVector3f  LocalPos;          // port location in entity local space (for §3.3 legibility + belt/inserter binding)
    FVector3f  LocalDir;          // facing (outward) — used to snap belt/inserter connections
    uint8      Kind;             // EPortKind: ItemIn | ItemOut | PowerIn | PowerOut | FluidIn/Out (fluids Phase 4)
};
struct FEntityDef {
    uint16     TypeId;            // == FFactoryEntityState.TypeId (§6.2) → rendering asset; dense entity-class key
    uint16     MachineTypeId;     // recipe-eligibility class (machines); 0/none for passive entities (belt, pole, box)
    uint8      RecipeSlots;       // # concurrent recipe slots (1 for smelter/assembler in the slice; 0 for non-crafters)
    int32      IdlePowerW;        // standing draw when not crafting (0 for unpowered entities) → PowerNode.demandW
    FAABB      Footprint;         // placement/collision/LOD AABB (the single bounds source, §1.3 / §5.4 / §6.2)
    FPortDef   Ports[K_PORT];     // IO port layout — item/power ports for connection + §3.3 port-legibility
    uint8      PortCount;
    // gameplay-authored placement/UX fields it appends (BuildCost FItemStack, SlopeToleranceRad) live in
    //   gameplay's authoring asset (§8.B) and are NOT executed by the sim — gameplay reads them for the ghost.
    //   Factory-sim executes ONLY the fields above (class, recipe capacity, power, footprint, ports).
};
```

**Notes that pin the boundary:**
- **`FItemStack`** is the shared (ItemId, count) pair gameplay's inventory (`gameplay-phase1.md` §4.1) and our machine `Inventory` (§1.3) both use — one item-id space (C-3). We **execute** against `ItemId` as an opaque key only.
- **The footprint/AABB is one source of truth.** `FEntityDef.Footprint` is the *same* AABB that (a) §1.3 `StaticDef.AABB` stores per entity, (b) §5.4's `PromotionRadius()` override sums into the chunk bounding sphere, and (c) §6.2's `BoundRadius` packs to 2 B for rendering. C-2 doesn't add new bounds data — it names the schema field the existing data comes from.
- **IO port layout** (`FPortDef[]`) is consumed by gameplay's §3.3 port-legibility (gameplay reads *where* ports are from the def + the entity `Orientation`) and by our belt/inserter binding (which port a `PlaceBelt`/inserter snaps to). Factory-sim owns the executed geometry; gameplay owns presentation.
- **Gameplay's `FEntityDef` in §8.B** carries extra *authoring* fields (`BuildCost`, `SlopeToleranceRad`) that are **gameplay-evaluated, not sim-executed**. The split: our `FEntityDef` is the **executable schema**; gameplay's authoring asset is a superset that *also* carries UX/cost fields the sim ignores. Both reference the same `TypeId` and the same `Ports`/footprint. **Routed to gameplay (REPORT): confirm the authoring asset is a superset of this executable schema, sharing `TypeId`/`Ports`/footprint verbatim.**

### 11.2 C-5 (our side) — CONFIRM: every gameplay intent → a server-authoritative sim mutation at a tick boundary

**Confirmed.** Gameplay's player command/intent APIs ([gameplay-phase1.md](../phase1/gameplay-phase1.md) §8.E) are **commands, not state writes** (D-004-clean). Factory-sim is the **single authority**: an intent is a *request* that the sim **validates** and then **applies as a mutation at the next fixed-tick boundary** (`ISimClock::OnFixedTick`, §1.4). **No intent mutates entity state directly** — gameplay never holds a writable pointer into the SoA arrays; it enqueues an intent, the sim drains the intent queue at a deterministic point in the tick, validates, and either applies (emitting the matching `FFactoryDelta`, §6.3) or rejects (no state change, optional rejection feedback). This keeps the sim locally deterministic (NW-4): intents are exactly what a client sends a server.

| Gameplay intent (§8.E) | Validated against | Sim mutation applied at tick boundary | Delta emitted (§6.3) |
|---|---|---|---|
| `IFactoryBuildIntent{TypeId, At, Orient, Deposit?}` | footprint clear, on-surface, (miner) overlaps deposit | allocate entity in SoA archetype (§1.2–1.3); init `MachineProc`/`Inventory`/`PowerNode` from `FEntityDef` (§11.1) | `EntityPlaced` |
| `IPlaceBeltIntent{Path[]}` | each cell placeable, endpoints snap to compatible ports | create/extend/merge `TransportLine`(s) (§2); bind to source/sink ports | `EntityPlaced` (+ `BeltStateChanged` if it joins a flow) |
| `IRemoveEntityIntent{Entity}` | entity exists, removable | free SoA slot (generation bump, §1.2); split/retire affected `TransportLine`; rebuild power membership | `EntityRemoved` |
| `ISetRecipeIntent{Machine, RecipeId}` | machine exists, `RecipeId.MachineTypeId == machine class` (§11.1) | set `MachineProc.recipeId`; reset progress; re-evaluate inputs → wake or sleep (§3) | `RecipeChanged` |
| `ITransferItemsIntent{Entity, Slot, Stack, ToPlayer}` | slot valid, count available either side | move items between machine `Inventory` slot and the player record (gameplay-owned side) | `InventoryChanged` |
| `QueryEntityInventory(Entity) → view` (**READ**) | entity exists | **none** — read-only snapshot of `Inventory` for the transfer panel | (none) |

- **`QueryEntityInventory` is a pure read** — it returns a read-only view of the entity's `Inventory` (§1.3) for gameplay's transfer panel (§4.3); it never schedules a mutation. (Consistency note: it reads committed state — i.e. last completed tick — so the panel can't observe a torn mid-tick write.)
- **Determinism preserved:** intents are drained in a deterministic order (arrival order stamped, then a fixed tie-break) at a fixed point in the tick, so two clients applying the same intent log reach the same state — the C-5 property networking later relies on (NW-4). **No core-engine or gameplay contract changes; we confirm we honor the command/authority model.**

### 11.3 C-6 (our side) — CONFIRM `IPersistable`: per-entity SoA (active) / `FRailState` (on-rails)

**Confirmed.** Factory-sim implements persistence's `IPersistable` ([persistence-phase1.md](../phase1/persistence-phase1.md) §2, §2.1) as a **chunk-scoped** domain (`DomainId = FactorySim`), serializing **per factory chunk** in exactly the two forms the chunk already exists in (§5) — **no new persistence surface, we reuse the demote/promote machinery**:

- **Active chunk → full per-entity SoA.** `SaveDiffs(key)` writes the chunk's SoA records: per entity `TypeId` + `Transform{gx,gy,gz,dir}` + `MachineProc{recipeId, progressTicks}` + `Inventory{slotItem[],slotCount[]}` + `InserterState` + `PowerNode` membership, **plus** per-`TransportLine` contents (`headGap/tailGap/itemGaps[]/itemTypes[]/fullyCompressed`, §2). `LoadDiffs(key)` rebuilds entities directly into the SoA archetypes (exact restore). Packing is our natural compact binary (varint `itemGaps[]`, §2.2) into persistence's `FSaveWriter` cursor — persistence frames/versions the buffer; it never interprets it.
- **On-rails chunk → `FRailState`.** `SaveDiffs(key)` writes the compact `FRailState{inputRates/outputRates/bufferLevels/bufferCaps/snapshotTick/brownoutAvg}` (§5.2). `LoadDiffs(key)` seeds the proxy with it; the chunk stays on-rails until core-engine's bubble promotes it, at which point `OnPromote` reconstructs per-entity buffers **bounded by `bufferCaps`, deterministically, zero dupes** (§5.3, gate G2). Persistence **rebases `snapshotTick` to the loaded `TickIndex`** so load is not a phantom time-warp ([persistence-phase1.md](../phase1/persistence-phase1.md) §4.4).
- **Which form is written is whatever the chunk *was* at the save-quiesce tick** — save is "demote to disk," load is "restore proxy state, let the existing promote path reconstruct on approach." **This inherits R2's no-dupe guarantee (G2) at no new cost** — persistence adds no dupe surface (their R1). **`SchemaVersion()`** is bumped by us on any change to the per-entity or `FRailState` packing (PS-4, append-only field discipline). **Chunk granule aligns to `FChunkKey.RegionDepth` per C-8 (§11.4).**

### 11.4 C-8 — factory chunk spatial extent (so core-engine sets `RegionDepth`: 1 save region ≈ 1 chunk)

**Stated extent: a factory chunk is a ~1 km × 1 km surface footprint on a body** (≈ 1 km on a side in the local surface-tangent plane; the AABB adds the build-height stack, a few tens of metres, in the radial axis). **Bounding-sphere half-extent ≈ 0.7 km** (= the §5.4 `PromotionRadius()` value, ½·‖AABB diagonal‖ ≈ 0.71 km for a 1 km square).

**Why 1 km (the C-8 rationale):**
- **Fits inside the activate band as a unit.** Core-engine's bubble is **2 km activate / 3 km deactivate** ([spike1-core-engine](spike1-core-engine.md) §3.2). A chunk whose half-extent is ~0.7 km is **comfortably smaller than the 2 km activate radius**, so the whole chunk promotes/demotes together (FS-7) without the bounding sphere overrunning the band — the `PromotionRadius()` override (§5.4) nudges promotion slightly early (safe, the touchability direction) but a 0.7 km radius never swamps a 2 km band.
- **One slice factory ≈ one (or a few) chunks.** A Phase-1 slice factory is hundreds–low-thousands of entities ([PHASE1-PLAN](../phase1/PHASE1-PLAN.md) §3, P1-D3). At ~3–5 m machine spacing a 1 km² footprint holds well over the slice's entity count, so the home factory lands in **one chunk → one save region → one `.ofc` file** — exactly persistence's "a slice-scale factory lands in one or a few chunk files" target ([persistence-phase1.md](../phase1/persistence-phase1.md) §3.1, "coarse `RegionDepth`").
- **Decoupled from render LOD.** This is a **save/sim granule**, independent of render quad depth (which subdivides to ~1 m). It matches persistence's stated intent that `RegionDepth` is "fixed and coarse, independent of render LOD."

**The `RegionDepth` ask (routed to core-engine + persistence — REPORT; now LOCKED, see below):** the depth-to-metres mapping is **body-radius-dependent** (a face quad at depth `d` on a body of radius `R` has edge ≈ `(π·R/2)/2^d`), so **core-engine picks `RegionDepth` per body** to make one region's quad ≥ our **~1 km** chunk extent at the body's surface (smallest depth with region edge ≥ E). Given our confirmed factory-chunk extent **E ≈ 1 km**, core-engine fixed the depth per body as `floor(log2(R·(π/2)/E))`: **Forge (`R ≈ 600 km`) → `RegionDepth` = 9** (edge ≈ `(π·600 km/2)/512 ≈ 1.84 km`); **Cinder (`R ≈ 200 km`) → `RegionDepth` = 8** (edge ≈ 1.23 km) — both locked per [PHASE1-PLAN](../phase1/PHASE1-PLAN.md) §10 (2026-06-14; this REPORT previously estimated ≈10 for Forge, which sat just *below* the 1 km target — core-engine's "smallest depth ≥ E" rule lands one level shallower at 9). **We align our factory-chunk granule (the `ISimProxy`/`FChunkKey` unit, FS-7) to whatever `RegionDepth` core-engine fixes** so 1 save region == 1 factory chunk proxy verbatim — the chunk key is `truncate(FQuadKey, RegionDepth)` ([persistence-phase1.md](../phase1/persistence-phase1.md) §3.1), no separate index. **The metric target is 1 km; the depth integer is core-engine's per-body pick — we conform to it, we do not set it.**
