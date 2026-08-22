// RN-2570. WHY ONE CANOPY MODEL READS A FACTOR OF SEVEN ACROSS FOUR POSES.
//
// THE DEFECT THIS EXISTS FOR, from rendering.md 2.35.1 and 2.35.5. The
// coverage-corrected crown reflectance `rho` reads 0.0992 / 0.4363 / 0.2488 /
// 0.7021 at `forestairnoon` / `forestairlow` / `flyovernoon` / `flyoverlow`.
// It is ORDERED -- both Forest poses below both Hills poses, and at each site
// the LOW sun reads LIGHTER than local noon -- and the sun ordering is
// BACKWARDS for a path-length argument, because `crownSelfShade`'s own law
// makes `S` SMALLEST at low sun. Something else is carrying the sun term and
// `rho` alone cannot say what.
//
// A RATIO CANNOT BE DIAGNOSED, ONLY ITS TERMS CAN. `rho` is
//
//     rho = Y_card / Y_clearing
//
// with `Y_card` the crown's own mean linear luminance (the `?terrainpaint=1`
// arm's rect mean divided by the measured coverage `f`) and `Y_clearing` the
// `?canopy=0` arm's. Either can move and the ratio cannot tell which did. So
// this script prints BOTH ABSOLUTE LEVELS as well as the ratio, and then
// splits the numerator with the two switches that already exist:
//
//     Y_card  =  D  +  P                 diffuse plus specular
//     D       =  D0 * Smeas              the self-shadow multiplier, MEASURED
//
//   cards               `?terrainpaint=1`                    Y_card
//   cardsNoSpec         `+ ?propspec=0`                      D
//   cardsNoShade        `+ ?crownshade=0`                    D0 + P0
//   cardsNoShadeNoSpec  `+ ?crownshade=0&propspec=0`         D0
//
// `Smeas = D / D0` is then the shade term as the FRAME sees it, and it is
// directly comparable against `cardShade` -- the scalar `crownSelfShade`
// computed on the page, read back out of `treeline.self` in the same capture,
// never recomputed here (RN-2268: a flag that never reaches a uniform reports
// the default, and a probe that recomputes the law cannot see that).
//
// EVERY ARM CARRIES `?prophaze=0&terrainhaze=0`, which is the arm the band is
// on (2.35.5): the additive aerial in-scatter is common-mode to both surfaces
// and would otherwise dominate every level printed here (N7 measured it at
// 82.8 per cent of the `crowns` rectangle).
//
// FIVE ARMS PER POSE, A FRESH PROCESS EACH, twenty browser runs for the full
// set. Registers NO new page parameter: every flag used here was registered by
// RN-2275 or N7 (RN-2540).
//
//   node tools/smoke/rn2570spread.mjs --url=http://127.0.0.1:5570/
//   node tools/smoke/rn2570spread.mjs --url=http://127.0.0.1:5570/ --shots=forestairnoon
//   node tools/smoke/rn2570spread.mjs --url=http://127.0.0.1:5570/ --extra=canopyrough=0.9
//
// EVERY FLAG NEEDS AN `=`: the argv parser splits on the first `=`, so a bare
// `--print` parses to the key `--prin`. Inherited from the sibling sweeps and
// kept identical to them on purpose.

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RUN = path.join(HERE, 'run.mjs');
const PROBE = path.join(HERE, 'probes', 'artframe.js');

const OFF = ['--prophaze=0', '--terrainhaze=0'];
const ARMS = {
  clearSurf: ['--canopy=0', ...OFF],
  cards: ['--terrainpaint=1', ...OFF],
  cardsNoSpec: ['--terrainpaint=1', '--propspec=0', ...OFF],
  cardsNoShade: ['--terrainpaint=1', '--crownshade=0', ...OFF],
  cardsNoShadeNoSpec: ['--terrainpaint=1', '--crownshade=0', '--propspec=0', ...OFF],
};

const argv = new Map(process.argv.slice(2)
  .map((a) => { const i = a.indexOf('='); return [a.slice(0, i), a.slice(i + 1)]; }));
const url = argv.get('--url') ?? 'http://127.0.0.1:5570/';
const shots = (argv.get('--shots')
  ?? 'forestairnoon,forestairlow,flyovernoon,flyoverlow').split(',');
const extra = (argv.get('--extra') ?? '').split(',').filter(Boolean)
  .map((s) => `--${s}`);
const shotBy = (s) => (s.startsWith('forestair') || s.startsWith('flyover')
  || s === 'limb' ? 'surface' : 'walk');

function once(shot, flags) {
  const args = [RUN, `--url=${url}`, `--scenario=${shotBy(shot)}`,
    '--width=1600', '--height=900', `--evalfile=${PROBE}`,
    `--evalargs=${JSON.stringify({ shot })}`, ...flags, ...extra];
  if (shotBy(shot) === 'walk') args.push('--sandbox=1');
  const r = spawnSync(process.execPath, args, { encoding: 'utf8', maxBuffer: 1 << 28 });
  try { return JSON.parse(r.stdout).eval; } catch {
    return { valid: false, why: `no json (exit ${r.status})`,
      stderr: (r.stderr ?? '').slice(-400) };
  }
}

const rows = [];
for (const shot of shots) {
  const e = {};
  for (const [name, flags] of Object.entries(ARMS)) e[name] = once(shot, flags);
  const bad = Object.entries(e).filter(([, v]) => !v.valid || !(v.extra ?? {}).crowns);
  if (bad.length > 0) {
    console.error(`${shot}: arm(s) ${bad.map(([k, v]) => `${k} (${v.why ?? 'no rect'})`)
      .join(', ')} produced no crowns rectangle`);
    continue;
  }
  const C = (k) => e[k].extra.crowns.lin.Y;
  // COVERAGE, from the one clean arm, exactly as rn2550guard takes it: the
  // terrain is painted exactly black and the cards are alpha-tested, so the
  // non-black pixel count IS the coverage. Same definition, same rectangle.
  const f = 1 - e.cards.extra.crowns.blackFrac;
  const self = (e.cards.treeline ?? {}).self ?? null;
  // PER-CROWN-PIXEL LEVELS. Dividing the rect mean by `f` converts "the cards'
  // share of this rectangle" into "what one crown pixel reads", which is the
  // quantity the optics band is about and the only one comparable to the
  // clearing's own per-pixel level.
  const Ycard = C('cards') / f;
  const D = C('cardsNoSpec') / f;
  const D0 = C('cardsNoShadeNoSpec') / f;
  const Yclear = C('clearSurf');
  rows.push({
    shot, f, Yclear, Ycard, D, P: Ycard - D, D0,
    P0: C('cardsNoShade') / f - D0,
    Smeas: D / D0,
    rho: Ycard / Yclear,
    rho0: D0 / Yclear,
    cardShade: self ? self.cardShade : null,
    cardShadeRGB: self ? self.cardShadeRGB : null,
    sinSun: self ? self.sinSun : null,
    cardMu: self ? self.cardMu : null,
    k: self ? self.k : null, floor: self ? self.floor : null,
  });
}

const n = (x, d = 4) => (x === null || x === undefined ? '   --  '
  : x.toFixed(d).padStart(d + 3));
console.log('\n--- RN-2570 THE SPREAD, PER TERM (linear-light Y, crowns rect,'
  + ' un-hazed) ---');
if (extra.length > 0) console.log(`ARM: every run carries ${extra.join(' ')}`);
console.log('\nABSOLUTE LEVELS. rho is a ratio and cannot say which side moved.');
console.log('pose             f    Yclear     Ycard       D       P      D0'
  + '      rho     rho0');
for (const r of rows) {
  console.log(`${r.shot.padEnd(14)} ${n(r.f)} ${n(r.Yclear, 6)} ${n(r.Ycard, 6)}`
    + ` ${n(r.D, 6)} ${n(r.P, 6)} ${n(r.D0, 6)} ${n(r.rho)} ${n(r.rho0)}`);
}
console.log('\nTHE SHADE TERM, MEASURED AGAINST THE LAW THE PAGE PUBLISHES.');
console.log('pose            sinSun   cardMu  cardShade   Smeas   Smeas/S'
  + '   specShare');
for (const r of rows) {
  console.log(`${r.shot.padEnd(14)} ${n(r.sinSun)} ${n(r.cardMu)} ${n(r.cardShade)}`
    + `   ${n(r.Smeas)} ${n(r.cardShade ? r.Smeas / r.cardShade : null)}`
    + `    ${n(r.P / r.Ycard)}`);
}
console.log('\nWHAT MOVES rho ACROSS POSES, each term relative to forestairnoon.');
const b = rows[0];
if (b) {
  console.log('pose            rho/rho_fan  Yclear ratio  Ycard ratio  D0 ratio'
    + '  Smeas ratio');
  for (const r of rows) {
    console.log(`${r.shot.padEnd(14)}   ${n(r.rho / b.rho, 3)}      ${n(r.Yclear / b.Yclear, 3)}`
      + `       ${n(r.Ycard / b.Ycard, 3)}     ${n(r.D0 / b.D0, 3)}`
      + `    ${n(r.Smeas / b.Smeas, 3)}`);
  }
}
console.log('\ncardShadeRGB, the spectral split actually multiplied onto the card:');
for (const r of rows) {
  console.log(`  ${r.shot.padEnd(14)} ${r.cardShadeRGB
    ? r.cardShadeRGB.map((x) => x.toFixed(6)).join(' / ') : 'ABSENT'}`
    + `   (k ${r.k ?? '--'}, floor ${r.floor ?? '--'})`);
}
