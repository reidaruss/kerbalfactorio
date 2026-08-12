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
/** GP-136: EXPORTED so `SaveKeys.ts` can copy a named slot into the autosave
 *  key. Loading is a copy plus a reload, never an in-place apply. */
export function slotKey(mode: GameMode): string {
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
import { assistedFor, restoreAssisted, type AssistedRecord } from './Assisted.js';
import type { SavedEdits } from './VoxelSave.js';
import type { SaveWorld } from './SaveWorlds.js';
import type { SaveSite, SaveStructure } from './StructureSave.js';
import type { SavePad } from './LaunchPadSave.js';
import type { PlayerHealthSave } from './PlayerHealth.js';
import { savePlayerAnchor, saveVessels, stashVessels } from './VesselSave.js';
import { currentDayT, stashDayT } from '../sim/DayCycle.js';
import { currentStationPower, stashStationPower } from './StationGravity.js';
import type { SavePlayerAnchor, SaveVessel } from './VesselSave.js';

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
  /** FS-46: written by the PORT model (FS-44). Absent on every slot written
   *  before it, and that absence is what triggers the one-time migration in
   *  `FactoryMigrate`. Additive and optional under exactly the rule `discovery`,
   *  `pads`, `health`, `vitals` and `progress` were added by, so SAVE_VERSION
   *  deliberately does NOT move: a bump is refused on MISMATCH and would
   *  therefore destroy every world anybody is playing, and an absent flag is not
   *  MISREAD, it is read as what it is. */
  ports?: boolean;
  /** FS-56, assembler only: the OUTPUT ITEM of the recipe the player selected,
   *  0 for none and for every other kind. The output item and not an index into
   *  /core's recipe list, because `handRecipes()` is append-only and its ordinals
   *  move when a row is inserted, while an ItemId is pinned and never reused.
   *  Additive and optional under exactly the rule `fuel` and `ports` were added
   *  by, so SAVE_VERSION deliberately does NOT move: an absent field is not
   *  misread, it is read as an unset machine, which is a state the panel already
   *  has a sentence for. */
  recipe?: number;
  /** FS-70, chest only: WHAT IS IN IT, as `[ItemId, count]`. Absent on every
   *  slot written before FS-70 and on every other kind, and an absent field
   *  reads as an empty chest, which is the only honest answer for a world saved
   *  before chests existed.
   *
   *  BOTH NUMBERS OR NEITHER. A count without its item cannot be restored: a
   *  container claims its type from whatever arrives first, so a chest brought
   *  back holding 40 untyped units would let the next inserter decide what they
   *  were. Additive and optional under exactly the rule `fuel`, `ports` and
   *  `recipe` were added by, so SAVE_VERSION deliberately does NOT move. */
  store?: [number, number];
}

/**
 * FS-70: what a chest slot's `store` should say, LIVE.
 *
 * It lives here rather than at the one call site in `Persist` because that file
 * has been at its 400-line cap since PersistLedger was moved out of it, and
 * because the rule this encodes is the FIELD's rule: read the container when one
 * exists and the plan when it does not, exactly as `commitPlan` does, so a
 * committed chest and an uncommitted one never disagree about what is in them.
 * The typed parameters keep `SaveGame` from importing `Factory`.
 */
export function chestStore(
    line: { containerItem(b: number): number; containerCount(b: number): number },
    p: { kind: string; build: number; storeItem: number; storeCount: number },
): [number, number] | undefined {
  if (p.kind !== 'chest') return undefined;
  return p.build >= 0 ? [line.containerItem(p.build), line.containerCount(p.build)]
    : [p.storeItem, p.storeCount];
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

/** D-019. One placed research station. It holds NOTHING, so its whole state is
 *  where it stands and which way it faces: no pool, no fuel, no tray, and
 *  therefore nothing a reload could lose and nothing to count as lost. */
export interface SaveStation {
  pos: [number, number, number];
  quat: [number, number, number, number];
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
  /** WORLD ROCK depletion (WG-70): [latCell, lonCell, slot, remaining] per
   *  touched rock, keyed by RockField's lattice cell rather than by array
   *  index, because streamed rocks join the /core node array in VISIT order
   *  and an index-keyed diff would drain somebody else's node on reload.
   *  Optional and additive: absent on older slots, which reads as no rock ever
   *  harvested, and per the WG-29 lesson an optional field must NOT bump
   *  SAVE_VERSION (the check is `!==`, a bump orphans every existing world). */
  rocks?: [number, number, number, number][];
  /** WORLD TREE depletion (WG-119): [latCell, lonCell, slot, remaining] per
   *  chopped tree, keyed by TreeField's lattice cell for exactly the reason
   *  `rocks` above is, and additive and optional under exactly the same rule,
   *  so SAVE_VERSION deliberately does NOT move. An absent list is a world
   *  where no streamed tree was ever chopped, which is what every world written
   *  before tonight is; the check is `!==`, so a bump orphans all of them. */
  trees?: [number, number, number, number][];
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
  /** D-019: the research stations. Additive and optional under exactly the rule
   *  `pads` was added by, so SAVE_VERSION deliberately does NOT move: an absent
   *  list is a world with no research station, which is what every world
   *  written before tonight actually was, so nothing MISREADS an old slot and a
   *  bump would refuse every world anybody is playing. Its consequence is worth
   *  stating: a world saved before tonight reloads with the research key
   *  refusing, which is not a regression but the new rule applied honestly to a
   *  world that never built one. */
  stations?: SaveStation[];
  /** The hotbar: which slot is in hand and what is in each of them (GP-26). */
  hotbar?: SaveHotbar;
  /** GP-65: what is BROKEN, as `[healthKey, hp]` for every placed thing below
   *  full health, and nothing at all for the ones that are fine. An undamaged
   *  world writes an empty list, so this costs a base nobody has attacked
   *  exactly two bytes, and anything in it is by construction a building that
   *  has taken damage. The CEILING is not written: it is catalogue data, and
   *  re-reading it from the table is what lets a rebalance reach worlds that
   *  already exist. Additive and optional under the same rule `discovery`,
   *  `pads` and `progress` were added by, so SAVE_VERSION deliberately does NOT
   *  move: an absent list is an undamaged world, which is what every world
   *  written before tonight actually was. */
  health?: [string, number][];
  /** GP-79: the PLAYER's own health and death count. Additive and optional
   *  under the same rule as `health` above; absent reads as a player at full
   *  health, which is what every world written before tonight was. */
  vitals?: PlayerHealthSave;
  /** The progression spine (ABI 9). Optional, and the version was deliberately
   *  NOT bumped for it: see SAVE_VERSION above. An absent one restores an
   *  unresearched player with an empty suit, which is a legal world. */
  progress?: SaveProgress;
  /** PH-67: THE VESSELS. A rolled-out rocket, one in ascent and one in orbit are
   *  three different states of the same record and all three live here. Before
   *  this field a vessel was not in the slot AT ALL (R12), so rolling out and
   *  closing the tab lost the rocket in silence. Additive and optional under
   *  exactly the rule `discovery`, `pads`, `health`, `vitals`, `progress` and
   *  `assisted` were added by, so SAVE_VERSION deliberately does NOT move: an
   *  absent list is a world with no vessels, which is what every world written
   *  before tonight was, and a bump is refused on MISMATCH and would destroy
   *  every one of them. */
  vessels?: SaveVessel[];
  /** PH-68 / R13: WHERE THE PLAYER'S BODY WAS. `SaveSlot` had no player key at
   *  all, so a reload teleported you to the scenario spawn whatever you were
   *  doing. With a vessel now persisting, that is no longer an annoyance but an
   *  incoherence: a rocket in orbit above a body that has been moved half a
   *  planet. Same additive-and-optional rule; absent restores the scenario
   *  spawn, which is the old behaviour exactly. */
  player?: SavePlayerAnchor;
  /** PH-86: THE TIME OF DAY, as the sun angle in turns [0,1), so a save made at
   *  noon loads at noon. Stamped at the `writeSlot` choke point from the day
   *  clock (`sim/DayCycle.ts`), on PH-67's argument. Additive and optional under
   *  exactly the rule `vessels` and `player` were added by, so SAVE_VERSION
   *  deliberately does NOT move: an absent field seeds from the boot solve,
   *  which is the exact behaviour every slot written before the cycle existed
   *  has always had (the spawn boots lit). */
  dayT?: number;
  /** PH-108: WHETHER THE STATION'S ARTIFICIAL GRAVITY IS RUNNING. Stamped at
   *  the same `writeSlot` choke point and for the same reason, because the
   *  defect it closes is narrow and real: switch the generator off, float down
   *  the corridor, reload, and you are standing up in gravity again with
   *  nothing to say the world undid the only thing you did to it. A station
   *  that is powered before a reload and dead after is worse than one that was
   *  never powered. Additive and optional under exactly the rule `dayT` was
   *  added by, so SAVE_VERSION deliberately does NOT move: an absent field
   *  leaves the default of TRUE standing, which is the behaviour of every slot
   *  written before the generator existed. It is `undefined`, never `false`,
   *  that means "this slot predates the field" -- see `stashStationPower`. */
  stationPower?: boolean;
  /** PS-40: WHICH BODY THE FIELDS ABOVE DESCRIBE. `SaveSlot` had no body key at
   *  all, so booting the same world with `?body=cinder` restored the Forge
   *  world onto the moon and then autosaved the moon back over it. Absent reads
   *  as 0 (Forge), which is what every slot written before tonight is. See
   *  `SaveWorlds.ts` for the measurement and for why this is a bucket and not a
   *  second key. Additive and optional under exactly the rule `dayT` and
   *  `stationPower` were added by, so SAVE_VERSION deliberately does NOT move. */
  body?: number;
  /** PS-41: the OTHER bodies' worlds, each complete and each naming its body.
   *  A load applies the one that matches the running body and CARRIES THE REST
   *  THROUGH UNTOUCHED, which is what makes visiting the moon safe: the Forge
   *  world is not read, not merged and not overwritten. Absent reads as a world
   *  that has only ever been played on one body. Same additive rule, so
   *  SAVE_VERSION deliberately does NOT move. */
  others?: SaveWorld[];
  /** GP-102: which CHEATS this world has had used on it, in first-use order.
   *  Survival only; a sandbox slot never carries one, because `mode: sandbox`
   *  already says the stronger thing. Additive and optional under exactly the
   *  rule `discovery`, `pads`, `health`, `vitals` and `progress` were added by,
   *  so SAVE_VERSION deliberately does NOT move: an absent record is a world
   *  nobody cheated in, which is what every world written before tonight is,
   *  and a bump is refused on MISMATCH and would destroy every one of them. */
  assisted?: AssistedRecord;
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

/** GP-136: EXPORTED for the named-slot layer, which needs the same store and
 *  must not open a second connection to it. */
export async function tx<T>(mode: IDBTransactionMode,
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

/**
 * Write a snapshot of the LIVE world. Under its own mode's autosave key by
 * default; a NAMED save (GP-136) passes its key in.
 *
 * PS-13 / R46: THIS IS THE ONE WRITER OF LIVE SNAPSHOTS, and the `key`
 * parameter is what makes that hold. The named-save path briefly wrote through
 * `SaveKeys.writeKey` directly, on the stated grounds that this function
 * derives its key from the mode, and every field stamped below silently fell
 * out of named saves: a rocket parked in orbit, the player's position and the
 * time of day were all missing, and the save LOOKED complete until it was
 * loaded. Two writers enumerating stamped fields independently is how that
 * happens, so the fix is the parameter, not a second stamping site.
 * `SaveKeys.writeKey` remains the byte-mover for slots that are NOT live
 * snapshots: the load path copies a STORED slot verbatim, and routing that
 * copy through here would overwrite the loaded world's vessels, position and
 * time of day with the live world's, which is the same defect mirrored.
 *
 * A save is not a rule, so a failure resolves false rather than throwing.
 */
export async function writeSlot(slot: SaveSlot, key?: string): Promise<boolean> {
  try {
    key ??= slotKey(asMode(slot.mode));
    // GP-102. THE ASSISTED MARK IS STAMPED AT THE CHOKE POINT, not by whoever
    // built the slot. Every write in the client comes through this one function,
    // so a snapshot path written next month carries the flag without knowing it
    // exists; a field filled in by `Persist.snapshot` would be a field the
    // second snapshot path forgets. Same argument as `HealthCensus`: derive at
    // the one place, never register at the many.
    stampAssisted(slot);
    // PH-67, on GP-102's precedent and for its stated reason. `saveVessels`
    // SYNCS the promoted vessel out of its live `/core` FlightSim before it
    // serialises, as its first statement, so no write path can save a vessel in
    // a place it is not (DW-26). Stamping here rather than in `Persist.snapshot`
    // is what makes that true of `pagehide` and of the debug save as well.
    slot.vessels = saveVessels();
    slot.player = savePlayerAnchor();
    // PH-86, same choke-point argument: the time of day is stamped here so no
    // snapshot path has to know the day clock exists.
    slot.dayT = currentDayT();
    // PH-108, same choke-point argument again, and the reason it is here rather
    // than in a snapshot is that the station's power is not part of any
    // snapshot: it is one module boolean and stamping it at the one writer is
    // the whole of its persistence.
    slot.stationPower = currentStationPower();
    await tx('readwrite', (s) => s.put(slot, key) as IDBRequest<IDBValidKey>);
    return true;
  } catch {
    return false;
  }
}

/**
 * GP-136: THE ONE PLACE THE ASSISTED MARK IS PUT ON A SLOT.
 *
 * `writeSlot` calls it and so does the named-slot layer, because a named save
 * of an assisted world is still assisted and a second place that derived the
 * field would be a second authority on it. Exported rather than inlined for
 * exactly that reason: GP-102's argument was that the mark is stamped at the
 * choke point so no snapshot path can forget it, and there are two writers now.
 */
export function stampAssisted(slot: SaveSlot): SaveSlot {
  slot.assisted = assistedFor(asMode(slot.mode));
  return slot;
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
    // GP-102, and only on a slot that was ACCEPTED: a refused slot is not this
    // world, so its mark is not this world's either.
    restoreAssisted(v.assisted);
    // PH-67, same gate and same argument: the vessels and the body of a REFUSED
    // slot are not this world's either. They are stashed rather than applied,
    // because the flight lane does not exist yet at this point in the boot and
    // the save layer must not reach into it (`ResumeBoot.ts` takes them).
    stashVessels(v.vessels, v.player);
    // PH-86, same gate: an accepted slot's time of day is this world's. The day
    // clock adopts it on the first fixed tick (see sim/DayCycle.ts).
    stashDayT(v.dayT);
    // PH-108, same gate. Applied rather than stashed, unlike the vessels: the
    // volumes are installed AFTER `resumeWorld` (see Boot.ts), so the flag is
    // already correct by the time anything reads it, and a second stash-then-
    // adopt hop would be machinery with nothing to do.
    stashStationPower(v.stationPower);
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
