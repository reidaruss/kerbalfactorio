// =============================================================================
// MapContrast.ts - HOW MUCH THE GROUND LAYER ACTUALLY SAYS (WG-33).
//
// WHY IT EXISTS. DW-37 shipped a surface map every structural count called
// green: `discoveredQuads === terrainSamples`, 2,784 of 2,784, alphas at 1, no
// refusals. The picture was a featureless pale wash. `painted == onBody` was
// true and worthless, which is the first half of `mapshot.js`'s own header
// proving itself: a structural check cannot replace looking. This file is the
// number that CAN fail on a blank picture, so the next one is caught by the
// build rather than by Reid.
//
// IT MEASURES THE FINAL BYTES, not the heights. A flat world, a broken shading
// formula and a broken palette all produce the same blank rectangle, and the
// player cannot tell them apart either; neither should the instrument pretend
// to. It reads the ImageData the painter just wrote, before the layer's own
// alpha and before anything composites over it, so a legible layer hidden at
// alpha 0 stays a DIFFERENT and separately visible defect.
//
// TWO NUMBERS, AND THE SECOND ONE IS THE POINT.
//
//   lumaSd / lumaSpread  the GLOBAL tone range. Necessary and NOT sufficient,
//                        and that was established by measurement, not by taste:
//                        the blank surface frame scored lumaSd 22.96 against
//                        the regional frame's 21.87 and the regional frame is
//                        the one that reads. A global spread cannot tell a
//                        relief map from a smooth gradient of the same range.
//   lumaStep             the mean absolute luminance difference between
//                        ADJACENT painted samples. This is local contrast, it
//                        is what the eye reads as texture, and it is what
//                        separated the two frames when the global number could
//                        not: 1.94 blank against 12.85 legible, a factor of 6.6
//                        where lumaSd differed by 5%.
// =============================================================================

import type { TerrainContrast } from './MapTypes.js';

export const ZERO_CONTRAST: TerrainContrast = {
  painted: 0, lumaSd: 0, lumaP5: 0, lumaP95: 0, lumaSpread: 0, lumaStep: 0,
  buckets: 0,
};

const HIST = new Uint32Array(256);
/** Per-sample luminance, 255 meaning "not painted" is NOT usable, so a parallel
 *  mask rides along. Grown on demand; the map's grid is a couple of thousand. */
let LUMA = new Uint8Array(0);
let MASK = new Uint8Array(0);
let LEN = 0;

/**
 * THE TONE THE PAINTER GAVE EACH SAMPLE, for a probe that needs a LOCAL answer
 * (WG-34). Every number in `TerrainContrast` is a statistic over the whole
 * frame, and the whole frame is the wrong unit for the question "can the player
 * see the pad they just levelled": a pad is a handful of samples out of a
 * couple of thousand, so it can be plainly visible and move `lumaStep` by 2%.
 * Measured: a level press plus 24 pickaxe strikes moved 4 of 2,784 samples and
 * carried `lumaStep` from 4.214 to 4.300, which no global floor could ever
 * fail on and no player would ever call invisible.
 *
 * Returned as a live view of the scratch buffer, not a copy: the ONE caller is
 * the debug hook, which copies it out itself, and a per-frame allocation in the
 * painter's own path is what the ImageData cache exists to avoid. `mask` is 1
 * where the sample was painted; luminance under a 0 mask is stale and must not
 * be read.
 */
export function lastLuma(): { luma: Uint8Array; mask: Uint8Array; n: number } {
  return { luma: LUMA, mask: MASK, n: LEN };
}

/** Drop the retained tones. Called wherever the painter reports ZERO_CONTRAST,
 *  so a frame that drew no ground hands back no tones either: a stale tone
 *  array over a blank layer is the same shape of lie as a stale receipt. */
export function forgetLuma(): void { LEN = 0; }

/** Rec. 709 luminance of one written pixel, rounded to a byte. */
function luma(r: number, g: number, b: number): number {
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return y < 0 ? 0 : y > 255 ? 255 : Math.round(y);
}

/**
 * The receipt for one shading pass. `px` is the RGBA the painter just wrote at
 * the grid's own resolution; a sample counts as painted when its alpha is
 * non-zero, which is exactly the painter's own gate re-read off the bytes
 * rather than re-derived from the inputs.
 */
export function measure(px: Uint8ClampedArray, cols: number,
                        rows: number): TerrainContrast {
  const n = cols * rows;
  if (!(n > 0) || px.length < n * 4) { LEN = 0; return ZERO_CONTRAST; }
  if (LUMA.length < n) { LUMA = new Uint8Array(n); MASK = new Uint8Array(n); }
  LEN = n;
  HIST.fill(0);
  let painted = 0;
  for (let i = 0; i < n; i++) {
    const k = i * 4;
    if (px[k + 3] === 0) { MASK[i] = 0; continue; }
    const y = luma(px[k], px[k + 1], px[k + 2]);
    LUMA[i] = y; MASK[i] = 1; HIST[y]++; painted++;
  }
  if (painted <= 0) return ZERO_CONTRAST;

  // THE LOCAL TERM: every 4-neighbour pair with both ends painted. Pairs are
  // counted once (right and down only), so a uniform field scores exactly 0 and
  // the number is a mean over pairs rather than over directions.
  let stepSum = 0, pairs = 0;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const i = y * cols + x;
      if (MASK[i] === 0) continue;
      if (x + 1 < cols && MASK[i + 1] === 1) {
        stepSum += Math.abs(LUMA[i] - LUMA[i + 1]); pairs++;
      }
      if (y + 1 < rows && MASK[i + cols] === 1) {
        stepSum += Math.abs(LUMA[i] - LUMA[i + cols]); pairs++;
      }
    }
  }

  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * HIST[i];
  const mean = sum / painted;
  let s2 = 0;
  for (let i = 0; i < 256; i++) { const d = i - mean; s2 += HIST[i] * d * d; }
  const lo = painted * 0.05, hi = painted * 0.95, floor = painted * 0.01;
  let seen = 0, p5 = 0, p95 = 0, buckets = 0, bucket = 0;
  for (let i = 0; i < 256; i++) {
    if (seen < lo && seen + HIST[i] >= lo) p5 = i;
    seen += HIST[i];
    if (p95 === 0 && seen >= hi) p95 = i;
    bucket += HIST[i];
    if ((i & 7) === 7) { if (bucket >= floor) buckets++; bucket = 0; }
  }
  return {
    painted,
    lumaSd: +Math.sqrt(s2 / painted).toFixed(3),
    lumaP5: p5, lumaP95: p95, lumaSpread: p95 - p5,
    lumaStep: pairs === 0 ? 0 : +(stepSum / pairs).toFixed(3),
    buckets,
  };
}
