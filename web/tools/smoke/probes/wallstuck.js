// CAN A PLAYER END UP INSIDE A 4.00 m WALL, AND IF SO CAN THEY GET OUT AGAIN?
//
//   node web/tools/smoke/run.mjs --url=http://127.0.0.1:5457/ --scenario=walk \
//        --sandbox=1 --evalfile=web/tools/smoke/probes/wallstuck.js
//
// THE CLAIM UNDER TEST, and it has never been driven. `StructureBodies.deckUnder`
// only seats a capsule on a top face inside `[rFrom - 2.0, rFrom + 0.55]`. The
// shipped deck is 0.50 m thick so a capsule inside a DECK is always lifted out;
// a 4.00 m wall does not fit in that window, so a capsule inside a WALL is never
// lifted, and there is no structural counterpart to
// `VoxelCollision.resolveEmbedded` to push it sideways either. A previous audit
// concluded from those two facts that being inside a wall is permanent.
//
// It also read `StructureBodies.resolveStep` (StructureBody.ts 295), whose
// second clause accepts the destination UNCONDITIONALLY when the capsule is
// already not free where it started. On paper that is an escape hatch: an
// embedded player should walk out of a wall as if it were not there. Two
// readings of the same file disagree about whether the state is a dead end, so
// this drives it rather than reading it again.
//
// HOW THE PLAYER GETS IN, both ways a real one could:
//
//   ROUTE A, THE GRID. A foundation under the feet, then a wall aimed straight
//     down. `resolveTarget` (StructurePlacement.ts 138 to 153) refuses on five
//     grounds: already built, too high, unsupported, uneven ground, cost. NONE
//     of them is the player. The grid still only buries you when you happen to
//     be standing within half a wall thickness of the cell edge it picks, so
//     this route measures the ghost's answer and the miss distance rather than
//     assuming a bury.
//   ROUTE B, FREE PLACEMENT. The shipped `freeSnap` key takes the rounding off
//     (`freeTarget`, StructurePlacement.ts 254), and a freely placed part lands
//     on the ground under the aim. Aim at your own feet and the wall is built
//     around you, every time, with one press of the button the HUD names.
//
// Neither route is a debug entry point: both go through `of.build`, `of.input`
// and `commitTarget`, which is the same path a key press takes.
//
// DW-20. Every drive phase reports the tick counter either side of it and the
// number of parts that actually went down. A probe that measured an empty world
// would report a beautiful clean zero for the wrong reason.
//
// Sandbox, for the reason decksink.js and basesink.js give (DW-31): this is a
// question about geometry, and paying stone for the walls would make it a
// harvesting probe.
(async () => {
  const of = window.__of;
  const A = OF_ARGS ?? {};
  const log = [];
  const r6 = (x) => (Number.isFinite(x) ? Number(x.toFixed(6)) : null);
  const r3 = (x) => (Number.isFinite(x) ? Number(x.toFixed(3)) : null);
  const fail = (why, extra) => ({ valid: false, pass: false, fail: why, ...extra, log });

  const P = () => of.world().player;
  const feet = () => P().feet;
  const tickNow = () => of.world().tick;
  const parts = () => of.game().structures.parts;
  const structs = () => of.game().structures;
  const ghost = () => of.build().structGhost;

  const idle = (secs) => {
    of.input.tape([{ hold: Math.ceil(60 * secs) + 30, keys: [] }]);
    return of.run(secs, 60);
  };
  const holdA = (secs, acts) => {
    of.input.tape([{ hold: Math.ceil(60 * secs) + 30, actions: acts }]);
    return of.run(secs, 60);
  };

  await idle(1.0);
  if (of.game() === null) return fail('no gameplay layer');
  if (typeof of.stand !== 'function') return fail('no __of.stand: rebuild');
  if (typeof of.solidBuild !== 'function') return fail('no __of.solidBuild: rebuild');
  if (P() === null) return fail('no character in this scenario: run --scenario=walk');
  // Standing rule 11 / BT-26: make a dead read throw instead of comparing
  // undefined with undefined for the rest of the run.
  mustHave(P(), 'blockedByBuild', 'world().player');
  mustHave(P(), 'onDeck', 'world().player');
  mustNum(of.world(), 'tick', 'world()');
  const M = structs().module;
  mustNum(M, 'wallH', 'structures.module');
  mustNum(M, 'wallT', 'structures.module');
  mustNum(M, 'cellM', 'structures.module');
  mustNum(M, 'deckH', 'structures.module');
  const sandbox = of.sandbox()?.sandbox === true;
  if (!sandbox) log.push('NOT sandbox: placements have to be paid for, and a '
    + 'refusal for cost would look exactly like a refusal for the player');
  const yaw0 = of.world().observer.yawDeg;

  // ---------------------------------------------------------------- geometry
  /** The structural solid along a point's own radial, as bands in metres
   *  RELATIVE TO THE FEET, read off `of.solidBuild`, which IS
   *  `StructureBodies.blocks`, the predicate the walker collides against. A
   *  band recomputed from `module.wallH` would agree with itself whatever the
   *  walker did. */
  const bandAlong = (p, lo = -1.0, hi = 5.0, step = 0.02) => {
    const r = Math.hypot(p[0], p[1], p[2]);
    const u = [p[0] / r, p[1] / r, p[2] / r];
    const bands = [];
    let start = null;
    for (let d = lo; d <= hi + 1e-9; d += step) {
      const hit = of.solidBuild(u[0] * (r + d), u[1] * (r + d), u[2] * (r + d));
      if (hit && start === null) start = d;
      if (!hit && start !== null) { bands.push([r6(start), r6(d - step)]); start = null; }
    }
    if (start !== null) bands.push([r6(start), r6(hi)]);
    return bands;
  };

  /**
   * How many metres of the capsule's own column stand inside a structural
   * solid, sampled between the ankles and the head.
   *
   * The walker's three sample heights are not published, so this deliberately
   * does not recite them: it measures the WHOLE column, which strictly
   * contains whatever three points `free()` uses. A wall spans 4.00 m, so a
   * column reading anywhere near 1.7 m means every possible sample is inside
   * it and the question does not turn on where they were put.
   */
  const columnSolidM = (p) => {
    const r = Math.hypot(p[0], p[1], p[2]);
    const u = [p[0] / r, p[1] / r, p[2] / r];
    let n = 0;
    for (let d = 0.05; d <= 1.75 + 1e-9; d += 0.05) {
      if (of.solidBuild(u[0] * (r + d), u[1] * (r + d), u[2] * (r + d))) n++;
    }
    return n * 0.05;
  };
  const embedded = () => columnSolidM(feet()) > 1e-9;

  /** Tangential distance between two body-frame points, metres. */
  const horizM = (a, b) => {
    const ra = Math.hypot(a[0], a[1], a[2]) || 1;
    const u = [a[0] / ra, a[1] / ra, a[2] / ra];
    const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const rad = d[0] * u[0] + d[1] * u[1] + d[2] * u[2];
    const len2 = d[0] * d[0] + d[1] * d[1] + d[2] * d[2];
    return Math.sqrt(Math.max(0, len2 - rad * rad));
  };
  const radiusOf = (p) => Math.hypot(p[0], p[1], p[2]);

  // ------------------------------------------------------------ the hotbar
  // ASKED, NOT RECITED. basesink.js's argument, and it applies twice as hard
  // here: this probe needs TWO different parts, and a recited slot index is a
  // number that can silently become the wrong item and place nothing while the
  // probe reports a clean zero. The slot that produces a ghost whose `kind` is
  // 'wall' is the wall, whatever number key it sits behind this week.
  let wallSlot = null, foundSlot = null;
  const slotKinds = [];
  for (let i = 1; i <= 7; ++i) {
    of.build(i);
    await idle(0.12);
    of.look(yaw0, -80);
    await idle(0.12);
    const g = ghost();
    slotKinds.push([i, g === null ? null : g.kind]);
    if (g === null) continue;
    if (g.kind === 'wall' && wallSlot === null) wallSlot = i;
    if (g.kind === 'foundation' && foundSlot === null) foundSlot = i;
  }
  if (wallSlot === null) return fail('no hotbar slot puts a WALL in hand', { slotKinds });
  if (foundSlot === null) return fail('no hotbar slot puts a FOUNDATION in hand', { slotKinds });
  log.push(`wall is build slot ${wallSlot}, foundation is build slot ${foundSlot}; `
    + `module cell ${r3(M.cellM)} m, deck ${r3(M.deckH)} m, wall ${r3(M.wallH)} m `
    + `tall by ${r3(M.wallT)} m thick`);

  /** One press of the place button, through the tape. Returns how many parts
   *  the world gained, so a refused press is a 0 and not an exception. */
  const reasons = new Set();
  const pressUse = async () => {
    const before = parts().length;
    const g = ghost();
    if (g !== null) reasons.add(`${g.kind}: ${g.ok ? 'OK ' : 'REFUSED '}${g.reason}`);
    of.input.tape([{ hold: 4, actions: ['use'] }, { hold: 10, keys: [] }]);
    await of.run(0.3, 60);
    return parts().length - before;
  };

  // ================================================================ ROUTE A
  // The grid. A foundation under the feet first, because `supported()` refuses
  // a wall with no deck beside it, and that refusal is about the DECK and not
  // about the player.
  const tA0 = tickNow();
  of.build(foundSlot);
  await idle(0.2);
  let laid = 0;
  for (let p = -88; p <= -40 && laid === 0; p += 4) {
    of.look(yaw0, p);
    await of.run(0.06, 60);
    const g = ghost();
    if (g === null || g.addr === null || !g.ok) { if (g !== null) reasons.add(`foundation: REFUSED ${g.reason}`); continue; }
    laid = await pressUse();
  }
  if (laid === 0) {
    return fail('the foundation would not go down, so no grid wall can be tried',
      { ghost: ghost(), reasons: [...reasons], costs: structs().costs });
  }
  await idle(1.2);
  const onDeckAfterFoundation = P().onDeck === true;
  log.push(`ROUTE A: foundation laid, player onDeck ${onDeckAfterFoundation}, `
    + `feet r ${r6(radiusOf(feet()))}`);

  // Now the wall, aimed straight down at the player's own feet: the crosshair a
  // player fumbling with the build tool has while standing in the room they are
  // walling. `addressAt` gives a wall the NEAREST cell edge to the aim point.
  of.build(wallSlot);
  await idle(0.25);
  of.look(yaw0, -88);
  await of.run(0.15, 60);
  const gridGhost = ghost();
  const feetBeforeGridWall = feet();
  const gridPlaced = await pressUse();
  await idle(1.0);
  const gridWall = parts().filter((q) => q.kind === 'wall').slice(-1)[0] ?? null;
  const gridColumnM = columnSolidM(feet());
  const routeA = {
    ghostKind: gridGhost?.kind ?? null,
    ghostOk: gridGhost?.ok ?? null,
    ghostReason: gridGhost?.reason ?? null,
    ghostAddr: gridGhost?.addr ?? null,
    placed: gridPlaced,
    // The distance from the player's own axis to the wall the grid chose. This
    // is the whole story of route A: the grid never refuses because of you, it
    // simply picks an edge, and whether that buries you is where you stood.
    wallCentreToFeetM: gridWall === null ? null
      : r6(horizM(feetBeforeGridWall, gridWall.pos)),
    halfThicknessM: r6(M.wallT / 2),
    columnInsideSolidM: r6(gridColumnM),
    buried: gridColumnM > 1e-9,
    onDeck: P().onDeck === true,
    blockedByBuild: P().blockedByBuild === true,
  };
  log.push(`ROUTE A: grid wall ghost ok=${routeA.ghostOk} "${routeA.ghostReason}", `
    + `placed ${gridPlaced}, wall centre ${routeA.wallCentreToFeetM} m from the `
    + `player against a ${routeA.halfThicknessM} m half thickness, buried `
    + `${routeA.buried}`);

  // ================================================================ ROUTE B
  // FREE PLACEMENT, the shipped `freeSnap` key. `freeTarget` puts the part on
  // the ground under the aim with no grid rounding at all, so aiming at your
  // own feet builds the wall around you. One key, one click, no debug entry.
  const tB0 = tickNow();
  for (let i = 0; i < 4 && of.build().freePlace !== true; ++i) {
    of.input.act(['freeSnap'], 6);
    await of.run(0.25, 60);
  }
  if (of.build().freePlace !== true) {
    return fail('freeSnap would not toggle free placement on', { build: of.build() });
  }
  of.look(yaw0, -88);
  await of.run(0.2, 60);
  const freeGhost = ghost();
  const feetBeforeFree = feet();
  const freePlaced = await pressUse();
  await idle(1.5);
  const freeWall = parts().filter((q) => q.kind === 'wall').slice(-1)[0] ?? null;
  const tB1 = tickNow();
  if (freePlaced === 0) {
    return fail('the free wall would not go down', {
      ghost: freeGhost, routeA, reasons: [...reasons], costs: structs().costs,
    });
  }
  // Hands back, or a later walk phase would lay a wall every time it moved.
  of.build(0);
  await idle(0.4);

  const partsBuilt = parts().length;
  if (partsBuilt < 2) return fail('the build placed nothing worth measuring', { partsBuilt });

  // ------------------------------------------------- IS THE PLAYER INSIDE IT?
  // Proved against the walker's own predicate, and reported beside the wall's
  // placed position, so "embedded" is a measurement rather than an assumption.
  const embedFeet = feet();
  const embedState = {
    wallId: freeWall?.id ?? null,
    wallKind: freeWall?.kind ?? null,
    wallFree: freeGhost?.free ?? null,
    wallPos: freeWall === null ? null : freeWall.pos.map(r3),
    wallCentreToFeetM: freeWall === null ? null : r6(horizM(feetBeforeFree, freeWall.pos)),
    feet: embedFeet.map(r3),
    feetR: r6(radiusOf(embedFeet)),
    // The solid the walker sees along the feet's own radial, in metres above
    // the feet. A 4 m wall the player is standing in reads as one band that
    // starts at or below 0 and runs past the top of the capsule.
    solidBandsRelFeetM: bandAlong(embedFeet),
    columnInsideSolidM: r6(columnSolidM(embedFeet)),
    onDeck: P().onDeck === true,
    grounded: P().grounded === true,
    blockedByBuild: P().blockedByBuild === true,
  };
  log.push(`ROUTE B: free wall #${embedState.wallId} placed ${r6(embedState.wallCentreToFeetM)} m `
    + `from the player, capsule column inside solid ${embedState.columnInsideSolidM} m, `
    + `bands ${JSON.stringify(embedState.solidBandsRelFeetM)}`);
  if (!embedded()) {
    return fail('the wall went down but the player is not inside it', {
      routeA, embedState, partsBuilt, ticks: { tA0, tB0, tB1 },
    });
  }

  // The spot to come back to between drives, so the four walk-outs all start
  // from the SAME state. `teleport` is lat/lon read straight back off the
  // observer, so the round trip lands on the point it left.
  const home = of.world().observer;
  const homeLat = home.latDeg, homeLon = home.lonDeg;
  const reEmbed = async () => {
    of.teleport(homeLat, homeLon, 0);
    await idle(0.8);
    return embedded();
  };
  if (!(await reEmbed())) {
    return fail('the teleport home does not land back inside the wall',
      { embedState, homeLat, homeLon, feet: feet() });
  }

  // ------------------------------------------------ STAND STILL FOR 600 TICKS
  // Sink, fall, freeze or stand: the whole question in one number, the spread
  // of the feet radius while nothing at all is being pressed.
  const tS0 = tickNow();
  of.stand(true);
  await idle(A.standSecs ?? 10.2);
  const dump = of.stand();
  of.stand(false);
  const tS1 = tickNow();
  const ss = dump.samples.filter((x) => Number.isFinite(x.feetR)).slice(-600);
  if (tS1 <= tS0) return fail('the stand phase advanced no ticks', { tS0, tS1 });
  if (ss.length < 400) return fail('stand trace too short', { kept: ss.length, total: dump.total });
  const rs = ss.map((x) => x.feetR);
  const gTick = of.gravity(radiusOf(feet())) / 3600;
  const stand = {
    ticksBefore: tS0, ticksAfter: tS1, ticksAdvanced: tS1 - tS0,
    ticksTraced: ss.length,
    feetRFirst: r6(rs[0]), feetRLast: r6(rs[rs.length - 1]),
    spreadM: r6(Math.max(...rs) - Math.min(...rs)),
    netDriftM: r6(rs[rs.length - 1] - rs[0]),
    oneTickOfGravityM: r6(gTick),
    onDeckTicks: ss.filter((x) => x.onDeck).length,
    groundedTicks: ss.filter((x) => x.grounded).length,
    blockedByBuildTicks: ss.filter((x) => x.blockedByBuild).length,
    deckAnsweredTicks: ss.filter((x) => Number.isFinite(x.deckR)).length,
    deckRAboveFeetMaxM: r6(Math.max(...ss.map((x) =>
      (Number.isFinite(x.deckR) ? x.deckR : -Infinity) - x.feetR))),
    underRockTicks: ss.filter((x) => x.underRock).length,
    pushTicks: ss.filter((x) => x.pushM > 0).length,
    // A tick that fell further than gravity could carry it, and a tick that
    // rose further than a settle could. Either one is the sinking complaint.
    fallTicks: ss.filter((x, i) => i > 0 && ss[i - 1].feetR - x.feetR > gTick).length,
    riseTicks: ss.filter((x, i) => i > 0 && x.feetR - ss[i - 1].feetR > gTick).length,
    stillInsideAfter: embedded(),
    columnInsideSolidM: r6(columnSolidM(feet())),
  };
  log.push(`STANDING: spread ${stand.spreadM} m over ${stand.ticksTraced} ticks `
    + `(${stand.ticksAdvanced} ticks of sim), drift ${stand.netDriftM} m, `
    + `onDeck ${stand.onDeckTicks}, blockedByBuild ${stand.blockedByBuildTicks}, `
    + `still inside ${stand.stillInsideAfter}`);

  // ------------------------------------------------------- CAN THEY WALK OUT?
  // THE LOAD-BEARING MEASUREMENT. All four directions, each from the same
  // embedded start, because a wall is a PLANE: two of the four run along it and
  // two cross it, and only driving all four says whether the escape hatch in
  // `resolveStep` is real.
  const drive = async (name, act, secs) => {
    const ok = await reEmbed();
    const before = feet();
    const t0 = tickNow();
    const inside0 = columnSolidM(before);
    of.look(yaw0, -6);
    await of.run(0.15, 60);
    of.stand(true);
    await holdA(secs, [act]);
    const d = of.stand();
    of.stand(false);
    const t1 = tickNow();
    // Read the position and the speed at the END OF THE DRIVE, not after a
    // settle: a coasting metre added by the settle would be reported as
    // distance the key press bought.
    const after = feet();
    const speedAtEnd = P().speedMps;
    await idle(0.4);
    const s = d.samples.filter((x) => Number.isFinite(x.feetR));
    return {
      name, action: act, startedEmbedded: ok,
      ticksBefore: t0, ticksAfter: t1, ticksAdvanced: t1 - t0,
      travelledHorizM: r6(horizM(before, after)),
      radiusChangeM: r6(radiusOf(after) - radiusOf(before)),
      speedAtEndMps: r6(speedAtEnd),
      columnInsideBeforeM: r6(inside0),
      columnInsideAfterM: r6(columnSolidM(after)),
      endToWallCentreM: freeWall === null ? null : r6(horizM(after, freeWall.pos)),
      escaped: columnSolidM(after) <= 1e-9,
      blockedByBuildTicks: s.filter((x) => x.blockedByBuild).length,
      tracedTicks: s.length,
      onDeckTicks: s.filter((x) => x.onDeck).length,
      groundedTicks: s.filter((x) => x.grounded).length,
    };
  };

  const secs = A.walkSecs ?? 2.0;
  const walks = [];
  walks.push(await drive('W forward', 'forward', secs));
  walks.push(await drive('A strafe left', 'strafeLeft', secs));
  walks.push(await drive('S back', 'back', secs));
  walks.push(await drive('D strafe right', 'strafeRight', secs));
  for (const w of walks) {
    log.push(`${w.name}: ${w.travelledHorizM} m in ${w.ticksAdvanced} ticks, `
      + `blockedByBuild ${w.blockedByBuildTicks}/${w.tracedTicks}, escaped ${w.escaped}`);
  }

  // ------------------------------------------- THE WALL ON ITS OWN, NO DECK
  // Everything above was measured with a FOUNDATION under the player as well as
  // a wall around them, which is the state route A produces and is therefore
  // worth measuring, but it confounds the sinking question: `deckUnder` finds
  // the deck's own top face at the feet and holds them there whatever the wall
  // does. So the same measurement again on BARE TERRAIN, where the only
  // structural solid in reach is the 4 m wall itself and the only thing that
  // can hold the player up is the ground.
  const tC0 = tickNow();
  of.look(yaw0, -6);
  await of.run(0.15, 60);
  let offDeck = P().onDeck !== true && columnSolidM(feet()) <= 1e-9;
  for (let i = 0; i < 8 && !offDeck; ++i) {
    await holdA(0.7, ['forward']);
    await idle(0.4);
    offDeck = P().onDeck !== true && columnSolidM(feet()) <= 1e-9;
  }
  let bare = null;
  if (!offDeck) {
    log.push('BARE GROUND: never got clear of the deck, scene not measured');
  } else {
    of.build(wallSlot);
    await idle(0.3);
    if (of.build().freePlace !== true) { of.input.act(['freeSnap'], 6); await of.run(0.25, 60); }
    of.look(yaw0, -88);
    await of.run(0.2, 60);
    const bareGhost = ghost();
    const barePlaced = await pressUse();
    of.build(0);
    await idle(1.2);
    const bFeet = feet();
    const bareLat = of.world().observer.latDeg, bareLon = of.world().observer.lonDeg;
    of.stand(true);
    await idle(A.standSecs ?? 10.2);
    const bd = of.stand();
    of.stand(false);
    const tC1 = tickNow();
    const bs = bd.samples.filter((x) => Number.isFinite(x.feetR)).slice(-600);
    const brs = bs.map((x) => x.feetR);
    // And one walk out of it, so the recovery claim is not made only about a
    // player who also had a floor.
    of.teleport(bareLat, bareLon, 0);
    await idle(0.8);
    const wBefore = feet();
    const tC2 = tickNow();
    of.look(yaw0, -6);
    await of.run(0.15, 60);
    await holdA(secs, ['forward']);
    const wAfter = feet();
    const tC3 = tickNow();
    await idle(0.4);
    bare = {
      ghostOk: bareGhost?.ok ?? null, ghostReason: bareGhost?.reason ?? null,
      placed: barePlaced,
      onDeck: P().onDeck === true,
      feetR: r6(radiusOf(bFeet)),
      solidBandsRelFeetM: bandAlong(bFeet),
      columnInsideSolidM: r6(columnSolidM(bFeet)),
      ticksBefore: tC0, ticksAfter: tC1, ticksAdvanced: tC1 - tC0,
      ticksTraced: bs.length,
      spreadM: brs.length === 0 ? null : r6(Math.max(...brs) - Math.min(...brs)),
      netDriftM: brs.length === 0 ? null : r6(brs[brs.length - 1] - brs[0]),
      onDeckTicks: bs.filter((x) => x.onDeck).length,
      groundedTicks: bs.filter((x) => x.grounded).length,
      deckAnsweredTicks: bs.filter((x) => Number.isFinite(x.deckR)).length,
      blockedByBuildTicks: bs.filter((x) => x.blockedByBuild).length,
      walkOut: {
        ticksAdvanced: tC3 - tC2,
        travelledHorizM: r6(horizM(wBefore, wAfter)),
        columnInsideAfterM: r6(columnSolidM(wAfter)),
        escaped: columnSolidM(wAfter) <= 1e-9,
      },
    };
    log.push(`BARE GROUND: wall placed ${barePlaced}, column inside `
      + `${bare.columnInsideSolidM} m, bands ${JSON.stringify(bare.solidBandsRelFeetM)}, `
      + `spread ${bare.spreadM} m over ${bare.ticksTraced} ticks, deck answered `
      + `${bare.deckAnsweredTicks}, walked out ${bare.walkOut.travelledHorizM} m, `
      + `escaped ${bare.walkOut.escaped}`);
  }

  // ------------------------------------------------------------ JUMP, AND DIG
  const jumpOk = await reEmbed();
  const jFeet0 = feet();
  const tJ0 = tickNow();
  of.look(yaw0, -6);
  await of.run(0.15, 60);
  of.stand(true);
  await holdA(secs, ['jump']);
  const jd = of.stand();
  of.stand(false);
  const tJ1 = tickNow();
  await idle(0.5);
  const js = jd.samples.filter((x) => Number.isFinite(x.feetR));
  const jump = {
    startedEmbedded: jumpOk,
    ticksBefore: tJ0, ticksAfter: tJ1, ticksAdvanced: tJ1 - tJ0,
    highestAboveStartM: js.length === 0 ? null
      : r6(Math.max(...js.map((x) => x.feetR)) - radiusOf(jFeet0)),
    airborneTicks: js.filter((x) => !x.grounded).length,
    tracedTicks: js.length,
    columnInsideAfterM: r6(columnSolidM(feet())),
    escaped: columnSolidM(feet()) <= 1e-9,
    wallHeightM: r6(M.wallH),
  };
  log.push(`JUMP: rose ${jump.highestAboveStartM} m inside a ${jump.wallHeightM} m `
    + `wall over ${jump.ticksAdvanced} ticks, escaped ${jump.escaped}`);

  const digOk = await reEmbed();
  const tD0 = tickNow();
  of.look(yaw0, -85);
  await of.run(0.15, 60);
  const digDown = of.dig();
  await idle(0.5);
  of.look(yaw0, -10);
  await of.run(0.15, 60);
  const digAhead = of.dig();
  await idle(0.8);
  const tD1 = tickNow();
  const dig = {
    startedEmbedded: digOk,
    ticksBefore: tD0, ticksAfter: tD1, ticksAdvanced: tD1 - tD0,
    down: digDown, ahead: digAhead,
    // A dig cannot touch a structure (standing rule 1: rock is the oracle's and
    // a placed part is not rock), so this asks whether the VERB still works at
    // all while embedded, not whether it removes the wall.
    stillInside: embedded(),
    columnInsideAfterM: r6(columnSolidM(feet())),
    feetRAfter: r6(radiusOf(feet())),
  };
  log.push(`DIG while embedded: down ${JSON.stringify(digDown)}, ahead `
    + `${JSON.stringify(digAhead)}, still inside ${dig.stillInside}`);

  // ------------------------------------------------------------- THE VERDICT
  const drove = [...walks.map((w) => w.ticksAdvanced), stand.ticksAdvanced,
    jump.ticksAdvanced, dig.ticksAdvanced];
  const allAdvanced = drove.every((n) => n > 0);
  const escapes = walks.filter((w) => w.escaped);
  const moved = walks.filter((w) => w.travelledHorizM > 0.5);
  const valid = allAdvanced && partsBuilt >= 2 && embedState.columnInsideSolidM > 0
    && walks.every((w) => w.startedEmbedded);
  const pass = valid && escapes.length > 0;

  return {
    valid, pass,
    verdict: !valid ? 'NOT MEASURED: see fail fields'
      : pass ? `RECOVERABLE: ${escapes.length} of 4 driven directions walked the `
        + `player out of a ${r3(M.wallH)} m wall`
      : `DEAD END: none of the four driven directions got the player out of a `
        + `${r3(M.wallH)} m wall`,
    sandbox,
    // Does placement refuse to bury the player? Both answers, measured.
    placementRefusesToBuryYou: {
      grid: routeA.placed > 0 && routeA.ghostOk === true ? false : null,
      free: freePlaced > 0 ? false : null,
      note: 'StructurePlacement.resolveTarget refuses on already-built, too '
        + 'high, unsupported, uneven ground and cost, and on nothing else; '
        + 'freeTarget checks ground and cost only. Neither looks at the player.',
      refusalReasonsSeen: [...reasons],
    },
    partsBuilt,
    wallsBuilt: parts().filter((q) => q.kind === 'wall').length,
    placements: structs().placements,
    refusals: structs().refusals,
    module: { cellM: r6(M.cellM), deckH: r6(M.deckH), wallH: r6(M.wallH),
      wallT: r6(M.wallT), storey: r6(M.storey) },
    structureStepUpM: of.stepUpM,
    slotKinds,
    routeA, embedState, stand, walks, bare, jump, dig,
    ticksAdvanced: { stand: stand.ticksAdvanced, jump: jump.ticksAdvanced,
      dig: dig.ticksAdvanced, walks: walks.map((w) => w.ticksAdvanced),
      routeAStart: tA0, routeBStart: tB0, routeBEnd: tB1 },
    movedInAtLeastOneDirection: moved.length,
    head: ss.slice(0, 12).map((x) => ({ t: x.tick, feet: r6(x.feetR),
      terrain: r6(x.terrainR), deck: r6(x.deckR), ground: r6(x.groundR),
      onDeck: x.onDeck, grounded: x.grounded, blocked: x.blockedByBuild })),
    log,
  };
})()
