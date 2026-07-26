// MEASUREMENT, not acceptance: what the ground under a 1 m footprint actually
// does, so DW-24's tolerance is a number that was read off the shipped terrain
// rather than a number somebody liked the look of.
//
// Three things are measured.
//   1. LOCAL UNEVENNESS: the spread of the five footprint samples of a deck,
//      against the ground under its own centre. This is what a single
//      foundation dropped on ordinary ground has to survive.
//   2. THE SAME after one press of Q, which is what a levelled pad looks like.
//   3. THE LATTICE STEP: how many metres of ground one unit step of a /core
//      cell key actually covers, which is the claim that the structural grid
//      cannot be the voxel lattice.
(async () => {
  const of = window.__of;
  const sleep = (n) => of.run(n);
  await sleep(0.6);
  const t0 = of.world().tick;

  const st = of.structures();
  if (st === null) return { fail: 'no structures' };
  const feet = of.world().player.feet;
  const site = st.prospectiveSite({ x: feet[0], y: feet[1], z: feet[2] });
  const C = st.module.cellM, H = C * 0.5;

  // The five footprint points of the deck at (i,j), and the ground under each.
  const devsOf = (i, j) => {
    const out = [];
    for (const [de, dn] of [[0, 0], [-H, -H], [H, -H], [-H, H], [H, H]]) {
      const e = (i + 0.5) * C + de, n = (j + 0.5) * C + dn;
      const x = site.o.x + site.east.x * e + site.north.x * n;
      const y = site.o.y + site.east.y * e + site.north.y * n;
      const z = site.o.z + site.east.z * e + site.north.z * n;
      out.push(st.groundRadius(x, y, z) - Math.hypot(x, y, z));
    }
    return out;
  };

  // 1. local unevenness over a 20 x 20 grid of cells around the player.
  const local = [];
  const plane = [];
  for (let i = -10; i < 10; ++i) {
    for (let j = -10; j < 10; ++j) {
      const d = devsOf(i, j);
      // Local: every corner against the cell's own centre, which is what a
      // foundation founding its own site would be judged by.
      local.push(Math.max(...d.map((v) => Math.abs(v - d[0]))));
      // Plane: every corner against the SITE plane, which is what the second
      // and later parts of a base are judged by.
      plane.push(Math.max(...d.map(Math.abs)));
    }
  }
  const pct = (a, p) => {
    const s = [...a].sort((x, y) => x - y);
    return s[Math.min(s.length - 1, Math.floor(s.length * p))];
  };

  // 2. after one press of Q, aimed steeply down so the 6 m disc lands on the
  //    cells being sampled. Both numbers again: local spread AND the deviation
  //    from the site plane, which is what the placement rule actually uses.
  const yaw = of.world().observer.yawDeg;
  of.look(yaw, -72);
  await sleep(0.25);
  const lv = of.level();
  await sleep(0.5);
  const levelled = [];
  const levelledPlane = [];
  for (let i = -2; i < 2; ++i) {
    for (let j = -2; j < 2; ++j) {
      const d = devsOf(i, j);
      levelled.push(Math.max(...d.map((v) => Math.abs(v - d[0]))));
      levelledPlane.push(Math.max(...d.map(Math.abs)));
    }
  }

  // 3. one unit step of a /core cell key, in metres of ground. Sampled by
  //    walking the machine grid's own snap, which is what a belt uses.
  const steps = [];
  const g = of.game();
  const base = { x: feet[0], y: feet[1], z: feet[2] };
  for (const ax of [[1, 0, 0], [0, 1, 0], [0, 0, 1]]) {
    const a = of.snapCell(base.x, base.y, base.z);
    const b = of.snapCell(base.x + ax[0], base.y + ax[1], base.z + ax[2]);
    if (a === null || b === null) continue;
    steps.push(+Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]).toFixed(3));
  }

  return {
    advanced: { ticks: of.world().tick - t0 },
    localUnevennessM: {
      n: local.length,
      median: +pct(local, 0.5).toFixed(4),
      p90: +pct(local, 0.9).toFixed(4),
      p95: +pct(local, 0.95).toFixed(4),
      max: +Math.max(...local).toFixed(4),
    },
    planeDeviationM: {
      median: +pct(plane, 0.5).toFixed(4),
      p95: +pct(plane, 0.95).toFixed(4),
      max: +Math.max(...plane).toFixed(4),
    },
    afterLevellingM: {
      n: levelled.length,
      cellsDug: lv === null ? 0 : lv.dug, cellsFilled: lv === null ? 0 : lv.filled,
      localMedian: +pct(levelled, 0.5).toFixed(4),
      localMax: +Math.max(...levelled).toFixed(4),
      planeMedian: +pct(levelledPlane, 0.5).toFixed(4),
      planeMax: +Math.max(...levelledPlane).toFixed(4),
    },
    latticeStepM: steps,
    tolerance: [st.floatToleranceM, st.buryToleranceM],
    log: [`site plane at r=${site.baseR.toFixed(2)}`],
    game: g === null ? null : g.structures.module,
  };
})()
