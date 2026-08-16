// CAN THE WALKER BE HELD UP BY A col_* PROXY WITH NO HEIGHTFIELD UNDER IT?
//
//   node tools/smoke/run.mjs --scenario=walk --sandbox=1 \
//        --evalfile=tools/smoke/probes/orbitdeck.js
//
// BT-175 SWEEP CORRECTION: this probe never carried a documented invocation
// at all, so `verdictOf()`'s first `run.mjs` match fell through to a prose
// sentence lower in this file, no --sandbox=1 flag reached the runner, and
// the probe's own opening guard (`if (!of.sandbox().sandbox) return { fail:
// 'run this with --sandbox=1', ... }`) failed every run. Exactly `clickonce.js`'s
// BT-11x precedent: a missing invocation flag, not a game defect.
//
// This is the measurement the space station question turns on. It was asked
// BEFORE any station existed, deliberately: if the answer had been no, then a
// station interior would have been a substantial piece of new walker work and
// nobody should have authored an asset against it yet.
//
// The premise being tested is that `KinematicBody.step` composes TWO floors and
// takes the higher: `groundR` starts as the terrain's answer and is replaced by
// `StructureBodies.deckUnder` when a structural top face is higher
// (KinematicBody.ts, the `onDeck` branch). Nothing in that composition mentions
// altitude. If that reading is right, then moving the deck from 2 m above the
// ground to 400 km above it changes NOTHING, because the terrain's answer is
// simply a much smaller number and loses the same comparison it was already
// losing.
//
// So the probe puts a corridor in ORBIT, out of the same `LocalBox` proxies a
// foundation is made of, and stands the player in it. The corridor is INJECTED
// rather than borrowed, and that is still the right shape for the question: the
// mechanism has to be provable without the shipped station, or a red run could
// never be told apart from a bad asset.
//
// BUT ITS CROSS SECTION IS NO LONGER TRANSCRIBED (PH-105). This probe used to
// hold 2.5 m clear width, 2.5 m clear headroom, 0.3 m walls and a 0.5 m deck as
// private constants and call them "the Blender lane's stated convention". They
// were the PLACEHOLDER's convention, and the shipped asset does not share one
// of them: `space_station.glb` runs 3.0 m clear and 4.0 m to the ceiling with
// 0.6 m walls, a 0.3 m deck and 0.8 m of overhead slab. A probe that keeps its
// own copy of a convention agrees with itself whatever the asset does, which is
// exactly the failure this file shipped and passed with, so the cross section
// is now READ off `of.station().proxyBoxes` by name and only the corridor's
// existence is the probe's own. The injected corridor runs along its own local
// Z while the shipped spine runs along local X; only the section is borrowed.
//
// SIX PROPERTIES:
//   P1 the player stands. Grounded, onDeck, and the feet radius is CONSTANT
//      over 300 stationary ticks. The spread is the result, in metres.
//   P2 the radius they stand at IS the floor box's own top face, found by
//      bisecting `__of.solidBuild`, the walker's own collision predicate.
//      Not a number recomputed in the probe from the box we authored.
//   P3 NEGATIVE CONTROL. The same point with the corridor REMOVED. The player
//      must fall, and fall far. Without this, P1 proves only that something
//      held the player up, and "something" includes the terrain 400 km below
//      answering wrongly.
//   P4 a driven walk along the corridor stays on the deck at every grounded
//      tick, and actually travels.
//   P5 a driven walk INTO a wall is refused (`blockedByBuild`) and does not
//      leave the corridor.
//   P6 headroom, against the SHIPPED number rather than against a remembered
//      one, plus the capsule sample-gap control that explains what a ceiling
//      has to be thicker than.
//
// RUN IN SANDBOX (--sandbox=1): this places nothing and spends nothing, but the
// walk scenario's harvesting economy is noise here, same argument as
// probes/decksink.js.
//
// RETURNS THE PLAYER TO THE GROUND BEFORE IT RESOLVES. PH-89: run.mjs settles
// on `terrain.report().converged`, and an observer parked 400 km up with the
// streamer chasing it is a runner that never exits. Every early return goes
// through `home()` for the same reason.
(async () => {
  const of = window.__of;
  const A = (typeof OF_ARGS === 'object' && OF_ARGS !== null) ? OF_ARGS : {};
  const ALT_M = Number(A.altM ?? 400000);
  const log = [];
  const r6 = (x) => (Number.isFinite(x) ? Number(x.toFixed(6)) : null);
  const len = (p) => Math.hypot(p[0], p[1], p[2]);
  const yield0 = () => new Promise((r) => { setTimeout(r, 0); });

  if (!of.sandbox().sandbox) return { fail: 'run this with --sandbox=1', log };
  if (typeof of.standAt !== 'function') {
    return { fail: 'no __of.standAt: rebuild the client', log };
  }
  if (typeof of.stand !== 'function') return { fail: 'no __of.stand', log };
  if (typeof of.station !== 'function') return { fail: 'no __of.station: rebuild', log };
  const structures = of.structures();
  if (structures === null || structures === undefined) {
    return { fail: 'no structural layer', log };
  }

  // --- the corridor's SECTION, read off the shipped spine ------------------
  // By name, never by coordinate. `col_SpineFwdFloor` is one of the two 20 m
  // runs of the station's spine and it carries every number this probe used to
  // keep privately: the clear width in its z span, the deck thickness in its y
  // span, the headroom in the gap up to the ceiling proxy, the wall thickness
  // in the side proxy's z span and the overhead slab in the ceiling's y span.
  await of.run(0.8, 60);
  const sta = of.station();
  if (sta === null) return { fail: 'no station record: nothing to read a section off', log };
  if (sta.proxies === 0) return { fail: 'no proxies learned: the glb did not load', log };
  const byName = new Map(sta.proxyBoxes.map((b) => [b.name, b]));
  const need = ['col_SpineFwdFloor', 'col_SpineFwdCeil', 'col_SpineFwdWallL'];
  const missing = need.filter((n) => !byName.has(n));
  if (missing.length > 0) return { fail: 'asset is missing proxies', missing, log };
  const spine = byName.get('col_SpineFwdFloor');
  const spineCeil = byName.get('col_SpineFwdCeil');
  const spineWall = byName.get('col_SpineFwdWallL');

  const HALF_W = spine.max[2];                                  // clear half width
  const DECK_T = spine.max[1] - spine.min[1];                   // slab thickness
  const HEAD = spineCeil.min[1] - spine.max[1];                 // clear headroom
  const WALL_T = spineWall.max[2] - spineWall.min[2];            // wall thickness
  const CEIL_T = spineCeil.max[1] - spineCeil.min[1];            // overhead slab
  const HALF_L = (spine.max[0] - spine.min[0]) / 2;             // run length
  const section = {
    from: 'col_SpineFwd*',
    clearWidthM: r6(HALF_W * 2),
    clearHeadroomM: r6(HEAD),
    deckThickM: r6(DECK_T),
    wallThickM: r6(WALL_T),
    ceilingThickM: r6(CEIL_T),
    runLengthM: r6(HALF_L * 2),
  };
  log.push({ section });
  if (!(HALF_W > 0 && DECK_T > 0 && HEAD > 0 && WALL_T > 0 && CEIL_T > 0 && HALF_L > 1)) {
    return { fail: 'the shipped section does not describe a corridor', section, log };
  }

  // --- the corridor, in its own frame, +Y up, floor top face at y = 0 -------
  const boxes = [
    { name: 'col_Deck', min: [-HALF_W, -DECK_T, -HALF_L], max: [HALF_W, 0, HALF_L] },
    { name: 'col_WallXneg', min: [-HALF_W - WALL_T, 0, -HALF_L], max: [-HALF_W, HEAD, HALF_L] },
    { name: 'col_WallXpos', min: [HALF_W, 0, -HALF_L], max: [HALF_W + WALL_T, HEAD, HALF_L] },
    { name: 'col_CapZneg', min: [-HALF_W - WALL_T, 0, -HALF_L - WALL_T], max: [HALF_W + WALL_T, HEAD, -HALF_L] },
    { name: 'col_CapZpos', min: [-HALF_W - WALL_T, 0, HALF_L], max: [HALF_W + WALL_T, HEAD, HALF_L + WALL_T] },
    { name: 'col_Ceiling', min: [-HALF_W - WALL_T, HEAD, -HALF_L], max: [HALF_W + WALL_T, HEAD + CEIL_T, HALF_L] },
  ].map((b) => ({ min: b.min, max: b.max, leaf: false, name: b.name }));

  let bound = 0;
  for (const b of boxes) {
    for (const c of [b.min, b.max]) bound = Math.max(bound, len(c));
  }

  const fail = async (why, extra) => { await home(); return { fail: why, ...extra, log }; };

  // --- where the ground is, and therefore where orbit is -------------------
  const feet0 = of.world().player.feet.slice();
  const rGround = len(feet0);
  const u = [feet0[0] / rGround, feet0[1] / rGround, feet0[2] / rGround];
  const rStation = rGround + ALT_M;

  // The quaternion taking local +Y onto the radial, so the deck is horizontal
  // in exactly the sense the walker means by horizontal. This is the ONLY
  // orientation that works and the reason is P1's whole finding: `deckUnder`
  // solves along the radial through the planet centre, so a deck is a floor to
  // the degree that its top face is perpendicular to that radial.
  const quatYTo = (v) => {
    const d = v[1];
    if (d > 1 - 1e-12) return { x: 0, y: 0, z: 0, w: 1 };
    if (d < -1 + 1e-12) return { x: 1, y: 0, z: 0, w: 0 };
    // axis = (0,1,0) x v = (vz, 0, -vx); half-angle form avoids the trig.
    //
    // THE SIGN HERE WAS WRONG ON THE FIRST RUN AND P2 IS THE ONLY REASON IT
    // WAS CAUGHT. The conjugate rotates the radial onto +Y instead of +Y onto
    // the radial, which for a corridor lying along its own long axis simply
    // turns the deck UPSIDE DOWN: the player then stands on the slab's bottom
    // face and every one of P1's assertions still passes, because a floor
    // upside down is still a floor. The tell was `deckR - rStation = 0.501221`,
    // one DECK_T, in a run that otherwise read perfect.
    const ax = v[2], ay = 0, az = -v[0];
    const s = Math.sqrt((1 + d) * 2);
    return { x: ax / s, y: ay / s, z: az / s, w: s / 2 };
  };
  const quat = quatYTo(u);
  const pos = { x: u[0] * rStation, y: u[1] * rStation, z: u[2] * rStation };

  const solid = {
    id: 424242, pos, quat, boxes,
    cx: pos.x, cy: pos.y, cz: pos.z, cr: bound, shut: true,
  };

  const addStation = () => { structures.bodies.add(solid); };
  const dropStation = () => { structures.bodies.remove((q) => q === solid); };

  /** Back to the ground, camera and all. See the header. */
  const home = async () => {
    dropStation();
    of.input.tape([{ hold: 60, keys: [] }]);
    of.standAt(feet0[0], feet0[1], feet0[2]);
    await of.run(0.5, 60);
    await yield0();
  };

  /** Hold keys for `secs` with the stand trace armed, and return the samples. */
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
    if (xs.length === 0) return { n: 0, min: null, max: null, spread: null };
    let lo = Infinity, hi = -Infinity;
    for (const x of xs) { if (x < lo) lo = x; if (x > hi) hi = x; }
    return { n: xs.length, min: r6(lo), max: r6(hi), spread: r6(hi - lo) };
  };

  // =========================================================================
  // P1. STAND ON IT.
  // =========================================================================
  addStation();
  // Half a metre above the deck, at the middle of the corridor. A drop rather
  // than a placement, so the landing is the walker's own and not the probe's.
  of.standAt(u[0] * (rStation + 0.5), u[1] * (rStation + 0.5), u[2] * (rStation + 0.5));
  const s1 = await drive(5.0, []);
  if (s1.length < 100) return fail('P1: too few ticks traced', { n: s1.length });
  // Discard the fall: the first grounded tick onward is the standing regime.
  const g0 = s1.findIndex((s) => s.grounded);
  if (g0 < 0) {
    return fail('P1 FAILED: the walker never landed on a deck in orbit', {
      altM: ALT_M, rStation: r6(rStation),
      lastFeetR: r6(s1[s1.length - 1].feetR),
      fellM: r6(len(feet0) + ALT_M + 0.5 - s1[s1.length - 1].feetR),
      sample: s1.slice(-3),
    });
  }
  const stand = s1.slice(g0 + 5);
  const p1 = {
    landedAfterTicks: g0,
    feetR: stats(stand.map((s) => s.feetR)),
    onDeckTicks: stand.filter((s) => s.onDeck).length,
    groundedTicks: stand.filter((s) => s.grounded).length,
    ticks: stand.length,
    terrainR: r6(stand[0].terrainR),
    deckR: r6(stand[0].deckR),
    groundR: r6(stand[0].groundR),
  };
  log.push({ P1: p1 });
  if (p1.onDeckTicks !== p1.ticks) {
    return fail('P1: onDeck was not held every standing tick', p1);
  }
  if (p1.groundedTicks !== p1.ticks) {
    return fail('P1: grounded was not held every standing tick', p1);
  }
  if (!(p1.feetR.spread <= 1e-6)) {
    return fail('P1: the feet radius is not constant while standing still', p1);
  }
  // The terrain's answer must be the GROUND, hundreds of km below, and must
  // have lost the comparison. If terrainR is anywhere near the feet then
  // something other than the deck is holding the player up and P1 proves
  // nothing about structures.
  if (!(p1.groundR - p1.terrainR > ALT_M * 0.9)) {
    return fail('P1: the terrain answer is not far below; the deck is not the '
      + 'thing holding the player up', p1);
  }

  // =========================================================================
  // P2. THE RADIUS IS THE BOX'S OWN TOP FACE, found on the walker's predicate.
  // =========================================================================
  const solidAt = (r) => of.solidBuild(u[0] * r, u[1] * r, u[2] * r);
  // The bracket is half the SHIPPED slab, so a thinner deck cannot silently put
  // the "interior" sample in the vacuum underneath it. The old fixed 0.25 m
  // would have done exactly that against a 0.3 m slab if it had ever grown.
  const BR = DECK_T * 0.5;
  if (!solidAt(rStation - BR)) return fail('P2: the deck interior does not read solid', { BR: r6(BR) });
  if (solidAt(rStation + BR)) return fail('P2: the air above the deck reads solid', { BR: r6(BR) });
  let lo = rStation - BR, hi = rStation + BR;
  for (let i = 0; i < 60; ++i) {
    const mid = (lo + hi) / 2;
    if (solidAt(mid)) lo = mid; else hi = mid;
  }
  const topFace = hi;
  const p2 = { topFace: r6(topFace), feetR: p1.feetR.min, bracketM: r6(BR),
    deltaM: r6(p1.feetR.min - topFace) };
  log.push({ P2: p2 });
  if (Math.abs(p2.deltaM) > 1e-6) {
    return fail('P2: the player is not standing on the deck top face', p2);
  }

  // =========================================================================
  // P3. NEGATIVE CONTROL. Same point, no corridor. The player must fall.
  // =========================================================================
  dropStation();
  of.standAt(u[0] * (rStation + 0.5), u[1] * (rStation + 0.5), u[2] * (rStation + 0.5));
  const s3 = await drive(3.0, []);
  const fellTo = s3[s3.length - 1].feetR;
  const p3 = {
    fellM: r6((rStation + 0.5) - fellTo),
    grounded: s3.filter((s) => s.grounded).length,
    onDeck: s3.filter((s) => s.onDeck).length,
    ticks: s3.length,
  };
  log.push({ P3: p3 });
  if (p3.onDeck !== 0) return fail('P3: onDeck with no structure placed', p3);
  if (p3.grounded !== 0) return fail('P3: grounded with nothing under the player', p3);
  // Three seconds of the local gravity is the honest expectation. Half of it is
  // a deliberately loose floor: the claim being tested is "falls", not "falls
  // at exactly g".
  const gHere = of.gravity(rStation);
  const expect = 0.5 * gHere * 3 * 3;
  if (!(p3.fellM > expect * 0.5)) {
    return fail('P3: the player did NOT fall with the corridor removed, so P1 '
      + 'did not measure the corridor', { ...p3, gHere: r6(gHere), expect: r6(expect) });
  }

  // =========================================================================
  // P4. WALK ALONG IT. P5. WALK INTO A WALL.
  // =========================================================================
  addStation();
  of.standAt(u[0] * (rStation + 0.5), u[1] * (rStation + 0.5), u[2] * (rStation + 0.5));
  await drive(1.5, []);

  // SOLVE for the corridor's heading rather than sweeping for it. The first
  // version of this probe swept four yaws and kept the furthest, and every one
  // of them travelled about 2 m: the minimal rotation taking local +Y onto the
  // radial leaves local X and Z anywhere in the tangent plane, so 0/90/180/270
  // sampled four directions that all crossed the corridor's width at an angle.
  // A sweep that never runs the corridor cannot tell "the walker cannot walk"
  // from "the walker was never pointed down the hall".
  const qrot = (q, v) => {
    // v + 2 * qv x (qv x v + w v)
    const tx = q.y * v[2] - q.z * v[1] + q.w * v[0];
    const ty = q.z * v[0] - q.x * v[2] + q.w * v[1];
    const tz = q.x * v[1] - q.y * v[0] + q.w * v[2];
    return [
      v[0] + 2 * (q.y * tz - q.z * ty),
      v[1] + 2 * (q.z * tx - q.x * tz),
      v[2] + 2 * (q.x * ty - q.y * tx),
    ];
  };
  // The walker's own tangent basis (ViewSource.tangentFrame): east = Y x up,
  // north = up x east, and the heading is north*cos(yaw) + east*sin(yaw)
  // (Controller.step). So a body-frame direction inverts to a yaw exactly.
  let east = [1 * u[2] - 0, 0, 0 - 1 * u[0]];
  const el = len(east);
  if (el < 1e-9) east = [1, 0, 0]; else east = east.map((c) => c / el);
  const north = [
    u[1] * east[2] - u[2] * east[1],
    u[2] * east[0] - u[0] * east[2],
    u[0] * east[1] - u[1] * east[0],
  ];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const yawOf = (d) => (Math.atan2(dot(d, east), dot(d, north)) * 180) / Math.PI;
  const axisAlong = qrot(quat, [0, 0, 1]);
  const axisAcross = qrot(quat, [1, 0, 0]);
  const yawAlong = yawOf(axisAlong);
  const yawAcross = yawOf(axisAcross);
  // The corridor is horizontal by construction, so its two axes must lie in the
  // tangent plane. If they do not, the orientation is wrong and every distance
  // below would be measured along a ramp.
  const tilt = { along: r6(dot(axisAlong, u)), across: r6(dot(axisAcross, u)) };
  log.push({ heading: { yawAlong: r6(yawAlong), yawAcross: r6(yawAcross), tilt } });
  if (Math.abs(tilt.along) > 1e-9 || Math.abs(tilt.across) > 1e-9) {
    return fail('the corridor is not perpendicular to the radial', { tilt });
  }

  /** Where a body-frame point sits in the corridor's OWN frame. */
  const local = (p) => {
    const d = [p[0] - pos.x, p[1] - pos.y, p[2] - pos.z];
    return qrot({ x: -quat.x, y: -quat.y, z: -quat.z, w: quat.w }, d);
  };

  const leg = async (label, yaw, secs) => {
    of.standAt(u[0] * (rStation + 0.2), u[1] * (rStation + 0.2), u[2] * (rStation + 0.2));
    await drive(0.6, []);
    of.look(yaw, 0);
    const p0 = of.world().player.feet.slice();
    const s = await drive(secs, ['KeyW']);
    const p1f = of.world().player.feet.slice();
    const g = s.filter((q) => q.grounded);
    const l1 = local(p1f);
    return {
      label, yaw: r6(yaw),
      travelledM: r6(Math.hypot(p1f[0] - p0[0], p1f[1] - p0[1], p1f[2] - p0[2])),
      commandedM: r6(4.6 * secs),
      blockedTicks: s.filter((q) => q.blockedByBuild).length,
      onDeckFrac: r6(g.length === 0 ? 0 : g.filter((q) => q.onDeck).length / g.length),
      feetR: stats(g.map((q) => q.feetR)),
      airborneTicks: s.filter((q) => !q.grounded).length,
      endLocal: { x: r6(l1[0]), y: r6(l1[1]), z: r6(l1[2]) },
    };
  };

  const runLeg = await leg('along the corridor', yawAlong, 2.0);
  const wallLeg = await leg('into the side wall', yawAcross, 2.0);
  log.push({ P4: runLeg, P5: wallLeg });

  // Half the commanded distance is a deliberately lenient floor: the claim is
  // "the player walks", not "the player walks at exactly the catalogue speed".
  if (!(runLeg.travelledM > runLeg.commandedM * 0.5)) {
    return fail('P4: the player could not walk along the corridor', { runLeg });
  }
  if (runLeg.onDeckFrac !== 1) {
    return fail('P4: the player left the deck while walking along it', { runLeg });
  }
  if (!(runLeg.feetR.spread <= 1e-4)) {
    return fail('P4: the standing radius moved while walking a flat deck', { runLeg });
  }
  // THE WALL TEST IS CONTAINMENT, NOT REFUSAL. `blockedByBuild` is
  // `resolveStep`'s LAST resort and a wall met at any angle slides instead, so
  // asserting the flag would be asserting a failure mode rather than the
  // property. What the player needs is that the wall keeps them in the
  // corridor, so that is what is measured: the local X coordinate after two
  // seconds of walking straight at it, against the SHIPPED clear half width.
  if (!(Math.abs(wallLeg.endLocal.x) <= HALF_W + 1e-3)) {
    return fail('P5: the player walked THROUGH the corridor wall', { wallLeg,
      clearHalfWidthM: HALF_W });
  }
  if (wallLeg.onDeckFrac !== 1) {
    return fail('P5: the player left the deck at the wall', { wallLeg });
  }

  // =========================================================================
  // P6. HEADROOM, measured rather than assumed, because the Blender lane is
  //     authoring to a number and the placeholder's 2.5 m turned out to have
  //     none. The shipped 4.0 m is the number under test now.
  // =========================================================================
  // 1.65 m is the walker's TOPMOST structural sample (CAPSULE_SAMPLES_M); the
  // capsule's 1.8 m height and 0.4 m radius are NOT what collides with a
  // structure. The three samples are 0.75 m apart, and that spacing is the
  // whole of the ceiling control below.
  const TOP_SAMPLE_M = 1.65;
  const SAMPLE_GAP_M = 0.75;

  /**
   * Jump for 1.5 s under a ceiling of the given thickness at the given clear
   * height, and report. `thickM === 0` removes the ceiling entirely, which is
   * the only way to see the FREE apex: with any ceiling present the rise stops
   * at the height where the topmost capsule sample meets its underside, and
   * reading that as an apex is how this probe twice reported a jump speed the
   * walker does not have.
   */
  const jumpUnder = async (thickM, headM) => {
    dropStation();
    const ceil = boxes.find((b) => b.name === 'col_Ceiling');
    ceil.min[1] = thickM === 0 ? 1e9 : headM;
    ceil.max[1] = thickM === 0 ? 1e9 + CEIL_T : headM + thickM;
    addStation();
    of.standAt(u[0] * (rStation + 0.2), u[1] * (rStation + 0.2), u[2] * (rStation + 0.2));
    await drive(0.6, []);
    const sj = await drive(1.5, ['Space']);
    const apexM = Math.max(...sj.map((q) => q.feetR)) - rStation;
    const endY = local(of.world().player.feet.slice())[1];
    return {
      ceilingHeadM: r6(headM),
      ceilingThickM: r6(thickM),
      ceilingSpanM: [r6(headM), r6(headM + thickM)],
      jumpApexM: r6(apexM),
      endLocalY: r6(endY),
      escaped: endY > headM - 1e-3,
      blockedTicks: sj.filter((q) => q.blockedByBuild).length,
    };
  };

  // FREE: no ceiling at all, the true v^2/2g.
  const free = await jumpUnder(0, HEAD);
  // THE CONTROL CEILING IS HUNG WHERE THE JUMP REACHES IT, and it has to be,
  // because the shipped 4.0 m of headroom is more than the walker can reach:
  // running the leak control at the authored height would report "contained"
  // for a ceiling nothing ever touched and call that a result. Half the free
  // apex above the topmost sample is a height the rise passes with room on both
  // sides, and it is derived from the measurement rather than picked.
  const ctrlHead = TOP_SAMPLE_M + free.jumpApexM * 0.5;
  // THIN is under the capsule's sample spacing, THICK is the slab the asset
  // actually ships. The pair is the assertion: if the thick one leaks too then
  // the mechanism is not the spacing and the whole reading is wrong.
  const thin = await jumpUnder(SAMPLE_GAP_M * 0.5, ctrlHead);
  const thick = await jumpUnder(CEIL_T, ctrlHead);
  // Restore the shipped geometry so nothing downstream reads the control's.
  dropStation();
  const ceilBox = boxes.find((b) => b.name === 'col_Ceiling');
  ceilBox.min[1] = HEAD; ceilBox.max[1] = HEAD + CEIL_T;

  const gStation = of.gravity(rStation);
  const gGround = of.gravity(rGround);
  // The walker's jump impulse, recovered from the FREE apex rather than recited
  // from CAPSULE.jumpSpeedMps, which no probe can read.
  const vJump = Math.sqrt(2 * gStation * free.jumpApexM);
  const apexGround = (vJump * vJump) / (2 * gGround);
  const p6 = {
    freeApexM: r6(free.jumpApexM),
    impliedJumpSpeedMps: r6(vJump),
    topSampleM: TOP_SAMPLE_M,
    sampleGapM: SAMPLE_GAP_M,
    // WHAT THE ASSET NEEDS: clear headroom must exceed the apex plus the
    // topmost sample, or a jumping player meets the ceiling.
    headroomNeededAtStationM: r6(free.jumpApexM + TOP_SAMPLE_M),
    headroomNeededAtGroundM: r6(apexGround + TOP_SAMPLE_M),
    shippedHeadroomM: r6(HEAD),
    shippedCeilingThickM: r6(CEIL_T),
    marginAtStationM: r6(HEAD - (free.jumpApexM + TOP_SAMPLE_M)),
    marginAtGroundM: r6(HEAD - (apexGround + TOP_SAMPLE_M)),
    // The height a ceiling stops the rise at, which is NOT an apex.
    controlHeadM: r6(ctrlHead),
    controlContactFeetM: r6(ctrlHead - TOP_SAMPLE_M),
    thinCeiling: thin,
    thickCeiling: thick,
    gStationMps2: r6(gStation),
    gGroundMps2: r6(gGround),
  };
  log.push({ P6: p6 });
  // THE CONTROL IS THE ASSERTION. A ceiling thicker than the capsule sample gap
  // must hold; if the thick one leaks too then the mechanism is not the spacing
  // and this whole reading is wrong.
  if (thick.escaped) {
    return fail('P6: a ceiling thicker than the capsule sample gap did not '
      + 'contain the jump, so the thin-ceiling leak is NOT explained by the '
      + 'sample spacing', p6);
  }

  // Gravity here, so "down" is a measured number in the report rather than an
  // assumption about what a station in orbit feels like.
  const gravity = {
    rStation: r6(rStation), altM: ALT_M,
    gSurfaceMps2: r6(of.gravity(rGround)),
    gStationMps2: r6(gHere),
    upIsRadial: true,
  };
  log.push({ gravity });

  await home();
  const backR = len(of.world().player.feet);
  return {
    ok: true,
    altM: ALT_M,
    section,
    P1: p1, P2: p2, P3: p3, P4: runLeg, P5: wallLeg, P6: p6,
    gravity,
    returnedToGroundM: r6(Math.abs(backR - rGround)),
    log,
  };
})()
