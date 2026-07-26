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

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.id = 'of-hotbar';
    this.root.className = 'of-ui';
    parent.appendChild(this.root);
    this.root.addEventListener('pointerdown', (e) => {
      this.dragFrom = this.slotUnder(e.target);
    });
    this.root.addEventListener('pointerup', (e) => {
      const to = this.slotUnder(e.target);
      const from = this.dragFrom;
      this.dragFrom = -1;
      if (to < 0) return;
      if (from >= 0 && from !== to) this.onSwap?.(from, to);
      else this.onSelect?.(to);
    });
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
    this.root.innerHTML = rows.map((r) => {
      const cls = `of-hslot${r.selected ? ' on' : ''}${r.empty ? ' empty' : ''}`;
      const art = r.icon !== '' ? iconTag(r.icon, 'ico')
        : `<span class="tx">${esc(r.label)}</span>`;
      return `<div class="${cls}" data-i="${r.index}">`
        + `<span class="n">${r.index + 1}</span>${art}</div>`;
    }).join('');
  }

  /** Force the next render to rebuild, e.g. after the icons finish baking. */
  invalidate(): void { this.last = ''; }
}
