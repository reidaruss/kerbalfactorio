// THE WORLD'S CONTINUOUS BEDS: wind, the underground, and the Forest.
//
// W6 gave the game seven event voices and two machine beds, and between two
// swings the planet was SILENT. That silence is the loudest tell that a thing is
// a tech demo, so this file adds the layer that is always there and that nobody
// should ever consciously notice.
//
// THREE RULES, all of them about not being annoying.
//
//   ONE graph per bed for the WHOLE world, built the first time it is audible
//   and never rebuilt. That is the DW-8 argument again: a wind source per chunk
//   would be a thousand oscillators phasing against each other.
//
//   NOTHING IS PERIODIC. A loop the ear can learn is worse than no loop at all,
//   so every modulator here runs at an irrational-ish rate against the others
//   and the pattern does not repeat inside any session a human will sit through.
//
//   THE LEVELS ARE ARGUMENTS, not decisions made here. Gameplay decides how
//   windy a ridge is (Ambience.ts); this file only knows how to make the noise,
//   which is what lets the same functions be rendered offline and MEASURED
//   (DW-20) rather than asserted to exist.
//
// COST. Wind is two filters and one buffer source; the cave is three; the Forest
// is one source, one bandpass and two LFOs. Nothing is polled, nothing allocates
// per frame, and the whole set is a fixed handful of nodes for any world size.

import { noiseBuffer } from './Voices.js';

/** Every bed this file can build, so a probe can render the set generically. */
export const BEDS = ['wind', 'cave', 'life'] as const;
export type BedKind = (typeof BEDS)[number];

/** A looping noise source. One shared buffer per context, started at a phase. */
function loopNoise(ctx: BaseAudioContext, offset: number): AudioBufferSourceNode {
  const s = ctx.createBufferSource();
  s.buffer = noiseBuffer(ctx);
  s.loop = true;
  s.start(0, offset);
  return s;
}

function filter(ctx: BaseAudioContext, type: BiquadFilterType, hz: number,
                q: number): BiquadFilterNode {
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = hz;
  f.Q.value = q;
  return f;
}

/** An LFO driving `param` by +/- depth about its current value. */
function lfo(ctx: BaseAudioContext, hz: number, depth: number,
             param: AudioParam): OscillatorNode {
  const o = ctx.createOscillator();
  o.type = 'sine';
  o.frequency.value = hz;
  const g = ctx.createGain();
  g.gain.value = depth;
  o.connect(g).connect(param);
  o.start();
  return o;
}

/**
 * WIND. Noise through a lowpass with a slow gust on the gain and a slower one on
 * the cutoff, so a gust is brighter as well as louder, which is what wind
 * actually does and what a gain-only version conspicuously does not.
 *
 * The lowpass is tagged so Sfx can retune it from altitude and exposure: on a
 * ridge the wind opens up, and a metre of rock overhead shuts it.
 */
function buildWind(ctx: BaseAudioContext): GainNode {
  const out = ctx.createGain();
  out.gain.value = 0;
  const lp = filter(ctx, 'lowpass', 420, 0.7);
  const hp = filter(ctx, 'highpass', 90, 0.5);
  const gust = ctx.createGain();
  gust.gain.value = 0.62;
  loopNoise(ctx, 0.11).connect(hp).connect(lp).connect(gust).connect(out);
  // Three gusts at rates with no common period: 0.083, 0.19 and 0.037 Hz are
  // 12 s, 5 s and 27 s, and their sum does not repeat for hours.
  lfo(ctx, 0.083, 0.30, gust.gain);
  lfo(ctx, 0.19, 0.12, gust.gain);
  lfo(ctx, 0.037, 240, lp.frequency);
  windFilters.set(out, lp);
  return out;
}

/**
 * UNDERGROUND. Not wind and not silence: a low room tone with a slow swell, and
 * a very quiet high band that gives the space an edge. Nothing rhythmic, because
 * a drip on a timer is the fastest way to make a cave feel authored.
 */
function buildCave(ctx: BaseAudioContext): GainNode {
  const out = ctx.createGain();
  out.gain.value = 0;
  const low = filter(ctx, 'lowpass', 150, 0.9);
  const swell = ctx.createGain();
  swell.gain.value = 0.7;
  loopNoise(ctx, 0.37).connect(low).connect(swell).connect(out);
  lfo(ctx, 0.041, 0.26, swell.gain);
  // A narrow band well above the rumble: the "big empty room" cue, at a level
  // that is felt rather than heard.
  const air = filter(ctx, 'bandpass', 1750, 4.0);
  const airGain = ctx.createGain();
  airGain.gain.value = 0.035;
  loopNoise(ctx, 0.63).connect(air).connect(airGain).connect(out);
  lfo(ctx, 0.023, 0.02, airGain.gain);
  return out;
}

/**
 * THE FOREST. Insects rather than birds, deliberately: a bird call is a MELODY,
 * and a synthesised one either sounds like a synthesiser or has to be authored
 * note by note, which is a content problem this game does not need. A cicada bed
 * is a narrow noise band pulsed at about 11 Hz, it is unmistakably alive, and it
 * sits under everything without ever asking for attention.
 */
function buildLife(ctx: BaseAudioContext): GainNode {
  const out = ctx.createGain();
  out.gain.value = 0;
  const band = filter(ctx, 'bandpass', 4300, 9.0);
  const pulse = ctx.createGain();
  pulse.gain.value = 0.5;
  loopNoise(ctx, 0.29).connect(band).connect(pulse).connect(out);
  // The chirp rate, and a slow drift in how insistent the chorus is.
  lfo(ctx, 11.3, 0.42, pulse.gain);
  lfo(ctx, 0.061, 0.22, pulse.gain);
  lfo(ctx, 0.017, 380, band.frequency);
  return out;
}

/** The wind bed's own lowpass, kept out of band so the graph stays plain nodes. */
const windFilters = new WeakMap<GainNode, BiquadFilterNode>();

export function windFilterOf(g: GainNode): BiquadFilterNode | null {
  return windFilters.get(g) ?? null;
}

/** Build one bed, silent, ready to be faded up. */
export function makeBed(kind: BedKind, ctx: BaseAudioContext): GainNode {
  if (kind === 'wind') return buildWind(ctx);
  if (kind === 'cave') return buildCave(ctx);
  return buildLife(ctx);
}

/**
 * RENDER EVERY BED OFFLINE AND MEASURE IT (DW-20).
 *
 * Same argument as renderVoices: a screenshot cannot show sound, a counter only
 * proves a call was made, and the failure a counter hides is exactly the one
 * that matters here, which is a bed that runs for ever producing silence.
 * Each bed is rendered at full gain for a second and a half, and the RMS is what
 * is checked: a bed with a peak but no body is a click, not a bed.
 */
export async function renderBeds(): Promise<unknown> {
  const Off = (globalThis as { OfflineAudioContext?: typeof OfflineAudioContext })
    .OfflineAudioContext;
  if (Off === undefined) return { supported: false };
  const out: Record<string, { peak: number; rms: number }> = {};
  for (const kind of BEDS) {
    const rate = 44100;
    const ctx = new Off(1, Math.round(rate * 1.5), rate);
    const g = makeBed(kind, ctx);
    g.gain.value = 1;
    g.connect(ctx.destination);
    const buf = await ctx.startRendering();
    const d = buf.getChannelData(0);
    let peak = 0;
    let sum = 0;
    for (let i = 0; i < d.length; ++i) {
      const a = Math.abs(d[i]);
      if (a > peak) peak = a;
      sum += d[i] * d[i];
    }
    out[kind] = {
      peak: Math.round(peak * 1e4) / 1e4,
      rms: Math.round(Math.sqrt(sum / d.length) * 1e4) / 1e4,
    };
  }
  return { supported: true, beds: out };
}
