// WHAT A LOAD ACTUALLY BROUGHT BACK, as one shape.
//
// Split out of Persist.ts, which is at its line cap, along a seam that was
// already there: that file is the ALGORITHM (what counts as state, and the order
// the pieces have to go back in) and this is the RECEIPT. Nothing here is
// executable, so nothing here can be got wrong twice.
//
// The rule every field below follows: what is NOT restored is said out loud. A
// number that is absent and a number that is zero are different claims, and a
// world that quietly forgets something is exactly what DW-17 exists to prevent.

import type { GameMode } from './GameMode.js';
import type { VoxelRestore } from './VoxelSave.js';

export interface RestoreLedger {
  buildings: number;
  /** Structural parts that came back. Their cost is NOT charged again. */
  structures: number;
  /** GP-57: launch pads brought back. */
  pads: number;
  machines: number;
  nodesDepleted: number;
  patchesDepleted: number;
  /** WG-70: world rocks drained back to their saved remaining RIGHT NOW. Rocks
   *  outside the streamed ring restore later, at the moment they materialise;
   *  `rocksPending` counts those, so "0 applied, 12 pending" and "nothing in
   *  the slot" are different receipts. */
  rocks: number;
  rocksPending: number;
  /** WG-119: the same pair for the world TREES. Kept separate from `rocks`
   *  rather than summed into a "world nodes" row, because the two lattices are
   *  independent and a receipt that added them could not say which one failed. */
  trees: number;
  treesPending: number;
  packUnits: number;
  /** Fuel a furnace was burning. There is no item to give back for a tick. */
  fuelTicksLost: number;
  /** The tunnels: cells /core has back, strikes replayed, and the re-mesh cost. */
  voxels: VoxelRestore;
  /** Whether the saved hotbar loadout came back. */
  hotbarRestored: boolean;
  /** The progression spine: techs re-unlocked, milestones re-earned, armour
   *  pieces put back on. Zero on a slot written before ABI 9. */
  progress: { techs: number; milestones: number; armour: number };
  /** DW-31: the mode the slot was written in. Always equal to the running mode,
   *  because a slot that disagreed was refused before it got here. */
  mode: GameMode;
  /** DW-36: discovery cells /core has back. 0 means the slot carried none,
   *  which a pre-DW-36 save legitimately does; **-1 means /core REFUSED the
   *  stream** and what the player explored is gone. Three states and not two,
   *  because a silent zero would make a lost world look like a new one. */
  discovery: number;
  /** GP-65. Wounds that landed on something still standing, and saved rows whose
   *  building the restore could not find. An orphan is a key scheme that has
   *  stopped being stable, counted rather than dropped: the building would
   *  otherwise come back at FULL HEALTH with every other check still green. */
  health: { applied: number; orphans: number };
  /** GP-79: whether the slot carried the player's own health. False on any
   *  world written before tonight, which restores a player at full. */
  vitals: boolean;
  savedAt: number;
}
