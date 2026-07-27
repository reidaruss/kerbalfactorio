// The driven surface for measuring how much of the ground the foliage covers.
//
// Split out of Debug.ts, which is at the 400-line cap. It is two calls and it
// exists for one reason: "the ground reads as bare" is a claim about SCREEN
// COVERAGE, and coverage can only be measured by differencing the same frame
// with and without the layer. Standing rule 7 says every visual claim isolates
// its subject; this isolates it inside one settled frame rather than across two
// page loads, so the camera, the streamed chunk set, the sun angle and the
// terrain cannot differ between the two captures.

import type { Services } from './Services.js';
import type { Loop } from './Loop.js';

export interface ScatterApi {
  /** Show or hide every prop batch. Returns the state it left. */
  propsVisible(on: boolean): boolean;
  /**
   * Fraction of pixels in a centred box that CHANGE when the foliage layer is
   * toggled off, which is the foliage's screen coverage over that patch of
   * ground. `half` is the half-width in pixels; `thresh` is the per-channel
   * level that counts as changed, out of 255.
   *
   * Reported alongside `bothBlack`, the fraction of the box that is black in
   * BOTH captures. A view of empty sky would score 0 coverage honestly and a
   * view of nothing at all would score 0 too, and those are different answers;
   * without that number a probe pointed at the void reads as a bare meadow.
   */
  groundCover(half?: number, thresh?: number): Promise<{
    coveredFraction: number; changedPx: number; samplePx: number;
    bothBlack: number; meanLumWith: number; meanLumWithout: number;
  }>;
}

async function grab(loop: Loop, half: number): Promise<{
  data: Uint8ClampedArray; n: number;
}> {
  const blob = await loop.capture();
  const bmp = await createImageBitmap(blob);
  const cv = new OffscreenCanvas(bmp.width, bmp.height);
  const ctx = cv.getContext('2d');
  if (ctx === null) throw new Error('groundCover: no 2d context');
  ctx.drawImage(bmp, 0, 0);
  const w = Math.min(half * 2, bmp.width);
  const h = Math.min(half * 2, bmp.height);
  const x0 = Math.max(0, ((bmp.width >> 1) - (w >> 1)) | 0);
  const y0 = Math.max(0, ((bmp.height >> 1) - (h >> 1)) | 0);
  const d = ctx.getImageData(x0, y0, w, h).data;
  bmp.close();
  return { data: d, n: (w * h) | 0 };
}

const lum = (d: Uint8ClampedArray, i: number): number =>
  (d[i] * 77 + d[i + 1] * 151 + d[i + 2] * 28) / 256;

export function scatterApi(s: Services, loop: Loop): ScatterApi {
  return {
    propsVisible(on: boolean): boolean {
      s.props.setVisible(on);
      return on;
    },
    async groundCover(half = 300, thresh = 6) {
      s.props.setVisible(true);
      const withF = await grab(loop, half);
      s.props.setVisible(false);
      const without = await grab(loop, half);
      s.props.setVisible(true);
      let changed = 0; let black = 0; let lw = 0; let lo = 0;
      const a = withF.data; const b = without.data;
      for (let i = 0; i < a.length; i += 4) {
        const dr = Math.abs(a[i] - b[i]);
        const dg = Math.abs(a[i + 1] - b[i + 1]);
        const db = Math.abs(a[i + 2] - b[i + 2]);
        if (dr > thresh || dg > thresh || db > thresh) changed++;
        const la = lum(a, i); const lb = lum(b, i);
        if (la < 8 && lb < 8) black++;
        lw += la; lo += lb;
      }
      const n = Math.max(1, withF.n);
      return {
        coveredFraction: Math.round((changed / n) * 1e4) / 1e4,
        changedPx: changed, samplePx: n,
        bothBlack: Math.round((black / n) * 1e4) / 1e4,
        meanLumWith: Math.round((lw / n) * 10) / 10,
        meanLumWithout: Math.round((lo / n) * 10) / 10,
      };
    },
  };
}
