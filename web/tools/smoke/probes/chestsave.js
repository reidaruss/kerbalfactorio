// chestsave.js: PUT SOMETHING IN A BOX, THEN CLOSE THE BROWSER (FS-70, phase 1
// of a REAL page reload driven by tools/smoke/reload.mjs).
//
//   node tools/smoke/reload.mjs --url=http://127.0.0.1:5477/ \
//     --setup=probes/chestsave.js
//
// WHAT IT IS FOR. A chest is the first buildable whose whole value is the state
// it holds. A drill that came back empty is annoying; a chest that came back
// empty has DESTROYED inventory the player deliberately put somewhere safe,
// which is the worst thing a save can do to somebody. The contents cross three
// separate seams on the way to a reloaded world and every one of them can drop
// them silently:
//
//   1. `commitPlan`'s `carry[].store`, because `recreate()` destroys every
//      container in the base and a commit runs on EVERY placement anywhere,
//   2. `Persist`'s `store?: [item, count]` row, which reads the LIVE container,
//   3. `FactoryRestore`'s `r.store?.[0] ?? 0`, which is the only thing that puts
//      the pair back on the plan for the commit that follows it.
//
// Only a REAL reload crosses all three in boot order. `of.save()` then
// `of.load()` inside one page cannot: by then the container already exists, so a
// restore that read nothing would be overwritten by a commit that carried
// everything, and the run would pass while describing nothing. That is DW-17's
// argument for this runner and it applies to a chest more sharply than to
// anything else in the slot.
//
// THIS IS A SETUP PROBE and asserts nothing about what comes back: it drives the
// world up to the moment of the reload and publishes `chest: {item, count}`,
// which reload.mjs re-measures on the far side. Both halves of the pair are
// published, and the ITEM matters as much as the count: a container claims its
// type from whatever arrives first and RELEASES it when emptied (FS-66), so a
// restore that brought 35 nameless units back would leave the chest free to be
// re-typed by the next inserter to reach it, and a count-only assertion would be
// green for it.
//
// STANDING RULE 11: NOTHING HERE IS HAND-WRITTEN. The chest comes out of the
// real build menu with the real B key and a real click on its real tile, it goes
// down through the real ghost and the real use key, the panel is opened by
// aiming the real crosshair at it, and the items are put in by clicking the
// panel's own Load button, which is `loadChest` and `of_net_container_insert`.
// Nothing in this file touches `storeItem` or `storeCount`, because those two
// fields are exactly what the proof is about: writing them here would be the
// harness reaching past the code it is supposed to be testing.
//
// MODE: SANDBOX, which reload.mjs boots anyway. Placement is then never refused
// for materials, so a failure here is about chests and never about a pack.
(async () => {
  const of = window.__of;
  if (!of) return { valid: false, why: 'no __of' };
  if (typeof of.buildMenu !== 'function') return { valid: false, why: 'no of.buildMenu' };
  const sleep = (n) => of.run(n);
  const fails = [];
  const log = [];
  const check = (name, ok, detail) => {
    if (ok !== true) fails.push(detail === undefined ? name : `${name}: ${detail}`);
    return ok === true;
  };
  const fac = () => of.game().factory;
  const rowOf = (id) => fac().list.find((b) => b.id === id) ?? null;
  /** How many Load presses. 5 a press (`MachineChest.LOAD_STEP`), so 7 presses
   *  is 35: a number no default, no cap and no round guess can produce by
   *  accident. A count of 40 or 100 coming back would be indistinguishable from
   *  a stock capacity or a coincidence; 35 is not. */
  const LOADS = 7;
  const PER_LOAD = 5;

  // --- WALKING AND AIMING, assembler.js's, verbatim and for its own reasons ---
  // The observer's yaw lives in a local tangent frame and cannot be computed
  // from body-frame coordinates without re-deriving that frame here, so a
  // heading is MEASURED by minimising the aim ray's perpendicular miss against a
  // known point. The `u <= 0` guard is load bearing: perpendicular distance to a
  // LINE does not care which way along it the target lies, so without it a
  // heading 180 degrees wrong scores exactly as well as the right one.
  const gd = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const eye = () => of.aim().origin;
  const missTo = (t) => {
    const a = of.aim();
    const v = sub(t, a.origin);
    const u = dot(v, a.dir);
    if (u <= 0) return Infinity;
    return Math.hypot(v[0] - a.dir[0] * u, v[1] - a.dir[1] * u,
      v[2] - a.dir[2] * u);
  };
  const aimAtPoint = (t) => {
    let y = of.world().observer.yawDeg;
    let p = -20;
    for (const step of [16, 4, 1, 0.3]) {
      let bestM = Infinity; let by = y; let bp = p;
      for (let a = -6; a <= 6; ++a) {
        for (let b = -6; b <= 6; ++b) {
          of.look(y + a * step, Math.max(-88, Math.min(20, p + b * step)));
          const m = missTo(t);
          if (m < bestM) { bestM = m; by = y + a * step; bp = p + b * step; }
        }
      }
      y = by; p = Math.max(-88, Math.min(20, bp));
    }
    of.look(y, p);
    return [y, p];
  };
  // The burst is SIZED TO THE GAP (machineports.js's rule): the walker moves at
  // 4.6 m/s, so a flat 60-frame hold covers four and a half metres and fired at
  // a target three metres out it lands the player past it.
  const walkTo = async (pt, stopM) => {
    aimAtPoint(pt);
    let d = gd(eye(), pt);
    for (let i = 0; i < 20 && d > stopM; ++i) {
      const frames = Math.max(5, Math.min(60,
        Math.round(((d - stopM * 0.7) / 4.6) * 60)));
      of.input.tape([{ hold: frames, keys: ['KeyW'] }, { hold: 2, keys: [] }]);
      await sleep(1.1);
      aimAtPoint(pt);
      d = gd(eye(), pt);
    }
    of.input.tape([{ hold: 2, keys: [] }]);
    await sleep(0.2);
    return +d.toFixed(2);
  };
  /**
   * Put whatever is in hand down somewhere, and say WHERE the eye was aimed.
   *
   * STEEP PITCHES FIRST, and that is not taste: `FactoryGhost.march` stops the
   * aim ray at the ground, so a shallow pitch lands the ghost tens of metres
   * away. The first run of this probe placed its chest at pitch -18 and then
   * could not open it, because `PICK_REACH_M` is 3.5 m and the box was well
   * outside it. Sweeping down-to-up puts the thing within arm's reach whenever
   * the ground underfoot will take it, and only walks the ray out when it
   * will not.
   */
  const sweepPlace = async (countFn) => {
    const yawStart = of.world().observer.yawDeg;
    for (let t = 0; t < 8; ++t) {
      const yaw = yawStart + t * 45;
      for (let p = -76; p <= -16; p += 2) {
        of.look(yaw, p);
        await sleep(0.05);
        const g = of.build().ghost;
        if (g === null || g.ok !== true) continue;
        const n0 = countFn();
        of.input.tape([{ hold: 3, actions: ['use'] }, { hold: 5, keys: [] }]);
        await sleep(0.35);
        if (countFn() > n0) return [yaw, p];
      }
    }
    return null;
  };

  await sleep(0.8);
  check('this run is SANDBOX', of.game().mode.sandbox === true,
    JSON.stringify(of.game().mode));

  // ======================================================================
  // 1. A CHEST IN HAND, OUT OF THE BUILD MENU (GP-110)
  // ======================================================================
  // The player's own route, and the ONLY one: a chest is not on the starting
  // bar, and `Hotbar.isPart` does not list 'chest' either, so `of.assignSlot`
  // refuses it. That omission is a real defect in its own right and is not this
  // probe's subject: `isPart` is also the guard `Hotbar.restore` puts every
  // SAVED slot through, so a bar slot holding a chest is turned into an empty
  // slot on the next reload, which is GP-109's gun bug one kind later. It is
  // reported up rather than asserted here, because a chest's CONTENTS are what
  // this file is about.
  const opts = { bubbles: true, pointerId: 1, pointerType: 'mouse', button: 0 };
  // RE-QUERIED between the down and the click, buildmenu.js's rule: the menu
  // rebuilds its body when its key moves, and an element captured before the
  // hold is detached by the frame that lands during it.
  const pick = async (id) => {
    const sel = `#of-build .of-btile[data-build="${id}"]`;
    const down = document.querySelector(sel);
    if (down === null) return false;
    down.dispatchEvent(new PointerEvent('pointerdown', opts));
    await sleep(0.11);
    (document.querySelector(sel) ?? down).click();
    await sleep(0.4);
    return true;
  };
  of.input.act(['build'], 4);
  await sleep(0.45);
  const menuIds = (of.buildMenu() ?? { rows: [] }).rows.map((r) => r.id);
  if (!check('the build menu lists a chest', menuIds.includes('chest'),
    menuIds.join(','))) {
    return { valid: false, why: 'no chest row in the build menu', fails, log };
  }
  const picked = await pick('chest');
  if (of.buildMenu().open === true) { of.escape(); await sleep(0.3); }
  check('clicking the tile puts a chest in hand',
    picked === true && of.build().selected === 'chest',
    `${picked} / ${String(of.build().selected)}`);

  // ======================================================================
  // 2. THE CHEST GOES DOWN
  // ======================================================================
  // The sweep is damagesave.js's: pitch the eye down until the REAL ghost says
  // `ok`, then press the REAL use key, and believe nothing until the plan grew a
  // chest row. A 4 m footprint (FS-68) needs more clear ground than a belt, so
  // the sweep also turns, rather than giving up on the first heading.
  const chestsIn = () => fac().list.filter((b) => b.kind === 'chest');
  const yaw0 = of.world().observer.yawDeg;
  const placedAt = await sweepPlace(() => chestsIn().length);
  const chest = chestsIn()[0] ?? null;
  if (chest === null) {
    return { valid: false, why: 'no chest would go down anywhere in the clearing',
      ghost: of.build().ghost, fails, log };
  }
  const CH = chest.id;
  log.push(`chest #${CH} at ${chest.cell}, build ${chest.build}, `
    + `placed looking ${JSON.stringify(placedAt)}`);
  check('the placed chest is a real /core container', chest.build >= 0,
    String(chest.build));
  // AN EMPTY, UNTYPED CHEST BEFORE ANYTHING GOES IN, and it is asserted rather
  // than assumed. Without it, "the chest came back holding 35 stone" cannot be
  // told apart from "the chest was always holding 35 stone", which is the same
  // hole assembler.js's unset-machine block exists to close.
  check('a fresh chest is EMPTY and UNTYPED',
    Array.isArray(chest.store) && chest.store[0] === 0 && chest.store[1] === 0,
    JSON.stringify(chest.store));

  // ======================================================================
  // 3. SOMETHING TO PUT IN IT
  // ======================================================================
  // Stone, harvested off the world's own rock nodes through `of.harvest`, which
  // is `Interact.harvestNow`: the pack fills the way it fills in play. The ITEM
  // ID is then read off the pack rather than written down here, so a renumbered
  // registry moves the probe with it instead of silently testing item 4.
  for (const n of of.nodes()) {
    if (n.kind !== 1) continue;
    for (let k = 0; k < 30; ++k) of.harvest(n.index);
    const got = of.game().carried.find((c) => c.name === 'Stone');
    if ((got?.count ?? 0) >= LOADS * PER_LOAD + PER_LOAD) break;
  }
  const stone = of.game().carried.find((c) => c.name === 'Stone') ?? null;
  if (stone === null || stone.count < LOADS * PER_LOAD) {
    return { valid: false, why: 'not enough stone in the pack to fill a chest',
      carried: of.game().carried, fails, log };
  }
  const ITEM = stone.item;
  log.push(`pack holds ${stone.count} ${stone.name} (item ${ITEM})`);

  // ======================================================================
  // 4. THE PANEL, OPENED BY LOOKING AT THE BOX
  // ======================================================================
  of.hotbar(1);
  await sleep(0.25);
  // WALKED UP TO, then aimed. `PICK_REACH_M` is 3.5 m and it is one number for
  // everything the crosshair resolves, so standing off is not a matter of
  // degrees: a chest three and a half metres away is not aimable at any angle.
  const standOff = await walkTo(rowOf(CH).pos, 2.6);
  let aimed = false;
  {
    const [y0, p0] = aimAtPoint(rowOf(CH).pos);
    for (let a = -6; a <= 6 && !aimed; ++a) {
      for (let b = -6; b <= 6 && !aimed; ++b) {
        of.look(y0 + a * 1.4, Math.max(-88, Math.min(15, p0 + b * 1.4)));
        await sleep(0.03);
        aimed = (of.game().aimed?.build?.id ?? -1) === CH;
      }
    }
  }
  log.push(`walked to ${standOff} m of the chest, aimed ${aimed}`);
  check('the crosshair reaches the chest', aimed,
    JSON.stringify(of.game().aimed));
  of.input.act(['use'], 4);
  await sleep(0.5);
  const s0 = of.game().screen;
  check('the panel opened ON THE CHEST',
    s0.open === true && s0.of === 'chest',
    JSON.stringify({ open: s0.open, of: s0.of }));
  check('and an empty chest reads EMPTY rather than IDLE', s0.status === 'EMPTY',
    String(s0.status));

  // ======================================================================
  // 5. SEVEN PRESSES OF THE PANEL'S OWN LOAD BUTTON
  // ======================================================================
  // The DOM button, not `loadChest` and not `containerInsert`. `data-load` is
  // the ItemId (`FurnacePanel`), so the button is found by the id the pack
  // published and never by reading a label back off the screen.
  const loadBtn = () => document.querySelector(`#of-furnace [data-load="${ITEM}"]`);
  check('the panel offers a Load button for the stone', loadBtn() !== null,
    [...document.querySelectorAll('#of-furnace [data-load]')]
      .map((e) => e.getAttribute('data-load')).join(','));
  let presses = 0;
  for (let k = 0; k < LOADS; ++k) {
    const b = loadBtn();
    if (b === null) break;
    b.dispatchEvent(new MouseEvent('click',
      { bubbles: true, cancelable: true, view: window }));
    presses++;
    await sleep(0.22);
  }
  const WANT = presses * PER_LOAD;
  log.push(`${presses} Load presses at ${PER_LOAD} a press, so ${WANT} expected`);

  // ======================================================================
  // 6. WHAT IS REALLY IN IT, READ TWICE BY TWO ROUTES
  // ======================================================================
  // The PANEL (`chestPanelView`, which reads `containerCount`) and the REPORT
  // ROW (`FactoryReport.row.store`, which reads the same container by a path the
  // panel has never touched). Two readings rather than one because the whole
  // question after the reload is "did the container come back", and a probe that
  // only ever asked the panel would be asking the same object twice.
  const s1 = of.game().screen;
  const panelCount = s1.output?.count ?? -1;
  const row0 = rowOf(CH);
  const store0 = Array.isArray(row0?.store) ? row0.store : [-1, -1];
  log.push(`panel says ${panelCount}, plan row says ${JSON.stringify(store0)}, `
    + `status "${s1.status}", progress "${s1.progressText}"`);
  check('the chest took exactly what was put in it',
    panelCount === WANT && store0[1] === WANT, `${panelCount} / ${store0[1]}, `
    + `wanted ${WANT}`);
  check('and it CLAIMED THE TYPE of what went in', store0[0] === ITEM,
    `${store0[0]}, wanted ${ITEM}`);
  check('a chest holding something reads STORING', s1.status === 'STORING',
    String(s1.status));
  // NOT a round number, and not the capacity, or the assertion on the far side
  // could be satisfied by a default. 35 against a 300 cap.
  check('the count is neither zero nor the capacity',
    WANT > 0 && WANT % 10 !== 0, String(WANT));
  of.escape();
  await sleep(0.4);

  // ======================================================================
  // 7. A COMMIT BETWEEN THE FILL AND THE SAVE
  // ======================================================================
  // ONE BELT TILE, laid somewhere else entirely, and it is here on purpose: a
  // commit rebuilds the whole network from the plan and `recreate()` destroys
  // every container in it, so this is the exact gesture that would empty every
  // chest in the base if `commitPlan`'s `carry[].store` were not carrying them.
  // Reid will lay a belt between filling a chest and quitting; the save being
  // tested is the one written after he does.
  of.hotbar(4);
  await sleep(0.25);
  const rebuilds0 = fac().rebuilds;
  const beltAt = await sweepPlace(() => fac().buildings);
  of.hotbar(1);
  await sleep(0.25);
  log.push(`the belt went down looking ${JSON.stringify(beltAt)}`);
  check('a belt was laid, so a commit really ran', beltAt !== null,
    JSON.stringify(of.build().ghost));
  const rowAfterCommit = rowOf(CH);
  const store1 = Array.isArray(rowAfterCommit?.store)
    ? rowAfterCommit.store : [-1, -1];
  log.push(`after ${fac().rebuilds - rebuilds0} rebuild(s) the chest holds `
    + `${JSON.stringify(store1)}`);
  check('a REBUILD of the network did not empty the chest',
    store1[0] === ITEM && store1[1] === WANT,
    `${JSON.stringify(store1)}, wanted ${JSON.stringify([ITEM, WANT])}`);

  // ======================================================================
  // 8. THE SLOT, WRITTEN NOW
  // ======================================================================
  // A slow look around first, so the DISCOVERY field reload.mjs asserts on for
  // every setup has something in it: this probe never flies and never walks far,
  // and a setup that satisfied its own assertion while failing the runner's
  // shared ones would be a harness lying about a harness (DW-20).
  for (let a = 0; a < 360; a += 45) {
    of.look(yaw0 + a, -6);
    await sleep(0.12);
  }
  const saved = await of.save();
  log.push(`saved: ${JSON.stringify(saved)}`);
  const saves = of.game().persist.saves;
  check('the slot was written', saves > 0, String(saves));
  check('and it was not refused',
    (of.game().persist.saveInhibit?.refused ?? 0) === 0,
    JSON.stringify(of.game().persist.saveInhibit));

  const rowFinal = rowOf(CH);
  const storeFinal = Array.isArray(rowFinal?.store) ? rowFinal.store : [-1, -1];
  return {
    valid: fails.length === 0,
    fails,
    log,
    // The rows reload.mjs asserts for EVERY setup.
    saves,
    buildings: fac().buildings,
    // THE BEFORE HALF. reload.mjs re-measures both numbers on the far side of
    // the reload and will not accept one without the other.
    chest: { id: CH, item: storeFinal[0], count: storeFinal[1],
      cell: rowFinal?.cell ?? '', build: rowFinal?.build ?? -1 },
    expected: { item: ITEM, count: WANT, presses, perLoad: PER_LOAD },
    panelCount,
    rebuilds: fac().rebuilds - rebuilds0,
    saved,
  };
})()
