// GP-600. WHAT A THING COSTS, IN WORDS, AND IT IS ONE FUNCTION.
//
// Three files wrote this line independently (`Structures.costText`,
// `LaunchPad.costText`, `Buildables.priceText`) and all three did the same two
// things wrong in sandbox, which is the usual outcome of three copies:
//
//   1. THEY DELETED THE PRICE. `if (freeBuild) return 'free  (sandbox)'` throws
//      away the number Reid opens sandbox to look at. He tests the real game in
//      it; a screen that will not tell him a launch pad is 60 Iron because he
//      is not being charged for it has hidden the only thing he wanted.
//   2. THEY USED TWO DIFFERENT WORDS FOR FREE IN ONE MENU. A factory machine
//      with no recipe fell through to a bare `free`, and a priced one printed
//      `free  (sandbox)`, side by side in the same list. Those are genuinely
//      different facts and the wording made them look like a typo instead.
//
// So the two cases now READ differently on purpose, and the difference is the
// information:
//
//   `free`                          -> this costs nothing in ANY mode.
//   `free  (sandbox pays 40 Stone)` -> survival charges 40 Stone; you are not.
//
// This is the same rule GP-600 puts on the ingredient chips through
// `costClass`: the number is information and survives into sandbox, and only
// the VERDICT changes. See `web/src/ui/GameHud.ts`.
//
// PURE, AND IT TAKES NAMES RATHER THAN ItemIds, so it can be called from the
// three files above without any of them gaining an import of the others and
// without this one gaining a dependency on /core, the mode object or Gameplay.

/** One line of a price, already resolved to a display name. */
export interface CostLine { count: number; name: string }

/**
 * The whole price on one line.
 *
 * `free` is `ModeRules.freeBuild`, passed rather than read, so this file holds
 * no opinion about what a mode means: `GameMode.ts` is the one authority for
 * that and this is the one authority for how a price reads.
 */
export function costText(cost: readonly CostLine[], free: boolean): string {
  const price = cost.map((c) => `${c.count} ${c.name}`).join(' + ');
  // Nothing to charge. Says `free` in BOTH modes, which is what makes the
  // sandbox sentence below mean something: a reader can tell the two apart.
  if (price === '') return 'free';
  return free ? `free  (sandbox pays ${price})` : price;
}
