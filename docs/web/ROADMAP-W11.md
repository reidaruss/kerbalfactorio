# W11 roadmap: the overnight list, 2026-07-27

Reid's brief, given 2026-07-27 before an overnight run, with instructions to work
through the night, not to stall on any one item, and to note blockers and move on.
This file is the tracking artifact for that list. **Lanes update their own row.**

Flight (W8) is tracked separately and is out of scope here except for item G.

## The list as given, verbatim where it matters

> * placing a foundation still kind of sucks, and once one is placed, walls or other foundations dont snap to the one that was placed.
> * Items like smelters dont sit ontop of the foundation
> * Q still makes the ground more rough not flat.
> * For now make the starting area flat or close to it for simplicity
> * Better terrain generation
> * Better graphics: player model, player animation, belts showing material, grass, trees, ore deposits, mountains look like shit
> * The way the ground breaks when you dig is kinda fucky ... I was thinking more like a proper grid with proper units, like minecraft (but not as blocky, some smoothing) or even 7 days to die
> * Placing turns in belts is fucky ... make it like factorio where i can change the direction after i place it ... better snapping in general
> * progression system, research, maybe a tech tree
> * Player skills, player customization (appearance), armor and armor slots for head chest legs feet
> * Enemies ... factorio like ... they come to you based on pollution spreading ... evolution system ... base defense
> * electricity: generation, distribution, management ... primitive furnace, smelter (uses coal), electric smelter

## Admin calls made up front

**Procedural generation stays seeded and deterministic.** Reid left this to me
("dont worry too much about the procedural generation aspect ... focus on 1 seed
... your call"). Determinism is standing rule 4 and is gated at 119/119 self and
106/106 cross-toolchain; those gates are load-bearing and have caught real bugs.
So: **keep the seeded architecture, tune for the default seed `0x0bf00d01`, and do
not chase generality.** Tuning constants for one seed is cheap and reversible.
Removing determinism is neither.

**The voxel representation changes, and this is the big one.** "Sharp edges, not
clean, more like minecraft with some smoothing" is not a shader problem. The
current model is binary occupancy on a 1 m lattice meshed as cubes, and it is the
root of THREE separate complaints on this list: ugly digging, Q not flattening
(whole-cell edits leave plus or minus half a metre, WG-23), and the DW-33
buildability failure. A signed-distance or partial-occupancy field meshed with
surface nets fixes all three at once. **DW-26's bound between the two shapes of
"solid" must survive the change**, because mesh-versus-collision disagreement is
the failure this project has paid for six times. See lane B.

## Lanes

| # | Lane | Scope | Owns | Status |
|---|---|---|---|---|
| A | Art: characters and world dressing | player model, player animation, grass, trees, ore deposit meshes, belt cargo meshes, armour slots as art | `tools/blender/`, `assets/` | **DONE. 48/48 validate, byte-identical rebuild, dist 2.69 -> 3.10 MB. Client wiring needed, see blockers A-1 to A-13** |
| B | Terrain and digging | smooth voxel field, dig quality, Q flattening, flat-ish spawn, mountain shape, generation quality for the default seed | `core/` worldgen + voxels, `web/src/world/` | launched |
| C | Base building and placement | DW-33 founding plane, cantilever from a neighbour, foundation and wall snapping, machines sitting on decks, re-price at 4 m | `web/src/game/Structure*.ts`, `MachinePlacement.ts` | **all five landed** (GP-36 to GP-40) |
| D | Electricity and smelting tiers | generation, poles and distribution, a supply/demand panel, furnace to coal smelter to electric smelter | `core/include/of/power.h` (new), `factory_sim.h` | **model DONE in `/core`; panel + bridge handed off** |
| E | Enemies | pollution spread, evolution, nest spreading, attack waves, base defense | `core/include/of/enemies.h` (new) | **model DONE in `/core`, then reviewed and hardened** (525 checks green, 1,200 machines cost 8.04 us/sim-tick, 10 defects found by an adversarial pass over an already-green suite); production hook + combat handoff published, see Blockers |
| F | Belts | direction change after placement, belt-to-belt and belt-to-machine snapping, cargo visible on belts, taking items off a belt | `web/src/game/Factory*.ts`, `MachineBatch.ts` | **all four landed** (FS-26 to FS-29) |
| G | Flight end-to-end validation | drive the whole demo repeatedly and adversarially until it is smooth | new probes | **DONE. 9 defects found and fixed (PH-28 to PH-36), 10/10 cold ascents bit-identical, a reload mid-orbit no longer loses the world silently.** See the progress log and Blockers |
| H | Research and tech tree | wire `research.h` into play, a tech tree UI, gate machines and recipes | `core/research.h`, `web/src/ui/` | queued, blocked on flight (owns `ui/`) |
| I | Player skills, appearance, armour | slots for head/chest/legs/feet, customization | `core/gameplay.h`, `web/src/game/` | **headless layer landed** (GP-41 to GP-43, `core/include/of/progression.h`); client wiring handed to Admin |

## Standing rules for every lane tonight

1. **Do not stall.** If blocked, write the blocker into this file's Blockers
   section, work around it, or move to the next item in your own scope.
2. Every claim carries a number. A probe must prove its own setup worked (DW-20).
3. `git commit -- <paths>`, never a bare `git add -A` (standing rule 10).
4. An ABI bump is atomic and its commit boots (standing rule 9). ABI is at 6.
5. No em dashes. No destructive commands outside the project directory.
6. No DW numbers; use your domain prefix and escalate anything Admin-level.

## Blockers

_Lanes append here. Include what you tried and what would unblock it._

### Lane G, 2026-07-27: TWO COMMIT SUBJECTS ARE SWAPPED, and this is the record

**No content is lost or wrong in either commit. Two subject lines point at each
other's work and cannot be corrected, so they are corrected here instead.**

- `fa7a5fd` is titled *"WG-28: the mesher was inside out"*. **It is lane G's
  flight commit** (20 files: `FlightSession`, `FlightMode`, `VesselObserver`,
  `VesselView`, `Navball`, `SaveInhibit`, `FlightWarp`, three probes,
  `reload.mjs`, `physics.md`, four screenshots).
- `f89ab0b` is titled *"W11 lane G: fly the demo adversarially..."*. **It is
  world-gen's `rule 11` commit** (the inside-out mesher and the stale-copy
  negative control).

**How, because the mechanism is a trap anyone here can fall into.** `git commit
-F <file>` with a path that does not exist does **not** fail. Git falls through
to `.git/COMMIT_EDITMSG`, which is SHARED, and which at that moment held the
message of whichever lane committed most recently. So the commit landed with
another lane's subject line, silently. The obvious repair, `--amend`, then made
it worse: between the commit and the amend a third lane had committed, so the
amend rewrote **their** tip instead, swapping the second pair. Both attempts to
unpick it (`update-ref` and a second `--amend`) were refused by the permission
system, which was the right answer: rewriting shared history at 4 a.m. with five
lanes committing into the same tree is how content actually gets lost, and
nothing had been lost yet.

**Two rules fall out of it, and they are cheaper than the incident.**
1. **Pass the message with `-m`, never `-F`**, unless you have just checked the
   file exists in the same command. A missing `-F` target is a silent fallback
   to another lane's words.
2. **`--amend` is unsafe in this repo, full stop.** The tip is not yours by the
   time you type it. Re-read `git log -1` first if you must, and prefer a new
   commit that says what went wrong, which is this section.

This is the fourth instance tonight of the shared-git-state hazard already
logged under standing rule 10, and the first where the casualty was the
history's ability to explain itself rather than a file.

### Lane G, 2026-07-27: THE CLIENT DOES NOT BOOT ON THE CURRENT WORKING TREE

**This is the one thing that stops there being a demo at all, and it is not
lane G's.** As of 01:27, `web/src/game/FactoryView.ts:24` is
`import { BeltCargo } from "./BeltCargo.js";` and **`web/src/game/BeltCargo.ts`
does not exist**. Vite answers 500 on `FactoryView.ts`, which fails
`Gameplay.ts`, which fails the whole boot: `[of] boot failed TypeError: Failed
to fetch dynamically imported module`. Nothing renders, no probe can run, and
`npm --prefix web run check` does not catch it because `tsc` and the 400-line
check both pass on a file whose import target is missing at RUNTIME only when
the module graph is walked.

That is lane F mid-write and it will presumably resolve itself within the hour.
Recorded because (a) it stopped lane G's measurement dead for the duration and
everything below it is timestamped around the gap, and (b) **if it is still
true when Reid sits down, the demo is a white screen.** Whoever lands lane F
should boot the client once before walking away. `git stash` is not a fix here
because five lanes share the tree.

The general form is worth more than the incident and it is the third time
tonight a lane has been stopped by another lane's half-saved file (lane B's
`CMakeLists`, lane D's `gameplay.h`, now this): **the check suite has no gate
that says "the app starts".** One driven boot with no probe attached would have
caught all three in seconds. Lane G's `tools/smoke/reload.mjs` does exactly that
as its first step and could be lifted into the standard check for nothing.

### Lane F, 2026-07-27: belts

- **Standing rule 10 took this lane's bridge export, and it is the fourth time
  in two days.** `web/wasm/of_core_api.cpp` (the new `of_net_take_line_item`
  entry point) and the rebuilt `web/wasm/dist/of-core.{mjs,wasm}` were swept into
  the world-gen lane's commit `fa7a5fd` / `47210f7` ("WG-28: the mesher was
  inside out"). Nothing is lost and nothing is broken: the content is correct and
  on main, and the wasm on main is the one every lane needs, since it carries the
  flight lane's ABI 8 additions and this lane's together. What is destroyed is
  again the history's ability to explain itself. **The lane's own commit was
  built through a temporary index** (`GIT_INDEX_FILE` + `commit-tree` +
  compare-and-swap `update-ref`), which is why nothing of anyone else's went out
  under an FS message; that technique is cheap and it is the only one that has
  actually held all night. Worth promoting from "an option" to the default.
- **I joined the flight lane's uncommitted ABI 8 rather than bumping to 9, and
  that was a judgement call worth recording.** When this lane needed a new bridge
  export, `of_abi_version` in the working tree already read 8 from the flight
  lane's in-flight vessel/staging/atmosphere additions, while HEAD was at 7.
  Bumping to 9 would have broken their in-flight client; adding to 8 means one
  rebuild carries both, which is exactly what lane D advised ("whoever next bumps
  the ABI should take this with them rather than bumping twice"). The wasm was
  rebuilt with `-SkipNative` deliberately, so the committed parity fixture was
  NOT regenerated against another lane's in-flight terrain headers.
- **Three pre-existing defects in `TransportLine`'s gap accounting, found while
  adding `takeAt`, NOT fixed, and escalated because fixing any of them changes
  belt throughput everywhere.** All three were found by an independent
  hand-derivation of the invariant the header states unconditionally at
  `factory_sim.h:127`, and the new `takeAt` preserves that invariant exactly in
  all four of its cases, which is what made them visible by contrast.
  1. **`popHead` mints one item-spacing of tail room per pop.** It rolls the
     freed span into `headGap` (correct: the new lead item must still travel it)
     AND does `tailGap += kItemSpacing` (not correct: nothing at the tail moved).
     The invariant sum reads `capacityUnits + 64` after one pop. The observable
     is that a long-running line can accept more items than its own capacity,
     which now has a visible symptom for the first time because FS-28 draws them.
  2. **`advance()` spends `headGap` without crediting anything**, so the sum
     DROPS by `speedUnitsPerTick` per flowing tick. This partly cancels (1),
     which is presumably why neither has ever been noticed.
  3. **`tryPushTail` zeroes `tailGap` on the FIRST item regardless of capacity**
     (`headGap = C - S; tailGap = 0`), so a freshly placed line accepts exactly
     ONE item until something is removed. This is very likely why the shipped
     auto-line holds `beltPeakItems` at 1 no matter how fast the drill runs.
  **(3) is the one to look at first**, because it is the difference between a
  belt that looks like a belt and a belt that carries one lonely ore. It is not
  a two-line fix: `tailGap` has to become a derived quantity, or `advance` has to
  credit the tail, and either changes every throughput number in
  `factory_sim_tests`, `factory_rails_tests` and the parity fixture. That is a
  deliberate, measured change with its own gate run, not a 3am edit in a lane
  about placement and rendering.
- **`Factory.pick`'s ranking changed and other lanes should know.** It was
  nearest-along-ray and is now smallest miss-over-radius, because a smelter's
  1.6 m sphere made every belt beside it unaimable (an aim 0.005 m off a belt
  centre resolved to the smelter on all seven presses from four standing
  positions). `probes/demolish.js` and `probes/shortline.js` were re-run green
  after the change, but anything that aims at a factory building by ray is now
  ranked differently.
- **Not a blocker, an ask for the art lane: the belt cargo convention shipped
  before this lane needed it and every socket was exactly where ASSET-SPECS said
  it was.** `socket_item_a` / `socket_item` / `socket_item_b` on the straight and
  both curves, `socket_rest` on all fifteen `Item_*` nodes, and `Item_Crate` as
  the fallback for anything the atlas does not carry. One runtime detail worth
  writing into the spec: **GLTFLoader names a node's mesh after the node only
  when that node has ONE primitive**; a two-material item becomes a Group whose
  children are `Item_X_0` and `Item_X_1`. An exact-name match therefore loaded
  fifteen meshes, registered ONE, and drew nothing while reporting `meshes: 15`.
  The machine templates have always used a `_\d+` suffix tolerance for the same
  reason and the cargo loader now does too.

### Lane C, 2026-07-27

- **Standing rule 10 was broken again, and this time it took MY work.** The
  `gameplay.h` re-price (GP-40) and its `test_survival_slice.cpp` pins were swept
  into lane D's commit `eceadf6` ("FS-20 to FS-25: electricity"). Nothing is lost
  and nothing is broken: the content is correct and on main. What is destroyed is
  the history's ability to explain itself, which is the third time in two days.
  The rule is being followed by the lanes that read it and broken by the shared
  index, so it may be worth a stronger mechanism than a convention: the cost of
  `git commit -- <paths>` is one clause, and the cost of forgetting it is a commit
  message that describes someone else's work.
- **`surface_field_tests` is red on HEAD and is lane B's in-flight field change,
  not mine.** ctest read 24/24 when I started, 20/24 mid-run while lane B and lane
  D were both mid-edit, and 23/24 once lane D's commit landed. All three of the
  structural suites I own (`structure_defs_*`, `structure_items_*`,
  `structure_pay_inputs_*`) are green throughout.
- **The ABI moved under me mid-run.** I rebuilt the wasm at ABI 6 and synced it,
  lane D then landed ABI 7 in shim and client, and every probe died with "wasm
  reports 6, client expects 7" until I rebuilt. That is standing rule 9 working
  exactly as designed and it cost ten minutes; recorded only because the failure
  mode reads like a bridge bug and is not one.
- **`probes/controls.js` fails one assertion, "one press, one tile: 2 in the first
  three ticks", and it is NOT reachable from anything I changed.** With no
  structures in the world `Structures.deckTopAt` returns null on the first map
  lookup and `MachinePlacement.anchorIn` runs the byte-identical ground path it
  always did, and `controls.js` places no structures. The belt drag is lane F's,
  which is queued behind this lane; flagged so it is not diagnosed twice.
- **Every tolerance in this lane wants re-measuring, and this is not a complaint.**
  The terrain moved twice while I worked. When I started, the spawn refused every
  cell (bury 1.0123 m p50) and 19.8% of 81 origins were buildable; two lane-B
  landings later the spawn is exactly flat (spread 0.0000) and the planet-wide
  figure reads 14.8% under the old rule. The GP-36 comparison is therefore
  reported as pinned-vs-fit measured in ONE probe run over ONE terrain (14.8% ->
  58.0%), never as a before-and-after across the two. **`FLOAT_TOLERANCE_M` = 0.90
  is still a number about the LEVELLING TOOL's half-cell dead band, and if the
  smooth field lets Q fill less than a whole cell it should come down.** Re-run
  `probes/buildtol.js` once the field settles.

### Lane B, 2026-07-27

- **PRE-EXISTING and not mine: `web/wasm/test/expected.json` pins `"abi": 5` while
  the shim returns 6.** The cross-toolchain gate therefore reads **105/106** on HEAD
  as I found it, and `parity.mjs` counts that line as GATING. The vessel lane's ABI 6
  bump rebuilt the wasm with `-SkipNative`, which does not regenerate the native
  fixture. Self-determinism is a clean 119/119. Whoever runs `web\wasmuild.ps1`
  WITHOUT `-SkipNative` clears it; lane B will, since it is bumping the ABI anyway.
  Recorded so nobody diagnoses it as a fresh divergence.
- **Lane D correctly attributes `terrain_stream_tests/procgen_optimized_is_bit_identical`
  to lane B, and it is expected rather than a defect.** That test pins WG-16's
  optimised `valueNoise` against a verbatim copy of the pre-optimisation chain, so
  changing the noise stack invalidates the COPY, not the optimisation. Lane B
  re-baselines the copy as part of the terrain-design change. Nothing else in the
  determinism family is affected: the seam bit-identity proofs are base-agnostic,
  because they assert that two quads sharing a vertex sample the same dir.
- **Transient, twenty minutes, worked around rather than waited on:**
  `core/CMakeLists.txt` would not configure (`No SOURCES given to target:
  smelting_tiers_tests`) and `gameplay.h` did not compile, both lane D mid-edit.
  Compiled the new suite directly with g++ instead. The pattern is worth more than
  the incident: **a shared CMakeLists and a shared header make one lane's
  half-finished edit another lane's broken build**, and it cost little tonight only
  because a header-only core compiles one translation unit at a time.

### Lane A, 2026-07-27: art that is shipped and validated but that the client never draws

Not blockers for lane A's own work, which proceeds, but every one of these is a
**client change without which better art changes nothing on screen.** All are
measured, with file and line, from a read-only recon of `web/src`. Routing these
is Admin's call; lane A does not touch `web/src`.

**A-1. The ground reads as bare, and the dominant cause is the SIZE of a grass
tuft, not the density. Lane A owns most of this fix.** Worked, because I first
wrote a number here that was wrong by a factor of thirty and it is worth showing
the arithmetic rather than the conclusion.

Plains per-prop densities (`web/src/assets/Registry.ts:76-78`) sum to 19,820 per
km2 before `DENSITY_SCALE = 6` (line 67), so 118,920 per km2, which is **0.119
props per m2**. Grass tufts A and B are 16,000 of that 19,820, so **0.096 tufts
per m2, one every 10.4 m2**. The chunk caps (`Scatter.ts` `MAX_PER_CHUNK = 2600`,
`MAX_PER_CELL = 20`) do not bind at that rate on a near chunk. So the tufts ARE
being placed, in the hundreds, across the field in `docs/screenshots/RN_base_after.png`.

They are invisible because **`Plains_GrassTuftA` is 0.44 m tall and most of the
visible ground is 20 to 50 m away, where 0.44 m subtends 2 to 6 pixels.** That is
an art problem and lane A is fixing it tonight: the plains tufts are re-authored
as spreading CLUMPS (`GrassTuftA` 0.44 to 0.95 m, `GrassTuftB` 0.66 to 1.30 m),
so one instance reads as a patch of meadow instead of a shaving brush, and the
pixel area per instance goes up about fivefold at no density cost.

**The client half is real but secondary.** `PropLibrary.ts:33` is
`const CAPACITY = 7000` instances **per material batch**, fixed, with no growth
path. Over the scatter radius of 170 m (`Scatter.ts` `RADIUS_M = 170`, 90,792 m2)
the placement rate above wants **8,707 grass instances against a 7,000 cap**, so
the pool binds by roughly 25% today and will bind harder if density rises.
Exhaustion is **silent in the way that matters**: `PropLibrary.ts:152` counts
`exhausted++` and the instances are simply not drawn. Two cheap fixes, either
works: give the pool a growth path the way `MachineBatch.grow()` already has one,
or note that lane A is moving the grass blades onto the new `OF_Grass` palette
role, which by itself gives grass its own 7,000-slot batch instead of sharing
`OF_Leaf`'s with every other biome's foliage, for one extra draw call against a
budget of 150 that currently sits at 45.

Worth also noting: the comment at `Registry.ts:65-67` claims 6x gives "about one
prop per 4 m2". The measured rate is one per 8.4 m2. The comment is out by 2x.

**A-2. `props/detail_cards.glb` is declared and dead.** `web/src/assets/Registry.ts:18`
is the only occurrence of `detailCards` in the whole client and nothing ever
passes it to `loadGlb`. That file is the ground-detail layer that sits UNDER the
biome props, and it has never been drawn.

**A-3. Two harvest-node kinds exist in the sim and cannot be drawn.**
`NODE_KIND.WaterPool = 5` and `OilSeep = 6` exist at `web/src/game/GameCore.ts:53`
but have no entry in `ART` at `web/src/game/NodeArt.ts:28-37`, so
`nodes/water_pool.glb` and `nodes/oil_seep.glb` are shipped, validated and
unreachable. `nodes/bush_scrub.glb` is likewise never referenced.

**A-4. Harvest nodes have no LOD ladder and no stump.**
`web/src/game/NodeBatch.ts:139` matches `_LOD0` only, and line 42 is
`VARIANTS = ['Full', 'Half', 'Low']`, so every `_LOD1`, `_LOD2` and `_Stump`
node in the nine harvest-node files is dead weight in the shipped bytes. Also
`NodeBatch.ts:67` is `const CAPACITY = 128` with **no growth path**: `acquire()`
returns -1 when full and the node is silently not drawn. That is the same silent
failure shape as the old 256-machine batch wall, which has since been fixed.

**A-5. The walk cycle can essentially never play.** `web/src/player/Controller.ts:33`
is `walkMps = 4.6`, and `web/src/player/AnimGraph.ts:44` is
`RUN_THRESHOLD_MPS = 3.0`, so the player is in `Run` at all times while moving
and `Walk` is only reachable in the 0.15 to 3.0 band that nothing but
deceleration produces. Sprint is `walkMps * 2 = 9.2` (`Controller.ts:78`), which
plays the run clip at timeScale 2.04. Lane A is tuning `Run` as the flagship
clip against `RUN_CLIP_MPS = 4.5`, but somebody should decide whether 4.6 m/s
(16.6 km/h, a near-sprint) is the intended default walking speed.

**A-6. First person has no jump, and there is no axe swing.**
`web/src/player/AnimGraph.ts:22-37` maps FP `jumpStart`, `jumpLoop`, `jumpLand`
and `fall` to `null`, so the view model is dead still while airborne. Lane A is
adding `FP_Jump_Start`, `FP_Jump_Loop`, `FP_Jump_Land` and `FP_Fall` tonight; the
mapping is a client change. Separately `swing` maps unconditionally to
`Swing_Pickaxe` even when chopping a tree, and `PlayerRig.holdTool` is only ever
called with the pickaxe (`web/src/player/Avatar.ts:67,68`), so the shipped
`Swing_Axe`, `FP_Swing_Axe` and `crude_axe.glb` are unreachable.

**A-7. Nothing draws items on belts, and the hook is already there.**
`AutoLine.lineItems(build)` (`web/src/game/AutoLine.ts:180-190`) wraps
`_of_net_get_line_items`, already returns `{ item, offsetTiles }`, and has **zero
callers**. `socket_item` does not appear anywhere in `web/src`. `items_atlas.glb`
is used for exactly one thing: baking 64 px inventory icons at boot
(`web/src/game/ItemIcons.ts`), after which the temporary WebGL context is
destroyed. Lane A is publishing the belt cargo convention and the meshes tonight;
the placement code is lane F's.

**A-8. The draw-call budget of 150 is not a constant.** It exists only as a
literal inside a HUD template string at `web/src/ui/HudLines.ts:84`. The real
enforced numbers are `ALERT = { calls: 300, triangles: 2.7e6, p99: 25 }` and
`FAIL = { calls: 500, ... }` at `web/src/render/debug/StatsProbe.ts:24-25`. Worth
making 150 a named constant if it is meant to be the target.

### Lane A, 2026-07-27, part 2: what the four landed assets now need from other lanes

**A-9. Belt cargo is ready and `offsetTiles` is a trap.** The meshes, the path
sockets and the checker all shipped (ASSET-SPECS 4.13.1 and 7.6).
`AutoLine.lineItems()` (`web/src/game/AutoLine.ts:180-190`) still has zero
callers. When it is wired: **`offsetTiles` is a sim CAPACITY coordinate, not
metres of path.** Split it, `k = floor(offsetTiles)` picks the tile and
`f = frac(offsetTiles)` is the fraction OF that tile, then evaluate that tile's
arc at arc length `f x arcLength(k)`. Multiplying `offsetTiles` by a constant
metres-per-tile makes items **accelerate 27% through every corner**
(1.000 / 0.785398), because a curve is 21.5% shorter than a straight but still
costs one full tile of sim capacity. Also: read the three path sockets per tile
template and precompute the arc once at load, read `socket_rest` from the
**cloned** item node and not from the atlas root, yaw each item so its local +Z
follows the tangent, map the twelve `ItemCategory::Buildable` ids to
`Item_Crate`, and put the items in a `BatchedMesh` with the machines. **Never a
per-item or per-belt `AnimationMixer`** (DW-8); belt motion stays the shader band.

**A-10. Armour needs a slot concept that does not exist anywhere yet.**
`assets/models/dist/player/armour_set.glb` ships and validates, and nothing can
wear one. `grep -riE 'armor|armour|equip' core/include` returns nothing.
`/core` needs `enum class EquipSlot : uint8_t { Head, Chest, Legs, Feet, Count }`
with the four values matching the four node names exactly (so the client's
lookup is an array index, never a string built at runtime),
`ItemCategory::Armour`, `ItemDef` gaining `EquipSlot slot` plus a stat block with
`stackMax = 1`, four new `ItemId`s in the pinned append-only block, an
equipped `std::array<ItemStack, EquipSlot::Count>` with `equip`/`unequip`
returning the displaced stack, and a `setId` so the renderer knows which `.glb`
to load. Persistence: 4 slots x 4 B = **16 B**, so the save schema needs a
version bump. Client: a `Registry.ts` entry, and `PlayerRig.equip(slot, url)` /
`unequip(slot)` doing `mesh.bind(this.skeleton, mesh.bindMatrix)`,
`frustumCulled = false`, and copying the body mesh's layer and shadow flags.
Full convention in ASSET-SPECS 4.25. **`web/scripts/sync-assets.mjs` needs no
change**: it walks the tree and copies every `.glb`, so the new file syncs
automatically.

**A-11. First person has no armour**, because `armour_set` carries the
third-person 44-bone rig and the view model is a different 27-bone rig with a
different bind pose. An armoured player sees unarmoured arms. Either a second
armour file authored against `FP_BONES`, or an explicit decision to accept it.
Art call once gameplay decides whether arms are a slot.

**A-12. Every animation clip in the game has a 16.7 ms dead hold at t = 0, and
this one is MINE to fix but not tonight.** The exporter writes the first key at
Blender frame 1, which is t = 1/60 s, so three.js computes
`duration = n / 60` while the authored motion spans `(n - 1) / 60`. For `Run`
that is 0.4167 s of loop against 0.400 s of motion: a **7.5 cm hitch once per
cycle at 4.5 m/s**, on a gait that was just measured to 0.9 mm of slip. The fix
is to shift keys to frame 0 in `of_lib`. **It is deliberately not being done at
the end of an overnight run**, because it changes the exported bytes of every
rigged asset (a full determinism rebaseline) and, more importantly, **it shifts
every frame index by one, and the impact frames are a published gameplay
contract**: `harvestNode()` fires on frame 17 of `Swing_Pickaxe`, 18 of
`Swing_Axe` and 16 of `Dig`. That is a cross-lane change and it needs an Admin
decision, not a 4am commit. Logged with the number so it is not rediscovered.

**A-13. Sprint plays the run clip at timeScale 2.04.** `Controller.ts:78` is
`walkMps * 2 = 9.2 m/s` against `RUN_CLIP_MPS = 4.5`. It will look frantic. The
fix is a client one: cap the timeScale, or author a sprint clip, or lower the
sprint multiplier. Related to A-5.

**Resolved, worth recording: BT-10's R5 is fixed.** The 150-machine render wall
is gone. `web/src/game/InstancePools.ts:36,44` now carry `CAPACITY = 256` and
`MAX_CAPACITY = 16384`, and `MachineBatch.grow()` doubles on demand
(`web/src/game/MachineBatch.ts:307-324`), counting and logging a refusal at the
ceiling instead of failing silently.

### Lane D, 2026-07-27: the power model is built and has no way to reach the game

Not blockers for lane D's own work, which is complete in `/core`. These are the
three handoffs the model needs before a player can see any of it. Lane D did not
touch `web/**` by instruction (four lanes live in the client) and did not rebuild
the wasm (standing rule 9 makes an ABI bump atomic and it is not lane D's to
bump tonight).

**D-1. The grid has no bridge export, so nothing in the client can call it.**
The C++ surface is finished and stable; the `of_net_*` shim in
`web/wasm/of_core_api.cpp` needs about fourteen new entry points. The exact list
is in `docs/controllers/factory-sim.md` §5 under "what a bridge lane needs".
Nothing else in `/core` has to change for it. Whoever next bumps the ABI should
take this with them rather than bumping twice.

**D-2. The supply-and-demand panel is a client job and `web/src/ui` was owned by
the flight lane tonight.** The model publishes everything the panel needs already
(per-network production, capacity, demand, consumption, satisfaction, generator
and consumer counts, plus a ring-buffer history for a graph). See the same §5
section for the field list. The panel is the thing that turns "my base got
slower" into "120 kW demanded, 90 kW produced, 75%", which is the entire point
of the feature.

**D-3. Wires are published but nothing draws them.** `PowerGrid::wireSegments()`
returns a spanning-tree edge list with both endpoints resolved: exactly N-1
segments per network, never one per pole pair in reach. This was designed against
FS-16's measurement that auto-created inserters already dominate instance count
at scale; a naive per-pair rule is O(N^2) in exactly the layouts players build
(measured: 30 poles a metre apart is 182 in-reach pairs against 29 segments). A
render lane can draw them as a stretched instanced quad per segment.

**Escalation for Admin, not a blocker.** The three new buildables append to
`survival::handRecipes()`, which the client reads dynamically through
`_of_gp_recipe_count`. So on the next wasm rebuild the craft menu gains three
entries (power pole, burner generator, electric smelter) **with no icons
authored**. Either the art lane should be asked for three 64 px icons or the
menu should fall back gracefully. Flagging it now so it is not a surprise
discovered in a screenshot.

### Lane E, 2026-07-27: three handoffs, none of which blocked lane E's own work

The model is done and green in `/core`. Nothing emits pollution, nothing fights,
and nothing places nests in a generated world, because all three of those live in
other lanes' files. Each is published as an interface rather than waited on.
Full detail in [docs/controllers/enemies.md](../controllers/enemies.md) §6 and §8.

- **E-1, factory lane (the one that matters).** `factory_sim.h` is lane D's file
  tonight so it was not touched. The production hook is three calls and one data
  table, published in `enemies.h` §11: on build,
  `addEmitter(dir, pollutionRateForMachine(typeId))`; on idle or removal,
  `setEmitterActive(id, false)` or `removeEmitter(id)`; optionally
  `setEmitterRate(id, rate * dutyCycle)` so a smelter that is not smelting does
  not pollute. Neither header includes the other; the wiring belongs in whatever
  composes them, exactly as `automation.h` composes `factory_sim.h` today.
  **Rates are already authored as data** (Generator 6.0/s deliberately the
  dominant polluter, Smelter 2.0/s, Assembler 1.5/s, Miner 1.0/s, Belt and Box
  and Pole 0.0/s), so this is a wiring task and not a design one. **Until it
  lands, the enemy loop is inert in game** even though it is fully exercised in
  test, because a caller drives emitters directly there.
- **E-2, a combat lane that does not exist yet.** `AttackWave` accumulates in
  `pendingWaves()` with an origin, a target direction, the emitter it is coming
  for, a roster, and totalled health / dps / slowest speed. Movement,
  pathfinding, damage to structures, turrets and weapons are all deliberately out
  of scope and were left undone rather than half-done. The return path exists and
  is tested: `damageNest(id, dmg)` returns true on the killing blow and
  `destroyNest(id)` feeds the evolution kill term, both idempotent against an
  already-dead nest.
- **E-3, world-gen: seeded nest placement.** Nests are placed by the caller, so
  there is currently no deterministic scatter of nests over a generated planet.
  Suggested shape, mirroring `GenerateDeposits`:
  `GenerateNests(body, bodySeed, exclusionRadiusAroundSpawn)`. **The exclusion
  radius is an Admin call, not a world-gen one**, because "how long is the
  peaceful early game" is a pacing decision rather than a terrain one.

**A process finding that cost nothing tonight but nearly cost four files, and is
a sharper version of standing rule 10.** Rule 10 says commit with an explicit
path list because whoever commits first sweeps up another lane's staged files.
There is a second, worse edge on the same problem: **once your commit lands, the
SHARED index is stale, and your brand-new files read as STAGED DELETIONS to
every other lane.** After landing lane E, `git status` showed
`D core/include/of/enemies.h` and `D core/tests/test_enemies.cpp` against an
index that also held 30 staged files from the flight lane. A single bare
`git commit` from that lane would have deleted all four of lane E's new files
under a message about a navball, and every test would have gone with them.
Two things to take from it. (1) The fix is one command,
`git reset -q HEAD -- <your paths>`, immediately after committing; it rewrites
only your index entries and leaves both the working tree and every other lane's
staged set untouched (verified: the flight lane's 25 remaining staged files were
unaffected). (2) **The exposure is proportional to how long another lane leaves
work staged**, which is exactly rule 10's existing corollary, now with a
concrete failure mode attached: a large staged set is not just a sweeping
hazard, it is a loaded deletion. Lane E's own commit was built through a
temporary index (`GIT_INDEX_FILE` + `commit-tree` + a compare-and-swap
`update-ref`) precisely so it could not touch the shared one, which is worth
knowing as an option when the index is busy.

**Not lane E's, recorded so it is not misattributed.** On the working tree as of
lane E's commit, `surface_field_tests` is red (6 checks across 3 tests, all in
`solidCell` / `fillCell` / `derivedRaisingAt`) from lane B's in-flight 372-line
rewrite of `surface_field.h`. Everything else including `enemies_tests` is
green. `enemies.h` includes only `<algorithm> <cmath> <cstdint> <string>
<vector>`, `of/cubed_sphere.h` and `of/vec3.h`, and deliberately depends on
neither the surface oracle nor the voxel layer, so it cannot be involved.

**One thing worth escalating rather than filing.** Every balance number in this
model is first-pass, derived from Factorio's pacing plus arithmetic, and none of
it has been played. The tuning struct exists so that is a cheap fix. The number
most likely to be wrong is `nestAbsorptionPerSecond`, because it sets both the
attack cadence and how far the cloud spreads before something eats it, and those
two want different values. Flagging it now so the first playtest knows where to
look instead of concluding "the enemies feel wrong" and rewriting the model.

## Progress log

_Lanes append a line per landed change: date, lane, what, and the number that proves it._

- **2026-07-27, lane F follow-on — the belt carries a column (FS-30 to FS-32).**
  The three `TransportLine` gap-accounting defects lane F escalated and correctly
  declined to fix at 3 a.m., taken together because they are one system.

  **The invariant, which is a statement about geometry and not an accounting
  convention.** `headGap + Σ(itemGaps[k > head_]) + itemCount*kItemSpacing +
  tailGap == capacityUnits`. Give item k the offset `o(k) = o(k-1) +
  kItemSpacing + itemGaps[k]` measured from the head, let every body occupy
  `kItemSpacing`, and `tailGap` is by definition the room left behind the last
  body. Substituting gives the sum exactly, so it says one thing: **the layout
  fits on the belt.** Two rules follow and they decide every case. An operation
  that MOVES items must move the free space the other way. An operation that
  ADDS or REMOVES an item must charge `kItemSpacing` to the end where the change
  happened, never to both. It is now stated unconditionally in `factory_sim.h`
  (the old comment hedged with "invariant only modulo what enters and leaves at
  the ends" two lines above stating it unconditionally), published as
  `TransportLine::invariantHolds()` so no test file owns a second copy, and
  asserted after every operation.

  **Throughput, before and after, on the client's own scene** (belt speed 8
  units/tick and a 60-tick smelter, the constants `FactoryCommit.ts` uses), 3,600
  ticks = 60 s of sim:

  | | before | after |
  |---|---|---|
  | saturated 10-tile belt | **1 item** | **40 items** (its own `maxItems()`) |
  | 0.5 ore/s drill: ore / ingots | 28 / 10 | 28 / **26** |
  | 2 ore/s drill: ore / ingots | 63 / 11 | **118** / **54** |
  | 4 ore/s drill: ore / ingots / belt peak | 63 / 11 / 1 | **241** / **54** / **21** |
  | 8 ore/s drill: ore / ingots / belt peak | 63 / 11 / 1 | **478** / **54** / **39** |
  | pinned parity scene, 5,000 ticks: ore | 384 | **665** |

  The old ceiling was **one item per full belt traversal**, which is why a 3-tile
  belt used to out-produce a 10-tile one 39 ingots to 11. It is now 57 to 54: belt
  length costs latency instead of throughput, which is the correct shape. The
  bottleneck also moved to where a player can see it. Above 2 ore/s the smelter
  binds at 54 of a theoretical 60 (the missing 6 are the 312 ticks the FIRST ore
  spends walking the belt, `(2560 - 64) / 8`, hand-derived before it was read off
  the code), and at 8 ore/s the belt binds and the drill's own buffer visibly
  backs up behind it.

  **The third defect was a misdiagnosis, and that is the finding worth carrying.**
  `tryPushTail` setting `tailGap = 0` for the first item is geometrically CORRECT:
  an item standing on the last 64 units of a belt has nothing behind it. The
  reason no second item could ever follow it was `advance()`, which moved that item
  off the tail and never gave the vacated room back. Fixing (3) as reported would
  have let a second item enter the space the first was standing in, which is
  precisely the "different wrong answer rather than a right one" the brief
  predicted. `popHead` also stopped minting 64 units of belt per pop, so a
  long-running line can no longer accept more items than its own length.

  **Why 594 green checks missed a belt that carried one item, which is standing
  rule 11 and is the reusable half of this.** Three mechanisms, all still present
  in other suites. (1) **Every full-belt fixture in every suite is
  `fillSaturated()`**, a setup shortcut that WRITES the end state; its own doc
  comment claims it "models a belt that has been running and is full", which is
  exactly the claim it stood in for and exactly the claim that was false. (2)
  **Every `tryPushTail` test pushed exactly one item**, so the operation that fills
  a belt and the state of a full belt were tested on opposite sides of a gap that
  nothing crossed. (3) The invariant helper **existed**, in the test file, applied
  to ONE of the five mutating operations; where it met `advance()` the assertion
  read `gapInvariantSum(lp) + 40 == 1280` with the comment "advance() spends
  headGap". **It measured the violation exactly and was written to absorb it.**
  That is the same shape as the negative control policing a stale radius: a
  threshold tuned until it passes rather than the property the code claims.

  **What was closed so it cannot recur.** The invariant moved onto the struct.
  `belt_gap_invariant_holds_after_every_operation` drives push, advance, pop and
  all three erasing `takeAt` cases for 4,000 ticks and checks after every call,
  with a DW-20 negative control asserting each branch fired and that the line
  really saturated and really blocked. And the class-closing one:
  **`belt_filled_by_pushing_matches_the_fillSaturated_fixture` pins the FIXTURE
  against the PRODUCTION PATH** field by field, at four tile/speed combinations
  including a speed that does not divide `kItemSpacing`, so a setup shortcut can
  never again quietly disagree with the code it stands in for. `factory_sim_tests`
  went 594 -> **33,141 checks**. The one existing check that failed was line 556,
  the calibrated one.

  **FS-31, the follow-on: belt cargo follows the arc.** `BeltCargo.pointOnPath`
  walked two straight chords through the published midpoint; it now solves the
  circumcircle of `socket_item_a` / `socket_item` / `socket_item_b` once at load
  and interpolates the ANGLE, which on a circle is arc-length parameterisation
  exactly. A straight tile's sockets are collinear, the circle degenerates and the
  same call is a lerp, so there is no per-shape branch, which is the art lane's
  published convention. **Measured on the shipped curve: the chord pair sagged
  38.1 mm inside the arc and was 0.765417 m long against the true 0.785464 m.**
  Lane A's A-9 `offsetTiles` trap was already avoided by lane F (`k = floor`,
  `f = frac`, evaluate within tile k), and the inverse is now the tempting error:
  a curve tile's path is 21.5% shorter than a straight one while costing the same
  one tile of sim capacity, so an item genuinely crosses a corner slower in m/s.
  That is the tile-capacity model and it is what Factorio does.

  **FS-32, deferred with a number and a pinning test:** while `headGap == 0` the
  whole line is frozen, so a hole left by a hand pick does not close up behind a
  stalled belt. `belt_blocked_line_does_not_compress_interior_gaps` pins it, and
  its sharpest assertion is that the belt refuses a new item at the tail while
  carrying a whole item's worth of free space in its own middle. Not taken here
  because it needs a compression cursor or a running gap sum to stay O(1) against
  the G1 benchmark's 40,000 lines, i.e. a second state field with five maintenance
  sites, and this change already moves every throughput number in the game.

  **Driven in the browser, all five belt probes green against a production build
  on `vite preview`** (`autoline`, `shortline`, `beltsnap`, `beltcurve`,
  `demolish`; no console.error, no failed request, `abi=8`, worker agrees with 0
  mismatches on every run). The numbers that moved, against lane F's own figures
  from the same probes yesterday:
  - `autoline` **`beltPeakItems` 1 -> 4** on its 3-tile belt, and that 4 is
    derivable rather than lucky: the run is 88 ticks long at speed 8
    (`(768 - 64) / 8`) and the 2.39 ore/s drill boards one item every 25 ticks,
    so 88 / 25 = 3.5 items in flight at steady state.
  - `autoline` cargo **0.333 -> 0.667 items per tile**, 4 instances, 0 skipped,
    **50 draw calls** (lane F measured 49 with one item), 503,818 triangles,
    p50 2.20 ms. The cargo layer is still ONE `BatchedMesh`, so the draw cost
    did not scale with the item count.
  - `autoline` iron out of the line **26 taken, 26 gained by the pack, 0
    spilled**, with conservation still exact (`nodeLost 63 == drainedByMiner 63
    == minerExtracted 63`).
  - **`demolish` is the sharpest browser proof.** Its `stalled` window kills the
    line's middle and lets the belts back up, and the two orphaned runs now read
    **`items [8, 0]` on a 2-tile and a 1-tile run: 8 is exactly the 2-tile
    line's `maxItems()`**. A belt backing up to its own capacity behind a
    stoppage is the Factorio-legible signal that did not previously exist,
    because the belt held one item whether it was stalled or not. Removing that
    belt correspondingly reports **"lost 4 items on the belts"** rather than one.

  Gates: **29/29 ctest**, self-determinism **119/119**, cross-toolchain exact
  **108/108** (the parity fixture's `factory` section re-baselined, `factoryDeplete`
  byte-identical), `npm run check` clean at **166 files**. The wasm was rebuilt and
  synced; **the ABI is unchanged at 8**, so standing rule 9 does not bite.

  **One gap left open on purpose, and it is the same shape as the defect.** None
  of the five probes asserts against a pinned belt-item or ingot constant, which
  is why all five stayed green while the belt's carrying capacity went up 40x.
  `demolish`'s `items [8, 0]` and `autoline`'s `beltPeakItems` are exactly where a
  fixture would have caught this from the client side and there is no fixture
  there. Adding one is a probe change in files a live lane is driving tonight, so
  it is recorded rather than made: **a probe that reports a number without
  asserting anything about it is a log line, not a test.**

- **2026-07-27, lane G — the flight demo, driven adversarially until it stopped
  breaking (PH-28 to PH-36).** Nine defects, and the thing worth carrying out of
  this lane is that **all nine READ HEALTHY ON EVERY INSTRUMENT**, which is the
  same signature the flight lane's own four had. A green probe on one scripted
  path proved almost nothing about any of them.

  **The spread, which is the headline and is not the best run:** the full
  pad-to-orbit-to-deorbit-to-ground ascent flown **ten times from a cold
  browser, and every run bit-identical** — 92.6 x 79.7 km, e 0.0094, staged
  69.7 s, cutoff 112.3 s at 1712 m/s, max q 14.4 kPa, 1588.5 m/s left, mined
  35 -> 367, ingots 12 -> 132, 36 draw calls, p50 1.7 ms. Flakiness was the
  demo risk and there is none.

  **What was actually wrong, in the order a player would meet it.** (1) The
  rolled-out rocket **was not being drawn at all** until you boarded it: the
  chase observer is only stepped while somebody is aboard, so the render
  position sat at its constructed zero and the meshes were at the BODY CENTRE,
  600 km down. The vessel is planted at 26 m and boarding reaches 18 m, so there
  is always a walk to an empty pad, and the rocket appears out of nowhere as you
  get in. Nothing caught it because `distanceToVessel` reads the SIM, which was
  right the whole time. (2) **Pressing the stage key twice on the pad dismantled
  the vehicle and bolted it down forever**: the second press jettisons the
  booster, the remainder cannot make TWR 1, the clamp therefore never releases,
  and the only escape is to climb out and walk 200 m. Measured: four presses
  took 11 parts to 4. Space is also the jump key, so this is the most likely
  wrong thing in the first thirty seconds. (3) **ALT AGL read 19.20 m with the
  rocket standing still on the ground** — exactly twice its own base offset, a
  single wrong sign feeding the navball, the guidance ribbon, the regime band
  AND the touchdown trigger, so every instrument agreed and the arrest only
  armed once the hull was buried by the same 19.2 m. Every altitude assertion in
  the acceptance probe was RELATIVE; none had ever asked whether a rocket on the
  ground is at zero. (4) **The upper stage burned inside the interstage** from
  liftoff, because the plume filter asked "is this an engine" and not "is this
  engine lit". (5) **No message the flight sim ever raised had been on screen**:
  its flash deadline was on the mission clock and the expiry compared it against
  the loop clock, so every one was cleared in the frame it was set, while
  `FlightMode`'s own message had no expiry at all and stuck forever. Two
  opposite bugs in one readout line, which is why the pair looked like it
  worked. (6) **Any rocket taller than 18 m could never be boarded**, because
  the range was measured to the vessel ORIGIN, which is the top of the stack.
  (7) Warp's in-air cap was gated on the PREVIOUS tick's `inSpace`, so a descent
  crossed the atmosphere ceiling in one 1000x block: 16.7 s and about 33 km of
  re-entry taken blind. Now bounded by the height remaining, and verified by
  riding a whole re-entry at 1000x without touching a key: **48 samples observed
  below 60 km, 9 above 1 kPa, a real 139.3 kPa peak, deepest AGL 0.0 m.** (8) A
  WASM heap view held across a call into WASM in the per-stage delta-v read.
  (9) `__of.flight('report').speedMS` read the impact speed forever after a
  landing while the navball beside it read zero.

  **R11, the reload, is half closed and honestly so.** A vessel still cannot be
  serialised, because `of_fl_*` has **no propellant setter** and restoring by
  replaying stage calls would hand back full tanks, i.e. free delta-v on every
  reload. That needs an ABI bump and 3 a.m. with five lanes live is not when to
  take one. So the save is now REFUSED while the player is aboard, counted, and
  said on the navball in words. Measured by a new second runner
  (`tools/smoke/reload.mjs`, which reloads the BROWSER in the same context so
  IndexedDB survives as it does for a person pressing F5): from a 92.6 x 79.5 km
  orbit, **8 saves refused against 1 allowed**, and the reload returns 2
  buildings, 1 link, the hotbar and no phantom vessel.

  **Two escalations that are not physics'.** `Regime.ORBIT_START` is 100 km so
  an 80 km orbit is still labelled ASCENT, which is why the client is still
  fitting shadow cascades from orbit (`Systems.ts:230` keys off the band);
  recommended 62 km, and `Regime.ts` is world-gen's file. And **the player's own
  POSITION is not in the save at all** — a reload returns you to the spawn
  whatever you were doing, flight or no flight (measured: went in at lon 107.8,
  came back at lon 144.0). That one is bigger than the rocket.

  Also fixed, and both were the PROBES rather than the game: the acceptance
  probe's max-q assertion was a fixed 15 to 45 kPa window sized to one terrain
  build, and lane B moved the ground under it (the pad rose about 1.2 km, max q
  fell to 14.4 kPa, a healthy ascent went red) — it is now /core's 27.3 kPa
  lapsed for the MEASURED pad altitude, which still catches drag that is not
  being computed and does not care where the pad is; and the probes' one-button
  placement tape held `use` for three ticks, which the belt lane's new
  drag-to-place turns into a DRAG that lays two drills.

- 2026-07-27 lane A: **world dressing.** Conifer 308 -> 584 LOD0 tris, broadleaf 280 -> 452, four new nature palette roles, grass re-authored as clumps (`GrassTuftA` 0.44 -> 0.95 m, `GrassTuftB` 0.66 -> 1.30 m) with 12 cm blades overlapping into a solid core. 6/6 validate, all six byte-identical on rebuild, verified by rendering the same clump at 8 m and 25 m.
- 2026-07-27 lane A: **the player.** First-person hands rebuilt (elliptical palm, knuckle plate, five fingers on three bones, opposed thumb, colour moved to where the camera can see it, hands 0.435 -> 0.620 m out); body 1244 -> 2320 LOD0 tris with a real back pack, split boots and dark shins. Four new first-person jump and fall clips. Both byte-identical, and two witness assets neither lane owns rebuilt byte-identical to HEAD.
- 2026-07-27 lane A: **the gait, measured not eyeballed.** Three defects found on the shipped bytes: the lean was keyed on `Hips` and drove the toe 30 mm through the ground; `rig_common.keys` rounded the frame but not the phase, swinging contact foot velocity 1.7 to 6.6 m/s around a 4.5 target; pelvis yaw moved the hip socket for a 2.3% skate. Result: net world slip **+0.0005 m** over 0.5250 m of root travel, implied ground speed **4.496 against 4.50 authored**, ground penetration **0.0000 m**.
- 2026-07-27 lane A: **belt cargo.** One rule for both tile shapes (the circular arc through three published sockets, by arc length), `socket_rest` per item so no per-item height table exists, `Item_Crate` for all twelve buildables, and the 0.250 m flow-axis bound derived from `kItemSpacing / kUnitsPerTile`. Found that the published carrying height floated 8 mm above the belt and that the end rollers stood 3 mm proud at every tile seam. New `check_belt_cargo.py`, selftest 19 cases, 11 must fire and 8 must not.
- 2026-07-27 lane A: **armour, four slots**, 904 tris, skinned to the body's own 44-bone rig, rig drift 0.00e+00 at nine poses. Four defects found that were visible only in motion.
- 2026-07-27 lane A: **`contact_sheet.py`**, stdlib-only PNG tiler with a selftest. It is what showed that the first-person model was one unbroken white shape, which no single render says.


- **2026-07-27, lane F, `c2d8e69`: belts behave like Factorio's (FS-26 to FS-29).**
  Reid's three belt items, and the first one overrules a call an earlier lane made.
  **R AFTER PLACEMENT (FS-27), and what it cost to reconcile.** `FactoryCommit.pitchRuns`
  re-derived every tile's heading from its run's geometry on every commit, so a turn
  survived until the next commit and FS-18 responded by withdrawing the key rather than
  the overwrite. The two halves were never the same quantity: the heading splits into the
  tangent YAW (which of four site axes) and the PITCH out of that plane, the yaw is the
  player's and is never written there, the pitch is the ground's and is all `pitchRuns`
  writes. **For a dragged run the output is unchanged by construction**, because
  `dragRun` already refaces each tile at its successor, and that is the property FS-18 was
  protecting: **7 tiles, 1 run**, asserted before and after every turn. **R measures
  `cosToOld` 0 exactly, read back after the commit that used to overwrite it**, and the
  run answered by splitting 1 into 2, which is a corner appearing where the player put one.
  R with an empty hand turns what is under the crosshair; with a part in hand it turns the
  ghost.
  **SNAPPING (FS-26).** New `FactorySnap.ts` reads `socket_belt_in/out` and
  `socket_item_in/out` off the shipped `.glb` files once at load, exactly as `StructureSnap`
  does for decks, and the ghost offers its ground hit to it BEFORE flooring into a cell.
  **Belt to belt 9.245e-7 m** socket to mating socket, which are coincident by construction
  and therefore only near zero if the client and the assets agree. **Belt to machine 2.000 m
  centre to centre and WIRED head-to-smelter**, which is the acceptance that matters.
  Residual named rather than hidden: a **0.500 m** edge gap, the honest cost of a 2 m
  machine on the deliberately-1 m `MACHINE_TILE_M`.
  **CARGO (FS-28).** `BeltCargo.ts` instances the art lane's item meshes along each near
  line's published `socket_item_a`/`socket_item`/`socket_item_b` path, at LOD 0 only, from
  the one O(items) call the section 6 contract has always described and **nobody had ever
  called**. DW-8 is untouched: belt motion is still one shader-driven flow row per line and
  there is no `AnimationMixer` anywhere. **The instance answer: the whole layer is ONE
  BatchedMesh, so it costs a FIXED +4 draw calls (45 to 49) however many items are on
  screen.** Measured 1 item over 3 tiles = 0.333 per tile, 0 skipped, 49 draws, 503,474
  triangles; the 768-item frame budget is 192 saturated tiles and at 120 tris per item is
  92,160 triangles, **3.4% of the 2.7 M alert**. **Taking one off conserves: 4 taken,
  4 gained, 0 spilled**, with `beltTakeAttempts` at 22 proving the aim reached a belt at
  all rather than a zero that could mean either thing.
  **FIVE DEFECTS THE PROBES FOUND, four of them in this change**: the snap steered a DRAG
  and laid a run's first tile behind its own start; a snapped press did not seed the drag's
  reversal guard, so holding walked straight back; the STICKY rotate state was applied on
  top of a snapped heading, silently reversing every snap after any R press; and a smelter
  could catch a belt's INLET and land two cells upstream on the drill's cell. **The fifth
  is the one worth reading (FS-29): `chainRuns` emitted ZERO runs for a pure cycle**, so
  two belts facing each other existed, were drawn, were never placed in /core, and turned
  48 mined ore into 0 iron over 1,200 ticks with `runs: []` the only clue. FS-27 made it
  reachable rather than causing it. `Factory.pick` also changed from nearest-along-ray to
  smallest miss-over-radius, because a smelter's 1.6 m sphere made every belt beside it
  unaimable: an aim **0.005 m** off a belt's centre resolved to the smelter on all seven
  presses from four standing positions.
  Gates: **29/29 ctest** (594 checks in `factory_sim_tests`), self-determinism **119/119**,
  cross-toolchain exact **108/108**, `npm run check` clean at **166 files**, and
  `autoline`, `beltsnap`, `beltcurve`, `shortline` and `demolish` all green. Screenshots
  `docs/screenshots/W11_belt_snap.png` and `W11_belt_cargo.png`.

- **2026-07-27, lane D — the power model (FS-20 to FS-23).** New
  `core/include/of/power.h` (poles, wire reach, supply areas, union-find network
  formation, the supply/demand solve, fuel-bounded generators, per-network stats
  and a history ring), bound into `automation.h` as the single power authority
  and into `gameplay.h` as an open three-rung smelting ladder. Two new suites,
  `power_tests` (1,188 checks) and `smelting_tiers_tests` (142 checks), both
  green; **26 of 27 ctest suites pass** (the one failure is
  `terrain_stream_tests/procgen_optimized_is_bit_identical`, which is lane B's
  live edits to `cubed_sphere.h` and `biome.h` and is not reachable from any
  file lane D touched). Numbers that prove it, all hand-computed before the code
  was run against them: satisfaction 90 kW against 120 kW = **49152** Q16
  exactly; three machines of 30, 60 and 90 tick recipes all slow by **exactly
  4/3** at that ratio and by **exactly 2** at 32768; **one 90 kW generator runs
  three 30 kW electric smelters and the fourth adds ZERO output** (120 ingots in
  1,200 ticks either way, and 160 once a second generator is placed); one coal
  unit is **2,667 powered ticks at 90 kW, 5,334 at 45 kW and 8,001 at 30 kW**
  with **4,000,000,000 mJ delivered in every case**, so energy is conserved
  exactly rather than approximately; removing one bridging pole from a five-pole
  line splits **one network into two of two poles each** and the halves then read
  **49152 and 65536**; wires are a spanning tree, **182 in-reach pairs against 29
  segments** at 30 dense poles; a generator that also consumes 3x its own output
  sits at **21845 for 1,000 ticks** and never collapses; ten ore become ten iron
  in **1800 / 600 / 300 ticks** on the three rungs. The parity fixture's
  `factory` and `factoryDeplete` sections are **byte-identical** before and
  after, so this change is determinism-neutral. No `web/**` file touched, no
  wasm rebuild, ABI untouched by lane D.

- **2026-07-27, lane B, `d1f474e` — the voxel representation changed.** Signed
  density at lattice corners (`core/include/of/voxel_field.h`) replacing one
  occupancy bit per cell, meshed by surface nets (`core/include/of/surface_nets.h`)
  instead of cube faces. Additive commit: nothing existing is touched, so this one
  cannot move any other lane's numbers.
  **Q flattening, the headline: worst height step over a 4 m span, which is the
  span a DW-32 foundation bridges, on a site with 7.03 m of spread across 12 m,
  2.1408 m before and 0.0000 m after.** WG-23 defined the 0.25 m threshold, could
  not meet it, and reached 0.973 m; 0 of 49 columns are now off target, and the
  DRAWN pad read back from the extracted mesh has a radial spread of 0.000001 m
  over 223 vertices. **DW-26 re-derived and still asserted**: the cell-versus-point
  bound is unchanged in kind at 0.4012 m worst against 0.8660 m, and the bound that
  actually hurt, the distance between the surface DRAWN and the surface COLLIDED,
  went from **0.8660 m (a whole cell face) to 0.087116 m**. Digging: the carved
  sphere is the surface to 0.0957 m and the crater carries **77 distinct normals
  where a cube mesher emits exactly 6**. New `voxel_field_tests`, 143 checks.

- **2026-07-27, lane E — the enemies model, as a loop rather than a wave timer.**
  New `core/include/of/enemies.h` + `core/tests/test_enemies.cpp` (**248 checks**),
  ctest **28/28**. Design notes and every decision with its rationale are in
  [docs/controllers/enemies.md](../controllers/enemies.md).
  **Cost, the number the brief asked for: at 1,200 machines (the DW-28 render
  limit) the whole system costs 10.06 us per sim tick, and doubling to 2,400
  machines in the same footprint cost 1.28x, not 2x**, because pollution lives on
  5,500 sparse 146 m cells rather than on machines. At 60 UPS that is 0.06% of
  wall clock. A 30-machine starting base costs 3.81 us/tick over 2,173 cells.
  **Diffusion is pinned to hand arithmetic, not to itself**: from a 1,000-unit
  source at D = 0.02 and decay = 0.01 the values at distance 0/1/2/diagonal over
  two ticks are 910.8, 19.8, 831.1248, 36.06768, 0.39204 and 0.78408, each
  derived on paper (the last two are `D^2*A*(1-k)^2` and twice it, since a
  diagonal has two paths), asserted to 1e-12; and distance 2 is asserted to be
  **exactly zero** after one tick so an over-diffusing scheme fails. Mass is
  conserved to the closed form `1000*0.99^30 = 739.700373388`, **including across
  a cube-face seam** (777.821359399 spread over two faces), which is where a
  naive neighbour table silently reflects.
  **The negative control, which is the point of the whole exercise**: six nests,
  thirty simulated minutes, no emitters, gives **0 waves and 0 pollution
  absorbed while evolution provably rises to 0.3017 from its time term**, so the
  run cannot be silently doing nothing (DW-20). Its complement also holds: a base
  that was being attacked and then switches its emitters off gets **0 waves in a
  clean 30-minute window**. And EN-4's zero: a 2,000/s base with no nest anywhere
  leaves the evolution pollution term at **exactly 0.0**, because evolution is
  driven by pollution ABSORBED, not produced, which is what makes distance and
  nest-clearing real mitigations.
  Evolution keeps all three Factorio inputs, each isolated in test (hold two at
  zero, vary the third) and each accounted separately so `factor == fromTime +
  fromPollution + fromKills` holds **bit-exactly** for a UI breakdown. Waves are
  aimed at the emitter that fed the nest, tested against a nearest-emitter
  heuristic that answers differently (5/s at 1.5 km loses to 220/s at 3.5 km, and
  the mirror case resolves the other way). Nests expand toward the pollution: one
  seeded 2,968 m out put its nearest child at 1,270 m within 20 minutes.
  **The module is transcendental-free by construction** (only `+ - * / sqrt fabs
  floor`), so unlike world-gen it should be bit-identical cross-toolchain; the
  price is a measured 2.1209x cell-size variation between a cube-face centre and
  a corner, against the 3/sqrt2 = 2.1213 analytic limit. No `web/**`,
  `factory_sim.h`, `power.h`, voxel or surface file touched; ABI untouched.

- **2026-07-27, lane D — the power model (FS-20 to FS-25).** New
  `core/include/of/power.h` (pole classes, wire reach, supply areas, union-find
  network formation, the supply/demand solve, fuel-bounded generators,
  per-network stats and a history ring), bound into `automation.h` as the single
  power authority and into `gameplay.h` as an open three-rung smelting ladder.
  Two new suites, `power_tests` (1,188 checks) and `smelting_tiers_tests` (142
  checks), both green; **24 of 24 buildable suites pass** (`surface_walk_tests`
  and `surface_field_tests` do not currently COMPILE on lane B's in-flight
  `surface_field.h` signature change, which is unreachable from any file lane D
  touched). Numbers, all hand-computed by a subagent from an arithmetic spec
  before the code was run against them: satisfaction 90 kW against 120 kW =
  **49152** Q16 exactly; 30, 60 and 90-tick recipes all slow by **exactly 4/3**
  there and **exactly 2** at 32768; **one 90 kW generator runs three 30 kW
  electric smelters and the fourth adds ZERO output** (120 ingots in 1,200 ticks
  either way, 160 once a second generator is placed); one coal unit is **2,667
  powered ticks at 90 kW, 5,334 at 45 kW, 8,001 at 30 kW**, delivering **exactly
  4,000,000,000 mJ in every case**, so energy is conserved rather than
  approximated; removing one bridging pole from a five-pole line splits **one
  network into two of two poles each**, which then read **49152 and 65536**;
  wires are a spanning tree, **182 in-reach pairs against 29 segments** at 30
  dense poles; a generator that also consumes 3x its own output sits at **21845
  for 1,000 ticks** and never collapses (the power analogue of the FS-17 belt
  deadlock); ten ore become ten iron in **1800 / 600 / 300 ticks** on the three
  rungs. The parity fixture's `factory` and `factoryDeplete` sections are
  **byte-identical** before and after, so this change is determinism-neutral.
  Deferred with reasons: **no accumulators until solar exists, no boiler chain
  until fluids exist** (FS-23). No `web/**` file touched, no wasm rebuild, ABI
  untouched by lane D; the bridge exports, the panel and the wire rendering are
  handed off in the lane D blockers above.

### Lane C, 2026-07-27: base building, all five items

**GP-36, the founding plane is chosen to fit (DW-33).** `fitPlane(lo, hi, floatM,
buryM) = clamp(hi - buryM, lo, lo + floatM)` in the new `StructureTolerance.ts`,
applied by `makeSite`. Fills the bury budget first and spills the remainder into
float, because a float past its bound can be carried by a neighbour and a bury
past its bound cannot. **14.8% of 81 origins buildable under the pinned rule, 58.0%
under the fit, measured in ONE probe run over ONE terrain; the `mid` site went
70.6% to 100.0% of 812 footprints.** `probes/buildtol.js` now scores both rules
side by side so the comparison survives the terrain moving.

**GP-37, snapping.** `StructureSnap.ts` reads `socket_edge_n/e/s/w` and
`socket_end_l/r` off the shipped `.glb` files once at load; the nearest within
3.00 m overrules the grid whenever the cell it offers is free, and the ghost says
`[snapped to #12 socket_edge_e]`. Directions come from the socket's local
POSITION rotated by the part's quaternion, never from its name. **Deck to deck
1.392e-12 m; a wall 0.000e+0 m from the socket the ghost said it caught AND
0.000e+0 m from the nearest one; two panels of a run 0.000e+0 m end to end; one
placement driven through a real `PointerEvent`** (`probes/basesnap.js`).

**GP-38, the cantilever.** One storey (4.00 m, off `module.storey`) of hang when
an orthogonally adjacent deck carries it, capped at 3 cells from the nearest
grounded deck, bury untouched. **Runs 1, 1, 2, 3 accepted hanging 0.50, 2.00,
3.35, 3.91 m; the fourth refused "nothing under this and no solid ground within
3 cells"; pillars 3 decks / 9 pieces / 3.152 m tallest. Negative control on the
SAME cell: pull its three carriers and the identical 2.0014 m hang is refused**
(`probes/cantilever.js`, screenshot `docs/screenshots/W11_cantilever.png`).

**GP-39, machines on decks.** `anchorIn` takes the deck's own `socket_top` height
when a deck covers the cell; the hand furnace also leaves `of_cell_for_pos`, which
it was the last thing in the build system still using. **`onDeck` true, 6.695e-12 m
above the deck's own socket.** The 4 m structural cell and the 1 m `MACHINE_TILE_M`
stay deliberately separate.

**GP-40, re-priced at 4 m.** Foundation 40 Stone, floor 20 Wood + 20 Stone, wall
12 Wood, door 16 Wood + 4 Iron: 10x on decks, 4x on wall parts, short of the 16x
area parity on purpose. **40 Stone charged per foundation, read from /core's own
quoted price rather than a literal, and a short pack refused "need 16 Wood + 4
Iron"** (`probes/build.js`). The `/core` test now pins the ORDERING as well as
the values.

Gates: **23/24 ctest** (`surface_field_tests` is lane B's in-flight field),
`npm --prefix web run check` green, 160 files all under 400 lines,
`probes/build.js`, `basesnap.js` and `cantilever.js` all `valid: true`.

- **2026-07-27, lane E, `6c1c85c` — ten defects an adversarial review found in a
  suite that was already green.** The enemies core landed at 248 checks, all
  passing. An independent review pass over the same header found **ten real
  defects**, and that is the finding worth more than any of them individually:
  every one was invisible to tests written by whoever wrote the code, because
  those tests encode the same assumptions the code does. Suite now **525
  checks**, ctest 28/28. Detail per defect in
  [docs/controllers/enemies.md](../controllers/enemies.md) section 10.
  **The one that mattered most would have silently undone the module's headline
  property.** `diffuseAndDecay` sorted its scratch buffer with `std::sort` and
  then summed each equal-key group IN ARRAY ORDER. Equal `(key, source)` groups
  are the normal case: in a single-emitter cloud every cell gets one retained
  entry plus one from each of four neighbours, so five doubles share a key and a
  source. Floating-point addition is not associative and `std::sort` leaves ties
  in an unspecified permutation, which is stable within one toolchain, **which is
  exactly why the determinism test passed and could not possibly have caught
  it**, and unstable between libstdc++ and libc++. EN-2 had paid a measured
  2.12x cell-size non-uniformity to keep this module bit-portable; this threw it
  away through a side door. `std::stable_sort` fixes it and is **20% faster** on
  a nearly-sorted input, so the 1,200-machine cost fell from 10.06 to
  **8.04 us/sim-tick**.
  **Three of the ten were ceilings that report success**, the DW-28 class this
  project has paid for before. `maxNests` counted the GRAVEYARD, so once 512
  nests had ever existed the faction went permanently extinct while
  `aliveNestCount()` kept reading healthy. `pollutionTickInterval = 0` froze the
  entire loop while `tickIndex()` climbed and every accessor looked fine. And
  `maxWaveSize` truncation was unreported with no cap on the carried budget, so
  a heavy base would eventually get a constant wave size while the threat meter
  climbed past 100% forever.
  **Two would have disabled the game silently.** One content row with
  `budgetCost = 0` made every nest refuse every wave forever, whose only symptom
  is that nothing ever attacks: **indistinguishable from the negative control
  passing**. And demolishing a base made the nest credit a dead emitter, giving
  a wave `targetDir` of `(0,0,0)`: an attack aimed at the planet's core.
  **Verified rather than asserted, because a guard that has never been seen to
  fail is not a guard.** Reverting the six behavioural fixes in a scratch copy
  of the header and rebuilding the CURRENT test file against it fails **exactly
  six suites by name and 18 checks**. The other four moved a defect out of reach
  rather than changing an observable. The `stable_sort` fix **cannot** have a
  test on one toolchain by construction, so it is filed as a specific ask on
  `parity.mjs` for whoever takes this module across the bridge.
  **The generalisation, which is why this is in the log rather than in a bug
  list:** the numbers in the original commit were all true, the suite was
  genuinely green, the negative controls were real, and the code still had ten
  defects, three of which are the exact failure shape DECISIONS.md already names
  as this project's worst. Green does not mean audited. Budget a review pass on
  anything that will be depended on.

### Lane C, 2026-07-27: item I, player progression (headless half)

`core/include/of/progression.h`, additive over `gameplay.h` exactly as
`research.h` is, plus `core/tests/test_progression.cpp`. **10 tests, 823 checks,
29/29 ctest with it registered.**

**Armour (GP-42).** Four slots; `armourNode(EquipSlot)` returns the same four
strings `armour_set.glb` ships, because the art lane's contract says the node
names are SLOT names and not SET names, so a second set is a second file and
nothing in the client moves. Reduction SUMS, encumbrance MULTIPLIES, the cap is
0.80 and nobody is immune; the tier-1 iron set is 0.40 reduction at 0.892 move
speed for 35 Iron and 11 Wood. **The ItemId block is 0x0070+ and deliberately
skips 0x0050..0x006A**, which GP-31's vessel part items already own in
`of_vessel_api.inc` pending promotion into /core. `damageAfter(raw)` is
published and NOT applied, because the damage model is the enemies lane's and is
being built tonight.

**Skills (GP-43).** Five, one per verb the game already has. Quadratic curve
`100 * n^2`, cap 10, +5% per level, and `skillMultiplier(0) == 1.0f`
bit-exactly, which is the property that makes the layer optional: `harvestNode`
and `Furnace` can opt in through `Skills::applyYield` without one pinned test
moving. Rounding is down and is one published call rather than four call sites.

**Appearance (GP-43).** Five bytes of palette indices with `sanitise` idempotent,
so a save written against a longer palette degrades to a legal player rather than
to an index the renderer discovers at draw time.

**What is NOT done, and it is the whole client half.** There is no bridge export,
no `game/Progression.ts`, no equip panel and no armour drawn on the avatar. That
needs an ABI bump (standing rule 9, atomic) plus `web/src/ui/` and
`web/src/player/Avatar.ts`, none of which this lane owns. Handed to Admin with
the exact surface named in the completion report.

**One process note.** `progression_tests` is registered in `core/CMakeLists.txt`
in the same commit as the header, and that commit also carries lane B's
`terrain_probe` target and its source, because the two edits are in one file and
committing mine alone would have left HEAD unable to configure. Attributed rather
than silent; lane B loses nothing and should commit over it freely.

### Lane C, 2026-07-27: the follow-up pass, and a bug my own first version had

**GP-36 needed a `PLANE_MARGIN`, and finding out why is the most useful thing in
this lane.** Spending the bury budget to the last millimetre puts the worst
footprint point at exactly `buryM`; `checkGround` then re-derives that same
number by a different arithmetic path, and both sides are `ground(x) - |x|`, a
difference of two doubles of magnitude 600,000. The cancellation carries about
1e-10 m, a slack ratio of 1 + 2e-10 is greater than 1, and the placement is
refused. **On the coarse height field I started against this branch was rarely
taken and the defect hid; within an hour of WG-25 landing it was the normal case
and every one of 88 scanned candidate sites refused for standing 0.50 m into a
0.50 m bound.** The fix is 2% of each bound left unspent, not an epsilon, because
there are two problems and only one is arithmetic: a plane sitting exactly on the
bury bound also leaves the second cell of the site no room at all. **The
generalisable part: a rule that lands exactly on a limit is refused by that limit
whenever the two sides are computed differently, and at planet scale "computed
differently" is guaranteed.**

**Final numbers, all re-measured on the post-WG-25 field:** 81 origins buildable
14.8% pinned against **58.0%** fitted; the `mid` site 70.6% against **100.0%** of
812 footprints; deck to deck **4.485e-13 m**; a wall **0.000e+0 m** from the deck
socket the ghost named AND from the nearest one; a wall run **0.000e+0 m** end to
end; a furnace **6.695e-12 m** above the deck's own `socket_top`; cantilever runs
1, 2, 3 accepted hanging **1.077, 1.792, 2.480 m** with run 4 refused by the cap
and the same-cell control refusing the identical **1.0773 m**; 40 Stone per
foundation; save/reload 8 parts with **0.000e+0 m** worst move.
`build.js`, `basesnap.js` and `cantilever.js` all `valid: true`.

**Two things that cost time and are worth writing down.**

1. **The shared dev server made driven probes unusable for about an hour.** Vite
   HMR full-reloads the page whenever any lane saves a file, and a 60 to 90
   second probe then dies with "Execution context was destroyed". `sandbox.js`,
   which no lane touched tonight, failed identically, so this is not a lane's
   regression. **The workaround is `npm run build` plus `npx vite preview --port
   4180` and `--url=http://127.0.0.1:4180/`**: a static bundle does not reload,
   and every probe went green first try against it. Recommended for any lane
   running long driven probes while others are live.
2. **`npm --prefix web run check` currently FAILS on
   `src/sim/FlightSession.ts: 404 lines > 400`**, which is the flight lane's file
   and not reachable from anything here. `tsc --noEmit` is clean; every file this
   lane owns or created is inside the cap.

- **2026-07-27, lane B, `ccb26f6` + `8667a16` — WG-25/WG-26, the terrain itself.**
  Two defects, and only one was the one I sent the subagent to find. The expected
  one: the noise stack had **no high-frequency content at all**, finest octave a
  1.9 km lattice cell, so the wavelength sweep read 9.02% / 9.01% / 9.01% of
  spacing at 1 m / 2 m / 5 m, which is a tilted plane and nothing else, and the
  slope spectrum on a peak ran p50 0.616 to max 0.630. The unexpected one:
  `designedReliefFactor` switched on the DISCRETE biome, so the classifier
  boundary was a **985 m vertical wall** between two samples 100 m apart, with
  more at every coastline, moisture threshold and ice cap. So "mountains look like
  shit" was flat domes separated by sheer steps. **Worst grade over 100 m,
  985.37% to 87.54%. Wavelength coverage 240 km to 1.9 km, now 240 km to 60 m.
  Mountains biome 3.4% to 7.0%.** Cost went the RIGHT way: `sampleDesignedHeight`,
  which every consumer reads, went **40 to 19 valueNoise calls and 2.00x FASTER**,
  because it had been evaluating the height field three times per vertex; the
  browser HUD shows the oracle at **2.23 to 0.97 us/call**. **Flat start area:
  worst 4 m step inside the pad 0.000000 m exactly**, asserted as a bit compare,
  bit-identical outside the blend, effect provably zero by 601 m.
- **2026-07-27, lane B, `bd8c2e8` + `2efe44e` — ABI 7 then 8, the client reads the
  signed surface.** Screenshots: `docs/screenshots/WG24_dig_before.png` against
  `WG24_dig_after.png`, and `WG24_mountains_before.png` against
  `WG24_mountains_after.png`, same seed, pinned cameras recorded in the probes.
  **Levelling, driven through a real DOM key event, on the DRAWN chunk geometry,
  worst step within one 4 m foundation module: 1.788 m to 0.000 m**, drawn spread
  3.327 to 0.000 m, oracle spread 4.029 to 0.000 m. WG-23's numbers on that same
  instrument were 1.883 to 0.973 m against a 0.25 m threshold it could not meet.
  **DW-26's drawn-versus-collided bound 0.8660 m to 0.087116 m.** 29/29 ctest,
  self-determinism 119/119, cross-toolchain exact **108/108** (it was 105/106 when
  I started, and that pre-existing `abi` blocker is now cleared).

### Lane B follow-ups, 2026-07-27 (WG-28): all five worked, and the review found more

Every item in "Lane B, open items" below is answered here. Detail and rationale
in [world-gen.md](../controllers/world-gen.md) WG-28.

**1. WHICH INSTRUMENT WAS WRONG: THE PROBE. The level op's blast radius is
correct.** `probes/level.js` sized its "outside the radius nothing moved" ring at
2.5x **its own local copy of the pad radius, `R = 6.0`**, giving 15 m. WG-27
widened the tool to 10 m, and the disc is centred on the AIM POINT up to
`reachM` = 9 m downhill of the player, so the pad reached **16.279 m from the
feet** and the control ring sat **1.17 m inside the pad it was policing**.
Measured against the discs the tool itself reported: the two ring points that
moved were **8.844 m and 9.968 m from the disc axis, and the next point out at
10.386 m moved 0.000000 m**, against a radius of 10.000. The boundary is sharp
and exactly where `levelDisc` says it is. Fixed at the root rather than by
moving a threshold: the tool publishes `lastCentreM` / `lastRadiusM` /
`maxRimFromFeetM` and a `limits` record, and the probe derives its ring from
`reachM + radiusM` and **asserts it cleared every disc that was cut**
(`controlRingClearsThePad`: ring 20.000 m, rim 16.279 m, clearance 3.721 m).
`outsideUntouched` reads **0 of 12 points, 0.000000 m**. All 13 assertions green.
**Worth taking out of this lane: a control whose geometry is a constant copied
from the thing it watches stops being a control the moment that thing is
retuned, and it fails in the direction that looks like a real defect.**

**2. `npm --prefix web run check` IS GREEN**, 166 files all inside 400 lines and
`tsc --noEmit` clean. The two lanes it was red in have both landed their fixes
since: `src/sim/FlightSession.ts` is back inside the cap and the `BuildTarget`
seam in `Gameplay.ts` resolves. Nothing was touched in either lane's files.

**3. THE LEVEL PRESS, 4.6x cheaper cold and 12.8x warm, with a byte-identical
parity fixture.** `levelDisc` asked EVERY cell in the padded box for its
solidity, twice, to produce the `dug` / `filled` counts: about **32,000
`solidCell` calls where the op writes about 2,000 corners**. A cell reads exactly
its own eight corners, so a cell none of whose corners the op writes cannot
change solidity; the cell passes now run over that candidate set only.
**Native A/B, same binary, same sites: cold 42.7 to 9.3 ms, warm 12.9 to 1.0 ms,
and `web/wasm/test/expected.json` regenerates byte-identical**, which is the
proof the output did not move. In the browser, with the press broken into its
parts for the first time: **39.7 ms cold (op 15.2, near-mesh rebuild 25.6, quote
1.2) and 7.0 ms held (op 2.4, rebuild 2.8)**. The cold press is now dominated by
the NEAR MESH REBUILD, not by the terraforming, which is where the next pass
should go. A process note: the first browser A/B of this change read flat, and
the reason was that the two runs were not provably different binaries. Every
before/after here now carries a value that differs between the builds
(`editCounts.removed`) so a swap that did not take cannot read as a null result.

**4. THE CRATER FRAGMENTS WERE THE MESHER, and this is the biggest find of the
night.** **Every triangle surface nets emitted was wound inside out** (258 of 258
on a crater, 259 of 260 on a mound), confirmed two independent ways before
anything was changed: stepping along each triangle's geometric normal landed in
ROCK, and that normal disagreed with the mesher's own per-vertex gradient normal
on 100% of triangles. The client draws the near voxel mesh with no `side`
override, so three.js back-face-culls it, and an inverted CLOSED surface does not
vanish, it draws its **far side through its near side**. See
`docs/screenshots/WG28_crater_before.png` against `WG28_crater_after.png`: a
black void full of pale shards, against a lit readable bowl. It survived 143
green checks because the only test that reads `indices` past a count **sorts each
index triple**, which erases winding by construction. New
`mesh_triangles_face_out_of_the_rock`, verified by reverting the fix in a scratch
copy, where it fails **9 checks in exactly one test and nothing else in the suite
notices**. **Two honest caveats.** The tile-mean fragment metric in
`probes/craterfrag.js` does NOT separate the two builds (darkest tile 27.0 before
against 32.6 after) and the threshold was deliberately not tuned to sit between
them; the gate for this defect is the /core test, and a per-pixel dark-run count
is the follow-up. And the first version of that metric, counting bright outliers,
ranked the BROKEN frame better (4 against 9), because a black void has nothing to
be an outlier against. Only looking at the two captures explained it.

**5. A SPAWN SITE, with numbers: lat -0.39200 / lon +111.04783.** Found by
sweeping `designedHeightNoPad` and `biomeAt` through the oracle the way `HOME`
originally was, with a new read-only `core/tools/spawn_probe.cpp`.
**2084.2 m, Hills, slope 0.38% at 4 m and 0.38% at 20 m, worst 4 m step 0.031 m**
(a DW-32 module sits flat). It is a real valley floor rather than a tabletop:
**160.7 m below the mean of its 6 km box with 94.2% of that box above it, and
28.2 m below the 1 km mean with 98.5% above it**, the strongest floor reading
found anywhere. There is terrain to look at: **a 4116.7 m peak 7.6 km away, 2032 m
above the site, with Mountains biome from 2 km out**, and 1073.7 m of relief in
the 6 km box. Lowest ground within 6 km is only 23 m below it, so it is not a
lake bed. Pad simulated in place: **worst 4 m step inside the flat radius
0.000000 m, and the blend annulus adds 3.66 percentage points of grade over the
natural slope**. 346 km from the current spawn and nearly on the equator like it.
**The move needs BOTH halves and they are in different lanes' files.**
`web/src/app/Config.ts:32` `HOME` is one; the load-bearing half is the `homeDir`
literal in `forgeBody()` at `core/include/of/cubed_sphere.h:313`, pinned by
`test_biome.cpp` against `latLonToDir` to 1e-12. Landing only one would put the
flat pad somewhere the player does not spawn, so **neither was landed**. The
literal to go with the recommendation:
`b.homeDir = Vec3(-0.35913876352721213, -0.006841637292799462, 0.93325909614174074);`
Runner-up if pad invisibility outranks valley depth: **lat +25.59450 / lon
+124.18913**, 2005.7 m Hills, worst 4 m step 0.017 m, peak +2364 m at 7.1 km, and
the pad adds only 1.05 percentage points
(`Vec3(-0.50678686052793986, 0.43199917710346952, 0.74601862508797978)`).
**Two corrections to the record.** The current spawn's slope is **21 to 26%, not
42%** on this instrument (worst 10 m grade inside the pad disc 32.37%); it is
still 4667.8 m of Mountains sitting **130.7 m ABOVE** its 6 km mean with only
37.8% of the box above it, so "a plateau perched on a mountainside" is exactly
right. And the comment in `cubed_sphere.h` claiming the blend "adds about one
percentage point of grade, so it does not read as a cut disc" is **stale by 18x
since WG-25: it now adds 18.00 points there.**

**FOUND BY THE ADVERSARIAL PASS AND NOT FIXED**, each with the number that
demonstrates it, so the next lane does not have to rediscover them:

- **`columnSurfaceHeight`'s first sample skips the floating-slab check**
  (`voxel_field.h`, the `dPrev >= 0.0` early return). Every other solid sample
  goes through `runIsAnchored`. A slab filled **21 to 27 m up with nothing under
  it pins the heightfield to the +24 m fill cap**, and the returned value is
  bit-identical to a legitimate "filled to the cap", so no caller can tell them
  apart. The existing sweep tests 3 to 12 m, and the cap is 24, so the sweep
  provably never reaches the band where the unguarded path lives.
- **`runIsAnchored`'s floor is the DESIGNED base**, so nothing below the base can
  ever read as floating and everything inside a pit is declared anchored. A slab
  placed 8 m down a 16 m shaft, with open air 3 m beneath it, **refills the pit by
  10.9245 m** of streamed heightfield. Bites any player who bridges their own
  cavern. Both floating-slab tests only ever place blocks ABOVE the base.
- **`columnTouched` is documented as EXACT and is not.** It samples one cell per
  metre along the radial, so it misses **19.29% of the corners `densityAt` can
  actually read** (953 of 4,940 over 60 directions). The damage today is
  sub-millimetre (worst 0.000503 m with real dig brushes), but the stated
  invariant is false and nothing enforces that it stays small.
- **`levelDisc`'s real footprint is 1.48 m wider than the radius it is given**,
  because the trilinear stencil reaches one cell past the corner test: outermost
  changed radius 9.48 m for an 8 m pad, worst change outside the nominal radius
  0.2367 m. Both suites' negative controls sample at 3x the radius, so
  "outside the disc nothing moved, bitwise" is true and vacuous. Worth pinning
  and worth stating in the header so the preview ring can show the real
  footprint. (The client-side control now clears it: 20 m ring against a
  16.279 + 1.48 m reach.)
- **`surfaceNets` refuses a too-large region by returning an EMPTY mesh**, which
  is byte-identical to "there is no surface here". `surfaceNetsAround` with
  `radiusM >= 81` silently draws nothing. Same for `surfaceNetsBrick` with
  `brick <= 0`. This is the DW-28 ceiling-that-reports-success shape and wants a
  status field.
- **The `procCorner` memo tops out around 201 MB per field and then clears
  WHOLE**, so the next query re-evaluates the noise stack for every corner. An
  LRU or a halving would avoid the cliff.
- **`probes/digquality.js` still reads `mesh.mergeRatio`, `.faces` and `.quads`**,
  which the greedy cube mesher took with it. They read `undefined` rather than
  failing, which is the wrong way round. Not fixed tonight.

### Lane B, open items, 2026-07-27 (ALL ANSWERED ABOVE, kept for the record)

- **The probe negative control `outsideUntouched` FAILS at the widened 10 m pad:
  2.779 m of movement on a ring at 2.5x the pad radius, where it read 0.000000 m
  at 6 m.** `/core` proves the same property BIT-IDENTICALLY over 12 points at
  30 m, so the two instruments disagree and one is wrong. Leading hypothesis is
  that the probe sizes its ring from the radius constant that just changed and is
  no longer concentric with the pad the tool cut, but that is a hypothesis, not a
  measurement, and it is the one thing tonight I would not demo without checking.
- **The after-crater still contains a few isolated pale fragments.** The bowl and
  its rim are smooth and the black shard field is gone, but small disconnected
  pieces remain inside, most likely cells the `editedOnly` filter keeps whose
  neighbours it drops. Cosmetic, visible on close inspection, unmeasured.
- **A level press costs 32.7 ms cold and 4.5 ms held**, against WG-23's 0.9 ms.
  The cost is the procedural field evaluated once per corner over the scan box and
  it is memoized after; a dig strike is 0.37 ms plus 9.4 ms of re-mesh cold and
  0.4 ms on the next strike. Acceptable, not free, and worth a pass.
- **`npm --prefix web run check` is RED on HEAD, in lane C's files only**
  (`src/game/Gameplay.ts`, `src/game/FactoryView.ts`). Lane B's own files
  typecheck clean; I did not touch theirs.
- **`web/tools/smoke/probes/digquality.js` reads `mesh.mergeRatio`, `.faces` and
  `.quads`**, which no longer exist now that the greedy cube mesher is gone. They
  read `undefined` rather than failing, which is the wrong way round.
- **WG-26 judgement call for Reid:** at this seed the fixed spawn is no longer a
  Hills valley floor at 2,963 m, it is Mountains at 4,668 m on a 42% mountainside,
  so the flat area is a plateau perched on a mountain rather than a clearing. It
  works and it may not be what "flat starting area for simplicity" pictured.
  Moving the spawn means editing `Config.ts`, which lane B does not own.
