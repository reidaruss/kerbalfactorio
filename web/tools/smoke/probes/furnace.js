// W5 furnace probe: craft it, put it in hand off the HOTBAR, place it on the
// 1 m grid with a real left click, open it with a real `interact` press, load it
// through the real DOM buttons, and prove it smelted on the tick gameplay.h
// says it should.
//
// THE TWO VERBS ARE NOW DISTINCT, and asked for by ACTION rather than by key
// (Bindings.ts). `use` (left mouse button) places what the hand holds, so slot 2
// has to be selected first; `interact` (E) opens the machine and never harvests.
//
// THE TIMING IS THE ASSERTION. A primitive furnace is 180 ticks per smelt and
// coal is 1440 fuel ticks per unit. So after N ticks of running with ore and
// fuel present, progress and the fuel pool must have moved by exactly N, and
// the first ingot must appear on tick 180 and not before. "The number went up"
// would pass against a furnace that simply granted an ingot on load.
//
//   node tools/smoke/run.mjs --scenario=walk \
//        --evalfile=tools/smoke/probes/furnace.js
(async (A) => {
  const of = window.__of;
  const sleep = (n) => of.run(n);
  const notes = [];
  const stop = A.stop ?? 'smelting';

  await sleep(0.4);
  const t0 = of.world().tick;

  // Stock: 5 wood + 2 raw iron buys the furnace, the rest feeds it.
  let harvests = 0;
  for (const n of of.nodes()) {
    if (n.kind !== 0 && n.kind !== 3 && n.kind !== 2) continue;
    for (let k = 0; k < 3; ++k) if (of.harvest(n.index).ok) harvests++;
    if (harvests > 26) break;
  }
  const stocked = of.game().carried;

  // Craft the primitive furnace (recipe 2) through the same call the button uses.
  if (!of.craft(2)) return { fail: 'could not craft the furnace', stocked };

  // --- put the furnace in hand and place it with a real click --------------
  // Slot 2 is the crafted hand furnace. This is the number key's own path, so
  // the click that follows places what a player's click would place.
  of.input.tape([{ hold: 4, actions: ['slot2'] }, { hold: 4, keys: [] }]);
  await sleep(0.25);
  const inHand = of.hotbar();
  if (inHand.kind !== 'furnace') return { fail: 'slot 2 does not hold the furnace', inHand };
  const before = of.game();
  of.input.tape([{ hold: 4, actions: ['use'] }, { hold: 8, keys: [] }]);
  await sleep(0.4);
  const afterPlace = of.game();
  if (afterPlace.machines.length === 0) {
    return { fail: 'a click with the furnace in hand placed nothing', before, afterPlace };
  }
  const m = afterPlace.machines[0];
  notes.push(`placed 1 machine, tier ${m.tier}, handle ${m.handle}`);

  // --- open it with a real `interact` press ---------------------------------
  // The placement lands 2.6 m along the flat aim, so the crosshair is on it.
  of.input.tape([{ hold: 4, actions: ['interact'] }, { hold: 10, keys: [] }]);
  await sleep(0.4);
  if (!of.game().furnaceOpen) return { fail: 'interact did not open the furnace' };

  // --- load through the REAL buttons ---------------------------------------
  const buttons = [...document.querySelectorAll('#of-furnace button[data-load]')]
    .map((b) => b.textContent);
  const clickLoad = (match) => {
    const b = [...document.querySelectorAll('#of-furnace button[data-load]')]
      .find((x) => x.textContent.includes(match));
    if (b === undefined) return false;
    b.click();
    return true;
  };
  const loadedOre = clickLoad('Raw iron');
  await sleep(0.05);
  const loadedFuel = clickLoad('Coal') || clickLoad('Wood');
  await sleep(0.05);
  const s0 = of.game().machines[0].state;
  if (!loadedOre || !loadedFuel || s0.oreCount === 0 || s0.fuelTicks === 0) {
    return { fail: 'the furnace did not take ore and fuel', buttons, s0 };
  }

  // --- 90 ticks: half a smelt, nothing finished ----------------------------
  const tA = of.world().tick;
  await sleep(90 / 60);
  const sMid = of.game().machines[0].state;
  const ranA = of.world().tick - tA;

  // --- past 180 ticks: exactly one ingot ------------------------------------
  await sleep(140 / 60);
  const sEnd = of.game().machines[0].state;
  const ranTotal = of.world().tick - tA;

  let taken = null;
  if (stop === 'taken') {
    const t = document.querySelector('#of-furnace button[data-take]');
    const packBefore = of.game().carried.map((c) => `${c.name}:${c.count}`).join(',');
    if (t !== null && !t.disabled) t.click();
    await sleep(0.1);
    taken = { packBefore, packAfter: of.game().carried.map((c) => `${c.name}:${c.count}`).join(',') };
  }

  const g = of.game();
  return {
    advanced: {
      ticks: of.world().tick - t0,
      harvests,
      placements: g.placements,
      ticksRunToMid: ranA,
      ticksRunTotal: ranTotal,
      // The furnace burned exactly one fuel tick per progressing tick.
      fuelBurned: s0.fuelTicks - sEnd.fuelTicks,
      smeltsCompleted: sEnd.outCount + (taken === null ? 0 : 0),
    },
    timing: {
      ticksPerSmelt: s0.ticksPerSmelt,
      fuelAtLoad: s0.fuelTicks,
      progressAt90: sMid.progress,
      outputAt90: sMid.outCount,
      progressAtEnd: sEnd.progress,
      outputAtEnd: sEnd.outCount,
      outputItem: sEnd.outItem,
      oreLeft: sEnd.oreCount,
    },
    // The panel stays open in both stops: this probe never closes it, and
    // asserting a state it never drives is how a probe fails itself.
    valid: g.placements === 1 && g.furnaceOpen === true
      && s0.ticksPerSmelt === 180
      // One click loads up to five units, and the pool is already burning down
      // by the time it is read, so the floor is one unit of coal.
      && s0.fuelTicks >= 1440
      && sMid.outCount === 0 && sMid.progress > 60 && sMid.progress < 120
      && sEnd.outCount === 1
      && Math.abs((s0.fuelTicks - sEnd.fuelTicks) - ranTotal) <= 3
      && (stop !== 'taken' || (taken !== null && taken.packBefore !== taken.packAfter)),
    buttons,
    stocked,
    taken,
    machines: g.machines,
    carried: g.carried,
    notes,
  };
})(OF_ARGS)
