// RN-511 to RN-518. THE DUSK INSTRUMENT: what is the colour of a low-sun frame,
// and WHERE in the frame is it, so a near-uniform wash can be told from a
// correctly hazed distance.
//
//   node tools/smoke/run.mjs --url=http://127.0.0.1:<port>/ --scenario=walk \
//     --width=1600 --height=900 --evalfile=tools/smoke/probes/dusk.js \
//     --evalargs='{"site":{"name":"mtn","lat":2.036,"lon":144.056,"yaw":300,"pitch":-10},"dots":[0.30]}'
//
// WHY THIS EXISTS AND NOT lookdev.js. lookdev.js answers "what does the GRADE do
// to a frame" and it answers it well. The dusk complaint is a different
// question with a different shape: the report is that terrain, foliage AND
// DISTANCE are all one colour, and every statistic lookdev publishes is a
// reduction over the whole frame, which destroys exactly the property under
// test. A frame that is uniformly pale cyan and a frame with dark near ground
// under a pale cyan distance can have the same mean, the same p50, the same
// chroma and the same saturation. The difference between them is WHERE, and
// only a spatially resolved reading can see it.
//
// THE TWO AXES, BOTH OF THEM, ALWAYS. INSTRUMENTS.md's pale-disc entry is the
// standing warning: a luma-only profile read about zero on a plainly visible
// disc because the disc moved HUE. This defect is named as a HUE defect ("pale
// cyan") on a frame whose luma may be perfectly reasonable, so every band here
// publishes `warm` (meanR - meanB, positive is warm) beside its luma. A dusk
// term that has stopped reddening moves `warm` and need not move `mean` at all.
//
// THE DISTANCE PROXY, NAMED HONESTLY (RN-34). There is no depth readback in the
// debug surface, so distance is proxied by SCREEN ROW between the mask's own
// horizon and the bottom of the world band. That proxy is valid only for a
// camera pitched DOWN at ground that recedes monotonically, which is the case
// this instrument is pointed at and is asserted rather than assumed: the row
// ranges are published, and `bandRows` states them so a later reader can see
// what was actually measured rather than trusting a band called "far". RN-34 is
// the entry this is written against: a band named "far" that was 30 m away
// reported a working aerosol term as dead.
//
// THE SUN IS READ FROM `of.stats().sky.elevationDot` AND NEVER FROM
// `__ofPost.state().sun`, which FREEZES below the horizon. This probe's whole
// subject is low sun, so it stands on exactly the value that lies.
//
// `bootSun: true` LEAVES THE DAY CLOCK ALONE, and that is a real distinction and
// not a convenience. `--sundot=` is solved once at boot by
// `SkyPass.solveSunT(up, dot)`, which picks ONE of the two times of day with
// that elevation; `of.setTime` driven by a scan over the rising side picks the
// OTHER one. The elevation is equal and the sun AZIMUTH is not, and the aerosol
// phase function spans 2.8:1 between the solar and the anti-solar direction, so
// the two are different frames. A reproduction of a boot-flag frame must use
// the boot sun.

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
  check('the post stack is ON, so the grade and the exposure reach a pixel',
    p0.flags.post === true, { post: p0.flags.post, search: location.search });

  // RN-150. With no override in the URL the SHIPPED BOOT DEFAULT is the fixture
  // and is asserted in its own right, because `Number(null)` is 0 and a probe
  // that only ever passes an explicit flag proves nothing about what ships.
  const OVERRIDES = ['curve', 'contrast', 'saturation', 'lift', 'vignette', 'exposure'];
  const overridden = OVERRIDES.filter((k) => q.has(k));
  const WANT = A.expectDefault ?? {
    curveMix: 1, contrast: 1.45, saturation: 0.92, lift: 0, exposure: 1.2,
  };
  if (overridden.length === 0) {
    const got = {}; const bad = [];
    for (const k of Object.keys(WANT)) {
      got[k] = mustNum(p0.tune, k, 'post().tune');
      if (Math.abs(got[k] - WANT[k]) > 1e-6) bad.push(k);
    }
    check('the SHIPPED BOOT DEFAULT grade is section 2.1\'s (RN-150)',
      bad.length === 0, { want: WANT, got, disagree: bad });
  }

  const atmo = window.__ofAtmos;
  check('the aerosol runtime handle exists, so the haze can be paired in ONE page',
    atmo !== undefined && typeof atmo.setAerial === 'function',
    { has: atmo !== undefined });

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
  of.look(site.yaw, site.pitch);

  // The wind clock is pinned so a pair differs by the uniform write and by
  // nothing else. 11,465 foliage instances move in every frame otherwise, which
  // is more moving pixels than any term measured here.
  if (window.__ofWind) window.__ofWind.freeze(A.windT ?? 40);

  // ------------------------------------------------------- the sun elevation
  const bootSun = A.bootSun === true;
  const scan = [];
  let rungs;
  if (bootSun) {
    rungs = [{ want: 'boot', t: null, dot: of.stats().sky.elevationDot, err: 0 }];
  } else {
    const samples = A.sunSamples ?? 480;
    let prevE = -2;
    for (let i = 0; i < samples; ++i) {
      const t = i / samples;
      of.setTime(t);
      const e = of.stats().sky.elevationDot;
      scan.push({ t, e, rising: e > prevE });
      prevE = e;
    }
    let noon = scan[0];
    for (const s of scan) if (s.e > noon.e) noon = s;
    rungs = (A.dots ?? [0.30, 0.20, 0.10, 0.04, 0.00, -0.04]).map((d) => {
      if (d === null) return { want: 'noon', t: noon.t, dot: noon.e, err: 0 };
      let best = scan[0]; let err = 9;
      for (const s of scan) {
        if (A.setting !== true && !s.rising) continue;
        if (A.setting === true && s.rising) continue;
        const e = Math.abs(s.e - d);
        if (e < err) { err = e; best = s; }
      }
      return { want: d, t: best.t, dot: best.e, err: +err.toFixed(4) };
    });
  }

  // --------------------------------------------------------------- the metric
  const decode = async () => {
    const blob = await of.screenshot();
    const img = await createImageBitmap(blob);
    const cv = new OffscreenCanvas(img.width, img.height);
    const cx = cv.getContext('2d', { willReadFrequently: true });
    cx.drawImage(img, 0, 0);
    const d = cx.getImageData(0, 0, img.width, img.height).data;
    return { d, w: img.width, h: img.height };
  };

  // A statistic over an explicit ROW RANGE. `y0`/`y1` are published on every
  // result so a band is never trusted by its name (RN-34).
  const rowStat = (f, y0, y1) => {
    const hist = new Float64Array(256);
    let n = 0; let r = 0; let g = 0; let b = 0; let chroma = 0; let sat = 0; let satN = 0;
    for (let y = Math.max(0, y0); y < Math.min(f.h, y1); ++y) {
      for (let x = 0; x < f.w; ++x) {
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
    if (n === 0) return null;
    const pct = (frac) => {
      const target = n * frac; let acc = 0;
      for (let v = 0; v < 256; ++v) { acc += hist[v]; if (acc >= target) return v; }
      return 255;
    };
    const p05 = pct(0.05); const p95 = pct(0.95);
    return {
      rows: [Math.max(0, y0), Math.min(f.h, y1)], px: n,
      p05, p25: pct(0.25), p50: pct(0.50), p75: pct(0.75), p95,
      spread: p95 - p05,
      mean: +(0.299 * r / n + 0.587 * g / n + 0.114 * b / n).toFixed(2),
      meanR: +(r / n).toFixed(2), meanG: +(g / n).toFixed(2), meanB: +(b / n).toFixed(2),
      // THE HUE AXIS. Positive is warm. A dusk frame is SUPPOSED to be warm;
      // a negative reading at low sun is the defect stated as a number.
      warm: +((r - b) / n).toFixed(3),
      chroma: +(chroma / n).toFixed(3),
      sat: +(satN > 0 ? sat / satN : 0).toFixed(4),
    };
  };

  // THE HORIZON, found the way lookdev.js finds it: sky is the maximal
  // contiguous run from the top of each column that is blue AND bright. At a
  // site with no visible sky the run is empty and `horizonMean` is 0, which is
  // CORRECT and is published rather than papered over: the bands then span the
  // whole world band and say so.
  const SKY_BR = A.skyBlueMin ?? 8;
  const SKY_LUM = A.skyLumMin ?? 50;
  const horizonOf = (f) => {
    const horizon = new Int32Array(f.w);
    const keepSky = new Uint8Array(f.w * f.h);
    let n = 0;
    for (let x = 0; x < f.w; ++x) {
      let y = 0;
      for (; y < f.h; ++y) {
        const i = (y * f.w + x) * 4;
        const R = f.d[i]; const G = f.d[i + 1]; const B = f.d[i + 2];
        if (!(B - R > SKY_BR && 0.299 * R + 0.587 * G + 0.114 * B > SKY_LUM)) break;
        keepSky[y * f.w + x] = 1; n++;
      }
      horizon[x] = y;
    }
    let sum = 0; let mn = f.h; let mx = 0;
    for (let x = 0; x < f.w; ++x) {
      sum += horizon[x];
      if (horizon[x] < mn) mn = horizon[x];
      if (horizon[x] > mx) mx = horizon[x];
    }
    return { sky: keepSky, mean: sum / f.w, min: mn, max: mx, skyFrac: +(n / (f.w * f.h)).toFixed(5) };
  };

  // The world band stops at 0.75 of the frame: below that are the animated
  // first-person arms, drawn in their OWN pass with their own hemisphere and no
  // scattering integral at all (RN-66), so they respond to the sun barely and
  // would flatten every reading here. Published separately BECAUSE they are the
  // in-frame control: a wash that is in the atmosphere cannot reach them.
  const ARMS0 = A.armsFrom ?? 0.80;
  const bands = (f, hz) => {
    const top = Math.max(0, Math.round(hz));
    const bot = Math.round(f.h * (A.band ?? 0.75));
    const span = Math.max(1, bot - top);
    return {
      bandRows: { horizon: +hz.toFixed(1), worldTop: top, worldBottom: bot, span },
      // Just under the skyline: the ground the two distance terms have had the
      // longest to act on.
      far: rowStat(f, top, top + Math.round(span * 0.25)),
      mid: rowStat(f, top + Math.round(span * 0.25), top + Math.round(span * 0.62)),
      // The ground a standing player's own feet are on.
      near: rowStat(f, top + Math.round(span * 0.62), bot),
      world: rowStat(f, top, bot),
      full: rowStat(f, 0, f.h),
      // THE IN-FRAME CONTROL, and it is the strongest single discriminator in
      // this probe. The arms are lit by a different code path with no
      // atmosphere in it. If they move with the wash, the wash is in the post
      // stack; if they do not, it is upstream of the composite.
      arms: rowStat(f, Math.round(f.h * ARMS0), f.h),
    };
  };

  // SECTION 2.1'S OWN BOX CONVENTION, so a dusk row can be read straight down the
  // page against the noon rows that are already there. `groundNear` is the same
  // 140 px box at 0.5 / 0.66 of the frame that the noon calibration uses; a
  // different box would make the two tables incomparable while looking like one
  // table, which is worse than having no dusk row at all.
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
      warm: +((r - b) / n).toFixed(2),
      min: Math.round(lo), max: Math.round(hi), box: [x0, y0, x1, y1],
    };
  };
  // `groundFar` IS NOT AT hz + 14, AND THE CORRECTION IS RN-34 A SECOND TIME.
  // lookdev.js centres a box of half-height 26 at `hz + 14`, so it spans
  // hz - 12 to hz + 40 and TWELVE OF ITS FIFTY-TWO ROWS ARE SKY. At Hills at
  // dusk that is a box reading luma 152 while the ground under it reads 7, and
  // the sky is most of the difference. A box named for the ground must contain
  // only ground, so this one starts a full half-height BELOW the lowest column's
  // horizon (`hzMax`, not the mean) plus a two-row margin. The old placement is
  // published beside it as `groundFarOld` so the noon rows already in section
  // 2.1 stay comparable rather than being improved by moving the ruler.
  const refBoxes = (f, hz, hzMax) => ({
    groundNear: boxStat(f, f.w * 0.5, f.h * 0.66, 70),
    groundMid: boxStat(f, f.w * 0.5, (f.h * 0.66 + hz) * 0.5, 45),
    groundFar: boxStat(f, f.w * 0.5, hzMax + 28, 26),
    groundFarOld: boxStat(f, f.w * 0.5, hz + 14, 26),
    skyLow: boxStat(f, f.w * 0.5, Math.max(24, hz - 40), 22),
    skyHigh: boxStat(f, f.w * 0.5, f.h * 0.05, 40),
  });

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

  const asPng = async () => {
    const blob = await of.screenshot();
    const buf = new Uint8Array(await blob.arrayBuffer());
    let s = ''; const CHUNK = 0x8000;
    for (let i = 0; i < buf.length; i += CHUNK) {
      s += String.fromCharCode.apply(null, buf.subarray(i, i + CHUNK));
    }
    return `data:image/png;base64,${btoa(s)}`;
  };

  const settle = A.settle ?? 12;
  const shipped = { ...p0.tune };
  const rows = [];

  // HEADING IS PART OF THE MEASUREMENT AT LOW SUN, and it is not a detail. The
  // aerosol phase function spans 2.8:1 between the solar and the anti-solar
  // direction, `ndl` on flat ground does not depend on heading at all, and
  // `skyAmb` does not either, so a term's SHARE of the frame swings hard with
  // where the camera points once the sun is low. One heading is INSTRUMENTS.md's
  // sun-glint failure with the sign flipped: it gives a confident answer about a
  // term measured where it cannot act.
  const yaws = A.yaws ?? [site.yaw];

  for (const rung of rungs) for (const yaw of yaws) {
    if (rung.t !== null) {
      of.setTime(rung.t);
      await of.run(0.5);
      of.setTime(rung.t);              // RN-13: of.run ate sim time and moved the sun.
    }
    of.look(yaw, site.pitch);
    await of.settle(settle);
    of.look(yaw, site.pitch);
    await of.settle(2);
    const elevDot = of.stats().sky.elevationDot;
    const elevDeg = +(Math.asin(Math.max(-1, Math.min(1, elevDot))) * 180 / Math.PI).toFixed(2);

    // THE FLOOR, PUBLISHED BEFORE ANY RESULT. Two captures at identical state.
    // Anything smaller than this is not a measurement.
    const f0 = await decode();
    if (rung.t !== null) of.setTime(rung.t);
    const f0b = await decode();
    const hz = horizonOf(f0);
    const b0 = bands(f0, hz.mean);
    const b0b = bands(f0b, hz.mean);
    const floor = {
      worldMean: +Math.abs(b0.world.mean - b0b.world.mean).toFixed(3),
      worldWarm: +Math.abs(b0.world.warm - b0b.world.warm).toFixed(3),
      farWarm: +Math.abs((b0.far?.warm ?? 0) - (b0b.far?.warm ?? 0)).toFixed(3),
    };

    // ---- THE ONE-PAGE PAIRS. Every one of these is a UNIFORM WRITE with no
    // of.run between the captures, so the camera, the sun, the streamed chunk
    // set, the scatter and the wind clock are held equal BY CONSTRUCTION.
    const pairs = {};
    if (A.pairs !== false) {
      // (1) THE AEROSOL. `setAerial(false)` sets sigma to 0, which makes
      // ofAtmoAerial return its input unchanged: "off" is the IDENTITY of the
      // operation and not a second code path.
      const sig = atmo.aerosol()[0];
      atmo.setAerial(false);
      if (rung.t !== null) of.setTime(rung.t);
      const fNoAero = await decode();
      atmo.setAerial(true);
      if (rung.t !== null) of.setTime(rung.t);
      const fReAero = await decode();
      pairs.aerosolOff = bands(fNoAero, hz.mean);
      pairs.aerosolRestore = {
        worldMean: +Math.abs(bands(fReAero, hz.mean).world.mean - b0.world.mean).toFixed(3),
        worldWarm: +Math.abs(bands(fReAero, hz.mean).world.warm - b0.world.warm).toFixed(3),
        sigmaRestored: atmo.aerosol()[0], sigmaShipped: sig,
      };

      // (2) THE GRADE, returned to the pre-look-dev constants. This is the
      // exposure/contrast/saturation half of the suspect list in one write.
      of.setPostTune({
        curveMix: 0, contrast: 1.06, saturation: 1.08, lift: 0.012, exposure: 1.0,
      });
      if (rung.t !== null) of.setTime(rung.t);
      const fOldGrade = await decode();
      of.setPostTune(shipped);
      if (rung.t !== null) of.setTime(rung.t);
      const fReGrade = await decode();
      pairs.preLookdevGrade = bands(fOldGrade, hz.mean);
      pairs.gradeRestore = {
        worldMean: +Math.abs(bands(fReGrade, hz.mean).world.mean - b0.world.mean).toFixed(3),
        worldWarm: +Math.abs(bands(fReGrade, hz.mean).world.warm - b0.world.warm).toFixed(3),
      };

      // (3) EXPOSURE ALONE, because section 2.1 names one global exposure over a
      // 20x albedo range as a known unfixed root cause and this is the first
      // frame bright enough to test it at low sun.
      for (const e of (A.exposures ?? [0.8, 1.0])) {
        of.setPostTune({ ...shipped, exposure: e });
        if (rung.t !== null) of.setTime(rung.t);
        pairs[`exposure${e}`] = bands(await decode(), hz.mean);
      }
      of.setPostTune(shipped);
      if (rung.t !== null) of.setTime(rung.t);
    }

    rows.push({
      want: rung.want, yaw, sunT: rung.t === null ? null : +rung.t.toFixed(4),
      elevDot, elevDeg, elevErr: rung.err,
      horizon: { mean: +hz.mean.toFixed(1), min: hz.min, max: hz.max, skyFrac: hz.skyFrac },
      floor,
      base: b0,
      boxes: refBoxes(f0, hz.mean, hz.max),
      pairs,
      inv: invariants(),
      png: A.shots === true ? await asPng() : undefined,
    });
  }

  // A single-rung run publishes its PNG at the top level so writeshot.mjs can
  // pick it up without a rung index.
  const png = (A.pose === true && rows.length === 1) ? await asPng() : undefined;

  return {
    site: site.name, biome: of.world().biome,
    observer: {
      lat: +of.world().observer.latDeg.toFixed(4),
      lon: +of.world().observer.lonDeg.toFixed(4),
      altM: +of.world().observer.altM.toFixed(2),
      yaw: site.yaw, pitch: site.pitch,
    },
    bootSun, overridden, shippedTune: shipped,
    search: location.search,
    rows, png,
    checks: out.checks, fails: out.fails,
  };
})()
