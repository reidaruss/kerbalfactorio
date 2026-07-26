// Driven walk probe. Holds KeyW for OF_ARGS.secs of SIM time on the synthetic
// clock (__of.run), sampling the world every OF_ARGS.sampleSecs, and returns
// distance walked, grounded fraction, rebase count, streaming churn and the
// JitterProbe result.
//
//   node tools/smoke/run.mjs --scenario=walk --evalfile=tools/smoke/probes/walk.js \
//        --evalargs='{"secs":90}' --out=docs/screenshots/W2_fp_walk.png
//
// Verification is DRIVEN, not posed (DECISIONS.md standing rule 3): the input
// tape is the same queue a human keyboard fills, and every fixed tick runs.
(async () => {
  const of = window.__of;
  const secs = OF_ARGS.secs ?? 20;
  const hz = OF_ARGS.hz ?? 144.3;
  const slice = OF_ARGS.sampleSecs ?? Math.max(1, secs / 12);
  const keys = OF_ARGS.keys ?? ['KeyW'];
  of.jitter(true);
  // hold is in fixed ticks; the tape has to outlast the run or the walk stops.
  of.input.tape([{ hold: Math.ceil(60 * secs) + 120, keys }]);

  const samples = [];
  let airborne = 0, polls = 0, minSlope = 1, maxSpeed = 0;
  let added = 0, evicted = 0, lastResident = -1;
  let worstFrameMs = 0, rebasesBefore = of.world().origin.rebases;

  const snap = () => {
    const w = of.world();
    const s = of.stats();
    polls++;
    if (w.player && !w.player.grounded) airborne++;
    if (w.player) {
      minSlope = Math.min(minSlope, w.player.slopeCos);
      maxSpeed = Math.max(maxSpeed, w.player.speedMps);
    }
    if (lastResident >= 0) {
      const d = w.chunks.resident - lastResident;
      if (d > 0) added += d; else evicted -= d;
    }
    lastResident = w.chunks.resident;
    worstFrameMs = Math.max(worstFrameMs, s.frameMs.worst);
    return { w, s };
  };

  snap();
  const done = [];
  for (let t = 0; t < secs; t += slice) {
    await of.run(Math.min(slice, secs - t), hz);
    const { w, s } = snap();
    done.push({
      t: +(t + slice).toFixed(1),
      lat: +w.observer.latDeg.toFixed(6),
      lon: +w.observer.lonDeg.toFixed(6),
      alt: +w.observer.altM.toFixed(2),
      spd: +(w.player ? w.player.speedMps : 0).toFixed(2),
      grounded: w.player ? w.player.grounded : null,
      slopeDeg: +(Math.acos(Math.min(1, w.player ? w.player.slopeCos : 1)) * 57.2958).toFixed(1),
      rebases: w.origin.rebases,
      resident: w.chunks.resident,
      near: w.chunks.near,
      built: s.terrain.chunksBuilt,
      calls: s.draw.calls,
    });
  }
  samples.push(...done);

  const j = of.jitter(false);

  // Stop, then converge on the synthetic clock (rAF is not reliable headless),
  // so the frame hash below describes a settled world and not a race.
  of.input.tape([{ hold: 600, keys: [] }]);
  let spin = 0;
  while (!of.world().chunks.converged && spin++ < 60) await of.run(0.5);
  await of.run(0.5);
  // THE floating-origin invisibility test: this hash must match a run of the
  // same walk at a different rebase threshold. Same walk, different origin
  // history, same pixels.
  const frame = OF_ARGS.hash === false ? null : of.framehash();

  const s = of.stats();
  const w = of.world();
  const a = samples[0], b = samples[samples.length - 1];
  const R = w.bodyRadiusM;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = (((b.lon - a.lon) * Math.PI) / 180) * Math.cos((a.lat * Math.PI) / 180);
  return {
    walkSecs: secs,
    renderHz: hz,
    interpolated: !/\binterp=0\b/.test(location.search),
    straightLineM: +(Math.hypot(dLat, dLon) * R).toFixed(1),
    groundedPct: +(100 * (1 - airborne / Math.max(1, polls))).toFixed(2),
    steepestSlopeDeg: +(Math.acos(Math.min(1, minSlope)) * 57.2958).toFixed(1),
    maxSpeedMps: +maxSpeed.toFixed(2),
    rebases: w.origin.rebases - rebasesBefore,
    chunksBuilt: b.built - a.built,
    residentDelta: { added, evicted },
    worstFrameMs: +worstFrameMs.toFixed(2),
    rebaseThresholdM: of.config.rebaseM,
    endLat: +w.observer.latDeg.toFixed(9),
    endLon: +w.observer.lonDeg.toFixed(9),
    originAtEnd: [Math.round(w.origin.x), Math.round(w.origin.y), Math.round(w.origin.z)],
    frame,
    jitter: j,
    frameMs: s.frameMs,
    draw: s.draw,
    terrain: s.terrain,
    pool: s.pool,
    vramEstimateMB: s.vramEstimateMB,
    samples,
  };
})()
