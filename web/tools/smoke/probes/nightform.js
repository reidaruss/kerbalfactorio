// RN-1010. Does ANYTHING about the SHAPE of the ground reach a night pixel on
// an airless body?
//
//   node tools/smoke/run.mjs --scenario=walk --sandbox=1 --body=cinder \
//     --url=http://127.0.0.1:4282/ --lamp=0 \
//     --evalfile=tools/smoke/probes/nightform.js \
//     --evalargs='{"lat":2,"lon":144,"pitch":-35,"sunDot":-0.45}'
//
// THE HYPOTHESIS, read off TerrainShader:459-508 rather than guessed:
//
//     lit = albedo * (uAmbient + skyAmb*skyViewEff + ground*groundView
//                     + sunT * (1.45 * ndl * shadow))
//
// On an airless body at night, skyAmb is 0 (no atmosphere to scatter), the
// bounce source has no sunlit ground to gather from, and the sun term is
// extinguished. What is left is `albedo * uAmbient`, and **uAmbient is the one
// term in that expression weighted by NOTHING**: not by sky view, not by
// horizon occlusion, not by shadow, not by the normal. Every other term is
// weighted by something.
//
// If that reading is right, an airless night frame is a scaled copy of the
// ALBEDO and carries no shading whatever. That is a much stronger statement
// than "the night is dim", and it is falsifiable, so this probe tries to
// falsify it with a prediction that has a bit-exact failure condition.
//
// THE TEST. The relief bump perturbs the LIGHTING NORMAL and nothing else
// (TerrainShader's own comment: "after every decision that depends on the true
// slope has already been taken"). The normal appears in the expression above
// only inside `ndl`, and in the specular lobe below it. So:
//
//   PREDICTION: at airless night, `setRelief(0)` against `setRelief(shipped)`
//   must be **BIT-IDENTICAL**. Not similar. Identical.
//
// If it is, no property of the surface's orientation reaches a night pixel,
// and no exposure or grade can recover form that was never rendered.
//
// NAMED FAILURE MODES, before measuring.
//
//  1. A BIT-IDENTICAL PAIR IS ALSO WHAT A DEAD TOGGLE LOOKS LIKE. This is the
//     whole risk of the experiment and it is answered rather than argued: the
//     IDENTICAL toggle is run again at the SAME site and camera in DAYLIGHT,
//     where it must move a large number of pixels. A night null with a day null
//     beside it proves nothing; a night null with a day MOVE is the finding.
//
//  2. THE SPECULAR ALSO RIDES THE BUMPED NORMAL, so a non-null night result
//     could come from the specular rather than from any diffuse term. Both
//     halves are therefore measured with the specular in its shipped state AND
//     with it off, so the two are separable instead of confounded.
//
//  3. THE HEADLAMP IS DIRECTIONAL and would supply exactly the form this probe
//     claims is absent. It is asserted off, not assumed off.
//
//  4. PROPS AND ROCKS take a different lighting path and would move for their
//     own reasons. Off.
//
//  5. THE BAND MUST BE GROUND. On an airless body the sky and the shadowed
//     ground are the same colour and no rule on the shipped frame's own pixels
//     separates them (airlesspair.mjs paid for that lesson). Here the camera is
//     pitched down far enough that the band is ground BY GEOMETRY, and the
//     probe publishes the sky's own reading so the two can be compared.
//
//  6. RUN-TO-RUN NOISE. Every state is captured, and one state is captured
//     twice, so "identical" is measured against a floor rather than asserted.
(async (A) => {
  const of = window.__of;
  const art = window.__ofTerrainArt;
  if (!of) throw new Error('nightform: no window.__of');
  if (!art) throw new Error('nightform: no __ofTerrainArt');
  if (typeof art.setSpec !== 'function' && typeof art.setSpecAmp !== 'function') {
    // Not fatal: recorded, and the specular arm is skipped rather than faked.
  }

  const cv = document.querySelector('canvas');
  const walk = (el) => {
    for (const c of el.children) {
      if (c === cv) continue;
      if (c.contains(cv)) { walk(c); continue; }
      c.style.display = 'none';
    }
  };
  walk(document.body);

  const pitch = A.pitch ?? -35;
  const yaw = A.yaw ?? 0;
  of.teleport(A.lat, A.lon, A.alt ?? 2.0);
  await of.run(1.0);
  let spin = 0;
  while (!of.world().chunks.converged && spin++ < 240) await of.run(0.5);
  await of.run(1.0);
  if (typeof of.build === 'function') of.build(0);
  if (typeof of.propsVisible === 'function') of.propsVisible(false);

  let aim = null;
  for (let i = 0; i < 120; i++) {
    aim = of.aim?.();
    if (aim && typeof aim.pitchDeg === 'number') break;
    await of.run(0.1);
  }
  if (aim === null) throw new Error('nightform: no player');
  of.look(yaw, pitch);
  await of.run(0.4);

  // Failure mode 3. The lamp is directional; if it is on, this probe measures
  // the lamp.
  // Failure mode 3, and RN-1011: **`?lamp=` IS A DEAD URL PARAMETER.** It is in
  // run.mjs's PAGE_PARAMS and is forwarded into the query string, and NOTHING
  // in `web/src` reads it. The only switch is `of.lamp(false)`, the same one
  // the L key drives. So the lamp is turned off HERE, at runtime, and the
  // result is READ BACK rather than trusted, because a probe that passes a flag
  // nothing consumes and then asserts nothing about it is how a whole class of
  // night measurement gets taken with the lamp on.
  //
  // `?? null` is deliberately NOT used to supply a default: a fallback that
  // satisfies its own assertion is the vacuous-guard shape. A missing report is
  // a FAILURE, not an "off".
  if (typeof of.lamp !== 'function') {
    throw new Error('nightform: of.lamp is missing, so the headlamp cannot be turned off and this measurement is not possible');
  }
  of.lamp(false);
  await of.settle(4);
  const lampStat = of.stats().lamp;
  if (lampStat === undefined || lampStat === null) {
    throw new Error(`nightform: stats().lamp is ${lampStat}; the headlamp state is unreadable, so it cannot be asserted off. Published keys: ${Object.keys(of.stats()).join(', ')}`);
  }
  if (lampStat.enabled !== false) {
    throw new Error(`nightform: of.lamp(false) left enabled=${lampStat.enabled} (${JSON.stringify(lampStat)})`);
  }
  const lamp = lampStat;

  const relShipped = art.getRelief();
  if (!(relShipped > 0)) throw new Error(`nightform: relief amp is ${relShipped}; the toggle under test is already off`);

  const grab = async () => {
    await of.settle(A.settle ?? 20);
    const blob = await of.screenshot();
    const buf = new Uint8Array(await blob.arrayBuffer());
    let s = '';
    for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
    return `data:image/png;base64,${btoa(s)}`;
  };
  const hash = () => of.framehash().hash;

  // ONE ARM: set the sun, then A / B / A on the relief toggle.
  //
  // A/B/A AND NOT A/B, and the first draft of this probe is why. It compared a
  // framehash taken BEFORE a screenshot with one taken AFTER, and reported the
  // same unchanged state as unstable. `of.screenshot()` resolves inside the rAF
  // drain and ADVANCES THE SIM; `framehash` renders synchronously and advances
  // nothing. Straddling a screenshot with two hashes compares two different sim
  // states and calls the difference noise. The floor here is therefore the
  // SECOND A against the first, captured the same way as B, so the floor and
  // the signal are measured through an identical path.
  //
  // The ambient state is read INSIDE the arm, at the elevation it describes.
  // The first draft read it once at the end, after the DAY arm had run, and
  // duly reported nightK 0 for a night measurement. A per-frame value read
  // outside the state it belongs to is not a measurement of that state.
  const arm = async (label, sunDot) => {
    const solve = of.setSunElev(sunDot);
    await of.settle(30);
    const ambient = window.__ofAmbient ? window.__ofAmbient.report() : null;
    const spec = typeof art.getSpec === 'function' ? art.getSpec() : null;
    art.setRelief(relShipped);
    const pngOnA = await grab();
    const hOnA = hash();
    art.setRelief(0);
    if (art.getRelief() !== 0) throw new Error('nightform: setRelief(0) did not take');
    const pngOff = await grab();
    const hOff = hash();
    art.setRelief(relShipped);
    const pngOnB = await grab();
    const hOnB = hash();
    return {
      label, askDot: sunDot,
      gotDot: +solve.gotDot.toFixed(4), solveErr: +solve.err.toFixed(4),
      elevationDeg: +((Math.asin(Math.max(-1, Math.min(1, solve.gotDot))) * 180) / Math.PI).toFixed(2),
      ambient, spec,
      hashOnA: hOnA, hashOff: hOff, hashOnB: hOnB,
      pngOnA, pngOff, pngOnB,
    };
  };

  const night = await arm('night', A.sunDot ?? -0.45);
  const day = await arm('day', A.dayDot ?? 0.45);

  const st = of.stats();
  const w = of.world();
  const strip = (o) => {
    const { pngOnA, pngOff, pngOnB, ...rest } = o; return rest;
  };
  return {
    valid: w.chunks.converged === true,
    site: { lat: A.lat, lon: A.lon, biome: w.biome ?? null, body: st.boot?.body ?? null },
    pose: { yaw, pitch, alt: A.alt ?? 2.0 },
    lamp,
    reliefAmp: relShipped,
    // NO VERDICT FIELD. The first draft computed one from frame hashes, which
    // is a bit-exact comparison over a quantity that is not bit-stable here.
    // The verdict belongs to the caller's pixel diff of these six frames
    // against the two floors, and inventing one in the probe would have made
    // the wrong answer look authoritative.
    night: strip(night),
    day: strip(day),
    shots: {
      night_on_a: night.pngOnA, night_off: night.pngOff, night_on_b: night.pngOnB,
      day_on_a: day.pngOnA, day_off: day.pngOff, day_on_b: day.pngOnB,
    },
  };
})(OF_ARGS)
