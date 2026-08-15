// W6 BUILD-MODE probe: the ghost, the grid and the refusal.
//
//   node tools/smoke/run.mjs --scenario=walk \
//        --evalfile=tools/smoke/probes/buildghost.js \
//        --out=docs/screenshots/W6_build_ghost.png
//
// The claim under test is not "a preview object exists". It is that the preview
// tells the truth: that it snaps to the METRIC site grid, that R turns it in
// exact quarter turns, and that it goes RED for the same reasons a placement
// would be refused. A green ghost over a spot that will not accept the building
// is worse than no ghost at all.
//
// THE GRID IS THE MEASUREMENT THAT CHANGED. A machine used to snap to /core's
// 1 m body-frame voxel lattice, which the ground sphere cuts obliquely, so one
// unit step of a cell key covered 0.59, 0.81 or 1.02 m of ground depending on
// the axis. It now snaps to the same metric site grid the base-building parts
// use (MachinePlacement.ts), where the spacing is EXACTLY the module the assets
// ship. So the assertion below is no longer "somewhere between half a metre and
// three": consecutive cells are a whole number of modules apart in the tangent
// plane, and the residual is asserted against zero.
//
// The placement is a real left click. `use` is asked for by ACTION and never by
// key, because place moved off G onto the mouse (Bindings.ts).
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

  // --- select a belt: the ghost appears and reports a grid cell -------------
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

  // --- place the belt, then aim back at it: the cell is taken -------------
  // THIS COMES FIRST, and it has to. A machine cell is an address on a SITE, and
  // until a site has been adopted every ghost founds a fresh PROSPECTIVE one on
  // the lattice cell under its own aim point (MachinePlacement.siteAt), so its
  // address is 0,0 wherever the crosshair happens to be and two different spots
  // report the same key. Placing one tile adopts a real site, and only then does
  // comparing two cell keys mean anything at all. build.js makes the same move
  // for the same reason with the structural ghost.
  const before = of.game().factory.buildings;
  of.input.tape([{ hold: 3, actions: ['use'] }, { hold: 6, keys: [] }]);
  await sleep(0.25);
  const placed = of.game().factory.buildings - before;
  await sleep(0.15);
  const taken = of.build();

  // --- the ghost lands on a grid CELL, a whole number of modules away -------
  // The separation is SPLIT, the way controls.js splits a belt run's: the
  // TANGENT-PLANE component, which the site grid owns, and the radial rise,
  // which is the terrain following its own oracle and is allowed to be anything.
  // Taking the 3D distance instead would fold a slope into the grid measurement
  // and hide exactly the error being looked for.
  //
  // AND THE EXPECTED DISTANCE IS READ OUT OF THE CELL KEYS, not assumed to be
  // one module: two cells a pitch step apart may be a diagonal, and a diagonal
  // is 1.414 modules and not 1. Comparing against |(di,dj)| * module is what
  // makes the assertion exact instead of a band.
  const module = of.game().structures.module.cellM;
  // `m<siteId>:<i>,<j>` (MachinePlacement.machineCellKey).
  const addrOf = (c) => {
    const k = c.indexOf(':');
    const ij = c.slice(k + 1).split(',').map(Number);
    return { site: c.slice(0, k), i: ij[0], j: ij[1] };
  };
  of.look(yaw, -38);
  await sleep(0.12);
  const cellA = of.build().ghost.cell;
  const posA = of.build().ghost.pos;
  of.look(yaw, -46);
  await sleep(0.12);
  const cellB = of.build().ghost.cell;
  const posB = of.build().ghost.pos;
  const moved = Math.hypot(posA[0] - posB[0], posA[1] - posB[1], posA[2] - posB[2]);
  const gridStep = (() => {
    const a = addrOf(cellA);
    const b = addrOf(cellB);
    const d = [posB[0] - posA[0], posB[1] - posA[1], posB[2] - posA[2]];
    const ra = Math.hypot(...posA) || 1;
    const rb = Math.hypot(...posB) || 1;
    let up = [posA[0] / ra + posB[0] / rb, posA[1] / ra + posB[1] / rb,
      posA[2] / ra + posB[2] / rb];
    const ul = Math.hypot(...up) || 1;
    up = [up[0] / ul, up[1] / ul, up[2] / ul];
    const rise = dot(d, up);
    const tang = Math.hypot(d[0] - up[0] * rise, d[1] - up[1] * rise,
      d[2] - up[2] * rise);
    const di = b.i - a.i;
    const dj = b.j - a.j;
    const expect = module * Math.hypot(di, dj);
    return { tangentialM: tang, riseM: rise, di, dj,
      sameSite: a.site === b.site, expectedM: expect,
      errorM: Math.abs(tang - expect) };
  })();
  log.push(`cell ${cellA} -> ${cellB}, ${moved.toFixed(3)} m apart `
    + `(${gridStep.tangentialM.toFixed(6)} m tangential against `
    + `${gridStep.expectedM.toFixed(6)} m of grid, `
    + `error ${gridStep.errorM.toExponential(2)} m, `
    + `rise ${gridStep.riseM.toFixed(3)} m)`);

  // --- a MINER off a deposit is refused, and says why, in red --------------
  of.build(1);
  of.look(yaw, -50);
  await sleep(0.15);
  const noOre = of.build();

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
      moduleM: module,
      // THE NUMBER the grid change is worth: how far the ground between two cells
      // is from what their addresses say it should be. The old body-frame lattice
      // was out by up to 0.41 m here.
      cellStepTangentialM: +gridStep.tangentialM.toFixed(9),
      cellStepExpectedM: +gridStep.expectedM.toFixed(9),
      cellStepAddrDelta: [gridStep.di, gridStep.dj],
      cellStepErrorM: +gridStep.errorM.toExponential(3),
      cellStepRiseM: +gridStep.riseM.toFixed(4),
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
      // the snap is to a grid cell on ONE site, and the ground between two cells
      // is exactly what their two addresses say it is. Not a band: the metric
      // site grid has no reason to be a fraction of a module out, so a fraction
      // is the defect this grid was changed to remove.
      && cellA !== cellB && gridStep.sameSite
      && Math.hypot(gridStep.di, gridStep.dj) >= 1
      && gridStep.errorM < 1e-3
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
