// MEASUREMENT, not acceptance: what the ground under a FOUR-METRE footprint
// actually does, so DW-24's tolerance is a number that was read off the shipped
// terrain rather than a number somebody liked the look of.
//
// RE-AIMED FOR DW-32 (GP-30). The footprint is not typed here at all: it is
// `st.module.cellM`, measured off the shipped foundation's own edge socket, so
// this file follows the art lane's module wherever it goes. Everything below is
// therefore the 4 m measurement without one constant having been scaled on
// paper, which was the whole instruction.
//
// THE SAME FOOTPRINT IS JUDGED AGAINST FOUR DIFFERENT BASE PLANES, because the
// placement rules use them and they do not agree:
//   FOUNDING  a foundation that founds its own site, under GP-36's shipped rule:
//             `fitPlane` spends the bury budget first and spills the rest into
//             float, so the spread is charged against FLOAT + BURY.
//   PINNED    the SAME footprints under the rule GP-36 replaced, which put the
//             plane on the lowest of the five points and therefore charged the
//             whole spread against the deck thickness alone. Kept so the before
//             and the after are one measurement rather than two runs a day
//             apart, and so a regression to the old rule cannot pass quietly.
//   FREE      a part dropped with no site, judged against the ground under its
//             own centre. Both signs live, roughly half the spread each.
//   PLANE     the second and later parts of a base, judged against a plane the
//             first part fixed, out to the site's own reach. This one reads the
//             REAL site, so it already carries whatever `makeSite` does today.
// Each is reported as FLOAT (ground below the base: the visible gap of daylight
// `FLOAT_TOLERANCE_M` bounds) and BURY (ground above it, bounded by the deck
// thickness, which DW-32 did NOT scale), never as one unsigned number, because
// the two failures are not the same failure and are not held to the same bound.
//
// Then: one held press of Q, which is what a levelled pad looks like, with an
// ACCEPTANCE TABLE over candidate float tolerances. That is the number that
// sets the constant, because a tolerance tighter than the levelling tool's
// half-cell dead band makes DW-24's own loop unclosable however good the
// terrain is.
//
// A PLAIN AND A SLOPE ARE FOUND, NOT ASSUMED. The oracle is analytic, so a
// prospective site can be founded anywhere without streaming or teleporting;
// 81 candidate origins out to 6.4 km are scanned cheaply and the flattest and
// the steepest each get the full several-hundred-footprint measurement. The
// spawn is deliberately on rugged land (Config.ts HOME), so a scan that never
// left the valley would report that this planet has no plains.
(async () => {
  const of = window.__of;
  const sleep = (n) => of.run(n);
  await sleep(0.6);
  const t0 = of.world().tick;

  const st = of.structures();
  if (st === null) return { fail: 'no structures' };
  const feet = of.world().player.feet;
  const C = st.module.cellM, H = C * 0.5;
  const DECK = st.buryToleranceM;

  const pct = (a, p) => {
    const s = [...a].sort((x, y) => x - y);
    return s.length === 0 ? 0
      : s[Math.min(s.length - 1, Math.max(0, Math.floor(s.length * p)))];
  };
  const r4 = (v) => +v.toFixed(4);
  const band = (a) => ({ p05: r4(pct(a, 0.05)), p50: r4(pct(a, 0.5)),
    p95: r4(pct(a, 0.95)), max: r4(Math.max(0, ...a)) });

  // --- a tangent frame at the feet, so a site can be founded N metres away ---
  // TRUE east and north, in /core's own convention (`of_latlon_to_dir`: +Y is
  // the pole and longitude runs from +X towards +Z), not any perpendicular pair
  // that happens to be handy. It has to be the real one, because the whole point
  // of the scan is to hand back a `--lat`/`--lon` another probe can be run at.
  const D = 180 / Math.PI;
  const R = Math.hypot(feet[0], feet[1], feet[2]) || 1;
  const U = [feet[0] / R, feet[1] / R, feet[2] / R];
  const lat0 = Math.asin(U[1]), lon0 = Math.atan2(U[2], U[0]);
  const E = [-Math.sin(lon0), 0, Math.cos(lon0)];
  const N = [-Math.sin(lat0) * Math.cos(lon0), Math.cos(lat0),
    -Math.sin(lat0) * Math.sin(lon0)];
  const latLonOf = ([de, dn]) => [
    +((lat0 + dn / R) * D).toFixed(5),
    +((lon0 + de / (R * Math.max(1e-6, Math.cos(lat0)))) * D).toFixed(5)];

  /** A prospective site founded `de, dn` metres from the feet. Founding one has
   *  no side effect: nothing is adopted until something is placed. */
  const siteAt = (de, dn) => {
    const x = feet[0] + E[0] * de + N[0] * dn;
    const y = feet[1] + E[1] * de + N[1] * dn;
    const z = feet[2] + E[2] * de + N[2] * dn;
    const r = Math.hypot(x, y, z) || 1;
    return st.prospectiveSite({ x: x * R / r, y: y * R / r, z: z * R / r });
  };

  /** Site-local (east, north) of a body-frame point. */
  const localIn = (s, p) => {
    const dx = p.x - s.o.x, dy = p.y - s.o.y, dz = p.z - s.o.z;
    return [dx * s.east.x + dy * s.east.y + dz * s.east.z,
      dx * s.north.x + dy * s.north.y + dz * s.north.z];
  };

  /** The five footprint deviations of a deck centred at site-local (e, n).
   *  Exactly `footprintOf` + `checkGround`, in the site's own tangent plane. */
  const devsAt = (s, e, n) => {
    const out = [];
    for (const [de, dn] of [[0, 0], [-H, -H], [H, -H], [-H, H], [H, H]]) {
      const x = s.o.x + s.east.x * (e + de) + s.north.x * (n + dn);
      const y = s.o.y + s.east.y * (e + de) + s.north.y * (n + dn);
      const z = s.o.z + s.east.z * (e + de) + s.north.z * (n + dn);
      out.push(st.groundRadius(x, y, z) - Math.hypot(x, y, z));
    }
    return out;
  };

  // Candidate FLOAT tolerances the acceptance table is scored at. BURY is not a
  // candidate: it is the deck thickness, read off the asset, and not ours.
  const CAND = [0.30, 0.40, 0.50, 0.55, 0.60, 0.70, 0.80, 0.90, 1.00, 1.20];

  /** One base-plane rule's answer over a set of footprints. */
  const judge = (pairs) => {
    const fl = pairs.map((p) => -p[0]), bu = pairs.map((p) => p[1]);
    let worst = pairs[0] ?? [0, 0];
    for (const p of pairs) if (p[0] < worst[0]) worst = p;
    return {
      n: pairs.length, floatM: band(fl), buryM: band(bu),
      // The single footprint with the deepest hang, as the [float, bury] pair
      // it actually presents. A percentile pair would be two different cells.
      worstPair: [r4(worst[0]), r4(worst[1])],
      acceptedAt: Object.fromEntries(CAND.map((t) => [t.toFixed(2),
        +(pairs.filter(([lo, hi]) => -lo <= t && hi <= DECK).length
          / Math.max(1, pairs.length)).toFixed(3)])),
      // What acceptance would be if the bury side were not the gate, which is
      // how you tell which of the two constants is actually binding.
      floatOnlyAt: Object.fromEntries(CAND.map((t) => [t.toFixed(2),
        +(pairs.filter(([lo]) => -lo <= t).length
          / Math.max(1, pairs.length)).toFixed(3)])),
    };
  };

  // GP-36's shipped plane fit, restated here in the probe's own arithmetic
  // rather than imported. That is deliberate: a probe that called the client's
  // own `fitPlane` would agree with it by construction and could not catch the
  // day somebody changes it, which is exactly what this file is for.
  const FLOAT = st.floatToleranceM;
  const fit = (lo, hi) => Math.max(lo, Math.min(hi - DECK, lo + FLOAT));

  /** Judge a list of site-local footprint centres all four ways. */
  const measure = (s, centres) => {
    const found = [], pinned = [], free = [], plane = [];
    for (const [e, n] of centres) {
      const d = devsAt(s, e, n);
      const lo = Math.min(...d), hi = Math.max(...d);
      const k = fit(lo, hi);
      found.push([Math.min(0, lo - k), Math.max(0, hi - k)]);
      pinned.push([0, hi - lo]);
      free.push([Math.min(0, lo - d[0]), Math.max(0, hi - d[0])]);
      plane.push([Math.min(0, lo), Math.max(0, hi)]);
    }
    return { founding: judge(found), pinned: judge(pinned), free: judge(free),
      plane: judge(plane) };
  };

  /** Every cell centre within `reach` of a site origin. */
  const REACH = 64;
  const cells = (reach) => {
    const K = Math.ceil(reach / C), out = [];
    for (let i = -K; i < K; ++i) {
      for (let j = -K; j < K; ++j) {
        const e = (i + 0.5) * C, n = (j + 0.5) * C;
        if (Math.hypot(e, n) <= reach) out.push([e, n]);
      }
    }
    return out;
  };
  const CELLS = cells(REACH);

  // --- find a plain and a slope --------------------------------------------
  const RUNGS = [0, 800, -800, 1600, -1600, 3200, -3200, 6400, -6400];
  const scan = [];
  for (const a of RUNGS) {
    for (const b of RUNGS) {
      const s = siteAt(a, b);
      const sp = [];
      for (let i = -1; i <= 1; ++i) {
        for (let j = -1; j <= 1; ++j) {
          const d = devsAt(s, (i + 0.5) * C, (j + 0.5) * C);
          sp.push(Math.max(...d) - Math.min(...d));
        }
      }
      scan.push({ at: [a, b], spread: r4(pct(sp, 0.5)), site: s });
    }
  }
  scan.sort((x, y) => x.spread - y.spread);
  const plainAt = scan[0], slopeAt = scan[scan.length - 1];
  // The DW-24 LOOP's own home: ground where some cells build and some do not, so
  // the refusal and the levelling tool both have something to do. A plain never
  // refuses and a cliff never accepts, and neither exercises the loop at all.
  let midAt = scan[0];
  for (const s of scan) {
    if (Math.abs(s.spread - 0.45) < Math.abs(midAt.spread - 0.45)) midAt = s;
  }
  const here = siteAt(0, 0);

  // --- Q, then the same footprint over the levelled pad ---------------------
  // Aimed steeply down so the 6 m disc lands under the feet, which is where the
  // tool latches its target from. Applied three times, which is what HOLDING
  // the key for a second does (LEVEL.cooldownTicks = 20).
  const yaw = of.world().observer.yawDeg;
  of.look(yaw, -84);
  await sleep(0.25);
  const passes = [];
  for (let k = 0; k < 3; ++k) {
    const r = of.level();
    await sleep(0.4);
    const tk = of.terraform();
    passes.push({ dug: r === null ? 0 : r.dug, filled: r === null ? 0 : r.filled,
      flatnessM: tk === null ? null : tk.action.lastFlatnessM });
  }
  const tf = of.terraform();
  // THE PLANE IS RE-FOUNDED AFTER THE EDIT, because that is the order a player
  // works in: level, then put the first foundation down. Judging a levelled pad
  // against the plane the hill used to have measures the hill, not the tool.
  const pad = siteAt(0, 0);
  const padAt = localIn(pad, { x: feet[0], y: feet[1], z: feet[2] });

  // A 4 m footprint's corners sit 2.83 m from its centre, so a centre within
  // `lim - 2.83` keeps the whole footprint inside radius `lim`. Measured twice:
  // over the pad FLOOR (LEVEL.flatnessFrac 0.7, the radius the tool quotes its
  // flatness over) and out to the rim, which includes the bank a pad cut into a
  // hill always has. Sampled as a FIELD, because exactly one 4 m cell fits in a
  // 12 m disc and a sample of one is not a measurement.
  const padCentres = (lim) => {
    const rr = lim - H * Math.SQRT2, out = [];
    for (let a = 0; a <= 12; ++a) {
      for (let b = 0; b <= 12; ++b) {
        const du = (a / 6 - 1) * rr, dv = (b / 6 - 1) * rr;
        if (rr > 0 && Math.hypot(du, dv) <= rr) out.push([padAt[0] + du, padAt[1] + dv]);
      }
    }
    return out;
  };
  // The raw residual against the pad's own plane: GP-23's number, re-measured.
  const resid = [];
  for (const [e, n] of padCentres(6)) for (const v of devsAt(pad, e, n)) resid.push(v);

  // --- the lattice step: the claim the site frame exists BECAUSE of ---------
  const steps = [];
  const base = { x: feet[0], y: feet[1], z: feet[2] };
  for (const ax of [[1, 0, 0], [0, 1, 0], [0, 0, 1]]) {
    const a = of.latticeCell(base.x, base.y, base.z);
    const b = of.latticeCell(base.x + ax[0], base.y + ax[1], base.z + ax[2]);
    if (a === null || b === null) continue;
    steps.push(+Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]).toFixed(3));
  }

  const g = of.game();
  return {
    advanced: { ticks: of.world().tick - t0 },
    footprintM: C, buryBoundM: DECK, siteReachSampledM: REACH,
    // `latLon` is what to pass the runner as --lat/--lon to stand there.
    terrain: {
      hereLatLon: latLonOf([0, 0]),
      plain: { at: plainAt.at, spread: plainAt.spread, latLon: latLonOf(plainAt.at) },
      mid: { at: midAt.at, spread: midAt.spread, latLon: latLonOf(midAt.at) },
      slope: { at: slopeAt.at, spread: slopeAt.spread, latLon: latLonOf(slopeAt.at) },
      scanMedian: r4(pct(scan.map((s) => s.spread), 0.5)),
      // HOW MUCH OF THIS PLANET A 4 m DECK CAN FOUND ON, before and after
      // GP-36, over the same 81 origins out to 6.4 km. `scanUnderBury` is the
      // old rule: the whole spread charged against the deck thickness alone.
      // `scanBuildable` is the shipped one: the spread spent across both sides,
      // so the bound is FLOAT + BURY. One line apart in the report on purpose.
      scanUnderBury: +(scan.filter((s) => s.spread <= DECK).length
        / scan.length).toFixed(3),
      scanBuildable: +(scan.filter((s) => s.spread <= DECK + FLOAT).length
        / scan.length).toFixed(3),
    },
    plain: measure(plainAt.site, CELLS),
    mid: measure(midAt.site, CELLS),
    slope: measure(slopeAt.site, CELLS),
    here: measure(here, CELLS),
    levelled: {
      passes, flatnessM: tf === null ? null : tf.action.lastFlatnessM,
      lastMessage: tf === null ? null : tf.action.lastMessage,
      residualM: { n: resid.length, p05: r4(pct(resid, 0.05)),
        p50: r4(pct(resid, 0.5)), p95: r4(pct(resid, 0.95)),
        min: r4(Math.min(...resid)), max: r4(Math.max(...resid)) },
      onFloor: measure(pad, padCentres(6 * 0.7)),
      toRim: measure(pad, padCentres(6)),
    },
    latticeStepM: steps,
    tolerance: [st.floatToleranceM, st.buryToleranceM],
    log: [`site plane at r=${here.baseR.toFixed(2)}`,
      `pad plane at r=${pad.baseR.toFixed(2)}`],
    game: g === null ? null : g.structures.module,
  };
})()
