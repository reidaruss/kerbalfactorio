// Pose the camera for a TERRAIN ART screenshot and leave the world in the state
// the shot wants, so run.mjs's own --out capture photographs it.
//
//   node tools/smoke/run.mjs --scenario=walk --sandbox=1 --url=http://127.0.0.1:4196/ \
//     --evalfile=tools/smoke/probes/artshot.js \
//     --evalargs='{"lat":12,"lon":150,"yawDeg":300,"pitchDeg":-10,"props":false}' \
//     --out=docs/screenshots/RN45_terrain_after.png
//
// This exists because the world-art pair at the RN-15 camera is honest but is
// not LEGIBLE: the understorey covers about 55% of that frame, so a change to
// the GROUND MATERIAL is mostly behind grass. `props:false` hides the scatter
// for the shot only, which is the same isolation `probes/post.js` and this
// lane's own `terrainart.js` use, and it is the only way to photograph the
// thing being changed rather than the thing standing in front of it.
//
// The art state is taken from the query flags rather than set here, so a
// before/after pair is two runs of ONE binary differing only in `?terrainart=`.
(async () => {
  const of = window.__of;
  const lat = OF_ARGS.lat ?? 12;
  const lon = OF_ARGS.lon ?? 150;
  const yaw = OF_ARGS.yawDeg ?? 300;
  const pitch = OF_ARGS.pitchDeg ?? -10;
  const sunT = OF_ARGS.sunT ?? 0.30;

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
  of.setTime(sunT);
  await of.run(2.0);
  let spin = 0;
  while (!of.world().chunks.converged && spin++ < 240) await of.run(0.5);
  await of.run(1.0);
  if (OF_ARGS.props === false) of.propsVisible(false);
  of.look(yaw, pitch);
  // RE-PIN after the data-dependent wait, or the two halves of a pair are taken
  // at different sun angles and the difference reads as a colour change (RN-10
  // defect 3, which produced an entirely convincing false result).
  of.setTime(sunT);
  await of.settle(30);

  const w = of.world();
  const s = of.stats();
  return {
    valid: w.tick > w0.tick && w.chunks.converged,
    camera: { lat, lon, yawDeg: yaw, pitchDeg: pitch, sunT, biome: w.biome },
    artAmp: window.__ofTerrainArt ? window.__ofTerrainArt.get() : null,
    propsHidden: OF_ARGS.props === false,
    triangles: s.draw.triangles, drawCalls: s.draw.calls,
    programs: s.draw.programs, vramEstimateMB: s.vramEstimateMB,
  };
})()
