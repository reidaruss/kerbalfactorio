// The Tab panel: the 20-slot pack on the left, the hand recipes on the right.
//
// DW-2 again: plain DOM, zero three.js, plain data in and callbacks out. It
// knows nothing about WASM, inventories or recipes beyond the shape of the rows
// it is handed, which is what lets the same panel serve a furnace later.
//
// POINTER LOCK IS NOT THIS MODULE'S JOB, deliberately. The panel reports open or
// closed and the app decides what that means for the mouse, because "who owns
// the pointer" is a whole-application question and splitting it across the HUD
// and the character controller is how you get a cursor that is visible over a
// camera that is still turning.

import { esc } from './GameHud.js';

export interface SlotRow { name: string; count: number }
export interface IngredientRow { name: string; have: number; need: number }
export interface RecipeRow {
  index: number;
  name: string;
  outputCount: number;
  craftable: boolean;
  inputs: IngredientRow[];
}

export class InventoryPanel {
  private readonly root: HTMLElement;
  private readonly pack: HTMLElement;
  private readonly craft: HTMLElement;
  private open = false;
  private lastPack = '';
  private lastCraft = '';

  constructor(parent: HTMLElement, private readonly onCraft: (index: number) => void) {
    this.root = document.createElement('div');
    this.root.id = 'of-panel';
    this.root.className = 'of-ui';
    this.root.innerHTML =
      '<div class="frame">'
      + '<div class="col pack"><h3>Pack<span></span></h3><div class="of-slots"></div>'
      + '<div class="hint">Tab closes. Harvest with E while aiming at a node.</div></div>'
      + '<div class="col craft"><h3>Hand crafting<span></span></h3><div class="list"></div>'
      + '<div class="hint">Tools are not required to harvest: they multiply the '
      + 'yield, so there is no bootstrap deadlock.</div></div>'
      + '</div>';
    parent.appendChild(this.root);
    this.pack = this.root.querySelector('.of-slots') as HTMLElement;
    this.craft = this.root.querySelector('.list') as HTMLElement;
    // One delegated listener rather than one per button: the rows are rebuilt
    // whenever the pack changes, and per-row listeners would leak with them.
    this.craft.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('button');
      if (b === null) return;
      const i = Number(b.getAttribute('data-i'));
      if (Number.isFinite(i)) this.onCraft(i);
    });
  }

  get isOpen(): boolean { return this.open; }

  setOpen(v: boolean): void {
    if (this.open === v) return;
    this.open = v;
    this.root.classList.toggle('open', v);
  }

  toggle(): boolean { this.setOpen(!this.open); return this.open; }

  /** Rebuild both columns. Diffed, so a closed panel costs one string compare. */
  render(slots: SlotRow[], recipes: RecipeRow[]): void {
    if (!this.open) return;
    const packKey = slots.map((s) => `${s.name}:${s.count}`).join('|');
    if (packKey !== this.lastPack) {
      this.lastPack = packKey;
      const used = slots.filter((s) => s.count > 0).length;
      this.pack.innerHTML = slots.map((s) => (s.count > 0
        ? `<div class="of-slot filled"><span class="ct">${s.count}</span>`
          + `<span class="nm">${esc(s.name)}</span></div>`
        : '<div class="of-slot empty"><span class="nm">.</span></div>')).join('');
      const h = this.root.querySelector('.pack h3 span');
      if (h !== null) h.textContent = `${used} / ${slots.length}`;
    }
    const craftKey = recipes.map((r) => `${r.name}:${r.craftable ? 1 : 0}:`
      + r.inputs.map((i) => `${i.have}/${i.need}`).join(',')).join('|');
    if (craftKey === this.lastCraft) return;
    this.lastCraft = craftKey;
    this.craft.innerHTML = recipes.map((r) => {
      const ing = r.inputs.map((i) => `<i class="${i.have >= i.need ? 'ok' : 'no'}">`
        + `${esc(i.name)} ${i.have}/${i.need}</i>`).join(' &nbsp;+&nbsp; ');
      const n = r.outputCount > 1 ? ` x${r.outputCount}` : '';
      return `<div class="of-recipe${r.craftable ? ' can' : ''}">`
        + `<div class="top"><span class="nm">${esc(r.name)}${n}</span>`
        + `<button data-i="${r.index}"${r.craftable ? '' : ' disabled'}>Craft</button></div>`
        + `<div class="ing">${ing}</div></div>`;
    }).join('');
  }

  /** Force the next render to rebuild, e.g. right after a successful craft. */
  invalidate(): void { this.lastPack = ''; this.lastCraft = ''; }
}
