// MEASUREMENT, not acceptance: what the ground does under a TWENTY-FOUR METRE
// footprint, so the launch pad's placement rule is a number read off the shipped
// terrain rather than a tolerance widened until the pad went down.
//
//
//   node tools/smoke/run.mjs --scenario=walk \
//        --evalfile=tools/smoke/probes/padground.js
//
// OF_ARGS.padM defaults to 24 (the shipped pad's plan size), so no --evalargs
// is required to run this.
//
// The question is DW-24's, at six times the scale it was last measured at.
// GP-36 measured a 4 m deck and got 58.0% of 81 sampled origins buildable under
// DW-33's fitted plane. A pad is 24 x 24 m, which is 36 times the area, and a
// tangent plane's own departure from the sphere goes as r^2, so NOTHING about
// the 4 m answer carries over. This file measures the 24 m answer directly and
// reports it whatever it says. If the honest answer is that a pad cannot be
// founded on natural ground at the spawn, that is the finding.
//
// FOUR RULES ARE SCORED OVER THE SAME FOOTPRINTS, so the comparison is one run
// rather than four arguments:
//   PAD24-FIT   the shipped `fitPlane` budget (FLOAT + BURY) over a 24 m square.
//   PAD24-CORN  the SAME footprints sampled only at centre + 4 corners, which is
//               what `footprintOf` does for a deck. Kept because the gap between
//               it and the 5x5 grid is the measure of how much a corner-only
//               sample MISSES at 24 m, and a rule that cannot see a mound in the
//               middle of an edge is not a rule, it is a coin toss.
//   DECK4       a 4 m deck at the same origin, so tonight's number and GP-36's
//               are read off one terrain in one run.
//   PAD24-DECK  the pad judged CELL BY CELL as 36 separate 4 m decks, which is
//               what "lay foundations first, then the pad on top" would face.
//
// Every deviation is signed and the two signs are held to DIFFERENT bounds,
// because DW-24's float (daylight under a slab) and bury (soil inside it) are
// not the same failure. Nothing here is asserted: this is the instrument that
// decides what the rule should be, and it runs before the rule exists.
(async () => {
  const of = window.__of;
  const sleep = (n) => of.run(n);
  await sleep(0.6);

  const st = of.structures();
  if (st === null) return { fail: 'no structures' };
  const feet = of.world().player.feet;

  /** The pad's plan size. Read off the shipped .glb if the client has already
   *  loaded it, so this file follows the asset; the literal is what a client
   *  with no pad module leaves, and it is REPORTED so a stale one cannot hide. */
  const PAD_M = OF_ARGS.padM ?? 24;
  const C = st.module.cellM;
  const FLOAT = st.floatToleranceM;
  const BURY = st.buryToleranceM;
  const MARGIN = 0.02;

  const r4 = (v) => +v.toFixed(4);
  const pct = (a, p) => {
    const s = [...a].sort((x, y) => x - y);
    return s.length === 0 ? 0
      : s[Math.min(s.length - 1, Math.max(0, Math.floor(s.length * p)))];
  };
  const band = (a) => ({ p05: r4(pct(a, 0.05)), p50: r4(pct(a, 0.5)),
    p95: r4(pct(a, 0.95)), max: r4(Math.max(0, ...a)) });

  // --- a true tangent frame at the feet, /core's own convention ---------------
  const D = 180 / Math.PI;
  const R = Math.hypot(feet[0], feet[1], feet[2]) || 1;
  const U = [feet[0] / R, feet[1] / R, feet[2] / R];
  const lat0 = Math.asin(U[1]), lon0 = Math.atan2(U[2], U[0]);
  const E = [-Math.sin(lon0), 0, Math.cos(lon0)];
  const N = [-Math.sin(lat0) * Math.cos(lon0), Math.cos(lat0),
    -Math.sin(lat0) * Math.sin(lon0)];
  const latLonOf = (de, dn) => [
    +((lat0 + dn / R) * D).toFixed(5),
    +((lon0 + de / (R * Math.max(1e-6, Math.cos(lat0)))) * D).toFixed(5)];

  /** A prospective site founded `de, dn` metres from the feet. No side effect:
   *  nothing is adopted until something is placed. */
  const siteAt = (de, dn) => {
    const x = feet[0] + E[0] * de + N[0] * dn;
    const y = feet[1] + E[1] * de + N[1] * dn;
    const z = feet[2] + E[2] * de + N[2] * dn;
    const r = Math.hypot(x, y, z) || 1;
    return st.prospectiveSite({ x: x * R / r, y: y * R / r, z: z * R / r });
  };

  /** Ground deviation from the site plane at site-local (e, n), metres.
   *  Positive is ground ABOVE the plane (bury), negative BELOW it (float). */
  const devAt = (s, e, n) => {
    const x = s.o.x + s.east.x * e + s.north.x * n;
    const y = s.o.y + s.east.y * e + s.north.y * n;
    const z = s.o.z + s.east.z * e + s.north.z * n;
    return st.groundRadius(x, y, z) - Math.hypot(x, y, z);
  };

  /** The GP-36 plane fit, restated in the probe's own arithmetic rather than
   *  imported, so this file can catch the day somebody changes the client's. */
  const fit = (lo, hi) => {
    const k = 1 - MARGIN;
    return Math.max(lo, Math.min(hi - BURY * k, lo + FLOAT * k));
  };

  /** Score one set of raw deviations under the fitted plane: the float and bury
   *  each footprint presents, and whether it is accepted. */
  const judgeOne = (devs) => {
    const lo = Math.min(...devs), hi = Math.max(...devs);
    const d = fit(lo, hi);
    const flo = -(lo - d), bur = hi - d;
    return { floatM: flo, buryM: bur, ok: flo <= FLOAT && bur <= BURY,
      spread: hi - lo };
  };

  /** Sample points of a square footprint of side `sideM`, as a `n x n` grid in
   *  site-local metres relative to the square's centre. */
  const gridOf = (sideM, n) => {
    const h = sideM * 0.5, out = [];
    for (let i = 0; i < n; ++i) {
      for (let j = 0; j < n; ++j) {
        out.push([-h + (2 * h * i) / (n - 1), -h + (2 * h * j) / (n - 1)]);
      }
    }
    return out;
  };
  const cornersOf = (sideM) => {
    const h = sideM * 0.5;
    return [[0, 0], [-h, -h], [h, -h], [-h, h], [h, h]];
  };

  const PAD_GRID = gridOf(PAD_M, 5);   // 25 points, 6 m apart
  const PAD_CORN = cornersOf(PAD_M);   // what footprintOf would give a deck
  const DECK_CORN = cornersOf(C);

  const roll = (rows) => {
    const ok = rows.filter((q) => q.ok).length;
    return {
      n: rows.length,
      accepted: +(ok / Math.max(1, rows.length)).toFixed(3),
      floatM: band(rows.map((q) => q.floatM)),
      buryM: band(rows.map((q) => q.buryM)),
      spreadM: band(rows.map((q) => q.spread)),
    };
  };

  // --- the scan --------------------------------------------------------------
  // 81 origins on a 9 x 9 lattice out to 6.4 km, exactly the set GP-36 scored a
  // 4 m deck over, so tonight's 24 m number and that 58.0% are the same terrain.
  const SPAN = 6400, STEPS = 9;
  const origins = [];
  for (let i = 0; i < STEPS; ++i) {
    for (let j = 0; j < STEPS; ++j) {
      origins.push([-SPAN + (2 * SPAN * i) / (STEPS - 1),
        -SPAN + (2 * SPAN * j) / (STEPS - 1)]);
    }
  }

  const padFit = [], padCorn = [], deck4 = [], padCells = [];
  const perOrigin = [];
  for (const [de, dn] of origins) {
    const s = siteAt(de, dn);
    // The pad is centred on the site origin's own cell centre, which is where a
    // 6 x 6 block of structural cells starting at (0,0) puts its middle.
    const cx = PAD_M * 0.5, cy = PAD_M * 0.5;
    const g = PAD_GRID.map(([e, n]) => devAt(s, cx + e, cy + n));
    const k = PAD_CORN.map(([e, n]) => devAt(s, cx + e, cy + n));
    const gj = judgeOne(g), kj = judgeOne(k);
    padFit.push(gj); padCorn.push(kj);
    // A 4 m deck on the SAME origin, on the site's own founding cell.
    deck4.push(judgeOne(DECK_CORN.map(([e, n]) =>
      devAt(s, C * 0.5 + e, C * 0.5 + n))));
    // The pad as 36 independent 4 m decks: every cell must pass on its own.
    const cells = Math.round(PAD_M / C);
    let allOk = true, worstFloat = 0, worstBury = 0, worstSpread = 0;
    for (let i = 0; i < cells; ++i) {
      for (let j = 0; j < cells; ++j) {
        const q = judgeOne(DECK_CORN.map(([e, n]) =>
          devAt(s, (i + 0.5) * C + e, (j + 0.5) * C + n)));
        if (!q.ok) allOk = false;
        worstFloat = Math.max(worstFloat, q.floatM);
        worstBury = Math.max(worstBury, q.buryM);
        worstSpread = Math.max(worstSpread, q.spread);
      }
    }
    padCells.push({ ok: allOk, floatM: worstFloat, buryM: worstBury,
      spread: worstSpread });
    perOrigin.push({ de, dn, latLon: latLonOf(de, dn),
      padSpread: r4(gj.spread), padOk: gj.ok, deckOk: deck4[deck4.length - 1].ok,
      cellsOk: allOk });
  }

  // The flattest and the steepest origin by the 24 m spread, with their lat/lon,
  // so the next probe can be RUN there rather than hunting for ground itself.
  const bySpread = [...perOrigin].sort((a, b) => a.padSpread - b.padSpread);
  const accepted = perOrigin.filter((q) => q.padOk);

  return {
    valid: true,
    padM: PAD_M, cellM: C, toleranceM: { floatM: FLOAT, buryM: BURY },
    origins: origins.length,
    // THE FOUR ANSWERS, over one set of footprints.
    pad24Fit: roll(padFit),
    pad24Corners: roll(padCorn),
    deck4: roll(deck4),
    pad24AsCells: roll(padCells),
    // How much a corner-only sample misses at 24 m: the count of origins the
    // corners accept and the 5 x 5 grid refuses. A non-zero number here is the
    // whole argument for sampling a pad more densely than a deck.
    cornersMissed: padCorn.filter((q, i) => q.ok && !padFit[i].ok).length,
    flattest: bySpread.slice(0, 3),
    steepest: bySpread.slice(-3).reverse(),
    anyAccepted: accepted.length > 0 ? accepted.slice(0, 5) : [],
    spawn: { latLon: latLonOf(0, 0), feet },
  };
})()
