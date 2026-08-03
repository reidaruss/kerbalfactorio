// CE-19 / CE-20: the world can be taken apart while the loop is running, and
// put back, and NOTHING SURVIVES that should not.
//
// This is a LEAK probe, and a leak is the hardest thing on this project to
// assert honestly, because its symptom is a hitch or a phantom hours later
// rather than a red gate now. So every claim here is a two-sided one against a
// quantity that can only move for one reason:
//
//   subscribers   equal before and after. Drop one unsubscribe and a count grows.
//   workerHandles {body:1, streamer:1} on EVERY scope. A re-initialised worker
//                 would report 2, then 3, because handle ids are per instance.
//   handleDelta   empty across a switch. Skip `oldBody.dispose()` and it reads
//                 {body: 1}.
//   drawn ground  a hash of the DRAWN vertices, equal after a round trip out to
//                 Cinder and back. Not "it rendered".
//
// It also asserts its own FIXTURE before it asserts any behaviour (GP-142): a
// reboot that tears down an empty world and rebuilds an empty world would pass
// every count above while proving nothing, so the resident set and the prop
// count are checked to be non-zero FIRST.
//
// OF_ARGS:
//   crossBody: run phases 3 and 4 (Forge -> Cinder -> Forge). Default true.
(async () => {
  const of = window.__of;
  const fails = [];
  const notes = {};
  const check = (name, ok, detail) => {
    if (!ok) fails.push(detail === undefined ? name : `${name}: ${detail}`);
  };
  const args = (typeof OF_ARGS === 'object' && OF_ARGS !== null) ? OF_ARGS : {};
  const crossBody = args.crossBody !== false;

  /**
   * Wait for the stream to CONVERGE and the scatter to stop growing, rather
   * than for a fixed number of frames.
   *
   * DW-20, and it bit this probe on its first run: 60 rAF ticks is 0.15 s in a
   * headless browser, the terrain had refilled to 64 of 309 chunks and the
   * props to 0, and the probe reported that a rebuild had lost the world. It
   * had not. A rebuild is ASYNCHRONOUS (a worker load, then a streaming ring,
   * then a budgeted scatter pass), so a frame count is not a wait, it is a
   * different measurement.
   */
  const settle = async () => {
    let spin = 0;
    let last = -1;
    let stable = 0;
    while (spin++ < 240) {
      await of.run(0.25);
      const p = propsPlaced();
      stable = (p === last) ? stable + 1 : 0;
      last = p;
      // Convergence AND a scatter that has stopped moving for two polls. NOT
      // `props > 0`: Cinder legitimately has none in view, and a wait condition
      // that cannot be satisfied on one body is a timeout wearing a green coat.
      if (of.world().chunks.converged && stable >= 2) return;
    }
    notes.settleTimedOut = (notes.settleTimedOut ?? 0) + 1;
  };

  // The DRAWN ground, hashed. `meshVerts` reads the vertex buffers the terrain
  // batches are actually bound to, so this cannot be satisfied by a stream that
  // reports healthy numbers while drawing nothing (DW-28's class).
  const groundHash = () => {
    const w = of.world();
    // `world().player.feet` is body-frame metres and is the one position a probe
    // cannot derive (`observer` is published as lat/lon/alt, not as a vector).
    const f = mustHave(w, 'player', 'world').feet;
    // 30 m, NOT 120 m, and the radius is part of the instrument. `meshVertsNear`
    // caps at 6000 rows and walks the resident map in CHUNK ARRIVAL order, so at
    // 120 m it returned exactly 6000 and both the SET of vertices and their
    // order depended on which chunks the worker happened to finish first. Two
    // rebuilds of a provably identical world hashed differently for that reason
    // alone, which reads exactly like the defect this check exists to find.
    // `capped` below is the guard, asserted as a fixture: a truncated sample has
    // measured a different question.
    const rows = of.meshVerts(f[0], f[1], f[2], 30);
    // SORTED, so the claim is "the same ground is drawn" and not "the chunks
    // arrived in the same order". Arrival order is not a property the terrain
    // promises, and a check that fails for a reason nobody cares about is a
    // check that gets ignored. Quantised to 1 mm: the claim is the same ground,
    // not that two float64 pipelines agree to the last bit of an f32 buffer.
    const keys = rows.map((r) => `${Math.round(mustNum(r, 'hM', 'meshVert') * 1000)}:`
      + `${Math.round(mustNum(r, 'dM', 'meshVert') * 1000)}:${mustNum(r, 'depth', 'meshVert')}`);
    keys.sort();
    let h = 2166136261 >>> 0;
    for (const k of keys) {
      for (let i = 0; i < k.length; ++i) h = Math.imul(h ^ k.charCodeAt(i), 16777619) >>> 0;
    }
    return { hash: h >>> 0, verts: keys.length, capped: rows.length >= 6000 };
  };

  const propsPlaced = () => mustNum(of.stats().props, 'propsPlaced', 'stats.props');
  /**
   * LIVE PROP SLOTS held across the whole `PropLibrary`, which is the ONLY
   * number that can see this particular leak, and finding that out cost a
   * negative control that refused to go red.
   *
   * `propsPlaced` is the SCATTER's own counter. A rebuilt scatter starts at zero
   * and counts up to the same 10,170, so with the release step deliberately
   * removed it read 10,170 before and 10,170 after and the control passed while
   * 10,170 slots sat orphaned in batches that outlive the body scope. The
   * library's `instances` is decremented by `release`, so it is the quantity the
   * defect actually moves. INSTRUMENTS.md, first entry: name the failure mode,
   * then pick an instrument that can distinguish it.
   */
  const propSlots = () => mustNum(of.stats().props, 'instances', 'stats.props');
  const sameCounts = (a, b) => Object.keys(a).every((k) => a[k] === b[k])
    && Object.keys(b).every((k) => a[k] === b[k]);

  // -------------------------------------------------------------- PHASE 1
  // The fixture. Everything below is meaningless if the world is empty.
  //
  // THE OBSERVER IS PINNED, and it took a failing round trip to learn why. A
  // reboot does not relocate the player, which is correct (where a body switch
  // should put somebody is a gameplay decision, not this seam's), but it means
  // that on Cinder the walker is left at Forge's body-frame position, i.e. 400
  // km above a 200 km moon, with no near terrain under it, and it FALLS. Coming
  // back to Forge it is somewhere else, so a hash taken at its feet compares two
  // different patches of ground and reports a world that changed. The world had
  // not changed. `home` is re-imposed before every measurement so the query is
  // the same query, which is the only way the round-trip claim means anything.
  await settle();
  const home = (() => { const o = of.world().observer; return [o.latDeg, o.lonDeg, o.altM]; })();
  const atHome = async () => { of.teleport(home[0], home[1], home[2]); await settle(); };
  const l0 = of.life();
  const before = groundHash();
  notes.phase1 = {
    epoch: mustNum(l0, 'epoch', 'life'),
    bodyName: mustHave(l0, 'bodyName', 'life'),
    resident: mustNum(l0.terrain, 'resident', 'life.terrain'),
    scope: l0.scope,
    subscribers: l0.events.subscribers,
    emits: l0.events.emits,
    handles: l0.handles.byKind,
    workerHandles: l0.terrain.workerHandles,
    props: propsPlaced(),
    slots: propSlots(),
    ground: before,
  };

  check('FIXTURE: the world has terrain in it',
    notes.phase1.resident > 0, `resident ${notes.phase1.resident}`);
  check('FIXTURE: the world has props in it',
    notes.phase1.props > 0, `propsPlaced ${notes.phase1.props}`);
  check('FIXTURE: the ground hash was taken over real vertices',
    before.verts > 0, `verts ${before.verts}`);
  check('FIXTURE: the ground sample was NOT truncated by the 6000-row cap',
    before.capped === false, `verts ${before.verts}`);
  check('FIXTURE: something is subscribed to OriginRebased',
    mustNum(l0.events.subscribers, 'OriginRebased', 'subscribers') >= 2,
    `OriginRebased ${l0.events.subscribers.OriginRebased}`);
  check('FIXTURE: the body scope registered teardown steps',
    Array.isArray(l0.scope) && l0.scope.length >= 2, JSON.stringify(l0.scope));
  check('the terrain worker minted exactly one body and one streamer',
    l0.terrain.workerHandles.body === 1 && l0.terrain.workerHandles.streamer === 1,
    JSON.stringify(l0.terrain.workerHandles));

  // -------------------------------------------------------------- PHASE 2
  // SAME-BODY reboot. The negative control for the whole mechanism: the world
  // after must be the world before, so any difference is something teardown
  // lost or rebuild invented.
  const r1 = await of.reboot();
  await atHome();
  const l1 = of.life();
  const after1 = groundHash();
  notes.phase2 = {
    epoch: r1.epoch, teardownMs: +r1.teardownMs.toFixed(2), rebuildMs: +r1.rebuildMs.toFixed(2),
    ran: r1.teardown.ran, failed: r1.teardown.failed,
    handleDelta: r1.handleDelta,
    subscribersBefore: r1.subscribersBefore, subscribersAfter: r1.subscribersAfter,
    resident: l1.terrain.resident, props: propsPlaced(), slots: propSlots(),
    workerHandles: l1.terrain.workerHandles,
    ground: after1,
  };

  check('same-body reboot: every teardown step ran without throwing',
    r1.teardown.failed.length === 0, JSON.stringify(r1.teardown.failed));
  check('same-body reboot: teardown ran every registered step',
    r1.teardown.ran.length === notes.phase1.scope.length,
    `${r1.teardown.ran.length} of ${notes.phase1.scope.length}`);
  check('same-body reboot: the epoch advanced', r1.epoch === 1, `epoch ${r1.epoch}`);
  check('NO SUBSCRIBER LEAKED: every key back to its own count',
    sameCounts(r1.subscribersBefore, r1.subscribersAfter),
    `${JSON.stringify(r1.subscribersBefore)} -> ${JSON.stringify(r1.subscribersAfter)}`);
  check('NO MAIN-THREAD HANDLE LEAKED across the reboot',
    Object.keys(r1.handleDelta).length === 0, JSON.stringify(r1.handleDelta));
  check('THE WORKER HEAP IS NEW, not re-initialised',
    l1.terrain.workerHandles.body === 1 && l1.terrain.workerHandles.streamer === 1,
    JSON.stringify(l1.terrain.workerHandles));
  check('the terrain came back', l1.terrain.resident > 0, `resident ${l1.terrain.resident}`);
  check('the props came back', propsPlaced() > 0, `propsPlaced ${propsPlaced()}`);
  check('NO PROP SLOT LEAKED: the shared batches hold the same live count',
    propSlots() === notes.phase1.slots, `${notes.phase1.slots} -> ${propSlots()}`);
  check('SAME BODY, SAME GROUND: the drawn vertices hash identically',
    after1.hash === before.hash && after1.verts === before.verts,
    `${before.verts}v/${before.hash} -> ${after1.verts}v/${after1.hash}`);

  // -------------------------------------------------------------- PHASE 3/4
  if (crossBody) {
    const r2 = await of.reboot(1);
    await settle();
    const l2 = of.life();
    const staleOnCinder = l2.stale.filter((h) => h.stale);
    notes.phase3 = {
      bodyName: l2.bodyName, bodyId: l2.bodyId,
      radiusM: mustNum(of.world(), 'bodyRadiusM', 'world'),
      handleDelta: r2.handleDelta,
      subscribersAfter: r2.subscribersAfter,
      resident: l2.terrain.resident,
      workerHandles: l2.terrain.workerHandles,
      failed: r2.teardown.failed,
      stale: staleOnCinder.map((h) => `${h.holder}.${h.field}=${h.value} (live ${h.live})`),
      clean: l2.stale.filter((h) => !h.stale).map((h) => `${h.holder}.${h.field}`),
    };

    check('Forge -> Cinder: the body changed',
      l2.bodyId === 1 && l2.bodyName === 'Cinder', `${l2.bodyId} ${l2.bodyName}`);
    check('Forge -> Cinder: the world reports the moon radius',
      Math.abs(notes.phase3.radiusM - 200000) < 1, `${notes.phase3.radiusM} m`);
    check('Forge -> Cinder: no teardown step threw',
      r2.teardown.failed.length === 0, JSON.stringify(r2.teardown.failed));
    check('Forge -> Cinder: NO HANDLE LEAKED (the old body was destroyed)',
      Object.keys(r2.handleDelta).length === 0, JSON.stringify(r2.handleDelta));
    // NOT "equal". Cinder HAS NO POND, so `bootTerrain` registers no
    // `water.reanchor` subscription and the count legitimately falls by one.
    // Asserting equality here was an instrument bug of the kind INSTRUMENTS.md
    // names first: a control that depends on something that moved. A LEAK makes
    // the count GROW; a body with less in it makes it shrink. So the claim is
    // one-sided, and the shrink is separately ACCOUNTED FOR rather than waved
    // through: the missing subscriber must be the missing scope step, and the
    // two-sided version of the claim is the round-trip equality in phase 4.
    check('Forge -> Cinder: no subscriber leaked (a count may fall, never grow)',
      Object.keys(r2.subscribersAfter).every((k) => r2.subscribersAfter[k] <= r2.subscribersBefore[k]),
      `${JSON.stringify(r2.subscribersBefore)} -> ${JSON.stringify(r2.subscribersAfter)}`);
    const dropped = r2.subscribersBefore.OriginRebased - r2.subscribersAfter.OriginRebased;
    check('Forge -> Cinder: the ONE lost subscriber is the pond that is not there',
      dropped === (l2.scope.includes('sub:water.reanchor') ? 0 : 1),
      `dropped ${dropped}, scope ${JSON.stringify(l2.scope)}`);
    check('Forge -> Cinder: a fresh worker heap',
      l2.terrain.workerHandles.body === 1 && l2.terrain.workerHandles.streamer === 1,
      JSON.stringify(l2.terrain.workerHandles));
    check('Forge -> Cinder: Cinder terrain streamed', l2.terrain.resident > 0,
      `resident ${l2.terrain.resident}`);
    // POSITIVE CONTROLS. A census in which everything reads stale is measuring
    // itself. These three are inside the body scope and MUST follow it.
    const cleanSet = new Set(notes.phase3.clean);
    check('RE-SEATED: the oracle follows the body',
      cleanSet.has('oracle.body.radiusM'), notes.phase3.stale.join('; '));
    check('RE-SEATED: the water oracle follows the body',
      cleanSet.has('oracle.water.body.radiusM'), notes.phase3.stale.join('; '));
    check('REBUILT: the scatter follows the body',
      cleanSet.has('scatter.bodyRadiusM'), notes.phase3.stale.join('; '));

    const r3 = await of.reboot(0);
    await atHome();
    const l3 = of.life();
    const after3 = groundHash();
    notes.phase4 = {
      bodyName: l3.bodyName,
      radiusM: mustNum(of.world(), 'bodyRadiusM', 'world'),
      epoch: l3.epoch,
      handleDelta: r3.handleDelta,
      resident: l3.terrain.resident, props: propsPlaced(), slots: propSlots(),
      workerHandles: l3.terrain.workerHandles,
      ground: after3,
    };
    check('Cinder -> Forge: back on the planet',
      l3.bodyId === 0 && Math.abs(notes.phase4.radiusM - 600000) < 1,
      `${l3.bodyName} ${notes.phase4.radiusM} m`);
    check('Cinder -> Forge: no handle leaked',
      Object.keys(r3.handleDelta).length === 0, JSON.stringify(r3.handleDelta));
    // The round trip is where equality IS the right claim: same body, same
    // pond, so every count must be back to the number phase 1 measured. This is
    // the two-sided half the one-sided check above cannot give, and together
    // they cannot both pass on a leak.
    check('ROUND TRIP: every subscriber count is back to its phase-1 value',
      sameCounts(notes.phase1.subscribers, l3.events.subscribers),
      `${JSON.stringify(notes.phase1.subscribers)} -> ${JSON.stringify(l3.events.subscribers)}`);
    check('ROUND TRIP: Forge draws the identical ground it drew before Cinder',
      after3.hash === before.hash && after3.verts === before.verts,
      `${before.verts}v/${before.hash} -> ${after3.verts}v/${after3.hash}`);
    check('ROUND TRIP: no Forge chunk survived into Cinder and back as a duplicate',
      l3.terrain.resident === notes.phase1.resident,
      `resident ${notes.phase1.resident} -> ${l3.terrain.resident}`);
    check('ROUND TRIP: no prop slot leaked across two body switches',
      propSlots() === notes.phase1.slots, `${notes.phase1.slots} -> ${propSlots()}`);
  }

  return { pass: fails.length === 0, fails, notes };
})()
