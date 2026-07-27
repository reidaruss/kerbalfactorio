// renderer.info + performance marks -> a preallocated ring buffer.
// ARCHITECTURE.md section 10.4: this is what the smoke suite asserts on, so
// performance regressions fail CI the same way logic regressions do.
// Zero allocation in the steady-state path (2.2 rule 6).

import type { OFRenderer, RenderInfo } from '../Renderer.js';
import type { PassTimings } from '../Frame.js';

const RING = 600;

export interface FrameStats {
  frames: number;
  fps: number;
  frameMs: { p50: number; p95: number; p99: number; worst: number; last: number };
  passMs: PassTimings;
  cpuMs: number;
  draw: RenderInfo;
  instances: number;
  vramEstimateMB: number;
  budget: { drawCalls: string; triangles: string; frameP99: string };
}

/**
 * A-8. The draw-call TARGET, which existed only as the literal `150` inside a
 * HUD template string, so nothing enforced it and nothing else could read it.
 * It is not a ceiling: `ALERT` and `FAIL` below are the enforced numbers. It is
 * the figure a change is judged against, and a change that moves it needs to
 * say so. `web/src/ui/HudLines.ts:84` should import this instead of printing
 * its own copy; that file belongs to another lane tonight, so the constant is
 * published here and the swap is left as a one-line follow-up.
 */
export const DRAW_CALL_TARGET = 150;

/** Ceilings from ARCHITECTURE.md section 10.3. */
const ALERT = { calls: 300, triangles: 2.7e6, p99: 25 };
const FAIL = { calls: 500, triangles: 4.0e6, p99: 40 };

function verdict(v: number, alert: number, fail: number): string {
  if (v >= fail) return 'FAIL';
  if (v >= alert) return 'ALERT';
  return 'ok';
}

function percentile(sorted: Float64Array, n: number, q: number): number {
  if (n === 0) return 0;
  const i = Math.min(n - 1, Math.max(0, Math.round(q * (n - 1))));
  return sorted[i];
}

export class StatsProbe {
  private readonly ring = new Float64Array(RING);
  private readonly sortScratch = new Float64Array(RING);
  private readonly cpuRing = new Float64Array(RING);
  private head = 0;
  private count = 0;
  private frames = 0;
  /** Extra bytes the app knows about that renderer.info cannot see (pools). */
  extraVramBytes = 0;
  instances = 0;

  sample(frameMs: number, cpuMs: number): void {
    this.ring[this.head] = frameMs;
    this.cpuRing[this.head] = cpuMs;
    this.head = (this.head + 1) % RING;
    if (this.count < RING) this.count++;
    this.frames++;
  }

  private sorted(src: Float64Array): Float64Array {
    const n = this.count;
    this.sortScratch.set(src.subarray(0, n));
    const view = this.sortScratch.subarray(0, n);
    view.sort();
    return this.sortScratch;
  }

  stats(r: OFRenderer, passes: PassTimings): FrameStats {
    const n = this.count;
    const s = this.sorted(this.ring);
    const p50 = percentile(s, n, 0.5);
    const p95 = percentile(s, n, 0.95);
    const p99 = percentile(s, n, 0.99);
    const worst = n > 0 ? s[n - 1] : 0;
    const last = this.ring[(this.head + RING - 1) % RING];
    let cpu = 0;
    for (let i = 0; i < n; ++i) cpu += this.cpuRing[i];
    const draw = r.info();
    const vram = this.extraVramBytes / (1024 * 1024);
    return {
      frames: this.frames,
      fps: p50 > 0 ? 1000 / p50 : 0,
      frameMs: { p50, p95, p99, worst, last },
      passMs: { ...passes },
      cpuMs: n > 0 ? cpu / n : 0,
      draw,
      instances: this.instances,
      vramEstimateMB: Math.round(vram * 10) / 10,
      budget: {
        drawCalls: verdict(draw.calls, ALERT.calls, FAIL.calls),
        triangles: verdict(draw.triangles, ALERT.triangles, FAIL.triangles),
        frameP99: verdict(p99, ALERT.p99, FAIL.p99),
      },
    };
  }
}
