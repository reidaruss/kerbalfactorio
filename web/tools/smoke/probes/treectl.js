// WG-122: the NEGATIVE CONTROL for the whole tree pass, as a number rather than
// as a claim.
//
//   # pure HEAD, served from an untouched `git archive HEAD web` tree
//   node tools/smoke/run.mjs --mode=walk --sandbox=1 --url=http://127.0.0.1:5478/ \
//     --evalfile=tools/smoke/probes/treectl.js
//   # this lane's binary with every one of its switches OFF
//   node tools/smoke/run.mjs --mode=walk --sandbox=1 --url=http://127.0.0.1:5477/ \
//     --trees=0 --canopy=620 --nodelod=0 --nodecull=0 \
//     --evalfile=tools/smoke/probes/treectl.js
//
// The two runs must agree ROW FOR ROW. A pass is "off when switched off" only if
// switching it off reproduces the world that existed before it, and the only
// honest way to say that is to measure the world that existed before it, in its
// own build, through the same probe. It reads nothing this lane added, so it
// runs unchanged against HEAD.
(async () => {
  const of = window.__of;
  const A = typeof OF_ARGS === 'object' && OF_ARGS !== null ? OF_ARGS : {};
  const SITES = A.sites ?? [
    { name: 'rn15', lat: 12, lon: 150, yaw: 300, pitch: -10 },
    { name: 'current', lat: 2.0, lon: 144.0, yaw: 300, pitch: -6 },
    { name: 'forest', lat: -19.85, lon: -72.7853, yaw: 300, pitch: -6 },
    { name: 'plains', lat: -7.9675, lon: 116.53189, yaw: 300, pitch: -6 },
    { name: 'hills', lat: -31.165, lon: -86.27401, yaw: 300, pitch: -6 },
    { name: 'hills2', lat: 22.286, lon: 108.84406, yaw: 300, pitch: -6 },
    { name: 'beach', lat: -35.6028, lon: 53.30131, yaw: 300, pitch: -6 },
    { name: 'beach2', lat: -57.938, lon: -85.626, yaw: 300, pitch: -6 },
  ];
  const noonT = () => {
    let best = 0, bestDot = -2;
    for (let i = 0; i < 240; ++i) {
      const t = i / 240;
      of.setTime(t);
      const d = of.stats().sky.elevationDot;
      if (d > bestDot) { bestDot = d; best = t; }
    }
    return best;
  };
  const rows = [];
  for (const s of SITES) {
    of.teleport(s.lat, s.lon, 2.0);
    of.look(s.yaw, s.pitch);
    await of.run(1.0);
    of.setTime(noonT());
    let spin = 0;
    while (!of.world().chunks.converged && spin++ < 200) await of.run(0.25);
    let drain = 0;
    while (of.stats().props.scatterBacklog > 0 && drain++ < 400) await of.run(1 / 60);
    await of.run(11, 60);
    const st = of.stats();
    const g = of.game();
    rows.push({
      site: s.name,
      biome: of.world().biome,
      calls: st.draw.calls,
      triangles: st.draw.triangles,
      programs: st.draw.programs,
      geometries: st.draw.geometries,
      textures: st.draw.textures,
      vramEstimateMB: st.vramEstimateMB,
      // The node pool, because the LOD change touches the BATCH and a control
      // that only looked at triangles could not see a slot leak.
      nodes: g?.nodes.nodes ?? null,
      nodeInstances: g?.nodes.instances ?? null,
      nodeBatches: g?.nodes.batches ?? null,
      nodeRefused: g?.nodes.refused ?? null,
      propInstances: st.props?.instances ?? null,
      canopyProps: st.props?.canopyProps ?? null,
    });
  }
  return { stamp: of.boot, rows };
})()
