// PS-40. THE BODY DIMENSION OF A SAVE, which the web slot never had.
//
// WHAT WAS WRONG, MEASURED RATHER THAN ARGUED. `SaveSlot` carried no body field
// at all, and the boot reads the mode's one slot with a single guard on `seed`.
// So booting the same world with `?body=cinder` loads the FORGE world onto the
// moon, and the 20-second autosave then writes the moon's world back over it.
// Driven on the shipped client before any of this existed:
//
//   Forge (radius 600000 m): 10 driven strikes -> 92 removed cells, 620 added,
//     10 ops, saved.
//   boot `?body=cinder` (radius 200000 m): the SAME slot loads, restoring 92
//     cells and 10 ops onto the moon. 5 more strikes there -> 146 / 15, saved.
//   boot Forge again: 146 cells and 15 ops come back, so the Forge world's own
//     save now permanently carries the moon's digging.
//
// AND THE VOXEL SET IS THE MILDEST INSTANCE, which is worth saying because it is
// the one that was reported. A voxel cell is an absolute body-frame metre, and
// the two surfaces are 400 km apart, so a Forge tunnel restored on Cinder lands
// where nobody will ever walk. The sharp ones are keyed by INDEX and by a
// LATITUDE LATTICE, and both bodies answer to the same keys:
//
//   `patches` is [patchIndex, remaining] and BOTH bodies have 4 ore patches, so
//     a deposit mined out on Forge arrives on the moon already empty;
//   `depletion` is [nodeIndex, remaining] into a node array that
//     `NodeField.populate` clears and refills per body;
//   `rocks` / `trees` are [latCell, lonCell, slot, remaining] on a lattice whose
//     step is `CELL_M / bodyRadiusM`, so the same key is a different 3x-sized
//     patch of ground on each body;
//   `discovery` is one `g_disc` whose grid resolution is a function of radius,
//     and `WorldDiscovery::deserialize` ADOPTS the stream's radius, so a Forge
//     lattice is restored and then wiped by the next `of_disc_ensure`.
//
// THE FIX IS A BUCKET AND NOT A KEY, and that is the whole design decision.
// DW-31 keys the slot by MODE precisely so a survival boot cannot overwrite a
// sandbox world, and the reflex is to do the same with the body. It is wrong
// here: the pack, the research, the milestones, the vessels and the time of day
// are ONE world's, not one body's, and a second key would fork the player's
// inventory and tech tree the first time they landed on the moon. So there is
// still exactly one slot per mode, and the BODY-SCOPED half of it lives under a
// body id while the global half stays where it is.
//
// A WORLD THE PLAYER IS NOT STANDING ON IS CARRIED THROUGH UNTOUCHED. That is
// the property that makes the moon safe to visit: the load keeps every world it
// did not apply, and the next write puts them back beside the live one. Nothing
// merges, nothing is re-derived, and no world is ever read by a body it does not
// belong to.
//
// SAVE_VERSION DELIBERATELY DOES NOT MOVE, under exactly the rule `vessels`,
// `player`, `dayT` and `stationPower` were added by (WG-29 / GP-136 / PS-14):
// the reader refuses on MISMATCH rather than on being older, so a bump destroys
// every world anybody is playing. `body` absent reads as 0, which is what every
// slot written before tonight IS, and `others` absent reads as a world that has
// only ever been played on one body, which is also what every one of them is.

import type { SaveSlot } from './SaveGame.js';

/**
 * THE LIST IS THE LOAD-BEARING PART OF THIS FILE.
 *
 * Every field here means something only in one body's frame, lattice or index
 * space. Every field NOT here is true of the world however many bodies it has.
 * `SaveWorld` is derived from this array rather than typed out beside it, so
 * the two cannot drift; and `unclassified` below makes a new `SaveSlot` field
 * that is in NEITHER list a compile error, so the question "which side is this
 * on" has to be answered rather than defaulted.
 */
export const WORLD_KEYS = [
  'depletion', 'patches', 'rocks', 'trees', 'buildings', 'machines', 'voxels',
  'discovery', 'poi', 'sites', 'structures', 'pads', 'health',
] as const;

export type WorldKey = typeof WORLD_KEYS[number];

/** One body's half of a world, complete, and naming the body it belongs to. */
export interface SaveWorld extends Pick<SaveSlot, WorldKey> {
  /** /core `BodyParams::bodyId`. 0 Forge, 1 Cinder. */
  body: number;
}

/**
 * The fields that are true of the WORLD and not of a body. Written out, because
 * this is the half that has to be argued for one field at a time:
 *   `pack` is `g_inv`, one module singleton with no position in it;
 *   `progress` is techs, milestones, armour, skills and appearance;
 *   `hotbar` is a setting; `vitals` is the player; `assisted` is the run;
 *   `dayT` is one sun for the system; `stationPower` is not on a body at all;
 *   `vessels` and `player` are physics' records and are discussed below.
 */
type GlobalKey =
  | 'version' | 'seed' | 'savedAt' | 'mode' | 'pack' | 'hotbar' | 'vitals'
  | 'progress' | 'vessels' | 'player' | 'dayT' | 'stationPower' | 'assisted'
  | 'body' | 'others';

/**
 * THE GATE, and it gates the complaint rather than a proxy for it.
 *
 * The complaint is "a body-scoped field silently stayed global and crossed
 * bodies", which is exactly how this bug arrived: `voxels`, `patches` and
 * `depletion` were each added to `SaveSlot` by a lane that had one body to
 * think about. A test cannot catch that, because the field is correct on the
 * only body anyone ran. The type system can: adding a field to `SaveSlot`
 * without putting its name in `WORLD_KEYS` or in `GlobalKey` makes this alias
 * fail to satisfy its `never` constraint, and the compiler names the field.
 *
 * What it CANNOT check is that the decision was right, only that it was made.
 * That is the honest limit of it and it is still worth having: the failure mode
 * being closed is not a wrong answer, it is no answer.
 */
type MustBeNever<T extends never> = T;
export type UnclassifiedSaveField =
  MustBeNever<Exclude<keyof SaveSlot, GlobalKey | WorldKey>>;

/**
 * A world with nothing in it, for a body this save has never been played on.
 *
 * TYPED AS `SaveWorld` ON PURPOSE, so the compiler requires every REQUIRED
 * body-scoped field to appear here. A future required field that is forgotten
 * fails to compile rather than restoring as `undefined` into `Persist.apply`,
 * which reads `slot.buildings.map` and `slot.machines` with no guard. The
 * OPTIONAL ones are deliberately absent: absent is already documented as the
 * honest default for every one of them, and listing them here would be a second
 * place that decides what an empty world is.
 */
export function emptyWorld(body: number): SaveWorld {
  return {
    body,
    depletion: [], patches: [], buildings: [], machines: [],
    voxels: { cells: [], ops: [] },
  };
}

/** The top-level fields of a slot, read as the world they describe. */
export function worldOf(slot: SaveSlot): SaveWorld {
  const w: Record<string, unknown> = { body: slot.body ?? 0 };
  // EVERY key is set, including the ones that are absent, because these objects
  // are spread over a slot: a key that is missing from the object does not
  // overwrite the slot's, so an omitted `rocks` would leave the OTHER body's
  // rock diff standing. Setting it to an explicit `undefined` does overwrite.
  for (const k of WORLD_KEYS) w[k] = slot[k];
  return w as unknown as SaveWorld;
}

/** The world this slot holds for `bodyId`, or null when it holds none. */
export function worldIn(slot: SaveSlot, bodyId: number): SaveWorld | null {
  if ((slot.body ?? 0) === bodyId) return worldOf(slot);
  return (slot.others ?? []).find((w) => w.body === bodyId) ?? null;
}

/**
 * Every OTHER body's world, deduplicated by body.
 *
 * The dedupe is not defensive decoration: without it a malformed slot holding
 * the same body twice would grow by one world on every save, and a save that
 * grows without bound is the one failure a diff-based format must not have.
 * First wins, which is the same precedence `worldIn` uses.
 */
export function worldsExcept(slot: SaveSlot, bodyId: number): SaveWorld[] {
  const out: SaveWorld[] = [];
  const seen = new Set<number>([bodyId]);
  const take = (w: SaveWorld): void => {
    if (seen.has(w.body)) return;
    seen.add(w.body);
    out.push(w);
  };
  take(worldOf(slot));
  for (const w of slot.others ?? []) take(w);
  return out;
}

/**
 * The slot as `bodyId` should read it: the global half untouched, the
 * body-scoped half replaced by that body's world (or by an empty one), and
 * `others` removed so nothing downstream can read a world that is not this
 * body's.
 *
 * Built by looping `WORLD_KEYS` rather than by spreading, for the reason
 * `worldOf` states: a spread of an object that lacks a key leaves the previous
 * value in place, and the previous value here is another planet's.
 */
export function viewForBody(slot: SaveSlot, bodyId: number): SaveSlot {
  const w = worldIn(slot, bodyId) ?? emptyWorld(bodyId);
  const src = w as unknown as Record<string, unknown>;
  const view = { ...slot } as unknown as Record<string, unknown>;
  view['body'] = bodyId;
  for (const k of WORLD_KEYS) view[k] = src[k];
  delete view['others'];
  return view as unknown as SaveSlot;
}

// ---------------------------------------------------------------------------
// THE CARRY-THROUGH, and why it is module state.
//
// A save is written from the LIVE world, which is one body's. The worlds the
// player is not standing on exist only in the slot that was loaded, so
// something has to hold them between the load and the next write. That is this,
// and it is deliberately the same shape as `stashVessels` / `stashDayT`: one
// module-scoped value, set by the load, read by the write.
//
// IT IS CLEARED, NOT MERELY OVERWRITTEN, when a load does not happen or is
// refused. A refused slot is not this world (DW-31), so its other worlds are
// not this world's either, and carrying them would splice a stranger's moon
// into the save. `Persist.loadSlot` clears on every exit that is not an accept.
// ---------------------------------------------------------------------------
let kept: SaveWorld[] = [];

/** Hold the worlds a load did not apply, so the next write puts them back. */
export function keepWorlds(worlds: SaveWorld[]): void { kept = worlds; }

/**
 * TAKE A SLOT FOR ONE BODY: pick that body's world, keep every other, and hand
 * back the view plus a receipt saying what happened.
 *
 * ONE FUNCTION AND NOT THREE, because the three steps are only correct
 * together. A caller that picked the view and forgot to keep the rest would
 * write a slot with one world in it and delete the player's other planet, and
 * the two calls would sit two lines apart looking fine. Making it impossible to
 * do half of it is worth more than making each half readable.
 */
export function adoptWorldFor(slot: SaveSlot, bodyId: number): {
  view: SaveSlot; hadWorld: boolean; others: number[];
} {
  const hadWorld = worldIn(slot, bodyId) !== null;
  const rest = worldsExcept(slot, bodyId);
  keepWorlds(rest);
  return { view: viewForBody(slot, bodyId), hadWorld, others: rest.map((w) => w.body) };
}

/** What the next write must carry through. Empty on a fresh or refused world. */
export function keptWorlds(): SaveWorld[] { return kept; }

/** For the report and the probe: which bodies this session is carrying. */
export function keptBodies(): number[] { return kept.map((w) => w.body); }
