// FS-47: WHAT THE AUTO-DRAWN INSERTER ARMS ACTUALLY COST, ON ONE SCENE, BOTH
// WAYS.
//
// RUN IT TWICE, and it is two page loads on purpose:
//
//   node tools/smoke/run.mjs --url=http://127.0.0.1:5199/ --scenario=walk \
//     --sandbox=1 --evalfile=tools/smoke/probes/portcost.js --wait=800
//   ... and again with --inserters=1
//
// `FactoryView.ts` reads `?inserters=1` ONCE at module load into
// `LEGACY_INSERTERS`, and its comment says why: a flag that can change mid-run
// turns a before-and-after measurement into two halves of one ambiguous number.
// So there is no way to do both halves in one page, and this probe does not try.
// It builds the scene, reports the numbers, and leaves the subtraction to
// whoever runs it. What it WILL do is fail loudly if the flag it was told about
// and the arms the client actually drew disagree, which is the sandbox probe's
// own trick (DW-31) and the only thing that separates "two runs" from "the same
// run twice".
//
// STANDING RULE 7, VERBATIM: a measurement that has not isolated its subject is
// an opinion. Nothing else about the scene changes between the two runs. Same
// seed, same scenario, same gestures, same order, same sandbox mode; the only
// difference is one boolean read out of the query string by one file.
//
// WHY SANDBOX. The scene wanted here is a few dozen machines, and in survival
// every one of them costs iron that has to be smelted first, which would make
// this probe a twenty-minute automation run with a cost measurement bolted on
// the end. `?sandbox=1` is DW-31's free build and it is the ONLY tractable way
// to get the building count up; it is stated here rather than buried because a
// number measured in a mode is a number measured in a mode.
//
// HOW THE SCENE IS BUILT, and why it is built this way and not another:
//
//   THE MACHINES GO DOWN WHILE THE PLAYER BACKS AWAY FROM THEM. A row of 2 m
//   smelters laid AHEAD of a walking player is a wall the player then walks
//   into, and `machineClash` refuses the next one because the player is
//   standing where it goes. Backing up puts the crosshair's ground point 2 m
//   nearer with every step, so the row grows towards the player and away from
//   the ground already covered, and nothing is ever in the way.
//
//   IT ALSO MAKES THE ROW MATE. Every smelter is placed on the same heading, so
//   each one's `socket_item_out` faces the next one's `socket_item_in` and
//   `FactoryWiring`'s machine-to-machine pass links them: a row of N smelters is
//   N-1 links, which is what an inserter population is counted in. Laid
//   sideways they would be N smelters and ZERO links, and this probe would then
//   have measured the cost of an inserter population of nothing.
//
//   THE BELTS ARE A HOLD-DRAG, because the building count wants bulk and a belt
//   is the cheapest building in the game to lay: one press, held, while the
//   player walks (probes/controls.js lays fifteen tiles that way). Belts are
//   1 m tiles the player walks straight over, so unlike the machines they can
//   be laid ahead.
//
// DW-20 THROUGHOUT. A probe that built nothing reports a beautiful zero, and a
// zero-inserter scene would report a perfect saving. So the scene is asserted
// before any cost number is believed: buildings placed, links formed, machines
// actually drawn (`view.instances`), and the pool's own `refused` count read so
// that a batch that quietly declined to draw half the base cannot pass as a
// triangle saving.
(async () => {
  const of = window.__of;
  const sleep = (n) => of.run(n);
  const log = [];
  const fac = () => of.game().factory;
  const gdist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  const eye = () => { const o = of.aim().origin; return [o[0], o[1], o[2]]; };

  // --- WHICH RUN IS THIS ------------------------------------------------------
  // Read off the URL, exactly as `FactoryView` reads it, and checked against the
  // client's own behaviour further down rather than trusted. A run in which the
  // flag never reached the app would otherwise report the SAME numbers twice and
  // look like a saving of zero, which is a conclusion.
  const legacyAsked = new URLSearchParams(location.search).get('inserters') === '1';
  const sandboxAsked = new URLSearchParams(location.search).get('sandbox') === '1';
  const mode = of.game().mode ?? null;

  await sleep(0.8);
  const t0 = of.world().tick;

  const ghostAt = async (y, p) => {
    of.look(y, p);
    await sleep(0.035);
    return of.build().ghost;
  };
  const placeHere = async () => {
    of.input.tape([{ hold: 3, actions: ['use'] }, { hold: 4, keys: [] }]);
    await sleep(0.16);
  };

  // --- 1: A ROW OF SMELTERS, LAID BACKWARDS ----------------------------------
  // The pitch is SWEPT ONCE and then held. A fixed pitch is what makes the
  // crosshair's ground point track the player's feet at a constant offset, which
  // is the whole mechanism above: move the feet 2 m, the cell moves 2 m.
  of.build(3);
  const yaw = of.world().observer.yawDeg;
  let pitch = null;
  for (let p = -18; p >= -50; p -= 1.0) {
    const g = await ghostAt(yaw, p);
    if (g === null || !g.ok) continue;
    const d = gdist(g.pos, eye());
    if (d < 2.2 || d > 4.2) continue;
    pitch = p;
    break;
  }
  if (pitch === null) {
    return { fail: 'no ground cell 2.2 to 4.2 m ahead would take a smelter',
      buildings: fac().buildings, log };
  }
  log.push(`smelter pitch ${pitch.toFixed(1)} at yaw ${yaw.toFixed(1)}`);

  // MORE ITERATIONS THAN SMELTERS, on purpose. A press whose cell is one cell
  // short of the last machine is refused by `machineClash` and places nothing,
  // which is correct and is not a failure; the next back-step fixes it. So the
  // loop counts what LANDED rather than assuming a press is a building, and it
  // steps about a metre at a time so that every other press or so is on a legal
  // cell.
  const SMELTERS_WANTED = 22;
  let smelters = 0;
  let presses = 0;
  for (let i = 0; i < 64 && smelters < SMELTERS_WANTED; ++i) {
    of.look(yaw, pitch);
    await sleep(0.05);
    const before = fac().buildings;
    await placeHere();
    presses++;
    if (fac().buildings > before) smelters++;
    // Backwards, so the row grows towards the player. 13 frames of KeyS is about
    // a metre at the walker's speed.
    of.input.tape([{ hold: 13, keys: ['KeyS'] }, { hold: 2, keys: [] }]);
    await sleep(0.32);
  }
  of.input.tape([{ hold: 2, keys: [] }]);
  await sleep(0.3);
  log.push(`row: ${smelters} smelters from ${presses} presses`);

  // --- 2: BELTS, IN BULK, BY HOLD-DRAG ---------------------------------------
  // Laid on a heading a quarter turn off the machine row so the two do not fight
  // over cells, and ahead of the player rather than behind, because a 1 m belt
  // tile is floor and not an obstacle.
  of.build(2);
  const beltYaw = yaw + 90;
  let dragged = 0;
  for (let d = 0; d < 3; ++d) {
    of.look(beltYaw + d * 30, -32);
    await sleep(0.2);
    const before = fac().buildings;
    // ONE tape for the whole gesture. Two tapes would put a released frame
    // between them, which is a second PRESS and not a hold, and the drag would
    // restart from the new cell instead of running on.
    of.input.tape([{ hold: 220, actions: ['use', 'forward'] }]);
    await sleep(3.7);
    of.input.tape([{ hold: 8, keys: [] }]);
    await sleep(0.5);
    dragged += fac().buildings - before;
  }
  of.build(0);
  of.input.tape([{ hold: 2, keys: [] }]);
  await sleep(0.6);
  log.push(`drags laid ${dragged} belts`);

  // --- 3: LET THE FRAME SETTLE, THEN READ ------------------------------------
  // A frame, not a state. `draw.triangles` is what the renderer counted last
  // frame, and the instance batch is synced from the plan on commit, so the read
  // has to come after at least one drawn frame with the final plan in it.
  await sleep(1.2);

  const f = fac();
  const v = of.game().view ?? null;
  const s = of.stats();
  if (v === null) return { fail: 'no factory view report', log };

  const scene = {
    buildings: f.buildings,
    smelters: f.list.filter((b) => b.kind === 'smelter').length,
    belts: f.list.filter((b) => b.kind === 'belt').length,
    runs: f.runs.length,
    // THE NUMBER THE COST IS PER. One inserter is drawn per link under the flag
    // and none without it, so this is the population whose triangles are being
    // subtracted.
    links: f.links.length,
    linksPerBuilding: f.buildings === 0 ? 0
      : +(f.links.length / f.buildings).toFixed(3),
    portLinks: f.links.filter((l) => l.fromPort !== '').length,
    refusals: f.refusals.length,
    portsLoaded: f.portsLoaded,
  };

  const batch = {
    name: v.name ?? null,
    batches: mustNum(v, 'batches', 'view'),
    instances: mustNum(v, 'instances', 'view'),
    capacity: mustNum(v, 'capacity', 'view'),
    ceiling: v.ceiling ?? null,
    grows: v.grows ?? null,
    // DW-28. A pool that refused to draw part of the base would look exactly
    // like a triangle saving, so the refusal count is read beside the triangles
    // rather than left to be inferred from a low number.
    refused: mustNum(v, 'refused', 'view'),
  };

  const drawn = {
    // THE TWO NUMBERS THE WHOLE PROBE EXISTS FOR.
    calls: mustNum(s.draw, 'calls', 'stats.draw'),
    triangles: mustNum(s.draw, 'triangles', 'stats.draw'),
    budgetTriangles: s.budget?.triangles ?? null,
    budgetDrawCalls: s.budget?.drawCalls ?? null,
    // `links` is how many inserter SLOTS the view holds, `inserters` is how many
    // it actually placed this frame. They are reported apart because a hidden
    // slot still owns an instance, and only the second one is triangles.
    viewLinks: mustNum(v, 'links', 'view'),
    viewInserters: mustNum(v, 'inserters', 'view'),
    cargoItems: v.cargo?.items ?? null,
    beltCurves: v.curves ?? null,
  };

  // THE FLAG REACHED THE CLIENT, or this run is the other run wearing a hat.
  // Asserted from the drawn count and not from the URL: `LEGACY_INSERTERS` is
  // read in `FactoryView` and nowhere else, so what the view DREW is the only
  // honest evidence that the module saw the same query string this probe did.
  const flagLanded = legacyAsked
    ? drawn.viewInserters === scene.links && scene.links > 0
    : drawn.viewInserters === 0;

  // The per-building triangle cost, for the reader who has both runs in front of
  // them. It is NOT the per-inserter cost and must not be read as one: the
  // difference between the runs is, and it can only be taken across two reports.
  const perBuilding = scene.buildings === 0 ? 0
    : Math.round(drawn.triangles / scene.buildings);

  log.push('scene: ' + JSON.stringify(scene));
  log.push('drawn: ' + JSON.stringify(drawn));

  // --- 4: TAKE THE WHOLE FACTORY AWAY, FROM THE SAME PLACE -------------------
  // "Is the inserter population the dominant triangle cost" cannot be answered
  // against a frame total, because a frame total is mostly a planet. 660,000
  // triangles of terrain, props and sky would make ANY factory look free, and
  // the same arithmetic would make any factory look ruinous on a bare skybox.
  // The number the claim is actually about is the FACTORY's own triangles, so
  // the factory is removed and the frame is measured again.
  //
  // WITHOUT MOVING THE CAMERA, which is the whole reason this is done here at
  // the end rather than by reading a triangle count at boot. The player has
  // walked and strafed to build the scene; a baseline taken before that walk is
  // a different view of a different piece of terrain, and subtracting it would
  // attribute a hillside to the machines. Nothing moves between the two reads
  // but the plan.
  //
  // `demolish` is the X key's own handler (DebugGameplay.demolish -> Demolition
  // .demolishBuild), so this is the path a player takes, and the count after it
  // is asserted rather than assumed: a demolition loop that silently left half
  // the base standing would report the factory as costing half what it does.
  const ids = f.list.map((b) => b.id);
  for (const id of ids) of.demolish({ id });
  await sleep(1.0);
  const bare = of.stats();
  const bareView = of.game().view ?? null;
  const isolated = {
    buildingsLeft: fac().buildings,
    linksLeft: fac().links.length,
    instancesLeft: bareView === null ? null : bareView.instances,
    trianglesWithFactory: drawn.triangles,
    trianglesWithoutFactory: mustNum(bare.draw, 'triangles', 'bare.draw'),
    drawCallsWithoutFactory: mustNum(bare.draw, 'calls', 'bare.draw'),
  };
  isolated.factoryTriangles =
    isolated.trianglesWithFactory - isolated.trianglesWithoutFactory;
  isolated.perBuildingTriangles = scene.buildings === 0 ? 0
    : Math.round(isolated.factoryTriangles / scene.buildings);
  log.push('isolated: ' + JSON.stringify(isolated));

  return {
    // The line to subtract. Printed as one flat object on purpose so two runs
    // can be read side by side without digging.
    SUBTRACT_ME: {
      inserters: legacyAsked ? 'ON  (?inserters=1)' : 'OFF (ports only)',
      drawCalls: drawn.calls,
      triangles: drawn.triangles,
      insertersDrawn: drawn.viewInserters,
      links: scene.links,
      buildings: scene.buildings,
      machineInstances: batch.instances,
      // The factory's OWN triangles, measured by taking it away without moving
      // the camera. This is the denominator the "dominant cost" claim needs.
      factoryTriangles: isolated.factoryTriangles,
      trianglesWithoutFactory: isolated.trianglesWithoutFactory,
    },
    run: {
      legacyAsked, sandboxAsked,
      mode: mode === null ? null : mode.mode ?? null,
      sandbox: mode === null ? null : mode.sandbox ?? null,
      flagLanded,
      ticks: of.world().tick - t0,
    },
    scene, batch, drawn, isolated,
    perBuildingTrianglesOfWholeFrame: perBuilding,
    valid:
      // DW-20: the sim advanced and the scene EXISTS. A probe that built nothing
      // reports a beautiful zero, and a beautiful zero is what "the arms cost
      // nothing" looks like.
      of.world().tick - t0 > 600
      && scene.portsLoaded === true
      && scene.buildings >= 24
      && scene.smelters >= 8
      && scene.belts >= 8
      // Links are the population being priced. Without them there is nothing to
      // draw an arm on and the two runs are the same run.
      && scene.links >= 5
      // Every machine that exists is on screen, so the triangle count is the
      // whole base and not as much of it as the pool felt like.
      && batch.refused === 0
      && batch.instances >= scene.buildings
      // The flag did what it says, in this page, measured off the draw.
      && flagLanded
      && drawn.triangles > 0
      // The baseline really is the same view with the factory gone, and not a
      // demolition loop that left half of it standing.
      && isolated.buildingsLeft === 0
      && isolated.linksLeft === 0
      && isolated.factoryTriangles > 0,
    plan: f.list.map((b) => ({ id: b.id, kind: b.kind, cell: b.cell })),
    links: f.links.map((l) => ({ from: l.from, to: l.to, fromPort: l.fromPort,
      toPort: l.toPort, gapM: l.gapM })),
    log,
  };
})()
