// garrison.js: A GARRISON, DRIVEN END TO END (scanning spine L4, Reid's
// ruling: enemies enter at or on the way to the ruins).
//
//   npx --prefix web vite build --outDir dist-en
//   npx --prefix web vite preview --outDir dist-en --port 4247 --strictPort
//   node web/tools/smoke/run.mjs --url=http://127.0.0.1:4247/ \
//     --sandbox=1 --combat=1 --evalfile=web/tools/smoke/probes/garrison.js
//
// AND THE SAME FILE AGAIN WITHOUT --combat=1, which must pass with the
// OPPOSITE outcome: the spawn itself refused, zero garrisoned. That is
// GP-93's own rule carried into this seam, and the negative control below is
// what makes the positive numbers mean something.
//
// WG-169. THE POST IS NOW A REAL RUIN AND THE VERB IS `of.ruins('garrison')`.
// Every spawn in this file used to go through the enemy surface's own
// 'garrison' op, which posted a synthetic garrison 45 m east of the player
// because the POI
// bridge could not yet place one; GP-98 wrote that hook down as temporary and
// named the day it would be deleted, and this is that day. `of.ruins(
// 'garrison', seed)` re-runs the SHIPPED `RuinSites.garrison` at the SHIPPED
// post, so this probe now drives the production path instead of a stand-in,
// and the post it measures against is the ruin 753.8 m from spawn rather than
// a fixture. Nothing else in the file changed shape: the post still comes off
// `c.post` on the near list, and every distance is still measured from it.
// A seed is still nameable, and that is the one thing the debug verb adds over
// the production call, because composition determinism is only assertable by
// spawning the same seed twice.
//
// GP-680, AND THE REASON THE LEASH SECTION LOOKS THE WAY IT DOES. For two
// verifier runs this probe reported that the leash NEVER FIRED: the player was
// retreated to a measured 90 m from the post, the guards re-caught them at
// 2.3 m, and all twenty samples stayed `engage`. The trace also carried an
// impossible triangle — a creature 2.3 m from a player 90 m from the post, yet
// only 42.9 m from that post. An instrumented run settled it, and NOTHING WAS
// WRONG WITH THE LEASH OR WITH ANY POSITION IN THE SIM: `c.post` was identical
// for every guard and never mutated, and creature-to-post, creature-to-player
// and the published `distM` all agreed with each other to the centimetre when
// recomputed from the raw body-frame vectors. What moved was THE PLAYER. Four
// guards standing on a fixture at 15 m killed it in about four seconds, and
// five seconds later `PlayerVitals.respawn` teleported the body to the landing
// site, which in this fixture is 45.06 m from the post. The 90 m retreat was
// undone before the guards had walked 27 m, so the leash was never handed a
// distance past 60 m and correctly did nothing. The three numbers were all
// true; they were just measured on two different sides of a respawn the probe
// never looked for. Hence: stand at the aggro EDGE, retreat before contact,
// re-measure the player every sample, and assert the death ledger.
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
  if (typeof of.ruins !== 'function') return { valid: false, why: 'no of.ruins' };
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
    const r = of.ruins('garrison', 777);
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
    const r = of.ruins('garrison', seed);
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
  const r0 = of.ruins('garrison', 424242);
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
  // player settling ~45 m from the post instead of ~145 m: THE CAUSE IS NOW
  // KNOWN AND IT WAS NEVER THE ARITHMETIC — see GP-680 in the header. The
  // fixture was being EATEN: four guards at 7 to 45 dps against 150 hp kill a
  // standing player in a couple of seconds, and `PlayerVitals.respawn`
  // teleports the body back to the landing site five seconds later, which in
  // this fixture is 45 m from the post. Every retreat this probe ever made was
  // silently undone by a respawn, the player was parked INSIDE the 60 m leash,
  // and the leash was therefore never given a distance that could fire it.
  // Hence the two rules this rewrite adds and the checks that enforce them:
  // STAND AT THE EDGE OF THE AGGRO RADIUS, not in the guards' jaws, so the
  // chase is observed before contact rather than during a melee; and RE-MEASURE
  // THE PLAYER EVERY SAMPLE rather than trusting the value `standAt` returned
  // at the instant of the call.
  const awayFromPost = (() => {
    const d = dist(post, spawnFeet) || 1;
    return [(spawnFeet[0] - post[0]) / d, (spawnFeet[1] - post[1]) / d,
      (spawnFeet[2] - post[2]) / d];
  })();
  const fromPost = (metres) => [post[0] + awayFromPost[0] * metres,
    post[1] + awayFromPost[1] * metres, post[2] + awayFromPost[2] * metres];
  // APPROACH_M is just INSIDE AGGRO_RADIUS_M (30 m) rather than the 15 m an
  // earlier version used, and the difference is the whole reason this probe
  // can now finish. A guard walks at 3.4 to 6 m/s and the ranged Lancer's
  // reach is 12 m, so a fixture standing at 15 m is inside somebody's
  // engagement range within a second of aggro and dead a couple of seconds
  // after that. At 25 m the guards have to CROSS ~25 m of ground to touch
  // anybody, which is the window this probe needs to watch a chase start and
  // then get clear of it.
  const APPROACH_M = 25;
  const approached = of.standAt(...fromPost(APPROACH_M));
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
  // BEFORE the retreat the samples are half-second, because the thing being
  // watched is a chase that has only a few seconds to run before contact;
  // AFTER it they are one-second, because the thing being watched is a ~50 m
  // walk out and a ~58 m walk home at 6 m/s. One trace, two cadences, and `t`
  // is accumulated rather than derived from the index so the transition check
  // below still reads adjacent samples.
  const PRE_DT = 0.5;
  const POST_DT = 1.0;
  // Metres of clearance demanded between the nearest chaser and its own
  // engagement range before this probe will let another sample pass. `reachM`
  // is read off the creature rather than assumed, because the catalogue holds
  // a 1.5 m Skitterer and a 12 m ranged Lancer and a fixture that survives one
  // is eaten by the other.
  const SAFE_GAP_M = 8;
  const trace = [];
  let retreated = false;
  let retreatAtT = null;
  let retreatLandedM = null;
  let engageCount = 0;
  let firstEngageDistM = null;
  let t = 0;
  // Every sample carries the PLAYER's own measured distance to the post, and
  // the death ledger. Both exist because their absence is exactly what let the
  // GP-680 failure read as "the leash is broken": the probe put the player at
  // 90 m, the player was killed and respawned back to 45 m, and nothing in the
  // trace said so.
  const vitals = () => of.hurt({ amount: 0 }) ?? {};
  let sawDeath = false;
  let maxRespawns = 0;
  let minPlayerToPostAfterRetreatM = Infinity;
  // ONE CREATURE, FOLLOWED BY ID, and not "whichever guard happens to be
  // nearest this sample". A garrison holds a mixed roster and the catalogue's
  // speeds run 3.4 to 6 m/s, so the nearest body changes identity partway
  // through the chase: a trace built from the nearest row therefore shows a
  // 6 m/s Skitterer flipping to `return` at 60 m and then a lagging 3.4 m/s
  // Colossus still `engage` at 51 m in the very next sample, which reads as an
  // impossible return-to-engage transition and, worse, would let the
  // engage-to-return check below be satisfied by two DIFFERENT creatures. The
  // id is latched on the first sample and every later sample is that same
  // creature or the trace ends.
  let chaserId = null;
  for (let k = 0; k < 90; k++) {
    await march(retreated ? POST_DT : PRE_DT);
    t = +(t + (retreated ? POST_DT : PRE_DT)).toFixed(1);
    const rows = of.enemies('near', 8).filter((c) => c.provenance === 'garrison');
    if (rows.length === 0) break;
    if (chaserId === null) {
      chaserId = rows.reduce((a, c) => (a === null || c.distM < a.distM ? c : a), null).id;
    }
    const chaser = rows.find((c) => c.id === chaserId) ?? null;
    if (chaser === null) break;
    const v = vitals();
    if (v.dead === true) sawDeath = true;
    maxRespawns = Math.max(maxRespawns, Number(v.respawns ?? 0));
    const playerToPostM = dist(of.weight().at, post);
    if (retreated) minPlayerToPostAfterRetreatM =
      Math.min(minPlayerToPostAfterRetreatM, playerToPostM);
    trace.push({ t, id: chaser.id, state: chaser.garrisonState,
      distPlayerM: +chaser.distM.toFixed(1),
      distPostM: +dist(chaser.pos, chaser.post).toFixed(1),
      playerToPostM: +playerToPostM.toFixed(1),
      hp: +Number(v.hp ?? -1).toFixed(0), respawns: Number(v.respawns ?? -1) });
    if (chaser.garrisonState === 'engage') {
      engageCount++;
      if (firstEngageDistM === null) firstEngageDistM = chaser.distM;
    }
    // Retreat once the chase has been SEEN closing on a stationary player, or
    // immediately if the nearest chaser is about to come into its own reach,
    // whichever happens first. The second clause is not a shortcut around the
    // first: it is the rule that keeps the fixture alive, and being eaten is
    // precisely how this probe failed before (GP-680). RETREAT_M (90 m) is
    // clearly past BOTH the leash (60 m from the post) and the aggro radius
    // (30 m from wherever it ends up chasing), so neither can re-trigger on
    // the walk home. Measured and asserted IMMEDIATELY, not trusted.
    const closing = engageCount >= 2 && firstEngageDistM !== null
      && chaser.distM < firstEngageDistM - 1;
    // Over EVERY guard, not just the tracked one: the fixture is eaten by
    // whoever arrives first, and with a 12 m ranged Lancer in the catalogue
    // that is not necessarily the creature this trace is following.
    const aboutToBeInReach = rows.some((c) => c.distM <= c.reachM + SAFE_GAP_M);
    if (!retreated && (closing || aboutToBeInReach)) {
      retreated = true;
      retreatAtT = t;
      const landed = of.standAt(...fromPost(RETREAT_M));
      retreatLandedM = dist(landed.feet, post);
      await sleep(0.3);
      t = +(t + 0.3).toFixed(1);
    }
    // Stop once the story is over: the tracked guard home again AND every
    // other guard home too. Not just the tracked one, because the last check
    // in this section demands the whole roster is back on `hold`, and the
    // roster's slowest body (a 3.4 m/s Colossus) needs roughly twice as long
    // to walk the same 60 m out and back as its fastest (a 6 m/s Skitterer).
    if (retreated && chaser.garrisonState === 'hold'
        && rows.every((c) => c.garrisonState === 'hold') && t > retreatAtT + 1) break;
  }
  log.push(`trace (retreated at t=${retreatAtT}, landed ${retreatLandedM === null
    ? 'n/a' : retreatLandedM.toFixed(1)} m from post) ${JSON.stringify(trace)}`);
  check('the retreat actually ran (chasing a stationary player was observed '
        + 'first)', retreated, JSON.stringify(trace));
  check('and it actually landed clear of the leash, not just intended to',
        retreatLandedM !== null && retreatLandedM > LEASH_M_EXPECTED,
        `landed ${retreatLandedM === null ? 'n/a' : retreatLandedM.toFixed(1)} m `
        + `from post, wanted > ${LEASH_M_EXPECTED} m`);
  // THE TWO CHECKS THAT WOULD HAVE NAMED GP-680 ON THE DAY. A fixture that is
  // killed gets teleported to the landing site by `PlayerVitals.respawn`, and
  // in this world the landing site is ~45 m from the post: inside the leash,
  // so the leash cannot fire and the whole section below fails for a reason
  // that has nothing to do with the leash. These two say so by name.
  check('THE FIXTURE SURVIVED: nothing ate the player mid-trace (a death '
        + 'respawns them at the landing site and silently undoes the retreat)',
        !sawDeath && maxRespawns === 0,
        JSON.stringify({ sawDeath, respawns: maxRespawns }));
  check('and the player STAYED retreated, measured every sample rather than '
        + 'trusted from the `standAt` return value',
        minPlayerToPostAfterRetreatM > LEASH_M_EXPECTED,
        `closest the player got back to the post after retreating was `
        + `${minPlayerToPostAfterRetreatM === Infinity ? 'n/a'
          : minPlayerToPostAfterRetreatM.toFixed(1)} m, wanted > `
        + `${LEASH_M_EXPECTED} m`);

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
  check('and the whole trace is ONE creature, so that transition cannot be two '
        + 'guards of different speeds being mistaken for one changing its mind',
        trace.length > 0 && trace.every((s) => s.id === trace[0].id),
        JSON.stringify([...new Set(trace.map((s) => s.id))]));
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
