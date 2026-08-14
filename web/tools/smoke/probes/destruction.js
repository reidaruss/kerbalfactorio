// destruction.js: A BUILDING THAT REACHES ZERO ACTUALLY FALLS DOWN (D1,
// GP-745 to GP-759, docs/scope/SE-MECHANICS-SCOPE-2026-08-13.md section 1).
//
//   npx --prefix web vite build --outDir dist-d1
//   npx --prefix web vite preview --outDir dist-d1 --port 4415 --strictPort
//   node web/tools/smoke/run.mjs --url=http://127.0.0.1:4415/ \
//     --sandbox=1 --combat=1 --evalfile=web/tools/smoke/probes/destruction.js
//
// WHAT WAS WRONG BEFORE THIS LANE, because it is what every check below is
// arranged against. `EnemySwarm.step` incremented `buildingsDestroyed` and
// nothing else happened: the part stayed in its population, its `Solid` stayed
// in the walker's set, its factory row stayed in the plan, its mesh stayed drawn
// and its health row sat at 0 for ever. A "destroyed" wall still blocked the
// player. So the assertions here are all of the form BEFORE-and-AFTER on the
// consumer's own instrument, never "the counter went up".
//
// ---------------------------------------------------------------------------
// WHY THE WORK IS SPLIT BETWEEN THE GUARDS AND `of.damage`, AND WHY THAT IS NOT
// A DODGE.
//
// D1's whole point is that there is exactly ONE door into a building's health
// and therefore exactly one place a building can fall: `Gameplay.damage`. The
// swarm reaches it through `SwarmContext.damageBuilding`; `of.damage` reaches
// the same function directly (DebugGameplay.ts says so at the call site). So:
//
//   * SECTION 5 IS THE GUARDS. A real garrison, posted at the shipped ruin by
//     the shipped `RuinSites.garrison`, chews a real foundation down and it
//     falls. That is the claim "enemies destroy buildings and the buildings go
//     away", end to end, and nothing else in this file can substitute for it.
//   * SECTIONS 2 TO 4 ARE `of.damage`, at spawn, on flat known ground. They
//     measure the things that need a stable fixture and a precise moment: the
//     inverted occupancy, the walk through where the wall stood, the factory
//     row count, and the exact scavenge arithmetic. Driving those off a swarm
//     would mean measuring geometry on terrain the probe did not choose, at a
//     tick nobody controls, while creatures walk through the sample points.
//
// GP-680'S LESSON IS OBEYED THROUGHOUT: a garrison eats a standing fixture in a
// couple of seconds and `PlayerVitals.respawn` then teleports the body back to
// the landing site, silently undoing any retreat. So the player is put well past
// the leash (60 m) before the guards are spawned, is re-measured every sample,
// and the death ledger is asserted.
//
// STANDING RULE 11: nothing here re-derives a number the game already publishes.
// The scavenge fraction is checked against the pile's OWN ledger
// (`salvage + crushed`), not against a `1/3` typed in this file, so a rebalance
// of `SCAVENGE_NUM/DEN` does not silently make this probe agree with itself.
(async () => {
  const of = window.__of;
  if (!of) return { valid: false, why: 'no __of' };
  for (const n of ['damage', 'wreckage', 'demolish', 'ruins', 'standAt',
    'solidBuild', 'enemies']) {
    if (typeof of[n] !== 'function') return { valid: false, why: `no of.${n}` };
  }
  const sleep = (n) => of.run(n);
  // renderHz 60 EXACTLY: enemies.js's own note on why a lower render rate
  // silently drops fixed sim ticks under Loop's catch-up clamp.
  const march = (secs) => of.run(secs, 60);
  const log = [];
  const fails = [];
  const check = (name, ok, detail) => {
    if (!ok) fails.push(detail === undefined ? name : `${name}: ${detail}`);
    return ok;
  };
  const G = () => of.game();
  const W = () => of.wreckage();
  const parts = () => G().structures.parts;
  const fac = () => G().factory;
  const carriedOf = (item) =>
    (G().carried.find((c) => c.item === item) ?? { count: 0 }).count;
  const d3 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  const norm = (v) => { const l = Math.hypot(...v) || 1; return v.map((x) => x / l); };
  const add = (p, d, k) => [p[0] + d[0] * k, p[1] + d[1] * k, p[2] + d[2] * k];
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const upAt = (p) => norm(p);

  await sleep(1.0);
  of.audio('unlock');
  await sleep(0.2);
  if (!of.sandbox().sandbox) return { valid: false, why: 'run with --sandbox=1' };
  const hostile = G().mode.hostile === true;
  log.push(`mode hostile=${hostile}`);

  // =====================================================================
  // THE OCCUPANCY INSTRUMENT: the CE-50 technique, and it is used INVERTED.
  //
  // `of.solidBuild` is `structures.bodies.blocks`, the walker's own predicate,
  // so a point that reads true is a point the player cannot stand in. A ladder
  // of samples up the part's own origin plus a small tangent cross, because a
  // single centre sample on a thin panel is one bad snap away from a false
  // negative in BOTH directions.
  // =====================================================================
  const HEIGHTS_M = [0.2, 0.6, 1.0, 1.4, 1.8];
  const SIDE_M = 0.15;
  const occupancy = (p) => {
    const up = upAt(p);
    const tA = norm(cross(up, Math.abs(up[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]));
    const tB = norm(cross(up, tA));
    const hits = [];
    for (const [a, b] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const base = add(add(p, tA, a * SIDE_M), tB, b * SIDE_M);
      for (const h of HEIGHTS_M) {
        if (of.solidBuild(...add(base, up, h))) hits.push(`${a},${b}@${h}`);
      }
    }
    return hits;
  };

  // =====================================================================
  // 1. A FIXTURE AT SPAWN: two decks and a wall on one of them.
  //    Deck A carries the wall and is the SUBJECT. Deck B is the NEGATIVE
  //    CONTROL and is never touched by anything in this file.
  // =====================================================================
  const yaw0 = of.world().observer.yawDeg;
  const ghost = () => of.build().structGhost;
  const placePress = async () => {
    of.input.tape([{ hold: 4, actions: ['use'] }, { hold: 8, keys: [] }]);
    await sleep(0.35);
  };
  const sweepStruct = async (want, lo = -88, hi = -8, yaws = [0]) => {
    for (const dy of yaws) {
      for (let p = lo; p <= hi; p += 2.5) {
        of.look((yaw0 + dy + 360) % 360, p);
        await sleep(0.06);
        const g = ghost();
        if (g !== null && want(g)) return g;
      }
    }
    return null;
  };
  const AROUND = [0, 30, -30, 60, -60, 90, -90, 150, -150, 180];

  of.build(4);
  await sleep(0.15);
  if (await sweepStruct((g) => g.addr !== null && g.ok, -88, -55) === null) {
    return { valid: false, why: 'no valid cell underfoot for the founding deck',
      ghost: ghost(), log };
  }
  await placePress();
  if (parts().length < 1) {
    return { valid: false, why: 'the founding press placed nothing', log };
  }
  const deckA = parts()[0];
  // A second deck, which will never be attacked. Its whole job is to prove that
  // "the part vanished" is a consequence of the damage rather than of anything
  // this probe did to the world at large.
  const nA = parts().length;
  await sweepStruct((g) => g.ok && g.addr !== null && g.snapped !== null
    && !(g.addr[0] === deckA.addr[0] && g.addr[1] === deckA.addr[1]), -88, -20, AROUND);
  await placePress();
  const control = parts().find((p) => p.id !== deckA.id
    && parts().indexOf(p) >= nA - 1) ?? parts()[parts().length - 1];

  of.build(6);
  await sleep(0.15);
  const wallAim = await sweepStruct((g) => g.ok && g.snapped !== null
    && g.snapped.includes('socket_edge'), -80, -10, AROUND);
  if (wallAim === null) {
    return { valid: false, why: 'a wall caught no deck edge socket',
      ghost: ghost(), parts: parts().length, log };
  }
  await placePress();
  of.build(0);
  await sleep(0.2);
  const wall = parts().find((p) => p.kind === 'wall');
  if (wall === undefined) {
    return { valid: false, why: 'the wall was refused', ghost: ghost(), log };
  }
  const wallKey = `s:${wall.key}`;
  const wallPos = [...wall.pos];
  const controlKey = `s:${control.key}`;
  const controlPos = [...control.pos];
  log.push(`fixture: deck ${deckA.key}, wall ${wall.key} at `
    + `${wallPos.map((v) => v.toFixed(2))}, control deck ${control.key}`);
  check('the control deck is a DIFFERENT part from the wall and from deck A',
        control.id !== wall.id && control.id !== deckA.id,
        JSON.stringify({ control: control.id, wall: wall.id, deckA: deckA.id }));

  // Belts, for the factory-row half. `damagesave.js`'s own placement sweep.
  const placeBuilds = async (menu, count) => {
    of.build(menu);
    let put = 0;
    for (let p = -22; p >= -70 && put < count; p -= 1.1) {
      of.look(of.world().observer.yawDeg, p);
      await sleep(0.05);
      const g = of.build().ghost;
      if (g === null || !g.ok) continue;
      const before = fac().buildings;
      of.input.tape([{ hold: 3, actions: ['use'] }, { hold: 4, keys: [] }]);
      await sleep(0.16);
      if (fac().buildings > before) put++;
    }
    of.build(0);
    await sleep(0.15);
    return put;
  };
  const beltsPut = await placeBuilds(2, 3);
  log.push(`${beltsPut} belt press(es) landed, ${fac().buildings} factory rows`);

  const h0 = G().health;
  check('every placed thing has a health row before anything is broken',
        h0.audit.missing === 0 && h0.audit.stale === 0 && h0.tracked > 0,
        JSON.stringify({ tracked: h0.tracked, audit: h0.audit }));
  const w0 = W();
  check('nothing has fallen yet: no rubble, no unresolved key',
        w0.count === 0 && w0.piles === 0 && w0.unresolved === 0,
        JSON.stringify(w0));

  // =====================================================================
  // 2. THE WALL FALLS. The part, its Solid, its mesh and its health row.
  // =====================================================================
  const occWallBefore = occupancy(wallPos);
  const occCtrlBefore = occupancy(controlPos);
  const far = add(wallPos, upAt(wallPos), 120);
  check('THE INSTRUMENT WORKS AT ALL: the standing wall reads SOLID to the '
        + "walker's own predicate", occWallBefore.length > 0,
        JSON.stringify({ wallPos, hits: occWallBefore }));
  check('and its negative control reads CLEAR 120 m up',
        occupancy(far).length === 0, JSON.stringify(occupancy(far)));

  // WALK INTO IT FIRST, so the "walks through" claim below has a positive
  // control on the same tape rather than resting on an absence.
  const walkAcross = async (label) => {
    const up = upAt(wallPos);
    const outward = norm(sub(wallPos, deckA.pos));
    const flat = norm(add(outward, up, -dot(outward, up)));
    const start = add(add(wallPos, flat, 3.2), up, 0.6);
    of.standAt(...start);
    await march(0.8);
    // Face back across the wall line.
    const from = of.weight().at;
    const want = norm(sub(wallPos, from));
    const wantFlat = norm(add(want, up, -dot(want, up)));
    let bestYaw = of.world().observer.yawDeg;
    let bestDot = -2;
    for (const [span, step] of [[36, 5], [8, 1]]) {
      let by = bestYaw;
      let bd = -2;
      for (let k = -span; k <= span; k++) {
        of.look(bestYaw + k * step, -6);
        await sleep(0.03);
        const a = of.aim();
        const dFlat = norm(add(a.dir, up, -dot(a.dir, up)));
        const s = dot(dFlat, wantFlat);
        if (s > bd) { bd = s; by = bestYaw + k * step; }
      }
      bestYaw = by; bestDot = bd;
    }
    of.look(bestYaw, -6);
    await sleep(0.1);
    const before = of.weight().at;
    of.input.tape([{ hold: 150, keys: ['KeyW'] }, { hold: 2, keys: [] }]);
    let blocked = false;
    for (let i = 0; i < 14; i++) {
      await march(0.2);
      // Sampled DURING the walk: KinematicBody sets it per tick and clears it
      // at the top of the next (ruinplace.js's own finding).
      if (of.world().player.blockedByBuild === true) blocked = true;
    }
    of.input.tape([{ hold: 2, keys: [] }]);
    await march(0.3);
    const after = of.weight().at;
    const sideBefore = dot(sub(before, wallPos), flat);
    const sideAfter = dot(sub(after, wallPos), flat);
    const moved = d3(before, after);
    log.push(`walk ${label}: aimDot ${bestDot.toFixed(3)}, moved `
      + `${moved.toFixed(2)} m, side ${sideBefore.toFixed(2)} -> `
      + `${sideAfter.toFixed(2)} m, blockedByBuild=${blocked}`);
    return { moved, sideBefore, sideAfter, blocked };
  };
  const walkBefore = await walkAcross('WITH the wall standing');
  // `blockedByBuild` IS LOGGED AND NOT ASSERTED, and that is a measurement
  // rather than a softened check. It read FALSE on all fourteen samples of a
  // walk that was demonstrably stopped by the wall (3.09 m travelled, ending
  // 0.125 m short of the panel plane and never crossing it). The flag is set in
  // `KinematicBody` only when `StructureBody.resolveStep` reports `blocked`,
  // i.e. when the resolve gives up; a player pressing square into a flat panel
  // is RESOLVED (pushed back out along the normal) rather than blocked, so the
  // flag is answering a different question from the one this probe is asking.
  // `probes/ruinplace.js` asserts it against RUIN geometry, which is irregular
  // enough to produce a genuine give-up; a shipped wall panel is not. Asserting
  // it here would have been asserting on an instrument whose semantics this lane
  // had not established (NUMBERS.md's own rule). THE DISPLACEMENT IS THE CLAIM,
  // and it is two-sided: with the wall the walker cannot reach the plane, with
  // the wall felled they cross it by metres on the identical tape.
  check('THE POSITIVE CONTROL ON THE WALK: the standing wall stopped the walker '
        + 'short and they never got past its plane',
        walkBefore.sideAfter > 0 && walkBefore.moved < walkBefore.sideBefore + 0.5,
        JSON.stringify(walkBefore));

  const wallMaxHp = h0.catalogue.structures.find((r) => r.kind === 'wall').maxHp;
  const partsBeforeFall = parts().length;
  const trackedBeforeFall = G().health.tracked;
  const killed = of.damage({ key: wallKey, amount: wallMaxHp * 2 });
  check('the killing blow landed and reported `destroyed`',
        killed !== null && killed.destroyed === true, JSON.stringify(killed));
  // One fixed tick, so `HealthCensus.reconcile` runs. The removal itself is
  // synchronous inside `Gameplay.damage`; the health ROW goes on the next tick,
  // deliberately, through the path that already existed (Collapse.ts).
  await march(0.3);

  check('THE PART IS GONE from its population',
        parts().find((p) => p.key === wall.key) === undefined
        && parts().length === partsBeforeFall - 1,
        JSON.stringify({ was: partsBeforeFall, now: parts().length }));
  const occWallAfter = occupancy(wallPos);
  check('THE SOLID IS GONE: the CE-50 occupancy technique INVERTED, same points, '
        + 'same predicate, now clear', occWallAfter.length === 0,
        JSON.stringify({ before: occWallBefore, after: occWallAfter }));
  const hAfter = G().health;
  check('the health row is gone and the book still agrees with the world',
        hAfter.tracked === trackedBeforeFall - 1
        && hAfter.audit.missing === 0 && hAfter.audit.stale === 0,
        JSON.stringify({ was: trackedBeforeFall, now: hAfter.tracked,
          audit: hAfter.audit }));

  const walkAfter = await walkAcross('with the wall FELLED');
  check('THE WALKER PASSES THROUGH WHERE IT STOOD: the identical tape now '
        + 'carries them CLEAN ACROSS the plane the wall occupied',
        walkAfter.sideAfter < -1.0 && walkAfter.moved > walkBefore.moved + 1.0,
        JSON.stringify({ before: walkBefore, after: walkAfter }));

  // =====================================================================
  // 3. THE RUBBLE, AND WHAT SCAVENGING IT PAYS.
  // =====================================================================
  const w1 = W();
  const pile = w1.list.find((r) => r.wasKey === wallKey);
  check('A RUBBLE PROP STANDS AT THE FOOTPRINT, keyed to what fell',
        pile !== undefined, JSON.stringify(w1));
  if (pile === undefined) {
    return { valid: false, why: 'no rubble to scavenge', log, fails, wreckage: w1 };
  }
  check('and it is at the footprint, not near it',
        d3(pile.pos, wallPos) < 0.001,
        JSON.stringify({ pile: pile.pos, wall: wallPos }));
  check('and it is NOT solid: rubble is ankle height and a walker crosses it',
        occupancy(pile.pos).length === 0, JSON.stringify(occupancy(pile.pos)));
  check('and it is not a target: no health row was minted for it',
        G().health.audit.missing === 0 && G().health.audit.stale === 0,
        JSON.stringify(G().health.audit));

  // THE FRACTION, CHECKED AGAINST THE PILE'S OWN LEDGER. `ledger` is what the
  // population's own removal said the thing was worth intact, which is exactly
  // what a DEMOLITION would have paid; `salvage` is what clearing the wreck
  // pays. This probe therefore never types the fraction, it reads it off the
  // report and checks the arithmetic (standing rule 11).
  const num = Number(String(w1.scavengeFraction).split('/')[0]);
  const den = Number(String(w1.scavengeFraction).split('/')[1]);
  const ledgerTotal = pile.ledger.reduce((a, c) => a + c.count, 0);
  const salvageTotal = pile.salvage.reduce((a, c) => a + c.count, 0);
  const crushed = pile.lost.filter((l) => l.what.endsWith(' crushed'));
  log.push(`pile ${pile.id}: ledger ${JSON.stringify(pile.ledger)}, salvage `
    + `${JSON.stringify(pile.salvage)}, lost ${JSON.stringify(pile.lost)}, `
    + `fraction ${w1.scavengeFraction}`);
  check('the pile publishes what the whole ledger was, so the fraction is '
        + 'checkable without this probe retyping it',
        Array.isArray(pile.ledger) && ledgerTotal > 0 && den > 0,
        JSON.stringify({ ledger: pile.ledger, fraction: w1.scavengeFraction }));
  const wantSalvage = pile.ledger.every((c) => {
    const got = pile.salvage.find((s) => s.item === c.item)?.count ?? 0;
    return got === Math.floor((c.count * num) / den);
  });
  check('SCAVENGE IS A FRACTION AND NOT A REFUND: strictly less than the whole '
        + 'ledger, and the crushed remainder is named rather than swallowed',
        salvageTotal < ledgerTotal && crushed.length > 0,
        JSON.stringify({ salvageTotal, ledgerTotal, crushed,
          fraction: w1.scavengeFraction }));
  check(`and it is exactly ${w1.scavengeFraction} of the ledger, rounded down, `
        + "checked per item against the pile's own numbers", wantSalvage,
        JSON.stringify({ ledger: pile.ledger, salvage: pile.salvage }));

  // THE PACK DID NOT MOVE WHEN THE WALL FELL. `Wreckage.ts`'s central claim:
  // the population's own `remove()` credits, and `pileUp` debits exactly what
  // it credited, so a destruction is worth nothing until the rubble is cleared.
  check('THE COLLAPSE PAID NOTHING INTO THE PACK, and nothing went missing '
        + 'doing it', W().unrecovered === 0 && W().unresolved === 0,
        JSON.stringify({ unrecovered: W().unrecovered, unresolved: W().unresolved }));

  // The AIM path: a player can actually reach this pile with the crosshair.
  const up = upAt(pile.pos);
  of.standAt(...add(add(pile.pos, norm(cross(up, [0, 1, 0])), 2.0), up, 0.2));
  await march(0.6);
  let sawAim = null;
  for (let p = 10; p >= -60 && sawAim === null; p -= 3) {
    for (let k = 0; k < 24 && sawAim === null; k++) {
      of.look(of.world().observer.yawDeg + 15, p);
      await sleep(0.05);
      const a = G().aimed.rubble;
      if (a !== null && a.id === pile.id) sawAim = a;
    }
  }
  check('THE CROSSHAIR RESOLVES THE PILE, so the demolish key can reach it at '
        + 'all', sawAim !== null, JSON.stringify({ aimed: G().aimed }));

  const before = {};
  for (const c of pile.salvage) before[c.item] = carriedOf(c.item);
  const cleared = of.demolish({ rubble: pile.id });
  await march(0.2);
  check('clearing the pile returned a ledger and the pile is gone',
        cleared !== null && W().list.find((r) => r.id === pile.id) === undefined
        && W().scavenged === 1,
        JSON.stringify({ cleared, wreckage: W() }));
  let paidExactly = true;
  const paid = [];
  for (const c of pile.salvage) {
    const got = carriedOf(c.item) - before[c.item];
    paid.push({ item: c.item, want: c.count, got });
    if (got !== c.count) paidExactly = false;
  }
  check('AND THE PACK GAINED EXACTLY THE STATED FRACTION, item by item',
        paidExactly && paid.length > 0, JSON.stringify(paid));
  check("the toast names the loss as well as the gain, unsoftened",
        typeof cleared?.message === 'string' && cleared.message.includes('lost'),
        JSON.stringify(cleared));

  // =====================================================================
  // 4. THE FACTORY ROW. A belt is a different owner and a different removal
  //    path (the plan is rebuilt, not spliced), so it is measured separately.
  // =====================================================================
  let beltCheckRan = false;
  const belt = fac().list.find((b) => b.kind === 'belt');
  if (belt !== undefined) {
    beltCheckRan = true;
    const beltKey = `f:${belt.cell}`;
    const nBefore = fac().buildings;
    const listBefore = fac().list.length;
    const beltMax = G().health.catalogue.factory.find((r) => r.kind === 'belt').maxHp;
    const r = of.damage({ key: beltKey, amount: beltMax * 2 });
    await march(0.3);
    check('the belt was finished', r !== null && r.destroyed === true,
          JSON.stringify(r));
    check('THE FACTORY ROW IS GONE AND THE COUNTS AGREE: one fewer building, '
          + 'one fewer row, and no row answers to that cell any more',
          fac().buildings === nBefore - 1 && fac().list.length === listBefore - 1
          && fac().list.find((b) => b.cell === belt.cell) === undefined,
          JSON.stringify({ was: nBefore, now: fac().buildings,
            rowsWas: listBefore, rowsNow: fac().list.length }));
    check('and a pile stands where the belt was',
          W().list.find((p) => p.wasKey === beltKey) !== undefined,
          JSON.stringify(W().list.map((p) => p.wasKey)));
    check('and the book still agrees with the world after a factory rebuild',
          G().health.audit.missing === 0 && G().health.audit.stale === 0,
          JSON.stringify(G().health.audit));
  } else {
    fails.push('no belt was placed, so the factory-row half could not run');
  }

  // =====================================================================
  // 5. THE GUARDS. The whole point: a real garrison chews a real building down
  //    and the building goes away. Nothing in this section is synthetic.
  // =====================================================================
  let guardStory = null;
  if (!hostile) {
    fails.push('run with --combat=1: the guard section is the headline claim');
  } else {
    of.cheat('killall');
    await march(0.4);
    // Find the shipped post by spawning once and reading it off a guard, the
    // way garrison.js does; then clear the world again before building.
    const probe0 = of.ruins('garrison', 424242);
    await march(0.6);
    const scouts = of.enemies('near', 8).filter((c) => c.provenance === 'garrison');
    if (scouts.length === 0) {
      fails.push('of.ruins("garrison") posted nobody, so no guard could bite');
    } else {
      const post = scouts[0].post;
      of.cheat('killall');
      await march(0.4);
      log.push(`post ${post.map((v) => v.toFixed(1))}, `
        + `${probe0.spawned} guards in the trial spawn`);

      // Stand ON the post and put a deck down under the crosshair. A foundation
      // rather than a wall: it needs no socket to catch, so it can go down on
      // ground this probe did not choose. Bite radius 2.0 m (EnemyTargets.ts)
      // plus a Skitterer's 1.5 m reach means a guard holding within 2 m of the
      // post is in range of it.
      const postUp = upAt(post);
      of.standAt(...add(post, postUp, 0.2));
      await march(1.2);
      of.build(4);
      await sleep(0.2);
      let laid = null;
      for (let p = -88; p <= -50 && laid === null; p += 3) {
        of.look(of.world().observer.yawDeg, p);
        await sleep(0.06);
        const g = ghost();
        if (g === null || !g.ok || g.addr === null) continue;
        const n = parts().length;
        await placePress();
        if (parts().length > n) laid = parts()[parts().length - 1];
      }
      if (laid === null) {
        of.build(0);
        fails.push('no deck could be laid at the ruin post');
      } else {
        const victimKey = `s:${laid.key}`;
        const victimPos = [...laid.pos];
        // OCCUPANCY AT A RUIN IS MEASURED AS A DELTA, NOT AN ABSOLUTE, and this
        // probe learned that the hard way. WG-166 puts a ruin's own colliders
        // in `structures.bodies`, the SAME set `of.solidBuild` reads, so at the
        // post there is stone standing where the deck goes: a first run asserted
        // "0 hits after the guards" and got 10, all of them the ruin's own walls
        // at 0.6 m and 1.0 m, at columns where the deck's slab had contributed
        // the 0.2 m hits. NOTHING WAS WRONG WITH THE REMOVAL; the instrument was
        // measuring two owners and attributing both to one.
        //
        // So the baseline is taken at the deck's OWN position with the deck
        // momentarily removed through the ordinary demolish path, and then the
        // deck is put back on the same unmoved crosshair. That costs two presses
        // and buys an exact frame of reference: the deck must strictly ADD to
        // the baseline, and after the guards are done the count must be back to
        // the baseline exactly.
        of.demolish({ part: laid.id });
        await march(0.3);
        const occBase = occupancy(victimPos);
        await placePress();
        await march(0.2);
        of.build(0);
        await sleep(0.2);
        const relaid = parts().find((p) => p.key === laid.key);
        check('the baseline dance put the same deck back at the same address',
              relaid !== undefined, JSON.stringify({ want: laid.key,
                have: parts().map((p) => p.key) }));
        const occVictimBefore = occupancy(victimPos);
        check('the deck at the post is standing and adds to what was already '
              + "solid there (the ruin's own stone is in the same set)",
              relaid !== undefined && occVictimBefore.length > occBase.length,
              JSON.stringify({ key: victimKey, base: occBase,
                withDeck: occVictimBefore }));

        // GP-680: past the leash BEFORE they exist, or the fixture is eaten and
        // a respawn silently undoes the retreat.
        const away = norm(sub(of.weight().at, post));
        const RETREAT_M = 180;
        of.standAt(...add(post, away.every((v) => v === 0) ? postUp : away, RETREAT_M));
        await march(1.0);
        const standoffM = d3(of.weight().at, post);
        check('the player retreated well past the 60 m leash before the spawn',
              standoffM > 100, `${standoffM.toFixed(1)} m from the post`);

        const swarm0 = of.enemies().swarm;
        const spawn = of.ruins('garrison', 424242);
        const pilesBefore = W().piles;
        let fellAtS = null;
        const trace = [];
        let sawDeath = false;
        for (let k = 0; k < 40 && fellAtS === null; k++) {
          await march(1.5);
          const e = of.enemies();
          const v = of.hurt({ amount: 0 }) ?? {};
          if (v.dead === true) sawDeath = true;
          if (k % 4 === 0) {
            trace.push({ t: +(k * 1.5 + 1.5).toFixed(1),
              live: e.swarm.live, biting: e.swarm.bitingBuildings,
              dmg: e.swarm.damageToBuildings,
              destroyed: e.swarm.buildingsDestroyed,
              hp: +Number(v.hp ?? -1).toFixed(0),
              playerToPostM: +d3(of.weight().at, post).toFixed(1) });
          }
          if (parts().find((p) => p.key === laid.key) === undefined) {
            fellAtS = +(k * 1.5 + 1.5).toFixed(1);
          }
        }
        const swarm1 = of.enemies().swarm;
        const occVictimAfter = occupancy(victimPos);
        const victimPile = W().list.find((r) => r.wasKey === victimKey);
        guardStory = { spawned: spawn.spawned, fellAtS, trace,
          damageToBuildings: swarm1.damageToBuildings,
          destroyedWas: swarm0.buildingsDestroyed,
          destroyedNow: swarm1.buildingsDestroyed,
          standoffM: +standoffM.toFixed(1), sawDeath };
        log.push(`guards: ${JSON.stringify(guardStory)}`);

        check('THE GUARDS ACTUALLY BIT IT: the swarm spent damage on buildings '
              + 'and counted a kill',
              swarm1.damageToBuildings > 0
              && swarm1.buildingsDestroyed > swarm0.buildingsDestroyed,
              JSON.stringify({ before: swarm0.buildingsDestroyed,
                after: swarm1.buildingsDestroyed,
                damage: swarm1.damageToBuildings }));
        check('AND THE BUILDING THEY KILLED IS GONE, not standing at 0 hp',
              fellAtS !== null
              && parts().find((p) => p.key === laid.key) === undefined,
              JSON.stringify({ fellAtS, stillThere:
                parts().find((p) => p.key === laid.key) ?? null }));
        check('ITS SOLID WENT WITH IT: the CE-50 occupancy technique inverted at '
              + "the same points, back to the ruin's own baseline exactly",
              occVictimAfter.length === occBase.length
              && occVictimAfter.every((h) => occBase.includes(h)),
              JSON.stringify({ base: occBase, withDeck: occVictimBefore,
                after: occVictimAfter }));
        check('AND IT LEFT RUBBLE AT ITS OWN FOOTPRINT',
              victimPile !== undefined && W().piles === pilesBefore + 1
              && d3(victimPile?.pos ?? [1e9, 0, 0], victimPos) < 0.001,
              JSON.stringify({ pile: victimPile ?? null, at: victimPos,
                piles: W().piles, was: pilesBefore }));
        check('the fixture survived, so nothing above was measured across a '
              + 'respawn (GP-680)', !sawDeath, JSON.stringify({ sawDeath }));
        of.cheat('killall');
        await march(0.4);
      }
    }
  }

  // =====================================================================
  // 6. THE NEGATIVE CONTROL: a healthy building does not fall.
  // =====================================================================
  const ctrlLive = parts().find((p) => p.key === control.key);
  const occCtrlAfter = occupancy(controlPos);
  check('A HEALTHY BUILDING DOES NOT FALL: the untouched control deck is still '
        + 'in its population after everything above',
        ctrlLive !== undefined, JSON.stringify({ key: controlKey,
          parts: parts().map((p) => p.key) }));
  check('its Solid still blocks the walker, at the same points that read solid '
        + 'at the start (the CLOSING CONTROL on the instrument itself)',
        occCtrlBefore.length > 0 && occCtrlAfter.length === occCtrlBefore.length,
        JSON.stringify({ before: occCtrlBefore, after: occCtrlAfter }));
  check('it is at FULL health, so nothing splashed onto it',
        G().health.sample.find((r) => r.key === controlKey) === undefined,
        JSON.stringify(G().health.sample));
  check('and no rubble was ever minted for it',
        W().list.find((r) => r.wasKey === controlKey) === undefined,
        JSON.stringify(W().list.map((r) => r.wasKey)));

  // =====================================================================
  // 7. THE LEDGERS, ALL OF WHICH MUST BE ZERO.
  // =====================================================================
  const wEnd = W();
  const hEnd = G().health;
  check('no 0-hp key went unfelled (`unresolved`)', wEnd.unresolved === 0,
        JSON.stringify(wEnd));
  check('no refund went missing on the take-back (`unrecovered`)',
        wEnd.unrecovered === 0, JSON.stringify(wEnd));
  check('the health book still matches the world exactly',
        hEnd.audit.missing === 0 && hEnd.audit.stale === 0,
        JSON.stringify(hEnd.audit));
  // RN-1624. THIS CHECK IS INVERTED RATHER THAN DELETED, and that is the point
  // of it. It read `=== true` while the prop was a squashed boulder, which was
  // the honest assertion then; the authored `rubble_pile.glb` has landed, so the
  // honest assertion now is `=== false`. Keeping the flag under test is what
  // makes it go red the day somebody borrows a mesh again, which a deleted check
  // could not do.
  check('the rubble mesh is the authored prop and no longer a placeholder',
        wEnd.meshIsPlaceholder === false
        && wEnd.mesh === 'assets/props/rubble_pile.glb',
        JSON.stringify({ mesh: wEnd.mesh, placeholder: wEnd.meshIsPlaceholder }));
  // ...and the pile that fell picked an authored size rather than stretching
  // one. The three spans come out of `report()` so this cannot agree with
  // itself by retyping them (standing rule 11); what is checked is that the
  // residual scale is SMALL, which is the whole reason three sizes exist.
  check('every pile picked an authored size and the residual scale is under 2x',
        Array.isArray(wEnd.sizes) && wEnd.sizes.length === 3
        && wEnd.list.every((r) => wEnd.sizes.some((z) => z.node === r.size)
          && r.sizeScale > 0.5 && r.sizeScale < 2.0),
        JSON.stringify({ sizes: wEnd.sizes,
          picked: wEnd.list.map((r) => [r.kind, r.spanM, r.size, r.sizeScale]) }));

  return { valid: fails.length === 0, hostile, log, fails,
    beltCheckRan, guards: guardStory, wreckage: wEnd, health: hEnd.audit,
    factory: { buildings: fac().buildings }, parts: parts().length };
})()
