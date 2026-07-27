// THE DISCOVERY ACCEPTANCE (DW-36, WG-29). Run it TWICE, once per mode:
//
//   node tools/smoke/run.mjs --url=http://127.0.0.1:5199/ --settle=8 \
//     --evalfile=tools/smoke/probes/discovery.js
//   ... and again with --sandbox=1
//
// TWO RUNS AND NOT ONE, for probes/sandbox.js's reason: a mode is decided at
// boot and a page is one world. The two JSON reports are then DIFFED, and the
// claim being tested is not "survival hides something" but the sharper one:
//
//     the same world, at the same standing point, in the same frame, differs
//     between the two modes ONLY in which ore patches reached the painter.
//
// Everything else in `map('report')` — the span, the projection origin, the
// focus, the conic point counts, the pixels per metre and the SHADED GROUND —
// must be identical, and the fields are published here so the diff is a
// comparison rather than an argument.
//
// THE SHADING IS NOW MODE-DEPENDENT, AND THAT IS THE CHANGE (DW-37). WG-29's
// map shaded with discovery QUADS, which are by definition only ever ground you
// HAVE seen, so the drawn count was equal in both modes and this file said so.
// Reid's answer to that map was "cant see the terrain from the map, even in
// sandbox": the quads said what you had seen and nothing at all about what was
// there. The map now samples the WORLD and masks it per sample with the survey
// bit, so `view.drawn.discoveredQuads` is the SAMPLES PAINTED and
// `terrainSamples` is the samples with ground under them at all.
// `terrainSamples` is mode-blind and is still compared for EQUALITY across the
// pair; `discoveredQuads` is the gate's own output and is asserted STRICTLY
// SMALLER in survival wherever the view is wider than what has been seen
// (section 1b).
//
// -----------------------------------------------------------------------------
// WHY EVERY RUNG FORGETS FIRST. The shipped world cannot reach a partially
// explored state on its own: `Gameplay.populate` pins the ore cluster to the
// SPAWN direction and the player starts standing on it, so one second after
// boot every patch's explore cell is discovered and stays discovered for ever.
// `MapWorld.hidden` would be permanently 0 and the gate would be untestable.
// `map('forget')` is therefore called before each rung, which makes the rung
// exactly "ONE observation taken from D metres away" — a state a player reaches
// by starting somewhere else, deterministic, and identical in both modes
// because the ladder below is a FIXED LIST OF NUMBERS and not a search whose
// path could diverge on a mode-dependent answer.
//
// It is also DW-17's rule: THE DESTRUCTION IS THE POINT. A save/load round trip
// over a field that was never thrown away reads a number that never left
// memory, which is what probes/persist.js says about every other saved thing.
//
// -----------------------------------------------------------------------------
// STANDING RULE 3: the map is opened by a genuine DOM KeyboardEvent and zoomed
// by a genuine DOM WheelEvent on the real canvas, not only through `of.map`.
// STANDING RULE 11: every number below is asserted against a PROPERTY. The zoom
// sweep's step bound is computed from the ramp's own shape at the top of this
// file, the reversibility bound is 2 * N * Number.EPSILON, and the frame-cost
// bound is the 60 Hz budget. None of them was tuned until it passed.
// DW-20: section 0 is the setup proof and nothing under it is believed first.
(async () => {
  const of = window.__of;
  if (!of) return { valid: false, why: 'no __of' };
  for (const k of ['map', 'game', 'teleport', 'dig']) {
    if (typeof of[k] !== 'function') return { valid: false, why: `no __of.${k}` };
  }
  const SHOT = (typeof OF_ARGS === 'object' && OF_ARGS !== null
    && typeof OF_ARGS.shot === 'string') ? OF_ARGS.shot : '';
  const sleep = (n) => of.run(n);
  const fails = [];
  const log = [];
  const check = (name, ok, detail) => {
    if (ok !== true) fails.push(detail === undefined ? name : `${name}: ${detail}`);
    return ok === true;
  };

  const MAP = () => of.map('report');
  const ORE = () => of.map('ore');
  const DISC = () => of.map('disc').discovery;
  const DRAWN = () => MAP().view.drawn;

  // ===========================================================================
  // THE RAMP, COPIED. `MapPaint.sizeAlpha` verbatim, so the prediction below is
  // computed HERE and not read back off the thing being tested. probes/
  // maneuver.js copies MapView.clock for the same reason.
  // ===========================================================================
  const sizeAlpha = (sizeM, m2p, minPx, fullPx) => {
    if (!(Number.isFinite(sizeM) && sizeM > 0)) return 0;
    if (!(Number.isFinite(m2p) && m2p > 0)) return 0;
    const lo = Math.max(0, minPx);
    const hi = Math.max(lo + 1e-9, fullPx);
    const px = sizeM * m2p;
    if (px >= hi) return 1;
    if (px <= lo) return 0;
    const t = (px - lo) / (hi - lo);
    return t * t * (3 - 2 * t);
  };
  // MapDraw's four feature-size constants, in pixels. Copied for the same
  // reason; a probe that imported them would be asserting a file against itself.
  const RAMP = { ore: [1.5, 6], discovered: [0.75, 3], body: [2, 12] };
  const ZOOM = 1.15;

  /**
   * The MOST a single zoom notch may move one alpha, DERIVED and not chosen.
   *
   * alpha is a smoothstep in the FEATURE'S PIXEL SIZE, and one notch multiplies
   * that pixel size by exactly ZOOM. So the bound is the supremum over px of
   * |a(px) - a(ZOOM*px)|, which is a property of the ramp's own two constants
   * and of the step, and nothing else. It is found by scanning px geometrically
   * across the whole ramp and a decade either side: the ramp is smooth with a
   * bounded derivative, so a scan this fine IS the supremum for the purpose,
   * and the scan is strictly finer than the 1.15 grid the measurement lands on,
   * so the bound can never be an accidental fit to the samples.
   */
  const stepBound = (minPx, fullPx) => {
    const lo = minPx / (ZOOM * 10), hi = fullPx * ZOOM * 10;
    const N = 200000;
    let worst = 0;
    for (let i = 0; i <= N; i++) {
      const px = lo * Math.pow(hi / lo, i / N);
      const d = Math.abs(sizeAlpha(1, px, minPx, fullPx)
        - sizeAlpha(1, px * ZOOM, minPx, fullPx));
      if (d > worst) worst = d;
    }
    return worst;
  };
  const BOUND = {
    ore: stepBound(RAMP.ore[0], RAMP.ore[1]),
    discovered: stepBound(RAMP.discovered[0], RAMP.discovered[1]),
    body: stepBound(RAMP.body[0], RAMP.body[1]),
  };

  // ===========================================================================
  // 0. SETUP PROOF (DW-20). Nothing below is believed until this passes.
  // ===========================================================================
  await sleep(0.8);
  const t0 = of.world().tick;
  await of.wipe();

  const urlSandbox = new URLSearchParams(location.search).get('sandbox') === '1';
  const m = of.game().mode;
  const sandbox = m.sandbox === true;
  check('the URL flag reached the game', sandbox === urlSandbox,
    `url ${urlSandbox}, game ${m.mode}`);
  // DW-31/DW-36: the map asks `fullMapRevealed` BY NAME. If that predicate ever
  // stopped tracking the mode, every assertion in section 1 would still pass in
  // one of the two runs and the pair would look like a working gate.
  check('and `fullMapRevealed` is the mode\'s own answer',
    m.fullMapRevealed === sandbox, `${m.fullMapRevealed} vs ${m.mode}`);

  const m0 = of.map();
  check('the map EXISTS on foot (a null map is not a closed map)',
    m0 !== null && typeof m0 === 'object' && m0.error === undefined,
    JSON.stringify(m0));
  check('and it starts closed', m0.open === false, String(m0.open));

  // THE REAL KEY (standing rule 3). DW-36 removed the on-foot refusal, so this
  // is also the acceptance for "M opens the map wherever you are".
  const mapCode = (of.input.bindings().map || [])[0];
  const opens0 = of.map().opens;
  window.dispatchEvent(new KeyboardEvent('keydown', { code: mapCode, bubbles: true }));
  await new Promise((r) => setTimeout(r, 60));
  window.dispatchEvent(new KeyboardEvent('keyup', { code: mapCode, bubbles: true }));
  await sleep(0.4);
  const opened = of.map();
  check('a REAL keyboard event opened the map ON FOOT',
    opened.open === true && opened.opens === opens0 + 1,
    `code ${mapCode}, open ${opened.open}, opens ${opens0} -> ${opened.opens}`);
  check('and it is centred on the PLAYER, not the body (R17)',
    opened.focus.active === 'you'
    && Math.hypot(...opened.focus.centreM) > 1,
    `${opened.focus.active} at |centreM| = `
    + `${Math.hypot(...opened.focus.centreM).toFixed(1)} m`);

  const framesA = MAP().view.frames;
  await sleep(0.3);
  check('IT IS PAINTING: the counter taken inside drawMap advances',
    MAP().view.frames > framesA,
    `${framesA} -> ${MAP().view.frames}`);

  // THE DESTRUCTOR WORKS. Everything in sections 1 and 2 rests on `forget`
  // actually emptying the field, so it is measured rather than trusted: an
  // inert forget would make every rung below read the boot state and the whole
  // ladder would report one number.
  const beforeForget = DISC();
  of.map('forget');
  const afterForget = DISC();
  check('map(\'forget\') EMPTIES the field',
    beforeForget.exploreCells > 0 && afterForget.exploreCells === 0
    && afterForget.surveyCells === 0,
    `${beforeForget.surveyCells}/${beforeForget.exploreCells} -> `
    + `${afterForget.surveyCells}/${afterForget.exploreCells}`);
  check('and an empty field discovers NOTHING, so the gate can bite',
    sandbox || ORE().drawn === 0,
    `drawn ${ORE().drawn} with an empty field`);

  const total = of.game().ore.patches;
  check('/core has ore patches to gate', total > 0, `${total}`);
  if (fails.length > 0) return { valid: false, why: 'setup', mode: m.mode, fails };

  // ===========================================================================
  // 1. THE NEGATIVE CONTROL: a FIXED ladder of standing points.
  //
  // Each rung is `forget` then one observation from D metres away on one
  // bearing, so the discovery field at rung k is a function of k alone and the
  // two runs walk the same ladder. The rungs bracket the on-foot horizon
  // (~1,996 m at the eye height the walker actually has), so the ladder crosses
  // from "none of it" through "some of it" to "all of it".
  // ===========================================================================
  const DEG = 180 / Math.PI;
  const R = of.world().bodyRadiusM;
  const rows0 = ORE().rows.length > 0 ? ORE().rows : null;
  // The cluster centre, from /core's own patch centres. `map('ore')` is gated,
  // so in survival it is empty right now: fall back to the ungated field, which
  // is the same numbers and is what a placement question already reads.
  const centres = rows0 !== null ? rows0.map((p) => p.centre)
    : of.game().ore.list.map((p) => p.centre);
  const c = [0, 0, 0];
  for (const p of centres) for (let k = 0; k < 3; k++) c[k] += p[k] / centres.length;
  const cl = Math.hypot(c[0], c[1], c[2]);
  const lat0 = Math.asin(c[1] / cl) * DEG;
  const lon0 = Math.atan2(c[2], c[0]) * DEG;
  const BEARING = 45;
  const standAt = async (D) => {
    of.map('forget');
    const b = BEARING / DEG;
    of.teleport(lat0 + (D * Math.cos(b) / R) * DEG,
      lon0 + (D * Math.sin(b) / (R * Math.cos(lat0 / DEG))) * DEG, 2);
    await sleep(0.4);
  };
  /** The identity of one drawn patch: /core's raw resource id and its raw,
   *  unrounded centre and initial amount. NOT the array length: a subset test
   *  on counts alone passes for a set that swapped one patch for another. */
  const idOf = (r) => `${r.resource}@${r.centre[0]},${r.centre[1]},`
    + `${r.centre[2]}#${r.initial}`;
  const allIds = of.game().ore.list
    .map((p) => `${p.resource}@${p.centre[0]},${p.centre[1]},${p.centre[2]}`);

  const LADDER = [];
  for (let D = 2600; D >= 1400; D -= 50) LADDER.push(D);
  LADDER.push(0);
  const rungs = [];
  for (const D of LADDER) {
    await standAt(D);
    const o = ORE();
    const r = MAP();
    const d = r.view.drawn;
    rungs.push({
      D, drawn: o.drawn, hidden: o.hidden,
      ids: o.rows.map(idOf),
      // The mode-INDEPENDENT half of the frame. Every one of these must be
      // identical between the two runs; that is the "differs ONLY by the gate"
      // claim, stated as fields rather than as a sentence.
      spanM: r.spanM, focusActive: r.focus.active, focusCentreM: r.focus.centreM,
      pixelsPerMetre: d.pixelsPerMetre,
      // THE WORLD, which is mode-blind: how much of this frame has ground under
      // it, and how big one sample of that ground is. Both must be IDENTICAL
      // across the pair - the same planet is there either way.
      terrainSamples: d.terrainSamples, sampleSizeM: d.sampleSizeM,
      currentPoints: d.currentPoints, plannedPoints: d.plannedPoints,
      surveyCells: DISC().surveyCells, exploreCells: DISC().exploreCells,
      // The mode-DEPENDENT half, recorded but not required to match.
      // `discoveredQuads` is in THIS half now (it was in the one above at
      // WG-29) because it is the gate's output: the samples actually painted.
      discoveredQuads: d.discoveredQuads,
      oreDrawn: d.oreDrawn, alphas: d.alphas, markers: d.markers.slice(),
    });
  }
  const first = rungs[0], last = rungs[rungs.length - 1];
  const partialIdx = rungs.findIndex((x) => x.hidden > 0 && x.drawn > 0);
  const partial = partialIdx < 0 ? null : rungs[partialIdx];

  check('every patch is accounted for at every rung: drawn + hidden = /core\'s count',
    rungs.every((x) => x.drawn + x.hidden === total),
    JSON.stringify(rungs.map((x) => [x.D, x.drawn, x.hidden])));
  check('every drawn patch is one of /core\'s, by identity and not by count',
    rungs.every((x) => x.ids.every((s) => allIds.some((a) => s.startsWith(a)))),
    JSON.stringify(rungs.find((x) => !x.ids.every((s) =>
      allIds.some((a) => s.startsWith(a)))) ?? null));

  if (sandbox) {
    check('SANDBOX hides NOTHING at any rung, including 2.6 km from the ore',
      rungs.every((x) => x.hidden === 0 && x.drawn === total),
      JSON.stringify(rungs.map((x) => [x.D, x.drawn, x.hidden])));
  } else {
    check('SURVIVAL beyond the horizon draws NOTHING and says how much it hid',
      first.drawn === 0 && first.hidden === total,
      `${first.D} m: drawn ${first.drawn}, hidden ${first.hidden} of ${total}`);
    check('SURVIVAL standing on the ore draws ALL of it',
      last.drawn === total && last.hidden === 0,
      `${last.D} m: drawn ${last.drawn}, hidden ${last.hidden}`);
    // THE ROW THAT MATTERS. An empty map is not the feature and neither is a
    // full one: what DW-36 promises is a PARTIAL world, and a run where every
    // patch happened to be discovered would pass a subset test trivially.
    check('SURVIVAL reaches a PARTIAL frame: some drawn AND some hidden',
      partial !== null,
      JSON.stringify(rungs.map((x) => [x.D, x.drawn, x.hidden])));
    check('and the partial frame\'s drawn set is a STRICT subset of the field',
      partial === null || (partial.drawn > 0 && partial.drawn < total),
      partial === null ? 'none' : `${partial.drawn} of ${total} at ${partial.D} m`);
    check('discovery is MONOTONE along the ladder: walking in never hides more',
      rungs.every((x, i) => i === 0 || x.hidden <= rungs[i - 1].hidden),
      JSON.stringify(rungs.map((x) => x.hidden)));
  }
  // THE GROUND IS THERE AT ALL. This is the assertion DW-37 exists for and the
  // one WG-29 could not have made: the map is drawing WORLD, not an empty plane
  // with instruments on it. Both halves are checked because they are different
  // failures - a frame with no ground under it at all (the sampler refused, or
  // the ray solve missed the body) reads nothing like a frame with ground that
  // nothing painted (the mask stuck off).
  check('every rung has GROUND under the view: the sampler found the body',
    rungs.every((x) => x.terrainSamples > 0),
    JSON.stringify(rungs.map((x) => [x.D, x.terrainSamples])));
  check('and TERRAIN WAS PAINTED at every rung, in either mode',
    rungs.every((x) => x.discoveredQuads > 0),
    JSON.stringify(rungs.map((x) => [x.D, x.discoveredQuads])));
  check('a painted sample is always a sample that had ground under it',
    rungs.every((x) => x.discoveredQuads <= x.terrainSamples),
    JSON.stringify(rungs.map((x) => [x.D, x.discoveredQuads, x.terrainSamples])));
  // At the ON-FOOT span the whole view fits inside ONE 9,375 m survey cell, so
  // standing anywhere makes the ground under your feet visible in either mode
  // and this rung CANNOT separate them. Section 1b zooms out until it can, and
  // says so here rather than leaving a reader to wonder why the ladder's terrain
  // numbers agree between the two runs.
  const fully = rungs.filter((x) => x.discoveredQuads === x.terrainSamples).length;
  log.push(`ladder: ${rungs.map((x) => `${x.D}:${x.drawn}/${x.hidden}`).join(' ')}`);
  log.push(`terrain at the foot span: ${fully}/${rungs.length} rungs fully `
    + `painted (${rungs[0].terrainSamples} on-body samples, `
    + `${rungs[0].sampleSizeM} m of ground each)`);

  // ===========================================================================
  // 2. THE FIELD SURVIVES A SAVE AND A RELOAD (DW-17).
  //
  // probes/persist.js's shape, and its warning: saving and immediately loading
  // proves nothing because the live world already holds the answer. So the
  // field is DESTROYED in between, and the assertion is that the counts come
  // back EXACTLY and that the GATE'S OWN ANSWER comes back — still true at the
  // direction that was observed, still false at one that never was.
  // ===========================================================================
  const persistRung = partial !== null ? partial.D
    : LADDER[Math.max(0, LADDER.length - 2)];
  await standAt(persistRung);
  const saved = { disc: DISC(), ore: ORE() };
  const savedState = {
    surveyCells: saved.disc.surveyCells, exploreCells: saved.disc.exploreCells,
    saveBytes: saved.disc.saveBytes, drawn: saved.ore.drawn,
    hidden: saved.ore.hidden, ids: saved.ore.rows.map(idOf),
  };
  const written = await of.save();
  check('the slot was written', written !== null, JSON.stringify(written));

  // THE DESTRUCTION.
  of.map('forget');
  const wrecked = { disc: DISC(), ore: ORE() };
  check('the field was really destroyed before the load',
    wrecked.disc.surveyCells === 0 && wrecked.disc.exploreCells === 0,
    `${wrecked.disc.surveyCells}/${wrecked.disc.exploreCells}`);
  check('and with it the gate\'s answer, so the restore cannot pass on memory',
    sandbox || wrecked.ore.drawn === 0,
    `drawn ${wrecked.ore.drawn} after forget`);

  const ledger = await of.load();
  await sleep(0.3);
  const back = { disc: DISC(), ore: ORE() };
  const restored = of.game().persist.restored;
  const backState = {
    surveyCells: back.disc.surveyCells, exploreCells: back.disc.exploreCells,
    saveBytes: back.disc.saveBytes, drawn: back.ore.drawn,
    hidden: back.ore.hidden, ids: back.ore.rows.map(idOf),
  };
  check('EXACTLY the same cell counts came back (===, not near)',
    backState.surveyCells === savedState.surveyCells
    && backState.exploreCells === savedState.exploreCells,
    `${savedState.surveyCells}/${savedState.exploreCells} -> `
    + `${backState.surveyCells}/${backState.exploreCells}`);
  check('and the same bytes, so the set is the set and not a superset',
    backState.saveBytes === savedState.saveBytes,
    `${savedState.saveBytes} -> ${backState.saveBytes}`);
  check('and the GATE still answers the same way, patch for patch',
    backState.drawn === savedState.drawn && backState.hidden === savedState.hidden
    && backState.ids.join('|') === savedState.ids.join('|'),
    `${savedState.drawn}/${savedState.hidden} -> `
    + `${backState.drawn}/${backState.hidden}`);
  // DW-36's three-state ledger: 0 means the slot carried none, -1 means /core
  // REFUSED the stream and the world silently forgot where the player had been.
  check('the ledger says cells came back',
    restored !== null && restored.discovery > 0,
    JSON.stringify(restored === null ? null : restored.discovery));
  check('and /core did NOT refuse the stream (-1 is a lost world, not a zero)',
    restored !== null && restored.discovery !== -1,
    JSON.stringify(restored === null ? null : restored.discovery));

  // THE OTHER HALF OF `has()`: a direction that was never visited must still be
  // dark after the restore. The far rung is that direction, and it is checked
  // by re-observing from beyond the horizon: a restore that had quietly turned
  // the whole body on would fail here and nowhere else.
  await standAt(LADDER[0]);
  const dark = ORE();
  check('a direction never visited is STILL dark after a restore',
    sandbox || (dark.drawn === 0 && dark.hidden === total),
    `drawn ${dark.drawn}, hidden ${dark.hidden}`);
  log.push(`persist: ${savedState.surveyCells}/${savedState.exploreCells} cells, `
    + `${savedState.saveBytes} B -> forget -> ${backState.surveyCells}/`
    + `${backState.exploreCells}, ledger.discovery ${restored?.discovery}`);

  // ===========================================================================
  // 3. A WORLD WORTH SWEEPING, and the sample interval's own two checks.
  //
  // The ladder above leaves ONE survey cell discovered, which is neither a
  // picture nor a cost. AND IT CANNOT BE FIXED FROM ALTITUDE ON FOOT: the
  // walker is clamped to the ground, so `of.teleport(lat, lon, 20000)` reports
  // an altitude of 1.62 m and sweeps the same 1,996 m disc as standing still
  // (measured: fourteen stops at a nominal 20 km gave fourteen survey cells,
  // exactly what fourteen ground stops give). A survey cell is 9,375 m across
  // and a ground observation discovers a cell only when its CENTRE is inside
  // that disc, so ON FOOT the coarse grid fills at about ONE CELL PER STOP.
  // That is discovery.h's design working: filling in the shape of the world is
  // an ORBITAL activity. So the grid below is walked out at a cell's spacing
  // and the cost section says plainly what it could and could not reach.
  // ===========================================================================
  const CELL_M = DISC().surveyCellSizeM;
  const GRID = 7;
  for (let i = 0; i < GRID; i++) {
    for (let j = 0; j < GRID; j++) {
      const dLat = ((i - (GRID - 1) / 2) * CELL_M / R) * DEG;
      const dLon = ((j - (GRID - 1) / 2) * CELL_M / (R * Math.cos(lat0 / DEG))) * DEG;
      of.teleport(lat0 + dLat, lon0 + dLon, 2);
      await sleep(1.1);
    }
  }
  of.teleport(lat0, lon0, 2);
  await sleep(1.2);
  const surveyed = DISC();
  check('the walked survey grid filled the coarse grid in',
    surveyed.surveyCells >= GRID * GRID,
    `${surveyed.surveyCells} survey cells from ${GRID * GRID} stops`);

  // THE SAMPLE INTERVAL IS DERIVED, NOT COPIED (Discovery.ts's header): 1 Hz is
  // sound only while the observer cannot move further between samples than one
  // sample sweeps. Two things are therefore checked, and they are different
  // claims: that the INTERVAL IS THE INTERVAL, and that the gap it leaves is
  // closed. The first is checked first because the second cannot mean anything
  // without it -- a sampler running every frame reports a `gapRatio` measured
  // between consecutive FRAMES, which is 8 cm over a 1,996 m sweep and passes
  // any bound whatsoever.
  //
  // The map is SHUT for the walk: `setUiCapture` mutes the movement keys while
  // a panel owns the pointer, so walking with it open measures the capture.
  of.input.act(['map'], 4);
  await sleep(0.3);
  const passes0 = DISC().passes, secs0 = of.world().tick / 60;
  for (let i = 0; i < 6; i++) {
    of.input.tape([{ hold: 55, keys: ['KeyW'] }, { hold: 4, keys: [] }]);
    await sleep(1.0);
  }
  const walked = DISC();
  const secs1 = of.world().tick / 60;
  const rate = (walked.passes - passes0) / Math.max(1e-9, secs1 - secs0);
  check('the observer is sampled at the 1 Hz interval Discovery.ts derives',
    rate <= 1.5, `${rate.toFixed(1)} passes per SIM second over `
    + `${(secs1 - secs0).toFixed(1)} s (SAMPLE_S is 1.0, so 1.0 is the answer; `
    + `60 means the interval is not in force at all)`);
  check('and the interval leaves NO GAP along a walked track',
    walked.gapRatio > 0 && walked.gapRatio < 1, `gapRatio ${walked.gapRatio}`);
  of.input.act(['map'], 4);
  await sleep(0.4);
  check('the map is open again for the sweep', MAP().open === true);
  log.push(`sampling: ${rate.toFixed(1)} passes/sim-second, gapRatio `
    + `${walked.gapRatio}, ${surveyed.surveyCells} survey cells`);

  // ===========================================================================
  // 3b. THE TERRAIN NEGATIVE CONTROL, at a span WIDE ENOUGH TO BITE.
  //
  // Section 1's ladder cannot test the terrain mask, because at the 600 m foot
  // span the whole view sits inside ONE 9,375 m survey cell: stand anywhere and
  // the ground under you is visible in either mode. So it is done HERE, after
  // the walked grid above has given the discovered set a real shape, by zooming
  // out until the view is many cells across. The claim is then exact:
  //
  //     SANDBOX paints every sample that has ground under it.
  //     SURVIVAL paints strictly fewer, because it has not been everywhere.
  //
  // Both halves are checked in EACH run, so neither run can pass by being the
  // other one, and the painter's count is checked against /core's own count of
  // what the mask allows - two independent reads of one answer, the way the ore
  // rows are done.
  // ===========================================================================
  const zoomTo = async (wantM) => {
    for (let i = 0; i < 400 && MAP().spanM > wantM * ZOOM; i++) {
      of.map('zoom', { mult: 1 / ZOOM }); await sleep(0.03);
    }
    for (let i = 0; i < 400 && MAP().spanM < wantM / ZOOM; i++) {
      of.map('zoom', { mult: ZOOM }); await sleep(0.03);
    }
    await sleep(0.25);
    return MAP().spanM;
  };
  const wideSpanM = await zoomTo(1.5e5);
  const wideD = DRAWN();
  const wideT = of.map('disc').terrain;
  const wide = { spanM: Math.round(wideSpanM), painted: wideD.discoveredQuads,
    onBody: wideD.terrainSamples, sampleSizeM: wideD.sampleSizeM,
    seenOnBody: wideT.seenOnBody, samples: wideT.samples,
    grid: `${wideT.cols}x${wideT.rows}`, rebuildMs: wideT.rebuildMs,
    cacheHitRate: wideT.cacheHitRate,
    surveyCells: DISC().surveyCells };
  check('at a wide span there is still real ground in the frame',
    wide.onBody > 0, JSON.stringify(wide));
  check('the painter drew exactly what the SURVEY MASK allows',
    wide.painted === (sandbox ? wide.onBody : wide.seenOnBody),
    JSON.stringify(wide));
  if (sandbox) {
    check('SANDBOX paints every sample that has ground under it',
      wide.painted === wide.onBody, JSON.stringify(wide));
  } else {
    check('SURVIVAL paints STRICTLY FEWER samples than there is ground',
      wide.painted > 0 && wide.painted < wide.onBody, JSON.stringify(wide));
  }
  log.push(`terrain wide: span ${wide.spanM} m, painted ${wide.painted} of `
    + `${wide.onBody} on-body of ${wide.samples} (${wide.grid} grid, `
    + `${wide.rebuildMs} ms/rebuild, hit rate ${wide.cacheHitRate})`);
  // BACK TO THE FOOT SPAN before section 4 sweeps. The sweep runs 110 notches
  // out from wherever it starts, and its "every alpha reaches 1" check needs
  // the close end of the continuum, so leaving it parked 150 km out would have
  // silently moved the whole sweep and failed a check about the ore.
  await zoomTo(600);

  // ===========================================================================
  // 4. THE ZOOM CONTINUUM, PROVEN AS A CONTINUUM.
  //
  // The claim is that there is no threshold anywhere: what is drawn is a
  // continuous function of scale. A `if (span > X) return` in the painter shows
  // up here as a 1 -> 0 step in an alpha, and that is exactly how this probe
  // found one: `MapWorld.shading`'s window selects cells on their CENTRE, and
  // its margin was a fraction of the SPAN, so a survey cell WIDER than the view
  // was dropped entirely and `alphas.discovered` stepped 0 -> 1 in one notch.
  // ===========================================================================
  const sample = () => {
    const r = MAP();
    const d = r.view.drawn;
    return {
      spanM: r.spanM, ppm: d.pixelsPerMetre,
      a: { ...d.alphas }, q: d.discoveredQuads, o: d.oreDrawn,
      // The terrain layer's own feature size, THIS frame. The alpha prediction
      // in (d) is taken from this rather than from a survey cell edge: the
      // feature the ramp measures is now a SAMPLE of ground (DW-37).
      ss: d.sampleSizeM, tn: d.terrainSamples,
      f: d.bodyFilled, m: d.markers.slice(),
    };
  };
  const STEPS = 110;
  const OUT = [sample()], BACK = [];
  for (let i = 0; i < STEPS; i++) {
    of.map('zoom', { mult: ZOOM });
    await sleep(0.05);
    OUT.push(sample());
  }
  for (let i = 0; i < STEPS; i++) {
    of.map('zoom', { mult: 1 / ZOOM });
    await sleep(0.05);
    BACK.push(sample());
  }
  const LAYERS = ['ore', 'discovered', 'body'];

  // (a) MONOTONE. Zooming out never makes a feature MORE opaque.
  const mono = { out: [], back: [] };
  for (let i = 1; i < OUT.length; i++) {
    if (!(OUT[i].ppm < OUT[i - 1].ppm)) mono.out.push(`ppm at ${i}`);
    for (const k of LAYERS) if (OUT[i].a[k] > OUT[i - 1].a[k]) mono.out.push(`${k} at ${i}`);
  }
  for (let i = 1; i < BACK.length; i++) {
    if (!(BACK[i].ppm > BACK[i - 1].ppm)) mono.back.push(`ppm at ${i}`);
    for (const k of LAYERS) if (BACK[i].a[k] < BACK[i - 1].a[k]) mono.back.push(`${k} at ${i}`);
  }
  check('every alpha is MONOTONE in pixels-per-metre, out and back',
    mono.out.length === 0 && mono.back.length === 0,
    JSON.stringify(mono));

  // (b) NO STEP LARGER THAN THE RAMP ALLOWS. The bound came from `stepBound`
  //     at the top of this file, which is the ramp's own supremum under a 1.15
  //     notch. A hard cut anywhere fails here even if it happened to be
  //     monotone (a 1 -> 0 drop is monotone).
  const worst = { ore: 0, discovered: 0, body: 0 };
  const worstAt = {};
  for (const seq of [OUT, BACK]) {
    for (let i = 1; i < seq.length; i++) {
      for (const k of LAYERS) {
        const d = Math.abs(seq[i].a[k] - seq[i - 1].a[k]);
        if (d > worst[k]) { worst[k] = d; worstAt[k] = seq[i].spanM; }
      }
    }
  }
  check('no single notch moves an alpha further than the ramp permits',
    LAYERS.every((k) => worst[k] <= BOUND[k] * (1 + 1e-9) + 1e-12),
    JSON.stringify({ worst, bound: BOUND, at: worstAt }));

  // (c) THE RAMP IS NOT DEAD CODE: the two layers with a fixed feature size
  //     reach BOTH ends. THE TERRAIN LAYER CANNOT AND MUST NOT (DW-37), and
  //     that is a property rather than an exemption. Its feature is a SAMPLE
  //     of ground, and the grid is cut to the canvas, so a sample's ground size
  //     scales with the span exactly as pixels-per-metre falls: its size in
  //     PIXELS is min(cssW, cssH) / n at every zoom. So its alpha is invariant
  //     under zoom, which is the strongest possible form of "no threshold" -
  //     stronger than a ramp, because there is nothing left to step. It is
  //     asserted as EXACTLY CONSTANT across all 220 notches, and (d) below
  //     still predicts it bit for bit from its own feature size.
  const ends = {};
  for (const k of LAYERS) {
    ends[k] = {
      zero: OUT.some((s) => s.a[k] === 0) || BACK.some((s) => s.a[k] === 0),
      one: OUT.some((s) => s.a[k] === 1) || BACK.some((s) => s.a[k] === 1),
    };
  }
  check('the ore and body alphas reach exactly 0 and exactly 1 in the sweep',
    ['ore', 'body'].every((k) => ends[k].zero && ends[k].one),
    JSON.stringify(ends));
  const aT = OUT[0].a.discovered;
  const varies = [...OUT, ...BACK].filter((s) => s.a.discovered !== aT);
  check('the TERRAIN alpha is invariant under zoom, exactly, at every notch',
    varies.length === 0 && aT > 0,
    `alpha ${aT}, ${varies.length} of ${OUT.length + BACK.length} differ`);
  // And the reason it is invariant is checkable too: the sample's PIXEL size is
  // what is constant, not its metres, which is the sentence above stated as an
  // arithmetic identity over the whole sweep.
  const pxOf = (x) => x.ss * x.ppm;
  const px0 = pxOf(OUT[0]);
  const pxBad = [...OUT, ...BACK].filter(
    (x) => Math.abs(pxOf(x) - px0) > 1e-9 * px0);
  check('because a terrain sample is the SAME NUMBER OF PIXELS at every zoom',
    pxBad.length === 0 && px0 > 0,
    `${px0.toFixed(6)} px, ${pxBad.length} samples differ`);

  // (d) THE ALPHAS ARE THE ONE RAMP AND NOTHING ELSE. The strongest form of
  //     "there is no second scale rule": the painted opacity is predicted here,
  //     bit for bit, from the reported pixels-per-metre and the feature's own
  //     size. A second branch anywhere would show up as one sample that does
  //     not equal its prediction.
  const oreRows = ORE().rows;
  let wideM = 0;
  for (const p of oreRows) wideM = Math.max(wideM, 2 * p.radiusM);
  const bodyM = 2 * R;
  const predicted = [];
  for (const seq of [OUT, BACK]) {
    for (const s of seq) {
      if (s.a.ore !== sizeAlpha(wideM, s.ppm, RAMP.ore[0], RAMP.ore[1])) {
        predicted.push(`ore@${s.spanM.toExponential(3)}`);
      }
      if (s.a.body !== sizeAlpha(bodyM, s.ppm, RAMP.body[0], RAMP.body[1])) {
        predicted.push(`body@${s.spanM.toExponential(3)}`);
      }
      // FROM THE FRAME'S OWN SAMPLE SIZE. The feature changed (a survey cell
      // edge became a sample of ground) and the ramp did not, which is the
      // point: one function, taking whatever the layer's feature happens to be.
      if (s.a.discovered
        !== sizeAlpha(s.ss, s.ppm, RAMP.discovered[0], RAMP.discovered[1])) {
        predicted.push(`discovered@${s.spanM.toExponential(3)}`);
      }
    }
  }
  check('every painted alpha IS sizeAlpha of its own feature size, exactly',
    predicted.length === 0,
    `${predicted.length} of ${(OUT.length + BACK.length) * 3}: `
    + JSON.stringify(predicted.slice(0, 6)));

  // (e) REVERSIBLE. N notches out and N back returns the same scale. The bound
  //     is 2 * N * Number.EPSILON, which is the accumulated rounding of 2N
  //     multiplications and is derived from the arithmetic rather than measured.
  const a0 = OUT[0], aN = BACK[BACK.length - 1];
  const relPpm = Math.abs(aN.ppm - a0.ppm) / a0.ppm;
  check('the sweep is REVERSIBLE to within its own floating-point noise',
    relPpm <= 2 * (2 * STEPS) * Number.EPSILON,
    `${relPpm.toExponential(3)} over ${2 * STEPS} notches, `
    + `budget ${(2 * (2 * STEPS) * Number.EPSILON).toExponential(3)}`);
  check('and the alphas came back IDENTICAL',
    LAYERS.every((k) => aN.a[k] === a0.a[k]),
    JSON.stringify({ start: a0.a, end: aN.a }));

  // (f) THE FILL SWITCH IS INVISIBLE. `discCoversCanvas` is a geometric fact
  //     about one frame, not a zoom mode, and its two branches paint the same
  //     pixels. So it may flip at most once in each direction, it must flip at
  //     the SAME pair of spans both ways (no hysteresis), and at the flip the
  //     drawn content must not change.
  //
  //     The one marker that DOES legitimately leave is `air`: `paintBody` skips
  //     the atmosphere annulus once the body provably covers the canvas, at
  //     which point the annulus is entirely OFF that canvas and painted zero
  //     pixels either way. Asserting the whole marker list unchanged would have
  //     been asserting that a receipt for an invisible layer is still filed.
  const flips = (seq) => {
    const at = [];
    for (let i = 1; i < seq.length; i++) if (seq[i].f !== seq[i - 1].f) at.push(i);
    return at;
  };
  const fOut = flips(OUT), fBack = flips(BACK);
  const bare = (s) => s.m.map((x) => String(x).split(':')[0]);
  const delta = (i, seq) => {
    const p = new Set(bare(seq[i - 1])), n = new Set(bare(seq[i]));
    return [...new Set([...p, ...n])].filter((x) => p.has(x) !== n.has(x));
  };
  check('the fill switch flips at most once in each direction',
    fOut.length <= 1 && fBack.length <= 1,
    `out ${JSON.stringify(fOut)}, back ${JSON.stringify(fBack)}`);
  const bracketOut = fOut.length === 1
    ? [OUT[fOut[0] - 1].spanM, OUT[fOut[0]].spanM].sort((x, y) => x - y) : null;
  const bracketBack = fBack.length === 1
    ? [BACK[fBack[0] - 1].spanM, BACK[fBack[0]].spanM].sort((x, y) => x - y) : null;
  check('and it flips at the SAME span both ways: no hysteresis',
    bracketOut !== null && bracketBack !== null
    && Math.abs(bracketOut[0] - bracketBack[0]) <= 1e-6 * bracketOut[0]
    && Math.abs(bracketOut[1] - bracketBack[1]) <= 1e-6 * bracketOut[1],
    JSON.stringify({ out: bracketOut, back: bracketBack }));
  const flipInfo = [];
  for (const [name, at, seq] of [['out', fOut, OUT], ['back', fBack, BACK]]) {
    if (at.length !== 1) continue;
    const i = at[0];
    const d = delta(i, seq);
    flipInfo.push({ dir: name, spanM: seq[i].spanM, markerDelta: d,
      q: [seq[i - 1].q, seq[i].q], o: [seq[i - 1].o, seq[i].o],
      tn: [seq[i - 1].tn, seq[i].tn] });
    check(`the ${name} fill flip changes nothing but the air receipt`,
      d.every((x) => x === 'air'), JSON.stringify(d));
    check(`the ${name} fill flip draws exactly the same ORE`,
      seq[i].o === seq[i - 1].o,
      `ore ${seq[i - 1].o}->${seq[i].o}`);
    // AND THE TERRAIN COUNT MUST MOVE HERE, which is the opposite of what this
    // row used to assert and is a stronger check than the one it replaces.
    //
    // WG-29 asserted `discoveredQuads` UNCHANGED across the flip, because the
    // discovery quads in view happened not to change over one notch. The
    // terrain grid is different: `discCoversCanvas` is true exactly while the
    // body covers every canvas CORNER, so the notch that flips it is by
    // definition the notch at which the corners leave the body - and a sample
    // off the limb has no ground under it and is not counted. The two are the
    // same geometric fact computed in two entirely separate places: the flip
    // from the projected radius in the painter, the count from /core's own
    // ray-sphere solve per sample. If they disagreed, one of them would be
    // wrong about where the limb is.
    const shrank = name === 'out' ? seq[i].tn < seq[i - 1].tn
      : seq[i].tn > seq[i - 1].tn;
    check(`the ${name} fill flip is the LIMB entering the frame, in /core's `
      + `count as well as in the painter's projection`,
      shrank, `on-body ${seq[i - 1].tn} -> ${seq[i].tn}`);
  }

  // A REAL DOM WHEEL on the real canvas: MapView binds it to the same `zoom`
  // hook the buttons call, and 1.25 / 0.8 are its own constants.
  const canvas = document.querySelector('#of-map canvas.map-canvas');
  const wheelBefore = MAP().spanM;
  if (canvas !== null) {
    canvas.dispatchEvent(new WheelEvent('wheel',
      { bubbles: true, cancelable: true, deltaY: 120 }));
  }
  await sleep(0.15);
  const wheelAfter = MAP().spanM;
  check('a REAL DOM wheel on the canvas zooms the map out by its own factor',
    canvas !== null && wheelAfter > wheelBefore
    && Math.abs(wheelAfter - wheelBefore * 1.25) <= 1.5,
    `${wheelBefore} -> ${wheelAfter} (want ${Math.round(wheelBefore * 1.25)})`);
  if (canvas !== null) {
    canvas.dispatchEvent(new WheelEvent('wheel',
      { bubbles: true, cancelable: true, deltaY: -120 }));
  }
  await sleep(0.15);

  // ===========================================================================
  // 5. THE ORE COUNTS ARE /core's, FIELD BY FIELD, AGAINST RAW INTEGERS.
  //
  // `map('ore').rows` is `of_gp_patch_state` carried across unrounded, and it
  // is the array the painter is handed. The SECOND reader is `of.game().ore`,
  // which calls `of_gp_patch_state` again for every row. So this compares two
  // independent reads of the same /core record rather than one value against
  // itself.
  //
  // WHAT THE COMPARISON CAN AND CANNOT BE, said plainly: `OreField.report()`
  // ROUNDS for display (`Math.round` on the amounts, `toFixed(2)` and
  // `toFixed(3)` on the radius and the grade). The identity asserted is
  // therefore the EXACT INVERSE of that known transform, on raw doubles, and
  // never a tolerance and never a parsed string. `resource` and `centre` cross
  // unrounded on both sides and are compared with ===.
  // ===========================================================================
  // ON the first patch's own centre, not on the cluster centroid: a dig pays
  // only where the strike lands INSIDE a patch (probes/digore.js), and the
  // centroid of four patches is in none of them.
  const t0centre = of.game().ore.list[0].centre;
  const tr = Math.hypot(t0centre[0], t0centre[1], t0centre[2]);
  const tlat = Math.asin(t0centre[1] / tr) * DEG;
  const tlon = Math.atan2(t0centre[2], t0centre[0]) * DEG;
  // NO forget here: section 3's walked grid is the field section 6 measures the
  // cost of, and it already covers the cluster.
  of.teleport(tlat, tlon, 2);
  await sleep(1.2);
  const compare = () => {
    const drawnRows = ORE().rows;
    const core = of.game().ore.list;
    const bad = [];
    const table = [];
    for (const r of drawnRows) {
      const p = core.find((q) => q.centre[0] === r.centre[0]
        && q.centre[1] === r.centre[1] && q.centre[2] === r.centre[2]);
      if (p === undefined) { bad.push(`no /core row at ${r.centre.join(',')}`); continue; }
      const row = {
        resource: [r.resource, p.resource],
        remaining: [r.remaining, p.remaining],
        initial: [r.initial, p.initial],
        grade: [r.grade, p.grade],
        radiusM: [r.radiusM, p.radiusM],
      };
      table.push(row);
      if (r.resource !== p.resource) bad.push(`resource ${r.resource}/${p.resource}`);
      if (Math.round(r.remaining) !== p.remaining) bad.push(`remaining ${r.remaining}/${p.remaining}`);
      if (Math.round(r.initial) !== p.initial) bad.push(`initial ${r.initial}/${p.initial}`);
      if (+r.grade.toFixed(3) !== p.grade) bad.push(`grade ${r.grade}/${p.grade}`);
      if (+r.radiusM.toFixed(2) !== p.radiusM) bad.push(`radius ${r.radiusM}/${p.radiusM}`);
    }
    return { bad, table, n: drawnRows.length };
  };
  const before = compare();
  check('every drawn row matches /core field for field, before mining',
    before.n === total && before.bad.length === 0,
    `${before.n} rows: ${JSON.stringify(before.bad)}`);

  // AND THE PAINTER'S OWN COPY. `oreDrawnRows` is filled inside the paint pass,
  // so this is the far end of the same path: the integers that were actually
  // stamped on the canvas, against the integers the gate handed over.
  const stamped = DRAWN().oreDrawnRows;
  const handed = ORE().rows;
  check('and the numbers the PAINTER stamped are those raw numbers, exactly',
    stamped.length === handed.length
    && stamped.every((s, i) => s.resource === handed[i].resource
      && s.remaining === handed[i].remaining && s.initial === handed[i].initial),
    `${stamped.length} stamped vs ${handed.length} handed`);

  // NOW MINE IT. A snapshot that agrees once and then goes stale is the failure
  // mode, so the same comparison is run again after the ground has moved.
  of.input.act(['map'], 4);      // a dig needs the world, not a panel
  await sleep(0.3);
  const nameOf = (id) => (handed.find((r) => r.resource === id) ?? {}).name ?? '';
  const target = handed[0];
  const held = (n) => (of.game().carried.find((c) => c.name === n) ?? { count: 0 }).count;
  const oreName = nameOf(target.resource);
  const packBefore = held(oreName);
  const poolBefore = ORE().rows.find((r) => r.resource === target.resource).remaining;
  let strikes = 0, paid = 0;
  for (let k = 0; k < 20; ++k) {
    of.look(k * 18, -78);
    await sleep(0.08);
    const d = of.dig();
    if (d === null || d.cells <= 0) continue;
    strikes++;
    if (of.voxels().action.lastOre > 0) paid++;
  }
  await sleep(0.4);
  of.input.act(['map'], 4);
  await sleep(0.4);
  const poolAfter = ORE().rows.find((r) => r.resource === target.resource).remaining;
  const gained = held(oreName) - packBefore;
  const mining = {
    resource: oreName, strikes, paid, packGained: gained,
    poolBefore, poolAfter, poolFell: poolBefore - poolAfter,
  };
  check('mining MOVED the map\'s own number', paid > 0 && poolAfter < poolBefore,
    JSON.stringify(mining));
  check('and the map fell by exactly what the pack gained (ONE POOL, DW-25)',
    Math.abs(mining.poolFell - gained) < 1e-9,
    `pack +${gained}, patch -${mining.poolFell}`);
  const after = compare();
  check('and the map still matches /core field for field AFTER mining',
    after.n === total && after.bad.length === 0,
    `${after.n} rows: ${JSON.stringify(after.bad)}`);
  const stamped2 = DRAWN().oreDrawnRows;
  check('and so does the number the painter stamped this frame',
    stamped2.some((s) => s.resource === target.resource
      && s.remaining === poolAfter),
    JSON.stringify(stamped2));

  // ===========================================================================
  // 6. FRAME COST AT BOTH EXTREMES OF ZOOM (probes/cost.js's method).
  //
  // A timed run of rendered frames end to end with one read-back at the finish
  // to flush the GPU queue, A/B'd against the SAME framing with the map shut.
  // The difference is the map. The bound is the 60 Hz FRAME BUDGET, 16.67 ms,
  // which is the rate the loop is written to and not a number chosen here.
  // ===========================================================================
  const timeFrames = async (secs) => {
    await of.run(1.0, 60);
    const start = performance.now();
    await of.run(secs, 60);
    of.framehash(8, 8);
    return (performance.now() - start) / (secs * 60);
  };
  const setSpan = async (wantM) => {
    for (let i = 0; i < 400 && MAP().spanM > wantM * ZOOM; i++) {
      of.map('zoom', { mult: 1 / ZOOM });
      await sleep(0.02);
    }
    for (let i = 0; i < 400 && MAP().spanM < wantM / ZOOM; i++) {
      of.map('zoom', { mult: ZOOM });
      await sleep(0.02);
    }
    await sleep(0.2);
    return MAP().spanM;
  };
  const SECS = 4;
  const surfaceSpan = await setSpan(600);
  const msSurfaceOpen = await timeFrames(SECS);
  const surfaceDrawn = { ...DRAWN(), oreDrawnRows: undefined, markers: DRAWN().markers };
  const orbitalSpan = await setSpan(1.8e6);
  const msOrbitalOpen = await timeFrames(SECS);
  const orbitalDrawn = { ...DRAWN(), oreDrawnRows: undefined, markers: DRAWN().markers };
  of.input.act(['map'], 4);
  await sleep(0.3);
  check('the map is shut for the control window', MAP().open === false);
  const msClosed = await timeFrames(SECS);
  of.input.act(['map'], 4);
  await sleep(0.3);
  const cost = {
    msClosed: +msClosed.toFixed(4),
    surface: { spanM: Math.round(surfaceSpan), msOpen: +msSurfaceOpen.toFixed(4),
      mapMs: +(msSurfaceOpen - msClosed).toFixed(4),
      painted: surfaceDrawn.discoveredQuads,
      onBody: surfaceDrawn.terrainSamples, ore: surfaceDrawn.oreDrawn },
    orbital: { spanM: Math.round(orbitalSpan), msOpen: +msOrbitalOpen.toFixed(4),
      mapMs: +(msOrbitalOpen - msClosed).toFixed(4),
      painted: orbitalDrawn.discoveredQuads,
      onBody: orbitalDrawn.terrainSamples, ore: orbitalDrawn.oreDrawn },
    terrain: of.map('disc').terrain,
    frameBudgetMs: 1000 / 60,
  };
  check('the map costs less than one 60 Hz frame at BOTH extremes of zoom',
    cost.surface.mapMs < cost.frameBudgetMs
    && cost.orbital.mapMs < cost.frameBudgetMs, JSON.stringify(cost));
  // THE OLD FORM OF THIS CHECK WAS `orbital.quads > surface.quads` AND IT WAS
  // ABOUT THE QUAD LAYER: more discovery cells fall inside a wider view, so the
  // zoomed-out frame drew more of them. The terrain grid is a FIXED number of
  // samples cut to the canvas, so the relation inverts and the honest statement
  // of the same fact is about the LIMB: zoomed to the surface every sample has
  // ground under it, and zoomed to the whole body a real fraction of the frame
  // is space. Restating it rather than deleting it, because the thing it was
  // guarding - that the two framings are genuinely different pictures and not
  // the same one measured twice - is still worth guarding.
  check('the surface framing is ALL ground and the orbital one has a limb',
    cost.surface.onBody === cost.surface.painted
    && cost.orbital.onBody > 0
    && cost.orbital.onBody < cost.surface.onBody,
    `surface ${cost.surface.painted}/${cost.surface.onBody} on-body, `
    + `orbital ${cost.orbital.painted}/${cost.orbital.onBody}`);
  log.push(`cost: closed ${cost.msClosed} ms/frame, surface +`
    + `${cost.surface.mapMs} (${cost.surface.painted}/${cost.surface.onBody} `
    + `samples), orbital +${cost.orbital.mapMs} `
    + `(${cost.orbital.painted}/${cost.orbital.onBody})`);

  // ===========================================================================
  // 7. FRAME THE CAPTURE. Same world, same seed, three zooms, so the three
  //    screenshots read as one continuum rather than as three launches.
  // ===========================================================================
  if (SHOT !== '') {
    const want = SHOT === 'surface' ? 400 : SHOT === 'regional' ? 60000 : 3.2e6;
    await setSpan(want);
    await sleep(0.6);
  }

  const advanced = of.world().tick - t0;
  check('the simulation advanced', advanced > 2000, `${advanced} ticks`);

  return {
    valid: fails.length === 0,
    // FIRST, because every number below means the opposite thing in the other
    // mode and a reader who missed this line would draw the wrong conclusion.
    mode: m.mode,
    urlFlag: urlSandbox,
    fullMapRevealed: m.fullMapRevealed,
    fails,
    log,
    advanced: { ticks: advanced, patches: total },
    negativeControl: { bearingDeg: BEARING, partialIndex: partialIdx,
      partial, rungs },
    // The rung the terrain gate can actually be seen at (section 1b).
    terrainWide: wide,
    persistence: { saved: savedState, wrecked: {
      surveyCells: wrecked.disc.surveyCells,
      exploreCells: wrecked.disc.exploreCells, drawn: wrecked.ore.drawn },
      back: backState, ledger, restoredDiscovery: restored?.discovery ?? null },
    zoom: {
      steps: STEPS, factor: ZOOM,
      spanFromM: OUT[0].spanM, spanToM: OUT[OUT.length - 1].spanM,
      worstStep: worst, stepBound: BOUND, ends,
      reversibleRel: relPpm, flips: flipInfo,
      // Every tenth sample, so the table is readable and still shows the shape.
      table: OUT.filter((_, i) => i % 10 === 0 || i === OUT.length - 1)
        .map((s) => ({ spanM: +s.spanM.toPrecision(4), ppm: +s.ppm.toPrecision(4),
          ore: +s.a.ore.toFixed(4), disc: +s.a.discovered.toFixed(4),
          body: +s.a.body.toFixed(4), quads: s.q, ore_n: s.o, filled: s.f })),
    },
    oreFields: { before: before.table, after: after.table, mining },
    cost,
    disc: of.map('disc').discovery,
    shot: SHOT,
    note: sandbox
      ? 'sandbox half. The negative control is this same file run WITHOUT '
        + '--sandbox=1. Diff `negativeControl.rungs` rung for rung: `ids` must '
        + 'be a SUPERSET of survival\'s, and spanM / focusCentreM / '
        + 'pixelsPerMetre / terrainSamples / sampleSizeM / currentPoints / '
        + 'plannedPoints / surveyCells / exploreCells must be IDENTICAL. '
        + '`discoveredQuads` is NO LONGER in the identical list (DW-37): it is '
        + 'the samples the survey mask let through, so it is >= survival\'s at '
        + 'every rung and STRICTLY GREATER at `terrainWide`.'
      : 'survival half (the negative control). Now run it with --sandbox=1.',
  };
})()
