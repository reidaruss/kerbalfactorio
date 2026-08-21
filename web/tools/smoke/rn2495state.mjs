// RN-2495. READ THE TWO PROBE SURFACES THIS LANE'S FILES PUBLISH, at the
// Forest site's own aerial position, and print them.
//
// It exists because `?propsky=0` measured 0.01 counts at `forestair` and a
// term that small is either genuinely small or NOT INSTALLED, and those two are
// the same number in a frame. `propSkyState()` publishes `spliced`,
// `folPrograms`, `installed` and `chained` for exactly this question.
//
//   node tools/smoke/rn2495state.mjs --url=http://127.0.0.1:5495/

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RUN = path.join(HERE, 'run.mjs');
const argv = new Map(process.argv.slice(2)
  .map((a) => { const i = a.indexOf('='); return [a.slice(0, i), a.slice(i + 1)]; }));
const url = argv.get('--url') ?? 'http://127.0.0.1:5495/';

// ONE LINE. A multi-line `--eval` value survives an array `spawnSync` on POSIX
// and comes back `undefined` on Windows, which is a silent wrong answer rather
// than an error, so the newlines are stripped at the end of this template.
const EVAL_SRC = `(() => {
  const p = window.__ofPropSky ? window.__ofPropSky.report() : null;
  const s = window.__ofSurfaces ? window.__ofSurfaces.report() : null;
  const t = window.__ofTerrainArt && window.__ofTerrainArt.treeline
    ? window.__ofTerrainArt.treeline() : null;
  return {
    propsky: p ? {
      published: p.published, spliced: p.spliced, folPrograms: p.folPrograms,
      skyAmbient: p.skyAmbient, scale: p.scale, misses: p.misses,
      installedCanopy: p.installed.filter((x) => /canopy|leaf/i.test(x)),
      chainedCanopy: p.chained.filter((x) => /canopy|leaf/i.test(x)),
      installedN: p.installed.length, chainedN: p.chained.length,
    } : 'ABSENT',
    tone: s && s.foliageTone ? s.foliageTone : 'ABSENT',
    surfaceKeys: s ? Object.keys(s) : 'ABSENT',
    treeline: t,
  };
})()`;
const EVAL = EVAL_SRC.split('\n').map((s) => s.trim()).join(' ');

const r = spawnSync(process.execPath, [RUN, `--url=${url}`, '--scenario=surface',
  '--lat=-19.85', '--lon=-72.7853', '--alt=1200', '--width=800', '--height=450',
  `--eval=${EVAL}`], { encoding: 'utf8', maxBuffer: 1 << 28 });
try {
  const j = JSON.parse(r.stdout);
  console.log('report keys:', Object.keys(j).join(', '));
  console.log(JSON.stringify(j.eval, null, 1));
} catch {
  console.log('no json, exit', r.status);
}
console.log('--- stderr tail ---');
console.log((r.stderr ?? '').slice(-1200));
