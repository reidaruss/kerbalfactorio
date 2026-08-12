// SANDBOX IS A MODE, NOT A CHEAT FLAG (DW-31), and this file is the one place
// that answers what a mode means.
//
// The whole design is one object with a handful of NAMED questions. Every gate
// in the game asks this object rather than reading a boolean off Config, for the
// reason DW-26 states in general and this project has paid for five times: an
// unnamed second copy of a rule becomes a second authority. There is exactly one
// `sandbox === true` test in the codebase and it is below.
//
// WHY NAMED QUESTIONS RATHER THAN ONE BOOLEAN. `freeBuild` and `fullCatalogue`
// are the same answer today and will not always be: DW-31 asks for no cost AND
// no research gate AND no pack requirement, and research does not exist in the
// web client yet. When it lands it asks `freeBuild` and gets the right answer on
// the day it is written, instead of somebody remembering to add `|| sandbox` to
// a new branch. That is the same derivation argument ModalStack.ts makes about
// Escape, applied to progression.
//
// WHAT THIS FILE DOES NOT DO: it does not switch modes. A mode is fixed for the
// life of a world, decided at boot from `?sandbox=1` or from the menu (which
// reloads), because half a session in each mode is exactly the contamination
// DW-31 forbids and there is no honest way to label the save that comes out of
// it.

/** The two modes a world can be created in. A world never changes mode. */
export type GameMode = 'survival' | 'sandbox';

export const GAME_MODES: readonly GameMode[] = ['survival', 'sandbox'];

/** Read a mode back off untrusted data (a save slot, a URL). */
export function asMode(v: unknown): GameMode {
  return v === 'sandbox' ? 'sandbox' : 'survival';
}

/**
 * The rules a mode implies, asked by name.
 *
 * Immutable by construction: the mode is a constructor argument and there is no
 * setter, so no caller can flip the game halfway through a session.
 */
export class ModeRules {
  /** `sandboxCombat` is the `?combat=1` opt-in, read at boot and never again.
   *  It is ignored in survival, which is always hostile: see `hostile`. */
  constructor(readonly mode: GameMode, readonly sandboxCombat = false) {}

  get sandbox(): boolean { return this.mode === 'sandbox'; }

  /**
   * May anything be placed with no cost, no research gate and no requirement
   * that the item be in the pack?
   *
   * THE THREE GATES THAT ASK THIS, so a reader can find them: `Structures`
   * (a structural part's `CraftRecipe` cost, paid through /core), `Machines`
   * (a hand furnace must be in the pack), and, when it lands, the research
   * unlock bits `research.h` already computes headlessly.
   */
  get freeBuild(): boolean { return this.sandbox; }

  /**
   * Is the whole catalogue offered rather than only what has been crafted?
   *
   * Reid: "i can just pick anything thats in the game and place it". The hotbar
   * already carries all nine entries as DATA (`DEFAULT_BAR`), so what this
   * actually turns on is the craft panel: every recipe reads craftable and
   * costs nothing, which is how a raw item enters a sandbox pack at all.
   */
  get fullCatalogue(): boolean { return this.sandbox; }

  /**
   * Does the TECH TREE gate what may be crafted and placed?
   *
   * THIS IS THE BRANCH `freeBuild`'s comment PREDICTED, written the day
   * research landed rather than by somebody remembering to add `|| sandbox` to
   * it. It is a third named question and not a reuse of `freeBuild` because the
   * two are about different things and will diverge: `freeBuild` is about COST,
   * this is about AVAILABILITY, and the first mode that wants "everything
   * unlocked but still paid for" (a creative-but-honest mode, or a scenario
   * that starts mid-tree) needs them apart. They happen to be complements
   * today, and GP-29's whole argument is that questions with the same answer
   * today are still different questions.
   *
   * THE GATES THAT ASK THIS, so a reader can find them: the craft panel
   * (`GameplayViews.recipeRows` and `GameplayActions.craft`, for a locked
   * recipe) and the build hotbar (`Hotbar.available`, for a locked machine).
   */
  get researchGated(): boolean { return !this.sandbox; }

  /**
   * D-019. Must a RESEARCH STATION have been built before the tech tree opens?
   *
   * THE SIXTH NAMED QUESTION, and it is the fourth time `freeBuild`'s comment
   * has been right about what would happen: a branch written months later asks
   * by name and gets the right answer, instead of somebody remembering to add
   * `|| sandbox` to it.
   *
   * IT IS NOT A REUSE OF `researchGated`, though they agree today. That one is
   * about AVAILABILITY: which techs and items the tree has unlocked. This one is
   * about a BUILDING: whether the screen has a referent in the world at all. A
   * mode that wanted "the whole tree unlocked but you still have to walk to the
   * bench" (a scenario starting mid-tree, or a tutorial world) needs them apart,
   * and that is exactly the kind of mode `researchGated`'s own comment predicts.
   *
   * SANDBOX LIFTS IT, matching every other gate in this file: DW-31 says sandbox
   * is for playtesting without grind, and making Reid mine 20 iron before he can
   * read the tech tree he opened sandbox to read is grind of the purest kind.
   * The lift is TRUTH-TELLING rather than silent, which is GP-600's rule: the
   * refusal `ProgressUi` would have shown is published in its report either way,
   * so a probe can tell a lifted gate from a broken one.
   *
   * THE ONE GATE THAT ASKS THIS, so a reader can find it: `ProgressUi.toggle`.
   */
  get researchStationGated(): boolean { return !this.sandbox; }

  /**
   * Is the WHOLE MAP visible, or only what has actually been seen?
   *
   * DW-36: the map is discoverable in survival ("you cannot see what you have
   * never been to") and complete in sandbox. This is the fourth named question
   * and the third time `freeBuild`'s comment has been right about what would
   * happen: a branch written months later asks by name and gets the right
   * answer, instead of somebody remembering to add `|| sandbox` to it.
   *
   * It is NOT a reuse of `fullCatalogue` even though the two agree today, for
   * the reason `researchGated` gives at length: questions with the same answer
   * today are still different questions, and these two will diverge the moment
   * anything wants a scenario that starts with a surveyed world but no free
   * parts, or a hardcore mode with a fogged map and an open catalogue.
   *
   * THE ONE GATE THAT ASKS THIS, so a reader can find it: `MapWorld.ore()` in
   * app/MapWorld.ts, which decides whether an ore patch on undiscovered ground
   * reaches the painter at all. The map's shading needs no gate because it
   * draws only what IS discovered; there is nothing to hide.
   */
  get fullMapRevealed(): boolean { return this.sandbox; }

  /**
   * Can the world HURT the player, and will anything come for their base?
   *
   * DW-31 says sandbox is for playtesting without grind, and being killed by a
   * wave while measuring a rocket is grind of the purest kind, so the default
   * answer in sandbox is no: nothing spawns and the player cannot die. This is
   * the FIFTH named question and not a reuse of `freeBuild`, for the reason
   * `researchGated` gives at length: it is about DANGER rather than cost or
   * availability, and the first person who wants to test a defensive layout
   * without also mining the walls for it needs the two apart.
   *
   * `?combat=1` turns it back on IN SANDBOX, decided at boot like the mode
   * itself and with no runtime setter, because GP-29's argument holds here too:
   * a world that spent five minutes hostile and five minutes safe has no honest
   * thing to say about why the base is in pieces. Survival is always hostile and
   * the flag cannot turn it off, because a survival world in which nothing ever
   * attacks is a sandbox world wearing the wrong label on its save slot.
   *
   * THE GATES THAT ASK THIS, so a reader can find them: `PlayerHealth.hurt`
   * (through the `mortal` thunk) and `Enemies.init`, which in a safe world
   * brings up NO loop, seeds NO nests and publishes the sentence it is
   * overriding rather than reporting a quiet zero (GP-93).
   */
  get hostile(): boolean { return !this.sandbox || this.sandboxCombat; }

  /** What the badge on screen says. Empty in survival: an always-on chip that
   *  says "SURVIVAL" is noise, and the failure being guarded against is a
   *  player who FORGOT they were in sandbox. */
  get badge(): string { return this.sandbox ? 'SANDBOX' : ''; }

  /** How the mode reads in a menu, a toast or a report. */
  get label(): string { return this.sandbox ? 'Sandbox' : 'Survival'; }

  report(): unknown {
    return {
      mode: this.mode, sandbox: this.sandbox, freeBuild: this.freeBuild,
      fullCatalogue: this.fullCatalogue, researchGated: this.researchGated,
      researchStationGated: this.researchStationGated,
      fullMapRevealed: this.fullMapRevealed, hostile: this.hostile,
      sandboxCombat: this.sandboxCombat, badge: this.badge,
    };
  }
}

/** The survival rules, for a call site with no world (a null gameplay layer). */
export const SURVIVAL = new ModeRules('survival');

/**
 * The URL that switches modes, built from the CURRENT one.
 *
 * The menu reloads rather than toggling in place, and that is the decision worth
 * defending: a mode is recorded on the save slot, so a world that spent five
 * minutes in each mode has no true label to write. A reload gives the new mode
 * its own boot, its own generated world and its own slot, and costs a second.
 */
/**
 * Is `?combat=1` set? See `ModeRules.hostile`.
 *
 * It is read HERE rather than in the boot config, and that is deliberate: this
 * file already owns the URL encoding of a mode (`urlForMode` writes it), so the
 * one place that knows `?sandbox=1` means sandbox is also the place that knows
 * what `?combat=1` means. Passing it down through the boot would have put a
 * second authority on mode semantics in a file three lanes are editing tonight.
 */
export function sandboxCombatFromUrl(href: string): boolean {
  try {
    return new URL(href).searchParams.get('combat') === '1';
  } catch {
    return false;
  }
}

export function urlForMode(href: string, mode: GameMode): string {
  const u = new URL(href);
  if (mode === 'sandbox') u.searchParams.set('sandbox', '1');
  else u.searchParams.delete('sandbox');
  return u.toString();
}
