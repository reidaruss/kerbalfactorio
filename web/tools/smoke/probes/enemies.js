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
  //
  // GP-690. THE SWEEP PLACES UNTIL IT HAS THE COUNT rather than pressing `use`
  // a fixed number of times, and the difference is the first of this file's
  // three reds. It was written on 2026-07-27 against a 2.00 m smelter, where a
  // 21-degree step around a 3.7 m ring cleared the housing. FS-73 took
  // `smelter.glb` and `FOOTPRINT.smelter` to 4.00 m the NEXT DAY (aea0d2c), so
  // ten presses landed THREE machines and seven came back
  // `too close to #1 smelter`. Measured: successes at ring cells (1,2), (5,5)
  // and (9,2), every attempt between them inside the 4-cell box
  // `footprintsOverlap` refuses. THE REFUSAL WAS RIGHT AND THE FIXTURE WAS A
  // DAY STALE, and nobody could see it because the unescaped apostrophe at
  // line 128 meant this file had never parsed.
  //
  // A re-tuned angle would be stale again the next time a mesh changes, so the
  // angle is only a starting point and the LOOP is the contract: press, widen
  // the ring when one is full, and fail loudly if the count never arrives.
  // Belts get their own ring because a 1-cell belt within two cells of a 4 m
  // housing stands half inside it and is refused (FS-65's own arithmetic), so
  // the two kinds cannot share one.
  // =====================================================================
  const yaw = of.world().observer.yawDeg;
  const countOf = (kind) => {
    let n = 0;
    for (const b of (G().factory.list ?? [])) if (b.kind === kind) n++;
    return n;
  };
  /** Every refusal the sweep walked into, with the sentence the game gave for
   *  it. A refusal that arrives with no sentence is the exact failure
   *  `FactoryRefusal.ts` exists to stop, so they are collected rather than
   *  counted: an occupancy rule working and a placement defect must not read
   *  alike. */
  const refused = [];
  const placeUntil = async (index, kind, want, stepDeg, rings, budget) => {
    let tried = 0;
    for (const pitch of rings) {
      for (let a = 0; a < 360 && countOf(kind) < want && tried < budget;
        a += stepDeg) {
        of.build(index);
        await sleep(0.08);
        of.look(yaw + a, pitch);
        await sleep(0.18);
        // The ghost's own verdict, read on the tick the button goes down, so
        // the reason belongs to THIS press rather than to a later frame.
        const ghost = G().build.ghost;
        of.input.tape([{ hold: 4, actions: ['use'] }, { hold: 8, keys: [] }]);
        await sleep(0.32);
        tried++;
        if (ghost !== null && ghost.ok !== true) {
          refused.push({ kind, aDeg: a, pitch, why: ghost.reason });
        }
      }
      if (countOf(kind) >= want) break;
    }
    return tried;
  };
  const smelterPresses = await placeUntil(3, 'smelter', 6, 62,
    [-18, -24, -13, -30], 40);
  // A full derive window (SYNC_TICKS = 60) before reading, so what is compared
  // is two settled lists rather than one settled and one mid-window.
  await sleep(1.2);
  const afterSmelters = E();
  const beltPresses = await placeUntil(2, 'belt', 3, 31,
    [-13, -30, -24, -18], 40);
  await sleep(1.2);
  const afterBelts = E();
  const kinds = {};
  for (const b of (G().factory.list ?? [])) kinds[b.kind] = (kinds[b.kind] ?? 0) + 1;
  log.push(`placed ${JSON.stringify(kinds)} in ${smelterPresses}+${beltPresses} `
    + `presses, ${refused.length} refused: `
    + `${JSON.stringify(refused.map((r) => r.why))}`);
  check('SIX smelters went down', (kinds.smelter ?? 0) === 6,
        `${JSON.stringify(kinds)} after ${smelterPresses} presses`);
  check('and three belts', (kinds.belt ?? 0) === 3,
        `${JSON.stringify(kinds)} after ${beltPresses} presses`);
  check('and every refusal on the way said WHY, in the player\'s own terms',
        refused.every((r) => typeof r.why === 'string' && r.why.length > 0),
        JSON.stringify(refused.slice(0, 6)));

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
  // GP-692. THE POOL DRAWS live + STANDING NESTS - the ones a rig has claimed,
  // and every term is needed. `enemies.nests` counts every nest /core holds
  // including dead ones and only a standing one is drawn, and RN-123 (c96af0a,
  // two days after this file was written) PROMOTES the nearest MAX_RIGS
  // creatures into skinned rigs which release their batch slot on the frame
  // they are claimed. Measured at the end of a fight: instances 36, live 40,
  // nests 4, claimed 8. The pool was never lying and nothing was double
  // counted; the identity simply gained a term and this file did not have it.
  // Asserted as an EQUALITY rather than the old `>=`, because `>=` would have
  // been just as green with the batch leaking a slot per corpse, which is the
  // DW-28 ceiling this whole section is about.
  const liveNests = () => E().nestRows.filter((n) => n.health > 0).length;
  const drawn = () => E().swarm.live + liveNests() - E().spiders.claimed;
  const pool = E().ceilings.pool;
  check('and every body is drawn, with nothing refused',
        pool.instances === drawn() && pool.refused === 0,
        JSON.stringify({ pool, live: E().swarm.live, nests: liveNests(),
          claimed: E().spiders.claimed }));
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
  // D1 (GP-745 to GP-759) CHANGED WHAT "THE BASE TOOK DAMAGE" CAN LOOK LIKE,
  // and this pair of checks was widened deliberately rather than relaxed.
  //
  // Until D1 a building that reached 0 hp STAYED IN THE BOOK at 0, so
  // `wounded > 0` was a complete test: every hit thing was either partly hurt
  // or a permanent 0-hp row, and both showed up in `wounded`. A destroyed
  // building is now REMOVED from its population and its health row goes with it
  // on the next tick, so a wave that finishes what it bites leaves `wounded` at
  // zero against several hundred points of `totalDamage`. That is the feature
  // working, and this probe measured it on the first run after D1 landed:
  // `{"wounded":0,"total":400}`.
  //
  // The honest claim is therefore "damage landed AND something of the player's
  // shows for it", where "shows for it" is now two states rather than one:
  // still standing and hurt, or gone and leaving a pile. `totalDamage > 0` is
  // NOT enough on its own -- it is the swarm's own bookkeeping, and a hole
  // between the book and the world is exactly what these two lines exist to
  // catch -- so the evidence has to come off the WORLD either way.
  const wreck = of.wreckage();
  check('THE BASE TOOK DAMAGE', h1.totalDamage > 0
        && (h1.wounded > 0 || wreck.piles > 0),
        JSON.stringify({ wounded: h1.wounded, total: h1.totalDamage,
          piles: wreck.piles }));
  const wounds = h1.sample;
  const felled = wreck.list;
  check('and what took it is something the player placed, whether it is still '
        + 'standing (a wounded row) or came down (a pile keyed to what fell)',
        (wounds.length > 0 || felled.length > 0)
        && wounds.every((w) => /^[sfmp]:/.test(w.key))
        && felled.every((p) => /^[sfmp]:/.test(p.wasKey)),
        JSON.stringify({ wounds: wounds.slice(0, 4),
          felled: felled.slice(0, 4).map((p) => p.wasKey) }));
  check('nothing at 0 hp was left standing, and no refund went missing felling '
        + 'it (D1: both counters must be zero)',
        wreck.unresolved === 0 && wreck.unrecovered === 0, JSON.stringify(wreck));
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
    // THE WHOLE LIVE LIST, before and after, and not just the body this loop
    // aimed at. See GP-691 below: the two are not always the same body, and a
    // probe that only watches its own target cannot tell a round that killed
    // something else from a round that killed nothing.
    const all0 = of.enemies('near', 4000);
    if (all0.length === 0) break;
    const was = new Map(all0.map((c) => [c.id, c]));
    const at = await aimAt(all0[0].pos);
    const b = G().gun;
    of.input.tape([{ hold: 6, actions: ['use'] }, { hold: 4, keys: [] }]);
    await march(0.5);
    const a = G().gun;
    const all1 = of.enemies('near', 4000);
    const still = new Set(all1.map((c) => c.id));
    const hurt = all1.filter((c) => was.has(c.id) && was.get(c.id).hp !== c.hp)
      .map((c) => ({ id: c.id, name: c.name, prov: c.provenance,
        lost: +(was.get(c.id).hp - c.hp).toFixed(2), left: c.hp }));
    const gone = all0.filter((c) => !still.has(c.id))
      .map((c) => ({ id: c.id, name: c.name, prov: c.provenance, had: c.hp }));
    shots.push({ aimed: all0[0].id, aimedName: all0[0].name,
      distM: +at.distM.toFixed(2), fired: a.shotsFired - b.shotsFired,
      hit: a.shotsHit - b.shotsHit, gnd: a.groundHits - b.groundHits,
      dmg: +(a.damageDealt - b.damageDealt).toFixed(2), hurt, gone });
  }
  const g1 = G().gun;
  const k1 = E().swarm;
  const fatal = shots.filter((r) => r.gone.length === 1);
  log.push(`gun ${g0.shotsFired}->${g1.shotsFired} fired, `
    + `${g0.shotsHit}->${g1.shotsHit} hit, killed ${k0.killed}->${k1.killed}, `
    + `live ${k0.live}->${k1.live}, ${fatal.length}/${shots.length} rounds fatal`);
  log.push(`aimed shots ${JSON.stringify(shots)}`);
  check('the trigger fired', g1.shotsFired > g0.shotsFired,
        `${g0.shotsFired} -> ${g1.shotsFired}`);
  check('EVERY ROUND LANDED IN A BODY, none in the dirt',
        shots.length > 6
        && shots.every((r) => r.fired === 1 && r.hit === 1 && r.gnd === 0),
        JSON.stringify(shots.map((r) => [r.fired, r.hit, r.gnd])));
  // GP-691, the second red, and it was never "0 kills": the detail string read
  // `0 -> 11 over 14 aimed rounds` and the 0 in it is `k0.killed`, the counter
  // BEFORE the volley. Fourteen rounds landed, eleven bodies died, and the
  // three that did not are one body: `Weapon.fire` takes the NEAREST sphere the
  // ray enters, not the creature this loop picked, and a 75 hp Ravager standing
  // 0.25 m off the line at 4.12 m is 0.02 m nearer than the 15 hp Skitterer at
  // 4.14 m that was aimed at. Traced: rounds 5, 6 and 7 all went into it,
  // 75 -> 53 -> 31 -> 9, and round 8 finished it. So "one round, one Skitterer"
  // was an assumption about the ROSTER, and the roster stopped being uniform.
  //
  // What replaces it is stronger, not weaker: the old line could not tell an
  // overkilled Skitterer from a wounded Ravager because it never looked at a
  // body. These three look at every body on every round.
  check('and each round put its 22 points into EXACTLY ONE body',
        shots.every((r) => r.dmg === 22 && r.hurt.length + r.gone.length === 1),
        JSON.stringify(shots.filter((r) => r.dmg !== 22
          || r.hurt.length + r.gone.length !== 1)));
  check('a body that SURVIVED a round lost exactly that round and no more',
        shots.filter((r) => r.hurt.length === 1)
          .every((r) => r.hurt[0].lost === 22),
        JSON.stringify(shots.filter((r) => r.hurt.length === 1)
          .map((r) => r.hurt[0])));
  check('AND THE KILLS ARE THE ROUNDS THAT EMPTIED A BODY, no more, no less',
        k1.killed - k0.killed === fatal.length,
        `${k0.killed} -> ${k1.killed} over ${shots.length} rounds, `
        + `${fatal.length} of them fatal`);
  check('and nothing died with hp left over',
        fatal.every((r) => r.gone[0].had <= 22),
        JSON.stringify(fatal.filter((r) => r.gone[0].had > 22).map((r) => r.gone[0])));
  check('a killed creature stops being shootable',
        E().shootables === k1.live + liveNests(),
        `${E().shootables} shootable, ${k1.live} live + ${liveNests()} nests`);
  check('and its instance slot went back to the pool',
        E().ceilings.pool.instances === drawn(),
        JSON.stringify({ pool: E().ceilings.pool.instances, live: k1.live,
          nests: liveNests(), claimed: E().spiders.claimed }));

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
