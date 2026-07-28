// =============================================================================
// MapView.ts - the map MODE's panel: DOM, the canvas, the readout, the node
// controls. Plain DOM and plain data (DW-2, and check-limits enforces the
// no-three.js half mechanically).
//
// It is a `Modal`, so it joins ModalStack's DERIVED list in its own constructor
// and Escape closes it through the one handler rather than a second one
// (GP-25). Its `closer` is the app's own leave() transition, because who owns
// the pointer is a whole-application question.
//
// NOTHING HERE COMPUTES A TRAJECTORY. The conic, the apsides, the delta-v, the
// burn time and the resulting orbit all arrive as numbers from /core.
// =============================================================================
import './styles/map.css';
import { Modal } from './ModalStack.js';
import type { ModalStack } from './ModalStack.js';
import { drawMap } from './MapDraw.js';
import type { MapDrawReport, MapReadout } from './MapTypes.js';
import { ZERO_CONTRAST } from './MapContrast.js';

/** What the panel's buttons ask the app to do. It does none of it itself. */
export interface MapHooks {
  /** Nudge one handle. `axis` 'time' is seconds along the orbit. */
  adjust(axis: 'prograde' | 'normal' | 'radial' | 'time', delta: number): void;
  place(): void;
  clear(): void;
  holdNode(): void;
  /** Multiply the view span. > 1 zooms out. */
  zoom(mult: number): void;
  /** Look at something else. Focus switching and re-centring are ONE mechanism
   *  (DW-36): this writes a different `centreM` and nothing else changes. */
  focus(name: string): void;
}

const HANDLES: readonly (readonly ['prograde' | 'normal' | 'radial' | 'time',
  string, number])[] = [
    ['prograde', 'prograde', 10],
    ['normal', 'normal', 10],
    ['radial', 'radial out', 10],
    ['time', 'node time', 60],
  ];

/** MM:SS, or H:MM:SS past an hour. A negative time reads as a countdown gone
 *  past, which is exactly what "you are late to start the burn" means. */
export function clock(s: number): string {
  if (!Number.isFinite(s)) return '--:--';
  const neg = s < 0;
  const t = Math.floor(Math.abs(s));
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), sec = t % 60;
  const two = (n: number): string => (n < 10 ? `0${n}` : `${n}`);
  const body = h > 0 ? `${h}:${two(m)}:${two(sec)}` : `${two(m)}:${two(sec)}`;
  return neg ? `-${body}` : body;
}

function km(m: number): string {
  if (!Number.isFinite(m) || Math.abs(m) > 1e12) return '---';
  return `${(m / 1000).toFixed(1)} km`;
}

function row(label: string, value: string, cls = ''): string {
  return `<div class="row ${cls}"><em>${label}</em><b>${value}</b></div>`;
}

/** A fraction of a whole world is a very small number early on, and "0.00%"
 *  after a first survey pass reads as "the map is broken". */
function pct(f: number): string {
  if (!Number.isFinite(f)) return '---';
  const v = f * 100;
  return `${v > 0 && v < 0.01 ? '&lt;0.01' : v.toFixed(v < 10 ? 2 : 1)}%`;
}

/** Names come from the sim (a vessel's, a body's) and land in markup and in a
 *  data attribute. getAttribute decodes, so the focus round trip is exact. */
function esc(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) => (c === '&' ? '&amp;'
    : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;'));
}

/** A fresh one each time: a shared literal would hand every MapView the same
 *  `markers` array, and a probe that read one would be reading all of them. */
function noDraw(): MapDrawReport {
  return {
    currentPoints: 0, plannedPoints: 0, markers: [], pixelsPerMetre: 0,
    alphas: { ore: 0, discovered: 0, body: 0 },
    discoveredQuads: 0, terrainSamples: 0, sampleSizeM: 0,
    oreDrawn: 0, oreDrawnRows: [], bodyFilled: false,
    contrast: ZERO_CONTRAST,
  };
}

export class MapView extends Modal {
  private readonly root: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly readout: HTMLElement;
  private readonly msg: HTMLElement;
  private open = false;
  private lastKey = '';
  /** The report the LAST paint pass produced, for a probe. Not a second
   *  opinion: these are counts taken inside drawMap. */
  drawn: MapDrawReport = noDraw();
  frames = 0;

  constructor(parent: HTMLElement, stack: ModalStack,
              readonly hooks: MapHooks) {
    super('map', stack);
    this.root = document.createElement('div');
    this.root.id = 'of-map';
    this.root.className = 'of-ui';
    // The structure map.css lays out: a header, a split of picture and
    // numbers, a hint. Written to match that file field for field, because a
    // panel whose DOM and whose stylesheet disagree renders as a full-width
    // column of text over the picture and throws no error at all: exactly what
    // the first driven screenshot of this map showed.
    this.root.innerHTML =
      '<div class="frame">'
      + '<h3>Map<span class="msg"></span></h3>'
      + '<div class="split">'
      + '<div class="view"><canvas class="map-canvas"></canvas></div>'
      + '<div class="readout"></div>'
      + '</div>'
      + '<div class="hint"><b>M</b> or <b>Escape</b> returns to the ball. '
      + 'Flight controls stay live: throttle, stage, attitude, warp and every '
      + 'SAS mode work from here, exactly as they do from the navball.</div>'
      + '</div>';
    parent.appendChild(this.root);
    this.canvas = this.root.querySelector('.map-canvas') as HTMLCanvasElement;
    this.readout = this.root.querySelector('.readout') as HTMLElement;
    this.msg = this.root.querySelector('.msg') as HTMLElement;

    // ONE delegated listener, never one per button (the house rule): the
    // readout is rebuilt whenever its key changes and per-node handlers would
    // be re-bound every time.
    this.readout.addEventListener('click', (e) => this.onClick(e));
    this.canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.hooks.zoom(e.deltaY > 0 ? 1.25 : 0.8);
    }, { passive: false });
  }

  private onClick(e: MouseEvent): void {
    const b = (e.target as HTMLElement | null)?.closest('button');
    if (b === null || b === undefined || b.disabled) return;
    const act = b.getAttribute('data-act');
    if (act === 'place') { this.hooks.place(); return; }
    if (act === 'clear') { this.hooks.clear(); return; }
    if (act === 'hold') { this.hooks.holdNode(); return; }
    if (act === 'zoomin') { this.hooks.zoom(0.8); return; }
    if (act === 'zoomout') { this.hooks.zoom(1.25); return; }
    const f = b.getAttribute('data-focus');
    if (f !== null) { this.hooks.focus(f); return; }
    const axis = b.getAttribute('data-axis');
    const d = Number(b.getAttribute('data-delta'));
    if (axis !== null && Number.isFinite(d)) {
      this.hooks.adjust(axis as 'prograde', d);
    }
  }

  get isOpen(): boolean { return this.open; }

  setOpen(v: boolean): void {
    if (this.open === v) return;
    this.open = v;
    this.root.classList.toggle('open', v);
    this.lastKey = '';
  }

  /** Every frame while open. The canvas repaints; the DOM diffs on a key. */
  render(r: MapReadout): void {
    if (!this.open) return;
    this.frames += 1;
    this.paint(r);
    this.msg.textContent = r.message;
    const key = this.keyOf(r);
    if (key === this.lastKey) return;
    this.lastKey = key;
    this.readout.innerHTML = this.body(r);
  }

  /** The canvas in CSS pixels, for the one caller that must know the SHAPE of
   *  the picture before it is drawn: the terrain grid is cut to the canvas, so
   *  the samples land on the pixels whatever the panel's aspect. It is the
   *  layout's own answer, read from the element, never a constant. */
  size(): { w: number; h: number } {
    return { w: this.canvas.clientWidth, h: this.canvas.clientHeight };
  }

  private paint(r: MapReadout): void {
    const dpr = Math.min(2, self.devicePixelRatio || 1);
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    if (w <= 0 || h <= 0) return;
    const pw = Math.round(w * dpr), ph = Math.round(h * dpr);
    if (this.canvas.width !== pw || this.canvas.height !== ph) {
      this.canvas.width = pw; this.canvas.height = ph;
    }
    const ctx = this.canvas.getContext('2d');
    if (ctx === null) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, pw, ph);
    this.drawn = drawMap(ctx, w, h, dpr, r.scene);
  }

  /** The DOM rebuilds only when this changes. It keys on the INTEGER counts and
   *  the discrete strings, never on the derived fractions: the fractions are a
   *  function of the cell counts, so keying on the counts is sufficient (the
   *  panel cannot go stale) and stable (the last binary digit of a ratio cannot
   *  make it thrash). Altitude and speed keep their existing 1 m / 1 m/s
   *  granularity, which is the discipline this key already had. */
  private keyOf(r: MapReadout): string {
    const n = r.node, c = r.scene.current, d = r.discovery;
    return [
      r.status, r.sas, r.onRails ? '1' : '0',
      c === null ? 'foot' : [
        c.apoapsisAltM.toFixed(0), c.periapsisAltM.toFixed(0),
        c.timeToApoapsisS.toFixed(0), c.timeToPeriapsisS.toFixed(0),
      ].join('|'),
      r.focusName, r.focusOptions.join('~'),
      d === null ? 'dark' : [
        d.surveyCells, d.exploreCells, d.revealAll ? 'all' : 'own',
        d.lastSurveyRadiusM.toFixed(0), d.lastExploreRadiusM.toFixed(0),
        d.cellSizeM.toFixed(0),
      ].join('|'),
      r.altitudeM.toFixed(0), r.speedMS.toFixed(0),
      r.deltaVRemainingMS.toFixed(0),
      n === null ? 'none' : [
        n.progradeMS.toFixed(1), n.normalMS.toFixed(1), n.radialMS.toFixed(1),
        n.timeToNodeS.toFixed(0), n.timeToBurnStartS.toFixed(0),
        n.burnDurationS.toFixed(1), n.apoapsisAltM.toFixed(0),
        n.periapsisAltM.toFixed(0), n.feasible ? 'y' : 'n',
        n.holding ? 'h' : '-',
      ].join('|'),
    ].join(',');
  }

  private body(r: MapReadout): string {
    const c = r.scene.current;
    const out: string[] = [];
    // ON FOOT there is no vessel and so no trajectory. The panel says where you
    // are standing rather than blanking: a column of '---' where the orbit used
    // to be reads as a broken map, which is the one thing it must not do.
    if (c === null) {
      out.push('<h4>Position</h4>');
      out.push(row('state', esc(r.status)));
      out.push(row('ALT', km(r.altitudeM)));
      out.push(row('SPD', `${r.speedMS.toFixed(0)} m/s`));
      out.push('<div class="note">No vessel: the map is centred on you. '
        + 'Keep zooming out and it becomes the orbital view.</div>');
    } else {
      out.push('<h4>Orbit</h4>');
      out.push(row('AP', c.bound ? km(c.apoapsisAltM) : '---'));
      out.push(row('to AP', c.timeToApoapsisS >= 0 ? clock(c.timeToApoapsisS) : '---'));
      out.push(row('PE', km(c.periapsisAltM),
        c.periapsisAltM < r.scene.atmosphereCeilingM ? 'warn' : ''));
      out.push(row('to PE', c.timeToPeriapsisS >= 0 ? clock(c.timeToPeriapsisS) : '---'));
      out.push(row('period', c.bound ? clock(c.periodS) : '---'));
      out.push(row('ecc', c.eccentricity.toFixed(4)));
      out.push(row('ALT', km(r.altitudeM)));
      out.push(row('SPD', `${r.speedMS.toFixed(0)} m/s`));
      out.push(row('dV left', `${r.deltaVRemainingMS.toFixed(0)} m/s`));
      out.push(row('SAS', r.sas));
      // The conic is exact only in vacuum with the engine shut. Saying so is not
      // a nicety: in the air the drawn path is where the vessel would go if the
      // air and the thrust stopped now, which is a different claim.
      if (!r.onRails) {
        out.push(row('trajectory', 'PREDICTED (air or thrust)', 'warn'));
      }
    }
    out.push(this.focusBlock(r));
    out.push(this.discoveryBlock(r));
    if (c !== null) out.push(this.nodeBlock(r));
    return out.join('');
  }

  /** Focus switching IS re-centring: each button writes a different `centreM`
   *  and nothing else about the map changes. */
  private focusBlock(r: MapReadout): string {
    const out: string[] = ['<h4>Focus</h4>'];
    out.push(row('centred on', esc(r.focusName)));
    out.push('<div class="nodectl">');
    // The view controls live here rather than in the node block, because on
    // foot there is no node block and the zoom is the one control the map
    // always has. The wheel does the same thing, continuously.
    out.push('<button class="wide" data-act="zoomout">zoom out</button>');
    out.push('<button class="wide" data-act="zoomin">zoom in</button>');
    for (const name of r.focusOptions) {
      const on = name === r.focusName ? ' on' : '';
      out.push(`<button class="wide${on}" data-focus="${esc(name)}">`
        + `${esc(name)}</button>`);
    }
    out.push('</div>');
    return out.join('');
  }

  /** What the map is allowed to show, and why. Two layers, because height buys
   *  EXTENT and costs RESOLUTION: orbit fills in the shape of the world and
   *  walking fills in its detail. */
  private discoveryBlock(r: MapReadout): string {
    const d = r.discovery;
    const out: string[] = ['<h4>Discovery</h4>'];
    if (d === null) {
      out.push(row('seen', 'nothing yet'));
      out.push('<div class="note">Nothing has been observed. Fly or walk and '
        + 'the world fills in.</div>');
      return out.join('');
    }
    // DW-31's stated failure mode is a player who forgot which mode they are
    // in, so the badge is first and it is plain.
    if (d.revealAll) out.push(row('mode', 'SANDBOX: everything visible', 'warn'));
    out.push(row('survey', `${d.surveyCells} · ${pct(d.surveyFraction)}`));
    out.push(row('last sweep', km(d.lastSurveyRadiusM)));
    out.push(row('explore', `${d.exploreCells} · ${pct(d.exploreFraction)}`));
    out.push(row('last sweep', km(d.lastExploreRadiusM)));
    out.push(row('cell', km(d.cellSizeM)));
    return out.join('');
  }

  private nodeBlock(r: MapReadout): string {
    const n = r.node;
    if (n === null) {
      return '<h4>Maneuver</h4>'
        + '<div class="nodectl">'
        + '<button class="wide" data-act="place">place node</button></div>'
        + '<div class="note">A node tells you the burn. It does not fly it.</div>';
    }
    const out: string[] = ['<h4>Maneuver</h4>'];
    out.push(row('dV', `${n.deltaVMS.toFixed(1)} m/s`,
      n.feasible ? 'good' : 'warn'));
    if (!n.feasible) {
      out.push(row('SHORT BY', `${n.shortfallMS.toFixed(0)} m/s`, 'warn'));
    }
    out.push(row('have', `${n.deltaVAvailableMS.toFixed(0)} m/s`));
    out.push(row('burn', `${n.burnDurationS.toFixed(1)} s`));
    // The number that matters most and is easiest to miss: START EARLY.
    out.push(row('light it in', clock(n.timeToBurnStartS),
      n.timeToBurnStartS < 0 ? 'warn' : n.timeToBurnStartS < 10 ? 'good' : ''));
    out.push(row('node in', clock(n.timeToNodeS)));
    if (n.stagesUsed > 1) out.push(row('stagings', `${n.stagesUsed - 1}`, 'warn'));
    if (n.burnFractionOfPeriod > 0.02) {
      out.push(row('long burn', `${(n.burnFractionOfPeriod * 100).toFixed(0)}% of an orbit`, 'warn'));
    }
    out.push(row('result AP', n.boundAfter ? km(n.apoapsisAltM) : 'ESCAPE'));
    out.push(row('result PE', km(n.periapsisAltM),
      n.periapsisAltM < r.scene.atmosphereCeilingM ? 'warn' : ''));
    out.push('<div class="nodectl">');
    for (const [axis, label, step] of HANDLES) {
      const v = axis === 'prograde' ? n.progradeMS
        : axis === 'normal' ? n.normalMS
          : axis === 'radial' ? n.radialMS : n.timeToNodeS;
      const shown = axis === 'time' ? clock(v) : v.toFixed(1);
      out.push(`<em>${label}</em>`
        + `<button data-axis="${axis}" data-delta="${-step}">-</button>`
        + `<em class="val">${shown}</em>`
        + `<button data-axis="${axis}" data-delta="${step}">+</button>`);
    }
    out.push(`<button class="wide${n.holding ? ' on' : ''}" data-act="hold">`
      + `${n.holding ? 'holding the node (8)' : 'hold node (8)'}</button>`);
    out.push('<button class="wide" data-act="clear">clear node</button>');
    out.push('</div>');
    out.push('<div class="note">Point at the node marker, then light the '
      + 'engine when "light it in" reaches zero. Half the burn goes before the '
      + 'node and half after.</div>');
    return out.join('');
  }

  report(): unknown {
    return { open: this.open, frames: this.frames, drawn: this.drawn };
  }
}
