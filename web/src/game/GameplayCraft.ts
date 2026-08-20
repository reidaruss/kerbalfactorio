// The pack side of GameplayActions.ts (see that file's header for the split's
// own reason): the hotbar/recipe panels, taking stock off a machine or belt,
// hand-feeding a machine, and hand-crafting. Split along the same seam
// GameplayActions itself was split along in W7 -- these six are the verbs
// that touch the PACK rather than the world, and every one of them is still
// the same shape: ask /core, then say so out loud.

import { CRAFT_BLOCK, craftBlockText } from './GameCore.js';
import { recipeRows, slotRows } from './GameplayViews.js';
import type { Gameplay } from './Gameplay.js';
import type { Placed } from './Factory.js';

/** The two panel views, with the item pictures bound in one place. */
export function slots(g: Gameplay) {
  return slotRows(g.game, (n) => g.icons.for(n),
    (item) => HOTBAR_ITEMS.has(item));
}
export function recipes(g: Gameplay) {
  return recipeRows(g.game, (n) => g.icons.for(n), g.mode.fullCatalogue,
    (i) => lockOn(g, i));
}

/**
 * WHAT LOCKS A RECIPE, in one place and asked of /core.
 *
 * `ModeRules.researchGated` and not `if (sandbox)`: GP-29's whole argument is
 * that a gate written later must get the right answer without anyone
 * remembering to add an or-clause, and this is the branch `freeBuild`'s comment
 * predicted a year of decisions ago.
 */
function lockOn(g: Gameplay, recipeIndex: number): string {
  if (!g.mode.researchGated) return '';
  const rs = g.progress.research;
  if (rs.recipeAvailable(recipeIndex)) return '';
  const out = g.game.recipes()[recipeIndex]?.output ?? 0;
  return rs.techForItem(out)?.name ?? 'a technology';
}

/** The pack items that mean something on a hotbar slot. The three ABI 9 items
 *  plus the two hand furnaces; everything else is a resource or a tool. */
const HOTBAR_ITEMS = new Set([0x003B, 0x003C, 0x003D, 0x003E, 0x003F]);

/**
 * Take an automated machine's finished stock into the pack, or ONE ITEM OFF A
 * BELT (FS-28). A belt used to reach the first branch, ask a `BeltLine` for an
 * output buffer it does not have, and answer "nothing to take yet" for ever.
 * Same key, same sentence, because it is the same verb.
 */
export function collectFrom(g: Gameplay, b: Placed): void {
  // A GENERATOR IS FED, NOT EMPTIED, and E is the key that means "deal with the
  // thing in front of me", so this is the same verb rather than a new one. It
  // is also the ONLY way a grid ever starts: a burner generator with no coal
  // offers zero capacity, so without this the whole electrical layer is a panel
  // that reads 0 W for ever, which is exactly the shape of failure W11 exists
  // to stop shipping.
  if (b.kind === 'generator') {
    refuel(g, b);
    return;
  }
  // AN ELECTRIC SMELTER IS FED BY HAND UNTIL A BELT REACHES IT, for a reason
  // that is a property of /core: `pumpPower` publishes what a machine WANTS
  // THIS TICK, and a starved machine wants nothing. So an unfed electric
  // smelter draws 0 W, the network reads 100% satisfied, and the panel is a
  // screen of zeroes however many generators stand on it.
  //
  // AN EMPTY HOPPER MEANS FEED, ANYTHING ELSE MEANS EMPTY. The first version
  // had it the other way round and it is unusable: a running machine has
  // finished stock within half a second, so E alternated between collecting one
  // ingot and refusing to load. Keyed on the HOPPER, the key does the thing the
  // machine is short of, which is the only rule that stays right while it
  // runs.
  if (b.kind === 'esmelter' && g.factory.inputOf(b) <= 0) {
    feedMachine(g, b);
    return;
  }
  if (b.kind === 'belt') {
    const got = g.factory.takeFromBelt(b);
    if (got === null) { g.hud.flash('nothing on this belt'); return; }
    g.autoCollected += got.count;
    g.hud.flash(got.count > 0 ? `took 1 ${g.game.itemName(got.item)}`
      : `pack full: ${g.game.itemName(got.item)} dropped`);
    g.sfx.confirm();
    g.panel.invalidate();
    return;
  }
  const n = g.factory.collect(b);
  if (n <= 0) { g.hud.flash('nothing to take yet'); return; }
  g.autoCollected += n;
  g.hud.flash(`took ${n} ${g.game.itemName(g.factory.outputItemOf(b))}`);
  g.sfx.confirm();
  g.panel.invalidate();
}

/**
 * Coal out of the pack and into a generator. Returns nothing and says
 * everything, like every other verb here.
 *
 * The count that leaves the pack is the count /core ACCEPTED, never the count
 * asked for: the fuel slot is bounded at 50 units, so a player with 400 coal
 * who presses E next to a full generator must not silently lose 10 of it.
 */
export function refuel(g: Gameplay, b: Placed, want = 10): void {
  if (b.grid < 0) { g.hud.flash('this generator is not built yet'); return; }
  const coal = g.game.ids.coal;
  const held = g.game.count(coal);
  if (held <= 0) { g.hud.flash('no coal in the pack'); return; }
  const took = g.factory.power.insertFuel(b.grid, coal,
    Math.min(want, held));
  if (took <= 0) { g.hud.flash('this generator is full'); return; }
  g.game.remove(coal, took);
  b.fuel = g.factory.power.generatorFuel(b.grid);
  g.hud.flash(`fuelled: ${took} coal in, ${b.fuel} units burning`, 2.2);
  g.sfx.confirm();
  g.panel.invalidate();
}

/**
 * Ore out of the pack and into a powered machine, five at a time.
 *
 * What it takes is decided by /core: the ore the machine was BOUND to when it
 * was placed, which is `smeltOutputFor`'s own input side. A JS table of "what
 * goes in a smelter" would be a second authority one balance pass away from
 * being wrong.
 */
export function feedMachine(g: Gameplay, b: Placed, want = 20): void {
  if (b.build < 0) { g.hud.flash('this machine is not built yet'); return; }
  const ore = g.factory.inputItemOf(b);
  if (ore <= 0) { g.hud.flash('this machine takes nothing by hand'); return; }
  const held = g.game.count(ore);
  if (held <= 0) {
    g.hud.flash(`no ${g.game.itemName(ore)} in the pack`);
    return;
  }
  // TWENTY, NOT FIVE, and the number is about the machine rather than the
  // hopper. An electric smelter is 30 ticks a unit, so five units is 150 ticks:
  // half a second of work for a press, which means a player hand-feeding a base
  // spends the whole game pressing E. Twenty is ten seconds, which is long
  // enough to walk to the next machine and is the interval a belt is meant to
  // replace rather than a substitute for one.
  const n = Math.min(want, held);
  g.factory.feed(b, n);
  g.game.remove(ore, n);
  g.hud.flash(`loaded ${n} ${g.game.itemName(ore)}`);
  g.sfx.confirm();
  g.panel.invalidate();
}

// The machine screen's own verbs (load, take output, take input) live in
// MachineScreen.ts with the views they serve (GP-57).

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
  // The same gate the panel greyed the button with, asserted again here,
  // because a disabled button is a suggestion and a probe can click through it.
  if (lockOn(g, index) !== '') {
    g.hud.flash(`not researched yet  (J)`);
    return;
  }
  const want = g.game.recipes()[index];
  // GP-51: THE REFUSAL IS ASKED FOR BEFORE THE ATTEMPT, so the player is told
  // which of two opposite things to go and do. `of_gp_craft` used to return
  // true on a full pack, spend the inputs and drop the output, and the only
  // symptom was that nothing happened. The reason travels as a CODE (GP-46);
  // the sentence is composed here, where the item names live.
  const block = g.mode.freeBuild ? CRAFT_BLOCK.None : g.game.craftBlock(index);
  if (block !== CRAFT_BLOCK.None) {
    g.hud.flash(craftBlockText(block), 2.4);
    g.sfx.undo();
    return;
  }
  const ok = g.mode.freeBuild
    ? want !== undefined && g.game.add(want.output, want.outputCount) === 0
    : g.game.craft(index);
  g.panel.invalidate();
  g.panel.render(slots(g), recipes(g));
  const r = ok ? g.game.recipes()[index] : undefined;
  if (r === undefined) {
    // Sandbox GRANTS rather than crafts, so /core's block code never ran and a
    // full pack lands here. Never silent, either way.
    g.hud.flash(craftBlockText(CRAFT_BLOCK.PackFull), 2.4);
    return;
  }
  g.hud.flash(`crafted ${g.game.itemName(r.output)}`);
  g.sfx.confirm();
}
