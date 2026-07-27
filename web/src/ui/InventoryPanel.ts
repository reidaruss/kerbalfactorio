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

import { esc, iconTag } from './GameHud.js';
import { Modal, type ModalStack } from './ModalStack.js';
import { SURVIVAL, type GameMode, type ModeRules } from '../game/GameMode.js';

/** `icon` is a baked data URL (ItemIcons) or '' when the item has no mesh. */
export interface SlotRow { name: string; count: number; icon?: string }
export interface IngredientRow {
  name: string; have: number; need: number; icon?: string;
}
export interface RecipeRow {
  index: number;
  name: string;
  outputCount: number;
  craftable: boolean;
  inputs: IngredientRow[];
  icon?: string;
}

export class InventoryPanel extends Modal {
  private readonly root: HTMLElement;
  private readonly pack: HTMLElement;
  private readonly craft: HTMLElement;
  private readonly modeButton: HTMLButtonElement | null;
  private open = false;
  private lastPack = '';
  private lastCraft = '';

  /**
   * DW-31 wants sandbox reachable from a MENU as well as from `?sandbox=1`, and
   * this is that menu. It lives at the foot of the pack column rather than in a
   * settings panel of its own, deliberately: Tab is the menu the player already
   * opens, the row is two lines of DOM, and a whole new modal would be a new
   * binding, a new registration and a new Escape case for one button.
   */
  constructor(parent: HTMLElement, stack: ModalStack,
              private readonly onCraft: (index: number) => void,
              private readonly mode: ModeRules = SURVIVAL,
              private readonly onMode: (m: GameMode) => void = () => {}) {
    super('pack', stack);
    this.root = document.createElement('div');
    this.root.id = 'of-panel';
    this.root.className = 'of-ui';
    this.root.innerHTML =
      '<div class="frame">'
      + '<div class="col pack"><h3>Pack<span></span></h3><div class="of-slots"></div>'
      + '<div class="hint">Tab or Escape closes. Left click swings at whatever you are aiming at.</div>'
      + modeRow(this.mode) + '</div>'
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
    // The mode button. It reloads the page (GameplayActions.switchMode has the
    // argument), so it is the one control in this panel that ends the session.
    this.modeButton = this.root.querySelector('.mode button');
    this.modeButton?.addEventListener('click', () => {
      this.onMode(this.mode.sandbox ? 'survival' : 'sandbox');
    });
  }

  /** The switch, exposed so a probe can press the thing a player presses rather
   *  than a function only it can reach (standing rule 3). */
  get modeSwitch(): HTMLButtonElement | null { return this.modeButton; }

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
        ? `<div class="of-slot filled">${iconTag(s.icon, 'ico')}`
          + `<span class="ct">${s.count}</span>`
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
        + `${iconTag(i.icon, 'ico-sm')}${esc(i.name)} ${i.have}/${i.need}</i>`)
        .join(' &nbsp;+&nbsp; ');
      const n = r.outputCount > 1 ? ` x${r.outputCount}` : '';
      return `<div class="of-recipe${r.craftable ? ' can' : ''}">`
        + `<div class="top"><span class="nm">${iconTag(r.icon, 'ico-sm')}`
        + `${esc(r.name)}${n}</span>`
        + `<button data-i="${r.index}"${r.craftable ? '' : ' disabled'}>Craft</button></div>`
        + `<div class="ing">${ing}</div></div>`;
    }).join('');
  }

  /** Force the next render to rebuild, e.g. right after a successful craft. */
  invalidate(): void { this.lastPack = ''; this.lastCraft = ''; }
}

/**
 * The mode row. Static HTML built once, because a mode cannot change inside a
 * session by construction: switching reloads (DW-31, GameMode.ts).
 */
function modeRow(mode: ModeRules): string {
  const other = mode.sandbox ? 'Leave sandbox' : 'Enter sandbox';
  const note = mode.sandbox
    ? 'everything free, saved to its own slot'
    : 'build anything free, in a separate save';
  return '<div class="mode"><span>Mode &nbsp;<b>' + esc(mode.label) + '</b>'
    + '<br>' + esc(note) + '</span>'
    + `<button type="button">${esc(other)}</button></div>`;
}
