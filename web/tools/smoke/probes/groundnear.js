// WHAT DOES THE GROUND LOOK LIKE AT WALKING DISTANCE, AND WHICH TERM OWNS IT?
// (RN-1730 to RN-1759, the look audit's R1 item.)
//
//   node tools/smoke/run.mjs --url=http://127.0.0.1:<port>/ --scenario=walk \
//     --width=1600 --height=900 --evalfile=tools/smoke/probes/groundnear.js \
//     --evalargs='{"arms":["ship","texoff","reliefoff","bumpoff"]}'
//
// WHY IT IS NOT `artframe.js` WITH A FLAG. `artframe` photographs ONE state per
// page load, and every arm of a material question then differs by a fresh
// scene: a re-streamed chunk set, a re-drawn scatter, a re-solved sun. RN-1000
// already paid for that mistake once ("two page loads is what made the first
// swing value look sufficient"). Every arm here is driven through the
// `__ofTerrainArt` runtime handle inside ONE settled page, so the camera, the
// sun, the streamed chunks and the props are equal BY CONSTRUCTION and every
// moved pixel belongs to the term.
//
// THE SCATTER IS HIDDEN BY DEFAULT, `artframe.js`'s `voxelface` precedent and
// its exact reason: at a standing eye pitched into the ground the understorey
// covers most of the frame, and a claim about the GROUND cannot be settled
// through somebody else's leaf cards. `{"props":true}` puts them back, which is
// the shipped picture and is what the published frames are taken with.
//
// FOUR RECTANGLES AT FOUR RANGES, AND THE RANGE IS COMPUTED RATHER THAN
// ASSERTED. Every term in this material fades on distance or on pixel
// footprint, so a single box says nothing about which band moved. `rangeM`
// beside each rectangle is the flat-plane ground distance at that row, derived
// from the camera's own altitude, pitch and vertical FOV, so a reader can see
// at a glance whether a box sits inside or outside the term under test. That is
// section 2.1a's own finding made routine: its `groundNear` box "sits at or
// past the fade of the term this pass is about at three of the four sites".
//
// AND A TILING INSTRUMENT, because iqr cannot see a repeat. A periodic albedo
// and a random one of the same spread have the SAME interquartile range; what
// separates them is autocorrelation. `tile` reports, over a band of near-ground
// rows, the strongest non-trivial autocorrelation lag in pixels and its
// normalised height, so "the ground reads as tiles at a grazing angle" becomes
// a number that a candidate can be shown not to have made worse.
(async (A0) => {
  const of = window.__of;
  const art = window.__ofTerrainArt;
  const A = (typeof A0 === 'object' && A0 !== null) ? A0 : {};
  if (!of) return { valid: false, why: 'no __of' };
  if (!art) return { valid: false, why: 'no __ofTerrainArt' };
  const sleep = (n) => of.run(n);
  const r2 = (x) => (Number.isFinite(x) ? Number(x.toFixed(2)) : null);
  const r3 = (x) => (Number.isFinite(x) ? Number(x.toFixed(3)) : null);
  const fails = [];
  const check = (name, ok) => { if (!ok) fails.push(name); };

  // ---------------------------------------------------------------- the pose
  // `artframe.js`'s `forestfloor` verbatim: the same site, the same standing
  // eye, the same yaw and pitch and the same sun dot, so a number here and a
  // number there are about one frame.
  const lat = A.lat ?? -19.85;
  const lon = A.lon ?? -72.7853;
  const yaw = A.yaw ?? 300;
  const pitch = A.pitch ?? -26;
  of.teleport(lat, lon, 2.0);
  await sleep(2.0);
  let spin = 0;
  while (!of.world().chunks.converged && spin++ < 240) await sleep(0.5);
  await sleep(1.0);
  // TWO SUN MODES. `dot` pins an elevation, which is artframe's `forestfloor`
  // fixture and is what makes this probe's numbers comparable with that shot.
  // `noon` solves for the site's own maximum elevation, which is section 2.1's
  // fixture and is the only way four sites at four longitudes are comparable
  // with each other: a fixed `t` is a different hour at every longitude
  // (WG-53), and a fixed elevation dot is a different TIME OF YEAR at every
  // latitude. Neither is wrong; they answer different questions, and a pass
  // that silently used one while quoting the other's table would be the
  // instrument-aimed-at-the-wrong-thing failure this repo keeps cataloguing.
  const noon = () => {
    let best = 0; let bestD = -2;
    for (let i = 0; i < 240; ++i) {
      of.setTime(i / 240);
      const d = of.stats().sky.elevationDot;
      if (d > bestD) { bestD = d; best = i / 240; }
    }
    of.setTime(best);
    return bestD;
  };
  const sunMode = A.sunMode ?? 'dot';
  const pinSun = () => (sunMode === 'noon' ? noon() : of.setSunElev(A.sunDot ?? 0.70));
  const sun = pinSun();
  of.look(yaw, pitch);
  if (window.__ofWind) window.__ofWind.freeze(A.windT ?? 40);
  of.build(0);
  const propsOn = A.props === true;
  of.propsVisible(propsOn);
  await sleep(1.0);

  // Hide the HUD. `of.screenshot()` grabs the CANVAS and is HUD-free by
  // construction (artframe.js's own note), so this only matters if a future
  // capture path changes; it is cheap and it cannot hurt.
  let node = document.querySelector('canvas');
  while (node !== null && node.parentElement !== null) {
    for (const sib of Array.from(node.parentElement.children)) {
      if (sib !== node) sib.style.display = 'none';
    }
    node = node.parentElement;
  }

  // ------------------------------------------------------------- the fixture
  // GP-142: assert the fixture in terms of the quantity under test, before any
  // arm runs. A pair taken against the 1x1 placeholder is bit-identical by
  // construction and reads as a dead term when it is a dead fetch (RN-78).
  const tex = art.texState();
  const rel = art.reliefState();
  check('the value map is bound, not the 1x1 placeholder', tex.w > 1);
  check('the relief map is bound, not the 1x1 placeholder', rel.w > 1);
  check('the chunk set converged', of.world().chunks.converged === true);
  const post = window.__ofPost ? window.__ofPost.state() : null;
  check('the post stack is ON (an ungraded frame is not the shipped one)',
    post !== null && post.post === true);
  // `setSunElev` scans 720 phases and returns the CLOSEST, so an unreachable
  // target comes back as the site's maximum with no complaint (machinemat.js's
  // rule). In `noon` mode there is no target to miss, so the check is skipped
  // rather than asserted against a number it cannot mean.
  if (sunMode !== 'noon') {
    check('the sun landed on the pin', Math.abs(of.stats().sky.elevationDot
      - (A.sunDot ?? 0.70)) < 0.06);
  }

  // --------------------------------------------------- range at a frame row
  // Flat-plane ground range for a row of the frame, from the camera's own
  // numbers. The body is 600 km across and the near band is metres, so the
  // curvature term is far below the width of a rectangle and is not modelled;
  // what this has to be right about is the ORDER of the four boxes and the
  // magnitude of each, which it is.
  const cam = of.camera ? of.camera() : null;
  const fovDeg = A.fovDeg ?? (cam && cam.fovDeg) ?? 60;
  const eyeM = of.world().observer.altM;
  const rangeAtRow = (fy) => {
    // fy is 0 at the top of the frame, 1 at the bottom.
    const half = Math.tan((fovDeg * Math.PI / 180) / 2);
    const ndc = 1 - 2 * fy;                       // +1 top, -1 bottom
    const depress = -(pitch * Math.PI / 180) - Math.atan(ndc * half);
    return depress <= 1e-3 ? Infinity : eyeM / Math.tan(depress);
  };

  // The four rectangles. `box` is section 2.1's own groundNear so every number
  // this probe prints stays comparable with the published table; the other
  // three bracket it, and the reason they exist is that the terms under test
  // fade over 10 to 75 m and one box cannot see which of them moved.
  const RECTS = Object.assign({
    box: [0.4125, 0.5822, 0.5875, 0.7378],
    feet: [0.3000, 0.8200, 0.7000, 0.9900],
    near: [0.3000, 0.7000, 0.7000, 0.8000],
    mid: [0.2000, 0.5000, 0.8000, 0.5600],
  }, A.rects ?? {});

  // RN-1855. RECTANGLES PLACED BY RANGE INSTEAD OF BY FRACTION, because the
  // four above cannot reach the band this lane is about. At a standing eye the
  // ground past 15 m is compressed into a few dozen rows just under the
  // horizon, and where exactly those rows are is a function of the eye height
  // (which the terrain decides, not the teleport: this pose asks for 2.0 m and
  // stands at 1.62 m), the pitch and the FOV. Hand-written fractions would
  // therefore name one range and read another the moment the ground under the
  // site changed by a few centimetres. `{"rangeRects":[8,12,18,25,35]}` inverts
  // `rangeAtRow` instead, so `r25` IS the row where 25 m is, and the `rangeM`
  // printed beside it is the round trip back through the forward map, which is
  // a live check on the inversion rather than a restatement of the request.
  //
  // Thin on purpose (9 rows by default), and wide to pay for it: a strip 1120
  // px across is 10,080 samples, a quarter of the canonical box, while a strip
  // tall enough to feel comfortable would span a factor of two in range and
  // average the very gradient it is placed to resolve.
  const halfT = Math.tan((fovDeg * Math.PI / 180) / 2);
  const rowAtRange = (r) => {
    const depress = Math.atan(eyeM / r);
    const ndc = Math.tan(-(pitch * Math.PI / 180) - depress) / halfT;
    return (1 - ndc) / 2;
  };
  {
    const rows = A.rangeRowsPx ?? 9;
    const H0 = A.rangeH ?? 900;
    const x0 = A.rangeX ?? 0.15;
    const x1 = A.rangeX1 ?? 0.85;
    for (const r of A.rangeRects ?? []) {
      const fy = rowAtRange(r);
      const h = rows / (2 * H0);
      if (!(fy > h && fy < 1 - h)) {
        return { valid: false, why: `rangeRects ${r} m falls off the frame at`
          + ` eye ${r2(eyeM)} m, pitch ${pitch}, fov ${fovDeg} (fy ${r3(fy)});`
          + ' that is a pose problem, not something to silently clamp' };
      }
      RECTS[`r${r}`] = [x0, fy - h, x1, fy + h];
    }
  }

  // ------------------------------------------------------------ the decoders
  const grab = async () => {
    const blob = await of.screenshot();
    const bmp = await createImageBitmap(blob);
    const cv = new OffscreenCanvas(bmp.width, bmp.height);
    const cx = cv.getContext('2d', { willReadFrequently: true });
    cx.drawImage(bmp, 0, 0);
    return { blob, W: bmp.width, H: bmp.height, cx };
  };

  /** Section 2.1's idiom, unchanged: artframe.js's `statOn` to the digit. */
  const statOn = (cx, x0, y0, x1, y1) => {
    const w = Math.max(1, Math.round(x1 - x0));
    const h = Math.max(1, Math.round(y1 - y0));
    const d = cx.getImageData(Math.round(x0), Math.round(y0), w, h).data;
    const n = w * h;
    let sr = 0; let sg = 0; let sb = 0; let ssat = 0;
    let lo = 0; let hi = 0;
    const lum = new Float64Array(n);
    for (let i = 0; i < n; ++i) {
      const r = d[i * 4]; const g = d[i * 4 + 1]; const b = d[i * 4 + 2];
      sr += r; sg += g; sb += b;
      const mx = Math.max(r, g, b); const mn = Math.min(r, g, b);
      ssat += mx === 0 ? 0 : (mx - mn) / mx;
      const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      lum[i] = y;
      if (y < 255 * 0.10) lo++;
      if (y > 255 * 0.80) hi++;
    }
    lum.sort();
    const q = (f) => lum[Math.min(n - 1, Math.max(0, Math.round(f * (n - 1))))];
    const mr = sr / n; const mg = sg / n; const mb = sb / n;
    return {
      px: n,
      luma: r2(0.2126 * mr + 0.7152 * mg + 0.0722 * mb),
      rgb: [r2(mr), r2(mg), r2(mb)],
      warm: r2(mr - mb), sat: r3(ssat / n),
      p05: r2(q(0.05)), p50: r2(q(0.50)), p95: r2(q(0.95)),
      iqr: r2(q(0.75) - q(0.25)),
      loFrac: r3(lo / n), hiFrac: r3(hi / n),
    };
  };

  /**
   * THE TILING INSTRUMENT. Row-wise autocorrelation of the mean-removed luma
   * over a band of near-ground rows, averaged across rows, reported as the
   * strongest lag in [minLag, maxLag] and its normalised height in [0, 1].
   *
   * WHY ROW-WISE AND NOT 2D: at a grazing view the ground's world scale is
   * nearly constant along a scanline and changes fast down the frame, so a
   * column-wise or 2D correlation smears the very periodicity it is looking
   * for. One row is one iso-range slice of ground, which is where a repeat is
   * actually a repeat.
   *
   * WHY IT IS NOT A VERDICT: a lag near the rectangle width is meaningless
   * (two samples of one period), and real ground legitimately correlates at
   * small lags. The number is published with its lag so a reader can see which
   * it is, and its use here is COMPARATIVE between arms of one pose.
   */
  const tiling = (cx, x0, y0, x1, y1) => {
    const w = Math.round(x1 - x0);
    const h = Math.round(y1 - y0);
    const d = cx.getImageData(Math.round(x0), Math.round(y0), w, h).data;
    const maxLag = Math.min(A.maxLag ?? 220, Math.floor(w / 3));
    const minLag = A.minLag ?? 6;
    const acc = new Float64Array(maxLag + 1);
    let rows = 0;
    for (let j = 0; j < h; ++j) {
      const row = new Float64Array(w);
      let m = 0;
      for (let i = 0; i < w; ++i) {
        const o = (j * w + i) * 4;
        row[i] = 0.2126 * d[o] + 0.7152 * d[o + 1] + 0.0722 * d[o + 2];
        m += row[i];
      }
      m /= w;
      let v0 = 0;
      for (let i = 0; i < w; ++i) { row[i] -= m; v0 += row[i] * row[i]; }
      if (v0 < 1e-6) continue;
      for (let L = minLag; L <= maxLag; ++L) {
        let s = 0;
        for (let i = 0; i + L < w; ++i) s += row[i] * row[i + L];
        acc[L] += s / v0;
      }
      rows++;
    }
    if (rows === 0) return { rows: 0, lag: null, peak: null };
    // TWO NUMBERS OFF ONE CURVE, because the first version of this reported one
    // and it was the wrong one. The global maximum of an autocorrelation over
    // [minLag, maxLag] on ordinary ground is ALWAYS at minLag: a smooth field
    // decays monotonically, so the "peak" was reading the ground's SMOOTHNESS
    // and it sat at lag 6 with a height of 0.73 in all twelve arms of a sweep
    // that changed the picture completely. That is a metric flat in its own
    // independent variable (NUMBERS.md), and it is kept -- renamed `corr6` for
    // what it actually is, a useful blur measure -- rather than deleted.
    //
    // The TILING number is the largest LOCAL maximum strictly after the first
    // local minimum, which is the only feature of this curve that a repeat can
    // produce and smoothness cannot.
    const c = (L) => acc[L] / rows;
    let firstMin = minLag;
    while (firstMin + 1 <= maxLag && c(firstMin + 1) < c(firstMin)) firstMin++;
    let bl = null; let bp = -2;
    for (let L = firstMin + 1; L < maxLag; ++L) {
      if (c(L) >= c(L - 1) && c(L) >= c(L + 1) && c(L) > bp) { bp = c(L); bl = L; }
    }
    return { rows, minLag, maxLag,
      corr6: r3(c(minLag)), firstMin,
      lag: bl, peak: bl === null ? null : r3(bp) };
  };

  // RN-1855. THE PIXEL FOOTPRINT AT A ROW, which is the quantity `ofArtBumpG`
  // actually fades on and is NOT the same statement as the range. `rangeM`
  // alone cannot say whether a box sits inside a footprint fade, because the
  // footprint at a grazing angle grows as the SQUARE of the range, so two boxes
  // a factor of two apart in range are a factor of four apart in the variable
  // the shader reads. It is the numeric derivative of `rangeAtRow` over one
  // pixel row, i.e. exactly `length(dFdy(pos))` for the flat plane, which is
  // the arm of the `max()` that binds at every grazing pose (the lateral arm is
  // r * hFovPerPixel and is an order of magnitude smaller out here).
  const footAtRow = (fy, H) => {
    const dy = 1 / Math.max(1, H);
    const a = rangeAtRow(fy - dy / 2);
    const b = rangeAtRow(fy + dy / 2);
    if (!Number.isFinite(a) || !Number.isFinite(b)) return Infinity;
    return Math.abs(a - b);
  };

  const readAll = (g) => {
    const out = {};
    for (const [k, f] of Object.entries(RECTS)) {
      out[k] = statOn(g.cx, f[0] * g.W, f[1] * g.H, f[2] * g.W, f[3] * g.H);
      out[k].rangeM = r2(rangeAtRow((f[1] + f[3]) / 2));
      out[k].footM = r3(footAtRow((f[1] + f[3]) / 2, g.H));
    }
    out.world = statOn(g.cx, 0, 0, g.W, g.H);
    const tb = A.tileBand ?? [0.10, 0.80, 0.90, 0.94];
    out.tile = tiling(g.cx, tb[0] * g.W, tb[1] * g.H, tb[2] * g.W, tb[3] * g.H);
    out.tile.rangeM = r2(rangeAtRow((tb[1] + tb[3]) / 2));
    out.tile.footM = r3(footAtRow((tb[1] + tb[3]) / 2, g.H));
    return out;
  };

  // ---------------------------------------------------------------- the arms
  // Each arm is a STATE, applied through the shared uniform holders, and the
  // ship arm is re-applied between every pair so a drift shows up as the ship
  // arm disagreeing with itself rather than as a false reading on a candidate.
  const D = {
    art: art.get(),
    tex: art.getTex(),
    relief: art.getRelief(),
    spec: art.getSpec(),
  };
  const hasFine = typeof art.setFine === 'function'
    && typeof art.fineDefault === 'function';
  const FD = hasFine ? art.fineDefault() : null;
  // RN-1855. The two FOOTPRINT-FADE wavelengths. Absent on a binary built
  // before this lane, and the `fade*` arms then REFUSE rather than silently
  // measuring the ship state under a candidate's name (hasFine's precedent).
  const hasFineM = typeof art.setFineM === 'function'
    && typeof art.fineMDefault === 'function';
  const MD = hasFineM ? art.fineMDefault() : null;
  // Captured HERE, before any arm has written the uniform, because reading it
  // at the return would report whatever `restore()` last set and would say
  // "the flag landed" on a run where it never arrived.
  const BOOT_FINE_M = hasFineM ? art.getFineM() : null;
  const restore = () => {
    art.set(D.art[0], D.art[1], D.art[2]);
    art.setTex(D.tex); art.setRelief(D.relief); art.setSpec(D.spec[0], D.spec[1]);
    if (hasFine) {
      art.setFine(FD.bump, FD.alb);
      art.setFineFreq(FD.freq[0], FD.freq[1], FD.freq[2]);
      art.setFineW(FD.w[0], FD.w[1], FD.w[2]);
    }
    // The BOOT state, exactly as `D.tex` and `D.relief` above are the boot
    // state and not the shipped constant. Restoring `MD.art` instead would
    // silently defeat a `--artfinem=` on the command line: the page would boot
    // at the override, the first arm would put the shipped value back, and the
    // report would describe a run that never happened.
    if (hasFineM) art.setFineM(BOOT_FINE_M[0], BOOT_FINE_M[1]);
  };
  /**
   * A FREE-FORM ARM, so a frequency or weight rung is an `--evalargs` and not a
   * source change. `{"arms":["ship",["f386","freq",[61,109,386]],...]}`.
   * The name is the caller's and is printed with the row, which is what stops a
   * sweep from reporting one rung's frame under another rung's label.
   */
  const custom = (spec) => () => {
    restore();
    const [, kind, v] = spec;
    if (kind === 'freq') art.setFineFreq(v[0], v[1], v[2]);
    else if (kind === 'w') art.setFineW(v[0], v[1], v[2]);
    else if (kind === 'amp') art.setFine(v[0], v[1]);
    else if (kind === 'set') {
      // The rung that matters most: frequency AND amplitude together.
      // COMPARING FREQUENCIES AT A FIXED AMPLITUDE IS NOT A COMPARISON OF
      // FREQUENCIES. A surface-gradient bump's strength is sum(weight /
      // wavelength) (RN-1258), so holding `amp` while raising the frequencies
      // raises the SLOPE too, and the finer rung wins or loses for the wrong
      // reason. `strength` below is that sum, published per row, so a reader
      // can see which rungs are actually matched.
      if (v.freq) art.setFineFreq(v.freq[0], v.freq[1], v.freq[2]);
      if (v.w) art.setFineW(v.w[0], v.w[1], v.w[2]);
      if (v.amp !== undefined) art.setFine(v.amp, v.alb ?? FD.alb);
    } else throw new Error(`unknown custom arm kind '${String(kind)}'`);
  };
  const ARMS = {
    ship: () => restore(),
    texoff: () => { restore(); art.setTex(0); },
    tex2: () => { restore(); art.setTex(D.tex * 2); },
    tex3: () => { restore(); art.setTex(D.tex * 3); },
    reliefoff: () => { restore(); art.setRelief(0); },
    relief3: () => { restore(); art.setRelief(D.relief * 3); },
    relief6: () => { restore(); art.setRelief(D.relief * 6); },
    bumpoff: () => { restore(); art.set(D.art[0], 0, D.art[2]); },
    bump3: () => { restore(); art.set(D.art[0], D.art[1] * 3, D.art[2]); },
    macrooff: () => { restore(); art.set(0, D.art[1], D.art[2]); },
    specoff: () => { restore(); art.setSpec(0, 0); },
    // The near-field analytic detail layer this lane adds. Absent on a binary
    // built before it, and the arm then REFUSES rather than silently measuring
    // the ship state under a candidate's name.
    fineoff: () => { restore(); art.setFine(0, 0); },
    finenorm: () => { restore(); art.setFine(FD.bump, 0); },
    finealb: () => { restore(); art.setFine(0, FD.alb); },
    fine2: () => { restore(); art.setFine(FD.bump * 2, FD.alb * 2); },
    // RN-1855. THE BEFORE HALF OF THIS LANE'S PAIR. `fadepre` is the shipped
    // state from WG-186 until this lane: both footprint fades protecting a
    // wavelength twice as long as the content they guard. `ship` is the derived
    // pair. The two single-term arms exist because the art bump and the relief
    // fade at footprints a factor of nine apart (0.69 m against 0.075 m), so
    // they move DIFFERENT BANDS of the frame and a combined arm alone could not
    // say which band belongs to which term.
    fadepre: () => { restore(); art.setFineM(MD.artPre, MD.reliefPre); },
    fadepreart: () => { restore(); art.setFineM(MD.artPre, MD.relief); },
    fadeprerel: () => { restore(); art.setFineM(MD.art, MD.reliefPre); },
  };

  const want = A.arms ?? ['ship', 'texoff', 'reliefoff', 'bumpoff', 'ship'];
  const out = [];
  const shots = {};
  for (const spec of want) {
    const name = Array.isArray(spec) ? spec[0] : spec;
    const isFine = Array.isArray(spec) || /^fine/.test(name);
    if (isFine && !hasFine) {
      return { valid: false, why: `arm '${name}' needs __ofTerrainArt.setFine,`
        + ' which this binary does not have' };
    }
    if (/^fade/.test(name) && !hasFineM) {
      return { valid: false, why: `arm '${name}' needs __ofTerrainArt.setFineM,`
        + ' which this binary does not have (pre-RN-1855)' };
    }
    const fn = Array.isArray(spec) ? custom(spec) : ARMS[name];
    if (fn === undefined) return { valid: false, why: `unknown arm '${name}'`,
      arms: Object.keys(ARMS) };
    fn();
    await sleep(A.settle ?? 0.4);
    // RE-PIN THE SUN IMMEDIATELY BEFORE EVERY CAPTURE, `artframe.js`'s rule
    // (RN-13: `of.run` drifts it). The first version of this probe pinned once
    // at pose time and let twelve arms run, and the CONTROL disagreed with
    // itself by 11 per cent of iqr and 2.1 counts of luma over the sweep --
    // more than several of the candidate arms moved. The repeated `ship` arm is
    // what caught it, which is why it stays in every arm list.
    pinSun();
    await sleep(0.1);
    const g = await grab();
    const row = readAll(g);
    row.arm = name;
    // The LIVE state, read back off the material rather than restated from the
    // arm's own argument list, so a rung that silently failed to apply is a
    // visible disagreement in the report and not an invisible duplicate frame.
    if (hasFine) {
      row.fine = art.getFine(); row.freq = art.getFineFreq();
      row.w = art.getFineW();
      // sum(weight / wavelength) * amplitude: what actually decides how hard a
      // surface-gradient bump turns the normal. Two rungs with the same
      // `strength` are a frequency comparison; two rungs with the same `amp`
      // are not, and that distinction cost this lane one whole sweep.
      const lam = row.freq.map((f) => (FD.chunkM ?? 28.93) / f);
      row.strength = r3(row.fine[0]
        * (Math.abs(row.w[0]) / lam[0] + Math.abs(row.w[1]) / lam[1]
          + Math.abs(row.w[2]) / lam[2]));
      row.lambdaM = lam.map(r3);
    }
    // RN-1855. The LIVE fade pair, read off the material, plus the two
    // footprints the art fade actually acts between, so a reader can put the
    // per-box `footM` beside the band that moved instead of holding the
    // smoothstep's 0.125 and 0.333 in their head.
    if (hasFineM) {
      row.fineM = art.getFineM().map(r3);
      row.artFadeFootM = [r3(row.fineM[0] * 0.125), r3(row.fineM[0] * 0.333)];
      row.relFadeFootM = [r3(row.fineM[1] * 0.125), r3(row.fineM[1] * 0.333)];
    }
    out.push(row);
    if (A.png === true || (Array.isArray(A.png) && A.png.includes(name))) {
      shots[name] = await new Promise((res) => {
        const fr = new FileReader();
        fr.onload = () => res(fr.result);
        fr.readAsDataURL(g.blob);
      });
    }
  }
  restore();

  // ------------------------------------------------------------------ cost
  // A/B/A/B INTERLEAVED IN ONE PAGE (floratex.js's form and INSTRUMENTS.md's
  // rule): timings taken serially are worthless while other lanes build on the
  // same box, and WG-186's own price for maxDepth 14 -> 15 had to be re-run for
  // exactly this reason after two serial sweeps disagreed on the SIGN.
  //
  // `stats().frameMs.last` is the per-frame sample. The client's own rolling
  // p50/p95 would smear the A phase into the B reading, so each phase collects
  // its own samples and takes its own percentiles.
  //
  // THE TIER IS A PAGE LOAD, not a runtime switch: `Quality.ts`'s table is read
  // at boot. So the tier table is three invocations of this probe with
  // `--quality=`, and each one is internally interleaved.
  //
  // RN-1855. `{"costTerm":"fade"}` prices the FOOTPRINT FADES instead of the
  // detail layer, through the identical drift-cancelling machinery, and the
  // only thing that changes is what a "phase" applies. There is no "off" state
  // for a fade, so the role the off phase plays is taken by the PRE-RN-1855
  // pair: the alternation is pre / new / pre / new and each `new` is
  // differenced against the mean of its two neighbouring `pre`s, which is the
  // same first-order drift cancellation with the same published spread.
  let cost = null;
  const costTerm = A.costTerm ?? 'fine';
  if (A.cost === true && costTerm === 'fade' && !hasFineM) {
    return { valid: false, why: 'costTerm fade needs __ofTerrainArt.setFineM' };
  }
  if (A.cost === true && (costTerm === 'fade' || hasFine)) {
    const phase = async (b, a) => {
      if (costTerm === 'fade') art.setFineM(b, a);
      else art.setFine(b, a);
      await sleep(0.5);                    // settle; no recompile, it is a uniform
      const samples = [];
      const t0 = performance.now();
      while (performance.now() - t0 < (A.secs ?? 4) * 1000) {
        await sleep(0.1);
        samples.push(of.stats().frameMs.last);
      }
      samples.sort((x, y) => x - y);
      return { n: samples.length,
        p50: r2(samples[Math.floor(samples.length * 0.5)]),
        p95: r2(samples[Math.floor(samples.length * 0.95)]) };
    };
    // EVERY CANDIDATE IS INTERLEAVED AGAINST THE SAME OFF PHASE, twice, so a
    // thermal ramp shows up as the two `off` readings disagreeing rather than
    // as a cost on whichever candidate ran late. That is WG-186's own
    // correction: its first two serial sweeps disagreed on the SIGN.
    //
    // `alb` (albedo only) still evaluates all three noises, because the branch
    // is `uFineAmp.x > 0.0 || uFineAmp.y > 0.0`. So `alb - off` prices the
    // FIELD and `bump - alb` prices the two ofArtBump calls, which is the split
    // that decides what is worth cutting.
    // PAIRED AND DRIFT-CANCELLING, because a plain A/B/A/B was not enough on
    // this box. Measured with three OFF phases of five seconds each while other
    // lanes were building: the three disagreed by 2.60 ms, which is larger than
    // any candidate's whole cost, so a two-phase interleave was reporting
    // scheduler weather. Alternating off/on N times and differencing each ON
    // against the MEAN OF ITS TWO NEIGHBOURING OFFS cancels drift to first
    // order, and the residual spread across the N pairs is published so a
    // reader can see whether the answer is resolvable at all rather than being
    // handed a number that is not.
    const want2 = A.costArms ?? (costTerm === 'fade'
      ? [['derived', MD.art, MD.relief]]
      : [['both', FD.bump, FD.alb], ['bump', FD.bump, 0], ['alb', 0, FD.alb]]);
    // The BASELINE phase: all-off for the detail layer, the pre-RN-1855 pair
    // for the fade. Named `offs` throughout because it is the same role in the
    // same arithmetic and renaming half a published report is worse than one
    // line of prose saying what it is.
    const OFF = costTerm === 'fade' ? [MD.artPre, MD.reliefPre] : [0, 0];
    const reps = A.reps ?? 4;
    cost = { reps, secs: A.secs ?? 4, term: costTerm, baseline: OFF,
      offs: [], pairs: {} };
    for (const [nm] of want2) cost.pairs[nm] = [];
    cost.offs.push((await phase(OFF[0], OFF[1])).p50);
    for (let k = 0; k < reps; ++k) {
      for (const [nm, b, a] of want2) {
        const on = (await phase(b, a)).p50;
        const off1 = cost.offs[cost.offs.length - 1];
        const off2 = (await phase(OFF[0], OFF[1])).p50;
        cost.offs.push(off2);
        cost.pairs[nm].push(r2(on - (off1 + off2) / 2));
      }
    }
    const med = (xs) => {
      const s2 = [...xs].sort((x, y) => x - y);
      return s2.length % 2 ? s2[(s2.length - 1) / 2]
        : (s2[s2.length / 2 - 1] + s2[s2.length / 2]) / 2;
    };
    cost.summary = {};
    for (const [nm] of want2) {
      const d = cost.pairs[nm];
      cost.summary[nm] = { medianMs: r2(med(d)),
        spreadMs: r2(Math.max(...d) - Math.min(...d)) };
    }
    cost.offDriftMs = r2(Math.max(...cost.offs) - Math.min(...cost.offs));
    cost.offMedianMs = r2(med(cost.offs));
    restore();
  }

  const s = of.stats();
  return {
    valid: true, fails,
    pose: { lat, lon, yaw, pitch, eyeM: r2(eyeM), fovDeg, propsOn,
      sunDot: r3(s.sky.elevationDot), sunAsked: A.sunDot ?? 0.70 },
    fixture: { texW: tex.w, reliefW: rel.w, art: D.art, texAmp: D.tex,
      reliefAmp: D.relief, spec: D.spec,
      hasFine, fine: FD,
      // RN-1855. THE BOOT STATE OF THE TWO FADES AND WHETHER THE URL MOVED IT.
      // `bootFineM` is read off the material BEFORE any arm runs, so a run
      // launched with `--artfinem=` proves the flag arrived rather than
      // assuming it: RN-152 lost a whole pair to `--starlight=0` going
      // unforwarded with both sides running the feature on, and this lane's
      // canonical-shot re-take is exactly that shape of pair.
      hasFineM, fineM: MD, bootFineM: BOOT_FINE_M },
    rangeAtRow: { top: r2(rangeAtRow(0.50)), box: r2(rangeAtRow(0.66)),
      bottom: r2(rangeAtRow(0.95)) },
    arms: out, cost,
    quality: of.stats().quality ?? null,
    invariants: { calls: s.draw.calls, triangles: s.draw.triangles,
      programs: s.draw.programs, textures: s.draw.textures,
      vramMB: s.vramEstimateMB },
    gpu: s.gpu,
    png: shots,
  };
})(typeof OF_ARGS === 'object' && OF_ARGS !== null ? OF_ARGS : {})
