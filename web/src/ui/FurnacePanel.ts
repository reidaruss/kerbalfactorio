// The furnace panel: load ore, load fuel, watch it burn, take the ingot.
//
// Same contract as InventoryPanel: plain DOM, zero three.js, plain rows in and
// callbacks out. It renders the numbers gameplay.h owns (fuel ticks, progress
// against ticksPerSmelt) rather than an animation, because "63 seconds of fuel
// left" is information and a flickering fire is decoration.

import { esc } from './GameHud.js';
import { Modal, type ModalStack } from './ModalStack.js';

export interface FurnaceView {
  title: string;
  oreName: string;
  oreCount: number;
  outName: string;
  outCount: number;
  fuelTicks: number;
  progress: number;
  ticksPerSmelt: number;
  smelting: boolean;
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
      if (b.getAttribute('data-take') !== null) this.onTake();
    });
  }

  get isOpen(): boolean { return this.open; }

  setOpen(v: boolean): void {
    if (this.open === v) return;
    this.open = v;
    this.root.classList.toggle('open', v);
    this.last = '';
  }

  render(v: FurnaceView): void {
    if (!this.open) return;
    const key = `${v.oreName}${v.oreCount}|${v.outName}${v.outCount}|${v.fuelTicks}`
      + `|${v.progress}|${v.smelting ? 1 : 0}|`
      + v.loadable.map((l) => `${l.item}:${l.count}`).join(',');
    if (key === this.last) return;
    this.last = key;
    const pct = Math.round((v.progress / Math.max(1, v.ticksPerSmelt)) * 100);
    const fuelSecs = (v.fuelTicks / 60).toFixed(1);
    const load = v.loadable.length === 0
      ? '<div class="hint">Nothing in the pack this furnace will take.</div>'
      : v.loadable.map((l) => `<button data-load="${l.item}">`
        + `${l.fuel ? 'Fuel' : 'Load'} ${esc(l.name)} (${l.count})</button>`).join(' ');
    this.root.innerHTML = '<div class="frame">'
      + `<h3>${esc(v.title)}<span>${v.smelting ? 'SMELTING' : 'IDLE'}</span></h3>`
      + `<div class="grid">`
      + `<div class="cell"><em>Input</em><b>${v.oreCount > 0 ? esc(v.oreName) : '.'}`
      + `</b><i>${v.oreCount}</i></div>`
      + `<div class="cell"><em>Fuel</em><b>${fuelSecs} s</b><i>${v.fuelTicks} t</i></div>`
      + `<div class="cell out"><em>Output</em><b>${v.outCount > 0 ? esc(v.outName) : '.'}`
      + `</b><i>${v.outCount}</i></div>`
      + '</div>'
      + `<div id="of-fbar"><i style="width:${pct}%"></i></div>`
      + `<div class="hint">${v.progress} / ${v.ticksPerSmelt} ticks this smelt</div>`
      + `<div class="acts">${load}`
      + `<button data-take="1"${v.outCount > 0 ? '' : ' disabled'}>Take output</button>`
      + '</div>'
      + '<div class="hint">E or Escape closes. Fuel and ore both come out of the pack.</div>'
      + '</div>';
  }
}
