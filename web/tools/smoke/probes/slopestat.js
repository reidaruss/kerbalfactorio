// RN-842. THE RMS SLOPE OF A BODY'S SURFACE, measured through the oracle.
//
//   node tools/smoke/run.mjs --scenario=walk \
//        --evalfile=tools/smoke/probes/slopestat.js
//
// WHAT IT IS FOR. TerrainShader splits a facet's ambient between sky and ground
// with `skyView = 0.5 + 0.5 * dot(n, up)`, which is the sky-view factor of a
// facet on an INFINITE TANGENT PLANE. On a real cratered surface the local
// horizon is elevated in every direction, so every facet sees less sky and more
// ground than that formula says. On a body with air the error is invisible,
// because `skyAmb` is large and the two channels are comparable in magnitude,
// so moving weight between them barely moves a pixel. In a VACUUM `skyAmb` is
// exactly zero and the entire ambient rides on the ground channel, whose weight
// the flat-plane assumption drives to almost nothing: a 21 degree slope is told
// it sees 96.7 per cent sky and 3.3 per cent ground, and 3.3 per cent of a
// bounce is the black slope in RN840_C_surface_props.png.
//
// The correction needs ONE number per body: the mean fraction of the hemisphere
// that the local horizon occludes. For a rough surface of RMS slope sigma the
// mean horizon elevation is of order sigma, and the fraction of a hemisphere
// below elevation angle theta is sin(theta), so the occluded fraction is about
// (2/pi) * sigma averaged over azimuth. This probe measures sigma so that
// number is a MEASUREMENT of the body's own terrain rather than a dial.
//
// THE BASELINE IS NOT A DETAIL, IT IS THE WHOLE ANSWER, so this reports a
// LADDER and never a single figure. Slope is scale-dependent on a fractal
// surface: sampled over 400 m it describes which way the regional ground tilts,
// and sampled over 2 m it describes whether a boot would trip. The scale that
// sets a fragment's horizon is the one at which nearby terrain subtends a
// useful solid angle, which is metres to tens of metres, but that is an
// argument and the ladder is the evidence, so both go in the report.
//
// MEDIAN AND NOT MEAN (WG-146's corollary, paid for on this same body). A
// crater field's slope distribution is heavy-tailed: a few per cent of samples
// sit on a rim and dominate any mean or RMS. p50 asks what the ground a player
// is actually standing on does. Both are reported; the p50 is the one the
// shading constant should be built on.
(async () => {
  const of = window.__of;
  const args = (typeof OF_ARGS === 'object' && OF_ARGS !== null) ? OF_ARGS : {};
  const sites = args.sites || [{ name: 'spawn', lat: 2.0, lon: 144.0 }];
  const baselines = args.baselines || [2, 8, 40, 200, 1000];
  const N = args.samples || 96;          // N x N grid per site per baseline
  const fails = [];
  const check = (name, ok, detail) => {
    if (!ok) fails.push(detail === undefined ? name : `${name}: ${detail}`);
  };

  const w0 = of.world();
  const R = mustNum(w0, 'bodyRadiusM', 'world()');

  // Unit direction for a lat/lon, and an orthonormal east/north tangent pair.
  const basis = (latDeg, lonDeg) => {
    const la = latDeg * Math.PI / 180, lo = lonDeg * Math.PI / 180;
    const d = { x: Math.cos(la) * Math.cos(lo), y: Math.sin(la), z: Math.cos(la) * Math.sin(lo) };
    const e = { x: -Math.sin(lo), y: 0, z: Math.cos(lo) };
    const n = { x: -Math.sin(la) * Math.cos(lo), y: Math.cos(la), z: -Math.sin(la) * Math.sin(lo) };
    return { d, e, n };
  };

  // Height of the DRAWN surface at an angular offset from `d`, through the same
  // oracle /core asserts on. Re-normalised, so a large offset stays on the
  // sphere rather than drifting off it and reading a shorter radius.
  const h = (b, de, dn) => {
    const q = {
      x: b.d.x + b.e.x * de + b.n.x * dn,
      y: b.d.y + b.e.y * de + b.n.y * dn,
      z: b.d.z + b.e.z * de + b.n.z * dn,
    };
    const l = Math.hypot(q.x, q.y, q.z);
    return of.surface(q.x / l, q.y / l, q.z / l).baseM;
  };

  const rows = [];
  for (const site of sites) {
    const b = basis(site.lat, site.lon);
    const perBaseline = [];
    for (const dM of baselines) {
      const a = dM / R;                    // angular step for dM metres of arc
      const slopes = [];
      let misses = 0;
      // A CENTRED difference in each tangent direction, so the estimate is the
      // gradient AT the sample and not between it and its neighbour. The grid
      // spans N*dM so the samples are independent at this baseline rather than
      // N re-readings of one landform.
      for (let iy = 0; iy < N; ++iy) {
        for (let ix = 0; ix < N; ++ix) {
          const ox = (ix - N / 2) * a, oy = (iy - N / 2) * a;
          const hE = h(b, ox + a, oy), hW = h(b, ox - a, oy);
          const hN = h(b, ox, oy + a), hS = h(b, ox, oy - a);
          if (![hE, hW, hN, hS].every(Number.isFinite)) { ++misses; continue; }
          const gx = (hE - hW) / (2 * dM), gy = (hN - hS) / (2 * dM);
          slopes.push(Math.hypot(gx, gy));
        }
      }
      slopes.sort((p, q) => p - q);
      const q = (f) => slopes[Math.min(slopes.length - 1, Math.floor(f * slopes.length))];
      let s2 = 0;
      for (const v of slopes) s2 += v * v;
      const rms = Math.sqrt(s2 / Math.max(1, slopes.length));
      const p50 = q(0.5);
      perBaseline.push({
        baselineM: dM,
        n: slopes.length, misses,
        // Gradients (rise over run), and the same numbers as ANGLES, because
        // "0.29" and "16 degrees" are the same fact and only one of them can be
        // checked against a photograph.
        rms: +rms.toFixed(4), rmsDeg: +(Math.atan(rms) * 180 / Math.PI).toFixed(2),
        p50: +p50.toFixed(4), p50Deg: +(Math.atan(p50) * 180 / Math.PI).toFixed(2),
        p90: +q(0.9).toFixed(4), p99: +q(0.99).toFixed(4),
        // THE DERIVED QUANTITY the shader wants: the mean fraction of a
        // hemisphere the local horizon occludes, (2/pi) * atan(slope), clamped.
        // Written off the MEDIAN slope for WG-146's reason.
        omegaFromP50: +Math.min(1, (2 / Math.PI) * Math.atan(p50)).toFixed(4),
        omegaFromRms: +Math.min(1, (2 / Math.PI) * Math.atan(rms)).toFixed(4),
      });
      // An implausible magnitude is an instrument bug until proven otherwise
      // (INSTRUMENTS.md, and this project has caught two by magnitude alone).
      // A median gradient over 1.0 is a 45 degree median, which no body has.
      check(`${site.name} @ ${dM} m: the MEDIAN slope is physically possible`,
            p50 < 1.0, `p50 ${p50.toFixed(4)} (${(Math.atan(p50) * 180 / Math.PI).toFixed(1)} deg)`);
      check(`${site.name} @ ${dM} m: the oracle answered everywhere`,
            misses === 0, `${misses} misses of ${N * N}`);
    }
    of.teleport(site.lat, site.lon, 2.0);
    rows.push({ site: site.name, lat: site.lat, lon: site.lon,
                biome: of.world().biome, perBaseline });
  }

  return { valid: fails.length === 0, fails, bodyRadiusM: R, samplesPerCell: N * N, rows };
})()
