// Lane A5 scratch sweeper: N arms x R repeats against ONE server, rotating the
// arm order every repeat (WG-189's interleaved method, ceilingsweep.mjs's rule)
// so a warm-up or a thermal drift cannot be read as an arm delta. Prints the
// judged numbers per run plus the per-arm median and within-arm spread, which
// is what a delta has to clear.
//
// It exists beside `ceilingsweep.mjs` rather than inside it because that file
// hardcodes `--scenario=walk` and a five-pose table, so it cannot drive
// `meadow` (added at RN-2130) or `flyover` (which needs `--scenario=surface`
// and an altitude the walk teleport discards). This drives the artframe SHOTS
// by name, which is where the poses actually live.
//
//   node tools/smoke/a5sweep.mjs --shot=forestfloor --repeats=3 base propsky=off
//
// An arm is `base` or a run.mjs flag WITHOUT the leading dashes.
import { spawnSync } from 'node:child_process';

const argv = process.argv.slice(2);
const shot = (argv.find((a) => a.startsWith('--shot=')) ?? '--shot=meadow').slice(7);
const repeats = Number((argv.find((a) => a.startsWith('--repeats=')) ?? '--repeats=3').slice(10));
const url = (argv.find((a) => a.startsWith('--url=')) ?? '--url=http://127.0.0.1:5391/').slice(6);
const arms = argv.filter((a) => !a.startsWith('--'));
if (arms.length === 0) { console.error('a5sweep: name at least one arm'); process.exit(2); }

const scenario = shot === 'flyover' ? 'surface' : 'walk';
const KEYS = ['box', 'nearG', 'shade', 'mid', 'skyHi', 'hzBand', 'under', 'skyBand',
  'shadowStep', 'skyHz', 'tris', 'calls', 'p50'];

function run(arm) {
  const flags = arm === 'base' ? [] : [`--${arm}`];
  const r = spawnSync(process.execPath, [
    'tools/smoke/run.mjs', `--url=${url}`, `--scenario=${scenario}`,
    '--width=1600', '--height=900', ...flags,
    '--evalfile=tools/smoke/probes/artframe.js',
    `--evalargs=${JSON.stringify({ shot })}`,
  ], { encoding: 'utf8', maxBuffer: 1 << 28 });
  if (r.status !== 0) { console.error(r.stderr?.slice(-1200)); throw new Error(`arm ${arm} failed`); }
  const j = JSON.parse(r.stdout).eval;
  const e = j.extra ?? {};
  const out = { box: j.box.luma, p05: j.box.p05, loFrac: j.box.loFrac, iqr: j.box.iqr };
  for (const k of Object.keys(e)) out[k] = e[k].luma;
  out.tris = j.render.triangles;
  out.calls = j.render.calls;
  out.p50 = j.render.frameMs.p50;
  return out;
}

const rows = new Map(arms.map((a) => [a, []]));
for (let r = 0; r < repeats; ++r) {
  for (let i = 0; i < arms.length; ++i) {
    const arm = arms[(i + r) % arms.length];
    const v = run(arm);
    rows.get(arm).push(v);
    const shown = Object.keys(v).filter((k) => KEYS.includes(k) || k === 'p05' || k === 'loFrac');
    console.log(`r${r} ${arm.padEnd(16)} `
      + shown.map((k) => `${k} ${typeof v[k] === 'number' ? v[k].toFixed(2) : v[k]}`).join('  '));
  }
}

const med = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[s.length >> 1]; };
console.log('\n--- per-arm median (spread = max-min within the arm) ---');
const fields = Object.keys(rows.get(arms[0])[0]);
for (const f of fields) {
  const cells = arms.map((a) => {
    const xs = rows.get(a).map((v) => v[f]);
    return `${a}=${med(xs).toFixed(2)}(+-${(Math.max(...xs) - Math.min(...xs)).toFixed(2)})`;
  });
  console.log(`  ${f.padEnd(11)} ${cells.join('  ')}`);
}
