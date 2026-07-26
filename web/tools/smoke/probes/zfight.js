// ?scenario=zfight verdict. Sweeps the camera across the five-scale probe scene
// and reads back each pair's region every rendered frame (ARCHITECTURE.md
// section 3.3, DW-3, risk R3).
//
// Two assertions, both numeric:
//   bleedPct     per-frame percentage of a pair's pixels showing the BACK
//                surface. Correct depth ordering is 0. This is stronger than a
//                frame diff because it is unambiguous in a single frame.
//   maxDeltaPct  worst frame-to-frame change in that number over the sweep.
//                This is the frame-diff assertion, restricted to the regions
//                that can actually flicker.
//
//   node tools/smoke/run.mjs --scenario=zfight --evalfile=tools/smoke/probes/zfight.js
//   node tools/smoke/run.mjs --scenario=zfight --depth=log  ... (fallback path)
//   node tools/smoke/run.mjs --scenario=zfight --depth=plain ... (low tier)
(async () => {
  const of = window.__of;
  const frames = OF_ARGS.frames ?? 200;
  // A slow orbit of the probe scene. Static frames cannot reveal z-fighting:
  // the depth comparison is deterministic, so a still camera renders the same
  // wrong pixels every frame. Motion is what makes the fight visible.
  const tape = [];
  for (let i = 0; i < frames; ++i) {
    tape.push({ hold: 1, keys: [], dYaw: 0.0009, dPitch: (i % 2 === 0 ? 1 : -1) * 0.0004 });
  }
  of.input.tape(tape);
  await of.run(frames / 60, 60.1);
  const r = of.zprobe();
  const c = of.config;
  return {
    ...r,
    zSepRatio: c.zSepRatio,
    depthMode: of.world().depthMode,
    frameMs: of.stats().frameMs,
    draw: of.stats().draw.calls,
  };
})()
