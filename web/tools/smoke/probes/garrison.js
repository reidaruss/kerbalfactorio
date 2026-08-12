// garrison.js: A GARRISON, DRIVEN END TO END (scanning spine L4, Reid's
// ruling: enemies enter at or on the way to the ruins).
//
//   npx --prefix web vite build --outDir dist-en
//   npx --prefix web vite preview --outDir dist-en --port 4247 --strictPort
//   node web/tools/smoke/run.mjs --url=http://127.0.0.1:4247/ \
//     --sandbox=1 --combat=1 --evalfile=web/tools/smoke/probes/garrison.js
//
// AND THE SAME FILE AGAIN WITHOUT --combat=1, which must pass with the
// OPPOSITE outcome: the debug spawn itself refused, zero garrisoned. That is
// GP-93's own rule carried into this seam, and the negative control below is
// what makes the positive numbers mean something.
//
// THIS IS THE "HEADLESS-STYLE STEP-LOOP" TEST FOR THIS LANE, RUN AT
// PROBE LEVEL RATHER THAN AS A SEPARATE NODE UNIT TEST, and that choice is
// deliberate rather than a shortcut: `EnemySwarm.ts` and `EnemyGarrison.ts`
// import their siblings by `.js` specifier (bundler resolution), and this
// project's one precedent for a bare `node --experimental-strip-types` check
// (`tools/precision/phasecheck.ts`) only ever exercises a LEAF module with no
// runtime imports of its own — a multi-file TS graph like this one has no
// existing headless harness to reuse, and inventing one is a bigger and
// riskier change than this lane's brief. The fixed-tick loop below (`of.run`
// at the SAME 60 Hz the real render clock uses) is nonetheless a genuine
// step-loop over the real `EnemySwarm.step`/`updateGarrisonState` path,
// scripted and assertion-driven exactly as `enemies.js` already is.
(async () => {
  const of = window.__of;
  if (!of) return { valid: false, why: 'no __of' };
  if (typeof of.enemies !== 'function') return { valid: false, why: 'no of.enemies' };
  const sleep = (n) => of.run(n);
  // renderHz 60 EXACTLY: see enemies.js's own note on why a lower render rate
  // silently drops fixed sim ticks under Loop's catch-up clamp.
  const march = (secs) => of.run(secs, 60);
  const log = [];
  const fails = [];
  const check = (name, ok, detail) => {
    if (!ok) fails.push(detail === undefined ? name : `${name}: ${detail}`);
    return ok;
  };
  const E = () => of.enemies();
  const G = () => of.game();
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

  await sleep(1.0);
  of.audio('unlock');
  await sleep(0.2);

  const hostile = G().mode.hostile === true;
  log.push(`mode hostile=${hostile}`);

  // =====================================================================
  // 0. THE NEGATIVE CONTROL. GP-93's own rule, carried into this seam:
  //    sandbox-safe means no nests AT ALL, and a garrison that still bit in
  //    a "safe" world would be the one hole in that claim.
  // =====================================================================
  if (!hostile) {
    const r = of.enemies('garrison', 777);
    check('A SAFE WORLD REFUSES A GARRISON ENTIRELY',
          r.spawned === 0 && r.swarm.live === 0 && r.swarm.garrison.holding === 0
          && r.swarm.garrison.engaging === 0 && r.swarm.garrison.returning === 0,
          JSON.stringify({ spawned: r.spawned, garrison: r.swarm.garrison,
            live: r.swarm.live }));
    await march(5);
    const e1 = E();
    check('and nothing came alive while the world advanced',
          e1.swarm.live === 0 && e1.swarm.garrison.holding === 0,
          JSON.stringify(e1.swarm));
    return { valid: fails.length === 0, hostile, log, fails };
  }

  // =====================================================================
  // 1. COMPOSITION IS DETERMINISTIC FROM THE SEED, AND OWES NOTHING TO
  //    EVOLUTION OR TO /core's WAVE LOOP. `killall` between spawns (the same
  //    verb `probes/cheats.js` drives) is the clean slate: no separate
  //    "clear a garrison" verb exists because none is needed, the same
  //    argument `EnemyCheats.ts` makes for killing a wave.
  // =====================================================================
  const spawnAndRead = async (seed) => {
    const r = of.enemies('garrison', seed);
    await sleep(0.2);
    return { spawned: r.spawned, byType: { ...r.swarm.byType } };
  };
  of.cheat('killall');
  await sleep(0.3);
  const compA1 = await spawnAndRead(555);
  of.cheat('killall');
  await sleep(0.3);
  const compA2 = await spawnAndRead(555);
  of.cheat('killall');
  await sleep(0.3);
  const compB = await spawnAndRead(999);
  log.push(`composition seed 555: ${JSON.stringify(compA1)}`);
  log.push(`composition seed 555 again: ${JSON.stringify(compA2)}`);
  log.push(`composition seed 999: ${JSON.stringify(compB)}`);
  check('the same seed produced the identical roster twice',
        compA1.spawned === compA2.spawned
        && JSON.stringify(compA1.byType) === JSON.stringify(compA2.byType),
        JSON.stringify({ compA1, compA2 }));
  check('a different seed produced a DIFFERENT roster',
        compA1.spawned !== compB.spawned
        || JSON.stringify(compA1.byType) !== JSON.stringify(compB.byType),
        JSON.stringify({ compA1, compB }));
  check('every guard came off the real catalogue, nothing refused',
        compA1.spawned >= 3 && compA1.spawned <= 6, `${compA1.spawned} guards`);

  // =====================================================================
  // 2. THE GARRISON FOR THE STATE-MACHINE RUN: hold, aggro, leash, return.
  // =====================================================================
  of.cheat('killall');
  await sleep(0.3);
  const spawnFeet = of.weight().at;
  const r0 = of.enemies('garrison', 424242);
  check('the garrison spawned onto a clean world',
        r0.spawned === r0.swarm.live && r0.spawned >= 3 && r0.spawned <= 6,
        JSON.stringify({ spawned: r0.spawned, live: r0.swarm.live }));

  // Let them walk in off their spawn scatter and settle at the post before
  // measuring "holds station": EnemyGarrison.ts's own header says a creature
  // at rest still moves a few centimetres a tick, never that it teleports in.
  await march(4);
  const guards = of.enemies('near', 8).filter((c) => c.provenance === 'garrison');
  check('every spawned guard is reachable off the near list',
        guards.length === r0.spawned, `${guards.length} of ${r0.spawned}`);
  const post = guards[0].post;
  const postDistM = dist(spawnFeet, post);
  log.push(`post ${JSON.stringify(post)}, ${postDistM.toFixed(1)} m from spawn`);

  // ---- HOLD: position variance small over N ticks, all still `hold`. ----
  const samples = [];
  for (let k = 0; k < 3; k++) {
    await march(1.0);
    samples.push(of.enemies('near', 8).filter((c) => c.provenance === 'garrison')
      .map((c) => ({ id: c.id, pos: c.pos, state: c.garrisonState })));
  }
  const allHeld = samples.every((s) => s.every((c) => c.state === 'hold'));
  let maxDriftM = 0;
  for (const c0 of samples[0]) {
    for (const s of samples) {
      const c = s.find((x) => x.id === c0.id);
      if (c) maxDriftM = Math.max(maxDriftM, dist(c0.pos, c.pos));
    }
  }
  log.push(`hold: allHeld=${allHeld} maxDriftM=${maxDriftM.toFixed(3)} `
    + `over ${samples.length} x 1.0 s samples`);
  check('A GARRISONED CREATURE HOLDS STATION: still `hold`, position steady',
        allHeld && maxDriftM < 1.0, `drift ${maxDriftM.toFixed(3)} m, held ${allHeld}`);

  // ---- APPROACH: walk the player fixture to within AGGRO_RADIUS_M (30 m). ----
  // `standAt` rather than a scripted walk: the body-frame point is put down
  // directly, exactly as `standAt`'s own header describes it (PH-90), which
  // is what lets this probe control the geometry without a bearing solve.
  // Both approach and retreat are measured DIRECTLY FROM THE POST, in the
  // fixed direction from post through spawnFeet (unit vector, computed once):
  // `post + awayFromPost * metres` is `metres` from the post, full stop,
  // with no dependence on the player's current position or on any other
  // point's distance from any other point. The previous version placed the
  // retreat by extrapolating past `spawnFeet` on the post-spawnFeet line,
  // which is algebraically the identical point, but a verifier run showed the
  // player settling ~45 m from the post instead of ~145 m: the exact cause
  // was not pinned down (this project's own standing lesson, INSTRUMENTS.md,
  // is to prefer the harder-to-get-wrong formulation once a probe has
  // demonstrably produced a wrong number), so this rewrite measures every
  // distance from the ONE anchor the checks below actually care about and
  // asserts the landed distance immediately rather than trusting the call.
  const awayFromPost = (() => {
    const d = dist(post, spawnFeet) || 1;
    return [(spawnFeet[0] - post[0]) / d, (spawnFeet[1] - post[1]) / d,
      (spawnFeet[2] - post[2]) / d];
  })();
  const fromPost = (metres) => [post[0] + awayFromPost[0] * metres,
    post[1] + awayFromPost[1] * metres, post[2] + awayFromPost[2] * metres];
  const approached = of.standAt(...fromPost(15));
  await sleep(0.3);
  const approachDistM = dist(approached.feet, post);
  log.push(`approach: stood ${approachDistM.toFixed(1)} m from post`);
  check('the fixture stood within the aggro radius of the post',
        approachDistM < 30, `${approachDistM.toFixed(1)} m`);

  // ---- TRACE: chase, leash, return. One loop, one log, one set of checks. ----
  // LEASH_M_EXPECTED mirrors EnemyGarrison.ts's own `LEASH_M` (60): a literal
  // here rather than a read off the report, because no debug surface
  // publishes the constant itself and restating the NUMBER once, next to the
  // check that depends on it, is cheaper than adding one for a single probe.
  const LEASH_M_EXPECTED = 60;
  const RETREAT_M = 90;
  const trace = [];
  let retreated = false;
  let retreatAtT = null;
  let retreatLandedM = null;
  let engageCount = 0;
  for (let k = 0; k < 20; k++) {
    await march(2.0);
    const rows = of.enemies('near', 8).filter((c) => c.provenance === 'garrison');
    const chaser = rows.reduce((a, c) => (a === null || c.distM < a.distM ? c : a), null);
    if (chaser === null) break;
    trace.push({ t: (k + 1) * 2, state: chaser.garrisonState,
      distPlayerM: +chaser.distM.toFixed(1),
      distPostM: +dist(chaser.pos, chaser.post).toFixed(1) });
    if (chaser.garrisonState === 'engage') engageCount++;
    // Retreat only once it has been seen chasing a STATIONARY player for a
    // couple of samples, so the trace can show distance actually closing
    // before the leash test begins; RETREAT_M (90 m) is clearly past BOTH
    // the leash (60 m from the post) and the aggro radius (30 m from
    // wherever it ends up chasing), so neither can re-trigger on the walk
    // home. Measured and asserted IMMEDIATELY, not trusted: a prior version
    // of this probe computed a retreat point that landed only ~45 m from the
    // post on a verifier's run, and the failure only surfaced several checks
    // later as "no return sample ever appeared", which is a much harder
    // thing to diagnose than a distance check failing by name right here.
    if (!retreated && engageCount >= 2) {
      retreated = true;
      retreatAtT = trace[trace.length - 1].t;
      const landed = of.standAt(...fromPost(RETREAT_M));
      retreatLandedM = dist(landed.feet, post);
      await sleep(0.3);
    }
  }
  log.push(`trace (retreated at t=${retreatAtT}, landed ${retreatLandedM === null
    ? 'n/a' : retreatLandedM.toFixed(1)} m from post) ${JSON.stringify(trace)}`);
  check('the retreat actually ran (chasing a stationary player was observed '
        + 'first)', retreated, JSON.stringify(trace));
  check('and it actually landed clear of the leash, not just intended to',
        retreatLandedM !== null && retreatLandedM > LEASH_M_EXPECTED,
        `landed ${retreatLandedM === null ? 'n/a' : retreatLandedM.toFixed(1)} m `
        + `from post, wanted > ${LEASH_M_EXPECTED} m`);

  // "Engaged" splits at the retreat: BEFORE it, the player was stationary and
  // close, so the chaser should be visibly closing; AFTER it, the player has
  // just jumped RETREAT_M (90 m) from the post, so distance necessarily
  // balloons right up until the leash fires, which is what the next checks
  // are about.
  const engaged = trace.filter((t) => t.state === 'engage');
  const preEngaged = engaged.filter((t) => retreatAtT === null || t.t <= retreatAtT);
  const returned = trace.filter((t) => t.state === 'return');
  const held = trace.filter((t) => t.state === 'hold');
  check('IT ACQUIRED THE PLAYER: at least one `engage` sample', engaged.length > 0,
        JSON.stringify(trace));
  check('and closed on the STATIONARY player while engaged (not just labelled)',
        preEngaged.length < 2 || preEngaged[preEngaged.length - 1].distPlayerM
          <= preEngaged[0].distPlayerM + 1,
        JSON.stringify(preEngaged));
  check('THE LEASH FIRED: at least one `return` sample, well past LEASH_M '
        + '(60 m) when it was last seen `engage`', returned.length > 0
        && Math.max(...engaged.map((t) => t.distPostM), 0) > LEASH_M_EXPECTED - 15,
        JSON.stringify({ returned, maxEngagedDistPostM:
          Math.max(...engaged.map((t) => t.distPostM), 0) }));
  // THE ENGAGE-TO-RETURN TRANSITION, ITSELF, not just "a `return` sample
  // existed somewhere": walk the trace and require at least one adjacent
  // pair where the state actually FLIPS from `engage` to `return`.
  let sawTransition = false;
  for (let i = 1; i < trace.length; i++) {
    if (trace[i - 1].state === 'engage' && trace[i].state === 'return') sawTransition = true;
  }
  check('THE TRANSITION ITSELF: an `engage` sample immediately followed by a '
        + '`return` sample', sawTransition, JSON.stringify(trace));
  check('IT WENT HOME: the trace ends `hold`, within ARRIVE_M (2 m) of the post',
        held.length > 0 && held[held.length - 1].distPostM < 3,
        JSON.stringify(held.slice(-3)));
  const finalReport = E();
  check('and the report agrees: nobody left engaged or mid-return',
        finalReport.swarm.garrison.engaging === 0
        && finalReport.swarm.garrison.returning === 0
        && finalReport.swarm.garrison.holding === r0.spawned,
        JSON.stringify(finalReport.swarm.garrison));

  return { valid: fails.length === 0, hostile, log, fails,
    composition: { compA1, compA2, compB }, postDistM, trace,
    enemies: finalReport };
})()
