// BT-345 (INSTRUMENT 4). `?iblground=0`'S BLAST RADIUS, MEASURED, AND IT IS
// FAR LARGER THAN THE STANDING RECORD SAYS.
//
// THE STANDING RECORD (rendering.md 2.34.10 item 4, un-numbered near line
// 11047): "`?iblground=0` renders a BLACK MID-FIELD at `forestair`... The
// `crowns` rectangle comes back r=g=b=0.00 with `world` still at 85.26...
// [and] `hzBand` is bit-identical to the shipped arm." Read as: one small
// rectangle goes black, the rest of the frame is untouched, pre-existing,
// owned by nobody, worth "a small lane" to look at.
//
// **THAT UNDERSTATES IT BY AT LEAST AN ORDER OF MAGNITUDE, MEASURED ON THIS
// LANE'S OWN BUILD (base `origin/main` at `50daac5b`).** At `forestair`
// (the pose the finding was taken on), `?iblground=0` does not zero one
// rectangle: `box`, `crowns`, `under`, `shadowStep`, `treeIn`, `treeOut`,
// `treeInA/B`, `treeOutA/B` and `farband` all read EXACTLY r=g=b=0 (blackFrac
// 1.0), and `hzBand` -- claimed bit-identical -- is 79.8 per cent black,
// nowhere near the shipped frame. **At `forestfloor` (RN-352's ground-level
// calibration pose) the ENTIRE FRAME, sky included, reads exactly 0 --
// `world.blackFrac` 1.0 on all 1,440,000 pixels.** A saved PNG of that arm is
// a flat black rectangle with nothing in it at all.
//
// **THE MECHANISM IS ISOLATED TO POST-PROCESSING, SPECIFICALLY BLOOM, AND
// CROWNENV IS RULED OUT.** `?post=0` at `forestfloor` restores a normal frame
// (`box.blackFrac` 1.0 -> 0.057); of the five post sub-stages (ao, bloom,
// grade, aa, contact), disabling EACH ONE INDIVIDUALLY alongside
// `?iblground=0` showed only `?bloom=0` restores normalcy (blackFrac 1.0 ->
// 0.042); ao=0/grade=0/aa=0/contact=0 all stayed fully black. Separately, a
// live readback of `CrownEnv.ts`'s own state (`window.__ofTerrainArt
// .treeline().crownEnv`) under `?iblground=0` shows `applied`/`appliedLive`
// both reading their normal sky-view-derived value (~0.58 at `forestair`,
// matching the un-flagged expectation), so the crown's OWN environment/
// envMapIntensity path is untouched -- this is NOT the CrownEnv mechanism
// 2.35.9's own item 1 might suggest at first read. `?ibldiag=noenv` (an
// existing, different flag that outright nulls `scene.environment`) does NOT
// reproduce the blackout either, so "losing the environment texture" in
// general is also ruled out. The defect is specific to the `iblGroundOn` /
// `setGroundMode` gate's own code path, most likely a render-target
// interaction between the ground-capture path (`SkyIbl`/
// `Renderer.environmentFrom`) and the bloom mip chain (`BloomGlsl.ts`,
// `PostStack.ts`) -- routed to rendering as a NAMED hypothesis, not fixed
// here: this is GPU-object-identity territory a scripted probe cannot
// resolve without a live debugger.
//
// THIS LANE'S JOB IS THE INSTRUMENT, NOT THE FIX. BT-345's brief allows
// "diagnose the diagnostic... OR rename/document it to what it does, with an
// outcome readback" for a pre-existing defect owned by nobody. This script IS
// that outcome readback: it measures the flag's actual blast radius against a
// stated ceiling appropriate to what the flag's NAME claims (an isolator for
// one ground-bounce term, not a kill switch for the whole frame), and FAILS
// LOUD -- which it does today, honestly -- rather than letting the old
// "one rectangle, pre-existing, owned by nobody" framing quietly undersell a
// defect that in fact blacks out an entire ground-level frame including the
// sky.
//
//   node tools/smoke/iblgroundarm.mjs --url=http://127.0.0.1:<port>/
//
// Exit 0: the flag's blast radius stays under BLAST_CEILING at both poses
//   (i.e. this has been fixed, or the defect never regresses past its
//   current, already-severe, state -- see the header for why this cannot
//   currently pass).
// Exit 1: `world.blackFrac` grows by more than BLAST_CEILING under
//   `?iblground=0` at either pose.

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RUN = path.join(HERE, 'run.mjs');
const PROBE = path.join(HERE, 'probes', 'artframe.js');

// A ground-bounce isolator should move a small, physically-plausible share of
// the frame, not the whole thing. 5 percentage points of NEWLY-black pixels is
// already generous headroom for a term this narrow; the measured defect (65
// to 100 points) is nowhere close to this ceiling, which is the point.
const BLAST_CEILING = 0.05;

const argv = new Map(process.argv.slice(2)
  .map((a) => { const i = a.indexOf('='); return [a.slice(0, i), a.slice(i + 1)]; }));
const url = argv.get('--url') ?? 'http://127.0.0.1:5550/';

function once(shot, scenario, sandbox, flags) {
  const args = [RUN, `--url=${url}`, `--scenario=${scenario}`,
    '--width=1600', '--height=900', `--evalfile=${PROBE}`,
    `--evalargs={"shot":"${shot}"}`, ...(sandbox ? ['--sandbox=1'] : []), ...flags];
  const r = spawnSync(process.execPath, args, { encoding: 'utf8', maxBuffer: 1 << 28 });
  try { return JSON.parse(r.stdout).eval; } catch {
    return { valid: false, why: `no json (exit ${r.status})`,
      stderr: (r.stderr ?? '').slice(-400) };
  }
}

const POSES = [
  { shot: 'forestair', scenario: 'surface', sandbox: false },
  { shot: 'forestfloor', scenario: 'walk', sandbox: true },
];

const fails = [];
console.log('iblgroundarm: blast-radius check, two poses, shipped vs ?iblground=0\n');
console.log('pose            shipped world.blackFrac   iblground=0 world.blackFrac   delta');

for (const p of POSES) {
  const shipped = once(p.shot, p.scenario, p.sandbox, []);
  const groundOff = once(p.shot, p.scenario, p.sandbox, ['--iblground=0']);
  if (!shipped.valid || !shipped.world || !groundOff.valid || !groundOff.world) {
    fails.push(`${p.shot}: one arm did not produce a world stat`
      + ` (shipped valid=${shipped.valid}, iblground=0 valid=${groundOff.valid})`);
    continue;
  }
  const a = shipped.world.blackFrac;
  const b = groundOff.world.blackFrac;
  const delta = b - a;
  console.log(`${p.shot.padEnd(14)} ${a.toFixed(4).padStart(20)}`
    + `   ${b.toFixed(4).padStart(20)}          ${delta >= 0 ? '+' : ''}${delta.toFixed(4)}`);
  if (delta > BLAST_CEILING) {
    fails.push(`${p.shot}: ?iblground=0 newly blacks out ${(delta * 100).toFixed(1)} per cent`
      + ` of the frame (world.blackFrac ${a.toFixed(4)} -> ${b.toFixed(4)}), above the`
      + ` ${(BLAST_CEILING * 100).toFixed(0)} per cent ceiling appropriate to what this flag's`
      + ` name claims (a ground-bounce isolator, not a frame-wide kill switch). See this`
      + ` file's header and rendering.md's BT-345 addendum for the isolation to bloom.`);
  }
}

if (fails.length > 0) {
  for (const m of fails) console.error(`iblgroundarm: FAIL ${m}`);
  console.error(`iblgroundarm: FAIL (${fails.length} problem(s)) -- this is the CURRENT,`
    + ' pre-existing state, named rather than fixed; see this file\'s header.');
  process.exit(1);
}
console.log('\niblgroundarm: PASS -- ?iblground=0 stays within its stated blast radius at both'
  + ' poses.');
process.exit(0);
