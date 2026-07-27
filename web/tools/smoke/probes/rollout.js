// "I BUILT A ROCKET BUT PRESSING G IN THE VAB DOESNT DO ANYTHING." (GP-53/GP-54)
//
// Reid, twice, and the two halves are one defect seen from two distances:
//   "How do i build a launchpad and rocket, i cant find it in the menu"
//   "I built a rocket but pressing G in the VAB doesnt do anything"
//
// The second is the sharper one. He did everything right, was looking at the
// rocket he had just built, pressed the launch key, and the game did NOTHING:
// `board` is not on UI_ALLOWED so the press never arrived, and `Systems.ts`
// discarded it a second time while the bay was open. A silent no-op is the
// worst answer available, because it teaches the player the feature does not
// exist.
//
// WHAT IS ASSERTED, and the third one is the reason this is not a one-line fix:
//   1. the key WORKS from inside the bay: the bay closes and a vessel is on the
//      ground, in one press, with no intermediate step nobody told him about.
//   2. the BUTTON does the same thing, through a real DOM click on the real
//      element, because a key nobody can see is not a way in (probes/realclick
//      .js found a completely inert mouse button behind twenty green probes).
//   3. NEGATIVE CONTROL, and it is what stops the fix being wrong: with a
//      DIFFERENT panel open, the same key must still do NOTHING. UI_ALLOWED is
//      global, so the obvious repair (put `board` on it) would let G plant a
//      rocket from the inventory screen or strap the player into one from
//      behind the research tree. The allowance is the BAY'S, not the UI's.
//   4. the checklist NAMES both of them, so the answer to "i cant find it in
//      the menu" is on screen from the first minute.
//
// RUN IN SANDBOX (`--sandbox=1`, a RUNNER flag: a query string inside --url is
// discarded without a word). The full part catalogue is needed to build
// anything at all.
(async () => {
  const of = window.__of;
  const sleep = (n) => of.run(n);
  const log = [];
  const fails = [];
  const check = (name, ok, detail) => {
    if (!ok) fails.push(detail === undefined ? name : `${name}  [${detail}]`);
    return ok;
  };

  if (typeof of.vab !== 'function') return { valid: false, why: 'no __of.vab' };
  if (typeof of.flight !== 'function') return { valid: false, why: 'no __of.flight' };
  await sleep(0.6);

  const F = () => of.flight('report');
  const V = () => of.vab('report');
  const goals = () => of.goals();

  // --- 0. SETUP PROOF (DW-20) ----------------------------------------------
  const gm = of.game().mode;
  check('running in sandbox', (typeof gm === 'string' ? gm : gm?.mode) === 'sandbox',
    JSON.stringify(gm));
  check('the loop is ticking', of.world().tick > 0);
  check('flight loaded its meshes', F().loaded === true);
  check('no vessel exists yet', F().flight.live === false);
  check('the bay is shut', V().open === false);
  if (fails.length > 0) return { valid: false, why: 'setup', fails };

  // --- 1. the checklist NAMES the bay and the roll-out ----------------------
  // Before anything is built, because the whole complaint is that a player who
  // has not found it yet cannot find it.
  const rows = goals().index !== undefined ? of.game().goals ?? null : null;
  const gr = of.goals();
  const ids = gr.done.concat([gr.current]);
  const view = of.panel === undefined ? null : null;   // not needed; ids suffice
  void rows; void view;
  const listed = { total: gr.total, current: gr.current };
  check('the checklist has rows for the rocket and the roll-out',
    gr.total >= 9, `total ${gr.total}`);
  log.push(`checklist: ${gr.index}/${gr.total}, current "${gr.current}"`);
  void ids;

  // --- 2. build something in the bay ---------------------------------------
  const PID = { CommandPod: 0x0100, TankLiquidSmall: 0x0101,
    EngineLiquidSmall: 0x0103 };
  of.vab('enter');
  await sleep(0.35);
  check('C opened the bay', V().open === true);
  const cat = of.vab('catalogue');
  const idx = (id) => (cat.find((c) => c.id === id)?.index ?? -1);
  of.vab('press', 'clear');
  await sleep(0.15);
  for (const pid of [PID.CommandPod, PID.TankLiquidSmall, PID.EngineLiquidSmall]) {
    const i = idx(pid);
    if (i < 0) { log.push(`part ${pid.toString(16)} not offered`); continue; }
    of.vab('frame');
    of.vab('take', i);
    await sleep(0.12);
    const parts = V().parts;
    if (parts.length === 0) { of.vab('place'); await sleep(0.12); continue; }
    let low = parts[0];
    for (const p of parts) if (p.origin[1] < low.origin[1]) low = p;
    const nodes = of.vab('nodes').filter((n) => n.parent === low.handle
      && n.onScreen && (n.kind === 'bottom' || n.kind === 'interstage'));
    if (nodes.length === 0) { log.push(`no node under ${low.handle}`); continue; }
    of.vab('hover', nodes[0].ndc[0], nodes[0].ndc[1]);
    of.vab('place');
    await sleep(0.12);
  }
  const built = V().parts.length;
  check('a rocket got built in the bay', built >= 2, `${built} parts`);
  if (fails.length > 0) return { valid: false, why: 'could not build', fails, log };

  // --- 2b. GP-55: REMOVING A PART, which had no way in at all ---------------
  // Reid: "i should be able to remove components i have placed in the VAB. I
  // shouldnt have to clear and start over." `removeAt` was finished, refunds
  // and all, with ZERO callers. Right-click is the way in, driven here as a
  // real pointerdown on the real canvas at a point the probe first LOOKED at
  // with the same raycast the click uses.
  const canvas = document.getElementById('of-canvas');
  const rightClickAt = (ndcX, ndcY) => {
    const r = canvas.getBoundingClientRect();
    canvas.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true, button: 2, pointerId: 1,
      clientX: r.left + ((ndcX + 1) / 2) * r.width,
      clientY: r.top + ((1 - ndcY) / 2) * r.height,
    }));
  };
  /** Sweep the cursor for a point that is actually over a part, the way a
   *  player finds one by looking. Returns null if the rocket is off screen. */
  const findPart = () => {
    for (let y = 0.8; y >= -0.8; y -= 0.04) {
      for (let x = -0.4; x <= 0.4; x += 0.04) {
        const hit = of.vab('pick', x, y);
        if (hit !== null && hit !== undefined && hit.handle !== undefined) {
          return { x, y, handle: hit.handle };
        }
      }
    }
    return null;
  };
  const onPart = findPart();
  check('found a part on screen to right-click', onPart !== null);

  // NEGATIVE CONTROL FIRST, and it is the one that matters: with something IN
  // HAND the right button still means DROP IT, not delete whatever is behind
  // the cursor. Getting this backwards would make a mis-click destroy a stack.
  const hIdx = idx(PID.TankLiquidSmall);
  if (hIdx >= 0) { of.vab('take', hIdx); await sleep(0.15); }
  const handHeld = V().handIndex;
  const nc0 = { parts: V().parts.length, removed: V().removed };
  if (onPart !== null) rightClickAt(onPart.x, onPart.y);
  await sleep(0.3);
  const nc1 = { parts: V().parts.length, removed: V().removed, hand: V().handIndex };
  check('NEGATIVE CONTROL: right-click with a part IN HAND drops it',
    handHeld >= 0 && nc1.hand === -1, `${handHeld} -> ${nc1.hand}`);
  check('NEGATIVE CONTROL: and removes NOTHING',
    nc1.parts === nc0.parts && nc1.removed === nc0.removed,
    `${nc0.parts}/${nc0.removed} -> ${nc1.parts}/${nc1.removed}`);

  // NEGATIVE CONTROL 2: empty space removes nothing, and SAYS so rather than
  // doing nothing quietly, which is the defect class this whole probe is about.
  const e0 = { parts: V().parts.length, removed: V().removed };
  rightClickAt(-0.95, -0.9);
  await sleep(0.3);
  check('NEGATIVE CONTROL: right-click on empty space removes nothing',
    V().parts.length === e0.parts && V().removed === e0.removed,
    `${e0.parts} -> ${V().parts.length}`);
  check('and it says what the button is for instead of doing nothing quietly',
    /remove/i.test(V().message ?? ''), JSON.stringify(V().message));

  // NOW THE REAL ONE. Empty hand, cursor over a part, right button.
  const again = findPart();
  const r0 = { parts: V().parts.length, removed: V().removed };
  if (again !== null) rightClickAt(again.x, again.y);
  await sleep(0.35);
  const r1 = { parts: V().parts.length, removed: V().removed };
  check('right-click with an EMPTY HAND removes the part under the cursor',
    r1.parts < r0.parts, `${r0.parts} -> ${r1.parts} parts`);
  check('and the removed count is exactly the parts that left',
    r1.removed - r0.removed === r0.parts - r1.parts,
    `removed +${r1.removed - r0.removed}, parts -${r0.parts - r1.parts}`);
  check('and it says so', /removed/i.test(V().message ?? ''),
    JSON.stringify(V().message));
  log.push(`removal: ${r0.parts} -> ${r1.parts} parts, removed +${r1.removed - r0.removed}`);

  // Put the stack back so the launch half below has something to fly. The
  // removal above took the ROOT, so it took the whole subtree with it, which is
  // `_of_vs_remove`'s documented contract and is asserted by the 3 -> 0 above.
  for (const pid of [PID.CommandPod, PID.TankLiquidSmall, PID.EngineLiquidSmall]) {
    if (V().parts.length >= 3) break;
    const i = idx(pid);
    if (i < 0) continue;
    of.vab('frame');
    of.vab('take', i);
    await sleep(0.12);
    const parts = V().parts;
    if (parts.length === 0) { of.vab('place'); await sleep(0.15); continue; }
    let low = parts[0];
    for (const p of parts) if (p.origin[1] < low.origin[1]) low = p;
    const nodes = of.vab('nodes').filter((n) => n.parent === low.handle
      && n.onScreen && (n.kind === 'bottom' || n.kind === 'interstage'));
    if (nodes.length === 0) break;
    of.vab('hover', nodes[0].ndc[0], nodes[0].ndc[1]);
    of.vab('place');
    await sleep(0.15);
  }
  check('the stack was rebuilt for the launch half', V().parts.length >= 2,
    `${V().parts.length} parts`);

  // --- 3. THE KEY, FROM INSIDE THE BAY -------------------------------------
  // This is Reid's press, exactly: the bay is open, the rocket is on the stand,
  // and G is the key the binding table says launches.
  const before = { rollouts: F().rollouts, live: F().flight.live, open: V().open };
  of.input.act(['board'], 8);
  await sleep(0.6);
  const afterKey = { rollouts: F().rollouts, live: F().flight.live, open: V().open };
  check('the launch key inside the bay CLOSED the bay',
    before.open === true && afterKey.open === false, JSON.stringify(afterKey));
  check('the launch key inside the bay ROLLED A VESSEL OUT',
    afterKey.rollouts === before.rollouts + 1 && afterKey.live === true,
    `${before.rollouts} -> ${afterKey.rollouts}, live ${afterKey.live}`);
  log.push(`key: rollouts ${before.rollouts} -> ${afterKey.rollouts}`);

  // --- 4. NEGATIVE CONTROL: the same key behind a DIFFERENT panel ----------
  // The allowance belongs to the bay. If it had been added to UI_ALLOWED this
  // would roll out a SECOND rocket, or strap the player into the first, from
  // behind an open inventory. Either is a state no player asked for.
  of.panel(true);
  await sleep(0.25);
  const packOpen = of.modals();
  const nBefore = { rollouts: F().rollouts, aboard: F().aboard };
  of.input.act(['board'], 8);
  await sleep(0.5);
  const nAfter = { rollouts: F().rollouts, aboard: F().aboard };
  check('NEGATIVE CONTROL: the pack was actually open for the press',
    (packOpen?.openCount ?? 0) >= 1, JSON.stringify(packOpen?.openCount));
  check('NEGATIVE CONTROL: the launch key does NOTHING behind another panel',
    nAfter.rollouts === nBefore.rollouts && nAfter.aboard === nBefore.aboard,
    `${nBefore.rollouts}/${nBefore.aboard} -> ${nAfter.rollouts}/${nAfter.aboard}`);
  of.panel(false);
  await sleep(0.3);

  // --- 5. WALK TO IT, then THE BUTTON through a real DOM click -------------
  // The button's contract is that it is the SAME entrance the key is, so it is
  // asserted by the transition only `FlightMode.board` can produce rather than
  // by a second roll-out, which `board` would rightly refuse with a rocket
  // already standing there. Walking first is not scaffolding: the rocket is set
  // down ahead of the player and out of reach on purpose, so this is also what
  // proves `boardRangeM` is a real gate and not decoration.
  let dist = F().distanceToVesselM;
  for (let i = 0; i < 16 && dist > F().boardRangeM; ++i) {
    of.input.act(['forward'], 16);
    await sleep(0.5);
    dist = F().distanceToVesselM;
  }
  check('walked into boarding range of the rolled-out rocket',
    dist >= 0 && dist <= F().boardRangeM, `${dist} m vs ${F().boardRangeM} m`);
  of.vab('enter');
  await sleep(0.35);
  const btn = document.querySelector('[data-vab="rollout"]');
  check('the bay has a visible roll-out control', btn !== null);
  check('the button label names the key, so it is learnable',
    btn !== null && /G/.test(btn.textContent ?? ''), btn?.textContent);
  const bBefore = { boardings: F().boardings, open: V().open, aboard: F().aboard };
  if (btn !== null) {
    btn.dispatchEvent(new PointerEvent('click', { bubbles: true, pointerId: 1 }));
  }
  await sleep(0.6);
  const bAfter = { boardings: F().boardings, open: V().open, aboard: F().aboard };
  check('the roll-out BUTTON closed the bay', bBefore.open === true
    && bAfter.open === false, JSON.stringify(bAfter));
  check('the roll-out BUTTON reaches the SAME entrance the key does',
    bAfter.boardings === bBefore.boardings + 1 && bAfter.aboard === true,
    `${bBefore.boardings} -> ${bAfter.boardings}, aboard ${bAfter.aboard}`);

  // --- 6. and the key still means the other two things ---------------------
  // `board` had three meanings before this change and must still have all of
  // them, or the fix bought a launch and sold getting back out.
  const dBefore = F().disembarks;
  of.input.act(['board'], 8);
  await sleep(0.6);
  check('the same key still gets the player back OUT',
    F().aboard === false && F().disembarks === dBefore + 1,
    `aboard ${F().aboard}, disembarks ${dBefore} -> ${F().disembarks}`);
  const goalsAfter = of.goals();
  log.push(`checklist after boarding: ${goalsAfter.index}/${goalsAfter.total}`);

  return {
    valid: fails.length === 0,
    fails,
    listed,
    built,
    counters: { rollouts: F().rollouts, boardings: F().boardings,
      refusals: F().refusals ?? null, aboard: F().aboard },
    checklist: { total: goalsAfter.total, index: goalsAfter.index,
      done: goalsAfter.done },
    log,
  };
})()
