// RN-2664. STRUCTURE AT A NAMED SCALE, and it exists because World Audit R5's
// rank 1 was scored on a statistic that cannot see the thing rank 1 asked for.
//
// THE PROBLEM, stated as this lane hit it. R5 rank 1's structure finding is
// "the shipped arm's own row-to-row `iqr` never exceeds 3.9 counts", and the
// lane briefed against it added a 165 m stand field and a 760 m grove field to
// the far treeline paint. The `iqr` of a five-row strip went DOWN in the middle
// of the band while the same crops, side by side at 2x, plainly gained
// larger-scale organisation. Both readings are real and they are not in
// conflict: `iqr` is a robust middle-50 spread over the whole strip, so it is
// dominated by whatever varies FASTEST in it, and replacing fine relief
// streaking with broad patches can lower it while raising the scale at which
// the ground is organised. A number that cannot distinguish "flat" from
// "smooth and patchy" is the wrong number for a mottle.
//
// WHAT THIS MEASURES INSTEAD. Box-filter the rectangle at a ladder of scales
// and report the standard deviation of the FILTERED luma at each. Filtering at
// scale s removes everything finer than s, so sd(s) is the amount of structure
// AT OR COARSER THAN s. Two arms differ at the scale their difference lives at,
// and the ladder says which one. It is the frequency-domain question asked in
// the pixel domain, with no window, no FFT and nothing to tune.
//
// PROVENANCE. The rect defaults to the far band at `flyover` clear of the HUD
// (`pngdiff.mjs` excludes the left 210 px and the bottom 80; this starts at
// 560). Rows 330 to 540 at that pose are 15.5 km down to 3.4 km by the R5
// correction pass's own curvature-correct inversion, which is exactly rank 1's
// span.
//
//   node tools/smoke/rn2664scale.mjs a.png b.png [c.png ...]
//   node tools/smoke/rn2664scale.mjs --rect=560,330,900,210 a.png b.png
//   node tools/smoke/rn2664scale.mjs --scales=2,4,8,16,32,64,128 a.png b.png
//
// Decoding happens in a browser for `rn2450crop.mjs`'s reason: this repo has no
// PNG decoder installed and playwright-core is already a dependency.

import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';

const args = [];
let rect = [560, 330, 900, 210];
let scales = [1, 2, 4, 8, 16, 32, 64, 128];
for (const a of process.argv.slice(2)) {
  const m = /^--([^=]+)=(.*)$/.exec(a);
  if (m === null) { args.push(a); continue; }
  if (m[1] === 'rect') rect = m[2].split(',').map(Number);
  else if (m[1] === 'scales') scales = m[2].split(',').map(Number);
  else { console.error(`rn2664scale: unknown flag --${m[1]}`); process.exit(2); }
}
if (args.length < 1) {
  console.error('usage: node tools/smoke/rn2664scale.mjs [--rect=x,y,w,h]'
    + ' [--scales=1,2,4,...] <a.png> [b.png ...]');
  process.exit(2);
}

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage();
await page.goto('about:blank');
const rows = [];
for (const f of args) {
  const b64 = readFileSync(f).toString('base64');
  const out = await page.evaluate(async (a) => {
    const img = new Image();
    img.src = `data:image/png;base64,${a.b64}`;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(img, 0, 0);
    const d = g.getImageData(a.x, a.y, a.w, a.h).data;
    // Rec.709 on the 8-bit values, deliberately NOT linearised: this is a
    // question about what the EYE reads off the displayed frame, and the
    // display encode is part of that. rn2550guard's linear-light rule is for
    // a RATIO of two patches, which is a different quantity.
    const L = new Float64Array(a.w * a.h);
    for (let i = 0; i < a.w * a.h; i += 1) {
      L[i] = 0.2126 * d[i * 4] + 0.7152 * d[i * 4 + 1] + 0.0722 * d[i * 4 + 2];
    }
    const res = [];
    for (const s of a.scales) {
      const bw = Math.floor(a.w / s); const bh = Math.floor(a.h / s);
      if (bw < 4 || bh < 2) { res.push({ s, sd: null, n: bw * bh }); continue; }
      const box = new Float64Array(bw * bh);
      for (let by = 0; by < bh; by += 1) {
        for (let bx = 0; bx < bw; bx += 1) {
          let t = 0;
          for (let y = 0; y < s; y += 1) {
            for (let x = 0; x < s; x += 1) t += L[(by * s + y) * a.w + bx * s + x];
          }
          box[by * bw + bx] = t / (s * s);
        }
      }
      // THE MEAN IS REMOVED PER ROW OF BOXES, not globally. The band has a
      // strong vertical luminance gradient (the aerial perspective), and a
      // global sd would report that gradient as "structure" at every scale and
      // swamp the lateral field this is placed to see.
      let ss = 0; let n = 0;
      for (let by = 0; by < bh; by += 1) {
        let m = 0;
        for (let bx = 0; bx < bw; bx += 1) m += box[by * bw + bx];
        m /= bw;
        for (let bx = 0; bx < bw; bx += 1) {
          const dv = box[by * bw + bx] - m; ss += dv * dv; n += 1;
        }
      }
      res.push({ s, sd: Math.sqrt(ss / n), n });
    }
    return res;
  }, { b64, x: rect[0], y: rect[1], w: rect[2], h: rect[3], scales });
  rows.push({ f: f.split(/[\\/]/).pop(), out });
}
await browser.close();

console.log(`\n--- RN-2664 LATERAL STRUCTURE BY SCALE ---`);
console.log(`rect x${rect[0]} y${rect[1]} ${rect[2]}x${rect[3]}`
  + `   sd of the box-filtered luma, row mean removed, 8-bit counts`);
console.log(`\n${'scale px'.padStart(9)}` + rows.map((r) => r.f.slice(-26).padStart(27)).join(''));
for (let i = 0; i < scales.length; i += 1) {
  const cells = rows.map((r) => {
    const v = r.out[i];
    return (v.sd === null ? 'n/a' : v.sd.toFixed(3)).padStart(27);
  });
  console.log(`${String(scales[i]).padStart(9)}${cells.join('')}`);
}
if (rows.length > 1) {
  console.log(`\nDELTA against ${rows[0].f} (positive = MORE structure at that scale):`);
  console.log(`${'scale px'.padStart(9)}` + rows.slice(1)
    .map((r) => r.f.slice(-26).padStart(27)).join(''));
  for (let i = 0; i < scales.length; i += 1) {
    const a = rows[0].out[i].sd;
    const cells = rows.slice(1).map((r) => {
      const b = r.out[i].sd;
      return (a === null || b === null ? 'n/a'
        : `${(b - a >= 0 ? '+' : '')}${(b - a).toFixed(3)}`
          + ` (${((b / a - 1) * 100).toFixed(1)}%)`).padStart(27);
    });
    console.log(`${String(scales[i]).padStart(9)}${cells.join('')}`);
  }
}
