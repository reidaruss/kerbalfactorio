// The bar across the bottom of the screen: nine slots, the selected one lit.
//
// DW-2: plain DOM, zero three.js, plain rows in. It has no opinion about what a
// slot holds or what the left button will do with it; it draws what Hotbar hands
// it and it re-renders only when that string changes, which for a hotbar is
// "when the player turns the wheel" and not "every frame".

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

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.id = 'of-hotbar';
    this.root.className = 'of-ui';
    parent.appendChild(this.root);
  }

  setVisible(v: boolean): void {
    this.visible = v;
    this.root.style.display = v ? '' : 'none';
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
      return `<div class="${cls}"><span class="n">${r.index + 1}</span>${art}</div>`;
    }).join('');
  }

  /** Force the next render to rebuild, e.g. after the icons finish baking. */
  invalidate(): void { this.last = ''; }
}
