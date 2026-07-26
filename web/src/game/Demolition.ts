// REMOVAL. The single worst gap in the W6 slice was that a placed thing was
// permanent: a miner on the wrong deposit, a belt one cell short, a furnace
// facing a cliff, and the only remedy was to start again.
//
// ONE KEY, ONE RULE. Aim at anything you put down and press X. What comes back
// is what you paid plus what the machine physically held; what cannot come back
// is COUNTED rather than quietly dropped, because a conservation claim that only
// holds while nothing is destroyed is not a conservation claim.
//
// The two target kinds go to two owners, because they are genuinely different
// objects: a hand-placed furnace is a gameplay.h Furnace with an item behind it,
// and a build-mode machine is a row in the factory plan. Both answer the same
// key and produce the same shaped ledger, which is all a player needs to know.

import type { Factory, Placed } from './Factory.js';
import type { FactoryView } from './FactoryView.js';
import type { GameCore } from './GameCore.js';
import type { Machine, Machines } from './Machines.js';
import type { StructurePart, Structures } from './Structures.js';
import type { StructureView } from './StructureView.js';

export interface DemolishResult {
  kind: string;
  /** What went back into the pack, already named for the toast. */
  refunded: { name: string; count: number }[];
  /** Units that could not survive the removal, and why. Never hidden. */
  lost: { what: string; count: number }[];
  message: string;
}

/** Pull up a hand-placed furnace or smelter. */
export function demolishMachine(machines: Machines, game: GameCore,
                                m: Machine): DemolishResult | null {
  const r = machines.remove(m);
  if (r === null) return null;
  const refunded: { name: string; count: number }[] = [];
  if (r.refunded > 0) refunded.push({ name: game.itemName(r.item), count: r.refunded });
  if (r.ingots > 0) {
    // The output item is the furnace's own; by the time remove() returns the
    // handle is gone, so the name comes from what smelting produces.
    refunded.push({ name: 'ingots', count: r.ingots });
  }
  const lost: { what: string; count: number }[] = [];
  if (r.oreLost > 0) lost.push({ what: 'ore still in the pool', count: r.oreLost });
  return {
    kind: m.tier === 1 ? 'smelter' : 'furnace',
    refunded, lost,
    message: describe(m.tier === 1 ? 'smelter' : 'furnace', refunded, lost),
  };
}

/** Pull up a miner, a belt tile or a smelter from the factory plan. */
export function demolishBuild(factory: Factory, view: FactoryView, game: GameCore,
                              b: Placed): DemolishResult | null {
  const id = b.id;
  const r = factory.remove(b);
  if (r === null) return null;
  // The instance has to be handed back BEFORE the next sync, or the batch keeps
  // drawing the machine at its last transform for ever.
  view.release(id);
  const refunded = r.refunded.map((x) => ({ name: game.itemName(x.item), count: x.count }));
  const lost = r.lostInFlight > 0
    ? [{ what: 'items on the belts', count: r.lostInFlight }] : [];
  return { kind: b.kind, refunded, lost, message: describe(b.kind, refunded, lost) };
}

/**
 * Pull up a foundation, floor, wall or door. The FULL cost comes back, unlike a
 * machine, because a structure holds nothing and loses nothing: there is no
 * pool, no belt and no in-flight item, so anything less than a full refund would
 * be a tax on changing your mind about a wall.
 */
export function demolishStructure(structures: Structures, view: StructureView,
                                  game: GameCore,
                                  p: StructurePart): DemolishResult | null {
  const id = p.id;
  const r = structures.remove(p);
  if (r === null) return null;
  view.release(id);
  const refunded = r.refunded.map((x) => ({ name: game.itemName(x.item), count: x.count }));
  return { kind: p.kind, refunded, lost: [], message: describe(p.kind, refunded, []) };
}

function describe(kind: string, refunded: { name: string; count: number }[],
                  lost: { what: string; count: number }[]): string {
  const parts = [`removed ${kind}`];
  if (refunded.length > 0) {
    parts.push(`+${refunded.map((r) => `${r.count} ${r.name}`).join(', +')}`);
  }
  // The loss is said out loud, in the same toast, with no softening.
  for (const l of lost) parts.push(`lost ${l.count} ${l.what}`);
  return parts.join('  ');
}

/**
 * The X key's whole handler: whichever of the two targets is under the
 * crosshair, removed through its own owner. The machine wins a tie for the same
 * reason it takes the mine key: it is the nearer, larger object, and a belt tile
 * behind it must not steal the press.
 */
export function demolishAimed(g: { machines: Machines; game: GameCore;
                                   factory: Factory; factoryView: FactoryView;
                                   structures: Structures;
                                   structView: StructureView },
                              machine: Machine | null,
                              build: Placed | null,
                              part: StructurePart | null = null): DemolishResult | null {
  if (machine !== null) return demolishMachine(g.machines, g.game, machine);
  if (build !== null) return demolishBuild(g.factory, g.factoryView, g.game, build);
  if (part !== null) return demolishStructure(g.structures, g.structView, g.game, part);
  return null;
}
