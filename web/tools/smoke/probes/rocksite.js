// WG-71: what the world rocks DO and COST at every site that matters.
//
//   node tools/smoke/run.mjs --mode=walk --sandbox=1 --url=http://127.0.0.1:NNNN/ \
//     --evalfile=tools/smoke/probes/rocksite.js
//   ... and the same command with --rocks=0 for the other side of the table.
//
// The ladder is forestsite.js's (its argument for a ladder over one camera is
// WG-59's and holds here unchanged: a Mountains zero and a Beach zero are
// different claims and only the condition column tells them apart). This probe
// adds the rock stream's own block per site: live count, realised density over
// the ring, delivery, and every refusal with its denominator. The invariant
// table (calls, triangles, programs, geometries, VRAM) is read at the same
// settled frame so the two runs of the pair are comparable row for row.
(async () => {
  const of = window.__of;
  const SITES = OF_ARGS.sites ?? [
    { name: 'rn15', lat: 12, lon: 150, yaw: 300, pitch: -10 },
    { name: 'current', lat: 2.0, lon: 144.0, yaw: 300, pitch: -6 },
    { name: 'forest', lat: -19.85, lon: -72.7853, yaw: 300, pitch: -6 },
    { name: 'plains', lat: -7.9675, lon: 116.53189, yaw: 300, pitch: -6 },
    { name: 'hills', lat: -31.165, lon: -86.27401, yaw: 300, pitch: -6 },
    { name: 'hills2', lat: 22.286, lon: 108.84406, yaw: 300, pitch: -6 },
    { name: 'beach', lat: -35.6028, lon: 53.30131, yaw: 300, pitch: -6 },
    { name: 'beach2', lat: -57.938, lon: -85.626, yaw: 300, pitch: -6 },
  ];
  const settle = OF_ARGS.settle ?? 60;

  if (OF_ARGS.hideUi !== false) {
    let node = document.querySelector('canvas');
    while (node !== null && node.parentElement !== null) {
      for (const sib of Array.from(node.parentElement.children)) {
        if (sib !== node) sib.style.display = 'none';
      }
      node = node.parentElement;
    }
  }

  const noonT = (lon) => {
    let best = 0, bestDot = -2;
    for (let i = 0; i < 240; ++i) {
      const t = i / 240;
      of.setTime(t);
      const d = of.stats().sky.elevationDot;
      if (d > bestDot) { bestDot = d; best = t; }
    }
    return best;
  };

  const rows = [];
  const t0Tick = of.world().tick;
  for (const s of SITES) {
    of.teleport(s.lat, s.lon, 2.0);
    of.look(s.yaw, s.pitch);
    await of.run(1.0);
    of.setTime(noonT(s.lon));
    let spin = 0;
    while (!of.world().chunks.converged && spin++ < 200) await of.run(0.25);
    let drain = 0;
    while (of.stats().props.scatterBacklog > 0 && drain++ < 400) await of.run(1 / 60);
    // The rock stream's own backlog: cell builds are amortised, so a count
    // taken before the queue drains is a count of a partial ring.
    let rdrain = 0;
    while ((of.game()?.rocks?.backlog ?? 0) > 0 && rdrain++ < 400) await of.run(1 / 60);
    await of.run(settle / 60, settle);

    const w = of.world();
    const st = of.stats();
    const g = of.game();
    const r = g?.rocks ?? null;
    const ringM2 = Math.PI * 170 * 170;
    rows.push({
      site: s.name,
      biome: w.biome,
      groundM: +w.surfaceHeightM.toFixed(1),
      converged: w.chunks.converged,
      // --- the invariant table (DW-5 shape, same columns as forestsite.js).
      calls: st.draw.calls,
      triangles: st.draw.triangles,
      programs: st.draw.programs,
      geometries: st.draw.geometries,
      textures: st.draw.textures,
      vramEstimateMB: st.vramEstimateMB,
      frameP50: st.frameMs.p50,
      frameP95: st.frameMs.p95,
      // --- the rock stream, with the control flag ON the row (rule 7).
      rocksEnabled: r?.enabled ?? null,
      rocksLive: r?.live ?? null,
      rocksPerKm2: r === null ? null : +(r.live / (ringM2 / 1e6)).toFixed(1),
      rocksWanted: r?.wanted ?? null,
      rocksDelivered: r?.deliveredFraction ?? null,
      rockCells: r?.cells ?? null,
      biomeZeroCells: r?.biomeZeroCells ?? null,
      wetCells: r?.wetCells ?? null,
      refusedSlope: r?.refusedSlope ?? null,
      scanMs: r?.lastScanMs ?? null,
      // --- the node pool the rocks share with the trees (DW-28 counters).
      nodesLive: g?.nodes.nodes ?? null,
      nodeInstances: g?.nodes.instances ?? null,
      nodeCapacity: g?.nodes.capacity ?? null,
      nodeGrows: g?.nodes.grows ?? null,
      nodeRefused: g?.nodes.refused ?? null,
      // --- WG-94, WHICH FORM EACH ROCK WEARS. `kind` cannot answer this: one
      // NODE_KIND now has two art entries, so a spire and a boulder are the
      // same kind. `of.nodes()` publishes the art root and the placement scale
      // (GameplayViews.nodeDump), so the histogram is the instrument and the
      // drawn-height range beside it is what says the size claim is real.
      ...artCensus(of.nodes()),
      // --- WG-91 / WG-92. The prop layer per MATERIAL BATCH, which is the one
      // axis that separates the understorey species: `FOREST_DETAIL` moves
      // demand off `OF_Grass:detail` onto `OF_Leaf:detail` and
      // `OF_LeafDry:detail` at a CONSTANT total, so the two-sided claim is
      // "the total held and the mix moved" rather than a single number.
      propInstances: st.props?.instances ?? null,
      propsPlaced: st.props?.propsPlaced ?? null,
      propStems: st.props?.props ?? null,
      propRefused: st.props?.refused ?? null,
      perMaterial: (st.props?.perMaterial ?? [])
        .filter((m) => m.live > 0)
        .map((m) => `${m.name}=${m.live}`).join(' '),
    });
  }

  return { ticksAdvanced: of.world().tick - t0Tick, stamp: of.boot, rows };

  /** Rock-kind nodes by art root, with the drawn height each form spans. */
  function artCensus(nodes) {
    const rocks = nodes.filter((n) => n.kind === 1 && n.distanceM < 175);
    const by = new Map();
    for (const n of rocks) {
      const k = n.art ?? 'null';
      const e = by.get(k) ?? { n: 0, lo: Infinity, hi: -Infinity };
      e.n++;
      if (typeof n.scale === 'number') {
        e.lo = Math.min(e.lo, n.scale); e.hi = Math.max(e.hi, n.scale);
      }
      by.set(k, e);
    }
    // Authored heights, metres: the drawn height is scale * this. Transcribed
    // from contracts.json dims_xyz_m, and the census prints BOTH so a wrong
    // transcription is visible rather than folded into one number.
    const H = { BoulderStone: 0.90, RockSpire: 2.60 };
    const out = [];
    for (const [root, e] of by) {
      const h = H[root];
      out.push(`${root}=${e.n}`
        + (e.n > 0 && h !== undefined
          ? ` (${(e.lo * h).toFixed(2)}..${(e.hi * h).toFixed(2)} m drawn)` : ''));
    }
    return {
      rockArt: out.sort().join(' '),
      spires: by.get('RockSpire')?.n ?? 0,
      boulders: by.get('BoulderStone')?.n ?? 0,
    };
  }
})()
