// W6 BUILD-MODE probe: the ghost, the grid and the refusal, before anything is
// placed.
//
// The claim under test is not "a preview object exists". It is that the preview
// tells the truth: that it snaps to /core's own 1 m lattice, that R turns it in
// exact quarter turns, and that it goes RED for the same reasons a placement
// would be refused. A green ghost over a spot that will not accept the building
// is worse than no ghost at all.
(async () => {
  const of = window.__of;
  const sleep = (n) => of.run(n);
  const log = [];

  await sleep(0.5);
  const t0 = of.world().tick;
  const yaw = of.world().observer.yawDeg;

  // --- nothing selected means no ghost --------------------------------------
  of.build(0);
  await sleep(0.1);
  const offGhost = of.build();

  // --- select a belt: the ghost appears and reports a lattice cell ----------
  of.build(2);
  of.look(yaw, -32);
  await sleep(0.15);
  const g0 = of.build();
  if (g0.ghost === null) return { fail: 'no ghost with a machine selected', g0 };

  // --- R turns it in exact quarter turns, and comes back round -------------
  const dirs = [g0.ghost.fwd];
  const rots = [g0.rotation];
  for (let i = 0; i < 4; ++i) {
    of.input.tape([{ hold: 3, keys: ['KeyR'] }, { hold: 4, keys: [] }]);
    await sleep(0.15);
    const b = of.build();
    rots.push(b.rotation);
    dirs.push(b.ghost.fwd);
  }
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  // Consecutive turns are perpendicular; four turns return to the start.
  const perp = [0, 1, 2, 3].map((i) => Math.abs(dot(dirs[i], dirs[i + 1])));
  const closed = dot(dirs[0], dirs[4]);
  log.push(`rotations ${rots.join('->')}  perp max ${Math.max(...perp).toFixed(4)}` +
           `  closure ${closed.toFixed(4)}`);

  // --- the ghost lands on a lattice CELL, and moving one cell changes it ----
  const cellA = of.build().ghost.cell;
  const posA = of.build().ghost.pos;
  of.look(yaw, -44);
  await sleep(0.1);
  const cellB = of.build().ghost.cell;
  const posB = of.build().ghost.pos;
  const moved = Math.hypot(posA[0] - posB[0], posA[1] - posB[1], posA[2] - posB[2]);
  log.push(`cell ${cellA} -> ${cellB}, ${moved.toFixed(3)} m apart`);

  // --- a MINER off a deposit is refused, and says why, in red --------------
  of.build(1);
  of.look(yaw, -50);
  await sleep(0.15);
  const noOre = of.build();

  // --- place the belt, then aim back at it: the cell is taken -------------
  of.build(2);
  of.look(yaw, -32);
  await sleep(0.15);
  const before = of.game().factory.buildings;
  of.input.tape([{ hold: 3, keys: ['KeyG'] }, { hold: 6, keys: [] }]);
  await sleep(0.25);
  const placed = of.game().factory.buildings - before;
  await sleep(0.15);
  const taken = of.build();

  // Frame the capture on the ghost beside what was just placed.
  of.build(2);
  of.look(yaw, -27);
  await sleep(0.4);

  return {
    advanced: { ticks: of.world().tick - t0, placed },
    ghost: {
      hiddenWhenNothingSelected: offGhost.ghost === null && offGhost.visible === false,
      visible: of.build().visible,
      cellA, cellB, cellsDifferM: +moved.toFixed(3),
      rotations: rots,
      quarterTurnMaxDot: +Math.max(...perp).toFixed(4),
      fourTurnsClosure: +closed.toFixed(4),
    },
    refusals: {
      minerOffDeposit: { ok: noOre.ghost.ok, reason: noOre.ghost.reason },
      cellTaken: { ok: taken.ghost.ok, reason: taken.ghost.reason },
    },
    valid:
      offGhost.ghost === null && offGhost.visible === false
      && placed === 1
      // exact quarter turns: consecutive headings are perpendicular...
      && Math.max(...perp) < 1e-3
      // ...and four of them come back to where they started
      && closed > 0.999
      // the snap is to a lattice cell, and neighbouring cells are 1 m apart
      && cellA !== cellB && moved > 0.5 && moved < 3.01
      // and the ghost refuses for the reasons a placement would
      // The refusal is the sentence that teaches the mechanic, so it is matched
      // as text and not as a boolean.
      && noOre.ghost.ok === false
      && noOre.ghost.reason === 'you cannot place a drill here, there is no ore'
      && taken.ghost.ok === false && taken.ghost.reason === 'cell taken',
    build: of.build(),
    view: of.game().view,
    cost: { drawCalls: of.stats().draw.calls, budget: of.stats().budget.drawCalls },
    log,
  };
})()
