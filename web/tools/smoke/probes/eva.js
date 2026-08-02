// EVA FROM A ROCKET (PH-109, PH-110, R54).
//
// Reid: "if I did an EVA outside of my rocket you should float around like you
// would in real life." PH-102 shipped the STRUCTURE half and named this one as
// owed, because `takeControlRemote` and `climbIn` only swap the camera and
// leave the body parked, so there was no "get out here".
//
// THIS PROBE MUST BE RUN ON A VESSEL THAT IS ALREADY IN ORBIT. It does not fly
// the ascent, because a probe that flew its own ascent would be re-testing
// `ascent.js` and would take eighty seconds to reach its first assertion.
// `evaorbit.mjs` is the runner: it drives `flyto.js --phase=orbit` and then
// hands the page to this file.
//
// THE ASSERTION THAT MATTERS IS E4, and it is the one that would have been easy
// to leave out. Floating beside a rocket looks right in a screenshot whether or
// not the rocket is still there a moment later, and the reason this feature was
// believed to be blocked is the belief that it would NOT be: a vessel in orbit
// does 7.8 km/s, the walker integrates an absolute position with no carrier
// term, so the two should separate at 125 m per tick. E4 measures the
// separation over three seconds and requires it to be zero, which is a claim
// about `FlightMode` not stepping an unoccupied vessel and not a claim about
// this lane's own code.
(async () => {
  const of = window.__of;
  const log = [];
  const r6 = (x) => (Number.isFinite(x) ? Number(x.toFixed(6)) : null);
  const yield0 = () => new Promise((r) => { setTimeout(r, 0); });
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

  const settle = async (secs) => {
    of.input.tape([{ hold: Math.ceil(secs * 60) + 120, keys: [] }]);
    await of.run(secs, 60);
    of.input.tape([{ hold: 1, keys: [] }]);
    await yield0();
  };

  for (const k of ['flight', 'weight', 'world', 'run']) {
    if (typeof of[k] !== 'function') return { fail: `no __of.${k}: rebuild` };
  }
  const feet = () => of.world().player.feet.slice();
  /**
   * WHERE THE VESSEL IS, ASKED OF BOTH AUTHORITIES, because the first driven
   * run of this probe proved they can disagree.
   *
   * `railsAt` solves the RECORD's conic at a tick. `report().flight.pos` is the
   * live `/core` FlightSim's own state. They are two answers to one question and
   * PH-111 exists because they had drifted 6829.55 m apart in three seconds: the
   * sim was frozen (nothing steps a vessel with nobody aboard) and the record
   * was not (a stamped record's clock runs with the world's). A probe that asked
   * only one of them would have reported either a perfect pass or a total
   * failure, and neither would have been the truth.
   */
  const recordPos = () => {
    const r = of.flight('railsAt');
    return r && r.pos ? r.pos.slice() : null;
  };
  const simPos = () => {
    const f = of.flight('report').flight;
    return f && f.pos ? f.pos.slice() : null;
  };
  const vesselPos = simPos;

  // ------------------------------------------------------------------ E1 ----
  // PRECONDITIONS, asserted rather than assumed, because every number after
  // this one is meaningless if the runner did not actually reach orbit.
  const rep0 = of.flight('report');
  const rails0 = of.flight('railsAt');
  const e1 = {
    aboard: rep0.aboard,
    mode: rails0 === null ? null : rails0.mode,
    altKm: r6((Math.hypot(...(vesselPos() ?? [0, 0, 0])) - of.world().bodyRadiusM) / 1000),
  };
  log.push({ leg: 'E1 preconditions', ...e1 });
  if (e1.aboard !== true) return { fail: 'E1: not aboard, run this through evaorbit.mjs', e1, log };
  if (e1.mode !== 'rails') {
    return { fail: `E1: the vessel is ${e1.mode}, not on rails`, e1, log };
  }

  // ------------------------------------------------------------------ E2 ----
  // OUT. The refusal path is proved on the PAD by the runner before the flight;
  // here the vessel is coasting in vacuum on a conic, which is the one state
  // `mayLeave` permits, so `canEva` must be true and the door must open.
  const before = vesselPos();
  const r = of.flight('eva');
  const rep1 = of.flight('report');
  await settle(0.5);
  const w1 = of.weight();
  const p1 = feet();
  const e2 = {
    may: r.may, ok: r.ok, eva: r.eva,
    aboard: rep1.aboard,
    evas: rep1.evas,
    carrierG: r.gravity === null ? null : r6(r.gravity.carrierG),
    halfM: r.gravity === null ? null : r.gravity.halfM,
    // The body is BESIDE the hull, not inside it and not on the ground.
    standoffM: r6(dist(p1, before)),
    altKm: r6((Math.hypot(p1[0], p1[1], p1[2]) - of.world().bodyRadiusM) / 1000),
    trueG: r6(w1.trueG),
    apparentG: r6(w1.apparentG),
    floating: w1.floating,
    weightless: w1.weightless,
    grounded: w1.grounded,
    inVolumes: w1.inVolumes.map((v) => v.mode),
  };
  log.push({ leg: 'E2 out', ...e2 });
  if (e2.may !== true) return { fail: 'E2: canEva refused an on-rails vessel', e2, log };
  if (e2.ok !== true) return { fail: 'E2: evaOut refused', e2, log };
  if (e2.aboard !== false) return { fail: 'E2: still aboard after an EVA', e2, log };
  // THE WHOLE POINT. The true gravity out here is real and large; what the body
  // WEIGHS is not, and the difference is the carrier's freefall.
  if (!(e2.trueG > 5)) return { fail: 'E2: not high enough for this to mean anything', e2, log };
  if (!e2.floating) return { fail: 'E2: the player is not floating beside the rocket', e2, log };
  if (Math.abs(e2.apparentG) > w1.floatG) {
    return { fail: 'E2: apparent gravity is above the float gate', e2, log };
  }

  // ------------------------------------------------------------------ E3 ----
  // STILL IN REACH. If the standoff put the body outside `BOARD_RANGE_M` the
  // player could never get back in, which would be a spacewalk with no return
  // and strictly worse than no spacewalk.
  const e3 = { boardRangeM: 18, distanceM: r6(of.flight('report').distanceToVesselM ?? -1) };
  log.push({ leg: 'E3 reach', ...e3 });

  // ------------------------------------------------------------------ E4 ----
  // THE VESSEL DOES NOT LEAVE WITHOUT YOU, which is the assertion that decides
  // whether this feature is real. See the header.
  const v0 = simPos(); const q0 = recordPos();
  const b0 = feet();
  await settle(3.0);
  const v1 = simPos(); const q1 = recordPos();
  const b1 = feet();
  const e4 = {
    simMovedM: r6(dist(v0, v1)),
    recordMovedM: r6(dist(q0, q1)),
    bodyDriftM: r6(dist(b0, b1)),
    separationBeforeM: r6(dist(b0, v0)),
    separationAfterM: r6(dist(b1, v1)),
    // THE TWO AUTHORITIES MUST AGREE, and this is the assertion PH-111 added.
    // It was 6829.55 m before the record was un-stamped.
    simVsRecordM: r6(dist(v1, q1)),
    // What it WOULD have been if the vessel had kept flying: three seconds at
    // orbital speed. Published so the zeros above have something to be zero
    // against, and it is a large number on purpose.
    wouldHaveBeenM: r6(Math.hypot(...(of.flight('railsAt').vel ?? [0, 0, 0])) * 3.0),
  };
  log.push({ leg: 'E4 station-keeping', ...e4 });
  if (!(e4.simMovedM < 0.001)) {
    return { fail: 'E4: the live sim moved while nobody was aboard', e4, log };
  }
  if (!(e4.recordMovedM < 0.001)) {
    return { fail: 'E4: the RECORD advanced while the sim it describes sat still', e4, log };
  }
  if (!(e4.simVsRecordM < 1.0)) {
    return { fail: 'E4: the sim and the record disagree about where the rocket is', e4, log };
  }
  if (!(e4.bodyDriftM < 0.05)) {
    return { fail: 'E4: the body drifted with nothing pushing it', e4, log };
  }

  // ------------------------------------------------------------------ E5 ----
  // MOMENTUM IS KEPT. Thrust, release, and coast two equal legs. In freefall the
  // command is a thrust with a governor and NOT a velocity servo (PH-99); this
  // is the assertion that catches anyone putting the servo back.
  of.input.tape([{ hold: 180, keys: ['KeyW'] }]);
  await of.run(2.0, 60);
  of.input.tape([{ hold: 1, keys: [] }]);
  await yield0();
  const k0 = feet();
  await settle(2.0);
  const k1 = feet();
  await settle(2.0);
  const k2 = feet();
  const e5 = {
    coast1M: r6(dist(k0, k1)),
    coast2M: r6(dist(k1, k2)),
    equal: r6(Math.abs(dist(k0, k1) - dist(k1, k2))),
  };
  log.push({ leg: 'E5 coast', ...e5 });
  if (!(e5.coast1M > 0.5)) return { fail: 'E5: the body stopped dead: the servo is back', e5, log };

  // ------------------------------------------------------------------ E6 ----
  // BACK IN. Put the body back beside the hull (the coast above deliberately
  // carried it away) and press the board key's own path.
  const back = of.flight('eva').gravity;
  const stand = back === null ? null : back.pos;
  if (stand !== null) of.standAt(stand[0], stand[1], stand[2]);
  await settle(0.5);
  const dIn = of.flight('report').distanceToVesselM;
  of.flight('board');
  await settle(0.5);
  const rep2 = of.flight('report');
  const w2 = of.weight();
  const e6 = {
    distanceBeforeBoardingM: r6(dIn ?? -1),
    aboard: rep2.aboard,
    boardings: rep2.boardings,
    // THE VOLUME MUST GO WITH THE SPACEWALK. Left behind it would be a 60 m
    // bubble of freefall parked in the sky, silently weightless for anyone who
    // later passed through it.
    evaStillActive: of.flight('report').evaActive,
    apparentG: r6(w2.apparentG),
    trueG: r6(w2.trueG),
  };
  log.push({ leg: 'E6 back in', ...e6 });
  if (e6.aboard !== true) return { fail: 'E6: could not get back into the rocket', e6, log };

  // ------------------------------------------------------------------ E7 ----
  // AND THE SKY IS ORDINARY AGAIN. Ask the field about the point the EVA
  // happened at, with nobody outside: with the volume removed, apparent gravity
  // there must be the true local value bit for bit. This is what turns E2's
  // zero into a claim about a volume rather than about altitude.
  const probeAt = stand ?? feet();
  const wq = of.weight(probeAt[0], probeAt[1], probeAt[2]);
  const e7 = {
    apparentG: r6(wq.apparentG),
    trueG: r6(wq.trueG),
    restoredExactly: wq.restoredExactly,
    volumes: wq.inVolumes.map((v) => v.mode),
  };
  log.push({ leg: 'E7 the volume is gone', ...e7 });
  if (!e7.restoredExactly) {
    return { fail: 'E7: a freefall volume was left behind in the sky', e7, log };
  }

  return { pass: true, e1, e2, e3, e4, e5, e6, e7, log };
})()
