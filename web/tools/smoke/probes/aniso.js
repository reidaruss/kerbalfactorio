// RN-843 FOLLOW-UP. THE ANISOTROPY INSTRUMENT, and the whole reason it exists
// is that the RN-843 sweep metric (`over8`, a count of local contrast) cannot
// tell "less artefact" from "less signal". Swept 1 to 64 texels it points
// OPPOSITE ways at the two test bodies, because at 1 texel the near beach gains
// a fine ripple that reads as REAL WET SAND and a contrast counter scores that
// ripple as artefact.
//
// THE PHYSICAL CLAIM BEING TURNED INTO A NUMBER. A corduroy/contour artefact
// stamped by a fixed-length finite-difference support has a PREFERRED
// DIRECTION and a PREFERRED WAVELENGTH. An isotropic mottle (real ground
// detail) has neither. So the discriminator is the DIRECTIONAL CONCENTRATION
// of the high-pass field's energy, not its magnitude.
//
// WHAT IS COMPUTED, in order:
//   1. A FIXED SCREEN RECTANGLE of ground. Geometric selection only: no
//      threshold on luma, contrast, gradient or high-pass energy anywhere.
//      That is deliberate and it is the RN-843 defect one level up: the sweep
//      MOVES the high-pass energy, so a mask keyed on it would select a
//      different population at every rung and the index would be partly a
//      measure of the mask. Pixel count per row is reported and it is a
//      constant of the sweep by construction.
//   2. Per patch: subtract the patch mean, multiply by a separable Hann window.
//      The window is not decoration. A rectangular window leaks a bright CROSS
//      along kx=0 and ky=0 in the transform, which is pure screen-axis
//      anisotropy manufactured by the instrument itself.
//   3. 2D FFT (radix-2, written here, no dependency). Power normalised by
//      S^2 * sum(w^2) so that summing power over a band gives the VARIANCE
//      contribution of that band in luma counts squared, i.e. sqrt of it is an
//      RMS in luma counts. That is the raw-energy guard: it is reported beside
//      the index in every row so "flat and isotropic" cannot be mistaken for
//      "detailed and isotropic".
//   4. HIGH-PASS BY ANNULUS. Only coefficients with radius in [rMin, rMax)
//      count, which is the frequency-domain form of "subtract a blur" and
//      removes the terrain's own large-scale slope and shading by
//      construction. Reported per octave band as well as over a headline band.
//   5. THE INDEX. Orientation is mod 180 degrees, so the doubled-angle
//      resultant is the right statistic:
//         A = |SUM_k P_k * exp(2*i*theta_k)| / SUM_k P_k
//      It is 0 for a perfectly isotropic field and 1 for all energy at one
//      orientation, which is exactly the requested scale. Half the argument of
//      the resultant is the preferred orientation of the SPECTRUM; stripes in
//      the image run 90 degrees to it.
//   6. THE DIFFERENCE SPECTRUM, and this is the move that isolates the term.
//      The floor arm (relief amplitude 0) and the rung arm are the same camera,
//      the same streamed chunks, the same sun and NO SIM TICKS BETWEEN THEM, so
//      they are pixel-registered. Power spectra of independent components add,
//      so P_rung - P_floor is, to first order, the relief term's OWN spectrum,
//      with the albedo texture, the player's shadow, the slope and the biome
//      removed. A is computed on that difference as well as on the raw frame.
//
// NAMED FAILURE MODES, BEFORE MEASURING. All three are ways for an isotropic
// field to measure as anisotropic:
//   (a) THE TERRAIN'S OWN LARGE-SCALE SLOPE. A slope is low spatial frequency.
//       It is excluded by the annulus, and it is in the floor arm too, so the
//       difference spectrum removes whatever leaks.
//   (b) PERSPECTIVE FORESHORTENING, AND IT IS THE BIG ONE. A ground plane seen
//       at depression angle p compresses by 1/sin(p) along the screen-vertical
//       axis, so ANY isotropic ground texture measures as anisotropic with axis
//       ratio 1/sin(p). At the shipped walking camera (pitch -8) that is 7.19
//       to 1 and the measurement would be meaningless. Handled by AIMING THE
//       CAMERA STEEPLY DOWN: at pitch -85 the ratio is 1.004 at the patch
//       centre. The residual is PRICED, not asserted: mode 'synth' runs a
//       synthetic isotropic field squashed by exactly those ratios through this
//       exact pipeline and reports what each ratio costs in A.
//   (c) THE RENDER'S OWN GRID. Pixel grid, bilinear taps and any screen-axis
//       post filter put energy at exactly 0 and 90 degrees. Every row therefore
//       also reports A with the +/-8 degree wedges around 0 and 90 EXCLUDED. If
//       A collapses to the isotropic floor when those wedges go, the
//       anisotropy was the grid and not a contour artefact.
//
// MODES: 'synth' validates the pipeline on fields whose answer is known before
// any frame is touched; 'scout' captures one frame and reports what the patches
// are made of; 'sweep' is the measurement.
(async () => {
  const A = (typeof OF_ARGS === 'object' && OF_ARGS !== null) ? OF_ARGS : {};
  const mode = A.mode || 'sweep';
  const S = A.patch || 256;                 // patch edge, power of two
  const NB = 36;                            // angular bins, 5 degrees each
  const rMin = A.rMin ?? 6;                 // cycles per patch; 6 -> 42.7 px
  const rMax = A.rMax ?? 110;               // 110 -> 2.33 px, short of Nyquist
  const axisWedgeDeg = A.axisWedgeDeg ?? 8;

  // ------------------------------------------------------------------ FFT ---
  const LOG = Math.round(Math.log2(S));
  if ((1 << LOG) !== S) throw new Error(`aniso: patch ${S} is not a power of two`);
  const twC = new Float64Array(S / 2), twS = new Float64Array(S / 2);
  for (let i = 0; i < S / 2; ++i) {
    twC[i] = Math.cos((-2 * Math.PI * i) / S);
    twS[i] = Math.sin((-2 * Math.PI * i) / S);
  }
  const fft = (re, im) => {
    for (let i = 1, j = 0; i < S; ++i) {
      let bit = S >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) {
        let t = re[i]; re[i] = re[j]; re[j] = t;
        t = im[i]; im[i] = im[j]; im[j] = t;
      }
    }
    for (let len = 2; len <= S; len <<= 1) {
      const half = len >> 1, step = S / len;
      for (let i = 0; i < S; i += len) {
        for (let k = 0; k < half; ++k) {
          const w = k * step, wr = twC[w], wi = twS[w];
          const ar = re[i + k], ai = im[i + k];
          const br = re[i + k + half], bi = im[i + k + half];
          const vr = br * wr - bi * wi, vi = br * wi + bi * wr;
          re[i + k] = ar + vr; im[i + k] = ai + vi;
          re[i + k + half] = ar - vr; im[i + k + half] = ai - vi;
        }
      }
    }
  };

  // Separable Hann. sumW2 is what turns |X|^2 into a variance in luma counts.
  const win = new Float64Array(S);
  for (let i = 0; i < S; ++i) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (S - 1));
  let sumW2 = 0;
  for (let y = 0; y < S; ++y) for (let x = 0; x < S; ++x) sumW2 += (win[y] * win[x]) ** 2;

  const rowRe = new Float64Array(S), rowIm = new Float64Array(S);
  /** field: Float64Array S*S of luma. Returns normalised power, S*S, kx fastest. */
  const power = (field) => {
    let mean = 0;
    for (let i = 0; i < S * S; ++i) mean += field[i];
    mean /= S * S;
    const re = new Float64Array(S * S), im = new Float64Array(S * S);
    for (let y = 0; y < S; ++y) {
      for (let x = 0; x < S; ++x) re[y * S + x] = (field[y * S + x] - mean) * win[y] * win[x];
    }
    for (let y = 0; y < S; ++y) {
      rowRe.set(re.subarray(y * S, y * S + S)); rowIm.fill(0);
      fft(rowRe, rowIm);
      re.set(rowRe, y * S); im.set(rowIm, y * S);
    }
    for (let x = 0; x < S; ++x) {
      for (let y = 0; y < S; ++y) { rowRe[y] = re[y * S + x]; rowIm[y] = im[y * S + x]; }
      fft(rowRe, rowIm);
      for (let y = 0; y < S; ++y) { re[y * S + x] = rowRe[y]; im[y * S + x] = rowIm[y]; }
    }
    const P = new Float64Array(S * S);
    const nrm = 1 / (S * S * sumW2);
    for (let i = 0; i < S * S; ++i) P[i] = (re[i] * re[i] + im[i] * im[i]) * nrm;
    return P;
  };

  // ------------------------------------------------------- angular statistic -
  // Precomputed geometry, so the per-row loop is arithmetic only.
  const gR = new Float64Array(S * S), gC2 = new Float64Array(S * S);
  const gS2 = new Float64Array(S * S), gBin = new Int32Array(S * S);
  const gAxis = new Uint8Array(S * S);
  for (let ky = 0; ky < S; ++ky) {
    const fy = ky <= S / 2 ? ky : ky - S;
    for (let kx = 0; kx < S; ++kx) {
      const fx = kx <= S / 2 ? kx : kx - S;
      const i = ky * S + kx;
      gR[i] = Math.sqrt(fx * fx + fy * fy);
      let th = Math.atan2(fy, fx);
      if (th < 0) th += Math.PI;                 // orientation, mod 180 deg
      if (th >= Math.PI) th -= Math.PI;
      gC2[i] = Math.cos(2 * th); gS2[i] = Math.sin(2 * th);
      gBin[i] = Math.min(NB - 1, Math.floor((th / Math.PI) * NB));
      const d0 = Math.min(th, Math.PI - th) * 180 / Math.PI;
      const d90 = Math.abs(th - Math.PI / 2) * 180 / Math.PI;
      gAxis[i] = (d0 < axisWedgeDeg || d90 < axisWedgeDeg) ? 1 : 0;
    }
  }
  const r3 = (v) => Math.round(v * 1000) / 1000;
  const r4 = (v) => Math.round(v * 10000) / 10000;

  const band = (P, lo, hi, dropAxis) => {
    let s1 = 0, c2 = 0, s2 = 0, n = 0;
    const hist = new Float64Array(NB);
    for (let i = 0; i < S * S; ++i) {
      const r = gR[i];
      if (r < lo || r >= hi) continue;
      if (dropAxis && gAxis[i]) continue;
      const p = P[i];
      s1 += p; c2 += p * gC2[i]; s2 += p * gS2[i]; ++n;
      hist[gBin[i]] += p;
    }
    const mag = Math.hypot(c2, s2);
    let thDeg = (0.5 * Math.atan2(s2, c2) * 180) / Math.PI;
    if (thDeg < 0) thDeg += 180;
    const hn = [];
    for (let b = 0; b < NB; ++b) hn.push(s1 > 0 ? r4(hist[b] / s1) : 0);
    return {
      // A: 0 isotropic, 1 all energy at one orientation. Sign of s1 matters for
      // the difference spectrum, where a rung with LESS energy than the floor in
      // a band would give a negative s1; that is reported rather than hidden.
      A: s1 !== 0 ? r4(mag / s1) : null,
      // The raw energy guard the controller asked for, in luma counts.
      rms: s1 > 0 ? r3(Math.sqrt(s1)) : (s1 < 0 ? -r3(Math.sqrt(-s1)) : 0),
      energy: r3(s1),
      thetaDeg: r3(thDeg),
      coeffs: n,
      hist: hn,
    };
  };

  // The band has to span the WHOLE sweep or it is not a fair instrument: the
  // support sets the artefact's wavelength, so a band that tops out short of
  // the 64-texel rung's stamp would under-measure exactly one end of the sweep
  // and hand the answer to the other. At the pinned camera one relief texel is
  // about 1.8 px, so rungs 1 to 64 texels stamp between roughly 4 and 234 px
  // and the annulus is set to cover 2.3 px to half the patch.
  const OCTAVES = A.octaves || [[2, 4], [4, 8], [8, 16], [16, 32], [32, 64], [64, 128], [128, 220]];
  const RADII = A.radii || [1.5, 2, 3, 4, 6, 8, 11, 16, 22, 32, 45, 64, 90, 128, 180, 250];
  const radial = (P) => {
    const out = [];
    for (let b = 0; b + 1 < RADII.length; ++b) {
      let s = 0, n = 0;
      for (let i = 0; i < S * S; ++i) {
        if (gR[i] >= RADII[b] && gR[i] < RADII[b + 1]) { s += P[i]; ++n; }
      }
      const rc = 0.5 * (RADII[b] + RADII[b + 1]);
      out.push({ lamPx: r3(S / rc), energy: r3(s), perCoeff: n > 0 ? +(s / n).toExponential(3) : 0 });
    }
    return out;
  };

  // ------------------------------------- THE SECOND INSTRUMENT: LOCAL LINEARITY
  // THE FFT INDEX ABOVE HAS ONE BLIND SPOT AND IT IS THE ARTEFACT'S OWN NAME.
  // Reid calls this "contour lines SCRIBBLED on the ground". A scribble is a
  // field of thin CURVED lines: locally one-dimensional everywhere, globally
  // isotropic, because every orientation is present somewhere. The global
  // doubled-angle resultant reads such a field as ISOTROPIC and scores it the
  // same as a mottle. That is a second version of the RN-843 mistake, so both
  // statistics are computed and both are reported.
  //
  // WHAT THIS COMPUTES. On a Gaussian-ish pyramid (repeated 2x2 box decimation,
  // so level L is scale 2^L px), form the structure tensor of the image
  // gradient, box-smoothed over 7x7:
  //     J = [[<gx gx>, <gx gy>], [<gx gy>, <gy gy>]]
  // Its eigenvalues are l1 >= l2 >= 0. The LOCAL coherence is
  //     c = (l1 - l2)/(l1 + l2) = sqrt((Jxx-Jyy)^2 + 4 Jxy^2) / (Jxx + Jyy),
  // which is 0 where the structure is locally isotropic and 1 where it is
  // locally a straight line or edge, WHATEVER its direction. Summing numerator
  // and denominator separately over the patch gives the ENERGY-WEIGHTED mean
  // coherence, which is the right pooling: a black shadow contributes no
  // gradient energy and therefore no vote, and the statistic is a SHAPE measure
  // that cannot be moved by overall contrast.
  //
  // The same tensor also gives the global resultant at that scale for free,
  //     Aglob = |(sum(Jxx-Jyy), sum(2 Jxy))| / sum(Jxx+Jyy),
  // which agrees with the FFT index and is reported beside it as a check that
  // two independent derivations of the same quantity land in the same place.
  //
  // WHY A PYRAMID AND NOT ONE SCALE. The support IS the artefact's wavelength,
  // so a single fixed gradient scale would be tuned to one rung of the sweep
  // and would hand that rung the answer. Every level is reported for every
  // rung, and each rung's stamp shows up at its own level.
  const PLEVELS = A.pyramidLevels ?? 7;
  const decimate = (f, n) => {
    const m = n >> 1;
    const o = new Float64Array(m * m);
    for (let y = 0; y < m; ++y) {
      for (let x = 0; x < m; ++x) {
        o[y * m + x] = 0.25 * (f[(2 * y) * n + 2 * x] + f[(2 * y) * n + 2 * x + 1]
                             + f[(2 * y + 1) * n + 2 * x] + f[(2 * y + 1) * n + 2 * x + 1]);
      }
    }
    return o;
  };
  const TW = A.tensorWin ?? 3;             // half-width; 3 -> 7x7 = 49 samples
  /** Structure-tensor read of one level. Returns the pooled sums, so several
   *  patches can be pooled before the ratio is taken. */
  const tensorSums = (f, n) => {
    const xx = new Float64Array(n * n), yy = new Float64Array(n * n), xy = new Float64Array(n * n);
    for (let y = 1; y < n - 1; ++y) {
      for (let x = 1; x < n - 1; ++x) {
        const gx = 0.5 * (f[y * n + x + 1] - f[y * n + x - 1]);
        const gy = 0.5 * (f[(y + 1) * n + x] - f[(y - 1) * n + x]);
        const i = y * n + x;
        xx[i] = gx * gx; yy[i] = gy * gy; xy[i] = gx * gy;
      }
    }
    // Separable box smoothing of each component, via a running sum.
    const box = (src) => {
      const t = new Float64Array(n * n), o = new Float64Array(n * n);
      for (let y = 0; y < n; ++y) {
        let acc = 0;
        for (let x = 0; x <= TW && x < n; ++x) acc += src[y * n + x];
        for (let x = 0; x < n; ++x) {
          t[y * n + x] = acc;
          if (x - TW >= 0) acc -= src[y * n + x - TW];
          if (x + TW + 1 < n) acc += src[y * n + x + TW + 1];
        }
      }
      for (let x = 0; x < n; ++x) {
        let acc = 0;
        for (let y = 0; y <= TW && y < n; ++y) acc += t[y * n + x];
        for (let y = 0; y < n; ++y) {
          o[y * n + x] = acc;
          if (y - TW >= 0) acc -= t[(y - TW) * n + x];
          if (y + TW + 1 < n) acc += t[(y + TW + 1) * n + x];
        }
      }
      return o;
    };
    const Jxx = box(xx), Jyy = box(yy), Jxy = box(xy);
    // The border is dropped: its box window is truncated, so its tensor is
    // computed over fewer samples and is biased. Dropped by GEOMETRY (a fixed
    // inset), not by any threshold, so the population is a constant.
    const m = TW + 2;
    let sTrace = 0, sDisc = 0, sDx = 0, sDy = 0, cnt = 0;
    for (let y = m; y < n - m; ++y) {
      for (let x = m; x < n - m; ++x) {
        const i = y * n + x;
        const tr = Jxx[i] + Jyy[i];
        const dxx = Jxx[i] - Jyy[i], dxy = 2 * Jxy[i];
        sTrace += tr;
        sDisc += Math.sqrt(dxx * dxx + dxy * dxy);
        sDx += dxx; sDy += dxy;
        ++cnt;
      }
    }
    return { sTrace, sDisc, sDx, sDy, cnt };
  };
  /** Pyramid of tensor sums for one patch. */
  const pyramid = (field) => {
    const out = [];
    let f = field, n = S;
    for (let L = 0; L < PLEVELS && n >= 32; ++L) {
      out.push({ level: L, scalePx: 1 << L, n, ...tensorSums(f, n) });
      f = decimate(f, n); n >>= 1;
    }
    return out;
  };
  const pyramidRead = (pooled) => pooled.map((p) => ({
    scalePx: p.scalePx,
    // 0 locally isotropic, 1 locally a line/edge at ANY orientation
    coh: p.sTrace > 0 ? r4(p.sDisc / p.sTrace) : null,
    // 0 isotropic, 1 all energy at ONE orientation. The FFT index's twin.
    Aglob: p.sTrace > 0 ? r4(Math.hypot(p.sDx, p.sDy) / p.sTrace) : null,
    // the raw-energy guard: RMS gradient magnitude, in luma counts per pixel
    gradRms: r3(Math.sqrt(p.sTrace / Math.max(1, p.cnt * (2 * TW + 1) * (2 * TW + 1)))),
    px: p.cnt,
  }));

  /** The whole read of one power spectrum. */
  const describe = (P) => ({
    headline: band(P, rMin, rMax, false),
    headlineOffAxis: band(P, rMin, rMax, true),
    octaves: OCTAVES.map(([lo, hi]) => {
      const b = band(P, lo, hi, false);
      return { lamPx: [r3(S / hi), r3(S / lo)], A: b.A, rms: b.rms, thetaDeg: b.thetaDeg };
    }),
    radial: radial(P),
  });

  // ------------------------------------------------ the RN-843 contrast metric
  // Same pixels, same rectangle, so the two instruments are comparable row by
  // row. RADIUS 2 is reliefsweep.js's statistic VERBATIM: |luma - mean(4
  // neighbours at radius 2)|, counted over 4, 8 and 16.
  //
  // RADIUS 8 AND 32 ARE ADDED, and the reason is a finding rather than a
  // decoration. The support stamps a wavelength of roughly 2e, which at this
  // camera is about 120 px at the shipped default, and a radius-2 cross cannot
  // see a 120 px ripple AT ALL: it reads over8 = 0 on a frame that is nothing
  // but corduroy by eye. Reporting the contrast metric at one radius only would
  // therefore be reporting its blindness as a measurement. Every radius is
  // reported for every arm so the contrast metric is given its best shot.
  const CRADII = A.contrastRadii || [2, 8, 32];
  const contrast = (field) => {
    let lsum = 0, n0 = 0;
    for (let i = 0; i < S * S; ++i) { lsum += field[i]; ++n0; }
    const out = { n: n0, lumaMean: r3(lsum / n0), byRadius: {} };
    for (const RAD of CRADII) {
      let o4 = 0, o8 = 0, o16 = 0, n = 0;
      const hp = [];
      for (let y = RAD; y < S - RAD; ++y) {
        for (let x = RAD; x < S - RAD; ++x) {
          const c = field[y * S + x];
          ++n;
          const bg = (field[(y - RAD) * S + x] + field[(y + RAD) * S + x]
                    + field[y * S + (x - RAD)] + field[y * S + (x + RAD)]) / 4;
          const d = Math.abs(c - bg);
          hp.push(d);
          if (d > 4) ++o4; if (d > 8) ++o8; if (d > 16) ++o16;
        }
      }
      hp.sort((a, b) => a - b);
      const q = (f) => hp[Math.min(hp.length - 1, Math.floor(f * hp.length))];
      out.byRadius[RAD] = { n, over4: o4, over8: o8, over16: o16, p99: r3(q(0.99)) };
    }
    return out;
  };

  // --------------------------------------------------------------- synthetic -
  // VALIDATE THE INSTRUMENT ON CASES WHOSE ANSWER IS KNOWN BEFORE TRUSTING IT
  // ON A CASE WHOSE ANSWER IS NOT. Same `power`, same `band`, same everything.
  const mulberry = (a) => () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const gauss = (rnd) => {
    const u = Math.max(1e-12, rnd()), v = rnd();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  /** Wrap-around separable Gaussian blur, sigma sx in x and sy in y. An
   *  ISOTROPIC field is sx === sy; a FORESHORTENED one has sx/sy = the axis
   *  ratio 1/sin(pitch), which is the trap being priced. */
  const blur = (f, sx, sy) => {
    const kern = (s) => {
      if (s <= 0.01) return [1];
      const rad = Math.max(1, Math.ceil(3 * s));
      const k = [];
      let sum = 0;
      for (let i = -rad; i <= rad; ++i) { const v = Math.exp((-i * i) / (2 * s * s)); k.push(v); sum += v; }
      return k.map((v) => v / sum);
    };
    const kx = kern(sx), ky = kern(sy);
    const rx = (kx.length - 1) / 2, ry = (ky.length - 1) / 2;
    const t = new Float64Array(S * S), o = new Float64Array(S * S);
    for (let y = 0; y < S; ++y) {
      for (let x = 0; x < S; ++x) {
        let a = 0;
        for (let i = 0; i < kx.length; ++i) a += kx[i] * f[y * S + (((x + i - rx) % S) + S) % S];
        t[y * S + x] = a;
      }
    }
    for (let y = 0; y < S; ++y) {
      for (let x = 0; x < S; ++x) {
        let a = 0;
        for (let i = 0; i < ky.length; ++i) a += ky[i] * t[((((y + i - ry) % S) + S) % S) * S + x];
        o[y * S + x] = a;
      }
    }
    return o;
  };
  const rmsOf = (f) => {
    let m = 0; for (let i = 0; i < f.length; ++i) m += f[i];
    m /= f.length;
    let v = 0; for (let i = 0; i < f.length; ++i) v += (f[i] - m) ** 2;
    return Math.sqrt(v / f.length);
  };
  const scaleTo = (f, target) => {
    const s = target / Math.max(1e-9, rmsOf(f));
    const o = new Float64Array(f.length);
    for (let i = 0; i < f.length; ++i) o[i] = f[i] * s;
    return o;
  };

  const runSynth = () => {
    const rnd = mulberry(A.seed ?? 12345);
    const white = new Float64Array(S * S);
    for (let i = 0; i < S * S; ++i) white[i] = gauss(rnd);
    const base = A.synthSigma ?? 2.0;
    // The isotropic reference. rms 8 luma counts, the order of the real tail.
    const iso = scaleTo(blur(white, base, base), 8);
    const rows = [];
    const add = (name, f, note) => {
      const P = power(f);
      const d = describe(P);
      const py = pyramidRead(pyramid(f));
      rows.push({
        name, note,
        A: d.headline.A, AoffAxis: d.headlineOffAxis.A,
        rms: d.headline.rms, thetaDeg: d.headline.thetaDeg,
        coeffs: d.headline.coeffs,
        octaveA: d.octaves.map((o) => o.A),
        coh: py.map((p) => p.coh),
        pyrA: py.map((p) => p.Aglob),
        gradRms: py.map((p) => p.gradRms),
      });
      return d;
    };
    add('iso', iso, 'isotropic mottle, sigma 2 px, the null case');
    add('white', scaleTo(white, 8), 'pure white noise, the other null case');
    // FORESHORTENING. Axis ratio 1/sin(depression). The list runs from the
    // worst corner of the patch band this probe actually uses (1.07) through
    // the shipped walking camera (pitch -8, 7.19:1), so the trap is PRICED at
    // the exact ratio the measurement is exposed to and not merely named.
    for (const depDeg of (A.synthDepressionsDeg ?? [90, 85, 69, 60, 45, 22, 8])) {
      const f = 1 / Math.sin((depDeg * Math.PI) / 180);
      add(`iso_dep${depDeg}`, scaleTo(blur(white, base * f, base), 8),
          `isotropic ground foreshortened by ${r3(f)}:1, i.e. viewed at ${depDeg} deg depression`);
    }
    // CORDUROY at a known oblique angle, over the isotropic mottle, at a range
    // of strengths relative to it. 27 degrees is off both screen axes on
    // purpose, so a hit cannot be the render grid.
    const phi = (A.synthPhiDeg ?? 27) * Math.PI / 180;
    const lam = A.synthLamPx ?? 16;
    for (const k of (A.synthAmps ?? [0.1, 0.2, 0.35, 0.5, 1.0, 2.0])) {
      const f = new Float64Array(S * S);
      const amp = 8 * k * Math.SQRT2;              // k = corduroy rms / mottle rms
      for (let y = 0; y < S; ++y) {
        for (let x = 0; x < S; ++x) {
          f[y * S + x] = iso[y * S + x]
            + amp * Math.sin((2 * Math.PI * (x * Math.cos(phi) + y * Math.sin(phi))) / lam);
        }
      }
      add(`cord_${k}`, f, `iso + corduroy at ${A.synthPhiDeg ?? 27} deg, lambda ${lam} px, rms ratio ${k}`);
    }
    // THE SCRIBBLE, and it is the case the FFT index is expected to FAIL and
    // the coherence is expected to catch. `sin(2 pi g / T)` on a smooth
    // isotropic random field g is a set of nested contour bands: locally a set
    // of one-dimensional lines everywhere, globally isotropic because every
    // orientation occurs somewhere. It is a synthetic of Reid's own words,
    // "contour lines SCRIBBLED on the ground".
    {
      const w2 = new Float64Array(S * S);
      for (let i = 0; i < S * S; ++i) w2[i] = gauss(rnd);
      const g = scaleTo(blur(w2, A.scribbleSigma ?? 8, A.scribbleSigma ?? 8), 1);
      const T = A.scribblePeriod ?? 0.5;
      const f = new Float64Array(S * S);
      for (let i = 0; i < S * S; ++i) f[i] = 8 * Math.sin((2 * Math.PI * g[i]) / T);
      add('scribble', f, 'isotropic field of curved contour bands: locally 1-D, globally isotropic');
      const mix = new Float64Array(S * S);
      for (let i = 0; i < S * S; ++i) mix[i] = iso[i] + 0.5 * f[i];
      add('scribble_mix', mix, 'iso mottle + half-strength scribble');
    }
    // The saturation end: corduroy alone must read 1.
    {
      const f = new Float64Array(S * S);
      for (let y = 0; y < S; ++y) {
        for (let x = 0; x < S; ++x) {
          f[y * S + x] = 8 * Math.sin((2 * Math.PI * (x * Math.cos(phi) + y * Math.sin(phi))) / lam);
        }
      }
      add('cord_only', f, 'the corduroy alone, the A = 1 end of the scale');
    }
    return rows;
  };

  if (mode === 'synth') {
    return { valid: true, mode, S, rMin, rMax, axisWedgeDeg, sumW2: r3(sumW2), synth: runSynth() };
  }

  // ================================================================== the game
  const of = window.__of;
  const art = window.__ofTerrainArt;
  const fails = [];
  const check = (name, ok, detail) => { if (!ok) fails.push(detail === undefined ? name : `${name}: ${detail}`); };

  const lat = A.lat ?? 2.0, lon = A.lon ?? 144.0;
  const yaw = A.yaw ?? 40, pitch = A.pitch ?? -85;
  const sundot = A.sundot ?? 0.28;
  const texels = A.texels || [1, 2, 4, 8, 16, 24, 31.85, 48, 64];

  // Hide every DOM sibling of the canvas, so the returned PNG is pixels only.
  let node = document.querySelector('canvas');
  while (node !== null && node.parentElement !== null) {
    for (const sib of Array.from(node.parentElement.children)) {
      if (sib !== node) sib.style.display = 'none';
    }
    node = node.parentElement;
  }

  // Fixture BEFORE anything is read (GP-142).
  const dflt = art.reliefGradUvDefault();
  check('the shipped support is what this sweep is measured against',
        Math.abs(dflt.value - dflt.shipped) < 1e-9 && !dflt.present, JSON.stringify(dflt));
  check('the relief term is on', art.getRelief() > 0, `amp ${art.getRelief()}`);
  const relTex = art.reliefState();
  check('uGroundRelief is the real 1024 map, not the placeholder',
        relTex.w >= 1024, JSON.stringify(relTex));

  of.teleport(lat, lon, 2.0);
  let g = 0;
  while (!of.world().chunks.converged && g++ < 240) await of.run(0.25);
  let h = 0;
  while (h++ < 120) {
    const s = of.stats(), gm = of.game();
    if (((s.props && s.props.scatterBacklog) || 0) === 0
        && ((gm.rocks && gm.rocks.backlog) || 0) === 0
        && ((gm.trees && gm.trees.backlog) || 0) === 0) break;
    await of.run(0.25);
  }
  of.propsVisible(false);
  of.look(yaw, pitch);
  await of.settle(6);
  // RE-PIN AFTER the data-dependent wait, or the arms sit at different sun
  // angles (RN-13). setSunElev re-solves against the CURRENT site's up, which
  // ?sundot= cannot, and it returns the miss so an unreachable ask is visible.
  const sun = of.setSunElev(sundot);
  check('the sun elevation asked for is reachable at this site',
        sun.err < 0.02, JSON.stringify(sun));
  of.setTime(sun.t);
  await of.settle(10);

  const cv = document.getElementById('of-canvas') || document.querySelector('canvas');
  const gl = cv.getContext('webgl2') || cv.getContext('webgl');
  const W = gl.drawingBufferWidth, H = gl.drawingBufferHeight;
  const px = new Uint8Array(W * H * 4);
  // NO AWAIT between framehash and readPixels: the default framebuffer is gone
  // by the next task (Loop.ts's own note), and no await also means NO SIM TICKS
  // between arms, so the arms are pixel-registered by construction rather than
  // by care. framehash renders synchronously and advances nothing.
  let lastHash = null;
  const grab = () => {
    of.framehash(2, 2);
    const fh = of.framehash(2, 2);
    lastHash = fh.hash;
    gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px);
  };

  // THE PATCHES: fixed screen rectangles, in TOP-LEFT image coordinates so they
  // match the PNG. readPixels is bottom-up, hence the flip on read.
  const defaultRects = () => {
    const out = [];
    const cols = Math.max(1, Math.floor((W - 2 * Math.round(W * 0.06)) / S));
    const x0 = Math.round((W - cols * S) / 2);
    const yTop = Math.round(H * 0.10);
    const rows = Math.max(1, Math.min(2, Math.floor((H * 0.62) / S)));
    for (let r = 0; r < rows; ++r) for (let c = 0; c < cols; ++c) out.push([x0 + c * S, yTop + r * S]);
    return out;
  };
  const rects = A.rects || defaultRects();
  for (const [l, t] of rects) {
    check(`patch ${l},${t} is inside the frame`, l >= 0 && t >= 0 && l + S <= W && t + S <= H,
          `frame ${W}x${H}`);
  }
  if (fails.length > 0) return { valid: false, fails, W, H, S, rects };

  const patchField = (l, t) => {
    const f = new Float64Array(S * S);
    for (let y = 0; y < S; ++y) {
      const gy = H - 1 - (t + y);                       // top-left -> gl bottom-up
      for (let x = 0; x < S; ++x) {
        const i = (gy * W + (l + x)) * 4;
        f[y * S + x] = 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
      }
    }
    return f;
  };

  /** Sum the power spectra of every patch, and pool the contrast counts. */
  const readArm = () => {
    let P = null;
    let lsum = 0, n = 0;
    let lmin = 255, lmax = 0, bright = 0, dark = 0, npx = 0;
    const cr = {};
    for (const R of CRADII) cr[R] = { over4: 0, over8: 0, over16: 0, p99: 0, n: 0 };
    let pyr = null;
    for (const [l, t] of rects) {
      const f = patchField(l, t);
      const p = power(f);
      if (P === null) P = p; else for (let i = 0; i < P.length; ++i) P[i] += p[i];
      const py = pyramid(f);
      if (pyr === null) pyr = py;
      else {
        for (let i = 0; i < pyr.length; ++i) {
          pyr[i].sTrace += py[i].sTrace; pyr[i].sDisc += py[i].sDisc;
          pyr[i].sDx += py[i].sDx; pyr[i].sDy += py[i].sDy; pyr[i].cnt += py[i].cnt;
        }
      }
      const c = contrast(f);
      lsum += c.lumaMean * c.n; n += c.n;
      for (const R of CRADII) {
        const b = c.byRadius[R];
        cr[R].over4 += b.over4; cr[R].over8 += b.over8; cr[R].over16 += b.over16;
        cr[R].n += b.n; cr[R].p99 = Math.max(cr[R].p99, b.p99);
      }
      for (let i = 0; i < f.length; ++i) {
        ++npx;
        if (f[i] < lmin) lmin = f[i];
        if (f[i] > lmax) lmax = f[i];
        if (f[i] > 200) ++bright;
        if (f[i] < 16) ++dark;
      }
    }
    for (let i = 0; i < P.length; ++i) P[i] /= rects.length;   // mean, not sum
    return {
      P,
      pixels: npx,
      lumaMean: r3(lsum / n), lumaMin: r3(lmin), lumaMax: r3(lmax),
      brightFrac: r4(bright / npx),
      darkFrac: r4(dark / npx),
      contrast: cr,
      pyr: pyramidRead(pyr),
      over8: cr[CRADII[0]].over8,
    };
  };

  // THE FORESHORTENING LEDGER, computed rather than asserted. CameraRig's
  // vertical fov is 60 degrees; a screen row y (top-left origin) looks at the
  // ground at depression |pitch| - atan(((H/2 - y)/(H/2)) * tan(fov/2)), and a
  // ground plane at depression p stretches by 1/sin(p) along the screen
  // vertical. That ratio is what makes ANY isotropic texture measure as
  // anisotropic, and the synth rows price each ratio in units of A.
  const FOV = A.fovDeg ?? 60;
  const depressionAt = (y) => {
    const off = (Math.atan((((H / 2 - y) / (H / 2)) * Math.tan((FOV * Math.PI) / 360)))
                 * 180) / Math.PI;
    let d = Math.abs(pitch) - off;
    if (d > 90) d = 180 - d;
    return d;
  };
  const foreshortening = () => {
    let worst = 1, best = 99, yWorst = 0;
    for (const [, t] of rects) {
      for (const y of [t, t + S / 2, t + S - 1]) {
        const d = depressionAt(y);
        const f = 1 / Math.sin((d * Math.PI) / 180);
        if (f > worst) { worst = f; yWorst = y; }
        if (f < best) best = f;
      }
    }
    return { fovDeg: FOV, pitchDeg: pitch, bestRatio: r4(best), worstRatio: r4(worst),
             worstAtRow: yWorst, worstDepressionDeg: r3(depressionAt(yWorst)) };
  };

  if (mode === 'scout') {
    // BOTH ARMS in one run, so "is what I am looking at the relief term" is
    // answered by the numbers and by the picture in one pass. The OFF arm is
    // left on screen, so --out captures the frame WITHOUT the term.
    //
    // `sundots` sweeps the light in the SAME page. A term measured only where
    // it cannot work reports its own absence, and finding the exposure where a
    // site is neither black nor compressed against white is a prerequisite for
    // the sweep, not an optional extra. Every elevation reports the miss.
    const suns = [];
    for (const want of (A.sundots ?? [])) {
      const sn = of.setSunElev(want);
      of.setTime(sn.t);
      await of.settle(6);
      of.setTime(sn.t);
      grab();
      const on = readArm();
      const don = describe(on.P);
      const a0 = art.getRelief();
      art.setRelief(0);
      grab();
      const of2 = readArm();
      const doff = describe(of2.P);
      art.setRelief(a0);
      suns.push({
        ask: want, sun: sn,
        lumaMean: on.lumaMean, lumaMin: on.lumaMin, lumaMax: on.lumaMax,
        brightFrac: on.brightFrac,
        onA: don.headline.A, onRms: don.headline.rms, onTheta: don.headline.thetaDeg,
        offA: doff.headline.A, offRms: doff.headline.rms, offTheta: doff.headline.thetaDeg,
        onOver8r8: on.contrast[8] ? on.contrast[8].over8 : null,
        offOver8r8: of2.contrast[8] ? of2.contrast[8].over8 : null,
        darkFrac: on.darkFrac,
        onCoh: on.pyr.map((p) => p.coh), offCoh: of2.pyr.map((p) => p.coh),
        onGradRms: on.pyr.map((p) => p.gradRms), offGradRms: of2.pyr.map((p) => p.gradRms),
      });
    }
    if (suns.length > 0) {
      const back = of.setSunElev(sundot);
      of.setTime(back.t);
      await of.settle(6);
      of.setTime(back.t);
    }
    grab();
    const a = readArm();
    const d = describe(a.P);
    const amp0s = art.getRelief();
    art.setRelief(0);
    grab();
    const off = readArm();
    const dOff = describe(off.P);
    if (!(A.leaveOff ?? true)) { art.setRelief(amp0s); grab(); }
    // A coarse tile grid of the whole frame, so "is any of this sky" is
    // answerable from the numbers and not only from the picture.
    const TX = 8, TY = 8;
    const tiles = [];
    for (let ty = 0; ty < TY; ++ty) {
      const row = [];
      for (let tx = 0; tx < TX; ++tx) {
        let s = 0, m = 0;
        for (let y = Math.floor((ty * H) / TY); y < Math.floor(((ty + 1) * H) / TY); y += 4) {
          for (let x = Math.floor((tx * W) / TX); x < Math.floor(((tx + 1) * W) / TX); x += 4) {
            const i = ((H - 1 - y) * W + x) * 4;
            s += 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
            ++m;
          }
        }
        row.push(r3(s / m));
      }
      tiles.push(row);
    }
    return {
      valid: fails.length === 0, fails, mode, W, H, S, rects,
      site: { lat, lon, yaw, pitch }, sun, elevationDot: of.stats().sky.elevationDot,
      biome: of.world().biome, body: of.world().body ?? null,
      frameTiles: tiles,
      sunScan: suns,
      foreshortening: foreshortening(),
      patchStats: { pixels: a.pixels, lumaMean: a.lumaMean, lumaMin: a.lumaMin,
                    lumaMax: a.lumaMax, brightFrac: a.brightFrac, darkFrac: a.darkFrac },
      scalePx: a.pyr.map((p) => p.scalePx),
      reliefOn: {
        A: d.headline.A, AoffAxis: d.headlineOffAxis.A, rms: d.headline.rms,
        thetaDeg: d.headline.thetaDeg, contrast: a.contrast, lumaMean: a.lumaMean,
        octaveA: d.octaves.map((o) => o.A), octaveRms: d.octaves.map((o) => o.rms),
        radial: d.radial,
        coh: a.pyr.map((p) => p.coh), pyrA: a.pyr.map((p) => p.Aglob),
        gradRms: a.pyr.map((p) => p.gradRms),
      },
      reliefOff: {
        A: dOff.headline.A, AoffAxis: dOff.headlineOffAxis.A, rms: dOff.headline.rms,
        thetaDeg: dOff.headline.thetaDeg, contrast: off.contrast, lumaMean: off.lumaMean,
        octaveA: dOff.octaves.map((o) => o.A), octaveRms: dOff.octaves.map((o) => o.rms),
        radial: dOff.radial,
        coh: off.pyr.map((p) => p.coh), pyrA: off.pyr.map((p) => p.Aglob),
        gradRms: off.pyr.map((p) => p.gradRms),
      },
    };
  }

  // ------------------------------------------------------------------- sweep -
  // THE FLOOR ARM: relief amplitude 0. Everything the instrument still reports
  // here belongs to somebody else, and it is the baseline every rung is read
  // against. Its A is the anisotropy of the scene WITHOUT the term, i.e. the
  // combined cost of the residual foreshortening, the player's shadow, the
  // albedo texture and the render grid.
  const amp0 = art.getRelief();
  art.setRelief(0);
  grab();
  const floorArm = readArm();
  const floorHash = lastHash;
  const floor = describe(floorArm.P);
  art.setRelief(amp0);

  const rows = [];
  for (const t of texels) {
    const uv = t / 1024;
    const got = art.setReliefGradUv(uv);
    check(`rung ${t} texels: the uniform actually moved`, Math.abs(got - uv) < 1e-9, `asked ${uv} got ${got}`);
    grab();
    const armHash = lastHash;
    const arm = readArm();
    const d = describe(arm.P);
    // THE DIFFERENCE SPECTRUM. Power spectra of independent components add, so
    // this is the relief term's own contribution with the shadow, the albedo,
    // the slope and the grid subtracted out. It is only legitimate because the
    // two arms are pixel-registered: no ticks ran between them.
    const D = new Float64Array(arm.P.length);
    for (let i = 0; i < D.length; ++i) D[i] = arm.P[i] - floorArm.P[i];
    const diff = describe(D);
    rows.push({
      texels: t, uv: +uv.toFixed(6), got, frameHash: armHash,
      differsFromFloor: armHash !== floorHash,
      pixels: arm.pixels, lumaMean: arm.lumaMean, brightFrac: arm.brightFrac,
      // the RN-843 contrast metric, on the same pixels, at three supports
      contrast: arm.contrast,
      excessOver8: Object.fromEntries(CRADII.map(
        (R) => [R, arm.contrast[R].over8 - floorArm.contrast[R].over8])),
      // the anisotropy instrument
      A: d.headline.A, AoffAxis: d.headlineOffAxis.A,
      rms: d.headline.rms, thetaDeg: d.headline.thetaDeg,
      dA: diff.headline.A, dAoffAxis: diff.headlineOffAxis.A,
      dRms: diff.headline.rms, dThetaDeg: diff.headline.thetaDeg,
      octaveA: d.octaves.map((o) => o.A),
      octaveRms: d.octaves.map((o) => o.rms),
      dOctaveA: diff.octaves.map((o) => o.A),
      dOctaveRms: diff.octaves.map((o) => o.rms),
      dRadial: diff.radial,
      dHist: diff.headline.hist,
      // the local-linearity instrument, per pyramid scale
      scalePx: arm.pyr.map((p) => p.scalePx),
      coh: arm.pyr.map((p) => p.coh),
      cohExcess: arm.pyr.map((p, i) => r4(p.coh - floorArm.pyr[i].coh)),
      pyrA: arm.pyr.map((p) => p.Aglob),
      gradRms: arm.pyr.map((p) => p.gradRms),
      gradRmsRatio: arm.pyr.map((p, i) => r3(p.gradRms / Math.max(1e-9, floorArm.pyr[i].gradRms))),
    });
  }
  art.setReliefGradUv(dflt.shipped);
  grab();      // leave the frame at the shipped default for the capture

  return {
    valid: fails.length === 0, fails, mode,
    W, H, S, rects, rMin, rMax, axisWedgeDeg,
    site: { lat, lon, yaw, pitch }, sun, elevationDot: of.stats().sky.elevationDot,
    biome: of.world().biome,
    foreshortening: foreshortening(),
    floor: {
      hash: floorHash, pixels: floorArm.pixels, lumaMean: floorArm.lumaMean,
      lumaMin: floorArm.lumaMin, lumaMax: floorArm.lumaMax,
      brightFrac: floorArm.brightFrac, darkFrac: floorArm.darkFrac,
      contrast: floorArm.contrast,
      scalePx: floorArm.pyr.map((p) => p.scalePx),
      coh: floorArm.pyr.map((p) => p.coh),
      pyrA: floorArm.pyr.map((p) => p.Aglob),
      gradRms: floorArm.pyr.map((p) => p.gradRms),
      A: floor.headline.A, AoffAxis: floor.headlineOffAxis.A,
      rms: floor.headline.rms, thetaDeg: floor.headline.thetaDeg,
      octaveA: floor.octaves.map((o) => o.A),
      octaveRms: floor.octaves.map((o) => o.rms),
      hist: floor.headline.hist,
    },
    rows,
  };
})()
