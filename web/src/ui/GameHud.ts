// The always-on game HUD: crosshair, what you are aiming at, what you are
// carrying, and the grant toast.
//
// DW-2: HTML and CSS, not canvas. It imports zero three.js (scripts/check-limits
// enforces that mechanically) and takes only plain data, so it can be rendered
// from a test with no renderer at all. Text also means a screenshot carries its
// own evidence: "+5 Wood" in a PNG is a proof, a particle is an impression.
//
// It re-renders only when its inputs CHANGE. A HUD that rewrites innerHTML every
// frame is a layout pass every frame, and this one sits over a streaming game
// loop, so the diff is the whole point.

import './styles/game.css';

export interface HudTarget {
  name: string;
  /** remaining / initial, for the depletion bar. */
  fraction: number;
  empty: boolean;
  distanceM: number;
}

export interface HudCarry { name: string; count: number }

export class GameHud {
  private readonly cross: HTMLElement;
  private readonly prompt: HTMLElement;
  private readonly carry: HTMLElement;
  private readonly toast: HTMLElement;
  private lastPrompt = '';
  private lastCarry = '';
  private toastLeft = 0;
  private visible = true;

  constructor(parent: HTMLElement) {
    this.cross = this.div(parent, 'of-cross', '');
    this.prompt = this.div(parent, 'of-prompt', 'of-ui');
    this.carry = this.div(parent, 'of-carry', 'of-ui');
    this.toast = this.div(parent, 'of-toast', 'of-ui');
  }

  private div(parent: HTMLElement, id: string, cls: string): HTMLElement {
    const e = document.createElement('div');
    e.id = id;
    if (cls !== '') e.className = cls;
    parent.appendChild(e);
    return e;
  }

  setVisible(v: boolean): void {
    this.visible = v;
    const d = v ? '' : 'none';
    this.cross.style.display = d;
    this.carry.style.display = d;
    if (!v) this.prompt.style.display = 'none';
  }

  /** Show `text` for `secs`. The toast is the "something happened" channel. */
  flash(text: string, secs = 1.4): void {
    this.toast.textContent = text;
    this.toast.classList.add('show');
    this.toastLeft = secs;
  }

  /** Called every frame. `dt` only ages the toast; the rest is diffed. */
  render(dt: number, target: HudTarget | null, carried: HudCarry[]): void {
    if (this.toastLeft > 0) {
      this.toastLeft -= dt;
      if (this.toastLeft <= 0) this.toast.classList.remove('show');
    }
    if (!this.visible) return;
    this.renderPrompt(target);
    this.renderCarry(carried);
  }

  private renderPrompt(t: HudTarget | null): void {
    const on = t !== null && !t.empty;
    this.cross.classList.toggle('on', on);
    if (t === null) {
      if (this.lastPrompt !== '') { this.prompt.style.display = 'none'; this.lastPrompt = ''; }
      return;
    }
    const pct = Math.round(Math.max(0, Math.min(1, t.fraction)) * 100);
    const key = `${t.name}|${pct}|${t.empty ? 1 : 0}`;
    if (key === this.lastPrompt) return;
    this.lastPrompt = key;
    this.prompt.style.display = 'block';
    this.prompt.innerHTML = t.empty
      ? `<span class="sub">${esc(t.name)} node depleted</span>`
      : `<span class="k">E</span>Harvest ${esc(t.name)}`
        + `<div class="sub">${pct}% remaining</div>`
        + `<div id="of-bar"><i style="width:${pct}%"></i></div>`;
  }

  private renderCarry(items: HudCarry[]): void {
    const key = items.map((i) => `${i.name}:${i.count}`).join(',');
    if (key === this.lastCarry) return;
    this.lastCarry = key;
    const rows = items.length === 0
      ? '<div class="none">empty</div>'
      : items.map((i) => `<div class="row"><span>${esc(i.name)}</span><b>${i.count}</b></div>`).join('');
    this.carry.innerHTML = `<h4>Pack &nbsp;<span style="float:right">Tab</span></h4>${rows}`;
  }
}

/** Item names come from /core, but they still reach innerHTML, so escape them. */
export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] ?? c));
}
