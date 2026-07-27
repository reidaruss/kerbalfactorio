// FS-41: A SMELTER STANDING ON A COAL SEAM MAKES NO IRON.
//
//   node tools/smoke/run.mjs --scenario=walk \
//        --evalfile=tools/smoke/probes/coalsmelt.js
//
// Reid, verbatim: "feeding coal via belt into a smelter produces iron? thats not
// right." It was not, and the machine was not misbehaving: the RECIPE it was
// built with was a lie, authored at placement time by
//
//     const ore   = oreFedTo(f, p) || ids.rawIron;
//     const ingot = f.M._of_gp_smelt_output_for(ore) || ids.iron;
//
// `smeltOutputFor(coal)` is `kNoItem`, `kNoItem` is 0, and `||` treats 0 as
// absent. So a drill on a coal patch gave `placeSmelter(coal, iron)`: a machine
// that genuinely claims that recipe inside /core, which is why no amount of
// typed acceptance downstream could catch it. The typed-acceptance gate landing
// in `factory_sim.h` refuses items a machine's recipe does not consume, and
// this machine's recipe consumed coal.
//
// IT TAKES BOTH HALVES, and this probe reports them separately. FS-41 stops the
// machine CLAIMING the fiction; the core gate stops it being FED the wrong item
// regardless of what it claims. Measured here on this branch, which has the
// first and not yet the second: the smelter's declared input moved from coal to
// raw iron, and it still smelted 30 iron out of 61 mined coal, because
// `inserterSystem` hands a machine whatever it is carrying.
//
// WHY NO EXISTING PROBE SAW IT. Every factory probe builds its line on an IRON
// patch, where `smeltOutputFor` is not zero and the bug is invisible. So this
// one deliberately builds on the LEAST useful deposit it can find.
//
// THE TWO QUESTIONS, and why both are needed.
//
//   1. WAS THE FICTION DECLARED? `list[].inputItem` is what the smelter was
//      built to eat. A smelter must never be built to eat the fuel under it.
//      This fails the moment the machine is placed, with no window and no ore.
//   2. WAS IT ACTED ON? `list[].producedOfOutput` is /core's own lifetime tally
//      for the item the smelter claims to make (`producedCountOf`), so this is
//      the client-side form of the headless measurement that found it: 241 coal
//      mined, 57 iron produced. After an unattended window it must be ZERO.
//
// Question 1 alone would pass a client that declared the right recipe and ran
// the wrong one; question 2 alone would pass a world with no coal near the
// spawn. Together they are the check whose absence let a fictional recipe ship.
(async () => {
  const of = window.__of;
  const log = [];
  const settle = (secs) => of.run(secs, 60);
  const fac = () => of.game().factory;

  await settle(1.0);
  await of.wipe();
  await settle(0.6);
  if (of.game() === null) return { valid: false, why: 'no gameplay layer' };

  // `of.nodes()` is nearest first and names its kinds; coal is kind 2 on this
  // world and the name is asserted as well as the number, because a kind is an
  // index and an index is exactly the sort of thing that gets renumbered.
  const nodes = of.nodes();
  const coal = nodes.find((n) => n.kind === 2 && n.name === 'Coal' && n.remaining > 20);
  if (coal === undefined) {
    return { valid: false, why: 'no coal seam near the spawn',
      kinds: [...new Set(nodes.map((n) => `${n.kind}|${n.name}`))] };
  }
  log.push(`coal seam ${coal.index} at ${coal.distanceM.toFixed(1)} m, `
    + `${coal.remaining.toFixed(0)} left`);

  // Face it by MEASURING the aim rather than deriving it: the observer yaw is
  // in a local tangent frame and cannot be computed from world coordinates
  // without re-deriving that frame here (autoline.js's argument, unchanged).
  const miss = () => {
    const a = of.aim();
    const v = [coal.x - a.origin[0], coal.y - a.origin[1], coal.z - a.origin[2]];
    const t = v[0] * a.dir[0] + v[1] * a.dir[1] + v[2] * a.dir[2];
    if (t <= 0) return Infinity;
    return Math.hypot(v[0] - a.dir[0] * t, v[1] - a.dir[1] * t,
      v[2] - a.dir[2] * t);
  };
  let yaw = of.world().observer.yawDeg;
  for (const step of [20, 5, 1.5, 0.5]) {
    let bestMiss = Infinity, bestYaw = yaw;
    for (let k = -9; k <= 9; ++k) {
      of.look(yaw + k * step, -20);
      await settle(0.02);
      const m = miss();
      if (m < bestMiss) { bestMiss = m; bestYaw = yaw + k * step; }
    }
    yaw = bestYaw;
  }
  // Walk until it is under the crosshair. A drill is refused off its deposit,
  // so this is the same approach a player makes.
  const rangeM = () => {
    const a = of.aim();
    return Math.hypot(coal.x - a.origin[0], coal.y - a.origin[1],
      coal.z - a.origin[2]);
  };
  for (let k = 0; k < 14 && rangeM() > 3.0; ++k) {
    of.look(yaw, -8);
    await settle(0.1);
    of.input.tape([{ hold: 90, actions: ['forward'] }]);
    await settle(1.8);
    of.input.tape([{ hold: 6, keys: [] }]);
    await settle(0.3);
  }
  log.push(`walked to ${rangeM().toFixed(2)} m of the seam`);

  // --- THE DRILL, on the coal ------------------------------------------------
  of.build(1);
  await settle(0.3);
  let drilled = 0;
  for (let p = -68; p <= -14 && drilled === 0; p += 1.5) {
    for (const dy of [0, -6, 6, -12, 12]) {
      of.look(yaw + dy, p);
      await settle(0.06);
      const t = of.build().ghost;
      if (t === null || !t.ok || t.patch < 0) continue;
      const before = fac().buildings;
      of.input.tape([{ hold: 3, actions: ['use'] }, { hold: 6, keys: [] }]);
      await settle(0.4);
      drilled = fac().buildings - before;
      if (drilled > 0) break;
    }
  }
  if (drilled === 0) {
    return { valid: false, why: 'no drill would go down on the seam', log };
  }
  const drill = fac().list.find((b) => b.kind === 'miner');
  log.push(`drill on patch ${drill.patch}, mines item ${drill.outputItem}`);

  // --- THE SMELTER, beside it ------------------------------------------------
  of.build(3);
  await settle(0.3);
  let smelted = 0;
  for (let p = -60; p <= -16 && smelted === 0; p += 1.5) {
    for (const dy of [14, -14, 24, -24, 34, -34]) {
      of.look(yaw + dy, p);
      await settle(0.06);
      const t = of.build().ghost;
      if (t === null || !t.ok) continue;
      const before = fac().buildings;
      of.input.tape([{ hold: 3, actions: ['use'] }, { hold: 6, keys: [] }]);
      await settle(0.4);
      smelted = fac().buildings - before;
      if (smelted > 0) break;
    }
  }
  of.build(0);
  await settle(0.3);
  if (smelted === 0) return { valid: false, why: 'no smelter would go down', log };

  // --- LEAVE IT ALONE --------------------------------------------------------
  const t0 = of.world().tick;
  const mined0 = fac().minedFromNodes;
  await settle(30);
  const f = fac();
  const smelters = f.list
    .filter((b) => b.kind === 'smelter' || b.kind === 'esmelter')
    .map((b) => ({ id: b.id, kind: b.kind, eats: b.inputItem,
      makes: b.outputItem, made: b.producedOfOutput, holding: b.input,
      inBuffer: b.output }));
  const coalItem = f.list.find((b) => b.kind === 'miner').outputItem;
  log.push(`after ${of.world().tick - t0} ticks: mined `
    + `${(f.minedFromNodes - mined0).toFixed(0)}, smelters `
    + `${JSON.stringify(smelters)}`);

  return {
    valid: drilled > 0 && smelted > 0 && smelters.length > 0
      && (of.world().tick - t0) > 1200 && coalItem > 0
      // The drill really is on coal, so the shape under test really formed.
      && f.minedFromNodes - mined0 > 0,

    // --- THE ACCEPTANCE ------------------------------------------------------
    // 1. NO SMELTER IS EVER BUILT TO EAT THE FUEL UNDER IT. This is the lie
    //    itself, it is the WEB half of the defect, and it fails at placement
    //    time with no window and no ore needed. Measured on this seam: the
    //    smelter's declared input was item 50 (coal) before FS-41 and is item
    //    51 (raw iron) after it.
    noSmelterEatsCoal: smelters.every((s) => s.eats !== coalItem),
    // 2. AND NOTHING WAS MADE FROM IT. THIS IS THE /core HALF AND IT IS NOT
    //    THIS LANE'S TO CLOSE. /core's own lifetime tally for the item each
    //    smelter claims to produce, after half a minute with a drill feeding
    //    it. Measured on this branch: 30 either way, because `inserterSystem`
    //    hands a machine WHATEVER it is carrying and `machineSystem` counts
    //    whatever is in the input slot, so a smelter declared raw-iron-to-iron
    //    still eats the coal put in front of it. The typed-acceptance gate the
    //    core lane is landing in `factory_sim.h` is exactly what closes this,
    //    and the two halves are both required: without FS-41 the machine
    //    genuinely claims the coal recipe and the gate correctly admits it;
    //    without the gate the machine claims the right recipe and is fed the
    //    wrong item anyway. Expect this to read false until that lane merges.
    nothingSmeltedFromCoal: smelters.every((s) => s.made === 0),
    nothingSmeltedFromCoalIsTheCoreLanesHalf: true,

    coalItem, minedCoal: +(f.minedFromNodes - mined0).toFixed(2),
    smelters, ticks: of.world().tick - t0,
    buildings: f.buildings, links: f.links,
    list: f.list.map((b) => ({ id: b.id, kind: b.kind, eats: b.inputItem,
      makes: b.outputItem, made: b.producedOfOutput })),
    log,
  };
})()
