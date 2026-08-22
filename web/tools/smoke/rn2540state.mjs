// RN-2540. READ THE ARM'S OWN PUBLISHED STATE, so a flag is proved NON-VACUOUS
// from the page rather than from having been typed.
//
// RN-2268's scar and RN-698's whitelist are the same failure twice: a flag that
// never reaches a uniform reports the DEFAULT, and the table then describes the
// default as the request. Every new knob this lane registers therefore has to
// be readable live, and `AerialDiag.aerialDiagState()` publishes both halves --
// whether the parameter was PRESENT on the URL, and what value the uniform
// actually carries -- beside `propSkyState()`'s splice counters, which are what
// say the prop half reached a program at all.
//
//   node tools/smoke/rn2540state.mjs --url=http://127.0.0.1:5540/ --arm=proppaint=1

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RUN = path.join(HERE, 'run.mjs');
const argv = new Map(process.argv.slice(2)
  .map((a) => { const i = a.indexOf('='); return [a.slice(0, i), a.slice(i + 1)]; }));
const url = argv.get('--url') ?? 'http://127.0.0.1:5540/';
const arm = argv.get('--arm') ?? '';

// ONE LINE, for `rn2495state.mjs`'s own stated reason: a multi-line `--eval`
// value survives an array `spawnSync` on POSIX and comes back `undefined` on
// Windows, which is a silent wrong answer rather than an error.
const EVAL_SRC = `(() => {
  const a = window.__ofAerialDiag ? window.__ofAerialDiag.report() : 'ABSENT';
  const p = window.__ofPropSky ? window.__ofPropSky.report() : null;
  const c = window.__ofTerrainArt && window.__ofTerrainArt.treeline
    ? window.__ofTerrainArt.treeline() : null;
  return {
    aerialDiag: a,
    propsky: p ? { published: p.published, spliced: p.spliced,
      folPrograms: p.folPrograms, misses: p.misses,
      chainedCanopy: p.chained.filter((x) => /canopy/i.test(x)) } : 'ABSENT',
    crownShade: c && c.self ? { cardShade: c.self.cardShade,
      cardShadeRGB: c.self.cardShadeRGB, spectral: c.self.spectral } : 'ABSENT',
  };
})()`;
const EVAL = EVAL_SRC.split('\n').map((s) => s.trim()).join(' ');

const args = [RUN, `--url=${url}`, '--scenario=surface',
  '--lat=-19.85', '--lon=-72.7853', '--alt=1200', '--width=800', '--height=450',
  `--eval=${EVAL}`];
for (const f of arm.split('+').filter(Boolean)) args.push(`--${f}`);
const r = spawnSync(process.execPath, args, { encoding: 'utf8', maxBuffer: 1 << 28 });
try {
  const j = JSON.parse(r.stdout);
  console.log(`arm=${arm || 'SHIPPED'}`);
  console.log(JSON.stringify(j.eval, null, 1));
} catch {
  console.log('no json, exit', r.status);
  console.log((r.stderr ?? '').slice(-1200));
}
