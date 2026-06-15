# Phase 1 — Single-Player Vertical Slice: "First Foundry" (Admin integration blueprint)

> **Owner:** Admin Master Controller · **Phase:** 1 · **Status:** Planning · **Last updated:** 2026-06-14
> Phase 0 (all 3 spikes + closed interface surface) is the foundation: [PHASE0-SUMMARY](../spikes/PHASE0-SUMMARY.md). This plan **integrates** the pinned contracts into the first *playable* loop. Process: [AGENT_ARCHITECTURE](../AGENT_ARCHITECTURE.md).

---

## 1. What Phase 1 is
The first time the KSP×Factorio fusion is **played end-to-end**, single-player. Spikes proved each hard subsystem in isolation; Phase 1 **wires them together** and adds the two net-new domains (gameplay, persistence). No new hard-tech risk — the risk here is *integration* and *game feel*, plus the one carried-over unknown (the integrated render wall, [Q6](../controllers/ADMIN.md#8-open-cross-cutting-questions-admin-owned)).

## 2. The playable loop (the acceptance target)
A player, starting on the planet **Forge**, can do this whole loop continuously and then reload it:
1. **On foot (first person)** — explore, find a resource deposit (node-based).
2. **Automate** — place a miner on the deposit → ore on a belt → into a powered smelter → into an assembler making a basic part → into a box. Stand up a power source; watch brownout when overloaded.
3. **Fly** — board a simple craft, launch from Forge's surface → reach orbit → transfer across to the moon **Cinder** (SOI change) → land. Seamless, no loading screens.
4. **Off-world payoff** — mine a **Cinder-only** resource (resource identity) — the concrete hook that proves "you must leave the planet."
5. **Persist** — the entire state (world diffs, factory, craft orbit, inventory, position) saves and reloads.

**Slice goal for the player:** *land a working automated outpost on the moon.* That single objective threads mining → power → assembly → flight → off-world mining.

## 3. Scope — IN vs OUT
**IN (the minimum that makes the loop real):**
- core-engine: floating origin + frames + active/on-rails + tick — integrated (Spike 1).
- world-gen: Forge + Cinder terrain, deposits on both (incl. a Cinder-only resource).
- rendering: scaled-space seamless traversal + atmosphere + **factory rendering at slice scale** (the render-wall co-validation).
- physics: patched conics + ONE rigid-body craft + surface/character physics (Spike 2 hybrid integrator).
- factory-sim: the minimal chain — miner, belt, smelter, assembler, box — + one power source + brownout. **Hundreds–low-thousands of entities, not 100k.**
- gameplay (NET-NEW): first-person avatar + controls, mining/build/placement UX, inventory, minimal HUD, flight controls + a basic orbital/map readout.
- persistence (NET-NEW): seed+diff save/load of the whole slice, single save slot.

**OUT (deferred — do NOT build in Phase 1):**
- Research/tech tree → Phase 2. Time-warp → Phase 2+. Voxel digging → Phase 4. POIs/loot/quests → Phase 4. Multiplayer → Phase 3. 100k-scale factory + deep optimization → Phase 5. Full multi-part craft editor / advanced aero / fluids / circuits → later. Off-world tech *gating* → Phase 2 (Phase 1 only needs the resource-identity *hook*, not the gate).

## 4. Phase-1 design decisions (Admin — confirmable)
| # | Decision | Rationale | Status |
|---|----------|-----------|--------|
| P1-D1 | **Perspective = first-person on foot; third-person/IVA in the craft** (resolves Admin Q3) | Matches the MASTER_PLAN §1 lean; first-person suits build/mining, third-person suits flight readability | Proposed — confirm with Reid |
| P1-D2 | **Craft = a small fixed/pre-fab lander** for the slice, not a full part-by-part editor | Keeps physics at the Spike-2 scope (compound rigid body); the VAB-style editor is a later feature | Proposed |
| P1-D3 | **Factory = the minimal 5-machine chain + 1 power source + brownout**, hundreds of entities | Proves the automation loop without Phase-5 scale; this is the render-wall co-validation at honest slice scale | Proposed |
| P1-D4 | **No research tree in the slice**; progression hook = off-world resource identity only | Research is Phase 2; the slice still teaches "leave the planet" via the Cinder-only resource | Proposed |
| P1-D5 | **Save = full slice state via seed+diff, single slot** | Proves the persistence model end-to-end without migration/compression polish | Proposed |
| P1-D6 | **Build/placement = grid-snap-to-surface** (snap factory parts to the local terrain tangent), with free-rotate | Recovers Factorio's legibility in 3D (gameplay R2 / factory R3); confirm in playtest | Proposed |

## 5. Integration spine (the order things come online)
Each layer must run before the next is meaningful. These become milestones **M2.1–M2.5** (M2 = SP vertical slice).

- **M2.1 — Seamless world (Spike 1 integrated).** core-engine + world-gen + rendering: a controllable first-person observer walks Forge, flies up, crosses to Cinder, lands. *This is Spike 1 built for real.* Gate: the [spike1-PLAN §5 acceptance loop](../spikes/spike1-PLAN.md#5-unified-acceptance-gate-the-seamless-loop).
- **M2.2 — Flight (Spike 2 integrated).** physics replaces the "simple observer" with the rigid-body craft + surface character physics. Gate: launch→orbit→SOI→land under the hybrid integrator (Spike-2 G1–G11); the on-foot↔in-craft handoff (P1-D1).
- **M2.3 — Automation (Spike 3 integrated at slice scale).** factory-sim + gameplay: place miner/belt/smelter/assembler/box on terrain, run power + brownout; gameplay's build/placement UX (P1-D6) + inventory. Gate: ore→part→box runs; **rendering co-validates the render wall at slice scale (Q6/RC-8 measured).**
- **M2.4 — Progression hook.** world-gen + gameplay: deposits on both bodies incl. the Cinder-only resource; the slice objective + minimal HUD/feedback. Gate: a player can complete "land a working outpost on the moon."
- **M2.5 — Persistence.** persistence wraps all of it: seed+diff save/load of world diffs, factory state, craft orbit, inventory, position. Gate: full-loop save→quit→reload→continue with no loss/dupe.

## 6. Per-domain Phase-1 workstreams
| Domain | Phase-1 job | Net-new? |
|--------|-------------|----------|
| core-engine | Build floating-origin/frames/tick/SimProxy from Spike-1 design; host the integrated loop | Build of designed |
| world-gen | Build Forge+Cinder terrain; deposit placement incl. Cinder-only resource; `FBodyParams` live | Build of designed |
| rendering | Build scaled-space rig + atmosphere; **integrate factory rendering + measure the render wall** | Build of designed + Q6 |
| physics | Build patched-conics + the slice craft + surface/character physics; on-foot↔craft handoff | Build of designed |
| factory-sim | Build the 5-machine chain + power + brownout at slice scale; emit the entity-state stream | Build of designed |
| **gameplay** | **DESIGN-FIRST (net-new):** avatar+controls, mining/build/placement UX, inventory, HUD, orbital/map readout, the slice objective | **YES — needs a Phase-1 design pass** |
| **persistence** | **DESIGN-FIRST (net-new):** concrete seed+diff save/load for the slice; per-domain `Persistable`; chunk-key scheme for 2 bodies | **YES — needs a Phase-1 design pass** |

## 7. Delegation plan (how Admin executes this)
- **Wave 1 (design the net-new domains) — dispatch now, in parallel:**
  - → **gameplay**: Phase-1 player-loop design (avatar, controls, mining/build UX, inventory, HUD, orbital readout, slice objective) against the pinned contracts.
  - → **persistence**: Phase-1 slice save/load design (what each domain serializes, the `Persistable` shape, chunk keys, save flow).
  - *Rationale:* these gate "playable" and don't yet exist; the built domains already have their Spike designs.
- **Wave 2 (integration build briefs) — after Wave 1 + plan confirmed:** the five built domains get Phase-1 *integration* briefs following the M2.1→M2.5 spine, plus gameplay/persistence move from design to build. Sequenced by the spine (M2.1 foundation first).
- Admin tracks the M2.x milestones and the render-wall measurement (Q6).

## 8. Open questions entering Phase 1
- **Q3 perspective** → proposed P1-D1 (first-person on foot / third-person craft); confirm with Reid.
- **Q6 render wall** → measured for real at M2.3 (the integrated factory render). The one carried-over unknown.
- **Build legibility in 3D** (gameplay R2 / factory R3) → P1-D6 grid-snap; validate in playtest.
- **Craft control + map UX without scene transitions** (rendering R3 / gameplay R3) → gameplay Wave-1 design owns the first cut.

## 9. Definition of done (Phase 1)
A single-player build in which a player completes the §2 loop end-to-end — walk, automate, fly Forge→orbit→Cinder, mine the off-world resource, and save/reload — seamlessly, at a stable framerate with the slice-scale factory rendered. That build confirms the fusion *works as a game*, not just as isolated tech.

---

## 10. Phase-1 cross-domain contract register (surfaced by Wave-1 design; confirm in Wave 2)
The net-new domains (gameplay, persistence) surfaced new contracts that didn't exist after Phase 0 — they only materialize once the player loop and save are designed. These are the Phase-1 analogue of the Phase-0 RC register; they get confirmed/pinned when the built domains receive their Wave-2 integration briefs.

**STATUS: ALL CLOSED (reconciliation round, 2026-06-14).** No Phase-0 pinned contract was overturned; every change was additive.

| # | Contract | Owner(s) | Resolution |
|---|----------|----------|-----------|
| C-1 | **`FDepositNode`** deposit-catalog schema | world-gen | **Pinned (WG-11).** `Resource` field IS the gameplay `ItemId` directly (proposed `DepositTypeId` indirection dropped); + `ITerrainProvider` query surface (`GetDeposits`/`QueryDepositsNear`/`GetDeposit`/`ExtractFromDeposit`). Cinderite is Cinder-only (WG-4). |
| C-2 | **`FRecipeDef` / `FEntityDef`** | factory-sim (executes) / gameplay (authors) | **Pinned (FS-10 + GP content).** gameplay's authoring `FEntityDef` is a **superset** of factory-sim's executable one — shared `TypeId 0x10–0x16` + `Ports` + footprint verbatim; `BuildCost`/`SlopeToleranceRad` are gameplay-only (sim-ignored). |
| C-3 | **`ItemId → FItemDef`** registry | gameplay | **Pinned (GP-13).** `ItemId = uint16`, opaque, hand-assigned stable; single id space across inventory/machines/deposits/persistence. |
| C-4 | **`FGameplayPersistState`** | gameplay | **Finalized.** Player state only (pos/rot/frame/mode/craft/inventory/objective); cross-refs by opaque id. |
| C-5 | **Player intent/command APIs** (D-004-clean commands) | gameplay → physics + factory-sim | **Confirmed.** factory-sim confirmed its 5 intents + `QueryEntityInventory` map to validated tick-boundary mutations. **physics-side Admin-recorded** (craft/character intents → active integrator + character controller; board/disembark → existing handoff, physics validates landed+slow) — physics validates field-for-field at build. Each intent carries `FPlayerId` (GP-14). |
| C-6 | **`IPersistable`** per-domain | persistence (defines) | **Confirmed.** core-engine (seed+observer), world-gen (depletion), factory-sim (SoA/`FRailState`) confirmed in-file; physics (`FVesselOrbitalState`) + gameplay (`FGameplayPersistState`) Admin-recorded. Load order CoreEngine→WorldGen→Physics→FactorySim→Gameplay. |
| C-7 | **Save-quiesce tick handle** | core-engine | **Defined (CE-8).** `uint64 ISimClock::QuiesceAtTickBoundary(body)` — parks sim at end-of-tick N, all domains read at identical `TickIndex`, resumes without making up wall-clock. Additive. |
| C-8 | **`FChunkKey.RegionDepth`** (1 region ≈ 1 chunk) | core-engine + factory-sim + persistence | **LOCKED (Admin reconcile).** factory-sim chunk = ~1 km → via CE-9 formula `floor(log2(R·(π/2)/E))`: **Forge `RegionDepth`=9 (~1841 m region), Cinder=8 (~1227 m)**. Supersedes core-engine's 256 m placeholder (11/9) and persistence's depth-5–6 example — both to reflect 9/8 at build. |
| C-9 | **Camera/overlay-mode request** | gameplay → rendering | **Admin-recorded.** gameplay requesting a camera/overlay mode (build-overlay camera, map overlay) is within rendering's surface (it already owns cameras) — a mode toggle, not a new contract. rendering validates at build. |

**Doc-debt — propagate the locked C-8 value (flagged BLOCKER by the [2026-06-14 review](../REVIEW-2026-06-14.md); fix before build):** the authoritative value is **Forge `RegionDepth`=9 / Cinder=8** (this row). Stale/contradictory copies still to correct in the OWNING files: core-engine (CE-9 + header + §5 + spike §5.5/§8 show **11/9** — and that 256 m placeholder's Cinder digit was itself arithmetically wrong: E=256 m → 11/**10**), factory-sim §11.4 (shows **≈10**), persistence §3.1 (shows **5–6**). Until propagated, those four files contradict this register — so the C-8 *decision* is locked but the *closure is not fully propagated*.

## 11. Phase-1 status
- **Blueprint:** ✅ this doc. **All 8 domains have a Phase-1 design** (5 built domains via their spikes; gameplay + persistence via [gameplay-phase1.md](gameplay-phase1.md) + [persistence-phase1.md](persistence-phase1.md)).
- **Contract surface:** C-1…C-9 *decisions* all CLOSED (§10, reconciliation round 2026-06-14).
- **Independent review** ([REVIEW-2026-06-14](../REVIEW-2026-06-14.md)) — plan is design-complete but **NOT yet build-ready**: (1) the locked C-8 value isn't propagated to the owning files (BLOCKER); (2) `DepositTypeId` is stale in the gameplay docs after WG-11 dropped it (SHOULD-FIX); (3) execution items — UE5 project + toolchain/CI/test-harness, global perf budget + target hardware, schedule/headcount, networking replication validation — are unowned. Design thesis judged sound.
- **Next:** a propagation/scrub cleanup pass + an execution plan, *then* BUILD (M2.1→M2.5). **Phase-1 *design* is complete; "build-ready" requires the cleanup above.**
- **UPDATE 2026-06-15 — BUILT & SLICE LOOP PROVEN.** The build phase ran: C-8/scrub cleanup done, UE 5.7 project builds green over the cores, all headless slice logic green (ctest 13/13), and the **end-to-end slice loop is proven headlessly** (`core/tests/test_slice_e2e.cpp`): mine deposit → factory produces → research a tech → fly Forge→Cinder (SOI switch) → off-world Cinderite gate → save/reload, all through the real domain cores. The capstone surfaced 4 integration gaps to close (the seams between "domains work alone" and "loop is seamless"):
  - **GAP-1** — deposit id types differ (gameplay `DepositId` vs world-gen `FDepositNode.Id`); unify.
  - **GAP-2** — `FactorySim::producedCount()` is one monotonic total; add **per-item-type output tracking** so "science" is a distinct producible the research layer consumes (the real fix that makes mine→factory→science→research a true chain).
  - **GAP-3** — content: no Cinderite→science recipe authored; add the off-world science chain.
  - **GAP-4** — research/tech unlocks aren't in `SliceState`; add research state to gameplay's `IPersistable` so unlocks survive save/reload.
