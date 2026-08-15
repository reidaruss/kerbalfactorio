// GP-61 to GP-64: LEFT-CLICKING A MACHINE OPENS ITS SCREEN, the screen shows
// input / fuel / output with click-to-take and click-to-put, the progress bar is
// the SIM'S OWN counter, and routine production no longer throws a toast across
// the whole planet.
//
//   node tools/smoke/run.mjs --scenario=walk \
//        --evalfile=tools/smoke/probes/machinepanel.js
//
// EVERY CLICK BELOW IS A REAL PointerEvent WITH A HUMAN PRESS DURATION (110 ms),
// never `act('use')`. That is not belt and braces: an inert left button survived
// twenty green probes on the action path (probes/realclick.js was written to
// catch it), because the action tape sets the intent flag and never touches the
// DOM. A press duration is part of the assertion too, since one lane is fixing a
// one-click-places-many bug in the same family right now: a 110 ms press must
// open ONE screen and place NOTHING.
//
// WHY THE BAR IS NEVER SAMPLED AT EXACTLY 100. `Furnace::tick` completes a unit
// and zeroes `progress_` in the SAME tick, so a state with progress == 180 does
// not exist for any observer. "Reaches 100% once per unit" is therefore asserted
// as the property it really is: the bar SWEEPS to its top and RESETS exactly
// once per unit produced, and on every one of the samples in between it equals
// the sim's own counter rather than a client-side animation of it.
(async () => {
  const of = window.__of;
  if (!of) return { valid: false, why: 'no __of' };
  const el = document.querySelector('canvas');
  if (!el) return { valid: false, why: 'no canvas' };

  const sleep = (n) => of.run(n);
  const fails = [];
  const log = [];
  const check = (name, ok, detail) => {
    if (!ok) fails.push(detail === undefined ? name : `${name}: ${detail}`);
    return ok;
  };
  const V = (a) => Math.hypot(a[0], a[1], a[2]);
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

  // A REAL press. `hold` in seconds; 0.11 is a human click.
  const opts = { bubbles: true, pointerId: 1, pointerType: 'mouse', button: 0 };
  const realClick = async (hold = 0.11) => {
    el.dispatchEvent(new PointerEvent('pointerdown', opts));
    await sleep(hold);
    el.dispatchEvent(new PointerEvent('pointerup', opts));
    await sleep(0.25);
  };

  // Point the crosshair at a body-frame position as squarely as possible.
  const aimAt = async (want) => {
    let bestYaw = of.world().observer.yawDeg;
    let bestPitch = -20;
    let best = -2;
    for (let y = bestYaw - 30; y <= bestYaw + 30; y += 3) {
      for (let p = -55; p <= 10; p += 3) {
        of.look(y, p);
        const a = of.aim();
        const v = sub(want, a.origin);
        const l = V(v) || 1;
        const k = dot(a.dir, [v[0] / l, v[1] / l, v[2] / l]);
        if (k > best) { best = k; bestYaw = y; bestPitch = p; }
      }
    }
    of.look(bestYaw, bestPitch);
    await sleep(0.2);
    return best;
  };

  await sleep(0.5);
  // THE WHOLE-PROBE BANNER LEDGER (GP-64). Taken here, before anything, because
  // the objective chain ticks over during the STOCKING below: a window opened
  // later measures the production half correctly and reports the legitimate
  // half as unexercised, which is a probe failing to prove its own negative.
  const probeBanners0 = of.game().fx.banners;
  const probeGoals0 = of.game().goals.completions;

  // ======================================================================
  // 0. STOCK, AND SPEND THE LOCK-BUYING CLICK BEFORE ANY BASELINE
  // ======================================================================
  // The first real click on the canvas may legitimately be eaten to buy the
  // pointer lock back (Input.pointerdown), so it is spent HERE, aimed at bare
  // ground with the bare hand, where being eaten or digging are both harmless.
  // Measuring the open-on-click assertion with the lock-buying click would call
  // correct behaviour a bug.
  // GP-890. THE STOCKING SWEEP OBEYS THE PICKAXE GATE, AND IS THEREFORE TWO
  // SWEEPS WITH A TOOL CRAFTED BETWEEN THEM. GP-506 made coal, iron and copper
  // `requiresToolFor` (gameplay.h): a bare-hand swing at them is REFUSED by
  // name, not paid less. The single loop this replaces asked for kinds 0, 3
  // and 2 (Tree, IronOre, CoalSeam) and deliberately skipped kind 1 (Rock),
  // which is the only bare-hand road to stone. Measured on this world
  // 2026-08-15 it landed 183 Wood and nothing else, took 21 ToolRequired
  // refusals across the seven iron nodes, and `of.craft(2)` (Wood x5 +
  // Raw iron x2) then refused with InputsShort and cascaded into every
  // assertion below. Wood and loose stone stay ungated precisely so the
  // pickaxe (Stone x2 + Wood x1) has a bare-hand path, and that is the order
  // the storyline states: gather wood, gather stones, craft the pickaxe, THEN
  // mine.
  const nodesOnce = of.nodes();     // as expensive as of.game(); walked twice
  const packCount = (name) =>
    (of.game().carried.find((c) => c.name === name)?.count ?? 0);
  const KIND_ITEM = { 0: 'Wood', 1: 'Stone', 2: 'Coal', 3: 'Raw iron' };
  let harvests = 0;
  // Budgets are per RESOURCE and never per node: a node count is world-gen's
  // to move and it has moved. A node whose OWN resource is already at budget
  // is skipped rather than emptied, so a scarce kind cannot keep the walk
  // paying out every plentiful one on the way (GP-672's pack-pressure rule).
  const sweep = (kinds, want) => {
    for (const n of nodesOnce) {
      if (!kinds.includes(n.kind)) continue;
      if (kinds.every((k) => packCount(KIND_ITEM[k]) >= want[KIND_ITEM[k]])) break;
      if (packCount(KIND_ITEM[n.kind]) >= want[KIND_ITEM[n.kind]]) continue;
      for (let k = 0; k < 3; ++k) if (of.harvest(n.index).ok) harvests++;
    }
  };
  sweep([0, 1], { Wood: 30, Stone: 6 });        // Tree, Rock: always bare-hand
  const pickaxe = of.craft(0);                  // Stone x2 + Wood x1
  sweep([2, 3], { Coal: 20, 'Raw iron': 20 });  // CoalSeam, IronOre: gated
  of.hotbar(1);
  of.look(of.world().observer.yawDeg, -70);
  await realClick(0.11);
  log.push(`stocked with ${harvests} harvests over two sweeps, pickaxe `
    + `${pickaxe}, pack ${of.game().carried.map((c) => `${c.name}=${c.count}`)
      .join(' ')}, lock-buying click spent`);

  // The gate is witnessed rather than merely obeyed: without the pickaxe there
  // is no iron, so a probe that crafted the furnace anyway would be measuring a
  // world where GP-506 had been reverted.
  if (!pickaxe) {
    return { valid: false, why: 'could not craft the crude pickaxe, so no ore '
      + 'could be legally mined', log };
  }
  if (!of.craft(2)) {
    // GP-51's refusal CODE and the bill it was measured against, so a red here
    // says "short of what" instead of "no" (0 none, 1 no recipe, 2 inputs
    // short, 3 pack full).
    return { valid: false, why: 'could not craft the furnace',
      recipe: of.game().recipes[2] ?? null, carried: of.game().carried, log };
  }

  // ======================================================================
  // 1. A CLICK WITH THE FURNACE IN HAND PLACES IT (and opens nothing)
  // ======================================================================
  of.hotbar(2);
  await sleep(0.2);
  of.look(of.world().observer.yawDeg, -22);
  await sleep(0.2);
  const machines0 = of.game().machines.length;
  await realClick(0.11);
  const machines1 = of.game().machines.length;
  check('a real click with the furnace in hand placed it',
    machines1 === machines0 + 1, `${machines0} -> ${machines1}`);
  check('placing did NOT open a screen', of.game().screen.open === false,
    JSON.stringify(of.game().screen.of));
  const MI = machines1 - 1;                       // the machine this probe placed
  const m = of.game().machines[MI];
  if (m === undefined) return { valid: false, why: 'nothing was placed', fails, log };
  const aimDot = await aimAt(m.pos);
  check('the crosshair is on the machine',
    aimDot > 0.95 && of.game().aimed.machine !== null,
    `dot ${aimDot.toFixed(4)}, aimed ${JSON.stringify(of.game().aimed.machine)}`);

  // ======================================================================
  // 2. A PART IN HAND STILL PLACES AT A MACHINE, AND THE SCREEN STAYS SHUT
  // ======================================================================
  // The rule is bare-hand-only, so the hand must not have STOLEN the left
  // button from the build verb. Slot 4 is the belt.
  of.hotbar(4);
  await sleep(0.25);
  const partBefore = { built: of.game().factory.buildings,
    refusals: of.build().refusals };
  await realClick(0.11);
  const partAfter = { built: of.game().factory.buildings,
    refusals: of.build().refusals };
  const partActed = partAfter.built > partBefore.built
    || partAfter.refusals > partBefore.refusals;
  check('a part in hand still reaches the BUILD verb at a machine', partActed,
    `built ${partBefore.built}->${partAfter.built}, `
    + `refused ${partBefore.refusals}->${partAfter.refusals}`);
  check('a part in hand did NOT open the screen', of.game().screen.open === false);

  // ======================================================================
  // 3. THE HEADLINE: BARE HAND + MACHINE + ONE REAL CLICK = THE SCREEN,
  //    AND NOTHING PLACED, NOTHING SWUNG, NOTHING DUG
  // ======================================================================
  of.hotbar(1);
  await sleep(0.25);
  await aimAt(m.pos);
  const b0 = {
    screen: of.game().screen.open,
    machines: of.game().machines.length,
    built: of.game().factory.buildings,
    swings: of.game().interact.swings,
    grants: of.game().interact.grants,
    cells: of.voxels().removedCells,
  };
  await realClick(0.11);
  const b1 = {
    screen: of.game().screen.open,
    machines: of.game().machines.length,
    built: of.game().factory.buildings,
    swings: of.game().interact.swings,
    grants: of.game().interact.grants,
    cells: of.voxels().removedCells,
  };
  check('ONE real left click with the bare hand OPENED the machine screen',
    b0.screen === false && b1.screen === true, `${b0.screen} -> ${b1.screen}`);
  check('the screen is the machine that was clicked',
    of.game().screen.of === `furnace${m.tier}`, String(of.game().screen.of));
  // The four negatives. Every one of them is a verb the same button used to
  // reach, and each has its own counter so a failure names itself.
  check('opening placed no machine', b1.machines === b0.machines,
    `${b0.machines} -> ${b1.machines}`);
  check('opening placed no building', b1.built === b0.built,
    `${b0.built} -> ${b1.built}`);
  check('opening swung nothing', b1.swings === b0.swings,
    `${b0.swings} -> ${b1.swings}`);
  check('opening granted nothing', b1.grants === b0.grants,
    `${b0.grants} -> ${b1.grants}`);
  check('opening dug nothing', b1.cells === b0.cells, `${b0.cells} -> ${b1.cells}`);

  // Everything below is ABOUT the open screen, so a probe that carried on with
  // it shut would report a cascade of undefined-property crashes instead of the
  // one assertion that actually failed. Reverting the open rule must fail BY
  // NAME, which is the whole value of a negative control.
  if (!b1.screen) {
    return { valid: false, fails, why: 'the screen never opened, so nothing '
      + 'below it could be measured', open: { before: b0, after: b1, aimDot },
      log };
  }

  // ======================================================================
  // 4. THE SCREEN SHOWS INPUT, FUEL AND OUTPUT, AND CLICK-TO-PUT WORKS
  // ======================================================================
  const shape = of.game().screen;
  check('the screen has all three slots',
    shape.input !== null && shape.fuel !== null && shape.output !== null,
    JSON.stringify({ i: shape.input, f: shape.fuel, o: shape.output }));
  const loadBtn = (match) => [...document.querySelectorAll('#of-furnace button[data-load]')]
    .find((x) => x.textContent.includes(match)) ?? null;
  const oreBtn = loadBtn('Raw iron');
  const fuelBtn = loadBtn('Coal') ?? loadBtn('Wood');
  check('the pack offers ore and fuel to put in',
    oreBtn !== null && fuelBtn !== null, shape.loadable.join(', '));
  if (oreBtn !== null) oreBtn.click();
  await sleep(0.1);
  if (fuelBtn !== null) fuelBtn.click();
  await sleep(0.2);
  // Load MORE fuel than three units of ore can burn, so the run below is never
  // limited by the pool: a stall would read as a missing unit.
  for (let i = 0; i < 3; ++i) {
    const f = loadBtn('Coal') ?? loadBtn('Wood');
    if (f !== null) { f.click(); await sleep(0.08); }
  }
  const loaded = of.game().screen;
  check('the input slot filled from the pack', (loaded.input?.count ?? 0) > 0,
    JSON.stringify(loaded.input));
  check('the fuel pool filled from the pack',
    of.game().machines[MI].state.fuelTicks > 0,
    String(of.game().machines[MI].state.fuelTicks));

  // ======================================================================
  // 5. THE PROGRESS BAR IS THE SIM'S COUNTER, AND IT SWEEPS ONCE PER UNIT
  // ======================================================================
  const st0 = of.game().machines[MI].state;
  const UNITS = 3;
  const banners0 = of.game().fx.banners;
  const goals0 = of.game().goals.completions;
  const ingots0 = of.game().fx.ingotsAnnounced;
  const out0 = st0.outCount;
  let samples = 0;
  let worstBarError = 0;
  let sweeps = 0;          // high-to-low resets of the DRAWN bar
  let peak = 0;
  let prev = -1;
  let bannersDuringSteady = 0;
  let steadyFrom = -1;     // the sample at which objective traffic can stop
  const budget = st0.ticksPerSmelt * UNITS / 60 + 3;
  const t0 = of.world().tick;
  for (let t = 0; t < budget / 0.05 && of.game().machines[MI].state.outCount - out0 < UNITS; ++t) {
    await sleep(0.05);
    const g = of.game();
    const s = g.machines[0].state;
    const want = Math.round((s.progress / Math.max(1, s.ticksPerSmelt)) * 100);
    const drawn = g.screen.barPct;
    // The panel renders on the FRAME and the sim advances on the TICK, so the
    // bar may legitimately lag the counter by one frame's worth of ticks. That
    // is 1 of 180, so a two-point window is generous and a client-side
    // animation (which would drift by tens) still fails loudly.
    worstBarError = Math.max(worstBarError, Math.abs(drawn - want));
    peak = Math.max(peak, drawn);
    if (prev >= 0 && drawn < prev - 40) sweeps++;
    prev = drawn;
    samples++;
    // GP-64: once the first unit is done the objective chain has no smelting
    // milestone left, so every later banner would be production talking.
    if (steadyFrom < 0 && s.outCount - out0 >= 1) {
      steadyFrom = samples;
      bannersDuringSteady = g.fx.banners;
    }
  }
  const st1 = of.game().machines[MI].state;
  const produced = st1.outCount - out0;
  const ranTicks = of.world().tick - t0;
  log.push(`${produced} units over ${ranTicks} ticks, ${samples} samples, `
    + `peak bar ${peak}%, ${sweeps} sweeps`);
  check('the run produced the units it was driven for', produced === UNITS,
    `${produced} of ${UNITS}`);
  // THE ASSERTION: the drawn bar IS the sim's counter, on every sample.
  check('the drawn bar equals the sim counter on every sample',
    samples > 40 && worstBarError <= 2,
    `${samples} samples, worst |drawn - sim| = ${worstBarError} points`);
  check('the bar swept to its top', peak >= 95, `peak ${peak}%`);
  check('the bar reset exactly once per unit produced', sweeps === produced,
    `${sweeps} sweeps against ${produced} units`);
  // The negative control on the bar: it is not stuck. A frozen bar would pass
  // "equals the counter" only if the counter were frozen too, so this pins the
  // counter to the AUTHORED budget. The units cost `ticksPerSmelt` each MINUS
  // whatever progress the first unit had already made when the baseline was
  // taken, and the loop can only overshoot (it polls every 3 ticks), never
  // undershoot, so the window is one-sided.
  const wantTicks = st0.ticksPerSmelt * UNITS - st0.progress;
  check('the sim spent exactly the authored tick budget on the units',
    ranTicks >= wantTicks && ranTicks <= wantTicks + 8,
    `${ranTicks} ticks against ${wantTicks} (${st0.ticksPerSmelt} x ${UNITS} `
    + `less ${st0.progress} already made)`);

  // ======================================================================
  // 6. GP-64: NO ROAMING TOAST FROM ROUTINE PRODUCTION
  // ======================================================================
  const gEnd = of.game();
  const bannersAll = gEnd.fx.banners - banners0;
  const goalsAll = gEnd.goals.completions - goals0;
  const bannersSteady = steadyFrom > 0 ? gEnd.fx.banners - bannersDuringSteady : -1;
  check('every banner during the run came from an objective, none from an ingot',
    bannersAll === goalsAll, `${bannersAll} banners against ${goalsAll} objectives`);
  check('after the first unit, production threw NO banner at all',
    bannersSteady === 0, `${bannersSteady} banners over units 2..${UNITS}`);
  // And the event itself still fires AT THE MACHINE: the cue moved, it was not
  // deleted. Without this the two assertions above would also pass on a build
  // that had simply stopped noticing that anything was smelted.
  check('the at-the-machine ingot cue still fires',
    gEnd.fx.ingotsAnnounced - ingots0 === produced,
    `${gEnd.fx.ingotsAnnounced - ingots0} cues against ${produced} units`);
  // THE LEGITIMATE HALF OF THE SAME PATH, over the WHOLE probe rather than the
  // smelting window, because the objective chain ticks over while the pack is
  // being stocked. Two claims in one ledger, and both are needed: the flash
  // path still FIRES (so GP-64 moved the ingot cue rather than breaking the
  // channel), and every banner raised in this entire session is attributable to
  // an objective, so none of the three ingots produced any.
  const probeBanners = gEnd.fx.banners - probeBanners0;
  const probeGoals = gEnd.goals.completions - probeGoals0;
  const pathProven = probeGoals > 0 && probeBanners === probeGoals;
  check('the banner path still fires for legitimate one-time messages',
    probeGoals > 0 && probeBanners > 0,
    `${probeBanners} banners, ${probeGoals} objectives over the whole probe`);
  check('across the WHOLE probe, banners == objectives and no ingot added one',
    probeBanners === probeGoals,
    `${probeBanners} banners against ${probeGoals} objectives, `
    + `with ${gEnd.fx.ingotsAnnounced - ingots0} ingots produced`);

  // ======================================================================
  // 7. CLICK-TO-TAKE MOVES THE EXACT STACK, IDENTITY AND COUNT
  // ======================================================================
  const packOf = (item) => (of.game().carried.find((c) => c.item === item)?.count ?? 0);
  const outItem = of.game().machines[MI].state.outItem;
  const outCount = of.game().machines[MI].state.outCount;
  const packBefore = packOf(outItem);
  const takeBtn = document.querySelector('#of-furnace button[data-take]');
  check('the output slot is a control the player can click',
    takeBtn !== null && !takeBtn.disabled,
    takeBtn === null ? 'no button' : 'disabled');
  if (takeBtn !== null) takeBtn.click();
  await sleep(0.2);
  const packAfter = packOf(outItem);
  const outAfter = of.game().machines[MI].state.outCount;
  // IDENTITY AND COUNT IN ONE ASSERTION, which is why `packOf` keys on the
  // ItemId rather than the display name: the row for THAT item grew by exactly
  // the count that left the machine, so a build that credited the right number
  // of the wrong thing fails here rather than passing on a total.
  check('taking the output moved the EXACT stack into the pack',
    outCount > 0 && packAfter - packBefore === outCount && outAfter === 0,
    `${outCount} of item ${outItem} out, pack ${packBefore} -> ${packAfter}, `
    + `machine left ${outAfter}`);
  // The item id is asserted to be a REAL smelt output rather than whatever the
  // pack happened to hold, so "identity" is a claim about the ore chain and not
  // just about two numbers agreeing.
  check('the item taken is a smelt output', outItem > 0 && outItem !== st0.oreItem,
    `out ${outItem}, ore ${st0.oreItem}`);

  // The input cell is published against a seam (GP-62) rather than silently
  // absent: it must exist, and it must SAY why it cannot act yet.
  const inBtn = document.querySelector('#of-furnace button[data-take-in]');
  check('the input slot exists as a control', inBtn !== null);
  check('the input slot reports the seam honestly',
    of.game().screen.canTakeInput === (inBtn !== null && !inBtn.disabled),
    `canTakeInput ${of.game().screen.canTakeInput}`);

  // ======================================================================
  // 8. THE OTHER MACHINE FAMILY: A FACTORY SMELTER, OVER of_net_progress01
  // ======================================================================
  // Reid said "smelter", and there are two of them: the hand furnace above
  // (a gameplay-layer `survival::Furnace` behind a WASM handle) and the
  // factory sim's own, behind a build index. They answer the three questions
  // through DIFFERENT exports, so proving one proves nothing about the other,
  // and the second is where a per-unit bar could silently be absent.
  of.escape();                                    // shut the furnace screen
  await sleep(0.3);
  of.hotbar(5);                                   // slot 5 is the factory smelter
  await sleep(0.25);
  // -35 rather than -20, and the number is the reach: the ghost lands where the
  // aim meets the ground, which at eye height 1.6 m is 1.6/tan(pitch) away, so
  // -20 puts a smelter 4.4 m out and `Factory.pick` only reaches 3.5. The first
  // run of this section placed it perfectly and then reported `aimed.build`
  // null, which is a probe standing too far back rather than a broken rule.
  of.look(of.world().observer.yawDeg + 90, -35);
  await sleep(0.25);
  const smeltersBefore = of.game().factory.list.filter((p) => p.kind === 'smelter').length;
  await realClick(0.11);
  const sm = of.game().factory.list.filter((p) => p.kind === 'smelter').pop() ?? null;
  const factory = { placed: sm !== null && sm !== undefined, opened: false,
    kind: null, progressSeen: 0, worstError: 0, samples: 0 };
  if (sm !== null && of.game().factory.list.filter((p) => p.kind === 'smelter').length
      > smeltersBefore) {
    of.hotbar(1);
    await sleep(0.25);
    await aimAt(sm.pos);
    await realClick(0.11);
    const scr = of.game().screen;
    factory.opened = scr.open === true;
    factory.kind = scr.of;
    check('a bare-hand click opens a FACTORY smelter too', factory.opened,
      `screen ${JSON.stringify(scr.of)}, aimed ${JSON.stringify(of.game().aimed.build)}`);
    if (factory.opened) {
      check('the factory screen names the right machine', scr.of === 'smelter',
        String(scr.of));
      check('the factory screen shows input and output',
        scr.input !== null && scr.output !== null,
        JSON.stringify({ i: scr.input, o: scr.output }));
      const fb = [...document.querySelectorAll('#of-furnace button[data-load]')][0] ?? null;
      check('the factory screen offers the pack ore to put in', fb !== null,
        (scr.loadable ?? []).join(', '));
      if (fb !== null) fb.click();
      await sleep(0.2);
      // The bar again, this time against `of_net_progress01`, which is /core's
      // OWN fixed-point work counter and not the furnace's tick field.
      for (let t = 0; t < 90; ++t) {
        await sleep(0.05);
        const gg = of.game();
        const row = gg.factory.list.find((p) => p.id === sm.id);
        if (row === undefined || gg.screen.progress01 === null) continue;
        factory.samples++;
        factory.progressSeen = Math.max(factory.progressSeen, gg.screen.barPct);
        factory.worstError = Math.max(factory.worstError,
          Math.abs(gg.screen.barPct - Math.round(gg.screen.progress01 * 100)));
        if ((row.output ?? 0) > 0 && factory.progressSeen > 50) break;
      }
      check('the factory smelter has a per-unit bar and it moved',
        factory.samples > 10 && factory.progressSeen > 20,
        `${factory.samples} samples, peak ${factory.progressSeen}%`);
      check('the factory bar equals the sim value it was drawn from',
        factory.worstError <= 1, `worst ${factory.worstError} points`);
    }
  } else {
    fails.push('the factory smelter was never placed, so its half is unproven');
  }

  const g = of.game();
  return {
    valid: fails.length === 0,
    fails,
    factory,
    open: {
      bareHandClick: { before: b0, after: b1 },
      partInHand: { before: partBefore, after: partAfter },
      aimDot,
    },
    bar: {
      samples, worstBarError, peak, sweeps, produced,
      ticksPerSmelt: st0.ticksPerSmelt, ranTicks,
    },
    toast: {
      bannersDuringRun: bannersAll,
      objectivesDuringRun: goalsAll,
      bannersAfterFirstUnit: bannersSteady,
      ingotCues: g.fx.ingotsAnnounced - ingots0,
      wholeProbe: { banners: probeBanners, objectives: probeGoals },
      legitimatePathExercised: pathProven,
    },
    take: { outItem, outCount, packBefore, packAfter, machineLeft: outAfter },
    screen: g.screen,
    carried: g.carried,
    log,
  };
})()
