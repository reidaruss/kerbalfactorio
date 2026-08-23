// RN-2675 to RN-2680 lane (`lane/n17-poolroom`). TWO PROOFS FOR THE CANOPY
// POOL HEADROOM RAISE AND ITS PAGE PARAM.
//
// 1. `--mode=chunkmax`: THE NON-VACUITY OUTCOME-READBACK for `?canopychunkmax=`
//    (RN-2677). RN-2590's trap is that a request readback (the flag reaching
//    `Config`) is not an outcome readback (the value reaching the draw). This
//    sweeps `canopychunkmax` at `forestair` and reads `scatter.canopyProps`/
//    `capScaleMin`/`chunksCapped` OFF THE PHOTOGRAPHED FRAME (`of.stats()`
//    after settle, via `artframe.js`), the same evidence class WG-304's own
//    `?canopychunkkm2=` ladder uses. `0` is a dramatic structural control
//    (every canopy-only chunk's ceiling collapses to zero); values at and
//    above 40,000 are the asymptote this lane priced `CANOPY_MAX_CAPACITY`'s
//    raise against.
//
//      node tools/smoke/rn2675sweep.mjs --mode=chunkmax --url=http://127.0.0.1:PORT/
//
// 2. `--mode=baseline`: THE BIT-IDENTICAL PROOF at SHIPPED DEFAULTS (RN-2679),
//    two owned servers (one on `origin/main` @ d45c712a, one on this branch),
//    WG-304's own 5-pose blast-radius set, 3 fresh processes each, arm order
//    rotated (WG-189 interleaved method). Every field should match to the
//    digit except `poolCeiling` (the sum of every batch's own `maxCap`, which
//    this lane's raise deliberately moves).
//
//      node tools/smoke/rn2675sweep.mjs --mode=baseline \
//        before=http://127.0.0.1:PORT1/ after=http://127.0.0.1:PORT2/
import { spawnSync } from 'node:child_process';

const argv = process.argv.slice(2);
const mode = (argv.find((a) => a.startsWith('--mode=')) ?? '--mode=chunkmax').slice(7);
const urlArg = (argv.find((a) => a.startsWith('--url=')) ?? '--url=http://127.0.0.1:5550/').slice(6);

function run(url, shot, scenario, extra) {
  const args = [
    'tools/smoke/run.mjs', `--url=${url}`, `--scenario=${scenario}`,
    '--width=1600', '--height=900',
    '--evalfile=tools/smoke/probes/artframe.js',
    `--evalargs=${JSON.stringify({ shot })}`, ...extra,
  ];
  if (scenario === 'walk') args.push('--sandbox=1');
  const r = spawnSync(process.execPath, args, { encoding: 'utf8', maxBuffer: 1 << 28 });
  let j;
  try { j = JSON.parse(r.stdout).eval; } catch {
    return { err: `no json (exit ${r.status}): ${(r.stderr ?? '').slice(-300)}` };
  }
  const s = j.scatter ?? {};
  return {
    valid: j.valid, canopyProps: s.canopyProps ?? null,
    propsPlaced: s.propsPlaced ?? null, capScaleMin: s.capScaleMin ?? null,
    chunksCapped: s.chunksCapped ?? null, capCellFrac: s.capCellFrac ?? null,
    poolRefused: s.poolRefused, poolCeiling: s.poolCeiling,
    tris: j.render.triangles, calls: j.render.calls, vramMB: j.render.vramMB,
  };
}

if (mode === 'chunkmax') {
  const values = [0, 100, 5000, 32768, 40000, 50000, 60000, 65000, 70000, 100000, 200000];
  for (const v of values) {
    const r = run(urlArg, 'forestair', 'surface', [`--canopychunkmax=${v}`]);
    console.log(`canopychunkmax=${v}`.padEnd(24), JSON.stringify(r));
  }
} else if (mode === 'baseline') {
  const arms = argv.filter((a) => !a.startsWith('--')).map((a) => {
    const i = a.indexOf('='); return { name: a.slice(0, i), url: a.slice(i + 1) };
  });
  if (arms.length < 2) { console.error('rn2675sweep: name before=url and after=url'); process.exit(2); }
  const shots = [
    { shot: 'forestair', scenario: 'surface' },
    { shot: 'flyover', scenario: 'surface' },
    { shot: 'forestaircanopy', scenario: 'surface' },
    { shot: 'meadowfield', scenario: 'walk' },
    { shot: 'beachground', scenario: 'walk' },
  ];
  for (const { shot, scenario } of shots) {
    console.log(`\n=== ${shot} ===`);
    for (let r = 0; r < 3; ++r) {
      const order = r % 2 === 0 ? arms : [...arms].reverse();
      const results = {};
      for (const a of order) results[a.name] = run(a.url, shot, scenario, []);
      const strs = Object.fromEntries(arms.map((a) => [a.name, JSON.stringify(results[a.name])]));
      for (const a of arms) console.log(`  r${r} ${a.name.padEnd(7)}=${strs[a.name]}`);
      console.log(`  r${r} IDENTICAL=${strs[arms[0].name] === strs[arms[1].name]}`);
    }
  }
} else {
  console.error(`rn2675sweep: unknown --mode=${mode}, want chunkmax or baseline`);
  process.exit(2);
}
