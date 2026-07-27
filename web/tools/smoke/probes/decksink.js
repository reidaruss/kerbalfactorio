// "YOU CONSTANTLY SINK INTO THE FOUNDATION", measured as a number per TICK.
//
// Reid, verbatim: "constantly snapping back up to the surface then sinking".
// Two stills moments apart on the same platform, player stationary, read
// alt 2.2 m and alt 2.1 m, both GROUNDED and both 0.00 m/s. So the thing to
// measure is not a static offset, it is a CYCLE with the player standing still,
// and a per-FRAME reading cannot see it: a frame carries one to three fixed
// ticks and `world().player` samples once per frame.
//
// So this drives `__of.stand()`, the per-tick trace added with it
// (src/player/StandTrace.ts), which records the two CANDIDATE standing radii
// separately (`terrainR`, `deckR`) alongside the one that won (`groundR`).
// Two systems taking turns is visible in the first two columns and invisible in
// the third.
//
// THE REFERENCE HEIGHT IS THE WALKER'S OWN PREDICATE, NOT A CONSTANT. The deck
// top is found by bisecting `__of.solidBuild`, which is
// `StructureBodies.blocks`, the exact function the walker collides against. A
// number recomputed from `module.deckH` would agree with itself whatever the
// walker did, which is standing rule 11's whole complaint.
//
// FOUR PROPERTIES, none of them a threshold tuned until it passed:
//   P1 a stationary player on a static floor stands at a CONSTANT radius.
//      The spread over 300 stationary ticks is the bug, in metres.
//   P2 that radius IS the deck's own top face.
//   P3 negative control: standing BESIDE the deck rather than on it, the
//      structural port answers nothing and the terrain holds the player up.
//   P4 a driven walk across the deck has the feet on the top face at every
//      grounded tick whose radial passes through it.
//
// RUN IN SANDBOX (`--sandbox=1`): this is about geometry, and forty stone per
// foundation would make it a harvesting probe (DW-31, same argument as
// probes/basesnap.js).
(async () => {
  const of = window.__of;
  const sleep = (n) => of.run(n);
  const log = [];
  const fail = (why, extra) => ({ fail: why, ...extra, log });
  const r6 = (x) => (Number.isFinite(x) ? Number(x.toFixed(6)) : null);

  await sleep(0.8);
  if (!of.sandbox().sandbox) return fail('run this with --sandbox=1');
  if (of.structures() === null) return fail('no structural layer');
  if (typeof of.stand !== 'function') return fail('no __of.stand: rebuild');
  const M = of.game().structures.module;
  const yaw0 = of.world().observer.yawDeg;

  const feet = () => of.world().player.feet;
  const parts = () => of.game().structures.parts;
  const ghost = () => of.build().structGhost;

  /**
   * The radius of the highest structural TOP FACE along the radial through a
   * body-frame point, bisected on the walker's own collision predicate.
   * Returns null when the radial misses every placed part, which is exactly the
   * question P3's negative control asks.
   */
  const topAlong = (p, windowM = 3.0) => {
    const r = Math.hypot(p[0], p[1], p[2]);
    const u = [p[0] / r, p[1] / r, p[2] / r];
    const at = (rr) => of.solidBuild(u[0] * rr, u[1] * rr, u[2] * rr);
    let hit = null;
    for (let d = -windowM; d <= windowM + 1e-9; d += 0.02) {
      if (at(r + d)) hit = r + d;          // ascending, so the LAST is the top
    }
    if (hit === null) return null;
    let a = hit, b = hit + 0.02;
    for (let i = 0; i < 48; ++i) {
      const m = (a + b) / 2;
      if (at(m)) a = m; else b = m;
    }
    return a;
  };

  const sweep = async (want, lo = -88, hi = -20, yaws = [0]) => {
    for (const dy of yaws) {
      for (let p = lo; p <= hi; p += 2.5) {
        const y = (yaw0 + dy + 360) % 360;
        of.look(y, p);
        await sleep(0.06);
        const g = ghost();
        if (g !== null && want(g)) return { g, pitch: p, yaw: y };
      }
    }
    return null;
  };

  // --- lay one foundation under the crosshair ------------------------------
  of.build(4);
  await sleep(0.15);
  const found = await sweep((g) => g.addr !== null && g.ok, -88, -45);
  if (found === null) return fail('no valid cell underfoot', { ghost: ghost() });
  of.input.tape([{ hold: 4, actions: ['use'] }, { hold: 8, keys: [] }]);
  await sleep(0.4);
  if (parts().length < 1) return fail('the founding press placed nothing');
  of.build(0);                                  // hands back, so nothing places
  log.push(`laid ${parts().length} part(s), module cell ${r6(M.cellM)} m, `
    + `deck ${r6(M.deckH)} m, storey ${r6(M.storey)} m`);

  /** The solid band along the feet's radial, so the GEOMETRY is in the report
   *  rather than inferred from a single top-face number. */
  const profile = (p) => {
    const r = Math.hypot(p[0], p[1], p[2]);
    const u = [p[0] / r, p[1] / r, p[2] / r];
    const bands = [];
    let start = null;
    for (let d = -1.5; d <= 2.5 + 1e-9; d += 0.02) {
      const hit = of.solidBuild(u[0] * (r + d), u[1] * (r + d), u[2] * (r + d));
      if (hit && start === null) start = d;
      if (!hit && start !== null) { bands.push([r6(start), r6(d - 0.02)]); start = null; }
    }
    if (start !== null) bands.push([r6(start), 2.5]);
    return bands;                                // metres relative to the feet
  };

  const walkTape = async (act, n = 1) => {
    for (let i = 0; i < n; ++i) {
      of.input.tape([{ hold: 16, actions: [act] }, { hold: 6, keys: [] }]);
      await sleep(0.55);
    }
  };

  // --- THE FIRST DEFECT, AND IT NEEDS NO WALKING AT ALL ---------------------
  // The founding cell is the one under the crosshair and the crosshair was
  // aimed at the player's own feet, so the slab was laid AROUND them. Whatever
  // happens next, this state is one a player reaches on their very first press.
  const encFeet = feet();
  const encTop = topAlong(encFeet);
  of.stand(true);
  await sleep(2.0);
  const e = of.stand().samples.filter((x) => Number.isFinite(x.feetR));
  const enclosed = encTop === null ? null : {
    ticks: e.length,
    deckTopAboveFeetM: r6(encTop - Math.hypot(encFeet[0], encFeet[1], encFeet[2])),
    solidBandsRelFeetM: profile(encFeet),
    deckAnsweredTicks: e.filter((x) => Number.isFinite(x.deckR)).length,
    onDeckTicks: e.filter((x) => x.onDeck).length,
    standingSpreadM: r6(Math.max(...e.map((x) => x.feetR))
      - Math.min(...e.map((x) => x.feetR))),
  };
  log.push(`ENCLOSED: deck top ${enclosed?.deckTopAboveFeetM} m above the feet, `
    + `port answered on ${enclosed?.deckAnsweredTicks} of ${e.length} ticks`);

  // --- get OFF the footprint, then walk back ON it -------------------------
  // The oscillation Reid describes is on a deck the player WALKED onto, which
  // is a different state from the one above: the step-up has run and `onDeck`
  // is true. Reaching it by walking is the only honest way to measure it.
  let off = false;
  for (let i = 0; i < 10 && !off; ++i) {
    await walkTape('back');
    off = topAlong(feet()) === null;
  }
  if (!off) return fail('never stepped off the footprint', { feet: feet() });
  await sleep(1.0);
  const besideFeet = feet();

  // Same yaw, level gaze. `back` walked away along -forward, so `forward` is
  // the way home; turning 180 first would walk further off and did.
  of.look(yaw0, -8);
  await sleep(0.3);
  let on = false;
  for (let i = 0; i < 12 && !on; ++i) {
    await walkTape('forward');
    on = of.world().player.onDeck === true;
  }
  if (!on) return fail('never walked back ONTO the deck', { feet: feet() });
  await sleep(1.2);                              // let the walk velocity decay

  // --- P1 and P2: STAND STILL AND WATCH ------------------------------------
  const standFeet = feet();
  const top = topAlong(standFeet);
  if (top === null) return fail('drifted off the deck before measuring');
  const standBands = profile(standFeet);
  of.stand(true);
  await sleep(5.0);
  const dump = of.stand();
  const s = dump.samples.filter((x) => Number.isFinite(x.feetR));
  if (s.length < 200) {
    return fail('trace too short', { total: dump.total, kept: s.length });
  }

  const feetRs = s.map((x) => x.feetR);
  const lo = Math.min(...feetRs), hi = Math.max(...feetRs);
  const spreadM = hi - lo;
  const sink = s.map((x) => top - x.feetR);
  const sorted = sink.slice().sort((a, b) => a - b);
  const p50 = sorted[Math.floor(sorted.length / 2)];
  const maxSink = sorted[sorted.length - 1];
  const minSink = sorted[0];

  // The oscillation itself: a tick whose feet rose by more than a tick of
  // gravity could ever raise them is a SNAP, not a settle.
  const gTick = 9.81 / 3600;                     // g * dt^2, one tick of fall
  const snaps = [];
  for (let i = 1; i < s.length; ++i) {
    const d = s[i].feetR - s[i - 1].feetR;
    if (d > gTick) snaps.push({ at: s[i].tick, riseM: r6(d) });
  }
  const periods = [];
  for (let i = 1; i < snaps.length; ++i) periods.push(snaps[i].at - snaps[i - 1].at);
  const meanPeriod = periods.length === 0 ? null
    : periods.reduce((a, b) => a + b, 0) / periods.length;

  // WHICH TWO AUTHORITIES ARE TAKING TURNS. Counted, not inferred.
  const onDeckTicks = s.filter((x) => x.onDeck).length;
  const deckSeen = s.filter((x) => Number.isFinite(x.deckR)).length;
  const deckWon = s.filter((x) => Number.isFinite(x.deckR)
    && Math.abs(x.groundR - x.deckR) < 1e-9).length;
  const terrainWon = s.filter((x) => Math.abs(x.groundR - x.terrainR) < 1e-9).length;
  // How far the structural answer sits below the deck's real top face: this is
  // the difference between "the floor is where the floor is" and "the floor is
  // wherever my feet got to".
  const deckErr = s.filter((x) => Number.isFinite(x.deckR)).map((x) => top - x.deckR);
  const deckErrMax = deckErr.length === 0 ? null : Math.max(...deckErr);

  const still = {
    ticks: s.length,
    deckTopR: r6(top),
    solidBandsRelFeetM: standBands,
    standingSpreadM: r6(spreadM),
    sinkP50M: r6(p50), sinkMaxM: r6(maxSink), sinkMinM: r6(minSink),
    snapUps: snaps.length,
    meanSnapPeriodTicks: meanPeriod === null ? null : r6(meanPeriod),
    biggestSnapM: snaps.length === 0 ? null
      : r6(Math.max(...snaps.map((x) => x.riseM))),
    onDeckTicks, deckSeenTicks: deckSeen, deckWonTicks: deckWon, terrainWonTicks: terrainWon,
    deckAnswerBelowTopMaxM: r6(deckErrMax),
    groundedTicks: s.filter((x) => x.grounded).length,
    speedMps: r6(of.world().player.speedMps),
  };
  log.push(`STILL: spread ${still.standingSpreadM} m over ${s.length} ticks, `
    + `${snaps.length} snap-ups, sink p50 ${still.sinkP50M} max ${still.sinkMaxM}`);

  // --- P3: THE NEGATIVE CONTROL --------------------------------------------
  // Beside the deck, not on it. The structural port must answer NOTHING and the
  // terrain must be what holds the player up. Without this, "the deck holds you
  // up" is satisfied by a port that holds everybody up everywhere.
  let beside = null;
  for (let i = 0; i < 16 && beside === null; ++i) {
    of.input.tape([{ hold: 16, actions: ['back'] }, { hold: 6, keys: [] }]);
    await sleep(0.6);
    if (topAlong(feet()) === null) {
      await sleep(1.0);
      of.stand(true);
      await sleep(1.5);
      const b = of.stand().samples.filter((x) => Number.isFinite(x.feetR));
      if (b.length > 40) {
        const anyDeck = b.filter((x) => Number.isFinite(x.deckR)).length;
        const anyOnDeck = b.filter((x) => x.onDeck).length;
        const terrainMatch = b.filter((x) =>
          Math.abs(x.groundR - x.terrainR) < 1e-9).length;
        beside = {
          ticks: b.length, deckAnsweredTicks: anyDeck, onDeckTicks: anyOnDeck,
          terrainHeldTicks: terrainMatch,
          feetOverDeck: topAlong(feet()) !== null,
          standingSpreadM: r6(Math.max(...b.map((x) => x.feetR))
            - Math.min(...b.map((x) => x.feetR))),
        };
      }
    }
  }
  if (beside === null) log.push('NEGATIVE CONTROL NOT REACHED: never stepped off');

  // --- P4: A DRIVEN WALK ACROSS THE DECK -----------------------------------
  of.stand(true);
  for (let i = 0; i < 6; ++i) {
    of.input.tape([{ hold: 20, actions: ['forward'] }, { hold: 4, keys: [] }]);
    await sleep(0.55);
  }
  const w = of.stand().samples.filter((x) => Number.isFinite(x.feetR));
  // Only the ticks where the radial actually passes through a part can say
  // anything about a deck, so the walk is scored on those and the count is
  // reported: a walk that never got on it would otherwise score a clean zero.
  const walkOn = w.filter((x) => x.grounded && Number.isFinite(x.deckR)
    && x.onDeck);
  const walkErr = walkOn.map((x) => Math.abs(x.feetR - x.deckR));
  const walkTops = walkOn.map((x) => Math.abs(x.feetR - topAlong(standFeet)));
  const walk = {
    ticks: w.length,
    onDeckTicks: walkOn.length,
    // If this is zero the structural answer IS the feet, which is a floor that
    // follows whoever stands on it rather than a floor.
    maxFeetVsDeckAnswerM: walkErr.length === 0 ? null : r6(Math.max(...walkErr)),
    // The honest one: the feet against the deck's OWN top face, which does not
    // move when the walker is wrong about it.
    maxFeetVsDeckTopM: walkTops.length === 0 ? null : r6(Math.max(...walkTops)),
    endedOverDeck: topAlong(feet()) !== null,
  };
  of.stand(false);

  // --- A RELOAD MUST NOT DROP THE PLAYER THROUGH THEIR OWN BASE ------------
  // A restore goes through the same `Structures.adopt` a placement does, so the
  // parts SHOULD reach the collision set. "Should" is how the last five of
  // these got shipped, so it is driven: save, throw the base away, restore, and
  // stand on it again.
  await of.save();
  const beforeParts = parts().length;
  await of.load();
  await sleep(0.6);
  // The walk above carried the player off the FAR side, so the way back is
  // `back`. Both directions are tried, because which side they ended on is not
  // something this probe should have to know.
  let backOn = of.world().player.onDeck === true;
  for (const act of ['back', 'forward']) {
    for (let i = 0; i < 8 && !backOn; ++i) {
      await walkTape(act);
      backOn = of.world().player.onDeck === true;
    }
  }
  await sleep(1.0);
  of.stand(true);
  await sleep(2.0);
  const rl = of.stand().samples.filter((x) => Number.isFinite(x.feetR));
  const rlTop = topAlong(feet());
  const reload = {
    partsBefore: beforeParts, partsAfter: parts().length,
    ticks: rl.length,
    onDeckTicks: rl.filter((x) => x.onDeck).length,
    deckAnsweredTicks: rl.filter((x) => Number.isFinite(x.deckR)).length,
    standingSpreadM: rl.length === 0 ? null
      : r6(Math.max(...rl.map((x) => x.feetR)) - Math.min(...rl.map((x) => x.feetR))),
    feetBelowDeckTopM: rlTop === null ? null
      : r6(rlTop - Math.hypot(feet()[0], feet()[1], feet()[2])),
  };
  of.stand(false);

  // --- THE ASSERTIONS ------------------------------------------------------
  // Every one of these is a PROPERTY. The two numeric bounds are derived and
  // not tuned: `gTick` is one tick of free fall (g * dt^2), which is the
  // deepest a correct floor can ever let a walker sink before the next tick
  // corrects it, and `MICRON` is "the same number every tick" expressed in a
  // unit nothing in this game can render or measure.
  const MICRON = 1e-6;
  const checks = [
    ['still: a stationary player on a static floor stands at a CONSTANT radius',
      still.standingSpreadM <= MICRON, still.standingSpreadM],
    ['still: no snap-ups at all with the player standing still',
      still.snapUps === 0, still.snapUps],
    ['still: the feet are never more than one tick of fall below the deck top',
      still.sinkMaxM <= gTick, still.sinkMaxM],
    ['still: the port answers the deck TOP FACE, not wherever the feet got to',
      still.deckAnswerBelowTopMaxM <= MICRON, still.deckAnswerBelowTopMaxM],
    ['enclosed: a foundation laid around the player seats them ON it',
      enclosed !== null && enclosed.deckAnsweredTicks === enclosed.ticks,
      `${enclosed?.deckAnsweredTicks}/${enclosed?.ticks}`],
    ['enclosed: and leaves no deck standing above their feet',
      enclosed !== null && enclosed.deckTopAboveFeetM <= gTick,
      enclosed?.deckTopAboveFeetM],
    ['NEGATIVE CONTROL beside: the structural port answers nothing',
      beside !== null && beside.deckAnsweredTicks === 0 && beside.onDeckTicks === 0,
      `${beside?.deckAnsweredTicks} deck / ${beside?.onDeckTicks} onDeck`],
    ['NEGATIVE CONTROL beside: the TERRAIN is what holds the player up',
      beside !== null && beside.terrainHeldTicks === beside.ticks,
      `${beside?.terrainHeldTicks}/${beside?.ticks}`],
    ['walk: the feet stay on the deck top across a driven crossing',
      walk.onDeckTicks > 20 && walk.maxFeetVsDeckTopM <= gTick,
      `${walk.onDeckTicks} ticks, worst ${walk.maxFeetVsDeckTopM}`],
    ['reload: a restored base still holds the player up',
      reload.onDeckTicks === reload.ticks && reload.partsAfter === reload.partsBefore,
      `${reload.onDeckTicks}/${reload.ticks}, ${reload.partsAfter} parts`],
    ['reload: and holds them at its own top face',
      reload.feetBelowDeckTopM !== null && Math.abs(reload.feetBelowDeckTopM) <= gTick,
      reload.feetBelowDeckTopM],
    ['the first structural step rung still clears the shipped deck',
      (of.stepUpM?.[0] ?? -1) > M.deckH,
      `${of.stepUpM?.[0]} > ${M.deckH}`],
  ];
  const failed = checks.filter((c) => !c[1]).map((c) => `${c[0]}  [${c[2]}]`);

  return {
    valid: failed.length === 0,
    failed,
    checked: checks.length,
    gravityTickM: r6(gTick),
    parts: parts().length,
    besideFeetR: r6(Math.hypot(besideFeet[0], besideFeet[1], besideFeet[2])),
    enclosed, reload,
    // A player climbs onto their own foundation with the FIRST structural step
    // rung, so that rung has to clear a deck. Both numbers are read from what
    // ships (`deckH` off the .glb, the rung off the walker), never typed here,
    // so a module that outgrew the step would fail this rather than quietly
    // becoming unclimbable.
    stepClearsDeck: {
      deckH: r6(M.deckH), firstRungM: r6(of.stepUpM?.[0] ?? Number.NaN),
      ok: (of.stepUpM?.[0] ?? -1) > M.deckH,
    },
    module: { cellM: r6(M.cellM), deckH: r6(M.deckH), storey: r6(M.storey) },
    still, beside, walk,
    // The first twenty ticks of the still window, so the SHAPE of the cycle is
    // in the report and not only its summary statistics.
    head: s.slice(0, 20).map((x) => ({
      t: x.tick, feet: r6(x.feetR), terrain: r6(x.terrainR),
      deck: r6(x.deckR), ground: r6(x.groundR), fall: r6(x.fallM),
      onDeck: x.onDeck, grounded: x.grounded,
    })),
    log,
  };
})()
