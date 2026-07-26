// W5 harvest probe. DRIVEN, per standing rule 3 and DW-20: it turns with the
// same look() a mouse drives, walks with a real KeyW tape and harvests with a
// real KeyE tape, and it refuses to report success unless it can show the
// simulation moved.
//
// PROOF OF ADVANCE, asserted rather than assumed:
//   ticks      the fixed clock advanced (headless Chrome throttles rAF)
//   metres     the capsule actually travelled to the node
//   grants     harvestNode granted, on the impact frame, more than once
//   depletion  the node's RemainingAmount FELL by exactly what the pack GAINED
// If any of those is zero the probe fails loudly, because the W4 scatter that
// rejected every chunk on the planet also reported success.
(async () => {
  const of = window.__of;
  const sleep = (n) => of.run(n);
  const V = (a) => Math.hypot(a[0], a[1], a[2]);
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const norm = (a) => { const l = V(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const feet = () => {
    const w = of.world();
    return w.player.aim.origin;
  };

  await sleep(0.5);
  const t0 = of.world().tick;
  const p0 = feet();
  const before = of.nodes();
  if (before.length === 0) return { fail: 'no nodes were placed' };

  // Every node must sit ON the ground the player walks on. A node snapped to the
  // RAW heightfield instead of the oracle would be kilometres out, and this is
  // the cheapest place to catch that.
  // Every node must sit within the planet's relief band of the player's own
  // ground radius. A node snapped to the RAW heightfield rather than the oracle
  // would be hundreds of metres to kilometres out, which this catches; it is a
  // sanity band, not a per-node surface check, because the terrain under a
  // 50 m clearing genuinely varies.
  const groundR = of.world().bodyRadiusM + of.world().surfaceHeightM;
  const surfaceErrs = before.map((n) => Math.abs(Math.hypot(n.x, n.y, n.z) - groundR));

  const target = before[0];
  const log = [];

  // --- turn to face it, by sweeping the SAME look() a mouse drives ----------
  const faceIt = () => {
    const eye = feet();
    const want = norm(sub([target.x, target.y, target.z], eye));
    let bestYaw = 0, bestDot = -2;
    const st = of.world().observer;
    for (let a = 0; a < 360; a += 6) {
      of.look(a, st.pitchDeg);
      const d = of.aim().dir;
      const k = dot(d, want);
      if (k > bestDot) { bestDot = k; bestYaw = a; }
    }
    // Pitch: the same sweep, now that yaw is right.
    let bestPitch = 0; bestDot = -2;
    for (let p = -40; p <= 20; p += 2) {
      of.look(bestYaw, p);
      const d = of.aim().dir;
      const k = dot(d, want);
      if (k > bestDot) { bestDot = k; bestPitch = p; }
    }
    of.look(bestYaw, bestPitch);
    return { bestYaw, bestPitch, bestDot };
  };
  const aimed = faceIt();
  log.push(`aimed yaw ${aimed.bestYaw} pitch ${aimed.bestPitch} dot ${aimed.bestDot.toFixed(4)}`);

  // --- walk to it with a real tape, re-aiming as we close ------------------
  let walked = 0;
  for (let i = 0; i < 14; ++i) {
    const d = of.nodes().find((n) => n.index === target.index).distanceM;
    if (d < 3.2) break;
    faceIt();
    const a = feet();
    of.input.tape([{ hold: 26, keys: ['KeyW'] }]);
    await sleep(0.55);
    walked += V(sub(feet(), a));
  }
  const distAfterWalk = of.nodes().find((n) => n.index === target.index).distanceM;
  log.push(`walked ${walked.toFixed(1)} m, now ${distAfterWalk.toFixed(2)} m from the node`);

  faceIt();
  await sleep(0.2);
  const acquired = of.game().interact.target;

  // --- swing: hold the mine key long enough for several full clips ---------
  const nodeBefore = of.nodes().find((n) => n.index === target.index);
  of.input.tape([
    { hold: 6, keys: ['KeyE'] }, { hold: 32, keys: [] },
    { hold: 6, keys: ['KeyE'] }, { hold: 32, keys: [] },
    { hold: 6, keys: ['KeyE'] }, { hold: 32, keys: [] },
    { hold: 6, keys: ['KeyE'] }, { hold: 32, keys: [] },
  ]);
  await sleep(3.2);
  const g = of.game();
  const nodeAfter = of.nodes().find((n) => n.index === target.index);
  const carried = g.carried.reduce((a, c) => a + c.count, 0);

  const ticks = of.world().tick - t0;
  const moved = V(sub(feet(), p0));
  const depleted = nodeBefore.remaining - nodeAfter.remaining;

  return {
    // --- the DW-20 proof-of-advance block, first so it cannot be skimmed ---
    advanced: {
      ticks,
      metresWalked: +moved.toFixed(2),
      swings: g.interact.swings,
      grants: g.interact.grants,
      unitsGranted: g.interact.granted,
      nodeDepletedBy: +depleted.toFixed(3),
      // The whole point: the pack gained exactly what the node lost.
      conserved: Math.abs(depleted - g.interact.granted) < 1e-9,
    },
    valid: ticks > 200 && moved > 3 && Math.max(...surfaceErrs) < 120
      && g.interact.grants >= 3
      && g.interact.granted > 0 && depleted > 0
      && Math.abs(depleted - g.interact.granted) < 1e-9,
    target: {
      index: target.index, name: target.name,
      startDistM: +target.distanceM.toFixed(2),
      endDistM: +nodeAfter.distanceM.toFixed(2),
      fractionBefore: +nodeBefore.fraction.toFixed(3),
      fractionAfter: +nodeAfter.fraction.toFixed(3),
    },
    aimAcquired: acquired,
    nodes: {
      placed: before.length,
      maxRadiusSpreadM: +Math.max(...surfaceErrs).toFixed(2),
      onOracleSurface: Math.max(...surfaceErrs) < 120,
    },
    carried: g.carried,
    carriedTotal: carried,
    last: g.interact.last,
    log,
  };
})()
