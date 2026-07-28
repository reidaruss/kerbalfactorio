// WHAT CAN BE BUILT, as three tables and one union. Split out of Factory.ts
// when the ABI 9 electrical set landed and that file crossed its 400-line cap,
// along a seam that was already there: Factory owns the PLAN and its lifecycle,
// and this owns the vocabulary the plan is written in. Factory re-exports every
// name below, so no existing import moved.

import type { Quaternion, Vector3 } from 'three';

// ABI 9 adds three: `pole` and `generator` are GRID CITIZENS rather than
// factory entities (they never tick, hold nothing and have no ports, which is
// the same argument GP-21 made about a foundation), and `esmelter` is the
// powered rung of the smelting ladder.
//
// THE ELECTRIC SMELTER IS ITS OWN KIND RATHER THAN A MODE OF `smelter`, and
// that is deliberate. Making the existing smelter become electric the moment a
// pole appeared would silently turn every already-placed 60-tick free machine
// into a 30 kW consumer, which is a change to worlds and probes that never
// asked for one. A separate kind means nothing existing moves and the upgrade
// is something the player researches and then places, which is also what
// Factorio does with the electric furnace.
// FS-56 adds the ASSEMBLER, and it is the first machine whose RECIPE IS NOT A
// PROPERTY OF ITS KIND. A smelter's recipe is chosen for it at commit time from
// the ore reaching it (`smeltPairFor`); an assembler's is chosen by the PLAYER
// from a menu and carried on the plan record. That is the whole difference
// between the two machines and it is why `Placed` grows a field rather than the
// kind table growing a column: two assemblers of the same kind, side by side,
// make different things.
// FS-70 adds the CHEST, and it is the first buildable that is neither a factory
// entity that ticks nor a grid citizen. It holds ONE item type and does nothing
// else: no recipe, no progress, no power, no system of its own, because the
// inserters at both ends do all the work and a container never ticks. FS-66 gave
// /core `EntityKind::Container` for exactly this, so the storage is real rather
// than a machine whose recipe turns item X into X and reports having
// MANUFACTURED everything that passed through it.
export type BuildKind = 'miner' | 'belt' | 'smelter' | 'pole' | 'generator'
  | 'esmelter' | 'assembler' | 'chest';

/** TypeIds are ASSET-SPECS section 4's, so the stream keys the right mesh.
 *  The electric smelter reuses the smelter's art (0x12) on purpose: it is the
 *  same machine with a different power source, and ASSET-SPECS says so.
 *  The assembler is 0x13, pinned in `gameplay.h` section A's TypeId block since
 *  before the web client existed, with `machines/assembler.glb` shipped against
 *  it: nothing is minted here. */
export const TYPE_ID: Record<BuildKind, number> = {
  miner: 0x10, belt: 0x11, smelter: 0x12,
  generator: 0x15, pole: 0x16, esmelter: 0x12, assembler: 0x13,
  chest: 0x14,
};
/**
 * Footprint in whole metres (ASSET-SPECS), and the interaction bound.
 *
 * FS-73: THE MACHINE SET IS NOW ONE SCALE, AND THE SCALE IS THE STRUCTURAL
 * MODULE. The smelter, the electric smelter and the drill go 2 m to 4 m; the
 * assembler stays at 8 m and the chest at 4 m; the belt tile and the power pole
 * stay at 1 m. Every machine in the set is now a whole number of 4 m structural
 * modules (DW-32) and the two things that are not machines are a quarter of one.
 *
 * FS-57 said this plainly and deferred it: "the smelter (2 m), the drill (2 m)
 * and the belt tile (1 m) did NOT move in this pass. A machine set at two
 * different scales is visible from the first screenshot." This is that pass.
 *
 * WHY THE BELT AND THE POLE DO NOT MOVE, and it is a measured proportion rather
 * than a saving. Reid's reference is Satisfactory, where a Mk1 conveyor is about
 * 2 m wide against an 8 m foundation, which is one QUARTER of a module. Our
 * module is 4 m (DW-32), so a quarter of it is 1 m, which is exactly what the
 * belt already is. The belt never looked wrong against the reference, it looked
 * wrong against a 2 m smelter, and moving the smelter is what fixes it. The
 * belt's tile length is also the sim's unit of transport-line capacity, so
 * doubling it would silently halve item density per metre in `factory_sim.h`
 * (FS-30's invariant is stated in capacity UNITS, which know nothing about
 * metres), and that is a throughput change nobody asked for wearing the clothes
 * of an art change. A pole is a pole for the same reason a belt is a belt.
 *
 * WHY THE GENERATOR DOES NOT MOVE, DEFERRED WITH ITS REASON. `power.h` attaches
 * a generator to a network only inside a pole's 2.5 m SUPPLY RADIUS (FS-51),
 * which is a /core constant in another domain's header, measured against a 2 m
 * generator standing 3.61 m from a pole and reading `attached 0 of 1`. Taking
 * the generator to 4 m moves the housing face 1 m closer to every pole and
 * therefore changes which generators are on the grid in every existing world,
 * which is a power-model change and not an art change. It needs the power lane's
 * number, not this lane's guess. The generator is consequently the one machine
 * still at 2 m and that is said here rather than discovered later.
 *
 * WHY EVEN, AND WHY THIS IS THE ONLY SHAPE THE TABLE MAY TAKE. Machines snap on
 * a 1 m site grid and `FactorySnap.stepsFor` steps a new part
 * `ceil((fpA + fpB) / 2)` cells away. An EVEN footprint leaves exactly the
 * half-cell residual FS-26 named and `PORT_MATE_M` (0.65 m) was derived against:
 * belt to smelter is now `ceil(5/2)` = 3 cells, less the belt's 0.500 m outlet
 * offset and the smelter's 2.000 m inlet offset. An ODD footprint would land the
 * pair on the other side of the rounding and change the bound for every machine.
 *
 * AND CHANGING A NUMBER IN THIS TABLE CHANGES WORLDS THAT ALREADY EXIST. A
 * `SaveBuilding` records `pos` and carries NO footprint, so a placement saved at
 * the old size keeps its absolute position and is re-drawn at the new one. See
 * `FactoryRescale.ts`: that is not a cosmetic drift, it is a belt standing half
 * inside a housing while every indicator reads healthy, and it is why this table
 * may not be edited without the migration beside it.
 */
export const FOOTPRINT: Record<BuildKind, number> = {
  // FS-73 took `smelter.glb` and `miner.glb` from 2.00 m to 4.00 m. These must
  // equal the assets' own `footprint_cells` in `tools/blender/contracts.json` or
  // `socketReachM` under-reaches its own sockets and `stepsFor` mates the part at
  // the wrong distance, both silently.
  miner: 4, belt: 1, smelter: 4, generator: 2, pole: 1, esmelter: 4,
  assembler: 8,
  // FS-68 took `box.glb` from 1.00 m to 4.00 m, so this is 4 and NOT 1. Even,
  // for the reason the assembler's 8 is even.
  chest: 4,
};

/**
 * The smallest footprint in the table, in metres. DERIVED, and it is the datum
 * that four separate bounds used to spell as a literal.
 *
 * INSTRUMENTS.md, "a constant is a hidden assumption": a bound written against
 * today's set gets COPIED rather than derived, and the copies do not know about
 * each other. Three of the four copies this pass had to repair spelled the OLD
 * BASELINE, the 2 m machine, as the number `2`. The right datum was never 2, it
 * was "the smallest thing that stands on this grid", and that is a question the
 * table can answer for itself and will keep answering when the table changes
 * again.
 */
export function minFootprintM(): number {
  return Math.min(...Object.values(FOOTPRINT));
}

/**
 * FS-93: HOW FAR A BUILDING'S CENTRE MAY BE FROM THE EYE AND STILL BE AIMED AT,
 * given a reach specified PAST THE SURFACE.
 *
 * `PICK_REACH_PAST_SURFACE_M` (3.5 m, `GameplayAim.ts`) now states its own
 * frame, and this function is the whole of the conversion into the frame a
 * centre-based picker works in: `t` runs to a CENTRE, the surface is half a
 * footprint nearer, so the half-extent comes back on. One line, one meaning.
 *
 * THE HISTORY IS THE REASON THE NAME HAD TO CHANGE, and it is three spellings
 * deep. FS-63 wrote `Math.max(0, FOOTPRINT - 2) * 0.5`, whose `2` was the old
 * 2 m baseline; FS-74 replaced it with the excess over `minFootprintM()` when
 * that baseline moved. Both were reaches to a centre wearing a constant that
 * only made sense against the asset set of the day, which is this project's
 * most-repeated defect. The datum was never "the smallest part on the grid", it
 * was "the player is reaching for a SURFACE", and that needs no datum at all.
 *
 * WHAT MOVES, stated because a bound that changes silently is what this file is
 * about. Every kind gains exactly `minFootprintM() * 0.5` = 0.50 m of reach to
 * its centre against FS-74, INCLUDING the belt and the pole, which FS-74 held
 * bit-identical and this deliberately does not. That is the point: under the old
 * rule the minimum-size part was the one kind whose reach was measured to its
 * centre rather than to its face, silently, because the excess was zero. A belt
 * tile is now reachable from 3.5 m past its face like everything else, a 4 m
 * smelter from 5.5 m to its centre and the 8 m assembler from 7.5 m. It is a
 * LOOSENING in every case and that is the safe direction: every failure in this
 * family (FS-63, FS-74, R33's handoff) has been a reach that was too short, and
 * `pickAimed` ranks by how CENTRED the crosshair is rather than by distance, so
 * a further candidate does not steal a press from a nearer one it is not
 * pointing at. Measured in `probes/autoline.js`, `probes/shortline.js` and
 * `probes/rescale.js` rather than asserted here.
 */
export function reachToCentreM(kind: BuildKind, reachM: number): number {
  return reachM + FOOTPRINT[kind] * 0.5;
}

/**
 * FS-59: HOW FAR ONE OF THIS KIND'S SOCKETS CAN POSSIBLY BE FROM ITS OWN
 * ORIGIN, in metres, and it is DERIVED. This is the ONE definition of it.
 *
 * Two separate coarse rejects had the constant `1.6` written into them by hand,
 * each with the same comment claiming that no socket of any machine asset sits
 * further than 1.6 m from its own origin: `FactorySnap.nearestSocket`, which
 * decides whether the crosshair CATCHES a building, and `FactoryWiring`'s
 * machine-to-machine pair loop, which decides whether two machines can possibly
 * link. That claim was true of a 2 m smelter and a 3 m assembler, and FS-57's
 * 8 m assembler makes it false by two and a half times: its inlets sit 4.000 m
 * out. Both rejects would then have fired on the very geometry the player was
 * looking at, SILENTLY, one reading as a stiff crosshair and the other as a
 * drill shoved against an assembler that simply refuses to feed it.
 *
 * DW-33's rule, which this is the third instance of: a constant that encodes a
 * size is a scale assumption in disguise, and it becomes a bug the moment the
 * scale changes. So it is a function of `FOOTPRINT` and there is one of it. A
 * socket cannot be further from its origin than the half-diagonal of the
 * housing, which is `footprint * sqrt(2) / 2` = 0.707; the 0.4 on top covers a
 * hopper mouth authored slightly proud of the face, and is the only judgement
 * in the line.
 */
export function socketReachM(kind: BuildKind): number {
  return FOOTPRINT[kind] * 0.71 + 0.4;
}

/** The three the tech tree gates, and the item whose availability gates each.
 *  Read through `Research.itemAvailable`, so the answer is /core's. */
export const GATED_BY_ITEM: Partial<Record<BuildKind, number>> = {
  pole: 0x003F, generator: 0x003E, esmelter: 0x003D,
};

export interface Placed {
  id: number;
  kind: BuildKind;
  /** Body-frame metres, snapped to the 1 m lattice and put on the ground. */
  pos: { x: number; y: number; z: number };
  cell: string;
  up: Vector3;
  /** Flow direction, in the tangent plane. Belts flow along it. */
  fwd: Vector3;
  quat: Quaternion;
  /** Drill only: the ore PATCH it stands on, and what it had left last tick. */
  patch: number;
  lastRemaining: number;
  /** Filled by commit(): the /core build index, and the stream entity id. */
  build: number;
  entity: number;
  /** Poles and generators only: the PowerGrid id, which is a different id
   *  space from `build` because a pole is not a factory entity. -1 otherwise.
   *  Re-derived on every commit, exactly like `build`, because `recreate()`
   *  throws the whole network away and the grid goes with it. */
  grid: number;
  /** Generators only: fuel units, carried ACROSS a commit. Without this every
   *  belt placed anywhere in the base would empty every generator, because a
   *  commit rebuilds the network from the plan and the plan holds no coal. */
  fuel: number;
  /** Belt only: which run it joined, so the flow row can find its tiles. */
  run: number;
  /**
   * FS-56, ASSEMBLERS ONLY: the OUTPUT ITEM of the recipe the player selected,
   * or `NO_RECIPE` (0) for a machine nobody has set yet. The output item and not
   * an index into /core's recipe list: `FactoryRecipes.AssemblerRecipe.output`
   * has the argument. A PLAN field rather than something re-derived at commit
   * time, because it is the only thing about a machine that the player and
   * nothing else decides: a smelter's recipe is inferred from the ore reaching
   * it and is a function of the world, and a choice a rebuild re-derives is a
   * choice the player did not really make.
   */
  recipe: number;
  /**
   * FS-70, CHESTS ONLY: what is in it, as an ItemId and a count. `storeItem` is
   * 0 for an empty chest and for every other kind.
   *
   * CARRIED ON THE PLAN FOR THE REASON `fuel` IS, and it is not optional. The
   * container lives inside the BuildableNetwork, so `recreate()` destroys it,
   * and a commit runs on EVERY placement anywhere in the base. Without this,
   * laying one belt tile would empty every chest in the world. That is worse
   * than the generator case it copies, because a player puts things in a chest
   * on purpose: emptying it is destroying inventory they chose to store.
   *
   * The ITEM is carried and not just the count, because a container's type is
   * claimed by whatever arrives first and released when it empties, so a rebuild
   * that restored 40 units without restoring WHICH 40 would re-claim the type
   * from the next inserter to reach it.
   */
  storeItem: number;
  storeCount: number;
}
