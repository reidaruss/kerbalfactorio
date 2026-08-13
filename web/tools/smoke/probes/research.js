// THE RESEARCH ACCEPTANCE (W11 lane H). `research.h` has been green in /core
// since June and had never once been called from the browser; a sandbox probe
// reported `researchGatesInClient: 0` and said so plainly rather than faking a
// pass, which is how we knew. This is that number's replacement.
//
//   npm --prefix web run build
//   npx --prefix web vite preview --port 4180
//   node web/tools/smoke/run.mjs --url=http://127.0.0.1:4180/ --scenario=walk \
//     --evalfile=web/tools/smoke/probes/research.js
//
// THE CLAIM, and it is the one the brief asked for: a tech that is LOCKED
// becomes affordable, unlocks, and the thing it gates ACTUALLY BECOMES
// AVAILABLE, with the negative control that it was REFUSED BEFORE.
//
// THE SCIENCE IS EARNED, NOT GRANTED. There is no `of.give` on the debug
// surface and this probe deliberately does not add one: it mines ore by hand,
// smelts it in a furnace it crafted and placed, and hand-crafts the packs, so
// what it proves is the whole chain rather than the last link of it. That also
// means the run FAILS if any earlier part of the game is broken, which is the
// right dependency for an acceptance to have.
//
// AND IT MINES IN THE LEGAL ORDER (GP-624). GP-506 gated coal, iron and copper
// behind a crude pickaxe, so §1 gathers wood and loose stone bare-handed, crafts
// the pickaxe out of those two alone, and only then mines. The bare-hand refusal
// is witnessed as a negative control on the way past rather than avoided.
//
// FOUR NEGATIVE CONTROLS, because "the thing became available after research"
// is also true of a gate that always says yes:
//
//   1. THE SAME QUERY BEFORE, ON A PACK THAT CAN AFFORD IT. The power pole is
//      refused while its materials are in hand, so the refusal can only be the
//      tech tree; and the identical button takes the identical click after.
//   2. AN UNGATED NEIGHBOUR. Other recipes are craftable in the SAME FRAME.
//      Without this, a client where every row read locked would pass control 1.
//   3. THE SIBLING BRANCH. Electrification opens the pole and the generator and
//      leaves Metallurgy shut, so a tech that opened everything fails here
//      while passing everything above.
//   4. THE MILESTONE (DW-29). The autopilot is blocked with its prereq in and
//      its cost affordable, and its refusal names the DEED rather than a price.
//
// AND EVERY ACTION THAT CAN BE IS A REAL DOM EVENT. `probes/realclick.js` is
// the standing reminder that an abstraction hid a completely inert left mouse
// button through twenty green probes, so the Research button is pressed with a
// genuine `MouseEvent` on the element a player clicks, and the panel is opened
// with a real key press through the input tape.
(async () => {
  const of = window.__of;
  if (!of) return { valid: false, why: 'no __of' };
  // `hz` is the RENDER rate and not the sim rate. D-019 lengthened this file
  // (it now earns a research station as well as its science), and `of.run`
  // defaults to 144.3 Hz, which RENDERS `seconds * 144.3` frames on a software
  // rasteriser: the thirteen smelting waits below are about 31,000 frames at
  // the default and about 3,300 at 15. MEASURED: at the default this run was
  // killed still computing at 1 h. `Loop.frame` accumulates over a 1/60 fixed
  // step with `MAX_CATCHUP = 5`, so 15 Hz asks for 4 ticks a frame, inside the
  // cap, and the sim advances identically. Nothing here is measured in pixels.
  const sleep = (n, hz = 30) => of.run(n, hz);
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
  const have = (n) => pack()[n] ?? 0;

  // /core's own TechIds (research.h §D), named rather than derived so a
  // renumbering in the header fails this probe instead of quietly testing some
  // other tech.
  const T = { Electrification: 0x0010, ElectricSmelting: 0x0011,
    Metallurgy: 0x0012, PlateArmour: 0x0013, FlightAutopilot: 0x0014,
    CinderRefining: 0x0015 };
  const POLE_ITEM = 0x003F;

  await sleep(1.0);

  // ======================================================================
  // 0. SETUP PROOF (DW-20): the layer is REACHABLE and it is GATING. A run
  //    where none of this was wired would otherwise report a serene green from
  //    a set of queries that all answered "yes".
  // ======================================================================
  const p0 = of.game()?.progress;
  check('the progress surface exists', !!p0);
  if (!p0) return { valid: false, fails, why: 'no progress in the report' };
  check('this is survival, so the gate is live',
    of.game().mode.researchGated === true, JSON.stringify(of.game().mode));
  // GP-611. SEVEN, NOT SIX. `research.h` gained `LaunchFacilities` (0x0016) with
  // the launch pad at GP-57, and this line was last touched before that landed,
  // so it has been the FIRST failure of a 24-failure run ever since. The tree is
  // correct and the probe was stale about it.
  check('seven techs in the tree', p0.research.techs === 7, p0.research.techs);
  check('nothing unlocked at boot', p0.research.unlocked === 0,
    p0.research.unlocked);
  // THE NUMBER THAT WAS ZERO: every unlock every locked tech is still holding.
  check('the tree is holding gates', p0.research.gatesHeld > 0,
    p0.research.gatesHeld);
  log.push(`boot: ${p0.research.techs} techs, ${p0.research.gatesHeld} gates held`);

  // ======================================================================
  // 1. EARN IT. Harvest, then smelt, then craft the science by hand.
  // ======================================================================
  const yaw = of.world().observer.yawDeg;
  let harvests = 0;
  // SIX SWINGS A NODE, NOT TWELVE, and the number is load-bearing rather than
  // arbitrary. The pack is twenty slots and raw resources stack to a hundred;
  // twelve swings a node fills all twenty, and then `HandCrafter::craft`
  // RETURNS TRUE while silently dropping its output, because gameplay.h adds
  // the result through the normal stack rules and discards the overflow. The
  // furnace was crafted, paid for and gone, and the only symptom four
  // assertions downstream was "the furnace went down: false". Escalated to the
  // roadmap; six swings is the workaround.
  // GP-611. A PER-RESOURCE BUDGET, BECAUSE "SIX SWINGS A NODE" WAS CALIBRATED
  // AGAINST A WORLD THAT NO LONGER EXISTS.
  //
  // The comment above is right about the mechanism and its arithmetic died. It
  // assumed roughly forty harvestable nodes. Three world-gen passes since then
  // (every substantial rock gives stone, every tree is choppable) took the
  // clearing to **749** nodes of these kinds, so 424 swings landed and the pack
  // finished at `Wood 1000, Stone 400, Coal 180, Raw iron 126, Raw copper 144`,
  // which at 100 a stack is EXACTLY 20 of 20 slots. Every craft after that
  // returned `PackFull`, no furnace was ever made, and **23 of the 24 failures
  // in this suite were downstream of that one line**.
  //
  // A node count is the wrong thing to budget against, because world-gen owns it
  // and will move it again. The budget is per RESOURCE, which is what the pack
  // actually holds, so this stays correct at any node density.
  // D-019 RAISED THIS BUDGET, and the reason is a real rule change rather than
  // probe drift: the research screen now needs a RESEARCH STATION built before
  // it will open, and that station costs 20 Iron + 30 Stone + 10 Copper on top
  // of the 20 Iron + 10 Copper the ten Automation science below already cost.
  // So the run mines and smelts for two bills instead of one.
  const WANT = { Wood: 60, Stone: 45, Coal: 60, 'Raw iron': 55, 'Raw copper': 35 };
  // D-019 ALSO READ THE BUDGET ONCE PER NODE INSTEAD OF ONCE PER SWING, and
  // that is a harness finding rather than a tidy-up. `have()` goes through
  // `pack()`, which goes through `of.game()`, which builds the ENTIRE world
  // report on every call: nodes, ore patches, the factory plan, the base, the
  // pads, the health census, progression. Asked inside the swing loop that is
  // FIVE full reports per swing and up to ~22,000 for a clearing of ~749 nodes.
  // GP-611 fixed this loop's arithmetic and left its cost, and raising the
  // budget for the research station made the cost bite: `probes/researchstation.js`
  // was killed still computing at 1 h 55 m before it was found. One read per
  // node, and a `break` rather than a `continue` once the budget is met so the
  // remaining nodes are not walked at all.
  // GP-624. TWO SWEEPS WITH THE PICKAXE CRAFTED BETWEEN THEM, because ONE sweep
  // over every kind stopped being legal play. GP-506 made coal, iron and copper
  // `requiresToolFor` (gameplay.h): bare-handed swings at them are REFUSED by
  // name, so the single loop this replaces landed wood and stone, refused every
  // ore swing, never met its budget and left `have('Raw iron')` at zero with the
  // whole smelting half of the file cascading off it. Wood and loose stone stay
  // ungated exactly so the pickaxe (Stone x2 + Wood x1) has a bare-hand path.
  //
  // The swing count is unchanged: every node is still visited once and paid six
  // swings. The sweeps partition the kinds and each budgets only what its own
  // kinds can yield, so a met wood budget no longer keeps the walk going in the
  // hope of iron. `of.nodes()` is read ONCE and walked twice, because it is the
  // same full-world build `pack()` is and two loop headers would have bought
  // back half of what the per-node budget above saved.
  const BARE = [0, 1];      // Tree, Rock — requiresToolFor false, bare hands OK
  const GATED = [2, 3, 4];  // CoalSeam, IronOre, CopperOre — pickaxe or refusal
  // GP-672. A NODE WHOSE OWN RESOURCE IS ALREADY AT BUDGET IS SKIPPED. The
  // budget stops the sweep only when EVERY want is met, so while one scarce
  // resource is short every other node on the way keeps paying out: MEASURED
  // 2026-08-13, this file finished its sweep at `Wood 389, Coal 432, Raw iron
  // 378` against wants of 60, 60 and 55, because raw copper is the scarce one.
  // At 100 to a stack that is 12 slots where 3 would do, and this run reached
  // the science craft with **19 of 20** slots used. It passed, and one slot of
  // margin decided by world-gen's node density is not a margin: the same
  // overshoot with no budget at all put `padgate.js` at 20 of 20 and its
  // pickaxe craft was refused `PackFull`. Skipping a satisfied kind costs
  // nothing, because the budget is still read ONCE per node (GP-622), and every
  // assertion below still has to be met by the same numbers.
  const KIND_ITEM = { 0: 'Wood', 1: 'Stone', 2: 'Coal', 3: 'Raw iron', 4: 'Raw copper' };
  const nodesOnce = of.nodes();
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
  sweep(BARE, { Wood: WANT.Wood, Stone: WANT.Stone });
  check('the clearing gave up wood to bare hands', have('Wood') > 0, have('Wood'));
  check('and loose stone to bare hands', have('Stone') > 0, have('Stone'));

  // THE REFUSAL AS A NEGATIVE CONTROL, not merely stepped around: without it,
  // "ore came out once a pickaxe existed" is equally true of a gate that never
  // refused anything in this world.
  const oreNode = nodesOnce.find((n) => GATED.includes(n.kind));
  check('the clearing has a tool-gated node in it', oreNode !== undefined,
    JSON.stringify([...new Set(nodesOnce.map((n) => n.kind))]));
  const bareTry = oreNode === undefined ? null : of.harvest(oreNode.index);
  check('NEGATIVE CONTROL: bare hands are REFUSED at ore, by name (ToolRequired)',
    bareTry !== null && bareTry.ok === false
    && bareTry.refusal !== null && bareTry.refusal !== undefined
    && bareTry.refusal.code === 1,
    JSON.stringify(bareTry));

  // The pickaxe, out of wood and stone alone. Proven the way pickaxegate.js
  // proves it: nothing gated has yielded yet, so a pack holding zero raw iron
  // that still crafts a pickaxe cannot have paid for it in ore.
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

  sweep(GATED, { Coal: WANT.Coal, 'Raw iron': WANT['Raw iron'],
    'Raw copper': WANT['Raw copper'] });
  // GP-611. A REAL SLOT COUNT. The old guard read `carried.length < 20`, and
  // `GameCore.carried()` collapses the pack to ONE LINE PER ITEM TYPE, so with
  // five resource types it reported `5` while the pack was genuinely full. It
  // passed by construction and could never fail: the one check written to catch
  // this exact hazard was structurally incapable of seeing it.
  const slotsUsed = () => Object.values(pack())
    .reduce((a, c) => a + Math.ceil(c / 100), 0);
  check('the pack has room to craft into', slotsUsed() < 20,
    `${slotsUsed()} of 20 slots: ${JSON.stringify(pack())}`);
  log.push(`stocked in ${harvests} swings: ${JSON.stringify(pack())}`);
  check('the clearing had raw iron in it', have('Raw iron') > 0, JSON.stringify(pack()));
  check('the clearing had raw copper in it', have('Raw copper') > 0);

  // A furnace, crafted, placed, loaded and run. Recipe index 2 is the primitive
  // furnace, and the first seven indices are UNCHANGED by ABI 9 (the list is
  // appended to, never reordered), which is itself worth asserting.
  check('the furnace recipe is still index 2', of.craft(2) === true);
  of.look(yaw, -18);
  await sleep(0.2);
  of.hotbar(2);
  await sleep(0.15);
  of.input.tape([{ hold: 4, actions: ['use'] }, { hold: 8, keys: [] }]);
  await sleep(0.4);
  check('the furnace went down', of.game().machines.length > 0);
  of.input.tape([{ hold: 4, actions: ['interact'] }, { hold: 10, keys: [] }]);
  await sleep(0.4);
  check('the furnace screen opened', of.game().furnaceOpen === true,
    JSON.stringify(of.game().furnaceOpen));
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
  // ONE ore type at a time: /core's Furnace refuses a second while the first is
  // still in the pool, so the batches are sequential rather than interleaved.
  // Five units a click at 180 ticks a smelt, so each batch waits out 900 ticks.
  const smelt = async (ore, batches) => {
    for (let i = 0; i < batches; ++i) {
      if (!load('Coal')) load('Wood');
      await sleep(0.05);
      if (!load(ore)) return false;
      await sleep(1000 / 60, 15);
      take();
      await sleep(0.2);
    }
    return true;
  };
  check('iron smelted', await smelt('Raw iron', 8), 'the load button vanished');
  check('copper smelted', await smelt('Raw copper', 5), 'the load button vanished');
  of.input.tape([{ hold: 4, actions: ['interact'] }, { hold: 8, keys: [] }]);
  await sleep(0.3);
  log.push(`smelted: ${JSON.stringify(pack())}`);
  check('iron came out of the furnace', have('Iron') >= 40, have('Iron'));
  check('copper came out of the furnace', have('Copper') >= 20, have('Copper'));

  // ======================================================================
  // 1b. D-019. BUILD THE RESEARCH STATION, BECAUSE THE SCREEN NOW HAS ONE.
  //
  //     This is a REAL RULE CHANGE and not a probe workaround: pressing J with
  //     no research station built is refused by name, so this acceptance -
  //     whose whole subject is the tech tree - has to earn the building the
  //     tree lives in before it can look at it. The refusal itself, its
  //     wording, its counter and its controls are `probes/researchstation.js`'s
  //     job and are deliberately not duplicated here; what this needs is the
  //     station, and it is built through the same build menu a player uses.
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
  of.look(yaw, -18);
  await sleep(0.2);
  of.input.tape([{ hold: 4, actions: ['use'] }, { hold: 8, keys: [] }]);
  await sleep(0.5);
  check('the research station went down', (of.stations()?.count ?? 0) >= 1,
    JSON.stringify(of.stations()));
  log.push(`station built: ${JSON.stringify(of.stations()?.list ?? null)}`);

  // ======================================================================
  // 2. THE REFUSAL, WITH THE MATERIALS IN HAND.
  // ======================================================================
  await press('Tab');
  await sleep(0.4);
  check('the pack opened', of.game().panelOpen === true);
  const rows = () => [...document.querySelectorAll('#of-panel .of-recipe')];
  const rowNamed = (t) => rows().find((e) =>
    (e.querySelector('.nm')?.textContent ?? '').includes(t));
  const lockedRows = () => rows().filter((e) => e.classList.contains('locked'));
  const beforeLocked = lockedRows().length;
  check('some recipes are LOCKED', beforeLocked > 0, beforeLocked);
  const lockText = lockedRows().map((e) => e.querySelector('.lock')?.textContent ?? '');
  check('a lock NAMES its tech', lockText.some((t) => /needs \S/.test(t)),
    JSON.stringify(lockText.slice(0, 4)));
  log.push(`locked rows: ${beforeLocked}, e.g. "${lockText[0]}"`);

  // CONTROL 2: an UNGATED recipe is craftable in the SAME FRAME.
  check('ungated recipes are craftable in the same frame',
    rows().filter((e) => e.classList.contains('can')).length > 0);

  const poleBefore = have('Power pole');
  const refused = click(rowNamed('Power pole')?.querySelector('button'));
  await sleep(0.3);
  check('a locked Craft button REFUSES a real DOM click', refused === false);
  check('and nothing was crafted', have('Power pole') === poleBefore,
    `${poleBefore} -> ${have('Power pole')}`);

  // The science itself is NOT gated, which is the bootstrap: research must be
  // reachable from an empty tech tree or the whole tree is unreachable.
  let made = 0;
  for (let i = 0; i < 14; ++i) {
    if (click(rowNamed('Automation science')?.querySelector('button'))) made++;
    await sleep(0.1);
  }
  const sci = have('Automation science');
  check('real DOM clicks made science', sci >= 10, `${made} clicks, ${sci} packs`);
  log.push(`science: ${sci} packs from ${made} clicks, pack ${JSON.stringify(pack())}`);
  await press('Tab');
  await sleep(0.3);

  // ======================================================================
  // 3. THE RESEARCH SCREEN, opened with a real key, bought with a real click.
  // ======================================================================
  await press('KeyJ');
  await sleep(0.4);
  const panel = document.querySelector('#of-research');
  check('the research panel opened on J',
    !!panel && panel.classList.contains('open'), panel?.className);
  const cardFor = (id) => document.querySelector(`#of-research [data-tech="${id}"]`);
  const btnFor = (id) => document.querySelector(`#of-research button[data-tech="${id}"]`);
  const stateOf = (id) => cardFor(id)?.getAttribute('data-state') ?? '';
  const textOf = (id) => cardFor(id)?.textContent ?? '';
  // THE REFUSAL, not the whole card. The panel renders a `needs <name>` CHIP
  // for every prereq whatever the state, so matching the card text conflates
  // "this tech depends on Electrification", which is permanent, with "you have
  // not researched Electrification", which is the thing that changes. `.why` is
  // the reason line and only the reason line.
  const whyOf = (id) => cardFor(id)?.querySelector('.why')?.textContent ?? '';

  check('Electrification reads available',
    stateOf(T.Electrification) === 'available', stateOf(T.Electrification));
  check('ElectricSmelting is blocked behind its prereq',
    stateOf(T.ElectricSmelting) === 'blocked', stateOf(T.ElectricSmelting));
  const rSmelt = whyOf(T.ElectricSmelting);
  check('the ElectricSmelting refusal names its PREREQ',
    /Electrification/.test(rSmelt), `"${rSmelt}"`);

  // CONTROL 4: DW-29's milestone, before anything is bought.
  const rAuto = whyOf(T.FlightAutopilot);
  check('the autopilot is blocked', stateOf(T.FlightAutopilot) === 'blocked');
  log.push(`autopilot refusal: "${rAuto.trim()}"`);

  const before = of.game().progress.research;
  const bought = click(btnFor(T.Electrification));
  await sleep(0.5);
  const after = of.game().progress.research;
  check('the Research button took a real DOM click', bought === true);
  check('Electrification is unlocked', after.unlocked === before.unlocked + 1,
    `${before.unlocked} -> ${after.unlocked}`);
  check('the science was SPENT, exactly ten', have('Automation science') === sci - 10,
    `${sci} -> ${have('Automation science')}`);
  check('gates held went DOWN', after.gatesHeld < before.gatesHeld,
    `${before.gatesHeld} -> ${after.gatesHeld}`);
  log.push(`Electrification bought: gates held ${before.gatesHeld} -> ${after.gatesHeld}`);

  // The refusal one rung up MOVED from the prereq to the cost, which is the
  // ResearchBlock code doing the job a boolean cannot.
  // THE REFUSAL MOVED, which is the ResearchBlock code doing a job a boolean
  // cannot: the same tech is still refused, and for a DIFFERENT reason.
  const rSmelt2 = whyOf(T.ElectricSmelting);
  check('the ElectricSmelting refusal moved off the prereq',
    !/Electrification/.test(rSmelt2), `"${rSmelt2}"`);
  check('and onto the science it is short of',
    /more Automation science/.test(rSmelt2), `"${rSmelt2}"`);
  log.push(`ElectricSmelting refusal: "${rSmelt}" -> "${rSmelt2}"`);
  // CONTROL 3: the sibling branch did NOT open with it.
  check('Metallurgy did not open with Electrification',
    stateOf(T.Metallurgy) !== 'unlocked', stateOf(T.Metallurgy));
  // CONTROL 4b: the milestone tech is STILL blocked with its prereq now in.
  check('the autopilot is STILL blocked with its prereq in',
    stateOf(T.FlightAutopilot) === 'blocked', stateOf(T.FlightAutopilot));
  check('the autopilot refusal names the DEED, not a price',
    /orbit/i.test(whyOf(T.FlightAutopilot)), `"${whyOf(T.FlightAutopilot)}"`);
  // GP-2, visible: the off-world row cannot be bought on this planet.
  check('Cinderite Refining is blocked', stateOf(T.CinderRefining) === 'blocked');

  await press('KeyJ');
  await sleep(0.3);

  // ======================================================================
  // 4. THE THING IT GATES ACTUALLY BECAME AVAILABLE. This is the acceptance.
  // ======================================================================
  await press('Tab');
  await sleep(0.4);
  const afterLocked = lockedRows().length;
  check('fewer locked rows than before', afterLocked < beforeLocked,
    `${beforeLocked} -> ${afterLocked}`);
  const poleRow = rowNamed('Power pole');
  check('the power pole is no longer locked',
    !!poleRow && !poleRow.classList.contains('locked'), poleRow?.className);
  const madePole = click(poleRow?.querySelector('button'));
  await sleep(0.3);
  check('the SAME button that refused a click now takes one', madePole === true);
  check('a power pole is in the pack', have('Power pole') > poleBefore,
    `${poleBefore} -> ${have('Power pole')}`);

  // And onto the bar, through the pack tile a player clicks: nine slots and
  // twelve placeable things means the loadout has to be changeable.
  const tile = document.querySelector(`#of-panel .of-slot[data-item="${POLE_ITEM}"]`);
  check('the pack tile offers the pole to the bar', !!tile);
  click(tile);
  await sleep(0.3);
  const bar = of.game().hotbar;
  check('the pole went on the selected hotbar slot',
    bar.slots.some((s) => s.part === 'pole'),
    JSON.stringify(bar.slots.map((s) => s.part)));
  await press('Tab');
  await sleep(0.4);

  return {
    valid: fails.length === 0,
    fails,
    log,
    lockedBefore: beforeLocked,
    lockedAfter: afterLocked,
    research: of.game().progress.research,
    pack: pack(),
    ticks: of.world().tick,
  };
})()
