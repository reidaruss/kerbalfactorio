// =============================================================================
// MapPaint.ts - the map's shared paint kit: the projection, the palette, the
// typography, the label avoider, and the two pure predicates the zoom continuum
// rests on. Pure: no DOM ownership, no state beyond scratch vectors, no three.js
// (check-limits enforces the last one for all of src/ui).
//
// WHY THIS FILE EXISTS. MapDraw owns the body, the conics and the apsides;
// MapLayers owns the discovered ground, the ore and the glyphs. Both must
// project through THE SAME function and lay their labels out with THE SAME
// avoider, or the map grows a second opinion about where a metre lands and a
// second opinion about where a label goes. This file is the one copy.
// `toPx` moved here out of MapDraw for exactly that reason: the alternative was
// MapLayers importing MapDraw while MapDraw imports MapLayers, and an import
// cycle is a worse way to say "one projection" than a leaf module is.
//
// COLOURS are module constants copied by value out of the game.css --of-*
// palette, as NavballDraw does: it keeps the painters pure functions of their
// arguments, so a probe drawing offscreen gets the panel's pixels.
//
// NO ZOOM THRESHOLD LIVES HERE AND NONE MAY BE ADDED (DW-36). `sizeAlpha` is
// the only scale-dependent thing in the whole map and it is continuous and
// monotone by construction; `discCoversCanvas` is not a zoom mode but a
// geometric fact about one frame, and its two branches paint the same pixels.
// =============================================================================

import type { V3 } from './MapTypes.js';

export const TAU = Math.PI * 2;
export const INK = '#dfe8ef', DIM = '#8b9aa6', ACCENT = '#ff9a3c';
// TRACK is the current conic: cool and bright, so it wins over the body.
export const SHADE = 'rgba(6, 9, 12, 0.78)', TRACK = '#b6dcf7';
export const SURFACE = '#2c3740', RIM = '#5b6b77';
export const AIR = 'rgba(84, 154, 214, 0.17)';
export const AIR_EDGE = 'rgba(146, 200, 242, 0.62)';
/** Ground that has been SEEN. Lighter than SURFACE, because the map paints
 *  KNOWLEDGE onto a dark world rather than painting a shroud over a lit one:
 *  there is then no shroud to get wrong and no hole for it to leak through. */
export const KNOWN = '#3e5164';

export interface XY { x: number; y: number }
export interface Rect { x: number; y: number; w: number; h: number }
/** Points the projection REFUSED. A refused point leaves no trace on the
 *  canvas, so it is counted rather than dropped. */
export interface Tally { skipped: number }

/** The projection's whole state. `ox/oy/oz` is MapScene.centreM, already made
 *  finite: THE ORIGIN IS A PARAMETER (DW-36), and it is absorbed here and in
 *  `toPx` and nowhere else. Every circle, polyline, glyph and label in this
 *  family of files goes through the one function below. */
export interface Proj {
  cx: number; cy: number; m2p: number; u: V3; v: V3;
  ox: number; oy: number; oz: number;
}

export function xy(): XY { return { x: 0, y: 0 }; }

/** THE projection: metres to CSS pixels. The origin is subtracted first, then u
 *  right and v up with screen y down so v is negated. False means non-finite:
 *  skip it, never paint a line to nowhere. */
export function toPx(pr: Proj, x: number, y: number, z: number,
                     out: XY): boolean {
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return false;
  const dx = x - pr.ox, dy = y - pr.oy, dz = z - pr.oz;
  out.x = pr.cx + pr.m2p * (dx * pr.u[0] + dy * pr.u[1] + dz * pr.u[2]);
  out.y = pr.cy - pr.m2p * (dx * pr.v[0] + dy * pr.v[1] + dz * pr.v[2]);
  return Number.isFinite(out.x) && Number.isFinite(out.y);
}

export function toPxV(pr: Proj, p: V3 | null | undefined, out: XY): boolean {
  return p !== null && p !== undefined && toPx(pr, p[0], p[1], p[2], out);
}

/**
 * How opaque a feature `sizeM` metres across is at `m2p` pixels per metre. ONE
 * function for every scale-dependent layer in the map. A layer is never
 * switched on at a span; a FEATURE becomes legible as its own size in pixels
 * grows, which is why this takes the feature's size and not the view's.
 *
 * Continuous and monotone non-decreasing in `m2p` by construction: pixel size
 * is linear in `m2p` and smoothstep is monotone on [0,1]. A probe sweeps the
 * zoom over many decades and asserts exactly that off `MapDrawReport.alphas`,
 * so a branch that is not expressible through this function fails the build.
 */
export function sizeAlpha(sizeM: number, m2p: number, minPx: number,
                          fullPx: number): number {
  if (!(Number.isFinite(sizeM) && sizeM > 0)) return 0;
  if (!(Number.isFinite(m2p) && m2p > 0)) return 0;
  const lo = Math.max(0, minPx);
  // A degenerate ramp (full <= min) must still be monotone, so it collapses to
  // the steepest legal one rather than dividing by zero and returning NaN.
  const hi = Math.max(lo + 1e-9, fullPx);
  const px = sizeM * m2p;
  // Ordered so that an overflow to +Infinity lands on 1, which is where
  // monotonicity says it belongs, rather than on a non-finite rejection.
  if (px >= hi) return 1;
  if (px <= lo) return 0;
  const t = (px - lo) / (hi - lo);
  return t * t * (3 - 2 * t);
}

/**
 * True when a disc of `rPx` at (cx,cy) provably covers every corner of a
 * cssW x cssH canvas, so filling the canvas and stroking the arc produce the
 * SAME pixels. Not a zoom mode: it is a geometric fact about this frame.
 *
 * It exists because centring on the player at a 500 m span puts the body's
 * projected radius near 1e9 px, and Canvas 2D is visibly wrong past about 2^24
 * (the conic clipper says the same about polylines). The alternative would be a
 * span threshold, which is the one thing DW-36 forbids.
 */
export function discCoversCanvas(cx: number, cy: number, rPx: number,
                                 w: number, h: number): boolean {
  if (!Number.isFinite(cx) || !Number.isFinite(cy)) return false;
  if (!(rPx > 0)) return false;
  const dx = Math.max(Math.abs(cx), Math.abs(cx - w));
  const dy = Math.max(Math.abs(cy), Math.abs(cy - h));
  return rPx >= Math.hypot(dx, dy);
}

/** Stroke the path once. Every glyph goes through it twice, a dark backing pass
 *  then the colour: a one pixel amber line over a lit body is not a marker. */
export function pen(ctx: CanvasRenderingContext2D, width: number,
                    colour: string): void {
  ctx.lineWidth = width; ctx.strokeStyle = colour; ctx.stroke();
}

export function text(ctx: CanvasRenderingContext2D, str: string, x: number,
                     y: number, px: number, colour: string,
                     align: CanvasTextAlign = 'center'): void {
  ctx.font = `600 ${px}px ui-monospace, "Cascadia Mono", Consolas, monospace`;
  ctx.textAlign = align; ctx.textBaseline = 'middle';
  ctx.lineWidth = 3; ctx.lineJoin = 'round';
  ctx.strokeStyle = SHADE; ctx.strokeText(str, x, y);
  ctx.fillStyle = colour; ctx.fillText(str, x, y);
}

/** A block of text at the end of a leader, stepped out until it stops landing on
 *  something already placed: without the step a nearly circular orbit stacks AP
 *  over PE and the player reads a third number that is neither. The box is
 *  measured from the character count, not measureText: monospace, so exact.
 *  ONE avoider for the whole map, shared with the ore labels, because two label
 *  layouts on one canvas cannot see each other's boxes. */
export function place(ctx: CanvasRenderingContext2D, at: XY, ux: number,
                      uy: number, lines: string[], colour: string,
                      taken: Rect[], w: number, h: number): void {
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

export function hits(r: Rect, taken: readonly Rect[]): boolean {
  return taken.some((o) => r.x < o.x + o.w && o.x < r.x + r.w
    && r.y < o.y + o.h && o.y < r.y + r.h);
}

/** Keep a label box on the canvas, 3 px in. On a canvas narrower than the box
 *  the left edge wins: a clipped tail reads, a box off the left does not. */
export function span(v: number, hi: number): number {
  return hi < 3 ? 3 : Math.max(3, Math.min(hi, v));
}

/** A missing number reads as zero, never as NaN and never as a blank. */
export function nm(v: number): number { return Number.isFinite(v) ? v : 0; }
export function km1(m: number): string { return (nm(m) / 1000).toFixed(1); }
export function p2(n: number): string { return n < 10 ? `0${n}` : `${n}`; }

/** MM:SS, and HH:MM:SS once there is an hour to show. */
export function clock(sec: number): string {
  const t = Math.max(0, Math.floor(nm(sec))), m = Math.floor(t / 60);
  return m < 60 ? `${p2(m)}:${p2(t % 60)}`
    : `${p2(Math.floor(m / 60))}:${p2(m % 60)}:${p2(t % 60)}`;
}

/** A count in the smallest number of characters that still reads: 940, 2.4k,
 *  17M. The RAW value goes to `MapDrawReport.oreDrawnRows` in the same pass, so
 *  a probe compares integers against /core's `RemainingAmount` and never parses
 *  this string back into a number. */
export function compact(n: number): string {
  const v = nm(n), a = Math.abs(v);
  if (a < 1000) return `${Math.round(v)}`;
  if (a < 1e6) return `${(v / 1e3).toFixed(a < 1e4 ? 1 : 0)}k`;
  if (a < 1e9) return `${(v / 1e6).toFixed(a < 1e7 ? 1 : 0)}M`;
  return `${(v / 1e9).toFixed(1)}G`;
}

/** A bar of a round number of kilometres: the 1/2/5 step nearest 130 px. */
export function scaleBar(ctx: CanvasRenderingContext2D, pr: Proj,
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
