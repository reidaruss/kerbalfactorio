// RN-1520 to RN-1525. THE RADIANCE THE ENVIRONMENT MAP IS BUILT FROM.
//
//   node tools/smoke/run.mjs --url=http://127.0.0.1:<port>/ --scenario=walk \
//     --width=1280 --height=720 --evalfile=tools/smoke/probes/ibldiag.js \
//     --ibldiag=1 --ibldisc=15
//
// WHY THIS PROBE EXISTS. RN-1415 raised the PMREM cube from 64 to 256 and the
// canonical machine box moved 20.52 -> 20.43 luma. RN-1470 then withdrew the
// stated cause. A raise in resolution can only pay for itself if the SOURCE has
// angular structure finer than the old resolution, and nothing in this repo has
// ever read that source: every other measurement of the sky is downstream of
// ACES and an 8-bit framebuffer, both of which flatten precisely the quantity
// under test. `__ofIblDiag.env()` reads the linear half-float cube.
//
// THE TWO CAPTURES ARE ONE RUN, ONE BINARY, ONE POSE AND ONE SUN, and they are
// one variable apart: `env(size, false)` is the shipped disc and
// `env(size, true)` multiplies its radiance by `?ibldisc=`. A page reload could
// not have guaranteed the same sun or the same streamed chunks, which is the
// same argument `__ofAtmos.setAerial` is a runtime toggle for.
//
// FAILURE MODES THIS FILE NAMES BEFORE IT MEASURES:
//   - a refused readback reads as a dark sky. `ok` and `nonZero` separate them
//     and both are asserted, not merely printed.
//   - `?ibldisc=` absent makes the boosted arm the IDENTITY, so a run without it
//     would report "the boost changed nothing" truthfully and uselessly. The
//     probe fails when `discFlagPresent` is false rather than reporting a null.
//   - `peakRatio` alone cannot tell a small bright sun from a bright horizon
//     band, so `brightFrac` is read beside it and both are reported.
(async (A) => {
  const of = window.__of;
  if (!of) return { valid: false, why: 'no __of' };
  const D = window.__ofIblDiag;
  if (!D) return { valid: false, why: 'no __ofIblDiag' };

  await of.settle(A.settle ?? 12);

  const state = D.state();
  const size = A.envsize ?? 32;
  const shipped = D.env(size, false);
  const boosted = D.env(size, true);
  const mats = D.materials();

  const round = (v) => (typeof v === 'number' && Number.isFinite(v)
    ? Math.round(v * 1e4) / 1e4 : v);
  const trim = (s) => Object.fromEntries(Object.entries(s)
    .map(([k, v]) => [k, Array.isArray(v) ? v.map(round) : round(v)]));

  const fails = [];
  // FAILURE MODE (a). A dark sky and an unwritten buffer are different reports.
  if (!shipped.ok) fails.push('shipped cube readback refused');
  if (!boosted.ok) fails.push('boosted cube readback refused');
  if (shipped.nonZero === 0) {
    fails.push(`shipped cube is all zero across ${shipped.texels} texels`);
  }
  // The arm must actually be armed, or its null is meaningless.
  if (!state.discFlagPresent) fails.push('run this with --ibldisc= or the boosted arm is the identity');
  if (state.discGain === 1 && state.discFlagPresent) {
    fails.push('ibldisc=1 is the identity; pass a gain to arm the arm');
  }
  // RN-1526, AND THIS IS THE ASSERTION THAT WOULD HAVE CAUGHT THE ONE DEFECT
  // THIS LANE SHIPPED. Under `?ibldiag=mirror` the per-part channel must be
  // OFF, because its injected GLSL assigns `roughnessFactor` outright and would
  // otherwise leave the override writing uniforms no fragment reads, with
  // `overrides` still cheerfully reporting 14. A counter that counts a CPU-side
  // write is not evidence that anything downstream read it.
  if (state.mode === 'mirror') {
    const mm = window.__ofMachineMat ? window.__ofMachineMat.state() : null;
    if (mm === null) fails.push('mirror arm with no __ofMachineMat to check the channel against');
    else if (mm.enabled) {
      fails.push('mirror arm is a NO-OP: the per-part channel is live and assigns roughnessFactor');
    } else if (!mm.mirrorForcedOff) {
      fails.push(`the channel is off for some other reason (mode ${mm.mode}), so the arm is not self-arming`);
    }
    if (state.overrides === 0) fails.push('mirror arm requested but no material was overridden');
  }
  // Suspect (1): the environment must be REACHING the machine materials, or
  // every reading about the environment's content is about a chain that is cut
  // upstream of the subject.
  if (mats.rows.length === 0) fails.push('no factory:machines: material found in the near scene');
  if (!mats.sceneEnvironment) fails.push('near scene has no environment assigned');
  for (const r of mats.rows) {
    if (r.ownEnvMap) fails.push(`${r.name} carries its own envMap, so scene.environment is ignored`);
    if (!(r.envMapIntensity > 0)) fails.push(`${r.name} envMapIntensity ${r.envMapIntensity}`);
  }
  // The whole point, stated as an assertion rather than left to the reader: if
  // the boost raises the peak and the shipped peak sits near the mean, then the
  // shipped environment has no bright source and the PMREM raise had nothing to
  // resolve. The probe does not assert WHICH way this comes out; it asserts the
  // two arms are distinguishable, because two identical arms mean the boost
  // never reached the capture and the experiment did not run.
  if (shipped.ok && boosted.ok && boosted.max === shipped.max) {
    fails.push('the disc boost did not change the cube maximum: the raise never reached the capture');
  }

  return {
    valid: true,
    pass: fails.length === 0,
    fails,
    state,
    shipped: trim(shipped),
    boosted: trim(boosted),
    // The headline comparison, computed here so the report states it rather
    // than leaving two tables for a reader to divide.
    delta: shipped.ok && boosted.ok ? {
      maxRatio: round(boosted.max / Math.max(shipped.max, 1e-9)),
      peakRatioShipped: round(shipped.peakRatio),
      peakRatioBoosted: round(boosted.peakRatio),
      meanRatio: round(boosted.mean / Math.max(shipped.mean, 1e-9)),
      brightFracShipped: round(shipped.brightFrac),
      brightFracBoosted: round(boosted.brightFrac),
    } : null,
    materials: mats,
    ibl: of.stats().ibl ?? null,
  };
})(typeof OF_ARGS === 'undefined' ? {} : OF_ARGS)
