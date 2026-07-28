// FS-70: THE CHEST'S PANEL, and it is the first one whose machine does not make
// anything.
//
// Every other view in `MachineScreen` is built around a transformation: an input
// buffer on one side, an output buffer on the other, and a progress figure
// between them saying how far along this unit is. A container has none of those.
// It has ONE pool, which is both its input and its output, and asking
// `progress01` of it is asking a question with no answer rather than a question
// whose answer is zero. So the view says so: no progress line at all, and the
// one pool is presented as the OUTPUT cell, because that is the cell the panel
// already lets you click to take a stack back.
//
// It lives in its own file for the reason `MachineAssembler.ts` does: the two
// machines that are not smelters are the two that need their own sentences, and
// `MachineScreen.ts` is at its 400-line cap either way.

import type { Gameplay } from './Gameplay.js';
import type { MachineView } from '../ui/FurnacePanel.js';
import type { Placed } from './FactoryKinds.js';
import { PART_INFO } from './Hotbar.js';
import { portInfo } from './MachineScreen.js';

/** How many the panel moves per click, matching the furnace's own load step. */
const LOAD_STEP = 5;

/**
 * A chest, as a view.
 *
 * THE STATUS LINE DISTINGUISHES THREE STATES AND NOT TWO, on the same argument
 * FS-52 made for the generator: EMPTY, holding, and FULL are three different
 * situations with three different fixes (put something in, nothing, take
 * something out or build another). A chest that reads "IDLE" like a starved
 * smelter would be describing a box as though it were failing to work, and a
 * box that is doing exactly its job looks identical to one nobody has used.
 */
export function chestPanelView(g: Gameplay, b: Placed): MachineView {
  const f = g.factory;
  const live = b.build >= 0;
  // Read the CONTAINER when there is one and the PLAN when there is not, which
  // is the same pair of sources `Persist` and `commitPlan` read, so an unopened
  // chest and a committed one never disagree about what is in them.
  const item = live ? f.line.containerItem(b.build) : b.storeItem;
  const count = live ? f.line.containerCount(b.build) : b.storeCount;
  const cap = live ? f.line.containerCapacity(b.build) : 0;
  const full = cap > 0 && count >= cap;
  // What the pack could put in: ANYTHING when the chest is untyped, and only
  // its own type once it has claimed one. That restriction is not this panel's
  // rule, it is /core's acceptance rule read forward, so the menu cannot offer a
  // click that the sim would then refuse.
  const loadable = full ? [] : g.game.carried()
    .filter((c) => c.count > 0 && (item === 0 || c.item === item))
    .map((c) => ({ item: c.item, name: c.name, count: c.count, fuel: false }));
  return {
    title: PART_INFO[b.kind].label,
    status: count === 0 ? 'EMPTY' : full ? 'FULL' : 'STORING',
    input: null,
    input2: null,
    fuel: null,
    // The one pool, as the output cell, so clicking it takes a stack back.
    output: { name: item > 0 ? g.game.itemName(item) : '',
      count, ...portInfo(g, b, 'out') },
    // NO PROGRESS AT ALL, and `null` rather than 0: a container has no unit in
    // flight, so a bar reading 0% would be a claim that it is 0% of the way
    // through something it has not started.
    progress01: null,
    progressText: cap > 0 ? `${count} of ${cap}` : '',
    canTakeInput: false,
    takeInputHint: '',
    loadable,
    recipes: null,
    refused: [],
  };
}

/** The pack puts items in. Returns nothing: it flashes and invalidates, exactly
 *  as `feedAssembler` and `refuel` do. */
export function loadChest(g: Gameplay, b: Placed, item: number): void {
  if (b.build < 0) { g.hud.flash('this chest is not built yet'); return; }
  const have = g.game.count(item);
  const want = Math.min(LOAD_STEP, have);
  if (want <= 0) { g.hud.flash('none in the pack'); return; }
  // ASK THE CONTAINER FIRST AND TAKE FROM THE PACK SECOND, in that order. The
  // insert returns what was ACCEPTED, which is 0 for the wrong type or a full
  // chest, so spending the pack first would destroy items on a refusal.
  const n = g.factory.line.containerInsert(b.build, item, want);
  if (n <= 0) {
    g.hud.flash(g.factory.line.containerItem(b.build) === 0
      ? 'this chest will not take that' : 'this chest is full');
    g.panel.invalidate();
    return;
  }
  g.game.remove(item, n);
  b.storeItem = g.factory.line.containerItem(b.build);
  b.storeCount = g.factory.line.containerCount(b.build);
  g.hud.flash(`stored ${n} ${g.game.itemName(item)}`);
  g.sfx.confirm();
  g.panel.invalidate();
}

/** The output cell was clicked: take a stack back out into the pack. */
export function takeFromChest(g: Gameplay, b: Placed): boolean {
  if (b.build < 0) return false;
  const item = g.factory.line.containerItem(b.build);
  if (item === 0) { g.hud.flash('this chest is empty'); return true; }
  const n = g.factory.line.containerTake(b.build, 999);
  if (n <= 0) { g.hud.flash('this chest is empty'); return true; }
  // `add` returns what the pack ACCEPTED. A full pack takes fewer than were
  // pulled out, and the remainder would vanish, so the shortfall goes straight
  // back into the chest rather than being dropped on the floor.
  const kept = g.game.add(item, n);
  if (kept < n) g.factory.line.containerInsert(b.build, item, n - kept);
  // The plan follows the container, so a commit before the next save carries
  // what is really in it. `containerItem` is re-read rather than assumed,
  // because emptying a container RELEASES its type (FS-66) and the chest the
  // player just emptied is untyped again.
  b.storeItem = g.factory.line.containerItem(b.build);
  b.storeCount = g.factory.line.containerCount(b.build);
  g.hud.flash(kept < n ? `took ${kept} ${g.game.itemName(item)}  (pack full)`
    : `took ${n} ${g.game.itemName(item)}`);
  g.sfx.confirm();
  g.panel.invalidate();
  return true;
}
