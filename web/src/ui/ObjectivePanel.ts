// The first-minute checklist, drawn.
//
// DW-2: plain DOM, plain data in, no callbacks and no three.js. It is handed
// rows and draws them; what an objective IS and when it is met is Objectives.ts's
// business and it never appears here.
//
// UNOBTRUSIVE MEANS UNOBTRUSIVE. Top right, under the stats overlay's reach, no
// background panel heavy enough to sit "over" the world, no animation on the
// steps the player is not looking at, and pointer-events off so it can never
// swallow a click meant for the game. Completed lines stay for one beat as a
// struck-through record and then the whole thing shrinks to what is next plus a
// hint, which is the amount of screen a goal is worth once it is understood.
//
// AND IT GOES AWAY. H hides it, the setting survives a reload, and the list
// removes itself for good when the last objective is met, because a checklist
// with nothing left to check is furniture.

import './styles/game.css';
import { esc } from './GameHud.js';
import { labelOf } from '../player/Bindings.js';

export interface ObjectiveRow {
  text: string; hint: string; done: boolean; current: boolean;
  /** GP-286. This world cannot satisfy it; `hint` carries the reason. */
  moot?: boolean;
}

export class ObjectivePanel {
  private readonly root: HTMLElement;
  private shown = true;
  /** What the world HUD last asked for. */
  private wish = true;
  /** GP-350. What the CHECKLIST asks for, which is a different question. */
  private pin = false;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.id = 'of-goals';
    this.root.className = 'of-ui';
    parent.appendChild(this.root);
  }

  /**
   * The WORLD HUD's wish. Three composition roots drive it (flight, the bay,
   * the map), each saying "the walker's HUD is up" or "it is not".
   */
  setVisible(v: boolean): void { this.wish = v; this.apply(); }

  /**
   * GP-350. THE CHECKLIST'S OWN WISH, and it is a second input rather than a
   * second caller of the first one.
   *
   * The list ended at the launch pad, so every row it had was a row the walker
   * could do and hiding it with the walker's HUD was always right. Three flight
   * rows make that false: strapping in is how you reach "fly it to orbit", and
   * the panel went dark on the same frame the row became possible. `stepGoals`
   * decides when; this only has to make the two wishes composable.
   *
   * TWO INPUTS AND ONE DERIVED STATE, not a caller that lies. Each writer still
   * says exactly what it means and neither has to know about the other, which
   * is the shape `Input.setUiCapture`'s per-panel allowance already has here
   * (GP-53): a global answer to a per-panel question is what swallowed the
   * launch key. The player's own H switch is upstream of both, in
   * `Objectives.visible`, so hiding the list still hides it.
   */
  setPinned(p: boolean): void { this.pin = p; this.apply(); }

  private apply(): void {
    this.shown = this.wish || this.pin;
    this.root.style.display = this.shown ? '' : 'none';
    // MOVED, NOT JUST KEPT. Pinned means the walker's HUD is down and something
    // else owns the screen; on the right the list sits where the flight chips
    // and the map's own rail go. Left is empty in exactly the states that pin.
    this.root.classList.toggle('pinned', this.pin && !this.wish);
  }

  get isVisible(): boolean { return this.shown; }

  /** Published for the acceptance: "the world HUD hid it" and "the checklist
   *  held it up" are different facts and a probe must be able to tell them
   *  apart, since both can be true while `isVisible` reads the same. */
  get isPinned(): boolean { return this.pin; }

  /**
   * Draw the list. `complete` retires it: the caller decides when that is, and
   * a retired list is removed rather than left as an empty box.
   */
  render(rows: ObjectiveRow[], doneCount: number, complete: boolean): void {
    if (complete) { this.root.innerHTML = ''; return; }
    // Everything already done, the one in front, and the next two. A player who
    // can see all seven steps at once is reading a manual.
    const upto = Math.min(rows.length, doneCount + 3);
    const body = rows.slice(0, upto).map((r) => {
      // GP-286. A CARD THIS WORLD CANNOT SATISFY IS DRAWN AND EXPLAINED, never
      // silently dropped: a list that quietly got shorter looks like a bug and
      // teaches nothing, while "nothing grows here" teaches a player where they
      // are. Checked BEFORE `done`, because the list steps past a moot card and
      // it would otherwise draw as an achievement nobody earned.
      if (r.moot === true) {
        return `<li class="moot">${esc(r.text)}`
          + `<span class="hint">${esc(r.hint)}</span></li>`;
      }
      if (r.done) return `<li class="ok">${esc(r.text)}</li>`;
      if (r.current) {
        return `<li class="now">${esc(r.text)}`
          + `<span class="hint">${esc(r.hint)}</span></li>`;
      }
      return `<li class="soon">${esc(r.text)}</li>`;
    }).join('');
    // GP-165: the hide key is spelled by the binding table, like every other
    // control this panel names. It said a literal H, which was only ever right
    // by coincidence with BINDINGS.goals.
    this.root.innerHTML = `<h4>Getting started`
      + `<span>${doneCount} / ${rows.length} &nbsp; ${esc(labelOf('goals'))}`
      + `</span></h4><ul>${body}</ul>`;
  }
}
