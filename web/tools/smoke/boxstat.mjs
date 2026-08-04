// The DISTRIBUTION inside a named box, for one frame, printed as JSON.
//
// WHY THIS EXISTS AND WHY IT IS NOT boxdiff.mjs. `boxdiff.mjs` answers "did
// these two frames differ here", which is the right instrument for a change
// whose claim is motion. RN-1202's claim was different in kind: it asserted
// that a distribution SPREADS, median down while p90 and p99 go up, because a
// single constant cannot do that. That claim needs the two distributions
// themselves, not the delta between them, and the numbers behind it were
// computed ad hoc and thrown away, so nobody after it could re-derive them.
//
// A FILL LIGHT'S SIGNATURE IS A SHAPE, NOT A SIZE (RN-1252). The whole reason
// this lane needs percentiles is that a fill and an exposure raise are
// indistinguishable by mean: both make the box brighter. They separate on the
// tail. A fill lifts the DARK end and barely moves the LIT end, so p05 and the
// median rise by much more, proportionally, than p90 and p99 do; a gain moves
// every percentile by the same ratio. Publishing the percentiles is what makes
// that a falsifiable claim instead of an adjective.
//
// Same decode-in-Chrome trick as pngdiff.mjs, boxdiff.mjs and pairshot.mjs:
// this repo has no node PNG codec and playwright-core is already a dependency.
// Run it FROM web/ (or from a frozen tree's root) so playwright-core resolves:
//
//   node tools/smoke/boxstat.mjs shot.png machine:505,20,1160,430 sky:1195,140,1320,220
//
// Boxes are `name:x0,y0,x1,y1`, pixel coords, origin top-left, x1/y1 EXCLUSIVE,
// exactly boxdiff.mjs's convention. Luminance is Rec.601 on the 8-bit sRGB
// output, the same weights boxdiff.mjs uses, so a number from this tool and a
// number from that one are on one scale.
//
// ALWAYS PASS A CONTROL BOX. A box on the subject alone cannot tell "the
// subject got brighter" from "the frame got brighter", and this tool will
// happily report the second as the first.
import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';

const argv = process.argv.slice(2);
const file = argv[0];
const boxes = argv.slice(1).map((s) => {
  const m = /^([^:]+):(\d+),(\d+),(\d+),(\d+)$/.exec(s);
  if (!m) { console.error(`boxstat: bad box '${s}', want name:x0,y0,x1,y1`); process.exit(2); }
  return { name: m[1], box: [+m[2], +m[3], +m[4], +m[5]] };
});
if (!file || boxes.length === 0) {
  console.error('usage: boxstat shot.png name:x0,y0,x1,y1 [name:x0,y0,x1,y1 ...]');
  process.exit(2);
}
const CANDIDATES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
];
const exe = CANDIDATES.find((p) => { try { readFileSync(p); return true; } catch { return false; } });
const browser = await chromium.launch({ executablePath: exe });
const page = await browser.newPage();
const du = (p) => `data:image/png;base64,${readFileSync(p).toString('base64')}`;
const out = await page.evaluate(async ({ u, bs }) => {
  const img = await new Promise((res, rej) => {
    const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = u;
  });
  const c = document.createElement('canvas');
  c.width = img.width; c.height = img.height;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(img, 0, 0);
  const d = g.getImageData(0, 0, c.width, c.height).data;
  const pct = (sorted, q) => sorted[Math.min(sorted.length - 1,
    Math.max(0, Math.round(q * (sorted.length - 1))))];
  const rows = {};
  for (const { name, box } of bs) {
    const v = [];
    let sr = 0, sg = 0, sb = 0;
    // A BOX THAT FALLS OFF THE FRAME IS A FAILED READ, not a smaller box: a
    // silently clipped region is the same class of defect as a control that
    // moved, and it reads as a perfectly good number.
    if (box[0] < 0 || box[1] < 0 || box[2] > c.width || box[3] > c.height
        || box[2] <= box[0] || box[3] <= box[1]) {
      rows[name] = { fail: `box ${box} is outside the ${c.width}x${c.height} frame` };
      continue;
    }
    for (let y = box[1]; y < box[3]; y++) {
      for (let x = box[0]; x < box[2]; x++) {
        const i = (y * c.width + x) * 4;
        sr += d[i]; sg += d[i + 1]; sb += d[i + 2];
        v.push(d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114);
      }
    }
    v.sort((a, b) => a - b);
    const n = v.length;
    rows[name] = {
      px: n,
      mean: +(v.reduce((a, b) => a + b, 0) / n).toFixed(3),
      p01: +pct(v, 0.01).toFixed(2), p05: +pct(v, 0.05).toFixed(2),
      p25: +pct(v, 0.25).toFixed(2), p50: +pct(v, 0.50).toFixed(2),
      p75: +pct(v, 0.75).toFixed(2), p90: +pct(v, 0.90).toFixed(2),
      p99: +pct(v, 0.99).toFixed(2), max: +v[n - 1].toFixed(2),
      meanR: +(sr / n).toFixed(3), meanG: +(sg / n).toFixed(3), meanB: +(sb / n).toFixed(3),
    };
  }
  return { frame: [c.width, c.height], boxes: rows };
}, { u: du(file), bs: boxes });
console.log(JSON.stringify(out));
await browser.close();
