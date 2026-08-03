// RN-1012. The bright dashes on the airless NIGHT ground: what draws them.
//
//   node tools/smoke/run.mjs --scenario=walk --sandbox=1 --body=cinder \
//     --url=http://127.0.0.1:4282/ \
//     --evalfile=tools/smoke/probes/nightspark.js \
//     --evalargs='{"lat":2,"lon":144,"pitch":-35,"sunDot":-0.45}'
//
// WHAT WAS SEEN. At sun elevation -26.6 degrees on Cinder, with the headlamp
// off and props off, the ground carries bright white dotted and dashed streaks
// running along terrain contours, plus speckled patches. On a body with no
// atmosphere, 26 degrees past the terminator, nothing should be bright.
//
// This is measured rather than guessed at, and the suspect list is written
// down BEFORE the sweep so the sweep cannot be read as confirming whichever
// arm happened to move:
//
//   1. THE SPECULAR LOBE (RN-731). It rides the BUMPED normal deliberately, so
//      it is the one term whose input can be wild at a grazing angle. Two
//      halves, sun and sky, isolable separately, which matters because they
//      fail differently: a sun lobe at night should be extinguished with the
//      sun, and a SKY lobe on an airless body should have no sky to reflect.
//   2. THE RELIEF BUMP itself, i.e. the normal rather than the lobe that reads
//      it. Separable because the bump also feeds nothing else at night.
//   3. THE STARFIELD drawn THROUGH the terrain, i.e. a depth failure rather
//      than a lighting one. Distinguishable because it would survive every
//      lighting flag and die with `?stars=0`.
//   4. SOMETHING ELSE, which is what the all-off arm is for.
//
// THE ALL-OFF ARM IS THE POSITIVE CONTROL AND IT IS NOT OPTIONAL. If the
// streaks survive with every named suspect off, none of them is the cause and
// the sweep's individual results are coincidences. A sweep with no such arm can
// only ever confirm.
//
// Every arm is one page and one uniform apart from every other, so the camera,
// the sun, the streamed chunks and the props cannot differ between them.
(async (A) => {
  const of = window.__of;
  const art = window.__ofTerrainArt;
  if (!of) throw new Error('nightspark: no window.__of');
  if (!art) throw new Error('nightspark: no __ofTerrainArt');
  if (typeof art.setSpec !== 'function') throw new Error('nightspark: __ofTerrainArt.setSpec is missing');

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
  if (of.stats().lamp.enabled !== false) throw new Error('nightspark: lamp still on');

  let aim = null;
  for (let i = 0; i < 120; i++) {
    aim = of.aim?.();
    if (aim && typeof aim.pitchDeg === 'number') break;
    await of.run(0.1);
  }
  if (aim === null) throw new Error('nightspark: no player');
  of.look(A.yaw ?? 0, A.pitch ?? -35);
  await of.run(0.4);
  const solve = of.setSunElev(A.sunDot ?? -0.45);
  await of.settle(30);
  if (Math.abs(solve.err) > (A.sunTol ?? 0.03)) {
    throw new Error(`nightspark: setSunElev missed by ${solve.err}; this site cannot reach that elevation`);
  }

  const specShipped = art.getSpec();
  const relShipped = art.getRelief();
  if (!(specShipped[0] > 0 || specShipped[1] > 0)) {
    throw new Error(`nightspark: the specular is already off (${JSON.stringify(specShipped)}); arm 1 would be vacuous`);
  }
  if (!(relShipped > 0)) throw new Error(`nightspark: the relief is already off; arm 2 would be vacuous`);

  const grab = async () => {
    await of.settle(A.settle ?? 20);
    const blob = await of.screenshot();
    const buf = new Uint8Array(await blob.arrayBuffer());
    let s = '';
    for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
    return `data:image/png;base64,${btoa(s)}`;
  };

  const shots = {};
  const states = [
    ['shipped', specShipped[0], specShipped[1], relShipped],
    ['shipped_repeat', specShipped[0], specShipped[1], relShipped],
    ['spec_sun_off', 0, specShipped[1], relShipped],
    ['spec_sky_off', specShipped[0], 0, relShipped],
    ['spec_off', 0, 0, relShipped],
    ['relief_off', specShipped[0], specShipped[1], 0],
    ['all_off', 0, 0, 0],
  ];
  const rows = [];
  for (const [name, sun, sky, rel] of states) {
    art.setSpec(sun, sky);
    art.setRelief(rel);
    const got = art.getSpec();
    if (got[0] !== sun || got[1] !== sky || art.getRelief() !== rel) {
      throw new Error(`nightspark: state ${name} did not take: spec ${JSON.stringify(got)} relief ${art.getRelief()}`);
    }
    shots[name] = await grab();
    rows.push({ name, specSun: sun, specSky: sky, relief: rel });
  }
  art.setSpec(specShipped[0], specShipped[1]);
  art.setRelief(relShipped);

  const amb = window.__ofAmbient ? window.__ofAmbient.report() : null;
  const w = of.world();
  const st = of.stats();
  return {
    valid: w.chunks.converged === true,
    site: { lat: A.lat, lon: A.lon, biome: w.biome ?? null },
    sun: {
      gotDot: +solve.gotDot.toFixed(4), err: +solve.err.toFixed(4),
      elevationDeg: +((Math.asin(Math.max(-1, Math.min(1, solve.gotDot))) * 180) / Math.PI).toFixed(2),
    },
    sky: st.sky ?? null,
    ambient: amb,
    shipped: { spec: specShipped, relief: relShipped },
    rows,
    shots,
  };
})(OF_ARGS)
