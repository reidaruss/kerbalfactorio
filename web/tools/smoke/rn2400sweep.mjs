// RN-2400 (rendering, lane M1, THE DISTANCE GOES BLUE).
//
// Prints the seam pair (vista/vistanoon hzBand vs skyHz warm), the dawn side
// effect pair (dawnsun.skyUp, vistadawn.skyR) and the four aerial whole-frame
// warm figures the audit's own acceptance table names, one flag apart, fresh
// process per call site (WG-189's own rule), same server.
//
//   node tools/smoke/rn2400sweep.mjs --url=http://127.0.0.1:5910/ --flags=aerodepth=0

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

const shotBy = (s) => (s.startsWith('forestair') || s.startsWith('flyover')
  || s === 'limb' || s === 'vista' || s === 'vistadawn' || s === 'vistanoon'
  || s === 'dawnsun' ? 'surface' : 'walk');

function once(shot) {
  const args = [RUN, `--url=${url}`, `--scenario=${shotBy(shot)}`,
    '--width=1600', '--height=900', `--evalfile=${PROBE}`,
    `--evalargs=${JSON.stringify({ shot })}`];
  for (const f of extraFlags) args.push(`--${f}`);
  const r = spawnSync(process.execPath, args, { encoding: 'utf8', maxBuffer: 1 << 28 });
  try { return JSON.parse(r.stdout).eval; } catch {
    return { valid: false, why: `no json (exit ${r.status})`,
      stderr: (r.stderr ?? '').slice(-400) };
  }
}

const w = (v) => (v === undefined ? '--' : v.toFixed(2));

for (const shot of ['vista', 'vistanoon', 'dawnsun', 'vistadawn',
  'flyover', 'flyovernoon', 'forestair', 'forestairnoon']) {
  const e = once(shot);
  if (!e.valid) { console.log(shot.padEnd(14), 'INVALID', e.why ?? ''); continue; }
  const ex = e.extra ?? {};
  console.log([
    shot.padEnd(14),
    `hzBand.warm=${w(ex.hzBand?.warm)}`,
    `skyHz.warm=${w(ex.skyHz?.warm)}`,
    `skyUp.warm=${w(ex.skyUp?.warm)}`,
    `skyR.warm=${w(ex.skyR?.warm)}`,
    `world.warm=${w(e.world?.warm)}`,
    `sun=${e.sun ? e.sun.elevDot : '--'}`,
  ].join(' '));
}
