// stationride.js: CE-80 to CE-86. THE DECK MOVES WITH THE STATION, AND SO DOES
// THE PERSON STANDING ON IT.
//
//   node tools/smoke/run.mjs --scenario=walk --settle=25 \
//        --evalfile=tools/smoke/probes/stationride.js
//
// The carrier frame has had no consumer since it was built (core-engine section
// 7b: "do not finish the carrier frame, it is finished; bind a consumer to
// it"). This is the consumer, under Admin ruling R13: the station's collision
// solid, its two gravity volumes and its drawn hull are re-posed every fixed
// tick from the SAME `poseAt` the rider uses.
//
// ===========================================================================
// THE FIXTURE PROBLEM, WHICH IS THE WHOLE REASON THIS PROBE IS SHAPED LIKE THIS
// ===========================================================================
//
// `mintStation` ships Anchorage with `stampedTick = -1`, so its conic is frozen
// and `OrbitCarrier` over it answers the SAME pose for every tick. The mount
// therefore runs correctly 60 times a second and writes identical numbers, and
// a probe that drove only the shipping station would be measuring the IDENTITY
// ELEMENT of the operation under test (GP-142, and CE-32 says the same of the
// ride). So:
//
//   - the frozen carrier is asserted to be frozen, OUT LOUD, before anything
//     else, so a future run in which physics has unfrozen it fails here and is
//     re-read rather than silently measuring something different;
//   - the moving fixture is a `rotor` frame DERIVED FROM THE STATION'S OWN
//     `r x v`, so its axis and rate are the conic's and not invented;
//   - and the station is re-mounted onto it through `mountStationOn`, the same
//     function `Boot` calls, so what is measured is what ships.
//
// ===========================================================================
// WHAT IS ASSERTED, AND WHY IT IS `solidBuild` AND NOT A DISTANCE
// ===========================================================================
//
// The headline check is `of.solidBuild(x, y, z)`, which is the EXACT predicate
// `KinematicBody` resolves the walker against. A distance between two numbers
// would prove that a field was written; this proves that the floor a player
// stands on is in the place the player is. Both halves are asserted in the same
// window: the deck is NOT where it was, and it IS under the feet.
//
// The negative control is `of.carrier('unmount')`, run in the same loop with
// the rider still boarded: the walker keeps being carried and the deck stops
// following, which is HEAD's behaviour exactly, and the separation then grows
// by the frame's own travel.
(async () => {
  const of = window.__of;
  if (!of) return { valid: false, why: 'no __of' };
  if (typeof of.carrier !== 'function') return { valid: false, why: 'no __of.carrier' };
  if (typeof of.solidBuild !== 'function') return { valid: false, why: 'no __of.solidBuild' };
  const sleep = (n) => of.run(n);
  const fails = [];
  const check = (name, ok, detail) => {
    if (!ok) fails.push(detail === undefined ? name : `${name}: ${detail}`);
    return ok;
  };
  const d3 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  const STATION = 'station:anchorage';
  const M = () => of.carrier('mounts');
  const C = () => of.carrier('census');

  // --- 1. THE STATION IS MOUNTED AT BOOT, AND THE MOUNT IS RUNNING ---------
  await sleep(1.0);
  const m0 = M();
  const cen0 = m0.mounts;
  check('one mount exists at boot', cen0.size === 1,
        `size ${cen0.size}, ids ${JSON.stringify(cen0.mounts.map((x) => x.id))}`);
  const mm0 = cen0.mounts[0] ?? null;
  if (mm0 === null || m0.solid === null) {
    return { valid: false, why: 'no station mounted (?station=0, or no asset)',
             fails, m0 };
  }
  check('it is the station carrier', mm0.id === STATION, mm0.id);
  check('the deck, both gravity volumes and the hull are on it',
        mm0.items.length === 3 && mm0.watchers.length === 1,
        `${JSON.stringify(mm0.items)} + ${JSON.stringify(mm0.watchers)}`);
  // A MOUNT THAT NEVER RAN WRITES NOTHING AND EVERY NUMBER BELOW WOULD STILL
  // READ CORRECTLY, because the geometry is already where install put it.
  const applied0 = mustNum(mm0, 'applied', 'mount');
  check('and it has been applied every tick since boot', applied0 > 50, `${applied0}`);
  await sleep(1.0);
  const appliedNow = M().mounts.mounts[0].applied;
  check('...and it keeps being applied', appliedNow > applied0,
        `${applied0} -> ${appliedNow}`);

  // --- 2. THE OFFSET IS REAL, AND IT IS A ROTATION ------------------------
  // `local = poseAt(0)^-1 . authored`. The translation half must be ~0 (the
  // station IS at its record's position) and the rotation half must NOT be the
  // identity, because `OrbitCarrier` publishes an LVLH basis and `stationQuat`
  // publishes a nadir-from-+Y one. If `offsets` were 0 the mount would be
  // writing the carrier's own attitude onto the hull, which would have rotated
  // an interior a player has walked around inside, self-consistently.
  check('every attachment carries a measured local offset', mm0.offsets === 3,
        `${mm0.offsets}`);
  const surv0 = of.carrier('survey', { id: STATION, ticks: 600 });
  const solid0 = m0.solid;
  check('the deck sits at the frame origin, so the offset is not a translation',
        d3(solid0.pos, surv0.originM) < 1e-6,
        `${d3(solid0.pos, surv0.originM)} m`);
  const qdot = Math.abs(solid0.quat[0] * surv0.qA[0] + solid0.quat[1] * surv0.qA[1]
    + solid0.quat[2] * surv0.qA[2] + solid0.quat[3] * surv0.qA[3]);
  check('and the hull attitude is NOT the carrier basis, so the offset is real',
        qdot < 0.999, `|dot| ${qdot} (1.0 would mean the two agree already)`);

  // --- 3. THE SHIPPED FIXTURE IS FROZEN. SAID OUT LOUD. -------------------
  check('Anchorage is frozen as it ships, so it is the identity element',
        surv0.perTickM === 0,
        `perTickM ${surv0.perTickM}: physics has unfrozen the record, and every `
        + 'claim below now has a different meaning. Re-read this probe.');

  // --- 4. STAND IN IT -----------------------------------------------------
  of.pause(true);
  await sleep(0.35);
  const row = document.querySelector('#of-pause button[data-cheat="visit:station"]');
  if (row === null) return { valid: false, why: 'no station row in the menu', fails };
  row.click();
  await sleep(1.2);
  of.pause(false);
  await sleep(1.2);
  const feet0 = C().feet;
  if (feet0 === null) return { valid: false, why: 'no walker (?mode=walk)', fails };
  const up = (p) => { const l = Math.hypot(p[0], p[1], p[2]);
                      return [p[0] / l, p[1] / l, p[2] / l]; };
  const under = (p, m2) => { const u = up(p);
    return [p[0] - u[0] * m2, p[1] - u[1] * m2, p[2] - u[2] * m2]; };
  // THE DEPTH IS MEASURED, NOT GUESSED. A hard-coded 0.35 m read `false` on the
  // first run while the world's own report said `onDeck: true`, which is a
  // fixture that cannot exhibit the defect wearing the name of one that can:
  // every later check would have been about a point in empty space. Scan for a
  // depth at which the deck IS solid and use that.
  const scan = [];
  for (let dm = 0.05; dm <= 2.0; dm += 0.05) {
    if (of.solidBuild(...under(feet0, dm))) scan.push(+dm.toFixed(2));
  }
  const DECK_M = scan.length === 0 ? 0.35 : scan[Math.floor(scan.length / 2)];
  const standing0 = scan.length > 0;
  check('the player is standing on the station deck', standing0,
        `no solid point 0.05..2.0 m under the feet ${JSON.stringify(feet0)}`);
  if (!standing0) return { valid: false, why: 'not on the deck', fails, feet0 };

  // --- 5. A MOVING FRAME, DERIVED FROM THE STATION'S OWN CONIC ------------
  const reg = of.carrier('register',
    { kind: 'rotor', id: 'spin', from: STATION, ticks: 600 });
  if (reg.error) return { valid: false, why: `rotor: ${reg.error}`, fails };
  check('the moving fixture really moves', reg.perTickM > 1,
        `perTickM ${reg.perTickM} (a frozen one is 0, and would prove nothing)`);
  check('...and it turns, so the quaternion path is exercised',
        reg.turnPerTickRad > 1e-9, `${reg.turnPerTickRad} rad/tick`);

  // THE SWAP MUST NOT TELEPORT THE STATION. `mountStationOn` measures the local
  // offset against the frame AT THE LIVE TICK, so re-mounting is continuous.
  const beforeSwap = M().solid.pos.slice();
  const swap = of.carrier('remount', { id: 'spin' });
  if (swap.error) return { valid: false, why: `remount: ${swap.error}`, fails };
  const afterSwap = M().solid.pos.slice();
  check('re-mounting moves the station by exactly nothing',
        d3(beforeSwap, afterSwap) === 0, `${d3(beforeSwap, afterSwap)} m`);
  check('the swapped mount carries the same three items and one watcher',
        swap.mounted.items.length === 3 && swap.mounted.watchers.length === 1);

  // --- 6. BOARD, SEAT AT REST IN THE FRAME, AND GO -----------------------
  // R14: NO `await` between seating and running. `of.run` restarts the rAF loop
  // when it returns, so a yield here would age the seat velocity by an
  // unmeasured number of ticks, and on a turning frame that is a real relative
  // velocity.
  const board = of.carrier('board', { id: 'spin' });
  if (board.error) return { valid: false, why: `board: ${board.error}`, fails };
  const l0 = of.carrier('local', { id: 'spin' });
  of.carrier('standLocal', { x: l0.local[0], y: l0.local[1], z: l0.local[2] });
  const tA = C().tick;
  const frameA = M().solid.pos.slice();
  const feetA = C().feet.slice();
  await sleep(10);
  const tB = C().tick;
  const m1 = M();
  const feetB = C().feet.slice();
  const ticks1 = tB - tA;
  const travelled = d3(frameA, m1.solid.pos);

  check('the frame carried the DECK', travelled > 100,
        `${travelled} m over ${ticks1} ticks`);
  check('and the deck went exactly as far as the frame did',
        Math.abs(travelled - d3(frameA, of.carrier('survey',
          { id: 'spin', ticks: 1 }).originM)) < 1e-6,
        `deck ${travelled} m`);
  check('both gravity volumes went with it',
        m1.volumes.length === 2
        && m1.volumes.every((v) => d3(v.pos, m1.solid.pos) < 1e-9),
        JSON.stringify(m1.volumes.map((v) => d3(v.pos, m1.solid.pos))));
  check('the bounding-sphere centre followed too, or the O(1) reject drops it',
        d3(m1.solid.c, m1.solid.pos) < 1e-9, `${d3(m1.solid.c, m1.solid.pos)} m`);
  // THE TWO HALVES OF THE HEADLINE CLAIM, in the walker's own predicate.
  const deckLeftBehind = !of.solidBuild(...under(feetA, DECK_M));
  const deckUnderFeet = of.solidBuild(...under(feetB, DECK_M));
  check('the deck is NO LONGER where it was', deckLeftBehind,
        'the old point is still solid, so nothing moved');
  check('THE DECK IS UNDER THE PLAYER, after 10 s on a moving station',
        deckUnderFeet,
        `feet moved ${d3(feetA, feetB)} m, deck moved ${travelled} m`);
  const l1 = of.carrier('local', { id: 'spin' });
  check('the rider did not drift in the frame', d3(l0.local, l1.local) < 0.05,
        `${d3(l0.local, l1.local)} m local drift over ${ticks1} ticks`);

  // --- 7. THE NEGATIVE CONTROL, IN THE SAME LOOP -------------------------
  // Drop the mount and leave everything else exactly as it is: still boarded,
  // still turning. This is HEAD's behaviour, reached through a verb.
  const unmounted = of.carrier('unmount');
  check('the control armed: no mounts left', unmounted.mounts.size === 0,
        JSON.stringify(unmounted.mounts));
  const tC = C().tick;
  const frameC = M().solid.pos.slice();
  const feetC = C().feet.slice();
  await sleep(10);
  const tD = C().tick;
  const m2 = M();
  const feetD = C().feet.slice();
  const ticks2 = tD - tC;
  const deckMoved = d3(frameC, m2.solid.pos);
  const riderMoved = d3(feetC, feetD);

  check('CONTROL: the deck did not move at all', deckMoved === 0, `${deckMoved} m`);
  check('CONTROL: the rider still did', riderMoved > 100,
        `${riderMoved} m over ${ticks2} ticks`);
  check('CONTROL: and there is now no floor under the player',
        !of.solidBuild(...under(feetD, DECK_M)),
        'the walker is still standing on something, so the control did not fire');
  const sepBefore = d3(feetC, frameC);
  const sepAfter = d3(feetD, m2.solid.pos);
  check('CONTROL: the player and their station have come apart',
        sepAfter - sepBefore > 100,
        `separation ${sepBefore} -> ${sepAfter} m`);

  // --- 8. THE CONTROL IS REVERSIBLE, so the run does not end inside it ----
  //
  // AND IT DOES NOT HEAL THE SEPARATION, which is worth stating because the
  // first version of this check assumed it would. `mountStationOn` holds the
  // geometry WHERE IT IS at the tick it is called, deliberately, so re-mounting
  // a station the player has already left behind re-mounts it 18 km away. The
  // recoverable claim is that the deck starts following again, and that is what
  // is asserted; asserting a floor back under the player would have been
  // asserting a teleport nothing performs.
  const back = of.carrier('remount', { id: 'spin' });
  check('re-mounting is accepted', !back.error, back.error);
  const frameE = M().solid.pos.slice();
  await sleep(2);
  const deckAgain = d3(frameE, M().solid.pos);
  check('and the deck moves again, so the control was the mount and nothing else',
        deckAgain > 100, `${deckAgain} m in 2 s`);

  return {
    valid: true,
    fails,
    checks: 21,
    boot: { mounts: cen0.size, items: mm0.items, watchers: mm0.watchers,
            offsets: mm0.offsets, applied0, appliedNow },
    offset: { deckToFrameOriginM: d3(solid0.pos, surv0.originM), attitudeDot: qdot },
    frozen: { stationPerTickM: surv0.perTickM }, deckDepthM: DECK_M, deckScan: scan.length,
    fixture: { rotorPerTickM: reg.perTickM, rotorTurnPerTickRad: reg.turnPerTickRad },
    mounted: { ticks: ticks1, deckMovedM: travelled,
               riderMovedM: d3(feetA, feetB),
               localDriftM: d3(l0.local, l1.local),
               deckLeftBehind, deckUnderFeet },
    control: { ticks: ticks2, deckMovedM: deckMoved, riderMovedM: riderMoved,
               sepBeforeM: sepBefore, sepAfterM: sepAfter },
    recovered: { deckMovedAgainM: deckAgain },
  };
})()
