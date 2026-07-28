// FS-56: WHAT AN ASSEMBLER CAN BE SET TO MAKE.
//
// Reid: "it's just automating the crafting process again." That sentence is the
// whole design of this file, taken literally: an assembler's recipe list is NOT
// a new table of bills of materials, it is /core's OWN HAND-RECIPE TABLE,
// `gameplay.h` section S.3 `handRecipes()`, read across the bridge through
// `of_gp_recipe_info` and filtered to the rows the factory sim can actually
// execute. A smelter costs 5 iron and 5 stone in the crafting menu and it costs
// 5 iron and 5 stone in an assembler, because both readings come from the same
// bytes.
//
// THE ALTERNATIVE WAS TO AUTHOR THE BILLS HERE AND IT IS THE MISTAKE THIS
// PROJECT KEEPS PAYING FOR. A second copy of "a smelter costs 5 iron and 5
// stone" would agree with the first one on the day it was written and would
// disagree the first time anyone rebalanced either, in a direction nobody would
// notice, because both numbers look correct in isolation. That is DW-26's rule
// (one authority, or publish both shapes and test the bound) and FS-41's defect
// (a recipe authored at placement time out of a fallback) applied to content
// rather than to geometry.
//
// WHAT IS AUTHORED HERE, and it is exactly one thing: HOW LONG A CRAFT TAKES.
// `CraftRecipe` has no time field, because hand-crafting in `gameplay.h` is
// instantaneous by construction, so a machine that performs the same recipe over
// time needs a duration that genuinely does not exist upstream. It is DERIVED
// from the bill rather than tabulated, so a recipe /core adds tomorrow gets a
// sensible time with nobody editing this file, and there is no second table to
// fall out of date. See `ticksFor`.
//
// WHY ONLY TWO-INGREDIENT RECIPES ARE OFFERED, and why the rest are listed as
// REFUSALS rather than silently dropped: `factory_sim.h`'s `Recipe` holds
// `inputItem` and `input2Item` and nothing more, so a machine with three
// ingredients cannot be expressed, let alone executed. That is also exactly
// Satisfactory's own Assembler, which takes two inputs; its four-input machine
// is a separate, larger Manufacturer. A player who opens the panel looking for
// the electric smelter needs to be told it needs three ingredients and that this
// machine takes two, which is a fact about the world they can act on. A menu
// that just does not list it is a feature nobody can find (GP-56).

import type { RecipeView } from './GameCore.js';

/**
 * One recipe an assembler can be set to, in the shape `of_net_place_assembler`
 * takes. Every field except `ticks` came out of /core.
 */
export interface AssemblerRecipe {
  /**
   * THE OUTPUT ITEM IS THE RECIPE'S IDENTITY, and not /core's list index.
   *
   * A save records this number, and `handRecipes()` is an append-only vector
   * whose ordinals shift the moment a row is inserted rather than appended,
   * while an `ItemId` is pinned, stable and never reused (gameplay.h section A).
   * Storing the index would work today and would silently re-point every
   * assembler in every save the first time /core's list was reordered, which is
   * the class of failure that has no symptom until it has a very bad one.
   */
  output: number;
  outputCount: number;
  /** Display name of the output, /core's own, never a client string table. */
  name: string;
  a: { item: number; count: number; name: string };
  b: { item: number; count: number; name: string };
  /** Craft duration in sim ticks. The one authored number here. */
  ticks: number;
}

/** A /core hand recipe this machine cannot run, and the reason, for the panel. */
export interface RefusedRecipe {
  output: number;
  name: string;
  why: string;
}

export interface RecipeMenu {
  offered: AssemblerRecipe[];
  refused: RefusedRecipe[];
}

/**
 * HOW LONG ONE CRAFT TAKES, derived from the bill and never tabulated.
 *
 * `60 + 12 * units`, where `units` is the total number of ingredient units the
 * recipe consumes. One second of setup plus a fifth of a second per unit, at the
 * 60 Hz fixed tick every other number in this sim is quoted in.
 *
 * On the three recipes this ships with that is:
 *   power pole        3 units ->  96 ticks = 1.60 s
 *   primitive furnace 7 units -> 144 ticks = 2.40 s
 *   smelter          10 units -> 180 ticks = 3.00 s
 *
 * A formula rather than a table for one reason that matters more than balance:
 * a table has to be edited when /core's recipe list grows, and nothing would
 * fail if nobody did. It would simply fall back to a default, and a machine
 * would craft a ten-unit recipe as fast as a three-unit one with no sign that a
 * row was missing. The formula cannot be out of date. It can only be badly
 * chosen, which is visible and is a balance question rather than a bug.
 *
 * The smelter's 3.00 s against the coal smelter's own 60-tick ore is
 * deliberately the slower end: an assembler makes buildings, not ingots.
 */
export function ticksFor(units: number): number {
  return 60 + 12 * Math.max(0, units);
}

/**
 * Turn /core's hand recipes into the assembler's menu.
 *
 * `views` is `GameCore.recipes()` verbatim. `nameOf` is `GameCore.itemName`,
 * passed in rather than reached for so this file holds no reference to the
 * bridge and a probe can drive it with a fixture.
 *
 * A ONE-INGREDIENT RECIPE IS OFFERED AND IS NOT A SPECIAL CASE: `placeAssembler`
 * documents `countB = 0 / inB = kNoItem` as a legal single-ingredient assembler,
 * and `machineSystem` reads a `kNoItem` second slot as satisfied. So the filter
 * is "one or two", stated as "not more than two", which is the real constraint.
 * Nothing in the shipped hand set has one ingredient today; writing the rule
 * against the sim's actual limit rather than against today's content is what
 * stops the next single-ingredient recipe being mysteriously absent.
 */
export function assemblerMenu(views: readonly RecipeView[],
                              nameOf: (item: number) => string): RecipeMenu {
  const offered: AssemblerRecipe[] = [];
  const refused: RefusedRecipe[] = [];
  for (const v of views) {
    const name = nameOf(v.output);
    if (v.output <= 0) continue;
    if (v.inputs.length === 0) {
      refused.push({ output: v.output, name, why: 'has no ingredients' });
      continue;
    }
    if (v.inputs.length > 2) {
      refused.push({ output: v.output, name,
        why: `needs ${v.inputs.length} ingredients, this machine takes 2` });
      continue;
    }
    const a = v.inputs[0];
    const b = v.inputs[1];
    let units = a.need;
    if (b !== undefined) units += b.need;
    offered.push({
      output: v.output,
      outputCount: v.outputCount,
      name,
      a: { item: a.item, count: a.need, name: nameOf(a.item) },
      // kNoItem is 0 and count 0, which is `placeAssembler`'s own documented
      // single-ingredient form. Written as an explicit pair rather than as an
      // optional field so every caller handles both shapes with no branch, and
      // specifically so nobody writes `b?.item || fallback`, which is FS-41's
      // defect verbatim: 0 is a VALID item id here and `||` eats it.
      b: b === undefined
        ? { item: 0, count: 0, name: '' }
        : { item: b.item, count: b.need, name: nameOf(b.item) },
      ticks: ticksFor(units),
    });
  }
  return { offered, refused };
}

/** The recipe a saved/placed assembler is set to, by output id. Null for none. */
export function recipeByOutput(menu: RecipeMenu,
                               output: number): AssemblerRecipe | null {
  if (output <= 0) return null;
  return menu.offered.find((r) => r.output === output) ?? null;
}

/**
 * WHAT AN UNSET ASSEMBLER MAKES, and the answer is deliberately NOTHING.
 *
 * The reflex is to default to the first row so a freshly placed machine does
 * something, and it is wrong here for the same reason FS-41 was wrong: a machine
 * silently built with a recipe nobody chose is a machine whose behaviour has no
 * author. It would also make the one interaction this whole feature exists for,
 * choosing a recipe, invisible to a player who never noticed the machine had
 * already picked one. An unset assembler reads NO RECIPE on the crosshair and in
 * the panel, which is the sentence that sends them to the menu.
 */
export const NO_RECIPE = 0;

// --- the three operations a PLAN performs on a recipe ------------------------
// Free functions taking a `Factory`, which is the shape `FactoryHand.turnPlaced`
// and `FactoryRestore.restorePlan` already use: Factory owns the plan and its
// lifecycle, and what a recipe IS lives beside the table it is read from.

/**
 * The menu, and it IS cached, per `Factory`, keyed on /core's own recipe count.
 *
 * THE FIRST DRAFT REFUSED TO CACHE IT AND WROTE DOWN THE WRONG REASON, which is
 * worth recording because the wrong reason was the plausible one: that a cached
 * menu would grey a row the player had just earned the materials for. It would
 * not, because AFFORDABILITY IS NOT IN HERE. `AssemblerRecipe` carries the bill,
 * the names and the craft time and no pack state at all; `MachineAssembler` asks
 * `game.count` for each row every time it renders. So the cached thing is
 * genuinely static content and the live thing is genuinely live, which is the
 * split that makes a cache safe rather than a second authority.
 *
 * It matters because `screenView` runs on the FRAME LOOP while a panel is open,
 * before the panel's own unchanged-key early-out. Uncached, an open assembler
 * cost roughly a hundred bridge calls per frame, most of them `itemName` string
 * reads out of the u8 scratch, for a table that cannot change: `g_gpRecipes` is
 * built once in `of_gp_init` and research GATES recipes rather than adding them.
 *
 * HELD IN A WeakMap KEYED ON THE `Factory` ITSELF, and deliberately with no
 * second validity check, because there is nothing cheap enough to check with.
 * `GameCore.recipes()` IS the expensive call, so asking it for a length to
 * validate a cache would spend exactly what the cache is meant to save. What
 * makes the plain WeakMap sufficient is a property of the thing being cached
 * rather than of the cache: one `Factory` belongs to one world, `of.wipe()`
 * builds a new one, and the only way /core's recipe CONTENT can differ between
 * two `of_gp_init` calls in one page is a code change, not a runtime event.
 * Research GATES recipes, it does not append them.
 */
const cache = new WeakMap<object, RecipeMenu>();

export function menuOf(f: FactoryLike): RecipeMenu {
  const hit = cache.get(f as object);
  if (hit !== undefined) return hit;
  const menu = assemblerMenu(f.core.recipes(), (i) => f.core.itemName(i));
  cache.set(f as object, menu);
  return menu;
}

/** The recipe one assembler is set to, or null for an unset machine. */
export function recipeOfPlaced(f: FactoryLike,
                               p: PlacedLike): AssemblerRecipe | null {
  if (p.kind !== 'assembler') return null;
  return recipeByOutput(menuOf(f), p.recipe);
}

/**
 * Set an assembler's recipe and re-commit. True if anything moved.
 *
 * IT RE-COMMITS, and that is not a heavy hammer reached for out of laziness: a
 * machine's recipe is baked into the /core entity at `addMachine` time and
 * `FactorySim` has no re-recipe call BY DESIGN, so the only way to change what a
 * machine makes is the way the only way to remove one is, which is to rebuild
 * the network from the plan. Factory.ts's header argues why that is the right
 * shape. The cost is one rebuild and whatever is riding the belts, which is the
 * cost every placement already pays.
 *
 * Setting the recipe it already has is a NO-OP rather than a free rebuild,
 * because the panel re-renders on a timer and a click that lands twice must not
 * cost the base its belt cargo.
 *
 * An output /core does not offer is REFUSED rather than stored: a plan holding a
 * recipe nothing can run is a save that loads as a dead machine with no
 * explanation, which is worse than a machine that never accepted the click.
 */
export function setPlacedRecipe(f: FactoryLike, p: PlacedLike,
                                output: number): boolean {
  if (p.kind !== 'assembler' || p.recipe === output) return false;
  if (output !== NO_RECIPE && recipeByOutput(menuOf(f), output) === null) {
    return false;
  }
  p.recipe = output;
  f.commit();
  return true;
}

/** The least of `Factory` these three touch. Structural, so `Factory` satisfies
 *  it with no declaration and this file needs no import from it: the two would
 *  otherwise import each other for a type nobody widens. */
interface FactoryLike {
  core: { recipes(): RecipeView[]; itemName(item: number): string };
  commit(): void;
}
/** The least of `Placed` these three touch. */
interface PlacedLike { kind: string; recipe: number }
