// RN-2560 (rendering, LANE N9). THE LIVE/DEAD MAP AS A SHARE, not as a picture.
//
// `rn2560stage.mjs --png=` writes five frames of one pose, one per ISOLATE arm
// (`?treelinepaint=3+k`), in which stage k is painted 0.20 and every other
// terrain fragment is painted exactly black. This tool reads all five and
// classifies every pixel by ARGMAX over the five arms.
//
// WHY ARGMAX AND NOT A HUE TEST ON THE ONE COLOURED FRAME. A hue test has to
// separate the paint from the props, the grass and the sky, which are not
// painted at all and can wear any colour; the argmax has to separate the paint
// from ITSELF. A pixel that is not a terrain fragment renders IDENTICALLY in
// all five arms, so its spread is zero and it falls out as `other` rather than
// being mis-assigned. The threshold is on the spread, not on a level.
//
//   node tools/smoke/rn2560map.mjs docs/screenshots/RN2560_forestair
//
// The HUD is an HTML overlay and IS in the capture, so the same left/bottom
// exclusion pngdiff.mjs uses is applied here, and for the same reason.
//
// Decoding happens in a headless browser because this repo has no PNG decoder
// installed and playwright-core is already a dependency; that is pngdiff.mjs's
// own argument and its own mechanism.

import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const prefix = args.find((a) => !a.startsWith('--'));
const flag = (k, d) => {
  const m = args.find((a) => a.startsWith(`--${k}=`));
  return m === undefined ? d : Number(m.slice(k.length + 3));
};
if (!prefix) {
  console.error('usage: node tools/smoke/rn2560map.mjs <prefix-without-_sN.png>');
  process.exit(2);
}
const left = flag('left', 210);
const bottom = flag('bottom', 80);
// 4 counts of spread between the brightest and the dimmest arm. Below that the
// pixel did not respond to the flag at all and is not a terrain fragment.
const spread = flag('spread', 4);

const urls = [0, 1, 2, 3, 4].map((k) =>
  `data:image/png;base64,${readFileSync(`${prefix}_s${k}.png`).toString('base64')}`);

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage();
const out = await page.evaluate(async ([srcs, left_, bottom_, spread_]) => {
  const load = (s) => new Promise((res) => {
    const i = new Image(); i.onload = () => res(i); i.src = s;
  });
  const imgs = await Promise.all(srcs.map(load));
  const { width: W, height: H } = imgs[0];
  const data = imgs.map((im) => {
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const x = c.getContext('2d', { willReadFrequently: true });
    x.drawImage(im, 0, 0);
    return x.getImageData(0, 0, W, H).data;
  });
  const counts = [0, 0, 0, 0, 0];
  let other = 0;
  let total = 0;
  for (let y = 0; y < H - bottom_; ++y) {
    for (let xp = left_; xp < W; ++xp) {
      const i = (y * W + xp) * 4;
      ++total;
      let hi = -1; let lo = 1e9; let arg = -1;
      for (let k = 0; k < 5; ++k) {
        const d = data[k];
        const L = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
        if (L > hi) { hi = L; arg = k; }
        if (L < lo) lo = L;
      }
      if (hi - lo < spread_) { ++other; continue; }
      ++counts[arg];
    }
  }
  return { W, H, total, other, counts };
}, [urls, left, bottom, spread]);
await browser.close();

const terrain = out.counts.reduce((a, b) => a + b, 0);
const names = ['s0 SCALED (term compiled out)', 's1 GATE REFUSED',
  's2 INSIDE 690 m (zero by design)', 's3 EVALUATED, ZERO', 's4 LIVE'];
console.log(`${prefix}  ${out.W}x${out.H}  scanned ${out.total} px`
  + `  terrain ${terrain}  other ${out.other}`);
for (let k = 0; k < 5; ++k) {
  const px = out.counts[k];
  console.log(`  ${names[k].padEnd(34)} ${String(px).padStart(9)} px`
    + `  ${(100 * px / Math.max(1, terrain)).toFixed(2)}% of terrain`
    + `  ${(100 * px / out.total).toFixed(2)}% of frame`);
}
