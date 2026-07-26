// Capture the exact frame N ticks after a teleport, as a data URL.
//
// run.mjs's own --out screenshot happens after settle(), which by design waits
// for the world to stop changing, so it can never photograph a transition. This
// grabs the canvas inside the same task as the render, which is the only moment
// the drawing buffer is still readable without preserveDrawingBuffer.
//
//   node tools/smoke/run.mjs --scenario=surface --fade=0 --settle=2 \
//     --evalfile=tools/smoke/probes/popshot.js --evalargs='{"at":6}'
//
// Pipe the returned .png through tools/smoke/writeshot.mjs to get a file.
(async () => {
  const of = window.__of;
  const at = OF_ARGS.at ?? 6;
  const tp = OF_ARGS.teleport ?? [0.35, 0.35, 40];
  const t0 = of.world();
  await of.settle(10);
  of.teleport(t0.observer.latDeg + tp[0], t0.observer.lonDeg + tp[1], tp[2]);
  // Step until the resident set actually starts changing, THEN advance `at`
  // more. A fixed frame count photographs whatever the worker round trip
  // happened to make of that run, which is how the first version of this probe
  // produced two identical settled images.
  const r0 = of.world().chunks.resident;
  let ticks = 0;
  const step = async () => {
    await of.run(1 / 60, 60);
    // A worker postMessage needs a macrotask; Loop.run only yields every 8
    // frames, so a one-frame run never lets a chunk land without this.
    await new Promise((r) => { setTimeout(r, 0); });
    ticks++;
  };
  for (let i = 0; i < 600; ++i) {
    await step();
    const c = of.world().chunks;
    if (c.resident !== r0 || c.fading > 0) break;
  }
  for (let i = 0; i < at; ++i) await step();
  const f = of.framehash(100, 56);
  const w = of.world();
  const canvas = document.getElementById('of-canvas');
  return {
    ticksAfterTeleport: ticks,
    fadeSecs: of.config.fadeSecs,
    resident: w.chunks.resident,
    fading: w.chunks.fading,
    jumpPx: f.diff.jumpPx,
    litPct: f.litPct,
    png: canvas.toDataURL('image/png'),
  };
})()
