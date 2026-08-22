// RN-2540. THE PER-CHANNEL ARM SWEEPER (rendering, LANE N7, THE ADDITIVE BLUE
// FLOOR OVER THE CANOPY).
//
// `rn2495arms.mjs` publishes GREEN EXCESS and that is the right instrument for
// "is the crown green". It cannot see THIS lane's subject. N6's verifier proved
// the aerial crown's blue-violet is an ADDITIVE term: with the canopy
// self-shadow fully OFF the crown's BLUE moves +2.27 counts while GREEN moves
// +15.73, i.e. the shaded crown's blue gets 0.3 per cent of its value from the
// albedo every crown-colour lane so far has multiplied, yet blue is the crown
// pixel's LARGEST channel at ~80.7 counts. A term that ADDS light cannot be
// attributed with a metric that has already collapsed the three channels into
// one difference, so this tool prints the RAW TRIPLE the probe already
// computes, beside `gx`, `warm` and `luma` so a row here and a row from
// `rn2495arms.mjs` are on one scale and one capture.
//
//     r  g  b        counts, the probe's own Rec.709 8-bit means
//     gx = g - (r + b) / 2
//
// It is otherwise `rn2495arms.mjs`'s runner, deliberately: same `run.mjs`, same
// committed `artframe.js` rectangles, same fresh process per call site
// (WG-189's rule), same `+`-joined multi-param arms, so an attribution ladder
// taken with this tool is comparable term-for-term with N3's.
//
//   node tools/smoke/rn2540arms.mjs --url=http://127.0.0.1:5540/ \
//     --shots=forestair --rects=crowns,box \
//     --arms=,aerosol=0,ambientfill=0,terrainfloor=0
//
// `--arms` is a comma-separated list of page params; an EMPTY entry is the
// shipped arm. `--json=<path>` also writes every row as JSON, so a ladder can
// be differenced without re-reading a table by eye.

import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RUN = path.join(HERE, 'run.mjs');
const PROBE = path.join(HERE, 'probes', 'artframe.js');

const argv = new Map(process.argv.slice(2)
  .map((a) => { const i = a.indexOf('='); return [a.slice(0, i), a.slice(i + 1)]; }));
const url = argv.get('--url') ?? 'http://127.0.0.1:5540/';
const shots = (argv.get('--shots') ?? 'forestair').split(',');
const arms = (argv.get('--arms') ?? ',canopy=0').split(',');
const repeats = Number(argv.get('--repeats') ?? 1);
const rects = (argv.get('--rects') ?? 'crowns,box').split(',');
const pngPrefix = argv.get('--png');
const jsonOut = argv.get('--json');

const shotBy = (s) => (s.startsWith('forestair') || s.startsWith('flyover')
  || s === 'limb' || s === 'vista' || s === 'vistadawn' || s === 'vistanoon'
  || s === 'dawnsun' ? 'surface' : 'walk');

function once(shot, arm, outPng) {
  const args = [RUN, `--url=${url}`, `--scenario=${shotBy(shot)}`,
    '--width=1600', '--height=900', `--evalfile=${PROBE}`,
    `--evalargs=${JSON.stringify({ shot })}`];
  if (outPng) args.push(`--out=${outPng}`);
  if (shotBy(shot) === 'walk') args.push('--sandbox=1');
  for (const f of arm.split('+').filter(Boolean)) args.push(`--${f}`);
  const r = spawnSync(process.execPath, args, { encoding: 'utf8', maxBuffer: 1 << 28 });
  try {
    const j = JSON.parse(r.stdout);
    return Object.assign(j.eval, { p50: j.stats?.frameMs?.p50, tri: j.stats?.triangles });
  } catch {
    return { valid: false, why: `no json (exit ${r.status})`,
      stderr: (r.stderr ?? '').slice(-400) };
  }
}

const gx = (s) => (s && s.rgb ? s.rgb[1] - (s.rgb[0] + s.rgb[2]) / 2 : NaN);

const rows = [];
for (const shot of shots) {
  for (const arm of arms) {
    for (let i = 0; i < repeats; ++i) {
      const tag = arm === '' ? 'SHIPPED' : arm;
      const outPng = pngPrefix
        ? `${pngPrefix}_${shot}_${(arm || 'shipped').replace(/[^a-z0-9]/gi, '')}.png` : null;
      const e = once(shot, arm, outPng);
      const cells = [shot.padEnd(13), tag.padEnd(26), `valid=${String(e.valid).padEnd(5)}`];
      for (const rn of rects) {
        const s = rn === 'box' ? e.box : (e.extra ?? {})[rn];
        if (!s) { cells.push(`${rn}=--`); continue; }
        cells.push(`${rn}[r=${s.rgb[0].toFixed(2)} g=${s.rgb[1].toFixed(2)}`
          + ` b=${s.rgb[2].toFixed(2)} L=${s.luma.toFixed(2)} gx=${gx(s).toFixed(2)}]`);
        rows.push({ shot, arm: tag, rect: rn, r: s.rgb[0], g: s.rgb[1], b: s.rgb[2],
          luma: s.luma, gx: +gx(s).toFixed(2), warm: s.warm, sat: s.sat, iqr: s.iqr });
      }
      const w = e.world ?? {};
      cells.push(`world[L=${w.luma !== undefined ? w.luma.toFixed(2) : '--'}`
        + ` warm=${w.warm !== undefined ? w.warm.toFixed(2) : '--'}]`);
      if (e.valid === false) cells.push(`WHY=${e.why} ${e.stderr ?? ''}`);
      console.log(cells.join(' '));
    }
  }
}
if (jsonOut) writeFileSync(jsonOut, JSON.stringify(rows, null, 1));
