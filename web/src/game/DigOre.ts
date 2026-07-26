// Digging into an ore body pays, and it pays out of the SAME pool everything
// else does.
//
// The gap this closes: a pickaxe swing at an outcrop granted ore and a dig
// strike into the identical ground granted nothing, because the two went through
// different code. `of_gp_node_harvest` knows about outcrops and `VoxelWorld.dig`
// knows about cells, and nobody owned the line between them. The strike centre
// is a body-frame point, `of_gp_patch_find` answers whether it is inside a
// deposit, and `of_gp_patch_drain` is the ONE way ore leaves a patch, so the
// grant is exactly the drain and a deposit still has one number (DW-25).
//
// THE YIELD IS DELIBERATELY POOR, and that is the whole balance decision.
// Digging is not a better mining tool, it is a side effect of moving ground:
//
//   an outcrop, bare handed          3 units a swing
//   an outcrop, with the pickaxe     9 units a swing
//   a mining drill                   3.0 units a second, unattended, for ever
//   a dig strike into the ore        2 units, times the coverage where it landed
//
// So a strike is worth less than a fifth of a pickaxe swing per action, it can
// only be taken 6.7 times a second at best, and it costs a cubic metre and a
// half of the deposit's own ground each time. Nothing about it competes with the
// drill, which is the machine the whole progression exists to reach; it just
// stops the world lying to a player who has quite reasonably tried to dig ore
// out of a hillside they can see the ore in.

import type { GameCore } from './GameCore.js';
import type { OrePatches } from './OrePatches.js';
import type { DigOrePort } from '../player/DigAction.js';

/** Units a strike takes at FULL coverage. See the balance table above. */
export const DIG_ORE_UNITS = 2;
/** Below this coverage the ground is rim, and a strike there pays nothing. */
export const DIG_ORE_MIN_COVER = 0.15;

/** `onGrant` is the feedback: a coloured "+N Iron" where the strike landed, so
 *  the payout is visible at the rock rather than only in the pack. */
export function digOrePort(patches: OrePatches, game: GameCore,
                           onGrant?: (n: number, name: string,
                                      at: { x: number; y: number; z: number }) => void):
DigOrePort {
  return {
    strike(x: number, y: number, z: number) {
      const i = patches.find(x, y, z);
      if (i < 0) return null;
      const cover = patches.cover(i, x, y, z);
      if (cover < DIG_ORE_MIN_COVER) return null;
      const want = Math.max(1, Math.round(DIG_ORE_UNITS * cover));
      // The DRAIN is the authority: it returns what the pool actually had, so a
      // nearly exhausted deposit pays out what is left and not what was asked.
      const took = Math.floor(patches.drain(i, want));
      if (took <= 0) return null;
      const p = patches.patch(i);
      const item = p?.resource ?? 0;
      if (item === 0) return null;
      const over = game.add(item, took);
      const granted = took - over;
      const name = game.itemName(item);
      if (granted > 0) onGrant?.(granted, name, { x, y, z });
      return { item, name, granted };
    },
  };
}
