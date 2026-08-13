// THE TWO CALLS GAMEPLAY MAKES: write the world, and put it back.
//
// Split out of `Persist.ts` when PS-40's body dimension pushed that file back
// over the 400-line cap, along the seam the file already had and the same one
// `PersistProgress.ts` and `PersistLedger.ts` were taken along: `Persist.ts` is
// WHAT COUNTS AS STATE and the order it has to go back in, and this is the DOOR
// the rest of the client comes through. Both names are re-exported from
// `Persist.ts`, because moving a published name to make room is a worse trade
// than one line of forwarding.
//
// They live here rather than on `Gameplay` because a save is a whole-world
// operation and Gameplay is a composition; the type import is erased, so the
// apparent cycle costs nothing at runtime.

import { readSlot, slotKey, writeSlot } from './SaveGame.js';
import { rescueBefore } from './FactoryRescue.js';
import { noteSave, saveInhibit } from '../sim/SaveInhibit.js';
import { adoptWorldFor, keepWorlds } from './SaveWorlds.js';
import { apply, snapshot } from './Persist.js';
import { saveProgress } from './PersistProgress.js';
import type { Gameplay } from './Gameplay.js';
import type { RestoreLedger } from './PersistLedger.js';
import type { SlotRefusal } from './SaveGame.js';

/**
 * Why the last load refused a slot that EXISTS, for the report.
 *
 * Module state rather than a field on Gameplay because the refusal happens
 * before anything is restored, so there is no ledger to hang it on, and DW-20
 * says a harness must be able to prove its own setup: a probe asserting "the
 * survival boot did not read the sandbox world" needs to see the refusal, not
 * just an absence. It moved here with `loadSlot`, which is its only writer.
 */
let lastRefusal: SlotRefusal = '';
export function lastSlotRefusal(): SlotRefusal { return lastRefusal; }

export async function saveSlot(g: Gameplay): Promise<unknown> {
  // PH-30 / physics R11. A save that cannot describe the world is refused here
  // rather than written and hoped over: the slot has no field for a vessel, so
  // one written mid-flight is a VALID GROUND state that silently deletes the
  // flight on the next load. Refusing leaves the last GROUND save on disk,
  // which is where a reload should put somebody whose flight was not saved,
  // and the navball says so while it is happening.
  const inhibit = saveInhibit();
  if (inhibit !== '') { noteSave(true); return { refused: inhibit }; }
  noteSave(false);
  const slot = snapshot(g.core, g.game, g.field, g.factory, g.machines,
    g.seed, g.bodyId, g.bodyHandle, g.ports, g.oreField, g.structures, g.pads,
    g.stations,
    g.hotbar, g.mode.mode,
    saveProgress(g), g.health, g.vitals.serialize(), g.rocks, g.trees);
  const ok = await writeSlot(slot);
  if (ok) g.saves++;
  return ok ? {
    mode: slot.mode,
    bytes: slot.pack.length, buildings: slot.buildings.length,
    structures: slot.structures?.length ?? 0, sites: slot.sites?.length ?? 0,
    pads: slot.pads?.length ?? 0,
    machines: slot.machines.length, depletion: slot.depletion.length,
    patches: slot.patches.length, rocks: slot.rocks?.length ?? 0,
    trees: slot.trees?.length ?? 0,
    poiBytes: slot.poi?.length ?? 0,
    health: slot.health?.length ?? 0,
    voxelBytes: slot.voxels.cells.length, voxelOps: slot.voxels.ops.length,
  } : null;
}

export async function loadSlot(g: Gameplay): Promise<RestoreLedger | null> {
  // PS-41. CLEARED FIRST, so every exit that is not an accept leaves nothing
  // behind, including one added later (SaveWorlds.ts).
  keepWorlds([]);
  const read = await readSlot(g.mode.mode);
  const slot = read.slot;
  // DW-31. A slot refused for its MODE is said out loud rather than dropped: a
  // world that silently arrives empty is the single most alarming thing a save
  // system can do, and "that save was made in sandbox mode" is the sentence that
  // stops the player thinking their base is gone. Their base is not gone; it is
  // under the other mode's key and nothing here will write over it.
  lastRefusal = read.refusal;
  if (read.refusal === 'mode' && read.foundMode !== null) {
    g.hud.flash(`that save was made in ${read.foundMode} mode, `
      + `this world is ${g.mode.mode}`, 3.2);
  }
  // A slot from another seed is a different planet, and loading it would drop
  // buildings onto terrain that is not there.
  if (slot === null || slot.seed !== g.seed) return null;
  // PS-40 / PS-41. THE BODY IS CHOSEN HERE AND NOWHERE ELSE, in one call that
  // cannot be done by halves. `apply` is handed a slot whose body-scoped half is
  // THIS body's world; every other body's is held for the next write. Nothing
  // below knows a second body exists: the twelve restore steps are untouched.
  const { view, ...carried } = adoptWorldFor(slot, g.bodyId);
  // FS-79. THE RESCUE COPY, TAKEN BEFORE `apply` TOUCHES ANYTHING, and returning
  // '' both when none was needed and when one could not be written. Passing it in
  // is what makes it a PRECONDITION: `restorePlan` will not re-space a plan
  // without the key of a copy that already exists. It copies the WHOLE slot and
  // not the view, because a rescue is a copy of what was on disk.
  const rescue = await rescueBefore(slotKey(g.mode.mode), slot);
  g.restored = apply(g, g.core, g.game, g.factory, g.machines, view, g.ports,
    g.oreField, g.structures, g.structView, g.hotbar, carried, rescue);
  g.hotbarBar.invalidate();
  g.panel.invalidate();
  const dug = g.restored.voxels.cells;
  g.hud.flash(`restored ${g.restored.buildings} buildings, `
    + `${g.restored.packUnits} items`
    + (dug > 0 ? `, ${dug} m³ of tunnel` : ''), 2.6);
  return g.restored;
}
