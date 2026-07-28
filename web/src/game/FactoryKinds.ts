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
 * FS-57: THE ASSEMBLER IS 8 m, WHICH IS TWO STRUCTURAL MODULES ACROSS, AND
 * EVERY OTHER MACHINE IN THIS TABLE IS NOW INCONSISTENT WITH IT.
 *
 * Reid, on Satisfactory: "they're pretty big and they have slots for the inputs
 * and slots for the outputs that fit the belts and the belts snap to." The
 * measured reference is a Satisfactory foundation at 8 m, a Constructor at
 * 8 x 10 m and an Assembler at roughly 2 x 2 of those tiles. Our structural
 * module is 4 m (DW-32), so metre for metre this 8 m assembler is Satisfactory's
 * CONSTRUCTOR, and its Assembler would be about 16 m. It is not a Constructor
 * that is wanted, so the honest statement of what shipped is: the assembler is
 * now four times the smelter in each axis and still half the size its reference
 * is, and the smelter (2 m), the drill (2 m) and the belt tile (1 m) did NOT
 * move in this pass. A machine set at two different scales is visible from the
 * first screenshot, which is the right way for this to be carried: rescaling the
 * shipped machines re-baselines `beltsnap`, `machineports`, `shortline`,
 * `autoline` and `coalsmelt` together and is its own pass.
 *
 * WHY EIGHT AND NOT ANY OTHER NUMBER, and this half is not taste. Machines snap
 * on a 1 m site grid, and `FactorySnap.stepsFor` steps a new part
 * `ceil((fpA + fpB) / 2)` cells away. An EVEN footprint leaves exactly the same
 * half-cell residual FS-26 named and `PORT_MATE_M` (0.65 m) was derived against:
 * belt to assembler is `ceil(9/2)` = 5 cells = 5.010 m on the shipped world,
 * less the belt's 0.500 m outlet offset and the assembler's 4.000 m inlet
 * offset, which is 0.510 m, against the smelter's 0.500 m. An ODD footprint
 * would land the pair on the other side of the rounding and change the bound
 * for every machine. So the assembler may grow to any even module count without
 * touching the port model, and 16 m is a one-constant change here plus the same
 * constant in `build_assembler.py`, once the rest of the set moves with it.
 */
export const FOOTPRINT: Record<BuildKind, number> = {
  miner: 2, belt: 1, smelter: 2, generator: 2, pole: 1, esmelter: 2,
  assembler: 8,
  // FS-68 took `box.glb` from 1.00 m to 4.00 m, so this is 4 and NOT 1. It must
  // equal the asset's `footprint_cells` or `socketReachM` under-reaches its own
  // sockets and `stepsFor` mates it at the wrong distance, both silently. Even,
  // for the reason the assembler's 8 is even.
  chest: 4,
};

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
