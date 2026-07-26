// Fixed sim tick + render interpolation, mirroring of::SimClock semantics
// (fixedDt 1/60, catch-up capped so a stall can never spiral).
// ARCHITECTURE.md section 2.3 fixes the call ORDER, and ordering is the only
// thing that guarantees no consumer observes a half-rebased world:
//   input -> observer -> FloatingOrigin -> worker drain -> camera -> 4 passes.

import * as THREE from 'three';
import type { Services } from './Services.js';
import { STAKE_STRIDE } from '../render/debug/JitterProbe.js';

export type FixedStep = (dt: number, tick: number) => void;
export type Drain = () => void;

export interface FrameHash {
  w: number; h: number; hash: number; litPct: number;
  tilesX: number; tilesY: number; tiles: number[];
}

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
  /** Preallocated jitter stakes: [anchor xyz, local xyz] per stake (rule 6). */
  private readonly stakes = new Float64Array(16 * STAKE_STRIDE);

  constructor(private readonly s: Services) {}

  /** Fills the stake rows from live chunks only while the probe is armed. */
  private stakeCount(): number {
    if (!this.s.jitter.enabled) return 0;
    return this.s.terrain.probeStakes(this.stakes, 16);
  }

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

  /**
   * Advance `seconds` of SIM time on a synthetic clock at `renderHz`, then hand
   * control back to rAF. Two reasons this exists and neither is convenience:
   *
   * 1. Headless Chrome does not pump requestAnimationFrame continuously. A
   *    20 second scripted walk advanced 90 fixed ticks, because rAF fired in a
   *    short burst and the dt clamp threw the rest away. Every driven
   *    verification would have been silently measuring a standing still player.
   * 2. A 5 km walk at 4.6 m/s is 18 minutes of wall clock. Here it is a minute,
   *    and every tick genuinely runs: same fixedTick, same drain, same render.
   *
   * renderHz is deliberately NOT a multiple of 60, so of::SimClock's alpha
   * sweeps its whole range and the interpolation is exercised, not bypassed.
   */
  async run(seconds: number, renderHz = 144.3): Promise<void> {
    const wasRunning = this.running;
    this.stop();
    const dtMs = 1000 / renderHz;
    const total = Math.max(1, Math.round(seconds * renderHz));
    let now = performance.now();
    this.lastMs = now;
    this.acc = 0;
    for (let i = 0; i < total; ++i) {
      now += dtMs;
      this.frame(now);
      // Yield often enough that terrain.worker payloads actually land: a
      // postMessage needs a macrotask, and a chunk that never arrives makes a
      // driven walk look like it streams nothing.
      if ((i & 7) === 7) await new Promise<void>((r) => { setTimeout(r, 0); });
    }
    if (wasRunning) { this.lastMs = performance.now(); this.acc = 0; this.start(); }
  }

  /** Resolve after `n` rendered frames with nothing pending. Race-free captures. */
  settle(n = 8): Promise<void> {
    return new Promise((resolve) => this.settleWaiters.push({ framesLeft: n, resolve }));
  }

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
  frameHash(tilesX = 48, tilesY = 27): FrameHash {
    const { renderer, frame } = this.s;
    frame.render();
    const w = Math.max(1, Math.round(this.lastW * renderer.pixelRatio));
    const h = Math.max(1, Math.round(this.lastH * renderer.pixelRatio));
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
    return { w, h, hash, litPct: Math.round((lit / (w * h)) * 10000) / 100, tilesX, tilesY, tiles };
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
    observer.step(input.sample(), FIXED_DT);
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

    const { origin, observer, rig, frame, stats, renderer, jitter, zfight } = this.s;
    // of::SimClock alpha. Sampling a 60 Hz capsule at vsync WITHOUT this is a
    // staircase, and it is a far larger jitter source than float32 (JitterProbe).
    observer.interpolate(this.acc / FIXED_DT);
    origin.toEngine(observer.position, this.eye);
    rig.setView(this.eye, observer.position, observer.orientation);
    jitter.sample(rig.nearCam, this.stakes, this.stakeCount(), this.lastH);

    const cpuMs = performance.now() - t0;
    frame.render();
    // Read-backs must happen in the same task as the render or the default
    // framebuffer is already gone.
    if (zfight !== null) zfight.sample(renderer, rig, this.lastW, this.lastH, renderer.pixelRatio);
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
