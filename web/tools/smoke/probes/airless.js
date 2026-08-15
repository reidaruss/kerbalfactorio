// RN-840 / RN-842: does an airless body render as an airless body, and is
// anything filling its shadows?
//
//   node tools/smoke/run.mjs --scenario=walk --body=cinder --clear=ff00ff \
//        --evalfile=tools/smoke/probes/airless.js \
//        --evalargs='{"clear":"ff00ff"}'
//
// THE NAMED FAILURE MODES, written before the instrument was chosen, because a
// probe that measures "is the frame good" measures nothing:
//
//   F1 AERIAL PERSPECTIVE ON A VACUUM. The aerial term veils the ground in a
//      white sheet, so crater relief that exists in the height field never
//      reaches a pixel. Instrument: the ground band's LOW end and the horizon
//      STEP. A veil is additive: it raises the floor and it erases the
//      sky/ground boundary. It does NOT reliably move the mean, which is the
//      statistic it hides in, because a mean survives any symmetric
//      redistribution.
//
//   F2 STARS WASHED OUT AT NOON. On a vacuum there is no scattering to wash
//      them out. Instrument: a LOCAL-CONTRAST count over the sky, not a
//      threshold on absolute luma. See `starPx` below for why the first
//      version of this was an instrument bug.
//
//   F3 BLACK SHADOWS. Turning the sky off correctly returns near-zero ambient,
//      so everything not directly sunlit crushes. Instrument: the SHADOWED
//      population of the ground specifically, split from the sunlit population
//      by Otsu, and reported as a RATIO. A ratio, because an exposure change
//      moves both populations and a fill moves only one.
//
// ---------------------------------------------------------------------------
// THE MASK IS GEOMETRIC AND NOT CHROMATIC, AND THAT IS THE WHOLE CORRECTNESS
// ARGUMENT OF THIS FILE.
//
// The first version split sky from ground at a single horizon ROW, found as the
// largest row-to-row jump in mean luma. On Forge at a standing eye that is
// nearly right. On a 200 km moon seen from 12 km the limb is a pronounced ARC,
// so the corners of any single-row band are sky, and it reported
// `shadow.p50 = 0` over 58,112 pixels: a hard zero, from a lit surface, which
// is not a small error but an impossible reading. It was measuring the corners
// of the sky and calling them shadow (INSTRUMENTS.md: an implausible magnitude
// is an instrument bug until proven otherwise).
//
// lookdev.js's mask cannot be borrowed either. Its rule is "blue and bright,
// contiguous from the top", and on an airless body the sky is BLACK, so the
// chromatic proposer has nothing to propose. Worse, the case this probe exists
// to measure is exactly the case where sky and shadowed ground are the SAME
// COLOUR, so no rule written on colour can ever separate them. A mask that
// fails precisely on the measurement it is built for is not a mask.
//
// So the mask is taken from GEOMETRY. Under `?clear=RRGGBB` the sky box is not
// built at all (Boot.ts gates it on `clearColor === 0`) and every pixel with no
// geometry behind it is left at the clear colour. Sky is then an exact
// per-pixel fact rather than an inference, at any illumination, on any body,
// with the limb wherever it falls.
//
// PASS `"clear": "ff00ff"` IN OF_ARGS WHEN THE PAGE WAS LOADED WITH IT. The
// probe asserts the colour is actually present before trusting it, because a
// mask is a fixture and a fixture must be asserted before the behaviour it
// supports (INSTRUMENTS.md, GP-142).
//
// WHETHER THE MASK FRAME IS ALSO THE MEASUREMENT FRAME IS A CLAIM, NOT AN
// ASSUMPTION. Removing the sky box removes the environment capture, which
// changes stock-material props but must NOT change the terrain, because
// TerrainShader lights itself and never reads three's light list or
// `scene.environment`. `groundOnly: true` reports the terrain statistics from
// this frame so they can be compared against a shipping frame at the same pose;
// if they agree, one run measures both.
(async () => {
  const of = window.__of;
  const args = (typeof OF_ARGS === 'object' && OF_ARGS !== null) ? OF_ARGS : {};
  const poses = args.poses || [
    { name: 'orbit12k', lat: 2.0, lon: 144.0, alt: 12000, yaw: 0, pitch: -12, sundot: 0.55 },
  ];
  const clearHex = args.clear || null;
  const fails = [];
  const check = (name, ok, detail) => {
    if (!ok) fails.push(detail === undefined ? name : `${name}: ${detail}`);
  };

  const cv = document.getElementById('of-canvas');
  const gl = cv.getContext('webgl2', { preserveDrawingBuffer: true })
          || cv.getContext('webgl', { preserveDrawingBuffer: true });
  if (gl === null) throw new Error('airless.js: no GL context off #of-canvas');
  const W = gl.drawingBufferWidth, H = gl.drawingBufferHeight;

  // The HUD is DOM, not canvas, so a readPixels of the drawing buffer already
  // excludes it. That is why this reads GL rather than screenshotting.
  const grab = () => {
    const px = new Uint8Array(W * H * 4);
    gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px);
    return px;
  };

  // Rec.709 luma on the DISPLAY values. The frame is already sRGB-encoded by
  // the composite and every reference number in rendering.md section 2.1 is
  // taken in that space, so decoding here would silently measure a different
  // quantity than the table it is compared against.
  const luma = (px, i) => 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];

  const clearRGB = clearHex === null ? null : [
    parseInt(clearHex.slice(0, 2), 16),
    parseInt(clearHex.slice(2, 4), 16),
    parseInt(clearHex.slice(4, 6), 16),
  ];

  const stat = (a) => {
    if (a.length === 0) return null;
    const s = Float64Array.from(a).sort();
    const q = (f) => s[Math.min(s.length - 1, Math.floor(f * s.length))];
    let sum = 0;
    for (const v of s) sum += v;
    return {
      n: s.length,
      mean: +(sum / s.length).toFixed(3),
      p05: +q(0.05).toFixed(2), p50: +q(0.50).toFixed(2), p95: +q(0.95).toFixed(2),
      min: +s[0].toFixed(2), max: +s[s.length - 1].toFixed(2),
    };
  };

  const rows = [];
  for (const p of poses) {
    of.teleport(p.lat, p.lon, p.alt);
    of.look(p.yaw, p.pitch);
    // RN-844. Solved against THIS site's up, and the miss is asserted. A
    // `?sundot=` is solved once at boot against the SPAWN and does not survive
    // a teleport: at lat -58 the same three asks that hit 0.286 / 0.551 / 0.920
    // at the spawn all land in night inside a 0.109 band.
    let sun = null;
    if (typeof p.sundot === 'number') {
      sun = of.setSunElev(p.sundot);
      check(`pose ${p.name}: the sun elevation asked for is REACHABLE here`,
            sun.err < 0.02, `want ${sun.wantDot} got ${sun.gotDot} err ${sun.err}`);
    }
    let guard = 0;
    while (!of.world().chunks.converged && guard++ < 240) await of.run(0.25);
    of.look(p.yaw, p.pitch);
    // RN-13: `of.run` ate sim time and moved the sun. Re-pin before capturing.
    if (sun !== null) of.setTime(sun.t);
    await of.settle(6);

    const px = grab();

    // --- the geometric mask ------------------------------------------------
    // Either built here from the clear colour, or CARRIED IN from the run that
    // built it. `maskCols[x]` is the first GROUND row of column x, counting in
    // readPixels order (row 0 is the display bottom), so every row at or above
    // it is sky. That form is exact for a limb, which is a single boundary per
    // column, and it is 1,600 integers rather than a 1.44 M-element array,
    // which is the difference between a measurement and 36 MB of digits in the
    // runner's stdout.
    const isSky = new Uint8Array(W * H);
    let nSky = 0;
    const carried = Array.isArray(args.maskCols) && args.maskCols.length === W
      ? args.maskCols : null;
    let cols = carried;
    if (clearRGB !== null) {
      // THE BOUNDARY IS FOUND FROM THE DISPLAY BOTTOM UPWARD, and the first
      // version found it from the TOP downward, which is wrong for a reason
      // worth keeping. Scanning down from the top means "sky is the contiguous
      // run from the top", and STARS BREAK THAT RUN: a star three rows below
      // the frame edge truncates its column, the reconstruction then calls
      // almost the whole column ground, and the alignment check caught it as
      // 118,160 pixels of disagreement between two runs of the same pose.
      // Scanning up from the bottom asks "where does ground end", which a star
      // cannot answer wrongly because every star is above the limb.
      cols = new Array(W);
      for (let x = 0; x < W; ++x) {
        let y = 0;
        for (; y < H; ++y) {
          const i = (y * W + x) * 4;
          if (px[i] === clearRGB[0] && px[i + 1] === clearRGB[1]
              && px[i + 2] === clearRGB[2]) break;
        }
        cols[x] = y;               // first sky row scanning up from the bottom
      }
    }
    // ONE reconstruction path for both runs. The mask run does NOT measure
    // through its own per-pixel match and then hand over a lossy summary of it:
    // it measures through the SAME per-column form the other run will rebuild,
    // so `alignment.delta` compares two identical partitions and is a statement
    // about the geometry rather than about the encoding.
    if (cols !== null) {
      for (let x = 0; x < W; ++x) {
        for (let y = cols[x]; y < H; ++y) { isSky[y * W + x] = 1; ++nSky; }
      }
    }
    // ERODE THE GROUND BY `EDGE` ROWS AT THE BOUNDARY, in both directions.
    // Two different contaminations meet at the limb and neither is the subject:
    // the composite's bloom and FXAA spread the sky's value a few pixels into
    // the ground (in the mask frame that sky is SATURATED MAGENTA, which would
    // otherwise land in the ground's bright tail), and a carried mask is only
    // as aligned as the two runs' chunk streaming. Dropping a narrow band
    // around the boundary costs a fraction of a per cent of the population and
    // removes both. The dropped pixels belong to neither set.
    const EDGE = 3;
    const dropped = new Uint8Array(W * H);
    let nDrop = 0;
    for (let x = 0; x < W; ++x) {
      let firstGround = -1;
      for (let y = H - 1; y >= 0; --y) { if (!isSky[y * W + x]) { firstGround = y; break; } }
      if (firstGround < 0) continue;
      for (let y = firstGround - EDGE; y <= firstGround + EDGE; ++y) {
        if (y >= 0 && y < H && !dropped[y * W + x]) { dropped[y * W + x] = 1; ++nDrop; }
      }
    }
    const skyFrac = +(nSky / (W * H)).toFixed(5);
    // FIXTURE ASSERTIONS, before any behaviour is read off the split. Row 0 of
    // readPixels is the BOTTOM of the display, so the top of the frame is the
    // last row. A pose looking down at a limb must have sky along the display
    // top and none along the display bottom, and a mask that does not is
    // measuring something else.
    let topSky = 0, botSky = 0;
    for (let x = 0; x < W; ++x) {
      topSky += isSky[(H - 1) * W + x];
      botSky += isSky[x];
    }
    if (clearRGB !== null) {
      check(`pose ${p.name}: the clear colour is PRESENT (the mask exists at all)`,
            nSky > 0, `matched ${nSky} px of ${W * H}`);
      check(`pose ${p.name}: the DISPLAY TOP row is sky`,
            topSky / W > 0.9, `topRowSkyFrac ${(topSky / W).toFixed(3)}`);
      check(`pose ${p.name}: the DISPLAY BOTTOM row is NOT sky`,
            botSky === 0, `bottomRowSkyFrac ${(botSky / W).toFixed(3)}`);
      check(`pose ${p.name}: the sky share is plausible for a downward pose`,
            skyFrac > 0.05 && skyFrac < 0.85, `skyFrac ${skyFrac}`);
    }

    // --- ground and sky populations ----------------------------------------
    const groundL = [], skyL = [];
    for (let k = 0, i = 0; k < W * H; ++k, i += 4) {
      if (dropped[k]) continue;
      (isSky[k] ? skyL : groundL).push(luma(px, i));
    }
    const gs = stat(groundL);
    const skyStat = stat(skyL);

    // --- F2: stars, by LOCAL CONTRAST ---------------------------------------
    // THE FIRST VERSION OF THIS WAS AN INSTRUMENT BUG AND IS RECORDED SO IT IS
    // NOT REWRITTEN. It counted sky pixels above the sky's own p95 + 12. On a
    // black vacuum sky that is fine. On a SCATTERING sky the band runs 19 to
    // 121 counts from zenith to horizon, so the threshold sat in the middle of
    // a smooth gradient and counted the bright half of the sky as stars:
    // 15,487 "stars" in a frame that has a few hundred. A star is small and
    // bright RELATIVE TO ITS SURROUNDINGS; the sky gradient is smooth at that
    // scale. So the test is local, and it then reads the same on both skies.
    const R = 3;
    let starPx = 0;
    for (let y = R; y < H - R; ++y) {
      for (let x = R; x < W - R; ++x) {
        const k = y * W + x;
        if (!isSky[k] || dropped[k]) continue;
        const c = luma(px, k * 4);
        if (c < 8) continue;                    // nothing to be brighter than
        let bg = 0;
        bg += luma(px, ((y - R) * W + x) * 4);
        bg += luma(px, ((y + R) * W + x) * 4);
        bg += luma(px, (y * W + (x - R)) * 4);
        bg += luma(px, (y * W + (x + R)) * 4);
        if (c - bg / 4 > 10) ++starPx;
      }
    }

    // --- F3: the shadowed population of the GROUND --------------------------
    // Otsu rather than a constant cut: the two populations on a sunlit airless
    // surface are genuinely bimodal, and Otsu finds the valley between them
    // from the data. A fixed cut would move with exposure and would report a
    // fill that was only a brightening.
    let shadow = null, sunlit = null, otsu = -1, shadowFrac = 0;
    if (gs !== null && groundL.length > 0) {
      const hist = new Float64Array(256);
      for (const v of groundL) hist[Math.min(255, Math.max(0, Math.round(v)))]++;
      const total = groundL.length;
      let sumAll = 0;
      for (let i = 0; i < 256; ++i) sumAll += i * hist[i];
      let wB = 0, sumB = 0, best = -1;
      for (let t = 0; t < 256; ++t) {
        wB += hist[t];
        if (wB === 0) continue;
        const wF = total - wB;
        if (wF === 0) break;
        sumB += t * hist[t];
        const mB = sumB / wB, mF = (sumAll - sumB) / wF;
        const between = wB * wF * (mB - mF) * (mB - mF);
        if (between > best) { best = between; otsu = t; }
      }
      const dark = [], light = [];
      for (const v of groundL) (v <= otsu ? dark : light).push(v);
      shadow = stat(dark); sunlit = stat(light);
      shadowFrac = +(dark.length / total).toFixed(4);
    }

    const sky = of.stats().sky;
    rows.push({
      pose: p.name,
      alt: p.alt, sundot: p.sundot ?? null, sun,
      elevationDot: sky.elevationDot,
      // RN-840's published terms. "The sky is black" has five causes and these
      // separate them: a correct vacuum is box=true + atmosOn=0, a missing sky
      // is box=false, and `?clear=` is box=false with a non-zero clear colour.
      air: sky.air,
      maskSkyFrac: skyFrac, maskTopRowSky: +(topSky / W).toFixed(4),
      maskSource: clearRGB !== null ? 'clear' : (carried !== null ? 'carried' : 'none'),
      maskEdgeDropped: nDrop,
      // Emitted only when asked for, and only by the run that BUILT it, so a
      // carried mask can never be re-emitted and drift a generation at a time.
      maskCols: (args.emitMask === true && clearRGB !== null) ? cols : undefined,
      ground: gs, sky: skyStat,
      starPx,
      otsu, shadowFrac, shadow, sunlit,
      // THE HEADLINE FOR F3. A ratio, because it is the only form of this
      // number an exposure change does not move.
      shadowOverSunlit: (shadow && sunlit && sunlit.p50 > 0)
        ? +(shadow.p50 / sunlit.p50).toFixed(4) : null,
    });
  }

  check('the sim advanced', of.world().tick > 0);
  return { valid: fails.length === 0, fails, W, H, clear: clearHex, rows };
})()
