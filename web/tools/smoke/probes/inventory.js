// W5 inventory / crafting probe. The interesting half is NOT "does the panel
// appear": it is the pointer transition, which is what separates a demo from a
// game. So the probe drives look deltas and a walk key WHILE THE PANEL IS OPEN
// and asserts the camera and the capsule did not move, then closes it and
// asserts both work again. A panel that merely draws over a still-turning
// camera would pass a screenshot check and fail this one.
//
// OF_ARGS.stop selects where the run parks for the capture:
//   "inventory" leaves the panel open on a stocked pack
//   "crafting"  leaves it open having just crafted through the real DOM button
(async (A) => {
  const of = window.__of;
  const sleep = (n) => of.run(n);
  const yaw = () => of.world().observer.yawDeg;
  const feet = () => of.world().player.aim.origin;
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  const stop = A.stop ?? 'crafting';
  const notes = [];

  await sleep(0.4);
  const t0 = of.world().tick;

  // --- stock the pack through the REAL grant path (reach is the only thing
  //     skipped; harvestNode, the yields and the depletion all run) ----------
  const nodes = of.nodes();
  const pick = (kind, n) => nodes.filter((x) => x.kind === kind).slice(0, n);
  let harvests = 0;
  for (const n of [...pick(0, 3), ...pick(3, 2), ...pick(1, 2), ...pick(2, 1)]) {
    for (let k = 0; k < 4; ++k) if (of.harvest(n.index).ok) harvests++;
  }
  const stocked = of.game().carried;
  if (harvests === 0) return { fail: 'no harvest landed, nothing to show' };

  // --- open the panel with a real Tab press --------------------------------
  of.input.tape([{ hold: 4, keys: ['Tab'] }, { hold: 6, keys: [] }]);
  await sleep(0.35);
  const openState = of.game();
  if (!openState.panelOpen) return { fail: 'Tab did not open the panel', openState };

  // --- THE TRANSITION TEST: the world must be frozen under the cursor ------
  const yawBefore = yaw();
  const feetBefore = feet();
  of.input.tape([
    { hold: 30, keys: ['KeyW'], dYaw: 0.35, dPitch: 0.2 },
    { hold: 30, keys: ['KeyW'], dYaw: 0.35, dPitch: 0.2 },
  ]);
  await sleep(1.1);
  const yawDriftDeg = Math.abs(yaw() - yawBefore);
  const walkedWhileOpen = dist(feet(), feetBefore);
  notes.push(`panel open: yaw drift ${yawDriftDeg.toFixed(4)} deg, `
    + `walked ${walkedWhileOpen.toFixed(4)} m under 60 frames of W + look`);

  // Tab must also not be swallowed: a panel you cannot close is worse than none.
  let crafted = null;
  let recipeShown = null;
  {
    const rows = [...document.querySelectorAll('#of-panel .of-recipe')];
    recipeShown = rows.map((r) => ({
      name: r.querySelector('.nm')?.textContent ?? '',
      enabled: r.querySelector('button')?.disabled === false,
    }));
    if (stop === 'crafting') {
      const btn = document.querySelector('#of-panel .of-recipe button:not([disabled])');
      if (btn === null) return { fail: 'nothing was craftable', stocked, recipeShown };
      const before = of.game().carried.map((c) => `${c.name}:${c.count}`).join(',');
      // A REAL click on the REAL button, so the delegated listener, the craft
      // call and the re-render are all on the tested path.
      btn.click();
      await sleep(0.2);
      crafted = {
        button: btn.getAttribute('data-i'),
        before,
        after: of.game().carried.map((c) => `${c.name}:${c.count}`).join(','),
      };
    }
  }

  // --- close and prove the world came back ---------------------------------
  let closed = null;
  if (stop === 'closed') {
    of.input.tape([{ hold: 4, keys: ['Tab'] }, { hold: 6, keys: [] }]);
    await sleep(0.3);
    const y2 = yaw();
    const f2 = feet();
    of.input.tape([{ hold: 40, keys: ['KeyW'], dYaw: 0.3 }]);
    await sleep(0.8);
    closed = {
      panelOpen: of.game().panelOpen,
      yawMovedDeg: +Math.abs(yaw() - y2).toFixed(3),
      walkedM: +dist(feet(), f2).toFixed(3),
    };
  }

  const g = of.game();
  return {
    advanced: {
      ticks: of.world().tick - t0,
      harvests,
      unitsGranted: g.interact.granted,
      packItems: g.carried.length,
    },
    transition: {
      panelOpen: g.panelOpen,
      yawDriftDeg: +yawDriftDeg.toFixed(4),
      walkedWhileOpenM: +walkedWhileOpen.toFixed(4),
      frozen: yawDriftDeg < 1e-6 && walkedWhileOpen < 1e-3,
    },
    valid: harvests > 0 && g.panelOpen === (stop !== 'closed')
      && yawDriftDeg < 1e-6 && walkedWhileOpen < 1e-3
      && (stop !== 'crafting' || (crafted !== null && crafted.before !== crafted.after))
      && (stop !== 'closed' || (closed !== null && !closed.panelOpen
        && closed.yawMovedDeg > 1 && closed.walkedM > 1)),
    stocked,
    recipeShown,
    crafted,
    closed,
    carried: g.carried,
    slotsUsed: document.querySelectorAll('#of-panel .of-slot.filled').length,
    notes,
  };
})(OF_ARGS)
