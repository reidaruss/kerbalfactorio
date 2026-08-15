// THE CONTROLS ACCEPTANCE (GP-25 to GP-27), and the belt alignment measurement.
//
//   node tools/smoke/run.mjs --scenario=walk \
//        --evalfile=tools/smoke/probes/controls.js
//
// Five claims, and every one of them is asserted as a NEGATIVE as well as a
// positive, because each of these changes is easy to fake:
//
//   ESCAPE closes every modal that EXISTS. The list is read out of the live
//   registry (`__of.modals()`), not written here, and an entry with no opener
//   FAILS the probe. That is the whole point: a menu added next month that
//   forgot to join the stack cannot pass this quietly.
//
//   THE WHEEL moves the equipped slot, and left click then does what THAT slot
//   holds. The load-bearing half is the negative: with the bare hand selected a
//   click must place NOTHING, and with a drill selected off the ore it must
//   place nothing either. A build that simply placed on every click would pass
//   the positive test on its own.
//
//   E INTERACTS AND DOES NOT HARVEST. Asserted at a node that a left click
//   demonstrably does harvest, one line later, so "E granted nothing" cannot be
//   explained away by there being nothing to grant.
//
//   A HOLD-DRAG lays a run the factory sim treats as ONE transport line. Tile
//   count is not the assertion; `runs.length === 1` is, because visually
//   adjacent belts that are not chained is precisely the bug being fixed.
//
//   BELTS LINE UP, measured the way the structures lane measured foundations:
//   the TANGENTIAL separation of consecutive tiles against the module. The full
//   3D distance is deliberately not the number, because a belt follows the
//   ground and a slope legitimately adds rise; what must be exact is the
//   spacing in the tangent plane, and that is what used to be 0.59 to 1.02 m
//   against a 1.00 m tile.
//
// DW-20: `ticks` first, so none of the numbers below are trusted until the
// simulation is shown to have advanced.
(async () => {
  const of = window.__of;
  const sleep = (n) => of.run(n);
  const act = async (names, frames = 6, secs = 0.3) => {
    of.input.act(names, frames);
    await sleep(secs);
  };
  const V = (a) => Math.hypot(a[0], a[1], a[2]);
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const eye = () => of.aim().origin;
  const fails = [];
  const check = (name, ok, detail) => {
    if (!ok) fails.push(detail === undefined ? name : `${name}: ${detail}`);
    return ok;
  };

  await sleep(1.2);
  const t0 = of.world().tick;
  const log = [];

  // ======================================================================
  // F. HOLD LEFT CLICK: ONE DRAG, ONE RUN, AND THE TILES LINE UP
  // ======================================================================
  // ONE press, held while the player WALKS, which is how a long belt actually
  // gets laid: the crosshair sweeps the ground continuously and the drag has to
  // fill in every cell it crosses. Nothing else is pressed but W.
  await act(['slot4'], 4, 0.25);
  check('a belt is in hand', of.hotbar().part === 'belt', String(of.hotbar().part));
  const beltsBefore = of.game().factory.list.filter((r) => r.kind === 'belt').length;
  of.look(of.world().observer.yawDeg, -32);
  await sleep(0.2);
  // ONE tape for the whole gesture. Two tapes would put a released frame
  // between them, which is a second PRESS and not a hold, and the drag would
  // restart instead of continuing.
  of.input.tape([{ hold: 3000, actions: ['use', 'forward'] }]);
  await sleep(0.05);
  const afterFirstFrame = of.game().factory.list.filter((r) => r.kind === 'belt').length;
  await sleep(2.95);
  of.input.tape([{ hold: 10, keys: [] }]);
  await sleep(0.5);

  const f = of.game().factory;
  const belts = f.list.filter((r) => r.kind === 'belt');
  const laid = belts.length - beltsBefore;
  const beltRuns = f.runs.filter((r) => r.tiles > 1);

  // --- THE ALIGNMENT NUMBER ------------------------------------------------
  // Consecutive tiles, in the order the drag laid them. Separation is split
  // into the TANGENT-PLANE component (which must be the module, exactly) and
  // the radial rise (which is the terrain and is allowed to be anything).
  // The MACHINE tile, not the structural cell. They share the site FRAME and
  // not the cell SIZE: DW-32 took a foundation from 1 m to 4 m and a belt tile
  // is still the 1.00 m the mesh ships, so reading `module.cellM` here would
  // assert belts are laid on foundations. See MACHINE_TILE_M.
  const module = 1.0;
  const seq = belts.slice(beltsBefore);
  const gaps = [];
  for (let i = 1; i < seq.length; ++i) {
    const a = seq[i - 1].pos, b = seq[i].pos;
    const d = sub(b, a);
    const ra = V(a), rb = V(b);
    let up = [a[0] / ra + b[0] / rb, a[1] / ra + b[1] / rb, a[2] / ra + b[2] / rb];
    const ul = V(up);
    up = [up[0] / ul, up[1] / ul, up[2] / ul];
    const rise = dot(d, up);
    const tang = Math.hypot(d[0] - up[0] * rise, d[1] - up[1] * rise,
      d[2] - up[2] * rise);
    gaps.push({ tangentialM: tang, riseM: rise, errorM: Math.abs(tang - module) });
  }
  const worstGapM = gaps.length === 0 ? null
    : Math.max(...gaps.map((g) => g.errorM));

  // And the LATTICE the machines used to snap to, measured the same way, so the
  // report carries the before as well as the after rather than citing it.
  const e = eye();
  const latticeStepsM = [[1, 0, 0], [0, 1, 0], [0, 0, 1]].map((d) => {
    const p0 = of.latticeCell(e[0], e[1], e[2]);
    const p1 = of.latticeCell(e[0] + d[0], e[1] + d[1], e[2] + d[2]);
    return +V(sub(p1, p0)).toFixed(4);
  });

  check('the drag laid several tiles', laid >= 4, `${laid} tiles`);
  // The PRESS lays exactly one. Everything after it is the hold, which is the
  // distinction the whole feature turns on: a build that placed one tile per
  // tick regardless would put down 180 of them in three seconds.
  check('one press, one tile', afterFirstFrame - beltsBefore === 1,
    `${afterFirstFrame - beltsBefore} in the first three ticks`);
  check('the whole drag is ONE transport line', beltRuns.length === 1
    && beltRuns[0].tiles === laid,
    `runs ${JSON.stringify(f.runs.map((r) => r.tiles))} for ${laid} tiles`);
  check('consecutive tiles are one module apart',
    worstGapM !== null && worstGapM < 1e-3, `worst ${worstGapM}`);

  // Turn away from the run just laid, so nothing below aims at a belt.
  of.look(of.world().observer.yawDeg + 150, -12);
  await sleep(0.3);

  // ======================================================================
  // A. THE WHEEL MOVES THE EQUIPPED SLOT
  // ======================================================================
  const startSlot = of.hotbar().selected;
  const bar = of.hotbar().slots.length;
  of.input.wheel(3);
  await sleep(0.15);
  const afterUp = of.hotbar().selected;
  of.input.wheel(-3);
  await sleep(0.15);
  const afterDown = of.hotbar().selected;
  // And the number keys are the direct-select path.
  await act(['slot4'], 4, 0.2);
  const afterKey = of.hotbar();
  const wheel = {
    slots: bar,
    start: startSlot,
    afterWheelUp3: afterUp,
    afterWheelDown3: afterDown,
    expectedUp: ((startSlot - 1 + 3) % bar) + 1,
    afterSlot4Key: afterKey.selected,
    slot4Holds: afterKey.part,
  };
  check('wheel moves the slot', afterUp === wheel.expectedUp,
    `${startSlot} -> ${afterUp}, wanted ${wheel.expectedUp}`);
  check('the wheel comes back', afterDown === startSlot);
  check('a number key selects directly', afterKey.selected === 4);

  // ======================================================================
  // B. THE BARE HAND USES A TOOL AND PLACES NOTHING
  // ======================================================================
  await act(['slot1'], 4, 0.2);
  const handHeld = of.hotbar();
  const b0 = of.game().factory.buildings;
  const v0 = of.voxels();
  of.look(of.world().observer.yawDeg, -78);        // at the ground
  await sleep(0.2);
  await act(['use'], 8, 0.6);
  const v1 = of.voxels();
  const b1 = of.game().factory.buildings;
  const hand = {
    holding: handHeld.kind,
    cellsDugByAClick: v1 === null || v0 === null ? null : v1.removedCells - v0.removedCells,
    buildingsBefore: b0,
    buildingsAfter: b1,
  };
  check('the bare hand is what slot 1 holds', handHeld.kind === 'hand', handHeld.kind);
  check('a click with the bare hand DIGS',
    hand.cellsDugByAClick !== null && hand.cellsDugByAClick > 0,
    `${hand.cellsDugByAClick} cells`);
  check('a click with the bare hand places NOTHING', b1 === b0, `${b0} -> ${b1}`);

  // ======================================================================
  // C. THE WRONG SLOT DOES NOT PLACE THE WRONG THING
  // ======================================================================
  // A drill off the ore is refused by name, and the click builds nothing. This
  // is the negative that says the hand, and not the click, decides.
  await act(['slot3'], 4, 0.25);
  of.look(of.world().observer.yawDeg, -30);
  await sleep(0.25);
  const drillGhost = of.build().ghost;
  const c0 = of.game().factory.buildings;
  await act(['use'], 6, 0.4);
  const c1 = of.game().factory.buildings;
  const drill = {
    inHand: of.hotbar().part,
    ghostOk: drillGhost === null ? null : drillGhost.ok,
    ghostReason: drillGhost === null ? null : drillGhost.reason,
    buildings: [c0, c1],
    refusals: of.build().refusals,
  };
  const drillRefused = drillGhost !== null && !drillGhost.ok;
  check('a drill was in hand', drill.inHand === 'miner', String(drill.inHand));
  if (drillRefused) {
    check('a refused drill builds nothing', c1 === c0, `${c0} -> ${c1}`);
  } else {
    log.push('the drill ghost was VALID here (ore under the crosshair), '
      + 'so the refusal half of C was not exercised');
  }

  // ======================================================================
  // D. E OPENS A FURNACE, AND E DOES NOT HARVEST
  // ======================================================================
  // Stock the pack the way a player does, then craft, then place from slot 2.
  let harvests = 0;
  for (const n of of.nodes()) {
    if (n.kind !== 0 && n.kind !== 3 && n.kind !== 2) continue;
    for (let k = 0; k < 3; ++k) if (of.harvest(n.index).ok) harvests++;
    if (harvests > 26) break;
  }
  const crafted = of.craft(2);
  await act(['slot2'], 4, 0.25);
  of.look(of.world().observer.yawDeg, -22);
  await sleep(0.2);
  const machinesBefore = of.game().machines.length;
  await act(['use'], 6, 0.5);
  const machinesAfter = of.game().machines.length;
  // AIM AT WHERE IT ACTUALLY LANDED, not at where the placement was expected to
  // put it: the machine reports its own position, so a probe that misses it is
  // reporting a miss rather than a broken key.
  const placedMachine = of.game().machines[of.game().machines.length - 1];
  if (placedMachine !== undefined) {
    const want = placedMachine.pos;
    let bestYaw = of.world().observer.yawDeg;
    let bestPitch = -22;
    let best = -2;
    for (let y = bestYaw - 24; y <= bestYaw + 24; y += 3) {
      for (let pi = -50; pi <= 5; pi += 3) {
        of.look(y, pi);
        const a = of.aim();
        const v = sub(want, a.origin);
        const l = V(v) || 1;
        const k = dot(a.dir, [v[0] / l, v[1] / l, v[2] / l]);
        if (k > best) { best = k; bestYaw = y; bestPitch = pi; }
      }
    }
    of.look(bestYaw, bestPitch);
    await sleep(0.2);
  }
  check('slot 2 holds the furnace', of.hotbar().kind === 'furnace', of.hotbar().kind);
  check('a click placed the furnace', machinesAfter > machinesBefore,
    `${machinesBefore} -> ${machinesAfter}`);

  // E opens it. And the grant counter must NOT move, which is the half that
  // says E stopped being harvest.
  const grantsBeforeE = of.game().interact.grants;
  await act(['interact'], 6, 0.5);
  const openedByE = of.game().furnaceOpen;
  const grantsAfterE = of.game().interact.grants;
  check('E opened the furnace', openedByE);
  check('E granted nothing', grantsAfterE === grantsBeforeE,
    `${grantsBeforeE} -> ${grantsAfterE}`);

  // ======================================================================
  // E. ESCAPE CLOSES EVERY MODAL THAT EXISTS
  // ======================================================================
  // The list is READ, not written. An entry this probe does not know how to
  // open is a FAILURE, so a new menu cannot slip past the guarantee.
  const openers = {
    pack: async () => { await act(['pack'], 4, 0.35); },
    // The furnace is already open from D, and re-aiming at it is what a player
    // would do; opening it again here would toggle it shut.
    furnace: async () => {
      if (of.game().furnaceOpen) return;
      await act(['interact'], 6, 0.4);
    },
    hand: async () => { await act(['slot4'], 4, 0.25); },
    // W8. The assembly bay is a MODE with a key of its own, not a slot, so it
    // opens with `assembly` (C) rather than through the hotbar. It is in this
    // table because the derivation above is the enforcement: a menu that joins
    // the modal stack and cannot be opened here FAILS, which is exactly how
    // this entry came to be written.
    vab: async () => { await act(['assembly'], 4, 0.4); },
    // W11 PROGRESSION SCREENS, and their absence from this table was the
    // derivation catching a real gap rather than a probe being out of date:
    // `research`, `power` and `equip` joined the modal stack when H-5 gave them
    // ACTIONS, and until these three lines existed nothing anywhere proved
    // Escape shut any of them. That is the whole argument for reading the list
    // instead of writing it (GP-25), and it is the reachability point in
    // miniature: a panel that exists is not a panel a player can get to.
    research: async () => { await act(['research'], 4, 0.35); },
    power: async () => { await act(['power'], 4, 0.35); },
    equip: async () => { await act(['equipment'], 4, 0.35); },
    // W12 THE MAP. It is a flight map and REFUSES to open on foot, which is a
    // deliberate refusal and not a failure, so this opener has to get the
    // player into a vessel first. `controls.js` runs on the ground with no
    // rocket built, so it cannot: the entry exists to keep the derivation's
    // guarantee honest, and it says out loud which condition it is standing
    // in for rather than reporting a pass it did not earn.
    map: async () => {
      if (of.flight === undefined) return;
      if (of.flight('report').aboard !== true) return;   // refused on foot
      await act(['map'], 4, 0.4);
    },
    // GP-100. THE GAME MENU, and it is the one entry here that opens with the
    // SAME key that closes it, because with nothing else open Escape IS its
    // opener (ModalStack.whenNothingOpen). So the loop below opens it with
    // `cancel` and then closes it with `cancel`, which is a stricter test than
    // any other row in this table gets: a fallback that opened the menu without
    // registering it as a modal would open it here and never close it.
    pause: async () => { await act(['cancel'], 4, 0.35); },
    // GP-111. THE BUILD MENU, on B. Its absence from this table when it landed
    // was the derivation catching a real gap within the hour, exactly as the
    // three progression screens' absence did: a menu that joins the stack and
    // cannot be opened here FAILS, so nothing can quietly escape the guarantee.
    build: async () => { await act(['build'], 4, 0.4); },
  };
  const escapeRows = [];
  for (const entry of of.modals().modals) {
    const open = openers[entry.name];
    if (open === undefined) {
      fails.push(`modal "${entry.name}" exists and this probe cannot open it, `
        + 'so Escape is unproven for it');
      escapeRows.push({ modal: entry.name, opened: null, closedByEscape: null });
      continue;
    }
    await open();
    // A modal whose opener could not run in THIS probe's world is skipped
    // rather than counted as opened. `probes/maneuver.js` is where the map's
    // own Escape is proven, aboard a vessel in orbit, and it asserts it.
    if (entry.name === 'map'
        && of.modals().modals.find((m) => m.name === 'map').open !== true) {
      escapeRows.push({ modal: 'map', opened: false, closedByEscape: null,
        note: 'needs a vessel; proven in probes/maneuver.js' });
      continue;
    }
    const wasOpen = of.modals().modals.find((m) => m.name === entry.name).open;
    of.escape();
    await sleep(0.35);
    const nowOpen = of.modals().modals.find((m) => m.name === entry.name).open;
    escapeRows.push({ modal: entry.name, opened: wasOpen, closedByEscape: wasOpen && !nowOpen,
      escapeDid: of.game().controls.lastEscape });
    check(`Escape closes ${entry.name}`, wasOpen && !nowOpen,
      `open ${wasOpen} -> ${nowOpen}`);
  }
  // With nothing open and nothing in hand, Escape still does something sensible
  // rather than nothing: it gives the pointer back, which is what the browser
  // was going to do anyway and what this handler deliberately does not fight.
  of.escape();
  await sleep(0.3);
  const idleEscape = of.game().controls.lastEscape;
  check('Escape with nothing open is not a no-op', idleEscape !== '', idleEscape);
  // GP-100 CHANGED WHAT THAT SENSIBLE THING IS, and the comment above is kept
  // because it is still the answer in a client with no pause menu: the fallback
  // is a hook on the stack and an unclaimed one leaves the old behaviour
  // untouched. Where the menu exists, it opens, which is asserted here rather
  // than left to `idleEscape !== ''` -- a fallback that had quietly stopped
  // doing anything would still write a sentence.
  const idleOpened = typeof of.pause === 'function' ? of.pause().open : null;
  check('and where the game menu exists, that is what it opens',
    idleOpened === null || idleOpened === true,
    `${idleEscape} -> pause open ${idleOpened}`);
  // Shut it again, or every section below this one runs behind a modal that
  // owns the pointer and swallows the world verbs.
  if (idleOpened === true) { of.escape(); await sleep(0.3); }
  check('and it shuts again on the next press',
    typeof of.pause !== 'function' || of.pause().open === false);

  // ======================================================================
  // G. ONLY THE HAND SWINGS AND DIGS
  // ======================================================================
  // "no PART in hand" is not the same question as "the HAND in hand", and the
  // difference was a real bug: a hand furnace is not a part, so holding the
  // button with the furnace slot selected placed the furnace and then dug a
  // crater under it for as long as the button was held.
  const holdAndMeasure = async (slot) => {
    of.hotbar(slot);
    await sleep(0.2);
    of.look(of.world().observer.yawDeg, -70);
    await sleep(0.2);
    const v = of.voxels();
    const b = of.game().factory.buildings;
    of.input.tape([{ hold: 140, actions: ['use'] }]);
    await sleep(2.2);
    of.input.tape([{ hold: 5, keys: [] }]);
    await sleep(0.3);
    return { cells: of.voxels().removedCells - v.removedCells,
      built: of.game().factory.buildings - b };
  };
  of.assignSlot(9, 'empty');
  const digs = {
    furnaceSlot: await holdAndMeasure(2),
    emptySlot: await holdAndMeasure(9),
    handSlot: await holdAndMeasure(1),
  };
  check('a furnace held down does not dig', digs.furnaceSlot.cells === 0,
    `${digs.furnaceSlot.cells} cells`);
  check('an empty slot does nothing at all',
    digs.emptySlot.cells === 0 && digs.emptySlot.built === 0,
    `${digs.emptySlot.cells} cells, ${digs.emptySlot.built} built`);
  // The two negatives above only mean something because this positive holds.
  check('the hand held down DOES dig', digs.handSlot.cells > 0,
    `${digs.handSlot.cells} cells`);

  // ======================================================================
  // H. THE LOADOUT IS PLAYER STATE AND SURVIVES A RELOAD
  // ======================================================================
  of.assignSlot(1, 'wall');
  of.assignSlot(2, 'hand');
  of.hotbar(5);
  await sleep(0.2);
  const barSaved = of.hotbar();
  await of.save();
  // SCRAMBLE IT before loading. A restore that "worked" because the live bar
  // still held the answer is the classic false pass.
  of.assignSlot(1, 'hand');
  of.assignSlot(2, 'furnace');
  of.hotbar(1);
  await sleep(0.2);
  const barScrambled = of.hotbar();
  const ledger = await of.load();
  await sleep(0.3);
  const barLoaded = of.hotbar();
  const bar2 = {
    saved: [barSaved.selected, barSaved.slots[0].label, barSaved.slots[1].label],
    scrambled: [barScrambled.selected, barScrambled.slots[0].label,
      barScrambled.slots[1].label],
    loaded: [barLoaded.selected, barLoaded.slots[0].label, barLoaded.slots[1].label],
    restored: ledger === null ? null : ledger.hotbarRestored,
  };
  check('the bar was really scrambled before the load',
    barScrambled.slots[0].kind === 'hand' && barScrambled.selected === 1);
  check('the loadout came back', barLoaded.selected === barSaved.selected
    && barLoaded.slots[0].part === 'wall' && barLoaded.slots[1].kind === 'hand',
    JSON.stringify(bar2));

  const ticks = of.world().tick - t0;
  check('the simulation advanced', ticks > 900, `${ticks} ticks`);

  return {
    valid: fails.length === 0,
    fails,
    advanced: { ticks, harvests, craftedFurnace: crafted },
    wheel,
    hand,
    drill,
    interact: {
      furnaceOpenedByE: openedByE,
      grantsAcrossE: [grantsBeforeE, grantsAfterE],
      eIsNotHarvest: grantsAfterE === grantsBeforeE,
    },
    escape: {
      modalsDeclared: of.modals().modals.map((m) => m.name),
      rows: escapeRows,
      withNothingOpen: idleEscape,
      closedByEscape: of.modals().closedByEscape,
    },
    digs,
    bar: bar2,
    drag: {
      tilesLaid: laid,
      runs: f.runs.map((r) => r.tiles),
      isOneRun: beltRuns.length === 1 && beltRuns[0].tiles === laid,
    },
    alignment: {
      moduleM: module,
      // THE NUMBER. Worst deviation of a tile-to-tile tangential separation
      // from the module, over the whole run.
      worstTangentialErrorM: worstGapM === null ? null : +worstGapM.toExponential(3),
      // The residual drift is geometry, not slop: a radial projection scales
      // tangential spacing by the local ground radius, and this run descends
      // 0.19 m a tile, which is 3.1e-7 of 600 km per tile.
      tangentialM: gaps.map((g) => +g.tangentialM.toFixed(9)),
      riseM: gaps.map((g) => +g.riseM.toFixed(4)),
      // What a machine used to snap to: one unit step of a /core cell key, per
      // body axis, in metres of GROUND. A 1.00 m tile on this is the defect.
      oldLatticeStepsM: latticeStepsM,
      oldWorstErrorM: +Math.max(...latticeStepsM.map((s) => Math.abs(s - module)))
        .toFixed(4),
    },
    cost: { draw: of.stats().draw, frameMs: of.stats().frameMs },
    log,
  };
})()
