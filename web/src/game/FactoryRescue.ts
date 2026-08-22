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
// AND NOTHING PUTS ONE BACK EITHER, WHICH THIS COMMENT USED TO DENY (PS-56,
// corrected 2026-08-21, R-RECOVER-1). It said the copy "is recovered by an
// explicit call, `restoreRescue`, which the probe drives and which is reachable
// from the console". There is no `restoreRescue` anywhere in the repo;
// `listRescue` and `readRescue` below have ZERO callers in `src` or `tools`;
// no debug verb exposes them, so nothing here is reachable from the console;
// and what `rescale.js` actually drives is its own hand-rolled IndexedDB open,
// not a call into this file. What IS true is the finding half: the key is
// printed to the console and carried on the factory report, so a copy can be
// FOUND. Putting it back is a devtools job today.
//
// This mattered enough to correct rather than route, because PS-53 now writes
// copies into this store on a field-generation clear and PS-54's decision to
// clear a world leans on them, so a sentence in the recovery file claiming a
// recovery path that does not exist is load-bearing and false. Nothing prunes
// the store either. See persistence.md's R-RECOVER-1.

import { needsRescale } from './FactoryRescale.js';
import type { SaveSlot } from './SaveGame.js';

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
