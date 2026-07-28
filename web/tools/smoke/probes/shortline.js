// FS-17: THE SHORT LINE, which used to deadlock for ever on ingot number one.
//
// THE DEFECT. `FactoryWiring.wire` treats a smelter as a SOURCE as well as a
// SINK, because a smelter's ingots may legitimately ride a belt away. It wired
// any source that touched a run's TAIL onto that run, and belt-to-smelter reach
// is 2.25 m. On a SHORT run the smelter at the head is also within 2.25 m of the
// tail, so it was wired onto the tail of the very belt whose head feeds it. Its
// first ingot went out onto that belt, rode to the head and stuck there for
// ever: the head inserter is carrying ore and will not pick up an ingot, and a
// `TransportLine` accepts exactly one item until its head is popped. The whole
// line jammed on the first ingot, permanently. Measured before the fix:
// `minerOut` pinned at 13 to 16 while `mined` kept climbing 19 a window, belt
// items stuck at 1, smelter input 0, output 0, pack iron 0.
//
// THE SHAPE THAT REACHES IT is a drill plus TWO belts plus a smelter. The
// original report said four, and four was right at the time: machines snapped to
// /core's voxel lattice, where a unit cell step is 0.59 to 1.02 m of ground.
// Machines snap to the metric SITE grid now and tiles are exactly 1.002 m apart,
// so the tail of a four-tile run stands 4.0 m from the smelter and is out of
// reach whatever the wiring says. Two tiles put it at 2.0 m, inside 2.25 m. The
// probe MEASURES that rather than assuming it, and refuses to pass if the loop
// geometry it is testing did not actually form.
//
// WHAT IT ASSERTS, and it fails against the old wiring on the first of these:
//   linksToTail === 0        the smelter is not wired onto the tail
//   linksFromHead === 1      but the head IS wired into the smelter
//   ironMade > 0             and the line therefore RUNS, unattended
//
// DW-20 twice over. The measured window checks /core's own tick counter, and the
// SETUP is asserted separately: two belts chained into ONE run, a drill and a
// smelter down, and the smelter inside belt reach of the tail. A probe that laid
// one belt, or that put the smelter 3 m out, would produce iron and prove
// nothing.
(async () => {
  const of = window.__of;
  const sleep = (n) => of.run(n);
  const log = [];
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
  const gdist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  const eye = () => { const o = of.aim().origin; return { x: o[0], y: o[1], z: o[2] }; };
  const fac = () => of.game().factory;
  const ironIn = () => (of.game().carried.find((c) => c.name === 'Iron') ?? { count: 0 }).count;
  const ore = () => of.nodes().find((n) => n.kind === 3 && n.remaining > 20)
            ?? of.nodes().find((n) => n.kind === 2 && n.remaining > 20);

  await sleep(0.5);
  let node = ore();
  if (node === undefined) return { fail: 'no ore node in the clearing' };

  // --- face the deposit and walk onto it (demolish.js's search, guard and all)
  const miss = () => {
    const a = of.aim();
    const e = { x: a.origin[0], y: a.origin[1], z: a.origin[2] };
    const v = { x: node.x - e.x, y: node.y - e.y, z: node.z - e.z };
    const t = v.x * a.dir[0] + v.y * a.dir[1] + v.z * a.dir[2];
    if (t <= 0) return Infinity;                 // +Inf BEHIND the eye, or a
    return Math.hypot(v.x - a.dir[0] * t,        // heading 180 degrees wrong
      v.y - a.dir[1] * t, v.z - a.dir[2] * t);   // scores as well as the right one
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
  let closest = dist(eye(), node);
  let worse = 0;
  for (let i = 0; i < 45; ++i) {
    node = of.nodes().find((n) => n.index === node.index) ?? node;
    const d = dist(eye(), node);
    if (d < 5.0) break;
    if (d < closest - 0.05) { closest = d; worse = 0; }
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

  // --- the flow axis, measured off the ghost's own reported heading -----------
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
  const fromEye = (g) => { const e = eye(); return gdist(g.pos, [e.x, e.y, e.z]); };
  // FS-83: THE SEARCH WINDOWS AND THE REACHES ARE DERIVED FROM THE SHIPPED
  // DIMENSION TABLE, NOT TYPED IN. Every distance in this probe was sized when
  // the smelter and the drill were 2 m, so FS-73's rescale to 4 m falsified all
  // of them at once and this probe simply stopped being able to place a smelter
  // ("the smelter would not go down at the head"). That is INSTRUMENTS.md's own
  // lesson pointed at the instrument: a probe that carries its own copy of a
  // constant is a control that rots the moment the thing it watches moves.
  //
  // `factory.footprint` is the client's OWN table, published by FS-73 for exactly
  // this, so these windows follow the assets wherever they go next. The band is
  // the required cell count plus and minus about half a cell, which covers the
  // 1.002 m site grid and a few centimetres of slope pitch without ever reaching
  // the neighbouring cell.
  const FPT = of.game().factory.footprint;
  const cellsFor = (a, b) => Math.max(1, Math.ceil((FPT[a] + FPT[b]) * 0.5));
  const matesNear = (a, b) => cellsFor(a, b) - 0.6;
  const matesFar = (a, b) => cellsFor(a, b) + 0.45;


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
        // fwd points AWAY at rotation 0 and back at 2, so this is anti-parallel.
        const d = -(a.dir[0] * g.fwd[0] + a.dir[1] * g.fwd[1] + a.dir[2] * g.fwd[2]);
        if (d > bd) { bd = d; by = bestYaw + k * step; }
      }
      bestYaw = by;
      bestDot = bd;
    }
    log.push(`flow axis: yaw ${yaw.toFixed(1)} -> ${bestYaw.toFixed(1)}, dot ${bestDot.toFixed(3)}`);
    yaw = bestYaw;
  }

  // --- TWO belts, laid as one hold-drag --------------------------------------
  const beltSweep = [];
  for (let p = -12; p >= -52; p -= 0.3) {
    const g = await ghostAt(yaw, p);
    if (g === null) continue;
    beltSweep.push({ pitch: p, ok: g.ok, pos: g.pos, prospective: g.prospective,
      reachM: +fromEye(g).toFixed(2) });
  }
  // FS-83. THE TAIL IS PLACED SO THE DRILL LANDS ON THE ORE, and that is now a
  // derived target rather than "as far out as the reach allows".
  //
  // The old rule took the furthest legal belt cell inside 7.7 m and put the drill
  // ONE cell beyond it, which worked only because one cell was what a 2 m drill
  // needed. A 4 m drill mates three cells out, so the same tail put the drill
  // three metres past the deposit and this probe reported "the drill would not go
  // down beyond the tail" for a world in which nothing whatever was wrong. That
  // is the probe's own copy of a constant rotting, INSTRUMENTS.md's dominant
  // failure aimed at the instrument.
  //
  // So the tail is aimed at the standoff the DRILL needs minus the mating
  // distance the table requires, and the sweep picks the cell nearest that. The
  // floor keeps it out of the dead zone right under the crosshair.
  const wantTailM = Math.max(2.2, standoff - cellsFor('miner', 'belt'));
  const tailAim = beltSweep.filter((s) => s.ok)
    .reduce((a, b) => (a === null
      || Math.abs(b.reachM - wantTailM) < Math.abs(a.reachM - wantTailM) ? b : a), null);
  if (tailAim === null) return { fail: 'no belt cell inside the reach band', log };

  // TWO PRESSES, NOT A HOLD-DRAG, and that is a deliberate difference from
  // demolish.js. A drag fills every cell between the crosshair and the head of
  // the run, and the crosshair keeps moving while the button is down: aiming one
  // cell along and holding for six tenths of a second laid THREE tiles, because
  // the player settles and the aim ray walks on. A run of exactly two is the
  // whole point here, so each tile gets its own press.
  //
  // AND THE SECOND CELL IS FOUND AFTER THE FIRST TILE IS DOWN, which is not
  // fussiness. Until a machine is placed no build SITE has been adopted, so every
  // ghost founds a fresh PROSPECTIVE site on the lattice cell under its own aim
  // point (`MachinePlacement.siteAt`, flagged as `ghost.prospective`). Positions
  // read off that sweep are lattice centres, 0.59 to 1.02 m apart; the first
  // press adopts a site and every snap after it lands on that site's metric
  // 1.002 m grid instead. Choosing both cells from the pre-adoption sweep put the
  // second tile TWO cells along and left a hole in the run.
  of.look(yaw, tailAim.pitch);
  await sleep(0.2);
  {
    const before = fac().buildings;
    await placeHere();
    if (fac().buildings <= before) {
      return { fail: 'the first belt press placed nothing', tailAim, log };
    }
  }
  const tail0 = fac().list.find((b) => b.kind === 'belt');
  const prospectiveBefore = beltSweep.some((s) => s.prospective);
  let headAim = null;
  for (let p = tailAim.pitch - 0.1; p >= -52 && headAim === null; p -= 0.15) {
    const g = await ghostAt(yaw, p);
    if (g === null || !g.ok || g.prospective === true) continue;
    const d = gdist(g.pos, tail0.pos);
    if (d > matesFar('belt', 'belt')) break;   // past the neighbouring cell
    if (d > 0.6) headAim = { pitch: p, pos: g.pos, cell: g.cell };
  }
  if (headAim === null) {
    return { fail: 'no cell adjacent to the tail on this heading', tailAim, log };
  }
  of.look(yaw, headAim.pitch);
  await sleep(0.2);
  {
    const before = fac().buildings;
    await placeHere();
    if (fac().buildings <= before) {
      return { fail: 'the second belt press placed nothing', headAim, log };
    }
  }
  await sleep(0.3);

  const eyeNow = eye();
  const laid = fac().list.filter((b) => b.kind === 'belt')
    .map((b) => ({ id: b.id, cell: b.cell, pos: b.pos,
      fromEyeM: gdist(b.pos, [eyeNow.x, eyeNow.y, eyeNow.z]) }))
    .sort((a, b) => b.fromEyeM - a.fromEyeM);
  log.push(`drag laid ${laid.length} belts: ${laid.map((b) => b.cell).join(' | ')}`);
  if (laid.length !== 2) {
    return { fail: 'the drag did not lay exactly two belts', laid, tailAim, headAim, log };
  }

  // --- the smelter at the head, the drill beyond the tail --------------------
  of.build(3);
  let smelterAt = null;
  const headBelt = laid[laid.length - 1];
  for (let p = headAim.pitch - 0.2; p >= -62 && smelterAt === null; p -= 0.25) {
    const g = await ghostAt(yaw, p);
    if (g === null || !g.ok) continue;
    const d = gdist(g.pos, headBelt.pos);
    if (d < 0.5) continue;
    if (d > matesFar('belt', 'smelter')) break;  // beyond the belt head's reach
    const before = fac().buildings;
    await placeHere();
    if (fac().buildings > before) smelterAt = { cell: g.cell, pitch: p, pos: g.pos };
  }
  if (smelterAt === null) return { fail: 'the smelter would not go down at the head', log };

  of.build(1);
  let drill = null;
  const tailBelt = laid[0];
  for (let p = tailAim.pitch + 0.2; p <= -8 && drill === null; p += 0.25) {
    const g = await ghostAt(yaw, p);
    if (g === null || !g.ok || g.patch < 0) continue;
    const d = gdist(g.pos, tailBelt.pos);
    if (d < matesNear('miner', 'belt')
      || d > matesFar('miner', 'belt')) continue;  // it has to reach the tail
    const before = fac().buildings;
    await placeHere();
    if (fac().buildings > before) {
      drill = { cell: g.cell, pitch: p, pos: g.pos, rate: g.ratePerSec,
        reachM: +fromEye(g).toFixed(2) };
    }
  }
  of.build(0);
  if (drill === null) {
    return { fail: 'the drill would not go down beyond the tail', tailBelt, log };
  }
  log.push(`drill ${drill.cell} at ${drill.rate.toFixed(2)} ore/s, ${drill.reachM} m out`);

  // --- THE SHAPE, and whether it is the shape this probe is about ------------
  const f0 = fac();
  const smelterId = f0.list.find((b) => b.kind === 'smelter')?.id ?? -1;
  const drillId = f0.list.find((b) => b.kind === 'miner')?.id ?? -1;
  const tails = new Set(f0.runs.map((r) => r.tail));
  const heads = new Set(f0.runs.map((r) => r.head));
  const tailToSmelter = gdist(laid[0].pos, smelterAt.pos);
  const drillToSmelter = gdist(drill.pos, smelterAt.pos);
  const shape = {
    runs: f0.runs,
    tailToSmelter: +tailToSmelter.toFixed(3),
    headToSmelter: +gdist(headBelt.pos, smelterAt.pos).toFixed(3),
    drillToTail: +gdist(drill.pos, laid[0].pos).toFixed(3),
    drillToSmelter: +drillToSmelter.toFixed(3),
    // The two reaches out of FactoryWiring.touch, restated so the numbers above
    // can be read against something.
    beltToSmelterMateM: +(cellsFor('belt', 'smelter')).toFixed(3),
    drillToSmelterMateM: +(cellsFor('miner', 'smelter')).toFixed(3),
    links: f0.links,
    // THE DEFECT, STATED EXACTLY: an inserter from the smelter to the tail of a
    // run whose head feeds that same smelter.
    linksToTail: f0.links.filter((l) => l.from === smelterId && tails.has(l.to)).length,
    linksFromHead: f0.links.filter((l) => heads.has(l.from) && l.to === smelterId).length,
    linksDrillToTail: f0.links.filter((l) => l.from === drillId && tails.has(l.to)).length,
  };
  log.push('shape: ' + JSON.stringify(shape));

  // THE SETUP GATE. Every one of these has to hold or the measurement below is
  // about some other factory: one run of two tiles, the drill feeding the tail,
  // the head feeding the smelter, the smelter INSIDE belt reach of the tail (so
  // the old wiring really would have looped it), and the drill OUTSIDE direct
  // reach of the smelter (so the belts are load bearing rather than decoration).
  const setup = {
    oneRun: f0.runs.length === 1 && f0.runs[0].tiles === 2,
    drillFeedsTail: shape.linksDrillToTail === 1,
    headFeedsSmelter: shape.linksFromHead === 1,
    // The tail is close enough that the OLD proximity rule really would have
    // looped it, and the drill is far enough that the belts are load bearing.
    // Both are now expressed against the mating distance the table requires,
    // so a future rescale moves them with it instead of past them.
    shortCircuitGeometry: tailToSmelter <= matesFar('belt', 'smelter') + 1.0,
    beltsAreLoadBearing: drillToSmelter > matesFar('miner', 'smelter'),
  };
  const setupOk = Object.values(setup).every(Boolean);
  log.push('setup: ' + JSON.stringify(setup));

  // --- the unattended window -------------------------------------------------
  const WINDOW = 20;
  const before = fac();
  const s0 = before.list.find((b) => b.kind === 'smelter');
  const m0 = before.list.find((b) => b.kind === 'miner');
  const iron0 = ironIn();
  await sleep(WINDOW);
  const after = fac();
  const s1 = after.list.find((b) => b.kind === 'smelter');
  const m1 = after.list.find((b) => b.kind === 'miner');
  const win = {
    coreTicks: after.coreTicks - before.coreTicks,
    expected: WINDOW * 60,
    // Nothing empties the smelter here, so what it made is the buffer delta plus
    // anything that reached the pack.
    ironMade: (s1?.output ?? 0) - (s0?.output ?? 0) + (ironIn() - iron0),
    smelterInput: s1?.input ?? null,
    // THE PINNED COUNTER. On the deadlocked line the drill's out-slot filled and
    // stopped while the deposit kept draining, so `minerOut` froze and `mined`
    // kept climbing. Both are reported.
    minerOut: [m0?.output ?? null, m1?.output ?? null],
    minedDelta: after.minedFromNodes - before.minedFromNodes,
    beltItems: after.runs.map((r) => r.items),
    packIron: ironIn(),
  };
  log.push("window: " + JSON.stringify(win));

  return {
    advanced: {
      ticks: win.coreTicks, expected: win.expected,
      rebuilds: fac().rebuilds, drillRatePerSec: drill.rate,
      // FS-19, recorded rather than assumed: every ghost taken before the first
      // placement reported a PROSPECTIVE address, and the ones taken after it
      // did not. That flag is the only thing separating a real cell key from a
      // placeholder, and this probe needed it to find the neighbouring cell.
      ghostsWereProspectiveBeforeAnySite: prospectiveBefore,
    },
    setup,
    shape,
    window: win,
    valid:
      // DW-20, the measuring half
      Math.abs(win.coreTicks - win.expected) <= 90
      // DW-20, the SETUP half. Without this a probe that laid the wrong shape
      // reports a healthy line and proves nothing about the defect.
      && setupOk
      // FS-17 itself: the smelter is NOT wired onto the tail that feeds it
      && shape.linksToTail === 0
      // and the line therefore runs, unattended, with nobody feeding it
      && win.ironMade > 0
      && win.minedDelta > 0,
    cost: { drawCalls: of.stats().draw.calls, budget: of.stats().budget.drawCalls },
    plan: fac().list,
    log,
  };
})()
