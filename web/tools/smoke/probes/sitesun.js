// RN-1002. What sun elevations a SITE can actually reach, and what biome it is.
//
//   node tools/smoke/run.mjs --scenario=walk --sandbox=1 --url=... \
//     --evalfile=tools/smoke/probes/sitesun.js \
//     --evalargs='{"sites":[{"name":"beach","lat":-35.6,"lon":53.3}],"asks":[0.42,0.64]}'
//
// WHY. `of.setSunElev(d)` solves against the observer's local up AT THE MOMENT
// OF THE CALL and reports its miss (RN-844), and the miss is not a rounding
// error: at a high latitude, on a tilted patch of ground, or at a crater floor,
// a requested elevation may not exist at ANY phase of the day. RN-844 caught
// exactly that: "noon at the crater floor" does not exist, so a grazing-versus-
// noon pair taken there is a null result caused by the site.
//
// A pair is worthless if its two halves were taken under a light one of the
// sites could not produce, and it is equally worthless if the light was quietly
// changed per site to make the ask succeed. So the elevation is chosen ONCE,
// for all sites, from a measured envelope, and this probe measures the
// envelope: the maximum elevationDot over a whole day at each site, sampled
// from the client's own sky rather than derived from latitude.
//
// The maximum is taken over the SAMPLED day and is therefore a lower bound on
// the true maximum; the sample count is published so that is checkable rather
// than implied.
(async (A) => {
  const of = window.__of;
  if (!of) throw new Error('sitesun: no window.__of');
  const sites = A.sites ?? [];
  const asks = A.asks ?? [];
  const N = A.samples ?? 96;
  if (sites.length === 0) throw new Error('sitesun: no sites');

  const out = [];
  for (const s of sites) {
    of.teleport(s.lat, s.lon, s.alt ?? 2.0);
    await of.run(1.0);
    let spin = 0;
    while (!of.world().chunks.converged && spin++ < 240) await of.run(0.5);

    let maxE = -2, maxT = 0, minE = 2;
    for (let i = 0; i < N; ++i) {
      const t = i / N;
      of.setTime(t);
      await of.settle(2);
      const e = mustNum(of.stats().sky, 'elevationDot', 'stats.sky');
      if (e > maxE) { maxE = e; maxT = t; }
      if (e < minE) minE = e;
    }
    const solves = asks.map((d) => {
      const r = of.setSunElev(d);
      return { ask: d, got: +r.gotDot.toFixed(4), err: +r.err.toFixed(4), t: +r.t.toFixed(4) };
    });
    const w = of.world();
    out.push({
      name: s.name, lat: s.lat, lon: s.lon,
      biome: w.biome ?? null,
      samples: N,
      maxElevationDot: +maxE.toFixed(4),
      maxElevationDeg: +((Math.asin(Math.max(-1, Math.min(1, maxE))) * 180) / Math.PI).toFixed(2),
      maxAtT: +maxT.toFixed(4),
      minElevationDot: +minE.toFixed(4),
      solves,
    });
  }
  return { valid: true, sites: out };
})(OF_ARGS)
