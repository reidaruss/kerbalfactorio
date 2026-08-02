// THE AIRLOCK, AND THE WAY OUT WAS ALREADY IN THE MESH (PH-105 to PH-107, R55).
//
// R55 said "the station has no way out". That was TRUE of the placeholder
// interior -- twelve boxes authored in code with `col_CorrCap` shutting the far
// end -- and it is FALSE of the asset that replaced it. The measurement is the
// finding and it comes first, before anything new is exercised:
//
//     AFT_X   = -36.00   # the torn aft rim, open to space
//     BLOWN_X = -28.00   # the bulkhead that failed
//
// are the asset's own constants, `col_SpineAftFloor` runs to x = -28.000 with
// NOTHING beyond it, and `col_JambAftFrame{L,R}` at x = -20.000 is the last
// hatch that held. The station is a derelict with a hole in it. What was
// missing was never geometry: it was that the GRAVITY did not know, because it
// was one axis-aligned box round the whole hull and that box covered the
// vented section, the breach and every cubic metre of vacuum between the
// branches.
//
// A1 IS THE MEASUREMENT AND IT DECIDES WHETHER THERE IS A JOB. It walks the
// station's own proxy list and asks three questions of the ASSET, not of this
// lane's code: does the aft deck run past the last bulkhead, is there a cap
// beyond it, and do the datums the placeholder was cut to survive the swap.
//
// A2 to A5 are the transition. The claim being tested is not "you can get out"
// -- with the generator derived from the decks, every deck EDGE is an exit and
// that needed no authoring. It is the narrower and more interesting one:
//
//   YOU BECOME WEIGHTLESS WHILE THERE IS STILL A FLOOR UNDER YOU.
//
// At a deck edge you lose your footing and your weight in the same tick and a
// player cannot tell which happened. At the airlock they are separated by 8 m
// of lit corridor, and that separation is the whole feature.
(async () => {
  const of = window.__of;
  const log = [];
  const r6 = (x) => (Number.isFinite(x) ? Number(x.toFixed(6)) : null);
  const yield0 = () => new Promise((r) => { setTimeout(r, 0); });
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

  await of.run(0.8, 60);
  for (const k of ['weight', 'stationGravity', 'standAt', 'station', 'run', 'input']) {
    if (typeof of[k] !== 'function' && typeof of[k] !== 'object') {
      return { fail: `no __of.${k}: rebuild` };
    }
  }
  const home0 = of.world().player.feet.slice();
  const feet = () => of.world().player.feet.slice();

  // Every leg restores what it borrowed. `run.mjs` settles on terrain
  // convergence and a walker parked 400 km up never lets it exit (PH-89), so a
  // probe that leaves the player in orbit poisons the runner, not just the next
  // probe.
  const back = async () => {
    of.input.tape([{ hold: 60, keys: [] }]);
    of.stationGravity(true);
    of.standAt(home0[0], home0[1], home0[2]);
    await of.run(0.5, 60);
    await yield0();
  };
  const fail = async (why, extra) => { await back(); return { fail: why, ...extra, log }; };

  /** Run with NOTHING HELD. `sample` arms a long tape, so every plain `of.run`
   *  outside it would otherwise inherit up to three seconds of the previous
   *  leg's keys. Under gravity that is a walk; in freefall it is THRUST, and it
   *  would bleed into every leg after A3 silently and flatteringly (PH-104). */
  const settle = async (secs) => {
    of.input.tape([{ hold: Math.ceil(secs * 60) + 120, keys: [] }]);
    await of.run(secs, 60);
    of.input.tape([{ hold: 1, keys: [] }]);
    await yield0();
  };

  const st = of.station();
  if (st === null) return { fail: 'no station record' };
  if (st.proxies === 0) {
    return { fail: 'no proxies learned: the glb did not load', st };
  }

  // ------------------------------------------------------------------ A1 ----
  // THE ASSET, MEASURED. Every number below is read off the shipped proxy list
  // through `of.station().proxyBoxes`, never transcribed from the Blender
  // source: a probe that re-derived the layout would agree with itself whatever
  // the asset did, which is the failure `orbitdeck.js` shipped and passed with.
  const boxes = st.proxyBoxes;
  const byName = new Map(boxes.map((b) => [b.name, b]));
  const need = ['col_SpineAftFloor', 'col_SpineAftCeil', 'col_SpineAftWallL',
    'col_JambAftFrameL', 'col_JambAftFrameR', 'col_LintelAftFrame',
    'col_HallFloor', 'col_ReactorFloor'];
  const missing = need.filter((n) => !byName.has(n));
  if (missing.length > 0) return fail('asset is missing proxies', { missing });

  const aft = byName.get('col_SpineAftFloor');
  const ceil = byName.get('col_SpineAftCeil');
  const jambL = byName.get('col_JambAftFrameL');
  const lintel = byName.get('col_LintelAftFrame');
  const hall = byName.get('col_HallFloor');
  const wallL = byName.get('col_SpineAftWallL');

  const airlockX = st.airlockX;
  const a1 = {
    proxies: st.proxies,
    // The deck datum the frozen pose and `stateOf` already share. The
    // placeholder put its floor tops at local y = 0 and the asset agrees.
    deckTopY: r6(aft.max[1]),
    hallFloorTopY: r6(hall.max[1]),
    // 4.0 m, against the placeholder's 2.5 and against its argument that 4.0
    // "would make the corridor look like a lift shaft".
    headroomM: r6(ceil.min[1] - aft.max[1]),
    // R48: an overhead proxy must exceed the walker's 0.75 m sample gap.
    overheadT: r6(ceil.max[1] - ceil.min[1]),
    // CLEAR width, from the wall's INNER face. The first version of this line
    // read `min[2]` and reported 4.200 m for a 3.000 m corridor, because a wall
    // proxy is 0.6 m thick and its min face is the one in the vacuum. A number
    // that describes the outside of a wall is not a number about a corridor.
    corridorWidthM: r6(wallL.max[2] * -2),
    // THE HOLE. The aft deck's own far end, and the fact that nothing caps it.
    aftDeckEndX: r6(aft.min[0]),
    airlockX: r6(airlockX),
    chamberLenM: r6(airlockX - aft.min[0]),
    // Same correction: the APERTURE is between the jambs' inner faces, so it is
    // `max[2]`, and reading `min[2]` reported 3.200 m for a 2.100 m doorway.
    hatchWidthM: r6(jambL.max[2] * -2),
    hatchHeadM: r6(lintel.min[1]),
    // A cap would be a proxy standing across the corridor at the deck's end.
    cappedAft: boxes.some((b) => b.min[0] <= aft.min[0] + 0.01
      && b.max[0] <= aft.min[0] + 0.4 && b.max[1] > 1.0
      && b.min[2] < 0 && b.max[2] > 0),
  };
  log.push({ leg: 'A1 asset', ...a1 });

  if (a1.deckTopY !== 0 || a1.hallFloorTopY !== 0) {
    return fail('deck datum moved: floor tops are not at local y = 0', a1);
  }
  if (a1.headroomM < 3.5) return fail('headroom is not the authored 4.0 m', a1);
  if (a1.overheadT < 0.75) return fail('R48: overhead proxy under the sample gap', a1);
  if (a1.cappedAft) return fail('the aft end IS capped: R55 still stands', a1);
  if (airlockX === null) return fail('no bulkhead jamb: no airlock plane', a1);
  if (!(a1.chamberLenM > 4)) return fail('airlock chamber is too short to be one', a1);

  // ------------------------------------------------------------------ A2 ----
  // THE FIELD ALONG THE CORRIDOR, asked of points rather than of the player.
  // `of.weight(x,y,z)` maps the volume without moving anybody, which is what
  // lets this be a curve instead of six separate walks -- and an assertion that
  // has to move the player to make its measurement cannot then measure the
  // player.
  const axes = st.axes;
  const u = [st.pos[0], st.pos[1], st.pos[2]];
  const ul = Math.hypot(u[0], u[1], u[2]);
  u[0] /= ul; u[1] /= ul; u[2] /= ul;
  // The same tangent frame the walker uses, and the same yaw arithmetic
  // `stationwalk.js` P4 uses, copied rather than re-derived so the two probes
  // cannot come to disagree about which way "aft" points.
  const east = (() => {
    const e = [u[2], 0, -u[0]];
    const l = Math.hypot(e[0], e[1], e[2]);
    return l < 1e-9 ? [1, 0, 0] : [e[0] / l, e[1] / l, e[2] / l];
  })();
  const north = [u[1] * east[2] - u[2] * east[1], u[2] * east[0] - u[0] * east[2],
    u[0] * east[1] - u[1] * east[0]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const yawOf = (d) => (Math.atan2(dot(d, east), dot(d, north)) * 180) / Math.PI;
  // AFT is the spine's negative direction. `axes.along` is the spine (PH-105).
  const aftDir = [-axes.along[0], -axes.along[1], -axes.along[2]];
  // Station-local (x, y, z) -> body frame. `axes` is the game's own orientation,
  // read rather than rebuilt, for the reason A1 gives.
  const at = (lx, ly, lz) => [
    st.pos[0] + axes.along[0] * lx + axes.up[0] * ly + axes.across[0] * lz,
    st.pos[1] + axes.along[1] * lx + axes.up[1] * ly + axes.across[1] * lz,
    st.pos[2] + axes.along[2] * lx + axes.up[2] * ly + axes.across[2] * lz,
  ];
  // 0.05 m above the deck: where a standing player's feet are sampled.
  const gAt = (lx) => {
    const p = at(lx, 0.05, 0);
    const w = of.weight(p[0], p[1], p[2]);
    return w === null ? null : w.apparentG;
  };

  const wAt = (lx) => { const p = at(lx, 0.05, 0); return of.weight(p[0], p[1], p[2]); };
  const trueG = wAt(0).trueG;

  // A THRESHOLD WAS ABOUT TO HIDE A PHYSICAL QUANTITY, so it is published
  // instead. The first version of A2 asserted `gHatch === trueG` with `trueG`
  // sampled at the HALL, 20 m away, and it failed while both printed 3.531600.
  // They are not the same number and should not be: the deck is FLAT and the
  // world is ROUND, so a point 20 m along it stands d^2/2R = 2.0e-4 m higher
  // than the hall does, and the true gravity there is lower by 2g/R times that.
  // It is the same curvature term that turned out to be behind 0.000373 m
  // earlier in this lane, measured over a longer deck. The right assertion is
  // per-point (`restoredExactly` compares apparent with true AT the sample),
  // and the wrong one would have been "fixed" by a tolerance that quietly
  // absorbed a real 57 m of station.
  const spanLo = wAt(aft.min[0] + 0.5), spanHi = wAt(byName.get('col_SpineFwdFloor').max[0] - 0.5);
  const curvature = {
    deckSpanM: r6(byName.get('col_SpineFwdFloor').max[0] - aft.min[0]),
    rEndsM: [spanLo.r, spanHi.r],
    // How much higher the deck's ends stand than its middle, from the radius.
    sagM: Number((spanLo.r - wAt(0).r).toExponential(4)),
    trueGSpread: Number((spanLo.trueG - spanHi.trueG).toExponential(4)),
  };
  log.push({ leg: 'A2a deck curvature', ...curvature });
  const curve = [];
  for (let lx = -8; lx >= -30; lx -= 0.5) curve.push([lx, r6(gAt(lx))]);
  const gIn = gAt(airlockX + 2);          // two metres inside the pressure hull
  const gHatch = gAt(airlockX);           // standing in the hatchway
  const gChamber = gAt(airlockX - 4);     // mid-chamber
  const gBreach = gAt(aft.min[0] + 0.5);  // at the blown bulkhead
  const gReactor = (() => {
    const rf = byName.get('col_ReactorFloor');
    const p = at((rf.min[0] + rf.max[0]) / 2, rf.max[1] + 0.05,
      (rf.min[2] + rf.max[2]) / 2);
    return of.weight(p[0], p[1], p[2]).apparentG;
  })();

  const a2 = {
    trueG: r6(trueG),
    gInboard: r6(gIn),
    gHatch: r6(gHatch),
    gChamber: r6(gChamber),
    gBreach: r6(gBreach),
    gReactorBranch: r6(gReactor),
    floatG: of.weight().floatG,
    // The bit-exactness PH-100 bought and this pass must not have spent. Asked
    // PER POINT, never against a `trueG` sampled somewhere else: see A2a.
    restoredInboard: wAt(airlockX + 2).restoredExactly,
    restoredAtHatch: wAt(airlockX + 0.01).restoredExactly,
    // THE BOUNDARY PLANE ITSELF IS NOT BIT-EXACT AND CANNOT BE, which is worth
    // a number rather than a loosened assertion. `at()` builds a body-frame
    // point at radius 1e6 m and `weightOf` rotates it back to station-local, and
    // that round trip carries ~1e6 * 2^-52 = 2e-10 m of error. A point aimed at
    // exactly the box's own face therefore lands a fraction of a nanometre
    // either side of it, and on the outside side the fringe charges 1/1.5e9 of
    // the carrier for it. Any assertion tighter than that is measuring IEEE754
    // rather than physics, so the plane is REPORTED and the assertion is taken
    // 1 cm inboard, where the answer is exact and the question is real.
    hatchPlaneDeficit: Number((wAt(airlockX).trueG - wAt(airlockX).apparentG)
      .toExponential(4)),
    curvature,
    curve,
  };
  log.push({ leg: 'A2 field', ...a2 });

  if (!a2.restoredInboard) {
    return fail('a powered deck no longer restores gravity bit-exactly', a2);
  }
  if (!a2.restoredAtHatch) return fail('the hatchway itself is not full weight', a2);
  if (!(Math.abs(a2.hatchPlaneDeficit) < 1e-6)) {
    return fail('the boundary plane is off by more than round-trip precision', a2);
  }
  if (!(gChamber < of.weight().floatG)) {
    return fail('the airlock chamber still has weight in it', a2);
  }
  if (!(gBreach < of.weight().floatG)) {
    return fail('the blown bulkhead still has weight at it', a2);
  }
  if (!(gReactor < of.weight().floatG)) {
    return fail('the reactor branch (vented, aft of the bulkhead) has weight', a2);
  }
  // MONOTONE, which is what "reads as a transition" means numerically. A curve
  // that dipped and recovered would be two volumes fighting, and it would feel
  // like a stutter rather than like a threshold.
  let mono = true;
  for (let i = 1; i < curve.length; ++i) {
    if (curve[i][1] > curve[i - 1][1] + 1e-9) mono = false;
  }
  if (!mono) return fail('the field is not monotone along the corridor', a2);

  // THE RAMP'S LENGTH, bisected rather than assumed: the first x going aft at
  // which a standing player would float, minus the plane the field is still
  // full at. It should be the fringe and nothing else.
  let lo = airlockX, hi = airlockX - 4;
  for (let i = 0; i < 40; ++i) {
    const mid = (lo + hi) / 2;
    if (gAt(mid) > of.weight().floatG) lo = mid; else hi = mid;
  }
  // AND THE LENGTH IS PREDICTED, not merely bounded. The generator's weight
  // falls linearly from 1 at the box face to 0 at `fringeM`, so the float gate
  // at `floatG` is reached at `fringeM * (1 - floatG / carrierG)` and nothing
  // else. Asserting the prediction rather than a range is what would catch a
  // fringe that had quietly become non-linear, or a second volume overlapping
  // the first: a bound of "between 0.2 and 3.0" would have passed either.
  const fringeM = of.weight().station.fringeM;
  const carrierG = of.weight().station.carrierG;
  const predicted = fringeM * (1 - of.weight().floatG / carrierG);
  const a2b = {
    fullAtX: r6(airlockX), floatsAtX: r6(hi), rampM: r6(airlockX - hi),
    fringeM, predictedRampM: r6(predicted),
    errM: Number(Math.abs((airlockX - hi) - predicted).toExponential(4)),
    // What it costs a walker at 4.6 m/s to cross it, which is the design claim.
    crossingS: r6((airlockX - hi) / 4.6),
  };
  log.push({ leg: 'A2b ramp', ...a2b });
  if (!(Math.abs((airlockX - hi) - predicted) < 1e-6)) {
    return fail('the ramp is not the length the fringe predicts', a2b);
  }

  // ------------------------------------------------------------------ A3 ----
  // NOW DRIVE IT. Stand a player inboard of the hatch, walk them aft, and take
  // the state at both ends. This is the assertion the field curve cannot make:
  // that the WALKER changes mode where the field says it should, and that it
  // still has a floor when it does.
  const inboardX = airlockX + 6;
  const p0 = at(inboardX, 0.6, 0);
  const s0 = of.standAt(p0[0], p0[1], p0[2]);
  await settle(1.0);
  const w0 = of.weight();
  const a3start = {
    grounded: w0.grounded, onDeck: w0.onDeck, floating: w0.floating,
    apparentG: r6(w0.apparentG), r: r6(s0.r),
  };
  log.push({ leg: 'A3 start (inboard)', ...a3start });
  if (!w0.grounded || w0.floating) {
    return fail('the player does not stand on the powered deck', a3start);
  }

  // Aft is station-local -x, which is `axes.across` negated. The walk keys are
  // in the walker's own heading frame, so aim first and then hold: `of.look` is
  // the flight camera's, and the walker's heading is what `of.face` sets.
  const before = feet();
  of.look(yawOf(aftDir), 0);
  of.input.tape([{ hold: 240, keys: ['KeyW'] }]);
  const t0 = of.world().tick;
  await of.run(3.0, 60);
  const ticks = of.world().tick - t0;
  of.input.tape([{ hold: 1, keys: [] }]);
  await yield0();

  const after = feet();
  const w1 = of.weight();
  // How far aft did they get, in the station's own frame?
  const dx = (after[0] - st.pos[0]) * axes.along[0]
    + (after[1] - st.pos[1]) * axes.along[1]
    + (after[2] - st.pos[2]) * axes.along[2];
  const a3 = {
    ticks,
    travelledM: r6(dist(before, after)),
    localX: r6(dx),
    crossedHatch: dx < airlockX,
    apparentG: r6(w1.apparentG),
    floating: w1.floating,
    weightless: w1.weightless,
    // THE WHOLE POINT: weightless AND still over a deck.
    onDeck: w1.onDeck,
    grounded: w1.grounded,
  };
  log.push({ leg: 'A3 walked aft', ...a3 });
  if (!a3.crossedHatch) {
    return fail('the walk did not reach the hatch', a3);
  }
  if (!a3.floating) {
    return fail('the player crossed into the vented section and kept weight', a3);
  }

  // ------------------------------------------------------------------ A4 ----
  // A FLOOR IS STILL THERE. Drop a stationary player into the chamber and ask
  // whether they hold station rather than fall: this is the difference between
  // an airlock and a hole. A body with no weight over a deck must not drift.
  const pc = at(airlockX - 4, 0.6, 0);
  of.standAt(pc[0], pc[1], pc[2]);
  await settle(0.5);
  const c0 = feet();
  await settle(3.0);
  const c1 = feet();
  const wc = of.weight();
  const a4 = {
    driftM: r6(dist(c0, c1)),
    apparentG: r6(wc.apparentG),
    floating: wc.floating,
    // The deck is under them and `deckUnder` still answers, powered or not.
    deckBelowM: r6(Math.hypot(c1[0], c1[1], c1[2])
      - Math.hypot(st.pos[0], st.pos[1], st.pos[2])),
  };
  log.push({ leg: 'A4 station-keeping in the chamber', ...a4 });
  if (!(a4.driftM < 0.01)) {
    return fail('a weightless body in the chamber drifts: momentum came from nowhere', a4);
  }

  // ------------------------------------------------------------------ A5 ----
  // OUT. Thrust aft on the suit and leave through the blown bulkhead. The
  // chamber floor runs out at `aftDeckEndX` and there is nothing past it, so
  // "did they get outside" is `localX < aftDeckEndX` and not a guess.
  of.look(yawOf(aftDir), 0);
  of.input.tape([{ hold: 600, keys: ['KeyW'] }]);
  const e0 = feet();
  await of.run(8.0, 60);
  of.input.tape([{ hold: 1, keys: [] }]);
  await yield0();
  const e1 = feet();
  const ex = (e1[0] - st.pos[0]) * axes.along[0]
    + (e1[1] - st.pos[1]) * axes.along[1]
    + (e1[2] - st.pos[2]) * axes.along[2];
  const we = of.weight();
  const a5 = {
    localX: r6(ex),
    aftDeckEndX: a1.aftDeckEndX,
    outside: ex < a1.aftDeckEndX,
    thrustedM: r6(dist(e0, e1)),
    apparentG: r6(we.apparentG),
    floating: we.floating,
    onDeck: we.onDeck,
    inVolumes: we.inVolumes.map((v) => v.mode),
  };
  log.push({ leg: 'A5 out through the breach', ...a5 });
  if (!a5.outside) return fail('did not get out through the blown bulkhead', a5);
  if (!a5.floating) return fail('outside the hull and not floating', a5);

  // MOMENTUM IS KEPT. Release everything and the body must coast, because the
  // freefall model is a thrust with a governor and NOT a velocity servo
  // (PH-99). This is the assertion that catches anyone reintroducing one.
  const k0 = feet();
  await settle(2.0);
  const k1 = feet();
  await settle(2.0);
  const k2 = feet();
  const a5b = { coast1M: r6(dist(k0, k1)), coast2M: r6(dist(k1, k2)) };
  log.push({ leg: 'A5b coast', ...a5b });
  if (!(a5b.coast1M > 1.0)) {
    return fail('the body stopped dead on key release: the servo is back', a5b);
  }

  // ------------------------------------------------------------------ A6 ----
  // THE NEGATIVE CONTROL, and it is what makes A2 a claim. With the generator
  // OFF the whole station reads the same as the chamber does with it ON, so the
  // chamber's zero is the ABSENCE of a deck volume and not some property of
  // being near the aft end.
  of.stationGravity(false);
  const off = {
    gInboard: r6(gAt(airlockX + 2)),
    gHall: r6(gAt(0)),
    gChamber: r6(gAt(airlockX - 4)),
  };
  of.stationGravity(true);
  const on = { gInboard: r6(gAt(airlockX + 2)), gHall: r6(gAt(0)) };
  log.push({ leg: 'A6 control', off, on });
  if (!(off.gInboard < of.weight().floatG && off.gHall < of.weight().floatG)) {
    return fail('unpowered decks still have weight', { off, on });
  }
  if (!wAt(0).restoredExactly) return fail('the hall did not come back to full weight', { off, on });

  await back();
  return {
    pass: true,
    asset: a1,
    field: a2,
    ramp: a2b,
    walk: a3,
    chamber: a4,
    egress: a5,
    coast: a5b,
    control: { off, on },
    log,
  };
})()
