# Enemies, Pollution & Base Defense — Controller Context

> **Domain owner:** core-engine-controller (lane E of [ROADMAP-W11](../web/ROADMAP-W11.md)) · **Reports to:** Admin · **Status:** **core model SHIPPED and green** (`enemies_tests`, 248 checks, 28/28 ctest suites) · **Last updated:** 2026-07-27
> Read alongside: [ROADMAP-W11](../web/ROADMAP-W11.md) · [DECISIONS](../web/DECISIONS.md) · [core-engine](core-engine.md) · [factory-sim](factory-sim.md)
> Code: [`core/include/of/enemies.h`](../../core/include/of/enemies.h) · [`core/tests/test_enemies.cpp`](../../core/tests/test_enemies.cpp)

## 1. Mission

Build the **feedback loop**, not a monster list. Reid's brief:

> Eventually i want a more factorio like enemy experience, unlike satisfactory where you only encounter enemies if you go explore, in factorio they come to you based on pollution spreading, and there is a whole evolution system and spreading system. I dont want to do it exactly like factorio but I do want that to be the inspiration. The base defense aspect is part of what makes factorio so fun.

The thing that makes Factorio's base defense fun is that **the threat is caused by the player's own success** and is therefore legible and controllable. Every design call below is measured against that. A wave timer would satisfy the word "enemies" and miss the entire point, which is why the negative control (§7) is the load-bearing test in the suite.

## 2. Scope

**Owned:** the pollution field (production, diffusion, decay, attribution), nests (absorption, attack budget, expansion), the evolution factor and its accounting, the enemy-type catalogue as data, attack-wave composition and dispatch, the reports a UI needs, determinism, and persistence.

**Explicitly NOT owned, and deliberately left for other lanes:** pathfinding, movement, combat resolution against structures, damage to buildings, turrets, weapons, enemy AI state machines, and everything rendered. `enemies.h` publishes an `AttackWave` with an origin, a target and a roster, and stops. See §6 for the exact handoff.

## 3. Key design decisions

| # | Decision | Rationale | Status | Date |
|---|----------|-----------|--------|------|
| EN-1 | **Pollution is a sparse coarse grid over the surface, ticked at 1 Hz, with cost O(active cells) and explicitly NOT O(machines).** Cells that fall under `pruneEpsilon` are dropped, so the cloud has a hard, tunable bound. | The factory sim already collapses 100k entities to tens of draw calls and DW-28 found the triangle budget binding near 1,180 machines. A field that costs per machine per tick would not survive that. **Measured: 1,200 machines cost 10.06 us/sim-tick; doubling to 2,400 machines in the same footprint cost 1.28x, not 2x**, because a thousand machines in one 146 m cell are one cell. | **Accepted** | 2026-07-27 |
| EN-2 | **The cell lattice bins the RAW gnomonic cube-face coordinate, not cubed_sphere.h's equal-angle `tan()` warp.** The whole module is transcendental-free: only `+ - * / sqrt fabs floor`. | CE-11 / DW-14 / DW-15 make `tan/asin/atan2/cos` a named cross-toolchain hazard (1 ULP between mingw libm and emscripten musl), and DW-15 is a hard gate before any native peer. Adding a fifth transcendental to the determinism path for a *spatial index* would be paying that debt for nothing. **The price is measured, not waved at: a cell at a cube-face corner is 69.066 m against 146.484 m at the face centre, a 2.1209x ratio** (analytic limit 3/sqrt2 = 2.1213). A pollution grid does not need equal-area cells; it needs to be identical on every machine. | **Accepted** | 2026-07-27 |
| EN-3 | **Diffusion is the SCATTER form, not the gather form.** Each cell hands `D * amount` to each of 4 neighbours and keeps the rest, then everything decays. | Away from a cube seam the two forms are algebraically identical. At a seam they are not: the neighbour relation found by geometric stepping is not guaranteed symmetric, and the gather form would leak or duplicate mass there. Scatter conserves mass **exactly** regardless, because every unit removed is given somewhere. This also removes the need for a 6-face adjacency table with edge rotations, which is ~60 lines of the most bug-prone code in any cube-sphere codebase. **Measured: a cloud straddling a face seam over 25 ticks conserves mass to the closed form 777.821359399 across two faces (676 + 625 cells).** | **Accepted** | 2026-07-27 |
| EN-4 | **The evolution pollution term is driven by pollution ABSORBED BY NESTS, not pollution PRODUCED.** All three of Factorio's inputs are kept (time, pollution, nests destroyed); only the pollution one is redefined. | This is the legibility requirement made mechanical. Producing pollution that never reaches a nest evolves nothing, so distance, decay and clearing the nests that are eating your cloud all become **real, visible mitigations**, and "why is my evolution rising" always has an answer that points at a specific nest rather than at a global counter. **Tested as a hard zero: a 2,000/s base with no nest anywhere leaves `fromPollution` exactly 0.0 after 600 s.** Factorio uses produced because its own absorption depends on chunk generation; we do not have that constraint. | **Accepted** | 2026-07-27 |
| EN-5 | **Evolution is saturating and EXACTLY decomposed.** `delta_x = factor_x * input_x * (1-e)^2` per term, and `factor` is re-summed from the three stored terms every tick so `factor == fromTime + fromPollution + fromKills` holds **bit-exactly**, forever. A per-step cap of half the remaining headroom keeps `factor < 1` by construction. | "An opaque difficulty curve is the failure mode here." A UI that shows a breakdown must be showing a decomposition, not an estimate, or a player will do the arithmetic and find it does not add up. Re-summing costs one add per tick and makes the identity a checked property rather than an aspiration. **Tested over 400 blocks: 0 monotonicity violations, 0 decomposition breaks.** | **Accepted** | 2026-07-27 |
| EN-6 | **Pollution carries ATTRIBUTION: each cell tracks its single largest contributing emitter and that emitter's share, and a nest keeps a decaying top-8 table of who fed it. A wave is dispatched AT the top contributor.** This is a plurality *estimate*, named as such, not an exact per-source decomposition. | "An attack arrives at the part of the base that caused it" is the requirement, and it is what makes the loop teachable: the attack points at the thing to fix. An exact decomposition would need one field per source, which is O(sources x cells) and unaffordable. The estimate costs 12 extra bytes per cell. **Tested against the heuristic it must beat: with the strong emitter 3.5 km away on the far side and a weak one 1.5 km away, the wave still goes for the far one (5/s vs 220/s), and the mirror case resolves the other way, so it is not passing by always answering the same id.** | **Accepted** | 2026-07-27 |
| EN-7 | **Nest expansion steps along a CHORD, not a great circle, and picks from 8 fixed compass bearings biased toward pollution.** | A great-circle step needs `sin`/`cos` (see EN-2). At 900 m on a 600 km body the chord differs from the arc by about 3 mm, which is four orders of magnitude below the 146 m cell. Biasing toward pollution rather than randomly is what makes the frontier **advance on the player** instead of diffusing away, which is the requirement that cleared ground does not stay cleared. **Measured: a nest seeded 2,968 m from the base put its nearest child at 1,270 m within 20 simulated minutes.** With no pollution anywhere the bearing falls back to a seeded hash, so the frontier still creeps and never becomes "always east". | **Accepted** | 2026-07-27 |
| EN-8 | **`factory_sim.h` is NOT edited. The production hook is published as three calls plus a data table** (`enemies.h` §11: `addEmitter` / `setEmitterActive` / `setEmitterRate`, and `pollutionRateForMachine(typeId)`). Neither header includes the other. | The factory lane owns `factory_sim.h` tonight (lane D), and a published interface is the correct answer to a locked file rather than a reason to stall. It is also the better design independently: the wiring belongs in whatever composes the two, exactly as `automation.h` composes `factory_sim.h` today. **This is a DEPENDENCY on the factory lane, recorded in §8.** | **Accepted** | 2026-07-27 |
| EN-9 | **Everything persists, including the id counters, and it serialises through a TEMPLATED byte cursor rather than by adding a `DomainId` to `persistence.h`.** | DW-17 puts the whole world in one atomic save and "a world that forgets its evolution factor on reload is broken". Templating on the cursor is the `voxel_terrain.h` precedent and means the enemies domain can be saved today without a `persistence.h` schema bump, which is another lane's file and another lane's version number. The id counters are in the save because reusing an `EmitterId` after a reload would silently mis-attribute a wave. **Tested: 68,242 bytes round-trip to a bit-identical `stateHash`, and both copies stay bit-identical after another 400 s of stepping.** | **Accepted** | 2026-07-27 |
| EN-10 | **All balance lives in one `EnemyTuning` struct plus the `EnemyCatalogue` rows. No simulation code reads a number that is not in one of those two places.** The catalogue follows gameplay.h §A.2 exactly: a curated array in a registry object, append-only, ids never reused. | "Make it tunable from data, the way `gameplay.h` authors recipes, so balance is a table rather than a code change." The shipped numbers are **first-pass and explicitly playtest-provisional** (§5). | **Accepted** | 2026-07-27 |

## 4. The loop, in one tick

`EnemySim::step()` is one 60 UPS sim tick. The expensive work runs once per `pollutionTickInterval` (default 60, so 1 Hz); every other tick costs one modulo. Order inside the slow tick is fixed and **is** the loop:

```
emit      each active emitter deposits rate * dt into its cell, tagged with its id
diffuse   scatter D*amount to 4 neighbours, keep the rest, decay, prune
absorb    each live nest takes up to nestAbsorptionPerSecond*dt from ITS cell,
          credits its attack budget, its expansion budget, and its source table
evolve    time + absorbed + kills, each scaled by (1-e)^2, each accounted separately
dispatch  a nest over threshold and off cooldown spends its budget on a roster
          gated by evolution, aimed at its top contributing emitter
expand    a nest over its expansion cost picks the most-polluted of 8 bearings
          at 900 m and seeds a child one generation deeper
```

## 5. Shipped tuning, and what each number does

Every value below is in `EnemyTuning` or an `EnemyTypeDef` row and is a one-line edit.

| Knob | Value | What it controls |
|---|---|---|
| `cellTargetM` | 200 | Resolves to **2^13 cells/face on Forge = 146.484375 m**, 2^11 on Cinder = 195.3125 m |
| `pollutionTickInterval` | 60 | 1 Hz. **The single biggest cost lever: cost divides by it** |
| `diffusionRate` / `decayRate` | 0.15 / 0.0025 | Cloud e-folding radius `L = cell * sqrt(D/decay)` = **1,135 m**, half-life 277 s |
| `pruneEpsilon` | 0.05 | The hard bound on active cells, and therefore on cost |
| `nestAbsorptionPerSecond` | 8.0 | A design lever, not just balance: a low ceiling means a heavy cloud is **not** eaten by the nearest nest, so it spreads and angers more nests instead of one nest becoming infinitely angry |
| `attackThresholdPollution` / `attackCooldownTicks` | 500 / 3600 | A nest eating at full rate attacks about once a minute |
| `maxWaveSize` | 100 | A **ceiling that protects the combat lane**, not a balance dial. Wave size should be set by budget right up until this bites |
| `evoTimeFactorPerSecond` | 2.4e-4 | Time alone reaches evolution 0.5 in about 69 minutes (Factorio's own pacing) |
| `evoPollutionFactorPerUnit` | 1.2e-5 | Set so that a base genuinely polluting into nests dominates the time term |
| `evoKillFactorPerNest` | 2.0e-3 | Factorio's `destroy_factor` |
| `expansionCost` / `expansionCooldownTicks` / `expansionDistanceM` | 1200 / 10800 / 900 | The frontier's speed and step |

Roster (`EnemyCatalogue`, ids 0x01..0x05), gated by three evolution knobs each so the roster **rotates** rather than only growing:

| id | name | unlocks | cost | hp | dps | speed | reach |
|---|---|---|---|---|---|---|---|
| 0x01 | Skitterer | 0.00 | 10 | 15 | 7 | 6.0 | 1.5 |
| 0x02 | Ravager | 0.20 | 30 | 75 | 18 | 5.0 | 2.0 |
| 0x03 | Lancer | 0.30 | 55 | 60 | 24 | 4.4 | **12.0 (ranged)** |
| 0x04 | Sunderer | 0.50 | 90 | 350 | 45 | 4.2 | 2.5 |
| 0x05 | Colossus | 0.80 | 300 | 1600 | 120 | 3.4 | 4.0 |

Machine pollution (§11 of the header), keyed by `gameplay.h` `EntityDef::typeId`: Generator 6.0/s, Smelter 2.0/s, Assembler 1.5/s, Miner 1.0/s, Belt/Box/Pole 0.0/s. **Power generation is deliberately the dominant polluter**, so "build more power" is the decision that brings the enemies, exactly as in Factorio, and a big logistics network is free of aggro.

## 6. Interfaces published

### To the combat / AI lane (the handoff, and where this file stops)
- `struct AttackWave` — `originDir` (the nest), `targetDir` + `targetEmitter` (what it is coming for), `members` (typeId + count), `totalCount`, `totalHealth`, `totalDamagePerSecond`, `slowestSpeedMps`, `pollutionSpent`, `evolutionAtDispatch`, `dispatchTick`.
- `EnemySim::pendingWaves()` / `drainWaves()`.
- `EnemyCatalogue::type(id)` for per-enemy `health` / `damagePerSecond` / `speedMps` / `reachM`.
- Reported back the other way: `damageNest(NestId, double)` returns true on the killing blow, `destroyNest(NestId)`. Both feed the evolution kill term, and both are idempotent against an already-dead nest.

### To the renderer
- `EnemySim::nests()` — `dir`, `generation` (pick a mesh tier), `health` / `maxHealth`.
- `EnemySim::field().cells()` — key, amount, dominant source; plus `cellCentreDir(key)` and `cellSizeAtFaceCentreM()` for a pollution overlay.
- Positions are **unit directions from the body centre**. A world position is `dir * surface_field.h::surfaceRadius(...)`. This module never answers "where is the ground" (standing rule 1) and never touches the voxel layer.

### To the UI (the legibility contract)
- `PollutionReport` — `producedPerSecond`, `totalInField`, `absorbedPerSecond`, `activeCells`, `visibleCells`, `extentM`, `centroidDir`, `absorbingNests`, `cellSizeM`.
- `threatReport()` — per nest, sorted most-imminent-first: `absorbedLifetime`, `attackBudget`, `fractionOfAttackThreshold`, `angriestAt` (the emitter), `distanceToTargetM`.
- `evolution()` — `factor` with `fromTime` / `fromPollution` / `fromKills` broken out (they sum bit-exactly), plus the raw inputs.
- `nextUnlock(id, evolution)` — "at 0.20, Ravagers appear".

### From the factory lane (EN-8, the one open dependency)
Three calls at build / idle / remove, and `pollutionRateForMachine(typeId)` for the rate. Nothing else. See §8.

## 7. Verification (what is actually pinned)

`enemies_tests`, **248 checks, 0 failures, 19 s**. The five that carry weight:

1. **Diffusion pinned to hand arithmetic.** From a single 1,000-unit source at `D = 0.02`, `decay = 0.01`, the six values at distance 0/1/2/diagonal over two ticks are asserted against numbers derived on paper: `910.8`, `19.8`, `831.1248`, `36.06768`, `0.39204` (= D^2 A (1-k)^2), `0.78408` (= 2 D^2 A (1-k)^2, two paths to a diagonal), to 1e-12. None is read out of a previous run. It also asserts distance-2 is **exactly zero** after one tick, so an over-diffusing scheme fails.
2. **Mass conservation to a closed form**, `1000 * 0.99^30 = 739.700373388` over 1,861 cells, and **across a cube seam** (777.821359399 over two faces), which is where a naive neighbour table silently reflects.
3. **Evolution isolated.** Each input exercised with the other two at zero; the time term additionally checked against the continuous closed form `1/(1-f) - 1 = rate*t` (0.1259 measured vs 0.1259 predicted at 600 s); the kill term against a hand value (10 kills x 2e-3 = 0.02 exactly); monotone and bit-exactly decomposed over 400 blocks; and a double-destroy proven not to double-count.
4. **The negative control**, in three forms. (a) Six nests, thirty simulated minutes, no emitters: **0 waves, 0 absorbed, 0 field mass, while evolution provably rises to 0.3017 from its time term** so the run cannot be silently doing nothing (DW-20). (b) EN-4's zero: a 2,000/s base with no nest leaves `fromPollution` exactly 0.0. (c) The complement: a base that was being attacked and then switches its emitters off gets **0 waves in a clean 30-minute window**.
5. **Cost at a realistic size.** 30 machines: **3.81 us/sim-tick** (229 us/pollution tick), 2,173 cells. 1,200 machines (the DW-28 render limit): **10.06 us/sim-tick** (604 us/pollution tick), 5,500 cells. 2,400 machines in the same footprint: **12.86 us/sim-tick, 6,228 cells — 2.00x the machines bought 1.28x the cost and 1.13x the cells**, which is the O(cells)-not-O(machines) claim made falsifiable. At 60 UPS the big base costs **0.06% of wall clock**.

Plus: determinism (identical `stateHash` from identical ops, and a *different* seed proven to give a different hash so the equality is not vacuous), persistence round-trip and resume, targeting against a nearest-emitter heuristic that would answer differently, the expansion frontier advancing 2,968 m -> 1,270 m, `maxNests` refusing **loudly** (DW-28), and the lattice's 2.1209x corner-to-centre ratio measured against its 3/sqrt2 analytic limit.

One finding worth recording, because it was discovered by the test rather than designed: **10.01x the absorbed pollution bought 4.69x the enemies but 12.99x the total hit points.** Head count grows sub-linearly because higher evolution shifts the roster onto costlier types. Extra pollution buys quality as well as quantity, which is the intended shape, and the test now asserts on hit points rather than head count because that is the number a defender actually faces.

## 8. Open questions, risks, dependencies

- **DEP-1 (factory lane, EN-8).** Nothing emits pollution until `factory_sim.h` calls `addEmitter`. Three calls, listed in header §11. Until then a caller drives emitters directly, which is how the tests do it. **This is the one thing standing between the model and the loop being live in game.**
- **DEP-2 (combat lane).** Waves accumulate in `pendingWaves()` until someone drains them. Nothing moves, fights or dies. `damageNest`/`destroyNest` exist and are tested but nothing calls them.
- **DEP-3 (world-gen).** Nests are placed by the caller. Seeded initial nest placement (a deterministic scatter that avoids the spawn area, biased by biome) belongs to world-gen and does not exist. Suggested shape: `GenerateNests(body, bodySeed, exclusionAroundSpawn)` mirroring `GenerateDeposits`.
- **RISK-1 (balance).** Every number in §5 is first-pass and derived from Factorio's pacing plus arithmetic, not from play. The tuning struct exists precisely so this is cheap to fix. The specific number most likely to be wrong is `nestAbsorptionPerSecond`, because it sets both attack cadence **and** how far the cloud spreads, and those two want different values.
- **RISK-2 (attribution).** EN-6's plurality rule is an estimate. It resolves correctly in every case tested including the adversarial ones, but with three or more comparable sources feeding one nest it will pick a plurality winner rather than a majority one. If per-source targeting ever needs to be exact, the fix is a top-K per cell rather than a top-1, at 4x the per-cell memory.
- **RISK-3 (WASM).** Not yet exposed through the C ABI. When it is, note that this module is transcendental-free (EN-2) and so should be **bit-identical cross-toolchain**, unlike world-gen. That is worth asserting in `parity.mjs` when it crosses, because it is a property that can be lost silently by one careless `std::sin`.
- **OPEN-1.** Pollution has no effect on the world other than attracting nests. Factorio's pollution also kills trees, which is a strong visual feedback channel and would pair well with lane A's foliage. Not built, deliberately out of scope tonight.
- **OPEN-2.** Nests are placed but never *seeded at a distance from the spawn*, so nothing currently guarantees a player gets a peaceful early game. That is a world-gen concern (DEP-3) but a gameplay decision, and it is the kind of thing that should be an Admin call.

## 9. Subagent delegation log

| Date | Task | Status | Outcome |
|---|---|---|---|
| 2026-07-27 | Survey `/core` authoring conventions (namespaces, data-table pattern, determinism substrate, fixed-point discipline, tick model, persistence idiom, surface-oracle surface, `-Wall -Wextra` requirements) before writing a new header | Done | Established that content is a curated array in a registry class (not a file format), that `cubed_sphere.h` §0 `mix64`/`hashCombine`/`hashPos` is the ONLY sanctioned determinism substrate and there is no stateful RNG anywhere in `/core`, that a new module takes a fresh id block and a fresh seed salt literal, and that a domain serialises through a templated byte cursor. All followed. |
| 2026-07-27 | Adversarial review of `enemies.h` for determinism hazards, iterator invalidation, numerical invariants, integer packing and silent-clamping failure modes | Done | See §10. |

## 10. Review findings folded in

_(Populated from the 2026-07-27 adversarial review; see §9.)_

## 11. References

Header: [`core/include/of/enemies.h`](../../core/include/of/enemies.h). Tests: [`core/tests/test_enemies.cpp`](../../core/tests/test_enemies.cpp). Related decisions: DW-14/DW-15 and CE-11 (the transcendental hazard that drove EN-2), DW-17 (one atomic save, drove EN-9), DW-28 (a ceiling that reports success, drove the `maxNests` refusal counter and the 1,200-machine cost target), DW-20 (a probe must prove it ran, drove the negative control's evolution assertion), standing rule 1 (one surface authority, drove "this module answers directions, never heights") and standing rule 4 (determinism).
