// THE HOTBAR: what is in your hand, and therefore what the left button does.
//
// Before this, placing was G and harvesting was E and which of them you got was
// decided by what happened to be under the crosshair. That is backwards. The
// genre convention, and what the player asked for, is that the HAND decides:
// nine slots, the number keys and the wheel choose one, and left click means
// "use whatever that slot holds". A drill in hand builds a drill; a pickaxe in
// hand swings; an empty slot does nothing at all, and the fact that it does
// NOTHING is the assertion that proves the hand is really driving (GP-26).
//
// THE CONTENTS ARE DATA. `DEFAULT_BAR` is the loadout a new player starts with
// and `assign` re-slots it, so a rebalance is an edit to one array. Nothing here
// knows what a drill costs or whether it can be placed: that is BuildMode's and
// /core's, and this file only answers "what is held".

import { STRUCTURE_KINDS, type StructureKind } from './StructureGrid.js';
import type { BuildKind } from './Factory.js';

/**
 * GP-57. The launch pad, as a hand-held part.
 *
 * It is its own string rather than a fifth `StructureKind` because the client's
 * `StructureKind` IS the 4 m tiling module and a 24 m monolith answers none of
 * that enum's questions; see LaunchPad.ts for the whole argument and for why
 * /core's enum of the same name did take it. Here it only has to be a third
 * family the build key can dispatch on.
 */
export type FixtureKind = 'launchpad';
export const FIXTURE_KINDS: readonly FixtureKind[] = ['launchpad'];

/** Anything the build key can put down. Machines TICK and structures do not. */
export type PartKind = BuildKind | StructureKind | FixtureKind;

/**
 * What a slot holds.
 *
 * `hand` is the bare hand and whatever tool the pack makes it worth: it swings
 * at nodes and digs. `part` places. `empty` is a real state and not a synonym
 * for `hand`, because a bar of nine slots that all secretly swing a pickaxe
 * would pass every test for the wrong reason.
 */
export type SlotContent =
  | { kind: 'hand' }
  | { kind: 'part'; part: PartKind }
  /** A hand furnace or smelter out of the pack. It is not a `PartKind`: it is
   *  placed by `Machines`, not by the factory plan, for the same reason GP-19
   *  kept the survival furnace out of the factory sim. */
  | { kind: 'furnace' }
  /** GP-86: the gun. Its own kind rather than a `PartKind`, because it places
   *  nothing and ticks nothing: what it changes is what the LEFT BUTTON DOES,
   *  which is exactly the question this enum exists to answer (GP-26). */
  | { kind: 'gun' }
  | { kind: 'empty' };

/**
 * TEN, and it was nine until GP-57.
 *
 * The bar grew because the game grew: nine slots held nine defaults exactly, so
 * a tenth buildable had nowhere to be held at all. A structural part never
 * enters the pack (gameplay.h §S.6: it is paid for and placed, never crafted
 * into a carried item), so `assignToBar`'s pack-click gesture cannot reach one
 * and the default bar IS the only route to it. A launch pad with no slot would
 * therefore have been a researched, priced, placeable thing no key could hold,
 * which is GP-56's failure class by construction rather than by oversight.
 */
// GP-86 makes it ELEVEN, and the argument is GP-57's verbatim: the bar grows
// because the game grows. A gun has no other home. It is not a `PartKind` so
// `assignToBar`'s pack-click cannot reach it and the default bar is the only
// route, which is precisely the case that made the tenth slot necessary.
export const SLOT_COUNT = 11;

/** Label and icon for every part, in one table so the HUD restates nothing. */
export const PART_INFO: Record<PartKind, { label: string; iconName: string }> = {
  miner: { label: 'mining drill', iconName: 'Miner' },
  belt: { label: 'belt', iconName: 'Belt' },
  smelter: { label: 'smelter', iconName: 'Smelter' },
  // ABI 9. The icon names are the /core ITEM display names, because that is
  // what ItemIcons bakes its pictures under, and the three items exist in the
  // registry exactly so these three rows do not need a fourth naming authority.
  pole: { label: 'power pole', iconName: 'Power pole' },
  generator: { label: 'burner generator', iconName: 'Burner generator' },
  esmelter: { label: 'electric smelter', iconName: 'Electric smelter' },
  foundation: { label: 'foundation', iconName: '' },
  floor: { label: 'floor', iconName: '' },
  wall: { label: 'wall', iconName: '' },
  door: { label: 'door', iconName: '' },
  // The icon name is the /core ITEM display name, which is what ItemIcons bakes
  // its pictures under, so this row needs no second naming authority.
  launchpad: { label: 'launch pad', iconName: 'Launch pad' },
};

/**
 * The starting bar. Slot 1 is the hand, because the first thing a player does
 * on this planet is hit a tree, and slot 1 is where a hand goes.
 */
export const DEFAULT_BAR: readonly SlotContent[] = [
  { kind: 'hand' },
  { kind: 'furnace' },
  { kind: 'part', part: 'miner' },
  { kind: 'part', part: 'belt' },
  { kind: 'part', part: 'smelter' },
  { kind: 'part', part: 'foundation' },
  { kind: 'part', part: 'floor' },
  { kind: 'part', part: 'wall' },
  { kind: 'part', part: 'door' },
  { kind: 'part', part: 'launchpad' },
  { kind: 'gun' },
];

function isPart(k: string): k is PartKind {
  return k === 'miner' || k === 'belt' || k === 'smelter'
    || k === 'pole' || k === 'generator' || k === 'esmelter'
    || (STRUCTURE_KINDS as readonly string[]).includes(k)
    || (FIXTURE_KINDS as readonly string[]).includes(k);
}

export class Hotbar {
  private readonly bar: SlotContent[] = DEFAULT_BAR.map((s) => ({ ...s }));
  /** 0-based. Slot 1 is the hand, so that is where a new game starts. */
  private index = 0;
  /** Selections made, so a probe can prove the wheel actually moved it. */
  changes = 0;

  get selectedIndex(): number { return this.index; }
  get slots(): readonly SlotContent[] { return this.bar; }
  get held(): SlotContent { return this.bar[this.index]; }

  /** The part in hand, or null when the hand is bare or the slot is empty. */
  get partInHand(): PartKind | null {
    const s = this.held;
    return s.kind === 'part' ? s.part : null;
  }

  /** True when the left button should swing a tool rather than place. */
  get handInHand(): boolean { return this.held.kind === 'hand'; }

  /** GP-86. True when the left button should FIRE. Asked by name rather than
   *  compared against a string at the call site, for the reason every other
   *  getter here exists: a second `=== 'gun'` somewhere else is a second
   *  authority on what is in the player's hands. */
  get gunInHand(): boolean { return this.held.kind === 'gun'; }

  /** The 0-based index of the gun slot, or -1. Derived rather than stored, so
   *  the weapon key still finds it after the bar has been rearranged. */
  get gunSlot(): number { return this.bar.findIndex((s) => s.kind === 'gun'); }

  get label(): string { return describe(this.held); }

  /** Select by 0-based index. Out of range is ignored, not wrapped: a number
   *  key that does not exist should do nothing, not jump to slot 1. */
  select(i: number): boolean {
    if (i < 0 || i >= SLOT_COUNT || i === this.index) return false;
    this.index = i;
    this.changes++;
    return true;
  }

  /** Wheel. WRAPS, because a wheel has no ends and stopping dead at slot 9 is
   *  the single most irritating thing a hotbar can do. */
  cycle(n: number): boolean {
    if (n === 0) return false;
    const next = ((this.index + n) % SLOT_COUNT + SLOT_COUNT) % SLOT_COUNT;
    return this.select(next);
  }

  /** Put something in a slot. The "put things in a hotbar" half of the ask. */
  assign(i: number, content: SlotContent): boolean {
    if (i < 0 || i >= SLOT_COUNT) return false;
    this.bar[i] = content;
    return true;
  }

  /**
   * GP-108. EMPTY A SLOT. Reid's ask, verbatim: "i want to be able to remove
   * things from my hotbar while in my inventory menu".
   *
   * It is deliberately allowed to empty EVERY slot, including the hand and the
   * gun. A remove that silently refused on some slots would be a control that
   * works four times out of eleven, which is worse than one that does not exist.
   * What makes that safe is `reset`, below, and not a guard here.
   */
  clear(i: number): boolean {
    if (i < 0 || i >= SLOT_COUNT || this.bar[i].kind === 'empty') return false;
    this.bar[i] = { kind: 'empty' };
    return true;
  }

  /**
   * GP-108. THE WAY BACK, and it ships in the same breath as `clear` because
   * without it `clear` is a trap.
   *
   * `assignToBar`'s pack gesture reaches exactly three of the twelve placeable
   * things: the two hand furnaces and the three ABI 9 machines are pack items,
   * and a structural part NEVER is (gameplay.h S.6: it is paid for and placed,
   * never crafted into a carried item), nor is the gun. So a player who cleared
   * the foundation slot would have removed their only route to a foundation for
   * the life of the world, which is exactly the unreachable-feature failure
   * `restore`'s own comment is about, arrived at from the opposite direction.
   */
  reset(): number {
    let changed = 0;
    for (let i = 0; i < SLOT_COUNT; ++i) {
      if (this.bar[i].kind !== DEFAULT_BAR[i].kind
        || (this.bar[i] as { part?: string }).part
          !== (DEFAULT_BAR[i] as { part?: string }).part) changed++;
      this.bar[i] = { ...DEFAULT_BAR[i] };
    }
    return changed;
  }

  /** Swap two slots. The "put things in a hotbar" gesture, made by hand. */
  swap(a: number, b: number): boolean {
    if (a === b || a < 0 || b < 0 || a >= SLOT_COUNT || b >= SLOT_COUNT) return false;
    const t = this.bar[a];
    this.bar[a] = this.bar[b];
    this.bar[b] = t;
    return true;
  }

  /** The whole bar, for the save slot. Plain data, no class instances. */
  serialize(): { selected: number; slots: SlotContent[] } {
    return { selected: this.index, slots: this.bar.map((s) => ({ ...s })) };
  }

  /**
   * Put a saved bar back. Takes `unknown` and VALIDATES, rather than trusting a
   * typed shape: a malformed row falls back to empty and a malformed slot index
   * to 0, because a save slot is data from disk and must never be able to brick
   * a boot.
   */
  restore(v: unknown): boolean {
    const o = v as { selected?: unknown; slots?: unknown } | null | undefined;
    if (o === null || o === undefined || !Array.isArray(o.slots)) return false;
    const saved = o.slots.length;
    for (let i = 0; i < SLOT_COUNT; ++i) {
      // A BAR SAVED BEFORE THIS ONE GREW KEEPS THE DEFAULT IN THE NEW SLOTS
      // rather than emptying them, and that is a general rule and not a
      // launch-pad special case. `readSlot(undefined)` is `empty`, so without
      // this a player who researched the pad on an existing world would find
      // slot 10 blank with no gesture anywhere that could fill it: the bar is
      // the only route to a structural part, so an empty new slot is an
      // unreachable feature. What the player CHOSE is still theirs; only slots
      // they never had a chance to choose fall back.
      this.bar[i] = i < saved ? readSlot(o.slots[i])
        : { ...DEFAULT_BAR[i] };
    }
    this.index = typeof o.selected === 'number' && o.selected >= 0
      && o.selected < SLOT_COUNT ? Math.floor(o.selected) : 0;
    return true;
  }

  /** Empty the hand: Escape's last resort before it gives the pointer back. */
  clearHand(): boolean {
    if (this.held.kind !== 'part') return false;
    return this.select(this.bar.findIndex((s) => s.kind === 'hand'));
  }

  /** Rows for the bar widget. Plain data: src/ui imports no three.js. */
  rows(icon: (name: string) => string): {
    index: number; label: string; icon: string; selected: boolean; empty: boolean;
  }[] {
    return this.bar.map((s, i) => {
      const info = s.kind === 'part' ? PART_INFO[s.part]
        : s.kind === 'furnace' ? { label: 'furnace', iconName: 'Primitive furnace' }
          : null;
      return {
        index: i,
        label: describe(s),
        icon: info === null || info.iconName === '' ? '' : icon(info.iconName),
        selected: i === this.index,
        empty: s.kind === 'empty',
      };
    });
  }

  report(): unknown {
    return {
      selected: this.index + 1,
      label: this.label,
      kind: this.held.kind,
      part: this.partInHand,
      changes: this.changes,
      slots: this.bar.map((s, i) => ({ slot: i + 1, kind: s.kind,
        part: s.kind === 'part' ? s.part : null, label: describe(s) })),
    };
  }
}

/** One saved slot, checked. Anything unrecognised becomes an empty slot. */
function readSlot(v: unknown): SlotContent {
  const o = v as { kind?: unknown; part?: unknown } | null | undefined;
  if (o === null || o === undefined) return { kind: 'empty' };
  if (o.kind === 'hand') return { kind: 'hand' };
  if (o.kind === 'furnace') return { kind: 'furnace' };
  // GP-109. THE GUN, AND ITS ABSENCE HERE WAS DELETING IT FROM EVERY SAVE.
  //
  // `serialize` writes `{kind:'gun'}` for slot 11 and this function had no case
  // for it, so the fall-through at the bottom turned it into an empty slot. The
  // symptom is precisely what Reid reported today, that he "does not see a
  // gun": the bar is right for one boot, the autosave fires 20 seconds in, and
  // from the next reload onwards slot 11 is blank with no gesture in the game
  // that could refill it, because a gun is not a `PartKind` and `assignToBar`'s
  // pack-click cannot reach one. The eleven-slot migration in `restore` could
  // not save it either: `saved` is 11, so the new-slot fallback never fires.
  // This is the same failure class GP-57's comment named and the same one it
  // guarded against, one line further down, in the function nobody re-read when
  // the eleventh slot was added.
  if (o.kind === 'gun') return { kind: 'gun' };
  if (o.kind === 'part' && typeof o.part === 'string' && isPart(o.part)) {
    return { kind: 'part', part: o.part };
  }
  return { kind: 'empty' };
}

function describe(s: SlotContent): string {
  if (s.kind === 'hand') return 'hands';
  if (s.kind === 'furnace') return 'furnace';
  if (s.kind === 'gun') return 'sidearm';
  if (s.kind === 'empty') return '';
  return PART_INFO[s.part].label;
}

export { isPart };
