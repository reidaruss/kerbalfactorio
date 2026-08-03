// ghostsize.js: GP-288. HOW BIG IS THE BUILD GHOST, AND WHERE.
//
//   node tools/smoke/run.mjs --sandbox=1 --settle=25 \
//        --evalfile=tools/smoke/probes/ghostsize.js \
//        --out=docs/screenshots/GP_build_ghost.png
//
// Reid, from playing: "when placing a building the translucent preview fills
// the screen rather than sitting on the ground where the thing will go."
//
// THIS MEASURES THE COMPLAINT, not a cause somebody guessed at. `ghost: true`
// has been published for months and cannot tell an ENORMOUS mesh from one
// sitting ON THE CAMERA, and those are different bugs with different fixes.
// `ghostBox` carries the world size of the geometry the renderer is holding and
// the distance from its centre to the eye, so the two separate on the first
// run.
//
// THE FIXTURE IS ASSERTED BEFORE THE MEASUREMENT. A ghost that is not visible
// has no box, and every number below would be absent rather than wrong, which
// reads as a pass to anything that only checks for a failure.
(async () => {
  const of = window.__of;
  if (!of) return { valid: false, why: 'no __of' };
  const fails = [];
  const log = [];
  const check = (name, ok, detail) => {
    if (!ok) fails.push(detail === undefined ? name : `${name}: ${detail}`);
    return ok;
  };
  const sleep = (n) => of.run(n);
  await sleep(1.0);

  // A BUILDING IN HAND, through the player's own path: the B menu, then a real
  // click on the Foundation tile.
  const bindings = of.input.bindings();
  const code = (bindings.build || [])[0];
  check('there is a build-menu binding', !!code, JSON.stringify(bindings.build));
  window.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true }));
  await sleep(0.8);
  const tiles = [...document.querySelectorAll('#of-build [data-build]')];
  log.push(`build menu tiles: ${tiles.map((t) => t.getAttribute('data-build')).join(', ')}`);
  const tile = tiles.find((t) => /foundation/i.test(t.getAttribute('data-build') ?? ''));
  check('the build menu offers a foundation', tile !== undefined,
        tiles.map((t) => t.getAttribute('data-build')).join(', '));
  if (tile === undefined) {
    return { valid: false, why: 'no foundation tile', fails, log };
  }
  tile.click();
  await sleep(1.2);

  // THE VIEW, not the model: the model has no idea what is drawn.
  const st = of.structView ? of.structView() : null;
  if (st === null || st === undefined) {
    return { valid: false, why: 'no __of.structView()', fails, log };
  }
  // THE FIXTURE. Without a visible ghost there is nothing to measure and the
  // absence would read as an absence of defect.
  check('a ghost is actually being previewed', st.ghost === true,
        `ghost ${st.ghost}`);
  const box = st.ghostBox;
  check('and it publishes its own box', box !== null && box !== undefined,
        `ghostBox ${JSON.stringify(box)}`);
  if (!box) return { valid: false, why: 'no ghost box', fails, log, st };

  log.push(`ghost size ${JSON.stringify(box.sizeM)} m, centre `
    + `${JSON.stringify(box.centreEngine)}, ${box.distM} m from the eye, `
    + `scale ${JSON.stringify(box.scale)}`);

  // A FOUNDATION IS A 4 m MODULE (GP-40 re-priced the four structural costs for
  // it). Its preview is a few metres of ground, so every dimension is bounded
  // and so is its distance: a player places a building within arm's reach and
  // a few metres, never at 0 m and never at a kilometre.
  const big = Math.max(box.sizeM[0], box.sizeM[1], box.sizeM[2]);
  check('THE GHOST IS THE SIZE OF THE BUILDING, not the size of the world',
        big > 0.1 && big < 12,
        `largest dimension ${big} m. A 4 m foundation preview cannot be this. `
        + 'If this is huge the geometry is wrong; if it is sane, look at distM.');
  check('THE GHOST IS OUT IN FRONT, not sitting on the camera',
        box.distM > 0.5 && box.distM < 200,
        `centre is ${box.distM} m from the eye. Near zero means the player is `
        + 'INSIDE it, and the material is DoubleSide, so the inside faces fill '
        + 'the viewport: that is exactly what "it fills the screen" looks like.');
  check('the ghost mesh is not scaled', box.scale.every((v) => Math.abs(v - 1) < 1e-6),
        JSON.stringify(box.scale));

  // SWEEP EVERY BUILDING THE MENU OFFERS, because the complaint is about "a
  // building" and the sizes range from a 1 m pole to a 24 m launch pad. A probe
  // that measured only the foundation would have measured the one case that is
  // fine: it is 4 m, it lands 6 m ahead, and it is correct.
  const KINDS = ['foundation', 'floor', 'wall', 'door', 'launchpad'];
  const seen = [];
  for (const kind of KINDS) {
    const t = tiles.find((x) => x.getAttribute('data-build') === kind);
    if (t === undefined) continue;
    // Re-open the menu each time: clicking a tile puts the thing in hand and
    // closes it.
    if (document.querySelector('#of-build') === null) {
      window.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true }));
      await sleep(0.5);
    }
    const again = [...document.querySelectorAll('#of-build [data-build]')]
      .find((x) => x.getAttribute('data-build') === kind);
    if (again === undefined) continue;
    again.click();
    await sleep(1.0);
    const sv = of.structView ? of.structView() : null;
    const pv = of.padView ? of.padView() : null;
    const box = (sv && sv.ghost === true && sv.ghostBox)
      || (pv && pv.ghost === true && pv.ghostBox) || null;
    seen.push({ kind, box });
    if (box === null) continue;
    const big = Math.max(box.sizeM[0], box.sizeM[1], box.sizeM[2]);
    log.push(`${kind}: ${big.toFixed(2)} m across, centre ${box.distM} m off, `
      + `nearest face ${box.nearestM} m, encloses the eye ${box.encloses}`);
    // THE ASSERTION IS NOT ABOUT SIZE. A 24 m launch pad is allowed to be 24 m.
    // What no preview may do is SWALLOW THE PLAYER, because the ghost material
    // is DoubleSide and the inside of a box you are standing in is the whole
    // viewport. That is Reid's sentence turned into a measurement.
    check(`the ${kind} preview does not swallow the player`,
          box.encloses === false,
          `the eye is INSIDE the ${big.toFixed(1)} m preview: centre `
          + `${box.distM} m away, nearest face ${box.nearestM} m. The ghost is `
          + 'DoubleSide, so its inner faces fill the screen. This is what '
          + '"the preview fills the screen" is.');
    check(`the ${kind} preview has its near face in front of the player`,
          box.nearestM >= 0, `nearest ${box.nearestM} m`);
  }
  check('the sweep actually measured something', seen.some((r) => r.box !== null),
        JSON.stringify(seen.map((r) => r.kind)));

  // ---- R8: THE SCENE IS PART OF THE MEASUREMENT --------------------------
  //
  // Everything above aims at whatever the camera happened to be pointing at on
  // spawn, which is roughly level, and that is the one pitch at which this bug
  // does not appear. Reid plays looking around. So the acceptance is a PITCH
  // SWEEP, and it is the whole of Reid's sentence turned into one assertion:
  // at no pitch may the player end up INSIDE the preview.
  //
  // Measured before the fix, foundation in hand: 0 deg 6.051 m outside, -30
  // 3.206 m outside, -60 1.645 m INSIDE, -85 1.385 m INSIDE. Every one of those
  // was a real ground hit. Nothing was malfunctioning: look down and the ground
  // is close, so the building goes where you are standing, and a DoubleSide
  // slab you are within is the viewport.
  if (document.querySelector('#of-build') === null) {
    window.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true }));
    await sleep(0.5);
  }
  const f2 = [...document.querySelectorAll('#of-build [data-build]')]
    .find((x) => x.getAttribute('data-build') === 'foundation');
  if (f2 !== undefined) { f2.click(); await sleep(0.8); }

  const sweep = [];
  let sawShown = 0;
  let sawOverhead = 0;
  for (const pitch of [0, -30, -60, -85, 30, 60, 85]) {
    of.look(0, pitch);
    await sleep(0.7);
    const sv = of.structView();
    const a = of.buildAim ? of.buildAim() : null;
    const b = sv && sv.ghostBox;
    sweep.push({ pitch, ghost: sv && sv.ghost, aimed: a && a.aimed,
                 overhead: a && a.overhead,
                 distM: b && b.distM, encloses: b && b.encloses });
    if (sv && sv.ghost === true) sawShown++;
    if (a && a.overhead === true) sawOverhead++;
    if (b) {
      check(`at pitch ${pitch} the player is NOT inside the preview`,
            b.encloses === false,
            `centre ${b.distM} m from the eye, encloses ${b.encloses}. The `
            + 'ghost is DoubleSide with depthWrite off, so its inner faces are '
            + 'the whole viewport. This IS "the preview fills the screen".');
    }
  }
  log.push(`pitch sweep: ${sweep.map((r) => `${r.pitch}:`
    + `${r.ghost ? (r.distM + 'm') : 'hidden'}`).join('  ')}`);

  // BOTH OUTCOMES MUST OCCUR, or the sweep proves nothing. A build that hid the
  // preview everywhere would pass every enclosure check above; a build that
  // never hid it would leave the overhead cone unexercised.
  check('the preview is SHOWN at most pitches', sawShown >= 5,
        `shown at ${sawShown} of ${sweep.length}`);
  check('and REFUSED in the overhead cone, where there is no heading at all',
        sawOverhead >= 1 && sawOverhead <= 3,
        `overhead at ${sawOverhead} of ${sweep.length}. Hiding on every MISS `
        + 'was the first version of this fix and was worse than the bug: a 24 m '
        + 'march never dips below a 600 km sphere near the horizon either, so '
        + 'it hid the preview on flat open ground.');

  return {
    valid: fails.length === 0, fails, log,
    ghost: st.ghost, ghostBox: box,
    largestDimM: big,
    sweep: seen,
    pitchSweep: sweep,

    note: 'size and distance are separated on purpose: an enormous mesh and a '
      + 'mesh on top of the camera both fill the screen and are different bugs',
  };
})()
