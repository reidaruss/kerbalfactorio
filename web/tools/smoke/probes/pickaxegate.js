// GP-506 probe: gather wood (bare) -> gather loose stone (bare) -> craft a
// crude pickaxe -> ore is refused bare-handed, then succeeds tooled.
//
//   node tools/smoke/run.mjs --scenario=walk \
//        --evalfile=tools/smoke/probes/pickaxegate.js \
//        --out=docs/screenshots/GP506_pickaxe_gate.png
//
// REWRITTEN after a verify-lane report: the first version walked to the rock
// with a real KeyW tape (harvest.js's own pattern) and then topped up wood
// and stone with TWO UNGUARDED `while` loops calling `of.harvest()` — no
// iteration cap, no `await` inside them. If a captured node reference ever
// went stale (the most likely cause: TreeField/RockField stream a node OUT
// of the ring while the walk chases the rock elsewhere, so the tree's /core
// index no longer names the tree) `of.harvest()` keeps returning `ok:false`
// forever and the loop spins the JS thread solid: no output, no timeout, no
// escape. Every ctest in this same brief bounds its "harvest until N" loops
// with a `guard` counter for exactly this reason (see
// `core/tests/test_survival_slice.cpp`); this file did not, which was the
// bug. Positioning now goes through `of.standAt` (PH-90, the same
// probe-legal deterministic placement `carrier`/`station` probes use)
// instead of a walk tape, and every remaining loop is guard-bounded and logs
// its phase so a future stall is diagnosable in seconds, not 55 minutes.
//
// What this still has to prove, unchanged from the original brief:
//   1. one swing on a loose stone (a Rock node) grants Stone, bare-handed,
//      via a REAL input tape (not `of.harvest()`) — the one-swing-pickup claim.
//   2. a bare-hand swing on an ore node is REFUSED — named (HarvestRefusal
//      ToolRequired), not a silent zero, and the node is left untouched.
//   3. the crude pickaxe crafts from Stone + Wood alone (never ore) —
//      the deadlock breaker itself.
//   4. with the pickaxe carried, the SAME ore node now yields.
(async () => {
  const of = window.__of;
  const log = (s) => console.log(`[pickaxegate] ${s}`);
  const sleep = (n) => of.run(n);
  const carriedCount = (name) => of.game().carried.find((c) => c.name === name)?.count ?? 0;

  log('booted, settling');
  await sleep(0.5);
  const t0 = of.world().tick;
  log(`settled, t0=${t0}`);

  // --- Position deterministically at each node in turn (PH-90 standAt), --
  // rather than trusting a walk tape to close an arbitrary distance under
  // whatever load this run happens to hit.
  const standNear = (n) => {
    const r = of.standAt(n.x, n.y, n.z);
    log(`standAt(${n.name} idx=${n.index}) -> grounded=${r?.grounded}`);
    return r;
  };

  const swingOnce = async () => {
    of.input.tape([{ hold: 6, actions: ['use'] }, { hold: 32, keys: [] }]);
    await sleep(0.7);
  };

  // --- 1. Loose stone: one REAL swing (input tape), bare hands, grants Stone.
  log('finding a Rock node');
  const rock = of.nodes().find((n) => n.kind === 1);
  if (rock === undefined) return { fail: 'no Rock (loose stone) node placed near spawn', t0 };
  log(`found rock idx=${rock.index} distanceM=${rock.distanceM.toFixed(1)}`);
  standNear(rock);
  await sleep(0.1);
  const distToRock = of.nodes().find((n) => n.index === rock.index)?.distanceM ?? Infinity;
  log(`distance to rock after standAt: ${distToRock.toFixed(2)} m`);

  const swingsBefore = of.game().interact.swings;
  const stoneBefore = carriedCount('Stone');
  log(`swinging once at the rock (stoneBefore=${stoneBefore})`);
  await swingOnce();
  const swingsAfter = of.game().interact.swings;
  const stoneAfter = carriedCount('Stone');
  log(`swing done: swings ${swingsBefore}->${swingsAfter}, stone ${stoneBefore}->${stoneAfter}`);
  const oneSwingGrantedStone = swingsAfter > swingsBefore && stoneAfter > stoneBefore;

  // --- Top up wood + stone with of.harvest() (already reach-ignoring), ---
  // GUARD-BOUNDED: a node that stops granting breaks the loop and is
  // reported rather than freezing the page.
  const topUp = (label, itemName, want, node) => {
    let guard = 0;
    while (carriedCount(itemName) < want && guard++ < 20) {
      const r = of.harvest(node.index);
      if (guard % 5 === 0) log(`${label}: guard=${guard} ${itemName}=${carriedCount(itemName)} last.ok=${r?.ok}`);
    }
    const got = carriedCount(itemName);
    log(`${label} done: ${itemName}=${got} after ${guard} calls`);
    return { guard, got, exhausted: guard >= 20 && got < want };
  };

  log('finding Wood and IronOre nodes');
  const wood = of.nodes().find((n) => n.kind === 0);
  const ore = of.nodes().find((n) => n.kind === 3);
  if (wood === undefined || ore === undefined) {
    return { fail: 'wood or iron-ore node missing near spawn', t0, oneSwingGrantedStone };
  }
  log(`found wood idx=${wood.index}, ore idx=${ore.index}`);

  const woodTop = topUp('wood top-up', 'Wood', 1, wood);
  const stoneTop = topUp('stone top-up', 'Stone', 2, rock);
  if (woodTop.exhausted || stoneTop.exhausted) {
    return {
      fail: 'top-up exhausted its guard without reaching the target count',
      woodTop, stoneTop, t0, oneSwingGrantedStone,
    };
  }

  // --- 2. Ore, bare-handed, BEFORE the pickaxe: refused, named, untouched. --
  log('attempting bare-hand ore harvest (expect refusal)');
  const oreBefore = of.nodes().find((n) => n.index === ore.index);
  const refusedTry = of.harvest(ore.index);
  const oreAfterRefusal = of.nodes().find((n) => n.index === ore.index);
  log(`bare ore try: ok=${refusedTry.ok} refusal=${JSON.stringify(refusedTry.refusal)}`);
  const bareOreRefused = refusedTry.ok === false
    && refusedTry.refusal !== null && refusedTry.refusal.code === 1  // ToolRequired
    && Math.abs(oreAfterRefusal.remaining - oreBefore.remaining) < 1e-6;

  // --- 3. Craft the pickaxe: Stone x2 + Wood x1, never ore. ------------------
  // Proven BEHAVIOURALLY (the pack carries ZERO raw iron going in, since
  // nothing ore has been touched successfully yet in this run, and the craft
  // still succeeds) rather than by introspecting the recipe's raw ItemIds.
  const rawIronBeforeCraft = carriedCount('Raw iron');
  log(`crafting the pickaxe (rawIronBeforeCraft=${rawIronBeforeCraft})`);
  const craftedPick = of.craft(of.game().recipes.findIndex((r) => r.name === 'Crude pickaxe'
    && r.craftable));
  await sleep(0.3);
  const hasPick = carriedCount('Crude pickaxe') >= 1;
  const rawIronAfterCraft = carriedCount('Raw iron');
  log(`craft result: craftedPick=${craftedPick} hasPick=${hasPick} rawIron=${rawIronAfterCraft}`);
  const craftedWithoutOre = rawIronBeforeCraft === 0 && rawIronAfterCraft === 0 && craftedPick;

  // --- 4. Same ore node, now tooled: succeeds. -------------------------------
  log('attempting tooled ore harvest (expect success)');
  const toolBefore = of.nodes().find((n) => n.index === ore.index);
  const tooledTry = of.harvest(ore.index);
  const toolAfter = of.nodes().find((n) => n.index === ore.index);
  log(`tooled ore try: ok=${tooledTry.ok} refusal=${JSON.stringify(tooledTry.refusal)}`);
  const tooledOreSucceeded = tooledTry.ok === true
    && (tooledTry.refusal === null || tooledTry.refusal === undefined)
    && toolAfter.remaining < toolBefore.remaining;

  const t1 = of.world().tick;
  log(`done, t1=${t1} (advanced ${t1 - t0} ticks)`);

  // DW-20 proof-of-advance, recalibrated for standAt positioning: the walk
  // tape this threshold was authored against is gone (positioning is now
  // instant), so the only ticks left are the settle/swing/craft sleeps
  // (0.5 + 0.1 + 0.7 + 0.3 = 1.6 sim-seconds), which measured 66 ticks on a
  // clean run. 40 is comfortably below that with margin while still ruling
  // out "nothing advanced at all".
  return {
    valid: (t1 - t0) > 40
      && oneSwingGrantedStone && bareOreRefused && craftedPick && hasPick
      && craftedWithoutOre && tooledOreSucceeded,
    ticksAdvanced: t1 - t0,
    oneSwingGrantedStone,
    stoneFromOneSwing: stoneAfter - stoneBefore,
    woodTop, stoneTop,
    bareOreRefused, refusedTry,
    craftedPick, hasPick, craftedWithoutOre,
    tooledOreSucceeded, tooledTry,
    carried: of.game().carried,
  };
})()
