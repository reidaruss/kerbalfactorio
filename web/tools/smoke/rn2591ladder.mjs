// RN-2591. THE GUARD'S OWN `rho`, ONE BROWSER RUN PER CANDIDATE.
//
// WHY A THIRD SEARCH TOOL AND NOT `rn2572cand`. That script re-runs THREE
// canopy-bearing arms per candidate because it judges the `box` RATCHET as well
// as the band, and the ratchet needs the shipped and un-hazed WOOD arms. A
// search over a shading-normal construction does not need the ratchet on every
// rung: `box` is the far treeline PAINT (2.38.3 measured the cards holding it
// down by 0.0270 against the paint's 0.3452, a factor of 12.8) and no
// `CrownNormal` setting touches the paint at all. So the ratchet is checked ONCE
// by `rn2550guard` on the final build, and the SEARCH runs on the one arm `rho`
// is actually made of.
//
// THE ARITHMETIC IS THE GUARD'S, NOT A SIMPLIFICATION OF IT:
//
//     f   = 1 - blackFrac(?terrainpaint=1)            a pixel count, exact
//     rho = Y(?terrainpaint=1) / (f * Y(?canopy=0))   both un-hazed
//
// which is `rn2550guard`'s definition character for character. Both arms carry
// `?prophaze=0&terrainhaze=0`, the arm the band is on.
//
// THE CLEARING IS MEASURED ONCE PER POSE AND REUSED, on `rn2572cand`'s own
// argument and with `rn2572cand`'s own safeguard: every knob swept here is a
// canopy setting, so on an arm with no canopy it is a no-op BY CONSTRUCTION,
// and `--verifyclear=1` re-measures the clearing under the LAST candidate's
// flags and fails if it moved past the guard's 1 per cent clearing pin.
// "A control whose arming step silently fails is indistinguishable from a
// passing control" is this project's scar and reusing a denominator is exactly
// where it bites.
//
// THE CLEARING PIN IS ALSO CHECKED AGAINST THE GUARD'S OWN `BASE`, parsed out
// of `rn2550guard.mjs` rather than retyped, so a run against a stale server or
// a moved height field is caught here rather than producing a plausible table.
//
//   node tools/smoke/rn2591ladder.mjs --url=http://127.0.0.1:5590/ \
//     --shots=forestairnoon --cands=- | crownflank=90,crowncard=0 | crownnormal=0
//
// `--cands=` is a `|`-separated list; each candidate is a comma-separated list
// of `key=value` page parameters and `-` is the shipped frame.
// EVERY FLAG NEEDS AN `=`; the parser splits on the first one.

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RUN = path.join(HERE, 'run.mjs');
const PROBE = path.join(HERE, 'probes', 'artframe.js');
const OFF = ['--prophaze=0', '--terrainhaze=0'];

const GSRC = fs.readFileSync(path.join(HERE, 'rn2550guard.mjs'), 'utf8');
const num = (name) => {
  const m = GSRC.match(new RegExp(`^const ${name} = ([0-9.]+);`, 'm'));
  if (!m) throw new Error(`rn2591ladder: cannot find ${name} in rn2550guard.mjs.`);
  return Number(m[1]);
};
const BAND_LOW = num('BAND_LOW'), BAND_HIGH = num('BAND_HIGH');
const CORE_LOW = num('CORE_LOW'), CORE_HIGH = num('CORE_HIGH');
const CLEAR_TOL_REL = num('CLEAR_TOL_REL');
const BASE = (() => {
  const m = GSRC.match(/const BASE = \{[\s\S]*?\n\};/);
  if (!m) throw new Error('rn2591ladder: cannot find BASE in rn2550guard.mjs.');
  // eslint-disable-next-line no-new-func
  return new Function(`${m[0]} return BASE;`)();
})();

const argv = new Map(process.argv.slice(2)
  .map((a) => { const i = a.indexOf('='); return [a.slice(0, i), a.slice(i + 1)]; }));
const url = argv.get('--url') ?? 'http://127.0.0.1:5590/';
const shots = (argv.get('--shots') ?? 'forestairnoon,flyoverlow').split(',');
const verifyClear = argv.get('--verifyclear') === '1';
// `--rho0=1` doubles the browser runs and is worth it only when the SPREAD is
// the question, so it is off by default rather than always on.
const wantRho0 = argv.get('--rho0') === '1';
// `--split=1` adds the `?propspec=0` arm, so `D` (diffuse) and `P = Ycard - D`
// (specular) are separated per candidate. This is 2.38.2's own decomposition
// re-taken per arm, and it is off by default for the same reason `--rho0` is:
// it is another browser run per candidate per pose.
const wantSplit = argv.get('--split') === '1';
const cands = (argv.get('--cands') ?? '-').split('|').map((s) => s.trim())
  .map((s) => ({ label: s, flags: s === '-' ? []
    : s.split(',').filter(Boolean).map((k) => `--${k.trim()}`) }));

function once(flags) {
  const args = [RUN, `--url=${url}`, '--scenario=surface',
    '--width=1600', '--height=900', `--evalfile=${PROBE}`, ...flags];
  const r = spawnSync(process.execPath, args, { encoding: 'utf8', maxBuffer: 1 << 28 });
  try { return JSON.parse(r.stdout).eval; } catch {
    return { valid: false, why: `no json (exit ${r.status})`,
      stderr: (r.stderr ?? '').slice(-400) };
  }
}
const arm = (shot, flags) => once([`--evalargs=${JSON.stringify({ shot })}`, ...flags]);
const ok = (v) => v.valid && (v.extra ?? {}).crowns;

let bad = 0;
const table = [];
for (const shot of shots) {
  const b = BASE[shot];
  if (!b) { console.error(`${shot}: no baseline in the guard's BASE table.`); bad++; continue; }
  const clearSurf = arm(shot, ['--canopy=0', ...OFF]);
  const clear = arm(shot, ['--canopy=0']);
  if (!ok(clearSurf) || !ok(clear)) {
    console.error(`${shot}: a clearing arm failed`); bad++; continue;
  }
  const Yclear = clearSurf.extra.crowns.lin.Y;
  const d = Math.abs(clear.extra.crowns.lin.Y - b.crownClearY) / b.crownClearY;
  if (d > CLEAR_TOL_REL) {
    console.error(`${shot}: the crowns CLEARING is off the guard's pin,`
      + ` ${clear.extra.crowns.lin.Y.toFixed(6)} against`
      + ` ${b.crownClearY.toFixed(6)} (${(d * 100).toFixed(2)}%).`);
    bad++;
  }
  console.log(`\n--- RN-2591 ${shot} --- band ${BAND_LOW}..${BAND_HIGH},`
    + ` core ${CORE_LOW}..${CORE_HIGH}; shipped-pin rho ${b.rho.toFixed(4)};`
    + ` Yclear(un-hazed) ${Yclear.toFixed(6)}`);
  console.log('candidate                                 f    Ycard       rho'
    + '     d(rho)      rho0   where');
  let lastFlags = null;
  for (const c of cands) {
    const e = arm(shot, ['--terrainpaint=1', ...OFF, ...c.flags]);
    if (!ok(e)) { console.error(`  ${c.label}: arm failed (${e.why})`); bad++; continue; }
    lastFlags = c.flags;
    const f = 1 - e.extra.crowns.blackFrac;
    const Ycard = e.extra.crowns.lin.Y / f;
    const rho = Ycard / Yclear;
    // rho0, THE UNSHADED UNSPECULAR DIFFUSE RATIO, and it is the quantity
    // 2.38.3's "8.3x" is a spread OF. `rho` mixes three things the normal moves
    // in different directions (diffuse, sky specular and the shade law's own
    // pose dependence); `rho0` is the crown's own optics with the self-shadow
    // and the specular both removed, which is the closest thing to a pure
    // reading of what the shading normal did. Its own coverage is used, not
    // `rho`'s: `?crownshade=0` changes how many card pixels quantise to exactly
    // black, so borrowing `f` across arms would be the same class of error as
    // borrowing a clearing across a term that moves it.
    let rho0 = null;
    if (wantRho0) {
      const z = arm(shot, ['--terrainpaint=1', '--crownshade=0', '--propspec=0',
        ...OFF, ...c.flags]);
      if (!ok(z)) { console.error(`  ${c.label}: rho0 arm failed`); bad++; }
      else {
        const f0 = 1 - z.extra.crowns.blackFrac;
        rho0 = z.extra.crowns.lin.Y / (f0 * Yclear);
      }
    }
    let D = null;
    if (wantSplit) {
      const y = arm(shot, ['--terrainpaint=1', '--propspec=0', ...OFF, ...c.flags]);
      if (!ok(y)) { console.error(`  ${c.label}: split arm failed`); bad++; }
      // Its OWN coverage, for the same reason `rho0` takes its own: removing
      // the specular changes how many card pixels quantise to exactly black.
      else D = y.extra.crowns.lin.Y / (1 - y.extra.crowns.blackFrac) / Yclear;
    }
    const cn = (e.treeline ?? {}).crownNormal ?? null;
    const where = rho < BAND_LOW ? `BELOW band by ${(BAND_LOW - rho).toFixed(4)}`
      : rho > BAND_HIGH ? `ABOVE band by ${(rho - BAND_HIGH).toFixed(4)}`
        : (rho >= CORE_LOW && rho <= CORE_HIGH ? 'IN CORE' : 'IN BAND');
    table.push({ shot, label: c.label, rho, rho0 });
    if (D !== null) {
      console.log(`${''.padEnd(34)} split: D/Yclear ${D.toFixed(4)}`
        + `  P/Yclear ${(rho - D).toFixed(4)}`
        + `  specular share ${((rho - D) / rho).toFixed(4)}`);
    }
    console.log(`${c.label.padEnd(34)} ${f.toFixed(4)} ${Ycard.toFixed(6)}`
      + `  ${rho.toFixed(4)}  ${(rho - b.rho >= 0 ? '+' : '')}${(rho - b.rho).toFixed(4)}`
      + `    ${rho0 === null ? '  --  ' : rho0.toFixed(4)}   ${where}`
      + (cn ? `   [meanUp ${cn.meanUp.toFixed(3)} outPlane`
        + ` ${cn.minAbsOutOfPlane.toFixed(3)} down ${cn.downVerts}]` : '')
      // RN-2605. THE BACK-FACE FOLD's OUTCOME READBACK, on every row, so an arm
      // that silently failed to reach a program is visible in the table rather
      // than in a separate run. `mode` is the live uniform value three uploads,
      // `cmp` is the splice-call count (0 with a nonzero mode is the vacuous
      // green) and `miss` is the anchor count. It is still not sufficient on
      // its own: see the note above about requests against outcomes. What
      // settles it is that mode 0 and mode 1 read different `rho`.
      + (() => {
        const cf = (e.treeline ?? {}).crownFace ?? null;
        return cf ? `   [face ${cf.mode} cmp ${cf.compiles}`
          + ` miss ${cf.misses.length}]` : '';
      })()
      // THE MATERIAL-SIDE REQUESTS, READ BACK OFF THE PAGE, AND THE THING THIS
      // COLUMN CANNOT DO. RN-2268: an arm that changes nothing is only worth
      // reading once the ask is proved to have arrived. **BUT AN ARRIVED ASK
      // AND A SURVIVING VALUE ARE NOT THE SAME THING, and an earlier version of
      // this comment said this column separates "the term is absent" from "the
      // flag was dropped", which is a FALSE DICHOTOMY and cost RN-2590 a wrong
      // conclusion.** There is a third case and `?canopyenv=` is in it: the
      // flag parsed, the write reached the material, and
      // `WebGLRenderer.js:2694-2696` overwrote the uniform from
      // `scene.environmentIntensity` before the draw. This column proves the
      // REQUEST, never the OUTCOME. When an arm measures an exact zero, the next
      // step is a control that DELETES the suspected source (here
      // `?ibldiag=noenv`, which moves the same rectangle -37.48 per cent), not a
      // wider sweep and not this readback. See rendering.md 2.39.10 and
      // NUMBERS.md's "a readback proves the query parsed" trap.
      + (() => {
        const s = (e.treeline ?? {}).self ?? null;
        if (s === null) return '';
        const bits = [];
        if (s.envOverride !== null && s.envOverride !== undefined) bits.push(`env ${s.envOverride}`);
        if (s.roughOverride !== null && s.roughOverride !== undefined) bits.push(`rough ${s.roughOverride}`);
        if (s.floor !== undefined) bits.push(`floor ${s.floor}`);
        return bits.length > 0 ? `   {${bits.join(', ')}}` : '';
      })());
  }
  if (verifyClear && lastFlags !== null && lastFlags.length > 0) {
    const c2 = arm(shot, ['--canopy=0', ...OFF, ...lastFlags]);
    if (!ok(c2)) { console.error(`${shot}: clearing re-check failed`); bad++; }
    else {
      const dd = Math.abs(c2.extra.crowns.lin.Y - Yclear) / Yclear;
      const good = dd <= CLEAR_TOL_REL;
      console.log(`  clearing re-check under ${lastFlags.join(' ')}:`
        + ` crowns ${(dd * 100).toFixed(3)}% -- ${good
          ? 'NO-OP CONFIRMED, the reuse is sound'
          : 'MOVED, the reuse is UNSOUND and every row above is suspect'}`);
      if (!good) bad++;
    }
  }
}

// THE SPREAD, printed only when the whole four-pose set was judged, because a
// spread over two poses is not the 8.3x number 2.38 quotes and would be
// mistaken for it. NUMBERS' "--shots narrows the guard" lesson, applied here.
const labels = [...new Set(table.map((r) => r.label))];
if (shots.length >= 4) {
  console.log('\nTHE FOUR-POSE SPREAD (max / min over the poses judged):');
  for (const key of ['rho', 'rho0']) {
    for (const l of labels) {
      const v = table.filter((r) => r.label === l).map((r) => r[key])
        .filter((x) => x !== null && x !== undefined);
      if (v.length < shots.length) continue;
      console.log(`  ${key.padEnd(5)} ${l.padEnd(34)}`
        + ` ${(Math.max(...v) / Math.min(...v)).toFixed(2)}x`
        + `   (${v.map((x) => x.toFixed(4)).join(' / ')})`);
    }
  }
} else {
  console.log(`\n(no spread printed: ${shots.length} pose(s) judged, not four.)`);
}
console.log(`\nrn2591ladder: ${bad === 0 ? 'clean' : `${bad} problem(s)`}`);
process.exit(bad === 0 ? 0 : 1);
