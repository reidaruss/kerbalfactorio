// RN-2260 lane sweeper: WG-189's interleaved method across TWO SERVERS, the
// same shape as `wg220sweep.mjs` (WG-226) but for the pool-ceiling fix, which
// is a source constant (`PropLibrary.CANOPY_MAX_CAPACITY`) and not a page
// param, so the two arms are two builds on two owned ports rather than one
// build with a flag. `wg220sweep.mjs` itself is not reused because its
// `shot === 'flyover' ? 'surface' : 'walk'` ternary would route `forestair`
// to the walk scenario; WG-227 built `forestair` as `flyover`'s pose over
// different ground and it needs the same `surface` scenario.
//
//   node tools/smoke/rn2260sweep.mjs --repeats=3 \
//     before=http://127.0.0.1:5561/ after=http://127.0.0.1:5562/
import { spawnSync } from 'node:child_process';

const argv = process.argv.slice(2);
const repeats = Number((argv.find((a) => a.startsWith('--repeats=')) ?? '--repeats=3').slice(10));
const arms = argv.filter((a) => !a.startsWith('--')).map((a) => {
  const i = a.indexOf('=');
  return { name: a.slice(0, i), url: a.slice(i + 1) };
});
if (arms.length < 2) { console.error('rn2260sweep: name at least two name=url arms'); process.exit(2); }

function run(url) {
  const r = spawnSync(process.execPath, [
    'tools/smoke/run.mjs', `--url=${url}`, '--scenario=surface',
    '--width=1600', '--height=900',
    '--evalfile=tools/smoke/probes/artframe.js',
    `--evalargs=${JSON.stringify({ shot: 'forestair' })}`,
  ], { encoding: 'utf8', maxBuffer: 1 << 28 });
  // The BEFORE arm's whole point is that `PropLibrary.grow()` fires a
  // `console.error` when the canopy pool is full, and `run.mjs` correctly
  // fails any run that logs one (`smoke: FAILURES`, non-zero exit) -- so a
  // non-zero exit here is the EXPECTED shape of the defect, not a broken
  // sweep. The JSON is still printed to stdout before the exit code is
  // decided (`run.mjs`'s own ordering), so it is parsed either way and the
  // exit status is only noted, never fatal.
  if (r.status !== 0) {
    console.log(`  (arm ${url} exited ${r.status}: ${
      r.stderr?.match(/console\.error:.*/)?.[0] ?? 'see stderr'})`);
  }
  const j = JSON.parse(r.stdout).eval;
  const sc = j.scatter ?? {};
  return {
    valid: j.valid, tris: j.render.triangles, calls: j.render.calls,
    p50: j.render.frameMs.p50, vramMB: j.render.vramMB,
    canopyProps: sc.canopyProps ?? 0, poolRefused: sc.poolRefused ?? 0,
    poolCeiling: sc.poolCeiling ?? 0,
  };
}

const rows = new Map(arms.map((a) => [a.name, []]));
for (let r = 0; r < repeats; ++r) {
  const order = arms.map((_, i) => arms[(i + r) % arms.length]);
  for (const a of order) {
    const v = run(a.url);
    rows.get(a.name).push(v);
    console.log(`r${r} ${a.name.padEnd(7)} valid=${v.valid} p50=${v.p50.toFixed(2)} `
      + `tris=${v.tris} calls=${v.calls} vramMB=${v.vramMB} `
      + `canopyProps=${v.canopyProps} poolRefused=${v.poolRefused} poolCeiling=${v.poolCeiling}`);
  }
}
const med = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
console.log('');
for (const a of arms) {
  const rs = rows.get(a.name);
  const ps = rs.map((v) => v.p50);
  console.log(`${a.name.padEnd(7)} p50 median ${med(ps).toFixed(2)}  runs ${ps.map((x) => x.toFixed(1)).join('/')}`
    + `  spread ${(Math.max(...ps) - Math.min(...ps)).toFixed(2)}`
    + `  tris ${med(rs.map((v) => v.tris))}  poolRefused ${med(rs.map((v) => v.poolRefused))}`);
}
