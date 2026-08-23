// RN-2666. THE JOIN: the frames the second merger owes, captured as one set on
// one build so every pair below is one flag apart.
//
// `lane/wg-reach` (WG-295 to WG-303) merged first and extends the placed forest
// to 5.1 km. `lane/n16-paintstructure` is therefore the second merger and owes
// three measurements it could not take before the join:
//
//   A  the guard at all four poses on the merged tree (rn2550guard, not here)
//   B  the DOUBLE-COUNT price in the 3.4-to-5.1 km annulus, where this lane's
//      stand octave carries structure on ground the reach tail now also fills
//      with placed silhouettes. `?canopytail=1` is WG-reach's own structural
//      off for that tail (ScatterTuning's `CANOPY_TAIL_MULT` header), so the
//      annulus can be priced without a second build.
//   C  a boot, confirming `assertStandMottleMatchesScatter` still passes
//      against the merged `ScatterTuning` (npm run check:boot, not here)
//
// AND ONE MORE THIS LANE OWES ITS OWN VERIFIER: the upper band's SUPPRESSION
// pair. Section 2.44 first claimed the 8-to-15.5 km band was "refused with a
// number" on a strip-`iqr` reading the same section condemned two pages
// earlier. The honest measurement is a scale-resolved one taken twice, with
// the atmosphere in and out, so the paint's own structural INCREMENT can be
// separated from the frame's overall attenuation.
//
//   node tools/smoke/rn2666join.mjs --url=http://127.0.0.1:5660/
//   node tools/smoke/rn2666join.mjs --url=... --out=../build/rn2666
//
// EVERY FLAG NEEDS AN `=`. Eight frames, a fresh process each.

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RUN = path.join(HERE, 'run.mjs');
const PROBE = path.join(HERE, 'probes', 'artframe.js');
const TRACKED = path.join(HERE, '..', '..', '..', 'docs', 'screenshots');

const argv = new Map(process.argv.slice(2)
  .map((a) => { const i = a.indexOf('='); return [a.slice(0, i), a.slice(i + 1)]; }));
const url = argv.get('--url') ?? 'http://127.0.0.1:5660/';
const shot = argv.get('--shot') ?? 'flyover';
const outDir = argv.get('--out') === undefined
  ? TRACKED : path.resolve(HERE, argv.get('--out'));
fs.mkdirSync(outDir, { recursive: true });

const OFF3 = ['--treelinefloor=0', '--treelinestand=0', '--treelinegrove=0'];
const HAZE = ['--terrainhaze=0', '--prophaze=0'];
const FRAMES = {
  // B: the annulus, four corners of one 2x2. `tail1` is WG-reach's tail OFF.
  join_shipped: [],
  join_mottle0: ['--treelinestand=0', '--treelinegrove=0'],
  join_shipped_tail1: ['--canopytail=1'],
  join_mottle0_tail1: ['--canopytail=1', '--treelinestand=0', '--treelinegrove=0'],
  // The lane's own pre/post pair on the merged tree.
  join_pre: OFF3,
  // The upper band's suppression pair, with the atmosphere in and out.
  join_treeline0: ['--treeline=0'],
  join_shipped_nohaze: [...HAZE],
  join_treeline0_nohaze: ['--treeline=0', ...HAZE],
};

let bad = 0;
for (const [name, flags] of Object.entries(FRAMES)) {
  const out = path.join(outDir, `RN2660_${name}.png`);
  const args = [RUN, `--url=${url}`, '--scenario=surface',
    '--width=1600', '--height=900', `--evalfile=${PROBE}`,
    `--evalargs=${JSON.stringify({ shot })}`, `--out=${out}`, ...flags];
  const r = spawnSync(process.execPath, args, { encoding: 'utf8', maxBuffer: 1 << 28 });
  let j = null;
  try { j = JSON.parse(r.stdout).eval; } catch { j = null; }
  if (j === null || j.valid !== true) {
    console.error(`${name}: FAILED ${j === null ? '' : j.why}`); bad += 1; continue;
  }
  const t = j.treeline ?? {};
  const b = j.box ?? null;
  console.log(`${name.padEnd(24)} floor ${t.floorShade} stand ${t.stand}`
    + ` grove ${t.grove} amp ${t.amp} reachM ${t.reachM}`
    + (b ? `   box luma ${b.luma} iqr ${b.iqr}` : ''));
}
console.log(`\nrn2666join: ${bad === 0 ? 'ok' : `${bad} failure(s)`}  -> ${outDir}`);
process.exit(bad === 0 ? 0 : 1);
