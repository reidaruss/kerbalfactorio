// FS-43 to FS-47: A BELT CONNECTS TO A PORT, AND A BELT AT THE BARE HOUSING
// REFUSES OUT LOUD.
//
// BT-130: hit the shared sweep's 240 s cap and was recorded NO_OUTPUT under
// the BT-116 4-way batch. Re-run standalone on a quiet machine, no wrapper
// timeout (2026-08-15, lane/probeall-debts): finished (its own separate RED,
// unrelated to this timeout) in 298.5 s -- past the old 240 s cap with ZERO
// contention, so parallelism was never the cause here. Four real 20 s
// in-game measurement windows plus the walk/aim/build overhead around them
// add up to a cost this probe genuinely has.
// BT-175: the BT-155 census ran a 420000 ms override and the probe finished
// at 420043 ms, 43 ms inside its own cap under real contention -- not a
// margin, a coin flip. BT-210 to BT-224 replaced this file's own
// PROBEALL-TIMEOUT marker (and every other probe's) with one committed,
// measured, generated file, `web/tools/smoke/probe-budgets.json`: see that
// file and `build-probe-budgets.mjs` for the current numbers and the margin
// rule, which is now applied uniformly instead of being hand-raised per coin
// flip.
//
// Reid asked for Satisfactory's model: a machine has specific slots you belt
// into and a specific slot you belt out of. This probe drives it, on a real
// world, with real key presses, and measures all three halves of the claim on
// ONE scene so they cannot be checked against three different factories.
//
// THE SHAPE, and it is FS-17's shape on purpose: a drill, two belt tiles, a
// smelter at the head. That is the geometry the old proximity wiring deadlocked
// on, and re-using it means this probe re-checks FS-17 while it checks FS-44.
//
// THE FOUR PHASES, in order, on the same buildings:
//
//   A  BELT INTO AN INPUT PORT FEEDS. `socket_belt_out` of the run's head mates
//      `socket_item_in` of the smelter, and iron appears with nobody feeding it.
//   B  A BELT AT THE BARE HOUSING REFUSES. One press of the rotate key on the
//      SMELTER turns its inlet away, so the belt now runs into the side of the
//      housing. The connection must vanish, a refusal must appear naming the
//      port and the fix, and the smelter must STOP BEING FED.
//
//      IT IS THE FEED THAT IS ASSERTED, NOT THE OUTPUT, and the first draft
//      of this probe got that wrong in a way worth recording. It asserted
//      `ironMade === 0` across window B, and measured 20: MORE than the 18 the
//      connected window made. Nothing was broken. A smelter that loses its feed
//      keeps smelting what it already holds, which is what a real furnace does
//      and what /core has always done, and 27 units of buffered ore is 27 more
//      units of iron whatever the belt is doing. The assertion was a guess about
//      a symptom rather than a statement of the claim. Standing rule 11's own
//      lesson, paid for cheaply that time: assert the property the code claims.
//
//      THE SECOND DRAFT ASSERTED THE BUFFER LEVEL AND THAT WAS WRONG TOO, for
//      the opposite reason, and this one cost a red (FS-114, 2026-08-16). It
//      required the hopper to FALL across window B and to RISE across window C,
//      which is only measurable while the hopper HOLDS something. Measured on
//      this scene by polling the hopper 40 times a window instead of twice:
//      window A `input` was 0 in 39 of 40 samples and 1 in one, window C the
//      same, and window B 0 in 40 of 40. THE PEAK HOPPER DEPTH ON A CONNECTED
//      MACHINE IS ONE UNIT. The 27 units the paragraph above describes are
//      gone: `SMELT_TICKS` is 60, so the smelter can eat 60 ore a 20 s window
//      while the drill on this patch delivers 17 to 19, and a machine that
//      outruns its supply by three to one never accumulates anything to drain.
//      So `inputFell` was a 1-in-40 coin flip standing in for the claim, which
//      is the "metric that is flat in its own independent variable" trap in
//      NUMBERS.md: it read the same, false, whether the belt was feeding or not.
//
//      WHAT IS ASSERTED NOW IS WHAT ARRIVED (FS-115), which is conserved and
//      does not care how deep the buffer is: ore in = ore smelted + change in
//      the hopper. Window A 17, window B 0, window C 17, on the same machine
//      and the same 20 s. A and C are the on-scene positive control for B.
//   C  IT IS RECOVERABLE. Three more presses bring the smelter back round. The
//      connection returns and production resumes. That is the whole answer to
//      "is a refusal a deadlock": the player turns the machine and it works.
//   D  THE OUTPUT PORT IS A DIFFERENT PORT, AND A BELT ON IT TAKES. The player
//      WALKS AROUND the smelter to its far side and LAYS one belt tile at the
//      `socket_item_out` face. Three things are then true or the phase failed:
//      the ghost named that port before the button went down, the link that
//      landed names `socket_item_out` on one side and `socket_belt_in` on the
//      other, and ingots physically rode the tile away from the machine.
//
//      THE FIRST VERSION OF THIS PHASE SWEPT THE GHOST AND PROVED NOTHING, and
//      that is a finding worth recording rather than a fix worth hiding. It
//      stood where the PHASE B approach walk left it, which is on the INPUT
//      side, and swept 41 headings by 15 pitches from there: 307 ghost
//      sentences, `sawOutPort` false, and a verdict that read like a statement
//      about the port model. It was nothing of the kind. The smelter sits at
//      cell `m1:2,0` with the belt run at `2,1 / 2,2 / 2,3`, so every cell the
//      crosshair could reach from the input side has j >= 0, and the output
//      face is the cell at `2,-1`, BEHIND the housing. A ghost cannot see
//      through a machine. The sweep was measuring where the player's feet were
//      and would have gone on reporting a missing output port for ever, which
//      is DW-20's failure in its purest form: a number that cannot tell "there
//      is no output port" from "we never looked at one".
//
//      So the phase WALKS, three waypoints around the housing rather than
//      straight through it, and then PLACES. Placing rather than sweeping is
//      also the brief's own second clause: "a belt from the output port takes"
//      is a claim about ingots moving, and no ghost sentence can answer it.
//
//      THE OUTPUT BUFFER DOES NOT STOP GROWING, AND THAT IS CORRECT. One belt
//      tile holds four items (kItemSpacing 64 of kUnitsPerTile 256), so a
//      dead-end tile fills, back-pressures, and the smelter's buffer picks up
//      where it left off. Both numbers are reported, against PHASE C's growth
//      on the same machine with no belt on it at all. The number that PROVES
//      the take is the item count ON the tile, which is zero for every way this
//      phase can fail and non-zero only if /core moved an ingot out of a port.
//
// WHY PHASE B IS A KEY PRESS AND NOT A SECOND BELT. It is one input, it is
// reversible, and it isolates exactly one variable: nothing moves, nothing is
// placed or removed, no run is re-chained, and the only thing that changes
// between a working line and a refused one is which way a housing faces. A
// probe that laid a second belt somewhere else would be comparing two scenes.
//
// STANDING RULE 11. Every number below is asserted, not printed. The five that
// FAIL against proximity wiring are marked FAILS-OLD, and they are the reason
// this file exists rather than a rerun of shortline.js:
//   portMated          proximity has no ports and no gap to report
//   refusedAfterTurn   proximity does not care which way a housing faces
//   oreArrived 0 in B  proximity goes on feeding through the turn
//   recovered          nothing to recover from
//   insertersDrawn 0   proximity draws one arm per connection
//
//   node tools/smoke/run.mjs --scenario=walk \
//        --evalfile=tools/smoke/probes/machineports.js
(async () => {
  const of = window.__of;
  const sleep = (n) => of.run(n);
  const log = [];
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
  const gdist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  const eye = () => { const o = of.aim().origin; return { x: o[0], y: o[1], z: o[2] }; };
  // The factory reports positions as [x,y,z] triples and the ore nodes report
  // them as {x,y,z}. One converter, so the walk helpers below can be pointed at
  // either without each caller inventing its own spelling.
  const asPt = (a) => ({ x: a[0], y: a[1], z: a[2] });
  const fac = () => of.game().factory;
  const ironIn = () => (of.game().carried.find((c) => c.name === 'Iron') ?? { count: 0 }).count;
  const ore = () => of.nodes().find((n) => n.kind === 3 && n.remaining > 20)
            ?? of.nodes().find((n) => n.kind === 2 && n.remaining > 20);

  await sleep(0.5);
  let node = ore();
  if (node === undefined) return { fail: 'no ore node in the clearing' };

  // --- face the deposit and walk onto it (shortline.js's search, guard and all)
  // `miss` and `aimAt` take the point to face rather than closing over `node`,
  // because the same coarse-to-fine yaw search has to be run twice on this
  // scene: once at the deposit, and once again later to close the gap to the
  // smelter. Two copies of a search is two things to get subtly different.
  const miss = (tgt) => {
    const a = of.aim();
    const e = { x: a.origin[0], y: a.origin[1], z: a.origin[2] };
    const v = { x: tgt.x - e.x, y: tgt.y - e.y, z: tgt.z - e.z };
    const t = v.x * a.dir[0] + v.y * a.dir[1] + v.z * a.dir[2];
    if (t <= 0) return Infinity;
    return Math.hypot(v.x - a.dir[0] * t, v.y - a.dir[1] * t, v.z - a.dir[2] * t);
  };
  const aimAt = (tgt) => {
    let best = of.world().observer.yawDeg;
    for (const step of [20, 5, 1.5]) {
      const span = step === 20 ? 9 : 5;
      let bestMiss = Infinity;
      let bestYaw = best;
      for (let k = -span; k <= span; ++k) {
        of.look(best + k * step, -8);
        const m = miss(tgt);
        if (m < bestMiss) { bestMiss = m; bestYaw = best + k * step; }
      }
      best = bestYaw;
    }
    of.look(best, -8);
  };
  aimAt(node);
  let walked = 0;
  let closest = dist(eye(), node);
  let worse = 0;
  for (let i = 0; i < 45; ++i) {
    node = of.nodes().find((n) => n.index === node.index) ?? node;
    const d = dist(eye(), node);
    if (d < 5.0) break;
    if (d < closest - 0.05) { closest = d; worse = 0; }
    else if (++worse >= 2) { aimAt(node); worse = 0; }
    of.input.tape([{ hold: 60, keys: ['KeyW'] }]);
    await sleep(1.1);
    walked++;
  }
  of.input.tape([{ hold: 2, keys: [] }]);
  await sleep(0.2);
  aimAt(node);
  const standoff = dist(eye(), node);
  log.push(`walked ${walked} bursts to ${standoff.toFixed(2)} m`);
  if (standoff > 10.6) return { fail: 'the walk never reached the deposit', standoff, log };

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
    for (const [span, step] of [[23, 2], [5, 0.4]]) {
      let by = bestYaw;
      let bd = -2;
      for (let k = -span; k <= span; ++k) {
        const g = await ghostAt(bestYaw + k * step, -26);
        if (g === null) continue;
        const a = of.aim();
        const d = -(a.dir[0] * g.fwd[0] + a.dir[1] * g.fwd[1] + a.dir[2] * g.fwd[2]);
        if (d > bd) { bd = d; by = bestYaw + k * step; }
      }
      bestYaw = by;
    }
    log.push(`flow axis: yaw ${yaw.toFixed(1)} -> ${bestYaw.toFixed(1)}`);
    yaw = bestYaw;
  }

  // --- two belts, one press each (shortline.js's argument for not dragging) ---
  const beltSweep = [];
  for (let p = -12; p >= -52; p -= 0.3) {
    const g = await ghostAt(yaw, p);
    if (g === null) continue;
    beltSweep.push({ pitch: p, ok: g.ok, pos: g.pos, prospective: g.prospective,
      reachM: +fromEye(g).toFixed(2) });
  }
  // FS-83. THE TAIL COMES IN BY THE EXTRA CELLS THE DRILL NOW NEEDS BEHIND IT.
  // The drill used to mate the tail one cell out and now needs `cellsFor` cells,
  // so laying the tail at the same 7.7 m put the drill past the build reach and
  // this probe reported "the drill would not go down beyond the tail" for a
  // world in which nothing was wrong. The band moves with the table rather than
  // being re-picked, so the drill still lands on the same ground it always did.
  const tailBandM = 7.7 - (cellsFor('miner', 'belt') - 1);
  const tailAim = beltSweep.filter((s) => s.ok && s.reachM <= tailBandM)
    .reduce((a, b) => (a === null || b.reachM > a.reachM ? b : a), null);
  if (tailAim === null) return { fail: 'no belt cell inside the reach band', log };
  of.look(yaw, tailAim.pitch);
  await sleep(0.2);
  {
    const before = fac().buildings;
    await placeHere();
    if (fac().buildings <= before) return { fail: 'the first belt press placed nothing', log };
  }
  const tail0 = fac().list.find((b) => b.kind === 'belt');
  let headAim = null;
  for (let p = tailAim.pitch - 0.1; p >= -52 && headAim === null; p -= 0.15) {
    const g = await ghostAt(yaw, p);
    if (g === null || !g.ok || g.prospective === true) continue;
    const d = gdist(g.pos, tail0.pos);
    if (d > matesFar('belt', 'belt')) break;
    if (d > 0.6) headAim = { pitch: p, pos: g.pos };
  }
  if (headAim === null) return { fail: 'no cell adjacent to the tail on this heading', log };
  of.look(yaw, headAim.pitch);
  await sleep(0.2);
  {
    const before = fac().buildings;
    await placeHere();
    if (fac().buildings <= before) return { fail: 'the second belt press placed nothing', log };
  }
  await sleep(0.3);

  const eyeNow = eye();
  const laid = fac().list.filter((b) => b.kind === 'belt')
    .map((b) => ({ id: b.id, cell: b.cell, pos: b.pos,
      fromEyeM: gdist(b.pos, [eyeNow.x, eyeNow.y, eyeNow.z]) }))
    .sort((a, b) => b.fromEyeM - a.fromEyeM);
  if (laid.length !== 2) return { fail: 'did not lay exactly two belts', laid, log };
  const headBelt = laid[laid.length - 1];

  // --- the smelter at the head, THROUGH THE SNAP -----------------------------
  // The ghost's own `ports` sentence is captured at the moment of placement,
  // because FS-45's claim is that the verdict arrives BEFORE the button, and a
  // sentence read afterwards would prove only that it arrives eventually.
  of.build(3);
  let smelterAt = null;
  let ghostSaidBefore = '';
  for (let p = headAim.pitch - 0.2; p >= -62 && smelterAt === null; p -= 0.25) {
    const g = await ghostAt(yaw, p);
    if (g === null || !g.ok) continue;
    const d = gdist(g.pos, headBelt.pos);
    if (d < 0.5) continue;
    if (d > matesFar('belt', 'smelter')) break;
    const before = fac().buildings;
    ghostSaidBefore = g.ports ?? '';
    await placeHere();
    if (fac().buildings > before) smelterAt = { pitch: p, pos: g.pos };
  }
  if (smelterAt === null) return { fail: 'the smelter would not go down at the head', log };
  log.push(`ghost said before the press: "${ghostSaidBefore}"`);

  of.build(1);
  let drill = null;
  const tailBelt = laid[0];
  for (let p = tailAim.pitch + 0.2; p <= -8 && drill === null; p += 0.25) {
    const g = await ghostAt(yaw, p);
    if (g === null || !g.ok || g.patch < 0) continue;
    const d = gdist(g.pos, tailBelt.pos);
    if (d < matesNear('belt', 'smelter') || d > matesFar('belt', 'smelter')) continue;
    const before = fac().buildings;
    await placeHere();
    if (fac().buildings > before) drill = { pos: g.pos, rate: g.ratePerSec };
  }
  of.build(0);
  if (drill === null) return { fail: 'the drill would not go down beyond the tail', log };

  // --- PHASE A: the port connection itself -----------------------------------
  const f0 = fac();
  const smelter = f0.list.find((b) => b.kind === 'smelter');
  const drillRow = f0.list.find((b) => b.kind === 'miner');
  const heads = new Set(f0.runs.map((r) => r.head));
  const tails = new Set(f0.runs.map((r) => r.tail));
  const feedLink = f0.links.find((l) => heads.has(l.from) && l.to === smelter.id);
  const shape = {
    portsLoaded: f0.portsLoaded,
    runs: f0.runs.map((r) => ({ tiles: r.tiles, tail: r.tail, head: r.head })),
    links: f0.links,
    refusals: f0.refusals,
    // FS-17's own assertion, on FS-17's own geometry, under the new model.
    linksToTail: f0.links.filter((l) => l.from === smelter.id && tails.has(l.to)).length,
    headToSmelterCentresM: +gdist(headBelt.pos, smelterAt.pos).toFixed(3),
  };
  log.push('shape: ' + JSON.stringify(shape));

  const WINDOW = 20;
  const measure = async (label) => {
    const b = fac();
    const s0 = b.list.find((x) => x.id === smelter.id);
    const i0 = ironIn();
    await sleep(WINDOW);
    const a = fac();
    const s1 = a.list.find((x) => x.id === smelter.id);
    const r = {
      label,
      coreTicks: a.coreTicks - b.coreTicks,
      ironMade: (s1?.output ?? 0) - (s0?.output ?? 0) + (ironIn() - i0),
      // ORE THAT ARRIVED AT THE MACHINE THIS WINDOW, which is FS-115: the one
      // number phase B is actually about, and a conserved one. Every unit that
      // reaches the hopper is either still in it at the end of the window or
      // was smelted, so `consumed + (hopperEnd - hopperStart)` is what came in
      // whatever the buffer happens to be doing. `placeSmelter` (automation.h
      // line 151) authors the recipe as inputCount 1 -> outputCount 1, so one
      // ingot produced IS one ore consumed and no ratio is transcribed here.
      //
      // Production is read from `producedOfOutput`, /core's own tally, and NOT
      // from the output buffer: phase D hangs a belt on the output face and
      // carries ingots off, so the buffer delta undercounts there (measured: 12
      // against 17). The tally is zeroed by a network REBUILD, so `rebuilt`
      // below is published and asserted -- a rebuild inside a window would zero
      // the tally and read exactly like a machine that was never fed.
      produced: (s1?.producedOfOutput ?? 0) - (s0?.producedOfOutput ?? 0),
      oreArrived: (s1?.producedOfOutput ?? 0) - (s0?.producedOfOutput ?? 0)
        + ((s1?.input ?? 0) - (s0?.input ?? 0)),
      rebuilt: a.rebuilds - b.rebuilds,
      // BOTH ENDS OF THE HOPPER. REPORTED AND NO LONGER ASSERTED (FS-114): see
      // the header. The hopper's measured peak on this scene is ONE unit, so a
      // strict fall between two end samples was a 1-in-40 coin flip and could
      // not distinguish a fed machine from a starved one.
      inputBefore: s0?.input ?? null,
      smelterInput: s1?.input ?? null,
      inputFell: (s1?.input ?? 0) < (s0?.input ?? 0),
      inputRose: (s1?.input ?? 0) > (s0?.input ?? 0),
      minedDelta: a.minedFromNodes - b.minedFromNodes,
      links: a.links.length,
      refusals: a.refusals.length,
    };
    log.push(`window ${label}: ` + JSON.stringify(r));
    return r;
  };
  const phaseA = await measure('A connected');

  // --- WALK INTO PICK REACH BEFORE TOUCHING THE SMELTER ----------------------
  // `GameplayAim.ts` resolves the crosshair at PICK_REACH_M = 3.5 m and not a
  // centimetre further, on every category, deliberately so a machine and the
  // pad under it can never be picked at different ranges. The smelter was
  // placed from where the drill went down, which is five to six metres back
  // along the run, so NO aim sweep taken from there can ever resolve it: the
  // sweep is not broken, the machine is out of reach. Close the distance first,
  // on foot, with the same tape burst the deposit walk above uses.
  //
  // WHY THE BURST IS SIZED TO THE GAP instead of the flat 60 frames the deposit
  // walk fires. `Controller.ts` walks at 4.6 m/s, so a 60-frame hold covers
  // about four and a half metres; fired at a target five metres out that lands
  // the player past the smelter, and a probe that oscillates around its target
  // spends its whole budget and still fails. Same tape, same key, length set by
  // what is left to cover.
  const smelterPt = asPt(smelterAt.pos);
  aimAt(smelterPt);
  let approach = 0;
  let gap = dist(eye(), smelterPt);
  for (let i = 0; i < 16 && gap > 3.0; ++i) {
    const frames = Math.max(5, Math.min(60, Math.round(((gap - 2.4) / 4.6) * 60)));
    of.input.tape([{ hold: frames, keys: ['KeyW'] }, { hold: 2, keys: [] }]);
    await sleep(1.1);
    approach++;
    // Re-aimed every burst rather than every second worsening one: the target
    // is now meters rather than tens of meters away, so a step that drifts
    // sideways is a large angle, and a stale heading walks past the machine.
    aimAt(smelterPt);
    gap = dist(eye(), smelterPt);
  }
  of.input.tape([{ hold: 2, keys: [] }]);
  await sleep(0.2);
  aimAt(smelterPt);
  gap = dist(eye(), smelterPt);
  log.push(`approach: ${approach} bursts to ${gap.toFixed(2)} m from the smelter`);
  // DW-20. A probe that proceeds from the wrong place measures the wrong thing,
  // and would report "the crosshair found nothing" as though that were a fact
  // about the port model rather than about where its feet are.
  if (gap > 3.4) {
    return { fail: 'walked at the smelter but stopped outside pick reach',
      gapM: +gap.toFixed(2), pickReachM: 3.5, approach, shape, phaseA, log };
  }

  // --- PHASE B: turn the SMELTER so the belt runs into its side --------------
  // Aimed and turned with the same key a player uses. `of.turn(id)` would have
  // been shorter and would have proved a path nobody can take (standing rule 3).
  //
  // The sweep is centred on where the observer is looking NOW and not on the
  // yaw/pitch the ghost sweep used, because the probe has walked since: those
  // angles were measured from a standing point that is now several metres
  // behind, and re-using them aims at ground the player has already crossed.
  // The pair that lands is kept in `aimYaw`/`aimPitch` for the same reason,
  // so PHASE D's ghost sweep can start from the smelter rather than from a
  // remembered position that no longer exists.
  let aimYaw = yaw;
  let aimPitch = smelterAt.pitch;
  const aimOffsets = [];
  for (let k = -12; k <= 12; ++k) {
    for (let j = -20; j <= 8; ++j) aimOffsets.push([k, j]);
  }
  // Nearest-to-centre first. The crosshair is already on the machine after the
  // walk, so the common case is one sample, and the spiral only pays for itself
  // on the turns of PHASE C where the housing has moved under the reticle.
  aimOffsets.sort((a, b) =>
    (Math.abs(a[0]) + Math.abs(a[1])) - (Math.abs(b[0]) + Math.abs(b[1])));
  const aimSmelter = async () => {
    const o = of.world().observer;
    const cy = o.yawDeg;
    const cp = o.pitchDeg;
    for (const [k, j] of aimOffsets) {
      const y = cy + k * 1.5;
      const p = cp + j * 1.5;
      of.look(y, p);
      await sleep(0.02);
      if ((of.game().aimed?.build?.id ?? -1) !== smelter.id) continue;
      aimYaw = y;
      aimPitch = p;
      of.look(y, p);
      await sleep(0.05);
      return (of.game().aimed?.build?.id ?? -1) === smelter.id;
    }
    return false;
  };
  if (!(await aimSmelter())) {
    return { fail: 'could not put the crosshair on the smelter to turn it',
      gapM: +gap.toFixed(2), aimedNow: of.game().aimed ?? null, shape, phaseA, log };
  }
  const turn = async () => {
    of.input.tape([{ hold: 3, keys: ['KeyR'] }, { hold: 4, keys: [] }]);
    await sleep(0.2);
  };
  await turn();
  const fB = fac();
  const smelterB = fB.list.find((x) => x.id === smelter.id);
  const refusalB = fB.refusals.find((r) => r.to === smelter.id) ?? fB.refusals[0] ?? null;
  const turned = {
    fwdBefore: smelter.fwd, fwdAfter: smelterB?.fwd ?? null,
    links: fB.links.filter((l) => l.to === smelter.id).length,
    refusal: refusalB,
  };
  log.push('after one turn: ' + JSON.stringify(turned));
  const phaseB = await measure('B housing');

  // --- PHASE C: three more turns bring it back, and the line runs again ------
  for (let i = 0; i < 3; ++i) { await aimSmelter(); await turn(); }
  const fC = fac();
  const relinked = fC.links.find((l) => heads.has(l.from) && l.to === smelter.id) ?? null;
  log.push('after four turns: ' + JSON.stringify({ link: relinked,
    refusals: fC.refusals.length }));
  const phaseC = await measure('C recovered');

  // --- PHASE D1: THE SWEEP THAT PROVED NOTHING, KEPT AS THE RECORD -----------
  // This block used to BE phase D, and its verdict `sawOutPort` used to be an
  // assertion. It is neither now, and the header says why at length: swept from
  // the input side, where the PHASE B approach walk leaves the player, it can
  // only ever reach cells on the near face of the housing, so a false
  // `sawOutPort` was a statement about the player's feet dressed up as a
  // statement about the port model.
  //
  // It is kept, unweakened, for the two things it still measures honestly. The
  // REFUSAL sentence is one of them: a belt ghost laid against the bare side of
  // a machine has to say WILL NOT CONNECT and say why, and the near face is
  // exactly where that has to be true. `dCells` is the other, and it is the
  // evidence for the paragraph above rather than an assurance about it.
  //
  // Swept around `aimYaw`/`aimPitch`, the pair that last put the crosshair on
  // the smelter, and NOT around the `yaw`/`smelterAt.pitch` the smelter was
  // placed from. Those were taken before the approach walk above; from where
  // the player stands now they point at ground behind the machine, and the
  // sweep would have quietly measured an empty patch of clearing.
  of.build(2);
  const outSightings = [];
  // WHERE THE SWEEP ACTUALLY PUT THE GHOST, logged and not asserted. A sweep
  // that reports "no output port anywhere" is two very different findings
  // depending on whether it ever managed to place a cell on the far side of the
  // machine, and a run that cannot tell them apart has measured nothing
  // (DW-20). The cells are collected here so the verdict below can be read
  // against the ground the crosshair covered rather than taken on trust.
  const dCells = new Map();
  for (let k = -20; k <= 20; ++k) {
    for (let j = -22; j <= 6; j += 2) {
      const g = await ghostAt(aimYaw + k * 1.5, aimPitch + j * 1.0);
      if (g === null) continue;
      // BuildMode's ghost reports the address as site plus [i,j] where the
      // factory list reports it as one "site:i,j" string. Spelled the factory's
      // way here so the log can be read straight against `smelter.cell`.
      const addr = `${g.site}:${g.ij[0]},${g.ij[1]}`;
      if (!dCells.has(addr)) {
        dCells.set(addr, { ok: g.ok, fromSmelterM: +gdist(g.pos, smelterAt.pos).toFixed(2) });
      }
      if (!g.ok || typeof g.ports !== 'string' || g.ports === '') continue;
      outSightings.push(g.ports);
    }
    if (outSightings.some((s) => s.includes('socket_item_out'))) break;
  }
  of.build(0);
  log.push('D sweep centred on yaw ' + aimYaw.toFixed(1) + ' pitch ' + aimPitch.toFixed(1)
    + ', smelter cell ' + smelter.cell + ', cells the ghost reached: '
    + JSON.stringify([...dCells.entries()].map(([c, v]) =>
      c + (v.ok ? '' : '!') + '@' + v.fromSmelterM).slice(0, 40)));
  const sawOutPort = outSightings.some((s) => s.includes('socket_item_out'));
  const sawRefusalSentence = outSightings.some((s) => s.startsWith('WILL NOT CONNECT'));
  log.push(`ghost sentences seen: ${outSightings.length}, `
    + `an output-port mate: ${sawOutPort}, a refusal: ${sawRefusalSentence}`);

  // --- PHASE D2: WALK AROUND THE HOUSING TO THE OUTPUT FACE ------------------
  // The frame is the SMELTER'S OWN, read back out of the plan rather than
  // guessed from the heading the probe placed it on: `fwd` is what the four R
  // presses of phases B and C left it at, and `up` is what the ground under it
  // says, so `right = up x fwd` closes a tangent basis centred on the machine.
  // Everything below is expressed in that basis, which is why it does not care
  // which quarter turn the smelter ended on or which way the clearing faces.
  //
  // THREE WAYPOINTS AND NOT ONE, because the machine is IN THE WAY. A straight
  // line from the input side to the output side passes through a 2 m housing
  // and a walker with a radius; measured against the geometry, the direct line
  // to the far face clears the smelter's centre by 1.26 m, which is inside the
  // 1.0 m half-extent plus the player's own radius. The dog-leg below clears it
  // by 4.27 m and then 2.60 m. That is arithmetic done once here rather than a
  // walk that sticks on the corner and reports "could not reach the far side"
  // as though it were a fact about ports.
  const smelterD = fac().list.find((b) => b.id === smelter.id);
  if (smelterD === undefined) return { fail: 'the smelter left the plan', log };
  const S = smelterD.pos;
  const F = smelterD.fwd;
  const U = smelterD.up;
  const R = [U[1] * F[2] - U[2] * F[1], U[2] * F[0] - U[0] * F[2],
    U[0] * F[1] - U[1] * F[0]];
  const around = (f, r) => ({ x: S[0] + F[0] * f + R[0] * r,
    y: S[1] + F[1] * f + R[1] * r, z: S[2] + F[2] * f + R[2] * r });
  // The cell the output port actually faces. One metre out along +fwd, which is
  // the same one-cell step the INPUT side mates across: the smelter is at
  // `m1:2,0` and the belt that feeds it at `m1:2,1`.
  const outPt = around(1.0, 0);
  // Reuses `aimAt` and the same `KeyW` tape burst the deposit and approach walks
  // fire, with the burst length sized to what is left to cover for the reason
  // the approach walk gives: a flat 60-frame hold is four and a half metres and
  // these legs are three to five.
  const walkTo = async (pt, stopM) => {
    aimAt(pt);
    let d = dist(eye(), pt);
    for (let i = 0; i < 12 && d > stopM; ++i) {
      const frames = Math.max(5, Math.min(60,
        Math.round(((d - stopM * 0.7) / 4.6) * 60)));
      of.input.tape([{ hold: frames, keys: ['KeyW'] }, { hold: 2, keys: [] }]);
      await sleep(1.1);
      aimAt(pt);
      d = dist(eye(), pt);
    }
    of.input.tape([{ hold: 2, keys: [] }]);
    await sleep(0.2);
    return +d.toFixed(2);
  };
  const legs = [];
  legs.push(await walkTo(around(0, 4.5), 1.6));
  legs.push(await walkTo(around(4.5, 3.0), 1.6));
  legs.push(await walkTo(around(2.6, 0), 1.2));
  const outStand = dist(eye(), outPt);
  const sideNow = (() => {
    const e = eye();
    return +((e.x - S[0]) * F[0] + (e.y - S[1]) * F[1] + (e.z - S[2]) * F[2])
      .toFixed(2);
  })();
  log.push(`D walk-around: legs ${legs.join(' / ')} m, now ${outStand.toFixed(2)} m `
    + `from the output cell, ${sideNow} m along +fwd (positive is the out side)`);
  // DW-20. A phase that carried on from the wrong side of the machine is exactly
  // the failure this rewrite exists to remove, so it says where it got to and
  // stops rather than sweeping an unreachable face a second time.
  if (outStand > 4.0 || sideNow <= 0.5) {
    return { fail: 'the walk never got round to the output face',
      reached: { outStandM: +outStand.toFixed(2), alongFwdM: sideNow, legs },
      shape, turned, phases: { A: phaseA, B: phaseB, C: phaseC }, log };
  }

  // --- PHASE D3: LAY ONE BELT TILE ON THE OUTPUT PORT ------------------------
  // Swept for the sentence, not for the cell. `FactoryGhost.portPreview` and
  // `FactoryWiring.wire` are the same `linksBetween` call, so a ghost that names
  // `socket_item_out` is the connection that is about to be made; a probe that
  // picked a cell by distance and hoped would be guessing at the thing it is
  // supposed to be measuring.
  //
  // The heading is `aimAt(outPt)`'s, which is the same yaw search the deposit
  // walk uses, and the pitch sweep walks the ghost from the reach limit back to
  // the player's feet exactly as the belt sweep at the top of this file does.
  const beltIdsBefore = new Set(fac().list.filter((b) => b.kind === 'belt')
    .map((b) => b.id));
  of.build(2);
  aimAt(outPt);
  const outYaw = of.world().observer.yawDeg;
  const outCells = new Map();
  let outAim = null;
  for (let k = -6; k <= 6 && outAim === null; ++k) {
    for (let p = -10; p >= -78; p -= 1.5) {
      const g = await ghostAt(outYaw + k * 2.5, p);
      if (g === null) continue;
      const addr = `${g.site}:${g.ij[0]},${g.ij[1]}`;
      if (!outCells.has(addr)) {
        outCells.set(addr, { ok: g.ok,
          fromOutM: +gdist(g.pos, [outPt.x, outPt.y, outPt.z]).toFixed(2) });
      }
      if (!g.ok || typeof g.ports !== 'string') continue;
      if (!g.ports.includes('socket_item_out')) continue;
      outAim = { yaw: outYaw + k * 2.5, pitch: p, cell: addr, snapped: g.snapped };
      break;
    }
  }
  log.push('D out sweep from yaw ' + outYaw.toFixed(1) + ', smelter cell '
    + smelter.cell + ', cells reached: ' + JSON.stringify(
      [...outCells.entries()].map(([c, v]) =>
        c + (v.ok ? '' : '!') + '@' + v.fromOutM).slice(0, 40)));
  if (outAim === null) {
    of.build(0);
    return { fail: 'no ghost on the far side named socket_item_out',
      reached: { outStandM: +outStand.toFixed(2), alongFwdM: sideNow, legs,
        cells: [...outCells.keys()] },
      shape, turned, phases: { A: phaseA, B: phaseB, C: phaseC }, log };
  }
  // CAPTURED BEFORE THE BUTTON, the same way `ghostSaidBefore` is on the input
  // side and for the same reason: FS-45's claim is that the verdict arrives
  // first, and a sentence read after the tile landed proves only that it arrives.
  of.look(outAim.yaw, outAim.pitch);
  await sleep(0.2);
  const ghostSaidOut = of.build().ghost?.ports ?? '';
  const beforeOut = fac().buildings;
  await placeHere();
  await sleep(0.4);
  of.build(0);
  if (fac().buildings <= beforeOut) {
    return { fail: 'the press at the output face placed nothing',
      outAim, ghostSaidOut, shape, turned,
      phases: { A: phaseA, B: phaseB, C: phaseC }, log };
  }
  const outBelt = fac().list.find((b) => b.kind === 'belt'
    && !beltIdsBefore.has(b.id)) ?? null;
  const outLink = fac().links.find((l) => l.from === smelter.id
    && l.fromPort === 'socket_item_out' && l.toPort === 'socket_belt_in') ?? null;
  log.push('D placed: ' + JSON.stringify({ ghostSaidOut,
    belt: outBelt === null ? null : { id: outBelt.id, cell: outBelt.cell },
    link: outLink }));

  // --- PHASE D4: AND IT TAKES ------------------------------------------------
  // The same 20 s window the other three phases use, so "ingots left the
  // machine" is measured over the same amount of sim as "ingots were made".
  //
  // TWO NUMBERS AND ONE ASSERTION. The output buffer's growth is reported
  // against PHASE C's growth on the same machine with no belt on it, and it is
  // NOT asserted to be zero: one tile holds four items, so a dead-end belt fills
  // and back-pressures and the buffer resumes. The assertion is the item count
  // ON the tile, which is what "a belt from the output port takes" actually
  // says, and it is polled rather than sampled once because a belt this short
  // hands items straight back to nothing and its count is a level, not a total.
  const outBufBefore = fac().list.find((x) => x.id === smelter.id)?.output ?? 0;
  const phaseD = await measure('D belted');
  const outBufAfter = fac().list.find((x) => x.id === smelter.id)?.output ?? 0;
  let beltPeakOut = 0;
  for (let i = 0; i < 30; ++i) {
    await sleep(0.2);
    const g = fac();
    for (const r of g.runs) {
      if (outBelt !== null && (r.tail === outBelt.id || r.head === outBelt.id)) {
        beltPeakOut = Math.max(beltPeakOut, r.items);
      }
    }
  }
  const outTook = {
    ghostSaidOut,
    beltId: outBelt === null ? null : outBelt.id,
    beltCell: outBelt === null ? null : outBelt.cell,
    link: outLink,
    outputBefore: outBufBefore,
    outputAfter: outBufAfter,
    outputGrewD: outBufAfter - outBufBefore,
    // The same machine, the same window length, no belt on the output face.
    outputGrewC: phaseC.ironMade,
    beltPeakItems: beltPeakOut,
    runsNow: fac().runs.map((r) => ({ tiles: r.tiles, tail: r.tail, head: r.head,
      items: r.items })),
  };
  log.push('D took: ' + JSON.stringify(outTook));

  const view = of.game().view ?? null;
  const cost = {
    drawCalls: of.stats().draw.calls,
    triangles: of.stats().draw.triangles,
    budgetTriangles: of.stats().budget?.triangles ?? null,
    // FS-47: connections exist and NOT ONE inserter is drawn on them.
    links: fac().links.length,
    insertersDrawn: view?.inserters ?? null,
  };
  log.push('cost: ' + JSON.stringify(cost));

  const portMated = feedLink !== undefined
    && feedLink.fromPort === 'socket_belt_out'
    && feedLink.toPort === 'socket_item_in'
    && feedLink.gapM <= 0.65 && feedLink.facing <= -0.85;

  return {
    advanced: { ticks: phaseA.coreTicks, expected: WINDOW * 60,
      rebuilds: fac().rebuilds, drillRatePerSec: drill.rate },
    setup: {
      portsLoaded: f0.portsLoaded,
      oneRun: f0.runs.length === 1 && f0.runs[0].tiles === 2,
      drillFeedsTail: f0.links.some((l) => l.from === drillRow.id && tails.has(l.to)),
      // The geometry FS-17 deadlocked on really did form.
      shortCircuitGeometry: gdist(laid[0].pos, smelterAt.pos)
        <= matesFar('belt', 'smelter') + 1.0,
    },
    shape, turned, ghostSaidBefore,
    phases: { A: phaseA, B: phaseB, C: phaseC, D: phaseD },
    ports: {
      feedLink: feedLink ?? null,
      outSightings: outSightings.slice(0, 6),
      // KEPT AND NO LONGER ASSERTED. See the header: false here means the sweep
      // could not reach the far face from the input side, which is a fact about
      // the walk and not about the ports, and it is left in the report so the
      // next reader can see that it is still false and still fine.
      sawOutPort, sawRefusalSentence,
      walkAround: { legs, outStandM: +outStand.toFixed(2), alongFwdM: sideNow },
      outAim, outTook,
    },
    cost,
    valid:
      // DW-20: the sim really advanced, in every window.
      Math.abs(phaseA.coreTicks - WINDOW * 60) <= 90
      && Math.abs(phaseB.coreTicks - WINDOW * 60) <= 90
      && Math.abs(phaseC.coreTicks - WINDOW * 60) <= 90
      && f0.portsLoaded === true
      // A: the belt is connected TO A PORT, named on both sides, and it feeds.
      && portMated                                              // FAILS-OLD
      && phaseA.ironMade > 0
      // FS-17, restated under the new model: not wired onto its own feed.
      && shape.linksToTail === 0
      // The ghost said so before the button went down.
      && ghostSaidBefore.includes('socket_item_in')             // FAILS-OLD
      // B: turning the housing away breaks it, says why, and STOPS production.
      && turned.links === 0                                     // FAILS-OLD
      && turned.refusal !== null
      && typeof turned.refusal.reason === 'string'
      && turned.refusal.reason.length > 20
      && typeof turned.refusal.fix === 'string'
      && turned.refusal.fix.length > 10
      // NOTHING ARRIVED AT THE MACHINE while the port faced away, and ore
      // arrived again once it came back. FS-115: this is the claim, measured as
      // a conserved quantity rather than as the buffer level (see `measure`,
      // and FS-114 in NUMBERS.md for what the buffer reading could not do).
      // A and C are the on-scene positive control: the same expression has to
      // go non-zero on the same machine in the same window length, or the zero
      // in B says nothing at all.
      && phaseA.oreArrived > 0
      && phaseB.oreArrived === 0                                // FAILS-OLD
      && phaseC.oreArrived > 0
      // ... and no window silently zeroed the tally underneath the reading.
      && phaseA.rebuilt === 0 && phaseB.rebuilt === 0 && phaseC.rebuilt === 0
      // C: and turning it back fixes it. A refusal is recoverable.
      && relinked !== null                                      // FAILS-OLD
      && phaseC.ironMade > 0
      // D: the output face is a DIFFERENT port, and a belt on it takes.
      //
      // `sawOutPort` used to be the whole of phase D and it is deliberately not
      // here any more. It was a sweep taken from the input side, so it could
      // only ever report the near face; three real claims replace it, and the
      // sim advancing through D's window is checked with the others above.
      && Math.abs(phaseD.coreTicks - WINDOW * 60) <= 90
      // The ghost named the OUTPUT port before the button went down.
      && ghostSaidOut.includes('socket_item_out')                 // FAILS-OLD
      // The link that landed names both sockets, and the right two.
      && outLink !== null                                         // FAILS-OLD
      && outLink.fromPort === 'socket_item_out'
      && outLink.toPort === 'socket_belt_in'
      // And ingots physically rode the tile away from the machine.
      && beltPeakOut > 0
      // FS-47: every connection is a port connection, so no arm is drawn.
      && cost.links > 0 && cost.insertersDrawn === 0,           // FAILS-OLD
    plan: fac().list,
    log,
  };
})()
