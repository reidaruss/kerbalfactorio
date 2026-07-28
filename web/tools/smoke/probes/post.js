// The post-processing stack, driven and asserted (RN-9).
//
//   node tools/smoke/run.mjs --url=http://127.0.0.1:4217/ --scenario=walk \
//     --sandbox=1 --t=0.30 --settle=30 --evalfile=web/tools/smoke/probes/post.js
//
// WHAT THIS PROBE REFUSES TO DO. It does not report that ambient occlusion ran,
// because a pass can run, write a buffer nothing samples, and report every
// number in perfect health; that is the failure standing rule 11 collected five
// examples of in two days. It does not pick a dark box and quote it either,
// because whoever picks the box picks the answer.
//
// It asserts three PROPERTIES instead, and each one fails in a different
// direction so that no single mistake can satisfy all three:
//
//   1. LOCALISED. Occlusion must be concentrated. The median pixel barely
//      moves and the 99th percentile moves a lot. An AO term with the radius,
//      the depth reconstruction or the projection wrong darkens broadly and
//      uniformly, which fails on the median while still looking "shaded".
//   2. ATTRIBUTABLE. In the row where occlusion peaks, the CENTRE of the frame
//      (where the machines stand) must darken far more than the EDGES of that
//      SAME row. Same row is the control: identical range, identical sun
//      elevation, identical lighting gradient. The only difference is whether
//      there is a machine there, and since RN-15 that last clause is only true
//      with the understorey hidden, so the measurement is taken in that
//      configuration. The profile section below carries the whole account of
//      why, because it is this probe's own repair.
//   3. GEOMETRY-TRACKING, asserted as a PAIR that points in opposite
//      directions. Open ground with nothing standing on it must be essentially
//      untouched, and the SAME column with the foliage restored must darken.
//      A global multiply fails the first, an AO pass that does nothing fails
//      the second, and no single behaviour satisfies both without following the
//      geometry, so hiding a layer cannot buy a pass.
//
//      NOT ASSERTED HERE, and it is the one this file used to claim it made:
//      the ORBIT null, where every chunk is in the far scaled scene and the
//      near 1:1 depth buffer holds nothing, so AO must change NOTHING. That is
//      the assertion that tests the four-pass reasoning (read the wrong depth
//      attachment, or get the reversed-Z clear value backwards, and the planet
//      darkens). No probe in this tree asserts it; it wants its own pass.
//
// Plus the two-occlusion-source check the material lane asked for, plus the
// isolated cost of each effect, plus the draw-call split.

(async () => {
  const of = window.__of;
  const A = OF_ARGS ?? {};
  const fails = [];
  const log = [];
  const check = (name, ok, detail) => {
    log.push({ name, ok: !!ok, detail });
    if (!ok) fails.push(name);
    return !!ok;
  };
  const r4 = (v) => Math.round(v * 1e4) / 1e4;

  // ---------------------------------------------------------------- the scene
  // Recipe as measured by the baseline lane: sandbox so nothing is gated, a
  // fixed site and a fixed sun, then a row of machines placed by ghost-checked
  // attempts, then back off and frame their centroid.
  await of.run(0.8);
  if (of.sandbox().sandbox !== true) {
    return { valid: false, fails: ['needs ?sandbox=1'], log };
  }
  await of.wipe();
  of.forgetTunnels();
  of.repopulate();
  of.teleport(1.832, 144.168, 2.0);
  await of.run(3.0);
  of.setTime(0.30);
  await of.run(0.4);

  // THE FXAA SUBSTITUTION, PROVEN RATHER THAN ARGUED, and done HERE because
  // this is the last moment the frame is static. The stack replaces three's
  // implicit-LOD texture fetch inside FXAA's edge-search loop with an explicit
  // level 0, to silence an ANGLE X3595 the smoke runner rightly fails on. The
  // claim is that it cannot change a pixel, because the source texture has no
  // mipmaps. That claim is checkable: swap the program in place and framehash.
  //
  // The CONTROL comes first and it is not decoration. `framehash` re-renders,
  // so two calls with nothing changed must agree before a difference between
  // two variants means anything; the machines placed below animate, and on this
  // view AFTER they exist the hash is not stable at all.
  const shot = async () => {
    const bmp = await createImageBitmap(await of.screenshot());
    const cv = new OffscreenCanvas(bmp.width, bmp.height);
    const cx = cv.getContext('2d'); cx.drawImage(bmp, 0, 0);
    const d = cx.getImageData(0, 0, bmp.width, bmp.height).data;
    bmp.close();
    return d;
  };
  const diff = (a, b) => {
    let max = 0; let over1 = 0; let any = 0;
    for (let i = 0; i < a.length; i += 4) {
      const e = Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]),
        Math.abs(a[i + 2] - b[i + 2]));
      if (e > max) max = e;
      if (e > 1) over1++;
      if (e > 0) any++;
    }
    const n = a.length / 4;
    return { maxChannel: max, over1Fraction: r4(over1 / n), anyFraction: r4(any / n) };
  };
  const fxA = of.framehash().hash;
  const fxB = of.framehash().hash;
  of.setPost({ aa: false });
  await of.settle(6);
  const shotNoAa = await shot();
  of.setPost({ aa: true });
  await of.settle(6);
  const shotExplicit = await shot();
  of.setFxaaLod(true);
  await of.settle(6);
  const fxImplicit = of.framehash().hash;
  const shotImplicit = await shot();
  of.setFxaaLod(false);
  await of.settle(6);

  const fxDiff = diff(shotExplicit, shotImplicit);
  const touchedExplicit = diff(shotExplicit, shotNoAa);
  const touchedImplicit = diff(shotImplicit, shotNoAa);
  // Containment: of the pixels the two FXAA variants disagree on, what fraction
  // is a pixel that FXAA moved AT ALL relative to no antialiasing?
  let differ = 0; let contained = 0;
  for (let i = 0; i < shotExplicit.length; i += 4) {
    const e = Math.max(Math.abs(shotExplicit[i] - shotImplicit[i]),
      Math.abs(shotExplicit[i + 1] - shotImplicit[i + 1]),
      Math.abs(shotExplicit[i + 2] - shotImplicit[i + 2]));
    if (e === 0) continue;
    differ++;
    const tE = Math.max(Math.abs(shotExplicit[i] - shotNoAa[i]),
      Math.abs(shotExplicit[i + 1] - shotNoAa[i + 1]),
      Math.abs(shotExplicit[i + 2] - shotNoAa[i + 2]));
    const tI = Math.max(Math.abs(shotImplicit[i] - shotNoAa[i]),
      Math.abs(shotImplicit[i + 1] - shotNoAa[i + 1]),
      Math.abs(shotImplicit[i + 2] - shotNoAa[i + 2]));
    if (tE > 0 || tI > 0) contained++;
  }
  const containment = r4(differ > 0 ? contained / differ : 1);
  const fxaa = {
    controlPair: [fxA, fxB], implicitLod: fxImplicit, hashesEqual: fxA === fxImplicit,
    explicitVsImplicit: fxDiff,
    fxaaTouchesExplicit: touchedExplicit.anyFraction,
    fxaaTouchesImplicit: touchedImplicit.anyFraction,
    containment,
  };
  check('FXAA control: this view is static, so two framehashes agree',
    fxA === fxB, `${fxA} vs ${fxB}`);
  // TWO WRONG INSTRUMENTS BEFORE THIS ONE, AND THE SEQUENCE IS THE POINT.
  // (a) "the framehashes are equal": they are not, and an FNV over every byte
  //     cannot tell one count on a few hundred pixels from a different image.
  // (b) "no pixel moves by more than 1 count": measured max 176 counts on 5.4%
  //     of the frame, so the substitution is NOT a rounding difference and
  //     saying so would have been a lie with a number attached.
  // What is actually true is narrower and is the thing worth guaranteeing: an
  // antialiasing pass is allowed to move edge pixels and nothing else, so every
  // pixel the two variants disagree on must be a pixel FXAA moved AT ALL. It is
  // also the honest framing of which variant is correct: three's version fetches
  // with implicit derivatives inside a loop with a data-dependent exit, where
  // derivatives are UNDEFINED (that is what ANGLE X3595 says). The explicit
  // level 0 is the DEFINED one. The difference is not damage, it is the removal
  // of undefined behaviour, and it is confined to the pixels FXAA owns.
  check('FXAA: the two variants disagree ONLY on pixels FXAA moved',
    containment > 0.99,
    `containment ${containment} of ${differ} differing pixels. FXAA moves `
    + `${touchedExplicit.anyFraction} of the frame; the variants disagree on `
    + `${fxDiff.anyFraction} of it, max channel ${fxDiff.maxChannel}. Framehashes `
    + `differ (${fxA} vs ${fxImplicit}) and that is expected.`);
  check('FXAA is doing something: it changes a real fraction of the frame',
    touchedExplicit.anyFraction > 0.02,
    `FXAA moves ${touchedExplicit.anyFraction} of pixels against no-AA, `
    + `max channel ${touchedExplicit.maxChannel}`);

  of.assignSlot(3, 'generator');
  of.assignSlot(6, 'pole');
  await of.run(0.2);

  const placed = [];
  const place = async (slot, yawOff, pitches) => {
    const before = of.game().factory.buildings;
    for (const pitch of pitches) {
      of.hotbar(slot); await of.run(0.12);
      of.look((0 + yawOff + 360) % 360, pitch); await of.run(0.06);
      const g = of.build().ghost;
      if (!g || !g.ok) continue;
      of.input.tape([{ hold: 4, actions: ['use'] }, { hold: 8, keys: [] }]);
      await of.run(0.30);
      if (of.game().factory.buildings > before) { placed.push(slot); return true; }
    }
    return false;
  };
  const P = [-26, -22, -30, -19, -34, -16, -40];
  const B = [-38, -34, -42, -30];
  await place(5, -22, P); await place(5, 20, P); await place(3, -4, P);
  await place(6, 34, P); await place(4, -12, B); await place(4, 0, B); await place(4, 12, B);
  of.build(0); of.hotbar(1); await of.run(0.4);
  of.input.tape([{ hold: 70, actions: ['back'] }, { hold: 30, keys: [] }]);
  await of.run(70 / 60 + 0.6);

  // Frame the centroid by sweeping, rather than by a remembered yaw: backing
  // off walks up or down the slope, so a fixed angle misses (baseline lane).
  const list = of.game().factory.list;
  const c = list.reduce((a, m) => [a[0] + m.pos[0], a[1] + m.pos[1], a[2] + m.pos[2]], [0, 0, 0])
    .map((v) => v / Math.max(1, list.length));
  let best = { dot: -2, yaw: 0, pitch: -4 };
  for (let y = 0; y < 360; y += 2) {
    for (let p = -18; p <= -2; p += 2) {
      of.look(y, p);
      const aim = of.aim();
      const d = [c[0] - aim.origin[0], c[1] - aim.origin[1], c[2] - aim.origin[2]];
      const n = Math.hypot(d[0], d[1], d[2]) || 1;
      const dot = (aim.dir[0] * d[0] + aim.dir[1] * d[1] + aim.dir[2] * d[2]) / n;
      if (dot > best.dot) best = { dot, yaw: y, pitch: p };
    }
  }
  of.look(best.yaw, best.pitch);
  of.input.tape([{ hold: 900, keys: [] }]);
  await of.run(1.5);
  // RE-PIN THE SUN, and this line is the difference between a valid before/after
  // pair and an invalid one. `place()` tries pitches until a ghost is legal, so
  // two runs of this recipe consume DIFFERENT amounts of sim time, and the sun
  // moves with sim time. The first before/after pair taken from this probe
  // differed by a visible warm-to-cool shift across the whole hillside that
  // looked exactly like a colour grade and was entirely the sun. Setting the
  // time once at the top is not enough; it has to be set again after every
  // data-dependent wait and immediately before the frame that gets captured.
  const sunT = A.sunT ?? 0.30;
  of.setTime(sunT);
  await of.run(0.2);
  await of.settle(20);

  const scene = {
    machines: of.game().factory.buildings,
    kinds: list.map((m) => m.kind),
    yaw: best.yaw, pitch: best.pitch, framingDot: r4(best.dot), sunT,
  };
  // DW-20: a probe proves its own setup worked before it measures anything.
  check('setup: at least 5 machines are standing', scene.machines >= 5,
    `${scene.machines} placed, kinds ${scene.kinds.join(',')}`);
  check('setup: the camera is pointed at their centroid', best.dot > 0.99,
    `dot ${r4(best.dot)} at yaw ${best.yaw} pitch ${best.pitch}`);

  // -------------------------------------------------------------- the profile
  // TWO PROFILES, AND THE SECOND ONE IS THIS PROBE'S OWN REPAIR.
  //
  // WHAT WAS WRONG. Nothing here was inverted and no predicate ran backwards.
  // The CONTROL stopped being a control, and the thresholds went on quoting a
  // world that no longer exists. Properties 1 and 2 were calibrated at RN-10
  // against a bare hillside: peak band centre 0.3528 against 0.0267 in the SAME
  // ROW of open ground, ratio 13.2, which is exactly where the 2.5 and the 5%
  // below come from. RN-15 then planted an understorey on that hillside at 0.55
  // of screen coverage and RN-30 bought 3.7x more of it. A grass card is an
  // occluder, a 0.9 m AO radius resolves it, and so the EDGE columns stopped
  // being open ground and started carrying a large and entirely correct
  // occlusion signal of their own. The denominator of the attribution ratio
  // became a second copy of the numerator's physics; the ratio collapsed towards
  // 1 (measured 1.5975, then 1.7359 after a pass that improved it), and three
  // checks reported failure against a renderer that was right.
  //
  // THE REPAIR IS NOT A SMALLER THRESHOLD. It is to restore the condition the
  // thresholds were derived under, inside one settled frame, with the camera,
  // the sun, the streamed set and the machines held identical by construction:
  // hide the foliage layer, which is the same runtime isolation `DebugScatter`
  // and `Surfaces` already use for the same reason, and take the attribution
  // measurement where "the only free variable is whether a machine is standing
  // there" is TRUE rather than hoped for. The shipped frame is still profiled,
  // still asserted on the properties it can carry, and still reported in full.
  const prof = await of.postProfile('ao', 30);
  of.propsVisible(false);
  await of.settle(8);
  const bare = await of.postProfile('ao', 30);
  of.propsVisible(true);
  await of.settle(8);

  // A MEASUREMENT OVER NOTHING MUST NOT READ AS A PASS, and every bound below
  // is an upper bound on a darkening, so a black or empty capture satisfies all
  // of them at once: `1 - with/without` is 0 on every pixel that never cleared
  // the lit floor. `LIT` is 12 of 255 in DebugPost and this is a daylit hillside
  // under a lit sky at sunT 0.30, where essentially the whole frame clears it,
  // so half the frame is a floor only a failed or unlit capture can miss.
  check('both profiles came off real lit frames, not empty or black captures',
    prof.samplePx > 0 && bare.samplePx > 0
    && prof.litFraction > 0.5 && bare.litFraction > 0.5,
    `lit fraction ${prof.litFraction} shipped and ${bare.litFraction} with the `
    + `foliage hidden, over ${prof.samplePx} and ${bare.samplePx} px`);

  // The last three bands are the first-person view model and the hotbar. The
  // arms sway between the two captures of an A/B, so those bands measure the
  // sway rather than the effect and can read NEGATIVE darkening; this file
  // already says so where it reports `viewModelBands`. A peak taken over bands
  // the same file calls invalid is not a peak of the effect, so the search and
  // the band count both stop before them.
  const lastValid = Math.max(1, bare.rows.length - 3);
  const peak = bare.rows.slice(0, lastValid)
    .reduce((a, r, i, all) => (r.centre > all[a].centre ? i : a), 0);
  const peakRow = bare.rows[peak];
  const shippedPeak = prof.rows[peak];
  // A ratio needs a floor on its DENOMINATOR for the same reason `darkening`
  // needs one, and the old form had the failure backwards: `edges > 1e-4 ?
  // centre / edges : Infinity` hands an AO pass that darkened NOTHING an
  // infinite ratio and PASSES the attribution check on a dead effect. 1e-4 is
  // not a tuned number, it is `DebugPost`'s own `r4` rounding quantum, so it is
  // the smallest value a row mean can express at all. The numerator's magnitude
  // is required separately below so a null cannot ride through a small one.
  const edgeFloor = 1e-4;
  const ratio = peakRow.centre / Math.max(peakRow.edges, edgeFloor);
  const shippedRatio = shippedPeak.centre / Math.max(shippedPeak.edges, edgeFloor);
  // The level this probe already calls "this band moved", used in both
  // directions below so the pair cannot be satisfied by one behaviour.
  const TOUCHED = 0.05;
  const bandsTouched = bare.rows.slice(0, lastValid).filter((r) => r.centre > TOUCHED).length;

  // 1. LOCALISED, on the SHIPPED frame, because "is the picture as a whole a
  // wash" is a question about the picture that ships.
  check('AO is localised: the median pixel barely moves', prof.medianDark < 0.03,
    `median darkening ${prof.medianDark}, threshold 0.03`);
  check('AO is real: the 99th percentile moves a lot', prof.p99Dark > 0.10,
    `p99 darkening ${prof.p99Dark}, threshold 0.10`);
  check('AO is not a global multiply: most row bands are untouched',
    bandsTouched <= lastValid / 2,
    `${bandsTouched} of ${lastValid} scene centre bands over ${TOUCHED} with the `
    + `foliage hidden (the shipped frame reads ${prof.rows.slice(0, lastValid)
      .filter((r) => r.centre > TOUCHED).length}, and an understorey over half `
    + 'the screen is why that number is reported and not asserted)');

  // 2. ATTRIBUTABLE. Same row, so range and lighting are held equal; no
  // understorey, so proximity to a machine is the only thing left.
  check('AO darkens the machine column far more than the SAME ROW of open ground',
    ratio > 2.5 && peakRow.centre > TOUCHED,
    `peak band y ${peakRow.y0}-${peakRow.y1} with the foliage hidden: centre `
    + `${peakRow.centre} vs edges ${peakRow.edges}, ratio ${r4(ratio)}, threshold `
    + `2.5 (RN-10 measured 13.2 here) and the centre must itself clear ${TOUCHED}, `
    + `so a pass that darkened nothing cannot ride a zero denominator. The shipped `
    + `frame reads centre ${shippedPeak.centre} vs edges ${shippedPeak.edges}, `
    + `ratio ${r4(shippedRatio)}, in the same band.`);

  // 3. GEOMETRY-TRACKING, the pair. First direction: with nothing standing on
  // it, open ground is essentially untouched.
  check('open ground carrying no occluders is essentially unchanged',
    peakRow.edges < TOUCHED,
    `edges ${peakRow.edges} with the foliage hidden, threshold ${TOUCHED} `
    + '(RN-10 measured 0.0267 on this view when the hillside was bare)');
  // Second direction, and it is what stops "hide the foliage" from being a way
  // to launder a broken pass. Grass cards ARE occluders, so the same column has
  // to darken once they are back, and by more than the level this file calls
  // untouched. An AO pass that does nothing fails this; a global multiply fails
  // the one above; the two share the constant and disagree about the direction.
  check('the understorey is itself occluded: the same column darkens once it is back',
    shippedPeak.edges > TOUCHED,
    `shipped edges ${shippedPeak.edges} against ${peakRow.edges} bare, band `
    + `y ${peakRow.y0}-${peakRow.y1}, threshold ${TOUCHED}`);

  // THE MATERIAL LANE'S QUESTION, and the first version of this check was the
  // wrong instrument for it.
  //
  // The question is whether a baked occlusion map and a screen-space one are
  // both darkening the same thing. The first attempt asserted that a machine
  // face away from any contact darkens less than 6%, measured 10.1%, and would
  // have been "fixed" by moving the threshold. It was wrong twice over: the
  // band it sampled is the smelter's own RECESSED PANELS, which are decimetre-
  // scale and are legitimately this term's business, and "how much does this
  // band darken" is not a statement about spatial frequency at all.
  //
  // The property that actually answers the question is that this implementation
  // CANNOT resolve texture-scale occlusion. So: re-run the whole measurement
  // with the radius set to 5 cm, which is the scale a panel gap or a bolt
  // recess lives at. If a 5 cm radius produces essentially nothing, then no
  // tuning of the shipped 0.9 m radius is competing with the baked map, because
  // the signal at that scale does not exist to be double-counted.
  const shippedRadius = of.post().tune.aoRadiusM;
  of.setPostTune({ aoRadiusM: 0.05 });
  const micro = await of.postProfile('ao', 30);
  of.setPostTune({ aoRadiusM: shippedRadius });
  const faceBand = prof.rows[Math.max(0, peak - 4)];
  // AND THE FIRST VERSION OF THIS REPLACEMENT WAS ALSO WRONG, which is worth
  // more than the check. It asserted that a 5 cm radius "produces nothing", and
  // it does not: it produces p99 0.54 over 11% of the frame. Shrinking the
  // radius does not silence the term, it makes the term SPECKLED, because the
  // samples collapse inside one half-resolution texel and it starts integrating
  // the surface's own depth gradient instead of an occluder.
  //
  // So the property is not magnitude at all, it is SPATIAL FREQUENCY, which is
  // what the question was about the whole time. `roughness` is the darkening
  // image's mean adjacent-pixel gradient over its mean magnitude. A term that
  // could compete with a baked texture map has to be rough at texel scale; the
  // shipped configuration has to be smooth. That is a comparison between two
  // configurations of the SAME code on the SAME frame, so nothing else differs.
  const rough = r4(micro.roughness / Math.max(1e-6, prof.roughness));
  // AN ABSOLUTE BOUND, not the ratio, and the reason is this probe's own noise
  // floor. A profile differences two captures and the arms sway between them, so
  // the 5 cm configuration's signal is close enough to that noise that its
  // roughness swings run to run (measured 0.2632 then 0.1307 on identical
  // builds). The ratio is therefore reported and NOT asserted.
  //
  // The bound is asserted instead, and it is sound in the conservative
  // direction: noise is high-frequency, so it can only INFLATE a roughness
  // measurement. A shipped roughness measured at about 0.10 with noise included
  // is an upper bound on the true value, and 0.10 means adjacent pixels of the
  // occlusion signal differ by a tenth of its mean magnitude, which is smooth.
  // A term competing with a texture map would be of order 1.
  check('the shipped AO signal is SMOOTH, so it cannot be competing with a texture map',
    prof.roughness < 0.35,
    `roughness ${prof.roughness} (threshold 0.35, and noise can only raise it). `
    + `At a 5 cm radius it reads ${micro.roughness}, a factor of ${rough}, with `
    + `comparable magnitude (p99 ${prof.p99Dark} against ${micro.p99Dark}) - which `
    + 'is exactly why magnitude was the wrong test. Reported, not asserted: the '
    + `noise floor of this probe is ${prof.noiseFraction} of pixels.`);
  check('AO signal is well clear of the noise floor of this probe',
    prof.changedFraction > prof.noiseFraction * 3,
    `AO changes ${prof.changedFraction} of pixels against a floor of `
    + `${prof.noiseFraction} measured from two captures with AO ON in both`);

  // ---------------------------------------------------------------- the cost
  const costs = {};
  for (const fx of ['ao', 'bloom', 'aa', 'post']) {
    costs[fx] = await of.postCost(fx, A.costSecs ?? 3, A.costReps ?? 3);
  }
  const p = of.post();
  const st = of.stats();

  check('the post stack issues a CONSTANT number of draw calls',
    costs.ao.deltaCalls === 4 && costs.bloom.deltaCalls === 9 && costs.aa.deltaCalls === 1,
    `ao +${costs.ao.deltaCalls}, bloom +${costs.bloom.deltaCalls}, aa +${costs.aa.deltaCalls} `
    + '(wires.js requires five consecutive readings to be identical, so a pass '
    + 'count that varied frame to frame would break an unrelated probe)');

  check('scene draw calls are unchanged by post',
    st.passMs.sceneCalls + p.calls === st.draw.calls,
    `scene ${st.passMs.sceneCalls} + post ${p.calls} = ${st.draw.calls}`);

  return {
    valid: fails.length === 0,
    fails,
    scene,
    ao: {
      // `peakBand` and the ratio come from the CONTROL configuration (foliage
      // hidden), because that is the only one in which centre-minus-edges is
      // attributable to the machines. The shipped frame's own reading of the
      // same band sits beside it so the two are never confused for each other.
      peakBand: peakRow, peakIndex: peak, centreOverEdges: r4(ratio),
      shippedPeakBand: shippedPeak, shippedCentreOverEdges: r4(shippedRatio),
      bareProfile: bare.rows, bandsTouched, validBands: lastValid,
      bareLitFraction: bare.litFraction, bareP99Dark: bare.p99Dark,
      medianDark: prof.medianDark, p99Dark: prof.p99Dark, maxDark: prof.maxDark,
      changedFraction: prof.changedFraction, litFraction: prof.litFraction,
      faceBand,
      roughness: prof.roughness, gradEnergy: prof.gradEnergy, meanMag: prof.meanMag,
      noiseFraction: prof.noiseFraction,
      microRadius: { radiusM: 0.05, p99Dark: micro.p99Dark, medianDark: micro.medianDark,
        changedFraction: micro.changedFraction, roughness: micro.roughness },
      profile: prof.rows,
      // The last three bands cover the first-person view model and the hotbar.
      // The arms sway, so the two captures of an A/B differ there for reasons
      // that are not the effect, and those bands can read NEGATIVE darkening.
      // Reported rather than trimmed: a profile with a hole in it invites the
      // next reader to wonder what was removed.
      viewModelBands: [prof.rows.length - 3, prof.rows.length - 1],
    },
    costs,
    fxaa,
    post: { flags: p.flags, calls: p.calls, vramMB: p.vramMB, sizes: p.sizes, tune: p.tune },
    draw: { sceneCalls: st.passMs.sceneCalls, postCalls: p.calls, total: st.draw.calls,
      triangles: st.draw.triangles, textures: st.draw.textures, programs: st.draw.programs },
    frameMs: st.frameMs,
    vramEstimateMB: st.vramEstimateMB,
    log,
  };
})()
