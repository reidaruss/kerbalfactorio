// Difference MASK between two captured frames, plus where the moved pixels are.
//
//   node dist-scratch/mask.mjs A.png B.png out.png
//
// Writes a three-panel PNG (A | B | mask) and prints the mask's spatial
// distribution as an 8x6 grid of per-cell moved share plus coarse row and
// column profiles, so "where the differing pixels live" is a number rather
// than an impression. Same 6-count max-channel threshold as pngdiff.mjs.
// Blue is darker in B, orange is lighter in B.
import { chromium } from 'playwright-core';
import { readFileSync, writeFileSync } from 'node:fs';

const [fa, fb, fout] = process.argv.slice(2);
const dataUrl = (p) => `data:image/png;base64,${readFileSync(p).toString('base64')}`;
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage();
const out = await page.evaluate(async ([ua, ub]) => {
  const load = (u) => new Promise((res, rej) => {
    const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = u;
  });
  const [A, B] = await Promise.all([load(ua), load(ub)]);
  const grab = (im) => {
    const c = document.createElement('canvas');
    c.width = im.width; c.height = im.height;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(im, 0, 0);
    return g.getImageData(0, 0, im.width, im.height);
  };
  const ia = grab(A); const ib = grab(B);
  const w = A.width; const h = A.height;
  const GX = 8; const GY = 6;
  const cell = new Float64Array(GX * GY); const cellN = new Float64Array(GX * GY);
  const rowM = new Float64Array(h); const colM = new Float64Array(w);
  const mc = document.createElement('canvas');
  mc.width = w; mc.height = h;
  const mg = mc.getContext('2d');
  const mi = mg.createImageData(w, h);
  let moved = 0; let darker = 0; let lighter = 0;
  for (let y = 0; y < h; ++y) {
    for (let x = 0; x < w; ++x) {
      const i = (y * w + x) * 4;
      const d0 = ib.data[i] - ia.data[i];
      const d1 = ib.data[i + 1] - ia.data[i + 1];
      const d2 = ib.data[i + 2] - ia.data[i + 2];
      const m = Math.max(Math.abs(d0), Math.abs(d1), Math.abs(d2));
      const gi = Math.min(GY - 1, Math.floor((y * GY) / h)) * GX
        + Math.min(GX - 1, Math.floor((x * GX) / w));
      cellN[gi]++;
      if (m > 6) {
        moved++; cell[gi]++; rowM[y]++; colM[x]++;
        if (d0 + d1 + d2 < 0) { darker++; mi.data[i] = 40; mi.data[i + 1] = 90; mi.data[i + 2] = 255; }
        else { lighter++; mi.data[i] = 255; mi.data[i + 1] = 170; mi.data[i + 2] = 40; }
        mi.data[i + 3] = 255;
      } else {
        const y8 = Math.round((0.2126 * ia.data[i] + 0.7152 * ia.data[i + 1]
          + 0.0722 * ia.data[i + 2]) * 0.25);
        mi.data[i] = y8; mi.data[i + 1] = y8; mi.data[i + 2] = y8; mi.data[i + 3] = 255;
      }
    }
  }
  mg.putImageData(mi, 0, 0);
  const pw = Math.round(w / 2); const ph = Math.round(h / 2);
  const oc = document.createElement('canvas');
  oc.width = pw * 3; oc.height = ph;
  const og = oc.getContext('2d');
  og.drawImage(A, 0, 0, pw, ph);
  og.drawImage(B, pw, 0, pw, ph);
  og.drawImage(mc, pw * 2, 0, pw, ph);
  const grid = [];
  for (let gy = 0; gy < GY; ++gy) {
    const r = [];
    for (let gx = 0; gx < GX; ++gx) r.push(+(100 * cell[gy * GX + gx] / cellN[gy * GX + gx]).toFixed(1));
    grid.push(r.join(' '));
  }
  const bucket = (a, n, denom) => {
    const o = new Array(n).fill(0);
    for (let i = 0; i < a.length; ++i) o[Math.min(n - 1, Math.floor((i * n) / a.length))] += a[i];
    return o.map((v) => +(100 * v / (denom * (a.length / n))).toFixed(1)).join(' ');
  };
  return { w, h, moved, pct: +(100 * moved / (w * h)).toFixed(2), darker, lighter,
    grid, rows: bucket(rowM, 12, w), cols: bucket(colM, 16, h),
    png: oc.toDataURL('image/png') };
}, [dataUrl(fa), dataUrl(fb)]);
await browser.close();
writeFileSync(fout, Buffer.from(out.png.slice('data:image/png;base64,'.length), 'base64'));
const { png, ...rest } = out;
console.log(JSON.stringify(rest, null, 1));
