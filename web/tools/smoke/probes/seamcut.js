// Near/far horizon agreement (ARCHITECTURE.md 3.2, W3c requirement).
//
// The same ground is drawn two ways: fine chunks in the near 1:1 scene and
// coarse chunks in the scaled far scene, with the split at nearDepthCutoff. If
// the two disagree, the boundary is a visible arc across the landscape. This
// renders the SAME settled framing at two different cutoffs and hands back the
// tile luminances, so the caller can diff them pixel-for-pixel.
(async () => {
  const of = window.__of;
  await of.settle(20);
  let spin = 0;
  while (!of.world().chunks.converged && spin++ < 80) { await of.run(0.25); }
  await of.run(0.5);
  const f = of.framehash(OF_ARGS.tilesX ?? 160, OF_ARGS.tilesY ?? 90);
  const w = of.world();
  return {
    cutoff: of.config.nearCutoff,
    regimeCutoff: w.regime,
    resident: w.chunks.resident,
    near: w.chunks.near,
    far: w.chunks.far,
    converged: w.chunks.converged,
    ticks: w.tick,
    litPct: f.litPct,
    tiles: f.tiles,
  };
})()
