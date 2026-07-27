// FS-26 and FS-27: belts snap to what is already there, and R turns a tile that
// is already down.
//
//   node tools/smoke/run.mjs --scenario=walk \
//        --evalfile=tools/smoke/probes/beltsnap.js \
//        --out=docs/screenshots/W11_belt_snap.png
//
// Reid, verbatim, twice: "after a belt is already placed, if i want to place
// another belt to extend it they dont snap together. Or if I already have a belt
// and want to attach a smelter at the end, it doesnt snap to it"; and "make it
// like factorio where i can change the direction after i place it".
//
// FOUR THINGS ARE MEASURED AND THE FOURTH IS THE ONE THAT COULD REGRESS.
//
//   1. belt to belt. Place a tile by aiming at the run head's `socket_belt_out`
//      and measure the gap between that socket and the new tile's own
//      `socket_belt_in`. They are coincident BY CONSTRUCTION (0.5 m ahead of one
//      centre is 0.5 m behind the next, and cells are exactly 1.000 m apart), so
//      the number is only near zero if the client and the shipped .glb agree.
//   2. belt to machine. Same gesture with a smelter in hand, and the acceptance
//      is not only the distance: `links` must contain an inserter from the run's
//      head to the smelter, because "it snapped to the belt" and "it is fed by
//      the belt" are different claims and only the second one is the feature.
//   3. R turns a PLACED tile, and the turn SURVIVES THE COMMIT. This is the
//      whole of FS-27: `pitchRuns` used to rewrite every tile's heading from the
//      run's geometry, so a turn lasted until the next commit and FS-18
//      responded by withdrawing the key rather than the overwrite.
//   4. A DRAGGED RUN IS STILL EXACTLY ONE TRANSPORT LINE. That is the property
//      the old behaviour was protecting and the one thing this change could
//      plausibly break: if `pitchRuns` no longer straightens headings, a drag
//      whose tiles are not already pointing at their successors would chain into
//      several lines and the ore would silently never arrive. It is asserted
//      BEFORE anything is turned and again at the very end.
(async () => {
  const of = window.__of;
  const log = [];
  // `of.run` and NOT a neutral tape: playTape REPLACES whatever is playing, so
  // settling with an empty tape releases a button that is being held and ends a
  // drag mid-gesture.
  const settle = (secs) => of.run(secs, 60);
  // `of.game()` REBUILDS its report on every call, so anything compared across
  // a call has to be read out into plain values first. Three probes have been
  // caught by an `indexOf` against a freshly built array.
  const fac = () => of.game().factory;
  const bld = () => of.build();
  const view = () => of.game().view;
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const headingOf = (list, id) => {
    const r = list.find((b) => b.id === id);
    return r === undefined ? null : r.fwd.slice();
  };

  await settle(1.0);
  await of.wipe();
  if (of.game() === null) return { valid: false, why: 'no gameplay layer' };
  const yaw0 = of.world().observer.yawDeg;

  // --- 0. one tile, to adopt a site --------------------------------------
  // Until a site exists every ghost founds a fresh PROSPECTIVE one on the
  // lattice cell under its own aim point (FS-19), so every cell it reports is
  // 0,0 and no two aims can be told apart. One press fixes it.
  of.build(2);
  of.look(yaw0, -58);
  await settle(0.3);
  of.input.tape([{ hold: 3, actions: ['use'] }, { hold: 6, keys: [] }]);
  await settle(0.4);
  if (fac().buildings === 0) return { valid: false, why: 'the seed tile would not go down' };

  // --- 1. a dragged run, which must be ONE line --------------------------
  // THE CELLS ARE SEARCHED FOR, NOT DEAD-RECKONED, which `beltcurve.js` learned
  // the hard way: a pitch sweep does not walk the grid at a constant rate, and
  // aiming by arithmetic lays a run that doubles back on itself. The first
  // version of THIS probe did exactly that and produced a two-tile run whose
  // first drag step went BACKWARDS past the seed tile. Ask the ghost.
  const addr = (c) => {
    const k = c.indexOf(':');
    const ij = c.slice(k + 1).split(',').map(Number);
    return { site: c.slice(0, k), i: ij[0], j: ij[1] };
  };
  const ghostAt = async (p) => {
    of.look(yaw0, p);
    await settle(0.05);
    const g = bld().ghost;
    return g === null ? null : { cell: g.cell, ...addr(g.cell), ok: g.ok, pitch: p };
  };
  const walk = [];
  for (let p = -62; p <= -12; p += 0.4) {
    const s = await ghostAt(p);
    if (s === null) continue;
    const last = walk[walk.length - 1];
    if (last !== undefined && last.cell === s.cell) continue;
    walk.push(s);
  }
  // THE DRAG MUST NOT CROSS THE SEED TILE. A refused cell ENDS a drag by design
  // (`BuildMode.dragRun`: a run with a hole in it is not a run), so starting on
  // the far side of the seed and sweeping past it lays exactly one tile and
  // stops. Measured, on this probe's second draft: one tile, and it read as the
  // product being broken when it was the gesture that was wrong. So the far end
  // is chosen first and the start is one cell from the seed TOWARDS it.
  const seed = addr(fac().list[0].cell);
  const far = walk.filter((s) => s.ok && s.site === seed.site && s.j === seed.j
    && Math.abs(s.i - seed.i) >= 6);
  const c1 = far.length === 0 ? null : far[far.length - 1];
  const c0 = c1 === null ? null
    : walk.find((s) => s.ok && s.site === seed.site && s.j === seed.j
      && s.i === seed.i + Math.sign(c1.i - seed.i));
  if (c1 === null || c0 === undefined || c0 === null) {
    return { valid: false, why: 'no straight leg of six cells on this heading',
      seed, c0, c1, walk: walk.map((s) => s.cell), log };
  }
  log.push(`drag ${c0.cell} (pitch ${c0.pitch}) -> ${c1.cell} (pitch ${c1.pitch})`);
  of.look(yaw0, c0.pitch);
  await settle(0.2);
  of.input.tape([{ hold: 600, actions: ['use'] }]);
  await settle(0.25);
  of.look(yaw0, c1.pitch);
  await settle(0.9);
  of.input.tape([{ hold: 6, keys: [] }]);
  await settle(0.4);
  const dragged = fac();
  const draggedOneLine = dragged.runs.length === 1
    && dragged.runs[0].tiles === dragged.buildings && dragged.buildings >= 4;
  log.push(`drag: ${dragged.buildings} tiles, ${dragged.runs.length} run(s), `
    + `longest ${bld().longestDrag}`);
  if (!draggedOneLine) {
    const list = dragged.list.map((b) => ({ id: b.id, cell: b.cell,
      fwd: b.fwd.map((v) => +v.toFixed(4)),
      pos: b.pos.map((v) => +v.toFixed(3)) }));
    const gaps = list.slice(1).map((b, i) => +Math.hypot(
      b.pos[0] - list[i].pos[0], b.pos[1] - list[i].pos[1],
      b.pos[2] - list[i].pos[2]).toFixed(4));
    return { valid: false, why: 'the drag did not chain into one line',
      buildings: dragged.buildings, runs: dragged.runs, list, gaps, log };
  }
  const headId = dragged.runs[0].head;

  /**
   * Hunt for an aim at which the ghost reports catching `want` on `onId`.
   *
   * A yaw sweep at a fixed pitch traces an ARC, so dead reckoning misses; this
   * asks the ghost where it actually is, which is what a player does by watching
   * the preview. Returns the aim, or null.
   */
  const findSnap = async (want, onId, seen) => {
    for (let p = -50; p <= -8; p += 0.5) {
      for (const y of [yaw0, yaw0 - 4, yaw0 + 4, yaw0 - 8, yaw0 + 8]) {
        of.look((y + 720) % 360, p);
        await settle(0.05);
        const g = bld().ghost;
        if (g === null || g.snapped === '') continue;
        if (seen !== undefined) seen.add(`${g.snapped}${g.ok ? '' : ' [refused]'}`);
        if (!g.ok || !g.snapped.startsWith(`#${onId} ${want}`)) continue;
        return { yaw: (y + 720) % 360, pitch: p, snapped: g.snapped, cell: g.cell };
      }
    }
    return null;
  };

  // --- 2. BELT TO BELT ---------------------------------------------------
  const seenBelt = new Set();
  const beltAim = await findSnap('socket_belt_out', headId, seenBelt);
  if (beltAim === null) {
    return { valid: false, why: 'no aim caught the run head socket_belt_out',
      headId, log };
  }
  const before2 = fac().buildings;
  of.input.tape([{ hold: 3, actions: ['use'] }, { hold: 6, keys: [] }]);
  await settle(0.4);
  const b2 = bld();
  const after2 = fac();
  const beltGapM = b2.lastSnapGapM;
  log.push(`belt->belt: ${beltAim.snapped}, gap ${beltGapM.toExponential(3)} m, `
    + `${after2.buildings - before2} tile laid, ${after2.runs.length} run(s)`);

  // --- 3. BELT TO MACHINE ------------------------------------------------
  const head2 = after2.runs[0].head;
  of.build(3);                                   // the smelter
  await settle(0.2);
  const seenMach = new Set();
  const machAim = await findSnap('socket_belt_out', head2, seenMach);
  let machGapM = -1;
  let machCentreM = -1;
  let smelterId = -1;
  let fedByHead = false;
  if (machAim !== null) {
    const before3 = fac().buildings;
    of.input.tape([{ hold: 3, actions: ['use'] }, { hold: 6, keys: [] }]);
    await settle(0.5);
    machGapM = bld().lastSnapGapM;
    const after3 = fac();
    const made = after3.list.filter((b) => b.kind === 'smelter');
    smelterId = made.length > 0 ? made[made.length - 1].id : -1;
    // THE ASSERTION THAT MATTERS. A smelter that landed next to the belt and is
    // not wired to it has snapped to nothing that a player would call snapping.
    fedByHead = after3.links.some((l) => l.from === head2 && l.to === smelterId);
    // CENTRE TO CENTRE, because the socket gap alone cannot tell one cell from
    // two: a smelter's inlet sits 1.0 m behind its own centre, so moving it a
    // whole cell further out moves the inlet the same cell and the socket-to-
    // socket distance is IDENTICAL either way. This is the number that says
    // FactorySnap.stepsFor put the 2 m machine two cells clear of the 1 m tile
    // instead of one cell into it.
    const headRow = after3.list.find((b) => b.id === head2);
    const smRow = after3.list.find((b) => b.id === smelterId);
    machCentreM = headRow === undefined || smRow === undefined ? -1
      : Math.hypot(smRow.pos[0] - headRow.pos[0], smRow.pos[1] - headRow.pos[1],
        smRow.pos[2] - headRow.pos[2]);
    log.push(`belt->machine: ${machAim.snapped}, gap ${machGapM.toFixed(4)} m, `
      + `${after3.buildings - before3} placed, wired ${fedByHead}`);
  }

  // --- 4. R TURNS A PLACED TILE, AND IT STICKS ---------------------------
  // The hand, because R means the GHOST while a part is held and the WORLD when
  // it is not, which is Factorio's own split.
  of.build(0);
  await settle(0.2);
  const turnTries = [];
  let turned = null;
  for (let p = -44; p <= -16 && turned === null; p += 1.0) {
    of.look(yaw0, p);
    await settle(0.06);
    const beforeList = fac().list.map((b) => ({ id: b.id, kind: b.kind,
      fwd: b.fwd.slice() }));
    const turns0 = bld().turns;
    of.input.press('rotate', 4);
    await settle(0.35);
    if (bld().turns === turns0) continue;
    const afterList = fac().list;
    const moved = beforeList.filter((b) => {
      const now = headingOf(afterList, b.id);
      return now !== null && dot(b.fwd, now) < 0.99;
    });
    if (moved.length !== 1) {
      turnTries.push({ pitch: p, moved: moved.length });
      continue;
    }
    const id = moved[0].id;
    const now = headingOf(afterList, id);
    const run = fac().runs.find((r) => r.head === id || r.tail === id);
    turned = {
      id, kind: moved[0].kind, pitch: p,
      was: moved[0].fwd.map((v) => +v.toFixed(4)),
      now: now.map((v) => +v.toFixed(4)),
      // 0 for a square turn. THIS is the FS-27 property: it is read back AFTER
      // the commit that used to overwrite it.
      cosToOld: +dot(moved[0].fwd, now).toFixed(6),
      wasEndOfRun: run !== undefined,
    };
  }
  const afterTurn = fac();
  const v = view();

  of.look(yaw0, -30);
  await settle(0.6);
  const final = fac();

  return {
    valid: draggedOneLine && beltAim !== null && beltGapM >= 0
      && turned !== null && (of.world().tick > 200),
    // --- THE FOUR NUMBERS --------------------------------------------------
    // 1. belt to belt. Coincident sockets, so this is float noise plus whatever
    //    the ground slope contributes through the tile pitch.
    beltToBeltGapM: beltGapM,
    beltToBeltSnapped: beltAim.snapped,
    beltToBeltUnderMm: beltGapM >= 0 && beltGapM < 0.05,
    // 2. belt to machine. The distance is the assets' own authored offset and is
    //    NOT expected to be zero (a smelter's inlet is 0.9 m up, a belt's outlet
    //    0.25 m); `wired` is the acceptance.
    beltToMachineGapM: machGapM,
    beltToMachineSnapped: machAim === null ? '' : machAim.snapped,
    beltToMachineWired: fedByHead,
    beltToMachineCentreM: machCentreM < 0 ? -1 : +machCentreM.toFixed(4),
    machineHeadId: head2,
    machineSocketsSeen: [...seenMach],
    // 3. R, and that the run respected it. A square turn reads cos 0.
    turned,
    turnSurvivedCommit: turned !== null && Math.abs(turned.cosToOld) < 0.05,
    turnTries,
    curvesAfterTurn: v.curves,
    runsAfterTurn: afterTurn.runs.length,
    // 4. and the property the old behaviour was protecting, asserted twice.
    draggedOneLine,
    draggedTiles: dragged.buildings,
    snaps: bld().snaps,
    turns: bld().turns,
    buildings: final.buildings,
    runs: final.runs,
    links: final.links,
    cost: { frameMs: of.stats().frameMs, draw: of.stats().draw.calls },
    log,
  };
})()
