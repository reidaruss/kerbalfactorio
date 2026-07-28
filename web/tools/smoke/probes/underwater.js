// DOES A SUBMERGED EYE SEE WATER? The one-binary instrument for the underwater
// post pass.
//
//   node tools/smoke/run.mjs --url=http://127.0.0.1:4217/ \
//     --width=1280 --height=720 --evalfile=tools/smoke/probes/underwater.js
//
// THE CLAIM BEING TESTED is not "the frame got bluer". It is the one physical
// fact the whole term is built on: water absorbs RED far harder than blue, so
// putting the eye under the surface must make the RED-OVER-BLUE RATIO of the
// image FALL. A term that tinted the frame uniformly would move every mean and
// leave that ratio alone, and would pass a "did anything change" check.
//
// EVERYTHING IS A MATCHED PAIR TAKEN INSIDE ONE PAGE, through
// `__ofUnderwater.set`, because two page loads cannot hold the camera, the sun,
// the resident chunk set AND the swimmer's own depth equal. That last one is new
// and is the reason each capture below RE-TELEPORTS first: `KinematicBody.spawn`
// puts the feet on the ground and zeroes the velocity, so re-running the same
// approach before each shot pins the swimmer to the same millimetre. Without it
// buoyancy is lifting the eye between the two captures and the difference image
// is mostly parallax.
//
// THREE CONTROLS, and each is chosen so a wrong answer cannot look right:
//
//   DRY LAND. The pass is SKIPPED when the eye is above the water rather than
//   multiplying by one, so 300 m from the pond the toggle must move EXACTLY
//   zero counts and `state().ran` must be false. This is the sky-band control
//   from probes/maps.js and probes/contact.js pointed at a different axis: a
//   number that must be 0.0000, not small.
//
//   WADING. Standing IN the pond with the eye above the surface. Water is
//   present, the oracle says so, and the toggle must still move exactly zero.
//   This is the sharper of the two: a pass keyed on "is the player wet" instead
//   of "is the EYE under" passes the dry control and fails here.
//
//   NOISE FLOOR. A third capture with the term back ON. Whatever fraction of
//   pixels differs between the two ON captures is the floor below which nothing
//   here means anything, measured rather than assumed (DebugPost's own note).
//
// OF_ARGS: { sunT, yawDeg, pitchDeg, holdSecs, dryDistM }
(async () => {
  const of = window.__of;
  const uw = window.__ofUnderwater;
  const post = window.__ofPost;
  if (!uw || !post) {
    throw new Error('underwater.js: missing a runtime handle: '
      + `__ofUnderwater=${!!uw} __ofPost=${!!post}`);
  }
  const A = (typeof OF_ARGS === 'object' && OF_ARGS !== null) ? OF_ARGS : {};
  const sunT = A.sunT ?? 0.30;
  const yaw = A.yawDeg ?? 0;
  const pitch = A.pitchDeg ?? -6;
  // The synthetic slice run after each teleport, before the shot is re-pinned.
  // Long enough for the flag to reach a rendered frame and for the fixed tick to
  // publish a fresh swim state, short enough that buoyancy has not lifted the
  // eye anywhere.
  const HOLD = A.holdSecs ?? 0.25;

  // Hide every sibling of the canvas at every ancestor level, the same DOM walk
  // probes/contact.js uses. A flat sweep of document.body.children leaves the
  // HUD up, because the canvas and the overlay share a wrapper.
  let node = document.querySelector('canvas');
  while (node !== null && node.parentElement !== null) {
    for (const sib of Array.from(node.parentElement.children)) {
      if (sib !== node) sib.style.display = 'none';
    }
    node = node.parentElement;
  }

  const w0 = of.world();
  const R = w0.bodyRadiusM;
  const wq = of.water(w0.player.feet[0], w0.player.feet[1], w0.player.feet[2]);
  const disc = wq.disc;
  if (disc === null) return { valid: false, why: 'no pond on this body' };

  // The pond's own tangent frame, exactly as probes/pondwade.js builds it, so
  // every station below is measured from /core's pond rather than from a
  // constant transcribed into this file.
  const ux = disc.dirX, uy = disc.dirY, uz = disc.dirZ;
  let ex = -uz, ey = 0, ez = ux;
  const el = Math.hypot(ex, ey, ez); ex /= el; ey /= el; ez /= el;
  const nx = uy * ez - uz * ey, ny = uz * ex - ux * ez, nz = ux * ey - uy * ex;
  const at = (distM, ang) => {
    const c = Math.cos(ang), s = Math.sin(ang), t = distM / R;
    let dx = ux + t * (c * ex + s * nx);
    let dy = uy + t * (c * ey + s * ny);
    let dz = uz + t * (c * ez + s * nz);
    const l = Math.hypot(dx, dy, dz);
    return [dx / l, dy / l, dz / l];
  };
  const gAt = (distM, ang) => {
    const d = at(distM, ang);
    const g = of.latlon(d[0], d[1], d[2]);
    return { latDeg: g.latDeg, lonDeg: g.lonDeg, dir: d };
  };

  // ---------------------------------------------------------------- stations
  const centre = gAt(0, 0);
  const dryDistM = A.dryDistM ?? 300;
  const dry = gAt(dryDistM, 0);
  // THE WADING STATION, found by bisection on the measured depth field rather
  // than guessed: somewhere the water stands about 1.0 m deep, which is under
  // the 1.62 m eye, so the player is wet and the eye is not.
  const wadeDistM = (() => {
    let lo = 0, hi = disc.shorelineM;
    for (let i = 0; i < 40; ++i) {
      const mid = 0.5 * (lo + hi);
      const d = at(mid, 0);
      if (of.water(d[0], d[1], d[2]).depthM > 1.0) lo = mid; else hi = mid;
    }
    return 0.5 * (lo + hi);
  })();
  const wade = gAt(wadeDistM, 0);

  // ------------------------------------------------------------- converging
  // ONE CONVERGENCE PER STATION, and the first attempt did not have it. The dry
  // control 300 m from the pond then read meanAbs 20.47 of 255 with the pass
  // provably not running, because the two captures held different resident chunk
  // sets: the probe had converged at the pond and teleported away. A control that
  // must read exactly zero has to be given a settled world first, or it is
  // measuring the streamer.
  let spin = 0;
  const arrive = async (st) => {
    of.teleport(st.latDeg, st.lonDeg, 2);
    of.look(yaw, pitch);
    of.setTime(sunT);
    await of.run(2.0);
    let s = 0;
    while (!of.world().chunks.converged && s++ < 240) await of.run(0.5);
    spin += s;
    of.setTime(sunT);         // RE-PIN: the wait above ate sim time (RN-13).
    await of.settle(30);
  };

  /**
   * THE WARM-UP LEG, discarded, and it is not superstition. With one convergence
   * per station the dry control still read meanAbs 0.56 with a peak of 173,
   * while the noise floor taken between the SECOND and THIRD captures at the
   * same station read exactly 0.0000. So what moves is the first capture after a
   * teleport (the terrain cross-fade still running out, the cascades refitting),
   * and the fix is to spend one capture on it rather than to widen a tolerance.
   */
  const warmUp = async (st) => { await leg(st, true); };

  let W = 0;
  let H = 0;
  const shoot = async () => {
    const bmp = await createImageBitmap(await of.screenshot());
    W = bmp.width; H = bmp.height;
    const cv = new OffscreenCanvas(W, H);
    const ctx = cv.getContext('2d');
    ctx.drawImage(bmp, 0, 0);
    const d = ctx.getImageData(0, 0, W, H).data;
    bmp.close();
    return d;
  };

  /**
   * One capture, at one station, with the term in one state.
   *
   * The teleport is done TWICE on purpose. The first one plus HOLD seconds of
   * synthetic clock gets the flag onto a rendered frame and the fixed tick to
   * publish a swim state for the new position; the second RE-PINS the capsule to
   * the same feet with zero velocity immediately before the shot, so the frame
   * that is actually captured is at most a tick or two of buoyant rise from
   * rest. That is what makes the on/off pair differ by the flag and nothing else.
   */
  const leg = async (st, on) => {
    uw.set(on);
    of.teleport(st.latDeg, st.lonDeg, 2);
    of.look(yaw, pitch);
    of.setTime(sunT);
    await of.run(HOLD, 60);
    of.teleport(st.latDeg, st.lonDeg, 2);
    of.look(yaw, pitch);
    of.setTime(sunT);
    const px = await shoot();
    return { px, swim: of.swim(), state: uw.state(), post: of.post() };
  };

  // --------------------------------------------------------------- metrics
  const LIT = 12;
  /** `a` is the reference (term OFF), `b` is the subject (term ON). */
  const compare = (a, b) => {
    let n = 0, moved = 0, peak = 0, sumAbs = 0;
    let dr = 0, dg = 0, db = 0;
    let ra = 0, ga = 0, ba = 0, rb = 0, gb = 0, bb = 0, lit = 0;
    const len = Math.min(a.length, b.length);
    for (let i = 0; i < len; i += 4) {
      const R0 = a[i], G0 = a[i + 1], B0 = a[i + 2];
      const R1 = b[i], G1 = b[i + 1], B1 = b[i + 2];
      dr += R1 - R0; dg += G1 - G0; db += B1 - B0;
      const m = Math.max(Math.abs(R1 - R0), Math.abs(G1 - G0), Math.abs(B1 - B0));
      sumAbs += m;
      if (m > 2) moved++;
      if (m > peak) peak = m;
      // THE DENOMINATOR FLOOR. A red-over-blue ratio taken over pixels that are
      // black in both images divides noise by noise; every ratio below is
      // computed only where the REFERENCE pixel is lit, and the count it was
      // taken over is reported next to it (RN-12's rule).
      if (Math.max(R0, G0, B0) >= LIT) {
        ra += R0; ga += G0; ba += B0;
        rb += R1; gb += G1; bb += B1;
        lit++;
      }
      n++;
    }
    const k = Math.max(1, n);
    const kl = Math.max(1, lit);
    const rbOff = ba > 0 ? ra / ba : 0;
    const rbOn = bb > 0 ? rb / bb : 0;
    return {
      samplePx: n, litPx: lit,
      meanShiftR: +(dr / k).toFixed(4),
      meanShiftG: +(dg / k).toFixed(4),
      meanShiftB: +(db / k).toFixed(4),
      meanAbs: +(sumAbs / k).toFixed(4),
      movedFraction: +(moved / k).toFixed(4),
      peak,
      meanOff: [+(ra / kl).toFixed(2), +(ga / kl).toFixed(2), +(ba / kl).toFixed(2)],
      meanOn: [+(rb / kl).toFixed(2), +(gb / kl).toFixed(2), +(bb / kl).toFixed(2)],
      redOverBlueOff: +rbOff.toFixed(4),
      redOverBlueOn: +rbOn.toFixed(4),
      redOverBlueDrop: +(rbOff - rbOn).toFixed(4),
    };
  };

  /**
   * THE EXACT-ZERO INSTRUMENT, and it is not a screenshot.
   *
   * `of.screenshot()` resolves on a LATER rendered frame, so the two halves of a
   * screenshot pair are separated by at least one fixed tick. Sim time moves,
   * and sim time is a uniform: TerrainMaterial takes `uTime` and the surface art
   * animates on it. Measured, with the term held OFF in both legs, that floor is
   * about 1.4 counts of mean absolute movement with a peak near 180 on the few
   * pixels where something swayed across a hard edge. No amount of settling
   * removes it, because it is not settling, it is animation.
   *
   * `of.framehash()` renders SYNCHRONOUSLY and reads the pixels back in the same
   * call, so two back-to-back calls cannot have a tick between them: JavaScript
   * is single threaded and no rAF callback can interleave two statements. Flip
   * the flag between them and the only thing that differs is the flag. The FNV
   * hash over every colour byte then makes "exactly zero" a BIT-EXACT claim
   * rather than a rounded mean, which is strictly stronger than what the brief
   * asked for and is the only form in which it is actually obtainable here.
   */
  const hashPair = (tx = 160, ty = 90) => {
    uw.set(true);
    const on = of.framehash(tx, ty);
    uw.set(false);
    const off = of.framehash(tx, ty);
    uw.set(true);
    let maxTile = 0;
    let sumTile = 0;
    for (let i = 0; i < on.tiles.length; ++i) {
      const d = Math.abs(on.tiles[i] - off.tiles[i]);
      sumTile += d;
      if (d > maxTile) maxTile = d;
    }
    return {
      hashOn: on.hash, hashOff: off.hash, identical: on.hash === off.hash,
      pixels: on.w * on.h, tiles: on.tiles.length,
      maxTileLumShift: +maxTile.toFixed(4),
      meanTileLumShift: +(sumTile / Math.max(1, on.tiles.length)).toFixed(4),
    };
  };

  /** For a control that must read exactly zero: absolute per-channel movement. */
  const control = (a, b) => {
    let n = 0, sum = 0, peak = 0;
    const len = Math.min(a.length, b.length);
    for (let i = 0; i < len; i += 4) {
      for (let c = 0; c < 3; ++c) {
        const d = Math.abs(a[i + c] - b[i + c]);
        sum += d; n++;
        if (d > peak) peak = d;
      }
    }
    return { samples: n, meanAbs: +(sum / Math.max(1, n)).toFixed(4), peak };
  };

  // ============================================================== 1. DRY LAND
  // The term is held OFF through every leg below that is not itself underwater,
  // so that when the program count is read the two underwater programs have
  // PROVABLY never been compiled. Compilation is lazy, on first use.
  uw.set(false);
  await arrive(dry);
  await warmUp(dry);
  const dryHash = hashPair();
  const dryOn = await leg(dry, true);
  const dryOff = await leg(dry, false);
  const dryOff2 = await leg(dry, false);
  const dryControl = control(dryOn.px, dryOff.px);
  // The SAME measurement with the term off in BOTH legs: the instrument's own
  // floor at this station, so the line above is read against something.
  const dryFloor = control(dryOff.px, dryOff2.px);

  // ============================================================== 2. WADING
  await arrive(wade);
  await warmUp(wade);
  const wadeHash = hashPair();
  const wadeOn = await leg(wade, true);
  const wadeOff = await leg(wade, false);
  const wadeOff2 = await leg(wade, false);
  const wadeControl = control(wadeOn.px, wadeOff.px);
  const wadeFloor = control(wadeOff.px, wadeOff2.px);

  // ============================================================ 3. SUBMERGED
  // The camera is converged HERE with the term still off, and the count is taken
  // at that instant, so the delta below spans exactly the first frame the pass
  // ran at an otherwise unchanged view.
  uw.set(false);
  await arrive(centre);
  // The warm-up here is taken with the term OFF, so it cannot compile either of
  // the underwater programs before the count below is read.
  await leg(centre, false);
  const programsDry = of.stats().draw.programs;
  const vramDryMB = of.post().vramMB;
  // The POSITIVE control on the exact-zero instrument itself: at this station
  // the two hashes must DIFFER, or `hashPair` is measuring nothing anywhere.
  const subHash = hashPair();
  const subOff = await leg(centre, false);
  const subOn = await leg(centre, true);
  const subOn2 = await leg(centre, true);      // the noise floor
  const programsWet = of.stats().draw.programs;

  const submerged = compare(subOff.px, subOn.px);
  const noise = control(subOn.px, subOn2.px);
  let noiseMoved = 0;
  for (let i = 0; i < subOn.px.length; i += 4) {
    let m = 0;
    for (let c = 0; c < 3; ++c) m = Math.max(m, Math.abs(subOn.px[i + c] - subOn2.px[i + c]));
    if (m > 2) noiseMoved++;
  }
  const noiseFraction = +(noiseMoved / Math.max(1, subOn.px.length / 4)).toFixed(4);

  // ============================================== 4. INVARIANT COUNTS, not time
  // Several build and probe runs share this machine tonight, so frame timings
  // are noise. Draw calls, programs and VRAM are not.
  const invariants = {
    postCallsSubmergedOn: subOn.post.calls,
    postCallsSubmergedOff: subOff.post.calls,
    postCallsDelta: subOn.post.calls - subOff.post.calls,
    postCallsDryOn: dryOn.post.calls,
    postCallsDryOff: dryOff.post.calls,
    dryCallsDelta: dryOn.post.calls - dryOff.post.calls,
    vramMBOn: subOn.post.vramMB,
    vramMBOff: subOff.post.vramMB,
    // Before the pass had ever run, so this spans the lazy allocation of its
    // one scratch buffer.
    vramMBBeforeFirstDive: vramDryMB,
    vramMBDelta: +(subOn.post.vramMB - vramDryMB).toFixed(3),
    waterBufferBytes: subOn.state.bytes,
    // Compiled lazily on first use, so this delta is read across the first dive.
    // It is an UPPER bound on what this pass added: anything else the swim view
    // compiled for the first time lands in it too.
    programsDry, programsWet, programsDelta: programsWet - programsDry,
  };

  // `endWith:'off'` leaves the term off so the runner's own --out capture is the
  // BEFORE half of the pair. Both halves are then taken at the same station in
  // the same binary, which is the point.
  uw.set((A.endWith ?? 'on') !== 'off');
  await of.settle(8);
  const w = of.world();
  const sw = subOn.swim;
  const drove = w.tick > w0.tick && sw !== null && sw.headUnderM > 1.0;

  return {
    // DW-20: the numbers are only worth reading if the probe demonstrably put
    // the eye under the water first.
    valid: drove && W > 0 && submerged.litPx > 10000,
    scene: {
      viewport: [W, H], sunT, yawDeg: yaw, pitchDeg: pitch,
      converged: w.chunks.converged, convergeSpins: spin,
      biome: w.biome, tick: w.tick, startTick: w0.tick,
      gravityAtSurfaceMps2: +of.gravity(R).toFixed(4),
    },
    pond: {
      shorelineM: disc.shorelineM, basinRadiusM: disc.basinRadiusM,
      levelM: disc.levelM, maxDepthM: disc.maxDepthM,
      wadeStationDistM: +wadeDistM.toFixed(3), dryStationDistM: dryDistM,
    },
    // Did the switch actually switch, and did the pass actually run? Asserted
    // apart from what it did, because a measurement over an effect that never
    // ran is the failure RN-10 shipped once already.
    handles: {
      submergedOn: {
        ran: subOn.state.ran, headUnderM: +subOn.state.headUnderM.toFixed(4),
        swimHeadUnderM: +subOn.swim.headUnderM.toFixed(4),
        wired: subOn.state.wired, upWorld: subOn.state.upWorld.map((v) => +v.toFixed(4)),
      },
      submergedOff: { on: subOff.state.on, ran: subOff.state.ran },
      dryOn: {
        ran: dryOn.state.ran, headUnderM: +dryOn.state.headUnderM.toFixed(4),
        swimInWater: dryOn.swim === null ? null : dryOn.swim.inWater,
      },
      wadeOn: {
        ran: wadeOn.state.ran, headUnderM: +wadeOn.state.headUnderM.toFixed(4),
        swimInWater: wadeOn.swim === null ? null : wadeOn.swim.inWater,
        swimFrac: wadeOn.swim === null ? null : +wadeOn.swim.frac.toFixed(4),
      },
      tuning: {
        sigma: subOn.state.sigma, tint: subOn.state.tint,
        scatter: subOn.state.scatter, maxPathM: subOn.state.maxPathM,
        extinction: subOn.state.extinction, tintScale: subOn.state.tintScale,
        scatterFrac: subOn.state.scatterFrac,
      },
    },
    submerged,
    noiseFloor: { ...noise, movedFraction: noiseFraction },
    // BIT-EXACT, one sim tick, one frame: the assertions live on these.
    matchedHashPairs: { dry: dryHash, wade: wadeHash, submerged: subHash },
    // Screenshot pairs at the same stations, reported for scale only: the
    // toggle number and the term-off-in-both-legs floor next to it, so the
    // residual is visibly the instrument and not the effect.
    screenshotControls: {
      dry: { toggle: dryControl, floorOffVsOff: dryFloor },
      wade: { toggle: wadeControl, floorOffVsOff: wadeFloor },
    },
    invariants,
    checks: {
      // The probe advanced the sim and genuinely got the eye under water.
      drove,
      eyeWasDeep: sw !== null && sw.headUnderM > 1.0,
      passRanWhenSubmerged: subOn.state.ran === true,
      passSkippedWhenOff: subOff.state.ran === false,
      // THE PHYSICAL CLAIM. Red is absorbed hardest, so the ratio must FALL.
      redOverBlueFell: submerged.redOverBlueDrop > 0.02,
      redFellHarderThanBlue: submerged.meanShiftR < submerged.meanShiftB,
      // It reached the frame at all, and by more than the instrument's floor.
      movedMostOfTheFrame: submerged.movedFraction > 0.5,
      aboveTheNoiseFloor: submerged.movedFraction > noiseFraction * 4,
      // THE NEGATIVE CONTROLS. Exactly zero, because the pass is SKIPPED rather
      // than made an identity.
      // BIT-EXACT: every colour byte of the frame is identical with the term on
      // and off, 300 m from the pond and standing in it up to the chest.
      dryIsBitIdentical: dryHash.identical === true
        && dryHash.maxTileLumShift === 0,
      dryPassDidNotRun: dryOn.state.ran === false,
      wadeIsBitIdentical: wadeHash.identical === true
        && wadeHash.maxTileLumShift === 0,
      wadePassDidNotRun: wadeOn.state.ran === false,
      // The instrument can tell the two apart, so the two zeros above mean
      // something.
      submergedHashDiffers: subHash.identical === false
        && subHash.maxTileLumShift > 1,
      wadeWasActuallyWet: wadeOn.swim !== null && wadeOn.swim.inWater === true,
      // THE INVARIANT COUNTS.
      threeExtraDrawCallsSubmerged: invariants.postCallsDelta === 3,
      noExtraDrawCallsDry: invariants.dryCallsDelta === 0,
      // W x H x 4 bytes, allocated on the first submerged frame and never
      // before, so a dry planet pays nothing.
      vramIsOneRgba8Frame: invariants.waterBufferBytes === W * H * 4,
    },
  };
})()
