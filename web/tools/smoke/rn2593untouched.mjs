// RN-2593. WHAT THIS LANE MUST NOT HAVE TOUCHED, ASSERTED RATHER THAN ARGUED.
//
// RN-2590 scopes the crown construction by MATERIAL NAME (`OF_Canopy`, which is
// authored at `_LOD3` alone), so the understorey's normal bytes are untouched
// BY CONSTRUCTION. That is an argument, and 2.38.7's routing named exactly this
// as a risk worth a measurement rather than an argument: `bendNormals` is shared
// by grass, leaf and canopy, and RN-1766 bought **+7.4 per cent of whole-frame
// `iqr` at `forestfloor`** with it, so a crown fix that leaked into it would
// undo a shipped gain and would be invisible in the aerial poses the rest of
// this lane measures.
//
// TWO POSES, EACH A DIFFERENT CLAIM:
//
//   forestfloor  THE UNDERSTOREY. A ground-level walk pose whose subject is the
//                tufts RN-1766 was written for. `?crownnormal=0` against the
//                shipped build must move NOTHING here that is not a far crown
//                card, and the far canopy's own near cut-off (`CANOPY_NEAR_M`,
//                550 m) is what decides whether any crown is in frame at all.
//   meadownight  NIGHT. The brief's own "night untouched, meadownight
//                measured". A sub-horizon sun (dot -0.25) is the arm where a
//                shading-normal change has no direct sun term to move, so a
//                move here would be the sky ambient or the specular and would
//                be worth knowing about.
//
// THE PAIR IS `?crownnormal=0` AGAINST THE SHIPPED DEFAULT ON ONE BUILD, not
// two builds. NUMBERS' "rebuilding a before directory from current source
// destroys the pair": one binary, one flag, is strictly stronger, and it is
// available here because the whole change is behind a registered switch.
//
//   node tools/smoke/rn2593untouched.mjs --url=http://127.0.0.1:5590/
//
// EVERY FLAG NEEDS AN `=`; the parser splits on the first one.

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RUN = path.join(HERE, 'run.mjs');
const DIFF = path.join(HERE, 'pngdiff.mjs');
const PROBE = path.join(HERE, 'probes', 'artframe.js');

const argv = new Map(process.argv.slice(2)
  .map((a) => { const i = a.indexOf('='); return [a.slice(0, i), a.slice(i + 1)]; }));
const url = argv.get('--url') ?? 'http://127.0.0.1:5590/';
// INSIDE THE REPO, AND THAT IS A HARNESS CONSTRAINT RATHER THAN A PREFERENCE:
// `run.mjs` REFUSES an `--out` outside the repo ("--out must stay inside the
// repo", stage=screenshot), so a first draft of this file that wrote to the OS
// temp directory failed both arms with a bare `no json (exit 1)` and reported
// it as "an arm failed". `web/build/` is gitignored by the root rule and is
// therefore scratch that cannot be committed by accident.
const dir = path.join(HERE, '..', '..', 'build', 'rn2593');
fs.mkdirSync(dir, { recursive: true });

// THE CEILING, and it is a real number rather than zero. Two page loads of the
// SAME build do not produce byte-identical frames at every pose: RN-1766 quotes
// a 3.78 per cent two-page-load floor at `forestfloor`. A pair that comes in
// under that floor is indistinguishable from the same build twice, which is the
// claim; a pair over it has moved something.
const FLOOR_PCT = 3.78;

function shoot(shot, scenario, flags, out) {
  const args = [RUN, `--url=${url}`, `--scenario=${scenario}`,
    '--width=1600', '--height=900', `--evalfile=${PROBE}`,
    `--evalargs=${JSON.stringify({ shot })}`, `--out=${out}`, ...flags];
  if (scenario === 'walk') args.push('--sandbox=1');
  const r = spawnSync(process.execPath, args, { encoding: 'utf8', maxBuffer: 1 << 28 });
  try { return JSON.parse(r.stdout).eval; } catch {
    return { valid: false, why: `no json (exit ${r.status})` };
  }
}

const fails = [];
for (const [shot, scenario] of [['forestfloor', 'walk'], ['meadownight', 'walk']]) {
  const a = path.join(dir, `${shot}-shipped.png`);
  const b = path.join(dir, `${shot}-prelane.png`);
  const ea = shoot(shot, scenario, [], a);
  const eb = shoot(shot, scenario, ['--crownnormal=0'], b);
  if (!ea.valid || !eb.valid) {
    fails.push(`${shot}: an arm failed (${ea.why ?? ''} ${eb.why ?? ''})`); continue;
  }
  // THE ARMING CHECK. A pair between two arms that both ran the same
  // construction is a pair between one build and itself, and it would pass
  // silently forever. Read the bake's own path back and require them to differ.
  const pa = ((ea.treeline ?? {}).crownNormal ?? {}).path ?? null;
  const pb = ((eb.treeline ?? {}).crownNormal ?? {}).path ?? null;
  if (pa !== 'crown' || pb !== 'bend') {
    fails.push(`${shot}: the arms are not armed (paths ${pa} / ${pb}); this pair`
      + ' would pass whatever the crown bake did.');
  }
  const d = spawnSync(process.execPath, [DIFF, a, b],
    { encoding: 'utf8', maxBuffer: 1 << 26 });
  let j = null;
  try { j = JSON.parse(d.stdout); } catch { j = null; }
  if (j === null) { fails.push(`${shot}: pngdiff produced no json`); continue; }
  console.log(`${shot.padEnd(12)} moved ${String(j.moved).padStart(7)} px`
    + ` (${String(j.pct).padStart(5)}%)  darker ${j.darker} / lighter ${j.lighter}`
    + `  maxDelta ${j.maxDelta}  meanDelta ${j.meanDelta}`);
  if (j.pct > FLOOR_PCT) {
    fails.push(`${shot}: ${j.pct}% of pixels moved, over the ${FLOOR_PCT}%`
      + ' two-page-load floor. Something outside the crown cards moved.');
  }
}

for (const f of fails) console.error(`FAIL: ${f}`);
console.log(`\nrn2593untouched: ${fails.length === 0 ? 'clean' : `${fails.length} failure(s)`}`
  + `   (frames in ${dir})`);
process.exit(fails.length === 0 ? 0 : 1);
