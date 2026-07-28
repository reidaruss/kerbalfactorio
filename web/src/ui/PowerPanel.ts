// The supply and demand screen: the one sentence that turns "my smelter got
// slower" into "place another generator".
//
// DW-2 holds here as everywhere under src/ui: plain DOM, zero three.js, plain
// numbers in. There are no buttons on this panel and so no hooks argument, and
// nothing on it is a string that came from outside, so nothing here reaches for
// esc(): every field this panel renders is a number it formats itself.
//
// WHY CAPACITY IS PUBLISHED NEXT TO PRODUCTION. Production alone cannot tell the
// player whether the fix is a generator or a bucket of coal: a network making
// 90 kW against 120 kW of demand is starving either because it has no headroom
// or because half its generators are dry, and those are opposite actions. So
// capacity (what the fuelled generators COULD make) sits beside production (what
// they did make), and the verdict line says which of the two situations this is.
//
// EVERY NUMBER CARRIES ITS RAW SELF. The text says `120.0 kW` because that is
// what a person reads; the same element carries data-w="120000" because a probe
// that has to parse `120.0 kW` back into watts is a probe that will disagree
// with /core by a rounding error. Same reason satisfactionQ16 is on screen: the
// Q16.16 integer can be compared exactly against the headless number.

import './styles/power.css';
import { Modal, type ModalStack } from './ModalStack.js';

export interface PowerSample {
  productionW: number; demandW: number; satisfaction: number;
}

export interface NetworkRow {
  id: number;
  /** What the fuelled generators COULD make. */
  capacityW: number;
  /** What they actually made this tick. */
  productionW: number;
  demandW: number;
  consumptionW: number;
  /** 0..1. */
  satisfaction: number;
  /** /core's own Q16.16 integer, shown verbatim so the panel can be checked
   *  against the headless number rather than against a rounded percentage. */
  satisfactionQ16: number;
  poles: number;
  generators: number;
  fuelledGenerators: number;
  consumers: number;
  /** Oldest first. May be empty. */
  history: PowerSample[];
}

export interface PowerView {
  /** False before the player has built anything electrical. */
  enabled: boolean;
  networks: NetworkRow[];
  /** Machines that no pole reaches. They run at zero, which is the honest
   *  answer. */
  offGrid: number;
  /** FS-53: generators that joined no network. Burning fuel that reaches
   *  nobody is a different fault from a machine running at zero. */
  offGridGenerators: number;
}

export class PowerPanel extends Modal {
  private readonly root: HTMLElement;
  private readonly body: HTMLElement;
  private readonly netCount: HTMLElement;
  private open = false;
  private lastKey = '';

  constructor(parent: HTMLElement, stack: ModalStack) {
    super('power', stack);
    this.root = document.createElement('div');
    this.root.id = 'of-power';
    this.root.className = 'of-ui';
    this.root.innerHTML =
      '<div class="frame">'
      + '<h3>Power <span class="nets" data-power="networks">0</span></h3>'
      + '<div class="of-pbody"></div>'
      + '<div class="hint">Escape closes. A readout only: nothing on this '
      + 'screen can be pressed.</div>'
      + '</div>';
    parent.appendChild(this.root);
    this.body = this.root.querySelector('.of-pbody') as HTMLElement;
    this.netCount = this.root.querySelector('.nets') as HTMLElement;
  }

  get isOpen(): boolean { return this.open; }

  setOpen(v: boolean): void {
    if (this.open === v) return;
    this.open = v;
    this.root.classList.toggle('open', v);
  }

  toggle(): boolean { this.setOpen(!this.open); return this.open; }

  /** Rebuild the readout. Diffed on one key, so an open panel that nothing has
   *  moved costs one string compare and a closed one returns before that. */
  render(view: PowerView): void {
    if (!this.open) return;
    const key = keyOf(view);
    if (key === this.lastKey) return;
    this.lastKey = key;
    this.netCount.textContent = String(view.networks.length);
    this.body.innerHTML = bodyHtml(view);
  }

  /** Force the next render to rebuild, e.g. after the first network appears. */
  invalidate(): void { this.lastKey = ''; }
}

/** Everything that can change what is on screen, in one string. */
function keyOf(view: PowerView): string {
  return `${view.enabled ? 1 : 0}|${view.offGrid}|${view.offGridGenerators}|`
    + view.networks.map((n) => `${n.id}:${n.capacityW}:${n.productionW}:`
      + `${n.demandW}:${n.consumptionW}:${n.satisfaction}:${n.satisfactionQ16}:`
      + `${n.poles}:${n.generators}:${n.fuelledGenerators}:${n.consumers}:`
      + n.history.map((s) => `${s.demandW}/${s.productionW}`).join(','))
      .join(';');
}

function bodyHtml(view: PowerView): string {
  // Before anything electrical exists the honest answer is not an empty table,
  // it is the three steps that make one.
  if (!view.enabled) {
    return '<div class="none">No electrical network yet. Craft a power pole '
      + 'and a burner generator, place a pole, then place a generator inside '
      + 'its supply area.</div>';
  }
  const nets = view.networks.length === 0
    ? '<div class="none">A grid exists but no pole has been placed.</div>'
    : view.networks.map(network).join('');
  return nets + offGridLine(view.offGrid, view.offGridGenerators);
}

function network(n: NetworkRow): string {
  const pct = Math.round(clamp01(n.satisfaction) * 100);
  const v = verdict(n);
  return `<div class="net" data-net="${int(n.id)}">`
    + `<h4>Network #${int(n.id)}</h4>`
    // THE SENTENCE. Everything else on this card is supporting evidence.
    + `<div class="say">${watt(n.demandW, `demand:${int(n.id)}`)} demanded, `
    + `${watt(n.productionW, `production:${int(n.id)}`)} produced, `
    + `<b data-power="satisfaction:${int(n.id)}" data-w="${num(n.satisfaction)}">`
    + `${pct}</b>%</div>`
    + bar(n.satisfaction, pct)
    + `<div class="verdict ${v.kind}" data-power="verdict:${int(n.id)}" `
    + `data-kind="${v.kind}">${v.text}</div>`
    + table(n)
    + counts(n)
    + `<div class="q16"><em>Q16</em>`
    + `<code data-power="q16:${int(n.id)}">${int(n.satisfactionQ16)}</code></div>`
    + spark(n.history)
    + '</div>';
}

/**
 * The three verdicts, and there are exactly three on purpose: a readout that can
 * say anything says nothing. Short means the generators cannot cover demand even
 * fully fuelled, which is a building problem; spare means the opposite.
 */
function verdict(n: NetworkRow): { kind: string; text: string } {
  const cap = num(n.capacityW);
  const dem = num(n.demandW);
  if (dem > cap) {
    return {
      kind: 'short',
      text: 'short: add a generator or take machines off this network',
    };
  }
  if (cap > dem * 1.5 && cap > 0) {
    return { kind: 'spare', text: `spare capacity: ${watts(cap - dem)} unused` };
  }
  return { kind: 'balanced', text: 'balanced' };
}

function bar(sat: number, pct: number): string {
  const s = clamp01(sat);
  const cls = s >= 1 ? 'ok' : (s < 0.5 ? 'bad' : 'warn');
  return `<div class="bar ${cls}" role="img" aria-label="${pct}% satisfied">`
    + `<i style="width:${(s * 100).toFixed(2)}%"></i></div>`;
}

/**
 * Capacity, production, demand, consumption. Production and demand restate what
 * the sentence above already owns, so they carry only data-w and leave the named
 * data-power to the sentence: one name, one element, no ambiguous querySelector.
 */
function table(n: NetworkRow): string {
  return '<div class="rows">'
    + `<div class="r"><em>capacity</em>`
    + `${watt(n.capacityW, `capacity:${int(n.id)}`)}</div>`
    + `<div class="r"><em>production</em>${wattRaw(n.productionW)}</div>`
    + `<div class="r"><em>demand</em>${wattRaw(n.demandW)}</div>`
    + `<div class="r"><em>consumption</em>`
    + `${watt(n.consumptionW, `consumption:${int(n.id)}`)}</div>`
    + '</div>';
}

/** A dry generator is the single most likely reason a base slowed down, so it
 *  is called out in the warning colour rather than left as arithmetic. */
function counts(n: NetworkRow): string {
  const id = int(n.id);
  const dry = num(n.fuelledGenerators) < num(n.generators);
  return '<div class="counts">'
    + `<span data-power="poles:${id}">${int(n.poles)}</span> poles, `
    + `<span data-power="fuelled:${id}">${int(n.fuelledGenerators)}</span>/`
    + `<span data-power="generators:${id}">${int(n.generators)}</span>`
    + ' generators fuelled, '
    + `<span data-power="consumers:${id}">${int(n.consumers)}</span> consumers`
    + (dry ? '<b class="warn"> (out of fuel)</b>' : '')
    + '</div>';
}

/**
 * FS-53: TWO SENTENCES, BECAUSE THEY ARE TWO FAULTS WITH TWO FIXES.
 *
 * A CONSUMER off grid is running at zero and wants a pole near it. A GENERATOR
 * off grid is burning fuel that reaches nobody, and every machine on the real
 * network is short by exactly the watts this one is making for itself. Reid hit
 * the second and this panel could only ever have printed the first, because
 * `offGridCount` never looked at a generator. The generator line comes FIRST
 * when both are present: an unreachable power plant explains the starving
 * machines, and printing the symptom above the cause reads as two problems.
 */
function offGridLine(off: number, gens: number): string {
  const g = int(gens);
  const k = int(off);
  const genLine = g <= 0 ? ''
    : `<div class="offgrid warn"><b data-power="offgridgen">${g}</b> `
      + `generator${g === 1 ? ' is' : 's are'} not reached by any pole, so `
      + `${g === 1 ? 'its' : 'their'} power goes nowhere. Put a power pole `
      + 'beside it, inside its supply area.</div>';
  const useLine = k <= 0 ? ''
    : `<div class="offgrid warn"><b data-power="offgrid">${k}</b> machines `
      + 'are not reached by any pole and are running at zero</div>';
  return genLine + useLine;
}

/**
 * Two polylines, demand and production, scaled together to the max of both
 * series so the gap between them is the readable thing. Hand-rolled: a chart
 * library for eighty points would be the largest dependency in src/ui.
 *
 * Fewer than two samples renders NOTHING, because a one-point polyline is a dot
 * that looks like a flat line at whatever height it lands.
 */
function spark(history: readonly PowerSample[]): string {
  if (history.length < 2) return '';
  let max = 0;
  for (const s of history) max = Math.max(max, num(s.demandW), num(s.productionW));
  if (max <= 0) max = 1;
  const span = history.length - 1;
  const line = (pick: (s: PowerSample) => number): string => history
    .map((s, i) => `${((i / span) * 200).toFixed(1)},`
      + `${(39 - clamp01(num(pick(s)) / max) * 38).toFixed(1)}`).join(' ');
  return '<svg class="spark" viewBox="0 0 200 40" preserveAspectRatio="none">'
    + `<polyline class="dm" points="${line((s) => s.demandW)}"/>`
    + `<polyline class="pr" points="${line((s) => s.productionW)}"/>`
    + '</svg><div class="legend"><i class="dm"></i>demand'
    + '<i class="pr"></i>production</div>';
}

/** A named watt figure: readable text, raw watts on the same element. */
function watt(v: number, tag: string): string {
  const raw = num(v);
  return `<b data-power="${tag}" data-w="${raw}">${watts(raw)}</b>`;
}

/** The same, unnamed, for a cell that restates a number the sentence owns. */
function wattRaw(v: number): string {
  const raw = num(v);
  return `<b data-w="${raw}">${watts(raw)}</b>`;
}

/** W under a kilowatt, kW to one decimal, MW to two. 120000 reads `120.0 kW`. */
function watts(v: number): string {
  const w = num(v);
  const a = Math.abs(w);
  if (a >= 1e6) return `${(w / 1e6).toFixed(2)} MW`;
  if (a >= 1e3) return `${(w / 1e3).toFixed(1)} kW`;
  return `${Math.round(w)} W`;
}

/** An empty grid reads as zeros, never as NaN and never as a blank cell. */
function num(v: number): number { return Number.isFinite(v) ? v : 0; }

function int(v: number): number { return Math.round(num(v)); }

function clamp01(v: number): number { return Math.max(0, Math.min(1, num(v))); }
