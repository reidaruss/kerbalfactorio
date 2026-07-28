// startfresh.js: PHASE 1 OF THE START FRESH PROOF (GP-103).
//
//   node tools/smoke/reload.mjs --url=http://127.0.0.1:PORT/ --setup=probes/startfresh.js
//
// It builds a world worth destroying, forces the autosave, presses the REAL
// Start Fresh button in the REAL menu, proves the confirm cannot be skipped,
// confirms, and reports what it left behind. `reload.mjs` then reloads the
// browser in the same context, so IndexedDB is the store a player has, and
// asserts that what comes back is a world with nothing in it.
//
// WHY IT NEEDS TWO PHASES AT ALL. "The slot is gone" can be asserted in one
// page and is asserted below. "The world is gone" cannot: the client only
// applies a slot at boot, so a live session that has had its slot deleted looks
// exactly like one that has not until it is reloaded. That is precisely the
// question Reid's button asks, so it is the question the proof has to ask.
//
// THE CONFIRM IS PROVEN TWICE, from both sides. Structurally: the confirm
// button does not exist in the DOM until the row is armed, so there is nothing
// for a stray click to land on. And behaviourally: `Cheats.startFresh` refuses
// outright when it was not armed, so a caller who skips the DOM entirely is
// refused as well. A confirm that only exists as a hidden element is a confirm.
(async () => {
  const of = window.__of;
  if (!of) return { valid: false, why: 'no __of' };
  if (typeof of.pause !== 'function') return { valid: false, why: 'no of.pause' };
  const sleep = (n) => of.run(n);
  const fails = [];
  const log = [];
  const check = (name, ok, detail) => {
    if (!ok) fails.push(detail === undefined ? name : `${name}: ${detail}`);
    return ok;
  };
  const opts = { bubbles: true, pointerId: 1, pointerType: 'mouse', button: 0 };
  const press = async (id) => {
    const el = document.querySelector(`#of-pause button[data-cheat="${id}"]`);
    if (el === null) return false;
    el.dispatchEvent(new PointerEvent('pointerdown', opts));
    await sleep(0.11);
    el.dispatchEvent(new PointerEvent('pointerup', opts));
    el.click();
    await sleep(0.3);
    return true;
  };

  await sleep(0.6);

  // --- 1. a world worth destroying ------------------------------------------
  // Belts and a smelter need no deposit under them, so a plan can be laid
  // without walking anywhere. Sandbox pays nothing for any of it (DW-31).
  const fac = () => of.game().factory;
  const st = () => of.game().structures;
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
  // A foundation, straight down, so the site's origin is the cell underfoot.
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
  const world = { buildings: fac().buildings, structures: st().parts.length };
  log.push(`built ${belts} belts, ${smelters} smelter(s), ${world.structures} part(s)`);
  // DW-20: THE SETUP PROVES ITSELF. A run that built nothing would "prove" that
  // Start Fresh destroys an empty world, which is not a claim worth making.
  check('the setup actually built something', world.buildings >= 3,
    JSON.stringify(world));

  await of.save();
  await sleep(0.5);
  const saves = of.game().persist.saves;
  check('and the world was written to its slot', saves > 0, `${saves}`);
  // The slot is on disk NOW: loading it back returns a ledger rather than null.
  const ledger = await of.load();
  check('the slot loads back before the wipe', ledger !== null
    && ledger.buildings >= world.buildings,
    JSON.stringify(ledger === null ? null : { b: ledger.buildings }));

  // --- 2. the confirm cannot be skipped -------------------------------------
  of.pause(true);
  await sleep(0.4);
  const p0 = of.pause();
  check('Escape opens the menu', p0.open === true);
  check('the CONFIRM button is not in the DOM before the row is armed',
    p0.confirmButton === false, JSON.stringify(p0));
  const refusal = of.cheat('startfresh:confirm').log.pop();
  check('and the VERB refuses outright when it was not confirmed',
    refusal.done === false && refusal.message.includes('must be confirmed'),
    JSON.stringify(refusal));
  const stillThere = await of.load();
  check('the refused call destroyed NOTHING', stillThere !== null,
    `${stillThere === null ? 'the slot is gone' : 'slot intact'}`);

  check('pressing Start Fresh arms it', await press('startfresh'));
  const p1 = of.pause();
  check('now the confirm exists', p1.confirmButton === true && p1.armed === true,
    JSON.stringify(p1));
  const sentence = p1.view.confirm;
  check('and it NAMES the save slot it is about to destroy',
    sentence.includes(`"${p1.view.slotKey}"`), sentence);

  // --- 3. fire it -----------------------------------------------------------
  // The RESTART is suppressed and nothing else is: the wipe still runs through
  // the same `startFresh`, still verifies itself against the store, and
  // `reload.mjs` performs the identical reload from the outside a moment later.
  // Without this the page navigates out from under this evaluate and phase 1
  // can never report what it did, which is how this line came to exist.
  of.cheat('norestart');
  check('pressing the confirm works', await press('startfresh:confirm'));
  await sleep(0.6);
  const receipt = of.cheat().log.filter((r) => r.id === 'startfresh:confirm').pop();
  check('the wipe reports itself done', receipt.done === true,
    JSON.stringify(receipt));
  // VERIFIED FROM THE STORE, not from the delete's return value: `clearSlot`
  // swallows its own errors by design (a save is not a rule), so a delete that
  // silently did nothing would otherwise report success.
  check('and the receipt says the slot is really no longer there',
    receipt.detail.slotRemains === false, JSON.stringify(receipt.detail));
  const gone = await of.load();
  check('loading the slot now returns NOTHING', gone === null,
    `${gone === null ? 'null' : JSON.stringify(gone)}`);
  check('and the assisted mark went with the world it belonged to',
    of.cheat().assisted === false, JSON.stringify(of.cheat().used));

  return {
    valid: fails.length === 0,
    fails,
    log,
    // `reload.mjs` reads these two by name in phase 2.
    wipedSlotKey: p1.view.slotKey,
    saves,
    builtBuildings: world.buildings,
    builtStructures: world.structures,
    confirm: { beforeArm: p0, afterArm: p1, sentence, unarmedRefusal: refusal },
    receipt,
  };
})()
