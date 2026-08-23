// RN-2686 (WORLD AUDIT R6). SWEEP `rn2664scale.mjs` DOWN A COLUMN OF BANDS AND
// PRINT ONE TABLE, so "where in depth does the structure stop" is one reading
// rather than six shell invocations whose rects live in an agent's history.
//
// WHY A WRAPPER AND NOT A SECOND IMPLEMENTATION. The box filter, the per-row
// mean removal and the deliberate non-linearisation are decisions
// `rn2664scale.mjs` argues for in its own header, and NUMBERS.md's "a fix
// applied to one script in a family is not applied to the family" is the
// standing cost of copying them. This file SHELLS OUT to that script once per
// band and parses its printed table, so there is exactly one implementation of
// the statistic and this file cannot drift from it. The price is one browser
// launch per band, which is the cheaper of the two mistakes.
//
// WHAT A BAND IS. A band is `--rect=x,y0+k*h,w,h`. The bands are contiguous and
// equal height by construction, so a reader can compare rows down the table
// without checking whether two rows were measured over different areas: an
// `sd` over 70 rows and an `sd` over 200 is not the same number.
//
// THE RANGE COLUMN IS PRINTED WHEN A POSE IS NAMED, and it is the R5 correction
// pass's own curvature-correct inversion rather than a linear guess:
//   depression(s) = s/(2R) + h/s        radians, R = planet radius
//   depression(row) = -pitch - atan(v * tan(fovHalf)),  v = 1 - 2*row/H
// inverted for s at the near root. It is printed as CONTEXT, not as evidence:
// the inversion assumes a smooth datum, and relief moves the true range of a
// row (NUMBERS.md, RN-2665's smooth-datum Nyquist entry).
//
//   node tools/smoke/rn2686bands.mjs --img=docs/screenshots/R6_flyover.png \
//     --rect=560,330,900 --h=70 --n=6 --pose=flyover
//   node tools/smoke/rn2686bands.mjs --img=a.png --cmp=b.png \
//     --rect=560,330,900 --h=70 --n=6
//
// `--cmp` adds a second image; the table then prints `a | b | b-a` per scale.
// Paths are resolved against the REPO ROOT.

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCALE = path.join(HERE, 'rn2664scale.mjs');
const ROOT = path.join(HERE, '..', '..', '..');

const argv = new Map(process.argv.slice(2).map((a) => {
  const i = a.indexOf('='); return i === -1 ? [a, '1'] : [a.slice(0, i), a.slice(i + 1)];
}));
const img = argv.get('--img');
const cmp = argv.get('--cmp');
if (img === undefined) { console.error('rn2686bands: --img= is required'); process.exit(2); }
const [X, Y0, W] = (argv.get('--rect') ?? '560,330,900').split(',').map(Number);
const h = Number(argv.get('--h') ?? 70);
const n = Number(argv.get('--n') ?? 6);
const scales = argv.get('--scales') ?? '1,4,16,32';
const pose = argv.get('--pose');

// ---- the range context, poses declared here and nowhere else ---------------
// Fields are TRANSCRIBED FROM `artframe.js`'s own manifest and the line each
// came from is cited, because the first draft of this table carried two
// REMEMBERED pitches (`forestaircanopy` -6, `meadowfield` -8) that the manifest
// contradicts, and a range column is exactly the thing four audits have been
// wrong about. A pose that is not listed prints NO range column; it never
// prints a guessed one.
//
// `hM` is the eye height above the local ground, not the pose's `altM` where
// the two differ: the walking poses stand at the certified 1.62 m eye (R5's
// `beachground` setup block), the flying ones are placed at `altM`.
const POSES = {
  // artframe.js:1064-1067   altM 1200, pitch -14
  flyover: { hM: 1200, pitch: -14, R: 6e5 },
  // artframe.js's `forestair` row, same site and camera as `flyover`
  forestair: { hM: 1200, pitch: -14, R: 6e5 },
  // artframe.js:1246-1249   altM 60, pitch -2.5
  forestaircanopy: { hM: 60, pitch: -2.5, R: 6e5 },
  // artframe.js:787-789     standing eye, pitch -8
  meadow: { hM: 1.62, pitch: -8, R: 6e5 },
  // artframe.js:432-434     standing eye, pitch -12
  meadowfield: { hM: 1.62, pitch: -12, R: 6e5 },
};
const FRAME_H = Number(argv.get('--frameh') ?? 900);
const FOV_HALF_DEG = Number(argv.get('--fovhalf') ?? 30);

function rangeAtRow(row, p) {
  const v = 1 - (2 * row) / FRAME_H;
  const depDeg = -p.pitch - (Math.atan(v * Math.tan((FOV_HALF_DEG * Math.PI) / 180))
    * 180) / Math.PI;
  const dep = (depDeg * Math.PI) / 180;
  if (dep <= 0) return null;
  const disc = (p.R * dep) ** 2 - 2 * p.R * p.hM;
  if (disc < 0) return null;                 // above the horizon
  return p.R * dep - Math.sqrt(disc);        // near root, metres
}

// ---- run one band ----------------------------------------------------------
function bandRow(y) {
  const imgs = [path.resolve(ROOT, img)];
  if (cmp !== undefined) imgs.push(path.resolve(ROOT, cmp));
  for (const f of imgs) {
    if (!fs.existsSync(f)) { console.error(`rn2686bands: no such file ${f}`); process.exit(2); }
  }
  const r = spawnSync(process.execPath,
    [SCALE, `--rect=${X},${y},${W},${h}`, `--scales=${scales}`, ...imgs],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) {
    console.error(`rn2686bands: rn2664scale failed at y=${y}`);
    console.error(r.stderr); process.exit(1);
  }
  // Parse the printed table: lines of "<scale> <sd> [<sd>]" before any DELTA.
  const out = new Map();
  for (const line of r.stdout.split('\n')) {
    if (line.startsWith('DELTA')) break;
    const m = /^\s*(\d+)\s+((?:n\/a|[\d.]+))(?:\s+((?:n\/a|[\d.]+)))?\s*$/.exec(line);
    if (m === null) continue;
    out.set(Number(m[1]),
      [m[2] === 'n/a' ? null : Number(m[2]),
        m[3] === undefined || m[3] === 'n/a' ? null : Number(m[3])]);
  }
  if (out.size === 0) {
    console.error(`rn2686bands: parsed no rows out of rn2664scale at y=${y}.`
      + ' Its output format changed; refusing to print a table of nothing.');
    console.error(r.stdout.slice(0, 800)); process.exit(1);
  }
  return out;
}

const scaleList = scales.split(',').map(Number);
const rows = [];
for (let k = 0; k < n; k += 1) {
  const y = Y0 + k * h;
  rows.push({ y, out: bandRow(y) });
  process.stderr.write(`rn2686bands: band ${k + 1}/${n} rows ${y}-${y + h}\n`);
}

const p = pose === undefined ? undefined : POSES[pose];
if (pose !== undefined && p === undefined) {
  console.error(`rn2686bands: pose '${pose}' is not declared here;`
    + ` known: ${Object.keys(POSES).join(', ')}. Printing no range column`
    + ' rather than a guessed one.');
}

console.log('\n--- RN-2686 STRUCTURE BY SCALE, BAND BY BAND ---');
console.log(`x${X} w${W}, bands of ${h} rows from y${Y0}`
  + `   ${cmp === undefined ? path.basename(img) : `${path.basename(img)} | ${path.basename(cmp)} | delta`}`);
if (p !== undefined) {
  console.log(`range column: ${pose}, eye ${p.hM} m, pitch ${p.pitch} deg,`
    + ' smooth-datum inversion, CONTEXT not evidence');
}
const head = ['rows'.padStart(9), (p === undefined ? '' : 'range'.padStart(20)),
  ...scaleList.map((s) => `s=${s}`.padStart(cmp === undefined ? 9 : 24))].join('');
console.log(`\n${head}`);
for (const r of rows) {
  const cells = scaleList.map((s) => {
    const v = r.out.get(s);
    if (v === undefined || v[0] === null) return 'n/a'.padStart(cmp === undefined ? 9 : 24);
    if (cmp === undefined) return v[0].toFixed(3).padStart(9);
    const d = v[1] === null ? null : v[1] - v[0];
    return `${v[0].toFixed(2)}|${v[1].toFixed(2)}|${d >= 0 ? '+' : ''}${d.toFixed(2)}`.padStart(24);
  });
  let rng = '';
  if (p !== undefined) {
    const a = rangeAtRow(r.y, p); const b = rangeAtRow(r.y + h, p);
    const f = (x) => (x === null ? 'above hz' : (x >= 1000 ? `${(x / 1000).toFixed(1)}km` : `${x.toFixed(0)}m`));
    rng = `${f(a)} to ${f(b)}`.padStart(20);
  }
  console.log(`${`${r.y}-${r.y + h}`.padStart(9)}${rng}${cells.join('')}`);
}
