// RN-2592. THE PROOF CAPTURE for the crown-normal lane: whole frames and the
// 3x crown crops the eye verdict is given on.
//
// THE CROP IS THE COMMITTED `crowns` RECTANGLE AND NOTHING ELSE. `artframe.js`
// puts `crowns` at [0.28125, 0.666667, 0.40625, 0.777778], which at 1600x900 is
// (450, 600) 200x100, and RN-2525 / RN-2570 both cropped exactly that. Using
// the same rectangle means the crop the eye judges and the number the guard
// judges are looking at the same pixels, which is the whole reason the
// rectangle was committed (RN-2495).
//
// MAGNIFICATION IS `rn2450crop.mjs`'s, nearest-neighbour, for its own stated
// reason: a smoothed magnification of a per-pixel pattern is a picture of the
// resampler.
//
//   node tools/smoke/rn2592shots.mjs --url=http://127.0.0.1:5590/
//
// EVERY FLAG NEEDS AN `=`; the parser splits on the first one.

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RUN = path.join(HERE, 'run.mjs');
const CROP = path.join(HERE, 'rn2450crop.mjs');
const PROBE = path.join(HERE, 'probes', 'artframe.js');
const SHOTS = path.join(HERE, '..', '..', '..', 'docs', 'screenshots');

const argv = new Map(process.argv.slice(2)
  .map((a) => { const i = a.indexOf('='); return [a.slice(0, i), a.slice(i + 1)]; }));
const url = argv.get('--url') ?? 'http://127.0.0.1:5590/';

// ARM NAME -> the flags that make it. `shipped` is this lane's default build,
// `prelane` is the exact pre-RN-2590 crown bake, `card035` is the refused
// out-of-plane mix and `signonly` is the sign fix with RN-1766's own anchor.
const ARMS = {
  shipped: [],
  prelane: ['--crownnormal=0'],
  card035: ['--crowncard=0.35'],
  signonly: ['--crownflank=90', '--crowncard=0'],
};

let bad = 0;
for (const [arm, flags] of Object.entries(ARMS)) {
  const out = path.join(SHOTS, `RN2590_forestair_${arm}.png`);
  const args = [RUN, `--url=${url}`, '--scenario=surface',
    '--width=1600', '--height=900', `--evalfile=${PROBE}`,
    `--evalargs=${JSON.stringify({ shot: 'forestairnoon' })}`,
    `--out=${out}`, ...flags];
  const r = spawnSync(process.execPath, args, { encoding: 'utf8', maxBuffer: 1 << 28 });
  let ok = false; let tri = null;
  try {
    const j = JSON.parse(r.stdout).eval;
    ok = j.valid === true;
    tri = j.render ? `${j.render.triangles} tris / ${j.render.calls} calls`
      + ` / ${j.render.programs} programs / ${j.render.vramMB} MB`
      + ` / p50 ${j.render.frameMs.p50} ms` : null;
  } catch { ok = false; }
  if (!ok) { console.error(`${arm}: frame FAILED (exit ${r.status})`); bad++; continue; }
  const c = spawnSync(process.execPath,
    [CROP, out, path.join(SHOTS, `RN2590_crowns_${arm}_3x.png`),
      '450', '600', '200', '100', '3'], { encoding: 'utf8' });
  if (c.status !== 0) { console.error(`${arm}: crop FAILED`); bad++; continue; }
  console.log(`${arm.padEnd(10)} ${out}`);
  console.log(`${''.padEnd(10)} ${tri}`);
}
console.log(`\nrn2592shots: ${bad === 0 ? 'clean' : `${bad} failure(s)`}`);
process.exit(bad === 0 ? 0 : 1);
