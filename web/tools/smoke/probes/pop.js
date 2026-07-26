// Stream-in pop census (ARCHITECTURE.md 4.5 mechanism 3, W3a).
//
// A pop cannot be measured as a frame-to-frame difference while walking: the
// camera moves, so EVERY tile changes every frame and the pop drowns. What
// separates them is smoothness. Walking produces an almost constant per-frame
// change; a chunk swapping LOD produces a step. So this measures the SECOND
// DIFFERENCE of each tile's luminance over consecutive frames, which is the same
// technique W2 used to catch fixed-tick walk jitter in the eye position.
//
// A hard pop is one frame with a large second difference. A 250 ms cross-fade is
// 15 frames of small ones.
//
//   node tools/smoke/run.mjs --scenario=walk --walkspeed=12 --fade=0 \
//     --evalfile=tools/smoke/probes/pop.js --evalargs='{"frames":900}'
//
// DW-20: the result carries ticks advanced, metres walked and chunks built, so a
// run that measured a standing-still player is visible in its own output.
(async () => {
  const of = window.__of;
  const frames = OF_ARGS.frames ?? 900;
  const TX = OF_ARGS.tilesX ?? 120;
  const TY = OF_ARGS.tilesY ?? 68;
  const warm = OF_ARGS.warm ?? 60;

  const t0 = of.world();
  const builtStart = of.stats().terrain.chunksBuilt;
  of.input.tape([{ hold: frames + warm + 600, keys: OF_ARGS.keys ?? ['KeyW'] }]);
  for (let i = 0; i < warm; ++i) { await of.run(1 / 60, 60); await new Promise((r) => { setTimeout(r, 0); }); }

  let p1 = null; let p2 = null;
  const series = [];
  let sumOfMax = 0;
  let spike = null;
  for (let i = 0; i < frames; ++i) {
    // Exactly one fixed tick and one rendered frame, so the sample rate is the
    // sim rate and a 250 ms cross-fade is 15 samples wide.
    await of.run(1 / 60, 60);
    // MANDATORY, and the first version of this probe was silently wrong without
    // it: Loop.run only yields a macrotask every 8 frames, and a worker
    // postMessage needs one. A one-frame run therefore never lets a chunk land,
    // so the probe reported chunksBuilt 0 over a kilometre of walking and
    // measured a world that never streamed. DW-20 in miniature.
    await new Promise((r) => { setTimeout(r, 0); });
    const f = of.framehash(TX, TY);
    if (p1 !== null && p2 !== null) {
      let maxD2 = 0; let sumD2 = 0; let over = 0;
      for (let k = 0; k < f.tiles.length; ++k) {
        const d2 = Math.abs((f.tiles[k] - p1[k]) - (p1[k] - p2[k]));
        if (d2 > maxD2) maxD2 = d2;
        sumD2 += d2;
        if (d2 > 4) over++;
      }
      sumOfMax += maxD2;
      if (maxD2 > (OF_ARGS.spike ?? 20) && spike === null) {
        // Localise the outlier so it can be diagnosed instead of guessed at:
        // where on screen, how big, and in which direction.
        let x0 = TX, y0 = TY, x1 = -1, y1 = -1, n = 0, signed = 0;
        for (let k = 0; k < f.tiles.length; ++k) {
          if (Math.abs(f.tiles[k] - p1[k]) < 4) continue;
          const tx = k % TX; const ty = (k / TX) | 0;
          x0 = Math.min(x0, tx); x1 = Math.max(x1, tx);
          y0 = Math.min(y0, ty); y1 = Math.max(y1, ty);
          signed += f.tiles[k] - p1[k];
          n++;
        }
        spike = { i, tilesChanged: n, boxTiles: [x0, y0, x1, y1], meanSignedDelta: +(signed / Math.max(1, n)).toFixed(2) };
      }
      const ww = of.world();
      const ss = of.stats();
      series.push({
        i,
        maxD2: +maxD2.toFixed(2),
        sumD2: +sumD2.toFixed(1),
        tilesOver4: over,
        resident: ww.chunks.resident,
        near: ww.chunks.near,
        hidden: ww.chunks.hidden,
        fading: ww.chunks.fading,
        pool: ss.pool.inUse,
        calls: ss.draw.calls,
        lit: f.litPct,
      });
    }
    p2 = p1; p1 = f.tiles;
  }

  const w = of.world();
  const R = w.bodyRadiusM;
  const dLat = ((w.observer.latDeg - t0.observer.latDeg) * Math.PI) / 180;
  const dLon = (((w.observer.lonDeg - t0.observer.lonDeg) * Math.PI) / 180)
    * Math.cos((t0.observer.latDeg * Math.PI) / 180);
  const sorted = series.map((r) => r.maxD2).sort((a, b) => a - b);
  const pct = (q) => sorted[Math.min(sorted.length - 1, Math.round(q * (sorted.length - 1)))];
  const sortedSum = series.map((r) => r.sumD2).sort((a, b) => a - b);
  const pctSum = (q) => sortedSum[Math.min(sortedSum.length - 1, Math.round(q * (sortedSum.length - 1)))];

  return {
    // DW-20 validity evidence: if these are ~0 the numbers below mean nothing.
    ticksAdvanced: w.tick - t0.tick,
    framesRendered: w.frames - t0.frames,
    walkedM: +(Math.hypot(dLat, dLon) * R).toFixed(1),
    chunksBuilt: of.stats().terrain.chunksBuilt - builtStart,
    grounded: w.player ? w.player.grounded : null,
    fadeSecs: of.config.fadeSecs,
    tiles: [TX, TY],
    samples: series.length,
    // THE measurement: the largest single-frame SECOND DIFFERENCE of any tile,
    // in units of 255. A pop is a spike here; smooth walking is not.
    maxD2: +pct(1).toFixed(2),
    p999D2: +pct(0.999).toFixed(2),
    p99D2: +pct(0.99).toFixed(2),
    p50D2: +pct(0.5).toFixed(2),
    meanMaxD2: +(sumOfMax / Math.max(1, series.length)).toFixed(3),
    p99SumD2: +pctSum(0.99).toFixed(1),
    p50SumD2: +pctSum(0.5).toFixed(1),
    framesOver10: series.filter((r) => r.maxD2 > 10).length,
    framesOver25: series.filter((r) => r.maxD2 > 25).length,
    worst: series.slice().sort((a, b) => b.maxD2 - a.maxD2).slice(0, 4),
    window: OF_ARGS.window ? series.slice(OF_ARGS.window[0], OF_ARGS.window[1]) : undefined,
    spike,
    residentEnd: w.chunks.resident,
    draw: of.stats().draw,
    frameMs: of.stats().frameMs,
  };
})()
