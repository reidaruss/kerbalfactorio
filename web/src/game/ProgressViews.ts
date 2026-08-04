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
import { AUTOPILOT_ITEM_ID } from './Autopilot.js';
import { TYPE_ID } from './FactoryKinds.js';
import { PART_INFO, type PartKind } from './Hotbar.js';
import type { ModeRules } from './GameMode.js';
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

/**
 * GP-601. AN ENTITY TypeId, IN WORDS.
 *
 * `web/wasm/of_research_api.inc` says in its own comment above
 * `of_rs_tech_unlocks` that the client "labels an entity or recipe id from its
 * own build tables, which is the only place those names exist at all". IT NEVER
 * DID, so the research screen advertised `entity 0x16` at the player. This is
 * that label, and it is DERIVED from the two tables that already exist rather
 * than typed out again: `TYPE_ID` maps a build kind to its TypeId and
 * `PART_INFO` holds the word the rest of the UI already calls it.
 *
 * `smelter` and `esmelter` share TypeId 0x12 by design (FactoryKinds.ts says
 * why), so the first match wins and reads "smelter", which is the honest answer
 * to "what is 0x12" and is the same word the build menu uses.
 *
 * Null when nothing in the client's tables names it, so the caller can say
 * something better than a raw number without this function inventing one.
 */
function entityName(typeId: number): string | null {
  for (const k of Object.keys(TYPE_ID) as (keyof typeof TYPE_ID)[]) {
    if (TYPE_ID[k] === typeId) return PART_INFO[k as PartKind].label;
  }
  // The launch pad is a survival TypeId (`gameplay.h` 0x44) and is not a
  // `BuildKind`, so it is not in `TYPE_ID`. It IS in `PART_INFO`, which is the
  // table this function is supposed to read, so it is named from there.
  if (typeId === 0x44) return PART_INFO.launchpad.label;
  return null;
}

/**
 * GP-601. A factory RecipeId, in words.
 *
 * The two that reach the survival tree are `research.h`'s science recipes, and
 * the client has no table of factory RecipeIds at all: its assembler menu is
 * built from /core's HAND recipes, which carry no RecipeId. So this is the
 * client-side table the `.inc` comment delegates, kept to the ids that are
 * actually reachable and falling through to a sentence rather than to hex.
 */
const RECIPE_NAME: Partial<Record<number, string>> = {
  0x0120: 'Automation science (assembler recipe)',
  0x0121: 'Cinder science (assembler recipe)',
};

/**
 * GP-601. AN ItemId /core HAS NO DISPLAY NAME FOR.
 *
 * `game.itemName` answers `#93` for the autopilot module, which is `#` plus
 * DECIMAL 0x005D: /core's own "I have no name for this" form, drawn at the
 * player on the Flight Autopilot card. The client DOES have a name for it,
 * because `Autopilot.ts` already owns the id and the VAB already calls the part
 * by name, so this maps the one id rather than leaving a number on screen.
 *
 * IT IS A GAP IN /CORE'S REGISTRY AND IT IS ROUTED, NOT PAPERED OVER: the right
 * fix is a display name beside `parts_items::AutopilotModule`, which is another
 * domain's header. This keeps the screen honest until that lands, and the
 * `unnamed` fall-through below makes any FUTURE unnamed item say so in words
 * rather than shipping a second `#93`.
 */
const ITEM_FALLBACK: Partial<Record<number, string>> = {
  [AUTOPILOT_ITEM_ID]: 'autopilot module',
};

/** /core's unnamed form is `#` followed by the decimal id. */
function itemLabel(game: GameCore, id: number): string {
  const n = game.itemName(id);
  if (!/^#\d+$/.test(n)) return n;
  return ITEM_FALLBACK[id] ?? 'an unnamed part';
}

/**
 * What a tech makes available, as names a player recognises.
 *
 * GP-601: DEDUPED, and that is half the fix. Electrification unlocks the power
 * pole and the burner generator BOTH as items and as entities, so the card read
 * `power pole, burner generator, entity 0x16, entity 0x15`: every unlock listed
 * twice, once as a word and once as a number. A player cannot tell that those
 * are four names for two things.
 */
function unlockNames(t: Tech, game: GameCore): string[] {
  const out: string[] = [];
  // CASE-INSENSITIVE, and that is not a nicety. /core capitalises its item
  // names (`Power pole`) and `PART_INFO` does not (`power pole`), so the first
  // version of this dedupe let Electrification print
  // `Power pole, Burner generator, power pole, burner generator`: four names
  // for two things, which is the defect it was written to remove, surviving
  // because two authorities disagreed about a capital letter. Caught by
  // `probes/qolsandbox.js` printing the drawn line rather than by reading.
  const seen = new Set<string>();
  const add = (s: string): void => {
    const k = s.toLowerCase();
    if (seen.has(k)) return;
    seen.add(k);
    out.push(s);
  };
  for (const u of t.unlocks) {
    if (u.kind === 0) add(itemLabel(game, u.id));
    else if (u.kind === 1) add(entityName(u.id) ?? 'a building');
    else add(RECIPE_NAME[u.id] ?? 'a factory recipe');
  }
  // A tech that grants no ITEM still grants something, and saying so is better
  // than an empty line: DW-29's autopilot is a capability, not a thing.
  if (out.length === 0) out.push('a new capability');
  return out;
}

/**
 * GP-600. `mode` is OPTIONAL AND DEFAULTS TO GATED, deliberately.
 *
 * The default is the survival answer, so a caller that forgets to pass the mode
 * gets the screen that has always been drawn rather than a sandbox screen in a
 * survival world. A wrong default that says "this tree gates nothing" in
 * survival would be a far worse lie than the one this fixes.
 */
export function researchView(rs: Research, game: GameCore,
                             icon: IconFor = NO_ICON,
                             mode?: ModeRules): ResearchView {
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
    gated: mode?.researchGated ?? true,
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
