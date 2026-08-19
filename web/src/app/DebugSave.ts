// THE SLOT, AND THE WORLD IT IS A DIFF OVER (GP-1075, split out of
// DebugGameplay.ts under the 400-line cap).
//
// `save`/`load`/`wipe` are the slot; `repopulate` is the clearing regrown from
// the seed. They are one concern because of DW-17's model: a save is a DIFF
// over a freshly generated world, so a restore verified against a world that
// is already more depleted than the save is a state no real boot can be in,
// and the regrow is what puts a probe back into a state one can.
//
// The voxel half of that regrow, `forgetTunnels`, is in `DebugHarvest.ts`,
// because this split moves lines rather than reordering them and the original
// published it after the checklist. Its docstring names this file's
// `repopulate` and still means it.
import { clearSlot } from '../game/SaveGame.js';
import type { Services } from './Services.js';

export function saveApi(s: Services) {
  return {
    // DW-17. `save` writes the autosave slot NOW and `load` applies it over the
    // live world, which is what makes a reload testable without one: a probe
    // can save, mutate, load and compare in a single page.
    save: () => s.gameplay?.save() ?? Promise.resolve(null),
    load: () => s.gameplay?.load() ?? Promise.resolve(null),
    // The RUNNING mode's slot only. Wiping both would let a probe destroy a
    // world it is not testing, which is exactly the contamination DW-31 exists
    // to prevent, from the other direction.
    wipe: () => clearSlot(s.gameplay?.mode.mode ?? 'survival'),
    // Regrow the clearing from the seed, exactly as boot does. This is what
    // lets a probe model a RELOAD without one: a save is a diff over a freshly
    // generated world, so restoring onto a world that is already more depleted
    // than the save is a state a real boot can never be in.
    repopulate() { s.gameplay?.populate(); return s.gameplay?.report() ?? null; },
  };
}
