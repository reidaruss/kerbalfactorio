// WHAT THE PLAYER BUILT, as the walker sees it.
//
// Split out of VoxelCollision.ts, which had grown past its cap and was carrying
// two unrelated things: boxes on a 1 m LATTICE, where every contact normal is a
// body-frame axis and every resolution is therefore exact, and boxes in
// ROTATED frames, where none of that is true. They are different geometry and
// they belong in different files. The values and the wording below are
// unchanged by the move.

import type { Vec3d } from '../world/PlanetBody.js';
import type { StepResult } from './VoxelCollision.js';

/**
 * A set of PLACED SOLIDS the walker also has to respect: today the base
 * building parts, implemented by `game/StructureBody.ts`.
 *
 * It is an interface here rather than an import because a structure is not
 * terrain and must not become a second definition of it. Rock stays the
 * oracle's answer and nothing on this port touches it (standing rule 1); these
 * are boxes RESTING on the ground, which is exactly DW-24's model, and the
 * walker composes the two answers instead of merging them.
 */
export interface SolidBodies {
  readonly count: number;
  tests: number;
  resetTests(): void;
  blocks(x: number, y: number, z: number): boolean;
  /** The highest structural TOP FACE along a radial: `searchM` below the feet,
   *  or up to `riseM` above them. See `StructureBodies.deckUnder`. */
  deckUnder(dx: number, dy: number, dz: number, rFrom: number,
            searchM: number, riseM: number): number | null;
  resolveStep(p: Vec3d, qx: number, qy: number, qz: number,
              ux: number, uy: number, uz: number,
              samplesM: readonly number[],
              stepUpM: readonly number[]): StepResult;
}

/**
 * The ledge heights a blocked STRUCTURAL step retries at.
 *
 * Its own array rather than an alias of the voxel ladder, which it used to be,
 * so that the two are not silently coupled: the voxel ladder is a statement
 * about a 1 m lattice cell and this one is a statement about the shipped
 * module, and DW-32's move from a 1 m module to a 4 m one is the third scale
 * assumption in two days to have been found hiding inside a constant that
 * predated it. The VALUES are deliberately unchanged.
 *
 * The first rung is what a player climbs to get onto their own foundation, so
 * it must clear a deck: 0.55 m against the module's own `deckH` of 0.50 m.
 * That relation is asserted rather than assumed, in `probes/decksink.js`, which
 * reads `deckH` off the shipped asset and fails if it ever grows past the rung.
 * The second rung is one storey of nothing in particular; a storey is 4.00 m,
 * so no step ever puts a player on top of a wall.
 */
export const STRUCTURE_STEP_UP_M: readonly number[] = [0.55, 1.1];
