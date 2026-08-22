// RN-2275. THE INTER-CROWN SELF-SHADOW SWEEPER.
//
// THIS SCRIPT IS NOT THE GUARD AND NEVER WAS. It PRINTS a signed difference and
// exits 0 whatever it reads -- read "the pass condition, printed rather than
// eyeballed" at the bottom of this file literally. RN-2550 replaced the sign
// test with a two-sided band on PER-PIXEL-LINEARIZED patch means and put it in
// `tools/smoke/rn2550guard.mjs`, which asserts and exits nonzero.
// **Use `rn2550guard.mjs` to decide anything; use this file to look around.**
// The sign test's own defect, for the record: a boolean on 8-bit code values
// with no budget, satisfied at the shipped frame by a ratio of 0.984 while the
// physical band is far below it (rendering.md 2.19.4's correction note, 2.35).
//
// WHY A SIBLING SCRIPT AND NOT `a5sweep.mjs`, which already does one-server
// multi-arm work: that script (and `wg220sweep.mjs`) routes a shot to a
// scenario with `shot === 'flyover' ? 'surface' : 'walk'`, so it sends every
// `forestair*` pose to the WALK scenario and the frame comes back
// `valid:false` with a mode error. `rn2260sweep.mjs` hit the same wall and
// hardcoded `forestair`; this one takes the scenario per shot instead, because
// this lane measures four aerial poses and two ground ones.
//
// THE THREE ARMS ARE THE MEASUREMENT, and the middle one is the point.
//   canopy=0      no vegetation of any kind: the CLEARING, i.e. what the
//                 ground under a wood reads as when the wood is not there.
//   crownshade=0  the pre-RN-2275 frame: canopy painted at the card's mean
//                 albedo with no layer transmittance.
//   (shipped)     the same canopy with the self-shadow term.
//
// The pass condition is then a SIGN and not a level: `crownshade=0` above
// `canopy=0` is the wood reading LIGHTER than its own clearing, which is the
// inversion two verifiers named; shipped below `canopy=0` is the photo-correct
// sign. Both are read off the SAME rectangle in the SAME pose, so the range,
// the haze, the sun, the terrain and the lighting are common-mode by
// construction and nothing has to be placed by eye.
//
//   node tools/smoke/rn2275sweep.mjs --repeats=1 --url=http://127.0.0.1:5771/ \
//     --shots=forestairnoon,forestairlow,flyovernoon,flyoverlow
//
// Arms are rotated per repeat (WG-189) and each run is a fresh process.

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RUN = path.join(HERE, 'run.mjs');
const PROBE = path.join(HERE, 'probes', 'artframe.js');

const argv = new Map(process.argv.slice(2)
  .map((a) => { const i = a.indexOf('='); return [a.slice(0, i), a.slice(i + 1)]; }));
const url = argv.get('--url') ?? 'http://127.0.0.1:5771/';
const repeats = Number(argv.get('--repeats') ?? 1);
const shots = (argv.get('--shots') ?? 'forestairnoon').split(',');
const arms = (argv.get('--arms') ?? 'canopy=0,crownshade=0,base').split(',');
const shotBy = (s) => (s.startsWith('forestair') || s.startsWith('flyover')
  || s === 'limb' ? 'surface' : 'walk');

function once(shot, arm, extraArgs, outPng) {
  const args = [RUN, `--url=${url}`, `--scenario=${shotBy(shot)}`,
    '--width=1600', '--height=900', `--evalfile=${PROBE}`,
    `--evalargs=${JSON.stringify({ shot, ...extraArgs })}`];
  if (outPng) args.push(`--out=${outPng}`);
  if (shotBy(shot) === 'walk') args.push('--sandbox=1');
  if (arm !== 'base') args.push(`--${arm}`);
  const r = spawnSync(process.execPath, args, {
    encoding: 'utf8', maxBuffer: 1 << 28,
  });
  try { return JSON.parse(r.stdout).eval; } catch {
    return { valid: false, why: `no json (exit ${r.status})`,
      stderr: (r.stderr ?? '').slice(-400) };
  }
}

const rows = [];
for (const shot of shots) {
  for (let i = 0; i < repeats; ++i) {
    // Rotate so thermal and background drift cannot land on one arm.
    const order = arms.map((_, j) => arms[(j + i) % arms.length]);
    for (const arm of order) {
      // `--sundot=` / `--anysun=1` exist for ONE job and it is not taking a
      // published number: finding the maximum elevation a SITE can reach, so
      // a manifest row can be written against the site's own local noon
      // instead of a round number the arc never touches (`lookdev.js`'s rule).
      // A frame taken through them is a discovery, never a result.
      const ov = {};
      if (argv.has('--sundot')) ov.sunDot = Number(argv.get('--sundot'));
      if (argv.get('--anysun') === '1') ov.anySun = true;
      // `--png=docs/screenshots/RN2275` writes `<prefix>_<shot>_<arm>.png`
      // beside the numbers, from the SAME settled frame they come from, so a
      // judgement and its measurement can never be of different frames.
      const pre = argv.get('--png');
      const e = once(shot, arm, ov, pre
        ? `${pre}_${shot}_${arm.replace(/[^a-z0-9]/gi, '')}.png` : null);
      rows.push({ shot, arm, rep: i, e });
      const r = e.extra ?? {};
      const t = e.treeline ?? null;
      console.log([
        shot.padEnd(14), arm.padEnd(13),
        `valid=${String(e.valid).padEnd(5)}`,
        `box=${e.box ? e.box.luma.toFixed(2) : '--'}`,
        `iqr=${e.box ? e.box.iqr.toFixed(2) : '--'}`,
        `p05=${e.box ? e.box.p05.toFixed(2) : '--'}`,
        `p95=${e.box ? e.box.p95.toFixed(2) : '--'}`,
        `world=${r.world ? r.world.luma.toFixed(2) : '--'}`,
        `hz=${r.hzBand ? r.hzBand.luma.toFixed(2) : '--'}`,
        `sky=${r.skyBand ? r.skyBand.luma.toFixed(2) : '--'}`,
        `prof=${['treeOutB', 'treeOutA', 'treeInA', 'treeInB']
          .map((k) => (r[k] ? r[k].luma.toFixed(2) : '--')).join('/')}`,
        `sun=${e.sun ? e.sun.elevDot : '--'}`,
        `S=${t && t.self ? t.self.cardShade.toFixed(4) : '--'}`,
        `live=${t && t.self ? t.self.live : '--'}`,
        `props=${e.scatter ? e.scatter.propsPlaced : '--'}`,
        `cells=${e.scatter ? e.scatter.cellsScattered : '--'}`,
        `refused=${e.scatter ? e.scatter.poolRefused : '--'}`,
        `p50=${e.render ? e.render.frameMs.p50 : '--'}`,
        `vram=${e.render ? e.render.vramMB : '--'}`,
        `prog=${e.render ? e.render.programs : '--'}`,
        `tri=${e.render ? e.render.triangles : '--'}`,
        `calls=${e.render ? e.render.calls : '--'}`,
        e.valid === false ? `WHY=${e.why}` : '',
      ].join(' '));
    }
  }
}

// The pass condition, printed rather than eyeballed: the wood-vs-clearing
// relation per shot, before and after, as a signed difference in 8-bit luma.
const med = (xs) => xs.slice().sort((a, b) => a - b)[xs.length >> 1];
const pick = (shot, arm, f) => {
  const v = rows.filter((r) => r.shot === shot && r.arm === arm && r.e.valid)
    .map((r) => f(r.e)).filter((x) => typeof x === 'number');
  return v.length === 0 ? null : med(v);
};
console.log('\n--- WOOD vs CLEARING (box luma; positive = wood LIGHTER, the inversion) ---');
for (const shot of shots) {
  const bare = pick(shot, 'canopy=0', (e) => e.box.luma);
  const before = pick(shot, 'crownshade=0', (e) => e.box.luma);
  const after = pick(shot, 'base', (e) => e.box.luma);
  if (bare === null) { console.log(`${shot}: no bare arm`); continue; }
  const f = (x) => (x === null ? '--' : (x - bare).toFixed(2).padStart(7));
  console.log(`${shot.padEnd(14)} clearing=${bare.toFixed(2).padStart(6)}`
    + `   before=${f(before)}   after=${f(after)}`);
}
