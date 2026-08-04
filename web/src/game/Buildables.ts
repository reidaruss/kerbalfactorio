// GP-110 / GP-111. EVERY BUILDING THE PLAYER CAN PUT DOWN, WITH ITS PRICE.
//
// Reid: "instead of having to craft all these structures and stuff, it should
// come from the build menu, and you just have to have the raw resources in
// survival."
//
// THE BOUNDARY (GP-110), because this is an economy change and not a menu:
//
//   A BUILDING IS PAID FOR IN RAW MATERIALS AT THE MOMENT IT IS PLACED, AND
//   NEVER EXISTS AS A CARRIED ITEM. CRAFTING MAKES ITEMS; THE BUILD MENU MAKES
//   BUILDINGS.
//
// Two thirds of that was already true and nobody had said it. `gameplay.h` S.6
// prices a foundation at 40 Stone and a launch pad at 60 Iron + 120 Stone + 20
// Copper, charges them through `of_gp_structure_pay` at the placement, and
// deliberately keeps them OUT of `handRecipes()`. So structures and the pad are
// the model, not the exception, and nothing about them changes tonight.
//
// The HAND FURNACE and the HAND SMELTER were the exception, and they are what
// Reid meant by "and stuff": both required a crafted item in the pack, which is
// the crafting step he is asking to delete. They are brought into the rule in
// GP-114 by CRAFTING ON DEMAND at the placement, so the raw materials are
// enough and the charge still happens exactly once, through /core's own recipe.
//
// THE SIX FACTORY MACHINES ARE FREE TO PLACE and stay free tonight, and this
// menu SAYS "free" rather than inventing a price. The charge belongs at
// `Factory.stage`, which is another lane's file this round; the moment it lands
// there, this menu shows it with no change here, because the price it draws is
// read from /core's recipe table and not from a copy. Raised to Admin.
//
// THE TWO ROUTES CANNOT CHARGE DIFFERENTLY, and the reason is structural rather
// than careful: picking from this menu ARMS THE SAME `BuildMode` the hotbar
// arms (GP-112), so both routes reach the identical commit and the identical
// payment. This file computes no price of its own; it only reads and displays
// the ones the commit will charge.
//
// NO ID TABLE LIVES HERE, deliberately. `GATED_BY_ITEM` already maps the three
// powered machines to their ItemIds, `GameCore.ids` reads the two hand machines
// out of /core at boot, and a machine that is in neither has no recipe in /core
// at all and is therefore free. So there is no fourth naming authority to go
// stale, which is the mistake this project has paid for five times.

import { costText } from './CostText.js';
import { GATED_BY_ITEM, TYPE_ID } from './FactoryKinds.js';
import { STRUCTURE_KINDS, type StructureKind } from './StructureGrid.js';
import { PART_INFO, type PartKind, type SlotContent } from './Hotbar.js';
import type { Gameplay } from './Gameplay.js';

/** What the menu draws for one buildable. Plain data: src/ui knows no more. */
export interface BuildRow {
  /** The id the menu sends back on a click. A `PartKind`, or `furnace:N`. */
  id: string;
  label: string;
  icon: string;
  group: string;
  /** The whole price on one line, or 'free'. */
  cost: string;
  /** Per ingredient, so a row can grey the line the player is short of. */
  needs: { item: number; name: string; have: number; need: number }[];
  affordable: boolean;
  /** '' when it is unlocked, otherwise the tech that would unlock it. */
  lockedBy: string;
  inHand: boolean;
}

const GROUP: Partial<Record<string, string>> = {
  foundation: 'Structures', floor: 'Structures', wall: 'Structures',
  door: 'Structures', launchpad: 'Launch',
  pole: 'Power', generator: 'Power', esmelter: 'Power',
};

/**
 * THE WHOLE MENU, derived on every open and never cached.
 *
 * `techForItem` walks the tech tree and rebuilds every `Tech` on each call, so
 * it is asked once per LOCKED row and never per frame; the menu diffs its own
 * render key, so this runs when something moved and not otherwise.
 */
export function buildRows(g: Gameplay): BuildRow[] {
  const rows: BuildRow[] = [];
  const held = g.hotbar.held;
  const heldPart = held.kind === 'part' ? held.part : null;
  for (const k of STRUCTURE_KINDS) {
    rows.push(structureRow(g, k, heldPart === k));
  }
  // DERIVED FROM `TYPE_ID`, which is a `Record<BuildKind, number>` and is
  // therefore exhaustive by construction: a machine kind added next month must
  // appear in it or the build stops, so it appears here too and cannot be a
  // buildable this menu silently cannot reach. That is the same enforcement
  // ModalStack gives Escape and `PART_INFO` gives the HUD.
  for (const k of Object.keys(TYPE_ID)) rows.push(machineRow(g, k, heldPart === k));
  rows.push(padRow(g, heldPart === 'launchpad'));
  for (const tier of [0, 1]) rows.push(handRow(g, tier, held.kind === 'furnace'));
  return rows;
}

/** What a click on `id` puts in the player's hand, or null for an unknown id. */
export function contentFor(id: string): SlotContent | null {
  if (id.startsWith('furnace:')) {
    return { kind: 'furnace', tier: Number(id.slice(8)) };
  }
  return isBuildable(id) ? { kind: 'part', part: id } : null;
}

function isBuildable(id: string): id is PartKind {
  return Object.prototype.hasOwnProperty.call(PART_INFO, id);
}

// --- one row per family ------------------------------------------------------

function structureRow(g: Gameplay, kind: StructureKind, inHand: boolean): BuildRow {
  const d = g.structures.defFor(kind);
  return {
    // GP-130: BY ITEM ID and not by display name. `PART_INFO[kind].iconName` is
    // '' for all four, because a structural part never enters the pack and so
    // nothing had ever needed a picture of one; the id is on the `StructureDef`
    // /core already hands over, and it is the identity that lasts.
    id: kind, label: PART_INFO[kind].label,
    icon: g.icons.forId(d?.item ?? 0), group: 'Structures',
    cost: g.structures.costText(kind),
    needs: (d?.cost ?? []).map((c) => ingredient(g, c.item, c.count)),
    affordable: g.structures.canAfford(kind),
    lockedBy: '', inHand,
  };
}

function padRow(g: Gameplay, inHand: boolean): BuildRow {
  const d = g.pads.definition;
  const item = d?.item ?? 0;
  return {
    id: 'launchpad', label: PART_INFO.launchpad.label,
    icon: g.icons.forId(item), group: 'Launch',
    cost: g.pads.costText(),
    needs: (d?.cost ?? []).map((c) => ingredient(g, c.item, c.count)),
    affordable: g.pads.canAfford(),
    lockedBy: lockOf(g, item), inHand,
  };
}

/**
 * A factory machine. Its price is whatever /core's recipe for its ITEM says,
 * and a machine with no ItemId here has no recipe in /core either, which is
 * why the fall-through is `free` rather than a lookup failure.
 */
function machineRow(g: Gameplay, kind: string, inHand: boolean): BuildRow {
  const info = PART_INFO[kind as PartKind];
  const item = (GATED_BY_ITEM as Partial<Record<string, number>>)[kind] ?? 0;
  const r = item > 0 ? recipeFor(g, item) : null;
  return {
    id: kind, label: info.label,
    icon: info.iconName === '' ? '' : g.icons.for(info.iconName),
    group: GROUP[kind] ?? 'Production',
    // FREE, and it says so rather than showing an empty price. The placement
    // path really does charge nothing (GP-110): the crafted item in the pack is
    // a research-gate token today and is never consumed.
    //
    // GP-600: this bare `free` and `priceText`'s sandbox form used to be two
    // different words for free on adjacent tiles in one menu. They now differ
    // ON PURPOSE and the difference is the fact: `free` means free in EVERY
    // mode, `free  (sandbox pays ...)` means survival charges and you are not.
    cost: r === null ? costText([], g.mode.freeBuild) : priceText(g, r),
    needs: r === null ? [] : r.needs,
    affordable: true,
    lockedBy: lockOf(g, item), inHand,
  };
}

/**
 * GP-114. A hand furnace or hand smelter, priced in RAW MATERIALS.
 *
 * `affordable` is true when the pack ALREADY holds a finished one, which is the
 * "cannot both charge the player" rule made concrete: a crafted furnace was
 * paid for when it was crafted, so building with it costs nothing more.
 */
function handRow(g: Gameplay, tier: number, holdingAny: boolean): BuildRow {
  const item = tier === 0 ? g.game.ids.furnace : g.game.ids.smelter;
  const name = g.game.itemName(item);
  const have = g.game.count(item);
  const r = recipeFor(g, item);
  return {
    id: `furnace:${tier}`,
    label: tier === 0 ? 'hand furnace' : 'hand smelter',
    icon: g.icons.for(name), group: 'Production',
    cost: have > 0 ? `1 ${name} (already made)`
      : r === null ? costText([], g.mode.freeBuild) : priceText(g, r),
    needs: have > 0 ? [{ item, name, have, need: 1 }] : r?.needs ?? [],
    affordable: g.mode.freeBuild || have > 0 || (r?.affordable ?? false),
    lockedBy: lockOf(g, item),
    // Both hand rows read as in hand together, because a `furnace` slot carries
    // no tier of its own once it is in the bar. The tier the MENU chose is
    // carried on the override and is what `tierToPlace` honours.
    inHand: holdingAny,
  };
}

// --- the shared reads --------------------------------------------------------

interface Priced {
  needs: { item: number; name: string; have: number; need: number }[];
  affordable: boolean;
}

/** /core's own recipe for `item`, as a price. Null when nothing makes it. */
function recipeFor(g: Gameplay, item: number): Priced | null {
  if (item <= 0) return null;
  const r = g.game.recipes().find((q) => q.output === item);
  if (r === undefined) return null;
  return {
    needs: r.inputs.map((i) => ({ item: i.item, name: g.game.itemName(i.item),
      have: i.have, need: i.need })),
    affordable: r.inputs.every((i) => i.have >= i.need),
  };
}

/** The index /core knows this recipe by, for `of_gp_craft`. -1 when none. */
export function recipeIndexFor(g: Gameplay, item: number): number {
  return g.game.recipes().find((q) => q.output === item)?.index ?? -1;
}

function priceText(g: Gameplay, r: Priced): string {
  return costText(r.needs.map((n) => ({ count: n.need, name: n.name })),
                  g.mode.freeBuild);
}

function ingredient(g: Gameplay, item: number, need: number) {
  return { item, name: g.game.itemName(item), have: g.game.count(item), need };
}

/** '' when unlocked or ungated, else the tech that would unlock it. */
function lockOf(g: Gameplay, item: number): string {
  if (item <= 0 || !g.mode.researchGated) return '';
  const rs = g.progress.research;
  if (rs.itemAvailable(item)) return '';
  return rs.techForItem(item)?.name ?? 'a technology';
}

// --- GP-114: raw materials are enough ---------------------------------------

/**
 * WHICH HAND MACHINE TO PUT DOWN, and whether the materials for it exist.
 *
 * Returns the tier, or -1 with nothing available. `want` is the tier the build
 * menu picked, or -1 for "whatever is to hand", which is what the bar's own
 * `furnace` slot means and what `placeMachine` used to decide on its own.
 *
 * THE ORDER IS THE RULE: a FINISHED one in the pack always wins, because it has
 * already been paid for and spending raw materials beside it would be charging
 * twice for one building. Only with none in the pack does the raw recipe get
 * spent, and `craftOnDemand` is what spends it.
 */
export function tierToPlace(g: Gameplay, want: number): number {
  const order = want === 0 || want === 1 ? [want] : [0, 1];
  for (const t of order) if (g.game.count(itemOf(g, t)) > 0) return t;
  for (const t of order) if (recipeFor(g, itemOf(g, t))?.affordable === true) return t;
  return g.mode.freeBuild ? (want < 0 ? 0 : want) : -1;
}

/** Why nothing could be placed, as a whole sentence naming what to go and get. */
export function shortOfText(g: Gameplay, want: number): string {
  const t = want === 0 || want === 1 ? want : 0;
  const r = recipeFor(g, itemOf(g, t));
  if (r === null) return 'nothing to place';
  const short = r.needs.filter((n) => n.have < n.need)
    .map((n) => `${n.need - n.have} more ${n.name}`).join(' and ');
  return short === '' ? 'nothing to place' : `you need ${short}`;
}

/**
 * GP-114. Make sure ONE finished machine of `tier` is in the pack, crafting it
 * out of raw materials if it is not.
 *
 * This is the whole of "you just have to have the raw resources": the crafting
 * step Reid objected to still HAPPENS, at /core's own price, through /core's
 * own `of_gp_craft`, and the player never has to go and press it. Doing it here
 * rather than teaching `Machines.place` to spend materials is what keeps ONE
 * charge on ONE path: the item is made, `Machines.place` consumes it exactly as
 * it always has, and nothing anywhere pays twice.
 *
 * Returns false when it could not, which the caller says out loud.
 */
export function craftOnDemand(g: Gameplay, tier: number): boolean {
  if (g.mode.freeBuild) return true;
  const item = itemOf(g, tier);
  if (g.game.count(item) > 0) return true;
  const index = recipeIndexFor(g, item);
  return index >= 0 && g.game.craft(index);
}

function itemOf(g: Gameplay, tier: number): number {
  return tier === 0 ? g.game.ids.furnace : g.game.ids.smelter;
}
