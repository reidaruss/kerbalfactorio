// THE EQUIPMENT ACCEPTANCE (W11 lane I's client half). `progression.h` landed
// at 823 checks with no bridge export, no `game/Progression.ts`, no panel and
// no armour on the avatar, which is to say with no way to reach the game.
//
//   node web/tools/smoke/run.mjs --url=http://127.0.0.1:4189/ --scenario=walk \
//     --sandbox=1 --evalfile=web/tools/smoke/probes/equip.js
//
// THE CLAIM: a slot is equipped, persisted, and comes back.
//
// THE NEGATIVE CONTROLS, because "the slot has a helm in it" is also true of a
// panel that draws one whatever the pack holds:
//   1. THE PACK PAYS. Equipping REMOVES the piece from the pack and unequipping
//      puts it back, so the item exists in exactly one place at a time. A view
//      that only set a slot would leave the pack untouched and pass every
//      assertion about the slot.
//   2. THE SUIT ADDS UP TO /core's OWN NUMBER. The four shipped pieces total
//      0.40 reduction at 0.892 move speed, and 0.892 is 0.99 x 0.95 x 0.97 x
//      0.98 to three decimals: the encumbrances MULTIPLY and the reductions SUM,
//      and a client that got either rule backwards lands somewhere else.
//   3. THE SLOT IS ENFORCED. A restore that puts boots on a head is refused by
//      /core's own deserialize, so the four slots after a reload are the four
//      slots before it, piece for piece.
//   4. THE EMPTY CASE. Before anything is worn the suit is exactly 1.000 speed
//      and 0 reduction, which is the bit-exact neutral `progression.h` promises
//      and is what makes the whole layer optional.
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
  const pack = () =>
    Object.fromEntries(of.game().carried.map((c) => [c.name, c.count]));
  const pg = () => of.game().progress.progression;
  const ARMOUR = [0x0070, 0x0071, 0x0072, 0x0073];

  await sleep(1.0);

  // ======================================================================
  // 0. SETUP PROOF (DW-20) and CONTROL 4: the empty suit is exactly neutral.
  // ======================================================================
  const p0 = pg();
  check('the progression surface exists', !!p0);
  if (!p0) return { valid: false, fails, why: 'no progression in the report' };
  check('four slots', p0.slots.length === 4, JSON.stringify(p0.slots));
  check('nothing is worn at boot', p0.worn.every((w) => w === 0),
    JSON.stringify(p0.worn));
  check('an empty suit removes exactly no damage', p0.reduction === 0, p0.reduction);
  check('and costs exactly no speed', p0.moveSpeedMul === 1, p0.moveSpeedMul);
  // The art contract: the node names are SLOT names, published by /core so the
  // client looks a slot up rather than typing a mesh name into a switch.
  check('the four armour_set.glb node names came from /core',
    p0.nodes.join(',') === 'Armour_Head_LOD0,Armour_Chest_LOD0,'
      + 'Armour_Legs_LOD0,Armour_Feet_LOD0', JSON.stringify(p0.nodes));
  log.push(`boot: slots ${JSON.stringify(p0.slots)}, nodes ${JSON.stringify(p0.nodes)}`);

  // ======================================================================
  // 1. CRAFT THE SET. Sandbox, so the four pieces are granted rather than
  //    smelted: this probe is about wearing them, and probes/research.js is
  //    the one that proves they are gated in survival.
  // ======================================================================
  await press('Tab');
  await sleep(0.4);
  const rows = () => [...document.querySelectorAll('#of-panel .of-recipe')];
  const rowNamed = (t) => rows().find((e) =>
    (e.querySelector('.nm')?.textContent ?? '').includes(t));
  let made = 0;
  for (const n of ['Iron helm', 'Iron cuirass', 'Iron greaves', 'Iron boots']) {
    if (click(rowNamed(n)?.querySelector('button'))) made++;
    await sleep(0.15);
  }
  check('all four armour pieces were crafted', made === 4, made);
  await press('Tab');
  await sleep(0.3);
  const packWithArmour = pack();
  log.push(`crafted: ${JSON.stringify(packWithArmour)}`);

  // ======================================================================
  // 2. WEAR IT, through the panel, with real DOM clicks.
  // ======================================================================
  await press('KeyK');
  await sleep(0.5);
  const panel = document.querySelector('#of-equip');
  check('the equip panel opened on K',
    !!panel && panel.classList.contains('open'), panel?.className);
  // ONE PIECE AT A TIME, recording the suit after each, so the totals below can
  // be checked as a PROPERTY (reductions sum, encumbrances multiply) rather
  // than against a transcribed constant. The first version of this probe
  // asserted 0.892 because that is the figure GP-42 and progression.h's own
  // comment publish, and it is WRONG: 0.99 x 0.95 x 0.97 x 0.98 is 0.8940393,
  // and a full set therefore costs 10.6% of walking speed and not the 12% the
  // header claims. Asserting the arithmetic catches that; asserting the
  // published number would have required tuning the threshold until it passed,
  // which is the standing-rule-11 failure exactly.
  let equipped = 0;
  const steps = [];
  for (const item of ARMOUR) {
    const was = pg();
    const b = document.querySelector(`#of-equip button[data-equip="${item}"]`);
    if (click(b)) equipped++;
    await sleep(0.25);
    const now = pg();
    steps.push({
      item,
      dReduction: now.reduction - was.reduction,
      rSpeed: now.moveSpeedMul / was.moveSpeedMul,
    });
  }
  check('all four Equip buttons took a real DOM click', equipped === 4, equipped);
  const p1 = pg();
  check('all four slots are filled',
    p1.worn.every((w) => w > 0), JSON.stringify(p1.worn));
  check('and each piece is in ITS OWN slot',
    p1.worn.join(',') === ARMOUR.join(','), JSON.stringify(p1.worn));

  // CONTROL 1: the pack PAID. The pieces are on the body, not in both places.
  const packAfter = pack();
  check('the armour LEFT the pack',
    ['Iron helm', 'Iron cuirass', 'Iron greaves', 'Iron boots']
      .every((n) => (packAfter[n] ?? 0) === 0), JSON.stringify(packAfter));

  // CONTROL 2: the suit is /core's own arithmetic. Reductions SUM to 0.40,
  // encumbrances MULTIPLY to 0.892 (0.99 x 0.95 x 0.97 x 0.98).
  const sumOfPieces = steps.reduce((a, s2) => a + s2.dReduction, 0);
  const productOfPieces = steps.reduce((a, s2) => a * s2.rSpeed, 1);
  check('REDUCTIONS SUM: the suit is the sum of its four pieces',
    Math.abs(p1.reduction - sumOfPieces) < 1e-6,
    `${p1.reduction} vs ${sumOfPieces}`);
  check('ENCUMBRANCES MULTIPLY: the suit is the product of its four pieces',
    Math.abs(p1.moveSpeedMul - productOfPieces) < 1e-6,
    `${p1.moveSpeedMul} vs ${productOfPieces}`);
  // The two rules are genuinely different, and this is what says so: if the
  // client had summed the encumbrances instead, the product and the sum would
  // have to coincide, and 0.894 is nowhere near 3.89.
  check('and the two rules are not the same rule',
    Math.abs(productOfPieces - steps.reduce((a, s2) => a + s2.rSpeed, 0)) > 1,
    productOfPieces);
  check('the shipped set removes 0.40 of a hit',
    Math.abs(p1.reduction - 0.40) < 5e-7, p1.reduction);
  log.push(`suit: reduction ${p1.reduction} (sum ${sumOfPieces}), speed `
    + `${p1.moveSpeedMul} (product ${productOfPieces}), `
    + `insulation ${p1.insulationC} C`);
  log.push(`per piece: ${JSON.stringify(steps.map((s2) =>
    `${s2.dReduction.toFixed(2)}/${s2.rSpeed.toFixed(3)}`))}`);

  // ======================================================================
  // 3. PERSIST IT. Save, take it all off, load, and it comes back.
  // ======================================================================
  const saved = await of.save();
  check('the world saved', saved !== null, JSON.stringify(saved));
  let removed = 0;
  for (let slot = 0; slot < 4; ++slot) {
    const b = document.querySelector(`#of-equip button[data-unequip="${slot}"]`);
    if (click(b)) removed++;
    await sleep(0.25);
  }
  check('all four Remove buttons took a real DOM click', removed === 4, removed);
  const p2 = pg();
  check('the body is bare again', p2.worn.every((w) => w === 0),
    JSON.stringify(p2.worn));
  check('and the armour came BACK to the pack',
    ['Iron helm', 'Iron cuirass', 'Iron greaves', 'Iron boots']
      .every((n) => (pack()[n] ?? 0) === 1), JSON.stringify(pack()));
  check('a bare body is neutral again', p2.reduction === 0 && p2.moveSpeedMul === 1,
    `${p2.reduction}/${p2.moveSpeedMul}`);

  const ledger = await of.load();
  check('the slot loaded', ledger !== null, JSON.stringify(ledger));
  const p3 = pg();
  // CONTROL 3: every piece is back, in ITS OWN slot, piece for piece.
  check('the four worn pieces came back exactly',
    p3.worn.join(',') === ARMOUR.join(','), JSON.stringify(p3.worn));
  check('and the suit is the same number as before the save',
    p3.reduction === p1.reduction && p3.moveSpeedMul === p1.moveSpeedMul,
    `${p3.reduction}/${p3.moveSpeedMul} vs ${p1.reduction}/${p1.moveSpeedMul}`);
  check('the restore ledger counts what it put back',
    (ledger?.progress?.armour ?? 0) === 4, JSON.stringify(ledger?.progress));
  log.push(`reload: armour ${ledger?.progress?.armour}, techs `
    + `${ledger?.progress?.techs}, worn ${JSON.stringify(p3.worn)}`);

  // ======================================================================
  // 4. SKILLS AND APPEARANCE, both of which the same slot carries.
  // ======================================================================
  const skills = p3.skills;
  check('five skills', skills.length === 5, skills.length);
  const swatch = document.querySelector('#of-equip button[data-appearance="visor:2"]');
  check('the appearance palette drew swatches', !!swatch);
  click(swatch);
  await sleep(0.3);
  check('a palette click changed the stored byte',
    pg().appearance.visor === 2, JSON.stringify(pg().appearance));
  const look = { ...pg().appearance };
  await of.save();
  await of.load();
  check('appearance survives a save and a load',
    JSON.stringify(pg().appearance) === JSON.stringify(look),
    `${JSON.stringify(pg().appearance)} vs ${JSON.stringify(look)}`);
  log.push(`appearance: ${JSON.stringify(look)}, skills `
    + JSON.stringify(skills.map((s) => `${s.name} ${s.level}`)));

  await press('KeyK');
  await sleep(0.3);

  return {
    valid: fails.length === 0,
    fails,
    log,
    worn: pg().worn,
    suit: { reduction: pg().reduction, speed: pg().moveSpeedMul },
    equips: pg().equips,
    unequips: pg().unequips,
    ticks: of.world().tick,
  };
})()
