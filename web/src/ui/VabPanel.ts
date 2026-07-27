// The VAB: the assembly screen, where the numbers are the point.
//
// DW-2 holds here as everywhere under src/ui: plain DOM, zero three.js, plain
// data in and callbacks out. The rocket itself is drawn on the canvas UNDERNEATH
// this panel, which is why the root spans the viewport but takes NO pointer
// events: only the two rails and the bottom bar do, and the middle of the screen
// stays a clear gap the player can grab to orbit the camera. A panel that ate
// that drag would make the 3D half unusable, so the gap is a layout requirement
// and not a style preference (vab.css caps the rail widths to hold it).
//
// DW-30 item 4: per-stage delta-v is always visible. So the readouts are the
// loudest thing on the screen and every stage row carries its own delta-v, TWR,
// burn time, thrust and engine count. A stage with no delta-v reads as a FAULT
// in the warning colour rather than as an empty cell, because "0 m/s" is the
// most useful thing this screen can tell somebody whose rocket will not fly.
//
// render() is called on every frame the design changes, and possibly on every
// frame full stop, so it diffs four cheap string keys (catalogue, readouts plus
// stages, bottom bar, message) and rebuilds only the regions that actually
// moved. invalidate() drops all four.

import './styles/vab.css';
import { esc } from './GameHud.js';
import { Modal, type ModalStack } from './ModalStack.js';

/** One row of the part catalogue. `index` is the catalogue index and the only
 *  identity this panel knows; every callback hands it straight back. */
export interface VabPartRow {
  index: number;
  name: string;
  /** 'Command' | 'Fuel' | 'Engines' | 'Coupling' | 'Aero' | 'Control' |
   *  'Power' | 'Utility'. Unknown groups sort to the end rather than vanish. */
  group: string;
  /** 'S' (1.25 m) | 'L' (2.50 m) | 'radial'. */
  cls: string;
  /** Preformatted, e.g. '8 Iron + 2 Copper', or 'free' in sandbox. */
  cost: string;
  /** False renders greyed and marks the cost as a problem, but the row STAYS
   *  clickable: the caller owns the refusal and reports it through `message`. */
  affordable: boolean;
  selected: boolean;
  /** Preformatted, e.g. '1.25 x 2.50 m, 800 kg' or '200 kN vac, Isp 264/330 s'. */
  detail: string;
}

export interface VabStageRow {
  index: number; deltaV: number; twr: number; burnS: number;
  thrustKN: number; engines: number; partCount: number;
}

export interface VabStats {
  totalDeltaV: number; massKg: number; dryKg: number; propellantKg: number;
  parts: number; lengthM: number; padTwr: number; staticMarginM: number;
  stable: boolean; crew: number;
}

export interface VabPanelHooks {
  pick(index: number): void;
  stageUp(index: number): void;
  stageDown(index: number): void;
  autostage(): void;
  clear(): void;
  save(name: string): void;
  load(name: string): void;
  remove(name: string): void;
  symmetry(n: number): void;
  /** GP-54. Leave the bay and put the rocket on the ground in front of you.
   *  The same thing the launch key does, because a key nobody can see is not a
   *  way in: Reid built a rocket and had to ask how to fly it. */
  rollOut(): void;
  exit(): void;
}

/** Catalogue order. Anything not listed sorts after, in first-seen order. */
const GROUPS = ['Command', 'Fuel', 'Engines', 'Coupling', 'Aero', 'Control',
  'Power', 'Utility'];

export class VabPanel extends Modal {
  private readonly el: HTMLElement;
  private readonly partsEl: HTMLElement;
  private readonly readEl: HTMLElement;
  private readonly stagesEl: HTMLElement;
  private readonly symEl: HTMLElement;
  private readonly designsEl: HTMLElement;
  private readonly msgEl: HTMLElement;
  private readonly input: HTMLInputElement;
  private opened = false;
  /** [catalogue, readouts + stages, bottom bar, message]. */
  private last = ['', '', '', ''];

  constructor(parent: HTMLElement, stack: ModalStack,
              private readonly hooks: VabPanelHooks) {
    super('vab', stack);
    this.el = document.createElement('div');
    this.el.id = 'of-vab';
    this.el.className = 'of-ui';
    this.el.innerHTML = SKELETON;
    parent.appendChild(this.el);
    this.partsEl = this.pick('.of-vparts');
    this.readEl = this.pick('.of-vread');
    this.stagesEl = this.pick('.of-vstages');
    this.symEl = this.pick('.sym');
    this.designsEl = this.pick('.designs');
    this.msgEl = this.pick('.of-vmsg');
    this.input = this.pick('#of-vab-name') as HTMLInputElement;
    // ONE delegated listener, never one per row: the catalogue and the stage
    // list are rebuilt whenever the design moves, and per-row listeners would
    // be rebuilt (and leaked) with them.
    this.el.addEventListener('click', (e) => { this.onClick(e); });
    // The name field types letters, and the game binds letters. Keep the keys
    // that land in this input out of the world's key handler.
    for (const t of ['keydown', 'keyup', 'keypress']) {
      this.input.addEventListener(t, (e) => { e.stopPropagation(); });
    }
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.hooks.save(this.input.value.trim());
    });
  }

  private pick(sel: string): HTMLElement {
    return this.el.querySelector<HTMLElement>(sel) as HTMLElement;
  }

  private onClick(e: Event): void {
    const t = (e.target as HTMLElement | null)?.closest<HTMLElement>('[data-vab]');
    if (t === null || t === undefined) return;
    if (t instanceof HTMLButtonElement && t.disabled) return;
    const i = Number(t.getAttribute('data-index'));
    const name = t.getAttribute('data-name') ?? '';
    switch (t.getAttribute('data-vab')) {
      case 'part': if (Number.isFinite(i)) this.hooks.pick(i); break;
      case 'stage-up': if (Number.isFinite(i)) this.hooks.stageUp(i); break;
      case 'stage-down': if (Number.isFinite(i)) this.hooks.stageDown(i); break;
      case 'autostage': this.hooks.autostage(); break;
      case 'clear': this.hooks.clear(); break;
      case 'save': this.hooks.save(this.input.value.trim()); break;
      case 'design': this.hooks.load(name); break;
      case 'design-del': this.hooks.remove(name); break;
      case 'rollout': this.hooks.rollOut(); break;
      case 'exit': this.hooks.exit(); break;
      case 'sym': {
        const n = Number(t.getAttribute('data-n'));
        if (Number.isFinite(n)) this.hooks.symmetry(n);
        break;
      }
      default: break;
    }
  }

  get isOpen(): boolean { return this.opened; }

  setOpen(v: boolean): void {
    if (this.opened === v) return;
    this.opened = v;
    this.el.classList.toggle('open', v);
    this.invalidate();
  }

  /** Force the next render to rebuild, ignoring the diff keys. */
  invalidate(): void { this.last = ['', '', '', '']; }

  // --- the driven surface -------------------------------------------------
  // Every accessor is a querySelector over a stable data- attribute, so a probe
  // can dispatch a real PointerEvent at the element a player actually presses
  // rather than at a function only the probe can reach.

  get root(): HTMLElement { return this.el; }

  partButton(index: number): HTMLElement | null {
    return this.el.querySelector<HTMLElement>(`[data-vab="part"][data-index="${index}"]`);
  }

  stageUpButton(index: number): HTMLElement | null {
    return this.el.querySelector<HTMLElement>(`[data-vab="stage-up"][data-index="${index}"]`);
  }

  stageDownButton(index: number): HTMLElement | null {
    return this.el.querySelector<HTMLElement>(`[data-vab="stage-down"][data-index="${index}"]`);
  }

  get exitButton(): HTMLElement | null {
    return this.el.querySelector<HTMLElement>('[data-vab="exit"]');
  }

  get autostageButton(): HTMLElement | null {
    return this.el.querySelector<HTMLElement>('[data-vab="autostage"]');
  }

  get saveButton(): HTMLElement | null {
    return this.el.querySelector<HTMLElement>('[data-vab="save"]');
  }

  get nameInput(): HTMLInputElement | null {
    return this.el.querySelector<HTMLInputElement>('#of-vab-name');
  }

  /**
   * Redraw. Four keys, four regions, and a closed panel costs four compares.
   *
   * The catalogue key carries index, selection and affordability only: the rows
   * themselves are a static catalogue and what moves frame to frame is which
   * one is in hand and which ones the pack can pay for. A caller that swaps the
   * catalogue out from under the panel calls invalidate().
   */
  render(parts: readonly VabPartRow[], stages: readonly VabStageRow[],
         stats: VabStats, designs: readonly string[], symmetry: number,
         message: string): void {
    if (!this.opened) return;
    const kParts = parts.map((p) => `${p.index}${p.selected ? '*' : ''}`
      + `${p.affordable ? '' : '!'}`).join(',');
    const kRead = `${fix(stats.totalDeltaV, 0)}/${fix(stats.massKg, 0)}/`
      + `${fix(stats.dryKg, 0)}/${fix(stats.propellantKg, 0)}/${stats.parts}/`
      + `${fix(stats.lengthM, 2)}/${fix(stats.padTwr, 2)}/`
      + `${fix(stats.staticMarginM, 2)}/${stats.stable ? 1 : 0}/${stats.crew}|`
      + stages.map((s) => `${s.index}:${fix(s.deltaV, 0)}:${fix(s.twr, 2)}:`
        + `${fix(s.burnS, 1)}:${fix(s.thrustKN, 1)}:${s.engines}:${s.partCount}`)
        .join(',');
    const kBar = `${symmetry}|${designs.join(',')}`;
    if (kParts === this.last[0] && kRead === this.last[1]
      && kBar === this.last[2] && message === this.last[3]) return;
    if (kParts !== this.last[0]) {
      this.last[0] = kParts;
      this.partsEl.innerHTML = catalogue(parts);
    }
    if (kRead !== this.last[1]) {
      this.last[1] = kRead;
      this.readEl.innerHTML = readouts(stats);
      this.stagesEl.innerHTML = stages.length === 0
        ? '<div class="none">No stages yet. Place a part to start a design.</div>'
        : stages.map((s, i) => stageRow(s, i === 0, i === stages.length - 1)).join('');
    }
    if (kBar !== this.last[2]) {
      this.last[2] = kBar;
      this.symEl.innerHTML = '<em>Symmetry</em>' + [1, 2, 3, 4].map((n) =>
        `<button type="button" class="sq${n === symmetry ? ' on' : ''}" `
        + `data-vab="sym" data-n="${n}">${n}</button>`).join('');
      this.designsEl.innerHTML = '<em>Saved</em>' + (designs.length === 0
        ? '<span class="none">none yet</span>'
        : designs.map(chip).join(''));
    }
    if (message !== this.last[3]) {
      this.last[3] = message;
      // textContent, not innerHTML: the message is somebody else's string and
      // it is the one field on this screen that carries arbitrary text.
      this.msgEl.textContent = message;
      this.msgEl.classList.toggle('on', message !== '');
    }
  }
}

/** The static frame. Built once; render() only fills the marked regions. */
const SKELETON =
  '<div class="rail left"><h3>Parts</h3><div class="of-vparts"></div></div>'
  + '<div class="rail right"><h3>Vehicle</h3><div class="of-vread"></div>'
  + '<h3 class="mid">Stages</h3><div class="of-vstages"></div></div>'
  + '<div class="foot"><div class="of-vmsg"></div><div class="of-vbar">'
  + '<span class="grp sym"></span>'
  + '<span class="grp"><input id="of-vab-name" data-vab="name" type="text" '
  + 'maxlength="40" placeholder="design name" autocomplete="off" '
  + 'spellcheck="false"><button type="button" class="go" data-vab="save">'
  + 'Save</button></span>'
  + '<span class="grp designs"></span>'
  + '<span class="grp acts"><button type="button" data-vab="autostage">'
  + 'Autostage</button><button type="button" data-vab="clear">Clear</button>'
  + '<button type="button" class="go" data-vab="exit">Exit VAB</button>'
  // GP-54. The way OUT of the bay and into the sky, named on screen. The key
  // works too and the label says which one, because a player who learns the key
  // here never needs the button again, and a player who never finds the key has
  // to ask, which is exactly what happened.
  + '<button type="button" class="go launch" data-vab="rollout" '
  + 'title="Leave the bay and set the rocket down in front of you">'
  + 'Roll out &nbsp;<kbd>G</kbd></button></span>'
  + '</div></div>';

/** Group the catalogue, in GROUPS order, each group under a sticky heading. */
function catalogue(parts: readonly VabPartRow[]): string {
  if (parts.length === 0) return '<div class="none">No parts available.</div>';
  const order: string[] = [];
  const by = new Map<string, VabPartRow[]>();
  for (const p of parts) {
    let rows = by.get(p.group);
    if (rows === undefined) { rows = []; by.set(p.group, rows); order.push(p.group); }
    rows.push(p);
  }
  // Stable sort, so unknown groups keep the order the caller handed them in.
  order.sort((a, b) => rank(a) - rank(b));
  return order.map((g) => {
    const rows = by.get(g) ?? [];
    return `<div class="grp"><h4>${esc(g)}<span>${rows.length}</span></h4>`
      + rows.map(partRow).join('') + '</div>';
  }).join('');
}

function rank(g: string): number {
  const i = GROUPS.indexOf(g);
  return i < 0 ? GROUPS.length : i;
}

function partRow(p: VabPartRow): string {
  // No `disabled` on an unaffordable row, deliberately: the player still gets
  // to press it, and the caller answers with a message that names what is
  // missing. A dead button teaches nothing.
  return `<button type="button" class="of-vpart${p.selected ? ' on' : ''}`
    + `${p.affordable ? '' : ' poor'}" data-vab="part" data-index="${p.index}" `
    + `aria-pressed="${p.selected ? 'true' : 'false'}">`
    + `<span class="top"><span class="nm">${esc(p.name)}</span>`
    + `<span class="cls">${esc(p.cls)}</span></span>`
    + `<span class="det">${esc(p.detail)}</span>`
    + `<span class="cost">${esc(p.cost)}</span></button>`;
}

function readouts(s: VabStats): string {
  const twrLow = num(s.padTwr) < 1 && s.parts > 0;
  return '<div class="big"><em>Total &#916;v</em>'
    + `<b>${fix(s.totalDeltaV, 0)}</b><i>m/s</i></div>`
    + '<div class="cells">'
    + cell('Launch mass', grp(s.massKg), 'kg', '')
    + cell('Pad TWR', fix(s.padTwr, 2), '', twrLow ? 'warn' : '')
    + cell('Parts', `${Math.max(0, Math.round(num(s.parts)))}`, '', '')
    + cell('Length', fix(s.lengthM, 2), 'm', '')
    + cell('Dry', grp(s.dryKg), 'kg', '')
    + cell('Propellant', grp(s.propellantKg), 'kg', '')
    + cell('Crew', `${Math.max(0, Math.round(num(s.crew)))}`, '', '')
    + cell('Static margin', fix(s.staticMarginM, 2), 'm', s.stable ? '' : 'warn')
    + '</div>'
    + `<div class="stab ${s.stable ? 'ok' : 'bad'}">Stability `
    + `<b>${s.stable ? 'stable' : 'UNSTABLE'}</b></div>`;
}

function cell(label: string, value: string, unit: string, cls: string): string {
  return `<div class="cell"><em>${label}</em>`
    + `<b${cls === '' ? '' : ` class="${cls}"`}>${value}</b>`
    + (unit === '' ? '' : `<i>${unit}</i>`) + '</div>';
}

function stageRow(s: VabStageRow, first: boolean, last: boolean): string {
  // The stage NUMBER shown is the same integer the callbacks take, so what a
  // probe reads on screen is what it passes back. No off-by-one to translate.
  return '<div class="of-vstage"><div class="hd">'
    + `<b>Stage ${Math.round(num(s.index))}</b>`
    + `<span>${Math.max(0, Math.round(num(s.partCount)))} parts</span>`
    + mv('stage-up', s.index, first, '&#9650;', 'Move this stage earlier')
    + mv('stage-down', s.index, last, '&#9660;', 'Move this stage later')
    + '</div><div class="figs">'
    // A dead stage is a fault, not a blank: 0 m/s in the warning colour.
    + fig('&#916;v', `${fix(s.deltaV, 0)} m/s`, num(s.deltaV) > 0 ? '' : 'warn')
    + fig('TWR', fix(s.twr, 2), '')
    + fig('burn', `${fix(s.burnS, 1)} s`, '')
    + fig('thrust', `${fix(s.thrustKN, 1)} kN`, '')
    + fig('engines', `${Math.max(0, Math.round(num(s.engines)))}`,
      num(s.engines) > 0 ? '' : 'warn')
    + '</div></div>';
}

function fig(label: string, value: string, cls: string): string {
  return `<div class="f"><em>${label}</em>`
    + `<b${cls === '' ? '' : ` class="${cls}"`}>${value}</b></div>`;
}

function mv(kind: string, index: number, off: boolean, glyph: string,
            title: string): string {
  return `<button type="button" class="mv" data-vab="${kind}" `
    + `data-index="${Math.round(num(index))}"${off ? ' disabled' : ''} `
    + `title="${title}">${glyph}</button>`;
}

function chip(name: string): string {
  const n = esc(name);
  return `<span class="of-vchip"><button type="button" data-vab="design" `
    + `data-name="${n}" title="Load this design">${n}</button>`
    + `<button type="button" class="del" data-vab="design-del" data-name="${n}" `
    + 'title="Delete this design">&#215;</button></span>';
}

/** An empty design reads as zeros, never as NaN and never as a blank cell. */
function num(v: number): number { return Number.isFinite(v) ? v : 0; }

function fix(v: number, d: number): string { return num(v).toFixed(d); }

/** Thousands separators, because a launch mass is a five-digit number and
 *  "12500" and "125000" are the same shape at a glance. */
function grp(v: number): string {
  const n = Math.round(num(v));
  const s = Math.abs(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return (n < 0 ? '-' : '') + s;
}
