// R19 LEADS 1, 2 AND 3 IN ONE SCENE: a real base, the REAL loop, and the
// third-person picture.
//
//   node tools/smoke/run.mjs --scenario=walk --sandbox=1 \
//        --evalfile=tools/smoke/probes/basereal.js
//
// `basesink.js` built 52 structural parts and measured 0.000000 m of spread on
// a deck, on terrain beside it and in a tunnel next to it. This raises the part
// count toward the 140 Reid's HUD reports and then attacks the two axes that
// every measurement in PH-45 and in `basesink.js` structurally could not see.
//
// THE REAL LOOP. Every number this lane has produced came through `of.run()`,
// which STOPS the rAF loop and drives `Loop.frame` on a synthetic clock with a
// perfectly uniform dt (`Loop.run`, app/Loop.ts). A person's session is the rAF
// loop with a jittering dt, where the fixed-step accumulator delivers 0, 1 or 2
// ticks per frame and the interpolation alpha sweeps instead of sitting on one
// value. So the standing measurement is repeated with the loop LEFT RUNNING and
// nothing driving it, and the tick and frame counters are read either side to
// prove it actually advanced. That last part is DW-20 and it is not optional:
// headless Chrome does not pump rAF continuously, and a real-time probe that
// silently advanced 90 ticks in 20 seconds is exactly how this project has
// been fooled before.
//
// THE ENCLOSED DECK. `decksink.js` found the original oscillation in a specific
// state: a foundation laid on the cell the player is standing in, so the 0.50 m
// slab is around and above the feet. That is a state a player reaches on their
// very first press, it is where the 0.198989 m sawtooth at a 74.3 tick period
// was measured, and no probe has re-measured it since WG-31 moved the terrain
// half of the same problem.
//
// THIRD PERSON. The 2.0 s looping `Idle` clip (ASSET-SPECS 1138) is the only
// thing in the whole client with a documented period inside "a few seconds".
// It cannot move the eye, because `ViewMode.eye` is a pure function of the feet
// and `Avatar.place` writes the group position from the feet before the mixer
// touches anything. But it CAN move the drawn character, which is what a
// third-person player is looking at, so the question is settled with a frame
// hash rather than by reading the animation code: stand still in TP and see
// whether the picture has a two second period in it.
(async () => {
  const of = window.__of;
  const A = OF_ARGS ?? {};
  const log = [];
  const r6 = (x) => (Number.isFinite(x) ? Number(x.toFixed(6)) : null);
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
  const sleepReal = (ms) => new Promise((r) => { setTimeout(r, ms); });

  await settle(1.0);
  if (!of.sandbox().sandbox) return fail('run this with --sandbox=1');
  if (typeof of.stand !== 'function') return fail('no __of.stand: rebuild');
  const M = of.game().structures.module;
  const yaw0 = of.world().observer.yawDeg;

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

  let slot = null;
  for (let i = 0; i < 10 && slot === null; ++i) {
    of.build(i);
    await settle(0.12);
    of.look(yaw0, -70);
    await settle(0.12);
    if (ghost() !== null) slot = i;
  }
  if (slot === null) return fail('no hotbar slot produces a structural ghost');

  const gTick = of.gravity(Math.hypot(...feet())) / 3600;

  /** Summarise a per-tick trace the same way whoever collected it got it. */
  const summarise = (name, s, extra) => {
    if (s.length < 100) return { name, valid: false, fail: 'trace too short', kept: s.length };
    const rs = s.map((x) => x.feetR);
    const lo = Math.min(...rs);
    const ups = [], downs = [];
    for (let i = 1; i < s.length; ++i) {
      const d = s[i].feetR - s[i - 1].feetR;
      if (d > gTick) ups.push({ t: s[i].tick, dM: d });
      else if (d < -gTick) downs.push({ t: s[i].tick, dM: d });
    }
    const per = [];
    for (let i = 1; i < ups.length; ++i) per.push(ups[i].t - ups[i - 1].t);
    const deckAnswered = s.filter((x) => Number.isFinite(x.deckR));
    return {
      name, valid: true, ticks: s.length,
      spreadM: r6(Math.max(...rs) - lo),
      oneTickOfGravityM: r6(gTick),
      snapUps: ups.length, snapDowns: downs.length,
      biggestUpM: ups.length === 0 ? null : r6(Math.max(...ups.map((x) => x.dM))),
      meanPeriodTicks: per.length === 0 ? null
        : r6(per.reduce((a, b) => a + b, 0) / per.length),
      periodsTicks: per.slice(0, 20),
      onDeckTicks: s.filter((x) => x.onDeck).length,
      deckAnsweredTicks: deckAnswered.length,
      underRockTicks: s.filter((x) => x.underRock).length,
      groundedTicks: s.filter((x) => x.grounded).length,
      pushTicks: s.filter((x) => x.pushM > 0).length,
      terrainRatifyTicks: s.filter((x) => Math.abs(x.terrainR - x.preSnapR) < 1e-9).length,
      deckRatifyTicks: deckAnswered.filter((x) => Math.abs(x.deckR - x.preSnapR) < 1e-9).length,
      ...extra,
      series: s.filter((_, i) => i % 10 === 0).slice(0, 40).map((x) => [x.tick,
        r6(x.feetR - lo), r6(x.terrainR - lo),
        Number.isFinite(x.deckR) ? r6(x.deckR - lo) : null,
        r6(x.preSnapR - lo), x.onDeck ? 1 : 0, x.grounded ? 1 : 0, r6(x.pushM)]),
    };
  };

  const scenes = [];

  // --- 0. THE ENCLOSED DECK, FIRST, ON VIRGIN GROUND ----------------------
  // Order matters and the first attempt got it wrong: run this after the base
  // is up and the player is already standing on a deck, and nothing will place
  // at their feet. `decksink.js` found the original oscillation in exactly this
  // state, so it is measured before anything else exists to interfere.
  of.build(slot);
  await settle(0.2);
  let laid = false;
  for (let pi = -88; pi <= -40 && !laid; pi += 2.5) {
    of.look(yaw0, pi);
    await of.run(0.05, 60);
    const g = ghost();
    if (g === null || g.addr === null || !g.ok) continue;
    const before = parts().length;
    of.input.tape([{ hold: 4, actions: ['use'] }, { hold: 8, keys: [] }]);
    await of.run(0.35, 60);
    laid = parts().length > before;
  }
  of.build(0);
  await settle(0.6);
  if (laid) {
    const encTop = topAlong(feet());
    of.stand(true);
    await settle(A.standSecs ?? 15);
    const s0 = of.stand().samples.filter((x) => Number.isFinite(x.feetR));
    of.stand(false);
    scenes.push(summarise('0: enclosed by a foundation laid at the feet', s0, {
      deckTopAboveFeetM: encTop === null ? null : r6(encTop - Math.hypot(...feet())),
    }));
  } else {
    scenes.push({ name: '0: enclosed by a foundation laid at the feet',
      valid: false, fail: 'nothing would place at the feet' });
  }

  // --- BUILD TOWARD REID'S 140 --------------------------------------------
  // A STRAIGHT LINE, not a back-and-forth: the first attempt alternated 90 and
  // 270 degrees, re-covered ground whose cells were already taken, and built 8
  // parts where the same sweep on fresh ground built 52. The refusal counters
  // are reported beside the total, because a foundation refuses uneven ground
  // and a low count with no reason attached is a number nobody can act on.
  const WANT = A.parts ?? 140;
  of.build(slot);
  await settle(0.2);
  const laps = A.laps ?? 26;
  for (let lap = 0; lap < laps && parts().length < WANT; ++lap) {
    for (let dy = -70; dy <= 70 && parts().length < WANT; dy += 10) {
      for (let pi = -78; pi <= -24 && parts().length < WANT; pi += 5) {
        of.look((yaw0 + dy + 720) % 360, pi);
        await of.run(0.03, 60);
        const g = ghost();
        if (g === null || g.addr === null || !g.ok) continue;
        const before = parts().length;
        of.input.tape([{ hold: 4, actions: ['use'] }, { hold: 6, keys: [] }]);
        await of.run(0.15, 60);
        if (parts().length > before) { /* placed */ }
      }
    }
    of.look((yaw0 + 90) % 360, -10);
    await hold(1.2, ['KeyW']);
    await settle(0.3);
  }
  of.build(0);
  await settle(0.6);
  const built = parts().length;
  const st = of.game().structures;
  const refusals = { refusals: st.refusals ?? null, uneven: st.unevenRefusals ?? null };
  log.push(`built ${built} structural parts (asked for ${WANT}); `
    + `refusals ${refusals.refusals}, of which uneven ground ${refusals.uneven}`);
  if (built < 2) return fail('the base would not go up', { built, refusals });

  // --- 2. ON A DECK, DRIVEN BY THE REAL rAF LOOP --------------------------
  let onDeck = P().onDeck === true;
  for (let i = 0; i < 20 && !onDeck; ++i) {
    of.look((yaw0 + (i % 2 === 0 ? 0 : 180)) % 360, -10);
    await hold(0.45, ['KeyW']);
    await of.run(0.2, 60);
    onDeck = P().onDeck === true;
  }
  const realLoop = async (name, secs) => {
    // Hand the keyboard back a long empty tape so nothing is held, then STOP
    // driving and let the page's own loop run.
    of.input.tape([{ hold: Math.ceil(60 * secs) + 600, keys: [] }]);
    await of.run(0.3, 60);
    const t0 = of.world().tick, f0 = of.world().frames;
    const wall0 = performance.now();
    of.stand(true);
    let s = [];
    const slices = Math.ceil(secs / 8);
    for (let i = 0; i < slices; ++i) {
      await sleepReal(Math.min(8, secs - i * 8) * 1000);
      s = s.concat(of.stand().samples.filter((x) => Number.isFinite(x.feetR)));
      of.stand(true);
    }
    s = s.concat(of.stand().samples.filter((x) => Number.isFinite(x.feetR)));
    of.stand(false);
    const t1 = of.world().tick, f1 = of.world().frames;
    const wallS = (performance.now() - wall0) / 1000;
    // DW-20: a real-time probe must demonstrate it advanced the simulation
    // before any of its numbers are worth reading.
    return summarise(name, s, {
      realTimeSecs: r6(wallS),
      ticksAdvanced: t1 - t0,
      framesAdvanced: f1 - f0,
      effectiveTickHz: r6((t1 - t0) / wallS),
      effectiveFrameHz: r6((f1 - f0) / wallS),
      advancedEnough: (t1 - t0) > secs * 30,
    });
  };
  scenes.push(onDeck ? await realLoop('2: on a deck, REAL rAF loop', A.realSecs ?? 24)
    : { name: '2: on a deck, REAL rAF loop', valid: false, fail: 'never got onto a deck' });

  // --- 3. IN A TUNNEL BESIDE THE BASE, REAL rAF LOOP ----------------------
  // WALK CLEAR OF THE FOOTPRINT FIRST. The first attempt dug from wherever the
  // deck phase left the player, which was on top of a foundation, so the shaft
  // went into a deck and `underRock` never came true. Beside the base is still
  // beside the base: the structural block runs on every one of these ticks.
  for (let i = 0; i < 14; ++i) {
    of.look((yaw0 + 180) % 360, -10);
    await hold(0.5, ['KeyW']);
    await of.run(0.15, 60);
    if (P().onDeck !== true && topAlong(feet()) === null) break;
  }
  await settle(1.0);
  for (let i = 0; i < 6; ++i) {
    of.look(yaw0, -85);
    of.dig();
    await settle(0.35);
  }
  for (let i = 0; i < 14; ++i) {
    of.look(yaw0, -12);
    of.dig();
    await of.run(0.2, 60);
    await hold(0.22, ['KeyW']);
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
  scenes.push(inRock ? await realLoop('3: in a tunnel, REAL rAF loop', A.realSecs ?? 24)
    : { name: '3: in a tunnel, REAL rAF loop', valid: false, fail: 'never got under rock' });

  // --- 4. THIRD PERSON, FRAME HASH, LOOKING FOR A 2 SECOND PERIOD ---------
  of.setView('TP');
  await settle(1.5);
  if (typeof of.setTime === 'function') of.setTime(A.timeOfDay ?? 0.35);
  of.look(yaw0, -12);
  await settle(1.0);
  const TX = 8, TY = 6, HZ = 10, SECS = A.tpSecs ?? 20;
  const frames = [];
  for (let i = 0; i < SECS * HZ; ++i) {
    await settle(1 / HZ);
    const h = of.framehash(TX, TY);
    frames.push(h.tiles.slice());
  }
  const nT = frames[0].length;
  const perTile = new Array(nT).fill(0);
  const changedAt = [];
  for (let i = 1; i < frames.length; ++i) {
    let c = 0;
    for (let k = 0; k < nT; ++k) if (frames[i][k] !== frames[i - 1][k]) { perTile[k]++; c++; }
    if (c > 0) changedAt.push(i);
  }
  const gaps = [];
  for (let i = 1; i < changedAt.length; ++i) gaps.push(changedAt[i] - changedAt[i - 1]);
  const tp = {
    mode: P().mode, armLengthM: r6(P().armLengthM), tiles: nT,
    sampleHz: HZ, seconds: SECS,
    gapsWithAnyChange: changedAt.length, totalGaps: frames.length - 1,
    // A 2.0 s period sampled at 10 Hz is 20 samples between events.
    meanGapSamples: gaps.length === 0 ? null
      : r6(gaps.reduce((a, b) => a + b, 0) / gaps.length),
    perTileChanges: perTile,
  };
  of.setView('FP');

  for (const sc of scenes) {
    if (!sc.valid) { log.push(`${sc.name}: NOT MEASURED (${sc.fail})`); continue; }
    log.push(`${sc.name}: spread ${sc.spreadM} m over ${sc.ticks} ticks, `
      + `${sc.snapUps} up / ${sc.snapDowns} down (period ${sc.meanPeriodTicks}), `
      + `onDeck ${sc.onDeckTicks}, deck answered ${sc.deckAnsweredTicks}, `
      + `underRock ${sc.underRockTicks}, pushes ${sc.pushTicks}, `
      + `ratified deck ${sc.deckRatifyTicks} terrain ${sc.terrainRatifyTicks}`
      + (sc.ticksAdvanced === undefined ? ''
        : `; REAL LOOP ${sc.ticksAdvanced} ticks and ${sc.framesAdvanced} frames in `
          + `${sc.realTimeSecs} s (${sc.effectiveTickHz} Hz sim, ${sc.effectiveFrameHz} Hz render)`));
  }
  log.push(`4: third person, arm ${tp.armLengthM} m, ${tp.gapsWithAnyChange} of `
    + `${tp.totalGaps} sample gaps changed any tile, mean gap ${tp.meanGapSamples} samples `
    + `(a 2.0 s period would be 20)`);

  return {
    valid: scenes.every((x) => x.valid),
    reproduced: scenes.some((x) => x.valid && x.spreadM > 1e-6),
    structuralPartsBuilt: built,
    refusals,
    module: M,
    scenes,
    thirdPerson: tp,
    log,
  };
})()
