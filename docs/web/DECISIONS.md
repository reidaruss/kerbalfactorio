# Web pivot: Admin decision log

Decisions owned by the Admin Master Controller for the Three.js pivot. Agents: read this
before starting web work. Companion docs: [ARCHITECTURE.md](ARCHITECTURE.md) (rendering
and engine), [WASM-BRIDGE.md](WASM-BRIDGE.md) (the `/core` C API), [ASSET-SPECS.md](ASSET-SPECS.md)
(models and the Blender pipeline). Plan of record for the project overall remains
[RETHINK.md](../review-2026-06-16/RETHINK.md), with Phase R consolidation absorbed into this pivot.

| # | Decision | Rationale | Date |
|---|---|---|---|
| DW-1 | `/core` ships to the browser as **WebAssembly (Emscripten)**, not a TypeScript port | Preserves 22 green suites, bit-exact determinism, and the 64-bit position hashing. A port would forfeit all three and cost weeks | 2026-07-05 |
| DW-2 | **Vanilla three.js + TypeScript + Vite**; game UI is an **HTML/CSS overlay** | React reconciliation is a liability in a streaming game loop. HTML UI is a large win over UMG for inventory, crafting and HUD | 2026-07-05 |
| DW-3 | **Dual-camera scaled space** (far scene, depth clear, near scene at 1:1) **plus logarithmic depth** | This is RN-1 from the original design. It is what makes the surface to orbit seam tractable, and it is materially easier in three.js than it was in UE | 2026-07-05 |
| DW-4 | **Web Workers** own terrain and voxel meshing and the factory tick, with WASM instances per worker | Keeps the main thread at frame budget. COOP/COEP headers via a Vite plugin where SharedArrayBuffer is used | 2026-07-05 |
| DW-5 | Assets are **our own stylized-industrial low-poly PBR**, authored by **headless Blender Python** to glTF/GLB | Deterministic, version controlled, diffable, re-runnable. The 3.4 GB of UE Fab content does not transfer (`.uasset` is engine-locked) | 2026-07-05 |
| DW-6 | The UE layer is **frozen, not deleted**: tag `ue-frozen-2026-07-05`, unfinished R2b work on `archive/ue-r2b-wip` | It is the reference implementation for gameplay wiring. Keep it readable, stop investing in it | 2026-07-05 |
| DW-7 | **Player rig**: headless automatic weights first; escalate to a hand-authored `.blend` in `assets/models/src/` only if deformation is visibly bad | The rig is the one Tier-0 asset a script cannot fully author. Accept a hybrid here rather than forcing purity, but keep every other asset script-authored | 2026-07-05 |
| DW-8 | **Belt animation is shader-driven, never per-belt `AnimationMixer`s**: a per-instance flow attribute fed from `FFactoryBeltFlowState` scrolls the material; discrete item meshes come from `GetLineItems` only at LOD 0 | This is exactly the O(items) to O(lines) collapse that `render_cost.h` validated (100k entities to 72 draw calls). Per-belt mixers would reintroduce the render wall. The authored `Belt_Scroll` clip stays as preview and reference only | 2026-07-05 |
| DW-9 | **Inserters are sim-internal, not player-placeable** in v1: `BuildableNetwork::connect` creates them, so they need no item id or `BuildKind`. Render the mesh wherever a connection exists, as Factorio-style feedback | Keeps the build menu honest (players place miners, belts, smelters, assemblers) while making connections legible. Revisit if manual routing becomes a design goal | 2026-07-05 |

## Standing engineering rules for web work

1. **One surface authority.** Everything reads `surface_field.h` through the WASM bridge. No module re-derives terrain height or solidity. This is the rule whose absence caused every major bug in the UE build.
2. **No god objects.** Modules have one responsibility and are named for it. An integration pass follows every few feature passes.
3. **Verification is driven, not posed.** Acceptance means a scripted browser run with real input and captured console plus screenshots, never a static render.
4. **Determinism is a feature.** Same seed and same op sequence produce the same world. Parity against the C++ suites is the gate for any core change.
