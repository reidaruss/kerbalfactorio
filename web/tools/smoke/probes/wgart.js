// WG-95: stand at ONE site, face the new art, and let the runner take the
// picture. The counters live in `rocksite.js`; this is the eye's half of DW-7.
//
//   node tools/smoke/run.mjs --url=... --mode=walk --sandbox=1 \
//     --evalfile=tools/smoke/probes/wgart.js \
//     --evalargs='{"site":{"name":"current","lat":2,"lon":144,"yaw":300,"pitch":-6}}' \
//     --out=docs/screenshots/WG95_mtn.png
//
// WHY A SEPARATE PROBE AND NOT A `rocksite.js` FLAG: rocksite walks five sites
// and the runner captures ONE frame, at the end, which is the last site. Every
// picture it could take is therefore of `hills`. A single-site probe is the
// only shape that can photograph the site it measured.
//
// OF_ARGS:
//   site:    {name, lat, lon, yaw, pitch}. Required.
//   hideUi:  false keeps the HUD (for a prompt shot). Default true.
//   walkTo:  'spire' | 'rock' | null. Walks to the nearest node of that art
//            and aims at it, so the picture is the object and not the vista.
(async () => {
  const of = window.__of;
  const A = OF_ARGS ?? {};
  const s = A.site;
  if (s === undefined) return { valid: false, fail: 'OF_ARGS.site is required' };

  if (A.hideUi !== false) {
    let node = document.querySelector('canvas');
    while (node !== null && node.parentElement !== null) {
      for (const sib of Array.from(node.parentElement.children)) {
        if (sib !== node) sib.style.display = 'none';
      }
      node = node.parentElement;
    }
  }

  const V = (a) => Math.hypot(a[0], a[1], a[2]);
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const norm = (a) => { const l = V(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

  of.teleport(s.lat, s.lon, 2.0);
  of.look(s.yaw, s.pitch);
  await of.run(1.0);
  // Local noon from the SKY's own sun, which does not freeze below the horizon
  // the way the post stack's published vector does (INSTRUMENTS.md).
  let best = 0; let bestDot = -2;
  for (let i = 0; i < 240; ++i) {
    of.setTime(i / 240);
    const d = of.stats().sky.elevationDot;
    if (d > bestDot) { bestDot = d; best = i / 240; }
  }
  of.setTime(best);
  let spin = 0;
  while (!of.world().chunks.converged && spin++ < 200) await of.run(0.25);
  let drain = 0;
  while (of.stats().props.scatterBacklog > 0 && drain++ < 400) await of.run(1 / 60);
  let rdrain = 0;
  while ((of.game()?.rocks?.backlog ?? 0) > 0 && rdrain++ < 400) await of.run(1 / 60);
  await of.run(1.0);

  let walked = null;
  if (A.walkTo === 'spire' || A.walkTo === 'rock') {
    const want = A.walkTo === 'spire' ? 'RockSpire' : 'BoulderStone';
    const feet = () => of.world().player.aim.origin;
    const target = of.nodes().find((n) => n.art === want && n.distanceM > 4
      && n.distanceM < 120);
    if (target === undefined) {
      // NOT a silent pass: the whole point of walking to a spire is that one
      // exists. Say so rather than photographing whatever was in front.
      return { valid: false, fail: `no ${want} within 120 m at ${s.name}`,
        arts: [...new Set(of.nodes().filter((n) => n.kind === 1).map((n) => n.art))] };
    }
    const faceIt = () => {
      const eye = feet();
      const w = norm(sub([target.x, target.y, target.z], eye));
      let bestYaw = 0; let bd = -2;
      const st = of.world().observer;
      for (let a = 0; a < 360; a += 3) {
        of.look(a, st.pitchDeg);
        if (dot(of.aim().dir, w) > bd) { bd = dot(of.aim().dir, w); bestYaw = a; }
      }
      let bestPitch = 0; bd = -2;
      for (let p = -30; p <= 20; p += 2) {
        of.look(bestYaw, p);
        if (dot(of.aim().dir, w) > bd) { bd = dot(of.aim().dir, w); bestPitch = p; }
      }
      of.look(bestYaw, bestPitch);
    };
    for (let i = 0; i < 70; ++i) {
      const row = of.nodes().find((n) => n.index === target.index);
      if (row === undefined || row.distanceM < 4.5) break;
      faceIt();
      of.input.tape([{ hold: 40, keys: ['KeyW'] }]);
      await of.run(0.8);
    }
    faceIt();
    await of.run(0.5);
    const row = of.nodes().find((n) => n.index === target.index);
    walked = { art: target.art, scale: target.scale,
      distanceM: row?.distanceM ?? null, aimed: of.game().interact.target };
  }

  const st = of.stats();
  const w = of.world();
  const rocks = of.nodes().filter((n) => n.kind === 1 && n.distanceM < 175);
  const by = {};
  for (const n of rocks) by[n.art ?? 'null'] = (by[n.art ?? 'null'] ?? 0) + 1;
  return {
    valid: true,
    site: s.name, biome: w.biome, groundM: +w.surfaceHeightM.toFixed(1),
    calls: st.draw.calls, triangles: st.draw.triangles,
    programs: st.draw.programs, geometries: st.draw.geometries,
    textures: st.draw.textures, vramEstimateMB: st.vramEstimateMB,
    rockArt: by,
    rocks: of.game()?.rocks?.live ?? null,
    propInstances: st.props?.instances ?? null,
    propsPlaced: st.props?.propsPlaced ?? null,
    walked,
  };
})()
