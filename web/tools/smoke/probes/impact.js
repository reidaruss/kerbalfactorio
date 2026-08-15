// W6 impact probe. DRIVEN, and it refuses to trust a call that returned.
//
// THE SWING IS `use`, the left mouse button, asked for by ACTION rather than by
// key (Bindings.ts). The hotbar starts on slot 1, the bare hand, and the bare
// hand is what makes a click a swing instead of a placement.
//
// THE FAILURE THIS IS WRITTEN AGAINST. The first pass at a harvest probe swept
// 60 yaw candidates, kept the best of them, and reported success on a dot of
// 0.414 after walking 41 m in the wrong direction. A best-of-a-bad-set is not a
// measurement. So the aim quality is ASSERTED (dot > 0.9), the approach is
// ASSERTED to have closed the distance, and the node under the crosshair is
// ASSERTED to be the node we chose, all before a single swing is thrown.
//
// PROOF OF ADVANCE (DW-20), asserted rather than assumed:
//   ticks       the fixed clock moved
//   closed      the distance to the target FELL and ended inside reach
//   aimDot      the crosshair is actually on the node, not near it
//   grants      one grant per swing, on the impact frame
//   conserved   the node lost exactly what the pack gained
//   feedback    debris spawned, the gain read out, the camera kicked
//   aimRestored the camera kick summed to zero: the aim ended where it started
//
//   node tools/smoke/run.mjs --scenario=walk \
//        --evalfile=tools/smoke/probes/impact.js
(async (A) => {
  const of = window.__of;
  const sleep = (n) => of.run(n);
  const V = (a) => Math.hypot(a[0], a[1], a[2]);
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const norm = (a) => { const l = V(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const eye = () => of.world().player.aim.origin;
  const wantKind = A.kind ?? null;
  const log = [];

  await sleep(0.5);
  const t0 = of.world().tick;
  const all = of.nodes();
  if (all.length === 0) return { fail: 'no nodes were placed' };
  const pool = wantKind === null ? all : all.filter((n) => n.kind === wantKind);
  if (pool.length === 0) return { fail: `no node of kind ${wantKind}`, kinds: all.map((n) => n.kind) };
  const target = pool[0];
  const nodeOf = (i) => of.nodes().find((n) => n.index === i);

  // --- aim: sweep coarse then fine, and REPORT the dot we actually achieved --
  const faceIt = () => {
    const e = eye();
    const want = norm(sub([target.x, target.y, target.z], e));
    let bestYaw = 0, best = -2;
    for (let a = 0; a < 360; a += 4) {
      of.look(a, of.world().observer.pitchDeg);
      const k = dot(of.aim().dir, want);
      if (k > best) { best = k; bestYaw = a; }
    }
    for (let a = bestYaw - 4; a <= bestYaw + 4; a += 0.5) {
      of.look(a, of.world().observer.pitchDeg);
      const k = dot(of.aim().dir, want);
      if (k > best) { best = k; bestYaw = a; }
    }
    let bestPitch = of.world().observer.pitchDeg;
    for (let p = -45; p <= 25; p += 1) {
      of.look(bestYaw, p);
      const k = dot(of.aim().dir, want);
      if (k > best) { best = k; bestPitch = p; }
    }
    of.look(bestYaw, bestPitch);
    return { yaw: bestYaw, pitch: bestPitch, dot: best };
  };

  // --- approach: walk until the node is comfortably inside the 4 m reach -----
  const startDist = target.distanceM;
  let walked = 0;
  let aimed = faceIt();
  for (let i = 0; i < 22; ++i) {
    if (nodeOf(target.index).distanceM < 3.4) break;
    aimed = faceIt();
    const a = eye();
    of.input.tape([{ hold: 22, keys: ['KeyW'] }]);
    await sleep(0.45);
    walked += V(sub(eye(), a));
    const w = of.world().player;
    log.push(`walk ${i}: d=${nodeOf(target.index).distanceM.toFixed(2)} grounded=${w.grounded} blockedByRock=${w.blockedByRock} slopeCos=${w.slopeCos.toFixed(3)} speed=${w.speedMps.toFixed(2)}`);
  }
  // CREEP. The pick reach is 4 m along the ray from the EYE, and a tree's origin
  // is on the ground 1.6 m below it, so "close enough to see" and "close enough
  // to hit" differ by the better part of a metre. Short taps, checking what is
  // actually under the crosshair after each, is the only honest way to end this
  // phase: a fixed distance threshold is a guess about the pick, not a test of it.
  for (let i = 0; i < 24; ++i) {
    aimed = faceIt();
    await sleep(0.08);
    const t = of.game().interact.target;
    if (t !== null && t.index === target.index) { log.push(`creep ${i}: acquired`); break; }
    const a = eye();
    of.input.tape([{ hold: 5, keys: ['KeyW'] }]);
    await sleep(0.16);
    walked += V(sub(eye(), a));
  }
  aimed = faceIt();
  await sleep(0.25);
  const endDist = nodeOf(target.index).distanceM;
  log.push(`walked ${walked.toFixed(1)} m, ${startDist.toFixed(2)} -> ${endDist.toFixed(2)} m, dot ${aimed.dot.toFixed(4)}`);

  const acquired = of.game().interact.target;
  const onTarget = acquired !== null && acquired.index === target.index;

  // --- three full swings, with the aim restored in between ------------------
  const pitchBefore = of.world().observer.pitchDeg;
  const before = nodeOf(target.index);
  const fx0 = of.game().fx;
  const packOf = (g) => g.carried.reduce((a, c) => a + c.count, 0);
  const pack0 = packOf(of.game());
  of.input.tape([
    { hold: 6, actions: ['use'] }, { hold: 34, keys: [] },
    { hold: 6, actions: ['use'] }, { hold: 34, keys: [] },
    { hold: 6, actions: ['use'] }, { hold: 34, keys: [] },
  ]);
  await sleep(2.2);
  const pitchAfter = of.world().observer.pitchDeg;
  const mid = of.game();
  const nodeMid = nodeOf(target.index);

  // --- one more swing, timed so the capture lands ON the impact -------------
  // The grant fires on frame 17 of the 33-frame clip, so running 22 ticks puts
  // the screenshot a few frames after the chips left the node and while the
  // readout is still on screen. This is what W6_harvest_impact.png shows.
  of.input.tape([{ hold: 6, actions: ['use'] }, { hold: 40, keys: [] }]);
  await sleep(22 / 60);
  const g = of.game();
  const nodeAfter = nodeOf(target.index);

  const ticks = of.world().tick - t0;
  const depleted = before.remaining - nodeMid.remaining;
  const gained = packOf(mid) - pack0;
  const fx = g.fx;

  return {
    advanced: {
      ticks,
      metresWalked: +walked.toFixed(2),
      closedBy: +(startDist - endDist).toFixed(2),
      endDistM: +endDist.toFixed(2),
      aimDot: +aimed.dot.toFixed(4),
      onTarget,
      swings: g.interact.swings,
      grants: g.interact.grants,
      unitsGranted: g.interact.granted,
      nodeDepletedBy: +depleted.toFixed(3),
      packGainedBy: gained,
      // The node lost exactly what the pack gained. The one legitimate
      // exception is the LAST swing on a node, where /core rounds a sub-unit
      // remainder up to a whole item; that cannot happen here because the node
      // is still well above empty at this point.
      conserved: Math.abs(depleted - gained) < 1e-9,
    },
    feedback: {
      debrisSpawned: fx.debrisSpawned - fx0.debrisSpawned,
      debrisLiveAtCapture: fx.debrisLive,
      gains: fx.gains - fx0.gains,
      kickTicks: fx.kickTicks - fx0.kickTicks,
      pitchBefore: +pitchBefore.toFixed(6),
      pitchAfterKicks: +pitchAfter.toFixed(6),
      aimRestored: Math.abs(pitchAfter - pitchBefore) < 1e-6,
    },
    pacing: {
      // Balance, measured in the browser: swings to clear THIS node, from the
      // yield /core chose for it and the node's own initial amount.
      initial: +before.initial.toFixed(2),
      perSwing: g.interact.last === null ? 0 : g.interact.last.granted,
      usedTool: g.interact.last === null ? false : g.interact.last.usedTool,
      swingsToClear: g.interact.last === null || g.interact.last.granted === 0
        ? null : Math.ceil(before.initial / g.interact.last.granted),
    },
    // `onTarget` is the reach test, not a distance threshold: the pick decides
    // what is hittable and a hard-coded metre count would only be a second
    // opinion about it. What is asserted is that the walk CLOSED the gap and
    // that the node under the crosshair is the one we chose.
    valid: ticks > 200 && walked > 1 && endDist < startDist
      && aimed.dot > 0.9 && onTarget
      && g.interact.grants === g.interact.swings && g.interact.grants >= 4
      && depleted > 0 && Math.abs(depleted - gained) < 1e-9
      && (fx.debrisSpawned - fx0.debrisSpawned) >= 24
      && fx.debrisLive > 0
      && (fx.gains - fx0.gains) === g.interact.grants
      && (fx.kickTicks - fx0.kickTicks) >= 30
      && Math.abs(pitchAfter - pitchBefore) < 1e-6,
    target: {
      index: target.index, name: target.name, kind: target.kind,
      fractionBefore: +before.fraction.toFixed(3),
      fractionAfter: +nodeAfter.fraction.toFixed(3),
    },
    draws: of.stats().calls,
    nodesStat: g.nodes,
    carried: g.carried,
    last: g.interact.last,
    log,
  };
})(OF_ARGS)
