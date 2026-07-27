// The driven surface for the post-processing stack.
//
// It exists because of standing rule 7 and because of what a screenshot cannot
// prove. "Ambient occlusion makes it look better" is not a measurement; "the
// junction between this machine and the ground is 34% darker than open ground
// four metres away, and open ground itself moved 0.4%" is. Both halves matter:
// the first says the effect is doing something, and the SECOND says it is not
// simply darkening the image, which is the failure that looks like success.
//
// Every comparison here toggles a flag INSIDE one settled frame pair, so the
// camera, the sun angle, the streamed chunk set and the terrain are identical
// between the two captures by construction rather than by care.

import type { Services } from './Services.js';
import type { Loop } from './Loop.js';
import type { PostFlags, PostTuning } from '../render/post/PostConfig.js';

export interface PostBox {
  readonly name: string;
  /** Centre in fractional image coords, origin TOP LEFT, matching a capture. */
  readonly x: number;
  readonly y: number;
  /** Half-width in pixels. */
  readonly half: number;
}

export interface PostBoxResult {
  name: string;
  lumWith: number;
  lumWithout: number;
  /** 1 - with/without. Positive means the effect DARKENED this box. */
  darkening: number;
  px: number;
}

export interface PostApi {
  post(): {
    flags: PostFlags; tune: PostTuning;
    timingsMs: Record<string, number>;
    calls: number; vramMB: number;
    sizes: { w: number; h: number; aoW: number; aoH: number };
    aoApplied: boolean;
  };
  setPost(f: Partial<PostFlags>): PostFlags;
  /**
   * Swap the FXAA program between three's unmodified source and the one with
   * the explicit level-0 fetch, in place, so the claim "this substitution
   * cannot change a pixel" can be framehashed inside one page at one settled
   * camera instead of argued from the absence of mipmaps.
   */
  setFxaaLod(implicit: boolean): boolean;
  setPostTune(t: Partial<PostTuning>): PostTuning;
  postAb(fx: keyof PostFlags, boxes: PostBox[]): Promise<{
    fx: string; boxes: PostBoxResult[]; wholeFrameDarkening: number;
    changedFraction: number; samplePx: number;
  }>;
  /**
   * The darkening an effect applies, resolved by SCREEN ROW and split into a
   * centre column and the two edge columns.
   *
   * Box-picking is the obvious way to measure ambient occlusion and it is the
   * wrong one, because whoever picks the boxes decides the answer. This picks
   * nothing: it reports every row band, and the comparison that matters is
   * between the CENTRE and the EDGES OF THE SAME ROW. Same row means the same
   * range to the camera, the same sun elevation and the same slice of the
   * lighting gradient, so the only quantity that differs between the two is
   * whether there is a machine standing there. That is the RN-8 circular-pit
   * argument applied to occlusion: make everything else equal by construction,
   * then attribute what is left.
   */
  postProfile(fx: keyof PostFlags, bands?: number): Promise<{
    fx: string; w: number; h: number; bands: number;
    rows: { y0: number; y1: number; centre: number; edges: number }[];
    medianDark: number; p99Dark: number; maxDark: number;
    changedFraction: number; litFraction: number; samplePx: number;
    /**
     * How ROUGH the effect's own output is: mean |d(x+1) - d(x)| over the
     * darkening image, divided by its mean magnitude. This is the number that
     * answers "what spatial frequency does this term occupy", which is the
     * actual question when two occlusion sources have to share a frame. A
     * magnitude alone cannot answer it: a smooth 10% and a speckled 10% are the
     * same number and only one of them is competing with a texture map.
     */
    roughness: number; gradEnergy: number; meanMag: number;
    /**
     * THE NOISE FLOOR OF THIS INSTRUMENT, measured rather than assumed.
     *
     * A profile differences two captures, and decoding a 1600x900 PNG takes
     * long enough that the first-person limbs and the near ground move between
     * them. So a third capture is taken with the effect back ON, and the
     * fraction of pixels that differ between the two ON captures is the floor
     * below which nothing this function reports means anything. Measured at
     * about 0.05 on a walk view, which is larger than some effects' entire
     * signal: without this number, "bloom changed 5% of pixels" reads as
     * evidence and is indistinguishable from the arms swaying.
     */
    noiseFraction: number;
  }>;
  /**
   * Isolated cost of one effect, as PAIRED repetitions rather than one A then
   * one B.
   *
   * The first version ran the effect off for five seconds, then on for five
   * seconds, and quoted the difference. Repeating it gave ambient occlusion
   * +0.8 ms once and -0.1 ms the next time, which is not a measurement, it is
   * a coin. The drift is between LEGS (clock and thermal state on a GPU being
   * driven flat out with the frame-rate limiter off), not within them, so the
   * fix is to pair the legs and take the MEDIAN of the paired differences, and
   * to publish the spread so that a delta smaller than its own spread is
   * visibly not a result.
   */
  postCost(fx: keyof PostFlags, secs?: number, reps?: number): Promise<{
    fx: string;
    off: { p50: number; p95: number; p99: number; worst: number; calls: number };
    on: { p50: number; p95: number; p99: number; worst: number; calls: number };
    deltaP50: number; deltaP99: number; deltaCalls: number;
    reps: number; deltasP50: number[]; spreadP50: number;
    /** True when the median delta is larger than the spread of the deltas. */
    resolved: boolean;
  }>;
}

interface Grab { data: Uint8ClampedArray; w: number; h: number }

async function grab(loop: Loop): Promise<Grab> {
  const blob = await loop.capture();
  const bmp = await createImageBitmap(blob);
  const cv = new OffscreenCanvas(bmp.width, bmp.height);
  const ctx = cv.getContext('2d');
  if (ctx === null) throw new Error('postAb: no 2d context');
  ctx.drawImage(bmp, 0, 0);
  const d = ctx.getImageData(0, 0, bmp.width, bmp.height).data;
  const w = bmp.width; const h = bmp.height;
  bmp.close();
  return { data: d, w, h };
}

const lumAt = (d: Uint8ClampedArray, i: number): number =>
  (d[i] * 77 + d[i + 1] * 151 + d[i + 2] * 28) / 256;

function boxMean(g: Grab, b: PostBox): { lum: number; px: number } {
  const cx = Math.round(b.x * g.w);
  const cy = Math.round(b.y * g.h);
  const x0 = Math.max(0, cx - b.half);
  const x1 = Math.min(g.w, cx + b.half);
  const y0 = Math.max(0, cy - b.half);
  const y1 = Math.min(g.h, cy + b.half);
  let sum = 0; let n = 0;
  for (let y = y0; y < y1; ++y) {
    for (let x = x0; x < x1; ++x) { sum += lumAt(g.data, (y * g.w + x) * 4); n++; }
  }
  return { lum: n > 0 ? sum / n : 0, px: n };
}

const r4 = (v: number): number => Math.round(v * 1e4) / 1e4;

export function postApi(s: Services, loop: Loop): PostApi {
  const stack = s.renderer.post;
  return {
    post() {
      return {
        flags: { ...stack.flags },
        tune: { ...stack.tune },
        timingsMs: { ...stack.timings },
        calls: stack.calls,
        vramMB: Math.round((stack.vram / 1048576) * 10) / 10,
        sizes: { ...stack.sizes },
        aoApplied: stack.aoApplied,
      };
    },
    setPost(f) { Object.assign(stack.flags, f); return { ...stack.flags }; },
    setFxaaLod(implicit) { return stack.setFxaaImplicitLod(implicit); },
    setPostTune(t) { Object.assign(stack.tune, t); return { ...stack.tune }; },

    async postAb(fx, boxes) {
      const was = stack.flags[fx];
      stack.flags[fx] = true;
      const withFx = await grab(loop);
      stack.flags[fx] = false;
      const without = await grab(loop);
      stack.flags[fx] = was;

      const out: PostBoxResult[] = boxes.map((b) => {
        const a = boxMean(withFx, b);
        const c = boxMean(without, b);
        return {
          name: b.name,
          lumWith: Math.round(a.lum * 100) / 100,
          lumWithout: Math.round(c.lum * 100) / 100,
          darkening: r4(c.lum > 0 ? 1 - a.lum / c.lum : 0),
          px: a.px,
        };
      });

      // The whole-frame number is the guard against a box-picking argument: an
      // effect that darkens everything shows up here even if every box was
      // chosen to flatter it.
      let sa = 0; let sb = 0; let changed = 0;
      const n = Math.min(withFx.data.length, without.data.length);
      for (let i = 0; i < n; i += 4) {
        const la = lumAt(withFx.data, i);
        const lb = lumAt(without.data, i);
        sa += la; sb += lb;
        if (Math.abs(la - lb) > 2) changed++;
      }
      const px = n / 4;
      return {
        fx: String(fx),
        boxes: out,
        wholeFrameDarkening: r4(sb > 0 ? 1 - sa / sb : 0),
        changedFraction: r4(changed / Math.max(1, px)),
        samplePx: px,
      };
    },

    async postProfile(fx, bands = 30) {
      const was = stack.flags[fx];
      stack.flags[fx] = true;
      const a = await grab(loop);
      stack.flags[fx] = false;
      const b = await grab(loop);
      stack.flags[fx] = true;
      const a2 = await grab(loop);
      stack.flags[fx] = was;
      const w = a.w; const h = a.h;
      let noise = 0;
      for (let i = 0; i < a.data.length; i += 4) {
        if (Math.abs(lumAt(a.data, i) - lumAt(a2.data, i)) > 2) noise++;
      }
      const bandH = Math.max(1, Math.floor(h / bands));
      // Centre column is the middle 16% of the width; the crosshair sits there,
      // so a probe that framed its subject has it in this column. Edges are the
      // outer 12% on each side, which at this framing is open ground.
      const cx0 = Math.floor(w * 0.42); const cx1 = Math.floor(w * 0.58);
      const ex1 = Math.floor(w * 0.12); const ex0 = Math.floor(w * 0.88);
      const rows: { y0: number; y1: number; centre: number; edges: number }[] = [];
      // Percentiles are taken over LIT pixels only, and the floor is the whole
      // point. `darkening` is 1 - with/without, so a pixel that was already
      // black without the effect divides by nothing and reads as 1.0 whatever
      // the effect did. The first version of this probe therefore reported p99
      // and max darkening of exactly 1.0000 and PASSED its "the 99th percentile
      // moves a lot" check on pixels ambient occlusion had never touched. That
      // is standing rule 11 in this file: a check passing on something it never
      // examined. A ratio metric needs a floor on its denominator, always.
      const LIT = 12;
      const lit = new Float32Array(w * h);
      let litN = 0;
      const all = new Float32Array(w * h);
      let changed = 0;
      for (let bi = 0; bi < bands; ++bi) {
        const y0 = bi * bandH;
        const y1 = Math.min(h, y0 + bandH);
        let cs = 0; let cn = 0; let es = 0; let en = 0;
        for (let y = y0; y < y1; ++y) {
          for (let x = 0; x < w; ++x) {
            const i = (y * w + x) * 4;
            const la = lumAt(a.data, i);
            const lb = lumAt(b.data, i);
            const d = lb >= LIT ? 1 - la / lb : 0;
            all[y * w + x] = d;
            if (lb >= LIT) lit[litN++] = d;
            if (Math.abs(la - lb) > 2) changed++;
            if (x >= cx0 && x < cx1) { cs += d; cn++; } else if (x < ex1 || x >= ex0) { es += d; en++; }
          }
        }
        rows.push({
          y0, y1,
          centre: r4(cn > 0 ? cs / cn : 0),
          edges: r4(en > 0 ? es / en : 0),
        });
      }
      // Gradient energy of the darkening image, over lit pixels only.
      let grad = 0; let gradN = 0; let mag = 0; let magN = 0;
      for (let y = 0; y < h; ++y) {
        for (let x = 0; x < w; ++x) {
          const d = all[y * w + x];
          if (d === 0) continue;
          mag += Math.abs(d); magN++;
          if (x + 1 < w) { grad += Math.abs(all[y * w + x + 1] - d); gradN++; }
        }
      }
      const meanMag = magN > 0 ? mag / magN : 0;
      const gradEnergy = gradN > 0 ? grad / gradN : 0;

      const sorted = lit.subarray(0, litN).slice().sort();
      const at = (q: number): number => (litN === 0 ? 0 : r4(sorted[Math.min(litN - 1,
        Math.max(0, Math.round(q * (litN - 1))))]));
      return {
        fx: String(fx), w, h, bands,
        rows,
        medianDark: at(0.5), p99Dark: at(0.99), maxDark: at(1),
        changedFraction: r4(changed / Math.max(1, w * h)),
        litFraction: r4(litN / Math.max(1, w * h)),
        samplePx: w * h,
        noiseFraction: r4(noise / Math.max(1, w * h)),
        roughness: r4(meanMag > 1e-6 ? gradEnergy / meanMag : 0),
        gradEnergy: r4(gradEnergy),
        meanMag: r4(meanMag),
      };
    },

    async postCost(fx, secs = 5, reps = 3) {
      const was = stack.flags[fx];
      const read = (): { p50: number; p95: number; p99: number; worst: number; calls: number } => {
        const st = s.stats.stats(s.renderer, s.frame.timings);
        return {
          p50: Math.round(st.frameMs.p50 * 1000) / 1000,
          p95: Math.round(st.frameMs.p95 * 1000) / 1000,
          p99: Math.round(st.frameMs.p99 * 1000) / 1000,
          worst: Math.round(st.frameMs.worst * 1000) / 1000,
          calls: st.draw.calls,
        };
      };
      // The ring is 600 frames deep, so each leg runs long enough to replace
      // every sample in it. A shorter leg reports a blend of both settings and
      // reads as "the effect is nearly free", which is the wrong answer in the
      // convenient direction.
      const d50: number[] = [];
      const d99: number[] = [];
      let off = read(); let on = read();
      for (let i = 0; i < reps; ++i) {
        stack.flags[fx] = false;
        await loop.run(secs);
        off = read();
        stack.flags[fx] = true;
        await loop.run(secs);
        on = read();
        d50.push(on.p50 - off.p50);
        d99.push(on.p99 - off.p99);
      }
      stack.flags[fx] = was;
      const med = (a: number[]): number => {
        const s = [...a].sort((x, y) => x - y);
        return s.length === 0 ? 0 : s[(s.length - 1) >> 1];
      };
      const r3 = (v: number): number => Math.round(v * 1000) / 1000;
      const spread = d50.length > 1 ? Math.max(...d50) - Math.min(...d50) : Infinity;
      const median50 = med(d50);
      return {
        fx: String(fx),
        off,
        on,
        deltaP50: r3(median50),
        deltaP99: r3(med(d99)),
        deltaCalls: on.calls - off.calls,
        reps,
        deltasP50: d50.map(r3),
        spreadP50: r3(spread),
        resolved: Math.abs(median50) > spread,
      };
    },
  };
}
