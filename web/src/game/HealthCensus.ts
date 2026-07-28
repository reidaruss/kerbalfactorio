// WHO HAS HEALTH, DERIVED EVERY TICK RATHER THAN REGISTERED AT EVERY SPAWN.
//
// The obvious wiring is a `health.register(...)` call next to each of the six
// places a buildable comes into the world, and it is the wiring that fails
// quietly: the seventh place, written next month, does not have the call, the
// thing it places is immortal, and nothing anywhere says so. That is the same
// shape as the five-per-panel Escape handlers GP-25 replaced with a derived list
// and the stored support depth GP-38 replaced with a walk, so it gets the same
// answer. `reconcile` reads the populations and makes the book agree with them,
// so a new buildable is covered the moment its list is added HERE, in one file,
// and `audit` is a second, independent check that it was.
//
// This file is the ONLY thing that knows what a population is. `Health.ts` holds
// numbers and verbs and has no idea a foundation exists; everything that binds a
// key to a live object is here.

import { factoryHealthKey, factoryMaxHp, machineHealthKey, machineMaxHp,
  padHealthKey, padMaxHp, structureHealthKey, structureMaxHp,
  type HealthBook, type PopulationCensus } from './Health.js';

/** Read-only shapes, so this file can see the four populations without any of
 *  them having to know it exists (and without importing a class whose module
 *  belongs to another lane). Structural typing is the whole reason these are
 *  hand-written rather than imported: `LaunchPads` lives in `LaunchPad.ts`. */
export interface PartsLike { parts: readonly { key: string; kind: string }[] }
export interface PlacedLike { placed: readonly { cell: string; kind: string }[] }
export interface MachinesLike {
  list: readonly { tier: number; pos: { x: number; y: number; z: number } }[];
}
export interface PadsLike {
  list: readonly { siteId: number; i: number; j: number; level: number }[];
}

export interface HealthPopulations {
  structures: PartsLike;
  factory: PlacedLike;
  machines: MachinesLike;
  pads: PadsLike;
}

interface Entry { key: string; maxHp: number }

function entriesOf(p: HealthPopulations): { name: string; rows: Entry[] }[] {
  return [
    { name: 'structures',
      rows: p.structures.parts.map((s) => ({
        key: structureHealthKey(s.key), maxHp: structureMaxHp(s.kind) })) },
    { name: 'factory',
      rows: p.factory.placed.map((f) => ({
        key: factoryHealthKey(f.cell), maxHp: factoryMaxHp(f.kind) })) },
    { name: 'machines',
      rows: p.machines.list.map((m) => ({
        key: machineHealthKey(m.pos), maxHp: machineMaxHp(m.tier) })) },
    { name: 'pads',
      rows: p.pads.list.map((d) => ({
        key: padHealthKey(d.siteId, d.i, d.j, d.level), maxHp: padMaxHp() })) },
  ];
}

/** The four lists as bare keys, for `HealthBook.audit`. */
export function censusOf(p: HealthPopulations): PopulationCensus[] {
  return entriesOf(p).map((e) => ({ name: e.name,
    keys: e.rows.map((r) => r.key) }));
}

/**
 * Make the book agree with the world. Returns what moved, so a caller can see
 * that it did something.
 *
 * REGISTERING IS NOT HEALING: `HealthBook.register` keeps the health a key
 * already has. That is what lets this run on every single tick over a base full
 * of wounded buildings without quietly repairing them, and it is the one
 * property the whole reload proof depends on, so it is stated at both ends.
 *
 * FORGETTING IS UNCONDITIONAL, which is right for demolition and would be wrong
 * during a restore. `Persist.apply` therefore resets the book and reconciles
 * once, AFTER every population is back and BEFORE the saved wounds go on.
 */
export function reconcile(book: HealthBook, p: HealthPopulations):
    { added: number; removed: number; tracked: number } {
  const live = new Set<string>();
  let added = 0;
  for (const pop of entriesOf(p)) {
    for (const r of pop.rows) {
      live.add(r.key);
      if (!book.has(r.key)) added++;
      book.register(r.key, r.maxHp);
    }
  }
  let removed = 0;
  for (const w of book.keys()) {
    if (live.has(w)) continue;
    book.forget(w);
    removed++;
  }
  return { added, removed, tracked: live.size };
}

/**
 * The restore side, as ONE call, because the three steps only work in this order
 * and splitting them across a caller is how the order gets lost.
 *
 * Reset, then reconcile, then lay the wounds on. The reset clears the OUTGOING
 * world (a restore replaces a world rather than merging into one, the rule
 * `Structures.reset` already follows) so an identically-keyed cell in the new
 * world cannot inherit the old one's damage; the reconcile puts every population
 * back at full; and only then do the saved rows land, which is why they can be
 * matched at all. Called AFTER every population has been restored.
 */
export function rebuildHealth(book: HealthBook, p: HealthPopulations,
                              rows: readonly [string, number][] | undefined):
    { applied: number; orphans: number } {
  book.reset();
  reconcile(book, p);
  return book.restore(rows);
}
