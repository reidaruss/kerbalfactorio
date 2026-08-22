// FS-79: THE COPY OF THE SAVE THAT IS TAKEN BEFORE THE RESCALE TOUCHES IT.
//
// Reid has been playing a roughly 140-structure base for days. FS-78 is the
// first migration this project has shipped that MOVES buildings, and a migration
// that eats a base is unrecoverable, so the copy is not optional and it is not
// "the previous autosave": the previous autosave is written by the same key the
// load is about to overwrite.
//
// IT LIVES IN ITS OWN DATABASE, NOT IN THE SAVE STORE, AND THAT IS THE WHOLE
// DESIGN DECISION HERE. Putting it under another key in `saves` would be two
// lines shorter and would be wrong twice. GP-136 derives the named-save list
// from `getAllKeys()` on that store precisely so that a slot written by any path
// appears without registering, which is the right rule and which would make a
// rescue copy show up in the player's load list as a save they did not make. And
// the store the game writes its world into is the last place to put the only
// copy of that world: one `clearSlot`, one quota eviction, one future migration
// that walks the store, and the backup goes with the thing it was backing up.
// A separate database cannot be swept by anything that operates on saves.
//
// NOTHING READS IT AUTOMATICALLY, and that is deliberate too. An automatic
// rollback is a second authority over "what is the world", and it would fire on
// the load AFTER a migration the player was perfectly happy with.
//
// AND NOTHING PUT ONE BACK EITHER, for a while: PS-56 (2026-08-21) corrected a
// header sentence here that claimed a `restoreRescue` reachable from the
// console when none existed anywhere in the repo, and left the gap open as
// R-RECOVER-1 rather than paper over it a second time. `restoreRescue` below
// is that verb, now real, wired through `__of.rescue.*` (BT-320) rather than
// left reachable only by opening IndexedDB by hand. It is explicit-only and
// writes verbatim (see its own comment for why `writeSlot` would be wrong
// here); nothing calls it automatically, on load or on boot. `listRescue` and
// `readRescue` are read from the same surface now too. Nothing prunes the
// store; that is still unbuilt.
//
// This mattered enough to correct rather than route, because PS-53 writes
// copies into this store on a field-generation clear and PS-54's decision to
// clear a world leans on them, so a sentence in the recovery file claiming a
// recovery path that does not exist was load-bearing and false. See
// persistence.md's R-RECOVER-1 for the full case and what closing it does and
// does not mean (it is not an automatic undo for a field-generation clear).
//
// AND THAT FIRST CUT OF `restoreRescue` WAS ITSELF ONE MORE FALSE CLAIM,
// FOUND BY A FRESH-CONTEXT VERIFIER BEFORE IT SHIPPED: it writes into the
// SAME KEY the running session's own autosave writes to, so the timer that
// fires every 20 real seconds (`GameplayStep.ts`'s `AUTOSAVE_TICKS`) would
// otherwise silently overwrite a restored copy with the live world on its
// own schedule, no error, no second warning, and re-stamp `fieldGen` to the
// current planet on the way out so the next load never sees a mismatch to
// report. `restoreRescue` now arms `sim/SaveInhibit.ts`'s existing latch the
// moment the write lands, and `PersistSlot.loadSlot` releases it, so the
// window this file's own warning describes is closed rather than merely
// disclosed.

import { needsRescale } from './FactoryRescale.js';
import type { SaveSlot } from './SaveGame.js';
import { writeKey } from './SaveKeys.js';
import { inhibitSave } from '../sim/SaveInhibit.js';

const DB = 'of-rescue';
const STORE = 'slots';
const VERSION = 1;

/** The one key shape. `<reason>:<slotKey>:<when>` so a second migration of the
 *  same world does not overwrite the first one's copy, which is the copy that
 *  matters if two migrations in a row went wrong. */
export function rescueKey(reason: string, slot: string, when: number): string {
  return `${reason}:${slot}:${new Date(when).toISOString().replace(/[:.]/g, '-')}`;
}

function open(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const req = indexedDB.open(DB, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode,
                     run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((res, rej) => {
      const t = db.transaction(STORE, mode);
      const req = run(t.objectStore(STORE));
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    });
  } finally {
    db.close();
  }
}

/**
 * Copy a slot aside. Returns the key it landed under, or '' if it did not land.
 *
 * A FAILED BACKUP RETURNS EMPTY AND THE CALLER MUST NOT MIGRATE. That is the
 * only contract in this file and it is stated here rather than left to a caller
 * to remember: the whole point of the copy is that the destructive step does not
 * happen without it.
 */
export async function keepRescue(reason: string, slot: string,
                                 value: SaveSlot): Promise<string> {
  const key = rescueKey(reason, slot, Date.now());
  try {
    await tx('readwrite', (s) => s.put(value, key) as IDBRequest<IDBValidKey>);
    return key;
  } catch {
    return '';
  }
}

/** Every rescue copy, newest first. The keys carry their own timestamps, so
 *  sorting the strings sorts the copies. */
export async function listRescue(): Promise<string[]> {
  try {
    const k = await tx('readonly',
      (s) => s.getAllKeys() as IDBRequest<IDBValidKey[]>);
    return k.map(String).sort().reverse();
  } catch {
    return [];
  }
}

export async function readRescue(key: string): Promise<SaveSlot | null> {
  try {
    const v = await tx('readonly',
      (s) => s.get(key) as IDBRequest<SaveSlot | undefined>);
    return v ?? null;
  } catch {
    return null;
  }
}

/**
 * BT-320 (R-RECOVER-1). The `<reason>:<slot>:<when>` key back apart.
 *
 * SPLITTING ON THE FIRST TWO COLONS, NOT ON EVERY COLON, and that is exact
 * rather than a convention that could silently drift: `rescueKey` replaces
 * every `:` and `.` in the ISO timestamp with `-` for exactly this reason
 * (see its own comment), so `when` is colon-free by construction and the
 * first two colons in the whole key are always the two separators. Both
 * real reasons (`rescale`, `fieldgen`) and both real slots (`auto`,
 * `auto-sandbox`, from `slotKey`) are colon-free too, so this parses every
 * key either caller has ever written; a future caller that hands
 * `keepRescue` a NAMED-save key (`save:<mode>:<name>`, which itself contains
 * colons) would break this, and nothing here does that today.
 */
export function parseRescueKey(key: string): { reason: string; slot: string; when: string } | null {
  const a = key.indexOf(':');
  if (a < 0) return null;
  const b = key.indexOf(':', a + 1);
  if (b < 0) return null;
  const reason = key.slice(0, a);
  const slot = key.slice(a + 1, b);
  const when = key.slice(b + 1);
  if (reason === '' || slot === '' || when === '') return null;
  return { reason, slot, when };
}

export interface RescueRestoreReport {
  ok: boolean;
  key: string;
  targetSlot: string | null;
  reason: string | null;
  warning: string;
}

/**
 * R-RECOVER-1. THE OTHER HALF OF THE DOOR: a copy this file has always been
 * able to WRITE and never able to PUT BACK. `listRescue`/`readRescue` above
 * had zero callers anywhere in the repo; this is the first one, reached
 * through `__of.rescue.restore` (BT-320) rather than only by opening
 * IndexedDB by hand, which is what the header above used to falsely claim was
 * already true.
 *
 * WRITES VERBATIM, THROUGH `SaveKeys.writeKey`, NOT `SaveGame.writeSlot`.
 * `writeSlot` stamps the LIVE world onto whatever it is given (vessels, the
 * player anchor, the day clock, station power, the assisted mark), which is
 * correct for an autosave and wrong here: a rescue copy is bytes taken off
 * disk at a past moment, and restoring it must land exactly those bytes, not
 * those bytes overwritten by whatever happens to be live in the tab that
 * calls this. `writeKey` is the same byte-mover the named-save LOAD path
 * already uses for the identical reason (`SaveGame.ts`'s own comment: "the
 * load path copies a STORED slot verbatim").
 *
 * EXPLICIT ONLY, AND THAT IS THE WHOLE SAFETY ARGUMENT. Nothing calls this but
 * a deliberate `__of.rescue.restore(key)`: there is no boot-time or load-time
 * trigger, because an automatic restore would be a second authority over
 * "what is the world" firing on its own judgement about a copy the player has
 * not looked at, which is the exact objection FS-79's own header raises
 * against an automatic rollback.
 *
 * RESTORES INTO THE SLOT THE KEY NAMES, not the running mode's live slot, so
 * this is for RECOVERY-THEN-INSPECTION and not silent resurrection: it lands
 * the bytes under (say) `auto`, and picking them up is a SEPARATE, later
 * `__of.load()` or a reload, never this call.
 *
 * AND THAT SLOT IS ALMOST ALWAYS THE RUNNING SESSION'S OWN AUTOSAVE KEY,
 * WHICH A FRESH-CONTEXT VERIFIER PROVED IS NOT SAFE TO LEAVE UNGUARDED
 * (measured twice, raw IndexedDB, on the shipped BT-320 cut): `parsed.slot`
 * is `slotKey(g.mode.mode)` by construction (see `rescueKey`'s callers), the
 * SAME key `GameplayStep.stepFixed`'s `AUTOSAVE_TICKS` timer (20 real
 * seconds) writes to. Restoring and then simply letting the session keep
 * running meant the very next autosave silently overwrote the restored bytes
 * with the LIVE world, re-stamping `fieldGen` to the CURRENT planet on its
 * way out with no error and no second toast, so a load taken a minute later
 * saw a clean MATCH and PS-53's own detector never got a chance to fire on
 * it. This function therefore calls `inhibitSave` (`sim/SaveInhibit.ts`, the
 * same latch `FlightDoors`/`FlightRecover` already use for a different
 * "this save would be wrong" case) the moment the write lands, and
 * `PersistSlot.loadSlot` clears it again as its first statement: the restored
 * bytes are safe from THIS session's own autosave for as long as the player
 * leaves them un-loaded, and the pause is visible on the navball
 * (`FlightReadout.ts` already reads `saveInhibit()`), not merely logged.
 *
 * RESTORING A `fieldgen` COPY IS STILL NOT AN UNDO. Loading it back onto the
 * CURRENT planet re-creates exactly the misplacement PS-53/PS-54 exist to
 * prevent (a pre-swell world addressed in a planet that has since changed
 * shape): the load that finally applies it will detect the mismatch and
 * clear the body half again. `warning` says both of these things on every
 * call, not only the first, because a copy read back clean today is not a
 * promise about the load after it.
 */
export async function restoreRescue(key: string): Promise<RescueRestoreReport> {
  const parsed = parseRescueKey(key);
  if (parsed === null) {
    return {
      ok: false, key, targetSlot: null, reason: null,
      warning: `[of] rescue.restore refuses: '${key}' is not a rescue key `
        + '(expected <reason>:<slot>:<when>, e.g. one of __of.rescue.list()\'s own entries)',
    };
  }
  const value = await readRescue(key);
  if (value === null) {
    return {
      ok: false, key, targetSlot: parsed.slot, reason: parsed.reason,
      warning: `[of] rescue.restore refuses: no rescue copy stored under '${key}'`,
    };
  }
  const warning = `[of] restoring rescue copy '${key}' into slot '${parsed.slot}'. `
    + 'This writes the OLD bytes back verbatim; it does not load them, and nothing '
    + 'here does that automatically. Autosave for this session is now PAUSED: '
    + `without that, the running world's own 20-second autosave timer would `
    + `silently overwrite '${parsed.slot}' with the LIVE world (re-stamping `
    + "fieldGen to the CURRENT planet on the way out) with no error and no second "
    + 'warning, so a load taken even a minute later would see a clean world and '
    + 'this restore would already be gone. The pause holds until the next '
    + '__of.load() or reload, so inspect the restored world before you load it: '
    + `if this is a '${parsed.reason}' copy taken because the body's height field `
    + "had changed since it was saved, LOADING it onto the CURRENT planet "
    + 're-creates the exact misplacement that clear existed to prevent, and that '
    + 'load will detect the mismatch and clear the body half again. '
    + 'Recovery-then-inspection, not silent resurrection.';
  console.warn(warning);
  const ok = await writeKey(parsed.slot, value);
  // THE INHIBIT ARMS ONLY ON A SUCCESSFUL WRITE, and only after it, so a
  // failed restore (ok === false) never blocks a save the running world was
  // never actually at risk from.
  if (ok) {
    inhibitSave(`a rescue copy ('${key}') was restored into '${parsed.slot}' and `
      + 'is paused from autosave until the next load; inspect it, then load '
      + 'deliberately');
  }
  return { ok, key, targetSlot: parsed.slot, reason: parsed.reason, warning };
}

/**
 * The whole load-time decision, in one call, so the load path carries one line.
 *
 * IT ASKS THE QUESTION OF THE SAVED ROWS, before any of them have been pushed
 * into the world. That is the point of doing it here rather than inside the
 * restore: the decision and the copy both happen while the bytes are still
 * exactly as they were written, so what is preserved is the world the player
 * left rather than a half-applied version of it.
 *
 * '' MEANS TWO DIFFERENT THINGS ON PURPOSE, and the caller must treat them the
 * same way. Either nothing needed migrating, in which case there is nothing to
 * protect and a copy would be litter, or a copy was needed and could not be
 * written, in which case the migration must not run. Both come out as "do not
 * move anything", which is the safe reading of both.
 */
export async function rescueBefore(slot: string, value: SaveSlot): Promise<string> {
  if (!needsRescale(value.buildings)) return '';
  return keepRescue('rescale', slot, value);
}
