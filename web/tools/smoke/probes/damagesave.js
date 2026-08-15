// damagesave.js: BREAK SOMETHING, THEN SAVE (GP-65, lane combat).
//
// PROBEALL-EXCLUDE: two-phase setup probe driven by tools/smoke/reload.mjs,
// not meant to run standalone through run.mjs.
//
// Phase 1 of the reload proof. It builds a small world, damages one member of
// each population it can reach through the player's own build path, forces the
// autosave slot to be written, and reports the exact health it left behind.
// `tools/smoke/reload.mjs` runs it before the flight, reloads the browser, and
// asserts every number below came back.
//
// WHY THIS RUNS BEFORE THE FLIGHT. A save is REFUSED while the player is
// strapped into a vessel (PH-30), so a probe that damaged a base after boarding
// would be measuring a slot that was never written. Building and breaking first
// puts the wounds in the last slot the world was allowed to write, which is the
// slot a reload reads.
//
// DW-20: the setup PROVES ITSELF. `valid` is false unless something was really
// placed and really damaged, so a run in which nothing went down reports that
// rather than passing on two absences agreeing with each other.
//
// THE KEYS ARE DERIVED HERE, from `Placed.cell` and `StructurePart.key`, and not
// read out of the health report. That is deliberate and it is a second
// assertion: if the client ever changes how it names a building, the probe's
// independently-built key stops matching and `of.damage` returns null, which
// fails loudly. Reading the key back off the book would agree with whatever the
// book happened to think.
(async () => {
  const of = window.__of;
  if (!of) return { valid: false, why: 'no __of' };
  if (typeof of.damage !== 'function') return { valid: false, why: 'no of.damage' };
  const sleep = (n) => of.run(n);
  const log = [];
  const H = () => of.game().health;
  const fac = () => of.game().factory;
  const st = () => of.game().structures;

  await sleep(0.5);

  // --- 1. a world worth breaking --------------------------------------------
  // Belts and a smelter need no deposit under them, so a plan can be laid
  // without walking anywhere; the miner's walk is covered by autoline.js.
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
  const belts = await place(2, 2);
  const smelters = await place(3, 1);
  log.push(`laid ${belts} belts and ${smelters} smelters`);

  // A foundation, straight down, so the site's origin is the cell underfoot.
  // Sandbox pays nothing for it (DW-31), which is why this runs at all here.
  of.build(4);
  await sleep(0.15);
  for (let p = -88; p <= -55; p += 3) {
    of.look(of.world().observer.yawDeg, p);
    await sleep(0.05);
    const g = of.build().structGhost;
    if (g === null || !g.ok || g.addr === null) continue;
    of.input.tape([{ hold: 4, actions: ['use'] }, { hold: 8, keys: [] }]);
    await sleep(0.35);
    break;
  }
  of.build(0);
  await sleep(0.3);
  log.push(`${st().parts.length} structural part(s) standing`);

  // A HAND FURNACE, which is the population whose key is the one worth
  // doubting. The other three are keyed by a string their own save row already
  // carries verbatim; a machine has no such field, so its key is DERIVED from
  // its position and this is the only place that derivation is put through a
  // real reload. Sandbox lifts the pack requirement, so no craft is needed.
  of.hotbar(2);
  await sleep(0.15);
  of.look(of.world().observer.yawDeg, -14);
  await sleep(0.1);
  of.input.tape([{ hold: 3, actions: ['use'] }, { hold: 4, keys: [] }]);
  await sleep(0.35);
  of.hotbar(1);
  await sleep(0.15);
  log.push(`${of.game().machines.length} hand machine(s) standing`);

  // --- 2. every placed thing has a health row, BEFORE anything is broken ----
  const a0 = H();
  if (a0 === null || a0 === undefined) return { valid: false, why: 'no health report' };
  if (a0.audit.missing !== 0 || a0.audit.stale !== 0) {
    return { valid: false, why: 'the book does not match the world',
      audit: a0.audit, log };
  }
  if (a0.tracked <= 0) return { valid: false, why: 'nothing placed', log };
  log.push(`${a0.tracked} things tracked, ${a0.audit.missing} missing, `
    + `${a0.audit.stale} stale`);

  // --- 3. break one of each population that exists --------------------------
  const damaged = [];
  const hit = (key, amount) => {
    const r = of.damage({ key, amount });
    if (r === null) { log.push(`of.damage refused ${key}`); return; }
    damaged.push({ key, hp: r.hp, maxHp: r.maxHp, applied: r.applied });
    log.push(`${key}: ${r.maxHp} -> ${r.hp} (${r.applied} applied)`);
  };
  const b = fac().list[0];
  if (b !== undefined) hit(`f:${b.cell}`, 23);
  const p = st().parts[0];
  if (p !== undefined) hit(`s:${p.key}`, 137);
  // The machine key, built here the way `Health.machineHealthKey` builds it: a
  // centimetre grid on the saved position. Rebuilding it rather than reading it
  // back is the whole point, see the header.
  const m = of.game().machines[0];
  if (m !== undefined) {
    const q = (v) => Math.round(v * 100);
    hit(`m:${q(m.pos[0])},${q(m.pos[1])},${q(m.pos[2])}`, 41);
  }

  if (damaged.length === 0) {
    return { valid: false, why: 'nothing could be damaged', log,
      buildings: fac().buildings, parts: st().parts.length };
  }
  // Damaging must move the book, or the save below records nothing and the
  // reload assertion would be satisfied by two empty lists matching.
  const a1 = H();
  if (a1.wounded < damaged.length) {
    return { valid: false, why: 'the book did not record the damage',
      wounded: a1.wounded, damaged, log };
  }

  // --- 4. write the slot NOW -------------------------------------------------
  // Explicitly rather than waiting for the 20 s autosave, because the flight
  // that follows inhibits saving and the wounds have to be on disk before it.
  // A slow look around first, so the discovery field the runner also asserts on
  // has something in it: this setup never flies, and a probe that satisfied its
  // own assertion while silently failing the runner's shared ones would be a
  // harness lying about a harness (DW-20).
  for (let a = 0; a < 360; a += 45) {
    of.look(a, -6);
    await sleep(0.12);
  }
  const saved = await of.save();
  log.push(`saved: ${JSON.stringify(saved)}`);

  return {
    valid: true,
    // The runner's own shared assertions read these two by name.
    saves: of.game().persist.saves,
    damaged,
    tracked: a1.tracked,
    wounded: a1.wounded,
    destroyed: a1.destroyed,
    unknownKinds: a1.unknownKinds,
    audit: a1.audit,
    buildings: fac().buildings,
    parts: st().parts.length,
    savedHealthRows: saved && typeof saved === 'object' ? (saved.health ?? -1) : -1,
    log,
  };
})()
