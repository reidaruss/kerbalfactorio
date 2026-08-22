// Ad hoc: histogram of distinct (r,g,b) colors inside a pixel window, to tell
// a solid biome-id fill apart from a boundary blend. Usage:
//   node pixelhist.mjs <in.png> --x0= --x1= --y0= --y1=
import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';

const args = new Map();
let inp = null;
for (const a of process.argv.slice(2)) {
  const m = /^--([^=]+)=(.*)$/.exec(a);
  if (m) args.set(m[1], m[2]); else if (inp === null) inp = a;
}
const x0 = Number(args.get('x0'));
const x1 = Number(args.get('x1'));
const y0 = Number(args.get('y0'));
const y1 = Number(args.get('y1'));

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
  const counts = new Map();
  for (let y = a.y0; y < a.y1; ++y) {
    for (let x = a.x0; x < a.x1; ++x) {
      const i = (y * img.width + x) * 4;
      const key = `${d[i]},${d[i + 1]},${d[i + 2]}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return [...counts.entries()].sort((p, q) => q[1] - p[1]);
}, { b64, x0, x1, y0, y1 });
await browser.close();
console.log(`# ${inp} x[${x0},${x1}) y[${y0},${y1})  ${out.length} distinct colours`);
for (const [k, n] of out.slice(0, 20)) console.log(`${k.padStart(15)}  x${n}`);
