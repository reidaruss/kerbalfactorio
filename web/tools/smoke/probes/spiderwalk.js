// RN-124: THE SPIDER IS IN THE WORLD AND THE MIXERS DRIVE IT.
//
//   node tools/smoke/run.mjs --sandbox=1 --combat=1 --scenario=walk \
//     --sundot=0.30 --url=http://127.0.0.1:<port>/ \
//     --evalfile=tools/smoke/probes/spiderwalk.js \
//     --evalargs='{"expectAnim":true}' --out=docs/screenshots/RN124_live.png
//   and the SAME command with --anim=0 and expectAnim false. The two runs are
//   driven identically on the sim clock, so the pair of --out frames is a
//   one-binary A/B whose pngdiff concentrates on the creatures: pose is the
//   only difference, because the MARCH is sim and identical in both.
//
// WHAT IS ASSERTED HERE (report level, inside one run):
//   1. The flock loaded and CLAIMED the near creatures, within its cap.
//   2. A marching claimed creature plays Spider_Walk with a timeScale in the
//      band the catalogue speed implies; a biting one plays Spider_Idle.
//   3. THE MIXER TICK ITSELF: an action's time advances across of.run() when
//      animation is live and does NOT advance under ?anim=0. This is the
//      cheapest exact statement of "the mixer is ticking" and it cannot be
//      faked by a static pose.
//   4. The batch and the flock partition the swarm: batch instances plus
//      claimed rigs cover every live creature plus the nests, nothing drawn
//      twice, nothing dropped (the DW-28 ledger still reads refused 0).
//
// NAMED FAILURE MODES (before measuring): rest pose walking across the
// ground is the mixer not ticking (caught by 3); a spider collapsed to a
// point is a bind mismatch (caught by the pngdiff pair being empty where
// creatures stand); sliding feet at plausible pose is a timeScale that
// ignored the instance scale (bounded by 2's band).
(async () => {
  const of = window.__of;
  if (!of) return { valid: false, why: 'no __of' };
  const expect = OF_ARGS && typeof OF_ARGS.expectAnim === 'boolean'
    ? OF_ARGS.expectAnim : true;
  const fails = [];
  const check = (name, ok, detail) => {
    if (!ok) fails.push(detail === undefined ? name : `${name}: ${detail}`);
    return ok;
  };
  const march = (secs) => of.run(secs, 60);
  const E = () => of.enemies();

  await of.run(1.0);
  of.audio('unlock');
  await of.run(0.2);

  const e0 = E();
  if (!check('combat world', e0.enabled === true, e0.why)) {
    return { valid: false, fails, why: e0.why };
  }

  // ---- the cause: six smelters, exactly the enemies.js recipe.
  const yaw0 = of.world().observer.yawDeg;
  for (let i = 0; i < 8; i++) {
    of.build(3);
    await of.run(0.08);
    of.look(yaw0 + i * 21, -24);
    await of.run(0.18);
    of.input.tape([{ hold: 4, actions: ['use'] }, { hold: 8, keys: [] }]);
    await of.run(0.32);
  }
  await of.run(1.2);

  // ---- advance the cause until a wave walks.
  let waves = 0;
  for (let k = 0; k < 30 && waves === 0; k++) {
    waves = of.enemies('advance', 3600).wavesDispatched;
  }
  if (!check('a wave dispatched', waves > 0, `${waves}`)) {
    return { valid: false, fails, enemies: E() };
  }
  await march(2);

  // ---- stand BESIDE the column, not inside it. The first version of this
  // probe teleported onto the nearest creature and was eaten: 50 Skitterers
  // in reach, every claimed rig playing the idle because every one of them
  // was BITING, and the final frame was the underside of a spider standing
  // over the player's corpse. 55 m off is inside CLAIM_M (80) and far
  // outside reach (2.3), so the column keeps MARCHING and the rigs claim
  // its near edge as walkers.
  const OFF_DEG = 55 / ((Math.PI * 600000) / 180);
  const near0 = of.enemies('near', 1)[0];
  of.teleport(near0.latDeg + OFF_DEG, near0.lonDeg, 30);
  await of.run(1.5);
  await of.settle(6);

  const spiders0 = E().spiders;
  check('the flock loaded', spiders0.state === 'ready',
        JSON.stringify({ state: spiders0.state, error: spiders0.error }));
  check('the flag reached the flock', spiders0.animLive === expect,
        `animLive ${spiders0.animLive}, expected ${expect}`);
  check('near creatures are CLAIMED', spiders0.claimed > 0
        && spiders0.claimed <= spiders0.maxRigs, JSON.stringify(spiders0));

  // ---- the partition: batch + rigs cover swarm + nests exactly.
  const e1 = E();
  const nests = e1.nestRows.filter((n) => n.health > 0).length;
  const batch = e1.ceilings.pool.instances;
  check('batch + rigs = creatures + nests, nothing twice, nothing dropped',
        batch + e1.spiders.claimed === e1.swarm.live + nests
        && e1.ceilings.pool.refused === 0,
        JSON.stringify({ batch, claimed: e1.spiders.claimed,
          live: e1.swarm.live, nests }));

  // ---- clip selection while marching.
  const marching = e1.spiders.playing.filter((p) => p.clip === 'Spider_Walk');
  check('a marching claimed creature plays the walk',
        marching.length > 0, JSON.stringify(e1.spiders.playing));
  check('walk timeScale sits in the authored band',
        marching.every((p) => p.timeScale >= 0.4 && p.timeScale <= 2.2),
        JSON.stringify(marching));

  // ---- THE MIXER TICK. Same rig, two reads over real sim time.
  const t0 = Object.fromEntries(e1.spiders.playing.map((p) => [p.creature, p.t]));
  await march(0.3);
  const p1 = E().spiders.playing;
  const advanced = p1.filter((p) => t0[p.creature] !== undefined
    && p.t !== t0[p.creature]);
  const held = p1.filter((p) => t0[p.creature] !== undefined
    && p.t === t0[p.creature]);
  if (expect) {
    check('action time ADVANCES across of.run', advanced.length > 0
          && held.length === 0,
          JSON.stringify({ advanced: advanced.length, held: held.length }));
  } else {
    check('action time is FROZEN under ?anim=0', advanced.length === 0
          && p1.length > 0,
          JSON.stringify({ advanced: advanced.length, rigs: p1.length }));
  }

  // ---- the OTHER clip: step INTO the column's edge until a couple of
  // creatures take the bait, then read the biters. A biting creature is
  // stopped and plays the idle; the antecedent (something is actually
  // biting, GP-156) is asserted in its own right first, sampled every half
  // second because a 15 s sampling interval misses the whole engagement.
  let biteSeen = 0;
  let idleSeen = 0;
  for (let k = 0; k < 30 && (biteSeen === 0 || idleSeen === 0); k++) {
    const n0 = of.enemies('near', 1)[0];
    if (n0 === undefined) break;
    if (k % 6 === 0 && n0.distM > 4) of.teleport(n0.latDeg, n0.lonDeg, 30);
    await march(0.5);
    const e = E();
    biteSeen = Math.max(biteSeen,
      e.swarm.bitingPlayer + e.swarm.bitingBuildings);
    idleSeen = Math.max(idleSeen, e.spiders.playing
      .filter((p) => p.clip === 'Spider_Idle').length);
  }
  check('something engaged and bit', biteSeen > 0, `${biteSeen}`);
  check('a stopped creature plays the idle', idleSeen > 0, `${idleSeen}`);

  // ---- pixel evidence and the report frames. Stand CLOSE to the column
  // (18 m: spiders subtend real screen area), find the heading that moves
  // most over 0.4 s (that is the walkers, by construction of the metric),
  // and measure the column's own motion there. `columnMotion` is the
  // cross-mode number: pose plus translation when live, translation alone
  // when frozen, so live >> frozen at the same offsets without needing the
  // two runs tick-aligned. Two shoot() captures 0.18 s apart (half a walk
  // period at the capped timeScale) are the frame pair for pngdiff.
  const shoot = async () => {
    const blob = await of.screenshot();
    return await new Promise((res) => {
      const r = new FileReader();
      r.onload = () => res(r.result);
      r.readAsDataURL(blob);
    });
  };
  let columnMotion = null;
  let pngNear = null;
  let pngNearB = null;
  let pngFar = null;
  const nearNow = of.enemies('near', 1)[0];
  if (nearNow !== undefined) {
    const CLOSE_DEG = 18 / ((Math.PI * 600000) / 180);
    of.teleport(nearNow.latDeg + CLOSE_DEG, nearNow.lonDeg, 30);
    await of.run(1.0);
    let best = { yaw: 0, moved: -1 };
    for (let a = 0; a < 12; a++) {
      of.look(a * 30, -6);
      await of.run(0.05);
      const h0 = of.framehash(24, 14);
      await of.run(0.4);
      const h1 = of.framehash(24, 14);
      let moved = 0;
      for (let i = 0; i < h0.tiles.length; i++) {
        if (Math.abs(h0.tiles[i] - h1.tiles[i]) > 2.5) moved++;
      }
      if (moved > best.moved) best = { yaw: a * 30, moved };
    }
    of.look(best.yaw, -6);
    await of.run(0.3);
    const g0 = of.framehash(48, 27);
    pngNear = await shoot();
    await of.run(0.18);
    const g1 = of.framehash(48, 27);
    pngNearB = await shoot();
    let strong = 0;
    let max = 0;
    for (let i = 0; i < g0.tiles.length; i++) {
      const dd = Math.abs(g0.tiles[i] - g1.tiles[i]);
      if (dd > 2.5) strong++;
      if (dd > max) max = dd;
    }
    columnMotion = { bestYaw: best.yaw, sweepMoved: best.moved,
      strongHalfStep: strong, maxDelta: +max.toFixed(2) };
    // The over-grass distance read for the report: back off to 60 m.
    of.teleport(nearNow.latDeg + OFF_DEG, nearNow.lonDeg, 30);
    await of.run(0.8);
    of.look(best.yaw, -4);
    await of.run(0.3);
    pngFar = await shoot();
  }
  await of.settle(8);

  const s = of.stats();
  return {
    valid: fails.length === 0,
    expectAnim: expect,
    fails,
    spiders: E().spiders,
    swarm: E().swarm,
    partition: { batch: E().ceilings.pool.instances,
      claimed: E().spiders.claimed, live: E().swarm.live },
    columnMotion,
    pngNear, pngNearB, pngFar,
    invariants: {
      drawCalls: s.draw.calls, triangles: s.draw.triangles,
      geometries: s.draw.geometries, programs: s.draw.programs,
      vramMB: s.vramEstimateMB,
    },
    tick: of.world().tick,
  };
})()
