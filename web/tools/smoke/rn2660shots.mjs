// RN-2660. THE HERO PAIRS FOR THE FAR PAINT'S TWO NEW TERMS, at 1x, plus the
// band crop the eye verdict is actually taken on.
//
// FOUR ARMS, one flag apart on ONE build, so every pair is a comparison rather
// than two builds' worth of drift (NUMBERS.md: rebuilding a "before" directory
// from current source destroys the pair):
//
//   shipped   both terms live: the wood's floor is shaded (RN-2661) and the
//             missing density carries world-gen's stand factor (RN-2665)
//   floor0    `?treelinefloor=0`, the wood's floor lit like a clearing again.
//             The LEVEL half of the lane, and the arm the debt is measured on
//   mottle0   both octaves off. The STRUCTURE half
//   pre       both off: the pre-RN-2660 frame to the bit, and the arm the
//             audit's own rank-1 complaint was written against
//
// THE CROP IS PLACED ON THE BAND RATHER THAN ON THE CROWNS, which is the whole
// difference from `rn2646shots`. R5 rank 1 is about rows 329 to 549 at
// `flyover`, i.e. 15.5 km down to 3.3 km, and `rn2646shots`'s (450,600) crop
// is the crown-card mass at 2 km and below. The band crop is (560,330) 900x210
// at 2x. It starts at x 560 and not at the frame edge because the HUD reaches
// about x 382 (pngdiff excludes the left 210 and this is wider than that), and
// it is 900 px across so a 165 m stand (3 to 12 px over this span) and a 760 m
// grove (15 to 100 px) are both judged against several of their neighbours
// rather than in isolation. It is the SAME rectangle rn2664scale scores.
//
//   node tools/smoke/rn2660shots.mjs --url=http://127.0.0.1:5660/ --shot=flyover
//   node tools/smoke/rn2660shots.mjs --url=http://127.0.0.1:5660/ \
//     --shot=forestaircanopy --crop=240,380,560,180
//   node tools/smoke/rn2660shots.mjs --url=... --shot=flyover --out=../build/rn2660
//
// EVERY FLAG NEEDS AN `=`. Default output is the TRACKED `docs/screenshots`,
// and `--out=` redirects it (resolved against this script), which is
// RN-2605's fresh-context verifier's own ask: a verifier reproducing one
// number must not have to dirty the tree to do it.

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
const url = argv.get('--url') ?? 'http://127.0.0.1:5660/';
const shot = argv.get('--shot') ?? 'flyover';
const sun = argv.get('--sun');
const sunTol = argv.get('--suntol') ?? '0.03';
const crop = (argv.get('--crop') ?? '560,330,900,210').split(',');
const scale = argv.get('--scale') ?? '2';
const outDir = argv.get('--out') === undefined
  ? TRACKED : path.resolve(HERE, argv.get('--out'));
fs.mkdirSync(outDir, { recursive: true });

const ARMS = {
  shipped: [],
  floor0: ['--treelinefloor=0'],
  mottle0: ['--treelinestand=0', '--treelinegrove=0'],
  pre: ['--treelinefloor=0', '--treelinestand=0', '--treelinegrove=0'],
};
const EVALARGS = sun === undefined
  ? { shot } : { shot, sunDot: Number(sun), sunTol: Number(sunTol) };
const scen = shot.startsWith('meadow') || shot.startsWith('vista')
  || shot.startsWith('forestfloor') ? 'walk' : 'surface';

function one(flags, out) {
  const args = [RUN, `--url=${url}`, `--scenario=${scen}`,
    '--width=1600', '--height=900', `--evalfile=${PROBE}`,
    `--evalargs=${JSON.stringify(EVALARGS)}`, `--out=${out}`, ...flags];
  if (scen === 'walk') args.push('--sandbox=1');
  const r = spawnSync(process.execPath, args, { encoding: 'utf8', maxBuffer: 1 << 28 });
  try { return JSON.parse(r.stdout).eval; } catch { return null; }
}

const tag = sun === undefined ? shot : `${shot}_sun${sun}`;
let bad = 0;
for (const [arm, flags] of Object.entries(ARMS)) {
  const out = path.join(outDir, `RN2660_${tag}_${arm}.png`);
  const j = one(flags, out);
  if (j === null || j.valid !== true) {
    console.error(`${arm}: frame FAILED ${j === null ? '' : j.why}`); bad += 1; continue;
  }
  const c = spawnSync(process.execPath, [CROP, out,
    path.join(outDir, `RN2660_band_${tag}_${arm}_${scale}x.png`),
    crop[0], crop[1], crop[2], crop[3], scale], { encoding: 'utf8' });
  if (c.status !== 0) { console.error(`${arm}: crop FAILED`); bad += 1; continue; }
  // THE ARMING, PRINTED BESIDE EVERY FRAME. An identical reading from an arm
  // nobody has looked at before is indistinguishable from an arm that never
  // reached the program, so the two uniforms are read back off the page.
  const t = j.treeline ?? {};
  const b = j.box ?? null;
  console.log(`${arm.padEnd(8)} floorShade ${t.floorShade} stand ${t.stand}`
    + ` grove ${t.grove} reachM ${t.reachM}`
    + (b ? `   box luma ${b.luma} linY ${b.lin.Y.toFixed(6)} iqr ${b.iqr}` : ''));
}
console.log(`\nrn2660shots: ${bad === 0 ? 'ok' : `${bad} failure(s)`}  -> ${outDir}`);
process.exit(bad === 0 ? 0 : 1);
