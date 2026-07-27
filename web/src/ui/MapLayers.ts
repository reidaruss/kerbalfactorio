// =============================================================================
// MapLayers.ts - the map's ground layers and its glyphs: THE TERRAIN, the ore
// markers, the player, the vessel, the node. Pure functions, no three.js
// (check-limits enforces that for all of src/ui) and no state beyond one
// scratch canvas the terrain image is written into.
//
// THE GROUND LAYER CHANGED SHAPE (DW-37). It used to be `strokeDiscovered`:
// one path per discovered 9,375 m cell, four projected corners each, filled
// flat. Those quads were the right answer to "what have you seen" and no answer
// at all to "what is there", which is why the map read as an empty grey plane.
// It is now ONE ImageData at the sampled grid's resolution, blitted scaled -
// one composite instead of thousands of paths, and it carries the biome, the
// relief and the survey mask together.
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

import type { MapScene } from './MapTypes.js';
import type { Proj, Rect, XY } from './MapPaint.js';
import {
  ACCENT, BIOME_RGB, INK, SHADE, SURFACE_RGB, TAU, compact,
  discCoversCanvas, nm, pen, place, terrainShade, toPx, xy,
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

const M = xy();

/** The image the terrain grid is written into before it is blitted, and the
 *  only state in this file. A SCRATCH BUFFER, not owned DOM: it is never
 *  attached to the document and never read by anything else, exactly like the
 *  scratch vectors above. It is kept because a canvas per frame is an
 *  allocation per frame; it is re-cut only when the grid's shape changes. */
let IMG: HTMLCanvasElement | null = null;
let IMG_W = 0, IMG_H = 0;
/** What is currently STAMPED on that canvas: the exact grid object and the mode
 *  flag it was shaded under. The grid is immutable and MapTerrain hands back the
 *  identical object on a cache hit, so an identity compare is sound and exact -
 *  a `===` on the buffer the pixels came from, not a guess about whether it
 *  changed. A repaint that changed neither costs one drawImage. */
let IMG_SRC: object | null = null;
let IMG_REVEAL = false;
let IMG_DRAWN = 0;

/**
 * THE GROUND (DW-37). One `ImageData` at the grid's own resolution, blitted
 * scaled to the view with smoothing on: ONE composite rather than thousands of
 * paths, which is what makes a per-pixel-ish terrain layer cheaper than the
 * 9,375 m discovery quads it replaces.
 *
 * The grid covers EXACTLY the view by construction (`MapTerrain.sample` cuts it
 * to the canvas), so the blit is the whole canvas and no projection happens
 * here — `toPx` would be projecting a rectangle onto itself.
 *
 * WHAT IS DRAWN IS THE ONE GATE, and it is this line: a sample is painted when
 * it has ground under it AND (`revealAll` OR its survey cell has been seen).
 * Undiscovered ground is ABSENT rather than covered, so there is no shroud to
 * get wrong and no hole for it to leak through — the same rule `MapWorld.ore()`
 * applies to patches, applied to pixels.
 *
 * An unpainted sample still carries SURFACE's colour at zero alpha, so the
 * scaled blit's interpolation fades into exactly the body fill underneath it
 * rather than into a black fringe.
 *
 * Returns the samples actually painted.
 */
export function paintTerrain(ctx: CanvasRenderingContext2D, pr: Proj,
                             s: MapScene, alpha: number, w: number,
                             h: number, marks: string[]): number {
  const g = s.discovered;
  if (g === null || g === undefined || !(alpha > 0)) return 0;
  const cols = g.cols | 0, rows = g.rows | 0;
  if (cols <= 0 || rows <= 0 || g.biome.length < cols * rows) return 0;
  const reveal = s.revealAll === true;
  if (IMG_SRC === g && IMG_REVEAL === reveal && IMG !== null) {
    blit(ctx, pr, s, alpha, w, h);          // already stamped: just composite it
    if (IMG_DRAWN > 0) marks.push('terrain');
    marks.push(`terrain:${IMG_DRAWN}/${g.onBody}`);
    return IMG_DRAWN;
  }
  const im = image(cols, rows);
  if (im === null) return 0;
  const px = im.data;
  // The view's own relief, for the elevation ramp.
  const span = g.maxH - g.minH > 1e-6 ? g.maxH - g.minH : 1;
  const H = g.heightM, at = (x: number, y: number) =>
    H[Math.max(0, Math.min(rows - 1, y)) * cols + Math.max(0, Math.min(cols - 1, x))];
  const gx = (x: number, y: number) => at(x + 1, y) - at(x - 1, y);
  const gy = (x: number, y: number) => at(x, y + 1) - at(x, y - 1);
  // AND THE VIEW'S OWN TYPICAL SLOPE, for the hillshade. One extra pass over a
  // grid of a couple of thousand samples, and it is what makes the shading
  // scale-free: see `terrainShade`, where the first attempt normalised by the
  // relief instead and produced a blank picture at every zoom.
  let sum = 0, n = 0;
  for (let i = 0; i < cols * rows; i++) {
    if (g.biome[i] < 0) continue;
    const x = i % cols, y = (i / cols) | 0;
    sum += Math.hypot(gx(x, y), gy(x, y)); n++;
  }
  const mean = n > 0 ? sum / n : 0;
  // A typical slope lights at 0.8, which is the contrast a shaded relief map
  // reads best at. A perfectly flat view scales by 0 and shades uniformly,
  // which is what a flat view should look like.
  const gk = mean > 1e-9 ? 0.8 / mean : 0;
  let drawn = 0;
  for (let i = 0; i < cols * rows; i++) {
    const b = g.biome[i], k = i * 4;
    const show = b >= 0 && (reveal || g.seen[i] !== 0);
    if (!show) {
      px[k] = SURFACE_RGB[0]; px[k + 1] = SURFACE_RGB[1];
      px[k + 2] = SURFACE_RGB[2]; px[k + 3] = 0;
      continue;
    }
    const c = BIOME_RGB[b < BIOME_RGB.length ? b : 0];
    const x = i % cols, y = (i / cols) | 0;
    // Clamped at the edges rather than wrapped: the neighbour of an edge sample
    // is itself, so the border shades flat instead of reading the far side of
    // the image, which would draw a cliff along every edge of the panel.
    const f = terrainShade((H[i] - g.minH) / span, gx(x, y) * gk, gy(x, y) * gk);
    px[k] = clamp255(c[0] * f); px[k + 1] = clamp255(c[1] * f);
    px[k + 2] = clamp255(c[2] * f); px[k + 3] = 255;
    drawn++;
  }
  stamp(im);
  IMG_SRC = g; IMG_REVEAL = reveal; IMG_DRAWN = drawn;
  blit(ctx, pr, s, alpha, w, h);
  if (drawn > 0) marks.push('terrain');
  // Receipts, not decoration (DW-28). "How much of this view is world at all"
  // and "how much of that world have you seen" are different questions and a
  // reader who conflated them would misread an orbital frame as a hidden one.
  marks.push(`terrain:${drawn}/${g.onBody}`);
  return drawn;
}

/** The scratch canvas at the grid's resolution, re-cut only when it changes.
 *  Re-cutting DROPS the stamp, because a resized canvas is blank. */
function image(cols: number, rows: number): ImageData | null {
  if (IMG === null) IMG = document.createElement('canvas');
  if (IMG_W !== cols || IMG_H !== rows) {
    IMG.width = cols; IMG.height = rows; IMG_W = cols; IMG_H = rows;
    IMG_SRC = null;
  }
  const c = IMG.getContext('2d');
  return c === null ? null : c.createImageData(cols, rows);
}

/** Put the pixels on the scratch canvas. Separate from `blit` so a repaint that
 *  changed nothing skips the shading pass AND this, and composites only. */
function stamp(im: ImageData): void {
  const c = IMG === null ? null : IMG.getContext('2d');
  if (c !== null) c.putImageData(im, 0, 0);
}

/** Put the image back and stretch it over the canvas. CLIPPED TO THE BODY
 *  unless the body provably covers every corner (MapPaint.discCoversCanvas, the
 *  same fact `paintBody` uses and for the same reason): without the clip the
 *  blit's interpolation spills half a sample of ground past the limb, and with
 *  it at a 500 m span the arc radius is ~1e9 px, which Canvas 2D draws wrong. */
function blit(ctx: CanvasRenderingContext2D, pr: Proj, s: MapScene,
              alpha: number, w: number, h: number): void {
  const cv = IMG;
  if (cv === null) return;
  const bc = xy();
  const onBody = toPx(pr, 0, 0, 0, bc);
  const r = Math.max(0, nm(s.bodyRadiusM)) * pr.m2p;
  ctx.save();
  ctx.globalAlpha = alpha;
  if (onBody && r > 0 && !discCoversCanvas(bc.x, bc.y, r, w, h)) {
    ctx.beginPath(); ctx.arc(bc.x, bc.y, r, 0, TAU); ctx.clip();
  }
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(cv, 0, 0, cv.width, cv.height, 0, 0, w, h);
  ctx.restore();
}

function clamp255(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : v | 0;
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
