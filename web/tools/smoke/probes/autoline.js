// W6 AUTO-LINE probe: the acceptance for the whole milestone.
//
// Place a miner on an ore deposit, run a belt from it to a smelter, THEN STOP
// TOUCHING ANYTHING, and check that iron accumulated. Every placement goes
// through the real build mode (number key, R, and a left click) driven by an
// input tape, so nothing here reaches a path a player cannot reach. `use` is
// asked for by ACTION and never by key: place moved off G onto the left mouse
// button, and Bindings.ts is the one file that knows that.
//
// DW-20 IS THE WHOLE POINT of the `advanced` block. "of_net_step_n returned"
// proves nothing. What is asserted is that /core's own tick counter moved by the
// number of ticks the unattended window was, and that ore physically left the
// world node. Every number after that is a DELTA:
//
//   the PATCH lost EXACTLY what the drill extracted  (one pool of ore)
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

  // --- walk in until the player is STANDING ON the deposit --------------------
  // Bursts, not one long tape, and STEERED BY MEASURED PROGRESS: the heading is
  // only re-taken when the distance stops falling. Aiming every burst is worse,
  // not better, because the walk drifts a little each time it is re-pointed and
  // the player ends up circling the deposit at a fixed radius.
  //
  // WHY SO CLOSE. A deposit is a PATCH 6 to 11 m across (deposits.h S.P), not a
  // boulder, so a drill is accepted anywhere on it including the far rim. Halting
  // at arm's length from the outcrop leaves the whole line strung out at the
  // limit of the build reach, where a degree of pitch is nearly a metre of
  // ground and the belt tiles stop being each other's neighbours. Walking onto
  // the patch instead puts the good ore, and the whole line, inside the reach.
  let walked = 0;
  const closed = dist(eye(), node);
  let best = closed;
  let worse = 0;
  for (let i = 0; i < 45; ++i) {
    node = of.nodes().find((n) => n.index === node.index) ?? node;
    const d = dist(eye(), node);
    if (d < 5.0) break;
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
  // Pitch controls how far down the aim the ghost lands, so sweeping pitch walks
  // the ghost along ONE heading from the reach limit back towards the player's
  // feet. The belts are rotated 180 degrees so they flow back towards the
  // smelter, which means the DRILL goes at the far end and the smelter nearest.
  //
  // WHAT MAKES THAT WALK ONE TRANSPORT LINE rather than three, which is the
  // thing this probe kept getting wrong. chainRuns follows each belt to the cell
  // ONE METRE ALONG ITS OWN FLOW DIRECTION, and that direction is snapped to a
  // tangent axis. Two separate things have to line up for the tile it points at
  // to be the tile that is actually there:
  //
  //   the HEADING has to be one of those tangent axes. Off-axis the ground point
  //   steps diagonally and the tile ahead of each belt is empty ground.
  //
  //   every tile has to be its predecessor's NEIGHBOUR on the ground. Pitch is
  //   nowhere near linear in ground distance: out at the 9 m build reach a
  //   degree is most of a metre and a coarse sweep steps clean over whole cells,
  //   which is what used to break this line into three.
  //
  // NEIGHBOUR IS STILL MEASURED, though it no longer has to be. A machine used
  // to snap to /core's 1 m body-frame voxel lattice, which the ground sphere
  // cuts obliquely, so one unit step of a cell key covered 0.59, 0.81 or 1.02 m
  // of ground depending on the axis and consecutive cell keys proved nothing.
  // Machines snap to the metric SITE grid now (MachinePlacement.ts) and a face
  // neighbour is exactly 1.000 m. The measurement is kept because it is still
  // the honest question: the band below now separates a face neighbour (1.000)
  // from a boundary re-read (0) and from a DIAGONAL (1.414), which is a cell
  // skipped sideways and is exactly the hole that shatters a run.
  //
  // So: sweep all four axes, keep the one that carries an unbroken line off the
  // richest ore, and lay the line down it.
  let yaw = of.world().observer.yawDeg;
  const placeHere = async () => {
    of.input.tape([{ hold: 3, actions: ['use'] }, { hold: 4, keys: [] }]);
    await sleep(0.16);
  };
  const rotateTo = async (q) => {
    while (of.build().rotation !== q) {
      of.input.tape([{ hold: 3, keys: ['KeyR'] }, { hold: 3, keys: [] }]);
      await sleep(0.12);
    }
  };
  const ghostAt = async (y, p) => {
    of.look(y, p);
    await sleep(0.035);
    return of.build().ghost;
  };
  const gdist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  const fromEye = (g) => { const e = eye(); return gdist(g.pos, [e.x, e.y, e.z]); };
  // The band a genuine grid neighbour lands in, in metres of ground. The
  // floor rejects a re-reading of the cell already dealt with; the ceiling
  // rejects a skipped cell, which is the failure that shatters a run.
  const NEAR = 0.5;
  const FAR = 1.25;

  // 1: which yaw is a tangent axis, measured off the ghost's own flow direction.
  of.build(2);
  await rotateTo(2);
  {
    let bestYaw = yaw;
    let bestDot = -2;
    for (const [span, step] of [[23, 2], [5, 0.4]]) {
      let by = bestYaw;
      let bd = -2;
      for (let k = -span; k <= span; ++k) {
        const g = await ghostAt(bestYaw + k * step, -26);
        if (g === null) continue;
        const a = of.aim();
        // fwd points AWAY from the player at rotation 0 and back at 2, so the
        // alignment being sought here is anti-parallel. The pitch is fixed
        // across the sweep, so its cosine scales every sample equally and the
        // peak is where the heading meets the axis.
        const d = -(a.dir[0] * g.fwd[0] + a.dir[1] * g.fwd[1] + a.dir[2] * g.fwd[2]);
        if (d > bd) { bd = d; by = bestYaw + k * step; }
      }
      bestYaw = by;
      bestDot = bd;
    }
    log.push(`flow axis: yaw ${yaw.toFixed(1)} -> ${bestYaw.toFixed(1)}, `
      + `dot ${bestDot.toFixed(3)}`);
    yaw = bestYaw;
  }

  // 2: THE DRILL, and the heading it stands on.
  //
  // EVERY NUMBER IN THIS SWEEP IS A GROUND POSITION OR A RATE, and never a cell
  // key. A machine cell is an address on a SITE, and no site has been adopted
  // yet: until one has, every ghost founds a fresh PROSPECTIVE site on the
  // lattice cell under its own aim point (MachinePlacement.siteAt), so every
  // address it reports is 0,0 and two aims four metres apart cannot be told
  // apart. Placing the drill adopts a site, and everything after it may use
  // addresses. This probe read cell keys here and reported four cells for a
  // whole sweep, which is how the trap was found.
  of.build(1);
  const drillSweep = async (y) => {
    const out = [];
    for (let p = -12; p >= -44; p -= 0.4) {
      const g = await ghostAt(y, p);
      if (g === null) continue;
      out.push({ yaw: y, pitch: p, ok: g.ok, patch: g.patch, rate: g.ratePerSec,
        pos: g.pos, reachM: +fromEye(g).toFixed(2) });
    }
    return out;
  };
  let drillPick = null;
  for (const turn of [0, 90, 180, 270]) {
    const y = yaw + turn;
    const seen = await drillSweep(y);
    // Far enough out that four belts and a smelter fit between it and the
    // player's feet, and inside the 9 m build reach with a cell to spare.
    const cand = seen.filter((s) => s.ok && s.patch >= 0
      && s.reachM >= 5.6 && s.reachM <= 8.4);
    const best = cand.reduce((a, b) => (a === null || b.rate > a.rate ? b : a), null);
    log.push(`+${turn}: ${cand.length} drillable samples 5.6-8.4 m out, best `
      + (best === null ? 'none' : `${best.rate.toFixed(2)} ore/s at ${best.reachM} m`));
    if (best !== null && (drillPick === null || best.rate > drillPick.rate)) {
      drillPick = { ...best, turn };
    }
  }
  if (drillPick === null) {
    return { fail: 'no heading offers a drillable cell with room for a line',
             build: of.build(), ore: of.game().ore, log };
  }
  yaw = drillPick.yaw;
  await ghostAt(yaw, drillPick.pitch);
  {
    const before = of.game().factory.buildings;
    await placeHere();
    if (of.game().factory.buildings <= before) {
      return { fail: 'the drill would not go down on the cell the sweep chose',
               build: of.build(), drillPick, log };
    }
  }
  const miner0 = of.game().factory.list.find((b) => b.kind === 'miner');
  const placedMiner = { pitch: drillPick.pitch, cell: miner0.cell, pos: miner0.pos,
    rate: drillPick.rate, reachM: drillPick.reachM };
  log.push(`drill at pitch ${placedMiner.pitch.toFixed(1)} cell ${placedMiner.cell}, `
    + `${placedMiner.rate.toFixed(2)} ore/s, ${placedMiner.reachM} m out`);

  // 3: THE BELTS, laid as ONE HOLD-DRAG.
  //
  // Press the left button on the cell just inside the drill and sweep the
  // crosshair back towards the feet WITHOUT LETTING GO. `BuildMode.dragRun`
  // fills every cell between the head of the run and wherever the crosshair is
  // and turns each tile to point at its successor as it goes, so the run is
  // chained BY CONSTRUCTION rather than by the aim happening to stay on axis,
  // and it flows towards the player, which is where the smelter goes.
  //
  // That replaces a pitch sweep that laid one tile at a time and had to dodge
  // the old lattice's uneven steps to keep the tiles neighbours. It is both the
  // gesture a player actually makes and far more reliable.
  of.build(2);
  await rotateTo(2);
  let fromPitch = null;
  let toPitch = null;
  for (let p = placedMiner.pitch - 0.2; p >= -50; p -= 0.3) {
    const g = await ghostAt(yaw, p);
    if (g === null || !g.ok) continue;
    const d = gdist(g.pos, placedMiner.pos);
    if (d < NEAR) continue;                 // still the drill's own cell
    if (fromPitch === null) {
      if (d > FAR) break;                   // the first cell inside the drill
      fromPitch = p;                        // is not a neighbour: no line here
    }
    if (d > 4.6) break;                     // four belts is the length wanted
    toPitch = p;
  }
  if (fromPitch === null || toPitch === null) {
    return { fail: 'no belt cell inside the drill', placedMiner, log };
  }
  const beltsBefore = of.game().factory.buildings;
  of.look(yaw, fromPitch);
  await sleep(0.25);
  // ONE tape for the whole gesture. Two tapes would put a released frame
  // between them, which is a second PRESS and not a hold, and the drag would
  // restart from the new cell instead of running on.
  of.input.tape([{ hold: 300, actions: ['use'] }]);
  await sleep(0.3);
  of.look(yaw, toPitch);
  await sleep(0.6);
  of.input.tape([{ hold: 6, keys: [] }]);
  await sleep(0.4);

  const beltList = () => of.game().factory.list.filter((b) => b.kind === 'belt');
  const beltCells = beltList().map((b) => b.cell);
  // The tile-to-tile separations the drag actually produced, measured on the
  // ground. On the metric site grid every one of them is the module.
  const steps = [];
  {
    const bs = beltList();
    for (let i = 1; i < bs.length; ++i) steps.push(+gdist(bs[i - 1].pos, bs[i].pos).toFixed(3));
  }
  log.push(`drag laid ${of.game().factory.buildings - beltsBefore} belts, `
    + `steps ${steps.join('/')} m: ${beltCells.join(' | ')}`);

  // 4: the smelter, on the cell in front of the run's HEAD. Reach for a belt and
  // a smelter is (1 + 2) / 2 + 0.75 m (FactoryWiring.touch), so it has to be the
  // very next cell, not merely somewhere down the line. The head is the belt
  // NEAREST THE EYE, because the drag came back towards the player: asking the
  // plan which tile that is beats assuming the drag ended where it was aimed.
  of.build(3);
  let smelterCell = null;
  const bs = beltList();
  if (bs.length === 0) return { fail: 'the drag laid no belts', log };
  const e1 = eye();
  const headBelt = bs.reduce((a, b) =>
    gdist(b.pos, [e1.x, e1.y, e1.z]) < gdist(a.pos, [e1.x, e1.y, e1.z]) ? b : a);
  for (let p = toPitch - 0.2; p >= -56 && smelterCell === null; p -= 0.25) {
    const g = await ghostAt(yaw, p);
    if (g === null || !g.ok) continue;
    const d = gdist(g.pos, headBelt.pos);
    if (d < NEAR) continue;
    if (d > 2.2) break;                     // beyond the belt head's reach
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
  // The deposit is the PATCH the drill stands on, not a boulder: ONE pool, and
  // the number the conservation check has to balance against.
  const patchRemaining = (i) =>
    (of.game().ore.list.find((q) => q.index === i) ?? { remaining: 0 }).remaining;
  const patch0 = patchRemaining(minerB.patch);
  const before = {
    coreTicks: now.coreTicks,
    mined: now.minedFromNodes,
    nodeRemaining: patch0,
    minerRemaining: nowMiner.remaining,
    iron: (of.game().carried.find((c) => c.name === 'Iron') ?? { count: 0 }).count,
  };
  const RUN_SECS = 26;
  let beltPeak = 0;
  let workingSeen = false;
  let workingSamples = 0;
  // POLLED IN SMALL STEPS, not slept through. A survival smelter is 60 ticks of
  // work and it is only fed when a belt item arrives, so "working" is a state it
  // is in for part of a second at a time; a two second sample can step clean
  // over every one of them and report a line that visibly produced ingots as
  // never having done any work. The same lesson as moments.js and the collapse.
  const SAMPLES = 130;
  for (let i = 0; i < SAMPLES; ++i) {
    await sleep(RUN_SECS / SAMPLES);
    const g = of.game().factory;
    for (const r of g.runs) beltPeak = Math.max(beltPeak, r.items);
    if (g.list.some((b) => b.kind === 'smelter' && b.working)) {
      workingSeen = true;
      workingSamples++;
    }
  }
  const after = of.game().factory;
  const minerA = after.list.find((b) => b.kind === 'miner');
  const smelterA = after.list.find((b) => b.kind === 'smelter');
  const patch1 = patchRemaining(minerB.patch);

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
  const nodeLost = patch0 - patch1;

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
      smelterWorkingSamples: `${workingSamples}/${SAMPLES}`,
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
