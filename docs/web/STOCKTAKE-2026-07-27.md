# Stock-take, 2026-07-27 evening

Written on a model change (Opus to Fable), at Reid's request, as a fresh-eyes
review of state, goals, in-flight work and gaps. Findings that changed how we
work are marked ADOPTED; the rest are queued as tasks.

## Where the project actually is

The game is real. A player can: walk a procedural planet, harvest, craft, dig
smooth tunnels, terraform, build 4 m bases with snapping and cantilevers, run
drill-belt-smelter lines with visible cargo, research technologies with science
made in their own factory, manage a power grid with proportional brownout,
build a rocket in an assembly bay, fly it to orbit by hand on a navball, plan
burns with maneuver nodes on an orbital map, and come home. It saves. Gates:
31 ctest suites, determinism 126/126, cross-toolchain 108/108, ~190 client
files under a 400-line cap, a probe suite that drives real input.

## In flight right now (four lanes, tight file fences)

| Lane | Doing | Owns |
|---|---|---|
| Post-processing | AO, AA, bloom, grading | `web/src/render` (minus PropLibrary), `Config.ts` toggles |
| Map expansion | player-centred zoom continuum, discovery, ore counts | `web/src/ui`, `web/src/world`, MapMode |
| Texture wiring | make the shipped PBR maps actually sample | `MachineBatch`, `NodeBatch`, `PropLibrary` |
| Launch pad | placeable pad, research gate, rollout on the mount, clamps | `web/src/game`, `FlightMode`, `FlightSession`, `web/wasm` |

## Fresh-eyes findings

**F1 (ADOPTED). The shared-index sweeps have a structural fix we never used.**
Standing rule 10 exists because parallel lanes corrupted commit attribution
FIVE times in three days, and it has been sharpened twice, and it still
happened again today (the pad lane's renders). The Agent harness supports
worktree isolation: each lane gets its own checkout and its own index, and the
entire failure class disappears instead of being deterred by convention. Cost
is a merge step per lane. From now on, parallel lanes that WRITE run in
worktrees by default; the convention stays only for quick single-file fixes in
the main tree. A rule that has to be restated five times is not a rule, it is
a missing mechanism.

**F2. The delivery pipeline lags the build pipeline by about one system.**
A recurring shape, now with a name: capability lands green in `/core` and sits
invisible until someone trips over its absence. Research sat unwired since
June. Enemies (pollution, evolution, nests, waves, 525 checks, 8 us/tick) is
COMPLETE and no machine emits a gram of pollution, so the entire system might
as well not exist. Armour is invisible in first person. The parachute cannot
deploy. Combat does not exist at any layer. The reachability write-up (GP-56)
diagnosed this and its recommendation is not yet a gate. Consequence: new core
systems should land WITH their first visible consumer, or be explicitly
tracked as undelivered inventory.

**F3. The persistence story has an ironic hole at its centre.** This project
is proud of its save discipline: one atomic slot, seed+diff, tunnels survive
reloads, depletion survives, research survives, armour survives. And yet THE
PLAYER'S OWN POSITION IS NOT SAVED (a reload teleports you to spawn from
anywhere), and a vessel in flight cannot be serialised (the save is refused
aboard, honestly, but still refused; needs a propellant setter across the
bridge). The two least-persisted objects in the world are the player and the
rocket. Both are known items; neither has been top of any queue. They should
be next after the current lanes land, as one persistence pass.

**F4. Nobody has played the game the way the game is meant to be played.**
Every end-to-end proof runs in sandbox. The economy has been retuned piecemeal
(structure prices 10x/4x, belt capacity 40x, drill rates, pad costs incoming)
and no probe has ever answered: can a fresh SURVIVAL world reach orbit at all,
and how long does it take, and where does it stall? A survival full-loop probe
(spawn to orbit, no sandbox, asserting each economic gate is passable) would be
the true acceptance of the whole design and would catch balance deadlocks the
way rendering the belt cargo caught the one-item belt. Queued as the highest
new item.

**F5. Small honest debts, recorded so they stop being surprises:** mute lives
on Backslash as a self-described holding pen; science packs render as text
because no mesh ships; WaterPool and OilSeep have no ART entry; the FP rig has
no armour (A-11); ARCHITECTURE 15.2 numbering has collided twice; the 7 s cold
start remains unexplained; W8 wave 3 (autopilot as a research unlock,
rendezvous, docking) is designed, gated, and unstarted.

## What this changes right now

1. Two new lanes launch immediately, in the only free territory (`/core` and
   the smoke harness): **enemies integration** (machines emit pollution, the
   loop becomes real, first visible consumer planned with it) and the
   **boot-plus-survival gate** (the app-starts check from task 114, plus the
   F4 survival probe's first cut).
2. Worktree isolation becomes the default for writing lanes (F1).
3. After the current four lanes land: the persistence pass (F3), then W8
   wave 3 on the research gate that now exists for it.
