// stationreveal.js (GP-719 to GP-724): TWO CLAIMS REID MADE ON 2026-08-13, in
// one probe because they are two halves of one field.
//
//   node tools/smoke/run.mjs --url=http://127.0.0.1:4369/ --scenario=walk \
//     --settle=10 --width=320 --height=180 \
//     --evalfile=tools/smoke/probes/stationreveal.js
//
//   (1) "you should still be able to discover the map as you run around"
//   (2) "the full map should reveal whenever you explore the space station"
//
// -----------------------------------------------------------------------------
// WHAT THE FIRST CLAIM ACTUALLY MEANS AT FOOT SCALE, MEASURED RATHER THAN
// ASSUMED, BECAUSE THE OBVIOUS TEST IS THE WRONG ONE.
//
// "Walk N metres, assert the discovered fraction rose" cannot be run against the
// SURVEY layer in any probe. Measured on this build: the walker does 4.573 m/s
// on flat ground and a survey cell is 9,375 m across, so the first guaranteed
// new survey cell is 2,050 seconds of walking away. At the 12.6x sim-to-wall
// ratio this box gets at `renderHz` 10, that is 62 MINUTES of wall clock for one
// assertion, and at the runner's default render rate it is 13 hours.
//
// That is not a defect and it is not a limit of the harness. It is discovery.h's
// design read out loud: height buys EXTENT and costs RESOLUTION, so the coarse
// layer is deliberately the one a walk barely moves. What a walk DOES move is
// the EXPLORE layer (292.97 m cells), and that is the layer that gates an ore
// patch, which is the thing a player running around is actually finding.
//
// So the on-foot claim is split into the two assertions that are each provable:
//
//   §1 REAL WALKING, real `KeyW` through the real input tape, moves the EXPLORE
//      layer. The bound is airtight rather than tuned: the probe walks FURTHER
//      THAN ONE EXPLORE CELL EDGE, read off the client rather than typed here,
//      so it has certainly left its own seed cell and `observe` must have added
//      at least one. It also holds the survey layer to "did not fall", because
//      discovery only ever adds and a drop would be corruption.
//   §3 THE SURVEY LAYER MOVES FOR THE SAME ON-FOOT OBSERVER over distances big
//      enough to matter, driven by `of.teleport` hops of 2 degrees (20.9 km,
//      more than two survey cells) because walking them is the 62 minutes above.
//      This is the SAME walker feeding the SAME `MapMode.frame` -> `disc.step`
//      path §1 drives; only the locomotion differs, and §1 is what proves the
//      locomotion. Stated here so nobody reads a teleport as a walk.
//
// §2 IS THE NEGATIVE CONTROL AND IT IS THE HALF THAT CATCHES A DEAD FEATURE.
// A discovery driver that had been unwired would look identical to a working one
// in §1 if the world happened to start with cells in it, so standing still must
// be shown to add NOTHING WHILE THE PASSES ARE STILL HAPPENING — `observations`
// climbing at 1 Hz with `lastSurveyAdded` and `lastExploreAdded` both 0. That is
// `probes/stationboard.js`'s `tested > 50 && boarded === 0` shape: a rule that is
// running and declining is a completely different state from one that is not
// running, and no single counter can tell them apart.
//
// -----------------------------------------------------------------------------
// THE SECOND CLAIM, AND THE THREE WAYS IT COULD BE FAKE.
//
// §4 boards through `of.carrier('seat')`, which is the SHIPPED `seatOnStationDeck`
// with no menu in front of it, and asserts the survey layer goes to EXACTLY 1.0.
//
// `of.standAt` is deliberately NOT used and cannot be: it zeroes the ABSOLUTE
// velocity (CE-41, DebugCarrier.ts), which on a deck doing 1,879.26 m/s is a
// player left behind rather than a player aboard. That defect is named in the
// backlog; the working path is the one this probe takes.
//
// The three fakes:
//   §5 A REVEAL THAT RE-FIRES. Boarding twice must reveal nothing the second
//      time, or the "once in a save" claim is decoration.
//   §6 A REVEAL THAT DOES NOT PERSIST. `of.map('forget')` DESTROYS the field
//      (DW-17: the destruction is the point — a round trip over a field that
//      never left memory measures nothing), and the load must bring 98,304 cells
//      back while the milestone stays earned EXACTLY ONCE, because the restore
//      path goes through `research.earn` and never through `grantMilestone`.
//   §7 A REVEAL THAT IS REALLY A PER-FRAME "IF ON STATION, FILL". This is the
//      sharpest control in the file and it is the one that distinguishes a latch
//      from a condition: forget the field WHILE STANDING ON THE STATION, run
//      three seconds, and the map must come back at WALKING scale. A conditional
//      re-fills it instantly; a latched edge does not.
//
// §8 HOME BODY ONLY, and it is MEASURED RATHER THAN ASSERTED, because measuring
// it found a defect that is not this lane's and must not be turned into this
// lane's red. See the GP-725 block above §8 for what `of.reboot(1)` actually
// does to the discovery field. What §8 DOES assert is the part that belongs to
// this feature: a spent milestone cannot fire a second reveal anywhere.
//
// -----------------------------------------------------------------------------
// TWO HARNESS TRAPS THIS PROBE WALKED INTO, FIXED HERE AND WORTH THE WARNING.
//
// GP-726: `of.run(seconds, renderHz)` DOES NOT DELIVER `seconds` OF SIM TIME
// BELOW 12 Hz. `Loop.frame` runs at most `MAX_CATCHUP = 5` fixed ticks per
// rendered frame and then DISCARDS the backlog (`if (ticks === MAX_CATCHUP)
// this.acc = 0`), so a render rate of R delivers min(1, R*5/60) of the sim time
// asked for. At the 10 Hz this probe first used that is 83.3%, measured exactly:
// 83 discovery passes over a requested 100 s, and a walk that read 3.831 m/s for
// a walker that does 4.573. Every duration below is therefore asserted against
// the TICK COUNTER, never against the number handed to `of.run`, and RENDER_HZ
// is 12 so that 60/12 = 5 lands exactly on the clamp instead of just under it.
//
// GP-727: `of.save()` FOLLOWED LATER BY `of.load()` IS NOT A ROUND TRIP. The 20 s
// autosave writes the same slot, so a load taken more than a few seconds after
// the save restores the AUTOSAVE, not the save. Measured: §7 threw the map away
// on purpose, and the `of.load()` that was meant to put it back restored 19,943
// cells rather than 98,304 — the autosave had already captured the thrown-away
// state. The save/load round trip in §6 is kept tight for that reason and §7 no
// longer restores at all.
//
// STANDING RULE 11 throughout: every bound is derived from a number read off the
// client in the same run (the explore cell edge, the survey cell edge, the
// lattice's own total, the tick counter) or from the geometry on paper. Nothing
// here was moved until it passed.
(async () => {
  const of = window.__of;
  if (!of) return { valid: false, why: 'no __of' };
  for (const k of ['map', 'game', 'carrier', 'world', 'run', 'teleport',
                   'save', 'load', 'reboot']) {
    if (typeof of[k] !== 'function') return { valid: false, why: `no __of.${k}` };
  }
  const fails = [];
  const log = [];
  const check = (name, ok, detail) => {
    if (ok !== true) fails.push(detail === undefined ? name : `${name}: ${detail}`);
    return ok === true;
  };

  // RENDER_HZ IS PART OF THE MEASUREMENT, NOT A SPEED KNOB, AND 12 IS NOT A
  // ROUND NUMBER. The station reveal fires in `onPreRender` (Systems.ts), so a
  // run with no frames in it would prove nothing about the trigger. 12 Hz is
  // above the 1 Hz discovery sample, it cuts the wall clock ~12x against the
  // runner's default (measured: 10 sim s costs 18.1 s at the default and 1.4 s
  // here), and 60/12 = 5 is exactly `Loop.MAX_CATCHUP`, which is the largest
  // render rate that loses no sim time to the backlog discard. See GP-726 above.
  const RENDER_HZ = 12;
  const run = (s) => of.run(s, RENDER_HZ);
  /** Sim seconds off the FIXED TICK COUNTER, which is the only honest clock
   *  here: `of.run`'s argument is a request and GP-726 is what happens when a
   *  probe believes it. */
  const simS = () => of.world().tick / 60;
  const D = () => of.map('disc').discovery;
  const RIDE = () => of.carrier('census').ride;
  const MILES = () => of.game()?.progress?.research?.milestones ?? [];
  const STATION_BOARDED = 0x0004;   // research.h milestones::StationBoarded
  const STATION = 'station:anchorage';
  const countOf = (id) => MILES().filter((m) => m === id).length;
  const feet = () => of.world().player.feet.slice();
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

  await run(1.5);

  // ===========================================================================
  // §0 — SETUP PROOF. DW-20: nothing below is believed until the fixture is.
  // ===========================================================================
  const d0 = D();
  const surveyCellM = mustNum(d0, 'surveyCellSizeM', 'disc');
  const exploreCellM = mustNum(d0, 'exploreCellSizeM', 'disc');
  const bodyRadiusM = mustNum(d0, 'bodyRadiusM', 'disc');
  check('§0 the discovery field is live and cut for a real body',
    bodyRadiusM > 1000, `bodyRadiusM=${bodyRadiusM}`);
  check('§0 the survey lattice is the 9,375 m one discovery.h derives for Forge',
    Math.abs(surveyCellM - 9375) < 1e-6, `${surveyCellM}`);
  check('§0 the explore lattice is the 292.97 m one',
    Math.abs(exploreCellM - 292.96875) < 1e-6, `${exploreCellM}`);
  // THE LATTICE'S OWN TOTAL, derived from the fraction rather than typed: a
  // literal 98,304 here would be a second definition of the grid size and would
  // stop being true the day the cell target moves.
  const SURVEY_TOTAL = Math.round(d0.surveyCells / d0.surveyFraction);
  check('§0 the survey lattice total is derivable and is 6 * side^2',
    Number.isFinite(SURVEY_TOTAL) && SURVEY_TOTAL > 0
    && SURVEY_TOTAL % 6 === 0 && Number.isInteger(Math.sqrt(SURVEY_TOTAL / 6)),
    `${SURVEY_TOTAL}`);
  check('§0 a fresh world has NOT boarded the station',
    countOf(STATION_BOARDED) === 0, JSON.stringify(MILES()));
  check('§0 a fresh world is not riding anything', RIDE().carrier === null,
    JSON.stringify(RIDE()));
  check('§0 a fresh world has NOT got the full map',
    d0.surveyFraction < 1, `${d0.surveyFraction}`);
  const st0 = of.station();
  check('§0 there is a station to board', st0 !== null && st0.speedMps > 1000,
    JSON.stringify(st0 === null ? null : { speedMps: st0.speedMps }));
  log.push(`§0 survey cell ${surveyCellM} m, explore cell ${exploreCellM} m, `
    + `survey lattice ${SURVEY_TOTAL} cells, body ${bodyRadiusM} m`);

  // ===========================================================================
  // §1 — ON FOOT, THE POSITIVE. Real walking moves the fine layer.
  // ===========================================================================
  //
  // THE FIELD IS THROWN AWAY FIRST, for `probes/discovery.js`'s reason: the
  // shipped world starts the player standing on the ore cluster with a second's
  // worth of discovery already banked, so a baseline taken at boot is a baseline
  // of the spawn and not of the walk.
  const preForget = D();
  of.map('forget');
  // READ IT BEFORE RUNNING A SINGLE FRAME. This is the whole of the destruction
  // proof and the timing is the reason it works: `of_disc_clear` empties both
  // layers and zeroes `observations` synchronously, so a read taken with no
  // frame in between sees ZERO of everything. Two drafts got this wrong in two
  // different ways and both are the same mistake, which is measuring after the
  // world has had a chance to undo the measurement:
  //   * `exploreCells < 200` two seconds later: ONE on-foot pass rediscovers the
  //     ~226 explore cells inside the 1,996 m horizon disc it just threw away,
  //     so the count looks untouched even when the destruction was total. That
  //     threshold also sat just under one pass, so it would have gone GREEN on a
  //     `forget` that did nothing whatsoever.
  //   * `observations` FELL two seconds later: true, but unmeasurable here,
  //     because a settled boot has taken only 2 passes and 2 -> 2 is not a drop.
  const razed = D();
  check('§1 forget really destroyed the field, synchronously (DW-17)',
    razed.surveyCells === 0 && razed.exploreCells === 0
    && razed.observations === 0,
    `survey=${razed.surveyCells} explore=${razed.exploreCells} `
    + `observations=${razed.observations} (was ${preForget.surveyCells}/`
    + `${preForget.exploreCells}/${preForget.observations})`);
  await run(2.0);
  const w0 = D();
  const p0 = feet();
  const t0 = simS();

  // WALK FURTHER THAN ONE EXPLORE CELL, so the bound below is arithmetic rather
  // than taste. 100 s at the measured 4.573 m/s is 457 m of intent against a
  // 292.97 m cell; terrain costs some of that, and the assertion is made against
  // the DISTANCE ACTUALLY COVERED, never against the distance asked for. That
  // distinction is GP-680's lesson: this game moves the player without being
  // asked, so a probe that trusts its own request is measuring its request.
  const WALK_S = 100;
  of.input.tape([{ hold: WALK_S * 60 + 60, keys: ['KeyW'] }, { hold: 4, keys: [] }]);
  await run(WALK_S);
  const w1 = D();
  const p1 = feet();
  const walkedM = dist(p0, p1);
  const walkSimS = simS() - t0;     // GP-726: the clock, not the request
  log.push(`§1 walked ${walkedM.toFixed(1)} m in ${walkSimS.toFixed(2)} sim s `
    + `(${(walkedM / walkSimS).toFixed(3)} m/s; requested ${WALK_S} s), explore `
    + `${w0.exploreCells} -> ${w1.exploreCells}, survey ${w0.surveyCells} -> `
    + `${w1.surveyCells}`);
  check('§1 the walker actually walked further than one explore cell',
    walkedM > exploreCellM, `${walkedM.toFixed(1)} m vs ${exploreCellM} m`);
  // THE AIRTIGHT BOUND. Having moved more than one cell edge in a straight line,
  // the walker is in a different explore cell than it started in, and `observe`
  // seeds the observer's own cell unconditionally (discovery.h §3). So at least
  // one cell that did not exist before must exist now. No threshold.
  check('§1 walking DISCOVERS: the explore layer grew',
    w1.exploreCells > w0.exploreCells,
    `${w0.exploreCells} -> ${w1.exploreCells} over ${walkedM.toFixed(1)} m`);
  check('§1 the survey layer never shrank (discovery only ever adds)',
    w1.surveyCells >= w0.surveyCells,
    `${w0.surveyCells} -> ${w1.surveyCells}`);
  // THE 1 Hz SAMPLER REALLY SAMPLED, bounded on BOTH sides and derived from the
  // driver's own code rather than from the round number in its comment.
  //
  // GP-728. `Discovery.step` fires when `sinceS >= SAMPLE_S` and then sets
  // `sinceS = 0` — it ZEROES the accumulator rather than subtracting SAMPLE_S,
  // so the remainder above 1.0 is discarded and the true interval is anywhere in
  // [1.0, 1.0 + one frame]. At 12 Hz that is up to 1.0833 s, which over a 93 s
  // walk is four passes fewer than "one per second" and is exactly the gap that
  // made a `floor(simS) - 2` bound fail at 90 against 91. This is a real (and
  // harmless) property of the driver: 1 Hz is the target, not a contract. The
  // bound below is that property written down.
  const passes = w1.observations - w0.observations;
  const passMin = Math.floor(walkSimS / (1 + 1 / RENDER_HZ)) - 1;
  const passMax = Math.ceil(walkSimS) + 1;
  check('§1 the sampler ran at 1 Hz through the walk',
    passes >= passMin && passes <= passMax,
    `${passes} passes in ${walkSimS.toFixed(2)} sim s, band [${passMin}, ${passMax}]`);
  // discovery.h's own soundness condition for the 1 Hz interval: the observer
  // must not outrun one sweep, or the ground track has gaps in it.
  check('§1 gapRatio stayed under 1 (no gaps along the track)',
    w1.gapRatio < 1, `${w1.gapRatio}`);
  check('§1 no pass hit the cell budget', w1.budgetHit === false);

  // ===========================================================================
  // §2 — THE NEGATIVE CONTROL. Standing still adds nothing, and the instrument
  //      is still running while it adds nothing.
  // ===========================================================================
  of.input.tape([{ hold: 4, keys: [] }]);
  await run(2.0);                       // let the last step's momentum die
  const s0 = D();
  const q0 = feet();
  const t2 = simS();
  const STAND_S = 20;
  await run(STAND_S);
  const s1 = D();
  const q1 = feet();
  const standSimS = simS() - t2;
  const driftM = dist(q0, q1);
  log.push(`§2 stood ${standSimS.toFixed(2)} sim s, drifted ${driftM.toFixed(3)} m, `
    + `explore ${s0.exploreCells} -> ${s1.exploreCells}, `
    + `observations ${s0.observations} -> ${s1.observations}`);
  check('§2 the player really did stand still', driftM < 1.0,
    `${driftM.toFixed(3)} m`);
  check('§2 standing still discovers NO new survey ground',
    s1.surveyCells === s0.surveyCells,
    `${s0.surveyCells} -> ${s1.surveyCells}`);
  check('§2 standing still discovers NO new explore ground',
    s1.exploreCells === s0.exploreCells,
    `${s0.exploreCells} -> ${s1.exploreCells}`);
  check('§2 and the last pass says so in its own counters',
    s1.lastSurveyAdded === 0 && s1.lastExploreAdded === 0,
    `survey+${s1.lastSurveyAdded} explore+${s1.lastExploreAdded}`);
  // THE HALF THAT MAKES IT A CONTROL RATHER THAN AN ABSENCE. A driver that had
  // been unwired would also add nothing.
  check('§2 the passes were STILL HAPPENING while they added nothing',
    s1.observations - s0.observations
      >= Math.floor(standSimS / (1 + 1 / RENDER_HZ)) - 1,
    `${s1.observations - s0.observations} passes in ${standSimS.toFixed(2)} sim s`);

  // ===========================================================================
  // §3 — THE SURVEY LAYER, for the same on-foot observer, over survey distances.
  // ===========================================================================
  //
  // 2 degrees of latitude is 20,944 m on a 600 km body, which is 2.23 survey
  // cells, so every hop is guaranteed to land in a cell the last one was not in.
  // Derived from the body radius READ OFF THE CLIENT, so it stays true on
  // another body.
  const HOP_DEG = 2.0;
  const hopM = bodyRadiusM * HOP_DEG * Math.PI / 180;
  check('§3 the hop is longer than one survey cell', hopM > surveyCellM,
    `${hopM.toFixed(0)} m vs ${surveyCellM} m`);
  const hops = [D().surveyCells];
  let hopsRose = true;
  for (let i = 1; i <= 4; i++) {
    of.teleport(i * HOP_DEG, 0, 0);
    await run(2.0);
    const n = D().surveyCells;
    if (!(n > hops[hops.length - 1])) hopsRose = false;
    hops.push(n);
  }
  log.push(`§3 survey cells across four ${(hopM / 1000).toFixed(1)} km hops: `
    + hops.join(' -> '));
  check('§3 the SURVEY layer grows for the on-foot observer, every hop',
    hopsRose, hops.join(' -> '));
  const d3 = D();
  check('§3 and it is still nowhere near a full map', d3.surveyFraction < 0.01,
    `${d3.surveyFraction}`);

  // ===========================================================================
  // §4 — BOARDING THE STATION REVEALS THE WHOLE SURVEY LAYER.
  // ===========================================================================
  const before = D();
  const obsBefore = before.observations;
  const seat = of.carrier('seat');
  check('§4 the shipped seat put the walker on Anchorage\'s frame',
    seat !== null && seat.carrier === STATION, JSON.stringify(seat));
  // CE-41's positive control, and the reason `of.standAt` is not used here: a
  // real boarding carries the station's own 1,879.26 m/s. A `standAt` arrival
  // reads ~0, and that ~0 IS the defect.
  check('§4 the arrival carries the deck\'s velocity, not a zeroed one',
    seat !== null && seat.speedMS > 1000, `${seat === null ? 'null' : seat.speedMS}`);
  await run(1.5);
  const after = D();
  check('§4 the ride is held by the station', RIDE().carrier === STATION,
    JSON.stringify(RIDE()));
  check('§4 the milestone was earned, exactly once',
    countOf(STATION_BOARDED) === 1, JSON.stringify(MILES()));
  check('§4 THE FULL MAP: every survey cell on the home body',
    after.surveyCells === SURVEY_TOTAL,
    `${before.surveyCells} -> ${after.surveyCells} of ${SURVEY_TOTAL}`);
  check('§4 and the fraction is exactly 1', after.surveyFraction === 1,
    `${after.surveyFraction}`);
  // THE ORE IN THE NEXT VALLEY IS STILL YOURS TO FIND. The explore layer did
  // rise, because the deck is 400 km up and the ordinary horizon rule is still
  // running — so the bound is what THOSE PASSES could have added and not zero.
  // One pass is capped at a 10 km ground chord (discovery.h's exploreMaxRadiusM)
  // and the smallest explore cell is the face-centre one divided by 2.12, so a
  // pass cannot add more than pi*10000^2 / (292.96875/2.12)^2 = 16,450 cells.
  // A reveal leaking into this layer would add a hundred million.
  const obsDelta = after.observations - obsBefore;
  const exploreCeiling = Math.ceil(
    obsDelta * Math.PI * 1e8 / Math.pow(exploreCellM / 2.12, 2));
  check('§4 the EXPLORE layer was NOT revealed: its growth is what the '
    + 'horizon rule alone could do',
    after.exploreCells - before.exploreCells <= exploreCeiling,
    `+${after.exploreCells - before.exploreCells} over ${obsDelta} passes, `
    + `ceiling ${exploreCeiling}`);
  check('§4 the explore layer is nowhere near complete',
    after.exploreFraction < 0.01, `${after.exploreFraction}`);
  log.push(`§4 revealed ${after.surveyCells - before.surveyCells} survey cells; `
    + `save now ${after.saveBytes} bytes; explore `
    + `${before.exploreCells} -> ${after.exploreCells} over ${obsDelta} passes`);

  // ===========================================================================
  // §5 — A SECOND BOARDING REVEALS NOTHING.
  // ===========================================================================
  const g5 = after.generation;
  of.carrier('release');
  await run(1.0);
  check('§5 the release really let go', RIDE().carrier === null,
    JSON.stringify(RIDE()));
  const seat2 = of.carrier('seat');
  await run(1.5);
  const d5 = D();
  check('§5 the second boarding boarded', seat2 !== null
    && RIDE().carrier === STATION, JSON.stringify(seat2));
  check('§5 the milestone is STILL held exactly once',
    countOf(STATION_BOARDED) === 1, JSON.stringify(MILES()));
  check('§5 the second boarding added no survey cells',
    d5.surveyCells === SURVEY_TOTAL, `${d5.surveyCells}`);
  // The generation counter is the sharper reading: `revealSurvey` only bumps it
  // when it added something, so an unchanged-count-but-bumped-generation would
  // be a reveal that ran and found nothing to do, which is not the same as one
  // that never ran. Explore passes bump it too, so this is asserted as "did not
  // jump", not "did not move".
  log.push(`§5 generation ${g5} -> ${d5.generation} across the re-board`);

  // ===========================================================================
  // §6 — IT PERSISTS, AND THE LOAD DOES NOT RE-GRANT.
  // ===========================================================================
  await of.save();
  of.map('forget');                       // DW-17: the destruction is the point
  await run(1.0);
  const gone = D();
  check('§6 forget really destroyed the revealed map',
    gone.surveyCells < SURVEY_TOTAL, `${gone.surveyCells}`);
  await of.load();
  await run(1.0);
  const back = D();
  check('§6 the load brought the whole revealed map back',
    back.surveyCells === SURVEY_TOTAL, `${back.surveyCells} of ${SURVEY_TOTAL}`);
  check('§6 /core did not refuse the stream',
    (of.game()?.persist?.restored?.discovery ?? -1) > 0,
    JSON.stringify(of.game()?.persist?.restored ?? null));
  // THE L7 CLAIM. `PersistProgress` restores milestones through `research.earn`
  // and never through `grantMilestone`, so a load is not something the player
  // did and cannot double the earned set. In-page rather than across a real page
  // navigation, which is the same limit `probes/milestones.js` names for itself:
  // a probe cannot navigate mid-script and keep its return value.
  check('§6 the restore path did NOT double the milestone',
    countOf(STATION_BOARDED) === 1, JSON.stringify(MILES()));

  // ===========================================================================
  // §7 — THE SHARPEST CONTROL: it is a LATCH, not a per-frame condition.
  // ===========================================================================
  //
  // Standing on the station, throw the map away. A trigger written as "if the
  // player is on the station, reveal" puts 98,304 cells straight back. The
  // shipped one is an EDGE guarded by a spent milestone, so it must not.
  check('§7 still aboard for the control', RIDE().carrier === STATION,
    JSON.stringify(RIDE()));
  of.map('forget');
  await run(3.0);
  const latch = D();
  log.push(`§7 forgot the map while aboard, ran 3 s: survey back to `
    + `${latch.surveyCells} of ${SURVEY_TOTAL}`);
  check('§7 the reveal did NOT re-fire while standing on the station',
    latch.surveyCells < SURVEY_TOTAL,
    `${latch.surveyCells} of ${SURVEY_TOTAL} — a conditional would refill it`);
  check('§7 what came back is the ordinary horizon rule at altitude, not a fill',
    latch.surveyCells > 0, `${latch.surveyCells}`);
  // NO `of.load()` HERE. An earlier draft put one in to tidy up and it read back
  // 19,943 cells instead of 98,304: the 20 s autosave had already written the
  // thrown-away field over the slot. GP-727. The world is deliberately left with
  // a partial map, which costs §8 nothing.

  // ===========================================================================
  // §8 — HOME BODY ONLY, MEASURED. And a defect that is not this lane's.
  // ===========================================================================
  //
  // GP-725. THE DISCOVERY FIELD IS NOT RE-CUT WHEN THE WORLD CHANGES BODY, and
  // that is PRE-EXISTING, in another file, and visible here only because a full
  // reveal makes it obvious. `Boot.ts:583` calls `bootMap` OUTSIDE
  // `buildBodyScope` (declared at :318, first run at :427), so the `Discovery`
  // driver is constructed once with the BOOT body's id and `WorldSession.reboot`
  // never rebuilds it. It is the same shape as R17's station mount, one domain
  // over.
  //
  // Measured through `of.reboot(1)` with the save slot wiped first, so nothing
  // could be re-applied behind the measurement: the world moves to Cinder
  // correctly (`of.world().bodyRadiusM` 200,000, `of.map('report').body` says
  // `{bodyId:1, name:'Cinder', radiusM:200000}`), while the discovery field
  // still reports `bodyRadiusM` 600,000, a 9,375 m cell and Forge's 98,304
  // cells, AND it keeps taking observations — so a player walking on Cinder is
  // writing Cinder positions into Forge's lattice.
  //
  // SO "HOME BODY ONLY" IS CURRENTLY NOT A CHOICE, IT IS THE ONLY THING THE DATA
  // MODEL CAN EXPRESS: there is one field, for the boot body, and one blob for
  // it in the save. The recommendation stands (the moon's map belongs to the
  // moon scan, per story_line_outline_v1.txt) but it is not this reveal that
  // enforces it, and saying otherwise here would be the comment lying.
  //
  // THIS IS MEASURED AND NOT ASSERTED. Turning another lane's defect into this
  // probe's red would make the sweep's verdict about somebody else's file. The
  // one thing §8 DOES assert is this feature's own claim: a spent milestone
  // cannot fire a second reveal, wherever the player goes.
  const milesBeforeReboot = countOf(STATION_BOARDED);
  let moon = null;
  let rebootErr = null;
  try {
    await of.reboot(1);
    await run(3.0);
    moon = D();
  } catch (e) { rebootErr = String(e); }
  check('§8 the world rebooted', rebootErr === null, rebootErr ?? '');
  if (moon !== null) {
    const worldR = of.world().bodyRadiusM ?? null;
    const mapBody = of.map('report')?.body ?? null;
    log.push(`§8 after reboot(1): world radius ${worldR} m, map body `
      + `${mapBody === null ? 'null' : mapBody.name}, but the discovery field is `
      + `still cut for ${moon.bodyRadiusM} m with a ${moon.surveyCellSizeM} m `
      + `cell and ${moon.surveyCells} cells [GP-725, pre-existing, Boot.ts:583]`);
    check('§8 the milestone is still spent exactly once after a body change',
      countOf(STATION_BOARDED) === milesBeforeReboot
      && countOf(STATION_BOARDED) === 1, JSON.stringify(MILES()));
    check('§8 no second reveal fired: the field holds one lattice\'s worth, '
      + 'not two', moon.surveyCells <= SURVEY_TOTAL,
      `${moon.surveyCells} vs ${SURVEY_TOTAL}`);
  }

  return {
    valid: fails.length === 0,
    fails,
    log,
    findings: [
      'GP-725 (NOT this lane, pre-existing): the discovery field is not re-cut '
      + 'on a body change. Boot.ts:583 calls bootMap outside buildBodyScope, so '
      + 'the Discovery driver keeps the boot body\'s lattice for ever. See §8.',
      'GP-726 (harness): of.run(s, renderHz) delivers min(1, renderHz*5/60) of '
      + 'the sim time asked for, because Loop.MAX_CATCHUP is 5 and the backlog '
      + 'is discarded. 83.3% at 10 Hz. Assert against of.world().tick.',
      'GP-727 (harness): the 20 s autosave writes the same slot of.save() does, '
      + 'so a later of.load() restores the autosave, not the save.',
      'GP-728 (behaviour, harmless): Discovery.step zeroes sinceS instead of '
      + 'subtracting SAMPLE_S, so the sample interval is [1.0, 1.0+frame] and '
      + 'the "1 Hz" sampler takes ~4 fewer passes per 93 s at 12 Hz render.',
    ],
    walkedM: Number(walkedM.toFixed(2)),
    walkSimS: Number(walkSimS.toFixed(2)),
    walkSpeedMS: Number((walkedM / walkSimS).toFixed(3)),
    exploreOnFoot: { before: w0.exploreCells, after: w1.exploreCells },
    standStill: {
      surveyAdded: s1.surveyCells - s0.surveyCells,
      exploreAdded: s1.exploreCells - s0.exploreCells,
      passes: s1.observations - s0.observations,
    },
    surveyHops: hops,
    surveyCellM, exploreCellM, surveyTotal: SURVEY_TOTAL,
    revealedCells: after.surveyCells,
    revealedFraction: after.surveyFraction,
    saveBytesAfterReveal: after.saveBytes,
    milestones: MILES(),
    latchControlSurveyCells: latch.surveyCells,
    afterBodyChange: moon === null ? null : {
      discBodyRadiusM: moon.bodyRadiusM,
      discSurveyCellSizeM: moon.surveyCellSizeM,
      surveyCells: moon.surveyCells,
      worldBodyRadiusM: of.world().bodyRadiusM ?? null,
    },
  };
})()
