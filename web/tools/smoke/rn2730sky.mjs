// RN-2730. WHERE THE SKYLINE ACTUALLY IS, PER COLUMN, so a silhouette
// rectangle is PLACED AGAINST THE CAPTURE rather than derived from the pitch
// arithmetic.
//
// `probes/artframe.js` records the same lesson twice in its own manifest, once
// for `flyover` ("the first `hzBand` here was written at y 0.21 from the pitch
// arithmetic and the horizon actually lands at y 0.36, so it measured sky and
// reported it as terrain") and once, worse, for `limb` ("the first `ring` here
// sat at y 0.40 and the limb halo actually crosses y 0.69 to 0.73"). Both were
// found by looking. This prints the number instead.
//
// THE DETECTOR IS CHROMA, NOT LUMA, and that is the whole reason it works on a
// hazed frame. At `vista` the far ground and the sky above it are within a few
// counts of each other in luminance -- that is precisely the complaint being
// measured -- so a luma edge finder has nothing to lock onto. They are still
// on opposite sides of neutral in HUE: Forge's sky is blue-biased (b > r) and
// its ground is warm (r > b) at every sun this lane photographs. So the
// skyline is the row where `r - b` changes sign, scanning DOWN from the top of
// the window.
//
// WHAT IT IS NOT. It is not an arm-to-arm measurement and must never be used
// as one: the aerosol moves the hue of both sides, so the crossing row itself
// is arm-dependent by a row or two. Run it ONCE on the shipped frame, read the
// flat span out of the output, freeze a rectangle on it, and measure every arm
// on that frozen rectangle. A rectangle that tracks the arm is a rectangle
// that cannot see the arm.
//
//   node tools/smoke/rn2730sky.mjs frame.png --x0=900 --x1=1600 --step=25 \
//     --y0=340 --y1=560
//
// Decoding happens in a browser for rn2450crop.mjs's reason: this repo has no
// PNG decoder installed and playwright-core is already a dependency.

import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';

const args = new Map();
let inp = null;
for (const a of process.argv.slice(2)) {
  const m = /^--([^=]+)=(.*)$/.exec(a);
  if (m !== null) args.set(m[1], m[2]); else if (inp === null) inp = a;
}
if (inp === null) {
  console.error('usage: node tools/smoke/rn2730sky.mjs <frame.png>'
    + ' [--x0=] [--x1=] [--y0=] [--y1=] [--step=] [--pad=]');
  process.exit(2);
}
const x0 = Number(args.get('x0') ?? 0);
const x1 = Number(args.get('x1') ?? 1600);
const y0 = Number(args.get('y0') ?? 0);
const y1 = Number(args.get('y1') ?? 900);
const step = Number(args.get('step') ?? 25);
// Rows skipped either side of the crossing before the two means are taken, so
// the anti-aliased skyline pixels themselves land in neither sample.
const pad = Number(args.get('pad') ?? 3);
const span = Number(args.get('span') ?? 6);
const dir = args.get('dir') ?? 'up';

const b64 = readFileSync(inp).toString('base64');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage();
await page.goto('about:blank');
const out = await page.evaluate(async (a) => {
  const img = new Image();
  img.src = `data:image/png;base64,${a.b64}`;
  await img.decode();
  const c = document.createElement('canvas');
  c.width = img.width; c.height = img.height;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(img, 0, 0);
  const d = g.getImageData(0, 0, img.width, img.height).data;
  const at = (x, y) => {
    const i = (y * img.width + x) * 4;
    return [d[i], d[i + 1], d[i + 2]];
  };
  const L = (p) => 0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2];
  const rows = [];
  for (let x = a.x0; x < a.x1; x += a.step) {
    let hit = null;
    if (a.dir === 'up') {
      // SCANNING UP FROM THE BOTTOM OF THE WINDOW, and the default is this way
      // because Forge's sky is not uniformly blue: the cloud deck is warm
      // cream, so a top-down chroma scan locks onto the first CLOUD it meets
      // and reports a skyline eighty rows too high. Measured on this lane's own
      // `vista` frame: top-down gives 333 to 391 across the frame (the cloud
      // bases), bottom-up gives the terrain edge. Ground below the skyline is
      // warm without interruption at every sun in this lane's set, so the first
      // ground-to-sky sign change from below IS the skyline.
      for (let y = a.y1 - 2; y >= a.y0; y -= 1) {
        const below = at(x, y + 1); const cur = at(x, y);
        if (below[0] - below[2] > 0 && cur[0] - cur[2] <= 0) { hit = y + 1; break; }
      }
    } else {
      for (let y = a.y0 + 1; y < a.y1; y += 1) {
        const prev = at(x, y - 1); const cur = at(x, y);
        if (prev[0] - prev[2] <= 0 && cur[0] - cur[2] > 0) { hit = y; break; }
      }
    }
    if (hit === null) { rows.push({ x, y: null }); continue; }
    let up = 0; let dn = 0; let n = 0;
    for (let k = 0; k < a.span; k += 1) {
      const yu = hit - a.pad - 1 - k; const yd = hit + a.pad + k;
      if (yu < 0 || yd >= img.height) continue;
      up += L(at(x, yu)); dn += L(at(x, yd)); n += 1;
    }
    rows.push({
      x, y: hit,
      sky: n === 0 ? null : +(up / n).toFixed(2),
      ground: n === 0 ? null : +(dn / n).toFixed(2),
      step: n === 0 ? null : +((up - dn) / n).toFixed(2),
    });
  }
  return { w: img.width, h: img.height, rows };
}, { b64, x0, x1, y0, y1, step, pad, span, dir });
await browser.close();

console.log(`# ${inp}  ${out.w}x${out.h}  x[${x0},${x1}) y[${y0},${y1})`
  + `  step ${step}  pad ${pad} span ${span}  dir ${dir}`);
console.log('     x   skyline      sky   ground     step');
for (const r of out.rows) {
  console.log(`${String(r.x).padStart(6)}${String(r.y ?? 'none').padStart(10)}`
    + `${String(r.sky ?? '-').padStart(9)}${String(r.ground ?? '-').padStart(9)}`
    + `${String(r.step ?? '-').padStart(9)}`);
}
const ys = out.rows.map((r) => r.y).filter((y) => y !== null);
if (ys.length > 0) {
  console.log(`\nskyline rows: min ${Math.min(...ys)} max ${Math.max(...ys)}`
    + `  over ${ys.length}/${out.rows.length} columns`);
}
