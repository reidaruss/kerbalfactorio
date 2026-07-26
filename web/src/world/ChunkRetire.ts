// The OUTGOING half of the stream-in cross-dissolve (ARCHITECTURE.md 4.5
// mechanism 3).
//
// This exists because of a measurement. /core evicts a parent chunk in the SAME
// StreamUpdate its four children arrive, so releasing the pooled slot on
// eviction leaves the dithering children with nothing behind them and the
// "cross-fade" reads as a hole punched in the ground: on a driven walk the
// largest single-frame tile second-difference went from 6.6 (no fade) to 101.9
// (fade with immediate eviction). Holding the outgoing chunk for the length of
// the dissolve is what makes it a dissolve.
//
// The retired chunk keeps its pooled slot for fadeSecs and is drawn with a
// NEGATIVE aFadeT0 stamp, which the shader reads as the complementary dither
// threshold, so exactly one of the pair covers each pixel.

import type { ChunkGeometryPool } from '../render/geometry/ChunkGeometryPool.js';
import type { FloatingOrigin } from './FloatingOrigin.js';
import type { ChunkView } from './ChunkView.js';

export class ChunkRetire {
  private readonly list: { view: ChunkView; until: number }[] = [];

  constructor(private readonly pool: ChunkGeometryPool, readonly fadeSecs: number) {}

  get length(): number { return this.list.length; }

  /** Take ownership of an evicted view for the length of the dissolve. */
  push(view: ChunkView, nowSecs: number): void {
    this.pool.setFadeStart(view.pooled, -(nowSecs + 1e-3));
    this.list.push({ view, until: nowSecs + this.fadeSecs });
  }

  /** Release views whose dissolve has finished. `force` drains all of them. */
  reap(nowSecs: number, force = false): void {
    for (let i = this.list.length - 1; i >= 0; --i) {
      const r = this.list[i];
      if (!force && nowSecs < r.until) continue;
      this.pool.release(r.view.pooled);
      this.list.splice(i, 1);
    }
  }

  /** Retiring chunks are on screen for a quarter of a second, so they rebase. */
  onOriginRebased(origin: FloatingOrigin): void {
    for (const r of this.list) r.view.place(origin, this.pool);
  }
}
