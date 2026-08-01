// WG-117: what the world TREES do and cost at every site that matters.
//
//   node tools/smoke/run.mjs --mode=walk --sandbox=1 --url=http://127.0.0.1:5477/ \
//     --evalfile=tools/smoke/probes/treesite.js
//   ... and the same command with --trees=0 for the other side of the table,
//   and with --trees=0 --canopy=620 for the world as HEAD shipped it.
//
// The ladder is rocksite.js's, which is forestsite.js's, and the argument for
// one camera over many sites is WG-59's: a Mountains zero and a Beach zero are
// different claims and only the condition column tells them apart. This probe
// adds the tree stream's own block per site (live count, realised density over
// the ring, delivery, every refusal with its denominator) and the SIZE census,
// which is the one thing a count cannot say now that scale carries yield.
(async () => {
  const of = window.__of;
  const A = typeof OF_ARGS === 'object' && OF_ARGS !== null ? OF_ARGS : {};
  const SITES = A.sites ?? [
    { name: 'rn15', lat: 12, lon: 150, yaw: 300, pitch: -10 },
    { name: 'current', lat: 2.0, lon: 144.0, yaw: 300, pitch: -6 },
    { name: 'forest', lat: -19.85, lon: -72.7853, yaw: 300, pitch: -6 },
    { name: 'plains', lat: -7.9675, lon: 116.53189, yaw: 300, pitch: -6 },
    { name: 'hills', lat: -31.165, lon: -86.27401, yaw: 300, pitch: -6 },
    { name: 'hills2', lat: 22.286, lon: 108.84406, yaw: 300, pitch: -6 },
    { name: 'beach', lat: -35.6028, lon: 53.30131, yaw: 300, pitch: -6 },
    { name: 'beach2', lat: -57.938, lon: -85.626, yaw: 300, pitch: -6 },
  ];
// THE SETTLE IS 660 FRAMES AND THAT IS A CORRECTION, NOT CAUTION. `StatsProbe`
// keeps a 600-frame ROLLING ring, and the tree-backlog drain loop above spends
// hundreds of frames building cells, so a 60-frame settle reads a p50 that is
// nine tenths queue-drain frames. Measured that way the tree world looked twice
// as expensive as the control AT SITES WITH ZERO TREES IN THEM, which is the
// tell: the number was about the instrument. 660 flushes the ring whole.
  const settle = A.settle ?? 660;

  if (A.hideUi !== false) {
    let node = document.querySelector('canvas');
    while (node !== null && node.parentElement !== null) {
      for (const sib of Array.from(node.parentElement.children)) {
        if (sib !== node) sib.style.display = 'none';
      }
      node = node.parentElement;
    }
  }

  const noonT = () => {
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
    of.setTime(noonT());
    let spin = 0;
    while (!of.world().chunks.converged && spin++ < 200) await of.run(0.25);
    let drain = 0;
    while (of.stats().props.scatterBacklog > 0 && drain++ < 400) await of.run(1 / 60);
    // THE TREE BACKLOG IS THE ONE THAT MATTERS HERE: a 620 m ring is about
    // 1,540 cells built 12 to a frame, so a count taken before the queue drains
    // is a count of a partial forest and would read as a delivery shortfall.
    let tdrain = 0;
    while (((of.game()?.trees?.backlog ?? 0) > 0
      || (of.game()?.rocks?.backlog ?? 0) > 0) && tdrain++ < 3000) {
      await of.run(1 / 60);
    }
    await of.run(settle / 60, 60);

    const w = of.world();
    const st = of.stats();
    const g = of.game();
    const t = g?.trees ?? null;
    const ringM2 = t === null || !t.radiusM ? 0 : Math.PI * t.radiusM * t.radiusM;
    rows.push({
      site: s.name,
      biome: w.biome,
      groundM: +w.surfaceHeightM.toFixed(1),
      converged: w.chunks.converged,
      // --- the invariant table (DW-5 shape, the same columns as rocksite.js
      //     so the two passes' tables can be read against each other).
      calls: st.draw.calls,
      triangles: st.draw.triangles,
      programs: st.draw.programs,
      geometries: st.draw.geometries,
      textures: st.draw.textures,
      vramEstimateMB: st.vramEstimateMB,
      frameP50: st.frameMs.p50,
      frameP95: st.frameMs.p95,
      // --- the tree stream, with the control flag ON the row (rule 7).
      treesEnabled: t?.enabled ?? null,
      treeRadiusM: t?.radiusM ?? null,
      treesLive: t?.live ?? null,
      treesPerKm2: ringM2 === 0 ? null : +(t.live / (ringM2 / 1e6)).toFixed(1),
      treesWanted: t?.wanted ?? null,
      treesDelivered: t?.deliveredFraction ?? null,
      treeCells: t?.cells ?? null,
      treeBiomeZeroCells: t?.biomeZeroCells ?? null,
      treelineCells: t?.treelineCells ?? null,
      treeWetCells: t?.wetCells ?? null,
      treeRefusedSlope: t?.refusedSlope ?? null,
      treeRefusedWater: t?.refusedWater ?? null,
      treeRefusedClearing: t?.refusedClearing ?? null,
      treeCellsCapped: t?.cellsCapped ?? null,
      treeKnown: t?.known ?? null,
      treeForgotten: t?.forgotten ?? null,
      treeScanMs: t?.lastScanMs ?? null,
      treeBacklog: t?.backlog ?? null,
      // --- the retired scenery tier, so a row can never be attributed to the
      //     wrong world. `canopyRadiusM` 0 is the shipping state.
      canopyRadiusM: st.props?.canopyRadiusM ?? null,
      canopyProps: st.props?.canopyProps ?? null,
      // --- the node pool the trees now dominate (DW-28 counters).
      nodesLive: g?.nodes.nodes ?? null,
      nodeInstances: g?.nodes.instances ?? null,
      nodeCapacity: g?.nodes.capacity ?? null,
      nodeGrows: g?.nodes.grows ?? null,
      nodeRefused: g?.nodes.refused ?? null,
      // --- WG-118. The tier histogram IS the LOD claim; a ring whose nodes are
      //     all lod0 has an LOD that is not reaching them, and no triangle
      //     total distinguishes that from an LOD that is simply cheap.
      nodeLod0: g?.nodes.lod0 ?? null,
      nodeLod1: g?.nodes.lod1 ?? null,
      nodeLod2: g?.nodes.lod2 ?? null,
      nodeLodSwitches: g?.nodes.lodSwitches ?? null,
      // --- SIZE, which is now YIELD. A count says how many trees; this says
      //     whether the world grew the range the tuning claims, and the wood
      //     column is the same statement in the units the player spends.
      ...sizeCensus(of.nodes()),
      propInstances: st.props?.instances ?? null,
      propsPlaced: st.props?.propsPlaced ?? null,
    });
  }

  return { ticksAdvanced: of.world().tick - t0Tick, stamp: of.boot, rows };

  /** Tree nodes in the ring by drawn size and by the wood they hold. */
  function sizeCensus(nodes) {
    const t = of.game()?.trees ?? null;
    const R = t === null || !t.radiusM ? 620 : t.radiusM;
    const trees = nodes.filter((n) => n.kind === 0 && n.distanceM < R + 90);
    if (trees.length === 0) return { treeSize: 'none', treeWoodLo: null, treeWoodHi: null };
    const ini = trees.map((n) => n.initial).sort((a, b) => a - b);
    const near = trees.filter((n) => n.distanceM < 60).length;
    return {
      treeSize: `${trees.length} in ring, ${near} within 60 m`,
      treeWoodLo: +ini[0].toFixed(2),
      treeWoodHi: +ini[ini.length - 1].toFixed(2),
      treeWoodMed: +ini[Math.floor(ini.length / 2)].toFixed(2),
    };
  }
})()
