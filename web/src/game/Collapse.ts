// D1. THE MOMENT A BUILDING REACHES ZERO: which population owns it, and the
// removal itself.
//
// Split from `Wreckage.ts` for the reason `Demolition.ts` is split from the four
// populations it drives: this file is the only thing that knows a health key can
// be turned back into a live object, and `Wreckage.ts` is the rubble and its
// arithmetic. Keeping the two apart is what lets the rubble class stay free of
// `GameCore`, of `Structures`, of `Factory` and of every other lane's module.
//
// THE KEYS ARE RE-DERIVED THROUGH `Health.ts`'s OWN FUNCTIONS and never parsed.
// A `key.startsWith('s:')` dispatch would be a second reading of a scheme that
// `Health.ts` already owns, and the failure it invites is silent: a scheme change
// would leave a destroyed building standing while every counter read healthy,
// which is exactly the class of bug `HealthCensus.reconcile` and
// `EnemyTargets.targetsOf` were both written to avoid. So the search is the same
// one those two do: walk the population, ask `Health.ts` what each row's key is,
// match. Four short lists, once per destruction, is not a cost worth trading a
// second authority for.
//
// WHAT `fell` DOES NOT DO. It does not touch the health book. `HealthBook.damage`
// has already put the key at 0, and `HealthCensus.reconcile` runs on the very
// next fixed tick and FORGETS every key whose population no longer holds it, so
// the health row goes away through the path that already exists rather than
// through a second `forget` call here that could drift from it. That is also
// what stops the rubble ever being a target: `Enemies.biteable` filters on
// `hpOf(key) > 0`, and a forgotten key reads 0.

import { factoryHealthKey, machineHealthKey, padHealthKey, structureHealthKey }
  from './Health.js';
import { scavengeOf, type RubbleRow, type Wreckage } from './Wreckage.js';
import type { Factory } from './Factory.js';
import type { FactoryView } from './FactoryView.js';
import type { GameCore } from './GameCore.js';
import type { LaunchPads } from './LaunchPad.js';
import type { LaunchPadView } from './LaunchPadView.js';
import type { Machines } from './Machines.js';
import type { StructureView } from './StructureView.js';
import type { Structures } from './Structures.js';

/** Everything `fell` needs, as the live objects, because a removal is a
 *  mutation of four different owners and there is no port that abstracts it. */
export interface CollapseHost {
  game: GameCore;
  structures: Structures;
  structView: StructureView;
  factory: Factory;
  factoryView: FactoryView;
  machines: Machines;
  pads: LaunchPads;
  padView: LaunchPadView;
  wreckage: Wreckage;
}

type Ledger = { item: number; count: number }[];
type Lost = { what: string; count: number }[];

/**
 * A building has hit 0 hp. Take it down and leave rubble.
 *
 * Returns the pile, or `null` when the key matched nothing standing. Null is
 * counted by the caller as `Wreckage.unresolved` rather than shrugged off: a key
 * at 0 hp with no row behind it is either a building that cannot be felled or a
 * key scheme that has stopped being stable, and both look exactly like a quiet
 * world from every other counter.
 */
export function fell(h: CollapseHost, key: string): RubbleRow | null {
  const s = h.structures.parts.find((p) => structureHealthKey(p.key) === key);
  if (s !== undefined) {
    const at = { ...s.pos };
    const kind = s.kind;
    const id = s.id;
    const r = h.structures.remove(s);
    if (r === null) return null;
    h.structView.release(id);
    return pileUp(h, key, kind, at, r.refunded, []);
  }

  const f = h.factory.placed.find((p) => factoryHealthKey(p.cell) === key);
  if (f !== undefined) {
    const at = { ...f.pos };
    const kind = f.kind as string;
    const id = f.id;
    const r = h.factory.remove(f);
    if (r === null) return null;
    // BEFORE the next sync, exactly as `demolishBuild` does it, or the batch
    // keeps drawing the machine at its last transform for ever.
    h.factoryView.release(id);
    const lost: Lost = r.lostInFlight > 0
      ? [{ what: 'items on the belts', count: r.lostInFlight }] : [];
    return pileUp(h, key, kind, at, r.refunded, lost);
  }

  const m = h.machines.list.find((q) => machineHealthKey(q.pos) === key);
  if (m !== undefined) {
    const at = { ...m.pos };
    const kind = m.tier === 1 ? 'smelter' : 'furnace';
    // READ THE OUTPUT ITEM BEFORE THE REMOVAL. `Machines.remove` reports how
    // many ingots it collected but not WHAT they were, because by the time it
    // returns the /core handle is destroyed and the pair is unaskable. The
    // refund has to be debited by item id, so the id is taken while the furnace
    // still exists. (`demolishMachine` gets away with the string 'ingots'
    // because it only ever names them in a toast.)
    const out = h.game.furnaceState(m.handle)?.outItem ?? 0;
    const r = h.machines.remove(m);
    if (r === null) return null;
    const back: Ledger = [];
    if (r.refunded > 0) back.push({ item: r.item, count: r.refunded });
    if (r.ingots > 0 && out > 0) back.push({ item: out, count: r.ingots });
    const lost: Lost = r.oreLost > 0
      ? [{ what: 'ore still in the pool', count: r.oreLost }] : [];
    return pileUp(h, key, kind, at, back, lost);
  }

  const d = h.pads.list.find((q) => padHealthKey(q.siteId, q.i, q.j, q.level) === key);
  if (d !== undefined) {
    const at = { ...d.pos };
    const id = d.id;
    const r = h.pads.remove(d);
    if (r === null) return null;
    h.padView.release(id);
    return pileUp(h, key, 'launchpad', at, r.refunded, []);
  }

  // NOT counted here. `Gameplay.damage` books every null this returns against
  // `Wreckage.unresolved`, including the ones above where a row WAS found and
  // its own `remove` then refused, so there is one counter and one place that
  // moves it rather than two that can disagree.
  return null;
}

/**
 * Take the refund straight back out of the pack, then leave the pile.
 *
 * See `Wreckage.ts`'s header for why the credit is made and reversed rather
 * than suppressed. `ledger` is what the population says ACTUALLY LANDED, so the
 * debit is exact whether the pack was empty or overflowing; anything
 * `GameCore.remove` cannot find is counted, must be zero, and is published.
 */
function pileUp(h: CollapseHost, key: string, kind: string,
                at: { x: number; y: number; z: number },
                ledger: Ledger, lost: Lost): RubbleRow {
  for (const c of ledger) {
    const took = h.game.remove(c.item, c.count);
    h.wreckage.unrecovered += c.count - took;
  }
  const salvage = scavengeOf(ledger);
  // The scavenge REMAINDER, per item, so the toast can say what the collapse
  // ate rather than only what survived it. `scavengeOf` rounds down, so this is
  // never negative and is the whole ledger for anything too cheap to salvage.
  const all: Lost = [...lost];
  for (const c of ledger) {
    const kept = salvage.find((k) => k.item === c.item)?.count ?? 0;
    if (c.count - kept > 0) {
      all.push({ what: `${h.game.itemName(c.item)} crushed`, count: c.count - kept });
    }
  }
  return h.wreckage.pile(key, kind, at, ledger, salvage, all);
}
