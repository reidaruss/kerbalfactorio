// WG-226 lane sweeper: WG-189's interleaved method across TWO SERVERS.
//
// `a5sweep.mjs` interleaves ARMS OF ONE BUILD, distinguished by a run.mjs flag.
// This lane's before-arm is a different BUILD (the canopy table, the grove
// mask, the reach constants and the far-grow term are source constants, not
// page params), and shipping a `?canopylegacy=1` switch that carries a whole
// retired table forward just to be measurable would be a knob nobody would
// ever move plus a second density path to keep true.
//
// So the two arms are two `vite preview` servers on two ports, each serving its
// own `dist`, each with its own sentinel fetched back over its own port before
// the sweep starts. The interleave is the point WG-189 actually makes: a serial
// non-interleaved sweep lets thermal and background drift land entirely on one
// arm, and that sweep read the SIGN of its delta wrong twice. Alternating the
// arm order every repeat is what a delta has to survive.
//
//   node tools/smoke/wg220sweep.mjs --shot=flyover --repeats=3 \
//     before=http://127.0.0.1:5313/ after=http://127.0.0.1:5312/
import { spawnSync } from 'node:child_process';

const argv = process.argv.slice(2);
const shot = (argv.find((a) => a.startsWith('--shot=')) ?? '--shot=flyover').slice(7);
const repeats = Number((argv.find((a) => a.startsWith('--repeats=')) ?? '--repeats=3').slice(10));
const arms = argv.filter((a) => !a.startsWith('--')).map((a) => {
  const i = a.indexOf('=');
  return { name: a.slice(0, i), url: a.slice(i + 1) };
});
if (arms.length < 2) { console.error('wg220sweep: name at least two name=url arms'); process.exit(2); }

const scenario = shot === 'flyover' ? 'surface' : 'walk';
const sandbox = shot === 'forestfloor' ? ['--sandbox=1'] : [];
const KEYS = ['box', 'nearG', 'mid', 'hzBand', 'under', 'skyBand', 'shadowStep',
  'tris', 'calls', 'p50', 'cInst', 'cM2', 'placed'];

function run(url) {
  const r = spawnSync(process.execPath, [
    'tools/smoke/run.mjs', `--url=${url}`, `--scenario=${scenario}`,
    '--width=1600', '--height=900', ...sandbox,
    '--evalfile=tools/smoke/probes/artframe.js',
    `--evalargs=${JSON.stringify({ shot })}`,
  ], { encoding: 'utf8', maxBuffer: 1 << 28 });
  if (r.status !== 0) { console.error(r.stderr?.slice(-1200)); throw new Error(`arm ${url} failed`); }
  const j = JSON.parse(r.stdout).eval;
  const e = j.extra ?? {};
  const sc = j.scatter ?? {};
  const out = { box: j.box.luma, tris: j.render.triangles, calls: j.render.calls,
    p50: j.render.frameMs.p50, cInst: sc.canopyProps ?? 0, cM2: sc.canopyM2 ?? 0,
    placed: sc.propsPlaced ?? 0, cellsCapped: sc.cellsCapped ?? 0,
    chunksCapped: sc.chunksCapped ?? 0, backlog: sc.scatterBacklog ?? 0,
    shadeMean: sc.canopyShadeMean ?? null, shadeSd: sc.canopyShadeSd ?? null,
    shadeMax: sc.canopyShadeMax ?? null, shadeCells: sc.canopyShadeCells ?? null,
    planetMean: sc.canopyPlanetMean ?? null, planetSd: sc.canopyPlanetSd ?? null };
  for (const k of Object.keys(e)) out[k] = e[k].luma;
  return out;
}

const rows = new Map(arms.map((a) => [a.name, []]));
for (let r = 0; r < repeats; ++r) {
  // Rotate the order every repeat so no arm always runs on a cold or a hot box.
  const order = arms.map((_, i) => arms[(i + r) % arms.length]);
  for (const a of order) {
    const v = run(a.url);
    rows.get(a.name).push(v);
    const shown = KEYS.filter((k) => v[k] !== undefined)
      .map((k) => `${k} ${typeof v[k] === 'number' ? v[k].toFixed(2) : v[k]}`);
    console.log(`r${r} ${a.name.padEnd(7)} ${shown.join('  ')}`
      + `  cap ${v.cellsCapped}/${v.chunksCapped}  backlog ${v.backlog}`
      + (v.shadeCells
        ? `  shadeW ${v.shadeMean}+-${v.shadeSd} max ${v.shadeMax}`
          + `  planetW ${v.planetMean}+-${v.planetSd}  n ${v.shadeCells}` : ''));
  }
}
const med = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
console.log('');
for (const a of arms) {
  const rs = rows.get(a.name);
  const ps = rs.map((v) => v.p50);
  console.log(`${a.name.padEnd(7)} p50 median ${med(ps).toFixed(2)}  runs ${ps.map((x) => x.toFixed(1)).join('/')}`
    + `  spread ${(Math.max(...ps) - Math.min(...ps)).toFixed(2)}`
    + `  tris ${med(rs.map((v) => v.tris))}  cInst ${med(rs.map((v) => v.cInst))}`
    + `  cM2 ${med(rs.map((v) => v.cM2))}  placed ${med(rs.map((v) => v.placed))}`);
}
