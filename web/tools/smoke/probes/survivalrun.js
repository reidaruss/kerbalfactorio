// survivalrun.js: THE SURVIVAL FULL LOOP (BT-25, stocktake F4).
//
// Every end-to-end proof this project has runs in sandbox, and the economy has
// been retuned piecemeal for days. Nobody has asked the game its own founding
// question: can a FRESH SURVIVAL world reach orbit, and where does it stall?
//
//   npm run probe:survival
//   (survival.mjs builds fresh, serves on an ephemeral port, and drives this
//    file through run.mjs with --scenario=walk and NO sandbox flag.)
//
//   node tools/smoke/run.mjs --scenario=walk \
//        --evalfile=tools/smoke/probes/survivalrun.js
//
// BT-190: this probe never carried a real invocation reachable by
// `probeall.mjs`'s own `extractCmd()`. The `npm run probe:survival` line
// above is the intended entry point (it builds fresh and serves before
// driving this file) but names an npm script, not a `node ... run.mjs`
// line, so it was never a candidate either before or after this fix; the
// old first-match rule instead took a prose line further down ("Mode is
// fixed at boot from the URL and `sandbox()` is read-only by design...") as
// the command, which held zero real flags. Both of those facts point at the
// SAME invocation, though: `--scenario=walk` with no `--sandbox`, so this
// probe's own header states it directly for `probeall.mjs`'s benefit,
// verbatim to what `survival.mjs` already drives it at, which is also
// exactly the runner's bare default -- so the missing header cost nothing
// this probe's own verdict depended on, only the fact that it was
// documented.
//
// THE RULES OF EVIDENCE.
//
// (1) Every stage proves its own setup before its claim is believed, so a
//     failure at minute six names the gate, the pack contents and the cost
//     rather than "undefined is not a function".
// (2) NOTHING IS GRANTED. There is no `of.give` and this probe does not want
//     one. Every item is harvested, smelted or crafted through the same /core
//     calls a player's clicks make; the bay charges for every part; the pilot
//     flies with the input actions a keyboard drives. A refusal is therefore
//     real economic data, not a probe bug.
// (2b) AND NOTHING IS TAKEN OUT OF ORDER (GP-624). GP-506 gated coal, iron and
//     copper behind a crude pickaxe, so the run gathers wood and stone
//     bare-handed (G1), crafts the tool (G2), and only then mines (G2b). A
//     refusal a probe earned by playing illegally is NOT economic data, and
//     reporting one as a stall is the one way rule (3) can lie.
// (3) A DEADLOCK IS THIS PROBE SUCCEEDING AT ITS JOB. It is reported with the
//     gate, the pack, the refusing row and the research state, and NO game
//     constant gets tuned from here. `completed: false` with a precise stall
//     is a verdict, not a failure of the probe (`valid` stays true).
// (4) Assert properties, not vibes (standing rule 11): each gate ends in a
//     measured assertion, and the timeline records sim seconds, wall seconds,
//     daylight and the pack at every gate so the stall analysis writes itself.
//
// Mode is fixed at boot from the URL and `sandbox()` is read-only by design,
// so this file VERIFIES it got survival rather than switching to it, exactly
// the way ascent.js verifies the reverse.
(async () => {
  const of = window.__of;
  if (!of) return { valid: false, kind: 'broken', where: 'setup', why: 'no __of' };

  const wall0 = Date.now();
  // Economic waits run the same sim on fewer rendered frames (renderHz 19.7
  // keeps the fixed-step accumulator at ~3 ticks/frame, safely under Loop.ts's
  // MAX_CATCHUP 5, so no sim time is dropped). Flight runs at 60.7 so the
  // control loop still samples often enough to fly the ribbon.
  const sleep = (n) => of.run(n);
  const sleepEco = (n) => of.run(n, 19.7);
  const sleepFly = (n) => of.run(n, 60.7);

  const fails = [];
  const log = [];
  const timeline = [];
  const check = (name, ok, detail) => {
    if (!ok) fails.push(detail === undefined ? name : `${name}: ${detail}`);
    return ok;
  };
  const pack = () => Object.fromEntries(of.game().carried.map((c) => [c.name, c.count]));
  const have = (n) => pack()[n] ?? 0;
  const simS = () => Math.round(of.world().tick / 60);
  const wallS = () => Math.round((Date.now() - wall0) / 1000);
  const daylight = () => { try { return of.stats().sky.daylight; } catch { return null; } };
  const research = () => of.game().progress?.research ?? null;
  const counters = () => { try { return of.flight('counters'); } catch { return null; } };
  const gate = (name, extra) => {
    timeline.push({ gate: name, simS: simS(), wallS: wallS(), daylight: daylight(),
      pack: pack(), ...(extra ?? {}) });
    log.push(`GATE PASSED  ${name}  (sim ${simS()} s, wall ${wallS()} s)`);
  };
  const finalState = () => ({
    timeline, fails, log, research: research(), counters: counters(),
    goals: (() => { try { return of.goals(); } catch { return null; } })(),
    simS: simS(), wallS: wallS(),
  });
  const stall = (at, why, evidence) => ({
    valid: true, completed: false, stalledAt: at, why,
    evidence: { pack: pack(), ...(evidence ?? {}) }, ...finalState(),
  });
  const broken = (where, why, extra) => ({
    valid: false, kind: 'broken', where, why, ...(extra ?? {}), ...finalState(),
  });

  const BLOCK = { None: 0, NoRecipe: 1, InputsShort: 2, PackFull: 3 };
  const blockName = (b) => Object.keys(BLOCK).find((k) => BLOCK[k] === b) ?? String(b);
  const recipes = () => of.game().recipes;
  const recipeRow = (re) => recipes().find((r) => re.test(r.name)) ?? null;
  const recipeIdx = (re) => recipes().findIndex((r) => re.test(r.name));
  const craftBy = async (re, times = 1) => {
    // of.craft(i) returns true only when /core actually crafted, so a false
    // here IS the refusal, and the row's block code says which kind.
    let made = 0;
    for (let i = 0; i < times; ++i) {
      const idx = recipeIdx(re);
      if (idx < 0) return { made, refusal: { why: `no recipe matches ${re}`, names: recipes().map((r) => r.name) } };
      if (of.craft(idx) !== true) {
        const row = recipes()[idx];
        return { made, refusal: { row, block: blockName(row?.block), pack: pack() } };
      }
      made++;
      await sleepEco(0.05);
    }
    return { made, refusal: null };
  };
  const click = (el) => {
    if (!el || el.disabled) return false;
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
    return true;
  };
  const press = async (code, frames = 6) => { of.input.act([code], frames); await sleep(0.3); };
  const toLatLon = (q) => {
    const rr = Math.hypot(q[0], q[1], q[2]);
    return [(Math.asin(q[1] / rr) * 180) / Math.PI, (Math.atan2(q[2], q[0]) * 180) / Math.PI];
  };

  // ==========================================================================
  // G0. SETUP PROOF. Survival, fresh, on its feet. Nothing below is believed
  //     until this passes.
  // ==========================================================================
  await sleep(1.0);
  for (const fn of ['game', 'flight', 'vab', 'harvest', 'craft', 'hotbar', 'nodes', 'run']) {
    if (typeof of[fn] !== 'function') return broken('G0 setup', `no __of.${fn}`);
  }
  const mode = of.game().mode;
  if (!check('this world is SURVIVAL', mode.sandbox === false && mode.researchGated === true,
    JSON.stringify(mode))) return broken('G0 setup', 'not a survival world', { mode });
  const sb = typeof of.sandbox === 'function' ? of.sandbox() : null;
  check('sandbox() agrees, read-only, mode survival', sb !== null && sb.mode === 'survival',
    JSON.stringify(sb));
  if (!check('the world is FRESH: empty pack', of.game().carried.length === 0,
    JSON.stringify(pack()))) return broken('G0 setup', 'the pack is not empty; this is not a fresh world');
  const r0 = research();
  if (!check('the world is FRESH: nothing researched', r0 !== null && r0.unlocked === 0,
    JSON.stringify(r0))) return broken('G0 setup', 'research already unlocked; not a fresh world', { r0 });
  check('the loop is ticking', of.world().tick > 0, of.world().tick);
  if (!check('a player is standing in it', of.world().player !== null))
    return broken('G0 setup', 'no player (needs --scenario=walk)');
  const f0 = of.flight('report');
  check('the flight lane loaded', f0.loaded === true);
  check('no vessel exists yet', f0.flight.live === false);
  // pads() hands back the LIVE pads object, so it is summarised shallowly and
  // never JSON.stringify'd whole: a live service object drags the scene graph
  // behind it and the stringify dies of string length, not of cycles.
  const padsSummary = () => {
    try {
      const p = typeof of.pads === 'function' ? of.pads() : null;
      if (p === null || p === undefined) return null;
      const list = Array.isArray(p) ? p : (Array.isArray(p.list) ? p.list : null);
      return { count: list === null ? null : list.length, keys: Object.keys(p).slice(0, 12) };
    } catch (e) { return { error: String(e?.message ?? e) }; }
  };
  log.push(`boot: daylight ${daylight()}, techs ${r0.techs}, gatesHeld ${r0.gatesHeld}, `
    + `flight catalogue ${f0.catalogue}, pads ${JSON.stringify(padsSummary())}`);
  gate('G0 fresh survival world');

  // ==========================================================================
  // G1. HAND HARVEST. Six swings a node (the pack overflow in HandCrafter is a
  //     recorded defect; a stuffed pack silently eats craft outputs, so the
  //     pack is kept roomy on purpose).
  //
  //     GP-624. THE ROUND TAKES THE KINDS IT IS ALLOWED TO TAKE, and the gate
  //     decides which those are. GP-506 made coal, iron and copper
  //     `requiresToolFor` (gameplay.h): a bare-hand swing at them is REFUSED by
  //     name, so a first round over every kind refused every ore swing, left
  //     the pack with no raw iron, and STALLED this run at G1 while reporting
  //     it as an economic finding — a probe blaming the game for its own
  //     illegal move, which is the exact failure class rule (1) is about.
  //     Wood and loose stone stay ungated so the pickaxe (Stone x2 + Wood x1)
  //     has a bare-hand path, so G1 is now the bare half, G2 crafts the tool it
  //     pays for, and G2b takes the ore with the tool in hand. Both halves
  //     together are the same one visit per node at six swings the single round
  //     was; the assertions about iron and copper are MOVED to G2b, not dropped.
  // ==========================================================================
  //     GP-672. AND THE PACK GUARD WAS STRUCTURALLY INCAPABLE OF FIRING, which
  //     is the defect that made the split above dangerous rather than merely
  //     necessary. `if (of.game().carried.length >= 19) break` reads the number
  //     of ITEM TYPES, because `GameCore.carried()` collapses the pack to one
  //     line per type: with five raw resources it reports `5` while the pack is
  //     genuinely full, and taking wood and stone ALONE it reports `2` for ever.
  //     GP-611 found and fixed exactly this line in `research.js`; this file
  //     kept the original. MEASURED on the same split in `padgate.js`, which had
  //     no budget either: `373 swings -> {Wood: 1400, Stone: 600}`, which at 100
  //     to a stack is **20 of 20 slots**, and the next craft was refused
  //     `PackFull`. Here that would have stalled G2 and reported "the crude
  //     pickaxe refuses with its inputs in hand" -- a probe that filled its own
  //     pack, blaming the game for the refusal it earned. A guard that cannot
  //     fail is worse than no guard, because it reads as a guard.
  //
  //     So: a per-RESOURCE budget (a node count is world-gen's to move), read
  //     ONCE per node (a `pack()` is a whole world report, GP-622), a node whose
  //     own resource is already satisfied SKIPPED so a scarce vein cannot keep
  //     every tree on the way paying out, and a REAL slot count as the backstop.
  //     Sized to leave room for the crafts that follow rather than to hoard: the
  //     `restock()` loop below is what the later gates lean on, and it works
  //     because the pack has somewhere to put the next haul.
  const BARE = [0, 1];         // Tree, Rock — bare hands are allowed here
  const GATED = [2, 3, 4, 5];  // CoalSeam, IronOre, CopperOre, WaterPool
  const KIND_ITEM = { 0: 'Wood', 1: 'Stone', 2: 'Coal', 3: 'Raw iron',
    4: 'Raw copper', 5: 'Water' };
  const WANT = { Wood: 200, Stone: 200, Coal: 300, 'Raw iron': 300,
    'Raw copper': 200, Water: 100 };
  // A REAL slot count (GP-611's own helper): raw resources stack to 100, and a
  // tool or a machine item is a slot of its own. Taken from a pack ALREADY read
  // this iteration, never by reading it again: one world report per node.
  const slotsIn = (p) => Object.values(p).reduce((a, c) => a + Math.ceil(c / 100), 0);
  const harvestRound = async (kinds = [...BARE, ...GATED]) => {
    let swings = 0, ok = 0;
    const want = kinds.map((k) => KIND_ITEM[k]).filter((i) => i !== undefined);
    for (const n of of.nodes()) {
      if (!kinds.includes(n.kind)) continue;
      const p = pack();
      if (slotsIn(p) >= 18) break;
      if (!want.some((i) => (p[i] ?? 0) < WANT[i])) break;
      const item = KIND_ITEM[n.kind];
      if ((p[item] ?? 0) >= WANT[item]) continue;
      for (let k = 0; k < 6; ++k) {
        swings++;
        if (of.harvest(n.index).ok) ok++;
      }
    }
    await sleepEco(0.2);
    return { swings, ok };
  };
  const h1 = await harvestRound(BARE);
  log.push(`harvest round 1 (bare hands, wood + stone): ${h1.ok}/${h1.swings} swings `
    + `landed, pack ${JSON.stringify(pack())}`);
  if (!check('the clearing yielded wood', have('Wood') > 0)
    || !check('the clearing yielded loose stone', have('Stone') > 0)) {
    return stall('G1 hand harvest', 'the spawn clearing does not yield the bootstrap raws by hand',
      { round: h1, nodeKinds: of.nodes().map((n) => n.kind) });
  }
  // THE GATE, WITNESSED RATHER THAN ASSUMED. A negative control costs one swing
  // and is what separates "the ore came later" from "the ore was never gated".
  const oreNode = of.nodes().find((n) => [2, 3, 4].includes(n.kind));
  const bareOre = oreNode === undefined ? null : of.harvest(oreNode.index);
  check('bare hands are REFUSED at ore, by name (ToolRequired), not by silence',
    bareOre !== null && bareOre.ok === false
    && bareOre.refusal !== null && bareOre.refusal !== undefined
    && bareOre.refusal.code === 1,
    JSON.stringify(bareOre));
  gate('G1 hand harvest', { swings: h1.swings, landed: h1.ok,
    bareOreRefusal: bareOre?.refusal ?? null });

  // ==========================================================================
  // G2. HAND TOOLS. The first craft of the game, and now also the thing that
  //     unlocks the second half of the harvest.
  // ==========================================================================
  const pickaxe = await craftBy(/crude pickaxe/i, 1);
  if (pickaxe.made < 1) {
    return stall('G2 hand tools', 'the crude pickaxe refuses with its inputs in hand',
      pickaxe.refusal);
  }
  gate('G2 hand tools');

  // ==========================================================================
  // G2b. THE ORE THE TOOL UNLOCKS. The two assertions that used to sit in G1
  //      and could not be met there any more, asked at the first point in the
  //      run where a player could legally meet them.
  // ==========================================================================
  const h2 = await harvestRound(GATED);
  log.push(`harvest round 2 (tooled, coal + ore): ${h2.ok}/${h2.swings} swings landed, `
    + `pack ${JSON.stringify(pack())}`);
  if (!check('the clearing yielded raw iron', have('Raw iron') > 0)
    || !check('the clearing yielded raw copper', have('Raw copper') > 0)) {
    return stall('G2b tooled harvest',
      'the spawn clearing does not yield ore even with a pickaxe in hand',
      { round: h2, pickaxes: have('Crude pickaxe'), nodeKinds: of.nodes().map((n) => n.kind) });
  }
  gate('G2b tooled harvest', { swings: h2.swings, landed: h2.ok });

  // ==========================================================================
  // G3. THE FURNACE: crafted, placed, loaded, and the first ingots out.
  // ==========================================================================
  const furnaceRe = /furnace/i;
  const furnaceCraft = await craftBy(furnaceRe, 1);
  if (furnaceCraft.made < 1) {
    return stall('G3 furnace', 'the furnace cannot be crafted', furnaceCraft.refusal);
  }
  const homeYaw = of.world().observer.yawDeg;
  const home = toLatLon(of.world().player.feet);
  const furnaceSlot = (() => {
    const bar = of.game().hotbar;
    const i = bar?.slots?.findIndex((s) => furnaceRe.test(s.part ?? '')) ?? -1;
    return i >= 0 ? i : 2; // research.js's known slot as the fallback
  })();
  let furnaceDown = false;
  for (const pitch of [-18, -14, -24, -30, -10]) {
    of.look(homeYaw, pitch);
    await sleep(0.2);
    of.hotbar(furnaceSlot);
    await sleep(0.15);
    const before = of.game().machines.length;
    of.input.tape([{ hold: 4, actions: ['use'] }, { hold: 8, keys: [] }]);
    await sleep(0.5);
    if (of.game().machines.length > before) { furnaceDown = true; break; }
  }
  if (!furnaceDown) {
    return broken('G3 furnace', 'the crafted furnace would not place at any tried pitch',
      { slot: furnaceSlot, hotbar: of.game().hotbar });
  }
  const openFurnace = async () => {
    for (const pitch of [-18, -14, -24, -30]) {
      of.look(homeYaw, pitch);
      await sleep(0.15);
      of.input.tape([{ hold: 4, actions: ['interact'] }, { hold: 10, keys: [] }]);
      await sleep(0.4);
      if (of.game().furnaceOpen === true) return true;
    }
    return false;
  };
  const closeFurnace = async () => {
    if (of.game().furnaceOpen === true) {
      of.input.tape([{ hold: 4, actions: ['interact'] }, { hold: 8, keys: [] }]);
      await sleep(0.3);
    }
  };
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
  let fuelOut = false;
  const smeltAll = async (ore) => {
    // One ore type at a time; five units a load at 180 ticks a smelt, so each
    // batch waits out ~900 ticks of sim.
    let batches = 0;
    while (have(ore) > 0 && batches < 24) {
      if (!load('Coal') && !load('Wood')) { fuelOut = true; return batches; }
      await sleep(0.05);
      if (!load(ore)) return batches;
      await sleepEco(17);
      take();
      await sleep(0.2);
      batches++;
    }
    return batches;
  };
  if (!(await openFurnace())) {
    return broken('G3 furnace', 'the placed furnace would not open on interact',
      { machines: of.game().machines.length });
  }
  const ironBatches = await smeltAll('Raw iron');
  const copperBatches = await smeltAll('Raw copper');
  await closeFurnace();
  log.push(`smelted: ${ironBatches} iron + ${copperBatches} copper batches, `
    + `fuelOut ${fuelOut}, pack ${JSON.stringify(pack())}`);
  if (!check('iron came out of the furnace', have('Iron') > 0)) {
    return stall('G3 furnace', 'ore went in and no iron came out (or no batch could be loaded)',
      { ironBatches, copperBatches, fuelOut });
  }
  check('copper came out of the furnace', have('Copper') > 0);
  gate('G3 furnace and first ingots', { ironBatches, copperBatches, fuelOut });

  // The restock loop the later gates lean on when a cost refuses: harvest what
  // the clearing still offers, smelt it, and record the yield of every round so
  // depletion is a measured curve rather than a guess.
  const restockLog = [];
  let restocks = 0;
  const restock = async () => {
    if (restocks >= 8) return false;
    restocks++;
    const before = pack();
    of.look(homeYaw, 0);
    await sleep(0.1);
    const h = await harvestRound();
    let smelted = 0;
    if (have('Raw iron') > 0 || have('Raw copper') > 0) {
      if (await openFurnace()) {
        smelted += await smeltAll('Raw iron');
        smelted += await smeltAll('Raw copper');
        await closeFurnace();
      }
    }
    const round = { n: restocks, swingsLanded: h.ok, batches: smelted,
      ironNow: have('Iron'), copperNow: have('Copper') };
    restockLog.push(round);
    log.push(`restock ${JSON.stringify(round)}`);
    const after = pack();
    return JSON.stringify(before) !== JSON.stringify(after);
  };

  // ==========================================================================
  // G4. SCIENCE, made by hand from self-made ingots.
  // ==========================================================================
  const sciRe = /automation science/i;
  const ensureScience = async (want) => {
    while (have('Automation science') < want) {
      const need = want - have('Automation science');
      const r = await craftBy(sciRe, need);
      if (have('Automation science') >= want) return true;
      if (r.refusal !== null && r.refusal.row?.block === BLOCK.PackFull) {
        log.push(`science: PACK FULL at ${JSON.stringify(pack())}`);
        return false;
      }
      if (!(await restock())) return false;
    }
    return true;
  };
  if (!(await ensureScience(10))) {
    return stall('G4 science', 'ten Automation science are not reachable from the hand economy',
      { row: recipeRow(sciRe), restockLog });
  }
  gate('G4 science packs', { science: have('Automation science') });

  // ==========================================================================
  // G5. RESEARCH, bought with a real click on the real button, then buy
  //     everything the hand economy can still afford. The tree snapshot before
  //     and after is part of the report.
  // ==========================================================================
  const treeSnap = () => [...document.querySelectorAll('#of-research [data-tech][data-state]')]
    .map((e) => ({ tech: e.getAttribute('data-tech'), state: e.getAttribute('data-state'),
      why: (e.querySelector('.why')?.textContent ?? '').trim() }));
  const btnFor = (id) => document.querySelector(`#of-research button[data-tech="${id}"]`);

  // D-019. THE STATION FIRST, because the screen now has a building.
  //
  // A REAL RULE CHANGE and a real rung of the survival economy, which is what
  // this file measures: the research screen refuses to open until a research
  // station has been built, so a fresh survival world's route to the tech tree
  // now runs through 20 Iron + 30 Stone + 10 Copper. It is earned through the
  // same `restock` loop everything else here is earned through, and a world
  // that cannot pay for one STALLS with that named, which is the honest report
  // for a run whose whole question is "where does a fresh survival world stop".
  const STATION_TILE = '#of-build .of-btile[data-build="researchstation"]';
  const stationCost = () => of.stations()?.cost ?? '';
  for (let tries = 0; tries < 4 && (of.stations()?.canAfford ?? false) !== true; ++tries) {
    if (!(await restock())) break;
  }
  if (!check('a research station is affordable', of.stations()?.canAfford === true,
    `${stationCost()} vs ${JSON.stringify(pack())}`)) {
    return stall('G5 research station',
      'the hand economy cannot pay for a research station, so the tech tree is unreachable',
      { cost: stationCost(), restockLog });
  }
  of.input.act(['build'], 4);
  await sleep(0.45);
  const stTile = document.querySelector(STATION_TILE);
  if (!check('the build menu offers a research station', stTile !== null, STATION_TILE)) {
    return broken('G5 research station', 'no research-station tile in the build menu');
  }
  stTile.dispatchEvent(new PointerEvent('pointerdown',
    { bubbles: true, pointerId: 1, pointerType: 'mouse', button: 0 }));
  await sleep(0.11);
  (document.querySelector(STATION_TILE) ?? stTile).click();
  await sleep(0.4);
  of.look(homeYaw, -18);
  await sleep(0.2);
  of.input.tape([{ hold: 4, actions: ['use'] }, { hold: 8, keys: [] }]);
  await sleep(0.5);
  if (!check('the research station went down', (of.stations()?.count ?? 0) >= 1,
    JSON.stringify(of.stations()))) {
    return stall('G5 research station', 'the research station would not place',
      { stations: of.stations(), restockLog });
  }
  gate('G5 research station', { stations: of.stations()?.count ?? 0,
    cost: stationCost() });

  await press('KeyJ');
  await sleep(0.4);
  const panel = document.querySelector('#of-research');
  if (!check('the research panel opened on J', !!panel && panel.classList.contains('open'),
    panel?.className)) return broken('G5 research', 'no research panel');
  const treeBefore = treeSnap();
  log.push(`tree at first open: ${JSON.stringify(treeBefore)}`);

  const bought = [];
  for (let round = 0; round < 12; ++round) {
    const avail = treeSnap().filter((c) => c.state === 'available');
    if (avail.length === 0) {
      // Blocked purely on science? Earn more and try again; any other block
      // (prereq, deed, off-world) is a wall this probe respects and reports.
      const onScience = treeSnap().filter((c) => c.state === 'blocked' && /science/i.test(c.why));
      if (onScience.length === 0) break;
      await press('KeyJ');
      const got = await ensureScience(have('Automation science') + 10);
      await press('KeyJ');
      await sleep(0.3);
      if (!got) break;
      continue;
    }
    let boughtAny = false;
    for (const c of avail) {
      const before = research().unlocked;
      if (!click(btnFor(c.tech))) continue;
      await sleep(0.4);
      if (research().unlocked > before) {
        bought.push(c.tech);
        boughtAny = true;
        log.push(`researched ${c.tech} (science left ${have('Automation science')})`);
      }
    }
    if (!boughtAny) break;
  }
  const treeAfter = treeSnap();
  await press('KeyJ');
  const rNow = research();
  if (!check('at least one tech was bought', rNow.unlocked >= 1, JSON.stringify(rNow))) {
    return stall('G5 research', 'no tech is purchasable with hand-made science',
      { treeBefore, treeAfter, restockLog });
  }
  check('gates held went down', rNow.gatesHeld < r0.gatesHeld,
    `${r0.gatesHeld} -> ${rNow.gatesHeld}`);
  gate('G5 research', { bought, unlocked: rNow.unlocked, treeAfter });

  // ==========================================================================
  // G6. AUTOMATION: build what research unlocked. Best effort, honestly
  //     reported: the orbit verdict does not hang on this gate unless the
  //     rocket later starves for what automation would have produced.
  // ==========================================================================
  const automation = { attempted: [], placed: [], producing: false, notes: [] };
  {
    for (const re of [/power pole/i, /generator/i, /drill/i, /smelter/i]) {
      const row = recipeRow(re);
      if (row === null) { automation.notes.push(`no recipe matching ${re}`); continue; }
      const r = await craftBy(re, 1);
      automation.attempted.push({ name: row.name, made: r.made,
        refusal: r.made > 0 ? null : r.refusal });
      if (r.made === 0 && r.refusal?.row?.block === BLOCK.InputsShort) {
        if (await restock()) {
          const r2 = await craftBy(re, 1);
          if (r2.made > 0) automation.attempted[automation.attempted.length - 1].made = 1;
        }
      }
    }
    // A drill needs ore under it: stand on the richest patch, sweep for a legal
    // ghost, and read the rate off the ghost rather than assuming one.
    const drillIdx = of.game().hotbar?.slots?.findIndex((s) => /drill/i.test(s.part ?? '')) ?? -1;
    const patches = (of.game().ore && of.game().ore.list) || [];
    const richest = patches.reduce((a, b) => (a === null || b.grade > a.grade ? b : a), null);
    if (drillIdx >= 0 && richest !== null && have('Mining drill') + have('Drill') > 0) {
      const [plat, plon] = toLatLon(richest.centre);
      of.teleport(plat, plon, 2);
      await sleep(0.8);
      const baseYaw = of.world().observer.yawDeg;
      of.hotbar(drillIdx);
      await sleep(0.1);
      let placedDrill = false;
      const beforeB = of.game().factory.buildings;
      outer: for (const turn of [0, 90, 180, 270]) {
        for (let pitch = -10; pitch >= -60; pitch -= 2) {
          of.look(baseYaw + turn, pitch);
          await sleep(0.04);
          const g = of.build().ghost;
          if (g === null || !g.ok || g.patch < 0) continue;
          of.input.tape([{ hold: 1, actions: ['use'] }, { hold: 5, keys: [] }]);
          await sleep(0.5);
          if (of.game().factory.buildings > beforeB) { placedDrill = true; break outer; }
        }
      }
      if (placedDrill) {
        automation.placed.push('drill');
        const c0 = counters();
        await sleepEco(20);
        const c1 = counters();
        automation.producing = c1.minedFromNodes > c0.minedFromNodes;
        automation.notes.push(`mined ${c0.minedFromNodes} -> ${c1.minedFromNodes} in 20 s`);
      } else {
        automation.notes.push('no legal drill ghost found on the richest patch');
      }
      of.hotbar(0);
      of.teleport(home[0], home[1], 2);
      await sleep(0.8);
    } else {
      automation.notes.push(`drill unavailable (slot ${drillIdx}, `
        + `patches ${patches.length}, in pack ${have('Mining drill') + have('Drill')})`);
    }
  }
  if (automation.producing) gate('G6 automation producing', automation);
  else log.push(`G6 automation NOT passed: ${JSON.stringify(automation)}`);

  // ==========================================================================
  // G7. THE BAY, in survival. What does it offer, and does it charge?
  // ==========================================================================
  of.vab('enter');
  await sleep(0.4);
  const V = () => of.vab('report');
  if (!check('the bay opened in survival', V().open === true, JSON.stringify(V()))) {
    return stall('G7 bay', 'the assembly bay refuses to open in survival',
      { vab: V(), pads: padsSummary() });
  }
  const cat = of.vab('catalogue');
  if (!check('the survival catalogue is not empty', Array.isArray(cat) && cat.length > 0,
    JSON.stringify(cat))) {
    return stall('G7 bay', 'the survival part catalogue is empty', { catalogue: cat });
  }
  log.push(`survival catalogue (${cat.length}): ${JSON.stringify(cat)}`);
  gate('G7 bay entered', { catalogueCount: cat.length });

  // ==========================================================================
  // G8. THE VEHICLE, paid for part by part. The reference stack is /core's own
  //     acceptance vehicle; a part the catalogue does not OFFER and a part the
  //     pack cannot AFFORD are different findings and are reported apart.
  // ==========================================================================
  const PID = {
    CommandPod: 0x0100, TankLiquidSmall: 0x0101, TankLiquidSmallLong: 0x0102,
    EngineLiquidSmall: 0x0103, EngineVacuumSmall: 0x0104,
    DecouplerStackSmall: 0x0106, Parachute: 0x010a, Fin: 0x010b,
  };
  const idxOf = (id) => (of.vab('catalogue').find((c) => c.id === id)?.index ?? -1);
  const placeAttempt = async (pid) => {
    const i = idxOf(pid);
    if (i < 0) return { placed: false, offered: false };
    of.vab('frame');
    of.vab('take', i);
    await sleep(0.12);
    const parts = V().parts;
    let res;
    if (parts.length === 0) res = of.vab('place');
    else {
      let low = parts[0];
      for (const p of parts) if (p.origin[1] < low.origin[1]) low = p;
      const nodes = of.vab('nodes').filter((n) => n.parent === low.handle
        && n.onScreen && (n.kind === 'bottom' || n.kind === 'interstage'));
      if (nodes.length === 0) return { placed: false, offered: true, why: 'no attach node on screen' };
      of.vab('hover', nodes[0].ndc[0], nodes[0].ndc[1]);
      res = of.vab('place');
    }
    await sleep(0.15);
    const placed = V().parts.length > parts.length;
    return { placed, offered: true, res, message: V().message ?? null,
      row: of.vab('catalogue').find((c) => c.id === pid) ?? null };
  };
  of.vab('press', 'clear');
  await sleep(0.15);
  const stack = [PID.CommandPod, PID.Parachute, PID.TankLiquidSmall, PID.EngineVacuumSmall,
    PID.DecouplerStackSmall, PID.TankLiquidSmallLong, PID.EngineLiquidSmall];
  const missing = [];
  const packBeforeVehicle = pack();
  for (const pid of stack) {
    let a = await placeAttempt(pid);
    if (!a.offered) { missing.push(pid.toString(16)); continue; }
    // A cost refusal gets the restock loop, bounded, and every loop is logged.
    let tries = 0;
    while (!a.placed && tries < 3) {
      log.push(`part 0x${pid.toString(16)} refused: ${JSON.stringify({ message: a.message, row: a.row })}`);
      if (!(await restock())) break;
      of.vab('enter');
      await sleep(0.2);
      a = await placeAttempt(pid);
      tries++;
    }
    if (!a.placed) {
      of.vab('leave');
      return stall('G8 vehicle', `part 0x${pid.toString(16)} cannot be placed in survival`,
        { attempt: a, catalogueRow: a.row, restockLog, packBeforeVehicle,
          partsSoFar: V().parts.length });
    }
  }
  const packAfterStack = pack();
  check('the bay CHARGED the pack for the stack',
    JSON.stringify(packBeforeVehicle) !== JSON.stringify(packAfterStack),
    'pack unchanged after placing the whole stack');
  // Fins, four in one press if the symmetry control is there.
  const symBtn = document.querySelector('[data-vab="sym"][data-n="4"]');
  if (symBtn) symBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await sleep(0.1);
  const finIdx = idxOf(PID.Fin);
  if (finIdx >= 0) {
    of.vab('frame');
    of.vab('take', finIdx);
    await sleep(0.1);
    const parts = V().parts;
    const tank = parts.find((p) => p.partId === PID.TankLiquidSmallLong);
    const radial = of.vab('nodes').filter((n) => n.kind === 'radial' && n.onScreen
      && (tank === undefined || n.parent === tank.handle));
    if (radial.length > 0) {
      of.vab('hover', radial[0].ndc[0], radial[0].ndc[1]);
      of.vab('place');
      await sleep(0.2);
    }
  }
  of.vab('drop');
  const vr = V();
  const stats = vr.stats ?? null;
  log.push(`vehicle: ${vr.parts.length} parts, stats ${JSON.stringify(stats)}, `
    + `missing ${JSON.stringify(missing)}, paid from ${JSON.stringify(packBeforeVehicle)} `
    + `to ${JSON.stringify(packAfterStack)}`);
  check('the vehicle assembled with a usable stage count', vr.parts.length >= 7,
    `${vr.parts.length} parts`);
  check('its delta-v is orbit-shaped (>3500 m/s against ~3700 used by /core\'s reference)',
    stats !== null && stats.totalDeltaV > 3500, `${stats && stats.totalDeltaV}`);
  if (stats !== null && stats.stable !== true) {
    log.push(`NOTE: not statically stable (margin ${stats.staticMarginM}); flying anyway`);
  }
  gate('G8 vehicle assembled and paid for', { parts: vr.parts.length, stats, missing });

  // ==========================================================================
  // G9. ROLL OUT AND BOARD. The launch key from inside the bay, the walk, and
  //     a REAL keyboard event for the boarding itself.
  // ==========================================================================
  const F = () => of.flight('report');
  const FL = () => F().flight;
  of.input.act(['board'], 8);
  await sleep(0.6);
  let r = F();
  if (!check('a vessel rolled out', r.rollouts >= 1 && r.flight.live === true,
    JSON.stringify({ rollouts: r.rollouts, live: r.flight.live, message: r.message }))) {
    return stall('G9 rollout', 'the launch key refused to roll the vessel out',
      { flight: r, pads: padsSummary() });
  }
  check('it is held by the clamp', r.flight.status === 'CLAMPED', r.flight.status);
  for (let i = 0; i < 16 && F().distanceToVesselM > 10; ++i) {
    of.input.act(['forward'], 30);
    await sleep(0.6);
  }
  r = F();
  if (r.aboard !== true) {
    if (!check('the player reached boarding range', r.distanceToVesselM <= r.boardRangeM,
      `${r.distanceToVesselM} m vs ${r.boardRangeM} m`)) {
      return stall('G9 rollout', 'could not walk into boarding range',
        { distanceM: r.distanceToVesselM, rangeM: r.boardRangeM });
    }
    const codeFor = (action) => (of.input.bindings()[action] || [])[0];
    const code = codeFor('board');
    window.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true }));
    await new Promise((res) => setTimeout(res, 60));
    window.dispatchEvent(new KeyboardEvent('keyup', { code, bubbles: true }));
    await sleep(0.4);
  }
  r = F();
  if (!check('the player is aboard', r.aboard === true, JSON.stringify(r))) {
    return stall('G9 rollout', 'boarding refused in range', { flight: r });
  }
  gate('G9 rolled out and aboard');

  // ==========================================================================
  // G10. THE ASCENT, flown with keys on the guidance ribbon. The clamp only
  //      releases what a TWR above 1 earns, so a heavy cheap rocket stalls
  //      RIGHT HERE and that is a finding about the economy, not about flight.
  // ==========================================================================
  of.input.act(['throttleFull'], 4);
  await sleep(0.4);
  const aglOnPad = FL().altitudeAglM;
  of.input.act(['stage'], 6);
  await sleep(0.6);
  r = F();
  if (!check('the engine lit and the clamp released',
    r.flight.thrustN > 0 && r.flight.status !== 'CLAMPED',
    `thrust ${r.flight.thrustN} N, status ${r.flight.status}, twr ${r.flight.twr}`)) {
    return stall('G10 ascent', 'the clamp refused release (TWR below 1, or the engine never lit)',
      { twr: r.flight.twr, thrustN: r.flight.thrustN, massKg: r.flight.massKg ?? null,
        status: r.flight.status, stats });
  }
  await sleepFly(3);
  const aglAfter = FL().altitudeAglM;
  if (!check('IT LEFT THE GROUND', FL().liftedOff === true && aglAfter > aglOnPad + 5,
    `agl ${aglOnPad} -> ${aglAfter}`)) {
    return stall('G10 ascent', 'thrust without liftoff', { aglOnPad, aglAfter, twr: FL().twr });
  }
  gate('G10 liftoff', { twr: r.flight.twr });

  const TARGET_APO_M = 80000;
  let stagedAt = -1, cutoffAt = -1, coasting = false, warpSet = false;
  for (let i = 0; i < 900 && !coasting; ++i) {
    const s = FL();
    const rd = of.flight('readout');
    if (!warpSet && s.altitudeDatumM > 30000) { of.input.act(['warpUp'], 4); warpSet = true; }
    if (s.thrustN <= 0 && s.throttle > 0.5 && s.nextStage >= 0
      && s.liftedOff === true && s.metS > 10 && stagedAt < 0) {
      of.input.act(['stage'], 6);
      await sleepFly(0.25);
      stagedAt = s.metS;
    }
    if (s.altitudeAglM > 2000 && s.bound && s.apoapsisM >= TARGET_APO_M) {
      of.input.act(['throttleCut'], 4);
      await sleepFly(0.2);
      of.input.act(['sasMode'], 4);
      await sleepFly(0.2);
      cutoffAt = s.metS;
      coasting = true;
      break;
    }
    const err = rd.guidance === null ? 0 : rd.guidance.pitchDeg - rd.pitchDeg;
    const frames = Math.max(1, Math.min(9, Math.round(Math.abs(err) * 3)));
    if (err < -0.7) of.input.act(['pitchDown'], frames);
    else if (err > 0.7) of.input.act(['pitchUp'], frames);
    await sleepFly(0.22);
    if (s.status === 'DOWN') break;
  }
  if (!check('the apoapsis was raised to target and the engine cut', coasting === true,
    `cutoff ${cutoffAt}, staged ${stagedAt}, alt ${FL().altitudeDatumM}, apo ${FL().apoapsisM}, `
    + `dv left ${FL().remainingDvMS}`)) {
    return stall('G10 ascent', 'the vehicle could not raise its apoapsis to 80 km',
      { flight: FL(), stagedAt, stats });
  }
  gate('G10 ascent flown', { stagedAt, cutoffAt });

  // ==========================================================================
  // G11. CIRCULARISE AND THE ORBIT. Lead the apoapsis by half the burn, cut at
  //      minimum eccentricity, and require BOTH apses above the 60 km ceiling.
  // ==========================================================================
  const MU = 3.5316e12;
  const R0 = 600000;
  of.input.act(['warpUp'], 4); await sleepFly(0.15);
  of.input.act(['warpUp'], 4); await sleepFly(0.15);
  let burning = false, eccMin = 1e9;
  for (let i = 0; i < 900; ++i) {
    const s0 = FL();
    if (!burning) {
      const rNow = R0 + s0.altitudeDatumM;
      const vr2 = s0.verticalMS;
      const vh = Math.sqrt(Math.max(0, s0.speedMS * s0.speedMS - vr2 * vr2));
      const aRad = MU / (rNow * rNow) - (vh * vh) / rNow;
      const tToApo = vr2 > 0 && aRad > 0 ? vr2 / aRad : 1e9;
      const rApo = R0 + s0.apoapsisM;
      const rPeri = R0 + s0.periapsisM;
      const a = 0.5 * (rApo + rPeri);
      const vApo = Math.sqrt(Math.max(0, MU * (2 / rApo - 1 / a)));
      const dvNeed = Math.sqrt(MU / rApo) - vApo;
      const mdot = 16.9953;
      const ve = 360 * 9.80665;
      let burnEstS = (s0.massKg / mdot) * (1 - Math.exp(-dvNeed / ve));
      if (!Number.isFinite(burnEstS) || burnEstS <= 0) burnEstS = 40;
      if (s0.inSpace && s0.bound && tToApo <= 0.5 * burnEstS) {
        of.input.act(['warpDown'], 4); await sleepFly(0.15);
        of.input.act(['warpDown'], 4); await sleepFly(0.15);
        of.input.act(['throttleFull'], 4);
        await sleepFly(0.25);
        burning = true;
      }
    } else {
      if (s0.eccentricity < eccMin) eccMin = s0.eccentricity;
      else if (s0.eccentricity > eccMin + 1e-6 && eccMin < 0.30) {
        of.input.act(['throttleCut'], 4);
        await sleepFly(0.25);
        break;
      }
      if (s0.remainingDvMS <= 1) break;
    }
    await sleepFly(0.25);
    if (FL().status === 'DOWN') break;
  }
  await sleepFly(1);
  const s = FL();
  const orbit = { apoapsisM: s.apoapsisM, periapsisM: s.periapsisM,
    eccentricity: s.eccentricity, periodS: s.periodS, remainingDvMS: s.remainingDvMS,
    onRails: s.onRails, inSpace: s.inSpace, bound: s.bound };
  if (!check('a STABLE orbit: both apses above the 60 km atmosphere',
    s.bound === true && s.apoapsisM > 60000 && s.periapsisM > 60000,
    JSON.stringify(orbit))) {
    return stall('G11 orbit', 'the vehicle flew but could not close a stable orbit',
      { orbit, eccMin, stats });
  }
  check('delta-v remains (running dry strands the pilot)', s.remainingDvMS > 0,
    `${s.remainingDvMS} m/s`);
  check('/core has it on rails in space', s.onRails === true && s.inSpace === true,
    JSON.stringify({ onRails: s.onRails, inSpace: s.inSpace }));
  gate('G11 STABLE ORBIT', { orbit });

  // The factory question, asked from orbit if automation went down.
  const cEnd = counters();
  if (automation.producing) {
    check('the ground factory kept producing during the flight',
      cEnd.minedFromNodes > 0, JSON.stringify(cEnd));
  }

  return {
    valid: true, completed: true, verdict: 'a fresh survival world REACHED STABLE ORBIT',
    orbit, vehicleStats: stats, automation, restockLog, catalogue: cat,
    packAtEnd: pack(), ...finalState(),
  };
})()
