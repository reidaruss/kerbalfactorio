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
| A | Art: characters and world dressing | player model, player animation, grass, trees, ore deposit meshes, belt cargo meshes, armour slots as art | `tools/blender/`, `assets/` | launched |
| B | Terrain and digging | smooth voxel field, dig quality, Q flattening, flat-ish spawn, mountain shape, generation quality for the default seed | `core/` worldgen + voxels, `web/src/world/` | launched |
| C | Base building and placement | DW-33 founding plane, cantilever from a neighbour, foundation and wall snapping, machines sitting on decks, re-price at 4 m | `web/src/game/Structure*.ts`, `MachinePlacement.ts` | launched |
| D | Electricity and smelting tiers | generation, poles and distribution, a supply/demand panel, furnace to coal smelter to electric smelter | `core/include/of/power.h` (new), `factory_sim.h` | launched |
| E | Enemies | pollution spread, evolution, nest spreading, attack waves, base defense | `core/include/of/enemies.h` (new) | launched |
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

## Progress log

_Lanes append a line per landed change: date, lane, what, and the number that proves it._
