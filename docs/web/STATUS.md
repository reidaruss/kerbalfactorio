# Orbital Foundry: current status and resume point

**Read this first after any session break.** Living status doc, updated at milestone boundaries.
Last updated 2026-07-26.

## What this project is now

A **Three.js / WebAssembly browser game**, pivoted from Unreal on 2026-07-05. KSP crossed with
Factorio: first person by default (V toggles third person) on a real procedurally generated
planet. Harvest, hand-craft, build grid-snapped factories, dig 1 m voxel tunnels, research, and
ultimately launch to orbit and reach the moon Cinder, with no loading screens.

The headless C++ simulation in `core/` is unchanged and is the crown jewel: 22 green ctest suites,
deterministic, compiled to WASM and driven from JS. The Unreal layer is **frozen**, not deleted
(tag `ue-frozen-2026-07-05`, unfinished work on branch `archive/ue-r2b-wip`).

## Required reading, in order

1. `docs/web/DECISIONS.md` (DW-1..DW-23 plus standing engineering rules 1 to 8). **Rules 1, 5, 6
   and DW-20 are the ones that have actually bitten people.**
2. `docs/web/ARCHITECTURE.md` (engine and rendering design, milestones W0 to W9, and **§15.2,
   the growing list of things that did not survive contact with reality**).
3. `docs/web/WASM-BRIDGE.md` (the `/core` C API, ABI 2, memory and ownership conventions).
4. `docs/web/ASSET-SPECS.md` (the complete asset manifest and the Blender pipeline).
5. `docs/review-2026-06-16/RETHINK.md` (why the project was restructured; still the strategic plan).

## Milestone state

| Milestone | State |
|---|---|
| W0 skeleton, four-pass renderer, WASM handshake, dev loop | done |
| W1 streamed procedural planet renders in a browser | done |
| W2 character controller, sustained-walk floating origin, LOD stitching, reversed-Z closed | done |
| W3 sky, sun, cascaded shadows, analytic atmosphere, stream-in cross-fade, cube-face culling fix | done |
| W4 look and feel: BatchedMesh terrain, rigged player, biome props | done |
| **W5 voxel digging and tunnels** | **in flight: dig, mesh, collision, mouth and a WALKABLE tunnel all verified** |
| **W5g gameplay slice: harvest, inventory, hand crafting, placeable furnace** | **done and driven-verified 2026-07-26** |
| W6 building and automation in-world (also the WebGPU re-evaluation gate) | pending |
| W7 progression: research wired to play, build costs, power | pending |
| W8 **the seam**: boardable vessel, launch to orbit | pending, the signature milestone |
| W9 Cinder | pending |

**Art manifest is COMPLETE: 42/42 assets validated**, full rebuild produces a zero-byte diff,
2.43 MB total, zero textures. Tier 0 (player rig 44 bones/14 clips, FP arms, tools, 13 machines,
9 harvest nodes, items atlas), Tier 1 (10 biome atlases, 41 props), Tier 2 (rocket parts on a
1.25 m stack contract, launch pad, lander, far-scene sphere, plume).

## The gameplay slice (W5g, 2026-07-26)

**It is playable.** Spawn into a clearing of 24 harvest nodes, aim at one, press
**E** to swing, and the yield goes into a 20-slot pack. **Tab** opens the
inventory and hand-crafting panel; craft a pickaxe or an axe (which multiply the
yield of the matching node kind) or a primitive furnace. Press **G** to place the
furnace on the 1 m grid, **E** to open it, load ore and fuel from the pack, and
take the iron out when it has smelted.

Every rule is `/core`'s: `web/wasm/of_core_api.cpp` section 9 is a flat C shim
over `gameplay.h` (`Inventory`, `harvestNode`, `HandCrafter`, `Furnace`) and the
browser holds no opinion the headless suites do not. Parity CASE 9 covers it:
self-determinism 29 -> 88 assertions.

Screenshots: `docs/screenshots/W5_harvest.png`, `W5_inventory.png`,
`W5_crafting.png`, `W5_furnace.png`. Probes:
`web/tools/smoke/probes/{harvest,inventory,furnace}.js`.

## W6 gameplay feel (2026-07-26)

The slice worked and read as a spreadsheet with a tree in front of it. Four
things changed, all driven-verified.

**`/core` can finish a node.** `harvestNode` truncated the last sub-unit
remainder to a `uint16` 0, so every node in the world parked just above empty
for ever (ARCHITECTURE 15.2 item 61). A positive remainder now rounds up to one
unit and drains the node. 22/22 ctest green.

**Balance.** Swings-to-clear is the authored constant (`gameplay.h` S.2a: 6
bare handed, 3 with the matching tool) and the per-swing yield is derived from
the node's own size, because a flat yield cannot serve both a 30-unit tree and
a 200-unit coal seam. Measured in the browser: bare 6 swings for every kind
(tree 4/swing, rock 6, iron 29, coal 30, copper 33), tool 3 swings for every
kind. One swing at a tree plus one at an iron node buys BOTH tools, so the
no-deadlock property is now a tested claim, not an assertion.

**Impact.** The grant already fired on the authored impact frame (17 of 33);
the feedback now hangs off it. Chips in the resource's own palette colour, a
squash-and-wobble on the node, a camera kick applied as the per-tick difference
of an authored pitch curve (so the offsets sum to zero and the aim cannot
drift), and a coloured `+N Item` popping out of a blooming crosshair.

**The furnace does visible work.** The emissive fire card and `socket_smoke`
the .glb has always shipped are wired to /core's furnace state in three states:
burning, embers (fuel but nothing to smelt), cold. The mouth turns to face
whoever placed the machine, because the fire is only visible from that side.

**Draw calls: the clearing costs 8, not 25.** 31 at `?gameplay=0`, 39 with the
whole gameplay layer on screen, against a 150 budget. Two `BatchedMesh`es for
all 24 nodes (per-material was measured at 28 and gave the saving back to the
shadow cascades: ARCHITECTURE 15.2 item 63).

Screenshots: `docs/screenshots/W6_harvest_impact.png`, `W6_furnace_lit.png`.
Probes: `web/tools/smoke/probes/{impact,furnacelit,balance}.js`, all
`valid: true`.

**Known, and not gameplay's to fix:** the walk stalls about 3.8 m short of a
node and will not close further (`grounded true`, `blockedByRock false`, slope
11 deg), which is why reach is now measured to the node rather than to its
pivot. `probes/impact.js` logs the per-iteration distance for whoever owns the
character controller.

## Commands

```
npm --prefix web run dev                     # dev server (or the of-web launch.json entry)
node web/tools/smoke/run.mjs --scenario=surface --out=docs/screenshots/x.png [--seed= --eval='<js>']
node web/tools/smoke/lodsweep.mjs 1.4/14              # DW-19 cost curve, in-browser
npm --prefix web run sync-wasm                        # MANDATORY after build.ps1
node web/wasm/test/parity.mjs                # WASM vs native parity gate
npm --prefix web run check                   # 400-line module cap gate
python tools/blender/validate_glb.py --all   # asset contract gate (must stay 42/42)
web/wasm/build.ps1                           # rebuild the wasm (activates emsdk itself)
```

Emscripten lives at `C:\Users\reida\emsdk`. In PowerShell activate with `& "C:\Users\reida\emsdk\emsdk_env.ps1"`.

## Measured baseline (RTX 4060 Ti, 1600x900)

Full frame 0.993 ms, shadows 0.123 ms, atmosphere below the 0.03 ms floor. Draw calls 141 to 157
on the surface (**the one budget under pressure**, target 150, which is why W4 does the
BatchedMesh upgrade before adding foliage), 32 to 46 from orbit. Triangles 288 to 320k of 2.7 M.
VRAM 60.1 MB, 48 MB of it shadow maps. Oracle calls 1.9 to 3.2 us synchronous on the main thread.
Chunk build and pack 1.8 to 3.5 ms against a 12 ms gate.

## Open items and known risks

- **Draw calls** are the binding constraint, not frame time. W4a addresses it.
- The rigged player currently receives no terrain shadow, and cascade-to-cascade blending is not
  implemented (W4).
- **DW-18 is DONE.** Forge carries `BodyParams::muM3S2 = 9.81 * 600e3^2 = 3.5316e12`, the one
  gravity authority. Measured in the browser: 9.7138 m/s^2 at a 2,963 m site, jump airtime 0.833 s
  and apex 0.857 m (was 4.8 s), circular orbit 2.406 km/s at 10 km and 2.279 km/s at 80 km. Nothing
  orbital was re-baselined: `of::orbital`'s constants were already the target values, and mu takes
  no part in world generation so no terrain moved.
- **DW-19 is DONE.** Shipped `splitRatio` 1.4 / `maxDepth` 14. Measured at the feet on driven
  walks: **plain 1.808 m, mountain 1.738 m**, both `containsFeet` asserted. Cost against
  `maxDepth` 12: resident 270 -> 309, pool 10.1 -> 15.8 MB, frame p95 1.20 -> 1.60 ms, draw calls
  31 of 150. Crack-free holds (0 hole pixels stitched, 2 with `?stitch=0`). **`splitRatio` must
  stay below 2.0**: the metric measures the quad CENTRE, so 2.0 collapses a mountain to 108 chunks
  with no near terrain at all (ARCHITECTURE.md 15.2 item 45).
- **W5 tunnels are WALKABLE and the dig hitch is gone (2026-07-26).** Driven acceptance is
  `tools/smoke/probes/tunnelwalk.js`, which digs a tunnel and then walks it with the dig key
  released, so every metre it reports is pre-existing passage: **7.73 m walked, 10/10 samples
  grounded, 10/10 on a voxel floor, 10/10 with rock overhead, 10/10 with `derivedLoweringAt` 0
  (a trench would report metres), 0 blocked**, 899 ticks, 15 strikes landed, chunks converged.
  Three causes, only one of which was the bore: a refused step was refusing the whole tick
  (15.2 item 57), the capsule was one point at the feet, and a 1.2 m brush clears only two cells
  off-lattice (item 58). Brush is now 1.5 m, the walker slides and steps up, and the capsule is
  sampled at three heights. **Re-mesh 55.3 ms -> 5.0 ms max / 1.65 ms mean, worst frame 61.1 ->
  3.8 ms** (item 59: memoized `isProcSolid`, a dense solidity slab in `exposedFaces`, and
  `VoxelMesh` caching 8-cell bricks instead of re-meshing every box ever dug). Strike debris
  (`render/DigFx.ts`) is one draw call and no new shader. Screenshot `W5_tunnel_walk.png`.
- **W5 remaining:** voxel edits are not persisted (DW-17) and dug volume is not in the inventory
  UI. Tunnel lighting is the near scene's ambient only, so a deep tunnel reads flat. The tunnel
  mouth still relies on the shallow radial push, which is the one path 15.2 item 48 is about.
- **A rebuild is not a deploy.** `web/wasm/build.ps1` writes `web/wasm/dist`; the client serves
  `web/public/wasm`, which is gitignored and only refreshed by `npm run sync-wasm`. A stale copy
  cost most of a session: the browser reproduced the exact DW-19 saturation signature that `/core`
  had already fixed. **Always run `build.ps1` then `sync-wasm`.**
- **This was the five-surfaces failure for the third and fourth time** (UE build, the WASM bridge
  observer, the LOD metric, and then gravity: `KinematicBody` transcribed /core's density model into
  JS and would have held the browser at 0.587 m/s^2 after DW-18 moved /core to mu). Standing rule 1 says every consumer reads `surface_field.h`, and
  three separate components have still broken it. When touching anything that computes a height,
  a radius, or a distance to the ground, check which surface it samples **first**.
- **DW-15 gate:** before any native peer (multiplayer server or native port) exists, vendor
  `tan`/`asin`/`atan2`/`cos` into `/core` and re-baseline. A 1 ULP libm difference grows a
  different planet from the same seed.
- Persistence is still browser-side work: `persistence_file.h` is excluded from WASM, so the
  unified save (inventory, buildings, research, voxel edits) moves to IndexedDB/OPFS (DW-17).

## Process rules that have earned their place

1. **Commit incrementally.** Several agents were killed mid-task by account limits today. The ones
   that committed as they went lost nothing.
2. **Verification must be driven, not posed**, and per DW-20 a probe must prove it advanced the
   simulation before its numbers are trusted.
3. **Measure before believing a diagnosis.** Three separate "known" defects this session turned out
   to be misdiagnosed, including one where a proxy sphere was hiding half a missing planet.
