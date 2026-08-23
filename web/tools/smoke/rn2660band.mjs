// RN-2660. THE BAND LADDER: what the far treeline paint does, row by row,
// across the 3.4-to-15.5 km band World Audit R5's corrected rank 1 measured.
//
// WHY A NEW PROBE AND NOT `rn2510rows` OR A PNG SCAN. R5's rank-1 evidence is a
// centre-column ladder read off a PNG by hand, and its own correction pass had
// to REPAIR that table twice (labels wrong by up to 3x, two rows dropped). The
// repair is not a reason to distrust the method, it is a reason to make the
// method a script: this file places the rungs with `artframe.js`'s OWN
// committed `rangeRects` facility, reads `statOn`'s full block at each rung,
// and prints the arm-to-arm delta, so a row can neither be mislabelled nor
// silently omitted.
//
// TWO LADDERS, AND THE SECOND ONE IS THE POINT.
//   `--x=centre`  x in [795, 805), the audit's own provenance. This is the
//                 ladder that reproduces R5's `?treeline=0` deltas.
//   `--x=wide`    x in [240, 1360), `rangeRects`'s own default. A 5-row strip
//                 1120 px across is 5,600 samples, and its `iqr` is a LATERAL
//                 measure: it is the instrument for STRUCTURE. A centre-column
//                 iqr over 50 samples cannot see a 165 m mottle at all, so
//                 quoting rank 1's structure finding off the narrow ladder
//                 alone would be measuring the wrong quantity.
//
// THE RANGE LABELS ARE THE HONEST ONES AND THEY ARE NOT `rangeM`.
// `artframe.js`'s `rangeAtRow` is a FLAT-PLANE inversion (`eyeM / tan(depress)`)
// and R5's correction pass established the curvature-correct one
// (`s = R d - sqrt((R d)^2 - 2 R h)`, d the depression). At 1,200 m the two
// disagree by 17 per cent at the far end of this band (a rung labelled 13,248 m
// is really at 15,501 m). So this script ASKS for flat ranges chosen to land on
// NAMED ROWS, and prints the curvature-correct range beside each. Both numbers
// are printed; neither is hidden. The inversion here reproduces R5's own
// committed row 535 = 3,427 m and horizon = 37,947 m at `flyover`.
//
//   node tools/smoke/rn2660band.mjs --url=http://127.0.0.1:5660/ \
//     --shot=flyover --x=centre --cands=-|treeline=0
//   node tools/smoke/rn2660band.mjs --url=http://127.0.0.1:5660/ \
//     --shot=flyover --x=wide --cands=-|treeline=0|treelinemottle=0
//   node tools/smoke/rn2660band.mjs --url=http://127.0.0.1:5660/ \
//     --shot=flyovernoon --x=wide --rects=box,crowns,hzBand --cands=-|treeline=0
//
// EVERY FLAG NEEDS AN `=` (the sibling sweeps' parser, kept identical). `-` as
// a candidate is the SHIPPED arm. One fresh browser process per arm.

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RUN = path.join(HERE, 'run.mjs');
const PROBE = path.join(HERE, 'probes', 'artframe.js');

const argv = new Map(process.argv.slice(2)
  .map((a) => { const i = a.indexOf('='); return [a.slice(0, i), a.slice(i + 1)]; }));
const url = argv.get('--url') ?? 'http://127.0.0.1:5660/';
const shot = argv.get('--shot') ?? 'flyover';
const xMode = argv.get('--x') ?? 'centre';
const cands = (argv.get('--cands') ?? '-').split('|');
const named = (argv.get('--rects') ?? '').split(',').filter(Boolean);
const row0 = Number(argv.get('--row0') ?? 329);
const row1 = Number(argv.get('--row1') ?? 549);
const rowStep = Number(argv.get('--rowstep') ?? 10);

// The pose's own geometry. `flyover`, `forestair` and their sun variants are
// one pose (artframe.js:2001-2010 spreads the sun arms off the parent), so this
// is the parent's committed h and pitch, and it is ASSERTED against the live
// observer readback below rather than trusted.
const POSE = {
  flyover: { h: 1200, pitch: -14 }, forestair: { h: 1200, pitch: -14 },
  forestaircanopy: { h: 60, pitch: -2.5 },
};
const base = Object.keys(POSE).filter((k) => shot.startsWith(k))
  .sort((a, b) => b.length - a.length)[0];
if (!base) { console.error(`rn2660band: no pose geometry for ${shot}`); process.exit(2); }
const { h: EYE, pitch: PITCH } = POSE[base];
const R = 6e5;
const HALF = Math.tan(Math.PI / 6);
const depAt = (row) => -(PITCH * Math.PI / 180)
  - Math.atan((1 - 2 * (row / 900)) * HALF);
const flatAt = (row) => EYE / Math.tan(depAt(row));
const trueAt = (row) => {
  const a = R * depAt(row);
  const d = a * a - 2 * R * EYE;
  return d < 0 ? NaN : a - Math.sqrt(d);
};

const rows = [];
for (let r = row0; r <= row1; r += rowStep) rows.push(r);
const flats = rows.map((r) => Math.round(flatAt(r)));
const X0 = xMode === 'centre' ? 0.496875 : 0.15;
const X1 = xMode === 'centre' ? 0.503125 : 0.85;

const scen = (base === 'forestaircanopy' || base === 'flyover'
  || base === 'forestair') ? 'surface' : 'walk';

function once(flags) {
  const evalArgs = JSON.stringify({
    shot, rangeRects: flats, rangeRowsPx: 5, rangeX: X0, rangeX1: X1,
  });
  const args = [RUN, `--url=${url}`, `--scenario=${scen}`,
    '--width=1600', '--height=900', `--evalfile=${PROBE}`,
    `--evalargs=${evalArgs}`, ...flags];
  const r = spawnSync(process.execPath, args, { encoding: 'utf8', maxBuffer: 1 << 28 });
  try { return JSON.parse(r.stdout).eval; } catch {
    return { valid: false, why: `no json (exit ${r.status})`,
      stderr: (r.stderr ?? '').slice(-500) };
  }
}

const out = [];
for (const c of cands) {
  const flags = c === '-' ? [] : c.split(',').filter(Boolean).map((s) => `--${s}`);
  const e = once(flags);
  if (!e.valid) {
    console.error(`rn2660band: arm "${c}" INVALID: ${e.why}\n${e.stderr ?? ''}`);
    process.exit(1);
  }
  out.push({ c, e });
}

// THE POSE IS ASSERTED, NOT ASSUMED. If the observer the capture actually had
// is not the one the range labels were computed from, every label is wrong and
// the run must fail rather than print.
const obs = out[0].e.observer ?? {};
if (Math.abs((obs.altM ?? EYE) - EYE) > 1
  || Math.abs((obs.pitchDeg ?? PITCH) - PITCH) > 0.05) {
  console.error(`rn2660band: FAIL the live observer (alt ${obs.altM}, pitch`
    + ` ${obs.pitchDeg}) is not the geometry these range labels were computed`
    + ` from (${EYE} m, ${PITCH} deg), so every row label would be wrong.`);
  process.exit(1);
}

const f2 = (x) => (Number.isFinite(x) ? x.toFixed(2).padStart(8) : '     n/a');
const rectOf = (e, k) => (k === 'box' ? e.box : (e.extra ?? {})[k]);

console.log(`\n--- RN-2660 BAND LADDER  shot=${shot}  x=${xMode}`
  + ` [${(X0 * 1600).toFixed(0)},${(X1 * 1600).toFixed(0)})  eye=${EYE} m`
  + ` pitch=${PITCH}  horizon=${Math.sqrt(2 * R * EYE).toFixed(0)} m ---`);
console.log(`arms: ${out.map((o) => o.c).join('  |  ')}`);
console.log('\nrow   trueM   flatM |' + out.map((o) => ` ${'luma'.padStart(8)}`
  + ` ${'iqr'.padStart(8)}`).join(' |'));
for (let i = 0; i < rows.length; i += 1) {
  const key = `r${flats[i]}`;
  const cells = out.map((o) => {
    const s = rectOf(o.e, key);
    return s ? `${f2(s.luma)} ${f2(s.iqr)}` : '     n/a      n/a';
  });
  console.log(`${String(rows[i]).padStart(3)} ${trueAt(rows[i]).toFixed(0).padStart(7)}`
    + ` ${flats[i].toString().padStart(7)} |${cells.join(' |')}`);
}
if (out.length > 1) {
  console.log('\nDELTAS against arm 1 (luma, then iqr):');
  console.log('row   trueM |' + out.slice(1).map((o) => ` ${o.c.slice(0, 17).padStart(17)}`).join(' |'));
  for (let i = 0; i < rows.length; i += 1) {
    const key = `r${flats[i]}`;
    const a = rectOf(out[0].e, key);
    const cells = out.slice(1).map((o) => {
      const b = rectOf(o.e, key);
      return (a && b) ? `${(b.luma - a.luma).toFixed(2).padStart(8)}`
        + ` ${(b.iqr - a.iqr).toFixed(2).padStart(8)}` : '              n/a';
    });
    console.log(`${String(rows[i]).padStart(3)} ${trueAt(rows[i]).toFixed(0).padStart(7)}`
      + ` |${cells.join(' |')}`);
  }
}
for (const k of named) {
  console.log(`\nrect ${k}:  ` + out.map((o) => {
    const s = rectOf(o.e, k);
    return s ? `${o.c}: luma ${s.luma.toFixed(2)} iqr ${s.iqr.toFixed(2)}`
      + ` linY ${s.lin.Y.toFixed(6)}` : `${o.c}: n/a`;
  }).join('   |   '));
}
const t = out[0].e.treeline ?? {};
console.log(`\ntreeline readback: ${JSON.stringify(t).slice(0, 400)}`);
process.exit(0);
