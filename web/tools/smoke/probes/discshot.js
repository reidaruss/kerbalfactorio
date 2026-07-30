// RN-146: ATTRIBUTE THE PALE DISC. RN-81 reported a large pale overlay,
// roughly 25 m around the player, washing out ground contrast in every biome,
// pre-existing and texture-independent (the RN78 off frames carry it too).
// A player-centred radius is the signature of a distance-faded term, so this
// probe binary-searches the IN-PAGE toggles inside one settled camera, one
// binary, one page: every candidate frame differs from baseline by exactly one
// term, one settled toggle apart, which two page loads cannot promise.
//
//   node tools/smoke/run.mjs --scenario=walk --sandbox=1 --url=http://127.0.0.1:4274/ \
//     --evalfile=tools/smoke/probes/discshot.js \
//     --evalargs='{"lat":12,"lon":150,"yawDeg":300,"pitchDeg":-12,"localNoon":true}'
//
// THE INSTRUMENT is a radial luma profile, not a whole-frame diff: per-row-band
// mean luma over the central columns, rows 0.06..0.76 of the frame (below the
// horizon, above the FP arms). On flat ground rows map monotonically to view
// distance, so a player-centred disc is a STEP in this profile and a candidate
// that owns the disc must FLATTEN the step when disabled. Two boxes publish the
// per-candidate movement: IN (inside the disc) and OUT (beyond it, the control
// box, boxdiff's rule: a subject box means nothing without a control beside it).
//
// NAMED FAILURE MODES, before measuring:
//  1. Vignette/screen-centred term misread as world disc: a vignette tracks the
//     FRAME, a distance term tracks the WORLD. The two-pitch pair at the end
//     moves the arc through the frame; a vignette's brightening would not move.
//  2. Candidate list incomplete (the disc is a URL-flag-only term, e.g.
//     shadows): every in-page candidate reads ~0 and the answer comes from the
//     baselineOnly runs under ?shadows=0 / ?post=0 / ?atmos=0 pages instead.
//     A null result here is then the finding, not a failure.
//  3. A toggle that never restores: after each candidate the term is restored
//     and a restore frame's profile must return to baseline within 0.6 counts,
//     or the whole sequence after it is measuring a stuck toggle.
//  4. The arms or hotbar drift into the metric region: the region is pinned to
//     rows 0.06..0.76 and the UI is hidden; the arms live below 0.78 at every
//     pitch this probe uses.
(async () => {
  const of = window.__of;
  const art = window.__ofTerrainArt;
  const post = window.__ofPost;
  if (!art || typeof art.set !== 'function') throw new Error('discshot: __ofTerrainArt missing');
  const lat = OF_ARGS.lat ?? 12;
  const lon = OF_ARGS.lon ?? 150;
  const yaw = OF_ARGS.yawDeg ?? 300;
  const pitch = OF_ARGS.pitchDeg ?? -12;
  let sunT = OF_ARGS.sunT ?? 0.30;
  const settleN = OF_ARGS.settle ?? 15;
  const baselineOnly = OF_ARGS.baselineOnly === true;

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
  of.propsVisible(false);
  of.look(yaw, pitch);
  of.setTime(sunT);
  await of.settle(30);

  // Fixture (GP-142's rule): the ground texture must be the real map, so the
  // setTex candidate below toggles a live term rather than a placeholder.
  const tex = art.texState();
  if (tex.w < 2 && !baselineOnly) throw new Error(`discshot: uGroundTex is ${tex.w}x${tex.h}; dead fetch`);

  // ---- the instrument ----
  const BANDS = 36;
  const ROW_LO = 0.06, ROW_HI = 0.76, COL_LO = 0.08, COL_HI = 0.92;
  // IN sits well inside a 25 m disc at pitch -12; OUT sits beyond the arc and
  // below the horizon (RN-34: horizon near row 0.28 at this family of cameras).
  const BOX_IN = { r0: 0.60, r1: 0.76, c0: 0.30, c1: 0.70 };
  const BOX_OUT = { r0: 0.31, r1: 0.42, c0: 0.30, c1: 0.70 };

  const shot = async () => {
    of.setTime(sunT);
    await of.settle(settleN);
    const blob = await of.screenshot();
    const bmp = await createImageBitmap(blob);
    const cv = new OffscreenCanvas(bmp.width, bmp.height);
    const cx = cv.getContext('2d', { willReadFrequently: true });
    cx.drawImage(bmp, 0, 0);
    const img = cx.getImageData(0, 0, bmp.width, bmp.height);
    let png = null;
    if (OF_ARGS.pngs !== false) {
      const buf = new Uint8Array(await blob.arrayBuffer());
      let s = '';
      for (let i = 0; i < buf.length; i += 0x8000) {
        s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
      }
      png = `data:image/png;base64,${btoa(s)}`;
    }
    return { img, png };
  };
  // The disc is a HUE shift as much as a luma one (measured: pale blue-green
  // inside, olive outside), so the profile carries luma AND warmth (r - b) and
  // the boxes report per-channel means. Failure mode 5, found by running: a
  // luma-only instrument read ~0 on a plainly visible disc, because the metric
  // was blind to the axis the term moves on.
  const luma = (d, i) => 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
  const profile = (img) => {
    const { data, width: w, height: h } = img;
    const lum = [], warm = [];
    for (let b = 0; b < BANDS; ++b) {
      const y0 = Math.floor(h * (ROW_LO + (ROW_HI - ROW_LO) * b / BANDS));
      const y1 = Math.floor(h * (ROW_LO + (ROW_HI - ROW_LO) * (b + 1) / BANDS));
      let s = 0, sw = 0, n = 0;
      for (let y = y0; y < y1; y += 2) {
        for (let x = Math.floor(w * COL_LO); x < w * COL_HI; x += 3) {
          const i = (y * w + x) * 4;
          s += luma(data, i); sw += data[i] - data[i + 2]; n++;
        }
      }
      lum.push(+(s / Math.max(1, n)).toFixed(2));
      warm.push(+(sw / Math.max(1, n)).toFixed(2));
    }
    return { lum, warm };
  };
  const boxMean = (img, bx) => {
    const { data, width: w, height: h } = img;
    let r = 0, g = 0, bl = 0, n = 0;
    for (let y = Math.floor(h * bx.r0); y < h * bx.r1; y += 2) {
      for (let x = Math.floor(w * bx.c0); x < w * bx.c1; x += 2) {
        const i = (y * w + x) * 4;
        r += data[i]; g += data[i + 1]; bl += data[i + 2]; n++;
      }
    }
    n = Math.max(1, n);
    return {
      r: +(r / n).toFixed(2), g: +(g / n).toFixed(2), b: +(bl / n).toFixed(2),
      l: +(0.2126 * (r / n) + 0.7152 * (g / n) + 0.0722 * (bl / n)).toFixed(2),
      warm: +((r - bl) / n).toFixed(2),
    };
  };
  const profDist = (a, b) => Math.max(...a.lum.map((v, i) => Math.abs(v - b.lum[i])));

  const base = await shot();
  const baseProf = profile(base.img);
  const baseIn = boxMean(base.img, BOX_IN);
  const baseOut = boxMean(base.img, BOX_OUT);

  const results = [];
  if (!baselineOnly) {
    const atmos = window.__ofAtmos;
    const a0 = art.get();
    const t0 = art.getTex();
    const w1 = art.getWet()[3];
    const cands = [
      ['ao off', () => post && post.setAo(false), () => post && post.setAo(true)],
      ['contact off', () => post && post.setContact(false), () => post && post.setContact(true)],
      ['aerial off', () => atmos && atmos.setAerial(false), () => atmos && atmos.setAerial(true)],
      ['groundtex off', () => art.setTex(0), () => art.setTex(t0)],
      ['macro off', () => art.set(0, a0[1], a0[2]), () => art.set(a0[0], a0[1], a0[2])],
      ['bump off', () => art.set(a0[0], 0, a0[2]), () => art.set(a0[0], a0[1], a0[2])],
      ['strata off', () => art.set(a0[0], a0[1], 0), () => art.set(a0[0], a0[1], a0[2])],
      ['wet off', () => art.setWet(0), () => art.setWet(w1)],
    ];
    for (const [name, on, off] of cands) {
      on();
      const s = await shot();
      const p = profile(s.img);
      const bIn = boxMean(s.img, BOX_IN);
      const bOut = boxMean(s.img, BOX_OUT);
      off();
      // Restore control (failure mode 3): baseline must come back.
      of.setTime(sunT);
      await of.settle(6);
      const r = await shot();
      const restored = profDist(profile(r.img), baseProf);
      results.push({
        name,
        deltaIn: { l: +(bIn.l - baseIn.l).toFixed(2), warm: +(bIn.warm - baseIn.warm).toFixed(2) },
        deltaOut: { l: +(bOut.l - baseOut.l).toFixed(2), warm: +(bOut.warm - baseOut.warm).toFixed(2) },
        profile: p, restoredWithin: +restored.toFixed(2),
        png: Math.abs(bIn.l - baseIn.l) > 1.5 || Math.abs(bIn.warm - baseIn.warm) > 1.5 ? s.png : null,
      });
    }
  }

  const w = of.world();
  return {
    valid: w.tick > w0.tick && w.chunks.converged,
    camera: { lat, lon, yawDeg: yaw, pitchDeg: pitch, sunT, biome: w.biome },
    boxes: { BOX_IN, BOX_OUT, ROW_LO, ROW_HI },
    baseline: { profile: baseProf, inMean: baseIn, outMean: baseOut, png: base.png },
    candidates: results,
  };
})()
