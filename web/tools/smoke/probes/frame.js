// Frame a capture: aim, wait for convergence on the SYNTHETIC clock (rAF is not
// reliable headless), and report what was actually settled. Every W3 golden goes
// through this, so a screenshot cannot race streaming or a cross-dissolve.
//
//   node tools/smoke/run.mjs --scenario=space \
//        --evalfile=tools/smoke/probes/frame.js --evalargs='{"yaw":30,"pitch":-18}'
(async () => {
  const of = window.__of;
  if (OF_ARGS.teleport) of.teleport(OF_ARGS.teleport[0], OF_ARGS.teleport[1], OF_ARGS.teleport[2]);
  if (OF_ARGS.yaw !== undefined || OF_ARGS.pitch !== undefined) {
    of.look(OF_ARGS.yaw ?? 0, OF_ARGS.pitch ?? 0);
  }
  if (OF_ARGS.sunT !== undefined) of.setTime(OF_ARGS.sunT);
  const t0 = of.world().tick;
  let spin = 0;
  while (!of.world().chunks.converged && spin++ < 120) await of.run(0.25);
  await of.run(1.0);
  const f = OF_ARGS.tiles ? of.framehash(OF_ARGS.tiles[0], OF_ARGS.tiles[1]) : null;
  const w = of.world();
  const st = of.stats();
  return {
    ticksAdvanced: w.tick - t0,
    converged: w.chunks.converged,
    resident: w.chunks.resident,
    near: w.chunks.near,
    far: w.chunks.far,
    fading: w.chunks.fading,
    altM: +w.observer.altM.toFixed(1),
    yawDeg: +w.observer.yawDeg.toFixed(2),
    pitchDeg: +w.observer.pitchDeg.toFixed(2),
    regime: w.regime,
    sky: st.sky,
    shadow: st.shadow,
    draw: st.draw,
    frameMs: st.frameMs,
    passMs: st.passMs,
    vramEstimateMB: st.vramEstimateMB,
    tiles: f ? f.tiles : undefined,
    litPct: f ? f.litPct : undefined,
  };
})()
