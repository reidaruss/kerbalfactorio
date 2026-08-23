// BT-345 (INSTRUMENT 3). `?firelightground=0` ARMING CHECK, BUILT ON N19'S OWN
// FIX, NOT ON THIS LANE'S OWN (SUPERSEDED) FIRST DRAFT.
//
// THIS SUBSECTION IS REWRITTEN FROM AN EARLIER VERSION, AND THE CORRECTION IS
// RECORDED RATHER THAN QUIETLY OVERWRITTEN (see docs/controllers/build-tooling.md's
// BT-345 entry and rendering.md 2.48.1 for the full account). This lane's own
// first pass, working from `origin/main` at `50daac5b` before `lane/n19-emitground`
// was visible, added its OWN two ad hoc ground rectangles (RN-2420's old pixel
// coordinates) and measured a real 3.5/4.4 per cent move under `?firelightground=0`
// -- contradicting rendering.md 2.46.5/2.46.8's "delivers exactly zero" -- but those
// rectangles, unnoticed at the time, OVERLAP `hearthL`'s own column, contaminating
// the reading with machine pixels.
//
// **`lane/n19-emitground` (RN-2710 to RN-2714) LANDED THE CLEAN ANSWER, AND THIS
// SCRIPT IS BUILT ON IT RATHER THAN ON A COMPETING REDISCOVERY.** `?firelightground=0`
// was never proven inert: every one of `smelternight`'s TWELVE pre-existing committed
// rectangles (`box`, `sunface`, `firebox`, `band`, `plate`, `hearthL`, `hearthR`,
// `peep`, `strip`, `placard`, `bandLit`, `bandShade`) is machine surface -- shell,
// brick, paint, the fire itself -- and the flag gates ONLY the terrain material's
// take (`TerrainAmpQuery.emitGroundFromQuery`). A switch that cannot reach a
// rectangle's pixels cannot move that rectangle, whether or not the term it guards
// works: "bit-identical at every committed rectangle" was rect-blindness, not a dead
// switch. N19 added its own `groundL`/`groundR` (plain grass, clear of both hearth
// columns, at `SHOTS.smelterhero.extra` -- this lane's own OLD rectangles were
// withdrawn and replaced with N19's, verbatim, in the same manifest slot) and
// measured, one flag apart, with all twelve machine rectangles held bit-identical
// as the attribution control:
//
//   groundL   shipped rgb 5.01/6.68/5.74   ?firelightground=0 rgb 4.67/6.63/5.72
//             R -6.7%, G/B under 1%
//   groundR   shipped rgb 3.97/5.38/4.24   ?firelightground=0 rgb 3.55/5.33/4.22
//             R -10.6%, G/B under 1%
//
// The move is confined to `R` -- the fire's own colour, not a global exposure shift
// -- which is why THIS CHECK MEASURES PER CHANNEL rather than luma: a luma-only
// floor would dilute a real, attributable 6.7-to-10.6 per cent signal on the one
// channel that actually carries it down to a small fraction of a per cent overall,
// nearly indistinguishable from noise. A 200x-gain diagnostic overlay (rendering.md
// 2.47, N19's own, not shipped) additionally confirms a correctly shaped, correctly
// centred falloff pool at the machine's base out to its own 40 m reach: `uEmitGround`
// is wired, live and correct. The residual "unlit lawn" look is real but small on an
// already-dark night ground, and separately explained by grass-blade geometry
// (`GrassGlsl.ts`) carrying no `ofEmitIrradiance` splice of its own -- a second
// material's seam, routed by N19 and not this lane's to fix.
//
// THIS LANE'S JOB IS THE INSTRUMENT, NOT THE DIAGNOSIS -- N19 ALREADY DID THAT.
// What ships here is the ARMING CHECK BT-345's brief actually asked for: a repeatable
// assertion that `?firelightground=0` moves at least one channel of at least one
// ground rectangle by a stated floor, SO THAT A FUTURE REGRESSION THAT MAKES THE
// GROUND TERM GENUINELY INERT AGAIN IS CAUGHT, rather than mistaken for the
// rect-blindness that made two audits in a row believe it already was inert. This
// check therefore PASSES today (as it should: N19 proved the mechanism works), which
// is the correct outcome for an arming check on a flag that turned out not to be
// broken.
//
// THE POSE. `smelternight` (RN-2365), `--lamp=0 --props=0` (removes the street-lamp
// fill and reduces grass canopy over the near ground, on rendering.md 8543-8570's
// own precedent, kept here even though N19's own measurement did not need it --
// belt and braces costs one flag).
//
// THE CHECK, TWO PARTS, BOTH PER-CHANNEL RELATIVE (matching N19's own methodology,
// since the effect is channel-specific and a mixed-channel statistic would dilute it).
//   (a) SANITY: `?firelight=0` (the whole emissive model, already proven live on the
//       machine side) must move at least one channel of one ground rectangle by more
//       than REL_FLOOR. If it does not, this pose/rectangle pair cannot see the
//       emissive at all right now and the arming check below is meaningless on it.
//   (b) THE ARMING CHECK ITSELF: `?firelightground=0` must move at least one channel
//       of one ground rectangle by more than REL_FLOOR. If it does not, FAIL LOUD
//       naming the class of defect ("registered but inert"), so this cannot silently
//       ship green again if the ground path regresses.
//
// REL_FLOOR = 0.02 (2 per cent relative to shipped), comfortably below N19's own
// measured 6.7/10.6 per cent and comfortably above the sub-1-per-cent noise N19's
// own G/B channels show on the same pair.
//
//   node tools/smoke/firelightgroundarm.mjs --url=http://127.0.0.1:<port>/
//
// Exit 0: the ground flag moves something (armed) and the sanity arm confirms the
//   pose can see the emissive at all.
// Exit 1: either arm is inert, i.e. moves nothing beyond REL_FLOOR on any channel.

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RUN = path.join(HERE, 'run.mjs');
const PROBE = path.join(HERE, 'probes', 'artframe.js');

const REL_FLOOR = 0.02; // relative to the shipped arm's own value, per channel.

const argv = new Map(process.argv.slice(2)
  .map((a) => { const i = a.indexOf('='); return [a.slice(0, i), a.slice(i + 1)]; }));
const url = argv.get('--url') ?? 'http://127.0.0.1:5550/';

function once(flags) {
  const args = [RUN, `--url=${url}`, '--scenario=walk', '--sandbox=1',
    '--width=1600', '--height=900', `--evalfile=${PROBE}`,
    '--evalargs={"shot":"smelternight"}', '--lamp=0', '--props=0', ...flags];
  const r = spawnSync(process.execPath, args, { encoding: 'utf8', maxBuffer: 1 << 28 });
  try { return JSON.parse(r.stdout).eval; } catch {
    return { valid: false, why: `no json (exit ${r.status})`,
      stderr: (r.stderr ?? '').slice(-400) };
  }
}

const fails = [];
const CHANNELS = ['R', 'G', 'B'];

console.log('firelightgroundarm: three arms, smelternight, --lamp=0 --props=0, N19\'s'
  + ' groundL/groundR, checked per RGB channel');
const shipped = once([]);
const firelightOff = once(['--firelight=0']);
const groundOff = once(['--firelightground=0']);

for (const [name, e] of [['shipped', shipped], ['firelight=0', firelightOff],
  ['firelightground=0', groundOff]]) {
  if (!e.valid || !e.extra?.groundL?.rgb || !e.extra?.groundR?.rgb) {
    fails.push(`${name}: did not produce both ground rectangles with an rgb triple`
      + `${e.why ? ` (${e.why})` : ''}${e.stderr ? `; ${e.stderr.split('\n').pop()}` : ''}`);
  }
}
if (fails.length > 0) {
  for (const m of fails) console.error(`firelightgroundarm: FAIL ${m}`);
  console.error('firelightgroundarm: FAIL (could not take the three arms)');
  process.exit(1);
}

const rel = (base, moved) => (base === 0 ? 0 : Math.abs(base - moved) / base);
// Biggest per-channel relative move across both rectangles, for the printed table.
function maxRel(base, moved) {
  let best = 0;
  for (const rect of ['groundL', 'groundR']) {
    for (let c = 0; c < 3; c++) {
      const r = rel(base.extra[rect].rgb[c], moved.extra[rect].rgb[c]);
      if (r > best) best = r;
    }
  }
  return best;
}
function anyMoved(base, moved, floor) {
  for (const rect of ['groundL', 'groundR']) {
    for (let c = 0; c < 3; c++) {
      if (rel(base.extra[rect].rgb[c], moved.extra[rect].rgb[c]) > floor) return true;
    }
  }
  return false;
}

console.log('\nrectangle    channel   shipped   firelight=0 (rel)      firelightground=0 (rel)');
for (const rect of ['groundL', 'groundR']) {
  for (let c = 0; c < 3; c++) {
    const s = shipped.extra[rect].rgb[c];
    const f = firelightOff.extra[rect].rgb[c];
    const g = groundOff.extra[rect].rgb[c];
    console.log(`${rect.padEnd(12)} ${CHANNELS[c]}         ${s.toFixed(3).padStart(7)}`
      + `   ${f.toFixed(3).padStart(7)} (${(rel(s, f) * 100).toFixed(1)}%)`
      + `         ${g.toFixed(3).padStart(7)} (${(rel(s, g) * 100).toFixed(1)}%)`);
  }
}
console.log(`\nlargest per-channel relative move: firelight=0 ${(maxRel(shipped, firelightOff)
  * 100).toFixed(1)}%, firelightground=0 ${(maxRel(shipped, groundOff) * 100).toFixed(1)}%`);

// (a) SANITY: the whole-model-off arm must move at least one channel.
if (!anyMoved(shipped, firelightOff, REL_FLOOR)) {
  fails.push('SANITY FAILED: ?firelight=0 (the whole emissive model, already proven live '
    + 'on the machine side) did not move any channel of either ground rectangle by more '
    + `than ${(REL_FLOOR * 100).toFixed(0)} per cent relative to shipped. This pose/`
    + 'rectangle pair cannot see the emissive at all right now, which means the arming '
    + 'check below cannot be trusted on it -- fix the sanity arm before trusting a PASS '
    + 'or a FAIL from the ground-specific flag.');
}

// (b) THE ARMING CHECK ITSELF.
if (!anyMoved(shipped, groundOff, REL_FLOOR)) {
  fails.push('REGISTERED BUT INERT: ?firelightground=0 does not move any channel of '
    + `either ground rectangle by more than ${(REL_FLOOR * 100).toFixed(0)} per cent `
    + 'relative to shipped. N19 (RN-2710, rendering.md 2.47) measured this flag moving '
    + "groundL/groundR's R channel by 6.7 and 10.6 per cent on its own build -- if this "
    + 'run reads inert, the ground term has regressed since then. See '
    + 'docs/controllers/build-tooling.md BT-345 for the full coordination account.');
}

if (fails.length > 0) {
  for (const m of fails) console.error(`firelightgroundarm: FAIL ${m}`);
  console.error(`firelightgroundarm: FAIL (${fails.length} problem(s))`);
  process.exit(1);
}
console.log('\nfirelightgroundarm: PASS -- ?firelightground=0 is armed (moves at least one '
  + "channel of one ground rectangle by more than the relative floor) and the sanity arm "
  + 'confirms the pose can see the emissive at all. This is the expected result: N19 '
  + '(rendering.md 2.47) already showed the ground term is wired, live and correctly '
  + 'shaped -- this check exists to catch a FUTURE regression, not to relitigate that '
  + 'finding.');
process.exit(0);
