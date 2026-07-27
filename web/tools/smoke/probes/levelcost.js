// WG-28: what does a level press COST, and where does the time go?
//
// The signed-field rewrite bought a pad flat to 0.000 m and paid for it: a press
// went from WG-23's 0.9 ms to 32.7 ms on the first press and 4.5 ms on a held
// one. 32.7 ms is two dropped frames at 60 Hz and a player feels it as a hitch
// at the exact moment they are trying to place a building.
//
// The two numbers are different costs and want measuring separately:
//
//   COLD  the first press on ground whose corners the procedural field has never
//         been asked about. Dominated by `sampleDesignedHeight` evaluations,
//         which the field memoizes per corner, so this cost is paid once per
//         patch of ground and never again.
//   HELD  every press after that. The memo is warm, so what is left is the
//         interpolation and the hash traffic: the part that repeats three times
//         a second for as long as the key is down, and therefore the part that
//         decides whether holding Q feels smooth.
//
// A dig is measured alongside as the control, because it is the same machinery
// at a twentieth of the volume and its cost has never been a complaint.
//
//   node tools/smoke/run.mjs --scenario=walk \
//        --evalfile=tools/smoke/probes/levelcost.js \
//        --url=http://127.0.0.1:4187/
(async () => {
  const of = window.__of;
  const log = [];
  const settle = async (secs) => {
    of.input.tape([{ hold: Math.ceil(60 * secs) + 30, keys: [] }]);
    await of.run(secs, 60);
  };

  await settle(1.2);
  const w0 = of.world();
  if (w0.player === null) return { valid: false, why: 'no character' };
  if (of.terraform() === null) return { valid: false, why: 'no terraforming tool' };
  await of.wipe();
  of.forgetTunnels();
  const t0 = of.world();

  // Every site is a fresh patch of ground: 0.02 degrees is about 210 m on a
  // 600 km body, so no two share a memoized corner. The COLD number is only
  // honest on ground the field has never been asked about, and re-levelling the
  // same spot would measure the memo instead of the op.
  const LAT = OF_ARGS.latDeg ?? 1.8784;
  const LON = OF_ARGS.lonDeg ?? 143.8696;
  const sites = OF_ARGS.sites ?? 4;
  const heldPresses = OF_ARGS.heldPresses ?? 6;

  const cold = [];
  const held = [];
  const counts = [];
  // The breakdown, because one total is not a diagnosis. Recorded for the cold
  // press and for the held ones separately: they are different mixes, and the
  // first version of this probe reported only the total and would have sent the
  // optimisation at the wrong phase. It nearly did.
  const parts = [];
  const partsOf = (a) => ({ aim: a.lastAimMs, op: a.lastOpMs,
    remesh: a.lastRemeshMs, quote: a.lastQuoteMs, total: a.lastMs });
  for (let s = 0; s < sites; ++s) {
    of.teleport(LAT + s * 0.02, LON + s * 0.02, 2.0);
    await settle(OF_ARGS.arriveSecs ?? 2.2);
    of.look(0, OF_ARGS.pitchDeg ?? -15);
    await settle(0.3);
    const first = of.level();
    if (first === null) { log.push(`site ${s}: no ground in reach`); continue; }
    cold.push(of.terraform().action.lastMs);
    parts.push({ when: 'cold', ...partsOf(of.terraform().action) });
    counts.push({ scanned: first.scanned, corners: first.corners,
      dug: first.dug, filled: first.filled });
    // The held path: the same op with the memo warm. The target is nudged each
    // time so this is never the early-out on an unchanged field, which would
    // measure nothing and read as a triumph.
    for (let i = 0; i < heldPresses; ++i) {
      of.level(first.targetHeightM - 0.02 * (i + 1));
      held.push(of.terraform().action.lastMs);
      if (i < 2) parts.push({ when: 'held', ...partsOf(of.terraform().action) });
      await settle(0.12);
    }
    await settle(0.4);
  }

  // The control: a dig, same field, same machinery, a twentieth of the volume.
  const digMs = [];
  of.teleport(LAT, LON, 2.0);
  await settle(1.6);
  of.look(0, -35);
  await settle(0.3);
  for (let i = 0; i < 5; ++i) {
    const d = of.dig();
    if (d !== null) digMs.push(of.voxels().action.lastMs ?? NaN);
    await settle(0.2);
  }

  const stat = (a) => {
    if (a.length === 0) return null;
    const s = [...a].sort((x, y) => x - y);
    return { n: s.length, min: +s[0].toFixed(2), p50: +s[s.length >> 1].toFixed(2),
      max: +s[s.length - 1].toFixed(2),
      mean: +(s.reduce((p, v) => p + v, 0) / s.length).toFixed(2) };
  };
  const coldS = stat(cold);
  const heldS = stat(held);
  const wEnd = of.world();
  log.push(`cold (first press on fresh ground, ${cold.length} sites): `
    + `${cold.map((v) => v.toFixed(1)).join(', ')} ms`);
  log.push(`held (memo warm, ${held.length} presses): p50 ${heldS?.p50} ms, `
    + `max ${heldS?.max} ms`);
  log.push(`per press: ${counts[0]?.scanned} corners scanned, `
    + `${counts[0]?.corners} written, ${counts[0]?.dug} cut, ${counts[0]?.filled} filled`);

  // THE BUDGET. One frame at 60 Hz is 16.7 ms. A cold press over that drops a
  // frame; a held press over about 5 ms starts eating the budget three times a
  // second for as long as the key is down.
  const FRAME_MS = 16.7;
  return {
    valid: (wEnd.tick - t0.tick) > 300 && cold.length >= 2 && held.length >= 4
      && counts.every((c) => c.corners > 0),
    advanced: { ticks: wEnd.tick - t0.tick, sites: cold.length, presses: held.length },
    coldMs: coldS, heldMs: heldS, digMs: stat(digMs.filter((v) => !Number.isNaN(v))),
    coldSamples: cold.map((v) => +v.toFixed(2)),
    phases: {
      cold: ['aim', 'op', 'remesh', 'quote'].reduce((o, k) => {
        o[k] = stat(parts.filter((p) => p.when === 'cold').map((p) => p[k])); return o;
      }, {}),
      held: ['aim', 'op', 'remesh', 'quote'].reduce((o, k) => {
        o[k] = stat(parts.filter((p) => p.when === 'held').map((p) => p[k])); return o;
      }, {}),
    },
    parts,
    counts,
    frameBudgetMs: FRAME_MS,
    coldWithinOneFrame: coldS !== null && coldS.p50 <= FRAME_MS,
    heldWithinAQuarterFrame: heldS !== null && heldS.p50 <= FRAME_MS / 4,
    log,
  };
})()
