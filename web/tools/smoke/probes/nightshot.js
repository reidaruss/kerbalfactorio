// nightshot.js: HOW DARK IS THE NIGHT, as numbers plus a frame. (PH-86.)
//
//   node tools/smoke/run.mjs --url=... --debug=1 \
//     --evalfile=tools/smoke/probes/nightshot.js \
//     --evalargs='{"phase":"night"}' --out=docs/screenshots/PH86_night.png
//
// With a 60-minute cycle the night is ~30 minutes long and Reid will actually
// PLAY in it, which nobody ever did under a pinned sun. This probe puts the sun
// at a named phase RELATIVE TO THIS SITE'S OWN NOON (solved, not typed, per
// RN-13 and the local-noon convention the spawn survey used), settles, and
// reports the presented frame's luminance so "unplayably black" versus "moody
// but playable" is a measured verdict rather than a taste.
//
// phase: 'noon' | 'dusk' (elevation just under 0) | 'night' (deep, noon+0.5)
// lamp:  1 to toggle the headlamp on before measuring (the shipped mitigation).
//
// The tile grid is 16x9 (~100 px tiles at 1600x900): coarse enough to be a
// stable mean, fine enough that a lit crosshair target region reads apart from
// the sky. `of.stats().sky.elevationDot` is the instrument, never
// `__ofPost.state().sun`, which freezes below the horizon (INSTRUMENTS.md).
(async () => {
  const of = window.__of;
  const phase = OF_ARGS.phase ?? 'night';
  const fails = [];
  const check = (n, ok, d) => { if (!ok) fails.push(d === undefined ? n : `${n}: ${d}`); };

  // This site's own noon, solved by sweep exactly as groundshot.js does.
  let bestT = 0; let bestE = -Infinity;
  for (let i = 0; i < 720; ++i) {
    of.setTime(i / 720);
    const e = of.stats().sky.elevationDot;
    if (e > bestE) { bestE = e; bestT = i / 720; }
  }
  // Dusk: walk forward from noon until the elevation first crosses zero.
  let duskT = bestT;
  for (let i = 1; i < 360; ++i) {
    of.setTime(bestT + i / 720);
    if (of.stats().sky.elevationDot < 0) { duskT = bestT + i / 720; break; }
  }
  const t = phase === 'noon' ? bestT : phase === 'dusk' ? duskT : bestT + 0.5;
  of.setTime(t);
  if (OF_ARGS.lamp === 1 && of.stats().lamp.on !== true) of.input.press('lamp', 4);
  await of.run(2);
  of.setTime(t); // re-pin: the run above ate sim time (RN-13).
  await of.settle(10);

  const s = of.stats();
  const h = of.framehash(16, 9);
  const tiles = h.tiles;
  const mean = tiles.reduce((a, b) => a + b, 0) / tiles.length;
  // The GROUND band: the bottom four rows of the FRAME, where the player is
  // looking when walking. The sky's own luminance must not rescue a black
  // ground. `readPixels` is BOTTOM-LEFT origin (Loop.frameHash), so tile row 0
  // is the bottom of the screen: the ground band is rows 0..3, NOT the tail of
  // the array. The first version sliced the tail and measured the SKY, reported
  // "ground 0.17/255" for a frame whose ground visibly read ~34, and only the
  // screenshot caught it (INSTRUMENTS.md: the number and the picture must both
  // be looked at, and when they disagree the question is which is downstream
  // of the claim).
  const ground = tiles.slice(0, 16 * 4);
  const gMean = ground.reduce((a, b) => a + b, 0) / ground.length;
  const gMax = Math.max(...ground);

  check('the phase landed where it was aimed', Math.abs(of.stats().sky.sunT - t) < 2 / 3600,
        `${of.stats().sky.sunT} vs ${t}`);
  if (phase === 'noon') check('noon is lit', s.sky.elevationDot > 0.3, `${s.sky.elevationDot}`);
  if (phase !== 'noon') check('the sun is genuinely down', s.sky.elevationDot < 0,
        `${s.sky.elevationDot}`);

  return {
    valid: true, pass: fails.length === 0, fails, phase, t,
    noonT: bestT, duskT,
    elevationDot: s.sky.elevationDot, daylight: s.sky.daylight,
    lamp: s.lamp, litPct: h.litPct,
    meanLuma: Math.round(mean * 100) / 100,
    groundMeanLuma: Math.round(gMean * 100) / 100,
    groundMaxLuma: Math.round(gMax * 100) / 100,
    tiles16x9: tiles,
  };
})()
