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
import type { LaunchPads, PadPart } from './LaunchPad.js';
import type { LaunchPadView } from './LaunchPadView.js';
import type { ResearchStation, ResearchStations } from './ResearchStations.js';

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
                                   structView: StructureView;
                                   pads?: LaunchPads; padView?: LaunchPadView;
                                   stations?: ResearchStations },
                              machine: Machine | null,
                              build: Placed | null,
                              part: StructurePart | null = null,
                              pad: PadPart | null = null,
                              station: ResearchStation | null = null):
DemolishResult | null {
  if (machine !== null) return demolishMachine(g.machines, g.game, machine);
  if (build !== null) return demolishBuild(g.factory, g.factoryView, g.game, build);
  if (part !== null) return demolishStructure(g.structures, g.structView, g.game, part);
  // D-019. The station takes the same place in this order that it takes in
  // `pickAim`: after the deck it may be standing on, before the 24 m pad. The
  // two orders MUST agree or a player aims at one thing and removes another,
  // which is the standing rule at the top of this file.
  if (station !== null && g.stations !== undefined) {
    return demolishStation(g.stations, g.game, station);
  }
  // GP-57. THE PAD IS LAST AND THAT IS THE ORDER, not an afterthought: a pad is
  // 24 m across and a machine or a deck standing on it is inside its bound, so
  // a pad that won the tie would eat every press aimed at anything on it. It is
  // also the only one of the four that can never be aimed at by accident, since
  // reaching it means aiming at the pad itself with nothing in the way.
  if (pad !== null && g.pads !== undefined && g.padView !== undefined) {
    return demolishPad(g.pads, g.padView, g.game, pad);
  }
  return null;
}

/**
 * Take a launch pad back up, with a full refund.
 *
 * 60 Iron is the most expensive single thing a player builds, and a misplaced
 * one is a mistake somebody WILL make: the pad is centred on the cell under the
 * crosshair, so it goes down one cell off more or less exactly as often as it
 * goes down where it was meant to. Without this, that mistake costs an hour of
 * smelting and the only recourse is to build a second platform beside the
 * first. A thing that expensive with no undo is not a difficulty setting.
 */
/**
 * D-019. Take a research station back up, with a FULL refund.
 *
 * Full, for `demolishStructure`'s own reason and not out of generosity: a
 * station holds nothing, has no pool, no belt and no in-flight item, so there is
 * nothing that COULD be lost and anything less would be a tax on changing your
 * mind about where the bench goes. It has no view batch to release, because it
 * draws through its own `THREE.Group` per station rather than through an
 * instanced batch, so `remove` is the whole of the teardown.
 */
export function demolishStation(stations: ResearchStations, game: GameCore,
                                st: ResearchStation): DemolishResult | null {
  const r = stations.remove(st);
  if (r === null) return null;
  const refunded = r.refunded.map((x) => ({ name: game.itemName(x.item), count: x.count }));
  return { kind: 'research station', refunded, lost: [],
    message: describe('research station', refunded, []) };
}

export function demolishPad(pads: LaunchPads, view: LaunchPadView,
                            game: GameCore, p: PadPart): DemolishResult | null {
  const id = p.id;
  const r = pads.remove(p);
  if (r === null) return null;
  view.release(id);
  const refunded = r.refunded.map((x) => ({ name: game.itemName(x.item), count: x.count }));
  return { kind: 'launch pad', refunded, lost: [],
    message: describe('launch pad', refunded, []) };
}
