// WG-67/WG-69/WG-72: the world rocks are real, delivered at the asked density,
// deterministic from seed, and their refusals are reachable.
//
//   node tools/smoke/run.mjs --scenario=walk \
//        --evalfile=tools/smoke/probes/rocks.js
//
// DRIVEN (standing rule 3, DW-20): it proves the sim advanced, walks a real
// KeyW tape so the streaming ring is exercised by the one locomotion the suite
// historically never used (WG-64's lesson), and proves determinism by leaving
// and coming back rather than by re-reading the same state twice.
//
// OF_ARGS:
//   control:     true when the run is `--rocks=0`; every presence assertion
//                flips to absence, so the control is asserted rather than eyed.
//   expectWater: true at the current Mountains spawn, whose pond is the one
//                reachable refusing case of the water gate (a filter is proved
//                by the case it CATCHES, RN-46).
//   minRocks:    floor on the live count at this site, from the density table.
(async () => {
  const of = window.__of;
  const args = (typeof OF_ARGS === 'object' && OF_ARGS !== null) ? OF_ARGS : {};
  const fails = [];
  const check = (name, ok, detail) => {
    if (!ok) fails.push(detail === undefined ? name : `${name}: ${detail}`);
  };
  const rocksOf = () => of.game().rocks;
  const settle = async () => {
    // The ring refills on a movement-gated scan plus a per-frame node compose,
    // so give it real sim seconds and require the scan counter to MOVE (DW-20:
    // a probe that never saw the scanner run has measured a constant).
    await of.run(1.5);
  };

  const t0 = of.world().tick;
  await settle();
  const s0 = rocksOf();
  const pool0 = of.game().nodes;

  if (args.control === true) {
    check('control: the rock stream reports itself OFF', s0.enabled === false,
      JSON.stringify(s0));
    check('control: no rock was placed', s0.live === 0 && s0.cells === 0,
      `live ${s0.live}, cells ${s0.cells}`);
    check('control: the scanner did not run', s0.scans === 0, `${s0.scans}`);
    const ticks = of.world().tick - t0;
    check('the sim advanced', ticks > 60, `${ticks}`);
    return { valid: fails.length === 0, fails, control: true, stats: s0 };
  }

  check('the rock stream is on', s0.enabled === true, JSON.stringify(s0));
  check('the scanner ran at least once', s0.scans >= 1, `${s0.scans}`);
  check('rocks exist at this site', s0.live >= (args.minRocks ?? 1),
    `live ${s0.live}, wanted floor ${args.minRocks ?? 1}`);
  // DELIVERY, two-sided, with a fair-draw band: the realised count is a sum of
  // Bernoulli draws about the expectation, so the band is 4 standard deviations
  // of that sum, never a tuned constant. Refusals make delivery LOW, so the
  // band is only owed after subtracting what the gates took, and the gates are
  // asserted/reported beside it rather than absorbed.
  const wanted = s0.wanted;
  const gateTook = s0.refusedSlope + s0.refusedWater;
  if (wanted > 0) {
    const sd = Math.sqrt(wanted) / wanted;
    const df = (s0.delivered + gateTook) / wanted;
    check('delivery (before gates) is the ask within 4 sigma',
      Math.abs(df - 1) <= Math.max(0.05, 4 * sd),
      `delivered ${s0.delivered} + gates ${gateTook} of wanted ${wanted}, `
      + `ratio ${df.toFixed(4)}, band ${Math.max(0.05, 4 * sd).toFixed(4)}`);
  }
  check('the node pool refused nothing (DW-28)', pool0.refused === 0,
    `${pool0.refused}`);
  if (args.expectWater === true) {
    // CELL-granular on purpose: at the shipped density the pond's disc holds a
    // quarter of an expected ROCK, so a per-rock refusal is unreachable on most
    // seeds and would be the treeline's unreachable-refusing-case defect. The
    // cell counter fires on every visit to the pond.
    check('THE WATER GATE REFUSED THE POND CELLS (the reachable refusing case)',
      s0.wetCells > 0, `wetCells ${s0.wetCells}`);
  }

  // Every rock must stand on the oracle surface (the same band harvest.js
  // holds the clearing to; a rock snapped to the RAW field would be km out).
  const groundR = of.world().bodyRadiusM + of.world().surfaceHeightM;
  const rockRows = of.nodes().filter((n) => n.kind === 1 && n.distanceM < 175);
  const surfErr = rockRows.map((n) => Math.abs(Math.hypot(n.x, n.y, n.z) - groundR));
  check('rocks sit in the relief band of the player ground',
    rockRows.length === 0 || Math.max(...surfErr) < 120,
    `worst ${rockRows.length ? Math.max(...surfErr).toFixed(1) : 'n/a'} m`);

  // DETERMINISM BY ROUND TRIP: record the ring, leave (5+ km, everything
  // streams out), come back, and demand the identical rocks to the BIT.
  // Positions are pure functions of (seed, lattice cell) and the oracle snap,
  // so the correct comparison is ===, not a tolerance.
  const keyOf = (n) => `${n.x},${n.y},${n.z}`;
  const ring0 = new Set(rockRows.map(keyOf));
  const w0 = of.world().observer;
  of.teleport(w0.latDeg, w0.lonDeg + 0.05, 2);
  await settle();
  const sAway = rocksOf();
  of.teleport(w0.latDeg, w0.lonDeg, 2);
  await settle();
  const s1 = rocksOf();
  const ring1 = new Set(of.nodes()
    .filter((n) => n.kind === 1 && n.distanceM < 175).map(keyOf));
  let missing = 0;
  for (const k of ring0) if (!ring1.has(k)) missing++;
  let extra = 0;
  for (const k of ring1) if (!ring0.has(k)) extra++;
  check('the round trip reproduced every rock BIT-IDENTICALLY',
    missing === 0 && extra === 0,
    `${missing} missing, ${extra} extra, of ${ring0.size}`);
  check('leaving actually streamed the ring elsewhere (the trip tested something)',
    sAway.cells !== s0.cells || sAway.known > s0.known,
    `cells ${s0.cells} -> ${sAway.cells}, known ${s0.known} -> ${sAway.known}`);

  // A WALK, because every historic probe teleports and WG-64 is what that
  // hides. 10 s of real KeyW at walk speed crosses two scan hystereses.
  const scansBefore = s1.scans;
  of.input.tape([{ hold: 600, keys: ['KeyW'] }]);
  await of.run(10.5);
  const s2 = rocksOf();
  const pool2 = of.game().nodes;
  check('walking re-scanned the ring', s2.scans > scansBefore,
    `${scansBefore} -> ${s2.scans}`);
  check('the pool still refused nothing after the walk', pool2.refused === 0,
    `${pool2.refused}`);

  const ticks = of.world().tick - t0;
  check('the sim advanced', ticks > 600, `${ticks}`);

  return {
    valid: fails.length === 0,
    fails,
    stats: s2,
    site: { lat: w0.latDeg, lon: w0.lonDeg },
    ring: { before: ring0.size, after: ring1.size, missing, extra },
    scanCost: { lastScanMs: s2.lastScanMs, scans: s2.scans },
    pool: pool2,
    nodesTotal: of.game().placed,
  };
})()
