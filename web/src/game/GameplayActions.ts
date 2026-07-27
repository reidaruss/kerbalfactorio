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

import { demolishAimed } from './Demolition.js';
import { furnaceView, recipeRows, slotRows } from './GameplayViews.js';
import { urlForMode, type GameMode } from './GameMode.js';
import type { Gameplay } from './Gameplay.js';
import type { BuildRay } from './BuildMode.js';
import type { Placed } from './Factory.js';
import type { Machine } from './Machines.js';
import type { StructurePart } from './Structures.js';

/** The two panel views, with the item pictures bound in one place. */
export function slots(g: Gameplay) {
  return slotRows(g.game, (n) => g.icons.for(n));
}
export function recipes(g: Gameplay) {
  return recipeRows(g.game, (n) => g.icons.for(n), g.mode.fullCatalogue);
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

/**
 * Put a furnace or a smelter from the pack on the 1 m grid ahead of the eye.
 *
 * DW-31: in sandbox the pack is not a gate, so an empty one still places the
 * primitive furnace. The tier is still read from the pack FIRST, so a sandbox
 * player who has actually got a smelter puts down the smelter.
 */
export function placeMachine(g: Gameplay,
                             ray: { origin: { x: number; y: number; z: number };
                                    dir: { x: number; y: number; z: number } }): void {
  const ids = g.game.ids;
  const held = g.game.count(ids.furnace) > 0 ? 0
    : g.game.count(ids.smelter) > 0 ? 1 : -1;
  const tier = held < 0 && g.mode.freeBuild ? 0 : held;
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

/**
 * THE LEFT BUTTON, whole. What it does is decided by the HOTBAR and by nothing
 * else: a player holding a wall who clicks means the wall, and guessing from
 * what happens to be under the crosshair is the sort of thing that makes a game
 * feel unlistening.
 *
 * `use` is the held state and `pressed` the rising edge, because they mean
 * different things: a press puts one part down, and a HOLD drags a run (GP-27).
 *
 * Returns true if anything was put down, so the caller can skip the rest of the
 * tick's interaction.
 */
export function stepBuild(g: Gameplay, ray: BuildRay, use: boolean,
                          pressed: boolean): boolean {
  // A hand furnace comes out of the PACK and goes down through Machines, not
  // through the factory plan (GP-19), so it is its own slot kind and its own
  // branch rather than a fake `BuildKind`.
  if (g.hotbar.held.kind === 'furnace') {
    if (!pressed) return false;
    placeMachine(g, ray);
    return true;
  }
  const n = g.build.step((a) => g.input.act(a), use, ray);
  if (n > 0) {
    announce(g, n, pressed);
    g.sfx.confirm();
    g.panel.invalidate();
    return true;
  }
  if (g.build.selected === null) return false;
  const refused = g.build.structTarget !== null
    ? (g.build.structTarget.ok ? null : g.build.structTarget.reason)
    : (g.build.target?.ok === false ? g.build.target.reason : null);
  if (pressed && refused !== null) g.hud.flash(refused);
  return false;
}

/** What a placement says out loud. A drag says the RUN, not each tile. */
function announce(g: Gameplay, n: number, pressed: boolean): void {
  if (!pressed || n > 1) {
    g.hud.flash(`${g.build.dragLength + n} ${g.build.label}`);
    return;
  }
  const part = g.build.lastPart;
  if (g.build.structTarget !== null && part !== null) {
    // The COST is said out loud on placement, because a player who cannot see
    // what a wall costs cannot plan a room.
    g.hud.flash(`placed ${part.kind}  -${g.structures.costText(part.kind)}`);
    return;
  }
  // The RATE is said out loud, because richness varies across a deposit and a
  // player who cannot see what a spot is worth cannot choose.
  const r = g.build.lastRate;
  g.hud.flash(r > 0 ? `placed ${g.build.label}  ${r.toFixed(1)} ore/s`
    : `placed ${g.build.label}`);
}

/**
 * The X key, whole. Whatever is under the crosshair goes back through its own
 * owner, and what could not survive the removal is named in the same toast.
 *
 * The machine is tried first for the same reason it takes the mine key: it is
 * the nearer, larger object, and a belt tile or a wall behind it must not steal
 * the press.
 */
export function raze(g: Gameplay, machine: Machine | null, build: Placed | null,
                     part: StructurePart | null): boolean {
  const r = demolishAimed(g, machine, build, part);
  if (r === null) { g.hud.flash('nothing to remove'); return false; }
  g.fx.forgetSmelters();
  g.hud.flash(r.message, 2.2);
  g.sfx.undo();
  g.panel.invalidate();
  return true;
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

/**
 * Hand-craft by recipe index, and redraw the panel that asked for it.
 *
 * DW-31: in sandbox the output is GRANTED rather than crafted, because "i can
 * just pick anything thats in the game" has to be true of items and not only of
 * buildings, and the craft list is the only catalogue of items the game already
 * has. `of_gp_craft` is not called at all, for the reason `Structures.pay`
 * gives: a call whose false return is ignored would eat inputs it did not
 * announce.
 */
export function craft(g: Gameplay, index: number): void {
  const want = g.game.recipes()[index];
  const ok = g.mode.freeBuild
    ? want !== undefined && g.game.add(want.output, want.outputCount) === 0
    : g.game.craft(index);
  g.panel.invalidate();
  g.panel.render(slots(g), recipes(g));
  const r = ok ? g.game.recipes()[index] : undefined;
  if (r === undefined) return;
  g.hud.flash(`crafted ${g.game.itemName(r.output)}`);
  g.sfx.confirm();
}

/**
 * Leave for the other mode, from the menu.
 *
 * IT RELOADS, and that is the design and not a shortcut. A mode is stamped on
 * the save slot and decides which slot the world even lives in, so a session
 * that spent five minutes in each has no honest label to write. The current
 * world is saved to its OWN slot first, so switching costs nothing and coming
 * back finds it exactly as it was left.
 */
export function switchMode(g: Gameplay, to: GameMode): void {
  if (to === g.mode.mode) return;
  const href = urlForMode(window.location.href, to);
  void g.save().then(() => { window.location.assign(href); });
}

/** What the open machine's screen shows. One call, so Gameplay keeps no view. */
export function machineView(g: Gameplay, m: Machine) {
  return furnaceView(g.game, m.handle, m.tier);
}
