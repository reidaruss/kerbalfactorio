// DW-17 PERSISTENCE probe: a save slot that actually round-trips.
//
// WHAT IS AND IS NOT PROVED HERE, said up front. This drives save -> destroy ->
// load inside ONE page, through the real IndexedDB (an async open, a real
// transaction, a real read back), which is the whole of the container and the
// whole of the apply path. It does NOT drive a browser reload, because a
// reloaded page tears down the eval context this probe is running in, and
// because Playwright gives each run an ephemeral profile whose IndexedDB does
// not survive to the next one. Gameplay.create calls exactly the `load()` used
// below, so what is untested is the boot ORDER and nothing else.
//
// THE DESTRUCTION IS THE POINT. Saving and immediately loading proves nothing:
// the live world already holds the answer. So between the two, every building is
// demolished and the pack is CHANGED (not emptied, changed), and the assertion
// is that the restored pack matches the saved one exactly, which a merge would
// fail and a replace passes.
(async () => {
  const of = window.__of;
  const sleep = (n) => of.run(n);
  const log = [];
  const fac = () => of.game().factory;
  const pack = () => of.game().carried
    .map((c) => `${c.name}:${c.count}`).sort().join(' ');
  const cells = () => fac().list.map((b) => `${b.kind}@${b.cell}`).sort().join(' ');
  const depleted = () => of.nodes().filter((n) => n.remaining < n.initial)
    .map((n) => `${n.index}:${n.remaining.toFixed(3)}`).sort().join(' ');

  await sleep(0.5);
  await of.wipe();

  // --- 1. make a world worth saving -----------------------------------------
  // Harvested through of.harvest, deliberately: this probe is about bytes, and
  // the swing has its own acceptance in moments.js.
  let swings = 0;
  for (const n of of.nodes()) {
    if (n.kind !== 0 && n.kind !== 1) continue;
    for (let k = 0; k < 3; ++k) if (of.harvest(n.index).ok) swings++;
    if (swings >= 12) break;
  }

  // BELTS AND A SMELTER NEED NO DEPOSIT, so a four-building plan can be laid
  // without walking anywhere. A miner would need ore underfoot, and the walk to
  // find it is already covered by autoline.js and demolish.js.
  const place = async (menu, count) => {
    of.build(menu);
    let put = 0;
    for (let p = -22; p >= -70 && put < count; p -= 1.1) {
      of.look(of.world().observer.yawDeg, p);
      await sleep(0.05);
      const g = of.build().ghost;
      if (g === null || !g.ok) continue;
      const before = fac().buildings;
      of.input.tape([{ hold: 3, actions: ['use'] }, { hold: 4, keys: [] }]);
      await sleep(0.16);
      if (fac().buildings > before) put++;
    }
    of.build(0);
    return put;
  };
  const belts = await place(2, 3);
  const smelters = await place(3, 1);
  log.push(`laid ${belts} belts and ${smelters} smelters`);

  // A hand furnace too, if the pack can pay for one: it is the only saved thing
  // that carries CONTENTS, and contents are the part a naive save loses.
  const furnaceRecipe = of.game().recipes.findIndex((r) => r.name === 'Furnace');
  const crafted = furnaceRecipe >= 0 && of.game().recipes[furnaceRecipe].craftable
    ? of.craft(furnaceRecipe) : false;
  if (crafted) {
    of.look(of.world().observer.yawDeg, -12);
    await sleep(0.1);
    // The hand furnace lives in hotbar slot 2, and the left button places what
    // the hand holds, so the slot has to be chosen before the click. Back to the
    // bare hand afterwards, which is where the bar started.
    of.hotbar(2);
    await sleep(0.15);
    of.input.tape([{ hold: 3, actions: ['use'] }, { hold: 4, keys: [] }]);
    await sleep(0.3);
    of.hotbar(1);
    await sleep(0.1);
  }
  const machinesPlaced = of.game().machines.length;

  // --- 2. save ---------------------------------------------------------------
  const saved = {
    pack: pack(), cells: cells(), depleted: depleted(),
    buildings: fac().buildings, machines: machinesPlaced,
  };
  const written = await of.save();
  log.push(`saved ${JSON.stringify(written)}`);
  if (written === null) return { fail: 'the slot could not be written', log };

  // --- 3. destroy it ---------------------------------------------------------
  let razed = 0;
  for (const b of fac().list.slice()) if (of.demolish({ id: b.id }) !== null) razed++;
  let machinesRazed = 0;
  while (of.game().machines.length > 0) {
    if (of.demolish({ machine: 0 }) === null) break;
    machinesRazed++;
  }
  // CHANGE the pack rather than empty it: a restore that MERGED would still
  // contain everything saved, and only a comparison against a DIFFERENT pack
  // can tell a merge from a replace.
  for (const n of of.nodes()) { if (n.kind === 0) { of.harvest(n.index); break; } }
  const packWrecked = pack();
  // AND REGROW THE CLEARING FROM THE SEED, which is what a reload actually
  // does: a save is a DIFF over a freshly generated world. Loading onto a world
  // that is already more depleted than the save is a state no boot can reach,
  // and asserting against it measures the probe rather than the save. (It also
  // fails, because of_gp_node_drain only removes: the first version of this
  // probe caught exactly that and it was the harness that was wrong.)
  of.repopulate();
  const wrecked = { pack: packWrecked, cells: cells(), buildings: fac().buildings,
                    machines: of.game().machines.length, depleted: depleted() };
  log.push(`razed ${razed} buildings and ${machinesRazed} machines; `
    + `pack now ${wrecked.pack}`);

  // --- 4. load ---------------------------------------------------------------
  const ledger = await of.load();
  await sleep(0.4);
  const back = { pack: pack(), cells: cells(), depleted: depleted(),
                 buildings: fac().buildings, machines: of.game().machines.length };
  log.push(`restored ${JSON.stringify(ledger)}`);

  return {
    advanced: { swings, tick: of.world().tick, saves: of.game().persist.saves },
    saved, wrecked, back, ledger,
    valid:
      // the world that was saved was not empty, and the destruction was real
      saved.buildings >= 3 && razed === saved.buildings
      && wrecked.buildings === 0 && wrecked.cells === ''
      && wrecked.pack !== saved.pack && wrecked.depleted === ''
      // and every part of it came back exactly
      && back.buildings === saved.buildings
      && back.cells === saved.cells
      && back.pack === saved.pack
      && back.depleted === saved.depleted
      && back.machines === saved.machines
      && ledger !== null && ledger.buildings === saved.buildings
      && ledger.nodesDepleted === saved.depleted.split(' ').length,
    persist: of.game().persist,
    log,
  };
})()
