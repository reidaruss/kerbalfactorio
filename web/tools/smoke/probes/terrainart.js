// Does the terrain SURFACE ART do what it claims, and is it attributable?
//
//   node tools/smoke/run.mjs --scenario=walk --sandbox=1 --url=http://127.0.0.1:4196/ \
//     --evalfile=tools/smoke/probes/terrainart.js \
//     --evalargs='{"lat":12,"lon":150,"yawDeg":300,"pitchDeg":-10}'
//
// The RN-15 camera by default, so this pass, RN-15 and RN-30 are all comparable.
//
// ---------------------------------------------------------------------------
// THE METRIC IS A VARIANCE, AND THE MEAN IS THE CONTROL. THAT IS THE WHOLE
// DESIGN OF THIS PROBE.
// ---------------------------------------------------------------------------
// The claim is "the ground stops being flat colour". Flatness is a statement
// about the SPREAD of a region, not its level, so the number that answers it is
// a standard deviation. And the failure mode that a standard deviation alone
// cannot see is the one this project has already paid for twice (RN-10's colour
// grade crushing the shadows, and the aerial-perspective attempt that darkened
// instead of hazing): a term that simply moves the exposure or the tint would
// look like progress on any absolute reading.
//
// So the MEAN of the same region is published beside the deviation as a
// control. A variation layer must raise the spread while leaving the level
// close to where it was. If the mean moves as much as the spread does, the term
// is a brightness change wearing a variation costume, and this probe says so.
//
// TWO SPATIAL SCALES, measured separately, because "flat" fails at two ranges
// and the two are fixed by different terms:
//   macroSd  the deviation of 16x16 BLOCK MEANS across the band. Blocking first
//            removes everything finer than 16 px, so this is deaf to the bump
//            and to per-instance foliage colour and hears only the macro field.
//   microSd  the mean deviation WITHIN those same blocks. This is the opposite
//            filter: it hears the bump and is nearly deaf to the macro field,
//            because a 186 m octave is flat across 16 px.
// One number for both would have been movable by either term, and a term that
// cannot be attributed is a term nobody can defend.
//
// ---------------------------------------------------------------------------
// MATCHED PAIRS, ONE SETTLED FRAME APART
// ---------------------------------------------------------------------------
// Both captures come from ONE binary through `window.__ofTerrainArt`, so the
// camera, the sun, the streamed chunk set, the scatter placement and the post
// stack are equal by construction rather than by care. RN-30 established this
// is the stronger instrument, and it is the only honest one on a machine where
// four lanes are building: a build pair cannot hold the streamed set equal.
//
// ---------------------------------------------------------------------------
// THE NEGATIVE CONTROL, WHICH IS THE REASON TO BELIEVE ANY OF IT
// ---------------------------------------------------------------------------
// The SKY BAND, from the same two captures, must read exactly zero. The terrain
// art lives in the terrain fragment shader and the sky is a different material,
// so a sky that moved would mean the term had escaped into something shared, or
// that the two captures were not actually a matched pair. That is `maps.js`'s
// pattern and it caught a real defect there.
(async () => {
  const of = window.__of;
  const art = window.__ofTerrainArt;
  const lat = OF_ARGS.lat ?? 12;
  const lon = OF_ARGS.lon ?? 150;
  const yaw = OF_ARGS.yawDeg ?? 300;
  const pitch = OF_ARGS.pitchDeg ?? -10;
  const sunT = OF_ARGS.sunT ?? 0.30;

  if (art === undefined) {
    return { valid: false, fails: ['window.__ofTerrainArt is not present'] };
  }

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
  of.setTime(sunT);
  await of.run(2.0);
  let spin = 0;
  while (!of.world().chunks.converged && spin++ < 240) await of.run(0.5);
  await of.run(1.0);
  of.look(yaw, pitch);
  of.setTime(sunT);
  await of.settle(30);

  // One capture, returned as raw RGBA plus its dimensions.
  const grab = async () => {
    of.setTime(sunT);
    await of.settle(12);
    const bmp = await createImageBitmap(await of.screenshot());
    const cv = new OffscreenCanvas(bmp.width, bmp.height);
    const ctx = cv.getContext('2d');
    ctx.drawImage(bmp, 0, 0);
    const W = bmp.width;
    const H = bmp.height;
    const d = ctx.getImageData(0, 0, W, H).data;
    bmp.close();
    return { d, W, H };
  };

  // Luma, and the per-block statistics of one horizontal band.
  //
  // The block size is 16 px and it is not arbitrary: at the pinned camera the
  // near band is ground 2 to 12 m away, where 16 px subtends roughly 0.4 m, so
  // a block is smaller than every octave of the macro field and larger than the
  // bump's finest. That is what makes the two statistics separate rather than
  // two views of the same thing.
  const BLK = OF_ARGS.blockPx ?? 16;
  const stats = (cap, y0f, y1f) => {
    const { d, W, H } = cap;
    const y0 = Math.round(H * y0f);
    const y1 = Math.max(y0 + BLK, Math.round(H * y1f));
    const blockMeans = [];
    let withinSum = 0;
    let withinN = 0;
    let lit = 0;
    let all = 0;
    let rSum = 0;
    let gSum = 0;
    let bSum = 0;
    for (let by = y0; by + BLK <= y1; by += BLK) {
      for (let bx = 0; bx + BLK <= W; bx += BLK) {
        let s = 0;
        let s2 = 0;
        let n = 0;
        for (let y = by; y < by + BLK; ++y) {
          for (let x = bx; x < bx + BLK; ++x) {
            const i = (y * W + x) * 4;
            const R = d[i];
            const G = d[i + 1];
            const B = d[i + 2];
            const L = 0.2126 * R + 0.7152 * G + 0.0722 * B;
            all++;
            if (L >= 12) lit++;
            rSum += R; gSum += G; bSum += B;
            s += L; s2 += L * L; n++;
          }
        }
        const m = s / n;
        blockMeans.push(m);
        // Population deviation inside this block.
        withinSum += Math.sqrt(Math.max(0, s2 / n - m * m));
        withinN++;
      }
    }
    const bm = blockMeans.reduce((a, b) => a + b, 0) / Math.max(1, blockMeans.length);
    const bv = blockMeans.reduce((a, b) => a + (b - bm) * (b - bm), 0)
      / Math.max(1, blockMeans.length);
    return {
      px: all, blocks: blockMeans.length,
      mean: +bm.toFixed(3),
      macroSd: +Math.sqrt(bv).toFixed(4),
      microSd: +(withinSum / Math.max(1, withinN)).toFixed(4),
      meanR: +(rSum / Math.max(1, all)).toFixed(2),
      meanG: +(gSum / Math.max(1, all)).toFixed(2),
      meanB: +(bSum / Math.max(1, all)).toFixed(2),
      litFraction: +(lit / Math.max(1, all)).toFixed(4),
    };
  };

  // Absolute per-pixel difference between two captures over one band. This is
  // the "did anything move at all, and where" reading, and it is what makes the
  // sky control meaningful: a band that moved by exactly 0 counts over tens of
  // thousands of pixels cannot have been touched.
  const diff = (a, b, y0f, y1f) => {
    const { W, H } = a;
    const y0 = Math.round(H * y0f);
    const y1 = Math.round(H * y1f);
    let sum = 0;
    let peak = 0;
    let moved = 0;
    let n = 0;
    for (let y = y0; y < y1; ++y) {
      for (let x = 0; x < W; ++x) {
        const i = (y * W + x) * 4;
        const dr = Math.abs(a.d[i] - b.d[i]);
        const dg = Math.abs(a.d[i + 1] - b.d[i + 1]);
        const db = Math.abs(a.d[i + 2] - b.d[i + 2]);
        const m = Math.max(dr, dg, db);
        sum += m;
        if (m > peak) peak = m;
        if (m > 2) moved++;
        n++;
      }
    }
    return {
      samplePx: n,
      meanAbsDelta: +(sum / Math.max(1, n)).toFixed(4),
      peak,
      movedFraction: +(moved / Math.max(1, n)).toFixed(4),
    };
  };

  const BANDS = {
    // 0.68 to 0.82, NOT the 0.80 to 0.97 the sibling probes use. At this pitch
    // the first-person arms occupy the bottom fifth of the frame, so the old
    // band was measuring an animated view model as if it were ground: its
    // capture-to-capture noise floor read a mean of 8.57 counts, larger than
    // any term here produces. Ground, and only ground.
    near: [OF_ARGS.nearBand0 ?? 0.68, OF_ARGS.nearBand1 ?? 0.82],
    mid: [OF_ARGS.midBand0 ?? 0.55, OF_ARGS.midBand1 ?? 0.72],
    far: [OF_ARGS.farBand0 ?? 0.42, OF_ARGS.farBand1 ?? 0.52],
    horizon: [OF_ARGS.horizonBand0 ?? 0.29, OF_ARGS.horizonBand1 ?? 0.38],
    sky: [OF_ARGS.skyBand0 ?? 0.05, OF_ARGS.skyBand1 ?? 0.15],
  };

  const before = art.get();
  // Five states, all from one binary, each one settled frame from the last.
  // ISOLATED rather than only all-on against all-off, because "the ground
  // varies more" is a claim three separate terms could each produce and a
  // single toggle could not tell them apart.
  //
  // THE PROPS ARE HIDDEN FOR THE WHOLE SERIES, and that is a correction to the
  // first version of this probe rather than a refinement.
  //
  // Run with the foliage up, the block-mean spread of every band reads 20 to 32
  // counts BEFORE this pass exists, because at RN-15's density the understorey
  // covers about 55% of the frame and a field of individually colour-jittered
  // cards has an enormous block-to-block spread of its own. The terrain's
  // variation is a few counts on top of that, so the statistic was dominated by
  // the thing it was not measuring and the gain read 0.956, i.e. slightly DOWN.
  // The term was working the whole time: the per-term difference fields moved
  // 63.9% of the near band with a peak of 134 counts in exactly that run.
  //
  // This is the same defect the post lane's probe was carrying, found the same
  // night: RN-15 planted an understorey in a control column that had been
  // measured on bare ground, and every instrument that had a "plain ground"
  // reference in it silently stopped having one. `of.propsVisible(false)` is
  // the isolation those instruments already use.
  of.propsVisible(false);
  await of.settle(12);
  art.set(0, 0, 0); const capOff = await grab();
  art.set(before[0], 0, 0); const capMacro = await grab();
  art.set(0, before[1], 0); const capBump = await grab();
  art.set(0, 0, before[2]); const capStrata = await grab();
  art.set(before[0], before[1], before[2]); const capAll = await grab();
  // THE NOISE FLOOR: a second capture in the SAME state as capOff. Every delta
  // below is measured against this rather than against zero.
  //
  // Zero is not reachable and expecting it produced two false results tonight.
  // `of.screenshot()` resolves on a later frame, so sim time advances between
  // any two captures however settled the world is, and the first-person arms
  // are animated. With the bump amplitude at its shipped 0 the probe read a
  // 2.06 mean over 11.9% of the near band and reported that a DISABLED term was
  // moving pixels. It was the arms.
  //
  // AND THE STATE IS RESET FIRST. The first version of this line took the
  // floor capture without setting the amplitudes back to zero, so it was a
  // second ALL-ON frame and the "floor" came out EXACTLY equal to the effect it
  // was supposed to bound, to four decimal places, on every band. Two numbers
  // agreeing to the last digit is a wiring diagnosis, never a coincidence.
  art.set(0, 0, 0);
  const capOffB = await grab();

  // THE NEGATIVE CONTROL IS TAKEN LOOKING STRAIGHT UP, and that is a fix at the
  // root rather than a threshold.
  //
  // The first version took the control from a band of the SHOOTING frame, rows
  // 0.05 to 0.15, on the assumption that the top of the frame is sky. At the
  // Hills camera it is, and the control read exactly 0.0000 mean and 0 peak
  // over 144,000 px on all four terms, twice. At the Mountains spawn, which a
  // terrain rework moved to 4,668 m, it is not: mountains fill the upper frame,
  // the band moved by a mean of 1.4 counts over 24.8% of its pixels, and the
  // probe reported that the term had escaped into the sky. It had not. The BAND
  // had stopped being sky.
  //
  // That is the same defect this project has now recorded three times (RN-30's
  // far band that was 30 m of ground, the post probe's control column that
  // RN-15 planted grass in): a control whose validity depends on where the
  // camera happens to point. Pitching to +72 degrees makes the frame sky at
  // EVERY site and every altitude on this planet, so the control is a property
  // of the probe rather than of the shot. The camera is restored afterwards and
  // nothing else is touched.
  const skyPitch = OF_ARGS.skyPitchDeg ?? 72;
  of.look(yaw, skyPitch);
  of.setTime(sunT);
  await of.settle(20);
  art.set(0, 0, 0); const capUpOff = await grab();
  art.set(before[0], before[1], before[2]); const capUpAll = await grab();
  // The control gets its OWN floor, taken the same way as the band floors and
  // for the same reason: two captures cannot be taken at the same instant, so
  // "exactly zero" is not a reachable bound and asserting it makes the control
  // fail intermittently for reasons that have nothing to do with the term. The
  // claim is that the term moves the sky no more than doing nothing does.
  art.set(0, 0, 0); const capUpOffB = await grab();
  of.look(yaw, pitch);
  of.setTime(sunT);
  await of.settle(20);
  of.propsVisible(true);

  // The block-mean spread OF THE DIFFERENCE FIELD. This answers "how much
  // low-frequency structure did this term ADD" directly, and unlike the gain
  // ratio above it cannot be diluted by anything else in the frame, because
  // everything else in the frame is identical in the two captures and
  // subtracts to zero. It is the more robust of the two statistics and it is
  // published beside the ratio rather than instead of it.
  const addedSd = (a, b, y0f, y1f) => {
    const { W, H } = a;
    const y0 = Math.round(H * y0f);
    const y1 = Math.max(y0 + BLK, Math.round(H * y1f));
    const means = [];
    for (let by = y0; by + BLK <= y1; by += BLK) {
      for (let bx = 0; bx + BLK <= W; bx += BLK) {
        let s = 0;
        let n = 0;
        for (let y = by; y < by + BLK; ++y) {
          for (let x = bx; x < bx + BLK; ++x) {
            const i = (y * W + x) * 4;
            const la = 0.2126 * a.d[i] + 0.7152 * a.d[i + 1] + 0.0722 * a.d[i + 2];
            const lb = 0.2126 * b.d[i] + 0.7152 * b.d[i + 1] + 0.0722 * b.d[i + 2];
            s += lb - la; n++;
          }
        }
        means.push(s / n);
      }
    }
    const m = means.reduce((x, y) => x + y, 0) / Math.max(1, means.length);
    const v = means.reduce((x, y) => x + (y - m) * (y - m), 0)
      / Math.max(1, means.length);
    return +Math.sqrt(v).toFixed(4);
  };

  const bandReport = {};
  for (const [name, [a, b]] of Object.entries(BANDS)) {
    bandReport[name] = {
      off: stats(capOff, a, b),
      all: stats(capAll, a, b),
      addedMacroSd: addedSd(capOff, capMacro, a, b),
      addedAllSd: addedSd(capOff, capAll, a, b),
      // The same two statistics computed over two captures that differ ONLY by
      // the sim time between them. This is the floor every claim clears.
      noise: diff(capOff, capOffB, a, b),
      noiseSd: addedSd(capOff, capOffB, a, b),
      dMacro: diff(capOff, capMacro, a, b),
      dBump: diff(capOff, capBump, a, b),
      dStrata: diff(capOff, capStrata, a, b),
      dAll: diff(capOff, capAll, a, b),
    };
  }

  // THE CLAIMS, stated as deltas so the sign is the answer.
  const claim = (name) => {
    const o = bandReport[name].off;
    const a = bandReport[name].all;
    return {
      macroSd: [o.macroSd, a.macroSd],
      macroSdGain: +(a.macroSd / Math.max(0.0001, o.macroSd)).toFixed(3),
      microSd: [o.microSd, a.microSd],
      microSdGain: +(a.microSd / Math.max(0.0001, o.microSd)).toFixed(3),
      // THE CONTROL. A variation layer raises the spread and leaves the level
      // where it was. This is the ratio that convicts a brightness change.
      meanShiftPct: +(100 * (a.mean - o.mean) / Math.max(1, o.mean)).toFixed(2),
    };
  };

  of.setTime(sunT);
  await of.run(OF_ARGS.timeSecs ?? 4.0);
  const w = of.world();
  const s = of.stats();
  const p = s.props;

  // The control, over the TOP 45% of the up-pitched frame.
  //
  // Not the whole frame, and the reason is measured rather than assumed. Over
  // the whole up-pitched frame the control read a mean of 0.776 counts with a
  // PEAK OF 194 over 2.51% of pixels, which is far too structured to be a term
  // leaking into a sky shader and far too large to be noise. It is the
  // FIRST-PERSON VIEW MODEL: the arms are drawn in their own pass, they are
  // animated, and two captures one settled frame apart do not have them in the
  // same place. `probes/post.js` already records exactly this and excludes its
  // own last three bands for it.
  //
  // The arms occupy the lower frame by construction of a first-person view
  // model, so the top 45% of a frame pitched 72 degrees up is sky and nothing
  // else at any site, any altitude and any tool state. That is a structural
  // exclusion, not a tuned one.
  const SKY_Y1 = OF_ARGS.skyControlY1 ?? 0.45;
  const skyControl = {
    pitchDeg: skyPitch, rows: [0.0, SKY_Y1],
    stats: stats(capUpOff, 0.0, SKY_Y1),
    delta: diff(capUpOff, capUpAll, 0.0, SKY_Y1),
    noise: diff(capUpOff, capUpOffB, 0.0, SKY_Y1),
    // The lower frame is reported too, unasserted, so that the view model's
    // contribution stays visible instead of being quietly cropped away.
    viewModelRows: diff(capUpOff, capUpAll, SKY_Y1, 1.0),
  };
  // The in-frame band is KEPT and still reported, because at a camera where it
  // really is sky it is a second, independent reading. It is no longer asserted
  // on, for the reason above.
  const sky = bandReport.sky;
  const fails = [];
  // The sky is a different material and cannot be reached by a term in the
  // terrain fragment shader. If it moved, either the term escaped or these are
  // not a matched pair, and both make every other number here worthless.
  if (skyControl.delta.meanAbsDelta > Math.max(skyControl.noise.meanAbsDelta, 0.001)
    || skyControl.delta.peak > Math.max(skyControl.noise.peak, 1)) {
    fails.push('the SKY moved MORE than doing nothing does, so either this is '
      + 'not a matched pair or the term is not confined to the terrain '
      + `(delta ${skyControl.delta.meanAbsDelta}/${skyControl.delta.peak} `
      + `against floor ${skyControl.noise.meanAbsDelta}/${skyControl.noise.peak})`);
  }
  if (skyControl.delta.samplePx < 10000) fails.push('sky control sample too small');
  for (const n of ['near', 'mid', 'far']) {
    if (bandReport[n].off.litFraction < 0.5) {
      fails.push(`${n} band is not lit, so every bound below is trivially met`);
    }
  }
  // THE MACRO CLAIM, asserted against the measured floor rather than against a
  // threshold on the gain RATIO.
  //
  // The ratio was the first version and it is the wrong statistic to assert on,
  // because it is a total spread and is therefore diluted by everything else in
  // the band: it read 1.224 at 1600x900 and 1.078 at 1280x720 for an identical
  // term, purely because the two viewports frame different ground. The ADDED
  // spread is the term's own contribution and cannot be diluted, since
  // everything unchanged subtracts to zero. The ratio is still reported.
  //
  // 3x the floor, on both of the two bands the macro field is aimed at.
  for (const n of ['mid', 'far']) {
    const b = bandReport[n];
    if (!(b.addedMacroSd > 3 * Math.max(b.noiseSd, 0.001))) {
      fails.push(`macro variation added ${b.addedMacroSd} of block-mean spread `
        + `to the ${n} band against a floor of ${b.noiseSd}`);
    }
    if (!(b.dMacro.meanAbsDelta > 3 * Math.max(b.noise.meanAbsDelta, 0.01))) {
      fails.push(`macro variation moved the ${n} band by `
        + `${b.dMacro.meanAbsDelta} against a floor of ${b.noise.meanAbsDelta}`);
    }
  }
  // The bump is asserted only when it is switched ON. It defaults to zero as a
  // measured negative result (see TerrainMaterial's ART_DEFAULT note: the
  // float32 quantum on planet-centred metres is 3 to 15 times the pixel
  // footprint under the player, so its screen derivative is destroyed). A probe
  // that demanded a term the build deliberately disables is a probe that cannot
  // pass, which is the defect this lane spent the night taking out of somebody
  // else's instrument.
  const nb = bandReport.near;
  if (before[1] > 0 && nb.dBump.movedFraction < 0.05) {
    fails.push('the detail bump is enabled but moved under 5% of the near band');
  }
  if (before[1] === 0 && nb.dBump.meanAbsDelta > nb.noise.meanAbsDelta) {
    fails.push('the detail bump is DISABLED and moved the near band by more '
      + `than the noise floor (${nb.dBump.meanAbsDelta} > ${nb.noise.meanAbsDelta})`);
  }

  return {
    valid: w.tick > w0.tick && p.chunks > 0 && fails.length === 0,
    fails,
    camera: {
      lat, lon, yawDeg: yaw, pitchDeg: pitch, sunT, biome: w.biome,
      converged: w.chunks.converged, convergeSpins: spin,
      viewport: [capAll.W, capAll.H], blockPx: BLK,
      artAmp: { off: [0, 0, 0], on: before },
    },
    claims: {
      near: claim('near'), mid: claim('mid'), far: claim('far'),
      horizon: claim('horizon'),
    },
    skyControl,
    bands: bandReport,
    cost: {
      drawCalls: s.draw.calls, drawBudget: s.budget && s.budget.drawCalls,
      triangles: s.draw.triangles, triBudget: s.budget && s.budget.triangles,
      programs: s.draw.programs, geometries: s.draw.geometries,
      vramEstimateMB: s.vramEstimateMB,
      frameMs: s.frameMs, passMs: s.passMs,
    },
    props: {
      placed: p.propsPlaced, instances: p.instances,
      deliveredFraction: p.deliveredFraction, refused: p.refused,
      cellsCapped: p.cellsCapped, chunksCapped: p.chunksCapped,
      wetCells: p.wetCells, perMaterial: p.perMaterial,
    },
  };
})()
