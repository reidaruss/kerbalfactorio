// RN-843. THE SUPPORT SWEEP for the ground-relief slope.
//
// WHAT IS BEING MEASURED AND WHY IT IS A HIGH-PASS. The artefact is a field of
// contour-following etched lines, dark on Forge's pale substrates and bright on
// Cinder's regolith. It is HIGH SPATIAL FREQUENCY and it covers a modest share
// of any frame, so a mean, a median or a percentile over the whole ground band
// cannot see it at all: those are exactly the statistics a zero-mean ripple is
// invisible in. The instrument is local contrast, `|luma(p) - mean(4 neighbours
// at radius r)|`, whose upper tail IS the artefact.
//
// THE SWEEP RUNS INSIDE ONE PAGE, one camera, one settled chunk set and one
// pinned sun, through `__ofTerrainArt.setReliefGradUv`. That is why RN-843
// promoted the support from a `#define` to a uniform: as a define each rung
// needed its own build, and two builds hold none of the camera, the streaming
// or the sun equal (RN-30's argument, and the reason `setAerial` exists).
//
// THE FIXTURE IS ASSERTED BEFORE ANY RUNG IS READ (GP-142): the shipped default
// is confirmed live, and every rung is confirmed to have actually changed the
// uniform. A sweep whose setter silently refused would otherwise report a
// beautifully flat curve and be believed.
(async () => {
  const of = window.__of;
  const art = window.__ofTerrainArt;
  const args = (typeof OF_ARGS === 'object' && OF_ARGS !== null) ? OF_ARGS : {};
  const site = args.site || { lat: 2.0, lon: 144.0, yaw: 40, pitch: -8 };
  const sundot = args.sundot ?? 0.28;
  // In TILE UNITS. The texture is 1024 square, so one texel is 1/1024 and the
  // shipped 0.0311 is 31.85 texels. The rungs are texel counts turned into tile
  // units, so the axis is the thing the correlation was measured against.
  const texels = args.texels || [1, 2, 4, 8, 16, 32, 64];
  const fails = [];
  const check = (name, ok, detail) => {
    if (!ok) fails.push(detail === undefined ? name : `${name}: ${detail}`);
  };

  const cv = document.getElementById('of-canvas');
  const gl = cv.getContext('webgl2', { preserveDrawingBuffer: true })
          || cv.getContext('webgl', { preserveDrawingBuffer: true });
  const W = gl.drawingBufferWidth, H = gl.drawingBufferHeight;
  const px = new Uint8Array(W * H * 4);
  const luma = (i) => 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];

  // The band excludes the top (HUD is DOM so it is already absent, but the sky
  // is not) and the bottom (the first-person gloves are geometry and would
  // contribute their own edges). Fixed rows, so every rung sees the same
  // pixels: the mask is a constant of the sweep, not a function of the rung.
  const Y0 = Math.floor(H * 0.10), Y1 = Math.floor(H * 0.72);
  const RAD = 2;

  const highPass = () => {
    gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const hp = [];
    let over4 = 0, over8 = 0, over16 = 0;
    let lsum = 0, ln = 0;
    for (let y = Y0 + RAD; y < Y1 - RAD; ++y) {
      for (let x = RAD; x < W - RAD; ++x) {
        const c = luma((y * W + x) * 4);
        lsum += c; ++ln;
        const bg = (luma(((y - RAD) * W + x) * 4) + luma(((y + RAD) * W + x) * 4)
                  + luma((y * W + (x - RAD)) * 4) + luma((y * W + (x + RAD)) * 4)) / 4;
        const d = Math.abs(c - bg);
        hp.push(d);
        if (d > 4) ++over4;
        if (d > 8) ++over8;
        if (d > 16) ++over16;
      }
    }
    hp.sort((a, b) => a - b);
    const q = (f) => hp[Math.min(hp.length - 1, Math.floor(f * hp.length))];
    const lMean = lsum / ln;
    return {
      n: hp.length,
      lumaMean: +lMean.toFixed(2),
      p50: +q(0.50).toFixed(3), p95: +q(0.95).toFixed(3),
      p99: +q(0.99).toFixed(3), p999: +q(0.999).toFixed(3),
      over4, over8, over16,
      // NORMALISED BY THE BAND'S OWN BRIGHTNESS. A support change alters the
      // bumped normal and therefore the overall level a little, and an absolute
      // tail would then reward whichever rung happened to be darkest. This asks
      // how visible the ripple is against the ground it is drawn on, which is
      // the thing an eye is actually reporting.
      p99OverLuma: +(q(0.99) / Math.max(1, lMean)).toFixed(4),
    };
  };

  // --- fixture, before anything is read -------------------------------------
  const dflt = art.reliefGradUvDefault();
  check('the shipped support is the one this sweep is measured against',
        Math.abs(dflt.value - dflt.shipped) < 1e-9 && !dflt.present,
        JSON.stringify(dflt));
  check('the relief term is actually ON (amp non-zero)',
        art.getRelief() > 0, `amp ${art.getRelief()}`);

  of.teleport(site.lat, site.lon, 2.0);
  const sun = of.setSunElev(sundot);
  check('the sun elevation asked for is reachable at this site',
        sun.err < 0.02, JSON.stringify(sun));
  let g = 0;
  while (!of.world().chunks.converged && g++ < 240) await of.run(0.25);
  let h = 0;
  while (h++ < 120) {
    const s = of.stats(); const gm = of.game();
    if (((s.props && s.props.scatterBacklog) || 0) === 0
        && ((gm.rocks && gm.rocks.backlog) || 0) === 0
        && ((gm.trees && gm.trees.backlog) || 0) === 0) break;
    await of.run(0.25);
  }
  of.look(site.yaw, site.pitch);
  of.setTime(sun.t);
  await of.settle(8);

  const rows = [];
  // THE FLOOR: relief amplitude zero. Everything the high pass still reports
  // here is somebody else's, and it is what the rungs have to be read against.
  // Without it a rung that halves the tail looks like a 50 per cent fix when
  // the reachable improvement was only 20 per cent.
  const amp0 = art.getRelief();
  art.setRelief(0);
  of.setTime(sun.t);
  await of.settle(4);
  const floor = highPass();
  art.setRelief(amp0);

  for (const t of texels) {
    const uv = t / 1024;
    const got = art.setReliefGradUv(uv);
    check(`rung ${t} texels: the uniform actually moved`,
          Math.abs(got - uv) < 1e-9, `asked ${uv} got ${got}`);
    of.setTime(sun.t);
    await of.settle(4);
    const m = highPass();
    rows.push({
      texels: t, uv: +uv.toFixed(6), got,
      ...m,
      // THE HEADLINE. How much of the artefact survives, measured against the
      // relief-off floor rather than against zero, so 1.0 means "as bad as
      // shipped" and 0.0 means "indistinguishable from the term being absent".
      excessOver8: m.over8 - floor.over8,
    });
  }
  // Leave the uniform where it was found, so a probe run does not change what a
  // subsequent capture in the same session measures.
  art.setReliefGradUv(dflt.shipped);

  const shipped = rows.find((r) => r.texels === 32) || null;
  const best = rows.reduce((a, b) => (a === null || b.excessOver8 < a.excessOver8 ? b : a), null);

  return {
    valid: fails.length === 0, fails,
    W, H, band: [Y0, Y1], radius: RAD,
    site, sun, elevationDot: of.stats().sky.elevationDot,
    biome: of.world().biome,
    floor, rows,
    shippedExcess: shipped ? shipped.excessOver8 : null,
    bestTexels: best ? best.texels : null,
    bestExcess: best ? best.excessOver8 : null,
  };
})()
