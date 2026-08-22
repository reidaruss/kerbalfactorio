// RN-2590. WHAT THE CROWN BAKE ACTUALLY WROTE, arm by arm, one run per arm.
//
// WHY THIS IS NOT A PIXEL PROBE. `crownNormals` rewrites a normal ATTRIBUTE at
// registration. There is no uniform, so RN-2268's remedy for "a flag that never
// reaches the shader reports the default" does not apply directly: nothing in
// the frame says which construction ran. `TerrainArtHandle.treeline()` therefore
// publishes `crownNormal`, which is what the bake WROTE (`meanUp`,
// `minAbsOutOfPlane`, `minAzimuthOut`, `downVerts`, `parts`, `verts`, `path`)
// beside what was
// ASKED FOR (`ask`). This script reads both and asserts the pair.
//
// THE THREE THINGS IT PROVES, and each is a separate defect from 2.38.1a:
//
//   downVerts         the SIGN TEAR's own signature: the number of baked vertex
//                     normals with a NEGATIVE y, i.e. lit as if facing the
//                     ground. The pre-lane path bakes 3 of 24, one per tree,
//                     on the 90-degree-yawed quad's own top edge. The
//                     crown path must bake 0, and it must bake 0 BY
//                     CONSTRUCTION rather than by a tuned epsilon.
//   minAzimuthOut     the COPLANARITY measure, and it is taken on the normal's
//                     HORIZONTAL part alone. The pre-lane path reads 0.0000 at
//                     all 24 vertices: every normal lies in its own card's
//                     plane. `?crowncard=c` must raise it, and it must do so
//                     independently of `crownflank`, which is why the absolute
//                     projection (`minAbsOutOfPlane`, also printed) is not the
//                     measure asserted on: a normal pointing straight UP is
//                     also in the card plane, so raising `meanUp` drives the
//                     absolute measure toward zero while genuinely fixing the
//                     aerial `N . V`.
//   meanUp            the ANCHOR's effect: dropping the dome anchor below the
//                     crown base raises the rim's up-component from exactly 0
//                     to cos(crownflank), so the mean over the part rises
//                     monotonically as `crownflank` falls.
//
// A NON-VACUITY GATE RATHER THAN A PRINTER. NUMBERS' "a probe that prints and
// never asserts passes forever" is this file's whole reason for exiting
// nonzero: it fails if an arm's readback does not match its ask, if the
// pre-lane arm does not show the tear, or if any two arms are IDENTICAL, which
// is what a silently-dropped flag looks like.
//
//   node tools/smoke/rn2590norm.mjs --url=http://127.0.0.1:5590/
//   node tools/smoke/rn2590norm.mjs --url=http://127.0.0.1:5590/ --shot=forestairnoon
//
// EVERY FLAG NEEDS AN `=`; the parser splits on the first one, inherited from
// the sibling sweeps and kept identical to them on purpose.

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RUN = path.join(HERE, 'run.mjs');
const PROBE = path.join(HERE, 'probes', 'artframe.js');

const argv = new Map(process.argv.slice(2)
  .map((a) => { const i = a.indexOf('='); return [a.slice(0, i), a.slice(i + 1)]; }));
const url = argv.get('--url') ?? 'http://127.0.0.1:5590/';
const shot = argv.get('--shot') ?? 'forestairnoon';

// THE ARMS. `shipped` first so every later row has something to differ from.
const ARMS = [
  ['shipped', []],
  ['prelane  (crownnormal=0)', ['--crownnormal=0']],
  ['signOnly (flank=90,card=0)', ['--crownflank=90', '--crowncard=0']],
  ['flank90  (card shipped)', ['--crownflank=90']],
  ['card0    (flank shipped)', ['--crowncard=0']],
  ['authored (foliagenormal=0)', ['--foliagenormal=0']],
];

function once(flags) {
  const args = [RUN, `--url=${url}`, '--scenario=surface',
    '--width=1600', '--height=900', `--evalfile=${PROBE}`,
    `--evalargs=${JSON.stringify({ shot })}`,
    '--prophaze=0', '--terrainhaze=0', '--terrainpaint=1', ...flags];
  const r = spawnSync(process.execPath, args, { encoding: 'utf8', maxBuffer: 1 << 28 });
  try { return JSON.parse(r.stdout).eval; } catch {
    return { valid: false, why: `no json (exit ${r.status})`,
      stderr: (r.stderr ?? '').slice(-400) };
  }
}

const fails = [];
const rows = [];
for (const [label, flags] of ARMS) {
  const e = once(flags);
  const cn = ((e.treeline ?? {}).crownNormal) ?? null;
  if (!e.valid || cn === null) {
    fails.push(`${label}: no crownNormal readback (${e.why ?? 'absent'})`);
    continue;
  }
  const Y = ((e.extra ?? {}).crowns ?? {}).lin?.Y ?? null;
  rows.push({ label, cn, Y });
}

console.log(`\n--- RN-2590 THE CROWN BAKE, READ BACK (${shot},`
  + ' ?terrainpaint=1, un-hazed) ---');
console.log('arm                          parts verts    meanUp  minOutPlane'
  + '  minAzimOut  downVerts  path      ask(flank,card)   crownsY');
for (const r of rows) {
  const a = r.cn.ask ?? {};
  console.log(`${r.label.padEnd(28)} ${String(r.cn.parts).padStart(5)}`
    + ` ${String(r.cn.verts).padStart(5)}    ${r.cn.meanUp.toFixed(4)}`
    + `       ${r.cn.minAbsOutOfPlane.toFixed(4)}`
    + `      ${r.cn.minAzimuthOut.toFixed(4)}`
    + `        ${String(r.cn.downVerts).padStart(3)}  ${String(r.cn.path).padEnd(8)}`
    + `  ${a.on === false ? 'OFF' : `${a.flankDeg},${a.cardMix}`}`.padEnd(18)
    + `  ${r.Y === null ? '  --  ' : r.Y.toFixed(6)}`);
}

// ---------------------------------------------------------------------------
// THE ASSERTIONS
// ---------------------------------------------------------------------------
const by = (k) => rows.find((r) => r.label.startsWith(k));
const shipped = by('shipped'); const prelane = by('prelane');
const signOnly = by('signOnly'); const card0 = by('card0'); const flank90 = by('flank90');

if (!shipped || !prelane) fails.push('the shipped or pre-lane arm did not run');
else {
  // 1. THE PRE-LANE ARM MUST SHOW THE DEFECT. A control that cannot show the
  // thing it is a control for is not a control (NUMBERS: "a control that fails
  // to go red is a finding, not a nuisance").
  if (prelane.cn.path !== 'bend') {
    fails.push(`?crownnormal=0 did not route to bendNormals (path`
      + ` ${prelane.cn.path}). The control is not the control.`);
  }
  if (prelane.cn.downVerts === 0) {
    fails.push('the PRE-LANE arm bakes no downward normal, so the sign tear'
      + ' this lane exists to remove is not reproducing. Either the arm is'
      + ' vacuous or the defect moved.');
  }
  if (prelane.cn.minAzimuthOut > 1e-4) {
    fails.push(`the PRE-LANE arm's normals are not in-plane`
      + ` (minAzimuthOut ${prelane.cn.minAzimuthOut}), so the coplanarity`
      + ' defect is not reproducing either.');
  }
  // 2. THE SHIPPED PATH MUST FIX BOTH, and neither by an epsilon.
  if (shipped.cn.path !== 'crown') {
    fails.push(`the shipped path is not the crown construction (path`
      + ` ${shipped.cn.path}).`);
  }
  if (shipped.cn.downVerts !== 0) {
    fails.push(`the SHIPPED path still bakes ${shipped.cn.downVerts} downward`
      + ' normals. The tie was not removed.');
  }
  if (shipped.cn.minAzimuthOut <= 1e-4) {
    fails.push('the SHIPPED path is still in-plane, so the coplanarity fix is'
      + ' not reaching the bake.');
  }
}
// 3. EACH SWITCH MUST MOVE THE BAKE. A registered parameter that does not move
// the picture is worse than a missing one (NUMBERS), and for a bake the honest
// test is that it moves what the bake WROTE.
for (const [a, b, what] of [[shipped, card0, '?crowncard='],
  [shipped, flank90, '?crownflank='], [shipped, signOnly, 'flank90+card0']]) {
  if (!a || !b) continue;
  const same = Math.abs(a.cn.meanUp - b.cn.meanUp) < 1e-6
    && Math.abs(a.cn.minAzimuthOut - b.cn.minAzimuthOut) < 1e-6;
  if (same) fails.push(`${what} bakes IDENTICAL normals to the shipped arm.`
    + ' The flag is not reaching the construction.');
}
if (signOnly && signOnly.cn.minAzimuthOut > 1e-4) {
  fails.push('the sign-only arm is not in-plane; `crowncard=0` is not zeroing'
    + ' the out-of-plane mix, so the two fixes are not separable after all.');
}
if (signOnly && signOnly.cn.downVerts !== 0) {
  fails.push('the sign-only arm still bakes a downward normal, so the sign fix'
    + ' is not the thing removing the tear.');
}

for (const f of fails) console.error(`FAIL: ${f}`);
console.log(`\nrn2590norm: ${fails.length === 0 ? 'clean' : `${fails.length} failure(s)`}`);
process.exit(fails.length === 0 ? 0 : 1);
