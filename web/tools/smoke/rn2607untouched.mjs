// RN-2607. WHAT THE BACK-FACE FOLD MUST NOT HAVE TOUCHED, ASSERTED RATHER THAN
// ARGUED, AND IT IS A DIFFERENT CLAIM FROM RN-2593's.
//
// `rn2593untouched.mjs` asserts that RN-2590's crown BAKE left the understorey
// alone, and its arming check reads `treeline().crownNormal.path` ('crown'
// against 'bend'). RN-2605 changes no bake at all: it splices a fragment-stage
// term into ONE program, chosen by a second module-scope `onBeforeCompile`
// object on the `OF_Canopy` material alone. So the arming check has to be a
// different one (`treeline().crownFace`) and the claim has to be stated
// differently:
//
//   THE UNDERSTOREY'S PROGRAM IS BYTE-IDENTICAL TO THE PRE-LANE ONE BY
//   CONSTRUCTION, because the splice is never called on it. This file is the
//   confirmation, not the proof, and it exists because "scoped by construction"
//   is exactly the sentence that has been wrong before.
//
// THREE POSES, EACH A DIFFERENT CLAIM:
//
//   forestfloor  THE UNDERSTOREY, RN-2593's own pose and its reason: a
//                ground-level walk pose whose subject is the tufts RN-1766 was
//                written for, and RN-1766 bought +7.4 per cent of whole-frame
//                `iqr` there with the bake this lane must not have leaked into.
//   meadownight  NIGHT, and it is the brief's own "night measured". A
//                sub-horizon sun (dot -0.25) has no direct term for a shading
//                normal to move, so anything that moves here is the sky ambient
//                or the specular and is worth knowing about. It also has no far
//                canopy in it, so it doubles as a second understorey pose.
//   forestair    THE POSE THE TERM IS FOR, and it is here as the ARMING
//                CONTROL rather than as a null: this pair MUST move, and a run
//                where all three poses are quiet is a run where the flag did
//                not reach the program. NUMBERS.md, RN-2590's third rule: an
//                exact zero is the signature of a write that never arrived.
//
// THE PAIR IS `?crownface=0` AGAINST THE SHIPPED DEFAULT ON ONE BUILD, one
// binary and one flag, which is strictly stronger than two builds (NUMBERS'
// "rebuilding a before directory from current source destroys the pair").
//
//   node tools/smoke/rn2607untouched.mjs --url=http://127.0.0.1:5605/
//
// EVERY FLAG NEEDS AN `=`; the parser splits on the first one.

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RUN = path.join(HERE, 'run.mjs');
const DIFF = path.join(HERE, 'pngdiff.mjs');
const PROBE = path.join(HERE, 'probes', 'artframe.js');

const argv = new Map(process.argv.slice(2)
  .map((a) => { const i = a.indexOf('='); return [a.slice(0, i), a.slice(i + 1)]; }));
const url = argv.get('--url') ?? 'http://127.0.0.1:5605/';
// INSIDE THE REPO: `run.mjs` REFUSES an `--out` outside it, and `web/build/` is
// gitignored scratch that cannot be committed by accident. RN-2593's own note.
const dir = path.join(HERE, '..', '..', 'build', 'rn2607');
fs.mkdirSync(dir, { recursive: true });

// THE CEILING, and it is a real number rather than zero: two page loads of the
// SAME build are not byte-identical at every pose, and RN-1766 quotes a 3.78
// per cent two-page-load floor at `forestfloor`. RN-2593's constant, unchanged,
// because it is a property of the instrument and not of either lane.
const FLOOR_PCT = 3.78;

function shoot(shot, scenario, flags, out) {
  const args = [RUN, `--url=${url}`, `--scenario=${scenario}`,
    '--width=1600', '--height=900', `--evalfile=${PROBE}`,
    `--evalargs=${JSON.stringify({ shot })}`, `--out=${out}`, ...flags];
  if (scenario === 'walk') args.push('--sandbox=1');
  const r = spawnSync(process.execPath, args, { encoding: 'utf8', maxBuffer: 1 << 28 });
  try { return JSON.parse(r.stdout).eval; } catch {
    return { valid: false, why: `no json (exit ${r.status})` };
  }
}

// `must` is what this pose is FOR: 'quiet' asserts the pair is under the
// two-page-load floor, 'moved' asserts the pair is far larger than THIS POSE's
// OWN two-load noise, measured here rather than borrowed.
//
// THE FIRST VERSION OF THE 'moved' TEST BORROWED THE 3.78 PER CENT FLOOR AND
// WAS WRONG, and it is recorded rather than quietly repaired. That constant is
// RN-1766's two-page-load scatter at `forestfloor`, which is a WALK pose whose
// streamed chunk set and character placement are not reproducible frame for
// frame; the aerial `surface` poses are, and this lane's own ladder reads their
// `rho` to four decimals across two separate builds. Applying a walk pose's
// noise floor to an aerial one called a 40,084-pixel, 37,790-darker move
// (`meanDelta` 18.04) "not armed". The floor is now MEASURED per pose: a
// same-flags pair on the arming pose is rendered first and the armed pair must
// beat it by `ARM_FACTOR`. A self-calibrating control cannot inherit another
// pose's instrument, which is the whole defect.
const ARM_FACTOR = 5;
const POSES = [
  ['forestfloor', 'walk', 'quiet'],
  ['meadownight', 'walk', 'quiet'],
  ['forestairnoon', 'surface', 'moved'],
];

const fails = [];
for (const [shot, scenario, must] of POSES) {
  const a = path.join(dir, `${shot}-shipped.png`);
  const b = path.join(dir, `${shot}-face0.png`);
  const ea = shoot(shot, scenario, [], a);
  const eb = shoot(shot, scenario, ['--crownface=0'], b);
  if (!ea.valid || !eb.valid) {
    fails.push(`${shot}: an arm failed (${ea.why ?? ''} ${eb.why ?? ''})`); continue;
  }
  // THE ARMING CHECK, AND IT IS AN OUTCOME READBACK. Two arms that both ran the
  // same mode are one build against itself and would pass silently forever.
  // `mode` is the live uniform value three uploads on every draw and
  // `compiles` counts the splice calls that landed: a nonzero mode with zero
  // compiles is the vacuous green, and a nonempty `misses` is an anchor that
  // stopped existing.
  const fa = (ea.treeline ?? {}).crownFace ?? null;
  const fb = (eb.treeline ?? {}).crownFace ?? null;
  if (fa === null || fb === null) {
    fails.push(`${shot}: no treeline().crownFace readback; the pair proves nothing.`);
  } else {
    if (fa.mode !== 1 || fb.mode !== 0) {
      fails.push(`${shot}: the arms are not armed (modes ${fa.mode} / ${fb.mode}).`);
    }
    if (fa.compiles < 1 || fb.compiles < 1) {
      fails.push(`${shot}: the splice landed ${fa.compiles} / ${fb.compiles}`
        + ' times; a configured term in no shader is the vacuous green.');
    }
    // THE FIVE MATERIAL FEATURES THAT WOULD COMPOSE BADLY WITH THE SPLICE,
    // plus the `side` the whole correction is predicated on, read LIVE off the
    // material rather than snapshotted at hook-install time. See
    // CrownFaceFold.ts's `F_TERM` header for what each one would do.
    for (const s of [fa, fb]) {
      for (const [k, v] of Object.entries(s.hazards)) {
        if (v !== 0) {
          fails.push(`${shot}: crown material hazard ${k} = ${v}; the splice`
            + ' does not compose with it. See CrownFaceFold.ts.');
        }
      }
    }
    if (fa.misses.length > 0 || fb.misses.length > 0) {
      fails.push(`${shot}: anchor misses ${JSON.stringify(fa.misses)}`
        + ` / ${JSON.stringify(fb.misses)}.`);
    }
    // THE SCOPE CLAIM ITSELF, read off the page rather than argued: exactly one
    // material took the crown hook. A second name here is a scope leak and the
    // pngdiff below might not be able to see it.
    for (const s of [fa, fb]) {
      if (s.materials.length !== 1 || !s.materials[0].includes('canopy')) {
        fails.push(`${shot}: the crown hook reached ${JSON.stringify(s.materials)},`
          + ' which is not `props:canopy` alone.');
      }
    }
  }
  const d = spawnSync(process.execPath, [DIFF, a, b],
    { encoding: 'utf8', maxBuffer: 1 << 26 });
  let j = null;
  try { j = JSON.parse(d.stdout); } catch { j = null; }
  if (j === null) { fails.push(`${shot}: pngdiff produced no json`); continue; }
  console.log(`${shot.padEnd(14)} ${must.padEnd(6)} moved ${String(j.moved).padStart(7)} px`
    + ` (${String(j.pct).padStart(5)}%)  darker ${j.darker} / lighter ${j.lighter}`
    + `  maxDelta ${j.maxDelta}  meanDelta ${j.meanDelta}`);
  if (must === 'quiet' && j.pct > FLOOR_PCT) {
    fails.push(`${shot}: ${j.pct}% of pixels moved, over the ${FLOOR_PCT}%`
      + ' two-page-load floor. Something outside the crown cards moved.');
  }
  if (must === 'moved') {
    // THIS POSE'S OWN TWO-LOAD NOISE, rendered here rather than borrowed. Two
    // loads of the SHIPPED arm, diffed against each other, is the smallest
    // number this instrument can call a difference at this pose; the armed pair
    // has to beat it by `ARM_FACTOR`.
    const c = path.join(dir, `${shot}-shipped2.png`);
    const ec = shoot(shot, scenario, [], c);
    if (!ec.valid) { fails.push(`${shot}: the noise-floor arm failed`); continue; }
    const dn = spawnSync(process.execPath, [DIFF, a, c],
      { encoding: 'utf8', maxBuffer: 1 << 26 });
    let jn = null;
    try { jn = JSON.parse(dn.stdout); } catch { jn = null; }
    if (jn === null) { fails.push(`${shot}: noise pngdiff produced no json`); continue; }
    console.log(`${shot.padEnd(14)} noise  moved ${String(jn.moved).padStart(7)} px`
      + ` (${String(jn.pct).padStart(5)}%)  two loads of the SHIPPED arm`);
    if (j.pct <= Math.max(jn.pct * ARM_FACTOR, 0.05)) {
      fails.push(`${shot}: the armed pair moved ${j.pct}% against this pose's own`
        + ` two-load noise of ${jn.pct}%, under the ${ARM_FACTOR}x arming`
        + ' factor. The arming pose did not arm.');
    }
  }
}

for (const f of fails) console.error(`FAIL: ${f}`);
console.log(`\nrn2607untouched: ${fails.length === 0 ? 'clean' : `${fails.length} failure(s)`}`
  + `   (frames in ${dir})`);
process.exit(fails.length === 0 ? 0 : 1);
