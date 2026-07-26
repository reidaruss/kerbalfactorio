// The game-facing sound surface: one call per event, plus the two continuous
// beds. Nothing above this file knows what an AudioNode is.
//
// TASTEFUL AND QUIET BEATS LOUD AND BUSY, and the shape of the code reflects it:
// there is exactly one hum and one fire bed for the WHOLE world, their level set
// from the nearest contributor's distance, rather than a voice per machine. Ten
// smelters in a row must sound like a factory, not like ten copies of one
// machine phasing against each other, and the O(1) graph is the same decision
// DW-8 made for belts.
//
// FOOTSTEPS ARE DRIVEN BY DISTANCE, NOT BY A TIMER. Cadence follows the walk
// because it is the walk: a step lands every STRIDE_M of ground covered, so
// sprinting speeds the rhythm up on its own and a stationary player is silent
// without a single special case.

import { AudioBus } from './AudioBus.js';
import { VOICES, jit, noiseBuffer, type Voice } from './Voices.js';
import { makeBed, windFilterOf } from './Beds.js';

function clamp01(v: number): number { return v < 0 ? 0 : v > 1 ? 1 : v; }

/** Metres of ground per footstep, and the speed below which walking is silent. */
const STRIDE_M = 1.75;
const WALK_MIN_MPS = 0.45;
/** Beyond this a machine contributes nothing to the beds. */
export const AUDIBLE_M = 26;

/**
 * What the world sounds like right now, all 0..1 except the two distances.
 *
 * W7: the game had event sounds and nothing else, so between two swings it was
 * SILENT, which is the single clearest tell that a thing is a tech demo. The
 * three new levels are the world's own bed: wind that opens up with altitude
 * and shuts when there is rock overhead, a subterranean rumble that does the
 * opposite, and insects in the Forest. Gameplay works the levels out (Ambience.ts)
 * and this file only knows how to make the noise.
 */
export interface Ambient {
  machineM: number;
  fireM: number;
  /** 0..1. Strength of the open-air wind, and how bright it is (gust/altitude). */
  wind?: number;
  windBright?: number;
  /** 0..1. Underground: a low rumble and the room it implies. */
  cave?: number;
  /** 0..1. Forest insects, out in the open. */
  life?: number;
}

type BedName = 'hum' | 'fire' | 'wind' | 'cave' | 'life';

export class Sfx {
  readonly bus = new AudioBus();
  private strideLeft = STRIDE_M;
  private seq = 0;
  private readonly beds = new Map<BedName, GainNode>();
  /** The wind's own lowpass, so a gust can open the filter and not just the gain. */
  private windTone: BiquadFilterNode | null = null;

  attach(): void { this.bus.attach(); }

  /** Fire a named one-shot. Silent (and free) when muted or not yet unlocked. */
  play(name: string, seq = this.seq++): number {
    const v = VOICES[name];
    const o = this.bus.out();
    if (v === undefined || o === null) return 0;
    const t0 = performance.now();
    const dur = v(o.ctx, o.dest, o.ctx.currentTime, seq);
    this.bus.spend(name, performance.now() - t0);
    return dur;
  }

  hit(kind: 'thunk' | 'crack', seq: number): void { this.play(kind, seq); }
  collapse(): void { this.play('collapse'); }
  chime(n: number): void { this.play('chime', n); }
  confirm(): void { this.play('confirm'); }
  undo(): void { this.play('undo'); }

  /** Advance the walk cadence. `dt` seconds at `speed` metres per second. */
  walk(dt: number, speed: number, grounded: boolean): void {
    if (!grounded || speed < WALK_MIN_MPS) { this.strideLeft = STRIDE_M * 0.35; return; }
    this.strideLeft -= speed * dt;
    if (this.strideLeft > 0) return;
    this.strideLeft += STRIDE_M;
    this.play('step');
  }

  /**
   * Set the two continuous beds from the nearest contributor of each.
   * Distances in metres; anything at or past AUDIBLE_M is silence. The nodes are
   * built on the first audible frame and then only their gain changes, so a
   * player walking past a running line costs one `setTargetAtTime` per frame.
   */
  ambience(a: Ambient): void {
    const o = this.bus.out();
    if (o === null) return;
    const level = (m: number): number => {
      if (!isFinite(m) || m >= AUDIBLE_M) return 0;
      const k = 1 - m / AUDIBLE_M;
      return k * k;                       // inverse-square-ish, and 0 at the edge
    };
    this.setBed('hum', level(a.machineM) * 0.16, o);
    this.setBed('fire', level(a.fireM) * 0.22, o);
    // THE WORLD'S OWN BED. Quiet on purpose: these run for ever, so anything
    // loud enough to notice as a sound is loud enough to hate within a minute.
    this.setBed('wind', clamp01(a.wind ?? 0) * 0.075, o);
    this.setBed('cave', clamp01(a.cave ?? 0) * 0.085, o);
    this.setBed('life', clamp01(a.life ?? 0) * 0.055, o);
    if (this.windTone !== null) {
      // Altitude and exposure open the filter, not just the gain: a ridge top
      // is a BRIGHTER wind, and a gain-only version reads as the same sound
      // turned up, which is exactly what a canned loop sounds like.
      this.windTone.frequency.setTargetAtTime(
        360 + 900 * clamp01(a.windBright ?? 0), o.ctx.currentTime, 0.8);
    }
  }

  private setBed(which: BedName, level: number,
                 o: { ctx: BaseAudioContext; dest: AudioNode }): void {
    let g = this.beds.get(which);
    if (g === undefined) {
      if (level <= 0.0005) return;        // never build a bed nobody can hear
      g = this.build(which, o);
      this.beds.set(which, g);
      this.bus.loops++;
    }
    // A quarter-second constant: walking past a machine fades, it does not cut.
    g.gain.setTargetAtTime(level, o.ctx.currentTime, 0.25);
  }

  private build(which: BedName,
                o: { ctx: BaseAudioContext; dest: AudioNode }): GainNode {
    if (which === 'hum') return this.buildHum(o);
    if (which === 'fire') return this.buildFire(o);
    const g = makeBed(which, o.ctx);
    g.connect(o.dest);
    if (which === 'wind') this.windTone = windFilterOf(g);
    return g;
  }

  /** A machine at work: a low pair of saws under a lowpass. Four nodes, once. */
  private buildHum(o: { ctx: BaseAudioContext; dest: AudioNode }): GainNode {
    const { ctx, dest } = o;
    const g = ctx.createGain();
    g.gain.value = 0;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 240;
    lp.Q.value = 0.6;
    for (const [hz, amp] of [[57, 1], [114, 0.45], [171, 0.18]] as const) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = hz;
      const a = ctx.createGain();
      a.gain.value = amp;
      osc.connect(a).connect(lp);
      osc.start();
    }
    lp.connect(g).connect(dest);
    return g;
  }

  /** A lit furnace: a noise bed through a bandpass, gated by a slow wobble. */
  private buildFire(o: { ctx: BaseAudioContext; dest: AudioNode }): GainNode {
    const { ctx, dest } = o;
    const g = ctx.createGain();
    g.gain.value = 0;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(ctx);
    src.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 780;
    bp.Q.value = 0.8;
    // The crackle: an LFO on the band's own gain, at an irrational-ish rate so
    // the pattern never lines up with itself and reads as fire, not as a pulse.
    const shape = ctx.createGain();
    shape.gain.value = 0.55;
    for (const [hz, depth] of [[7.3, 0.35], [1.7, 0.2]] as const) {
      const lfo = ctx.createOscillator();
      lfo.type = 'sine';
      lfo.frequency.value = hz;
      const d = ctx.createGain();
      d.gain.value = depth;
      lfo.connect(d).connect(shape.gain);
      lfo.start();
    }
    src.connect(bp).connect(shape).connect(g).connect(dest);
    src.start(0, jit(7, 5) * 0.5);
    return g;
  }

  stats(): unknown { return this.bus.stats(); }
}

/**
 * RENDER EVERY VOICE OFFLINE AND MEASURE IT.
 *
 * This is the audio layer's DW-20 answer. A screenshot cannot show sound and a
 * play counter only proves a function was called, so the same synth functions
 * the game uses are rendered into an OfflineAudioContext (which no autoplay
 * policy blocks) and the resulting waveform is measured. A voice that produces
 * silence fails here, which is precisely the failure a counter would hide.
 */
export async function renderVoices(): Promise<unknown> {
  const Off = (globalThis as { OfflineAudioContext?: typeof OfflineAudioContext })
    .OfflineAudioContext;
  if (Off === undefined) return { supported: false };
  const out: Record<string, { peak: number; rms: number; samples: number }> = {};
  for (const [name, v] of Object.entries(VOICES) as [string, Voice][]) {
    const rate = 44100;
    const ctx = new Off(1, Math.round(rate * 1.2), rate);
    v(ctx, ctx.destination, 0, 3);
    const buf = await ctx.startRendering();
    const d = buf.getChannelData(0);
    let peak = 0;
    let sum = 0;
    for (let i = 0; i < d.length; ++i) {
      const a = Math.abs(d[i]);
      if (a > peak) peak = a;
      sum += d[i] * d[i];
    }
    out[name] = {
      peak: Math.round(peak * 1e4) / 1e4,
      rms: Math.round(Math.sqrt(sum / d.length) * 1e4) / 1e4,
      samples: d.length,
    };
  }
  return { supported: true, voices: out };
}
