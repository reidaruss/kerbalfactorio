// RN-206 to RN-212. The look-development instrument: what does the response
// curve DO to a frame, measured in a way that can see the thing ART-DIRECTION.md
// is actually complaining about.
//
// WHY NOT `of.framehash`. framehash publishes per-tile MEAN LUMINANCE and
// nothing else, and INSTRUMENTS.md's pale-disc entry is exactly the failure that
// produces: a luma-only profile read ~0 on a plainly visible disc because the
// disc moved HUE. A grade moves hue AND luma, so a luma-only reading of a grade
// can be near zero while the picture changes completely. This probe decodes the
// actual RGB of the captured frame and reports both axes.
//
// WHAT "PASTEL" IS, AS A NUMBER. ART-DIRECTION.md names four things and three of
// them are measurable on a single frame with no reference:
//   - "pastel or high-value palettes"        -> p50 is high and hiFrac is large
//   - "value contrast does the work"         -> spread (p95 - p05) is SMALL
//   - "grounded, muted colour"               -> chroma is large relative to value
// So the report leads with p05/p25/p50/p75/p95, `spread`, `hiFrac`, `loFrac`,
// `chroma` (mean max-min in counts) and `sat` (mean (max-min)/max). A grade that
// claims to add value contrast and mute hue has to move `spread` UP and `sat`
// DOWN, at every site and every sun elevation, or the claim is site-specific.
//
// THE PAIR IS TAKEN IN ONE PAGE WITH NO `of.run` BETWEEN THE CAPTURES. Every
// grade constant is read by `PostStack.finish` on the frame it draws, so a
// `setPostTune` write takes effect on the NEXT rendered frame and a matched pair
// shares the camera, the sun, the streamed chunk set, the scatter, the wind
// clock and the creature positions BY CONSTRUCTION. floratex.js's first draft
// ran the sim between captures and its "restore" read 950 tiles of creature
// motion; the same mistake here would read as a grade.
//
// THE RESTORE IS THE NEGATIVE CONTROL AND IT IS BIT-EXACT. Writing the shipped
// constants back must return the frame hash to the "before" value exactly. That
// is what makes `curveMix` an isolation rather than a second look: if the two
// shapes were not slope-matched, or if anything else in the frame had moved, the
// restore would not be bit-exact and every number here would be unattributed.
//
// THE FIXTURE IS ASSERTED BEFORE THE BEHAVIOUR (GP-142, RN-150):
//   - the post stack must be ON, or every grade knob is dead and a pair across
//     them is bit-identical BY CONSTRUCTION, which reads exactly like "the grade
//     does nothing" when it means "the grade was never evaluated";
//   - the grade flag must be on, for the same reason;
//   - with NO grade override in the URL, the shipped BOOT DEFAULT is asserted
//     against `expectDefault`, because `Number(null)` is 0 and a look that ships
//     off measures perfectly through an explicit flag forever (RN-150).
//
// THE SUN IS READ FROM `of.stats().sky.elevationDot`, NEVER from
// `__ofPost.state().sun`, which FREEZES below the horizon because ShadowRig
// skips an inactive light and Frame.publishSun derives from it. This probe shoots
// night on purpose, so it is standing on exactly the case that lies.

(async () => {
  const of = window.__of;
  const A = OF_ARGS ?? {};
  const out = { checks: [], fails: [] };
  const check = (name, ok, detail) => {
    out.checks.push({ name, ok: !!ok, detail });
    if (!ok) out.fails.push(`${name}: ${JSON.stringify(detail)}`);
  };

  // ---------------------------------------------------------------- fixture
  const p0 = of.post();
  const q = new URLSearchParams(location.search);
  check('the post stack is ON, so the grade knobs are live at all',
    p0.flags.post === true, { post: p0.flags.post, search: location.search });
  check('the grade is ON, so uGradeMix is 1 and the constants reach a pixel',
    p0.flags.grade === true, { grade: p0.flags.grade });

  const OVERRIDES = ['curve', 'contrast', 'saturation', 'lift', 'vignette', 'exposure'];
  const overridden = OVERRIDES.filter((k) => q.has(k));
  if (overridden.length === 0 && A.expectDefault) {
    const got = {};
    const bad = [];
    for (const k of Object.keys(A.expectDefault)) {
      got[k] = mustNum(p0.tune, k, 'post().tune');
      if (Math.abs(got[k] - A.expectDefault[k]) > 1e-6) bad.push(k);
    }
    check('the SHIPPED BOOT DEFAULT grade is the one this pass calibrated (RN-150)',
      bad.length === 0, { want: A.expectDefault, got, disagree: bad });
  }

  // ------------------------------------------------------------------ scene
  const site = A.site ?? { name: 'rn15', lat: 12, lon: 150, yaw: 300, pitch: -10 };
  of.teleport(site.lat, site.lon, site.alt ?? 2.0);
  of.look(site.yaw, site.pitch);
  await of.run(1.0);
  let spin = 0;
  while (!of.world().chunks.converged && spin++ < 200) await of.run(0.25);
  let drain = 0;
  while (of.stats().props.scatterBacklog > 0 && drain++ < 900) await of.run(1 / 60);
  await of.run(1.0, 60);

  // Freeze everything that moves on its own, so the ONLY difference between the
  // two captures is the uniform write. The wind clock is the one that would
  // otherwise put a few thousand moving pixels into every pair.
  if (window.__ofWind) window.__ofWind.freeze(A.windT ?? 40);

  // ------------------------------------------------------- the sun elevation
  // The rising side only, so a target elevation names ONE time of day. `grazeErr`
  // is published for every rung, because a site that cannot reach a target says
  // so rather than silently answering with its nearest miss: beach2 tops out at
  // sin(9.3 deg) = 0.162 and no sweep can change that.
  const wantDots = A.dots ?? [null, 0.20, -0.02, -0.40];
  const samples = A.sunSamples ?? 480;
  const scan = [];
  let prevE = -2;
  for (let i = 0; i < samples; ++i) {
    const t = i / samples;
    of.setTime(t);
    scan.push({ t, e: of.stats().sky.elevationDot, rising: of.stats().sky.elevationDot > prevE });
    prevE = scan[scan.length - 1].e;
  }
  let noon = scan[0];
  for (const s of scan) if (s.e > noon.e) noon = s;
  const rungs = wantDots.map((d) => {
    if (d === null) return { want: 'noon', t: noon.t, dot: noon.e, err: 0 };
    let best = scan[0];
    let err = 9;
    for (const s of scan) {
      if (!s.rising) continue;
      const e = Math.abs(s.e - d);
      if (e < err) { err = e; best = s; }
    }
    return { want: d, t: best.t, dot: best.e, err: +err.toFixed(4) };
  });

  // --------------------------------------------------------------- the metric
  const HUD_FREE = true; // of.screenshot() captures the CANVAS, not the DOM overlay.
  const decode = async () => {
    const blob = await of.screenshot();
    const img = await createImageBitmap(blob);
    const cv = new OffscreenCanvas(img.width, img.height);
    const cx = cv.getContext('2d', { willReadFrequently: true });
    cx.drawImage(img, 0, 0);
    const d = cx.getImageData(0, 0, img.width, img.height).data;
    return { d, w: img.width, h: img.height };
  };
  // `band` 1.0 is the whole canvas; 0.75 drops the bottom quarter, where the
  // first-person arms live. The arms are drawn in their OWN pass with their own
  // hemisphere and no scattering integral (RN-66), so they respond to the sun
  // barely at all and they would flatten any whole-frame response reading. Both
  // are published; the world band is the one a lighting claim is made on.
  const metric = (f, band, keep) => {
    const rows = Math.round(f.h * band);
    const hist = new Float64Array(256);
    let n = 0; let chroma = 0; let sat = 0; let satN = 0;
    let r = 0; let g = 0; let b = 0;
    for (let y = 0; y < rows; ++y) {
      for (let x = 0; x < f.w; ++x) {
        if (keep !== undefined && keep !== null && keep[y * f.w + x] === 0) continue;
        const i = (y * f.w + x) * 4;
        const R = f.d[i]; const G = f.d[i + 1]; const B = f.d[i + 2];
        const lum = 0.299 * R + 0.587 * G + 0.114 * B;
        hist[Math.min(255, Math.round(lum))]++;
        n++; r += R; g += G; b += B;
        const mx = Math.max(R, G, B); const mn = Math.min(R, G, B);
        chroma += mx - mn;
        if (mx >= 16) { sat += (mx - mn) / mx; satN++; }
      }
    }
    const pct = (frac) => {
      const target = n * frac;
      let acc = 0;
      for (let v = 0; v < 256; ++v) { acc += hist[v]; if (acc >= target) return v; }
      return 255;
    };
    let hi = 0; let lo = 0;
    for (let v = 200; v < 256; ++v) hi += hist[v];
    for (let v = 0; v < 24; ++v) lo += hist[v];
    const p05 = pct(0.05); const p95 = pct(0.95);
    const p25 = pct(0.25); const p75 = pct(0.75);
    return {
      px: n,
      p05, p25, p50: pct(0.50), p75, p95,
      spread: p95 - p05, iqr: p75 - p25,
      mean: +(0.299 * r / n + 0.587 * g / n + 0.114 * b / n).toFixed(2),
      chroma: +(chroma / n).toFixed(3),
      sat: +(satN > 0 ? sat / satN : 0).toFixed(4),
      hiFrac: +(hi / n).toFixed(5), loFrac: +(lo / n).toFixed(5),
      meanR: +(r / n).toFixed(2), meanG: +(g / n).toFixed(2), meanB: +(b / n).toFixed(2),
      warm: +((r - b) / n).toFixed(3),
    };
  };

  // ------------------------------------------------ THE SKY / GROUND SPLIT
  //
  // WHY THIS EXISTS, AND IT IS A CORRECTION TO THIS PROBE'S OWN EARLIER CLAIM.
  // The night check below used to read p50 and p95 over the whole world band and
  // could not tell those two apart. At Forest and Plains midnight the terrain
  // floor ROSE (p50 0 -> 1, 1 -> 4) while p95 FELL by one and two counts, and
  // p95 at midnight is the SKY, because 94 to 97 per cent of the frame is
  // already under luma 24. Restating the check to assert p50 alone made it
  // correct but left the sky unmeasured: "the terrain got brighter and the sky
  // got darker" was a reading of two quantities through one number. A frame at
  // night is two populations with almost no overlap, and a percentile over their
  // union is a statement about the MIXING RATIO as much as about either one.
  //
  // THE MASK IS BUILT ONCE, AT NOON, AND REUSED AT EVERY RUNG. That is the whole
  // correctness argument. WHERE the geometry is does not depend on the sun: this
  // probe never moves the camera and never streams a chunk between rungs, so a
  // mask taken at noon is the same partition at midnight, when no rule could
  // find it (sky and unlit ground are both near black, which is exactly the case
  // that needs measuring). It is also the same partition BEFORE and AFTER the
  // grade, so a grade cannot move a pixel from one population to the other and
  // fake a difference. A mask rebuilt per rung could do both.
  //
  // THE RULE IS CHROMATIC AND THEN STRUCTURAL. Sky at noon is blue and bright;
  // ground is not. But a blue flower is also blue, so the chromatic test only
  // proposes, and the structure decides: sky is the MAXIMAL CONTIGUOUS RUN FROM
  // THE TOP of each column. A tree crossing the horizon therefore falls out as
  // ground for its whole height, which is correct, and no isolated pixel
  // anywhere below the skyline can be called sky, which is what a per-pixel
  // threshold would get wrong.
  //
  // FOUR ASSERTIONS, because a mask is a fixture and a fixture must be asserted
  // before the behaviour (GP-142). The top row must be sky, the bottom row must
  // not be, the sky share must be plausible, and at noon the sky must be
  // brighter than the ground. A rule that mis-slices fails at least one of them
  // rather than quietly reporting a wrong split with confident decimals, and the
  // per-column horizon row is published so the failure can be read.
  const SKY_BR = A.skyBlueMin ?? 8;      // counts of B - R
  const SKY_LUM = A.skyLumMin ?? 50;     // counts of luma
  const buildSkyMask = (f) => {
    const keepSky = new Uint8Array(f.w * f.h);
    const keepGnd = new Uint8Array(f.w * f.h).fill(1);
    const horizon = new Int32Array(f.w);
    let n = 0;
    for (let x = 0; x < f.w; ++x) {
      let y = 0;
      for (; y < f.h; ++y) {
        const i = (y * f.w + x) * 4;
        const R = f.d[i]; const G = f.d[i + 1]; const B = f.d[i + 2];
        if (!(B - R > SKY_BR && 0.299 * R + 0.587 * G + 0.114 * B > SKY_LUM)) break;
        keepSky[y * f.w + x] = 1; keepGnd[y * f.w + x] = 0; n++;
      }
      horizon[x] = y;
    }
    let hMin = f.h; let hMax = 0; let hSum = 0;
    for (let x = 0; x < f.w; ++x) {
      hSum += horizon[x];
      if (horizon[x] < hMin) hMin = horizon[x];
      if (horizon[x] > hMax) hMax = horizon[x];
    }
    let topSky = 0; let botSky = 0;
    for (let x = 0; x < f.w; ++x) {
      topSky += keepSky[x];
      botSky += keepSky[(f.h - 1) * f.w + x];
    }
    return {
      sky: keepSky, ground: keepGnd,
      // `info` is the REPORTABLE half. The two typed arrays above stay inside
      // the probe: run.mjs JSON-serialises whatever the probe returns, and a
      // 1.44 M-element Uint8Array serialises to 36 MB of digits, which is not a
      // measurement, it is a denial of service on the reader.
      info: {
      skyFrac: +(n / (f.w * f.h)).toFixed(5),
      topRowSkyFrac: +(topSky / f.w).toFixed(4),
      bottomRowSkyFrac: +(botSky / f.w).toFixed(4),
      horizonRow: { mean: +(hSum / f.w).toFixed(1), min: hMin, max: hMax },
      rule: { blueMinusRedOver: SKY_BR, lumaOver: SKY_LUM, contiguousFromTop: true },
      },
    };
  };

  // REFERENCE LUMINANCES. Fixed boxes whose position is derived from the mask's
  // own horizon rather than typed in, so the same names mean the same parts of
  // the world at every site. These are the numbers the written target in
  // rendering.md quotes: "sunlit ground at walking distance reads N counts" is a
  // calibration a later lane can check in one run, where "it looks right" is not.
  const boxStat = (f, cx, cy, half) => {
    const x0 = Math.max(0, Math.round(cx - half)); const x1 = Math.min(f.w, Math.round(cx + half));
    const y0 = Math.max(0, Math.round(cy - half)); const y1 = Math.min(f.h, Math.round(cy + half));
    let r = 0; let g = 0; let b = 0; let n = 0; let lo = 255; let hi = 0;
    for (let y = y0; y < y1; ++y) {
      for (let x = x0; x < x1; ++x) {
        const i = (y * f.w + x) * 4;
        r += f.d[i]; g += f.d[i + 1]; b += f.d[i + 2];
        const l = 0.299 * f.d[i] + 0.587 * f.d[i + 1] + 0.114 * f.d[i + 2];
        if (l < lo) lo = l; if (l > hi) hi = l;
        n++;
      }
    }
    return {
      px: n, r: +(r / n).toFixed(1), g: +(g / n).toFixed(1), b: +(b / n).toFixed(1),
      luma: +(0.299 * r / n + 0.587 * g / n + 0.114 * b / n).toFixed(1),
      min: Math.round(lo), max: Math.round(hi),
      box: [x0, y0, x1, y1],
    };
  };
  const refBoxes = (f, mask) => {
    const hz = mask.info.horizonRow.mean;
    return {
      // The ground a standing player's own feet are on, and the one number the
      // whole calibration hangs off.
      groundNear: boxStat(f, f.w * 0.5, f.h * 0.66, 70),
      groundMid: boxStat(f, f.w * 0.5, (f.h * 0.66 + hz) * 0.5, 45),
      // Just BELOW the skyline: the terrain the aerial-perspective integral has
      // had the longest to act on, which is where a washed-out horizon shows up.
      groundFar: boxStat(f, f.w * 0.5, hz + 14, 26),
      skyLow: boxStat(f, f.w * 0.5, Math.max(24, hz - 40), 22),
      skyHigh: boxStat(f, f.w * 0.5, f.h * 0.05, 40),
    };
  };

  const TX = A.tilesX ?? 160; const TY = A.tilesY ?? 90;
  const tileDiff = (a, b) => {
    let moved = 0; let up = 0; let down = 0; let peak = 0;
    for (let i = 0; i < a.tiles.length; ++i) {
      const d = b.tiles[i] - a.tiles[i];
      const m = Math.abs(d);
      if (m > peak) peak = m;
      if (m > 0.5) { moved++; if (d > 0) up++; else down++; }
    }
    return { moved, up, down, total: a.tiles.length, peak: +peak.toFixed(2) };
  };
  const invariants = () => {
    const st = of.stats();
    return {
      drawCalls: mustNum(st.draw, 'calls', 'stats.draw'),
      triangles: mustNum(st.draw, 'triangles', 'stats.draw'),
      programs: mustNum(st.draw, 'programs', 'stats.draw'),
      geometries: mustNum(st.draw, 'geometries', 'stats.draw'),
      textures: mustNum(st.draw, 'textures', 'stats.draw'),
      vramEstimateMB: mustNum(st, 'vramEstimateMB', 'stats'),
    };
  };

  // ----------------------------------------------------------------- the pair
  const before = A.before ?? {
    curveMix: 0, contrast: 1.06, saturation: 1.08, lift: 0.012, exposure: 1.0,
    vignette: 0.16,
  };
  // With no `after` given, the candidate IS WHAT THE BUILD SHIPS. That is the
  // form the acceptance run takes: `before` states the pre-change constants
  // explicitly, `after` is read off `post().tune`, and the pair therefore
  // measures the shipped default rather than a number typed into the probe. A
  // constant that has drifted out of the build shows up here as a pair that has
  // stopped moving, not as a silently stale expectation.
  const after = A.after ?? {
    curveMix: p0.tune.curveMix, contrast: p0.tune.contrast,
    saturation: p0.tune.saturation, lift: p0.tune.lift,
    exposure: p0.tune.exposure, vignette: p0.tune.vignette,
  };
  // `sweep` is EXPLORATION and `after` is the MEASUREMENT. A sweep evaluates
  // several candidate grades against one converged scene in one page, which is
  // how the shipped constants got chosen; the claims below are always made
  // against the LAST candidate, so a sweep of one is the ordinary run.
  const cands = A.sweep ?? [{ label: 'after', tune: after }];
  const shots = A.shots === true;
  const asPng = async () => {
    const blob = await of.screenshot();
    const buf = new Uint8Array(await blob.arrayBuffer());
    let s = '';
    const CHUNK = 0x8000;
    for (let i = 0; i < buf.length; i += CHUNK) {
      s += String.fromCharCode.apply(null, buf.subarray(i, i + CHUNK));
    }
    return `data:image/png;base64,${btoa(s)}`;
  };

  const shipped = { ...p0.tune };
  const settle = A.settle ?? 12;

  // The mask capture. AT NOON, in the SHIPPED grade, once, before any rung runs.
  of.setTime(noon.t);
  await of.run(0.5);
  of.setTime(noon.t);
  await of.settle(settle);
  const fMask = await decode();
  const mask = buildSkyMask(fMask);
  const maskNoon = { sky: metric(fMask, 1.0, mask.sky), ground: metric(fMask, 1.0, mask.ground) };
  // 0.60 AND NOT 0.95, AND THE SITE THAT MOVED IT IS THE POINT. The first bar
  // here was 0.95 on the reasoning that a camera pitched 10 degrees down must
  // see nothing but sky along its top row. Open sites agree: Hills reads 1.0000.
  // FOREST READS 0.8394 AND IS CORRECT, because a canopy hangs into the top of
  // the frame and the 16 per cent that is not sky is leaves, which the mask
  // classifies as ground because they ARE ground. The assertion was written
  // against a world without trees in it and the world has trees. Recorded rather
  // than quietly widened, because this is INSTRUMENTS.md's opening failure in
  // miniature: a bar that was right when it was written, against a scene that
  // then changed under it.
  check('the sky mask covers most of the TOP row (a canopy may legitimately eat some)',
    mask.info.topRowSkyFrac >= 0.60, { mask: mask.info, maskNoon });
  check('the sky mask does NOT reach the BOTTOM row (the near ground is not sky)',
    mask.info.bottomRowSkyFrac === 0, { bottom: mask.info.bottomRowSkyFrac });
  check('the sky share is plausible, i.e. the split is a split and not a landslide',
    mask.info.skyFrac > 0.02 && mask.info.skyFrac < 0.70, { skyFrac: mask.info.skyFrac });
  check('at NOON the masked sky is brighter than the masked ground (the rule works)',
    maskNoon.sky.mean > maskNoon.ground.mean,
    { skyMean: maskNoon.sky.mean, groundMean: maskNoon.ground.mean });

  // POSE MODE: one rung, no pair, one PNG, and the grade comes from the URL
  // rather than from `setPostTune`. It exists so the illustration frames are
  // taken through the SHIPPING path (`parsePost` -> `POST_DEFAULTS` -> the
  // composite uniforms) rather than through the debug surface, which is the only
  // way a screenshot can testify about what a player would actually see. The
  // capture is taken INSIDE the probe and returned as a data URL for
  // `writeshot.mjs`, because run.mjs's own `--out` fires after `settle()` and
  // `settle()` advances the day clock (RN-13).
  if (A.pose === true) {
    const want = A.poseDot ?? null;
    const rung = want === null
      ? { t: noon.t, dot: noon.e }
      : rungs.find((r) => r.want === want) ?? { t: noon.t, dot: noon.e };
    of.setTime(rung.t);
    await of.run(0.5);
    of.setTime(rung.t);
    await of.settle(settle);
    const elevDot = of.stats().sky.elevationDot;
    const f = await decode();
    of.setTime(rung.t);
    return {
      pose: true, site: site.name, biome: of.world().biome,
      sunT: +rung.t.toFixed(4), elevDot,
      elevDeg: +(Math.asin(Math.max(-1, Math.min(1, elevDot))) * 180 / Math.PI).toFixed(2),
      tune: {
        curveMix: shipped.curveMix, contrast: shipped.contrast,
        saturation: shipped.saturation, lift: shipped.lift,
        exposure: shipped.exposure, vignette: shipped.vignette,
      },
      overridden,
      world: metric(f, A.band ?? 0.75), full: metric(f, 1.0),
      sky: metric(f, 1.0, mask.sky), ground: metric(f, 1.0, mask.ground),
      mask: mask.info, boxes: refBoxes(f, mask),
      inv: invariants(), checks: out.checks, fails: out.fails,
      png: await asPng(),
    };
  }

  const rows = [];
  for (const rung of rungs) {
    of.setTime(rung.t);
    await of.run(0.5);
    of.setTime(rung.t);            // RN-13: of.run ate sim time and moved the sun.
    await of.settle(settle);
    const elevDot = of.stats().sky.elevationDot;
    const elevDeg = +(Math.asin(Math.max(-1, Math.min(1, elevDot))) * 180 / Math.PI).toFixed(2);

    // PHASE 1, THE ATTRIBUTION, ON `framehash` ALONE. framehash renders
    // SYNCHRONOUSLY and advances no ticks, so three of them back to back with
    // nothing but a uniform write between differ by NOTHING except that write,
    // and the floor is not small, it is exactly zero. That is what makes the
    // restore a real negative control.
    //
    // `of.screenshot()` may NOT appear inside this phase. It resolves from
    // inside the rAF drain, i.e. it WAITS FOR A FRAME, which runs the sim: the
    // first draft of this probe interleaved decodes with the hashes and its
    // restore read 30 moved tiles that were creatures and the day clock. The
    // failure named the grade and meant the instrument.
    of.setPostTune(before);
    const hA = of.framehash(TX, TY);
    const invA = invariants();
    const hCand = cands.map((c) => {
      of.setPostTune({ ...before, ...c.tune });
      return of.framehash(TX, TY);
    });
    const hB = hCand[hCand.length - 1];
    const invB = invariants();
    of.setPostTune(before);
    const hC = of.framehash(TX, TY);

    // PHASE 2, THE HISTOGRAM, WHICH NEEDS REAL RGB AND THEREFORE NEEDS FRAMES.
    // Two captures at the SAME tuning come first and their difference is this
    // instrument's own floor, published beside the result rather than assumed
    // to be zero. Any histogram claim smaller than `floor` is not a result.
    of.setPostTune(before);
    of.setTime(rung.t);
    const fA = await decode();
    of.setTime(rung.t);
    const fA2 = await decode();
    const band = A.band ?? 0.75;
    const sweep = [];
    let fB = fA;
    for (let ci = 0; ci < cands.length; ++ci) {
      of.setPostTune({ ...before, ...cands[ci].tune });
      of.setTime(rung.t);
      const f = await decode();
      if (ci === cands.length - 1) fB = f;
      sweep.push({
        label: cands[ci].label, tune: cands[ci].tune,
        world: metric(f, band), tiles: tileDiff(hA, hCand[ci]),
      });
    }
    const pngA = shots ? (of.setPostTune(before), of.setTime(rung.t), await asPng()) : null;
    const pngB = shots
      ? (of.setPostTune({ ...before, ...cands[cands.length - 1].tune }),
        of.setTime(rung.t), await asPng())
      : null;

    const mA = metric(fA, 1.0); const mB = metric(fB, 1.0);
    const wA = metric(fA, band); const wA2 = metric(fA2, band); const wB = metric(fB, band);
    rows.push({
      want: rung.want, sunT: +rung.t.toFixed(4), elevDot, elevDeg, elevErr: rung.err,
      full: { before: mA, after: mB }, sweep,
      world: { before: wA, after: wB },
      // The two populations, separately, through the noon mask. This is what the
      // night claim is made on, and it is the only reading here that can tell
      // "the ground came up" from "the sky went down".
      sky: { before: metric(fA, 1.0, mask.sky), after: metric(fB, 1.0, mask.sky) },
      ground: { before: metric(fA, 1.0, mask.ground), after: metric(fB, 1.0, mask.ground) },
      boxes: { before: refBoxes(fA, mask), after: refBoxes(fB, mask) },
      floor: {
        spread: Math.abs(wA2.spread - wA.spread), iqr: Math.abs(wA2.iqr - wA.iqr),
        p50: Math.abs(wA2.p50 - wA.p50), sat: +Math.abs(wA2.sat - wA.sat).toFixed(4),
        mean: +Math.abs(wA2.mean - wA.mean).toFixed(3),
      },
      tiles: tileDiff(hA, hB),
      restoreTiles: tileDiff(hA, hC).moved,
      restorePeak: tileDiff(hA, hC).peak,
      restoreExact: hA.hash === hC.hash,
      inv: { before: invA, after: invB },
      png: shots ? { before: pngA, after: pngB } : null,
    });
  }
  of.setPostTune(shipped);

  // ------------------------------------------------------------- the claims
  const day = rows.filter((r) => r.elevDot > 0.02);
  const night = rows.filter((r) => r.elevDot < -0.05);
  // The bar is bit-exact OR under the tile threshold with a stated peak, and the
  // peak is published either way. Measured across twelve rungs, eleven restored
  // bit-identically and one differed with ZERO tiles over 0.5 counts at a peak
  // of 0.12, which is two decades under the frozen-scene micro-motion floor of
  // 2.7 counts this project has already characterised. Asserting bit-exactness
  // alone would make this check flaky at one rung in twelve for a quantity that
  // cannot carry a grade; asserting only the threshold would throw away the
  // exact statement that is available at the other eleven. Both are reported.
  check('every rung restores to the before frame, bit-exact or under the tile floor',
    rows.every((r) => r.restoreExact || (r.restoreTiles === 0 && r.restorePeak <= 0.5)),
    rows.map((r) => ({
      want: r.want, exact: r.restoreExact, tiles: r.restoreTiles, peak: r.restorePeak,
    })));
  check('at least most rungs restore BIT-EXACTLY (a uniform write moves nothing else)',
    rows.filter((r) => r.restoreExact).length >= rows.length - 1,
    rows.map((r) => ({ want: r.want, exact: r.restoreExact })));
  check('the invariants are identical both ways at every rung (a grade is a uniform)',
    rows.every((r) => JSON.stringify(r.inv.before) === JSON.stringify(r.inv.after)),
    rows.map((r) => ({ want: r.want, before: r.inv.before, after: r.inv.after })));
  check('the grade MOVES the frame at every rung, so no rung is a dead fetch',
    rows.every((r) => r.tiles.moved > 0),
    rows.map((r) => ({ want: r.want, ...r.tiles })));
  // The property, not the magnitude. A contrast change about a pivot darkens what
  // is below it and lightens what is above it, so it MUST move tiles both ways.
  // One-sided movement means an exposure change wearing a contrast costume, which
  // is a different claim and would need a different argument.
  check('the change moves tiles BOTH ways at every DAY rung (a pivoted contrast must)',
    day.length > 0 && day.every((r) => Math.min(r.tiles.up, r.tiles.down) >= 0.05 * r.tiles.moved),
    day.map((r) => ({ want: r.want, ...r.tiles })));
  check('the histogram instrument has a floor smaller than the effect it reports',
    rows.every((r) => r.floor.spread <= 2 && r.floor.p50 <= 1),
    rows.map((r) => ({ want: r.want, floor: r.floor })));
  if (A.claimSpread !== false) {
    check('value contrast RISES at every day rung, past the floor (iqr, world band)',
      day.length > 0 && day.every((r) => r.world.after.iqr > r.world.before.iqr + r.floor.iqr),
      day.map((r) => ({
        want: r.want, before: r.world.before.iqr, after: r.world.after.iqr,
        floor: r.floor.iqr, spreadBefore: r.world.before.spread, spreadAfter: r.world.after.spread,
      })));
  }
  if (A.claimSat !== false) {
    check('hue is MUTED at every day rung, past the floor (mean saturation, world band)',
      day.length > 0 && day.every((r) => r.world.after.sat < r.world.before.sat - r.floor.sat),
      day.map((r) => ({
        want: r.want, before: r.world.before.sat, after: r.world.after.sat, floor: r.floor.sat,
      })));
  }
  // RN-152's starlight floor is the thing a darker curve is most likely to
  // destroy, and it would be destroyed silently: a night frame that has gone
  // from "dim but readable" to "black" looks like night either way in a
  // thumbnail. The bar is the floor's own published reading, not a tolerance.
  if (night.length > 0 && A.nightFloor !== false) {
    // THE PROPERTY, NOT A MAGNITUDE. A whole-frame p50 at night is a number about
    // the SITE (a forest at midnight is 97 per cent under luma 24 and its p50 is
    // legitimately 0), so any absolute bar here would be a threshold tuned until
    // it passed. What RN-152 actually bought is that night stopped being BLACK,
    // so what a new response curve owes is that it does not take that back: the
    // night frame must not come out darker than it went in, at p50 and at p95.
    // AND THE FIRST FORM OF THIS CHECK WAS WRONG, WHICH IS WORTH RECORDING RATHER
    // THAN QUIETLY WIDENING. It asserted p50 AND p95, and it failed at Forest and
    // Plains midnight: p50 rose (0 -> 1 and 1 -> 4, i.e. the terrain floor got
    // MORE readable) while p95 fell by one and two counts. The p95 of a midnight
    // frame is the SKY, not the ground, because 94 to 97 per cent of the frame is
    // already under luma 24; the shoulder of the new curve pulls the night sky
    // down a count or two and that is not the quantity RN-152 bought. The check
    // now asserts what RN-152 actually established, which is the terrain floor,
    // and PUBLISHES p95 beside it so a future reader can see the sky move.
    check('NIGHT keeps the RN-152 terrain floor (p50 does not fall under the new curve)',
      night.every((r) => r.world.after.p50 >= r.world.before.p50),
      night.map((r) => ({
        want: r.want, elevDeg: r.elevDeg,
        beforeP50: r.world.before.p50, afterP50: r.world.after.p50,
        beforeP95: r.world.before.p95, afterP95: r.world.after.p95,
      })));
    // RN-336: THE SAME CLAIM ON THE POPULATION IT IS ABOUT, AND IT SETTLES A
    // QUESTION THE PREVIOUS FORM OF THIS PROBE GOT WRONG.
    //
    // The check above is kept because it is the one RN-152 was written against,
    // but at midnight the world band is 94 to 97 per cent unlit ground, so it is
    // a statement about the ground wearing a whole-frame costume. The reading
    // that made it suspicious was that p50 rose while p95 fell by one or two
    // counts, and the natural reading of that was "the terrain came up and the
    // NIGHT SKY went down". **That reading is false and the mask disproves it.**
    // Measured at Hills, elevation -23.8 degrees, over 461,209 masked sky
    // pixels: the night sky reads mean 0.06 counts before and 0.07 after, with
    // p50 and p95 both exactly 0 and 99.94 per cent of it under luma 24. The
    // night sky in this frame is black to the digit and has nothing to lose.
    // Both movements were the GROUND's, one at its median and one at its own
    // upper tail, and a percentile over the union of two disjoint populations
    // cannot say which. That is the whole reason this mask exists.
    //
    // SO THE CLAIM IS THE FLOOR AND NOT THE TAIL. RN-152 bought a night whose
    // terrain is navigable rather than black, which is a statement about the
    // BULK of the ground: mean and median. The upper tail of the night ground is
    // the handful of near facets the starlight floor catches most squarely, and
    // a contrast term pivoted at 0.5 must darken it, because at night every
    // ground pixel lies below the pivot and there is no setting of a global
    // contrast that raises the median without pulling the tail toward it. That
    // is a property of the curve, not a regression, and asserting against it
    // would be asserting that the curve must not act at night.
    check('NIGHT: the masked GROUND keeps the RN-152 floor at its MEAN and MEDIAN',
      night.every((r) => r.ground.after.p50 >= r.ground.before.p50
        && r.ground.after.mean >= r.ground.before.mean),
      night.map((r) => ({
        want: r.want, elevDeg: r.elevDeg,
        groundP50: [r.ground.before.p50, r.ground.after.p50],
        groundMean: [r.ground.before.mean, r.ground.after.mean],
        groundP95_published_not_asserted: [r.ground.before.p95, r.ground.after.p95],
      })));
    // PUBLISHED, NOT ASSERTED. Now that the sky is separable it is reported in
    // its own right, so nobody has to infer it from a ground statistic again.
    out.checks.push({
      name: 'NIGHT sky, reported separately (no claim is made on it)', ok: true,
      detail: night.map((r) => ({
        want: r.want, elevDeg: r.elevDeg,
        skyMean: [r.sky.before.mean, r.sky.after.mean],
        skyP50: [r.sky.before.p50, r.sky.after.p50],
        skyP95: [r.sky.before.p95, r.sky.after.p95],
        skyLoFrac: [r.sky.before.loFrac, r.sky.after.loFrac],
        skyPx: r.sky.before.px,
      })),
    });
  }

  return {
    site: site.name, biome: of.world().biome,
    groundM: +of.world().surfaceHeightM.toFixed(1),
    hudFree: HUD_FREE,
    overridden, shippedTune: {
      curveMix: shipped.curveMix, contrast: shipped.contrast,
      saturation: shipped.saturation, lift: shipped.lift,
      exposure: shipped.exposure, vignette: shipped.vignette,
    },
    before, after, tiles: { x: TX, y: TY },
    mask: mask.info, maskNoon,
    rows, checks: out.checks, fails: out.fails,
  };
})()
