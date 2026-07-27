// The flight HUD: the navball, the readouts that flank it, and the stage
// delta-v table. Bottom centre, always on while flying, never a modal.
//
// DW-2 holds as everywhere under src/ui: plain data in, no three.js, no
// callbacks out (this panel is read-only, it flies nothing). The ONE exception
// to "HTML, not canvas" is the ball itself, which is a sphere seen edge on and
// cannot be expressed in boxes; every number beside it is still real text, so a
// screenshot carries its own evidence and a probe can read the DOM.
//
// DW-30 item 4: per-stage delta-v is not optional. The stage table is part of
// the flight HUD, not a VAB-only luxury, because the question "can this stage
// still circularise" is asked in flight and answered nowhere else.
//
// render() is called every frame, so it diffs: a rounded attitude key gates the
// canvas repaint and four string keys gate the four regions of text.

import './styles/navball.css';
import { esc } from './GameHud.js';
import {
  dirOf, viewOf, frontMarks, drawBall, drawMarks, type Mark,
} from './NavballDraw.js';

export interface BallMarker { headingDeg: number; pitchDeg: number }

export interface StageReadout {
  index: number; dvVacMS: number; twr: number; burnS: number; active: boolean;
}

export interface NavballReadout {
  /** Vessel nose attitude in the LOCAL horizon frame. heading 0 = north,
   *  90 = east. pitch +90 = straight up. */
  headingDeg: number; pitchDeg: number; rollDeg: number;
  /** Markers in the same local horizon frame. null when undefined (e.g. zero
   *  velocity). */
  prograde: BallMarker | null;
  retrograde: BallMarker | null;
  /** The SAS commanded attitude. */
  command: BallMarker | null;
  /** DW-30 item 6: the gravity-turn guidance ribbon. Shown, never flown. */
  guidance: BallMarker | null;
  /** Metres above the terrain under the vessel. */
  altitudeM: number;
  /** Metres above the 600 km datum, which is what apoapsis and periapsis are
   *  relative to. */
  altitudeDatumM: number;
  surfaceSpeedMS: number;
  orbitalSpeedMS: number;
  verticalSpeedMS: number;
  /** Metres above the datum. Not finite when the trajectory is unbound. */
  apoapsisM: number; periapsisM: number;
  /** True when the conic is closed. */
  bound: boolean;
  throttle: number;
  stages: StageReadout[];
  totalDvMS: number; remainingDvMS: number;
  sas: string;
  status: string;
  qPa: number; maxQPa: number; twr: number; massKg: number; gForce: number;
  metS: number;
  message: string;
}

/** CSS pixels. The canvas backing store is this times the device ratio. */
const SIZE = 220;

export class Navball {
  private readonly root: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D | null;
  private readonly chipsEl: HTMLElement;
  private readonly leftEl: HTMLElement;
  private readonly rightEl: HTMLElement;
  private readonly stagesEl: HTMLElement;
  private readonly footEl: HTMLElement;
  private readonly attEl: HTMLElement;
  private readonly thrEl: HTMLElement;
  private readonly dpr: number;
  private visible = true;
  private renders = 0;
  private marks: string[] = [];
  private snap: NavballReadout | null = null;
  /** [ball, left, right, stages, chips, throttle]. */
  private last = ['', '', '', '', '', ''];

  constructor(host: HTMLElement) {
    this.root = document.createElement('div');
    this.root.id = 'of-navball';
    this.root.className = 'of-ui';
    this.root.innerHTML = SKELETON;
    host.appendChild(this.root);
    this.chipsEl = this.pick('.of-nchips');
    this.leftEl = this.pick('.of-nread.left');
    this.rightEl = this.pick('.of-nread.right');
    this.stagesEl = this.pick('.of-nstage-rows');
    this.footEl = this.pick('.of-nstage-foot');
    this.attEl = this.pick('.of-natt');
    this.thrEl = this.pick('.of-nthr');
    this.canvas = this.pick('canvas') as HTMLCanvasElement;
    this.dpr = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
    this.canvas.width = Math.round(SIZE * this.dpr);
    this.canvas.height = Math.round(SIZE * this.dpr);
    this.ctx = this.canvas.getContext('2d');
  }

  private pick(sel: string): HTMLElement {
    return this.root.querySelector<HTMLElement>(sel) as HTMLElement;
  }

  setVisible(on: boolean): void {
    this.visible = on;
    this.root.style.display = on ? '' : 'none';
    if (!on) this.marks = [];
  }

  /** Force the next render to rebuild, ignoring the diff keys. */
  invalidate(): void { this.last = ['', '', '', '', '', '']; }

  render(r: NavballReadout): void {
    this.renders++;
    this.snap = r;
    if (!this.visible) { this.marks = []; return; }
    this.paint(r);
    this.chips(r);
    this.numbers(r);
    this.table(r);
  }

  /**
   * The ball. Markers are filtered to the near hemisphere BEFORE drawing and
   * the surviving list is what report() publishes, so what a probe reads is
   * literally the set that was painted, not a second opinion about it.
   */
  private paint(r: NavballReadout): void {
    const w = viewOf(nm(r.headingDeg), nm(r.pitchDeg), nm(r.rollDeg));
    const all: Mark[] = [];
    add(all, 'prograde', r.prograde);
    add(all, 'retrograde', r.retrograde);
    add(all, 'command', r.command);
    add(all, 'guidance', r.guidance);
    const front = frontMarks(w, all);
    this.marks = front.map((m) => m.kind);
    const key = `${round(r.headingDeg)}/${round(r.pitchDeg)}/${round(r.rollDeg)}|`
      + all.map((m) => `${m.kind}:${round(m.dir.e)}:${round(m.dir.n)}:${round(m.dir.u)}`)
        .join(',');
    if (key === this.last[0]) return;
    this.last[0] = key;
    this.attEl.textContent = `HDG ${deg(r.headingDeg)}  PIT ${signed(r.pitchDeg, 0)}`
      + `  ROL ${signed(r.rollDeg, 0)}`;
    const c = this.ctx;
    if (c === null) return;
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    drawBall(c, SIZE, w);
    drawMarks(c, SIZE, w, front);
  }

  private chips(r: NavballReadout): void {
    const key = `${r.status}|${r.sas}|${r.message}`;
    if (key === this.last[4]) return;
    this.last[4] = key;
    this.chipsEl.innerHTML = `<span class="chip st">${esc(r.status)}</span>`
      + `<span class="chip sas${r.sas === 'OFF' ? ' off' : ''}">SAS `
      + `${esc(r.sas)}</span>`
      + (r.message === '' ? '' : `<span class="chip msg">${esc(r.message)}</span>`);
  }

  private numbers(r: NavballReadout): void {
    const left = cells([
      ['ALT AGL', alt(r.altitudeM)],
      ['ALT MSL', alt(r.altitudeDatumM)],
      ['SRF', `${spd(r.surfaceSpeedMS)} m/s`],
      ['ORB', `${spd(r.orbitalSpeedMS)} m/s`],
      ['V/S', `${signed(r.verticalSpeedMS, 1)} m/s`],
      ['MET', met(r.metS)],
    ]);
    const right = cells([
      ['AP', conic(r.apoapsisM, r.bound)],
      ['PE', conic(r.periapsisM, r.bound)],
      ['TWR', fix(r.twr, 2)],
      ['MASS', mass(r.massKg)],
      ['Q', `${fix(nm(r.qPa) / 1000, 2)} kPa`],
      ['G', `${fix(r.gForce, 2)} g`],
    ]);
    if (left !== this.last[1]) { this.last[1] = left; this.leftEl.innerHTML = left; }
    if (right !== this.last[2]) { this.last[2] = right; this.rightEl.innerHTML = right; }
    const pct = Math.round(clamp01(r.throttle) * 100);
    const kThr = `${pct}|${fix(nm(r.maxQPa) / 1000, 1)}`;
    if (kThr === this.last[5]) return;
    this.last[5] = kThr;
    this.thrEl.innerHTML = '<em>THR</em>'
      + `<span class="bar"><i style="width:${pct}%"></i></span><b>${pct}%</b>`
      + `<span class="maxq">max Q ${fix(nm(r.maxQPa) / 1000, 1)} kPa</span>`;
  }

  /** DW-30 item 4. A stage with no delta-v reads as a fault, not as a blank. */
  private table(r: NavballReadout): void {
    const st = r.stages;
    const key = st.map((s) => `${s.index}:${fix(s.dvVacMS, 0)}:${fix(s.twr, 2)}:`
      + `${fix(s.burnS, 0)}:${s.active ? 1 : 0}`).join(',')
      + `|${fix(r.totalDvMS, 0)}|${fix(r.remainingDvMS, 0)}`;
    if (key === this.last[3]) return;
    this.last[3] = key;
    this.stagesEl.innerHTML = st.length === 0
      ? '<div class="none">no stages</div>'
      : st.map((s) => `<div class="r${s.active ? ' on' : ''}">`
        + `<span>${Math.round(nm(s.index))}</span>`
        + `<b${nm(s.dvVacMS) > 0 ? '' : ' class="warn"'}>${fix(s.dvVacMS, 0)}</b>`
        + `<span>${fix(s.twr, 2)}</span>`
        + `<span>${fix(s.burnS, 0)}s</span></div>`).join('');
    this.footEl.innerHTML = `<div class="f"><em>&#916;v left</em>`
      + `<b>${fix(r.remainingDvMS, 0)}</b></div>`
      + `<div class="f"><em>total</em><b>${fix(r.totalDvMS, 0)}</b></div>`;
  }

  /**
   * What a headless probe reads. `renders` is the whole point of it: a navball
   * that is mounted but never fed and one that is live look identical in a
   * screenshot, and they must not look identical here.
   */
  report(): unknown {
    const r = this.snap;
    return {
      visible: this.visible,
      headingDeg: r === null ? 0 : nm(r.headingDeg),
      pitchDeg: r === null ? 0 : nm(r.pitchDeg),
      rollDeg: r === null ? 0 : nm(r.rollDeg),
      altitudeM: r === null ? 0 : nm(r.altitudeM),
      altitudeDatumM: r === null ? 0 : nm(r.altitudeDatumM),
      apoapsisM: r === null ? 0 : r.apoapsisM,
      periapsisM: r === null ? 0 : r.periapsisM,
      bound: r !== null && r.bound,
      surfaceSpeedMS: r === null ? 0 : nm(r.surfaceSpeedMS),
      orbitalSpeedMS: r === null ? 0 : nm(r.orbitalSpeedMS),
      verticalSpeedMS: r === null ? 0 : nm(r.verticalSpeedMS),
      throttle: r === null ? 0 : clamp01(r.throttle),
      stages: r === null ? 0 : r.stages.length,
      totalDvMS: r === null ? 0 : nm(r.totalDvMS),
      remainingDvMS: r === null ? 0 : nm(r.remainingDvMS),
      status: r === null ? '' : r.status,
      sas: r === null ? '' : r.sas,
      markersDrawn: [...this.marks],
      renders: this.renders,
    };
  }

  dispose(): void {
    this.root.remove();
    this.marks = [];
    this.snap = null;
  }
}

/** The static frame. Built once; render() only refills the marked regions. */
const SKELETON =
  '<div class="of-nchips"></div>'
  + '<div class="of-npanel"><div class="of-ncore">'
  + '<div class="of-nspace"></div>'
  + '<div class="of-nread left"></div>'
  + `<div class="of-nball"><canvas width="${SIZE}" height="${SIZE}" `
  + `style="width:${SIZE}px;height:${SIZE}px"></canvas>`
  + '<div class="of-natt"></div></div>'
  + '<div class="of-nread right"></div>'
  + '<div class="of-nstages"><h4>Stages<span>&#916;v / TWR / burn</span></h4>'
  + '<div class="of-nstage-rows"></div><div class="of-nstage-foot"></div></div>'
  + '</div><div class="of-nthr"></div></div>';

function add(out: Mark[], kind: Mark['kind'], m: BallMarker | null): void {
  if (m === null || m === undefined) return;
  if (!Number.isFinite(m.headingDeg) || !Number.isFinite(m.pitchDeg)) return;
  out.push({ kind, dir: dirOf(m.headingDeg, m.pitchDeg) });
}

function cells(rows: readonly (readonly [string, string])[]): string {
  return rows.map(([k, v]) => `<div class="c"><em>${k}</em><b>${v}</b></div>`).join('');
}

/** A missing number reads as zero, never as NaN and never as a blank cell. */
function nm(v: number): number { return Number.isFinite(v) ? v : 0; }

function fix(v: number, d: number): string { return nm(v).toFixed(d); }

function clamp01(v: number): number { return Math.max(0, Math.min(1, nm(v))); }

function round(v: number): number { return Math.round(nm(v) * 4) / 4; }

/** Metres up to 10 km, kilometres past it, megametres once in deep space. */
function alt(v: number): string {
  const a = nm(v);
  const m = Math.abs(a);
  if (m >= 1e6) return `${(a / 1e6).toFixed(3)} Mm`;
  if (m >= 1e4) return `${(a / 1e3).toFixed(2)} km`;
  return `${a.toFixed(0)} m`;
}

/** An unbound conic has no apoapsis to print and no honest way to fake one. */
function conic(v: number, bound: boolean): string {
  return bound && Number.isFinite(v) ? alt(v) : '---';
}

function spd(v: number): string {
  const a = nm(v);
  return Math.abs(a) >= 1000 ? a.toFixed(0) : a.toFixed(1);
}

function signed(v: number, d: number): string {
  const a = nm(v);
  return `${a >= 0 ? '+' : ''}${a.toFixed(d)}`;
}

/** Three digits, so 090 and 009 are the same width on the eye. */
function deg(v: number): string {
  const a = ((Math.round(nm(v)) % 360) + 360) % 360;
  return `00${a}`.slice(-3);
}

function mass(kg: number): string {
  const v = nm(kg);
  return Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(2)} t` : `${v.toFixed(0)} kg`;
}

/** mm:ss, and the minutes are allowed past 59 rather than wrapping silently. */
function met(s: number): string {
  const t = Math.max(0, Math.floor(nm(s)));
  const m = Math.floor(t / 60);
  return `${m < 10 ? '0' : ''}${m}:${`0${t % 60}`.slice(-2)}`;
}
