// A picture of a small base on a levelled pad: level with Q, lay a block of
// foundations, wall three sides, hang a door on the fourth, then back off and
// look at it. Framing only; `build.js` is the acceptance.
//
//   node tools/smoke/run.mjs --scenario=walk \
//        --evalfile=tools/smoke/probes/buildshot.js \
//        --out=docs/screenshots/W6_buildshot_pad.png
//
(async (A) => {
  const of = window.__of;
  const sleep = (n) => of.run(n);
  const log = [];
  await sleep(0.6);
  const yaw0 = of.world().observer.yawDeg;

  // Stock, by harvesting, which is the only way a player can.
  for (const n of of.nodes()) {
    if (![0, 1].includes(n.kind)) continue;
    for (let k = 0; k < 8; ++k) of.harvest(n.index);
  }

  // Level a pad: hold Q while sweeping the aim across it, which is how the tool
  // is meant to be used (the target latches on the press, so the whole sweep
  // flattens to one height).
  of.look(yaw0, -50);
  await sleep(0.2);
  const tf0 = of.terraform();
  if (A.level !== false) {
    for (const dy of [-30, -15, 0, 15, 30]) {
      of.look((yaw0 + dy + 360) % 360, -50);
      of.input.tape([{ hold: 40, keys: ['KeyQ'] }, { hold: 6, keys: [] }]);
      await sleep(0.9);
    }
  }
  const tf1 = of.terraform();
  log.push(`levelled: dug ${tf1.removedCells - tf0.removedCells}, `
    + `filled ${tf1.addedCells - tf0.addedCells}`);

  const ghost = () => of.build().structGhost;
  const place = async (menu, want, lo, hi, yaws) => {
    of.build(menu);
    await sleep(0.1);
    for (const dy of yaws) {
      for (let p = lo; p <= hi; p += 2) {
        of.look((yaw0 + dy + 360) % 360, p);
        await sleep(0.05);
        const g = ghost();
        if (g === null || !g.ok || !want(g)) continue;
        of.input.tape([{ hold: 4, actions: ['use'] }, { hold: 6, keys: [] }]);
        await sleep(0.22);
        return g;
      }
    }
    return null;
  };

  // A block of foundations. Any valid cell will do; the site takes care of
  // making them line up.
  const cells = [];
  for (let k = 0; k < 9; ++k) {
    const g = await place(4, (gg) => !cells.includes(gg.key), -80, -25,
      [0, 20, -20, 40, -40]);
    if (g === null) break;
    cells.push(g.key);
  }
  log.push(`${cells.length} foundations`);

  // Walls on whatever edges are offered, then a door on one more.
  let walls = 0;
  const laid = new Set();
  for (let k = 0; k < 14; ++k) {
    const w = await place(6, (g) => !laid.has(g.key), -75, -18,
      [0, 20, -20, 40, -40, 70, -70, 110, -110, 160, -160]);
    if (w === null) break;
    laid.add(w.key);
    walls++;
  }
  const door = await place(7, () => true, -70, -20, [0, 25, -25, 50, -50, 90, -90]);
  log.push(`${walls} walls, door ${door === null ? 'none' : door.key}`);
  if (door !== null) {
    const d = of.game().structures.parts.find((p) => p.kind === 'door');
    if (d !== undefined) of.door(d.id, true);
  }
  of.build(0);
  await sleep(0.5);

  // Back off and frame it.
  of.look((yaw0 + 180) % 360, 0);
  await sleep(0.2);
  of.input.tape([{ hold: 70, keys: ['KeyW'] }, { hold: 10, keys: [] }]);
  await sleep(1.6);
  of.look(yaw0, A.pitch ?? -10);
  await sleep(0.8);

  const g = of.game();
  return {
    parts: g.structures.parts.length,
    sites: g.structures.sites,
    placements: g.structures.placements,
    refusals: g.structures.refusals,
    unevenRefusals: g.structures.unevenRefusals,
    view: g.baseView,
    drawCalls: of.stats().draw.calls,
    budget: of.stats().budget.drawCalls,
    log,
  };
})(typeof OF_ARGS === 'undefined' ? {} : OF_ARGS)
