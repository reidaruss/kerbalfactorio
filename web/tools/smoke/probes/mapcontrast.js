// MAPCONTRAST (WG-34): DOES THE CLOSE-IN MAP CARRY ANY INFORMATION?
//
//   node tools/smoke/run.mjs --url=http://127.0.0.1:5421/ --sandbox=1 \
//     --scenario=walk --settle=6 --evalfile=tools/smoke/probes/mapcontrast.js \
//     --out=docs/screenshots/WG34_contrast.png
//
// WHY IT EXISTS. `mapshot.js`'s own header says a structural check cannot
// replace looking and looking cannot replace a count (DW-7). DW-37 shipped the
// first half of that proving itself: at a 454 m span the surface map painted
// 2,784 of 2,784 on-body samples, every alpha was 1, nothing refused, every
// count was green, and the picture was a featureless wash. `painted == onBody`
// was true and worthless. This is the count that can fail a blank picture.
//
// IT ASSERTS OVER A LADDER OF SITES, NOT ONE FRAME, and that is the whole
// design. One frame is not a sample of anything, and this world contains a
// frame that is SUPPOSED to be blank: Forge's start pad is 300 m of dead-level
// ground (`BodyParams.homeFlatRadiusM = 150`) blended back to natural by 600 m,
// so the DEFAULT 454 m view is mostly an artificial apron and a relief map of an
// apron is honestly flat. Measured on the middle row of that default frame: 34
// of 58 samples sit at one height to within 0.1 m. An assertion that demanded
// contrast there would be demanding a lie, so the ladder walks away from it and
// judges the distribution.
//
// THE TWO NUMBERS, and both are floors on `MapContrast.lumaStep`, the mean
// absolute luminance difference between ADJACENT painted samples:
//
//   minStep     the worst site on the ladder. Catches a shading path that is
//               blank on SOME ground, which is how the defect actually
//               presented: DW-37 scored 4.363 at one site and 0.876 at another.
//   medianStep  the middle site. Catches a shading path that is uniformly weak,
//               which no floor on the worst site can see.
//
// WHY NOT lumaSd OR lumaSpread. Because they were measured and they do not
// work: the blank 454 m frame scored lumaSd 22.96 against the LEGIBLE 52 km
// frame's 21.87. A global spread cannot tell a relief map from a smooth
// gradient of the same range. Local contrast is what the eye reads as terrain
// and it is the only one of the four that moved with the picture.
//
// THE THRESHOLDS ARE DERIVED, NOT CHOSEN. See THRESHOLDS below.
//
// lumaStep IS RESOLUTION-DEPENDENT and these floors are pinned to
// `MapTerrain.TERRAIN_N = 48`. Measured: at n=96 the same ground scores 2.373
// where n=48 scores 4.224, and at n=144 it scores 1.662, because a finer grid
// puts adjacent samples closer together on a band-limited field. If TERRAIN_N
// ever moves, these numbers are stale and this comment is the warning.
(async () => {
  const of = window.__of;
  if (!of) return { valid: false, why: 'no __of' };
  for (const k of ['map', 'world', 'teleport', 'run']) {
    if (typeof of[k] !== 'function') return { valid: false, why: `no __of.${k}` };
  }
  const A = (typeof OF_ARGS === 'object' && OF_ARGS !== null) ? OF_ARGS : {};
  const WANT = typeof A.spanM === 'number' ? A.spanM : 400;

  // THE LADDER. Eight sites along one meridian from the spawn, spread over 40 km
  // so they land in different biomes and different relief rather than eight
  // views of one hillside. Site 0 IS the start pad and is kept deliberately: it
  // is the frame Reid reported, it is the one the fix helps least, and a ladder
  // that quietly dropped its hardest case would be marking its own homework.
  const OFFS = Array.isArray(A.offsets) ? A.offsets
    : [0, 900, 1400, 3000, 6000, 12000, 25000, 40000];

  // THRESHOLDS, DERIVED AND NOT CHOSEN. Each is the GEOMETRIC MEAN of the
  // defect's score and the fix's score on THIS ladder, measured by this probe in
  // two runs of the same build minutes apart, which is the point of maximum
  // EQUAL log-margin between them: the fix clears the floor by exactly the
  // factor the defect misses it by, so the number carries the separation that
  // was observed rather than an opinion about how much is enough.
  //
  //   ladder, DW-37 one band  : 2.251 3.355 1.863 4.609 2.599 4.983 1.533 0.853
  //   ladder, WG-33 two bands : 2.587 5.431 4.201 6.233 5.570 6.640 4.689 3.674
  //   worst    0.853 -> 2.587   sqrt(0.853 x 2.587) = 1.4855, margin 1.742x each way
  //   median   2.425 -> 5.060   sqrt(2.425 x 5.060) = 3.5029, margin 1.445x each way
  //
  // The ladder is deterministic: two runs of the fixed build returned the eight
  // numbers above identically, so these floors are not straddling noise.
  const MIN_FLOOR = typeof A.minFloor === 'number' ? A.minFloor : 1.4855;
  const MEDIAN_FLOOR = typeof A.medianFloor === 'number' ? A.medianFloor : 3.5029;

  const MAP = () => of.map('report');
  const ZOOM = 1.15;
  await of.run(1.0, 60);
  const code = (of.input.bindings().map || [])[0];
  if (MAP().open !== true) {
    window.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true }));
    await new Promise((r) => setTimeout(r, 60));
    window.dispatchEvent(new KeyboardEvent('keyup', { code, bubbles: true }));
    await of.run(0.5);
  }
  if (MAP().open !== true) return { valid: false, why: 'the M key did not open the map' };

  const S = of.world().observer, R = of.world().bodyRadiusM, DEG = 180 / Math.PI;
  const lat0 = S.latDeg, lon0 = S.lonDeg;
  const sites = [];
  for (const o of OFFS) {
    of.teleport(lat0 + (o / R) * DEG, lon0, 2);
    await of.run(2.5, 60);
    for (let i = 0; i < 400 && MAP().spanM > WANT * ZOOM; i++) {
      of.map('zoom', { mult: 1 / ZOOM }); await of.run(0.03);
    }
    for (let i = 0; i < 400 && MAP().spanM < WANT / ZOOM; i++) {
      of.map('zoom', { mult: ZOOM }); await of.run(0.03);
    }
    await of.run(0.8);
    const r = MAP(), t = of.map('disc').terrain ?? {};
    const c = r.view.drawn.contrast;
    sites.push({
      offsetM: o, spanM: Math.round(r.spanM),
      sampleSizeM: t.sampleSizeM ?? 0, reliefM: t.reliefM ?? 0,
      stepM: t.stepM ?? 0, painted: r.view.drawn.discoveredQuads,
      onBody: r.view.drawn.terrainSamples,
      lumaStep: c.lumaStep, lumaSd: c.lumaSd, lumaSpread: c.lumaSpread,
      buckets: c.buckets,
    });
  }

  // Every site must have DRAWN, or a floor that passes because nothing was
  // painted is the same green-and-worthless number this file exists to retire.
  const blank = sites.filter((s) => !(s.painted > 0) || s.painted !== s.onBody);
  const steps = sites.map((s) => s.lumaStep).sort((a, b) => a - b);
  const minStep = steps[0];
  const medianStep = steps.length % 2 === 1 ? steps[(steps.length - 1) / 2]
    : (steps[steps.length / 2 - 1] + steps[steps.length / 2]) / 2;

  const checks = [
    ['every site on the ladder painted every on-body sample', blank.length === 0],
    [`the WORST site clears the floor (${minStep} >= ${MIN_FLOOR})`,
      minStep >= MIN_FLOOR],
    [`the MEDIAN site clears the floor (${medianStep} >= ${MEDIAN_FLOOR})`,
      medianStep >= MEDIAN_FLOOR],
  ];
  return {
    valid: true, spanM: Math.round(sites[0]?.spanM ?? 0), n: sites.length,
    minStep: +minStep.toFixed(3), medianStep: +medianStep.toFixed(3),
    minFloor: MIN_FLOOR, medianFloor: MEDIAN_FLOOR,
    minMargin: +(minStep / MIN_FLOOR).toFixed(3),
    medianMargin: +(medianStep / MEDIAN_FLOOR).toFixed(3),
    sites,
    pass: checks.every((c) => c[1]),
    failed: checks.filter((c) => !c[1]).map((c) => c[0]),
  };
})()
