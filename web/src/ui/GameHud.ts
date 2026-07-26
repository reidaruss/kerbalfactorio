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
  /** A second line of available verbs, e.g. "X remove". Optional. */
  action?: string;
}

export interface HudCarry { name: string; count: number; icon?: string }

export class GameHud {
  private readonly cross: HTMLElement;
  private readonly prompt: HTMLElement;
  private readonly carry: HTMLElement;
  private readonly toast: HTMLElement;
  private readonly gainEl: HTMLElement;
  private readonly bannerEl: HTMLElement;
  private lastPrompt = '';
  private lastCarry = '';
  private toastLeft = 0;
  private visible = true;
  gains = 0;
  banners = 0;

  constructor(parent: HTMLElement) {
    this.cross = this.div(parent, 'of-cross', '');
    this.prompt = this.div(parent, 'of-prompt', 'of-ui');
    this.carry = this.div(parent, 'of-carry', 'of-ui');
    this.toast = this.div(parent, 'of-toast', 'of-ui');
    this.gainEl = this.div(parent, 'of-gain', 'of-ui');
    this.bannerEl = this.div(parent, 'of-banner', 'of-ui');
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
    this.gainEl.style.display = d;
    this.bannerEl.style.display = d;
    if (!v) this.prompt.style.display = 'none';
  }

  /**
   * The item-gain readout: a big "+7 Wood" that pops beside the crosshair on the
   * impact frame, plus a pulse on the crosshair itself.
   *
   * Separate from `flash` on purpose. The toast is a message channel ("cannot
   * place there"); this is the CONFIRMATION that the swing landed and it has to
   * arrive at the same instant as the debris, in the resource's own colour, and
   * be gone before the next swing. A grant that shares a widget with an error
   * message reads as an error message.
   */
  gain(text: string, colour: string): void {
    this.gains++;
    this.gainEl.textContent = text;
    this.gainEl.style.color = colour;
    // Removing the class, forcing layout, then re-adding is what restarts a CSS
    // animation; without the reflow the browser coalesces both writes and a
    // second swing inside the animation window shows nothing at all.
    this.gainEl.classList.remove('pop');
    this.cross.classList.remove('hit');
    void this.gainEl.offsetWidth;
    this.gainEl.classList.add('pop');
    this.cross.classList.add('hit');
  }

  /**
   * THE BANNER: a moment, not a message. Clearing a node and finishing an ingot
   * are the two events a player should notice from across the clearing, and
   * neither of them fits the gain readout (which is a per-swing tally that has
   * to be gone before the next swing) or the toast (which is where errors live).
   * It sits above the crosshair, holds for a beat, and drifts up as it fades.
   */
  banner(text: string, colour: string): void {
    this.banners++;
    this.bannerEl.textContent = text;
    this.bannerEl.style.color = colour;
    // Same reflow trick as gain(): without it two banners inside the animation
    // window coalesce into one write and the second is never seen.
    this.bannerEl.classList.remove('rise');
    void this.bannerEl.offsetWidth;
    this.bannerEl.classList.add('rise');
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
    const act = t.action ?? '';
    const key = `${t.name}|${pct}|${t.empty ? 1 : 0}|${act}`;
    if (key === this.lastPrompt) return;
    this.lastPrompt = key;
    this.prompt.style.display = 'block';
    // A BUILDING IS NOT HARVESTED. It carries its own verbs in `action`, so the
    // "E Harvest" chip is a node-only prefix; without this split a belt read
    // "E Harvest belt", which is a sentence about nothing.
    if (act !== '') {
      this.prompt.innerHTML = `${esc(t.name)}<div class="sub">${esc(act)}</div>`
        + `<div id="of-bar"><i style="width:${pct}%"></i></div>`;
      return;
    }
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
      : items.map((i) => `<div class="row"><span>${iconTag(i.icon, 'ico-sm')}`
        + `${esc(i.name)}</span><b>${i.count}</b></div>`).join('');
    this.carry.innerHTML = `<h4>Pack &nbsp;<span style="float:right">Tab</span></h4>${rows}`;
  }
}

/**
 * An `<img>` for a baked item icon (ItemIcons), or nothing.
 *
 * The `data:image/` guard is the whole security story: a slot's picture is a
 * string this module put in a src attribute, so it is checked to be a data URL
 * and never a name, a path or anything a /core string could reach.
 */
export function iconTag(url: string | undefined, cls: string): string {
  return url !== undefined && url.startsWith('data:image/')
    ? `<img class="${cls}" src="${url}" alt="">` : '';
}

/** Item names come from /core, but they still reach innerHTML, so escape them. */
export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] ?? c));
}
