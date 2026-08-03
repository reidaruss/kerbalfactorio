// R17 scout. Finds a Cinder camera whose frame is ALL GROUND, solves the site's
// own grazing and noon sun times from of.stats().sky.elevationDot (--sundot is
// dead; see the caller's brief), and reports what the frame is made of so the
// measuring probe's band mask can be chosen rather than guessed.
//
// Diagnosis only. Writes nothing, toggles nothing that it does not put back.
(async () => {
  const of = window.__of;
  const art = window.__ofTerrainArt;
  const A = (typeof OF_ARGS === 'object' && OF_ARGS !== null) ? OF_ARGS : {};
  const lat = A.lat ?? -58.0;
  const lon = A.lon ?? -85.6;
  const yaw = A.yawDeg ?? 300;
  const pitch = A.pitchDeg ?? -22;
  const grazeDot = A.grazeDot ?? 0.08;

  // Hide every DOM sibling of the canvas so a returned frame is pixels only.
  let node = document.querySelector('canvas');
  while (node !== null && node.parentElement !== null) {
    for (const sib of Array.from(node.parentElement.children)) {
      if (sib !== node) sib.style.display = 'none';
    }
    node = node.parentElement;
  }

  of.teleport(lat, lon, 2.0);
  let g = 0;
  while (!of.world().chunks.converged && g++ < 240) await of.run(0.25);
  await of.settle(8);
  of.propsVisible(false);
  of.look(yaw, pitch);
  await of.settle(6);

  // THE SUN SCAN. 480 samples of the pinned day, keeping the rising-side sample
  // nearest grazeDot and the global maximum for noon. elevationDot is rounded
  // to 1e-3 by Debug.ts, which is finer than anything claimed off it here.
  const N = A.scanN ?? 480;
  let noonT = 0, noonE = -2, grazeT = -1, grazeErr = 9;
  let prevE = -2;
  const curve = [];
  for (let i = 0; i < N; ++i) {
    const t = i / N;
    of.setTime(t);
    await of.settle(1);
    const e = mustNum(of.stats().sky, 'elevationDot', 'stats.sky');
    if (i % 24 === 0) curve.push([+t.toFixed(4), e]);
    if (e > noonE) { noonE = e; noonT = t; }
    if (e > prevE && e > 0.02) {
      const err = Math.abs(e - grazeDot);
      if (err < grazeErr) { grazeErr = err; grazeT = t; }
    }
    prevE = e;
  }

  const grab = async (t) => {
    of.setTime(t);                 // re-pin: run()/settle() must not drift it
    await of.settle(A.settle ?? 14);
    const blob = await of.screenshot();
    const bmp = await createImageBitmap(blob, {
      premultiplyAlpha: 'none', colorSpaceConversion: 'none',
    });
    const cv = new OffscreenCanvas(bmp.width, bmp.height);
    const cx = cv.getContext('2d', { willReadFrequently: true });
    cx.drawImage(bmp, 0, 0);
    const id = cx.getImageData(0, 0, bmp.width, bmp.height);
    return { w: bmp.width, h: bmp.height, px: id.data, blob };
  };

  const toDataUrl = async (blob) => {
    const buf = new Uint8Array(await blob.arrayBuffer());
    let s = '';
    for (let i = 0; i < buf.length; i += 0x8000) {
      s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
    }
    return `data:image/png;base64,${btoa(s)}`;
  };

  // Row luma profile so the caller can SEE where the horizon is instead of
  // assuming a band. 36 rows, mean and min per row.
  const profile = (f) => {
    const rows = 36;
    const out = [];
    for (let r = 0; r < rows; ++r) {
      const y0 = Math.floor((r * f.h) / rows), y1 = Math.floor(((r + 1) * f.h) / rows);
      let sum = 0, n = 0, lo = 999, hi = -1;
      for (let y = y0; y < y1; y += 2) {
        for (let x = 0; x < f.w; x += 4) {
          const i = (y * f.w + x) * 4;
          const l = (f.px[i] * 77 + f.px[i + 1] * 151 + f.px[i + 2] * 28) >> 8;
          sum += l; n++;
          if (l < lo) lo = l;
          if (l > hi) hi = l;
        }
      }
      out.push([r, +(sum / Math.max(1, n)).toFixed(1), lo, hi]);
    }
    return out;
  };

  const gz = await grab(grazeT >= 0 ? grazeT : noonT);
  const nz = await grab(noonT);

  const w = of.world();
  return {
    site: { lat, lon, yaw, pitch, biome: w.biome, reliefM: w.surfaceHeightM,
            bodyRadiusM: w.bodyRadiusM, converged: w.chunks.converged },
    fixture: {
      reliefTex: art.reliefState(),
      reliefAmpShipped: art.getRelief(),
      reliefGrad: art.getReliefGrad(),
      spec: art.getSpec(),
      nodes: of.nodes().length,
    },
    sun: { grazeT, grazeErrDot: +grazeErr.toFixed(4), noonT, noonElevDot: noonE,
           samples: N, curveEvery24: curve },
    frame: { w: gz.w, h: gz.h },
    grazeRowProfile: profile(gz),
    noonRowProfile: profile(nz),
    grazeUrl: A.images === false ? null : await toDataUrl(gz.blob),
    noonUrl: A.images === false ? null : await toDataUrl(nz.blob),
  };
})()
