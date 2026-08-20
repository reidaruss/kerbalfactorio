// CE-145. THE FRAME-HASH INSTRUMENT, lifted verbatim out of `Loop.ts`.
//
// None of this is the clock. It renders one frame, reads the presented pixels
// back and reduces them to a signature two separate browser runs can be
// compared on, which is bookkeeping AROUND the loop rather than a part of it.
// `Loop` keeps a one-line delegator and re-exports `FrameHash`, so no import
// site outside this file changes.
//
// The two width/height arguments are passed IN rather than read here on
// purpose: `Loop.resizeIfNeeded` owns the last presented size and the hash
// must be taken at the size the frame was actually drawn at.

import type { Services } from './Services.js';
import { FrameDiff, type FrameDiffStats } from '../render/debug/FrameDiff.js';

export interface FrameHash {
  w: number; h: number; hash: number; litPct: number;
  /** Clear-colour pixels with terrain above them. See `countHoles` below. */
  holePixels: number;
  tilesX: number; tilesY: number; tiles: number[];
  /** Per-pixel second difference against the two previous frameHash calls. */
  diff: FrameDiffStats;
}

/** Consecutive opaque pixels that mark the horizon in countHoles. */
const HORIZON_RUN_PX = 6;

export class FrameHasher {
  private readonly frameDiff = new FrameDiff();

  constructor(private readonly s: Services) {}

  /**
   * Render one frame and hash what was presented. This is the floating-origin
   * INVISIBILITY test: two runs of the same scripted walk that differ only in
   * the rebase threshold must present the same pixels, because every
   * world-anchored object re-derives from its 64-bit anchor. Comparing hashes
   * across two separate browser runs needs no image library and no goldens.
   *
   * `tiles` also comes back as mean luminance per cell, so a difference can be
   * localised and quantified instead of just reported as "not equal".
   */
  frameHash(lastW: number, lastH: number, tilesX = 48, tilesY = 27): FrameHash {
    const { renderer, frame } = this.s;
    frame.render();
    const w = Math.max(1, Math.round(lastW * renderer.pixelRatio));
    const h = Math.max(1, Math.round(lastH * renderer.pixelRatio));
    const buf = new Uint8Array(w * h * 4);
    renderer.readPixels(0, 0, w, h, buf);
    const sum = new Float64Array(tilesX * tilesY);
    const n = new Float64Array(tilesX * tilesY);
    let hash = 0x811c9dc5 >>> 0;
    let lit = 0;
    for (let y = 0; y < h; ++y) {
      const ty = Math.min(tilesY - 1, ((y * tilesY) / h) | 0);
      for (let x = 0; x < w; ++x) {
        const i = (y * w + x) * 4;
        const l = (buf[i] * 77 + buf[i + 1] * 151 + buf[i + 2] * 28) >> 8;
        hash = Math.imul(hash ^ buf[i], 0x01000193) >>> 0;
        hash = Math.imul(hash ^ buf[i + 1], 0x01000193) >>> 0;
        hash = Math.imul(hash ^ buf[i + 2], 0x01000193) >>> 0;
        const t = ty * tilesX + Math.min(tilesX - 1, ((x * tilesX) / w) | 0);
        sum[t] += l; n[t] += 1;
        if (l > 4) lit++;
      }
    }
    const tiles: number[] = [];
    for (let i = 0; i < sum.length; ++i) tiles.push(Math.round((sum[i] / Math.max(1, n[i])) * 100) / 100);
    return {
      w, h, hash, litPct: Math.round((lit / (w * h)) * 10000) / 100,
      holePixels: this.countHoles(buf, w, h), tilesX, tilesY, tiles,
      diff: this.frameDiff.sample(buf, w, h),
    };
  }

  /**
   * Pixels showing the clear colour with terrain ABOVE them: sky seen THROUGH
   * the world. Run with ?clear=ff00ff and this is an exact crack count, which
   * is the only way to tell a hole from a dark-shaded steep face. The W1 handoff
   * read one as the other.
   *
   * readPixels is bottom-left origin, so the scan runs from the top down and a
   * column starts counting only after it has hit something opaque.
   */
  private countHoles(buf: Uint8Array, w: number, h: number): number {
    const c = this.s.cfg.clearColor;
    const cr = (c >> 16) & 0xff, cg = (c >> 8) & 0xff, cb = c & 0xff;
    let holes = 0;
    for (let x = 0; x < w; ++x) {
      let seenSolid = false;
      let run = 0;
      for (let y = h - 1; y >= 0; --y) {
        const i = (y * w + x) * 4;
        const isVoid = Math.abs(buf[i] - cr) < 12
          && Math.abs(buf[i + 1] - cg) < 12 && Math.abs(buf[i + 2] - cb) < 12;
        if (!isVoid) {
          // Stars are one or two pixels. Only a RUN of opaque pixels counts as
          // the horizon, or every star would make the sky below it a "hole".
          if (++run >= HORIZON_RUN_PX) seenSolid = true;
          continue;
        }
        run = 0;
        if (seenSolid) holes++;
      }
    }
    return holes;
  }
}
