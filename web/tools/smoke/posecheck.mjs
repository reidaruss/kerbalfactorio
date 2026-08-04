// CE-30: the rigid-pose algebra, checked headlessly.
//
// WHY THIS IS NOT A BROWSER PROBE. The bug it was written to catch is invisible
// to every magnitude check there is. `setPoseFromBasis` produced a perfectly
// UNIT quaternion that was the CONJUGATE of the one it promised, so |q| was
// 1 to 8.9e-16, every pose looked healthy, `transportPoint(A, A, p)` was still
// exactly the identity, and the only symptom was that a rotating carrier
// transported its rider the wrong way by an amount that looked like drift.
//
// The check that finds it is one line and it is a DIRECTION, not a size:
// rotating the local X axis by the pose must give back the parent X axis it was
// built from. Conjugated, that reads 1.9957 out of a possible 2.
//
//   node tools/smoke/posecheck.mjs
//
// Exit 0 on pass, 1 on failure. It runs the SHIPPING source, type-stripped,
// never a transcription of it: a second copy of this arithmetic in plain JS
// would be the two-authority failure inside the instrument meant to police it.

// TYPESCRIPT'S OWN TRANSPILER, not esbuild and not a bundler. vite 8 ships
// rolldown, so there is no esbuild in this tree at all, and `npx esbuild` would
// reach the network to fetch one, which is not a thing a check may do.
// `typescript` is already a direct dependency because `tsc --noEmit` is the
// typecheck gate, and `transpileModule` is type-stripping with no resolution
// step, which is exactly right here: FramePose.ts imports nothing at runtime.
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const webRoot = resolve(here, '..', '..');
const out = mkdtempSync(join(tmpdir(), 'of-pose-'));
const bundle = join(out, 'framepose.mjs');

const fails = [];
let checks = 0;
const check = (name, ok, detail) => {
  checks++;
  if (ok) return;
  fails.push(detail === undefined ? name : `${name}: ${detail}`);
};

try {
  const req = createRequire(join(webRoot, 'package.json'));
  const ts = req('typescript');
  const src = join(webRoot, 'src', 'world', 'FramePose.ts');
  // `FramePose.ts` deliberately has no runtime imports (its header says why),
  // so type-stripping one file is the whole build. If that ever stops being
  // true this throws on the missing specifier rather than silently testing a
  // stub, which is the failure mode this whole file exists to refuse.
  const js = ts.transpileModule(readFileSync(src, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    fileName: 'FramePose.ts',
  }).outputText;
  if (/^\s*import\s/m.test(js)) {
    throw new Error('FramePose.ts has gained a runtime import; this check '
      + 'transpiles one file and cannot resolve it. Bundle instead.');
  }
  writeFileSync(bundle, js);
  const P = await import(pathToFileURL(bundle).href);

  // A deterministic LCG, so a failure is reproducible and a fix is provable.
  let seed = 7;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const norm = (v) => { const l = Math.hypot(...v); return v.map((c) => c / l); };
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2],
                           a[0] * b[1] - a[1] * b[0]];

  let worstMag = 0, worstDir = 0, worstRound = 0, worstIdent = 0;
  const o = { x: 0, y: 0, z: 0 };
  for (let i = 0; i < 4000; ++i) {
    const X = norm([rnd() - 0.5, rnd() - 0.5, rnd() - 0.5]);
    let Y = [rnd() - 0.5, rnd() - 0.5, rnd() - 0.5];
    const d = Y[0] * X[0] + Y[1] * X[1] + Y[2] * X[2];
    Y = norm([Y[0] - X[0] * d, Y[1] - X[1] * d, Y[2] - X[2] * d]);
    const Z = cross(X, Y);
    const pose = P.newPose();
    P.setPoseFromBasis(pose, 1e6 * rnd(), 1e6 * rnd(), 1e6 * rnd(),
      X[0], X[1], X[2], Y[0], Y[1], Y[2], Z[0], Z[1], Z[2]);

    worstMag = Math.max(worstMag,
      Math.abs(Math.hypot(pose.qx, pose.qy, pose.qz, pose.qw) - 1));
    // THE ORIENTATION CHECK. Every one of the three axes, because a conjugate
    // is not the only wrong answer: a transposed pair of columns leaves two
    // axes right and one wrong.
    for (const [local, want] of [[[1, 0, 0], X], [[0, 1, 0], Y], [[0, 0, 1], Z]]) {
      P.rotate(pose, local[0], local[1], local[2], o);
      worstDir = Math.max(worstDir,
        Math.hypot(o.x - want[0], o.y - want[1], o.z - want[2]));
    }
    const p = [rnd() * 1e6, rnd() * 1e6, rnd() * 1e6];
    P.applyInv(pose, p[0], p[1], p[2], o);
    const back = { x: 0, y: 0, z: 0 };
    P.apply(pose, o.x, o.y, o.z, back);
    worstRound = Math.max(worstRound,
      Math.hypot(back.x - p[0], back.y - p[1], back.z - p[2]));
    P.transportPoint(pose, pose, p[0], p[1], p[2], o);
    worstIdent = Math.max(worstIdent,
      Math.hypot(o.x - p[0], o.y - p[1], o.z - p[2]));
  }

  check('the quaternion is a unit quaternion', worstMag < 1e-12, `${worstMag}`);
  check('and it maps LOCAL to PARENT, not the other way round',
    worstDir < 1e-12, `${worstDir} (a conjugate reads ~2)`);
  check('parent -> local -> parent round trips at 1e6 m',
    worstRound < 1e-6, `${worstRound} m`);
  // The property every ride tick leans on: a carrier that has not moved does
  // not move its rider. It has to hold as an IDENTITY, not as a tolerance,
  // because it runs 60 times a second and a bias would integrate.
  check('transport from a pose to itself is the identity',
    worstIdent < 1e-8, `${worstIdent} m`);

  // A full turn about an axis returns the same rotation (q or -q, which are the
  // same rotation) and the same origin.
  const a = P.newPose();
  P.setPoseFromBasis(a, 1e6, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, -1);
  const b = P.newPose();
  P.rotatePoseAboutOrigin(a, 0, 1, 0, Math.PI * 2, b);
  const dp = Math.hypot(b.px - a.px, b.py - a.py, b.pz - a.pz);
  const dq = Math.min(
    Math.hypot(b.qx - a.qx, b.qy - a.qy, b.qz - a.qz, b.qw - a.qw),
    Math.hypot(b.qx + a.qx, b.qy + a.qy, b.qz + a.qz, b.qw + a.qw));
  check('a full turn about an axis comes back to itself',
    dp < 1e-8 && dq < 1e-12, `dp ${dp} m, dq ${dq}`);

  // A QUARTER TURN MUST NOT. The negative control for the check above, which
  // would otherwise pass on a `rotatePoseAboutOrigin` that did nothing at all.
  const c = P.newPose();
  P.rotatePoseAboutOrigin(a, 0, 1, 0, Math.PI / 2, c);
  const dp90 = Math.hypot(c.px - a.px, c.py - a.py, c.pz - a.pz);
  check('and a quarter turn moves the origin by the chord, so the turn is real',
    Math.abs(dp90 - Math.SQRT2 * 1e6) < 1e-6, `${dp90} m, want ${Math.SQRT2 * 1e6}`);

  // A LEFT-HANDED BASIS MUST BE REFUSED, and this check exists because the
  // version of this file that shipped first COULD NOT EXHIBIT THE DEFECT: every
  // fixture above builds Z = X x Y, so all 4000 of them are right-handed by
  // construction, and the one real caller was writing Z = Y x X. The loop above
  // reported |q| - 1 < 1e-15 while the live station's frame carried a
  // quaternion of magnitude 0.790. GP-142, in the instrument rather than in
  // the subject.
  {
    const bad = P.newPose();
    let threw = false;
    try {
      P.setPoseFromBasis(bad, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, -1);
    } catch { threw = true; }
    check('a left-handed basis is refused rather than silently scaled', threw,
      `|q| would have been ${Math.hypot(bad.qx, bad.qy, bad.qz, bad.qw)}`);
    // And the mirror: the SAME axes made right-handed must be accepted, or the
    // refusal is just a function that always throws.
    let ok = true;
    try { P.setPoseFromBasis(bad, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1); } catch { ok = false; }
    check('and the right-handed version of the same axes is accepted', ok);
  }

  // ---------------------------------------------------------------------
  // CE-82. composePose / invertPose, checked as IDENTITIES over the same
  // 4,000 random poses rather than as arithmetic.
  //
  // The defining property is the only thing any caller wants and it is the
  // only thing that cannot be satisfied by transcribing one sign error into
  // both functions:
  //     apply(compose(a, b), x) === apply(a, apply(b, x))
  // A quaternion product with the operands the wrong way round satisfies
  // |q| = 1, satisfies compose(a, identity) === a, and fails this.
  // ---------------------------------------------------------------------
  {
    let worstComp = 0, worstInv = 0, worstRT = 0, worstOrder = 0;
    const A = P.newPose(); const B = P.newPose(); const AB = P.newPose();
    const BA = P.newPose(); const I = P.newPose();
    const via = { x: 0, y: 0, z: 0 };
    const direct = { x: 0, y: 0, z: 0 };
    seed = 11;
    const basis = (out) => {
      const X = norm([rnd() - 0.5, rnd() - 0.5, rnd() - 0.5]);
      let Y = [rnd() - 0.5, rnd() - 0.5, rnd() - 0.5];
      const d = Y[0] * X[0] + Y[1] * X[1] + Y[2] * X[2];
      Y = norm([Y[0] - X[0] * d, Y[1] - X[1] * d, Y[2] - X[2] * d]);
      const Z = cross(X, Y);
      P.setPoseFromBasis(out, 1e6 * (rnd() - 0.5), 1e6 * (rnd() - 0.5),
        1e6 * (rnd() - 0.5), X[0], X[1], X[2], Y[0], Y[1], Y[2], Z[0], Z[1], Z[2]);
    };
    for (let i = 0; i < 4000; ++i) {
      basis(A); basis(B);
      P.composePose(A, B, AB);
      const x = [rnd() * 1e4, rnd() * 1e4, rnd() * 1e4];
      // apply(A . B, x) vs apply(A, apply(B, x))
      P.apply(AB, x[0], x[1], x[2], direct);
      P.apply(B, x[0], x[1], x[2], via);
      P.apply(A, via.x, via.y, via.z, o);
      worstComp = Math.max(worstComp,
        Math.hypot(direct.x - o.x, direct.y - o.y, direct.z - o.z));
      // A . A^-1 is the identity pose.
      P.invertPose(A, I);
      P.composePose(A, I, BA);
      worstInv = Math.max(worstInv, Math.hypot(BA.px, BA.py, BA.pz)
        + Math.abs(Math.abs(BA.qw) - 1));
      // invert round trip on a point: applyInv is the existing authority.
      P.apply(I, x[0], x[1], x[2], via);
      P.applyInv(A, x[0], x[1], x[2], direct);
      worstRT = Math.max(worstRT,
        Math.hypot(via.x - direct.x, via.y - direct.y, via.z - direct.z));
      // ORDER MATTERS, and this is the negative control for the first check:
      // a `composePose` that ignored one operand, or that multiplied the
      // quaternions the other way round, would satisfy the identity above on
      // a symmetric fixture. B . A must differ from A . B.
      P.composePose(B, A, BA);
      worstOrder = Math.max(worstOrder,
        Math.hypot(AB.px - BA.px, AB.py - BA.py, AB.pz - BA.pz));
    }
    check('compose(a, b) applied is apply(a, apply(b, .))',
      worstComp < 1e-6, `${worstComp} m`);
    check('a . a^-1 is the identity pose', worstInv < 1e-8, `${worstInv}`);
    check('invert(a) applied is applyInv(a, .)', worstRT < 1e-6, `${worstRT} m`);
    // The refusing case, in the same loop: if this is ~0 the composition is
    // not composing, and the three checks above are all vacuously true.
    check('and composition does NOT commute, so the order is real',
      worstOrder > 1e3, `${worstOrder} m, want a large disagreement`);
    // ALIASING. `out` may be neither operand: the translation is read after
    // the rotation is written. Stated in the doc comment, so it is checked.
    basis(A); basis(B);
    P.composePose(A, B, AB);
    const alias = P.copyPose(A, P.newPose());
    P.composePose(alias, B, alias);
    check('compose into one of its own operands still agrees',
      Math.hypot(alias.px - AB.px, alias.py - AB.py, alias.pz - AB.pz) < 1e-6
      && Math.abs(alias.qw - AB.qw) < 1e-12,
      `${Math.hypot(alias.px - AB.px, alias.py - AB.py, alias.pz - AB.pz)} m`);
  }

  // pointVelocity must be the finite difference the tick uses, exactly.
  const pa = P.newPose(); pa.px = 0;
  const pb = P.newPose(); pb.px = 600;
  P.pointVelocity(pa, pb, 1 / 60, 1234, 5678, 9012, o);
  check('pointVelocity is the transport difference over dt',
    Math.abs(o.x - 600 * 60) < 1e-9 && o.y === 0 && o.z === 0,
    `${o.x} ${o.y} ${o.z}`);
} catch (e) {
  fails.push(`threw: ${e instanceof Error ? e.stack : String(e)}`);
} finally {
  rmSync(out, { recursive: true, force: true });
}

const EXPECTED_CHECKS = 14;
if (checks !== EXPECTED_CHECKS) {
  fails.push(`ran ${checks} checks, expected ${EXPECTED_CHECKS}: the run did not `
    + 'reach the end, or a check was added without updating the count');
}
if (fails.length > 0) {
  console.error(`posecheck: FAIL (${fails.length})`);
  for (const f of fails) console.error('  ' + f);
  process.exit(1);
}
console.error(`posecheck: PASS (${checks} checks)`);
