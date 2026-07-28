// pondwade.js - the pond is a BASIN, and a player wades into it, swims, and
// gets out. WG-43.
//
// R8, which this project has now paid for twice: a geometric probe that only
// runs on the flat spawn clearing proves nothing. A 10.1 degree belt
// misalignment measured EXACTLY ZERO on flat ground across 39 driven
// keypresses, and the tunnel-sinking hunt burned two passes the same way. A
// pond has a CIRCULAR shoreline, so every bearing is different ground and a
// single hand-placed wade would be exactly that mistake again. This probe
// therefore drives the wade on BEARINGS bearings and reports every one, and
// asserts on the WORST of them rather than on an average that a good bearing
// can carry.
//
// It also carries a negative control that must be able to fail: the same driven
// walk, the same distance, on flat ground away from the pond, where every water
// reading must be identically zero. Without it, a swim state that is simply
// always on would pass every assertion above.
//
// OF_ARGS: { bearings, secs }
(async () => {
  const of = window.__of;
  const A = (typeof OF_ARGS === 'object' && OF_ARGS !== null) ? OF_ARGS : {};
  const BEARINGS = A.bearings ?? 6;
  const yield0 = () => new Promise((r) => { setTimeout(r, 0); });
  const DT = 1 / 60;

  const w0 = of.world();
  const R = w0.bodyRadiusM;

  // --- the pond, as /core describes it. Everything below is measured against
  //     these, never against a constant transcribed into this file: a control
  //     ring sized from a stale copy of the thing it watches is standing rule
  //     11's own worked example of a probe failing in the direction that looks
  //     like a real defect.
  const w = of.water(w0.player.feet[0], w0.player.feet[1], w0.player.feet[2]);
  const disc = w.disc;
  if (disc === null) return { valid: false, why: 'no pond on this body' };

  const ux = disc.dirX, uy = disc.dirY, uz = disc.dirZ;
  let ex = -uz, ey = 0, ez = ux;
  const el = Math.hypot(ex, ey, ez); ex /= el; ey /= el; ez /= el;
  const nx = uy * ez - uz * ey, ny = uz * ex - ux * ez, nz = ux * ey - uy * ex;

  /** Unit direction `distM` from the pond centre along `ang`. */
  const at = (distM, ang) => {
    const c = Math.cos(ang), s = Math.sin(ang), t = distM / R;
    let dx = ux + t * (c * ex + s * nx);
    let dy = uy + t * (c * ey + s * ny);
    let dz = uz + t * (c * ez + s * nz);
    const l = Math.hypot(dx, dy, dz);
    return [dx / l, dy / l, dz / l];
  };
  const latLon = (d) => of.latlon(d[0], d[1], d[2]);

  /** Heading of a body-frame displacement in the pond's own tangent frame,
   *  radians, measured the same way `at()` measures its bearing angle. */
  const headingOf = (dx, dy, dz) => {
    const c = dx * ex + dy * ey + dz * ez;
    const s = dx * nx + dy * ny + dz * nz;
    return Math.atan2(s, c);
  };

  // =========================================================================
  // 1. THE BASIN, sampled as a depth profile from outside the rim to the
  //    centre, on every bearing. This is the "measured depth profile from
  //    shore to centre" the brief asks for, and it is geometry, not a render.
  // =========================================================================
  const RIM_OUT_M = disc.basinRadiusM * 1.5;
  const STEPS = 240;
  const profiles = [];
  let worstMonotone = 0;          // biggest UPHILL step walking inward (m)
  let worstOutsideDev = 0;        // biggest deviation of the ground outside the
                                  // basin from the flat pad it should be (m)
  let padH = null;
  for (let b = 0; b < BEARINGS; ++b) {
    const ang = (2 * Math.PI * b) / BEARINGS;
    const rows = [];
    let prevH = null;
    for (let i = STEPS; i >= 0; --i) {   // outside -> centre
      const distM = (RIM_OUT_M * i) / STEPS;
      const d = at(distM, ang);
      const sf = of.surface(d[0], d[1], d[2]);
      const wa = of.water(d[0], d[1], d[2]);
      rows.push({ distM, groundM: sf.surfaceM, depthM: wa.depthM, dry: wa.dry });
      if (distM >= disc.basinRadiusM) {
        if (padH === null) padH = sf.surfaceM;
        const dev = Math.abs(sf.surfaceM - padH);
        if (dev > worstOutsideDev) worstOutsideDev = dev;
      } else if (prevH !== null) {
        const up = sf.surfaceM - prevH;      // > 0 means the ground rose inward
        if (up > worstMonotone) worstMonotone = up;
      }
      prevH = sf.surfaceM;
    }
    // A readable ladder for the report: ground and water every 2 m.
    const ladder = [];
    for (let dM = 0; dM <= Math.ceil(disc.basinRadiusM); dM += 2) {
      const d = at(dM, ang);
      ladder.push({
        rM: dM,
        groundM: Math.round(of.surface(d[0], d[1], d[2]).surfaceM * 1000) / 1000,
        waterM: Math.round(of.water(d[0], d[1], d[2]).depthM * 1000) / 1000,
      });
    }
    profiles.push({ bearingDeg: Math.round((ang * 180) / Math.PI), ladder });
    rows.length = 0;
  }

  const centre = at(0, 0);
  const centreGround = of.surface(centre[0], centre[1], centre[2]).surfaceM;
  const centreDepth = of.water(centre[0], centre[1], centre[2]).depthM;
  const basinCutM = padH === null ? NaN : padH - centreGround;

  // The waterline is where the water actually ends, found by bisection on the
  // measured field rather than read off disc.shorelineM, so the two are an
  // independent check on each other.
  const findWaterline = (ang) => {
    let lo = 0, hi = disc.basinRadiusM;
    for (let i = 0; i < 40; ++i) {
      const mid = 0.5 * (lo + hi);
      const d = at(mid, ang);
      if (of.water(d[0], d[1], d[2]).depthM > 0) lo = mid; else hi = mid;
    }
    return 0.5 * (lo + hi);
  };
  const waterlines = [];
  for (let b = 0; b < BEARINGS; ++b) waterlines.push(findWaterline((2 * Math.PI * b) / BEARINGS));
  const waterlineErr = Math.max(...waterlines.map((v) => Math.abs(v - disc.shorelineM)));

  // =========================================================================
  // 2. THE DRIVEN WADE, once per bearing. Walk from dry land straight through
  //    the pond and out the far side, recording the walker's OWN state every
  //    tick. Nothing here is derived for the report: `of.swim()` returns the
  //    object the capsule acted on.
  // =========================================================================
  // YAW IS CALIBRATED, NOT ASSUMED. The mapping from the game's yaw degrees to
  // a heading in this probe's tangent frame is a convention (which axis is
  // zero, which way it turns) and a probe that guesses it wrong walks off in
  // some other direction and reports whatever it finds there. So measure it:
  // walk briefly at two known yaws, read the two headings back off the actual
  // displacement, and solve for the scale and the offset. Costs 1.2 seconds
  // once and removes the whole class of "the probe was aimed at the wrong
  // ground", which is the defect that cost WG-33 a pass.
  const calibrate = async () => {
    const p0 = at(300, 0);
    const g0 = latLon(p0);
    const sample = async (yawDeg) => {
      of.teleport(g0.latDeg, g0.lonDeg, 2);
      await of.settle(8);
      of.look(yawDeg, 0);
      const a = of.world().player.feet.slice();
      of.input.tape([{ hold: 90, actions: ['forward'] }]);
      await of.run(0.6, 60);
      await yield0();
      const b = of.world().player.feet;
      of.input.tape([{ hold: 20, actions: [] }]);
      await of.run(0.1, 60);
      const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      return { h: headingOf(d[0], d[1], d[2]), m: Math.hypot(d[0], d[1], d[2]) };
    };
    const s0 = await sample(0);
    const s90 = await sample(90);
    let dh = s90.h - s0.h;
    while (dh > Math.PI) dh -= 2 * Math.PI;
    while (dh < -Math.PI) dh += 2 * Math.PI;
    // sign is +1 if a yaw increase turns the heading the same way this probe
    // measures angles, -1 otherwise.
    const sign = dh >= 0 ? 1 : -1;
    return {
      sign, h0: s0.h, movedM: Math.min(s0.m, s90.m),
      dhDeg: Math.round((dh * 180) / Math.PI),
      /** Yaw, in degrees, that walks along heading `h` radians. */
      yawFor: (h) => {
        let e = (h - s0.h) * sign;
        while (e > Math.PI) e -= 2 * Math.PI;
        while (e < -Math.PI) e += 2 * Math.PI;
        return (e * 180) / Math.PI;
      },
    };
  };
  const cal = await calibrate();

  const walks = [];
  const drive = async (startDistM, ang, secs, keys) => {
    const start = at(startDistM, ang);
    const g = latLon(start);
    of.teleport(g.latDeg, g.lonDeg, 2);
    await of.settle(10);
    // Face the pond centre: the heading that walks INWARD along this bearing is
    // the bearing reversed, and the yaw that produces it comes from the
    // calibration rather than from an assumed convention.
    of.look(cal.yawFor(ang + Math.PI), -2);
    const ticks = Math.ceil(secs * 60);
    of.input.tape([{ hold: ticks + 120, actions: keys }]);
    const t0 = of.world().tick;
    const f0 = of.world().player.feet.slice();
    const rec = {
      ticks: 0, maxFrac: 0, maxSubM: -1e9, floatTicks: 0, wetTicks: 0,
      minEyeClearM: 1e9, sankBelowBedM: 0, maxSpeedFloating: 0,
      firstFloatSubM: null, endFrac: 0, endGrounded: false, breathMax: 0,
      fracRise: 0, fracFall: 0, prevFrac: 0, minDistCentreM: 1e9,
      maxHeadUnderM: -1e9,
    };
    const floatSpeeds = [];
    for (let i = 0; i < ticks; ++i) {
      await of.run(DT, 60);
      if ((i & 7) === 7) await yield0();
      const ww = of.world();
      const sw = of.swim();
      if (sw === null) continue;
      rec.ticks = ww.tick - t0;
      const p = ww.player.feet;
      const pr = Math.hypot(p[0], p[1], p[2]);
      const groundR = R + of.surface(p[0] / pr, p[1] / pr, p[2] / pr).surfaceM;
      const dC = R * Math.hypot(p[0] / pr - ux, p[1] / pr - uy, p[2] / pr - uz);
      if (dC < rec.minDistCentreM) rec.minDistCentreM = dC;
      if (sw.headUnderM > rec.maxHeadUnderM) rec.maxHeadUnderM = sw.headUnderM;
      // THE ONE THING THAT MUST NEVER HAPPEN: the basin is terrain, so the
      // feet may not be under it. 5 cm is the ground-snap residue.
      const below = groundR - pr;
      if (below > rec.sankBelowBedM) rec.sankBelowBedM = below;
      if (sw.frac > rec.maxFrac) rec.maxFrac = sw.frac;
      if (sw.feetUnderM > rec.maxSubM) rec.maxSubM = sw.feetUnderM;
      if (sw.inWater) rec.wetTicks++;
      if (sw.floating) {
        rec.floatTicks++;
        if (rec.firstFloatSubM === null) rec.firstFloatSubM = sw.feetUnderM;
        // While floating the eye must be OUT of the water, or the camera is
        // under the surface and the player cannot see where they are going.
        const clear = -sw.headUnderM;
        if (clear < rec.minEyeClearM) rec.minEyeClearM = clear;
        if (ww.player.speedMps > rec.maxSpeedFloating) rec.maxSpeedFloating = ww.player.speedMps;
        floatSpeeds.push(ww.player.speedMps);
      }
      if (sw.frac > rec.prevFrac) rec.fracRise++; else if (sw.frac < rec.prevFrac) rec.fracFall++;
      rec.prevFrac = sw.frac;
      if (sw.breathSecs > rec.breathMax) rec.breathMax = sw.breathSecs;
      rec.endFrac = sw.frac;
      rec.endGrounded = ww.player.grounded;
    }
    const f1 = of.world().player.feet;
    rec.travelledM = Math.hypot(f1[0] - f0[0], f1[1] - f0[1], f1[2] - f0[2]);
    const pr1 = Math.hypot(f1[0], f1[1], f1[2]);
    rec.endDistFromCentreM = R * Math.hypot(
      f1[0] / pr1 - ux, f1[1] / pr1 - uy, f1[2] / pr1 - uz);
    of.input.tape([{ hold: 30, actions: [] }]);
    // CONVERGENCE, NOT A THRESHOLD. The peak speed while floating is momentum
    // carried in off the bank, which the water is supposed to bleed off rather
    // than clamp instantly, so a peak just over the cap is the drag working and
    // not the cap failing. What must be true is that the speed SETTLES to the
    // swim speed, so the assertion is on the mean of the last quarter of the
    // float ticks. Asserting the peak instead would fail a correct
    // implementation and pass one that clamped and then crept back up.
    const tail = floatSpeeds.slice(Math.floor(floatSpeeds.length * 0.75));
    rec.floatSpeedTailMps = tail.length === 0 ? 0
      : tail.reduce((a, b) => a + b, 0) / tail.length;
    return rec;
  };

  const startM = disc.basinRadiusM + 6;
  const secs = A.secs ?? 40;
  for (let b = 0; b < BEARINGS; ++b) {
    const ang = (2 * Math.PI * b) / BEARINGS;
    const rec = await drive(startM, ang, secs, ['forward']);
    rec.bearingDeg = Math.round((ang * 180) / Math.PI);
    walks.push(rec);
  }

  // =========================================================================
  // 3. THE NEGATIVE CONTROL. Same drive, same duration, 300 m from the pond on
  //    the flat pad. Every water reading must be identically zero. If this
  //    goes non-zero the swim state is not reading the water, it is reading
  //    something else, and every assertion above is worthless.
  // =========================================================================
  const dry = await drive(300, 0, 8, ['forward']);

  // =========================================================================
  // 4. THE DIVE. Nothing above ever put the camera under the water, because
  //    buoyancy holds the eye 0.28 m clear, so "a water surface the camera
  //    crosses correctly" was untested by the wade and would have shipped on
  //    an assumption. Drop in from above the middle instead: the eye goes
  //    under on entry, breathSecs starts counting, and the capsule must
  //    surface on its own with no input at all.
  // =========================================================================
  const dive = await (async () => {
    const g = latLon(centre);
    of.teleport(g.latDeg, g.lonDeg, 9);
    await of.settle(10);
    of.input.tape([{ hold: 600, actions: [] }]);
    const rec = { ticks: 0, maxHeadUnderM: -1e9, breathMax: 0, endHeadUnderM: 0,
      endFloating: false, endFrac: 0, surfacedAtTick: null };
    const t0 = of.world().tick;
    for (let i = 0; i < 480; ++i) {
      await of.run(DT, 60);
      if ((i & 7) === 7) await yield0();
      const sw = of.swim();
      if (sw === null) continue;
      rec.ticks = of.world().tick - t0;
      if (sw.headUnderM > rec.maxHeadUnderM) rec.maxHeadUnderM = sw.headUnderM;
      if (sw.breathSecs > rec.breathMax) rec.breathMax = sw.breathSecs;
      if (rec.maxHeadUnderM > 0 && sw.headUnderM <= 0 && rec.surfacedAtTick === null) {
        rec.surfacedAtTick = rec.ticks;
      }
      rec.endHeadUnderM = sw.headUnderM;
      rec.endFloating = sw.floating;
      rec.endFrac = sw.frac;
    }
    return rec;
  })();

  const worst = (f) => Math.max(...walks.map(f));
  const best = (f) => Math.min(...walks.map(f));

  const drove = best((r) => r.ticks) > 400 && best((r) => r.travelledM) > 8;
  const everySwam = best((r) => r.floatTicks) > 30;
  // "Got out" means CROSSED and LANDED DRY on the far side, not merely that the
  // frac happened to read 0 at the last tick while still standing in the pond.
  const everyCrossed = walks.every((r) => r.minDistCentreM < 4.0);
  const everyGotOut = walks.every((r) => r.endFrac === 0 && r.endGrounded
    && r.endDistFromCentreM > disc.shorelineM);
  const neverSank = worst((r) => r.sankBelowBedM) < 0.05;
  const eyeStayedClear = best((r) => r.minEyeClearM) > 0;
  const controlIsDry = dry.wetTicks === 0 && dry.maxFrac === 0
    && dry.floatTicks === 0 && dry.ticks > 200 && dry.travelledM > 8;

  return {
    valid: drove && dry.ticks > 200 && cal.movedM > 1.0,
    calibration: { dhDeg: cal.dhDeg, sign: cal.sign, movedM: cal.movedM },
    pond: {
      shorelineM: disc.shorelineM,
      basinRadiusM: disc.basinRadiusM,
      levelM: disc.levelM,
      maxDepthM: disc.maxDepthM,
    },
    basin: {
      padHeightM: padH,
      centreGroundM: centreGround,
      basinCutM,
      centreWaterDepthM: centreDepth,
      // The ground must fall INWARD everywhere: any positive number here is a
      // bump in the bowl, which would be a ledge to catch a wader on.
      worstUphillStepInwardM: worstMonotone,
      // Outside the basin the pad is dead flat, so this is the leak test for
      // the basin term: it must be 0 to the last bit.
      worstDeviationOutsideBasinM: worstOutsideDev,
      measuredWaterlinesM: waterlines.map((v) => Math.round(v * 1000) / 1000),
      waterlineVsCoreM: waterlineErr,
    },
    profiles,
    walks,
    control: dry,
    dive,
    checks: {
      drove,
      basinIsCut: Math.abs(basinCutM - 4.0) < 0.01,
      basinMonotone: worstMonotone < 1e-9,
      basinDoesNotLeak: worstOutsideDev < 1e-9,
      waterlineAgrees: waterlineErr < 0.05,
      centreDepthIsDeep: centreDepth > 3.0,
      everySwam,
      everyCrossed,
      everyGotOut,
      neverSank,
      eyeStayedClear,
      swimSpeedSettles: worst((r) => r.floatSpeedTailMps) <= 2.31,
      // The dive is the only leg that puts the camera under the surface.
      diveWentUnder: dive.maxHeadUnderM > 0.25,
      diveSurfacedUnaided: dive.surfacedAtTick !== null && dive.endHeadUnderM < 0,
      diveBreathCounted: dive.breathMax > 0.2,
      controlIsDry,
    },
  };
})()
