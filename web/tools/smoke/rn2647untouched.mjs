// RN-2647. WHAT THE CROWN'S ENVIRONMENT CUT MUST NOT HAVE TOUCHED, ASSERTED
// RATHER THAN ARGUED, AND IT IS A DIFFERENT CLAIM AGAIN FROM RN-2593's AND
// RN-2607's.
//
// `rn2593untouched.mjs` asserts that RN-2590's crown BAKE left the understorey
// alone (arming readback `treeline().crownNormal.path`). `rn2607untouched.mjs`
// asserts the same of RN-2605's fragment SPLICE (arming readback
// `treeline().crownFace`). RN-2645 is neither a bake nor a splice: it assigns
// an own `envMap` and a derived `envMapIntensity` to ONE material object, per
// frame, from the CPU. So the arming readback has to be a third one
// (`treeline().crownEnv`) and the claim has to be stated in its own terms:
//
//   THE WRITE REACHES EXACTLY ONE MATERIAL, AND THE PAGE PUBLISHES WHICH.
//   `SurfaceBind.apply`'s `canopy` branch is the only caller of
//   `noteCrownEnvMaterial`, the call is deduplicated by material identity, and
//   `crownEnv.materials` is read off the page on every arm of every run below.
//   Any second name is a scope leak. This file is the confirmation, not the
//   proof, and it exists because "scoped by construction" is exactly the
//   sentence that has been wrong before.
//
// AND IT CARRIES ONE CLAIM THE OTHER TWO DID NOT HAVE TO MAKE. The escape from
// `WebGLRenderer.js:2694-2696` also escapes `Headlamp.ts:401`, which drives
// `scene.environmentIntensity` DOWN underground for every stock material. The
// shipped write multiplies the derived factor by that live scene value, so the
// crown still follows the cave ramp; `sceneIntensity` is read back on every arm
// here so the composition is a reading rather than a promise.
//
// THREE POSES, EACH A DIFFERENT CLAIM:
//
//   forestfloor  THE UNDERSTOREY, RN-2593's own pose and its reason: a
//                ground-level walk pose whose subject is the tufts RN-1766 was
//                written for. `OF_Canopy` is authored at `_LOD3` alone, so
//                nothing this lane writes can reach it.
//   meadownight  NIGHT, and a second understorey pose: no far canopy in it at
//                all, so anything that moves here is a leak by definition.
//   forestair    THE POSE THE TERM IS FOR, and it is the ARMING CONTROL rather
//                than a null: this pair MUST move, and a run where all three
//                poses are quiet is a run where the write did not reach the
//                draw. NUMBERS.md, RN-2590's third rule: an exact zero is the
//                signature of a write that never arrived.
//
// THE PAIR IS `?crownenv=off` AGAINST THE SHIPPED DEFAULT ON ONE BUILD, one
// binary and one flag, which is strictly stronger than two builds (NUMBERS'
// "rebuilding a before directory from current source destroys the pair").
//
//   node tools/smoke/rn2647untouched.mjs --url=http://127.0.0.1:5645/
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
const url = argv.get('--url') ?? 'http://127.0.0.1:5645/';
// INSIDE THE REPO: `run.mjs` REFUSES an `--out` outside it, and `web/build/` is
// gitignored scratch that cannot be committed by accident. RN-2593's own note.
const dir = path.join(HERE, '..', '..', 'build', 'rn2647');
fs.mkdirSync(dir, { recursive: true });

/** The one flag that separates the arms. Kept as a constant so the header, the
 *  filenames and the arming assertion cannot drift apart. */
const OFF_ARM = ['--crownenv=off'];

// RN-1766's two-page-load floor at `forestfloor`, unchanged, because it is a
// property of the instrument and not of any lane.
const FLOOR_PCT = 3.78;

// ---------------------------------------------------------------------------
// THE ARMING TEST IS ON THE SUBJECT'S OWN RECTANGLE AND NOT ON A WHOLE-FRAME
// PIXEL COUNT, AND THE FIRST VERSION OF THIS FILE GOT THAT WRONG
// ---------------------------------------------------------------------------
// RN-2607 measured its arming with a whole-frame `pngdiff` percentage against
// that pose's own two-load noise, times five. Copied here it FAILED: the armed
// pair moved 0.33 per cent of the frame against a 0.12 per cent noise, 2.75x,
// under the factor -- while the ladder on the same build reads the same change
// moving the `crowns` rectangle's `rho` from 0.2386 to 0.1890, which is 21 per
// cent of the subject and is not a marginal anything.
//
// **BOTH NUMBERS ARE RIGHT AND ONLY ONE OF THEM IS AN ARMING TEST.** The
// `crowns` rectangle is 20,000 pixels of a 1,440,000-pixel frame, i.e. 1.4 per
// cent, and the far crown cards outside it are a similar sliver. A term
// confined to the crown cards therefore cannot move much of the FRAME however
// large it is on its own subject, so a whole-frame count divides the signal by
// seventy before comparing it to a noise floor that is not divided at all.
// RN-2607's own term did clear it, because a back-face normal negation on half
// of every card is a much larger per-pixel change than a 15 per cent cut of a
// specular lobe -- which is a property of THAT term and not of this instrument.
//
// So the whole-frame `pngdiff` is kept for the two QUIET poses, where "did
// anything outside the cards move" is exactly the question it answers, and the
// arming pose is armed on `crowns.lin.Y` -- the guard's own quantity, on the
// guard's own committed rectangle -- against ITS own two-load reproducibility,
// measured here rather than assumed. The aerial `surface` poses reproduce that
// quantity to four decimals across separate builds, so the factor can be much
// larger than five and is.
const ARM_FACTOR = 20;
/** And a floor under the factor, so a run whose noise happens to be exactly
 *  zero cannot arm on an arbitrarily small move. Two per cent of the subject. */
const ARM_MIN_REL = 0.02;

const POSES = [
  ['forestfloor', 'walk', 'quiet'],
  ['meadownight', 'walk', 'quiet'],
  ['forestairnoon', 'surface', 'moved'],
];

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

const fails = [];
for (const [shot, scenario, must] of POSES) {
  const a = path.join(dir, `${shot}-shipped.png`);
  const b = path.join(dir, `${shot}-envoff.png`);
  const ea = shoot(shot, scenario, [], a);
  const eb = shoot(shot, scenario, OFF_ARM, b);
  if (!ea.valid || !eb.valid) {
    fails.push(`${shot}: an arm failed (${ea.why ?? ''} ${eb.why ?? ''})`); continue;
  }
  // THE ARMING CHECK, AND IT IS AN OUTCOME READBACK. `appliedLive` is
  // `material.envMapIntensity` read after the last frame's DRAW: on the shipped
  // arm it must equal the derived `applied`, and on the `off` arm the renderer
  // must have overwritten it back to `sceneIntensity`. Two arms reading the
  // same value would be one build against itself and would pass forever.
  const sa = (ea.treeline ?? {}).crownEnv ?? null;
  const sb = (eb.treeline ?? {}).crownEnv ?? null;
  if (sa === null || sb === null) {
    fails.push(`${shot}: no treeline().crownEnv readback; the pair proves nothing.`);
  } else {
    if (sa.installed !== true || sb.installed !== false) {
      fails.push(`${shot}: the arms are not armed (installed ${sa.installed} / ${sb.installed}).`);
    }
    if (sa.ownEnvMap !== true) {
      fails.push(`${shot}: the shipped arm has no own envMap, so the renderer`
        + ' is still overwriting the intensity and the term is dead.');
    }
    if (sa.sameTexture !== true) {
      fails.push(`${shot}: the shipped arm's envMap is not the scene's own`
        + ' texture, so the crown is lit by a different sky from everything else.');
    }
    if (!(sa.writes > 0)) {
      fails.push(`${shot}: the per-frame updater ran ${sa.writes} times; a`
        + ' configured term nothing writes is the vacuous green.');
    }
    // THE OUTCOME. On the shipped arm the material must still be carrying the
    // derived value after the draw; if it reads `sceneIntensity` instead, the
    // escape from the overwrite branch failed and RN-2590's defect is back.
    if (sa.appliedLive === null || Math.abs(sa.appliedLive - sa.applied) > 1e-6) {
      fails.push(`${shot}: envMapIntensity read AFTER the draw is`
        + ` ${sa.appliedLive} against the ${sa.applied} written. The renderer`
        + ' is still overwriting it.');
    }
    // AND THE MIRROR OF IT ON THE OFF ARM, which is the non-vacuity proof for
    // this readback itself: with no own envMap the renderer MUST have put
    // `sceneIntensity` back, and a readback that cannot show that difference is
    // a readback that is not reading the draw.
    if (sb.appliedLive === null || Math.abs(sb.appliedLive - sb.sceneIntensity) > 1e-6) {
      fails.push(`${shot}: the off arm reads envMapIntensity ${sb.appliedLive}`
        + ` rather than the scene's ${sb.sceneIntensity}; the readback is not`
        + ' reading what the draw saw.');
    }
    // THE SCOPE CLAIM, read off the page rather than argued.
    for (const s of [sa, sb]) {
      if (s.materials.length !== 1 || !s.materials[0].includes('canopy')) {
        fails.push(`${shot}: the crown env write reached`
          + ` ${JSON.stringify(s.materials)}, which is not the canopy alone.`);
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
    const c = path.join(dir, `${shot}-shipped2.png`);
    const ec = shoot(shot, scenario, [], c);
    if (!ec.valid) { fails.push(`${shot}: the noise-floor arm failed`); continue; }
    const dn = spawnSync(process.execPath, [DIFF, a, c],
      { encoding: 'utf8', maxBuffer: 1 << 26 });
    let jn = null;
    try { jn = JSON.parse(dn.stdout); } catch { jn = null; }
    console.log(`${shot.padEnd(14)} noise  moved ${jn === null ? '?' : String(jn.moved).padStart(7)} px`
      + ` (${jn === null ? '?' : String(jn.pct).padStart(5)}%)  two loads of the SHIPPED arm`
      + '   [FRAME counts, printed for the record; the arming test is below]');
    // THE ARMING TEST, on the guard's own quantity and the guard's own
    // rectangle. See the block by `ARM_FACTOR` for why the frame count above
    // cannot do this job for a term confined to 1.4 per cent of the frame.
    const Y = (e) => ((e.extra ?? {}).crowns ?? {}).lin?.Y ?? null;
    // AND ON THE CARDS ALONE. `?terrainpaint=1` flattens the terrain to a paint
    // so the `crowns` rectangle is the crown cards and nothing else -- it is
    // the arm `rho` itself is measured on, and the arm this lane's term is
    // ENTIRELY inside. Without it the rectangle still carries the ground
    // between the cards, which dilutes the subject a second time after the
    // frame count already diluted it seventy-fold.
    const PAINT = ['--terrainpaint=1', '--prophaze=0', '--terrainhaze=0'];
    const pa = shoot(shot, scenario, PAINT, path.join(dir, `${shot}-paint-shipped.png`));
    const pb = shoot(shot, scenario, [...PAINT, ...OFF_ARM],
      path.join(dir, `${shot}-paint-envoff.png`));
    const ya = Y(pa); const yb = Y(pb); const yc = Y(ec); const yfa = Y(ea);
    if (ya === null || yb === null || yc === null || yfa === null) {
      fails.push(`${shot}: no crowns.lin.Y on one of the arms.`); continue;
    }
    const move = Math.abs(ya - yb) / yb;
    const noise = Math.abs(yfa - yc) / yfa;
    console.log(`${shot.padEnd(14)} ARMED  crowns lin.Y on the CARDS ALONE`
      + ` (?terrainpaint=1) ${ya.toFixed(6)} shipped against ${yb.toFixed(6)} off`
      + ` = ${(move * 100).toFixed(2)}% of the subject, on a two-load noise of`
      + ` ${(noise * 100).toFixed(3)}%`);
    if (move <= Math.max(noise * ARM_FACTOR, ARM_MIN_REL)) {
      fails.push(`${shot}: the armed pair moved ${(move * 100).toFixed(2)}% of the`
        + ` crowns rectangle against a two-load noise of ${(noise * 100).toFixed(3)}%,`
        + ` under the ${ARM_FACTOR}x factor or the ${ARM_MIN_REL * 100}% floor.`
        + ' The arming pose did not arm.');
    }
  }
}

for (const f of fails) console.error(`FAIL: ${f}`);
console.log(`\nrn2647untouched: ${fails.length === 0 ? 'clean' : `${fails.length} failure(s)`}`
  + `   (frames in ${dir})`);
process.exit(fails.length === 0 ? 0 : 1);
