// GP-51: A CRAFT INTO A FULL PACK, driven in the browser.
//
//   npx --prefix web vite build --outDir dist-gp
//   npx --prefix web vite preview --outDir dist-gp --port 4185
//   node web/tools/smoke/run.mjs --url=http://127.0.0.1:4185/ --scenario=walk \
//     --evalfile=web/tools/smoke/probes/craftfull.js
//
// SURVIVAL, DELIBERATELY, and it is the whole point of running this in a
// browser at all: sandbox GRANTS a craft rather than calling `of_gp_craft`
// (DW-31), so a sandbox run would never touch the code being fixed.
//
// THE DEFECT: `HandCrafter::craft` spent every input, called `inv.add`, threw
// the overflow away and returned TRUE. A player crafting with a full pack paid
// for an item that never existed, and the only symptom was that nothing
// happened. The progression lane lost an hour to it.
//
// THE SETUP IS REACHED, NOT WRITTEN. The pack is filled by CRAFTING, which is
// the operation under test: a crude pickaxe stacks to one, so every pickaxe
// takes a slot of its own and the pack fills itself in about eighteen presses.
// Nothing is granted and no state is written directly.
//
// THE NEGATIVE CONTROL IS THE PRESS BEFORE THE ONE THAT FAILS. Every craft
// while a slot was free succeeded, on the same pack, with the same recipe, in
// the same loop; the first one attempted with no slot free is refused. A build
// that had simply stopped crafting fails that half, and a build that still
// silently ate the inputs fails this half. Two more controls: `craftable`
// (which is /core's INPUT-side answer) is still TRUE at the moment of the
// refusal, so this cannot be "you are short of wood" wearing a different hat;
// and a recipe that really is short of inputs reports a DIFFERENT code in the
// same frame, so the two refusals are distinguishable rather than one boolean.
(async () => {
  const of = window.__of;
  if (!of) return { valid: false, why: 'no __of' };
  const sleep = (n) => of.run(n);
  const fails = [];
  const log = [];
  const check = (name, ok, detail) => {
    if (!ok) fails.push(detail === undefined ? name : `${name}: ${detail}`);
    return ok;
  };
  const press = async (code, frames = 6) => {
    of.input.act([code], frames);
    await sleep(0.3);
  };
  const click = (el) => {
    if (!el || el.disabled) return false;
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true,
      view: window }));
    return true;
  };
  const BLOCK = { None: 0, NoRecipe: 1, InputsShort: 2, PackFull: 3 };
  const pack = () =>
    Object.fromEntries(of.game().carried.map((c) => [c.name, c.count]));
  const recipe = (name) =>
    of.game().recipes.find((r) => r.name === name) ?? null;
  // The pack header a player reads, `used / 20`, so slot occupancy comes from
  // the UI rather than from a second count computed here.
  const slotsUsed = () => {
    const t = document.querySelector('#of-panel .pack h3 span')?.textContent ?? '';
    const m = /(\d+)\s*\/\s*(\d+)/.exec(t);
    return m === null ? -1 : { used: Number(m[1]), of: Number(m[2]) };
  };

  await sleep(1.0);

  // ======================================================================
  // 0. SETUP PROOF (DW-20). Survival, empty pack, and a recipe that is
  //    refused for the OTHER reason, which is the discriminator this whole
  //    fix exists to make possible.
  // ======================================================================
  check('this run is SURVIVAL, so of_gp_craft is really called',
    of.game().mode.sandbox === false, JSON.stringify(of.game().mode));
  check('the pack starts empty', of.game().carried.length === 0,
    JSON.stringify(of.game().carried));
  const pick0 = recipe('Crude pickaxe');
  check('the pickaxe recipe exists', pick0 !== null,
    JSON.stringify(of.game().recipes.map((r) => r.name)));
  check('and an empty pack refuses it for INPUTS, not for room',
    pick0?.block === BLOCK.InputsShort, JSON.stringify(pick0));

  // ======================================================================
  // 1. MINE. Generously, so the refusal below cannot be about materials.
  // ======================================================================
  let wood = 0;
  let iron = 0;
  for (const n of of.nodes()) {
    if (n.kind === 0) for (let k = 0; k < 30; ++k) {
      if (of.harvest(n.index).ok) wood++;
    }
    if (n.kind === 3) for (let k = 0; k < 30; ++k) {
      if (of.harvest(n.index).ok) iron++;
    }
  }
  log.push(`mined: ${JSON.stringify(pack())}`);
  check('there is wood', (pack()['Wood'] ?? 0) > 20, pack()['Wood']);
  check('there is raw iron', (pack()['Raw iron'] ?? 0) > 20, pack()['Raw iron']);

  await press('Tab');
  await sleep(0.5);
  const rows = () => [...document.querySelectorAll('#of-panel .of-recipe')];
  const rowNamed = (t) => rows().find((e) =>
    (e.querySelector('.nm')?.textContent ?? '').includes(t));
  check('the pack panel is open and reports its slots',
    slotsUsed() !== -1 && slotsUsed().of === 20, JSON.stringify(slotsUsed()));

  // ======================================================================
  // 2. CRAFT UNTIL IT WILL NOT FIT. Every press is a real DOM click on the
  //    Craft button, and every one is recorded with the slot count it was
  //    made at, so the transition from "fits" to "does not fit" is a
  //    measurement rather than an assumption.
  // ======================================================================
  const presses = [];
  let refusedAt = null;
  for (let i = 0; i < 30; ++i) {
    const before = { slots: slotsUsed(), r: recipe('Crude pickaxe'),
      p: pack() };
    if (before.r === null) break;
    if (before.r.block === BLOCK.PackFull) { refusedAt = before; break; }
    const row = rowNamed('Crude pickaxe');
    const ok = click(row?.querySelector('button'));
    await sleep(0.12);
    presses.push({ i, slots: before.slots.used, block: before.r.block,
      clicked: ok, made: (pack()['Crude pickaxe'] ?? 0) });
    if (!ok) break;
  }
  const madeTotal = pack()['Crude pickaxe'] ?? 0;
  log.push(`crafted ${madeTotal} pickaxes; last presses `
    + JSON.stringify(presses.slice(-3)));

  // EVERY CRAFT MADE WITH A SLOT FREE WORKED. This is the control: same pack,
  // same recipe, same loop, one slot of difference.
  const clean = presses.filter((p) => p.slots < 20);
  check('every craft attempted with a slot free went through',
    clean.length > 0 && clean.every((p) => p.clicked === true),
    JSON.stringify(clean.filter((p) => !p.clicked)));
  check('and each one produced a pickaxe',
    madeTotal === clean.length, `${madeTotal} vs ${clean.length}`);

  // ======================================================================
  // 3. THE REFUSAL, and it is about the OUTPUT.
  // ======================================================================
  check('the pack really is full', refusedAt !== null
    && refusedAt.slots.used === refusedAt.slots.of,
    JSON.stringify(refusedAt?.slots));
  check('/core refuses it, and the code is PACK FULL',
    refusedAt?.r?.block === BLOCK.PackFull, JSON.stringify(refusedAt?.r));
  // THE DISCRIMINATOR. `craftable` is /core's INPUT-side answer and it is still
  // TRUE here, so this refusal cannot be a missing-materials refusal in
  // disguise, and a boolean surface could not have told the two apart.
  check('the INPUTS are all still there (this is not "not enough materials")',
    refusedAt?.r?.craftable === true, JSON.stringify(refusedAt?.r));
  const row = rowNamed('Crude pickaxe');
  const button = row?.querySelector('button') ?? null;
  check('the Craft button is disabled', button !== null && button.disabled === true,
    String(button?.disabled));
  check('and the row SAYS WHY, in the panel, before anything is clicked',
    (row?.textContent ?? '').includes('pack is full'),
    row?.querySelector('.lock')?.textContent ?? '(no reason shown)');

  // A DISABLED BUTTON IS A SUGGESTION. Force it and prove the guard behind it
  // holds: this is the path that used to spend 1 Wood and 1 Raw iron and
  // produce nothing at all.
  const woodBefore = pack()['Wood'] ?? 0;
  const ironBefore = pack()['Raw iron'] ?? 0;
  if (button !== null) button.disabled = false;
  const forced = click(button);
  await sleep(0.35);
  check('a forced click was delivered', forced === true);
  check('and NOTHING was paid for it',
    (pack()['Wood'] ?? 0) === woodBefore
      && (pack()['Raw iron'] ?? 0) === ironBefore,
    `${woodBefore}/${ironBefore} -> ${pack()['Wood']}/${pack()['Raw iron']}`);
  check('and no pickaxe appeared',
    (pack()['Crude pickaxe'] ?? 0) === madeTotal,
    `${madeTotal} -> ${pack()['Crude pickaxe']}`);
  const flash = document.querySelector('#of-flash')?.textContent
    ?? document.body.textContent ?? '';
  check('and the player was TOLD, rather than nothing happening',
    flash.includes('pack is full'), flash.slice(0, 120));

  // ======================================================================
  // 4. THE THIRD CODE, in the same frame. A recipe that is genuinely short of
  //    inputs reports InputsShort while the pickaxe reports PackFull, so the
  //    two are different assertions and not one boolean.
  // ======================================================================
  // The pack holds only wood, raw iron and pickaxes, so anything costing stone
  // or an ingot is genuinely short. Found by CODE rather than by name, so a
  // recipe rename cannot quietly turn this control into a no-op.
  const short = of.game().recipes.filter((r) => r.block === BLOCK.InputsShort);
  const full = of.game().recipes.filter((r) => r.block === BLOCK.PackFull);
  check('a recipe short of INPUTS reports a different code in the same frame',
    short.length > 0 && full.length > 0,
    JSON.stringify(of.game().recipes.map((r) => [r.name, r.block])));
  check('and the two sets are disjoint, which a boolean could not express',
    short.every((r) => !full.some((f2) => f2.name === r.name)),
    JSON.stringify({ short: short.map((r) => r.name),
      full: full.map((r) => r.name) }));
  log.push(`codes in one frame: PackFull ${JSON.stringify(full.map((r) => r.name))}`
    + `, InputsShort ${JSON.stringify(short.map((r) => r.name))}`);

  await press('Tab');
  await sleep(0.3);

  return {
    valid: fails.length === 0,
    fails,
    log,
    crafted: madeTotal,
    slotsAtRefusal: refusedAt?.slots ?? null,
    blockAtRefusal: refusedAt?.r?.block ?? null,
    craftableAtRefusal: refusedAt?.r?.craftable ?? null,
    packAtRefusal: refusedAt?.p ?? null,
    packNow: pack(),
    ticks: of.world().tick,
  };
})()
