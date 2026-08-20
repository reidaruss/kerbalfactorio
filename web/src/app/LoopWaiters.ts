// CE-145. THE SETTLE AND CAPTURE WAITER BOOKKEEPING, lifted verbatim out of
// `Loop.ts`.
//
// Who is waiting for a quiet frame, who is waiting for a screenshot, and the
// once-per-frame pump that answers both. Bookkeeping around the clock, not the
// clock: nothing here reads a timestamp, an accumulator or an alpha.
//
// `Loop` keeps the two public entry points as delegators and keeps
// `settleGate` itself (other domains assign it), and calls `pump` from the
// same place in `step` the inlined blocks occupied: last, after
// `frame.render()` and after `stats.sample`.

export class LoopWaiters {
  private settleWaiters: { framesLeft: number; resolve: () => void }[] = [];
  private captureWaiters: { resolve: (b: Blob) => void; reject: (e: unknown) => void }[] = [];

  /** Resolve after `n` rendered frames with nothing pending. Race-free captures. */
  settle(n = 8): Promise<void> {
    return new Promise((resolve) => this.settleWaiters.push({ framesLeft: n, resolve }));
  }

  /** Captured inside the rAF callback, so preserveDrawingBuffer is not needed. */
  capture(): Promise<Blob> {
    return new Promise((resolve, reject) => this.captureWaiters.push({ resolve, reject }));
  }

  /**
   * Answer both queues. One call per rendered frame, from the end of
   * `Loop.step`.
   *
   * `gate` is `Loop.settleGate` and is CALLED ONLY WHEN SOMEONE IS WAITING,
   * exactly as the inlined version was: it is a live streaming/asset query, so
   * a frame with nothing waiting on it must not pay for one.
   *
   * `renderer` is typed structurally rather than imported. `capture()` is the
   * whole of what this needs from it, and the narrower type is also the proof
   * that no other renderer state is reachable from here.
   */
  pump(renderer: { capture(): Promise<Blob> }, gate: (() => boolean) | null): void {
    if (this.captureWaiters.length > 0) {
      const waiters = this.captureWaiters.splice(0);
      renderer.capture().then(
        (b) => waiters.forEach((w) => w.resolve(b)),
        (e) => waiters.forEach((w) => w.reject(e)),
      );
    }
    if (this.settleWaiters.length > 0) {
      const settled = gate === null || gate();
      this.settleWaiters = this.settleWaiters.filter((w) => {
        if (!settled) { w.framesLeft = Math.max(w.framesLeft, 1); return true; }
        if (--w.framesLeft > 0) return true;
        w.resolve();
        return false;
      });
    }
  }
}
