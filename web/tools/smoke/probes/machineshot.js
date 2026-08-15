// The capture for GP-61: the machine screen, opened by a REAL left click on the
// furnace with the bare hand, with ore in, fuel burning, an ingot in the output
// slot and the bar part way through the next unit.
//
// It is the same path probes/machinepanel.js asserts, without the assertions:
// a screenshot proves what a thing LOOKS like and a probe proves what it DOES,
// and neither substitutes for the other.
//
//   node tools/smoke/run.mjs --scenario=walk \
//        --evalfile=tools/smoke/probes/machineshot.js \
//        --out=docs/screenshots/GP61_machine_screen.png
(async () => {
  const of = window.__of;
  const el = document.querySelector('canvas');
  if (!of || !el) return { valid: false, why: 'no client' };
  const sleep = (n) => of.run(n);
  const opts = { bubbles: true, pointerId: 1, pointerType: 'mouse', button: 0 };
  const click = async () => {
    el.dispatchEvent(new PointerEvent('pointerdown', opts));
    await sleep(0.11);
    el.dispatchEvent(new PointerEvent('pointerup', opts));
    await sleep(0.3);
  };

  await sleep(0.5);
  // GP-890. TWO SWEEPS WITH THE PICKAXE CRAFTED BETWEEN THEM, the same
  // correction probes/machinepanel.js carries and for the same reason: GP-506
  // made coal, iron and copper `requiresToolFor`, so the single loop this
  // replaces (kinds 0, 3, 2, and never kind 1) landed 183 Wood, took 21
  // ToolRequired refusals on the iron and could not pay the furnace's
  // Wood x5 + Raw iron x2. Wood and loose stone are ungated so the pickaxe
  // (Stone x2 + Wood x1) has a bare-hand path.
  const nodesOnce = of.nodes();
  const packCount = (name) =>
    (of.game().carried.find((c) => c.name === name)?.count ?? 0);
  const KIND_ITEM = { 0: 'Wood', 1: 'Stone', 2: 'Coal', 3: 'Raw iron' };
  let harvests = 0;
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
  await click();                                   // spend the lock-buying click
  if (!pickaxe) return { valid: false, why: 'no pickaxe, so no ore', harvests };
  if (!of.craft(2)) {
    return { valid: false, why: 'no furnace', recipe: of.game().recipes[2] ?? null,
      carried: of.game().carried, harvests };
  }

  of.hotbar(2);
  of.look(of.world().observer.yawDeg, -22);
  await sleep(0.3);
  await click();
  const m = of.game().machines[of.game().machines.length - 1];
  if (m === undefined) return { valid: false, why: 'nothing placed' };

  // Aim squarely at it, then open it with the bare hand and one real click.
  let bestYaw = of.world().observer.yawDeg, bestPitch = -20, best = -2;
  for (let y = bestYaw - 30; y <= bestYaw + 30; y += 3) {
    for (let p = -55; p <= 10; p += 3) {
      of.look(y, p);
      const a = of.aim();
      const v = [m.pos[0] - a.origin[0], m.pos[1] - a.origin[1], m.pos[2] - a.origin[2]];
      const l = Math.hypot(v[0], v[1], v[2]) || 1;
      const k = (a.dir[0] * v[0] + a.dir[1] * v[1] + a.dir[2] * v[2]) / l;
      if (k > best) { best = k; bestYaw = y; bestPitch = p; }
    }
  }
  of.look(bestYaw, bestPitch);
  await sleep(0.25);
  of.hotbar(1);
  await sleep(0.2);
  await click();
  if (!of.game().screen.open) return { valid: false, why: 'the screen did not open' };

  const btn = (match) => [...document.querySelectorAll('#of-furnace button[data-load]')]
    .find((x) => x.textContent.includes(match)) ?? null;
  btn('Raw iron')?.click();
  await sleep(0.1);
  (btn('Coal') ?? btn('Wood'))?.click();
  await sleep(0.1);
  // Past one whole unit, so the OUTPUT slot has something in it and the bar is
  // part way through the next: an empty output slot would not show the feature.
  await sleep(200 / 60);
  return { valid: true, screen: of.game().screen, aimDot: best };
})()
