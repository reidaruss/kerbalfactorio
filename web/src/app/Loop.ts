// Fixed sim tick + render interpolation, mirroring of::SimClock semantics
// (fixedDt 1/60, catch-up capped so a stall can never spiral).
// ARCHITECTURE.md section 2.3 fixes the call ORDER, and ordering is the only
// thing that guarantees no consumer observes a half-rebased world:
//   input -> observer -> FloatingOrigin -> worker drain -> camera -> 4 passes.

import * as THREE from 'three';
import type { Services } from './Services.js';
import { STAKE_STRIDE } from '../render/debug/JitterProbe.js';
import { FrameDiff, type FrameDiffStats } from '../render/debug/FrameDiff.js';

export type FixedStep = (dt: number, tick: number) => void;
export type Drain = () => void;

export interface FrameHash {
  w: number; h: number; hash: number; litPct: number;
  /** Clear-colour pixels with terrain above them. See Loop.countHoles. */
  holePixels: number;
  tilesX: number; tilesY: number; tiles: number[];
  /** Per-pixel second difference against the two previous frameHash calls. */
  diff: FrameDiffStats;
}

/** Consecutive opaque pixels that mark the horizon in countHoles. */
const HORIZON_RUN_PX = 6;

const FIXED_DT = 1 / 60;
const MAX_CATCHUP = 5;

/**
 * CE-130. `lastMs` before the first rAF frame of a live run.
 *
 * A sentinel rather than a number, because there IS no correct number: the
 * only clock a live delta may be built from is the rAF timestamp sequence
 * itself, and before the first callback no timestamp from that sequence
 * exists. rAF timestamps are non-negative, so -1 cannot collide with one.
 */
const NOT_STAMPED = -1;

/** The alpha every consumer of the render instant agrees on. See `renderTick`. */
function clamp01(a: number): number { return a <= 0 ? 0 : a >= 1 ? 1 : a; }

export class Loop {
  readonly fixedDt = FIXED_DT;
  tickIndex = 0;
  frames = 0;
  /** Systems that advance on the fixed tick (terrain requests, sim intents). */
  readonly onFixedStep: FixedStep[] = [];
  /** Systems that apply worker payloads, once per rendered frame. */
  readonly onDrain: Drain[] = [];
  /** Systems that need the camera already placed (shadow cascade fitting). */
  readonly onPreRender: Drain[] = [];
  /** Returns false while streaming or asset work is still pending. */
  settleGate: (() => boolean) | null = null;

  /**
   * Sim time in seconds: tickIndex / 60, NOT performance.now(). Everything with
   * a visual ramp (the terrain cross-fade today, machine animation later) reads
   * this, so a driven run on the synthetic clock advances it at the same rate a
   * real one does and a headless capture is never caught mid-dissolve.
   */
  get simSecs(): number { return this.tickIndex * FIXED_DT; }

  /**
   * CE-51. The render interpolation alpha the LAST frame was drawn with, 0..1.
   *
   * A REPORT FIELD. `frame()` already computes `this.acc / FIXED_DT` and hands
   * it to `observer.interpolate`; this publishes the same number so anything
   * drawing in the same frame can be placed at the SAME fractional tick rather
   * than at the last integer one. Before it existed the camera was interpolated
   * and the station's hull was not, which at 1879.26 m/s is up to 31.32 m of
   * relative sawtooth per tick, on every frame, and is the stutter Reid filmed.
   *
   * The fractional tick a frame is drawn at is `tickIndex - 1 + alpha`: the
   * interpolation runs from the PREVIOUS tick's pose to the current one.
   *
   * CE-131. THIS FIELD IS RAW AND `renderTick` IS CLAMPED, deliberately. The
   * report field must be able to say "the invariant broke and here is by how
   * much" (FrameTrace and `__of.gameplay().stationDraw` both read it), while
   * the DRAWN instant must not be able to express a pose nobody stepped to.
   */
  alpha = 1;

  /**
   * CE-51. `tickIndex - 1 + alpha`: the exact instant the last frame drew.
   * One expression, here, so no consumer writes the off-by-one itself.
   *
   * CE-131. THE ALPHA IS CLAMPED TO [0, 1] HERE, MATCHING THE TWO OBSERVERS,
   * AND THE CHOICE IS ABOUT WHAT HAPPENS WHEN THE INVARIANT FAILS ANYWAY.
   *
   * With CE-130's stamping in place a live alpha cannot leave [0, 1): a
   * non-negative dt cannot drive `acc` below zero, and the drain loop leaves
   * `acc < FIXED_DT` or zeroes it at MAX_CATCHUP. So this clamp is dead code
   * in a healthy frame, and `alphaClamps` below is the standing proof of it.
   *
   * It is here because the failure mode it removes is the one RN-2030 filmed.
   * `Controller.interpolate` and `VesselObserver.interpolate` both open with
   * `alpha <= 0 ? 0 : alpha >= 1 ? 1 : alpha`, so an out-of-range alpha pins
   * the EYE to an integer tick. Unclamped here, the same alpha sent the DRAWN
   * hull to a fractional tick the camera was not at, and `CarrierFrame.poseAt`
   * happily extrapolates: measured at 30.07 m per unit alpha on a deck that
   * travels 31.32 m per tick, i.e. the station sliding out from under a
   * stationary camera (rendering.md section 7c).
   *
   * THE FAILURE SEMANTICS THIS PICKS: a frame whose clock is out of range
   * draws the world at the NEAREST INTEGER TICK, which is the last pose the
   * simulation actually produced. A late frame therefore repeats the previous
   * tick's pose, and the drawn world never extrapolates past a state the sim
   * has reached. It can look FROZEN for a frame; it cannot look WRONG, and it
   * cannot disagree with the eye, because the eye resolves the same alpha the
   * same way. The rejected alternative was removing the observers' clamps so
   * everything extrapolates together: coherent, but it buys a camera that pops
   * on every stall to fix a case that CE-130 has already made unreachable, and
   * an extrapolated eye is a motion-sickness defect rather than a stutter.
   *
   * The getter is PURE. `alphaClamps` is incremented where `alpha` is
   * assigned, once per frame, because a counter driven from here would count
   * readers instead of frames and `clock()` would tick it by reading itself.
   */
  get renderTick(): number { return this.tickIndex - 1 + clamp01(this.alpha); }

  /**
   * CE-130 / CE-131. THE THREE GUARD COUNTERS, published so "this guard is
   * dead code" is a measurement rather than an argument. See `clock()`.
   */
  dtFloors = 0;
  dtCeils = 0;
  alphaClamps = 0;
  /** The most negative dt any live frame has handed `step`, in seconds. */
  dtMinS = 0;

  /**
   * The clock census: what the guards have caught since the page loaded.
   *
   * `dtFloors` is the RN-2035 zero-clamp's activation count and CE-130's
   * whole claim is that it stays 0 on a live run. `alphaClamps` is the same
   * for `renderTick`. A driven run cannot move either (its dt is
   * `1 / renderHz` and its alpha is therefore in range by construction), so a
   * nonzero reading is always about real rAF frames.
   */
  clock(): {
    tick: number; frames: number; alpha: number; renderTick: number;
    dtFloors: number; dtCeils: number; alphaClamps: number; dtMinS: number;
    stamped: boolean;
  } {
    return {
      tick: this.tickIndex, frames: this.frames,
      alpha: this.alpha, renderTick: this.renderTick,
      dtFloors: this.dtFloors, dtCeils: this.dtCeils,
      alphaClamps: this.alphaClamps, dtMinS: this.dtMinS,
      stamped: this.lastMs !== NOT_STAMPED,
    };
  }

  private raf = 0;
  /**
   * CE-130. THE PREVIOUS LIVE FRAME'S rAF TIMESTAMP, OR `NOT_STAMPED`.
   *
   * It used to be stamped from `performance.now()` in two places (`start` and
   * `run`'s handoff) and from the rAF timestamp in a third (`frame`), and
   * MIXING THE TWO IS THE WHOLE OF RN-2030. rAF's `now` is the instant the
   * frame's rendering steps BEGAN, not the instant the callback runs, so a
   * `performance.now()` taken from a task inside that same frame is LATER
   * than the timestamp the next callback is handed, and `now - lastMs` comes
   * back negative. Stamped only from rAF, both operands are drawn from one
   * sequence that the spec requires to be non-decreasing, so the subtraction
   * cannot be negative and the RN-2035 floor below has nothing to do.
   */
  private lastMs = NOT_STAMPED;
  private acc = 0;
  /**
   * FS-101. THE ACCUMULATOR A DRIVEN RUN CARRIES, kept apart from the live one.
   *
   * `run()` used to advance the LIVE accumulator, and its own comment explains
   * why it refused to zero it first: zeroing snaps alpha to 0, which is a
   * one-tick discontinuity in the interpolated eye, and a probe calling run()
   * in slices would then measure its own slicing as jitter. That reasoning is
   * correct and this change keeps every bit of it. What it missed is where the
   * inherited value COMES FROM: the live accumulator is the residue of real
   * rAF frames whose dt is `performance.now()`, so a scripted run inherited a
   * uniformly random offset in [0, FIXED_DT) and yielded a wall-clock-dependent
   * number of fixed ticks.
   *
   * MEASURED (`probes/walkdet.js`, three runs of one fixed tape on one seed):
   * `of.run(4)` advanced 480, 480 and 479 ticks, and the walker's f64 feet were
   * bit-identical at equal tick counts and 0.0765 m apart at unequal ones,
   * which is exactly one tick of a 4.6 m/s walk. Downstream (FS-99) that one
   * tick moved the build ghost's aim point across 1.000 m cell boundaries at
   * different moments and `probes/assembler.js` laid 46 to 64 belt tiles for
   * one gesture over one deterministic 47.8 m walk.
   *
   * A driven accumulator that starts at zero and is CARRIED from one driven run
   * to the next keeps the slicing continuity the old comment protected, and
   * makes a scripted run a function of its own arguments and nothing else.
   *
   * GP-1013 FINISHED THE SENTENCE ABOVE, because it was not true yet. FS-101
   * removed the wall clock from the ACCUMULATOR and left it in the CLOCK: `run`
   * seeded a synthetic timeline at `performance.now()` and then had `frame`
   * reconstruct each dt as `(now - lastMs) / 1000`, a subtraction of two large
   * floats. See `run` and `step`.
   */
  private drivenAcc = 0;
  private running = false;
  private readonly eye = new THREE.Vector3();
  private lastW = 0;
  private lastH = 0;
  private settleWaiters: { framesLeft: number; resolve: () => void }[] = [];
  private captureWaiters: { resolve: (b: Blob) => void; reject: (e: unknown) => void }[] = [];
  /** Preallocated jitter stakes: [anchor xyz, local xyz] per stake (rule 6). */
  private readonly stakes = new Float64Array(16 * STAKE_STRIDE);
  private readonly frameDiff = new FrameDiff();

  constructor(private readonly s: Services) {}

  /** Fills the stake rows from live chunks only while the probe is armed. */
  private stakeCount(): number {
    if (!this.s.jitter.enabled) return 0;
    return this.s.terrain.probeStakes(this.stakes, 16, this.eye);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    // CE-130. THE ONE STAMPING SITE IS `frame`, AND IT IS AN rAF TIMESTAMP.
    // This used to read `performance.now()`, which is a different clock READING
    // (the same time base, but sampled at a different instant) from the `now`
    // the next callback is handed, and the difference of the two is signed.
    // Handing the first frame the sentinel makes it stamp itself and advance by
    // zero, which is also the honest answer: no sim time passed while the loop
    // was not running.
    this.lastMs = NOT_STAMPED;
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
   *
   * 3. FS-101. A SCRIPTED RUN IS A FUNCTION OF ITS OWN ARGUMENTS. Every dt here
   *    is synthetic already; the one wall-clock quantity left was the
   *    accumulator this inherited from the live loop, and that alone decided
   *    whether `run(4)` advanced 479 fixed ticks or 480. See `drivenAcc`.
   *
   * 4. GP-1013. IT WAS STILL NOT A FUNCTION OF ITS OWN ARGUMENTS, because the
   *    dt was not synthetic after all: it was RECONSTRUCTED. This method used
   *    to seed a synthetic timeline at `performance.now()`, walk it forward by
   *    `dtMs` per frame, and hand each absolute position to `frame`, which
   *    recovered the step as `(now - lastMs) / 1000`. That subtraction is two
   *    large floats, and its error is the ULP OF THE WALL CLOCK: `now` is
   *    milliseconds since page load, so at 20 s its ULP is about 3.6e-12 ms and
   *    at 40 s twice that. At `renderHz = 60` the recovered dt is `FIXED_DT` to
   *    within exactly that error, and `acc >= FIXED_DT` in `step` is therefore
   *    DECIDED BY IT: one ULP short and the frame delivers no tick at all.
   *
   *    MEASURED (`of.run(1.0, 60)` as the first driven call on a fresh page,
   *    `drivenAcc` provably 0, same build, same seed, ten sessions): QUIET the
   *    call delivered 60, 60, 60, 60, 60 ticks; with the box's twelve cores
   *    pegged at 100% it delivered 60, 59, 60, 59, 60. The two short runs are
   *    exactly the two whose `performance.now()` was largest (35645.5 ms and
   *    39737.5 ms against 21678.6 to 28380.8 for every full one), and feeding
   *    those six seeds into the arithmetic above off-line reproduces the six
   *    tick counts exactly. That is the whole causal chain: a busy box boots
   *    slower, a slower boot makes `performance.now()` bigger, a bigger
   *    `performance.now()` has a coarser ULP, and the coarser ULP eats a tick.
   *    The same sweep at the default render rate, under the same load, gave 60
   *    ticks 3 of 3, because there the accumulator never sits on the threshold.
   *
   *    THE FIX IS TO STOP RECONSTRUCTING WHAT WE ALREADY KNOW. A driven frame's
   *    step is `1 / renderHz` by construction (bit-identical to the old
   *    `dtMs / 1000` at every rate, checked), so it is passed to `step`
   *    directly and no wall-clock value enters a driven run at any point.
   */
  async run(seconds: number, renderHz = 144.3): Promise<void> {
    const wasRunning = this.running;
    this.stop();
    const dt = 1 / renderHz;
    const total = Math.max(1, Math.round(seconds * renderHz));
    // The accumulator is NOT reset, for the reason `drivenAcc` restates:
    // zeroing it snaps alpha to 0, which is a one-tick discontinuity in the
    // interpolated eye, and a probe that calls run() in slices would then
    // measure its own slicing as jitter. It is SWAPPED instead, so the value
    // carried between driven runs is the previous driven run's own residue and
    // never the live loop's wall clock.
    const liveAcc = this.acc;
    this.acc = this.drivenAcc;
    for (let i = 0; i < total; ++i) {
      this.step(dt);
      // Yield often enough that terrain.worker payloads actually land: a
      // postMessage needs a macrotask, and a chunk that never arrives makes a
      // driven walk look like it streams nothing.
      if ((i & 7) === 7) await new Promise<void>((r) => { setTimeout(r, 0); });
    }
    this.drivenAcc = this.acc;
    this.acc = liveAcc;
    // CE-130. `start()` re-arms the sentinel, so the handoff no longer stamps
    // `lastMs` from `performance.now()` at all. That stamp was the near half of
    // RN-2030's negative delta: it happens inside a task that can run AFTER the
    // browser has already taken the next frame's rAF timestamp, so the very
    // first live frame back could be handed a `now` earlier than the stamp.
    if (wasRunning) this.start();
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
    const { input, observer, origin, ride, mounts, player } = this.s;
    // CE-33. THE CARRIER SANDWICH, and the ordering is the whole of it: the
    // walker steps INSIDE the carrier's frame and is transformed out before
    // anything else in this tick reads its position. `ride.tick` takes the step
    // as a callback rather than exposing a before/after pair, so there is no
    // way for this call site to do half of it; with nothing boarded it is
    // `step()` and nothing else. Note it must be HERE and not in `onFixedStep`:
    // `origin.step` on the next line reads `observer.position`, and a carried
    // walker whose transport ran after the rebase would be rebasing against
    // last tick's position.
    const step = (): void => { observer.step(input.sample(), FIXED_DT); };
    if (ride === null) step();
    else ride.tick(this.tickIndex, FIXED_DT, step);
    // THE rebase authority runs before any render read in the same tick.
    origin.step(observer.position);
    for (const fn of this.onFixedStep) fn(FIXED_DT, this.tickIndex);
    this.tickIndex++;
    // CE-85. CARRIER-LOCAL GEOMETRY, AFTER THE INCREMENT, AND THE POSITION IS
    // THE WHOLE DECISION.
    //
    // `CarrierRide.tick(t)` runs the walker's own step "against geometry at
    // pose A", where A is `poseAt(t)` (CarrierRide.ts step 2), and leaves the
    // rider at pose B = `poseAt(t+1)`. So the deck has to be AT `poseAt(t)`
    // when tick `t` steps, and at `poseAt(t+1)` by the time anything draws.
    // Syncing here, with `tickIndex` already advanced, satisfies both with ONE
    // call: the frame is put at the tick that is about to run, so the render
    // between ticks sees the deck and the rider at the same instant, and the
    // next `fixedTick` finds the geometry already where its own step needs it.
    //
    // Syncing at the TOP instead would leave every drawn frame showing the deck
    // one tick behind the person standing on it: 31.32 m at Anchorage's real
    // orbital speed, which is a player floating outside their own station.
    //
    // With no mount registered this is an empty loop, which is the same shape
    // `ride` has with nothing boarded: a world with no carrier runs the
    // instruction sequence it ran before any of this existed.
    mounts.syncAt(this.tickIndex);
    // CE-40. AND THEN, IN THE SAME BREATH, WHO IS ON IT.
    //
    // THE SITE IS THE WHOLE CORRECTNESS ARGUMENT and it is one line long: this
    // is the ONE instant in the tick at which the deck and the rider are both
    // described at `tickIndex`. `syncAt` on the line above has just put the
    // geometry at `poseAt(tickIndex)`, and `ride.tick` above left the walker at
    // pose B = `poseAt(tickIndex)` as well (it ran with the PREVIOUS index and
    // transports over [t, t+1]). So a distance measured here is a real one.
    //
    // In `onFixedStep` (the loop above, before the increment) it would not be:
    // there the rider is already at `poseAt(t+1)` while the geometry is still at
    // `poseAt(t)`, 31.32 m apart at Anchorage's own orbital speed, and the
    // membership test would be answering about a deck that is a tick stale. It
    // would read healthy in every frozen fixture and be wrong the day the
    // station moves, which is failure mode F5 in `probes/stationboard.js`.
    //
    // With no walker, or with no mount, this is one null check and a `find` over
    // an empty list.
    if (ride !== null && player !== null) {
      const f = player.body.feet;
      mounts.decideAt(ride, f.x, f.y, f.z);
    }
  }

  /**
   * The LIVE clock read, and nothing else. Splitting it off `step` is the whole
   * of GP-1013: this is the only place a wall-clock timestamp is turned into a
   * duration, so a driven run cannot pick one up by accident. rAF is the sole
   * caller.
   *
   * CE-130. AND NOW THE ONLY PLACE A LIVE TIMESTAMP IS RECORDED, which is what
   * makes a negative delta unrepresentable rather than merely guarded. Both
   * operands of the subtraction are rAF timestamps for the same document, and
   * the HTML spec requires that sequence to be non-decreasing, so `dt >= 0` is
   * a property of the arithmetic rather than of the floor in `step`. Two frames
   * that share a timestamp give exactly 0, which is the correct answer.
   *
   * It stays a LIVE CLOCK READ ONLY (GP-1013): the value comes in as an
   * argument from rAF and nothing here reads a clock of its own.
   */
  private frame(now: number): void {
    if (this.lastMs === NOT_STAMPED) { this.lastMs = now; this.step(0); return; }
    const dt = (now - this.lastMs) / 1000;
    this.lastMs = now;
    this.step(dt);
  }

  /**
   * One rendered frame advanced by `dt` SECONDS. The clamp stays here rather
   * than at the two call sites so both paths keep the catch-up guarantee a
   * stalled tab needs; a driven `dt` of `1 / renderHz` is far under it at any
   * rate a probe would ask for.
   *
   * RN-2035. THE CLAMP IS TWO-SIDED, and CE-130 KEPT IT AS DEFENCE IN DEPTH
   * AFTER REMOVING THE THING IT DEFENDED AGAINST.
   *
   * The history: `frame()` built dt as `(rAF now - lastMs) / 1000` while
   * `start()` and `run()`'s handoff stamped `lastMs` from `performance.now()`,
   * so a live frame could carry a NEGATIVE dt, which drove `acc` and `alpha`
   * negative and, through an UNCLAMPED `renderTick`, slid the drawn station out
   * from under a frozen camera at 30.07 m per unit alpha (rendering.md 7c).
   * RN-2035 floored the delta here. CE-130 removed the mixed clock instead, so
   * `dt >= 0` now holds by construction of the subtraction (see `frame`), and
   * CE-131 clamped `renderTick` so an out-of-range alpha could not reach the
   * drawn world even if one arrived.
   *
   * The floor stays because a guard that is provably dead costs one `Math.max`
   * and removing it would make the next mixed clock silent again. `dtFloors`
   * counts its activations, so "dead" is a reading a probe takes rather than a
   * claim this comment makes. Zero remains the right floor rather than a fudge:
   * a frame whose clock ran backwards has had no time pass and must draw at the
   * accumulator it already had.
   *
   * A driven run reaches neither guard: its dt is `1 / renderHz` by
   * construction (FS-101, GP-1013), and a non-negative dt cannot put alpha
   * outside [0, 1).
   */
  private step(dtIn: number): void {
    const t0 = performance.now();
    if (dtIn < 0) { this.dtFloors++; this.dtMinS = Math.min(this.dtMinS, dtIn); }
    else if (dtIn > 0.25) this.dtCeils++;
    const dt = Math.min(Math.max(dtIn, 0), 0.25);
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
    // CE-51. ONE ALPHA, PUBLISHED BEFORE IT IS USED, so the hull and the eye can
    // be placed at the same fractional tick. See `alpha` above.
    this.alpha = this.acc / FIXED_DT;
    // CE-131. ONE COUNT PER FRAME, at the one site alpha is written, so
    // `alphaClamps` is a frame count and not a reader count. See `renderTick`.
    if (this.alpha < 0 || this.alpha > 1) this.alphaClamps++;
    observer.interpolate(this.alpha);
    // CE-51. AND THE DRAWN CARRIER GEOMETRY AT THE SAME INSTANT, which is the
    // whole of the stutter fix. The collider was already posed at the integer
    // tick by `fixedTick` and must stay there (the walker's step was resolved
    // against it); the HULL is drawn now, so it is posed now. Before this line
    // the eye interpolated and the hull did not, and on Anchorage that is a
    // measured 27.04 m of peak-to-peak sawtooth per tick, correlated with alpha
    // at 0.9999999860.
    //
    // BEFORE `onPreRender`, because `StationView.sync` runs there and recomposes
    // its engine transform from the f64 pose this writes. After it would draw
    // last frame's pose, which is the same defect one frame later.
    this.s.mounts.syncWatchersAt(this.renderTick);
    origin.toEngine(observer.position, this.eye);
    rig.setView(this.eye, observer.position, observer.orientation);
    jitter.sample(rig.nearCam, this.stakes, this.stakeCount(), this.lastH, origin.origin);
    for (const fn of this.onPreRender) fn();

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
