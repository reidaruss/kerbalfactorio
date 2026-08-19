// THE GROUND'S OWN MATERIAL: put the rock back, and take the node's
// (GP-1075, split out of DebugGameplay.ts under the 400-line cap).
//
// `forgetTunnels` restores every voxel a dig removed and `harvest` is one
// swing's grant against a node, and both are about the same substance seen
// from its two authorities: the voxel edit set, and /core's node array. They
// are also the last two entries the original file published, and this split
// preserves that position exactly, because `gameplayApi`'s property ORDER is
// part of the shape a probe iterating it would read.
import { clearEdits } from '../game/VoxelSave.js';
import type { Services } from './Services.js';
import type { Loop } from './Loop.js';

export function harvestApi(s: Services, loop: Loop) {
  return {
    // DW-17, the voxel half of `repopulate`: put the rock back, so a restore is
    // verified against a world with no digs in it, which is the only state a
    // reloaded page can actually be in.
    forgetTunnels() {
      const left = clearEdits(s.core, s.voxels, s.voxelMesh);
      return { removedCells: left, meshVisible: s.voxelMesh?.mesh.visible ?? false };
    },

    harvest(index: number) {
      if (s.gameplay === null) return null;
      const ok = s.gameplay.interact.harvestNow(index, loop.tickIndex);
      // GP-506: `refusal` names WHY a false `ok` happened (tool gate) rather
      // than leaving a probe to guess between that, an empty node and a full
      // pack from `node`/`carried` alone.
      return {
        ok, node: s.gameplay.game.node(index), carried: s.gameplay.game.carried(),
        refusal: s.gameplay.interact.lastRefusal,
      };
    },
  };
}
