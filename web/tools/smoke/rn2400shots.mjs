// RN-2400 proof capture: before (?aerodepth=0) / after (shipped) pairs for
// the five poses this lane's report is judged against.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RUN = path.join(HERE, 'run.mjs');
const PROBE = path.join(HERE, 'probes', 'artframe.js');
const url = 'http://127.0.0.1:5910/';
const SHOTS_DIR = path.join(HERE, '..', '..', '..', 'docs', 'screenshots');

const shotBy = (s) => (s === 'flyover' || s === 'forestair' || s === 'vista'
  || s === 'vistanoon' || s === 'dawnsun' ? 'surface' : 'walk');

function once(shot, arm, flags) {
  const outPng = path.join(SHOTS_DIR, `RN2400_${shot}_${arm}.png`);
  const args = [RUN, `--url=${url}`, `--scenario=${shotBy(shot)}`,
    '--width=1600', '--height=900', `--evalfile=${PROBE}`,
    `--evalargs=${JSON.stringify({ shot })}`, `--out=${outPng}`];
  for (const f of flags) args.push(`--${f}`);
  const r = spawnSync(process.execPath, args, { encoding: 'utf8', maxBuffer: 1 << 28 });
  try {
    const j = JSON.parse(r.stdout).eval;
    console.log(shot.padEnd(12), arm.padEnd(6), 'valid=', j.valid, outPng);
  } catch {
    console.log(shot.padEnd(12), arm.padEnd(6), 'FAILED exit', r.status, (r.stderr ?? '').slice(-300));
  }
}

for (const shot of ['vista', 'vistanoon', 'flyover', 'forestair', 'dawnsun']) {
  once(shot, 'before', ['aerodepth=0']);
  once(shot, 'after', []);
}
