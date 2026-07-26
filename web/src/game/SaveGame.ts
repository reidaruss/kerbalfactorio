// DW-17: the save slot. A reload used to lose everything.
//
// THE BYTES ARE /core's AND THE CONTAINER IS OURS. `persistence_file.h` is
// excluded from the WASM build because std::filesystem does not exist in a
// browser, but the serializer does not need one: `of_gp_inventory_serialize`
// writes the pack with persistence.h's own SaveWriter, and this file only has to
// carry those bytes to IndexedDB and back. Encoding the pack in JS would have
// been quicker and would have created a second author for the format, which is
// the mistake every other layer in this project has already made once.
//
// WHAT IS A DIFF AND WHAT IS REGENERATED. Terrain, biomes and the clearing's
// LAYOUT come back from the seed, so none of them is saved: only what the player
// changed is. That is PS-7 and it is why a slot is a few hundred bytes rather
// than a planet.
//
// NOT SAVED YET, and said out loud rather than left to be discovered: voxel
// edits (the `VoxelEdits` handle lives in Services, outside this module's
// ownership; `of_edits_serialize` already exists for whoever wires it) and a
// furnace's burning fuel, which is a tick countdown with no item to give back.
// Both are counted in the report.

const DB = 'orbital-foundry';
const STORE = 'saves';
const SLOT = 'auto';
export const SAVE_VERSION = 1;

export interface SaveBuilding {
  kind: string;
  pos: [number, number, number];
  cell: string;
  up: [number, number, number];
  fwd: [number, number, number];
  node: number;
}

export interface SaveMachine {
  tier: number;
  pos: [number, number, number];
  quat: [number, number, number, number];
  /** Ore waiting in the pool and ingots waiting in the tray, as item + count. */
  ore: [number, number];
  out: [number, number];
  /** Ticks of fuel that will NOT survive the reload. Counted, not hidden. */
  fuelTicks: number;
}

export interface SaveSlot {
  version: number;
  seed: number;
  savedAt: number;
  /** persistence.h bytes from of_gp_inventory_serialize. */
  pack: number[];
  /** Harvest-node depletion: [index, remaining] for every node below full. */
  depletion: [number, number][];
  buildings: SaveBuilding[];
  machines: SaveMachine[];
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('indexedDB open failed'));
  });
}

async function tx<T>(mode: IDBTransactionMode,
                     run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const req = run(t.objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error('indexedDB request failed'));
    });
  } finally {
    db.close();
  }
}

/** Write the slot. Resolves false rather than throwing: a save is not a rule. */
export async function writeSlot(slot: SaveSlot): Promise<boolean> {
  try {
    await tx('readwrite', (s) => s.put(slot, SLOT) as IDBRequest<IDBValidKey>);
    return true;
  } catch {
    return false;
  }
}

/** Read the slot, or null if there is none, it is broken, or it is too old. */
export async function readSlot(): Promise<SaveSlot | null> {
  try {
    const v = await tx('readonly', (s) => s.get(SLOT) as IDBRequest<SaveSlot | undefined>);
    if (v === undefined || v === null) return null;
    // A version mismatch is a MISS, not an error and not a best-effort load: a
    // half-understood save is worse than a fresh world, because the player
    // cannot tell which half came back.
    return v.version === SAVE_VERSION ? v : null;
  } catch {
    return null;
  }
}

export async function clearSlot(): Promise<void> {
  try {
    await tx('readwrite', (s) => s.delete(SLOT) as IDBRequest<undefined>);
  } catch { /* nothing to clear */ }
}
