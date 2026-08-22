// RN-2560 (rendering, LANE N9). ONE FLAG APART, EVERY COMMITTED RECTANGLE.
//
// `rn2540arms.mjs` prints the rectangles you NAME, which is right for an
// attribution ladder at one rect. This lane's questions are the other shape:
// "did this change move anything anywhere", and "what does this arm cost at
// every rectangle this pose has". Naming them by hand is how a rectangle that
// moved gets left out of a table, so this tool enumerates whatever the capture
// publishes -- `world` first, then `box`, then every `extra` -- and prints
// luma and iqr per arm.
//
//   node tools/smoke/rn2560pair.mjs --url=http://127.0.0.1:5960/ \
//     --shots=forestair,flyover --arms=,treelinefar=1 --repeats=1
//
// An EMPTY `--arms` entry is the shipped arm. Multi-param arms join with `+`,
// as in `rn2540arms.mjs`. `--repeats` re-runs each arm in its own fresh
// process (WG-189's rule); a value that differs between repeats is printed
// with both, never averaged.
//
// USE `--repeats=3` AT MINIMUM, and the reason is measured rather than
// cautious: RN-2560's verifier found a once-in-nine CORRELATED whole-frame
// capture artifact that moves `world`, `box`, `skyBand` and `under` together by
// 0.01 counts in one direction and never reproduces. A single capture per arm
// cannot tell that from a faint term that touches everything, which is exactly
// what a no-pixel-change pair is for. The default stays 1 because a stage map
// does not need three, and the tool prints every repeat rather than a mean
// precisely so a disagreement is visible instead of averaged away.

import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RUN = path.join(HERE, 'run.mjs');
const PROBE = path.join(HERE, 'probes', 'artframe.js');

const argv = new Map(process.argv.slice(2)
  .map((a) => { const i = a.indexOf('='); return [a.slice(0, i), a.slice(i + 1)]; }));
const url = argv.get('--url') ?? 'http://127.0.0.1:5960/';
const shots = (argv.get('--shots') ?? 'forestair').split(',');
const arms = (argv.get('--arms') ?? ',treelinefar=1').split(',');
const repeats = Number(argv.get('--repeats') ?? 1);
const jsonOut = argv.get('--json');

const shotBy = (s) => (s.startsWith('forestair') || s.startsWith('flyover')
  || s === 'limb' || s === 'vista' || s === 'vistadawn' || s === 'vistanoon'
  || s === 'dawnsun' ? 'surface' : 'walk');

function once(shot, arm) {
  const args = [RUN, `--url=${url}`, `--scenario=${shotBy(shot)}`,
    '--width=1600', '--height=900', `--evalfile=${PROBE}`,
    `--evalargs=${JSON.stringify({ shot })}`];
  if (shotBy(shot) === 'walk') args.push('--sandbox=1');
  for (const f of arm.split('+').filter(Boolean)) args.push(`--${f}`);
  const r = spawnSync(process.execPath, args, { encoding: 'utf8', maxBuffer: 1 << 28 });
  try { return JSON.parse(r.stdout).eval; } catch {
    return { valid: false, why: `no json (exit ${r.status})`,
      stderr: (r.stderr ?? '').slice(-500) };
  }
}

function rectsOf(e) {
  const out = [];
  if (e.world) out.push(['world', e.world]);
  if (e.box) out.push(['box', e.box]);
  for (const [k, v] of Object.entries(e.extra ?? {})) {
    if (v && typeof v.luma === 'number') out.push([k, v]);
  }
  return out;
}

const cell = (rs) => {
  const u = [...new Set(rs.map((r) => `${r.luma.toFixed(2)}/${r.iqr.toFixed(2)}`))];
  return u.join(' | ');
};

const rows = [];
for (const shot of shots) {
  const per = arms.map((arm) => {
    const reps = [];
    for (let i = 0; i < repeats; ++i) reps.push(once(shot, arm));
    return { arm: arm === '' ? 'SHIPPED' : arm, reps };
  });
  console.log(`\n== ${shot}`);
  for (const a of per) {
    console.log(`   arm ${a.arm.padEnd(22)} valid=${a.reps.map((r) => r.valid).join('/')}`
      + `  far=${a.reps.map((r) => (r.treeline ?? {}).far).join('/')}`
      + `  paint=${a.reps.map((r) => (r.treeline ?? {}).paint).join('/')}`);
  }
  const names = rectsOf(per[0].reps[0]).map(([n]) => n);
  console.log(`   ${'rectangle'.padEnd(14)} `
    + per.map((a) => a.arm.padStart(22)).join('  '));
  for (const n of names) {
    const cells = per.map((a) => cell(a.reps
      .map((e) => rectsOf(e).find(([m]) => m === n)?.[1])
      .filter(Boolean)));
    console.log(`   ${n.padEnd(14)} ` + cells.map((c) => c.padStart(22)).join('  '));
    rows.push({ shot, rect: n,
      arms: Object.fromEntries(per.map((a, i) => [a.arm, cells[i]])) });
  }
}
if (jsonOut) writeFileSync(jsonOut, JSON.stringify(rows, null, 1));
