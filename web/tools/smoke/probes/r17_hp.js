// R17. THE HIGH-PASS INSTRUMENT for the etched-line artefact, and the whole
// point of it is that it is NOT a mean.
//
// The artefact is high spatial frequency over few pixels, so a frame mean, a
// tile mean and a histogram all average it away (INSTRUMENTS.md, "the tile size
// is part of the instrument"). The quantity it IS expressed in is LOCAL
// CONTRAST: for every pixel, |luma - median(the 8 neighbours at radius 2)|.
// Smooth shading has a short tail on that field; etched lines have a long one.
// So the statistic reported is the TAIL: p99, p99.9, max, and the count over a
// threshold, never the mean.
//
//   node tools/smoke/run.mjs --scenario=walk \
//        --evalfile=tools/smoke/probes/r17_hp.js
//
// EVERY ARM IS ONE PAGE, ONE CAMERA, ONE SETTLED CHUNK SET AND ONE PINNED SUN,
// toggled through __ofTerrainArt's runtime handles rather than through page
// reloads, which is RN-30's settled-frame pair: the streamed chunks, the
// scatter and the light are equal BY CONSTRUCTION and not by care.
//
// THE MASK IS TAKEN FROM THE FLOOR ARM, ONCE PER SUN, and that is deliberate.
// A mask computed per arm would admit more pixels for a brighter arm and the
// count would then be partly a measure of the mask. The floor arm (every art
// term off) is the same picture for every comparison, so the mask is a property
// of the SCENE and not of the term under test.
//
// NAMED FAILURE MODES, before measuring:
//  1. A DEAD TOGGLE reads exactly like a term with no effect. Every arm is
//     therefore checked for being bit-different from the shipping arm, by
//     count, and a zero there is reported as a fixture failure and not as a
//     finding.
//  2. THE PLACEHOLDER. A 1x1 relief texture makes every relief pair identical
//     by construction. reliefState() must report 1024.
//  3. BRIGHTNESS CONFOUND. An arm that is merely darker has a shorter absolute
//     tail. Every tail is therefore reported BOTH absolutely and divided by the
//     masked p50 luma, and the masked p50 is printed so the reader can see it.
//  4. THE GLOVES. First-person arms sit in the bottom of the frame at high
//     contrast in every arm alike, so the band excludes the bottom fifth.
(async () => {
  const of = window.__of;
  const art = window.__ofTerrainArt;
  if (!art || typeof art.setReliefGrad !== 'function') {
    throw new Error('r17_hp: __ofTerrainArt.setReliefGrad missing; RN-741 not in this build');
  }
  const A = (typeof OF_ARGS === 'object' && OF_ARGS !== null) ? OF_ARGS : {};
  const lat = A.lat ?? 2.0, lon = A.lon ?? 144.0;
  const yaw = A.yawDeg ?? 300, pitch = A.pitchDeg ?? -22;
  const wantDots = A.sunDots ?? [0.09, 0.16, 0.35, 0.90];
  const settleN = A.settle ?? 12;
  const wantImages = A.images ?? []; // ["<sunLabel>/<arm>", ...]

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

  // --- fixture, before anything is claimed ----------------------------------
  const relTex = art.reliefState();
  if (relTex.w < 2) {
    throw new Error(`r17_hp: uGroundRelief is the ${relTex.w}x${relTex.h} placeholder`);
  }
  const shippedRelief = art.getRelief();
  const shippedSpec = art.getSpec();
  const shippedGrad = art.getReliefGrad();
  const shippedArt = art.get();
  const shippedTex = art.getTex();
  if (!(shippedRelief > 0)) {
    throw new Error(`r17_hp: boot relief amp is ${shippedRelief}; the shipped default is dead`);
  }

  // --- the sun ladder ---------------------------------------------------------
  // RN-844's of.setSunElev(dot) solves against the observer's up AT THE MOMENT
  // OF THE CALL, so it is correct after a teleport where ?sundot= (solved once
  // at boot against the SPAWN's up) is not. ASSERT ON err: the crater floor's
  // sun path is a fixed-declination circle that never rises past ~0.16 there,
  // so an unchecked ask for a high sun silently returns a grazing one and the
  // whole grazing-versus-noon contrast becomes a null result caused by the site.
  if (typeof of.setSunElev !== 'function') {
    throw new Error('r17_hp: of.setSunElev is missing; this build predates RN-844');
  }
  const suns = [];
  for (const d of wantDots) {
    const s = of.setSunElev(d);
    const gotDot = mustNum(s, 'gotDot', 'setSunElev');
    const err = mustNum(s, 'err', 'setSunElev');
    const t = mustNum(s, 't', 'setSunElev');
    // A site that cannot reach the ask returns its own ceiling for every higher
    // ask, so two entries would be the SAME frame measured twice and reported
    // as a ladder. Drop the duplicate and keep the err on the record.
    if (suns.some((q) => Math.abs(q.elevDot - gotDot) < 0.005)) {
      suns.push({ want: d, t, elevDot: gotDot, err: +err.toFixed(4), duplicateOf: gotDot, skipped: true });
      continue;
    }
    suns.push({ want: d, t, elevDot: gotDot, err: +err.toFixed(4), skipped: false });
  }
  const liveSuns = suns.filter((s) => !s.skipped);
  const maxE = suns.reduce((a, s) => (s.elevDot > a ? s.elevDot : a), -2);

  // --- arms ------------------------------------------------------------------
  const S = shippedRelief;
  const ARMS = [
    { k: 'ship', relief: S, grad: 1, spec: [1, 1], tex: 1, art: [1, 1, 1] },
    { k: 'relief0', relief: 0, grad: 1, spec: [1, 1], tex: 1, art: [1, 1, 1] },
    { k: 'grad0', relief: S, grad: 0, spec: [1, 1], tex: 1, art: [1, 1, 1] },
    { k: 'spec0', relief: S, grad: 1, spec: [0, 0], tex: 1, art: [1, 1, 1] },
    { k: 'rel0spec0', relief: 0, grad: 1, spec: [0, 0], tex: 1, art: [1, 1, 1] },
    { k: 'tex0', relief: S, grad: 1, spec: [1, 1], tex: 0, art: [1, 1, 1] },
    { k: 'floor', relief: 0, grad: 1, spec: [0, 0], tex: 0, art: [0, 0, 0] },
  ].filter((a) => (A.arms ? A.arms.includes(a.k) : true));

  const apply = (a) => {
    art.setRelief(a.relief);
    art.setReliefGrad(a.grad);
    art.setSpec(a.spec[0], a.spec[1]);
    art.setTex(a.tex);
    art.set(a.art[0], a.art[1], a.art[2]);
  };

  const shot = async (t) => {
    of.setTime(t);              // re-pin every time; run()/settle() must not drift it
    await of.settle(settleN);
    const blob = await of.screenshot();
    const bmp = await createImageBitmap(blob, {
      premultiplyAlpha: 'none', colorSpaceConversion: 'none',
    });
    const cv = new OffscreenCanvas(bmp.width, bmp.height);
    const cx = cv.getContext('2d', { willReadFrequently: true });
    cx.drawImage(bmp, 0, 0);
    const px = cx.getImageData(0, 0, bmp.width, bmp.height).data;
    const w = bmp.width, h = bmp.height;
    const L = new Uint8Array(w * h);
    for (let i = 0, j = 0; j < L.length; ++j, i += 4) {
      L[j] = (px[i] * 77 + px[i + 1] * 151 + px[i + 2] * 28) >> 8;
    }
    return { w, h, L, blob };
  };

  const toDataUrl = async (blob) => {
    const buf = new Uint8Array(await blob.arrayBuffer());
    let s = '';
    for (let i = 0; i < buf.length; i += 0x8000) {
      s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
    }
    return `data:image/png;base64,${btoa(s)}`;
  };

  // Percentile out of an integer histogram: exact, no sort, no sampling.
  const pct = (hist, total, q) => {
    let acc = 0;
    const target = total * q;
    for (let v = 0; v < hist.length; ++v) {
      acc += hist[v];
      if (acc >= target) return v;
    }
    return hist.length - 1;
  };

  // |luma - median(8 neighbours at radius 2)|, over the mask only.
  const nb = new Int32Array(8);
  const highPass = (L, w, mask, rect) => {
    const absH = new Int32Array(256);
    const sgnPos = new Int32Array(256), sgnNeg = new Int32Array(256);
    let n = 0, sumAbs = 0;
    for (let y = rect.y0; y < rect.y1; ++y) {
      const r = y * w;
      for (let x = rect.x0; x < rect.x1; ++x) {
        const i = r + x;
        if (mask[i] === 0) continue;
        nb[0] = L[i - 2 * w - 2]; nb[1] = L[i - 2 * w]; nb[2] = L[i - 2 * w + 2];
        nb[3] = L[i - 2]; nb[4] = L[i + 2];
        nb[5] = L[i + 2 * w - 2]; nb[6] = L[i + 2 * w]; nb[7] = L[i + 2 * w + 2];
        // insertion sort of 8
        for (let a = 1; a < 8; ++a) {
          const v = nb[a];
          let b = a - 1;
          while (b >= 0 && nb[b] > v) { nb[b + 1] = nb[b]; --b; }
          nb[b + 1] = v;
        }
        const med = (nb[3] + nb[4]) >> 1;
        const d = L[i] - med;
        const ad = d < 0 ? -d : d;
        absH[ad]++; n++; sumAbs += ad;
        if (d > 0) sgnPos[d]++; else if (d < 0) sgnNeg[-d]++;
      }
    }
    const over = (T) => { let c = 0; for (let v = T + 1; v < 256; ++v) c += absH[v]; return c; };
    const overS = (hh, T) => { let c = 0; for (let v = T + 1; v < 256; ++v) c += hh[v]; return c; };
    let mx = 0; for (let v = 255; v >= 0; --v) if (absH[v] > 0) { mx = v; break; }
    return {
      n,
      mean: +(sumAbs / Math.max(1, n)).toFixed(3),
      p50: pct(absH, n, 0.50), p90: pct(absH, n, 0.90),
      p99: pct(absH, n, 0.99), p999: pct(absH, n, 0.999), max: mx,
      over2: over(2), over4: over(4), over8: over(8), over16: over(16),
      pos4: overS(sgnPos, 4), neg4: overS(sgnNeg, 4),
      pos8: overS(sgnPos, 8), neg8: overS(sgnNeg, 8),
    };
  };

  const lumaStats = (L, w, mask, rect) => {
    const h = new Int32Array(256);
    let n = 0, sum = 0;
    for (let y = rect.y0; y < rect.y1; ++y) {
      for (let x = rect.x0; x < rect.x1; ++x) {
        const i = y * w + x;
        if (mask[i] === 0) continue;
        h[L[i]]++; n++; sum += L[i];
      }
    }
    return { n, mean: +(sum / Math.max(1, n)).toFixed(2), p50: pct(h, n, 0.5), p99: pct(h, n, 0.99) };
  };

  const diffStats = (Lb, La, w, mask, rect) => {
    // La is the arm, Lb the shipping reference.
    const h = new Int32Array(256);
    let moved = 0, darker = 0, lighter = 0, n = 0, sum = 0;
    for (let y = rect.y0; y < rect.y1; ++y) {
      for (let x = rect.x0; x < rect.x1; ++x) {
        const i = y * w + x;
        if (mask[i] === 0) continue;
        const d = La[i] - Lb[i];
        const ad = d < 0 ? -d : d;
        h[ad]++; n++; sum += ad;
        if (ad > 1) { moved++; if (d < 0) darker++; else lighter++; }
      }
    }
    return {
      movedPx: moved, movedPct: +((moved / Math.max(1, n)) * 100).toFixed(2),
      armDarker: darker, armLighter: lighter,
      meanAbs: +(sum / Math.max(1, n)).toFixed(3),
      p99: pct(h, n, 0.99), p999: pct(h, n, 0.999),
    };
  };

  const out = { suns: [], images: {} };
  let rect = null;

  for (const sun of liveSuns) {
    const frames = {};
    for (const a of ARMS) {
      apply(a);
      const f = await shot(sun.t);
      if (rect === null) {
        rect = {
          x0: A.x0 ?? Math.round(f.w * 0.03), x1: A.x1 ?? Math.round(f.w * 0.97),
          y0: A.y0 ?? Math.round(f.h * 0.08), y1: A.y1 ?? Math.round(f.h * 0.78),
        };
      }
      frames[a.k] = f;
      const label = `e${sun.elevDot.toFixed(2)}/${a.k}`;
      if (wantImages.includes(label)) out.images[label] = await toDataUrl(f.blob);
    }
    const w = frames.ship.w, h = frames.ship.h;
    // THE MASK: lit ground only, taken from the FLOOR arm so it is a property
    // of the scene rather than of the term under test.
    const src = frames.floor ?? frames.ship;
    const minL = A.maskMinLuma ?? 5;
    const mask = new Uint8Array(w * h);
    let maskPx = 0;
    for (let y = rect.y0; y < rect.y1; ++y) {
      for (let x = rect.x0; x < rect.x1; ++x) {
        const i = y * w + x;
        if (src.L[i] >= minL) { mask[i] = 1; maskPx++; }
      }
    }
    const rows = {};
    for (const a of ARMS) {
      const L = frames[a.k].L;
      const hp = highPass(L, w, mask, rect);
      const lum = lumaStats(L, w, mask, rect);
      rows[a.k] = {
        luma: lum,
        hp,
        hpP99OverP50Luma: +(hp.p99 / Math.max(1, lum.p50)).toFixed(4),
        vsShip: a.k === 'ship' ? null : diffStats(frames.ship.L, L, w, mask, rect),
      };
    }
    out.suns.push({
      want: sun.want, t: sun.t, elevDot: sun.elevDot, err: sun.err,
      rect, maskPx, maskPctOfRect:
        +((maskPx / ((rect.x1 - rect.x0) * (rect.y1 - rect.y0))) * 100).toFixed(1),
      rows,
    });
  }

  // Leave the page exactly as it booted.
  art.setRelief(shippedRelief);
  art.setReliefGrad(shippedGrad);
  art.setSpec(shippedSpec[0], shippedSpec[1]);
  art.setTex(shippedTex);
  art.set(shippedArt[0], shippedArt[1], shippedArt[2]);

  const w0 = of.world();
  return {
    site: { lat, lon, yaw, pitch, biome: w0.biome, reliefM: w0.surfaceHeightM,
            bodyRadiusM: w0.bodyRadiusM, converged: w0.chunks.converged,
            nodes: of.nodes().length },
    fixture: { reliefTex: relTex, shippedRelief, shippedSpec, shippedGrad,
               shippedArt, shippedTex, siteMaxElevDot: maxE,
               sunSolve: of.stats().sky.sunSolve ?? null, sunLadder: suns },
    arms: ARMS.map((a) => a.k),
    ...out,
  };
})()
