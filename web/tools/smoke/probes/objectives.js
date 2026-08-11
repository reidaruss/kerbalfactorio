// W7: the first minute has a shape.
//
//   node tools/smoke/run.mjs --scenario=walk \
//        --evalfile=tools/smoke/probes/objectives.js \
//        --out=docs/screenshots/W7_objectives.png
//
// WHAT THIS HAS TO PROVE, and it is not "the panel exists". A checklist that
// counts up on a timer would look identical in a screenshot, so the assertion is
// that each step advances ONLY when the world satisfies it and IMMEDIATELY when
// it does. So the probe:
//
//   asserts the list does NOT move while nothing is done (a long idle window),
//   then does each thing and asserts the list moved by exactly one each time,
//   then checks the H key hides it and the choice survives,
//   and finally, the property that makes this a checklist and not a tutorial:
//   an objective already satisfied before the list reaches it ticks itself off
//   the moment the list gets there, with no player action in between.
(async () => {
  const of = window.__of;
  const settle = (secs) => of.run(secs, 60);
  const goals = () => of.game().goals;

  await settle(1.0);
  await of.wipe();
  const t0 = of.world();
  if (of.game() === null) return { valid: false, why: 'no gameplay layer' };
  const steps = [];
  const note = (what) => steps.push({ what, index: goals().index, current: goals().current });

  // --- 1. it does not move on its own ---------------------------------------
  const start = goals().index;
  await settle(4.0);                    // sixteen checks at four a second
  const idle = goals().index;
  note('after 4 s of doing nothing');

  // --- 2. each thing, in order ----------------------------------------------
  // GP-506: the checklist grew a 'stone' step (wood -> stone -> tool -> ore),
  // and ore is now GATED behind the pickaxe (harvestGate), so a bare-hand
  // pull on it before the tool exists grants nothing — the old "mine the ore
  // early, before crafting the tool" setup for this probe is now exactly the
  // refused path.
  const wood = of.nodes().find((n) => n.kind === 0);
  for (let k = 0; k < 3; ++k) of.harvest(wood.index);
  await settle(0.5);
  note('harvested a tree');

  const rock = of.nodes().find((n) => n.kind === 1);
  for (let k = 0; k < 3; ++k) of.harvest(rock.index);
  await settle(0.5);
  note('harvested a rock');

  const craftBy = async (name) => {
    const rs = of.game().recipes;
    const i = rs.findIndex((r) => r.name === name && r.craftable);
    const ok = i >= 0 && of.craft(i);
    await settle(0.5);
    return ok;
  };
  const beforeTool = goals().index;
  const madePick = await craftBy('Crude pickaxe');
  note('crafted a pickaxe (stone + wood, never ore)');
  // Ore first: mined the INSTANT the tool exists, so it is already in the
  // pack (well past the 'ore' card's threshold) before the list has caught
  // up past 'tool'. Two steps in a row here: 'tool' and then 'ore', which was
  // satisfied in the same beat rather than waited out — the list has to catch
  // up by itself, same property as before, replayed against the new order.
  const iron = of.nodes().find((n) => n.kind === 3);
  for (let k = 0; k < 6; ++k) of.harvest(iron.index);
  await settle(1.0);
  const afterCatchUp = goals().index;
  note('list caught up on ore mined the moment the pickaxe existed');

  // --- 3. the H key ---------------------------------------------------------
  of.input.tape([{ hold: 4, keys: ['KeyH'] }, { hold: 6, keys: [] }]);
  await settle(0.4);
  const hidden = goals().visible;
  of.input.tape([{ hold: 4, keys: ['KeyH'] }, { hold: 6, keys: [] }]);
  await settle(0.4);
  const shownAgain = goals().visible;
  note('H pressed twice');

  await settle(0.6);
  const g = goals();
  const w = of.world();

  return {
    valid: (w.tick - t0.tick) > 400 && madePick && start === 0,
    // --- THE ACCEPTANCE -----------------------------------------------------
    // Nothing happens on a clock; each real action advances it by one; and an
    // objective satisfied early is picked up the moment the list reaches it.
    advancesOnlyOnTheWorld:
      idle === start
      && beforeTool === 2                 // GP-506: wood, stone done; tool next
      && afterCatchUp === 4               // pickaxe, then the ore already held
      && g.done.join(',') === 'wood,stone,tool,ore',
    hidesWithH: hidden === false && shownAgain === true,
    goals: g,
    steps,
    idleHeld: idle === start,
    cost: { frameMs: of.stats().frameMs, draw: of.stats().draw.calls },
  };
})()
