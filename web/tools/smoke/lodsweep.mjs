// DW-19 cost curve: runs the lodfeet probe across (splitRatio, maxDepth) in the
// real browser and prints one markdown row per config. Foreground, serial.
//
//   node tools/smoke/lodsweep.mjs 1.0/12 1.4/13 1.4/14 1.4/15
//
// Each row carries its own DW-20 validity flag; an invalid row prints INVALID
// instead of numbers, because a probe that did not drive the sim has none.
import { execFileSync } from 'node:child_process';

const configs = process.argv.slice(2);
if (configs.length === 0) { console.error('usage: lodsweep.mjs <split>/<maxdepth> ...'); process.exit(2); }
const secs = process.env.OF_SWEEP_SECS ?? '120';

const rows = [];
for (const c of configs) {
  const [split, md] = c.split('/');
  const args = ['tools/smoke/run.mjs', '--scenario=walk', `--split=${split}`, `--maxdepth=${md}`,
    '--evalfile=tools/smoke/probes/lodfeet.js', `--evalargs={"secs":${secs}}`];
  process.stderr.write(`sweep ${c} ... `);
  const raw = execFileSync('node', args, { encoding: 'utf8', maxBuffer: 64 << 20, stdio: ['ignore', 'pipe', 'ignore'] });
  const r = JSON.parse(raw).eval;
  process.stderr.write(r.valid ? 'ok\n' : 'INVALID\n');
  rows.push({ split, md, r });
}

const f = (n, d = 2) => (typeof n === 'number' ? n.toFixed(d) : '-');
console.log('| split | md | feet depth | cell m | resident | near | far | pool MB | vram MB | build rt ms | frame p50 | frame p95 | calls | tris | ticks | metres | built |');
console.log('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
for (const { split, md, r } of rows) {
  if (!r.valid) { console.log(`| ${split} | ${md} | INVALID: ${JSON.stringify(r.drove)} |`); continue; }
  const c = r.cost;
  console.log(`| ${split} | ${md} | ${r.feet.depth} | ${f(r.feet.measuredCellM)} | ${c.resident} | `
    + `${c.near} | ${c.far} | ${f(c.bytesTotalMB)} | ${f(c.vramEstimateMB, 1)} | `
    + `${f(c.chunkBuildMs.roundTrip, 1)} | ${f(c.frameMs.p50)} | ${f(c.frameMs.p95)} | `
    + `${c.draw.calls} | ${c.draw.triangles} | ${r.drove.ticksAdvanced} | `
    + `${f(r.drove.metresWalked, 0)} | ${r.drove.chunksBuilt} |`);
}
