// W6 MOMENTS probe: the two anticlimaxes, and the sound.
//
// THE FELLED MOMENT has to be driven by real swings. `of.harvest(i)` reaches
// gameplay.h directly and deliberately skips the swing, the impact frame and
// therefore the whole reaction, so a probe that used it would prove the NUMBER
// reached zero and nothing about the moment. Every swing below is the E key,
// landing on the authored impact frame, exactly as a player's does.
//
// THE COLLAPSE IS SAMPLED WHILE IT IS HAPPENING. `felled` alone would only say
// the event fired; `collapsing` counts nodes whose collapse is mid-flight, so
// catching it above zero is evidence the motion actually ran rather than
// snapping to its end pose in one frame.
//
// THE SOUND IS RENDERED, NOT COUNTED. Headless Chrome has had no user gesture,
// so the live AudioContext is legitimately blocked and every play is a no-op;
// counting those would be counting nothing. `of.audioRender()` instead runs the
// SAME synth functions through an OfflineAudioContext, which no autoplay policy
// blocks, and measures the waveform. A voice that produces silence fails here,
// which is exactly the failure a play counter would hide (DW-20).
(async () => {
  const of = window.__of;
  const sleep = (n) => of.run(n);
  const log = [];
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
  const eye = () => { const o = of.aim().origin; return { x: o[0], y: o[1], z: o[2] }; };

  await sleep(0.5);

  // --- 1. THE SOUND ---------------------------------------------------------
  const unlocked = of.audio('unlock');
  const rendered = await of.audioRender();
  const voices = rendered.voices ?? {};
  // A voice is real if it moved the waveform at all. The threshold is generous
  // on purpose: this asserts "audible", not "loud", and the mix is set by the
  // master gain, not by any one voice.
  const silent = Object.entries(voices).filter(([, v]) => v.peak < 0.01).map(([k]) => k);
  log.push(`rendered ${Object.keys(voices).length} voices, ${silent.length} silent`);

  // Mute is a real toggle with real state, so it is asserted rather than assumed.
  const muted = of.audio('mute').muted;
  const unmuted = of.audio('unmute').muted;

  // --- 2. THE FELLED MOMENT -------------------------------------------------
  // A TREE, because the tree collapse is the topple and the rock collapse is
  // the sink, and the topple is the one that reads at a distance.
  let node = of.nodes().find((n) => n.kind === 0 && n.remaining > 0);
  if (node === undefined) return { fail: 'no tree in the clearing', log };

  const miss = () => {
    const a = of.aim();
    const e = { x: a.origin[0], y: a.origin[1], z: a.origin[2] };
    const v = { x: node.x - e.x, y: node.y - e.y, z: node.z - e.z };
    const t = v.x * a.dir[0] + v.y * a.dir[1] + v.z * a.dir[2];
    // +Infinity BEHIND the eye: a heading 180 degrees wrong otherwise scores as
    // well as the right one, because perpendicular distance to a LINE does not
    // care which way along it the target lies. That defect was found in this
    // harness before it was found in anything else.
    if (t <= 0) return Infinity;
    return Math.hypot(v.x - a.dir[0] * t, v.y - a.dir[1] * t, v.z - a.dir[2] * t);
  };
  const aimAt = (pitch) => {
    let best = of.world().observer.yawDeg;
    for (const step of [20, 5, 1.5, 0.5]) {
      const span = step === 20 ? 9 : 5;
      let bestMiss = Infinity;
      let bestYaw = best;
      for (let k = -span; k <= span; ++k) {
        of.look(best + k * step, pitch);
        const m = miss();
        if (m < bestMiss) { bestMiss = m; bestYaw = best + k * step; }
      }
      best = bestYaw;
    }
    of.look(best, pitch);
    return best;
  };
  aimAt(-4);

  let walked = 0;
  let best = dist(eye(), node);
  let worse = 0;
  for (let i = 0; i < 40; ++i) {
    node = of.nodes().find((n) => n.index === node.index);
    const d = dist(eye(), node);
    if (d < 5.0) break;
    if (d < best - 0.05) { best = d; worse = 0; }
    else if (++worse >= 2) { aimAt(-4); worse = 0; }
    of.input.tape([{ hold: 60, keys: ['KeyW'] }]);
    await sleep(1.1);
    walked++;
  }
  of.input.tape([{ hold: 2, keys: [] }]);
  await sleep(0.2);

  // Find the pitch that actually puts the tree under the crosshair: the reach
  // check is against the node's SURFACE, and Interact only swings at what it is
  // aiming at, so "in range" and "targeted" are two different things.
  let targeted = null;
  for (const p of [-2, -6, 2, -10, 6, -14, 10]) {
    aimAt(p);
    await sleep(0.1);
    const t = of.game().interact.target;
    if (t !== null && t.index === node.index && !t.empty) { targeted = p; break; }
  }
  if (targeted === null) {
    return { fail: 'no pitch put the tree under the crosshair',
             distance: dist(eye(), node), target: of.game().interact.target, log };
  }
  log.push(`walked ${walked} bursts, targeting at pitch ${targeted}, `
    + `${dist(eye(), node).toFixed(2)} m`);

  // --- swing until the node is empty, watching for the collapse -------------
  const felled0 = of.game().fx.felled;
  const banners0 = of.game().fx.banners;
  const spawned0 = of.game().fx.debrisSpawned;
  let collapsingSeen = 0;
  let swings = 0;
  let emptyAt = -1;
  for (let i = 0; i < 12 && emptyAt < 0; ++i) {
    // One press, then the cooldown. Holding E would swing continuously, but a
    // discrete press per iteration is what makes "swings" a count and not a
    // guess.
    of.input.tape([{ hold: 4, keys: ['KeyE'] }, { hold: 40, keys: [] }]);
    swings++;
    // POLLED IN SMALL STEPS, not slept through. The collapse settles in 0.9 s of
    // effects time and the effects clock runs at the render rate, so a single
    // 0.8 s sleep steps clean over the whole motion and reports a peak of zero:
    // it did that on the first run of this probe, which is a harness defect and
    // not a missing animation.
    for (let k = 0; k < 16; ++k) {
      await sleep(0.05);
      collapsingSeen = Math.max(collapsingSeen, of.game().nodes.collapsing);
      const st = of.nodes().find((n) => n.index === node.index);
      if (st !== undefined && st.remaining <= 0 && emptyAt < 0) emptyAt = swings;
    }
  }
  const g = of.game();
  const after = of.nodes().find((n) => n.index === node.index);
  log.push(`${swings} swings, node ${after?.remaining ?? '?'} left, `
    + `felled ${g.fx.felled}, collapsing peak ${collapsingSeen}`);

  // Hold on the felled node for the capture, then let it settle.
  aimAt(targeted);
  await sleep(0.3);

  return {
    advanced: {
      swings, emptyAt,
      grants: g.interact.grants,
      tick: of.world().tick,
    },
    felled: {
      nodeRemaining: after?.remaining ?? null,
      count: g.fx.felled - felled0,
      fieldFelled: g.nodes.felled,
      collapsingPeak: collapsingSeen,
      banners: g.fx.banners - banners0,
      debrisSpawned: g.fx.debrisSpawned - spawned0,
    },
    audio: {
      unlocked: unlocked.unlocked,
      state: unlocked.state,
      supported: rendered.supported,
      voices,
      silent,
      muteToggles: { muted, unmuted },
      live: g.audio,
    },
    valid:
      // the swings happened and the node emptied because of them
      swings > 0 && g.interact.grants >= swings && emptyAt > 0
      && (after?.remaining ?? 1) <= 0
      // the felled moment fired exactly once, and the motion was caught RUNNING
      && g.fx.felled - felled0 === 1
      && collapsingSeen >= 1
      && g.fx.banners - banners0 >= 1
      // the burst was heavier than a normal swing's 8 to 22 chips
      && g.fx.debrisSpawned - spawned0 >= 44
      // and every synthesised voice actually produces a waveform
      && rendered.supported === true
      && Object.keys(voices).length >= 7 && silent.length === 0
      && muted === true && unmuted === false,
    cost: { drawCalls: of.stats().draw.calls, frameMs: of.stats().frame?.p50 ?? null },
    nodes: g.nodes,
    log,
  };
})()
