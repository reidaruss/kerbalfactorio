// stationboard.js: CE-39 to CE-43. THE RIDER IS BOARDED ONTO THE CARRIER.
//
//   node tools/smoke/run.mjs --scenario=walk --settle=25 \
//        --width=320 --height=180 \
//        --evalfile=tools/smoke/probes/stationboard.js
//
// THE VIEWPORT IS SMALL AND THE `of.run` RATE IS LOW, AND NEITHER TOUCHES WHAT
// IS ASSERTED. Nothing below reads a pixel: every claim is a distance, a
// velocity or a counter, and `solidBuild` is a query against `StructureBodies`.
// The fixed tick is driven by the accumulator inside `Loop.frame`, so the SIM is
// bit-identical at any render rate or resolution. On this VM (SwiftShader,
// software rasterisation, 16 cores shared with another lane) a 1600x900 run at
// the default 144.3 Hz spent one Chrome at 733% CPU and had not finished two
// 600-tick windows in 25 minutes. See RENDER_HZ below for the rate half. The one
// reading this DOES invalidate is the frame time, which is reported as an order
// of magnitude and labelled as such.
//
// todo #1. At HEAD, `of.carrier('census').ride` read `boards: 0` on a world with
// a player standing inside Anchorage: `CarrierRide` was constructed at boot and
// no shipped path ever handed it a frame. The deck moved (CE-80 to CE-86) and
// the ride carried (CE-33), and nothing connected the two. This probe measures
// the connection: `Loop.fixedTick`'s per-tick membership decision (CE-40) and
// the `visit:station` arrival that seats the player AT REST IN THE FRAME
// (CE-41) rather than at rest in the body frame at 31.32 m per tick of being
// left behind.
//
// ===========================================================================
// THE FAILURE MODES, NAMED BEFORE ANYTHING IS MEASURED (NUMBERS.md rule 4)
// ===========================================================================
//
//   F1  NEVER BOARDS.        `boards` stays 0; the feature is absent and every
//                            drift number below is 0 because nothing happened.
//   F2  BODY-FRAME ARRIVAL.  Boards, but `standAt` zeroed the absolute velocity
//                            and nothing put the frame's velocity back. Reads
//                            as a perfect arrival for exactly one tick.
//   F3  CHATTER.             Boards and releases repeatedly on the threshold.
//                            R36 measured 8 mode flips in 152 ticks elsewhere
//                            in this client; here each flip costs 31.32 m.
//   F4  NEVER RELEASES.      Walk off the edge and stay glued to the station.
//   F5  STALE-GEOMETRY TEST. Membership asked at a point in the tick where the
//                            rider is at poseAt(t+1) and the deck at poseAt(t).
//                            Invisible on a frozen station, 31.32 m wrong on a
//                            moving one.
//   F6  REBASE COLLAPSE.     A boarded rider at 1879.26 m/s crosses the 4 km
//                            floating-origin threshold every 128 ticks forever.
//   F7  VACUOUS PASS.        Everything measured against Anchorage as it ships,
//                            whose conic is FROZEN (`stampedTick = -1`), so the
//                            transport is the identity and zero drift is
//                            arithmetic rather than evidence (GP-142).
//
// F7 IS THE ONE THAT DECIDES THE SHAPE OF THIS FILE. Section 3 refuses to run
// the rest unless it is looking at a frame that genuinely moves at the station's
// own measured 31.320919525472796 m per tick, and that frame is a `rotor`
// DERIVED FROM ANCHORAGE'S OWN r x v, re-mounted through `mountStationOn`, which
// is the same function boot calls.
//
// EVERY WINDOW IS IN TICKS, NEVER SECONDS. `of.run(s)` takes seconds and the
// tick count it produces is read back off the census rather than assumed; the
// state-of-the-union's "+1.0 s" label for this drift was off by 1.85x for
// exactly that reason.
//
// ===========================================================================
// WHAT THIS PROBE DOES NOT COVER, SAID HERE RATHER THAN DISCOVERED LATER
// ===========================================================================
//
//   R98  SAVE / LOAD WHILE ABOARD. `VesselSave` drops `stampedTick` and
//        `stashVessels` restores it as -1, so a save taken aboard a moving
//        station reloads onto a frozen one with the rider still seated.
//        Persistence's choke point. NOT MEASURED HERE.
//   R93  DOCK-THEN-EVA. There is no `of_dk_*` symbol in the wasm at all, so no
//        vessel can arrive at Anchorage and no occupant can step out onto this
//        deck. Physics owns it. NOT MEASURED HERE.
//   R17  `mountStation` is called OUTSIDE `buildBodyScope` (Boot.ts), while
//        `mounts.clear()` is registered INSIDE it. So `of.reboot()` empties the
//        mounts and nothing re-mounts: after a reboot the station has no frame,
//        the membership decision finds nothing to board, and a player standing
//        in the hub is silently never carried again. A Boot ordering fix, not
//        this lane's file. NOT MEASURED HERE, and it is why nothing below
//        reboots.
//   R97  TIME WARP WHILE RIDING. Verified UNREACHABLE in this build rather than
//        guarded: warp lives on `FlightControls` -> `FlightSession.setWarp`,
//        which exists only while the active view source is a `VesselObserver`,
//        and `DayCycle.ts` states the rule ("warp is flight-local by design").
//        A boarded rider is a walker: no warp key, no warp cheat. NOT MEASURED
//        HERE because there is nothing to drive.
//   FlightMode.ts's vessel EVA (`this.d.player.standAt(...)`) has the IDENTICAL
//        standAt-zeroes-the-velocity defect CE-41 fixes for the station row. It
//        is the second consumer waiting on this fix and it is untouched.
(async () => {
  const of = window.__of;
  if (!of) return { valid: false, why: 'no __of' };
  for (const k of ['carrier', 'solidBuild', 'run', 'world', 'stats']) {
    if (typeof of[k] !== 'function') return { valid: false, why: `no __of.${k}` };
  }
  // 15 Hz AND NOT THE DEFAULT 144.3, AND IT CHANGES NOTHING THAT IS ASSERTED.
  // `Loop.run(s, hz)` renders `s * hz` frames and accumulates a fixed 1/60 tick
  // inside each, so the SIM TICK COUNT is identical either way (MAX_CATCHUP is
  // 5, and 1/15 s is 4 ticks) and only the number of RENDERED frames drops, by
  // 9.6x. Every number below is read in ticks off the census rather than assumed
  // from the seconds argument, so the fixture is unchanged. On this VM
  // (SwiftShader, software rasterisation, another lane's Chrome on the box) the
  // default rendered 2,886 frames for two 600-tick windows and had not finished
  // in 15 minutes. THE ONE THING THIS DOES INVALIDATE is the frame-time
  // reading, which now covers frames doing four ticks each: it is reported as an
  // order of magnitude and must not be read as a budget.
  const RENDER_HZ = 15;
  const sleep = (n) => of.run(n, RENDER_HZ);
  const fails = [];
  const notes = [];
  const check = (name, ok, detail) => {
    if (!ok) fails.push(detail === undefined ? name : `${name}: ${detail}`);
    return ok;
  };
  const d3 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  const len = (a) => Math.hypot(a[0], a[1], a[2]);
  const STATION = 'station:anchorage';
  // MEASURED, not asserted from prose: Anchorage's own orbital speed over 60.
  // 1879.2551715283678 m/s at r = 1.0e6 m about Forge's mu.
  const PER_TICK_M = 31.320919525472796;
  const C = () => of.carrier('census');
  const M = () => of.carrier('mounts');

  // --- 0. THE WORLD HAS A STATION AND A WALKER ----------------------------
  await sleep(1.0);
  const m0 = M();
  if (m0.solid === null || m0.mounts.size !== 1) {
    return { valid: false, why: 'no station mounted (?station=0, or no asset)', m0 };
  }
  const c0 = C();
  if (c0.feet === null || c0.ride === null) {
    return { valid: false, why: 'no walker (?mode=walk)', c0 };
  }
  const deckR = m0.solid.cr;

  // --- 1. NOBODY IS ABOARD ON THE GROUND, AND THE DECISION IS RUNNING -----
  // The two halves matter separately. `boards === 0` alone is also what a
  // decision that never runs looks like (F1 wearing a pass); `tested` growing
  // beside it is the evidence that the question is being asked every tick and
  // answered "no", which is the only correct answer 400 km below the deck.
  check('F1 control: nobody is aboard while standing on the ground',
    c0.ride.boards === 0 && c0.ride.carrier === null, JSON.stringify(c0.ride));
  check('and the ride applied no transport at all', c0.ride.applied === 0,
    `applied ${c0.ride.applied}`);
  const tested0 = mustNum(c0.mounts.boarding, 'tested', 'boarding');
  check('but the membership decision IS running, and declining', tested0 > 50,
    `tested ${tested0} after ${c0.tick} ticks`);
  check('...and it has boarded nobody', c0.mounts.boarding.boarded === 0,
    `boarded ${c0.mounts.boarding.boarded}`);
  const ground = c0.aboard;
  check('the player is far outside the deck, by the same predicate',
    ground !== null && ground.insideBoard === false && ground.depthM > 100000,
    JSON.stringify(ground));

  // --- 2. THE SHIPPED PRESS, ON THE STATION AS IT SHIPS -------------------
  // THE POSITIVE CONTROL, and the reason it is worth a section: the station's
  // conic is frozen, so `seatOnStationDeck`'s live deck position and GP-234's
  // tick-0 install position are THE SAME NUMBER, bitwise. If the arrival ever
  // starts landing somewhere else on a frozen station, it is this check that
  // says so, before any moving fixture can be blamed.
  of.pause(true);
  await sleep(0.35);
  const row = document.querySelector('#of-pause button[data-cheat="visit:station"]');
  if (row === null) return { valid: false, why: 'no station row in the menu', fails };
  row.click();
  await sleep(1.2);
  of.pause(false);
  await sleep(1.2);
  const c1 = C();
  const frozenSolid = M().solid.pos.slice();
  check('THE SHIPPED PRESS BOARDS THE PLAYER (todo #1: this read 0 at HEAD)',
    c1.ride.boards === 1 && c1.ride.carrier === STATION, JSON.stringify(c1.ride));
  check('...exactly once: the press boarded, the per-tick rule did not repeat it',
    c1.ride.boards === 1 && c1.ride.releases === 0, JSON.stringify(c1.ride));
  check('...and the per-tick rule boarded nobody, so the press is the author',
    c1.mounts.boarding.boarded === 0, `boarded ${c1.mounts.boarding.boarded}`);
  check('the ride is now applying a transport every tick',
    c1.ride.applied > 50, `applied ${c1.ride.applied}`);
  check('POSITIVE CONTROL: the feet are ON the frozen deck, to the metre',
    d3(c1.feet, frozenSolid) < 1.0, `${d3(c1.feet, frozenSolid)} m from the hub`);
  const frozenSpeed = len(c1.vel);
  check('and on a FROZEN station the seat velocity is zero, not 1879',
    frozenSpeed < 1e-9, `${frozenSpeed} m/s`);
  // The deck depth is SCANNED, never typed. A hard-coded 0.35 m read false on
  // stationride.js's first run while the world said `onDeck: true`, which is a
  // fixture that cannot exhibit the defect wearing the name of one that can.
  const up = (p) => { const l = len(p); return [p[0] / l, p[1] / l, p[2] / l]; };
  const under = (p, dm) => { const u = up(p);
    return [p[0] - u[0] * dm, p[1] - u[1] * dm, p[2] - u[2] * dm]; };
  const scan = [];
  for (let dm = 0.05; dm <= 2.0; dm += 0.05) {
    if (of.solidBuild(...under(c1.feet, dm))) scan.push(+dm.toFixed(2));
  }
  if (scan.length === 0) {
    return { valid: false, why: 'no solid 0.05..2.0 m under the feet after the press',
             fails, feet: c1.feet };
  }
  const DECK_M = scan[Math.floor(scan.length / 2)];

  // --- 3. THE FIXTURE. REFUSE TO CONTINUE IF IT DOES NOT MOVE (F7) --------
  const survFrozen = of.carrier('survey', { id: STATION, ticks: 600 });
  notes.push(`shipped station perTickM = ${survFrozen.perTickM} (frozen by design)`);
  const spin = of.carrier('register',
    { kind: 'rotor', id: 'spin', from: STATION, ticks: 600 });
  if (spin.error) return { valid: false, why: `rotor: ${spin.error}`, fails };
  if (!(spin.perTickM > 1)) {
    return { valid: false, fails,
      why: `F7 REFUSAL: the fixture does not move (perTickM ${spin.perTickM}). `
        + 'Every drift number below would be the identity element of the '
        + 'operation under test. Nothing else is measured.' };
  }
  check('FIXTURE: the moving frame travels at Anchorage\'s own measured rate',
    Math.abs(spin.perTickM - PER_TICK_M) < 1e-6,
    `${spin.perTickM} m/tick against ${PER_TICK_M}`);
  check('FIXTURE: and it turns, so the quaternion path is exercised too',
    spin.turnPerTickRad > 1e-9, `${spin.turnPerTickRad} rad/tick`);

  // --- 4. ARRIVE ON A MOVING STATION -------------------------------------
  // Let go first, so what follows is a boarding rather than a re-boarding, then
  // re-mount the station's geometry onto the moving frame. `remount` holds the
  // geometry exactly where it is at this tick, so nothing teleports.
  of.carrier('release');
  const beforeSwap = M().solid.pos.slice();
  const swap = of.carrier('remount', { id: 'spin' });
  if (swap.error) return { valid: false, why: `remount: ${swap.error}`, fails };
  check('re-mounting moves the station by exactly nothing',
    d3(beforeSwap, M().solid.pos) === 0, `${d3(beforeSwap, M().solid.pos)} m`);
  // R14: NO `await` between seating and running. `of.run` restarts the rAF loop
  // when it returns, so a yield here would age the seat velocity by an
  // unmeasured number of ticks, which on a turning frame is a real relative
  // velocity the rest of this section would then be measuring.
  const seat = of.carrier('seat');
  if (seat.error) return { valid: false, why: `seat: ${seat.error}`, fails };
  const cA = C();
  const tA = cA.tick;
  const feetA = cA.feet.slice();
  const localA = of.carrier('local').local.slice();
  const deckA = M().solid.pos.slice();
  const rebasesA = mustNum(cA, 'rebases', 'census');
  check('F2 CONTROL: the arrival is at rest IN THE FRAME, not in the body frame',
    Math.abs(len(cA.vel) - PER_TICK_M * 60) < 1e-3,
    `|vel| ${len(cA.vel)} m/s, wanted ${PER_TICK_M * 60} (a body-frame arrival `
    + 'reads ~0 here, and that is the defect)');
  check('and it is the moving frame that is carrying the player',
    cA.ride.carrier === 'spin', `${cA.ride.carrier}`);

  // --- 5. 600 TICKS ON A MOVING DECK -------------------------------------
  await sleep(10);
  const cB = C();
  const ticks1 = cB.tick - tA;
  const deckB = M().solid.pos.slice();
  const feetB = cB.feet.slice();
  const localB = of.carrier('local').local.slice();
  const localDrift = d3(localA, localB);
  const deckTravel = d3(deckA, deckB);
  const riderTravel = d3(feetA, feetB);

  // 0.1 PER CENT AND NOT 1e-6, AND THE SLACK IS GEOMETRY RATHER THAN NOISE.
  // `deckTravel` is the straight-line distance between two positions 600 ticks
  // apart on a circle, i.e. a CHORD, while `PER_TICK_M` is the one-tick chord.
  // Over a 0.0187925 rad arc the long chord is short of 600 one-tick chords by
  // theta^2/24, which is 1.47e-5 relative: 18792.275 m against 18792.552 m. A
  // 1e-6 bound here would be asserting that a circle is a straight line.
  check('the deck really travelled, at the frame\'s own rate',
    Math.abs(deckTravel / ticks1 - PER_TICK_M) < PER_TICK_M * 1e-3,
    `${deckTravel} m over ${ticks1} ticks = ${deckTravel / ticks1} m/tick`);
  check('THE RIDER WENT WITH IT', Math.abs(riderTravel - deckTravel) < 1.0,
    `rider ${riderTravel} m, deck ${deckTravel} m over ${ticks1} ticks`);
  check('DECK-RELATIVE DISPLACEMENT IS ZERO over the run', localDrift < 1e-6,
    `${localDrift} m of local drift over ${ticks1} ticks `
    + `(${localDrift / ticks1} m/tick)`);
  check('and the floor is still under the feet, by the walker\'s own predicate',
    of.solidBuild(...under(feetB, DECK_M)),
    `no solid ${DECK_M} m under ${JSON.stringify(feetB)}`);
  check('the deck is no longer where it was, so this is not a frozen fixture',
    !of.solidBuild(...under(feetA, DECK_M)), 'the old point is still solid');
  // F3. ACROSS THE WINDOW, AND THE DELTA IS THE POINT. The first version of this
  // check read `releases === 0` absolutely and went red at `releases: 1`, which
  // was the deliberate `release` in section 4 four lines before the window
  // opened. A cumulative counter cannot answer a question about an interval; it
  // read as chatter and was not.
  check('F3 CONTROL: NO CHATTER over the run',
    cB.ride.boards === cA.ride.boards && cB.ride.releases === cA.ride.releases,
    `boards ${cA.ride.boards} -> ${cB.ride.boards}, `
    + `releases ${cA.ride.releases} -> ${cB.ride.releases}`);
  check('...and the per-tick rule declined every one of those ticks',
    cB.mounts.boarding.tested - cA.mounts.boarding.tested >= ticks1 - 2
    && cB.mounts.boarding.released === 0,
    `tested +${cB.mounts.boarding.tested - cA.mounts.boarding.tested} over `
    + `${ticks1} ticks, released ${cB.mounts.boarding.released}`);

  // --- 6. F6. THE REBASE RATE, WHICH IS THE ONE REAL UNKNOWN -------------
  // A boarded rider at 1879.26 m/s crosses the 4 km threshold every
  // 4000 / 31.320920 = 127.7 ticks. Over 600 that is 4.70, and the floating
  // origin is the ONE rebase authority in the client, so this is a real cost
  // that lands on every subscriber forever, not a probe artefact.
  const rebases = mustNum(cB, 'rebases', 'census') - rebasesA;
  const predicted = ticks1 / (4000 / PER_TICK_M);
  check('F6: the rebase rate is the predicted one, not a runaway',
    Math.abs(rebases - predicted) <= 1.5,
    `${rebases} rebases over ${ticks1} ticks against a predicted ${predicted}`);
  const st = of.stats();
  notes.push(`frameMs p50/p99/worst = ${st.frameMs.p50}/${st.frameMs.p99}/`
    + `${st.frameMs.worst} ms (SwiftShader, driven clock, 4 ticks per rendered `
    + 'frame: an ORDER OF MAGNITUDE, never a budget)');
  // AND WHETHER THE CLIENT HAS CE-6'S KRAKENSBANE TRIGGER AT ALL. Reported,
  // never built. `world/FloatingOrigin.ts` is a pure distance threshold
  // (`thresholdM = 4000`, one `d2 < t*t` comparison) with NO speed term
  // anywhere in the file, so a rider at 1879 m/s gets exactly the same 4 km
  // rule a walker at 5 m/s gets. A finding for Admin, not a defect to fix here.
  const krakensbane = false;
  notes.push('CE-6 Krakensbane (>800 m/s trigger): ABSENT. FloatingOrigin is a '
    + 'plain 4000 m distance test with no velocity term at all');

  // --- 7. F4. WALK OFF THE EDGE, AND BE LET GO ---------------------------
  // DRIVEN THROUGH `standLocal`, which seats the rider at a LOCAL point at rest
  // in the frame: the state walking there would reach, without an input tape.
  // The destination is the DECK's own local position plus its own bound plus
  // 20 m, so the number comes off the census rather than being typed.
  const outX = localB[0] + deckR + 20;
  of.carrier('standLocal', { x: outX, y: localB[1], z: localB[2] });
  const velOut = C().vel.slice();
  const releasedBefore = cB.mounts.boarding.released;
  const boardedBefore = cB.mounts.boarding.boarded;
  await sleep(0.5);
  const cOut = C();
  check('F4: stepping outside the release radius LETS GO',
    cOut.ride.carrier === null,
    `still riding ${cOut.ride.carrier} at ${cOut.aboard?.depthM} m depth`);
  check('F4: exactly once, and the per-tick rule is the author',
    cOut.mounts.boarding.released === releasedBefore + 1,
    `released ${releasedBefore} -> ${cOut.mounts.boarding.released}`);
  check('F3: and nothing boarded again on the way out',
    cOut.mounts.boarding.boarded === boardedBefore,
    `boarded ${boardedBefore} -> ${cOut.mounts.boarding.boarded}`);
  check('CE-33: the released rider KEEPS the station\'s absolute velocity',
    Math.abs(len(velOut) - PER_TICK_M * 60) < 1.0,
    `|vel| ${len(velOut)} m/s at release against ${PER_TICK_M * 60}`);

  // --- 8. AND WALKING BACK ON BOARDS AGAIN, WITH NO PRESS ----------------
  // The other half of F1: the per-tick rule has to be able to say yes, not only
  // no. `board` + `standLocal` puts the rider back at the deck at rest, then
  // `release` hands the question back to the rule, which must answer it on the
  // very next tick.
  of.carrier('board', { id: 'spin' });
  of.carrier('standLocal', { x: localB[0], y: localB[1], z: localB[2] });
  of.carrier('release');
  await sleep(0.5);
  const cIn = C();
  check('F1: the per-tick rule boards a rider standing on the deck, with no press',
    cIn.ride.carrier === 'spin'
    && cIn.mounts.boarding.boarded === boardedBefore + 1,
    `carrier ${cIn.ride.carrier}, boarded ${cIn.mounts.boarding.boarded}`);
  check('and the floor is under them again',
    of.solidBuild(...under(cIn.feet, DECK_M)), 'no solid under the feet');

  // --- 9. THE NEGATIVE CONTROL, IN THE SAME RUN --------------------------
  // `unmount` and THEN `release`, in that order and with no tick between them,
  // because the order is the control. Releasing alone would be undone on the
  // next tick by the rule itself, correctly: a rider standing on a mounted deck
  // IS on the station. Dropping the mounts first is what makes "un-boarded"
  // reachable at all, and it is HEAD's behaviour exactly: a deck that stays put
  // while the person on it keeps the velocity they had.
  const unmounted = of.carrier('unmount');
  const rel = of.carrier('release');
  check('the control armed: no mounts, and the rider let go',
    unmounted.mounts.size === 0 && rel.was === 'spin',
    `${JSON.stringify(unmounted.mounts)} was ${rel.was}`);
  check('CE-33 CONTROL: release itself changes the velocity by nothing',
    d3(rel.before.vel, rel.after.vel) === 0,
    `${d3(rel.before.vel, rel.after.vel)} m/s lost at release`);
  const cC = C();
  const tC = cC.tick;
  const localC = of.carrier('local', { id: 'spin' }).local.slice();
  await sleep(10);
  const cD = C();
  const ticks2 = cD.tick - tC;
  const localD = of.carrier('local', { id: 'spin' }).local.slice();
  const looseDrift = d3(localC, localD);
  check('CONTROL: it stayed un-boarded, so the rule cannot heal the control',
    cD.ride.carrier === null, `${cD.ride.carrier}`);
  check('CONTROL: un-boarded, the rider comes apart from the frame',
    looseDrift > 100, `${looseDrift} m of local drift over ${ticks2} ticks`);
  check('CONTROL: and there is no floor under them any more',
    !of.solidBuild(...under(cD.feet, DECK_M)),
    'still standing on something, so the control did not fire');
  check('CONTROL: the un-boarded case is worse by orders of magnitude',
    looseDrift > localDrift * 1e6,
    `boarded ${localDrift} m vs released ${looseDrift} m`);

  // --- 10. AND THE SHIPPING FRAME IS PUT BACK, so the run does not end in a
  //         state no shipped world is ever in.
  const back = of.carrier('remount', { id: STATION });
  check('the shipping frame is remountable', !back.error, back.error);

  return {
    valid: true,
    fails,
    checks: 27,
    notes,
    deck: { boundRadiusM: deckR, depthM: DECK_M, depthScanHits: scan.length },
    frozen: { perTickM: survFrozen.perTickM, seatSpeedMS: frozenSpeed,
              boards: c1.ride.boards, carrier: c1.ride.carrier,
              feetToHubM: d3(c1.feet, frozenSolid) },
    fixture: { id: 'spin', perTickM: spin.perTickM, wantedPerTickM: PER_TICK_M,
               turnPerTickRad: spin.turnPerTickRad },
    boarded: { ticks: ticks1, seatSpeedMS: len(cA.vel),
               deckTravelM: deckTravel, riderTravelM: riderTravel,
               localDriftM: localDrift, localDriftPerTickM: localDrift / ticks1,
               boards: `${cA.ride.boards} -> ${cB.ride.boards}`,
               releases: `${cA.ride.releases} -> ${cB.ride.releases}` },
    released: { ticks: ticks2, localDriftM: looseDrift,
                localDriftPerTickM: looseDrift / ticks2 },
    rebase: { over: ticks1, counted: rebases, predicted, krakensbane,
              frameMs: st.frameMs },
    membership: { boardMarginM: cB.mounts.boarding.boardMarginM,
                  releaseMarginM: cB.mounts.boarding.releaseMarginM,
                  tested: cD.mounts.boarding.tested,
                  boarded: cD.mounts.boarding.boarded,
                  released: cD.mounts.boarding.released },
  };
})()
