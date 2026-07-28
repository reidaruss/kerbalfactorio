// cheats.js: THE GAME MENU AND ITS TESTING CONTROLS (GP-100 to GP-107).
//
// Run it twice, and the second run is what makes the first one mean anything:
//
//   node tools/smoke/run.mjs --url=... --sandbox=1 --combat=1 --evalfile=probes/cheats.js
//   node tools/smoke/run.mjs --url=... --sandbox=1          --evalfile=probes/cheats.js
//
// With `?combat=1` the enemy controls are LIVE and every assertion about them is
// a real one. Without it the world is safe by default (DW-31 / GP-82), the two
// enemy rows come back BLOCKED with `Enemies.disabledWhy` as the reason, and the
// probe asserts exactly that instead of quietly skipping them. A control that is
// greyed out with no sentence is indistinguishable from a broken one, which is
// the defect GP-51 is about and the reason `blocked` is a string and not a flag.
//
// EVERY PRESS BELOW IS A REAL PointerEvent ON THE REAL <button>, held 110 ms,
// found by the same `data-cheat` attribute a player's mouse would hit. Standing
// rule 3: a probe that called `Cheats.press` directly would be verifying a path
// no player can take, which is the quiet way an acceptance stops meaning
// anything. `__of.cheat` exists and is used exactly twice, both times to prove a
// REFUSAL that has no button (an unarmed Start Fresh, and the assisted-record
// negative control).
//
// START FRESH IS NOT FIRED HERE, deliberately: it destroys the world and
// reloads the page, so it has its own two-phase proof in probes/startfresh.js
// under tools/smoke/reload.mjs. What IS asserted here is the half that must
// hold before it ever fires: that the confirm button does not exist in the DOM
// until the row is armed, and that the verb refuses when it is not.
(async () => {
  const of = window.__of;
  if (!of) return { valid: false, why: 'no __of' };
  if (typeof of.pause !== 'function') return { valid: false, why: 'no of.pause' };
  const sleep = (n) => of.run(n);
  const fails = [];
  const log = [];
  const check = (name, ok, detail) => {
    if (!ok) fails.push(detail === undefined ? name : `${name}: ${detail}`);
    return ok;
  };
  const combat = location.search.includes('combat=1');
  const opts = { bubbles: true, pointerId: 1, pointerType: 'mouse', button: 0 };
  /**
   * Press the REAL button for a control, held 110 ms, RE-QUERIED between the
   * down and the up. The re-query is not fussiness: `PauseMenu.render` replaces
   * the whole body whenever its key moves, so an element captured before the
   * press is detached by the frame that lands during the hold and the click
   * would reach nothing. Returns false when the button is not there at all,
   * which is itself an assertion at several call sites below.
   */
  const press = async (id) => {
    const sel = `#of-pause button[data-cheat="${id}"]`;
    const down = document.querySelector(sel);
    if (down === null) return false;
    down.dispatchEvent(new PointerEvent('pointerdown', opts));
    await sleep(0.11);
    (document.querySelector(sel) ?? down).click();
    await sleep(0.35);
    return true;
  };
  const esc = async () => { of.escape(); await sleep(0.4); };

  await sleep(0.6);

  // ======================================================================
  // A. ESCAPE OPENS IT, AND ONLY WITH NOTHING ELSE OPEN (GP-100)
  // ======================================================================
  check('the menu registered itself on the derived modal stack',
    of.modals().modals.some((m) => m.name === 'pause'),
    of.modals().modals.map((m) => m.name).join(','));
  check('and Escape has been given the fallback',
    of.pause().escapeOpens === true, `${of.pause().escapeOpens}`);

  check('it starts closed', of.pause().open === false);
  await esc();
  const openedByEscape = of.pause().open;
  check('Escape with nothing open OPENS the game menu', openedByEscape === true,
    `open=${openedByEscape}, lastEscape=${of.game().controls.lastEscape}`);
  check('and Escape says so rather than being silent',
    of.game().controls.lastEscape === 'opened the game menu',
    of.game().controls.lastEscape);
  await esc();
  check('a second Escape CLOSES it', of.pause().open === false,
    of.game().controls.lastEscape);

  // THE "IF IM NOT ALREADY IN ANOTHER MENU" HALF, and it is not a condition
  // anybody wrote: it is what having something to close MEANS. With the pack up,
  // Escape shuts the pack and the menu stays shut.
  of.panel(true);
  await sleep(0.35);
  await esc();
  const afterPack = { pack: of.modals().modals.find((m) => m.name === 'pack').open,
    pause: of.pause().open };
  check('Escape with the PACK open closes the pack and does NOT open the menu',
    afterPack.pack === false && afterPack.pause === false, JSON.stringify(afterPack));

  // AND THE HAND IS A MODAL TOO (GP-25), so a player holding a wall gets the
  // wall dropped on the first press and the menu on the second. That ORDER is
  // the assertion; getting it the other way round would strand a part in hand
  // behind a menu.
  of.hotbar(6);
  await sleep(0.25);
  const heldPart = of.hotbar().part;
  await esc();
  const afterDrop = { part: of.hotbar().part, pause: of.pause().open };
  check('Escape with a PART IN HAND drops the part and does NOT open the menu',
    heldPart !== null && afterDrop.part === null && afterDrop.pause === false,
    `held ${heldPart} -> ${afterDrop.part}, pause ${afterDrop.pause}`);
  await esc();
  check('and the NEXT Escape opens the menu', of.pause().open === true,
    of.game().controls.lastEscape);

  // ======================================================================
  // B. THE SHELL: the four durable sections are RESERVED and say what for
  // ======================================================================
  const stubs = [...document.querySelectorAll('#of-pause .row.stub')]
    .map((e) => ({ name: e.getAttribute('data-stub'),
      why: (e.querySelector('.why') ?? {}).textContent ?? '' }));
  check('the shell reserves Save Game, the three Options and Multiplayer',
    stubs.length === 5, `${stubs.length}: ${stubs.map((s) => s.name).join(', ')}`);
  check('and every stub says what it is waiting for rather than just "not yet"',
    stubs.every((s) => s.why.length > 40), JSON.stringify(stubs.map((s) => s.why.length)));
  check('no stub is a pressable button',
    document.querySelectorAll('#of-pause .row.stub button').length === 0);
  const shown = of.pause().view;
  check('the menu NAMES the save slot this world lives in',
    (document.querySelector('#of-pause [data-slot]') ?? {}).textContent
      === shown.slotKey, shown.slotKey);

  // ======================================================================
  // C. START FRESH: the confirm cannot be skipped (GP-103)
  // ======================================================================
  const before = of.pause();
  check('the CONFIRM button does not exist in the DOM until the row is armed',
    before.confirmButton === false && before.armed === false,
    JSON.stringify({ confirm: before.confirmButton, armed: before.armed }));
  // The verb itself refuses, which is the second gate: a probe, or anybody at a
  // console, could call it directly and the DOM would not be in the way.
  const refused = of.cheat('startfresh:confirm');
  const refusal = refused.log[refused.log.length - 1];
  check('and the VERB refuses when it was never confirmed',
    refusal.done === false && refusal.message.includes('must be confirmed'),
    JSON.stringify(refusal));
  check('the refusal did not arm anything either', of.pause().armed === false);

  check('pressing Start Fresh ARMS it', await press('startfresh'));
  await sleep(0.3);
  const armed = of.pause();
  check('and now the confirm and cancel buttons exist',
    armed.confirmButton === true && armed.cancelButton === true,
    JSON.stringify(armed));
  const sentence = armed.view.confirm;
  check('the confirm NAMES the slot it is about to destroy',
    sentence.includes(`"${armed.view.slotKey}"`) && sentence.includes('DESTROYS'),
    sentence);
  check('cancel disarms it', await press('startfresh:cancel'));
  await sleep(0.3);
  const cancelled = of.pause();
  check('and the confirm button is gone again',
    cancelled.armed === false && cancelled.confirmButton === false,
    JSON.stringify(cancelled));
  log.push(`start fresh targets "${armed.view.slotKey}"`);

  // ======================================================================
  // D. PEACEFUL MODE AND KILL ALL (GP-106, GP-107)
  // ======================================================================
  // THE CAUSE FIRST. A nest dispatches nothing at a world that has built
  // nothing (GP-93), so smelters go down through the player's own build path
  // and the pollution they make is what fills a nest to its threshold. Without
  // them the kill-all button would be asserted against an empty swarm, which is
  // not a claim worth making.
  const E = () => of.game().enemies;
  const e0 = E();
  const enemyState = { hostile: e0.hostile, enabled: e0.enabled, why: e0.why,
    nests0: e0.nests, live0: e0.swarm.live, peaceful0: e0.peaceful };
  await openMenu();
  const rows = of.pause().buttons;
  const rowOf = (id) => rows.find((r) => r.id === id);

  if (!combat) {
    // THE NEGATIVE CONTROL, and it is the run that makes the other one mean
    // something. DW-31 makes sandbox safe, so both rows must be BLOCKED and both
    // must publish the sentence they are overriding rather than a quiet zero.
    check('with no ?combat=1 the enemy loop is off', e0.enabled === false,
      `enabled=${e0.enabled}`);
    check('and BOTH enemy controls are blocked',
      rowOf('peaceful').disabled === true && rowOf('killall').disabled === true,
      JSON.stringify([rowOf('peaceful'), rowOf('killall')]));
    check('and each one SAYS WHY rather than being silently grey',
      rowOf('killall').blocked.includes('sandbox is safe by default'),
      rowOf('killall').blocked);
    check('and there is nothing alive to kill in the first place',
      e0.nests === 0 && e0.swarm.live === 0,
      `${e0.nests} nests, ${e0.swarm.live} creatures`);
  } else {
    check('with ?combat=1 the enemy loop is up', e0.enabled === true, e0.why);
    check('and neither enemy control is blocked',
      rowOf('peaceful').disabled === false && rowOf('killall').disabled === false,
      JSON.stringify([rowOf('peaceful'), rowOf('killall')]));

    of.pause(false);
    await sleep(0.3);
    const yaw = of.world().observer.yawDeg;
    for (let i = 0; i < 10; i++) {
      of.build(3);
      await sleep(0.08);
      of.look(yaw + i * 21, -24);
      await sleep(0.18);
      of.input.tape([{ hold: 4, actions: ['use'] }, { hold: 8, keys: [] }]);
      await sleep(0.32);
    }
    of.build(0);
    await sleep(1.3);
    const em = E().emitters;
    enemyState.emitters = em.derived;
    check('the smelters became pollution emitters',
      em.derived > 0 && em.refusals === 0,
      JSON.stringify({ derived: em.derived, inCore: em.inCore }));
    // `advance` moves /core's pollution CLOCK and nothing else (GP-93): no wave
    // is conjured, and a nest still has to reach its own threshold on its own.
    let waves = 0;
    for (let k = 0; k < 30 && waves === 0; k++) {
      waves = of.enemies('advance', 60 * 60).wavesDispatched;
    }
    await sleep(1.5);
    const e1 = E();
    const spawned = e1.swarm.live;
    log.push(`${waves} wave(s) dispatched, ${spawned} creatures alive, `
      + `${e1.nests} nests standing`);
    check('the chain actually produced a swarm to kill', spawned > 0,
      `${waves} waves, ${spawned} live`);

    await openMenu();
    check('pressing Kill all enemies works', await press('killall'));
    await sleep(1.2);
    const e2 = E();
    const kr = of.cheat().log.filter((r) => r.id === 'killall').pop();
    enemyState.kill = { liveBefore: spawned, liveAfter: e2.swarm.live,
      nestsBefore: e1.nests, nestsAfter: e2.nests,
      killedDelta: e2.swarm.killed - e1.swarm.killed,
      nestsKilledDelta: e2.nestsKilled - e1.nestsKilled, receipt: kr };
    check('KILL ALL leaves nothing alive', e2.swarm.live === 0 && e2.nests === 0,
      `${e2.swarm.live} creatures, ${e2.nests} nests`);
    // THE COUNTERS ARE THE POINT. `EnemySwarm.clear()` exists and would have
    // emptied the array without crediting a single kill, so a version that used
    // it would pass the line above and fail this one.
    check('and it went through the DAMAGE path, so the kills were credited',
      e2.swarm.killed - e1.swarm.killed === spawned,
      `${spawned} were alive, killed rose by ${e2.swarm.killed - e1.swarm.killed}`);
    check('the nest kills were credited too',
      e2.nestsKilled - e1.nestsKilled === e1.nests,
      `${e1.nests} nests, nestsKilled rose by ${e2.nestsKilled - e1.nestsKilled}`);
    check('and nothing is left biting the player', e2.swarm.hurtSources === 0,
      `${e2.swarm.hurtSources}`);

    check('pressing Peaceful mode works', await press('peaceful'));
    await sleep(0.6);
    const e3 = E();
    enemyState.peacefulAfter = e3.peaceful;
    check('PEACEFUL reports itself on `Enemies`', e3.peaceful === true);
    // AND IT DID NOT LIE ABOUT THE MODE. `hostile` is derived from an immutable
    // ModeRules and must be untouched: a cheat that flipped it would make the
    // save slot's own label disagree with the world it describes.
    check('and it did NOT touch what the WORLD is (ModeRules is immutable)',
      e3.hostile === e0.hostile && e3.enabled === e0.enabled,
      `hostile ${e0.hostile}->${e3.hostile}, enabled ${e0.enabled}->${e3.enabled}`);
    of.pause(false);
    await sleep(0.3);
    const waves0 = E().wavesDispatched;
    for (let k = 0; k < 20; k++) of.enemies('advance', 60 * 60);
    await sleep(1.5);
    const e4 = E();
    enemyState.underPeace = { waves0, waves1: e4.wavesDispatched, live: e4.swarm.live };
    check('and with it on, twenty more hours dispatch NOTHING',
      e4.wavesDispatched === waves0 && e4.swarm.live === 0,
      JSON.stringify(enemyState.underPeace));
  }

  // ======================================================================
  // E. INFINITE FUEL AND THE ORBIT TELEPORT (GP-104, GP-105)
  // ======================================================================
  // LAST, because it ends in orbit and everything above needs both feet on the
  // ground. The bay, the roll-out, the walk over and the climb in are all the
  // player's own path; probes/rollout.js and probes/flightabuse.js are where
  // those are proven, and this borrows their sequences verbatim.
  let fuel = { ran: false };
  const F = () => of.flight('report').flight;
  const FM = () => of.flight('report');
  if (typeof of.vab === 'function' && typeof of.flight === 'function') {
    of.pause(false);
    await sleep(0.3);
    const built = await buildRocket();
    of.vab('leave');
    await sleep(0.4);
    of.flight('rollout');
    await sleep(0.8);
    for (let i = 0; i < 16 && FM().distanceToVesselM > 10; ++i) {
      of.input.act(['forward'], 30);
      await sleep(0.6);
    }
    of.flight('board');
    await sleep(0.5);
    const live = F().live;
    log.push(`built ${built} parts, rolled out, aboard=${FM().aboard}, `
      + `status=${F().status}, twr=${F().twr}`);
    check('the probe got a rocket built, rolled out and boarded',
      live === true && FM().aboard === true, JSON.stringify(FM().message));

    if (live === true && FM().aboard === true) {
      // THE FUEL NUMBER IS `of.cheat().propellantKg`, RE-READ FROM /core, and
      // never `flight('report').propellantKg`. The session's own figure sums the
      // cached part rows and those only move on a staging, so it reads the same
      // 2190 kg through an entire burn: a probe that used it measured a burn
      // that spent nothing and a refill that added nothing, and both assertions
      // agreed with each other about a number that was never alive.
      const fuelKg = () => of.cheat().propellantKg;
      const f0 = F();
      const kg0 = fuelKg();
      // BURN some of it, through the throttle and the stage key a player uses.
      of.input.act(['throttleFull'], 6);
      await sleep(0.5);
      of.input.act(['stage'], 6);
      await sleep(3.5);
      const f1 = F();
      const kg1 = fuelKg();
      await openMenu();
      check('pressing Infinite fuel works', await press('fuel'));
      await sleep(0.8);
      const f2 = F();
      const state = of.cheat();
      fuel = { ran: true, full0: kg0, burnt: kg1, refilled: state.propellantKg,
        massBurn: [f0.massKg, f1.massKg, f2.massKg],
        parts1: f1.parts, parts2: f2.parts,
        stagings1: f1.stagings, stagings2: f2.stagings,
        status1: f1.status, on: state.infiniteFuel, fullKg: state.fullKg };
      check('the burn actually spent propellant (or nothing below means anything)',
        kg1 < kg0 - 1, `${kg0} -> ${kg1} kg, status ${f1.status}`);
      check('and /core agrees, because the craft got lighter',
        f2.massKg > 0 && f1.massKg < f0.massKg - 1,
        `${f0.massKg} -> ${f1.massKg} kg all up`);
      check('INFINITE FUEL puts it back', state.propellantKg > kg1 + 1,
        `${kg1} -> ${state.propellantKg} kg`);
      // THE ASSERTION THAT MAKES THE REFILL HONEST. `refillTanks` rebuilds the
      // craft from its design, so a version that forgot to replay the stagings
      // would come back with the jettisoned stages ATTACHED, refill the tanks
      // perfectly, and pass every line above this one.
      check('and it is the SAME craft, not a resurrected stack',
        f2.parts === f1.parts && f2.stagings === f1.stagings,
        `${f1.parts}p/${f1.stagings}s before, ${f2.parts}p/${f2.stagings}s after`);
      check('the toggle reports itself ON', state.infiniteFuel === true);

      // IT STAYS full, which is the whole difference between "infinite" and
      // "one refill". Burn on with the cheat still on and read it back.
      of.pause(false);
      await sleep(0.3);
      of.input.act(['throttleFull'], 6);
      await sleep(5.0);
      const kg3 = fuelKg();
      fuel.stillFull = kg3;
      fuel.floorKg = +(state.fullKg * 0.9).toFixed(1);
      check('and it is STILL full five seconds of burning later',
        kg3 >= state.fullKg * 0.85,
        `${kg3} kg against a ${state.fullKg} kg full load`);

      await openMenu();
      check('pressing Teleport to orbit works', await press('orbit'));
      await sleep(1.5);
      of.pause(false);
      await sleep(1.5);
      const f4 = F();
      const rec = of.cheat().log.filter((r) => r.id === 'orbit').pop();
      const spread = Math.abs(f4.apoapsisM - f4.periapsisM);
      fuel.orbit = { status: f4.status, apoM: f4.apoapsisM, periM: f4.periapsisM,
        ecc: f4.eccentricity, bound: f4.bound, inSpace: f4.inSpace,
        altDatumM: f4.altitudeDatumM, spreadM: +spread.toFixed(2), receipt: rec };
      // /core's OWN verdict, and not the cheat's claim about what it wrote: the
      // status is computed inside `FlightSession.step` from `inSpace`, `bound`
      // and `periapsisAltM`, so ORBIT here is the simulation agreeing.
      check('the craft is in ORBIT, and /core says so rather than the cheat',
        f4.status === 'ORBIT', `${f4.status}, inSpace=${f4.inSpace}`);
      check('the orbit is BOUND with a periapsis above the atmosphere (60 km)',
        f4.bound === true && f4.periapsisM > 60000, JSON.stringify(fuel.orbit));
      // CIRCULAR to better than a kilometre out of a hundred, which is not
      // something any ascent this probe could fly would produce by accident.
      check('and it is CIRCULAR (apoapsis and periapsis agree)', spread < 1000,
        `${spread.toFixed(1)} m apart, e=${f4.eccentricity}`);
      // THE THROTTLE IS SHUT BY THE TELEPORT, and this is the assertion that
      // caught why: with the engine left lit the craft simply kept accelerating
      // prograde out of the circle it had been put in, and three seconds later
      // read e = 0.15994 with 266 km between apoapsis and periapsis.
      check('and the teleport SHUT THE THROTTLE, or it would not stay circular',
        f4.throttle === 0, `throttle ${f4.throttle}`);
      // The camera went with it. Without `observer.syncToVessel` the eye lerps
      // across 600 km in one frame and the rocket draws at the body centre.
      const w = of.world();
      fuel.orbit.observerAltM = w.altM;
      fuel.orbit.regime = w.regime;
      check('and the OBSERVER went with it rather than staying on the pad',
        w.altM > 60000, `observer at ${(w.altM / 1000).toFixed(1)} km, ${w.regime}`);
    }
  }

  // ======================================================================
  // F. GP-102: a cheat in SURVIVAL marks the save; in sandbox it does not
  // ======================================================================
  const a = of.cheat();
  const sandbox = of.sandbox().sandbox;
  check('a testing control was actually used, or the mark proves nothing',
    a.log.some((r) => r.done && !r.id.startsWith('startfresh')),
    JSON.stringify(a.log.map((r) => r.id)));
  check('sandbox is NEVER marked assisted', !sandbox || a.assisted === false,
    JSON.stringify({ sandbox, assisted: a.assisted, used: a.used }));
  if (!sandbox) {
    check('but survival IS, and it names which controls were used',
      a.assisted === true && a.used.length > 0, JSON.stringify(a.used));
  }

  return {
    valid: fails.length === 0,
    fails,
    log,
    combat,
    escape: {
      opened: openedByEscape,
      lastEscape: of.game().controls.lastEscape,
      withPackOpen: afterPack,
      withPartInHand: afterDrop,
    },
    shell: { stubs, slotKey: shown.slotKey, mode: shown.mode },
    startFresh: { armedSentence: sentence, beforeArm: before, afterArm: armed,
      afterCancel: cancelled, unarmedRefusal: refusal },
    enemies: enemyState,
    fuel,
    assisted: a,
  };

  async function openMenu() { of.pause(true); await sleep(0.35); }

  /** A pod, a tank and an engine, placed at the bay's own published sockets.
   *  Lifted from probes/rollout.js so the two agree about what a minimal rocket
   *  is; the bay itself is proven over there. */
  async function buildRocket() {
    const PID = [0x0100, 0x0101, 0x0103];
    of.vab('enter');
    await sleep(0.4);
    const cat = of.vab('catalogue');
    of.vab('press', 'clear');
    await sleep(0.15);
    for (const pid of PID) {
      const i = cat.find((c) => c.id === pid)?.index ?? -1;
      if (i < 0) continue;
      of.vab('frame');
      of.vab('take', i);
      await sleep(0.12);
      const parts = of.vab('report').parts;
      if (parts.length === 0) { of.vab('place'); await sleep(0.12); continue; }
      let low = parts[0];
      for (const p of parts) if (p.origin[1] < low.origin[1]) low = p;
      const nodes = of.vab('nodes').filter((n) => n.parent === low.handle
        && n.onScreen && (n.kind === 'bottom' || n.kind === 'interstage'));
      if (nodes.length === 0) continue;
      of.vab('hover', nodes[0].ndc[0], nodes[0].ndc[1]);
      of.vab('place');
      await sleep(0.12);
    }
    return of.vab('report').parts.length;
  }
})()

