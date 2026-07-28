// water.js - the pond's LOOK, term by term, measured where it is supposed to
// work rather than where it is supposed to do nothing (RN-58).
//
// OF_ARGS: { distM, altM, pitchDeg, bearingDeg, sunT, endWith }
//
// THE INSTRUMENT IS `of.framehash()` AND IT COULD NOT BE A SCREENSHOT. The water
// ANIMATES: the ripple phase is a function of `uTime`, which is sim seconds, so
// two screenshots of the same camera are separated by at least one fixed tick
// and the surface has genuinely moved between them. There is no settling that
// removes that, because it is not settling, it is animation. `framehash` renders
// synchronously and reads back in the same call, so two back-to-back calls
// cannot have a tick between them: JavaScript is single threaded and no rAF
// callback can interleave two statements. Flip an amplitude between them and the
// only thing that differs is the amplitude.
//
// WHY EVERY CLAIM HERE IS A POSITIVE ONE. RN-46 reported `wetCells: 0` at two
// DRY sites and called it a result; RN-48 found the feature had been dead in
// three independent ways, because zero at a site where the term should do
// nothing is equally consistent with "it works", "it never ran", and "it is
// unreachable". So every term below is asserted at the POND, on the pixels it is
// meant to change, and the negative control is a separate, bit-exact claim.
//
// THE NOISE FLOOR IS TAKEN FIRST AND IT IS EXACT. Two framehash calls with
// nothing touched between them must return the IDENTICAL hash. If they do not,
// nothing after it means anything, and the probe says so instead of reporting
// differences against a floor it never established. RN-45 shipped a floor that
// read exactly equal to the effect it was bounding because the state was not
// reset before the capture; two numbers agreeing to the last digit is a wiring
// diagnosis, never a coincidence.
(async () => {
  const of = window.__of;
  const A = (typeof OF_ARGS === 'object' && OF_ARGS !== null) ? OF_ARGS : {};
  const yield0 = () => new Promise((r) => { setTimeout(r, 0); });
  const water = window.__ofWater;
  const art = window.__ofTerrainArt;
  if (water === undefined) return { valid: false, why: 'no __ofWater handle' };

  const w0 = of.world();
  const R = mustNum(w0, 'bodyRadiusM', 'world');
  const wq = of.water(w0.player.feet[0], w0.player.feet[1], w0.player.feet[2]);
  const disc = wq.disc;
  if (disc === null) return { valid: false, why: 'no pond on this body' };

  // ---------------------------------------------------------------- framing
  // Lifted from pondshot.js, and the yaw is SEARCHED rather than assumed for the
  // reason RN-48 records: a shot aimed by an assumed convention photographs
  // whatever happens to be there instead of the subject.
  const ux = disc.dirX, uy = disc.dirY, uz = disc.dirZ;
  let ex = -uz, ey = 0, ez = ux;
  const el = Math.hypot(ex, ey, ez); ex /= el; ey /= el; ez /= el;
  const nx = uy * ez - uz * ey, ny = uz * ex - ux * ez, nz = ux * ey - uy * ex;
  const at = (distM, ang) => {
    const c = Math.cos(ang), s = Math.sin(ang), t = distM / R;
    const dx = ux + t * (c * ex + s * nx);
    const dy = uy + t * (c * ey + s * ny);
    const dz = uz + t * (c * ez + s * nz);
    const l = Math.hypot(dx, dy, dz);
    return [dx / l, dy / l, dz / l];
  };
  const headingOf = (dx, dy, dz) =>
    Math.atan2(dx * nx + dy * ny + dz * nz, dx * ex + dy * ey + dz * ez);

  // THE BEARING IS COMPUTED FROM THE SUN WHEN IT IS NOT GIVEN, and that is the
  // difference between measuring the glint and measuring the absence of it.
  //
  // A specular highlight exists only where the mirror of the sun lies in the
  // frame. The first cut of this probe used four fixed bearings and read peak
  // tile deltas of 0.10, 0.13, 0.91 and 1.13 counts, i.e. nothing at any of
  // them, and TWO of the four "failed". Neither reading was evidence about the
  // term: three of those cameras had the sun behind them, where a working glint
  // is SUPPOSED to be invisible, and asserting that a term must show up where
  // physics says it must not is RN-46's error with the sign flipped.
  //
  // So the station is placed so the camera looks ACROSS the pond toward the
  // sun's own azimuth, which is where the specular path is. Read from
  // __ofPost.state().sun, which Frame.ts derives from cascade 0's own position
  // rather than from a second copy of the sun.
  // 0.16 puts the sun about 4 degrees up, which is the condition a specular
  const sunT = A.sunT ?? 0.16;
  // path EXISTS in, and it is pinned rather than left at the scene default for
  // the same reason R8 says a geometric probe runs on a slope: a term measured
  // only where it cannot work reports its own absence.
  //
  // MEASURED AT A HIGH SUN AND RECORDED SO NOBODY "FIXES" IT: at sunT 0.30, with
  // the sun 49 degrees up (elevationDot 0.759), the glint reads peak 1.67 counts
  // over 286 tiles against 55.25 over 158 tiles at 0.16. That is geometry and
  // not a defect. The specular path of a high sun lies at the mirror angle, i.e.
  // close to the viewer's feet, where Fresnel on water is 0.02 and where the
  // surface slope needed to bounce it at a near-horizontal camera is larger than
  // any slope this ripple spectrum contains. Real water glitters at a low sun
  // for exactly this reason.
  // THE CLOCK IS PINNED BEFORE THE SUN IS READ, and the order is the point: the
  // sun direction is a function of sim time, so reading it first and setting the
  // time afterwards would aim the camera at where the sun USED to be. RN-10 lost
  // a whole before/after pair to the same class of mistake, a sun that moved
  // between two captures because the recipe consumed different amounts of sim.
  of.setTime(sunT);
  await of.settle(4);
  const post = window.__ofPost;
  let sunBearingDeg = null;
  // The sun's ELEVATION over the pond, published because it is what decides
  // whether a glint can be in frame at all. A specular path off a horizontal
  // surface sits at the mirror angle, so a high sun puts it at the viewer's feet
  // and a low sun stretches it across the water toward the far shore. Reporting
  // it turns "no glint here" into an attributable statement instead of a shrug.
  // READ FROM of.stats().sky, NOT from __ofPost.state().sun, and that is a
  // correction rather than a preference. `ShadowRig.update` does
  // `if (!this.active) continue` before it moves the light, and Frame.publishSun
  // derives the post stack's sun from that light's position minus its target. So
  // the moment the rig goes inactive, which is exactly what happens when the sun
  // drops below the horizon, the published vector FREEZES at its last daylight
  // value. This probe read 0.5486 for sunT 0.05 AND 0.10, identical to four
  // decimal places across two different times of day, which is the tell: two
  // numbers agreeing to the last digit is a wiring diagnosis, never a
  // coincidence. `sky.elevation` is computed from the sky's own sun and does not
  // freeze. Harmless where the post stack uses it, because the contact-shadow
  // march is gated on the same rig; not harmless in an instrument.
  const sunElev = mustNum(of.stats().sky, 'elevationDot', 'stats.sky');
  const sunIsUp = sunElev > 0.02;
  if (A.bearingDeg === undefined && post !== undefined) {
    const s = post.state().sun;
    if (s !== undefined && Math.hypot(s[0], s[1], s[2]) > 0.5) {
      // Engine space is a pure translation of body space, so a direction is a
      // direction in both and the tangent basis applies unchanged.
      const az = Math.atan2(s[0] * nx + s[1] * ny + s[2] * nz,
        s[0] * ex + s[1] * ey + s[2] * ez);
      // Stand on the pond's far side FROM the sun and look back toward it.
      sunBearingDeg = ((az + Math.PI) * 180) / Math.PI;
    }
  }
  const ang = ((A.bearingDeg ?? sunBearingDeg ?? 0) * Math.PI) / 180;
  const distM = A.distM ?? 18;
  const altM = A.altM ?? 2;
  const here = at(distM, ang);
  const g = of.latlon(here[0], here[1], here[2]);

  const sample = async (yawDeg) => {
    of.teleport(g.latDeg, g.lonDeg, altM);
    await of.settle(8);
    of.look(yawDeg, 0);
    const a = of.world().player.feet.slice();
    of.input.tape([{ hold: 90, actions: ['forward'] }]);
    await of.run(0.6, 60);
    await yield0();
    const b = of.world().player.feet;
    of.input.tape([{ hold: 20, actions: [] }]);
    await of.run(0.1, 60);
    return headingOf(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  };
  const h0 = await sample(0);
  const h90 = await sample(90);
  let dh = h90 - h0;
  while (dh > Math.PI) dh -= 2 * Math.PI;
  while (dh < -Math.PI) dh += 2 * Math.PI;
  const sign = dh >= 0 ? 1 : -1;
  let inward = (() => {
    let e = (ang + Math.PI - h0) * sign;
    while (e > Math.PI) e -= 2 * Math.PI;
    while (e < -Math.PI) e += 2 * Math.PI;
    return (e * 180) / Math.PI;
  })();

  of.teleport(g.latDeg, g.lonDeg, altM);
  await of.settle(20);
  of.look(inward, A.pitchDeg ?? -12);
  of.setTime(sunT);
  await of.settle(12);
  await yield0();

  // ------------------------------------------------------------- the metric
  // THE TILE SIZE IS PART OF THE INSTRUMENT, and getting it wrong reads as a
  // dead feature. At 64 x 36 each tile is 20 x 20 px, so one pixel going from 50
  // to full white moves that tile's mean by half a count and a sparkle path a
  // few pixels wide averages to zero. That is exactly what the first run
  // reported for the glint. At 160 x 90 a tile is 8 x 8 px and the same pixel
  // moves it by 3.2 counts, which is well clear of a bit-exact floor. Area terms
  // (the ripple, refraction, the wet band) read the same on either grid, so the
  // fine grid costs nothing and is what every term is measured on.
  const TX = 160, TY = 90;
  /** Tile-mean difference between two framehash results. */
  const cmp = (a, b) => {
    let moved = 0, sum = 0, peak = 0;
    for (let i = 0; i < a.tiles.length; ++i) {
      const d = Math.abs(a.tiles[i] - b.tiles[i]);
      sum += d;
      if (d > 0.5) moved++;
      if (d > peak) peak = d;
    }
    const n = Math.max(1, a.tiles.length);
    return {
      identical: a.hash === b.hash,
      tiles: n,
      movedTiles: moved,
      movedFraction: +(moved / n).toFixed(4),
      meanTileDelta: +(sum / n).toFixed(4),
      peakTileDelta: +peak.toFixed(2),
    };
  };

  // THE NOISE FLOOR, FIRST, AND IT IS BIT-EXACT. Nothing is touched between
  // these two renders, so a non-identical hash means the frame is not settled
  // and every number below it is uninterpretable.
  const f0 = of.framehash(TX, TY);
  const f1 = of.framehash(TX, TY);
  const floor = cmp(f0, f1);

  const D = [1, 1, 1, 1];
  /** One matched pair: term at `on` against term at `off`, one render apart. */
  const term = (idx) => {
    const v = D.slice();
    water.set(v[0], v[1], v[2], v[3]);
    const on = of.framehash(TX, TY);
    v[idx] = 0;
    water.set(v[0], v[1], v[2], v[3]);
    const off = of.framehash(TX, TY);
    water.reset();
    return cmp(on, off);
  };

  const ripple = term(0);
  const glint = term(1);
  const refract = term(2);
  const foam = term(3);

  // The wet band lives in the TERRAIN material, so it has its own handle. Same
  // shape of pair, and it is measured here rather than in terrainart.js because
  // it is only reachable at a shoreline and terrainart.js has never been there.
  let wet = null;
  if (art !== undefined && typeof art.setWet === 'function') {
    art.setWet(1);
    const on = of.framehash(TX, TY);
    art.setWet(0);
    const off = of.framehash(TX, TY);
    art.setWet(1);
    wet = cmp(on, off);
  }

  // ALL FOUR AT ONCE, against the pre-RN-53 look. This is the headline pair:
  // zero amplitudes put the material back on the WG-42 depth ramp exactly.
  water.set(0, 0, 0, 0);
  const allOff = of.framehash(TX, TY);
  const statsOff = of.stats();
  water.reset();
  const allOn = of.framehash(TX, TY);
  const statsOn = of.stats();
  const all = cmp(allOn, allOff);

  const inv = (s) => ({
    drawCalls: mustNum(s.draw, 'calls', 'stats.draw'),
    triangles: mustNum(s.draw, 'triangles', 'stats.draw'),
    programs: mustNum(s.draw, 'programs', 'stats.draw'),
    geometries: mustNum(s.draw, 'geometries', 'stats.draw'),
    vramMB: mustNum(s, 'vramEstimateMB', 'stats'),
  });

  const st = water.state();
  const p = of.world().player.feet;
  const pr = Math.hypot(p[0], p[1], p[2]);
  const hereW = of.water(p[0] / pr, p[1] / pr, p[2] / pr);

  if (A.endWith === 'off') water.set(0, 0, 0, 0);
  else water.reset();
  await yield0();

  // The verdict. Every clause is a POSITIVE claim about the pixels the term is
  // supposed to move, plus the one exact claim that the instrument is sound.
  const fails = [];
  if (!floor.identical) {
    fails.push(`noise floor is not bit-exact: ${floor.movedTiles} tiles moved, `
      + `peak ${floor.peakTileDelta}. Nothing below this is interpretable.`);
  }
  if (!st.grab) fails.push('no framebuffer grab, so refraction never ran');
  if (st.live[2] === 0 && st.amp[2] !== 0) {
    fails.push('refraction amplitude authored non-zero but the shader got 0');
  }
  // Each term is asserted on the metric that can SEE it, which is not the same
  // metric for all five. Area terms are judged on how much of the frame they
  // reach; the glint is a sparse specular path and is judged on PEAK, because a
  // bright sparkle over a small area is what a correct glint looks like and a
  // coverage threshold would only ever be met by a broken, smeared one.
  const need = (name, m, minTiles, minPeak) => {
    if (m === null) { fails.push(`${name} was not measured at all`); return; }
    if (m.identical) { fails.push(`${name} changed NOTHING: hashes are identical`); return; }
    if (m.movedTiles < minTiles) {
      fails.push(`${name} moved only ${m.movedTiles} tiles of ${m.tiles}`);
    }
    if (m.peakTileDelta < minPeak) {
      fails.push(`${name} peak tile delta ${m.peakTileDelta} is under ${minPeak}`);
    }
  };
  // Coverage is asserted at any hour: a term either reaches the pixels it is
  // meant to reach or it does not, and that does not depend on the sun.
  need('ripple', ripple, 200);
  need('refraction', refract, 200);
  need('foam', foam, 20);
  need('wet band', wet, 100);
  if (sunIsUp) {
    // MAGNITUDE is asserted only in daylight, because every one of these terms
    // moves counts in proportion to the light falling on the water and a
    // threshold that holds at noon is a false failure at dusk.
    need('ripple', ripple, 0, 8);
    need('refraction', refract, 0, 8);
    need('foam', foam, 0, 8);
    need('wet band', wet, 0, 4);
    need('glint', glint, 4, 20);
  } else if (glint !== null && !glint.identical) {
    // THE NEGATIVE HALF, and it is the stronger claim of the two. A specular
    // highlight with the sun under the horizon is a bug, so below the horizon
    // the glint must be BIT-EXACTLY absent. Asserting only the positive half
    // would pass on a term that glowed all night.
    fails.push(`glint moved ${glint.movedTiles} tiles with the sun `
      + `${sunElev.toFixed(3)} below the horizon: it should be bit-exactly off`);
  }
  // THE COST CLAIM, and it is the one that is not noise sensitive. Frame timings
  // are worthless while other lanes build; these five are exact.
  const io = inv(statsOn), iff = inv(statsOff);
  for (const k of ['drawCalls', 'triangles', 'programs', 'geometries']) {
    if (io[k] !== iff[k]) {
      fails.push(`${k} differs with the terms on and off: ${iff[k]} -> ${io[k]}`);
    }
  }

  return {
    valid: fails.length === 0,
    fails,
    tick: of.world().tick,
    station: {
      distFromCentreM: R * Math.hypot(p[0] / pr - ux, p[1] / pr - uy, p[2] / pr - uz),
      yawDeg: inward, pitchDeg: A.pitchDeg ?? -12, sunT,
      // Null means the bearing was GIVEN rather than derived, which is a
      // different claim from "the sun could not be found".
      sunBearingDeg: sunBearingDeg === null ? null : +sunBearingDeg.toFixed(2),
      sunElevationDot: sunElev, sunIsUp,
      // What the camera is standing in, so a zero can be attributed rather than
      // guessed at. RN-48's rule: publish the oracle's own reading.
      waterDepthUnderFeetM: hereW.depthM,
      swim: of.swim(),
    },
    pond: {
      shorelineM: disc.shorelineM, levelM: disc.levelM, maxDepthM: disc.maxDepthM,
      basinRadiusM: disc.basinRadiusM,
    },
    waterState: st,
    // The grab's own cost, read from the object that owns it. `vramEstimateMB`
    // is built from the post targets and the chunk pool and does not see it, so
    // reporting only that number would understate this lane by the whole size of
    // the grab. `grabs` is a COUNTER and not a flag, because "it ran once at
    // boot" and "it runs every frame" are different claims.
    grabBytes: typeof water.grabBytes === 'function' ? water.grabBytes() : null,
    grabFrames: typeof water.grabs === 'function' ? water.grabs() : null,
    noiseFloor: floor,
    terms: { ripple, glint, refract, foam, wet, all },
    invariants: { on: io, off: iff },
  };
})()
