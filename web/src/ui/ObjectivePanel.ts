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

export interface ObjectiveRow {
  text: string; hint: string; done: boolean; current: boolean;
}

export class ObjectivePanel {
  private readonly root: HTMLElement;
  private shown = true;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.id = 'of-goals';
    this.root.className = 'of-ui';
    parent.appendChild(this.root);
  }

  setVisible(v: boolean): void {
    this.shown = v;
    this.root.style.display = v ? '' : 'none';
  }

  get isVisible(): boolean { return this.shown; }

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
      if (r.done) return `<li class="ok">${esc(r.text)}</li>`;
      if (r.current) {
        return `<li class="now">${esc(r.text)}`
          + `<span class="hint">${esc(r.hint)}</span></li>`;
      }
      return `<li class="soon">${esc(r.text)}</li>`;
    }).join('');
    this.root.innerHTML = `<h4>Getting started`
      + `<span>${doneCount} / ${rows.length} &nbsp; H</span></h4><ul>${body}</ul>`;
  }
}
