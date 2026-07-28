// savenamed.js: PHASE 1 OF THE NAMED-SAVE PROOF (GP-136, GP-137).
//
//   node tools/smoke/reload.mjs --url=... --setup=probes/savenamed.js
//   node tools/smoke/reload.mjs --url=... --setup=probes/savenamed.js \
//     --setupargs='{"load":false}'
//
// THE SECOND INVOCATION IS THE NEGATIVE CONTROL AND IT IS THE WHOLE PROOF.
//
// The two runs are identical up to one button press. Both build a world, save
// it under a name, and then WRECK it. The first then presses Load; the second
// does not. After a real browser reload the first must come back as the SAVED
// world and the second as the WRECKED one. Without the control, "the world came
// back" is satisfied by a load that did nothing at all, because the autosave
// would have restored something either way.
//
// WHY IT NEEDS TWO PHASES. A slot is only applied at BOOT, so a live session
// that has had a slot copied onto its autosave key looks exactly like one that
// has not until it reloads. That is precisely the question Load asks, so it is
// the question the proof has to ask. GP-103 established the shape for Start
// Fresh; this is the same runner with the opposite expectation.
//
// The RESTART is suppressed for the same reason it is in probes/startfresh.js:
// a reload tears down the context this evaluate reports from, and `reload.mjs`
// performs the identical reload from the outside a moment later. The COPY still
// happens, which is the thing under test.
(async () => {
  const of = window.__of;
  if (!of) return { valid: false, why: 'no __of' };
  if (typeof of.pause !== 'function') return { valid: false, why: 'no of.pause' };
  const wantLoad = (OF_ARGS ?? {}).load !== false;
  const sleep = (n) => of.run(n);
  const fails = [];
  const log = [];
  const check = (name, ok, detail) => {
    if (!ok) fails.push(detail === undefined ? name : `${name}: ${detail}`);
    return ok;
  };
  const opts = { bubbles: true, pointerId: 1, pointerType: 'mouse', button: 0 };
  const press = async (id) => {
    const sel = `#of-pause button[data-cheat="${id}"]`;
    const down = document.querySelector(sel);
    if (down === null) return false;
    down.dispatchEvent(new PointerEvent('pointerdown', opts));
    await sleep(0.11);
    (document.querySelector(sel) ?? down).click();
    await sleep(0.45);
    return true;
  };
  const S = () => of.pause().view.saves;
  const fac = () => of.game().factory;
  const NAME = 'proof world';

  await sleep(0.6);

  // --- 1. a world worth keeping ---------------------------------------------
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
  const belts = await place(2, 5);
  const built = fac().buildings;
  log.push(`built ${belts} belts, ${built} buildings total`);
  // DW-20: THE SETUP PROVES ITSELF. A run that built nothing would "prove" that
  // a save restores an empty world, which is not a claim worth making.
  check('the setup actually built something', built >= 4, `${built}`);

  // --- 2. save it under a NAME ----------------------------------------------
  of.pause(true);
  await sleep(0.4);
  check('opening the save page works', await press('page:save'));
  const before = S();
  check('the page lists the autosave and nothing else yet',
    before.rows.filter((r) => !r.isAuto).length === 0,
    JSON.stringify(before.rows.map((r) => r.name)));

  const box = document.querySelector('#of-pause input[data-save="name"]');
  check('the name box is on screen', box !== null);
  // TYPED, NOT REPORTED. The box holds its own value and hands it over on the
  // press; reporting each keystroke rebuilt the page and erased the box, which
  // is the defect probes/savediag.js found and GP-137 records.
  box.value = NAME;
  await sleep(0.2);
  check('pressing Save works', await press('save:new'));
  await sleep(0.8);
  const afterSave = S();
  const saved = afterSave.rows.find((r) => r.name === NAME) ?? null;
  log.push(`slots now: ${afterSave.rows.map((r) => r.name).join(', ')}`);
  check('the named save appears in the list', saved !== null,
    JSON.stringify(afterSave.rows.map((r) => r.name)));
  check('and it describes the world rather than showing a bare name',
    saved !== null && /built/.test(saved.summary), saved?.summary);
  check('and it is NOT the autosave row', saved !== null && saved.isAuto === false);
  // THE KEY IS THE POINT OF GP-136. It carries the mode, so a sandbox world is
  // not representable as a survival one; the probe asserts the key rather than
  // trusting that the list filtered correctly.
  check('the key carries the MODE and the name',
    saved !== null && saved.key === `save:${of.sandbox().mode}:${NAME}`,
    saved?.key);

  // A BAD NAME IS REFUSED BY NAME, in a whole sentence, and nothing is written.
  const box2 = document.querySelector('#of-pause input[data-save="name"]');
  box2.value = 'has:a:colon';
  await sleep(0.15);
  const savedCount = of.saves().saved;
  await press('save:new');
  await sleep(0.5);
  const badName = S().note;
  check('a colon in a name is refused, in words', badName.includes('colon'), badName);
  check('and nothing was written for it',
    of.saves().saved === savedCount && of.saves().refusals > 0,
    JSON.stringify(of.saves()));

  // --- 2b. DELETE, armed then fired -----------------------------------------
  // A save list with no delete fills up and the player cannot fix it, so delete
  // ships with the list. It is two-step because Load and Delete sit on the same
  // row two centimetres apart, and a mis-click destroys the thing the player was
  // reaching for. A second named save is made so the delete has a victim that is
  // not the one phase 2 depends on.
  const box3 = document.querySelector('#of-pause input[data-save="name"]');
  box3.value = 'throwaway';
  await sleep(0.15);
  await press('save:new');
  await sleep(0.7);
  check('a second save went in', S().rows.some((r) => r.name === 'throwaway'),
    JSON.stringify(S().rows.map((r) => r.name)));
  // THE UNARMED DELETE IS REFUSED, and the button for it does not exist yet.
  check('the Delete-it button is not in the DOM before the row is armed',
    document.querySelector('#of-pause button[data-cheat="save:del:throwaway"]') === null);
  const delRefusals = of.saves().refusals;
  of.cheat('save:del:throwaway');
  await sleep(0.5);
  check('and the VERB refuses when it was never armed',
    of.saves().deleted === 0 && of.saves().refusals > delRefusals
    && S().rows.some((r) => r.name === 'throwaway'),
    JSON.stringify(of.saves()));
  // ARM, CANCEL, ARM AGAIN, FIRE.
  check('arming works', await press('save:arm:throwaway'));
  check('now the confirm exists and the row says so',
    document.querySelector('#of-pause button[data-cheat="save:del:throwaway"]') !== null
    && S().confirmDelete === 'throwaway', S().confirmDelete);
  check('cancel works', await press('save:delcancel'));
  check('and the confirm is gone again',
    S().confirmDelete === ''
    && document.querySelector('#of-pause button[data-cheat="save:del:throwaway"]') === null,
    S().confirmDelete);
  await press('save:arm:throwaway');
  check('firing the confirm works', await press('save:del:throwaway'));
  await sleep(0.8);
  const afterDel = S();
  check('DELETE really removed it from the store',
    !afterDel.rows.some((r) => r.name === 'throwaway') && of.saves().deleted === 1,
    JSON.stringify({ rows: afterDel.rows.map((r) => r.name), s: of.saves() }));
  check('and it left the OTHER save alone',
    afterDel.rows.some((r) => r.name === NAME),
    JSON.stringify(afterDel.rows.map((r) => r.name)));
  // THE AUTOSAVE ROW HAS NO DELETE AT ALL: Start Fresh is that verb and it says
  // what it destroys, so a second, smaller one here would be the more dangerous.
  check('the autosave row offers no delete',
    document.querySelector('#of-pause .ctlr[data-auto="1"] button[data-cheat^="save:arm"]') === null);

  // --- 3. WRECK the world ---------------------------------------------------
  // The autosave keeps running on the sim clock, so after this the auto slot
  // holds a RUINED world and the named slot holds the good one. That divergence
  // is what makes phase 2 able to tell a load from a no-op.
  of.pause(false);
  await sleep(0.3);
  let razed = 0;
  for (const b of [...(fac().list ?? [])]) {
    if (of.demolish({ id: b.id }) !== null) razed++;
  }
  await sleep(0.4);
  await of.save();
  await sleep(0.6);
  const wrecked = fac().buildings;
  log.push(`razed ${razed}, ${wrecked} buildings left, autosave rewritten`);
  check('the world really was wrecked', wrecked === 0 && razed >= 4,
    `${razed} razed, ${wrecked} left`);
  check('and the autosave now holds the WRECKED world',
    (await of.load()) !== null && fac().buildings === 0, `${fac().buildings}`);

  // --- 4. load the named save, or deliberately do not -----------------------
  of.pause(true);
  await sleep(0.4);
  await press('page:save');
  let loadPressed = false;
  if (wantLoad) {
    of.cheat('norestart');
    loadPressed = await press(`save:load:${NAME}`);
    await sleep(0.8);
    check('pressing Load works', loadPressed);
    check('and the slots layer counted exactly one load',
      of.saves().loads === 1, JSON.stringify(of.saves()));
  } else {
    log.push('NEGATIVE CONTROL: Load deliberately not pressed');
    check('and nothing was loaded', of.saves().loads === 0,
      JSON.stringify(of.saves()));
  }

  return {
    valid: fails.length === 0,
    fails,
    log,
    // `reload.mjs` reads these three by name in phase 2.
    wantLoad,
    builtBuildings: built,
    wreckedTo: wrecked,
    savedName: NAME,
    savedKey: saved?.key ?? null,
    slots: of.saves(),
    saves: of.game().persist.saves,
    nameErrorForColon: badName,
    deleteWorked: of.saves().deleted === 1,
  };
})()
