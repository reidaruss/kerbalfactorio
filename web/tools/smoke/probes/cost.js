// Frame cost of a feature, measured by A/B against the same settled framing.
//
// renderer.info and the Loop's own frameMs both stop at draw SUBMISSION, so
// neither sees GPU work. This times a long run of rendered frames end to end and
// forces a pipeline flush with one read-back at the finish, so the number
// includes the GPU. Run it twice with the feature on and off; the DIFFERENCE is
// the cost. Absolute values include the harness, the difference does not.
//
//   node tools/smoke/run.mjs --scenario=walk --shadows=0 \
//     --evalfile=tools/smoke/probes/cost.js --evalargs='{"frames":900}'
(async () => {
  const of = window.__of;
  const frames = OF_ARGS.frames ?? 900;
  if (OF_ARGS.pitch !== undefined) of.look(OF_ARGS.yaw ?? 0, OF_ARGS.pitch);
  let spin = 0;
  while (!of.world().chunks.converged && spin++ < 120) await of.run(0.25);
  await of.run(0.5);
  const t0 = of.world().tick;
  // Warm the caches and let the driver settle before the timed window.
  await of.run(120 / 60, 60);
  const start = performance.now();
  await of.run(frames / 60, 60);
  // One read-back to flush the queue, so the GPU is genuinely finished.
  const f = of.framehash(8, 8);
  const wall = performance.now() - start;
  const w = of.world();
  const st = of.stats();
  return {
    // DW-20: a run that rendered nothing is visible in its own output.
    ticksAdvanced: w.tick - t0,
    framesTimed: frames,
    converged: w.chunks.converged,
    resident: w.chunks.resident,
    litPct: f.litPct,
    wallMs: +wall.toFixed(1),
    msPerFrame: +(wall / frames).toFixed(4),
    shadows: st.shadow,
    atmosOn: of.config.atmosphere,
    starsOn: of.config.stars,
    draw: st.draw,
    passMs: st.passMs,
    vramEstimateMB: st.vramEstimateMB,
  };
})()
