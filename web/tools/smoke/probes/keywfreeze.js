// GP-790. THE KeyW FREEZE, MEASURED IN WALL CLOCK, IN TICKS AND IN METRES AT ONCE.
//
//   node tools/smoke/run.mjs --url=http://127.0.0.1:PORT/ --scenario=walk \
//     --evalfile=tools/smoke/probes/keywfreeze.js --evalargs='{"secs":25}'
//
// THE SYMPTOM AS REPORTED, and it is the whole written record of it: "a
// reproducible ~500-frame player-movement freeze on KeyW (walking forward)".
// That sentence is consistent with three different faults that want opposite
// fixes, so this probe measures all three at once rather than picking one.
//
//   (A) A MAIN-THREAD STALL. Frames stop being presented. Signature: one or a
//       few enormous gaps between consecutive requestAnimationFrame callbacks.
//   (B) A SIM STALL WITH A LIVE RENDER LOOP. Frames keep arriving and the fixed
//       tick does not keep up. `Loop.frame` runs at most MAX_CATCHUP = 5 ticks
//       per frame and then DISCARDS the backlog (`this.acc = 0`), so a run of
//       expensive frames silently throws sim time away and the player crawls or
//       stops while the picture keeps moving. This is GP-726's trap living in
//       the engine rather than in a probe.
//   (C) A COLLISION FREEZE. Frames and ticks are both healthy and the walker
//       simply does not advance, the STATUS.md 2026-07-26 shape (voxel rock
//       proud of the walkable surface pushing the walker back as far as it
//       stepped).
//
// So every frame records THREE numbers, not one: the wall clock, the loop's own
// tick index, and the player's feet. (A) is a gap in the first, (B) is the
// second falling behind the first, (C) is the third flat while the other two
// are healthy.
//
// THE CONTROL IS THE POINT, and it is here because of this project's own
// instrument-trap record. `Loop.run()`'s docstring says in as many words that
// "headless Chrome does not pump requestAnimationFrame continuously": a driven
// walk once advanced 90 ticks in 20 s because rAF fired in a burst and stopped.
// A real-time rAF measurement in a headless browser can therefore produce a
// multi-second "freeze" with nothing whatsoever wrong with the game. So every
// pass runs TWICE against the same instrument: once with KeyW held and once
// with NOTHING held. A gap that appears in both is the browser. Only a gap that
// appears with the key held and not without it is a finding.
//
// THE INSTRUMENT PRICES ITSELF. `of.world()` is not free (a surface-height and
// a biome lookup per call), and an instrument that costs more than the defect
// it is hunting invents its own stalls. So the time spent inside the recorder's
// own callback is measured per frame and published as `probeMs`, and the idle
// control pays exactly the same toll, which is what makes the pair a control at
// all. Arrays are preallocated; nothing allocates inside the callback.
(async () => {
  const of = window.__of;
  const A = (typeof OF_ARGS === 'object' && OF_ARGS !== null) ? OF_ARGS : {};
  const secs = A.secs ?? 20;
  const capFrames = A.capFrames ?? 60000;
  // A frame that took longer than this is a candidate stall. 100 ms is six
  // frames at 60 Hz and well outside any healthy cadence including a vsync miss.
  const STALL_MS = A.stallMs ?? 100;

  const yield0 = () => new Promise((r) => { setTimeout(r, 0); });
  const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });
  const posOf = (w) => [w.eyeRel[0] + w.origin.x, w.eyeRel[1] + w.origin.y,
    w.eyeRel[2] + w.origin.z];
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  const pct = (sorted, p) => (sorted.length === 0 ? null
    : +sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))].toFixed(2));

  // ---------------------------------------------------------------------------
  // THE RECORDER. Returns a pass record; allocates nothing per frame.
  // ---------------------------------------------------------------------------
  const record = async (label, keys, secs) => {
    const t = new Float64Array(capFrames);   // performance.now() at frame start
    const cost = new Float64Array(capFrames); // ms spent inside this callback
    const tick = new Float64Array(capFrames);
    const px = new Float64Array(capFrames);
    const py = new Float64Array(capFrames);
    const pz = new Float64Array(capFrames);
    const pend = new Float64Array(capFrames);
    const resid = new Float64Array(capFrames);
    // The floating-origin rebase counter, per frame. A rebase re-derives every
    // world-anchored object from its 64-bit anchor and world-gen.md records that
    // a chunk is only re-placed "when it is next rebuilt, at one chunk per
    // frame". With ~324 resident chunks that is a several-hundred-FRAME event by
    // construction, which is the right order of magnitude for the symptom, so
    // whether the worst frames land on a rebase is a question worth being able
    // to answer rather than argue about.
    const reb = new Float64Array(capFrames);
    let n = 0;
    const longTasks = [];
    let obs = null;
    try {
      obs = new PerformanceObserver((list) => {
        for (const e of list.getEntries()) {
          if (longTasks.length < 4000) longTasks.push([e.startTime, e.duration]);
        }
      });
      obs.observe({ entryTypes: ['longtask'] });
    } catch { obs = null; }

    // Hold the key for far longer than the pass, so the tape can never run out
    // and turn the tail of the measurement into a standing player BY DESIGN.
    of.input.tape([{ hold: Math.ceil(secs * 600), keys }]);

    const w0 = of.world();
    const t0 = performance.now();
    // A LIVE EPISODE CATCHER, not a post-hoc one. Whether the walker is blocked
    // by rock, by a structure, by a build ghost or by nothing at all is state
    // that is GONE by the time the arrays are reduced, and it is the whole
    // difference between "the walker is stuck on something" and "the frame
    // stopped arriving". So the moment a still run crosses SNAP_FRAMES, take one
    // snapshot of the reasons the client already publishes. Bounded, and it
    // allocates once per episode rather than once per frame.
    const SNAP_FRAMES = A.snapFrames ?? 45;
    const episodes = [];
    let stillFrom = 0;
    let snapped = false;
    const done = new Promise((resolve) => {
      const step = () => {
        const now = performance.now();
        if (n >= capFrames) { resolve(); return; }
        t[n] = now;
        const w = of.world();
        tick[n] = w.tick;
        const f = w.player === null ? [0, 0, 0] : w.player.feet;
        px[n] = f[0]; py[n] = f[1]; pz[n] = f[2];
        pend[n] = w.chunks.pending; resid[n] = w.chunks.resident;
        reb[n] = w.origin.rebases;
        if (n > 0) {
          const moved = Math.hypot(px[n] - px[stillFrom], py[n] - py[stillFrom],
            pz[n] - pz[stillFrom]) > 1e-3;
          if (moved) { stillFrom = n; snapped = false; }
          else if (!snapped && n - stillFrom >= SNAP_FRAMES && episodes.length < 12) {
            snapped = true;
            const p = w.player;
            episodes.push({
              startFrame: stillFrom,
              atMs: +(t[stillFrom] - t[0]).toFixed(1),
              framesSoFar: n - stillFrom,
              ticksSoFar: tick[n] - tick[stillFrom],
              msSoFar: +(t[n] - t[stillFrom]).toFixed(1),
              player: p === null ? null : {
                mode: p.mode, grounded: p.grounded,
                speedMps: +p.speedMps.toFixed(3), slopeCos: +p.slopeCos.toFixed(3),
                underRock: p.underRock, blockedByRock: p.blockedByRock,
                voxelPushM: +p.voxelPushM.toFixed(3),
                onDeck: p.onDeck, blockedByBuild: p.blockedByBuild,
                structureTests: p.structureTests,
              },
              chunks: w.chunks, altM: +w.altM.toFixed(2), biome: w.biome,
              lat: +w.observer.latDeg.toFixed(5), lon: +w.observer.lonDeg.toFixed(5),
              rebases: w.origin.rebases,
            });
          }
        }
        cost[n] = performance.now() - now;
        n++;
        if (now - t0 >= secs * 1000) { resolve(); return; }
        requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
    await done;
    const wallMs = performance.now() - t0;
    const w1 = of.world();
    if (obs !== null) obs.disconnect();
    of.input.tape([{ hold: 4, keys: [] }]);
    await yield0();

    // ---- reduce --------------------------------------------------------------
    const gaps = [];
    const sortedGap = [];
    const sortedCost = [];
    const gapRow = (i) => ({
      frame: i,
      atMs: +(t[i - 1] - t[0]).toFixed(1),
      gapMs: +(t[i] - t[i - 1]).toFixed(1),
      probeMs: +cost[i - 1].toFixed(2),
      ticks: tick[i] - tick[i - 1],
      movedM: +Math.hypot(px[i] - px[i - 1], py[i] - py[i - 1], pz[i] - pz[i - 1]).toFixed(3),
      pending: pend[i], resident: resid[i],
      rebases: reb[i], rebasedHere: reb[i] - reb[i - 1],
    });
    let maxGap = 0, maxGapAt = -1, sumGap = 0;
    let maxCost = 0, sumCost = 0;
    let ticksSkippedFrames = 0;   // frames where the catch-up clamp bit
    for (let i = 1; i < n; ++i) {
      const g = t[i] - t[i - 1];
      sumGap += g; sortedGap.push(g);
      sumCost += cost[i]; sortedCost.push(cost[i]);
      if (cost[i] > maxCost) maxCost = cost[i];
      if (g > maxGap) { maxGap = g; maxGapAt = i; }
      // MAX_CATCHUP = 5 in Loop.ts. A frame that advanced exactly five ticks is
      // a frame that hit the clamp, and every tick of the backlog beyond it was
      // thrown away.
      if (tick[i] - tick[i - 1] >= 5) ticksSkippedFrames++;
      if (g >= STALL_MS && gaps.length < 60) gaps.push(gapRow(i));
    }
    sortedGap.sort((a, b) => a - b);
    sortedCost.sort((a, b) => a - b);
    // THE TEN WORST FRAMES WHETHER OR NOT ANY CROSSED THE THRESHOLD. A run with
    // no stall over 100 ms still has a worst frame, and its shape (did the sim
    // catch up, was a chunk pending, did the feet move) is what says whether the
    // machine is merely fast enough to hide the defect.
    const order = [];
    for (let i = 1; i < n; ++i) order.push(i);
    order.sort((a, b) => (t[b] - t[b - 1]) - (t[a] - t[a - 1]));
    const worst = order.slice(0, 10).map(gapRow);
    // EVERY REBASE, AND THE 600 FRAMES AFTER IT, against the pass's own median.
    // If the rebase is the event, this window is where its cost lives; if it is
    // not, this is the negative result stated in numbers rather than asserted.
    const rebaseWindows = [];
    for (let i = 1; i < n && rebaseWindows.length < 12; ++i) {
      if (reb[i] === reb[i - 1]) continue;
      const end = Math.min(n - 1, i + 600);
      let wMax = 0, wSum = 0, wStill = 0, run = 0;
      for (let j = i; j <= end; ++j) {
        const g = t[j] - t[j - 1];
        wSum += g; if (g > wMax) wMax = g;
        const moved = Math.hypot(px[j] - px[j - 1], py[j] - py[j - 1], pz[j] - pz[j - 1]);
        if (moved <= 1e-3) { run++; if (run > wStill) wStill = run; } else run = 0;
      }
      rebaseWindows.push({
        atFrame: i, atMs: +(t[i] - t[0]).toFixed(1), rebase: reb[i],
        gapAtRebaseMs: +(t[i] - t[i - 1]).toFixed(1),
        next600MaxGapMs: +wMax.toFixed(1),
        next600MeanGapMs: +(wSum / (end - i + 1)).toFixed(2),
        next600StillFrames: wStill,
        next600TravelledM: +Math.hypot(px[end] - px[i], py[end] - py[i], pz[end] - pz[i]).toFixed(2),
      });
    }

    // (C): the longest run of consecutive frames over which the feet moved less
    // than a millimetre in total, with the key held. Reported in frames AND in
    // milliseconds AND in ticks, because "500 frames" only means something once
    // you know whether that is 1.7 s at 300 fps or 8 s at 60, and whether the
    // sim was even running underneath it.
    let bestRun = 0, bestStart = -1, bestMs = 0, bestTicks = 0;
    let runStart = 0;
    for (let i = 1; i < n; ++i) {
      const moved = Math.hypot(px[i] - px[runStart], py[i] - py[runStart],
        pz[i] - pz[runStart]) > 1e-3;
      if (moved) { runStart = i; continue; }
      const runLen = i - runStart;
      if (runLen > bestRun) {
        bestRun = runLen; bestStart = runStart;
        bestMs = t[i] - t[runStart]; bestTicks = tick[i] - tick[runStart];
      }
    }
    let ltMs = 0, ltMax = 0;
    for (const e of longTasks) { ltMs += e[1]; if (e[1] > ltMax) ltMax = e[1]; }

    return {
      label,
      keys,
      frames: n,
      wallMs: +wallMs.toFixed(0),
      fps: +((n / wallMs) * 1000).toFixed(1),
      frameGapMs: {
        mean: n > 1 ? +(sumGap / (n - 1)).toFixed(2) : null,
        p50: pct(sortedGap, 0.5), p99: pct(sortedGap, 0.99),
        max: +maxGap.toFixed(1), maxAtFrame: maxGapAt,
      },
      // THE INSTRUMENT'S OWN PRICE, so a "stall" that is the probe can be seen.
      probeMs: {
        mean: n > 1 ? +(sumCost / (n - 1)).toFixed(3) : null,
        p99: pct(sortedCost, 0.99), max: +maxCost.toFixed(2),
        shareOfFrame: sumGap > 0 ? +((100 * sumCost) / sumGap).toFixed(1) : null,
      },
      stallFrames: gaps.length,
      stalls: gaps,
      worstFrames: worst,
      rebases: reb[n - 1] - reb[0],
      rebaseWindows,
      pendingFrames: (() => { let c = 0; for (let i = 0; i < n; ++i) if (pend[i] > 0) c++; return c; })(),
      maxPending: (() => { let m = 0; for (let i = 0; i < n; ++i) if (pend[i] > m) m = pend[i]; return m; })(),
      // (B): the catch-up clamp.
      catchupClampFrames: ticksSkippedFrames,
      ticksAdvanced: w1.tick - w0.tick,
      ticksExpected: Math.round((wallMs / 1000) * 60),
      simTimeKeptPct: +((100 * (w1.tick - w0.tick)) / Math.max(1, (wallMs / 1000) * 60)).toFixed(1),
      // (C): the freeze in the player's own coordinates.
      episodes,
      longestStillFrames: bestRun,
      longestStillMs: +bestMs.toFixed(1),
      longestStillTicks: bestTicks,
      longestStillStartFrame: bestStart,
      travelledM: +dist(posOf(w1), posOf(w0)).toFixed(2),
      loopFrames: w1.frames - w0.frames,
      longTasks: { count: longTasks.length, totalMs: +ltMs.toFixed(0), maxMs: +ltMax.toFixed(0) },
      chunks: { before: w0.chunks, after: w1.chunks },
      grounded: w1.player === null ? null : w1.player.grounded,
      blockedByRock: w1.player === null ? null : w1.player.blockedByRock,
      speedMps: w1.player === null ? null : +w1.player.speedMps.toFixed(2),
    };
  };

  // ---------------------------------------------------------------------------
  // Settle, then the PAIR. The idle control runs FIRST so anything paid for once
  // (a lazy chunk, a shader compile) is charged to the control and not to the
  // walk. That is the conservative order: it can only make the walk look better
  // than it is, never worse.
  // ---------------------------------------------------------------------------
  // `noSettle` walks the INSTANT the page is ready, which is what a player does:
  // they see the world and press W. Every other probe in this suite settles
  // first, so the state a player actually walks out of -- terrain still
  // converging, props still growing their pools -- is a state no probe has
  // measured. It is off by default because it makes the two passes incomparable
  // unless you ask for it.
  if (A.noSettle !== 1) {
    of.input.tape([{ hold: 200, keys: [] }]);
    await of.run(1.5, 60);
    await sleep(300);
  }
  // A NUMBER AND NOT A STRING, deliberately. A string-valued `--evalargs` field
  // does not survive PowerShell's native-argument quoting on Windows: the inner
  // double quotes are stripped and `{"view":"first"}` arrives as a bare
  // identifier, which threw `ReferenceError: first is not defined` from inside
  // page.evaluate the first time this was written that way. It failed loudly,
  // which is the only reason it is a footnote and not a wrong result.
  if (A.fp === 1) of.setView('first');

  // THE POSITIVE CONTROL FOR THE WHOLE INSTRUMENT, and it has to be here or
  // every green below is worth nothing. `Input.setUiCapture(true)` zeroes the
  // walk axis, so a walk taken with the pack panel open IS a player-movement
  // freeze of exactly the reported shape: full frame rate, full tick rate, feet
  // that do not move. `?armPanel=1` produces one on purpose. If the still-frame
  // gate does not go red under this, the gate cannot see the defect it exists
  // for and every clean run above is a vacuous pass.
  //
  // MEASURED 2026-08-14, real D3D11 headless Chrome on an RTX 4060 Ti: armed,
  // `longestStillFrames` = 2190 over 24,990.8 ms with 1499 fixed ticks running
  // underneath it, 0.00 m travelled, worst frame 32.1 ms and 100% of sim time
  // kept, and the gate FAILS. Disarmed, same box, same session: 2 still frames
  // and 114.74 m. The instrument can see the reported symptom; the game did not
  // produce one.
  if (A.armPanel === 1) { of.panel(true); await of.run(0.3, 60); await sleep(150); }

  const start = of.world();
  if (start.player === null) return { valid: false, why: 'no character to walk' };

  // The control does not have to be as LONG as the walk to be a control; it has
  // to run the same instrument on the same box in the same session. Its length
  // is separable so a 3-minute walk does not cost 3 idle minutes as well, and
  // both lengths are published beside their numbers.
  // `walkFirst` puts the WALK before the control, which is the order a player
  // experiences and the only order in which a once-per-session cost (a lazy
  // chunk compile, a pool growth, a first shader link) is charged to the walk
  // instead of to the idle pass that ran ahead of it. The default order is the
  // conservative one; this is the one that can catch a first-press stall.
  const walkFirst = A.walkFirst === 1;
  const idleSecs = A.idleSecs ?? Math.min(secs, 20);
  let idle = walkFirst ? null : await record('idle', [], idleSecs);
  if (!walkFirst) await sleep(300);

  // ONE leg by default. `yaws` turns this into a HUNT: the flat empty plain the
  // walk scenario spawns on has nothing in it to be blocked by, and a walker
  // that never meets a tree, a rock, a wall or a machine cannot reproduce a
  // freeze that a player meets while walking around their base. Each leg is a
  // separate heading held for `secs`, and every leg carries its own episode
  // catcher, so a stall is attributed to the heading that produced it.
  const yaws = A.yaws ?? null;
  let walk;
  const legs = [];
  if (yaws === null) {
    walk = await record('KeyW', ['KeyW'], secs);
  } else {
    for (const y of yaws) {
      of.look(y, 0);
      of.input.tape([{ hold: 30, keys: [] }]);
      await of.run(0.4, 60);
      await sleep(120);
      legs.push(await record(`KeyW@yaw${y}`, ['KeyW'], secs));
    }
    // The reported `walk` is the WORST leg by still-frames, so the verdict below
    // is about the worst thing seen and not about an average that hides it.
    walk = legs.reduce((a, b) => (b.longestStillFrames > a.longestStillFrames ? b : a));
  }

  if (walkFirst) { await sleep(300); idle = await record('idle', [], idleSecs); }

  const w = of.world();
  // THE ASSERTION, because a probe that prints and never asserts passes forever.
  // Three named thresholds, each the smallest number that is clearly outside
  // what a healthy pass measures on this box (worst observed over nine passes:
  // 4 still frames, a 99 ms frame, 99.9% of sim time kept):
  //
  //   * STILL_LIMIT 60 frames. The reported symptom is ~500; 60 is an order of
  //     magnitude below it and 15x above anything a clean walk has produced.
  //   * GAP_LIMIT 250 ms. Two and a half times the worst frame ever seen here,
  //     and still a quarter-second hitch that a player would call a stutter.
  //   * KEPT_LIMIT 90%. `Loop.frame` discards the tick backlog past MAX_CATCHUP,
  //     so sim time going missing is a distinct failure from a slow frame and
  //     gets its own gate.
  const STILL_LIMIT = A.stillLimit ?? 60;
  const GAP_LIMIT = A.gapLimit ?? 250;
  const KEPT_LIMIT = A.keptLimit ?? 90;
  const worstLeg = yaws === null ? [walk] : legs;
  const fails = [];
  for (const l of worstLeg) {
    if (l.longestStillFrames > STILL_LIMIT) {
      fails.push(`${l.label}: the feet did not move for ${l.longestStillFrames} frames `
        + `(${l.longestStillMs} ms, ${l.longestStillTicks} ticks) with KeyW held`);
    }
    if (l.frameGapMs.max > GAP_LIMIT) {
      fails.push(`${l.label}: a ${l.frameGapMs.max} ms frame, against ${idle.frameGapMs.max} ms `
        + `worst in the idle control on the same box`);
    }
    if (l.simTimeKeptPct < KEPT_LIMIT) {
      fails.push(`${l.label}: only ${l.simTimeKeptPct}% of sim time survived `
        + `(${l.ticksAdvanced} of ${l.ticksExpected} ticks); the catch-up clamp bit on `
        + `${l.catchupClampFrames} frames`);
    }
  }
  return {
    valid: idle.frames > 60 && walk.frames > 60,
    pass: fails.length === 0,
    fails,
    thresholds: { STILL_LIMIT, GAP_LIMIT, KEPT_LIMIT },
    order: walkFirst ? 'walk-then-idle' : 'idle-then-walk',
    legs: yaws === null ? undefined : legs.map((l) => ({
      label: l.label, frames: l.frames, travelledM: l.travelledM,
      longestStillFrames: l.longestStillFrames, longestStillMs: l.longestStillMs,
      maxFrameGapMs: l.frameGapMs.max, simTimeKeptPct: l.simTimeKeptPct,
      episodes: l.episodes,
    })),
    site: {
      scenario: start.scenario, seed: start.seed, biome: start.biome,
      lat: +start.observer.latDeg.toFixed(5), lon: +start.observer.lonDeg.toFixed(5),
      walkSpeedMps: of.config.walkSpeedMps,
    },
    idle,
    walk,
    // THE COMPARISON, stated rather than left to the reader.
    verdict: {
      walkMaxGapMs: walk.frameGapMs.max,
      idleMaxGapMs: idle.frameGapMs.max,
      gapIsWalkOnly: walk.frameGapMs.max > 3 * Math.max(1, idle.frameGapMs.max),
      walkStillFrames: walk.longestStillFrames,
      idleStillFrames: idle.longestStillFrames,
      walkTravelledM: walk.travelledM,
      idleTravelledM: idle.travelledM,
      walkSimKeptPct: walk.simTimeKeptPct,
      idleSimKeptPct: idle.simTimeKeptPct,
    },
    cost: { frameMs: of.stats().frameMs, draw: of.stats().draw },
    end: { tick: w.tick, frames: w.frames },
  };
})()
