// THE FIRST MINUTE: a short ordered checklist that reacts to what the player
// already does.
//
// The game had nothing that said what it was for. A player spawned into a
// clearing with twenty-four rocks and no reason to touch any of them, and a
// sandbox with no shape reads as a demo however much of it works.
//
// IT IS NOT A TUTORIAL SYSTEM, deliberately and structurally. There is no step
// machine, no gating, no forced camera, nothing to skip and nothing that can
// block progress: every line below is a QUESTION asked of the live world, and
// the answer is yes or it is not. A player who ignores the list entirely and
// builds a smelting line first will find it has ticked itself off behind them,
// which is the whole difference between a checklist and a tutorial.
//
// THE ORDER IS THE TEACHING. Each objective is the smallest thing that makes
// the next one possible, so the list is also the dependency graph of the
// opening, and a player who follows it in order never hits a wall they have to
// be told about.
//
// COST. One predicate per tick of the SLOW clock (four times a second), each of
// them a couple of counter reads, and the panel re-renders only when the text
// it would produce changes.

// GP-350. THE ROWS THEMSELVES MOVED TO `ObjectiveList.ts` (its header argues
// the split). They are RE-EXPORTED here so every existing importer is
// unchanged: this file is still the name the checklist answers to, and the
// other one is where the content lives.
import type { Gameplay } from './Gameplay.js';
import { OBJECTIVES } from './ObjectiveList.js';
import type { Objective, RocketPort, VoyagePort } from './ObjectiveList.js';

export { OBJECTIVES } from './ObjectiveList.js';
export type { Objective, RocketPort, VoyagePort } from './ObjectiveList.js';

/** Seconds between checks. Fast enough to feel immediate, slow enough to vanish. */
const CHECK_SECS = 0.25;

export interface ObjectiveView {
  rows: { text: string; hint: string; done: boolean; current: boolean;
          /** GP-286. This world cannot satisfy it; `hint` says why. */
          moot: boolean }[];
  doneCount: number;
  total: number;
  complete: boolean;
}

/** '' when the card applies. A card with no `moot` always applies, so the
 *  field is optional and the default is the answer every existing card
 *  wants. */
function mootOf(o: Objective, g: Gameplay): string {
  return o.moot === undefined ? '' : o.moot(g);
}

export class Objectives {
  /** How many have been met, in order. The only state, and it is one integer. */
  index = 0;
  visible = true;
  /** Set by the composition root once the bay and flight exist. See RocketPort. */
  rocket: RocketPort | null = null;
  /** GP-350. Set by `bootMap`, which is the only place all three facts exist.
   *  Null retires the three flight rows; `report().voyage` says which. */
  voyage: VoyagePort | null = null;
  /** Objectives completed this session, for the report. */
  completions = 0;
  private since = 0;
  private lastId = '';

  /** Everything done and the list retired? Then it stops drawing itself. */
  get complete(): boolean { return this.index >= OBJECTIVES.length; }

  /** How many rows this world made impossible. Published so a probe asserts the
   *  skip happened rather than inferring it from a shorter list, and so
   *  "the player did all eight" and "the world skipped one" stay different
   *  claims. */
  mootCount(g: Gameplay): number {
    return OBJECTIVES.filter((o) => mootOf(o, g) !== '').length;
  }

  /**
   * Advance the list. Returns the objective just completed, or null.
   *
   * ONLY the current one is tested, which is what keeps this a checklist rather
   * than a state machine: a player who has already done step five before step
   * three simply completes three, four and five in three consecutive checks,
   * with three consecutive ticks, and never notices the list catching up.
   */
  step(dt: number, g: Gameplay): Objective | null {
    this.since += dt;
    if (this.since < CHECK_SECS || this.complete) return null;
    this.since = 0;
    const o = OBJECTIVES[this.index];
    // A MOOT CARD IS STEPPED PAST, NOT WAITED ON. The list is a checklist and
    // its whole contract is that the current row is achievable; a row this
    // world cannot satisfy would park it for ever and silently hide every row
    // behind it, which is how `Harvest a tree` made the entire chain
    // unreachable on an airless moon. It is NOT counted as a completion,
    // because the player did not do it.
    if (mootOf(o, g) !== '') { this.index++; return null; }
    if (!o.done(g, this.rocket, this.voyage)) return null;
    this.index++;
    this.completions++;
    return o;
  }

  /**
   * The rows a panel draws: what is done, what is next, and what is coming.
   *
   * GP-165: only the CURRENT row's hint is resolved, because only the current
   * row draws one and the others would be ten derivations a frame for text
   * nobody sees.
   */
  view(g: Gameplay): ObjectiveView {
    return {
      rows: OBJECTIVES.map((o, i) => {
        const why = mootOf(o, g);
        return {
          text: o.text,
          // THE REASON REPLACES THE HINT, because a hint tells you how to do a
          // thing and there is no how. Drawn on the moot row whether or not it
          // is current, since the point is that a player scanning the list
          // learns why it is greyed rather than wondering.
          hint: why !== '' ? why : (i === this.index ? o.hint(g) : ''),
          // `index` IS A POSITION, NOT A CLAIM OF ACHIEVEMENT, and until this
          // line those were the same thing. `step` walks past a moot card, so
          // `i < index` became true for it and the row published `done: true`
          // about a tree nobody harvested on a world with no trees. The PANEL
          // was already right (it tests `moot` before `done`), so nothing on
          // screen was wrong and the lie was only in the published field:
          // exactly the kind a probe reads and a screenshot cannot.
          //
          // Caught by this probe's own `it is NOT drawn as done` check, which
          // was written because crediting the player with an impossible task is
          // worse than the bug it replaced.
          done: i < this.index && why === '', current: i === this.index,
          moot: why !== '',
        };
      }),
      doneCount: this.index,
      total: OBJECTIVES.length,
      complete: this.complete,
    };
  }

  /**
   * A cheap key for the panel's diff. The CURRENT HINT is part of it (GP-165):
   * a hotbar edit changes a hint under a fixed index, and a key that cannot
   * see that is GP-137's stale-list defect (a screen built once per event that
   * has a second trigger nobody keyed on).
   */
  private keyFor(currentHint: string): string {
    return `${this.index}|${this.visible ? 1 : 0}|${currentHint}`;
  }

  /** The id of the objective now in front of the player. '' when finished. */
  get currentId(): string { return OBJECTIVES[this.index]?.id ?? ''; }

  /**
   * GP-350. EVERY ROW'S PREDICATE, EVALUATED NOW, for the debug report only.
   *
   * `view()`'s `done` is a POSITION (`i < index`), which is the right thing to
   * draw and the wrong thing to test with: a row is not `done` until the list
   * has walked to it, so a probe reading that field cannot tell "the world does
   * not satisfy this" from "the list has not got there yet". Those are exactly
   * the two states a fixture has to distinguish to prove a new row works
   * without first driving the ten rows in front of it.
   *
   * It is also what lets a probe assert the DEFAULT, which is the thing
   * INSTRUMENTS.md says nobody writes: at spawn all three flight rows must read
   * false, and a build where the port is missing reads them all TRUE while
   * looking identical on screen.
   */
  satisfied(g: Gameplay): { id: string; satisfied: boolean; moot: boolean }[] {
    return OBJECTIVES.map((o) => ({
      id: o.id,
      satisfied: o.done(g, this.rocket, this.voyage),
      moot: mootOf(o, g) !== '',
    }));
  }

  /**
   * GP-165. Every hint, resolved NOW, for the debug report only. It is the
   * same function the panel draws, which is what makes a probe reading it a
   * probe of the screen's own derivation rather than of a parallel copy; the
   * panel itself still resolves only the current row.
   */
  allHints(g: Gameplay): { id: string; hint: string }[] {
    return OBJECTIVES.map((o) => ({ id: o.id, hint: o.hint(g) }));
  }

  /** Force a re-render on the next frame. */
  invalidate(): void { this.lastId = ''; }

  /** True when the panel's content would differ from what it last drew. */
  changed(currentHint: string): boolean {
    const k = this.keyFor(currentHint);
    if (k === this.lastId) return false;
    this.lastId = k;
    return true;
  }

  /** Whether the player had it open last time. Dismissal survives a reload. */
  wasVisible(): boolean {
    try { return localStorage.getItem('of.goals') !== '0'; } catch { return true; }
  }

  report(): unknown {
    return {
      index: this.index, total: OBJECTIVES.length, complete: this.complete,
      completions: this.completions, visible: this.visible,
      current: this.currentId,
      done: OBJECTIVES.slice(0, this.index).map((o) => o.id),
      // GP-350. THE ORDER, so a probe asserts that the chain continues past the
      // pad by reading the list rather than by counting it. A count would pass
      // on three rows about anything.
      ids: OBJECTIVES.map((o) => o.id),
      // GP-350. WHETHER THE FLIGHT PORT IS WIRED AT ALL. Null makes three rows
      // report done, which is correct for `?flight=0` and is indistinguishable
      // on screen from a build where the wiring was dropped, so it is published
      // and asserted rather than assumed.
      voyage: this.voyage !== null,
    };
  }
}

/** Show or hide the checklist, and remember the choice. */
export function showGoals(g: Gameplay, v: boolean): void {
  g.goals.visible = v;
  g.goalPanel.setVisible(v);
  g.goals.invalidate();
  try { localStorage.setItem('of.goals', v ? '1' : '0'); } catch { /* private mode */ }
}

/**
 * Advance the checklist and draw it.
 *
 * A completion gets a banner and a chime, and after GP-60 it is one of only two
 * things left that does. A checklist tick is a ONE-TIME event the player
 * earned, which is exactly what a screen-wide flash is for; a finished ingot is
 * routine production that repeats every three seconds for the rest of the game,
 * which is why it lost its banner and now speaks at the machine instead. That
 * distinction is the whole rule, and this call site is on the right side of it.
 * It lives here rather than on Gameplay because Gameplay is a composition at
 * its line cap and this is not a responsibility, it is one predicate and one
 * render.
 */
export function stepGoals(g: Gameplay, dt: number): void {
  const met = g.goals.step(dt, g);
  if (met !== null) {
    g.hud.banner(`${met.text.toUpperCase()}  ✓`, '#f0a04b');
    g.sfx.chime(g.goals.index);
    g.goals.invalidate();
  }
  // GP-350. THE CHECKLIST STAYS UP IN THE COCKPIT, and this is set BEFORE the
  // early return below.
  //
  // The list ended at the launch pad, so every row it had was a row the walker
  // could do, and hiding it with the walker's HUD was always right. Three
  // flight rows make that false in the sharpest possible way: STRAPPING IN IS
  // HOW YOU REACH "fly it to orbit", so the panel went dark on the same frame
  // the row became possible.
  //
  // `g.suspended` is the one condition, and it is deliberately not "the current
  // row is a flight row". A second term would be a branch nothing drives: the
  // ground rows in front of it need a whole factory, so a fixture that reached
  // it would depend on another lane's live files, and an untested branch that
  // only ever ADDS visibility is not worth the claim (INSTRUMENTS.md: an
  // assertion never seen to fail is not an assertion). One term, both values
  // driven. The bay and the map still hide it, which is right: both own the
  // whole screen and both instruct on their own.
  //
  // `Gameplay.frame` runs every drain whether or not the player is strapped in
  // (only the ON-FOOT half is suspended), so this is re-derived in the cockpit.
  // `goals.visible` is the player's own H switch and still wins, so a list they
  // hid stays hidden.
  g.goalPanel.setPinned(g.goals.visible && !g.goals.complete && g.suspended);
  if (!g.goals.visible) return;
  const v = g.goals.view(g);
  if (!g.goals.changed(v.rows[g.goals.index]?.hint ?? '')) return;
  g.goalPanel.render(v.rows, v.doneCount, v.complete);
}
