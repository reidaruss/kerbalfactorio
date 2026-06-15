# Gameplay Phase-1 — Player-Facing Systems for the "First Foundry" Vertical Slice

> **Domain owner:** `gameplay-controller` · **Phase:** 1 · **Status:** Designed, ready to build · **Contracts C-3 pinned · C-4/C-5 finalized · slice content pinned** · **Last updated:** 2026-06-14
> **Owner doc:** [gameplay.md](../controllers/gameplay.md) · **Integration blueprint:** [PHASE1-PLAN](PHASE1-PLAN.md) (§2 loop, §3 scope, §4 P1-D1…D6, §6 our job, §8 open Qs)
> **Consumed pinned contracts:** physics `FVesselOrbitalState` ([spike2-physics](../spikes/spike2-physics.md) §8.2) · factory-sim entity-state + production outputs + recipe approach ([spike3-factory-sim](../spikes/spike3-factory-sim.md) §1.4, §6, §4) · world-gen deposit catalog + `FBodyParams` ([spike1-worldgen](../spikes/spike1-worldgen.md) §4–5, §5) · core-engine frames/coords + events ([spike1-core-engine](../spikes/spike1-core-engine.md) §5, §2.3)
>
> **This document is the first design pass for the net-new gameplay domain.** It gates whether the Phase-1 slice is *playable*. It designs **within** the locked decisions P1-D1…D6 and **consumes** the closed Phase-0 interface surface; every NEW cross-domain contract it needs is flagged in §8 for Admin to route — it does not unilaterally define another domain's API.

---

## 0. Scope of this design

**IN (this doc designs):** the on-foot/in-craft avatar + camera + control mapping and the handoff between them; node-based mining UX; 3D build/placement UX (ghost, validity, grid-snap-to-surface, free-rotate, 3D legibility); inventory + hand tools; the minimal HUD + the no-scene-transition map/orbital readout; the slice objective + onboarding feedback; the minimal item/recipe content stubs; and the consumed/provided interface list incl. the new command/intent + recipe-data + progress schemas.

**OUT (not designed here — deferred per PHASE1-PLAN §3 / P1-D4):** research/tech tree, science packs as a *gate*, quests, loot/POIs, time-warp UX, multiplayer, the part-by-part craft editor (P1-D2 gives us a fixed pre-fab lander instead), voxel-dig UX. The Cinder-only resource is in scope **only** as the off-world *identity hook* (P1-D4), not as a tech gate.

**Design stance.** Gameplay owns *rules, content, and screens*. It never produces sim numbers (physics/factory-sim/world-gen do) and never renders the 3D scene (rendering does). So every interaction in this doc resolves to one of three things: (a) **read** a pinned data stream and present it, (b) **emit a player intent/command** to the owning sim, or (c) **own a piece of player state** (inventory, selection, objective progress) and hand its serialization to persistence. This keeps gameplay a thin, data-driven layer over the closed substrate — the AGENT_ARCHITECTURE prime directive applied to a net-new domain.

---

## 1. Avatar, camera & controls (P1-D1)

**Decision GP-6 (Accepted): two avatar modes, one continuous body.** The player is always the same `FEntityId`; what changes is which sim owns its motion and which camera rig renders it.

| Mode | Perspective (P1-D1) | Motion owner | Camera |
|---|---|---|---|
| **On foot** | **First person** | physics character capsule ([spike2-physics](../spikes/spike2-physics.md) §6) | FP camera at capsule eye height; head-bob off (factory legibility) |
| **In craft** | **Third person** (orbit-follow) with an **IVA toggle** (in-vehicle cockpit view) | physics rigid-body craft ([spike2-physics](../spikes/spike2-physics.md) §3) | TP boom-arm framing the craft against the horizon/orbit; IVA = FP camera locked to the cockpit part |

Rationale is exactly P1-D1: first person suits the close, precise work (mining, build placement, reading a belt) where you want to be *at* the machine; third person suits flight where you need to read attitude, the ground line, and the orbit at a glance. IVA is a cheap toggle (a camera socket on the command-pod part) — not a modeled interior, just the framing.

### 1.1 Control mapping (the two schemes)

The mapping is **data-driven** (a rebindable `FInputContext` per mode) so balance/feel iterates without code. The slice ships two contexts:

- **On-foot context:** WASD surface-tangent move, mouse look, jump (low-g on Cinder feels distinct — same control, physics gives the difference), interact (E), primary tool action (LMB — mine / place), secondary (RMB — rotate ghost / cancel), tool/hotbar select (1–5, wheel), open inventory (Tab), board craft (F when in range), toggle map (M).
- **In-craft context:** throttle (Shift/Ctrl), pitch/yaw/roll (WASD + Q/E or mouse-steer), translation/RCS (IJKL), stage/activate (Space), toggle IVA↔TP (V), toggle map (M), disembark (F when landed and near-stationary).

The contexts are **mutually exclusive** — the active context is a function of the avatar mode, switched by the handoff (§1.2). Gameplay owns the *binding table and the intent it emits*; it does **not** integrate motion — every control resolves to a command in §8 (`ICraftControlIntent` / `ICharacterMoveIntent`) that physics consumes.

### 1.2 The on-foot ↔ in-craft handoff (coordinates with physics's character↔craft handoff)

physics already owns the *physics* of this seam — "Transition walk↔board: out of spike scope as a *mechanic* (gameplay owns it); the *physics* (character on rails-frame, craft active) is what we provide" ([spike2-physics](../spikes/spike2-physics.md) §6). So the split is clean: **gameplay owns the mechanic/trigger/UX; physics owns the state change.**

**Board (on-foot → in-craft):**
1. Player is on foot within an interaction radius of the craft's board trigger (a tagged hatch part on the pre-fab lander) and presses F. Gameplay raises a `BoardCraft` intent (`IBoardIntent`, §8) naming the craft `FEntityId`.
2. physics parents/disables the character capsule and gives control authority to the craft rigid body (the craft is already an `Active` `ISimProxy`; the character was `Active` too — physics reconciles which one the camera/controls follow).
3. Gameplay swaps the input context to **in-craft**, swaps the camera rig to **TP/IVA**, and switches the HUD to **flight layout** (§5).

**Disembark (in-craft → on-foot):** symmetric, gated on **landed + near-stationary** (physics reports contact + low speed; CE-6 `frameVelocity` bled to ~0 — [spike1-core-engine](../spikes/spike1-core-engine.md) §1.5). Gameplay raises `DisembarkIntent`; physics spawns/re-enables the capsule at a hatch egress point on the surface; gameplay swaps context/camera/HUD back to on-foot. Disembark while in flight or at speed is **refused** (HUD shows "cannot disembark in flight") — the *gate* is gameplay's rule; the *can-I* fact (landed/slow) is read from physics.

**Seam invariants gameplay must honor:** the handoff must be silent (no loading screen — pillar 1). Gameplay does nothing during the frame physics re-anchors authority except suppress input for that tick and skip camera interpolation across the rig swap (mirrors core-engine's `rebasedThisTick` anti-pop discipline — [spike1-core-engine](../spikes/spike1-core-engine.md) §4.3). **No new physics interface is needed beyond the two intents in §8** — the underlying character↔craft state change is physics's existing capability; we only command it.

---

## 2. Mining UX (node-based) — consumes the world-gen deposit catalog

Per D-005 / MASTER_PLAN §9 the slice is **node-based mining, no voxel dig**. The loop step (PHASE1-PLAN §2.1–2.2): on foot, find a deposit → place a miner on it → ore flows onto a belt.

### 2.1 What gameplay reads (the deposit catalog)

world-gen publishes a **Deposit/POI catalog** (positions, types, depletion state) to factory-sim and gameplay ([world-gen.md](../controllers/world-gen.md) §5, Phase 1). Spike 1 deferred deposits, so **the concrete catalog struct is not yet pinned** — gameplay needs it pinned this phase and flags it in §8 as a contract to co-define with world-gen. The shape gameplay consumes (proposed in §8.A) carries, per node: `FUniverseCoord` position + surface normal, a `Resource` (an `ItemId` directly — C-1/WG-11: Resource is the ItemId directly), a richness/grade, and a remaining-amount (the depletion state that becomes a persistence diff per WG-3).

### 2.2 The mining interaction

1. **Target.** On foot, the player aims at terrain; when the reticle is over (or near) a catalogued deposit node, gameplay shows a **deposit tooltip**: resource name, grade, remaining %, and "place miner here." Discovery is *proximity + look*, not a separate scanner UI (scanning depth is Phase 4 exploration-science, OUT here).
2. **Place a miner.** The miner is a factory entity, so mining placement **is** build placement (§3) with one extra rule: the miner's footprint must overlap a deposit node, and gameplay tags the placement intent with the node's `Resource` (an `ItemId`; C-1/WG-11: Resource is the ItemId directly) — actually just the `FDepositId` it sits on, from which factory-sim reads the deposit's `Resource`. A miner placed off any node is **invalid** (red ghost) with the reason "no deposit." This is the only placement-validity rule gameplay adds on top of the generic surface/clearance rules — and it's a *gameplay rule*, evaluated against the world-gen catalog, not a sim rule.
3. **Operate.** Once placed and powered, the miner is an ordinary factory machine: factory-sim runs its `MachineProc`, emits ore on `MachineCompleted`, and the player's only further interaction is connecting its output to a belt (§3.5). Gameplay does **not** simulate extraction — it reads the entity's `FFactoryEntityState.VisualState` (idle/working/blocked/no-power — [spike3-factory-sim](../spikes/spike3-factory-sim.md) §6.2) to drive feedback.

### 2.3 Player feedback

- **On the node:** a subtle world-space marker (gameplay requests rendering draw it from the catalog position) so deposits are findable without a minimap.
- **On the miner:** the factory `VisualState` already encodes working/blocked/no-power; the HUD power/resource panel (§5) surfaces the *flow* (ore/s) read from the production stream. A depleting node shows remaining % falling; at zero the miner goes `blocked` and the node is greyed.
- **The teaching beat:** the *first* miner the player places auto-highlights its output port and prompts "connect a belt" (onboarding, §6).

---

## 3. Build / placement UX in 3D (P1-D6) — grid-snap-to-surface + free-rotate, and 3D legibility (R2)

This is gameplay's hardest UX problem and the home of **R2** (3D build legibility vs Factorio's 2D clarity) and **P1-D6** (grid-snap-to-surface with free-rotate). The five placeable entities for the slice (P1-D3): **miner, belt, smelter, assembler, box** + the **power source** (generator) and **power pole** to make brownout real.

### 3.1 Research basis (cited)

One scoped research thread (two web searches) into how shipped 3D factory builders solve this:

- **Perspective split matches P1-D1.** Satisfactory builds in **first person**; Dyson Sphere Program builds in **third person** — confirming that close build/mining work pairs with first person (our on-foot mode) and that the two idioms are both proven ([Steam: Satisfactory vs DSP](https://steamcommunity.com/app/526870/discussions/0/3543798390534136123/), [Wikipedia: Dyson Sphere Program](https://en.wikipedia.org/wiki/Dyson_Sphere_Program)).
- **Color-coded validity hologram.** Satisfactory's Build Gun projects a **hologram (ghost)** colored **blue = valid, red = hard clearance (blocked), yellow = soft clearance (allowed-but-overlapping-ish)** ([Satisfactory Wiki: Build Gun](https://satisfactory.wiki.gg/wiki/Build_Gun), [Modding docs: Buildable Holograms](https://docs.ficsit.app/satisfactory-modding/latest/Development/Satisfactory/BuildableHolograms.html)).
- **Highlighted I/O is the 3D-legibility key.** The hologram **highlights conveyor/pipe inputs, outputs, and power connectors** — i.e. in 3D you recover Factorio's "I can see what connects to what" by making *ports* visually first-class, not by a top-down grid ([Satisfactory Wiki: Build Gun](https://satisfactory.wiki.gg/wiki/Build_Gun)).
- **Snap modes.** A **Vertical** build mode and a **Snap-to-Guideline** key let you align to existing structures' surfaces/axes instead of free-handing every transform ([Satisfactory Wiki: Build Gun](https://satisfactory.wiki.gg/wiki/Build_Gun)).

These four patterns are adopted directly below.

### 3.2 The placement model (P1-D6)

**Decision GP-7 (Accepted): grid-snap-to-the-local-surface-tangent with free-rotate, ghost-first.** Concretely, while a placeable is selected the player carries a **ghost** that:

1. **Projects to the surface** under the reticle. Gameplay raycasts the terrain via world-gen's `RaycastTerrain` ([spike1-worldgen](../spikes/spike1-worldgen.md) §4.3) to get the surface point + normal (and the new `SlopeRad`/`SurfaceHardness` fields, RC-7).
2. **Snaps to a body-local surface grid.** The ghost's position quantizes to a grid laid out in the **surface-tangent plane** at the reticle (the plane ⟂ to the local radial-up `r̂`). The entity's "up" aligns to `r̂` (or to the surface normal — a toggle), so machines sit flat on the planet/moon. This is the literal reading of P1-D6: snap factory parts to the local terrain tangent.
3. **Free-rotates** about the local up axis in fixed increments (default 15°, hold a modifier for free/1° rotation) so belts/machines can face any heading — the "free-rotate" half of P1-D6.
4. **Validity-colors the ghost** (GP-8, the R2 answer): **green/blue = valid**, **red = invalid (hard reason)**, **yellow = warning (soft reason)** — mirroring Satisfactory. Reasons surfaced in a small ghost label: `slope too steep` (from `SlopeRad` > entity tolerance), `overlaps existing entity`, `no deposit` (miner only, §2), `no surface`, `out of reach`. Slope tolerance is a per-entity-type number in the entity def (data-driven).

### 3.3 Recovering Factorio's 2D legibility in 3D (R2 — the core answer)

Factorio is legible because a top-down grid makes *adjacency and flow direction* instantly readable. In 3D on a curved surface you lose the free top-down read. Gameplay recovers it with **four** mechanisms, not one:

1. **Ports are first-class.** Every machine ghost and every placed machine shows its **input ports (one color) and output ports (another)** as glowing markers, and belts show a **directional flow arrow**. This is the Satisfactory insight: you read connectivity from *highlighted I/O*, not from a grid. (Gameplay requests rendering draw these port/arrow decals; gameplay supplies *where* they are from the entity def + the factory entity-state `Orientation`.)
2. **Connection preview.** While ghosting a belt, gameplay draws a **predicted connection line** snapping the belt's endpoints to the nearest compatible output→input ports within range (Satisfactory's snap-to-guideline, generalized to ports). If the belt would connect, the target port pulses; if not, the belt end shows "unconnected."
3. **A build-mode overlay camera (the no-top-down compromise).** Holding the build key raises an optional **pulled-back, slightly-top-down build camera** (still in-world, no scene transition) that tilts toward the local surface normal — giving a near-orthographic read of the local factory patch *without* leaving first person as a mode. This is gameplay's bridge between FP precision and Factorio's planform clarity. (It is a *camera* request to rendering, not a new scene.)
4. **A flow/logistics tint mode.** A toggle that asks rendering to tint belts by their `FBeltFlowState` (`Density`/`Compressed` — [spike3-factory-sim](../spikes/spike3-factory-sim.md) §6.2) and machines by `VisualState`, so the player reads "what's starved / backed up / unpowered" at a glance — the 3D analogue of Factorio's alt-mode overlay. Pure presentation over an existing stream; no new sim data.

> **R2 verdict for playtest (P1-D6 / factory-sim R3):** the slice validates *grid-snap-to-surface + highlighted ports + connection preview + build overlay camera* as the legibility package. If playtest shows it's still hard to read flow on a curved surface, the cheap escalation is to lean harder on mechanism 3 (a flatter/stronger build camera) before considering any "flatten-a-build-pad" feature — explicitly **not** designed here.

### 3.4 Ghost → commit (what gameplay emits)

When the ghost is valid and the player commits (LMB), gameplay raises a **`PlaceEntityIntent`** (`IFactoryBuildIntent`, §8) to factory-sim carrying: `TypeId`, the snapped `FUniverseCoord` + `FQuat` orientation, and (miner only) the underlying `FDepositId` (factory-sim reads that node's `Resource`, an `ItemId`, directly — C-1/WG-11: Resource is the ItemId directly). **Gameplay does not create the entity** — factory-sim does, emits `EntityPlaced` on its delta stream ([spike3-factory-sim](../spikes/spike3-factory-sim.md) §6.3), and the entity then appears in the entity-state stream that rendering draws. Gameplay's ghost is purely a *preview*; the authoritative entity is factory-sim's. Removal (RMB on a placed entity in build mode) raises `RemoveEntityIntent`; configuration (set a smelter/assembler's recipe) raises `SetRecipeIntent`.

### 3.5 Belts as a special placement

Belts are placed as a **drag** (click start port → drag → click end), not a single stamp, because they're a path. Gameplay snaps each end to ports (§3.3.2) and emits a `PlaceBeltIntent` describing the polyline of grid cells; factory-sim merges them into a `TransportLine` ([spike3-factory-sim](../spikes/spike3-factory-sim.md) §2) — gameplay never sees the line internals, only that a belt now exists and flows (read back via `FBeltFlowState`).

---

## 4. Inventory + hand tools

**Decision GP-9 (Accepted): a small fixed-slot inventory + a unified "build tool" hotbar.** Minimal, data-driven, persistence-friendly.

### 4.1 Item representation

An item stack is `{ ItemId (uint16); Count (uint16) }` — the *same* `ItemId` space factory-sim uses for recipe inputs/outputs ([spike3-factory-sim](../spikes/spike3-factory-sim.md) §1.3 `Inventory.slotItem`). **One shared item-id registry across gameplay inventory and factory machine inventories** (flagged in §8.C — this must be co-owned with factory-sim so a "Cinder ore" item is the same id in the player's pack and in a smelter's input). The player inventory is `N` fixed slots (slice: ~20), each an item stack; no weight, no volume, no logistics depth (those are later).

### 4.2 Hand tools (the hotbar)

The slice has **one tool — the build/mine tool** — bound to hotbar slots 1–5 that select *what to place* (miner / belt / smelter / assembler / box / generator / pole — a scrollable build palette). LMB = place-ghost or mine; RMB = remove/rotate. There is no weapon, no separate mining-laser item (mining is "operate a placed miner," not a hand-held drill, per the node-based model). This keeps the tool surface tiny and the loop focused.

### 4.3 Carry / transfer

- **Pick up from a box:** interact (E) on a placed box opens a **transfer panel** (player inventory ↔ box inventory). The box's contents are read from its `FFactoryEntityState`/inventory via a `QueryEntityInventory` read (a gameplay→factory-sim *read*, not a sim change). Moving a stack raises a `TransferItemsIntent` (§8) — factory-sim mutates the box inventory authoritatively and emits `InventoryChanged`.
- **Hand-feed / hand-pull:** the same transfer panel works on any machine with an inventory (e.g. manually top up the first smelter before belts exist) — this is the onboarding bridge (§6) before automation is set up.
- **Build cost:** placing an entity consumes its item stack from the player inventory (data-driven cost in the entity def). The first few entities are pre-stocked (§7) so the player can build immediately without first mining by hand.

Inventory and box transfers are the player-state gameplay *owns*; their serialization goes to persistence (§8.D).

---

## 5. Minimal HUD + map (R3 — the no-scene-transition map)

Two HUD layouts, switched by avatar mode (§1), plus one shared overlay (the map). All of it is **presentation over pinned streams** — gameplay computes nothing physical.

### 5.1 On-foot / build HUD

- **Hotbar** (selected build item + palette).
- **Power & resource panel** — reads factory-sim's production outputs: net power (supply/demand and the **brownout factor** — [spike3-factory-sim](../spikes/spike3-factory-sim.md) §4.2) shown as a bar that goes amber on brownout; per-tracked-item production rate (ore/s, plates/s, parts/s), derived by gameplay counting `MachineCompleted` events over a window ([spike3-factory-sim](../spikes/spike3-factory-sim.md) §6.3). **Brownout is a first-class HUD beat** (PHASE1-PLAN §2.2: "watch brownout when overloaded").
- **Selection inspector** — when looking at a placed entity: its type, recipe, I/O, `VisualState`, and (machine) progress from `AnimPhase`.
- **Crosshair/interaction prompt** + objective tracker (§6).

### 5.2 In-craft / flight HUD

Reads physics's `FVesselOrbitalState` ([spike2-physics](../spikes/spike2-physics.md) §8.2) — **physics computes, gameplay draws** (physics non-goal: "rendering of trajectories is gameplay's"):

- **Altitude** (above terrain — gameplay derives from `Position` vs `SampleTerrainHeight`) and **above datum** (vs `FBodyParams.RadiusM`).
- **Velocity** — surface-relative and orbital, from `FVesselOrbitalState.Velocity` (the TRUE universe velocity).
- **Attitude indicator** (a navball-lite) — pitch/yaw/roll vs the local horizon, derived from the craft `Orientation` and `r̂`.
- **Throttle / stage / fuel** — fuel from the craft state physics exposes (mass change on burn — [spike2-physics](../spikes/spike2-physics.md) §3.1); throttle/stage are gameplay's own control state echoed back.
- **Apoapsis/periapsis + dominant body** — read straight from `FVesselOrbitalState.Elements` + `DominantFrame`.
- **SOI-change advisory** — "entering Cinder SOI in T-NNN s" from `FVesselOrbitalState.NextSOITime`/`NextSOIFrame`.

### 5.3 The map / orbital view (R3 — no scene transition)

**R3 is the standing risk: a KSP-style map/maneuver view in 3D with seamless space (no scene transition) is novel UX — prototype early** ([gameplay.md](../controllers/gameplay.md) §7). PHASE1-PLAN §8 assigns gameplay's Wave-1 design "the first cut" of map UX without scene transitions. Here it is.

**Decision GP-10 (Accepted): the map is an in-world overlay, not a separate scene.** Pressing M does **not** load a map scene (that would break pillar 1's no-loading-screen promise and rendering R3). Instead:

1. Gameplay requests rendering enter a **map presentation mode** — the existing world camera pulls back and rendering composites **orbit lines and body markers as world-space/scaled-space overlays** on top of the live scene (rendering already runs a scaled-space dual-camera for distant bodies — [spike1-rendering] via core-engine scaled-space; the map reuses that rig). No scene swap, no streaming hitch.
2. Gameplay supplies the **data to draw**: the craft's predicted path is `FVesselOrbitalState.PredictedPath` (a sampled conic) + the next SOI marker (`NextSOITime`/`NextSOIFrame`) — *physics computed these; gameplay positions the polyline and the marker glyphs* ([spike2-physics](../spikes/spike2-physics.md) §8.2: "gameplay renders `PredictedPath`/`NextSOI*` as the orbit line + SOI-entry marker (we compute, they draw)"). Body positions come from `IFrameGraph`/`FReferenceFrame.ToUniverse` ([spike1-core-engine](../spikes/spike1-core-engine.md) §5.2).
3. **Slice scope of the map (P1-D2 / PHASE1-PLAN §3):** it is a **read-only situational display** — orbit line, SOI marker, Forge, Cinder, and the craft. **No maneuver-node editing in the slice.** Maneuver nodes are the Phase-2 map/maneuver UI (gameplay roadmap §6). The slice player flies the transfer *manually* (PHASE1-PLAN §1 "manual flight between bodies") and the map just *shows* where the conic goes — which is exactly enough to make "burn until the predicted path enters Cinder's SOI" legible. This is the smallest honest first cut of R3: prove the no-transition overlay renders a live trajectory, defer node-dragging.

> **R3 first-cut verdict:** the map-as-overlay (reusing scaled-space, drawing physics-supplied conics, no scene load) is the prototype. It de-risks the novel half (seamless in-world map) while deferring the *interaction* half (maneuver nodes) to Phase 2 where the full research/map UI lands. If the overlay can't be read against the live scene, the fallback is a dimmed/desaturated backdrop (still no scene swap) — a rendering presentation tweak, flagged not designed.

---

## 6. Slice objective + onboarding

**The single objective (PHASE1-PLAN §2):** *land a working automated outpost on the moon.* It threads the whole loop: mine → power → assemble → fly → off-world mine.

**Decision GP-11 (Accepted): a linear, signposted objective chain (not a quest system).** P1-D4 forbids a research tree and PHASE1-PLAN §3 defers quests; the slice uses a **scripted objective tracker** — a tiny ordered list of steps with completion predicates evaluated against the pinned streams. It is *not* a quest engine (no branching, no data-driven quest assets — that's Phase 4); it's the minimum guidance to make the loop self-teaching.

The step chain (each step's predicate in parentheses — all read from existing streams/events):

1. **Mine your first ore** — place a miner on a Forge deposit (predicate: an `EntityPlaced` miner on a deposit + first `MachineCompleted`). *Teaches: target a deposit, place via the ghost.*
2. **Move it on a belt** — connect the miner to a belt into a smelter (predicate: a `TransportLine` exists from miner output and the smelter receives input). *Teaches: belt drag + port snapping.*
3. **Power it** — place a generator + pole so the smelter runs; deliberately under-build until brownout shows, then add power (predicate: a powered network with brownout factor returning to 1.0). *Teaches: power + brownout.*
4. **Make a part** — set the assembler's recipe and produce the basic part into a box (predicate: `MachineCompleted` for the part recipe + the part lands in a box). *Teaches: recipe selection + the full surface chain.*
5. **Fly to Cinder** — board the lander, reach orbit, transfer, land on Cinder (predicate: `FSOIChangeEvent` into Cinder's frame + a landed-contact state). *Teaches: flight + the map readout.*
6. **Mine the off-world resource** — extract the **Cinder-only** resource (predicate: a miner producing the Cinder-only `ItemId`). *Delivers the payoff: "you must leave the planet."*
7. **(Objective complete)** — a working automated outpost on the moon (predicate: a powered miner→belt→box chain running on Cinder).

**Onboarding feedback (the guidance layer):**
- **The objective tracker** (a 1–2 line HUD widget) shows the current step + a contextual hint.
- **Contextual prompts** fire on first-use beats (first time holding a ghost: "aim at the ground, scroll to rotate, LMB to place"; first powered machine in brownout: "supply < demand — add a generator").
- **Diegetic highlights** — the current objective's relevant world object pulses (the first deposit, then the miner's output port, then the lander hatch). These are rendering-draw requests from gameplay's objective state.
- **No fail states, no timers** — the slice is a sandbox with a guided spine (P1-D4 / GP-4 "lightweight spine, not AAA campaign").

Objective progress is player state → persistence (§8.D), so reload resumes mid-chain.

---

## 7. Slice content (PINNED) — item set + recipes + entity defs + the Cinder hook

The slice ships a tiny, **data-driven** item+recipe+entity set. factory-sim's spike used **synthetic recipes** and an integer `recipeId` keyed into `MachineProc` ([spike3-factory-sim](../spikes/spike3-factory-sim.md) §1.3–1.4); the data-driven `FRecipeDef`/`FEntityDef` schema is finalized in §8.B (C-2). Gameplay owns the *content* (which items, which recipes, which machines, balance); factory-sim owns the *schema + execution*. **All of §7 is data assets, not code (GP-12)** — balance numbers (times/powers/grades, marked *TBD-playtest*) tune without code change. The item ids below are the canonical `ItemId` assignments (§8.C / C-3) — the SINGLE id space across player inventory, machine inventories, deposits, and saves.

### 7.1 The slice item set (PINNED — canonical `ItemId` block)

Ids are stable, hand-assigned compact constants in the gameplay-authored registry (§8.C). The slice uses the `0x00**` block; ids are append-only and never reused.

| `ItemId` | Name | Category | StackMax | Source | Role |
|---|---|---|---|---|---|
| `0x0001` | **Ferrite ore** | `Ore` | 100 | Forge `Ferrite` deposit (miner) | base ore (Forge) |
| `0x0002` | **Ferrite plate** | `Material` | 100 | smelter (smelts ore) | intermediate |
| `0x0003` | **Frame part** | `Part` | 50 | assembler (the "basic part") | slice target output (objective step 4) |
| `0x0004` | **Cinderite** (Cinder ore) | `Ore` | 100 | **Cinder-only `Cinderite` deposit** | off-world identity hook (P1-D4) |
| `0x0005` | **Combustite** (fuel) | `Fuel` | 100 | Forge `Combustite` deposit / pre-stocked | feeds the generator (drives brownout) |
| `0x0010` | **Miner** (item form) | `Buildable` | 20 | pre-stocked / crafted later | placeable → `FEntityDef` TypeId `0x10` |
| `0x0011` | **Belt** (item form) | `Buildable` | 50 | pre-stocked | placeable → TypeId `0x11` |
| `0x0012` | **Smelter** (item form) | `Buildable` | 20 | pre-stocked | placeable → TypeId `0x12` |
| `0x0013` | **Assembler** (item form) | `Buildable` | 20 | pre-stocked | placeable → TypeId `0x13` |
| `0x0014` | **Box** (item form) | `Buildable` | 20 | pre-stocked | placeable → TypeId `0x14` |
| `0x0015` | **Generator** (item form) | `Buildable` | 20 | pre-stocked | placeable → TypeId `0x15` |
| `0x0016` | **Power pole** (item form) | `Buildable` | 20 | pre-stocked | placeable → TypeId `0x16` |

> **Power is not an item.** It is a network quantity (supply/demand → brownout factor) produced/consumed by entities, surfaced on the HUD (§5.1) — never an `ItemId`. Buildables have an item form (so they live in inventory and the build palette) **and** an entity form (`FEntityDef.TypeId`, §7.3); the item's `FItemDef` carries the `PlacesEntityTypeId` cross-link so "select item → ghost that entity" needs no separate table.

### 7.2 The slice recipe set (PINNED — `FRecipeDef` content, schema §8.B)

Five recipes. The two crafting recipes run in machines (`MachineTypeId`); the two mining "recipes" are the miner's extraction keyed by the deposit's `Resource` (an `ItemId`) it sits on (the miner reads its underlying deposit's `FDepositNode.Resource` directly — C-1/WG-11: Resource is the ItemId directly — not a fixed output). Times/powers are *TBD-playtest*.

| `RecipeId` | Name | `MachineTypeId` | Inputs | Outputs | Time | Power |
|---|---|---|---|---|---|---|
| `0x0101` | **Smelt Ferrite** | Smelter `0x12` | 1× Ferrite ore `0x0001` | 1× Ferrite plate `0x0002` | T₁ *TBD* | P₁ *TBD* |
| `0x0102` | **Assemble Frame** | Assembler `0x13` | 2× Ferrite plate `0x0002` | 1× Frame part `0x0003` | T₂ *TBD* | P₂ *TBD* |
| `0x0103` | **Mine Ferrite** | Miner `0x10` | — (deposit `Ferrite`) | Ferrite ore `0x0001` /tick × grade | rate | Pₘ *TBD* |
| `0x0104` | **Mine Cinderite** | Miner `0x10` | — (deposit `Cinderite`) | Cinderite `0x0004` /tick × grade | rate | Pₘ *TBD* |
| `0x0105` | **Burn Combustite** | Generator `0x15` | 1× Combustite `0x0005` | — (emits Power) | T₃ *TBD* | −Pgen *(produces)* |

A deliberate 2-step crafting chain (ore→plate→part) gives the surface factory real depth across all five machines + power without Phase-2 recipe-tree breadth. (Generator-as-fuel-burner is the slice choice so brownout is driven by a player-fed input; a solar stub remains a one-line data swap if playtest prefers it.)

### 7.3 The slice machine/entity defs (PINNED — `FEntityDef` content, schema §8.B)

Seven placeables (P1-D3's five machines + generator + pole). `BuildCost` is the item stack consumed on placement; `SlopeToleranceRad` feeds the §3.2 validity ghost; `Ports` feed the §3.3 legibility. Costs/tolerances *TBD-playtest*.

| `TypeId` | Entity | Places-from item | BuildCost | Ports (I/O/power) | Notes |
|---|---|---|---|---|---|
| `0x10` | **Miner** | Miner `0x0010` | 1× self | 1 output, 1 power-in | must overlap a deposit node (§2.2); tags placement with `DepositId` |
| `0x11` | **Belt** | Belt `0x0011` | drag-cost/cell | endpoint-in, endpoint-out (path) | placed as a drag polyline (§3.5) |
| `0x12` | **Smelter** | Smelter `0x0012` | 1× self | 1 input, 1 output, 1 power-in | runs recipe `0x0101` |
| `0x13` | **Assembler** | Assembler `0x0013` | 1× self | 2 input, 1 output, 1 power-in | runs recipe `0x0102` (recipe set via `ISetRecipeIntent`) |
| `0x14` | **Box** | Box `0x0014` | 1× self | 1 input, 1 output (no power) | buffer; transfer panel target (§4.3) |
| `0x15` | **Generator** | Generator `0x0015` | 1× self | 1 input (fuel), 1 power-out | runs recipe `0x0105`; the brownout source |
| `0x16` | **Power pole** | Power pole `0x0016` | 1× self | 1 power-link | extends the power network (no item I/O) |

> The `ItemId`↔`TypeId` mapping is 1:1 for buildables and lives in `FItemDef.PlacesEntityTypeId` (§7.1 note). factory-sim owns `TypeId` as its entity-class id (`FFactoryEntityState.TypeId`, [spike3 §6.2]); gameplay reuses those numbers in the entity defs it authors so the two never drift.

### 7.4 The Cinder-only resource's role (P1-D4 — the whole point)

**Cinderite (`0x0004`) exists *only* on Cinder.** In the slice it is **not yet a tech gate** (research is Phase 2 — P1-D4, PHASE1-PLAN §3: "off-world tech gating → Phase 2; Phase 1 only needs the resource-identity hook"). Its role here is purely **identity + objective**: the objective's final payoff (step 6) is mining a resource you *cannot* get on Forge, so the player viscerally learns the crossover thesis — "to progress you must leave the planet." Its presence on Cinder is world-gen's per-body resource identity (WG-4); the deposit's `Resource` field IS the `ItemId 0x0004` directly (C-1/WG-11: Resource is the ItemId directly — no `DepositTypeId` indirection; the registry §8.C resolves it to `FItemDef` for display). The *gate* (a Forge recipe that *requires* Cinderite) is the Phase-2 hook gameplay adds when research lands; the slice plants the resource + objective so that gate has somewhere to attach. Designing the gate itself is OUT (P1-D4) — **no research/tech/quest/loot data in the slice.**

---

## 8. Interfaces — consumed (pinned) and provided (new)

### 8.0 Consumed (pinned Phase-0 contracts — honored verbatim, not redefined)

| From | Contract | Used for |
|---|---|---|
| physics | **`FVesselOrbitalState`** (Mode, DominantFrame, Elements, Position, Velocity, `PredictedPath`, `NextSOITime/Frame`) — [spike2-physics](../spikes/spike2-physics.md) §8.2 | flight HUD (§5.2) + map overlay (§5.3). *We draw; physics computes.* |
| physics | character + craft are `Active` `ISimProxy`s; the character↔craft state change ([spike2-physics](../spikes/spike2-physics.md) §6) | the board/disembark handoff (§1.2) — we trigger, physics executes |
| factory-sim | **entity-state stream** `FFactoryEntityState` (`VisualState`,`AnimPhase`,`Orientation`,`Position`) + **`FBeltFlowState`** — [spike3-factory-sim](../spikes/spike3-factory-sim.md) §6.2 | machine/belt feedback, selection inspector, flow tint (§3.3.4, §5.1) |
| factory-sim | **production/event stream** `FFactoryDelta` / `EFactoryEvent` (`MachineCompleted`, `PowerStateChanged`, `InventoryChanged`, `EntityPlaced`…) — [spike3-factory-sim](../spikes/spike3-factory-sim.md) §6.3 | production rates, brownout HUD, objective predicates (§5.1, §6) |
| world-gen | **`FBodyParams`** (RadiusM, Mu, SoiRadius, atmo) — [spike1-worldgen](../spikes/spike1-worldgen.md) §5 | altitude/datum readout (§5.2) |
| world-gen | **`RaycastTerrain`/`GetGroundContact`** (+ `SlopeRad`/`SurfaceHardness`, RC-7) — [spike1-worldgen](../spikes/spike1-worldgen.md) §4.3 | ghost surface projection + slope-validity (§3.2) |
| core-engine | `FUniverseCoord`/`FFrameId`, `IFrameGraph`/`FReferenceFrame.ToUniverse`, `OnSOIChange`/`FSOIChangeEvent`, `ISimClock` — [spike1-core-engine](../spikes/spike1-core-engine.md) §5, §2.3 | all positions, body positions for the map, SOI-change beats, frame-aware UI |

### 8.A — 8.D: Phase-1 cross-domain contracts

> **Ownership split (PHASE1-PLAN §10):** **8.C (`ItemId`/`FItemDef`, C-3)** and **8.D (`FGameplayPersistState`, C-4)** are **gameplay-OWNED — now pinned/finalized below**; world-gen/factory-sim/persistence *reference* them. **8.A (`FDepositNode`, C-1)** and **8.B (`FRecipeDef`/`FEntityDef`, C-2)** are **other domains' schemas** — gameplay states the *consumable shape it needs* and the *content it authors against them*, but world-gen (C-1) and factory-sim (C-2) own the final struct form. Admin routes the two non-owned ones for confirmation.

**8.A — Deposit catalog schema (co-own with world-gen).** world-gen lists a Phase-1 "Deposit/POI catalog (positions, types, depletion state)" but Spike 1 deferred the concrete struct. Gameplay needs it pinned. **Proposed consumable shape** (world-gen owns final form):
```cpp
struct FDepositNode {
    FDepositId     Id;            // stable id (persistence key for depletion)
    FUniverseCoord Position;      // node center, body frame
    FVector3f      SurfaceNormal; // for miner alignment
    ItemId         Resource;      // the mined ItemId directly (Ferrite ore 0x0001, Cinderite 0x0004, …)
                                  //   C-1/WG-11: Resource IS the gameplay ItemId — no separate DepositTypeId space.
    float          Grade;         // richness → extraction rate multiplier
    double         RemainingAmount; // depletion state (a persistence diff, WG-3)
};
// + a query: nodes near a UniverseCoord (for the "look at deposit" tooltip) and per-body enumeration.
```
*Gameplay consumes; world-gen produces; factory-sim also consumes (miner extraction). Three-way — Admin to confirm the single struct serves all three.*

**8.B — Recipe-data schema (co-own with factory-sim).** factory-sim executes recipes via integer `recipeId` but used synthetic recipes in the spike; the **data-driven recipe asset format** is unowned. Gameplay owns recipe *content/balance*, factory-sim owns the *schema it executes*. **Proposed asset shape** (factory-sim owns final form):
```cpp
struct FRecipeDef {
    uint16 RecipeId;
    uint16 MachineTypeId;                 // which machine class can run it
    TArray<FItemStack> Inputs;            // {ItemId, Count}
    TArray<FItemStack> Outputs;
    uint32 TimeTicks;                     // craft time at full power
    int32  PowerW;                        // demand while crafting
};
struct FEntityDef {                       // gameplay-authored placeable definition
    uint16 TypeId; FItemStack BuildCost;  // inventory cost to place
    float  SlopeToleranceRad;             // §3.2 validity
    TArray<FPortDef> Ports;               // I/O + power port positions (for §3.3 legibility)
};
```
*Gameplay authors the asset values (§7); factory-sim defines the loadable schema + executes. Admin to route the schema ownership split.*

**8.C — Shared item-id registry — `ItemId` / `FItemDef` (C-3, gameplay OWNS; PINNED).** A single project-wide id space + def table, **authored by gameplay** (content), consumed by factory-sim (machine inventories), world-gen (deposit→item mapping), and persistence (serialization). **This is the SINGLE id space** — the same `ItemId` identifies an item in the player's pack, in a smelter's input slot (factory-sim `Inventory.slotItem`), as a deposit's mined product (world-gen `FDepositNode.Resource`, which IS an `ItemId` directly — C-1/WG-11: Resource is the ItemId directly, no separate `DepositTypeId`), and on disk. There is no separate per-domain item space.

```cpp
// The id: stable, compact, opaque. Gameplay OWNS the value space.
using ItemId = uint16;          // 0 = ItemId::None (the null/empty item); 65535 usable ids
//  • COMPACT  — matches factory-sim's on-belt item id width (FFactoryBeltFlowState.ItemTypeDominant, uint16)
//               and machine slot ids; one stack is {ItemId u16, Count u16} = 4 B (GP-9, §4.1).
//  • OPAQUE   — consumers treat it as a key, never decode bits from it.
//  • STABLE ACROSS SAVES — ids are HAND-ASSIGNED constants in the gameplay registry asset
//               (see §7.1 block: 0x0001…). An id, once shipped, is NEVER reused or renumbered;
//               new items APPEND new ids. So a save written with 0x0004 = Cinderite always
//               reloads as Cinderite regardless of registry growth — no remap table needed.
//               (Contrast: a name-hash or load-order index would shift; we reject those.)

struct FItemDef {
    ItemId   Id;                 // the canonical id (matches the key it is registered under)
    FName    DisplayName;        // UI label
    FName    Category;           // Ore | Material | Part | Fuel | Buildable  (HUD grouping / filters)
    uint16   StackMax;           // per-slot stack cap (player + machine inventories)
    FSoftObjectPath Icon;        // hotbar / inventory / tooltip icon (soft ref, lazy-loaded)
    uint8    Flags;              // bit0 Buildable · bit1 Fuel · bit2 OffWorldOnly (Cinderite) · rest reserved
    uint16   PlacesEntityTypeId; // Buildable items only: the FEntityDef.TypeId this places (0 = none)
};
// Registry: gameplay-authored data asset  ItemId -> FItemDef  (a DataTable / curated array).
//   • Physically gameplay-authored; LOADED by factory-sim (slot validation, stack caps) and
//     persistence (it serializes raw ItemId values — it does NOT need FItemDef to round-trip).
//   • world-gen does not load FItemDef; it stores the ItemId directly in FDepositNode.Resource
//     (C-1/WG-11: Resource is the ItemId directly — no DepositTypeId indirection to map through).
```
*Admin to confirm physical load location (gameplay-authored asset; core/factory-sim-loaded). The id contract above is what world-gen/factory-sim/persistence reference — their structs hold the `uint16` and treat it as opaque.*

**8.D — Player progress/inventory/position shape — `FGameplayPersistState` (C-4, gameplay OWNS; FINALIZED).** The `IPersistable` payload for gameplay's owned PLAYER state. persistence accepts it (PHASE1-PLAN §10, C-4 "Defined — persistence accepts"). Exact fields:

```cpp
struct FItemStack { ItemId Item; uint16 Count; };     // 4 B; the shared stack type (§4.1, §7.1)
enum class EAvatarMode : uint8 { OnFoot = 0, InCraft = 1 };
enum class EControlMode : uint8 { OnFootContext = 0, InCraftTP = 1, InCraftIVA = 2 }; // §1.1/§1 camera+input context

struct FGameplayPersistState {
    // ── Avatar transform & body ───────────────────────────────────────────────
    FUniverseCoord  PlayerPos;        // capsule position, universe coord (frame-tagged) — §1
    FQuat           PlayerRot;        // capsule/look orientation
    FFrameId        PlayerFrame;      // the reference frame PlayerPos is expressed in (which body/SOI) — for clean rebase on load
    EAvatarMode     Mode;             // OnFoot | InCraft (which sim owns the body — §1, GP-6)
    EControlMode    ControlMode;      // active input+camera context (OnFoot / craft-TP / craft-IVA) — §1.1
    FEntityId       CurrentCraft;     // the boarded craft when Mode==InCraft (else FEntityId::None)
    //   NOTE: craft ORBIT/transform is physics's FVesselOrbitalState, NOT persisted here — we only
    //   record WHICH craft the player is in; physics restores the craft's own state.

    // ── Inventory ─────────────────────────────────────────────────────────────
    TArray<FItemStack> Inventory;     // §4 — fixed N≈20 slots as (ItemId,Count)[]; empty slot = {None,0}
    uint8           SelectedHotbar;   // 0–4 currently-selected build-palette slot (§4.2) — restores the held tool

    // ── Objective / onboarding progress (§6) ──────────────────────────────────
    uint8           ObjectiveStep;    // current step in the 1..7 linear chain (§6)
    uint8           ObjectiveFlags;   // per-step completion bits for the active step's sub-predicates
    TBitArray<>     SeenPrompts;      // first-use contextual-prompt flags, indexed by prompt id — so onboarding doesn't re-fire on reload
};
//  OWNED BY GAMEPLAY ONLY. Out of scope here (each owning domain persists its own, per PHASE1-PLAN §6):
//    • deposit depletion  → world-gen diff (WG-3)
//    • factory entities    → factory-sim snapshot
//    • craft orbit/transform → physics FVesselOrbitalState
//  Cross-refs are by id only: CurrentCraft (FEntityId) and the items (ItemId) are opaque keys into
//  the other domains' / the registry's spaces — this struct embeds no foreign domain's state.
```
*Gameplay implements `IPersistable` for exactly this and nothing else (C-6). persistence serializes the raw `ItemId`/`FEntityId`/`FFrameId` values without needing the registries.*

### 8.E: Player command/intent APIs gameplay PROVIDES (C-5 provider side — FINALIZED)

> The outbound "player intents/commands → physics & factory-sim" that gameplay provides. **Gameplay raises them; the owning sim is authoritative and validates** — they are *commands*, not state writes (D-004-clean: an intent is exactly what a networked client sends a server later). Each carries the issuing player so multiplayer/replay can attribute it. Admin routes to physics + factory-sim to confirm field-for-field (C-5 "Open — physics + factory-sim confirm").

**→ physics (control & handoff).** Emitted from the §1.1 input contexts; physics integrates motion / executes the handoff.
```cpp
struct ICraftControlIntent {                 // in-craft context, per control tick (§1.1)
    FPlayerId  Player;
    FEntityId  Craft;                        // the craft under control (== FGameplayPersistState.CurrentCraft)
    float      Throttle;                     // 0..1 main throttle
    FVector3f  AttitudeCmd;                  // pitch/yaw/roll command, each −1..1 (body axes)
    FVector3f  RcsCmd;                       // translation/RCS command, each −1..1 (IJKL) (§1.1)
    uint8      ActionMask;                   // bitflags: bit0 Stage(Space) · bit1 ToggleRcs · bit2 ToggleSas · rest reserved
};
struct ICharacterMoveIntent {                // on-foot context, per control tick (§1.1)
    FPlayerId  Player;
    FEntityId  Char;                         // the player capsule entity
    FVector2f  MoveTangent;                  // desired move in the local surface-tangent plane, −1..1 each (WASD)
    bool       Jump;                         // jump this tick (low-g feel comes from physics, §1.1)
    FQuat      LookDir;                       // desired look/aim orientation (mouse look)
};
struct IBoardIntent {                        // §1.2 board (on-foot → in-craft); physics reconciles authority
    FPlayerId  Player;
    FEntityId  Char;
    FEntityId  Craft;                        // the craft whose board-trigger the player is in range of
};
struct IDisembarkIntent {                    // §1.2 disembark (in-craft → on-foot)
    FPlayerId  Player;
    FEntityId  Craft;                        // physics VALIDATES landed + near-stationary; refuses otherwise (gameplay shows the refusal)
};
```

**→ factory-sim (build & operate).** Emitted from the build/placement UX (§3) and the transfer panel (§4.3); factory-sim is authoritative — it creates/removes/configures entities and emits the resulting `FFactoryDelta` ([spike3 §6.3]).
```cpp
struct IFactoryBuildIntent {                 // §3.4 — place one machine from a valid ghost
    FPlayerId      Player;
    uint16         TypeId;                    // FEntityDef.TypeId (§7.3); maps 1:1 from the selected build item
    FUniverseCoord At;                        // snapped surface position (§3.2), frame-tagged
    FQuat          Orient;                    // ghost orientation (up = r̂/normal, free-rotated heading) (§3.2)
    FDepositId     Deposit;                   // miner only: the node it overlaps (FDepositId::None otherwise) (§2.2)
};
struct IPlaceBeltIntent {                    // §3.5 — belts are a drag polyline, merged into a TransportLine
    FPlayerId          Player;
    TArray<FGridCell>  Path;                  // ordered surface-grid cells start→end (§3.5)
};
struct IRemoveEntityIntent {                 // §3.4 — RMB a placed entity in build mode
    FPlayerId  Player;
    FEntityId  Entity;
};
struct ISetRecipeIntent {                    // §3.4 — configure a smelter/assembler
    FPlayerId  Player;
    FEntityId  Machine;
    uint16     RecipeId;                      // FRecipeDef.RecipeId (§7.2); 0 = clear/idle
};
struct ITransferItemsIntent {                // §4.3 — move a stack between player and an entity inventory
    FPlayerId  Player;
    FEntityId  Entity;                        // the box/machine inventory side
    uint16     Slot;                          // target slot on the entity side
    FItemStack Stack;                         // {ItemId, Count} to move (§4.1)
    bool       ToPlayer;                      // true = entity→player, false = player→entity
};
// + a READ (no state change; for the transfer panel & selection inspector):
//   QueryEntityInventory(FEntityId Entity) -> TArrayView<const FItemStack>   // §4.3
```
*Every intent carries `FPlayerId` (single-player: a constant local id) so the same surface serves D-004 networked play unchanged. None mutate sim state directly — the sim validates and applies, keeping it authoritative.*

---

## 9. Open questions / risks (gameplay, Phase 1)

- **R2 (3D legibility)** — addressed in §3.3 (ports + connection preview + build overlay camera + flow tint); **validated in playtest** (P1-D6). Residual: curved-surface flow reading; cheap escalation = stronger build camera before any flatten-pad feature.
- **R3 (no-transition map)** — first cut in §5.3 (in-world scaled-space overlay, physics-supplied conic, read-only, no maneuver nodes). Residual: legibility of overlay against the live scene; fallback = dimmed backdrop, still no scene swap. Maneuver-node *interaction* deferred to Phase 2.
- **Contract status (§8.A–E) — gameplay's side now closed:**
  - **C-3 `ItemId`/`FItemDef` (§8.C) — PINNED (gameplay owns).** `ItemId = uint16`, opaque, hand-assigned stable ids, single space across inventory/machines/deposits/saves. world-gen/factory-sim/persistence reference it; confirm their structs hold the `uint16` opaquely.
  - **C-4 `FGameplayPersistState` (§8.D) — FINALIZED (gameplay owns).** Exact fields pinned (avatar pos/rot/frame/mode/control-mode/craft, inventory `(ItemId,Count)[]` + hotbar, objective step/flags, seen-prompts). persistence accepts.
  - **C-5 intents (§8.E) — FINALIZED (gameplay provides).** All 9 intents + `QueryEntityInventory` read fully fielded; each carries `FPlayerId`. **Awaiting physics + factory-sim field-for-field confirmation.**
  - **C-1 `FDepositNode` (§8.A) — world-gen owns; PINNED (WG-11).** `Resource` field IS the gameplay `ItemId` directly (C-1/WG-11: Resource is the ItemId directly — the proposed `DepositTypeId` indirection was dropped; no separate deposit-type id space).
  - **C-2 `FRecipeDef`/`FEntityDef` (§8.B) — factory-sim owns;** gameplay authored the slice content (§7) against the proposed shape. **Awaiting factory-sim schema pin.**
  - None break a pinned Phase-0 contract. Remaining routing (C-1, C-2 schemas; C-5 confirmation) flagged to Admin.
- **Camera ownership seam** — the build overlay camera (§3.3.3) and the map overlay (§5.3) are *gameplay-requested rendering modes*; confirm with rendering that "gameplay can request a camera/overlay mode" is in their surface (likely yes — they own cameras; gameplay owns the trigger). Low risk, flag to rendering via Admin.
```
