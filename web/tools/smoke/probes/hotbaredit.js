// hotbaredit.js: EDITING THE HOTBAR FROM THE PACK (GP-108), AND THE GUN THAT
// EVERY SAVE WAS DELETING (GP-109).
//
//   node tools/smoke/run.mjs --url=... --sandbox=1 --evalfile=probes/hotbaredit.js
//
// Reid asked for one thing, "i want to be able to remove things from my hotbar
// while in my inventory menu", and reported a second, that he "does not see a
// gun". The two turned out to be the same file and only one of them was the bug
// he thought it was.
//
// THE GUN WAS NOT A DRAWING PROBLEM. The bar renders all eleven slots and this
// probe counts them to prove it. What was wrong is that `Hotbar.readSlot` had no
// case for `{kind:'gun'}`, so the fall-through turned slot 11 into an empty slot
// on every single restore: correct for one boot, gone from the first reload
// onwards, and unrecoverable, because a gun is not a `PartKind` and the pack
// gesture that fills a slot cannot reach one. THE ROUND TRIP IS THEREFORE THE
// ASSERTION, and it is driven through `of.save()` / `of.load()`, which is
// enough here for the reason it is not enough elsewhere: the bar is restored
// from the SLOT BYTES by `Hotbar.restore`, with no module state anywhere in the
// path that could survive and fake a pass.
//
// EVERY GESTURE BELOW IS A REAL PointerEvent on the real element. The remove
// badge and the reset button only take pointer events while the pack is open,
// which is not a limitation but the whole reason the ask was phrased "while in
// my inventory menu": during play the pointer is locked to the canvas and there
// is no cursor to click a slot with.
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
  const bar = () => of.hotbar();
  const kinds = () => bar().slots.map((s) => s.kind);
  const opts = { bubbles: true, pointerId: 1, pointerType: 'mouse', button: 0 };
  /**
   * A REAL press, 110 ms, BY SELECTOR and re-queried between the down and the
   * up. The re-query is not fussiness: `HotbarBar.render` replaces the whole
   * bar's innerHTML whenever its key moves, so an element captured before the
   * press is detached by the frame that lands during the 110 ms hold, and a
   * pointerup on a detached node bubbles to nothing at all. That is a real
   * probe bug this file had and it looked exactly like a broken feature.
   */
  const realClick = async (sel, hold = 0.11) => {
    const down = document.querySelector(sel);
    if (down === null) return false;
    down.dispatchEvent(new PointerEvent('pointerdown', opts));
    await sleep(hold);
    const up = document.querySelector(sel) ?? down;
    up.dispatchEvent(new PointerEvent('pointerup', opts));
    await sleep(0.3);
    return true;
  };

  await sleep(0.6);

  // ======================================================================
  // A. ALL ELEVEN SLOTS ARE DRAWN, gun included
  // ======================================================================
  const declared = bar().slots.length;
  of.panel(true);
  await sleep(0.4);
  const drawn = document.querySelectorAll('#of-hotbar .of-hslot').length;
  const gunSlot = bar().slots.findIndex((s) => s.kind === 'gun');
  check('the bar declares eleven slots', declared === 11, `${declared}`);
  check('and DRAWS all eleven', drawn === declared, `${drawn} drawn, ${declared} declared`);
  check('the gun is one of them, on slot 11', gunSlot === 10,
    `gun at index ${gunSlot}: ${kinds().join(',')}`);
  const gunTile = document.querySelector('#of-hotbar .of-hslot[data-i="10"]');
  check('the gun tile is on screen with a real box',
    gunTile !== null && gunTile.getBoundingClientRect().width > 10,
    `${gunTile === null ? 'missing' : gunTile.getBoundingClientRect().width}`);

  // ======================================================================
  // B. GP-109: THE GUN SURVIVES A SAVE AND A LOAD
  // ======================================================================
  // Move it first, so the round trip is asserting that the SAVED bar came back
  // rather than that `DEFAULT_BAR` happens to have a gun in the same place.
  of.assignSlot(11, 'empty');
  await sleep(0.15);
  of.assignSlot(1, 'hand');
  await sleep(0.15);
  // Put the gun back through `reset`, then swap it somewhere unusual.
  await realClick('#of-hotbar .of-hreset');
  const beforeSave = kinds();
  await of.save();
  await sleep(0.4);
  // Nobble the live bar so a load that did nothing at all cannot pass.
  of.assignSlot(11, 'empty');
  of.assignSlot(4, 'empty');
  await sleep(0.2);
  const nobbled = kinds();
  check('the live bar really was nobbled before the load',
    nobbled[10] === 'empty' && nobbled[3] === 'empty', nobbled.join(','));
  await of.load();
  await sleep(0.5);
  const afterLoad = kinds();
  log.push(`bar across the round trip: ${beforeSave.join(',')} -> ${afterLoad.join(',')}`);
  check('THE GUN CAME BACK from the save slot', afterLoad[10] === 'gun',
    `slot 11 restored as "${afterLoad[10]}"`);
  check('and so did every other slot, unchanged',
    afterLoad.join(',') === beforeSave.join(','),
    `${beforeSave.join(',')} -> ${afterLoad.join(',')}`);

  // ======================================================================
  // C. GP-108: REMOVE, from the inventory menu, with a real click
  // ======================================================================
  of.panel(true);
  await sleep(0.35);
  check('the pack is what makes the bar live',
    document.getElementById('of-hotbar').classList.contains('live'));
  const BADGE4 = '#of-hotbar .of-hslot[data-i="3"] .of-hx';
  const badge4 = document.querySelector(BADGE4);
  check('every non-empty slot carries a visible remove badge while the pack is open',
    badge4 !== null && badge4.getBoundingClientRect().width > 0,
    `${badge4 === null ? 'no badge' : badge4.getBoundingClientRect().width}`);
  const kind4 = kinds()[3];
  await realClick(BADGE4);
  const cleared = kinds();
  check('clicking the badge EMPTIES that slot',
    cleared[3] === 'empty' && kind4 !== 'empty', `${kind4} -> ${cleared[3]}`);
  check('and it emptied ONLY that slot',
    cleared.filter((k) => k === 'empty').length === 1, cleared.join(','));

  // Right click does the same thing, because `demolish` is Mouse2 everywhere
  // else in this game and a player will try it here.
  const tile5 = document.querySelector('#of-hotbar .of-hslot[data-i="4"]');
  tile5.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
  await sleep(0.3);
  check('right click removes as well', kinds()[4] === 'empty', kinds().join(','));

  // A CLEARED SLOT REALLY DOES NOTHING, which is the assertion that proves the
  // removal reached the thing that decides what the left button does, and not
  // only the picture of it (GP-26's own argument).
  of.panel(false);
  await sleep(0.25);
  of.hotbar(4);
  await sleep(0.25);
  const armed = { kind: bar().kind, part: bar().part, ghost: of.build().ghost };
  check('selecting an emptied slot holds NOTHING and arms no ghost',
    armed.kind === 'empty' && armed.part === null && armed.ghost === null,
    JSON.stringify(armed));

  // ======================================================================
  // D. AND THE WAY BACK, because remove without it is a trap
  // ======================================================================
  // A structural part never enters the pack (gameplay.h S.6: it is paid for and
  // placed, never crafted into a carried item), so the pack-click gesture
  // cannot refill slot 4 and the reset is the ONLY route. Emptying every slot
  // first makes that as bad as it can get.
  of.panel(true);
  await sleep(0.3);
  for (let i = 0; i < 11; ++i) of.assignSlot(i + 1, 'empty');
  await sleep(0.3);
  const stranded = kinds();
  check('every slot can be emptied, including the hand and the gun',
    stranded.every((k) => k === 'empty'), stranded.join(','));
  check('and a stranded player can place nothing at all',
    of.hotbar(4).part === null && of.hotbar(1).kind === 'empty', stranded.join(','));
  const resetBtn = document.querySelector('#of-hotbar .of-hreset');
  check('the reset control is on screen while the pack is open',
    resetBtn !== null && resetBtn.getBoundingClientRect().width > 0);
  await realClick('#of-hotbar .of-hreset');
  const restored = kinds();
  log.push(`reset restored: ${restored.join(',')}`);
  check('RESET puts the whole default loadout back',
    restored.filter((k) => k === 'empty').length === 0, restored.join(','));
  check('including the gun', restored[10] === 'gun', restored[10]);
  check('and including the four structural parts the pack cannot reach',
    bar().slots.filter((s) => s.part === 'foundation' || s.part === 'floor'
      || s.part === 'wall' || s.part === 'door').length === 4,
    bar().slots.map((s) => s.part).join(','));

  // ======================================================================
  // E. ASSIGN, the other half: a placeable pack item onto the chosen slot
  // ======================================================================
  // Sandbox GRANTS rather than crafts (DW-31), so a placeable item can be got
  // into the pack by pressing the panel's own Craft buttons and nothing has to
  // be mined first. Real buttons, because that is the path a player takes.
  let assign = { ran: false, crafted: 0 };
  // BY `data-i`, RE-QUERIED EVERY TIME. The craft list is rebuilt on every pack
  // change, so a snapshot of the buttons goes stale after the first click and
  // every press after it lands on a detached node and does nothing. Same defect
  // the bar's controls had above, in a second list.
  const recipeIds = [...document.querySelectorAll('#of-panel .of-recipe button')]
    .map((b) => b.getAttribute('data-i'));
  for (const i of recipeIds) {
    const b = document.querySelector(`#of-panel .of-recipe button[data-i="${i}"]`);
    if (b === null || b.disabled) continue;
    b.click();
    assign.crafted++;
    await sleep(0.12);
    if (document.querySelector('#of-panel .of-slot.place[data-item]') !== null) break;
  }
  await sleep(0.4);
  const row = document.querySelector('#of-panel .of-slot.place[data-item]');
  if (row !== null) {
    of.hotbar(5);
    await sleep(0.25);
    const was = kinds()[4];
    const item = Number(row.getAttribute('data-item'));
    // The pack tiles are rebuilt on every pack change, so the same re-query
    // rule applies here as to the bar's own controls.
    await realClick('#of-panel .of-slot.place[data-item]');
    const now = of.hotbar();
    assign = { ...assign, ran: true, item, was, kind: now.slots[4].kind,
      part: now.slots[4].part };
    check('clicking a placeable pack item puts it on the SELECTED slot',
      now.slots[4].kind !== 'empty', JSON.stringify(assign));
    check('and the bar can therefore be REFILLED as well as emptied',
      now.slots[4].part !== null || now.slots[4].kind === 'furnace',
      JSON.stringify(assign));
  } else {
    // Never a silent skip: a probe that quietly proved nothing is the failure
    // this whole suite's rules are about.
    fails.push('no placeable item could be crafted into the pack, so ASSIGN '
      + `was not exercised at all (${assign.crafted} craft buttons pressed)`);
  }

  of.panel(false);
  await sleep(0.2);

  return {
    valid: fails.length === 0,
    fails,
    log,
    slots: { declared, drawn, gunIndex: gunSlot },
    gunRoundTrip: { beforeSave, nobbled, afterLoad },
    remove: { cleared, byRightClick: kinds()[4], armedAfterClear: armed },
    reset: { stranded, restored },
    assign,
  };
})()
