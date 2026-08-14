// PH-67. A VESSEL IN THE SAVE SLOT, at last.
//
// R12's complaint, verbatim: a rolled-out vessel "is not in the save slot at
// all", so a player who rolls out and closes the tab loses the rocket silently,
// and PH-30's amber chip only warns them while they are aboard. This file is the
// field that was missing.
//
// THE SAVED FORM IS THE REGISTRY RECORD, not a second schema. `VesselRegistry`
// already had to decide what a vessel IS in order to answer "where is it", and a
// save format that re-decided would be a second answer to the same question, in
// a file nobody reads until a reload goes wrong. The only thing dropped is
// `stampedTick`, which is a reference into a loop clock that restarts at zero on
// every page load and is therefore meaningless on disk. Everything else is
// carried verbatim, and `stashVessels` puts it back with `stampedTick: -1`,
// which `clockAt` reads as "the world was not running, so it did not move".
//
// WHERE THE FIELD IS WRITTEN, and it is not where you would guess: the CHOKE
// POINT in `SaveGame.writeSlot`, beside GP-102's `assisted`, and for the reason
// that decision states out loud. Every write in the client funnels through that
// one function, so a snapshot path written next month carries the vessel without
// knowing it exists, whereas a field filled in by `Persist.snapshot` is a field
// the second snapshot path forgets. `Persist.ts` is untouched by this lane.
//
// SYNC BEFORE SERIALISE IS THE WHOLE OF DW-26 HERE. The promoted vessel is live
// in a `/core` FlightSim, and the record is the authority; so the record must be
// brought up to date from the live sim BEFORE it is written, every time, with no
// caller able to forget. `saveVessels` calls the sync hook itself as its first
// statement. That is the mechanism, rather than a rule somebody has to remember,
// and it is why a vessel cannot be saved in a place it is not.
import type { VesselRecord } from '../sim/VesselRegistry.js';
import { registry } from '../sim/VesselRegistry.js';
import { bodyIdOf } from '../world/VesselBody.js';
import type { OfCoreModule } from '../sim/wasm/heap.js';

/** The record without its runtime tick stamp. Same fields, same names. */
export type SaveVessel = Omit<VesselRecord, 'stampedTick'>;

/** Where the walker was standing. PH-68, and it closes R13 as a side effect:
 *  `SaveSlot` had no player key at all, so a reload returned you to the scenario
 *  spawn wherever you were. A vessel in orbit and a body back at spawn is not a
 *  save, it is two half-saves of different worlds. */
export interface SavePlayerAnchor {
  lat: number; lon: number; alt: number;
  /** True when the player was strapped into a vessel at the moment of the save.
   *  Carried so a restore can say what happened rather than silently guessing;
   *  nothing puts the player back INSIDE a vessel, see `PlayerAnchor.ts`. */
  aboard: boolean;
  /** The vessel id they were aboard, or 0. The handoff seam reads this. */
  vesselId: number;
}

type SyncHook = () => void;
let syncHook: SyncHook | null = null;
/** Records read off a slot at boot and not yet adopted. */
let pending: SaveVessel[] | null = null;
let anchorHook: (() => SavePlayerAnchor | null) | null = null;
let pendingAnchor: SavePlayerAnchor | null = null;
let reads = 0;
let writes = 0;

/**
 * Install the "bring the live vessel up to date" call. The flight lane registers
 * with the save path, never the other way round: the save layer must not import
 * the flight layer, because a boot with `?flight=0` still has to write a slot.
 */
export function setVesselSyncHook(fn: SyncHook | null): void { syncHook = fn; }
export function setPlayerAnchorHook(fn: (() => SavePlayerAnchor | null) | null): void {
  anchorHook = fn;
}

/** Called by `SaveGame.writeSlot`. Syncs first, then serialises. */
export function saveVessels(): SaveVessel[] | undefined {
  if (syncHook !== null) syncHook();
  const rows = registry.list().map((r) => {
    const { stampedTick: _drop, ...rest } = r;
    return rest as SaveVessel;
  });
  if (rows.length === 0) return undefined;
  writes += 1;
  return rows;
}

export function savePlayerAnchor(): SavePlayerAnchor | undefined {
  return (anchorHook !== null ? anchorHook() : null) ?? undefined;
}

/** Called by `SaveGame.readSlot` on an ACCEPTED slot only, exactly as GP-102's
 *  `restoreAssisted` is: a refused slot is not this world, so its vessels are
 *  not this world's vessels either. */
export function stashVessels(rows: unknown, anchor: unknown): void {
  pending = Array.isArray(rows) ? (rows as SaveVessel[]) : null;
  pendingAnchor = isAnchor(anchor) ? anchor : null;
  reads += 1;
}

function isAnchor(v: unknown): v is SavePlayerAnchor {
  if (v === null || typeof v !== 'object') return false;
  const a = v as Partial<SavePlayerAnchor>;
  return Number.isFinite(a.lat) && Number.isFinite(a.lon) && Number.isFinite(a.alt);
}

/** Take the stashed rows. Consuming clears them, so a second boot in the same
 *  page (the debug reload path) cannot adopt a world's vessels twice. */
export function takeStashedVessels(): SaveVessel[] | null {
  const p = pending; pending = null; return p;
}
export function takeStashedAnchor(): SavePlayerAnchor | null {
  const p = pendingAnchor; pendingAnchor = null; return p;
}

/**
 * Rehydrate one saved row into a live record. Malformed rows are SKIPPED rather
 * than thrown, the rule `SaveGame` and `VesselDesign.fromJson` both already
 * apply: a hand-edited or truncated slot must never stop a world booting.
 */
export function adoptSaved(rows: readonly SaveVessel[], M: OfCoreModule,
                           bootBodyId: number): number {
  let n = 0;
  for (const row of rows) {
    if (!row || typeof row.id !== 'number' || row.id <= 0) continue;
    if (!row.design || !Array.isArray(row.design.parts)) continue;
    if (!row.where || (row.where.kind !== 'conic' && row.where.kind !== 'fixed')) continue;
    // A row with no handle table is not restorable AS FUELLED, so the fuel goes
    // with it rather than being written to guessed parts. Losing the fuel is a
    // visible, arguable outcome; writing 2150 kg onto whichever part happens to
    // be handle 3 is the silent wrong-but-plausible one this project keeps
    // paying for. Nothing writes such a row today; this is for a truncated slot.
    const ok = Array.isArray(row.handles) && Array.isArray(row.fuel);
    // GP-650. THE BODY IS RESOLVED ON THE WAY IN, ONCE, so nothing downstream
    // has to keep asking and so the next write puts a real id in the slot.
    // `SAVE_VERSION` deliberately does not move, under the rule `vessels`,
    // `player` and `dayT` were added by: an absent field is not a mismatch, and
    // `bodyIdOf` recovers it from the conic's own mu, which is the number
    // `of_orb_park` was handed. See world/VesselBody.ts.
    const rec = { ...(row as SaveVessel), stampedTick: -1,
                  handles: ok ? row.handles : [],
                  fuel: ok ? row.fuel : [] } as VesselRecord;
    rec.bodyId = bodyIdOf(M, rec, bootBodyId);
    registry.adopt(rec);
    n += 1;
  }
  dropOrphanLatches();
  return n;
}

/**
 * PH-366. A LATCH WHOSE HOST IS NOT IN THE SAVE IS DROPPED, LOUDLY IN SHAPE IF
 * NOT IN VOICE.
 *
 * This runs AFTER the adopt loop and not inside it, which is the whole reason
 * it is a separate pass: `adoptSaved` walks rows in slot order, so a guest
 * written before its host would find `registry.byId(hostId)` empty and a check
 * inside the loop would unlatch a perfectly good pair for being in the wrong
 * order. The only rows that survive the loop and still have no host are genuine
 * orphans -- a truncated slot, or a hand edit.
 *
 * The record is kept and only the latch is removed, because the vessel itself
 * is intact: `where` still carries the conic it was mated on, so it comes back
 * floating exactly where it was docked rather than vanishing. What it loses is
 * the claim to be attached to something that is not there, and that claim is
 * the one that would have crashed a consumer.
 */
function dropOrphanLatches(): number {
  let dropped = 0;
  for (const rec of registry.list()) {
    const d = rec.docked;
    if (d === undefined) continue;
    // Self-latch is refused here too, not only in /core: /core's rule guards the
    // capture, and this guards the SAVE, which a capture never touched.
    if (d.hostId === rec.id || registry.find(d.hostId) === null) {
      delete rec.docked;
      dropped += 1;
    }
  }
  orphanLatches += dropped;
  return dropped;
}

/** PH-366. Orphan latches dropped since boot. Published because a repair that
 *  happens silently and a repair that never fires read the same from outside. */
let orphanLatches = 0;

export function vesselSaveReport(): Record<string, unknown> {
  return { reads, writes, pending: pending === null ? 0 : pending.length,
           records: registry.count, promotedId: registry.promotedId,
           demotions: registry.demotions, promotions: registry.promotions,
           // PH-366. How many records came back latched, and how many latches
           // were dropped for pointing at a host that is not in the slot.
           docked: registry.list().filter((r) => r.docked !== undefined).length,
           orphanLatches };
}
