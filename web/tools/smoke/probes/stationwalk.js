// THE STATION IS WALKABLE, AND ITS FLOOR IS WHERE ITS ORBIT SAYS IT IS.
//
// `probes/orbitdeck.js` proved the MECHANISM: a col_* proxy holds the walker up
// 400 km above the terrain. It did that with a corridor the probe itself
// injected, so it proved nothing about the shipped station. This one drives the
// station the game actually boots.
//
// THE ASSERTION THAT MATTERS MOST IS P2, and it is the one that would catch the
// two systems drifting apart: the radius the walker STANDS at, bisected on the
// walker's own collision predicate, must equal the radius the ORBIT puts the
// station at, derived from the conic by a Kepler solve. Those are two entirely
// separate authorities (StructureBodies geometry against of_orb_resume) and
// nothing keeps them in step except SpaceStation.ts deriving the interior's
// pose from the record. If someone ever caches a position, this goes red.
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
  log.push({ station: { id: st.id, deckR: r6(st.deckR), speedMps: r6(st.speedMps),
    e: st.el?.e, a: r6(st.el?.a ?? NaN), proxies: st.proxies } });

  const P = st.pos;
  const u = [P[0] / st.deckR, P[1] / st.deckR, P[2] / st.deckR];
  const at = (h) => [u[0] * (st.deckR + h), u[1] * (st.deckR + h), u[2] * (st.deckR + h)];

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

  // ======================================================================
  // P1. STAND IN THE HUB. The station's local origin is the hub's centre and
  //     its deck top face, so `pos` itself is the spot to drop onto.
  // ======================================================================
  const p0 = at(0.5);
  of.standAt(p0[0], p0[1], p0[2]);
  const s1 = await drive(4.0, []);
  const g0 = s1.findIndex((q) => q.grounded);
  if (g0 < 0) {
    return fail('P1: the player never landed on the station deck', {
      deckR: r6(st.deckR), endFeetR: r6(s1[s1.length - 1].feetR),
      fellM: r6(st.deckR + 0.5 - s1[s1.length - 1].feetR),
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
  };
  log.push({ P1 });
  if (P1.onDeckTicks !== P1.ticks || P1.groundedTicks !== P1.ticks) {
    return fail('P1: the player did not stand steadily on the station', P1);
  }
  if (!(P1.feetR.spread <= 1e-6)) return fail('P1: standing radius is not constant', P1);

  // ======================================================================
  // P2. THE FLOOR IS WHERE THE ORBIT SAYS. Two authorities, compared.
  // ======================================================================
  const solidAt = (r) => of.solidBuild(u[0] * r, u[1] * r, u[2] * r);
  if (!solidAt(st.deckR - 0.25)) return fail('P2: the deck interior does not read solid');
  if (solidAt(st.deckR + 0.25)) return fail('P2: the air above the deck reads solid');
  let lo = st.deckR - 0.25, hi = st.deckR + 0.25;
  for (let i = 0; i < 60; ++i) {
    const mid = (lo + hi) / 2;
    if (solidAt(mid)) lo = mid; else hi = mid;
  }
  const P2 = {
    walkerTopFaceR: r6(hi),
    conicDeckR: r6(st.deckR),
    deltaM: r6(hi - st.deckR),
    stoodAtR: P1.feetR.min,
    standMinusConicM: r6(P1.feetR.min - st.deckR),
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
  const A = st.axes;
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
  // P4. WALK THE HUB, THROUGH THE DOORWAY, AND DOWN THE CORRIDOR.
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
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const yawOf = (d) => (Math.atan2(dot(d, east), dot(d, north)) * 180) / Math.PI;
  // The corridor's heading, read off the STATION's own published axes and not
  // rebuilt here. The axes must be horizontal or every distance below is
  // measured along a ramp.
  const tilt = { along: r6(dot(A.along, u)), across: r6(dot(A.across, u)) };
  if (Math.abs(tilt.along) > 1e-9 || Math.abs(tilt.across) > 1e-9) {
    return fail('P4: the station axes are not perpendicular to the radial', { tilt });
  }

  of.standAt(p0[0], p0[1], p0[2]);
  await drive(1.0, []);
  of.look(yawOf(A.along), 0);
  const before = of.world().player.feet.slice();
  const s4 = await drive(6.0, ['KeyW']);
  const after = of.world().player.feet.slice();
  const gg = s4.filter((q) => q.grounded);
  // How far down the corridor, in the station's own +Z: the hub face is at
  // local z = 6 and the corridor ends at 40, so passing 6 IS passing the door.
  const rel = [after[0] - P[0], after[1] - P[1], after[2] - P[2]];
  const alongM = dot(rel, A.along);
  const acrossM = dot(rel, A.across);
  const P4 = {
    travelledM: r6(Math.hypot(after[0] - before[0], after[1] - before[1],
      after[2] - before[2])),
    alongLocalZM: r6(alongM),
    acrossLocalXM: r6(acrossM),
    passedTheDoorway: alongM > 6,
    onDeckFrac: r6(gg.length === 0 ? 0 : gg.filter((q) => q.onDeck).length / gg.length),
    feetR: stats(gg.map((q) => q.feetR)),
    airborneTicks: s4.filter((q) => !q.grounded).length,
  };
  log.push({ P4 });
  if (!P4.passedTheDoorway) {
    return fail('P4: the player never got out of the hub, so the doorway is not '
      + 'open', P4);
  }
  if (P4.onDeckFrac !== 1) return fail('P4: the player left the deck while walking', P4);
  if (Math.abs(P4.acrossLocalXM) > 1.25 + 1e-3) {
    return fail('P4: the player walked through a corridor wall', P4);
  }
  // A FLAT DECK IS NOT A LEVEL DECK ON A ROUND WORLD, and the residual is a
  // PREDICTION rather than a tolerance. The floor is a plane in the station's
  // frame, but the walker's floor is where the RADIAL leaves that plane, and a
  // radial `d` metres from the centre exits at sqrt(R^2 + d^2), which is
  // d^2 / 2R above the middle. At 27 m out on a 1000 km radius that is
  // 0.373 mm. Asserting a bare epsilon here would have called correct geometry
  // a defect, which is exactly what the first run of this probe did.
  const bulgeM = (alongM * alongM) / (2 * st.deckR);
  P4.predictedBulgeM = r6(bulgeM);
  P4.bulgeErrorM = r6(P4.feetR.spread - bulgeM);
  if (Math.abs(P4.bulgeErrorM) > 1e-5) {
    return fail('P4: the deck height along the corridor is not the flat-plane '
      + 'bulge, so something other than the geometry is moving the floor', P4);
  }

  await back();
  return { ok: true, station: { id: st.id, name: st.name, deckR: r6(st.deckR),
    altM: r6(st.deckR - 600000), speedMps: r6(st.speedMps), e: st.el?.e,
    proxies: st.proxies, minted: st.install?.minted ?? null },
  P1, P2, P3, P4, log };
})()
