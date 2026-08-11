// stationreboot.js: CE-47. R17. THE STATION COMES BACK FROM A REBOOT, ON ITS
// CONIC, AND THE PLAYER IS CARRIED AGAIN.
//
//   node tools/smoke/run.mjs --scenario=walk --settle=25 \
//        --width=320 --height=180 \
//        --evalfile=tools/smoke/probes/stationreboot.js
//
// ===========================================================================
// THE DEFECT, WHICH WAS SILENT AND PERMANENT
// ===========================================================================
//
// `Boot` installed the station and mounted it in a block OUTSIDE
// `buildBodyScope`, while `mounts.bindTo(lt)` and `carriers.bindTo(lt)` were
// registered INSIDE it. `WorldSession.reboot` ends that scope, so the mounts and
// the carrier registry emptied and nothing put them back.
//
// EVERY VISIBLE THING SURVIVED, which is what made it silent. The collision
// solid is in game-scoped `StructureBodies`, the gravity volumes are in
// `GravityVolumes`, the hull is in the near scene: after a reboot there was
// still a deck, it was still solid, and a player could still stand on it. It had
// simply stopped following its own conic, and CE-40's membership rule, finding
// no mount, declined for ever. A player in the hub of a station travelling at
// 1879.26 m/s was left behind at 31.32 m per tick with no error anywhere.
//
// ===========================================================================
// A SIBLING RATHER THAN A SECTION OF stationboard.js, AND WHY
// ===========================================================================
//
// `probes/stationboard.js` already drives two 600-tick windows and takes nine
// minutes on this VM under SwiftShader. A reboot rebuilds the terrain worker and
// re-streams the world, which is the most expensive single operation the client
// has, and bolting it onto that file would have put its 28 checks behind a
// timeout. This one asks one question and is short.
//
// ===========================================================================
// THE FAILURE MODES, NAMED BEFORE MEASURING
// ===========================================================================
//
//   G1  NO MOUNT AFTER REBOOT.   R17 itself: the census shows 0 mounts, or a
//                                mount that is never applied again.
//   G2  NO FRAME AFTER REBOOT.   The mount came back but `station:anchorage` is
//                                not in the carrier registry, so `poseAt` has no
//                                authority and the press has nothing to board.
//   G3  DECK OFF ITS CONIC.      The rebuild re-mounted the geometry WHERE IT
//                                LAY rather than where the record says it is, so
//                                the deck is permanently behind its own orbit by
//                                however long the rebuild took. Reads perfectly
//                                healthy from inside the station.
//   G4  MEMBERSHIP DEAD.         Mount and frame both back, but the rule never
//                                boards anybody again.
//   G5  DECK IN THE WRONG PLACE. The station snapped to its conic and the player
//                                did not, so the arrival lands in empty space.
//   G6  VACUOUS PASS.            Measured on a frozen station, where a mount
//                                that stopped following a conic is
//                                indistinguishable from one that is following a
//                                constant.
//
// G6 IS ASSERTED FIRST. `stashVessels` drops `stampedTick` on every save, so a
// world between a load and its first stamp is frozen and every claim below would
// be about a station that was not going anywhere in the first place.
//
// AND G1/G4 GET A REACHABLE REFUSING CASE IN THE SAME RUN, at the END of it:
// `of.carrier('unmount')` produces exactly the state R17 left behind, and the
// probe measures the rule declining for ever in it. That is the defect,
// reproduced through a verb, so "it works after a reboot" is a comparison rather
// than an assertion. It runs LAST because half of what made R17 silent is that
// the floor is still there, and that cannot be shown from the ground.
(async () => {
  const of = window.__of;
  if (!of) return { valid: false, why: 'no __of' };
  for (const k of ['carrier', 'solidBuild', 'run', 'reboot', 'world']) {
    if (typeof of[k] !== 'function') return { valid: false, why: `no __of.${k}` };
  }
  // See stationboard.js: 15 Hz renders 9.6x fewer frames and produces the
  // identical fixed-tick count, and nothing here reads a pixel.
  const sleep = (n) => of.run(n, 15);
  const fails = [];
  const notes = [];
  const check = (name, ok, detail) => {
    if (!ok) fails.push(detail === undefined ? name : `${name}: ${detail}`);
    return ok;
  };
  const d3 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  const len = (a) => Math.hypot(a[0], a[1], a[2]);
  const STATION = 'station:anchorage';
  const PER_TICK_M = 31.320919525472796;
  const C = () => of.carrier('census');
  const M = () => of.carrier('mounts');
  const up = (p) => { const l = len(p); return [p[0] / l, p[1] / l, p[2] / l]; };
  const under = (p, dm) => { const u = up(p);
    return [p[0] - u[0] * dm, p[1] - u[1] * dm, p[2] - u[2] * dm]; };

  await sleep(1.0);
  if (M().solid === null) {
    return { valid: false, why: 'no station mounted (?station=0, or no asset)' };
  }
  if (C().feet === null) return { valid: false, why: 'no walker (?mode=walk)' };

  // --- 0. G6. THE STATION MOVES, OR NOTHING BELOW MEANS ANYTHING ---------
  const surv0 = of.carrier('survey', { id: STATION, ticks: 600 });
  if (!(surv0.perTickM > 1)) {
    return { valid: false, fails,
      why: `G6 REFUSAL: the station does not move (perTickM ${surv0.perTickM}). `
        + 'Its record is unstamped, so a mount that has stopped following the '
        + 'conic is indistinguishable from one that is following a constant.' };
  }
  check('FIXTURE: the station travels at its own measured orbital rate',
    Math.abs(surv0.perTickM - PER_TICK_M) < 1e-6,
    `${surv0.perTickM} against ${PER_TICK_M}`);

  // --- 1. REBOOT, FROM THE GROUND, AND THE ORDER IS FORCED ---------------
  //
  // THE PLAYER IS NOT ABOARD FOR THIS AND THAT IS A LIMIT OF THIS BOX, NOT A
  // CHOICE. `of.reboot()` rebuilds the terrain worker and re-streams the world
  // around the observer. From the ground that is 10.6 s here, measured. From
  // the station's deck, 400 km up, it did not return in TWO runs of over ten
  // minutes each: the streamer is being asked to cover a viewpoint 400 km above
  // the surface. `probes/stationvisit.js` names the same shape in its own header
  // ("a walker parked 400 km up with the streamer chasing him never converges")
  // and it ends on the ground for exactly this reason. It is pre-existing and
  // nothing in CE-47 touches `bootTerrain`.
  //
  // WHAT IS LOST BY REBOOTING FROM THE GROUND IS ONE CLAIM, and it is named
  // rather than quietly skipped: whether a rider who is ABOARD when the scope
  // ends comes back aboard. What is NOT lost is R17 itself, which is about the
  // MOUNT AND THE FRAME coming back at all, and about boarding working
  // afterwards. Both are measured below.
  const tBefore = C().tick;
  const boardsBefore = C().ride.boards;
  const r = await of.reboot();
  await sleep(1.0);
  const c2 = C();
  const m2 = M();
  const rebuildTicks = c2.tick - tBefore;
  notes.push(`ground reboot: teardown ${Math.round(r.teardownMs)} ms, rebuild `
    + `${Math.round(r.rebuildMs)} ms, spanning ${rebuildTicks} ticks, during `
    + `which the station travelled ${(rebuildTicks * PER_TICK_M).toFixed(1)} m`);
  check('the reboot was a same-body one', r.fromBodyId === r.toBodyId,
    JSON.stringify({ from: r.fromBodyId, to: r.toBodyId }));
  check('and the scope really was torn down and rebuilt', r.epoch >= 1,
    `epoch ${r.epoch}`);

  // G1. THE ASSERTION THIS FILE EXISTS FOR.
  check('G1: THE MOUNT IS BACK AFTER THE REBOOT', m2.mounts.size === 1,
    `${m2.mounts.size} mounts: ${JSON.stringify(m2.mounts.mounts.map((x) => x.id))}`);
  const mm = m2.mounts.mounts[0] ?? null;
  check('G1: ...and it is the station\'s, carrying all three items and the hull',
    mm !== null && mm.id === STATION && mm.items.length === 3
    && mm.watchers.length === 1,
    JSON.stringify(mm));
  check('G1: ...and it is being applied every tick again',
    mm !== null && mustNum(mm, 'applied', 'mount') > 30, `${mm?.applied}`);
  // G2.
  check('G2: the carrier frame is registered again',
    c2.registry.ids.includes(STATION), JSON.stringify(c2.registry.ids));
  // G3. THE DECK IS BACK ON ITS CONIC, not merely back on a frame. This is the
  // difference between re-installing at the LIVE tick and re-mounting the
  // geometry where it happened to lie: the second reads healthy from inside the
  // station and leaves it permanently behind its own orbit.
  const survNow = of.carrier('survey', { id: STATION, ticks: 1 });
  const deckOffConic = d3(m2.solid.pos, survNow.originM);
  check('G3: THE DECK IS ON ITS CONIC, not where it lay when the scope ended',
    deckOffConic < 1e-6,
    `${deckOffConic} m off. A hold-in-place remount would read about `
    + `${(rebuildTicks * PER_TICK_M).toFixed(1)} m here`);

  // --- 2. G4 / G5. AND THE PRESS WORKS AGAIN -----------------------------
  of.pause(true);
  await sleep(0.35);
  const rowOf = () =>
    document.querySelector('#of-pause button[data-cheat="visit:station"]');
  if (rowOf() === null) return { valid: false, why: 'no station row', fails };
  rowOf().click();
  const cPress = C();
  of.pause(false);
  await sleep(1.0);
  const c3 = C();
  check('G4: the press boards the player again after a reboot',
    c3.ride.carrier === STATION && c3.ride.boards > boardsBefore,
    `carrier ${c3.ride.carrier}, boards ${boardsBefore} -> ${c3.ride.boards}`);
  // 0.05 m/s, for the reason `stationboard.js` spells out at its own F2 check:
  // CE-49 seats at the asset's `socket_hall`, 4.045 m off the frame origin, and
  // `pointVelocity` is evaluated AT THE SEAT POINT, so a rotating frame adds up
  // to omega x r = 7.6e-3 m/s on top of the origin's speed (measured difference
  // 1.13e-3). That is the frame being right. It still discriminates absolutely
  // against a body-frame arrival, which reads ~0 rather than ~1879.
  check('G5: seated at the station\'s own speed, not at rest in the body frame',
    Math.abs(len(cPress.vel) - PER_TICK_M * 60) < 0.05,
    `|vel| ${len(cPress.vel)} against ${PER_TICK_M * 60}`);
  const scan = [];
  for (let dm = 0.05; dm <= 2.0; dm += 0.05) {
    if (of.solidBuild(...under(c3.feet, dm))) scan.push(+dm.toFixed(2));
  }
  if (scan.length === 0) {
    return { valid: false, why: 'no floor under the feet after the press', fails };
  }
  const DECK_M = scan[Math.floor(scan.length / 2)];
  check('G5: with the floor under the feet', scan.length > 0, 'no solid');

  // --- 3. AND IT STILL CARRIES CORRECTLY, 600 TICKS LATER ----------------
  const tA = c3.tick;
  const localA = of.carrier('local').local.slice();
  const deckA = M().solid.pos.slice();
  await sleep(10);
  const c4 = C();
  const ticks = c4.tick - tA;
  const localB = of.carrier('local').local.slice();
  const deckTravel = d3(deckA, M().solid.pos);
  const localDrift = d3(localA, localB);
  check('the deck travelled at its own rate after the reboot',
    Math.abs(deckTravel / ticks - PER_TICK_M) < PER_TICK_M * 1e-3,
    `${deckTravel} m over ${ticks} ticks`);
  check('AND THE DECK-RELATIVE DRIFT IS STILL ZERO', localDrift < 1e-6,
    `${localDrift} m over ${ticks} ticks (${localDrift / ticks} m/tick)`);
  check('and the floor is still under the feet 600 ticks on',
    of.solidBuild(...under(c4.feet, DECK_M)), 'no solid under the feet');
  check('no chatter across the window',
    c4.ride.boards === c3.ride.boards && c4.ride.releases === c3.ride.releases,
    `boards ${c3.ride.boards} -> ${c4.ride.boards}, releases `
    + `${c3.ride.releases} -> ${c4.ride.releases}`);

  // --- 4. THE DEFECT, REPRODUCED THROUGH A VERB, WITH THE PLAYER ON THE
  //        DECK (G1 / G4's control) --------------------------------------
  // `unmount` leaves exactly what R17 left behind: geometry that still exists
  // and is still solid, with no frame under it and no mount in the census. The
  // rule then has nothing to answer about. Run LAST and with the player
  // actually standing there, because "the floor is still there" is the half
  // that made R17 silent and it cannot be shown from the ground.
  const unm = of.carrier('unmount');
  of.carrier('release');
  // READ AT THE INSTANT, BEFORE ANY TICK. The first version of this sampled the
  // floor under the player after a one-second sleep and went red, correctly: a
  // released rider keeps the station's absolute velocity (CE-33) while the
  // unmounted deck stands still, so it coasts 1,879 m away inside that second
  // and of course has no floor under it. That is the SEPARATION, which is a
  // different claim from the one this control is making.
  const floorAtUnmount = of.solidBuild(...under(C().feet, DECK_M));
  const boardedBeforeControl = C().mounts.boarding.boarded;
  await sleep(1.0);
  const cCtl = C();
  check('CONTROL: with no mount there is nothing to board, and the rule declines',
    cCtl.ride.carrier === null
    && cCtl.mounts.boarding.boarded === boardedBeforeControl
    && unm.mounts.size === 0,
    `carrier ${cCtl.ride.carrier}, boarded ${boardedBeforeControl} -> `
    + `${cCtl.mounts.boarding.boarded}, mounts ${unm.mounts.size}`);
  // THE HALF THAT MADE R17 SILENT, asked about the DECK rather than about the
  // player: the geometry still exists, is still registered, and is still solid
  // to the walker's own predicate. Somebody standing on it sees a floor and no
  // error. It has simply stopped following its conic.
  const floorOnDeck = of.solidBuild(...under(M().solid.pos, DECK_M));
  check('CONTROL: ...while the deck is still SOLID where it stands, which is '
    + 'what made R17 silent',
    floorAtUnmount && floorOnDeck,
    `at the unmount ${floorAtUnmount}, under the deck itself ${floorOnDeck}`);
  check('CONTROL: ...and the player has come off it, which is the symptom',
    !of.solidBuild(...under(cCtl.feet, DECK_M)),
    'the player is still standing on something, so the control did not fire');
  const deckStuck = d3(M().solid.pos,
    of.carrier('survey', { id: STATION, ticks: 1 }).originM);
  check('CONTROL: and the deck has come off its own conic', deckStuck > 100,
    `${deckStuck} m between the deck and where the record says it is`);

  return {
    valid: true,
    fails,
    checks: 18,
    notes,
    fixture: { perTickM: surv0.perTickM, wantedPerTickM: PER_TICK_M },
    deck: { depthM: DECK_M, depthScanHits: scan.length },
    reboot: { fromBodyId: r.fromBodyId, toBodyId: r.toBodyId, epoch: r.epoch,
              teardownMs: Math.round(r.teardownMs),
              rebuildMs: Math.round(r.rebuildMs),
              spannedTicks: rebuildTicks,
              stationTravelledM: rebuildTicks * PER_TICK_M },
    after: { mounts: m2.mounts.size, mountId: mm?.id ?? null,
             applied: mm?.applied ?? null, frames: c2.registry.ids,
             deckOffConicM: deckOffConic },
    press: { boards: `${boardsBefore} -> ${c3.ride.boards}`,
             carrier: c3.ride.carrier, seatSpeedMS: len(cPress.vel),
             wantedSeatSpeedMS: PER_TICK_M * 60 },
    carried: { ticks, deckTravelM: deckTravel, localDriftM: localDrift,
               localDriftPerTickM: localDrift / ticks },
    control: { mountsAfterUnmount: unm.mounts.size,
               floorAtUnmount, floorOnDeckAfter: floorOnDeck,
               boardedWhileUnmounted: `${boardedBeforeControl} -> `
                 + `${cCtl.mounts.boarding.boarded}`,
               deckOffConicM: deckStuck },
  };
})()
