// RN-846. The planetshine budget, from BOTH surfaces, at three phases.
//
//   node tools/smoke/run.mjs --scenario=walk \
//        --evalfile=tools/smoke/probes/shine.js \
//        --evalargs='{"lat":2.0,"lon":144.0}'
//
// OF_ARGS: { lat, lon } are REQUIRED. `of.teleport(OF_ARGS.lat, OF_ARGS.lon, 2.0)`
// reads them with no fallback, so an empty --evalargs teleports to (undefined,
// undefined) rather than to a sensible default site.
(async () => {
  const of = window.__of; const B = window.__ofBodies;
  of.teleport(OF_ARGS.lat, OF_ARGS.lon, 2.0);
  await of.run(1.0);
  let spin = 0;
  while (!of.world().chunks.converged && spin++ < 240) await of.run(0.5);
  const rows = [];
  for (const t of [0.0, 0.125, 0.25, 0.375, 0.5]) {
    of.setTime(t);
    await of.settle(2);
    const ps = B.planetshine();
    const rep = B.report();
    rows.push({ t, onGround: ps.onGround, onBody: ps.onBody,
      distanceM: rep.bodies[0].distanceM });
  }
  const ps = B.planetshine();
  return { hostRadiusM: ps.hostRadiusM, hostAlbedo: ps.hostAlbedo, rows };
})()
