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
  constructor(readonly mode: GameMode) {}

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

  /** What the badge on screen says. Empty in survival: an always-on chip that
   *  says "SURVIVAL" is noise, and the failure being guarded against is a
   *  player who FORGOT they were in sandbox. */
  get badge(): string { return this.sandbox ? 'SANDBOX' : ''; }

  /** How the mode reads in a menu, a toast or a report. */
  get label(): string { return this.sandbox ? 'Sandbox' : 'Survival'; }

  report(): unknown {
    return {
      mode: this.mode, sandbox: this.sandbox, freeBuild: this.freeBuild,
      fullCatalogue: this.fullCatalogue, badge: this.badge,
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
export function urlForMode(href: string, mode: GameMode): string {
  const u = new URL(href);
  if (mode === 'sandbox') u.searchParams.set('sandbox', '1');
  else u.searchParams.delete('sandbox');
  return u.toString();
}
