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
3. `docs/web/WASM-BRIDGE.md` (the `/core` C API, ABI 5, memory and ownership conventions).
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
| **W7 polish: tunnel persistence, item icons, belt curves, ambience, objectives** | **done and driven-verified 2026-07-26** |
| W7b progression: research wired to play, build costs, power | **base building done and driven-verified 2026-07-26; research and power still pending** |
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

**~~Known, and not gameplay's to fix:~~ FIXED 2026-07-26.** The walk stalled
about 3.8 m short of a node and would not close (`grounded true`,
`blockedByRock false`, slope 11 deg). Those three symptoms were the whole
signature: the walker was resolving against voxel rock that stands proud of the
walkable surface, and being pushed back exactly as far as it had stepped. See
15.2 item 93 and `probes/walkfeel.js`. `impact.js` now closes to **2.15 m**,
which is the node's own radius.

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

## W7 polish: the tunnels persist, the assets get used, the world has a bed and a shape (2026-07-26)

Four gaps closed, all driven-verified. ARCHITECTURE 15.2 items 86 to 90.

**The tunnels survive a reload.** `of_edits_serialize` had existed since W5 and
was never called, because the `VoxelEdits` handle lives in `Services` and the
save lives in `src/game`, so nobody owned the line between them. `game/VoxelSave.ts`
is that line: three structural interfaces, one `ports` record handed in by Boot,
and `src/game` still imports nothing from `src/world`. /core's removed-cell bytes
are the STATE; the strike log rides beside them as the HISTORY, because the near
mesher and `TerrainStream.digAt` consume strikes and not cells. Slot version 2.

Driven acceptance (`probes/tunnelpersist.js`, `valid: true`): 146 cells over 18
strikes, and 8 sample points inside the passage read AIR. The rock is then put
back through /core's own `deserialize` (an LEB128 zero) and the same 8 points
read ROCK with the near mesh down **1016 to 745 faces**; the slot is loaded and
they read AIR again with 146 cells and 1043 faces. Then **9.37 m walked with the
dig key released**, 8/8 grounded, 0 blocked. 1,316 voxel bytes, 12.9 ms to
re-mesh 18 restored strikes. The middle step is what makes the last one mean
anything: a save that "worked" because the live world still held the answer is
the classic false pass.

**Three shipped assets that the code ignored.** `items_atlas.glb`'s fourteen item
meshes are now baked once at boot into 64 px data URLs, so the pack shows objects
instead of rows of text; tools and buildables borrow the LOD0 of the thing they
place. 21 icons, **33.6 kB of PNG**, 220 ms of bake that overlaps the other boot
loads, and the temporary WebGL context is disposed before the game's own does any
work. `src/ui` still imports zero three.js, because an icon is a string.
`belt_curve_l/r.glb` are DERIVED, never placed: a run is ordered, so a tile turns
exactly when the heading it inherits is not the heading it sends on, and the hand
is the sign of `(up x in) . out`. The band scrolls along the ARC on a curve, with
which corner it is riding in the vertex role, so there is still ONE material and
ONE batch. `Cave_OreVeinPanel` is NOT wired: it needs per-face placement in the
voxel mesher, which is the rendering domain's file.

Driven: `probes/icons.js` (`iconsAreReal`) asserts BYTES and not a count, because
a canvas that rendered nothing still yields a valid PNG (smallest 954, largest
2,914, floor 900). `probes/beltcurve.js` (`cornersAreCurved`) lays two legs
through the build ghost and the R key and gets turns `"lr"`; both hands are
tested because a sign error would draw them as each other.

**The planet is not silent between actions.** Three continuous beds, synthesised
like everything else and shipping no audio bytes: wind that opens with altitude
and shuts under rock, a low room tone plus a narrow high band underground, and a
cicada chorus in the Forest (insects and not birds: a bird call is a melody).
Levels are 0.055 to 0.085 of master. Where the level comes from is
`game/Ambience.ts` and nowhere else, from the body radius, the walker's own
`underRock` and `of_biome_at`; the audio layer holds no opinion about terrain. A
one-second ease makes stepping under a lip a fade. **M still mutes**, and a muted
game still builds no graph.

Driven (`probes/ambience.js`, `bedsMakeSound` and `levelsFollowTheWorld`): the
beds rendered offline measure RMS **0.0515 to 0.0909**, none silent, and on a
driven walk the levels CROSS OVER: surface wind 0.636 / cave 0 / life 1, under
rock wind 0 / cave 0.999 / life 0.001, back out wind 0.631 / cave 0.007. A build
that played all three at a constant level passes the first check and fails the
second. Live cost measured at **32 plays for 4.1 ms** with two beds running.

**The first minute has a shape.** Seven objectives top right: harvest a tree,
craft a pickaxe, mine iron, smelt it, place a miner, run a belt to a smelter,
walk away and take what it made. It is not a tutorial system structurally: one
integer and seven predicates asked of the live world four times a second, no
gating and nothing to skip, so a player who ignores it finds it ticked off
behind them. **H** hides it and the choice survives a reload; the list removes
itself when the last objective is met.

Driven (`probes/objectives.js`, `advancesOnlyOnTheWorld` and `hidesWithH`): four
seconds of doing nothing leaves it at 0, a harvested tree takes it to 1, and
crafting the pickaxe takes it to **3 in one go** because the ore was already in
the pack. A list that counted up on a timer would look identical in a screenshot.

**Budget: draw calls 39 on the surface, 43 with a six-tile line including two
curves, 19 underground, against 150.** 22/22 ctest, self-determinism 119/119,
cross-toolchain 94/94, `npm run check` green. No wasm rebuild: every export this
needed was already there.

Screenshots: `docs/screenshots/W7_tunnel_persisted.png`, `W7_icons.png`,
`W7_belt_curve.png`, `W7_objectives.png`, `W7_ambience.png`.

## An ore deposit is now a patch of ground (2026-07-26)

**You put a mining drill ON a deposit.** A deposit used to be a boulder on the
grass that a miner bound to if it was within 3.2 m. It is now a PATCH
(`deposits.h` section P, DW-25): an irregular lobed area 6 to 11 m across
holding ONE pool of one ore, deterministic from the seed, richest in the middle
and thinning to nothing at the rim. The ground itself is tinted the resource's
colour, so copper reads orange, iron grey-blue, coal black and stone pale from
tens of metres away, and pieces of the ore body break the surface as outcrops.

**The same coverage number is the tint and the rate**, so where on a patch a
drill goes is a real decision and the ghost answers it before the key is
pressed: "2.1 ore/s here", or, off the ore, **"you cannot place a drill here,
there is no ore"**. Several drills on one patch is allowed; it is a piece of
ground, not a socket.

**Hand mining still bootstraps.** An outcrop is an ordinary `/core` harvest node
LINKED to its patch, so the aim, the swing and `of_gp_node_harvest` are the ones
a tree already takes. Bare hands always pay (3 raw ore a swing, 9 with the
pickaxe), which is what makes the iron a drill costs reachable from an empty
pack. The outcrop is a VIEW: its remaining amount is re-derived from the patch
on every read, so a deposit has one number however many outcrops stand on it.

Driven acceptance (`probes/deposit.js`, `valid: true`): a patch measured
**8.14 m radius, 11.99 m of span across its own outcrops, 1,531 units at grade
0.459**; one bare-handed swing granted **3 raw iron and the patch fell by
exactly 3**; a drill left alone for 18 s took **17 units, the patch lost 17, the
drain moved 17 and 17 arrived in the buffer**; a ghost on ground measured
**14.26 m clear of every patch** was refused by name and the place key built
**nothing** (0 buildings before, 0 after); and the depletion came back across a
save with the world **regrown from the seed to 1,531 in between** and restored
to 1,516. `/core` ticked 1,081 against an expected 1,080 (DW-20).

**Draw calls: the whole ore field costs 1.** 40 on the surface against 39 before
it, 44 to 47 with a drill and its patch filling the frame, against a budget of
150. One merged geometry, one material, colours in a vertex attribute.

22/22 ctest (4 new patch suites in `deposits_tests`, 1 in `survival_slice_tests`),
self-determinism 119/119, cross-toolchain 94/94, ABI 3 (the `of_gp_patch_*`
surface).

Screenshots: `docs/screenshots/W7_ore_patch.png` (a drill standing on an iron
patch), `W7_ore_patches_wide.png` (a copper patch reading orange at 26 m).

## Base building: foundations, floors, walls and doors (2026-07-26)

**Press 4, 5, 6 or 7 and put a base down.** A ghost snaps to a metric build
grid, **R** flips a wall, **B** takes the snap off for free placement, **G**
puts it down, **E** opens a door and **X** takes a part back with a full
refund. The cost is spent out of the pack and it is /core's: `gameplay.h`
section S.6 authors the four parts, their ItemIds (0x0040 to 0x0043), their
TypeIds (0x40 to 0x43) and their `CraftRecipe` costs as data, and
`HandCrafter::payInputs` spends them all or nothing. **Foundation 4 Stone, floor
2 Wood + 2 Stone, wall 3 Wood, door 4 Wood + 1 Iron**, so the door is the one
structural part that needs a working furnace.

**A structure is NOT a `BuildKind`.** It never ticks, holds nothing, has no
ports and draws no power, so it has no business in `automation.h`'s entity
arrays; it is its own kind and the factory sim never sees it. Same argument as
GP-19's survival furnace.

**The grid is not the voxel lattice, and that is measured rather than assumed.**
One unit step of a /core cell key covers 0.588 to 1.017 m of ground depending on
the axis, because a 1 m body-frame cube grid is cut obliquely by the ground
sphere. A 1.00 m foundation laid on cell centres would tear a platform open by
0.41 m on one axis. So a structure belongs to a SITE: a local metric tangent
frame anchored on ONE world lattice cell, inside which the spacing is exactly
the module the assets ship. **Measured gap between adjacent foundations:
1.176e-12 m.** Every module constant (1.00 m cell, 0.50 m deck, 2.50 m wall,
3.00 m storey) is read off the shipped sockets at load, so a change in Blender
propagates with no code edit.

**DW-24, and the number it asked for turned out to be about the TOOL.** A
structure rests on the terrain and never deforms it; ground too uneven under the
footprint makes the ghost read INVALID and name the levelling key. Measuring the
terrain gives a comfortable tolerance: the worst spread over a 1 m footprint is
0.127 m across four sites. Measuring what Q can actually deliver does not: it
edits whole 1 m voxel cells, so it has a dead band of half a cell in which it
changes nothing, and one press left **0 of 12** refused cells buildable at a
0.22 m tolerance (residual over a levelled disc p05 -0.536, p50 +0.027, p95
+0.588 m). The tolerance is therefore **asymmetric**: FLOAT 0.55 m, half a voxel
plus a tenth, because a gap of daylight under a slab is the visible failure;
BURY the deck thickness itself, because ground rising into a slab is invisible.
A site's plane is founded on the LOWEST ground under its first cell, so a base
leans towards the invisible failure. **This should come down the day the
levelling tool can fill less than a whole cell.** ARCHITECTURE 15.2 item 104.

**The walker learns about the base through a PORT.** `KinematicBody.solids` is
an interface implemented in `game/StructureBody.ts` and resolved AFTER the
terrain and BEFORE the ground snap, because a deck is a floor above the ground.
Rock stays the oracle's answer and a foundation never becomes a sixth definition
of the surface (DW-26). **The door's three collision boxes stay three**: hulling
them would seal the doorway, so the acceptance walks through it.

Driven acceptance (`probes/build.js`, `valid: true`, 1,459 ticks): two adjacent
foundations meet with a gap of **1.176e-12 m**; a free-placed part lands
**4.07e-9 m** from where it was aimed; a wall sits **0.000e+0 m** from the
foundation's own published edge socket; a door **opens and the player walks
through it** and is stopped by it when shut (doorway solid `[t,t,t]` shut,
`[f,f,f]` open); the ghost refuses uneven ground by name and **8 of 13** aimed
cells accept after one press of Q; a foundation spends exactly **4 Stone** and a
second door is refused with **"need 4 Wood + 1 Iron"**; and **5 parts survive a
save with the live world emptied to 0 in between, worst move 0.000e+0 m**. Slot
version 4 carries the parts and their site frames.

**Draw calls: the whole base costs 1.** 41 on the surface against the 40 this
work started from, and 51 with a base and a levelled pad filling the frame,
against a budget of 150. One `BatchedMesh` for every part
(DW-11), 512 instances, and a door is two of them because the leaf is animated
by writing its matrix rather than by an `AnimationMixer` (DW-8 still holds: no
mixer exists anywhere).

Screenshots: `docs/screenshots/W8_base.png`, `W8_door.png`.
Probes: `build.js`, `buildtol.js` (the measurement), `buildshot.js`.

## Terraformed ground stopped looking, and behaving, like broken geometry (2026-07-26)

**The field of black spikes was the near voxel mesh.** It was not fill geometry,
not winding, not the headlamp and not the material, and it was not specific to
terraforming at all: a dig produced it too, over a couple of metres instead of
twenty-five. `exposedFaces` answers "every solid-to-air face in this box", so a
6 m levelling op, whose dirty region is a 13 x 25 x 13 m cylinder, had the mesh
draw /core's 1 m solidity shell over about 25 m of ordinary ground. That shell
disagrees with the smooth `surfaceRadius` the terrain chunk draws by up to half
a cell diagonal by construction (DW-26), and what pokes through the ground is
the corner of a cube. At two metres from the eye a 1 m face fills a fifth of the
screen.

`world/VoxelSkin.ts` keeps a face only where the heightfield cannot express it:
the solid cell stands above the derived surface, or the air cell sits clearly
below it. **924 exposed, 904 dropped, 20 drawn.** Filtering to "faces of an
EDIT" was tried first, removed 78% and left the pad looking identical, because
`levelArea` flips only the cells on the wrong side of its target so its edits
are a scatter of isolated cubes. ARCHITECTURE 15.2 items 108 to 110.

**Cut rock takes the terrain's colour and keeps the headlamp's light.**
Per-vertex albedo now comes from `BiomePalette.terrainAlbedo`, the terrain
shader's own palette entry, slope-to-rock smoothstep, snow band and relief
scaling. Using the terrain's actual `ShaderMaterial` was tried, matched
perfectly in daylight, and silently disabled the headlamp, because that program
computes its light from `uSunDir` and never reads three's light list.

**The aim ray stopped short of the ground.** `VoxelWorld.raycast` marched
`solidAt`: over 40 driven aims, **17 stopped early, worst 3.8 m**, on invisible
rock up to 0.52 m above the surface. `SurfaceOracle.solidForAim` is `solidAt`
with its one quantised term swapped for the smooth surface and both edit sets
untouched. Worst driven strike error **0.20 m against a 0.25 m march step**.

**Numbers.** Levelled pad against untouched terrain, same seed, same site,
matched range (8.7 / 8.8 m) and matched local slope (0.573 / 0.428 m), 240 px
samples: **96.5/96.6/85.8 vs 143.7/145.5/134.7, worst channel 33.6% off,
becomes 132.7/135.8/124.9 vs the same ground, 7.6%**, tolerance 12%. Lamp lift
3.46x -> 11.5x. Draw calls with a base and a levelled pad in frame **49 -> 45**
of 150, p99 unchanged. `tunnelwalk` 8/8 grounded, 8/8 rock overhead, 8/8 column
closed; `tunnellit`, `dig` and `level` all green.

**Three isolation flags shipped** (standing rule 7): `?voxelskin=0` restores the
W5 mesh exactly (whole shell, flat brown Lambert), `?voxelnear=0` removes it
from the scene, `?aimshell=1` marches the raw shell. The first attributed the
defect, the second proved which layer drew it, the third proved two unrelated
red probes were not caused by this work.

Screenshots: `docs/screenshots/RN_base_before.png` and `RN_base_after.png` (the
same probe, seed, site and camera), `RN_pad_before.png`, `RN_pad_after.png`,
`RN_pad_after_novoxel.png`, `RN_dig_voxel.png`, `RN_dig_novoxel.png`.
Probes: `voxelskin.js`, `padshot.js`, `beltfloat.js`.

## Digging into an ore body pays (2026-07-26)

A pickaxe swing at an outcrop granted ore and a dig strike into the identical
ground granted nothing. `game/DigOre.ts` is the line between them, handed to
`DigAction` as a port so `src/player` still knows nothing about deposits:
`of_gp_patch_find` on the strike centre, `of_gp_patch_drain` for the amount, and
the grant is exactly the drain, so a deposit still has one number (DW-25).

**The yield is deliberately poor.** From this world's own numbers: a bare-handed
swing at an outcrop is 3 units, a strike into the middle of a patch is 2, a
pickaxe swing is 9 and a drill is 3.0 a second unattended. It does not become a
second, better mining tool; it stops the world lying to a player who has tried
to dig ore out of a hillside they can see the ore in.

Driven (`probes/digore.js`, `valid: true`): 10 strikes on a patch centre, 10
paid, **pack +20 and patch -20 exactly**; 6 strikes **20.14 m clear** of every
patch, pack +0 and patch -0.

## The controls now match the genre, and belts line up (2026-07-26)

The playtest report was five sentences and every one of them named a convention
this game was violating. All five are fixed, plus the belt misalignment reported
alongside them, which turned out to be the same defect base building already
solved.

**The binding table, as a player reads it.**

| | |
|---|---|
| **left click** | use what is in your hand: swing at a node, dig, or place a building. **Hold it to lay a run.** |
| **E** | interact: open a furnace, take a machine's output, open a door. It is no longer harvest. |
| **Escape** | close whatever menu is open. Nothing open, drop the part in hand. Nothing in hand, take the pointer back. |
| **1 to 9** and the **mouse wheel** | choose a hotbar slot: hands, furnace, drill, belt, smelter, foundation, floor, wall, door |
| Tab | pack and hand crafting |
| Q level ground · X demolish · R turn the ghost · B free placement | |
| WASD walk · Space jump · Shift sprint · V first/third person · L headlamp · M mute · H hide the checklist · ` debug HUD | |

**Escape has ONE handler over a DERIVED list.** Every panel joins
`ui/ModalStack.ts` in its own constructor by extending `Modal`, so a menu added
later cannot silently escape the guarantee, and `probes/controls.js` walks the
live list and FAILS on an entry it cannot open. It also deliberately does not
fight the browser: Escape already exits pointer lock, so with nothing open the
handler drops the part in hand and otherwise lets that exit stand (15.2 item 106).

**The hotbar decides what the left button does**, which is the whole point.
A part in hand places; the bare hand swings and digs and places NOTHING; an
empty slot does nothing at all. That negative is the assertion that matters and
it is the one the acceptance leans on.

**Belts line up now, and the cause was measured.** The build grid was /core's
1 m voxel lattice, and the ground sphere cuts through it obliquely: one unit
step of a cell key covers **0.5903, 0.8110 or 1.0167 m** of ground depending on
the body axis (`__of.latticeCell`, shipped world, at the spawn). A belt tile is
a 1.00 m mesh, so two tiles laid side by side overlapped by up to **0.41 m**.
That is exactly the defect base building hit and solved with a SITE, a local
metric tangent frame anchored on one world lattice cell (15.2 item 103), so
machines now snap to that same grid rather than to a second answer of their own.
A base and a belt run finally agree about where a metre starts. **Measured over
a 15-tile dragged run: worst tangential deviation from the module 4.006e-6 m**,
and the residual is geometry rather than slop, because a radial projection
scales tangential spacing by the local ground radius and that run descends
0.19 m a tile.

**Hold left click to lay a run.** Every tile is turned to point at its
successor, cells the crosshair skipped are filled in so a fast sweep still gives
a continuous line, a reversal ends the drag rather than turning the tail around,
and the whole tick is ONE commit because a commit rebuilds the network and would
otherwise eat the ore riding the belts. Pressing on a tile that is already there
starts a drag FROM it, so the end of a run can be grabbed and extended.

Driven acceptance `probes/controls.js`, `valid: true`, 616 ticks: the wheel
moved the slot 4 -> 7 -> 4; a click with the bare hand dug 7 cells and placed
nothing (15 -> 15 buildings); a drill off the ore was refused by name and built
nothing; E opened the furnace and granted **nothing** (27 -> 27 harvest grants),
asserted in a world where a left click demonstrably does grant; one press held
while walking laid **15 belts that /core reports as ONE transport line**; and
Escape closed 3 of 3 modals from the derived list.

Every consumer now asks for an ACTION and never for a key
(`player/Bindings.ts`), so the next remap costs one file rather than twenty
probes. Save slot version 5.

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
- **Walking across ordinary ground is smooth, and the ground now has walls
  (2026-07-26).** The playtest complaint was "you are always getting stuck
  unless you jump". Cause: `solidAt` is quantised to the 1 m cell (a cell is
  solid when its CENTRE is under the designed surface) while the walkable
  ground is the smooth `surfaceRadius`, so the solid shell is a staircase
  standing up to 0.87 m PROUD of the ground being walked on. The capsule's
  lowest sample was inside it on **60.6% of ticks**, and `resolveEmbedded`'s
  minimum translation out of a just-entered cell is back through the face just
  crossed, i.e. exactly the 7.7 cm walked. Driven (`probes/walkfeel.js`, four
  bearings, jump never pressed): **metres travelled per commanded metre 0.442 ->
  1.000, stalled ticks 527/917 -> 1/902, embedded pushes 688 -> 0**. The walker
  now needs BOTH oracle answers to agree before treating a point as rock.
  Two guards came with it, both of which had been broken since the walker was
  written: the heightfield had **no wall at all** (`gap <= 0` meant "landing",
  so one tick into a cliff snapped the capsule to the top of it, and the slope
  limit is a no-op because it projects onto the radial up), and `floorBelow`
  returned a radius ABOVE its query when the query point was solid, ratcheting
  an embedded capsule up a vertical face at 6 m/s. Negative control (dig a
  shaft, walk into its wall from the bottom): **climbed 12.00 m -> 0.23 m**,
  zero rise over the last quarter of the leg. 15.2 items 93 and 94.
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
- **DW-17 is DONE for the pack, the buildings, the node depletion AND the voxel edits**
  (IndexedDB, autosave every 20 s and on `pagehide`, slot version 2, `probes/persist.js` and
  `probes/tunnelpersist.js` green). Research is not persisted (it is not wired to play yet), and
  a furnace's burning fuel is not: it is a tick countdown with no item to give back, and it is
  counted in the restore ledger rather than hidden.

## Process rules that have earned their place

1. **Commit incrementally.** Several agents were killed mid-task by account limits today. The ones
   that committed as they went lost nothing.
2. **Verification must be driven, not posed**, and per DW-20 a probe must prove it advanced the
   simulation before its numbers are trusted.
3. **Measure before believing a diagnosis.** Three separate "known" defects this session turned out
   to be misdiagnosed, including one where a proxy sphere was hiding half a missing planet.
