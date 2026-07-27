// =============================================================================
// MapDraw.ts - the orbital map's painter: a MapScene in, pixels out. Pure: no
// DOM, no state, no three.js (check-limits enforces the last one). NavballDraw's
// contract, where the caller owns the element and this file owns the paint.
//
// THE PROJECTION LIVES IN ONE PLACE (toPx). Every circle, polyline, glyph and
// label goes through it. A marker that works out its own screen position is the
// bug this project keeps paying for: it agrees with the trajectory until the fit
// changes, then lies quietly.
//
// COLOURS are module constants copied by value out of the game.css --of-*
// palette, as NavballDraw does: it keeps this a pure function of its arguments,
// so a probe drawing offscreen gets the panel's pixels.
// =============================================================================

import type { MapScene, MapConic, MapDrawReport, V3 } from './MapTypes.js';

const TAU = Math.PI * 2;
const INK = '#dfe8ef', DIM = '#8b9aa6', ACCENT = '#ff9a3c';
// TRACK is the current conic: cool and bright, so it wins over the body.
const SHADE = 'rgba(6, 9, 12, 0.78)', TRACK = '#b6dcf7';
const SURFACE = '#2c3740', RIM = '#5b6b77';
const AIR = 'rgba(84, 154, 214, 0.17)', AIR_EDGE = 'rgba(146, 200, 242, 0.62)';

interface XY { x: number; y: number }
interface Rect { x: number; y: number; w: number; h: number }
interface Basis { u: V3; v: V3 }
interface Proj { cx: number; cy: number; m2p: number; u: V3; v: V3 }
interface Tally { skipped: number }

function xy(): XY { return { x: 0, y: 0 }; }
const A = xy(), B = xy(), C0 = xy(), C1 = xy(), LO = xy(), HI = xy();
const P = [0, 0, 0, 0];
const Q = [0, 0, 0, 0];

/** Paint one frame. `cssW`/`cssH` are the canvas's CSS pixel size; the caller
 *  has already set canvas.width/height to cssW*dpr etc. */
export function drawMap(ctx: CanvasRenderingContext2D, cssW: number,
                        cssH: number, dpr: number, s: MapScene): MapDrawReport {
  // setTransform, not scale: scale compounds, and this runs every frame on the
  // same context. Everything below is in CSS pixels.
  const d = Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
  ctx.setTransform(d, 0, 0, d, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  const b = basis(s);
  const span = Number.isFinite(s.spanM) && s.spanM > 1e-6 ? s.spanM : fitSpanM(s);
  const pr: Proj = {
    cx: cssW / 2, cy: cssH / 2, m2p: Math.min(cssW, cssH) / span, u: b.u, v: b.v,
  };
  const marks: string[] = [], taken: Rect[] = [], t: Tally = { skipped: 0 };
  paintBody(ctx, pr, s, marks, taken, cssW, cssH);
  const cur = strokeConic(ctx, pr, s.current, cssW, cssH, TRACK, false, t);
  const plan = strokeConic(ctx, pr, s.planned, cssW, cssH, ACCENT, true, t);
  // Ship and node reserve footprints BEFORE labels lay out, though their glyphs
  // come last: a label across the ship glyph costs both of them.
  const sp = xy(), np = xy();
  const hasShip = toPxV(pr, s.shipPos, sp), hasNode = toPxV(pr, s.nodePos, np);
  if (hasShip) taken.push({ x: sp.x - 10, y: sp.y - 10, w: 20, h: 20 });
  if (hasNode) taken.push({ x: np.x - 13, y: np.y - 13, w: 26, h: 26 });
  reserve(pr, s.current, taken);
  reserve(pr, s.planned, taken);
  apsides(ctx, pr, s.current, false, TRACK, marks, taken, cssW, cssH);
  apsides(ctx, pr, s.planned, true, ACCENT, marks, taken, cssW, cssH);
  if (hasNode) { nodeGlyph(ctx, np); marks.push('node'); }
  if (hasShip) { shipGlyph(ctx, sp); marks.push('ship'); }
  if (scaleBar(ctx, pr, cssW, cssH)) marks.push('scale');
  text(ctx, 'view: down the orbit normal', cssW - 9, cssH - 11, 10, DIM, 'right');
  // Not a marker, a receipt: a refused point leaves no trace on the canvas.
  if (t.skipped > 0) marks.push(`skipped:${t.skipped}`);
  return {
    currentPoints: cur, plannedPoints: plan, markers: marks, pixelsPerMetre: pr.m2p,
  };
}

/** The span (metres across the short screen axis) that frames a scene with a
 *  sensible margin; the view auto-fits with it, then the player may zoom away.
 *  An UNBOUND conic is not framed by its own polyline: a hyperbola's last sample
 *  sits arbitrarily far out and fitting to it shrinks the body to a dot. Body,
 *  ship and periapsis frame that one. */
export function fitSpanM(s: MapScene): number {
  const b = basis(s), surface = Math.max(0, nm(s.bodyRadiusM));
  let r = (surface + Math.max(0, nm(s.atmosphereCeilingM))) * 1.25;
  r = Math.max(r, radOf(b, s.shipPos), radOf(b, s.nodePos));
  r = Math.max(r, conicRad(b, s.current), conicRad(b, s.planned));
  if (!Number.isFinite(r) || r <= 0) r = Math.max(1e3, surface * 2.5);
  return r * 2.36;
}

function conicRad(b: Basis, c: MapConic | null | undefined): number {
  if (c === null || c === undefined) return 0;
  let r = radOf(b, c.periapsis);
  if (!c.bound) return r;
  r = Math.max(r, radOf(b, c.apoapsis));
  const p = c.points, n = p === null || p === undefined ? 0 : (p.length / 3) | 0;
  for (let i = 0; i < n * 3; i += 3) r = Math.max(r, rad3(b, p[i], p[i + 1], p[i + 2]));
  return r;
}

/** In-plane distance from the body centre. The view is orthographic down the
 *  orbit normal, so this IS the on-screen radius, not an estimate. */
function rad3(b: Basis, x: number, y: number, z: number): number {
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return 0;
  return Math.hypot(x * b.u[0] + y * b.u[1] + z * b.u[2],
                    x * b.v[0] + y * b.v[1] + z * b.v[2]);
}

function radOf(b: Basis, p: V3 | null | undefined): number {
  return p === null || p === undefined ? 0 : rad3(b, p[0], p[1], p[2]);
}

/** The two in-plane axes, normalised. A zero or NaN vector here would NaN every
 *  pixel and draw a silent blank, so it falls back to world x/y. */
function basis(s: MapScene): Basis {
  return { u: unit(s.planeU, [1, 0, 0]), v: unit(s.planeV, [0, 1, 0]) };
}

function unit(a: V3 | null | undefined, fallback: V3): V3 {
  if (a === null || a === undefined) return fallback;
  const l = Math.hypot(a[0], a[1], a[2]);
  if (!Number.isFinite(l) || l < 1e-12) return fallback;
  return [a[0] / l, a[1] / l, a[2] / l];
}

/** THE projection: metres to CSS pixels. u right, v up, screen y down so v is
 *  negated. False means non-finite: skip it, never paint a line to nowhere. */
function toPx(pr: Proj, x: number, y: number, z: number, out: XY): boolean {
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return false;
  out.x = pr.cx + pr.m2p * (x * pr.u[0] + y * pr.u[1] + z * pr.u[2]);
  out.y = pr.cy - pr.m2p * (x * pr.v[0] + y * pr.v[1] + z * pr.v[2]);
  return Number.isFinite(out.x) && Number.isFinite(out.y);
}

function toPxV(pr: Proj, p: V3 | null | undefined, out: XY): boolean {
  return p !== null && p !== undefined && toPx(pr, p[0], p[1], p[2], out);
}

/** The body, then the air over it. "Is my periapsis inside the air" is the
 *  question the player is asking, and a ring answers it faster than a number.
 *  The air is ONE path, outer rim then inner rim reversed and filled as an
 *  annulus, so the wash never lands on the body and tints it. */
function paintBody(ctx: CanvasRenderingContext2D, pr: Proj, s: MapScene,
                   marks: string[], taken: Rect[], w: number, h: number): void {
  const r = Math.max(0, nm(s.bodyRadiusM)) * pr.m2p;
  const air = Math.max(0, nm(s.atmosphereCeilingM)) * pr.m2p;
  if (!(r > 0)) return;
  ctx.beginPath(); ctx.arc(pr.cx, pr.cy, r, 0, TAU);
  ctx.fillStyle = SURFACE; ctx.fill();
  pen(ctx, 1, RIM);
  marks.push('body');
  if (!(air > 0.5)) return;
  ctx.beginPath(); ctx.arc(pr.cx, pr.cy, r + air, 0, TAU);
  ctx.arc(pr.cx, pr.cy, r, 0, TAU, true);
  ctx.fillStyle = AIR; ctx.fill();
  ctx.beginPath(); ctx.arc(pr.cx, pr.cy, r + air, 0, TAU);
  ctx.setLineDash([4, 4]); pen(ctx, 1, AIR_EDGE); ctx.setLineDash([]);
  marks.push('air');
  // A number only when the band is thick enough to point at something and its
  // top is on screen. 4 px, found by rendering: a 13 px gate read as reasonable
  // and never once fired, an atmosphere being ~10 px wide at a low-orbit span.
  const ly = pr.cy - r - air - 8;
  if (air < 4 || ly < 9 || ly > h - 9 || pr.cx < 34 || pr.cx > w - 34) return;
  text(ctx, `${km1(s.atmosphereCeilingM)} km`, pr.cx, ly, 10, AIR_EDGE);
  taken.push({ x: pr.cx - 36, y: ly - 7, w: 72, h: 14 });
}

/** One trajectory. A segment with nothing inside a box a screenful bigger than
 *  the canvas is rejected and the survivors trimmed to it: an unbound conic's
 *  last samples land millions of pixels out, and past about 2^24 the rasteriser
 *  is visibly wrong. ctx.clip() costs a state push a frame; this costs four
 *  compares. Returns points plotted. */
function strokeConic(ctx: CanvasRenderingContext2D, pr: Proj,
                     c: MapConic | null | undefined, w: number, h: number,
                     colour: string, dashed: boolean, t: Tally): number {
  if (c === null || c === undefined) return 0;
  const p = c.points, n = p === null || p === undefined ? 0 : (p.length / 3) | 0;
  if (n === 0) return 0;
  LO.x = -w; LO.y = -h; HI.x = 2 * w; HI.y = 2 * h;
  let plotted = 0, have = false, lx = NaN, ly = NaN;
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const k = i * 3;
    if (!toPx(pr, p[k], p[k + 1], p[k + 2], B)) { t.skipped++; have = false; continue; }
    plotted++;
    // ONE subpath while the line stays contiguous: the dash phase restarts at
    // every moveTo, so a subpath per segment drew the dashed planned conic
    // SOLID, each segment being shorter than one dash. Found by rendering.
    if (have && clip(A, B)) {
      if (C0.x !== lx || C0.y !== ly) ctx.moveTo(C0.x, C0.y);
      ctx.lineTo(C1.x, C1.y); lx = C1.x; ly = C1.y;
    }
    A.x = B.x; A.y = B.y; have = true;
  }
  ctx.setLineDash(dashed ? [7, 5] : []);
  pen(ctx, 1.5, colour);
  ctx.setLineDash([]);
  return plotted; // the count taken inside the pass, not a second opinion
}

/** Liang-Barsky against LO..HI, trimmed ends into C0/C1. Per-axis clamping is
 *  shorter and wrong: it bends the part of the line that crosses the screen. */
function clip(a: XY, b: XY): boolean {
  const dx = b.x - a.x, dy = b.y - a.y;
  P[0] = -dx; P[1] = dx; P[2] = -dy; P[3] = dy;
  Q[0] = a.x - LO.x; Q[1] = HI.x - a.x; Q[2] = a.y - LO.y; Q[3] = HI.y - a.y;
  let t0 = 0, t1 = 1;
  for (let i = 0; i < 4; i++) {
    if (P[i] === 0) { if (Q[i] < 0) return false; continue; }
    const r = Q[i] / P[i];
    if (P[i] < 0) { if (r > t1) return false; if (r > t0) t0 = r; }
    else { if (r < t0) return false; if (r < t1) t1 = r; }
  }
  C0.x = a.x + t0 * dx; C0.y = a.y + t0 * dy;
  C1.x = a.x + t1 * dx; C1.y = a.y + t1 * dy;
  return true;
}

/** Every apsis ring's footprint, reserved before ANY label lays out: a label
 *  moves and a ring cannot, so the ring wins. Doing it per conic instead
 *  drove the current AP's label through the planned AP's ring, in the one scene
 *  the map exists for. Found by rendering. */
function reserve(pr: Proj, c: MapConic | null, taken: Rect[]): void {
  if (c === null || c === undefined) return;
  const at = c.bound ? [c.apoapsis, c.periapsis] : [c.periapsis];
  for (const p of at) {
    if (toPxV(pr, p, B)) taken.push({ x: B.x - 8, y: B.y - 8, w: 16, h: 16 });
  }
}

/** Both apsides of one conic. `bound` suppresses the APOAPSIS only, and that
 *  distinction is load-bearing: an unbound trajectory has a perfectly real
 *  periapsis, and "does my re-entry clip the atmosphere" is exactly the
 *  question the air ring is drawn to answer. A time of -1 means no such event,
 *  which is the honest gate for both. */
function apsides(ctx: CanvasRenderingContext2D, pr: Proj,
                 c: MapConic | null | undefined, plan: boolean, colour: string,
                 marks: string[], taken: Rect[], w: number, h: number): void {
  if (c === null || c === undefined) return;
  const q = plan ? "'" : '', sfx = plan ? '-plan' : '';
  if (c.bound && c.timeToApoapsisS >= 0 && apsis(ctx, pr, c.apoapsis, `AP${q}`,
    c.apoapsisAltM, c.timeToApoapsisS, colour, taken, w, h)) marks.push(`ap${sfx}`);
  if (c.timeToPeriapsisS >= 0 && apsis(ctx, pr, c.periapsis, `PE${q}`,
    c.periapsisAltM, c.timeToPeriapsisS, colour, taken, w, h)) marks.push(`pe${sfx}`);
}

/** One apsis: a ring on the conic, a leader, and two lines of text. Radially
 *  outward from the body centre is the one nudge direction always sane on a
 *  conic: the body is the other way, so a label never lands on the surface, and
 *  it is what pulls an AP and a PE apart when they are a few pixels apart. */
function apsis(ctx: CanvasRenderingContext2D, pr: Proj, at: V3 | null,
               name: string, altM: number, tS: number, colour: string,
               taken: Rect[], w: number, h: number): boolean {
  if (!toPxV(pr, at, B)) return false;
  if (B.x < -40 || B.x > w + 40 || B.y < -40 || B.y > h + 40) return false;
  const p: XY = { x: B.x, y: B.y };
  let ux = p.x - pr.cx, uy = p.y - pr.cy;
  const l = Math.hypot(ux, uy);
  if (l < 1e-3) { ux = 0; uy = -1; } else { ux /= l; uy /= l; }
  ctx.beginPath(); ctx.arc(p.x, p.y, 4.5, 0, TAU);
  pen(ctx, 3.2, SHADE); pen(ctx, 1.4, colour);
  place(ctx, p, ux, uy, [`${name} ${km1(altM)} km`, `T-${clock(tS)}`], colour,
        taken, w, h);
  return true;
}

/** A block of text at the end of a leader, stepped out until it stops landing on
 *  something already placed: without the step a nearly circular orbit stacks AP
 *  over PE and the player reads a third number that is neither. The box is
 *  measured from the character count, not measureText: monospace, so exact. */
function place(ctx: CanvasRenderingContext2D, at: XY, ux: number, uy: number,
               lines: string[], colour: string, taken: Rect[],
               w: number, h: number): void {
  const lh = 12;
  let wide = 0; // measured in characters: the font is monospace
  for (const s of lines) wide = Math.max(wide, s.length);
  const bw = 9 + 6.3 * wide, bh = lh * lines.length;
  const r: Rect = { x: 0, y: 0, w: bw, h: bh };
  // `d` runs to the box CENTRE, so the first step clears the marker by the box's
  // half-extent IN THAT DIRECTION, not half its height. Found by rendering at 4x:
  // a fixed offset, then a half-height one, both stamped the ring through a label
  // lying sideways, a two-line label being six times wider than it is tall.
  const sup = Math.abs(ux) * bw / 2 + Math.abs(uy) * bh / 2;
  for (let i = 0; i < 8; i++) {
    const d = sup + 13 + i * (bh + 5);
    r.x = span(at.x + ux * d - bw / 2, w - bw - 3);
    r.y = span(at.y + uy * d - bh / 2, h - bh - 3);
    if (!hits(r, taken)) break;
  }
  taken.push(r);
  const mx = r.x + bw / 2, my = r.y + bh / 2;
  // Leave along the direction the leader actually travels: stepping out along
  // the radial instead let a clamped label pull the line back through its own
  // ring, which reads as a struck-out marker. Found by rendering at 3x.
  const dx = mx - at.x, dy = my - at.y, dl = Math.hypot(dx, dy) || 1;
  ctx.beginPath();
  ctx.moveTo(at.x + dx / dl * 7, at.y + dy / dl * 7); ctx.lineTo(mx, my);
  pen(ctx, 2.6, SHADE); pen(ctx, 0.9, colour);
  for (let i = 0; i < lines.length; i++) {
    text(ctx, lines[i], mx, r.y + lh / 2 + i * lh, i === 0 ? 11 : 10,
         i === 0 ? colour : DIM);
  }
}

function hits(r: Rect, taken: readonly Rect[]): boolean {
  return taken.some((o) => r.x < o.x + o.w && o.x < r.x + r.w
    && r.y < o.y + o.h && o.y < r.y + r.h);
}

/** A filled hub with three arms: never mistakable for an apsis ring. */
function nodeGlyph(ctx: CanvasRenderingContext2D, p: XY): void {
  ctx.beginPath();
  for (let i = 0; i < 3; i++) {
    const a = -Math.PI / 2 + (i * TAU) / 3;
    ctx.moveTo(p.x + Math.cos(a) * 4.5, p.y + Math.sin(a) * 4.5);
    ctx.lineTo(p.x + Math.cos(a) * 12, p.y + Math.sin(a) * 12);
  }
  pen(ctx, 3.4, SHADE); pen(ctx, 1.6, ACCENT);
  ctx.beginPath(); ctx.arc(p.x, p.y, 3.8, 0, TAU);
  ctx.fillStyle = ACCENT; ctx.fill();
  pen(ctx, 1, SHADE);
}

/** The vessel: brightest on the canvas, outlined so it reads over the body. */
function shipGlyph(ctx: CanvasRenderingContext2D, p: XY): void {
  ctx.beginPath(); ctx.moveTo(p.x, p.y - 6.5); ctx.lineTo(p.x + 4.8, p.y);
  ctx.lineTo(p.x, p.y + 6.5); ctx.lineTo(p.x - 4.8, p.y);
  ctx.closePath();
  ctx.fillStyle = '#ffffff'; ctx.fill();
  pen(ctx, 1.2, '#080b0e');
}

/** A bar of a round number of kilometres: the 1/2/5 step nearest 130 px. */
function scaleBar(ctx: CanvasRenderingContext2D, pr: Proj,
                  w: number, h: number): boolean {
  const want = 130 / (pr.m2p * 1000);
  if (!Number.isFinite(want) || want <= 0) return false;
  const e = Math.pow(10, Math.floor(Math.log10(want))), m = want / e;
  const km = (m >= 5 ? 5 : m >= 2 ? 2 : 1) * e, len = km * 1000 * pr.m2p;
  if (!(len > 8) || len > w - 34) return false;
  const x = 16, y = h - 17;
  ctx.beginPath(); ctx.moveTo(x, y - 4); ctx.lineTo(x, y + 4);
  ctx.moveTo(x, y); ctx.lineTo(x + len, y);
  ctx.moveTo(x + len, y - 4); ctx.lineTo(x + len, y + 4);
  pen(ctx, 3, SHADE); pen(ctx, 1.2, DIM);
  const n = km >= 1 ? km.toFixed(0) : km.toFixed(km >= 0.1 ? 1 : 2);
  text(ctx, `${n} km`, x + len / 2, y - 11, 10, INK);
  return true;
}

/** Stroke the path once. Every glyph goes through it twice, a dark backing pass
 *  then the colour: a one pixel amber line over a lit body is not a marker. */
function pen(ctx: CanvasRenderingContext2D, width: number, colour: string): void {
  ctx.lineWidth = width; ctx.strokeStyle = colour; ctx.stroke();
}

function text(ctx: CanvasRenderingContext2D, str: string, x: number, y: number,
              px: number, colour: string, align: CanvasTextAlign = 'center'): void {
  ctx.font = `600 ${px}px ui-monospace, "Cascadia Mono", Consolas, monospace`;
  ctx.textAlign = align; ctx.textBaseline = 'middle';
  ctx.lineWidth = 3; ctx.lineJoin = 'round';
  ctx.strokeStyle = SHADE; ctx.strokeText(str, x, y);
  ctx.fillStyle = colour; ctx.fillText(str, x, y);
}

/** Keep a label box on the canvas, 3 px in. On a canvas narrower than the box
 *  the left edge wins: a clipped tail reads, a box off the left does not. */
function span(v: number, hi: number): number {
  return hi < 3 ? 3 : Math.max(3, Math.min(hi, v));
}

/** A missing number reads as zero, never as NaN and never as a blank. */
function nm(v: number): number { return Number.isFinite(v) ? v : 0; }
function km1(m: number): string { return (nm(m) / 1000).toFixed(1); }
function p2(n: number): string { return n < 10 ? `0${n}` : `${n}`; }

/** MM:SS, and HH:MM:SS once there is an hour to show. */
function clock(sec: number): string {
  const t = Math.max(0, Math.floor(nm(sec))), m = Math.floor(t / 60);
  return m < 60 ? `${p2(m)}:${p2(t % 60)}`
    : `${p2(Math.floor(m / 60))}:${p2(m % 60)}:${p2(t % 60)}`;
}
