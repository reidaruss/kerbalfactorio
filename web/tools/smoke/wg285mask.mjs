// WG-285. THE STAGE-1 MASK'S SHAPE, row by row, so it can be laid against a
// FIELD prediction rather than against a share.
//
// `rn2560map.mjs` (lane N9) argmaxes the same five isolate frames and reports
// the five SHARES. A share cannot say where the region is, and the whole
// question this lane inherited is a question about WHERE: 90 per cent of
// `forestair`'s stage-1 pixels lie in one contiguous 82-row span, which is the
// shape of a biome edge and not of clearings. This tool publishes that
// geometry -- per-row counts, the longest contiguous band, the mean horizontal
// run -- and an ASCII map at the same aspect as `wg285field.ts`'s, so the
// measured mask and the predicted one can be compared by eye and by row.
//
// The classifier is rn2560map.mjs's, verbatim in mechanism: argmax over the
// five arms with a threshold on the SPREAD, the HUD excluded exactly as
// `pngdiff.mjs` excludes it. Two implementations of one definition would be a
// second instrument to trust; this is the same definition, re-emitted.
//
//   node tools/smoke/wg285mask.mjs docs/screenshots/WG285_forestair [--map]
//
// SECOND MODE, same question one layer out: `--diff a.png b.png` prints WHERE a
// before/after pair moved, per row band and per column band. `pngdiff.mjs`
// answers "how many pixels moved and by how much", which cannot distinguish a
// change spread over the whole frame from one confined to a band, and this
// lane's whole subject is a band.
//
//   node tools/smoke/wg285mask.mjs --diff before.png after.png

import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const diffAt = args.indexOf('--diff');
const prefix = diffAt < 0 ? args.find((a) => !a.startsWith('--')) : 'diff';
const wantMap = args.includes('--map');
const flag = (k, d) => {
  const m = args.find((a) => a.startsWith(`--${k}=`));
  return m === undefined ? d : Number(m.slice(k.length + 3));
};
if (!prefix) {
  console.error('usage: node tools/smoke/wg285mask.mjs <prefix-without-_sN.png> [--map]');
  process.exit(2);
}
const left = flag('left', 210);
const bottom = flag('bottom', 80);
const spread = flag('spread', 4);

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage();

if (diffAt >= 0) {
  const pair = [args[diffAt + 1], args[diffAt + 2]].map((p) =>
    `data:image/png;base64,${readFileSync(p).toString('base64')}`);
  const d = await page.evaluate(async ([srcs, left_, bottom_]) => {
    const load = (s) => new Promise((res) => {
      const i = new Image(); i.onload = () => res(i); i.src = s;
    });
    const imgs = await Promise.all(srcs.map(load));
    const { width: W, height: H } = imgs[0];
    const px = imgs.map((im) => {
      const c = document.createElement('canvas');
      c.width = W; c.height = H;
      const x = c.getContext('2d', { willReadFrequently: true });
      x.drawImage(im, 0, 0);
      return x.getImageData(0, 0, W, H).data;
    });
    const rows = new Array(H).fill(0);
    const rowSum = new Array(H).fill(0);
    const cols = new Array(W).fill(0);
    let moved = 0;
    // THE BAND AS A RECTANGLE, because no committed rectangle at `forestair`
    // contains it: `hzBand` ends at row 337 and `box` starts at row 405, and
    // the stage-1 band runs 345 to 450. A pair scored only on the committed
    // set is therefore structurally blind to this lane's own subject.
    let bandA = 0; let bandB = 0; let bandN = 0;
    for (let y = 345; y < 450; ++y) {
      for (let x = left_; x < W; ++x) {
        const i = (y * W + x) * 4;
        bandA += 0.2126 * px[0][i] + 0.7152 * px[0][i + 1] + 0.0722 * px[0][i + 2];
        bandB += 0.2126 * px[1][i] + 0.7152 * px[1][i + 1] + 0.0722 * px[1][i + 2];
        bandN++;
      }
    }
    for (let y = 0; y < H - bottom_; ++y) {
      for (let x = left_; x < W; ++x) {
        const i = (y * W + x) * 4;
        const a = 0.2126 * px[0][i] + 0.7152 * px[0][i + 1] + 0.0722 * px[0][i + 2];
        const b = 0.2126 * px[1][i] + 0.7152 * px[1][i + 1] + 0.0722 * px[1][i + 2];
        if (Math.abs(a - b) < 6) continue;
        rows[y]++; cols[x]++; rowSum[y] += b - a; moved++;
      }
    }
    return { W, H, rows, cols, rowSum, moved, bandA: bandA / bandN, bandB: bandB / bandN, bandN };
  }, [pair, left, bottom]);
  console.log(`diff ${args[diffAt + 1]} -> ${args[diffAt + 2]}  moved ${d.moved} px`);
  console.log(`  BAND RECT rows 345..449, x>=${left}: mean luma `
    + `${d.bandA.toFixed(3)} -> ${d.bandB.toFixed(3)}  delta ${(d.bandB - d.bandA).toFixed(3)}`
    + `  over ${d.bandN} px`);
  console.log('  rows with over 40 moved px (row: moved, mean signed delta)');
  for (let y = 0; y < d.H; y += 8) {
    let n = 0; let s = 0;
    for (let k = y; k < Math.min(d.H, y + 8); ++k) { n += d.rows[k]; s += d.rowSum[k]; }
    if (n < 40) continue;
    console.log(`    r${String(y).padStart(3)}-${y + 7}  ${String(n).padStart(5)} px  ${(s / n).toFixed(2)}`);
  }
  const colBand = 100;
  let line = '  cols: ';
  for (let x = 0; x < d.W; x += colBand) {
    let n = 0;
    for (let k = x; k < Math.min(d.W, x + colBand); ++k) n += d.cols[k];
    line += `${x}:${n}  `;
  }
  console.log(line);
  await browser.close();
  process.exit(0);
}

const urls = [0, 1, 2, 3, 4].map((k) =>
  `data:image/png;base64,${readFileSync(`${prefix}_s${k}.png`).toString('base64')}`);
const out = await page.evaluate(async ([srcs, left_, bottom_, spread_]) => {
  const load = (s) => new Promise((res) => {
    const i = new Image(); i.onload = () => res(i); i.src = s;
  });
  const imgs = await Promise.all(srcs.map(load));
  const { width: W, height: H } = imgs[0];
  const data = imgs.map((im) => {
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const x = c.getContext('2d', { willReadFrequently: true });
    x.drawImage(im, 0, 0);
    return x.getImageData(0, 0, W, H).data;
  });
  const arg = new Int8Array(W * H).fill(-1);
  const counts = [0, 0, 0, 0, 0];
  for (let y = 0; y < H - bottom_; ++y) {
    for (let xp = left_; xp < W; ++xp) {
      const i = (y * W + xp) * 4;
      let hi = -1; let lo = 1e9; let a = -1;
      for (let k = 0; k < 5; ++k) {
        const d = data[k];
        const L = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
        if (L > hi) { hi = L; a = k; }
        if (L < lo) lo = L;
      }
      if (hi - lo < spread_) continue;
      arg[y * W + xp] = a;
      ++counts[a];
    }
  }
  return { W, H, counts, arg: Array.from(arg) };
}, [urls, left, bottom, spread]);
await browser.close();

const { W, H, counts } = out;
const arg = Int8Array.from(out.arg);
const terrain = counts.reduce((a, b) => a + b, 0);
console.log(`${prefix}  ${W}x${H}  terrain ${terrain}`
  + `  s0 ${counts[0]}  s1 ${counts[1]}  s2 ${counts[2]}  s3 ${counts[3]}  s4 ${counts[4]}`);
console.log(`  s1 share of terrain ${(100 * counts[1] / terrain).toFixed(2)}%`);

// Per-row counts, the contiguous band, and the mean horizontal run.
const rowS1 = new Array(H).fill(0);
const rowTer = new Array(H).fill(0);
let runs = 0; let runPx = 0;
for (let y = 0; y < H; ++y) {
  let inRun = false;
  for (let x = 0; x < W; ++x) {
    const a = arg[y * W + x];
    if (a >= 0) rowTer[y]++;
    if (a === 1) {
      rowS1[y]++; runPx++;
      if (!inRun) { runs++; inRun = true; }
    } else inRun = false;
  }
}
let bestA = -1; let bestB = -1; let curA = -1;
for (let y = 0; y <= H; ++y) {
  const on = y < H && rowTer[y] > 0 && rowS1[y] / rowTer[y] >= 0.5;
  if (on && curA < 0) curA = y;
  if (!on && curA >= 0) { if (y - curA > bestB - bestA) { bestA = curA; bestB = y; } curA = -1; }
}
let inBand = 0;
for (let y = bestA; y < bestB; ++y) inBand += rowS1[y];
console.log(`  BAND rows ${bestA}..${bestB - 1} (${bestB - bestA} rows of ${H}),`
  + ` holding ${(100 * inBand / counts[1]).toFixed(1)}% of all s1 px;`
  + ` mean horizontal run ${(runPx / Math.max(1, runs)).toFixed(1)} px;`
  + ` peak row width ${(100 * Math.max(...rowS1.slice(bestA, bestB).map((s, q) =>
    s / Math.max(1, rowTer[bestA + q])))).toFixed(0)}%`);

console.log('  row profile (row: s1 share of that row\'s terrain), rows over 2%');
for (let y = 0; y < H; ++y) {
  if (rowTer[y] === 0) continue;
  const f = rowS1[y] / rowTer[y];
  if (f < 0.02) continue;
  if (y % 4 !== 0) continue;
  console.log(`    r${String(y).padStart(3)}  s1 ${(100 * f).toFixed(0).padStart(3)}%  (${rowS1[y]}/${rowTer[y]})`);
}

if (wantMap) {
  const CW = 100; const CH = 45;
  console.log('  MEASURED MAP  . other/sky   s s0   1 s1 GATE OFF   ~ s2   z s3   # s4 LIVE');
  for (let cy = 0; cy < CH; ++cy) {
    let line = '  ';
    for (let cx = 0; cx < CW; ++cx) {
      const x = Math.floor(((cx + 0.5) * W) / CW);
      const y = Math.floor(((cy + 0.5) * H) / CH);
      const a = arg[y * W + x];
      line += a < 0 ? '.' : a === 0 ? 's' : a === 1 ? '1' : a === 2 ? '~' : a === 3 ? 'z' : '#';
    }
    console.log(line);
  }
}
