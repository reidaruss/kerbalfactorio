// RN-1013. One settled frame at one stated pose, with the sun solved AGAINST
// THIS SITE and its miss published. Nothing else.
//
//   node tools/smoke/run.mjs --scenario=walk --sandbox=1 --url=... \
//     --evalfile=tools/smoke/probes/poseshot.js \
//     --evalargs='{"lat":2,"lon":144,"pitch":-35,"sunDot":0.45}'
//
// It exists because comparing BOOT FLAGS needs one frame per boot, and every
// probe in this directory that could take that frame also takes six others.
// The three things it will not let a caller get wrong are the three that have
// cost this domain whole passes: `?sundot=` is solved at the SPAWN and a probe
// that teleports keeps the phase and loses the elevation (RN-844), so the sun
// is set through `of.setSunElev` and a miss beyond tolerance THROWS; the build
// ghost washes the frame (RN-512), so it is disarmed unconditionally; and the
// UI is in the capture unless it is hidden.
//
// `lamp:false` turns the headlamp off through `of.lamp`, because `?lamp=` is a
// registered URL parameter that NOTHING in web/src reads (RN-1011).
(async (A) => {
  const of = window.__of;
  if (!of) throw new Error('poseshot: no window.__of');
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
  if (A.props !== true && typeof of.propsVisible === 'function') of.propsVisible(false);
  if (A.lamp === false) {
    of.lamp(false);
    await of.settle(4);
    if (of.stats().lamp.enabled !== false) throw new Error('poseshot: of.lamp(false) did not take');
  }

  let aim = null;
  for (let i = 0; i < 120; i++) {
    aim = of.aim?.();
    if (aim && typeof aim.pitchDeg === 'number') break;
    await of.run(0.1);
  }
  if (aim === null) throw new Error('poseshot: no player');
  of.look(A.yaw ?? 0, A.pitch ?? -20);
  await of.run(0.4);
  const solve = of.setSunElev(A.sunDot ?? 0.45);
  await of.settle(A.settle ?? 30);
  if (Math.abs(solve.err) > (A.sunTol ?? 0.03)) {
    throw new Error(`poseshot: setSunElev(${A.sunDot}) missed by ${solve.err}; this site cannot reach that elevation`);
  }

  const blob = await of.screenshot();
  const buf = new Uint8Array(await blob.arrayBuffer());
  let s = '';
  for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));

  const w = of.world();
  const st = of.stats();
  return {
    valid: w.chunks.converged === true,
    query: location.search,
    site: { lat: A.lat, lon: A.lon, biome: w.biome ?? null },
    pose: { yaw: A.yaw ?? 0, pitch: A.pitch ?? -20, alt: A.alt ?? 2.0 },
    sun: {
      gotDot: +solve.gotDot.toFixed(4), err: +solve.err.toFixed(4),
      elevationDeg: +((Math.asin(Math.max(-1, Math.min(1, solve.gotDot))) * 180) / Math.PI).toFixed(2),
    },
    draw: { calls: mustNum(st.draw, 'calls', 'stats.draw'), triangles: mustNum(st.draw, 'triangles', 'stats.draw'), programs: mustNum(st.draw, 'programs', 'stats.draw') },
    chunks: w.chunks,
    shots: { frame: `data:image/png;base64,${btoa(s)}` },
  };
})(OF_ARGS)
