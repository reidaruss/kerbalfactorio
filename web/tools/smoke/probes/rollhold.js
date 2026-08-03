// rollhold.js: GP-298 / R73. THE DAMPER STOPS HIDING WHAT IT IS DAMPING.
//
//   node tools/smoke/run.mjs --sandbox=1 --settle=25 \
//        --evalfile=tools/smoke/probes/rollhold.js
//
// `levelWings` rewrites `right` every tick, so for months the one instrument
// that could have shown a 41.98 deg/s sim roll instability was being repaired
// before it was drawn. Nobody was hiding anything: the damper was doing its job
// and its job destroys the evidence. **An instrument that silently repairs its
// own input cannot report on it.**
//
// Physics fixed the instability (PH-165 to PH-169), so `holdRoll` now has
// nothing to do on the reference rocket, and it is NOT deletable, because an
// asymmetric rocket still develops a real 5.55 deg/s from real asymmetric
// thrust and drag. The function keeps its job for a different reason than the
// one written in its comment, and the comment now says so.
//
// WHAT THIS ASSERTS, and it is deliberately about the INSTRUMENT rather than
// about the flight: the reading exists, it is taken BEFORE the correction, and
// it is published whether or not a correction follows. A reading taken after
// the damper, or only when the damper acts, reproduces the concealment in a
// smaller form and would read exactly like a healthy vessel.
//
// NAMED FAILURE MODE: the two fields could be present and permanently zero,
// which is indistinguishable from a vessel flying perfectly straight. So the
// probe ROLLS THE VEHICLE ON PURPOSE and requires the reading to MOVE, then
// requires the damper to bring it back. Both directions, because a field that
// only ever grows and a field that only ever shrinks are different bugs.
(async () => {
  const of = window.__of;
  if (!of) return { valid: false, why: 'no __of' };
  const fails = [];
  const log = [];
  const check = (name, ok, detail) => {
    if (!ok) fails.push(detail === undefined ? name : `${name}: ${detail}`);
    return ok;
  };
  const sleep = (n) => of.run(n);
  const FM = () => of.flight('report');
  const F = () => of.flight('report').flight;

  await sleep(0.8);
  of.build(0);
  of.vab('enter');
  await sleep(0.4);
  const cat = of.vab('catalogue');
  of.vab('press', 'clear');
  await sleep(0.15);
  for (const pid of [0x0100, 0x0101, 0x0103]) {
    const i = cat.find((c) => c.id === pid)?.index ?? -1;
    if (i < 0) continue;
    of.vab('frame');
    of.vab('take', i);
    await sleep(0.12);
    const parts = of.vab('report').parts;
    if (parts.length === 0) { of.vab('place'); await sleep(0.12); continue; }
    let low = parts[0];
    for (const q of parts) if (q.origin[1] < low.origin[1]) low = q;
    const nodes = of.vab('nodes').filter((n) => n.parent === low.handle
      && n.onScreen && (n.kind === 'bottom' || n.kind === 'interstage'));
    if (nodes.length === 0) continue;
    of.vab('hover', nodes[0].ndc[0], nodes[0].ndc[1]);
    of.vab('place');
    await sleep(0.12);
  }
  of.vab('leave');
  await sleep(0.4);
  of.flight('rollout');
  await sleep(0.8);
  for (let i = 0; i < 16 && FM().distanceToVesselM > 10; ++i) {
    of.input.act(['forward'], 30);
    await sleep(0.6);
  }
  of.flight('board');
  await sleep(0.6);
  of.pause(true);
  await sleep(0.35);
  document.querySelector('#of-pause button[data-cheat="orbit"]')?.click();
  await sleep(1.5);
  of.pause(false);
  await sleep(1.5);
  check('fixture: aboard and in orbit', F().status === 'ORBIT' && FM().aboard,
        `status ${F().status}`);
  if (F().status !== 'ORBIT') return { valid: false, why: 'no orbit', fails };

  // THE ANTECEDENT. `levelWings` returns immediately with SAS off, so every
  // reading below would be a stale NaN and the whole probe would assert nothing
  // about a damper that was never running.
  check('stability assist is ON, so the damper is actually running',
        F().sas !== 'OFF', `sas ${F().sas}`);

  const f0 = F();
  check('the roll reading is PUBLISHED at all',
        'rollBeforeHoldDeg' in f0 && 'rollHeldDegS' in f0,
        `keys: ${Object.keys(f0).filter((k) => /roll/i.test(k)).join(', ')}`);
  log.push(`at rest: rollBeforeHold ${f0.rollBeforeHoldDeg}, held `
    + `${f0.rollHeldDegS} deg/s`);

  // ---- ROLL IT ON PURPOSE ------------------------------------------------
  // A field that is present and permanently zero reads exactly like a vessel
  // flying straight, so the reading has to be seen MOVING before its stillness
  // means anything.
  let peakBefore = 0;
  let peakHeld = 0;
  for (let k = 0; k < 25; ++k) {
    of.input.act(['rollLeft'], 3);
    await sleep(1 / 30);
    const f = F();
    if (Number.isFinite(f.rollBeforeHoldDeg)) {
      peakBefore = Math.max(peakBefore, Math.abs(f.rollBeforeHoldDeg));
    }
    peakHeld = Math.max(peakHeld, f.rollHeldDegS ?? 0);
  }
  log.push(`rolled: peak rollBeforeHold ${peakBefore.toFixed(3)} deg, peak `
    + `held ${peakHeld.toFixed(3)} deg/s`);
  check('THE READING MOVES when the vehicle is rolled', peakBefore > 1.0,
        `peak ${peakBefore.toFixed(4)} deg. A field that is present and always `
        + 'zero is indistinguishable from a vessel flying straight.');
  check('and the damper is SEEN working, rather than only inferred',
        peakHeld > 0, `peak held ${peakHeld.toFixed(4)} deg/s`);

  // ---- AND IT SETTLES ----------------------------------------------------
  // The other direction. A reading that only ever grows would pass the check
  // above on a damper that does nothing at all.
  for (let k = 0; k < 200; ++k) await sleep(1 / 60);
  const f2 = F();
  const settled = Math.abs(f2.rollBeforeHoldDeg);
  log.push(`settled: rollBeforeHold ${f2.rollBeforeHoldDeg}, held `
    + `${f2.rollHeldDegS} deg/s`);
  check('THE DAMPER BRINGS IT BACK, so the reading falls as well as rises',
        Number.isFinite(settled) && settled < peakBefore * 0.5,
        `peaked at ${peakBefore.toFixed(3)} deg and settled at `
        + `${settled.toFixed(3)}`);
  check('and with nothing left to do it reports doing nothing',
        (f2.rollHeldDegS ?? 0) < peakHeld,
        `held ${f2.rollHeldDegS} against a peak of ${peakHeld.toFixed(4)}`);

  return {
    valid: fails.length === 0,
    fails,
    log,
    atRestDeg: f0.rollBeforeHoldDeg,
    peakBeforeDeg: peakBefore,
    peakHeldDegS: peakHeld,
    settledDeg: f2.rollBeforeHoldDeg,
    settledHeldDegS: f2.rollHeldDegS,
    sas: f2.sas,
    note: 'the claim is about the INSTRUMENT, not the flight: the reading is '
      + 'taken before the correction and published whether or not one follows, '
      + 'because a damper that rewrites the field the navball draws was hiding '
      + 'a 41.98 deg/s sim instability for months',
  };
})()
