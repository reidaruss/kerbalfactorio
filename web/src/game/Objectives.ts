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

import type { Gameplay } from './Gameplay.js';

/** Seconds between checks. Fast enough to feel immediate, slow enough to vanish. */
const CHECK_SECS = 0.25;

export interface Objective {
  id: string;
  /** The imperative, and the key that does it. */
  text: string;
  hint: string;
  done: (g: Gameplay) => boolean;
}

/** How many ingots off an automated line count as "it ran without you". */
const AUTO_TARGET = 1;

export const OBJECTIVES: Objective[] = [
  {
    id: 'wood', text: 'Harvest a tree', hint: 'aim at one and hold E',
    done: (g) => g.game.count(g.game.ids.wood) >= 4,
  },
  {
    id: 'tool', text: 'Craft a pickaxe', hint: 'Tab opens the pack',
    done: (g) => g.game.count(g.game.ids.pickaxe) >= 1,
  },
  {
    id: 'ore', text: 'Mine iron ore', hint: 'the grey-blue patch of ground',
    done: (g) => g.game.count(g.game.ids.rawIron) >= 5,
  },
  {
    id: 'smelt', text: 'Smelt it into iron', hint: 'craft a furnace, G to place, E to load',
    done: (g) => g.game.count(g.game.ids.iron) >= 1,
  },
  {
    id: 'miner', text: 'Put a drill on an ore patch', hint: 'press 1, then G',
    done: (g) => g.factory.placed.some((p) => p.kind === 'miner'),
  },
  {
    id: 'belt', text: 'Run a belt from it to a smelter', hint: 'press 2 for belt, 3 for smelter, R turns',
    done: (g) => g.factory.placed.some((p) => p.kind === 'belt')
      && g.factory.placed.some((p) => p.kind === 'smelter'),
  },
  {
    id: 'auto', text: 'Walk away, then take what it made', hint: 'E on the smelter',
    done: (g) => g.autoCollected >= AUTO_TARGET,
  },
];

export interface ObjectiveView {
  rows: { text: string; hint: string; done: boolean; current: boolean }[];
  doneCount: number;
  total: number;
  complete: boolean;
}

export class Objectives {
  /** How many have been met, in order. The only state, and it is one integer. */
  index = 0;
  visible = true;
  /** Objectives completed this session, for the report. */
  completions = 0;
  private since = 0;
  private lastId = '';

  /** Everything done and the list retired? Then it stops drawing itself. */
  get complete(): boolean { return this.index >= OBJECTIVES.length; }

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
    if (!o.done(g)) return null;
    this.index++;
    this.completions++;
    return o;
  }

  /** The rows a panel draws: what is done, what is next, and what is coming. */
  view(): ObjectiveView {
    return {
      rows: OBJECTIVES.map((o, i) => ({
        text: o.text, hint: o.hint, done: i < this.index, current: i === this.index,
      })),
      doneCount: this.index,
      total: OBJECTIVES.length,
      complete: this.complete,
    };
  }

  /** A cheap key for the panel's diff: the list only changes on a completion. */
  get key(): string {
    return `${this.index}|${this.visible ? 1 : 0}`;
  }

  /** The id of the objective now in front of the player. '' when finished. */
  get currentId(): string { return OBJECTIVES[this.index]?.id ?? ''; }

  /** Force a re-render on the next frame. */
  invalidate(): void { this.lastId = ''; }

  /** True when the panel's content would differ from what it last drew. */
  changed(): boolean {
    if (this.key === this.lastId) return false;
    this.lastId = this.key;
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
 * A completion gets the SAME banner and chime a finished ingot gets, because it
 * is the same kind of event: the world telling the player that something
 * happened and that they caused it. It lives here rather than on Gameplay
 * because Gameplay is a composition at its line cap and this is not a
 * responsibility, it is one predicate and one render.
 */
export function stepGoals(g: Gameplay, dt: number): void {
  const met = g.goals.step(dt, g);
  if (met !== null) {
    g.hud.banner(`${met.text.toUpperCase()}  ✓`, '#f0a04b');
    g.sfx.chime(g.goals.index);
    g.goals.invalidate();
  }
  if (!g.goals.visible || !g.goals.changed()) return;
  const v = g.goals.view();
  g.goalPanel.render(v.rows, v.doneCount, v.complete);
}
