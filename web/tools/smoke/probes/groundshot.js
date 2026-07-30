// A MATCHED PAIR for the ground texture (RN-78/RN-79): the same settled frame
// with the term OFF and ON, from ONE page of ONE binary, so camera, sun,
// streamed chunk set and scatter are equal by construction and every moved
// pixel is the term's.
//
//   node tools/smoke/run.mjs --scenario=walk --sandbox=1 --url=http://127.0.0.1:4272/ \
//     --evalfile=tools/smoke/probes/groundshot.js \
//     --evalargs='{"lat":12,"lon":150,"yawDeg":300,"pitchDeg":-10,"props":false}'
//
// The report carries TWO data-URL PNGs (`pngOff`, `pngOn`); the caller writes
// them and diffs with pngdiff.mjs. The invariant set is read in BOTH states so
// "the texture moved textures/VRAM and nothing else" is a published claim, not
// an inference.
//
// THE FIXTURE IS ASSERTED BEFORE THE BEHAVIOUR (INSTRUMENTS.md, GP-142): the
// probe fails loudly if the ground texture never loaded (a 1x1 placeholder at
// the identity would produce a bit-identical "pair" and read as a dead term
// when it is actually a dead fetch), and it publishes which biome the camera
// is actually standing in, because a Plains claim measured on Beach is not a
// Plains claim.
(async () => {
  const of = window.__of;
  const art = window.__ofTerrainArt;
  if (!art || typeof art.setTex !== 'function') {
    throw new Error('groundshot: __ofTerrainArt.setTex is missing; RN-78 not in this build');
  }
  const lat = OF_ARGS.lat ?? 12;
  const lon = OF_ARGS.lon ?? 150;
  const yaw = OF_ARGS.yawDeg ?? 300;
  const pitch = OF_ARGS.pitchDeg ?? -10;
  let sunT = OF_ARGS.sunT ?? 0.30;
  const amp = OF_ARGS.amp ?? 1.0;

  if (OF_ARGS.hideUi !== false) {
    let node = document.querySelector('canvas');
    while (node !== null && node.parentElement !== null) {
      for (const sib of Array.from(node.parentElement.children)) {
        if (sib !== node) sib.style.display = 'none';
      }
      node = node.parentElement;
    }
  }

  const w0 = of.world();
  of.teleport(lat, lon, 2.0);
  // localNoon: a pinned t is a DIFFERENT local time at every longitude
  // (sitelook.js's lesson: its first run photographed the night side), so a
  // multi-site campaign asks for the site's own noon: the t maximising the
  // sky's own elevationDot, which is the field that does not freeze below the
  // horizon (INSTRUMENTS.md on __ofPost.state().sun).
  if (OF_ARGS.localNoon) {
    let best = -2;
    for (let i = 0; i < 48; ++i) {
      of.setTime(i / 48);
      await of.settle(2);
      const e = mustNum(of.stats().sky, 'elevationDot', 'stats.sky');
      if (e > best) { best = e; sunT = i / 48; }
    }
  }
  of.setTime(sunT);
  await of.run(2.0);
  let spin = 0;
  while (!of.world().chunks.converged && spin++ < 240) await of.run(0.5);
  await of.run(1.0);
  if (OF_ARGS.props === false) of.propsVisible(false);
  of.look(yaw, pitch);
  of.setTime(sunT);
  await of.settle(30);

  // THE FIXTURE CHECK (GP-142's rule): the sampler must hold the real 1024px
  // map, not the 1x1 placeholder, because a pair taken against the placeholder
  // is bit-identical BY CONSTRUCTION and would read as a dead term when it is
  // a dead fetch. Asserted from the material's own handle, not with a second
  // HTTP request: the probe's first version used a HEAD fetch here and every
  // run logged it as a requestfailed ERR_ABORTED, failing smoke on an
  // instrument artifact.
  const tex = art.texState();
  if (tex.w < 2) throw new Error(`groundshot: uGroundTex is still the ${tex.w}x${tex.h} placeholder; of_ground.png never loaded`);
  // RN-150 fixture: the SHIPPED DEFAULT must be live on a page with no
  // override. This probe always FORCED the amp through setTex, which is why a
  // dead boot default (Number(null) is 0 and finite, so the fallback branch
  // was unreachable) measured 12 green site pairs while the played game never
  // drew the texture. The boot state is part of the fixture from now on.
  {
    const q = new URLSearchParams(location.search);
    if (!q.has('groundtex') && !q.has('groundtexamp') && art.getTex() <= 0) {
      throw new Error(`groundshot: boot default groundtex amp is ${art.getTex()} with no override in ${location.search}; the shipped default is dead (RN-150)`);
    }
  }
  const texLoaded = true;

  const grab = async () => {
    of.setTime(sunT);
    await of.settle(OF_ARGS.settle ?? 15);
    const blob = await of.screenshot();
    const buf = new Uint8Array(await blob.arrayBuffer());
    let s = '';
    const CHUNK = 0x8000;
    for (let i = 0; i < buf.length; i += CHUNK) {
      s += String.fromCharCode.apply(null, buf.subarray(i, i + CHUNK));
    }
    return `data:image/png;base64,${btoa(s)}`;
  };
  const invariants = () => {
    const st = of.stats();
    return {
      drawCalls: mustNum(st.draw, 'calls', 'stats.draw'),
      triangles: mustNum(st.draw, 'triangles', 'stats.draw'),
      programs: mustNum(st.draw, 'programs', 'stats.draw'),
      geometries: mustNum(st.draw, 'geometries', 'stats.draw'),
      textures: mustNum(st.draw, 'textures', 'stats.draw'),
      vramEstimateMB: mustNum(st, 'vramEstimateMB', 'stats'),
    };
  };

  art.setTex(0);
  const invOff = invariants();
  const pngOff = await grab();
  art.setTex(amp);
  const pngOn = await grab();
  const invOn = invariants();
  art.setTex(amp); // leave the page in the shipped state

  const w = of.world();
  return {
    valid: w.tick > w0.tick && w.chunks.converged,
    camera: { lat, lon, yawDeg: yaw, pitchDeg: pitch, sunT, biome: w.biome },
    amp,
    propsHidden: OF_ARGS.props === false,
    texServed: texLoaded,
    invOff, invOn,
    pngOff, pngOn,
  };
})()
