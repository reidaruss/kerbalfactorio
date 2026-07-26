// AN ORE DEPOSIT IS A PATCH OF GROUND, AND A DRILL GOES ON TOP OF IT.
//
//   cd web
//   node tools/smoke/run.mjs --evalfile=tools/smoke/probes/deposit.js \
//        --out=docs/screenshots/W7_ore_patch.png
//
// FIVE CLAIMS, and the third one is the one that matters most:
//
//   1. A deposit is a PATCH: it has a measurable extent in metres and a total
//      amount, and its outcrops all report the same pool.
//   2. A drill on it produces ore over time and the PATCH falls by the matching
//      quantity. Conservation, not "output happened": a build that mined out of
//      thin air would pass the second half of that sentence on its own.
//   3. A drill placed OFF any deposit is REFUSED. This is the negative control.
//      Every other number here would look identical in a build where a drill can
//      be put anywhere, which is precisely the build this work replaced.
//   4. Hand mining still yields ore, so the bootstrap holds: a drill costs iron
//      and iron comes out of the ground, and bare hands must always work.
//   5. The depletion survives a save and a reload, checked the tunnelpersist way:
//      the live world is FORCED back to its pre-load state in between, so the
//      assertion cannot pass by reading a number that never left memory.
//
// DW-20 lives in `advanced`: /core's own tick counter has to have moved by the
// length of the unattended window before any of the rest is trusted, and the
// input drains on the 60 Hz tick, so every wait here is real time.
(async () => {
  const of = window.__of;
  const log = [];
  const sleep = (n) => of.run(n);
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
  const eye = () => { const o = of.aim().origin; return { x: o[0], y: o[1], z: o[2] }; };
  const patches = () => of.game().ore.list;
  const patchOf = (i) => patches().find((p) => p.index === i);
  const held = (name) => (of.game().carried.find((c) => c.name === name) ?? { count: 0 }).count;

  await sleep(0.6);
  const t0 = of.world().tick;
  await of.wipe();

  // --- 1. THE DEPOSIT IS A PATCH -------------------------------------------
  const field = of.game().ore;
  if (field.patches === 0) return { fail: 'no ore patches in the world' };
  // The nearest IRON patch, by its own outcrops. An outcrop is a /core node, so
  // this is the same list the aim and the swing already use.
  const outcrops = of.nodes().filter((n) => n.kind === 3 && n.remaining > 50);
  if (outcrops.length === 0) return { fail: 'no iron outcrops', field };
  let target = outcrops[0];
  const patchIndex = field.list.find((p) => p.kind === 3)?.index ?? -1;
  const patch0 = patchOf(patchIndex);
  if (patch0 === undefined) return { fail: 'no iron patch', field };
  const sameCrop = outcrops.filter((n) => Math.abs(n.initial - patch0.initial) < 1);
  const extent = {
    radiusM: patch0.radiusM,
    // Measured, not asserted: the widest gap between two of its own outcrops is
    // a lower bound on the patch's real extent on the ground.
    spanM: (() => {
      let w = 0;
      for (const a of sameCrop) for (const b of sameCrop) w = Math.max(w, dist(a, b));
      return +w.toFixed(2);
    })(),
    outcrops: sameCrop.length,
    totalAmount: patch0.initial,
    grade: patch0.grade,
  };
  log.push(`patch ${patchIndex}: r=${patch0.radiusM} m, span ${extent.spanM} m, `
    + `${sameCrop.length} outcrops, ${patch0.initial} units at grade ${patch0.grade}`);

  // --- 4. HAND MINING, FIRST, WITH NOTHING IN THE PACK ----------------------
  // Deliberately before anything is built: the claim is that a player who has
  // never mined can still get the iron a drill is made of.
  const handBefore = { iron: held('Raw iron'), patch: patchOf(patchIndex).remaining };
  const swing = of.harvest(target.index);
  const handAfter = { iron: held('Raw iron'), patch: patchOf(patchIndex).remaining };
  const hand = {
    granted: handAfter.iron - handBefore.iron,
    patchFell: +(handBefore.patch - handAfter.patch).toFixed(4),
    ok: swing.ok,
  };
  log.push(`hand: +${hand.granted} raw iron, patch -${hand.patchFell}`);

  // --- face and approach the patch -----------------------------------------
  const miss = () => {
    const a = of.aim();
    const e = { x: a.origin[0], y: a.origin[1], z: a.origin[2] };
    const v = { x: target.x - e.x, y: target.y - e.y, z: target.z - e.z };
    const t = v.x * a.dir[0] + v.y * a.dir[1] + v.z * a.dir[2];
    if (t <= 0) return Infinity;   // behind the eye scores as a miss, not a hit
    return Math.hypot(v.x - a.dir[0] * t, v.y - a.dir[1] * t, v.z - a.dir[2] * t);
  };
  const aimAt = () => {
    let best = of.world().observer.yawDeg;
    for (const step of [20, 5, 1.5]) {
      let bestMiss = Infinity;
      let bestYaw = best;
      const span = step === 20 ? 9 : 5;
      for (let k = -span; k <= span; ++k) {
        of.look(best + k * step, -8);
        const m = miss();
        if (m < bestMiss) { bestMiss = m; bestYaw = best + k * step; }
      }
      best = bestYaw;
    }
    of.look(best, -8);
    return best;
  };
  aimAt();
  const startedAt = dist(eye(), target);
  let best = startedAt;
  let worse = 0;
  for (let i = 0; i < 45; ++i) {
    target = of.nodes().find((n) => n.index === target.index) ?? target;
    const d = dist(eye(), target);
    if (d < 7.5) break;
    if (d < best - 0.05) { best = d; worse = 0; }
    else if (++worse >= 2) { aimAt(); worse = 0; }
    of.input.tape([{ hold: 60, keys: ['KeyW'] }]);
    await sleep(1.1);
  }
  of.input.tape([{ hold: 2, keys: [] }]);
  await sleep(0.2);
  const yaw = aimAt();
  const standoff = dist(eye(), target);
  log.push(`walked in, ${startedAt.toFixed(1)} -> ${standoff.toFixed(2)} m`);

  // --- 3. THE NEGATIVE CONTROL, BEFORE ANYTHING IS PLACED -------------------
  // Turn the back on the ore, walk off it, and look at ordinary ground. The
  // ghost has to be RED with the reason, and the place key has to do nothing at
  // all: a refusal that exists only in a label is not a refusal.
  //
  // WHERE the ground is is measured, not assumed. Several headings and pitches
  // are tried and the one whose ghost lands FURTHEST outside every patch's own
  // outline is the one tested, and that clearance is reported. Otherwise the
  // check argues in a circle: "there is no ore here because the game said no".
  const clearanceOf = (g) => (g === null ? -1 : Math.min(...patches().map((q) => {
    const d = Math.hypot(g.pos[0] - q.centre[0], g.pos[1] - q.centre[1],
      g.pos[2] - q.centre[2]);
    return d - q.radiusM * 1.4;   // 1.4x covers the widest the lobe can bulge
  })));
  of.build(1);
  of.look(yaw + 180, -6);
  for (let i = 0; i < 3; ++i) {
    of.input.tape([{ hold: 55, keys: ['KeyW'] }, { hold: 4, keys: [] }]);
    await sleep(1.0);
  }
  of.input.tape([{ hold: 2, keys: [] }]);
  await sleep(0.3);
  let offGhost = null;
  let clearOfEveryPatch = -1;
  for (const dy of [-30, 0, 30, 60, -60]) {
    for (const p of [-18, -28, -40, -55]) {
      of.look(yaw + 180 + dy, p);
      await sleep(0.05);
      const g = of.build().ghost;
      const c = clearanceOf(g);
      if (g !== null && c > clearOfEveryPatch) { clearOfEveryPatch = c; offGhost = g; }
    }
  }
  // Aim back at the winner and try to build there for real.
  let placedOff = null;
  for (const dy of [-30, 0, 30, 60, -60]) {
    if (placedOff !== null) break;
    for (const p of [-18, -28, -40, -55]) {
      of.look(yaw + 180 + dy, p);
      await sleep(0.05);
      const g = of.build().ghost;
      if (g === null || g.cell !== offGhost.cell) continue;
      placedOff = { cell: g.cell };
      break;
    }
  }
  const buildingsBeforeRefusal = of.game().factory.buildings;
  of.input.tape([{ hold: 3, keys: ['KeyG'] }, { hold: 4, keys: [] }]);
  await sleep(0.3);
  const refusal = {
    ghost: offGhost,
    aimedBackAtIt: placedOff !== null,
    metresClearOfEveryPatch: +clearOfEveryPatch.toFixed(2),
    buildingsBefore: buildingsBeforeRefusal,
    buildingsAfter: of.game().factory.buildings,
    reason: offGhost?.reason ?? '',
  };
  log.push(`off the deposit (${refusal.metresClearOfEveryPatch} m clear): `
    + `ok=${offGhost?.ok} "${offGhost?.reason}", `
    + `buildings ${refusal.buildingsBefore} -> ${refusal.buildingsAfter}`);

  // Walk back onto the patch for the placement that must SUCCEED.
  aimAt();
  for (let i = 0; i < 5; ++i) {
    if (dist(eye(), target) < 7.5) break;
    of.input.tape([{ hold: 60, keys: ['KeyW'] }]);
    await sleep(1.1);
    aimAt();
  }
  of.input.tape([{ hold: 2, keys: [] }]);
  await sleep(0.3);
  const yaw2 = aimAt();

  // --- 2. A DRILL ON THE PATCH ---------------------------------------------
  of.look(yaw2, -8);
  await sleep(0.2);
  let placed = null;
  for (let p = -8; p >= -40 && placed === null; p -= 1.0) {
    of.look(yaw2, p);
    await sleep(0.05);
    const g = of.build().ghost;
    if (g === null || !g.ok) continue;
    const before = of.game().factory.buildings;
    of.input.tape([{ hold: 3, keys: ['KeyG'] }, { hold: 4, keys: [] }]);
    await sleep(0.16);
    if (of.game().factory.buildings > before) placed = { pitch: p, cell: g.cell };
  }
  of.build(0);
  if (placed === null) {
    return { fail: 'no pitch put an acceptable drill ghost on the patch',
             build: of.build(), extent, refusal, log };
  }
  log.push(`drill at pitch ${placed.pitch}, cell ${placed.cell}`);

  const drillOf = () => of.game().factory.list.find((b) => b.kind === 'miner');
  const drill0 = drillOf();
  if (drill0 === undefined) return { fail: 'the drill is not in the plan', log };

  // Step back so the capture frames the patch and the machine on it, then STOP
  // TOUCHING ANYTHING. The snapshot is taken after the step back, not before,
  // because the drill has been running since it went down and attributing those
  // ticks to the unattended window misses the conservation check by exactly that.
  for (let i = 0; i < 2; ++i) {
    of.input.tape([{ hold: 46, keys: ['KeyS'] }, { hold: 4, keys: [] }]);
    await sleep(0.9);
  }
  of.input.tape([{ hold: 2, keys: [] }]);
  aimAt();
  of.look(of.world().observer.yawDeg, -14);
  await sleep(0.4);

  const before = {
    coreTicks: of.game().factory.coreTicks,
    mined: of.game().factory.minedFromNodes,
    patch: patchOf(patchIndex).remaining,
    drill: drillOf().remaining,
    output: drillOf().output ?? 0,
  };
  const RUN_SECS = 18;
  for (let i = 0; i < 9; ++i) await sleep(RUN_SECS / 9);
  const after = {
    coreTicks: of.game().factory.coreTicks,
    mined: of.game().factory.minedFromNodes,
    patch: patchOf(patchIndex).remaining,
    drill: drillOf().remaining,
    output: drillOf().output ?? 0,
  };
  const conservation = {
    patchLost: +(before.patch - after.patch).toFixed(3),
    drainedByDrill: after.mined - before.mined,
    drillExtracted: +(before.drill - after.drill).toFixed(3),
    oreProduced: after.output - before.output,
    drillRemaining: after.drill,
  };
  log.push(`unattended ${RUN_SECS}s: patch -${conservation.patchLost}, `
    + `drill extracted ${conservation.drillExtracted}, `
    + `ore in the buffer +${conservation.oreProduced}`);

  // --- 5. SAVE, FORCE THE WORLD BACK, RELOAD -------------------------------
  // The middle step is what makes the last one mean anything: `repopulate` grows
  // the clearing and the patches from the SEED, exactly as boot does, so the
  // deposit is full again and nothing in memory remembers the mining. A save
  // that "worked" because the live world still held the answer fails here.
  const written = await of.save();
  if (written === null) return { fail: 'the slot could not be written', log };
  const savedRemaining = patchOf(patchIndex).remaining;

  const batchBefore = of.game().nodes;
  of.repopulate();
  const batchAfter = of.game().nodes;
  const regrown = patchOf(patchIndex);
  const regrownRemaining = regrown === undefined ? -1 : regrown.remaining;

  const ledger = await of.load();
  const loadedRemaining = patchOf(patchIndex).remaining;
  const persistence = {
    saved: +savedRemaining.toFixed(3),
    initial: patch0.initial,
    afterRegrow: +regrownRemaining.toFixed(3),
    afterLoad: +loadedRemaining.toFixed(3),
    patchesInSlot: written.patches,
    patchesDepleted: ledger?.patchesDepleted ?? 0,
  };
  // A regrow must cost NOTHING. A BatchedMesh instance cannot be deleted, so a
  // clearing that hands its slots back only by hiding them leaks one per node
  // per regrow and eventually comes back with pieces of itself not drawn.
  const batch = {
    nodesBefore: batchBefore.nodes, nodesAfter: batchAfter.nodes,
    instancesBefore: batchBefore.instances, instancesAfter: batchAfter.instances,
    capacity: batchAfter.capacity,
  };
  log.push(`persist: ${persistence.saved} -> regrown ${persistence.afterRegrow} `
    + `-> loaded ${persistence.afterLoad}`);

  // --- frame the capture ---------------------------------------------------
  // The screenshot is of the DEPOSIT and the machine standing in it, so the
  // camera is put back on the patch centre rather than left wherever the last
  // assertion happened to leave it.
  {
    const c = patchOf(patchIndex).centre;
    target = { x: c[0], y: c[1], z: c[2] };
    for (let i = 0; i < 6; ++i) {
      const d = dist(eye(), target);
      if (d < 12) break;
      aimAt();
      of.input.tape([{ hold: 40, keys: ['KeyW'] }, { hold: 4, keys: [] }]);
      await sleep(0.75);
    }
    for (let i = 0; i < 4; ++i) {
      if (dist(eye(), target) > 9) break;
      of.input.tape([{ hold: 30, keys: ['KeyS'] }, { hold: 4, keys: [] }]);
      await sleep(0.6);
    }
    of.input.tape([{ hold: 2, keys: [] }]);
    await sleep(0.3);
    of.look(aimAt(), -19);
  }
  await sleep(0.8);
  const w = of.world();

  return {
    // DW-20 FIRST: the simulation advanced, by /core's own count, and the world
    // physically changed. Nothing below is worth reading if this is false.
    valid: (w.tick - t0) > 900
      && Math.abs((after.coreTicks - before.coreTicks) - RUN_SECS * 60) <= 90
      && conservation.patchLost > 0,
    advanced: {
      ticks: w.tick - t0,
      coreTicksRun: after.coreTicks - before.coreTicks,
      expectedTicks: Math.round(RUN_SECS * 60),
    },

    // 1. A deposit is an AREA with an amount, not a pebble.
    depositIsAPatch:
      field.patches >= 2 && extent.outcrops >= 4
      && extent.radiusM >= 5 && extent.spanM >= 3
      && extent.totalAmount >= 500,

    // 2. The drill mined, and the ground lost exactly what it mined.
    drillConserves:
      conservation.oreProduced > 0
      && conservation.drillExtracted > 0
      && conservation.drainedByDrill === Math.trunc(conservation.drainedByDrill)
      && Math.abs(conservation.patchLost - conservation.drillExtracted) < 1.01
      && Math.abs(conservation.drainedByDrill - conservation.drillExtracted) < 1.01,

    // 3. THE NEGATIVE CONTROL. Off the ore the ghost is red, it says why, and
    //    the place key builds nothing.
    offDepositIsRefused:
      offGhost !== null && offGhost.ok === false
      && /no ore/.test(offGhost.reason)
      && refusal.buildingsAfter === refusal.buildingsBefore
      && clearOfEveryPatch > 2,

    // 4. The bootstrap: bare hands on an outcrop still pay out, and out of the
    //    patch's own pool.
    handMiningStillWorks:
      hand.ok === true && hand.granted > 0
      && Math.abs(hand.patchFell - hand.granted) < 0.01,

    // 5. The depletion is on disk, not in memory.
    depletionSurvivesReload:
      persistence.patchesInSlot > 0
      && persistence.afterRegrow > persistence.saved + 1
      && Math.abs(persistence.afterLoad - persistence.saved) < 1.01
      && persistence.patchesDepleted > 0
      // ... and regrowing the world reuses its art rather than leaking it.
      && batch.instancesAfter === batch.instancesBefore
      && batch.nodesAfter === batch.nodesBefore
      && batch.instancesAfter <= batch.capacity,

    extent,
    batch,
    hand,
    refusal,
    conservation,
    persistence,
    ore: of.game().ore,
    plan: of.game().factory.list,
    cost: {
      drawCalls: of.stats().draw.calls,
      budget: of.stats().budget.drawCalls,
      triangles: of.stats().draw.triangles,
    },
    log,
  };
})()
