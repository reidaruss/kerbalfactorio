// D-019: THE RESEARCH STATION IS A REAL MACHINE, AND THE RESEARCH PANEL GATES
// ON IT. Survival.
//
//   npm --prefix web run build
//   npx --prefix web vite preview --host --port 4311
//   node web/tools/smoke/run.mjs --url=http://<lan>:4311/ --scenario=walk \
//     --width=640 --height=360 \
//     --evalfile=web/tools/smoke/probes/researchstation.js
//
// A SMALL VIEWPORT AND A LOW RENDER RATE, ON PURPOSE, and the second one is
// worth more than the first (NUMBERS.md's harness lesson). Nothing here is
// measured in pixels: every assertion is a /core price, a placed object, a
// panel's open state or a DOM click. `of.run(seconds)` defaults to 144.3 Hz and
// RENDERS `seconds * 144.3` frames on a software rasteriser, so the sixty
// smelts this run pays for (10,800 fixed ticks, 180 s of sim) cost about 26,000
// rendered frames at the default and about 2,700 at 15 Hz. MEASURED, not
// reasoned: the first version of this file used the default and was killed
// still computing at **1 h 55 m** on a box at load average 30 with a sibling
// lane's Chrome on it. The sim advances identically either way -- `Loop.frame`
// is an accumulator over a 1/60 fixed step with `MAX_CATCHUP = 5`, and 15 Hz
// asks for 4 ticks a frame, inside that cap -- so this buys wall clock and
// changes no number the probe reads.
//
// THE CLAIM, in the order the storyline states it: with no research station
// built, the research key is REFUSED by name; a station is built out of smelted
// metal through the build menu; the key then works; walking up to the station
// and pressing interact opens the same screen; and a technology is researched
// end to end through it.
//
// §6 BUYS THE SCANNING ANTENNA, NOT ELECTRIFICATION, AND THAT IS A DELIBERATE,
// NAMED CHOICE rather than the fix drifting to whatever was cheapest. This
// section's whole subject is the STATION working as research furniture -- the
// panel opens on it, a real DOM click spends real science through it, a gate
// comes off -- and that claim never depended on WHICH tech was bought.
// Electrification moved behind `milestones::RuinInvestigated` (L7, GP-546 to
// GP-549) once `ruininvest.js` closed the ruin-reveal cycle, and this file
// never walks to a ruin, so it has no legal way to earn that milestone. The
// Scanning Antenna is `research.h`'s own first, cheapest, deliberately UNGATED
// rung (no prereq, no milestone, GP-535's ruling) precisely so a bare station
// can reach it, which is exactly what this file is proving. This is the
// opposite call from `research.js` and `padgate.js` (gameplay.md's GP-549
// addendum): those files EARN the milestone for real because Electrification
// IS their subject (the locked-tech-becomes-available chain, and Launch
// Facilities' real prereq); here it is not, so retargeting the purchase is the
// honest fix rather than a dodge. §6 keeps Electrification in the file anyway,
// as a NEGATIVE CONTROL: read from the tree report as still milestone-gated,
// and a real DOM click on its (disabled) button changes nothing.
//
// NOTHING IS GRANTED. There is no `of.give` on the debug surface and this file
// does not add one: every ingot in the station and in the science that buys the
// tech is mined by hand, smelted in a furnace this probe crafted and placed, and
// crafted through the same buttons a player clicks. That also means the run
// FAILS if any earlier rung of the chain is broken, which is the right
// dependency for an acceptance of a progression step to have.
//
// AND NOTHING IS MINED OUT OF ORDER EITHER (GP-624). GP-506 gated coal, iron and
// copper behind a crude pickaxe, so §2 below gathers wood and loose stone with
// bare hands, crafts the pickaxe out of those two alone, and only then mines. The
// bare-hand refusal is kept as a NEGATIVE CONTROL on the way past rather than
// simply avoided, so this file also witnesses the gate it now has to obey.
//
// FIVE REFUSING CONTROLS, because "the panel opened after I built a station" is
// also true of a gate that never refused anything:
//
//   C1  THE SAME KEY BEFORE, on a world where everything else works. The
//       research key is refused while the PACK and POWER keys open their own
//       panels in the same second, so the refusal cannot be "the UI is dead".
//   C2  THE REFUSAL IS COUNTED, not merely observed. `refusedResearch` rises by
//       exactly one per press and stops rising the moment a station stands.
//   C3  THE PRICE IS REAL. The station is unaffordable before the smelting and
//       affordable after it, and the pack falls by EXACTLY /core's bill when it
//       goes down. A cost that was never charged would pass "a station exists".
//   C4  E FOUND THE STATION. `aimed.station` is non-null on the press that
//       opens the panel, so "interact opened the tech tree" cannot be satisfied
//       by an interact branch that fires at nothing.
//   C5  THE GATE READS THE LIVE WORLD. The station is demolished at the end and
//       the research key REFUSES AGAIN. A gate that had latched on first use
//       would pass everything above and fail this.
(async () => {
  const of = window.__of;
  if (!of) return { valid: false, why: 'no __of' };
  if (typeof of.buildMenu !== 'function') return { valid: false, why: 'no of.buildMenu' };
  if (typeof of.research !== 'function') return { valid: false, why: 'no of.research' };
  // `hz` is the RENDER rate, not the sim rate. See the header: 30 Hz is ample
  // for a UI interaction (a 0.35 s wait is 10 frames and 21 fixed ticks, and an
  // input tape holds for 6 of the latter), and the long smelting waits drop to
  // 15. The first settle keeps the default, because the world has to STREAM
  // before anything is aimed at and that is the one place frames are the work.
  const sleep = (n, hz = 30) => of.run(n, hz);
  const fails = [];
  const log = [];
  const check = (name, ok, detail) => {
    if (!ok) fails.push(detail === undefined ? name : `${name}: ${detail}`);
    return ok;
  };
  /**
   * LIVE PROGRESS, and it is here for a measured reason rather than for
   * decoration. This file is a long driven run and `run.mjs` prints page console
   * lines AS THEY HAPPEN while the probe's return value only arrives at the end,
   * so a run watched through the return value alone is indistinguishable from a
   * run that has hung. Three runs were killed on this lane without knowing which
   * step they were on, which is INSTRUMENTS.md's own complaint about a tool that
   * reports nothing.
   */
  const step = (what) => console.log(`[probe] ${what}`);
  const press = async (action, frames = 6) => {
    of.input.act([action], frames);
    await sleep(0.35);
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
  const G = () => of.game();
  const gate = () => G().progress.stationGate;
  const stations = () => of.stations();
  const panelOpen = () => {
    const p = document.querySelector('#of-research');
    return !!p && p.classList.contains('open');
  };
  /** /core's TechIds, named rather than derived, so a renumber fails here. */
  const T_SCANNING_ANTENNA = 0x0017;   // ungated: §6 buys this one, for real
  const T_ELECTRIFICATION = 0x0010;    // milestone-gated: §6's negative control
  const M_RUIN_INVESTIGATED = 0x0003;
  const BLOCK_MILESTONE_MISSING = 4;
  /** /core's item id for the science pack §6 spends, named for the same
   *  reason the TechIds above are. */
  const ITEM_AUTOMATION_SCIENCE = 0x0020;
  const STATION_ID = 'researchstation';

  await of.run(1.0);

  // ======================================================================
  // 0. SETUP PROOF (DW-20). The layer is REACHABLE, this is SURVIVAL, and the
  //    station really is a /core-priced structure. A run where none of this was
  //    wired would report a serene green from a set of queries that all
  //    answered "no".
  // ======================================================================
  check('this run is SURVIVAL', G().mode.sandbox === false, JSON.stringify(G().mode));
  check('and the mode says the station gate is ENFORCED here',
    G().mode.researchStationGated === true, JSON.stringify(G().mode));
  const st0 = stations();
  check('the station layer is wired at all', st0 !== null && typeof st0 === 'object',
    JSON.stringify(st0));
  check('the world starts with NO research station', st0.count === 0, st0.count);
  check('and /core handed over a definition for one', st0.item > 0 && st0.typeId > 0,
    JSON.stringify({ item: st0.item, typeId: st0.typeId }));
  check('whose item id is the structural block\'s next free one (0x0045)',
    st0.item === 0x0045, st0.item.toString(16));
  check('and whose entity TypeId is 0x45', st0.typeId === 0x45,
    st0.typeId.toString(16));
  log.push(`station cost: "${st0.cost}"  mesh: ${st0.mesh}`);
  check('the price is quoted in SMELTED metal, which is the storyline slot',
    /Iron/i.test(st0.cost) && /Copper/i.test(st0.cost) && /Stone/i.test(st0.cost),
    st0.cost);
  // C3, first half: an empty pack cannot buy one, and /core says so with the
  // mode taken back out as well as with it in.
  check('C3: an empty pack cannot afford a station',
    st0.canAfford === false && st0.affordInCore === false,
    JSON.stringify({ canAfford: st0.canAfford, affordInCore: st0.affordInCore }));

  // ======================================================================
  // 1. THE REFUSAL, BY NAME (D-019). This is the whole point of the feature.
  // ======================================================================
  const refused0 = G().progress.refusedResearch;
  await press('research');
  check('the research panel is REFUSED with no station built',
    panelOpen() === false, document.querySelector('#of-research')?.className);
  check('C2: and the refusal is COUNTED, exactly one per press',
    G().progress.refusedResearch === refused0 + 1,
    `${refused0} -> ${G().progress.refusedResearch}`);
  const why = gate().refusal;
  log.push(`refusal: "${why}"`);
  check('the refusal NAMES the research station', /research station/i.test(why), why);
  check('and it names where to get one, rather than only saying no',
    /build menu/i.test(why), why);
  check('and it QUOTES the price, so the player knows what to go and mine',
    /Iron/i.test(why), why);
  check('the gate publishes that it is required, unmet and ENFORCED',
    gate().required === true && gate().built === false
    && gate().enforced === true && gate().liftedByMode === false,
    JSON.stringify(gate()));

  // C1. THE SAME SECOND, TWO OTHER PANEL KEYS WORK. Without this, a client
  // whose entire UI had died would pass every assertion above.
  await press('power');
  const powerOpen = document.querySelector('#of-power')?.classList.contains('open');
  check('C1: the POWER panel opens on its own key in the same world',
    powerOpen === true, document.querySelector('#of-power')?.className);
  await press('power');
  await press('pack');
  check('C1: and the PACK opens on its own key too', G().panelOpen === true);
  await press('pack');
  check('and the research panel is still shut', panelOpen() === false);

  // ======================================================================
  // 2. EARN IT. Harvest wood and stone bare-handed, craft the pickaxe, mine the
  //    ore it unlocks, craft a furnace, place it, smelt.
  //
  //    The budget is per RESOURCE and not per node (GP-611: a node count is
  //    world-gen's to move and it has moved three times). Forty iron and twenty
  //    copper is the station's bill (20 Fe / 10 Cu / 30 stone) plus the ten
  //    Automation science that buys the tech in step 6 (2 Fe + 1 Cu each).
  // ======================================================================
  const yaw = of.world().observer.yawDeg;
  const WANT = { Wood: 60, Stone: 60, Coal: 60, 'Raw iron': 55, 'Raw copper': 30 };
  //
  //    AND THE BUDGET IS READ ONCE PER NODE, NOT ONCE PER SWING, WHICH IS A
  //    HARNESS FINDING RATHER THAN A TIDY-UP (NUMBERS.md's whole subject).
  //    `have()` goes through `pack()`, which goes through `of.game()`, which
  //    builds the ENTIRE world report every call: nodes, ore patches, the
  //    factory plan, the base, the pads, the health census, progression. The
  //    obvious loop asks the budget inside the swing loop, which is five of
  //    those reports per swing and up to 22,000 for a clearing of ~749 nodes.
  //    MEASURED: with the budget read per swing this file was killed still
  //    computing at 1 h 55 m and again at 1 h 11 m; the low render rate above
  //    was a real saving and was NOT the dominant cost, and believing it was is
  //    what cost the second run. One read per node, and a `break` rather than a
  //    `continue` once the budget is met so the remaining nodes are not walked
  //    at all.
  //
  // GP-624. TWO SWEEPS WITH A TOOL CRAFTED BETWEEN THEM, because ONE sweep over
  // every kind is no longer legal play. GP-506 made coal, iron and copper
  // `requiresToolFor` (gameplay.h): a bare-hand swing at them is REFUSED by
  // name, so the single loop this replaces landed wood and stone, refused every
  // ore swing it took, never met its per-resource budget, walked all ~749 nodes
  // for nothing and cascaded roughly 33 failures out of the one line. Wood and
  // loose stone stay ungated precisely so the pickaxe (Stone x2 + Wood x1) has a
  // bare-hand path, and that is the order the storyline states: gather wood,
  // gather stones, craft the pickaxe, THEN mine.
  //
  // The swing count is unchanged. Each node is still visited once and paid six
  // swings; the sweeps merely partition the kinds, and each budgets only the
  // resources its own kinds can yield, so a met wood budget no longer keeps the
  // loop walking trees in the hope of iron.
  const BARE = [0, 1];      // Tree, Rock — requiresToolFor false, bare hands OK
  const GATED = [2, 3, 4];  // CoalSeam, IronOre, CopperOre — pickaxe or refusal
  // ONE node report, walked twice. `of.nodes()` is as expensive as `of.game()`
  // (it is the same full-world build), and the paragraph above is the whole
  // reason this file cares: two `for (const n of of.nodes())` headers would have
  // quietly bought back half of what the per-node budget saved.
  const nodesOnce = of.nodes();
  let harvests = 0;
  // GP-672. A NODE WHOSE OWN RESOURCE IS ALREADY AT BUDGET IS SKIPPED, and that
  // is a pack-pressure fix rather than a tidy-up. The budget stops the sweep
  // only when EVERY want is met, so while one scarce resource is still short
  // every other node on the way keeps paying out: measured 2026-08-13, this run
  // finished with `Wood 389, Coal 432, Raw iron 378` against wants of 60, 60 and
  // 55, because raw copper is the scarce one and the walk continued for it. At
  // 100 to a stack that overshoot is 12 slots where 3 would do, and the pack
  // reached **19 of 20** by the time the science is crafted (four raws at four
  // slots each, two ingots, the pickaxe, and the furnace and smelter items both
  // demolish refunds). One slot of margin, decided by world-gen's node density,
  // is not a margin. Skipping a satisfied kind costs nothing -- the budget is
  // still read ONCE per node, which is GP-622's whole finding -- and it takes
  // the pack to about ten slots while every downstream assertion still has to
  // be met by the same numbers.
  const KIND_ITEM = { 0: 'Wood', 1: 'Stone', 2: 'Coal', 3: 'Raw iron', 4: 'Raw copper' };
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
  check('the clearing gave up wood to bare hands', have('Wood') > 0, have('Wood'));
  check('and loose stone to bare hands', have('Stone') > 0, have('Stone'));

  // THE REFUSAL ITSELF, KEPT AS A NEGATIVE CONTROL rather than merely stepped
  // around. Without it, "the ore came out after I crafted a pickaxe" is equally
  // true of a gate that was never enforced in this world at all, and this file's
  // whole subject is gates that have to be shown refusing.
  const oreNode = nodesOnce.find((n) => GATED.includes(n.kind));
  check('the clearing has a tool-gated node in it', oreNode !== undefined,
    JSON.stringify([...new Set(nodesOnce.map((n) => n.kind))]));
  const remainingOf = (i) => of.nodes().find((n) => n.index === i)?.remaining ?? null;
  const oreRemaining0 = oreNode === undefined ? null : remainingOf(oreNode.index);
  const bareTry = oreNode === undefined ? null : of.harvest(oreNode.index);
  check('NEGATIVE CONTROL: bare hands are REFUSED at ore, by name, not by silence',
    bareTry !== null && bareTry.ok === false
    && bareTry.refusal !== null && bareTry.refusal !== undefined
    && bareTry.refusal.code === 1,   // HarvestRefusal::ToolRequired
    JSON.stringify(bareTry));
  check('and the refused node was left untouched',
    oreNode !== undefined
    && Math.abs((remainingOf(oreNode.index) ?? -1) - (oreRemaining0 ?? -2)) < 1e-6,
    `${oreRemaining0} -> ${oreNode === undefined ? 'n/a' : remainingOf(oreNode.index)}`);

  // THE PICKAXE, out of wood and stone alone. Proven BEHAVIOURALLY, the way
  // `probes/pickaxegate.js` proves it: nothing gated has yielded anything yet in
  // this run, so a pack holding zero raw iron that still crafts a pickaxe cannot
  // have paid for it in ore.
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

  step('harvesting the gated kinds, tooled');
  sweep(GATED, { Coal: WANT.Coal, 'Raw iron': WANT['Raw iron'],
    'Raw copper': WANT['Raw copper'] });
  step(`harvested ${harvests} swings`);
  log.push(`stocked in ${harvests} swings: ${JSON.stringify(pack())}`);
  check('the clearing had raw iron in it', have('Raw iron') >= 40, have('Raw iron'));
  check('the clearing had raw copper in it', have('Raw copper') >= 15,
    have('Raw copper'));
  check('and stone', have('Stone') >= 30, have('Stone'));

  // Recipe index 2 is the primitive furnace (the list is appended to, never
  // reordered, which is itself worth asserting).
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
  check('the furnace screen opened', G().furnaceOpen === true,
    JSON.stringify(G().furnaceOpen));
  /**
   * Load `m` into the open machine, and REPORT WHETHER ANYTHING MOVED.
   *
   * The obvious version returns true when it found a button and clicked it,
   * and that is a measurement of the DOM rather than of the machine. MEASURED,
   * and it cost this lane a 90-minute run: /core's `Furnace` refuses a second
   * ore type while the first is still in the pool, so with residue in the pool
   * every `Raw copper` click was accepted by the button and refused by the sim.
   * The probe reported `copper smelted: true`, the pack still held 36 raw
   * copper and 0 copper, and eleven assertions downstream failed for what
   * looked like eleven reasons. A click is not a load; the pack falling is.
   */
  const load = (m) => {
    const b = [...document.querySelectorAll('#of-furnace button[data-load]')]
      .find((x) => x.textContent.includes(m));
    if (b === undefined) return false;
    const before = have(m);
    b.click();
    return have(m) < before;
  };
  const take = () => {
    const b = document.querySelector('#of-furnace button[data-take]');
    if (b !== null) b.click();
  };
  // ONE ore at a time: /core's Furnace refuses a second while the first is still
  // in the pool. Five units a click at 180 ticks a smelt, so a batch waits 900.
  /** The /core state of the placed machine of `tier`, or null. */
  const machineState = (tier) =>
    (G().machines ?? []).find((m) => m.tier === tier)?.state ?? null;

  /**
   * Smelt `batches` lots of `ore` in the machine of `tier`. Returns '' on
   * success and a SENTENCE naming what went wrong otherwise.
   *
   * IT DRAINS THE POOL RATHER THAN WAITING A DURATION, and that is the second
   * half of the same lesson as `load` above. The first version waited
   * `5 * ticksPerSmelt` and assumed the batch had finished; when the crosshair
   * turned out to be on the 180-tick furnace rather than the 60-tick smelter,
   * every batch under-smelted by three fifths, the pool kept a residue, and the
   * NEXT ore type was refused for the whole run. A wait is an assumption; the
   * machine's own `oreCount` reaching zero is an observation. The bound exists
   * so a genuinely stalled furnace fails loudly instead of hanging.
   */
  const smelt = async (ore, batches, tier = 0) => {
    for (let i = 0; i < batches; ++i) {
      if (!load('Coal') && !load('Wood')) return `no fuel would load, batch ${i}`;
      await sleep(0.05);
      if (!load(ore)) {
        return `the ${ore} load was REFUSED on batch ${i}: `
          + JSON.stringify(machineState(tier));
      }
      let spun = 0;
      while ((machineState(tier)?.oreCount ?? 0) > 0 && spun < 30) {
        await sleep(1.5, 15);
        spun++;
      }
      if ((machineState(tier)?.oreCount ?? 0) > 0) {
        return `batch ${i} never drained: ${JSON.stringify(machineState(tier))}`;
      }
      take();
      await sleep(0.2);
    }
    return '';
  };
  // A SMELTER, NOT A FURNACE, FOR THE BULK OF IT, and this is a runtime decision
  // with a real number behind it: `gameplay.h`'s ladder runs the primitive
  // furnace at 180 ticks a smelt and the hand smelter at 60, so the sixty smelts
  // this file pays for are 10,800 ticks on a furnace and 3,600 on a smelter.
  // The smelter costs 5 Iron + 5 Stone, which the first furnace batch pays for.
  // It is also the more honest run: a player who has reached the research
  // station has built the smelter, because it is the rung immediately before it.
  step('smelting the first iron on the furnace');
  const b0 = await smelt('Raw iron', 1);
  check('the first iron smelted', b0 === '', b0);
  of.input.tape([{ hold: 4, actions: ['interact'] }, { hold: 8, keys: [] }]);
  await sleep(0.3);
  // Recipe index 3 is the hand smelter, the row after the furnace's index 2 in
  // `handRecipes()`; the list is appended to and never reordered, which
  // `probes/research.js` already asserts of index 2.
  check('the hand smelter was crafted', of.craft(3) === true,
    `iron ${have('Iron')} stone ${have('Stone')}`);

  // ======================================================================
  // 2b. THE FURNACE COMES BACK UP BEFORE THE SMELTER GOES DOWN, and that is a
  //     MEASUREMENT DECISION rather than tidiness.
  //
  //     The first version stood the smelter next to the furnace and pressed
  //     interact. Both were ~2.2 m ahead on the same yaw, so `pickAim` kept
  //     resolving to the FURNACE, every 5-unit batch got a 400-tick window
  //     against a 180-tick-per-smelt machine, and the pool never drained: the
  //     run ended with 25 Iron instead of 40, 0 Copper, and eleven downstream
  //     failures that all looked like separate defects. `aimed.machine` read 0
  //     -- tier zero -- in the report, which is what named it.
  //
  //     With exactly ONE machine standing there is nothing for the crosshair
  //     to get wrong. The furnace's pool is empty (the batch above drained it,
  //     which `smelt` now checks rather than assumes), so nothing is lost, and
  //     `demolishMachine` hands its item and its ingots straight back.
  // ======================================================================
  of.look(yaw, -18);
  await sleep(0.3);
  of.input.act(['demolish'], 4);
  await sleep(0.4);
  check('the furnace came back up, leaving nothing to confuse the crosshair',
    G().machines.length === 0, JSON.stringify(G().machines.map((m) => m.tier)));

  // THE SMELTER IS PICKED FROM THE BUILD MENU BY NAME, not left to
  // `tierToPlace`: demolishing the furnace refunded the furnace ITEM, and that
  // helper prefers a finished machine already in the pack, so the bar's own
  // `furnace` slot would have put the 180-tick furnace straight back down.
  const SMELTER_TILE = '#of-build .of-btile[data-build="furnace:1"]';
  of.input.act(['build'], 4);
  await sleep(0.45);
  const smTile = document.querySelector(SMELTER_TILE);
  check('the build menu offers the hand smelter', smTile !== null, SMELTER_TILE);
  smTile?.dispatchEvent(new PointerEvent('pointerdown',
    { bubbles: true, pointerId: 1, pointerType: 'mouse', button: 0 }));
  await sleep(0.11);
  (document.querySelector(SMELTER_TILE) ?? smTile)?.click();
  await sleep(0.4);
  of.look(yaw, -18);
  await sleep(0.2);
  of.input.tape([{ hold: 4, actions: ['use'] }, { hold: 8, keys: [] }]);
  await sleep(0.4);
  check('the SMELTER went down, and it is the only machine standing',
    G().machines.length === 1 && G().machines[0].tier === 1,
    JSON.stringify(G().machines.map((m) => m.tier)));
  of.input.tape([{ hold: 4, actions: ['interact'] }, { hold: 10, keys: [] }]);
  await sleep(0.4);
  check('the smelter screen opened', G().furnaceOpen === true,
    JSON.stringify(G().furnaceOpen));
  check('and the crosshair really is on the SMELTER', G().aimed.machine === 1,
    JSON.stringify(G().aimed));
  // NINE MORE IRON BATCHES AND FIVE OF COPPER, and the counts carry a margin
  // that was paid for by a measured miss: the first version smelted forty iron
  // for a forty-iron plan and finished with 35, because CRAFTING THE HAND
  // SMELTER ITSELF COSTS 5 IRON. The station then took its twenty and the
  // science had fifteen to work with, so seven packs were made where ten were
  // needed and the purchase below could not happen. The bill a probe pays is
  // its own tooling as well as its subject.
  step('smelting iron on the smelter');
  const bi = await smelt('Raw iron', 9, 1);
  check('iron smelted', bi === '', bi);
  step('smelting copper');
  const bc = await smelt('Raw copper', 5, 1);
  check('copper smelted', bc === '', bc);
  of.input.tape([{ hold: 4, actions: ['interact'] }, { hold: 8, keys: [] }]);
  await sleep(0.3);
  log.push(`smelted: ${JSON.stringify(pack())}`);
  check('there is enough iron for a station AND its science', have('Iron') >= 40,
    have('Iron'));
  check('and enough copper', have('Copper') >= 20, have('Copper'));

  // ======================================================================
  // 3. THE BUILD MENU OFFERS IT, AND THE PRICE MOVED FROM SHORT TO AFFORDABLE.
  // ======================================================================
  // ======================================================================
  // 3b. THE SMELTER COMES BACK UP BEFORE THE STATION GOES DOWN, and it is the
  //     same measurement decision §2b made, arrived at from the other side.
  //
  //     Everything this probe places goes 2.2 m ahead of the eye on one yaw,
  //     so a station put down now would stand INSIDE the smelter's bound.
  //     `pickAim` resolves machines FIRST (they are the nearest, largest
  //     objects, and a belt behind one must not steal the press), so the
  //     crosshair kept answering `machine: 1` and `station: null`, and E opened
  //     the smelter rather than the tech tree. MEASURED: `aimed` read
  //     `{"machine":1,...,"station":null}` on the press that was supposed to
  //     open the panel.
  //
  //     WORTH SAYING PLAINLY, because it is a fact about the GAME and not only
  //     about this file: a research station placed inside a machine's bound
  //     cannot be opened with the interact key. That is the documented pick
  //     order working as designed and it is the right order; it is also the
  //     first thing a proximity rule would have to think about. Raised rather
  //     than worked around in the client.
  //
  //     The smelting is finished, so the smelter has done its job and its cost
  //     comes straight back.
  // ======================================================================
  of.look(yaw, -18);
  await sleep(0.3);
  of.input.act(['demolish'], 4);
  await sleep(0.4);
  check('the smelter came back up, clearing the ground for the station',
    G().machines.length === 0, JSON.stringify(G().machines.map((m) => m.tier)));

  step('building the research station');
  const B = () => of.buildMenu();
  const rowOf = (id) => B().rows.find((r) => r.id === id);
  of.input.act(['build'], 4);
  await sleep(0.45);
  check('the build menu opened', B().open === true);
  const row = rowOf(STATION_ID);
  check('the research station has a build-menu tile', row !== undefined,
    B().rows.map((r) => r.id).join(','));
  check('and it is DRAWN as a tile rather than merely listed',
    row?.tile === true, JSON.stringify(row));
  check('its price is /core\'s own', /Iron/i.test(row?.cost ?? ''), row?.cost);
  check('C3: and with the metal smelted it is now AFFORDABLE',
    row?.affordable === true, JSON.stringify(row));
  check('the station is NOT research-locked, because it is what opens research',
    row?.lockedBy === '', row?.lockedBy);
  check('and the picture is a real one rather than its own name',
    document.querySelector(
      `#of-build .of-btile[data-build="${STATION_ID}"] .art img`) !== null);

  // ======================================================================
  // 4. BUILD IT, WITH A REAL CLICK AND A REAL KEY.
  // ======================================================================
  const before = pack();
  const bill = (stations().cost ?? '');
  const sel = `#of-build .of-btile[data-build="${STATION_ID}"]`;
  const tile = document.querySelector(sel);
  check('the tile is in the DOM', tile !== null, sel);
  tile?.dispatchEvent(new PointerEvent('pointerdown',
    { bubbles: true, pointerId: 1, pointerType: 'mouse', button: 0 }));
  await sleep(0.11);
  (document.querySelector(sel) ?? tile)?.click();
  await sleep(0.4);
  check('clicking the tile puts a research station in hand',
    G().hotbar.kind === 'station', JSON.stringify(G().hotbar));
  check('and the menu shut itself so the preview is visible', B().open === false);
  of.look(yaw, -18);
  await sleep(0.2);
  of.input.tape([{ hold: 4, actions: ['use'] }, { hold: 8, keys: [] }]);
  await sleep(0.5);
  const st1 = stations();
  check('THE RESEARCH STATION WENT DOWN', st1.count === 1,
    `${st1.count}, refusals ${st1.refusals}`);
  check('and it is solid, so the player cannot walk through it',
    st1.list[0]?.solid === true, JSON.stringify(st1.list[0]));
  // C3, second half. THE PACK FELL BY EXACTLY THE BILL. Derived from /core's own
  // definition rather than from the digits in this file, so a rebalance moves
  // the assertion with the price instead of breaking it.
  const after = pack();
  const spent = {};
  for (const k of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const d = (before[k] ?? 0) - (after[k] ?? 0);
    if (d !== 0) spent[k] = d;
  }
  log.push(`bill "${bill}" -> spent ${JSON.stringify(spent)}`);
  check('C3: iron was really spent', (spent.Iron ?? 0) > 0, JSON.stringify(spent));
  check('C3: and copper, and stone',
    (spent.Copper ?? 0) > 0 && (spent.Stone ?? 0) > 0, JSON.stringify(spent));
  check('C3: and NOTHING was minted by the placement',
    Object.values(spent).every((v) => v > 0), JSON.stringify(spent));
  check('and the bill each ingredient was quoted at is what left the pack',
    Object.entries(spent).every(([k, v]) => bill.includes(`${v} ${k}`)),
    `"${bill}" vs ${JSON.stringify(spent)}`);

  // ======================================================================
  // 5. THE KEY NOW WORKS, AND SO DOES WALKING UP TO IT.
  // ======================================================================
  step('station built; checking the key');
  check('the gate now reads BUILT', gate().built === true, JSON.stringify(gate()));
  check('and its refusal is empty rather than merely unshown',
    gate().refusal === '', gate().refusal);
  const refused1 = G().progress.refusedResearch;
  await press('research');
  check('THE RESEARCH PANEL OPENS ON THE KEY once a station stands',
    panelOpen() === true, document.querySelector('#of-research')?.className);
  check('C2: and nothing was refused this time',
    G().progress.refusedResearch === refused1,
    `${refused1} -> ${G().progress.refusedResearch}`);
  await press('research');
  check('the key closes it again', panelOpen() === false);

  // INTERACT AT THE STATION. The crosshair is put back on it and the press is
  // the same `interact` action a player uses.
  of.look(yaw, -18);
  await sleep(0.3);
  check('C4: the crosshair actually resolved to the station',
    G().aimed.station !== null, JSON.stringify(G().aimed));
  await press('interact');
  check('INTERACT AT THE STATION OPENS THE TECH TREE', panelOpen() === true,
    document.querySelector('#of-research')?.className);

  // ======================================================================
  // 6. RESEARCH SOMETHING, END TO END, THROUGH IT.
  //
  // READ FROM THE TREE REPORT FIRST, NOT ASSUMED, so this fixture cannot rot
  // the same way twice: the header explains why the Scanning Antenna is the
  // tech bought below, and this is that claim checked against `of.research()`
  // (the same read-only debug op `ruininvest.js` uses) rather than merely
  // asserted in a comment. If a future lane ever gates the antenna too, this
  // fails LOUDLY here instead of the purchase silently refusing three steps
  // down, which is exactly the defect the A6 verifier found in this file.
  // ======================================================================
  step('reading the tree report before spending anything');
  const tree0 = of.research() ?? [];
  const antennaRow0 = tree0.find((t) => t.id === T_SCANNING_ANTENNA);
  const elecRow0 = tree0.find((t) => t.id === T_ELECTRIFICATION);
  check('the Scanning Antenna exists in the tree', antennaRow0 !== undefined,
    JSON.stringify(tree0.map((t) => t.id)));
  check('and it is UNGATED: no prereq and no milestone, straight off the '
    + 'station',
    (antennaRow0?.prereqs?.length ?? -1) === 0 && antennaRow0?.milestone === 0,
    JSON.stringify(antennaRow0));
  check('NEGATIVE CONTROL: Electrification exists and IS milestone-gated, '
    + 'refused by name, naming RuinInvestigated',
    elecRow0?.block === BLOCK_MILESTONE_MISSING
    && elecRow0?.milestone === M_RUIN_INVESTIGATED && elecRow0?.canResearch === false,
    JSON.stringify(elecRow0));

  step('crafting science');
  await press('research');
  await sleep(0.2);
  await press('pack');
  await sleep(0.3);
  check('the pack opened', G().panelOpen === true);
  const rows = () => [...document.querySelectorAll('#of-panel .of-recipe')];
  const rowNamed = (t) => rows().find((e) =>
    (e.querySelector('.nm')?.textContent ?? '').includes(t));
  // WHAT THE CRAFT PANEL AND /core BOTH SAY, CAPTURED BEFORE THE CLICKS.
  //
  // GP-672, and it is GP-622's own lesson turned on this file's last section.
  // A run measured 2026-08-13 reported `real DOM clicks made science: 0 clicks,
  // 0 packs` and NOTHING ELSE, which is compatible with at least five different
  // causes: no rows rendered at all, the row rendered under another name, the
  // button disabled by a research lock, the button disabled because /core
  // refuses the craft (`InputsShort` or `PackFull`), or a live button whose
  // click the client drops. Distinguishing those cost a full hour-long re-run,
  // because the probe recorded a number instead of a state. It records the
  // state now: the DOM's own count and classes beside /core's `block` code for
  // the same recipe, so the next failure names its cause in the report.
  const SCIENCE = 'Automation science';
  const coreRow = () => (G().recipes ?? []).find((r) => r.name === SCIENCE) ?? null;
  const slotsUsed = () => Object.values(pack())
    .reduce((a, c) => a + Math.ceil(c / 100), 0);
  const craftDiag = (when) => {
    const el = rowNamed(SCIENCE);
    const btn = el?.querySelector('button') ?? null;
    return {
      when,
      panelOpen: G().panelOpen,
      domRows: rows().length,
      names: rows().map((e) => e.querySelector('.nm')?.textContent ?? '?').slice(0, 24),
      scienceRowFound: el !== undefined && el !== null,
      scienceRowClass: el?.className ?? null,
      scienceLockText: el?.querySelector('.lock')?.textContent ?? null,
      buttonFound: btn !== null,
      buttonDisabled: btn?.disabled ?? null,
      buttonText: btn?.textContent ?? null,
      // /core's answer to the same question. `block` is a CraftBlock code:
      // 0 none, 1 no recipe, 2 inputs short, 3 pack full.
      core: coreRow(),
      slotsUsed: slotsUsed(),
      pack: pack(),
    };
  };
  const diagBefore = craftDiag('before the science clicks');
  log.push(`science panel before: ${JSON.stringify({
    domRows: diagBefore.domRows, found: diagBefore.scienceRowFound,
    cls: diagBefore.scienceRowClass, disabled: diagBefore.buttonDisabled,
    coreBlock: diagBefore.core?.block, craftable: diagBefore.core?.craftable,
    slotsUsed: diagBefore.slotsUsed })}`);
  let made = 0;
  for (let i = 0; i < 14; ++i) {
    if (click(rowNamed(SCIENCE)?.querySelector('button'))) made++;
    await sleep(0.1);
  }
  const sci = have(SCIENCE);
  const diagAfter = craftDiag('after the science clicks');
  check('real DOM clicks made science', sci >= 10,
    `${made} clicks, ${sci} packs; before=${JSON.stringify(diagBefore)}`
    + ` after=${JSON.stringify(diagAfter)}`);
  await press('pack');
  await sleep(0.2);

  await press('research');
  await sleep(0.3);
  check('the tech tree is up', panelOpen() === true);
  const btnFor = (id) => document.querySelector(`#of-research button[data-tech="${id}"]`);

  // THE NEGATIVE CONTROL, ATTEMPTED FOR REAL, BEFORE THE PURCHASE THAT WORKS
  // (GP-624's pattern: a refusal witnessed as a real attempted action, not
  // merely read off a report). Electrification's button is clicked exactly
  // as a player would click it, and `click()` itself is what proves the
  // refusal: it checks `el.disabled` and dispatches nothing if it is, so a
  // milestone-gated tech that had stopped gating would show up here as a
  // click that actually fires.
  const rBeforeElec = G().progress.research;
  const packBeforeElec = pack();
  const elecClicked = click(btnFor(T_ELECTRIFICATION));
  await sleep(0.3);
  const rAfterElec = G().progress.research;
  check('NEGATIVE CONTROL: the Electrification click is REFUSED (its button '
    + 'is disabled, so the click never dispatches)', elecClicked === false,
    `clicked=${elecClicked}`);
  check('and nothing unlocked from the refused attempt',
    rAfterElec.unlocked === rBeforeElec.unlocked,
    `${rBeforeElec.unlocked} -> ${rAfterElec.unlocked}`);
  check('and nothing was spent on the refused attempt',
    JSON.stringify(pack()) === JSON.stringify(packBeforeElec),
    `${JSON.stringify(packBeforeElec)} -> ${JSON.stringify(pack())}`);

  const rBefore = G().progress.research;
  const bought = click(btnFor(T_SCANNING_ANTENNA));
  await sleep(0.5);
  const rAfter = G().progress.research;
  check('the Research button took a real DOM click', bought === true);
  check('A TECHNOLOGY WAS RESEARCHED, END TO END, THROUGH A BUILT STATION',
    rAfter.unlocked === rBefore.unlocked + 1,
    `${rBefore.unlocked} -> ${rAfter.unlocked}`);
  // THE COST IS THE TREE REPORT'S OWN QUOTE, READ BEFORE ANY SCIENCE WAS
  // CRAFTED (`antennaRow0`), NOT RETYPED AS A DIGIT: the same discipline C3
  // uses for the station's own bill above, so a rebalance moves this
  // assertion with the price instead of breaking it.
  const antennaSciCost = antennaRow0?.cost
    ?.find((c) => c.item === ITEM_AUTOMATION_SCIENCE)?.need ?? -1;
  check('the Scanning Antenna quotes an Automation science cost',
    antennaSciCost > 0, JSON.stringify(antennaRow0?.cost));
  check('and the science was SPENT, exactly what the tree quoted',
    have('Automation science') === sci - antennaSciCost,
    `${sci} -> ${have('Automation science')}, quoted ${antennaSciCost}`);
  check('and a gate the tech held came off',
    rAfter.gatesHeld < rBefore.gatesHeld,
    `${rBefore.gatesHeld} -> ${rAfter.gatesHeld}`);
  await press('research');
  await sleep(0.2);

  // ======================================================================
  // 7. C5. THE GATE READS THE LIVE WORLD, NOT A LATCH.
  //
  //    Take the station back up and press the key again. A gate that had
  //    latched the first time a station appeared would pass every assertion in
  //    this file and fail here, and that is precisely the failure mode a
  //    boolean set once at load time would have.
  // ======================================================================
  step('demolishing to re-test the gate');
  of.look(yaw, -18);
  await sleep(0.3);
  const packBeforeRaze = pack();
  await press('demolish');
  await sleep(0.3);
  const st2 = stations();
  check('C5: the station came back up', st2.count === 0,
    `${st2.count}, removals ${st2.removals}`);
  check('and its cost was refunded in full, because it held nothing',
    (pack().Iron ?? 0) > (packBeforeRaze.Iron ?? 0),
    `${packBeforeRaze.Iron} -> ${pack().Iron}`);
  const refused2 = G().progress.refusedResearch;
  await press('research');
  check('C5: AND THE RESEARCH KEY REFUSES AGAIN', panelOpen() === false,
    document.querySelector('#of-research')?.className);
  check('C5: with the refusal counted again',
    G().progress.refusedResearch === refused2 + 1,
    `${refused2} -> ${G().progress.refusedResearch}`);
  check('C5: and the gate reads unbuilt once more',
    gate().built === false, JSON.stringify(gate()));

  return {
    valid: true,
    pass: fails.length === 0,
    fails,
    log,
    stations: stations(),
    gate: gate(),
    mode: G().mode,
    // GP-672. The craft panel's state on both sides of §6's clicks, in the
    // report rather than only inside a failure string, so it is readable on a
    // GREEN run too. A diagnostic that only exists when something breaks cannot
    // establish what "working" looked like the day before it broke.
    science: { before: diagBefore, after: diagAfter, made, sci },
    carried: G().carried,
  };
})()
