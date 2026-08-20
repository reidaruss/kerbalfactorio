// Crack census. Run with ?clear=ff00ff and this counts the pixels where the
// void shows THROUGH the terrain (LoopFrameHash.countHoles), which is the only reliable
// way to separate a real LOD crack from a dark-shaded steep face. Optionally
// walks first, so the count covers a moving resident set and not one pose.
//
//   node tools/smoke/run.mjs --scenario=surface --clear=ff00ff --stitch=0 \
//        --evalfile=tools/smoke/probes/holes.js
(async () => {
  const of = window.__of;
  const secs = OF_ARGS.secs ?? 0;
  if (secs > 0) {
    of.input.tape([{ hold: Math.ceil(60 * secs) + 120, keys: OF_ARGS.keys ?? ['KeyW'] }]);
    await of.run(secs);
    of.input.tape([{ hold: 600, keys: [] }]);
    let spin = 0;
    while (!of.world().chunks.converged && spin++ < 60) await of.run(0.5);
  }
  const f = of.framehash();
  const w = of.world();
  return {
    stitch: of.stats().stitch,
    holePixels: f.holePixels,
    holePpm: Math.round((f.holePixels / (f.w * f.h)) * 1e6),
    viewport: [f.w, f.h],
    scenario: w.scenario,
    resident: w.chunks.resident,
    near: w.chunks.near,
    far: w.chunks.far,
    altM: +w.observer.altM.toFixed(1),
  };
})()
