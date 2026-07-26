// Per-PIXEL frame differencing, for artefacts that a tile average hides.
//
// Loop.frameHash reduces the frame to 48x27 tile means, which is the right tool
// for "did two runs present the same image" but the wrong one for a pop: a
// chunk swapping LOD can change a few thousand pixels by 60 levels and move an
// 8x8 tile mean by less than one. This keeps two frames of luminance and reports
// the SECOND DIFFERENCE per pixel, because a moving camera changes every pixel
// smoothly every frame and only a discontinuity shows up twice-differentiated.
//
// Two Uint8Array frames at 1600x900 is 2.9 MB, allocated once per resolution and
// only when a probe asks for it.

export interface FrameDiffStats {
  /** Pixels whose second difference exceeds the threshold. */
  jumpPx: number;
  /** As a fraction of the frame, in parts per million. */
  jumpPpm: number;
  /** The largest per-pixel second difference in the frame, 0..255. */
  maxD2: number;
  /** Mean second difference over the whole frame. */
  meanD2: number;
  /** False until three frames have been seen at this resolution. */
  valid: boolean;
}

const EMPTY: FrameDiffStats = {
  jumpPx: 0, jumpPpm: 0, maxD2: 0, meanD2: 0, valid: false,
};

export class FrameDiff {
  /** Second-difference level that counts as a jump, out of 255. */
  threshold = 16;
  private a: Uint8Array | null = null;
  private b: Uint8Array | null = null;
  private cur: Uint8Array | null = null;
  private w = 0;
  private h = 0;
  private seen = 0;

  /** `buf` is RGBA8 as read back by the renderer. Returns the stats for it. */
  sample(buf: Uint8Array, w: number, h: number): FrameDiffStats {
    const n = w * h;
    if (this.w !== w || this.h !== h || this.cur === null) {
      this.a = new Uint8Array(n);
      this.b = new Uint8Array(n);
      this.cur = new Uint8Array(n);
      this.w = w; this.h = h; this.seen = 0;
    }
    const cur = this.cur;
    for (let i = 0, p = 0; i < n; ++i, p += 4) {
      cur[i] = (buf[p] * 77 + buf[p + 1] * 151 + buf[p + 2] * 28) >> 8;
    }
    this.seen++;
    const prev1 = this.a as Uint8Array;
    const prev2 = this.b as Uint8Array;
    let out = EMPTY;
    if (this.seen >= 3) {
      let jump = 0; let max = 0; let sum = 0;
      for (let i = 0; i < n; ++i) {
        const d2 = Math.abs(cur[i] - 2 * prev1[i] + prev2[i]);
        sum += d2;
        if (d2 > max) max = d2;
        if (d2 >= this.threshold) jump++;
      }
      out = {
        jumpPx: jump,
        jumpPpm: Math.round((jump / n) * 1e6),
        maxD2: max,
        meanD2: Math.round((sum / n) * 1000) / 1000,
        valid: true,
      };
    }
    // Rotate: b <- a <- cur, reusing the buffers so the steady state allocates
    // nothing (2.2 rule 6).
    this.b = prev1;
    this.a = cur;
    this.cur = prev2;
    return out;
  }

  reset(): void { this.seen = 0; }
}
