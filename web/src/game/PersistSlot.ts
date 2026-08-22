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
import { keepRescue, rescueBefore } from './FactoryRescue.js';
import { clearedBodyHalf, fieldGenReport, fieldGenVerdict, fieldStampFor,
  forgetFieldGen, noteFieldGen } from './FieldStamp.js';
import { allowSave, noteSave, saveInhibit } from '../sim/SaveInhibit.js';
import { adoptWorldFor, keepWorlds } from './SaveWorlds.js';
import { worldScopeReport } from './WorldScope.js';
import { apply, snapshot } from './Persist.js';
import { saveProgress } from './PersistProgress.js';
import type { Gameplay } from './Gameplay.js';
import type { RestoreLedger } from './PersistLedger.js';
import type { SaveSlot, SlotRefusal } from './SaveGame.js';

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

/**
 * THE WHOLE WORLD AS A SLOT, from the one argument every caller has.
 *
 * PS-49 made this exported and it had THREE callers the day it did: this file,
 * `SaveSlots`' named-save path, and the body-switch capture in `WorldScope`.
 * Two of them were already here, spelling out the same twenty arguments
 * independently, which is PS-13's defect in its dormant form -- the named path
 * fell out of `writeSlot` exactly by being a second enumeration, and this was a
 * second enumeration of the layer below it. A third copy for the capture would
 * have made a body switch freeze a world missing whichever field the next lane
 * adds, so the copies are one function now.
 */
export function snapshotOf(g: Gameplay): SaveSlot {
  return snapshot(g.core, g.game, g.field, g.factory, g.machines,
    g.seed, g.bodyId, g.bodyHandle, g.ports, g.oreField, g.structures, g.pads,
    g.stations, g.antennas,
    g.hotbar, g.mode.mode,
    saveProgress(g), g.health, g.vitals.serialize(), g.rocks, g.trees);
}

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
  const slot = snapshotOf(g);
  const ok = await writeSlot(slot);
  if (ok) g.saves++;
  return ok ? {
    mode: slot.mode,
    // PH-366. THE VERSION AND THE VESSELS, on the summary because a probe has
    // no other way to read either. `writeSlot` fills `slot.vessels` on its way
    // out, so these describe THE BYTES THAT WERE WRITTEN and not an intention.
    // `version` is here specifically so a lane that adds an optional field can
    // ASSERT that SAVE_VERSION did not move: a bump refuses every existing slot
    // outright (SaveGame.ts), so "we did not need one" has to be checkable
    // rather than claimed in a commit message.
    version: slot.version,
    // PS-49. WHETHER THIS WRITE IS THE LIVE WORLD OR A FROZEN READING OF IT,
    // beside `version` and for the same reason: a probe has no other way to
    // read it, and "the save stopped moving" has to be checkable rather than
    // inferred from a count that happens not to have changed. `frozen` false is
    // every shipped path. See WorldScope.ts.
    world: worldScopeReport(),
    // PS-53. WHICH GENERATION OF THE HEIGHT FIELD THIS WRITE IS ADDRESSED IN,
    // and what the last LOAD decided about it, beside `version` and `world` for
    // the reason PH-366 gave for `version`: a probe has no other way to read
    // either, so "the stamp is written" and "the pre-swell half was cleared"
    // have to be checkable rather than claimed. `fieldGen` here is the value in
    // the BYTES THAT WERE WRITTEN, which after a PS-49 freeze is the frozen
    // world's and not the live field's.
    fieldGen: slot.fieldGen ?? null,
    fieldGenLoad: fieldGenReport(),
    vessels: slot.vessels?.length ?? 0,
    dockedVessels: (slot.vessels ?? []).filter((v) => v.docked !== undefined)
      .length,
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

/**
 * PS-53. THE BODY-SCOPED HALF IS CLEARED WHEN THE PLANET UNDER IT HAS MOVED,
 * AND THE GLOBAL HALF LOADS.
 *
 * WHY CLEAR AND NOT REFUSE, with the player's experience for each, because two
 * of the three options are defensible and the losing ones are recorded here
 * rather than in a commit message.
 *
 *   REFUSE THE WHOLE SLOT, which is what a `SAVE_VERSION` bump does: the world
 *     slot is unusable but honest. The player loses the pack, the research, the
 *     milestones, the vessels and the time of day, none of which is about a
 *     place and all of which is still exactly right. REJECTED, and it is the
 *     option this whole mechanism exists to avoid: PS-40 and PS-49 separated
 *     the two halves precisely so this is not the only answer available.
 *
 *   REFUSE ONLY THE BODY HALF AND KEEP THE STORED BYTES, freezing the write the
 *     way PS-49 freezes a switched body: the player keeps the global half, sees
 *     an empty planet, and NOTHING THEY BUILD ON IT IS EVER SAVED AGAIN.
 *     REJECTED. PS-49's freeze is reachable only from a debug verb and lasts
 *     one session; this one would fire at boot for every player on their real
 *     world and would leave them playing a planet that cannot be saved, which
 *     is a broken game rather than a preserved one. It is also barely a refusal
 *     in this container: the autosave writes the same key 20 seconds later, so
 *     "refuse but leave the bytes" only means anything while something stops
 *     the write, and stopping the write is the broken part.
 *
 *   CLEAR THE BODY HALF, which is what this does: the player keeps research,
 *     pack, hotbar, vessels, the day and their vitals, and their edits,
 *     buildings, structures, pads, stations, antennas and depletion on THIS
 *     body are gone, with a message saying so. That is strictly more of their
 *     world than a refusal keeps, and it is the only option that leaves them
 *     with a planet they can go on playing.
 *
 * THE COPY IS TAKEN FIRST, and FS-79's machinery is reused verbatim because
 * this is the same event one migration later: a load-time decision that eats a
 * base is unrecoverable, and the copy goes in FS-79's own separate database so
 * nothing that sweeps the save store can take the backup with it.
 *
 * IT IS BEST EFFORT HERE AND IT IS A PRECONDITION THERE, and the difference is
 * worth stating because the contract is FS-79's. A rescale that cannot be
 * backed up simply does not run, and the world loads unmigrated, which is a
 * legal state. There is no such state here: the stored body half describes a
 * surface that does not exist, so "do not clear" would mean loading buildings
 * into the air. So the copy is attempted, its success is REPORTED rather than
 * required, and a failure changes the message and not the decision.
 */
async function fieldGenAdopt(g: Gameplay, stored: SaveSlot,
                             view: SaveSlot): Promise<SaveSlot> {
  const live = fieldStampFor(g.core, g.bodyHandle);
  const verdict = fieldGenVerdict(view.fieldGen, live);
  const base = { verdict, body: g.bodyId, stored: view.fieldGen ?? null, live };
  if (verdict === 'match') {
    noteFieldGen({ ...base, cleared: false, rescue: '' });
    return view;
  }
  const rescue = await keepRescue('fieldgen', slotKey(g.mode.mode), stored);
  noteFieldGen({ ...base, cleared: true, rescue });
  // Loud, never silent (PS-49's rule): the console line carries the numbers and
  // the rescue key, which the toast has no room for and which is what makes the
  // copy findable rather than a copy nobody can locate.
  console.warn(`[of] the height field has changed since this world's body ${g.bodyId} `
    + `half was saved (stored ${view.fieldGen ?? 'none'}, live ${live}); it is CLEARED `
    + `and the global half is kept. Copy of the old slot: ${rescue || 'NOT WRITTEN'}`);
  return clearedBodyHalf(view, g.bodyId, live);
}

export async function loadSlot(g: Gameplay): Promise<RestoreLedger | null> {
  // BT-320 (R-RECOVER-1). RELEASED FIRST, same reasoning as PS-41's `keepWorlds`
  // right below: whatever a PREVIOUS moment inhibited saving for (a flight in
  // progress, a `rescue.restore` waiting to be inspected) is about to be
  // replaced wholesale by this load, so a reason latched before it is stale
  // the instant this function starts. Unconditional and not read first, on the
  // same argument `FlightDoors.ts`/`FlightRecover.ts` already apply to their
  // own inhibiting condition: the thing the inhibit was protecting either
  // just got read (a restore, about to be picked up by THIS load) or is about
  // to be discarded (a flight, torn down by the world this load builds), and
  // in neither case should the reason survive into the freshly loaded world.
  allowSave();
  // PS-41. CLEARED FIRST, so every exit that is not an accept leaves nothing
  // behind, including one added later (SaveWorlds.ts).
  keepWorlds([]);
  // PS-53, PS-41's own rule one field over: a boot that never got as far as the
  // field-generation question must not report the previous boot's answer.
  forgetFieldGen();
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
  const { view: bodyView, ...carried } = adoptWorldFor(slot, g.bodyId);
  // PS-53. AND IS IT ADDRESSED IN THE PLANET THAT EXISTS? The line above chose
  // which body's world to read; this decides whether that world can still be
  // read at all. See `fieldGenAdopt` below for the whole argument.
  const view = await fieldGenAdopt(g, slot, bodyView);
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
  // PS-53. THE FIELD-GENERATION MESSAGE IS THE LAST ONE WRITTEN AND IT REPLACES
  // THE COUNTS, because `GameHud.flash` overwrites the toast rather than
  // queueing: a "restored 0 buildings, 0 items" written after this one would
  // hide the only sentence that explains it, and "0 buildings" with no reason
  // is exactly the silent-empty-world alarm DW-31 says never to give. The
  // counts are still on the ledger and on the save receipt for a probe.
  const gen = fieldGenReport();
  if (gen !== null && gen.cleared) {
    g.hud.flash('this world was saved on an older version of this planet, so its '
      + 'buildings and tunnels here were not restored; your items and research '
      + `are intact${gen.rescue === '' ? ' (the old save could NOT be copied aside)'
        : ' and the old save was copied aside'}`, 8);
    return g.restored;
  }
  g.hud.flash(`restored ${g.restored.buildings} buildings, `
    + `${g.restored.packUnits} items`
    + (dug > 0 ? `, ${dug} m³ of tunnel` : ''), 2.6);
  return g.restored;
}
