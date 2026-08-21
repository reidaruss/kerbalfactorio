// RN-2320. THE RANGE PALETTE SWEEPER (rendering, L3, COLOUR AT RANGE).
//
// Prints box luma/iqr/warm AND whole-frame world luma/warm/sat for the eight
// poses this lane's pass condition is judged against: the four aerial poses
// (flyover, flyovernoon, forestair, forestairnoon) and four ground poses
// (meadow, forestfloor, vista, mtnslope). One flag apart, fresh process each
// call site (WG-189's own rule), same server.
//
//   node tools/smoke/rn2320sweep.mjs --url=http://127.0.0.1:5822/ --repeats=1

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RUN = path.join(HERE, 'run.mjs');
const PROBE = path.join(HERE, 'probes', 'artframe.js');

const argv = new Map(process.argv.slice(2)
  .map((a) => { const i = a.indexOf('='); return [a.slice(0, i), a.slice(i + 1)]; }));
const url = argv.get('--url') ?? 'http://127.0.0.1:5822/';
const repeats = Number(argv.get('--repeats') ?? 1);
const shots = (argv.get('--shots')
  ?? 'flyover,flyovernoon,forestair,forestairnoon,meadow,forestfloor,vista,mtnslope').split(',');
const extraFlags = (argv.get('--flags') ?? '').split(',').filter(Boolean);
const pngPrefix = argv.get('--png');

const shotBy = (s) => (s.startsWith('forestair') || s.startsWith('flyover')
  || s === 'limb' || s === 'vista' || s === 'vistadawn' || s === 'vistanoon'
  || s === 'dawnsun' ? 'surface' : 'walk');

function once(shot, outPng) {
  const args = [RUN, `--url=${url}`, `--scenario=${shotBy(shot)}`,
    '--width=1600', '--height=900', `--evalfile=${PROBE}`,
    `--evalargs=${JSON.stringify({ shot })}`];
  if (outPng) args.push(`--out=${outPng}`);
  if (shotBy(shot) === 'walk') args.push('--sandbox=1');
  for (const f of extraFlags) args.push(`--${f}`);
  const r = spawnSync(process.execPath, args, { encoding: 'utf8', maxBuffer: 1 << 28 });
  try { return JSON.parse(r.stdout).eval; } catch {
    return { valid: false, why: `no json (exit ${r.status})`,
      stderr: (r.stderr ?? '').slice(-400) };
  }
}

const rows = [];
for (const shot of shots) {
  for (let i = 0; i < repeats; ++i) {
    const outPng = pngPrefix ? `${pngPrefix}_${shot}.png` : null;
    const e = once(shot, outPng);
    rows.push({ shot, rep: i, e });
    const w = e.world ?? {};
    console.log([
      shot.padEnd(16),
      `valid=${String(e.valid).padEnd(5)}`,
      `box=${e.box ? e.box.luma.toFixed(2) : '--'}`,
      `boxIqr=${e.box ? e.box.iqr.toFixed(2) : '--'}`,
      `boxWarm=${e.box ? e.box.warm.toFixed(2) : '--'}`,
      `world=${w.luma ? w.luma.toFixed(2) : '--'}`,
      `worldWarm=${w.warm !== undefined ? w.warm.toFixed(2) : '--'}`,
      `worldSat=${w.sat !== undefined ? w.sat.toFixed(3) : '--'}`,
      `sun=${e.sun ? e.sun.elevDot : '--'}`,
      `tri=${e.render ? e.render.triangles : '--'}`,
      `calls=${e.render ? e.render.calls : '--'}`,
      e.valid === false ? `WHY=${e.why}` : '',
    ].join(' '));
  }
}
