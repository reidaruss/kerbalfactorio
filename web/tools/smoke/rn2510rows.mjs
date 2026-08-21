// RN-2510. THE PER-ROW PROFILE, and it exists because the mid field's whole
// argument is about WHICH ROW IS WHICH RANGE.
//
//   node tools/smoke/rn2510rows.mjs <in.png> [--x0=300] [--x1=1300]
//                                   [--y0=240] [--y1=340] [--key=r,g,b]
//
// WHY. `rangeRects` in `probes/artframe.js` places a rectangle by INVERTING A
// FLAT PLANE, and RN-2479 measured that inversion an order of magnitude out
// past 100 m at the plains site because the ground swells there. So a strip
// labelled `r250` is a reproducible PLACEMENT and not a survey, which its own
// manifest note says. The only way to find out what range a row actually
// frames is to paint the shader's own `dist` as a STEP LADDER and read where
// the value jumps, and the only way to read that is a per-row profile.
//
// It also answers the other half of the same question -- how much of a row is
// terrain and how much is props -- off RN-2475's terrain paint, by reporting
// the fraction of pixels in the row that carry the paint's key colour.
//
// NEAREST-NEIGHBOUR AND NO RESAMPLING: every number below is a mean or a count
// over ORIGINAL pixels inside the x window, because a resampled row is a
// picture of the resampler (rn2450crop.mjs's own note, one instrument over).
//
// Decoding happens in a browser for rn2450crop.mjs's reason: this repo has no
// PNG decoder installed and playwright-core is already a dependency.
import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';

const args = new Map();
let inp = null;
for (const a of process.argv.slice(2)) {
  const m = /^--([^=]+)=(.*)$/.exec(a);
  if (m) args.set(m[1], m[2]); else if (inp === null) inp = a;
}
if (inp === null) {
  console.error('usage: node tools/smoke/rn2510rows.mjs <in.png> '
    + '[--x0=] [--x1=] [--y0=] [--y1=] [--key=r,g,b] [--tol=]');
  process.exit(2);
}
const x0 = Number(args.get('x0') ?? 300);
const x1 = Number(args.get('x1') ?? 1300);
const y0 = Number(args.get('y0') ?? 240);
const y1 = Number(args.get('y1') ?? 340);
const tol = Number(args.get('tol') ?? 40);
const key = (args.get('key') ?? '').split(',').map(Number);
const hasKey = key.length === 3 && key.every((v) => Number.isFinite(v));
// RN-2510's own paint puts the terrain at green EXACTLY zero (see the range
// ladder in section 2.31), so "how much of this row is terrain" is one
// threshold on one channel and does not need a key colour at all. -1 disables.
const terrG = Number(args.get('terrg') ?? -1);

const b64 = readFileSync(inp).toString('base64');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage();
await page.goto('about:blank');
const out = await page.evaluate(async (a) => {
  const img = new Image();
  img.src = 'data:image/png;base64,' + a.b64;
  await img.decode();
  const c = document.createElement('canvas');
  c.width = img.width; c.height = img.height;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(img, 0, 0);
  const d = g.getImageData(0, 0, img.width, img.height).data;
  const rows = [];
  for (let y = a.y0; y < Math.min(a.y1, img.height); ++y) {
    let sr = 0; let sg = 0; let sb = 0; let n = 0; let hit = 0;
    let tn = 0; let tr = 0;
    for (let x = a.x0; x < Math.min(a.x1, img.width); ++x) {
      const i = (y * img.width + x) * 4;
      const r = d[i]; const gg = d[i + 1]; const bb = d[i + 2];
      sr += r; sg += gg; sb += bb; n += 1;
      if (a.hasKey
        && Math.abs(r - a.key[0]) <= a.tol
        && Math.abs(gg - a.key[1]) <= a.tol
        && Math.abs(bb - a.key[2]) <= a.tol) hit += 1;
      if (a.terrG >= 0 && gg <= a.terrG) { tn += 1; tr += r; }
    }
    rows.push({
      y, n,
      r: sr / n, g: sg / n, b: sb / n,
      luma: (0.2126 * sr + 0.7152 * sg + 0.0722 * sb) / n,
      keyFrac: a.hasKey ? hit / n : null,
      terrFrac: a.terrG >= 0 ? tn / n : null,
      terrR: a.terrG >= 0 && tn > 0 ? tr / tn : null,
    });
  }
  return { w: img.width, h: img.height, rows };
}, { b64, x0, x1, y0, y1, key, hasKey, tol, terrG });
await browser.close();

const f = (v) => v.toFixed(2).padStart(7);
console.log(`# ${inp}  ${out.w}x${out.h}  x[${x0},${x1})  y[${y0},${y1})`
  + (hasKey ? `  key=${key.join(',')} tol=${tol}` : ''));
console.log(`row      luma       r       g       b`
  + (hasKey ? '   keyFrac' : '')
  + (terrG >= 0 ? '  terrFrac    terrR' : '') + '    dLuma');
let prev = null;
for (const r of out.rows) {
  const d = prev === null ? 0 : r.luma - prev;
  prev = r.luma;
  console.log(`${String(r.y).padStart(4)} ${f(r.luma)} ${f(r.r)} ${f(r.g)} ${f(r.b)}`
    + (hasKey ? `    ${r.keyFrac.toFixed(4)}` : '')
    + (terrG >= 0
      ? `    ${r.terrFrac.toFixed(4)} ${r.terrR === null ? '     --' : f(r.terrR)}`
      : '')
    + `  ${d >= 0 ? '+' : ''}${d.toFixed(2)}`);
}
