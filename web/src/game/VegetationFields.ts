// RN-2225. THE THREE OBJECTS THAT GROW THINGS ON THE GROUND, in ONE place.
//
// `GameCore` + `NodeField` + `RockField` + `TreeField` is the whole wild
// vegetation source: a /core node array, a batched renderer for it, and two
// lattice streamers that fill it. Every one of them is a pure function of
// (seed, lattice cell) and the body datum, and NOT ONE OF THEM NEEDS A PLAYER.
//
// It is its own module because there are now two callers and there must be one
// authority (DW-26). `GameplayCompose.composeGround` builds these for a world
// with a character in it and hangs the pack, the swing and the clearing off
// them; `VegetationScope` builds the same four for a world with only an eye,
// which is every `--scenario=surface|orbit|ascent` run and every probe pose
// taken from the air. Before this split the second caller did not exist, which
// is the whole of RN-2202's section 2.12.6: `--scenario=surface` builds no
// `Gameplay`, so `TreeField` was never constructed, never ticked, and the
// flyover pose had never had a tree to draw at any radius.
//
// Nothing here decides anything. Every number is read from the deps, on the
// DW-18 rule: a body radius or a treeline datum transcribed into a second file
// is a fact with two authorities and it drifts.

import { GameCore } from './GameCore.js';
import { NodeField } from './NodeField.js';
import { RockField } from './RockField.js';
import { TreeField } from './TreeField.js';
import type { FloatingOrigin } from '../world/FloatingOrigin.js';
import type { OfCoreModule } from '../sim/wasm/heap.js';
import type { WaterOracle } from '../world/WaterOracle.js';

/** Exactly what the four objects below need, and nothing a character owns. */
export interface VegetationDeps {
  core: OfCoreModule;
  origin: FloatingOrigin;
  bodyHandle: number;
  seed: number;
  /** WG-69: body radius, the rock lattice's datum and the treeline's zero.
   *  READ from PlanetBody and never transcribed. */
  bodyRadiusM: number;
  /** WG-69: the water authority for the wet gate, or null when dry. */
  water: WaterOracle | null;
  /** WG-69: `?rocks=0` is the negative control. */
  rocks?: { enabled: boolean; density: number };
  /** WG-116: `?trees=0` is the negative control; radius is the ring. */
  trees?: { radiusM: number; density: number };
  /** WG-118: `?nodelod=0` / `?nodecull=0`. */
  nodeArt?: { lod?: boolean; cull?: boolean };
  /** Live edits handle, a THUNK: voxels are created after this and a tree
   *  streaming in over a dug pit must seat on the edited surface. */
  editsHandle: () => number;
}

export interface VegetationFields {
  game: GameCore;
  field: NodeField;
  rocks: RockField;
  trees: TreeField;
}

/** Build the node authority, its renderer, and the two lattice streamers. */
export function makeVegetationFields(d: VegetationDeps): VegetationFields {
  const game = new GameCore(d.core);
  const field = new NodeField(game, d.origin, d.nodeArt);
  const rocks = new RockField(d.core, game, field, d.bodyHandle,
    d.seed, d.rocks?.enabled ?? true, d.rocks?.density ?? 1,
    d.bodyRadiusM, d.water, d.editsHandle);
  const trees = new TreeField(d.core, game, field, d.bodyHandle,
    d.seed, d.trees?.radiusM ?? 0, d.trees?.density ?? 1,
    d.bodyRadiusM, d.water, d.editsHandle);
  return { game, field, rocks, trees };
}
