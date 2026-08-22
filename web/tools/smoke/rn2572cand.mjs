// RN-2572. CANDIDATE SETTINGS AGAINST BOTH GUARD CONSTRAINTS AT ONCE, cheaply.
//
// WHY THIS IS NOT JUST `rn2550guard --extra=`. The guard is the ACCEPTANCE
// TEST and it re-measures everything from scratch every time: six arms per
// pose, twenty-four browser runs for the full set. Searching a two-knob space
// with it costs a quarter of an hour per candidate, and the search is the part
// of stage 2 that has to happen before a constant can be chosen.
//
// THE SAVING IS EXACT AND IT IS NOT AN APPROXIMATION. Two of the guard's six
// arms are `?canopy=0` -- the CLEARING, the denominator of every ratio -- and
// **every knob this script sweeps is a canopy setting**, so on an arm with no
// canopy in it they are no-ops by construction. The clearing is therefore
// measured ONCE per pose and reused across candidates, and only the three
// canopy-bearing arms are re-run per candidate:
//
//   measured once per pose   clearing (`?canopy=0`), clearingSurf (+ haze off)
//   re-run per candidate     wood, woodSurf, cardsOnly (`?terrainpaint=1`)
//
// AND THE NO-OP IS ASSERTED RATHER THAN ASSUMED, because "a control whose
// arming step silently fails is indistinguishable from a passing control" is
// this project's own scar and reusing a denominator is exactly where it would
// bite. `--verifyclear=1` re-measures the clearing under the LAST candidate's
// flags and hard-fails if it moved by more than the guard's own 1 per cent
// clearing pin. Run it once per session; it is two extra browser runs.
//
// WHAT IT PRINTS, AND IT IS BOTH CONSTRAINTS SIDE BY SIDE, because stage 2's
// whole difficulty is that they pull against each other (rendering.md 2.35.7):
//   box Rship / box Rsurf   against the RATCHET ceilings in rn2550guard's BASE
//   crowns rho              against the BAND 0.18 .. 0.75
// A candidate is only interesting if it clears BOTH, and the verdict column
// says which one it failed.
//
// THE CEILINGS AND PINS ARE IMPORTED FROM THE GUARD, NOT RETYPED. RN-345's
// rule and NUMBERS' "two copies of one constant" scar: this file has no
// baseline table of its own, it reads `rn2550guard.mjs`'s. If the guard is
// re-pinned, this script moves with it and cannot disagree.
//
//   node tools/smoke/rn2572cand.mjs --url=http://127.0.0.1:5570/ \
//     --shots=forestairnoon,flyoverlow \
//     --cands=canopyrough=0.8 | canopyrough=1.0 | canopyrough=1.0,crownshadefloor=0.2
//
// `--cands=` is a `|`-separated list of candidates; each candidate is a
// comma-separated list of `key=value` page parameters. An EMPTY candidate is
// the shipped frame and is written as `-`.
//
// EVERY FLAG NEEDS AN `=`; the parser splits on the first one.

import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RUN = path.join(HERE, 'run.mjs');
const PROBE = path.join(HERE, 'probes', 'artframe.js');
const OFF = ['--prophaze=0', '--terrainhaze=0'];

// THE GUARD'S OWN NUMBERS, PARSED OUT OF THE GUARD. `rn2550guard.mjs` runs its
// measurement at import time, so it cannot be imported; the constants are read
// out of its source instead, which is still ONE definition rather than two and
// fails loudly if the shape it depends on ever changes.
const GSRC = fs.readFileSync(path.join(HERE, 'rn2550guard.mjs'), 'utf8');
const num = (name) => {
  const m = GSRC.match(new RegExp(`^const ${name} = ([0-9.]+);`, 'm'));
  if (!m) throw new Error(`rn2572cand: cannot find ${name} in rn2550guard.mjs.`
    + ' The guard\'s shape changed and this script must be re-pointed rather'
    + ' than left reading a stale copy.');
  return Number(m[1]);
};
const BAND_LOW = num('BAND_LOW'), BAND_HIGH = num('BAND_HIGH');
const CORE_LOW = num('CORE_LOW'), CORE_HIGH = num('CORE_HIGH');
const TOL = num('TOL'), CLEAR_TOL_REL = num('CLEAR_TOL_REL');
const BASE = (() => {
  const m = GSRC.match(/const BASE = \{[\s\S]*?\n\};/);
  if (!m) throw new Error('rn2572cand: cannot find BASE in rn2550guard.mjs.');
  // eslint-disable-next-line no-new-func
  return new Function(`${m[0]} return BASE;`)();
})();
void pathToFileURL;

const argv = new Map(process.argv.slice(2)
  .map((a) => { const i = a.indexOf('='); return [a.slice(0, i), a.slice(i + 1)]; }));
const url = argv.get('--url') ?? 'http://127.0.0.1:5570/';
const shots = (argv.get('--shots') ?? Object.keys(BASE).join(',')).split(',');
const verifyClear = argv.get('--verifyclear') === '1';
const cands = (argv.get('--cands') ?? '-').split('|').map((s) => s.trim())
  .map((s) => ({ label: s, flags: s === '-' ? []
    : s.split(',').filter(Boolean).map((k) => `--${k.trim()}`) }));
const shotBy = (s) => (s.startsWith('forestair') || s.startsWith('flyover')
  || s === 'limb' ? 'surface' : 'walk');

function once(shot, flags) {
  const args = [RUN, `--url=${url}`, `--scenario=${shotBy(shot)}`,
    '--width=1600', '--height=900', `--evalfile=${PROBE}`,
    `--evalargs=${JSON.stringify({ shot })}`, ...flags];
  if (shotBy(shot) === 'walk') args.push('--sandbox=1');
  const r = spawnSync(process.execPath, args, { encoding: 'utf8', maxBuffer: 1 << 28 });
  try { return JSON.parse(r.stdout).eval; } catch {
    return { valid: false, why: `no json (exit ${r.status})`,
      stderr: (r.stderr ?? '').slice(-400) };
  }
}
const ok = (v) => v.valid && (v.extra ?? {}).crowns && v.box?.lin?.Y > 0;

let bad = 0;
for (const shot of shots) {
  const b = BASE[shot];
  if (!b) { console.error(`${shot}: no baseline in the guard's BASE table.`); bad++; continue; }
  const clear = once(shot, ['--canopy=0']);
  const clearSurf = once(shot, ['--canopy=0', ...OFF]);
  if (!ok(clear) || !ok(clearSurf)) {
    console.error(`${shot}: a clearing arm failed`); bad++; continue;
  }
  const boxClear = clear.box.lin.Y, boxClearS = clearSurf.box.lin.Y;
  const crClearS = clearSurf.extra.crowns.lin.Y, crClear = clear.extra.crowns.lin.Y;
  // THE PIN, CHECKED HERE TOO. If the clearing has drifted off the guard's own
  // pin, every ratio below is against a different denominator and the table is
  // not comparable to the guard's.
  for (const [what, got, pin] of [['box', boxClear, b.boxClearY],
    ['crowns', crClear, b.crownClearY]]) {
    const d = Math.abs(got - pin) / pin;
    if (d > CLEAR_TOL_REL) {
      console.error(`${shot}: the ${what} CLEARING is off the guard's pin,`
        + ` ${got.toFixed(6)} against ${pin.toFixed(6)} (${(d * 100).toFixed(2)}%).`);
      bad++;
    }
  }

  console.log(`\n--- RN-2572 ${shot} --- ratchet ceilings boxShip <= `
    + `${b.boxShip.toFixed(4)}, boxSurf <= ${b.boxSurf.toFixed(4)} (+${TOL});`
    + ` band ${BAND_LOW}..${BAND_HIGH}; shipped rho ${b.rho.toFixed(4)}`);
  console.log('candidate                            boxShip  boxSurf      rho'
    + '   verdict');
  let lastFlags = null;
  for (const c of cands) {
    const wood = once(shot, c.flags);
    const woodSurf = once(shot, [...OFF, ...c.flags]);
    const cards = once(shot, ['--terrainpaint=1', ...OFF, ...c.flags]);
    if (!ok(wood) || !ok(woodSurf) || !ok(cards)) {
      console.error(`  ${c.label}: an arm failed`); bad++; continue;
    }
    lastFlags = c.flags;
    const f = 1 - cards.extra.crowns.blackFrac;
    const boxShip = wood.box.lin.Y / boxClear;
    const boxSurf = woodSurf.box.lin.Y / boxClearS;
    const rho = cards.extra.crowns.lin.Y / (f * crClearS);
    const why = [];
    if (boxShip > b.boxShip + TOL) why.push(`boxShip +${(boxShip - b.boxShip).toFixed(4)}`);
    if (boxSurf > b.boxSurf + TOL) why.push(`boxSurf +${(boxSurf - b.boxSurf).toFixed(4)}`);
    if (rho < BAND_LOW) {
      // The shipped frame is already below the band at forestairnoon, so the
      // guard's rule is DEPTH rather than membership: repayable, never deeper.
      why.push(b.rhoOut === 'low'
        ? (rho < b.rho - TOL ? `rho DEEPER by ${(b.rho - rho).toFixed(4)}`
          : `rho still low (${(BAND_LOW - rho).toFixed(4)} short, not deeper)`)
        : `rho BELOW band by ${(BAND_LOW - rho).toFixed(4)}`);
    }
    if (rho > BAND_HIGH) why.push(`rho ABOVE band by ${(rho - BAND_HIGH).toFixed(4)}`);
    const core = rho >= CORE_LOW && rho <= CORE_HIGH ? ' IN CORE' : '';
    console.log(`${c.label.padEnd(36)} ${boxShip.toFixed(4)} ${boxSurf.toFixed(4)}`
      + `  ${rho.toFixed(4)}   ${why.length === 0 ? `PASS${core}` : `FAIL: ${why.join('; ')}`}`
      + `   [f ${f.toFixed(4)}]`);
  }

  if (verifyClear && lastFlags !== null && lastFlags.length > 0) {
    const c2 = once(shot, ['--canopy=0', ...lastFlags]);
    const c2s = once(shot, ['--canopy=0', ...OFF, ...lastFlags]);
    if (!ok(c2) || !ok(c2s)) { console.error(`${shot}: clearing re-check failed`); bad++; }
    else {
      const d1 = Math.abs(c2.box.lin.Y - boxClear) / boxClear;
      const d2 = Math.abs(c2s.extra.crowns.lin.Y - crClearS) / crClearS;
      const good = d1 <= CLEAR_TOL_REL && d2 <= CLEAR_TOL_REL;
      console.log(`  clearing re-check under ${lastFlags.join(' ')}:`
        + ` box ${(d1 * 100).toFixed(3)}%, crowns ${(d2 * 100).toFixed(3)}%`
        + ` -- ${good ? 'NO-OP CONFIRMED, the reuse is sound'
          : 'MOVED, the reuse is UNSOUND and every row above is suspect'}`);
      if (!good) bad++;
    }
  }
}
console.log(`\nrn2572cand: ${bad === 0 ? 'clean' : `${bad} problem(s)`}`);
process.exit(bad === 0 ? 0 : 1);
