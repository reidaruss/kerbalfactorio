// WG-295. THE REACH ARM TABLE: one row per (shot, arm), every field this lane
// is judged on, from ONE build and ONE server.
//
// It exists for NUMBERS.md's one-session arm-table rule. Every arm here is a
// page param on the SHIPPED binary, so the whole table is re-takeable in one
// command and no row can come from a different build than the row above it.
//
// The fields are chosen so that the reach half and the cap half of R5 rank 1
// can never be confused for one another in a reading:
//
//   reachM         the tier's own readback of where it stops (the REACH half)
//   chunksCapped   chunks whose cell loop hit `want` (the CAP half)
//   capCells       cells the cap never reached, i.e. the ground the cap took
//                  away. `canopyWanted` CANNOT see this: the loop that would
//                  have counted the ask exits with the loop that would have
//                  placed the tree, so the delivery ratio reads healthy on a
//                  chunk that is nine tenths empty. See world-gen.md 6.16.
//   canopyProps    instances placed by the far tier
//   poolRefused    the hard rail; must be 0 in every row
//
//   node tools/smoke/wg295reach.mjs --url=http://127.0.0.1:5971/ \
//     --shots=flyover,forestair,forestaircanopy --arms=,canopy=0
//
// An EMPTY entry in `--arms` is the shipped arm; every other entry is one or
// more run.mjs flags without their leading dashes, joined with `+`.
import { execFileSync } from 'node:child_process';

const args = new Map();
for (const a of process.argv.slice(2)) {
  const m = /^--([^=]+)=(.*)$/.exec(a);
  if (m !== null) args.set(m[1], m[2]);
}
const url = args.get('url') ?? 'http://127.0.0.1:5971/';
const shots = (args.get('shots') ?? 'flyover').split(',').filter((s) => s.length > 0);
const arms = (args.get('arms') ?? '').split(',');
const repeats = Number(args.get('repeats') ?? 1);
const rects = (args.get('rects') ?? '').split(',').filter((s) => s.length > 0);

const num = (v, w = 8, d = 2) =>
  (v === null || v === undefined ? 'n/a' : Number(v).toFixed(d)).padStart(w);

const one = (shot, arm) => {
  const flags = arm.split('+').filter((s) => s.length > 0).map((s) => `--${s}`);
  const scenario = /^(flyover|forestair|limb)/.test(shot) ? 'surface' : 'walk';
  const out = execFileSync(process.execPath, [
    'tools/smoke/run.mjs', `--url=${url}`, `--scenario=${scenario}`,
    '--width=1600', '--height=900', ...flags,
    '--evalfile=tools/smoke/probes/artframe.js',
    `--evalargs={"shot":"${shot}"}`,
  ], { encoding: 'utf8', maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'ignore'] });
  return JSON.parse(out.slice(out.indexOf('{'), out.lastIndexOf('}') + 1)).eval;
};

for (const shot of shots) {
  for (let r = 0; r < repeats; ++r) {
    for (const arm of arms) {
      const j = one(shot, arm);
      const s = j.scatter ?? {};
      const cols = [
        `${shot}/${arm === '' ? 'ship' : arm}`.padEnd(34),
        `r${r}`,
        `valid ${j.valid}`,
        `reachM ${num(j.treeline?.reachM, 7, 1)}`,
        `tailM ${num(s.canopyTailM, 7, 1)}`,
        `canopyProps ${String(s.canopyProps ?? 'n/a').padStart(7)}`,
        `capChunks ${String(s.chunksCapped ?? 'n/a').padStart(3)}`,
        `capCells ${String(s.capCells ?? 'n/a').padStart(6)}`,
        `capCellFrac ${num(s.capCellFrac, 6, 4)}`,
        `capScaleMin ${num(s.capScaleMin, 6, 4)}`,
        `cellsCapped ${String(s.cellsCapped ?? 'n/a').padStart(6)}`,
        `placed ${String(s.propsPlaced ?? 'n/a').padStart(6)}`,
        `mid ${String(s.midProps ?? 'n/a').padStart(6)}`,
        `backlog ${String(s.scatterBacklog ?? 'n/a').padStart(3)}`,
        `poolRefused ${String(s.poolRefused ?? j.poolRefused ?? 'n/a').padStart(3)}`,
        `poolCeiling ${String(s.poolCeiling ?? 'n/a').padStart(7)}`,
        `tris ${String(j.render?.triangles ?? 'n/a').padStart(9)}`,
        `calls ${String(j.render?.calls ?? 'n/a').padStart(3)}`,
        `vramMB ${num(j.render?.vramMB, 6, 1)}`,
        `p50 ${num(j.render?.frameMs?.p50, 6, 2)}`,
        `box ${num(j.box?.luma)} / ${num(j.box?.iqr)}`,
      ];
      for (const name of rects) {
        const rr = j.extra?.[name];
        cols.push(`${name} ${num(rr?.luma)} / ${num(rr?.iqr)}`);
      }
      console.log(cols.join('  '));
    }
  }
}
