// enemies.js: ENEMIES IN THE WORLD (GP-87 to GP-94), driven end to end.
//
//   npx --prefix web vite build --outDir dist-en
//   npx --prefix web vite preview --outDir dist-en --port 4247 --strictPort
//   node web/tools/smoke/run.mjs --url=http://127.0.0.1:4247/ \
//     --sandbox=1 --combat=1 --evalfile=web/tools/smoke/probes/enemies.js
//
// AND THE SAME FILE AGAIN WITHOUT --combat=1, which must pass with the OPPOSITE
// outcome: nests seeded 0, waves 0, creatures 0, damage 0. That is GP-93 and it
// is the control that stops "nothing attacked me" from being the same picture as
// "the wave path is broken".
//
// THE CLAIM, in one sentence: an attack is CAUSED by the player's own
// production, walks to the thing that caused it, hurts the player and the base
// when it arrives, and dies to the gun.
//
// THE FOUR NEGATIVE CONTROLS, which are what make the positive numbers mean
// something:
//   1. A BELT ANGERS NOBODY. Three belts are placed alongside the smelters and
//      the derived emitter count does not move, because /core's own §11 table
//      rates a belt at zero. A client that had copied that table into TypeScript
//      would pass every other check here.
//   2. THE FAR NESTS DISPATCH NOTHING. Four nests are seeded; the pollution
//      reaches one of them first and only that one attacks. A wave TIMER would
//      have all four attacking on schedule, and every counter below would look
//      identical.
//   3. THE WAVE IS AIMED AT AN EMITTER THE PLAYER BUILT, measured in metres
//      against that emitter's own direction, not asserted in prose.
//   4. THE SAFE SANDBOX RUN, above.
(async () => {
  const of = window.__of;
  if (!of) return { valid: false, why: 'no __of' };
  if (typeof of.enemies !== 'function') return { valid: false, why: 'no of.enemies' };
  const sleep = (n) => of.run(n);
  // renderHz 60 EXACTLY, and this is load bearing rather than tidy: Loop.frame
  // clamps catch-up at MAX_CATCHUP fixed ticks, so a lower render rate silently
  // DROPS sim ticks and a march measured through it reads about a sixth of the
  // real speed. Measured: 30 s at renderHz 2 moved the swarm 31 m instead of 180.
  const march = (secs) => of.run(secs, 60);
  const log = [];
  const fails = [];
  const check = (name, ok, detail) => {
    if (!ok) fails.push(detail === undefined ? name : `${name}: ${detail}`);
    return ok;
  };
  const E = () => of.enemies();
  const G = () => of.game();

  await sleep(1.0);
  of.audio('unlock');
  await sleep(0.2);

  // =====================================================================
  // 0. WHICH WORLD IS THIS. First, because it changes what every number
  //    below is supposed to be (GP-93).
  // =====================================================================
  const e0 = E();
  const hostile = G().mode.hostile === true;
  check('the mode report agrees with the subsystem',
        e0.hostile === hostile && (e0.enabled === hostile),
        `hostile ${hostile}, enabled ${e0.enabled}, why "${e0.why}"`);
  log.push(`mode ${G().mode.mode} combat=${G().mode.sandboxCombat} `
    + `enabled=${e0.enabled} why="${e0.why}"`);
  if (!hostile) {
    check('a SAFE world seeds no nests', e0.nestsSeeded === 0, `${e0.nestsSeeded}`);
    check('and publishes the sentence it is overriding',
          typeof e0.why === 'string' && e0.why.includes('combat=1'), e0.why);
  } else {
    check('nests were seeded on the ring', e0.nestsSeeded === 4, `${e0.nestsSeeded}`);
    check('the catalogue came across the bridge with every row labelled',
          e0.types.count === 5 && e0.types.unknownTypes === 0,
          JSON.stringify({ n: e0.types.count, unknown: e0.types.unknownTypes }));
    check('and no number in it was authored by the client',
          e0.types.rows[0].name === 'Skitterer' && e0.types.rows[0].health === 15
          && e0.types.rows[0].dps === 7 && e0.types.rows[0].reachM === 1.5,
          JSON.stringify(e0.types.rows[0]));
    // WG-171: `waveLive`, not `live`. A ruin garrison is posted at world build
    // and holds 753 m away, so `live` is 3 on an untouched world and has been
    // since the ruin was placed. "Nothing has attacked yet" was always a claim
    // about the WAVE loop, and the report now publishes that number by name
    // rather than leaving this probe to mean one thing and read another.
    check('nothing has attacked yet',
          e0.wavesDispatched === 0 && e0.swarm.waveLive === 0,
          `${e0.wavesDispatched} waves, ${e0.swarm.waveLive} from waves `
          + `(${e0.swarm.garrisonLive} garrisoned at the ruin)`);
  }

  // =====================================================================
  // 1. THE CAUSE. Six smelters and three belts, placed through the build
  //    path a player uses. The belts are control 1.
  // =====================================================================
  const yaw = of.world().observer.yawDeg;
  const placeSome = async (index, n, from) => {
    for (let i = 0; i < n; i++) {
      of.build(index);
      await sleep(0.08);
      of.look(yaw + (from + i) * 21, -24);
      await sleep(0.18);
      of.input.tape([{ hold: 4, actions: ['use'] }, { hold: 8, keys: [] }]);
      await sleep(0.32);
    }
  };
  await placeSome(3, 10, 0);
  // A full derive window (SYNC_TICKS = 60) before reading, so what is compared
  // is two settled lists rather than one settled and one mid-window.
  await sleep(1.2);
  const afterSmelters = E();
  await placeSome(2, 3, 11);
  await sleep(1.2);
  const afterBelts = E();
  const kinds = {};
  for (const b of (G().factory.list ?? [])) kinds[b.kind] = (kinds[b.kind] ?? 0) + 1;
  log.push(`placed ${JSON.stringify(kinds)}`);
  check('smelters went down', (kinds.smelter ?? 0) >= 5, JSON.stringify(kinds));
  check('belts went down too', (kinds.belt ?? 0) >= 1, JSON.stringify(kinds));

  if (hostile) {
    const em = afterBelts.emitters;
    check('every derived emitter reached /core, none refused',
          em.derived === em.inCore && em.refusals === 0, JSON.stringify(em));
    // WG-171: this apostrophe was UNESCAPED from the day the file was written
    // (fb0723b), so `enemies.js` has never parsed and has therefore never run:
    // `run.mjs` wraps a probe in `((OF_ARGS) => ( ... ))` and this line closed
    // the string early, giving "missing ) after argument list" before a single
    // assertion executed. Found by the ruin-placement lane running it as a
    // regression check. GP-671's class exactly: a probe invisible to the
    // instrument that exists to count probes.
    check('and every rate is /core\'s own table, not a copy',
          em.rows.length > 0 && em.rows.every((r) => r.rate === 2),
          JSON.stringify(em.rows));
    // CONTROL 1.
    check('A BELT ANGERS NOBODY: three belts added ZERO emitters',
          afterBelts.emitters.derived === afterSmelters.emitters.derived,
          `${afterSmelters.emitters.derived} -> ${afterBelts.emitters.derived}`);
    check('and every standing thing is a bite target',
          afterBelts.targets >= (kinds.smelter ?? 0) + (kinds.belt ?? 0),
          `${afterBelts.targets} targets`);
  }

  // =====================================================================
  // 2. THE CHAIN. Advance the CAUSE, in slices, and watch a nest fill.
  //    `advance` moves the pollution clock and nothing else: no creature is
  //    conjured and none of them moves a metre through it.
  // =====================================================================
  const curve = [];
  let dispatched = 0;
  for (let k = 0; k < 30 && dispatched === 0; k++) {
    const r = of.enemies('advance', 60 * 60);
    dispatched = r.wavesDispatched;
    curve.push({
      simS: (k + 1) * 60,
      absorbed: +(r.pollution.absorbedLifetime ?? 0).toFixed(1),
      evo: +(r.evolution.factor ?? 0).toFixed(5),
      readiness: (r.nestRows ?? []).map((n) => n.readiness),
      waves: r.wavesDispatched, live: r.swarm.live,
    });
  }
  log.push(`chain ${JSON.stringify(curve)}`);
  const e2 = E();

  if (!hostile) {
    check('A SAFE WORLD PRODUCES NO POLLUTION LOOP AT ALL',
          e2.wavesDispatched === 0 && e2.swarm.live === 0 && e2.nests === 0,
          JSON.stringify({ waves: e2.wavesDispatched, live: e2.swarm.live,
            nests: e2.nests }));
    await march(20);
    const v = G().vitals;
    check('and NOTHING can hurt the player in it',
          v.totalTaken === 0 && v.hp === v.maxHp,
          JSON.stringify({ hp: v.hp, taken: v.totalTaken }));
    check('nor damage a single building',
          G().health.wounded === 0 && G().health.damageEvents === 0,
          JSON.stringify({ wounded: G().health.wounded }));
    await of.save();
    return { valid: fails.length === 0, hostile, log, fails, curve,
      enemies: e2, saves: G().persist.saves, buildings: G().factory.buildings,
      wounded: 0, damaged: [] };
  }

  check('the base pollution REACHED a nest', e2.pollution.absorbedLifetime > 0,
        `${e2.pollution.absorbedLifetime}`);
  // The three evolution terms sum BIT-EXACTLY to the factor by construction in
  // enemies.h. Asserting the sum rather than the value is what makes the HUD's
  // breakdown a decomposition instead of an estimate.
  const ev = e2.evolution;
  check('evolution decomposes EXACTLY into its three terms',
        ev.fromTime + ev.fromPollution + ev.fromKills === ev.factor,
        `${ev.fromTime} + ${ev.fromPollution} + ${ev.fromKills} != ${ev.factor}`);
  check('and pollution is one of the terms that moved it',
        ev.fromPollution > 0, `${ev.fromPollution}`);
  check('EXACTLY ONE WAVE was dispatched', e2.wavesDispatched === 1,
        `${e2.wavesDispatched}`);
  if (!check('a wave was recorded with what it was aimed at', e2.lastWave !== null,
             JSON.stringify({ waves: e2.wavesDispatched, nests: e2.nestRows }))) {
    return { valid: false, hostile, log, fails, curve, enemies: e2 };
  }
  // WG-171: `waveSpawned`, for the same reason line 77 reads `waveLive`. The
  // cumulative `spawned` now carries the ruin garrison too.
  check('and it fielded the roster /core costed',
        e2.swarm.waveSpawned === e2.lastWave.totalCount
        && e2.swarm.spawnsRefused === 0,
        JSON.stringify({ waveSpawned: e2.swarm.waveSpawned,
          garrisonSpawned: e2.swarm.garrisonSpawned, wave: e2.lastWave }));
  // CONTROL 3.
  check('THE WAVE IS AIMED AT AN EMITTER THE PLAYER BUILT',
        e2.lastWave.aimErrM < 1e-6 && e2.lastWave.aimedAtKey.startsWith('f:'),
        JSON.stringify(e2.lastWave));
  // CONTROL 2.
  const attacked = e2.nestRows.filter((n) => n.waves > 0);
  const quiet = e2.nestRows.filter((n) => n.waves === 0);
  check('ONLY THE NEST THE CLOUD REACHED ATTACKED',
        attacked.length === 1 && quiet.length === 3,
        JSON.stringify(e2.nestRows.map((n) => [n.id, n.waves, n.absorbed])));
  check('and the quiet ones are quiet because they absorbed LESS, not because '
        + 'a timer has not fired', quiet.every((n) => n.absorbed < attacked[0].absorbed),
        JSON.stringify(e2.nestRows.map((n) => [n.id, n.absorbed])));

  // =====================================================================
  // 3. THE MARCH. They walk, on their own, towards what fed the nest.
  // =====================================================================
  const d0 = of.enemies('near', 1)[0].distM;
  const t0 = performance.now();
  await march(30);
  const d1 = of.enemies('near', 1)[0].distM;
  const speed = (d0 - d1) / 30;
  log.push(`march ${d0.toFixed(1)} -> ${d1.toFixed(1)} m in 30 s = `
    + `${speed.toFixed(3)} m/s (catalogue ${e2.types.rows[0].speedMps}), `
    + `${Math.round(performance.now() - t0)} ms wall`);
  check('the swarm CLOSED on the base at the catalogue speed',
        speed > e2.types.rows[0].speedMps * 0.8, `${speed.toFixed(3)} m/s`);
  const pool = E().ceilings.pool;
  check('and every body is drawn, with nothing refused',
        pool.instances >= e2.swarm.live && pool.refused === 0,
        JSON.stringify(pool));
  // DW-28. The pool STARTS below one wave's roster on purpose (see
  // ENEMY_POOL_START), so a real fight exercises the doubling rather than
  // leaving it as code nobody has run.
  check('THE POOL GREW to hold the wave rather than dropping the tail',
        pool.grows > 0 && pool.capacity > 32,
        JSON.stringify(pool));

  // Walk the rest of the way in slices, stopping the moment they arrive.
  let arrived = false;
  for (let k = 0; k < 8 && !arrived; k++) {
    await march(20);
    const e = E();
    // CUMULATIVE, not instantaneous. `bitingBuildings` is a snapshot and a
    // creature that has just finished one target and is walking to the next
    // reads zero, so a 20 s sampling interval misses the bite entirely: the
    // first version of this loop reported NO ARRIVAL against 800 points of
    // damage already dealt.
    arrived = e.swarm.attacksOnPlayer > 0 || e.swarm.damageToBuildings > 0;
  }
  const e3 = E();
  log.push(`arrival ${JSON.stringify({ live: e3.swarm.live,
    onPlayer: e3.swarm.bitingPlayer, onBuildings: e3.swarm.bitingBuildings,
    nearest: of.enemies('near', 1)[0] })}`);
  check('THE WAVE ARRIVED', arrived, JSON.stringify(e3.swarm));

  // =====================================================================
  // 4a. IT EATS THE BASE. The wave arrived at the emitter that fed the nest
  //     and stopped to chew what it found there, which is why a wall is
  //     worth building (GP-89).
  // =====================================================================
  await march(6);
  const h1 = G().health;
  check('THE BASE TOOK DAMAGE', h1.wounded > 0 && h1.totalDamage > 0,
        JSON.stringify({ wounded: h1.wounded, total: h1.totalDamage }));
  const wounds = h1.sample;
  check('and the wounded thing is something the player placed',
        wounds.length > 0 && wounds.every((w) => /^[sfmp]:/.test(w.key)),
        JSON.stringify(wounds.slice(0, 4)));
  check('the health book is still complete under attack',
        h1.audit.missing === 0 && h1.audit.stale === 0 && h1.unknownKinds === 0,
        JSON.stringify(h1.audit));
  check('and the swarm is chewing rather than idling next to it',
        e3.swarm.damageToBuildings > 0, JSON.stringify(e3.swarm));

  // =====================================================================
  // 4b. THE GUN KILLS THEM, AIMED rather than sprayed.
  //
  //     The aim is SOLVED rather than swept, and it is worth saying how,
  //     because a spray that hits 2 of 24 proves almost nothing: two calls to
  //     `of.look` at yaw 0 and yaw 90 give the observer's own horizontal basis
  //     and their cross product gives its up, so a target direction turns into
  //     the exact (yaw, pitch) the player would have to hold. The shot then
  //     goes through the identical held-trigger path a human uses.
  // =====================================================================
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0]];
  const unit = (a) => { const l = Math.hypot(...a) || 1; return a.map((v) => v / l); };
  const dirAt = async (y, p) => {
    of.look(y, p);
    await sleep(0.06);
    const a = of.aim();
    return [a.dir[0], a.dir[1], a.dir[2]];
  };
  const A = await dirAt(0, 0);
  const B = await dirAt(90, 0);
  const eye = () => of.aim().origin;
  // The cross product gives the axis yaw turns about, and its SIGN is the
  // observer's handedness rather than something to assume: it comes out
  // pointing at the planet's centre here, and taking it on trust would have
  // aimed every shot into the sky by exactly the pitch it meant to use.
  const raw = unit(cross(A, B));
  const upSign = dot(raw, unit(eye())) > 0 ? 1 : -1;
  const UP = raw.map((v) => v * upSign);
  const aimAt = async (pos) => {
    const o = eye();
    const v = [pos[0] - o[0], pos[1] - o[1], pos[2] - o[2]];
    const h = Math.hypot(dot(v, A), dot(v, B));
    const y = Math.atan2(dot(v, B), dot(v, A)) * 180 / Math.PI;
    const p = Math.atan2(dot(v, UP), h) * 180 / Math.PI;
    of.look(y, p);
    await sleep(0.08);
    return { y, p, distM: Math.hypot(...v) };
  };
  check('the solved frame is the radial once its sign is read off the world',
        dot(UP, unit(eye())) > 0.99, `${dot(UP, unit(eye()))}`);

  const bar = G().hotbar;
  const gunSlot = bar.slots.findIndex((s) => s.label === 'sidearm');
  check('the gun is on the bar', gunSlot >= 0, `${bar.slots.length} slots`);
  of.hotbar(gunSlot + 1);
  await sleep(0.25);
  const g0 = G().gun;
  const k0 = E().swarm;
  const shots = [];
  for (let k = 0; k < 14; k++) {
    const rows = of.enemies('near', 1);
    if (rows.length === 0) break;
    const at = await aimAt(rows[0].pos);
    const b = G().gun;
    of.input.tape([{ hold: 6, actions: ['use'] }, { hold: 4, keys: [] }]);
    await march(0.5);
    const a = G().gun;
    shots.push({ id: rows[0].id, distM: +at.distM.toFixed(2),
      hit: a.shotsHit - b.shotsHit, gnd: a.groundHits - b.groundHits });
  }
  const g1 = G().gun;
  const k1 = E().swarm;
  log.push(`gun ${g0.shotsFired}->${g1.shotsFired} fired, `
    + `${g0.shotsHit}->${g1.shotsHit} hit, killed ${k0.killed}->${k1.killed}, `
    + `live ${k0.live}->${k1.live}`);
  log.push(`aimed shots ${JSON.stringify(shots)}`);
  check('the trigger fired', g1.shotsFired > g0.shotsFired,
        `${g0.shotsFired} -> ${g1.shotsFired}`);
  check('THE GUN HIT WHAT IT WAS AIMED AT, every time',
        shots.length > 6 && shots.every((r) => r.hit === 1),
        JSON.stringify(shots));
  check('AND KILLED THEM: 22 damage against 15 hp is one round, one Skitterer',
        k1.killed - k0.killed === shots.filter((r) => r.hit === 1).length,
        `${k0.killed} -> ${k1.killed} over ${shots.length} aimed rounds`);
  check('a killed creature stops being shootable',
        E().shootables === k1.live + E().nests,
        `${E().shootables} shootable, ${k1.live} live + ${E().nests} nests`);
  check('and its instance slot went back to the pool',
        E().ceilings.pool.instances === k1.live + E().nests,
        JSON.stringify({ pool: E().ceilings.pool.instances, live: k1.live,
          nests: E().nests }));

  // =====================================================================
  // 5. THE NEST. The only thing whose death moves the difficulty curve
  //    (GP-92), and the only place `of_en_damage_nest` is called.
  // =====================================================================
  const nest = of.enemies('nests').find((n) => n.health > 0);
  const kills0 = E().evolution.fromKills;
  check('evolution has taken NOTHING from kills yet', kills0 === 0, `${kills0}`);
  of.teleport(nest.latDeg, nest.lonDeg, 0);
  await sleep(0.6);
  for (let k = 0; k < 12 && of.enemies('nests').some((n) => n.id === nest.id
    && n.health > 0); k++) {
    of.look(yaw + k * 30, -4);
    await sleep(0.1);
    of.input.tape([{ hold: 60, actions: ['use'] }, { hold: 4, keys: [] }]);
    await sleep(1.2);
  }
  // A full pollution window before reading, because `enemies.h` credits a kill
  // on its own slow tick rather than inside `damageNest`. Reading the factor in
  // the same instant the nest died would report zero and be perfectly correct
  // about a number that had not been computed yet.
  await march(1.5);
  const e4 = E();
  const dead = of.enemies('nests').find((n) => n.id === nest.id);
  log.push(`nest ${nest.id}: ${nest.health} hp -> ${dead ? dead.health : 'gone'}, `
    + `${e4.shotsIntoNests} rounds in, killed ${e4.nestsKilled}`);
  check('rounds reached the nest', e4.shotsIntoNests > 0, `${e4.shotsIntoNests}`);
  check('THE NEST DIED', e4.nestsKilled === 1, `${e4.nestsKilled}`);
  check('and /core counted the kill', e4.evolution.nestsDestroyed === 1,
        `${e4.evolution.nestsDestroyed}`);
  check('KILLING A NEST MOVED EVOLUTION, killing creatures did not',
        e4.evolution.fromKills > 0, `${e4.evolution.fromKills}`);
  check('the three terms still sum exactly after the kill',
        e4.evolution.fromTime + e4.evolution.fromPollution
        + e4.evolution.fromKills === e4.evolution.factor,
        JSON.stringify(e4.evolution));

  // =====================================================================
  // 6. IT HURTS YOU. The player walks INTO what is left of the swarm,
  //    which is the other half of the arrival and the reason player health
  //    exists (GP-79). Teleport rather than a three minute walk; the
  //    creature is where it walked to on its own.
  // =====================================================================
  const meet = of.enemies('near', 1)[0];
  of.teleport(meet.latDeg, meet.lonDeg, 0);
  await march(4);
  const v1 = G().vitals;
  const e3b = E();
  log.push(`contact ${JSON.stringify({ inReach: e3b.swarm.hurtSources,
    worstDps: e3b.swarm.worstDps, onPlayer: e3b.swarm.bitingPlayer,
    hp: v1.hp, taken: v1.totalTaken, cause: v1.lastCause,
    deaths: v1.deaths, respawns: v1.respawns })}`);
  check('creatures came into REACH of the player',
        e3b.swarm.attacksOnPlayer > 0, JSON.stringify(e3b.swarm));
  check('THE PLAYER TOOK DAMAGE FROM A CREATURE', v1.totalTaken > 0,
        JSON.stringify({ hp: v1.hp, taken: v1.totalTaken, cause: v1.lastCause }));
  check('and the cause is a catalogue name, not a made-up string',
        e2.types.rows.some((r) => r.name === v1.lastCause), v1.lastCause);

  // =====================================================================
  // 7. DW-28. BOTH CEILINGS, read together, and neither is binding.
  // =====================================================================
  const c = e4.ceilings;
  log.push(`ceilings ${JSON.stringify(c)}`);
  check('the instance pool refused NOTHING', c.pool.refused === 0,
        JSON.stringify(c.pool));
  check('/core capped no wave', c.wavesTruncated === 0, `${c.wavesTruncated}`);
  check('no nest placement was refused', c.nestsRefused === 0, `${c.nestsRefused}`);
  check('and the tuning arrived intact', c.tuningClamped === false);

  // =====================================================================
  // 8. WRITE THE SLOT, so the reload runner can ask whether the wounds
  //    survived a real page load.
  // =====================================================================
  await of.save();
  const hEnd = G().health;
  return {
    valid: fails.length === 0, hostile, log, fails, curve,
    saves: G().persist.saves,
    // `buildings` is reload.mjs's own generic assertion (nothing the player
    // built may vanish across a reload), and it is published here rather than
    // left undefined because an absent field reads as a regression to it.
    buildings: G().factory.buildings,
    wounded: hEnd.wounded,
    damaged: hEnd.sample.map((w) => ({ key: w.key, hp: w.hp, maxHp: w.maxHp })),
    enemies: e4, vitals: G().vitals, gun: G().gun,
  };
})()
