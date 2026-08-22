// WG-260. INTERLEAVED PERF PAIRS FOR A PAGE-PARAM ARM, on `wg220sweep.mjs`'s
// shape and for the same reason (WG-189): a serial before-and-after lets
// thermal drift and whatever else is building on the machine land entirely on
// one arm, so the two arms run BACK TO BACK inside one session with the ORDER
// ROTATED per repeat.
//
// The one difference from `wg220sweep.mjs` is the axis. That script pairs two
// URLS, i.e. two builds; this one pairs two FLAG SETS against ONE url, because
// this lane's arms are page params on a single build. That is not a
// convenience: NUMBERS.md's one-session arm-table entry (2026-08-21) is
// exactly about a table whose rows came from different builds, and the remedy
// it names is a page-param override so the whole table stays re-takeable from
// the shipped binary in one command.
//
//   node tools/smoke/wg260sweep.mjs --url=http://127.0.0.1:5261/ \
//     --shot=meadowfield --scenario=walk --repeats=3 \
//     --off="--midhole=0 --midedge=0" [--extra="--sandbox=1"]
//
// Prints one line per run (so a reader can see the raw ladder rather than a
// median that hides it), then the per-arm median and spread, then the PAIRED
// differences, which are the statistic an interleaved design earns: three
// pairs that agree in sign separate a delta the per-arm spreads do not.
import { execFileSync } from 'node:child_process';

const args = new Map();
for (const a of process.argv.slice(2)) {
  const m = /^--([^=]+)=(.*)$/.exec(a);
  if (m !== null) args.set(m[1], m[2]);
}
const url = args.get('url') ?? 'http://127.0.0.1:5173/';
const shot = args.get('shot') ?? 'meadowfield';
const scenario = args.get('scenario') ?? 'walk';
const repeats = Number(args.get('repeats') ?? 3);
const extra = (args.get('extra') ?? '').split(' ').filter((s) => s.length > 0);
const offFlags = (args.get('off') ?? '').split(' ').filter((s) => s.length > 0);
if (offFlags.length === 0) {
  console.error('wg260sweep: --off= is required and names the OFF arm\'s page '
    + 'params. Without it both arms are the same run and the pair is a '
    + 'same-config control, not a comparison.');
  process.exit(2);
}
const ARMS = [{ name: 'on', flags: [] }, { name: 'off', flags: offFlags }];

const one = (arm) => {
  const out = execFileSync(process.execPath, [
    'tools/smoke/run.mjs', `--url=${url}`, `--scenario=${scenario}`,
    '--width=1600', '--height=900', ...extra, ...arm.flags,
    '--evalfile=tools/smoke/probes/artframe.js',
    `--evalargs={"shot":"${shot}"}`,
  ], { encoding: 'utf8', maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'ignore'] });
  const j = JSON.parse(out.slice(out.indexOf('{'), out.lastIndexOf('}') + 1)).eval;
  return {
    p50: j.render.frameMs.p50, p95: j.render.frameMs.p95,
    near: j.render.passMs.near, tris: j.render.triangles,
    calls: j.render.calls, mid: j.scatter?.midProps ?? null,
    placed: j.scatter?.propsPlaced ?? null,
    backlog: j.scatter?.scatterBacklog ?? null,
    refused: j.poolRefused,
  };
};

const got = { on: [], off: [] };
for (let r = 0; r < repeats; ++r) {
  for (const arm of ARMS.map((_, i) => ARMS[(i + r) % ARMS.length])) {
    const v = one(arm);
    got[arm.name].push(v);
    console.log(`repeat ${r} ${arm.name.padEnd(3)} p50 ${String(v.p50).padStart(5)}`
      + ` p95 ${String(v.p95).padStart(5)} near ${String(v.near).padStart(5)}`
      + ` tris ${v.tris} calls ${v.calls} mid ${v.mid} placed ${v.placed}`
      + ` backlog ${v.backlog} poolRefused ${v.refused}`);
  }
}
const med = (a) => { const s = [...a].sort((x, y) => x - y); return s[(s.length - 1) >> 1]; };
for (const k of ['on', 'off']) {
  const p = got[k].map((v) => v.p50);
  console.log(`${shot} ${k}: p50 median ${med(p).toFixed(2)} spread `
    + `${(Math.max(...p) - Math.min(...p)).toFixed(2)} (${p.join(', ')}) `
    + `tris ${got[k][0].tris} calls ${got[k][0].calls}`);
}
const diffs = got.on.map((v, i) => Number((v.p50 - got.off[i].p50).toFixed(2)));
const same = diffs.every((d) => d > 0) || diffs.every((d) => d < 0);
console.log(`${shot} paired on-minus-off: ${diffs.join(', ')} ms; `
  + `${same ? 'ALL PAIRS AGREE IN SIGN' : 'PAIRS DISAGREE IN SIGN, unresolved'}`);
