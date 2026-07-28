// Pure mappings from /core's progression state to what the three screens want
// to see, in the same spirit and the same file position as GameplayViews.ts:
// nothing below touches the pointer, the tick or the scene.
//
// THE SENTENCE IS COMPOSED HERE AND NOWHERE ELSE. `/core` returns a refusal as
// a CODE plus the offending id, deliberately, because it has no item names and
// because a code is a testable assertion where a string is not. This file has
// the names, so this file writes the line. Everything a player reads about why
// a tech is greyed comes out of `reasonFor` below, once.

import { BLOCK, type Research, type Tech } from './Research.js';
import { Q16_ONE, type Power } from './Power.js';
import type { GameCore } from './GameCore.js';
import type { Progression } from './Progression.js';
import type { IconFor } from './GameplayViews.js';
import type { ResearchView, TechRow } from '../ui/ResearchPanel.js';
import type { NetworkRow, PowerView } from '../ui/PowerPanel.js';
import type { CarriedArmourRow, EquipSlotRow, EquipView } from '../ui/EquipPanel.js';

const NO_ICON: IconFor = () => '';

/**
 * WHY a tech is greyed, in words, from /core's code plus the ids it named.
 *
 * The three branches are genuinely different sentences and that is the whole
 * reason `status()` returns a code: "you have not built the prerequisite",
 * "you have not done the thing" and "you are three packs short" are three
 * different actions for the player, and a single "cannot research" tells them
 * none of the three.
 */
export function reasonFor(t: Tech, rs: Research, game: GameCore): string {
  switch (t.block) {
    case BLOCK.PrereqMissing: {
      const p = rs.list().find((x) => x.id === t.prereq);
      return `needs ${p?.name ?? 'an earlier technology'} first`;
    }
    case BLOCK.MilestoneMissing: {
      const what = rs.milestoneName(t.milestone);
      return what === '' ? 'needs something you have not done yet'
        : `you must ${what} before this can be researched`;
    }
    case BLOCK.CostShort:
      return `${t.shortBy} more ${game.itemName(t.costItem)}`;
    default:
      return '';
  }
}

/** What a tech makes available, as names a player recognises. */
function unlockNames(t: Tech, game: GameCore): string[] {
  const out: string[] = [];
  for (const u of t.unlocks) {
    if (u.kind === 0) out.push(game.itemName(u.id));
    else if (u.kind === 1) out.push(`entity 0x${u.id.toString(16)}`);
    else out.push(`recipe 0x${u.id.toString(16)}`);
  }
  // A tech that grants no ITEM still grants something, and saying so is better
  // than an empty line: DW-29's autopilot is a capability, not a thing.
  if (out.length === 0) out.push('a new capability');
  return out;
}

export function researchView(rs: Research, game: GameCore,
                             icon: IconFor = NO_ICON): ResearchView {
  const techs = rs.list();
  const rows: TechRow[] = techs.map((t) => ({
    id: t.id,
    name: t.name,
    tier: t.depth,
    state: t.unlocked ? 'unlocked' : t.canResearch ? 'available' : 'blocked',
    reason: t.unlocked || t.canResearch ? '' : reasonFor(t, rs, game),
    prereqs: t.prereqs,
    cost: t.cost.map((c) => {
      const name = game.itemName(c.item);
      return { item: c.item, name, have: c.have, need: c.need, icon: icon(name) };
    }),
    unlocks: unlockNames(t, game),
  }));
  const science = rs.scienceItems().map((item) => {
    const name = game.itemName(item);
    return { item, name, count: game.count(item), icon: icon(name) };
  });
  return {
    techs: rows, science,
    done: techs.filter((t) => t.unlocked).length,
    total: techs.length,
  };
}

/**
 * The grid, as the panel draws it.
 *
 * `satisfaction` is derived from /core's Q16 integer at the LAST possible
 * moment and the integer travels alongside it untouched, so a probe can compare
 * against the headless number rather than against a percentage that has been
 * through a float and a `toFixed`. 90 kW against 120 kW is 49152 exactly.
 */
export function powerView(power: Power, offGrid = 0,
                          offGridGenerators = 0): PowerView {
  const networks: NetworkRow[] = power.networks().map((n) => ({
    id: n.id,
    capacityW: n.capacityW,
    productionW: n.productionW,
    demandW: n.demandW,
    consumptionW: n.consumptionW,
    satisfaction: n.satisfactionQ16 / Q16_ONE,
    satisfactionQ16: n.satisfactionQ16,
    poles: n.poles,
    generators: n.generators,
    fuelledGenerators: n.fuelledGenerators,
    consumers: n.consumers,
    history: power.history(n.id).map((s) => ({
      productionW: s.productionW,
      demandW: s.demandW,
      satisfaction: s.satisfactionQ16 / Q16_ONE,
    })),
  }));
  return { enabled: power.enabled, networks, offGrid, offGridGenerators };
}

export function equipView(pg: Progression, game: GameCore,
                          icon: IconFor = NO_ICON): EquipView {
  const defs = pg.armour();
  const worn = pg.wornAll();
  const slots: EquipSlotRow[] = worn.map((item, slot) => {
    const d = defs.find((a) => a.item === item);
    const name = item > 0 ? game.itemName(item) : '';
    return {
      slot, slotName: pg.slotName(slot), item, name,
      icon: name === '' ? '' : icon(name),
      stats: d?.stats ?? { reduction: 0, moveSpeedMul: 1, insulationC: 0 },
    };
  });
  // Only armour the player is CARRYING, so the column is a list of things they
  // can act on rather than a catalogue of things they cannot.
  const carried: CarriedArmourRow[] = [];
  for (const a of defs) {
    const count = game.count(a.item);
    if (count <= 0) continue;
    const name = game.itemName(a.item);
    carried.push({
      item: a.item, name, slot: a.slot, slotName: pg.slotName(a.slot),
      icon: icon(name), count, stats: a.stats,
    });
  }
  return {
    slots, carried,
    total: pg.total(),
    skills: pg.skills().map((s) => ({
      id: s.id, name: s.name, level: s.level, xp: s.xp,
      progress: s.progress, multiplier: s.multiplier, nextAt: s.nextAt,
    })),
    appearance: pg.appearance(),
    palettes: {
      skin: pg.palette(0), suit: pg.palette(1), visor: pg.palette(2),
      // The three build labels are the client's own words for a byte /core
      // documents as "0 slight, 1 average, 2 heavy". Three strings, and the
      // ORDER is the contract, which is why they are here beside the palettes
      // rather than typed into the panel.
      build: ['slight', 'average', 'heavy'],
    },
  };
}
