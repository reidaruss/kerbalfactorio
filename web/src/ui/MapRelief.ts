// =============================================================================
// MapRelief.ts - THE TWO RELIEF BANDS (WG-33). Turns a grid of heights into
// what the shader wants: a tone in [0,1] and TWO lambert factors per sample,
// the whole field's and the fine detail's. Pure, no DOM, no state beyond
// scratch buffers.
//
// WHY THIS EXISTS, and it is not the reason it looked like it was.
//
// Reid pressed M at the default surface view and saw no terrain: a flat slate
// field with ore circles on it. The obvious diagnosis was a planet-scale colour
// ramp keyed to absolute elevation, so that a few metres of desert relief all
// landed in one bucket. MEASURED, THAT WAS WRONG. DW-37's ramp was already
// normalised to the frame's own relief and its hillshade was already normalised
// to the frame's own mean slope, and the numbers say so: over the painted
// samples the blank 454 m frame scored lumaSd 22.96, lumaSpread 66 and 10
// distinct tone buckets, against the LEGIBLE 52 km frame's 21.87, 70 and 11.
// The close-in map was already using the full tone range.
//
// WHAT IT HAD NO TRACE OF WAS LOCAL CONTRAST. `MapContrast.lumaStep`, the mean
// tone difference between ADJACENT samples, read 1.94 on the blank frame against
// 8.61 regional and 24.63 orbital: a factor of 4.4 where the global numbers
// differed by 5%. That is the whole defect in one number, and it is why a global
// spread assertion would have gone green over the blank picture too.
//
// AND THE CAUSE IS THE WORLD, NOT THE SHADER. Measured at each view's own
// resolution (`MapTerrainGrid.stepM`, the mean height difference between
// adjacent samples): the 454 m frame has 45.4 m of relief and 0.333 m between
// neighbours, 0.73% of its range. The 52 km frame has 4,187.9 m of relief and
// 146.98 m between neighbours, 3.51% - nearly five times as much, relatively.
// Over 454 m of Forge the ground is ONE HILLSIDE. A hillshade of a hillside is a
// flat wash by definition, because every sample has nearly the same slope
// DIRECTION as its neighbour and therefore lights nearly the same, and
// normalising the MAGNITUDE (which DW-37 already did) cannot change that.
//
// SO SHADE TWO BANDS. `litFull` is the field's own hillshade, unchanged in
// character from DW-37, and it is what draws a mountain range. `litDetail` is
// the same lambert run on the field with its LOCAL TREND SUBTRACTED, normalised
// by that residual's own typical slope, and it is what draws a levelled pad, a
// dug trench and the microrelief of a desert. Multi-scale relief shading: what a
// printed relief map has always done, and what the eye needs, because "the shape
// of the ground" is a statement about how a place differs from what is beside
// it, not about its absolute height.
//
// IT IS NEAR-IDENTITY WHERE THE MAP ALREADY WORKED, structurally rather than by
// promise: on rugged ground the trend is small compared with the field, so the
// detail band is close to the full band and adds texture rather than replacing
// structure. The measured cost to the regional and orbital frames is in WG-33.
//
// THERE IS NO ZOOM THRESHOLD HERE AND NONE MAY BE ADDED (DW-36). Both windows
// are fixed counts of SAMPLES, never distances in metres, so this is the same
// operation at every span and there is nothing for a zoom to switch. A weight
// keyed on `sampleSizeM` was considered and rejected for exactly that reason: it
// would have been a span threshold with a smooth face on it.
// =============================================================================

import { lambert } from './MapPaint.js';

/**
 * The detail band's trend window, as a fraction of the SHORT axis in samples.
 * A sixteenth, so the window is an eighth of the frame across: what a reader
 * would call "the local ground level". Larger and a pad stops standing out
 * against its own surroundings; smaller and the band carries only the sampling
 * grid's own highest frequency, which is noise rather than terrain.
 */
const DETAIL_FRACTION = 1 / 16;

export interface Relief {
  /** Tone in [0,1] per sample: the frame-wide elevation ramp and the detrended
   *  one, averaged. The global half keeps "high ground is pale" true across the
   *  frame; the local half is what makes a 2 m pad in 45 m of relief visible. */
  readonly t: Float32Array;
  /** The whole field's lambert, 0..1. Draws mountain ranges. */
  readonly litFull: Float32Array;
  /** The detrended field's lambert, 0..1. Draws pads, trenches and microrelief. */
  readonly litDetail: Float32Array;
  /** Receipts. A frame whose residual is zero is genuinely flat and must look
   *  it; a frame whose two mean slopes are close is one this file barely
   *  touched, which is the regional and orbital case. */
  readonly residualRmsM: number;
  readonly meanSlopeFullM: number;
  readonly meanSlopeDetailM: number;
  readonly detailRadius: number;
}

let T = new Float32Array(0), LF = new Float32Array(0), LD = new Float32Array(0);
let LO = new Float64Array(0), RES = new Float64Array(0);
let A = new Float64Array(0), B = new Float64Array(0);
let SA = new Float64Array(0), SB = new Float64Array(0);

function grow(n: number): void {
  if (T.length >= n) return;
  T = new Float32Array(n); LF = new Float32Array(n); LD = new Float32Array(n);
  LO = new Float64Array(n); RES = new Float64Array(n);
  A = new Float64Array(n); B = new Float64Array(n);
  SA = new Float64Array(n); SB = new Float64Array(n);
}

/**
 * ONE masked box pass of `src` into `dst`, horizontal then vertical.
 *
 * Masked, not filled: off-limb samples contribute nothing and are not counted,
 * so the trend near the limb is the mean of the ground that IS there. Filling
 * them with a constant instead would drag the trend toward that constant and
 * draw a false bright ring around the planet at orbital zoom, which is a defect
 * this file would then have introduced while fixing another one.
 *
 * Running sums, so the cost is O(samples) and independent of the radius.
 */
function box(src: Float64Array, dst: Float64Array, on: Int8Array, cols: number,
             rows: number, r: number): void {
  for (let y = 0; y < rows; y++) {
    const row = y * cols;
    let s = 0, c = 0;
    for (let x = 0; x <= r && x < cols; x++) {
      if (on[row + x] >= 0) { s += src[row + x]; c++; }
    }
    for (let x = 0; x < cols; x++) {
      SA[row + x] = s; SB[row + x] = c;
      const add = x + r + 1, drop = x - r;
      if (add < cols && on[row + add] >= 0) { s += src[row + add]; c++; }
      if (drop >= 0 && on[row + drop] >= 0) { s -= src[row + drop]; c--; }
    }
  }
  for (let x = 0; x < cols; x++) {
    let s = 0, c = 0;
    for (let y = 0; y <= r && y < rows; y++) {
      s += SA[y * cols + x]; c += SB[y * cols + x];
    }
    for (let y = 0; y < rows; y++) {
      dst[y * cols + x] = c > 0 ? s / c : 0;
      const add = y + r + 1, drop = y - r;
      if (add < rows) { s += SA[add * cols + x]; c += SB[add * cols + x]; }
      if (drop >= 0) { s -= SA[drop * cols + x]; c -= SB[drop * cols + x]; }
    }
  }
}

/**
 * THREE box passes, not one, and that is a defect this file already made and
 * fixed. A single box blur has a hard rectangular impulse response, and
 * subtracting it stamped soft AXIS-ALIGNED RECTANGLES across the map, plainly
 * visible in the first driven screenshot. Three passes approximate a Gaussian
 * closely enough that the residual carries no rectangles, and cost three linear
 * passes over a couple of thousand samples. Found by LOOKING (DW-7): no count
 * moved, because a rectangle of trend has exactly the contrast statistics of a
 * hill.
 */
function smooth(src: Float64Array, on: Int8Array, cols: number, rows: number,
                r: number): void {
  box(src, A, on, cols, rows, r);
  box(A, B, on, cols, rows, r);
  box(B, LO, on, cols, rows, r);
}

/** Central differences with the edges CLAMPED rather than wrapped: the
 *  neighbour of an edge sample is itself, so the border shades flat instead of
 *  reading the far side of the image, which would draw a cliff along every edge
 *  of the panel. Writes the lambert into `out` and returns the mean slope. */
function shadeBand(src: Float64Array, on: Int8Array, cols: number, rows: number,
                   out: Float32Array): number {
  const at = (x: number, y: number): number =>
    src[(y < 0 ? 0 : y > rows - 1 ? rows - 1 : y) * cols
      + (x < 0 ? 0 : x > cols - 1 ? cols - 1 : x)];
  let sum = 0, k = 0;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const i = y * cols + x;
      if (on[i] < 0) { out[i] = 0.5; continue; }
      sum += Math.hypot(at(x + 1, y) - at(x - 1, y),
                        at(x, y + 1) - at(x, y - 1));
      k++;
    }
  }
  // A typical slope lights at 0.8, which is the contrast a shaded relief map
  // reads best at. A perfectly flat band scales by 0 and shades uniformly,
  // which is what a flat band should look like.
  const mean = k > 0 ? sum / k : 0;
  const gk = mean > 1e-9 ? 0.8 / mean : 0;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const i = y * cols + x;
      if (on[i] < 0) continue;
      out[i] = lambert((at(x + 1, y) - at(x - 1, y)) * gk,
                       (at(x, y + 1) - at(x, y - 1)) * gk);
    }
  }
  return mean;
}

/**
 * `H` is the grid's heights in metres, `biome` its off-limb mask (negative means
 * no ground). `minH`/`maxH` are the frame's own relief, already computed by the
 * sampler, and are used only for the global half of the tone.
 */
export function relief(H: Float64Array, biome: Int8Array, cols: number,
                       rows: number, minH: number, maxH: number): Relief {
  const n = cols * rows;
  grow(n);
  const r = Math.max(1, Math.round(rows * DETAIL_FRACTION));
  smooth(H, biome, cols, rows, r);

  let sq = 0, m = 0;
  for (let i = 0; i < n; i++) {
    if (biome[i] < 0) { RES[i] = 0; continue; }
    const d = H[i] - LO[i];
    RES[i] = d; sq += d * d; m++;
  }
  const rms = m > 0 ? Math.sqrt(sq / m) : 0;

  // TONE. The global half against the frame's relief, the local half against
  // TWICE the residual's RMS, which puts the bulk of a normal distribution
  // inside the ramp and clips only the genuine outliers: a trench floor and a
  // spoil heap, which SHOULD clip, being the darkest and palest things there.
  const gspan = maxH - minH > 1e-6 ? maxH - minH : 1;
  const lspan = rms > 1e-9 ? 2 * rms : 1;
  for (let i = 0; i < n; i++) {
    if (biome[i] < 0) { T[i] = 0.5; continue; }
    const l = RES[i] / lspan;
    T[i] = 0.5 * ((H[i] - minH) / gspan)
      + 0.5 * (0.5 + 0.5 * (l < -1 ? -1 : l > 1 ? 1 : l));
  }

  const full = shadeBand(H, biome, cols, rows, LF);
  const detail = shadeBand(RES, biome, cols, rows, LD);
  return {
    t: T, litFull: LF, litDetail: LD, residualRmsM: rms,
    meanSlopeFullM: full, meanSlopeDetailM: detail, detailRadius: r,
  };
}
