// wg240skyline.mjs (WG-240): read the SILHOUETTE LINE out of a captured frame.
//
//   node tools/smoke/wg240skyline.mjs docs/screenshots/WG240_x.png [--json]
//                                     [--x0 N --x1 N] [--run N] [--drop N]
//                                     [--pitch D] [--fov D]
//
// WHY THIS EXISTS, AND WHY NO RECTANGLE COULD DO IT. Every committed instrument
// in this project reduces a rectangle of pixels to tone statistics. A razor
// horizon is not a tone defect: rendering's lane N1 (rendering.md 2.30) closed
// 34 per cent of the far ground's contrast and wrote down that the frame still
// reads as a plane meeting the sky at a ruler-straight edge. The quantity that
// complaint is about is the ROW OF THE GROUND/SKY BOUNDARY AS A FUNCTION OF
// COLUMN, and its statistic is the SPREAD of that row. A perfectly straight
// edge has a row standard deviation of zero, and no luminance average over any
// rectangle can distinguish that from a mountain rim of the same mean tone.
//
// THE DETECTOR, and its one assumption stated out loud. Scanning each column
// from the top, the boundary is the first row at which `--run` consecutive rows
// are all at least `--drop` counts darker than the sky reference for that
// column (the median luma of the top 12 per cent of the frame, taken per
// column so a sun-side gradient does not bias one half of the image). The
// assumption is that the sky is brighter than the ground, which is true of
// every daylight pose in the shot manifest and is FALSE at dawn against a lit
// ridge; a pose that breaks it will show up as a boundary row pinned to 0 or to
// the frame height, which the report flags rather than averages in.
//
// `--run` exists because a single dark row is a cloud edge or a compression
// artefact and 5 consecutive rows are an object. It is a parameter and not a
// constant because a distant hedgerow is three rows tall (rendering.md 2.30.1:
// the plains far ground is a THIRTEEN-ROW BAND) and a run longer than the
// subject silently walks the boundary down onto the near field.
//
// WHAT THE NUMBERS MEAN. `sdPx` and `p2pPx` are the razor score: the spread of
// the boundary row in pixels. `sdDeg` converts through the on-axis scale
// (h/2)/tan(fov/2) so the frame number can be read against skyline_probe's
// headless prediction, which is in degrees and knows nothing about a camera.
// `elevDeg` per column is the absolute elevation of the boundary, using
// `--pitch` (the pose's own pitch, which the artframe report publishes), so a
// frame and the height field can be compared line for line rather than only in
// spread.
//
// The detector sees WHATEVER IS DARK, which includes trees. Capture with the
// scatter off (`--props=0 --grass=0 --trees=0 --canopy=0`) to measure the
// HEIGHT FIELD's silhouette, and with them on to measure the one the player
// gets. Both are real questions; they are different questions and the report
// names which capture it read.
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

const args = new Map();
const positional = [];
for (const a of process.argv.slice(2)) {
  const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
  if (m) args.set(m[1], m[2] ?? '1'); else positional.push(a);
}
const path = positional[0];
if (!path) { console.error('wg240skyline: usage: wg240skyline.mjs <frame.png> [--json]'); process.exit(2); }

// --- minimal PNG reader: 8-bit RGB/RGBA, non-interlaced (what the canvas emits)
function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  let off = 8, w = 0, h = 0, bitDepth = 0, colorType = 0, interlace = 0;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0); h = data.readUInt32BE(4);
      bitDepth = data[8]; colorType = data[9]; interlace = data[12];
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  if (bitDepth !== 8) throw new Error(`bit depth ${bitDepth} unsupported`);
  if (interlace !== 0) throw new Error('interlaced PNG unsupported');
  const ch = colorType === 2 ? 3 : colorType === 6 ? 4 : 0;
  if (!ch) throw new Error(`colour type ${colorType} unsupported`);
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * ch;
  const out = Buffer.alloc(h * stride);
  let p = 0;
  for (let y = 0; y < h; ++y) {
    const filter = raw[p++];
    const row = raw.subarray(p, p + stride); p += stride;
    const cur = out.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; ++x) {
      const a = x >= ch ? cur[x - ch] : 0;
      const b = prev ? prev[x] : 0;
      const c = prev && x >= ch ? prev[x - ch] : 0;
      let v = row[x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c);
        v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
      }
      cur[x] = v & 0xff;
    }
  }
  return { w, h, ch, data: out };
}

const img = decodePng(readFileSync(path));
const { w, h, ch, data } = img;
const luma = new Float64Array(w * h);
for (let y = 0; y < h; ++y) {
  for (let x = 0; x < w; ++x) {
    const i = (y * w + x) * ch;
    luma[y * w + x] = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
  }
}

const x0 = Number(args.get('x0') ?? 0);
const x1 = Number(args.get('x1') ?? w);
const run = Number(args.get('run') ?? 5);
const drop = Number(args.get('drop') ?? 28);
const pitchDeg = Number(args.get('pitch') ?? -8);
const fovDeg = Number(args.get('fov') ?? 60);
const skyRows = Math.max(4, Math.round(h * 0.12));
const pxPerDeg = ((h * 0.5) / Math.tan(0.5 * fovDeg * Math.PI / 180)) * Math.PI / 180;

const med = (a) => { const s = [...a].sort((p, q) => p - q); return s[s.length >> 1]; };

// THE SCAN GOES BOTTOM-UP AND THAT IS THE WHOLE ROBUSTNESS OF IT.
//
// The first version scanned top-down for the first dark run and reported a row
// standard deviation of 58.9 px on a frame whose horizon is visibly ruler
// straight: 51 of 1,600 columns came back pinned at row 0, because a CLOUD is
// darker than the sky beside it and a top-down detector cannot tell a cloud
// from a mountain. A detector whose failure mode is "reports a spectacular
// skyline where there is none" is worse than no detector, and it was caught
// only because the frame had already been looked at. So the scan starts inside
// the ground, at `--from` (default 0.55 of the frame height, which is ground at
// every ground pose in the manifest) and walks UP to the first run of BRIGHT
// rows. Nothing above the boundary is ever examined, so the sky's own contents
// cannot enter the measurement.
//
// The threshold is the MIDPOINT between the per-column sky reference and the
// per-column ground reference (the median over the rows just below the start),
// rather than a fixed offset: at this pose the far ground is hazed to within
// 30 counts of the sky and a fixed `--drop` either misses it or eats the sky.
const fromFrac = Number(args.get('from') ?? 0.55);
const yStart = Math.min(h - 2, Math.round(h * fromFrac));
const rows = [];
let pinnedTop = 0, pinnedBottom = 0;
const thresholds = [];
for (let x = x0; x < x1; ++x) {
  const skyCol = [];
  for (let y = 0; y < skyRows; ++y) skyCol.push(luma[y * w + x]);
  const sky = med(skyCol);
  const gCol = [];
  for (let y = yStart; y < Math.min(h, yStart + 60); ++y) gCol.push(luma[y * w + x]);
  const ground = med(gCol);
  // `--drop` survives as a FLOOR on the separation: if the ground reference is
  // not at least `drop` counts under the sky reference the column has no
  // readable boundary and is counted rather than guessed at.
  const thr = sky - ground >= drop ? 0.5 * (sky + ground) : sky - drop;
  thresholds.push(thr);
  let found = -1;
  for (let y = yStart; y - run >= 0; --y) {
    let ok = true;
    for (let k = 1; k <= run; ++k) if (luma[(y - k) * w + x] < thr) { ok = false; break; }
    if (ok) { found = y; break; }
  }
  if (found < 0) { pinnedTop++; found = 0; }
  else if (found >= yStart) pinnedBottom++;
  rows.push(found);
}

const stats = (v) => {
  const s = [...v].sort((a, b) => a - b);
  const n = s.length;
  const mean = s.reduce((a, b) => a + b, 0) / n;
  let acc = 0; for (const x of s) acc += (x - mean) * (x - mean);
  const q = (f) => { const i = f * (n - 1), lo = Math.floor(i), t = i - lo; return lo + 1 < n ? s[lo] * (1 - t) + s[lo + 1] * t : s[lo]; };
  return { mean, sd: Math.sqrt(acc / n), min: s[0], max: s[n - 1], p05: q(0.05), p50: q(0.5), p95: q(0.95) };
};

const st = stats(rows);
// Elevation of a boundary row: the frame centre looks at `pitchDeg`, rows grow
// downward, so elev = pitch + (h/2 - row) / pxPerDeg.
const elev = (r) => pitchDeg + (h * 0.5 - r) / pxPerDeg;

// The 1-D roughness of the LINE ITSELF, which is a different question from its
// spread: a line can have a large sd because it tilts once across the frame
// (one distant rise) or because it is jagged everywhere. `stepP95` is the 95th
// percentile of |row(x+1) - row(x)| over 8-pixel steps, i.e. the local
// wiggliness at a scale a viewer reads as shape rather than as aliasing.
const steps = [];
for (let i = 8; i < rows.length; i += 1) steps.push(Math.abs(rows[i] - rows[i - 8]));
const sst = stats(steps);

const report = {
  file: path, frame: { w, h },
  window: [x0, x1], run, drop, pitchDeg, fovDeg,
  pxPerDeg: +pxPerDeg.toFixed(4),
  pinnedTop, pinnedBottom,
  rowPx: {
    mean: +st.mean.toFixed(2), sd: +st.sd.toFixed(3),
    min: st.min, p05: +st.p05.toFixed(1), p50: +st.p50.toFixed(1),
    p95: +st.p95.toFixed(1), max: st.max,
    p2p: st.max - st.min, p95_05: +(st.p95 - st.p05).toFixed(2),
  },
  elevDeg: {
    mean: +elev(st.mean).toFixed(4),
    atP95row: +elev(st.p05).toFixed(4),   // the HIGHEST skyline (smallest row)
    atP05row: +elev(st.p95).toFixed(4),
    sd: +(st.sd / pxPerDeg).toFixed(4),
    p2p: +((st.max - st.min) / pxPerDeg).toFixed(4),
  },
  step8Px: { p50: +sst.p50.toFixed(2), p95: +sst.p95.toFixed(2), max: sst.max },
};

if (args.has('json')) {
  console.log(JSON.stringify({ ...report, rows }, null, 1));
} else {
  console.log(JSON.stringify(report, null, 1));
  // A 64-column ASCII trace of the line, so a reader can SEE whether the sd is
  // one rise or a jagged edge without opening the PNG.
  const bins = 64, per = Math.floor(rows.length / bins);
  const tr = [];
  for (let b = 0; b < bins; ++b) {
    let s = 0; for (let k = 0; k < per; ++k) s += rows[b * per + k];
    tr.push(s / per);
  }
  const lo = Math.min(...tr), hi = Math.max(...tr);
  const glyph = ' .:-=+*#%@';
  console.log('trace (top of frame is 0; darker glyph = higher skyline):');
  console.log('  ' + tr.map(v => glyph[Math.min(9, Math.max(0,
    Math.round((hi - v) / Math.max(1e-9, hi - lo) * 9)))]).join(''));
  console.log(`  rows ${lo.toFixed(1)} (highest) to ${hi.toFixed(1)} (lowest), span ${(hi - lo).toFixed(1)} px`);
}
