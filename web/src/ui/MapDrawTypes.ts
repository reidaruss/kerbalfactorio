// The paint-report half of MapTypes.ts (see that file's header for the map's
// own design rules). Split out at the 400-line cap: this file holds what the
// painter says it actually drew (MapDrawReport) and the ground layer's own
// contrast measurement (TerrainContrast), which MapDrawReport carries.

import type { V3 } from './MapTypesCore.js';

/** What the painter says it actually drew. Not a second opinion: these are the
 *  counts taken inside the paint pass, so a map that is present but never fed
 *  is distinguishable from a live one (the navball lane's lesson). */
export interface MapDrawReport {
  currentPoints: number;
  plannedPoints: number;
  markers: string[];
  pixelsPerMetre: number;
  /** The opacity each scale-dependent layer was painted at, THIS frame. The
   *  zoom continuum is proven off these rather than off the code: sweep the
   *  span and every one of them must move smoothly and monotonically. A `if
   *  (span > X) return` anywhere would show up here as a 1 -> 0 step. */
  alphas: { ore: number; discovered: number; body: number };
  /** TERRAIN SAMPLES and patches that reached the canvas, counted in the paint
   *  pass. `discoveredQuads` keeps its name and its meaning — "how much ground
   *  did this frame actually draw" — while what a unit of ground IS changed
   *  from a 9,375 m discovery quad to one terrain sample (DW-37). */
  discoveredQuads: number;
  /** Samples with ground under them, painted or not. The pair is the negative
   *  control: in survival `discoveredQuads` is strictly less than this wherever
   *  the view is wider than what has been seen, and in sandbox they are equal. */
  terrainSamples: number;
  /** Ground metres across one terrain sample, the feature size `alphas.
   *  discovered` was taken from, so a probe can predict that alpha exactly. */
  sampleSizeM: number;
  oreDrawn: number;
  /** The RAW numbers each drawn ore marker carried, in paint order, so a probe
   *  compares integers against /core's `OrePatch::RemainingAmount` field by
   *  field (the way the power panel was proven) instead of parsing "2.4k" back
   *  into a number. `oreDrawn` is this array's length by construction. */
  oreDrawnRows: { resource: number; remaining: number; initial: number }[];
  /** True when the body's disc provably covers every canvas corner, so it was
   *  filled rather than stroked as an arc. Not a mode: the two paths produce the
   *  same pixels by construction, and `MapPaint.bodyCovers` is the proof. */
  bodyFilled: boolean;
  /** HOW MUCH THE GROUND LAYER ACTUALLY SAYS (WG-33). See TerrainContrast. */
  contrast: TerrainContrast;
  /** GP-520. Each drawn marker's OWN pixel, taken inside the paint pass that
   *  placed it, same shape as `oreDrawnRows` above and for the same reason: a
   *  probe compares this against an independent `toPx` over the marker's own
   *  `dirBody` (through `proj` below) instead of trusting the paint pass a
   *  second time with no way to check it. */
  markerRows: { key: string; xPx: number; yPx: number }[];
  /** GP-520. THE PROJECTION THIS FRAME USED, verbatim (`MapPaint.Proj`):
   *  `pixelsPerMetre` above is `m2p` alone, published long before markers
   *  existed; the rest completes it so a probe can call the exact function
   *  `markerRows` was drawn with, rather than re-deriving the origin and the
   *  basis (DW-36: the centre is a parameter, so there is no fixed formula a
   *  probe could assume instead). */
  proj: { cx: number; cy: number; m2p: number; ox: number; oy: number; oz: number;
    u: V3; v: V3 };
}

/**
 * The ground layer's own contrast, measured over the bytes the painter wrote.
 *
 * WHY IT EXISTS. DW-37 shipped a map whose every structural count was green
 * (`discoveredQuads === terrainSamples`, 2,784 of 2,784) over a picture that
 * carried no information at all: at a 454 m span the surface map was a
 * featureless pale wash. `painted == onBody` was true, green and worthless, and
 * nothing in the report could tell the difference between that and a legible
 * relief map. This is the number that can, and it is deliberately taken from the
 * FINAL RGB bytes rather than from the heights, because a shading bug, a palette
 * bug and a flat world all produce the same blank picture and the player cannot
 * tell them apart either.
 *
 * Luminance is Rec. 709 over the 0..255 bytes the sample was written at, before
 * the layer's own alpha and before anything is composited over it: this measures
 * what the ground layer OFFERS, so a legible layer hidden by an alpha of 0 is a
 * different (and separately visible) defect from a layer with nothing to say.
 */
export interface TerrainContrast {
  /** Samples this was measured over, i.e. MapDrawReport.discoveredQuads. */
  painted: number;
  /** Standard deviation of luminance, 0..255. THE headline number. */
  lumaSd: number;
  /** The 5th and 95th percentile of luminance, and the gap between them: a
   *  robust spread that a handful of outlier pixels cannot manufacture. */
  lumaP5: number;
  lumaP95: number;
  lumaSpread: number;
  /** The mean absolute luminance difference between ADJACENT painted samples:
   *  LOCAL contrast, which is what the eye reads as terrain. It is the number
   *  that failed the blank frame when the global ones could not, and that is a
   *  measurement and not a preference: the featureless surface frame scored
   *  lumaSd 22.96 against the legible regional frame's 21.87, while lumaStep
   *  read 1.94 against 12.85. */
  lumaStep: number;
  /** Distinct 8-wide luminance buckets (32 across the byte range) holding at
   *  least 1% of the painted samples each. A count of the tones the picture
   *  really uses, immune to a single stray pixel widening the range. */
  buckets: number;
}
