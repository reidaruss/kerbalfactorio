# D-020 Scope Report: the four Space Engineers world mechanics

Read-only opus pass over `/core`, `web/src/game`, and the controller docs, banked 2026-08-13.
Deferred behind the major art pass per Reid's ruling the same day. Premise corrections are marked **[PREMISE]**.

## 0. Cross-cutting facts that change the shape of all four

- **[PREMISE] The health system is not in `/core`.** `HealthBook` is pure TypeScript at `web/src/game/Health.ts`, with population binding in `HealthCensus.ts`. Nothing in `core/include/of/` has an hp field. Every damage consumer added to it is a port cost later under networking.md's server-authoritative mandate.
- **Destruction today is a counter, nothing more.** `EnemySwarm.ts:253` increments `buildingsDestroyed`; no code removes the part, its `Solid`, its factory row, or its mesh. A "destroyed" wall still blocks the walker at 0 hp.
- **`HealthBook.repair()` and `fracOf()` have zero callers.** Repair and damage visuals are authored and unwired.
- **A block grid already exists in embryo.** `StructureGrid.ts` defines a *site*: a metric frame anchored to one world lattice cell with two tangent axes, `Addr = {i, j, level}`, `SITE_REACH_M = 64`, `MAX_LEVEL = 3`, module constants measured off the shipped `.glb` (4.00 m cell). That is a grid minus arbitrary block kinds and minus mobility.
- **A pressurized volume also exists in embryo.** `StationGravity.ts` derives one box per deck from `col_*Floor*` proxies, finds an airlock plane from `col_Jamb*`, and treats the aft section as vented. Swap "gravity" for "atmosphere" and the geometry work is done.
- **There is no mass or volume on any item, anywhere.** `gameplay.h` `ItemStack` is `{ItemId u16, Count u16}`; `Inventory` is 20 slots gated by `stackMax`. `vessel.h` has a `CargoBay` PartDef with a dry mass and no contents model.
- **DW-12 stands: there is no physics engine.** `StructureBody.ts` `Solid` is axis-aligned boxes in a part frame, point-in-box against a kinematic walker. Anything "physical" in these four mechanics has to be expressible that way or it is a new engine.
- **The derate hook already exists.** `factory_sim.h` carries `sleeping_[]` plus an `active_[]` index list, and `power.h` publishes one Q16.16 `satisfactionQ16` per network with exactly one arithmetic definition. A damaged machine should ride that, not a second path.

---

## 1. Structural physics and damage

| | |
|---|---|
| **Builds on** | `Health.ts` (`HealthBook`, four populations, wounded-only save, `orphanRows` drift check), `HealthCensus.ts` (derived reconcile, `audit`), `enemies.h` damage catalogue, `Demolition.ts` (removal + refund ledger already exists per population), `StructureBody.ts` (`Solid` set the walker reads). |
| **Requires** | Destruction *consequence* (remove part, drop `Solid`, drop factory row); a damage state material channel; a repair verb spending `HandCrafter::payInputs`; a per-entity condition multiplier folded into `satisfactionQ16`; for real collapse, a support graph over `Addr`. |
| **ABI / save / net** | Port to `/core` as `of_hl_*` over a keyed book (the key scheme in `Health.ts` already survives reload). Save shape is unchanged in kind: wounded-only rows. Server authority is mandatory the moment damage gates production. |
| **Render load** | Near zero for tint (per-part uniform on an existing channel). Real geometry damage states are an art cost, not an engine cost. |

**Tension to rule now:** does a damaged assembler tick? Recommendation: yes, derated, using `satisfactionQ16` (one arithmetic definition, brownout already legible to the player), and `sleep()` below a condition floor. Inventing a second scaling factor recreates the "two authorities for one quantity" defect this project paid for six times in a week.

---

## 2. Block / grid construction

| | |
|---|---|
| **Builds on** | `StructureGrid.ts` (site frame, `Addr`, measured module), `StructurePlacement.ts`/`StructureSnap.ts` (socket-driven snapping, ghost validity), `gameplay.h` `StructureDef` + `structureDefs()` (block catalogue as data, in core, with costs), `StructureSave.ts` (rebuilds keys rather than reading them back). |
| **Requires** | A generalised block catalogue (kind, footprint in cells, sockets, mass) in `/core`; grid identity (a grid is a thing with a pose, not just a site anchor); mass properties summed from blocks; for mobile grids, thrust and torque from thruster blocks feeding `flight.h`; a grid save row; instanced/merged rendering per grid. |
| **ABI / save / net** | This is the largest ABI surface of the four. A grid is authoritative state and belongs in `/core` from day one, unlike structures today, which are client-owned. |
| **Render load** | The real risk. 4 m modules keep counts sane; 1 m Space Engineers blocks do not. A 20 x 20 x 4 m hab is 25 blocks today and would be 1,600 at a 1 m module. Greedy per-grid merge is not optional at SE granularity. |

**Tension to rule now (the sharpest in this report): grid versus D-015 and `vessel.h`.** `vessel.h` is a part *tree* (`PartInstance.parent`, `Attach::StackTop/Bottom/Radial`, `layout()` computing `originM`/`centroidM`, `Stage` groups). A grid is a *lattice*. They are not the same data structure and one cannot be expressed in the other without loss: stage groups and radial attach have no lattice meaning, and a lattice's arbitrary connectivity has no tree parent. D-015's ruling ("a vessel can dock if its design contains a port") is a property of the *catalogue*, not of the tree, so it survives either way if a grid can publish a part list. Recommendation in §7, Q1.

---

## 3. Pressurization and life support

| | |
|---|---|
| **Builds on** | `StationGravity.ts` (per-deck volumes from proxies, `airlockPlaneM`, vented aft section, the 0.3 m boundary-fringe lesson), `PlayerHealth.ts`/`PlayerVitals.ts` (`HurtSource` list is already the seam for suffocation), `atmosphere.h` (Forge's scale-height profile, Cinder airless), `voxel_field.h` (a trilinear SDF that already answers "is this point inside solid"). |
| **Requires** | Volume detection, an O2 pool per volume, leak rate on breach, suit O2 on the player, O2 production as a factory recipe, airlock state. |
| **ABI / save / net** | Small: a volume id, a pressure scalar, a suit scalar. Save is a handful of floats. |
| **Render load** | Nil, apart from a fog/particle vent effect. |

**Tension to rule now: volume detection versus the glTF collision proxies.** The proxies are deliberately *open* sets. `StructureBody.ts` says so in as many words: the door is three boxes leaving a 0.76 x 2.10 m opening genuinely open, and the leaf box exists only while shut. Analytic box CSG cannot find a sealed volume from an open box soup, and the failure is silent (a hab reads sealed because the boxes happened to touch). Recommendation: rasterise the same proxies into a coarse occupancy grid (0.5 m, seeded at the player, capped at a cell budget) and flood fill it. That is one shared substrate, and structural connectivity in §1 wants the identical raster. Do not write two.

---

## 4. Physical resource logistics

| | |
|---|---|
| **Builds on** | `gameplay.h` `ItemDef`/`SliceRegistry` (`stackMax` is the row a mass column joins), `Inventory`, `factory_sim.h` belts (`kItemSpacing` 64 against `kUnitsPerTile` 256, four items per tile saturated), `BeltCargo.ts` (per-item meshes, socket-driven, LOD0 capped), `vessel.h` `MassProperties` and the unused `CargoBay`. |
| **Requires** | A mass and volume column per item; inventory capacity by mass/volume; cargo contents on `CargoBay` folded into `MassProperties` so a loaded rocket flies worse; belt throughput by mass; conveyor tiers. Inertia on cargo is not separable from grid physics and belongs to §2. |
| **ABI / save / net** | Mass/volume is authored data in `/core`, free to add. Inventory-by-mass touches every UI drawing 20 slots, which is the actual cost. |
| **Render load** | None new. |

**Tension:** belts versus conveyors is a false one. The SoA belt already carries typed items with a fixed spacing; "mass" is a throughput coefficient over the same rows, not a new transport system.

---

## 5. The DAG, in lane-weeks

Shared foundations (each feeds two or more mechanics, so cutting these is where parallelism is won):

- **F1 Port the health book to `/core`** behind `of_hl_*`, keys unchanged, wounded-only save. **2.0**. No dependencies. Blocks: D4, D5, all MP.
- **F2 Mass and volume columns on `ItemDef`**, authored, no consumers. **0.5**. No dependencies. Blocks: L2, L3, L4, G3.
- **F3 Coarse occupancy raster from the `Solid` proxy set**, seeded and capped, with a flood fill. **1.5**. No dependencies. Blocks: P2, D5.

Structural damage: **D1** destruction consequence, remove part + `Solid` + factory row, leave a rubble prop **1.0**, independent. **D2** damage-state tint driven by `fracOf` **1.0** (art-gated), independent. **D3** repair verb spending `payInputs` **1.0**, after D1. **D4** condition folded into `satisfactionQ16` + sleep floor **1.5**, after F1. **D5** support graph over `Addr` and collapse cascade **3.0**, after F3 + D1.

Grids: **G1** generalised block catalogue in `gameplay.h` **2.0**, independent. **G2** grid identity, pose, frame **3.0**, after G1. **G3** mobile grids: mass, thrust, torque into `flight.h` **4.0**, after G2 + F2 + Q1. **G4** grid save and replication shape **2.0**, after G2. **G5** per-grid greedy merge and instancing **3.0**, after G1.

Pressurization: **P1** one hand-authored sealed volume plus a suit meter on `PlayerHealth` **1.5**, independent (reuses `StationGravity`'s geometry wholesale). **P2** automatic detection by flood fill **3.0**, after F3. **P3** breach depressurisation **1.5**, after P2 + D1. **P4** O2 as factory recipes and tanks **2.0**, after P2. **P5** airless-body suit rules on Cinder and in orbit **1.0**, after P1.

Logistics: **L2** inventory by mass/volume **1.5**, after F2, and the UI sweep is most of it. **L3** cargo mass into `MassProperties` **1.5**, after F2. **L4** belt throughput by mass and conveyor tiers **1.0**, after F2.

**Critical path** if all four are pursued: G1 to G2 to G3 is 9.0 lane-weeks and no number of agents shortens it. Independent starts available immediately: F1, F2, F3, D1, D2, G1, P1. That is seven parallel nodes, so `p` is high early and collapses once the grid chain dominates.

**Cheapest honest first slice of each:** damage = D1 (a destroyed building actually falls down); grid = G1 (block catalogue as data, no new runtime); pressurization = P1 (one volume, the station's, using the boxes already derived); logistics = F2 (the mass column, authored, unconsumed).

---

## 6. What can slot pre-pre-alpha, and what cannot

**Slot now: D1 only.** It is 1.0 lane-week, it needs no new state, no new save shape, no `/core` change, and it closes an *existing* incoherence rather than adding scope: enemies already destroy buildings that then keep standing and keep blocking the walker. Enemies are met at the ruins, which is on the pre-alpha line, so this is a line defect wearing a D-020 hat.

**Arguably slot: F2.** 0.5 lane-week of authored data with no consumers. Honest caveat: a column nobody reads is the "authored and not yet instanced" pattern `VESSEL_HEALTH` already demonstrates, and that has sat unwired since it was written. Only take it if a lane is already editing `ItemDef` for another reason.

**Everything else waits.** D2 depends on an art pass, so doing it now bakes judgements under a light that is about to change. F1 is real work with no visible payoff until MP or D4. G1 through G5 and P2 through P4 are new subsystems by any honest accounting.

---

## 7. Decisions Reid must make before anyone builds

**Q1. Is a grid a new population, or does it replace `vessel.h` designs?**
(a) Replace: grids everywhere, retire the part tree. (b) Complement: grids are a third population that can publish a part list, so D-015 docking works on both. (c) Split by domain: grids for bases and stations, part trees stay for rockets.
**Recommend (c) now, revisit (b) at the pre-alpha gate.** `vessel.h` is 1,430 lines carrying staging, Barrowman aero, gimbal and `MassProperties`, all of which assume a tree; a lattice cannot express a stage group. (a) throws away the one system that has flown a mission. (c) is free: `StructureGrid` already *is* the base grid, and D-015 stays intact because docking is a catalogue property.

**Q2. Where does damage live?**
(a) Stay in TypeScript. (b) Port to `/core` now, before any consumer beyond visuals. (c) Port when multiplayer starts.
**Recommend (b).** Every consumer added to the client book is a port cost, and networking.md's mandate binds from day one even though implementation is late. Cost is 2.0 lane-weeks and it is not urgent, so the ruling is really "no new damage consumer lands client-side".

**Q3. Does pressurization apply on Forge, or only on airless bodies and in orbit?**
(a) Everywhere, including a sealed hab on the starting planet. (b) Airless only: Cinder, orbit, EVA.
**Recommend (b).** Forge has an atmosphere in `atmosphere.h` and a breathable surface, so (a) adds a survival system to the pre-alpha line that Reid explicitly did not ask to change. (b) makes the moon colony, already the first post-pre-alpha item in the storyline, the payoff for the whole mechanic.

**Q4. Does inventory become mass/volume?**
(a) Full Space Engineers: mass and volume, no slots. (b) Keep 20 slots, add a mass budget that affects walk speed and vessel performance only. (c) No.
**Recommend (b).** (a) is a UI sweep across every panel that draws a slot grid, for a benefit a mass budget already delivers, and it collides with `Inventory`'s `uint16` slot model in `/core`.

**Q5. Do damaged buildings collapse, or just vanish?**
(a) Vanish at 0 hp. (b) Support graph over `Addr` with a collapse cascade. (c) Vanish, plus a rubble prop and a repairable wreck state.
**Recommend (c) now, (b) alongside grids.** (b) needs F3 plus D1 and is 3.0 lane-weeks of new simulation; (c) is inside D1's 1.0 and delivers most of the felt consequence.

---

### Critical files
- `web/src/game/Health.ts`
- `web/src/game/StructureGrid.ts`
- `web/src/game/StationGravity.ts`
- `core/include/of/gameplay.h`
- `core/include/of/vessel.h`
