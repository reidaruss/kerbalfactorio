// W6 furnace-fire probe. Craft a furnace, place it, feed it, CLOSE the panel and
// watch the machine itself.
//
// The W5 furnace probe stops with the panel open and asserts the numbers behind
// it, which is the right test for the smelt and the wrong test for this: the
// complaint was that 180 ticks passed with nothing changing ON THE MACHINE. So
// this one asserts the machine's own visual state, and it asserts it in THREE
// phases, because "stalled for no fuel" is not "idle":
//
//   cold      placed, empty: fire level 0
//   burning   ore + fuel: fire level rises towards 1 and the flue emits
//   spent     fuel pool drained: fire falls back and the smoke stops
//
// It also proves the sim advanced (DW-20): fuel burned equals ticks run, and
// the ingot appears on the tick gameplay.h says it does, not on load.
(async () => {
  const of = window.__of;
  const sleep = (n) => of.run(n);
  const log = [];
  const fire = () => of.game().machines[0];

  await sleep(0.4);
  const t0 = of.world().tick;

  // Stock the pack straight from /core, the same call the swing makes. This
  // probe is about the FURNACE; probes/impact.js is what proves the swing.
  let harvests = 0;
  for (const n of of.nodes()) {
    if (n.kind !== 0 && n.kind !== 3 && n.kind !== 2) continue;
    for (let k = 0; k < 2; ++k) if (of.harvest(n.index).ok) harvests++;
    if (harvests > 14) break;
  }
  if (!of.craft(2)) return { fail: 'could not craft the furnace', carried: of.game().carried };

  // Slot 2 is the crafted hand furnace, selected through the number key's own
  // path, and the left button then places what the hand holds (Bindings.ts).
  of.input.tape([{ hold: 4, actions: ['slot2'] }, { hold: 4, keys: [] }]);
  await sleep(0.25);
  if (of.hotbar().kind !== 'furnace') {
    return { fail: 'slot 2 does not hold the furnace', hotbar: of.hotbar() };
  }
  of.input.tape([{ hold: 4, actions: ['use'] }, { hold: 8, keys: [] }]);
  await sleep(0.4);
  if (of.game().machines.length === 0) {
    return { fail: 'a click with the furnace in hand placed nothing' };
  }

  // --- COLD: placed, nothing in it -----------------------------------------
  await sleep(0.4);
  const cold = fire();
  log.push(`cold: lit=${cold.lit} burning=${cold.burning}`);

  // --- load it through the real DOM buttons --------------------------------
  of.input.tape([{ hold: 4, actions: ['interact'] }, { hold: 10, keys: [] }]);
  await sleep(0.35);
  if (!of.game().furnaceOpen) return { fail: 'interact did not open the furnace' };
  const click = (m) => {
    const b = [...document.querySelectorAll('#of-furnace button[data-load]')]
      .find((x) => x.textContent.includes(m));
    if (b === undefined) return false;
    b.click();
    return true;
  };
  const gotOre = click('Raw iron');
  await sleep(0.05);
  const gotFuel = click('Wood') || click('Coal');
  await sleep(0.05);
  const s0 = fire().state;
  // The clock starts HERE, with the fuel pool as it is: the furnace burns from
  // the tick it has both ore and fuel, including the ticks it takes to close the
  // panel, so anchoring the window anywhere later reads as fuel lost to nothing.
  const tA = of.world().tick;
  if (!gotOre || !gotFuel || s0.oreCount === 0 || s0.fuelTicks === 0)
    return { fail: 'the furnace did not take ore and fuel', s0 };

  // --- close the panel: the point is the MACHINE, not the menu --------------
  of.input.tape([{ hold: 4, actions: ['interact'] }, { hold: 10, keys: [] }]);
  await sleep(0.35);
  const closed = !of.game().furnaceOpen;

  // --- stand off and look at it: the machine is the subject of the capture --
  of.input.tape([{ hold: 16, keys: ['KeyS'] }, { hold: 6, keys: [] }]);
  await sleep(0.5);
  of.look(of.world().observer.yawDeg, -13);

  // --- BURNING: let the fire come up and the flue fill ---------------------
  await sleep(2.4);
  const hot = fire();
  const smoke = of.game().fx.smokeLive;
  const puffs = of.game().fx.smokePuffs;
  log.push(`burning: lit=${hot.lit} burning=${hot.burning} smokeLive=${smoke} puffs=${puffs}`);

  // --- the smelt itself still has to be right ------------------------------
  await sleep(1.6);
  const done = fire().state;
  const ran = of.world().tick - tA;

  const g = of.game();
  return {
    advanced: {
      ticks: of.world().tick - t0,
      harvests,
      ticksRun: ran,
      // One fuel tick per progressing tick: the fire is burning real fuel.
      fuelBurned: s0.fuelTicks - done.fuelTicks,
      progress: done.progress,
      ingots: done.outCount,
      panelClosed: closed,
    },
    visual: {
      coldLit: cold.lit,
      coldBurning: cold.burning,
      hotLit: hot.lit,
      hotBurning: hot.burning,
      smokeLive: smoke,
      smokePuffsEmitted: puffs,
    },
    valid: closed
      && cold.lit === 0 && cold.burning === false
      && hot.burning === true && hot.lit > 0.85
      && smoke > 0 && puffs >= 4
      && s0.ticksPerSmelt === 180
      && Math.abs((s0.fuelTicks - done.fuelTicks) - ran) <= 3
      && done.outCount === 1,
    state: done,
    machines: g.machines,
    carried: g.carried,
    log,
  };
})()
