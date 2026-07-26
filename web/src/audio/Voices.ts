// EVERY SOUND IN THE GAME, SYNTHESISED. There is no audio asset, no download and
// no decode: a swing landing is an oscillator and an envelope, and the whole
// audio layer adds zero bytes to the payload.
//
// WHY THESE ARE FREE FUNCTIONS OVER `BaseAudioContext` and not methods on a
// mixer: an OfflineAudioContext is a BaseAudioContext too, so the SAME code that
// makes the noise in the game can be rendered headlessly into a buffer and
// measured. That is what turns "the play call returned" into "this voice
// produces a waveform with a peak of 0.31", which is the only claim worth making
// about a system a screenshot cannot show (DW-20).
//
// THE COST MODEL is deliberate. A one-shot is at most four nodes and they are
// all `start`ed with a `stop` time, so the graph collects itself; nothing is
// polled, nothing runs per frame, and an idle game holds two nodes total.
//
// PITCH VARIES PER HIT. A percussion sample retriggered at one pitch is the
// clearest tell that a sound is canned; every voice below takes a sequence
// number and detunes itself from a hash of it, so twenty swings are twenty
// slightly different impacts and none of them is random between replays.

/** Deterministic per-event jitter in [0,1). Same sequence, same sound. */
export function jit(seq: number, salt: number): number {
  let h = (Math.imul(seq + 0x9e3779b9, 0x85ebca6b) ^ Math.imul(salt + 0x165667b1, 0x27d4eb2f)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x2545f491) >>> 0;
  return ((h ^ (h >>> 13)) >>> 8) / 16777216;
}

const noiseCache = new WeakMap<BaseAudioContext, AudioBuffer>();

/** One second of white noise per context, built once and shared by every voice. */
export function noiseBuffer(ctx: BaseAudioContext): AudioBuffer {
  const hit = noiseCache.get(ctx);
  if (hit !== undefined) return hit;
  const n = Math.floor(ctx.sampleRate);
  const buf = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = buf.getChannelData(0);
  // Hashed, not Math.random: two runs of the same tape must sound identical.
  for (let i = 0; i < n; ++i) d[i] = jit(i, 1) * 2 - 1;
  noiseCache.set(ctx, buf);
  return buf;
}

function noise(ctx: BaseAudioContext, t: number, dur: number): AudioBufferSourceNode {
  const s = ctx.createBufferSource();
  s.buffer = noiseBuffer(ctx);
  s.loop = true;
  s.start(t, jit(Math.round(t * 997), 3) * 0.9);
  s.stop(t + dur);
  return s;
}

/** An exponential-ish decay envelope. `peak` at `t`, silence at `t + dur`. */
function env(ctx: BaseAudioContext, t: number, peak: number, dur: number,
             attack = 0.004): GainNode {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  return g;
}

function tone(ctx: BaseAudioContext, type: OscillatorType, hz: number,
              t: number, dur: number): OscillatorNode {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(hz, t);
  o.start(t);
  o.stop(t + dur);
  return o;
}

function band(ctx: BaseAudioContext, type: BiquadFilterType, hz: number,
              q: number): BiquadFilterNode {
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = hz;
  f.Q.value = q;
  return f;
}

export type Voice = (ctx: BaseAudioContext, out: AudioNode, t: number, seq: number) => number;

/** A percussive thunk: an axe landing in wood. Body plus a soft transient. */
export const thunk: Voice = (ctx, out, t, seq) => {
  const dur = 0.24;
  const hz = 104 * (0.9 + jit(seq, 11) * 0.24);
  const g = env(ctx, t, 0.42, dur, 0.006);
  const o = tone(ctx, 'sine', hz, t, dur);
  o.frequency.exponentialRampToValueAtTime(hz * 0.55, t + dur);
  o.connect(g).connect(out);
  const ng = env(ctx, t, 0.16, 0.075, 0.002);
  noise(ctx, t, 0.075).connect(band(ctx, 'lowpass', 900 + jit(seq, 13) * 500, 0.8))
    .connect(ng).connect(out);
  return dur;
};

/** A sharper crack: a pick on stone or ore. Mostly transient, little body. */
export const crack: Voice = (ctx, out, t, seq) => {
  const dur = 0.15;
  const ng = env(ctx, t, 0.30, 0.11, 0.001);
  noise(ctx, t, 0.11)
    .connect(band(ctx, 'bandpass', 1500 + jit(seq, 17) * 1400, 1.5))
    .connect(ng).connect(out);
  const hz = 220 * (0.85 + jit(seq, 19) * 0.35);
  const g = env(ctx, t, 0.16, dur, 0.002);
  const o = tone(ctx, 'triangle', hz, t, dur);
  o.frequency.exponentialRampToValueAtTime(hz * 0.4, t + dur);
  o.connect(g).connect(out);
  return dur;
};

/** A footstep: a short filtered scuff, quiet enough to live under everything. */
export const step: Voice = (ctx, out, t, seq) => {
  const dur = 0.09;
  const g = env(ctx, t, 0.085, dur, 0.003);
  noise(ctx, t, dur)
    .connect(band(ctx, 'lowpass', 520 + jit(seq, 23) * 320, 1.1))
    .connect(g).connect(out);
  return dur;
};

/** THE FELLED MOMENT: a node coming apart. Low rumble under a falling tone. */
export const collapse: Voice = (ctx, out, t, seq) => {
  const dur = 0.85;
  const ng = env(ctx, t, 0.34, dur, 0.012);
  noise(ctx, t, dur).connect(band(ctx, 'lowpass', 400, 0.7)).connect(ng).connect(out);
  const hz = 150 * (0.9 + jit(seq, 29) * 0.2);
  const g = env(ctx, t, 0.30, dur * 0.8, 0.01);
  const o = tone(ctx, 'sine', hz, t, dur);
  o.frequency.exponentialRampToValueAtTime(hz * 0.32, t + dur * 0.8);
  o.connect(g).connect(out);
  return dur;
};

/** A finished ingot: a two-note chime, fundamental and a fifth above it. */
export const chime: Voice = (ctx, out, t, seq) => {
  const dur = 0.55;
  const root = 523.25 * (1 + (seq % 3) * 0.0595);
  for (const [mul, amp, delay] of [[1, 0.16, 0], [1.4983, 0.11, 0.055]] as const) {
    const g = env(ctx, t + delay, amp, dur - delay, 0.006);
    tone(ctx, 'sine', root * mul, t + delay, dur - delay).connect(g).connect(out);
  }
  return dur;
};

/** A small confirmation: crafting, placing, taking. Two clicks, rising. */
export const confirm: Voice = (ctx, out, t, seq) => {
  const dur = 0.16;
  const base = 660 * (0.97 + jit(seq, 31) * 0.06);
  for (const [k, at] of [[1, 0], [1.5, 0.055]] as const) {
    const g = env(ctx, t + at, 0.12, 0.09, 0.003);
    tone(ctx, 'triangle', base * k, t + at, 0.09).connect(g).connect(out);
  }
  return dur;
};

/** Demolition: the confirmation run backwards, so removal is audibly not adding. */
export const undo: Voice = (ctx, out, t, seq) => {
  const dur = 0.20;
  const base = 520 * (0.97 + jit(seq, 37) * 0.06);
  for (const [k, at] of [[1.5, 0], [1, 0.06]] as const) {
    const g = env(ctx, t + at, 0.11, 0.10, 0.003);
    tone(ctx, 'square', base * k, t + at, 0.10).connect(g).connect(out);
  }
  const ng = env(ctx, t, 0.10, 0.14, 0.004);
  noise(ctx, t, 0.14).connect(band(ctx, 'lowpass', 700, 0.8)).connect(ng).connect(out);
  return dur;
};

/** Every one-shot by name, so a probe can render the whole set generically. */
export const VOICES: Record<string, Voice> = {
  thunk, crack, step, collapse, chime, confirm, undo,
};
