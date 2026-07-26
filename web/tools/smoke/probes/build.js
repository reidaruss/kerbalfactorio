// BASE BUILDING acceptance. Everything here is driven through the player's own
// controls and the player's own aim; nothing reaches past the handlers a person
// can reach.
//
// THE CONTROLS ARE ASKED FOR BY ACTION and never by key (Bindings.ts): `use` is
// the left mouse button and places whatever the hotbar holds, `interact` is E
// and opens the furnace without ever harvesting. `of.build(n)` still means the
// old build-menu index, because it is now a view onto hotbar slots 3 to 9.
//
// The seven claims, and why each is the one worth asserting:
//   1. a foundation snaps, and two neighbours MEET. The gap is measured against
//      the module the assets ship, not eyeballed, because a tiling set that is
//      0.4 m out looks fine from 30 m and is ruined from 2 m.
//   2. free placement puts a part where it was AIMED, to prove the snap is a
//      mode and not the only thing the code can do.
//   3. a wall lands on the foundation's own `socket_edge_*`, read out of the
//      shipped .glb. If the code had retyped the module constants this would
//      pass anyway, which is why it is compared against the socket and not
//      against 0.5.
//   4. a door OPENS and the player WALKS THROUGH, with a shut-door negative
//      control. This is the assertion that catches a hulled collision proxy: a
//      single convex hull of a doorway is a sealed wall, and it would pass every
//      other check in this file.
//   5. DW-24 end to end: the ghost reads INVALID on ground too uneven, says so
//      by naming the levelling tool, and reads VALID after one press of Q.
//   6. placement SPENDS the cost and REFUSES when the pack is short.
//   7. the whole structure survives a save and a reload, with the live world
//      forced back first (the tunnelpersist.js technique) so the assertion
//      cannot pass by reading state that never left memory.
(async () => {
  const of = window.__of;
  const sleep = (n) => of.run(n);
  const log = [];
  const fail = (why, extra) => ({ fail: why, ...extra, log });

  await sleep(0.6);
  const t0 = of.world().tick;
  const st = of.structures();
  if (st === null) return fail('no structural layer');
  const M = of.game().structures.module;
  const yaw = of.world().observer.yawDeg;

  // --- stock the pack, by harvesting, which is the only way a player can -----
  let harvests = 0;
  for (const n of of.nodes()) {
    if (![0, 1, 2, 3].includes(n.kind)) continue;
    for (let k = 0; k < 8; ++k) if (of.harvest(n.index).ok) harvests++;
  }
  const named = () => Object.fromEntries(of.game().carried.map((c) => [c.name, c.count]));
  log.push(`stocked in ${harvests} swings: ${JSON.stringify(named())}`);

  // --- one iron ingot, through the furnace, because a door needs one ---------
  if (!of.craft(2)) return fail('could not craft the furnace', { pack: named() });
  of.look(yaw, -18);
  await sleep(0.2);
  // Slot 2 is the crafted hand furnace; the click places what the hand holds.
  of.hotbar(2);
  await sleep(0.15);
  of.input.tape([{ hold: 4, actions: ['use'] }, { hold: 8, keys: [] }]);
  await sleep(0.4);
  if (of.game().machines.length === 0) return fail('the click placed no furnace');
  of.input.tape([{ hold: 4, actions: ['interact'] }, { hold: 10, keys: [] }]);
  await sleep(0.4);
  const click = (m) => {
    const b = [...document.querySelectorAll('#of-furnace button[data-load]')]
      .find((x) => x.textContent.includes(m));
    if (b === undefined) return false;
    b.click();
    return true;
  };
  click('Raw iron'); await sleep(0.05);
  if (!click('Coal')) click('Wood');
  await sleep(200 / 60);
  const take = document.querySelector('#of-furnace button[data-take]');
  if (take !== null) take.click();
  await sleep(0.1);
  of.input.tape([{ hold: 4, actions: ['interact'] }, { hold: 8, keys: [] }]);
  await sleep(0.3);
  of.demolish({ machine: 0 });
  await sleep(0.2);
  const stocked = named();
  if ((stocked.Iron ?? 0) < 1) return fail('no iron ingot for a door', { stocked });
  log.push(`smelted, pack now ${JSON.stringify(stocked)}`);

  // --- aim helpers -----------------------------------------------------------
  // Sweep the pitch until the ghost names the cell we want. This is exactly how
  // a player finds a cell: move the crosshair and watch the preview.
  const ghost = () => of.build().structGhost;
  // Two dimensions, because one pitch line only ever visits one row of cells and
  // a base has edges on four sides.
  const sweep = async (want, lo = -85, hi = -20, yaws = [0]) => {
    for (const dy of yaws) {
      for (let p = lo; p <= hi; p += 2.5) {
        of.look((yaw + dy + 360) % 360, p);
        await sleep(0.06);
        const g = ghost();
        if (g !== null && want(g)) return { g, pitch: p, yaw: (yaw + dy + 360) % 360 };
      }
    }
    return null;
  };
  const AROUND = [0, 30, -30, 60, -60, 90, -90, 150, -150, 180];
  const same = (a, b) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

  // --- 1a. the first foundation, which FOUNDS the site ----------------------
  // Straight down, so the site's own origin cell is the one the player is
  // standing on. Until a site exists every ghost founds a fresh one at its own
  // aim point and is therefore trivially level with itself, which is exactly why
  // the DW-24 check below has to come after this and not before it.
  of.build(4);
  await sleep(0.15);
  const under = await sweep((g) => g.addr !== null && g.ok, -88, -62);
  if (under === null) return fail('no valid cell underfoot', { ghost: ghost() });
  const cellA = under.g.addr;
  const spendBefore = named();
  of.input.tape([{ hold: 4, actions: ['use'] }, { hold: 8, keys: [] }]);
  await sleep(0.35);
  if (of.game().structures.parts.length !== 1) {
    return fail('the click placed no foundation', { ghost: ghost() });
  }
  const spendAfter = named();
  const stoneSpent = (spendBefore.Stone ?? 0) - (spendAfter.Stone ?? 0);
  log.push(`foundation at ${cellA}, Stone ${spendBefore.Stone} -> ${spendAfter.Stone}`);

  // --- 5. DW-24 end to end: refused, levelled with Q, accepted --------------
  // A cell out on the SAME site, where the terrain has left the site plane. The
  // refusal has to name the tool, because being refused is how the tool is found.
  const away = await sweep((g) => g.addr !== null && !g.ok
    && g.reason.startsWith('ground too uneven'), -58, -26);
  const unlevelled = away === null ? null : { ...away.g };
  log.push(unlevelled === null ? 'no uneven cell within reach of this site'
    : `invalid at ${unlevelled.addr}: ${unlevelled.reason}`);

  let levelled = null;
  let fixedByQ = 0;
  let stillRefused = 0;
  if (away !== null) {
    const tf0 = of.terraform();
    // Q is held at the SAME aim, so the 6 m disc lands on the cell that was just
    // refused. The target is latched from the ground under the feet, which is
    // the site plane by construction.
    of.look(yaw, away.pitch);
    await sleep(0.15);
    of.input.tape([{ hold: 40, keys: ['KeyQ'] }, { hold: 30, keys: [] }]);
    await sleep(1.6);
    const tf1 = of.terraform();
    // Sweep the whole levelled disc and count what it BOUGHT. One cell turning
    // valid is the DW-24 loop closing; the ratio is the honest measure of how
    // good the levelling tool is, and it is reported rather than hidden, because
    // the tool moves whole 1 m voxel cells and cannot flatten to less than that.
    for (let p = -80; p <= -25; p += 2.5) {
      of.look(yaw, p);
      await sleep(0.06);
      const gg = ghost();
      if (gg === null || gg.addr === null) continue;
      if (gg.ok) fixedByQ++;
      else if (gg.reason.startsWith('ground too uneven')) stillRefused++;
      if (gg.ok && levelled === null && gg.key === unlevelled.key) {
        levelled = { ...gg, dug: tf1.removedCells - tf0.removedCells,
          filled: tf1.addedCells - tf0.addedCells };
      }
    }
    if (levelled === null) {
      // The exact cell did not come good, so take any cell the press bought.
      for (let p = -80; p <= -25 && levelled === null; p += 2.5) {
        of.look(yaw, p);
        await sleep(0.06);
        const gg = ghost();
        if (gg !== null && gg.addr !== null && gg.ok) {
          levelled = { ...gg, dug: tf1.removedCells - tf0.removedCells,
            filled: tf1.addedCells - tf0.addedCells, otherCell: true };
        }
      }
    }
    log.push(`after Q: ${fixedByQ} of ${fixedByQ + stillRefused} aimed cells now `
      + `accept a foundation (dug ${tf1.removedCells - tf0.removedCells}, `
      + `filled ${tf1.addedCells - tf0.addedCells})`);
  }

  // --- 1b. the NEIGHBOUR, and the gap between the two decks ----------------
  const nb = await sweep((g) => g.addr !== null && g.ok
    && Math.abs(g.addr[0] - cellA[0]) + Math.abs(g.addr[1] - cellA[1]) === 1
    && g.addr[2] === cellA[2], -85, -25);
  if (nb === null) return fail('no adjacent cell', { cellA, ghost: ghost() });
  const cellB = nb.g.addr;
  of.input.tape([{ hold: 4, actions: ['use'] }, { hold: 8, keys: [] }]);
  await sleep(0.35);
  const two = of.game().structures.parts;
  if (two.length !== 2) return fail('the neighbour was refused', { cellB, two });
  const centres = dist(two[0].pos, two[1].pos);
  // A gap is the centre distance minus one module. Zero means the two 1.00 m
  // decks touch exactly: no seam and no overlap.
  const gapM = centres - M.cellM;
  log.push(`decks ${cellA} and ${cellB}: centres ${centres.toFixed(9)} m, `
    + `gap ${gapM.toExponential(3)} m`);

  // --- 3. a wall on the deck's own socket -----------------------------------
  of.build(6);
  await sleep(0.15);
  const wallAim = await sweep((g) => g.addr !== null && g.ok, -75, -30);
  if (wallAim === null) return fail('no valid wall edge', { ghost: ghost() });
  of.input.tape([{ hold: 4, actions: ['use'] }, { hold: 8, keys: [] }]);
  await sleep(0.35);
  const parts = of.game().structures.parts;
  const wall = parts.find((p) => p.kind === 'wall');
  if (wall === undefined) return fail('the wall was refused', { parts });
  // The published contract: a wall's ORIGIN goes on the deck's edge socket.
  // Read the socket out of the shipped file rather than recomputing 0.5.
  const deck = st.parts.find((p) => p.kind === 'foundation'
    && Math.abs(p.addr.i - wall.addr[0]) <= 1 && Math.abs(p.addr.j - wall.addr[1]) <= 1);
  const root = st.scenes.get('foundation');
  let socketErrM = null;
  if (deck !== undefined && root !== undefined) {
    let best = Infinity;
    for (const n of ['socket_edge_n', 'socket_edge_e', 'socket_edge_s', 'socket_edge_w']) {
      const s = root.getObjectByName(n);
      if (s === undefined) continue;
      const v = s.position.clone().applyQuaternion(deck.quat);
      best = Math.min(best, dist([deck.pos.x + v.x, deck.pos.y + v.y, deck.pos.z + v.z],
        wall.pos));
    }
    socketErrM = best;
  }
  log.push(`wall at ${wall.addr}, ${socketErrM === null ? 'no deck'
    : socketErrM.toExponential(3)} m from the nearest published edge socket`);

  // --- 4. a door, opened, walked through, with a shut negative control ------
  of.build(7);
  await sleep(0.15);
  const doorAim = await sweep((g) => g.addr !== null && g.ok
    && g.key !== `w${wall.addr[3]}:${wall.addr[0]},${wall.addr[1]},${wall.addr[2]}`,
  -75, -25, AROUND);
  if (doorAim === null) return fail('no valid door edge', { ghost: ghost() });
  of.input.tape([{ hold: 4, actions: ['use'] }, { hold: 8, keys: [] }]);
  await sleep(0.35);
  const door = of.game().structures.parts.find((p) => p.kind === 'door');
  if (door === undefined) return fail('the door was refused');

  // --- 6. a SECOND door is unaffordable, and the ghost says so -------------
  // The pack held exactly one ingot and the first door spent it, so the refusal
  // is deterministic rather than a matter of harvesting the pack empty. It runs
  // here, while the two decks still have free edges to aim at.
  const short = await sweep((g) => g.addr !== null
    && g.reason.startsWith('need '), -75, -25, AROUND);
  const n0 = of.game().structures.parts.length;
  of.input.tape([{ hold: 4, actions: ['use'] }, { hold: 6, keys: [] }]);
  await sleep(0.25);
  const shortReason = short === null ? '' : short.g.reason;
  const placedWhileShort = of.game().structures.parts.length - n0;
  log.push(`short pack: "${shortReason}", placed ${placedWhileShort}`);

  of.build(0);
  await sleep(0.1);

  // The opening's own centre line, sampled at the three capsule heights through
  // the SAME predicate the walker uses. A hulled proxy blocks all of them.
  const live = st.parts.find((p) => p.id === door.id);
  const up = [live.up.x, live.up.y, live.up.z];
  const probeOpening = () => [0.15, 0.9, 1.65].map((h) =>
    of.solidBuild(live.pos.x + up[0] * h, live.pos.y + up[1] * h,
      live.pos.z + up[2] * h));
  const shutBlocks = probeOpening();
  const opened = of.door(door.id, true);
  await sleep(0.8);
  const openBlocks = probeOpening();
  log.push(`doorway solid shut ${JSON.stringify(shutBlocks)} `
    + `open ${JSON.stringify(openBlocks)} (swing ${of.door(door.id, true).swing})`);

  // The driven walk. Site-local north/east of the feet, before and after, so
  // "got through" is a coordinate that crossed the wall line and not a vibe.
  const localFeet = () => {
    const f = of.world().player.feet;
    const l = st.localIn(live.siteId, { x: f[0], y: f[1], z: f[2] });
    return l;
  };
  const axis = door.addr[3] === 0 ? 1 : 0;   // which local axis the door divides
  const lineAt = door.addr[3] === 0 ? door.addr[1] : door.addr[0];
  const startL = localFeet();
  // Face the door: the tangent heading that increases the dividing coordinate.
  const towards = startL[axis] < lineAt ? 1 : -1;
  let bestYaw = yaw;
  let bestDot = -2;
  for (let y = 0; y < 360; y += 5) {
    of.look(y, -6);
    await sleep(0.03);
    const d = of.world().player.aim.dir;
    const site = st.sites.find((s) => s.id === live.siteId);
    const ax = axis === 0 ? site.east : site.north;
    const dot = towards * (d[0] * ax.x + d[1] * ax.y + d[2] * ax.z);
    if (dot > bestDot) { bestDot = dot; bestYaw = y; }
  }
  of.look(bestYaw, -6);
  await sleep(0.2);

  const walk = async (secs) => {
    of.input.tape([{ hold: Math.round(secs * 60), keys: ['KeyW'] },
      { hold: 6, keys: [] }]);
    await sleep(secs + 0.3);
    return localFeet();
  };
  const crossedOpen = await walk(1.6);
  const passedOpen = towards > 0 ? crossedOpen[axis] > lineAt + 0.25
    : crossedOpen[axis] < lineAt - 0.25;
  log.push(`walk with the door OPEN: ${axis === 0 ? 'east' : 'north'} `
    + `${startL[axis].toFixed(2)} -> ${crossedOpen[axis].toFixed(2)} `
    + `(line ${lineAt}), passed ${passedOpen}`);

  // NEGATIVE CONTROL: shut it and walk back. A hulled proxy passes nothing; a
  // missing leaf proxy passes everything. Only a correct one passes exactly one.
  of.door(door.id, false);
  await sleep(0.8);
  of.look((bestYaw + 180) % 360, -6);
  await sleep(0.2);
  const backShut = await walk(1.6);
  const blockedByShut = towards > 0 ? backShut[axis] > lineAt + 0.05
    : backShut[axis] < lineAt - 0.05;
  log.push(`walk back with it SHUT: ${crossedOpen[axis].toFixed(2)} -> `
    + `${backShut[axis].toFixed(2)}, blocked ${blockedByShut}`);
  of.door(door.id, true);

  // --- 2. free placement lands where it was aimed ---------------------------
  of.build(6);
  await sleep(0.1);
  of.input.tape([{ hold: 4, keys: ['KeyB'] }, { hold: 6, keys: [] }]);
  await sleep(0.25);
  const freeAim = await sweep((g) => g.free === true && g.ok, -60, -20, AROUND);
  const freeGhost = freeAim === null ? ghost() : freeAim.g;
  const freeBefore = of.game().structures.parts.length;
  of.input.tape([{ hold: 4, actions: ['use'] }, { hold: 8, keys: [] }]);
  await sleep(0.35);
  const freeParts = of.game().structures.parts;
  const freePart = freeParts[freeParts.length - 1];
  const freeErrM = freeGhost === null || freeParts.length === freeBefore ? null
    : dist(freeGhost.pos, freePart.pos);
  log.push(`free placement: ghost free=${freeGhost?.free} ok=${freeGhost?.ok} `
    + `"${freeGhost?.reason}" landed `
    + `${freeErrM === null ? 'nowhere' : freeErrM.toExponential(3)} m from the aim`);
  // Back to snapping, so the world the save captures is the grid-built one.
  of.input.tape([{ hold: 4, keys: ['KeyB'] }, { hold: 6, keys: [] }]);
  await sleep(0.25);

  // --- 7. save, force the live world back, reload ---------------------------
  const before = of.game().structures.parts;
  const saved = await of.save();
  for (const p of [...before]) of.demolish({ part: p.id });
  await sleep(0.3);
  const emptied = of.game().structures.parts.length;
  const restored = await of.load();
  await sleep(0.4);
  const after = of.game().structures.parts;
  let worstMoveM = 0;
  for (const p of before) {
    const q = after.find((r) => r.key === p.key);
    if (q === undefined) { worstMoveM = Infinity; break; }
    worstMoveM = Math.max(worstMoveM, dist(p.pos, q.pos));
  }
  log.push(`save/reload: ${before.length} parts -> ${emptied} -> ${after.length}, `
    + `worst move ${worstMoveM.toExponential(3)} m`);

  // Frame the capture: open the door again, back off and look at the base.
  const d2 = of.game().structures.parts.find((p) => p.kind === 'door');
  if (d2 !== undefined) of.door(d2.id, true);
  of.build(0);
  of.look((bestYaw + 180) % 360, -4);
  await sleep(0.3);
  of.input.tape([{ hold: 55, keys: ['KeyW'] }, { hold: 10, keys: [] }]);
  await sleep(1.5);
  of.look(bestYaw, -8);
  await sleep(0.8);

  const g = of.game();
  return {
    advanced: { ticks: of.world().tick - t0, harvests },
    module: M,
    tolerance: g.structures.tolerance,
    grid: {
      cellA, cellB,
      centreDistanceM: +centres.toFixed(9),
      gapM: +gapM.toExponential(3),
      socketErrM: socketErrM === null ? null : +socketErrM.toExponential(3),
      freeErrM: freeErrM === null ? null : +freeErrM.toExponential(3),
      sites: g.structures.sites,
    },
    dw24: {
      invalidReason: unlevelled?.reason ?? null,
      invalidUnevennessM: unlevelled?.unevennessM ?? null,
      validAfterQ: levelled?.ok ?? null,
      unevennessAfterQ: levelled?.unevennessM ?? null,
      sameCell: levelled === null ? null : levelled.otherCell !== true,
      cellsValidAfterQ: fixedByQ, cellsStillRefused: stillRefused,
      cellsDug: levelled?.dug ?? 0, cellsFilled: levelled?.filled ?? 0,
      unevenRefusals: g.structures.unevenRefusals,
    },
    door: {
      id: door.id, opened: opened.wantOpen,
      shutBlocks, openBlocks, passedOpen, blockedByShut,
      swingSecs: g.structures.swing.secs, swingRad: g.structures.swing.rad,
    },
    cost: { stoneSpentPerFoundation: stoneSpent, shortReason, placedWhileShort,
      costs: g.structures.costs },
    persist: { saved, autosaves: g.persist.saves,
      before: before.length, emptied, after: after.length,
      worstMoveM: +worstMoveM.toExponential(3), restored: restored?.structures ?? 0 },
    budget: { drawCalls: of.stats().draw.calls, cap: of.stats().budget.drawCalls,
      instances: g.baseView.instances, batches: g.baseView.batches },
    valid:
      of.world().tick - t0 > 600
      // 1. the module is the assets', and neighbours meet exactly
      && Math.abs(M.cellM - 1) < 1e-9 && Math.abs(M.storey - 3) < 1e-9
      && Math.abs(gapM) < 1e-6
      // 2. free placement lands where it was aimed
      && freeErrM !== null && freeErrM < 1e-6
      // 3. the wall is on the deck's own published socket
      && socketErrM !== null && socketErrM < 1e-6
      // 4. the doorway is open when the door is, shut when it is not, and the
      //    player crosses it in exactly one of those two states
      && shutBlocks.some((b) => b) && openBlocks.every((b) => !b)
      && passedOpen && blockedByShut
      // 5. DW-24 end to end
      && unlevelled !== null && unlevelled.ok === false
      && unlevelled.reason.includes('level it with Q')
      && levelled !== null && levelled.ok === true
      // 6. the cost is spent, and a short pack is refused by name
      && stoneSpent === 4 && shortReason.startsWith('need ') && placedWhileShort === 0
      // 7. and it all comes back from bytes, over a world that was emptied first
      && before.length >= 4 && emptied === 0 && after.length === before.length
      && worstMoveM < 1e-9,
    log,
  };
})()
