// FS-56: THE ASSEMBLER'S HALF OF THE MACHINE SCREEN, and the three verbs it
// adds.
//
// Split out of MachineScreen the moment it landed, and along a seam that is
// real rather than a line-count convenience. MachineScreen answers "which
// machine did the bare hand open, and what does its panel show", for two
// families that differ in WHICH EXPORT they read. An assembler differs in
// something else entirely: it is the first machine whose behaviour is a PLAYER
// DECISION rather than a consequence of what feeds it, so it needs a menu, a
// second input stack, a routing rule for hand-loading, and a verb that rebuilds
// the /core network. None of that belongs in a file whose job is to hide the
// difference between a furnace handle and a build index.
//
// EVERY NUMBER HERE IS /core's. `input2Buffer` is `of_net_input2_buffer`, the
// bar is `of_net_progress01`, and the ingredient names and counts come out of
// the SAME recipe the entity was built from, read back through `recipeOf`,
// never out of a second table. A panel that said "5 Iron" while the machine was
// built for 4 is FS-41's defect one layer up, and the only defence against it is
// that there is one source.

import { portInfo } from './MachineScreen.js';
import { PART_INFO } from './Hotbar.js';
import type { MachineView } from '../ui/FurnacePanel.js';
import type { AssemblerRecipe } from './FactoryRecipes.js';
import type { Gameplay } from './Gameplay.js';
import type { Placed } from './Factory.js';

/**
 * FS-56: THE ASSEMBLER, and it is its own view function rather than four more
 * `b.kind === 'assembler'` branches inside `buildPanelView`.
 *
 * That function already carries a `crafts` flag, a generator special case and a
 * miner special case, and every one of them is a question about which of three
 * machines is being described. A fourth machine that differs in FIVE of the
 * eight fields is where a shared function stops being shared and starts being a
 * switch statement wearing a hat. The two live side by side and neither reads
 * the other's branches, which is the same seam `furnacePanelView` is on the far
 * side of.
 *
 * IT IS ALSO WHERE THE PANEL AND THE SIM COULD MOST EASILY DISAGREE. Every count
 * below is /core's: `input2Buffer` is `of_net_input2_buffer`, the progress bar is
 * `of_net_progress01`, and the ingredient NAMES and COUNTS come out of the same
 * `recipeOf` the machine was built from, never out of a second table. A panel
 * that said "5 Iron" while the entity was built for 4 would be the exact FS-41
 * defect one layer up, and the only defence is that there is one source.
 */
export function assemblerPanelView(g: Gameplay, b: Placed): MachineView {
  const f = g.factory;
  const live = b.build >= 0;
  const menu = f.recipeMenu();
  const r = b.recipe > 0
    ? (menu.offered.find((x) => x.output === b.recipe) ?? null) : null;
  const working = live && f.line.working(b.build);
  const hasB = r !== null && r.b.item > 0;
  return {
    title: PART_INFO[b.kind].label,
    // NO RECIPE COMES BEFORE EVERY OTHER STATE, and it is FS-52's ordering rule
    // applied again: a machine with no recipe is not IDLE, because IDLE means
    // "correctly configured and waiting for materials" and sends the player off
    // to look at their belts. The three states have three different fixes.
    status: r === null ? 'NO RECIPE' : working ? 'ASSEMBLING' : 'IDLE',
    input: r === null ? null : {
      name: r.a.name,
      count: live ? f.line.inputBuffer(b.build) : 0,
      ...portInfo(g, b, 'in', 'socket_item_in_a'),
    },
    input2: r === null ? null : {
      // A single-ingredient recipe still gets a B cell, reading its port and
      // saying the recipe needs nothing there. Hiding the cell would silently
      // reflow the panel between two recipes on the same machine, and a port
      // that exists on the housing should be nameable in the panel whether or
      // not this recipe uses it.
      name: hasB ? r.b.name : 'not used by this recipe',
      count: hasB && live ? f.line.input2Buffer(b.build) : 0,
      ...portInfo(g, b, 'in', 'socket_item_in_b'),
    },
    fuel: null,
    output: r === null ? null : {
      name: r.name,
      count: live ? f.line.outputBuffer(b.build) : 0,
      ...portInfo(g, b, 'out', 'socket_item_out'),
    },
    progress01: r !== null && live ? f.line.progress01(b.build) : null,
    progressText: r === null
      ? 'pick a recipe: this machine is not making anything'
      : `${r.a.count} ${r.a.name}`
        + (hasB ? ` + ${r.b.count} ${r.b.name}` : '')
        + ` -> ${r.outputCount} ${r.name}, ${(r.ticks / 60).toFixed(2)} s each`,
    canTakeInput: false,
    takeInputHint: 'taking the hopper back out needs a bridge export (of_net_take_input)',
    // HAND-LOADING IS OFFERED FOR BOTH INGREDIENTS OR FOR NEITHER, which ABI 17
    // is what makes possible: `of_net_feed_machine2` reaches slot 2, so the
    // asymmetry that would otherwise have shipped (load the first, belt the
    // second) never exists. `loadInto` routes by which slot the item belongs to.
    loadable: r === null ? [] : loadableFor(g, r),
    recipes: menu.offered.map((x) => ({
      output: x.output,
      label: `${x.outputCount > 1 ? `${x.outputCount} ` : ''}${x.name}`,
      cost: `${x.a.count} ${x.a.name}`
        + (x.b.item > 0 ? ` + ${x.b.count} ${x.b.name}` : ''),
      affordable: g.game.count(x.a.item) >= x.a.count
        && (x.b.item === 0 || g.game.count(x.b.item) >= x.b.count),
      selected: x.output === b.recipe,
    })),
    refused: menu.refused.map((x) => ({ label: x.name, why: x.why })),
  };
}

/** What the pack can put into an assembler: whichever ingredients it holds. */
function loadableFor(g: Gameplay, r: AssemblerRecipe) {
  const out = [];
  const a = g.game.count(r.a.item);
  if (a > 0) out.push({ item: r.a.item, name: r.a.name, count: a, fuel: false });
  if (r.b.item > 0) {
    const n = g.game.count(r.b.item);
    if (n > 0) out.push({ item: r.b.item, name: r.b.name, count: n, fuel: false });
  }
  return out;
}

/**
 * FS-56: PUT AN INGREDIENT IN, INTO THE SLOT IT BELONGS IN.
 *
 * The routing is the recipe's, matched on ITEM ID, which is the identical rule
 * `inserterSystem` uses for a belted item (`insHeld == in2SlotItem` goes to slot
 * 2, otherwise slot 1). Writing it the same way here is deliberate: a hand-load
 * and a belt-load must put the same item in the same place, or a player who
 * primes a machine by hand and then belts it gets two different answers from one
 * machine. An item that is neither ingredient is refused OUT LOUD, because the
 * count arrays cannot remember what a unit was (FS-37) and a silent misroute is
 * the transmutation defect this project has already paid for.
 */
export function feedAssembler(g: Gameplay, b: Placed, item: number): void {
  const r = g.factory.recipeOf(b);
  if (r === null) { g.hud.flash('this assembler has no recipe yet'); return; }
  if (b.build < 0) return;
  const slot2 = r.b.item > 0 && item === r.b.item;
  if (!slot2 && item !== r.a.item) {
    g.hud.flash(`this assembler will not take ${g.game.itemName(item)}`);
    return;
  }
  // Take from the pack FIRST and feed only what actually left it, so a refused
  // removal cannot mint units inside the machine. Same order as `Machines.place`.
  const want = Math.min(5, g.game.count(item));
  const took = want > 0 ? g.game.remove(item, want) : 0;
  if (took <= 0) { g.hud.flash('nothing in the pack to load'); return; }
  if (slot2) g.factory.line.feed2(b.build, took);
  else g.factory.line.feed(b.build, took);
  g.hud.flash(`loaded ${took} ${g.game.itemName(item)}`);
  g.sfx.confirm();
  g.panel.invalidate();
}

/**
 * FS-56: THE RECIPE BUTTON, and it is the one interaction this whole feature
 * exists for.
 *
 * It re-commits the plan (see `Factory.setRecipe` for why a recipe change is a
 * rebuild), which is expensive enough that the no-op case matters and is handled
 * there rather than here. What is handled HERE is saying what happened: a click
 * that rebuilds the base and prints nothing is indistinguishable from a click
 * that missed.
 */
export function setRecipe(g: Gameplay, output: number): void {
  const b = g.openBuild;
  if (b === null || b.kind !== 'assembler') return;
  if (!g.factory.setRecipe(b, output)) return;
  const r = g.factory.recipeOf(b);
  g.hud.flash(r === null ? 'recipe cleared' : `now making ${r.name}`);
  g.sfx.confirm();
  g.panel.invalidate();
}
