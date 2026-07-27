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
| A | Art: characters and world dressing | player model, player animation, grass, trees, ore deposit meshes, belt cargo meshes, armour slots as art | `tools/blender/`, `assets/` | in flight: contracts written, 3 build lanes running, armour queued behind the character |
| B | Terrain and digging | smooth voxel field, dig quality, Q flattening, flat-ish spawn, mountain shape, generation quality for the default seed | `core/` worldgen + voxels, `web/src/world/` | launched |
| C | Base building and placement | DW-33 founding plane, cantilever from a neighbour, foundation and wall snapping, machines sitting on decks, re-price at 4 m | `web/src/game/Structure*.ts`, `MachinePlacement.ts` | **all five landed** (GP-36 to GP-40) |
| D | Electricity and smelting tiers | generation, poles and distribution, a supply/demand panel, furnace to coal smelter to electric smelter | `core/include/of/power.h` (new), `factory_sim.h` | **model DONE in `/core`; panel + bridge handed off** |
| E | Enemies | pollution spread, evolution, nest spreading, attack waves, base defense | `core/include/of/enemies.h` (new) | **model DONE in `/core`** (248 checks green, 1,200 machines cost 10.06 us/sim-tick); production hook + combat handoff published, see Blockers |
| F | Belts | direction change after placement, belt-to-belt and belt-to-machine snapping, cargo visible on belts, taking items off a belt | `web/src/game/Factory*.ts`, `MachineBatch.ts` | queued, blocked on C |
| G | Flight end-to-end validation | drive the whole demo repeatedly and adversarially until it is smooth | new probes | queued, blocked on W8 flight |
| H | Research and tech tree | wire `research.h` into play, a tech tree UI, gate machines and recipes | `core/research.h`, `web/src/ui/` | queued, blocked on flight (owns `ui/`) |
| I | Player skills, appearance, armour | slots for head/chest/legs/feet, customization | `core/gameplay.h`, `web/src/game/` | queued, blocked on C |

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
