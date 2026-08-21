// RN-2400 tuning-loop helper: just the dawn pair, to probe how the ramp
// threshold interacts with the anti-solar sky rays (a different regime from
// the ground-ray seam, per the note in Atmosphere.glsl.ts).
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RUN = path.join(HERE, 'run.mjs');
const PROBE = path.join(HERE, 'probes', 'artframe.js');
const argv = new Map(process.argv.slice(2)
  .map((a) => { const i = a.indexOf('='); return [a.slice(0, i), a.slice(i + 1)]; }));
const url = argv.get('--url') ?? 'http://127.0.0.1:5910/';
const extraFlags = (argv.get('--flags') ?? '').split(',').filter(Boolean);

function once(shot) {
  const args = [RUN, `--url=${url}`, '--scenario=surface',
    '--width=1600', '--height=900', `--evalfile=${PROBE}`,
    `--evalargs=${JSON.stringify({ shot })}`];
  for (const f of extraFlags) args.push(`--${f}`);
  const r = spawnSync(process.execPath, args, { encoding: 'utf8', maxBuffer: 1 << 28 });
  try { return JSON.parse(r.stdout).eval; } catch {
    return { valid: false, why: `no json (exit ${r.status})` };
  }
}
const w = (v) => (v === undefined ? '--' : v.toFixed(2));
for (const shot of ['dawnsun', 'vistadawn']) {
  const e = once(shot);
  if (!e.valid) { console.log(shot.padEnd(14), 'INVALID', e.why ?? ''); continue; }
  const ex = e.extra ?? {};
  console.log([shot.padEnd(14), `skyUp.warm=${w(ex.skyUp?.warm)}`,
    `skyOff.warm=${w(ex.skyOff?.warm)}`, `skyR.warm=${w(ex.skyR?.warm)}`,
    `skyL.warm=${w(ex.skyL?.warm)}`, `skyHz.warm=${w(ex.skyHz?.warm)}`].join(' '));
}
