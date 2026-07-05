# Goal-Gap Audit — Orbital Foundry

> **Auditor:** goal-gap subagent, reporting to Admin · **Date:** 2026-07-05 (review folder dated per the rethink kickoff) · **Method:** read-only analysis of docs + code (no editor run). Sources: `docs/MASTER_PLAN.md`, `docs/OVERNIGHT-2026-06-16.md`, `ue/CLAUDE.md` (M2.1 to M5.2), `docs/controllers/*.md` status headers, `docs/screenshots/` timeline, `core/include/of/` headers, `ue/Plugins/OrbitalFoundryCore` sources.

---

## 1. The reconciled goal

Two binding sources, one game:

1. **MASTER_PLAN vision:** seamless surface → orbit → interplanetary with no loading screens (the signature promise), KSP-grade orbital flight, Factorio automation at scale, procedural worlds, research progression, exploration/loot/questline, co-op multiplayer (implementation deferred, constraint binding), seed+diff persistence.
2. **Session-evolved direction (equally binding):** a Valheim-quality ground experience: first/third-person player on a real planet, rich populated environment (trees, rocks, foliage, water), harvest → inventory → hand-craft → furnace smelting, 1 m³ voxel-terraformable ground (dig down and sideways, walkable tunnels), grid-snapped building, miners that physically drill, belts/smelters/assemblers running in-world, smooth movement, physical item drops, tools in hand with animations.

**Reconciliation:** these are not competing visions; they are the two ends of the same promise. The reconciled goal is: *a Valheim-grade survival-automation game standing ON the real streamed procedural planet, where that planet is also the launchpad for KSP-grade continuous flight to a second world.* The ground game (source 2) is the surface end of the seamless traversal pillar (source 1). Priority order that falls out: **(a)** finish and unify the ground game, **(b)** give it a progression spine (research), **(c)** build the seam that connects it to the orbital half that already exists headlessly. Multiplayer and Cinder gameplay stay deferred but constrain design.

---

## 2. Gap table

Status key: ✅ integrated & playable · 🟡 rough-but-working · 🔵 demo-only or disconnected · ❌ missing.

| Pillar | Status | Evidence | What closing it requires |
|---|---|---|---|
| **Ground survival loop** (harvest→inventory→craft→smelt) | 🟡 **but split across two maps** | Full loop exists on `SurvivalTest` (M2.4 to M3.1b: E-harvest, 20-slot pack, Tab/I menu with drag/drop, hand recipes, `AOFFurnaceActor` manual smelting, dropped items with pickup/spill, tools in hand, FP view-model). On `PlanetSurface` the character (and its `UOFSurvivalComponent`) is shared, so harvest + inventory + hand-craft work (M4.1 PIE-verified harvest on the planet), but **no manual furnace is authored into `PlanetSurface.umap`**; smelting on the planet exists only via the automation smelter (M5.0). The canonical loop is not yet whole on the real planet. | Place/craft the furnace on `PlanetSurface`, verify the full loop end-to-end there, and declare `PlanetSurface` the canonical map. Small work; all pieces exist. |
| **Automation loop** (miner→belt→smelter→assembler, placement, grid) | 🟡 **on the planet** | M3.2 (SurvivalTest line, keys 4-7, ghost, auto-connect) then M5.0 moved it to the planet: 1 m grid snap in the surface-local frame, 90° rotation, visible grid decal, edge-to-edge auto-connect; PIE-verified self-feeding miner→belt→belt→smelter on `PlanetSurface`. M4.6/M5.2: miners physically drill heightfield shafts + voxel columns. | Missing depth: **power is unwired** (miners draw 0 W, no brownout despite the headless power graph being green), **placement costs nothing** (no crafted-item gating), belts are straight two-click segments, inserters not exposed, no on-rails abstraction in-engine. |
| **Voxel terraforming / tunnels** | 🟡 functional, visually rough | M5.2 PIE-verified: pickaxe carves 1 m³ voxels, pit then sideways tunnel with solid ceiling, C++ `ECC_WorldStatic` collision on floor AND ceiling, player walks inside. Voxel edits + deform map serialize and reload exactly (450/450). Miners bore voxel columns. | **Enjoyability gap:** blocky cube-face mesher, cavities render pitch black (no skylight), voxel proc-surface sits metres off chunk collision (needs the surface-snap workaround), no material/texture on cut faces. Needs a smooth mesher (dual contouring or marching cubes), in-cavity lighting, and cut-face material to feel Valheim-grade. |
| **Environment richness** (biomes, foliage, water, textures, atmosphere) | 🟡 | Climate-driven biomes with designed relief (headless, 2.6× optimized); M5.1 biome foliage scatter (2600 HISM instances, Maxtree/Abelia/Lolium/RockSample, biome-correct mix verified Forest vs Hills, rebase-stable); M4.3 per-biome Megascans ground blend; M3.0 Lumen + atmosphere + volumetric fog. | **Water is the loudest hole:** ocean is flat blue vertex colour; the user-added `WaterMaterials` pack is unwired (and untracked). No dedicated snow/sand surfaces (Polar tints rock). Foliage range only 110 m (no imposters/far cover). ~850 MB of untracked asset dirs (`B3D/`, `Megaplant_Library/`, `WaterMaterials/`) need a commit-or-delete decision. No audio at all. |
| **Player feel** (movement, sprint, camera, tools, animations) | 🟡 | Real physical walking on chunk collision, PIE-measured jank-free (M4.3: 15 consecutive constant-velocity samples); sprint 3.5× (M4.5); FP/TP toggle; Mannequin locomotion; held tools + swing montage + FP view-model with the black-slab shadow bug fixed; crosshair + prompt HUD; nodes embedded and surface-perpendicular. | Residual jank: capsule is world-Z-up only (works via the frame-aligned root, but is a standing constraint); no footstep/impact audio; swing is one canned montage; no jump/fall tuning, stamina, or damage. A polish batch, not an architecture problem. |
| **Surface↔orbit seam** (THE signature promise) | ❌ **in-engine** (🔵 parts exist in isolation) | Be blunt: **the core promise has no playable path.** What exists: (a) headless `SimWorld` flies the full Forge surface → orbit → SOI switch → Cinder landing, green (67 rebases, drift 1.2e-15); (b) M2.2 `AOFVesselActor` replays that journey at **0.001 scale, editor-stepped, not PIE**, and teleports across the transfer; (c) M2.1 scaled-space planet previews. The ground game runs at **MetreToUE=100**, the orbital demo at **0.001**: two disconnected renderings of the same core that never meet. No dual-camera rig (RN-1 is designed, unbuilt), no vessel the walking player can board, no 1:1 ascent off the real planet. | Build RN-1 (dual camera scaled space) on `PlanetSurface`; a boardable vessel pawn bound to `SimWorld` at 1:1; the near-field↔scaled-space handoff on ascent. Hardest remaining work, but the two halves it must join are each proven. |
| **Research / tech progression** | 🔵 headless-only | `core/include/of/research.h` (TechTree, ResearchState, off-world gate) + the science chain proven in `test_slice_e2e`; unlocks persist (PS-11). **Grep of the UE plugin source: zero matches for research/science.** Nothing is reachable in-game; the factory has no purpose once the line runs. | Modest: the pImpl binding pattern is proven (`UOFSurvivalComponent`, `AOFAutomationManager`). Needs a lab building fed by the line, a science item, a research tab in the existing menu, and unlock gating on build keys/recipes. |
| **Persistence** | 🔵 fragmented | In-engine: terrain deform + voxel edits save/load to `Saved/OrbitalFoundry/deform_*.bin`, PIE-verified exact restore (M4.6/M5.2). Headless: 276-byte seed+diff slice save, atomic file container (PS-10), research persist (PS-11), all green. **Not saved in any playable session: inventory, placed buildings/automation network, player position, node depletion, research.** No save/load UI or autosave. | A unified save slot: bind the headless `persistence_file` container to the UE session (inventory + buildings + deform + voxels + player pos in one atomic file). The container and the serializers exist; this is wiring, not research. |
| **Second world (Cinder) gameplay** | 🔵 preview-only | Headless: Cinder terrain + Cinderite deposits (Cinder-only, WG-14) green. In-engine: only the M2.1 scaled preview mesh and the M2.2 vessel demo landing. `PlanetSurface` streams Forge only; no Cinder surface walk exists. | Blocked behind the seam by definition (you get there by flying). `AOFPlanetTerrain` + `SurfaceObserver` are body-parameterized headlessly, so a Cinder surface map is cheap **later**; do not build it before the seam. |
| **Multiplayer** | ❌ (deferred by design; constraint live) | RC-9 headless replication seam validated (`net_replication.h`, chunk-local determinism + delta sync). Nothing in-engine. Deferring is per D-004/D-005 and fine. **Watch item:** voxel edits, deform edits, and building placement were all built client-local with no authority pathway noted; each new world-mutating system widens the future retrofit. | Keep deferring implementation, but require a one-paragraph server-authority note in each new system's design (voxel/deform edit sets and build placement are natural server-validated intents; cheap to specify now). |
| **Questline / loot / exploration** | ❌ | MASTER_PLAN pillar 4. Headless `gameplay.h` has the slice objective state machine (used in e2e tests) and that is all. No POIs, no ruins/loot, no quest surface anywhere in-engine. World-gen POI placement unstarted. | Phase-4 content per the original roadmap. The one near-term piece worth pulling forward: a thin objective thread ("automate → research → reach orbit") reusing the existing objective machine, to point the player at the seam. |

---

## 3. Ranked gaps (impact on the combined fantasy × feasibility)

1. **Progression void (research wiring).** Highest impact-per-effort in the project. The ground game exists but dead-ends: nothing to unlock, no reason to automate. All logic is headless-green; binding is a known pattern. Feasibility: high. Impact: turns a sandbox into a game.
2. **Fragmented persistence (unified save).** A session cannot resume; everything except holes evaporates on restart. Kills the "live on this planet" fantasy Valheim runs on. Feasibility: high (container + serializers exist). Impact: high.
3. **Split ground loop (SurvivalTest vs PlanetSurface).** The full survival loop must live on the planet, and SurvivalTest must stop absorbing polish. Feasibility: trivial-to-small. Impact: medium-high (coherence, and it de-duplicates all future work).
4. **The seam (RN-1 + 1:1 vessel).** The signature promise and the biggest single build. Impact: defines the product. Feasibility: medium; both halves are individually proven (headless flight loop green; 180 km ground walks with 99 stable rebases), which is exactly the de-risking the seam needed. Should follow 1-3, not precede them: launching to orbit is only magical if there is a base worth leaving and a save to return to.
5. **Voxel/environment enjoyability polish** (smooth mesher, cavity light, ocean water, audio). Feasibility: medium. Impact: medium (feel, screenshots, the "rich world" half of the fantasy).
6. **Power + build costs.** Factorio depth beyond the demo line. Feasibility: high (power graph is headless-green). Impact: medium.
7. **Questline/loot/POIs.** Impact real but late; needs world-gen POI work first. Defer, except the thin objective thread.
8. **Cinder surface + multiplayer.** Correctly deferred. Keep the MP authority-note discipline; touch Cinder only after the seam.

---

## 4. Recommended next 3 phases (roadmap skeleton)

**Phase A — CONSOLIDATE: "One planet, one loop, one save."**
- Full survival loop on `PlanetSurface` (manual furnace on-planet; declare it canonical; freeze `SurvivalTest` as a test bed only). *Rationale: stop building the game in two places.*
- Unified save slot: inventory + placed buildings/network + player position + deform + voxels + (future) research in one atomic file via the existing headless container. *Rationale: a survival game you cannot leave and re-enter is a demo.*
- Enjoyability batch: smooth voxel mesher + cavity lighting, ocean material from the user's WaterMaterials pack, first audio pass; settle the ~850 MB untracked asset dirs. *Rationale: cheapest wins toward the Valheim bar using assets already on disk.*

**Phase B — BUILD: the progression spine.**
- Lab building + science items through the automation line → `research.h` TechTree unlocks gating buildings/recipes/tools, surfaced as a research tab in the existing menu. Add build costs and wire the power graph (brownout visible in-world). *Rationale: gives the factory a purpose; every piece is headless-green and the binding pattern is proven.*
- Thin objective thread on the existing objective machine, ending at "build a launch pad." *Rationale: narrative pointer at Phase C for near-zero cost.*

**Phase C — BUILD: the seam (RN-1 + 1:1 ascent).**
- Dual-camera scaled-space rig on `PlanetSurface`; a buildable/boardable vessel pawn bound to `SimWorld`; continuous ascent from the real streamed surface to orbit (Cinder landing later). *Rationale: the signature promise, attempted exactly once the ground game is coherent, saveable, and pointing at it; the headless flight loop and the rebase-stable ground architecture are the two proofs it composes.*

**STOP / redirect flags**
- **Stop any further SurvivalTest-only polish**: all of it is throwaway once PlanetSurface is canonical.
- **Stop widening the voxel feature set** (cave content, voxel placing, ore-in-walls) beyond the Phase-A mesher/lighting polish until save + research exist; it is currently ahead of the systems that would make it matter.
- **Do not start Cinder surface gameplay or MP implementation**; do start requiring the one-paragraph server-authority note on every new world-mutating system (voxel/deform/build edits) to cap the retrofit debt.
- **Decide the untracked asset dirs** (`B3D/`, `Megaplant_Library/`, `WaterMaterials/`, ~850 MB): wire-and-commit or delete; floating multi-hundred-MB dirs are repo risk.

---

## 5. State snapshot (for the record)

- Headless: 19/21 ctest suites green (the 2 failures are a pre-existing `0xc0000139` DLL-load environment issue, not logic).
- In-engine milestones M2.1 through M5.2 landed; both maps playable in PIE; screenshots timeline `docs/screenshots/M2.1_* → M5.2_*` matches the doc claims.
- Known open in-engine defects: voxel cavities render black; voxel surface offset needs surface-snap; LOD coarse↔fine seams covered by skirts (not provably gap-free); miners draw zero power; canonical planet-wide deposit field too sparse to walk (~634 deposits on all of Forge, local dense re-evaluation used as workaround, density knob flagged for world-gen).
