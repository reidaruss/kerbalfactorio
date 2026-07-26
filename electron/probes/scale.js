// THE SCALE TEST (DW-27 spike, question 3).
//
// Every performance number this project has was taken on a six-building line.
// 41 draw calls of 150 at 2.1 ms says almost nothing about a real factory, and
// the point of this probe is to find the number where something breaks and to
// name what breaks first, rather than to produce a reassuring green tick.
//
// HOW IT SEEDS, AND WHY THAT IS LEGITIMATE. It does not synthesise meshes or
// poke the renderer. It captures the LIVE `Gameplay` instance by wrapping
// `Gameplay.prototype.frame` for one frame, then drives `Factory.restore(rows)`
// and `Structures.adopt(...)`, which are the entry points a SAVE-GAME LOAD
// takes. Every machine therefore exists in /core's `BuildableNetwork`, is
// chained and wired by the real `FactoryWiring`, and is drawn by the real
// `FactoryView`. What it skips is the aim-ray ghost, the reach test and the item
// cost, i.e. the player's HANDS, not the simulation. Placing 500 machines one at
// a time through `Factory.add` is not merely slow, it is roughly O(n^3): every
// add calls `commit()`, which tears down and rebuilds the whole /core network
// and re-runs the O(belts^2) chaining. `restore()` is one commit for the whole
// batch, which is exactly why the save system uses it.
//
// WHERE IT PUTS THEM MATTERS AS MUCH AS HOW MANY. The lattice is a body-frame
// cube grid, so a unit cell step covers 0.59 to 1.02 m of ground depending on
// axis, and stepping cell keys directly would land many tiles in one cell and
// silently place nothing. So the field is laid out in METRES on a tangent basis
// built from the camera's own aim, which also guarantees the factory is IN FRONT
// OF THE CAMERA. A scale test that seeds 600 machines behind the player measures
// frustum culling, not scale.
//
// DW-20: every rung reports ticks advanced, frames rendered and /core's own tick
// counter, and is marked invalid if the sim did not move. `AutoLine.recreate()`
// resets /core's counter on every commit, so the snapshot is taken AFTER seeding
// and nothing is placed inside a measured window; a rebuild landing inside a
// window invalidates that rung by itself.
//
//   node measure/drive.mjs   --evalfile=probes/scale.js --url=http://127.0.0.1:5199/
//   node measure/browser.mjs --evalfile=probes/scale.js --url=http://127.0.0.1:5199/
(async () => {
  const of = window.__of;
  const A = Object.assign({
    rungs: [0, 60, 140, 260, 400, 600, 900],
    measureSecs: 4,
    foundations: 100,     // a 10 x 10 platform
    walls: 40,
    convergeSpins: 160,
    pitchDeg: -9,
  }, (typeof OF_ARGS === 'object' && OF_ARGS !== null) ? OF_ARGS : {});

  const log = [];
  const say = (m) => log.push(m);
  const r2 = (x, n = 2) => (typeof x === 'number' && isFinite(x) ? +x.toFixed(n) : null);

  // ---- capture the live Gameplay -----------------------------------------
  // Gameplay is created by a dynamic import in Boot.ts, so the module record is
  // reachable by path on the dev/probe server. `frame(dt)` runs every rendered
  // frame, so one wrapped frame is enough to catch `this`.
  let live = null;
  let captureError = null;
  try {
    const mod = await import('/src/game/Gameplay.ts');
    const orig = mod.Gameplay.prototype.frame;
    mod.Gameplay.prototype.frame = function (dt) { live = this; return orig.call(this, dt); };
    await of.run(0.08);
    mod.Gameplay.prototype.frame = orig;
  } catch (e) { captureError = String(e && e.message ? e.message : e); }
  if (live === null) {
    return { valid: false, reason: 'could not capture the live Gameplay instance', captureError,
      note: 'this probe needs the vite dev/probe server (source modules), not a production bundle' };
  }

  const factory = live.factory;
  const structures = live.structures;
  // Standing rule 5: never cache a heap view. ALLOW_MEMORY_GROWTH detaches every
  // ArrayBuffer on growth, so this is re-read on every single sample.
  const wasmHeapBytes = () => { try { return structures.M.HEAPU8.byteLength; } catch (_) { return null; } };

  const converge = async () => {
    let spin = 0;
    while (!of.world().chunks.converged && spin++ < A.convergeSpins) await of.run(0.25);
    return of.world().chunks.converged;
  };

  // ---- a tangent basis that points where the camera is looking ------------
  const norm = (v) => { const m = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / m, v[1] / m, v[2] / m]; };
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

  of.panel(false);
  await converge();
  // SETTLE BEFORE DERIVING THE LAYOUT, and this is not a nicety. The player is
  // still falling for the first couple of seconds after spawn, and a tangent
  // basis taken mid-fall produced a field where nearly every tile snapped to the
  // same handful of lattice cells: a sweep that asked for 140 machines placed 5
  // and reported a beautifully flat, entirely meaningless curve. It looked
  // green. This is the DW-20 failure in the seeding half of the probe rather
  // than the measuring half, so the shortfall is now also reported per rung.
  await of.run(3);
  of.look(of.aim().yawDeg, A.pitchDeg);
  await of.run(0.2);

  const feet = of.world().player.feet;
  const up = norm(feet);
  const aim = of.aim().dir;
  let fwd = norm([aim[0] - up[0] * dot(aim, up), aim[1] - up[1] * dot(aim, up), aim[2] - up[2] * dot(aim, up)]);
  if (!isFinite(fwd[0])) fwd = norm(cross(up, [1, 0, 0]));
  const right = norm(cross(up, fwd));
  const at = (f, r) => [feet[0] + fwd[0] * f + right[0] * r,
    feet[1] + fwd[1] * f + right[1] * r,
    feet[2] + fwd[2] * f + right[2] * r];

  // ---- the seeding grid ---------------------------------------------------
  // Belts and smelters are the right kinds for bulk: a miner additionally
  // demands an ore patch under it (DW-25), and there is not enough patch on the
  // map to carry hundreds. The layout is parallel belt runs terminated by a
  // smelter, which is what a real base looks like and, more importantly, is what
  // exercises FactoryWiring's chaining and its O(sources x sinks) wiring pass
  // rather than dropping N unconnected boxes that never chain.
  const RUN_LEN = 11;     // belt tiles per run, then a smelter caps it
  const LANE_GAP = 2.2;   // metres between lanes, wide enough not to cross-chain
  const NEAR_M = 6;       // the field starts in front of the player, not on them

  // ADOPT A SITE BEFORE SNAPPING ANYTHING, and feature-detect it, because the
  // build grid changed underneath this probe mid-spike. `Factory.snap` used to
  // return a raw /core lattice key; it now resolves the point into a metric SITE
  // and returns `m<siteId>:<i>,<j>`. `siteAt` deliberately does NOT adopt ("a
  // ghost must not found sites by being looked at"), so an un-adopted snap
  // founds a fresh prospective site centred on the query point and every point
  // in the world answers `m1:0,0`. A sweep that asked for 140 machines then
  // seeded 5, and reported a perfectly flat, perfectly meaningless curve. One
  // snap plus one adopt fixes it, and the shortfall assertion below is what
  // caught it.
  if (typeof factory.adoptSite === 'function') {
    const seed0 = factory.snap(...at(NEAR_M, 0));
    if (seed0 && seed0.addr) factory.adoptSite(seed0.addr);
  }

  let lanesUsed = 0;
  const rowsFor = (count, alreadyCells) => {
    const rows = [];
    let placed = 0;
    let lane = lanesUsed;
    let guard = 0;
    while (placed < count && guard++ < 4000) {
      // Lanes fan out alternately left and right of the aim, so the field stays
      // centred on the camera as it grows instead of drifting off one edge.
      const k = Math.ceil(lane / 2) * (lane % 2 === 0 ? 1 : -1);
      for (let i = 0; i < RUN_LEN + 1 && placed < count; ++i) {
        const p = at(NEAR_M + i * 1.15, k * LANE_GAP);
        const s = factory.snap(p[0], p[1], p[2]);
        if (alreadyCells.has(s.cell)) continue;
        alreadyCells.add(s.cell);
        rows.push({
          kind: i === RUN_LEN ? 'smelter' : 'belt',
          pos: [s.pos.x, s.pos.y, s.pos.z],
          cell: s.cell,
          up: [s.up.x, s.up.y, s.up.z],
          fwd: [fwd[0], fwd[1], fwd[2]],
          patch: -1,
        });
        placed++;
      }
      lane++;
    }
    lanesUsed = lane;
    return rows;
  };

  // Structures: adopt() bypasses cost, DW-24 flatness and the support test,
  // which is exactly what a save restore does. It is the only way to lay a real
  // platform without spending an hour levelling ground with Q.
  const SG = await import('/src/game/StructureGrid.ts');
  const layBase = (nFoundations, nWalls) => {
    const p0 = at(10, -26);
    const site = structures.sites[0] ?? structures.prospectiveSite({ x: p0[0], y: p0[1], z: p0[2] });
    structures.adoptSite(site);
    const side = Math.max(1, Math.round(Math.sqrt(nFoundations)));
    const one = (kind, addr) => {
      const key = SG.addrKey(addr);
      if (structures.has(key)) return false;
      const def = structures.defFor(kind);
      if (def === null || def === undefined) return false;
      const a = SG.anchorOf(site, structures.module, addr);
      structures.adopt(kind, def, site.id, addr, key, a.pos, site.up, a.fwd);
      return true;
    };
    let laid = 0;
    for (let i = 0; i < side && laid < nFoundations; ++i) {
      for (let j = 0; j < side && laid < nFoundations; ++j) {
        if (one('foundation', { kind: 'foundation', i, j, level: 0, axis: 0, flip: 0 })) laid++;
      }
    }
    let w = 0;
    for (let axis = 0; axis < 2 && w < nWalls; ++axis) {
      for (let i = 0; i <= side && w < nWalls; ++i) {
        for (const j of [0, side]) {
          if (w >= nWalls) break;
          if (one('wall', { kind: 'wall', i, j, level: 0, axis, flip: 0 })) w++;
        }
      }
    }
    return { foundationsLaid: laid, wallsLaid: w, parts: structures.parts.length };
  };

  // ---- one measured rung --------------------------------------------------
  const measure = async (label) => {
    const converged = await converge();
    await of.run(0.6);                        // let the views sync the new instances
    const t0 = of.world().tick;
    const f0 = of.world().frames;
    const g0 = of.game().factory;
    const core0 = g0.coreTicks;
    const reb0 = g0.rebuilds;
    const heap0 = wasmHeapBytes();

    await of.run(A.measureSecs);

    const w = of.world();
    const s = of.stats();
    const g = of.game();
    const mem = (typeof performance !== 'undefined' && performance.memory) ? performance.memory : null;
    const ticks = w.tick - t0;
    const frames = w.frames - f0;
    const expectedTicks = Math.round(A.measureSecs * 60);
    const rebuilds = g.factory.rebuilds - reb0;

    return {
      label,
      // DW-20. A rung whose sim did not advance, or whose network was rebuilt
      // mid-window, is reported as invalid rather than quietly averaged in.
      advanced: {
        ticks, frames, expectedTicks,
        coreTicksRun: g.factory.coreTicks - core0,
        rebuildsDuringWindow: rebuilds,
        valid: Math.abs(ticks - expectedTicks) <= 90 && frames > 0 && rebuilds === 0,
      },
      frameMs: { p50: r2(s.frameMs.p50), p95: r2(s.frameMs.p95), p99: r2(s.frameMs.p99), worst: r2(s.frameMs.worst) },
      passMs: { near: r2(s.passMs.near), total: r2(s.passMs.total) },
      cpuMs: r2(s.cpuMs),
      draw: { calls: s.draw.calls, triangles: s.draw.triangles,
        geometries: s.draw.geometries, textures: s.draw.textures, programs: s.draw.programs },
      budget: s.budget,
      // The two instance pools. A fixed-capacity BatchedMesh does not get slower
      // when it runs out, it stops DRAWING, so a ceiling hides as a flat line in
      // the draw-call column rather than as a stall. This is the column to read
      // first.
      pools: {
        factory: { instances: g.view?.instances ?? null, capacity: g.view?.capacity ?? null,
          batches: g.view?.batches ?? null, links: g.view?.links ?? null, curves: g.view?.curves ?? null },
        base: { instances: g.baseView?.instances ?? null, capacity: g.baseView?.capacity ?? null,
          batches: g.baseView?.batches ?? null },
      },
      sim: {
        buildings: g.factory.buildings, runs: (g.factory.runs || []).length,
        beltTilesChained: (g.factory.runs || []).reduce((a, r) => a + r.tiles, 0),
        planRows: factory.placed.length,
        structureParts: structures.parts.length,
        itemsLostToRebuild: g.factory.itemsLostToRebuild,
      },
      memory: {
        wasmHeapMB: r2((wasmHeapBytes() ?? 0) / 1048576),
        wasmHeapGrewMB: heap0 === null ? null : r2(((wasmHeapBytes() ?? 0) - heap0) / 1048576, 3),
        jsHeapMB: mem ? r2(mem.usedJSHeapSize / 1048576) : null,
        jsHeapTotalMB: mem ? r2(mem.totalJSHeapSize / 1048576) : null,
        vramEstimateMB: r2(s.vramEstimateMB),
      },
      terrain: { resident: w.chunks.resident, converged, poolExhausted: s.pool.exhausted },
    };
  };

  // ---- the sweep ----------------------------------------------------------
  const cells = new Set(factory.placed.map((p) => p.cell));
  const results = [];
  let shortfall = 0;
  let have = factory.placed.length;

  for (const target of A.rungs) {
    if (target > have) {
      const fresh = rowsFor(target - have, cells);
      // restore() clears and re-commits the WHOLE plan, so it has to be handed
      // every existing row as well as the new ones.
      const all = factory.placed.map((p) => ({
        kind: p.kind, pos: [p.pos.x, p.pos.y, p.pos.z], cell: p.cell,
        up: [p.up.x, p.up.y, p.up.z], fwd: [p.fwd.x, p.fwd.y, p.fwd.z], patch: p.patch ?? -1,
      })).concat(fresh);
      const tSeed = performance.now();
      let seedError = null;
      try { factory.restore(all); } catch (e) { seedError = String(e && e.message ? e.message : e); }
      const seedMs = r2(performance.now() - tSeed, 1);
      have = factory.placed.length;
      // A rung that could not lay what it was asked for is a broken rung, not a
      // data point. Say so out loud rather than plotting it.
      shortfall = target - have;
      say(`rung ${target}: handed ${all.length} rows, plan now ${have}`
        + `${shortfall > 0 ? ` SHORTFALL ${shortfall}` : ''}, restore ${seedMs} ms${seedError ? ` ERROR ${seedError}` : ''}`);
      if (seedError !== null) { results.push({ label: `machines=${target}`, seedError, seedMs }); break; }
      results.seedMs = seedMs;
    }
    const r = await measure(`machines=${target}`);
    r.requested = target;
    r.shortfall = shortfall;
    r.seedMs = results.seedMs ?? null;
    if (shortfall > 0) r.advanced.valid = false;
    results.push(r);
    if (r.advanced.valid === false) say(`rung ${target}: DW-20 INVALID ${JSON.stringify(r.advanced)}`);
  }

  // The base goes on last, on TOP of the biggest factory, because the question
  // is what a factory and a base cost together, not either alone.
  const base = layBase(A.foundations, A.walls);
  say(`base: ${JSON.stringify(base)}`);
  await of.run(0.6);
  const withBase = await measure('machines+base');
  withBase.base = base;
  results.push(withBase);

  return {
    valid: results.every((r) => r.seedError === undefined) && results.some((r) => r.advanced && r.advanced.valid),
    client: /Electron/.test(navigator.userAgent) ? 'electron' : 'chrome',
    origin: location.origin,
    gpu: of.stats().gpu,
    layout: { runLen: RUN_LEN, laneGapM: LANE_GAP, lanesUsed, pitchDeg: A.pitchDeg },
    rungs: results.filter((r) => typeof r === 'object'),
    log,
  };
})()
