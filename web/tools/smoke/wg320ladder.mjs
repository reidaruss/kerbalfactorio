// WG-320. THE FRAME-COST LADDER, AND THE SPLIT THAT ATTRIBUTES IT.
//
// One row per (shot, arm, repeat), every sample its own browser process, arm
// ORDER ROTATED per repeat (WG-189), all from ONE build and ONE server. It is
// `wg295reach.mjs`'s shape with the arm order rotated and the columns swapped
// for the ones a frame-time lane is judged on.
//
// THE COLUMNS, and why these and not `p99` alone:
//
//   nodes      live harvest nodes (`NodeField.placed.length`), the independent
//              variable of the ladder
//   nodeMs     `NodeField.update()`'s OWN mean cost, ms. WG-310 routed the
//              whole overhead to this function without timing it; this column
//              is the routed mechanism, measured (NUMBERS.md rule 6).
//   cpuMs      mean of EVERYTHING before `frame.render()` (`Loop.ts`). `nodeMs`
//              is one term inside it.
//   near       the near pass's own submit time, ms. Every BatchedMesh's
//              `onBeforeRender` per-instance frustum test lives HERE, on the
//              far side of the `cpuMs` line, and so does the shadow render.
//   tris       rendered triangles. Flat across the ladder is the finding this
//              lane inherits; it stays in the table as the control.
//   p50/p99    `StatsProbe`'s own percentiles over its 600-frame ring.
//
// A cost that grows with `nodes` must declare itself in `nodeMs` or in `near`.
// Publishing both is the whole point: a lane named after a mechanism will look
// for that mechanism (NUMBERS.md), and this table cannot be read that way.
//
//   node tools/smoke/wg320ladder.mjs --url=http://127.0.0.1:5932/ \
//     --shots=forestair --arms=harvestx6=0,harvestx6=0+treedensity=2,,treedensity=2 \
//     --repeats=3
//
// An EMPTY entry in `--arms` is the shipped arm; every other entry is one or
// more run.mjs flags without their leading dashes, joined with `+`.
//
// THE MULTIPLIER LADDER, in this project's own page params, because
// `HARVEST_TABLE_MULT` is 3 and `?treedensity=` multiplies on top of it:
//   mult 1 = harvestx6=0                    mult 3 = (shipped, empty arm)
//   mult 2 = harvestx6=0+treedensity=2      mult 6 = treedensity=2
import { execFileSync } from 'node:child_process';

const args = new Map();
for (const a of process.argv.slice(2)) {
  const m = /^--([^=]+)=(.*)$/.exec(a);
  if (m !== null) args.set(m[1], m[2]);
}
const url = args.get('url') ?? 'http://127.0.0.1:5932/';
const shots = (args.get('shots') ?? 'forestair').split(',').filter((s) => s.length > 0);
const arms = (args.get('arms') ?? '').split(',');
const repeats = Number(args.get('repeats') ?? 3);

const num = (v, w = 7, d = 2) =>
  (v === null || v === undefined ? 'n/a' : Number(v).toFixed(d)).padStart(w);
const int = (v, w = 7) => String(v ?? 'n/a').padStart(w);
const med = (xs) => {
  const s = xs.filter((v) => typeof v === 'number' && Number.isFinite(v)).sort((a, b) => a - b);
  return s.length === 0 ? null : s.length % 2 ? s[(s.length - 1) / 2]
    : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
const lo = (xs) => Math.min(...xs.filter(Number.isFinite));
const hi = (xs) => Math.max(...xs.filter(Number.isFinite));

const one = (shot, arm) => {
  const flags = arm.split('+').filter((s) => s.length > 0).map((s) => `--${s}`);
  const scenario = /^(flyover|forestair|limb|vista)/.test(shot) ? 'surface' : 'walk';
  const out = execFileSync(process.execPath, [
    'tools/smoke/run.mjs', `--url=${url}`, `--scenario=${scenario}`,
    '--width=1600', '--height=900', ...flags,
    '--evalfile=tools/smoke/probes/artframe.js',
    `--evalargs={"shot":"${shot}"}`,
  ], { encoding: 'utf8', maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'ignore'] });
  return JSON.parse(out.slice(out.indexOf('{'), out.lastIndexOf('}') + 1)).eval;
};

const rows = new Map();
for (const shot of shots) {
  for (let r = 0; r < repeats; ++r) {
    // WG-189. The arm ORDER rotates with the repeat, so a monotone drift in the
    // box (thermal, another lane's load) cannot be read as an arm effect: it
    // lands on a different arm each time round.
    for (let k = 0; k < arms.length; ++k) {
      const arm = arms[(k + r) % arms.length];
      const j = one(shot, arm);
      const h = j.harvest ?? {};
      const rec = {
        nodes: h.field?.nodes ?? null,
        nodeMs: h.field?.updateMs ?? null,
        skips: h.field?.composeSkips ?? null,
        shOff: `${h.field?.shadowOff ?? '?'}/${h.field?.batches ?? '?'}`,
        gate: `${h.field?.allTier3 ?? '?'}/${h.field?.cascOk ?? '?'}`,
        cpuMs: j.render?.cpuMs ?? null,
        near: j.render?.passMs?.near ?? null,
        tris: j.render?.triangles ?? null,
        calls: j.render?.calls ?? null,
        p50: j.render?.frameMs?.p50 ?? null,
        p99: j.render?.frameMs?.p99 ?? null,
        worst: j.render?.frameMs?.worst ?? null,
        treeLive: h.tree?.live ?? null,
        valid: j.valid,
      };
      const key = `${shot}/${arm === '' ? 'ship' : arm}`;
      if (!rows.has(key)) rows.set(key, []);
      rows.get(key).push(rec);
      console.log([
        key.padEnd(36), `r${r}`, `k${k}`, `valid ${rec.valid}`,
        `nodes ${int(rec.nodes, 6)}`, `treeLive ${int(rec.treeLive, 6)}`,
        `nodeMs ${num(rec.nodeMs, 6, 3)}`, `skips ${int(rec.skips, 6)}`,
        `shOff ${String(rec.shOff).padStart(5)}`,
        `gate ${String(rec.gate).padEnd(12)}`, `cpuMs ${num(rec.cpuMs, 6)}`,
        `near ${num(rec.near, 6)}`, `tris ${int(rec.tris, 9)}`,
        `calls ${int(rec.calls, 4)}`, `p50 ${num(rec.p50, 6)}`,
        `p99 ${num(rec.p99, 6)}`, `worst ${num(rec.worst, 7)}`,
      ].join('  '));
    }
  }
}

console.log('');
console.log('MEDIANS (range), n per arm:');
for (const [key, recs] of rows) {
  const f = (k, d = 2) => `${num(med(recs.map((x) => x[k])), 7, d)}`
    + ` (${num(lo(recs.map((x) => x[k])), 1, d)} to ${num(hi(recs.map((x) => x[k])), 1, d)})`;
  console.log([
    key.padEnd(36), `n=${recs.length}`,
    `nodes ${int(med(recs.map((x) => x.nodes)), 6)}`,
    `nodeMs ${f('nodeMs', 3)}`, `cpuMs ${f('cpuMs')}`, `near ${f('near')}`,
    `tris ${int(med(recs.map((x) => x.tris)), 9)}`,
    `p50 ${f('p50')}`, `p99 ${f('p99')}`,
  ].join('  '));
}
