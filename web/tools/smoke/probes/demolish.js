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

  // WALK ONTO THE PATCH, not up to it. A deposit is an area of ground 6 to 11 m
  // across holding one pool, not a boulder: a drill is accepted anywhere on it
  // including the far rim, where the ore is worth a fifth of what the middle is
  // worth and the whole line is strung out at the limit of the build reach.
  let walked = 0;
  let best = dist(eye(), node);
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
  log.push(`walked ${walked} bursts to ${standoff.toFixed(2)} m`);
  if (standoff > 10.6) return { fail: 'the walk never reached the deposit', standoff, log };

  // --- lay the line ----------------------------------------------------------
  // The line runs from the DRILL at the far end back towards the player, with
  // the smelter nearest, and it is laid with ONE PRESS AND HOLD of the left
  // button rather than one press per tile.
  //
  // WHAT MAKES IT ONE TRANSPORT LINE, which is what this probe needs a middle
  // OF. A belt chains to its nearest neighbour on the ground within 1.35 m and
  // 0.85 of alignment (FactoryWiring). A pitch sweep placing one tile at a time
  // had to satisfy that by luck: pitch is nowhere near linear in ground distance
  // and a coarse sweep steps clean over whole cells, which is how the old 1.2
  // degree sweep here laid four tiles that were three separate runs. A DRAG
  // satisfies it by construction, because `BuildMode.dragRun` fills every cell
  // between the head of the run and the crosshair and turns each tile to point
  // at its successor.
  //
  // NEIGHBOUR IS STILL MEASURED, though it no longer has to be. A machine used
  // to snap to /core's 1 m body-frame voxel lattice, which the ground sphere
  // cuts obliquely, so one unit step of a cell key covered 0.59, 0.81 or 1.02 m
  // of ground depending on the axis and consecutive cell keys proved nothing.
  // Machines snap to the metric SITE grid now (MachinePlacement.ts) and a face
  // neighbour is exactly 1.000 m. The band below is kept because it still says
  // the useful thing: it separates a face neighbour (1.000) from a boundary
  // re-read (0) and from a DIAGONAL (1.414), which is a cell skipped sideways.
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
        // alignment being sought here is anti-parallel.
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

  // 2: THE BELTS, LAID AS ONE HOLD-DRAG, AND THE DRILL STILL LAST.
  //
  // The ORDER is not cosmetic, it is what makes the stall window measurable. A
  // drill placed first mines into its own 50-unit out-slot for the whole of the
  // time it takes to lay the rest of the line, and the moment the line closes
  // that backlog floods the smelter's input. The smelter then has a minute of
  // ore inside it that no belt has to deliver, so pulling the belt out stops
  // nothing a fourteen second window can see. Building the empty line first and
  // switching the ore on last means the only residue at the removal is the
  // handful of units the drill outran the furnace by.
  //
  // EVERY NUMBER IN THIS SWEEP IS A GROUND POSITION, never a cell key. A machine
  // cell is an address on a SITE and no site has been adopted yet: until one
  // has, every ghost founds a fresh PROSPECTIVE site on the lattice cell under
  // its own aim point (MachinePlacement.siteAt), so every address it reports is
  // 0,0 and two aims five metres apart cannot be told apart. The press that
  // starts the drag adopts a site, and from there addresses mean something.
  //
  // The drag itself replaces a pitch sweep that placed one tile at a time and
  // had to dodge the old lattice's uneven steps to keep consecutive tiles each
  // other's neighbours. `BuildMode.dragRun` fills every cell between the head of
  // the run and wherever the crosshair is and turns each tile to point at its
  // successor, so the run is chained BY CONSTRUCTION, which is exactly what this
  // probe needs a middle OF.
  of.build(2);
  await rotateTo(2);
  const beltSweep = [];
  for (let p = -12; p >= -52; p -= 0.3) {
    const g = await ghostAt(yaw, p);
    if (g === null) continue;
    beltSweep.push({ pitch: p, ok: g.ok, pos: g.pos, reachM: +fromEye(g).toFixed(2) });
  }
  // THE TAIL goes as far out as still leaves a cell BEYOND it for the drill,
  // which has to stay inside the 9 m build reach.
  const tailAim = beltSweep.filter((s) => s.ok && s.reachM <= 7.7)
    .reduce((a, b) => (a === null || b.reachM > a.reachM ? b : a), null);
  if (tailAim === null) return { fail: 'no belt cell inside the reach band', log };
  // THE HEAD comes back towards the feet. Five belts, not four, and the reason
  // is not margin: `wire` links any SOURCE that touches a run's tail, a smelter
  // is a source, and belt-to-smelter reach is 2.25 m. Four tiles put the tail
  // 2.21 m from the smelter, so the smelter was wired onto the tail of the very
  // belt whose head feeds it. Its first ingot went out onto that belt, rode to
  // the head and stuck there, because the head inserter carries ore and will not
  // pick up an ingot. One item is all a transport line accepts before its head
  // is popped, so the whole line deadlocked on ingot number one. Five tiles put
  // the tail three metres out and the loop cannot form.
  let headAim = null;
  for (const s of beltSweep) {
    if (!s.ok || s.pitch >= tailAim.pitch) continue;
    if (gdist(s.pos, tailAim.pos) > 5.6) break;
    headAim = s;
  }
  if (headAim === null || gdist(headAim.pos, tailAim.pos) < 4.4) {
    return { fail: 'no room for five belts on this heading', tailAim, headAim, log };
  }
  of.look(yaw, tailAim.pitch);
  await sleep(0.25);
  // ONE tape for the whole gesture. Two tapes would put a released frame between
  // them, which is a second PRESS and not a hold, and the drag would restart
  // from the new cell instead of running on.
  of.input.tape([{ hold: 300, actions: ['use'] }]);
  await sleep(0.3);
  of.look(yaw, headAim.pitch);
  await sleep(0.6);
  of.input.tape([{ hold: 6, keys: [] }]);
  await sleep(0.4);

  // The tiles the drag produced, IN RUN ORDER. The drag came back towards the
  // player, so the tail is the tile furthest from the eye and the head is the
  // nearest; ordering by measured distance beats assuming the plan's own order.
  const eyeNow = eye();
  // The pitch that looks at a tile is not something the drag knows: it laid the
  // whole run from two aims. It is recovered from the dry sweep, whose closest
  // sample to a tile is the aim that lands on it, and it is only ever a starting
  // guess: the rebuild below scans a band around it and then the whole sweep.
  const nearestPitch = (pos) => beltSweep
    .reduce((a, b) => (a === null || gdist(b.pos, pos) < gdist(a.pos, pos) ? b : a), null)
    .pitch;
  const laid = fac().list.filter((b) => b.kind === 'belt')
    .map((b) => ({ cell: b.cell, pos: b.pos, pitch: nearestPitch(b.pos),
      fromEyeM: gdist(b.pos, [eyeNow.x, eyeNow.y, eyeNow.z]) }))
    .sort((a, b) => b.fromEyeM - a.fromEyeM);
  const steps = [];
  for (let i = 1; i < laid.length; ++i) {
    steps.push(+gdist(laid[i - 1].pos, laid[i].pos).toFixed(3));
  }
  log.push(`drag laid ${laid.length} belts, steps ${steps.join('/')} m: `
    + laid.map((b) => b.cell).join(' | '));
  if (laid.length < 5) {
    return { fail: 'the drag did not carry five belts', steps, tailAim, headAim, log };
  }

  // 3: the smelter, on the cell in front of the run's HEAD. Reach for a belt and
  // a smelter is (1 + 2) / 2 + 0.75 m (FactoryWiring.touch), so it has to be the
  // very next cell, not merely somewhere down the line.
  of.build(3);
  let smelterAt = null;
  const headBelt = laid[laid.length - 1];
  for (let p = headAim.pitch - 0.2; p >= -62 && smelterAt === null; p -= 0.25) {
    const g = await ghostAt(yaw, p);
    if (g === null || !g.ok) continue;
    const d = gdist(g.pos, headBelt.pos);
    if (d < NEAR) continue;
    if (d > 2.2) break;                     // beyond the belt head's reach
    const before = fac().buildings;
    await placeHere();
    if (fac().buildings > before) smelterAt = { cell: g.cell, pitch: p, pos: g.pos };
  }
  if (smelterAt === null) return { fail: 'the smelter would not go down at the head', log };

  // 4: the drill, on the cell just BEYOND the run's tail, which is ore-bearing
  // ground the belts deliberately stopped short of. THE ORE STARTS FLOWING HERE
  // and nowhere earlier.
  of.build(1);
  let drill = null;
  const tailBelt = laid[0];
  for (let p = tailAim.pitch + 0.2; p <= -8 && drill === null; p += 0.25) {
    const g = await ghostAt(yaw, p);
    if (g === null || !g.ok || g.patch < 0) continue;
    const d = gdist(g.pos, tailBelt.pos);
    if (d < NEAR || d > FAR) continue;      // it has to TOUCH the tail, not merely be near it
    const before = fac().buildings;
    await placeHere();
    if (fac().buildings > before) {
      drill = { cell: g.cell, pitch: p, pos: g.pos, rate: g.ratePerSec,
                reachM: +fromEye(g).toFixed(2) };
    }
  }
  of.build(0);
  if (drill === null) {
    return { fail: 'the drill would not go down on the cell beyond the tail',
             build: of.build(), tailBelt, log };
  }
  log.push(`drill at pitch ${drill.pitch.toFixed(1)} cell ${drill.cell}, `
    + `${drill.rate.toFixed(2)} ore/s, ${drill.reachM} m out`);
  log.push(`line: ${fac().buildings} buildings, ${laid.length} belts, `
    + `runs [${fac().runs.map((r) => r.tiles)}]`);
  // THE TOPOLOGY IS CHECKED BEFORE ANYTHING IS MEASURED, because every number
  // below is meaningless on a line that is secretly three lines or that has the
  // smelter wired backwards onto its own belt. Both failures are invisible: the
  // tiles look like a straight line either way.
  const tailToSmelter = gdist(laid[0].pos, smelterAt.pos);
  const drillToSmelter = gdist(drill.pos, smelterAt.pos);
  const shape = {
    runs: fac().runs, tailToSmelter: +tailToSmelter.toFixed(2),
    drillToSmelter: +drillToSmelter.toFixed(2),
    drillToTail: +gdist(drill.pos, laid[0].pos).toFixed(2),
    headToSmelter: +gdist(laid[laid.length - 1].pos, smelterAt.pos).toFixed(2),
  };
  log.push('shape: ' + JSON.stringify(shape));
  // 2.25 m is belt-to-smelter reach and 2.75 m is drill-to-smelter reach
  // (FactoryWiring.touch on FOOTPRINT). Inside the first the smelter feeds the
  // belt it eats from; inside the second the drill hands ore straight to the
  // smelter and the belts are decoration the removal cannot interrupt.
  if (fac().runs.length !== 1 || fac().runs[0].tiles !== laid.length) {
    return { fail: 'the belts did not chain into one run', shape, plan: fac().list, log };
  }
  if (tailToSmelter <= 2.3 || drillToSmelter <= 2.8) {
    return { fail: 'the line is short enough for the smelter to short-circuit it',
             shape, log };
  }

  // --- WINDOW A: the line runs unattended ------------------------------------
  const WINDOW = 14;
  const smelter = () => fac().list.find((b) => b.kind === 'smelter');
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
    const m1 = t1.list.find((b) => b.kind === 'miner');
    const w = {
      label,
      coreTicks: t1.coreTicks - t0.coreTicks,
      expected: WINDOW * 60,
      produced,
      smelterInput: s1 === undefined ? null : s1.input,
      runs: t1.runs.map((r) => r.tiles),
      items: t1.runs.map((r) => r.items),
      minerOut: m1 === undefined ? null : m1.output,
      minerLeft: m1 === undefined ? null : m1.remaining,
      mined: t1.minedFromNodes,
      buildings: t1.buildings,
    };
    log.push(`${label}: produced ${produced}, runs [${w.runs}] items [${w.items}], `
      + `input ${w.smelterInput}, minerOut ${w.minerOut}, left ${w.minerLeft}, `
      + `mined ${w.mined}, ticks ${w.coreTicks}`);
    return w;
  };

  const running = await measure('running');

  // --- pull the MIDDLE tile out of the LONGEST run ---------------------------
  // CHOSEN BY TOPOLOGY, NOT BY THE ORDER THEY WERE LAID. The tiles a player
  // places do not always chain into one run, so "the third belt I put down" is
  // not necessarily in the middle of anything. Asking the plan which run is
  // longest and taking its middle tile is the only choice guaranteed to SPLIT a
  // line, which is the whole point of the test.
  const plan0 = fac();
  const longest = plan0.runs.indexOf(plan0.runs.slice()
    .sort((x, y) => y.tiles - x.tiles)[0]);
  const inRun = plan0.list.filter((b) => b.kind === 'belt' && b.run === longest);
  if (inRun.length < 3) return { fail: 'no run long enough to have a middle', plan: plan0.list, log };
  const midBuild = inRun[Math.floor(inRun.length / 2)];
  const midCell = midBuild.cell;
  const residue = smelter()?.input ?? 0;
  const removal = of.demolish({ id: midBuild.id });
  log.push(`removed the middle of run ${longest} (${midCell}): ${JSON.stringify(removal)}`);

  // LET THE RESIDUE FINISH, AND MEASURE HOW LONG THAT TOOK.
  //
  // The claim is "the line stops", not "it stops in the same tick": the ore
  // already inside the furnace is still smelted, and counting that against the
  // stall would be measuring the wrong thing. The residue is a KNOWN quantity
  // (the input buffer at the moment of the removal, burning at the survival
  // smelter's one per second), so the wait is bounded by it plus a margin
  // rather than guessed at. Waiting for quiet cannot hide a failure: if the
  // rebuild left the drill still feeding the furnace the quiet never comes, the
  // wait ends on its cap, and the window that follows measures the production
  // this probe is asserting is zero.
  let drainSecs = 0;
  let quiet = 0;
  const drainCap = Math.min(60, residue + 15);
  while (drainSecs < drainCap && (quiet < 3 || (smelter()?.input ?? 0) > 0)) {
    const o0 = (smelter()?.output ?? 0) + ironIn();
    await sleep(1);
    drainSecs++;
    if ((smelter()?.output ?? 0) + ironIn() === o0) quiet++; else quiet = 0;
  }
  log.push(`residue ${residue} in the furnace, quiet after ${drainSecs}s (cap ${drainCap})`);
  const stalled = await measure('stalled');

  // --- put it back -----------------------------------------------------------
  // The player has not moved since the tiles went down, so the pitch that
  // placed that cell still looks at it, and it is tried first. The band around
  // it is swept anyway, finely, because the belt being replaced is identified
  // by CELL and only that cell will do.
  of.build(2);
  await rotateTo(2);
  const wantPitch = (laid.find((b) => b.cell === midCell) ?? { pitch: -26 }).pitch;
  let rebuiltCell = null;
  const tryAt = async (p) => {
    const g = await ghostAt(yaw, p);
    if (g === null || !g.ok || g.cell !== midCell) return false;
    const n0 = fac().buildings;
    await placeHere();
    if (fac().buildings <= n0) return false;
    rebuiltCell = g.cell;
    return true;
  };
  for (let k = 0; k <= 12 && rebuiltCell === null; ++k) {
    const off = (k % 2 === 0 ? 1 : -1) * Math.ceil(k / 2) * 0.1;
    await tryAt(wantPitch + off);
  }
  for (let p = -11; p >= -50 && rebuiltCell === null; p -= 0.15) await tryAt(p);
  of.build(0);
  log.push(`rebuilt ${rebuiltCell ?? 'NOTHING'} (wanted ${midCell} near pitch `
    + `${wantPitch.toFixed(1)})`);

  const rebuilt = await measure('rebuilt');

  // --- THE KEY ITSELF -------------------------------------------------------
  // Everything above went through of.demolish, which is the X key's own
  // handler; this proves the KEY reaches it. THE PLAYER HAS TO WALK UP TO THE
  // LINE FIRST: the whole run was laid out at arm's length down the aim, five to
  // eight metres away, and Factory.pick only reaches 3.5 m. Every measurement is
  // finished by now, so moving costs nothing. Whatever ends up under the
  // crosshair is fair game, so the assertion is only that exactly one building
  // went and the ledger grew, which is all a keybinding has to prove.
  const rig = [{ n: 'smelter', ...smelterAt }, ...laid.map((b, i) => ({ n: `b${i}`, ...b }))];
  const nearest = () => {
    const e = eye();
    let bestD = Infinity;
    for (const b of rig) bestD = Math.min(bestD, gdist(b.pos, [e.x, e.y, e.z]));
    return bestD;
  };
  let stepsIn = 0;
  for (; stepsIn < 8 && nearest() > 2.6; ++stepsIn) {
    of.input.tape([{ hold: 22, keys: ['KeyW'] }, { hold: 3, keys: [] }]);
    await sleep(0.5);
  }
  of.input.tape([{ hold: 2, keys: [] }]);
  await sleep(0.3);
  log.push(`walked ${stepsIn} steps in, nearest building ${nearest().toFixed(2)} m`);
  let byKey = null;
  for (let p = -8; p >= -80; p -= 2) {
    of.look(yaw, p);
    await sleep(0.2);
    const keyBefore = of.game();
    of.input.tape([{ hold: 3, keys: ['KeyX'] }, { hold: 5, keys: [] }]);
    await sleep(0.3);
    const keyAfter = of.game();
    byKey = {
      pitch: p,
      buildingsBefore: keyBefore.factory.buildings,
      buildingsAfter: keyAfter.factory.buildings,
      removalsBefore: keyBefore.demolition.buildings,
      removalsAfter: keyAfter.demolition.buildings,
    };
    if (byKey.buildingsAfter === byKey.buildingsBefore - 1) break;
  }
  log.push(`X key at pitch ${byKey.pitch}: `
    + `${byKey.buildingsBefore} -> ${byKey.buildingsAfter} buildings`);

  const dem = of.game().demolition;
  const packIron = ironIn();

  return {
    advanced: {
      windows: [running, stalled, rebuilt].map((w) => ({
        label: w.label, coreTicks: w.coreTicks, expected: w.expected,
      })),
      rebuilds: fac().rebuilds,
      drillRatePerSec: drill.rate,
      residueAtRemoval: residue,
      drainSecs,
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
