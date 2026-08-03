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

import { labelOf } from '../player/Bindings.js';
import type { Action } from '../player/Bindings.js';
import type { Gameplay } from './Gameplay.js';
import { bodyIsAirless } from './StarterContent.js';

/** Seconds between checks. Fast enough to feel immediate, slow enough to vanish. */
const CHECK_SECS = 0.25;

/**
 * What the checklist is allowed to know about the assembly bay and flight.
 *
 * A PORT, set by the composition root once both exist, because both are
 * dynamically imported and neither is built when this list is defined. Null
 * with `?vab=0` or `?flight=0`, and the two objectives below retire themselves
 * in that case rather than stalling a checklist for ever on a feature the run
 * deliberately isolated.
 */
export interface RocketPort {
  /** Parts on the assembly bay's stand right now. */
  parts(): number;
  /** Vessels set down on the ground this session. */
  rollouts(): number;
  /** Times the player has climbed into one. */
  boardings(): number;
}

export interface Objective {
  id: string;
  /** The imperative. */
  text: string;
  /** GP-165: a FUNCTION of the live game, never a string, so a key or a slot
   *  number can only ever be derived. See the block comment above OBJECTIVES. */
  hint: (g: Gameplay) => string;
  done: (g: Gameplay, r: RocketPort | null) => boolean;
  /**
   * GP-286. '' when this card applies to the world the player is standing on.
   * Otherwise the SENTENCE saying why this world cannot satisfy it.
   *
   * A checklist that names a task the world has refused to make possible is
   * GP-165's defect one level up: not a wrong KEY for a real task, a wrong
   * TASK. `Harvest a tree` has been the first thing a player reads on Cinder,
   * which is airless and on which `StarterContent`'s own invariant REFUSES to
   * place a tree. The card was impossible, the list parked on it, and nothing
   * downstream of it could ever be reached.
   *
   * A moot card is DRAWN AND NAMED rather than filtered out, which is GP-114's
   * rule (a locked thing named beats an absent thing) and is why this returns a
   * sentence rather than a boolean: "there are no trees here" teaches a player
   * something about where they are, and a list that silently got shorter
   * teaches them nothing and looks like a bug.
   */
  moot?: (g: Gameplay) => string;
}

/** How many ingots off an automated line count as "it ran without you". */
const AUTO_TARGET = 1;

/**
 * GP-165. THE NUMBER KEY FOR WHATEVER SLOT HOLDS `part` RIGHT NOW, read off
 * the live hotbar, because the bar is editable (GP-108) and a hint that says
 * "press 4" about a slot the player emptied is teaching a dead key. Falls back
 * to naming the build menu, which can always put the part in hand.
 */
function slotOf(g: Gameplay, part: string): string {
  const i = g.hotbar.slots.findIndex((s) => s.kind === 'part' && s.part === part);
  return i >= 0 ? labelOf(`slot${i + 1}` as Action)
    : `the build menu (${labelOf('build')})`;
}

/** The furnace's own slot, same derivation (it is a `furnace` kind, not a part). */
function furnaceSlot(g: Gameplay): string {
  const i = g.hotbar.slots.findIndex((s) => s.kind === 'furnace');
  return i >= 0 ? labelOf(`slot${i + 1}` as Action)
    : `the build menu (${labelOf('build')})`;
}

/**
 * GP-165. EVERY KEY AND SLOT IN A HINT IS DERIVED, never typed.
 *
 * The first six hints a new player read carried FIVE wrong controls between
 * them: "hold E" for a harvest the left button does (GP-26 moved it), "G to
 * place" for a placement that is a click (GP-27 moved it), "press 1" for a
 * drill that sits on slot 3, and "press 2 for belt, 3 for smelter" about
 * slots 4 and 5. Every one was true when written and nobody re-read this file
 * across two control remaps and a hotbar rework, which is the project's
 * fourth wrong-key-on-screen incident (the mute hint, the map hint, GP-140's
 * two prettifiers). Same fix as all three: the ONE binding table spells every
 * control, and a slot number comes off the LIVE bar, so an edited hotbar
 * re-teaches its own layout. `probes/goalhints.js` reassigns the drill
 * mid-run and watches the drawn hint follow it, which no prose can pass.
 */
export const OBJECTIVES: Objective[] = [
  {
    id: 'wood', text: 'Harvest a tree',
    hint: () => `aim at one and hold ${labelOf('use')}`,
    done: (g) => g.game.count(g.game.ids.wood) >= 4,
    // THE SAME AUTHORITY THAT REFUSED TO PLACE THE TREE. Not a body name and
    // not a second atmosphere test: `bodyIsAirless` is the one copy of the
    // question, so the day a body grows an atmosphere its trees and this card
    // come back together.
    moot: (g) => (bodyIsAirless(g.core, g.starterBodyId)
      ? 'nothing grows here: this body has no air, so there is no tree to '
        + 'harvest and no wood on it at all.' : ''),
  },
  {
    id: 'tool', text: 'Craft a pickaxe',
    hint: () => `${labelOf('pack')} opens the pack`,
    done: (g) => g.game.count(g.game.ids.pickaxe) >= 1,
  },
  {
    id: 'ore', text: 'Mine iron ore',
    hint: () => 'the grey-blue patch of ground',
    done: (g) => g.game.count(g.game.ids.rawIron) >= 5,
  },
  {
    id: 'smelt', text: 'Smelt it into iron',
    hint: (g) => `craft a furnace, ${furnaceSlot(g)} and ${labelOf('use')} `
      + `place it, ${labelOf('interact')} opens it`,
    done: (g) => g.game.count(g.game.ids.iron) >= 1,
  },
  {
    id: 'miner', text: 'Put a drill on an ore patch',
    hint: (g) => `press ${slotOf(g, 'miner')}, then ${labelOf('use')}`,
    done: (g) => g.factory.placed.some((p) => p.kind === 'miner'),
  },
  {
    id: 'belt', text: 'Run a belt from it to a smelter',
    hint: (g) => `${slotOf(g, 'belt')} is belt, ${slotOf(g, 'smelter')} is `
      + `smelter, ${labelOf('rotate')} turns`,
    done: (g) => g.factory.placed.some((p) => p.kind === 'belt')
      && g.factory.placed.some((p) => p.kind === 'smelter'),
  },
  {
    id: 'auto', text: 'Walk away, then take what it made',
    hint: () => `${labelOf('interact')} opens the smelter, click its output`,
    done: (g) => g.autoCollected >= AUTO_TARGET,
  },
  // GP-53. THE SPACE HALF OF THE GAME HAD NO ENTRANCE. The assembly bay and
  // flight have been in the build since W8 and W9 and NOTHING on screen named
  // either of them: not the HUD, not the pack, not the hotbar, not this list.
  // Reid built a base and then had to ask "how do i build a launchpad and
  // rocket, i cant find it in the menu", and he was right, it was not there.
  //
  // This list is the answer rather than a HUD line or a menu entry, for three
  // reasons. It already teaches the opening step by step and RETIRES itself
  // when done, so it costs nothing after the first hour where a permanent HUD
  // line is clutter for ever. It is data, so the wording iterates without code.
  // And it is ORDERED, so the rocket appears after the factory that pays for
  // it, which is DW-29's "ground progression first" stated where a player can
  // actually read it. Both rows are visible as upcoming from the first minute,
  // which is the part that answers "I cannot find it".
  // GP-57. THE PAD, NAMED, and BEFORE the rocket rather than after it.
  //
  // The order is the teaching. A player who builds a rocket first and then
  // discovers it needs a launch site has done the two halves in the order that
  // makes the second one feel like a tax; doing the platform first makes the
  // rocket the reward. It is also the honest order for the costs: 36
  // foundations plus 60 Iron is a project, and finding that out AFTER assembling
  // a vehicle is the sort of thing that makes a player put a game down.
  //
  // The row RETIRES on the pad existing rather than on the tech being bought,
  // because what the player has to do is build the thing, and a checklist that
  // ticks itself when you press a research button has taught you nothing about
  // where the pad goes.
  {
    id: 'pad', text: 'Build a launch pad on a 6 x 6 foundation platform',
    hint: (g) => `research Launch Facilities (${labelOf('research')}), then `
      + `${slotOf(g, 'launchpad')} puts one in your hand`,
    done: (g) => g.pads.list.length >= 1,
  },
  {
    id: 'rocket', text: 'Build a rocket in the assembly bay',
    hint: () => `press ${labelOf('assembly')} to go in, click parts onto the stack`,
    done: (_g, r) => r === null || r.parts() >= 2,
  },
  {
    id: 'launch', text: 'Roll it out and climb aboard',
    hint: () => `${labelOf('board')} rolls it onto the pad, ${labelOf('board')} `
      + `again straps you in`,
    done: (_g, r) => r === null || r.boardings() >= 1,
  },
];

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
    if (!o.done(g, this.rocket)) return null;
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
  if (!g.goals.visible) return;
  const v = g.goals.view(g);
  if (!g.goals.changed(v.rows[g.goals.index]?.hint ?? '')) return;
  g.goalPanel.render(v.rows, v.doneCount, v.complete);
}
