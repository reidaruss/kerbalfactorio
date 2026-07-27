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
// VOXEL EDITS ARE NOW IN (W7). They were the one glaring gap: a player dug a
// tunnel, reloaded, and walked on flat ground. The diff comes from
// `of_edits_serialize`, the same SaveWriter format as the pack; see VoxelSave.ts
// for why the strike log rides along beside it.
//
// STILL NOT SAVED, and said out loud rather than left to be discovered: a
// furnace's burning fuel, which is a tick countdown with no item to give back.
// It is counted in the report.

const DB = 'orbital-foundry';
const STORE = 'saves';

/**
 * DW-31: A SLOT IS KEYED BY THE MODE THAT CREATED IT, and it also RECORDS that
 * mode inside itself. Two mechanisms, deliberately, because they fail
 * differently.
 *
 * The KEY is what makes contamination structurally impossible: a survival boot
 * reads and autosaves `auto` and a sandbox boot reads and autosaves
 * `auto-sandbox`, so neither run can read the other's world and, far more
 * important, neither can OVERWRITE it. One shared key with a mode field would
 * have been cheaper and wrong: the autosave fires every 20 seconds, so booting
 * the wrong mode would destroy the other world inside half a minute while
 * correctly refusing to load it.
 *
 * The FIELD is the belt and braces. If a slot ever turns up under a key that
 * disagrees with its own record (a hand-edited store, a future migration bug),
 * the load is REFUSED and the refusal is reported rather than best-effort
 * merged, which is the same rule the version check already states: a
 * half-understood save is worse than a fresh world because the player cannot
 * tell which half came back.
 *
 * A slot written before modes existed has no `mode` field and lives under
 * `auto`; both readings make it survival, which is what it is.
 */
function slotKey(mode: GameMode): string {
  return mode === 'sandbox' ? 'auto-sandbox' : 'auto';
}
/** 2: voxel edits joined the slot, so a v1 slot cannot describe the tunnels.
 *  3: a deposit is an ore PATCH rather than a boulder, so the depletion diff is
 *     keyed by patch and a building carries the patch it stands on. A v2 slot
 *     names nodes that no longer hold any ore.
 *  4: BASE BUILDING. The structural parts and their build SITES join the slot.
 *     A v3 slot simply has no base in it, which loads correctly, but the reader
 *     is versioned anyway so a later change to the site frame has a hinge.
 *  5: MACHINES MOVED OFF THE VOXEL LATTICE onto the same metric site grid the
 *     base uses (GP-27). A v4 slot's building positions and cell keys are on
 *     the old lattice, so a belt run restored from one would be laid out to the
 *     old spacing and would never chain to anything placed after the load.
 *
 *  PROGRESSION (research, armour, skills, appearance) joined the slot at ABI 9
 *  and DELIBERATELY DID NOT BUMP THIS, which is worth defending because the
 *  reflex is to bump. `version` is refused on a MISMATCH, not on being older,
 *  so every bump DESTROYS every existing world; it must therefore be spent only
 *  when a reader would MISREAD an old slot. `progress` is optional and absent
 *  from a v5 slot, an absent one restores an unresearched player with an empty
 *  suit, and that is precisely the state a world saved before research existed
 *  WAS. Nothing is misread, so nothing is thrown away. Same call, same
 *  argument, as GP-29's additive `mode` field. */
export const SAVE_VERSION = 5;

import { asMode, type GameMode } from './GameMode.js';
import type { SavedEdits } from './VoxelSave.js';
import type { SaveSite, SaveStructure } from './StructureSave.js';
import type { SavePad } from './LaunchPadSave.js';

export interface SaveBuilding {
  kind: string;
  pos: [number, number, number];
  cell: string;
  up: [number, number, number];
  fwd: [number, number, number];
  /** Drill only: the ore patch it stands on. -1 for anything else. */
  patch: number;
  /** Generator only: fuel units left in it. Absent on a pre-ABI-9 slot, which
   *  restores an empty generator: the honest answer, and the same one a reload
   *  has always given a furnace mid-burn. */
  fuel?: number;
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
  /** DW-31: the mode this world was CREATED in. Optional on the type because a
   *  slot written before modes existed has no field; it reads as survival. */
  mode?: GameMode;
  /** persistence.h bytes from of_gp_inventory_serialize. */
  pack: number[];
  /** Harvest-node depletion: [index, remaining] for every node below full.
   *  Trees only now: an outcrop holds no ore of its own. */
  depletion: [number, number][];
  /** ORE PATCH depletion: [index, remaining] for every patch below full. This
   *  is the diff that matters, because one patch is the whole deposit. */
  patches: [number, number][];
  buildings: SaveBuilding[];
  machines: SaveMachine[];
  /** The dug tunnels: /core's removed-cell bytes plus the strike log. */
  voxels: SavedEdits;
  /** DW-36: what the player has SEEN, as `discovery.h`'s delta-varint byte
   *  stream. Absent on any slot written before it existed, which reads as an
   *  unexplored world - the honest answer for a save that never recorded one.
   *  Additive and optional, so SAVE_VERSION deliberately does NOT move: a bump
   *  refuses every existing world, and nothing here would MISREAD an old slot. */
  discovery?: number[];
  /** The base: the parts, and the site frames they are addressed in. */
  sites?: SaveSite[];
  structures?: SaveStructure[];
  /** GP-57 / DW-29: the launch pads. Additive and optional for the same reason
   *  `discovery` and `progress` are, so SAVE_VERSION deliberately does NOT
   *  move: an absent list is a world with no launch site, which is what every
   *  world written before tonight actually was, so nothing MISREADS an old
   *  slot and a bump would refuse every world anybody is playing. */
  pads?: SavePad[];
  /** The hotbar: which slot is in hand and what is in each of them (GP-26). */
  hotbar?: SaveHotbar;
  /** The progression spine (ABI 9). Optional, and the version was deliberately
   *  NOT bumped for it: see SAVE_VERSION above. An absent one restores an
   *  unresearched player with an empty suit, which is a legal world. */
  progress?: SaveProgress;
}

/**
 * What research and the player themself amount to on disk.
 *
 * TECHS AND MILESTONES ARE SEPARATE LISTS, and that is the point rather than an
 * accident of shape. A tech is something you BOUGHT and restoring it is safe; a
 * milestone is something you DID, and a load path that quietly granted one
 * would hand out DW-29's autopilot to anybody who reloaded. So they travel
 * apart and restore through different calls.
 *
 * The science the player spent is NOT recorded, because the unlock SET is
 * restored directly rather than by replaying the purchases, which would need
 * the exact packs they held at the time.
 */
export interface SaveProgress {
  /** Unlocked TechIds. Order is irrelevant: restore skips prereq checks. */
  techs: number[];
  /** Earned MilestoneIds (DW-29). */
  milestones: number[];
  /** The four worn ItemIds, head/chest/legs/feet, 0 for an empty slot. */
  worn: [number, number, number, number];
  /** Raw xp per skill, in SkillId order. */
  skills: number[];
  /** Five palette indices: skin, suitPrimary, suitSecondary, visor, build. */
  appearance: number[];
}

/** The bar, as plain data. Optional so a slot written before it existed loads. */
export interface SaveHotbar {
  selected: number;
  slots: { kind: string; part?: string }[];
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

/** Write the slot under its OWN mode's key. A save is not a rule, so a failure
 *  resolves false rather than throwing. */
export async function writeSlot(slot: SaveSlot): Promise<boolean> {
  try {
    const key = slotKey(asMode(slot.mode));
    await tx('readwrite', (s) => s.put(slot, key) as IDBRequest<IDBValidKey>);
    return true;
  } catch {
    return false;
  }
}

/** Why a slot that EXISTS was not loaded. Empty means it was, or there was none. */
export type SlotRefusal = '' | 'version' | 'mode';

export interface SlotRead {
  slot: SaveSlot | null;
  refusal: SlotRefusal;
  /** The mode the refused slot claims, so the message can name it. */
  foundMode: GameMode | null;
}

/**
 * Read `mode`'s slot. A version or mode mismatch is a MISS, not an error and
 * not a best-effort load, and the REASON comes back so the player is told.
 *
 * Answering DW-31's question directly: loading a sandbox slot without the flag,
 * or a survival slot with it, does not happen at all, because the two live under
 * different keys. If one somehow turns up under the other's key it is refused
 * here, the fresh world stands, and the slot is left exactly as it was until the
 * running mode's own autosave writes to the running mode's own key.
 */
export async function readSlot(mode: GameMode): Promise<SlotRead> {
  try {
    const v = await tx('readonly',
      (s) => s.get(slotKey(mode)) as IDBRequest<SaveSlot | undefined>);
    if (v === undefined || v === null) return { slot: null, refusal: '', foundMode: null };
    const found = asMode(v.mode);
    if (v.version !== SAVE_VERSION) {
      return { slot: null, refusal: 'version', foundMode: found };
    }
    if (found !== mode) return { slot: null, refusal: 'mode', foundMode: found };
    return { slot: v, refusal: '', foundMode: found };
  } catch {
    return { slot: null, refusal: '', foundMode: null };
  }
}

/** Throw away ONE mode's slot. The other mode's world is not this call's to
 *  destroy, which is the whole reason the keys are separate. */
export async function clearSlot(mode: GameMode): Promise<void> {
  try {
    await tx('readwrite', (s) => s.delete(slotKey(mode)) as IDBRequest<undefined>);
  } catch { /* nothing to clear */ }
}
