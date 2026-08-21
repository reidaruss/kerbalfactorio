// RN-2450. THE 4-PIXEL PHASE METER, and it exists because `latmeter.mjs` cannot
// see this defect: latmeter's autocorrelation walk starts at `minLag = 4`, so a
// repeat whose period IS 4 px is at or below its floor and returns "no local
// maximum" on a frame where the grid is unmissable by eye. Rather than lower
// that floor (which would make every latmeter reading in the project a
// different measurement), this asks the question a screen-space ordered dither
// actually poses.
//
//   node tools/smoke/rn2450bayer.mjs <frame.png> [--x=] [--y=] [--w=] [--h=] [--p=4]
//
// WHAT IT REPORTS. Every pixel in the patch is binned by (x mod p, y mod p),
// which is exactly the index a `mod(gl_FragCoord.xy, 4.0)` dither uses. It
// prints:
//   * `phaseSpread`, max minus min over the p*p phase MEANS. A surface with no
//     screen-locked pattern has no reason to differ between phases, so this is
//     near zero; an ordered dither drives it directly.
//   * `phaseStd`, the standard deviation over those means, which is the same
//     claim without one outlier bin deciding it.
//   * `patchStd`, over every pixel, because a fix that removes the pattern by
//     removing the material is not a fix (latmeter's own rule, kept).
//   * `ratio` = phaseStd / patchStd, the share of the patch's variance that is
//     phase-locked rather than image content.
//
// THE CONTROL THIS INSTRUMENT NEEDS, and it is free: run it at `--p=5` as well.
// A genuine 4-px dither has nothing at period 5, so `p=5` is the negative
// control on the SAME pixels, and a patch that reports a large spread at both
// is reporting image structure rather than a dither.
//
// Decoding is latmeter's route verbatim (playwright-core, about:blank, one data
// URL, nothing fetched) because this repo has no PNG decoder in node.
import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const files = args.filter((a) => !a.startsWith('--'));
const flag = (k, d) => {
  const m = args.find((a) => a.startsWith(`--${k}=`));
  return m === undefined ? d : Number(m.slice(k.length + 3));
};
if (files.length < 1) {
  console.error('usage: node tools/smoke/rn2450bayer.mjs <frame.png> [--x=] [--y=] [--w=] [--h=] [--p=4]');
  process.exit(2);
}
const X = flag('x', 1240);
const Y = flag('y', 596);
const W = flag('w', 256);
const H = flag('h', 96);
const P = flag('p', 4);

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage();
for (const f of files) {
  const u = `data:image/png;base64,${readFileSync(f).toString('base64')}`;
  const r = await page.evaluate(async ([url, x, y, w, h, p]) => {
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
    // The phase index must be the SCREEN coordinate, not the patch coordinate,
    // or a patch whose origin is not a multiple of p reports a rotated set of
    // phases and the spread survives while the labels are wrong.
    const sum = new Float64Array(p * p);
    const cnt = new Float64Array(p * p);
    let s1 = 0, s2 = 0;
    for (let j = 0; j < h; ++j) {
      for (let i = 0; i < w; ++i) {
        const k = 4 * (j * w + i);
        const L = 0.2126 * d[k] + 0.7152 * d[k + 1] + 0.0722 * d[k + 2];
        const px = (x + i) % p, py = (y + j) % p;
        sum[py * p + px] += L; cnt[py * p + px] += 1;
        s1 += L; s2 += L * L;
      }
    }
    const n = w * h;
    const patchStd = Math.sqrt(Math.max(s2 / n - (s1 / n) ** 2, 0));
    const means = [];
    for (let i = 0; i < p * p; ++i) means.push(cnt[i] ? sum[i] / cnt[i] : 0);
    const mn = Math.min(...means), mx = Math.max(...means);
    const mu = means.reduce((a, b) => a + b, 0) / means.length;
    const phaseStd = Math.sqrt(means.reduce((a, b) => a + (b - mu) ** 2, 0) / means.length);
    return { patchStd, phaseSpread: mx - mn, phaseStd, mean: mu };
  }, [u, X, Y, W, H, P]);
  if (r.error) { console.error(r.error); process.exit(1); }
  const name = f.split(/[\\/]/).pop();
  console.log(`${name.padEnd(46)} p=${P} (${X},${Y}) ${W}x${H}  phaseSpread=${r.phaseSpread.toFixed(3)}  phaseStd=${r.phaseStd.toFixed(3)}  patchStd=${r.patchStd.toFixed(3)}  ratio=${(r.phaseStd / (r.patchStd || 1)).toFixed(4)}`);
}
await browser.close();
