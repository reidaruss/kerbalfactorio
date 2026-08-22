// RN-2606. THE PROOF CAPTURE AND THE COST PAIR for the back-face fold.
//
// A SIBLING OF `rn2592shots.mjs` RATHER THAN AN EDIT OF IT, on NUMBERS' "a
// probe file has no registry" scar: RN-2592's arms are the crown BAKE's
// (`crownnormal`, `crowncard`, `crownflank`) and its output filenames are
// `RN2590_*`. Overwriting either would make RN-2590's own committed evidence
// unreproducible by its own tool.
//
// THE CROP IS THE COMMITTED `crowns` RECTANGLE AND NOTHING ELSE:
// [0.28125, 0.666667, 0.40625, 0.777778], which at 1600x900 is (450,600)
// 200x100. RN-2525, RN-2570 and RN-2592 all cropped exactly that, so the crop
// the eye judges and the number the guard judges are the same pixels.
// Magnification is `rn2450crop.mjs`'s nearest-neighbour, because a smoothed
// magnification of a per-pixel pattern is a picture of the resampler.
//
// AND IT CARRIES THE COST PAIR, which the frames alone cannot give. `--cost=N`
// re-runs the two arms that differ ONLY in whether the splice is installed
// (`?crownface=off` against `?crownface=0`, pixel-identical by construction) N
// times each and prints every reading rather than a mean, because
// `PropSkyAmbient`'s own cost note found the within-arm spread swamping the
// between-arm difference and reported that instead of inventing a number.
//
//   node tools/smoke/rn2606shots.mjs --url=http://127.0.0.1:5605/ --cost=3
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
const url = argv.get('--url') ?? 'http://127.0.0.1:5605/';
const costRuns = Number(argv.get('--cost') ?? '0');

// ARM NAME -> the flags that make it.
//   shipped   this lane's default, `UNNEGATE`: the back face keeps the normal
//             the bake wrote. It is also 2.39.12 item 1's reversed-winding plus
//             `FrontSide` candidate's pixel, to the digit, without the geometry
//   face0     the same program with the term inert: the BEFORE, one flag apart
//   face2     `UPFOLD`, the refused candidate, kept reachable so the refusal
//             can be re-judged rather than read
//   faceoff   the splice not installed at all: the pre-lane program SET
//   noshade   `?crownshade=0` on THIS build, so the ceiling reference
//             `RN2570_crowns_noshade_3x.png` has a same-build twin and the eye
//             comparison is not across four merges of drift
const ARMS = {
  shipped: [],
  face0: ['--crownface=0'],
  face2: ['--crownface=2'],
  faceoff: ['--crownface=off'],
  noshade: ['--crownshade=0'],
};

function one(flags, out) {
  const args = [RUN, `--url=${url}`, '--scenario=surface',
    '--width=1600', '--height=900', `--evalfile=${PROBE}`,
    `--evalargs=${JSON.stringify({ shot: 'forestairnoon' })}`, ...flags];
  if (out) args.push(`--out=${out}`);
  const r = spawnSync(process.execPath, args, { encoding: 'utf8', maxBuffer: 1 << 28 });
  try { return JSON.parse(r.stdout).eval; } catch { return null; }
}

let bad = 0;
for (const [arm, flags] of Object.entries(ARMS)) {
  const out = path.join(SHOTS, `RN2605_forestair_${arm}.png`);
  const j = one(flags, out);
  if (j === null || j.valid !== true) {
    console.error(`${arm}: frame FAILED`); bad++; continue;
  }
  const c = spawnSync(process.execPath,
    [CROP, out, path.join(SHOTS, `RN2605_crowns_${arm}_3x.png`),
      '450', '600', '200', '100', '3'], { encoding: 'utf8' });
  if (c.status !== 0) { console.error(`${arm}: crop FAILED`); bad++; continue; }
  const r = j.render ?? {};
  const f = (j.treeline ?? {}).crownFace ?? null;
  console.log(`${arm.padEnd(9)} ${r.triangles} tris / ${r.calls} calls`
    + ` / ${r.programs} programs / ${r.vramMB} MB / p50 ${(r.frameMs ?? {}).p50} ms`
    + (f ? `   [face ${f.mode} cmp ${f.compiles} miss ${f.misses.length}` : '')
    + (f ? ` mats ${JSON.stringify(f.materials)}]` : ''));
}

// THE COST PAIR. Same pixels by construction, different program, so anything
// that separates here is the splice's own per-fragment and per-vertex price.
if (costRuns > 0) {
  console.log('\nTHE COST PAIR, every reading printed rather than a mean:');
  for (const arm of ['faceoff', 'face0']) {
    const p50 = []; const p95 = []; const progs = []; const tris = [];
    for (let i = 0; i < costRuns; ++i) {
      const j = one(ARMS[arm], null);
      if (j === null || j.valid !== true) { console.error(`${arm}: run failed`); bad++; continue; }
      const r = j.render ?? {};
      p50.push((r.frameMs ?? {}).p50); p95.push((r.frameMs ?? {}).p95);
      progs.push(r.programs); tris.push(r.triangles);
    }
    console.log(`  ${arm.padEnd(9)} p50 ${JSON.stringify(p50)}`
      + `  p95 ${JSON.stringify(p95)}`
      + `  programs ${JSON.stringify(progs)}  tris ${JSON.stringify(tris)}`);
  }
}

console.log(`\nrn2606shots: ${bad === 0 ? 'clean' : `${bad} failure(s)`}`);
process.exit(bad === 0 ? 0 : 1);
