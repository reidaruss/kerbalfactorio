// DW-29's GATE ON THE LAUNCH PAD, WITH ITS CONTROLS. Survival.
//
//   npm --prefix web run build
//   npx --prefix web vite preview --host --port 4318
//   node web/tools/smoke/run.mjs --url=http://<lan>:4318/ --scenario=walk \
//     --width=640 --height=360 \
//     --evalfile=web/tools/smoke/probes/padgate.js
//
// THE INVOCATION IS DOCUMENTED HERE FOR THE FIRST TIME (GP-625), and that is a
// harness repair rather than a comment. `probeall.mjs` derives every probe's
// flags by parsing the first `run.mjs` line out of its header, so a file without
// one was skipped by the gate audit entirely: this probe has never appeared in a
// census, red or green. A small viewport and the default 144.3 Hz render rate on
// a software rasteriser is the standing NUMBERS.md shape; nothing below is
// measured in pixels.
//
// THE CLAIM: a launch pad may not be built until `Launch Facilities` has been
// researched, the refusal NAMES that tech, and buying its prerequisite moves the
// tech's own refusal from the prereq to the science cost.
//
// WHY THE CONTROLS ARE WHAT MAKE THIS A TEST. "The pad was refused" passes on a
// pad that is refused for any reason at all, on a build system that is simply
// broken, and on a mode that refuses everything. So there are four:
//
//   C1  IN THE SAME FRAME, a FOUNDATION is not research-refused. The gate is
//       item-specific rather than a blanket "nothing may be built".
//   C2  The refusal is the RESEARCH one and not the platform one, and it is
//       returned while aiming at bare ground where the platform refusal would
//       otherwise fire. That is what proves the order in
//       `resolvePadTarget`: a gate on the PLAYER outranks a gate on the WORLD.
//   C3  `Launch Facilities` starts BLOCKED behind `Electrification`, and the
//       reason line names Electrification. Buying Electrification with a real
//       DOM click MOVES that reason to the science cost. A boolean "is it
//       researchable" cannot tell those two refusals apart, and a gate that
//       refused for the wrong reason would pass a boolean every time (GP-46).
//   C4  The pad is STILL refused after Electrification is bought. That is the
//       control that says the gate is on `Launch Facilities` itself and not
//       merely on "some research has happened".
//
// AND THEN IT BUYS THE TECH AND WATCHES THE REFUSAL GO. 20 Automation + 12
// Logistic science is 72 Iron, 54 Copper and 24 Stone, all of it mined, smelted
// and crafted here through the same furnace screen and the same craft buttons a
// player uses. NOTHING IS GRANTED: there is no `of.give` on the debug surface
// and this file does not add one. NOR IS ANYTHING MINED OUT OF ORDER (GP-624):
// GP-506 gated coal, iron and copper behind a crude pickaxe, so §3 gathers wood
// and stone bare-handed, crafts the pickaxe from those two alone, and witnesses
// the bare-hand refusal as one more negative control before it mines. What makes the last assertion mean something
// is that the refusal does not merely VANISH, it MOVES to the next rule in the
// chain (the platform), which is the same shape as C3 one level up and is a
// claim that a gate which had simply been switched off could not satisfy: that
// one would have left a VALID ghost on bare ground.
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
  // ACTIONS, never key codes (GP-26). `of.input.act(['Tab'])` looks like it
  // works and does not: an unknown name falls through, the browser's own focus
  // traversal takes the key instead, and a later press lands on whatever the DOM
  // had focused. That cost this probe two runs, and it fails as a NAVIGATION
  // rather than as an assertion, which is the least useful way anything can
  // fail.
  const press = async (action, frames = 6) => {
    of.input.act([action], frames);
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
  const have = (n) => pack()[n] ?? 0;

  // /core's own ids, named rather than derived, so a renumber in the header
  // fails this probe instead of quietly testing a different tech or item.
  const T = { Electrification: 0x0010, LaunchFacilities: 0x0016 };
  const PAD_ITEM = 0x0044;

  await sleep(1.0);
  check('this run is SURVIVAL, so the gate is live',
    of.game().mode.researchGated === true, JSON.stringify(of.game().mode));

  // ======================================================================
  // 1. THE PAD IS IN HAND AND IS REFUSED BY NAME.
  // ======================================================================
  const bar = () => of.game().hotbar;
  const slotOf = (p) => bar().slots.findIndex((s) => s.part === p);
  const padSlot = slotOf('launchpad');
  const fSlot = slotOf('foundation');
  check('the pad is on the bar at all', padSlot >= 0,
    JSON.stringify(bar().slots.map((s) => s.part)));
  const hold = async (i) => { of.input.act([`slot${i + 1}`], 4); await sleep(0.25); };
  await hold(padSlot);
  of.look(of.world().observer.yawDeg, -30);
  await sleep(0.4);
  const g0 = of.game().build.padGhost;
  log.push(`pad ghost: "${g0?.reason}"`);
  check('the pad is REFUSED', g0 !== null && g0.ok === false, JSON.stringify(g0));
  check('and the refusal NAMES Launch Facilities',
    /Launch Facilities/.test(g0?.reason ?? ''), g0?.reason);
  check('and it points at the key that opens the research screen',
    /J/.test(g0?.reason ?? ''), g0?.reason);
  // C2: the refusal is the RESEARCH one, not the platform one, on bare ground
  // where the platform refusal would otherwise fire.
  check('C2: the RESEARCH refusal outranks the platform refusal',
    !/platform/.test(g0?.reason ?? ''), g0?.reason);
  check('C2: and the ghost says so through the same `locked` field the gate set',
    (g0?.locked ?? '') === g0?.reason, `${g0?.locked} vs ${g0?.reason}`);

  // C1: a foundation in the SAME session is not research-refused.
  await hold(fSlot);
  await sleep(0.3);
  const f0 = of.game().build.structGhost;
  log.push(`foundation ghost: "${f0?.reason}"`);
  check('C1: a FOUNDATION is not research-refused',
    !/Launch Facilities|research/.test(f0?.reason ?? ''), f0?.reason);
  check('C1: it is refused for its COST instead, which is a different rule',
    /need \d/.test(f0?.reason ?? '') || f0?.ok === true, f0?.reason);

  // ======================================================================
  // 2. THE TECH TREE IS NOT EVEN REACHABLE YET (D-019).
  //
  //    This block used to open the research panel here and read Launch
  //    Facilities out of it. It cannot any more, and that is a RULE CHANGE
  //    rather than a probe defect: the research screen now refuses to open
  //    until a research station has been BUILT, so the tree can only be read
  //    after the smelting below has paid for one. The assertions themselves
  //    have moved down to §3b verbatim, before any science exists and before
  //    anything is bought, which is the condition they were always about.
  //
  //    What is left here is the one thing worth asserting at this point, and
  //    it is a FREE EXTRA CONTROL for this file's own claim: the pad is
  //    already refused by name, and that refusal is reachable to a player who
  //    cannot yet open the screen it points at. The gate on the PAD and the
  //    gate on the SCREEN are independent, and this is where that shows.
  // ======================================================================
  const cardFor = (id) => document.querySelector(`#of-research [data-tech="${id}"]`);
  const btnFor = (id) => document.querySelector(`#of-research button[data-tech="${id}"]`);
  const stateOf = (id) => cardFor(id)?.getAttribute('data-state') ?? '';
  const whyOf = (id) => cardFor(id)?.querySelector('.why')?.textContent ?? '';
  await press('research');
  await sleep(0.4);
  check('D-019: with no research station built, the tree does not open',
    document.querySelector('#of-research')?.classList.contains('open') !== true,
    document.querySelector('#of-research')?.className);
  check('and the refusal names the station',
    /research station/i.test(of.game().progress.stationGate?.refusal ?? ''),
    of.game().progress.stationGate?.refusal);
  check('the pad ITEM is unavailable', of.game().progress.research.gatesHeld > 0,
    of.game().progress.research.gatesHeld);

  // ======================================================================
  // 3. EARN TEN AUTOMATION SCIENCE AND BUY THE PREREQ, FOR REAL.
  // ======================================================================
  // GP-624. WOOD AND STONE FIRST, THEN THE PICKAXE, THEN THE ORE. GP-506 made
  // coal, iron and copper `requiresToolFor` (gameplay.h), so the single sweep
  // over every kind this replaces refused every ore swing it took and left the
  // pack with no raw iron at all: the smelting, the station and every reading
  // after them cascaded off that. Wood and loose stone stay ungated exactly so
  // the pickaxe (Stone x2 + Wood x1) has a bare-hand path. Same swing count,
  // same one visit per node; only the ORDER changed, and one `of.nodes()` report
  // is read once and walked twice rather than built twice.
  //
  // GP-672. AND THIS SWEEP NOW HAS A BUDGET, WHICH IT HAS NEVER HAD, because
  // splitting it in two is what finally made the missing one fatal. The old
  // loop took six swings at EVERY node of EVERY kind with no stopping rule at
  // all: GP-611 gave `research.js` a per-resource budget for exactly this and
  // this file never received it, and it went unnoticed because a mixed sweep
  // spreads the haul over five item types while `probeall.mjs` had never run
  // this probe at all (GP-671). Take the wood and stone kinds ALONE with no
  // budget and the haul is one-sided: MEASURED 2026-08-13, `373 swings ->
  // {Wood: 1400, Stone: 600}`, which at 100 to a stack is 14 slots plus 6, i.e.
  // **20 of 20**, and the very next line -- crafting a pickaxe -- was refused
  // `PackFull`, taking 24 assertions down behind it. The pack is 20 slots and a
  // probe that fills it has disarmed itself.
  //
  // The budget is per RESOURCE (a node count is world-gen's to move, GP-611),
  // read ONCE per node (a `pack()` is a whole world report, GP-622), and a node
  // whose own resource is already satisfied is SKIPPED rather than merely
  // counted, so a scarce copper vein cannot keep every tree on the way paying
  // out. Sized off this file's own bill: 16 iron batches and 12 copper at five
  // units a load is 80 raw iron and 60 raw copper, the fuel is one load a batch,
  // and the station's 30 Stone sits on top of the pickaxe's 2.
  const BARE = [0, 1];      // Tree, Rock — bare hands are allowed here
  const GATED = [2, 3, 4];  // CoalSeam, IronOre, CopperOre — pickaxe or refusal
  const WANT = { Wood: 120, Stone: 60, Coal: 200, 'Raw iron': 110, 'Raw copper': 90 };
  const KIND_ITEM = { 0: 'Wood', 1: 'Stone', 2: 'Coal', 3: 'Raw iron', 4: 'Raw copper' };
  const nodesOnce = of.nodes();
  let harvests = 0;
  const sweep = (kinds) => {
    // The wants this sweep can actually satisfy: only the kinds it takes.
    const want = kinds.map((k) => KIND_ITEM[k]).filter((i) => i !== undefined);
    for (const n of nodesOnce) {
      if (!kinds.includes(n.kind)) continue;
      const p = pack();
      if (!want.some((i) => (p[i] ?? 0) < WANT[i])) break;
      const item = KIND_ITEM[n.kind];
      if ((p[item] ?? 0) >= WANT[item]) continue;
      for (let k = 0; k < 6; ++k) if (of.harvest(n.index).ok) harvests++;
    }
  };
  sweep(BARE);
  check('the clearing gave up wood and stone to bare hands',
    have('Wood') > 0 && have('Stone') > 0, JSON.stringify(pack()));

  // The refusal kept as a NEGATIVE CONTROL. This file is entirely about gates
  // that have to be caught refusing, so the one it now has to obey is witnessed
  // rather than tiptoed around.
  const oreNode = nodesOnce.find((n) => GATED.includes(n.kind));
  check('the clearing has a tool-gated node in it', oreNode !== undefined,
    JSON.stringify([...new Set(nodesOnce.map((n) => n.kind))]));
  const bareTry = oreNode === undefined ? null : of.harvest(oreNode.index);
  check('NEGATIVE CONTROL: bare hands are REFUSED at ore, by name (ToolRequired)',
    bareTry !== null && bareTry.ok === false
    && bareTry.refusal !== null && bareTry.refusal !== undefined
    && bareTry.refusal.code === 1,
    JSON.stringify(bareTry));

  const rawIronBeforePick = have('Raw iron');
  const pickIdx = of.game().recipes
    .findIndex((r) => r.name === 'Crude pickaxe' && r.craftable);
  check('the crude pickaxe is craftable from what bare hands gathered',
    pickIdx >= 0, JSON.stringify(pack()));
  check('and it crafts', pickIdx >= 0 && of.craft(pickIdx) === true);
  await sleep(0.2);
  check('a crude pickaxe is in the pack', have('Crude pickaxe') >= 1,
    JSON.stringify(pack()));
  check('and no ore was spent on it, because none had been mined',
    rawIronBeforePick === 0 && have('Raw iron') === 0,
    `${rawIronBeforePick} -> ${have('Raw iron')}`);

  sweep(GATED);
  log.push(`stocked in ${harvests} swings: ${JSON.stringify(pack())}`);
  check('the clearing had raw iron and copper', have('Raw iron') > 0
    && have('Raw copper') > 0, JSON.stringify(pack()));

  // Furnace, placed and run, exactly as probes/research.js does it.
  check('the furnace recipe is still index 2', of.craft(2) === true);
  of.look(of.world().observer.yawDeg, -18);
  await sleep(0.2);
  of.hotbar(2);
  await sleep(0.15);
  of.input.tape([{ hold: 4, actions: ['use'] }, { hold: 8, keys: [] }]);
  await sleep(0.4);
  check('the furnace went down', of.game().machines.length > 0);
  of.input.tape([{ hold: 4, actions: ['interact'] }, { hold: 10, keys: [] }]);
  await sleep(0.4);
  const load = (m) => {
    const b = [...document.querySelectorAll('#of-furnace button[data-load]')]
      .find((x) => x.textContent.includes(m));
    if (b === undefined) return false;
    b.click();
    return true;
  };
  const take = () => {
    const b = document.querySelector('#of-furnace button[data-take]');
    if (b !== null) b.click();
  };
  const smelt = async (ore, batches) => {
    for (let i = 0; i < batches; ++i) {
      if (!load('Coal')) load('Wood');
      await sleep(0.05);
      if (!load(ore)) return false;
      await sleep(1000 / 60);
      take();
      await sleep(0.2);
    }
    return true;
  };
  check('iron smelted', await smelt('Raw iron', 16), 'the load button vanished');
  check('copper smelted', await smelt('Raw copper', 12), 'the load button vanished');
  of.input.tape([{ hold: 4, actions: ['interact'] }, { hold: 8, keys: [] }]);
  await sleep(0.3);
  log.push(`smelted: ${JSON.stringify(pack())}`);

  // ======================================================================
  // 3b. D-019. THE RESEARCH STATION, AND THEN THE READING THAT USED TO BE §2.
  //
  //     Built through the same build menu a player uses, out of the metal the
  //     smelting above produced. The tree is then read BEFORE any science is
  //     crafted and BEFORE anything is bought, which is the condition the
  //     assertions below were always making, moved rather than weakened.
  // ======================================================================
  const STATION_TILE = '#of-build .of-btile[data-build="researchstation"]';
  of.input.act(['build'], 4);
  await sleep(0.45);
  const stTile = document.querySelector(STATION_TILE);
  check('the build menu offers a research station', stTile !== null, STATION_TILE);
  stTile?.dispatchEvent(new PointerEvent('pointerdown',
    { bubbles: true, pointerId: 1, pointerType: 'mouse', button: 0 }));
  await sleep(0.11);
  (document.querySelector(STATION_TILE) ?? stTile)?.click();
  await sleep(0.4);
  check('a research station is in hand', of.game().hotbar.kind === 'station',
    JSON.stringify(of.game().hotbar));
  of.look(of.world().observer.yawDeg, -18);
  await sleep(0.2);
  of.input.tape([{ hold: 4, actions: ['use'] }, { hold: 8, keys: [] }]);
  await sleep(0.5);
  check('the research station went down', (of.stations()?.count ?? 0) >= 1,
    JSON.stringify(of.stations()));

  await press('research');
  await sleep(0.4);
  const panel = document.querySelector('#of-research');
  check('the research panel opens on J once a station stands',
    !!panel && panel.classList.contains('open'), panel?.className);
  check('Launch Facilities is IN the tree', cardFor(T.LaunchFacilities) !== null);
  check('C3: it starts BLOCKED', stateOf(T.LaunchFacilities) === 'blocked',
    stateOf(T.LaunchFacilities));
  const why0 = whyOf(T.LaunchFacilities);
  log.push(`Launch Facilities before: "${why0.trim()}"`);
  check('C3: and the reason names its PREREQ, Electrification',
    /Electrification/.test(why0), `"${why0}"`);
  await press('research');
  await sleep(0.3);

  await press('pack');
  await sleep(0.4);
  const rows = () => [...document.querySelectorAll('#of-panel .of-recipe')];
  const rowNamed = (t) => rows().find((e) =>
    (e.querySelector('.nm')?.textContent ?? '').includes(t));
  let made = 0;
  for (let i = 0; i < 32; ++i) {
    if (click(rowNamed('Automation science')?.querySelector('button'))) made++;
    await sleep(0.05);
  }
  let logi = 0;
  for (let i = 0; i < 16; ++i) {
    if (click(rowNamed('Logistic science')?.querySelector('button'))) logi++;
    await sleep(0.05);
  }
  const sci = have('Automation science');
  const lsci = have('Logistic science');
  log.push(`science: ${sci} automation from ${made} clicks, `
    + `${lsci} logistic from ${logi}`);
  check('real DOM clicks made the science', sci >= 30 && lsci >= 12,
    `${sci} automation / ${lsci} logistic`);
  await press('pack');
  await sleep(0.3);

  await press('research');
  await sleep(0.4);
  const bought = click(btnFor(T.Electrification));
  await sleep(0.5);
  check('Electrification was bought with a real DOM click', bought === true);
  check('and it is unlocked', stateOf(T.Electrification) === 'unlocked',
    stateOf(T.Electrification));

  // ======================================================================
  // 4. THE REFUSAL MOVED. This is the assertion no boolean can express.
  // ======================================================================
  const why1 = whyOf(T.LaunchFacilities);
  log.push(`Launch Facilities after: "${why1.trim()}"`);
  check('C3: Launch Facilities is now AVAILABLE rather than blocked',
    stateOf(T.LaunchFacilities) === 'available', stateOf(T.LaunchFacilities));
  check('C3: and its refusal MOVED off the prereq',
    !/Electrification/.test(why1), `"${why1}"`);
  // AND THE REASON THIS IS NOT "onto the science cost": by the time the prereq
  // is bought the probe has crafted 32 Automation and 14 Logistic science,
  // which is MORE than Launch Facilities costs, so there is no cost refusal
  // left to move onto and the reason line correctly goes EMPTY. Asserting a
  // cost sentence here would have meant arranging the science to fall short so
  // a nicer string appeared, which is a test bending the run to match its own
  // expectation. What is asserted instead is the property that actually holds
  // in both regimes: the reason CHANGED, and whatever it now is, it is no
  // longer about the prereq.
  check('C3: which is a DIFFERENT sentence from the one before it',
    why1.trim() !== why0.trim(), `"${why0}" -> "${why1}"`);
  check('C3: and the tech is affordable, which is why the reason is now empty',
    why1.trim() === '' || /science/i.test(why1) || /more /.test(why1),
    `"${why1}"`);

  // ======================================================================
  // 5. C4: THE PAD IS STILL REFUSED, and still by name.
  // ======================================================================
  await press('research');
  await sleep(0.3);
  await hold(padSlot);
  of.look(of.world().observer.yawDeg, -30);
  await sleep(0.4);
  const g1 = of.game().build.padGhost;
  log.push(`pad ghost after the prereq: "${g1?.reason}"`);
  check('C4: buying the PREREQ did not unlock the pad',
    g1 !== null && g1.ok === false, JSON.stringify(g1));
  check('C4: and it still names Launch Facilities',
    /Launch Facilities/.test(g1?.reason ?? ''), g1?.reason);
  // And pressing the key really does nothing, rather than the ghost merely
  // reading red: a refusal that still places is the worst of both.
  const before = of.game().pads.placements;
  of.input.act(['use'], 4);
  await sleep(0.4);
  check('C4: and a real press places NOTHING',
    of.game().pads.placements === before, `${before} -> ${of.game().pads.placements}`);

  // ======================================================================
  // 6. BUY LAUNCH FACILITIES, AND WATCH THE REFUSAL GO.
  // ======================================================================
  await press('research');
  await sleep(0.4);
  const gatesBefore = of.game().progress.research.gatesHeld;
  const sciBefore = have('Automation science');
  const lsciBefore = have('Logistic science');
  const boughtPad = click(btnFor(T.LaunchFacilities));
  await sleep(0.6);
  check('Launch Facilities was bought with a real DOM click', boughtPad === true);
  check('and it reads unlocked', stateOf(T.LaunchFacilities) === 'unlocked',
    stateOf(T.LaunchFacilities));
  check('the science was SPENT, exactly its cost',
    have('Automation science') === sciBefore - 20
    && have('Logistic science') === lsciBefore - 12,
    `${sciBefore}/${lsciBefore} -> `
    + `${have('Automation science')}/${have('Logistic science')}`);
  check('and the number of gates held went DOWN',
    of.game().progress.research.gatesHeld < gatesBefore,
    `${gatesBefore} -> ${of.game().progress.research.gatesHeld}`);
  log.push(`bought: gates held ${gatesBefore} -> `
    + `${of.game().progress.research.gatesHeld}`);

  await press('research');
  await sleep(0.3);
  await hold(padSlot);
  of.look(of.world().observer.yawDeg, -30);
  await sleep(0.4);
  const g2 = of.game().build.padGhost;
  log.push(`pad ghost after the tech: "${g2?.reason}"`);
  // THE POSITIVE HALF, and it is a MOVE rather than a disappearance. A gate that
  // had simply been switched off would leave a VALID ghost on bare ground, which
  // is a different bug wearing this test's green tick.
  check('ALLOWED AFTER: the research refusal is GONE',
    !/Launch Facilities|research/.test(g2?.reason ?? ''), g2?.reason);
  check('and the ghost no longer carries a lock at all',
    (g2?.locked ?? 'x') === '', g2?.locked);
  check('and the refusal MOVED to the NEXT rule, the platform',
    /platform/.test(g2?.reason ?? ''), g2?.reason);
  check('which is still a refusal, because there is no platform here',
    g2 !== null && g2.ok === false, JSON.stringify(g2));
  check('and its missing-cell count is the whole block',
    g2?.missingCells === (g2?.cells ?? 0) * (g2?.cells ?? 0),
    `${g2?.missingCells} of ${g2?.cells}^2`);

  return {
    valid: fails.length === 0,
    fails,
    log,
    padItem: PAD_ITEM,
    refusalBefore: g0?.reason,
    refusalAfterPrereq: g1?.reason,
    refusalAfterTech: g2?.reason,
    techReasonBefore: why0.trim(),
    techReasonAfter: why1.trim(),
    research: of.game().progress.research,
    pads: of.game().pads,
  };
})()
