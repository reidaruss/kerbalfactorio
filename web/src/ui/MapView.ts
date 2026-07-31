// =============================================================================
// MapView.ts - the map MODE's panel: DOM, the canvas, the readout, the events.
// Plain DOM and plain data (DW-2, and check-limits enforces the no-three.js
// half mechanically). The readout HTML itself is built in MapPanels.ts.
//
// It is a `Modal`, so it joins ModalStack's DERIVED list in its own constructor
// and Escape closes it through the one handler rather than a second one
// (GP-25). Its `closer` is the app's own leave() transition, because who owns
// the pointer is a whole-application question.
//
// NOTHING HERE COMPUTES A TRAJECTORY. The conic, the apsides, the delta-v, the
// burn time and the resulting orbit all arrive as numbers from /core.
//
// THE PICTURE (GP-208, DW-37). In 3D mode (`MapReadout.three`) the picture is
// the Map3D scene on the main canvas BEHIND this DOM, so the view region goes
// transparent and forwards the pointer: drag becomes `look`, a still click
// becomes `pick`, the wheel stays `zoom`. The 2D canvas keeps PAINTING either
// way, hidden by visibility (not display, which would zero its layout box and
// starve the painter of a size): its per-sample luma is `of.map('grid')`'s
// contract and world-gen's instruments read it (GP-209).
// =============================================================================
import './styles/map.css';
import { Modal } from './ModalStack.js';
import type { ModalStack } from './ModalStack.js';
import { drawMap } from './MapDraw.js';
import { labelOf } from '../player/Bindings.js';
import { panelBody } from './MapPanels.js';
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
  /** Orbit the 3D camera. Pixels of drag, straight off the mouse. */
  look(dxPx: number, dyPx: number): void;
  /** A still click on the picture, in NDC (-1..1, y up). */
  pick(xNdc: number, yNdc: number): void;
  /** Highlight a vessel row and its marker. */
  select(id: number): void;
  /** The handoff door (GP-210). Refusals arrive as sentences on the msg line. */
  takeControl(id: number): void;
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
  private readonly viewEl: HTMLElement;
  private readonly readout: HTMLElement;
  private readonly msg: HTMLElement;
  private open = false;
  private lastKey = '';
  /** Drag state for the 3D camera. `moved` separates a drag from a click. */
  private dragging = false;
  private dragMoved = 0;
  private dragX = 0;
  private dragY = 0;
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
      + // GP-131. THE KEYS ARE READ FROM THE BINDING TABLE, never spelled here.
      // A hint that names the wrong key is worse than no hint: it teaches the
      // player a control that does nothing. One remap away from wrong is when
      // to fix it, not after.
      `<div class="hint"><span class="hint3d">Drag rotates · wheel zooms · `
      + `click a marker selects. </span><b>${labelOf('map')}</b> or `
      + `<b>${labelOf('cancel')}</b> returns to the ball. `
      + 'Flight controls stay live: throttle, stage, attitude, warp and every '
      + 'SAS mode work from here, exactly as they do from the navball.</div>'
      + '</div>';
    parent.appendChild(this.root);
    this.canvas = this.root.querySelector('.map-canvas') as HTMLCanvasElement;
    this.viewEl = this.root.querySelector('.view') as HTMLElement;
    this.readout = this.root.querySelector('.readout') as HTMLElement;
    this.msg = this.root.querySelector('.msg') as HTMLElement;

    // ONE delegated listener, never one per button (the house rule): the
    // readout is rebuilt whenever its key changes and per-node handlers would
    // be re-bound every time.
    this.readout.addEventListener('click', (e) => this.onClick(e));
    // On the VIEW, not the canvas: in 3D mode the canvas is visibility-hidden
    // and a hidden element receives no events at all.
    this.viewEl.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.hooks.zoom(e.deltaY > 0 ? 1.25 : 0.8);
    }, { passive: false });
    this.viewEl.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      this.dragging = true;
      this.dragMoved = 0;
      this.dragX = e.clientX;
      this.dragY = e.clientY;
    });
    // Window, not the view: a drag that leaves the box must keep steering and
    // must still end. The map being closed mid-drag just stops the callbacks.
    window.addEventListener('mousemove', (e) => {
      if (!this.dragging) return;
      const dx = e.clientX - this.dragX, dy = e.clientY - this.dragY;
      this.dragX = e.clientX;
      this.dragY = e.clientY;
      this.dragMoved += Math.abs(dx) + Math.abs(dy);
      this.hooks.look(dx, dy);
    });
    window.addEventListener('mouseup', (e) => {
      if (!this.dragging) return;
      this.dragging = false;
      if (this.dragMoved < 5) {
        // The 3D scene fills the WHOLE canvas behind this DOM, so NDC comes
        // from the window, not from the view box.
        const w = window.innerWidth || 1, h = window.innerHeight || 1;
        this.hooks.pick((e.clientX / w) * 2 - 1, -(e.clientY / h) * 2 + 1);
      }
    });
  }

  private onClick(e: MouseEvent): void {
    const t = e.target as HTMLElement | null;
    const b = t?.closest('button');
    if (b !== null && b !== undefined && !b.disabled) {
      const act = b.getAttribute('data-act');
      if (act === 'place') { this.hooks.place(); return; }
      if (act === 'clear') { this.hooks.clear(); return; }
      if (act === 'hold') { this.hooks.holdNode(); return; }
      if (act === 'zoomin') { this.hooks.zoom(0.8); return; }
      if (act === 'zoomout') { this.hooks.zoom(1.25); return; }
      const ctl = b.getAttribute('data-ctl');
      if (ctl !== null) { this.hooks.takeControl(Number(ctl)); return; }
      const f = b.getAttribute('data-focus');
      if (f !== null) { this.hooks.focus(f); return; }
      const axis = b.getAttribute('data-axis');
      const d = Number(b.getAttribute('data-delta'));
      if (axis !== null && Number.isFinite(d)) {
        this.hooks.adjust(axis as 'prograde', d);
      }
      return;
    }
    // Not a button: a vessel row selects.
    const sel = t?.closest('[data-sel]');
    if (sel !== null && sel !== undefined) {
      this.hooks.select(Number(sel.getAttribute('data-sel')));
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
    this.root.classList.toggle('three', r.three);
    this.paint(r);
    this.msg.textContent = r.message;
    const key = this.keyOf(r);
    if (key === this.lastKey) return;
    this.lastKey = key;
    this.readout.innerHTML = panelBody(r);
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
      r.status, r.sas, r.onRails ? '1' : '0', r.three ? '3' : '2',
      c === null ? 'foot' : [
        c.apoapsisAltM.toFixed(0), c.periapsisAltM.toFixed(0),
        c.timeToApoapsisS.toFixed(0), c.timeToPeriapsisS.toFixed(0),
      ].join('|'),
      r.focusName, r.focusOptions.join('~'),
      r.vessels.map((v) => [v.id, v.mode, v.selected ? 's' : '-',
        Number.isFinite(v.fuelKg) ? v.fuelKg.toFixed(0) : 'x',
        Number.isFinite(v.apoapsisAltM) ? v.apoapsisAltM.toFixed(0) : 'x',
      ].join(':')).join('~'),
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

  report(): unknown {
    return { open: this.open, frames: this.frames, drawn: this.drawn };
  }
}
