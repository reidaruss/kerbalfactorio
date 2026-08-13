// GP-533: THE SCANNING ANTENNA'S BUILD TRIGGERS A ONE-SHOT POI REVEAL. Survival.
//
//   npm --prefix web run build
//   npx --prefix web vite preview --host --port 4331
//   node web/tools/smoke/run.mjs --url=http://<lan>:4331/ --scenario=walk \
//     --width=640 --height=360 \
//     --evalfile=web/tools/smoke/probes/antenna.js
//
// LOW RENDER RATE THROUGHOUT, `probes/researchstation.js`'s own measured lesson
// (NUMBERS.md): the sim clock is unaffected, only wall clock is bought back.
//
// THE CLAIM, in the storyline's own order: build a research station (the
// technique is `probes/researchstation.js`'s, copied rather than re-derived),
// research the Scanning Antenna off it (no Electrification needed -- the tech
// has no prereq, on purpose: `research.h`'s own comment says the ruins this
// reveals are what unlocks electricity research, so gating the antenna ON
// Electrification would be the cycle GP-267 already refused for the pad), build
// the antenna, and the build reveals the near-spawn ruin: `of.sites().stats.
// known` goes 0 -> 1, a `ruin` marker appears in `of.markers()`, and the
// `antenna` checklist row (`sites.knownCount() > 0`, no new store) retires.
//
// NOTHING IS GRANTED: every ingot is mined by hand, smelted, and spent through
// the same buttons a player clicks, exactly as `researchstation.js` insists.
//
// THE NEGATIVE CONTROL IS FIRST, NOT LAST: before ANY antenna (or station)
// exists, the near-spawn ruin must read UNKNOWN and NO marker may be drawn --
// otherwise "the antenna revealed it" is equally true of a world that reveals
// everything by default.
//
// THE SAVE/RELOAD GAP, closed at the end (§8): everything above never left
// the live world, so `SaveSlot.antennas` restore (AntennaSave.ts, mirrors
// `LaunchPadSave.ts`) and the load-time marker rebuild (`MarkerRegistry`
// rebuilt from `Sites.known` via `rebuildRevealMarkers`, deliberately NOT
// persisted) were unprobed. `of.save()` / `of.load()`, `ruinplace.js`'s own
// technique, prove: the antenna instance comes back (count, position, the
// restore ledger's `antennas` row reads 1); the site is still known and its
// marker draws again, rebuilt rather than reloaded; the checklist row stays
// satisfied; and the reveal does NOT re-fire across the reload (known count
// unchanged, no double-grant -- a load must never grant).
(async () => {
  const of = window.__of;
  if (!of) return { valid: false, why: 'no __of' };
  if (typeof of.buildMenu !== 'function') return { valid: false, why: 'no of.buildMenu' };
  if (typeof of.antennas !== 'function') return { valid: false, why: 'no of.antennas' };
  if (typeof of.sites !== 'function') return { valid: false, why: 'no of.sites' };
  if (typeof of.markers !== 'function') return { valid: false, why: 'no of.markers' };
  const sleep = (n, hz = 30) => of.run(n, hz);
  const fails = [];
  const log = [];
  const check = (name, ok, detail) => {
    if (!ok) fails.push(detail === undefined ? name : `${name}: ${detail}`);
    return ok;
  };
  const step = (what) => console.log(`[probe] ${what}`);
  const press = async (action, frames = 6) => { of.input.act([action], frames); await sleep(0.35); };
  const click = (el) => {
    if (!el || el.disabled) return false;
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
    return true;
  };
  const tileClick = async (sel) => {
    const t = document.querySelector(sel);
    t?.dispatchEvent(new PointerEvent('pointerdown',
      { bubbles: true, pointerId: 1, pointerType: 'mouse', button: 0 }));
    await sleep(0.11);
    (document.querySelector(sel) ?? t)?.click();
    await sleep(0.4);
    return t !== null;
  };
  const pack = () => Object.fromEntries(of.game().carried.map((c) => [c.name, c.count]));
  const have = (n) => pack()[n] ?? 0;
  const G = () => of.game();
  const antennas = () => of.antennas();
  const stations = () => of.stations();
  const panelOpen = () => document.querySelector('#of-research')?.classList.contains('open') ?? false;
  const T_SCANNING_ANTENNA = 0x0017;
  const STATION_ID = 'researchstation';
  const ANTENNA_ID = 'scanningantenna';

  await of.run(1.0);

  // ======================================================================
  // 0. SETUP + THE NEGATIVE CONTROL, BEFORE ANYTHING EXISTS.
  // ======================================================================
  check('this run is SURVIVAL', G().mode.sandbox === false, JSON.stringify(G().mode));
  const an0 = antennas();
  check('the antenna layer is wired', an0 !== null && typeof an0 === 'object', JSON.stringify(an0));
  check('the world starts with NO antenna', an0.count === 0, an0.count);
  check('/core handed over a definition (item 0x0046)', an0.item === 0x0046, an0.item?.toString(16));
  check('and entity TypeId 0x46', an0.typeId === 0x46, an0.typeId?.toString(16));
  log.push(`antenna cost: "${an0.cost}"  mesh: ${an0.placeholderMesh}`);
  check('the price is quoted in SMELTED metal', /Iron/i.test(an0.cost) && /Copper/i.test(an0.cost), an0.cost);

  const s0 = of.sites();
  check('the site layer is wired', s0 !== null && s0.count >= 1, JSON.stringify(s0));
  check('NEGATIVE CONTROL: no site is known before any antenna exists',
    s0.stats.known === 0, JSON.stringify(s0.stats));
  const m0 = of.markers();
  check('NEGATIVE CONTROL: no marker is drawn either', m0.count === 0, JSON.stringify(m0));
  const goalsBefore = of.goals();
  const antennaRowBefore = goalsBefore.satisfied.find((r) => r.id === 'antenna');
  check('the checklist HAS the antenna row', antennaRowBefore !== undefined,
    goalsBefore.satisfied.map((r) => r.id).join(','));
  check('NEGATIVE CONTROL: and it reads unsatisfied', antennaRowBefore?.satisfied === false,
    JSON.stringify(antennaRowBefore));

  // ======================================================================
  // 1. EARN THE MATERIALS. `researchstation.js`'s own technique: bare-hand
  //    wood and stone, craft the pickaxe out of those alone, THEN mine the
  //    gated kinds (GP-624/GP-506).
  //
  //    THE BUDGET IS BIGGER THAN THE STATION PROBE'S, because this run pays
  //    for the station's own bill (Iron 20 / Copper 10 / Stone 30) AND the
  //    antenna's (Iron 25 / Copper 20 / Stone 15) AND up to ten Automation
  //    Science packs the crafting loop below may MAKE (2 Iron + 1 Copper
  //    each, up to 20 Iron / 10 Copper -- the loop stops once eight-plus are
  //    held, but a click already in flight can land one over): 65 Iron worst
  //    case, 40 Copper, 47 Stone. THE FIRST VERSION OF THIS FILE UNDER-BUDGETED
  //    BY MEASURING SPENT SCIENCE (8) RATHER THAN MADE SCIENCE (up to 12 with
  //    an uncapped loop): a driven run smelted 65 Iron, the loop happened to
  //    make 12 packs (24 Iron), and the antenna tile read `affordable: false`
  //    with 21 Iron in the pack against a 25 need -- four short, entirely a
  //    probe-budget miss and not a game defect. No Electrification is bought
  //    -- the antenna tech has no prereq, on purpose (see header).
  // ======================================================================
  const yaw = of.world().observer.yawDeg;
  const WANT = { Wood: 60, Stone: 65, Coal: 120, 'Raw iron': 115, 'Raw copper': 70 };
  const BARE = [0, 1];
  const GATED = [2, 3, 4];
  const KIND_ITEM = { 0: 'Wood', 1: 'Stone', 2: 'Coal', 3: 'Raw iron', 4: 'Raw copper' };
  const nodesOnce = of.nodes();
  let harvests = 0;
  const sweep = (kinds, want) => {
    for (const n of nodesOnce) {
      if (!kinds.includes(n.kind)) continue;
      const p = pack();
      if (!Object.entries(want).some(([k2, v]) => (p[k2] ?? 0) < v)) break;
      const item = KIND_ITEM[n.kind];
      if (item !== undefined && (p[item] ?? 0) >= (want[item] ?? 0)) continue;
      for (let k = 0; k < 6; ++k) if (of.harvest(n.index).ok) harvests++;
    }
  };
  step('harvesting wood and stone, bare-handed');
  sweep(BARE, { Wood: WANT.Wood, Stone: WANT.Stone });
  check('bare hands gathered wood', have('Wood') > 0, have('Wood'));
  check('and loose stone', have('Stone') > 0, have('Stone'));

  const pickIdx = of.game().recipes.findIndex((r) => r.name === 'Crude pickaxe' && r.craftable);
  check('the crude pickaxe is craftable from what bare hands gathered', pickIdx >= 0, JSON.stringify(pack()));
  check('and it crafts', pickIdx >= 0 && of.craft(pickIdx) === true);
  await sleep(0.2);
  check('a crude pickaxe is in the pack', have('Crude pickaxe') >= 1, JSON.stringify(pack()));

  step('harvesting the gated kinds, tooled');
  sweep(GATED, { Coal: WANT.Coal, 'Raw iron': WANT['Raw iron'], 'Raw copper': WANT['Raw copper'] });
  step(`harvested ${harvests} swings`);
  check('the clearing had enough raw iron', have('Raw iron') >= 90, have('Raw iron'));
  check('and enough raw copper', have('Raw copper') >= 55, have('Raw copper'));

  // ======================================================================
  // 2. SMELT IT. Furnace first (proves the primitive rung still works), then
  //    the hand smelter for the bulk, `researchstation.js`'s own §2b sequence:
  //    the placer standing there is demolished before the next one goes down,
  //    so the crosshair is never ambiguous between two machines.
  // ======================================================================
  check('the furnace recipe is still index 2', of.craft(2) === true);
  of.look(yaw, -18);
  await sleep(0.2);
  of.hotbar(2);
  await sleep(0.15);
  of.input.tape([{ hold: 4, actions: ['use'] }, { hold: 8, keys: [] }]);
  await sleep(0.4);
  check('the furnace went down', G().machines.length > 0);
  of.input.tape([{ hold: 4, actions: ['interact'] }, { hold: 10, keys: [] }]);
  await sleep(0.4);
  check('the furnace screen opened', G().furnaceOpen === true);

  const load = (m) => {
    const b = [...document.querySelectorAll('#of-furnace button[data-load]')]
      .find((x) => x.textContent.includes(m));
    if (b === undefined) return false;
    const before = have(m);
    b.click();
    return have(m) < before;
  };
  const take = () => document.querySelector('#of-furnace button[data-take]')?.click();
  const machineState = (tier) => (G().machines ?? []).find((m) => m.tier === tier)?.state ?? null;
  const smelt = async (ore, batches, tier = 0) => {
    for (let i = 0; i < batches; ++i) {
      if (!load('Coal') && !load('Wood')) return `no fuel would load, batch ${i}`;
      await sleep(0.05);
      if (!load(ore)) {
        return `the ${ore} load was REFUSED on batch ${i}: ${JSON.stringify(machineState(tier))}`;
      }
      let spun = 0;
      while ((machineState(tier)?.oreCount ?? 0) > 0 && spun < 30) { await sleep(1.5, 15); spun++; }
      if ((machineState(tier)?.oreCount ?? 0) > 0) return `batch ${i} never drained`;
      take();
      await sleep(0.2);
    }
    return '';
  };

  step('smelting the first iron on the furnace');
  const b0 = await smelt('Raw iron', 1);
  check('the first iron smelted', b0 === '', b0);
  of.input.tape([{ hold: 4, actions: ['interact'] }, { hold: 8, keys: [] }]);
  await sleep(0.3);
  check('the hand smelter was crafted', of.craft(3) === true, `iron ${have('Iron')} stone ${have('Stone')}`);

  of.look(yaw, -18);
  await sleep(0.3);
  of.input.act(['demolish'], 4);
  await sleep(0.4);
  check('the furnace came back up', G().machines.length === 0);

  const SMELTER_TILE = '#of-build .of-btile[data-build="furnace:1"]';
  of.input.act(['build'], 4);
  await sleep(0.45);
  check('the build menu offers the hand smelter', document.querySelector(SMELTER_TILE) !== null);
  await tileClick(SMELTER_TILE);
  of.look(yaw, -18);
  await sleep(0.2);
  of.input.tape([{ hold: 4, actions: ['use'] }, { hold: 8, keys: [] }]);
  await sleep(0.4);
  check('the SMELTER went down alone', G().machines.length === 1 && G().machines[0].tier === 1,
    JSON.stringify(G().machines.map((m) => m.tier)));
  of.input.tape([{ hold: 4, actions: ['interact'] }, { hold: 10, keys: [] }]);
  await sleep(0.4);
  check('the smelter screen opened and is aimed at', G().furnaceOpen === true && G().aimed.machine === 1,
    JSON.stringify(G().aimed));

  step('smelting the bulk of the iron');
  const bi = await smelt('Raw iron', 16, 1);
  check('iron smelted', bi === '', bi);
  step('smelting the copper');
  const bc = await smelt('Raw copper', 10, 1);
  check('copper smelted', bc === '', bc);
  of.input.tape([{ hold: 4, actions: ['interact'] }, { hold: 8, keys: [] }]);
  await sleep(0.3);
  log.push(`smelted: ${JSON.stringify(pack())}`);
  check('enough iron for the station, the antenna and the science',
    have('Iron') >= 80, have('Iron'));
  check('and enough copper', have('Copper') >= 48, have('Copper'));

  // ======================================================================
  // 3. BUILD THE STATION. Clear the smelter first, `researchstation.js`'s
  //    §3b reason: everything here lands 2.2 m ahead on one yaw.
  // ======================================================================
  of.look(yaw, -18);
  await sleep(0.3);
  of.input.act(['demolish'], 4);
  await sleep(0.4);
  check('the smelter came back up, clearing the ground', G().machines.length === 0);

  step('building the research station');
  of.input.act(['build'], 4);
  await sleep(0.45);
  const stationSel = `#of-build .of-btile[data-build="${STATION_ID}"]`;
  check('the station has a build-menu tile', document.querySelector(stationSel) !== null);
  await tileClick(stationSel);
  check('clicking the tile put a station in hand', G().hotbar.kind === 'station', JSON.stringify(G().hotbar));
  of.look(yaw, -18);
  await sleep(0.2);
  of.input.tape([{ hold: 4, actions: ['use'] }, { hold: 8, keys: [] }]);
  await sleep(0.5);
  const st1 = stations();
  check('THE STATION WENT DOWN', st1.count === 1, JSON.stringify(st1));

  const refused0 = G().progress.refusedResearch;
  await press('research');
  check('the tech tree now opens', panelOpen() === true, document.querySelector('#of-research')?.className);
  check('with nothing refused', G().progress.refusedResearch === refused0);
  await press('research');
  check('and it closes again before the pack opens', panelOpen() === false);

  // ======================================================================
  // 4. RESEARCH THE ANTENNA. No Electrification: the tech has no prereq.
  // ======================================================================
  step('crafting eight packs of Automation science');
  await press('pack');
  const rows = () => [...document.querySelectorAll('#of-panel .of-recipe')];
  const rowNamed = (t) => rows().find((e) => (e.querySelector('.nm')?.textContent ?? '').includes(t));
  const SCIENCE = 'Automation science';
  let made = 0;
  // STOPS AS SOON AS NINE ARE HELD (one over the tech's own eight), rather
  // than clicking a fixed count: the tech spends exactly eight, so every pack
  // made beyond a small margin is Iron and Copper the antenna's own bill was
  // budgeted against and does not get back (a real accounting miss the first
  // version of this file made -- see the header above the harvest budget).
  for (let i = 0; i < 12 && have(SCIENCE) < 9; ++i) {
    if (click(rowNamed(SCIENCE)?.querySelector('button'))) made++;
    await sleep(0.1);
  }
  const sci = have(SCIENCE);
  check('real DOM clicks made at least eight science packs', sci >= 8, `${made} clicks, ${sci} packs`);
  await press('pack');
  await sleep(0.2);

  await press('research');
  await sleep(0.3);
  check('the tech tree is up', panelOpen() === true);
  const btnFor = (id) => document.querySelector(`#of-research button[data-tech="${id}"]`);
  const antennaBtn = btnFor(T_SCANNING_ANTENNA);
  check('the Scanning Antenna tech has a button', antennaBtn !== null,
    [...document.querySelectorAll('#of-research button[data-tech]')]
      .map((b) => b.dataset.tech).join(','));
  const rBefore = G().progress.research;
  const bought = click(antennaBtn);
  await sleep(0.5);
  const rAfter = G().progress.research;
  check('the Research button took a real click', bought === true);
  check('THE SCANNING ANTENNA WAS RESEARCHED', rAfter.unlocked === rBefore.unlocked + 1,
    `${rBefore.unlocked} -> ${rAfter.unlocked}`);
  check('and exactly eight science was spent', have(SCIENCE) === sci - 8, `${sci} -> ${have(SCIENCE)}`);
  await press('research');
  await sleep(0.2);

  // ======================================================================
  // 5. THE BUILD MENU OFFERS IT, NOW UNLOCKED AND AFFORDABLE.
  // ======================================================================
  step('checking the build-menu tile');
  const B = () => of.buildMenu();
  const rowOf = (id) => B().rows.find((r) => r.id === id);
  of.input.act(['build'], 4);
  await sleep(0.45);
  const arow = rowOf(ANTENNA_ID);
  check('the antenna has a build-menu tile', arow !== undefined, B().rows.map((r) => r.id).join(','));
  check('it is unlocked now (research bought it)', arow?.lockedBy === '', JSON.stringify(arow));
  check('and affordable, with the metal smelted', arow?.affordable === true, JSON.stringify(arow));
  of.input.act(['build'], 4);   // shut the menu without picking anything yet
  await sleep(0.3);

  // ======================================================================
  // 6. BUILD IT, AT A DIFFERENT HEADING SO IT DOES NOT STAND WHERE THE
  //    STATION ALREADY DOES (pickAim resolves the nearer object first; this
  //    is about not testing an ambiguous crosshair, not about a placement
  //    refusal -- neither class checks the other's footprint).
  // ======================================================================
  const yaw2 = yaw + 50;
  of.look(yaw2, -14);
  await sleep(0.2);
  of.input.act(['build'], 4);
  await sleep(0.45);
  const antennaSel = `#of-build .of-btile[data-build="${ANTENNA_ID}"]`;
  await tileClick(antennaSel);
  check('clicking the tile put an antenna in hand', G().hotbar.kind === 'antenna', JSON.stringify(G().hotbar));
  check('and the menu shut', B().open === false);
  const before = pack();
  of.input.tape([{ hold: 4, actions: ['use'] }, { hold: 8, keys: [] }]);
  await sleep(0.5);
  const an1 = antennas();
  check('THE SCANNING ANTENNA WENT DOWN', an1.count === 1, JSON.stringify(an1));
  check('and it is solid', an1.list[0]?.solid === true, JSON.stringify(an1.list[0]));
  const after = pack();
  const spent = {};
  for (const k of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const d = (before[k] ?? 0) - (after[k] ?? 0);
    if (d !== 0) spent[k] = d;
  }
  log.push(`bill "${an0.cost}" -> spent ${JSON.stringify(spent)}`);
  check('iron, copper and stone were really spent',
    (spent.Iron ?? 0) > 0 && (spent.Copper ?? 0) > 0 && (spent.Stone ?? 0) > 0, JSON.stringify(spent));

  // ======================================================================
  // 7. THE REVEAL. `sites.knownCount()` (the checklist's own predicate) goes
  //    0 -> N, a `ruin` marker draws, and the checklist row retires.
  // ======================================================================
  step('checking the reveal');
  const s1 = of.sites();
  check('THE BUILD REVEALED AT LEAST ONE SITE', s1.stats.known >= 1,
    `${s0.stats.known} -> ${s1.stats.known}`);
  const m1 = of.markers();
  check('AND A MARKER NOW DRAWS', m1.count >= 1, JSON.stringify(m1));
  const ruinMarker = m1.rows.find((r) => r.kind === 'ruin');
  check('it is a RUIN marker, KNOWN', ruinMarker !== undefined && ruinMarker.known === true,
    JSON.stringify(m1.rows));
  check('with a real body-frame direction (not the origin)',
    ruinMarker !== undefined
    && Math.hypot(ruinMarker.dirBody[0], ruinMarker.dirBody[1], ruinMarker.dirBody[2]) > 0.99,
    JSON.stringify(ruinMarker));

  const goalsAfter = of.goals();
  const antennaRowAfter = goalsAfter.satisfied.find((r) => r.id === 'antenna');
  check('THE CHECKLIST ROW RETIRES', antennaRowAfter?.satisfied === true, JSON.stringify(antennaRowAfter));

  // A second build (idempotence check): revealing again must not duplicate.
  step('a second reveal must be idempotent, not duplicating');
  of.look(yaw, -18);
  await sleep(0.2);
  const knownBeforeSecond = of.sites().stats.known;
  const markersBeforeSecond = of.markers().count;
  // Re-run the reveal path directly: rebuild is exercised by a second antenna
  // placement only if materials remain, which this run does not guarantee, so
  // the idempotence claim is checked the honest way -- through the debug
  // surface's own `siteMarkKnown`, the SAME function `revealNearbySites` calls.
  const already = of.siteMarkKnown(0);
  check('marking an already-known site again returns false (idempotent)',
    already === false || of.sites().stats.known === knownBeforeSecond,
    `already=${already}, known ${knownBeforeSecond} -> ${of.sites().stats.known}`);
  check('and the marker count did not change', of.markers().count === markersBeforeSecond,
    `${markersBeforeSecond} -> ${of.markers().count}`);

  // ======================================================================
  // 8. SAVE / RELOAD. Nothing above this point ever left the live world:
  //    `SaveSlot.antennas` restore (AntennaSave.ts, `LaunchPadSave.ts`'s own
  //    shape) and the load-time marker rebuild (`MarkerRegistry` rebuilt
  //    from `Sites.known` via `rebuildRevealMarkers`, deliberately NOT
  //    persisted -- AntennaSave.ts's own header says so) are unexercised
  //    until now. `of.save()` / `of.load()`, `ruinplace.js`'s own §7
  //    technique: a bare `of.load()` on a world that has never been saved
  //    wipes nothing and would pass every check below for free, so the save
  //    has to actually happen first (DW-20, a claim needs a number).
  // ======================================================================
  step('saving, then loading, to prove the restore path rather than the live world');
  const knownBeforeSave = of.sites().stats.known;
  const markersBeforeSave = of.markers().count;
  const placementsBeforeSave = an1.placements;
  const antennaPosBeforeSave = an1.list[0]?.pos;
  const wrote = await of.save();
  check('the save that makes the load meaningful actually wrote',
    wrote !== null && wrote.refused === undefined, JSON.stringify(wrote));
  const ledger = await of.load();
  check('the load actually ran (a ledger came back)', ledger !== null, JSON.stringify(ledger));

  // THE ANTENNA INSTANCE CAME BACK: count and position, off the RESTORE
  // LEDGER's own `antennas` row (`AntennaSave.restoreAntennas`'s return
  // count, surfaced by `Persist.ts` as `antennas: restoredAntennas`), not
  // just the live count -- the ledger is the proof this exercised
  // `SaveSlot.antennas` rather than a load that happened to leave the world
  // untouched.
  check('the restore ledger reports exactly one antenna restored',
    ledger?.antennas === 1, JSON.stringify(ledger));
  const an2 = antennas();
  check('THE ANTENNA INSTANCE CAME BACK', an2.count === 1, JSON.stringify(an2));
  check('at the position it was built at',
    an2.list[0] !== undefined && antennaPosBeforeSave !== undefined
    && Math.hypot(an2.list[0].pos[0] - antennaPosBeforeSave[0],
                  an2.list[0].pos[1] - antennaPosBeforeSave[1],
                  an2.list[0].pos[2] - antennaPosBeforeSave[2]) < 0.05,
    JSON.stringify({ before: antennaPosBeforeSave, after: an2.list[0]?.pos }));
  check('and it is solid again', an2.list[0]?.solid === true, JSON.stringify(an2.list[0]));

  // THE SITE IS STILL KNOWN -- `poi.h`'s own state, saved and restored
  // through `poiAbi` directly (AntennaSave.ts's header: the antenna's
  // transform and the ruins it revealed are two different facts that happen
  // to share a cause) -- AND ITS MARKER DRAWS AGAIN, rebuilt from
  // `Sites.known` by `rebuildRevealMarkers`, which `Persist.ts` calls
  // unconditionally right after the poi bytes load. Neither the
  // `MarkerRegistry` singleton nor the site's known bit is itself
  // serialized twice; this is the proof the deliberate non-persistence
  // still produces the same drawable fact on the far side of a real load.
  const s2 = of.sites();
  check('THE SITE IS STILL KNOWN AFTER RELOAD', s2.stats.known === knownBeforeSave,
    `${knownBeforeSave} -> ${s2.stats.known}`);
  const m2 = of.markers();
  check('AND ITS MARKER DRAWS AGAIN, REBUILT RATHER THAN RELOADED',
    m2.count === markersBeforeSave, `${markersBeforeSave} -> ${m2.count}`);
  const ruinMarker2 = m2.rows.find((r) => r.kind === 'ruin');
  check('still a RUIN marker, KNOWN', ruinMarker2 !== undefined && ruinMarker2.known === true,
    JSON.stringify(m2.rows));

  // THE CHECKLIST ROW STAYS SATISFIED. It reads `sites.knownCount() > 0`
  // with no store of its own (header line 20), so it has nothing to lose
  // across a save/load that keeps the known count -- but a regression that
  // cleared the row on load, or that rebuilt it off the wrong body handle,
  // would only show up here.
  const goalsAfterReload = of.goals();
  const antennaRowAfterReload = goalsAfterReload.satisfied.find((r) => r.id === 'antenna');
  check('THE CHECKLIST ROW STAYS SATISFIED AFTER RELOAD',
    antennaRowAfterReload?.satisfied === true, JSON.stringify(antennaRowAfterReload));

  // THE REVEAL DID NOT RE-FIRE. `restoreAntennas` (AntennaSave.ts) never
  // calls `revealNearbySites` (GameplayActions.ts) -- only `placeAntenna`
  // does, on a real build -- so a load must never grant: the known count is
  // EXACTLY what it was going into the save, not merely "still >= 1", which
  // a double-grant would also satisfy.
  check('LOAD DID NOT RE-GRANT: known count is exactly what it was before the '
        + 'save/load, not merely still positive',
    s2.stats.known === knownBeforeSave && s2.stats.known === s1.stats.known,
    `known ${s1.stats.known} -> save/load -> ${s2.stats.known}`);
  check('and no antenna placement was replayed (the placements counter is unchanged)',
    an2.placements === placementsBeforeSave, `${placementsBeforeSave} -> ${an2.placements}`);

  return {
    valid: true,
    pass: fails.length === 0,
    fails,
    log,
    antennas: antennas(),
    stations: stations(),
    sites: { before: s0.stats, after: s1.stats, afterReload: s2.stats },
    markers: m1,
    goals: { before: antennaRowBefore, after: antennaRowAfter, afterReload: antennaRowAfterReload },
    reload: { wrote, ledger, antennas: an2, markers: m2 },
    mode: G().mode,
    carried: G().carried,
  };
})()
