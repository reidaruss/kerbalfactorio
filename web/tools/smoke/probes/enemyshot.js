// enemyshot.js: a PICTURE of the swarm arriving, framed so the thing being
// claimed is the thing in the frame (GP-87 to GP-93).
//
//   node web/tools/smoke/run.mjs --url=http://127.0.0.1:4247/ --sandbox=1 \
//     --combat=1 --evalfile=web/tools/smoke/probes/enemyshot.js \
//     --out=docs/screenshots/GP87_wave.png
//
// It stops the march at a RANGE rather than after a fixed time, because the
// swarm has to be far enough away to be a wave in the picture and close enough
// to be more than three pixels, and how long that takes depends on where the
// nest landed. It returns the range it stopped at so the caption is a
// measurement rather than a guess.
(async () => {
  const of = window.__of;
  if (!of) return { valid: false, why: 'no __of' };
  const sleep = (n) => of.run(n);
  const march = (n) => of.run(n, 60);
  await sleep(1.0);
  const yaw = of.world().observer.yawDeg;
  for (let i = 0; i < 10; i++) {
    of.build(3);
    await sleep(0.08);
    of.look(yaw + i * 21, -24);
    await sleep(0.18);
    of.input.tape([{ hold: 4, actions: ['use'] }, { hold: 8, keys: [] }]);
    await sleep(0.32);
  }
  let waves = 0;
  for (let k = 0; k < 30 && waves === 0; k++) {
    waves = of.enemies('advance', 3600).wavesDispatched;
  }
  if (waves === 0) return { valid: false, why: 'no wave in 30 minutes of sim' };

  // PUT THE PART DOWN. A smelter left in hand paints a translucent build ghost
  // across the middle of the frame, and the first capture was a photograph of
  // that ghost with the swarm behind it.
  of.hotbar(1);
  await sleep(0.3);
  const near = () => of.enemies('near', 1)[0];
  let d = near().distM;
  // TWO PHASES, because one is not enough: a 10 s slice covers 60 m at the
  // catalogue speed, so a single coarse loop aiming for 45 m overshoots
  // straight past it and photographs a swarm already inside the base.
  for (let k = 0; k < 40 && d > 160; k++) { await march(10); d = near().distM; }
  for (let k = 0; k < 60 && d > 16; k++) { await march(1.5); d = near().distM; }
  // The solved aim frame, exactly as probes/enemies.js derives it: two looks
  // give the horizontal basis and their cross product gives the up, whose SIGN
  // is read off the radial rather than assumed.
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const unit = (a) => { const l = Math.hypot(...a) || 1; return a.map((v) => v / l); };
  const dirAt = async (y, p) => {
    of.look(y, p); await sleep(0.06);
    const a = of.aim();
    return [a.dir[0], a.dir[1], a.dir[2]];
  };
  const A = await dirAt(0, 0);
  const B = await dirAt(90, 0);
  const raw = unit([A[1] * B[2] - A[2] * B[1], A[2] * B[0] - A[0] * B[2],
    A[0] * B[1] - A[1] * B[0]]);
  const o = of.aim().origin;
  const UP = raw.map((v) => v * (dot(raw, unit(o)) > 0 ? 1 : -1));
  const t = near().pos;
  const v = [t[0] - o[0], t[1] - o[1], t[2] - o[2]];
  const h = Math.hypot(dot(v, A), dot(v, B));
  // Aimed a few degrees ABOVE the nearest body, so the wave behind it is in
  // frame rather than one creature filling it.
  of.look(Math.atan2(dot(v, B), dot(v, A)) * 180 / Math.PI,
          Math.atan2(dot(v, UP), h) * 180 / Math.PI + 3);
  await march(0.4);
  const e = of.enemies();
  return {
    valid: true, rangeM: +d.toFixed(1), live: e.swarm.live,
    waves: e.wavesDispatched, pool: e.ceilings.pool,
    nearest: near(),
  };
})()
