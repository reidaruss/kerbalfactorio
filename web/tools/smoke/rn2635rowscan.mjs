// Ad hoc: per-x-column readout of one row, coarse step, to see how many biome
// classes lie between two windows.
import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';

const args = new Map();
let inp = null;
for (const a of process.argv.slice(2)) {
  const m = /^--([^=]+)=(.*)$/.exec(a);
  if (m) args.set(m[1], m[2]); else if (inp === null) inp = a;
}
const y = Number(args.get('y'));
const x0 = Number(args.get('x0'));
const x1 = Number(args.get('x1'));
const step = Number(args.get('step') ?? 10);

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
  for (let x = a.x0; x < a.x1; x += a.step) {
    const i = (a.y * img.width + x) * 4;
    rows.push({ x, r: d[i], g: d[i + 1], b: d[i + 2] });
  }
  return rows;
}, { b64, y, x0, x1, step });
await browser.close();
console.log(`# ${inp} y=${y} x[${x0},${x1}) step=${step}`);
for (const p of out) console.log(`x=${String(p.x).padStart(4)}  r=${String(p.r).padStart(3)} g=${String(p.g).padStart(3)} b=${String(p.b).padStart(3)}`);
