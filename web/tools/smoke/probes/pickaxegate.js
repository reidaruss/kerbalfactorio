// GP-506 probe: gather wood (bare) -> gather loose stone (bare) -> craft a
// crude pickaxe -> ore is refused bare-handed, then succeeds tooled.
//
//   node tools/smoke/run.mjs --scenario=walk \
//        --evalfile=tools/smoke/probes/pickaxegate.js \
//        --out=docs/screenshots/GP506_pickaxe_gate.png
//
// DRIVEN, per standing rule 3 / DW-20: walks a real KeyW tape to a rock,
// swings a real `use` tape, and asserts the sim actually moved rather than
// assuming a call succeeded. What this has to prove, beyond harvest.js's
// generic "a swing grants an item":
//
//   1. one swing on a loose stone (a Rock node) grants Stone, bare-handed.
//   2. a bare-hand swing on an ore node is REFUSED — named (HarvestRefusal
//      ToolRequired), not a silent zero, and the node is left untouched.
//   3. the crude pickaxe crafts from Stone + Wood alone (never ore) —
//      the deadlock breaker itself.
//   4. with the pickaxe carried, the SAME ore node now yields.
(async () => {
  const of = window.__of;
  const sleep = (n) => of.run(n);
  const V = (a) => Math.hypot(a[0], a[1], a[2]);
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const norm = (a) => { const l = V(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const feet = () => of.world().player.aim.origin;

  await sleep(0.5);
  const t0 = of.world().tick;

  const faceIt = (target) => {
    const eye = feet();
    const want = norm(sub([target.x, target.y, target.z], eye));
    let bestYaw = 0, bestDot = -2;
    const st = of.world().observer;
    for (let a = 0; a < 360; a += 6) {
      of.look(a, st.pitchDeg);
      const k = dot(of.aim().dir, want);
      if (k > bestDot) { bestDot = k; bestYaw = a; }
    }
    let bestPitch = 0; bestDot = -2;
    for (let p = -40; p <= 20; p += 2) {
      of.look(bestYaw, p);
      const k = dot(of.aim().dir, want);
      if (k > bestDot) { bestDot = k; bestPitch = p; }
    }
    of.look(bestYaw, bestPitch);
  };

  const walkTo = async (index) => {
    let walked = 0;
    for (let i = 0; i < 14; ++i) {
      const n = of.nodes().find((x) => x.index === index);
      if (n === undefined || n.distanceM < 3.2) break;
      faceIt(n);
      const a = feet();
      of.input.tape([{ hold: 26, keys: ['KeyW'] }]);
      await sleep(0.55);
      walked += V(sub(feet(), a));
    }
    return walked;
  };

  const swingOnce = async () => {
    of.input.tape([{ hold: 6, actions: ['use'] }, { hold: 32, keys: [] }]);
    await sleep(0.7);
  };

  // --- 1. Loose stone: one swing, bare hands, grants Stone. -----------------
  const rock = of.nodes().find((n) => n.kind === 1);
  if (rock === undefined) return { fail: 'no Rock (loose stone) node placed near spawn' };
  faceIt(rock);
  const walkedM = await walkTo(rock.index);
  faceIt(rock);
  await sleep(0.2);
  const swingsBefore = of.game().interact.swings;
  const stoneBefore = of.game().carried.find((c) => c.name === 'Stone')?.count ?? 0;
  await swingOnce();
  const afterStoneSwing = of.game();
  const stoneAfter = afterStoneSwing.carried.find((c) => c.name === 'Stone')?.count ?? 0;
  const oneSwingGrantedStone = afterStoneSwing.interact.swings > swingsBefore
    && stoneAfter > stoneBefore;

  // Top up to the recipe's ingredients directly (of.harvest ignores reach —
  // this file already proved reach + the real swing tape work above).
  const wood = of.nodes().find((n) => n.kind === 0);
  const ore = of.nodes().find((n) => n.kind === 3);
  if (wood === undefined || ore === undefined) {
    return { fail: 'wood or iron-ore node missing near spawn', walkedM };
  }
  while ((of.game().carried.find((c) => c.name === 'Wood')?.count ?? 0) < 1) of.harvest(wood.index);
  while ((of.game().carried.find((c) => c.name === 'Stone')?.count ?? 0) < 2) of.harvest(rock.index);

  // --- 2. Ore, bare-handed, BEFORE the pickaxe: refused, named, untouched. --
  const oreBefore = of.nodes().find((n) => n.index === ore.index);
  const refusedTry = of.harvest(ore.index);
  const oreAfterRefusal = of.nodes().find((n) => n.index === ore.index);
  const bareOreRefused = refusedTry.ok === false
    && refusedTry.refusal !== null && refusedTry.refusal.code === 1  // ToolRequired
    && Math.abs(oreAfterRefusal.remaining - oreBefore.remaining) < 1e-6;

  // --- 3. Craft the pickaxe: Stone x2 + Wood x1, never ore. ------------------
  // Proven BEHAVIOURALLY rather than by introspecting the recipe's item ids
  // (which `of.game().recipes` reports as raw ItemIds, not names): the pack
  // carries ZERO raw iron going in (nothing ore has been touched yet in this
  // run), and the craft still succeeds — the only way that can happen is if
  // the bill never asked for ore at all.
  const rawIronBeforeCraft = of.game().carried.find((c) => c.name === 'Raw iron')?.count ?? 0;
  const craftedPick = of.craft(of.game().recipes.findIndex((r) => r.name === 'Crude pickaxe'
    && r.craftable));
  await sleep(0.3);
  const hasPick = (of.game().carried.find((c) => c.name === 'Crude pickaxe')?.count ?? 0) >= 1;
  const rawIronAfterCraft = of.game().carried.find((c) => c.name === 'Raw iron')?.count ?? 0;
  const craftedWithoutOre = rawIronBeforeCraft === 0 && rawIronAfterCraft === 0 && craftedPick;

  // --- 4. Same ore node, now tooled: succeeds. -------------------------------
  const toolBefore = of.nodes().find((n) => n.index === ore.index);
  const tooledTry = of.harvest(ore.index);
  const toolAfter = of.nodes().find((n) => n.index === ore.index);
  const tooledOreSucceeded = tooledTry.ok === true
    && (tooledTry.refusal === null || tooledTry.refusal === undefined)
    && toolAfter.remaining < toolBefore.remaining;

  return {
    valid: (of.world().tick - t0) > 200 && walkedM > 0
      && oneSwingGrantedStone && bareOreRefused && craftedPick && hasPick
      && craftedWithoutOre && tooledOreSucceeded,
    walkedM: +walkedM.toFixed(1),
    oneSwingGrantedStone,
    stoneFromOneSwing: stoneAfter - stoneBefore,
    bareOreRefused, refusedTry,
    craftedPick, hasPick, craftedWithoutOre,
    tooledOreSucceeded, tooledTry,
    carried: of.game().carried,
  };
})()
