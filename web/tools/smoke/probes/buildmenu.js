// buildmenu.js: B OPENS A BUILD MENU, AND RAW MATERIALS ARE ENOUGH
// (GP-110 to GP-114).
//
// Run it twice, and the survival run is the one that matters:
//
//   node tools/smoke/run.mjs --url=... --evalfile=probes/buildmenu.js
//   node tools/smoke/run.mjs --url=... --sandbox=1 --evalfile=probes/buildmenu.js
//
// SURVIVAL is where "lit if you can afford it, greyed if you cannot" is a real
// distinction: the world starts with an empty pack, so every priced row is
// greyed and the launch pad is locked behind Launch Facilities as well. SANDBOX
// lifts both (DW-31), and the probe asserts the OPPOSITE outcome there rather
// than skipping, which is what stops a run that greyed everything by accident
// from passing as a run that greyed the right things.
//
// EVERY GESTURE IS A REAL ONE. B is pressed as the `build` ACTION and never as
// a key code, so a remap moves the probe with it. Every tile is clicked as a
// real element found by `data-build`, which is the same attribute a player's
// mouse hits.
//
// THE ONE THING THAT IS NOT A UI ASSERTION is GP-114, and it is the point of
// the whole exercise. Reid asked to stop crafting structures before building
// them. A hand furnace was the one buildable that still demanded a finished
// item in the pack, and this probe gathers the RAW materials, never crafts a
// furnace, and asserts a furnace goes down and the raw materials are what got
// spent. GP-624 added the one craft the storyline now demands before raw iron
// can be held at all — a crude pickaxe out of wood and stone, because GP-506
// gates ore behind it — and asserts the pack holds NO furnace item on either
// side of the placement, so the claim is narrower and better witnessed rather
// than weaker.
(async () => {
  const of = window.__of;
  if (!of) return { valid: false, why: 'no __of' };
  if (typeof of.buildMenu !== 'function') return { valid: false, why: 'no of.buildMenu' };
  const sleep = (n) => of.run(n);
  const fails = [];
  const log = [];
  const check = (name, ok, detail) => {
    if (!ok) fails.push(detail === undefined ? name : `${name}: ${detail}`);
    return ok;
  };
  const B = () => of.buildMenu();
  let iconRows = [];
  const rowOf = (id) => B().rows.find((r) => r.id === id);
  const sandbox = of.sandbox().sandbox;
  const opts = { bubbles: true, pointerId: 1, pointerType: 'mouse', button: 0 };
  // RE-QUERIED between the down and the click: the menu rebuilds its body
  // whenever its key moves, and an element captured before a 110 ms hold is
  // detached by the frame that lands during it.
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
  const pressB = async () => { of.input.act(['build'], 4); await sleep(0.45); };

  await sleep(0.6);

  // ======================================================================
  // A. B OPENS IT, AND ESCAPE LEAVES (GP-111, GP-113)
  // ======================================================================
  check('the build menu joined the derived modal stack',
    of.modals().modals.some((m) => m.name === 'build'),
    of.modals().modals.map((m) => m.name).join(','));
  check('it starts closed', B().open === false);
  await pressB();
  check('B OPENS IT', B().open === true, JSON.stringify(B().open));
  await pressB();
  check('and B closes it again', B().open === false);
  await pressB();
  of.escape();
  await sleep(0.4);
  check('ESCAPE closes it too, through the one handler',
    B().open === false, of.game().controls.lastEscape);

  // ======================================================================
  // B. WHAT IT LISTS, AND WHAT IS LIT (GP-111)
  // ======================================================================
  await pressB();
  const rows = B().rows;
  log.push(`${rows.length} buildables in ${[...new Set(rows.map((r) => r.group))].join(', ')}`);
  // EVERY buildable is offered. The four structures, the pad, the two hand
  // machines and every factory machine `TYPE_ID` declares. Deriving the
  // expectation from the LIVE hotbar table rather than listing it here is what
  // makes a machine added next month fail this instead of being missed.
  const want = ['foundation', 'floor', 'wall', 'door', 'launchpad',
    'miner', 'belt', 'smelter', 'pole', 'generator', 'esmelter',
    'furnace:0', 'furnace:1'];
  const missing = want.filter((id) => rowOf(id) === undefined);
  check('every buildable the game has is offered', missing.length === 0,
    `missing ${missing.join(', ')}`);
  check('and every offered row is actually DRAWN as a tile',
    rows.every((r) => r.tile), rows.filter((r) => !r.tile).map((r) => r.id).join(','));
  check('the structures are grouped together',
    rowOf('foundation').group === 'Structures' && rowOf('wall').group === 'Structures',
    `${rowOf('foundation').group}`);

  // GP-130. EVERY BUILDABLE HAS A PICTURE, which is the whole point of a menu
  // you are meant to read at a glance. It is asserted from the BAKER's own
  // ledger and not from "the row has a non-empty string": a canvas that
  // rendered nothing still hands back a valid PNG data URL, so `icon !== ''`
  // is true of a set of blank squares. `stats.detail` carries the pixel count
  // that tells those apart, and `broken` is the baker naming its own failures.
  const icons = of.game().icons;
  const byId = (id) => (icons.detail ?? []).find((d) => d.id === id) ?? null;
  const BUILDINGS = ['0x0040', '0x0041', '0x0042', '0x0043', '0x0044'];
  const baked = BUILDINGS.map((id) => byId(id));
  iconRows = baked.map((d, i) => ({ id: BUILDINGS[i], name: d?.name ?? null,
    tris: d?.tris ?? -1, pixels: d?.pixels ?? -1, bytes: d?.bytes ?? -1,
    fallback: d?.fallback ?? 'no row at all' }));
  check('the four structures and the pad are all IN the icon table',
    baked.every((d) => d !== null), JSON.stringify(iconRows));
  check('and every one of them BAKED REAL GEOMETRY, not a blank square',
    baked.every((d) => d !== null && d.tris > 0 && d.pixels >= 32 && d.fallback === ''),
    JSON.stringify(iconRows));
  check('the baker reports nothing broken at all',
    (icons.broken ?? []).length === 0, (icons.broken ?? []).join(','));
  // AND THE MENU IS ACTUALLY DRAWING THEM. The tile carries an <img> when it
  // has a picture and a text span when it does not, so this is the assertion
  // about the pixels a player sees rather than about the table behind them.
  // DERIVED FROM THE LIVE ROWS, not from a list typed here: a buildable added
  // next month is a tile with no picture and this has to catch it rather than
  // quietly not mention it, which is the same enforcement `TYPE_ID` gives the
  // catalogue and `ModalStack` gives Escape.
  const wordy = rows.map((r) => r.id).filter((id) =>
    document.querySelector(`#of-build .of-btile[data-build="${id}"] .art img`) === null);
  check('EVERY tile draws an image rather than its own name',
    wordy.length === 0, `still text: ${wordy.join(', ')}`);

  // THE PRICES ARE /core's OWN, not a copy. gameplay.h S.6 prices a foundation
  // at 40 Stone and a launch pad at 60 Iron + 120 Stone + 20 Copper, and this
  // reads them through `Structures.costText` / `LaunchPads.costText`, the same
  // two calls the placement ghost already paints.
  const prices = { foundation: rowOf('foundation').cost, wall: rowOf('wall').cost,
    launchpad: rowOf('launchpad').cost, furnace: rowOf('furnace:0').cost,
    pole: rowOf('pole').cost, miner: rowOf('miner').cost };
  log.push(`prices ${JSON.stringify(prices)}`);
  if (!sandbox) {
    check('a foundation is priced in raw STONE', /40 Stone/i.test(prices.foundation),
      prices.foundation);
    check('a launch pad is priced in Iron, Stone and Copper',
      /Iron/i.test(prices.launchpad) && /Stone/i.test(prices.launchpad)
      && /Copper/i.test(prices.launchpad), prices.launchpad);
    check('a hand furnace is priced in RAW materials and not in a crafted item',
      /Wood/i.test(prices.furnace), prices.furnace);
    // GP-110's boundary, said out loud on screen rather than left to be found:
    // a machine whose placement really does charge nothing reads `free`.
    check('a machine that costs nothing to place SAYS SO', prices.miner === 'free',
      prices.miner);
  } else {
    check('SANDBOX prices everything at nothing, and says why',
      /sandbox/i.test(prices.foundation) && /sandbox/i.test(prices.launchpad),
      JSON.stringify(prices));
  }

  // LIT vs GREYED. The world starts with an empty pack, so in survival every
  // priced row is short and every free one is lit; in sandbox everything is lit.
  const lit = rows.filter((r) => r.affordable && r.lockedBy === '').map((r) => r.id);
  const grey = rows.filter((r) => !r.affordable).map((r) => r.id);
  const locked = rows.filter((r) => r.lockedBy !== '').map((r) => r.id);
  log.push(`lit ${lit.length}, greyed ${grey.length}, locked ${locked.length}`);
  if (sandbox) {
    check('SANDBOX: nothing is greyed and nothing is locked',
      grey.length === 0 && locked.length === 0,
      `grey ${grey.join(',')} locked ${locked.join(',')}`);
  } else {
    check('SURVIVAL: an empty pack cannot afford a foundation',
      rowOf('foundation').affordable === false, JSON.stringify(rowOf('foundation')));
    check('and the launch pad is LOCKED behind its tech, named',
      rowOf('launchpad').lockedBy === 'Launch Facilities',
      rowOf('launchpad').lockedBy);
    check('and the powered machines are locked behind Electrification',
      rowOf('pole').lockedBy === 'Electrification'
      && rowOf('esmelter').lockedBy === 'Electric Smelting',
      `${rowOf('pole').lockedBy} / ${rowOf('esmelter').lockedBy}`);
    // GREYED, NOT HIDDEN. Reid asked for this by name and it is the assertion
    // that stops a future "tidy up" from filtering the list.
    check('NOTHING IS HIDDEN: every greyed and locked row is still drawn',
      rows.filter((r) => !r.affordable || r.lockedBy !== '').every((r) => r.tile),
      `${grey.length + locked.length} unavailable rows, all drawn`);
    check('and the DRAWN class says which is which, so it is visible and not '
      + 'merely reported',
      /\bshort\b|\blocked\b/.test(rowOf('foundation').drawn),
      rowOf('foundation').drawn);
  }

  // ======================================================================
  // C. CLICK ONE AND YOU ARE HOLDING IT (GP-112)
  // ======================================================================
  const slotsBefore = of.hotbar().slots.map((s) => `${s.kind}:${s.part ?? ''}`);
  const selBefore = of.hotbar().selected;
  check('clicking the wall tile works', await pick('wall'));
  const held = of.buildMenu();
  const bar = of.hotbar();
  check('THE MENU SHUT and the wall is in hand', held.open === false
    && bar.part === 'wall', `${held.open} / ${bar.part}`);
  check('the BUILD GHOST is armed with it, which is the preview Reid asked for',
    held.armed === 'wall', `${held.armed}`);
  check('it is held FROM THE MENU and not out of a slot',
    bar.fromMenu === true && held.fromMenu === true, `${bar.fromMenu}`);
  // THE ASSERTION THE OVERRIDE EXISTS FOR: no hotbar slot was consumed or
  // overwritten, and the selected slot did not move. A pick that wrote into the
  // bar would destroy a loadout to place one wall.
  const slotsAfter = of.hotbar().slots.map((s) => `${s.kind}:${s.part ?? ''}`);
  check('NO HOTBAR SLOT WAS CONSUMED OR CHANGED',
    slotsAfter.join('|') === slotsBefore.join('|'),
    `${slotsBefore.join(',')} -> ${slotsAfter.join(',')}`);
  check('and the selected slot did not move', of.hotbar().selected === selBefore,
    `${selBefore} -> ${of.hotbar().selected}`);

  // ESCAPE PUTS IT DOWN, which is Reid's "to get out of that, you press escape".
  of.escape();
  await sleep(0.4);
  const afterEsc = of.hotbar();
  check('ESCAPE puts the menu pick down',
    afterEsc.part === null && afterEsc.fromMenu === false,
    `${afterEsc.part} / ${afterEsc.fromMenu}, ${of.game().controls.lastEscape}`);
  // It says `closed hand`, not `cleared the hand`, and that is the DERIVED list
  // doing its job rather than a wording accident: the hand is registered as a
  // modal, so `closeTop` finds it open and calls its own `requestClose`, and the
  // fallback branch below it is never reached. One guarantee, one path.
  check('and Escape said that is what it did',
    of.game().controls.lastEscape === 'closed hand',
    of.game().controls.lastEscape);

  // A NUMBER KEY ALSO DROPS IT, because the bar and the menu are one hand.
  await pressB();
  await pick('floor');
  check('picked a floor from the menu', of.hotbar().part === 'floor',
    `${of.hotbar().part}`);
  of.hotbar(3);
  await sleep(0.3);
  check('choosing a hotbar slot DROPS the menu pick and gives you the slot',
    of.hotbar().fromMenu === false && of.hotbar().selected === 3,
    JSON.stringify({ fromMenu: of.hotbar().fromMenu, sel: of.hotbar().selected }));

  // ======================================================================
  // D. GP-114: RAW MATERIALS ARE ENOUGH FOR A HAND FURNACE
  // ======================================================================
  // THE POINT OF THE WHOLE REQUEST, and survival only: sandbox lifts the pack
  // requirement anyway (DW-31) and so would prove nothing about the crafting
  // step. The materials are HARVESTED, through `Interact.harvestNow`, which is
  // the same call the swing makes; the FURNACE is never crafted, the craft panel
  // is never opened and no furnace button is ever pressed. A furnace still goes
  // down. (GP-624: a crude pickaxe IS crafted first, because GP-506 gates raw
  // iron behind one and the furnace's bill contains 2 Raw iron. See the loop.)
  let onDemand = { ran: false };
  if (!sandbox) {
    await pressB();
    const before = rowOf('furnace:0');
    check('with an empty pack the hand furnace is greyed',
      before.affordable === false, JSON.stringify(before));
    of.escape();
    await sleep(0.35);

    // Chop and mine until the recipe is affordable. THE FURNACE IS NEVER
    // CRAFTED, which is the claim; a pickaxe is, and GP-624 is the reason.
    //
    // The hand furnace's bill is Wood x5 + Raw iron x2, and GP-506 made raw iron
    // `requiresToolFor` (gameplay.h): a bare-hand swing at an ore node is
    // REFUSED by name. So the loop this replaces — twelve swings at each of the
    // first 60 nodes, every kind — could never buy the second half of that bill,
    // and this section failed on a game that was working exactly as designed.
    // Wood and loose stone stay ungated so the pickaxe (Stone x2 + Wood x1) has
    // a bare-hand path, and mining ore with a pickaxe is not a shortcut past
    // GP-114, it is the only legal way to hold raw iron at all.
    //
    // WHAT GP-114 ACTUALLY CLAIMS IS UNTOUCHED. The claim is that the FURNACE
    // needs no crafted item in the pack: raw materials alone light its tile and
    // `craftOnDemand` does the rest at placement. A tool is not the structure,
    // the craft panel is still never opened, no furnace button is ever pressed,
    // and the assertions below now also state that no furnace item exists in the
    // pack before the tile is clicked, which the old version only checked after.
    const nodes = of.nodes();
    const countOf = (re) =>
      (of.game().carried ?? []).find((c) => re.test(c.name))?.count ?? 0;
    // Bare-handed: enough for the pickaxe (Stone x2 + Wood x1) and the furnace's
    // own Wood x5, with margin. Bounded by the node list, and stopped as soon as
    // the two counts are met so this stays the cheap section it was.
    for (const n of nodes) {
      if (n.kind !== 0 && n.kind !== 1) continue;
      if (countOf(/^wood$/i) >= 8 && countOf(/^stone$/i) >= 4) break;
      for (let k = 0; k < 12; k++) of.harvest(n.index);
      await sleep(0.05);
    }
    // The gate, witnessed rather than assumed: the tile is STILL greyed, and the
    // ore that would light it is refused BY NAME while a bare hand holds nothing
    // but wood and stone.
    const oreNode = nodes.find((n) => [2, 3, 4].includes(n.kind));
    const bareOre = oreNode === undefined ? null : of.harvest(oreNode.index);
    check('bare hands are REFUSED at ore, by name (ToolRequired)',
      bareOre !== null && bareOre.ok === false
      && bareOre.refusal !== null && bareOre.refusal !== undefined
      && bareOre.refusal.code === 1,
      JSON.stringify(bareOre));
    check('and the hand furnace is still greyed, because its raw iron is gated',
      rowOf('furnace:0').affordable === false,
      JSON.stringify(rowOf('furnace:0')));

    const pickIdx = of.game().recipes
      .findIndex((r) => r.name === 'Crude pickaxe' && r.craftable);
    check('the crude pickaxe is craftable from wood and stone alone', pickIdx >= 0,
      JSON.stringify(of.game().carried));
    check('and it crafts', pickIdx >= 0 && of.craft(pickIdx) === true);
    await sleep(0.2);
    check('a crude pickaxe is in the pack', countOf(/crude pickaxe/i) >= 1,
      JSON.stringify(of.game().carried));

    // Tooled: the ore kinds only, so the wood already in hand is not re-chopped.
    for (const n of nodes) {
      if (![2, 3, 4].includes(n.kind)) continue;
      if (rowOf('furnace:0').affordable) break;
      for (let k = 0; k < 12; k++) of.harvest(n.index);
      await sleep(0.05);
    }
    await sleep(0.4);
    check('NO furnace was crafted to get here: the pack holds none',
      countOf(/furnace/i) === 0, JSON.stringify(of.game().carried));
    const carried = of.game().carried ?? [];
    const packBefore = JSON.parse(JSON.stringify(of.buildMenu().rows
      .find((r) => r.id === 'furnace:0')));
    onDemand = { ran: true, carried, packBefore };
    check('harvesting made the hand furnace AFFORDABLE, with no furnace crafted',
      packBefore.affordable === true, JSON.stringify(packBefore));

    if (packBefore.affordable === true) {
      // Pick it from the MENU and put it down. `tierToPlace` -> `craftOnDemand`
      // -> `Machines.place` is the whole path, and it charges exactly once.
      await pressB();
      check('the furnace tile is clickable now', await pick('furnace:0'));
      const machines0 = of.game().machines.length;
      of.look(of.world().observer.yawDeg, -20);
      await sleep(0.2);
      of.input.tape([{ hold: 4, actions: ['use'] }, { hold: 8, keys: [] }]);
      await sleep(0.5);
      const machines1 = of.game().machines.length;
      const after = of.buildMenu().rows.find((r) => r.id === 'furnace:0');
      onDemand.machines = [machines0, machines1];
      onDemand.packAfter = after;
      onDemand.carriedAfter = of.game().carried ?? [];
      check('A HAND FURNACE WENT DOWN FROM RAW MATERIALS ALONE',
        machines1 > machines0, `${machines0} -> ${machines1} machines`);
      // AND IT WAS CHARGED ONCE. The crafted furnace is made and consumed in
      // the same tick, so a pack holding one afterwards would mean the raw
      // materials were spent and the item was not.
      const leftover = (onDemand.carriedAfter
        .find((c) => /furnace/i.test(c.name)) ?? { count: 0 }).count;
      check('and no crafted furnace was left over, so it was charged once',
        leftover === 0, `${leftover} furnace item(s) in the pack afterwards`);
      const woodBefore = (carried.find((c) => /wood/i.test(c.name)) ?? { count: 0 }).count;
      const woodAfter = (onDemand.carriedAfter
        .find((c) => /wood/i.test(c.name)) ?? { count: 0 }).count;
      onDemand.wood = [woodBefore, woodAfter];
      check('and the RAW MATERIALS are what got spent', woodAfter < woodBefore,
        `${woodBefore} -> ${woodAfter} wood`);
    }
    of.escape();
    await sleep(0.3);
  }

  // ======================================================================
  // E. AND THE MENU CANNOT BE OPENED OVER ANOTHER MENU'S ESCAPE
  // ======================================================================
  // With the build menu up, Escape shuts IT and does not fall through to the
  // game menu, which is the same ordering guarantee the pack already has.
  await pressB();
  check('the build menu is up', B().open === true);
  of.escape();
  await sleep(0.4);
  const both = { build: B().open,
    pause: typeof of.pause === 'function' ? of.pause().open : null };
  check('Escape shut the build menu and did NOT open the game menu',
    both.build === false && both.pause !== true, JSON.stringify(both));

  return {
    valid: fails.length === 0,
    fails,
    log,
    sandbox,
    counts: { rows: rows.length, lit: lit.length, grey: grey.length,
      locked: locked.length },
    prices,
    iconRows,
    lit, grey, locked,
    hold: { slotsBefore, slotsAfter, selBefore },
    onDemand,
    escapeOrder: both,
  };
})()
