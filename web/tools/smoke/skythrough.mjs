// Sky seen THROUGH a crown, as a fraction of the crown's own area (RN-72's
// instrument, promoted from a one-off to a tool for RN-183).
//
//   node tools/smoke/skythrough.mjs shot.png x0 y0 x1 y1
//
// Per image column inside the box: find the topmost and bottommost non-sky
// pixel, and count sky pixels STRICTLY BETWEEN them. The ratio of that count
// to the crown span is what "the canopy opens" means as a number: notching at
// the silhouette edge does not score (it moves the bounds instead), only
// interior holes do. RN-72 measured the shipped conifer at 7.87% to 17.23%
// with exactly this reduction.
//
// SKY CLASSIFICATION is the instrument's assumption and it is printed so a
// misaimed box announces itself: a pixel is sky when its blue channel exceeds
// both others by 15 counts. That is true of this stack's daytime sky gradient
// and false of every foliage, bark and terrain colour in the frame; aim the
// box at a crown standing against SKY, never against ground or water, and
// check `columnsWithCrown` covers most of the box width.
//
// Decoding happens in a browser for pngdiff.mjs's reason: the repo has no PNG
// decoder and playwright-core is already a dependency.

import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
if (args.length < 5) {
  console.error('usage: node tools/smoke/skythrough.mjs <shot.png> x0 y0 x1 y1');
  process.exit(2);
}
const [file, ...box] = args;
const [x0, y0, x1, y1] = box.map(Number);

const dataUrl = `data:image/png;base64,${readFileSync(file).toString('base64')}`;

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage();
const out = await page.evaluate(async ([u, bx0, by0, bx1, by1]) => {
  const im = await new Promise((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = rej;
    i.src = u;
  });
  const c = document.createElement('canvas');
  c.width = im.width; c.height = im.height;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(im, 0, 0);
  const d = g.getImageData(0, 0, im.width, im.height).data;
  const isSky = (x, y) => {
    const i = (y * im.width + x) * 4;
    return d[i + 2] > d[i] + 15 && d[i + 2] > d[i + 1] + 15;
  };
  let crownPx = 0; let holePx = 0; let cols = 0;
  for (let x = bx0; x < bx1; ++x) {
    let top = -1; let bot = -1;
    for (let y = by0; y < by1; ++y) {
      if (!isSky(x, y)) { if (top < 0) top = y; bot = y; }
    }
    if (top < 0 || bot <= top) continue;
    cols++;
    for (let y = top + 1; y < bot; ++y) {
      crownPx++;
      if (isSky(x, y)) holePx++;
    }
  }
  return {
    box: { x0: bx0, y0: by0, x1: bx1, y1: by1 },
    columnsWithCrown: cols, columnsInBox: bx1 - bx0,
    crownPx, holePx,
    skyThroughPct: crownPx > 0 ? +(100 * holePx / crownPx).toFixed(2) : null,
  };
}, [dataUrl, x0, y0, x1, y1]);
await browser.close();
console.log(JSON.stringify(out, null, 2));
if (out.error !== undefined) process.exit(1);
