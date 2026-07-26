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
| **W6 building and automation in-world** (also the WebGPU re-evaluation gate) | **automation, demolition, audio and a save slot done and driven-verified 2026-07-26; power and build costs are W7** |
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

## Automation: a line that runs while you walk away (W6, 2026-07-26)

**Press 1, 2 or 3 to take a miner, a belt or a smelter in hand.** A ghost snaps
to /core's own 1 m lattice, **R** turns it in quarter turns and **G** puts it
down; the ghost is RED with the reason before the key is pressed, not an error
message after it. Put a miner on an ore node, lay belts back to a smelter, then
walk away: **E** on the smelter takes the iron out. The automated iron is what
makes the survival smelter (5 Iron + 5 Stone) craftable, so the loop ends in a
recipe rather than in a shrug.

**Driven acceptance** (`probes/autoline.js`, `valid: true`, 26 unattended
seconds): /core ticked **1562 against an expected 1560** (DW-20), the world node
lost **64** ore, the miner extracted **64**, the drain moved **64**, the smelter
produced **16** iron with nobody feeding it, and collecting took 16 while the
buffer fell 16 and the pack grew 16. Then Smelter craftable **false -> true ->
crafted**, pack `Stone:6 Iron:16` -> `Stone:1 Iron:11 Smelter:1`.
`probes/buildghost.js` covers build mode before anything is placed: quarter
turns perpendicular to 1e-3 and closing to 1.0 after four, a lattice cell that
changes 1.017 m at a time, and the two refusals ("no ore deposit here", "cell
taken") reported by the ghost itself.

**Every rule is /core's.** `automation.h`'s `BuildableNetwork` does the placing,
the wiring (`connect` auto-creates the inserters, DW-9) and the tick;
`of_core_api.cpp` section 7 is the shim, extended with the placement surface
(`place_miner_for_node`, `set_placement`, `entity_index`, `take_output`) plus
`of_gp_node_drain`, which is what keeps the world node and the miner deposit ONE
pool of ore. Parity CASE 10 covers it: self-determinism 88 -> **119**,
cross-toolchain 94/94, 22/22 ctest.

**DW-8 is kept as an absence.** There is no `AnimationMixer`, no per-belt clock
and no per-item object anywhere: a tile's flow speed and fill fraction are one
texel read from ONE `FFactoryBeltFlowState` row via three's own batching id. One
`BatchedMesh` and one material draw the whole factory, so a six-building line
plus its inserters costs **43 draw calls of 150** (39 before it).

Screenshots: `docs/screenshots/W6_autoline.png`, `W6_build_ghost.png`.

**What is missing, plainly.** Placement is free (build costs are W7, with
power); a belt that turns a corner still chains but the tiles are drawn as
straight segments, so the curve assets are unused; and belts hold at most one or
two items at these rates, so the flow material is proving itself on a trickle
rather than on a saturated line.

## W6 polish: removal, sound, moments and a save slot (2026-07-26)

Four gaps closed, all driven-verified. ARCHITECTURE 15.2 items 76 to 82.

**You can take it back down.** Aim at any placed miner, belt, smelter or hand
furnace and press **X**. The plan is edited and the network rebuilt from it, the
SAME path a placement takes, because `FactorySim` is append-only by design and
so a removal must not grow an entity-removal API (15.2 item 69). Finished stock
and a smelter's un-smelted input come back to the pack; items riding a belt and
ore already inside a furnace pool CANNOT, and both are said out loud in the
removal's own toast and counted in `__of.game().demolition`.

Driven acceptance (`probes/demolish.js`, `valid: true`) asserts the NEGATIVE,
because a wrong rebuild would keep working: three windows of identical length,
840 core ticks each, producing **6 ingots, then 0 with the middle tile of the
longest run pulled out, then 6 again with it back**. Runs `[3,1] -> [1,1,1] ->
[3,1]`, buildings 6 -> 5 -> 6, and the 2 items lost off the belt named in the
toast. The X key is proved separately to reach the same handler.

**It makes noise, and it ships no audio.** Everything is synthesised with
WebAudio: seven one-shot voices (a thunk in wood, a sharper crack in stone, a
footstep cadence driven by distance covered rather than a timer, a collapse, a
chime, a confirmation, and its reverse for removal) plus TWO continuous beds for
the whole world, a machine hum and a fire crackle, whose level comes from the
distance to the nearest contributor. One bed each, not one per machine: the
DW-8 argument applied to sound. Pitch is hashed per event, **M** mutes, the
setting survives a reload, and the context is created lazily and resumed on the
first real gesture. Measured: **31 plays for 2.9 ms** of total CPU.

The acceptance is a RENDER, not a counter (`probes/moments.js`): the same synth
functions are run through an `OfflineAudioContext`, which no autoplay policy
blocks, and the waveform is measured. Peaks 0.022 to 0.410, **none silent**.

**The two missing moments.** A node that empties now visibly collapses, a tree
going over AWAY from whoever felled it and a boulder sinking into its own
footprint, with a 44-chip burst against a normal swing's 8 to 22, a banner that
names the thing (TREE FELLED, not "wood cleared") and a low crash. A finished
smelt announces itself where the machine is, with a pop of pale chips, a chime
and a banner, so a player who walked away learns their line produced something
without opening anything. Driven: 6 swings, node to 0, felled fires once, and
the collapse is caught MID-FLIGHT.

**DW-17 is DONE, one slot.** `of_gp_inventory_serialize` writes the pack with
`persistence.h`'s own `SaveWriter`, so the byte format keeps exactly one author;
the container is IndexedDB because `persistence_file.h` needs a filesystem the
browser does not have. The slot carries the pack, the harvest-node depletion
diff, the whole factory plan and the hand-placed machines with their contents.
Terrain, biomes and the clearing's LAYOUT regenerate from the seed and are not
saved (PS-7): a four-building world was **41 bytes of pack** plus its plan.
Autosave every 20 sim seconds and on `pagehide`; restored in `Gameplay.create`
over a freshly populated clearing, in that order, because a miner is seeded from
its node's remaining ore.

`probes/persist.js` (`valid: true`): save, demolish everything, CHANGE the pack
(not empty it, so a merge cannot pass), regrow the clearing from the seed, load.
Pack, cells, buildings and all four node depletions come back exactly.

**Not saved, and not hidden:** voxel edits (the `VoxelEdits` handle lives in
Services, outside the gameplay module's ownership; `of_edits_serialize` already
exists for whoever wires it) and a furnace's burning fuel, which is a tick
countdown with no item to give back. Both are counted in the restore ledger.

Screenshots: `docs/screenshots/W6_demolish.png`, `W6_felled.png`,
`W6_persist.png`. Probes: `demolish.js`, `moments.js`, `persist.js`.

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
- **Underground is DARK and the headlamp does the work (W5, verified 2026-07-26).** One
  measurement drives everything: how much sky the eye can still see, sampled straight up through
  `surface_field.h` (`render/Headlamp.ts`). It feeds a `SpotLight` on the rig's `socket_lamp`
  offset, the near and view-model hemisphere ambient, `scene.environmentIntensity`, and a
  `sunScale` that Systems multiplies into every sun light. **L** toggles the lamp; it also comes
  on by itself as the sky closes over, and the fade back to daylight is a slower constant than
  the fade to dark (0.6 s against 0.12 s), so stepping out of a mouth reads as relief.
  Acceptance is `tools/smoke/probes/tunnellit.js`, which digs, walks **8.37 m** of finished
  passage (10/10 grounded, rock overhead, column still closed) and then measures the SAME frame
  with the lamp off and on using `__of.framehash()` tile luminance: **daylight 118.6, tunnel
  6.8 off, 23.6 on, a 3.46x lift**. Screenshots `W5_tunnel_lit.png` and `W5_surface_daylight.png`.
  Cost underground **43 draw calls, p50 1.6 ms, p99 2.5 ms**; surface unchanged at **39 draws,
  p99 2.4 ms**, and at full sky visibility the ambient is numerically the same one W3 shipped.
  **No new custom shader: DW-10's cap of 5 is untouched.** The stall this closed is 15.2 item 83.
- **Third person is broken INSIDE a tunnel, and it is the spring arm, not the light.**
  `ViewMode.springArm` probes only `oracle.surfaceRadius`, so under a hillside every candidate
  point is already below the heightfield and the arm collapses to 0 on the first step: the camera
  sits inside the player's own head and the daylit terrain above fills the top of the frame. The
  lamp itself is correct in TP (it rides the player's eye and aim, not the camera: luma 11.2 off
  to 22.9 on). The fix is to make the probe voxel-aware (`oracle.solidAt`) instead of
  heightfield-only, which also has to stop the heightfield test from firing when the eye is
  already under rock. Reproduce with
  `--evalfile=tools/smoke/probes/tunnellit.js --evalargs='{"shotView":"TP"}'`.
- **The dig mouth is EXACT now, and 15.2 item 48 is closed (2026-07-26).** The shallow rim
  resolver pushed the capsule RADIALLY by `heightM - h + 1.0`, up to 2.8 m, sized from the
  player rather than from the rock, which is why it had to be switched off below 1.5 m to stop
  it levitating people through their own ceiling. `player/VoxelCollision.ts` replaces it with
  the minimum translation out of the offending cell FACE, over the six axis directions: a
  voxel's contact normal is always a body-frame axis, so it is exact rather than approximate,
  it can never exceed one cell, and the mouth and the tunnel are now ONE resolver with no
  1.5 m seam. Measured on the driven `tunnelwalk.js`: **max `voxelPushM` 2.8 m -> 0.003 m**,
  with the ceiling property intact (**10/10 rock overhead, 10/10 `derivedLoweringAt` 0, 0
  blocked, 8.38 m walked, 899 ticks, 22 strikes, 186 cells**), so a horizontal tunnel under
  solid ground still leaves the surface closed. See 15.2 item 85.
- **W5 remaining:** dug volume is not in the inventory UI.
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
- **DW-17 is DONE for the pack, the buildings and the node depletion** (IndexedDB, autosave every
  20 s and on `pagehide`, `probes/persist.js` green). **Voxel edits are still not persisted:**
  `of_edits_serialize` exists and works, but the `VoxelEdits` handle lives in `Services`, so
  wiring it belongs to whoever owns the voxel layer. Research is not persisted either (it is not
  wired to play yet: W7).

## Process rules that have earned their place

1. **Commit incrementally.** Several agents were killed mid-task by account limits today. The ones
   that committed as they went lost nothing.
2. **Verification must be driven, not posed**, and per DW-20 a probe must prove it advanced the
   simulation before its numbers are trusted.
3. **Measure before believing a diagnosis.** Three separate "known" defects this session turned out
   to be misdiagnosed, including one where a proxy sphere was hiding half a missing planet.
