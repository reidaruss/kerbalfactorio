// =============================================================================
// MapLayers.ts - the map's ground layers and its glyphs: the discovered world,
// the ore markers, the player, the vessel, the node. Pure functions, no DOM, no
// state, no three.js (check-limits enforces the last one for all of src/ui).
//
// Everything here projects through MapPaint's `toPx` and lays its labels out
// with MapPaint's `place`, so a marker never works out its own screen position.
// That is the bug this project keeps paying for: a marker that computes its own
// pixels agrees with the trajectory until the fit changes, then lies quietly.
//
// SCALE IS CARRIED BY ONE RAMP AND NOTHING ELSE. No function here reads
// `spanM`, and none may. Each layer is handed the alpha `sizeAlpha` produced
// from ITS OWN feature size, and paints at it (DW-36).
// =============================================================================

import type { MapScene, V3 } from './MapTypes.js';
import type { Proj, Rect, Tally, XY } from './MapPaint.js';
import {
  ACCENT, INK, KNOWN, SHADE, TAU, compact, nm, pen, place, toPx, xy,
} from './MapPaint.js';

/** The raw numbers one ore marker drew, straight out of MapOre. Integers, not
 *  the formatted label: a probe compares these against /core's
 *  `OrePatch::RemainingAmount` field by field, the way the power panel was
 *  proven, rather than parsing "2.4k" back into a number. */
export interface OreRow {
  resource: number; remaining: number; initial: number;
}

/** Below this a patch marker would be a single stippled pixel and could not be
 *  aimed at. The disc stops shrinking; the ALPHA keeps ramping, so a marker
 *  pinned at its floor still fades instead of popping in at full strength. */
const ORE_MIN_R_PX = 2.5;
const ORE_LEAN = [124, 98, 60], ORE_RICH = [255, 198, 98];

const Q = [xy(), xy(), xy(), xy()];
const M = xy();

/** The view direction, u x v. The projection is orthographic, so a cell on the
 *  FAR side of the body lands on exactly the same pixels as its mirror on the
 *  near side: without this the ground under the antipode paints over the ground
 *  under your feet, and discovered elsewhere reads as discovered here. */
function normal(pr: Proj): V3 {
  const u = pr.u, v = pr.v;
  return [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2],
          u[0] * v[1] - u[1] * v[0]];
}

/**
 * The discovered surface: four unit corners per cell, scaled by the body radius
 * and projected through the SAME toPx as everything else, then filled.
 *
 * This paints the KNOWN world. Undiscovered ground is simply not painted, so
 * there is no shroud to get wrong and no way for undrawn ground to leak.
 *
 * ONE path and ONE fill for every cell: adjacent cells share an edge exactly,
 * and a fill per cell would seam along every one of them once alpha is below 1,
 * as well as costing a composite each. Returns the quads actually filled.
 */
export function strokeDiscovered(ctx: CanvasRenderingContext2D, pr: Proj,
                                 s: MapScene, alpha: number, w: number,
                                 h: number, marks: string[],
                                 t: Tally): number {
  const d = s.discovered;
  if (d === null || d === undefined || !(alpha > 0)) return 0;
  const c = d.corners;
  if (c === null || c === undefined) return 0;
  const n = Math.min(Math.max(0, d.count | 0), (c.length / 12) | 0);
  if (n === 0) return 0;
  const r = nm(s.bodyRadiusM), nz = normal(pr);
  let quads = 0, back = 0;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = KNOWN;
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const k = i * 12;
    let ok = true, front = false;
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (let j = 0; j < 4; j++) {
      const q = k + j * 3, x = c[q], y = c[q + 1], z = c[q + 2];
      if (x * nz[0] + y * nz[1] + z * nz[2] > 0) front = true;
      if (!toPx(pr, x * r, y * r, z * r, Q[j])) { ok = false; break; }
      x0 = Math.min(x0, Q[j].x); x1 = Math.max(x1, Q[j].x);
      y0 = Math.min(y0, Q[j].y); y1 = Math.max(y1, Q[j].y);
    }
    if (!ok) { t.skipped++; continue; }
    if (!front) { back++; continue; }
    // Nothing inside a box a screenful bigger than the canvas, the conic
    // clipper's own rule and for its own reason: zoomed to a base, a cell on
    // the far limb projects hundreds of millions of pixels out and Canvas 2D is
    // visibly wrong past about 2^24.
    if (x1 < -w || x0 > 2 * w || y1 < -h || y0 > 2 * h) continue;
    ctx.moveTo(Q[0].x, Q[0].y);
    ctx.lineTo(Q[1].x, Q[1].y); ctx.lineTo(Q[2].x, Q[2].y);
    ctx.lineTo(Q[3].x, Q[3].y); ctx.closePath();
    quads++;
  }
  ctx.fill();
  ctx.restore();
  if (quads > 0) marks.push('discovered');
  // Receipts, not decoration. DW-28: a layer that silently drops work when full
  // cannot be found by measuring the thing it degrades, so the window's row cap
  // and the far hemisphere both report themselves.
  if (d.truncated) marks.push('discovered:truncated');
  if (back > 0) marks.push(`discovered:back:${back}`);
  return quads;
}

/** Lean to rich, so a grade reads off the marker without a legend. */
function oreTint(grade: number): string {
  const g = Math.max(0, Math.min(1, nm(grade)));
  const c = [0, 1, 2].map((i) =>
    Math.round(ORE_LEAN[i] + (ORE_RICH[i] - ORE_LEAN[i]) * g));
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}

/**
 * The ore bodies: a filled disc of the patch's real radius, tinted by grade,
 * with its REMAINING count beside it in the apsides' label style, through the
 * apsides' own avoider so the two layouts can see each other's boxes.
 *
 * The array arrives ALREADY GATED by discovery (MapScene.ore). There is exactly
 * one discovery gate and it is upstream, so nothing here asks a second time.
 *
 * `bc` is the body's centre in pixels: labels step outward from it, which is the
 * one nudge direction that never buries a patch's label in the ground.
 * Returns the markers that reached the canvas, and fills `rows` with the raw
 * numbers each one drew.
 */
export function drawOre(ctx: CanvasRenderingContext2D, pr: Proj, s: MapScene,
                        alpha: number, w: number, h: number, taken: Rect[],
                        bc: XY, rows: OreRow[]): number {
  const list = s.ore;
  if (list === null || list === undefined || !(alpha > 0)) return 0;
  let drawn = 0;
  ctx.save();
  ctx.globalAlpha = alpha;
  for (const o of list) {
    if (!toPx(pr, o.centre[0], o.centre[1], o.centre[2], M)) continue;
    if (M.x < -40 || M.x > w + 40 || M.y < -40 || M.y > h + 40) continue;
    const rp = Math.max(ORE_MIN_R_PX, nm(o.radiusM) * pr.m2p);
    if (!Number.isFinite(rp)) continue;
    const tint = oreTint(o.grade);
    ctx.beginPath(); ctx.arc(M.x, M.y, rp, 0, TAU);
    ctx.fillStyle = tint; ctx.fill();
    pen(ctx, 1, SHADE);
    let ux = M.x - bc.x, uy = M.y - bc.y;
    const l = Math.hypot(ux, uy);
    if (l < 1e-3) { ux = 0; uy = -1; } else { ux /= l; uy /= l; }
    const at: XY = { x: M.x, y: M.y };
    place(ctx, at, ux, uy, [o.name, compact(o.remaining)], tint, taken, w, h);
    rows.push({ resource: o.resource, remaining: o.remaining, initial: o.initial });
    drawn++;
  }
  ctx.restore();
  return drawn;
}

/** A filled hub with three arms: never mistakable for an apsis ring. */
export function nodeGlyph(ctx: CanvasRenderingContext2D, p: XY): void {
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
export function shipGlyph(ctx: CanvasRenderingContext2D, p: XY): void {
  ctx.beginPath(); ctx.moveTo(p.x, p.y - 6.5); ctx.lineTo(p.x + 4.8, p.y);
  ctx.lineTo(p.x, p.y + 6.5); ctx.lineTo(p.x - 4.8, p.y);
  ctx.closePath();
  ctx.fillStyle = '#ffffff'; ctx.fill();
  pen(ctx, 1.2, '#080b0e');
}

/** YOU: a dot inside a ring. Deliberately not the vessel's diamond, because on
 *  foot beside a landed craft both glyphs are on screen at once and "which one
 *  am I" is the only question the map is being asked at that moment. */
export function playerGlyph(ctx: CanvasRenderingContext2D, p: XY): void {
  ctx.beginPath(); ctx.arc(p.x, p.y, 7.5, 0, TAU);
  pen(ctx, 3, SHADE); pen(ctx, 1.3, INK);
  ctx.beginPath(); ctx.arc(p.x, p.y, 2.8, 0, TAU);
  ctx.fillStyle = INK; ctx.fill();
  pen(ctx, 1, SHADE);
}
