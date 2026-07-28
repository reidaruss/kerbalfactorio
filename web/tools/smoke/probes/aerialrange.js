// DOES THE AEROSOL TERM STAY OUT OF THE FRAMES IT IS NOT FOR?
//
//   node tools/smoke/run.mjs --scenario=orbit --url=... \
//     --evalfile=tools/smoke/probes/aerialrange.js
//
// The boundary-layer haze added at RN-30 is confined BY PATH, not by height:
// it is a separate GLSL entry point reachable only from a call site that has a
// finite distance to geometry, so the sky quad cannot call it. That closes the
// failure the FIRST attempt was reverted for, and `probes/contact.js` proves it
// with a sky control that reads exactly zero at the surface.
//
// It does NOT close the other one. The same terrain program draws the scaled
// far planet, and a ray from orbit to the ground is a terminating ray, so it
// DOES pick up the term. The vertical column through the layer is exactly
// sigma x H by construction, which is a number (0.18) rather than a hope, but a
// number that predicts 16% haze on the whole planet is worth photographing
// before it is believed. This probe takes the same measurement at whatever
// altitude the scenario puts the camera at, with the term on and off, one page,
// one settled frame apart.
(async () => {
  const of = window.__of;
  const atmos = window.__ofAtmos;
  if (!atmos) throw new Error('aerialrange.js: __ofAtmos handle missing');
  const sunT = OF_ARGS.sunT ?? 0.30;

  let node = document.querySelector('canvas');
  while (node !== null && node.parentElement !== null) {
    for (const sib of Array.from(node.parentElement.children)) {
      if (sib !== node) sib.style.display = 'none';
    }
    node = node.parentElement;
  }

  const w0 = of.world();
  of.setTime(sunT);
  await of.run(2.0);
  let spin = 0;
  while (!of.world().chunks.converged && spin++ < 240) await of.run(0.5);
  of.setTime(sunT);
  await of.settle(30);

  let W = 0;
  let H = 0;
  const grab = async () => {
    of.setTime(sunT);
    await of.settle(8);
    const bmp = await createImageBitmap(await of.screenshot());
    W = bmp.width; H = bmp.height;
    const cv = new OffscreenCanvas(W, H);
    const ctx = cv.getContext('2d');
    ctx.drawImage(bmp, 0, 0);
    const d = ctx.getImageData(0, 0, W, H).data;
    bmp.close();
    return d;
  };

  /**
   * Mean colour and HSV saturation of every pixel that is not near-black, plus
   * the count. The planet disc against space is separable by luminance alone at
   * these altitudes, and a threshold beats a hand-placed box because the disc
   * moves with the scenario.
   */
  const disc = (a) => {
    let n = 0; let r = 0; let g = 0; let b = 0; let sat = 0;
    for (let i = 0; i < a.length; i += 4) {
      const R = a[i]; const G = a[i + 1]; const B = a[i + 2];
      const mx = Math.max(R, G, B);
      if (mx < 24) continue;
      const mn = Math.min(R, G, B);
      sat += (mx - mn) / mx;
      r += R; g += G; b += B; n++;
    }
    const k = Math.max(1, n);
    return {
      px: n, coveredFraction: +(n / Math.max(1, a.length / 4)).toFixed(4),
      meanR: +(r / k).toFixed(2), meanG: +(g / k).toFixed(2), meanB: +(b / k).toFixed(2),
      saturation: +(sat / k).toFixed(4),
    };
  };

  atmos.setAerial(true);
  const on = await grab();
  atmos.setAerial(false);
  const off = await grab();
  atmos.setAerial(true);

  const w = of.world();
  const dOn = disc(on);
  const dOff = disc(off);
  // Absolute per-channel movement over the WHOLE frame, so a change confined to
  // the disc cannot hide inside a mean that includes space.
  let moved = 0; let peak = 0; let sum = 0;
  for (let i = 0; i < on.length; i += 4) {
    let m = 0;
    for (let c = 0; c < 3; ++c) m = Math.max(m, Math.abs(on[i + c] - off[i + c]));
    sum += m;
    if (m > 2) moved++;
    if (m > peak) peak = m;
  }
  const px = on.length / 4;
  return {
    valid: w.tick > w0.tick && W > 0 && dOn.px > 1000,
    camera: {
      scenario: w.scenario, altM: w.altM, regime: w.regime, sunT,
      viewport: [W, H], converged: w.chunks.converged,
    },
    aerosol: atmos.aerosol(),
    withAerial: dOn,
    withoutAerial: dOff,
    delta: {
      saturation: +(dOn.saturation - dOff.saturation).toFixed(4),
      meanR: +(dOn.meanR - dOff.meanR).toFixed(2),
      meanG: +(dOn.meanG - dOff.meanG).toFixed(2),
      meanB: +(dOn.meanB - dOff.meanB).toFixed(2),
      meanAbsWholeFrame: +(sum / px).toFixed(3),
      movedFraction: +(moved / px).toFixed(4),
      peak,
    },
  };
})()
