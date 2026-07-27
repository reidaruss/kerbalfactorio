// THE MACHINE SCREEN: left-clicking any machine with a bare hand opens this
// (GP-57), for the hand furnace and for the factory's own machines alike.
//
// Same contract as InventoryPanel: plain DOM, zero three.js, plain rows in and
// callbacks out. It renders the numbers the SIM owns and nothing it made up:
// the progress bar is /core's own per-unit counter carried across the bridge
// (GP-59), never a client-side interpolation, because a bar that guesses drifts
// from the machine it claims to describe.
//
// THE SLOTS ARE BUTTONS, which is the Factorio grammar Reid asked for verbatim:
// click the output cell and the whole stack is yours, click the input cell and
// the ore comes back (published against the take-ore seam, GP-58, disabled and
// SAYING SO until the bridge exports it), click a pack row to put ore or fuel
// in. A disabled control that names its reason is a promise; a missing one is a
// feature nobody can find (GP-56).

import { esc } from './GameHud.js';
import { Modal, type ModalStack } from './ModalStack.js';

export interface MachineSlot { name: string; count: number }

export interface MachineView {
  title: string;
  /** SMELTING / IDLE / MINING, whatever the sim says it is doing. */
  status: string;
  input: MachineSlot | null;
  /** The fuel POOL (burn ticks or units): a pool, not a stack, so no take. */
  fuel: { main: string; sub: string } | null;
  output: MachineSlot | null;
  /** 0..1 of the CURRENT unit, straight off the sim's own counter (GP-59).
   *  Null for a machine with no crafting stage (a drill, a generator). */
  progress01: number | null;
  progressText: string;
  /** GP-58: false until the take-ore bridge export exists. */
  canTakeInput: boolean;
  /** Why the input cell is disabled, shown as its tooltip. */
  takeInputHint: string;
  /** What the pack can feed it right now: [item, name, count, isFuel]. */
  loadable: { item: number; name: string; count: number; fuel: boolean }[];
}

export class FurnacePanel extends Modal {
  private readonly root: HTMLElement;
  private open = false;
  private last = '';

  constructor(
    parent: HTMLElement,
    stack: ModalStack,
    private readonly onLoad: (item: number) => void,
    private readonly onTake: () => void,
    private readonly onTakeInput: () => void,
  ) {
    super('furnace', stack);
    this.root = document.createElement('div');
    this.root.id = 'of-furnace';
    this.root.className = 'of-ui';
    parent.appendChild(this.root);
    this.root.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('button');
      if (b === null) return;
      const item = b.getAttribute('data-load');
      if (item !== null) { this.onLoad(Number(item)); return; }
      if (b.getAttribute('data-take-in') !== null) { this.onTakeInput(); return; }
      if (b.getAttribute('data-take') !== null) this.onTake();
    });
  }

  get isOpen(): boolean { return this.open; }

  /**
   * The DRAWN bar, as a percentage read back off the element's own width.
   *
   * Reported rather than recomputed, because the claim GP-59 makes is about
   * what the player SEES: a probe that compared the sim's counter with a number
   * this file computed a second time would agree with itself while the bar on
   * screen stayed at zero. This is the pixel, asked for its value.
   */
  get barPct(): number {
    const i = this.root.querySelector('#of-fbar > i') as HTMLElement | null;
    return i === null ? -1 : Number.parseFloat(i.style.width) || 0;
  }

  setOpen(v: boolean): void {
    if (this.open === v) return;
    this.open = v;
    this.root.classList.toggle('open', v);
    this.last = '';
  }

  render(v: MachineView): void {
    if (!this.open) return;
    const key = `${v.title}|${v.status}|${cellKey(v.input)}|${cellKey(v.output)}`
      + `|${v.fuel?.main ?? ''}${v.fuel?.sub ?? ''}|${pct(v)}|${v.progressText}`
      + `|${v.canTakeInput ? 1 : 0}|`
      + v.loadable.map((l) => `${l.item}:${l.count}`).join(',');
    if (key === this.last) return;
    this.last = key;
    const load = v.loadable.length === 0
      ? '<div class="hint">Nothing in the pack this machine will take.</div>'
      : v.loadable.map((l) => `<button data-load="${l.item}">`
        + `${l.fuel ? 'Fuel' : 'Load'} ${esc(l.name)} (${l.count})</button>`).join(' ');
    this.root.innerHTML = '<div class="frame">'
      + `<h3>${esc(v.title)}<span>${esc(v.status)}</span></h3>`
      + `<div class="grid">`
      + this.slotCell('Input', v.input, 'data-take-in',
        v.canTakeInput && (v.input?.count ?? 0) > 0, v.takeInputHint)
      + `<div class="cell"><em>Fuel</em><b>${esc(v.fuel?.main ?? '-')}`
      + `</b><i>${esc(v.fuel?.sub ?? '')}</i></div>`
      + this.slotCell('Output', v.output, 'data-take',
        (v.output?.count ?? 0) > 0, 'click to take the stack')
      + '</div>'
      + `<div id="of-fbar"><i style="width:${pct(v)}%"></i></div>`
      + `<div class="hint">${esc(v.progressText)}</div>`
      + `<div class="acts">${load}</div>`
      + '<div class="hint">E or Escape closes. Click a slot to take its whole '
      + 'stack; loading comes out of the pack.</div>'
      + '</div>';
  }

  /** An input/output SLOT: a button, so a click takes the stack (GP-57). */
  private slotCell(label: string, s: MachineSlot | null, attr: string,
                   enabled: boolean, hint: string): string {
    const out = attr === 'data-take' ? ' out' : '';
    if (s === null) {
      return `<div class="cell${out}"><em>${label}</em><b>-</b><i></i></div>`;
    }
    return `<button class="cell${out}" ${attr}="1"${enabled ? '' : ' disabled'}`
      + ` title="${esc(hint)}"><em>${label}</em>`
      + `<b>${s.count > 0 ? esc(s.name) : '.'}</b><i>${s.count}</i></button>`;
  }
}

function cellKey(s: MachineSlot | null): string {
  return s === null ? '-' : `${s.name}${s.count}`;
}

function pct(v: MachineView): number {
  return v.progress01 === null ? 0
    : Math.round(Math.max(0, Math.min(1, v.progress01)) * 100);
}
