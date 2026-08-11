// WG-53 spawn-site shortlist. ONE site, ONE camera RULE, nothing else varies.
//
//   node tools/smoke/run.mjs --url=http://127.0.0.1:5233/ --scenario=walk \
//     --width=1280 --height=720 \
//     --evalfile=tools/smoke/probes/sitelook.js \
//     --evalargs='{"latDeg":-35.6028,"lonDeg":53.30131}' \
//     --out=docs/screenshots/WG53_site_beach.png
//
// The point is that seven captures are COMPARABLE: same local time of day, same
// sun-relative bearing, same pitch, same eye height, same settle, same viewport.
// Only the lat/lon differs, so the pictures can be read side by side as one
// variable. Everything the frame is supposed to prove also comes back as a
// number, because "that looks like desert" is not evidence and a black frame is
// indistinguishable from a good one at the file-size level.
//
// WHY THE SUN IS SOLVED AND NOT FIXED. `__of.setTime(t)` sets ONE sun direction
// in the body frame, `normalize(cos 2*pi*t, 0.42, sin 2*pi*t)` (SkyPass.dirForT).
// A fixed `t` is therefore a fixed direction in space and a DIFFERENT local time
// at every longitude: `t=0.32` is mid-morning at the current spawn and the
// middle of the night at lon -86, which is how the first run of this probe
// photographed the dark side and scored meanLum 9. So the probe sweeps `t` and
// takes the site's own LOCAL NOON, the maximum of dot(sunDir, localUp). That is
// the only "same time of day" that exists on a body whose sun has a fixed
// declination, and the resulting elevation is reported per site, because the
// declination is high-northern (sunDir.y is always +0.387) and a far-southern
// site simply cannot get a high sun. That is the planet, not the probe.
//
// WHY THE YAW IS SOLVED. Front-lit and back-lit ground are different pictures.
// The camera is aimed 45 degrees off the ANTI-SUN tangential bearing at every
// site, so the sun sits over the same shoulder in all seven frames. `look()`
// speaks yaw degrees and the mapping to a body-frame bearing is not published,
// so it is measured: read the aim at yaw 0 and yaw 90 and express the wanted
// bearing in that pair (the method mountainlook.js uses).
//
// BLANK-FRAME GUARD. `__of.groundCover()` differences the same frame with the
// foliage on and off inside a centred box, and hands back `bothBlack` and
// `meanLumWith`. A frame that photographed the void reports it rather than
// passing quietly. It leaves props visible and the runner screenshots after the
// eval, so the capture itself is unaffected.
//
// Heights come from world().surfaceHeightM / of.surface (surface_field.h). The
// probe derives no terrain of its own.
(async () => {
  const of = window.__of;
  const A = typeof OF_ARGS === 'undefined' ? {} : OF_ARGS;
  const log = [];
  const DEG = 180 / Math.PI;
  // Index == the /core Biome enum, same order as render/materials/BiomePalette.
  const BIOME_NAMES = ['Ocean', 'Beach', 'Plains', 'Forest', 'Hills',
    'Mountains', 'Polar', 'Regolith', 'MoonHighland', 'CraterFloor'];
  // The only biomes whose prop table contains snow or ice (assets/Registry.ts
  // BIOME_PROPS): Mountains carries Mtn_SnowPatch, Polar carries SnowDrift,
  // IceShard and IceBoulder. No other biome can place one.
  const SNOW_PROP_BIOMES = new Set([5, 6]);

  const settle = async (secs) => {
    of.input.tape([{ hold: Math.ceil(60 * secs) + 30, keys: [] }]);
    await of.run(secs, 60);
  };
  const unit = (p) => {
    const r = Math.hypot(p[0], p[1], p[2]) || 1;
    return [p[0] / r, p[1] / r, p[2] / r];
  };
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0]];
  const add = (a, b, k) => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
  // SkyPass.dirForT, verbatim. Duplicated here and nowhere else, because the
  // client does not publish the sun vector and the probe has to solve on it.
  const sunDirForT = (t) => unit([Math.cos(t * Math.PI * 2), 0.42, Math.sin(t * Math.PI * 2)]);
  const tangent = (v, up) => unit(add(v, up, -dot(v, up)));

  await settle(1.0);
  const t0 = of.world();
  if (t0.player === null) return { valid: false, why: 'no character' };

  const lat = A.latDeg ?? 2.0;
  const lon = A.lonDeg ?? 144.0;
  of.teleport(lat, lon, A.altM ?? 2.0);
  await settle(A.arriveSecs ?? 4.0);

  // WAIT FOR THE STREAM rather than guessing at it. These are teleports of up
  // to half a planet and the near chunk set is rebuilt from nothing; converged
  // plus real drawn vertices under the feet is the engine's own answer.
  let streamSecs = 0;
  for (let i = 0; i < 80; ++i) {
    const wv = of.world();
    if (wv.chunks.converged
        && of.meshVerts(wv.player.feet[0], wv.player.feet[1], wv.player.feet[2], 30).length > 8) {
      break;
    }
    await settle(0.5);
    streamSecs += 0.5;
  }

  // --- LOCAL NOON. Sweep t at 0.0005 turns and take the highest sun.
  const upHere = unit(of.world().player.aim.origin);
  let bestT = 0; let bestDot = -2;
  for (let i = 0; i < 2000; ++i) {
    const t = i / 2000;
    const d = dot(sunDirForT(t), upHere);
    if (d > bestDot) { bestDot = d; bestT = t; }
  }
  const sunT = A.sunT ?? +bestT.toFixed(4);
  of.setTime(sunT);
  await settle(0.5);
  const sunDir = sunDirForT(sunT);
  const sunElevDeg = +(Math.asin(Math.max(-1, Math.min(1, dot(sunDir, upHere)))) * DEG).toFixed(2);

  // --- THE YAW, measured against the client's own look() convention.
  of.look(0, 0); await settle(0.15);
  const b0 = tangent(of.world().player.aim.dir, upHere);
  of.look(90, 0); await settle(0.15);
  const b90 = tangent(of.world().player.aim.dir, upHere);
  // Anti-sun on the ground plane, rotated by `sunOffsetDeg` about local up, so
  // the sun sits over the same shoulder at every site.
  const sunT2 = tangent(sunDir, upHere);
  const anti = [-sunT2[0], -sunT2[1], -sunT2[2]];
  const perp = cross(upHere, anti);
  const off = ((A.sunOffsetDeg ?? 45) * Math.PI) / 180;
  const want = unit(add(add([0, 0, 0], anti, Math.cos(off)), perp, Math.sin(off)));
  const yawDeg = +(((Math.atan2(dot(want, b90), dot(want, b0)) * DEG) + 360) % 360).toFixed(2);
  const pitchDeg = A.pitchDeg ?? -8;
  of.look(yawDeg, pitchDeg);
  await settle(A.holdSecs ?? 2.5);

  const w = of.world();
  const feet = w.player.feet;
  const r = Math.hypot(feet[0], feet[1], feet[2]) || 1;
  const oracle = of.surface(feet[0] / r, feet[1] / r, feet[2] / r);
  const biomeIdx = w.biome;
  const cover = await of.groundCover(A.coverHalfPx ?? 260, 6);
  await settle(0.5);

  const st = of.stats();
  // The foliage pools live on stats(), not scene(): Debug.ts folds
  // props.stats() and scatter.stats() into one `props` block there.
  const props = mustHave(st, 'props', 'stats()');
  const topBatches = (props.perMaterial ?? []).slice(0, 8)
    .map((m) => `${m.name}:${m.live}`);
  // OF_Ice and OF_Snow are the materials the Mountains and Polar snow props
  // carry. A live count is the only honest answer to "is there snow in shot":
  // it says the batch was placed and drawn, not that the biome could place it.
  const snowBatches = (props.perMaterial ?? [])
    .filter((m) => /ice|snow/i.test(m.name) && m.live > 0)
    .map((m) => `${m.name}:${m.live}`);

  log.push(`site lat ${lat} lon ${lon} -> ${BIOME_NAMES[biomeIdx] ?? biomeIdx} `
    + `at ${w.surfaceHeightM.toFixed(1)} m, streamed ${streamSecs}s`);
  log.push(`local noon sunT ${sunT}, sun ${sunElevDeg} deg above the horizon, `
    + `yaw ${yawDeg} (anti-sun + ${A.sunOffsetDeg ?? 45}), pitch ${pitchDeg}`);
  log.push(`frame meanLum ${cover.meanLumWith}, bothBlack ${cover.bothBlack}, `
    + `foliage cover ${cover.coveredFraction}`);

  return {
    // A frame that is black over a third of the centre box, or that never
    // converged, is NOT a usable photograph and says so here.
    valid: w.chunks.converged && cover.bothBlack < 0.34 && cover.meanLumWith > 8,
    site: { latDeg: lat, lonDeg: lon },
    biome: { index: biomeIdx, name: BIOME_NAMES[biomeIdx] ?? `#${biomeIdx}` },
    snow: {
      biomeCarriesSnowProps: SNOW_PROP_BIOMES.has(biomeIdx),
      snowBatchesDrawn: snowBatches,
      note: 'Mountains (5) and Polar (6) are the only biomes whose prop table '
        + 'contains snow or ice; snowBatchesDrawn is the live instance count of '
        + 'any ice/snow material actually in the batch set this frame.',
    },
    elevation: {
      worldSurfaceHeightM: +w.surfaceHeightM.toFixed(2),
      oracleSurfaceM: +oracle.surfaceM.toFixed(2),
      observerAltM: +w.observer.altM.toFixed(2),
    },
    sun: { sunT, elevationDeg: sunElevDeg, rule: 'local noon (max dot(sunDir, up))' },
    observer: {
      latDeg: +w.observer.latDeg.toFixed(5), lonDeg: +w.observer.lonDeg.toFixed(5),
      yawDeg: +w.observer.yawDeg.toFixed(2), pitchDeg: +w.observer.pitchDeg.toFixed(2),
    },
    frame: {
      meanLum: cover.meanLumWith, bothBlack: cover.bothBlack,
      foliageCoverFraction: cover.coveredFraction, samplePx: cover.samplePx,
    },
    stream: { secs: streamSecs, converged: w.chunks.converged, resident: w.chunks.resident },
    propInstances: props.instances, topBatches,
    cost: { p50Ms: st.frameMs.p50, p99Ms: st.frameMs.p99,
      drawCalls: st.draw.calls, triangles: st.draw.triangles },
    camera: { yawDeg, pitchDeg, sunOffsetDeg: A.sunOffsetDeg ?? 45,
      eyeAltM: A.altM ?? 2.0, viewportPx: [1280, 720] },
    log,
  };
})()
