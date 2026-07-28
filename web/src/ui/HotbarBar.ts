// The bar across the bottom of the screen: nine slots, the selected one lit,
// and while the pack is open you can rearrange it.
//
// WHY IT IS ONLY ARRANGEABLE WITH THE PACK OPEN, which looks like a limitation
// and is not: during play the pointer is LOCKED to the canvas, so there is no
// cursor to click a slot with. The pack is the one moment the player has one.
// So the bar stays on screen behind the panel, takes pointer events only then,
// and a click selects while a drag from one slot to another swaps them.
//
// DW-2: plain DOM, zero three.js, plain rows in and callbacks out. It has no
// opinion about what a slot holds or what the left button will do with it; it
// draws what Hotbar hands it and re-renders only when that string changes,
// which for a hotbar is "when the player turns the wheel" and not every frame.

import './styles/hotbar.css';
import { esc, iconTag } from './GameHud.js';

export interface HotbarRow {
  index: number;
  label: string;
  icon: string;
  selected: boolean;
  empty: boolean;
}

export class HotbarBar {
  private readonly root: HTMLElement;
  private last = '';
  private visible = true;
  private dragFrom = -1;
  /** Set by the app: choose a slot, and swap two of them. */
  onSelect: ((index: number) => void) | null = null;
  onSwap: ((a: number, b: number) => void) | null = null;
  /** GP-108: empty one slot, and put the whole default loadout back. Both are
   *  assigned by the app for the same reason `onSelect` is: this file draws and
   *  reports gestures, and has no opinion about what a slot holds. */
  onClear: ((index: number) => void) | null = null;
  onReset: (() => void) | null = null;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.id = 'of-hotbar';
    this.root.className = 'of-ui';
    parent.appendChild(this.root);
    this.root.addEventListener('pointerdown', (e) => {
      // The remove badge and the reset button are INSIDE the bar, so they have
      // to be taken off the drag before `slotUnder` sees them: a pointerdown on
      // the badge would otherwise arm a drag from the slot it sits on, and the
      // matching pointerup would read as a select.
      if (this.controlUnder(e.target) !== '') { this.dragFrom = -1; return; }
      this.dragFrom = this.slotUnder(e.target);
    });
    this.root.addEventListener('pointerup', (e) => {
      const ctrl = this.controlUnder(e.target);
      if (ctrl === 'reset') { this.dragFrom = -1; this.onReset?.(); return; }
      if (ctrl === 'clear') {
        this.dragFrom = -1;
        const i = this.slotUnder(e.target);
        if (i >= 0) this.onClear?.(i);
        return;
      }
      const to = this.slotUnder(e.target);
      const from = this.dragFrom;
      this.dragFrom = -1;
      if (to < 0) return;
      if (from >= 0 && from !== to) this.onSwap?.(from, to);
      else this.onSelect?.(to);
    });
    // RIGHT CLICK ALSO CLEARS, because `demolish` is already Mouse2 everywhere
    // else in this game and a player who has learned "right click removes it"
    // on a wall will try it on a slot. The badge stays, because a gesture with
    // no affordance is a gesture nobody finds.
    this.root.addEventListener('contextmenu', (e) => {
      const i = this.slotUnder(e.target);
      if (i < 0 || !this.root.classList.contains('live')) return;
      e.preventDefault();
      this.onClear?.(i);
    });
  }

  /** 'clear', 'reset', or '' when the target is not one of the two controls. */
  private controlUnder(t: EventTarget | null): string {
    const el = (t as HTMLElement | null)?.closest?.('.of-hx, .of-hreset');
    if (el === null || el === undefined) return '';
    return el.classList.contains('of-hreset') ? 'reset' : 'clear';
  }

  private slotUnder(t: EventTarget | null): number {
    const el = (t as HTMLElement | null)?.closest?.('.of-hslot');
    const n = el === null || el === undefined ? NaN : Number(el.getAttribute('data-i'));
    return Number.isFinite(n) ? n : -1;
  }

  setVisible(v: boolean): void {
    this.visible = v;
    this.root.style.display = v ? '' : 'none';
  }

  /** Take pointer events, or stop taking them. Only true with the pack open. */
  setInteractive(v: boolean): void {
    this.root.classList.toggle('live', v);
    if (!v) this.dragFrom = -1;
  }

  render(rows: HotbarRow[]): void {
    if (!this.visible) return;
    const key = rows.map((r) => `${r.label}${r.selected ? '*' : ''}`).join('|');
    if (key === this.last) return;
    this.last = key;
    // The two controls are ALWAYS in the DOM and hidden by CSS off `.live`,
    // never conditionally rendered: the render key is the labels and the
    // selection, so a key that did not also carry the interactive state would
    // leave the badges missing until the next time a slot changed.
    this.root.innerHTML = rows.map((r) => {
      const cls = `of-hslot${r.selected ? ' on' : ''}${r.empty ? ' empty' : ''}`;
      const art = r.icon !== '' ? iconTag(r.icon, 'ico')
        : `<span class="tx">${esc(r.label)}</span>`;
      const x = r.empty ? ''
        : `<span class="of-hx" data-clear="${r.index}" title="remove from the bar">&times;</span>`;
      return `<div class="${cls}" data-i="${r.index}">`
        + `<span class="n">${r.index + 1}</span>${art}${x}</div>`;
    }).join('')
      + '<button type="button" class="of-hreset" '
      + 'title="put the default loadout back">reset</button>';
  }

  /** Force the next render to rebuild, e.g. after the icons finish baking. */
  invalidate(): void { this.last = ''; }
}
