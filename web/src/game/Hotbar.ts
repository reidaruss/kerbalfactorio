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

/** Anything the build key can put down. Machines TICK and structures do not. */
export type PartKind = BuildKind | StructureKind;

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
  | { kind: 'empty' };

export interface HotbarSlot {
  content: SlotContent;
  label: string;
  /** The /core display name whose baked icon stands for this slot, or ''. */
  iconName: string;
}

export const SLOT_COUNT = 9;

/** Label and icon for every part, in one table so the HUD restates nothing. */
export const PART_INFO: Record<PartKind, { label: string; iconName: string }> = {
  miner: { label: 'mining drill', iconName: 'Miner' },
  belt: { label: 'belt', iconName: 'Belt' },
  smelter: { label: 'smelter', iconName: 'Smelter' },
  foundation: { label: 'foundation', iconName: '' },
  floor: { label: 'floor', iconName: '' },
  wall: { label: 'wall', iconName: '' },
  door: { label: 'door', iconName: '' },
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
];

function isPart(k: string): k is PartKind {
  return k === 'miner' || k === 'belt' || k === 'smelter'
    || (STRUCTURE_KINDS as readonly string[]).includes(k);
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

function describe(s: SlotContent): string {
  if (s.kind === 'hand') return 'hands';
  if (s.kind === 'furnace') return 'furnace';
  if (s.kind === 'empty') return '';
  return PART_INFO[s.part].label;
}

export { isPart };
