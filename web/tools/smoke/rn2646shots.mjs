// RN-2646. THE PROOF CAPTURE AND THE COST PAIR for the crown's environment cut
// and the shade law's transmittance form.
//
// A SIBLING OF `rn2606shots.mjs` RATHER THAN AN EDIT OF IT, on NUMBERS' "a
// probe file has no registry" scar: RN-2606's arms are the back-face fold's
// (`crownface`) and its output filenames are `RN2605_*`. Overwriting either
// would make RN-2605's own committed evidence unreproducible by its own tool.
//
// AND IT TAKES `--out=`, WHICH ITS TWO PREDECESSORS DID NOT. RN-2605's
// fresh-context verifier filed exactly that as a trap: `rn2606shots` and
// `rn2592shots` write straight into the tracked `docs/screenshots/` with no
// way to redirect, so a verifier reproducing a single number rewrites sixteen
// tracked PNGs and then has to decide whether the diff is a finding or an
// artefact of having looked. The tracked directory is still the DEFAULT, which
// is what that entry asks for.
//
// THE CROP IS THE COMMITTED `crowns` RECTANGLE AND NOTHING ELSE:
// [0.28125, 0.666667, 0.40625, 0.777778], which at 1600x900 is (450,600)
// 200x100, the same pixels the guard's band is on. Magnification is
// `rn2450crop.mjs`'s nearest neighbour, because a smoothed magnification of a
// per-pixel pattern is a picture of the resampler.
//
//   node tools/smoke/rn2646shots.mjs --url=http://127.0.0.1:5645/ --cost=3
//   node tools/smoke/rn2646shots.mjs --url=... --out=../build/rn2646
//
// `--out=` is resolved relative to THIS FILE and **must stay inside the repo**:
// `run.mjs` refuses an `--out` outside it, so a path that escapes fails at the
// first frame rather than writing somewhere surprising. `web/build/` and
// `web/tools/build/` are both gitignored and are the right scratch targets.
//
// EVERY FLAG NEEDS AN `=`; the parser splits on the first one.

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RUN = path.join(HERE, 'run.mjs');
const CROP = path.join(HERE, 'rn2450crop.mjs');
const PROBE = path.join(HERE, 'probes', 'artframe.js');
const TRACKED = path.join(HERE, '..', '..', '..', 'docs', 'screenshots');

const argv = new Map(process.argv.slice(2)
  .map((a) => { const i = a.indexOf('='); return [a.slice(0, i), a.slice(i + 1)]; }));
const url = argv.get('--url') ?? 'http://127.0.0.1:5645/';
const costRuns = Number(argv.get('--cost') ?? '0');
const shot = argv.get('--shot') ?? 'forestairnoon';
// NIGHT WITHOUT A NEW POSE. `artframe.js` already takes `sunDot` and `sunTol`
// as evalargs ARGUMENTS (`of.setSunElev(A.sunDot ?? S.sunDot)`), so the Forest
// AERIAL site can be re-shot at `meadownight`'s own -0.25 sun with no
// committed pose row touched, no rectangle moved and no `artframe.js` edit.
// That is the pattern RN-2605 filed in `docs/web/NUMBERS.md` ("a condition the
// pose set does not cover can often be an argument rather than a new pose"),
// and it comes with that entry's own warning attached: an identical reading
// from a pose nobody has looked at before is indistinguishable from a pose
// that renders nothing, so the ARMING has to be stated beside the null.
const sun = argv.get('--sun');
const sunTol = argv.get('--suntol') ?? '0.03';
const outDir = argv.get('--out') === undefined
  ? TRACKED : path.resolve(HERE, argv.get('--out'));
fs.mkdirSync(outDir, { recursive: true });

// ARM NAME -> the flags that make it.
//   shipped   this lane's default: the crown card carries its own `envMap` and
//             a derived `crownSkyView(K * mu)` on `envMapIntensity`
//   envoff    the own-`envMap` is NOT installed, so the material sits back
//             inside `WebGLRenderer.js:2694-2696`'s overwrite branch. The
//             pre-RN-2645 frame and the arm the COST is measured against
//   env1      installed, intensity forced to 1 x the scene's own. It must
//             reproduce `envoff` TO THE DIGIT, which is what proves that
//             installing an own `envMap` is not itself a look change
//   env0      installed, intensity 0: the DELETING control. Its distance from
//             `env1` is the whole authority of this handle
//   law1      the shade law on the layer MEAN (the sunlit fraction) with the
//             environment left alone, so the two handles are separable by eye
//             as well as in the table
//   noshade   `?crownshade=0` on THIS build, so the ceiling reference
//             `RN2570_crowns_noshade_3x.png` has a same-build twin and the eye
//             comparison is not across five merges of drift
const ARMS = {
  shipped: [],
  envoff: ['--crownenv=off'],
  env1: ['--crownenv=1'],
  env0: ['--crownenv=0'],
  law1: ['--crownshadelaw=1', '--crownenv=off'],
  noshade: ['--crownshade=0', '--crownenv=off'],
};

const EVALARGS = sun === undefined
  ? { shot } : { shot, sunDot: Number(sun), sunTol: Number(sunTol) };

function one(flags, out) {
  const args = [RUN, `--url=${url}`, '--scenario=surface',
    '--width=1600', '--height=900', `--evalfile=${PROBE}`,
    `--evalargs=${JSON.stringify(EVALARGS)}`, ...flags];
  if (out) args.push(`--out=${out}`);
  const r = spawnSync(process.execPath, args, { encoding: 'utf8', maxBuffer: 1 << 28 });
  try { return JSON.parse(r.stdout).eval; } catch { return null; }
}

let bad = 0;
for (const [arm, flags] of Object.entries(ARMS)) {
  const out = path.join(outDir,
    `RN2645_${shot}${sun === undefined ? '' : `_sun${sun}`}_${arm}.png`);
  const j = one(flags, out);
  if (j === null || j.valid !== true) {
    console.error(`${arm}: frame FAILED`); bad++; continue;
  }
  const c = spawnSync(process.execPath,
    [CROP, out, path.join(outDir,
      `RN2645_crowns_${shot === 'forestairnoon' ? '' : `${shot}_`}${arm}_3x.png`),
    '450', '600', '200', '100', '3'], { encoding: 'utf8' });
  if (c.status !== 0) { console.error(`${arm}: crop FAILED`); bad++; continue; }
  const r = j.render ?? {};
  const e = (j.treeline ?? {}).crownEnv ?? null;
  const cr = (j.extra ?? {}).crowns ?? null;
  console.log(`${arm.padEnd(8)} ${r.triangles} tris / ${r.calls} calls`
    + ` / ${r.programs} programs / ${r.vramMB} MB / p50 ${(r.frameMs ?? {}).p50} ms`
    + (cr ? `   crowns luma ${cr.luma} linY ${cr.lin.Y.toFixed(6)} iqr ${cr.iqr}` : '')
    + (e ? `   [env own ${e.ownEnvMap} same ${e.sameTexture}`
      + ` skyView ${e.skyView.toFixed(4)} applied ${e.applied.toFixed(4)}`
      + ` live ${e.appliedLive === null ? 'null' : e.appliedLive.toFixed(4)}`
      + ` sceneI ${e.sceneIntensity} writes ${e.writes}]` : ''));
}

// THE COST PAIR. `envoff` against `env1` is the same pixel by construction (an
// own `envMap` holding the scene's own texture at the scene's own intensity),
// so anything that separates here is the price of leaving the renderer's
// overwrite branch and of the per-frame write, and nothing else.
if (costRuns > 0) {
  console.log('\nTHE COST PAIR, every reading printed rather than a mean:');
  for (const arm of ['envoff', 'env1']) {
    const p50 = []; const p95 = []; const progs = []; const tris = [];
    for (let i = 0; i < costRuns; ++i) {
      const j = one(ARMS[arm], null);
      if (j === null || j.valid !== true) { console.error(`${arm}: run failed`); bad++; continue; }
      const r = j.render ?? {};
      p50.push((r.frameMs ?? {}).p50); p95.push((r.frameMs ?? {}).p95);
      progs.push(r.programs); tris.push(r.triangles);
    }
    console.log(`  ${arm.padEnd(8)} p50 ${JSON.stringify(p50)}`
      + `  p95 ${JSON.stringify(p95)}`
      + `  programs ${JSON.stringify(progs)}  tris ${JSON.stringify(tris)}`);
  }
}

console.log(`\nrn2646shots: ${bad === 0 ? 'clean' : `${bad} failure(s)`}`
  + `   (frames in ${outDir})`);
process.exit(bad === 0 ? 0 : 1);
