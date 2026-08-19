// Bulk pixel differ, built for the station census (RN-2030..2049).
//
//   node tools/smoke/pngdiffmany.mjs --root=DIR --dirs=a,b --ref=DIR/a/x.png \
//        --out=diffs.json [--thresh=6] [--pairs=24]
//
// Same arithmetic as tools/smoke/pngdiff.mjs (max of |dR|,|dG|,|dB| against a
// 6-count threshold), but it decodes many frames in ONE browser page so a
// two-hundred-run census does not pay a chromium launch per pair.
//
// Two products, and the second is what stops the classifier being an
// assumption:
//   1. REF DISTANCE, every frame against one designated modal reference,
//      streamed so memory is two frames. This is what the classifier reads.
//   2. PAIRWISE, the full matrix over an evenly spaced subset, so both
//      clusters are SHOWN in this lane's own data.
//
// The rectangle is the WHOLE frame, unlike pngdiff.mjs's HUD-excluding
// default: `eval.png` is `of.screenshot()`, the HUD-free canvas grab, so there
// is no overlay to exclude and cropping would only discard evidence.
import { chromium } from 'playwright-core';
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';

const arg = (k, d) => {
  const m = process.argv.find((a) => a.startsWith(`--${k}=`));
  return m === undefined ? d : m.slice(k.length + 3);
};
const root = arg('root', 'dist-scratch/frames');
const dirs = arg('dirs', '').split(',').filter(Boolean);
const ref = arg('ref', '');
const outJson = arg('out', 'dist-scratch/diffs.json');
const thresh = Number(arg('thresh', '6'));
const pairN = Number(arg('pairs', '0'));

const files = [];
for (const d of dirs) {
  for (const f of readdirSync(`${root}/${d}`).filter((x) => x.endsWith('.png')).sort()) {
    files.push({ id: f.replace(/\.png$/, ''), dir: d, path: `${root}/${d}/${f}` });
  }
}
const refPath = ref || files[0].path;
console.error(`diffmatrix: ${files.length} frames, ref ${refPath}, thresh ${thresh}`);

const dataUrl = (p) => `data:image/png;base64,${readFileSync(p).toString('base64')}`;
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage();

await page.evaluate(() => {
  window.__store = new Map();
  window.__load = async (key, url) => {
    const im = await new Promise((res, rej) => {
      const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url;
    });
    const c = document.createElement('canvas');
    c.width = im.width; c.height = im.height;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(im, 0, 0);
    const d = g.getImageData(0, 0, im.width, im.height).data;
    // Packed RGB, three bytes per pixel: a hundred RGBA frames will not fit.
    const rgb = new Uint8Array(im.width * im.height * 3);
    for (let i = 0, j = 0; j < rgb.length; i += 4, j += 3) {
      rgb[j] = d[i]; rgb[j + 1] = d[i + 1]; rgb[j + 2] = d[i + 2];
    }
    window.__store.set(key, { rgb, w: im.width, h: im.height });
    return { w: im.width, h: im.height };
  };
  window.__drop = (key) => { window.__store.delete(key); };
  window.__diff = (ka, kb, t) => {
    const A = window.__store.get(ka); const B = window.__store.get(kb);
    if (A.w !== B.w || A.h !== B.h) return { error: 'size mismatch' };
    const a = A.rgb; const b = B.rgb;
    let moved = 0; let darker = 0; let lighter = 0; let max = 0; let sum = 0;
    for (let j = 0; j < a.length; j += 3) {
      const d0 = b[j] - a[j]; const d1 = b[j + 1] - a[j + 1]; const d2 = b[j + 2] - a[j + 2];
      const m0 = d0 < 0 ? -d0 : d0; const m1 = d1 < 0 ? -d1 : d1; const m2 = d2 < 0 ? -d2 : d2;
      const m = m0 > m1 ? (m0 > m2 ? m0 : m2) : (m1 > m2 ? m1 : m2);
      if (m > max) max = m;
      if (m > t) { moved++; sum += m; if (d0 + d1 + d2 < 0) darker++; else lighter++; }
    }
    const total = a.length / 3;
    return { total, moved, pct: +(100 * moved / total).toFixed(3), darker, lighter,
      maxDelta: max, meanDelta: moved > 0 ? +(sum / moved).toFixed(2) : 0 };
  };
});

await page.evaluate(([u]) => window.__load('REF', u), [dataUrl(refPath)]);

const rows = [];
for (const f of files) {
  await page.evaluate(([k, u]) => window.__load(k, u), ['X', dataUrl(f.path)]);
  const d = await page.evaluate(([t]) => window.__diff('REF', 'X', t), [thresh]);
  await page.evaluate(() => window.__drop('X'));
  rows.push({ id: f.id, dir: f.dir, ...d });
}
console.error(`diffmatrix: ${rows.length} reference distances`);

let pairs = [];
if (pairN > 1) {
  const step = Math.max(1, Math.floor(files.length / pairN));
  const sub = files.filter((_, i) => i % step === 0).slice(0, pairN);
  for (let i = 0; i < sub.length; ++i) {
    await page.evaluate(([k, u]) => window.__load(k, u), [`P${i}`, dataUrl(sub[i].path)]);
  }
  for (let i = 0; i < sub.length; ++i) {
    for (let j = i + 1; j < sub.length; ++j) {
      const d = await page.evaluate(([a, b, t]) => window.__diff(a, b, t), [`P${i}`, `P${j}`, thresh]);
      pairs.push({ a: sub[i].id, b: sub[j].id, pct: d.pct, meanDelta: d.meanDelta });
    }
  }
  console.error(`diffmatrix: ${pairs.length} pairs over ${sub.length} frames`);
}

await browser.close();
writeFileSync(outJson, JSON.stringify({ refPath, thresh, rows, pairs }, null, 1));
console.error(`diffmatrix: wrote ${outJson}`);
