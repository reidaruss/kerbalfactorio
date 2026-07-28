// =============================================================================
// MapDraw.ts - the map's painter: a MapScene in, pixels out. Pure: no DOM, no
// state, no three.js (check-limits enforces the last one). NavballDraw's
// contract, where the caller owns the element and this file owns the paint.
// The body, the conics and the apsides live here; the ground layers and the
// glyphs live in MapLayers, and both go through MapPaint.
//
// THE PROJECTION LIVES IN ONE PLACE (MapPaint's toPx). Every circle, polyline,
// glyph and label goes through it. A marker that works out its own screen
// position is the bug this project keeps paying for: it agrees with the
// trajectory until the fit changes, then lies quietly.
//
// THE CENTRE IS A PARAMETER (DW-36, physics R17), and it is absorbed by `Proj`
// and `toPx` alone. `paintBody` no longer stamps its arc at the canvas middle;
// it projects the body's centre through toPx like everything else, which is the
// one line that used to make "the origin" and "the planet" the same word.
//
// WHAT IS DRAWN IS A FUNCTION OF SCALE, THROUGH ONE RAMP. There is no `if (span
// < X)` anywhere in this file and none may be added. The four constants below
// are feature sizes in PIXELS, fed to MapPaint's sizeAlpha, and every one of
// them is published in the report so a probe can sweep the zoom and check.
// =============================================================================

import type { MapScene, MapConic, MapDrawReport, MapOre, V3 } from './MapTypes.js';
import type { OreRow } from './MapLayers.js';
import type { Proj, Rect, Tally, XY } from './MapPaint.js';
import {
  ACCENT, AIR, AIR_EDGE, DIM, RIM, SHADE, SURFACE, TAU, TRACK, clock,
  discCoversCanvas, km1, nm, pen, place, scaleBar, sizeAlpha, text, toPx, toPxV, xy,
} from './MapPaint.js';
import {
  drawOre, nodeGlyph, paintTerrain, playerGlyph, shipGlyph, terrainContrast,
} from './MapLayers.js';

// An ore patch is a couple of metres across: it earns its pixels between 1.5 and
// 6 of them, which is where a disc stops being one stippled dot and starts being
// a thing with a count beside it. A TERRAIN SAMPLE keeps the ramp the discovery
// quads had, taken from its own ground size; that size is view-relative by
// construction (the grid is cut to the canvas), so a sample is the same number
// of pixels at every zoom and this ramp sits pinned at its top. That is the
// right answer and it is stated rather than special-cased: the terrain is the
// thing the map is for, and DW-36 forbids switching a layer on at a span, not
// leaving one always on. The body's ramp only ever leaves 1 at interplanetary
// spans, and is here so that a distant world fades rather than popping when
// there is more than one of them.
const ORE_MIN_PX = 1.5, ORE_FULL_PX = 6;
const DISC_MIN_PX = 0.75, DISC_FULL_PX = 3;
const BODY_MIN_PX = 2, BODY_FULL_PX = 12;

interface Basis { u: V3; v: V3 }

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
  ctx.globalAlpha = 1;
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  const b = basis(s), o = origin(s);
  const span = Number.isFinite(s.spanM) && s.spanM > 1e-6 ? s.spanM : fitSpanM(s);
  const pr: Proj = {
    cx: cssW / 2, cy: cssH / 2, m2p: Math.min(cssW, cssH) / span, u: b.u, v: b.v,
    ox: o[0], oy: o[1], oz: o[2],
  };
  const marks: string[] = [], taken: Rect[] = [], t: Tally = { skipped: 0 };
  const rows: OreRow[] = [];
  const alphas = ramp(s, pr.m2p);
  // The body is drawn WHERE IT PROJECTS TO, like everything else.
  const bc = xy(), onBody = toPx(pr, 0, 0, 0, bc);
  if (!onBody) { bc.x = pr.cx; bc.y = pr.cy; }
  const filled = paintBody(ctx, pr, s, alphas.body, marks, taken, cssW, cssH, bc);
  const quads = paintTerrain(ctx, pr, s, alphas.discovered, cssW, cssH, marks);
  const cur = strokeConic(ctx, pr, s.current, cssW, cssH, TRACK, false, t);
  const plan = strokeConic(ctx, pr, s.planned, cssW, cssH, ACCENT, true, t);
  // Ship, player and node reserve footprints BEFORE labels lay out, though their
  // glyphs come last: a label across the ship glyph costs both of them.
  const sp = xy(), np = xy(), pp = xy();
  const hasShip = toPxV(pr, s.shipPos, sp), hasNode = toPxV(pr, s.nodePos, np);
  const hasYou = toPxV(pr, s.playerPos, pp);
  if (hasShip) taken.push({ x: sp.x - 10, y: sp.y - 10, w: 20, h: 20 });
  if (hasNode) taken.push({ x: np.x - 13, y: np.y - 13, w: 26, h: 26 });
  if (hasYou) taken.push({ x: pp.x - 10, y: pp.y - 10, w: 20, h: 20 });
  reserve(pr, s.current, taken);
  reserve(pr, s.planned, taken);
  apsides(ctx, pr, s.current, false, TRACK, marks, taken, cssW, cssH, bc);
  apsides(ctx, pr, s.planned, true, ACCENT, marks, taken, cssW, cssH, bc);
  const ore = drawOre(ctx, pr, s, alphas.ore, cssW, cssH, taken, bc, rows);
  if (ore > 0) marks.push('ore');
  if (hasNode) { nodeGlyph(ctx, np); marks.push('node'); }
  if (hasShip) { shipGlyph(ctx, sp); marks.push('ship'); }
  if (hasYou) { playerGlyph(ctx, pp); marks.push('you'); }
  if (scaleBar(ctx, pr, cssW, cssH)) marks.push('scale');
  caption(ctx, s, cssW, cssH);
  // Not a marker, a receipt: a refused point leaves no trace on the canvas.
  if (t.skipped > 0) marks.push(`skipped:${t.skipped}`);
  const g = s.discovered;
  return {
    currentPoints: cur, plannedPoints: plan, markers: marks, pixelsPerMetre: pr.m2p,
    alphas, discoveredQuads: quads, oreDrawn: ore, oreDrawnRows: rows,
    terrainSamples: g === null || g === undefined ? 0 : g.onBody,
    sampleSizeM: g === null || g === undefined ? 0 : nm(g.sampleSizeM),
    bodyFilled: filled,
    contrast: terrainContrast(),
  };
}

/** Every scale-dependent opacity in the map, in one place, each from its OWN
 *  feature's size. The ore ramp uses the LARGEST patch in the set so that the
 *  number reported is the opacity a marker was actually painted at; patches are
 *  within a factor of a few of each other by construction. */
function ramp(s: MapScene, m2p: number): { ore: number; discovered: number; body: number } {
  let wide = 0;
  const list = s.ore;
  if (list !== null && list !== undefined) {
    for (const p of list) wide = Math.max(wide, 2 * Math.max(0, nm(p.radiusM)));
  }
  const cell = s.discovered === null ? 0 : nm(s.discovered.sampleSizeM);
  return {
    ore: sizeAlpha(wide, m2p, ORE_MIN_PX, ORE_FULL_PX),
    discovered: sizeAlpha(cell, m2p, DISC_MIN_PX, DISC_FULL_PX),
    body: sizeAlpha(2 * nm(s.bodyRadiusM), m2p, BODY_MIN_PX, BODY_FULL_PX),
  };
}

function caption(ctx: CanvasRenderingContext2D, s: MapScene,
                 w: number, h: number): void {
  const f = typeof s.focusName === 'string' && s.focusName.length > 0
    ? `centre: ${s.focusName} · ` : '';
  // THE AXIS COMES FROM THE SCENE, because it rides on the focus now. This line
  // used to say "down the orbit normal" always, and it went on saying it over a
  // plan view of the ground once the centre became a parameter - a caption that
  // states a projection the picture is not using. Found by LOOKING at the
  // screenshot, which is the only way it could have been found.
  const a = typeof s.axisName === 'string' && s.axisName.length > 0
    ? s.axisName : 'down the orbit normal';
  text(ctx, `${f}view: ${a}`, w - 9, h - 11, 10, DIM, 'right');
}

/** The projection origin, made finite once. A NaN here would NaN every pixel
 *  and draw a silent blank, which is the failure this whole file is written
 *  against. [0,0,0] is the old body-centred behaviour exactly. */
function origin(s: MapScene): V3 {
  const c = s.centreM;
  if (c === null || c === undefined) return [0, 0, 0];
  return [nm(c[0]), nm(c[1]), nm(c[2])];
}

/** The span (metres across the short screen axis) that frames a scene with a
 *  sensible margin; the view auto-fits with it, then the player may zoom away.
 *  EVERY radius is measured from `centreM`, not from the body: a fit that
 *  measured from the planet would frame the planet from every origin, which is
 *  R17 restated in the fit.
 *
 *  The body frames the view by the point of its atmosphere shell NEAREST the
 *  centre. At centreM = [0,0,0] that is (R + ceiling) and this function is
 *  identical to the old one to the last digit; from a ship it is the altitude
 *  band under it, and from a player standing on the ground it is ~0, so the
 *  base frames the view instead of the planet. The FAR limb would have been the
 *  planet every time. An UNBOUND conic is still not framed by its own polyline:
 *  a hyperbola's last sample sits arbitrarily far out and fitting to it shrinks
 *  the body to a dot, so body, ship and periapsis frame that one. */
export function fitSpanM(s: MapScene): number {
  const b = basis(s), o = origin(s);
  const shell = Math.max(0, nm(s.bodyRadiusM)) + Math.max(0, nm(s.atmosphereCeilingM));
  let r = Math.abs(rad3(b, o, 0, 0, 0) - shell) * 1.25;
  r = Math.max(r, radOf(b, o, s.shipPos), radOf(b, o, s.nodePos));
  r = Math.max(r, radOf(b, o, s.playerPos), oreRad(b, o, s.ore));
  r = Math.max(r, conicRad(b, o, s.current), conicRad(b, o, s.planned));
  // Nothing framed the view: a player standing still on an airless world with
  // no vessel and no ore. A kilometre is the base's own scale, and at the old
  // origin this is exactly what the old fallback returned.
  if (!Number.isFinite(r) || r <= 0) r = 1e3;
  return r * 2.36;
}

function oreRad(b: Basis, o: V3, list: readonly MapOre[] | null): number {
  if (list === null || list === undefined) return 0;
  let r = 0;
  for (const p of list) {
    r = Math.max(r, radOf(b, o, p.centre) + Math.max(0, nm(p.radiusM)));
  }
  return r;
}

function conicRad(b: Basis, o: V3, c: MapConic | null | undefined): number {
  if (c === null || c === undefined) return 0;
  let r = radOf(b, o, c.periapsis);
  if (!c.bound) return r;
  r = Math.max(r, radOf(b, o, c.apoapsis));
  const p = c.points, n = p === null || p === undefined ? 0 : (p.length / 3) | 0;
  for (let i = 0; i < n * 3; i += 3) {
    r = Math.max(r, rad3(b, o, p[i], p[i + 1], p[i + 2]));
  }
  return r;
}

/** In-plane distance from the PROJECTION ORIGIN. The view is orthographic down
 *  the orbit normal, so this IS the on-screen radius, not an estimate. */
function rad3(b: Basis, o: V3, x: number, y: number, z: number): number {
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return 0;
  const dx = x - o[0], dy = y - o[1], dz = z - o[2];
  return Math.hypot(dx * b.u[0] + dy * b.u[1] + dz * b.u[2],
                    dx * b.v[0] + dy * b.v[1] + dz * b.v[2]);
}

function radOf(b: Basis, o: V3, p: V3 | null | undefined): number {
  return p === null || p === undefined ? 0 : rad3(b, o, p[0], p[1], p[2]);
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

/** The body, then the air over it. Returns whether the disc PROVABLY covered
 *  every canvas corner, in which case the surface colour was flooded instead of
 *  stroked as an arc: centred on the player at a 500 m span the body's radius
 *  is around 1e9 px and Canvas 2D is visibly wrong past 2^24. The two branches
 *  paint the same pixels by construction (MapPaint.discCoversCanvas is the
 *  proof), which is why this is a fact about the frame and not a zoom mode. */
function paintBody(ctx: CanvasRenderingContext2D, pr: Proj, s: MapScene,
                   alpha: number, marks: string[], taken: Rect[], w: number,
                   h: number, bc: XY): boolean {
  const r = Math.max(0, nm(s.bodyRadiusM)) * pr.m2p;
  const air = Math.max(0, nm(s.atmosphereCeilingM)) * pr.m2p;
  const filled = discCoversCanvas(bc.x, bc.y, r, w, h);
  if (!(r > 0) || !(alpha > 0)) return filled;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = SURFACE;
  if (filled) {
    ctx.fillRect(0, 0, w, h); // the rim is provably off-canvas, so it is not stroked
  } else {
    ctx.beginPath(); ctx.arc(bc.x, bc.y, r, 0, TAU);
    ctx.fill();
    pen(ctx, 1, RIM);
  }
  marks.push('body');
  // When the body already covers the canvas the whole annulus is outside it.
  if (air > 0.5 && !filled) paintAir(ctx, s, bc, r, air, marks, taken, w, h);
  ctx.restore();
  return filled;
}

/** The air, as ONE path: outer rim then inner rim reversed and filled as an
 *  annulus, so the wash never lands on the body and tints it. "Is my periapsis
 *  inside the air" is the question the player is asking, and a ring answers it
 *  faster than a number. The rect and the outer arc have the same winding, so
 *  swapping one for the other keeps the hole and the pixels. */
function paintAir(ctx: CanvasRenderingContext2D, s: MapScene, bc: XY, r: number,
                  air: number, marks: string[], taken: Rect[], w: number,
                  h: number): void {
  const outer = r + air, over = discCoversCanvas(bc.x, bc.y, outer, w, h);
  ctx.beginPath();
  if (over) ctx.rect(0, 0, w, h); else ctx.arc(bc.x, bc.y, outer, 0, TAU);
  ctx.arc(bc.x, bc.y, r, 0, TAU, true);
  ctx.fillStyle = AIR; ctx.fill();
  if (!over) {
    ctx.beginPath(); ctx.arc(bc.x, bc.y, outer, 0, TAU);
    ctx.setLineDash([4, 4]); pen(ctx, 1, AIR_EDGE); ctx.setLineDash([]);
  }
  marks.push('air');
  // A number only when the band is thick enough to point at something and its
  // top is on screen. 4 px, found by rendering: a 13 px gate read as reasonable
  // and never once fired, an atmosphere being ~10 px wide at a low-orbit span.
  const ly = bc.y - outer - 8;
  if (air < 4 || ly < 9 || ly > h - 9 || bc.x < 34 || bc.x > w - 34) return;
  text(ctx, `${km1(s.atmosphereCeilingM)} km`, bc.x, ly, 10, AIR_EDGE);
  taken.push({ x: bc.x - 36, y: ly - 7, w: 72, h: 14 });
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
                 marks: string[], taken: Rect[], w: number, h: number,
                 bc: XY): void {
  if (c === null || c === undefined) return;
  const q = plan ? "'" : '', sfx = plan ? '-plan' : '';
  if (c.bound && c.timeToApoapsisS >= 0 && apsis(ctx, pr, c.apoapsis, `AP${q}`,
    c.apoapsisAltM, c.timeToApoapsisS, colour, taken, w, h, bc)) marks.push(`ap${sfx}`);
  if (c.timeToPeriapsisS >= 0 && apsis(ctx, pr, c.periapsis, `PE${q}`,
    c.periapsisAltM, c.timeToPeriapsisS, colour, taken, w, h, bc)) marks.push(`pe${sfx}`);
}

/** One apsis: a ring on the conic, a leader, and two lines of text. Radially
 *  outward from the BODY'S PROJECTED CENTRE is the one nudge direction always
 *  sane on a conic: the body is the other way, so a label never lands on the
 *  surface, and it is what pulls an AP and a PE apart when they are a few pixels
 *  apart. It used to read the canvas middle, which was the same point only while
 *  the origin was the planet. */
function apsis(ctx: CanvasRenderingContext2D, pr: Proj, at: V3 | null,
               name: string, altM: number, tS: number, colour: string,
               taken: Rect[], w: number, h: number, bc: XY): boolean {
  if (!toPxV(pr, at, B)) return false;
  if (B.x < -40 || B.x > w + 40 || B.y < -40 || B.y > h + 40) return false;
  const p: XY = { x: B.x, y: B.y };
  let ux = p.x - bc.x, uy = p.y - bc.y;
  const l = Math.hypot(ux, uy);
  if (l < 1e-3) { ux = 0; uy = -1; } else { ux /= l; uy /= l; }
  ctx.beginPath(); ctx.arc(p.x, p.y, 4.5, 0, TAU);
  pen(ctx, 3.2, SHADE); pen(ctx, 1.4, colour);
  place(ctx, p, ux, uy, [`${name} ${km1(altM)} km`, `T-${clock(tS)}`], colour,
        taken, w, h);
  return true;
}
