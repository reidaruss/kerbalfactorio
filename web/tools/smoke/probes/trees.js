// WG-116 / WG-118: the world trees are real, delivered at the asked density,
// deterministic from seed, their refusals are reachable, and their LOD is a
// thing that actually happens rather than a constant nobody measured.
//
//   node tools/smoke/run.mjs --url=http://127.0.0.1:5477/ --mode=walk --sandbox=1 \
//     --evalfile=tools/smoke/probes/trees.js --evalargs='{"minTrees":400}'
//   node tools/smoke/run.mjs --url=http://127.0.0.1:5477/ --mode=walk --sandbox=1 \
//     --trees=0 --evalfile=tools/smoke/probes/trees.js --evalargs='{"control":true}'
//
// DRIVEN (standing rule 3, DW-20): it proves the sim advanced, walks a real KeyW
// tape so the streaming ring is exercised by the one locomotion the suite
// historically never used (WG-64's lesson), and proves determinism by LEAVING
// and coming back rather than by re-reading the same state twice.
//
// OF_ARGS:
//   control:      true when the run is `--trees=0`; every presence assertion
//                 flips to absence, so the control is asserted rather than eyed.
//   minTrees:     floor on the live count at this site, from the density table.
//   expectBare:   true where the TREELINE must empty the site (the current
//                 Mountains spawn at 4,668 m). A gate is proved by the case it
//                 CATCHES, never by the case it is meant to ignore (RN-46).
//   expectSlope:  true where the slope gate must refuse at least one candidate.
//   expectLod:    default true. Requires the walk to move nodes between tiers.
(async () => {
  const of = window.__of;
  const args = (typeof OF_ARGS === 'object' && OF_ARGS !== null) ? OF_ARGS : {};
  const fails = [];
  const check = (name, ok, detail) => {
    if (!ok) fails.push(detail === undefined ? name : `${name}: ${detail}`);
  };
  const treesOf = () => of.game().trees;
  // Drain the cell queue rather than guessing at it: a 620 m ring is ~1,540
  // cells built 12 to a frame, so a count taken early is a partial forest.
  const settle = async (maxSecs = 40) => {
    await of.run(1.0);
    let n = 0;
    while ((treesOf().backlog > 0) && n++ < maxSecs * 60) await of.run(1 / 60);
    await of.run(0.5);
  };

  const t0 = of.world().tick;
  await settle();
  const s0 = treesOf();
  const pool0 = of.game().nodes;

  if (args.control === true) {
    check('control: the tree stream reports itself OFF', s0.enabled === false,
      JSON.stringify(s0));
    check('control: no tree was streamed', s0.live === 0 && s0.cells === 0,
      `live ${s0.live}, cells ${s0.cells}`);
    check('control: the scanner did not run', s0.scans === 0, `${s0.scans}`);
    // The CLEARING's own trees are not this tier and must survive the control,
    // or `?trees=0` would be measuring a world with no wood in it at all.
    const clearing = of.nodes().filter((n) => n.kind === 0);
    check('control: the spawn clearing still has its own trees',
      clearing.length >= 10, `${clearing.length}`);
    const ticks = of.world().tick - t0;
    check('the sim advanced', ticks > 60, `${ticks}`);
    return { valid: fails.length === 0, fails, control: true, stats: s0 };
  }

  check('the tree stream is on', s0.enabled === true, JSON.stringify(s0));
  check('the scanner ran at least once', s0.scans >= 1, `${s0.scans}`);
  check('the cell queue drained', s0.backlog === 0, `${s0.backlog}`);

  if (args.expectBare === true) {
    // THE TREELINE, the refusing case WG-61 had to invent a Mountains density
    // to make reachable at all. At 4,668 m every offered cell is above
    // TREELINE_BARE_M, so this is bare BECAUSE the altitude term ran.
    check('THE TREELINE EMPTIED THIS SITE (the reachable refusing case)',
      s0.treelineCells > 0 && s0.live === 0,
      `treelineCells ${s0.treelineCells}, live ${s0.live}`);
  } else {
    check('trees exist at this site', s0.live >= (args.minTrees ?? 1),
      `live ${s0.live}, wanted floor ${args.minTrees ?? 1}`);
    // DELIVERY, two-sided, with a fair-draw band: the realised count is a sum
    // of Bernoulli draws about the expectation, so the band is 4 standard
    // deviations of that sum and never a tuned constant. Refusals make delivery
    // LOW, so the band is owed only after adding back what the gates took.
    const wanted = s0.wanted;
    const gateTook = s0.refusedSlope + s0.refusedWater + s0.refusedClearing;
    if (wanted > 0) {
      const sd = Math.sqrt(wanted) / wanted;
      const df = (s0.delivered + gateTook) / wanted;
      check('delivery (before gates) is the ask within 4 sigma',
        Math.abs(df - 1) <= Math.max(0.05, 4 * sd),
        `delivered ${s0.delivered} + gates ${gateTook} of wanted ${wanted}, `
        + `ratio ${df.toFixed(4)}, band ${Math.max(0.05, 4 * sd).toFixed(4)}`);
    }
  }
  if (args.expectSlope === true) {
    check('THE SLOPE GATE REFUSED CANDIDATES HERE', s0.refusedSlope > 0,
      `refusedSlope ${s0.refusedSlope}`);
  }
  check('the node pool refused nothing (DW-28)', pool0.refused === 0,
    `${pool0.refused}`);

  // Every tree must stand on the oracle surface (the band harvest.js holds the
  // clearing to; a node snapped to the RAW field would be kilometres out).
  const groundR = of.world().bodyRadiusM + of.world().surfaceHeightM;
  const R = s0.radiusM;
  const rows = of.nodes().filter((n) => n.kind === 0 && n.distanceM < R + 90);
  const surfErr = rows.map((n) => Math.abs(Math.hypot(n.x, n.y, n.z) - groundR));
  check('trees sit in the relief band of the player ground',
    rows.length === 0 || Math.max(...surfErr) < 900,
    `worst ${rows.length ? Math.max(...surfErr).toFixed(1) : 'n/a'} m`);

  // SIZE IS YIELD. The scale is a linear map of /core's grade and grade also
  // scales InitialAmount, so the two must move together across the whole
  // population. A world where every tree holds the same wood has lost the rule.
  if (rows.length > 20) {
    const ini = rows.map((n) => n.initial);
    const lo = Math.min(...ini), hi = Math.max(...ini);
    check('the world grew a real spread of tree sizes/yields', hi > lo * 1.5,
      `initial ${lo.toFixed(2)} .. ${hi.toFixed(2)}`);
  }

  // DETERMINISM BY ROUND TRIP: record the ring, leave (everything streams out),
  // come back, and demand the identical trees TO THE BIT. Positions are pure
  // functions of (seed, lattice cell) and the oracle snap, so the correct
  // comparison is ===, not a tolerance.
  const keyOf = (n) => `${n.x},${n.y},${n.z}`;
  const ring0 = new Set(rows.map(keyOf));
  const w0 = of.world().observer;
  of.teleport(w0.latDeg, w0.lonDeg + 0.4, 2);
  await settle();
  const sAway = treesOf();
  of.teleport(w0.latDeg, w0.lonDeg, 2);
  await settle();
  const s1 = treesOf();
  const ring1 = new Set(of.nodes()
    .filter((n) => n.kind === 0 && n.distanceM < R + 90).map(keyOf));
  let missing = 0;
  for (const k of ring0) if (!ring1.has(k)) missing++;
  let extra = 0;
  for (const k of ring1) if (!ring0.has(k)) extra++;
  check('the round trip reproduced every tree BIT-IDENTICALLY',
    missing === 0 && extra === 0,
    `${missing} missing, ${extra} extra, of ${ring0.size}`);
  check('leaving actually streamed the ring elsewhere (the trip tested something)',
    sAway.cells !== s0.cells || sAway.live !== s0.live,
    `cells ${s0.cells} -> ${sAway.cells}, live ${s0.live} -> ${sAway.live}`);
  // THE FORGET PATH (WG-120): streaming out an untouched tree must drop it from
  // `known`, or the map and the autosave grow with the walk for ever.
  check('untouched trees were forgotten when their cells streamed out',
    args.expectBare === true || s1.forgotten > 0, `forgotten ${s1.forgotten}`);
  check('the known map is bounded by the ring, not by the trip',
    s1.known <= s1.live + 200, `known ${s1.known}, live ${s1.live}`);

  // A WALK, because every historic probe teleports and WG-64 is what that
  // hides. It is also the only way to see the LOD switch: a settled camera
  // reports zero switches whether the tiers work or do not exist.
  const scansBefore = s1.scans;
  // CUMULATIVE, differenced. The first version summed a PER-FRAME counter once
  // a second, i.e. it sampled one frame in sixty and reported 0 for an LOD that
  // was switching correctly. NodeField.lodSwitches is now a total since boot.
  const switchedBefore = of.game().nodes.lodSwitches;
  of.input.tape([{ hold: 900, keys: ['KeyW'] }]);
  await of.run(15.0);
  const switched = of.game().nodes.lodSwitches - switchedBefore;
  const s2 = treesOf();
  const pool2 = of.game().nodes;
  check('walking re-scanned the ring', s2.scans > scansBefore,
    `${scansBefore} -> ${s2.scans}`);
  check('the pool still refused nothing after the walk', pool2.refused === 0,
    `${pool2.refused}`);
  if (args.expectLod !== false && args.expectBare !== true) {
    check('NODES CHANGED LOD TIER WHILE WALKING (the tiers are reachable)',
      switched > 0, `lod switches over 15 s: ${switched}`);
    check('the far tier is where most of the ring lives',
      pool2.lod2 > pool2.lod0,
      `lod0 ${pool2.lod0}, lod1 ${pool2.lod1}, lod2 ${pool2.lod2}`);
  }

  const ticks = of.world().tick - t0;
  check('the sim advanced', ticks > 600, `${ticks}`);

  return {
    valid: fails.length === 0,
    fails,
    stats: s2,
    site: { lat: w0.latDeg, lon: w0.lonDeg },
    ring: { before: ring0.size, after: ring1.size, missing, extra },
    scanCost: { lastScanMs: s2.lastScanMs, scans: s2.scans },
    lod: { lod0: pool2.lod0, lod1: pool2.lod1, lod2: pool2.lod2, switched },
    pool: pool2,
    nodesTotal: of.game().placed,
  };
})()
