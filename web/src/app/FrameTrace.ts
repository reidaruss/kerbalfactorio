// CE-51. THE PER-RENDERED-FRAME TRACE OF WHERE THE DECK IS RELATIVE TO THE EYE.
//
// Reid, real GPU, build `cfeffad`, with video: standing still on the station's
// deck STUTTERS rapidly. ~300 fps, first person, GROUNDED, 0.00 m/s, ORBIT,
// ~399 km, the rebase counter stepping 25 -> 26 across about two seconds, and
// one frame catching the station geometry DOUBLE-IMAGED mid-snap.
//
// ---------------------------------------------------------------------------
// WHY A NEW INSTRUMENT, AND WHY IT SAMPLES PER FRAME RATHER THAN PER TICK.
//
// Every carrier number this project has is per FIXED TICK, and all of them are
// green: the rider drifts 1.9e-9 m across 601 ticks. THE SIM IS GLUED. A stutter
// that the sim cannot see is by elimination in the RENDER path, and the render
// path runs at whatever the screen does, five times per tick on Reid's machine.
// A per-tick instrument samples exactly the instant at which the two agree and
// is blind to everything between, which is why the defect survived four probes
// and 100-plus checks. **A measurement whose sample rate equals the rate the
// system under test is corrected at cannot see the error it is corrected from.**
//
// ---------------------------------------------------------------------------
// THE THREE HYPOTHESES, NAMED BEFORE MEASURING, AND WHAT EACH WOULD LOOK LIKE.
//
//   (a) TWO CLOCKS. The camera is INTERPOLATED between fixed ticks
//       (`Controller.interpolate(acc/FIXED_DT)`), and the station's drawn pose
//       is written by `CarrierMount.syncAt` once per fixed tick with no
//       interpolation at all. At 1879.26 m/s the eye slides smoothly through
//       31.32 m per tick while the hull stands still and then jumps. Signature:
//       a SAWTOOTH of amplitude up to 31.32 m at exactly 60 Hz, correlated with
//       alpha, present on every frame and independent of the rebase.
//   (b) f32 RENDER-SPACE WOBBLE. Engine coordinates grow to the 4 km rebase
//       threshold, and float32 has ~2^-24 relative precision, so the worst
//       quantum is about 4000 * 6e-8 = 2.4e-4 m. Signature: noise BELOW a
//       millimetre, growing with distance from the origin, uncorrelated with
//       alpha.
//   (c) THE REBASE SNAP. Once every 4000 / 31.320920 = 127.7 ticks. Signature: a
//       single large sample on exactly the frames where `rebases` increments,
//       and nothing in between.
//
// The three differ by ORDERS OF MAGNITUDE and by PERIOD, so one run separates
// them. This file records enough to tell them apart rather than enough to
// confirm a guess: the deck-relative eye, the frame's own alpha, the engine
// distance from the origin, and the rebase counter, per frame.
//
// ---------------------------------------------------------------------------
// IT IS ARMED, BOUNDED AND OFF BY DEFAULT.
//
// A ring buffer with a fixed cap, filled from ONE `onPreRender` hook. Disarmed
// it is a boolean test per frame. It never allocates while armed (the ring is
// preallocated), because an instrument that allocates at 300 fps is measuring
// its own garbage collector.

import type { FloatingOrigin } from '../world/FloatingOrigin.js';

/** What a `SolidLike` needs to be for this to trace it: a live body-frame pose.
 *  `Solid` satisfies it, and this file imports nothing from `game/`. */
export interface TracedPose {
  readonly pos: { readonly x: number; readonly y: number; readonly z: number };
}

export interface FrameSample {
  /** Frame index since arming. */
  f: number;
  /** Loop tick at this frame. */
  tick: number;
  /** The render interpolation alpha the eye was placed with, 0..1. */
  alpha: number;
  /** Body-frame eye MINUS the DRAWN deck's body-frame position. The origin
   *  cancels out of this difference exactly, so it is the geometry the player
   *  sees, in metres, with no float32 in it. */
  rel: [number, number, number];
  /** |rel|, so a probe can difference scalars without re-deriving. */
  relM: number;
  /** CE-51. The same difference against the COLLIDER, which is posed at INTEGER
   *  ticks by design and must keep stepping. It is the control: after the fix
   *  the drawn channel goes flat and this one does NOT, which is the evidence
   *  that the sim path is untouched and that the instrument can still see the
   *  defect it was built to see. */
  colRel: [number, number, number];
  colRelM: number;
  /** How far the eye is from the floating origin, engine metres. This is what
   *  drives hypothesis (b): float32 precision is relative to magnitude. */
  engineM: number;
  /** The one rebase authority's counter, for hypothesis (c). */
  rebases: number;
}

/**
 * A bounded per-frame trace of the deck-relative eye.
 *
 * PROCESS-SCOPED and armed by the debug surface. It holds no body-scoped state
 * (the two objects it reads are handed in per sample), so a reboot does not
 * invalidate it and it does not need a `Lifetime`.
 */
export class FrameTrace {
  private ring: FrameSample[] = [];
  private cap = 0;
  private n = 0;
  private frames = 0;
  armed = false;

  /** Arm and clear. `cap` samples are kept; the ring keeps the LAST `cap`. */
  arm(cap: number): void {
    this.cap = Math.max(1, Math.min(4096, Math.floor(cap)));
    this.ring = new Array(this.cap);
    for (let i = 0; i < this.cap; i++) {
      this.ring[i] = { f: 0, tick: 0, alpha: 0, rel: [0, 0, 0], relM: 0,
        colRel: [0, 0, 0], colRelM: 0, engineM: 0, rebases: 0 };
    }
    this.n = 0;
    this.frames = 0;
    this.armed = true;
  }

  disarm(): void { this.armed = false; }

  /**
   * One frame. Called from `Loop`'s pre-render hook, AFTER the camera has been
   * placed, because the whole question is what the camera and the hull disagree
   * about at the instant the frame is drawn.
   *
   * Writes into the preallocated slot rather than pushing an object: at 300 fps
   * an allocating instrument measures its own collector.
   */
  sample(tick: number, alpha: number, origin: FloatingOrigin,
         eye: { x: number; y: number; z: number },
         drawn: { x: number; y: number; z: number } | null,
         collider: TracedPose | null): void {
    if (!this.armed || drawn === null || Number.isNaN(drawn.x)) return;
    const s = this.ring[this.n % this.cap];
    const dx = eye.x - drawn.x;
    const dy = eye.y - drawn.y;
    const dz = eye.z - drawn.z;
    s.f = this.frames++;
    s.tick = tick;
    s.alpha = alpha;
    s.rel[0] = dx; s.rel[1] = dy; s.rel[2] = dz;
    s.relM = Math.hypot(dx, dy, dz);
    const cx = collider === null ? dx : eye.x - collider.pos.x;
    const cy = collider === null ? dy : eye.y - collider.pos.y;
    const cz = collider === null ? dz : eye.z - collider.pos.z;
    s.colRel[0] = cx; s.colRel[1] = cy; s.colRel[2] = cz;
    s.colRelM = Math.hypot(cx, cy, cz);
    s.engineM = Math.hypot(eye.x - origin.origin.x, eye.y - origin.origin.y,
      eye.z - origin.origin.z);
    s.rebases = origin.rebases;
    this.n++;
  }

  /** Oldest-first, at most `cap`. */
  dump(): FrameSample[] {
    if (this.n <= this.cap) return this.ring.slice(0, this.n);
    const start = this.n % this.cap;
    return [...this.ring.slice(start), ...this.ring.slice(0, start)];
  }

  /**
   * THE VERDICT, DERIVED HERE SO EVERY READER GETS THE SAME ONE.
   *
   * `amplitudeM` is the peak-to-peak spread of the deck-relative eye ACROSS
   * FRAMES, which is exactly what a stutter is: the same standing player, the
   * same deck, drawn in a different relative place on consecutive frames. It is
   * taken per AXIS and then as the vector spread, because a sawtooth along the
   * orbit track and isotropic noise are different defects.
   *
   * `perTickAmplitudeM` is the same spread restricted to frames sharing a tick,
   * which is hypothesis (a)'s fingerprint and nothing else's: (b) does not care
   * about tick boundaries and (c) happens once every 128 of them.
   */
  verdict(): {
    frames: number; ticks: number; framesPerTick: number;
    amplitudeM: number; withinTickAmplitudeM: number;
    colliderAmplitudeM: number; colliderWithinTickAmplitudeM: number;
    alphaSpan: number; rebaseSteps: number; engineMaxM: number;
    corrAlpha: number;
  } {
    const d = this.dump();
    if (d.length === 0) {
      return { frames: 0, ticks: 0, framesPerTick: 0, amplitudeM: 0,
        withinTickAmplitudeM: 0, colliderAmplitudeM: 0,
        colliderWithinTickAmplitudeM: 0, alphaSpan: 0, rebaseSteps: 0,
        engineMaxM: 0, corrAlpha: 0 };
    }
    const spread = (rows: FrameSample[], key: 'rel' | 'colRel' = 'rel'): number => {
      let m = 0;
      for (let i = 0; i < 3; i++) {
        let lo = Infinity; let hi = -Infinity;
        for (const r of rows) {
          lo = Math.min(lo, r[key][i]); hi = Math.max(hi, r[key][i]);
        }
        m = Math.max(m, hi - lo);
      }
      return m;
    };
    const byTick = new Map<number, FrameSample[]>();
    for (const r of d) {
      const a = byTick.get(r.tick);
      if (a === undefined) byTick.set(r.tick, [r]); else a.push(r);
    }
    let within = 0;
    let colWithin = 0;
    for (const rows of byTick.values()) if (rows.length > 1) {
      within = Math.max(within, spread(rows));
      colWithin = Math.max(colWithin, spread(rows, 'colRel'));
    }
    // Correlation between alpha and the deck-relative offset along its own
    // dominant axis. Near +/-1 convicts (a): the error IS the interpolation.
    let ax = 0; let best = 0;
    for (let i = 0; i < 3; i++) {
      let lo = Infinity; let hi = -Infinity;
      for (const r of d) { lo = Math.min(lo, r.rel[i]); hi = Math.max(hi, r.rel[i]); }
      if (hi - lo > best) { best = hi - lo; ax = i; }
    }
    let sa = 0; let sv = 0;
    for (const r of d) { sa += r.alpha; sv += r.rel[ax]; }
    const ma = sa / d.length; const mv = sv / d.length;
    let num = 0; let da = 0; let dv = 0;
    for (const r of d) {
      const p = r.alpha - ma; const q = r.rel[ax] - mv;
      num += p * q; da += p * p; dv += q * q;
    }
    const corr = da > 0 && dv > 0 ? num / Math.sqrt(da * dv) : 0;
    let alo = Infinity; let ahi = -Infinity; let emax = 0;
    for (const r of d) {
      alo = Math.min(alo, r.alpha); ahi = Math.max(ahi, r.alpha);
      emax = Math.max(emax, r.engineM);
    }
    return {
      frames: d.length, ticks: byTick.size,
      framesPerTick: d.length / byTick.size,
      amplitudeM: spread(d), withinTickAmplitudeM: within,
      colliderAmplitudeM: spread(d, 'colRel'),
      colliderWithinTickAmplitudeM: colWithin,
      alphaSpan: ahi - alo,
      rebaseSteps: d[d.length - 1].rebases - d[0].rebases,
      engineMaxM: emax, corrAlpha: corr,
    };
  }
}

/**
 * CE-51. Register the one pre-render hook and hand back the `frames` op.
 *
 * THE HOOK GOES IN `onPreRender` because that is after `rig.setView` has placed
 * the camera for this frame: the question is what the eye and the hull disagree
 * about at the instant the frame draws, and anywhere earlier answers about the
 * previous one. Registered ONCE, disarmed, so the cost of not measuring is one
 * boolean test per frame.
 *
 * It lives here rather than in `DebugCarrier` because that file is at its
 * 400-line cap and because this is one idea: a debug surface should be able to
 * ask for the trace in a line.
 */
export function carrierFrameTrace(
  loop: { readonly tickIndex: number; readonly alpha: number;
          readonly onPreRender: (() => void)[] },
  read: () => {
    origin: FloatingOrigin;
    eye: { x: number; y: number; z: number };
    drawn: { x: number; y: number; z: number } | null;
    collider: TracedPose | null;
  },
): (a: unknown) => unknown {
  const trace = new FrameTrace();
  loop.onPreRender.push(() => {
    if (!trace.armed) return;
    const r = read();
    trace.sample(loop.tickIndex, loop.alpha, r.origin, r.eye, r.drawn,
      r.collider);
  });
  return (a: unknown): unknown => {
    const o = a as Record<string, unknown> | null;
    if (o?.['arm'] === true) {
      const n = o['n'];
      trace.arm(typeof n === 'number' && Number.isFinite(n) ? n : 600);
      return { armed: true };
    }
    if (o?.['arm'] === false) trace.disarm();
    return { armed: trace.armed, verdict: trace.verdict(),
             samples: o?.['dump'] === true ? trace.dump() : undefined };
  };
}
