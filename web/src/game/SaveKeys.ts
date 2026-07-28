// GP-136. NAMED SAVE SLOTS: the key policy, and the four operations on one key.
//
// THE KEY IS `save:<mode>:<name>`, AND THE MODE IS IN IT ON PURPOSE.
//
// DW-31 put the mode in the AUTOSAVE key so that a survival boot could not read
// or overwrite a sandbox world. The same argument decides this, and Admin stated
// it in the same terms: sandbox and survival are different rulesets, so a flat
// list of saves invites loading a sandbox world into a survival session, which
// is either a crash or a silent cheat. Keying by mode makes that
// UNREPRESENTABLE rather than merely validated, and the load list then shows
// only the running mode's saves, because a greyed row a player cannot use is
// just a question they have to answer.
//
// THE `save:` PREFIX keeps the two families apart in one flat store. `auto` and
// `auto-sandbox` can never be listed, loaded or deleted as if they were
// somebody's named save, and a named save can never be mistaken for the slot
// the game writes without being asked.
//
// A COLON IS REFUSED IN A NAME RATHER THAN ESCAPED. Escaping means the writer
// and the parser have to agree forever, and this key is read BACK to build the
// load list, so a disagreement would surface as a save the player can see and
// cannot open. Refusing costs one validation and cannot rot.
//
// THE AUTOSAVE KEY IS NOT MIGRATED, per Admin: it is the slot the game writes
// unprompted, it already has the right key, and `SAVE_VERSION` does not move
// for any of this. Named slots are additive on top of a store that keeps
// working exactly as it did.

import { slotKey, tx, type SaveSlot } from './SaveGame.js';
import { asMode, type GameMode } from './GameMode.js';

export const NAME_MAX = 40;

/** Non-empty, short enough to draw, and with no colon. See the header. */
export function nameOk(name: string): boolean {
  const t = name.trim();
  return t.length > 0 && t.length <= NAME_MAX && !t.includes(':');
}

export function namedKey(mode: GameMode, name: string): string {
  return `save:${mode}:${name.trim()}`;
}

/** The mode and name a `save:` key carries, or null for anything else. */
export function parseNamedKey(key: string): { mode: GameMode; name: string } | null {
  if (!key.startsWith('save:')) return null;
  const rest = key.slice(5);
  const cut = rest.indexOf(':');
  if (cut <= 0) return null;
  const name = rest.slice(cut + 1);
  return name === '' ? null : { mode: asMode(rest.slice(0, cut)), name };
}

/** The autosave key for a mode, so a load can copy a named slot into it. */
export function autoKeyFor(mode: GameMode): string { return slotKey(mode); }

/**
 * Every key in the store.
 *
 * The load list is DERIVED from this rather than from a list the client keeps,
 * so a slot written by any path at all appears without anything having to
 * register it, and a slot deleted by any path disappears. That is the same rule
 * `ModalStack` applies to menus and `HealthCensus` to buildings, and it is what
 * makes a load list that cannot silently disagree with the store behind it.
 */
export async function allKeys(): Promise<string[]> {
  try {
    const k = await tx('readonly', (s) => s.getAllKeys() as IDBRequest<IDBValidKey[]>);
    return k.map((x) => String(x));
  } catch {
    return [];
  }
}

export async function readKey(key: string): Promise<SaveSlot | null> {
  try {
    const v = await tx('readonly', (s) => s.get(key) as IDBRequest<SaveSlot | undefined>);
    return v ?? null;
  } catch {
    return null;
  }
}

export async function writeKey(key: string, slot: SaveSlot): Promise<boolean> {
  try {
    await tx('readwrite', (s) => s.put(slot, key) as IDBRequest<IDBValidKey>);
    return true;
  } catch {
    return false;
  }
}

export async function deleteKey(key: string): Promise<boolean> {
  try {
    await tx('readwrite', (s) => s.delete(key) as IDBRequest<undefined>);
    return true;
  } catch {
    return false;
  }
}
