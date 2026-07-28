// Do the props come with the player across a floating-origin rebase?
//
//   node tools/smoke/run.mjs --scenario=walk --sandbox=1 --url=http://127.0.0.1:4205/ \
//     --evalfile=tools/smoke/probes/scatterrebase.js \
//     --out=docs/screenshots/WG64_after_rebase.png
//
// WHY THIS PROBE EXISTS, AND WHY NOTHING ELSE COULD HAVE FOUND IT.
//
// `Scatter.replace` is documented as "THE rebase path" and has no caller.
// `FloatingOrigin` has exactly one emit site and five subscribers, and the
// scatter is not one of them. Every instance matrix the scatter writes is
// `chunkView.pos + local`, and `chunkView.pos` is ENGINE space, which the
// origin re-derives on rebase. So the props should be left behind by the whole
// rebase delta.
//
// It has never been seen because THE WHOLE PROBE SUITE SHARES A LOCOMOTION
// ASSUMPTION: every probe teleports. A teleport moves the player 4 km in one
// step, which puts every resident chunk outside the scatter radius, so they are
// dropped and rebuilt and the stale matrices are released before anyone can see
// them. The defect needs the player to arrive at the rebase CONTINUOUSLY, with
// the ground under their feet already scattered. That is a walk, and nothing
// walks. This is "a scene that cannot exhibit the defect" one level up: not a
// camera pointed the wrong way, but a whole suite that never uses the mode the
// defect lives in.
//
// THE MEASUREMENT IS A SUBTRACTION AND NOT A PICTURE. At 4 km a detached forest
// is not a wrong-looking forest, it is an ABSENT one, and "the props vanished"
// is consistent with a pool refusal, a streaming stall, a culling bug and three
// other things. `props.staleMaxM` is the distance between where a chunk's props
// were drawn and where that chunk now is, which is the subtraction the defect
// IS. Its correct value is a hard 0.000000, not a tolerance: `write` and
// `ChunkView.place` go through the same f64 `toEngine`, so a re-placed chunk is
// exact.
//
// DW-20: a run that never rebased proves nothing, and says so in its own output
// rather than passing quietly. `rebasesObserved` is a validity term, not a
// result.
(async () => {
  const of = window.__of;
  const lat = OF_ARGS.lat ?? -19.85;
  const lon = OF_ARGS.lon ?? -72.7853;
  // Sprint, because the shipped threshold is 4,000 m and the walk has to cover
  // it. The keys are the same queue a keyboard fills (standing rule 3).
  const keys = OF_ARGS.keys ?? ['KeyW', 'ShiftLeft'];
  const sliceSecs = OF_ARGS.sliceSecs ?? 5;
  const hz = OF_ARGS.hz ?? 15;
  const maxSecs = OF_ARGS.maxSecs ?? 1200;
  // How long to keep walking AFTER the first rebase, so the screenshot and the
  // last samples show the settled consequence rather than the instant.
  const afterSecs = OF_ARGS.afterSecs ?? 6;

  if (OF_ARGS.hideUi !== false) {
    let node = document.querySelector('canvas');
    while (node !== null && node.parentElement !== null) {
      for (const sib of Array.from(node.parentElement.children)) {
        if (sib !== node) sib.style.display = 'none';
      }
      node = node.parentElement;
    }
  }

  of.teleport(lat, lon, 2.0);
  of.look(OF_ARGS.yawDeg ?? 300, OF_ARGS.pitchDeg ?? -4);
  await of.run(1.0);
  let spin = 0;
  while (!of.world().chunks.converged && spin++ < 300) await of.run(0.25);
  let drain = 0;
  while (of.stats().props.scatterBacklog > 0 && drain++ < 900) await of.run(1 / 60);
  await of.run(1.0, 60);

  const feetOf = (w) => (w.player === null ? null : w.player.feet);
  const dist = (a, b) => (a === null || b === null ? 0
    : Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]));

  const w0 = of.world();
  const start = feetOf(w0);
  const rebases0 = w0.origin.rebases;
  const before = {
    rebases: rebases0,
    staleMaxM: of.stats().props.staleMaxM,
    staleChunks: of.stats().props.staleChunks,
    propsPlaced: of.stats().props.propsPlaced,
    canopyProps: of.stats().props.canopyProps,
    chunksScattered: of.stats().props.chunks,
    triangles: of.stats().draw.triangles,
  };

  // The tape has to outlast the whole run or the walk stops mid way and the
  // distance quietly stops growing (walk.js's own note).
  of.input.tape([{ hold: Math.ceil(60 * maxSecs) + 240, keys }]);

  const samples = [];
  let worstStale = 0;
  let firstStaleAt = null;
  let rebaseSample = null;
  let elapsed = 0;
  let seenRebase = false;
  let tailLeft = afterSecs;

  while (elapsed < maxSecs) {
    await of.run(sliceSecs, hz);
    elapsed += sliceSecs;
    const w = of.world();
    const st = of.stats();
    const p = st.props;
    const row = {
      t: elapsed,
      metres: +dist(start, feetOf(w)).toFixed(1),
      rebases: w.origin.rebases,
      staleMaxM: p.staleMaxM,
      staleChunks: p.staleChunks,
      chunksScattered: p.chunks,
      propsPlaced: p.propsPlaced,
      canopyProps: p.canopyProps,
      triangles: st.draw.triangles,
      calls: st.draw.calls,
      backlog: p.scatterBacklog,
      speedMps: w.player === null ? 0 : +w.player.speedMps.toFixed(2),
      grounded: w.player === null ? null : w.player.grounded,
    };
    samples.push(row);
    if (p.staleMaxM > worstStale) worstStale = p.staleMaxM;
    if (firstStaleAt === null && p.staleMaxM > 0) firstStaleAt = row;
    if (!seenRebase && w.origin.rebases > rebases0) {
      seenRebase = true;
      rebaseSample = row;
    }
    if (seenRebase) {
      tailLeft -= sliceSecs;
      if (tailLeft <= 0) break;
    }
  }

  // DAYLIGHT FOR THE PICTURE, and it costs almost nothing. Seven minutes of sim
  // time walks the clock into night, and the first capture of this defect was a
  // frame in which nothing could be read at all. The noon search calls
  // `stats()` and never `run()`, so it advances ZERO frames and cannot heal the
  // very state the shot is of; only the four frames below do, against a scatter
  // budget of one chunk each.
  if (OF_ARGS.sunAtEnd !== false) {
    of.input.tape([{ hold: 2, keys: [] }]);
    let bestT = 0;
    let bestDot = -2;
    for (let i = 0; i < 240; ++i) {
      of.setTime(i / 240);
      const d = of.stats().sky.elevationDot;
      if (d > bestDot) { bestDot = d; bestT = i / 240; }
    }
    of.setTime(bestT);
    of.look(OF_ARGS.yawDeg ?? 300, OF_ARGS.pitchDeg ?? -4);
    await of.run(4 / 60, 60);
  }

  const w = of.world();
  const st = of.stats();
  const p = st.props;
  const after = {
    rebases: w.origin.rebases,
    staleMaxM: p.staleMaxM,
    staleChunks: p.staleChunks,
    propsPlaced: p.propsPlaced,
    canopyProps: p.canopyProps,
    chunksScattered: p.chunks,
    triangles: st.draw.triangles,
  };

  const rebasesObserved = after.rebases - rebases0;
  const fails = [];
  // VALIDITY, not result. A walk that never crossed the threshold has not
  // tested anything, and must not be readable as a pass.
  if (rebasesObserved < 1) {
    fails.push(`walked ${dist(start, feetOf(w)).toFixed(0)} m in ${elapsed} s and `
      + `never crossed the rebase threshold: this run tested nothing`);
  }
  // THE PROPERTY. Hard zero, both before and after. Stated as two claims so a
  // failure says WHICH side moved.
  if (before.staleMaxM !== 0) {
    fails.push(`props were already stale by ${before.staleMaxM} m BEFORE the walk, `
      + `so the walk is not what displaced them`);
  }
  if (worstStale !== 0) {
    fails.push(`scatter props were displaced from their chunks by up to `
      + `${worstStale} m across ${rebasesObserved} rebase(s); `
      + `Scatter.replace is the documented fix and has no caller`);
  }

  return {
    valid: rebasesObserved >= 1 && w.player !== null && elapsed > 0,
    fails,
    drove: {
      metresWalked: +dist(start, feetOf(w)).toFixed(1),
      simSeconds: elapsed,
      rebasesObserved,
      rebaseThresholdM: 4000,
      keysHeld: keys,
    },
    isolation: {
      canopyRadiusM: p.canopyRadiusM,
      scatterFair: p.fairQuantise,
    },
    before,
    // The slice in which the rebase happened, which is the row that matters.
    atRebase: rebaseSample,
    firstStaleAt,
    after,
    worstStaleM: worstStale,
    samples,
  };
})()
