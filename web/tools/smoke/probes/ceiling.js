// ceiling.js (RN-2085 to RN-2099). THE FRAME-COST CEILING AT A NAMED WORLD POSE.
//
//   node tools/smoke/run.mjs --scenario=walk --lat=-19.85 --lon=-72.7853 --evalfile=tools/smoke/probes/ceiling.js --evalargs='{"yaw":300,"pitch":-26,"sunDot":0.7,"frames":600}'
//
// WHAT THIS IS FOR AND WHY `cost.js` WAS NOT ENOUGH. `cost.js` already times a
// long run of rendered frames end to end and flushes the pipeline with one
// read-back, which is the only honest way to get the GPU into the number: the
// Loop's own `frameMs` and `renderer.info` BOTH STOP AT DRAW SUBMISSION, so a
// frame that submits in 8 ms and takes 22 ms on the GPU reads as 8. Every
// published `frameMs` figure in this project is a submission time and none of
// them is a frame time. That distinction is the whole reason this file exists,
// so it reports BOTH and labels which is which, and the summary field is named
// `wallMsPerFrame` rather than anything that could be mistaken for `frameMs`.
//
// What this adds over `cost.js`:
//
//  1. THE POSE IS PART OF THE MEASUREMENT (INSTRUMENTS.md, "the scene is part
//     of the measurement"). `cost.js` takes a yaw and a pitch and inherits
//     whatever the scenario's spawn was. A ceiling study compares SITES, so
//     the teleport, the aim and the sun are arguments here and every one of
//     them is echoed back as MEASURED rather than as requested.
//  2. THE SUN IS PINNED BY ELEVATION AND THE MISS IS ASSERTED, `artframe.js`'s
//     rule: `setSunElev` scans phases and returns the CLOSEST, so an
//     unreachable target comes back as the site's maximum with no complaint.
//     `sunTol` defaults to 0.06 and a miss is a `fail`, not a footnote.
//  3. THE BACKEND IS IN THE REPORT. Under SwiftShader a frame cost is not a
//     frame cost, and the difference between a software raster and a real
//     D3D11 boot is invisible in every other field. `gpu` is echoed and the
//     probe REFUSES (fails) if it does not name a hardware backend, unless
//     `{"allowSoftware": true}` is passed deliberately.
//  4. A SECOND, HALF-AREA TIMED WINDOW IS NOT TAKEN HERE. Resolution is a
//     runner flag (`--width`/`--height`), so the fill-rate arm is a second
//     INVOCATION and not a second window inside one process: two windows in
//     one process share a warmed driver and a warmed cache and would make the
//     second arm look cheap for a reason that is not fill rate.
//
// THE ABLATION ARMS ARE URL FLAGS, NOT ARGUMENTS. `--shadows=0`, `--props=0`,
// `--atmos=0`, `--post=0` and the rest are already registered page params with
// documented "restores the behaviour immediately before the change" semantics
// (run.mjs's PAGE_PARAMS list). A breakdown is therefore a set of runs of THIS
// probe one flag apart, interleaved per WG-189, and this file deliberately owns
// no opinion about which flags a given sweep should set: it reports the ones
// the client says are in force (`armState`) so an arm cannot silently be the
// baseline. WG-189's own scar is the reason interleaving is not optional: the
// first two serial sweeps of `maxDepth` disagreed on the SIGN of the delta,
// because thermal and background drift lands entirely on whichever arm ran
// last.
//
// DW-20: a run that rendered nothing is visible in its own output
// (`ticksAdvanced`), and a run that never converged says so rather than
// timing a half-streamed world.
(async () => {
  const of = window.__of;
  const A = OF_ARGS;
  const frames = A.frames ?? 600;
  const warmFrames = A.warm ?? 120;
  const sunTol = A.sunTol ?? 0.06;
  const fails = [];

  if (A.lat !== undefined || A.lon !== undefined) {
    of.teleport(A.lat ?? 0, A.lon ?? 0, A.alt ?? 2);
  }
  if (A.yaw !== undefined || A.pitch !== undefined) {
    of.look(A.yaw ?? 0, A.pitch ?? 0);
  }

  // Settle the stream BEFORE the sun is pinned: `of.run` drifts the day clock
  // (RN-13), so a pin taken before a 30 s settle is not the pin that was timed.
  let spin = 0;
  while (!of.world().chunks.converged && spin++ < 200) await of.run(0.25);
  await of.run(1.0);

  let sunPin = null;
  if (A.sunDot !== undefined) {
    sunPin = of.setSunElev(A.sunDot);
    const got = mustNum(of.stats().sky, 'elevationDot', 'stats().sky');
    if (Math.abs(got - A.sunDot) > sunTol) {
      fails.push(`sun pin missed: asked ${A.sunDot}, got ${got.toFixed(4)}, `
        + `tolerance ${sunTol}. setSunElev returns the CLOSEST reachable phase, `
        + 'so this site probably never reaches that elevation.');
    }
  }

  const st0 = of.stats();
  const gpu = String(st0.gpu ?? '');
  const software = /swiftshader|llvmpipe|software/i.test(gpu);
  if (software && !A.allowSoftware) {
    fails.push(`backend is ${JSON.stringify(gpu)}, which is a software `
      + 'rasteriser. A frame cost measured there is not a frame cost. Pass '
      + '{"allowSoftware": true} if that is genuinely what is wanted.');
  }

  const t0 = of.world().tick;
  // Warm the shader cache, the geometry pool and the driver before the window.
  await of.run(warmFrames / 60, 60);

  const start = performance.now();
  await of.run(frames / 60, 60);
  // One read-back to flush the queue, so the GPU is genuinely finished before
  // the clock is read. Without it this times draw SUBMISSION again.
  const fh = of.framehash(8, 8);
  const wall = performance.now() - start;

  const w = of.world();
  const st = of.stats();
  const cfg = of.config ?? {};

  if (!w.chunks.converged) {
    fails.push(`chunks never converged in ${spin} spins; this timed a `
      + 'half-streamed world, not the pose.');
  }
  if (w.tick - t0 <= 0) {
    fails.push('ticksAdvanced is 0: nothing was simulated or rendered.');
  }

  return {
    valid: fails.length === 0,
    fail: fails.length ? fails.join(' | ') : undefined,
    fails,

    // ---- the ceiling number, GPU included -------------------------------
    wallMsPerFrame: +(wall / frames).toFixed(4),
    wallMs: +wall.toFixed(1),
    framesTimed: frames,
    warmFrames,
    // The same run's SUBMISSION-ONLY times, for the record and so the gap
    // between the two is visible rather than assumed.
    submitMs: st.frameMs,
    cpuMs: +st.cpuMs.toFixed(4),
    passMs: st.passMs,

    // ---- what was on screen ---------------------------------------------
    gpu,
    software,
    draw: st.draw,
    instances: st.instances,
    vramEstimateMB: st.vramEstimateMB,
    budget: st.budget,
    resident: w.chunks.resident,
    near: w.chunks.near,
    far: w.chunks.far,
    fading: w.chunks.fading,
    converged: w.chunks.converged,
    pool: st.pool,
    terrain: st.terrain,
    shadow: st.shadow,
    props: st.props,

    // ---- the pose, as MEASURED ------------------------------------------
    pose: {
      latDeg: A.lat, lonDeg: A.lon,
      altM: +w.observer.altM.toFixed(2),
      yawDeg: +w.observer.yawDeg.toFixed(2),
      pitchDeg: +w.observer.pitchDeg.toFixed(2),
      regime: w.regime,
    },
    sunDotAsked: A.sunDot,
    sunDotGot: st.sky.elevationDot,
    sunPin,
    litPct: fh.litPct,
    ticksAdvanced: w.tick - t0,
    settleSpins: spin,

    // ---- which arm this is, from the CLIENT and not from the argv --------
    armState: {
      shadows: cfg.shadows,
      atmosphere: cfg.atmosphere,
      stars: cfg.stars,
      props: cfg.props,
      quality: cfg.quality,
      maxDepth: cfg.maxDepth,
      post: st.post ?? undefined,
    },
  };
})()
