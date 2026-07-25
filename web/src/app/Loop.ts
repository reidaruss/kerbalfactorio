// Fixed sim tick + render interpolation, mirroring of::SimClock semantics
// (fixedDt 1/60, catch-up capped so a stall can never spiral).
// ARCHITECTURE.md section 2.3 fixes the call ORDER, and ordering is the only
// thing that guarantees no consumer observes a half-rebased world:
//   input -> observer -> FloatingOrigin -> worker drain -> camera -> 4 passes.

import * as THREE from 'three';
import type { Services } from './Services.js';

export type FixedStep = (dt: number, tick: number) => void;
export type Drain = () => void;

const FIXED_DT = 1 / 60;
const MAX_CATCHUP = 5;

export class Loop {
  readonly fixedDt = FIXED_DT;
  tickIndex = 0;
  frames = 0;
  /** Systems that advance on the fixed tick (terrain requests, sim intents). */
  readonly onFixedStep: FixedStep[] = [];
  /** Systems that apply worker payloads, once per rendered frame. */
  readonly onDrain: Drain[] = [];
  /** Returns false while streaming or asset work is still pending. */
  settleGate: (() => boolean) | null = null;

  private raf = 0;
  private lastMs = 0;
  private acc = 0;
  private running = false;
  private readonly eye = new THREE.Vector3();
  private lastW = 0;
  private lastH = 0;
  private settleWaiters: { framesLeft: number; resolve: () => void }[] = [];
  private captureWaiters: { resolve: (b: Blob) => void; reject: (e: unknown) => void }[] = [];

  constructor(private readonly s: Services) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastMs = performance.now();
    const tick = (now: number) => {
      if (!this.running) return;
      this.raf = requestAnimationFrame(tick);
      this.frame(now);
    };
    this.raf = requestAnimationFrame(tick);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  /** Resolve after `n` rendered frames with nothing pending. Race-free captures. */
  settle(n = 8): Promise<void> {
    return new Promise((resolve) => this.settleWaiters.push({ framesLeft: n, resolve }));
  }

  /** Captured inside the rAF callback, so preserveDrawingBuffer is not needed. */
  capture(): Promise<Blob> {
    return new Promise((resolve, reject) => this.captureWaiters.push({ resolve, reject }));
  }

  private resizeIfNeeded(): void {
    const c = this.s.renderer.domElement;
    const w = c.clientWidth || window.innerWidth;
    const h = c.clientHeight || window.innerHeight;
    if (w === this.lastW && h === this.lastH) return;
    this.lastW = w; this.lastH = h;
    this.s.renderer.setSize(w, h);
    this.s.rig.resize(w, h);
  }

  private fixedTick(): void {
    const { input, observer, origin } = this.s;
    const inp = input.sample();
    if (inp.dYaw !== 0 || inp.dPitch !== 0) observer.look(inp.dYaw, inp.dPitch);
    if (inp.zoom !== 0) observer.zoom(Math.pow(1.22, inp.zoom));
    observer.update();
    if (inp.fwd !== 0 || inp.right !== 0 || inp.up !== 0) {
      const v = observer.moveSpeed(inp.boost) * FIXED_DT;
      observer.move(inp.fwd * v, inp.right * v, inp.up * v);
      observer.update();
    }
    // THE rebase authority runs before any render read in the same tick.
    origin.step(observer.position);
    for (const fn of this.onFixedStep) fn(FIXED_DT, this.tickIndex);
    this.tickIndex++;
  }

  private frame(now: number): void {
    const t0 = performance.now();
    const dt = Math.min((now - this.lastMs) / 1000, 0.25);
    this.lastMs = now;
    this.acc += dt;
    let ticks = 0;
    while (this.acc >= FIXED_DT && ticks < MAX_CATCHUP) {
      this.acc -= FIXED_DT;
      this.fixedTick();
      ticks++;
    }
    if (ticks === MAX_CATCHUP) this.acc = 0;
    if (this.frames === 0) this.fixedTick();

    this.resizeIfNeeded();
    for (const fn of this.onDrain) fn();

    const { origin, observer, rig, frame, stats, renderer } = this.s;
    origin.toEngine(observer.position, this.eye);
    rig.setView(this.eye, observer.position, observer.orientation);

    const cpuMs = performance.now() - t0;
    frame.render();
    this.frames++;
    stats.sample(performance.now() - t0, cpuMs);

    if (this.captureWaiters.length > 0) {
      const waiters = this.captureWaiters.splice(0);
      renderer.capture().then(
        (b) => waiters.forEach((w) => w.resolve(b)),
        (e) => waiters.forEach((w) => w.reject(e)),
      );
    }
    if (this.settleWaiters.length > 0) {
      const settled = this.settleGate === null || this.settleGate();
      this.settleWaiters = this.settleWaiters.filter((w) => {
        if (!settled) { w.framesLeft = Math.max(w.framesLeft, 1); return true; }
        if (--w.framesLeft > 0) return true;
        w.resolve();
        return false;
      });
    }
  }
}
