// The verbs: what a key press actually DOES to the pack, a machine or a recipe.
//
// Split out of Gameplay when the W7 checklist landed and the composition crossed
// its 400-line cap, and split along the seam that was already there. Gameplay
// owns ORDER and the POINTER; these five functions own the small transactions,
// and every one of them is the same shape: ask /core, then say so out loud.
//
// SAYING SO OUT LOUD IS THE POINT, and it is why they are not one-liners on
// GameCore. A player who presses G with an empty pack must be told why nothing
// happened, and a player who takes six ingots out of a smelter must see six. The
// rule is /core's; the sentence is this file's.

import { furnaceView, recipeRows, slotRows } from './GameplayViews.js';
import type { Gameplay } from './Gameplay.js';
import type { Placed } from './Factory.js';
import type { Machine } from './Machines.js';

/** The two panel views, with the item pictures bound in one place. */
export function slots(g: Gameplay) {
  return slotRows(g.game, (n) => g.icons.for(n));
}
export function recipes(g: Gameplay) {
  return recipeRows(g.game, (n) => g.icons.for(n));
}

/** Take an automated machine's finished stock into the pack. */
export function collectFrom(g: Gameplay, b: Placed): void {
  const n = g.factory.collect(b);
  if (n <= 0) { g.hud.flash('nothing to take yet'); return; }
  g.autoCollected += n;
  g.hud.flash(`took ${n} ${g.game.itemName(g.factory.outputItemOf(b))}`);
  g.sfx.confirm();
  g.panel.invalidate();
}

/** Put a furnace or a smelter from the pack on the 1 m grid ahead of the eye. */
export function placeMachine(g: Gameplay,
                             ray: { origin: { x: number; y: number; z: number };
                                    dir: { x: number; y: number; z: number } }): void {
  const ids = g.game.ids;
  const tier = g.game.count(ids.furnace) > 0 ? 0
    : g.game.count(ids.smelter) > 0 ? 1 : -1;
  if (tier < 0) { g.hud.flash('nothing to place  (craft a furnace)'); return; }
  const item = tier === 0 ? ids.furnace : ids.smelter;
  if (g.machines.place(item, tier, ray.origin, ray.dir) === null) {
    g.hud.flash('cannot place there');
    return;
  }
  g.placements++;
  g.hud.flash(`placed ${g.game.itemName(item)}`);
  g.sfx.confirm();
}

/** Pack -> the open machine, as ore or as fuel. */
export function loadFurnace(g: Gameplay, m: Machine | null, item: number): void {
  if (m === null) return;
  const n = g.game.furnaceInsert(m.handle, item, 5);
  if (n > 0) { g.hud.flash(`loaded ${n} ${g.game.itemName(item)}`); g.sfx.confirm(); }
}

/** The open machine's tray -> the pack. */
export function takeFurnace(g: Gameplay, m: Machine | null): void {
  if (m === null) return;
  const n = g.game.furnaceCollect(m.handle, 99);
  if (n > 0) { g.hud.flash(`took ${n}`); g.sfx.confirm(); }
}

/** Hand-craft by recipe index, and redraw the panel that asked for it. */
export function craft(g: Gameplay, index: number): void {
  const ok = g.game.craft(index);
  g.panel.invalidate();
  g.panel.render(slots(g), recipes(g));
  const r = ok ? g.game.recipes()[index] : undefined;
  if (r === undefined) return;
  g.hud.flash(`crafted ${g.game.itemName(r.output)}`);
  g.sfx.confirm();
}

/** What the open machine's screen shows. One call, so Gameplay keeps no view. */
export function machineView(g: Gameplay, m: Machine) {
  return furnaceView(g.game, m.handle, m.tier);
}
