// W6 DEMOLITION probe: a line runs, a belt is pulled out of the MIDDLE of it,
// the line stops, the belt goes back, and the line runs again.
//
// WHY THE MIDDLE TILE. Removing the end of a run proves almost nothing: the
// topology barely changes and the smelter keeps whatever was already in it.
// Removing a tile from the middle splits ONE transport line into TWO, and the
// half that reaches the smelter is no longer fed by the miner. If the rebuild
// were wrong in any of the obvious ways (stale runs, stale inserters, a network
// that was never re-wired) the smelter would keep producing and this probe would
// pass. So the assertion is the negative one: production must STOP.
//
// DW-20 EVERYWHERE. Each window checks /core's own tick counter moved by the
// expected amount BEFORE its numbers count, and every claim is a delta measured
// across a window rather than a state read once. The stall window is the same
// length as the running window, so "it stopped" is not "we did not wait".
(async () => {
  const of = window.__of;
  const sleep = (n) => of.run(n);
  const log = [];
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
  const eye = () => { const o = of.aim().origin; return { x: o[0], y: o[1], z: o[2] }; };
  const ore = () => of.nodes().find((n) => n.kind === 3 && n.remaining > 20)
            ?? of.nodes().find((n) => n.kind === 2 && n.remaining > 20);
  const fac = () => of.game().factory;
  const ironIn = () => (of.game().carried.find((c) => c.name === 'Iron') ?? { count: 0 }).count;

  await sleep(0.5);
  let node = ore();
  if (node === undefined) return { fail: 'no ore node in the clearing' };

  // --- face the deposit (autoline.js's search, guard and all) -----------------
  // `miss` is +Infinity BEHIND the eye: without that guard a heading 180 degrees
  // wrong scores as well as the right one, and the walk goes the wrong way while
  // reporting a good aim. That defect was found in this harness, not in the game.
  const miss = () => {
    const a = of.aim();
    const e = { x: a.origin[0], y: a.origin[1], z: a.origin[2] };
    const v = { x: node.x - e.x, y: node.y - e.y, z: node.z - e.z };
    const t = v.x * a.dir[0] + v.y * a.dir[1] + v.z * a.dir[2];
    if (t <= 0) return Infinity;
    return Math.hypot(v.x - a.dir[0] * t, v.y - a.dir[1] * t, v.z - a.dir[2] * t);
  };
  const aimAt = () => {
    let best = of.world().observer.yawDeg;
    for (const step of [20, 5, 1.5]) {
      const span = step === 20 ? 9 : 5;
      let bestMiss = Infinity;
      let bestYaw = best;
      for (let k = -span; k <= span; ++k) {
        of.look(best + k * step, -8);
        const m = miss();
        if (m < bestMiss) { bestMiss = m; bestYaw = best + k * step; }
      }
      best = bestYaw;
    }
    of.look(best, -8);
  };
  aimAt();

  let walked = 0;
  let best = dist(eye(), node);
  let worse = 0;
  for (let i = 0; i < 40; ++i) {
    node = of.nodes().find((n) => n.index === node.index);
    const d = dist(eye(), node);
    if (d < 8.6) break;
    if (d < best - 0.05) { best = d; worse = 0; }
    else if (++worse >= 2) { aimAt(); worse = 0; }
    of.input.tape([{ hold: 60, keys: ['KeyW'] }]);
    await sleep(1.1);
    walked++;
  }
  of.input.tape([{ hold: 2, keys: [] }]);
  await sleep(0.2);
  aimAt();
  const standoff = dist(eye(), node);
  log.push(`walked ${walked} bursts to ${standoff.toFixed(2)} m`);
  if (standoff > 10.6) return { fail: 'the walk never reached the deposit', standoff, log };

  // --- lay miner -> 4 belts -> smelter ---------------------------------------
  let yaw = of.world().observer.yawDeg;
  const placeHere = async () => {
    of.input.tape([{ hold: 3, keys: ['KeyG'] }, { hold: 4, keys: [] }]);
    await sleep(0.16);
  };
  const rotateTo = async (q) => {
    while (of.build().rotation !== q) {
      of.input.tape([{ hold: 3, keys: ['KeyR'] }, { hold: 3, keys: [] }]);
      await sleep(0.12);
    }
  };

  of.build(1);
  let minerPitch = null;
  for (let p = -9; p >= -34 && minerPitch === null; p -= 1.0) {
    of.look(yaw, p);
    await sleep(0.05);
    const g = of.build().ghost;
    if (g === null || !g.ok) continue;
    const before = fac().buildings;
    await placeHere();
    if (fac().buildings > before) minerPitch = p;
  }
  if (minerPitch === null) return { fail: 'no acceptable miner ghost on the deposit', log };

  of.build(2);
  await rotateTo(2);
  // Align the heading to the flow axis first: a heading off the axis steps the
  // cell diagonally, and consecutive tiles are then not each other's neighbour.
  {
    let bestYaw = yaw;
    let bestDot = -2;
    for (let k = -20; k <= 20; ++k) {
      of.look(yaw + k * 2, -30);
      await sleep(0.02);
      const g = of.build().ghost;
      const a = of.aim();
      if (g === null) continue;
      const d = a.dir[0] * g.fwd[0] + a.dir[1] * g.fwd[1] + a.dir[2] * g.fwd[2];
      if (-d > bestDot) { bestDot = -d; bestYaw = yaw + k * 2; }
    }
    yaw = bestYaw;
  }
  const beltPitch = [];
  const beltCells = [];
  for (let p = minerPitch - 2; p >= -62; p -= 1.2) {
    of.look(yaw, p);
    await sleep(0.04);
    const g = of.build().ghost;
    if (g === null || !g.ok || beltCells.includes(g.cell)) continue;
    if (beltCells.length >= 4) break;
    const before = fac().buildings;
    await placeHere();
    if (fac().buildings > before) { beltCells.push(g.cell); beltPitch.push(p); }
  }
  of.build(3);
  for (let p = -62; p >= -78; p -= 2) {
    of.look(yaw, p);
    await sleep(0.04);
    const g = of.build().ghost;
    if (g === null || !g.ok) continue;
    const before = fac().buildings;
    await placeHere();
    if (fac().buildings > before) break;
  }
  of.build(0);
  log.push(`line: ${fac().buildings} buildings, ${beltCells.length} belts`);
  if (beltCells.length < 3) return { fail: 'not enough belts to have a middle', log };

  // --- WINDOW A: the line runs unattended ------------------------------------
  const WINDOW = 14;
  const measure = async (label) => {
    const t0 = fac();
    const s0 = t0.list.find((b) => b.kind === 'smelter');
    const iron0 = ironIn();
    await sleep(WINDOW);
    const t1 = fac();
    const s1 = t1.list.find((b) => b.kind === 'smelter');
    // The smelter's buffer can be emptied by nothing here, so "produced" is the
    // buffer delta plus anything that reached the pack.
    const produced = (s1 === undefined ? 0 : s1.output) - (s0 === undefined ? 0 : s0.output)
      + (ironIn() - iron0);
    const w = {
      label,
      coreTicks: t1.coreTicks - t0.coreTicks,
      expected: WINDOW * 60,
      produced,
      smelterInput: s1 === undefined ? null : s1.input,
      runs: t1.runs.map((r) => r.tiles),
      buildings: t1.buildings,
    };
    log.push(`${label}: produced ${produced}, runs [${w.runs}], `
      + `input ${w.smelterInput}, ticks ${w.coreTicks}`);
    return w;
  };

  const running = await measure('running');

  // --- pull the MIDDLE tile out of the LONGEST run ---------------------------
  // CHOSEN BY TOPOLOGY, NOT BY THE ORDER THEY WERE LAID. The tiles a player
  // places do not always chain into one run (a heading a few degrees off the
  // lattice axis steps diagonally), so "the third belt I put down" is not
  // necessarily in the middle of anything. Asking the plan which run is longest
  // and taking its middle tile is the only choice guaranteed to SPLIT a line,
  // which is the whole point of the test.
  const plan0 = fac();
  const longest = plan0.runs.indexOf(plan0.runs.slice()
    .sort((x, y) => y.tiles - x.tiles)[0]);
  const inRun = plan0.list.filter((b) => b.kind === 'belt' && b.run === longest);
  if (inRun.length < 3) return { fail: 'no run long enough to have a middle', plan: plan0.list, log };
  const midBuild = inRun[Math.floor(inRun.length / 2)];
  const midCell = midBuild.cell;
  const removal = of.demolish({ id: midBuild.id });
  log.push(`removed the middle of run ${longest} (${midCell}): ${JSON.stringify(removal)}`);

  // LET THE RESIDUE FINISH. The claim is "the line stops", not "it stops in the
  // same tick": ore already inside the smelter is still smelted, and counting
  // that against the stall would be measuring the wrong thing. Five seconds is
  // well under the fourteen the window then measures.
  await sleep(5);
  const stalled = await measure('stalled');

  // --- put it back -----------------------------------------------------------
  // The player has not moved since the tiles went down, so the pitch that
  // placed a cell still looks at it; the band is swept anyway because the belt
  // being replaced is identified by CELL, and only that cell will do.
  of.build(2);
  await rotateTo(2);
  let rebuiltCell = null;
  for (let p = -20; p >= -72 && rebuiltCell === null; p -= 0.4) {
    of.look(yaw, p);
    await sleep(0.03);
    const g = of.build().ghost;
    if (g === null || !g.ok || g.cell !== midCell) continue;
    const n0 = fac().buildings;
    await placeHere();
    if (fac().buildings > n0) rebuiltCell = g.cell;
  }
  of.build(0);
  log.push(`rebuilt ${rebuiltCell ?? 'NOTHING'}`);

  const rebuilt = await measure('rebuilt');

  // --- THE KEY ITSELF -------------------------------------------------------
  // Everything above went through of.demolish, which is the X key's own
  // handler; this proves the KEY reaches it. Whatever is under the crosshair is
  // fair game, so the assertion is only that exactly one building went and the
  // ledger grew, which is all a keybinding has to prove.
  of.look(yaw, -30);
  await sleep(0.2);
  const keyBefore = of.game();
  of.input.tape([{ hold: 3, keys: ['KeyX'] }, { hold: 5, keys: [] }]);
  await sleep(0.3);
  const keyAfter = of.game();
  const byKey = {
    buildingsBefore: keyBefore.factory.buildings,
    buildingsAfter: keyAfter.factory.buildings,
    removalsBefore: keyBefore.demolition.buildings,
    removalsAfter: keyAfter.demolition.buildings,
  };
  log.push(`X key: ${byKey.buildingsBefore} -> ${byKey.buildingsAfter} buildings`);

  const dem = of.game().demolition;
  const packIron = ironIn();

  return {
    advanced: {
      windows: [running, stalled, rebuilt].map((w) => ({
        label: w.label, coreTicks: w.coreTicks, expected: w.expected,
      })),
      rebuilds: fac().rebuilds,
    },
    // THE CLAIM. Not "removal returned", but: it produced, then it did not,
    // then it produced again, over three windows of identical length.
    line: { running: running.produced, stalled: stalled.produced, rebuilt: rebuilt.produced },
    topology: {
      runsRunning: running.runs, runsStalled: stalled.runs, runsRebuilt: rebuilt.runs,
      buildings: [running.buildings, stalled.buildings, rebuilt.buildings],
      removedCell: midCell, rebuiltCell, byKey,
    },
    ledger: {
      ...dem,
      // Nothing may be invented by a removal: the pack's iron can only ever have
      // come from the smelter, so a refund larger than what existed is a bug.
      packIron,
      refundOfRemoval: removal,
    },
    valid:
      // every window actually ran, by /core's own counter
      [running, stalled, rebuilt].every((w) => Math.abs(w.coreTicks - w.expected) <= 90)
      // the line worked, then the removal stopped it, then it worked again
      && running.produced > 0
      && stalled.produced === 0
      && rebuilt.produced > 0
      // the plan lost exactly one building and got exactly one back
      && stalled.buildings === running.buildings - 1
      && rebuilt.buildings === running.buildings
      && rebuiltCell === midCell
      // the removal split the run in two and the rebuild merged it again
      && stalled.runs.length > running.runs.length
      && rebuilt.runs.length === running.runs.length
      // and the loss is counted rather than swallowed
      && dem.buildings >= 2 && dem.itemsLost >= 0
      // and the X KEY reaches the same handler
      && byKey.buildingsAfter === byKey.buildingsBefore - 1
      && byKey.removalsAfter === byKey.removalsBefore + 1,
    audio: of.game().audio,
    fx: of.game().fx,
    plan: fac().list,
    cost: { drawCalls: of.stats().draw.calls, budget: of.stats().budget.drawCalls },
    log,
  };
})()
