// RN-2662. WHAT THE WOOD-FLOOR SHADE MUST NOT HAVE TOUCHED, ASSERTED RATHER
// THAN ARGUED, PLUS THE NIGHT CONDITION THE POSE SET DOES NOT COVER.
//
// RN-2661 multiplies the terrain albedo by `ofCrownSelfShade` over the ground
// the far canopy does NOT hide. Three zeros are claimed for it and all three
// are structural, which is exactly the kind of claim this project has been
// wrong about before:
//
//   INSIDE 690 m   `ofTreeInstanceW` returns 1, so the whole branch is skipped
//                  and the term never runs. Every walk pose is in here.
//   vCanopy == 0   the outer gate refuses (no canopy biome, or ground above
//                  CANOPY_MAX_ALT_M). The two Mountains poses are here.
//   ?treeline=0    `uTreeline.x` is 0, so the gate product `treeGap` is 0 and
//                  `mix(1.0, S, 0.0)` is exactly 1.0.
//
// THE QUIET POSES ARE JUDGED AGAINST THEIR OWN TWO-LOAD NOISE, not against a
// borrowed constant, which is RN-2607's own recorded lesson: a walk pose's
// streamed chunk set and character placement are not reproducible frame for
// frame, and applying one pose's floor to another has already mislabelled a
// forty-thousand-pixel move as "not armed". Each quiet pose renders the
// SHIPPED arm twice and the flag pair once; the pair must not beat the pose's
// own two-load scatter.
//
// AND NIGHT IS AN ARGUMENT RATHER THAN A NEW POSE (NUMBERS.md, RN-2605's
// pattern). `artframe.js` takes `sunDot`/`sunTol` as evalargs, so the Forest
// AERIAL site is re-shot at -0.25 with no manifest change. The claim there is
// NOT a null and that is the point: with the sun under the horizon
// `max(sinSun, OF_CROWN_SUN_MIN)` clamps to 0.02, the transmittance underflows
// and the wood's floor falls to the bare ambient floor. A wood at night is a
// wood whose floor sees only the sky it can see through the canopy, so the
// term MUST be live there and MUST darken. A quiet night arm would mean the
// term had silently switched itself off in the one condition where its own
// clamp is the whole of its behaviour.
//
//   node tools/smoke/rn2662untouched.mjs --url=http://127.0.0.1:5660/
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
const url = argv.get('--url') ?? 'http://127.0.0.1:5660/';
// INSIDE THE REPO (`run.mjs` refuses an `--out` outside it) and gitignored, so
// a verifier reproducing a number cannot dirty the tree. RN-2593's own note.
const dir = path.join(HERE, '..', '..', 'build', 'rn2662');
fs.mkdirSync(dir, { recursive: true });

const ARM_FACTOR = 5;
// A pair under this is quiet whatever the noise arm says: two loads that
// happen to agree to the pixel must not make a 0.01 per cent pair a failure.
const QUIET_FLOOR_PCT = 0.05;

const POSES = [
  // shot, scenario, must, evalargs extras
  ['forestfloor', 'walk', 'quiet', {}],
  ['meadow', 'walk', 'quiet', {}],
  ['vista', 'walk', 'quiet', {}],
  ['forestair', 'surface', 'moved', { sunDot: -0.25, sunTol: 0.03 }],
  ['flyovernoon', 'surface', 'moved', {}],
];

function shoot(shot, scenario, extra, flags, out) {
  const args = [RUN, `--url=${url}`, `--scenario=${scenario}`,
    '--width=1600', '--height=900', `--evalfile=${PROBE}`,
    `--evalargs=${JSON.stringify({ shot, ...extra })}`, `--out=${out}`, ...flags];
  if (scenario === 'walk') args.push('--sandbox=1');
  const r = spawnSync(process.execPath, args, { encoding: 'utf8', maxBuffer: 1 << 28 });
  try { return JSON.parse(r.stdout).eval; } catch {
    return { valid: false, why: `no json (exit ${r.status})`,
      stderr: (r.stderr ?? '').slice(-300) };
  }
}
function diff(a, b) {
  const d = spawnSync(process.execPath, [DIFF, a, b],
    { encoding: 'utf8', maxBuffer: 1 << 26 });
  try { return JSON.parse(d.stdout); } catch { return null; }
}

const fails = [];
for (const [shot, scenario, must, extra] of POSES) {
  const tag = extra.sunDot === undefined ? shot : `${shot}_sun${extra.sunDot}`;
  const a = path.join(dir, `${tag}-shipped.png`);
  const a2 = path.join(dir, `${tag}-shipped2.png`);
  const b = path.join(dir, `${tag}-floor0.png`);
  const ea = shoot(shot, scenario, extra, [], a);
  const eb = shoot(shot, scenario, extra, ['--treelinefloor=0'], b);
  const ec = shoot(shot, scenario, extra, [], a2);
  if (!ea.valid || !eb.valid || !ec.valid) {
    fails.push(`${tag}: an arm failed (${ea.why ?? ''} ${eb.why ?? ''} ${ec.why ?? ''})`);
    continue;
  }
  // THE ARMING CHECK, AND IT IS AN OUTCOME READBACK OFF THE PAGE rather than
  // the flag having been typed. Two arms that both ran the same value are one
  // build against itself and would pass silently forever.
  const fa = (ea.treeline ?? {}).floorShade;
  const fb = (eb.treeline ?? {}).floorShade;
  if (fa !== 1 || fb !== 0) {
    fails.push(`${tag}: NOT ARMED, treeline().floorShade reads ${fa} / ${fb}`
      + ' rather than 1 / 0, so the pair is one setting against itself.');
    continue;
  }
  const j = diff(a, b);
  const jn = diff(a, a2);
  if (j === null || jn === null) { fails.push(`${tag}: pngdiff produced no json`); continue; }
  console.log(`${tag.padEnd(20)} ${must.padEnd(6)} pair moved ${String(j.moved).padStart(7)} px`
    + ` (${String(j.pct).padStart(6)}%)  darker ${j.darker} / lighter ${j.lighter}`
    + `  meanDelta ${j.meanDelta}   own two-load noise ${String(jn.pct).padStart(6)}%`);
  if (must === 'quiet' && j.pct > Math.max(jn.pct, QUIET_FLOOR_PCT)) {
    fails.push(`${tag}: the flag pair moved ${j.pct}% against this pose's own`
      + ` two-load noise of ${jn.pct}%. The term reached a pose all three of its`
      + ' zeros say it cannot reach.');
  }
  if (must === 'moved') {
    if (j.pct <= Math.max(jn.pct * ARM_FACTOR, QUIET_FLOOR_PCT)) {
      fails.push(`${tag}: the armed pair moved ${j.pct}% against a two-load noise`
        + ` of ${jn.pct}%, under the ${ARM_FACTOR}x arming factor.`);
    }
    // DIRECTION, AND IT IS THE CLAIM RATHER THAN A SANITY CHECK. `pngdiff a b`
    // counts a pixel as `lighter` when b is lighter than a; a is the SHIPPED
    // arm and b is `?treelinefloor=0`, so REMOVING the shade must brighten,
    // overwhelmingly. A pair that moved the other way would mean the multiply
    // had landed somewhere other than where this lane says it did.
    if (!(j.lighter > j.darker * 4)) {
      fails.push(`${tag}: the pair moved but removing the shade did not brighten`
        + ` (${j.lighter} lighter against ${j.darker} darker). A shade term whose`
        + ' removal darkens is not the term this lane wrote.');
    }
  }
}

for (const f of fails) console.error(`FAIL: ${f}`);
console.log(`\nrn2662untouched: ${fails.length === 0 ? 'clean' : `${fails.length} failure(s)`}`
  + `   (frames in ${dir})`);
process.exit(fails.length === 0 ? 0 : 1);
