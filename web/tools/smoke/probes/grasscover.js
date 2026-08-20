// grasscover.js: THE GROUND-COVER CARPET'S REGRESSION RAIL (RN-2145).
//
//   node tools/smoke/run.mjs --url=http://127.0.0.1:<port>/ --scenario=walk \
//     --sandbox=1 --width=1600 --height=900 --heartbeat=45 \
//     --evalfile=tools/smoke/probes/grasscover.js \
//     --evalargs='{"lat":-7.9675,"lon":116.53189}'
//
// The off arm, which must produce an EMPTY report rather than a missing one:
//
//   node tools/smoke/run.mjs --url=http://127.0.0.1:<port>/ --scenario=walk \
//     --sandbox=1 --width=1600 --height=900 --grass=0 \
//     --evalfile=tools/smoke/probes/grasscover.js \
//     --evalargs='{"lat":-7.9675,"lon":116.53189,"off":1}'
//
// ==========================================================================
// WHAT IT ASSERTS, AND WHY EACH ONE IS HERE RATHER THAN BEING OBVIOUS
// ==========================================================================
//
// 1. THE BOOT DEFAULT IS ON. RN-150: this project has shipped two features
//    permanently OFF (the ground texture and the wet-sand shoreline) because
//    every probe passed an explicit flag and `Number(null)` is 0, so nobody
//    ever measured the state a player gets. The default is a fixture here, and
//    the RAW query strings are published beside the resolved values so "on" is
//    a fact about the page and not about the probe's arguments.
//
// 2. THE CARD IS BOUND. A carpet whose albedo map failed to load is a field of
//    untextured quads that still measures as a carpet: instances, triangles and
//    draw calls all read healthy. `cardBound` is the only field that can tell
//    the difference and it is asserted on every rung.
//
// 3. NOTHING WAS REFUSED AND NOTHING WAS CAPPED. WG-193's `meshVertsNear` scar:
//    a cap that silently truncates biases every statistic taken over what
//    survives. Both counters must be zero, and if one is not, the run fails
//    rather than reporting a smaller carpet as a fact.
//
// 4. THE DELIVERY RATIO IS IN A STATED BAND, AND THE BAND IS NOT 1.00, WHICH IS
//    THE HONEST PART. `deliveredFraction` is placed over asked, and the builder
//    rounds each cell UP (`Math.ceil`) rather than spending the fraction as a
//    Bernoulli probability the way `ScatterEmit` does. That is deliberate: the
//    shader's per-instance threshold needs a monotone supply, and a stochastic
//    count would sometimes leave a cell short of what the threshold asks for,
//    which is a hole rather than a rounding error. The consequence is that the
//    ratio is ALWAYS above 1 and its size is a function of how many instances a
//    cell asks for. It is asserted inside [1.00, 1.45] instead of being quietly
//    described as 1.0.
//
// 5. DETERMINISM, AND IT IS A REAL ROUND TRIP RATHER THAN A RE-READ. The carpet
//    is walked out of residency and back, so every chunk is DROPPED and REBUILT
//    from its own key, and the digest of the rebuilt set must equal the digest
//    of the original. A digest taken twice without moving would prove only that
//    reading a buffer twice gives the same bytes.
//
//    The digest hashes each chunk's block in KEY ORDER, not the packed buffer
//    in buffer order (see GrassPool.digest): packing order is a property of the
//    order chunks happened to stream in, which is a property of the run, and
//    hashing it would report "non-deterministic" about something that is not.
//
// 6. THE OFF ARM REMOVES THE DRAWS. `?grass=0` must produce `draws: 0` and zero
//    instances, not a constructed-and-empty layer: an unregistered or dead flag
//    "returns a clean answer to a question it never asked" and this project has
//    lost three nights to exactly that.
//
// WHAT IT DOES NOT ASSERT, SAID OUT LOUD. It takes no screenshot and makes no
// pixel claim: the carpet is a LOOK feature and the hero frames judge it
// (docs/screenshots/RN2145_*). This is the regression rail underneath, in the
// role NUMBERS.md assigns instruments once look work is the subject.
(async (A) => {
  const of = window.__of;
  if (!of) return { valid: false, why: 'no __of' };
  const g = window.__ofGrass;
  if (!g) return { valid: false, why: 'no __ofGrass: the carpet was never built' };
  const sleep = (n) => of.run(n);
  const fails = [];
  const r4 = (x) => (Number.isFinite(x) ? Number(x.toFixed(4)) : null);

  const lat = A.lat ?? -7.9675;
  const lon = A.lon ?? 116.53189;
  const off = A.off === 1;

  const settle = async () => {
    let spin = 0;
    while (!of.world().chunks.converged && spin++ < 240) await sleep(0.5);
    await sleep(1.5);
  };

  of.teleport(lat, lon, 2.0);
  await sleep(2.0);
  await settle();
  const first = g.report();

  // --- 1. the boot default, as a fixture rather than as an assumption
  if (!off && first.on !== true) fails.push('the carpet is OFF at the boot default');
  if (off && first.on !== false) fails.push('?grass=0 did not switch the layer off');
  if (!off && first.raw.grass !== null) {
    fails.push(`this arm passed ?grass=${first.raw.grass}, so it is not the default`);
  }

  if (off) {
    // --- 6. the off arm removes the DRAWS, not just the instances
    if (first.draws !== 0) fails.push(`?grass=0 still draws ${first.draws} times`);
    if (first.instances !== 0) fails.push(`?grass=0 still holds ${first.instances} instances`);
    return { valid: fails.length === 0, arm: 'off', fails, report: first };
  }

  // --- 2, 3, 4
  for (const r of first.rungs) {
    if (r.cardBound !== true) fails.push(`rung ${r.rung}: the grass card is NOT bound`);
    if (r.refused !== 0) fails.push(`rung ${r.rung}: ${r.refused} instances refused (pool full)`);
  }
  if (first.cellsCapped !== 0) fails.push(`${first.cellsCapped} cells hit MAX_PER_CELL`);
  if (!(first.instances > 0)) fails.push('the carpet placed nothing at a Plains site');
  if (first.draws !== 2) fails.push(`expected 2 draws (two rungs), got ${first.draws}`);
  const df = first.deliveredFraction;
  if (!(df !== null && df >= 1.0 && df <= 1.45)) {
    fails.push(`deliveredFraction ${df} outside [1.00, 1.45]; see assertion 4`);
  }

  // --- 5. THE ROUND TRIP. Far enough that every chunk leaves residency
  // (REACH_M is 95 m and a chunk is tens of metres across), then back to the
  // same place. Longitude, because a latitude step near the equator is the same
  // arc and this site is at -7.97 where the two are within one per cent.
  const away = lon + 0.12;                    // ~1.2 km at this body's radius
  of.teleport(lat, away, 2.0);
  await sleep(2.0);
  await settle();
  const mid = g.report();
  of.teleport(lat, lon, 2.0);
  await sleep(2.0);
  await settle();
  const back = g.report();

  if (mid.digest === first.digest) {
    // A control on the control: if the digest did not move when the whole
    // carpet was rebuilt somewhere else, it is not reading the carpet.
    fails.push('the digest did not change 1.2 km away, so it is not measuring '
      + 'the instance set');
  }
  if (back.digest !== first.digest) {
    fails.push(`determinism: digest ${first.digest} -> ${back.digest} across a `
      + 'full drop and rebuild of the same chunks');
  }
  if (back.instances !== first.instances) {
    fails.push(`determinism: ${first.instances} -> ${back.instances} instances`);
  }

  return {
    valid: fails.length === 0,
    arm: 'on',
    fails,
    site: { lat, lon, away },
    determinism: {
      digest: first.digest, awayDigest: mid.digest, backDigest: back.digest,
      instances: first.instances, backInstances: back.instances,
      chunksCovered: first.chunksCovered,
    },
    density: {
      placedPerM2: r4(first.placedPerM2),
      askedPerM2: r4(first.askedPerM2),
      deliveredFraction: df,
      cellsCapped: first.cellsCapped,
    },
    cost: {
      draws: first.draws, instances: first.instances,
      triangles: first.triangles, refused: first.refused,
      buildMs: first.buildMs, backlog: first.backlog, builds: first.builds,
    },
    rungs: first.rungs,
    palette: first.palette,
    raw: first.raw,
  };
})(typeof OF_ARGS === 'undefined' ? {} : OF_ARGS)
