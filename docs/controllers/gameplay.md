# Gameplay, Progression & UI — Master Controller Context

> **Domain owner:** `gameplay-controller` · **Reports to:** Admin · **Phase:** 1 · **Status:** Phase-1 designed · C-3 pinned, C-4/C-5 finalized, slice content pinned · **Last updated:** 2026-06-14
> Read alongside: [MASTER_PLAN](../MASTER_PLAN.md) · [AGENT_ARCHITECTURE](../AGENT_ARCHITECTURE.md) · [ADMIN](ADMIN.md) · **[Phase-1 design: gameplay-phase1.md](../phase1/gameplay-phase1.md)** (the playable-loop design) · [PHASE1-PLAN](../phase1/PHASE1-PLAN.md)

## 1. Mission
Turn the simulation substrate into a *game*: research progression, an exploration/questline that pushes players off-world, loot and structures, and the UI that makes building, flying, and managing legible. Own the player-facing loop.

## 2. Scope & owned subsystems
- **Research / tech tree** — Factorio-style: factory produces science packs → unlock recipes/tech; gate off-world tech behind off-world resources.
- **Exploration & science** — KSP-style science from biomes/anomalies; scanning; discovery rewards.
- **Quests / narrative spine** — a lightweight thread guiding progression across bodies.
- **Loot & structures** — content for world-gen's POIs: ruins, derelicts, blueprints, lore.
- **Player systems** — inventory, hand tools, build/placement UX, vehicle control mapping.
- **UI/HUD** — build menus, logistics/production overview, **map & maneuver-node view** (consumes physics trajectories), power/research dashboards. *(UI is folded here for v1; may graduate to its own controller later — Admin Q3-adjacent.)*
- **Non-goals:** the sims that produce the numbers (factory-sim, physics, world-gen); rendering the 3D scene (→ rendering). Gameplay defines *rules, content, and screens*.

## 3. Key design decisions
| # | Decision | Rationale | Status | Date |
|---|----------|-----------|--------|------|
| GP-1 | Research = produce science items in factory → unlock (Factorio model) | Ties progression to automation depth | Proposed | 2026-06-14 |
| GP-2 | Off-world resources gate mid/late tech | Forces the KSP×Factorio fusion: you *must* leave the planet | Proposed | 2026-06-14 |
| GP-3 | Exploration science from biomes/anomalies + loot from procedural POIs | Dual incentive (KSP + Subnautica/NMS) | Proposed | 2026-06-14 |
| GP-4 | Lightweight questline (spine, not AAA campaign) (D-005 spirit) | Directs progression without huge content cost | Accepted | 2026-06-14 |
| GP-5 | UI folded into gameplay for v1 | Scope; revisit if UI complexity grows | Accepted | 2026-06-14 |
| GP-6 | **Two avatar modes, one body:** first-person on foot / third-person+IVA in craft (implements P1-D1) | First person suits build/mining precision; third person suits flight readability | Accepted | 2026-06-14 |
| GP-7 | **Grid-snap-to-surface-tangent + free-rotate, ghost-first** placement (implements P1-D6) | Recovers a placeable surface grid on curved terrain; free-rotate for headings | Accepted | 2026-06-14 |
| GP-8 | **Color-coded validity ghost** (green/blue valid · red hard-invalid · yellow warning) + reason label | Satisfactory-proven placement legibility; reasons from slope/overlap/no-deposit | Accepted | 2026-06-14 |
| GP-9 | **Small fixed-slot inventory + unified build/mine tool hotbar**; item = {ItemId,Count} shared with factory-sim | Minimal, data-driven, persistence-friendly; one item-id space hand↔machine | Accepted | 2026-06-14 |
| GP-10 | **Map = in-world scaled-space overlay, no scene transition; read-only (no maneuver nodes in slice)** (R3 first cut) | Honors no-loading-screen pillar; draws physics-supplied conic; node-editing is Phase 2 | Accepted | 2026-06-14 |
| GP-11 | **Scripted linear objective chain, not a quest engine** (within P1-D4 / GP-4) | Self-teaching spine for the slice; predicates read from pinned streams; no quest assets yet | Accepted | 2026-06-14 |
| GP-12 | **Slice items/recipes are data assets**; Cinderite = off-world identity hook only (not a tech gate yet, P1-D4) | Balance iterates without code; the gate is Phase-2 when research lands | Accepted | 2026-06-14 |
| GP-13 | **`ItemId = uint16`, opaque, hand-assigned stable constants** (never reused/renumbered; new items append) — the SINGLE id space across player inventory, machine inventories (factory-sim), deposits (world-gen→item map), and persistence (C-3) | Stable across saves with no remap table; matches factory-sim's on-belt `uint16` width; opaque so consumers never decode bits | Accepted | 2026-06-14 |
| GP-14 | **All player intents carry `FPlayerId`; intents are commands not state writes** (C-5) | One surface serves single-player and D-004 networked play unchanged; sim stays authoritative | Accepted | 2026-06-14 |

## 4. Architecture & approach
- **Progression loop:** explore → find resources/POIs → automate extraction (factory-sim) → produce science → unlock tech → build bigger/leave the planet → repeat off-world. The tech tree is the backbone; quests are signposts on it.
- **Off-world gating:** balance recipes so essential mid-game items need resources only found on the moon/other bodies (world-gen WG-4 resource identity). This is the mechanism that *makes the crossover matter*.
- **Map/maneuver UI:** consume physics' orbital state + predicted trajectories to render an interactive map view with maneuver nodes (KSP's signature UI). One of the highest-value, highest-effort UI pieces.
- **Loot/POIs:** define content tables + rarity; world-gen places, gameplay binds contents + looted-state (a diff to persistence).
- **Data-driven:** recipes, tech, quests, loot tables as data assets so balance iterates without code.

## 5. Interfaces & dependencies

> **Phase-1 detail pinned in [gameplay-phase1.md §8](../phase1/gameplay-phase1.md#8-interfaces--consumed-pinned-and-provided-new).** Below is the controller-level summary.

**Consumes (PINNED Phase-0 contracts — honored verbatim):**
- physics: **`FVesselOrbitalState`** (Mode, DominantFrame, Elements, Position, Velocity, `PredictedPath`, `NextSOITime/Frame` — [spike2 §8.2](../spikes/spike2-physics.md)) for flight HUD + map overlay (*we draw, physics computes*); character↔craft state change ([spike2 §6](../spikes/spike2-physics.md)) for the board/disembark handoff.
- factory-sim: **entity-state stream** (`FFactoryEntityState`/`FBeltFlowState`) + **delta/event stream** (`MachineCompleted`/`PowerStateChanged`/`InventoryChanged`/`EntityPlaced` — [spike3 §6](../spikes/spike3-factory-sim.md)) for feedback, production rates, brownout HUD, objective predicates.
- world-gen: **`FBodyParams`** (altitude/datum) + **`RaycastTerrain`/`GetGroundContact`** (+`SlopeRad`/`SurfaceHardness`, RC-7) for ghost surface projection + slope validity ([spike1-worldgen §4–5](../spikes/spike1-worldgen.md)).
- core-engine: `FUniverseCoord`/`FFrameId`, `IFrameGraph`/`FReferenceFrame.ToUniverse`, `OnSOIChange`, `ISimClock` ([spike1-core §5, §2.3](../spikes/spike1-core-engine.md)).
- persistence: loads/saves gameplay's owned `Persistable` (see Provides).
- rendering: gameplay *requests* camera/overlay modes (build-overlay camera §3.3.3, map overlay §5.3) — confirm "gameplay can request a camera mode" is in rendering's surface.

**Phase-1 cross-domain contracts (full detail [gameplay-phase1.md §8](../phase1/gameplay-phase1.md#8-interfaces--consumed-pinned-and-provided-new)):**
- **C-3 `ItemId`/`FItemDef` (§8.C) — gameplay OWNS · PINNED.** `ItemId = uint16`, opaque, hand-assigned stable ids (GP-13). The SINGLE id space: player inventory + factory machine inventories + deposit→item map + persistence. Consumers hold the `uint16` opaquely. Canonical id block in [phase1 §7.1].
- **C-4 `FGameplayPersistState` (§8.D) — gameplay OWNS · FINALIZED.** Exact fields pinned (avatar pos/rot/`FFrameId`/mode/control-mode/craft, inventory `(ItemId,Count)[]`+hotbar, objective step/flags, `SeenPrompts`). persistence accepts; gameplay implements `IPersistable` for exactly this (C-6).
- **C-5 intents (§8.E) — gameplay PROVIDES · FINALIZED.** All 9 fully-fielded + `QueryEntityInventory` read; each carries `FPlayerId` (GP-14). Awaiting physics + factory-sim field confirmation.
- **C-1 `FDepositNode` (§8.A) — world-gen OWNS** (three-way w/ factory-sim) · **PINNED (WG-11).** `Resource` field IS the gameplay `ItemId` directly (C-1/WG-11: Resource is the ItemId directly — the proposed `DepositTypeId` indirection was dropped; no separate deposit-type id space).
- **C-2 `FRecipeDef`/`FEntityDef` (§8.B) — factory-sim OWNS;** gameplay authored slice content (§7) against the shape. Awaiting factory-sim schema pin.

**Provides (outbound — player intents/commands; sim stays authoritative, D-004-clean):**
- **→ physics:** `ICraftControlIntent`, `ICharacterMoveIntent`, `IBoardIntent`, `IDisembarkIntent`. *(fully fielded, [phase1 §8.E])*
- **→ factory-sim:** `IFactoryBuildIntent`, `IPlaceBeltIntent`, `IRemoveEntityIntent`, `ISetRecipeIntent`, `ITransferItemsIntent` (+ a `QueryEntityInventory` read).
- **→ persistence:** `FGameplayPersistState` (player state only; factory/orbit/terrain diffs belong to their owning domains).
- **Content data (PINNED, [phase1 §7]):** 12-item `ItemId` set (Ferrite ore/plate, Frame part, Cinderite, Combustite + 7 buildables), 5 recipes (`FRecipeDef`), 7 entity defs (`FEntityDef`), slice objective chain — data assets consumed by factory-sim (recipes/entities) + world-gen (deposit types).
> *Tech/quest/loot data and the research-gate version of off-world resources are Phase-2+ (P1-D4) — not provided in the slice.*

## 6. Task backlog / roadmap
- [Phase 1] Minimal build/placement UX + inventory + a basic HUD so the SP slice is playable; first recipes/tech.
- [Phase 2] Full research tree; off-world gating; map/maneuver-node UI v1.
- [Phase 4] Questline, POIs/loot, exploration-science depth, structures.
- [Phase 5] UX polish; consider splitting UI into its own controller.

## 7. Open questions & risks
- **R1 (Admin Q3) — SETTLED:** first-person on foot / third-person+IVA in craft, via **P1-D1 / GP-6**. Control mapping + camera + handoff designed in [gameplay-phase1.md §1](../phase1/gameplay-phase1.md). Closed.
- **R2 (3D build legibility) — FIRST CUT DONE, playtest-validated:** recovered via **highlighted I/O ports + connection preview + a pulled-back in-world build-overlay camera + a flow/`VisualState` tint mode** (GP-7/GP-8, [§3.3](../phase1/gameplay-phase1.md)). Validate in playtest (P1-D6 / factory-sim R3); cheap escalation = stronger build camera before any flatten-pad feature.
- **R3 (no-transition map) — FIRST CUT DONE:** map = in-world **scaled-space overlay** (no scene swap), drawing physics-supplied `PredictedPath`/`NextSOI` conic; **read-only, no maneuver nodes in the slice** (GP-10, [§5.3](../phase1/gameplay-phase1.md)). Maneuver-node *interaction* deferred to Phase 2 with the research/map UI. Residual: overlay legibility vs live scene → fallback dimmed backdrop (still no swap).
- **R4 — gameplay's side CLOSED; awaiting consumer confirmation.** The contracts gameplay *owns* are pinned/finalized: **C-3 `ItemId`/`FItemDef`** (PINNED), **C-4 `FGameplayPersistState`** (FINALIZED), **C-5 intents** (FINALIZED, provider side). Remaining: world-gen pins **C-1 `FDepositNode`**, factory-sim pins **C-2 `FRecipeDef`/`FEntityDef`** schema (gameplay's slice content §7 is authored against the proposed shape and will confirm against the final), and physics+factory-sim confirm **C-5** field-for-field. None break a pinned Phase-0 contract — routing flagged to Admin in the Completion Report.

## 8. Subagent delegation log
| Date | Subagent task | Status | Outcome |
|------|---------------|--------|---------|
| 2026-06-14 | Research thread (2 WebSearches, no subagent) — 3D factory-builder placement legibility (Satisfactory / DSP) | Done | Adopted into [gameplay-phase1.md §3.1–3.3](../phase1/gameplay-phase1.md): perspective split confirms P1-D1 (Satisfactory FP build / DSP TP); color-coded ghost (blue/red/yellow); **highlighted I/O ports** = the 3D-legibility key; snap-to-guideline + vertical modes. Sources: Satisfactory Wiki Build Gun, FICSIT modding holograms, Steam DSP-vs-Satisfactory, Wikipedia DSP. |

## 8.1 Phase-1 design log
| Date | Event | Outcome |
|------|-------|---------|
| 2026-06-14 | **Phase-1 design pass** (net-new domain, against pinned contracts) | Wrote [gameplay-phase1.md](../phase1/gameplay-phase1.md): avatar+camera+controls+handoff (§1), mining UX (§2), 3D build/placement+R2 (§3), inventory+tools (§4), HUD+map+R3 (§5), slice objective+onboarding (§6), item/recipe stubs + Cinder hook (§7), interfaces (§8). Settled GP-6…GP-12; R1 closed; R2/R3 first cuts; raised R4 (contract routing). Status → Phase-1 designed. |
| 2026-06-14 | **Pin C-3, finalize C-4/C-5, specify slice content** (Admin brief) | [phase1 §7](../phase1/gameplay-phase1.md#7-slice-content-pinned--item-set--recipes--entity-defs--the-cinder-hook) rewritten stubs→**pinned content**: 12-item canonical `ItemId` block (0x0001…), 5 `FRecipeDef` recipes (0x0101…), 7 `FEntityDef` entity defs (0x10…). [§8.C](../phase1/gameplay-phase1.md#8a--8d-phase-1-cross-domain-contracts) **C-3 PINNED** — `ItemId=uint16` opaque/hand-assigned/stable, single id space; [§8.D](../phase1/gameplay-phase1.md) **C-4 FINALIZED** — exact `FGameplayPersistState` fields; [§8.E](../phase1/gameplay-phase1.md) **C-5 FINALIZED** — 9 intents + `QueryEntityInventory`, all carry `FPlayerId`. Added GP-13 (`ItemId`), GP-14 (intents=commands). R4 → gameplay side closed, awaiting consumer confirmation. |

## 9. References
MASTER_PLAN §6 (progression), §7 (KSP science / Factorio research / NMS-Subnautica loot), D-005. Factorio tech tree; KSP science & maneuver-node UI.
