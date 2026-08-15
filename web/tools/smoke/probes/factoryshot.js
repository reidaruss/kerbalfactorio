// FS-84: THE PICTURE OF THE MACHINE SET, at the scale FS-73 gave it.
//
// It is `shortline.js`'s scene builder VERBATIM down to the drill, and then it
// stops measuring and starts framing: the player walks back and sideways and
// aims at the centroid of everything that was placed. Reusing that builder is
// the point rather than a shortcut. The picture is then of the arrangement the
// measurements were taken on, not of a scene assembled for the camera, so the
// numbers in the commit message and the image in the screenshots directory are
// two readings of one world.
//
// WHY A PICTURE AT ALL, when eleven probes report distances to the millimetre.
// INSTRUMENTS.md's second entry: a number cannot see proportion and a screenshot
// cannot see throughput. The claim FS-73 makes is that the machine set reads as
// ONE set, and no distance in any report can be evidence for that; the terrain
// detail bump moved 35% of the near band with a healthy peak while drawing
// concentric arcs, and only a screenshot saw it.
//
// THE FILE IS `factoryshot.js` AND THE NAME IS A SCAR. It was first written as
// `machineshot.js` and silently overwrote GP-61's machine-screen capture, which
// had carried that name since the interaction panel landed. Nothing could have
// warned: a probe is a loose .js file with no registry, no index and no import,
// so writing one onto a name that is already taken is indistinguishable from
// creating it. It was caught by the commit's own `diff-index --cached
// --name-status` printing `M` where an `A` was expected, which is the reason to
// READ that output rather than trust the path list you typed, and the original
// was restored byte-identical from the parent commit.
//
// The inherited header follows, because the scene below is that probe's scene.
//
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
//
//   node tools/smoke/run.mjs --scenario=walk \
//        --evalfile=tools/smoke/probes/factoryshot.js \
//        --out=docs/screenshots/FS84_set.png
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

  // --- frame it -------------------------------------------------------------
  of.build(0);
  await sleep(0.3);
  const all = fac().list;
  const c = all.reduce((a, b) => [a[0] + b.pos[0] / all.length,
    a[1] + b.pos[1] / all.length, a[2] + b.pos[2] / all.length], [0, 0, 0]);
  // Walk backwards, then find the yaw and pitch that put the centroid of
  // everything placed nearest the crosshair. Aiming at the CENTROID rather than
  // at one machine is what makes this a picture of the set.
  of.look(yaw + 180, -6);
  for (let i = 0; i < 4; ++i) { of.input.tape([{ hold: 40, keys: ['KeyW'] }]); await sleep(0.9); }
  // AND SIDEWAYS, because a camera on the line's own axis photographs the front
  // of the smelter and nothing else. The whole claim is about PROPORTION between
  // three parts, so the shot has to see all three at once.
  for (let i = 0; i < 4; ++i) { of.input.tape([{ hold: 40, keys: ['KeyA'] }]); await sleep(0.9); }
  of.input.tape([{ hold: 2, keys: [] }]);
  await sleep(0.5);
  const missTo = (y, p) => {
    of.look(y, p);
    const a = of.aim();
    const e = a.origin;
    const v = [c[0] - e[0], c[1] - e[1], c[2] - e[2]];
    const t = v[0] * a.dir[0] + v[1] * a.dir[1] + v[2] * a.dir[2];
    return t <= 0 ? Infinity
      : Math.hypot(v[0] - a.dir[0] * t, v[1] - a.dir[1] * t, v[2] - a.dir[2] * t);
  };
  let by = yaw + 180;
  let bp = -8;
  for (const step of [20, 5, 1.2]) {
    let bm = Infinity;
    let ny = by;
    let np = bp;
    for (let k = -9; k <= 9; ++k) {
      for (const dp of [-20, -14, -9, -5, -2]) {
        const m = missTo(by + k * step, dp);
        if (m < bm) { bm = m; ny = by + k * step; np = dp; }
      }
    }
    by = ny; bp = np;
  }
  of.look(by, bp);
  await sleep(1.4);
  const f9 = fac();
  return {
    valid: f9.buildings >= 4 && f9.links.length >= 2,
    buildings: f9.buildings, kinds: f9.list.map((b) => b.kind),
    links: f9.links.length, footprint: f9.footprint,
    standoffM: +Math.hypot(eye().x - c[0], eye().y - c[1], eye().z - c[2]).toFixed(2),
    log,
  };
})()
