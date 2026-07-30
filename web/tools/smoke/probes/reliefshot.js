// RN-149: matched pairs for the ASYMMETRIC relief bump (RN-147/148), the same
// instrument shape as groundshot.js: one page, one binary, setRelief(0) vs
// setRelief(amp) one settled toggle apart, so camera, sun, chunks and scatter
// are equal by construction.
//
//   node tools/smoke/run.mjs --scenario=walk --sandbox=1 --url=... \
//     --evalfile=tools/smoke/probes/reliefshot.js \
//     --evalargs='{"lat":12,"lon":150,"yawDeg":300,"pitchDeg":-35}'
//
// TWO SUN ELEVATIONS PER SITE, and that is the instrument's point: relief is a
// LIGHTING term, and an asymmetric microrelief's read is carried by grazing
// light (long shadows off sharp crests) while a noon sun flattens it. So the
// pair is taken at the site's own GRAZING morning (elevationDot near
// OF_ARGS.grazeDot, default 0.22) AND at its local noon, in one page. The
// property assertion lives in the caller's diff: at grazing the off/on pair
// moves pixels BOTH ways (a lighting term brightens sun-facing microslopes and
// darkens lee slopes; a one-sided result would mean the term is tinting, not
// shading), and the grazing pair moves substantially more than the noon pair.
//
// NAMED FAILURE MODES, before measuring (the RN-78 catalogue):
//  1. CHOPPY WATER: smooth metre-scale undulation reads as liquid. Excluded at
//     the asset (groundtex.py's asymmetry assertions), CHECKED here by eye on
//     the saved grazing frames: sharp crests and flat facets, not swell.
//  2. Dead fetch read as dead term: reliefState() must report the 1024 map,
//     not the 1x1 placeholder (a placeholder pair is bit-identical BY
//     CONSTRUCTION); groundshot's fixture rule.
//  3. A pinned t is a different local time per longitude (sitelook's lesson):
//     both sun times are solved from the site's own elevationDot, never taken
//     from a constant.
//  4. Polar is the by-design near-zero: RELIEF_W is ~0 there because drifted
//     snow is smooth. A "failing" tiny pair at Polar is the design working;
//     assert it as such, not as a defect.
(async () => {
  const of = window.__of;
  const art = window.__ofTerrainArt;
  if (!art || typeof art.setRelief !== 'function') {
    throw new Error('reliefshot: __ofTerrainArt.setRelief is missing; RN-148 not in this build');
  }
  const lat = OF_ARGS.lat ?? 12;
  const lon = OF_ARGS.lon ?? 150;
  const yaw = OF_ARGS.yawDeg ?? 300;
  const pitch = OF_ARGS.pitchDeg ?? -35;
  const grazeDot = OF_ARGS.grazeDot ?? 0.22;
  const amp = OF_ARGS.amp ?? null; // null = the shipped default

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
  await of.run(2.0);
  let spin = 0;
  while (!of.world().chunks.converged && spin++ < 240) await of.run(0.5);
  await of.run(1.0);
  of.propsVisible(false);
  of.look(yaw, pitch);

  // Solve the two sun times from the site's own sky (failure mode 3): noon is
  // the max of elevationDot over the day; grazing is the MORNING time whose
  // elevation lands nearest grazeDot on the rising side.
  let noonT = 0.5, noonE = -2, grazeT = 0.5, grazeErr = 9;
  let prevE = -2;
  for (let i = 0; i < 96; ++i) {
    const t = i / 96;
    of.setTime(t);
    await of.settle(2);
    const e = mustNum(of.stats().sky, 'elevationDot', 'stats.sky');
    if (e > noonE) { noonE = e; noonT = t; }
    if (e > prevE && e > 0.05) { // rising side only
      const err = Math.abs(e - grazeDot);
      if (err < grazeErr) { grazeErr = err; grazeT = t; }
    }
    prevE = e;
  }

  const tex = art.reliefState();
  if (tex.w < 2) throw new Error(`reliefshot: uGroundRelief is still the ${tex.w}x${tex.h} placeholder; of_ground_relief.png never loaded`);
  const shipped = art.getRelief();
  // RN-150 fixture: the SHIPPED DEFAULT must be live on a page with no
  // override. Number(null) is 0 and finite, so a dead-default parser bug ships
  // a term that every explicit-amp instrument measures perfectly while the
  // player never sees it; this line is what makes that class loud.
  const q = new URLSearchParams(location.search);
  if (!q.has('groundrelief') && !q.has('groundreliefamp') && shipped <= 0) {
    throw new Error(`reliefshot: boot default relief amp is ${shipped} with no override in ${location.search}; the shipped default is dead (RN-150)`);
  }
  const onAmp = amp ?? (shipped > 0 ? shipped : 0.3);

  const grab = async (t) => {
    of.setTime(t);
    await of.settle(OF_ARGS.settle ?? 15);
    const blob = await of.screenshot();
    const buf = new Uint8Array(await blob.arrayBuffer());
    let s = '';
    for (let i = 0; i < buf.length; i += 0x8000) {
      s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
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

  // Invariants are read immediately after the GRAZING grab on each side, so
  // both readings sit at the same pinned sun: the cascade pass draws a
  // sun-dependent triangle count, and a first draft that read the two sides at
  // different times of day photographed that as a phantom 137k-triangle move.
  art.setRelief(0);
  const grazeOff = await grab(grazeT);
  const invOff = invariants();
  const noonOff = await grab(noonT);
  art.setRelief(onAmp);
  const grazeOn = await grab(grazeT);
  const invOn = invariants();
  const noonOn = await grab(noonT);
  art.setRelief(shipped); // leave the page in the shipped state

  const w = of.world();
  return {
    valid: w.tick > w0.tick && w.chunks.converged,
    camera: { lat, lon, yawDeg: yaw, pitchDeg: pitch, biome: w.biome },
    sun: { grazeT, grazeDotAchieved: +(grazeDot + (grazeErr === 9 ? NaN : 0)).toFixed(3), grazeErr: +grazeErr.toFixed(3), noonT, noonElev: +noonE.toFixed(3) },
    ampOn: onAmp,
    reliefServed: { w: tex.w, h: tex.h },
    invOff, invOn,
    grazeOff, grazeOn, noonOff, noonOn,
  };
})()
