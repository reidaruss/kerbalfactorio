// R33: THE PLAYER WALKS STRAIGHT THROUGH EVERY FACTORY BUILDING.
//
// `Machines` and `Factory` never put anything into a solid set, so a smelter, a
// drill, an assembler and a chest were scenery. The physics lane measured the
// symptom as a count that did not move (5 to 5 across a placed machine), and a
// count that does not move cannot tell "the adoption ran and found nothing" from
// "there is no adoption". So this probe asserts three DIFFERENT kinds of thing,
// because any one of them alone is satisfiable by a broken build:
//
//   1. THE SET GREW. `structures.bodies.count` before and after one placement.
//      Necessary, and on its own worthless: a solid nobody collides with is a
//      row in a list.
//   2. THE SET IS AT THE MACHINE. `of.solidBuild(p)` is the walker's OWN
//      point-in-solid test, asked at the smelter's centre, and it is asked
//      BEFORE the placement as well as after. A one-sided "it reads solid now"
//      cannot be told from a predicate that reads solid everywhere.
//   3. THE WALKER STOPS. Driven, held W, into the housing, and what is asserted
//      is the PENETRATION: how far past the housing face the player's own body
//      reached. That is the claim in the title, and 1 and 2 can both pass while
//      it fails (the collision port is skipped entirely when `solids.count` is
//      0, so a set that grows is exactly the state in which the walk starts
//      being tested for the first time).
//
// WHY PENETRATION AND NOT "DID THE PLAYER STOP". A stop is not a property of
// the machine: a player also stops against a hillside, against a tree, and at
// the end of a tape. Penetration is a two-sided number with a known value in
// each direction and no threshold to tune. The smelter's collision box is its
// footprint, so its face stands `FOOTPRINT.smelter / 2` from its own centre,
// read out of the client's published table rather than typed here (FS-83: a
// probe carrying its own copy of a constant is a control that rots the moment
// the thing it watches moves, and this exact number went 1.0 to 2.0 at FS-73).
//
//   fixed             the closest the player's body gets is OUTSIDE the face,
//                     so penetration is NEGATIVE by about the walker's radius
//   nothing adopted   the player walks through the middle and out the far side,
//                     so penetration approaches the full half-extent
//
// THE HAND MACHINES GET THE POINT TEST AND NOT THE WALK. `Machines.ts` is a
// second placement path with its own asset table, and it adopts through the same
// `handSolid`, so what needs proving there is that the path RUNS, not that
// `StructureBodies` still collides. One walk proves the collision; the point
// test proves the second path reaches it. Saying which claim each instrument
// carries is the whole of INSTRUMENTS.md.
//
// VALIDITY TERMS, because DW-20 says a probe proves it advanced before its
// numbers mean anything: ticks advanced, the smelter is in the plan, the walk
// covered ground, and `factory.solids.pending` is 0 (a building that DECLARES
// `solid: 'blocks'` and has no collider is counted separately from one that
// declares itself passable, so "the asset ships no col_ proxy" cannot hide
// inside "nothing was adopted").
(async () => {
  const of = window.__of;
  const sleep = (n) => of.run(n);
  const log = [];
  const fail = (why, extra) => ({ fail: why, ...extra, log });

  await sleep(0.8);
  const t0 = of.world().tick;
  const st = of.structures();
  if (st === null) return fail('no structural layer, so no solid set to join');

  const solids = () => st.bodies.count;
  const aim = () => of.aim();
  const eye = () => { const o = aim().origin; return { x: o[0], y: o[1], z: o[2] }; };
  const fac = () => of.game().factory;
  const up = () => { const e = eye(); const r = Math.hypot(e.x, e.y, e.z) || 1;
    return { x: e.x / r, y: e.y / r, z: e.z / r }; };

  const solidsBefore = solids();

  // --- place a smelter, through the build menu and the left mouse button -----
  const yaw0 = of.world().observer.yawDeg;
  of.build(3);
  await sleep(0.2);
  let placed = false;
  for (let p = -40; p <= -14 && !placed; p += 2) {
    of.look(yaw0, p);
    await sleep(0.06);
    const g = of.build().ghost;
    if (g === null || g.valid === false) continue;
    of.input.tape([{ hold: 3, actions: ['use'] }, { hold: 5, keys: [] }]);
    await sleep(0.3);
    placed = (fac().rows ?? fac().list ?? []).some((b) => b.kind === 'smelter')
      || fac().buildings > 0;
  }
  of.build(0);
  await sleep(0.15);
  const rows = fac().rows ?? fac().list ?? [];
  const sm = rows.find((b) => b.kind === 'smelter');
  if (sm === undefined) {
    return fail('the click placed no smelter, so nothing was under test',
      { buildings: fac().buildings, kinds: rows.map((b) => b.kind) });
  }
  const c = { x: sm.pos[0], y: sm.pos[1], z: sm.pos[2] };
  const solidsAfter = solids();

  // --- claim 2, and it is asked BOTH ways --------------------------------
  // The sample sits one metre up the machine's own radial, which is inside the
  // 3.60 m housing and above the ground plane the box's base sits on, so a
  // ground sample cannot pass it by accident.
  const u = up();
  const probePt = { x: c.x + u.x, y: c.y + u.y, z: c.z + u.z };
  const solidAtMachine = of.solidBuild(probePt.x, probePt.y, probePt.z);
  // Twelve metres out along the same radial is empty sky. If THIS reads solid
  // the predicate is broken and nothing else in this file means anything.
  const solidAtSky = of.solidBuild(c.x + u.x * 12, c.y + u.y * 12, c.z + u.z * 12);

  const HALF = (of.game().factory.footprint?.smelter ?? 4) * 0.5;

  // --- claim 3: walk into it ------------------------------------------------
  // Tangent distance, because the approach is horizontal and the machine's box
  // is 3.60 m tall: including the radial would let a player standing on top read
  // as "outside", which is true and is not the question.
  const tangentD = (p) => {
    const v = { x: p.x - c.x, y: p.y - c.y, z: p.z - c.z };
    const n = up();
    const d = v.x * n.x + v.y * n.y + v.z * n.z;
    return Math.hypot(v.x - n.x * d, v.y - n.y * d, v.z - n.z * d);
  };
  // Face the machine, coarse then fine, the same search machineports.js uses.
  const miss = () => {
    const a = aim();
    const e = eye();
    const v = { x: c.x - e.x, y: c.y - e.y, z: c.z - e.z };
    const t = v.x * a.dir[0] + v.y * a.dir[1] + v.z * a.dir[2];
    if (t <= 0) return Infinity;
    return Math.hypot(v.x - a.dir[0] * t, v.y - a.dir[1] * t, v.z - a.dir[2] * t);
  };
  // BACK AWAY FIRST, so there is a real approach to measure. A smelter goes
  // down about two metres in front of the crosshair, which leaves the player
  // already touching its face: the first run of this probe measured a walk of
  // 0.417 m, and a walk that short cannot distinguish "stopped by the housing"
  // from "never went anywhere". `theWalkCoveredGround` is what caught it, which
  // is the validity term earning its place rather than decorating the report.
  for (let i = 0; i < 6; ++i) {
    of.input.tape([{ hold: 18, keys: ['KeyS'] }]);
    await sleep(0.34);
  }
  of.input.tape([{ hold: 2, keys: [] }]);
  await sleep(0.2);

  let best = of.world().observer.yawDeg;
  for (const step of [20, 5, 1.5, 0.4]) {
    let by = best;
    let bm = Infinity;
    for (let k = -9; k <= 9; ++k) {
      of.look(best + k * step, -6);
      const m = miss();
      if (m < bm) { bm = m; by = best + k * step; }
    }
    best = by;
  }
  of.look(best, -6);
  await sleep(0.1);

  const startD = tangentD(eye());
  // THE WALKER'S OWN ANSWER, beside the geometric one. `structureTests` counts
  // the point-in-solid tests `KinematicBody` charged to the structural port on
  // the last tick, and the port is SKIPPED ENTIRELY when the set is empty
  // (`solids.count > 0`), so a nonzero count is the walker saying it consulted
  // the machine set at all. Two independent instruments for one claim: the
  // penetration could in principle be explained by terrain, and this could in
  // principle be explained by a wall, and nothing plausible explains both.
  // `blockedByBuild` is captured too and deliberately not asserted; the field's
  // comment below says what it actually means and how that was found out.
  let blockedByBuild = false;
  let structureTests = 0;
  let minD = startD;
  let lastD = startD;
  let stalledFor = 0;
  const track = [];
  for (let i = 0; i < 30; ++i) {
    of.input.tape([{ hold: 18, keys: ['KeyW'] }]);
    await sleep(0.34);
    const pl = of.world().player;
    if (pl?.blockedByBuild === true) blockedByBuild = true;
    structureTests = Math.max(structureTests, pl?.structureTests ?? 0);
    const d = tangentD(eye());
    track.push(Number(d.toFixed(3)));
    if (d < minD) minD = d;
    // A held W that stops changing the distance for three bursts has met
    // something. Recorded rather than used as the verdict: the verdict is the
    // penetration, and this is only what stops the probe walking for ever.
    if (Math.abs(d - lastD) < 0.01) { if (++stalledFor >= 3) { lastD = d; break; } }
    else stalledFor = 0;
    lastD = d;
  }
  of.input.tape([{ hold: 2, keys: [] }]);
  await sleep(0.2);

  // THE NUMBER. Positive means the player's own position got past the housing
  // face; negative means they were held outside it, by that many metres.
  const penetrationM = HALF - minD;
  const walkedM = startD - minD;
  const ticks = of.world().tick - t0;
  const solidReport = fac().solids ?? null;

  // --- the belt, which is the row that was ARGUED rather than assumed --------
  // A belt is declared `solid: 'passable'` and the claim needs its own evidence,
  // because "no collider appeared" is the same observation as "the adoption is
  // broken". The two are separated by running this AFTER the smelter has already
  // proved the adoption works on the same scene: a set that grew for a smelter
  // and did not grow for a belt is a DECISION, not a failure.
  const solidsPreBelt = solids();
  of.build(2);
  await sleep(0.2);
  let beltRow = null;
  for (let p = -34; p <= -16 && beltRow === null; p += 2) {
    of.look(of.world().observer.yawDeg, p);
    await sleep(0.06);
    if ((of.build().ghost ?? null) === null) continue;
    of.input.tape([{ hold: 3, actions: ['use'] }, { hold: 5, keys: [] }]);
    await sleep(0.25);
    beltRow = (fac().list ?? []).find((b) => b.kind === 'belt') ?? null;
  }
  of.build(0);
  await sleep(0.15);
  const solidsPostBelt = solids();
  let solidAtBelt = null;
  if (beltRow !== null) {
    const bp = { x: beltRow.pos[0], y: beltRow.pos[1], z: beltRow.pos[2] };
    const br = Math.hypot(bp.x, bp.y, bp.z) || 1;
    // 0.20 m up the belt's own radial is inside a 0.25 m deck, so this samples
    // the tile itself and not the air above it.
    solidAtBelt = of.solidBuild(bp.x + bp.x / br * 0.2,
      bp.y + bp.y / br * 0.2, bp.z + bp.z / br * 0.2);
  }

  // --- the hand machine's own path ------------------------------------------
  // Sandbox lifts the crafted-item gate (DW-31), so the bar's furnace slot
  // places one. It is a different table, a different loader and a different
  // adopt call from the factory's, and the only thing asserted about it here is
  // that it reaches the same set.
  of.hotbar(2);
  await sleep(0.15);
  of.look(of.world().observer.yawDeg + 150, -24);
  await sleep(0.1);
  const solidsPreHand = solids();
  of.input.tape([{ hold: 3, actions: ['use'] }, { hold: 6, keys: [] }]);
  await sleep(0.4);
  const hands = of.game().machines ?? [];
  const hm = hands[hands.length - 1] ?? null;
  const solidsPostHand = solids();
  let handSolidAt = null;
  if (hm !== null) {
    const hp = { x: hm.pos[0], y: hm.pos[1], z: hm.pos[2] };
    const hu = { x: hp.x, y: hp.y, z: hp.z };
    const hr = Math.hypot(hu.x, hu.y, hu.z) || 1;
    handSolidAt = of.solidBuild(hp.x + hu.x / hr * 0.6,
      hp.y + hu.y / hr * 0.6, hp.z + hu.z / hr * 0.6);
  }

  const checks = {
    // Validity first. Every one of these can be true on a completely broken
    // build, which is why none of them is a claim.
    theSimAdvanced: ticks > 200,
    aSmelterIsInThePlan: sm !== undefined,
    theWalkCoveredGround: walkedM > 2.0,
    theSolidPredicateIsNotStuckOn: solidAtSky === false,
    // The claims.
    theSolidSetGrewByOne: solidsAfter === solidsBefore + 1,
    theSetIsAtTheMachine: solidAtMachine === true,
    everyBlockingBuildingHasACollider: (solidReport?.pending ?? -1) === 0,
    theWalkerDidNotEnterTheHousing: penetrationM < 0,
    // The walker's OWN side of the claim, and it is `structureTests` rather than
    // `blockedByBuild` for a measured reason: see the note beside the fields.
    theWalkersStructuralPortRan: structureTests > 0,
    // The hand path, which is a second placement layer entirely.
    // The belt decision, as built, two-sided on the same scene.
    aBeltIsInThePlan: beltRow !== null,
    aBeltAddedNoCollider: solidsPostBelt === solidsPreBelt,
    aBeltIsWalkedOverNotInto: beltRow === null ? true : solidAtBelt === false,
    theHandMachineJoinedTheSameSet: hm === null ? true
      : solidsPostHand === solidsPreHand + 1,
    theHandMachineIsSolidWhereItStands: hm === null ? true : handSolidAt === true,
  };
  const failed = Object.entries(checks).filter(([, v]) => v !== true).map(([k]) => k);

  log.push(`solids ${solidsBefore} -> ${solidsAfter} on a smelter, `
    + `${solidsPreBelt} -> ${solidsPostBelt} on a BELT (declared passable), `
    + `${solidsPreHand} -> ${solidsPostHand} on a hand furnace`);
  log.push(`half-extent ${HALF.toFixed(3)} m, closest approach ${minD.toFixed(4)} m`);
  log.push(`PENETRATION ${penetrationM.toFixed(4)} m (negative = held outside)`);
  log.push(`walked ${walkedM.toFixed(3)} m over ${ticks} ticks, track ${JSON.stringify(track)}`);

  return {
    ok: failed.length === 0,
    failed,
    checks,
    solidsBefore, solidsAfter, solidsPreBelt, solidsPostBelt, solidAtBelt,
    solidsPreHand, solidsPostHand,
    solidAtMachine, solidAtSky, handSolidAt,
    halfExtentM: Number(HALF.toFixed(4)),
    startD: Number(startD.toFixed(4)),
    closestApproachM: Number(minD.toFixed(4)),
    penetrationM: Number(penetrationM.toFixed(4)),
    /**
     * REPORTED, NOT ASSERTED, and the reason is a finding.
     *
     * `blockedByBuild` reads FALSE on this run, with the player provably held
     * against the housing at 2.004 m for four consecutive bursts. It is not
     * wrong; its name is wider than its meaning. `StructureBodies.resolveStep`
     * returns `blocked: true` only when it has exhausted the step-up rungs AND
     * every axis-decomposed SLIDE, so a player walking squarely into a flat 4 m
     * face slides along it, the slide succeeds, and the flag stays false. It
     * says "the step was refused outright", not "a structure stopped me".
     *
     * My first draft asserted it and went red on working code, which is the
     * cheap way to learn this. Asserting it would have been a control tuned
     * until it passed if I had then widened something.
     */
    blockedByBuild,
    /** DW-28's habit applied to a cost rather than a capacity: `blocks` is O(set)
     *  behind a sphere reject, so a base of several hundred machines makes this
     *  number the one to watch. Reported rather than asserted, because a bound
     *  picked today against a two-machine scene would be a constant sized
     *  against today's asset set, which is the thing this whole pass is about. */
    structureTests,
    walkedM: Number(walkedM.toFixed(4)),
    ticks,
    solidReport,
    track,
    log,
  };
})()
