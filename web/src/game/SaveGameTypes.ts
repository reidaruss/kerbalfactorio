// The type/data half of SaveGame.ts (see that file's header: the save slot,
// DW-17). Split out at the 400-line cap: every declaration here is a type or
// interface, none of it behaviour, so the move is verbatim with no
// export-prefix changes (all eight were already exported). SaveGame.ts
// re-exports them so the many real importers (AntennaSave.ts, FactoryRescue.ts,
// PersistProgress.ts, PersistSlot.ts, SaveKeys.ts, SaveSlots.ts, SaveWorlds.ts,
// WorldScope.ts, Persist.ts) keep importing from './SaveGame.js' unchanged.

import type { GameMode } from './GameMode.js';
import type { AssistedRecord } from './Assisted.js';
import type { SavedEdits } from './VoxelSave.js';
import type { SaveWorld } from './SaveWorlds.js';
import type { SaveSite, SaveStructure } from './StructureSave.js';
import type { SavePad } from './LaunchPadSave.js';
import type { PlayerHealthSave } from './PlayerHealth.js';
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
  /** WG-151: the POI/site table's two bits (known, visited), as
   *  `SiteCatalog::serialize`'s delta-varint byte stream -- the known ids,
   *  then the visited ids. NAMED `poi` AND NOT `sites`: that key already means
   *  the base's spawn-spiral SITE FRAMES (`StructureSave.ts`'s `SaveSite`),
   *  and reusing it here would silently collide the two on read. Absent on
   *  any slot written before this existed, which reads as a world where no
   *  ruin has been scanned or visited - the honest answer for a save that
   *  never recorded either bit. Additive and optional under exactly the rule
   *  `discovery` was added by, so SAVE_VERSION deliberately does NOT move: a
   *  bump refuses every existing world, and nothing here would MISREAD an old
   *  slot. */
  poi?: number[];
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
  /** GP-533: the scanning antennas. `SaveStation`'s own shape and `SaveStation`'s
   *  own type: an antenna holds nothing either, so its whole state is where it
   *  stands and which way it faces. Additive and optional under the identical
   *  rule `stations` was added by, so SAVE_VERSION deliberately does NOT move.
   *  What it does NOT carry is the reveal itself: which sites are known is
   *  `poi` above, /core's own state, so a world saved with an antenna standing
   *  restores both facts independently and cannot have one without the other. */
  antennas?: SaveStation[];
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

/** Why a slot that EXISTS was not loaded. Empty means it was, or there was none. */
export type SlotRefusal = '' | 'version' | 'mode';

export interface SlotRead {
  slot: SaveSlot | null;
  refusal: SlotRefusal;
  /** The mode the refused slot claims, so the message can name it. */
  foundMode: GameMode | null;
}
