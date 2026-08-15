// RN-731. THE TERRAIN SPECULAR LOBE, measured as a settled-frame pair.
//
//   node tools/smoke/run.mjs --scenario=walk --sandbox=1 \
//        --evalfile=tools/smoke/probes/terrainspec.js
//
// WHAT IS BEING MEASURED. Until this pass the terrain's whole lighting model
// was `lit = albedo * irradiance`: pure Lambert, no specular term, no roughness
// input anywhere in the material. So this probe is not asking "is the highlight
// tuned right", it is asking a prior question that has a yes/no answer: does
// ground that could not glint now glint, by how much, and did the four
// calibrated reference luminances in rendering.md section 2.1 survive it.
//
// THE ATTRIBUTION RIDES `of.framehash` AND NOT `of.screenshot`, and the first
// draft of this probe got that wrong in exactly the way lookdev.js warns about
// in its own PHASE 1 comment. `of.screenshot()` resolves from inside the rAF
// drain, i.e. IT WAITS FOR A FRAME, WHICH RUNS THE SIM. So a screenshot pair can
// never be bit-exact: the first draft read 59.56 per cent of pixels moved with a
// maxDelta of MINUS 149.8 counts, which is impossible for a purely additive
// term, and the restore was not bit-exact at any rung. That number was the day
// clock, the wind and the creatures, not a specular lobe.
//
// `framehash` renders SYNCHRONOUSLY and advances no ticks, so three of them back
// to back with nothing but a uniform write between them differ by NOTHING except
// that write, and the floor is not small, it is exactly zero. That is what makes
// the restore a real negative control rather than a hopeful one.
//
// THE HISTOGRAM STILL NEEDS REAL RGB AND THEREFORE STILL NEEDS FRAMES, so it is
// a second phase, `of.setTime` is re-pinned before every decode (RN-13: of.run
// ate sim time and moved the sun), and TWO captures at the SAME amplitude come
// first so this instrument publishes its OWN FLOOR beside its result. Any claim
// smaller than that floor is not a result.
//
// THE FIXTURE IS ASSERTED BEFORE THE BEHAVIOUR (GP-142, RN-150). `specDefault()`
// publishes whether the flag was PRESENT separately from its value, because
// `Number(null)` is 0 and 0 is finite: a term that ships at amplitude 0 would
// measure perfectly through an explicit `?terrainspecamp=1` forever while the
// shipped build stayed Lambert. That exact bug has shipped twice in this file's
// neighbours (`groundtexamp` and the wet-sand band, both RN-150).
//
// THE CALIBRATION FRAME IS A LOW SUN, NOT NOON, and that is named failure mode
// 2 from TerrainArt.glsl. A specular is a grazing phenomenon: measured only at
// noon this term would read as nearly nothing and the wrong conclusion would be
// "it does not work". The rungs below run from noon down through the terminator
// for exactly that reason, mirroring how RELIEF_DEFAULT was calibrated.
//
// THE SUN IS READ FROM `of.stats().sky.elevationDot`, NEVER from
// `__ofPost.state().sun`, which freezes below the horizon.

(async () => {
  const of = window.__of;
  const A = OF_ARGS ?? {};
  const out = { checks: [], fails: [], sites: [] };
  const check = (name, ok, detail) => {
    out.checks.push({ name, ok: !!ok, detail });
    if (!ok) out.fails.push(`${name}: ${JSON.stringify(detail)}`);
  };

  // ------------------------------------------------------------- the fixture
  const art = window.__ofTerrainArt;
  check('the terrain art runtime handle exists at all', !!art, { has: !!art });
  if (!art) { return out; }
  check('setSpec/getSpec/specDefault are published on the same handle',
    typeof art.setSpec === 'function' && typeof art.getSpec === 'function'
    && typeof art.specDefault === 'function',
    { setSpec: typeof art.setSpec, getSpec: typeof art.getSpec,
      specDefault: typeof art.specDefault });

  const def = art.specDefault();
  check('the SHIPPED BOOT DEFAULT is a live amplitude on BOTH halves, not a dead 0 (RN-150)',
    def.present === false && def.sun > 0 && def.sky > 0, def);
  const live = art.getSpec();
  check('the live value equals the boot default with no flag in the URL',
    Math.abs(live[0] - def.sun) < 1e-9 && Math.abs(live[1] - def.sky) < 1e-9,
    { live, boot: [def.sun, def.sky], search: location.search });

  // ------------------------------------------------------------------ scene
  const site = A.site ?? { name: 'hills', lat: -31.165, lon: -86.27401, yaw: 300, pitch: -10 };
  of.teleport(site.lat, site.lon, site.alt ?? 2.0);
  of.look(site.yaw, site.pitch);
  await of.run(1.0);
  let spin = 0;
  while (!of.world().chunks.converged && spin++ < 200) await of.run(0.25);
  let drain = 0;
  while (of.stats().props.scatterBacklog > 0 && drain++ < 900) await of.run(1 / 60);
  await of.run(1.0, 60);
  if (window.__ofWind) window.__ofWind.freeze(A.windT ?? 40);

  // ------------------------------------------------------- the sun elevation
  // Rising side only, so a target elevation names ONE time of day.
  const wantDots = A.dots ?? [null, 0.35, 0.12, 0.03];
  const samples = A.sunSamples ?? 480;
  const scan = [];
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
  const rungs = wantDots.map((d) => {
    if (d === null) return { want: 'noon', t: noon.t, dot: noon.e, err: 0 };
    let best = scan[0];
    let err = 9;
    for (const s of scan) {
      if (!s.rising) continue;
      const e = Math.abs(s.e - d);
      if (e < err) { err = e; best = s; }
    }
    return { want: d, t: best.t, dot: +best.e.toFixed(4), err: +err.toFixed(4) };
  });

  // --------------------------------------------------------------- the metric
  const decode = async () => {
    const blob = await of.screenshot();
    const img = await createImageBitmap(blob);
    const cv = new OffscreenCanvas(img.width, img.height);
    const cx = cv.getContext('2d', { willReadFrequently: true });
    cx.drawImage(img, 0, 0);
    return { d: cx.getImageData(0, 0, img.width, img.height).data, w: img.width, h: img.height };
  };

  const luma = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

  // `groundNear` is section 2.1's own box: 140 px at 0.5 / 0.66 of the frame.
  // Same box, same place, so the number this prints is comparable to the table
  // in that section rather than to itself only.
  const groundNear = (f) => {
    const cx0 = Math.round(f.w * 0.5) - 70;
    const cy0 = Math.round(f.h * 0.66) - 70;
    let r = 0, g = 0, b = 0, n = 0;
    for (let y = cy0; y < cy0 + 140; ++y) {
      for (let x = cx0; x < cx0 + 140; ++x) {
        const i = (y * f.w + x) * 4;
        r += f.d[i]; g += f.d[i + 1]; b += f.d[i + 2]; ++n;
      }
    }
    return { r: +(r / n).toFixed(1), g: +(g / n).toFixed(1), b: +(b / n).toFixed(1),
      luma: +luma(r / n, g / n, b / n).toFixed(1) };
  };

  // The whole frame, and the two numbers that say whether a specular happened:
  // how many pixels moved at all, and how far the brightest ones moved. A mean
  // is the wrong statistic for a highlight, which is by definition a small
  // number of pixels moving a long way.
  const compare = (aF, bF) => {
    let moved = 0, up = 0, down = 0, sum = 0, max = 0;
    const n = aF.w * aF.h;
    for (let i = 0; i < n; ++i) {
      const j = i * 4;
      const la = luma(aF.d[j], aF.d[j + 1], aF.d[j + 2]);
      const lb = luma(bF.d[j], bF.d[j + 1], bF.d[j + 2]);
      const dl = lb - la;
      if (dl !== 0) { ++moved; if (dl > 0) ++up; else ++down; }
      sum += dl;
      if (Math.abs(dl) > Math.abs(max)) max = dl;
    }
    return { movedPct: +(100 * moved / n).toFixed(2), upPct: +(100 * up / n).toFixed(2),
      downPct: +(100 * down / n).toFixed(2), meanDelta: +(sum / n).toFixed(3),
      maxDelta: +max.toFixed(1) };
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

  // ------------------------------------------------------------- the sweep
  const boot = art.getSpec();
  const settle = A.settle ?? 12;
  for (const rung of rungs) {
    await of.run(0.5);
    of.setTime(rung.t);
    await of.settle(settle);

    // PHASE 1, THE ATTRIBUTION, ON framehash ALONE. No screenshot may appear
    // anywhere in this block or the restore stops being a control.
    //
    // FOUR STATES, because the two halves fail differently: both off, sun
    // only, sky only, both on. The sun half is a local highlight; the sky half
    // is the one that can become a broad ambient lift over the whole middle
    // distance. A single on/off pair can say the specular is doing something
    // and can never say WHICH HALF is doing it, and the first run of this probe
    // moved 47.7 per cent of tiles without being able to attribute that.
    art.setSpec(boot[0], boot[1]);
    const hOn = of.framehash(TX, TY);
    art.setSpec(0, 0);
    const hOff = of.framehash(TX, TY);
    art.setSpec(boot[0], 0);
    const hSunOnly = of.framehash(TX, TY);
    art.setSpec(0, boot[1]);
    const hSkyOnly = of.framehash(TX, TY);
    art.setSpec(boot[0], boot[1]);
    const hBack = of.framehash(TX, TY);

    const termDiff = tileDiff(hOff, hOn);
    const sunDiff = tileDiff(hOff, hSunOnly);
    const skyDiff = tileDiff(hOff, hSkyOnly);
    const restore = tileDiff(hOn, hBack);

    // PHASE 2, THE HISTOGRAM, which needs real RGB and therefore needs frames.
    // Two captures at the SAME amplitude first: their difference is this
    // instrument's own floor, published beside the result rather than assumed
    // to be zero.
    art.setSpec(boot[0], boot[1]);
    of.setTime(rung.t);
    const onA = await decode();
    of.setTime(rung.t);
    const onB = await decode();
    art.setSpec(0, 0);
    of.setTime(rung.t);
    const off = await decode();
    art.setSpec(boot[0], boot[1]);

    const row = {
      site: site.name,
      want: rung.want,
      sunDot: rung.dot,
      grazeErr: rung.err,
      groundNearOff: groundNear(off),
      groundNearOn: groundNear(onA),
      termTiles: termDiff,
      sunTiles: sunDiff,
      skyTiles: skyDiff,
      restoreTiles: restore,
      restoreExact: restore.peak === 0,
      decodeFloor: compare(onA, onB),
      delta: compare(off, onA),
    };
    row.groundNearLumaDelta = +(row.groundNearOn.luma - row.groundNearOff.luma).toFixed(1);
    out.sites.push(row);

    check(`the restore is bit-exact on framehash at ${site.name} ${rung.want}`,
      restore.peak === 0, restore);
    check(`the term beats this probe's own decode floor at ${site.name} ${rung.want}`,
      row.delta.movedPct > row.decodeFloor.movedPct,
      { term: row.delta.movedPct, floor: row.decodeFloor.movedPct });
  }

  // The term must not be a no-op ANYWHERE, and it must not be a wash EVERYWHERE.
  // Both directions are named because they are the two ways this pass fails.
  const anyMoved = out.sites.some((s) => s.termTiles.moved > 0);
  check('the lobe is not a no-op: some rung moves real tiles on framehash',
    anyMoved, out.sites.map((s) => ({ want: s.want, tiles: s.termTiles.moved,
      peak: s.termTiles.peak })));

  // A purely additive term can only make a tile BRIGHTER. A tile going down on
  // the synchronous instrument would mean the lobe is stealing energy, which it
  // is not written to do, so this is a claim about the arithmetic and not taste.
  const wentDown = out.sites.filter((s) => s.termTiles.down > 0);
  check('an additive lobe never darkens a tile (framehash, sim frozen)',
    wentDown.length === 0, wentDown.map((s) => ({ want: s.want,
      down: s.termTiles.down, peak: s.termTiles.peak })));

  const worstGround = Math.max(...out.sites.map((s) => Math.abs(s.groundNearLumaDelta)));
  check('section 2.1 groundNear luma moves by less than 8 counts at every rung',
    worstGround < 8, out.sites.map((s) => ({ want: s.want, d: s.groundNearLumaDelta })));

  // Named failure mode 1: the whole ground goes satin. A specular that moves
  // nearly every pixel upward is not a highlight, it is an ambient lift.
  const satin = out.sites.filter((s) => s.delta.upPct > 60);
  check('the lobe is a HIGHLIGHT and not an ambient lift (failure mode 1)',
    satin.length === 0, satin.map((s) => ({ want: s.want, up: s.delta.upPct })));

  art.setSpec(boot[0], boot[1]);
  return out;
})()
