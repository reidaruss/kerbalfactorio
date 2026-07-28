// Park the camera at ONE named forest station and leave it there for --out.
//
//   node tools/smoke/run.mjs --scenario=walk --sandbox=1 --canopy=0 \
//     --url=http://127.0.0.1:4204/ --out=docs/screenshots/WG59_walk_before.png \
//     --evalfile=tools/smoke/probes/forestshot.js --evalargs='{"station":"walk"}'
//
// FOUR STATIONS, because "is there a forest" is four different questions and a
// single camera answers at most one of them:
//
//   walk      inside the trees at eye height. Answers "can I walk in it", and
//             it is the only station that can show a canopy tree standing next
//             to nothing at all where a harvest node would be.
//   mid       the same ground from 60 m up. Answers "does it read as a stand
//             with clearings", which is the stand field's whole claim and is
//             invisible from inside.
//   horizon   the RN-15 invariant camera, a Hills site at 861 m with real
//             relief. Answers "is there a treeline on the far ground", which is
//             the gap this pass exists to close.
//   treeline  hills2 at 1,897 m, which the altitude fade puts ON the treeline.
//             Answers "does the forest STOP, and does it stop in a line that
//             does not look drawn".
//
// The sun is solved for each station's own local noon rather than shared,
// because `setTime` sets a BODY-frame direction and a fixed t is a different
// hour at every longitude (WG-53). `sky.elevationDot` is read and not the post
// stack's sun, which freezes below the horizon (INSTRUMENTS.md).
//
// The probe RETURNS the invariant table for the frame it shot, so the picture
// and its numbers cannot be attributed to different runs.
(async () => {
  const of = window.__of;
  const STATIONS = {
    walk: { lat: -19.85, lon: -72.7853, alt: 2.0, yaw: 300, pitch: -4 },
    mid: { lat: -19.85, lon: -72.7853, alt: 60.0, yaw: 300, pitch: -14 },
    horizon: { lat: 12, lon: 150, alt: 2.0, yaw: 300, pitch: -6 },
    treeline: { lat: 22.286, lon: 108.84406, alt: 120.0, yaw: 300, pitch: -12 },
  };
  const name = OF_ARGS.station ?? 'walk';
  const s = STATIONS[name];
  if (s === undefined) {
    return { valid: false, fails: [`no station '${name}'`], have: Object.keys(STATIONS) };
  }

  let node = document.querySelector('canvas');
  while (node !== null && node.parentElement !== null) {
    for (const sib of Array.from(node.parentElement.children)) {
      if (sib !== node) sib.style.display = 'none';
    }
    node = node.parentElement;
  }

  const t0 = of.world().tick;
  of.teleport(s.lat, s.lon, s.alt);
  of.look(s.yaw, s.pitch);
  await of.run(1.0);
  // Local noon, solved rather than assumed.
  let bestT = 0;
  let bestDot = -2;
  for (let i = 0; i < 240; ++i) {
    of.setTime(i / 240);
    const d = of.stats().sky.elevationDot;
    if (d > bestDot) { bestDot = d; bestT = i / 240; }
  }
  of.setTime(bestT);
  of.teleport(s.lat, s.lon, s.alt);
  of.look(s.yaw, s.pitch);

  let spin = 0;
  while (!of.world().chunks.converged && spin++ < 300) await of.run(0.25);
  // The scatter budget is ONE chunk an update, and the canopy ring holds four
  // dozen of them, so a shot taken at convergence is a shot of a half-grown
  // forest. Drain the backlog explicitly and REPORT what it reached, because a
  // picture of a partial world that nobody knew was partial is exactly how two
  // frames get compared that were never comparable.
  let drain = 0;
  while (of.stats().props.scatterBacklog > 0 && drain++ < 900) await of.run(1 / 60);
  of.look(s.yaw, s.pitch);
  await of.run(1.0, 60);

  const w = of.world();
  const st = of.stats();
  const p = st.props;
  return {
    valid: w.chunks.converged && p.scatterBacklog === 0 && w.tick > t0,
    station: name,
    where: { biome: w.biome, groundM: +w.surfaceHeightM.toFixed(1), altM: +w.altM.toFixed(1) },
    sun: { t: +bestT.toFixed(4), elevationDot: +bestDot.toFixed(4) },
    settle: { convergeSpins: spin, drainFrames: drain, backlog: p.scatterBacklog },
    isolation: { canopyRadiusM: p.canopyRadiusM, canopyShade: p.canopyShade },
    invariants: {
      calls: st.draw.calls, triangles: st.draw.triangles,
      programs: st.draw.programs, geometries: st.draw.geometries,
      textures: st.draw.textures, vramEstimateMB: st.vramEstimateMB,
    },
    canopy: {
      props: p.canopyProps, perM2: p.canopyPerM2, delivered: p.canopyDelivered,
      offeredCells: p.canopyOfferedCells, slopeCells: p.canopySlopeCells,
      bareCells: p.canopyBareCells, slopeRejectCells: p.slopeRejectCells,
    },
    ground: {
      propsPlaced: p.propsPlaced, delivered: p.deliveredFraction,
      chunksCapped: p.chunksCapped, cellsCapped: p.cellsCapped,
      poolRefused: p.refused ?? 0,
    },
  };
})()
