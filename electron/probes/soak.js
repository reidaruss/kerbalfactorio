// MEMORY AT REST AND AFTER A FEW MINUTES OF PLAY (DW-27 spike, Q1).
//
// A packaged desktop game that leaks is a different problem from a web page
// that leaks, because nobody closes the tab. So this samples the three heaps
// that exist (JS, the WASM linear memory, and the renderer's own VRAM estimate)
// at rest, then walks and digs for several minutes and samples again, and
// reports the SLOPE rather than a single end number. A single end number cannot
// tell a leak from a warm-up.
//
// It is deliberately usable against a packaged of:// build as well as a dev
// server: nothing here imports a source module, everything goes through
// window.__of, which exists in both.
//
// DW-20: each sample carries the tick and frame counters, and the run is invalid
// if the simulation did not advance by roughly what was asked for.
//
//   node measure/drive.mjs   --evalfile=probes/soak.js
//   node measure/browser.mjs --evalfile=probes/soak.js --url=http://127.0.0.1:4173/?debug=1
(async () => {
  const of = window.__of;
  const A = Object.assign({ minutes: 3, sampleEverySecs: 20, digEvery: 3 },
    (typeof OF_ARGS === 'object' && OF_ARGS !== null) ? OF_ARGS : {});

  const r2 = (x, n = 2) => (typeof x === 'number' && isFinite(x) ? +x.toFixed(n) : null);
  // Standing rule 5: the heap view is re-read on every sample, never cached.
  // ALLOW_MEMORY_GROWTH detaches every ArrayBuffer when the heap grows, so a
  // cached byteLength would report the size the heap USED to be, which is
  // exactly the number a leak hunt must not be given.
  const wasmBytes = () => {
    try {
      const s = of.structures();
      return s && s.M && s.M.HEAPU8 ? s.M.HEAPU8.byteLength : null;
    } catch (_) { return null; }
  };

  const sample = (label) => {
    const m = (typeof performance !== 'undefined' && performance.memory) ? performance.memory : null;
    const s = of.stats();
    const w = of.world();
    return {
      label,
      tSec: r2(performance.now() / 1000, 1),
      tick: w.tick, frames: w.frames,
      jsHeapMB: m ? r2(m.usedJSHeapSize / 1048576) : null,
      jsHeapTotalMB: m ? r2(m.totalJSHeapSize / 1048576) : null,
      jsHeapLimitMB: m ? r2(m.jsHeapSizeLimit / 1048576) : null,
      wasmHeapMB: r2((wasmBytes() ?? 0) / 1048576),
      vramEstimateMB: r2(s.vramEstimateMB),
      geometries: s.draw.geometries, textures: s.draw.textures, programs: s.draw.programs,
      drawCalls: s.draw.calls, triangles: s.draw.triangles,
      residentChunks: w.chunks.resident,
      frameP50: r2(s.frameMs.p50), frameP99: r2(s.frameMs.p99),
    };
  };

  let spin = 0;
  while (!of.world().chunks.converged && spin++ < 160) await of.run(0.25);
  of.panel(false);
  await of.run(1);

  const samples = [sample('at rest')];
  const t0 = of.world().tick;
  const totalSecs = A.minutes * 60;
  const rounds = Math.max(1, Math.round(totalSecs / A.sampleEverySecs));

  for (let i = 0; i < rounds; ++i) {
    // Real play, not an idle timer: walk, turn, and dig every few rounds. An
    // idle soak measures nothing, because the allocations this project makes are
    // in terrain streaming, voxel re-meshing and the chunk pool, all of which
    // only happen when the player MOVES.
    of.input.tape([
      { hold: 200, keys: ['KeyW'], dYaw: 0.004 },
      { hold: 120, keys: ['KeyW', 'KeyD'] },
      { hold: 200, keys: ['KeyW'], dYaw: -0.004 },
    ]);
    if (i % A.digEvery === 0) { try { of.dig(); of.dig(); } catch (_) {} }
    await of.run(A.sampleEverySecs);
    samples.push(sample(`t+${(i + 1) * A.sampleEverySecs}s`));
  }

  const first = samples[0];
  const last = samples[samples.length - 1];
  const ticks = of.world().tick - t0;
  const expected = Math.round(totalSecs * 60);

  return {
    valid: Math.abs(ticks - expected) <= expected * 0.1 && samples.length > 2,
    advanced: { ticks, expectedTicks: expected, frames: last.frames - first.frames },
    client: /Electron/.test(navigator.userAgent) ? 'electron' : 'chrome',
    origin: location.origin,
    gpu: of.stats().gpu,
    atRest: first,
    afterPlay: last,
    deltaMB: {
      js: r2((last.jsHeapMB ?? 0) - (first.jsHeapMB ?? 0)),
      wasm: r2((last.wasmHeapMB ?? 0) - (first.wasmHeapMB ?? 0)),
      vramEstimate: r2((last.vramEstimateMB ?? 0) - (first.vramEstimateMB ?? 0)),
    },
    // Per-minute slope, which is the number that says "leak" or "warm-up".
    jsHeapMBPerMinute: r2(((last.jsHeapMB ?? 0) - (first.jsHeapMB ?? 0)) / Math.max(1, A.minutes)),
    samples,
  };
})()
