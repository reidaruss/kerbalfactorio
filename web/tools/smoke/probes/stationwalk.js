// THE STATION IS WALKABLE, AND ITS FLOOR IS WHERE ITS ORBIT SAYS IT IS.
//
// `probes/orbitdeck.js` proved the MECHANISM: a col_* proxy holds the walker up
// 400 km above the terrain. It did that with a corridor the probe itself
// injected, so it proved nothing about the shipped station. This one drives the
// station the game actually boots.
//
// RE-AIMED AT THE REAL ASSET (PH-105). Every geometric number below is read off
// `of.station()` by NAME, never transcribed out of the Blender source, because
// this probe was written against a placeholder interior and every coordinate it
// held privately went stale the day the .glb landed. The two that mattered:
//
//   * the hub used to be 12 m of open deck centred on station-local (0, 0, 0),
//     so "stand at the station's own position" was a legal place to stand. In
//     the shipped asset `col_HallCore` is a SOLID COLUMN through that point,
//     x and z in [-1.548, 1.548] and 5.4 m tall, and P2 correctly went red with
//     "the air above the deck reads solid". P1 and P2 now use the asset's own
//     answer to that question, `install.standPos`, derived from `socket_hall`.
//   * the corridor used to run local +Z out of the hub. The spine runs along
//     local X now and `stationAxes` renamed `along` with it, so P4 walks the
//     spine FORWARD (+X). Forward, not aft: everything aft of x = -20 is the
//     vented section (see probes/airlock.js) and a player there floats rather
//     than walks, which would make a walking assertion measure the wrong thing.
//
// THE ASSERTION THAT MATTERS MOST IS P2, and it is the one that would catch the
// two systems drifting apart: the radius the walker STANDS at, bisected on the
// walker's own collision predicate, must equal the radius the ORBIT puts the
// station at, derived from the conic by a Kepler solve. Those are two entirely
// separate authorities (StructureBodies geometry against of_orb_resume) and
// nothing keeps them in step except SpaceStation.ts deriving the interior's
// pose from the record. If someone ever caches a position, this goes red.
//
// P5 IS A MEASUREMENT AND NOT YET AN ASSERTION, and it is the finding of this
// pass: the hall the player SPAWNS in has no way out. Numbers in P5.
//
// RETURNS THE PLAYER TO THE GROUND BEFORE IT RESOLVES (PH-89): run.mjs settles
// on terrain convergence and a walker parked 400 km up with the streamer
// chasing it is a runner that never exits.
(async () => {
  const of = window.__of;
  const log = [];
  const r6 = (x) => (Number.isFinite(x) ? Number(x.toFixed(6)) : null);
  const len = (p) => Math.hypot(p[0], p[1], p[2]);
  const yield0 = () => new Promise((r) => { setTimeout(r, 0); });

  await of.run(0.8, 60);
  if (typeof of.station !== 'function') return { fail: 'no __of.station: rebuild' };
  if (typeof of.standAt !== 'function') return { fail: 'no __of.standAt: rebuild' };
  const home0 = of.world().player.feet.slice();

  const back = async () => {
    of.input.tape([{ hold: 60, keys: [] }]);
    of.standAt(home0[0], home0[1], home0[2]);
    await of.run(0.5, 60);
    await yield0();
  };
  const fail = async (why, extra) => { await back(); return { fail: why, ...extra, log }; };

  const st = of.station();
  if (st === null) return fail('no station record in the registry');
  if (st.tag !== st.expectTag) return fail('record is not tagged as a station', { st });
  if (st.mode !== 'rails') return fail('station is not on rails', { mode: st.mode });
  if (st.proxies === 0) return fail('no proxies learned: the glb did not load');
  log.push({ station: { id: st.id, deckR: r6(st.deckR), speedMps: r6(st.speedMps),
    e: st.el?.e, a: r6(st.el?.a ?? NaN), proxies: st.proxies,
    sockets: st.install?.sockets ?? null } });

  // THE ASSET, BY NAME. Standing rule 11: a probe that re-derived the layout
  // would agree with itself whatever the asset did. Same idiom as airlock.js A1.
  const byName = new Map(st.proxyBoxes.map((b) => [b.name, b]));
  const need = ['col_HallFloor', 'col_HallCore', 'col_SpineFwdFloor',
    'col_SpineFwdWallL', 'col_JambHallFwdL', 'col_JambHallFwdR',
    'col_LintelHallFwd'];
  const missing = need.filter((n) => !byName.has(n));
  if (missing.length > 0) return fail('asset is missing proxies', { missing });
  const hallFloor = byName.get('col_HallFloor');
  const hallCore = byName.get('col_HallCore');
  const spineFwd = byName.get('col_SpineFwdFloor');
  const jambFwdL = byName.get('col_JambHallFwdL');
  const jambFwdR = byName.get('col_JambHallFwdR');
  const lintelFwd = byName.get('col_LintelHallFwd');

  const P = st.pos;
  const A = st.axes;
  const u = [P[0] / st.deckR, P[1] / st.deckR, P[2] / st.deckR];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  /** Station-local (x, y, z) metres to a body-frame point. */
  const at = (lx, ly, lz) => [
    P[0] + A.along[0] * lx + A.up[0] * ly + A.across[0] * lz,
    P[1] + A.along[1] * lx + A.up[1] * ly + A.across[1] * lz,
    P[2] + A.along[2] * lx + A.up[2] * ly + A.across[2] * lz,
  ];
  /** A body-frame point back in station-local metres. */
  const loc = (p) => {
    const d = [p[0] - P[0], p[1] - P[1], p[2] - P[2]];
    return [dot(d, A.along), dot(d, A.up), dot(d, A.across)];
  };

  const drive = async (secs, keys) => {
    const ticks = Math.ceil(secs * 60);
    of.input.tape([{ hold: ticks + 120, keys }]);
    of.stand(true);
    await of.run(secs, 60);
    await yield0();
    const t = of.stand();
    of.stand(false);
    return t.samples;
  };
  const stats = (xs) => {
    if (xs.length === 0) return { n: 0, spread: null };
    let lo = Infinity, hi = -Infinity;
    for (const x of xs) { if (x < lo) lo = x; if (x > hi) hi = x; }
    return { n: xs.length, min: r6(lo), max: r6(hi), spread: r6(hi - lo) };
  };

  // A FLAT DECK IS NOT A LEVEL DECK ON A ROUND WORLD, and this is the one place
  // that fact is written down. The floor is a PLANE in the station's frame, so
  // the radius at which that plane crosses the radial through a point `d` metres
  // out from the station's own centre is hypot(deckR, d) exactly, which stands
  // d^2 / 2R above the middle: 8 microns at the 4 m spawn socket, 0.2 mm along
  // the spine. It is a PREDICTION, not a tolerance, and the assertions below
  // subtract it rather than widening an epsilon to swallow it.
  const deckRAt = (l) => Math.hypot(st.deckR, Math.hypot(l[0], l[2]));

  // ======================================================================
  // P1. STAND WHERE THE STATION SAYS TO STAND. `install.standPos` is the body
  //     frame point derived from the asset's `socket_hall` empty with the feet
  //     clearance already added; the station's own position is now INSIDE
  //     `col_HallCore` and is not a place a player can be.
  // ======================================================================
  const sp = st.install?.standPos ?? null;
  if (sp === null) return fail('no install record: nothing published a stand point');
  const spL = loc(sp);
  const insideCore = spL[0] > hallCore.min[0] && spL[0] < hallCore.max[0]
    && spL[2] > hallCore.min[2] && spL[2] < hallCore.max[2];
  const P0 = {
    standLocal: spL.map(r6),
    sockets: st.install?.sockets ?? null,
    coreSpanX: [r6(hallCore.min[0]), r6(hallCore.max[0])],
    coreSpanZ: [r6(hallCore.min[2]), r6(hallCore.max[2])],
    coreClearanceM: r6(Math.max(
      Math.max(hallCore.min[0] - spL[0], spL[0] - hallCore.max[0]),
      Math.max(hallCore.min[2] - spL[2], spL[2] - hallCore.max[2]))),
    insideCore,
    // The spawn must land on the hall's own floor slab, not off its edge.
    overHallFloor: spL[0] > hallFloor.min[0] && spL[0] < hallFloor.max[0]
      && spL[2] > hallFloor.min[2] && spL[2] < hallFloor.max[2],
    dropM: r6(spL[1]),
  };
  log.push({ P0 });
  if (insideCore) return fail('P1: the published spawn is inside col_HallCore', P0);
  if (!P0.overHallFloor) return fail('P1: the published spawn is off the hall floor', P0);

  of.standAt(sp[0], sp[1], sp[2]);
  const s1 = await drive(4.0, []);
  const g0 = s1.findIndex((q) => q.grounded);
  if (g0 < 0) {
    return fail('P1: the player never landed on the station deck', {
      ...P0, deckR: r6(st.deckR), endFeetR: r6(s1[s1.length - 1].feetR),
      fellM: r6(deckRAt(spL) + spL[1] - s1[s1.length - 1].feetR),
    });
  }
  const stand = s1.slice(g0 + 5);
  const P1 = {
    landedAfterTicks: g0,
    feetR: stats(stand.map((q) => q.feetR)),
    onDeckTicks: stand.filter((q) => q.onDeck).length,
    groundedTicks: stand.filter((q) => q.grounded).length,
    ticks: stand.length,
    terrainR: r6(stand[0].terrainR),
    endLocal: loc(of.world().player.feet.slice()).map(r6),
  };
  log.push({ P1 });
  if (P1.onDeckTicks !== P1.ticks || P1.groundedTicks !== P1.ticks) {
    return fail('P1: the player did not stand steadily on the station', P1);
  }
  if (!(P1.feetR.spread <= 1e-6)) return fail('P1: standing radius is not constant', P1);

  // ======================================================================
  // P2. THE FLOOR IS WHERE THE ORBIT SAYS. Two authorities, compared.
  //     Bisected along the radial through the SPAWN column rather than through
  //     the station's own centre, because the centre is solid core now.
  // ======================================================================
  const B = at(spL[0], 0, spL[2]);
  const rB = len(B);
  const w = [B[0] / rB, B[1] / rB, B[2] / rB];
  const solidAt = (r) => of.solidBuild(w[0] * r, w[1] * r, w[2] * r);
  // The bracket is the deck slab's OWN thickness, so a thinner floor cannot
  // silently put the "interior" sample in the vacuum underneath it.
  const br = (hallFloor.max[1] - hallFloor.min[1]) * 0.5;
  if (!solidAt(rB - br)) return fail('P2: the deck interior does not read solid', { br: r6(br) });
  if (solidAt(rB + br)) return fail('P2: the air above the deck reads solid', { br: r6(br) });
  let lo = rB - br, hi = rB + br;
  for (let i = 0; i < 60; ++i) {
    const mid = (lo + hi) / 2;
    if (solidAt(mid)) lo = mid; else hi = mid;
  }
  const bulge0 = deckRAt(spL) - st.deckR;
  const P2 = {
    walkerTopFaceR: r6(hi),
    conicDeckR: r6(st.deckR),
    latOffsetM: r6(Math.hypot(spL[0], spL[2])),
    predictedBulgeM: Number(bulge0.toExponential(4)),
    bracketM: r6(br),
    // Walker authority minus conic authority, with only the flat-plane bulge
    // between them. Both of these were exactly zero on the placeholder because
    // the spawn was at the station's own centre and the bulge was zero there.
    deltaM: r6(hi - st.deckR - bulge0),
    stoodAtR: P1.feetR.min,
    standMinusConicM: r6(P1.feetR.min - st.deckR - bulge0),
  };
  log.push({ P2 });
  if (Math.abs(P2.deltaM) > 1e-6 || Math.abs(P2.standMinusConicM) > 1e-6) {
    return fail('P2: the walkable floor and the orbit disagree about where the '
      + 'station is', P2);
  }

  // ======================================================================
  // P3. NEGATIVE CONTROL. 200 m to the SIDE of the station, same altitude,
  //     nothing built there. The player must fall. Without this, P1 says only
  //     that something held the player up at that radius.
  // ======================================================================
  const off = 200;
  const side = [P[0] + A.across[0] * off, P[1] + A.across[1] * off, P[2] + A.across[2] * off];
  const sr = len(side);
  const sideAt = [side[0] / sr * st.deckR, side[1] / sr * st.deckR, side[2] / sr * st.deckR];
  of.standAt(sideAt[0], sideAt[1], sideAt[2]);
  const s3 = await drive(3.0, []);
  const P3 = {
    offsetM: off,
    fellM: r6(st.deckR - s3[s3.length - 1].feetR),
    grounded: s3.filter((q) => q.grounded).length,
    onDeck: s3.filter((q) => q.onDeck).length,
  };
  log.push({ P3 });
  if (P3.grounded !== 0 || P3.onDeck !== 0) {
    return fail('P3: the player was held up 200 m beside the station', P3);
  }
  if (!(P3.fellM > 5)) return fail('P3: the player did not fall off the station', P3);

  // ======================================================================
  // P4. WALK THE SPINE AND THROUGH THE DOORWAY.
  //     The doorway is a GAP between two wall boxes; if it were hulled shut
  //     this is the assertion that catches it, and nothing else would.
  // ======================================================================
  const east = (() => {
    let e = [u[2], 0, -u[0]];
    const l = len(e);
    return l < 1e-9 ? [1, 0, 0] : [e[0] / l, e[1] / l, e[2] / l];
  })();
  const north = [u[1] * east[2] - u[2] * east[1], u[2] * east[0] - u[0] * east[2],
    u[0] * east[1] - u[1] * east[0]];
  const yawOf = (d) => (Math.atan2(dot(d, east), dot(d, north)) * 180) / Math.PI;
  // The spine's heading, read off the STATION's own published axes and not
  // rebuilt here. The axes must be horizontal or every distance below is
  // measured along a ramp.
  const tilt = { along: r6(dot(A.along, u)), across: r6(dot(A.across, u)) };
  if (Math.abs(tilt.along) > 1e-9 || Math.abs(tilt.across) > 1e-9) {
    return fail('P4: the station axes are not perpendicular to the radial', { tilt });
  }

  // Start on the forward spine's own deck, between where it begins and where
  // the jamb pair stands, and aim FORWARD. Both ends of that interval come off
  // the proxy list, so a doorway that moves takes the start of the walk with it.
  const startX = (spineFwd.min[0] + jambFwdL.min[0]) / 2;
  const doorX = jambFwdL.max[0];
  // Clear half width of the corridor being walked, from the floor's own span.
  // The placeholder's was 1.25 m and this reads 1.5 m: the SAME claim ("the
  // player did not walk through a corridor wall") measured against the corridor
  // that exists rather than against the one that used to.
  const halfW = spineFwd.max[2];
  const WALK_S = 3.0;
  const q0 = at(startX, 0.6, 0);
  of.standAt(q0[0], q0[1], q0[2]);
  await drive(1.0, []);
  of.look(yawOf(A.along), 0);
  const before = of.world().player.feet.slice();
  const s4 = await drive(WALK_S, ['KeyW']);
  const after = of.world().player.feet.slice();
  const gg = s4.filter((q) => q.grounded);
  const lb = loc(before);
  const la = loc(after);
  const P4 = {
    startLocalXM: r6(lb[0]),
    doorwayAtXM: r6(doorX),
    apertureWidthM: r6(jambFwdR.min[2] - jambFwdL.max[2]),
    lintelUndersideM: r6(lintelFwd.min[1]),
    corridorHalfWidthM: r6(halfW),
    deckEndsAtXM: r6(spineFwd.max[0]),
    travelledM: r6(Math.hypot(after[0] - before[0], after[1] - before[1],
      after[2] - before[2])),
    alongLocalXM: r6(la[0]),
    acrossLocalZM: r6(la[2]),
    passedTheDoorway: la[0] > doorX,
    onDeckFrac: r6(gg.length === 0 ? 0 : gg.filter((q) => q.onDeck).length / gg.length),
    feetR: stats(gg.map((q) => q.feetR)),
    airborneTicks: s4.filter((q) => !q.grounded).length,
    blockedTicks: s4.filter((q) => q.blockedByBuild).length,
  };
  log.push({ P4 });
  // The walk must not run off the forward end of the deck, or the assertions
  // below would be about a fall rather than about a doorway.
  if (la[0] > spineFwd.max[0]) {
    return fail('P4: the walk overran the forward deck; shorten WALK_S', P4);
  }
  if (!P4.passedTheDoorway) {
    return fail('P4: the player never got past the jamb pair, so the doorway is '
      + 'not open', P4);
  }
  if (P4.onDeckFrac !== 1) return fail('P4: the player left the deck while walking', P4);
  if (Math.abs(P4.acrossLocalZM) > halfW + 1e-3) {
    return fail('P4: the player walked through a corridor wall', P4);
  }
  // The bulge again, now over an interval that does NOT start at the station's
  // centre: the predicted spread is the difference of the two end radii, not
  // one of them. Asserting a bare epsilon here would call correct geometry a
  // defect, which is exactly what the first run of this probe did.
  const bulgeSpreadM = deckRAt(la) - deckRAt(lb);
  P4.predictedSpreadM = Number(bulgeSpreadM.toExponential(4));
  P4.bulgeErrorM = Number((P4.feetR.spread - bulgeSpreadM).toExponential(4));
  if (Math.abs(P4.bulgeErrorM) > 1e-5) {
    return fail('P4: the deck height along the corridor is not the flat-plane '
      + 'bulge, so something other than the geometry is moving the floor', P4);
  }

  // ======================================================================
  // P5. THE HALL HAS NO WAY OUT, AND THIS IS A MEASUREMENT RATHER THAN AN
  //     ASSERTION ON PURPOSE. It is a defect in the ASSET, not in this lane's
  //     code, and a probe that went red on it would be red until Blender ships
  //     again; the numbers are published so the fix has something to hit.
  //
  //     Two independent things stand between the spawn socket and the spine:
  //       * the hall's floor slab is a SQUARE that stops short of the spine
  //         deck, leaving `floorGapM` of nothing to walk on at z = 0;
  //       * the dodecagon's twelve wall segments are unbroken, so the segment
  //         facing +X stands across the whole 3 m spine mouth, full height.
  //     The walk below is the demonstration: it starts on the hall floor on the
  //     spine centreline and reports where it stops.
  // ======================================================================
  const spineMouthX = spineFwd.min[0];
  const blockers = st.proxyBoxes.filter((b) => b.name.startsWith('col_HallWall')
    && b.min[0] < spineFwd.max[0] && b.max[0] > spineMouthX
    && b.min[2] < spineFwd.max[2] && b.max[2] > spineFwd.min[2]
    && b.min[1] < lintelFwd.min[1] && b.max[1] > hallFloor.max[1] + 0.1);
  const hx = (hallFloor.max[0] + spineMouthX) / 2;
  const q1 = at(hallFloor.max[0] - 2.5, 0.6, 0);
  of.standAt(q1[0], q1[1], q1[2]);
  await drive(0.8, []);
  of.look(yawOf(A.along), 0);
  const hb = of.world().player.feet.slice();
  const s5 = await drive(3.0, ['KeyW']);
  const he = loc(of.world().player.feet.slice());
  const P5 = {
    hallFloorEndsAtXM: r6(hallFloor.max[0]),
    spineDeckStartsAtXM: r6(spineMouthX),
    floorGapM: r6(spineMouthX - hallFloor.max[0]),
    gapCentreXM: r6(hx),
    wallsAcrossTheSpineMouth: blockers.map((b) => ({ name: b.name,
      x: [r6(b.min[0]), r6(b.max[0])], y: [r6(b.min[1]), r6(b.max[1])],
      z: [r6(b.min[2]), r6(b.max[2])] })),
    startLocalXM: r6(loc(hb)[0]),
    endLocalXM: r6(he[0]),
    endLocalYM: r6(he[1]),
    fellThroughTheGap: s5.some((q) => !q.grounded),
    airborneTicks: s5.filter((q) => !q.grounded).length,
    blockedTicks: s5.filter((q) => q.blockedByBuild).length,
    // The thing the header claims, as one boolean and one number.
    hallReachesSpine: he[0] > doorX,
    stoppedShortOfDoorwayM: r6(doorX - he[0]),
  };
  log.push({ P5 });

  await back();
  return { ok: true, station: { id: st.id, name: st.name, deckR: r6(st.deckR),
    altM: r6(st.deckR - 600000), speedMps: r6(st.speedMps), e: st.el?.e,
    proxies: st.proxies, minted: st.install?.minted ?? null },
  P0, P1, P2, P3, P4, P5, log };
})()
