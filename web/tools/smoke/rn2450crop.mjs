// RN-2450. CROP AND MAGNIFY, written down as a tool because World Audit R4's
// decisive finding was invisible at 1x in a 1600x900 frame and invisible to
// every NUMBER the project had.
//
//   node tools/smoke/rn2450crop.mjs <in.png> <out.png> x y w h [scale]
//
// WHY IT EXISTS. FIDELITY-GAP section 3 Option D makes the eye the verdict and
// the instruments the rails, and an eye cannot judge a 4-pixel artefact in a
// full frame. The audit's contact-shadow dither (rendering.md 2.27) reads as a
// faint texture at 1x and as unmistakable graph paper at 4x, and the before/
// after pair that convicted it is two crops, not two whole frames. Every audit
// before this one cropped by hand in a scratchpad script that the next lane
// overwrote (NUMBERS.md, "the scratchpad is shared between lanes").
//
// NEAREST-NEIGHBOUR ON PURPOSE. `imageSmoothingEnabled = false`, because a
// smoothed magnification of a per-pixel pattern is a picture of the resampler.
// A crop that blurs the thing you are judging is worse than no crop.
//
// Decoding happens in a browser rather than in node for `latmeter.mjs`'s
// reason: this repo has no PNG decoder installed and playwright-core is already
// a dependency. The page is about:blank with one data URL, so nothing is
// fetched.
import { chromium } from 'playwright-core';
import { readFileSync, writeFileSync } from 'node:fs';

const [inp, outp, X, Y, W, H, SC] = process.argv.slice(2);
if (!inp || !outp || X === undefined || Y === undefined || W === undefined || H === undefined) {
  console.error('usage: node tools/smoke/rn2450crop.mjs <in.png> <out.png> x y w h [scale]');
  process.exit(2);
}
const x = +X, y = +Y, w = +W, h = +H, s = SC ? +SC : 3;
const b64 = readFileSync(inp).toString('base64');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage();
await page.goto('about:blank');
const out = await page.evaluate(async ({ b64, x, y, w, h, s }) => {
  const img = new Image();
  img.src = 'data:image/png;base64,' + b64;
  await img.decode();
  if (x + w > img.width || y + h > img.height) {
    return { error: `crop ${x},${y} ${w}x${h} does not fit in ${img.width}x${img.height}` };
  }
  const c = document.createElement('canvas');
  c.width = w * s; c.height = h * s;
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = false;
  g.drawImage(img, x, y, w, h, 0, 0, w * s, h * s);
  return { url: c.toDataURL('image/png') };
}, { b64, x, y, w, h, s });
await browser.close();
if (out.error) { console.error(out.error); process.exit(1); }
writeFileSync(outp, Buffer.from(out.url.slice('data:image/png;base64,'.length), 'base64'));
console.log(`crop ${inp} (${x},${y}) ${w}x${h} x${s} -> ${outp}`);
