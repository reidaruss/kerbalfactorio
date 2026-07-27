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
export type BuildKind = 'miner' | 'belt' | 'smelter' | 'pole' | 'generator'
  | 'esmelter';

/** TypeIds are ASSET-SPECS section 4's, so the stream keys the right mesh.
 *  The electric smelter reuses the smelter's art (0x12) on purpose: it is the
 *  same machine with a different power source, and ASSET-SPECS says so. */
export const TYPE_ID: Record<BuildKind, number> = {
  miner: 0x10, belt: 0x11, smelter: 0x12,
  generator: 0x15, pole: 0x16, esmelter: 0x12,
};
/** Footprint in whole metres (ASSET-SPECS), and the interaction bound. */
export const FOOTPRINT: Record<BuildKind, number> = {
  miner: 2, belt: 1, smelter: 2, generator: 2, pole: 1, esmelter: 2,
};

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
}
