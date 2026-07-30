// GP-163: A MACHINE CAN ALWAYS BE OPENED, from where a player actually stands,
// with whatever they actually have in hand.
//
//   cd web
//   node tools/smoke/run.mjs --scenario=walk --sandbox=1 --settle=6 \
//        --evalfile=tools/smoke/probes/machineopen.js
//
// WHAT THIS EXISTS TO CATCH, measured before it was fixed (2026-07-30): the
// only door into a factory machine's screen was a bare-hand LEFT CLICK
// (GP-61). A player who walked up with a belt still selected had NO path to
// the recipe menu: the click was a placement refusal (+1 refusals, screen
// shut) and E, the key the crosshair chip itself advertised, left the screen
// shut with a part in hand AND with the bare hand. That is Reid's "i cant
// click into an assembler to select recipe", and no probe had ever caught it
// because every machine-panel probe selects the bare hand first and none of
// them had ever pressed E at a machine expecting a screen.
//
// SECOND HALF OF THE SAME BRIEF: nobody had proven the click path from a
// STANDING POSITION a player can occupy. FS-92 made machines solid, so this
// probe WALKS INTO each machine until the solid stops the walker and clicks
// from there, rather than from wherever placement happened to leave the eye.
// The fixture is asserted before the behaviour (GP-142): the walk must have
// been stopped by the housing, or the "opens from standing reach" checks
// would be measuring a probe that never left arm's length.
//
// Four machines, three doors:
//   assembler: bare-hand click opens (GP-61 held), E with a PART in hand
//              opens (GP-163), and a [short] recipe row still SETS the recipe,
//              because affordability styles the row and must not gate the plan.
//   smelter:   E opens, part in hand.
//   miner:     placed on a real deposit, E opens with the drill still in hand.
//   chest:     E opens.
// Plus the prompt chip: the crosshair line at an unset assembler must name the
// state (NO RECIPE) and the verb that actually works, read from the LIVE
// binding table, never a literal spelled here (GP-140's rule).
(async () => {
  const of = window.__of;
  if (!of) return { valid: false, why: 'no __of' };
  const el = document.querySelector('canvas');
  if (!el) return { valid: false, why: 'no canvas' };

  const sleep = (n) => of.run(n);
  const fails = [];
  const log = [];
  const check = (name, ok, detail) => {
    if (!ok) fails.push(detail === undefined ? name : `${name}: ${detail}`);
    return ok;
  };
  const V = (a) => Math.hypot(a[0], a[1], a[2]);
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const eye = () => of.aim().origin;

  const opts = { bubbles: true, pointerId: 1, pointerType: 'mouse', button: 0 };
  const realClick = async (hold = 0.11) => {
    el.dispatchEvent(new PointerEvent('pointerdown', opts));
    await sleep(hold);
    el.dispatchEvent(new PointerEvent('pointerup', opts));
    await sleep(0.25);
  };
  const pressE = async () => {
    of.input.tape([{ hold: 6, actions: ['interact'] }, { hold: 4, keys: [] }]);
    await sleep(0.5);
  };
  const aimAt = async (want) => {
    let bestYaw = of.world().observer.yawDeg, bestPitch = -20, best = -2;
    for (let y = bestYaw - 180; y <= bestYaw + 180; y += 4) {
      for (let p = -60; p <= 25; p += 4) {
        of.look(y, p);
        const a = of.aim();
        const v = sub(want, a.origin);
        const l = V(v) || 1;
        const k = dot(a.dir, [v[0] / l, v[1] / l, v[2] / l]);
        if (k > best) { best = k; bestYaw = y; bestPitch = p; }
      }
    }
    of.look(bestYaw, bestPitch);
    await sleep(0.2);
    return best;
  };
  /** Walk INTO `pos` until the walker stops moving. Returns metres to centre. */
  const walkInto = async (pos) => {
    await aimAt(pos);
    let prev = V(sub(pos, eye()));
    for (let i = 0; i < 16; ++i) {
      of.input.tape([{ hold: 30, keys: ['KeyW'] }]);
      await sleep(0.6);
      const d = V(sub(pos, eye()));
      if (Math.abs(d - prev) < 0.03) break;
      prev = d;
      if (i % 3 === 2) await aimAt(pos);
    }
    of.input.tape([{ hold: 2, keys: [] }]);
    await sleep(0.2);
    return V(sub(pos, eye()));
  };
  const closePanel = async () => {
    if (of.game().screen.open) { of.escape(); await sleep(0.3); }
  };
  const screen = () => of.game().screen;
  const promptText = () => document.querySelector('#of-prompt')?.textContent ?? '';

  await sleep(0.8);
  // Spend the lock-buying click at bare ground (machinepanel.js's rule).
  of.hotbar(1);
  of.look(of.world().observer.yawDeg, -70);
  await realClick();

  // ======================================================================
  // 1. THE ASSEMBLER, from the real build menu, walked into, clicked open
  // ======================================================================
  of.buildMenu(true);
  await sleep(0.2);
  const tile = document.querySelector('.of-btile[data-build="assembler"]');
  if (tile === null) {
    return { valid: false, why: 'no assembler tile in the build menu',
      rows: of.buildMenu().rows.map((r) => r.id), log };
  }
  tile.click();
  await sleep(0.3);
  check('the build menu put the assembler in hand',
    of.buildMenu().holding === 'assembler', of.buildMenu().holding);
  of.look(of.world().observer.yawDeg, -18);
  await sleep(0.2);
  await realClick();
  const asm = of.game().factory.list.filter((p) => p.kind === 'assembler').pop();
  if (asm === undefined) {
    return { valid: false, why: 'the assembler never placed', log,
      build: of.build() };
  }

  of.hotbar(1);
  await sleep(0.2);
  const stoodAsm = await walkInto(asm.pos);
  // FIXTURE FIRST (GP-142): an 8 m housing's face is 4.0 m from its centre,
  // and the eye must be stopped just past it. A walk that ended metres out is
  // a probe standing where no rule is under test; one that ended INSIDE the
  // face means the solid is gone, which is FS-92's own regression and worth a
  // name of its own.
  check('the walk was STOPPED at the housing (solid engaged)',
    stoodAsm > 4.0 && stoodAsm < 5.4, `${stoodAsm.toFixed(2)} m to centre`);

  // The crosshair chip at an unset assembler: state + working verb, spelled
  // from the LIVE binding table. The fixture assertion pins the table so a
  // remap fails HERE by name rather than making the text check lie.
  const eCode = of.input.bindings().interact[0];
  check('fixture: interact is still bound with KeyE first', eCode === 'KeyE',
    JSON.stringify(of.input.bindings().interact));
  const chip = promptText();
  check('the chip names the state: NO RECIPE', chip.includes('NO RECIPE'), chip);
  check('the chip offers the verb that works: E open',
    chip.includes('E open'), chip);

  const a0 = { open: screen().open, built: of.game().factory.buildings };
  await realClick();
  const a1 = screen();
  check('GP-61 held: a bare-hand click from standing reach OPENED the screen',
    a0.open === false && a1.open === true && a1.of === 'assembler',
    `open ${a0.open} -> ${a1.open}, of ${JSON.stringify(a1.of)}`);

  // ======================================================================
  // 2. THE RECIPE ROW: [short] styles it, and must not gate it
  // ======================================================================
  const rows = [...document.querySelectorAll('#of-furnace button[data-recipe]')];
  check('the panel offers recipe rows', rows.length > 0, String(rows.length));
  const short = rows.find((r) => r.className.includes('short')) ?? rows[0];
  const wantRecipe = Number(short?.getAttribute('data-recipe') ?? 0);
  check('fixture: the row clicked is genuinely unaffordable here (sandbox pack '
    + 'is empty, so a row that is not [short] means the fixture moved)',
    short !== undefined && short.className.includes('short'),
    short?.className ?? 'no row');
  check('fixture: no recipe is set before the click', screen().recipe === 0,
    String(screen().recipe));
  short?.click();
  await sleep(0.3);
  check('clicking a [short] recipe row SET the recipe',
    screen().recipe === wantRecipe && wantRecipe > 0,
    `recipe ${screen().recipe} against clicked ${wantRecipe}`);
  check('the machine stopped saying NO RECIPE', screen().status !== 'NO RECIPE',
    String(screen().status));

  // ======================================================================
  // 3. GP-163 HEADLINE: E WITH A PART IN HAND opens the machine
  // ======================================================================
  await closePanel();
  of.hotbar(4);                          // the belt: a part, not the bare hand
  await sleep(0.2);
  check('fixture: slot 4 holds a part, not the hand',
    of.hotbar().selected === 4, JSON.stringify(of.hotbar().selected));
  await aimAt(asm.pos);
  const b0 = { open: screen().open, built: of.game().factory.buildings };
  await pressE();
  const b1 = { open: screen().open, of: screen().of,
    built: of.game().factory.buildings };
  check('E with a PART in hand opened the assembler',
    b0.open === false && b1.open === true && b1.of === 'assembler',
    `open ${b0.open} -> ${b1.open}, of ${JSON.stringify(b1.of)}`);
  check('E placed nothing', b1.built === b0.built, `${b0.built} -> ${b1.built}`);

  // ======================================================================
  // 4. THE OTHER THREE: smelter, chest on flat ground; the drill on a patch
  // ======================================================================
  await closePanel();
  const results = {};

  // BACK AWAY FIRST: the eye is flush against an 8 m housing, so anything
  // dropped at arm's length lands inside its footprint and is refused. Turn
  // around, walk clear, and place on open ground.
  of.look(of.world().observer.yawDeg + 180, -5);
  await sleep(0.2);
  of.input.tape([{ hold: 150, keys: ['KeyW'] }]);
  await sleep(2.8);
  of.input.tape([{ hold: 2, keys: [] }]);
  await sleep(0.2);

  // The smelter, from the hotbar, dropped beside us.
  of.hotbar(5);
  await sleep(0.2);
  of.look(of.world().observer.yawDeg + 60, -30);
  await sleep(0.2);
  await realClick();
  const sm = of.game().factory.list.filter((p) => p.kind === 'smelter').pop();
  if (sm !== undefined) {
    await aimAt(sm.pos);
    await pressE();                       // smelter still in hand: the new door
    const s = screen();
    results.smelter = { open: s.open, of: s.of };
    check('E (part in hand) opened the smelter', s.open === true && s.of === 'smelter',
      JSON.stringify(results.smelter));
  } else {
    fails.push(`the smelter never placed, so its door is unproven `
      + `(ghost ${JSON.stringify(of.build().ghost)})`);
  }
  await closePanel();

  // The chest, from the build menu.
  of.buildMenu(true);
  await sleep(0.2);
  const chestTile = document.querySelector('.of-btile[data-build="chest"]');
  if (chestTile === null) {
    fails.push(`no chest tile: ${of.buildMenu().rows.map((r) => r.id).join(',')}`);
  } else {
    chestTile.click();
    await sleep(0.3);
    of.look(of.world().observer.yawDeg - 120, -25);
    await sleep(0.2);
    await realClick();
    const ch = of.game().factory.list.filter((p) => p.kind === 'chest').pop();
    if (ch !== undefined) {
      await aimAt(ch.pos);
      await pressE();                     // chest still in hand
      const s = screen();
      results.chest = { open: s.open, of: s.of };
      check('E (part in hand) opened the chest', s.open === true && s.of === 'chest',
        JSON.stringify(results.chest));
    } else fails.push('the chest never placed, so its door is unproven');
  }
  await closePanel();

  // The drill, on a real deposit, exactly as a player reaches one.
  const orePick = () => of.nodes().find((n) => n.kind === 3 && n.remaining > 20)
    ?? of.nodes().find((n) => n.kind === 2 && n.remaining > 20);
  let node = orePick();
  if (node === undefined) fails.push('no ore node: the drill door is unproven');
  else {
    // Walk NEAR the deposit (5 m), then sweep the ghost onto the patch.
    let prev = Infinity;
    for (let i = 0; i < 45; ++i) {
      node = of.nodes().find((n) => n.index === node.index) ?? node;
      const d = V(sub([node.x, node.y, node.z], eye()));
      if (d < 5.0) break;
      if (d > prev - 0.05) await aimAt([node.x, node.y, node.z]);
      prev = Math.min(prev, d);
      of.input.tape([{ hold: 60, keys: ['KeyW'] }]);
      await sleep(1.1);
    }
    of.input.tape([{ hold: 2, keys: [] }]);
    await sleep(0.2);
    of.hotbar(3);                         // the drill
    await sleep(0.2);
    let placedMiner = null;
    const yaw0 = of.world().observer.yawDeg;
    outer:
    for (let y = yaw0 - 40; y <= yaw0 + 40; y += 5) {
      for (let p = -55; p <= -15; p += 4) {
        of.look(y, p);
        await sleep(0.05);
        const g = of.build().ghost;
        if (g !== null && g.ok && g.patch >= 0) {
          await realClick();
          placedMiner = of.game().factory.list.filter((q) => q.kind === 'miner').pop() ?? null;
          if (placedMiner !== null) break outer;
        }
      }
    }
    if (placedMiner === null) fails.push('the drill never placed on the patch');
    else {
      await aimAt(placedMiner.pos);
      await pressE();                     // drill still in hand
      const s = screen();
      results.miner = { open: s.open, of: s.of };
      check('E (part in hand) opened the mining drill',
        s.open === true && s.of === 'miner', JSON.stringify(results.miner));
    }
  }
  await closePanel();

  return {
    valid: fails.length === 0,
    fails,
    stoodAtAssembler: +stoodAsm.toFixed(3),
    chip,
    recipeSet: { want: wantRecipe },
    doors: results,
    log,
  };
})()
