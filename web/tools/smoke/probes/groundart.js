// Does the WORLD art (ground cover, contact blending, aerial perspective) hold
// up, and what does it cost? The matched-pair instrument for the DW-35 world-art
// lane.
//
//   node tools/smoke/run.mjs --scenario=walk --sandbox=1 --url=http://127.0.0.1:4182/ \
//     --evalfile=tools/smoke/probes/groundart.js \
//     --evalargs='{"yawDeg":40,"pitchDeg":-14}' \
//     --out=docs/screenshots/RN_world_before.png
//
// FOUR MEASUREMENTS, and every one of them is a RATIO or a matched pair, because
// the whole point of this lane is a before/after and a raw count from two
// different runs of a streaming world is not a comparison (RN-7, RN-13).
//
// 1. COVER. `groundCover` differences the SAME settled frame with the foliage
//    layer on and off, so camera, sun, streamed set and terrain cannot differ
//    between the two captures. `bothBlack` guards the degenerate reading.
//
// 2. AERIAL PERSPECTIVE, as a NEAR-band against a FAR-band IN ONE FRAME. Two
//    horizontal bands of the same capture: one of ground a few metres away, one
//    of ground far enough to be near the horizon. Aerial perspective is the
//    claim that the far band is LESS SATURATED and BLUER than the near band, and
//    taking both from one frame holds exposure, sun elevation, tone curve and
//    colour grade equal by construction, so the only free variable is range.
//    A single-band absolute number could be moved by any of those four.
//
// 3. COST, published next to the budget it is spent against (DW-5).
//
// 4. NOTHING DROPPED SILENTLY (DW-28): pool refusals and both scatter caps.
//
// The camera is pinned by teleport + look, and `setTime` is re-pinned AFTER the
// convergence wait and immediately before the captured frame, because that wait
// is data-dependent and the sun moves with sim time (RN-13).
//
// THE DEFAULT SITE IS CHOSEN, not arbitrary. A twelve-site sweep of the seed
// found that the biomes differ enormously in what they scatter (Mountains and
// Beach take the dry understorey and no grass at all; Ocean scatters almost
// nothing), so a probe pointed at the wrong one measures a real number about
// the wrong question. lat 12 / lon 150 is Hills at 354 m relief, and yaw 300 /
// pitch -10 puts ground, a boulder and the horizon in one frame, which is the
// framing all three of density, contact blending and range need at once.
(async () => {
  const of = window.__of;
  const yaw = OF_ARGS.yawDeg ?? 40;
  const pitch = OF_ARGS.pitchDeg ?? -14;
  const sunT = OF_ARGS.sunT ?? 0.30;
  const lat = OF_ARGS.lat ?? 1.832;
  const lon = OF_ARGS.lon ?? 144.168;

  // The shot is a judgement call by a human, so the debug overlay, the hotbar
  // and the quest panel are hidden for it: they cover a third of the frame and
  // they are not what is being judged. Hidden by DISPLAY on the DOM rather than
  // by a query flag, so the two halves of a pair are one binary and one run.
  if (OF_ARGS.hideUi !== false) {
    // Hide every SIBLING of the canvas at every ancestor level. A flat sweep of
    // `document.body.children` does not work and quietly leaves the overlay up:
    // the canvas and the HUD share a wrapper, so the wrapper contains both and
    // is skipped, which is how the first pair of shots came back with the debug
    // panel over a third of the frame.
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

  // Let the streamer settle so the same chunk set is resident in both runs of a
  // pair. Bounded, and the bound is reported: a pair taken across a converged
  // and an unconverged frame is not a pair.
  let spin = 0;
  while (!of.world().chunks.converged && spin++ < 240) await of.run(0.5);
  await of.run(1.0);

  of.look(yaw, pitch);
  // RE-PIN. The wait above consumed a data-dependent amount of sim time.
  of.setTime(sunT);
  await of.settle(30);

  const cover = await of.groundCover(OF_ARGS.halfPx ?? 300, 6);

  // --- aerial perspective: two bands of one capture.
  of.setTime(sunT);
  await of.settle(12);
  const bmp = await createImageBitmap(await of.screenshot());
  const cv = new OffscreenCanvas(bmp.width, bmp.height);
  const ctx = cv.getContext('2d');
  ctx.drawImage(bmp, 0, 0);
  const W = bmp.width; const H = bmp.height;
  const band = (y0f, y1f) => {
    const y0 = Math.round(H * y0f); const y1 = Math.round(H * y1f);
    const d = ctx.getImageData(0, y0, W, Math.max(1, y1 - y0)).data;
    let r = 0; let g = 0; let b = 0; let sat = 0; let n = 0; let dark = 0;
    for (let i = 0; i < d.length; i += 4) {
      const R = d[i]; const G = d[i + 1]; const B = d[i + 2];
      const mx = Math.max(R, G, B); const mn = Math.min(R, G, B);
      if (mx < 10) { dark++; continue; }
      // HSV saturation. A ratio, so it is invariant to the exposure and to the
      // tone curve's effect on overall level, which is what makes the two bands
      // comparable to each other rather than only to themselves.
      sat += (mx - mn) / mx;
      r += R; g += G; b += B; n++;
    }
    const k = Math.max(1, n);
    return {
      px: n, darkPx: dark,
      meanR: +(r / k).toFixed(2), meanG: +(g / k).toFixed(2),
      meanB: +(b / k).toFixed(2),
      saturation: +(sat / k).toFixed(4),
      blueOverRed: +((b / k) / Math.max(1, r / k)).toFixed(4),
    };
  };
  bmp.close();
  // Bands chosen by fraction of frame height so they follow the window size.
  // `near` is ground under and just ahead of the player at a -14 degree pitch;
  // `far` is the strip just below the horizon.
  const nearBand = band(OF_ARGS.nearBand0 ?? 0.80, OF_ARGS.nearBand1 ?? 0.97);
  const farBand = band(OF_ARGS.farBand0 ?? 0.42, OF_ARGS.farBand1 ?? 0.52);
  // THE CONTROL. Aerial perspective is a claim about GROUND at range, and the
  // boundary-layer term that produces it is kept off the sky by its scale
  // height alone rather than by a second set of numbers, so "the sky did not
  // move" is a property that has to be checked and not assumed. A sky band
  // taken from the same capture makes any change attributable: if the far
  // ground moves and the sky does not, the term is doing what it claims.
  const skyBand = band(OF_ARGS.skyBand0 ?? 0.05, OF_ARGS.skyBand1 ?? 0.15);

  // FRAME TIME IS READ LAST, AFTER A RUN THAT CAPTURES NOTHING. `frameMs` is a
  // 600-frame ring, and everything above it here stalls the pipeline to read
  // pixels back: `groundCover` alone takes two full captures. Reading the ring
  // straight after that measures the instrument, not the scene. Four seconds at
  // render rate refills the ring with ordinary frames first.
  of.setTime(sunT);
  await of.run(OF_ARGS.timeSecs ?? 4.0);

  const w = of.world();
  const s = of.stats();
  const p = s.props;

  return {
    valid: w.tick > w0.tick && p.chunks > 0 && cover.samplePx > 0
      && nearBand.px > 1000 && farBand.px > 1000,
    camera: {
      lat, lon, yawDeg: yaw, pitchDeg: pitch, sunT,
      biome: w.biome, converged: w.chunks.converged, convergeSpins: spin,
      viewport: [W, H],
    },
    // --- 1. what the player actually sees on the ground.
    screenCoverage: cover,
    // --- 2. aerial perspective, near band against far band, ONE frame.
    aerial: {
      near: nearBand, far: farBand,
      // The two properties aerial perspective claims. Published as deltas so
      // the sign is the answer and the magnitude is the strength.
      sky: skyBand,
      saturationDrop: +(nearBand.saturation - farBand.saturation).toFixed(4),
      blueShift: +(farBand.blueOverRed - nearBand.blueOverRed).toFixed(4),
    },
    // --- 3. cost, against the budget it is spent from.
    cost: {
      drawCalls: s.draw.calls, drawBudget: s.budget && s.budget.drawCalls,
      triangles: s.draw.triangles, triBudget: s.budget && s.budget.triangles,
      frameMs: s.frameMs, frameBudget: s.budget && s.budget.frameP99,
      passMs: s.passMs, scatterBuildMs: p.buildMs,
      vramEstimateMB: s.vramEstimateMB, programs: s.draw.programs,
      geometries: s.draw.geometries,
    },
    // --- 4. nothing dropped silently.
    silentDrops: {
      poolRefused: p.refused, cellsCapped: p.cellsCapped,
      chunksCapped: p.chunksCapped, scatterBacklog: p.scatterBacklog,
      ok: p.refused === 0 && p.cellsCapped === 0 && p.chunksCapped === 0,
    },
    scatter: {
      chunks: p.chunks, propsPlaced: p.propsPlaced, groundM2: p.groundM2,
      placedPerM2: p.placedPerM2, wantedPerM2: p.wantedPerM2,
      deliveredFraction: p.deliveredFraction,
    },
    pool: {
      instances: p.instances, capacity: p.capacity, ceiling: p.ceiling,
      grows: p.grows, perMaterial: p.perMaterial,
    },
  };
})()
