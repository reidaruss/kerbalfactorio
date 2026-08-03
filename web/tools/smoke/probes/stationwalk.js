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
// P5 IS NOW AN ASSERTION (RN-832). It was a measurement because the defect was
// in the ASSET and a probe red until Blender ships again is a probe nobody
// runs. Blender has shipped: `col_HallWall{A,G}` are a jamb pair plus a lintel,
// `col_HallSill{Fwd,Aft}` bridge the deck, and the walk that stopped dead at
// local x 8.098644 now goes through. The numbers it published are all still
// published; three `if`s were added under them, which is all promoting one
// costs and is exactly why the numbers were published in that shape.
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
  // P5. THE HALL OPENS INTO THE SPINE, AND THE PLAYER WALKS IT.
  //
  //     Two independent things used to stand between the spawn socket and the
  //     spine, and RN-831 fixed both in the asset:
  //       * the hall's floor slab is a SQUARE inscribed in a round room, so it
  //         stopped 2.099 m short of the spine deck and the walker fell through
  //         for 51 ticks. `col_HallSill{Fwd,Aft}` bridge it, and `floorGapM` is
  //         still published because a resized hall could reopen it.
  //       * the segment of the hall ring facing +X stood across the whole 3 m
  //         spine mouth at full height. It is a jamb pair plus a lintel now,
  //         cut by the SAME emitter as the corridor bulkheads, so the hall's
  //         doorway and the bulkhead 1.65 m beyond it are one straight line.
  //
  //     THE THREE ASSERTIONS ARE THE THREE WAYS IT CAN GO WRONG AGAIN, and they
  //     are separate on purpose: a wall back across the mouth, a deck gap back
  //     under it, and a `col_HallWall*` box overlapping the opening are three
  //     different regressions wanting three different fixes, and one combined
  //     boolean would name none of them. `wallsAcrossTheSpineMouth` is the
  //     query the old measurement already ran; it just has an `if` under it.
  // ======================================================================
  const spineMouthX = spineFwd.min[0];
  const blockers = st.proxyBoxes.filter((b) => b.name.startsWith('col_HallWall')
    && b.min[0] < spineFwd.max[0] && b.max[0] > spineMouthX
    && b.min[2] < spineFwd.max[2] && b.max[2] > spineFwd.min[2]
    && b.min[1] < lintelFwd.min[1] && b.max[1] > hallFloor.max[1] + 0.1);
  const hx = (hallFloor.max[0] + spineMouthX) / 2;
  // UNFLOORED METRES ON THE CENTRELINE, and it is deliberately not
  // `spineMouthX - hallFloor.max[0]`. That subtraction was the right question
  // while the two slabs were the only two decks in the room, and it is now the
  // wrong one: `col_HallSillFwd` bridges them, so the difference between their
  // edges is still 2.099 m and is no longer a hole. The measurement asks the
  // WHOLE deck set instead, at 5 cm along the spine centreline, so any deck
  // proxy that covers the gap closes it and no proxy has to be named here.
  const decks = st.proxyBoxes.filter((b) => b.max[1] > -0.001 && b.max[1] < 0.001);
  const floored = (x) => decks.some((b) => b.min[0] <= x && x <= b.max[0]
    && b.min[2] <= 0 && 0 <= b.max[2]);
  let unfloored = 0;
  for (let x = hallFloor.max[0]; x <= spineMouthX + 1e-9; x += 0.05) {
    if (!floored(x)) unfloored += 0.05;
  }
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
    slabEdgeGapM: r6(spineMouthX - hallFloor.max[0]),
    /** What the slab-edge gap USED to imply and no longer does. Zero is the
     *  claim; the sill is what makes it zero and it is not named here. */
    unflooredOnCentrelineM: r6(unfloored),
    decksBridging: decks.filter((b) => b.min[0] < spineMouthX
      && b.max[0] > hallFloor.max[0]).map((b) => b.name),
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

  if (P5.wallsAcrossTheSpineMouth.length > 0) {
    return fail('P5: a hall wall segment stands across the spine mouth again; '
      + 'it wants splitting into a jamb pair and a lintel', P5);
  }
  if (P5.unflooredOnCentrelineM > 1e-6 || P5.fellThroughTheGap) {
    return fail('P5: there is no deck between the hall and the spine', P5);
  }
  if (!P5.hallReachesSpine) {
    return fail('P5: the walk out of the hall did not reach the doorway', P5);
  }

  // ======================================================================
  // P6. WALK OUT OF THE HALL IN EVERY DIRECTION, AND JUMP AT THE END OF EACH.
  //
  //     GP-400, AND THIS PHASE EXISTS BECAUSE P4 AND P5 BOTH WALK THE SAME
  //     LINE. Every driven metre above this point is along `A.along`, the spine
  //     centreline, and R56 was recorded as "the hall wall blocks the mouth"
  //     from a measurement taken on that one axis. Reid walked the room and
  //     reported the opposite: "i can move through walls and if i jump i then
  //     fall through the floor". Both were true. The hall's twelve wall proxies
  //     were twelve boxes translated round a circle and never turned to face
  //     it, so the two that happened to line up with +-X over-blocked and the
  //     other ten were oblique slabs with 2 to 10 m of open air beside them.
  //     A station walk that only walks one axis cannot tell those apart, which
  //     is the whole reason this phase is 24 headings and not one.
  //
  //     TWO JUMPS PER HEADING, and they ask different questions. The first is
  //     Reid's literally: stand where the wall stopped you and jump straight
  //     up. The second holds the walk key through the jump, which is the case
  //     that finds a floor edge, because 1.33 s of airtime at station gravity
  //     carries a walker several metres past anything a standing test reaches.
  //
  //     THE REFUSING CASE IS THE SAME FUNCTION, NOT A SECOND ONE. `leg` is run
  //     once more from 200 m beside the station, where there is provably no
  //     structure, and the run fails if that leg comes back anything other than
  //     lost. A sweep whose verdict function cannot say "lost" would report 24
  //     green legs through a hull made of fog.
  // ======================================================================
  const AZ_N = (typeof OF_ARGS === 'object' && OF_ARGS?.azimuths) || 24;
  // A JUMP AT STATION GRAVITY TAKES 2.30 s IN THE AIR, not the 0.83 s a surface
  // jump takes: apex 2.319915 m at 3.49886 m/s^2 is a 4.030 m/s launch and
  // twice that over g. The first draft gave the hop 1.4 s and the run-and-hop
  // 2.4 s, so 8 of 24 legs were still airborne when the leg ended and reported
  // `endGrounded: false` for a jump that was going perfectly well. Both windows
  // are the airtime plus a settle now, and the number is derived above rather
  // than tuned until it went green.
  const SETTLE_S = 0.8, OUT_S = 1.6, HOP_S = 3.0, RUNHOP_S = 3.4;
  // Powered, and restored afterwards. With the generator off the whole station
  // is in freefall and NOTHING here is grounded, so a sweep run in the dark
  // would be 24 legs of vacuously-not-falling.
  const gravBefore = of.stationGravity().powered;
  of.stationGravity(true);
  // The vented section, from the asset's own aft-most jamb (StationGravity.ts
  // derives the airlock plane the same way). A leg that ends aft of it is
  // WEIGHTLESS rather than fallen, so it is held to the deck-radius test and
  // not to the grounded one: a floating player has not left the station.
  const airlockX = Math.min(...st.proxyBoxes
    .filter((b) => b.name.startsWith('col_Jamb'))
    .map((b) => (b.min[0] + b.max[0]) * 0.5));

  const driveTape = async (secs, tape) => {
    of.input.tape(tape);
    of.stand(true);
    await of.run(secs, 60);
    await yield0();
    const t = of.stand();
    of.stand(false);
    return t.samples;
  };
  const jumpTape = (secs, keys) => [
    { hold: 2, keys: [...keys, 'Space'] },
    { hold: Math.ceil(secs * 60) + 120, keys },
  ];

  /**
   * One heading: stand, walk outward, hop, then run-and-hop. Returns numbers
   * only; every verdict below is taken from them and never from inside here,
   * so the refusing control runs the identical code.
   */
  const leg = async (label, startLocal, aimDir) => {
    const q = at(startLocal[0], 0.6, startLocal[2]);
    of.standAt(q[0], q[1], q[2]);
    const s0 = await drive(SETTLE_S, []);
    of.look(yawOf(aimDir), 0);
    const b0 = loc(of.world().player.feet.slice());
    const s1 = await drive(OUT_S, ['KeyW']);
    const wallStop = loc(of.world().player.feet.slice());
    const s2 = await driveTape(HOP_S, jumpTape(HOP_S, []));
    const s3 = await driveTape(RUNHOP_S, jumpTape(RUNHOP_S, ['KeyW']));
    const end = loc(of.world().player.feet.slice());
    const all = [...s0, ...s1, ...s2, ...s3];
    const minR = Math.min(...all.map((p) => p.feetR));
    const maxR = Math.max(...all.map((p) => p.feetR));
    const tail = all.slice(-30);
    const last = all[all.length - 1];
    return {
      label,
      startLocal: [r6(b0[0]), r6(b0[2])],
      wallStopLocal: [r6(wallStop[0]), r6(wallStop[2])],
      wallStopRM: r6(Math.hypot(wallStop[0], wallStop[2])),
      endLocal: [r6(end[0]), r6(end[1]), r6(end[2])],
      endRM: r6(Math.hypot(end[0], end[2])),
      travelledM: r6(Math.hypot(end[0] - b0[0], end[2] - b0[2])),
      // How far below the deck plane the feet EVER got. On a deck this is the
      // bulge and rounding; off one it is the fall.
      fellM: r6(st.deckR - minR),
      roseM: r6(maxR - st.deckR),
      blockedTicks: all.filter((p) => p.blockedByBuild).length,
      airborneTicks: all.filter((p) => !p.grounded).length,
      endGrounded: tail.every((p) => p.grounded),
      // THE VERDICT IS `onDeck` AND NOT `grounded`, and the first draft got
      // that wrong in the flattering direction's opposite: it called three
      // headings lost whose `fellM` was -0.000004 m, because a walker still
      // rising off a wall he had just jumped beside is not grounded and is very
      // much still in the station. `grounded` is a claim about WEIGHT
      // (KinematicBody sets it false in freefall on purpose, so the aft vented
      // section could never satisfy it either); `onDeck` is the claim about
      // GEOMETRY, which is the one this phase is making.
      endOnDeck: tail.every((p) => p.onDeck),
      endBelowDeckM: r6(deckRAt(end) - last.feetR),
      vented: end[0] < airlockX,
      ticks: all.length,
    };
  };

  const legs = [];
  for (let k = 0; k < AZ_N; ++k) {
    const th = (2 * Math.PI * k) / AZ_N;
    const c = Math.cos(th), sn = Math.sin(th);
    const dir = [
      A.along[0] * c + A.across[0] * sn,
      A.along[1] * c + A.across[1] * sn,
      A.along[2] * c + A.across[2] * sn,
    ];
    // 3.0 m out from the hall's centre: clear of `col_HallCore` (1.548) and
    // well inside the deck, so the walk starts on floor at every heading.
    legs.push(await leg(`az${r6((th * 180) / Math.PI)}`, [3.0 * c, 0, 3.0 * sn], dir));
  }
  // THE REFUSING CASE, through the same `leg`. 200 m across, deck radius,
  // nothing built. It must come back lost or the verdict is not a verdict.
  const ctlDir = [A.across[0], A.across[1], A.across[2]];
  const ctl = await leg('control:200m-beside', [0, 0, 200], ctlDir);

  const FELL_TOL = 0.25;
  const lostOf = (L) => L.fellM > FELL_TOL || L.endBelowDeckM > FELL_TOL
    || !L.endOnDeck;
  const lost = legs.filter(lostOf);
  const P6 = {
    azimuths: AZ_N,
    gravityPowered: of.stationGravity().powered,
    airlockPlaneXM: r6(airlockX),
    fellToleranceM: FELL_TOL,
    lostAzimuths: lost.map((L) => L.label),
    lostCount: lost.length,
    blockedLegs: legs.filter((L) => L.blockedTicks > 0).length,
    ventedLegs: legs.filter((L) => L.vented).length,
    minTravelledM: r6(Math.min(...legs.map((L) => L.travelledM))),
    maxFellM: r6(Math.max(...legs.map((L) => L.fellM))),
    maxEndBelowDeckM: r6(Math.max(...legs.map((L) => L.endBelowDeckM))),
    // THE MEASUREMENT THE ASSET PREDICTS, DRIVEN. `HALL_STANDOFF` in
    // build_space_station.py is R (1 - sqrt(M/(M+1))) = 1.0852 m at three
    // steps, so the tightest wall stop in the hall should be 8.100 - 1.085 =
    // 7.015 m from the station's axis. Published rather than asserted: it is
    // the number that says how much of the room the axis-aligned proxy set
    // still costs, and the day it goes to zero is the day the client carries a
    // per-proxy rotation.
    wallStopRM: stats(legs.map((L) => L.wallStopRM)),
    control: ctl,
    controlIsLost: lostOf(ctl),
    legs,
  };
  log.push({ P6 });
  of.stationGravity(gravBefore);

  // The refusing case first: if the verdict cannot fail, nothing below it means
  // anything, and it is checked before the thing it licenses rather than after.
  if (!P6.controlIsLost) {
    return fail('P6: the control leg 200 m beside the station was not reported '
      + 'lost, so the sweep could not have detected a fall', P6);
  }
  // POSITIVE CONTROL THAT THE SWEEP RAN. A leg where the player never moved is
  // a leg that proves nothing, and 24 of those would still be zero lost.
  if (legs.length !== AZ_N) return fail('P6: the sweep did not run every heading', P6);
  if (!(P6.minTravelledM > 1.0)) {
    return fail('P6: some heading never moved the player, so its green is empty',
      P6);
  }
  // AND THAT THE WALLS ARE DOING THE WORK. Every heading but the two spine
  // mouths must be stopped by structure; a room whose legs all ran down
  // corridors would also report nothing lost.
  if (!(P6.blockedLegs >= AZ_N - 4)) {
    return fail('P6: too few headings were stopped by any wall, so the hall is '
      + 'open rather than enclosed', P6);
  }
  if (P6.lostCount > 0) {
    return fail('P6: the player walked or jumped out of the station', P6);
  }

  await back();
  return { ok: true, station: { id: st.id, name: st.name, deckR: r6(st.deckR),
    altM: r6(st.deckR - 600000), speedMps: r6(st.speedMps), e: st.el?.e,
    proxies: st.proxies, minted: st.install?.minted ?? null },
  P0, P1, P2, P3, P4, P5, P6, log };
})()
