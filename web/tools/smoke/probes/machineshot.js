// The capture for GP-57: the machine screen, opened by a REAL left click on the
// furnace with the bare hand, with ore in, fuel burning, an ingot in the output
// slot and the bar part way through the next unit.
//
// It is the same path probes/machinepanel.js asserts, without the assertions:
// a screenshot proves what a thing LOOKS like and a probe proves what it DOES,
// and neither substitutes for the other.
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
  let harvests = 0;
  for (const n of of.nodes()) {
    if (n.kind !== 0 && n.kind !== 3 && n.kind !== 2) continue;
    for (let k = 0; k < 3; ++k) if (of.harvest(n.index).ok) harvests++;
    if (harvests > 30) break;
  }
  of.hotbar(1);
  of.look(of.world().observer.yawDeg, -70);
  await click();                                   // spend the lock-buying click
  if (!of.craft(2)) return { valid: false, why: 'no furnace' };

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
