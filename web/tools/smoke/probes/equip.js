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
//      0.40 reduction at 0.8940393 move speed, which is 0.99 x 0.95 x 0.97 x
//      0.98 EXACTLY: the encumbrances MULTIPLY and the reductions SUM, and a
//      client that got either rule backwards lands somewhere else. GP-52: the
//      header published 0.892 for that product for a night, and this probe is
//      what caught it, precisely because it asserts the arithmetic instead of
//      the constant.
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
  // H-5. THE PANEL KEY IS AN ACTION, not a raw code. It shipped as literal
  // 'KeyK' inside ProgressUi because `player/Bindings.ts` was another lane's
  // file that night, and three raw codes break the one property that made a
  // whole control remap cost a single file. A probe that presses `equipment`
  // survives the next remap; one that presses KeyK has to be found and edited.
  // H-4. THIRD PERSON FIRST, and the order is not cosmetic: `view` is NOT in
  // `UI_ALLOWED`, so a panel that is already open swallows it and the camera
  // stays in first person, where the body is not drawn at all. The first run of
  // this block pressed V after opening the panel and measured a triangle delta
  // of exactly 0, which reads precisely like "the armour is not drawn" and was
  // in fact "the camera never moved". Worth the paragraph, because the wrong
  // conclusion was one line away and it is the conclusion this probe exists to
  // reach.
  //
  // FIRST PERSON HAS NO ARMOUR AND THAT IS A-11, not a defect here:
  // `armour_set.glb` carries the 44-bone third-person rig and the view model is
  // a different 27-bone rig with a different bind pose, so an armoured player
  // still sees unarmoured arms.
  of.setView('TP');
  await sleep(0.8);
  const driftBare = of.armourDrift();
  check('nothing is BOUND to the body before a click', driftBare.length === 0,
    JSON.stringify(driftBare));
  /**
   * GP-157. THE TRIANGLE COUNT IS SAMPLED WITH THE GROUND SCATTER TURNED OFF,
   * because the scatter moves under the measurement and this probe was reading
   * its drift as a defect in the armour rig.
   *
   * `of.stats().draw.triangles` is a WHOLE-FRAME accumulator, so it counts
   * everything the renderer drew, and RN-45's ground detail cards stream in and
   * out as the player stands there. Measured: the probe's bare-to-worn window
   * gained 18 triangles that were nothing to do with armour, which turned an
   * exact "delta is a whole multiple of the bound count" into 4.0199, and left
   * an 18-triangle residue after the set came off again.
   *
   * DISCRIMINATED, not guessed. The same 18 appears with FOUR passes
   * (delta 3634 against 904 bound) and with ONE (`?shadows=0`: delta 922
   * against the same 904), so it is not per-pass and therefore not the body.
   * And it vanishes entirely under `?props=0` AND under `?detail=0`, both of
   * which make this probe pass unchanged. That is the ground detail cards and
   * nothing else.
   *
   * So this is standing rule 7 rather than a tolerance: isolate the subject and
   * keep the assertion EXACT. A threshold wide enough to absorb 18 triangles
   * would also absorb a missing primitive, which is precisely what the check
   * exists to catch.
   */
  const trisQuiet = async () => {
    of.propsVisible(false);
    await sleep(0.5);
    const t = of.stats().draw.triangles;
    of.propsVisible(true);
    await sleep(0.3);
    return t;
  };
  const trisBare = await trisQuiet();

  const binds = of.input.bindings();
  check('research, power and equipment are real bindings',
    ['research', 'power', 'equipment'].every((a) => (binds[a] ?? []).length > 0),
    JSON.stringify({ research: binds.research, power: binds.power,
      equipment: binds.equipment }));
  await press('equipment');
  await sleep(0.5);
  const panel = document.querySelector('#of-equip');
  check('the equip panel opened on the equipment ACTION',
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

  // ======================================================================
  // 2b. H-4: IT IS ACTUALLY ON THE BODY. Four clicks put four pieces into
  //     /core's slots; this is the half that was missing, and its absence was
  //     invisible because every progression assertion above still passed.
  // ======================================================================
  const drift = of.armourDrift();
  check('four pieces are BOUND to the body', drift.length === 4,
    JSON.stringify(drift.map((d) => d.slot)));
  check('every piece is driven by the BODY skeleton, not its own copy',
    drift.every((d) => d.sameSkeleton === true),
    JSON.stringify(drift.map((d) => [d.slot, d.sameSkeleton])));
  check('and by a skeleton with the same bones as the body',
    drift.every((d) => d.bones === d.bodyBones && d.bones > 0),
    JSON.stringify(drift.map((d) => [d.slot, d.bones, d.bodyBones])));
  // THE NODE NAME CAME FROM /core AND WAS NOT REBUILT HERE. `armourNode(slot)`
  // is progression.h's published contract; a client that spelled it itself
  // would be a second authority over a name it does not own.
  check('the bound node is /core\'s own published name',
    drift.every((d) => p1.nodes.includes(d.requested)),
    JSON.stringify(drift.map((d) => d.requested)));
  // THE MULTI-PRIMITIVE TRAP, asserted rather than hoped for. GLTFLoader names
  // a node's mesh after the node only when the node has ONE primitive;
  // `Armour_Chest_LOD0` is several, so it arrives as `_0`, `_1`, ... An
  // exact-name lookup binds ONE of them, draws a fraction of the mesh, and
  // reports every slot equipped. That is the third file in two days to hit it.
  const chest = drift.find((d) => d.slot === 'Chest') ?? null;
  check('the chest is a MULTI-primitive node and all of it was bound',
    chest !== null && chest.primitives > 1, JSON.stringify(chest));
  const driftTris = drift.reduce((a, d) => a + d.triangles, 0);
  const trisWorn = await trisQuiet();
  check('every piece contributed triangles', drift.every((d) => d.triangles > 0),
    JSON.stringify(drift.map((d) => [d.slot, d.primitives, d.triangles])));
  // THE SCREEN AGREES WITH THE RIG. What the rig says it bound is what the
  // renderer draws: a piece bound to a detached copy, or left invisible, moves
  // one of these numbers and not the other.
  //
  // THE DELTA IS A WHOLE MULTIPLE of the bound count, not equal to it, and the
  // multiple is the number of PASSES the body is drawn in. `renderer.info` is
  // accumulated across the frame's passes, and armour casts shadows like the
  // body does, so a set worn on a body lit by three cascades shows up four
  // times. Asserting the multiple is exact rather than asserting a total is
  // what keeps this a property: it fails if one primitive is missing, if a
  // piece is invisible in the near pass, or if a piece is drawn in the shadow
  // passes but not the one the player sees.
  const delta = trisWorn - trisBare;
  const passes = driftTris > 0 ? delta / driftTris : 0;
  check('the frame drew the triangles the rig says it bound, in whole passes',
    driftTris > 0 && delta > 0 && Number.isInteger(passes),
    `${trisBare} -> ${trisWorn} (delta ${delta}) vs ${driftTris} bound`);
  log.push(`H-4 drawn: ${JSON.stringify(drift.map((d) =>
    `${d.slot} ${d.primitives}p ${d.triangles}t`))}, set ${driftTris} triangles, `
    + `frame ${trisBare} -> ${trisWorn} (delta ${delta} = ${passes} passes)`);

  // CONTROL 2: the suit is /core's own arithmetic. Reductions SUM to 0.40 and
  // encumbrances MULTIPLY to 0.8940393 (0.99 x 0.95 x 0.97 x 0.98). GP-52: the
  // header and GP-42 both published 0.892 for that product, which is a
  // transcription that drifted from a table that was always right, and this
  // probe is what caught it precisely BECAUSE it asserts the arithmetic.
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
  // H-4's NEGATIVE CONTROL, and it is the one that makes the four assertions
  // above mean something: a build that simply drew four armour pieces on every
  // body it ever loaded passes all of them and fails both of these.
  check('taking it off takes it OFF THE BODY too', of.armourDrift().length === 0,
    JSON.stringify(of.armourDrift()));
  const trisAfter = await trisQuiet();
  check('and the frame gave the triangles back exactly',
    trisAfter === trisBare, `${trisAfter} vs ${trisBare}`);

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
  // H-4, THE PATH THAT PRESSES NO BUTTON. A load puts four pieces back into
  // /core's slots with nobody clicking Equip, so a client that only reacted to
  // a click would come back from a save with a bare body and a full stat
  // block. This is why `syncArmour` sweeps every slot from `wornAll` instead.
  const driftBack = of.armourDrift();
  check('and the BODY came back wearing them, with no click at all',
    driftBack.length === 4, JSON.stringify(driftBack.map((d) => d.slot)));
  check('bound to the body skeleton after the load too',
    driftBack.every((d) => d.sameSkeleton === true && d.triangles > 0),
    JSON.stringify(driftBack.map((d) => [d.slot, d.sameSkeleton, d.triangles])));
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

  await press('equipment');
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
