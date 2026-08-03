// RN-1016. What is ACTUALLY IN the night frame: an exposure ladder applied
// INSIDE the pipeline, not a gain applied to the PNG afterwards.
//
//   node tools/smoke/run.mjs --scenario=walk --sandbox=1 --body=cinder \
//     --url=http://127.0.0.1:4282/ \
//     --evalfile=tools/smoke/probes/nightexp.js \
//     --evalargs='{"lat":2,"lon":144,"pitch":-35,"sunDot":-0.45,"stops":[1.2,3,6,12,24]}'
//
// WHY THIS IS THE FIRST EXPERIMENT OF A NIGHT-EXPOSURE PASS, and why a gain on
// the captured image is not a substitute for it.
//
// The night ground occupies roughly the bottom 2 to 16 counts of an 8-bit
// output. Multiplying a CAPTURED PNG by 6 to look at it also multiplies its
// quantisation, so a lattice that appears under that treatment could be either
// a real dither in the render or the 8-bit steps of the capture. Those two have
// opposite consequences: the first is a defect an exposure pass would amplify,
// the second is headroom an exposure pass would RECOVER, because
// `CompositeGlsl` applies `uExposure` to a HALF-FLOAT scene target BEFORE the
// tone curve and the sRGB encode. Guessing which one it is decides the design.
//
// So the exposure is moved where the renderer applies it, through
// `of.setPostTune({exposure})`, one page, one uniform, everything else pinned.
//
// NAMED FAILURE MODES.
//  1. A LADDER WHOSE FIRST RUNG IS NOT THE SHIPPED VALUE has no anchor. The
//     shipped exposure is read from `of.post().tune` and asserted to be in the
//     ladder rather than assumed.
//  2. A SWEEP OVER A DEAD UNIFORM. Every rung's frame hash is published and a
//     ladder whose rungs all match is a failure, not a result.
//  3. THE GRADE IS NOT THE EXPOSURE. `lift`, `contrast`, `saturation` and
//     `vignette` all act AFTER the tone curve on display-referred values, so
//     they cannot be substituted for this and must not move during it. Their
//     values are published at every rung so a silent change is visible.
//  4. THE HEADLAMP. Directional, and it auto-enables at night (RN-153). Off,
//     via `of.lamp(false)`, because `?lamp=` is a dead parameter (RN-1011).
(async (A) => {
  const of = window.__of;
  if (!of) throw new Error('nightexp: no window.__of');
  if (typeof of.setPostTune !== 'function') throw new Error('nightexp: of.setPostTune is missing');
  if (typeof of.post !== 'function') throw new Error('nightexp: of.post is missing');

  const cv = document.querySelector('canvas');
  const walk = (el) => {
    for (const c of el.children) {
      if (c === cv) continue;
      if (c.contains(cv)) { walk(c); continue; }
      c.style.display = 'none';
    }
  };
  walk(document.body);

  of.teleport(A.lat, A.lon, A.alt ?? 2.0);
  await of.run(1.0);
  let spin = 0;
  while (!of.world().chunks.converged && spin++ < 240) await of.run(0.5);
  await of.run(1.0);
  if (typeof of.build === 'function') of.build(0);
  if (typeof of.propsVisible === 'function') of.propsVisible(false);
  of.lamp(false);
  await of.settle(4);
  if (of.stats().lamp.enabled !== false) throw new Error('nightexp: lamp still on');

  let aim = null;
  for (let i = 0; i < 120; i++) {
    aim = of.aim?.();
    if (aim && typeof aim.pitchDeg === 'number') break;
    await of.run(0.1);
  }
  if (aim === null) throw new Error('nightexp: no player');
  of.look(A.yaw ?? 0, A.pitch ?? -35);
  await of.run(0.4);
  const solve = of.setSunElev(A.sunDot ?? -0.45);
  await of.settle(30);
  if (Math.abs(solve.err) > (A.sunTol ?? 0.03)) {
    throw new Error(`nightexp: setSunElev missed by ${solve.err}`);
  }

  const post0 = of.post();
  const shippedExp = post0.tune.exposure;
  if (!(shippedExp > 0)) throw new Error(`nightexp: shipped exposure is ${shippedExp}`);
  const stops = A.stops ?? [shippedExp, 3, 6, 12, 24];
  if (!stops.some((s) => s === shippedExp)) {
    throw new Error(`nightexp: the ladder ${JSON.stringify(stops)} does not contain the shipped exposure ${shippedExp}; there is nothing to anchor it to`);
  }
  if (post0.flags && post0.flags.post === false) {
    throw new Error('nightexp: the post stack is OFF, so uExposure is not the exposure this frame uses (three own ACES at 1.0 is). Re-run without ?post=0');
  }

  const grab = async () => {
    await of.settle(A.settle ?? 20);
    const blob = await of.screenshot();
    const buf = new Uint8Array(await blob.arrayBuffer());
    let s = '';
    for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
    return `data:image/png;base64,${btoa(s)}`;
  };

  const shots = {};
  const rows = [];
  for (const e of stops) {
    const t = of.setPostTune({ exposure: e });
    if (t.exposure !== e) throw new Error(`nightexp: setPostTune left exposure ${t.exposure}, asked ${e}`);
    const key = `e${String(e).replace('.', 'p')}`;
    shots[key] = await grab();
    rows.push({
      exposure: e, key,
      hash: of.framehash().hash,
      // Failure mode 3: the rest of the grade, every rung, so a silent move is
      // visible rather than assumed absent.
      grade: {
        contrast: t.contrast, curveMix: t.curveMix, saturation: t.saturation,
        lift: t.lift, vignette: t.vignette,
      },
    });
  }
  of.setPostTune({ exposure: shippedExp });

  const hs = rows.map((r) => r.hash);
  if (new Set(hs).size === 1) {
    throw new Error(`nightexp: every rung produced hash ${hs[0]}; uExposure reached no pixel and this ladder is vacuous`);
  }
  const gradeMoved = rows.some((r) => JSON.stringify(r.grade) !== JSON.stringify(rows[0].grade));

  const amb = window.__ofAmbient ? window.__ofAmbient.report() : null;
  const w = of.world();
  return {
    valid: w.chunks.converged === true,
    site: { lat: A.lat, lon: A.lon, biome: w.biome ?? null },
    pose: { yaw: A.yaw ?? 0, pitch: A.pitch ?? -35, alt: A.alt ?? 2.0 },
    sun: {
      gotDot: +solve.gotDot.toFixed(4), err: +solve.err.toFixed(4),
      elevationDeg: +((Math.asin(Math.max(-1, Math.min(1, solve.gotDot))) * 180) / Math.PI).toFixed(2),
    },
    ambient: amb,
    shippedExposure: shippedExp,
    gradeMoved,
    rows,
    shots,
  };
})(OF_ARGS)
