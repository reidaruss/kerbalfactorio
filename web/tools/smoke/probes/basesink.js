// R19 LEAD 1: THE WALKER WITH A BASE UNDER IT.
//
//   node tools/smoke/run.mjs --scenario=walk --sandbox=1 \
//        --evalfile=tools/smoke/probes/basesink.js
//
// PH-45 measured the sinking complaint at a real mountain site and found the
// feet bit-identical for 3000 ticks. Every one of those runs had
// `solids.count == 0`, so the whole structural block of `KinematicBody.step`
// (the `solids.resolveStep` call and the `deckUnder` query, KinematicBody.ts
// 278 to 300) NEVER EXECUTED. Reid's live HUD reads `structures 140/512`, so
// that block runs on every tick of his session and has never run in any of
// mine. It is the largest untested surface in the walker.
//
// It also matches the history. Reid's FIRST report of these exact words,
// "constantly snapping back up to the surface then sinking", was about a DECK.
// GP-53 fixed `deckUnder`'s clamp; the same sentence came back pointed at a
// tunnel; WG-31 fixed `floorBelow`'s clamp; the sentence came back again. If
// the mechanism is structural, that is one bug that has been closed twice
// without being touched.
//
// So this builds a real base, says how many parts are in it, and then measures
// the SAME per-tick standing trace at four places a player in Reid's world
// actually stands:
//
//   A  on the deck of the base
//   B  on open terrain beside it, where the structural block runs every tick
//      and answers nothing
//   C  in a tunnel dug right beside the base, so both authorities are live
//   D  walking on and off the deck, which is how the deck state is entered
//
// `StandTrace` already records `terrainR` and `deckR` SEPARATELY beside the
// `groundR` that won, which is the whole reason it exists: two systems taking
// turns is visible in the first two columns and invisible in the third.
//
// Sandbox, for `decksink.js`'s reason (DW-31): this is about geometry, and
// forty stone per foundation would make it a harvesting probe.
(async () => {
  const of = window.__of;
  const A = OF_ARGS ?? {};
  const log = [];
  const r6 = (x) => (Number.isFinite(x) ? Number(x.toFixed(6)) : null);
  const r3 = (x) => (Number.isFinite(x) ? Number(x.toFixed(3)) : null);
  const fail = (why, extra) => ({ valid: false, fail: why, ...extra, log });
  const settle = async (secs) => {
    of.input.tape([{ hold: Math.ceil(60 * secs) + 30, keys: [] }]);
    await of.run(secs, 60);
  };
  const hold = async (secs, keys) => {
    of.input.tape([{ hold: Math.ceil(60 * secs) + 30, keys }]);
    await of.run(secs, 60);
  };
  const P = () => of.world().player;
  const feet = () => P().feet;
  const parts = () => of.game().structures.parts;
  const ghost = () => of.build().structGhost;

  await settle(1.0);
  if (!of.sandbox().sandbox) return fail('run this with --sandbox=1');
  if (of.game() === null) return fail('no gameplay layer');
  if (typeof of.stand !== 'function') return fail('no __of.stand: rebuild');
  if (typeof of.solidBuild !== 'function') return fail('no __of.solidBuild: rebuild');
  const M = of.game().structures.module;
  const yaw0 = of.world().observer.yawDeg;

  // --- WHICH HOTBAR SLOT IS THE FOUNDATION, ASKED RATHER THAN RECITED ------
  // `decksink.js` hard-codes slot 4. The combat and pad lanes are both live in
  // the gameplay files this week, so a recited slot index is a number that can
  // silently become the wrong item and place nothing while the probe reports a
  // clean zero. Ask instead: the foundation is the slot that produces a
  // structural ghost.
  let slot = null;
  for (let i = 0; i < 10 && slot === null; ++i) {
    of.build(i);
    await settle(0.12);
    of.look(yaw0, -70);
    await settle(0.12);
    if (ghost() !== null) slot = i;
  }
  if (slot === null) return fail('no hotbar slot produces a structural ghost');
  log.push(`foundation is hotbar slot ${slot}; module cell ${M.cellM} m, `
    + `deck ${M.deckH} m, storey ${M.storey} m`);

  /**
   * The radius of the highest structural TOP FACE along a point's radial,
   * bisected on `of.solidBuild`, which IS `StructureBodies.blocks`, the exact
   * predicate the walker collides against. `decksink.js`'s reference and its
   * reason: a number recomputed from `module.deckH` would agree with itself
   * whatever the walker did.
   */
  const topAlong = (p, windowM = 3.0) => {
    const r = Math.hypot(p[0], p[1], p[2]);
    const u = [p[0] / r, p[1] / r, p[2] / r];
    const at = (rr) => of.solidBuild(u[0] * rr, u[1] * rr, u[2] * rr);
    let hit = null;
    for (let d = -windowM; d <= windowM + 1e-9; d += 0.02) if (at(r + d)) hit = r + d;
    if (hit === null) return null;
    let a = hit, b = hit + 0.02;
    for (let i = 0; i < 48; ++i) { const m = (a + b) / 2; if (at(m)) a = m; else b = m; }
    return a;
  };

  // --- BUILD A BASE ---------------------------------------------------------
  // Reid has 140 structures. The number matters for more than realism: the
  // structural port has NO spatial index (`StructureBodies.gather` is a linear
  // scan over every placed part, StructureBody.ts 208), so part count is also
  // the per-tick cost and is worth reporting beside the geometry.
  const WANT = A.parts ?? 140;
  of.build(slot);
  await settle(0.2);
  const placed = [];
  const laps = A.laps ?? 14;
  for (let lap = 0; lap < laps && parts().length < WANT; ++lap) {
    // Sweep the crosshair over the ground in front of the player and press on
    // every distinct valid cell it finds.
    for (let dy = -70; dy <= 70 && parts().length < WANT; dy += 10) {
      for (let p = -80; p <= -25 && parts().length < WANT; p += 5) {
        of.look((yaw0 + dy + 720) % 360, p);
        await of.run(0.04, 60);
        const g = ghost();
        if (g === null || g.addr === null || !g.ok) continue;
        const before = parts().length;
        of.input.tape([{ hold: 4, actions: ['use'] }, { hold: 6, keys: [] }]);
        await of.run(0.18, 60);
        if (parts().length > before) placed.push(g.addr);
      }
    }
    // Move on so the next lap has fresh ground under the crosshair.
    of.look((yaw0 + 90) % 360, -10);
    await hold(1.1, ['KeyW']);
    await settle(0.4);
  }
  of.build(0);                                   // hands back: nothing places
  await settle(0.6);
  const built = parts().length;
  log.push(`built ${built} structural parts in ${laps} laps`);
  if (built < 2) return fail('the base would not go up', { built, placed });

  // --- THE MEASURING RIG ----------------------------------------------------
  const gTick = of.gravity(Math.hypot(...feet())) / 3600;
  const stand = async (name, secs) => {
    await settle(1.0);
    of.stand(true);
    await settle(secs);
    const d = of.stand();
    of.stand(false);
    const s = d.samples.filter((x) => Number.isFinite(x.feetR));
    if (s.length < 120) return { name, valid: false, fail: 'trace too short', kept: s.length };
    const p = P();
    const rs = s.map((x) => x.feetR);
    const lo = Math.min(...rs);
    const ups = [], downs = [];
    for (let i = 1; i < s.length; ++i) {
      const dd = s[i].feetR - s[i - 1].feetR;
      if (dd > gTick) ups.push({ t: s[i].tick, dM: dd, push: s[i].pushM, onDeck: s[i].onDeck });
      else if (dd < -gTick) downs.push({ t: s[i].tick, dM: dd });
    }
    const per = [];
    for (let i = 1; i < ups.length; ++i) per.push(ups[i].t - ups[i - 1].t);
    const deckAnswered = s.filter((x) => Number.isFinite(x.deckR));
    const top = topAlong(p.feet);
    return {
      name, valid: true, ticks: s.length,
      feetR: r6(Math.hypot(...p.feet)),
      deckTopAboveFeetM: top === null ? null : r6(top - Math.hypot(...p.feet)),
      spreadM: r6(Math.max(...rs) - lo),
      oneTickOfGravityM: r6(gTick),
      snapUps: ups.length,
      snapDowns: downs.length,
      biggestUpM: ups.length === 0 ? null : r6(Math.max(...ups.map((x) => x.dM))),
      meanPeriodTicks: per.length === 0 ? null
        : r6(per.reduce((a, b) => a + b, 0) / per.length),
      periodsTicks: per.slice(0, 20),
      onDeckTicks: s.filter((x) => x.onDeck).length,
      deckAnsweredTicks: deckAnswered.length,
      underRockTicks: s.filter((x) => x.underRock).length,
      groundedTicks: s.filter((x) => x.grounded).length,
      blockedByBuildTicks: s.filter((x) => x.blockedByBuild).length,
      pushTicks: s.filter((x) => x.pushM > 0).length,
      // BOTH ratification tests, side by side. GP-53 was the deck half and
      // WG-31 was the terrain half, and only having both columns can say which
      // authority is answering with the querier's own position THIS time.
      terrainRatifyTicks: s.filter((x) => Math.abs(x.terrainR - x.preSnapR) < 1e-9).length,
      deckRatifyTicks: deckAnswered.filter((x) => Math.abs(x.deckR - x.preSnapR) < 1e-9).length,
      // Which candidate won, counted. A deck and the terrain taking turns is
      // invisible in `groundR` alone and obvious here.
      wonByDeck: s.filter((x) => Number.isFinite(x.deckR) && x.deckR >= x.terrainR).length,
      wonByTerrain: s.filter((x) => !Number.isFinite(x.deckR) || x.terrainR > x.deckR).length,
      series: s.filter((_, i) => i % 6 === 0).slice(0, 60).map((x) => [x.tick,
        r6(x.feetR - lo), r6(x.terrainR - lo),
        Number.isFinite(x.deckR) ? r6(x.deckR - lo) : null,
        r6(x.groundR - lo), r6(x.preSnapR - lo),
        x.onDeck ? 1 : 0, x.grounded ? 1 : 0, r6(x.pushM)]),
    };
  };

  const scenes = [];

  // --- A: ON THE DECK, walked onto rather than spawned onto ----------------
  // The oscillation Reid describes is on a deck the player WALKED onto, which
  // is a different state from being enclosed by a foundation laid around you:
  // the step-up has run and `onDeck` is true. `decksink.js` makes the same
  // distinction and for the same reason.
  let onDeck = P().onDeck === true;
  for (let i = 0; i < 24 && !onDeck; ++i) {
    of.look((yaw0 + (i % 2 === 0 ? 180 : 0)) % 360, -10);
    await hold(0.45, ['KeyW']);
    await of.run(0.2, 60);
    onDeck = P().onDeck === true;
  }
  if (onDeck) scenes.push(await stand('A: standing on the deck', A.standSecs ?? 15));
  else { scenes.push({ name: 'A: standing on the deck', valid: false, fail: 'never got onto a deck' }); }

  // --- B: BESIDE THE BASE, on open terrain ---------------------------------
  // The structural block still runs every tick here. If the mere PRESENCE of
  // 140 parts perturbs a walker who is not touching any of them, this is where
  // it shows, and it is the cheapest possible negative control on the whole
  // hypothesis.
  let off = P().onDeck !== true && topAlong(feet()) === null;
  for (let i = 0; i < 20 && !off; ++i) {
    of.look((yaw0 + 180) % 360, -10);
    await hold(0.5, ['KeyW']);
    await of.run(0.2, 60);
    off = P().onDeck !== true && topAlong(feet()) === null;
  }
  scenes.push(off ? await stand('B: on terrain beside the base', A.standSecs ?? 15)
    : { name: 'B: on terrain beside the base', valid: false, fail: 'never got off the footprint' });

  // --- C: IN A TUNNEL DUG RIGHT BESIDE THE BASE ----------------------------
  // Reid's world has both. A tunnel measured with no base in the world tests
  // one authority; a tunnel measured with 140 parts a few metres away tests
  // the pair, which is what his session actually runs.
  const dug = [];
  for (let i = 0; i < (A.rampStrikes ?? 6); ++i) {
    of.look(yaw0, -85);
    const d = of.dig();
    await settle(0.35);
    dug.push({ phase: 'shaft', cells: d?.cells ?? null, underRock: P().underRock });
  }
  for (let i = 0; i < (A.strikes ?? 14); ++i) {
    of.look(yaw0, -12);
    const d = of.dig();
    await of.run(0.2, 60);
    await hold(0.22, ['KeyW']);
    dug.push({ phase: 'bore', cells: d?.cells ?? null, underRock: P().underRock });
  }
  await settle(2.0);
  let inRock = P().underRock === true;
  for (const act of ['KeyS', 'KeyW']) {
    if (inRock) break;
    for (let i = 0; i < 12 && !inRock; ++i) {
      await hold(0.35, [act]);
      await of.run(0.15, 60);
      inRock = P().underRock === true;
    }
  }
  scenes.push(inRock ? await stand('C: in a tunnel beside the base', A.standSecs ?? 15)
    : { name: 'C: in a tunnel beside the base', valid: false, fail: 'never got under rock' });

  // --- D: WALKING ON AND OFF THE DECK --------------------------------------
  // The entry and exit of the deck state, driven, because a transition between
  // two authorities is a different question from steady state on either.
  of.stand(true);
  for (let i = 0; i < 6; ++i) {
    of.look(yaw0, -10);
    await hold(0.6, ['KeyW']);
    await of.run(0.15, 60);
    of.look((yaw0 + 180) % 360, -10);
    await hold(0.6, ['KeyW']);
    await of.run(0.15, 60);
  }
  const wd = of.stand().samples.filter((x) => Number.isFinite(x.feetR));
  of.stand(false);
  let deckFlips = 0, worstStep = 0;
  for (let i = 1; i < wd.length; ++i) {
    if (wd[i].onDeck !== wd[i - 1].onDeck) deckFlips++;
    const d = Math.abs(wd[i].feetR - wd[i - 1].feetR);
    if (d > worstStep) worstStep = d;
  }
  const walkDeck = {
    ticks: wd.length,
    onDeckTicks: wd.filter((x) => x.onDeck).length,
    deckFlips,
    groundedTicks: wd.filter((x) => x.grounded).length,
    biggestSingleTickStepM: r6(worstStep),
    pushTicks: wd.filter((x) => x.pushM > 0).length,
    blockedByBuildTicks: wd.filter((x) => x.blockedByBuild).length,
  };

  for (const sc of scenes) {
    if (!sc.valid) { log.push(`${sc.name}: NOT MEASURED (${sc.fail})`); continue; }
    log.push(`${sc.name}: spread ${sc.spreadM} m over ${sc.ticks} ticks, `
      + `${sc.snapUps} snap-ups (period ${sc.meanPeriodTicks}), onDeck ${sc.onDeckTicks}, `
      + `deck answered ${sc.deckAnsweredTicks}, underRock ${sc.underRockTicks}, `
      + `deck ratified ${sc.deckRatifyTicks}, terrain ratified ${sc.terrainRatifyTicks}, `
      + `pushes ${sc.pushTicks}`);
  }
  log.push(`D: walking on and off, ${walkDeck.deckFlips} deck transitions in `
    + `${walkDeck.ticks} ticks, biggest single-tick step ${walkDeck.biggestSingleTickStepM} m`);

  const moved = scenes.filter((x) => x.valid && x.spreadM > 1e-6);
  return {
    valid: scenes.every((x) => x.valid),
    reproduced: moved.length > 0,
    structuralPartsBuilt: built,
    foundationSlot: slot,
    module: M,
    scenes,
    walkDeck,
    log,
  };
})()
