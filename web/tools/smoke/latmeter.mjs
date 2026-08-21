// RN-2420. THE LATTICE METER: the instrument world audit R3 section 4.2 used to
// measure the aerial lattice, written down as a tool so the pass condition can
// be re-run by somebody who did not take the frame.
//
//   node tools/smoke/latmeter.mjs frame.png [--x=900] [--y=620] [--w=256] [--h=128]
//
// What it reports, and every choice here is the audit's own wording:
//   * the DOMINANT PERIOD ACROSS, from a 1-D DFT of the patch's COLUMN MEANS
//     with DC and the three lowest bins removed. The low bins carry the ground's
//     own large-scale shading, which is not a repeat, and leaving them in makes
//     every patch report a period equal to the patch.
//   * PEAK / MEDIAN of the surviving amplitude spectrum, which is what says the
//     dominant bin is a LINE rather than the top of a smooth hump.
//   * the first local autocorrelation MAXIMUM AFTER the first local MINIMUM.
//     NUMBERS.md's rule: a decaying autocorrelation's global maximum is always
//     at the smallest lag and is a smoothness measure, not a repeat measure.
//   * the patch STD, because a fix that removes the repeat by removing the
//     material is not a fix, and the std is what tells the two apart.
//
// Decoding happens in a browser rather than in node for pngdiff.mjs's reason:
// this repo has no PNG decoder installed and playwright-core is already a
// dependency. The page is about:blank with one data URL, so nothing is fetched.

import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const files = args.filter((a) => !a.startsWith('--'));
const flag = (k, d) => {
  const m = args.find((a) => a.startsWith(`--${k}=`));
  return m === undefined ? d : Number(m.slice(k.length + 3));
};
if (files.length < 1) {
  console.error('usage: node tools/smoke/latmeter.mjs <frame.png> [--x=] [--y=] [--w=] [--h=]');
  process.exit(2);
}
const X = flag('x', 900);
const Y = flag('y', 620);
const W = flag('w', 256);
const H = flag('h', 128);
// The number of low bins dropped WITH the DC term. The audit dropped three.
const DROP = flag('drop', 3);
// Which channel the series is built from. `luma` is the frame measure and the
// default; `r`, `g`, `b` and `a` exist so the same instrument can be pointed at
// a CARRIER TEXTURE, whose channels are four different fields and whose luma is
// therefore a mixture of a value, a normal and a detail map.
const CHAN = (args.find((a) => a.startsWith('--chan=')) ?? '--chan=luma').slice(7);

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage();
const rows = [];
for (const f of files) {
  const u = `data:image/png;base64,${readFileSync(f).toString('base64')}`;
  const r = await page.evaluate(async ([url, x, y, w, h, drop, chan]) => {
    const im = await new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i); i.onerror = rej; i.src = url;
    });
    const c = document.createElement('canvas');
    c.width = im.width; c.height = im.height;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(im, 0, 0);
    if (x + w > im.width || y + h > im.height) {
      return { error: `patch ${x},${y} ${w}x${h} does not fit in ${im.width}x${im.height}` };
    }
    const d = g.getImageData(x, y, w, h).data;
    const lum = new Float64Array(w * h);
    for (let i = 0; i < w * h; ++i) {
      lum[i] = chan === 'r' ? d[4 * i]
        : chan === 'g' ? d[4 * i + 1]
        : chan === 'b' ? d[4 * i + 2]
        : chan === 'a' ? d[4 * i + 3]
        : 0.2126 * d[4 * i] + 0.7152 * d[4 * i + 1] + 0.0722 * d[4 * i + 2];
    }
    // Patch std, over every pixel.
    let m = 0; for (let i = 0; i < lum.length; ++i) m += lum[i]; m /= lum.length;
    let v = 0; for (let i = 0; i < lum.length; ++i) v += (lum[i] - m) * (lum[i] - m);
    const std = Math.sqrt(v / lum.length);
    // Column means.
    const col = new Float64Array(w);
    for (let cx = 0; cx < w; ++cx) {
      let s = 0;
      for (let cy = 0; cy < h; ++cy) s += lum[cy * w + cx];
      col[cx] = s / h;
    }
    let cm = 0; for (let i = 0; i < w; ++i) cm += col[i]; cm /= w;
    const sig = Array.from(col, (t) => t - cm);
    // DFT amplitude, bins 1..w/2, then drop the lowest `drop` of them.
    const amp = [];
    for (let k = 1; k <= w / 2; ++k) {
      let re = 0, im2 = 0;
      for (let n = 0; n < w; ++n) {
        const a = (-2 * Math.PI * k * n) / w;
        re += sig[n] * Math.cos(a); im2 += sig[n] * Math.sin(a);
      }
      amp.push({ k, a: Math.hypot(re, im2) / w });
    }
    const kept = amp.slice(drop);
    let best = kept[0];
    for (const e of kept) if (e.a > best.a) best = e;
    const sorted = kept.map((e) => e.a).sort((p, q) => p - q);
    const med = sorted[Math.floor(sorted.length / 2)];
    // Autocorrelation of the column-mean series, normalised by lag 0.
    const r0 = sig.reduce((s, t) => s + t * t, 0);
    const ac = [1];
    for (let L = 1; L < w / 2; ++L) {
      let s = 0;
      for (let n = 0; n + L < w; ++n) s += sig[n] * sig[n + L];
      ac.push(s / r0);
    }
    // First local minimum, then the first local maximum after it.
    let minL = -1;
    for (let L = 1; L < ac.length - 1; ++L) {
      if (ac[L] <= ac[L - 1] && ac[L] < ac[L + 1]) { minL = L; break; }
    }
    let maxL = -1, maxV = -Infinity;
    if (minL >= 0) {
      for (let L = minL + 1; L < ac.length - 1; ++L) {
        if (ac[L] >= ac[L - 1] && ac[L] > ac[L + 1]) { maxL = L; maxV = ac[L]; break; }
      }
      if (maxL < 0) { maxV = Math.max(...ac.slice(minL + 1)); }
    }
    return {
      period: w / best.k, k: best.k, peakOverMedian: best.a / med,
      std, acLag: maxL, acMax: maxV, firstMinLag: minL,
    };
  }, [u, X, Y, W, H, DROP, CHAN]);
  rows.push({ f, ...r });
  if (r.error) { console.log(`${f}  ERROR ${r.error}`); continue; }
  console.log([
    f.replace(/^.*[\\/]/, '').padEnd(46),
    `period=${r.period.toFixed(2)}px`,
    `peak/med=${r.peakOverMedian.toFixed(2)}`,
    r.acLag > 0 ? `acMax=${r.acMax.toFixed(3)} at lag ${r.acLag}`
      : `acMax=none (best after first min ${r.acMax.toFixed(3)})`,
    `std=${r.std.toFixed(2)}`,
  ].join('  '));
}
await browser.close();
