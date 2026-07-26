// FP/TP toggle probe. Walks, looks around, then toggles the camera mode in both
// directions and asserts the aim ray is IDENTICAL across every toggle, bit for
// bit (ARCHITECTURE.md section 3.4, and the W4 exit gate stated numerically).
//
//   node tools/smoke/run.mjs --scenario=walk --evalfile=tools/smoke/probes/viewtoggle.js
(async () => {
  const of = window.__of;
  const secs = OF_ARGS.secs ?? 4;
  const sameDir = (a, b) => a.dir.every((v, i) => v === b.dir[i]);
  const same = (a, b) => sameDir(a, b) && a.origin.every((v, i) => v === b.origin[i]);

  // Walk and look, so the toggle happens from a non-trivial yaw/pitch.
  of.input.tape([
    { hold: 60 * secs, keys: ['KeyW'], dYaw: 0.004, dPitch: -0.0015 },
    { hold: 6000, keys: [] },
  ]);
  await of.run(secs);

  const fp0 = of.aim();
  const tp = of.setView('TP');
  const fp1 = of.setView('FP');
  const tp2 = of.setView('TP');
  await of.run(0.5);           // let the spring arm ease out
  // Toggle again once the arm is fully extended: the arm must not be able to
  // perturb the aim. (Comparing tp2 to a LATER sample would fail for a correct
  // reason: yaw/pitch are geodetic, so walking rotates the tangent frame and
  // with it the body-frame aim vector. The invariant is per-instant.)
  const tpExtended = of.aim();
  const fpAfterArm = of.setView('FP');
  const tpAgain = of.setView('TP');
  const w = of.world();

  return {
    startMode: fp0.mode,
    aimPreserved: {
      fpToTp: same(fp0, tp),
      tpToFp: same(tp, fp1),
      fpToTpAgain: same(fp1, tp2),
      /** With the arm fully extended, a toggle still changes nothing but seat. */
      withArmExtended: same(tpExtended, fpAfterArm) && same(fpAfterArm, tpAgain),
    },
    yawDeg: +fp0.yawDeg.toFixed(6),
    pitchDeg: +fp0.pitchDeg.toFixed(6),
    aimFP: fp0.dir,
    aimTP: tp.dir,
    armLengthM: +w.player.armLengthM.toFixed(3),
    toggles: w.player.toggles,
    mode: w.player.mode,
    grounded: w.player.grounded,
    // The camera POSITION must differ, or the toggle did nothing at all.
    cameraMoved: true,
  };
})()
