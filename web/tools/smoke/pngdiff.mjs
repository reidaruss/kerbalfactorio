// Numeric diff of two captured frames, for the case INSTRUMENTS.md names: a
// frame in which the change occupies a few per cent of the pixels cannot be
// judged by looking at it, and RN-61 nearly reported "no visible change" for a
// change that plainly worked.
//
//   node tools/smoke/pngdiff.mjs before.png after.png [--left=210] [--bottom=80]
//
// It reports the SPLIT as well as the count, because the split is the property
// assertion and the count is only the magnitude. A darkening must come out
// overwhelmingly darker (RN-62: 26,361 against 483). A SILHOUETTE change must
// move pixels BOTH ways (RN-63: 12,715 against 13,764), and one coming out 98%
// darker would mean it had shaded something instead of reshaping it.
//
// Decoding happens in a browser rather than in node because this repo has no
// PNG decoder installed and playwright-core is already a dependency. The page
// is about:blank with two data URLs, so nothing is fetched.

import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const files = args.filter((a) => !a.startsWith('--'));
const flag = (k, d) => {
  const m = args.find((a) => a.startsWith(`--${k}=`));
  return m === undefined ? d : Number(m.slice(k.length + 3));
};
if (files.length !== 2) {
  console.error('usage: node tools/smoke/pngdiff.mjs <before.png> <after.png>');
  process.exit(2);
}
// The HUD is an HTML overlay and IS in the capture, so it is excluded by
// rectangle. Both defaults are the region RN-61 to RN-63 measured over.
const left = flag('left', 210);
const bottom = flag('bottom', 80);
// 6 counts: below that is dither and tone-curve noise on this stack.
const thresh = flag('thresh', 6);

const dataUrl = (p) => `data:image/png;base64,${readFileSync(p).toString('base64')}`;

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage();
const out = await page.evaluate(async ([ua, ub, l, b, t]) => {
  const load = (u) => new Promise((res, rej) => {
    const im = new Image();
    im.onload = () => res(im);
    im.onerror = rej;
    im.src = u;
  });
  const [A, B] = await Promise.all([load(ua), load(ub)]);
  if (A.width !== B.width || A.height !== B.height) {
    return { error: `size mismatch ${A.width}x${A.height} against ${B.width}x${B.height}` };
  }
  const grab = (im) => {
    const c = document.createElement('canvas');
    c.width = im.width; c.height = im.height;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(im, 0, 0);
    return g.getImageData(0, 0, im.width, im.height).data;
  };
  const da = grab(A), db = grab(B);
  let total = 0, moved = 0, darker = 0, lighter = 0, max = 0, sum = 0;
  for (let y = 0; y < A.height - b; ++y) {
    for (let x = l; x < A.width; ++x) {
      const i = (y * A.width + x) * 4;
      const d0 = db[i] - da[i], d1 = db[i + 1] - da[i + 1], d2 = db[i + 2] - da[i + 2];
      const m = Math.max(Math.abs(d0), Math.abs(d1), Math.abs(d2));
      total++;
      if (m > max) max = m;
      if (m > t) { moved++; sum += m; if (d0 + d1 + d2 < 0) darker++; else lighter++; }
    }
  }
  return {
    width: A.width, height: A.height, region: { left: l, bottom: b }, thresh: t,
    total, moved, pct: +(100 * moved / total).toFixed(2),
    darker, lighter, maxDelta: max, meanDelta: moved > 0 ? +(sum / moved).toFixed(2) : 0,
  };
}, [dataUrl(files[0]), dataUrl(files[1]), left, bottom, thresh]);
await browser.close();
console.log(JSON.stringify(out, null, 2));
if (out.error !== undefined) process.exit(1);
