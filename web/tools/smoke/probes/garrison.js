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
  // A point on the line through `from`/`to`, `distFromTo` metres from `to`
  // (negative goes past `to`, away from `from`). The chord-vs-arc error at
  // tens of metres on a 600 km sphere is negligible, and `standAt` settles
  // the player onto the real ground at whatever direction this lands on.
  const along = (from, to, distFromTo) => {
    const d = dist(from, to) || 1;
    const t = distFromTo / d;
    return [to[0] + (from[0] - to[0]) * t, to[1] + (from[1] - to[1]) * t,
      to[2] + (from[2] - to[2]) * t];
  };
  const near15 = along(spawnFeet, post, 15);
  const approached = of.standAt(...near15);
  await sleep(0.3);
  log.push(`approach: stood ${dist(approached.feet, post).toFixed(1)} m from post`);
  check('the fixture stood within the aggro radius of the post',
        dist(approached.feet, post) < 30, `${dist(approached.feet, post).toFixed(1)} m`);

  // ---- TRACE: chase, leash, return. One loop, one log, one set of checks. ----
  const trace = [];
  let retreated = false;
  let retreatAtT = null;
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
    // before the leash test begins; far enough past BOTH the leash (60 m
    // from the post) and the aggro radius (30 m from wherever it ends up
    // chasing) that neither can re-trigger on the walk home.
    if (!retreated && engageCount >= 2) {
      retreated = true;
      retreatAtT = trace[trace.length - 1].t;
      of.standAt(...along(post, spawnFeet, -100));
    }
  }
  log.push(`trace (retreated at t=${retreatAtT}) ${JSON.stringify(trace)}`);
  check('the retreat actually ran (chasing a stationary player was observed '
        + 'first)', retreated, JSON.stringify(trace));

  // "Engaged" splits at the retreat: BEFORE it, the player was stationary and
  // close, so the chaser should be visibly closing; AFTER it, the player has
  // just jumped ~145 m away, so distance necessarily balloons right up until
  // the leash fires, which is what the next check is about.
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
        && Math.max(...engaged.map((t) => t.distPostM), 0) > 45,
        JSON.stringify({ returned, maxEngagedDistPostM:
          Math.max(...engaged.map((t) => t.distPostM), 0) }));
  check('IT WENT HOME: the trace ends `hold`, close to the post again',
        held.length > 0 && held[held.length - 1].distPostM < 10,
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
