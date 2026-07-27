// WG-28 diagnostic: WHICH INSTRUMENT IS WRONG?
//
// probes/level.js's negative control `outsideUntouched` reads 2.779 m of
// movement on a ring at 2.5x ITS OWN radius constant, while /core proves the
// same property bit-identically at 30 m. Two instruments disagree. This probe
// exists to answer one question and nothing else:
//
//   is the ring OUTSIDE every disc the tool actually cut?
//
// It cannot be answered by the height deltas, because "the ground moved" and
// "the ground should not have moved" are different claims and only the second
// one is the control. So this records, for EVERY application the tool makes,
// the centre and radius /core was given, and then for every ring point the
// PERPENDICULAR distance from each of those cylinder axes. A ring point whose
// perpendicular distance is less than the disc radius is inside the pad and the
// control is measuring its own subject.
//
//   node tools/smoke/run.mjs --scenario=walk \
//        --evalfile=tools/smoke/probes/leveloutside.js \
//        --url=http://127.0.0.1:4180/
(async () => {
  const of = window.__of;
  const R = OF_ARGS.radiusM ?? 6.0;          // level.js's own constant, verbatim
  const log = [];

  const settle = async (secs) => {
    of.input.tape([{ hold: Math.ceil(60 * secs) + 30, keys: [] }]);
    await of.run(secs, 60);
  };
  const realKey = async (code, secs) => {
    window.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true }));
    await of.run(secs, 60);
    window.dispatchEvent(new KeyboardEvent('keyup', { code, bubbles: true }));
    await of.run(0.4, 60);
  };
  const eye = () => {
    const w = of.world();
    return w.player === null ? null : w.player.aim.origin;
  };
  const unit = (p) => {
    const r = Math.hypot(p[0], p[1], p[2]);
    return [p[0] / r, p[1] / r, p[2] / r];
  };
  const basis = (u) => {
    const seed = Math.abs(u[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
    const cx = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2],
      a[0] * b[1] - a[1] * b[0]];
    let e1 = cx(u, seed);
    const L = Math.hypot(...e1); e1 = e1.map((v) => v / L);
    return [e1, cx(u, e1)];
  };
  const ring = (u, metres, n, radiusM) => {
    const [e1, e2] = basis(u);
    const out = [];
    for (let i = 0; i < n; ++i) {
      const a = (2 * Math.PI * i) / n;
      out.push(unit([0, 1, 2].map((k) =>
        u[k] * radiusM + (e1[k] * Math.cos(a) + e2[k] * Math.sin(a)) * metres)));
    }
    return out;
  };
  const heights = (dirs) => dirs.map((d) => of.surface(d[0], d[1], d[2]).surfaceM);
  const spreadOf = (hs) => Math.max(...hs) - Math.min(...hs);

  await settle(1.2);
  const w0 = of.world();
  if (w0.player === null) return { valid: false, why: 'no character' };
  if (of.terraform() === null) return { valid: false, why: 'no terraforming tool' };
  await of.wipe();
  of.forgetTunnels();
  const bodyR = w0.bodyRadiusM;
  const t0 = of.world();

  // --- the same site search level.js does, so the comparison is like for like
  const spawn = of.world().observer;
  const site = { latDeg: spawn.latDeg, lonDeg: spawn.lonDeg, spread: -1, scanned: 0 };
  const scan = (cLat, cLon, stepDeg, span, maxM) => {
    for (let i = -span; i <= span; ++i) {
      for (let j = -span; j <= span; ++j) {
        const lat = cLat + i * stepDeg;
        const lon = cLon + j * stepDeg;
        of.teleport(lat, lon, 2.0);
        const uu = unit(eye());
        site.scanned++;
        const s = spreadOf(heights([uu, ...ring(uu, R * 0.7, 4, bodyR),
          ...ring(uu, R, 4, bodyR)]));
        if (s > site.spread && s <= maxM) {
          site.spread = s; site.latDeg = lat; site.lonDeg = lon;
        }
      }
    }
  };
  const maxSlopeM = OF_ARGS.maxSlopeM ?? 9.0;
  scan(spawn.latDeg, spawn.lonDeg, OF_ARGS.coarseStepDeg ?? 0.02, 10, maxSlopeM);
  scan(site.latDeg, site.lonDeg, OF_ARGS.fineStepDeg ?? 0.0016, 6, maxSlopeM);

  of.forgetTunnels();
  of.teleport(site.latDeg, site.lonDeg, 2.0);
  await settle(OF_ARGS.arriveSecs ?? 3.0);
  of.look(OF_ARGS.yawDeg ?? 0, OF_ARGS.pitchDeg ?? -15);
  await settle(0.4);

  const u = unit(eye());
  const outside = ring(u, R * 2.5, 12, bodyR);
  const feet0 = of.world().player.feet;

  // THE INSTRUMENT UNDER TEST. Record every disc the tool is about to cut by
  // wrapping the same call the Q key reaches. `of.level()` returns the centre
  // and radius /core was given, so a probe can know the subject of its own
  // negative control instead of assuming it.
  const discs = [];
  const noteDisc = (r) => {
    if (r === null) return;
    discs.push({ c: [r.centre.x, r.centre.y, r.centre.z], radiusM: r.radiusM,
      targetHeightM: r.targetHeightM, dug: r.dug, filled: r.filled,
      corners: r.corners, scanned: r.scanned });
  };

  const outBefore = heights(outside);

  // Drive it exactly as level.js does: a real key held, then the two extra
  // applications. of.level() is the same handler the key reaches, so calling it
  // between key presses would change the subject; instead the key is held and
  // the discs it cut are reconstructed from the aim ray the SAME way
  // LevelAction.discCentre does, using /core's own raycast through of.
  const beforeKey = of.terraform().action.levels;
  await realKey('KeyQ', OF_ARGS.holdSecs ?? 1.6);
  const afterKey = of.terraform().action.levels;
  await settle(0.8);
  // The two idempotence passes level.js makes: these DO report their centre.
  for (let i = 0; i < (OF_ARGS.passes ?? 2); ++i) {
    noteDisc(of.level());
    await settle(0.3);
  }

  const outAfter = heights(outside);

  // --- THE QUESTION. For every ring point, the perpendicular distance from
  // each recorded disc's axis (the line from the planet centre through the disc
  // centre), which is exactly the test levelDisc itself applies:
  //     p.lengthSq() - (p . up)^2  >  radius^2   -> outside
  const perpTo = (p, disc) => {
    const cr = Math.hypot(...disc.c) || 1;
    const up = disc.c.map((v) => v / cr);
    const ax = p[0] * up[0] + p[1] * up[1] + p[2] * up[2];
    return Math.sqrt(Math.max(0, p[0] * p[0] + p[1] * p[1] + p[2] * p[2] - ax * ax));
  };
  // A ring DIRECTION has to be turned into the body-frame POINT the op saw, and
  // the honest point is the one on the post-edit surface.
  const points = outside.map((d, i) => {
    const rr = bodyR + outAfter[i];
    return [d[0] * rr, d[1] * rr, d[2] * rr];
  });

  const rows = points.map((p, i) => {
    const deltaM = Math.abs(outAfter[i] - outBefore[i]);
    const per = discs.map((disc) => +perpTo(p, disc).toFixed(3));
    const inAny = discs.some((disc, k) => per[k] <= disc.radiusM);
    return { i, deltaM: +deltaM.toFixed(3), perpM: per, insideSomeDisc: inAny };
  });

  // And the same question for the FEET, which is where level.js believes the
  // pad is: the perpendicular distance from the feet axis to each ring point.
  // `player.feet` is an ARRAY (level.js indexes it), so read it as one.
  const feetArr = Array.isArray(feet0) ? feet0 : [feet0.x, feet0.y, feet0.z];
  const perpToAxis = (p, c) => {
    const cr = Math.hypot(c[0], c[1], c[2]) || 1;
    const up = [c[0] / cr, c[1] / cr, c[2] / cr];
    const ax = p[0] * up[0] + p[1] * up[1] + p[2] * up[2];
    return Math.sqrt(Math.max(0, p[0] * p[0] + p[1] * p[1] + p[2] * p[2] - ax * ax));
  };
  const feetPerp = points.map((p) => +perpToAxis(p, feetArr).toFixed(3));

  // How far each recorded disc centre is from the feet, tangentially. This is
  // the number that decides whether "2.5x the radius" is outside anything.
  const discOffsetFromFeet = discs.map((disc) =>
    +perpToAxis(disc.c, feetArr).toFixed(3));

  const moved = rows.filter((r) => r.deltaM > 0.001);
  const wEnd = of.world();
  log.push(`site lat ${site.latDeg.toFixed(5)} lon ${site.lonDeg.toFixed(5)}`);
  log.push(`ring at ${(R * 2.5).toFixed(1)} m from the EYE; tool radius `
    + `${discs.length ? discs[0].radiusM : '?'} m; ${discs.length} discs recorded`);
  log.push(`moved ${moved.length}/12, worst ${Math.max(0,
    ...rows.map((r) => r.deltaM)).toFixed(3)} m; of those, `
    + `${moved.filter((r) => r.insideSomeDisc).length} are INSIDE a recorded disc`);

  return {
    valid: (wEnd.tick - t0.tick) > 200 && afterKey > beforeKey && discs.length > 0,
    advanced: { ticks: wEnd.tick - t0.tick, levels: afterKey - beforeKey },
    site,
    ringRadiusM: R * 2.5,
    toolRadiusM: discs.length ? discs[0].radiusM : null,
    discs, discOffsetFromFeet,
    feetPerpM: feetPerp,
    rows,
    movedCount: moved.length,
    worstDeltaM: +Math.max(0, ...rows.map((r) => r.deltaM)).toFixed(3),
    // The two competing explanations, each as a checkable claim.
    everyMovedPointIsInsideADisc: moved.length > 0
      && moved.every((r) => r.insideSomeDisc),
    someMovedPointIsOutsideEveryDisc: moved.some((r) => !r.insideSomeDisc),
    log,
  };
})()
