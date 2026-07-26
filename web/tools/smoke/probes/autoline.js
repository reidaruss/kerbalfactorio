// W6 AUTO-LINE probe: the acceptance for the whole milestone.
//
// Place a miner on an ore deposit, run a belt from it to a smelter, THEN STOP
// TOUCHING ANYTHING, and check that iron accumulated. Every placement goes
// through the real build mode (number key, R, G) driven by an input tape, so
// nothing here reaches a path a player cannot reach.
//
// DW-20 IS THE WHOLE POINT of the `advanced` block. "of_net_step_n returned"
// proves nothing. What is asserted is that /core's own tick counter moved by the
// number of ticks the unattended window was, and that ore physically left the
// world node. Every number after that is a DELTA:
//
//   the node lost EXACTLY what the miner extracted   (one pool of ore)
//   ingots exist that nobody hand-fed                 (the line actually ran)
//   no ingot appeared that no ore paid for            (nothing was invented)
//   the pack grew by EXACTLY what collection removed  (nothing was duplicated)
(async () => {
  const of = window.__of;
  const sleep = (n) => of.run(n);
  const log = [];
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
  const eye = () => { const o = of.aim().origin; return { x: o[0], y: o[1], z: o[2] }; };
  const ore = () => of.nodes().find((n) => n.kind === 3 && n.remaining > 20)
            ?? of.nodes().find((n) => n.kind === 2 && n.remaining > 20);

  await sleep(0.5);
  const t0 = of.world().tick;
  let node = ore();
  if (node === undefined) return { fail: 'no ore node in the clearing' };

  // --- face the deposit ------------------------------------------------------
  // Sweep yaw and keep the heading whose ray passes closest to the node. The
  // observer yaw is in a local tangent frame, so it cannot be computed from
  // world coordinates without re-deriving that frame here; measuring is both
  // shorter and impossible to get subtly wrong.
  // `miss` is +Infinity BEHIND the eye. Without that guard a heading 180 degrees
  // wrong scores as well as the right one (the perpendicular distance to a line
  // does not care which way along it the target lies), and the probe walks away
  // from the deposit reporting a good aim. That is a DW-20 failure in the
  // harness itself: a measurement that is confidently backwards.
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
  log.push(`faced the node, miss ${miss().toFixed(2)} m at ${node.distanceM.toFixed(1)} m`);

  // --- walk in until the deposit is a build's length away --------------------
  // Bursts, not one long tape, and STEERED BY MEASURED PROGRESS: the heading is
  // only re-taken when the distance stops falling. Aiming every burst is worse,
  // not better, because the walk drifts a little each time it is re-pointed and
  // the player ends up circling the deposit at a fixed radius.
  let walked = 0;
  const closed = dist(eye(), node);
  let best = closed;
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
  log.push(`walked ${walked} bursts, ${closed.toFixed(1)} -> ${standoff.toFixed(2)} m`);
  if (standoff > 10.6) return { fail: 'the walk never reached the deposit', standoff, log };

  // --- lay the line ----------------------------------------------------------
  // Pitch controls how far down the aim the ghost lands, so sweeping pitch lays
  // successive cells along ONE heading: that is a straight line by construction.
  // The belts are rotated 180 degrees so they flow back towards the smelter.
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

  // 1: the miner, as close to the deposit as the ghost will accept.
  of.build(1);
  let placedMiner = null;
  for (let p = -9; p >= -34 && placedMiner === null; p -= 1.0) {
    of.look(yaw, p);
    await sleep(0.05);
    const g = of.build().ghost;
    if (g === null || !g.ok) continue;
    const before = of.game().factory.buildings;
    await placeHere();
    if (of.game().factory.buildings > before) placedMiner = { pitch: p, cell: g.cell };
  }
  if (placedMiner === null) {
    return { fail: 'no pitch put an acceptable miner ghost on the deposit',
             build: of.build(), nodes: of.nodes().slice(0, 3), log };
  }
  log.push(`miner at pitch ${placedMiner.pitch} cell ${placedMiner.cell}`);

  // 2: belts, one per new cell walking the pitch back towards the player.
  of.build(2);
  await rotateTo(2);
  // ALIGN THE HEADING TO THE FLOW AXIS FIRST. The ghost's direction is snapped
  // to one of the four lattice axes, but the ground point it lands on is not: a
  // heading 30 degrees off the axis steps the cell diagonally, so consecutive
  // tiles are not each other's neighbour and the run breaks into fragments that
  // /core correctly treats as separate transport lines.
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
      // fwd points AWAY from the player for rotation 0 and back for 2, so the
      // alignment being sought is anti-parallel here.
      if (-d > bestDot) { bestDot = -d; bestYaw = yaw + k * 2; }
    }
    log.push(`aligned to the lattice axis, yaw ${yaw.toFixed(1)} -> ${bestYaw.toFixed(1)}`);
    yaw = bestYaw;
  }
  const beltCells = [];
  for (let p = placedMiner.pitch - 2; p >= -62; p -= 1.2) {
    of.look(yaw, p);
    await sleep(0.04);
    const g = of.build().ghost;
    if (g === null || !g.ok || beltCells.includes(g.cell)) continue;
    if (beltCells.length >= 4) break;
    const before = of.game().factory.buildings;
    await placeHere();
    if (of.game().factory.buildings > before) beltCells.push(g.cell);
  }
  log.push(`belts ${beltCells.length}: ${beltCells.join(' | ')}`);

  // 3: the smelter, at the far end of the run from the miner.
  of.build(3);
  let smelterCell = null;
  for (let p = -62; p >= -78 && smelterCell === null; p -= 2) {
    of.look(yaw, p);
    await sleep(0.04);
    const g = of.build().ghost;
    if (g === null || !g.ok) continue;
    const before = of.game().factory.buildings;
    await placeHere();
    if (of.game().factory.buildings > before) smelterCell = g.cell;
  }
  of.build(0);
  log.push(`smelter cell ${smelterCell}`);

  const plan = of.game().factory;
  const minerB = plan.list.find((b) => b.kind === 'miner');
  const smelterB = plan.list.find((b) => b.kind === 'smelter');
  if (minerB === undefined || smelterB === undefined) {
    return { fail: 'the line is incomplete', plan, log };
  }

  // --- WALK AWAY. No input at all from here on. ------------------------------
  // Step back and look down the line, so the capture is of the LINE and not of
  // the ground under the player's feet.
  // Back AND to the side, then re-face the deposit: seen straight down its own
  // axis the smelter hides the belt and the miner hides the smelter, so the
  // capture has to be taken off the line rather than along it.
  for (let i = 0; i < 2; ++i) {
    of.input.tape([{ hold: 50, keys: ['KeyS', 'KeyD'] }, { hold: 4, keys: [] }]);
    await sleep(0.95);
  }
  of.input.tape([{ hold: 2, keys: [] }]);
  aimAt();
  of.look(of.world().observer.yawDeg, -11);
  // THE SNAPSHOT IS TAKEN HERE, not when the line was finished. The factory has
  // been running since the miner went down, including through the step back, so
  // a snapshot taken earlier would attribute those ticks' ore to the unattended
  // window and the conservation check would miss by exactly that much. It did,
  // by 2 units, which is how this comment came to exist.
  const now = of.game().factory;
  const nowMiner = now.list.find((b) => b.kind === 'miner');
  const n0 = of.nodes().find((n) => n.index === minerB.node);
  const before = {
    coreTicks: now.coreTicks,
    mined: now.minedFromNodes,
    nodeRemaining: n0.remaining,
    minerRemaining: nowMiner.remaining,
    iron: (of.game().carried.find((c) => c.name === 'Iron') ?? { count: 0 }).count,
  };
  const RUN_SECS = 26;
  let beltPeak = 0;
  let workingSeen = false;
  for (let i = 0; i < 13; ++i) {
    await sleep(RUN_SECS / 13);
    const g = of.game().factory;
    for (const r of g.runs) beltPeak = Math.max(beltPeak, r.items);
    if (g.list.some((b) => b.kind === 'smelter' && b.working)) workingSeen = true;
  }
  const after = of.game().factory;
  const minerA = after.list.find((b) => b.kind === 'miner');
  const smelterA = after.list.find((b) => b.kind === 'smelter');
  const n1 = of.nodes().find((n) => n.index === minerB.node);

  // --- DOES THE IRON MATTER? -----------------------------------------------
  // The sharpest criticism of the survival slice was that nothing needed the
  // iron, so the loop ended in a shrug. gameplay.h already has a recipe that
  // does: the survival smelter costs 5 Iron + 5 Stone, and Iron is ONLY ever
  // produced by smelting. The pack started with none, so every ingot in it came
  // off the line. Stone comes from the hand, which is the point: the two halves
  // of the game meet in one recipe.
  //
  // The stone is gathered FIRST, so that when the recipe is still not craftable
  // the only thing missing is the automated iron. Checking it the other way
  // round would prove nothing: "not craftable" would just mean "no stone".
  // The recipe is found by its /core display name, which is 'Smelter'.
  const smelterRecipe = of.game().recipes.findIndex((r) => r.name === 'Smelter');
  const stoneIn = () => of.game().carried
    .reduce((a, c) => a + (c.name === 'Stone' ? c.count : 0), 0);
  let stoneSwings = 0;
  for (const n of of.nodes()) {
    if (n.kind !== 1) continue;
    for (let k = 0; k < 4 && stoneIn() < 5; ++k) if (of.harvest(n.index).ok) stoneSwings++;
  }
  const craftableBeforeIron = of.game().recipes[smelterRecipe]?.craftable ?? null;

  // --- collect, and check the pack grew by exactly what the buffer lost ------
  const ironBefore = (of.game().carried.find((c) => c.name === 'Iron') ?? { count: 0 }).count;
  const bufBefore = smelterA.output;
  const took = of.collect(smelterB.id);
  const ironAfter = (of.game().carried.find((c) => c.name === 'Iron') ?? { count: 0 }).count;
  const bufAfter = of.game().factory.list.find((b) => b.kind === 'smelter').output;

  const craftableAfterIron = of.game().recipes[smelterRecipe]?.craftable ?? null;
  const packBefore = of.game().carried.map((c) => `${c.name}:${c.count}`).join(' ');
  const crafted = smelterRecipe >= 0 ? of.craft(smelterRecipe) : false;
  const packAfter = of.game().carried.map((c) => `${c.name}:${c.count}`).join(' ');
  const closes = {
    recipe: 'Smelter (5 Iron + 5 Stone)',
    stoneSwings, stoneHeld: stoneIn(),
    craftableBeforeIron, craftableAfterIron, crafted,
    packBefore, packAfter,
  };

  const drained = after.minedFromNodes - before.mined;
  const extracted = before.minerRemaining - minerA.remaining;
  const nodeLost = n0.remaining - n1.remaining;

  return {
    advanced: {
      ticks: of.world().tick - t0,
      // /core's OWN tick counter, not ours: if these disagree the whole run is
      // measuring a network that was never stepped.
      coreTicksRun: after.coreTicks - before.coreTicks,
      expectedTicks: Math.round(RUN_SECS * 60),
      rebuilds: after.rebuilds,
      itemsLostToRebuild: after.itemsLostToRebuild,
    },
    line: {
      buildings: after.buildings,
      belts: beltCells.length,
      runs: after.runs,
      beltPeakItems: beltPeak,
      smelterWorkingSeen: workingSeen,
      minerRemaining: minerA.remaining,
      minerExtracted: extracted,
      smelterInput: smelterA.input,
      smelterOutput: bufBefore,
    },
    conservation: {
      nodeLost: +nodeLost.toFixed(3),
      drainedByMiner: drained,
      minerExtracted: extracted,
      ironTaken: took,
      packGrew: ironAfter - ironBefore,
      bufferFell: bufBefore - bufAfter,
    },
    valid:
      // the sim advanced, and by /core's own count
      Math.abs((after.coreTicks - before.coreTicks) - RUN_SECS * 60) <= 90
      && after.buildings >= 4 && beltCells.length >= 2
      // ore physically left the world node, by exactly what the miner took
      && extracted > 0 && drained === extracted && Math.abs(nodeLost - drained) < 0.51
      // items crossed the belt and the smelter did work nobody asked it to
      && beltPeak > 0 && workingSeen && bufBefore > 0
      // collection conserves: the pack gained exactly what the buffer lost
      && took > 0 && ironAfter - ironBefore === took && bufBefore - bufAfter === took
      // and the automated iron is the ONLY thing that unlocked a real recipe
      && craftableBeforeIron === false && craftableAfterIron === true && crafted === true,
    cost: {
      drawCalls: of.stats().draw.calls,
      budget: of.stats().budget.drawCalls,
      triangles: of.stats().draw.triangles,
    },
    closesTheLoop: closes,
    plan: after.list,
    flows: after.flows,
    view: of.game().view,
    build: of.build(),
    carried: of.game().carried,
    log,
  };
})()
